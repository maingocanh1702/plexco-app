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

/** HMAC-SHA256's own block size — the conventional minimum for a full-strength key. */
const MIN_KEY_BYTES = 32;

/** The only KMS_PROVIDER values this helper understands (others: environments-setup.md documents gcp-kms etc. as a general secrets convention, but no such branch exists here). */
const SUPPORTED_KMS_PROVIDERS = new Set([undefined, "local", "aws-kms"]);

export async function resolveAuthSecretKey(): Promise<Buffer> {
  if (cachedKey) return cachedKey;
  const provider = process.env.KMS_PROVIDER;
  // Fail closed on anything unrecognized (codex round-09): silently falling
  // through to the dev fallback for a misspelled or documented-but-
  // unimplemented provider (e.g. "gcp-kms") would let staging/prod run on an
  // unintended ENCRYPTION_KEY pepper without ever touching the real KMS.
  if (!SUPPORTED_KMS_PROVIDERS.has(provider)) {
    throw new Error(
      `Unsupported KMS_PROVIDER "${provider}" — this helper supports only "aws-kms" or ` +
        `"local"/unset (dev fallback). Refusing to silently use ENCRYPTION_KEY instead.`,
    );
  }
  const key = provider === "aws-kms" ? await resolveFromAwsKms() : resolveFromEnvFallback();
  // Enforced ONCE here regardless of which branch produced the key (codex
  // round-06): validating inside only resolveFromEnvFallback (round-05) left
  // the KMS branch free to return a short/wrong-plaintext pepper unchecked.
  // A future third resolution path inherits this guarantee for free too.
  if (key.length < MIN_KEY_BYTES) {
    throw new Error(
      `Auth secret key material is ${key.length} bytes, below the required ${MIN_KEY_BYTES} — ` +
        "check ENCRYPTION_KEY (dev) or the KMS_ENCRYPTED_AUTH_PEPPER plaintext (staging/prod).",
    );
  }
  cachedKey = key;
  return cachedKey;
}

function resolveFromEnvFallback(): Buffer {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "ENCRYPTION_KEY is not set (dev fallback) and KMS_PROVIDER=aws-kms is not configured",
    );
  }
  // Node's base64 decoder is permissive (tolerates malformed/short input
  // rather than throwing) — decode only here; length is checked centrally
  // in resolveAuthSecretKey() above.
  return Buffer.from(raw, "base64");
}

async function resolveFromAwsKms(): Promise<Buffer> {
  const encrypted = process.env.KMS_ENCRYPTED_AUTH_PEPPER;
  if (!encrypted) {
    throw new Error("KMS_ENCRYPTED_AUTH_PEPPER is required when KMS_PROVIDER=aws-kms");
  }
  // codex round-13 [P1]: AWS SDK v3 does NOT infer region from the key ARN —
  // an unconfigured client throws "Region is missing" only when it actually
  // calls Decrypt, so every login would 500 mid-request in any
  // aws-kms environment missing this (the documented Fly secrets only listed
  // KMS_KEY_ID). Fail closed here instead, before ever touching the network.
  const region = process.env.AWS_REGION;
  if (!region) {
    throw new Error("AWS_REGION is required when KMS_PROVIDER=aws-kms");
  }
  const { KMSClient, DecryptCommand } = await import("@aws-sdk/client-kms");
  const client = new KMSClient({ region });
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
