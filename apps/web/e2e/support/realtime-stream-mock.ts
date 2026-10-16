import { createServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, type Page } from "@playwright/test";

/**
 * Stream mock for web live sync (lane L5, A14, A16; fix round 1 F3): one page's GET
 * /api/realtime/subscribe goes to a local SSE server that sends the headers and a `: hb` comment and
 * then holds the response open, like the real route. push() writes one id-only frame (R-5) to the
 * newest held response without ending it, so a refetch after push() can only come from that frame.
 * Install it AFTER installApiMock (the route registered last wins). The server closes with the page.
 */
export interface RealtimeFrameMock {
  type: string;
  sessionId: string;
  version: number;
}

export interface RealtimeStreamMock {
  /** Every subscribe URL the page requested, in order. */
  urls: string[];
  /** Writes one `data:` frame to the newest held stream; the response stays open. */
  push(frame: RealtimeFrameMock): Promise<void>;
}

export async function installRealtimeStreamMock(page: Page): Promise<RealtimeStreamMock> {
  const held: ServerResponse[] = [];
  const urls: string[] = [];
  const server = createServer((_request, response) => {
    response.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
    });
    response.write(": hb\n\n");
    held.push(response);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  page.once("close", () => server.close() && server.closeAllConnections());
  const { port } = server.address() as AddressInfo;
  await page.route("**/api/realtime/subscribe**", (route) => {
    urls.push(route.request().url());
    return route.continue({ url: `http://127.0.0.1:${port}/subscribe` });
  });
  return {
    urls,
    async push(frame) {
      await expect.poll(() => held.length).toBeGreaterThan(0);
      held.at(-1)!.write(`data: ${JSON.stringify(frame)}\n\n`);
    },
  };
}
