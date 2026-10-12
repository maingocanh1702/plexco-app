import { runWithLang } from "@plexco/core/i18n";
import { describe, expect, it, vi } from "vitest";
import { buildZaloReply, parseZaloCommand, type ZaloReplyDeps } from "./commands";

const deps = (over: Partial<ZaloReplyDeps> = {}): ZaloReplyDeps => ({
  displayName: "An",
  hasAccount: false,
  issueLinkCode: vi.fn(async () => ({ ok: true as const, code: "ABCD-EFGH", ttlMinutes: 10 })),
  ...over,
});

describe("parseZaloCommand", () => {
  it.each([
    ["/start", "start"],
    ["  /START  ", "start"],
    ["/me", "me"],
    ["me", "me"],
    ["/link", "link"],
    ["/me@PlexcoBot", "me"],
    ["/join", "coming_soon"],
    ["/pay", "coming_soon"],
    ["/leave", "coming_soon"],
    ["2", "coming_soon"],
    ["/link ABCD-EFGH", "coming_soon"],
    ["hello there", "unknown"],
    ["", "unknown"],
    ["/frobnicate", "unknown"],
  ])("%j -> %s", (text, kind) => {
    expect(parseZaloCommand(text).kind).toBe(kind);
  });

  it("is bounded: a huge message never produces a huge arg list", () => {
    expect(parseZaloCommand("/x " + "a ".repeat(100_000)).args.length).toBeLessThan(300);
  });
});

describe("buildZaloReply", () => {
  it("/start welcomes and lists commands, in the club language", async () => {
    const vi_ = await runWithLang("vi", () => buildZaloReply(parseZaloCommand("/start"), deps()));
    const en = await runWithLang("en", () => buildZaloReply(parseZaloCommand("/start"), deps()));
    expect(vi_).toContain("Chào mừng");
    expect(en).toContain("Welcome");
    expect(en).toContain("/link");
  });

  it("/me says not linked without an account and linked with one", async () => {
    const no = await runWithLang("en", () => buildZaloReply(parseZaloCommand("/me"), deps()));
    expect(no).toContain("no Plexco account linked");
    const yes = await runWithLang("en", () =>
      buildZaloReply(parseZaloCommand("/me"), deps({ hasAccount: true })),
    );
    expect(yes).toContain("Plexco account linked");
  });

  it("/link shows the code, TTL and the web instruction", async () => {
    const r = await runWithLang("vi", () => buildZaloReply(parseZaloCommand("/link"), deps()));
    expect(r).toContain("ABCD-EFGH");
    expect(r).toContain("10 phút");
    expect(r).toContain("Cài đặt");
  });

  it("/link degrades without throwing on cooldown / unavailable", async () => {
    const cd = await runWithLang("en", () =>
      buildZaloReply(
        parseZaloCommand("/link"),
        deps({ issueLinkCode: async () => ({ ok: false, reason: "cooldown" }) }),
      ),
    );
    expect(cd).toContain("wait");
    const un = await runWithLang("vi", () =>
      buildZaloReply(
        parseZaloCommand("/link"),
        deps({ issueLinkCode: async () => ({ ok: false, reason: "unavailable" }) }),
      ),
    );
    expect(un).toContain("tạm thời không khả dụng");
  });

  it("M9 commands and numbers reply coming-soon; unknown shows help", async () => {
    expect(
      await runWithLang("en", () => buildZaloReply(parseZaloCommand("/join"), deps())),
    ).toContain("coming soon");
    expect(
      await runWithLang("en", () => buildZaloReply(parseZaloCommand("xyz"), deps())),
    ).toContain("Available commands");
  });
});
