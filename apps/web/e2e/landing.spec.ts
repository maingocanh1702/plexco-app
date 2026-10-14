import { expect, test } from "@playwright/test";

test.describe("signed-out landing", () => {
  test("renders in Vietnamese with the Google link as a top-level navigation", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("lang", "vi");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("câu lạc bộ");
    const google = page.getByRole("link", { name: "Tiếp tục với Google" });
    await expect(google).toHaveAttribute("href", "/api/auth/google/state");
    await expect(page.locator("main").getByRole("alert")).toHaveCount(0);
  });

  test("?auth_error=AUTH_INVALID shows the mapped message", async ({ page }) => {
    await page.goto("/?auth_error=AUTH_INVALID");
    await expect(page.locator("main").getByRole("alert")).toHaveText(
      "Không thể đăng nhập. Vui lòng thử lại.",
    );
  });

  test("an unknown auth_error code gets the generic message and is never echoed", async ({
    page,
  }) => {
    await page.goto("/?auth_error=%3Cb%3Eevil%3C%2Fb%3E");
    const alert = page.locator("main").getByRole("alert");
    await expect(alert).toHaveText("Không thể đăng nhập. Vui lòng thử lại.");
    await expect(alert).not.toContainText("evil");
  });

  test("the skip link is the first tab stop and targets main", async ({ page }) => {
    await page.goto("/");
    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: "Bỏ qua tới nội dung chính" });
    await expect(skip).toBeFocused();
    await expect(page.locator("main#main-content")).toHaveCount(1);
  });

  test("/onboarding/new-club redirects an unauthenticated visitor to the landing page", async ({
    page,
  }) => {
    await page.goto("/onboarding/new-club");
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("link", { name: "Tiếp tục với Google" })).toBeVisible();
  });

  test("/c/<tenant> redirects an unauthenticated visitor to the landing page", async ({ page }) => {
    await page.goto("/c/11111111-1111-1111-1111-111111111111");
    await expect(page).toHaveURL(/\/$/);
  });
});
