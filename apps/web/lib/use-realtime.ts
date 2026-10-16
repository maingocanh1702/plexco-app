"use client";

import { useEffect, useRef } from "react";

/**
 * Client side of web live sync (lane L5, readiness R-14, R-15): one native EventSource per tenant
 * per tab, shared by every live view through a reference count. The stream only says "something
 * changed"; views refetch through their authorized GET. The browser's own retry is never used: an
 * error closes the source and this module reconnects with full-jitter backoff. A resync refetch
 * happens at the first failure after an open (surfacing AUTH_REQUIRED/FORBIDDEN, which turns live
 * off) and on each re-open after a failure. Only that reconnect runs on a timer: no polling.
 */
export interface RealtimeMessage {
  type: string;
  sessionId: string;
  version: number;
}

export type RealtimeSignal = { kind: "event"; message: RealtimeMessage } | { kind: "resync" };

export interface EventSourceLike {
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: (() => void) | null;
  close(): void;
}

export interface RealtimeHubDeps {
  create(url: string): EventSourceLike;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  random(): number;
}

const BACKOFF = { baseMs: 1_000, factor: 2, capMs: 30_000 } as const;

/** R-14 full jitter: uniform in [0, min(cap, base * factor^attempt)). Mirrors the server listener. */
export function backoffDelayMs(attempt: number, random: () => number): number {
  return Math.floor(random() * Math.min(BACKOFF.capMs, BACKOFF.baseMs * BACKOFF.factor ** attempt));
}

/** Exactly {type, sessionId, version} (R-5); anything else is ignored. */
export function parseRealtimeMessage(data: unknown): RealtimeMessage | null {
  if (typeof data !== "string") return null;
  let value: unknown;
  try {
    value = JSON.parse(data);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  if (Object.keys(value).sort().join(",") !== "sessionId,type,version") return null;
  const { type, sessionId, version } = value as Record<string, unknown>;
  if (typeof type !== "string" || typeof sessionId !== "string") return null;
  if (typeof version !== "number" || !Number.isSafeInteger(version) || version < 0) return null;
  return { type, sessionId, version };
}

interface Channel {
  listeners: Set<(signal: RealtimeSignal) => void>;
  source: EventSourceLike | null;
  timer: unknown;
  attempt: number;
  open: boolean;
  failed: boolean;
  lastSeen: Map<string, number>;
}

export function createRealtimeHub(deps: RealtimeHubDeps) {
  const channels = new Map<string, Channel>();
  const emit = (channel: Channel, signal: RealtimeSignal) => {
    for (const listener of [...channel.listeners]) listener(signal);
  };

  function connect(tenantId: string, channel: Channel): void {
    channel.timer = null;
    const source = deps.create(`/api/realtime/subscribe?tenant=${encodeURIComponent(tenantId)}`);
    channel.source = source;
    source.onopen = () => {
      if (channel.source !== source) return;
      const reopened = channel.failed;
      channel.attempt = 0;
      channel.failed = false;
      channel.open = true;
      if (reopened) emit(channel, { kind: "resync" });
    };
    source.onmessage = (event) => {
      if (channel.source !== source) return;
      const message = parseRealtimeMessage(event.data);
      if (!message) return;
      const last = channel.lastSeen.get(message.sessionId);
      if (last !== undefined && message.version <= last) return;
      channel.lastSeen.set(message.sessionId, message.version);
      emit(channel, { kind: "event", message });
    };
    source.onerror = () => {
      if (channel.source !== source) return;
      source.close();
      channel.source = null;
      channel.failed = true;
      const delay = backoffDelayMs(channel.attempt, deps.random);
      channel.attempt += 1;
      channel.timer = deps.setTimeout(() => connect(tenantId, channel), delay);
      if (channel.open) {
        channel.open = false;
        emit(channel, { kind: "resync" });
      }
    };
  }

  return {
    subscribe(tenantId: string, listener: (signal: RealtimeSignal) => void): () => void {
      let channel = channels.get(tenantId);
      if (!channel) {
        channel = {
          listeners: new Set(),
          source: null,
          timer: null,
          attempt: 0,
          open: false,
          failed: false,
          lastSeen: new Map(),
        };
        channels.set(tenantId, channel);
        connect(tenantId, channel);
      }
      const entry = (signal: RealtimeSignal) => listener(signal);
      channel.listeners.add(entry);
      return () => {
        const current = channels.get(tenantId);
        if (!current?.listeners.delete(entry) || current.listeners.size > 0) return;
        channels.delete(tenantId);
        current.source?.close();
        current.source = null;
        if (current.timer !== null) deps.clearTimeout(current.timer);
        current.timer = null;
      };
    },
  };
}

let browserHub: ReturnType<typeof createRealtimeHub> | null = null;

function hub(): ReturnType<typeof createRealtimeHub> | null {
  if (typeof window === "undefined" || typeof window.EventSource === "undefined") return null;
  browserHub ??= createRealtimeHub({
    create: (url) => {
      const source = new window.EventSource(url);
      const like: EventSourceLike = {
        onopen: null,
        onmessage: null,
        onerror: null,
        close: () => source.close(),
      };
      source.onopen = () => like.onopen?.();
      source.onmessage = (event) => like.onmessage?.({ data: event.data });
      source.onerror = () => like.onerror?.();
      return like;
    },
    setTimeout: (fn, ms) => window.setTimeout(fn, ms),
    clearTimeout: (handle) => window.clearTimeout(handle as number),
    random: Math.random,
  });
  return browserHub;
}

/** Calls `onSignal` for live changes of `tenantId` while `enabled`; opens nothing otherwise. */
export function useRealtime(
  tenantId: string,
  enabled: boolean,
  onSignal: (signal: RealtimeSignal) => void,
): void {
  const latest = useRef(onSignal);
  useEffect(() => {
    latest.current = onSignal;
  });
  useEffect(() => {
    if (!enabled) return undefined;
    return hub()?.subscribe(tenantId, (signal) => latest.current(signal));
  }, [tenantId, enabled]);
}
