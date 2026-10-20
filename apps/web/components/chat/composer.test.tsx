import type { ChatChannelDto } from "@plexco/core";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LangProvider } from "../../lib/i18n-client";
import type { ChatListError, PendingMessage } from "../../lib/use-chat";
import { canSend, Composer } from "./composer";

type Policy = ChatChannelDto["postPolicy"];
const err = (code: string, retry: boolean, message = `copy ${code}`) =>
  ({ message, retry, code }) as ChatListError;
const ID = "c0ffee00-0000-4000-8000-000000000001";
const row = (failed: ChatListError | null = null): PendingMessage => ({
  clientMsgId: ID,
  body: "hello",
  failed,
});
const render = (pending: PendingMessage[] = [], policy: Policy = "all_members", can?: boolean) => {
  const no = () => {};
  const outbox = { pending, send: no, retry: no, discard: no };
  return renderToStaticMarkup(
    <LangProvider lang="en">
      <Composer postPolicy={policy} canPostRestricted={can} outbox={outbox} />
    </LangProvider>,
  );
};
const text = (html: string) => html.replace(/(?:<[^>]+>|\s)+/g, " ").trim();
const li = (html: string) => text(html.match(/<li\b[^>]*>(.*?)<\/li>/)?.[1] ?? "");
const buttons = (html: string) =>
  [...html.matchAll(/<button\b[^>]*>(.*?)<\/button>/g)].map((m) => text(m[1] ?? ""));
const sendOff = (html: string) => /<button\b[^>]*\bdisabled=""[^>]*>Send</.test(html);
const fieldOff = (html: string) => /<textarea\b[^>]*\bdisabled=""/.test(html);

describe("Composer", () => {
  it.each([
    ["", false],
    ["  ", false],
    ["\n\t", false],
    ["hi", true],
  ])("canSend(%j) is %j", (body, ok) => expect(canSend(body)).toBe(ok));

  it("caps the body at 4000 code points: counter, over class, disabled Send", () => {
    expect([4000, 4001].map((n) => canSend("x".repeat(n)))).toEqual([true, false]);
    expect(canSend(String.fromCodePoint(0x1f600).repeat(4000))).toBe(true); // 2 UTF-16 units each
    expect(render()).toMatch(/<p\b[^>]*>0\/4000<\/p>/);
    expect(render()).not.toMatch(/<p\b[^>]*over/);
    const html = render([{ ...row(err("INVALID_BODY", false)), body: "x".repeat(4001) }]); // refills the field
    expect(html).toMatch(/<p\b[^>]*over[^>]*>4001\/4000<\/p>/);
    expect(sendOff(html)).toBe(true);
  });

  it.each<[Policy, boolean]>([
    ["all_members", false],
    ["admins_only", true],
  ])("%s: the form always renders, the DF-5 hint only for admins_only", (policy, hint) => {
    const html = render([], policy);
    expect(html).toMatch(/<label[^>]*>Message<\/label>/);
    expect(html).toMatch(/<textarea\b(?![^>]*placeholder)/);
    expect(html.includes("Only admins can post in this channel")).toBe(hint);
    expect([buttons(html), sendOff(html)]).toEqual([["Send"], true]);
  });

  // D7: an INVALID_BODY row refills the draft, so the lock (not an empty field) decides the field and Send.
  it.each<[Policy, boolean, boolean]>([
    ["admins_only", false, true],
    ["admins_only", true, false],
    ["all_members", false, false],
  ])("%s with canPostRestricted %s: field and Send disabled = %j", (policy, can, locked) => {
    const html = render([row(err("INVALID_BODY", false))], policy, can);
    expect(/<textarea[^>]*>hello<\/textarea>/.test(html)).toBe(true);
    expect([fieldOff(html), sendOff(html)]).toEqual([locked, locked]);
    expect(html.includes("Only admins can post in this channel")).toBe(policy === "admins_only");
  });

  it("a stale true: 403 CHAT_CAPABILITY_REQUIRED keeps the fail-closed row, no Retry", () => {
    const html = render([row(err("CHAT_CAPABILITY_REQUIRED", false))], "admins_only", true);
    expect(li(html)).toBe("hello Not sent. copy CHAT_CAPABILITY_REQUIRED Discard");
    expect(buttons(html)).toEqual(["Discard", "Send"]);
  });

  it("shows a pending entry as Sending... with no control of its own", () => {
    const html = render([row()]);
    expect([li(html), buttons(html)]).toEqual(["hello Sending...", ["Send"]]);
  });

  it.each<[string, boolean, string[]]>([
    ["CHAT_RATE_LIMITED", true, ["Retry", "Discard"]],
    ["CHAT_CAPABILITY_REQUIRED", false, ["Discard"]],
    ["CHAT_MESSAGE_TOO_LARGE", false, ["Discard"]],
  ])("failed %s offers %j", (code, retry, shown) => {
    const html = render([row(err(code, retry))]);
    expect(li(html)).toBe(["hello Not sent.", `copy ${code}`, ...shown].join(" "));
    expect(buttons(html)).toEqual([...shown, "Send"]);
    expect(html).not.toMatch(/="[^"]*hello[^"]*"|c0ffee/); // no body, no clientMsgId in an attribute
  });

  it("does not repeat Not sent. when the row's own copy is that text", () => {
    const html = render([row(err("CLIENT_NETWORK_ERROR", true, "Not sent."))]);
    expect(li(html)).toBe("hello Not sent. Retry Discard");
  });

  it.each([
    ["CHAT_MESSAGE_TOO_LARGE", false, true],
    ["INVALID_BODY", false, true],
    ["CHAT_RATE_LIMITED", true, false],
    ["CHAT_CAPABILITY_REQUIRED", false, false],
  ])(
    "%s: draft back in the field = %j (the row keeps the text either way)",
    (code, retry, back) => {
      const html = render([row(err(code, retry))]);
      expect(/<textarea[^>]*>hello<\/textarea>/.test(html)).toBe(back);
      expect([sendOff(html), li(html).startsWith("hello Not sent.")]).toEqual([!back, true]);
    },
  );
});
