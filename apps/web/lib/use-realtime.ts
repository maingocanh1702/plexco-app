"use client";

import { useEffect, useRef } from "react";

/**
 * Client side of web live sync (lane L5, readiness R-14, R-15): one native EventSource per stream
 * per tenant per tab (the sessions stream unless a RealtimeStream descriptor names another), shared
 * by every live view of it through a reference count. The stream only says "something
 * changed"; views refetch through their authorized GET. The browser's own retry is never used: an
 * error closes the source and this module reconnects with full-jitter backoff. A resync is emitted
 * on every open (F2: the first too) and at the first failure after an open (AUTH_REQUIRED or
 * FORBIDDEN then turns live off). Timers only space reconnects and live rounds (F1): no polling.
 */
export interface RealtimeMessage {
  type: string;
  sessionId: string;
  version: number;
}

export type RealtimeSignal<M = RealtimeMessage> =
  { kind: "event"; message: M } | { kind: "resync" };

/**
 * One live stream (L16): the same-origin path of its SSE endpoint, how a frame is read, and, only
 * when its frames carry a monotonic version, how a repeated or older frame is dropped. The hub
 * opens one source per path per tenant, so a descriptor is a module-level constant.
 */
export interface RealtimeStream<M = RealtimeMessage> {
  path: string;
  // Method syntax on purpose: bivariant, so RealtimeStream<M> is assignable to RealtimeStream<unknown>.
  parse(data: unknown): M | null;
  /** Key and monotonic version of a frame; one not newer than the last of its key is dropped. Absent: no frame is ever dropped. */
  dedupe?(message: M): { key: string; version: number };
}

export interface EventSourceLike {
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: (() => void) | null;
  close(): void;
}

export interface RealtimeHubDeps {
  create(url: string): EventSourceLike;
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  random(): number;
}
type Timers = Pick<RealtimeHubDeps, "now" | "setTimeout" | "clearTimeout">;

const BACKOFF = { baseMs: 1_000, factor: 2, capMs: 30_000 } as const;
/** F6: only a stream open this long resets the backoff (its first `: hb` opens it at once). */
const STABLE_OPEN_MS = 30_000;
/** F1 (amends R-16's "no fixed delay"): the least start-to-start gap of one view's live rounds. */
export const LIVE_ROUND_GAP_MS = 2_000;
/** F1 b: ApiClientError exposes no retry hint (api-client.ts:9-34), so a 429 pauses 30 s. */
export const LIVE_PAUSE_MS = 30_000;

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

/** Today's stream: session changes, one monotonic version per sessionId (A11). The default. */
export const SESSIONS_STREAM: RealtimeStream = {
  path: "/api/realtime/subscribe",
  parse: parseRealtimeMessage,
  dedupe: (message) => ({ key: message.sessionId, version: message.version }),
};

interface Channel {
  stream: RealtimeStream<unknown>;
  listeners: Set<(signal: RealtimeSignal<unknown>) => void>;
  source: EventSourceLike | null;
  timer: unknown;
  attempt: number;
  open: boolean;
  openedAt: number;
  lastSeen: Map<string, number>;
}

export function createRealtimeHub(deps: RealtimeHubDeps) {
  const channels = new Map<string, Channel>();
  const emit = (channel: Channel, signal: RealtimeSignal<unknown>) => {
    for (const listener of [...channel.listeners]) listener(signal);
  };

  function connect(tenantId: string, channel: Channel): void {
    channel.timer = null;
    const source = deps.create(`${channel.stream.path}?tenant=${encodeURIComponent(tenantId)}`);
    channel.source = source;
    source.onopen = () => {
      if (channel.source !== source) return;
      channel.open = true;
      channel.openedAt = deps.now();
      emit(channel, { kind: "resync" });
    };
    source.onmessage = (event) => {
      if (channel.source !== source) return;
      const message = channel.stream.parse(event.data);
      if (message === null) return;
      const id = channel.stream.dedupe?.(message);
      if (id) {
        const last = channel.lastSeen.get(id.key);
        if (last !== undefined && id.version <= last) return;
        channel.lastSeen.set(id.key, id.version);
      }
      emit(channel, { kind: "event", message });
    };
    source.onerror = () => {
      if (channel.source !== source) return;
      source.close();
      channel.source = null;
      // F6: a close after a short open (a NOTIFY flood overflowing the listener) keeps backing off.
      if (channel.open && deps.now() - channel.openedAt >= STABLE_OPEN_MS) channel.attempt = 0;
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
    subscribe<M = RealtimeMessage>(
      tenantId: string,
      listener: (signal: RealtimeSignal<M>) => void,
      stream?: RealtimeStream<M>,
    ): () => void {
      const target: RealtimeStream<unknown> = stream ?? SESSIONS_STREAM;
      const key = `${target.path}|${tenantId}`;
      let channel = channels.get(key);
      if (!channel) {
        channel = {
          stream: target,
          listeners: new Set(),
          source: null,
          timer: null,
          attempt: 0,
          open: false,
          openedAt: 0,
          lastSeen: new Map(),
        };
        channels.set(key, channel);
        connect(tenantId, channel);
      }
      // Every listener of one path shares that path's message type, so this one cast is sound.
      const entry = (signal: RealtimeSignal<unknown>) => listener(signal as RealtimeSignal<M>);
      channel.listeners.add(entry);
      return () => {
        const current = channels.get(key);
        if (!current?.listeners.delete(entry) || current.listeners.size > 0) return;
        channels.delete(key);
        current.source?.close();
        current.source = null;
        if (current.timer !== null) deps.clearTimeout(current.timer);
        current.timer = null;
      };
    },
  };
}

/**
 * One view's live rounds (F1, amends R-16): single-flight; a signal after a quiet period starts
 * one at once, then at most one per LIVE_ROUND_GAP_MS (a burst coalesces into one trailing round).
 * A round resolving true (RATE_LIMITED) pauses them LIVE_PAUSE_MS, then one catch-up runs. While
 * the tab is hidden signals wait; becoming visible runs one round if any is pending.
 */
export function createLiveRounds(
  round: () => Promise<boolean>,
  deps: Timers & { hidden(): boolean },
) {
  let running = false;
  let wanted = false;
  let stopped = false;
  let lastStart = -Infinity;
  let resumeAt = -Infinity;
  let timer: unknown = null;
  const pump = (): void => {
    if (stopped || running || timer !== null || !wanted || deps.hidden()) return;
    const wait = Math.max(lastStart + LIVE_ROUND_GAP_MS, resumeAt) - deps.now();
    if (wait > 0) {
      timer = deps.setTimeout(() => {
        timer = null;
        pump();
      }, wait);
      return;
    }
    wanted = false;
    running = true;
    lastStart = deps.now();
    void round()
      .catch(() => false)
      .then((limited) => {
        running = false;
        if (limited) resumeAt = deps.now() + LIVE_PAUSE_MS;
        wanted ||= limited; // a rate-limited round leaves exactly one catch-up pending
        pump();
      });
  };
  return {
    signal(): void {
      wanted = true;
      pump();
    },
    visibilityChanged: pump,
    stop(): void {
      stopped = true;
      if (timer !== null) deps.clearTimeout(timer);
    },
  };
}

const browserDeps: Timers & { hidden(): boolean } = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => window.setTimeout(fn, ms),
  clearTimeout: (handle) => window.clearTimeout(handle as number),
  hidden: () => document.visibilityState === "hidden",
};

let browserHub: ReturnType<typeof createRealtimeHub> | null = null;

function hub(): ReturnType<typeof createRealtimeHub> | null {
  if (typeof window === "undefined" || typeof window.EventSource === "undefined") return null;
  browserHub ??= createRealtimeHub({
    ...browserDeps,
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
    random: Math.random,
  });
  return browserHub;
}

/**
 * While `enabled`, runs the view's live `round` (true = RATE_LIMITED) for each change of
 * `tenantId` that `accept` takes, through createLiveRounds (F1). Opens nothing otherwise.
 * `stream` omitted means the sessions stream: pass it whenever M is not RealtimeMessage, and keep
 * it a module-level constant (it is an effect dependency and the hub's per-path source key).
 */
export function useRealtime<M = RealtimeMessage>(
  tenantId: string,
  enabled: boolean,
  round: () => Promise<boolean>,
  accept: (signal: RealtimeSignal<M>) => boolean = () => true,
  stream?: RealtimeStream<M>,
): void {
  const latest = useRef({ round, accept });
  useEffect(() => {
    latest.current = { round, accept };
  });
  useEffect(() => {
    if (!enabled) return undefined;
    const rounds = createLiveRounds(() => latest.current.round(), browserDeps);
    document.addEventListener("visibilitychange", rounds.visibilityChanged);
    const off = hub()?.subscribe(
      tenantId,
      (signal: RealtimeSignal<M>) => {
        if (latest.current.accept(signal)) rounds.signal();
      },
      stream,
    );
    return () => {
      off?.();
      document.removeEventListener("visibilitychange", rounds.visibilityChanged);
      rounds.stop();
    };
  }, [tenantId, enabled, stream]);
}
