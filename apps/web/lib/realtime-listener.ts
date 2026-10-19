import { log } from "./log";
import {
  encodeFrame,
  planChatDelivery,
  planEventDelivery,
  type ChatFrame,
  type RealtimeAudience,
  type RealtimeFrame,
} from "./realtime-auth";
import { appDb } from "./session-cookies";

/**
 * One LISTEN client per web process with in-memory fan-out (lane L5, readiness R-7, R-9, R-12,
 * R-14), plus the per-subscriber SSE stream (R-5, R-10, R-11). The projector NOTIFYs a bare event
 * id; ids are queued (bounded), handled one at a time and re-authorized per subscriber by
 * planEventDelivery before any frame. A missed NOTIFY cannot be replayed, so a lost connection or
 * an overflow closes every stream (clients reconnect and refetch). Limits are per web process.
 */
export const REALTIME_CHANNEL = "web_realtime";
export const MAX_STREAMS_PER_ACCOUNT = 5;
export const MAX_PENDING_EVENTS = 1_000;
export const STREAM_HIGH_WATER_MARK = 16;
export const HEARTBEAT_MS = 25_000;
export const STREAM_LIFETIME_MS = 15 * 60_000;
const BACKOFF = { baseMs: 1_000, factor: 2, capMs: 30_000 } as const;
const EVENT_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HEARTBEAT_FRAME = ": hb\n\n";

/** R-14 full jitter: uniform in [0, min(cap, base * factor^attempt)). */
export function backoffDelayMs(attempt: number, random: () => number): number {
  const ceiling = Math.min(BACKOFF.capMs, BACKOFF.baseMs * BACKOFF.factor ** attempt);
  return Math.floor(random() * ceiling);
}

export interface RealtimeSubscriber<F = RealtimeFrame> extends RealtimeAudience {
  send(frame: F): void;
  close(): void;
}

export interface ListenClient {
  query(sql: string): Promise<unknown>;
  onNotification(fn: (channel: string, payload: string | undefined) => void): void;
  onLost(fn: () => void): void;
  /** Destroys the connection: a LISTENing client must never go back to the pool. */
  release(): void;
}

export interface ListenerDeps<F = RealtimeFrame> {
  connect(): Promise<ListenClient>;
  /** NOTIFY channel; default REALTIME_CHANNEL (L5). A code constant, never input. */
  channel?: string;
  plan(
    eventId: string,
    groups: ReadonlyMap<string, ReadonlySet<RealtimeSubscriber<F>>>,
  ): Promise<ReadonlyArray<readonly [RealtimeSubscriber<F>, F]>>;
  now(): number;
  random(): number;
  log(event: string, fields?: Record<string, unknown>): void;
}

export interface RealtimeListener<F = RealtimeFrame> {
  /** Registers a subscriber; false when its account already has the maximum open streams. */
  add(sub: RealtimeSubscriber<F>): boolean;
  remove(sub: RealtimeSubscriber<F>): void;
  /** Resolves once LISTEN is active; rejects on a connect failure or while backing off. */
  ready(): Promise<void>;
  stats(): { subscribers: number; accounts: number; listening: boolean; pending: number };
}

export function createRealtimeListener<F = RealtimeFrame>(
  deps: ListenerDeps<F>,
): RealtimeListener<F> {
  const byTenant = new Map<string, Set<RealtimeSubscriber<F>>>();
  const perAccount = new Map<string, number>();
  const pending: string[] = [];
  let client: ListenClient | null = null;
  let connecting: Promise<void> | null = null;
  let failures = 0;
  let retryAt = 0;
  // Bumped whenever the queue is discarded, so a drain stuck on an old event cannot resume it.
  let epoch = 0;
  let draining = false;
  const listenChannel = deps.channel ?? REALTIME_CHANNEL;

  const registered = (sub: RealtimeSubscriber<F>) => byTenant.get(sub.tenantId)?.has(sub) === true;
  const closeAll = () => {
    for (const set of [...byTenant.values()]) for (const sub of [...set]) sub.close();
  };
  const backOff = () => {
    failures += 1;
    retryAt = deps.now() + backoffDelayMs(failures - 1, deps.random);
  };
  const discard = () => {
    epoch += 1;
    draining = false;
    pending.length = 0;
  };
  const stop = () => {
    discard();
    const current = client;
    client = null;
    current?.release();
  };

  async function drain(): Promise<void> {
    if (draining) return;
    draining = true;
    const mine = epoch;
    while (mine === epoch && pending.length > 0) {
      const eventId = pending.shift()!;
      let planned: ReadonlyArray<readonly [RealtimeSubscriber<F>, F]>;
      try {
        planned = byTenant.size === 0 ? [] : await deps.plan(eventId, byTenant);
      } catch {
        deps.log("realtime.event.authorize_failed");
        continue;
      }
      if (mine !== epoch) return;
      for (const [sub, frame] of planned) if (registered(sub)) sub.send(frame);
    }
    if (mine === epoch) draining = false;
  }

  function attach(c: ListenClient): void {
    c.onNotification((channel, payload) => {
      if (client !== c || channel !== listenChannel) return;
      // Untrusted: any role may NOTIFY here. Never echo the payload (R-9).
      if (typeof payload !== "string" || !EVENT_ID_RE.test(payload)) {
        deps.log("realtime.notify.invalid_payload");
        return;
      }
      if (pending.length >= MAX_PENDING_EVENTS) {
        deps.log("realtime.queue.overflow");
        discard();
        closeAll();
        return;
      }
      pending.push(payload);
      void drain();
    });
    c.onLost(() => {
      if (client !== c) return;
      deps.log("realtime.listener.lost");
      backOff();
      stop();
      closeAll();
    });
  }

  function ready(): Promise<void> {
    if (client) return Promise.resolve();
    if (connecting) return connecting;
    if (deps.now() < retryAt) return Promise.reject(new Error("realtime listener backing off"));
    connecting = (async () => {
      let c: ListenClient | undefined;
      try {
        c = await deps.connect();
        attach(c);
        await c.query(`LISTEN ${listenChannel}`);
      } catch (error) {
        c?.release();
        backOff();
        throw error;
      } finally {
        connecting = null;
      }
      if (byTenant.size === 0) {
        c.release(); // everyone left while connecting
        return;
      }
      client = c;
      failures = 0;
      retryAt = 0;
    })();
    return connecting;
  }

  return {
    add(sub) {
      const count = perAccount.get(sub.accountId) ?? 0;
      if (count >= MAX_STREAMS_PER_ACCOUNT) return false;
      perAccount.set(sub.accountId, count + 1);
      const set = byTenant.get(sub.tenantId) ?? new Set<RealtimeSubscriber<F>>();
      byTenant.set(sub.tenantId, set.add(sub));
      return true;
    },
    remove(sub) {
      const set = byTenant.get(sub.tenantId);
      if (!set?.delete(sub)) return;
      if (set.size === 0) byTenant.delete(sub.tenantId);
      const count = (perAccount.get(sub.accountId) ?? 1) - 1;
      if (count > 0) perAccount.set(sub.accountId, count);
      else perAccount.delete(sub.accountId);
      if (byTenant.size === 0) stop();
    },
    ready,
    stats: () => ({
      subscribers: [...byTenant.values()].reduce((n, set) => n + set.size, 0),
      accounts: perAccount.size,
      listening: client !== null,
      pending: pending.length,
    }),
  };
}

let processListener: RealtimeListener | null = null;

/** The process-wide listener over the app pool (role-gated by appDb's DB_EXPECTED_ROLE check). */
export function realtimeListener(): RealtimeListener {
  processListener ??= createRealtimeListener({
    async connect() {
      const c = await appDb().pool.connect();
      return {
        query: (sql) => c.query(sql),
        onNotification: (fn) => c.on("notification", (msg) => fn(msg.channel, msg.payload)),
        onLost: (fn) => {
          c.on("error", fn);
          c.on("end", fn);
        },
        release: () => c.release(true),
      };
    },
    plan: planEventDelivery,
    now: Date.now,
    random: Math.random,
    log: (event, fields) => log.warn(event, fields),
  });
  return processListener;
}

/** NOTIFY channel of the chat topic: L14 emits a bare message id; L15 only LISTENs. */
export const CHAT_REALTIME_CHANNEL = "chat_realtime";
let chatListener: RealtimeListener<ChatFrame> | null = null;

/**
 * The process-wide chat listener: own LISTEN client, queue, backoff and MAX_STREAMS_PER_ACCOUNT
 * cap, all apart from L5's. connect repeats L5's lines so that realtimeListener() stays as is.
 */
export function chatRealtimeListener(): RealtimeListener<ChatFrame> {
  chatListener ??= createRealtimeListener<ChatFrame>({
    async connect() {
      const c = await appDb().pool.connect();
      return {
        query: (sql) => c.query(sql),
        onNotification: (fn) => c.on("notification", (msg) => fn(msg.channel, msg.payload)),
        onLost: (fn) => {
          c.on("error", fn);
          c.on("end", fn);
        },
        release: () => c.release(true),
      };
    },
    channel: CHAT_REALTIME_CHANNEL,
    plan: planChatDelivery,
    now: Date.now,
    random: Math.random,
    log: (event, fields) => log.warn(event, { ...fields, topic: "chat" }),
  });
  return chatListener;
}

const encoder = new TextEncoder();

/**
 * One subscriber's SSE body: a heartbeat that re-checks access every 25 s (R-10), a 15-minute
 * lifetime (R-11) and a 16-chunk queue whose overflow closes the stream (slow consumer, R-12).
 * Abort, cancel, revocation and errors run one idempotent cleanup. Null at the stream cap (R-7).
 */
export function openRealtimeStream<F = RealtimeFrame>(
  listener: RealtimeListener<F>,
  audience: RealtimeAudience,
  options: {
    recheck(audience: RealtimeAudience): Promise<boolean>;
    signal?: AbortSignal;
    encode?: (frame: F) => string;
  },
): ReadableStream<Uint8Array> | null {
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  let closed = false;
  let beating = false;

  // Only reachable after `heartbeat` and `lifetime` exist: nothing calls it before add() returns.
  const finish = () => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    clearTimeout(lifetime);
    options.signal?.removeEventListener("abort", finish);
    listener.remove(subscriber);
    try {
      controller?.close();
    } catch {
      // already closed or cancelled by the consumer
    }
  };
  const write = (text: string) => {
    if (closed || !controller) return;
    controller.enqueue(encoder.encode(text));
    if ((controller.desiredSize ?? 0) <= 0) finish();
  };
  // L5 frames by default; the chat topic passes its own encoder (F is then ChatFrame).
  const encode = (options.encode ?? encodeFrame) as (frame: F) => string;
  const subscriber: RealtimeSubscriber<F> = {
    ...audience,
    send: (frame) => write(encode(frame)),
    close: finish,
  };
  const stream = new ReadableStream<Uint8Array>(
    {
      start: (c) => {
        controller = c;
      },
      cancel: finish,
    },
    { highWaterMark: STREAM_HIGH_WATER_MARK },
  );
  if (!listener.add(subscriber)) return null;

  const heartbeat = setInterval(() => {
    if (beating) return;
    beating = true;
    options
      .recheck(audience)
      .catch(() => false)
      .then((allowed) => {
        beating = false;
        if (allowed) write(HEARTBEAT_FRAME);
        else finish();
      });
  }, HEARTBEAT_MS);
  const lifetime = setTimeout(finish, STREAM_LIFETIME_MS);
  if (options.signal?.aborted) finish();
  else options.signal?.addEventListener("abort", finish, { once: true });
  listener.ready().then(() => write(HEARTBEAT_FRAME), finish);
  return stream;
}
