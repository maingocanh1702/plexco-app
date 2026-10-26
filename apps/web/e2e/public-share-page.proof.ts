import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { localInput, paceSessionApi, signInAsPersona } from "./support/golden-path-helpers";
import { COMPILE_TIMEOUT_MS } from "./support/golden-path-timeouts";

/**
 * LOCAL-ONLY real-stack proof (lane L39; readiness D5; D6's discovery-role case is not run: see the
 * config). Never run in CI: the name is outside
 * Playwright's testMatch and it is skipped unless SHARE_PROOF_BASE_URL is set. A slug is a bearer
 * token: it never goes into a title, a console line or an assertion message.
 */
const BASE = process.env.SHARE_PROOF_BASE_URL;
test.skip(!BASE, "local proof: run apps/web/e2e/public-share-page-proof.sh");
test.use({ baseURL: BASE });

const SCRATCH = "/plexco_l39_scratch";
const DB_URL = process.env.SHARE_PROOF_DB_URL ?? ""; // the scratch superuser URL, never printed
const ORIGIN = new URL(BASE ?? "http://localhost").origin;
const pathOf = (url = "") => new URL(url).pathname;
const WARN = "Tạo liên kết mới sẽ làm liên kết cũ của kèo này ngừng hoạt động ngay.";
const ENABLE = ["scripts/outbox-projector-enable.mjs", "enable", "--projector", "public_sessions"];
const run = Date.now().toString(36);
// ASCII, unique per run and case; "Rieng <code>" is in a case's venue name and address ONLY.
const s = (code: string, field: string) => `${field} ${code} ${run}`;
const ids = { On: "", Off: "" };
const paths = { off1: "", off2: "", on: "" }; // share paths are bearer tokens: never printed
let tenantId = "";
let host: Page; // the signed-in owner; every other context is anonymous
let anon: BrowserContext;
let first404 = "";

// D2 MEASURED: not measured yet (written without running): Cache-Control is Next's force-dynamic
// header (D2's production form or the `next dev` form); Referrer-Policy is the global one of
// next.config.mjs (the page's meta says no-referrer); there is no X-Robots-Tag header (D2).
function expectPinned(h: Record<string, string>) {
  expect(h["cache-control"]).toMatch(
    /^(private, no-cache, )?no-store, (max-age=0, )?must-revalidate$/,
  );
  expect(h["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  expect(h["x-robots-tag"], "no X-Robots-Tag header (D2)").toBeUndefined();
  expect(h["content-type"]).toBe("text/html; charset=utf-8");
  expect(h["x-content-type-options"]).toBe("nosniff");
}
/** A meta tag's content by a string scan (Semgrep CE blocks a RegExp built from data, C11). */
const meta = (html: string, name: string) => {
  const key = `<meta name="${name}" content="`;
  const at = html.indexOf(key);
  return at < 0 ? undefined : html.slice(at + key.length, html.indexOf('"', at + key.length));
};
/** The slice of pg the suspension needs: pg is a dependency of packages/db only, not of apps/web. */
type PgClient = { connect(): Promise<void>; query(q: string, v: unknown[]): Promise<unknown> };
type Pg = { Client: new (o: { connectionString: string }) => PgClient & { end(): Promise<void> } };
const root = () => resolve(dirname(test.info().file), "../../.."); // the repo root
/** One CLI or script with the scratch superuser URL (DATABASE_URL_MIGRATION); its JSON lines. */
const operator = (args: string[], cwd = root()) => {
  const env = { ...process.env, DATABASE_URL_MIGRATION: DB_URL };
  const out = execFileSync(process.execPath, args, { cwd, env, encoding: "utf8" });
  const rows = out.trim().split("\n").filter(Boolean);
  return rows.map((line) => JSON.parse(line) as unknown);
};

/** One anonymous GET in a new page of the cookie-less context: status, headers, HTML, origins. */
async function visit(path: string) {
  const page = await anon.newPage();
  const origins: string[] = [];
  page.on("request", (req) => origins.push(new URL(req.url()).origin));
  const res = await page.goto(path);
  const html = (await res?.text()) ?? "";
  await page.waitForLoadState("networkidle");
  const link = page.locator('a[href^="/discover/"]').first();
  const href = await link.getAttribute("href", { timeout: 2_000 }).catch(() => null);
  return { status: res?.status() ?? 0, headers: res?.headers() ?? {}, html, href, origins };
}

/** A miss: a 404 with the pinned headers; cache-control and body (slug replaced) equal the first. */
async function expect404(path: string) {
  const r = await visit(path);
  expect(r.status, "a miss is a 404").toBe(404);
  expectPinned(r.headers);
  const body = r.html.split(path.slice("/session/".length)).join("SLUG"); // the slug is in the RSC payload
  const seen = `${r.headers["cache-control"]}\n${body}`;
  first404 ||= seen;
  expect(seen === first404, "404 cache-control and body equal the first 404 seen").toBe(true);
}

async function createAndPublish(code: keyof typeof ids) {
  await host.goto(`/c/${tenantId}/sessions/new`);
  await host.getByLabel("Môn thể thao").selectOption({ index: 1 }); // waits for the sports list
  await host.getByLabel("Bắt đầu").fill(localInput(2, 18));
  await host.getByLabel("Kết thúc").fill(localInput(2, 20));
  await host.getByLabel("Tên sân / địa điểm").fill(s(code, "San Rieng"));
  await host.getByLabel("Địa chỉ", { exact: true }).fill(s(code, "12 Duong Rieng"));
  await host.getByLabel(/^Khu vực/).fill(s(code, "Khu Chia Se"));
  if (code === "On") await host.getByLabel("Ẩn địa chỉ chính xác đến khi xác nhận").check();
  await host.getByLabel("Giá mỗi người (VND)").fill("100000");
  await host.getByLabel("Không giới hạn số chỗ").uncheck(); // public needs finite slots
  await host.getByLabel("Số chỗ tối đa").fill("8");
  await host.getByLabel(/^Hiển thị/).selectOption("public");
  await host.getByLabel(/^Cách tham gia/).selectOption("open");
  await host.getByRole("button", { name: "Tạo bản nháp" }).click();
  await host.waitForURL(/\/sessions\/[0-9a-f-]{36}$/);
  const id = /\/sessions\/([0-9a-f-]{36})$/.exec(host.url())?.[1] ?? "";
  await host.getByRole("button", { name: "Đăng kèo", exact: true }).click();
  await host.getByRole("dialog").getByRole("button", { name: "Đăng kèo", exact: true }).click();
  await expect(host.getByText("Đang mở", { exact: true })).toBeVisible();
  return id;
}

/** The host opens the Details tab, presses the control and confirms; returns the link's path. */
async function mintLink(code: keyof typeof ids) {
  await host.goto(`/c/${tenantId}/sessions/${ids[code]}`);
  await host.getByRole("tab", { name: "Chi tiết" }).click();
  await host.getByRole("button", { name: "Tạo liên kết chia sẻ" }).click();
  const warn = host.getByText(WARN);
  await expect(warn).toBeVisible();
  const confirm = warn.locator("..").getByRole("button", { name: "Xác nhận" });
  const link = host.getByLabel("Liên kết chỉ hiện một lần; hãy sao chép ngay.");
  // A 409 (not projected yet) keeps the control open with an error: press again, bounded.
  await expect(async () => {
    if (await confirm.isVisible()) await confirm.click({ timeout: 3_000 });
    await expect(link).toBeVisible({ timeout: 10_000 });
  }).toPass({ timeout: 300_000, intervals: [2_000] });
  const path = new URL(await link.inputValue()).pathname;
  expect(/^\/session\/[A-Za-z0-9_-]{22}$/.test(path), "share link shape").toBe(true);
  return path;
}

test.describe.serial("public share page: the link and its uniform 404", () => {
  test("host prepares two public sessions and the club alias", async ({ browser }) => {
    for (const name of ["SHARE_PROOF_DB_URL", "DATABASE_URL", "DISCOVERY_DATABASE_URL"]) {
      expect(pathOf(process.env[name]), `${name} is the scratch DB`).toBe(SCRATCH);
    }
    host = await (await browser.newContext({ baseURL: BASE })).newPage();
    anon = await browser.newContext({ baseURL: BASE });
    await paceSessionApi(host);
    const owner = await signInAsPersona(host, /Chủ CLB/);
    tenantId = owner.tenants.find((t) => t.name === "Dev Club")?.tenantId ?? "";
    expect(tenantId, "the seeded Dev Club's tenant id").toBeTruthy();
    const alias = await host.request.patch(`/api/onboarding/club?tenant=${tenantId}`, {
      headers: { "x-csrf-token": owner.csrfToken },
      data: { commandId: randomUUID(), publicAlias: `CLB L39 ${run}` },
      timeout: COMPILE_TIMEOUT_MS,
    });
    expect(alias.status(), await alias.text()).toBe(200);
    for (const code of ["On", "Off"] as const) ids[code] = await createAndPublish(code);
  });

  test("operator enables public_sessions on the scratch database only", () => {
    // FIRST, fail closed: the enable CLI has no database check; this URL alone keeps it off real data.
    expect(pathOf(DB_URL), "SHARE_PROOF_DB_URL is the scratch DB").toBe(SCRATCH);
    const moderate = "scripts/public-alias-moderate.mjs";
    const rows = operator([moderate, "list"]) as { tenantId?: string; aliasSha256?: string }[];
    const mine = rows.filter((row) => row.tenantId === tenantId);
    expect(mine, "one pending alias for Dev Club").toHaveLength(1);
    operator([moderate, "approve", "--tenant", tenantId, "--sha256", mine[0]?.aliasSha256 ?? ""]);
    expect(operator(ENABLE)[0]).toMatchObject({ changed: true, rebuilt_sessions: 2 });
  });

  test("e1: the OFF link opens anonymously with the pinned headers", async () => {
    paths.off1 = await mintLink("Off"); // the untouched form is the D-4 default: venue shown
    const r = await visit(paths.off1);
    expect(r.status).toBe(200);
    expectPinned(r.headers);
    expect(meta(r.html, "robots")).toBe("noindex, nofollow");
    expect(meta(r.html, "referrer")).toBe("no-referrer");
    expect(r.html.includes(s("Off", "San Rieng")), "the venue name is shown").toBe(true);
    expect(r.href, "the card links to the discover detail").toMatch(/^\/discover\/[^/]+$/);
    expect(
      r.origins.every((o) => o === ORIGIN),
      "no request leaves the origin",
    ).toBe(true);
  });

  test("e3: hide ON shows the area only; no venue name or address in the HTML", async () => {
    paths.on = await mintLink("On");
    const r = await visit(paths.on);
    expect(r.status).toBe(200);
    expect(r.html.includes(s("On", "Khu Chia Se")), "the area is shown").toBe(true);
    expect(r.html.includes(s("On", "Rieng")), "neither the venue name nor the address").toBe(false);
  });

  test("e2: unknown, malformed, rotated, private, suspended slugs: one 404", async () => {
    await expect404(`/session/${randomBytes(16).toString("base64url")}`); // the reference: 22 chars
    await expect404("/session/notAShareSlug"); // malformed: not 22 characters
    paths.off2 = await mintLink("Off"); // a second link revokes the first
    await expect404(paths.off1);
    expect((await visit(paths.off2)).status, "the new link is live").toBe(200);
    await host.goto(`/c/${tenantId}/sessions/${ids.On}`);
    await host.getByRole("button", { name: "Chuyển về Riêng tư" }).click();
    await host.getByRole("button", { name: "Chuyển về Riêng tư" }).last().click(); // the dialog's
    await expect(host.getByText("Hiển thị: Riêng tư")).toBeVisible();
    // No dispatcher runs in this proof: the enable CLI's re-run is the canonical rebuild
    // (outbox-projector-enable.mjs:28-35); it re-projects the session the update made private.
    expect(operator(ENABLE)[0]).toMatchObject({ changed: false });
    await expect404(paths.on);
    expect((await anon.request.get(paths.off2)).status(), "live before the suspension").toBe(200);
    // Last: suspending the tenant ends the host's access. pg is a dependency of packages/db only.
    expect(pathOf(DB_URL), "SHARE_PROOF_DB_URL is the scratch DB").toBe(SCRATCH);
    const { Client } = createRequire(resolve(root(), "packages/db/package.json"))("pg") as Pg;
    const db = new Client({ connectionString: DB_URL });
    await db.connect();
    const suspend = "UPDATE tenants SET status = 'suspended' WHERE id = $1";
    await db.query(suspend, [tenantId]).finally(() => db.end());
    await expect404(paths.off2);
  });
});
