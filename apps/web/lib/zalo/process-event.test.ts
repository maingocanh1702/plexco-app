import { describe, expect, it } from "vitest";
import { classifyProcessingError, extractZaloEvent } from "./process-event";
import { ZaloApiError } from "./client";

describe("extractZaloEvent", () => {
  it("reads a wrapped (`result`) text event", () => {
    expect(
      extractZaloEvent({
        update_id: 5,
        result: {
          event_name: "message.text.received",
          message: { text: "/me", from: { id: 7, display_name: "An" }, chat: { id: "c9" } },
        },
      }),
    ).toEqual({
      eventId: "5",
      fromId: "7",
      chatId: "c9",
      text: "/me",
      displayName: "An",
    });
  });

  it("reads a flat event and falls back to message_id for the event id", () => {
    const e = extractZaloEvent({
      message: { message_id: "m-1", text: "x", from: { id: "u" }, chat: { id: "c" } },
    });
    expect(e?.eventId).toBe("m-1");
  });

  it("rejects a numeric id above 2^53 (digits already lost) but keeps the same id as a string", () => {
    expect(extractZaloEvent(JSON.parse('{"update_id": 9007199254740993}'))).toBeNull();
    expect(extractZaloEvent({ update_id: "9007199254740993" })?.eventId).toBe("9007199254740993");
  });

  it.each([null, "str", 5, [], {}, { update_id: "" }, { update_id: "x".repeat(201) }])(
    "returns null without an usable event id: %j",
    (payload) => {
      expect(extractZaloEvent(payload)).toBeNull();
    },
  );

  it("keeps non-text events (null text) for the caller to ignore", () => {
    expect(extractZaloEvent({ update_id: 1, result: { message: {} } })?.text).toBeNull();
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
