import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { isIP } from "node:net";
import { domainToASCII } from "node:url";
import type pg from "pg";

/**
 * Auth/identity service — typed wrappers over the 0012 SECURITY DEFINER
 * functions. This is the ONLY doorway to the protected global tables
 * (persons/accounts/web_sessions/account_identities); the `app` role holds
 * EXECUTE on these functions and nothing else (0009/0012).
 * All token parameters are HASHES — raw session tokens never reach SQL.
 */

export interface ResolvedSession {
  sessionId: string;
  accountId: string;
  personId: string;
  csrfSecret: string;
  expiresAt: Date;
}

export class SlugTakenError extends Error {
  constructor() {
    super("tenant slug already taken by another owner");
  }
}

/**
 * Login-state CSRF binding (DD-31 SI-1). `stateHash` is sha256(raw token) —
 * the raw token lives only in the pre-auth cookie, never here. Plain hash is
 * fine: the raw token is high-entropy random, not a low-entropy enumerable
 * id (that constraint applies to SI-2's platform-hash, not this).
 */
export async function issueLoginState(
  pool: pg.Pool,
  input: { stateHash: string; ttlSeconds: number },
): Promise<void> {
  await pool.query(`SELECT auth_login_state_issue($1, make_interval(secs => $2))`, [
    input.stateHash,
    input.ttlSeconds,
  ]);
}

/** true = the state existed, was unexpired and unconsumed, and is now consumed. */
export async function consumeLoginState(pool: pg.Pool, stateHash: string): Promise<boolean> {
  const { rows } = await pool.query(`SELECT auth_login_state_consume($1) AS ok`, [stateHash]);
  return Boolean((rows[0] as { ok: boolean | null }).ok);
}

export async function createWebSession(
  pool: pg.Pool,
  input: { accountId: string; tokenHash: string; csrfSecret: string; ttlSeconds: number },
): Promise<string> {
  const { rows } = await pool.query(
    `SELECT auth_create_web_session($1, $2, $3, make_interval(secs => $4)) AS id`,
    [input.accountId, input.tokenHash, input.csrfSecret, input.ttlSeconds],
  );
  return (rows[0] as { id: string }).id;
}

/** Idle window the resolver applies when none is passed (mirrors the SQL default in 0040). */
export const SESSION_IDLE_SECONDS = 14 * 24 * 3600;

/**
 * Resolve a live session by token hash. Since 0040 (audit 2026-09-06 W-6) a session must ALSO
 * have been seen within `idleSeconds` (default 14 days) — the absolute 30-day TTL alone let a
 * copied cookie stay valid through a month of silence. Resolving touches last_seen_at, throttled
 * to once per minute per session inside the SECURITY DEFINER function.
 */
export async function resolveWebSession(
  pool: pg.Pool,
  tokenHash: string,
  idleSeconds: number = SESSION_IDLE_SECONDS,
): Promise<ResolvedSession | null> {
  const { rows } = await pool.query(
    `SELECT session_id, account_id, person_id, csrf_secret, expires_at
     FROM auth_resolve_web_session($1, make_interval(secs => $2))`,
    [tokenHash, idleSeconds],
  );
  if (rows.length === 0) return null;
  const r = rows[0] as {
    session_id: string;
    account_id: string;
    person_id: string;
    csrf_secret: string;
    expires_at: Date;
  };
  return {
    sessionId: r.session_id,
    accountId: r.account_id,
    personId: r.person_id,
    csrfSecret: r.csrf_secret,
    expiresAt: r.expires_at,
  };
}

/** Revoke old + mint linked replacement; null when the old session is gone. */
export async function rotateWebSession(
  pool: pg.Pool,
  input: {
    oldTokenHash: string;
    newTokenHash: string;
    newCsrfSecret: string;
    ttlSeconds: number;
    /** the account the user JUST authenticated as — the new session binds here */
    accountId: string;
    /**
     * Idle window the OLD session must still be inside (0040). Rotate carries
     * the same window as resolve on purpose: issueSession() hands us the raw
     * request cookie without resolving it first, so without this an idle-dead
     * cookie would be rotated into a fresh session instead of forcing re-auth.
     */
    idleSeconds?: number;
  },
): Promise<string | null> {
  const { rows } = await pool.query(
    `SELECT auth_rotate_web_session($1, $2, $3, make_interval(secs => $4), $5,
                                    make_interval(secs => $6)) AS id`,
    [
      input.oldTokenHash,
      input.newTokenHash,
      input.newCsrfSecret,
      input.ttlSeconds,
      input.accountId,
      input.idleSeconds ?? SESSION_IDLE_SECONDS,
    ],
  );
  return (rows[0] as { id: string | null }).id;
}

export async function revokeWebSession(pool: pg.Pool, tokenHash: string): Promise<boolean> {
  const { rows } = await pool.query(`SELECT auth_revoke_web_session($1) AS ok`, [tokenHash]);
  return Boolean((rows[0] as { ok: boolean | null }).ok);
}

/**
 * Account-self "logout everywhere" (DD-80 v1.88). Derives the account from
 * `currentTokenHash` server-side — never accepts an account id. Returns the
 * exact number of sessions newly revoked, or null when the token is
 * invalid/expired/already-revoked (zero mutation, zero audit row).
 */
export async function revokeAllWebSessions(
  pool: pg.Pool,
  currentTokenHash: string,
): Promise<number | null> {
  const { rows } = await pool.query(`SELECT auth_revoke_all_web_sessions($1) AS count`, [
    currentTokenHash,
  ]);
  return (rows[0] as { count: number | null }).count;
}

/**
 * auth-s4-d1b completion hop — arm a one-time handoff on the just-claimed OAuth
 * transaction so the same-site /complete POST can run issueSession() where the
 * Strict cookie is present. `handoffHash` = sha256 of the raw token that rides
 * the M3 landing's POST body. Returns true when the row was armed (the caller
 * fails closed on false); see migration 0018 (auth_oauth_handoff_arm).
 */
export async function armOauthCompletionHandoff(
  pool: pg.Pool,
  input: {
    stateHash: string;
    handoffHash: string;
    resolvedAccountId: string;
    ttlSeconds: number;
  },
): Promise<boolean> {
  const { rows } = await pool.query(
    `SELECT auth_oauth_handoff_arm($1, $2, $3, make_interval(secs => $4)) AS armed`,
    [input.stateHash, input.handoffHash, input.resolvedAccountId, input.ttlSeconds],
  );
  return Boolean((rows[0] as { armed: boolean | null }).armed);
}

/**
 * Single-use consume of a completion handoff (migration 0018,
 * auth_oauth_handoff_consume). Returns the resolved account id, or null when the
 * hash is missing / already consumed (replay — D1B-5) / expired (D1B-6). The
 * durable server-side fence, never a cookie signature.
 */
export async function consumeOauthCompletionHandoff(
  pool: pg.Pool,
  handoffHash: string,
): Promise<string | null> {
  const { rows } = await pool.query(`SELECT auth_oauth_handoff_consume($1) AS account_id`, [
    handoffHash,
  ]);
  return (rows[0] as { account_id: string | null }).account_id;
}

export async function provisionTenant(
  pool: pg.Pool,
  input: { slug: string; name: string; timezone?: string; locale?: string; personId: string },
): Promise<string> {
  try {
    const { rows } = await pool.query(`SELECT tenant_provision($1, $2, $3, $4, $5) AS id`, [
      input.slug,
      input.name,
      input.timezone ?? null,
      input.locale ?? null,
      input.personId,
    ]);
    return (rows[0] as { id: string }).id;
  } catch (error) {
    if ((error as { code?: string }).code === "23505") throw new SlugTakenError();
    throw error;
  }
}

export interface OnboardingSnapshot {
  runStatus: string;
  steps: { step: string; status: string }[];
}

/**
 * Latest onboarding run + step statuses. Scoped by withTenant/RLS AND an
 * explicit tenant_id predicate — belt-and-suspenders (DD-31 SI-3), so a
 * privileged or misconfigured connection can never fall back to the newest
 * run globally.
 */
export async function onboardingSnapshot(
  db: import("./client.js").Db,
  tenantId: string,
): Promise<OnboardingSnapshot | null> {
  const { withTenant } = await import("./tenant.js");
  const { sql } = await import("drizzle-orm");
  const rows = await withTenant(db, tenantId, async (tx) => {
    const result = await tx.execute(sql`
      WITH latest AS (
        SELECT id, status FROM onboarding_runs
        WHERE tenant_id = ${tenantId}
        ORDER BY created_at DESC
        LIMIT 1
      ),
      latest_steps AS (
        -- retries legitimately leave multiple rows per step (unique on
        -- run_id/step/idempotency_key) — keep only the MOST RECENT per step.
        -- Ordered by seq (bigserial), NOT created_at (codex round-11):
        -- Postgres now() is transaction-stable and migration 0013 backfilled
        -- every pre-existing row with one shared value, so created_at alone
        -- can tie with no deterministic winner; seq is a sequence allocation
        -- and is always strictly monotonic regardless of transaction timing.
        SELECT DISTINCT ON (s.step) s.step, s.status
        FROM onboarding_steps s
        WHERE s.run_id = (SELECT id FROM latest)
        ORDER BY s.step, s.seq DESC
      )
      SELECT latest.status AS run_status, latest_steps.step, latest_steps.status AS step_status
      FROM latest
      LEFT JOIN latest_steps ON true
    `);
    return result.rows as { run_status: string; step: string | null; step_status: string | null }[];
  });
  if (rows.length === 0) return null;
  return {
    runStatus: rows[0]!.run_status,
    steps: rows
      .filter((r) => r.step !== null)
      .map((r) => ({ step: r.step!, status: r.step_status ?? "not_configured" })),
  };
}

export async function tenantsForPerson(
  pool: pg.Pool,
  personId: string,
): Promise<{ tenantId: string; role: string }[]> {
  const { rows } = await pool.query(`SELECT tenant_id, role FROM tenant_ids_for_person($1)`, [
    personId,
  ]);
  return rows.map((r: { tenant_id: string; role: string }) => ({
    tenantId: r.tenant_id,
    role: r.role,
  }));
}

export interface TenantWithProfile {
  tenantId: string;
  role: string;
  name: string | null;
  slug: string | null;
  locale: string | null;
  timezone: string | null;
}

/**
 * `tenantsForPerson` plus each club's profile (0051 `tenant_profile_read`, which needs the tenant
 * GUC, hence one short withTenant per tenant). Sibling rather than a change to the original so
 * its callers and exact-shape tests are untouched. A profile that cannot be read yields nulls:
 * the tenant stays listed (membership is the fact), the UI falls back to a generic label.
 */
export async function tenantsForPersonWithProfile(
  handle: { pool: pg.Pool; db: import("./client.js").Db },
  personId: string,
): Promise<TenantWithProfile[]> {
  const { withTenant } = await import("./tenant.js");
  const { sql } = await import("drizzle-orm");
  const mine = await tenantsForPerson(handle.pool, personId);
  return Promise.all(
    mine.map(async (m) => {
      const rows = await withTenant(handle.db, m.tenantId, async (tx) => {
        const r = await tx.execute(
          sql`SELECT name, slug, locale, timezone FROM tenant_profile_read(${m.tenantId}::uuid)`,
        );
        return r.rows as { name: string; slug: string; locale: string; timezone: string }[];
      });
      const p = rows[0];
      return {
        ...m,
        name: p?.name ?? null,
        slug: p?.slug ?? null,
        locale: p?.locale ?? null,
        timezone: p?.timezone ?? null,
      };
    }),
  );
}

/** Routing association for an authenticated server-side person; commands own permissions. */
export async function guestNoteTenantForPerson(
  pool: pg.Pool,
  personId: string,
  candidateTenantId: string,
  sessionId: string,
): Promise<string | null> {
  if (
    [personId, candidateTenantId, sessionId].some(
      (id) => typeof id !== "string" || !UUID_RE.test(id),
    )
  ) {
    return null;
  }
  const { rows } = await pool.query<{ tenant_id: unknown }>(
    "SELECT public.guest_note_tenant_for_person($1::uuid, $2::uuid, $3::uuid) AS tenant_id",
    [personId, candidateTenantId, sessionId],
  );
  const tenantId = rows[0]?.tenant_id;
  if (rows.length === 1 && tenantId === null) return null;
  if (
    rows.length !== 1 ||
    typeof tenantId !== "string" ||
    !UUID_RE.test(tenantId) ||
    tenantId !== candidateTenantId.toLowerCase()
  ) {
    throw new Error("Invalid guest-note tenant context result");
  }
  return tenantId;
}

/** Shared sliding-window limiter (all replicas hit one store). true = allowed. */
export async function rateLimitCheck(
  pool: pg.Pool,
  bucket: string,
  limit: number,
  windowSeconds: number,
): Promise<boolean> {
  const { rows } = await pool.query(
    `SELECT rate_limit_check($1, $2, make_interval(secs => $3)) AS allowed`,
    [bucket, limit, windowSeconds],
  );
  return Boolean((rows[0] as { allowed: boolean }).allowed);
}

/* ===========================================================================
 * Email credential lifecycle — app-boundary derivation (D1, migration 0016).
 *
 * The ONLY app-boundary helpers this CODE-DARK slice adds. They are PURE: all
 * key material is INJECTED by the caller, so the DB package takes on no live
 * secret/KMS coupling here — the future order-4 email routes supply the
 * HMAC/KMS keys from config. Contracts pinned by
 * b0-auth-credential-lifecycle-design-probe.md §3.3 (email normalization +
 * artifact derivation) and §3.4 (provider-send idempotency key, kept distinct
 * from the public command receipt). No D1E acceptance row depends on these;
 * they carry their own focused unit tests.
 * ======================================================================== */

export class InvalidEmailError extends Error {
  constructor() {
    super("email address is invalid or ambiguous");
    this.name = "InvalidEmailError";
  }
}

/**
 * Canonicalize an email for lookup + storage (B0 §3.3). Deterministic so the
 * same real address always derives the same lookup hash:
 *   - trim OUTER whitespace only (never inner);
 *   - domain -> IDNA A-label + lowercase (domainToASCII);
 *   - local-part -> Unicode NFC, PRESERVE case, NO Gmail dot/plus folding and
 *     NO provider-specific alias rewriting.
 * Rejects a structurally invalid/ambiguous address. Routing-grade validation,
 * not full RFC 5322 parsing.
 */
export function normalizeEmail(rawEmail: string): string {
  const trimmed = rawEmail.trim();
  const at = trimmed.lastIndexOf("@");
  // exactly one @, non-empty local + domain, no internal whitespace.
  if (
    at <= 0 ||
    at !== trimmed.indexOf("@") || // a second @ => ambiguous
    at === trimmed.length - 1 ||
    /\s/.test(trimmed)
  ) {
    throw new InvalidEmailError();
  }
  const local = trimmed.slice(0, at).normalize("NFC");
  // Local-part is validated by an ALLOWLIST grammar, not a denylist of bad forms
  // (codex round-02/03 [P2]): a dot-atom (RFC 5321) of atext, extended with
  // Unicode letters/marks/numbers for internationalized addresses (EAI; NFC,
  // case-preserved). One rule rejects commas, parentheses, angle/square
  // brackets, colons, quotes, whitespace, and leading/trailing/consecutive dots,
  // and the 64-octet cap enforces the RFC 5321 local-part limit. (Quoted local
  // parts and comments are out of scope for phase-1.)
  const localAtom = "[\\p{L}\\p{M}\\p{N}!#$%&'*+/=?^_`{|}~-]+";
  if (
    !new RegExp(`^${localAtom}(\\.${localAtom})*$`, "u").test(local) ||
    Buffer.byteLength(local, "utf8") > 64
  ) {
    throw new InvalidEmailError();
  }
  const rawDomain = trimmed.slice(at + 1);
  // domainToASCII treats its input as a URL host: it SILENTLY TRUNCATES at URL
  // delimiters — e.g. "good.example#evil.com" -> "good.example" — and
  // PERCENT-DECODES escapes — e.g. "good%2Eexample.com" -> "good.example.com"
  // — either of which would bind verification/reset mail to a DIFFERENT real
  // address. Reject any URL delimiter, percent escape, or IP-literal bracket
  // before the IDNA conversion (codex round-01/04 [P1]/[P2]).
  if (/[/\\?#@:[\]<>"'%]/.test(rawDomain)) {
    throw new InvalidEmailError();
  }
  const asciiDomain = domainToASCII(rawDomain).toLowerCase();
  // domainToASCII also NORMALIZES IPv4 shorthand/integer forms to a dotted IP
  // ("2130706433" | "127.1" | "0x7f.1" -> "127.0.0.1"), which would pass the
  // hostname regex and collapse distinct inputs onto one identity. Email domains
  // are hostnames, not IP literals (bracketed IP-literals are already rejected
  // above), so reject any result that is an IP address — this closes the whole
  // IPv4/IPv6 family in one rule (codex round-06 [P2]).
  if (isIP(asciiDomain) !== 0) {
    throw new InvalidEmailError();
  }
  // Require a valid dotted A-label hostname: labels of alnum/hyphen (no leading
  // or trailing hyphen), at least one interior dot, total length <= 253. This
  // also rejects the "" that domainToASCII returns for an invalid domain.
  if (
    !/^(?=.{1,253}$)[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/.test(
      asciiDomain,
    )
  ) {
    throw new InvalidEmailError();
  }
  const canonical = `${local}@${asciiDomain}`;
  // RFC 5321 whole-mailbox limit: a 64-octet local part plus a 253-octet domain
  // can still exceed the 254-octet path cap (codex round-03 [P2]).
  if (Buffer.byteLength(canonical, "utf8") > 254) {
    throw new InvalidEmailError();
  }
  return canonical;
}

export interface EmailArtifactKeys {
  /** domain-separated HMAC key for the deterministic lookup hash */
  lookupHmacKey: Buffer;
  /** 32-byte AES-256-GCM key for the reversible email ciphertext */
  encKey: Buffer;
  /** opaque KMS key/version reference stored alongside the ciphertext */
  kmsKeyVersion: string;
}

export interface EmailArtifacts {
  canonicalEmail: string;
  /** lowercase hex HMAC-SHA256 — the account_emails.email_lookup_hash value */
  emailLookupHash: string;
  /** iv(12) || authTag(16) || ciphertext — the account_emails.email_enc value */
  emailEnc: Buffer;
  kmsKeyVersion: string;
}

const EMAIL_LOOKUP_DOMAIN = "plexco:account-email:v1:";

/**
 * Exact `email_enc` layout — `iv(12) || authTag(16) || ciphertext`.
 *
 * Both halves MUST pin `authTagLength`. Without it Node accepts ANY GCM-legal
 * tag length (4/8/12/13/14/15/16 bytes) at `setAuthTag`, and because
 * `Buffer.subarray` CLAMPS instead of throwing, a truncated stored blob would
 * silently yield a short tag: a 20-byte blob slices to an 8-byte tag and an
 * empty ciphertext, dropping the forgery bound from 2^-128 to 2^-64 (2^-32 for
 * a 4-byte tag). Anyone able to write `account_emails.email_enc` — SQL
 * injection elsewhere, a tampered restore, a compromised operator — could then
 * forge far more cheaply than the AEAD is supposed to allow. Pinning the length
 * AND rejecting undersized blobs up front closes both halves of that.
 * (semgrep javascript.node-crypto.security.gcm-no-tag-length)
 */
const EMAIL_ENC_IV_BYTES = 12;
const EMAIL_ENC_TAG_BYTES = 16;
/** iv + tag + at least one ciphertext byte; a canonical address is never empty. */
const EMAIL_ENC_MIN_BYTES = EMAIL_ENC_IV_BYTES + EMAIL_ENC_TAG_BYTES + 1;

/** HMAC-SHA256 of the domain-separated canonical email, lowercase hex (B0 §3.3). */
function deriveEmailLookupHash(canonicalEmail: string, lookupHmacKey: Buffer): string {
  return createHmac("sha256", lookupHmacKey)
    .update(EMAIL_LOOKUP_DOMAIN + canonicalEmail, "utf8")
    .digest("hex");
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Canonicalize a UUID (validate shape + lowercase). The AAD is bound at encrypt
 * time from the app-preallocated id, but the row-driven DECRYPT reads
 * account_emails.id back through Postgres's `uuid` type, which always renders
 * the canonical lowercase form. If encryption bound a noncanonical spelling
 * (e.g. uppercase hex) the two AADs would differ and the ciphertext would be
 * permanently undecryptable — so both paths canonicalize first (codex round-06 [P2]).
 */
function canonicalUuid(id: string): string {
  if (!UUID_RE.test(id)) {
    throw new Error("account_emails.id must be a UUID");
  }
  return id.toLowerCase();
}

/** AAD binds the ciphertext to its row id + lookup hash + key version (B0 §3.3). */
function emailEncAad(
  accountEmailId: string,
  emailLookupHash: string,
  kmsKeyVersion: string,
): Buffer {
  return Buffer.from(
    `plexco:account-email-aad:v1:${canonicalUuid(accountEmailId)}:${emailLookupHash}:${kmsKeyVersion}`,
    "utf8",
  );
}

/**
 * Derive all four account_emails artifacts for a raw address (B0 §3.3). The
 * caller PREALLOCATES account_emails.id and passes it in (v1.86 AAD handoff):
 * the ciphertext is bound to that id so it can never be silently re-bound to a
 * different row. Returns the canonical email, the deterministic lookup hash,
 * the authenticated ciphertext, and the KMS key version.
 */
export function deriveEmailArtifacts(
  rawEmail: string,
  accountEmailId: string,
  keys: EmailArtifactKeys,
): EmailArtifacts {
  if (keys.encKey.length !== 32) {
    throw new Error("deriveEmailArtifacts: encKey must be 32 bytes (AES-256-GCM)");
  }
  const canonicalEmail = normalizeEmail(rawEmail);
  const emailLookupHash = deriveEmailLookupHash(canonicalEmail, keys.lookupHmacKey);

  const iv = randomBytes(EMAIL_ENC_IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", keys.encKey, iv, {
    authTagLength: EMAIL_ENC_TAG_BYTES,
  });
  cipher.setAAD(emailEncAad(accountEmailId, emailLookupHash, keys.kmsKeyVersion));
  const ciphertext = Buffer.concat([cipher.update(canonicalEmail, "utf8"), cipher.final()]);
  const emailEnc = Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);

  return { canonicalEmail, emailLookupHash, emailEnc, kmsKeyVersion: keys.kmsKeyVersion };
}

/**
 * Decrypt an email_enc blob (B0 §3.3 delivery boundary). Verifies the SAME AAD
 * the ciphertext was bound to; a tampered id / lookup-hash / key-version or a
 * corrupted blob throws. Returns the canonical email.
 */
export function decryptEmailEnc(
  emailEnc: Buffer,
  accountEmailId: string,
  emailLookupHash: string,
  keys: Pick<EmailArtifactKeys, "encKey" | "kmsKeyVersion" | "lookupHmacKey">,
): string {
  // Length gate BEFORE slicing: subarray clamps, so a truncated blob would
  // otherwise produce a short IV/tag rather than an error. Generic message —
  // never echo the observed length or offsets back to a caller (D1E-22).
  if (emailEnc.length < EMAIL_ENC_MIN_BYTES) {
    throw new Error("decryptEmailEnc: malformed ciphertext");
  }
  const iv = emailEnc.subarray(0, EMAIL_ENC_IV_BYTES);
  const authTag = emailEnc.subarray(EMAIL_ENC_IV_BYTES, EMAIL_ENC_IV_BYTES + EMAIL_ENC_TAG_BYTES);
  const ciphertext = emailEnc.subarray(EMAIL_ENC_IV_BYTES + EMAIL_ENC_TAG_BYTES);
  const decipher = createDecipheriv("aes-256-gcm", keys.encKey, iv, {
    authTagLength: EMAIL_ENC_TAG_BYTES,
  });
  decipher.setAAD(emailEncAad(accountEmailId, emailLookupHash, keys.kmsKeyVersion));
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");

  // §3.3: normalize + rehash the DECRYPTED address and constant-time compare it
  // to the stored lookup hash. GCM's AAD binds the hash but NOT the plaintext
  // identity, so a row crafted with ciphertext for address A yet lookup hash for
  // address B still authenticates; re-deriving the hash from A and rejecting the
  // mismatch fails such a row closed before the address is used for delivery.
  // RETURN the normalized value (not the raw plaintext): a normalization-
  // equivalent but noncanonical ciphertext (e.g. an NFD SMTPUTF8 local part)
  // hashes equal yet differs byte-for-byte, and only the canonical form must
  // ever reach the provider (codex round-05 [P2]).
  const normalized = normalizeEmail(decrypted);
  const rederived = Buffer.from(deriveEmailLookupHash(normalized, keys.lookupHmacKey), "utf8");
  const stored = Buffer.from(emailLookupHash, "utf8");
  if (rederived.length !== stored.length || !timingSafeEqual(rederived, stored)) {
    throw new Error("decryptEmailEnc: decrypted address does not match its lookup hash");
  }
  return normalized;
}

/**
 * Provider-send idempotency key (B0 §3.4) — derived from the IMMUTABLE delivery
 * id + kind and KEPT SEPARATE from the public command receipt (command_id /
 * owner hash / target fingerprint). Only this opaque value ever reaches the
 * email provider. base64url; stable across key rotation because it is persisted
 * once with its key version.
 */
export function deriveProviderIdempotencyKey(
  input: { deliveryId: string; kind: "verify_email" | "password_reset" },
  key: { providerSendKey: Buffer; keyVersion: string },
): string {
  const message = `auth-email-provider-send:v1:${JSON.stringify([input.deliveryId, input.kind])}`;
  return createHmac("sha256", key.providerSendKey).update(message, "utf8").digest("base64url");
}
