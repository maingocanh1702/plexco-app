import { authorize, readSessionRealtimeEvent, resolveWebSession } from "@plexco/db";
import {
  getChatMessage,
  hasLiveMembership,
  listChatChannels,
  withChatActor,
  withTenant,
} from "@plexco/db";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  encodeFrame,
  planEventDelivery,
  recheckSubscriber,
  resolveRealtimePrincipal,
  type RealtimeAudience,
} from "./realtime-auth";
import { encodeChatFrame, planChatDelivery, recheckChatSubscriber } from "./realtime-auth";
import { hashToken } from "./session-cookies";

// Per-event re-authorization (lane L5, R-4, R-5, R-8, R-10). The real authorize()/withTenant
// call shapes run; only @plexco/db's DB-touching functions and the cookie jar are stubbed.
vi.mock("@plexco/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@plexco/db")>();
  return {
    ...actual,
    authorize: vi.fn(),
    getChatMessage: vi.fn(),
    hasLiveMembership: vi.fn(),
    listChatChannels: vi.fn(),
    readSessionRealtimeEvent: vi.fn(),
    resolveWebSession: vi.fn(),
    withChatActor: vi.fn(),
    withTenant: vi.fn(async (_db: unknown, tenantId: string, fn: (tx: unknown) => unknown) =>
      fn({ tenantId }),
    ),
  };
});
const jar = vi.hoisted(() => ({ token: undefined as string | undefined }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => (jar.token ? { value: jar.token } : undefined) }),
}));
vi.mock("./session-cookies", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./session-cookies")>();
  return { ...actual, appDb: vi.fn(() => ({ pool: {}, db: {} })) };
});

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";
const EVENT = "33333333-3333-4333-8333-333333333333";
const SESSION = "44444444-4444-4444-8444-444444444444";

const audience = (tenantId: string, personId = "p1", accountId = "a1"): RealtimeAudience => ({
  tenantId,
  personId,
  accountId,
  tokenHash: "h".repeat(64),
});
const groups = (...subs: RealtimeAudience[]) => {
  const map = new Map<string, Set<RealtimeAudience>>();
  for (const s of subs) map.set(s.tenantId, (map.get(s.tenantId) ?? new Set()).add(s));
  return map;
};
/** The read only finds the row under the owning tenant's RLS context (fake tx carries tenantId). */
const ownedBy = (owner: string, row: Record<string, unknown>) =>
  vi
    .mocked(readSessionRealtimeEvent)
    .mockImplementation(async (tx) =>
      (tx as unknown as { tenantId: string }).tenantId === owner ? (row as never) : null,
    );

beforeEach(() => {
  vi.clearAllMocks();
  jar.token = undefined;
  vi.mocked(authorize).mockResolvedValue({ allowed: true, role: "co_admin" });
});

describe("planEventDelivery (R-4, R-8)", () => {
  it("A3: an authorized subscriber of the owning tenant gets exactly one {type, sessionId, version}", async () => {
    ownedBy(TENANT_A, { type: "session.updated", sessionId: SESSION, version: 4 });
    const sub = audience(TENANT_A);
    const plan = await planEventDelivery(EVENT, groups(sub));
    expect(plan).toEqual([[sub, { type: "session.updated", sessionId: SESSION, version: 4 }]]);
    expect(authorize).toHaveBeenCalledWith(expect.anything(), {
      tenantId: TENANT_A,
      action: "session.manage",
      actorPersonId: "p1",
    });
  });

  it("A6: extra fields on the read row never reach the frame or the wire", async () => {
    ownedBy(TENANT_A, {
      type: "session.updated",
      sessionId: SESSION,
      version: 4,
      payload: { price_amount: 120000, roster: ["Lan"] },
      tenantId: TENANT_A,
      changed_fields: ["visibility"],
    });
    const planned = await planEventDelivery(EVENT, groups(audience(TENANT_A)));
    const frame = planned[0]?.[1] as unknown as Record<string, unknown> | undefined;
    expect(Object.keys(frame!).sort()).toEqual(["sessionId", "type", "version"]);
    const wire = encodeFrame(frame as never);
    expect(wire).toBe(`data: {"type":"session.updated","sessionId":"${SESSION}","version":4}\n\n`);
    expect(wire).not.toMatch(/^(event|id|retry):/m);
    expect(Object.keys(JSON.parse(wire.slice(6))).sort()).toEqual(["sessionId", "type", "version"]);
  });

  it("A4/A8: a subscriber that lost session.manage after subscribing is dropped, nothing planned", async () => {
    ownedBy(TENANT_A, { type: "session.updated", sessionId: SESSION, version: 5 });
    vi.mocked(authorize).mockResolvedValue({ allowed: false } as never);
    expect(await planEventDelivery(EVENT, groups(audience(TENANT_A)))).toEqual([]);
  });

  it("A7 core: tenant A's event never reaches a tenant B subscriber; reads stop at the owner", async () => {
    ownedBy(TENANT_A, { type: "session.updated", sessionId: SESSION, version: 6 });
    const a = audience(TENANT_A, "pa", "aa");
    const b = audience(TENANT_B, "pb", "ab");
    const plan = await planEventDelivery(EVENT, groups(b, a));
    expect(plan.map(([s]) => s)).toEqual([a]);
    expect(authorize).toHaveBeenCalledTimes(1);
    vi.mocked(readSessionRealtimeEvent).mockClear();
    await planEventDelivery(EVENT, groups(a, b));
    expect(readSessionRealtimeEvent).toHaveBeenCalledTimes(1);
  });

  it("memoizes the capability check per (tenant, person) for one event; an error fails closed", async () => {
    ownedBy(TENANT_A, { type: "session.updated", sessionId: SESSION, version: 7 });
    const tab1 = audience(TENANT_A, "p1", "a1");
    const tab2 = { ...audience(TENANT_A, "p1", "a1") };
    const other = audience(TENANT_A, "p2", "a2");
    vi.mocked(authorize).mockImplementation(async (_tx, input) => {
      if (input.actorPersonId === "p2") throw new Error("db down");
      return { allowed: true, role: "admin" } as never;
    });
    const plan = await planEventDelivery(EVENT, groups(tab1, tab2, other));
    expect(plan.map(([s]) => s)).toEqual([tab1, tab2]);
    expect(authorize).toHaveBeenCalledTimes(2);
  });

  it("A21 core: an unknown id plans nothing", async () => {
    vi.mocked(readSessionRealtimeEvent).mockResolvedValue(null);
    expect(await planEventDelivery(EVENT, groups(audience(TENANT_A)))).toEqual([]);
    expect(authorize).not.toHaveBeenCalled();
  });
});

describe("recheckSubscriber (R-10, R-18)", () => {
  const live = {
    sessionId: "s",
    accountId: "a1",
    personId: "p1",
    csrfSecret: "c",
    expiresAt: new Date(),
  };

  it("passes only for the same live session, same account and a current capability", async () => {
    vi.mocked(resolveWebSession).mockResolvedValue(live);
    expect(await recheckSubscriber(audience(TENANT_A))).toBe(true);
    expect(resolveWebSession).toHaveBeenCalledWith({}, "h".repeat(64));
    vi.mocked(resolveWebSession).mockResolvedValue(null);
    expect(await recheckSubscriber(audience(TENANT_A))).toBe(false);
    vi.mocked(resolveWebSession).mockResolvedValue({ ...live, accountId: "other" });
    expect(await recheckSubscriber(audience(TENANT_A))).toBe(false);
    vi.mocked(resolveWebSession).mockResolvedValue(live);
    vi.mocked(authorize).mockResolvedValue({ allowed: false } as never);
    expect(await recheckSubscriber(audience(TENANT_A))).toBe(false);
    vi.mocked(resolveWebSession).mockRejectedValue(new Error("db down"));
    expect(await recheckSubscriber(audience(TENANT_A))).toBe(false);
  });

  it("closes the stream when only the person changes (an identity merge re-parented the account)", async () => {
    vi.mocked(authorize).mockResolvedValue({ allowed: true, role: "admin" });
    vi.mocked(resolveWebSession).mockResolvedValue(live);
    expect(await recheckSubscriber(audience(TENANT_A))).toBe(true);
    vi.mocked(resolveWebSession).mockResolvedValue({ ...live, personId: "other" });
    expect(await recheckSubscriber(audience(TENANT_A))).toBe(false);
  });
});

describe("resolveRealtimePrincipal", () => {
  it("captures the token hash the heartbeat re-resolves; no cookie or a dead session gives null", async () => {
    expect(await resolveRealtimePrincipal()).toBeNull();
    expect(resolveWebSession).not.toHaveBeenCalled();
    jar.token = "raw-token";
    vi.mocked(resolveWebSession).mockResolvedValue(null);
    expect(await resolveRealtimePrincipal()).toBeNull();
    vi.mocked(resolveWebSession).mockResolvedValue({
      sessionId: "s",
      accountId: "a1",
      personId: "p1",
      csrfSecret: "c",
      expiresAt: new Date(),
    });
    expect(await resolveRealtimePrincipal()).toEqual({
      accountId: "a1",
      personId: "p1",
      tokenHash: hashToken("raw-token"),
    });
  });
});

// Chat topic (lane L15, D-3, D-12). The fake withChatActor hands fn a tx carrying the actor, so the
// fake read answers like chat_get_message: the row only for a channel member of the owning tenant.
const CHANNEL = "55555555-5555-4555-8555-555555555555";
const MESSAGE = "66666666-6666-4666-8666-666666666666";
const AUTHOR = "77777777-7777-4777-8777-777777777777";
const BODY = "see you at 7pm, court 3";
const ROW = {
  id: MESSAGE,
  channelId: CHANNEL,
  body: BODY,
  authorType: "person",
  authorPersonId: AUTHOR,
  mine: false,
  tombstone: null,
  revision: 2,
};
const FRAME = { type: "chat.message", channelId: CHANNEL, messageId: MESSAGE };
/** chat_get_message under the fake tx: the row for these `tenant:person` pairs, else zero rows. */
const readableBy = (...pairs: string[]) =>
  vi.mocked(getChatMessage).mockImplementation(async (tx) => {
    const { tenantId, personId } = tx as unknown as { tenantId: string; personId: string };
    return pairs.includes(`${tenantId}:${personId}`) ? (ROW as never) : null;
  });

describe("planChatDelivery (L15 chat topic, D-12)", () => {
  beforeEach(() => {
    vi.mocked(withChatActor).mockImplementation(async (_db, actor, fn) => fn(actor as never));
  });

  it("re-reads per person: a channel member gets exactly the 3-key frame, a non-member nothing", async () => {
    readableBy(`${TENANT_A}:p1`);
    const member = audience(TENANT_A);
    const outsider = audience(TENANT_A, "p2", "a2");
    const plan = await planChatDelivery(MESSAGE, groups(member, outsider));
    expect(plan).toStrictEqual([[member, FRAME]]);
    expect(withChatActor).toHaveBeenCalledTimes(2);
    expect(withChatActor).toHaveBeenCalledWith(
      {},
      { tenantId: TENANT_A, personId: "p1" },
      expect.any(Function),
    );
    const wires = plan.map(([, frame]) => encodeChatFrame(frame));
    expect(wires).toStrictEqual([`data: ${JSON.stringify(FRAME)}\n\n`]);
    expect(wires.map((w) => JSON.parse(w.slice("data: ".length)) as unknown)).toStrictEqual([
      FRAME,
    ]);
  });

  it("row fields never reach the frame or the wire, even when encodeChatFrame gets extra keys", async () => {
    readableBy(`${TENANT_A}:p1`);
    const plan = await planChatDelivery(MESSAGE, groups(audience(TENANT_A)));
    const frames = plan.map(([, frame]) => frame);
    expect(frames.map((f) => Object.keys(f).sort())).toStrictEqual([
      ["channelId", "messageId", "type"],
    ]);
    const widened = frames.map((frame) => ({ ...ROW, ...frame }));
    const wires = widened.map((w) => encodeChatFrame(w));
    expect(wires).toStrictEqual([`data: ${JSON.stringify(FRAME)}\n\n`]);
    for (const leak of [BODY, AUTHOR, "body", "author", "mine", "tombstone", "revision"]) {
      expect(JSON.stringify(frames)).not.toContain(leak);
      expect(wires.join("")).not.toContain(leak);
    }
  });

  it("a null row and a rejected read each plan nothing, throw nothing and log nothing", async () => {
    const logs = (["log", "info", "warn", "error"] as const).map((m) => vi.spyOn(console, m));
    vi.mocked(getChatMessage).mockResolvedValue(null);
    await expect(planChatDelivery(MESSAGE, groups(audience(TENANT_A)))).resolves.toStrictEqual([]);
    vi.mocked(withChatActor).mockRejectedValue(new Error("CHAT_DB_ERROR:UNKNOWN"));
    await expect(
      planChatDelivery(MESSAGE, groups(audience(TENANT_A), audience(TENANT_B))),
    ).resolves.toStrictEqual([]);
    // An error denies only its own subscriber: p2's read in the same tenant still delivers.
    readableBy(`${TENANT_A}:p2`);
    vi.mocked(withChatActor).mockImplementation(async (_db, actor, fn) => {
      if (actor.personId === "p1") throw new Error("CHAT_DB_ERROR:UNKNOWN");
      return fn(actor as never);
    });
    const other = audience(TENANT_A, "p2", "a2");
    expect(await planChatDelivery(MESSAGE, groups(audience(TENANT_A), other))).toStrictEqual([
      [other, FRAME],
    ]);
    for (const spy of logs) expect(spy).not.toHaveBeenCalled();
    for (const spy of logs) spy.mockRestore();
  });

  it("two streams of one person cost one read", async () => {
    readableBy(`${TENANT_A}:p1`);
    const phone = audience(TENANT_A);
    const laptop = { ...audience(TENANT_A), tokenHash: "k".repeat(64) };
    expect(await planChatDelivery(MESSAGE, groups(phone, laptop))).toStrictEqual([
      [phone, FRAME],
      [laptop, FRAME],
    ]);
    expect(withChatActor).toHaveBeenCalledTimes(1);
    expect(getChatMessage).toHaveBeenCalledTimes(1);
  });

  it("the owning tenant's row stops the reads; a tenant B subscriber gets nothing", async () => {
    readableBy(`${TENANT_A}:p1`);
    const a = audience(TENANT_A);
    // The same person in a second club: the read is per tenant group, never reused across tenants.
    const b = audience(TENANT_B);
    const actors = () => vi.mocked(withChatActor).mock.calls.map(([, actor]) => actor);
    expect(await planChatDelivery(MESSAGE, groups(a, b))).toStrictEqual([[a, FRAME]]);
    expect(actors()).toStrictEqual([{ tenantId: TENANT_A, personId: "p1" }]);
    vi.mocked(withChatActor).mockClear();
    expect(await planChatDelivery(MESSAGE, groups(b, a))).toStrictEqual([[a, FRAME]]);
    expect(actors()).toStrictEqual([
      { tenantId: TENANT_B, personId: "p1" },
      { tenantId: TENANT_A, personId: "p1" },
    ]);
  });
});

describe("recheckChatSubscriber (D-3)", () => {
  const live = {
    sessionId: "s",
    accountId: "a1",
    personId: "p1",
    csrfSecret: "c",
    expiresAt: new Date(),
  };
  beforeEach(() => {
    vi.mocked(resolveWebSession).mockResolvedValue(live);
    vi.mocked(hasLiveMembership).mockResolvedValue(true);
    vi.mocked(listChatChannels).mockResolvedValue([{ id: CHANNEL }] as never);
    vi.mocked(withChatActor).mockImplementation(async (_db, actor, fn) => fn(actor as never));
  });

  it("passes only for the same live session, account and person, a live membership and a readable channel", async () => {
    expect(await recheckChatSubscriber(audience(TENANT_A))).toBe(true);
    expect(resolveWebSession).toHaveBeenCalledWith({}, "h".repeat(64));
    expect(hasLiveMembership).toHaveBeenCalledWith({ tenantId: TENANT_A }, TENANT_A, "p1");
    expect(withChatActor).toHaveBeenCalledWith(
      {},
      { tenantId: TENANT_A, personId: "p1" },
      listChatChannels,
    );
    expect(listChatChannels).toHaveBeenCalledTimes(1);
  });

  const denials: Array<[string, () => unknown]> = [
    ["there is no session", () => vi.mocked(resolveWebSession).mockResolvedValue(null)],
    [
      "the session belongs to another account",
      () => vi.mocked(resolveWebSession).mockResolvedValue({ ...live, accountId: "other" }),
    ],
    [
      "the session belongs to another person",
      () => vi.mocked(resolveWebSession).mockResolvedValue({ ...live, personId: "other" }),
    ],
    ["the membership ended", () => vi.mocked(hasLiveMembership).mockResolvedValue(false)],
    ["withTenant rejects", () => vi.mocked(withTenant).mockRejectedValueOnce(new Error("db down"))],
    [
      "no club channel is readable",
      () => vi.mocked(listChatChannels).mockRejectedValue(new Error("CHAT_FORBIDDEN")),
    ],
    [
      "withChatActor rejects",
      () => vi.mocked(withChatActor).mockRejectedValue(new Error("TENANT_SUSPENDED")),
    ],
  ];
  it.each(denials)("fails closed when %s", async (_reason, arrange) => {
    arrange();
    expect(await recheckChatSubscriber(audience(TENANT_A))).toBe(false);
  });
});
