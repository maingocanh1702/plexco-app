import { hkdfSync } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  __resetAuthSecretCacheForTest,
  blobToText,
  CONNECTOR_ZALO_KEY_INFO,
  connectorKeyVersion,
  deriveAesKey,
  encryptConnectorSecret,
  isCurrentConnectorKeyVersion,
  openConnectorSecret,
  resolveAuthSecretKey,
  resolveConnectorSecretRoot,
  textToBlob,
  type ConnectorBinding,
} from "./connector-crypto.js";

// Produced ONCE by the pre-move apps/web/lib/connector-secrets.ts (lane base 442aa1b) with the fixture key
// below, the binding below and plaintext "123456:pinned-fixture-plaintext" (A28: the move keeps the HKDF
// label, the AAD, the iv|tag|ct layout and the key_version label byte-for-byte).
const PINNED_PRE_MOVE_TEXT =
  "ceR9jindQSp9o82CQ73keq69SkiXtb6ugTq5KOzlK0_GujYwJgeBLpDCbGfjk250D8wUfnqHVv5H1us";
const FIXTURE_KEY = Buffer.from("k".repeat(32)).toString("base64");
const binding: ConnectorBinding = {
  tenantId: "11111111-1111-4111-8111-111111111111",
  botId: "22222222-2222-4222-8222-222222222222",
  purpose: "bot_token",
};
const ENV_KEYS = ["ENCRYPTION_KEY", "KMS_PROVIDER", "KMS_KEY_ID", "KMS_ENCRYPTED_CONNECTOR_PEPPER"];
const saved = new Map(ENV_KEYS.map((k) => [k, process.env[k]]));

beforeEach(() => {
  process.env.ENCRYPTION_KEY = FIXTURE_KEY;
  for (const k of ENV_KEYS.slice(1)) delete process.env[k];
  __resetAuthSecretCacheForTest();
});
afterEach(() => {
  for (const [k, v] of saved) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  __resetAuthSecretCacheForTest();
});

describe("connector crypto (moved from apps/web, DD-122 O4)", () => {
  it("opens the ciphertext pinned from the pre-move web code with the stored label 'local'", async () => {
    expect(connectorKeyVersion()).toBe("local");
    expect(isCurrentConnectorKeyVersion("local")).toBe(true);
    expect(await openConnectorSecret(textToBlob(PINNED_PRE_MOVE_TEXT), binding)).toBe(
      "123456:pinned-fixture-plaintext",
    );
  });

  it("keeps the HKDF label and derivation exactly", async () => {
    expect(CONNECTOR_ZALO_KEY_INFO).toBe("plexco:connector-zalo-enc:v1");
    const root = await resolveConnectorSecretRoot();
    expect(root.equals(await resolveAuthSecretKey())).toBe(true);
    const direct = Buffer.from(
      hkdfSync("sha256", root, Buffer.alloc(0), CONNECTOR_ZALO_KEY_INFO, 32),
    );
    expect(deriveAesKey(root, CONNECTOR_ZALO_KEY_INFO).equals(direct)).toBe(true);
  });

  it("round-trips through the text column codec and refuses another tenant, bot or purpose (AAD)", async () => {
    const { enc, keyVersion } = await encryptConnectorSecret("123456:abc-secret", binding);
    expect(keyVersion).toBe("local");
    expect(enc.toString("utf8")).not.toContain("abc-secret");
    const blob = textToBlob(blobToText(enc));
    expect(await openConnectorSecret(blob, binding)).toBe("123456:abc-secret");
    for (const other of [
      { ...binding, tenantId: "33333333-3333-4333-8333-333333333333" },
      { ...binding, botId: "44444444-4444-4444-8444-444444444444" },
      { ...binding, purpose: "webhook_secret" as const },
    ]) {
      await expect(openConnectorSecret(blob, other)).rejects.toThrow();
    }
  });

  it("fails closed on a tampered or truncated blob, a wrong key and an unknown label", async () => {
    const blob = textToBlob(PINNED_PRE_MOVE_TEXT);
    const tampered = Buffer.from(blob);
    tampered.writeUInt8(tampered.readUInt8(tampered.length - 1) ^ 0x01, tampered.length - 1);
    await expect(openConnectorSecret(tampered, binding)).rejects.toThrow();
    await expect(openConnectorSecret(blob.subarray(0, 28), binding)).rejects.toThrow(/malformed/);
    process.env.ENCRYPTION_KEY = Buffer.from("j".repeat(32)).toString("base64");
    __resetAuthSecretCacheForTest();
    await expect(openConnectorSecret(blob, binding)).rejects.toThrow();
    expect(isCurrentConnectorKeyVersion(null)).toBe(false);
    expect(isCurrentConnectorKeyVersion("kms:other")).toBe(false);
  });

  it("labels an aws-kms connector pepper by its blob digest and refuses short key material", async () => {
    process.env.KMS_PROVIDER = "aws-kms";
    process.env.KMS_ENCRYPTED_CONNECTOR_PEPPER = "Y2lwaGVydGV4dA==";
    expect(connectorKeyVersion()).toMatch(/^connector-pepper:[0-9a-f]{16}$/);
    expect(isCurrentConnectorKeyVersion("local")).toBe(false);
    delete process.env.KMS_PROVIDER;
    process.env.ENCRYPTION_KEY = Buffer.from("short").toString("base64");
    __resetAuthSecretCacheForTest();
    await expect(resolveAuthSecretKey()).rejects.toThrow(/below the required 32/);
  });
});
