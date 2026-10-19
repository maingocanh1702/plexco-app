// Pure rows of the chat route helpers (readiness 4.1-4.4, D-1, D-2): no DB, no session.
import { runWithLang } from "@plexco/core/i18n";
import { ChatCommandError, type ChatCommandErrorCode } from "@plexco/db";
import { describe, expect, it } from "vitest";

import {
  chatForbidden,
  decodeChatCursor,
  encodeChatCursor,
  mapChatError,
  parseChatLimit,
  toWireTimestamp,
  uuidOrNull,
} from "./chat-route";

const ID = "0b9f4a1e-6c2d-4e8f-9a3b-1c2d3e4f5a6b";
const raw = (text: string) => `v1.${Buffer.from(text, "utf8").toString("base64url")}`;

async function shape(res: Response) {
  const json = (await res.json()) as { error: unknown; meta: { requestId: string } };
  return { status: res.status, cache: res.headers.get("cache-control"), error: json.error };
}

describe("D-2 history cursor", () => {
  it.each(["2026-10-19 11:53:07.123456+00", "2026-10-19 11:53:07+05:30", "2026-02-28 00:00:00-03"])(
    "round-trips L14's raw text %s unchanged",
    (createdAt) => {
      expect(decodeChatCursor(encodeChatCursor({ createdAt, id: ID }))).toEqual({
        createdAt,
        id: ID,
      });
    },
  );

  it("lowercases an uppercase uuid", () => {
    const createdAt = "2026-10-19 11:53:07.1+07";
    expect(decodeChatCursor(raw(`${createdAt}|${ID.toUpperCase()}`))).toEqual({
      createdAt,
      id: ID,
    });
  });

  it.each([
    ["v2 prefix", `v2.${raw(`2026-10-19 11:53:07+00|${ID}`).slice(3)}`],
    ["junk characters", "v1.!!"],
    ["257 characters", `v1.${"A".repeat(254)}`],
    ["padded base64", `${raw(`2026-10-19 11:53:07+00|${ID}`)}=`],
    ["month 13", raw(`2026-13-19 11:53:07+00|${ID}`)],
    ["Feb 30", raw(`2026-02-30 11:53:07+00|${ID}`)],
    ["hour 24", raw(`2026-10-19 24:00:00+00|${ID}`)],
    ["7 fraction digits", raw(`2026-10-19 11:53:07.1234567+00|${ID}`)],
    ["non-uuid id", raw("2026-10-19 11:53:07+00|abc")],
    ["no separator", raw(`2026-10-19 11:53:07+00${ID}`)],
    ["two separators", raw(`2026-10-19 11:53:07+00|${ID}|x`)],
    ["empty payload", "v1."],
  ])("rejects %s", (_name, cursor) => {
    expect(decodeChatCursor(cursor)).toBeNull();
  });
});

describe("D-1 page size", () => {
  it.each([
    [null, 50],
    ["1", 1],
    ["100", 100],
  ])("accepts %s", (input, expected) => {
    expect(parseChatLimit(input)).toBe(expected);
  });

  it.each(["0", "101", "50.5", "-1", "", "1e2", " 5", "05"])("rejects %j", (input) => {
    expect(parseChatLimit(input)).toBeNull();
  });
});

describe("ids and wire timestamps", () => {
  it("uuidOrNull lowercases a uuid and refuses anything else", () => {
    expect(uuidOrNull(ID.toUpperCase())).toBe(ID);
    for (const bad of ["abc", `${ID} `, 42, null, undefined]) expect(uuidOrNull(bad)).toBeNull();
  });

  it.each([
    ["2026-10-19 21:04:00.123456+07", "2026-10-19T14:04:00.123Z"],
    ["2026-10-19 11:53:07+00", "2026-10-19T11:53:07.000Z"],
    ["2026-10-19 11:53:07.5+05:30", "2026-10-19T06:23:07.500Z"],
  ])("maps %s to ISO-8601 UTC", (text, iso) => {
    expect(toWireTimestamp(text)).toBe(iso);
  });

  it.each(["2026-10-19 11:53:07+05:30:15", "not a date"])("fails closed on %s", (text) => {
    expect(() => toWireTimestamp(text)).toThrow(RangeError);
  });

  it.each([null, 0])("fails closed on %j, never the 1970 epoch (A N-2)", (bad) => {
    expect(() => toWireTimestamp(bad as unknown as string)).toThrow(RangeError);
  });
});

describe("mapChatError (readiness 4.4)", () => {
  it.each([
    ["INVALID_BODY", 400],
    ["NOT_FOUND", 404],
    ["TENANT_SUSPENDED", 403],
    ["CHAT_MESSAGE_TOO_LARGE", 413],
    ["CHAT_RATE_LIMITED", 429],
    ["CHAT_CAPABILITY_REQUIRED", 403],
    ["CHAT_IDEMPOTENCY_MISMATCH", 409],
    ["CHAT_REPLY_INVALID", 409],
    ["CHAT_EDIT_WINDOW_CLOSED", 409],
    ["CHAT_EDIT_CONFLICT", 409],
    ["CHAT_REASON_INVALID", 422],
    ["CHAT_MODERATION_FORBIDDEN", 403],
  ] as [ChatCommandErrorCode, number][])(
    "%s -> %i, its own code, no-store",
    async (code, status) => {
      const res = mapChatError(new ChatCommandError(code));
      expect(res).not.toBeNull();
      const got = await shape(res as Response);
      expect(got).toMatchObject({ status, cache: "no-store", error: { code, statusCode: status } });
    },
  );

  it.each(["CHAT_FORBIDDEN", "CHAT_SAFETY_BLOCKED"] as ChatCommandErrorCode[])(
    "%s is the one CHAT_FORBIDDEN body, never in the tenant language",
    async (code) => {
      const expected = await shape(chatForbidden());
      expect(expected).toMatchObject({ status: 403, error: { code: "CHAT_FORBIDDEN" } });
      expect(await shape(mapChatError(new ChatCommandError(code)) as Response)).toEqual(expected);
      const en = runWithLang("en", () => mapChatError(new ChatCommandError(code)));
      expect(await shape(en as Response)).toEqual(expected);
    },
  );

  it("answers a mapped code in the ambient language", async () => {
    const res = runWithLang("en", () => mapChatError(new ChatCommandError("TENANT_SUSPENDED")));
    expect((await shape(res as Response)).error).toMatchObject({
      message: "This club is suspended.",
    });
  });

  it("returns null for CHAT_DUP_MESSAGE, a sanitized DB error and a non-error", () => {
    expect(mapChatError(new ChatCommandError("CHAT_DUP_MESSAGE"))).toBeNull();
    expect(mapChatError(new Error("CHAT_DB_ERROR:23505"))).toBeNull();
    expect(mapChatError("CHAT_FORBIDDEN")).toBeNull();
  });
});
