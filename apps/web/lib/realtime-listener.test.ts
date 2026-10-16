import { afterEach, describe, expect, it, vi } from "vitest";
import type { RealtimeAudience, RealtimeFrame } from "./realtime-auth";
import {
  MAX_PENDING_EVENTS,
  MAX_STREAMS_PER_ACCOUNT,
  REALTIME_CHANNEL,
  STREAM_HIGH_WATER_MARK,
  backoffDelayMs,
  createRealtimeListener,
  openRealtimeStream,
  type ListenClient,
  type ListenerDeps,
  type RealtimeSubscriber,
} from "./realtime-listener";

// One LISTEN client per web process with in-memory fan-out (lane L5, R-9, R-12, R-14).
const TENANT = "11111111-1111-4111-8111-111111111111";
const ID = "33333333-3333-4333-8333-333333333333";
const FRAME: RealtimeFrame = { type: "session.updated", sessionId: ID, version: 2 };

function fakeClient() {
  const c = {
    notify: (_channel: string, _payload: string | undefined) => undefined as void,
    lost: () => undefined as void,
    queries: [] as string[],
    released: 0,
    query: async (sql: string) => {
      c.queries.push(sql);
    },
    onNotification: (fn: (channel: string, payload: string | undefined) => void) => {
      c.notify = fn;
    },
    onLost: (fn: () => void) => {
      c.lost = fn;
    },
    release: () => {
      c.released += 1;
    },
  };
  return c;
}

function setup(over: Partial<ListenerDeps> = {}) {
  const clients: ReturnType<typeof fakeClient>[] = [];
  let clock = 1_000_000;
  const deps: ListenerDeps = {
    connect: vi.fn(async () => {
      const c = fakeClient();
      clients.push(c);
      return c as ListenClient;
    }),
    // Everyone subscribed gets the frame, unless a test overrides the plan.
    plan: vi.fn(async (_id, groups) =>
      [...groups.values()].flatMap((set) => [...set].map((s) => [s, FRAME] as const)),
    ),
    now: () => clock,
    random: () => 0.999,
    log: vi.fn(),
    ...over,
  };
  const listener = createRealtimeListener(deps);
  const subscriber = (accountId = "a1", tenantId = TENANT): RealtimeSubscriber => {
    const s: RealtimeSubscriber = {
      tenantId,
      accountId,
      personId: `p-${accountId}`,
      tokenHash: "h",
      send: vi.fn(),
      close: vi.fn(() => listener.remove(s)),
    };
    return s;
  };
  return { deps, listener, clients, subscriber, tick: (ms: number) => (clock += ms) };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const audience: RealtimeAudience = {
  tenantId: TENANT,
  accountId: "a1",
  personId: "p1",
  tokenHash: "h",
};

afterEach(() => {
  vi.useRealTimers();
});

describe("createRealtimeListener", () => {
  it("LISTENs once at the first subscriber and destroys the client at zero (R-12)", async () => {
    const { listener, clients, subscriber, deps } = setup();
    const s1 = subscriber();
    const s2 = subscriber("a2");
    expect(listener.add(s1)).toBe(true);
    await listener.ready();
    expect(listener.add(s2)).toBe(true);
    await listener.ready();
    expect(deps.connect).toHaveBeenCalledTimes(1);
    expect(clients[0]!.queries).toEqual([`LISTEN ${REALTIME_CHANNEL}`]);
    listener.remove(s1);
    expect(clients[0]!.released).toBe(0);
    listener.remove(s2);
    listener.remove(s2);
    expect(clients[0]!.released).toBe(1);
    expect(listener.stats()).toEqual({ subscribers: 0, accounts: 0, listening: false, pending: 0 });
  });

  it("caps concurrent streams per account at 5 (R-7); closing one admits a new one", () => {
    const { listener, subscriber } = setup();
    const subs = Array.from({ length: MAX_STREAMS_PER_ACCOUNT }, () => subscriber());
    for (const s of subs) expect(listener.add(s)).toBe(true);
    expect(listener.add(subscriber())).toBe(false);
    expect(listener.add(subscriber("a2"))).toBe(true);
    listener.remove(subs[0]!);
    expect(listener.add(subscriber())).toBe(true);
  });

  it("A21: drops forged payloads without echoing them; only a lowercase uuid is planned", async () => {
    const { listener, clients, subscriber, deps } = setup();
    const s = subscriber();
    listener.add(s);
    await listener.ready();
    for (const bad of [
      "not-a-uuid",
      "ABCDEF01-2345-4678-89AB-CDEF01234567",
      ` ${ID}`,
      `${ID},${ID}`,
      undefined,
    ]) {
      clients[0]!.notify(REALTIME_CHANNEL, bad);
    }
    clients[0]!.notify("outbox_wake", ID);
    await flush();
    expect(deps.plan).not.toHaveBeenCalled();
    expect(s.send).not.toHaveBeenCalled();
    expect(deps.log).toHaveBeenCalledTimes(5);
    for (const call of vi.mocked(deps.log).mock.calls) {
      expect(call[0]).toBe("realtime.notify.invalid_payload");
      expect(JSON.stringify(call)).not.toContain("not-a-uuid");
    }
    clients[0]!.notify(REALTIME_CHANNEL, ID);
    await flush();
    expect(deps.plan).toHaveBeenCalledTimes(1);
    expect(s.send).toHaveBeenCalledWith(FRAME);
  });

  it("sends only to subscribers still registered when the plan resolves; a plan error drops one event", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const { listener, clients, subscriber, deps } = setup();
    const s1 = subscriber();
    const s2 = subscriber("a2");
    listener.add(s1);
    listener.add(s2);
    await listener.ready();
    vi.mocked(deps.plan)
      .mockImplementationOnce(async (_id, groups) => {
        // The plan was computed for both; s2 leaves before it resolves.
        const planned = [...groups.values()].flatMap((set) =>
          [...set].map((s) => [s, FRAME] as const),
        );
        await gate;
        return planned;
      })
      .mockRejectedValueOnce(new Error("db down"));
    clients[0]!.notify(REALTIME_CHANNEL, ID);
    listener.remove(s2);
    release();
    await flush();
    expect(s1.send).toHaveBeenCalledTimes(1);
    expect(s2.send).not.toHaveBeenCalled();
    clients[0]!.notify(REALTIME_CHANNEL, ID);
    clients[0]!.notify(REALTIME_CHANNEL, ID);
    await flush();
    expect(deps.log).toHaveBeenCalledWith("realtime.event.authorize_failed");
    expect(s1.send).toHaveBeenCalledTimes(2);
  });

  it("A26: more than 1,000 pending ids close every stream and clear the queue, no crash", async () => {
    const { listener, clients, subscriber, deps } = setup();
    vi.mocked(deps.plan).mockImplementation(() => new Promise(() => undefined));
    const subs = [
      subscriber(),
      subscriber("a2"),
      subscriber("a3", "22222222-2222-4222-8222-222222222222"),
    ];
    for (const s of subs) listener.add(s);
    await listener.ready();
    for (let i = 0; i <= MAX_PENDING_EVENTS + 1; i += 1) clients[0]!.notify(REALTIME_CHANNEL, ID);
    for (const s of subs) expect(s.close).toHaveBeenCalledTimes(1);
    expect(listener.stats()).toMatchObject({ subscribers: 0, pending: 0, listening: false });
    expect(deps.log).toHaveBeenCalledWith("realtime.queue.overflow");
  });

  it("A22: connection loss closes every stream; reconnect waits out the backoff, then works", async () => {
    const { listener, clients, subscriber, deps, tick } = setup();
    const s1 = subscriber();
    listener.add(s1);
    await listener.ready();
    clients[0]!.lost();
    expect(s1.close).toHaveBeenCalledTimes(1);
    expect(clients[0]!.released).toBe(1);
    const s2 = subscriber();
    listener.add(s2);
    await expect(listener.ready()).rejects.toThrow();
    expect(deps.connect).toHaveBeenCalledTimes(1);
    tick(1_000);
    await listener.ready();
    expect(deps.connect).toHaveBeenCalledTimes(2);
    clients[0]!.notify(REALTIME_CHANNEL, ID); // the old client is ignored
    clients[1]!.notify(REALTIME_CHANNEL, ID);
    await flush();
    expect(s2.send).toHaveBeenCalledTimes(1);
  });

  it("R-14: full-jitter exponential backoff, base 1 s, factor 2, cap 30 s", async () => {
    expect(backoffDelayMs(0, () => 0)).toBe(0);
    expect(backoffDelayMs(0, () => 0.999)).toBe(999);
    expect(backoffDelayMs(3, () => 0.5)).toBe(4_000);
    expect(backoffDelayMs(5, () => 0.999)).toBe(29_970);
    expect(backoffDelayMs(40, () => 0.999)).toBe(29_970);
    const { listener, subscriber, deps } = setup({
      connect: vi.fn(async () => Promise.reject(new Error("refused"))),
    });
    listener.add(subscriber());
    await expect(listener.ready()).rejects.toThrow("refused");
    await expect(listener.ready()).rejects.toThrow();
    expect(deps.connect).toHaveBeenCalledTimes(1);
  });
});

describe("openRealtimeStream", () => {
  const decode = (chunk: Uint8Array | undefined) => new TextDecoder().decode(chunk);

  it("A12: a consumer that stops reading is closed at the high-water mark and removed", async () => {
    const { listener, clients } = setup();
    const stream = openRealtimeStream(listener, audience, { recheck: async () => true })!;
    await flush();
    for (let i = 0; i < STREAM_HIGH_WATER_MARK + 4; i += 1) {
      clients[0]!.notify(REALTIME_CHANNEL, ID);
      await flush();
    }
    expect(listener.stats().subscribers).toBe(0);
    const reader = stream.getReader();
    const chunks: string[] = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(decode(value));
    }
    expect(chunks.length).toBe(STREAM_HIGH_WATER_MARK);
    expect(chunks[0]).toBe(": hb\n\n");
    expect(chunks[1]).toBe(`data: ${JSON.stringify(FRAME)}\n\n`);
  });

  it("A13: 50 open/abort cycles leave no subscriber, account count, timer or LISTEN client", async () => {
    vi.useFakeTimers();
    const { listener, clients, deps } = setup();
    for (let i = 0; i < 50; i += 1) {
      const abort = new AbortController();
      const stream = openRealtimeStream(listener, audience, {
        recheck: async () => true,
        signal: abort.signal,
      });
      await vi.advanceTimersByTimeAsync(0);
      if (i % 2 === 0) abort.abort();
      else await stream!.cancel();
      expect(listener.stats()).toEqual({
        subscribers: 0,
        accounts: 0,
        listening: false,
        pending: 0,
      });
    }
    expect(vi.getTimerCount()).toBe(0);
    expect(clients.every((c) => c.released === 1)).toBe(true);
    expect(deps.connect).toHaveBeenCalledTimes(50);
  });

  it("returns null at the per-account cap and closes when LISTEN cannot start", async () => {
    const { listener, subscriber } = setup({
      connect: vi.fn(async () => Promise.reject(new Error("refused"))),
    });
    for (let i = 0; i < MAX_STREAMS_PER_ACCOUNT - 1; i += 1) listener.add(subscriber());
    const stream = openRealtimeStream(listener, audience, { recheck: async () => true });
    expect(openRealtimeStream(listener, audience, { recheck: async () => true })).toBeNull();
    const read = await stream!.getReader().read();
    expect(read.done).toBe(true);
    expect(listener.stats().subscribers).toBe(MAX_STREAMS_PER_ACCOUNT - 1);
  });
});
