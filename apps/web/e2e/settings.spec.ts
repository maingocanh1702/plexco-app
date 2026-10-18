import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Route } from "@playwright/test";
import { TENANT_ID, signIn } from "./support/session-api-mock";

/**
 * Settings screens (lane M4): /me/settings, /me/link and /c/[tenantId]/settings. Same harness as
 * sessions.spec.ts: every /api call is answered in the browser via page.route; the server renders
 * pages only (its one DB lookup is answered by fake-postgres.mjs). Nothing real is persisted.
 *
 * The mock keeps the routes' idempotency semantics where a test depends on them: PATCH club and
 * POST connect REPLAY a processed commandId (apply nothing, answer the current state), and
 * `loseResponseNext` applies a request and then drops its response, the "uncertain failure" case.
 * `holdNext` parks the next matching request until the test releases it (a reload that lands late).
 * Like the routes' csrfOk, a non-GET request must carry the csrfToken the session route hands out
 * (`csrfToken`), or it is refused 403 CSRF_INVALID before anything is applied.
 */
interface Call {
  method: string;
  path: string;
  body: Record<string, unknown> | null;
  /** The x-csrf-token header (apiFetch sets it on every non-GET request). */
  csrf: string | null;
}

const envelope = (data: unknown) => ({ data, error: null, meta: { requestId: "req-e2e" } });
const failure = (code: string, statusCode: number, message = "x") => ({
  data: null,
  error: { code, message, statusCode },
  meta: { requestId: "req-e2e-err" },
});

const ZALO_ID = "11111111-aaaa-4aaa-8aaa-111111111111";
const DETACH_ZALO = `/api/me/channels/${ZALO_ID}/detach`;
const TOKEN = "super-secret-token";
/** The CSRF secret the session starts with, and the one a test rotates it to. */
const CSRF = "e2e-csrf-secret";
const ROTATED_CSRF = "e2e-csrf-rotated";

interface World {
  calls: Call[];
  /**
   * The caller's role as GET /api/auth/session lists it. The UI never decides on a role (DD-56; see
   * lib/role-read-guard.test.ts, which is also why this field is not called `role`): the API does.
   */
  sessionRole: string;
  /**
   * The CSRF secret GET /api/auth/session hands out NOW. A test changes it to model a session whose
   * secret moved on (a sign-in in another tab) while the page still holds the old one.
   */
  csrfToken: string;
  profile: { displayName: string | null; gender: string | null; genderConsent: boolean };
  /** genderCollection of GET / PATCH /api/me/profile (the route's GENDER_COLLECTION_ENABLED). */
  genderCollection: boolean;
  channels: { id: string; platform: string; status: string; createdAt: string }[];
  club: Record<string, unknown>;
  zalo: Record<string, unknown>;
  /** Status the next NEW connect answers with a 200 (the route answers "error" when setWebhook fails). */
  connectStatus: string;
  /** Next response for "METHOD path" is replaced by this error; nothing is applied. */
  failNext: Map<string, { code: string; status: number; message?: string }>;
  /** "METHOD path": the request IS applied, then its response is lost (the connection drops). */
  loseResponseNext: Set<string>;
  /** "METHOD path": the next such request waits for this promise before it is answered. */
  holdNext: Map<string, Promise<void>>;
  zaloForbidden: boolean;
  /** commandIds already processed by PATCH club / POST connect (a repeat is a replay). */
  clubCommands: Set<string>;
  connectCommands: Set<string>;
}

async function install(page: Page): Promise<World> {
  const world: World = {
    calls: [],
    sessionRole: "owner",
    csrfToken: CSRF,
    profile: { displayName: "Lan Nguyễn", gender: null, genderConsent: false },
    genderCollection: false,
    channels: [
      { id: ZALO_ID, platform: "zalo", status: "active", createdAt: "2026-10-01T00:00:00.000Z" },
      {
        id: "22222222-aaaa-4aaa-8aaa-222222222222",
        platform: "messenger",
        status: "inactive",
        createdAt: "2026-09-01T00:00:00.000Z",
      },
    ],
    club: {
      slug: "clb",
      name: "CLB Cầu Lông Test",
      timezone: "Asia/Ho_Chi_Minh",
      locale: "vi",
      defaultSportKey: "badminton",
      defaultPriceAmount: 50000,
      defaultVisibility: "private",
    },
    zalo: { status: "not_connected", verifiedAt: null, lastSetwebhookAt: null, webhookUrl: null },
    connectStatus: "registered",
    failNext: new Map(),
    loseResponseNext: new Set(),
    holdNext: new Map(),
    zaloForbidden: false,
    clubCommands: new Set(),
    connectCommands: new Set(),
  };
  const json = (route: Route, status: number, body: unknown) =>
    route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const raw = request.postData();
    const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
    const path = url.pathname;
    const csrf = request.headers()["x-csrf-token"] ?? null;
    world.calls.push({ method, path, body, csrf });
    const key = `${method} ${path}`;
    const held = world.holdNext.get(key);
    if (held) {
      world.holdNext.delete(key);
      await held; // answered below with the world as it is once released
    }
    const injected = world.failNext.get(key);
    if (injected) {
      world.failNext.delete(key);
      return json(
        route,
        injected.status,
        failure(injected.code, injected.status, injected.message),
      );
    }
    if (method !== "GET" && csrf !== world.csrfToken) {
      return json(route, 403, failure("CSRF_INVALID", 403));
    }
    const answer = (status: number, payload: unknown) =>
      world.loseResponseNext.delete(key)
        ? route.abort("internetdisconnected")
        : json(route, status, payload);
    if (path === "/api/auth/session") {
      return json(
        route,
        200,
        envelope({
          personId: "p-e2e",
          expiresAt: "2099-01-01T00:00:00.000Z",
          csrfToken: world.csrfToken,
          tenants: [
            {
              tenantId: TENANT_ID,
              role: world.sessionRole,
              name: String(world.club.name),
              timezone: String(world.club.timezone),
              locale: String(world.club.locale),
            },
          ],
        }),
      );
    }
    if (path === "/api/sports") {
      return json(
        route,
        200,
        envelope({
          sports: [
            { id: "s1", key: "badminton", name: "Cầu lông" },
            { id: "s2", key: "pickleball", name: "Pickleball" },
          ],
        }),
      );
    }
    if (path === "/api/me/profile") {
      // Like the route: a PATCH applies only the keys it sends; the commandId is not stored.
      if (method === "PATCH" && body) {
        const { commandId: _commandId, ...sent } = body;
        world.profile = { ...world.profile, ...(sent as Partial<World["profile"]>) };
      }
      const data = { profile: world.profile, genderCollection: world.genderCollection };
      return json(route, 200, envelope(data));
    }
    if (path === "/api/me/channels") {
      return json(route, 200, envelope({ channels: world.channels }));
    }
    const detach = /^\/api\/me\/channels\/([^/]+)\/detach$/.exec(path);
    if (detach) {
      world.channels = world.channels.filter((c) => c.id !== detach[1]);
      return json(route, 200, envelope({ detached: true }));
    }
    if (path === "/api/onboarding/club") {
      if (method === "PATCH" && body) {
        const id = String(body.commandId);
        if (!world.clubCommands.has(id)) {
          world.clubCommands.add(id);
          for (const [k, v] of Object.entries(body)) if (k !== "commandId") world.club[k] = v;
        }
      }
      return answer(200, envelope({ club: world.club, step: "verified" }));
    }
    if (path === "/api/onboarding/zalo") {
      if (world.zaloForbidden) return json(route, 403, failure("FORBIDDEN", 403));
      return json(route, 200, envelope(world.zalo));
    }
    if (path === "/api/onboarding/zalo/connect") {
      const id = String(body?.commandId);
      if (!world.connectCommands.has(id)) {
        world.connectCommands.add(id);
        world.zalo = {
          status: world.connectStatus,
          verifiedAt: null,
          lastSetwebhookAt: "2026-10-12T00:00:00.000Z",
          webhookUrl: "https://plexco.test/api/webhooks/zalo/tok",
        };
      }
      return answer(200, envelope(world.zalo));
    }
    return json(route, 404, failure("NOT_FOUND", 404));
  });
  return world;
}

/** Parks the next "METHOD path" request; call the returned function to let it through. */
function hold(world: World, key: string): () => void {
  let release = () => {};
  world.holdNext.set(
    key,
    new Promise<void>((resolve) => {
      release = resolve;
    }),
  );
  return () => release();
}

const callsTo = (world: World, method: string, path: string) =>
  world.calls.filter((c) => c.method === method && c.path === path);
const countOf = (world: World, method: string, path: string) => () =>
  callsTo(world, method, path).length;
/** Resolves once the browser has the answer to the next GET /api/auth/session (the csrfToken). */
const sessionRefetch = (page: Page) =>
  page.waitForResponse((r) => new URL(r.url()).pathname === "/api/auth/session", {
    timeout: 5_000,
  });

test.beforeEach(async ({ context }) => {
  await signIn(context);
});

test.describe("/me/settings", () => {
  test("loads profile + channels; saving the display name sends exactly one PATCH with a commandId", async ({
    page,
  }) => {
    const world = await install(page);
    await page.goto("/me/settings");
    await expect(page.getByRole("heading", { name: "Cài đặt tài khoản" })).toBeVisible();
    const field = page.getByLabel("Tên hiển thị");
    await expect(field).toHaveValue("Lan Nguyễn");
    await field.fill("  Lan Mới ");
    await page.getByRole("button", { name: "Lưu" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Đã lưu hồ sơ." })).toBeVisible();
    const patches = callsTo(world, "PATCH", "/api/me/profile");
    expect(patches).toHaveLength(1);
    expect(patches[0]!.body).toMatchObject({ displayName: "Lan Mới" });
    expect(typeof patches[0]!.body?.commandId).toBe("string");
  });

  test("gender collection ON (T-2, T-24): the prompt shows while unset; set, then clear, each send ONE PATCH of only the gender fields; vi and en labels", async ({
    page,
  }) => {
    const world = await install(page);
    world.genderCollection = true;
    const vi = {
      prompt:
        "Bạn chưa đặt giới tính. Ở kèo có giá theo giới tính, bạn sẽ trả giá mặc định cho tới khi đặt.",
      gender: "Giới tính",
      options: ["Chưa đặt", "Nam", "Nữ", "Khác", "Không tiết lộ"],
      consent: "Cho phép CLB sử dụng giới tính để tính giá",
      notShared: "Không chia sẻ giới tính",
    };
    const en = {
      prompt:
        "You have not set your gender. In sessions priced by gender you pay the default price until you set it.",
      gender: "Gender",
      options: ["Not set", "Male", "Female", "Other", "Prefer not to say"],
      consent: "Allow clubs to use my gender for pricing",
      notShared: "Gender not shared",
    };
    // Unset gender, consent off: the prompt, the 4.9 options in order and the consent-off caption.
    const expectUnset = async (l: typeof vi) => {
      await expect(page.getByRole("status").filter({ hasText: l.prompt })).toBeVisible();
      const select = page.getByLabel(l.gender, { exact: true });
      await expect(select).toHaveValue("");
      await expect(select.locator("option")).toHaveText(l.options);
      await expect(page.getByLabel(l.consent)).not.toBeChecked();
      await expect(page.getByText(l.notShared)).toBeVisible();
    };
    await page.goto("/me/settings");
    await expectUnset(vi);
    const gender = page.getByLabel(vi.gender, { exact: true });
    const consent = page.getByLabel(vi.consent);
    const prompt = page.getByRole("status").filter({ hasText: vi.prompt });
    const save = page.getByRole("button", { name: "Lưu", exact: true });

    await gender.selectOption("female");
    await consent.check();
    await expect(page.getByText(vi.notShared)).toHaveCount(0);
    await save.click();
    await expect(page.getByRole("status").filter({ hasText: "Đã lưu hồ sơ." })).toBeVisible();
    // The prompt goes only once the refetched profile carries the gender.
    await expect(prompt).toHaveCount(0);
    await expect(gender).toHaveValue("female");
    await expect(consent).toBeChecked();

    await gender.selectOption("");
    await consent.uncheck();
    await save.click();
    await expect(prompt).toBeVisible();
    expect(callsTo(world, "PATCH", "/api/me/profile").map((c) => c.body)).toEqual([
      { gender: "female", genderConsent: true, commandId: expect.any(String) },
      { gender: null, genderConsent: false, commandId: expect.any(String) },
    ]);

    await page.evaluate(() => window.localStorage.setItem("plx-lang", "en"));
    await page.reload();
    await expectUnset(en);
    await expect(page.getByText(/giới tính/i)).toHaveCount(0);
  });

  test("an invalid name is pinned to the field and nothing is sent", async ({ page }) => {
    const world = await install(page);
    await page.goto("/me/settings");
    await page.getByLabel("Tên hiển thị").fill("   ");
    await page.getByRole("button", { name: "Lưu" }).click();
    await expect(page.getByText("Nhập tên hiển thị.")).toBeVisible();
    expect(world.calls.some((c) => c.method === "PATCH")).toBe(false);
  });

  test("unlink: the dialog warns of the new stranger, ONE detach is sent, the list reloads, focus and the live region carry the outcome", async ({
    page,
  }) => {
    const world = await install(page);
    await page.goto("/me/settings");
    const section = page.locator('section[aria-labelledby="me-channels"]');
    const outcome = section.locator('[role="status"]');
    await expect(section.getByText("Đang liên kết")).toBeVisible();
    await expect(outcome).toHaveCount(1); // mounted (empty) BEFORE the change it will announce
    await expect(outcome).toHaveText("");
    expect(countOf(world, "GET", "/api/me/channels")()).toBe(1);

    await section.getByRole("button", { name: "Gỡ liên kết Zalo" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("bot sẽ coi tài khoản Zalo này là một người lạ mới");
    await expect(dialog).toContainText(
      "Câu lạc bộ, lịch sử chơi và các khoản nợ của bạn vẫn ở trong tài khoản này",
    );
    await dialog.getByRole("button", { name: "Gỡ liên kết" }).click();

    await expect(outcome).toHaveText("Đã gỡ liên kết Zalo.");
    await expect.poll(countOf(world, "GET", "/api/me/channels")).toBe(2); // reloaded
    await expect(section.getByText("Đang liên kết")).toHaveCount(0); // the Zalo row is gone
    await expect(section.getByText("Messenger")).toBeVisible(); // the other row stays
    expect(callsTo(world, "POST", DETACH_ZALO)).toHaveLength(1);
    expect(world.calls.filter((c) => c.path.endsWith("/detach"))).toHaveLength(1);
    // Focus sits on the outcome region (its wrapper), not on <body> where the removed opener left it.
    await expect(outcome.locator("xpath=..")).toBeFocused();
  });

  test("unlink of an already-gone channel (409): the message shows, the list reloads, closing lands on the outcome", async ({
    page,
  }) => {
    const world = await install(page);
    world.failNext.set(`POST ${DETACH_ZALO}`, { code: "CHANNEL_NOT_LINKED", status: 409 });
    await page.goto("/me/settings");
    const section = page.locator('section[aria-labelledby="me-channels"]');
    await section.getByRole("button", { name: "Gỡ liên kết Zalo" }).click();
    // Meanwhile the channel left this account (e.g. unlinked in another tab).
    world.channels = world.channels.filter((c) => c.id !== ZALO_ID);
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Gỡ liên kết" }).click();
    await expect(dialog.getByRole("alert")).toContainText("không còn liên kết");
    await expect.poll(countOf(world, "GET", "/api/me/channels")).toBe(2); // reloaded behind the dialog
    await expect(section.getByText("Đang liên kết")).toHaveCount(0);

    await dialog.getByRole("button", { name: "Quay lại" }).click();
    await expect(dialog).toBeHidden();
    const outcome = section.locator('[role="status"]');
    await expect(outcome).toHaveText("Danh sách kênh đã được tải lại.");
    await expect(outcome.locator("xpath=..")).toBeFocused();
  });

  test("CSRF_INVALID on unlink: the session is refetched with the list, so confirming again carries the fresh csrfToken", async ({
    page,
  }) => {
    const world = await install(page);
    await page.goto("/me/settings");
    const section = page.locator('section[aria-labelledby="me-channels"]');
    await section.getByRole("button", { name: "Gỡ liên kết Zalo" }).click();
    world.csrfToken = ROTATED_CSRF; // the session's secret moved on; the page still holds the old one
    const refetched = sessionRefetch(page);
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Gỡ liên kết" }).click();
    await expect(dialog.getByRole("alert")).toContainText(
      "Yêu cầu không hợp lệ. Tải lại trang rồi thử lại.",
    );
    await refetched;
    await dialog.getByRole("button", { name: "Gỡ liên kết" }).click();
    await expect(section.locator('[role="status"]')).toHaveText("Đã gỡ liên kết Zalo.");
    expect(callsTo(world, "POST", DETACH_ZALO).map((c) => c.csrf)).toEqual([CSRF, ROTATED_CSRF]);
  });

  test("409, then 'Quay lại' BEFORE the reload lands: the opener gets focus back, and when the reload removes it the list says so and focus lands on the outcome", async ({
    page,
  }) => {
    const world = await install(page);
    world.failNext.set(`POST ${DETACH_ZALO}`, { code: "CHANNEL_NOT_LINKED", status: 409 });
    await page.goto("/me/settings");
    const section = page.locator('section[aria-labelledby="me-channels"]');
    const opener = section.getByRole("button", { name: "Gỡ liên kết Zalo" });
    await opener.click();
    world.channels = world.channels.filter((c) => c.id !== ZALO_ID); // gone in another tab
    const release = hold(world, "GET /api/me/channels");
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Gỡ liên kết" }).click();
    await expect(dialog.getByRole("alert")).toContainText("không còn liên kết");
    await expect.poll(countOf(world, "GET", "/api/me/channels")).toBe(2); // sent, parked

    await dialog.getByRole("button", { name: "Quay lại" }).click();
    await expect(dialog).toBeHidden();
    await expect(opener).toBeFocused(); // still listed: the dialog handed focus back to it
    const outcome = section.locator('[role="status"]');
    await expect(outcome).toHaveText("");

    release();
    await expect(section.getByText("Đang liên kết")).toHaveCount(0); // the reload removed the row
    await expect(outcome).toHaveText("Danh sách kênh đã được tải lại.");
    await expect(outcome.locator("xpath=..")).toBeFocused();
  });

  test("an inactive channel is listed with no unlink action and says why; the date reads as first seen", async ({
    page,
  }) => {
    await install(page);
    await page.goto("/me/settings");
    const section = page.locator('section[aria-labelledby="me-channels"]');
    const inactive = section.locator("li").filter({ hasText: "Messenger" });
    await expect(inactive).toContainText("Tạm ngưng");
    await expect(inactive).toContainText("Kênh đang tạm ngưng nên chưa thể gỡ liên kết.");
    await expect(inactive.getByRole("button")).toHaveCount(0);
    await expect(section.getByRole("button", { name: /Gỡ liên kết/ })).toHaveCount(1);
    await expect(section.getByText("Ghi nhận từ ngày").first()).toBeVisible();
    await expect(section.getByText("Liên kết ngày")).toHaveCount(0);
  });

  test("the reminders section says there are no automatic reminders, with no internal milestone id", async ({
    page,
  }) => {
    await install(page);
    await page.goto("/me/settings");
    const reminders = page.locator('section[aria-labelledby="me-reminders"]');
    await expect(reminders).toContainText("Plexco chưa gửi nhắc nợ tự động");
    await expect(reminders).not.toContainText(/\bM\d+\b/);
  });

  test("'Về câu lạc bộ' goes to the club router '/', not straight into the first club", async ({
    page,
  }) => {
    await install(page);
    await page.goto("/me/settings");
    await expect(page.getByRole("link", { name: "Về câu lạc bộ" })).toHaveAttribute("href", "/");
  });

  test("empty channels -> empty state linking to /me/link", async ({ page }) => {
    const world = await install(page);
    world.channels = [];
    await page.goto("/me/settings");
    await expect(page.getByText("Chưa liên kết kênh nào")).toBeVisible();
    await expect(page.getByRole("link", { name: "Liên kết Zalo" }).last()).toHaveAttribute(
      "href",
      "/me/link",
    );
  });

  test("load error shows a retry that refetches", async ({ page }) => {
    const world = await install(page);
    world.failNext.set("GET /api/me/profile", { code: "RATE_LIMITED", status: 429 });
    await page.goto("/me/settings");
    await expect(page.getByText("Bạn thao tác quá nhanh")).toBeVisible();
    await page.getByRole("button", { name: "Thử lại" }).click();
    await expect(page.getByLabel("Tên hiển thị")).toBeVisible();
    expect(callsTo(world, "GET", "/api/me/profile")).toHaveLength(2);
  });
});

test.describe("/me/link language", () => {
  test("heading, form and chrome share ONE language: Vietnamese by default, Accept-Language ignored", async ({
    page,
  }) => {
    await install(page);
    await page.setExtraHTTPHeaders({ "accept-language": "en-US,en;q=0.9" });
    await page.goto("/me/link");
    await expect(page.getByRole("heading", { level: 1, name: "Liên kết Zalo" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Cài đặt" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 1, name: "Link your Zalo" })).toHaveCount(0);
  });

  test("the remembered club language (plx-lang) switches heading, form and chrome together", async ({
    page,
  }) => {
    await install(page);
    await page.addInitScript(() => window.localStorage.setItem("plx-lang", "en"));
    await page.goto("/me/link");
    await expect(page.getByRole("heading", { level: 1, name: "Link your Zalo" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Settings" })).toBeVisible();
    await expect(page.getByText("Send /link to your club's Zalo bot")).toBeVisible();
    await expect(page.getByText("Gửi /link cho bot Zalo")).toHaveCount(0);
  });
});

test.describe("/c/[tenantId]/settings", () => {
  const URL_ = `/c/${TENANT_ID}/settings`;
  const profileForm = (page: Page) =>
    page.locator("form").filter({ has: page.getByLabel("Tên câu lạc bộ") });
  const zaloForm = (page: Page) =>
    page.locator("form").filter({ has: page.getByLabel("Token bot Zalo") });

  test("club form sends only changed fields, in ONE PATCH; the shell language follows the saved locale", async ({
    page,
  }) => {
    const world = await install(page);
    await page.goto(URL_);
    await expect(page.getByRole("heading", { name: "Cài đặt câu lạc bộ" })).toBeVisible();
    await page.getByLabel("Ngôn ngữ của câu lạc bộ").selectOption("en");
    await page.getByRole("button", { name: "Lưu" }).first().click();
    await expect(page.getByRole("heading", { name: "Club settings" })).toBeVisible();
    const patches = callsTo(world, "PATCH", "/api/onboarding/club");
    expect(patches).toHaveLength(1);
    expect(patches[0]!.body).toMatchObject({ locale: "en" });
    expect(Object.keys(patches[0]!.body ?? {}).sort()).toEqual(["commandId", "locale"]);
  });

  test("an edit after a lost response is a NEW command: the edit is applied, not replayed away", async ({
    page,
  }) => {
    const world = await install(page);
    world.loseResponseNext.add("PATCH /api/onboarding/club");
    await page.goto(URL_);
    const form = profileForm(page);
    await page.getByLabel("Tên câu lạc bộ").fill("CLB Một");
    await form.getByRole("button", { name: "Lưu" }).click();
    await expect(form.getByRole("alert")).toContainText("Không có kết nối mạng");
    expect(world.club.name).toBe("CLB Một"); // the server did apply it; only the reply was lost

    await page.getByLabel("Tên câu lạc bộ").fill("CLB Hai");
    await form.getByRole("button", { name: "Lưu" }).click();
    await expect(form.getByRole("status")).toHaveText("Đã lưu thông tin câu lạc bộ.");
    const patches = callsTo(world, "PATCH", "/api/onboarding/club");
    expect(patches.map((c) => c.body?.name)).toEqual(["CLB Một", "CLB Hai"]);
    expect(patches[1]!.body?.commandId).not.toBe(patches[0]!.body?.commandId);
    expect(world.club.name).toBe("CLB Hai");
  });

  test("an identical retry after a lost response replays the SAME commandId", async ({ page }) => {
    const world = await install(page);
    world.loseResponseNext.add("PATCH /api/onboarding/club");
    await page.goto(URL_);
    const form = profileForm(page);
    await page.getByLabel("Tên câu lạc bộ").fill("CLB Một");
    await form.getByRole("button", { name: "Lưu" }).click();
    await expect(form.getByRole("alert")).toContainText("Không có kết nối mạng");
    await form.getByRole("button", { name: "Thử lại" }).click();
    await expect(form.getByRole("status")).toHaveText("Đã lưu thông tin câu lạc bộ.");
    const patches = callsTo(world, "PATCH", "/api/onboarding/club");
    expect(patches).toHaveLength(2);
    expect(patches[1]!.body).toEqual(patches[0]!.body);
    expect(world.clubCommands.size).toBe(1);
  });

  test("after a lost response, changing the name BACK to the loaded value is saved, never 'nothing changed'", async ({
    page,
  }) => {
    const world = await install(page);
    world.loseResponseNext.add("PATCH /api/onboarding/club");
    await page.goto(URL_);
    const form = profileForm(page);
    const name = page.getByLabel("Tên câu lạc bộ");
    await name.fill("CLB Một");
    await form.getByRole("button", { name: "Lưu" }).click();
    await expect(form.getByRole("alert")).toContainText("Không có kết nối mạng");
    expect(world.club.name).toBe("CLB Một"); // applied; the form's loaded baseline is now stale

    await name.fill("CLB Cầu Lông Test"); // the value the form loaded
    await form.getByRole("button", { name: "Lưu" }).click();
    await expect(form.getByRole("status")).toHaveText("Đã lưu thông tin câu lạc bộ.");
    await expect(page.getByText("Chưa có thay đổi nào để lưu.")).toHaveCount(0);
    const patches = callsTo(world, "PATCH", "/api/onboarding/club");
    expect(patches.map((c) => c.body?.name)).toEqual(["CLB Một", "CLB Cầu Lông Test"]);
    expect(patches[1]!.body?.commandId).not.toBe(patches[0]!.body?.commandId);
    expect(world.club.name).toBe("CLB Cầu Lông Test");
  });

  test("a club name over 120 UTF-16 units (61 emoji) is refused on the field, as the route counts; nothing is sent", async ({
    page,
  }) => {
    const world = await install(page);
    await page.goto(URL_);
    const name = page.getByLabel("Tên câu lạc bộ");
    await name.fill(String.fromCodePoint(0x1f3f8).repeat(61)); // 61 code points, 122 units
    await profileForm(page).getByRole("button", { name: "Lưu" }).click();
    await expect(page.getByText("Tên tối đa 120 ký tự")).toBeVisible();
    await expect(name).toBeFocused();
    expect(callsTo(world, "PATCH", "/api/onboarding/club")).toHaveLength(0);
  });

  test("defaults form saves price and visibility in ONE PATCH; the price is labelled in đ", async ({
    page,
  }) => {
    const world = await install(page);
    await page.goto(URL_);
    await page.getByLabel("Giá mặc định (đ)").fill("60.000");
    await page.getByLabel("Hiển thị mặc định").selectOption("public");
    await page.getByRole("button", { name: "Lưu" }).nth(1).click();
    await expect(page.getByText("Đã lưu mặc định buổi chơi.")).toBeVisible();
    const patches = callsTo(world, "PATCH", "/api/onboarding/club");
    expect(patches).toHaveLength(1);
    expect(patches[0]!.body).toMatchObject({
      defaultPriceAmount: 60000,
      defaultVisibility: "public",
    });
  });

  test("clearing a saved default sport is refused on the field, never 'nothing changed'; nothing is sent", async ({
    page,
  }) => {
    const world = await install(page);
    await page.goto(URL_);
    const sport = page.getByLabel("Môn thể thao mặc định");
    await sport.selectOption("");
    await page.getByRole("button", { name: "Lưu" }).nth(1).click();
    await expect(page.getByText("Môn mặc định đã lưu không thể bỏ trống")).toBeVisible();
    await expect(page.getByText("Chưa có thay đổi nào để lưu.")).toHaveCount(0);
    await expect(sport).toHaveAttribute("aria-invalid", "true");
    await expect(sport).toBeFocused();
    expect(callsTo(world, "PATCH", "/api/onboarding/club")).toHaveLength(0);
  });

  test("zalo connect: a 200 'registered' clears the token, the copy follows the status, the token is never rendered back", async ({
    page,
  }) => {
    const world = await install(page);
    await page.goto(URL_);
    await expect(page.getByText("Chưa kết nối")).toBeVisible();
    const token = page.getByLabel("Token bot Zalo");
    await token.fill(TOKEN);
    await page.getByRole("button", { name: "Kết nối Zalo" }).click();
    await expect(zaloForm(page).getByRole("status")).toHaveText(
      "Đã gửi token và đăng ký webhook. Đang chờ Zalo xác minh.",
    );
    await expect(token).toHaveValue("");
    expect(await page.content()).not.toContain(TOKEN);
    const posts = callsTo(world, "POST", "/api/onboarding/zalo/connect");
    expect(posts).toHaveLength(1);
    expect(posts[0]!.body).toMatchObject({ botToken: TOKEN });
  });

  test("zalo connect answered 200 with status 'error': the copy says the webhook was NOT registered", async ({
    page,
  }) => {
    const world = await install(page);
    world.connectStatus = "error";
    await page.goto(URL_);
    await page.getByLabel("Token bot Zalo").fill(TOKEN);
    await page.getByRole("button", { name: "Kết nối Zalo" }).click();
    await expect(page.getByText("Lỗi kết nối")).toBeVisible();
    const outcome = zaloForm(page).getByRole("status");
    await expect(outcome).toContainText("Zalo chưa nhận đăng ký webhook");
    await expect(page.getByText("Đã gửi token và đăng ký webhook.")).toHaveCount(0);
    await expect(page.getByLabel("Token bot Zalo")).toHaveValue("");
  });

  test("AUTH_UNAVAILABLE keeps the token: Retry resends the same token under the same commandId", async ({
    page,
  }) => {
    const world = await install(page);
    world.failNext.set("POST /api/onboarding/zalo/connect", {
      code: "AUTH_UNAVAILABLE",
      status: 503,
    });
    await page.goto(URL_);
    const token = page.getByLabel("Token bot Zalo");
    await token.fill(TOKEN);
    await page.getByRole("button", { name: "Kết nối Zalo" }).click();
    const form = zaloForm(page);
    await expect(form.getByRole("alert")).toContainText(
      "Kết nối Zalo tạm thời chưa khả dụng. Thử lại sau.",
    );
    await expect(token).toHaveValue(TOKEN);
    expect(await page.locator("body").innerText()).not.toContain(TOKEN);
    await form.getByRole("button", { name: "Thử lại" }).click();
    await expect(form.getByRole("status")).toContainText("Đã gửi token và đăng ký webhook.");
    const posts = callsTo(world, "POST", "/api/onboarding/zalo/connect");
    expect(posts).toHaveLength(2);
    expect(posts[1]!.body).toEqual(posts[0]!.body); // same token, same commandId
    await expect(token).toHaveValue("");
  });

  test("a lost connect response + Retry replays the same commandId: no second connect", async ({
    page,
  }) => {
    const world = await install(page);
    world.loseResponseNext.add("POST /api/onboarding/zalo/connect");
    await page.goto(URL_);
    const token = page.getByLabel("Token bot Zalo");
    await token.fill(TOKEN);
    await page.getByRole("button", { name: "Kết nối Zalo" }).click();
    const form = zaloForm(page);
    await expect(form.getByRole("alert")).toContainText("Không có kết nối mạng");
    await expect(page.getByText("Đã đăng ký webhook, chờ xác minh")).toBeVisible(); // refetched state
    await expect(token).toHaveValue(TOKEN);
    await form.getByRole("button", { name: "Thử lại" }).click();
    await expect(form.getByRole("status")).toContainText("Đã gửi token và đăng ký webhook.");
    const posts = callsTo(world, "POST", "/api/onboarding/zalo/connect");
    expect(posts).toHaveLength(2);
    expect(posts[1]!.body?.commandId).toBe(posts[0]!.body?.commandId);
    expect(world.connectCommands.size).toBe(1);
  });

  test("a lost connect response, then a 429 on Retry: the next Retry still replays the SAME commandId (one connect)", async ({
    page,
  }) => {
    const world = await install(page);
    world.loseResponseNext.add("POST /api/onboarding/zalo/connect");
    await page.goto(URL_);
    const token = page.getByLabel("Token bot Zalo");
    await token.fill(TOKEN);
    await page.getByRole("button", { name: "Kết nối Zalo" }).click();
    const form = zaloForm(page);
    await expect(form.getByRole("alert")).toContainText("Không có kết nối mạng");
    world.failNext.set("POST /api/onboarding/zalo/connect", { code: "RATE_LIMITED", status: 429 });
    await form.getByRole("button", { name: "Thử lại" }).click();
    await expect(form.getByRole("alert")).toContainText("Bạn thao tác quá nhanh");
    await expect(token).toHaveValue(TOKEN);
    await form.getByRole("button", { name: "Thử lại" }).click();
    await expect(form.getByRole("status")).toContainText("Đã gửi token và đăng ký webhook.");
    const posts = callsTo(world, "POST", "/api/onboarding/zalo/connect");
    expect(posts).toHaveLength(3);
    expect(new Set(posts.map((c) => c.body?.commandId)).size).toBe(1);
    expect(world.connectCommands.size).toBe(1); // the 429 did not turn the retry into a 2nd connect
  });

  test("a failed connect whose refetch also fails: the error note replaces the form and takes focus", async ({
    page,
  }) => {
    const world = await install(page);
    await page.goto(URL_);
    const token = page.getByLabel("Token bot Zalo");
    await token.fill(TOKEN);
    world.failNext.set("POST /api/onboarding/zalo/connect", {
      code: "AUTH_UNAVAILABLE",
      status: 503,
    });
    world.failNext.set("GET /api/onboarding/zalo", { code: "RATE_LIMITED", status: 429 });
    await page.getByRole("button", { name: "Kết nối Zalo" }).click();
    const card = page.locator('section[aria-labelledby="club-zalo"]');
    const alert = card.getByRole("alert");
    await expect(alert).toContainText("Bạn thao tác quá nhanh");
    await expect(card.getByLabel("Token bot Zalo")).toHaveCount(0);
    await expect(alert.locator("xpath=..")).toBeFocused();
    // Its Retry brings the form back with the token kept, and the reload is announced.
    await alert.getByRole("button", { name: "Thử lại" }).click();
    await expect(zaloForm(page).getByRole("status")).toHaveText(
      "Đã tải lại trạng thái kết nối Zalo.",
    );
    await expect(zaloForm(page).getByRole("status").locator("xpath=..")).toBeFocused();
    await expect(page.getByLabel("Token bot Zalo")).toHaveValue(TOKEN);
  });

  test("a revoked bot: the status says so, and there is no token field and no reconnect", async ({
    page,
  }) => {
    const world = await install(page);
    world.zalo = { ...world.zalo, status: "revoked" };
    await page.goto(URL_);
    const card = page.locator('section[aria-labelledby="club-zalo"]');
    await expect(card.getByText("Đã thu hồi")).toBeVisible();
    await expect(card.getByRole("status")).toHaveText(
      "Kết nối Zalo của câu lạc bộ này đã bị thu hồi. Không thể kết nối lại từ trang này, kể cả bằng token bot khác.",
    );
    await expect(card.getByLabel("Token bot Zalo")).toHaveCount(0);
    await expect(card.getByRole("button")).toHaveCount(0);
    await expect(page.getByLabel("Tên câu lạc bộ")).toBeVisible(); // the club forms still work
  });

  test("a bot revoked meanwhile: the connect's 403 is followed by the revoked note, focused, and the token is gone", async ({
    page,
  }) => {
    const world = await install(page);
    world.zalo = { ...world.zalo, status: "active" };
    await page.goto(URL_);
    await page.getByLabel("Token bot Zalo").fill(TOKEN);
    world.zalo = { ...world.zalo, status: "revoked" }; // revoked after the card loaded
    world.failNext.set("POST /api/onboarding/zalo/connect", {
      code: "FORBIDDEN",
      status: 403,
      message: "Bot này đã bị thu hồi.",
    });
    await page.getByRole("button", { name: "Kết nối lại" }).click();
    const card = page.locator('section[aria-labelledby="club-zalo"]');
    const note = card.getByRole("status");
    await expect(note).toContainText("đã bị thu hồi");
    await expect(note.locator("xpath=..")).toBeFocused();
    await expect(card.getByLabel("Token bot Zalo")).toHaveCount(0);
    await expect(card.getByRole("button", { name: /Kết nối/ })).toHaveCount(0);
    expect(await page.content()).not.toContain(TOKEN);
    expect(callsTo(world, "POST", "/api/onboarding/zalo/connect")).toHaveLength(1);
  });

  test("CSRF_INVALID on the defaults form: 'Tải lại dữ liệu' refetches the session too, so the retry carries the fresh csrfToken", async ({
    page,
  }) => {
    const world = await install(page);
    await page.goto(URL_);
    const price = page.getByLabel("Giá mặc định (đ)");
    const form = page.locator("form").filter({ has: price });
    await price.fill("60.000");
    world.csrfToken = ROTATED_CSRF; // the session's secret moved on; the page still holds the old one
    await form.getByRole("button", { name: "Lưu" }).click();
    const alert = form.getByRole("alert");
    await expect(alert).toContainText("Yêu cầu không hợp lệ. Tải lại trang rồi thử lại.");
    const refetched = sessionRefetch(page);
    await alert.getByRole("button", { name: "Tải lại dữ liệu" }).click();
    await refetched;
    await form.getByRole("button", { name: "Lưu" }).click();
    await expect(form.getByRole("status")).toHaveText("Đã lưu mặc định buổi chơi.");
    expect(callsTo(world, "PATCH", "/api/onboarding/club").map((c) => c.csrf)).toEqual([
      CSRF,
      ROTATED_CSRF,
    ]);
    expect(world.club.defaultPriceAmount).toBe(60000);
  });

  test("CSRF_INVALID on a Zalo connect: 'Tải lại dữ liệu' refetches the session too, so the next connect carries the fresh csrfToken", async ({
    page,
  }) => {
    const world = await install(page);
    await page.goto(URL_);
    const token = page.getByLabel("Token bot Zalo");
    await token.fill(TOKEN);
    world.csrfToken = ROTATED_CSRF; // the session's secret moved on; the page still holds the old one
    await page.getByRole("button", { name: "Kết nối Zalo" }).click();
    const form = zaloForm(page);
    const alert = form.getByRole("alert");
    await expect(alert).toContainText("Yêu cầu không hợp lệ. Tải lại trang rồi thử lại.");
    await expect(token).toHaveValue(""); // not retryable as is: the token is not kept
    const refetched = sessionRefetch(page);
    await alert.getByRole("button", { name: "Tải lại dữ liệu" }).click();
    await refetched;
    await expect(form.getByRole("status")).toHaveText("Đã tải lại trạng thái kết nối Zalo.");
    await token.fill(TOKEN);
    await page.getByRole("button", { name: "Kết nối Zalo" }).click();
    await expect(form.getByRole("status")).toHaveText(
      "Đã gửi token và đăng ký webhook. Đang chờ Zalo xác minh.",
    );
    expect(callsTo(world, "POST", "/api/onboarding/zalo/connect").map((c) => c.csrf)).toEqual([
      CSRF,
      ROTATED_CSRF,
    ]);
  });

  test("ZALO_TOKEN_INVALID clears the token and says so; no retry is offered", async ({ page }) => {
    const world = await install(page);
    world.failNext.set("POST /api/onboarding/zalo/connect", {
      code: "ZALO_TOKEN_INVALID",
      status: 400,
    });
    await page.goto(URL_);
    const token = page.getByLabel("Token bot Zalo");
    await token.fill(TOKEN);
    await page.getByRole("button", { name: "Kết nối Zalo" }).click();
    const form = zaloForm(page);
    await expect(form.getByRole("alert")).toContainText("Token bot Zalo không hợp lệ");
    await expect(token).toHaveValue("");
    await expect(form.getByRole("button", { name: "Thử lại" })).toHaveCount(0);
  });

  test("CONNECT_SUPERSEDED shows the superseded copy and a reload that refetches; the token is cleared", async ({
    page,
  }) => {
    const world = await install(page);
    world.failNext.set("POST /api/onboarding/zalo/connect", {
      code: "CONNECT_SUPERSEDED",
      status: 409,
    });
    await page.goto(URL_);
    const token = page.getByLabel("Token bot Zalo");
    await token.fill(TOKEN);
    await page.getByRole("button", { name: "Kết nối Zalo" }).click();
    const form = zaloForm(page);
    await expect(form.getByRole("alert")).toContainText(
      "Thao tác này đã được xử lý hoặc bị thay thế",
    );
    await expect(token).toHaveValue("");
    // first paint + the refetch every failed connect triggers, then the reload button's own
    await expect.poll(countOf(world, "GET", "/api/onboarding/zalo")).toBe(2);
    await form.getByRole("button", { name: "Tải lại dữ liệu" }).click();
    await expect.poll(countOf(world, "GET", "/api/onboarding/zalo")).toBe(3);
    await expect(form.getByRole("alert")).toHaveCount(0);
    // The reload button is gone with the error: the outcome region announces the reload, focused.
    await expect(form.getByRole("status")).toHaveText("Đã tải lại trạng thái kết nối Zalo.");
    await expect(form.getByRole("status").locator("xpath=..")).toBeFocused();
  });

  test("an unknown error code fails closed (generic copy + reference, no raw text); the token stays for Retry", async ({
    page,
  }) => {
    const world = await install(page);
    world.failNext.set("POST /api/onboarding/zalo/connect", {
      code: "SOMETHING_NEW",
      status: 500,
      message: "raw server detail",
    });
    await page.goto(URL_);
    const token = page.getByLabel("Token bot Zalo");
    await token.fill(TOKEN);
    await page.getByRole("button", { name: "Kết nối Zalo" }).click();
    const alert = zaloForm(page).getByRole("alert");
    await expect(alert).toContainText("Đã có lỗi không mong muốn");
    await expect(alert).toContainText("req-e2e-err");
    await expect(alert).not.toContainText("raw server detail");
    await expect(token).toHaveValue(TOKEN);
    await expect(alert.getByRole("button", { name: "Thử lại" })).toBeVisible();
  });

  test("a token over 200 characters gets its own message; nothing is sent", async ({ page }) => {
    const world = await install(page);
    await page.goto(URL_);
    await page.getByLabel("Token bot Zalo").fill("t".repeat(201));
    await page.getByRole("button", { name: "Kết nối Zalo" }).click();
    await expect(page.getByText("Token tối đa 200 ký tự.")).toBeVisible();
    await expect(page.getByText("Nhập token bot Zalo.")).toHaveCount(0);
    expect(callsTo(world, "POST", "/api/onboarding/zalo/connect")).toHaveLength(0);
  });

  test("an unknown connector status renders a labelled badge, never a blank one", async ({
    page,
  }) => {
    const world = await install(page);
    world.zalo = { ...world.zalo, status: "paused_by_zalo" };
    await page.goto(URL_);
    await expect(page.getByText("Không rõ trạng thái")).toBeVisible();
  });

  test("the token field opts out of password saving and autofill", async ({ page }) => {
    await install(page);
    await page.goto(URL_);
    const token = page.getByLabel("Token bot Zalo");
    await expect(token).toHaveAttribute("type", "password");
    await expect(token).toHaveAttribute("autocomplete", "one-time-code");
    await expect(token).toHaveAttribute("data-1p-ignore", "true");
    await expect(token).toHaveAttribute("data-lpignore", "true");
    await expect(token).toHaveAttribute("data-bwignore", "true");
  });

  test("admin without connector.secret_manage: the uniform note, no token field, no connect button; the club forms still work", async ({
    page,
  }) => {
    const world = await install(page);
    world.sessionRole = "admin";
    world.zaloForbidden = true;
    await page.goto(URL_);
    await expect(page.getByText("Bạn không có quyền quản lý kết nối Zalo")).toBeVisible();
    await expect(page.getByLabel("Token bot Zalo")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Kết nối/ })).toHaveCount(0);
    await expect(page.getByLabel("Tên câu lạc bộ")).toBeVisible();
    expect(callsTo(world, "POST", "/api/onboarding/zalo/connect")).toHaveLength(0);
  });

  test("admin without content.manage: the uniform not-permitted state and no form, token field or connect button", async ({
    page,
  }) => {
    const world = await install(page);
    world.sessionRole = "admin";
    world.failNext.set("GET /api/onboarding/club", { code: "FORBIDDEN", status: 403 });
    await page.goto(URL_);
    await expect(page.getByRole("heading", { name: "Không có quyền" })).toBeVisible();
    await expect(page.locator("main form")).toHaveCount(0);
    await expect(page.getByLabel("Tên câu lạc bộ")).toHaveCount(0);
    await expect(page.getByLabel("Token bot Zalo")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Lưu" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Kết nối/ })).toHaveCount(0);
  });
});

const SCHEMES = ["light", "dark"] as const;
const VIEWPORTS = [
  { name: "375", width: 375, height: 812 },
  { name: "1280", width: 1280, height: 800 },
];
const SCREENS = [
  {
    name: "me settings",
    path: "/me/settings",
    ready: (p: Page) => p.getByLabel("Tên hiển thị").waitFor(),
  },
  {
    name: "club settings",
    path: `/c/${TENANT_ID}/settings`,
    ready: (p: Page) => p.getByLabel("Token bot Zalo").waitFor(),
  },
];

for (const scheme of SCHEMES) {
  for (const viewport of VIEWPORTS) {
    test.describe(`axe ${scheme} ${viewport.name}`, () => {
      test.use({
        colorScheme: scheme,
        viewport: { width: viewport.width, height: viewport.height },
      });
      for (const screen of SCREENS) {
        test(screen.name, async ({ page }) => {
          await install(page);
          await page.goto(screen.path);
          await screen.ready(page);
          const results = await new AxeBuilder({ page })
            .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
            .analyze();
          const blocking = results.violations.filter(
            (v) => v.impact === "serious" || v.impact === "critical",
          );
          expect(
            blocking.map((v) => ({
              id: v.id,
              impact: v.impact,
              nodes: v.nodes.map((n) => n.target),
            })),
          ).toEqual([]);
        });
      }
    });
  }
}
