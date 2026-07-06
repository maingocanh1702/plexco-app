import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetAuthSecretCacheForTest, keyedHash, resolveAuthSecretKey } from "./auth-secrets";

const ORIGINAL_ENV = { ...process.env };

function resetEnv() {
  process.env = { ...ORIGINAL_ENV };
  delete process.env.KMS_PROVIDER;
  delete process.env.ENCRYPTION_KEY;
  delete process.env.KMS_ENCRYPTED_AUTH_PEPPER;
  delete process.env.KMS_KEY_ID;
  __resetAuthSecretCacheForTest();
}

beforeEach(resetEnv);
afterEach(resetEnv);

describe("resolveAuthSecretKey — env fallback (dev)", () => {
  it("reads ENCRYPTION_KEY (base64) when KMS_PROVIDER is unset", async () => {
    process.env.ENCRYPTION_KEY = Buffer.from("a".repeat(32)).toString("base64");
    const key = await resolveAuthSecretKey();
    expect(key.toString()).toBe("a".repeat(32));
  });

  it("throws when ENCRYPTION_KEY is missing and no KMS provider is configured", async () => {
    await expect(resolveAuthSecretKey()).rejects.toThrow(/ENCRYPTION_KEY/);
  });

  it("fails closed on a short/weak key instead of silently accepting it (codex round-05)", async () => {
    process.env.ENCRYPTION_KEY = Buffer.from("too-short").toString("base64");
    await expect(resolveAuthSecretKey()).rejects.toThrow(/32/);
  });

  it("fails closed on malformed base64 that decodes below the minimum length", async () => {
    process.env.ENCRYPTION_KEY = "not-valid-base64!!!";
    await expect(resolveAuthSecretKey()).rejects.toThrow(/32/);
  });

  it("KMS_PROVIDER=local behaves identically to unset", async () => {
    process.env.KMS_PROVIDER = "local";
    process.env.ENCRYPTION_KEY = Buffer.from("a".repeat(32)).toString("base64");
    const key = await resolveAuthSecretKey();
    expect(key.toString()).toBe("a".repeat(32));
  });

  it("fails closed on an unsupported/misspelled KMS_PROVIDER instead of silently using ENCRYPTION_KEY (codex round-09)", async () => {
    process.env.KMS_PROVIDER = "gcp-kms";
    process.env.ENCRYPTION_KEY = Buffer.from("a".repeat(32)).toString("base64");
    await expect(resolveAuthSecretKey()).rejects.toThrow(/Unsupported KMS_PROVIDER/);
  });

  it("caches the resolved key across calls (no re-read after the first)", async () => {
    process.env.ENCRYPTION_KEY = Buffer.from("b".repeat(32)).toString("base64");
    const first = await resolveAuthSecretKey();
    process.env.ENCRYPTION_KEY = Buffer.from("c".repeat(32)).toString("base64");
    const second = await resolveAuthSecretKey();
    expect(second).toBe(first); // same cached Buffer instance
  });
});

describe("resolveAuthSecretKey — AWS KMS (staging/prod)", () => {
  it("decrypts KMS_ENCRYPTED_AUTH_PEPPER via KMS and returns the plaintext", async () => {
    const plaintext = Buffer.from("d".repeat(32));
    vi.doMock("@aws-sdk/client-kms", () => ({
      KMSClient: class {
        send() {
          return Promise.resolve({ Plaintext: plaintext });
        }
      },
      DecryptCommand: class {
        constructor(public input: unknown) {}
      },
    }));
    vi.resetModules();
    const mod = await import("./auth-secrets");
    process.env.KMS_PROVIDER = "aws-kms";
    process.env.KMS_ENCRYPTED_AUTH_PEPPER = Buffer.from("ciphertext").toString("base64");

    const key = await mod.resolveAuthSecretKey();
    expect(key.equals(plaintext)).toBe(true);
    vi.doUnmock("@aws-sdk/client-kms");
  });

  it("throws when KMS_ENCRYPTED_AUTH_PEPPER is missing", async () => {
    process.env.KMS_PROVIDER = "aws-kms";
    await expect(resolveAuthSecretKey()).rejects.toThrow(/KMS_ENCRYPTED_AUTH_PEPPER/);
  });

  it("throws when KMS returns no plaintext (e.g. wrong key/region)", async () => {
    vi.doMock("@aws-sdk/client-kms", () => ({
      KMSClient: class {
        send() {
          return Promise.resolve({ Plaintext: undefined });
        }
      },
      DecryptCommand: class {
        constructor(public input: unknown) {}
      },
    }));
    vi.resetModules();
    const mod = await import("./auth-secrets");
    process.env.KMS_PROVIDER = "aws-kms";
    process.env.KMS_ENCRYPTED_AUTH_PEPPER = Buffer.from("x").toString("base64");

    await expect(mod.resolveAuthSecretKey()).rejects.toThrow(/no plaintext/i);
    vi.doUnmock("@aws-sdk/client-kms");
  });

  it("fails closed when KMS decrypts to a short/weak plaintext (codex round-06)", async () => {
    vi.doMock("@aws-sdk/client-kms", () => ({
      KMSClient: class {
        send() {
          return Promise.resolve({ Plaintext: Buffer.from("too-short") });
        }
      },
      DecryptCommand: class {
        constructor(public input: unknown) {}
      },
    }));
    vi.resetModules();
    const mod = await import("./auth-secrets");
    process.env.KMS_PROVIDER = "aws-kms";
    process.env.KMS_ENCRYPTED_AUTH_PEPPER = Buffer.from("ciphertext").toString("base64");

    await expect(mod.resolveAuthSecretKey()).rejects.toThrow(/32/);
    vi.doUnmock("@aws-sdk/client-kms");
  });
});

describe("keyedHash", () => {
  it("is deterministic for the same key + input", async () => {
    process.env.ENCRYPTION_KEY = Buffer.from("e".repeat(32)).toString("base64");
    const a = await keyedHash("telegram:42424242");
    const b = await keyedHash("telegram:42424242");
    expect(a).toBe(b);
    expect(a).toHaveLength(64);
  });

  it("changing the key changes the output for the SAME input (DD-31 SI-2)", async () => {
    process.env.ENCRYPTION_KEY = Buffer.from("f".repeat(32)).toString("base64");
    const withKey1 = await keyedHash("telegram:42424242");

    __resetAuthSecretCacheForTest();
    process.env.ENCRYPTION_KEY = Buffer.from("g".repeat(32)).toString("base64");
    const withKey2 = await keyedHash("telegram:42424242");

    expect(withKey1).not.toBe(withKey2);
  });

  it("never equals a bare unkeyed sha256 of the same input (round-09 regression)", async () => {
    const { createHash } = await import("node:crypto");
    process.env.ENCRYPTION_KEY = Buffer.from("h".repeat(32)).toString("base64");
    const keyed = await keyedHash("telegram:42424242");
    const unkeyed = createHash("sha256").update("telegram:42424242").digest("hex");
    expect(keyed).not.toBe(unkeyed);
  });
});
