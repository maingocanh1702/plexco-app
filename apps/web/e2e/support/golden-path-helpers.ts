import { expect, type Page } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { API_TIMEOUT_MS } from "../../lib/api-client";
import { COMPILE_TIMEOUT_MS } from "./golden-path-timeouts";

/**
 * Test-only helpers for e2e/golden-path.spec.ts (local, opt-in; see golden-path.config.ts). Every
 * string matched here is the real vi copy rendered by the web app, not a test id.
 */

/**
 * Every session API call (/api/sessions...) spends the signed-in ACCOUNT's pre-authorization ceiling:
 * 60 per rolling 60 s (ACTOR_LIMIT in lib/session-command-route.ts), shared by all clubs and all runs;
 * a robot clicks far faster than a host and would get 429. This test-only pacer keeps the calls under
 * `BUDGET` (15 of margin), counted in a temp file shared by the tests and by back-to-back runs. Each
 * test first WAITS in test code until `room` slots are free: apiFetch aborts a request API_TIMEOUT_MS
 * after its fetch() call (lib/api-client.ts), so a hold inside a request would read as a product
 * timeout. The route handler is only a backstop: it never holds a request longer than MAX_HOLD_MS
 * and otherwise fails the test with a pacer error.
 */
const WINDOW_MS = 60_000;
const BUDGET = 45; // margin of 15 below the server ceiling of 60
const PACE_FILE = join(tmpdir(), "plexco-golden-path-session-api-hits.json");
const MAX_HOLD_MS = 8_000; // the backstop's longest hold of one request, queue time included
if (MAX_HOLD_MS >= API_TIMEOUT_MS) {
  throw new Error(
    `golden path pacer: the hold cap MAX_HOLD_MS (${MAX_HOLD_MS} ms) must stay under the client deadline API_TIMEOUT_MS (${API_TIMEOUT_MS} ms)`,
  );
}

function recentHits(now: number): number[] {
  try {
    const hits = JSON.parse(readFileSync(PACE_FILE, "utf8")) as unknown;
    return Array.isArray(hits)
      ? hits
          .filter((t): t is number => typeof t === "number" && now - t < WINDOW_MS)
          .sort((a, b) => a - b)
      : [];
  } catch {
    return [];
  }
}

/** Ms until at most `BUDGET - room` of the sorted `hits` are left in the window; 0 = free now. */
function msUntilFree(hits: number[], now: number, room: number): number {
  if (hits.length <= BUDGET - room) return 0;
  // The slot opens when this hit leaves the window; +50 ms of margin.
  return hits[hits.length - (BUDGET - room) - 1]! + WINDOW_MS - now + 50;
}

/**
 * `room` = the test's measured number of paced calls: it starts only when all of them fit. `room`
 * defaults to 1, today's rule (wait only for the next free slot), for callers that have not
 * measured their calls (public-card-hide-address.spec.ts, public-share-page.proof.ts); the golden
 * path tests pass their measured counts.
 */
export async function paceSessionApi(page: Page, room = 1): Promise<void> {
  if (!Number.isInteger(room) || room < 1 || room > BUDGET) {
    throw new Error(`golden path pacer: room must be an integer from 1 to ${BUDGET}, got ${room}`);
  }
  const now = Date.now();
  const hits = recentHits(now);
  const wait = msUntilFree(hits, now, room);
  if (wait > 0) {
    console.log(
      `golden path pacer: waiting ${(wait / 1000).toFixed(1)} s for ${room} free session API slots (${hits.length} of ${BUDGET} used in the last 60 s)`,
    );
    await sleep(wait);
  }
  let queue: Promise<void> = Promise.resolve();
  await page.route(/\/api\/sessions(\/|\?|$)/, (route) => {
    const queued = Date.now();
    const method = route.request().method();
    const { pathname } = new URL(route.request().url());
    const turn = queue.then(async () => {
      for (;;) {
        const now = Date.now();
        const hits = recentHits(now);
        const wait = msUntilFree(hits, now, 1);
        if (wait <= 0) {
          writeFileSync(PACE_FILE, JSON.stringify([...hits, now]));
          if (now - queued >= 100) {
            console.log(`golden path pacer: held ${method} ${pathname} ${now - queued} ms`);
          }
          return;
        }
        if (now - queued + wait > MAX_HOLD_MS) {
          throw new Error(
            `golden path pacer: ${method} ${pathname} would be held ${((now - queued + wait) / 1000).toFixed(1)} s ` +
              `(${hits.length} of ${BUDGET} calls in the last 60 s), over MAX_HOLD_MS ${MAX_HOLD_MS} ms ` +
              `(API_TIMEOUT_MS ${API_TIMEOUT_MS} ms): raise this test's room in paceSessionApi(page, room)`,
          );
        }
        await sleep(wait);
      }
    });
    queue = turn.catch(() => undefined);
    return turn.then(
      () => route.continue(),
      async (error) => {
        await route.abort().catch(() => undefined);
        throw error;
      },
    );
  });
}

/** Returns `shot(name)`: a numbered PNG into GOLDEN_PATH_SCREENSHOT_DIR, or a no-op when it is unset. */
export function screenshotter(page: Page): (name: string) => Promise<void> {
  const dir = process.env.GOLDEN_PATH_SCREENSHOT_DIR;
  let n = 0;
  if (dir) mkdirSync(dir, { recursive: true });
  return async (name) => {
    if (!dir) return;
    n += 1;
    const file = `${String(n).padStart(2, "0")}-${name.replace(/[^a-z0-9-]+/gi, "-")}.png`;
    await page.screenshot({ path: join(dir, file), fullPage: true });
  };
}

/** `yyyy-MM-ddTHH:mm` (datetime-local value) for `daysAhead` days from now at `hour`:00, in the runner's clock. */
export function localInput(daysAhead: number, hour: number): string {
  const d = new Date(Date.now() + daysAhead * 86_400_000);
  const pad = (v: number) => String(v).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(hour)}:00`;
}

/** The roster row (an <li>) of one player, found by the name in its remove-button label. */
export function rosterRow(page: Page, player: string) {
  return page
    .getByRole("listitem")
    .filter({ has: page.getByRole("button", { name: `Gỡ ${player}` }) });
}

/** Asserts a toast: the page also has an always-present empty role=status live region, so filter by text. */
export async function expectToast(page: Page, text: string): Promise<void> {
  await expect(page.getByRole("status").filter({ hasText: text })).toBeVisible();
}

/** Adds a player by display name (host roster form) and waits for the confirmation toast. */
export async function addPlayer(page: Page, name: string): Promise<void> {
  await page.getByRole("button", { name: "Thêm người chơi" }).click();
  await page.getByLabel("Tên hiển thị").fill(name);
  await page.getByRole("button", { name: "Thêm", exact: true }).click();
  await expectToast(page, `Đã thêm ${name}`);
  await expect(rosterRow(page, name)).toBeVisible();
}

/**
 * Records a CASH payment for one player through the 3-step mark-paid sheet. `amount` = the digits
 * to type, or undefined to keep the server's default (the full remaining balance). Returns the
 * amount the review step showed in the input (dot-grouped, e.g. "60.000").
 */
export async function payCash(page: Page, player: string, amount?: string): Promise<string> {
  await page.getByRole("checkbox", { name: `Chọn ${player} để gạch nợ` }).check();
  await page.getByRole("button", { name: "Gạch nợ (1)" }).click();
  const sheet = page.getByRole("dialog");
  await expect(sheet).toContainText("Gạch nợ cho 1 người");
  await sheet.getByRole("radio", { name: "Tiền mặt" }).check();
  await sheet.getByRole("button", { name: "Xem trước" }).click();
  await expect(sheet).toContainText("Xác nhận số tiền");
  const input = sheet.getByLabel(`Số tiền cho ${player}`);
  if (amount !== undefined) await input.fill(amount);
  const shown = await input.inputValue();
  await sheet.getByRole("button", { name: "Xác nhận", exact: true }).click();
  await expect(sheet).toContainText("Đã ghi nhận thanh toán");
  await sheet.getByRole("button", { name: "Xong" }).click();
  await expect(sheet).toBeHidden();
  return shown;
}

/** Opens the Close or Cancel confirm dialog from the action bar and confirms it; returns the dialog locator. */
export async function confirmTransition(page: Page, action: "close" | "cancel") {
  const bar = action === "close" ? "Đóng buổi" : "Huỷ buổi";
  await page.getByRole("button", { name: bar, exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText(action === "close" ? "Đóng buổi này?" : "Huỷ buổi này?");
  await dialog.getByRole("button", { name: bar, exact: true }).click();
  return dialog;
}

/** What `GET /api/auth/session` reports for the page's own cookie: its person, its CSRF secret, its clubs. */
export interface PersonaSession {
  personId: string;
  csrfToken: string;
  tenants: { tenantId: string; name: string | null }[];
}

/** The page's current session, or null when it is signed out (a cold dev-server compile can be slow). */
async function readSession(page: Page): Promise<PersonaSession | null> {
  const res = await page.request.get("/api/auth/session", { timeout: COMPILE_TIMEOUT_MS });
  if (!res.ok()) return null;
  const data = (await res.json())?.data;
  if (!data?.personId) return null;
  return { personId: data.personId, csrfToken: data.csrfToken, tenants: data.tenants ?? [] };
}

/**
 * Signs the page in as a dev-login persona (the button name, e.g. /Người chơi/) and returns that
 * persona's own session. Switching persona rotates the session (e2e/dev-login-browser.spec.ts), so a
 * click that left the previous person signed in fails here instead of running a journey as the wrong one.
 */
export async function signInAsPersona(page: Page, persona: RegExp): Promise<PersonaSession> {
  const before = await readSession(page);
  await page.goto("/dev-login");
  await expect(page.getByRole("note")).toContainText("CHỈ DÀNH CHO DEV");
  await page.getByRole("button", { name: persona }).click();
  // The cookie rotates when the persona button's POST chain ends: wait until another person answers.
  await expect
    .poll(async () => (await readSession(page))?.personId ?? before?.personId ?? null)
    .not.toBe(before?.personId ?? null);
  const session = await readSession(page);
  if (!session) throw new Error(`no session after the persona button ${persona}`);
  return session;
}
