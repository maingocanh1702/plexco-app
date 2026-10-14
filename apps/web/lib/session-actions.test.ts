import { describe, expect, it } from "vitest";
import { allowedActions, blockedReason, isKnownStatus } from "./session-actions";

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

describe("blockedReason", () => {
  const now = Date.parse("2026-10-20T12:00:00Z");
  const past = "2026-10-20T11:00:00Z";
  const future = "2026-10-21T11:00:00Z";
  it("blocks edit and cancel on an open session that already started", () => {
    expect(blockedReason("edit", { status: "open", startsAt: past }, now)).toBe("started");
    expect(blockedReason("cancel", { status: "open", startsAt: past }, now)).toBe("started");
  });
  it("blocks publish on a past-start draft", () => {
    expect(blockedReason("publish", { status: "draft", startsAt: past }, now)).toBe("started");
  });
  it("treats startsAt === now as started (matches the server's <=)", () => {
    expect(
      blockedReason("publish", { status: "draft", startsAt: "2026-10-20T12:00:00Z" }, now),
    ).toBe("started");
  });
  it("never blocks close (no past-guard), a draft edit/discard, or anything in the future", () => {
    expect(blockedReason("close", { status: "open", startsAt: past }, now)).toBeNull();
    expect(blockedReason("edit", { status: "draft", startsAt: past }, now)).toBeNull();
    expect(blockedReason("cancel", { status: "draft", startsAt: past }, now)).toBeNull();
    for (const action of ["edit", "publish", "close", "cancel"] as const) {
      expect(blockedReason(action, { status: "open", startsAt: future }, now)).toBeNull();
      expect(blockedReason(action, { status: "draft", startsAt: future }, now)).toBeNull();
    }
  });
});
