import { beforeEach, describe, expect, it, vi } from "vitest";

const audit = vi.hoisted(() => vi.fn());
vi.mock("@plexco/db", () => ({ appendSecretDecryptAudit: audit }));
vi.mock("./log", () => ({ log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));

import { __resetAuthSecretCacheForTest } from "./auth-secrets";
import {
  blobToText,
  connectorKeyVersion,
  decryptConnectorSecret,
  encryptConnectorSecret,
  textToBlob,
  type ConnectorBinding,
} from "./connector-secrets";

const binding: ConnectorBinding = {
  tenantId: "11111111-1111-4111-8111-111111111111",
  botId: "22222222-2222-4222-8222-222222222222",
  purpose: "bot_token",
};
const tx = {} as never;

beforeEach(() => {
  process.env.ENCRYPTION_KEY = Buffer.from("k".repeat(32)).toString("base64");
  delete process.env.KMS_PROVIDER;
  delete process.env.KMS_KEY_ID;
  __resetAuthSecretCacheForTest();
  audit.mockReset();
  audit.mockResolvedValue(undefined);
});

describe("connector secrets", () => {
  it("round-trips and writes exactly one audit row with no secret material", async () => {
    const { enc } = await encryptConnectorSecret("123456:abc-secret", binding);
    expect(enc.toString("utf8")).not.toContain("abc-secret");
    expect(await decryptConnectorSecret(tx, enc, binding, "local")).toBe("123456:abc-secret");
    expect(audit).toHaveBeenCalledTimes(1);
    expect(audit).toHaveBeenCalledWith(tx, {
      tenantId: binding.tenantId,
      botId: binding.botId,
      purpose: "bot_token",
    });
    expect(JSON.stringify(audit.mock.calls)).not.toContain("abc-secret");
  });

  it("fails when the AAD differs (other tenant, bot or purpose)", async () => {
    const { enc } = await encryptConnectorSecret("s", binding);
    for (const other of [
      { ...binding, tenantId: "33333333-3333-4333-8333-333333333333" },
      { ...binding, botId: "33333333-3333-4333-8333-333333333333" },
      { ...binding, purpose: "webhook_secret" as const },
    ]) {
      await expect(decryptConnectorSecret(tx, enc, other, "local")).rejects.toThrow();
    }
  });

  it("does not decrypt when the audit write fails (fail closed)", async () => {
    const { enc } = await encryptConnectorSecret("s", binding);
    audit.mockRejectedValueOnce(new Error("audit down"));
    await expect(decryptConnectorSecret(tx, enc, binding, "local")).rejects.toThrow("audit down");
  });

  it("rejects tampered and truncated ciphertext", async () => {
    const { enc } = await encryptConnectorSecret("secret", binding);
    const bad = Buffer.from(enc);
    bad[bad.length - 1] = bad[bad.length - 1]! ^ 1;
    await expect(decryptConnectorSecret(tx, bad, binding, "local")).rejects.toThrow();
    await expect(decryptConnectorSecret(tx, enc.subarray(0, 20), binding, "local")).rejects.toThrow(
      /malformed/,
    );
  });

  it("records the key version and uses a fresh IV per call", async () => {
    process.env.KMS_KEY_ID = "kms-key-7";
    const a = await encryptConnectorSecret("same", binding);
    const b = await encryptConnectorSecret("same", binding);
    expect(a.keyVersion).toBe("kms-key-7");
    expect(a.enc.equals(b.enc)).toBe(false);
  });

  it("derives a key distinct from the root: other root cannot decrypt", async () => {
    const { enc } = await encryptConnectorSecret("s", binding);
    process.env.ENCRYPTION_KEY = Buffer.from("z".repeat(32)).toString("base64");
    __resetAuthSecretCacheForTest();
    await expect(decryptConnectorSecret(tx, enc, binding, "local")).rejects.toThrow();
  });

  it("fails closed on a key-version mismatch or a missing label, before audit or decrypt", async () => {
    const { enc } = await encryptConnectorSecret("s", binding);
    await expect(decryptConnectorSecret(tx, enc, binding, "other-key")).rejects.toThrow(
      /key version/,
    );
    await expect(decryptConnectorSecret(tx, enc, binding, null)).rejects.toThrow(/key version/);
    expect(audit).not.toHaveBeenCalled();
  });

  it("connector version follows the connector pepper when aws-kms + pepper set, else the auth key version", () => {
    expect(connectorKeyVersion()).toBe("local");
    process.env.KMS_PROVIDER = "aws-kms";
    process.env.KMS_ENCRYPTED_CONNECTOR_PEPPER = "blob-1";
    const v1 = connectorKeyVersion();
    process.env.KMS_ENCRYPTED_CONNECTOR_PEPPER = "blob-2";
    expect(v1).toMatch(/^connector-pepper:[0-9a-f]{16}$/);
    expect(connectorKeyVersion()).not.toBe(v1);
    delete process.env.KMS_ENCRYPTED_CONNECTOR_PEPPER;
  });

  it("base64url text codec round-trips the blob", async () => {
    const { enc } = await encryptConnectorSecret("s", binding);
    expect(textToBlob(blobToText(enc)).equals(enc)).toBe(true);
  });
});
