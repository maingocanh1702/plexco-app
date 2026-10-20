import type { ChatLiveMessageDto as Live, ChatTombstoneDto as Gone } from "@plexco/core";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { describeChatError } from "../../lib/chat-error-ui";
import { LangProvider } from "../../lib/i18n-client";
import type { ChatListError } from "../../lib/use-chat";
import { useTenantContext } from "../../lib/use-tenant-context";
import { afterEdit, type RowActions } from "./message-actions";
import { MessageList } from "./message-list";

vi.mock("../../lib/use-tenant-context", () => ({ useTenantContext: vi.fn() }));

const NOW = "2026-10-20T11:30:00.000Z"; // 18:30 in Asia/Ho_Chi_Minh, 11:30 in UTC
const live = (id: string, o: Partial<Live> = {}): Live => ({
  ...{ id, channelId: "c", authorType: "person", mine: false, authorLabel: "Ann" },
  ...{ body: `msg:${id}`, replyToMessageId: null, editedAt: null, editCount: 0 },
  ...{ tombstone: null, createdAt: NOW, ...o },
});
const gone = (id: string, tombstone: Gone["tombstone"] = "author_deleted"): Gone => ({
  ...{ id, channelId: "c", createdAt: NOW, tombstone },
});
const render = (
  props: Partial<Parameters<typeof MessageList>[0]>,
  timezone = "Asia/Ho_Chi_Minh",
) => {
  vi.mocked(useTenantContext).mockReturnValue({ timezone } as ReturnType<typeof useTenantContext>);
  const base = {
    tenantId: "t",
    messages: [],
    hasOlder: false,
    onLoadOlder: () => {},
    olderError: null,
  };
  return renderToStaticMarkup(
    <LangProvider lang="en">
      <MessageList {...base} {...props} />
    </LangProvider>,
  );
};
const text = (html: string) => html.replace(/(?:<[^>]+>|\s)+/g, " ").trim();
// one text per <li>, the formatted time collapsed to "@"
const rows = (html: string) =>
  [...html.matchAll(/<li\b[^>]*>(.*?)<\/li>/g)].map((m) =>
    text(m[1] ?? "").replace(/\S+ \d\d\/\d\d\/\d{4} \d\d:\d\d/, "@"),
  );

describe("MessageList", () => {
  const bob = { authorLabel: "Bob" };
  const removed = ["Message removed.", "Message removed."];
  it.each<[string, (Live | Gone)[], string[]]>([
    [
      "shows the exact reverse of the server order, never sorted by createdAt",
      ["09:00:00Z", "12:00:00Z", "10:00:00Z"].map((hm, i) =>
        live(`${3 - i}`, { createdAt: `2026-10-20T${hm}` }),
      ),
      ["Ann @ msg:1", "Ann @ msg:2", "Ann @ msg:3"],
    ],
    [
      "shows only the removed text for both tombstone kinds",
      [gone("2", "moderation_hidden"), gone("1")],
      removed,
    ],
    [
      "adds the edited label after the time",
      [live("1", { editedAt: NOW })],
      ["Ann @ (edited) msg:1"],
    ],
    ["hides an unparseable time", [live("1", { createdAt: "not-a-date" })], ["Ann msg:1"]],
    [
      "uses the DF-1 label for every author kind",
      [
        live("5", { authorLabel: null }),
        live("4", { authorType: "assistant", authorLabel: null }),
        live("3", { authorType: "system", authorLabel: null }),
        live("2", { mine: true }),
        live("1"),
      ],
      ["Ann @ msg:1", "You @ msg:2", "System @ msg:3", "Assistant @ msg:4", "Member @ msg:5"],
    ],
    [
      "quotes label and body of a loaded reply target",
      [live("2", { ...bob, replyToMessageId: "1" }), live("1")],
      ["Ann @ msg:1", "Bob @ Ann msg:1 msg:2"],
    ],
    [
      "marks a reply whose target is not loaded",
      [live("2", { ...bob, replyToMessageId: "9" })],
      ["Bob @ Reply to a message msg:2"],
    ],
    [
      "quotes the removed text for a tombstoned reply target",
      [live("2", { ...bob, replyToMessageId: "1" }), gone("1")],
      ["Message removed.", "Bob @ Message removed. msg:2"],
    ],
  ])("%s", (_name, messages, expected) => {
    expect(rows(render({ messages }))).toEqual(expected);
  });

  it.each([
    ["Asia/Ho_Chi_Minh", "18:30"],
    ["UTC", "11:30"],
  ])("shows the time in the club zone %s", (zone, shown) => {
    expect(text(render({ messages: [live("1")] }, zone))).toContain(shown);
  });

  it("keeps a right-to-left label with a bidi override inside its own bdi", () => {
    const label = `${String.fromCodePoint(0x645, 0x62d, 0x645, 0x62f)}${String.fromCodePoint(0x202e)}x`;
    const html = render({ messages: [live("1", { authorLabel: label })] });
    expect(html.match(/<bdi[^>]*>(.*?)<\/bdi>/)?.[1]).toBe(label);
    expect(rows(html)).toEqual([`${label} @ msg:1`]);
  });

  it("offers the older control only while hasOlder; nothing else is clickable", () => {
    const olderError = { message: "copy X", retry: true, code: "X" } as ChatListError;
    const on = render({ hasOlder: true, olderError, messages: [live("1"), gone("2")] });
    expect(on.match(/<button\b[^>]*>(.*?)<\/button>/g)?.map(text)).toEqual(["Show older messages"]);
    expect(text(on)).toContain("copy X");
    expect(on.indexOf("<button")).toBeLessThan(on.indexOf("<ol"));
    const off = render({ olderError, messages: [live("1", { replyToMessageId: "9" }), gone("2")] });
    expect(off).not.toMatch(/<(button|a|input|textarea|select)\b|copy X/);
    expect(off).toMatch(/role="log"[^>]*><ol/);
    expect(off.match(/<[^>]+>/g)?.join("")).not.toMatch(/msg:|Ann|="[129]"/);
  });
});

describe("MessageList row actions", () => {
  const actions: RowActions = {
    onReply() {},
    onEdit: async () => null,
    onRemove: async () => null,
  };
  const dialog = /<dialog\b.*?<\/dialog>/g; // closed, one per own live row
  // the buttons of each row, the closed delete dialog's own two left out
  const controls = (html: string) =>
    [...html.matchAll(/<li\b[^>]*>(.*?)<\/li>/g)].map(
      (m) =>
        (m[1] ?? "")
          .replace(dialog, "")
          .match(/<button\b[^>]*>(.*?)<\/button>/g)
          ?.map(text) ?? [],
    );
  const mine = live("2", { mine: true });
  it.each<[string, (Live | Gone)[], string[][]]>([
    [
      "member: Edit and Delete only on own, Reply on live rows, none on a tombstone",
      [gone("3"), mine, live("1")],
      [["Reply"], ["Edit", "Delete", "Reply"], []],
    ],
    [
      "host-shaped: no hide or restore, a moderation tombstone stays inert (RO-L16-1)",
      [gone("4", "moderation_hidden"), mine, live("1")],
      [["Reply"], ["Edit", "Delete", "Reply"], []],
    ],
  ])("%s", (_name, messages, expected) => {
    const html = render({ messages, actions });
    expect(controls(html)).toEqual(expected);
    expect(html).not.toMatch(/hide|restore/i);
  });

  it("puts one closed delete dialog on the own live row only", () => {
    const html = render({ messages: [mine, live("1"), gone("3")], actions });
    expect(html.match(dialog)?.map(text)).toEqual(["Delete this message? Go back Delete"]);
    expect(html).not.toMatch(/<dialog\b[^>]*\bopen\b/);
  });

  const en = (_vi: string, e: string) => e;
  it.each<[string, number, string, boolean, boolean]>([
    ["CHAT_EDIT_WINDOW_CLOSED", 409, "This message can no longer be edited.", true, true],
    ["CHAT_EDIT_CONFLICT", 409, "This message changed; the latest version is shown.", true, false],
    ["INVALID_BODY", 400, "", false, false],
    ["ANY_OTHER", 500, "Something went wrong. Please try again.", false, false],
  ])(
    "an edit answered %s shows its 5.2.3 copy (closes %s, Edit hidden %s)",
    (code, status, copy, close, shut) => {
      const row = { ...describeChatError("edit", { code, status }, en), code };
      expect(afterEdit(row)).toEqual({ message: copy || row.message, close, shut });
    },
  );
});
