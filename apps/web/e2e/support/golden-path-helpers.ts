import { expect, type Page } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Test-only helpers for e2e/golden-path.spec.ts (local, opt-in; see golden-path.config.ts). Every
 * string matched here is the real vi copy rendered by the web app, not a test id.
 */

/**
 * Every session API call (/api/sessions...) spends the signed-in ACCOUNT's pre-authorization ceiling:
 * 60 per rolling 60 s (ACTOR_LIMIT in lib/session-command-route.ts), shared by all clubs and all runs.
 * A robot clicks far faster than a host, so one run (with the dev server's double fetches) lands
 * close to it and a second run right after would get 429 "Bạn thao tác quá nhanh". This test-only
 * pacer queues /api/sessions requests in the browser and holds each until fewer than `BUDGET` were
 * sent in the last 60 s. The timestamps live in a temp file so back-to-back runs share the window.
 * It adds no waiting when the host-speed pace stays under the budget.
 */
const WINDOW_MS = 60_000;
const BUDGET = 45; // margin of 15 below the server ceiling of 60
const PACE_FILE = join(tmpdir(), "plexco-golden-path-session-api-hits.json");

function recentHits(now: number): number[] {
  try {
    const hits = JSON.parse(readFileSync(PACE_FILE, "utf8")) as unknown;
    return Array.isArray(hits)
      ? hits.filter((t): t is number => typeof t === "number" && now - t < WINDOW_MS)
      : [];
  } catch {
    return [];
  }
}

export async function paceSessionApi(page: Page): Promise<void> {
  let queue: Promise<void> = Promise.resolve();
  await page.route(/\/api\/sessions(\/|\?|$)/, (route) => {
    const turn = queue.then(async () => {
      for (;;) {
        const now = Date.now();
        const hits = recentHits(now);
        if (hits.length < BUDGET) {
          writeFileSync(PACE_FILE, JSON.stringify([...hits, now]));
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, hits[0]! + WINDOW_MS - now + 50));
      }
    });
    queue = turn.catch(() => undefined);
    return turn.then(() => route.continue());
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
