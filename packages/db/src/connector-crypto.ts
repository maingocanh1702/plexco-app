import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { authKeyVersion, deriveAesKey, resolveConnectorSecretRoot } from "./secret-key-root.js";

/**
 * Connector secret crypto (DD-122 O4): Zalo bot token, webhook secret_token, inbound raw payloads and the
 * encrypted Zalo user id. Published as `@plexco/db/connector-crypto` (a subpath, never the root entry, so
 * the web tests that replace `@plexco/db` wholesale keep the real crypto); moved byte-for-byte from
 * apps/web/lib/connector-secrets.ts, which re-exports it.
 *
 * Key: HKDF(connector root, info `plexco:connector-zalo-enc:v1`). The root is
 * KMS_ENCRYPTED_CONNECTOR_PEPPER when set (aws-kms), else the shared auth secret; the distinct HKDF label
 * keeps the derived key separate from the PKCE/email keys either way.
 * Layout: `iv(12) || authTag(16) || ciphertext`, tag length pinned both ways, AAD
 * `plexco:connector-zalo-aad:v1:<tenant_id>|<bot_id>|<purpose>` so a blob cannot be replayed onto another
 * tenant, bot or purpose.
 *
 * Decrypt happens ONLY in a process that calls Zalo (the web, which also verifies its webhook, and the
 * worker's zalo_dm projector), and ALWAYS after that process's routing_audit row for the decrypt is
 * written: if the audit write fails, nothing is decrypted (fail closed). No secret material is ever logged
 * or audited. openConnectorSecret is the raw open; callers own the version check and the audit order.
 */
export {
  __resetAuthSecretCacheForTest,
  authKeyVersion,
  deriveAesKey,
  resolveAuthSecretKey,
  resolveConnectorSecretRoot,
} from "./secret-key-root.js";

/**
 * Version label stored next to every ciphertext and CHECKED on decrypt (fail closed on mismatch).
 * With KMS_PROVIDER=aws-kms and KMS_ENCRYPTED_CONNECTOR_PEPPER set, the connector root has its OWN
 * identity: `connector-pepper:` + first 16 hex of SHA-256 of that (non-secret) ciphertext blob, so
 * rotating the pepper changes the label. Otherwise the root is the auth secret and the label is
 * authKeyVersion() (KMS_KEY_ID or "local").
 */
export function connectorKeyVersion(): string {
  const blob = process.env.KMS_ENCRYPTED_CONNECTOR_PEPPER;
  if (process.env.KMS_PROVIDER === "aws-kms" && blob) {
    return `connector-pepper:${createHash("sha256").update(blob).digest("hex").slice(0, 16)}`;
  }
  return authKeyVersion();
}

/** True only for the current connector label; a missing (null) label is never current. */
export function isCurrentConnectorKeyVersion(keyVersion: string | null): boolean {
  return keyVersion !== null && keyVersion === connectorKeyVersion();
}

export const CONNECTOR_ZALO_KEY_INFO = "plexco:connector-zalo-enc:v1";
const IV_BYTES = 12;
const TAG_BYTES = 16;

export type ConnectorPurpose =
  "bot_token" | "webhook_secret" | "channel_user" | `inbound_event:${string}`;

export interface ConnectorBinding {
  tenantId: string;
  botId: string;
  purpose: ConnectorPurpose;
}

const aad = (b: ConnectorBinding) =>
  Buffer.from(`plexco:connector-zalo-aad:v1:${b.tenantId}|${b.botId}|${b.purpose}`, "utf8");

async function connectorKey(): Promise<Buffer> {
  return deriveAesKey(await resolveConnectorSecretRoot(), CONNECTOR_ZALO_KEY_INFO);
}

export async function encryptConnectorSecret(
  plaintext: string,
  binding: ConnectorBinding,
): Promise<{ enc: Buffer; keyVersion: string }> {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", await connectorKey(), iv, {
    authTagLength: TAG_BYTES,
  });
  cipher.setAAD(aad(binding));
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return { enc: Buffer.concat([iv, cipher.getAuthTag(), ct]), keyVersion: connectorKeyVersion() };
}

/** Raw open (no version check, no audit): the caller has already checked the label and written its audit row. */
export async function openConnectorSecret(enc: Buffer, binding: ConnectorBinding): Promise<string> {
  if (enc.length < IV_BYTES + TAG_BYTES + 1)
    throw new Error("connector secret: malformed ciphertext");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    await connectorKey(),
    enc.subarray(0, IV_BYTES),
    {
      authTagLength: TAG_BYTES,
    },
  );
  decipher.setAAD(aad(binding));
  decipher.setAuthTag(enc.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
  return Buffer.concat([
    decipher.update(enc.subarray(IV_BYTES + TAG_BYTES)),
    decipher.final(),
  ]).toString("utf8");
}

/** bot_token_enc is a `text` column: base64url of the blob. */
export const blobToText = (enc: Buffer): string => enc.toString("base64url");
export const textToBlob = (text: string): Buffer => Buffer.from(text, "base64url");
