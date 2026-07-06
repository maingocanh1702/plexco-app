import { createHmac } from "node:crypto";

/**
 * Shared key-material resolver for auth-surface secrets (DD-31 gap 3).
 * SI-2's hash pepper is the first consumer; any future secret on this
 * surface reuses this same helper rather than deriving its own ad hoc key.
 *
 * KMS_PROVIDER=aws-kms (staging/prod): decrypts KMS_ENCRYPTED_AUTH_PEPPER —
 * a ciphertext blob produced ONCE out-of-band (`aws kms encrypt` on a random
 * 32-byte value) — via AWS KMS Decrypt. Decrypt is deterministic for a fixed
 * ciphertext, so every process/replica resolves the SAME plaintext key.
 * Anything else (local dev default): reads ENCRYPTION_KEY directly.
 * Resolved once per process, then cached — no KMS round-trip per request.
 */

let cachedKey: Buffer | null = null;

export async function resolveAuthSecretKey(): Promise<Buffer> {
  if (cachedKey) return cachedKey;
  cachedKey =
    process.env.KMS_PROVIDER === "aws-kms"
      ? await resolveFromAwsKms()
      : resolveFromEnvFallback();
  return cachedKey;
}

/** HMAC-SHA256's own block size — the conventional minimum for a full-strength key. */
const MIN_KEY_BYTES = 32;

function resolveFromEnvFallback(): Buffer {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "ENCRYPTION_KEY is not set (dev fallback) and KMS_PROVIDER=aws-kms is not configured",
    );
  }
  // Node's base64 decoder is permissive (tolerates malformed/short input
  // rather than throwing), so a misconfigured short/garbage value would
  // otherwise silently produce a weak HMAC key (codex round-05) — fail
  // closed instead of trusting whatever decoded.
  const key = Buffer.from(raw, "base64");
  if (key.length < MIN_KEY_BYTES) {
    throw new Error(
      `ENCRYPTION_KEY decodes to ${key.length} bytes, below the required ${MIN_KEY_BYTES} — ` +
        "set a base64-encoded, high-entropy key of at least 32 bytes.",
    );
  }
  return key;
}

async function resolveFromAwsKms(): Promise<Buffer> {
  const encrypted = process.env.KMS_ENCRYPTED_AUTH_PEPPER;
  if (!encrypted) {
    throw new Error("KMS_ENCRYPTED_AUTH_PEPPER is required when KMS_PROVIDER=aws-kms");
  }
  const { KMSClient, DecryptCommand } = await import("@aws-sdk/client-kms");
  const client = new KMSClient({});
  const result = await client.send(
    new DecryptCommand({
      CiphertextBlob: Buffer.from(encrypted, "base64"),
      // Extra integrity check: if set, KMS rejects a ciphertext encrypted
      // under a DIFFERENT key (e.g. the wrong environment's blob pasted here).
      ...(process.env.KMS_KEY_ID ? { KeyId: process.env.KMS_KEY_ID } : {}),
    }),
  );
  if (!result.Plaintext) throw new Error("AWS KMS Decrypt returned no plaintext");
  return Buffer.from(result.Plaintext);
}

/** Keyed HMAC-SHA256 — the ONLY way to hash low-entropy auth-surface identifiers. */
export async function keyedHash(value: string): Promise<string> {
  const key = await resolveAuthSecretKey();
  return createHmac("sha256", key).update(value).digest("hex");
}

/** Test-only: force re-resolution on the next call (env vars changed mid-suite). */
export function __resetAuthSecretCacheForTest(): void {
  cachedKey = null;
}
