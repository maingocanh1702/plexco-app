import { t } from "@plexco/core/i18n";

/**
 * Zalo bot command router: pure parse + reply builders. The caller (process-event.ts) owns identity
 * resolution, link-code issuing and sending; this module only decides WHAT to say, so it is trivially
 * testable and has no I/O.
 *
 * Scope M3a: /start, /me, /link. /join, /pay, /leave and bare number replies are M9 ("coming soon").
 * `/link <code>` (consume a code on the bot side) is NOT here: consuming is lane M3b.
 * Replies are rendered with t(vi, en); the caller wraps this in runWithLang(bot locale) (DD-118).
 */
export type ZaloCommandKind = "start" | "me" | "link" | "coming_soon" | "unknown";

export interface ParsedZaloCommand {
  kind: ZaloCommandKind;
  name: string;
  args: string[];
}

const COMING_SOON = new Set(["join", "pay", "leave"]);
const MAX_TEXT = 500;

export function parseZaloCommand(text: string): ParsedZaloCommand {
  const parts = text.trim().slice(0, MAX_TEXT).split(/\s+/).filter(Boolean);
  const first = (parts[0] ?? "").toLowerCase();
  const args = parts.slice(1);
  if (/^\d{1,3}$/.test(first)) return { kind: "coming_soon", name: "number", args: [] };
  // Zalo has no BotFather-style suffix; accept `/cmd` and bare `cmd`, drop a trailing `@botname`.
  const name = first.replace(/^\//, "").split("@")[0] ?? "";
  if (name === "start") return { kind: "start", name, args };
  if (name === "me") return { kind: "me", name, args };
  if (name === "link")
    return args.length === 0
      ? { kind: "link", name, args }
      : { kind: "coming_soon", name: "link_code", args: [] };
  if (COMING_SOON.has(name)) return { kind: "coming_soon", name, args };
  return { kind: "unknown", name, args };
}

export type LinkIssueResult =
  | { ok: true; code: string; ttlMinutes: number }
  | { ok: false; reason: "cooldown" | "unavailable" };

export interface ZaloReplyDeps {
  displayName: string | null;
  hasAccount: boolean;
  issueLinkCode: () => Promise<LinkIssueResult>;
}

const helpText = () =>
  t(
    "Lệnh có sẵn:\n/me - xem thông tin của bạn\n/link - liên kết tài khoản Plexco",
    "Available commands:\n/me - see your info\n/link - link your Plexco account",
  );

export async function buildZaloReply(cmd: ParsedZaloCommand, deps: ZaloReplyDeps): Promise<string> {
  switch (cmd.kind) {
    case "start":
      return `${t("Chào mừng bạn đến với CLB!", "Welcome to the club!")}\n${helpText()}`;
    case "me": {
      const who = deps.displayName ?? t("bạn", "you");
      return deps.hasAccount
        ? t(`${who}: đã liên kết tài khoản Plexco.`, `${who}: Plexco account linked.`)
        : t(
            `${who}: chưa liên kết tài khoản Plexco - gõ /link để liên kết.`,
            `${who}: no Plexco account linked yet - type /link to link one.`,
          );
    }
    case "link": {
      const r = await deps.issueLinkCode();
      if (!r.ok) {
        return r.reason === "cooldown"
          ? t(
              "Bạn vừa yêu cầu mã. Vui lòng đợi một chút rồi thử lại.",
              "You just requested a code. Please wait a moment and try again.",
            )
          : t("Tính năng liên kết tạm thời không khả dụng.", "Linking is temporarily unavailable.");
      }
      return t(
        `Mã liên kết của bạn: ${r.code}\nCó hiệu lực ${r.ttlMinutes} phút. Nhập mã này trong Cài đặt trên web Plexco để liên kết.`,
        `Your link code: ${r.code}\nValid for ${r.ttlMinutes} minutes. Enter it in Settings on the Plexco web app to link.`,
      );
    }
    case "coming_soon":
      return t("Tính năng này sắp có.", "This feature is coming soon.");
    case "unknown":
      return `${t("Mình chưa hiểu lệnh này.", "I did not understand that command.")}\n${helpText()}`;
  }
}
