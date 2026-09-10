import { createHmac, randomBytes, scrypt as scryptCb } from "node:crypto";
import { promisify } from "node:util";
import type pg from "pg";

const scrypt = promisify(scryptCb) as (
  password: string | Buffer,
  salt: Buffer,
  keylen: number,
  options: Record<string, number>,
) => Promise<Buffer>;

/**
 * Identity link_code service — typed wrappers over the 0043 SECURITY DEFINER
 * functions (feature_identity_tech.md §4, DD-50). This is the ONLY doorway to
 * `link_codes` for the `app` role (0009: zero table grants on the global-
 * protected identity plane; 0043: EXECUTE on exactly these three functions).
 *
 * What crosses to SQL is hashes only — the same posture as every 0012/0016
 * token path: the plaintext code is generated here, returned to the issuer
 * ONCE, and never becomes a query parameter. Key material is INJECTED by the
 * caller (the auth.ts deriveEmailArtifacts precedent) so this package takes on
 * no env/KMS coupling; the web/bot lane that builds the §7 surfaces owns the
 * `LINK_CODE_LOOKUP_HMAC_KEY` (or equivalent) config and its rate limits.
 */

/** Spec §4: TTL default 10 minutes, single-use. 0043 caps p_ttl at 1 hour. */
export const LINK_CODE_TTL_SECONDS = 10 * 60;
/** 0039 column default; 0043 accepts 1..20. */
export const LINK_CODE_MAX_ATTEMPTS = 5;
/** 0043 per-wrong-attempt cooldown written to locked_until. */
export const LINK_CODE_COOLDOWN_SECONDS = 5;

/**
 * Crockford base32 (no I, L, O, U): 18 symbols = 90 random bits, rendered
 * XXXX-XXXX-XXXX-XXXX-XX. normalizeLinkCode() accepts any spacing/dashes/case
 * and the Crockford confusables (O→0, I/L→1).
 *
 * THE CODE IS SPLIT, and the split is the reason the DD-50 attempt cap exists
 * at all:
 *   symbols 0..8   LOOKUP component (40 bits) — HMAC'd into code_lookup_hash,
 *                  which is what finds the row;
 *   symbols 0..18  the WHOLE code — scrypt'd with the row's salt into
 *                  code_hash, which is what verifies it.
 * Deriving both from the whole code (the first cut of this module did) makes
 * them the same evidence: any input that finds a row also verifies against it,
 * so `wrong_code` never happens and failed_attempts / locked_until /
 * max_attempts are unreachable — the cap looks enforced and bounds nothing.
 * With the split, an attacker who guesses the 40-bit lookup still faces 50
 * bits of tail under a 5-attempt cap, and every wrong guess is counted.
 * 40 bits of lookup also keeps the UNIQUE(code_lookup_hash) birthday bound far
 * out (~2^20 codes); issue still retries on the 23505 that a collision raises.
 */
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const LINK_CODE_SYMBOLS = 18;
const LINK_CODE_LOOKUP_SYMBOLS = 8;
const LINK_CODE_RANDOM_BYTES = 12; // 96 bits generated, top 90 kept

const LOOKUP_DOMAIN = "plexco:link-code-lookup:v2:";
const SALT_BYTES = 16;
/** scrypt N=2^15, r=8, p=1 (~32 MiB, tens of ms) — a slow hash that a DB dump plus the HMAC key still cannot brute-force cheaply. */
const SCRYPT_PARAMS = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 } as const;
const VERIFIER_BYTES = 32;
/** Bounded retries for the (astronomically unlikely) UNIQUE(code_lookup_hash) collision. */
const ISSUE_ATTEMPTS = 3;
/**
 * Used when no row matched the lookup, so a nonexistent code costs the same
 * scrypt as a real one and the response time does not answer "does this code
 * exist?" on its own. (The DB answers that question the same way for both:
 * link_code_consume returns `invalid` with every ref NULL.)
 */
const DUMMY_SALT = Buffer.alloc(SALT_BYTES, 0x5c);

export interface LinkCodeKeys {
  /** domain-separated HMAC key for the deterministic lookup hash (≥16 bytes) */
  lookupHmacKey: Buffer;
}

/** Exactly one of the two — the DD-50 XOR issuer/target shape (0039 CHECK, 0043 contract). */
export type LinkCodeParty =
  | { channelIdentityId: string; accountId?: undefined }
  | { accountId: string; channelIdentityId?: undefined };

export interface IssuedLinkCode {
  /** The plaintext, formatted XXXX-XXXX-XXXXX. Shown to the issuer once; never stored, never logged. */
  code: string;
  linkCodeId: string;
  sourcePersonId: string;
  expiresAt: Date;
  /** Earlier live codes of the same person that this issue revoked (one live code per person). */
  superseded: number;
}

export type LinkCodeConsumeOutcome = "consumed" | "same_person" | "wrong_code" | "invalid";

export interface LinkCodeConsumeResult {
  outcome: LinkCodeConsumeOutcome;
  /** Set only for consumed / same_person. */
  linkCodeId: string | null;
  sourcePersonId: string | null;
  targetPersonId: string | null;
  issuerKind: "channel" | "account" | null;
  /** Set for wrong_code (and echoed on a claim); null on invalid. */
  failedAttempts: number | null;
  maxAttempts: number | null;
  lockedUntil: Date | null;
}

/** Generate a fresh plaintext code (90 bits, Crockford base32, grouped). */
export function generateLinkCode(): string {
  const bytes = randomBytes(LINK_CODE_RANDOM_BYTES);
  let acc = 0n;
  for (const b of bytes) acc = (acc << 8n) | BigInt(b);
  acc >>= BigInt(LINK_CODE_RANDOM_BYTES * 8 - LINK_CODE_SYMBOLS * 5); // keep the top 90 bits
  let out = "";
  for (let i = LINK_CODE_SYMBOLS - 1; i >= 0; i--) {
    out += CROCKFORD[Number((acc >> BigInt(i * 5)) & 31n)];
  }
  return formatLinkCode(out);
}

/** XXXX-XXXX-XXXX-XXXX-XX for display; input to normalizeLinkCode() may be in any shape. */
export function formatLinkCode(symbols: string): string {
  return (symbols.match(/.{1,4}/g) ?? []).join("-");
}

/**
 * The part of a canonical code that LOCATES a row. Exported because the split
 * is a contract between this module and 0043, not an implementation detail:
 * the lookup hash covers this prefix, the verifier covers the whole code.
 */
export function linkCodeLookupComponent(canonicalCode: string): string {
  return canonicalCode.slice(0, LINK_CODE_LOOKUP_SYMBOLS);
}

/**
 * Canonical 13-symbol form of user input, or null when it cannot be a code at
 * all (wrong length / symbol outside the alphabet). A null is a generic
 * LINK_CODE_INVALID for the caller — no DB call is needed or made.
 */
export function normalizeLinkCode(raw: string): string | null {
  if (typeof raw !== "string") return null;
  const cleaned = raw
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, "")
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1");
  if (cleaned.length !== LINK_CODE_SYMBOLS) return null;
  for (const ch of cleaned) if (!CROCKFORD.includes(ch)) return null;
  return cleaned;
}

/**
 * HMAC-SHA256(lookupHmacKey, domain || LOOKUP COMPONENT) — lowercase hex, the
 * link_codes.code_lookup_hash value. Note the input: the lookup component, NOT
 * the whole code (see the split above).
 */
export function deriveLinkCodeLookupHash(canonicalCode: string, keys: LinkCodeKeys): string {
  if (!Buffer.isBuffer(keys.lookupHmacKey) || keys.lookupHmacKey.length < 16) {
    throw new Error("link code lookupHmacKey must be a Buffer of at least 16 bytes");
  }
  return createHmac("sha256", keys.lookupHmacKey)
    .update(LOOKUP_DOMAIN + linkCodeLookupComponent(canonicalCode), "utf8")
    .digest("hex");
}

/**
 * scrypt(WHOLE canonical code, salt) → 32-byte verifier, the
 * link_codes.code_hash value. Async on purpose: scryptSync costs ~70-160 ms of
 * blocked event loop per call at these parameters and every consume attempt
 * pays it — including the ones for codes that do not exist — so the sync form
 * would let anyone posting well-formed junk stall the whole web process.
 */
export async function deriveLinkCodeVerifier(canonicalCode: string, salt: Buffer): Promise<Buffer> {
  if (!Buffer.isBuffer(salt) || salt.length < SALT_BYTES) {
    throw new Error(`link code salt must be a Buffer of at least ${SALT_BYTES} bytes`);
  }
  return scrypt(Buffer.from(canonicalCode, "utf8"), salt, VERIFIER_BYTES, SCRYPT_PARAMS);
}

function partyArgs(party: LinkCodeParty): [string | null, string | null] {
  const channel = party.channelIdentityId ?? null;
  const account = party.accountId ?? null;
  if ((channel === null) === (account === null)) {
    throw new Error("link code party must be exactly one of channelIdentityId / accountId");
  }
  return [channel, account];
}

/**
 * Issue a code for the authenticated issuer (channel identity XOR account).
 * source_person_id is derived server-side (0043 link_code_issue), which also
 * revokes the person's earlier live codes. Throws on an ineligible issuer
 * (pg 42501) or malformed input (22023) — the caller IS the issuer, so those
 * are programming/authorization errors, not enumeration.
 */
export async function issueLinkCode(
  pool: pg.Pool,
  issuer: LinkCodeParty,
  keys: LinkCodeKeys,
  opts: { ttlSeconds?: number; maxAttempts?: number } = {},
): Promise<IssuedLinkCode> {
  const [channel, account] = partyArgs(issuer);
  for (let attempt = 1; ; attempt++) {
    const code = generateLinkCode();
    const canonical = normalizeLinkCode(code);
    if (canonical === null) throw new Error("generated link code failed normalization"); // unreachable
    const salt = randomBytes(SALT_BYTES);
    const lookupHash = deriveLinkCodeLookupHash(canonical, keys);
    const verifier = await deriveLinkCodeVerifier(canonical, salt);
    try {
      const { rows } = await pool.query(
        `SELECT link_code_id, source_person_id, expires_at, superseded
           FROM link_code_issue($1, $2, $3, $4, $5, make_interval(secs => $6), $7)`,
        [
          channel,
          account,
          lookupHash,
          verifier,
          salt,
          opts.ttlSeconds ?? LINK_CODE_TTL_SECONDS,
          opts.maxAttempts ?? LINK_CODE_MAX_ATTEMPTS,
        ],
      );
      const r = rows[0] as {
        link_code_id: string;
        source_person_id: string;
        expires_at: Date;
        superseded: number;
      };
      return {
        code,
        linkCodeId: r.link_code_id,
        sourcePersonId: r.source_person_id,
        expiresAt: r.expires_at,
        superseded: r.superseded,
      };
    } catch (error) {
      // 23505 on UNIQUE(code_lookup_hash): two live codes drew the same 40-bit
      // lookup component. Astronomically unlikely, but a retry is one line and
      // the alternative is a 500 the issuer cannot act on. Anything else throws.
      if ((error as { code?: string }).code !== "23505" || attempt >= ISSUE_ATTEMPTS) throw error;
    }
  }
}

const INVALID: LinkCodeConsumeResult = {
  outcome: "invalid",
  linkCodeId: null,
  sourcePersonId: null,
  targetPersonId: null,
  issuerKind: null,
  failedAttempts: null,
  maxAttempts: null,
  lockedUntil: null,
};

/**
 * Consume a code presented by the authenticated TARGET (channel identity XOR
 * account). Two SQL calls, per the 0043 design: link_code_salt() (read-only;
 * a missing candidate yields NULL and we hash against a dummy salt so the
 * work is the same either way) then link_code_consume(), which locks in the
 * canonical order, re-derives both bindings, applies the terminal checks,
 * compares the verifier and claims — all inside the function's transaction.
 * The result is a redacted merge intent. The caller maps BOTH `invalid` and
 * `wrong_code` to the same generic LINK_CODE_INVALID (§7) — the distinction
 * between "no such code" and "that code exists but you mistyped it" is an
 * existence oracle and must not survive into the response — and maps an
 * exhausted cap or an app-side rate limit to LINK_CODE_RATE_LIMITED. Never
 * forward these words, the counters, or the person ids to the user.
 */
export async function consumeLinkCode(
  pool: pg.Pool,
  rawCode: string,
  target: LinkCodeParty,
  keys: LinkCodeKeys,
  opts: { cooldownSeconds?: number } = {},
): Promise<LinkCodeConsumeResult> {
  const [channel, account] = partyArgs(target);
  const canonical = normalizeLinkCode(rawCode);
  if (canonical === null) return { ...INVALID };
  const lookupHash = deriveLinkCodeLookupHash(canonical, keys);
  const saltRes = await pool.query(`SELECT link_code_salt($1) AS salt`, [lookupHash]);
  const storedSalt = (saltRes.rows[0] as { salt: Buffer | null } | undefined)?.salt ?? null;
  const salt =
    Buffer.isBuffer(storedSalt) && storedSalt.length >= SALT_BYTES ? storedSalt : DUMMY_SALT;
  const verifier = await deriveLinkCodeVerifier(canonical, salt);
  const { rows } = await pool.query(
    `SELECT outcome, link_code_id, source_person_id, target_person_id, issuer_kind,
            failed_attempts, max_attempts, locked_until
       FROM link_code_consume($1, $2, $3, $4, make_interval(secs => $5))`,
    [lookupHash, verifier, channel, account, opts.cooldownSeconds ?? LINK_CODE_COOLDOWN_SECONDS],
  );
  const r = rows[0] as
    | {
        outcome: LinkCodeConsumeOutcome;
        link_code_id: string | null;
        source_person_id: string | null;
        target_person_id: string | null;
        issuer_kind: "channel" | "account" | null;
        failed_attempts: number | null;
        max_attempts: number | null;
        locked_until: Date | null;
      }
    | undefined;
  if (!r) return { ...INVALID };
  return {
    outcome: r.outcome,
    linkCodeId: r.link_code_id,
    sourcePersonId: r.source_person_id,
    targetPersonId: r.target_person_id,
    issuerKind: r.issuer_kind,
    failedAttempts: r.failed_attempts,
    maxAttempts: r.max_attempts,
    lockedUntil: r.locked_until,
  };
}
