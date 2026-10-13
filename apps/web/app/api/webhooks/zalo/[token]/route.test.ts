import {
  finishInboundEvent,
  issueLinkCode,
  markBotVerifiedActive,
  resolveZaloBotByToken,
  resolveZaloIdentity,
  storeInboundEvent,
  readZaloBotTokenEnc,
  type ZaloBotRef,
} from "@plexco/db";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { __resetAuthSecretCacheForTest } from "../../../../../lib/auth-secrets";
import { encryptConnectorSecret, blobToText } from "../../../../../lib/connector-secrets";
import { rateLimited } from "../../../../../lib/session-cookies";
import { __resetWebhookSecretCacheForTest } from "../../../../../lib/zalo/webhook-secret-cache";
import { sendMessage } from "../../../../../lib/zalo/client";
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
const update = (text: string, id: number | string = 9001) => ({
  update_id: id,
  result: {
    event_name: "message.text.received",
    message: { text, from: { id: "zuser-1", display_name: "An" }, chat: { id: "zuser-1" } },
  },
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
  ])("bad secret (%s) -> 401 INVALID_WEBHOOK_SECRET and nothing stored", async (_n, secret) => {
    const res = await call({ secret });
    expect(res.status).toBe(401);
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

  it("key version mismatch fails closed: 401, no audit, nothing stored", async () => {
    vi.mocked(resolveZaloBotByToken).mockResolvedValue({ ...bot, keyVersion: "old-key" });
    const res = await call();
    expect(res.status).toBe(401);
    expect(audit).not.toHaveBeenCalled();
    expect(storeInboundEvent).not.toHaveBeenCalled();
  });

  it("a numeric update_id above 2^53 -> 400 (digits already lost)", async () => {
    const res = await call({ raw: '{"update_id": 9007199254740993, "result": {}}' });
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

  it("/link in a GROUP chat posts no code and issues none", async () => {
    const body = update("/link", 9200);
    (body.result.message.chat as { id: string }).id = "group-9";
    await call({ body });
    expect(vi.mocked(sendMessage).mock.calls[0]![2]).toContain("message the bot directly");
    expect(issueLinkCode).not.toHaveBeenCalled();
  });

  it("/me for a linked person says linked", async () => {
    vi.mocked(resolveZaloIdentity).mockResolvedValue({
      personId: "p1",
      channelIdentityId: "ci1",
      created: false,
      displayName: "An",
      hasAccount: true,
    });
    const body = update("/me", 9201);
    (body.result.message.chat as { id: string }).id = "zuser-1";
    await call({ body });
    expect(vi.mocked(sendMessage).mock.calls[0]![2]).toContain("Plexco account linked");
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
  ])("malformed payload (%s) -> 400 WEBHOOK_PAYLOAD_MALFORMED", async (_n, raw) => {
    const res = await call({ raw });
    expect(res.status).toBe(400);
    expect((await env(res)).error?.code).toBe("WEBHOOK_PAYLOAD_MALFORMED");
    expect(storeInboundEvent).not.toHaveBeenCalled();
  });

  it("oversized body (> 64 KiB) -> 400 before parsing", async () => {
    const res = await call({ raw: JSON.stringify({ update_id: 1, pad: "x".repeat(70 * 1024) }) });
    expect(res.status).toBe(400);
  });

  it("duplicate event id -> 200 ack, no processing, no reply", async () => {
    vi.mocked(storeInboundEvent).mockResolvedValue({ id: null, duplicate: true });
    const res = await call();
    expect(res.status).toBe(200);
    expect(resolveZaloIdentity).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("stores the event ENCRYPTED before processing, then marks it processed", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    const stored = vi.mocked(storeInboundEvent).mock.calls[0]![1];
    expect(stored.externalEventId).toBe("9001");
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
      body: { update_id: 77, result: { event_name: "message.image.received", message: {} } },
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
    vi.mocked(markBotVerifiedActive).mockClear();
    vi.mocked(resolveZaloBotByToken).mockResolvedValue(bot);
    await call({ body: update("/me", 9004) });
    expect(markBotVerifiedActive).not.toHaveBeenCalled();
  });
});
