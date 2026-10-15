import type { DbHandle } from "@plexco/db";
import { describe, expect, it } from "vitest";
import {
  classifyProcessingError,
  extractZaloEvent,
  isDirectZaloChat,
  processZaloEvent,
} from "./process-event";
import { ZaloApiError } from "./client";

// The DD-126 (OD-2) body, no update_id: payment bot src/zalo/zalo.ts ZaloUpdate, chatbot parseZaloUpdate.
const signed = (message: Record<string, unknown> = {}) => ({
  event_name: "message.text.received",
  message: {
    message_id: "m-1",
    date: 1_760_000_000_000,
    text: "/me",
    from: { id: "u-7", display_name: "An" },
    chat: { id: "u-7", chat_type: "PRIVATE" },
    ...message,
  },
});

describe("extractZaloEvent", () => {
  it("reads the signed top-level shape; the event id composes message_id, chat.id and from.id", () => {
    expect(extractZaloEvent(signed())).toEqual({
      eventId: '["m-1","u-7","u-7"]',
      fromId: "u-7",
      chatId: "u-7",
      chatType: "PRIVATE",
      text: "/me",
      displayName: "An",
    });
  });

  it("same triple -> same key; the same message_id in another chat or from another sender -> distinct keys", () => {
    const key = (m: Record<string, unknown>) => extractZaloEvent(signed(m))?.eventId;
    expect(key({})).toBe(key({ text: "a redelivery carries the same ids" }));
    expect(key({ chat: { id: "group-1", chat_type: "GROUP" } })).not.toBe(key({}));
    expect(key({ from: { id: "u-8" } })).not.toBe(key({}));
  });

  it("is injective: separator characters inside ids cannot make two triples collide", () => {
    const a = extractZaloEvent(signed({ message_id: 'a","b', chat: { id: "c" } }))?.eventId;
    const b = extractZaloEvent(signed({ message_id: "a", chat: { id: 'b","c' } }))?.eventId;
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    expect(a).not.toBe(b);
  });

  it("never reads update_id, and a `result`-wrapped body is not a webhook body", () => {
    expect(extractZaloEvent({ update_id: 99, ...signed() })?.eventId).toBe('["m-1","u-7","u-7"]');
    expect(extractZaloEvent({ update_id: 5, ...signed({ message_id: undefined }) })).toBeNull();
    expect(extractZaloEvent({ update_id: 5, result: signed() })).toBeNull();
  });

  it.each([
    ["message_id", { message_id: undefined }],
    ["chat.id", { chat: { chat_type: "PRIVATE" } }],
    ["from.id", { from: { display_name: "An" } }],
    ["empty message_id", { message_id: "" }],
  ])("returns null without %s (fail closed)", (_n, message) => {
    expect(extractZaloEvent(signed(message))).toBeNull();
  });

  it("rejects a numeric id above 2^53 (digits already lost) but keeps the same id as a string", () => {
    const raw = '{"message":{"message_id":9007199254740993,"chat":{"id":"c"},"from":{"id":"u"}}}';
    expect(extractZaloEvent(JSON.parse(raw))).toBeNull();
    expect(extractZaloEvent(signed({ message_id: "9007199254740993" }))?.eventId).toBe(
      '["9007199254740993","u-7","u-7"]',
    );
  });

  it.each([null, "str", 5, [], {}, { message: "x" }])("returns null for %j", (payload) => {
    expect(extractZaloEvent(payload)).toBeNull();
  });

  it("extracts chat_type for the DM detector", () => {
    expect(extractZaloEvent(signed({ chat: { id: "g", chat_type: "GROUP" } }))?.chatType).toBe(
      "GROUP",
    );
  });

  it("keeps non-text events (null text) for the caller to ignore", () => {
    expect(
      extractZaloEvent(signed({ text: undefined, photo: "https://x.test/p.jpg" }))?.text,
    ).toBeNull();
  });
});

describe("DM gate (DD-126 / OD-2: only a 1:1 chat is served)", () => {
  const ev = (chat: Record<string, unknown>) => extractZaloEvent(signed({ chat }))!;

  it.each([
    ["PRIVATE, chat.id == from.id", { id: "u-7", chat_type: "PRIVATE" }, true],
    ["no chat_type, chat.id == from.id", { id: "u-7" }, true],
    ["no chat_type, chat.id != from.id (a group omitting chat_type)", { id: "g-1" }, false],
    ["PRIVATE but chat.id != from.id", { id: "g-1", chat_type: "PRIVATE" }, false],
    ["GROUP", { id: "u-7", chat_type: "GROUP" }, false],
    ["unknown chat_type", { id: "u-7", chat_type: "OA" }, false],
  ])("%s -> DM = %s", (_n, chat, dm) => {
    expect(isDirectZaloChat(ev(chat))).toBe(dm);
  });

  it("processZaloEvent ignores a non-DM before any identity, DB or Zalo call", async () => {
    const bot = {
      botId: "b",
      tenantId: "t",
      status: "active",
      webhookSecretEnc: null,
      keyVersion: null,
      locale: "vi",
    } as const;
    // An empty handle: any DB/identity/Zalo step would throw instead of returning "ignored".
    const run = (chat: Record<string, unknown>) =>
      processZaloEvent({ handle: {} as DbHandle, bot, event: ev(chat) });
    await expect(run({ id: "g-1" })).resolves.toBe("ignored");
    await expect(run({ id: "u-7", chat_type: "GROUP" })).resolves.toBe("ignored");
  });
});

describe("classifyProcessingError", () => {
  it("maps Zalo API, identity scope conflict and unknown errors to stable codes", () => {
    expect(classifyProcessingError(new ZaloApiError("timeout"))).toBe("ZALO_TIMEOUT");
    expect(
      classifyProcessingError(Object.assign(new Error("x"), { cause: { code: "23000" } })),
    ).toBe("IDENTITY_SCOPE_CONFLICT");
    expect(classifyProcessingError(new Error("secret detail"))).toBe("PROCESSING_ERROR");
  });
});
