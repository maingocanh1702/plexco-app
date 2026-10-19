import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

/**
 * Automated WCAG 2.2 AA pass: every public screen x {light, dark} x {375x812, 1280x800}.
 * Only serious/critical violations fail the run; the manual keyboard/screen-reader pass is
 * recorded in the PR (axe cannot judge reading order or focus management on its own).
 */
const SCREENS = [
  { name: "landing", path: "/" },
  { name: "landing with auth error", path: "/?auth_error=AUTH_STALE" },
  { name: "offline", path: "/offline" },
  // Unauthenticated: redirects to the landing page, which is what must be accessible.
  { name: "new-club (unauthenticated)", path: "/onboarding/new-club" },
  // Anonymous discovery: no session and no API mock, the page only has to render its main (R B-2).
  { name: "discover (anonymous)", path: "/discover" },
];
const SCHEMES = ["light", "dark"] as const;
const VIEWPORTS = [
  { name: "375x812", width: 375, height: 812 },
  { name: "1280x800", width: 1280, height: 800 },
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
          await page.goto(screen.path);
          await page.locator("main").first().waitFor();
          const results = await new AxeBuilder({ page })
            .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
            .analyze();
          const blocking = results.violations.filter(
            (v) => v.impact === "serious" || v.impact === "critical",
          );
          expect(
            blocking.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length })),
          ).toEqual([]);
        });
      }
    });
  }
}
