import type { LinkCodeKeys } from "@plexco/db";

/**
 * Link-code HMAC key from env LINK_CODE_LOOKUP_HMAC_KEY: BASE64 (like ENCRYPTION_KEY), decoding to
 * >= 32 bytes (`openssl rand -base64 32`). Returns null when missing/short/not base64 so callers
 * degrade ("temporarily unavailable") instead of 500ing. Lane M3b MUST mirror this decoder, or issued
 * codes could never be consumed.
 */
const MIN_BYTES = 32;

export function linkCodeKeys(): LinkCodeKeys | null {
  const raw = process.env.LINK_CODE_LOOKUP_HMAC_KEY?.trim();
  if (!raw || !/^[A-Za-z0-9+/_-]+={0,2}$/.test(raw)) return null;
  const key = Buffer.from(raw, "base64");
  return key.length >= MIN_BYTES ? { lookupHmacKey: key } : null;
}
