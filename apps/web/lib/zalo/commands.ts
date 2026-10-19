import { t } from "@plexco/core/i18n";

/**
 * Zalo bot command router: pure parse + reply builders. The caller (process-event.ts) owns identity
 * resolution, link-code issuing and sending; this module only decides WHAT to say, so it is trivially
 * testable and has no I/O.
 *
 * Scope: /start, /me, /link. The M9 kinds join, leave, pay and number are parsed here and answered
 * by player-commands.ts. `/link <code>` (consume a code on the bot side) is NOT here: lane M3b.
 * Replies are rendered with t(vi, en); the caller wraps this in runWithLang(bot locale) (DD-118).
 */
export type ZaloCommandKind =
  "start" | "me" | "link" | "link_code" | "join" | "leave" | "pay" | "number" | "unknown";

export interface ParsedZaloCommand {
  kind: ZaloCommandKind;
  name: string;
  args: string[];
}

const MAX_TEXT = 500;

export function parseZaloCommand(text: string): ParsedZaloCommand {
  const parts = text.trim().slice(0, MAX_TEXT).split(/\s+/).filter(Boolean);
  const first = (parts[0] ?? "").toLowerCase();
  const args = parts.slice(1);
  // P-5: the whole message is one ASCII number token; its range is checked against the context.
  if (parts.length === 1 && /^[0-9]{1,3}$/.test(first)) {
    return { kind: "number", name: "number", args: [first] };
  }
  // Zalo has no BotFather-style suffix; accept `/cmd` and bare `cmd`, drop a trailing `@botname`.
  const name = first.replace(/^\//, "").split("@")[0] ?? "";
  if (name === "start") return { kind: "start", name, args };
  if (name === "me") return { kind: "me", name, args };
  if (name === "link") {
    // `/link <code>`: consuming a code is a WEB action (Settings), never a bot command.
    return args.length === 0 ? { kind: "link", name, args } : { kind: "link_code", name, args: [] };
  }
  // P-4: arguments are never parsed, echoed or logged, so they are dropped here.
  if (name === "join" || name === "leave" || name === "pay") return { kind: name, name, args: [] };
  return { kind: "unknown", name, args };
}

export type LinkIssueResult =
  | { ok: true; code: string; ttlMinutes: number }
  | { ok: false; reason: "cooldown" | "unavailable" };

export interface ZaloReplyDeps {
  displayName: string | null;
  hasAccount: boolean;
  /** true only for a 1:1 chat (chat id == sender id). A bearer code or personal info must never go to a group. */
  isDirect: boolean;
  issueLinkCode: () => Promise<LinkIssueResult>;
}

const helpText = () =>
  t(
    "Lệnh có sẵn:\n/me - xem thông tin của bạn\n/link - liên kết tài khoản Plexco\n/join - tham gia buổi chơi\n/leave - rời buổi chơi\n/pay - xem số tiền cần trả",
    "Available commands:\n/me - see your info\n/link - link your Plexco account\n/join - join a session\n/leave - leave a session\n/pay - see what you owe",
  );

export async function buildZaloReply(cmd: ParsedZaloCommand, deps: ZaloReplyDeps): Promise<string> {
  if (!deps.isDirect && (cmd.kind === "link" || cmd.kind === "me")) {
    return cmd.kind === "link"
      ? t(
          "Hãy nhắn riêng cho bot để lấy mã liên kết.",
          "Please message the bot directly to get a link code.",
        )
      : t(
          "Hãy nhắn riêng cho bot để xem thông tin của bạn.",
          "Please message the bot directly to see your info.",
        );
  }
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
    case "link_code":
      return t(
        "Nhập mã liên kết trong Cài đặt trên web Plexco, không gửi cho bot.",
        "Enter the link code in Settings on the Plexco web app, not in this chat.",
      );
    // "unknown"; process-event.ts routes join/leave/pay/number to player-commands.ts (help = fail closed).
    default:
      return `${t("Mình chưa hiểu lệnh này.", "I did not understand that command.")}\n${helpText()}`;
  }
}
