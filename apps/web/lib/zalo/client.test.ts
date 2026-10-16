import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getMe, sendMessage, setWebhook, ZaloApiError } from "./client";

const TOKEN = "123456:ABC-def_ghi";
const fetchMock = vi.fn();
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  delete process.env.ZALO_BOT_API_BASE;
});
afterEach(() => vi.unstubAllGlobals());

const kindOf = async (p: Promise<unknown>) => ((await p.catch((e) => e)) as ZaloApiError).kind;

describe("zalo client", () => {
  it("getMe posts to the bot-token URL on the documented base", async () => {
    fetchMock.mockImplementation(async () => json({ ok: true, result: { id: "1" } }));
    await getMe(TOKEN);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`https://bot-api.zaloplatforms.com/bot${TOKEN}/getMe`);
    expect(init.method).toBe("POST");
  });

  it("honours ZALO_BOT_API_BASE and trims a trailing slash", async () => {
    process.env.ZALO_BOT_API_BASE = "http://127.0.0.1:8080/";
    fetchMock.mockImplementation(async () => json({ ok: true }));
    await getMe(TOKEN);
    expect(fetchMock.mock.calls[0]![0]).toBe(`http://127.0.0.1:8080/bot${TOKEN}/getMe`);
  });

  it("setWebhook sends url + secret_token; sendMessage sends chat_id + text", async () => {
    fetchMock.mockImplementation(async () => json({ ok: true }));
    await setWebhook(TOKEN, "https://x.test/hook", "s".repeat(32));
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toEqual({
      url: "https://x.test/hook",
      secret_token: "s".repeat(32),
    });
    await sendMessage(TOKEN, "chat-1", "hi");
    expect(JSON.parse(fetchMock.mock.calls[1]![1].body)).toEqual({ chat_id: "chat-1", text: "hi" });
  });

  it("an abort while reading the body maps to kind timeout", async () => {
    const body = new ReadableStream({
      pull() {
        throw new DOMException("aborted", "AbortError");
      },
    });
    fetchMock.mockImplementation(async () => new Response(body, { status: 200 }));
    expect(await kindOf(getMe(TOKEN))).toBe("timeout");
  });

  it("rejects a token that could alter the URL path before any request", async () => {
    expect(await kindOf(getMe("abc/../x?y=1"))).toBe("invalid_token");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("maps non-2xx, ok:false, bad JSON, oversize and network failure to stable kinds without leaking the token", async () => {
    fetchMock.mockResolvedValueOnce(json({ ok: false }, 200));
    expect(await kindOf(getMe(TOKEN))).toBe("rejected");
    fetchMock.mockResolvedValueOnce(new Response("nope", { status: 401 }));
    expect(await kindOf(getMe(TOKEN))).toBe("rejected");
    fetchMock.mockResolvedValueOnce(new Response("not json", { status: 200 }));
    expect(await kindOf(getMe(TOKEN))).toBe("bad_response");
    fetchMock.mockResolvedValueOnce(new Response("x".repeat(70 * 1024), { status: 200 }));
    expect(await kindOf(getMe(TOKEN))).toBe("bad_response");
    fetchMock.mockRejectedValueOnce(
      Object.assign(new Error(`boom ${TOKEN}`), { name: "TimeoutError" }),
    );
    const e = (await getMe(TOKEN).catch((x) => x)) as ZaloApiError;
    expect(e.kind).toBe("timeout");
    expect(e.message).not.toContain(TOKEN);
  });

  // Envelope {ok, result, description, error_code} (DD-126; payment bot src/zalo/zalo.ts callApi).
  it("ok:true succeeds; a full ok:false envelope is rejected and echoes neither token nor description", async () => {
    fetchMock.mockResolvedValueOnce(json({ ok: true, result: { id: "1" } }));
    await expect(getMe(TOKEN)).resolves.toBeUndefined();
    fetchMock.mockResolvedValueOnce(
      json({ ok: false, error_code: 401, description: `Unauthorized: bot${TOKEN} is invalid` }),
    );
    const e = (await getMe(TOKEN).catch((x) => x)) as ZaloApiError;
    expect(e.kind).toBe("rejected");
    const seen = JSON.stringify({ ...e, message: e.message });
    expect(seen).not.toContain(TOKEN);
    expect(seen).not.toContain("Unauthorized");
  });

  it.each([
    ["missing ok", { result: { id: "1" } }],
    ["empty object", {}],
    ["non-boolean ok", { ok: "true" }],
    ["array", []],
    ["string", "ok"],
    ["null", null],
  ])(
    "a 2xx body with no readable verdict (%s) is bad_response, never success",
    async (_n, body) => {
      fetchMock.mockResolvedValueOnce(json(body));
      expect(await kindOf(getMe(TOKEN))).toBe("bad_response");
    },
  );

  it("a non-2xx is rejected even when its body claims ok:true", async () => {
    fetchMock.mockResolvedValueOnce(json({ ok: true, result: {} }, 502));
    expect(await kindOf(getMe(TOKEN))).toBe("rejected");
  });

  it("refuses a secret_token outside 8-256 chars", async () => {
    expect(await kindOf(setWebhook(TOKEN, "https://x.test", "short"))).toBe("rejected");
  });
});
