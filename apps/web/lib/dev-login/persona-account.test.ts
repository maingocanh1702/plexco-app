import { createHmac, hkdfSync } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { decryptEmailEnc, normalizeEmail } from "@plexco/db";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../oauth-transaction", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../oauth-transaction")>();
  return { ...actual, loginGoogle: vi.fn() };
});

import { __resetAuthSecretCacheForTest } from "../auth-secrets";
import { EMAIL_ENC_KEY_INFO, loginGoogle } from "../oauth-transaction";
import { resolveDevPersonaAccount } from "./persona-account";
import {
  DEV_PERSONAS,
  DEV_SUBJECT_NAMESPACE,
  devPersonaByKey,
  devPersonaSubjectInput,
} from "./personas";

const KEY_B64 = Buffer.alloc(32, 7).toString("base64");
const KEY = Buffer.from(KEY_B64, "base64");

beforeEach(() => {
  vi.stubEnv("ENCRYPTION_KEY", KEY_B64);
  vi.stubEnv("KMS_PROVIDER", "local");
  vi.stubEnv("KMS_KEY_ID", "");
  __resetAuthSecretCacheForTest();
  vi.mocked(loginGoogle).mockReset().mockResolvedValue({
    accountId: "acc-1",
    personId: "per-1",
    outcome: "login_success",
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  __resetAuthSecretCacheForTest();
});

describe("resolveDevPersonaAccount — the Google callback's derivation, dev namespace", () => {
  it("passes loginGoogle exactly the artifacts the callback would derive, keyed by the same secret", async () => {
    const persona = devPersonaByKey("co_admin")!;
    const result = await resolveDevPersonaAccount({} as never, persona, "dev_login_ref");
    expect(result).toEqual({ accountId: "acc-1", personId: "per-1", outcome: "login_success" });

    const [, input] = vi.mocked(loginGoogle).mock.calls[0]!;
    const hmac = (value: string) => createHmac("sha256", KEY).update(value).digest("hex");
    expect(input.subjectHash).toBe(hmac(`plexco:web-auth:v1:dev-login:${persona.key}`));
    expect(input.kmsKeyVersion).toBe("local");
    expect(input.displayName).toBe(persona.displayName);
    expect(input.requestRef).toBe("dev_login_ref");
    expect(input.accountEmailId).toMatch(/^[0-9a-f-]{36}$/);

    // The email ciphertext opens with the SAME HKDF key the callback uses, bound to the id it sent.
    const encKey = Buffer.from(hkdfSync("sha256", KEY, Buffer.alloc(0), EMAIL_ENC_KEY_INFO, 32));
    expect(
      decryptEmailEnc(input.emailEnc, input.accountEmailId, input.emailLookupHash, {
        encKey,
        kmsKeyVersion: "local",
        lookupHmacKey: KEY,
      }),
    ).toBe(normalizeEmail(persona.email));
  });

  it("is deterministic per persona (a second login finds the seeded account) and distinct across personas", async () => {
    const hashes: string[] = [];
    for (const persona of [...DEV_PERSONAS, ...DEV_PERSONAS]) {
      await resolveDevPersonaAccount({} as never, persona, "r");
    }
    for (const [, input] of vi.mocked(loginGoogle).mock.calls) hashes.push(input.subjectHash);
    expect(hashes.slice(0, 3)).toEqual(hashes.slice(3));
    expect(new Set(hashes.slice(0, 3)).size).toBe(3);
  });
});

describe("dev subjects can never collide with real Google subjects", () => {
  // Read the prefix from the callback SOURCE so this test follows the real code, not a copy.
  const callbackSource = readFileSync(
    fileURLToPath(new URL("../../app/api/auth/google/callback/route.ts", import.meta.url)),
    "utf8",
  );
  const googlePrefix = /keyedHash\(`(plexco:web-auth:v1:google:)\$\{proof\.subject\}`\)/.exec(
    callbackSource,
  )?.[1];

  it("finds the callback's subject prefix (guards against a vacuous pass)", () => {
    expect(googlePrefix).toBe("plexco:web-auth:v1:google:");
  });

  it("neither namespace is a prefix of the other, so no HMAC input is shared", () => {
    expect(googlePrefix!.startsWith(DEV_SUBJECT_NAMESPACE)).toBe(false);
    expect(DEV_SUBJECT_NAMESPACE.startsWith(googlePrefix!)).toBe(false);
    for (const persona of DEV_PERSONAS) {
      expect(devPersonaSubjectInput(persona).startsWith(googlePrefix!)).toBe(false);
    }
  });

  it("persona emails are on the reserved .invalid TLD and pass the canonical normalizer", () => {
    for (const persona of DEV_PERSONAS) {
      expect(normalizeEmail(persona.email)).toMatch(/@dev\.invalid$/);
      expect(persona.displayName).toMatch(/\(fake\)$/);
    }
  });
});
