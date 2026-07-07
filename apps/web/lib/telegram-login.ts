import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { keyedHash } from "./auth-secrets";

/**
 * Telegram Login Widget verification (WAO-UC-1, edge #1/#2).
 * data_check_string = sorted `key=value` lines of every field EXCEPT `hash`;
 * secret = SHA256(botToken); valid ⟺ HMAC_SHA256(dcs, secret) === hash
 * (timing-safe) AND auth_date is fresh. PURE — unit-tested with real HMACs.
 */

export interface TelegramLoginPayload {
  id: string;
  auth_date: string;
  hash: string;
  first_name?: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
}

export const TELEGRAM_AUTH_MAX_AGE_SECONDS = 300;

export type TelegramVerifyResult =
  | { ok: true; telegramUserId: string; displayName: string | null }
  | { ok: false; reason: "AUTH_INVALID" | "AUTH_STALE" };

export function verifyTelegramLogin(
  payload: Record<string, string>,
  botToken: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): TelegramVerifyResult {
  const { hash, ...fields } = payload;
  // Canonical digest ONLY: Buffer.from(_, "hex") tolerates case/garbage, so a
  // re-cased hash would pass HMAC yet produce a DIFFERENT nonce — an exact
  // 64-lower-hex requirement keeps payload text and nonce 1:1 (no replay).
  if (!hash || !/^[0-9a-f]{64}$/.test(hash) || !fields.id || !fields.auth_date || !botToken) {
    return { ok: false, reason: "AUTH_INVALID" };
  }

  const dataCheckString = Object.keys(fields)
    .sort()
    .map((k) => `${k}=${fields[k]}`)
    .join("\n");
  const secret = createHash("sha256").update(botToken).digest();
  const expected = createHmac("sha256", secret).update(dataCheckString).digest("hex");

  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(hash, "hex");
  if (a.length !== b.length || b.length === 0 || !timingSafeEqual(a, b)) {
    return { ok: false, reason: "AUTH_INVALID" };
  }

  const authDate = Number(fields.auth_date);
  if (!Number.isFinite(authDate) || nowSeconds - authDate > TELEGRAM_AUTH_MAX_AGE_SECONDS) {
    return { ok: false, reason: "AUTH_STALE" };
  }

  const displayName =
    [fields.first_name, fields.last_name].filter(Boolean).join(" ").trim() || null;
  return { ok: true, telegramUserId: fields.id, displayName };
}

/**
 * The Login Widget posts id/auth_date as NUMBERS. Normalize every scalar to
 * its signed string form; anything non-scalar means a forged shape → null.
 */
export function normalizeTelegramPayload(raw: unknown): Record<string, string> | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === "string") out[k] = v;
    else if (typeof v === "number" && Number.isFinite(v)) out[k] = String(v);
    else if (typeof v === "boolean") out[k] = String(v);
    else return null;
  }
  return out;
}

/**
 * Keyed lookup hash for account_identities.platform_user_hash (DD-31 SI-2 —
 * web-auth layer only; NOT channel_identities.platform_user_lookup_hash).
 * Telegram user ids are low-entropy, enumerable integers — an unkeyed hash
 * is brute-forceable offline if account_identities/backups are ever exposed
 * (round-09 finding). The key comes from resolveAuthSecretKey() (DD-31 gap
 * 3: AWS KMS in staging/prod, ENCRYPTION_KEY fallback in dev) and MUST be
 * the same at write time (login) and read time (lookup).
 */
export function telegramUserLookupHash(telegramUserId: string): Promise<string> {
  return keyedHash(`telegram:${telegramUserId}`);
}

/** Nonce for single-use login payloads: hash of the WHOLE signed payload. */
export function telegramLoginNonce(payload: Record<string, string>): string {
  const canonical = Object.keys(payload)
    .sort()
    .map((k) => `${k}=${payload[k]}`)
    .join("\n");
  return createHash("sha256").update(canonical).digest("hex");
}
