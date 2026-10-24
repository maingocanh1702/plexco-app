import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import {
  expectToast,
  localInput,
  paceSessionApi,
  signInAsPersona,
} from "./support/golden-path-helpers";
import { COMPILE_TIMEOUT_MS } from "./support/golden-path-timeouts";

/**
 * LOCAL-ONLY real-stack proof (lane L35) of the B1 host option "hide exact address until confirmed"
 * on the PUBLIC surface; design D1-D4 of
 * docs/sessions/web-mvp-phase3-readiness-p3-public-card-hide-address-real-stack-proof.md.
 * Never run in CI: playwright.config.ts ignores this file, and it is skipped unless
 * PUBLIC_CARD_PROOF_BASE_URL is set, which only e2e/public-card-hide-address-proof.sh does (with
 * e2e/public-card-hide-address.config.ts and the scratch database plexco_l35_scratch, always dropped).
 *
 * One serial run: (1) the owner persona prepares three public sessions through the product's own
 * writers, all BEFORE the enable (the enable CLI refuses an unacked backlog older than 30 minutes);
 * (2) the operator approves the club alias and enables public_sessions on the scratch database, whose
 * rebuild projects the three sessions; (3) an anonymous visitor checks each card.
 */
const BASE = process.env.PUBLIC_CARD_PROOF_BASE_URL;
test.skip(!BASE, "local proof: run apps/web/e2e/public-card-hide-address-proof.sh");
test.use({ baseURL: BASE });

const SCRATCH_DB_PATH = "/plexco_l35_scratch";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HIDE_LABEL = "Ẩn địa chỉ chính xác đến khi xác nhận";

// ASCII strings, unique per run and per case. The token `Rieng <code> <run>` lives ONLY in its case's
// two venue fields (a substring of no area, of the alias or of another case's strings: checked in
// test 1), so its absence proves the hidden venue never reached the visitor; area and alias are the
// positive controls that the card rendered.
const run = Date.now().toString(36);
const ALIAS = `CLB L35 ${run}`;
type CaseKey = "on" | "off" | "default";
interface ProofCase {
  key: CaseKey;
  area: string;
  venueName: string;
  venueAddress: string;
  token: string;
  /** Tick the hide box in the create form. */
  hideAtCreate: boolean;
  /** Then untick it on the edit page and save (an explicit false through updateSession). */
  untickOnEdit: boolean;
  /** What the anonymous visitor must get: true = no venue name and no address anywhere. */
  hidden: boolean;
}
function proofCase(key: CaseKey, code: string, hideAtCreate: boolean, untickOnEdit: boolean) {
  return {
    key,
    area: `Khu Kiem Tra ${code} ${run}`,
    venueName: `San Rieng ${code} ${run}`,
    venueAddress: `12 Duong Rieng ${code} ${run}`,
    token: `Rieng ${code} ${run}`,
    hideAtCreate,
    untickOnEdit,
    hidden: hideAtCreate && !untickOnEdit,
  } satisfies ProofCase;
}
const CASES: readonly ProofCase[] = [
  proofCase("on", "On", true, false), // (a) ticked at create
  proofCase("off", "Off", true, true), // (b) ticked at create, unticked on the edit page
  // (c) untouched: the form posts no key and createSession stores `?? false`, the same value
  // migration 0067's column default gives every existing session (D-4: the venue stays public).
  proofCase("default", "Def", false, false),
];

// Filled by test 1, read by the later tests of this serial block (one worker, one module instance).
const fixture: { tenantId: string; sessionIds: Partial<Record<CaseKey, string>> } = {
  tenantId: "",
  sessionIds: {},
};

/**
 * Runs one operator CLI from the repo root with DATABASE_URL_MIGRATION = the scratch database's
 * superuser URL, the only credential either CLI reads; a non-zero exit throws (fail closed). The
 * output is attached and printed as evidence: both CLIs print JSON lines, never a connection string.
 */
async function runOperatorCli(label: string, args: string[], dbUrl: string): Promise<string> {
  const info = test.info();
  let output = "";
  try {
    output = execFileSync(process.execPath, args, {
      cwd: resolve(dirname(info.file), "../../.."),
      env: { ...process.env, DATABASE_URL_MIGRATION: dbUrl },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return output;
  } catch (error) {
    const failed = error as { status?: number | null; stdout?: string; stderr?: string };
    output = `exit ${String(failed.status)}\n${failed.stdout ?? ""}${failed.stderr ?? ""}`;
    throw error;
  } finally {
    await info.attach(`${label} stdout`, { body: output, contentType: "text/plain" });
    console.log(`[operator] ${label}: ${output.trim()}`);
  }
}

const jsonLines = (output: string): unknown[] =>
  output
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as unknown);

test.describe.serial("public card: the exact address is hidden only when the host chose so", () => {
  test("host prepares three public sessions", async ({ page }) => {
    for (const c of CASES) {
      const shownElsewhere = [
        ALIAS,
        ...CASES.flatMap((o) => (o === c ? [o.area] : [o.area, o.venueName, o.venueAddress])),
      ];
      const clashes = shownElsewhere.filter((s) => s.includes(c.token));
      expect(clashes, `the ${c.key} token is unique`).toEqual([]);
    }
    await paceSessionApi(page); // three creates and one update, under the per-account ceiling
    const owner = await signInAsPersona(page, /Chủ CLB/);
    const tenantId = owner.tenants.find((t) => t.name === "Dev Club")?.tenantId ?? "";
    expect(tenantId, "the seeded Dev Club's tenant id").toMatch(UUID_RE);
    fixture.tenantId = tenantId;

    await test.step("set the club's public alias (pending until the operator approves it)", async () => {
      const res = await page.request.patch(`/api/onboarding/club?tenant=${tenantId}`, {
        headers: { "x-csrf-token": owner.csrfToken },
        data: { commandId: randomUUID(), publicAlias: ALIAS },
        timeout: COMPILE_TIMEOUT_MS,
      });
      expect(res.status(), await res.text()).toBe(200);
      const club = (await res.json())?.data?.club;
      expect(club?.publicAlias).toBe(ALIAS);
      expect(club?.publicAliasStatus).toBe("pending");
    });

    for (const c of CASES) {
      await test.step(`case ${c.key}: create through the host form, read back, publish`, async () => {
        await page.goto(`/c/${tenantId}/sessions/new`);
        await expect(page.getByRole("heading", { name: "Tạo buổi chơi mới" })).toBeVisible();
        const sport = page.getByLabel("Môn thể thao");
        // the first real sport after the "— Chọn môn —" placeholder
        await expect(sport.locator("option")).not.toHaveCount(1);
        await sport.selectOption({ index: 1 });
        await page.getByLabel("Bắt đầu").fill(localInput(2, 18));
        await page.getByLabel("Kết thúc").fill(localInput(2, 20));
        await page.getByLabel("Tên sân / địa điểm").fill(c.venueName);
        await page.getByLabel("Địa chỉ", { exact: true }).fill(c.venueAddress);
        await page.getByLabel(/^Khu vực/).fill(c.area);
        await expect(page.getByLabel(HIDE_LABEL)).not.toBeChecked(); // the form default
        if (c.hideAtCreate) await page.getByLabel(HIDE_LABEL).check();
        await page.getByLabel("Giá mỗi người (VND)").fill("100000");
        await page.getByLabel("Không giới hạn số chỗ").uncheck(); // public needs finite slots
        await page.getByLabel("Số chỗ tối đa").fill("8");
        await page.getByLabel(/^Hiển thị/).selectOption("public");
        await page.getByLabel(/^Cách tham gia/).selectOption("open");
        await page.getByRole("button", { name: "Tạo bản nháp" }).click();
        await page.waitForURL(/\/sessions\/[0-9a-f-]{36}$/);
        const sessionId = /\/sessions\/([0-9a-f-]{36})$/.exec(page.url())?.[1] ?? "";
        expect(sessionId, "the session id in the host URL").toMatch(UUID_RE);
        fixture.sessionIds[c.key] = sessionId;
        const detail = `/c/${tenantId}/sessions/${sessionId}`;

        if (c.untickOnEdit) {
          await page.goto(`${detail}/edit`);
          await expect(page.getByLabel(HIDE_LABEL)).toBeChecked(); // create stored true
          await page.getByLabel(HIDE_LABEL).uncheck();
          await page.getByRole("button", { name: "Lưu thay đổi" }).click();
          await page.waitForURL((url) => url.pathname === detail);
        }

        // Positive control (T2): the stored draft, re-read from the server on a fresh page, carries
        // the typed venue, the area, public visibility and the case's option before any projection.
        await page.goto(`${detail}/edit`);
        await expect(page.getByLabel("Tên sân / địa điểm")).toHaveValue(c.venueName);
        await expect(page.getByLabel("Địa chỉ", { exact: true })).toHaveValue(c.venueAddress);
        await expect(page.getByLabel(/^Khu vực/)).toHaveValue(c.area);
        await expect(page.getByLabel(/^Hiển thị/)).toHaveValue("public");
        await expect(page.getByLabel(HIDE_LABEL)).toBeChecked({ checked: c.hidden });

        // Publish as the product does: draft -> open, which emits the routed session.published.
        await page.goto(detail);
        await page.getByRole("button", { name: "Đăng kèo", exact: true }).click();
        const dialog = page.getByRole("dialog");
        await expect(dialog).toContainText("Đăng kèo này?");
        await dialog.getByRole("button", { name: "Đăng kèo", exact: true }).click();
        await expectToast(page, "Đã đăng kèo.");
        await expect(page.getByText("Đang mở", { exact: true })).toBeVisible();
      });
    }
  });

  test("operator approves the alias and enables public_sessions on the scratch database", async () => {
    // FIRST, fail closed: the enable CLI has no database check, so this URL alone keeps it away from
    // plexco, plexco_smoke and every real database (an unset or malformed URL throws here).
    const dbUrl = process.env.PUBLIC_CARD_PROOF_DB_URL ?? "";
    expect(new URL(dbUrl).pathname, "PUBLIC_CARD_PROOF_DB_URL is the scratch DB").toBe(
      SCRATCH_DB_PATH,
    );
    expect(fixture.tenantId, "test 1 prepared the club").toMatch(UUID_RE);
    expect(Object.keys(fixture.sessionIds).sort(), "test 1 prepared three sessions").toEqual([
      "default",
      "off",
      "on",
    ]);

    const moderate = "scripts/public-alias-moderate.mjs";
    const pending = jsonLines(
      await runOperatorCli("public-alias-moderate list", [moderate, "list"], dbUrl),
    ) as { tenantId?: string; publicAlias?: string; aliasSha256?: string }[];
    const mine = pending.filter((row) => row.tenantId === fixture.tenantId);
    expect(mine, "exactly one pending alias for Dev Club").toHaveLength(1);
    expect(mine[0]?.publicAlias).toBe(ALIAS);
    const digest = mine[0]?.aliasSha256 ?? "";
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    const approveArgs = [moderate, "approve", "--tenant", fixture.tenantId, "--sha256", digest];
    const approved = jsonLines(
      await runOperatorCli("public-alias-moderate approve", approveArgs, dbUrl),
    );
    expect(approved).toEqual([{ tenantId: fixture.tenantId, status: "approved" }]);

    const enableArgs = ["scripts/outbox-projector-enable.mjs", "enable"];
    const enabled = jsonLines(
      await runOperatorCli(
        "outbox-projector-enable",
        [...enableArgs, "--projector", "public_sessions"],
        dbUrl,
      ),
    );
    // changed: the projector was OFF until now, so nothing was public before this step. The scratch
    // DB holds exactly these three candidates (the seed makes no session); the rebuild passed each
    // one to the masking writer, synchronously, before this line.
    expect(enabled).toHaveLength(1);
    expect(enabled[0]).toMatchObject({
      projector: "public_sessions",
      changed: true,
      rebuilt_sessions: 3,
    });
  });

  // U3b: anonymous visitor checks per case
});
