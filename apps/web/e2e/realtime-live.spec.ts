import { expect, test, type Browser } from "@playwright/test";
import { localInput } from "./support/golden-path-helpers";

/**
 * LOCAL-ONLY p95 of web live sync (lane L5, readiness R-20, A15): host A (owner) edits a draft's
 * venue with the browser's own PUT while host B (co-admin, same club) watches its detail view. One
 * sample = A's PUT response to B's DOM showing the new venue, through the real stack (worker
 * dispatch, pg_notify, web LISTEN, SSE, authorized refetch). Skipped unless REALTIME_LIVE_BASE_URL
 * names a running dev-login `next dev`; run by support/realtime-live.config.ts, never in CI. Edits
 * are paced under the session-update bucket (20 per minute per tenant).
 */
const BASE = process.env.REALTIME_LIVE_BASE_URL;
const WARMUP = 2;
const SAMPLES = 30;
const PACE_MS = 3_200;
test.skip(!BASE, "local only: set REALTIME_LIVE_BASE_URL (see support/realtime-live.config.ts)");

async function signIn(browser: Browser, persona: RegExp) {
  const page = await (await browser.newContext({ baseURL: BASE })).newPage();
  page.setDefaultTimeout(120_000);
  await page.goto("/dev-login");
  await page.getByRole("button", { name: persona }).click();
  await page.waitForURL((url) => url.pathname !== "/dev-login");
  const { data } = await (await page.request.get("/api/auth/session")).json();
  const club = data.tenants.find((t: { name: string | null }) => t.name === "Dev Club");
  return { page, tenantId: club.tenantId as string, csrfToken: data.csrfToken as string };
}

test("REALTIME_P95: a host edit on A reaches B's live detail view", async ({ browser }) => {
  const a = await signIn(browser, /Chủ CLB/);
  const b = await signIn(browser, /Đồng quản trị/);
  expect(b.tenantId).toBe(a.tenantId);
  const run = Date.now().toString(36);
  await a.page.goto(`/c/${a.tenantId}`);
  await a.page.getByRole("link", { name: "+ Tạo buổi mới" }).click();
  await a.page.getByLabel("Môn thể thao").selectOption({ index: 1 });
  await a.page.getByLabel("Bắt đầu").fill(localInput(2, 18));
  await a.page.getByLabel("Kết thúc").fill(localInput(2, 20));
  await a.page.getByLabel("Tên sân / địa điểm").fill(`P95 ${run}`);
  await a.page.getByLabel("Địa chỉ", { exact: true }).fill(`1 P95 ${run}`);
  await a.page.getByLabel("Giá mỗi người (VND)").fill("100000");
  await a.page.getByRole("button", { name: "Tạo bản nháp" }).click();
  await a.page.waitForURL(/\/sessions\/[0-9a-f-]{36}$/);
  const path = new URL(a.page.url()).pathname;
  const api = `/api/sessions/${path.split("/").at(-1)}?tenant=${a.tenantId}`;
  await a.page.goto(`${path}/edit`); // the edit view is never live (R-13): A only writes

  const stream = b.page.waitForResponse((r) => r.url().includes("/api/realtime/subscribe"));
  await b.page.goto(path);
  expect((await stream).status()).toBe(200);
  await b.page.getByRole("tab", { name: "Chi tiết" }).click();
  await expect(b.page.getByRole("tabpanel")).toContainText(`P95 ${run}`);

  let version: number = await a.page.evaluate(
    async (url) => (await (await fetch(url)).json()).data.session.version,
    api,
  );
  const latencies: number[] = [];
  for (let i = 0; i < WARMUP + SAMPLES; i += 1) {
    const started = Date.now();
    const venue = `P95 ${run} #${i}`;
    const shown = b.page.waitForFunction(
      (text) => (document.body.innerText.includes(text) ? Date.now() : 0),
      venue,
      { polling: 10, timeout: 30_000 },
    );
    const put = await a.page.evaluate(
      async ({ url, csrf, body }) => {
        const res = await fetch(url, {
          method: "PUT",
          headers: { "content-type": "application/json", "x-csrf-token": csrf },
          body: JSON.stringify({ ...body, commandId: crypto.randomUUID() }),
          credentials: "same-origin",
          cache: "no-store",
        });
        return { at: Date.now(), status: res.status, body: await res.json() };
      },
      { url: api, csrf: a.csrfToken, body: { venueName: venue, expectedVersion: version } },
    );
    expect(put.status, JSON.stringify(put.body)).toBe(200);
    version = put.body.data.session.version;
    const at = (await (await shown).jsonValue()) as number;
    if (i >= WARMUP) latencies.push(at - put.at);
    await a.page.waitForTimeout(Math.max(0, PACE_MS - (Date.now() - started)));
  }
  const sorted = latencies.sort((x, y) => x - y);
  const rank = (p: number) => sorted[Math.ceil((p / 100) * sorted.length) - 1];
  const load = `1 edit per ${PACE_MS / 1000} s, 2 contexts, 1 tenant`;
  const summary = { n: sorted.length, p50: rank(50), p95: rank(95), p99: rank(99), max: rank(100) };
  console.log(`REALTIME_P95 ${JSON.stringify({ ...summary, load })}`);
  console.log(`REALTIME_SAMPLES_MS ${JSON.stringify(sorted)}`);
});
