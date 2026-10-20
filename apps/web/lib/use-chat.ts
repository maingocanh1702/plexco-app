"use client";

import type { ChatChannelDto, ChatLiveMessageDto, ChatMessageDto } from "@plexco/core";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  deleteMessage,
  editMessage,
  listChannels,
  listHistory,
  markRead,
  sendMessage,
  type ChatChannelList,
  type ChatHistoryPage,
  type ChatResult,
} from "./chat-api";
import {
  describeChatError,
  liveRoundEffect,
  type ChatErrorAction,
  type ChatErrorView,
  type ChatFailure,
} from "./chat-error-ui";
import { useT, type TFn } from "./i18n-client";
import type { SessionApiContext } from "./sessions-api";
import {
  LIVE_PAUSE_MS,
  useRealtime,
  type RealtimeSignal,
  type RealtimeStream,
} from "./use-realtime";
import { useTenantContext } from "./use-tenant-context";

/*
 * Chat client state (L16). Privacy: no console call, no storage and no URL here. Channel titles live
 * in component state only, and a live frame is only a refetch hint, never rendered content.
 */

/** A live frame (readiness 6.2): exactly these three keys, and only ever a hint. */
export interface ChatHint {
  type: "chat.message";
  channelId: string;
  messageId: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Takes the hub's raw SSE data string: exactly {type: "chat.message", channelId, messageId} with lowercase uuid ids, else null. */
function parseChatHint(raw: unknown): ChatHint | null {
  let data: unknown;
  try {
    data = typeof raw === "string" ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) return null;
  if (Object.keys(data).length !== 3) return null;
  const { type, channelId, messageId } = data as Record<string, unknown>;
  if (type !== "chat.message") return null;
  if (typeof channelId !== "string" || !UUID.test(channelId)) return null;
  if (typeof messageId !== "string" || !UUID.test(messageId)) return null;
  return { type, channelId, messageId };
}

/** The chat stream: a module-level constant (the hub keys its source by path). No dedupe: chat frames carry no version. */
export const CHAT_STREAM: RealtimeStream<ChatHint> = {
  path: "/api/chat/subscribe",
  parse: parseChatHint,
};

/** What the next live round must refetch: the hinted channel ids, or every channel after a resync. */
export function createStaleChannels() {
  const ids = new Set<string>();
  let all = false;
  return {
    /** useRealtime's `accept`: a frame only marks its channel, a resync marks all; true so a round follows. */
    accept(signal: RealtimeSignal<ChatHint>): boolean {
      if (signal.kind === "resync") all = true;
      else ids.add(signal.message.channelId);
      return true;
    },
    /** Puts every channel back after a rate-limited round, so the catch-up round refetches. */
    markAll(): void {
      all = true;
    },
    /** Takes the pending marks for one round (null: nothing pending); the round owns them from here. */
    take(): { all: boolean; ids: ReadonlySet<string> } | null {
      if (!all && ids.size === 0) return null;
      const taken = { all, ids: new Set(ids) };
      all = false;
      ids.clear();
      return taken;
    },
  };
}
export type StaleChannels = ReturnType<typeof createStaleChannels>;

export type ChatListState = "loading" | "ready" | "empty" | "error" | "offline";
/** The screen's failure row: describeChatError's view plus the code, so a screen can branch (sign-in link on AUTH_REQUIRED). */
export type ChatListError = ChatErrorView & { code: string };
export interface ChannelsView {
  state: ChatListState;
  channels: ChatChannelDto[];
  error: ChatListError | null;
}
const LOADING: ChannelsView = { state: "loading", channels: [], error: null };

/** One list answer as screen state. A failure clears the list, except offline, which keeps the last one (5.1). */
export function channelsView(
  result: ChatResult<ChatChannelList>,
  t: TFn,
  action: "list" | "list-refetch",
  prev: ChannelsView = LOADING,
): ChannelsView {
  if (result.ok) {
    const { channels } = result.data;
    return { state: channels.length > 0 ? "ready" : "empty", channels, error: null };
  }
  const row = describeChatError(action, result, t);
  const channels = row.state === "offline" ? prev.channels : [];
  return { state: row.state ?? "error", channels, error: { ...row, code: result.code } };
}

export interface ChannelsRoundDeps {
  tenantId: string;
  t: TFn;
  stale: StaleChannels;
  apply(next: ChannelsView): void;
}

/**
 * One live round of the channel list (readiness 5.3): one refetch for everything the hints marked;
 * the hub's 2 s rule spaces the rounds. Resolves true on CHAT_RATE_LIMITED, the hub's silent 30 s
 * pause (the marks go back, so the catch-up refetches; no toast, no message). AUTH_REQUIRED,
 * CHAT_FORBIDDEN and TENANT_SUSPENDED show that code's row, which turns live off in the hook;
 * anything else ends the round with nothing inferred (the next hint or resync retries).
 */
export async function channelsRound({
  tenantId,
  t,
  stale,
  apply,
}: ChannelsRoundDeps): Promise<boolean> {
  if (stale.take() === null) return false;
  const result = await listChannels(tenantId);
  if (result.ok) {
    apply(channelsView(result, t, "list-refetch"));
    return false;
  }
  const effect = liveRoundEffect(result);
  if (effect === "off") apply(channelsView(result, t, "list-refetch"));
  if (effect === "pause") stale.markAll();
  return effect === "pause";
}

const mounted = new Set<{ tenantId: string; refresh(): void }>();

/** Registers a mounted list so refreshChannels(tenantId) reaches it; returns the unregister. */
export function onChannelsRefresh(tenantId: string, refresh: () => void): () => void {
  const entry = { tenantId, refresh };
  mounted.add(entry);
  return () => {
    mounted.delete(entry);
  };
}

/**
 * The read call triggers this after a 200 POST read: the unread counts moved server-side, so every
 * mounted list of the tenant refetches (a list that is not mounted loads fresh when it mounts).
 */
export function refreshChannels(tenantId: string): void {
  for (const entry of mounted) if (entry.tenantId === tenantId) entry.refresh();
}

/**
 * The club's channel list: loads on mount, then follows the live stream. `refresh` is the Retry
 * control and the quiet refetch (no loading flash while a list is showing). Live runs only while
 * the list is shown without an error row, so a refused round stops the stream.
 */
export function useChatChannels(
  tenantId: string,
  { live: follow = true }: { live?: boolean } = {},
): ChannelsView & { refresh(): Promise<void> } {
  const t = useT();
  const [view, setView] = useState<ChannelsView>(LOADING);
  const [stale] = useState(createStaleChannels);
  const epoch = useRef(0); // bumped on unmount and tenant change: a late answer for the old one is dropped
  const latestT = useRef(t);
  useEffect(() => {
    latestT.current = t;
  });

  const refresh = useCallback(async (): Promise<void> => {
    const mine = epoch.current;
    setView((v) => (v.channels.length > 0 || v.state === "empty" ? v : LOADING));
    const result = await listChannels(tenantId);
    const now = latestT.current;
    if (mine === epoch.current) setView((v) => channelsView(result, now, "list", v));
  }, [tenantId]);

  useEffect(() => {
    epoch.current += 1;
    setView(LOADING);
    void refresh();
    const off = onChannelsRefresh(tenantId, () => void refresh());
    return () => {
      off();
      epoch.current += 1;
    };
  }, [tenantId, refresh]);

  const live = follow && (view.state === "ready" || view.state === "empty") && view.error === null;
  useRealtime(
    tenantId,
    live,
    () => {
      const start = epoch.current;
      return channelsRound({
        tenantId,
        t: latestT.current,
        stale,
        apply: (next) => {
          if (start === epoch.current) setView(next);
        },
      });
    },
    stale.accept,
    CHAT_STREAM,
  );
  return { ...view, refresh };
}

/** A send in flight (failed null) or failed; every retry carries the same clientMsgId and body. */
export interface PendingMessage {
  clientMsgId: string;
  body: string;
  replyToMessageId?: string;
  failed: ChatListError | null;
}
export interface ChannelState {
  state: ChatListState;
  messages: ChatMessageDto[]; // server order, newest page first, never re-sorted
  nextCursor: string | null; // the server's opaque cursor, passed back verbatim
  error: ChatListError | null;
  pending: PendingMessage[];
  off: boolean; // a send hit AUTH_REQUIRED, CHAT_FORBIDDEN or TENANT_SUSPENDED: live stays off
}
export type ChannelUpdate = (s: ChannelState) => ChannelState;
/** A finished edit or delete: the state update, its failure row, whether the newest page is refetched. */
export interface Settled {
  update: ChannelUpdate;
  error: ChatListError | null;
  refetch: boolean;
}
const CHANNEL_LOADING: ChannelState = {
  state: "loading",
  messages: [],
  nextCursor: null,
  error: null,
  pending: [],
  off: false,
};
const SAME: ChannelUpdate = (s) => s;
const failure = (action: ChatErrorAction, r: ChatFailure, t: TFn): ChatListError => ({
  ...describeChatError(action, r, t),
  code: r.code,
});

/** One history answer: the newest page joins loaded older pages when they overlap; offline keeps the messages. */
export function historyView(
  result: ChatResult<ChatHistoryPage>,
  t: TFn,
  action: "history" | "history-refetch",
  s: ChannelState,
): ChannelState {
  if (!result.ok) {
    const error = failure(action, result, t);
    const keep = error.state === "offline";
    const [messages, nextCursor] = keep ? [s.messages, s.nextCursor] : [[], null];
    return { ...s, state: error.state ?? "error", messages, nextCursor, error };
  }
  const { messages, nextCursor } = result.data;
  const ids = new Set(messages.map((m) => m.id));
  const rest = s.messages.filter((m) => !ids.has(m.id));
  const joined = rest.length > 0 && rest.length < s.messages.length;
  return {
    ...s,
    state: messages.length > 0 ? "ready" : "empty",
    messages: joined ? [...messages, ...rest] : messages,
    nextCursor: joined ? s.nextCursor : nextCursor,
    error: null,
  };
}

/** An older page appended in server order, loaded ids skipped; an empty page ends the control (D4). */
export function appendOlder(s: ChannelState, page: ChatHistoryPage): ChannelState {
  const have = new Set(s.messages.map((m) => m.id));
  const fresh = page.messages.filter((m) => !have.has(m.id));
  const nextCursor = page.messages.length > 0 ? page.nextCursor : null;
  return { ...s, messages: [...s.messages, ...fresh], nextCursor };
}

export interface ChannelCall {
  ctx: SessionApiContext;
  channelId: string;
  t: TFn;
}

/** One send attempt: success keeps the optimistic copy (no body in the answer), failure keeps the entry. */
export async function sendAttempt({
  ctx,
  channelId,
  entry,
  t,
}: ChannelCall & { entry: PendingMessage }): Promise<ChannelUpdate> {
  const { clientMsgId, body, replyToMessageId } = entry;
  const result = await sendMessage(ctx, channelId, { clientMsgId, body, replyToMessageId });
  if (result.ok) {
    const { id, createdAt } = result.data;
    const row: ChatLiveMessageDto = {
      ...{ id, channelId, authorType: "person", mine: true, authorLabel: null, body },
      ...{ replyToMessageId: replyToMessageId ?? null, editedAt: null, editCount: 0 },
      ...{ tombstone: null, createdAt },
    };
    return (s) => ({
      ...s,
      state: s.state === "empty" ? "ready" : s.state,
      pending: s.pending.filter((p) => p.clientMsgId !== clientMsgId),
      messages: s.messages.some((m) => m.id === id) ? s.messages : [row, ...s.messages],
    });
  }
  const failed = failure("send", result, t);
  const off = liveRoundEffect(result) === "off";
  return (s) => ({
    ...s,
    off: s.off || off,
    pending: s.pending.map((p) => (p.clientMsgId === clientMsgId ? { ...p, failed } : p)),
  });
}

/** One edit: expectedEditCount comes from the loaded row; only a 409 CHAT_EDIT_CONFLICT asks for a refetch. */
export async function editAttempt({
  ctx,
  channelId,
  message,
  body,
  t,
}: ChannelCall & { message: ChatLiveMessageDto; body: string }): Promise<Settled> {
  const expectedEditCount = message.editCount;
  const result = await editMessage(ctx, channelId, message.id, { body, expectedEditCount });
  if (!result.ok) {
    const refetch = result.code === "CHAT_EDIT_CONFLICT" && result.status === 409;
    return { update: SAME, error: failure("edit", result, t), refetch };
  }
  const { editCount, editedAt, changed } = result.data;
  const patch = (m: ChatMessageDto): ChatMessageDto =>
    m.id === message.id && m.tombstone === null
      ? { ...m, body, editCount, editedAt: editedAt ?? m.editedAt }
      : m;
  const update: ChannelUpdate = (s) => ({ ...s, messages: s.messages.map(patch) });
  return { update: changed ? update : SAME, error: null, refetch: false };
}

/** One delete of an own row: a 200 (changed or not) turns the loaded row into a tombstone. */
export async function removeAttempt({
  ctx,
  channelId,
  messageId,
  t,
}: ChannelCall & { messageId: string }): Promise<Settled> {
  const result = await deleteMessage(ctx, channelId, messageId);
  if (!result.ok) return { update: SAME, error: failure("delete", result, t), refetch: false };
  const gone = (m: ChatMessageDto): ChatMessageDto =>
    m.id === messageId
      ? { id: m.id, channelId: m.channelId, createdAt: m.createdAt, tombstone: "author_deleted" }
      : m;
  return { update: (s) => ({ ...s, messages: s.messages.map(gone) }), error: null, refetch: false };
}

export interface ChannelRoundDeps {
  tenantId: string;
  channelId: string;
  t: TFn;
  stale: StaleChannels;
  apply(update: ChannelUpdate): void;
}

/** Refetches the newest page (no cursor); true = CHAT_RATE_LIMITED, the hub's silent pause (marks restored). */
export async function refetchNewest(deps: ChannelRoundDeps): Promise<boolean> {
  const { tenantId, channelId, t, stale, apply } = deps;
  const result = await listHistory(tenantId, channelId);
  const effect = result.ok ? "ok" : liveRoundEffect(result);
  if (effect === "ok" || effect === "off")
    apply((s) => historyView(result, t, "history-refetch", s));
  if (effect === "pause") stale.markAll();
  return effect === "pause";
}

/** One live round: only a mark for this channel (or all) refetches; a frame is a hint, never content. */
export async function channelRound(deps: ChannelRoundDeps): Promise<boolean> {
  const taken = deps.stale.take();
  return taken !== null && (taken.all || taken.ids.has(deps.channelId))
    ? refetchNewest(deps)
    : false;
}

export interface ReadState {
  lastId: string | null;
  nextAt: number;
  busy: boolean;
}
/** Read POSTs at least 5 s apart: 2 s history rounds (30) + reads (12) + list GETs (12) = 54 of 60 a minute (D16). */
export const READ_GAP_MS = 5_000;

/** POST read for a new newest id on a visible tab; only a 200 advances lastId and refreshes the lists. */
export async function readThrough(
  ctx: SessionApiContext,
  channelId: string,
  id: string,
  visible: boolean,
  rs: ReadState,
  now: () => number,
): Promise<"read" | "failed" | "skip"> {
  if (!visible || id === rs.lastId || rs.busy) return "skip";
  rs.busy = true;
  const result = await markRead(ctx, channelId, id);
  rs.busy = false;
  const paused = !result.ok && liveRoundEffect(result) === "pause";
  rs.nextAt = now() + (paused ? LIVE_PAUSE_MS : READ_GAP_MS);
  if (!result.ok) return liveRoundEffect(result) === "off" ? "skip" : "failed";
  rs.lastId = id;
  refreshChannels(ctx.tenantId);
  return "read";
}

/** The channel view: keyset history, optimistic send, edit, delete, read cursor and live refetch. */
export function useChatChannel(tenantId: string, channelId: string) {
  const t = useT();
  const { csrfToken } = useTenantContext(tenantId);
  const [view, setView] = useState<ChannelState>(CHANNEL_LOADING);
  const [stale] = useState(createStaleChannels);
  const [visible, setVisible] = useState(false);
  const [readTick, setReadTick] = useState(0); // bumped after a 200 or failed read: re-arms at nextAt
  const epoch = useRef(0); // bumped on unmount and channel change: a late answer is dropped
  const sending = useRef(new Set<string>()); // clientMsgIds in flight: no double send on a retry
  const read = useRef<ReadState>({ lastId: null, nextAt: 0, busy: false });
  const latest = useRef({ t, csrfToken, view });
  useEffect(() => {
    latest.current = { t, csrfToken, view };
  });
  const bound = useCallback(() => {
    const mine = epoch.current;
    return (update: ChannelUpdate): void => {
      if (mine === epoch.current) setView(update);
    };
  }, []);
  const ctx = useCallback(() => ({ tenantId, csrfToken: latest.current.csrfToken }), [tenantId]);

  const reload = useCallback(async (): Promise<void> => {
    const apply = bound();
    setView((s) => (s.messages.length > 0 || s.state === "empty" ? s : CHANNEL_LOADING));
    const result = await listHistory(tenantId, channelId);
    const now = latest.current.t;
    apply((s) => historyView(result, now, "history", s));
  }, [tenantId, channelId, bound]);

  useEffect(() => {
    epoch.current += 1;
    read.current = { lastId: null, nextAt: 0, busy: false };
    setView(CHANNEL_LOADING);
    void reload();
    return () => {
      epoch.current += 1;
    };
  }, [reload]);

  const loadOlder = useCallback(async (): Promise<ChatListError | null> => {
    const cursor = latest.current.view.nextCursor;
    if (cursor === null) return null;
    const apply = bound();
    const result = await listHistory(tenantId, channelId, cursor);
    if (!result.ok && liveRoundEffect(result) === "off") {
      // 5.2.1: a final refusal takes the screen's own row (error, live off), as the first load does
      apply((s) => ({ ...historyView(result, latest.current.t, "history", s), off: true }));
      return null;
    }
    if (!result.ok) return failure("history", result, latest.current.t);
    apply((s) => appendOlder(s, result.data));
    return null;
  }, [tenantId, channelId, bound]);

  const attempt = useCallback(
    async (entry: PendingMessage): Promise<void> => {
      if (sending.current.has(entry.clientMsgId)) return;
      sending.current.add(entry.clientMsgId);
      const apply = bound();
      apply(await sendAttempt({ ctx: ctx(), channelId, entry, t: latest.current.t }));
      sending.current.delete(entry.clientMsgId);
    },
    [ctx, channelId, bound],
  );
  const send = useCallback(
    (body: string, replyToMessageId?: string): Promise<void> => {
      const entry: PendingMessage = {
        clientMsgId: crypto.randomUUID(),
        body,
        replyToMessageId,
        failed: null,
      };
      setView((s) => ({ ...s, pending: [...s.pending, entry] }));
      return attempt(entry);
    },
    [attempt],
  );
  const retry = useCallback(
    (clientMsgId: string): Promise<void> => {
      const entry = latest.current.view.pending.find((p) => p.clientMsgId === clientMsgId);
      if (!entry?.failed?.retry) return Promise.resolve();
      const pending = (s: ChannelState) =>
        s.pending.map((p) => (p.clientMsgId === clientMsgId ? { ...p, failed: null } : p));
      setView((s) => ({ ...s, pending: pending(s) }));
      return attempt({ ...entry, failed: null });
    },
    [attempt],
  );
  const discard = useCallback((clientMsgId: string): void => {
    const keep = (p: PendingMessage) => p.clientMsgId !== clientMsgId || p.failed === null;
    setView((s) => ({ ...s, pending: s.pending.filter(keep) }));
  }, []);

  const settle = useCallback(
    (apply: (u: ChannelUpdate) => void, done: Settled): ChatListError | null => {
      apply(done.update);
      const deps = { tenantId, channelId, t: latest.current.t, stale, apply };
      if (done.refetch) void refetchNewest(deps);
      return done.error;
    },
    [tenantId, channelId, stale],
  );
  const edit = useCallback(
    async (messageId: string, body: string): Promise<ChatListError | null> => {
      const message = latest.current.view.messages.find((m) => m.id === messageId);
      if (!message || message.tombstone !== null) return null;
      const apply = bound();
      const done = await editAttempt({ ctx: ctx(), channelId, message, body, t: latest.current.t });
      return settle(apply, done);
    },
    [ctx, channelId, bound, settle],
  );
  const remove = useCallback(
    async (messageId: string): Promise<ChatListError | null> => {
      const apply = bound();
      const done = await removeAttempt({ ctx: ctx(), channelId, messageId, t: latest.current.t });
      return settle(apply, done);
    },
    [ctx, channelId, bound, settle],
  );

  useEffect(() => {
    const sync = () => setVisible(document.visibilityState === "visible");
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, []);
  const newestId = view.messages[0]?.id ?? null;
  useEffect(() => {
    if (newestId === null) return;
    const wait = Math.max(0, read.current.nextAt - Date.now());
    const timer = setTimeout(() => {
      const done = readThrough(ctx(), channelId, newestId, visible, read.current, Date.now);
      void done.then((outcome) => outcome !== "skip" && setReadTick((n) => n + 1));
    }, wait);
    return () => clearTimeout(timer);
  }, [newestId, visible, view.messages, readTick, ctx, channelId]);

  const live =
    (view.state === "ready" || view.state === "empty") && view.error === null && !view.off;
  useRealtime(
    tenantId,
    live,
    () => channelRound({ tenantId, channelId, t: latest.current.t, stale, apply: bound() }),
    stale.accept,
    CHAT_STREAM,
  );
  const { state, messages, pending, error, nextCursor } = view;
  const hasOlder = nextCursor !== null;
  return {
    state,
    messages,
    pending,
    error,
    hasOlder,
    reload,
    loadOlder,
    send,
    retry,
    discard,
    edit,
    remove,
  };
}
