import {
  authorize,
  beginZaloConnect,
  finishZaloConnect,
  probeZaloConnectReplay,
  ZaloConnectError,
} from "@plexco/db";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { __resetAuthSecretCacheForTest } from "../../../../../lib/auth-secrets";
import { csrfOk, currentSession, rateLimited } from "../../../../../lib/session-cookies";
import { getMe, setWebhook, ZaloApiError } from "../../../../../lib/zalo/client";
import { POST } from "./route";

vi.mock("@plexco/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@plexco/db")>();
  return {
    ...actual,
    authorize: vi.fn(),
    beginZaloConnect: vi.fn(),
    finishZaloConnect: vi.fn(),
    probeZaloConnectReplay: vi.fn(),
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
vi.mock("../../../../../lib/zalo/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../../../lib/zalo/client")>()),
  getMe: vi.fn(),
  setWebhook: vi.fn(),
}));

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
  vi.mocked(probeZaloConnectReplay).mockResolvedValue(null);
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
  vi.mocked(finishZaloConnect).mockResolvedValue({ state: registered, superseded: false });
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

  it("getMe timeout/network -> 503 AUTH_UNAVAILABLE, not a token verdict", async () => {
    for (const kind of ["timeout", "network"] as const) {
      vi.mocked(getMe).mockRejectedValue(new ZaloApiError(kind));
      const res = await POST(req({ commandId: "c1", botToken: BOT_TOKEN }));
      expect(res.status).toBe(503);
      expect((await env(res)).error?.code).toBe("AUTH_UNAVAILABLE");
    }
    expect(beginZaloConnect).not.toHaveBeenCalled();
  });

  it("APP_BASE_URL: garbage -> 503; http in production -> 503", async () => {
    process.env.APP_BASE_URL = "not a url";
    expect((await POST(req({ commandId: "c1", botToken: BOT_TOKEN }))).status).toBe(503);
    process.env.APP_BASE_URL = "http://plexco.app";
    vi.stubEnv("NODE_ENV", "production");
    expect((await POST(req({ commandId: "c1", botToken: BOT_TOKEN }))).status).toBe(503);
    vi.unstubAllEnvs();
    expect(getMe).not.toHaveBeenCalled();
  });

  it("setWebhook failure -> status error is recorded (not registered)", async () => {
    vi.mocked(setWebhook).mockRejectedValue(new Error("down"));
    vi.mocked(finishZaloConnect).mockResolvedValue({
      state: { ...registered, status: "error" },
      superseded: false,
    });
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

  it("replay of a processed commandId returns the stored state WITHOUT any Zalo call", async () => {
    vi.mocked(probeZaloConnectReplay).mockResolvedValue(registered);
    const res = await POST(req({ commandId: "c1", botToken: BOT_TOKEN }));
    expect(res.status).toBe(200);
    expect((await env(res)).data).toMatchObject({ status: "registered" });
    expect(getMe).not.toHaveBeenCalled();
    expect(setWebhook).not.toHaveBeenCalled();
    expect(beginZaloConnect).not.toHaveBeenCalled();
  });

  it("a commandId owned by another command -> 409 COMMAND_ID_CONFLICT before any Zalo call", async () => {
    vi.mocked(probeZaloConnectReplay).mockRejectedValue(
      new ZaloConnectError("COMMAND_ID_CONFLICT", "x"),
    );
    const res = await POST(req({ commandId: "c1", botToken: BOT_TOKEN }));
    expect(res.status).toBe(409);
    expect((await env(res)).error?.code).toBe("COMMAND_ID_CONFLICT");
    expect(getMe).not.toHaveBeenCalled();
  });

  it("an unmapped DB error is rethrown sanitized (name + SQLSTATE), never with the query params", async () => {
    let webhookToken = "";
    vi.mocked(beginZaloConnect).mockImplementationOnce(async (_db, p) => {
      const s = await p.prepare("22222222-2222-4222-8222-222222222222");
      webhookToken = s.webhookToken;
      // drizzle-orm 0.45 DrizzleQueryError: params in the message AND on `.params`, pg error on `.cause`.
      const params = [s.botTokenEnc, s.webhookToken, s.webhookSecretEnc.toString("hex")];
      throw Object.assign(
        new Error(
          `Failed query: SELECT bot_id FROM zalo_bot_upsert_for_tenant($1)\nparams: ${params}`,
        ),
        {
          query: "SELECT ...",
          params,
          cause: Object.assign(new Error("deadlock"), { code: "40P01" }),
        },
      );
    });
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const thrown = await POST(req({ commandId: "c1", botToken: BOT_TOKEN })).then(
      () => new Error("expected a rejection"),
      (e: unknown) => e as Error,
    );
    const logLines = JSON.stringify(logged.mock.calls); // read before mockRestore() clears them
    logged.mockRestore();
    expect(webhookToken.length).toBeGreaterThan(16);
    expect(thrown.message).toBe("zalo_connect_failed: Error 40P01");
    expect(thrown.cause).toBeUndefined();
    expect(JSON.stringify({ ...thrown, m: thrown.message, s: thrown.stack })).not.toContain(
      webhookToken,
    );
    expect(logLines).not.toContain(webhookToken);
  });

  // Status, data and error of an answer (meta.requestId differs per response); never the token.
  const answer = async (res: Response) => {
    const text = await res.text();
    expect(text).not.toContain(BOT_TOKEN);
    const { data, error } = JSON.parse(text) as Awaited<ReturnType<typeof env>>;
    return { status: res.status, data, error };
  };
  // The reference a revoked bot must equal: the getMe-rejected answer (tokenInvalid).
  const tokenInvalidAnswer = async () => {
    vi.mocked(getMe).mockRejectedValueOnce(new Error("rejected"));
    const ref = await answer(await POST(req({ commandId: "c1", botToken: BOT_TOKEN })));
    expect(ref).toMatchObject({ status: 400, error: { code: "ZALO_TOKEN_INVALID" } });
    return ref;
  };

  it("BOT_REVOKED from begin -> the getMe-rejected 400 ZALO_TOKEN_INVALID answer, no token (L47)", async () => {
    const expected = await tokenInvalidAnswer();
    vi.mocked(beginZaloConnect).mockRejectedValueOnce(
      new ZaloConnectError("BOT_REVOKED", "bot is revoked"),
    );
    expect(await answer(await POST(req({ commandId: "c1", botToken: BOT_TOKEN })))).toEqual(
      expected,
    );
    expect(finishZaloConnect).not.toHaveBeenCalled();
  });

  it("BOT_REVOKED from finish -> the same 400 ZALO_TOKEN_INVALID answer, no token (L47)", async () => {
    const expected = await tokenInvalidAnswer();
    vi.mocked(finishZaloConnect).mockRejectedValueOnce(
      new ZaloConnectError("BOT_REVOKED", "bot is revoked"),
    );
    expect(await answer(await POST(req({ commandId: "c1", botToken: BOT_TOKEN })))).toEqual(
      expected,
    );
    expect(setWebhook).toHaveBeenCalledTimes(1);
    expect(finishZaloConnect).toHaveBeenCalledTimes(1);
  });

  it("a superseded attempt (a newer connect replaced the token) -> 409 CONNECT_SUPERSEDED, not success", async () => {
    vi.mocked(finishZaloConnect).mockResolvedValue({ state: registered, superseded: true });
    const res = await POST(req({ commandId: "c1", botToken: BOT_TOKEN }));
    expect(res.status).toBe(409);
    const body = (await res.json()) as { data: unknown; error: { code: string; message: string } };
    // OD-2 / DD-126: its own code; COMMAND_ID_CONFLICT is reserved for a reused commandId.
    expect(body.error.code).toBe("CONNECT_SUPERSEDED");
    expect(body.error.message).toBe("A newer connect superseded this attempt.");
    expect(body.data).toBeNull();
    expect(vi.mocked(finishZaloConnect).mock.calls[0]![1].webhookToken).toBe(
      registered.webhookToken,
    );
  });

  it("POST and GET share one response shape", async () => {
    const res = await POST(req({ commandId: "c1", botToken: BOT_TOKEN }));
    expect(Object.keys((await env(res)).data!).sort()).toEqual([
      "lastSetwebhookAt",
      "status",
      "verifiedAt",
      "webhookUrl",
    ]);
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
