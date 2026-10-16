import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  backoffDelayMs,
  createRealtimeHub,
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

  it("A11: an error closes the source, reconnects within [0, cap] and a re-open resyncs once", async () => {
    const r = recorder();
    hub().subscribe(TENANT, r.fn);
    latest().open();
    expect(r.signals).toEqual([]);
    const first = latest();
    first.fail();
    expect(first.closed).toBe(true);
    expect(r.resyncs()).toBe(1);
    expect(delays[0]).toBeGreaterThanOrEqual(0);
    expect(delays[0]).toBeLessThan(1_000);
    await vi.advanceTimersByTimeAsync(delays[0]!);
    expect(FakeSource.all).toHaveLength(2);
    latest().open();
    expect(r.resyncs()).toBe(2);
    first.fail();
    first.open();
    expect(r.resyncs()).toBe(2);
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
      { kind: "event", message: msg(3) },
      { kind: "event", message: msg(4) },
      { kind: "event", message: msg(1, "55555555-5555-4555-8555-555555555555") },
    ]);
  });

  it("A23: an idle healthy stream never refetches; an outage of N failures refetches once", async () => {
    const r = recorder();
    hub().subscribe(TENANT, r.fn);
    latest().open();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(r.signals).toEqual([]);
    expect(FakeSource.all).toHaveLength(1);
    for (let attempt = 0; attempt < 8; attempt += 1) {
      latest().fail();
      await vi.advanceTimersByTimeAsync(30_000);
    }
    expect(r.resyncs()).toBe(1);
    expect(Math.max(...delays)).toBeLessThanOrEqual(30_000);
    expect(delays.slice(-3).every((d) => d === backoffDelayMs(20, () => 0.999))).toBe(true);
    latest().open();
    expect(r.resyncs()).toBe(2);
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
    expect(r.signals).toEqual([]);
    expect(parseRealtimeMessage(42)).toBeNull();
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
