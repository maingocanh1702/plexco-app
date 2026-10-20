import type { ChatChannelDto as Dto } from "@plexco/core";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { LangProvider } from "../../lib/i18n-client";
import { type ChatListError, useChatChannels } from "../../lib/use-chat";
import { ChannelList } from "./channel-list";

vi.mock("../../lib/use-chat", () => ({ useChatChannels: vi.fn() }));

type Hook = ReturnType<typeof useChatChannels>;
const ready: Hook = { state: "ready", channels: [], error: null, refresh: async () => {} };
const ch = (id: string, title: string, unreadCount = 0, isDefault = false) =>
  ({ id, title, sortOrder: 0, isDefault, postPolicy: "all_members", unreadCount }) as Dto;
const err = (code: string, retry: boolean) =>
  ({ message: `copy ${code}`, retry, code }) as ChatListError;
const render = (hook: Partial<Hook>) => {
  vi.mocked(useChatChannels).mockReturnValue({ ...ready, ...hook });
  return renderToStaticMarkup(
    <LangProvider lang="en">
      <ChannelList tenantId="t1" />
    </LangProvider>,
  );
};
const text = (html: string) => html.replace(/(?:<[^>]+>|\s)+/g, " ").trim();
const controls = (html: string) =>
  [...html.matchAll(/<(a|button)\b[^>]*>(.*?)<\/\1>/g)].map((m) => text(m[2] ?? ""));

describe("ChannelList", () => {
  const one = [ch("a", "Alpha")];
  it.each<[string, Partial<Hook>, string]>([
    ["loading", { state: "loading" }, "Loading…"],
    ["ready", { channels: one }, "Alpha"],
    ["empty", { state: "empty" }, "There are no chat channels you can read."],
    ["error", { state: "error", error: err("TENANT_SUSPENDED", false) }, "copy TENANT_SUSPENDED"],
    ["offline", { state: "offline", channels: one, error: err("OFFLINE", true) }, "Retry Alpha"],
  ])("data-state %s", (state, hook, shown) => {
    const html = render(hook);
    expect(html).toContain(`data-state="${state}"`);
    expect(html).toMatch(/<h1[^>]*>Chat<\/h1>/);
    expect(text(html)).toContain(shown);
  });

  it("keeps server order; badge and DF-8 title per row; title only as a text node", () => {
    const rows: [Dto, string][] = [
      [ch("c2", "Zeta", 7), "Zeta 7 unread"],
      [ch("c1", "Alpha"), "Alpha"],
      [ch("c3", "Kênh chung", 99, true), "General 99 unread"],
      [ch("c4", "Kênh chung", 100), "Kênh chung 100+ unread"],
      [ch("c5", "Đổi tên", 0, true), "Đổi tên"],
    ];
    const html = render({ channels: rows.map(([channel]) => channel) });
    const items = [...html.matchAll(/<li>(.*?)<\/li>/g)].map((m) => text(m[1] ?? ""));
    expect(items).toEqual(rows.map(([, shown]) => shown));
    expect(html).toContain('href="/c/t1/chat/c2"');
    expect(html.split("Zeta")).toHaveLength(2);
  });

  it.each<[string, boolean, string[]]>([
    ["AUTH_REQUIRED", false, ["Sign in again"]],
    ["CHAT_RATE_LIMITED", true, ["Retry"]],
    ["TENANT_SUSPENDED", false, []],
  ])("%s offers only %j", (code, retry, expected) => {
    const html = render({ state: "error", error: err(code, retry) });
    expect(controls(html)).toEqual(expected);
    expect(html.includes('href="/"')).toBe(code === "AUTH_REQUIRED");
  });
});
