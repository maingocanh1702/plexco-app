import { hkdfSync } from "node:crypto";

/**
 * Shared key-material resolver for auth-surface and connector secrets (DD-31 gap 3, DD-122 O4), moved
 * unchanged from apps/web/lib/auth-secrets.ts + oauth-transaction.ts so the web and the worker derive the
 * SAME keys (published through `@plexco/db/connector-crypto`; the web modules re-export it).
 *
 * KMS_PROVIDER=aws-kms (staging/prod): decrypts KMS_ENCRYPTED_AUTH_PEPPER — a ciphertext blob produced
 * ONCE out-of-band (`aws kms encrypt` on a random 32-byte value) — via AWS KMS Decrypt. Decrypt is
 * deterministic for a fixed ciphertext, so every process/replica resolves the SAME plaintext key.
 * Anything else (local dev default): reads ENCRYPTION_KEY directly.
 * Resolved once per process, then cached — no KMS round-trip per request.
 */

let cachedKey: Buffer | null = null;
let cachedConnectorRoot: Buffer | null = null;

/** HMAC-SHA256's own block size — the conventional minimum for a full-strength key. */
const MIN_KEY_BYTES = 32;

/** The only KMS_PROVIDER values this helper understands (no gcp-kms etc. branch exists here). */
const SUPPORTED_KMS_PROVIDERS = new Set([undefined, "local", "aws-kms"]);

export async function resolveAuthSecretKey(): Promise<Buffer> {
  if (cachedKey) return cachedKey;
  const provider = process.env.KMS_PROVIDER;
  // Fail closed on anything unrecognized (codex round-09): silently falling through to the dev
  // fallback for a misspelled or documented-but-unimplemented provider (e.g. "gcp-kms") would let
  // staging/prod run on an unintended ENCRYPTION_KEY pepper without ever touching the real KMS.
  if (!SUPPORTED_KMS_PROVIDERS.has(provider)) {
    throw new Error(
      `Unsupported KMS_PROVIDER "${provider}" — this helper supports only "aws-kms" or ` +
        `"local"/unset (dev fallback). Refusing to silently use ENCRYPTION_KEY instead.`,
    );
  }
  const key = provider === "aws-kms" ? await resolveFromAwsKms() : resolveFromEnvFallback();
  // Enforced ONCE here regardless of which branch produced the key (codex round-06).
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
  // Node's base64 decoder is permissive — decode only here; length is checked centrally above.
  return Buffer.from(raw, "base64");
}

async function resolveFromAwsKms(envName = "KMS_ENCRYPTED_AUTH_PEPPER"): Promise<Buffer> {
  const encrypted = process.env[envName];
  if (!encrypted) {
    throw new Error(`${envName} is required when KMS_PROVIDER=aws-kms`);
  }
  // codex round-13 [P1]: AWS SDK v3 does NOT infer region from the key ARN; fail closed here,
  // before ever touching the network, instead of a "Region is missing" mid-request.
  const region = process.env.AWS_REGION;
  if (!region) {
    throw new Error("AWS_REGION is required when KMS_PROVIDER=aws-kms");
  }
  const { KMSClient, DecryptCommand } = await import("@aws-sdk/client-kms");
  const client = new KMSClient({ region });
  const result = await client.send(
    new DecryptCommand({
      CiphertextBlob: Buffer.from(encrypted, "base64"),
      // Extra integrity check: if set, KMS rejects a ciphertext encrypted under a DIFFERENT key.
      ...(process.env.KMS_KEY_ID ? { KeyId: process.env.KMS_KEY_ID } : {}),
    }),
  );
  if (!result.Plaintext) throw new Error("AWS KMS Decrypt returned no plaintext");
  return Buffer.from(result.Plaintext);
}

/**
 * Root key material for connector secrets (DD-122 O4: dedicated key). With KMS_PROVIDER=aws-kms and
 * KMS_ENCRYPTED_CONNECTOR_PEPPER set, that separate pepper is the root, so an auth-pepper leak does not
 * expose Zalo secrets. Otherwise it falls back to resolveAuthSecretKey(); callers still HKDF with a
 * connector-specific `info`, so the derived AES key is distinct either way.
 */
export async function resolveConnectorSecretRoot(): Promise<Buffer> {
  if (process.env.KMS_PROVIDER !== "aws-kms" || !process.env.KMS_ENCRYPTED_CONNECTOR_PEPPER) {
    return resolveAuthSecretKey();
  }
  if (cachedConnectorRoot) return cachedConnectorRoot;
  const key = await resolveFromAwsKms("KMS_ENCRYPTED_CONNECTOR_PEPPER");
  if (key.length < MIN_KEY_BYTES) {
    throw new Error(
      `Connector pepper is ${key.length} bytes, below the required ${MIN_KEY_BYTES} — check KMS_ENCRYPTED_CONNECTOR_PEPPER.`,
    );
  }
  cachedConnectorRoot = key;
  return key;
}

/** Test-only: force re-resolution on the next call (env vars changed mid-suite). */
export function __resetAuthSecretCacheForTest(): void {
  cachedKey = null;
  cachedConnectorRoot = null;
}

/** Opaque KMS key/version reference stored alongside a ciphertext. */
export function authKeyVersion(): string {
  return process.env.KMS_KEY_ID?.trim() || "local";
}

/**
 * Derive an EXACTLY-32-byte AES-256-GCM key from a secret via HKDF-SHA256, domain-separated by `info`.
 * resolveAuthSecretKey() only enforces a 32-byte MINIMUM, so a longer secret must not reach a cipher
 * that requires exactly 32 bytes (codex round-02 [P1]). Deterministic for a fixed secret + info.
 */
export function deriveAesKey(secret: Buffer, info: string): Buffer {
  return Buffer.from(hkdfSync("sha256", secret, Buffer.alloc(0), info, 32));
}
