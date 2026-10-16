import http from "node:http";
import type { AddressInfo } from "node:net";

/**
 * TEST-ONLY recorded-contract stub of the Zalo Bot API (readiness Z-20): a node:http server on
 * 127.0.0.1:0 answering POST /bot<token>/sendMessage with a reply scripted per chat_id, in the
 * envelope shape {ok, result, description, error_code} the client pins (client.ts:7-10). It
 * records every call it receives. Never pointed at a real token or a real Zalo endpoint.
 */
export type StubReply =
  | "ok"
  | "slow"
  | "malformed"
  | "oversize"
  | "reset"
  | "cut"
  | "no_ok"
  | { status: number }
  | { okFalse: number | null };

export interface StubCall {
  token: string;
  chatId: string;
  text: string;
}

export interface ZaloStub {
  base: string;
  calls: StubCall[];
  script: Map<string, StubReply>;
  close(): Promise<void>;
}

export async function startZaloStub(): Promise<ZaloStub> {
  const calls: StubCall[] = [];
  const script = new Map<string, StubReply>();
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const path = /^\/bot([^/]+)\/sendMessage$/.exec(req.url ?? "");
      if (req.method !== "POST" || !path) return void res.writeHead(404).end();
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, string>;
      calls.push({ token: path[1]!, chatId: body.chat_id!, text: body.text! });
      const reply = script.get(body.chat_id!) ?? "ok";
      const json = (value: unknown) =>
        res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(value));
      if (reply === "ok") return json({ ok: true, result: { message_id: `m${calls.length}` } });
      if (reply === "slow") return void setTimeout(() => json({ ok: true, result: {} }), 1_000);
      if (reply === "malformed") return void res.writeHead(200).end("{not json");
      if (reply === "oversize") return json({ ok: true, result: "x".repeat(70 * 1024) });
      if (reply === "reset") return void req.socket.destroy();
      if (reply === "cut") return void res.writeHead(200).write("{", () => req.socket.destroy());
      if (reply === "no_ok") return json({ result: {} });
      if ("status" in reply) return void res.writeHead(reply.status).end();
      const code = reply.okFalse === null ? {} : { error_code: reply.okFalse };
      return json({ ok: false, description: "scripted rejection", ...code });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    base: `http://127.0.0.1:${port}`,
    calls,
    script,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
