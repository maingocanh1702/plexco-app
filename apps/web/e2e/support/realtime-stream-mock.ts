import { expect, type Page, type Route } from "@playwright/test";

/**
 * Stream mock for web live sync (lane L5, A14, A16): answers GET /api/realtime/subscribe for one
 * page, so install it AFTER installApiMock (the route registered last wins). Each subscribe
 * request is held unanswered until push() fulfils it with exactly one id-only frame (R-5); the
 * response then ends and the client's own backoff opens the next request, which is held again.
 */
export interface RealtimeFrameMock {
  type: string;
  sessionId: string;
  version: number;
}

export interface RealtimeStreamMock {
  /** Every subscribe URL the page requested, in order. */
  urls: string[];
  /** Answers the oldest held subscribe request with one `data:` frame. */
  push(frame: RealtimeFrameMock): Promise<void>;
}

export async function installRealtimeStreamMock(page: Page): Promise<RealtimeStreamMock> {
  const held: Route[] = [];
  const urls: string[] = [];
  await page.route("**/api/realtime/subscribe**", (route) => {
    urls.push(route.request().url());
    held.push(route);
  });
  return {
    urls,
    async push(frame) {
      await expect.poll(() => held.length).toBeGreaterThan(0);
      await held.shift()!.fulfill({
        status: 200,
        headers: {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-store",
        },
        body: `data: ${JSON.stringify(frame)}\n\n`,
      });
    },
  };
}
