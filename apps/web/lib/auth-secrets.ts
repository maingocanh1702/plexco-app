import { createHmac } from "node:crypto";
import { resolveAuthSecretKey } from "@plexco/db/connector-crypto";

/**
 * Shared key-material resolver for auth-surface secrets (DD-31 gap 3). SI-2's hash pepper is the first
 * consumer; any future secret on this surface reuses this same helper rather than deriving its own ad hoc
 * key. The resolver (KMS_PROVIDER=aws-kms via KMS_ENCRYPTED_AUTH_PEPPER, else ENCRYPTION_KEY; the
 * dedicated connector root; the per-process caches) moved unchanged to `@plexco/db/connector-crypto`
 * (packages/db/src/secret-key-root.ts) so the worker resolves the same keys; it is re-exported here.
 */
export {
  __resetAuthSecretCacheForTest,
  resolveAuthSecretKey,
  resolveConnectorSecretRoot,
} from "@plexco/db/connector-crypto";

/** Keyed HMAC-SHA256 — the ONLY way to hash low-entropy auth-surface identifiers. */
export async function keyedHash(value: string): Promise<string> {
  const key = await resolveAuthSecretKey();
  return createHmac("sha256", key).update(value).digest("hex");
}
