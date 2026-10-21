import {
  claimZaloReplyContext,
  createZaloReplyContext,
  finishInboundEvent,
  issueLinkCode,
  joinSession,
  leaveSession,
  listOwnJoinableSessions,
  listOwnLeavableSeats,
  markBotVerifiedActive,
  readLatestZaloReplyContext,
  readMyCharges,
  readZaloPayContext,
  resolveZaloBotByToken,
  resolveZaloIdentity,
  resolveZaloLinkGate,
  RosterMoneyError,
  storeInboundEvent,
  readZaloBotTokenEnc,
  type ZaloBotRef,
} from "@plexco/db";
import { runWithLang } from "@plexco/core/i18n";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetAuthSecretCacheForTest, keyedHash } from "../../../../../lib/auth-secrets";
import {
  blobToText,
  decryptConnectorSecret,
  encryptConnectorSecret,
} from "../../../../../lib/connector-secrets";
import { log } from "../../../../../lib/log";
import { formatVnd } from "../../../../../lib/money";
import { appDb, rateLimited } from "../../../../../lib/session-cookies";
import { formatSessionDate, formatSessionTime } from "../../../../../lib/session-time";
import {
  __cacheEntriesForTest,
  __resetWebhookSecretCacheForTest,
} from "../../../../../lib/zalo/webhook-secret-cache";
import { sendMessage } from "../../../../../lib/zalo/client";
import { reply } from "../../../../../lib/zalo/player-commands";
import { POST } from "./route";

const audit = vi.hoisted(() => vi.fn());
vi.mock("@plexco/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@plexco/db")>();
  return {
    ...actual,
    appendSecretDecryptAudit: audit,
    resolveZaloBotByToken: vi.fn(),
    storeInboundEvent: vi.fn(),
    finishInboundEvent: vi.fn(),
    markBotVerifiedActive: vi.fn(),
    resolveZaloIdentity: vi.fn(),
    readZaloBotTokenEnc: vi.fn(),
    issueLinkCode: vi.fn(),
    resolveZaloLinkGate: vi.fn(),
    listOwnJoinableSessions: vi.fn(),
    listOwnLeavableSeats: vi.fn(),
    createZaloReplyContext: vi.fn(),
    readLatestZaloReplyContext: vi.fn(),
    claimZaloReplyContext: vi.fn(),
    joinSession: vi.fn(),
    leaveSession: vi.fn(),
    readMyCharges: vi.fn(),
    readZaloPayContext: vi.fn(),
    withTenant: vi.fn(async (_d: unknown, _t: string, fn: (tx: unknown) => unknown) => fn({})),
  };
});
vi.mock("../../../../../lib/session-cookies", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../../lib/session-cookies")>();
  return {
    ...actual,
    appDb: vi.fn(() => ({ pool: {}, db: {} })),
    rateLimited: vi.fn(),
  };
});
vi.mock("../../../../../lib/zalo/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../../../lib/zalo/client")>()),
  sendMessage: vi.fn(),
}));

const TENANT = "11111111-1111-4111-8111-111111111111";
const BOT = "22222222-2222-4222-8222-222222222222";
const SECRET = "s3cret-token-value-0123456789abcdefghijklm";
const BOT_TOKEN = "123456:bot-token-xyz";
const ACC = "33333333-3333-4333-8333-333333333333";
const S1 = "44444444-4444-4444-8444-444444444444";
// Every @plexco/db call behind /join, /leave, /pay and a number reply (readiness 8, rule R).
const PLAYER_DB = [
  listOwnJoinableSessions,
  listOwnLeavableSeats,
  createZaloReplyContext,
  readLatestZaloReplyContext,
  claimZaloReplyContext,
  joinSession,
  leaveSession,
  readMyCharges,
  readZaloPayContext,
];
let bot: ZaloBotRef;

const call = (
  over: { token?: string; secret?: string | null; body?: unknown; raw?: string } = {},
) =>
  POST(
    new Request("https://plexco.app/api/webhooks/zalo/tok", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(over.secret === null ? {} : { "x-bot-api-secret-token": over.secret ?? SECRET }),
      },
      body: over.raw ?? JSON.stringify(over.body ?? update("/start")),
    }),
    { params: Promise.resolve({ token: over.token ?? "tok" }) },
  );
// DD-126 (OD-2) body: payment bot src/zalo/zalo.ts ZaloUpdate. No update_id, no `result`.
const update = (
  text: string,
  id: number | string = 9001,
  chat: Record<string, unknown> = { id: "zuser-1", chat_type: "PRIVATE" },
  from: Record<string, unknown> = { id: "zuser-1", display_name: "An" },
) => ({
  event_name: "message.text.received",
  message: { message_id: String(id), date: 1_760_000_000_000, text, from, chat },
});
const env = async (r: Response) => (await r.json()) as { error?: { code: string } | null };

beforeEach(async () => {
  vi.clearAllMocks();
  __resetWebhookSecretCacheForTest();
  process.env.ENCRYPTION_KEY = Buffer.from("k".repeat(32)).toString("base64");
  __resetAuthSecretCacheForTest();
  const secretEnc = (
    await encryptConnectorSecret(SECRET, {
      tenantId: TENANT,
      botId: BOT,
      purpose: "webhook_secret",
    })
  ).enc;
  const tokenEnc = (
    await encryptConnectorSecret(BOT_TOKEN, { tenantId: TENANT, botId: BOT, purpose: "bot_token" })
  ).enc;
  bot = {
    botId: BOT,
    tenantId: TENANT,
    status: "active",
    webhookSecretEnc: secretEnc,
    keyVersion: "local",
    locale: "en",
  };
  vi.mocked(resolveZaloBotByToken).mockResolvedValue(bot);
  vi.mocked(rateLimited).mockResolvedValue(false);
  vi.mocked(storeInboundEvent).mockResolvedValue({ id: "evt-1", duplicate: false });
  vi.mocked(resolveZaloIdentity).mockResolvedValue({
    personId: "p1",
    channelIdentityId: "ci1",
    created: true,
    displayName: "An",
    hasAccount: false,
  });
  vi.mocked(readZaloBotTokenEnc).mockResolvedValue(blobToText(tokenEnc));
  vi.mocked(sendMessage).mockResolvedValue(undefined);
  audit.mockResolvedValue(undefined);
  // Fail closed (readiness 8): not linked, and an unstubbed player-command call rejects (R-18).
  vi.mocked(resolveZaloLinkGate).mockResolvedValue({ linked: false, accountRef: null });
  for (const fn of PLAYER_DB) vi.mocked(fn).mockRejectedValue(new Error("unstubbed"));
});

describe("POST /api/webhooks/zalo/[token]", () => {
  it("unknown token -> 404 with an empty JSON body", async () => {
    vi.mocked(resolveZaloBotByToken).mockResolvedValue(null);
    const res = await call();
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({});
  });

  it.each(["error", "revoked"] as const)("status %s -> 404 (fail closed)", async (status) => {
    vi.mocked(resolveZaloBotByToken).mockResolvedValue({ ...bot, status });
    expect((await call()).status).toBe(404);
  });

  it("row without a ciphertext -> 404, never a plaintext fallback", async () => {
    vi.mocked(resolveZaloBotByToken).mockResolvedValue({ ...bot, webhookSecretEnc: null });
    expect((await call()).status).toBe(404);
  });

  it.each([
    ["wrong", "wrong"],
    ["missing header", null],
    ["prefix of the real one", SECRET.slice(0, 10)],
  ])("bad secret (%s) -> 403 INVALID_WEBHOOK_SECRET and nothing stored", async (_n, secret) => {
    const res = await call({ secret });
    expect(res.status).toBe(403);
    expect((await env(res)).error?.code).toBe("INVALID_WEBHOOK_SECRET");
    expect(storeInboundEvent).not.toHaveBeenCalled();
  });

  it("audits the webhook-secret decrypt once per cache FILL (not per request), never with secret material", async () => {
    await call();
    expect(audit).toHaveBeenCalledTimes(2); // webhook_secret fill + bot_token for the reply
    await call({ body: update("/start", 9100) });
    expect(audit).toHaveBeenCalledTimes(3); // cache hit: only the bot_token decrypt
    expect(JSON.stringify(audit.mock.calls)).not.toContain(SECRET);
  });

  it("the cache never holds the plaintext secret: only a 32-byte digest", async () => {
    await call();
    const entries = __cacheEntriesForTest();
    expect(entries).toHaveLength(1);
    expect(entries[0]!).toHaveLength(32);
    expect(entries[0]!.toString("utf8")).not.toContain(SECRET);
    expect(entries[0]!.includes(Buffer.from(SECRET))).toBe(false);
  });

  it("a chat whose id is not the sender's (a group without chat_type) is ignored: no store, no identity, no reply", async () => {
    const res = await call({ body: update("/start", 9300, { id: "group-9" }) });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ message: "Success" });
    expect(storeInboundEvent).not.toHaveBeenCalled();
    expect(resolveZaloIdentity).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
    expect(issueLinkCode).not.toHaveBeenCalled();
  });

  it("a GROUP payload is acked and NOTHING is persisted: no other member's name or text is written", async () => {
    const name = "Other Member Display Name";
    const text = "/link private group chatter";
    const res = await call({
      body: update(
        text,
        9301,
        { id: "group-9", chat_type: "GROUP" },
        { id: "zuser-2", display_name: name },
      ),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ message: "Success" });
    expect(storeInboundEvent).not.toHaveBeenCalled();
    expect(finishInboundEvent).not.toHaveBeenCalled();
    const written = JSON.stringify([
      vi.mocked(storeInboundEvent).mock.calls,
      vi.mocked(finishInboundEvent).mock.calls,
      vi.mocked(resolveZaloIdentity).mock.calls,
      audit.mock.calls,
    ]);
    expect(written).not.toContain(name);
    expect(written).not.toContain("private group chatter");
    expect(resolveZaloIdentity).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
    expect(issueLinkCode).not.toHaveBeenCalled();
  });

  // chat_type values pinned from the payment bot (src/zalo/zalo.ts ZaloChat: "PRIVATE" | "GROUP").
  it.each([
    ["PRIVATE", true],
    [undefined, true],
    ["GROUP", false],
    ["OA", false],
  ])("chat_type %s with chat.id == from.id: DM identity resolved = %s", async (chatType, dm) => {
    const chat =
      chatType === undefined ? { id: "zuser-1" } : { id: "zuser-1", chat_type: chatType };
    expect((await call({ body: update("/me", 9302, chat) })).status).toBe(200);
    expect(vi.mocked(storeInboundEvent).mock.calls.length).toBe(dm ? 1 : 0);
    expect(vi.mocked(resolveZaloIdentity).mock.calls.length).toBe(dm ? 1 : 0);
    expect(vi.mocked(sendMessage).mock.calls.length).toBe(dm ? 1 : 0);
  });

  it("an inactive Person -> event row failed with PERSON_INACTIVE, still 200", async () => {
    vi.mocked(resolveZaloIdentity).mockRejectedValue(
      Object.assign(new Error("Failed query"), {
        cause: Object.assign(new Error("zalo_identity_resolve: person is not active"), {
          code: "22023",
        }),
      }),
    );
    const res = await call();
    expect(res.status).toBe(200);
    expect(finishInboundEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: "failed", errorCode: "PERSON_INACTIVE" }),
    );
  });

  it("the secret compare runs BEFORE any bucket: a valid caller never spends the auth bucket", async () => {
    await call();
    expect(vi.mocked(rateLimited).mock.calls.map((c) => c[0])).toEqual([`zalo-webhook:${BOT}`]);
  });

  it("failed attempts are bucketed per bot AND caller; over the limit -> 429", async () => {
    vi.mocked(rateLimited).mockImplementation(async (k) => k.startsWith("zalo-webhook-auth:"));
    const res = await call({ secret: "wrong" });
    expect(res.status).toBe(429);
    expect(rateLimited).toHaveBeenCalledWith(`zalo-webhook-auth:${BOT}:local`, 30, 60);
  });

  it("key version mismatch fails closed: 403, no audit, nothing stored", async () => {
    vi.mocked(resolveZaloBotByToken).mockResolvedValue({ ...bot, keyVersion: "old-key" });
    const res = await call();
    expect(res.status).toBe(403);
    expect(audit).not.toHaveBeenCalled();
    expect(storeInboundEvent).not.toHaveBeenCalled();
  });

  it.each([
    [
      "tampered",
      async () => Buffer.from(bot.webhookSecretEnc!.map((b, i) => (i === 20 ? b ^ 1 : b))),
    ],
    [
      "AAD-mismatched (sealed for another bot)",
      async () =>
        (
          await encryptConnectorSecret(SECRET, {
            tenantId: TENANT,
            botId: "33333333-3333-4333-8333-333333333333",
            purpose: "webhook_secret",
          })
        ).enc,
    ],
  ])(
    "a %s stored ciphertext -> 403 INVALID_WEBHOOK_SECRET on the wrong-secret bucket, nothing stored",
    async (_n, enc) => {
      vi.mocked(resolveZaloBotByToken).mockResolvedValue({ ...bot, webhookSecretEnc: await enc() });
      const res = await call();
      expect(res.status).toBe(403);
      expect((await env(res)).error?.code).toBe("INVALID_WEBHOOK_SECRET");
      expect(storeInboundEvent).not.toHaveBeenCalled();
      expect(rateLimited).toHaveBeenCalledWith(`zalo-webhook-auth:${BOT}:local`, 30, 60);
    },
  );

  it("an unreadable stored secret answers 429 over the failure limit, exactly like a wrong secret", async () => {
    vi.mocked(rateLimited).mockImplementation(async (k) => k.startsWith("zalo-webhook-auth:"));
    const wrong = await call({ secret: "wrong" });
    vi.mocked(resolveZaloBotByToken).mockResolvedValue({
      ...bot,
      webhookSecretEnc: Buffer.alloc(8),
    });
    const unreadable = await call();
    expect([wrong.status, unreadable.status]).toEqual([429, 429]);
    expect((await env(unreadable)).error).toEqual((await env(wrong)).error); // meta.requestId differs
    expect(storeInboundEvent).not.toHaveBeenCalled();
  });

  it("a numeric message_id above 2^53 -> 400 (digits already lost)", async () => {
    const raw =
      '{"message":{"message_id":9007199254740993,"chat":{"id":"zuser-1"},"from":{"id":"zuser-1"},"text":"x"}}';
    const res = await call({ raw });
    expect(res.status).toBe(400);
  });

  it("a failed STORE answers 5xx (nothing durable yet, Zalo must retry)", async () => {
    vi.mocked(storeInboundEvent).mockRejectedValue(new Error("db down"));
    await expect(call()).rejects.toThrow("db down");
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("records the key version with the stored event", async () => {
    await call();
    expect(vi.mocked(storeInboundEvent).mock.calls[0]![1].keyVersion).toBe("local");
  });

  it("/link outside a DM (chat.id != from.id) posts nothing and issues no code", async () => {
    await call({ body: update("/link", 9200, { id: "group-9" }) });
    expect(sendMessage).not.toHaveBeenCalled();
    expect(issueLinkCode).not.toHaveBeenCalled();
    expect(storeInboundEvent).not.toHaveBeenCalled();
  });

  it("/me for a linked person says linked", async () => {
    vi.mocked(resolveZaloIdentity).mockResolvedValue({
      personId: "p1",
      channelIdentityId: "ci1",
      created: false,
      displayName: "An",
      hasAccount: true,
    });
    vi.mocked(resolveZaloLinkGate).mockResolvedValue({ linked: true, accountRef: ACC });
    await call({ body: update("/me", 9201) });
    expect(vi.mocked(sendMessage).mock.calls[0]![2]).toContain("Plexco account linked");
  });

  describe("M9 player commands: the link gate decides first (readiness 4.1, 4.7)", () => {
    it("T-6 (list leg): a linked sender's /join gets the numbered list of its sessions", async () => {
      vi.mocked(resolveZaloLinkGate).mockResolvedValue({ linked: true, accountRef: ACC });
      vi.mocked(listOwnJoinableSessions).mockResolvedValue({
        member: true,
        sessions: [
          {
            sessionId: S1,
            startsAt: "2026-10-24T11:00:00.000Z",
            timezone: "Asia/Ho_Chi_Minh",
            area: "Q1",
            slotsOpen: 2,
          },
        ],
      });
      vi.mocked(createZaloReplyContext).mockResolvedValue({ id: "ctx-1", version: 1 });
      await call({ body: update("/join", 9300) });
      const lines = vi.mocked(sendMessage).mock.calls[0]![2].split("\n");
      expect(lines[0]).toBe("Choose the session to join (reply with its number):");
      expect(lines.slice(1)).toEqual([expect.stringMatching(/^1\. .+ · Q1 \(2 places left\)$/)]);
      expect(vi.mocked(resolveZaloLinkGate).mock.calls.map((c) => c[1])).toEqual(["ci1"]);
      const scope = { tenantId: TENANT, personId: "p1" };
      expect(vi.mocked(listOwnJoinableSessions).mock.calls[0]![1]).toEqual(scope);
      expect(vi.mocked(createZaloReplyContext).mock.calls[0]![1]).toEqual({
        ...scope,
        botId: BOT,
        contextType: "join_list",
        itemIds: [S1],
      });
    });

    it("T-4 (/join leg): an unlinked sender gets only the link prompt (R-19), no player call", async () => {
      await call({ body: update("/join", 9301) });
      expect(vi.mocked(sendMessage).mock.calls.map((c) => c[2])).toEqual([
        "Link your Plexco account before using this command. Type /link to get a link code.",
      ]);
      expect(resolveZaloLinkGate).toHaveBeenCalledTimes(1);
      for (const fn of PLAYER_DB) expect(fn).not.toHaveBeenCalled();
    });
    const [AT, TZ] = ["2026-10-24T11:00:00.000Z", "Asia/Ho_Chi_Minh"];
    const S2 = "55555555-5555-4555-8555-555555555555";
    const REF = `${formatSessionDate(AT, TZ, "en")} · ${formatSessionTime(AT, TZ, "en")} · Q1`;
    const SEAT = { sessionId: S1, startsAt: AT, timezone: TZ, area: "Q1", slotsOpen: 0 };
    const SEAT_L = { ...SEAT, status: "active" as const, waitlistPosition: null };
    const WHO = { personId: "p1", channelIdentityId: "ci1", created: false, displayName: "An" };
    const GROUP = { id: "g-1", chat_type: "GROUP" };
    const PII = ["/pay", "/join", "/leave", '"/me"', '"1"', "zuser-1", "ci1", ACC, S1, S2, '"An"'];
    // T-19: no log argument carries an amount the /pay rows use, raw or formatted.
    for (const n of [100_000, 50_000, 150_000, 99_000, 249_000]) PII.push(String(n), formatVnd(n));
    const R = (...a: Parameters<typeof reply>) => runWithLang("en", () => reply(...a));
    const sent = () => vi.mocked(sendMessage).mock.calls.map((c) => c[2]);
    const linked = (accountRef = ACC) =>
      vi.mocked(resolveZaloLinkGate).mockResolvedValue({ linked: true, accountRef });
    const dm = (...a: Parameters<typeof update>) => call({ body: update(...a) });
    const LEVELS = ["error", "warn", "info", "debug"] as const;
    beforeEach(() => {
      for (const k of LEVELS) vi.spyOn(log, k).mockReturnValue();
    });
    afterEach(() => {
      for (const t of sent()) expect(t).not.toMatch(/bank|ngân hàng|STK|QR|99[.,]000/i);
      const j = JSON.stringify(LEVELS.map((k) => vi.mocked(log[k]).mock.calls));
      for (const s of PII) expect(j).not.toContain(s);
    });
    it.each([
      ...["/pay", "/join", "/leave", "1"].map((text) => ({ text, chat: GROUP })),
      { text: "/leave", chat: { id: "other" } },
    ])("T-1/T-2: $text outside a DM is acked and nothing runs", async ({ text, chat }) => {
      expect((await dm(text, 9101, chat)).status).toBe(200);
      const none = [storeInboundEvent, resolveZaloIdentity, resolveZaloLinkGate, sendMessage];
      for (const fn of [...none, ...PLAYER_DB]) expect(fn).not.toHaveBeenCalled();
    });
    const denied = Object.assign(new Error("permission denied"), { code: "42501" });
    it.each<{ text: string; half?: boolean; fail?: Error; sqlstate?: string }>([
      ...["/leave", "/pay", "1"].map((text) => ({ text })),
      ...["/join", "/leave", "/pay", "1", "/me"].map((text) => ({ text, half: true })),
      ...["/join", "/me"].map((text) => ({ text, half: true, fail: denied, sqlstate: "42501" })),
      { text: "/pay", fail: new Error("statement timeout"), sqlstate: "none" },
    ])("T-4/T-5/T-22: $text half=$half sqlstate=$sqlstate -> link prompt only", async (row) => {
      if (row.half) vi.mocked(resolveZaloIdentity).mockResolvedValue({ ...WHO, hasAccount: true });
      if (row.fail) vi.mocked(resolveZaloLinkGate).mockRejectedValue(row.fail);
      await dm(row.text, 9201);
      expect(sent()).toEqual([row.text === "/me" ? expect.stringContaining("/link") : R("R19")]);
      expect(sent()[0]).not.toContain("account linked.");
      expect(resolveZaloLinkGate).toHaveBeenCalledTimes(1);
      for (const fn of PLAYER_DB) expect(fn).not.toHaveBeenCalled();
      const gateLog = row.sqlstate ? [["zalo_link_gate_failed", { sqlstate: row.sqlstate }]] : [];
      expect(vi.mocked(log.error).mock.calls).toEqual(gateLog);
    });
    type Num = { t: string; leave?: boolean; stale?: boolean; gone?: boolean; err?: Error };
    type NumRow = Num & {
      n?: number;
      limited?: string;
      text?: string;
      calls?: number;
      owed?: boolean;
      want: string;
    };
    type Code = ConstructorParameters<typeof RosterMoneyError>[0];
    const E = (c: Code) => new RosterMoneyError(c, c);
    const arm = (row: Partial<NumRow>) => {
      linked();
      vi.mocked(rateLimited).mockImplementation(async (k) => k === row.limited);
      const contextType = row.leave ? ("leave_list" as const) : ("join_list" as const);
      const ctx = { id: "c1", version: 1, contextType, itemCount: 1, live: !row.stale };
      vi.mocked(readLatestZaloReplyContext).mockResolvedValue(ctx);
      const claimed = row.gone && !row.leave ? null : { contextType, itemIds: [S1] };
      vi.mocked(claimZaloReplyContext).mockResolvedValue(claimed);
      vi.mocked(createZaloReplyContext).mockResolvedValue({ id: "c1", version: 1 });
      vi.mocked(listOwnLeavableSeats).mockResolvedValue(row.gone && row.leave ? [] : [SEAT_L]);
      vi.mocked(listOwnJoinableSessions).mockResolvedValue({ member: true, sessions: [SEAT] });
      const outcome = row.n ? ("waitlisted" as const) : ("active" as const);
      const ids = { playerId: "pl1", replayed: false };
      const waitlistPosition = row.n ?? null;
      vi.mocked(joinSession).mockResolvedValue({
        ...ids,
        outcome,
        waitlistPosition,
        requestId: null,
      });
      vi.mocked(leaveSession).mockResolvedValue({ ...ids, status: "left" });
      if (row.err) vi.mocked(row.leave ? leaveSession : joinSession).mockRejectedValue(row.err);
      // DD-140: one open charge for S1 in this bot's club, through the /pay doubles (T-13 shape).
      if (row.owed) {
        vi.mocked(readMyCharges).mockResolvedValueOnce(FULL(ONE));
        vi.mocked(readZaloPayContext).mockResolvedValueOnce({
          slug: "club-a",
          sessions: new Map(),
        });
      }
    };
    it("T-3: a replayed message joins once; a redelivered failed event gets R-9", async () => {
      arm({});
      vi.mocked(storeInboundEvent)
        .mockResolvedValueOnce({ id: "evt-1", duplicate: false })
        .mockResolvedValueOnce({ id: null, duplicate: true });
      vi.mocked(sendMessage).mockRejectedValueOnce(new Error("send failed"));
      await dm("1", 9103);
      await dm("1", 9103);
      vi.mocked(claimZaloReplyContext).mockResolvedValue(null);
      await dm("1", 9103);
      // No charge doubles: the amount read rejects after the seat is taken, so R1 + R17, never R18.
      expect(sent()).toEqual([[R("R1", { ref: REF }), R("R17")].join("\n"), R("R9")]);
      expect(joinSession).toHaveBeenCalledTimes(1);
      expect(resolveZaloLinkGate).toHaveBeenCalledTimes(2);
    });
    it.each<NumRow>([
      {
        t: "T-6",
        calls: 1,
        owed: true,
        want: [R("R1", { ref: REF }), R("R1amount", { amount: formatVnd(100_000) })].join("\n"),
      },
      { t: "T-16", n: 1, calls: 1, want: R("R2", { ref: REF, n: 1 }) },
      { t: "T-6", err: E("CHARGE_DERIVATION_UNAVAILABLE"), calls: 1, want: R("R7") },
      { t: "T-6", err: new Error("boom"), calls: 1, want: R("R18") },
      { t: "T-7", stale: true, want: R("R9") },
      { t: "T-7", gone: true, want: R("R9") },
      { t: "T-11", leave: true, calls: 1, want: R("R12", { ref: REF }) },
      { t: "T-10", leave: true, err: E("LEAVE_REQUIRES_HOST"), calls: 1, want: R("R13") },
      { t: "T-12", leave: true, gone: true, text: "/leave", want: R("R14") },
      { t: "T-12", leave: true, gone: true, want: R("R9") },
      { t: "T-12", leave: true, err: E("PLAYER_NOT_FOUND"), calls: 1, want: R("R9") },
      { t: "T-23", limited: "session-join:p1", want: R("R11") },
      { t: "T-23", leave: true, limited: "session-leave:p1", want: R("R11") },
      { t: "T-9", leave: true, text: "/leave", want: `${R("leaveHead")}\n1. ${REF}` },
    ])("$t: text=$text leave=$leave -> $want", async (row) => {
      arm(row);
      await dm(row.text ?? "1", 9400);
      expect(sent()).toEqual([row.want]);
      const [hit, other] = row.leave ? [leaveSession, joinSession] : [joinSession, leaveSession];
      const id = vi.mocked(storeInboundEvent).mock.calls[0]![1].externalEventId;
      const input = { tenantId: TENANT, personId: "p1", sessionId: S1, commandId: "zalo:" + id };
      expect([hit, other].map((f) => vi.mocked(f).mock.calls.length)).toEqual([row.calls ?? 0, 0]);
      if (row.calls) expect(hit).toHaveBeenCalledWith(expect.anything(), input);
      if (row.limited) expect(claimZaloReplyContext).not.toHaveBeenCalled();
      const keys = vi.mocked(rateLimited).mock.calls.map((c) => c[0]);
      if (row.limited) expect(keys).toEqual([`zalo-webhook:${BOT}`, row.limited]);
      if (!row.owed) return;
      // The same read as /pay: the link gate's own account, this bot's tenant; the sender's DM only.
      expect(vi.mocked(readMyCharges).mock.calls).toEqual([[expect.anything(), ACC]]);
      const ctxCall = [expect.anything(), { tenantId: TENANT, sessionIds: [] }];
      expect(vi.mocked(readZaloPayContext).mock.calls).toEqual([ctxCall]);
      expect(vi.mocked(sendMessage).mock.calls.map((c) => c[1])).toEqual(["zuser-1"]);
    });
    type Charges = Awaited<ReturnType<typeof readMyCharges>>;
    type Status = Charges["clubs"][number]["status"];
    const K = { kind: "known_amount" as const, currency: "VND" as const, asOf: AT };
    const DUE = { sessionRef: S1, startsAt: AT, amountDue: 100_000, amountAllocated: 0 };
    const OPEN = { ...DUE, remaining: 100_000, status: "open" as const };
    const PART = { ...DUE, amountAllocated: 50_000, remaining: 50_000, status: "partial" as const };
    const OTHER = { ...OPEN, sessionRef: S2, amountDue: 99_000, remaining: 99_000 };
    const OWN: Status = { ...K, totalOutstanding: 150_000, chargeCount: 2, items: [OPEN, PART] };
    const B: Status = { ...K, totalOutstanding: 99_000, chargeCount: 1, items: [OTHER] };
    const ONE: Status = { ...K, totalOutstanding: 100_000, chargeCount: 1, items: [OPEN] };
    const ZERO = { kind: "known_zero" as const, currency: "VND" as const, asOf: AT };
    const UNK = { kind: "unknown" as const, reasonCode: "READ_FAILED" as const, retryable: true };
    const club = (clubRef: string, status: Status) => ({ clubRef, clubLabel: clubRef, status });
    const FULL = (own: Status): Charges => ({
      clubs: [club("club-b", B), club("club-a", own)],
      summary: { ...K, totalOutstanding: 249_000, clubCount: 2 },
    });
    const R15 = [
      R("R15head"),
      R("R15item", { ref: REF, amount: formatVnd(100_000) }),
      R("R15item", { ref: REF, amount: formatVnd(50_000) }) + R("R15partial"),
      R("R15total", { amount: formatVnd(150_000) }),
      R("R15pay"),
    ].join("\n");
    it.each<{ t: string; c?: Charges; acc?: string; slug?: null; ctx?: false; want: string }>([
      { t: "T-13/T-17", c: FULL(OWN), want: R15 },
      { t: "T-14", c: { ...FULL(OWN), clubs: FULL(OWN).clubs.slice(0, 1) }, want: R("R16") },
      { t: "T-15", c: { ...FULL(OWN), summary: UNK }, want: R("R17") },
      { t: "T-15", c: FULL(OWN), slug: null, want: R("R17") },
      { t: "T-15", c: FULL(OWN), acc: "acc-1", want: R("R17") },
      { t: "T-15", want: R("R18") },
      { t: "T-15", c: FULL(UNK), want: R("R17") },
      { t: "T-15", c: FULL(OWN), ctx: false, want: R("R18") },
      { t: "T-14", c: FULL(ZERO), want: R("R16") },
    ])("$t: /pay -> $want", async (row) => {
      const handle = { pool: {}, db: {} };
      vi.mocked(appDb).mockReturnValue(handle as never);
      linked(row.acc);
      if (row.c) vi.mocked(readMyCharges).mockResolvedValue(row.c);
      const sessions = new Map([[S1, { timezone: TZ, area: "Q1" }]]);
      const slug = row.slug === null ? null : "club-a";
      if (row.ctx !== false) vi.mocked(readZaloPayContext).mockResolvedValue({ slug, sessions });
      await dm("/pay", 9500);
      expect(sent()).toEqual([row.want]);
      expect(vi.mocked(readMyCharges).mock.calls).toEqual(row.acc ? [] : [[handle.pool, ACC]]);
      if (!row.acc) expect(vi.mocked(readMyCharges).mock.calls[0]![0]).toBe(handle.pool);
      for (const c of vi.mocked(readZaloPayContext).mock.calls) expect(c[1].tenantId).toBe(TENANT);
    });
    it.each([
      { text: "/pay; DROP TABLE x", bad: "DROP" },
      { text: "x".repeat(600), bad: "x".repeat(20) },
      { text: "/leave\u202E1", bad: "\u202E" },
    ])("T-20: injection %# is routed by its first token, never echoed", async ({ text, bad }) => {
      linked();
      await dm(text, 9800);
      expect(sent()).toEqual([expect.stringMatching(/^I did not understand that command\.\n/)]);
      expect(sent()[0]).not.toContain(bad);
      expect(storeInboundEvent).toHaveBeenCalledTimes(1);
      for (const fn of PLAYER_DB) expect(fn).not.toHaveBeenCalled();
    });
    it("T-22: the gate gets the appDb pool, once, before any player read", async () => {
      const handle = { pool: {}, db: {} };
      vi.mocked(appDb).mockReturnValue(handle as never);
      linked();
      vi.mocked(listOwnJoinableSessions).mockResolvedValue({ member: true, sessions: [] });
      await dm("/join", 9600);
      expect(resolveZaloLinkGate).toHaveBeenCalledTimes(1);
      expect(vi.mocked(resolveZaloLinkGate).mock.calls[0]![0]).toBe(handle.pool);
      const [gate] = vi.mocked(resolveZaloLinkGate).mock.invocationCallOrder;
      expect(gate).toBeLessThan(vi.mocked(listOwnJoinableSessions).mock.invocationCallOrder[0]!);
    });
    it("T-18: a vi club gets its replies in vi", async () => {
      bot.locale = "vi";
      await dm("/pay", 9700);
      expect(sent()).toEqual([runWithLang("vi", () => reply("R19"))]);
    });
  });

  it("per-bot rate limit -> 429 WEBHOOK_RATE_LIMITED", async () => {
    vi.mocked(rateLimited).mockImplementation(async (k) => k.startsWith("zalo-webhook:"));
    const res = await call();
    expect(res.status).toBe(429);
    expect((await env(res)).error?.code).toBe("WEBHOOK_RATE_LIMITED");
    expect(rateLimited).toHaveBeenCalledWith(`zalo-webhook:${BOT}`, 300, 60);
  });

  it.each([
    ["not json", "{nope"],
    ["array", "[]"],
    ["no event id", '{"result":{"message":{"text":"hi"}}}'],
    [
      "update_id but no message_id",
      '{"update_id":5,"message":{"chat":{"id":"u"},"from":{"id":"u"}}}',
    ],
    ["result-wrapped", JSON.stringify({ result: update("/start") })],
    ["no chat.id", '{"message":{"message_id":"m","from":{"id":"u"},"text":"x"}}'],
    ["no from.id", '{"message":{"message_id":"m","chat":{"id":"u"},"text":"x"}}'],
  ])("malformed payload (%s) -> 400 WEBHOOK_PAYLOAD_MALFORMED", async (_n, raw) => {
    const res = await call({ raw });
    expect(res.status).toBe(400);
    expect((await env(res)).error?.code).toBe("WEBHOOK_PAYLOAD_MALFORMED");
    expect(storeInboundEvent).not.toHaveBeenCalled();
  });

  it("oversized body (> 64 KiB) -> 400 before parsing", async () => {
    const res = await call({
      raw: JSON.stringify({ ...update("/start"), pad: "x".repeat(70 * 1024) }),
    });
    expect(res.status).toBe(400);
  });

  it("duplicate event id -> 200 ack, no processing, no reply", async () => {
    vi.mocked(storeInboundEvent).mockResolvedValue({ id: null, duplicate: true });
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ message: "Success" });
    expect(resolveZaloIdentity).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  describe("dedupe on (message_id, chat.id, from.id) with no update_id (DD-126)", () => {
    // Stands in for UNIQUE (tenant_id, bot_id, external_event_id) of channel_inbound_events.
    beforeEach(() => {
      const seen = new Set<string>();
      vi.mocked(storeInboundEvent).mockImplementation(async (_tx, p) => {
        if (seen.has(p.externalEventId)) return { id: null, duplicate: true };
        seen.add(p.externalEventId);
        return { id: `evt-${seen.size}`, duplicate: false };
      });
    });

    it("the same triple twice -> the second delivery is a 200 ack and nothing is processed", async () => {
      expect((await call({ body: update("/me", "m-1") })).status).toBe(200);
      const again = await call({ body: update("/me", "m-1") });
      expect(again.status).toBe(200);
      expect(await again.json()).toEqual({ message: "Success" });
      expect(resolveZaloIdentity).toHaveBeenCalledTimes(1);
      expect(sendMessage).toHaveBeenCalledTimes(1);
      expect(finishInboundEvent).toHaveBeenCalledTimes(1);
    });

    it("the same message_id in another DM (other chat.id and from.id) is processed as a distinct event", async () => {
      await call({ body: update("/start", "m-1") });
      await call({
        body: update("/start", "m-1", { id: "zuser-2", chat_type: "PRIVATE" }, { id: "zuser-2" }),
      });
      const keys = vi.mocked(storeInboundEvent).mock.calls.map((c) => c[1].externalEventId);
      expect(new Set(keys).size).toBe(2);
      expect(vi.mocked(sendMessage).mock.calls.map((c) => c[1])).toEqual(["zuser-1", "zuser-2"]);
      expect(finishInboundEvent).toHaveBeenCalledTimes(2);
    });
  });

  it("stores the event ENCRYPTED before processing, then marks it processed", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ message: "Success" });
    const stored = vi.mocked(storeInboundEvent).mock.calls[0]![1];
    // A keyed HMAC of the composed triple: no raw provider id in the lookup column (DD-67).
    expect(stored.externalEventId).toBe(
      await keyedHash('channel-inbound-event:zalo:["9001","zuser-1","zuser-1"]'),
    );
    expect(stored.externalEventId).not.toContain("zuser-1");
    // The ciphertext AAD binds the stored key: the row alone is enough to decrypt it.
    const plain = await decryptConnectorSecret(
      {} as Parameters<typeof decryptConnectorSecret>[0],
      stored.rawPayloadEnc,
      { tenantId: TENANT, botId: BOT, purpose: `inbound_event:${stored.externalEventId}` },
      stored.keyVersion,
    );
    expect(JSON.parse(plain)).toEqual(update("/start"));
    expect(stored.rawPayloadEnc.toString("utf8")).not.toContain("/start");
    expect(vi.mocked(storeInboundEvent).mock.invocationCallOrder[0]!).toBeLessThan(
      vi.mocked(resolveZaloIdentity).mock.invocationCallOrder[0]!,
    );
    expect(finishInboundEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: "processed" }),
    );
  });

  it("/start replies in the club language (en)", async () => {
    await call();
    expect(sendMessage).toHaveBeenCalledWith(
      BOT_TOKEN,
      "zuser-1",
      expect.stringContaining("Welcome"),
    );
  });

  it("/me says not linked; resolves exactly one identity with scoped hashes", async () => {
    await call({ body: update("/me", 9002) });
    const [, text] = [0, vi.mocked(sendMessage).mock.calls[0]![2]];
    expect(text).toContain("no Plexco account linked");
    const arg = vi.mocked(resolveZaloIdentity).mock.calls[0]![1];
    expect(arg.scopeHash).toMatch(/^[0-9a-f]{64}$/);
    expect(arg.userHash).toMatch(/^[0-9a-f]{64}$/);
    expect(arg.userIdEnc.toString("utf8")).not.toContain("zuser-1");
  });

  it("/link without LINK_CODE_LOOKUP_HMAC_KEY degrades to 'unavailable', never a 500", async () => {
    delete process.env.LINK_CODE_LOOKUP_HMAC_KEY;
    const res = await call({ body: update("/link", 9003) });
    expect(res.status).toBe(200);
    expect(vi.mocked(sendMessage).mock.calls[0]![2]).toContain("temporarily unavailable");
  });

  it("processing failure -> event row 'failed' with a code, still 200", async () => {
    vi.mocked(sendMessage).mockRejectedValue(new Error("zalo down"));
    const res = await call();
    expect(res.status).toBe(200);
    expect(finishInboundEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: "failed", errorCode: "PROCESSING_ERROR" }),
    );
  });

  it("non-text event -> stored then 'ignored', no reply", async () => {
    await call({
      body: {
        event_name: "message.image.received",
        message: {
          message_id: "m-77",
          date: 1_760_000_000_000,
          photo: "https://x.test/p.jpg",
          from: { id: "zuser-1" },
          chat: { id: "zuser-1", chat_type: "PRIVATE" },
        },
      },
    });
    expect(sendMessage).not.toHaveBeenCalled();
    expect(finishInboundEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: "ignored" }),
    );
  });

  it("first verified event flips a registered bot to active; an active bot is not touched", async () => {
    vi.mocked(resolveZaloBotByToken).mockResolvedValue({ ...bot, status: "registered" });
    await call();
    expect(markBotVerifiedActive).toHaveBeenCalledTimes(1);
    expect(vi.mocked(markBotVerifiedActive).mock.calls[0]![3]).toBe("tok");
    vi.mocked(markBotVerifiedActive).mockClear();
    vi.mocked(resolveZaloBotByToken).mockResolvedValue(bot);
    await call({ body: update("/me", 9004) });
    expect(markBotVerifiedActive).not.toHaveBeenCalled();
  });
});
