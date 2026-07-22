import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { type DbHandle } from "@plexco/db";

/**
 * Cross-site OAuth transaction — the app boundary to the 0017 store (B0 §4.1).
 * This owns everything the redirect flow needs that is NOT the OIDC proof
 * (google-oidc.ts) or the session (session-cookies.ts): PKCE + state + browser
 * binding generation, the AES-256-GCM verifier ciphertext, the provider-scoped
 * Lax binding cookie, and the typed doorway to the SECURITY DEFINER issue/claim
 * and Google login functions.
 *
 * The DB wrappers live app-side (not in @plexco/db) on purpose: D1 order-3 scope
 * excludes packages/db/src/index.ts, so these thin `pool.query` ports over the
 * granted 0017 functions sit here alongside the crypto they pair with — the same
 * way session-cookies.ts owns the app-side `rateLimited` wrapper. The privileged
 * logic itself lives ONLY in the SQL migration.
 */

/** OAuth transaction + binding-cookie TTL (B0 §4.1 — both 10 minutes). */
export const OAUTH_TXN_TTL_SECONDS = 600;

export type OauthProvider = "google" | "facebook";
type OauthPool = DbHandle["pool"];

/** SHA-256 hex of a raw high-entropy token (state / binding / nonce). */
export function sha256Hex(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

/** A fresh 32-byte, base64url secret — the raw state or browser-binding value. */
function newSecret(): string {
  return randomBytes(32).toString("base64url");
}

export interface OauthContinuity {
  /** raw state — travels in the authorization URL AND the cookie */
  state: string;
  /** raw browser binding — lives ONLY in the cookie */
  binding: string;
  stateHash: string;
  bindingHash: string;
}

/** Generate the one-time state + browser binding and their at-rest hashes. */
export function newOauthContinuity(): OauthContinuity {
  const state = newSecret();
  const binding = newSecret();
  return { state, binding, stateHash: sha256Hex(state), bindingHash: sha256Hex(binding) };
}

export interface Pkce {
  verifier: string;
  challenge: string;
}

/**
 * PKCE S256 (RFC 7636): a 32-byte base64url verifier and its
 * `base64url(sha256(verifier))` challenge. Only the challenge leaves the server
 * in the authorization URL; the verifier is encrypted at rest (below).
 */
export function newPkce(): Pkce {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

/* ---------------------------------------------------------------------------
 * PKCE verifier AEAD — SAME hardened layout as account_emails.email_enc
 * (packages/db/src/auth.ts): `iv(12) || authTag(16) || ciphertext`, with
 * `authTagLength` PINNED on both cipher and decipher and a length gate BEFORE
 * any subarray (subarray CLAMPS instead of throwing, so a truncated blob would
 * otherwise yield a short tag and drop the forgery bound). AAD binds the
 * ciphertext to (state_hash, provider, kms_key_version) so it can never be
 * lifted onto a different transaction row. (semgrep gcm-no-tag-length)
 * ------------------------------------------------------------------------- */
const PKCE_ENC_IV_BYTES = 12;
const PKCE_ENC_TAG_BYTES = 16;
/** iv + tag + at least one ciphertext byte; a verifier is never empty. */
const PKCE_ENC_MIN_BYTES = PKCE_ENC_IV_BYTES + PKCE_ENC_TAG_BYTES + 1;

interface PkceAadParts {
  stateHash: string;
  provider: OauthProvider;
  kmsKeyVersion: string;
}

function pkceEncAad(parts: PkceAadParts): Buffer {
  return Buffer.from(
    `plexco:oauth-pkce-aad:v1:${parts.stateHash}:${parts.provider}:${parts.kmsKeyVersion}`,
    "utf8",
  );
}

/** Encrypt the PKCE verifier → `iv || tag || ciphertext` (for pkce_verifier_enc). */
export function encryptPkceVerifier(
  verifier: string,
  keys: { encKey: Buffer } & PkceAadParts,
): Buffer {
  if (keys.encKey.length !== 32) {
    throw new Error("encryptPkceVerifier: encKey must be 32 bytes (AES-256-GCM)");
  }
  const iv = randomBytes(PKCE_ENC_IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", keys.encKey, iv, {
    authTagLength: PKCE_ENC_TAG_BYTES,
  });
  cipher.setAAD(pkceEncAad(keys));
  const ciphertext = Buffer.concat([cipher.update(verifier, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
}

/**
 * Decrypt a stored PKCE verifier blob. Verifies the SAME AAD it was bound to; a
 * tampered state-hash / provider / key-version or a corrupted blob throws. The
 * length gate runs BEFORE slicing; the message is generic (never echoes the
 * observed length or offsets).
 */
export function decryptPkceVerifier(enc: Buffer, keys: { encKey: Buffer } & PkceAadParts): string {
  if (enc.length < PKCE_ENC_MIN_BYTES) {
    throw new Error("decryptPkceVerifier: malformed ciphertext");
  }
  const iv = enc.subarray(0, PKCE_ENC_IV_BYTES);
  const authTag = enc.subarray(PKCE_ENC_IV_BYTES, PKCE_ENC_IV_BYTES + PKCE_ENC_TAG_BYTES);
  const ciphertext = enc.subarray(PKCE_ENC_IV_BYTES + PKCE_ENC_TAG_BYTES);
  const decipher = createDecipheriv("aes-256-gcm", keys.encKey, iv, {
    authTagLength: PKCE_ENC_TAG_BYTES,
  });
  decipher.setAAD(pkceEncAad(keys));
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

/** Opaque KMS key/version reference stored alongside a ciphertext. */
export function authKeyVersion(): string {
  return process.env.KMS_KEY_ID?.trim() || "local";
}

/** HKDF `info` labels — domain-separate the derived AES keys by purpose. */
export const PKCE_ENC_KEY_INFO = "plexco:oauth-pkce-enc:v1";
export const EMAIL_ENC_KEY_INFO = "plexco:account-email-enc:v1";

/**
 * Derive an EXACTLY-32-byte AES-256-GCM key from the shared auth secret via
 * HKDF-SHA256, domain-separated by `info`. resolveAuthSecretKey() only enforces
 * a 32-byte MINIMUM, so a deployed ENCRYPTION_KEY / KMS plaintext LONGER than 32
 * bytes would otherwise make encryptPkceVerifier / deriveEmailArtifacts (both
 * require length === 32) throw and take the whole adapter down (codex round-02
 * [P1]). HKDF also stretches/separates the key so the same secret yields
 * distinct, purpose-bound encryption keys. Deterministic — the future order-4
 * email lifecycle reproduces the email key with the same secret + EMAIL_ENC_KEY_INFO.
 */
export function deriveAesKey(secret: Buffer, info: string): Buffer {
  return Buffer.from(hkdfSync("sha256", secret, Buffer.alloc(0), info, 32));
}

/* ---------------------------------------------------------------------------
 * Provider-scoped Lax binding cookie — NOT the session cookie and NOT the
 * Strict Telegram login-state cookie. Host-only, `SameSite=Lax` so it rides the
 * top-level cross-site GET redirect back from the provider, scoped to the EXACT
 * callback path so it is sent nowhere else. Value = `state.binding` (both
 * base64url, which never contains a '.').
 * ------------------------------------------------------------------------- */
function oauthCookieName(provider: OauthProvider): string {
  return `plx_oauth_${provider}`;
}
function oauthCallbackPath(provider: OauthProvider): string {
  return `/api/auth/${provider}/callback`;
}

export async function setOauthBindingCookie(
  provider: OauthProvider,
  value: { state: string; binding: string },
): Promise<void> {
  (await cookies()).set(oauthCookieName(provider), `${value.state}.${value.binding}`, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: oauthCallbackPath(provider),
    maxAge: OAUTH_TXN_TTL_SECONDS,
  });
}

/** Read + parse the binding cookie; null when missing or malformed. */
export async function readOauthBindingCookie(
  provider: OauthProvider,
): Promise<{ state: string; binding: string } | null> {
  const raw = (await cookies()).get(oauthCookieName(provider))?.value;
  if (!raw) return null;
  const parts = raw.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  return { state: parts[0], binding: parts[1] };
}

export async function clearOauthBindingCookie(provider: OauthProvider): Promise<void> {
  (await cookies()).delete({ name: oauthCookieName(provider), path: oauthCallbackPath(provider) });
}

/* ---------------------------------------------------------------------------
 * DB doorway to the 0017 SECURITY DEFINER functions (granted to `app`).
 * ------------------------------------------------------------------------- */

/** Store one started flow (auth_oauth_transaction_issue). */
export async function issueOauthTransaction(
  pool: OauthPool,
  input: {
    stateHash: string;
    provider: OauthProvider;
    browserBindingHash: string;
    nonceHash: string | null;
    pkceVerifierEnc: Buffer | null;
    kmsKeyVersion: string | null;
    ttlSeconds: number;
  },
): Promise<void> {
  await pool.query(
    `SELECT auth_oauth_transaction_issue($1, $2, $3, $4, $5, $6, make_interval(secs => $7))`,
    [
      input.stateHash,
      input.provider,
      input.browserBindingHash,
      input.nonceHash,
      input.pkceVerifierEnc,
      input.kmsKeyVersion,
      input.ttlSeconds,
    ],
  );
}

export interface OauthClaim {
  nonceHash: string | null;
  pkceVerifierEnc: Buffer | null;
  kmsKeyVersion: string | null;
}

/**
 * Single-use claim (auth_oauth_transaction_claim). Returns the nonce + verifier
 * ciphertext for the exchange, or null when the row is missing / provider or
 * binding mismatched / expired / already consumed (D1-3/D1-4).
 */
export async function claimOauthTransaction(
  pool: OauthPool,
  input: { stateHash: string; provider: OauthProvider; browserBindingHash: string },
): Promise<OauthClaim | null> {
  const { rows } = await pool.query(
    `SELECT nonce_hash, pkce_verifier_enc, kms_key_version
     FROM auth_oauth_transaction_claim($1, $2, $3)`,
    [input.stateHash, input.provider, input.browserBindingHash],
  );
  if (rows.length === 0) return null;
  const r = rows[0] as {
    nonce_hash: string | null;
    pkce_verifier_enc: Buffer | null;
    kms_key_version: string | null;
  };
  return {
    nonceHash: r.nonce_hash,
    pkceVerifierEnc: r.pkce_verifier_enc,
    kmsKeyVersion: r.kms_key_version,
  };
}

export interface GoogleLoginResult {
  accountId: string;
  personId: string;
  outcome: "login_success" | "identity_conflict";
}

/**
 * Google login finalizer (auth_login_google — §4 collision table). All inputs
 * are hashed/derived at the app boundary; `accountEmailId` is app-preallocated
 * and its ciphertext AAD bound to it (v1.86). Returns the resolved account +
 * outcome; the route mints a session only for `login_success`.
 */
export async function loginGoogle(
  pool: OauthPool,
  input: {
    subjectHash: string;
    emailLookupHash: string;
    emailEnc: Buffer;
    kmsKeyVersion: string;
    accountEmailId: string;
    displayName: string | null;
    requestRef: string;
  },
): Promise<GoogleLoginResult> {
  const { rows } = await pool.query(
    `SELECT account_id, person_id, outcome
     FROM auth_login_google($1, $2, $3, $4, $5, $6, $7)`,
    [
      input.subjectHash,
      input.emailLookupHash,
      input.emailEnc,
      input.kmsKeyVersion,
      input.accountEmailId,
      input.displayName,
      input.requestRef,
    ],
  );
  const r = rows[0] as { account_id: string; person_id: string; outcome: string };
  return {
    accountId: r.account_id,
    personId: r.person_id,
    outcome: r.outcome as GoogleLoginResult["outcome"],
  };
}
