import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  backoffDelayMs,
  createLiveRounds,
  createRealtimeHub,
  LIVE_PAUSE_MS,
  LIVE_ROUND_GAP_MS,
  parseRealtimeMessage,
  type EventSourceLike,
  type RealtimeSignal,
} from "./use-realtime";
import { liveStreamEnabled } from "./use-sessions-data";

// Client side of web live sync (lane L5, R-14, R-15, A11, A23, A24): one EventSource per tenant
// per tab, own backoff (never the browser's), refetch only on resync, never on a timer.
const TENANT = "11111111-1111-4111-8111-111111111111";
const SESSION = "44444444-4444-4444-8444-444444444444";

class FakeSource implements EventSourceLike {
  static all: FakeSource[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  constructor(readonly url: string) {
    FakeSource.all.push(this);
  }
  close() {
    this.closed = true;
  }
  open() {
    this.onopen?.();
  }
  fail() {
    this.onerror?.();
  }
  push(data: unknown) {
    this.onmessage?.({ data: typeof data === "string" ? data : JSON.stringify(data) });
  }
}

const latest = () => FakeSource.all.at(-1)!;
let delays: number[] = [];

function hub(random = () => 0.999) {
  return createRealtimeHub({
    create: (url) => new FakeSource(url),
    now: () => Date.now(),
    setTimeout: (fn, ms) => {
      delays.push(ms);
      return setTimeout(fn, ms);
    },
    clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    random,
  });
}
function recorder() {
  const signals: RealtimeSignal[] = [];
  return {
    signals,
    fn: (s: RealtimeSignal) => signals.push(s),
    resyncs: () => signals.filter((s) => s.kind === "resync").length,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  FakeSource.all = [];
  delays = [];
});
afterEach(() => vi.useRealTimers());

describe("createRealtimeHub", () => {
  it("opens one same-origin EventSource per tenant, reference counted, closed at zero", () => {
    const h = hub();
    const off1 = h.subscribe(TENANT, () => undefined);
    const off2 = h.subscribe(TENANT, () => undefined);
    expect(FakeSource.all.map((s) => s.url)).toEqual([`/api/realtime/subscribe?tenant=${TENANT}`]);
    const offOther = h.subscribe("22222222-2222-4222-8222-222222222222", () => undefined);
    expect(FakeSource.all).toHaveLength(2);
    off1();
    off1();
    expect(FakeSource.all[0]!.closed).toBe(false);
    off2();
    expect(FakeSource.all[0]!.closed).toBe(true);
    offOther();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("A11/F2: an error closes the source, reconnects within [0, cap]; every open resyncs once", async () => {
    const r = recorder();
    hub().subscribe(TENANT, r.fn);
    latest().open();
    expect(r.signals).toEqual([{ kind: "resync" }]); // F2: the first open too (GET-to-LISTEN gap)
    const first = latest();
    first.fail();
    expect(first.closed).toBe(true);
    expect(r.resyncs()).toBe(2);
    expect(delays[0]).toBeGreaterThanOrEqual(0);
    expect(delays[0]).toBeLessThan(1_000);
    await vi.advanceTimersByTimeAsync(delays[0]!);
    expect(FakeSource.all).toHaveLength(2);
    latest().open();
    expect(r.resyncs()).toBe(3);
    first.fail();
    first.open();
    expect(r.resyncs()).toBe(3);
  });

  it("A11: a repeated or older (sessionId, version) is ignored: no duplicate apply", () => {
    const r = recorder();
    hub().subscribe(TENANT, r.fn);
    latest().open();
    const msg = (version: number, sessionId = SESSION) => ({
      type: "session.updated",
      sessionId,
      version,
    });
    for (const v of [3, 3, 2, 4]) latest().push(msg(v));
    latest().push(msg(1, "55555555-5555-4555-8555-555555555555"));
    expect(r.signals).toEqual([
      { kind: "resync" },
      { kind: "event", message: msg(3) },
      { kind: "event", message: msg(4) },
      { kind: "event", message: msg(1, "55555555-5555-4555-8555-555555555555") },
    ]);
  });

  it("A23: an idle healthy stream refetches only on its open; an outage refetches once", async () => {
    const r = recorder();
    hub().subscribe(TENANT, r.fn);
    latest().open();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(r.signals).toEqual([{ kind: "resync" }]);
    expect(FakeSource.all).toHaveLength(1);
    for (let attempt = 0; attempt < 8; attempt += 1) {
      latest().fail();
      await vi.advanceTimersByTimeAsync(30_000);
    }
    expect(r.resyncs()).toBe(2);
    expect(Math.max(...delays)).toBeLessThanOrEqual(30_000);
    expect(delays.slice(-3).every((d) => d === backoffDelayMs(20, () => 0.999))).toBe(true);
    latest().open();
    expect(r.resyncs()).toBe(3);
    await vi.advanceTimersByTimeAsync(30_000); // F6: only a stream open for 30 s resets the backoff
    latest().fail();
    expect(delays.at(-1)).toBeLessThan(1_000);
  });

  it("F6: a forced close/reopen cycle backs off exponentially; 30 s open resets it", async () => {
    hub().subscribe(TENANT, () => undefined);
    for (let cycle = 0; cycle < 6; cycle += 1) {
      latest().open(); // the first ": hb" opens the stream at once, so an open alone proves nothing
      await vi.advanceTimersByTimeAsync(1_000);
      latest().fail(); // e.g. a NOTIFY flood overflowing the server listener closes every stream
      await vi.advanceTimersByTimeAsync(delays.at(-1)!);
    }
    const ceiling = (attempt: number) => backoffDelayMs(attempt, () => 0.999);
    expect(delays).toEqual([0, 1, 2, 3, 4, 5].map(ceiling));
    latest().open();
    await vi.advanceTimersByTimeAsync(30_000);
    latest().fail();
    expect(delays.at(-1)).toBe(ceiling(0));
  });

  it("drops messages outside the R-5 shape", () => {
    const r = recorder();
    hub().subscribe(TENANT, r.fn);
    latest().open();
    for (const bad of [
      "not json",
      { type: "session.updated", sessionId: SESSION },
      { type: "session.updated", sessionId: SESSION, version: 1, price: 5 },
      { type: 1, sessionId: SESSION, version: 1 },
      { type: "session.updated", sessionId: SESSION, version: 1.5 },
      { type: "session.updated", sessionId: SESSION, version: -1 },
      [1, 2, 3],
    ]) {
      latest().push(bad);
    }
    expect(r.signals).toEqual([{ kind: "resync" }]); // the open's own resync only
    expect(parseRealtimeMessage(42)).toBeNull();
  });
});

describe("F1: createLiveRounds (one view's live refresh rounds)", () => {
  // A fake view: `limited` answers successive rounds (true = RATE_LIMITED), `ms` is each round's GET.
  function view(limited: boolean[] = [], ms = 0) {
    const starts: number[] = [];
    const tab = { hidden: false };
    const rounds = createLiveRounds(
      async () => {
        starts.push(Date.now());
        await new Promise((resolve) => setTimeout(resolve, ms));
        return limited.shift() ?? false;
      },
      {
        now: () => Date.now(),
        setTimeout: (fn, wait) => setTimeout(fn, wait),
        clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
        hidden: () => tab.hidden,
      },
    );
    return { rounds, starts, tab };
  }
  const gaps = (starts: number[]) => starts.slice(1).map((t, i) => t - starts[i]!);

  it("a: the first signal runs at once; a burst coalesces into one trailing round", async () => {
    const { rounds, starts } = view();
    const t0 = Date.now();
    rounds.signal();
    for (let i = 0; i < 10; i += 1) {
      await vi.advanceTimersByTimeAsync(150);
      rounds.signal();
    }
    await vi.advanceTimersByTimeAsync(60_000);
    expect(starts.map((t) => t - t0)).toEqual([0, LIVE_ROUND_GAP_MS]);
    rounds.signal(); // after a quiet period: at once again
    expect(starts).toHaveLength(3);
  });

  it("a: sustained events give at most 30 rounds a minute; a slow round is never overlapped", async () => {
    const fast = view();
    const slow = view([], 2_500);
    const t0 = Date.now();
    for (let elapsed = 0; elapsed < 60_000; elapsed += 100) {
      fast.rounds.signal();
      slow.rounds.signal();
      await vi.advanceTimersByTimeAsync(100);
    }
    expect(fast.starts.filter((t) => t - t0 < 60_000)).toHaveLength(30);
    expect(Math.min(...gaps(fast.starts))).toBe(LIVE_ROUND_GAP_MS);
    expect(Math.min(...gaps(slow.starts))).toBeGreaterThanOrEqual(2_500);
  });

  it("b: a RATE_LIMITED round pauses the view's rounds for 30 s, then one catch-up runs", async () => {
    const busy = view([true]);
    const quiet = view([true]);
    const t0 = Date.now();
    busy.rounds.signal();
    quiet.rounds.signal();
    for (let i = 0; i < 25; i += 1) {
      await vi.advanceTimersByTimeAsync(1_000);
      busy.rounds.signal(); // events keep arriving during the pause
    }
    await vi.advanceTimersByTimeAsync(LIVE_PAUSE_MS - 25_001);
    expect(busy.starts).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(60_001);
    expect(busy.starts.map((t) => t - t0)).toEqual([0, LIVE_PAUSE_MS]);
    expect(quiet.starts.map((t) => t - t0)).toEqual([0, LIVE_PAUSE_MS]); // no event needed
  });

  it("c: no round while hidden; becoming visible resyncs once, only if something was skipped", async () => {
    const { rounds, starts, tab } = view();
    tab.hidden = true;
    rounds.visibilityChanged();
    rounds.signal();
    rounds.signal();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(starts).toEqual([]);
    tab.hidden = false;
    rounds.visibilityChanged();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(starts).toHaveLength(1);
    tab.hidden = true; // hidden and visible again with nothing skipped: no round
    rounds.visibilityChanged();
    tab.hidden = false;
    rounds.visibilityChanged();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(starts).toHaveLength(1);
    rounds.signal(); // runs at once; the next one waits for the 2 s gap, which ends while hidden
    rounds.signal();
    tab.hidden = true;
    rounds.visibilityChanged();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(starts).toHaveLength(2);
    tab.hidden = false;
    rounds.visibilityChanged();
    expect(starts).toHaveLength(3);
  });

  it("stop() (the view unmounted) drops the pending trailing round and its timer", async () => {
    const { rounds, starts } = view();
    rounds.signal();
    await vi.advanceTimersByTimeAsync(0);
    rounds.signal();
    expect(vi.getTimerCount()).toBe(1);
    rounds.stop();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(starts).toHaveLength(1);
  });
});

describe("A24: live refresh is opt-in", () => {
  it("only an explicit live: true on a non-error state opens a stream", () => {
    expect(liveStreamEnabled(undefined, { status: "ready" })).toBe(false);
    expect(liveStreamEnabled({}, { status: "ready" })).toBe(false);
    expect(liveStreamEnabled({ live: false }, { status: "ready" })).toBe(false);
    expect(liveStreamEnabled({ live: true }, { status: "ready" })).toBe(true);
    expect(liveStreamEnabled({ live: true }, { status: "loading" })).toBe(true);
    expect(liveStreamEnabled({ live: true }, { status: "error" })).toBe(false);
  });
});
