import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import * as mock from "./support/chat-api-mock";
import { NETWORK, fail, ok } from "./support/player-api-mock";
import { TENANT_ID } from "./support/session-api-mock";

/** L16 chat: 2 screens x 5 states x 2 viewports x 2 schemes; a state is a standing mock reply. */
const LIST = `/c/${TENANT_ID}/chat`;
const VIEW = `${LIST}/${mock.CHANNEL_ID}`;
const viewer = { canModerate: true, canPostRestricted: true };
const ERR = fail("INTERNAL_ERROR", 500);
const SCREENS = [
  ["channel list", LIST, "channels", ok({ channels: [], viewer })],
  ["channel view", VIEW, "history", ok({ messages: [], nextCursor: null })],
] as const;
const VIEWPORTS = [
  [375, 812],
  [1280, 800],
] as const;

async function expectFitsAndAxeClean(page: Page, width: number) {
  if (width <= 375) {
    const fits = await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    );
    expect(fits, "no horizontal overflow at 375").toBe(true);
  }
  const { violations } = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  const blocking = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(blocking.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length }))).toEqual([]);
}

for (const scheme of ["light", "dark"] as const) {
  for (const [width, height] of VIEWPORTS) {
    test.describe(`chat axe ${scheme} ${width}x${height}`, () => {
      test.use({ colorScheme: scheme, viewport: { width, height } });
      for (const [screen, url, key, empty] of SCREENS) {
        const states = { loading: null, ready: null, empty, error: ERR, offline: NETWORK };
        for (const [state, reply] of Object.entries(states)) {
          test(`${screen} ${state}`, async ({ page }) => {
            await page.addInitScript(() => window.localStorage.setItem("plx-lang", "en"));
            const replies = reply ? { [key]: reply } : {};
            const chat = await mock.installChatApi(page, replies, { locale: "en" });
            const release = state === "loading" ? chat.holdNext(key) : null;
            try {
              await page.goto(url);
              await expect(page.locator("[data-state]")).toHaveAttribute("data-state", state);
              await expectFitsAndAxeClean(page, width);
            } finally {
              release?.();
            }
          });
        }
      }
      test("channel view sheet open", async ({ page }) => {
        await page.addInitScript(() => window.localStorage.setItem("plx-lang", "en"));
        await mock.installChatApi(page, {}, { locale: "en" });
        await page.goto(VIEW);
        await expect(page.locator("[data-state]")).toHaveAttribute("data-state", "ready");
        await page.getByRole("button", { name: "Hide", exact: true }).click();
        await expect(page.getByRole("dialog")).toBeVisible();
        await expectFitsAndAxeClean(page, width);
      });
    });
  }
}
