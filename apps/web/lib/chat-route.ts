/**
 * Shared gate, error map and codecs of the M10 chat REST routes (readiness 4.1-4.5 in
 * docs/sessions/web-mvp-phase3-readiness-p3-m10-chat-api-live.md). Nothing here logs, and an error
 * body is only a code plus a constant t(vi, en) pair: message text never leaves an authorized GET.
 */
import { isApiErrorCode } from "@plexco/core";
import { getDefaultLang, runWithLang, t, type Lang } from "@plexco/core/i18n";
import {
  ChatCommandError,
  hasLiveMembership,
  withChatActor,
  withTenant,
  type ChatCommandErrorCode,
  type ChatTx,
} from "@plexco/db";

import { err } from "./api-envelope";
import { readBoundedBody } from "./read-bounded-body";
import { actorThrottled, readTenantParam } from "./session-command-route";
import { appDb, csrfOk, currentSession, rateLimited } from "./session-cookies";
import { resolveTenantLang } from "./tenant-lang";

/** D-5: ONE per-person bucket `chat-read:<personId>` for GET channels, GET history and POST read. */
export const CHAT_READ_LIMIT = { bucket: "chat-read", limit: 60, windowSeconds: 60 } as const;
/** D-5: the stream's per-account admission bucket `chat-subscribe:<accountId>`. */
export const CHAT_SUBSCRIBE_LIMIT = {
  bucket: "chat-subscribe",
  limit: 30,
  windowSeconds: 60,
} as const;

/** Above L14's 4000-character cap even when every character is a 12-byte JSON escape pair. */
const MAX_BODY_BYTES = 64 * 1024;
const MAX_CURSOR_CHARS = 256;
// Local copy: session-command-route.ts keeps its UUID_RE unexported.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// D-2's pinned timestamptz-text regex, narrowed with field ranges (fail closed).
const CURSOR_TS_RE =
  /^([1-9]\d{3})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01]) ([01]\d|2[0-3]):[0-5]\d:[0-5]\d(\.\d{1,6})?[+-](0\d|1[0-5])(:[0-5]\d){0,2}$/;

const INVALID_PAIR = ["Dữ liệu không hợp lệ.", "Invalid payload."] as const;
const TOO_LARGE_PAIR = ["Tin nhắn quá dài.", "Message too long."] as const;
const RATE_LIMITED_PAIR = ["Quá nhiều yêu cầu — đợi.", "Too many requests — wait."] as const;

/** The ONE CHAT_FORBIDDEN body for every reason, always in the default language (no oracle). */
export function chatForbidden(): Response {
  return runWithLang(getDefaultLang(), () =>
    err(
      "CHAT_FORBIDDEN",
      t("Bạn không có quyền với kênh chat này.", "Not permitted for this chat."),
      403,
    ),
  );
}

/** Every chat 429 (readiness 4.5), in the ambient language. */
export function chatRateLimited(): Response {
  return err("CHAT_RATE_LIMITED", t(...RATE_LIMITED_PAIR), 429);
}

export function invalidBody(): Response {
  return err("INVALID_BODY", t(...INVALID_PAIR), 400);
}

/** A lowercase uuid or null: path ids and every body id (note 30: a 400, never a DB 500). */
export function uuidOrNull(value: unknown): string | null {
  return typeof value === "string" && UUID_RE.test(value) ? value.toLowerCase() : null;
}

/** D-1 page size: absent -> 50; a plain integer 1..100 -> that number; anything else -> null. */
export function parseChatLimit(raw: string | null): number | null {
  if (raw === null) return 50;
  return /^[1-9]\d{0,2}$/.test(raw) && Number(raw) <= 100 ? Number(raw) : null;
}

export interface ChatCursor {
  createdAt: string;
  id: string;
}

const cursorOf = (text: string): string => `v1.${Buffer.from(text, "utf8").toString("base64url")}`;

/** D-2 keyset cursor; it encodes L14's RAW timestamptz text (microseconds), never the ISO value. */
export function encodeChatCursor(cursor: ChatCursor): string {
  return cursorOf(`${cursor.createdAt}|${cursor.id}`);
}

/** The cursor, or null for anything malformed (a 400, never a 500 from ::timestamptz). */
export function decodeChatCursor(raw: string): ChatCursor | null {
  if (raw.length > MAX_CURSOR_CHARS || !raw.startsWith("v1.")) return null;
  const text = Buffer.from(raw.slice(3), "base64url").toString("utf8");
  // Re-encoding must give the input back: rejects junk characters and non-canonical forms.
  if (cursorOf(text) !== raw) return null;
  const parts = text.split("|");
  const id = parts.length === 2 ? uuidOrNull(parts[1]) : null;
  const createdAt = parts[0] ?? "";
  const m = CURSOR_TS_RE.exec(createdAt);
  if (id === null || m === null) return null;
  // Calendar check: Feb 30 passes the regex, but Date.UTC rolls it over into March.
  const day = Number(m[3]);
  if (new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, day)).getUTCDate() !== day) return null;
  return { createdAt, id };
}

/**
 * Every timestamp a chat route returns (readiness 4.3, amended): L14's timestamptz text as
 * ISO-8601 UTC. An unparseable value throws RangeError: fail closed, never raw Postgres text.
 */
export function toWireTimestamp(text: string): string {
  return new Date(text).toISOString();
}

/** The vi/en pair per mapped code; CHAT_FORBIDDEN and CHAT_SAFETY_BLOCKED use chatForbidden(). */
const CHAT_ERROR_MESSAGES: Partial<Record<ChatCommandErrorCode, readonly [string, string]>> = {
  INVALID_BODY: INVALID_PAIR,
  NOT_FOUND: ["Không tìm thấy tin nhắn.", "Message not found."],
  TENANT_SUSPENDED: ["CLB đang bị tạm ngưng.", "This club is suspended."],
  CHAT_MESSAGE_TOO_LARGE: TOO_LARGE_PAIR,
  CHAT_RATE_LIMITED: RATE_LIMITED_PAIR,
  CHAT_CAPABILITY_REQUIRED: [
    "Chỉ quản trị viên được đăng trong kênh này.",
    "Only admins can post in this channel.",
  ],
  CHAT_IDEMPOTENCY_MISMATCH: [
    "Mã yêu cầu đã được dùng cho nội dung khác.",
    "This request id was already used for different content.",
  ],
  CHAT_REPLY_INVALID: ["Không thể trả lời tin nhắn này.", "Cannot reply to this message."],
  CHAT_EDIT_WINDOW_CLOSED: ["Đã hết thời gian sửa tin nhắn.", "The edit window has closed."],
  CHAT_EDIT_CONFLICT: [
    "Tin nhắn đã được sửa ở nơi khác, hãy tải lại.",
    "The message was edited elsewhere; reload.",
  ],
  CHAT_REASON_INVALID: ["Lý do không hợp lệ.", "Invalid reason."],
  CHAT_MODERATION_FORBIDDEN: ["Bạn không có quyền kiểm duyệt.", "Not permitted to moderate."],
};

/**
 * An L14 outcome as its Response, in the ambient language. Null means "not a known chat outcome":
 * the caller rethrows, a fail-closed 500 (chat-service errors carry only CHAT_DB_ERROR:<SQLSTATE>).
 * CHAT_DUP_MESSAGE is null too: 0063 returns a duplicate as a row, so an error form is a contract gap.
 */
export function mapChatError(e: unknown): Response | null {
  if (!(e instanceof ChatCommandError)) return null;
  if (e.code === "CHAT_FORBIDDEN" || e.code === "CHAT_SAFETY_BLOCKED") return chatForbidden();
  const pair = CHAT_ERROR_MESSAGES[e.code];
  return pair !== undefined && isApiErrorCode(e.code) ? err(e.code, t(...pair), e.status) : null;
}

export interface ChatContext<K extends string = never> {
  tenantId: string;
  /** The cookie person, never a body id. */
  personId: string;
  lang: Lang;
  /** opts.ids, uuid-checked and lowercased. */
  ids: Record<K, string>;
  /** With opts.page: the D-1 limit and the decoded D-2 cursor (null = first page). */
  page: { limit: number; cursor: ChatCursor | null } | null;
  /** With opts.json: the parsed object; a handler reads only its listed fields. */
  body: Record<string, unknown> | null;
}

/**
 * Readiness 4.1 steps 1-7 in order: an enveloped error Response or the trusted context. Every
 * error before the membership check (step 5) stays in the default language (DD-118).
 */
export async function chatGate<K extends string = never>(
  request: Request,
  opts: { ids?: Record<K, string>; page?: true; json?: true; read?: true } = {},
): Promise<Response | ChatContext<K>> {
  const session = await currentSession();
  if (!session) return err("AUTH_REQUIRED", t("Chưa đăng nhập.", "Not signed in."), 401);
  if (request.method !== "GET" && !csrfOk(request, session)) {
    return err("CSRF_INVALID", t("Yêu cầu không hợp lệ.", "Invalid request."), 403);
  }
  const tenantId = readTenantParam(request);
  if (tenantId === null) {
    return err("INVALID_BODY", t("Thiếu hoặc sai mã CLB.", "Missing or invalid club id."), 400);
  }
  const ids = {} as Record<K, string>;
  for (const [key, raw] of Object.entries(opts.ids ?? {}) as [K, string][]) {
    const id = uuidOrNull(raw);
    if (id === null) return invalidBody();
    ids[key] = id;
  }
  let page: ChatContext<K>["page"] = null;
  if (opts.page) {
    const params = new URL(request.url).searchParams;
    const limit = parseChatLimit(params.get("limit"));
    const rawCursor = params.get("cursor");
    const cursor = rawCursor === null ? null : decodeChatCursor(rawCursor);
    if (limit === null || (rawCursor !== null && cursor === null)) return invalidBody();
    page = { limit, cursor };
  }
  if (await actorThrottled(session.accountId)) return chatRateLimited();
  const personId = session.personId;
  const member = await withTenant(appDb().db, tenantId, (tx) =>
    hasLiveMembership(tx, tenantId, personId),
  );
  if (!member) return chatForbidden();
  const lang = await resolveTenantLang(appDb().db, tenantId);
  return runWithLang(lang, async (): Promise<Response | ChatContext<K>> => {
    const { bucket, limit, windowSeconds } = CHAT_READ_LIMIT;
    if (opts.read && (await rateLimited(`${bucket}:${personId}`, limit, windowSeconds))) {
      return chatRateLimited();
    }
    let body: Record<string, unknown> | null = null;
    if (opts.json) {
      const read = await readBoundedBody(request, MAX_BODY_BYTES);
      if (!read.ok) {
        return read.reason === "too_large"
          ? err("CHAT_MESSAGE_TOO_LARGE", t(...TOO_LARGE_PAIR), 413)
          : invalidBody();
      }
      let raw: unknown;
      try {
        raw = JSON.parse(read.text);
      } catch {
        return invalidBody(); // never bind, log or rethrow: V8 quotes the input in the message
      }
      if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return invalidBody();
      body = raw as Record<string, unknown>;
    }
    return { tenantId, personId, lang, ids, page, body };
  });
}

/** Step 8: one L14 call as the chat actor; a mapped outcome is its Response, anything else rethrows. */
export function runChat(
  ctx: { tenantId: string; personId: string; lang: Lang },
  fn: (tx: ChatTx) => Promise<Response>,
): Promise<Response> {
  return runWithLang(ctx.lang, async () => {
    try {
      return await withChatActor(
        appDb().db,
        { tenantId: ctx.tenantId, personId: ctx.personId },
        fn,
      );
    } catch (e) {
      const mapped = mapChatError(e);
      if (mapped === null) throw e;
      return mapped;
    }
  });
}
