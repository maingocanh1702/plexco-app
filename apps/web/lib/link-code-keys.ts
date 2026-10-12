import type { LinkCodeKeys } from "@plexco/db";

/**
 * Link-code HMAC key from env LINK_CODE_LOOKUP_HMAC_KEY (raw UTF-8 bytes of the string, >= 16 bytes).
 * Returns null when missing/short so callers degrade ("temporarily unavailable") instead of 500ing.
 * Lane M3b MUST decode it the same way, or issued codes could never be consumed.
 */
export function linkCodeKeys(): LinkCodeKeys | null {
  const raw = process.env.LINK_CODE_LOOKUP_HMAC_KEY;
  if (!raw) return null;
  const key = Buffer.from(raw, "utf8");
  return key.length >= 16 ? { lookupHmacKey: key } : null;
}
