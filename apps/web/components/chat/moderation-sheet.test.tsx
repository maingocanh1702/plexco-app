import { describe, expect, it, vi } from "vitest";
import { describeChatError } from "../../lib/chat-error-ui";
import { createCommandIdKeeper } from "../../lib/use-command-id";
import { submitModeration, validateModeration } from "./moderation-sheet";

describe("validateModeration (D10, DM-9)", () => {
  it.each(["", " ", "\n\t "])("other with the note %j is blank", (note) =>
    expect(validateModeration("other", note)).toEqual({ ok: false, problem: "blank" }),
  );

  // "đ" is 2 bytes in 1 UTF-16 unit, so 251 of them (251 characters) are over the 500-byte bound
  it.each([
    [500, "đ".repeat(250), true],
    [501, "đ".repeat(249) + "abc", false],
    [502, "đ".repeat(251), false],
  ])("other: a note of %i bytes (not characters)", (bytes, note, ok) => {
    expect(new TextEncoder().encode(note).length).toBe(bytes);
    const got = validateModeration("other", ` ${note}\n`); // the trimmed note is measured and sent
    expect(got).toMatchObject(ok ? { ok, reasonNote: note } : { ok, problem: "too_long" });
  });

  it.each(["spam", "harassment", "unsafe", "off_topic"] as const)("%s: a null note", (r) => {
    const got = ["", " ", "stale"].map((note) => validateModeration(r, note));
    expect(got).toEqual(Array(3).fill({ ok: true, reasonCode: r, reasonNote: null }));
  });
});

// the failure row use-chat's failure() builds for a 429: describeChatError's row plus the code
const code = "CHAT_RATE_LIMITED";
const RATE = { ...describeChatError("moderate", { code, status: 429 }, (_vi, en) => en), code };

describe("submitModeration (D8, DM-6)", () => {
  it("a retry reuses the commandId; a reset (reason or note changed) and a 2xx mint a new one", async () => {
    const keeper = createCommandIdKeeper();
    const [get, settle] = [vi.spyOn(keeper, "get"), vi.spyOn(keeper, "settle")];
    const answers = [RATE, RATE, null, RATE, null];
    const sent: string[] = [];
    const send = async (i: { commandId: string }) => answers[sent.push(i.commandId) - 1] ?? null;
    const run = () =>
      submitModeration(keeper, send, { action: "hide", reasonCode: "spam", reasonNote: null });
    expect([await run(), await run(), await run()]).toEqual([RATE, RATE, null]); // retry, then 200
    await run(); // the next action: a new key, kept by its failure
    keeper.reset(); // the reason or the note changed
    await run();
    expect(sent.map((id) => sent.indexOf(id))).toEqual([0, 0, 0, 3, 4]); // 3 distinct keys
    expect(get.mock.calls).toEqual(Array(5).fill([])); // never a payload: the note is no fingerprint
    expect(settle).not.toHaveBeenCalled(); // a chat failure never settles the key
  });
});
