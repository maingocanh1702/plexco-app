import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Route } from "@playwright/test";
import { TENANT_ID, signIn } from "./support/session-api-mock";

/**
 * Settings screens (lane M4): /me/settings and /c/[tenantId]/settings. Same harness as
 * sessions.spec.ts: every /api call is answered in the browser via page.route; the server renders
 * pages only (its one DB lookup is answered by fake-postgres.mjs). Nothing real is persisted.
 */
interface Call {
  method: string;
  path: string;
  body: Record<string, unknown> | null;
}

const envelope = (data: unknown) => ({ data, error: null, meta: { requestId: "req-e2e" } });
const failure = (code: string, statusCode: number, message = "x") => ({
  data: null,
  error: { code, message, statusCode },
  meta: { requestId: "req-e2e-err" },
});

interface World {
  calls: Call[];
  profile: { displayName: string | null };
  channels: { id: string; platform: string; status: string; createdAt: string }[];
  club: Record<string, unknown>;
  zalo: Record<string, unknown>;
  /** Next response for "METHOD path" is replaced by this error. */
  failNext: Map<string, { code: string; status: number }>;
  zaloForbidden: boolean;
}

async function install(page: Page): Promise<World> {
  const world: World = {
    calls: [],
    profile: { displayName: "Lan Nguyễn" },
    channels: [
      {
        id: "11111111-aaaa-4aaa-8aaa-111111111111",
        platform: "zalo",
        status: "active",
        createdAt: "2026-10-01T00:00:00.000Z",
      },
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
    failNext: new Map(),
    zaloForbidden: false,
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
    world.calls.push({ method, path, body });
    const key = `${method} ${path}`;
    const injected = world.failNext.get(key);
    if (injected) {
      world.failNext.delete(key);
      return json(route, injected.status, failure(injected.code, injected.status));
    }
    if (path === "/api/auth/session") {
      return json(
        route,
        200,
        envelope({
          personId: "p-e2e",
          expiresAt: "2099-01-01T00:00:00.000Z",
          csrfToken: "e2e-csrf-secret",
          tenants: [
            {
              tenantId: TENANT_ID,
              role: "owner",
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
      if (method === "PATCH") world.profile = { displayName: String(body?.displayName) };
      return json(route, 200, envelope({ profile: world.profile }));
    }
    if (path === "/api/me/channels")
      return json(route, 200, envelope({ channels: world.channels }));
    const detach = /^\/api\/me\/channels\/([^/]+)\/detach$/.exec(path);
    if (detach) {
      world.channels = world.channels.filter((c) => c.id !== detach[1]);
      return json(route, 200, envelope({ detached: true }));
    }
    if (path === "/api/onboarding/club") {
      if (method === "PATCH" && body) {
        for (const [k, v] of Object.entries(body)) if (k !== "commandId") world.club[k] = v;
      }
      return json(route, 200, envelope({ club: world.club, step: "verified" }));
    }
    if (path === "/api/onboarding/zalo") {
      if (world.zaloForbidden) return json(route, 403, failure("FORBIDDEN", 403));
      return json(route, 200, envelope(world.zalo));
    }
    if (path === "/api/onboarding/zalo/connect") {
      world.zalo = {
        status: "registered",
        verifiedAt: null,
        lastSetwebhookAt: "2026-10-12T00:00:00.000Z",
        webhookUrl: "https://plexco.test/api/webhooks/zalo/tok",
      };
      return json(route, 200, envelope(world.zalo));
    }
    return json(route, 404, failure("NOT_FOUND", 404));
  });
  return world;
}

test.beforeEach(async ({ context }) => {
  await signIn(context);
});

test.describe("/me/settings", () => {
  test("loads profile + channels; saving the display name sends one PATCH with a commandId", async ({
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
    const patch = world.calls.find((c) => c.method === "PATCH" && c.path === "/api/me/profile");
    expect(patch?.body).toMatchObject({ displayName: "Lan Mới" });
    expect(typeof patch?.body?.commandId).toBe("string");
  });

  test("an invalid name is pinned to the field and nothing is sent", async ({ page }) => {
    const world = await install(page);
    await page.goto("/me/settings");
    await page.getByLabel("Tên hiển thị").fill("   ");
    await page.getByRole("button", { name: "Lưu" }).click();
    await expect(page.getByText("Nhập tên hiển thị.")).toBeVisible();
    expect(world.calls.some((c) => c.method === "PATCH")).toBe(false);
  });

  test("unlink: confirm dialog explains, POSTs detach, list reloads", async ({ page }) => {
    const world = await install(page);
    await page.goto("/me/settings");
    await page
      .getByRole("button", { name: /Gỡ liên kết/ })
      .first()
      .click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText(
      "Câu lạc bộ, lịch sử chơi và các khoản nợ của bạn vẫn ở trong tài khoản này",
    );
    await dialog.getByRole("button", { name: "Gỡ liên kết" }).click();
    await expect(page.getByText("Đã gỡ liên kết Zalo.")).toBeVisible();
    expect(world.calls.some((c) => c.method === "POST" && c.path.endsWith("/detach"))).toBe(true);
    await expect(page.getByText("Chưa liên kết kênh nào")).toBeHidden();
  });

  test("unlink of an already-gone channel (409) shows the message and reloads", async ({
    page,
  }) => {
    const world = await install(page);
    world.failNext.set("POST /api/me/channels/11111111-aaaa-4aaa-8aaa-111111111111/detach", {
      code: "CHANNEL_NOT_LINKED",
      status: 409,
    });
    await page.goto("/me/settings");
    await page
      .getByRole("button", { name: /Gỡ liên kết/ })
      .first()
      .click();
    await page.getByRole("dialog").getByRole("button", { name: "Gỡ liên kết" }).click();
    await expect(page.getByRole("dialog").getByRole("alert")).toContainText("không còn liên kết");
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

  test("load error shows a retry", async ({ page }) => {
    const world = await install(page);
    world.failNext.set("GET /api/me/profile", { code: "RATE_LIMITED", status: 429 });
    await page.goto("/me/settings");
    await expect(page.getByText("Bạn thao tác quá nhanh")).toBeVisible();
    await page.getByRole("button", { name: "Thử lại" }).click();
    await expect(page.getByLabel("Tên hiển thị")).toBeVisible();
  });
});

test.describe("/c/[tenantId]/settings", () => {
  const URL_ = `/c/${TENANT_ID}/settings`;

  test("club form sends only changed fields; the shell language follows the saved locale", async ({
    page,
  }) => {
    const world = await install(page);
    await page.goto(URL_);
    await expect(page.getByRole("heading", { name: "Cài đặt câu lạc bộ" })).toBeVisible();
    await page.getByLabel("Ngôn ngữ của câu lạc bộ").selectOption("en");
    await page.getByRole("button", { name: "Lưu" }).first().click();
    await expect(page.getByRole("heading", { name: "Club settings" })).toBeVisible();
    const patch = world.calls.find(
      (c) => c.method === "PATCH" && c.path === "/api/onboarding/club",
    );
    expect(patch?.body).toMatchObject({ locale: "en" });
    expect(Object.keys(patch?.body ?? {}).sort()).toEqual(["commandId", "locale"]);
  });

  test("defaults form saves price and visibility", async ({ page }) => {
    const world = await install(page);
    await page.goto(URL_);
    await page.getByLabel("Giá mặc định (₫)").fill("60.000");
    await page.getByLabel("Hiển thị mặc định").selectOption("public");
    await page.getByRole("button", { name: "Lưu" }).nth(1).click();
    await expect(page.getByText("Đã lưu mặc định buổi chơi.")).toBeVisible();
    const patch = world.calls.find(
      (c) => c.method === "PATCH" && c.path === "/api/onboarding/club",
    );
    expect(patch?.body).toMatchObject({ defaultPriceAmount: 60000, defaultVisibility: "public" });
  });

  test("zalo connect: token is cleared after submit and never rendered back", async ({ page }) => {
    const world = await install(page);
    await page.goto(URL_);
    await expect(page.getByText("Chưa kết nối")).toBeVisible();
    const token = page.getByLabel("Token bot Zalo");
    await token.fill("super-secret-token");
    await page.getByRole("button", { name: "Kết nối Zalo" }).click();
    await expect(page.getByText("Đã gửi token và đăng ký webhook.")).toBeVisible();
    await expect(token).toHaveValue("");
    expect(await page.content()).not.toContain("super-secret-token");
    expect(world.calls.find((c) => c.path.endsWith("/zalo/connect"))?.body).toMatchObject({
      botToken: "super-secret-token",
    });
  });

  test("zalo 403 renders the uniform not-permitted note; the rest of the page still works", async ({
    page,
  }) => {
    const world = await install(page);
    world.zaloForbidden = true;
    await page.goto(URL_);
    await expect(page.getByText("Bạn không có quyền quản lý kết nối Zalo")).toBeVisible();
    await expect(page.getByLabel("Tên câu lạc bộ")).toBeVisible();
  });

  test("club 403 renders the uniform not-permitted state", async ({ page }) => {
    const world = await install(page);
    world.failNext.set("GET /api/onboarding/club", { code: "FORBIDDEN", status: 403 });
    await page.goto(URL_);
    await expect(page.getByRole("heading", { name: "Không có quyền" })).toBeVisible();
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
