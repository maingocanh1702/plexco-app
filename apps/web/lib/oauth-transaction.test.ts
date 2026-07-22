import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  authKeyVersion,
  clearOauthBindingCookie,
  decryptPkceVerifier,
  deriveAesKey,
  encryptPkceVerifier,
  newOauthContinuity,
  newPkce,
  OAUTH_TXN_TTL_SECONDS,
  PKCE_ENC_KEY_INFO,
  readOauthBindingCookie,
  setOauthBindingCookie,
  sha256Hex,
} from "./oauth-transaction";

vi.mock("next/headers", () => ({ cookies: vi.fn() }));

function mockCookieStore() {
  const store = { get: vi.fn(), set: vi.fn(), delete: vi.fn() };
  vi.mocked(cookies).mockResolvedValue(store as never);
  return store;
}

const ENC_KEY = randomBytes(32);
const AAD = { stateHash: "state-hash-abc", provider: "google" as const, kmsKeyVersion: "kv1" };

describe("newPkce / newOauthContinuity", () => {
  it("newPkce: verifier is base64url and challenge is base64url(sha256(verifier)) (S256)", () => {
    const { verifier, challenge } = newPkce();
    expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(challenge).toBe(createHash("sha256").update(verifier).digest("base64url"));
    expect(newPkce().verifier).not.toBe(verifier); // fresh each call
  });

  it("newOauthContinuity: state and binding are distinct with matching sha256 hashes", () => {
    const c = newOauthContinuity();
    expect(c.state).not.toBe(c.binding);
    expect(c.stateHash).toBe(sha256Hex(c.state));
    expect(c.bindingHash).toBe(sha256Hex(c.binding));
  });
});

describe("PKCE verifier AEAD (mirrors the email_enc hardening — D1E-23)", () => {
  it("round-trips the verifier under the correct key + AAD", () => {
    const verifier = "pkce-verifier-9f3c-value";
    const blob = encryptPkceVerifier(verifier, { encKey: ENC_KEY, ...AAD });
    // iv(12) || tag(16) || ciphertext
    expect(blob.length).toBeGreaterThan(28);
    expect(decryptPkceVerifier(blob, { encKey: ENC_KEY, ...AAD })).toBe(verifier);
  });

  it("AAD binds the ciphertext — a tampered state/provider/key-version or wrong key fails", () => {
    const blob = encryptPkceVerifier("verifier", { encKey: ENC_KEY, ...AAD });
    expect(() =>
      decryptPkceVerifier(blob, { encKey: ENC_KEY, ...AAD, stateHash: "other" }),
    ).toThrow();
    expect(() =>
      decryptPkceVerifier(blob, { encKey: ENC_KEY, ...AAD, provider: "facebook" }),
    ).toThrow();
    expect(() =>
      decryptPkceVerifier(blob, { encKey: ENC_KEY, ...AAD, kmsKeyVersion: "kv2" }),
    ).toThrow();
    expect(() => decryptPkceVerifier(blob, { encKey: randomBytes(32), ...AAD })).toThrow();
  });

  it("length gate BEFORE slicing — an undersized blob fails closed with a generic message", () => {
    const blob = encryptPkceVerifier("verifier", { encKey: ENC_KEY, ...AAD });
    for (const bad of [blob.subarray(0, 20), blob.subarray(0, 28), Buffer.alloc(0)]) {
      expect(() => decryptPkceVerifier(bad, { encKey: ENC_KEY, ...AAD })).toThrow(
        "decryptPkceVerifier: malformed ciphertext",
      );
    }
  });

  it("authTagLength is pinned — a truncated tag padded back to length still fails GCM", () => {
    const blob = encryptPkceVerifier("verifier", { encKey: ENC_KEY, ...AAD });
    const forged = Buffer.concat([
      blob.subarray(0, 12), // real iv
      blob.subarray(12, 20), // 8 real tag bytes...
      Buffer.alloc(8), // ...padded back to 16
      blob.subarray(28), // real ciphertext
    ]);
    expect(() => decryptPkceVerifier(forged, { encKey: ENC_KEY, ...AAD })).toThrow();
  });

  it("rejects a non-32-byte key", () => {
    expect(() => encryptPkceVerifier("v", { encKey: randomBytes(16), ...AAD })).toThrow(/32 bytes/);
  });
});

describe("deriveAesKey (codex round-02 [P1] — availability under a >32-byte secret)", () => {
  it("always derives EXACTLY 32 bytes regardless of the secret length", () => {
    for (const len of [32, 48, 64, 100]) {
      expect(deriveAesKey(randomBytes(len), "info").length).toBe(32);
    }
  });

  it("is deterministic and domain-separated by info", () => {
    const secret = randomBytes(48);
    expect(deriveAesKey(secret, "a").equals(deriveAesKey(secret, "a"))).toBe(true);
    expect(deriveAesKey(secret, "a").equals(deriveAesKey(secret, "b"))).toBe(false);
  });

  it("a 64-byte auth secret (accepted by resolveAuthSecretKey's minimum) still yields a WORKING AES key", () => {
    // Before the fix, a >32-byte secret was passed straight to encryptPkceVerifier
    // (which requires length === 32) and threw, taking the adapter down.
    const encKey = deriveAesKey(randomBytes(64), PKCE_ENC_KEY_INFO);
    const blob = encryptPkceVerifier("verifier", { encKey, ...AAD });
    expect(decryptPkceVerifier(blob, { encKey, ...AAD })).toBe("verifier");
  });
});

describe("provider-scoped Lax binding cookie", () => {
  beforeEach(() => vi.mocked(cookies).mockReset());

  it("setOauthBindingCookie: HttpOnly, SameSite=Lax, scoped to the EXACT callback path", async () => {
    const store = mockCookieStore();
    await setOauthBindingCookie("google", { state: "st", binding: "bd" });
    expect(store.set).toHaveBeenCalledWith(
      "plx_oauth_google",
      "st.bd",
      expect.objectContaining({
        httpOnly: true,
        sameSite: "lax",
        path: "/api/auth/google/callback",
        maxAge: OAUTH_TXN_TTL_SECONDS,
      }),
    );
    // NOT a Domain cookie (host-only) and NOT Strict.
    const opts = store.set.mock.calls[0]![2] as Record<string, unknown>;
    expect(opts.domain).toBeUndefined();
    expect(opts.sameSite).not.toBe("strict");
  });

  it("readOauthBindingCookie: parses state.binding; missing/malformed → null", async () => {
    const store = mockCookieStore();
    store.get.mockReturnValue({ value: "st.bd" });
    expect(await readOauthBindingCookie("google")).toEqual({ state: "st", binding: "bd" });
    store.get.mockReturnValue({ value: "noseparator" });
    expect(await readOauthBindingCookie("google")).toBeNull();
    store.get.mockReturnValue({ value: ".onlybinding" });
    expect(await readOauthBindingCookie("google")).toBeNull();
    store.get.mockReturnValue(undefined);
    expect(await readOauthBindingCookie("google")).toBeNull();
  });

  it("clearOauthBindingCookie: deletes the provider cookie at its callback path", async () => {
    const store = mockCookieStore();
    await clearOauthBindingCookie("google");
    expect(store.delete).toHaveBeenCalledWith({
      name: "plx_oauth_google",
      path: "/api/auth/google/callback",
    });
  });
});

describe("authKeyVersion", () => {
  it("uses KMS_KEY_ID when set, else the local dev marker", () => {
    const prev = process.env.KMS_KEY_ID;
    process.env.KMS_KEY_ID = "arn:aws:kms:region:acct:key/abc";
    expect(authKeyVersion()).toBe("arn:aws:kms:region:acct:key/abc");
    delete process.env.KMS_KEY_ID;
    expect(authKeyVersion()).toBe("local");
    if (prev !== undefined) process.env.KMS_KEY_ID = prev;
  });
});
