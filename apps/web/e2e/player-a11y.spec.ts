import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { SCREEN_STATES, SCREENS, putScreenInState } from "./support/player-api-mock";

/**
 * B-1: every L12 screen x its states (R 4.6) x {375x812, 1280x800} x {light, dark}. A state a screen
 * does not have is n/a in R 4.6 and gets no test. Each cell asserts the data-state value, no
 * horizontal overflow at 375 and no serious or critical axe finding. Every /api call is mocked.
 */
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

      for (const [screen, def] of Object.entries(SCREENS)) {
        for (const state of SCREEN_STATES) {
          if (!def.cells[state]) continue;
          test(`${screen} ${state}`, async ({ page }) => {
            const { root, expected, release } = await putScreenInState(page, screen, state);
            try {
              await expect(root).toHaveAttribute("data-state", expected);
              if (viewport.width <= 375) {
                const fits = await page.evaluate(
                  () =>
                    document.documentElement.scrollWidth <= document.documentElement.clientWidth,
                );
                expect(fits, "no horizontal overflow at 375").toBe(true);
              }
              const results = await new AxeBuilder({ page })
                .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
                .analyze();
              const blocking = results.violations.filter(
                (v) => v.impact === "serious" || v.impact === "critical",
              );
              expect(
                blocking.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length })),
              ).toEqual([]);
            } finally {
              release();
            }
          });
        }
      }
    });
  }
}
