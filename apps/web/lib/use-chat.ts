"use client";

import type { ChatChannelDto } from "@plexco/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { listChannels, type ChatChannelList, type ChatResult } from "./chat-api";
import { describeChatError, liveRoundEffect, type ChatErrorView } from "./chat-error-ui";
import { useT, type TFn } from "./i18n-client";
import { useRealtime, type RealtimeSignal, type RealtimeStream } from "./use-realtime";

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

/** Exactly {type: "chat.message", channelId, messageId} with lowercase uuid ids, else null. */
function parseChatHint(data: unknown): ChatHint | null {
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

/** One list answer as screen state. A failure clears the list (nothing stale stays on screen) and renders through describeChatError. */
export function channelsView(
  result: ChatResult<ChatChannelList>,
  t: TFn,
  action: "list" | "list-refetch",
): ChannelsView {
  if (result.ok) {
    const { channels } = result.data;
    return { state: channels.length > 0 ? "ready" : "empty", channels, error: null };
  }
  const row = describeChatError(action, result, t);
  return { state: row.state ?? "error", channels: [], error: { ...row, code: result.code } };
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
export function useChatChannels(tenantId: string): ChannelsView & { refresh(): Promise<void> } {
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
    setView((v) => (v.state === "ready" || v.state === "empty" ? v : LOADING));
    const next = channelsView(await listChannels(tenantId), latestT.current, "list");
    if (mine === epoch.current) setView(next);
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

  const live = (view.state === "ready" || view.state === "empty") && view.error === null;
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

/*
 * Channel view (writer W4b continues here): useChatChannel(tenantId, channelId) = keyset history,
 * optimistic send with a client message id, edit, delete and the read call, which ends with
 * refreshChannels(tenantId). It reuses CHAT_STREAM, createStaleChannels and liveRoundEffect.
 */
