import { createHash, createHmac } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { __resetAuthSecretCacheForTest } from "./auth-secrets";
import {
  normalizeTelegramPayload,
  telegramLoginNonce,
  telegramUserLookupHash,
  verifyTelegramLogin,
} from "./telegram-login";

const BOT_TOKEN = "12345:TEST-token";

process.env.ENCRYPTION_KEY ??= Buffer.from("k".repeat(32)).toString("base64");

beforeEach(() => {
  __resetAuthSecretCacheForTest();
});

/** Build a REAL signed payload exactly like Telegram does. */
function signedPayload(fields: Record<string, string>): Record<string, string> {
  const dcs = Object.keys(fields)
    .sort()
    .map((k) => `${k}=${fields[k]}`)
    .join("\n");
  const secret = createHash("sha256").update(BOT_TOKEN).digest();
  const hash = createHmac("sha256", secret).update(dcs).digest("hex");
  return { ...fields, hash };
}

const NOW = 1_800_000_000;

describe("verifyTelegramLogin", () => {
  it("accepts a correctly signed, fresh payload", () => {
    const p = signedPayload({
      id: "42424242",
      auth_date: String(NOW - 10),
      first_name: "Ngọc-Anh",
      last_name: "Mai",
      username: "ngocanh",
    });
    const r = verifyTelegramLogin(p, BOT_TOKEN, NOW);
    expect(r).toEqual({ ok: true, telegramUserId: "42424242", displayName: "Ngọc-Anh Mai" });
  });

  it("rejects a tampered field (AUTH_INVALID)", () => {
    const p = signedPayload({ id: "42", auth_date: String(NOW - 10), first_name: "A" });
    const r = verifyTelegramLogin({ ...p, id: "43" }, BOT_TOKEN, NOW);
    expect(r).toEqual({ ok: false, reason: "AUTH_INVALID" });
  });

  it("rejects a wrong bot token and malformed hashes", () => {
    const p = signedPayload({ id: "42", auth_date: String(NOW - 10) });
    expect(verifyTelegramLogin(p, "other:token", NOW).ok).toBe(false);
    expect(verifyTelegramLogin({ ...p, hash: "zz" }, BOT_TOKEN, NOW).ok).toBe(false);
    expect(verifyTelegramLogin({ ...p, hash: "" }, BOT_TOKEN, NOW).ok).toBe(false);
  });

  it("rejects non-canonical hash text (re-cased/suffixed digests would fork the nonce)", () => {
    const p = signedPayload({ id: "42", auth_date: String(NOW - 10) });
    expect(verifyTelegramLogin({ ...p, hash: p.hash!.toUpperCase() }, BOT_TOKEN, NOW).ok).toBe(
      false,
    );
    expect(verifyTelegramLogin({ ...p, hash: `${p.hash}00` }, BOT_TOKEN, NOW).ok).toBe(false);
  });

  it("rejects a stale auth_date (replay window)", () => {
    const p = signedPayload({ id: "42", auth_date: String(NOW - 301) });
    expect(verifyTelegramLogin(p, BOT_TOKEN, NOW)).toEqual({ ok: false, reason: "AUTH_STALE" });
  });

  it("null display name when TG sends no names", () => {
    const p = signedPayload({ id: "42", auth_date: String(NOW - 1) });
    const r = verifyTelegramLogin(p, BOT_TOKEN, NOW);
    expect(r.ok && r.displayName).toBeNull();
  });
});

describe("normalizeTelegramPayload", () => {
  it("stringifies the widget's numeric fields; verification then passes", () => {
    const signed = signedPayload({ id: "42", auth_date: String(NOW - 5), first_name: "A" });
    const wireShape = { ...signed, id: 42, auth_date: NOW - 5 } as unknown;
    const normalized = normalizeTelegramPayload(wireShape);
    expect(normalized).not.toBeNull();
    expect(verifyTelegramLogin(normalized!, BOT_TOKEN, NOW).ok).toBe(true);
  });

  it("rejects nested objects/arrays and non-finite numbers", () => {
    expect(normalizeTelegramPayload({ id: {}, auth_date: "1", hash: "aa" })).toBeNull();
    expect(normalizeTelegramPayload([1, 2])).toBeNull();
    expect(normalizeTelegramPayload(null)).toBeNull();
    expect(normalizeTelegramPayload({ id: Infinity, hash: "aa" })).toBeNull();
  });
});

describe("hash helpers", () => {
  it("nonce covers the whole payload including the signature", () => {
    const p1 = { id: "42", auth_date: "1", hash: "aa" };
    const p2 = { id: "42", auth_date: "1", hash: "bb" };
    expect(telegramLoginNonce(p1)).not.toBe(telegramLoginNonce(p2));
  });
});

describe("telegramUserLookupHash (DD-31 SI-2 — web-auth keyed hash)", () => {
  it("lookup hash is deterministic and never contains the raw id", async () => {
    const h = await telegramUserLookupHash("42424242");
    expect(h).toHaveLength(64);
    expect(h).not.toContain("42424242");
    expect(await telegramUserLookupHash("42424242")).toBe(h);
  });

  it("differs from a bare unkeyed sha256 of the same input (round-09 regression)", async () => {
    const keyed = await telegramUserLookupHash("42424242");
    const unkeyed = createHash("sha256").update("telegram:42424242").digest("hex");
    expect(keyed).not.toBe(unkeyed);
  });

  it("write path and read path produce IDENTICAL hashes for the same id (no lockout)", async () => {
    const atLogin = await telegramUserLookupHash("99999999");
    const atLookup = await telegramUserLookupHash("99999999");
    expect(atLogin).toBe(atLookup);
  });

  it("changing the configured key changes the output for the same id", async () => {
    const withKey1 = await telegramUserLookupHash("13131313");
    __resetAuthSecretCacheForTest();
    process.env.ENCRYPTION_KEY = Buffer.from("z".repeat(32)).toString("base64");
    const withKey2 = await telegramUserLookupHash("13131313");
    expect(withKey1).not.toBe(withKey2);
  });
});
