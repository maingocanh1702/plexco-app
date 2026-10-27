/**
 * L47 sender-leg matrix (A-8..A-23): the REAL sendMessage reaches a local node:http fake on 127.0.0.1
 * through the loopback allowance of ZALO_BOT_API_BASE (no seam), and each scripted reply pins the
 * thrown ZaloApiError and its classifyZaloError verdict exactly as shipped (Z-6). The fake only ever
 * sees the fixture token below, never a real one.
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  classifyZaloError,
  sendMessage,
  ZaloApiError,
  type ZaloApiErrorKind,
  type ZaloSendVerdict,
} from "./zalo-bot-api.js";

const TOKEN = "123456:FIXTURE-fake-server-token";
const SEND_PATH = `/bot${TOKEN}/sendMessage`;

// Copied from zalo-bot-api.test.ts (a test file is never imported).
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

type Handler = (req: http.IncomingMessage, res: http.ServerResponse) => void;
type Seen = {
  method: string | undefined;
  url: string | undefined;
  contentType: string | undefined;
  body: string;
};
type Fake = { base: string; requests: Seen[]; close: () => Promise<void> };

/** A loopback fake that records each request (once its body ends) BEFORE `handler` answers it. */
async function startFake(handler: Handler): Promise<Fake> {
  const requests: Seen[] = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      requests.push({
        method: req.method,
        url: req.url,
        contentType: req.headers["content-type"],
        body: Buffer.concat(chunks).toString("utf8"),
      });
      handler(req, res);
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address() as AddressInfo;
  return {
    base: `http://127.0.0.1:${port}`,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

const savedBase = process.env.ZALO_BOT_API_BASE;
let fake: Fake | undefined;
/** Starts this test's fake and points the client at it. */
const serve = async (handler: Handler) => {
  fake = await startFake(handler);
  process.env.ZALO_BOT_API_BASE = fake.base;
  return fake;
};
afterEach(async () => {
  vi.unstubAllGlobals();
  await fake?.close();
  fake = undefined;
  if (savedBase === undefined) delete process.env.ZALO_BOT_API_BASE;
  else process.env.ZALO_BOT_API_BASE = savedBase;
});

const status =
  (code: number, body?: string): Handler =>
  (_req, res) =>
    void res.writeHead(code).end(body);
const okJson =
  (value: unknown): Handler =>
  (_req, res) =>
    void res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(value));
const okFalse = (code: number) => okJson({ ok: false, error_code: code, description: "x" });
const raw =
  (body: string | Buffer): Handler =>
  (_req, res) =>
    void res.writeHead(200).end(body);
const redirect =
  (code: number): Handler =>
  (req, res) =>
    void res.writeHead(code, { location: `http://${req.headers.host}/elsewhere` }).end();
/** A valid ok:true envelope of exactly `bytes` ASCII bytes, so only the 64 KiB cap can refuse it. */
const okEnvelopeOf = (bytes: number) => {
  const head = '{"ok":true,"result":{"pad":"';
  const tail = '"}}';
  return head + "x".repeat(bytes - head.length - tail.length) + tail;
};

type Want = Pick<ZaloApiError, "kind" | "httpStatus" | "providerErrorCode">;
const only = (kind: ZaloApiErrorKind): Want => ({
  kind,
  httpStatus: null,
  providerErrorCode: null,
});
const rej = (httpStatus: number | null, providerErrorCode: number | null): Want => ({
  kind: "rejected",
  httpStatus,
  providerErrorCode,
});
const UNAUTHORIZED: ZaloSendVerdict = { action: "dlq", code: "zalo_unauthorized" };
const RATE_LIMITED: ZaloSendVerdict = { action: "retry", code: "zalo_rate_limited" };
const SERVER_ERROR: ZaloSendVerdict = { action: "retry", code: "zalo_server_error" };
const NETWORK: ZaloSendVerdict = { action: "retry", code: "zalo_network" };
const REJECTED: ZaloSendVerdict = { action: "recipient_terminal", code: "zalo_rejected" };
const BAD_RESPONSE: ZaloSendVerdict = { action: "recipient_terminal", code: "zalo_bad_response" };
const BAD = { want: only("bad_response"), verdict: BAD_RESPONSE };
const NET = { want: only("network"), verdict: NETWORK };

/** The thrown error, its verdict, and that neither the token nor a provider text leaks into it. */
const expectFailure = (e: ZaloApiError, want: Want, verdict: ZaloSendVerdict) => {
  expect(e).toBeInstanceOf(ZaloApiError);
  expect({
    kind: e.kind,
    httpStatus: e.httpStatus,
    providerErrorCode: e.providerErrorCode,
  }).toEqual(want);
  expect(classifyZaloError(e)).toEqual(verdict);
  leakFree(e);
};

type Case = { answer: Handler; want: Want; verdict: ZaloSendVerdict; timeoutMs?: number };
const row = (id: string, what: string, c: Case): [string, Case] => [
  `${id}: ${what} -> ${c.verdict.action} ${c.verdict.code} (L47)`,
  c,
];

const CASES: [string, Case][] = [
  row("A-8 row 1", "HTTP 401 with an envelope body", {
    answer: status(
      401,
      JSON.stringify({ ok: false, error_code: 401, description: "Unauthorized" }),
    ),
    want: rej(401, null),
    verdict: UNAUTHORIZED,
  }),
  row("A-9 row 2", "HTTP 429", {
    answer: status(429),
    want: rej(429, null),
    verdict: RATE_LIMITED,
  }),
  ...[500, 502, 599].map((s) =>
    row("A-10 row 3", `HTTP ${s}`, {
      answer: status(s),
      want: rej(s, null),
      verdict: SERVER_ERROR,
    }),
  ),
  row("A-10 row 3", 'HTTP 503 with an unread {"ok":true} body', {
    answer: status(503, '{"ok":true}'),
    want: rej(503, null),
    verdict: SERVER_ERROR,
  }),
  ...[400, 403, 404].map((s) =>
    row("A-11 row 4", `HTTP ${s}`, { answer: status(s), want: rej(s, null), verdict: REJECTED }),
  ),
  row("A-12 row 5", "200 ok:false error_code 401", {
    answer: okFalse(401),
    want: rej(null, 401),
    verdict: UNAUTHORIZED,
  }),
  row("A-13 row 6", "200 ok:false error_code 429", {
    answer: okFalse(429),
    want: rej(null, 429),
    verdict: RATE_LIMITED,
  }),
  ...[500, 503, 600].map((n) =>
    row("A-14 row 7", `200 ok:false error_code ${n}`, {
      answer: okFalse(n),
      want: rej(null, n),
      verdict: SERVER_ERROR,
    }),
  ),
  ...[403, 0, -1].map((n) =>
    row("A-15 row 8", `200 ok:false error_code ${n}`, {
      answer: okFalse(n),
      want: rej(null, n),
      verdict: REJECTED,
    }),
  ),
  ...[{ ok: false }, { ok: false, error_code: "401" }, { ok: false, error_code: 401.5 }].map((v) =>
    row("A-16 row 9", `200 ${JSON.stringify(v)}`, {
      answer: okJson(v),
      want: rej(null, null),
      verdict: REJECTED,
    }),
  ),
  ...[{ result: {} }, { ok: "true" }, null, []].map((v) =>
    row("A-17 row 10", `200 ${JSON.stringify(v)}`, { answer: okJson(v), ...BAD }),
  ),
  row("A-18 row 11", "200 raw {not json", { answer: raw("{not json"), ...BAD }),
  row("A-18 row 11", "200 with an empty body", { answer: raw(""), ...BAD }),
  row("A-18 row 11", "200 bytes 7b ff 7d (bad UTF-8)", {
    answer: raw(Buffer.from([0x7b, 0xff, 0x7d])),
    ...BAD,
  }),
  row("A-19 row 12 (a)", "200 declaring a 70 KiB ok:true body", {
    answer: (_req, res) =>
      void res.writeHead(200, { "content-length": String(70 * 1024) }).end(okEnvelopeOf(70 * 1024)),
    ...BAD,
  }),
  row("A-19 row 12 (b)", "200 streaming an 80 KiB ok:true body in two 40 KiB writes", {
    answer: (_req, res) => {
      const body = okEnvelopeOf(80 * 1024);
      res.writeHead(200);
      res.write(body.slice(0, 40 * 1024));
      res.write(body.slice(40 * 1024));
      res.end();
    },
    ...BAD,
  }),
  row("A-20 row 13 (a)", "200 and '{', then the socket is destroyed", {
    answer: (req, res) => void res.writeHead(200).write("{", () => req.socket.destroy()),
    ...BAD,
  }),
  row("A-20 row 13 (b)", "200 and '{', then a stall past timeoutMs 100", {
    answer: (_req, res) => void res.writeHead(200).write("{"),
    ...BAD,
    timeoutMs: 100,
  }),
  row("A-21 row 14", "no answer within timeoutMs 100", {
    answer: () => undefined,
    want: only("timeout"),
    verdict: { action: "retry", code: "zalo_timeout" },
    timeoutMs: 100,
  }),
  row("A-22 row 15 (a)", "the socket destroyed before any header", {
    answer: (req) => void req.socket.destroy(),
    ...NET,
  }),
  ...[301, 302, 303, 307, 308].map((s) =>
    row("A-22 row 15 (b)", `HTTP ${s} with a location to /elsewhere (redirect: "error")`, {
      answer: redirect(s),
      ...NET,
    }),
  ),
  ...[300, 304].map((s) =>
    row("A-23 (c) outside Z-6", `HTTP ${s} without a location`, {
      answer: status(s),
      want: rej(s, null),
      verdict: REJECTED,
    }),
  ),
];

describe("sendMessage against a local fake Zalo server (L47 sender leg)", () => {
  it("control: a 200 ok:true envelope resolves after one JSON POST to /bot<TOKEN>/sendMessage (L47)", async () => {
    const f = await serve(okJson({ ok: true, result: { message_id: "m1" } }));
    await expect(sendMessage(TOKEN, "chat-1", "hi")).resolves.toBeUndefined();
    expect(f.requests).toEqual([
      { method: "POST", url: SEND_PATH, contentType: "application/json", body: expect.any(String) },
    ]);
    expect(JSON.parse(f.requests[0]!.body)).toEqual({ chat_id: "chat-1", text: "hi" });
  });

  it.each(CASES)("%s", async (_title, { answer, want, verdict, timeoutMs }) => {
    const f = await serve(answer);
    expectFailure(await failure(sendMessage(TOKEN, "chat-1", "hi", { timeoutMs })), want, verdict);
    // Exactly the one original request: never resent, never redirected.
    expect(f.requests.map((r) => r.url)).toEqual([SEND_PATH]);
  });

  it("A-22 row 15 (c): a closed port -> retry zalo_network, nothing received (L47)", async () => {
    const closed = await startFake(() => undefined);
    await closed.close();
    process.env.ZALO_BOT_API_BASE = closed.base;
    expectFailure(await failure(sendMessage(TOKEN, "chat-1", "hi")), only("network"), NETWORK);
    expect(closed.requests).toHaveLength(0);
  });

  it("A-23 (a) outside Z-6: a token failing TOKEN_RE -> dlq bot_unavailable, no request (L47)", async () => {
    const f = await serve(okJson({ ok: true, result: {} }));
    expectFailure(
      await failure(sendMessage("abc/../x?y=1", "chat-1", "hi")),
      only("invalid_token"),
      {
        action: "dlq",
        code: "bot_unavailable",
      },
    );
    expect(f.requests).toHaveLength(0);
  });

  it("A-23 (b) outside Z-6: base http://example.com -> dlq config_missing, nothing sent (L47)", async () => {
    const f = await serve(okJson({ ok: true, result: {} }));
    process.env.ZALO_BOT_API_BASE = "http://example.com";
    // A regression must never reach a real host: this stub would surface it as "network" instead.
    const fetchStub = vi.fn().mockRejectedValue(new Error("no request expected"));
    vi.stubGlobal("fetch", fetchStub);
    expectFailure(await failure(sendMessage(TOKEN, "chat-1", "hi")), only("invalid_base"), {
      action: "dlq",
      code: "config_missing",
    });
    expect(fetchStub).not.toHaveBeenCalled();
    expect(f.requests).toHaveLength(0);
  });
});
