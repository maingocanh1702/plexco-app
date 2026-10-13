import { expect, test } from "@playwright/test";

test.describe("PWA assets", () => {
  test("/offline renders the fallback shell", async ({ page }) => {
    await page.goto("/offline");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Bạn đang offline");
    await expect(page.getByRole("button", { name: "Thử lại" })).toBeVisible();
  });

  test("manifest is served with the web-manifest content type and installable icons", async ({
    request,
  }) => {
    const response = await request.get("/manifest.webmanifest");
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toMatch(/application\/manifest\+json/);
    const manifest = await response.json();
    expect(manifest).toMatchObject({ name: "Plexco", display: "standalone", start_url: "/" });
    for (const icon of manifest.icons as { src: string }[]) {
      const res = await request.get(icon.src);
      expect(res.status()).toBe(200);
      expect(res.headers()["content-type"]).toBe("image/png");
    }
  });

  test("/sw.js is served as JavaScript and ships the never-cache-API rule", async ({ request }) => {
    const response = await request.get("/sw.js");
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toMatch(/javascript/);
    expect(await response.text()).toContain('startsWith("/api/")');
  });

  test("the page links the manifest, apple-touch icon and theme colours", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator('link[rel="manifest"]')).toHaveCount(1);
    await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveCount(1);
    await expect(page.locator('meta[name="theme-color"]')).toHaveCount(2);
  });

  test("once the service worker controls the page, an offline navigation shows /offline", async ({
    page,
    context,
  }) => {
    await page.goto("/offline");
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    // First load is not controlled until the worker claims clients; reload to be sure.
    await page.reload();
    await expect
      .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null))
      .toBe(true);

    // Leave the /offline page first: it listens for "online" (by design) and the emulated
    // network toggles would otherwise navigate it away before the navigation under test.
    await page.goto("about:blank");
    await context.setOffline(true);
    // The /offline page we are on listens for "online"; let the emulation settle so a stray
    // event cannot navigate away while we start the offline navigation under test.
    await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(false);
    await page.goto("/?auth_error=AUTH_STALE");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Bạn đang offline");
    // Back online: the user returns to the page they asked for, not the static fallback.
    await context.setOffline(false);
    await expect(page).toHaveURL(/\/\?auth_error=AUTH_STALE$/);
    await expect(page.getByRole("link", { name: "Tiếp tục với Google" })).toBeVisible();
  });
});
