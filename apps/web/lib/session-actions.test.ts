import { describe, expect, it } from "vitest";
import { allowedActions, editBlockedReason, isKnownStatus } from "./session-actions";

describe("allowedActions", () => {
  it("draft: edit, publish, cancel", () => {
    expect(allowedActions("draft")).toEqual(["edit", "publish", "cancel"]);
  });
  it("open: edit, close, cancel", () => {
    expect(allowedActions("open")).toEqual(["edit", "close", "cancel"]);
  });
  it("closed and cancelled are view-only", () => {
    expect(allowedActions("closed")).toEqual([]);
    expect(allowedActions("cancelled")).toEqual([]);
  });
  it("an unknown status fails closed to no actions", () => {
    expect(allowedActions("archived")).toEqual([]);
    expect(isKnownStatus("archived")).toBe(false);
    expect(isKnownStatus("open")).toBe(true);
  });
});

describe("editBlockedReason", () => {
  const now = Date.parse("2026-10-20T12:00:00Z");
  it("blocks an open session that already started", () => {
    expect(editBlockedReason({ status: "open", startsAt: "2026-10-20T11:00:00Z" }, now)).toBe(
      "started",
    );
  });
  it("never blocks a draft (past-guard is open-only) or a future open session", () => {
    expect(editBlockedReason({ status: "draft", startsAt: "2026-10-20T11:00:00Z" }, now)).toBeNull();
    expect(editBlockedReason({ status: "open", startsAt: "2026-10-21T11:00:00Z" }, now)).toBeNull();
  });
});
