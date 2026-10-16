import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { classifyZaloError, sendMessage, ZaloApiError, zaloBotApiBase } from "./zalo-bot-api.js";

const TOKEN = "123456:FIXTURE-unit-token";
const fetchMock = vi.fn();
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const failure = async (p: Promise<unknown>) =>
  (await p.then(
    () => {
      throw new Error("expected a ZaloApiError");
    },
    (e: unknown) => e,
  )) as ZaloApiError;
const leakFree = (e: ZaloApiError) => {
  const seen = JSON.stringify({ ...e, message: e.message, stack: e.stack });
  expect(seen).not.toContain(TOKEN);
  expect(seen).not.toContain("Unauthorized");
};

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  delete process.env.ZALO_BOT_API_BASE;
});
afterEach(() => vi.unstubAllGlobals());

describe("ZALO_BOT_API_BASE pin (Z-5, A26)", () => {
  it.each([
    "http://stub.test",
    "http://10.0.0.7:8080",
    "http://169.254.169.254",
    "ftp://stub.test",
    "https://user:pw@stub.test",
    "https://stub.test/prefix",
    "https://stub.test/?q=1",
    "https://stub.test/#frag",
    "not a url",
  ])("refuses %s before any fetch; the projector dead-letters config_missing", async (base) => {
    process.env.ZALO_BOT_API_BASE = base;
    const e = await failure(sendMessage(TOKEN, "chat-1", "hi"));
    expect(e).toBeInstanceOf(ZaloApiError);
    expect(e.kind).toBe("invalid_base");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(classifyZaloError(e)).toEqual({ action: "dlq", code: "config_missing" });
  });

  it.each([
    [undefined, "https://bot-api.zaloplatforms.com"],
    ["https://stub.test/", "https://stub.test"],
    ["http://127.0.0.1:8080", "http://127.0.0.1:8080"],
    ["http://localhost:9", "http://localhost:9"],
    ["http://[::1]:9", "http://[::1]:9"],
  ])("accepts %s as origin %s", (base, origin) => {
    expect(zaloBotApiBase(base)).toBe(origin);
  });
});

describe("envelope {ok, result, description, error_code} and classification (Z-6, A17)", () => {
  it("ok:true resolves; the request carries chat_id + text on the bot-token path, redirects refused", async () => {
    fetchMock.mockResolvedValueOnce(json({ ok: true, result: { message_id: "m1" } }));
    await expect(sendMessage(TOKEN, "chat-1", "hi")).resolves.toBeUndefined();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`https://bot-api.zaloplatforms.com/bot${TOKEN}/sendMessage`);
    expect(init.redirect).toBe("error");
    expect(JSON.parse(init.body)).toEqual({ chat_id: "chat-1", text: "hi" });
  });

  it.each([
    [
      "ok:false 403",
      () => json({ ok: false, error_code: 403, description: "Unauthorized x" }),
      "rejected",
      null,
      403,
      { action: "recipient_terminal", code: "zalo_rejected" },
    ],
    [
      "ok:false 401",
      () => json({ ok: false, error_code: 401, description: "Unauthorized" }),
      "rejected",
      null,
      401,
      { action: "dlq", code: "zalo_unauthorized" },
    ],
    [
      "ok:false 429",
      () => json({ ok: false, error_code: 429 }),
      "rejected",
      null,
      429,
      { action: "retry", code: "zalo_rate_limited" },
    ],
    [
      "ok:false 500",
      () => json({ ok: false, error_code: 500 }),
      "rejected",
      null,
      500,
      { action: "retry", code: "zalo_server_error" },
    ],
    [
      "ok:false no code",
      () => json({ ok: false }),
      "rejected",
      null,
      null,
      { action: "recipient_terminal", code: "zalo_rejected" },
    ],
    [
      "ok:false string code",
      () => json({ ok: false, error_code: "401" }),
      "rejected",
      null,
      null,
      { action: "recipient_terminal", code: "zalo_rejected" },
    ],
    [
      "HTTP 401",
      () => new Response(`Unauthorized bot${TOKEN}`, { status: 401 }),
      "rejected",
      401,
      null,
      { action: "dlq", code: "zalo_unauthorized" },
    ],
    [
      "HTTP 403",
      () => new Response("no", { status: 403 }),
      "rejected",
      403,
      null,
      { action: "recipient_terminal", code: "zalo_rejected" },
    ],
    [
      "HTTP 429",
      () => new Response("slow down", { status: 429 }),
      "rejected",
      429,
      null,
      { action: "retry", code: "zalo_rate_limited" },
    ],
    [
      "HTTP 500",
      () => new Response("", { status: 500 }),
      "rejected",
      500,
      null,
      { action: "retry", code: "zalo_server_error" },
    ],
    [
      "HTTP 503 claiming ok:true",
      () => json({ ok: true }, 503),
      "rejected",
      503,
      null,
      { action: "retry", code: "zalo_server_error" },
    ],
    [
      "2xx no boolean ok",
      () => json({ result: {} }),
      "bad_response",
      null,
      null,
      { action: "recipient_terminal", code: "zalo_bad_response" },
    ],
    [
      "2xx non-boolean ok",
      () => json({ ok: "true" }),
      "bad_response",
      null,
      null,
      { action: "recipient_terminal", code: "zalo_bad_response" },
    ],
    [
      "2xx bad JSON",
      () => new Response("not json {", { status: 200 }),
      "bad_response",
      null,
      null,
      { action: "recipient_terminal", code: "zalo_bad_response" },
    ],
    [
      "2xx over 64 KiB",
      () => new Response("x".repeat(70 * 1024), { status: 200 }),
      "bad_response",
      null,
      null,
      { action: "recipient_terminal", code: "zalo_bad_response" },
    ],
  ] as const)(
    "%s -> kind %s, status %s, code %s",
    async (_n, res, kind, httpStatus, code, verdict) => {
      fetchMock.mockImplementationOnce(async () => res());
      const e = await failure(sendMessage(TOKEN, "chat-1", "hi"));
      expect([e.kind, e.httpStatus, e.providerErrorCode]).toEqual([kind, httpStatus, code]);
      expect(classifyZaloError(e)).toEqual(verdict);
      leakFree(e);
    },
  );

  it("timeoutMs bounds the call; timeout and network failures are retries that never echo the token", async () => {
    fetchMock.mockImplementationOnce(
      (_u: string, init: RequestInit) =>
        new Promise((_r, reject) =>
          init.signal!.addEventListener("abort", () => reject(init.signal!.reason)),
        ),
    );
    const timedOut = await failure(sendMessage(TOKEN, "chat-1", "hi", { timeoutMs: 20 }));
    expect(classifyZaloError(timedOut)).toEqual({ action: "retry", code: "zalo_timeout" });
    fetchMock.mockRejectedValueOnce(new TypeError(`fetch failed for bot${TOKEN}`));
    const network = await failure(sendMessage(TOKEN, "chat-1", "hi"));
    expect(classifyZaloError(network)).toEqual({ action: "retry", code: "zalo_network" });
    leakFree(timedOut);
    leakFree(network);
  });

  it("an unusable token dead-letters bot_unavailable before any fetch; an unknown throw is a retry", async () => {
    const e = await failure(sendMessage("abc/../x?y=1", "chat-1", "hi"));
    expect(classifyZaloError(e)).toEqual({ action: "dlq", code: "bot_unavailable" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(classifyZaloError(new Error("boom"))).toEqual({ action: "retry", code: "zalo_network" });
  });
});
