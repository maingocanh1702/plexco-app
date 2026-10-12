import { authorize, beginZaloConnect, finishZaloConnect, ZaloConnectError } from "@plexco/db";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { __resetAuthSecretCacheForTest } from "../../../../../lib/auth-secrets";
import { csrfOk, currentSession, rateLimited } from "../../../../../lib/session-cookies";
import { getMe, setWebhook } from "../../../../../lib/zalo/client";
import { POST } from "./route";

vi.mock("@plexco/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@plexco/db")>();
  return {
    ...actual,
    authorize: vi.fn(),
    beginZaloConnect: vi.fn(),
    finishZaloConnect: vi.fn(),
    withTenant: vi.fn(async (_d: unknown, _t: string, fn: (tx: unknown) => unknown) => fn({})),
  };
});
vi.mock("../../../../../lib/session-cookies", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../../lib/session-cookies")>();
  return {
    ...actual,
    appDb: vi.fn(() => ({ pool: {}, db: { execute: async () => ({ rows: [{ locale: "en" }] }) } })),
    currentSession: vi.fn(),
    csrfOk: vi.fn(),
    rateLimited: vi.fn(),
  };
});
vi.mock("../../../../../lib/zalo/client", () => ({ getMe: vi.fn(), setWebhook: vi.fn() }));

const TENANT = "11111111-1111-4111-8111-111111111111";
const BOT_TOKEN = "123456:SECRET-bot_token";
const req = (body: unknown, tenant = TENANT) =>
  new Request(`https://plexco.app/api/onboarding/zalo/connect?tenant=${tenant}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-csrf-token": "secret" },
    body: JSON.stringify(body),
  });
const env = async (r: Response) =>
  (await r.json()) as { data: Record<string, unknown> | null; error: { code: string } | null };
const registered = {
  status: "registered" as const,
  verifiedAt: null,
  lastSetwebhookAt: null,
  webhookToken: "wh-token-0123456789abcdef",
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.APP_BASE_URL = "https://plexco.app";
  process.env.ENCRYPTION_KEY = Buffer.from("k".repeat(32)).toString("base64");
  __resetAuthSecretCacheForTest();
  vi.mocked(currentSession).mockResolvedValue({
    sessionId: "s",
    accountId: "a",
    personId: "p",
    csrfSecret: "secret",
    expiresAt: new Date(Date.now() + 3_600_000),
  });
  vi.mocked(csrfOk).mockReturnValue(true);
  vi.mocked(rateLimited).mockResolvedValue(false);
  vi.mocked(authorize).mockResolvedValue({ allowed: true, role: "owner" });
  vi.mocked(getMe).mockResolvedValue(undefined);
  vi.mocked(setWebhook).mockResolvedValue(undefined);
  vi.mocked(beginZaloConnect).mockImplementation(async (_db, p) => {
    await p.prepare("22222222-2222-4222-8222-222222222222"); // exercise the real encryption
    return {
      replayed: false,
      botId: "22222222-2222-4222-8222-222222222222",
      webhookToken: registered.webhookToken,
    };
  });
  vi.mocked(finishZaloConnect).mockResolvedValue(registered);
});

describe("POST /api/onboarding/zalo/connect", () => {
  it("connects: validates the token, registers the webhook, returns status + URL and NO secret", async () => {
    const res = await POST(req({ commandId: "c1", botToken: BOT_TOKEN }));
    expect(res.status).toBe(200);
    const text = JSON.stringify(await env(res));
    expect(text).toContain('"status":"registered"');
    expect(text).toContain("https://plexco.app/api/webhooks/zalo/wh-token-0123456789abcdef");
    expect(text).not.toContain(BOT_TOKEN);
    expect(authorize).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: "connector.secret_manage" }),
    );
    expect(getMe).toHaveBeenCalledWith(BOT_TOKEN);
    const [, url, secret] = vi.mocked(setWebhook).mock.calls[0]!;
    expect(url).toBe("https://plexco.app/api/webhooks/zalo/wh-token-0123456789abcdef");
    expect(secret.length).toBeGreaterThanOrEqual(8);
    expect(secret.length).toBeLessThanOrEqual(256);
    expect(text).not.toContain(secret);
    expect(finishZaloConnect).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ outcome: "registered", commandId: "c1" }),
    );
  });

  it("stores ciphertext only: the prepared record never contains the plaintext token", async () => {
    await POST(req({ commandId: "c1", botToken: BOT_TOKEN }));
    const prepared = await vi
      .mocked(beginZaloConnect)
      .mock.calls[0]![1].prepare("22222222-2222-4222-8222-222222222222");
    expect(prepared.botTokenEnc).not.toContain(BOT_TOKEN);
    expect(Buffer.from(prepared.botTokenEnc, "base64url").toString("utf8")).not.toContain(
      "SECRET-bot",
    );
    expect(prepared.webhookSecretEnc).toBeInstanceOf(Buffer);
  });

  it("invalid token -> 400 ZALO_TOKEN_INVALID, nothing persisted", async () => {
    vi.mocked(getMe).mockRejectedValue(new Error("rejected"));
    const res = await POST(req({ commandId: "c1", botToken: BOT_TOKEN }));
    expect(res.status).toBe(400);
    expect((await env(res)).error?.code).toBe("ZALO_TOKEN_INVALID");
    expect(beginZaloConnect).not.toHaveBeenCalled();
  });

  it("setWebhook failure -> status error is recorded (not registered)", async () => {
    vi.mocked(setWebhook).mockRejectedValue(new Error("down"));
    vi.mocked(finishZaloConnect).mockResolvedValue({ ...registered, status: "error" });
    const res = await POST(req({ commandId: "c1", botToken: BOT_TOKEN }));
    expect((await env(res)).data).toMatchObject({ status: "error" });
    expect(finishZaloConnect).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ outcome: "error" }),
    );
  });

  it("denies without connector.secret_manage: 403, no Zalo call", async () => {
    vi.mocked(authorize).mockResolvedValue({ allowed: false, reason: "grant_required" });
    const res = await POST(req({ commandId: "c1", botToken: BOT_TOKEN }));
    expect(res.status).toBe(403);
    expect(getMe).not.toHaveBeenCalled();
  });

  it("maps a definer denial to 403 and a command-id clash to 409", async () => {
    vi.mocked(beginZaloConnect).mockRejectedValueOnce(new ZaloConnectError("FORBIDDEN", "x"));
    expect((await POST(req({ commandId: "c1", botToken: BOT_TOKEN }))).status).toBe(403);
    vi.mocked(beginZaloConnect).mockRejectedValueOnce(
      new ZaloConnectError("COMMAND_ID_CONFLICT", "x"),
    );
    const res = await POST(req({ commandId: "c1", botToken: BOT_TOKEN }));
    expect(res.status).toBe(409);
    expect((await env(res)).error?.code).toBe("COMMAND_ID_CONFLICT");
  });

  it("rate limited (5/10min per tenant) -> 429 RATE_LIMITED", async () => {
    vi.mocked(rateLimited).mockImplementation(async (key) => key.startsWith("zalo-connect:"));
    const res = await POST(req({ commandId: "c1", botToken: BOT_TOKEN }));
    expect(res.status).toBe(429);
    expect((await env(res)).error?.code).toBe("RATE_LIMITED");
    expect(rateLimited).toHaveBeenCalledWith(`zalo-connect:${TENANT}`, 5, 600);
  });

  it("replay of a processed commandId returns the current state without calling setWebhook", async () => {
    vi.mocked(beginZaloConnect).mockResolvedValue({ replayed: true, state: registered });
    const res = await POST(req({ commandId: "c1", botToken: BOT_TOKEN }));
    expect(res.status).toBe(200);
    expect(setWebhook).not.toHaveBeenCalled();
    expect(finishZaloConnect).not.toHaveBeenCalled();
  });

  it.each([
    [{ botToken: BOT_TOKEN }],
    [{ commandId: "c1" }],
    [{ commandId: "c1", botToken: 5 }],
    [{ commandId: "c1", botToken: BOT_TOKEN, extra: 1 }],
  ])("rejects an invalid body %j with 400", async (body) => {
    expect((await POST(req(body))).status).toBe(400);
  });

  it("CSRF failure -> 403 before anything else", async () => {
    vi.mocked(csrfOk).mockReturnValue(false);
    expect((await POST(req({ commandId: "c1", botToken: BOT_TOKEN }))).status).toBe(403);
    expect(getMe).not.toHaveBeenCalled();
  });
});
