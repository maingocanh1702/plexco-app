import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decodeDiscoveryCursor, encodeDiscoveryCursor } from "./discovery-cursor";

/**
 * A-8 (readiness section 6): the discovery list's opaque signed keyset cursor (readiness 4.4).
 * A rejection is `null`, which the list route answers with INVALID_FILTER; a key configuration
 * error throws, which the route answers with 500.
 */
const KEY = "k".repeat(32);
const LISTING_ID = "0f8fad5b-d9cb-469f-a165-70867728950e";
const STARTS_AT = "2026-10-18T12:34:56.123456Z"; // the DB's UTC microsecond keyset text
const KEYSET = { startsAt: STARTS_AT, publicListingId: LISTING_ID };
const PAYLOAD = `${STARTS_AT}|${LISTING_ID}`;
const OVER_LENGTH = `v1.${"A".repeat(210)}.${"B".repeat(43)}`; // 257 characters

const b64url = (text: string) => Buffer.from(text, "utf8").toString("base64url");

/** Signs by hand per the documented format, so payloads the server never emits can be tested. */
function signed(payload: string, key = KEY, version = "v1"): string {
  const head = `${version}.${b64url(payload)}`;
  return `${head}.${createHmac("sha256", key).update(head).digest("base64url")}`;
}

afterEach(() => vi.unstubAllEnvs());

describe("discovery cursor with DISCOVERY_CURSOR_KEY set (A-8)", () => {
  beforeEach(() => vi.stubEnv("DISCOVERY_CURSOR_KEY", KEY));

  it("round-trips the keyset in the documented v1 shape, within 256 characters", () => {
    const cursor = encodeDiscoveryCursor(KEYSET);
    expect(cursor).toBe(signed(PAYLOAD));
    expect(cursor.length).toBeLessThanOrEqual(256);
    expect(decodeDiscoveryCursor(cursor)).toEqual(KEYSET);
  });

  it("rejects a tampered payload under the original MAC", () => {
    const mac = encodeDiscoveryCursor(KEYSET).split(".")[2];
    const later = b64url(`2026-10-18T12:34:56.123457Z|${LISTING_ID}`);
    expect(decodeDiscoveryCursor(`v1.${later}.${mac}`)).toBeNull();
  });

  it("rejects a tampered, truncated or extended MAC, the last character included", () => {
    const cursor = encodeDiscoveryCursor(KEYSET);
    const flipped = cursor.slice(-1) === "A" ? "B" : "A";
    expect(decodeDiscoveryCursor(cursor.slice(0, -1) + flipped)).toBeNull();
    expect(decodeDiscoveryCursor(cursor.slice(0, -1))).toBeNull();
    expect(decodeDiscoveryCursor(`${cursor}A`)).toBeNull();
  });

  it("rejects a MAC forged with another key", () => {
    expect(decodeDiscoveryCursor(signed(PAYLOAD, "f".repeat(32)))).toBeNull();
  });

  it("rejects a wrong version, even one signed with the right key", () => {
    expect(decodeDiscoveryCursor(signed(PAYLOAD, KEY, "v2"))).toBeNull();
    expect(decodeDiscoveryCursor(encodeDiscoveryCursor(KEYSET).replace(/^v1/, "v0"))).toBeNull();
  });

  it("rejects a cursor over 256 characters", () => {
    expect(OVER_LENGTH).toHaveLength(257);
    expect(decodeDiscoveryCursor(OVER_LENGTH)).toBeNull();
  });

  it.each([
    ["a calendar rollover", `2026-02-30T00:00:00.000000Z|${LISTING_ID}`],
    ["millisecond text", `2026-10-18T12:34:56.123Z|${LISTING_ID}`],
    ["an offset instead of Z", `2026-10-18T12:34:56.123456+07:00|${LISTING_ID}`],
    ["hour 24", `2026-10-18T24:00:00.000000Z|${LISTING_ID}`],
    ["year 0000, which Postgres rejects", `0000-01-01T00:00:00.000000Z|${LISTING_ID}`],
    ["no timestamp", `not-a-time|${LISTING_ID}`],
    ["a malformed uuid", `${STARTS_AT}|not-a-uuid`],
    ["a uuid one digit short", `${STARTS_AT}|${LISTING_ID.slice(0, -1)}`],
    ["a third field", `${PAYLOAD}|x`],
    ["no separator", `${STARTS_AT}${LISTING_ID}`],
  ])("rejects an authentic cursor whose payload has %s", (_label, payload) => {
    expect(decodeDiscoveryCursor(signed(payload))).toBeNull();
  });

  it.each(["", "v1", "v1.", "v1..", "v1.a.b.c", "garbage"])(
    "rejects the malformed cursor %j",
    (cursor) => {
      expect(decodeDiscoveryCursor(cursor)).toBeNull();
    },
  );
});

describe("discovery cursor key in production (A-8)", () => {
  beforeEach(() => vi.stubEnv("NODE_ENV", "production"));

  it("throws a configuration error without a key or with one under 32 characters", () => {
    const cursor = signed(PAYLOAD);
    for (const key of ["", "k".repeat(31)]) {
      vi.stubEnv("DISCOVERY_CURSOR_KEY", key);
      expect(() => encodeDiscoveryCursor(KEYSET)).toThrow(/DISCOVERY_CURSOR_KEY/);
      expect(() => decodeDiscoveryCursor(cursor)).toThrow(/DISCOVERY_CURSOR_KEY/);
    }
  });

  it("serves with a key of at least 32 characters", () => {
    vi.stubEnv("DISCOVERY_CURSOR_KEY", KEY);
    expect(decodeDiscoveryCursor(encodeDiscoveryCursor(KEYSET))).toEqual(KEYSET);
  });

  it("rejects an over-length cursor before the key is read", () => {
    vi.stubEnv("DISCOVERY_CURSOR_KEY", "");
    expect(decodeDiscoveryCursor(OVER_LENGTH)).toBeNull();
  });
});

describe("discovery cursor key outside production (A-8)", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("DISCOVERY_CURSOR_KEY", ""); // empty is unset
  });

  it("signs with one random key per process, so a round trip works", () => {
    const cursor = encodeDiscoveryCursor(KEYSET);
    expect(encodeDiscoveryCursor(KEYSET)).toBe(cursor);
    expect(decodeDiscoveryCursor(cursor)).toEqual(KEYSET);
  });

  it("rejects a cursor from another key, both ways", () => {
    expect(decodeDiscoveryCursor(signed(PAYLOAD))).toBeNull();
    const fromRandomKey = encodeDiscoveryCursor(KEYSET);
    vi.stubEnv("DISCOVERY_CURSOR_KEY", KEY);
    expect(decodeDiscoveryCursor(fromRandomKey)).toBeNull();
  });

  it("still refuses a configured key under 32 characters", () => {
    vi.stubEnv("DISCOVERY_CURSOR_KEY", "short");
    expect(() => encodeDiscoveryCursor(KEYSET)).toThrow(/DISCOVERY_CURSOR_KEY/);
  });
});
