import type {
  ChatChannelDto,
  ChatLiveMessageDto,
  ChatMessageDto,
  ChatTombstoneDto,
} from "@plexco/core";
import { ApiClientError, CLIENT_BAD_RESPONSE, apiFetch, type ApiFetchInit } from "./api-client";
import { tenantQuery, type SessionApiContext } from "./sessions-api";

/**
 * Typed browser client for the club chat routes (L16): one function per route the UI calls, each
 * through apiFetch with ?tenant=, and every mutation carries the x-csrf-token header.
 *
 * A call never throws. It answers {ok: true, data} or {ok: false, code, status}. `code` is the
 * envelope's error code verbatim (the server's text is dropped: a screen renders its own t(vi, en)
 * per code). Anything that is not a well-formed answer fails closed: a network failure or the 15 s
 * timeout is CLIENT_NETWORK_ERROR (status 0); an unparseable body, a non-envelope answer, a missing
 * or non-string code, or a DTO with an unexpected key or type is CLIENT_BAD_RESPONSE.
 *
 * The DTO guards are exact: a row with any key or type beyond the merged contract rejects the whole
 * answer, and a tombstone is exactly its four keys. A rejected answer carries no row content.
 * One exception: /channels may also carry `viewer` (L15b), read by a later lane and not by L16:
 * every key beside `channels` is dropped unread, and each channel row stays exact.
 * Nothing here logs, stores or caches. Deliberately absent: the stream path (use-chat owns it) and
 * the hide/restore route (RO-L16-1).
 */

const TIMEOUT_MS = 15_000; // P-15: the same give-up time as the player reads

export type ChatResult<T> = { ok: true; data: T } | { ok: false; code: string; status: number };

export interface ChatChannelList {
  channels: ChatChannelDto[];
}
/** Newest first, in the server's order; pass nextCursor back to listHistory as received. */
export interface ChatHistoryPage {
  messages: ChatMessageDto[];
  nextCursor: string | null;
}
export interface ChatSendResult {
  id: string;
  createdAt: string;
  duplicate: boolean;
}
export interface ChatEditResult {
  id: string;
  editCount: number;
  editedAt: string | null;
  changed: boolean;
}
export interface ChatDeleteResult {
  id: string;
  authorDeletedAt: string;
  changed: boolean;
}
export type ChatReadResult = Record<string, never>;

type Check = (value: unknown) => boolean;
/** One check per key of T: the guard needs exactly these keys, so a new DTO key fails the compile. */
type Spec<T> = { [K in keyof T]-?: Check };

const isId: Check = (v) => typeof v === "string" && v !== "";
const isText: Check = (v) => typeof v === "string";
const isBool: Check = (v) => typeof v === "boolean";
const isInt: Check = (v) => Number.isSafeInteger(v);
const isCount: Check = (v) => Number.isSafeInteger(v) && (v as number) >= 0;
const orNull =
  (check: Check): Check =>
  (v) =>
    v === null || check(v);
const oneOf =
  (...allowed: unknown[]): Check =>
  (v) =>
    allowed.includes(v);
const listOf =
  (check: Check): Check =>
  (v) =>
    Array.isArray(v) && v.every((item) => check(item));

/** True when `value` is a plain object with exactly the keys of `spec`, each passing its check. */
function matches<T>(value: unknown, spec: Spec<T>): value is T {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  const checks = Object.entries(spec as Record<string, Check>);
  return (
    Object.keys(row).length === checks.length &&
    checks.every(([key, check]) => key in row && check(row[key]))
  );
}

const CHANNEL: Spec<ChatChannelDto> = {
  id: isId,
  title: isText,
  sortOrder: isInt,
  isDefault: isBool,
  postPolicy: oneOf("all_members", "admins_only"),
  unreadCount: isCount,
};
const LIVE: Spec<ChatLiveMessageDto> = {
  id: isId,
  channelId: isId,
  authorType: oneOf("person", "assistant", "system"),
  mine: isBool,
  authorLabel: orNull(isText),
  body: isText,
  replyToMessageId: orNull(isId),
  editedAt: orNull(isText),
  editCount: isCount,
  tombstone: (v) => v === null,
  createdAt: isText,
};
const TOMBSTONE: Spec<ChatTombstoneDto> = {
  id: isId,
  channelId: isId,
  createdAt: isText,
  tombstone: oneOf("author_deleted", "moderation_hidden"),
};
const isMessage: Check = (v) => matches(v, LIVE) || matches(v, TOMBSTONE);

const CHANNELS: Spec<ChatChannelList> = { channels: listOf((v) => matches(v, CHANNEL)) };
const PAGE: Spec<ChatHistoryPage> = { messages: listOf(isMessage), nextCursor: orNull(isId) };
const SENT: Spec<ChatSendResult> = { id: isId, createdAt: isText, duplicate: isBool };
const EDITED: Spec<ChatEditResult> = {
  id: isId,
  editCount: isCount,
  editedAt: orNull(isText),
  changed: isBool,
};
const DELETED: Spec<ChatDeleteResult> = { id: isId, authorDeletedAt: isText, changed: isBool };
const READ: Spec<ChatReadResult> = {};

async function request<T>(
  spec: Spec<T>,
  path: string,
  init: ApiFetchInit = {},
  narrow: (body: unknown) => unknown = (body) => body,
): Promise<ChatResult<T>> {
  try {
    const raw = await apiFetch<unknown>(path, {
      ...init,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const data = narrow(raw);
    // status 200: the server answered 2xx, but with a body of the wrong shape
    return matches(data, spec)
      ? { ok: true, data }
      : { ok: false, code: CLIENT_BAD_RESPONSE, status: 200 };
  } catch (error) {
    if (!(error instanceof ApiClientError))
      return { ok: false, code: CLIENT_BAD_RESPONSE, status: 0 };
    const { code, statusCode } = error;
    return {
      ok: false,
      code: typeof code === "string" && code !== "" ? code : CLIENT_BAD_RESPONSE,
      status: Number.isInteger(statusCode) ? statusCode : 0,
    };
  }
}

/** A mutation: JSON body when given, ?tenant= and the CSRF token of the caller's session. */
function mutate<T>(
  spec: Spec<T>,
  ctx: SessionApiContext,
  method: string,
  path: string,
  json?: object,
): Promise<ChatResult<T>> {
  return request(spec, `${path}?${tenantQuery(ctx.tenantId)}`, {
    method,
    json,
    csrfToken: ctx.csrfToken,
  });
}

const channelPath = (channelId: string) => `/api/chat/channels/${encodeURIComponent(channelId)}`;
const messagePath = (channelId: string, messageId: string) =>
  `${channelPath(channelId)}/messages/${encodeURIComponent(messageId)}`;

export function listChannels(tenantId: string): Promise<ChatResult<ChatChannelList>> {
  return request(CHANNELS, `/api/chat/channels?${tenantQuery(tenantId)}`, {}, (body) => ({
    channels: (body as { channels?: unknown } | null)?.channels,
  }));
}

/** `cursor` is a previous page's nextCursor, sent as received. No limit is ever sent. */
export function listHistory(
  tenantId: string,
  channelId: string,
  cursor?: string | null,
): Promise<ChatResult<ChatHistoryPage>> {
  const next = cursor == null ? "" : `&cursor=${encodeURIComponent(cursor)}`;
  return request(PAGE, `${channelPath(channelId)}/messages?${tenantQuery(tenantId)}${next}`);
}

/** A retry of a failed send passes the same clientMsgId and the identical body. */
export function sendMessage(
  ctx: SessionApiContext,
  channelId: string,
  input: { clientMsgId: string; body: string; replyToMessageId?: string },
): Promise<ChatResult<ChatSendResult>> {
  const { clientMsgId, body, replyToMessageId } = input;
  return mutate(SENT, ctx, "POST", `${channelPath(channelId)}/messages`, {
    clientMsgId,
    body,
    replyToMessageId,
  });
}

export function editMessage(
  ctx: SessionApiContext,
  channelId: string,
  messageId: string,
  input: { body: string; expectedEditCount: number },
): Promise<ChatResult<ChatEditResult>> {
  const { body, expectedEditCount } = input;
  return mutate(EDITED, ctx, "PATCH", messagePath(channelId, messageId), {
    body,
    expectedEditCount,
  });
}

export function deleteMessage(
  ctx: SessionApiContext,
  channelId: string,
  messageId: string,
): Promise<ChatResult<ChatDeleteResult>> {
  return mutate(DELETED, ctx, "DELETE", messagePath(channelId, messageId));
}

export function markRead(
  ctx: SessionApiContext,
  channelId: string,
  throughMessageId: string,
): Promise<ChatResult<ChatReadResult>> {
  return mutate(READ, ctx, "POST", `${channelPath(channelId)}/read`, { throughMessageId });
}
