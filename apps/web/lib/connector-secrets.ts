import { appendSecretDecryptAudit, type Tx } from "@plexco/db";
import {
  isCurrentConnectorKeyVersion,
  openConnectorSecret,
  type ConnectorBinding,
} from "@plexco/db/connector-crypto";
import { log } from "./log";

/**
 * Connector secret crypto (DD-122 O4): Zalo bot token, webhook secret_token and inbound raw payloads.
 *
 * The envelope (HKDF label `plexco:connector-zalo-enc:v1`, AAD
 * `plexco:connector-zalo-aad:v1:<tenant_id>|<bot_id>|<purpose>`, layout `iv(12) || authTag(16) ||
 * ciphertext`, the key_version label) lives in `@plexco/db/connector-crypto` so this web process and the
 * worker's zalo_dm projector share it byte-for-byte; it is re-exported here unchanged.
 *
 * Decrypt happens ONLY in a process that calls Zalo (or verifies its webhook), and every decrypt of a
 * stored secret writes one routing_audit row FIRST: if the audit write fails, nothing is decrypted (fail
 * closed). No secret material is ever logged or audited.
 */
export {
  blobToText,
  CONNECTOR_ZALO_KEY_INFO,
  connectorKeyVersion,
  encryptConnectorSecret,
  textToBlob,
  type ConnectorBinding,
  type ConnectorPurpose,
} from "@plexco/db/connector-crypto";

/**
 * Audited decrypt of a stored secret. `tx` must be an open withTenant transaction for the binding's
 * tenant. `keyVersion` is the stored label; anything other than the current connector version (or a
 * missing one) fails closed BEFORE audit or decrypt, with a distinct log event. The audit row shares
 * the caller's tx, so a decrypt that fails afterwards is logged but its audit row rolls back with the tx.
 */
export async function decryptConnectorSecret(
  tx: Tx,
  enc: Buffer,
  binding: ConnectorBinding,
  keyVersion: string | null,
): Promise<string> {
  if (!isCurrentConnectorKeyVersion(keyVersion)) {
    log.error("connector_key_version_mismatch", { botId: binding.botId });
    throw new Error("connector secret: key version mismatch");
  }
  await appendSecretDecryptAudit(tx, {
    tenantId: binding.tenantId,
    botId: binding.botId,
    purpose: binding.purpose,
  });
  return openConnectorSecret(enc, binding);
}
