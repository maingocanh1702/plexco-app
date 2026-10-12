import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { appendSecretDecryptAudit, type Tx } from "@plexco/db";
import { resolveConnectorSecretRoot } from "./auth-secrets";
import { authKeyVersion, deriveAesKey } from "./oauth-transaction";

/**
 * Connector secret crypto (DD-122 O4): Zalo bot token, webhook secret_token and inbound raw payloads.
 *
 * Key: HKDF(connector root, info `plexco:connector-zalo-enc:v1`). The root is
 * KMS_ENCRYPTED_CONNECTOR_PEPPER when set (aws-kms), else the shared auth secret; the distinct HKDF
 * label keeps the derived key separate from the PKCE/email keys either way.
 * Layout: `iv(12) || authTag(16) || ciphertext`, tag length pinned both ways, AAD
 * `plexco:connector-zalo-aad:v1:<tenant_id>|<bot_id>|<purpose>` so a blob cannot be replayed onto
 * another tenant, bot or purpose.
 *
 * Decrypt happens ONLY in the web process that calls Zalo (or verifies its webhook), and every
 * decrypt of a stored secret writes one routing_audit row FIRST: if the audit write fails, nothing
 * is decrypted (fail closed). No secret material is ever logged or audited.
 */
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
  return { enc: Buffer.concat([iv, cipher.getAuthTag(), ct]), keyVersion: authKeyVersion() };
}

function open(enc: Buffer, key: Buffer, binding: ConnectorBinding): string {
  if (enc.length < IV_BYTES + TAG_BYTES + 1)
    throw new Error("connector secret: malformed ciphertext");
  const decipher = createDecipheriv("aes-256-gcm", key, enc.subarray(0, IV_BYTES), {
    authTagLength: TAG_BYTES,
  });
  decipher.setAAD(aad(binding));
  decipher.setAuthTag(enc.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
  return Buffer.concat([
    decipher.update(enc.subarray(IV_BYTES + TAG_BYTES)),
    decipher.final(),
  ]).toString("utf8");
}

/** Audited decrypt of a stored secret. `tx` must be an open withTenant transaction for the binding's tenant. */
export async function decryptConnectorSecret(
  tx: Tx,
  enc: Buffer,
  binding: ConnectorBinding,
): Promise<string> {
  await appendSecretDecryptAudit(tx, {
    tenantId: binding.tenantId,
    botId: binding.botId,
    purpose: binding.purpose,
  });
  return open(enc, await connectorKey(), binding);
}

/** bot_token_enc is a `text` column: base64url of the blob. */
export const blobToText = (enc: Buffer): string => enc.toString("base64url");
export const textToBlob = (text: string): Buffer => Buffer.from(text, "base64url");
