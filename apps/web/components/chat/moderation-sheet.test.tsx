import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { describeChatError } from "../../lib/chat-error-ui";
import { LangProvider } from "../../lib/i18n-client";
import { createCommandIdKeeper } from "../../lib/use-command-id";
import {
  ModerationSheet,
  moderationNotice,
  submitModeration,
  validateModeration,
} from "./moderation-sheet";

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

const [noop, send] = [vi.fn(), async () => null];
const sheet = (action: "hide" | "restore") =>
  renderToStaticMarkup(
    <LangProvider lang="en">
      <ModerationSheet action={action} open onModerate={send} onDone={noop} onCancel={noop} />
    </LangProvider>,
  );

describe("ModerationSheet markup (DM-7, DM-9)", () => {
  it.each([
    ["hide", "Hide this message?", "Hide"],
    ["restore", "Restore this message?", "Restore"],
  ] as const)(
    "%s: its title and confirm, five reasons (first checked), no note, no alert",
    (action, title, ok) => {
      const out = sheet(action);
      expect([out.includes(`>${title}</h2>`), out.includes(`>${ok}</button>`)]).toEqual([
        true,
        true,
      ]);
      expect([...out.matchAll(/type="radio"[^>]*>([^<]+)</g)].map((m) => m[1])).toEqual([
        "Spam",
        "Harassment",
        "Unsafe content",
        "Off topic",
        "Other",
      ]);
      expect(out.match(/<input[^>]*checked=""[^>]*>/g)).toEqual([
        expect.stringContaining('value="spam"'),
      ]);
      expect(out).toContain("<legend>Reason (required)</legend>");
      expect(out).not.toMatch(/Note \(required\)|role="alert"/); // the note is for Other only
    },
  );

  it("an error renders one role=alert carrying the row's copy; empty copy, nothing", () => {
    const out = renderToStaticMarkup(<>{moderationNotice(RATE.message)}</>);
    expect(out.match(/role="alert"/g)).toHaveLength(1);
    expect(out).toContain("You are going too fast. Please try again in a moment.");
    expect(moderationNotice("")).toBeNull();
  });

  it("the source has no console call, storage, cache or analytics (section 8)", () => {
    const source = readFileSync(new URL("./moderation-sheet.tsx", import.meta.url), "utf8");
    expect(source).not.toMatch(
      /console\.|localStorage|sessionStorage|indexedDB|caches\.|analytics/i,
    );
  });
});
