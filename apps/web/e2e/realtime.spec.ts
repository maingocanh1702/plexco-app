import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { installRealtimeStreamMock } from "./support/realtime-stream-mock";
import { TENANT_ID, installApiMock, makeSession, signIn } from "./support/session-api-mock";

/**
 * Web live sync in the browser (lane L5, A14, A16). /api/* is mocked per page and the stream by
 * realtime-stream-mock.ts: one pushed id-only frame must make the second view refetch through its
 * authorized GET and show the change with no reload. Server auth, fan-out and NOTIFY are covered
 * by the unit and DB tests; the real end-to-end latency by realtime-live.spec.ts (local only).
 */
const BASE = `/c/${TENANT_ID}/sessions`;
const fixtures = () => [
  makeSession({ id: "s-open", status: "open", version: 3, venueName: "Sân Cũ" }),
];
const card = (page: Page, id: string) => page.locator(`a[href$="/sessions/${id}"]`);
type Marked = Window & { __sameDocument?: boolean };

test("A14: a host edit in one context reaches a second context's list without a reload", async ({
  browser,
  baseURL,
}) => {
  const contexts = [await browser.newContext({ baseURL }), await browser.newContext({ baseURL })];
  try {
    for (const context of contexts) await signIn(context);
    const pageA = await contexts[0]!.newPage();
    const pageB = await contexts[1]!.newPage();
    const mockA = await installApiMock(pageA, fixtures());
    await installRealtimeStreamMock(pageA);
    const mockB = await installApiMock(pageB, fixtures());
    const streamB = await installRealtimeStreamMock(pageB);
    let listGets = 0; // B's answered list GETs (the detail GET is /api/sessions/<id>)
    pageB.on("requestfinished", (r) => {
      if (r.method() === "GET" && new URL(r.url()).pathname === "/api/sessions") listGets += 1;
    });

    await pageB.goto(BASE);
    await expect(card(pageB, "s-open")).toContainText("Sân Cũ");
    await expect.poll(() => streamB.urls.length).toBe(1);
    expect(new URL(streamB.urls[0]!).search).toBe(`?tenant=${TENANT_ID}`);
    await expect.poll(() => listGets).toBe(2); // the first GET and the open's own resync (F2)
    await pageB.evaluate(() => {
      (window as Marked).__sameDocument = true;
    });

    await pageA.goto(`${BASE}/s-open/edit`);
    await pageA.getByLabel("Tên sân / địa điểm").fill("Sân Mới");
    await pageA.getByRole("button", { name: "Lưu thay đổi" }).click();
    await expect(pageA).toHaveURL(new RegExp(`${BASE}/s-open$`));
    const edited = mockA.state.find((s) => s.id === "s-open")!;
    expect(edited.venueName).toBe("Sân Mới");

    // The change lands in B's server state only. B's stream stays open and B does not poll, so only
    // the pushed frame can make B refetch: a client that drops every frame fails here (F3).
    Object.assign(
      mockB.state.find((s) => s.id === "s-open")!,
      structuredClone(edited),
    );
    await expect(card(pageB, "s-open")).toContainText("Sân Cũ");
    expect(listGets).toBe(2);
    await streamB.push({ type: "session.updated", sessionId: "s-open", version: edited.version });
    await expect(card(pageB, "s-open")).toContainText("Sân Mới");
    await expect.poll(() => listGets).toBe(3);
    expect(streamB.urls).toHaveLength(1); // never reconnected, so no reopen resync either
    expect(await pageB.evaluate(() => (window as Marked).__sameDocument)).toBe(true);
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});

test.describe("A16: live views stay accessible at 375 px", () => {
  test.use({ viewport: { width: 375, height: 812 } });
  test.beforeEach(async ({ context }) => {
    await signIn(context);
  });

  for (const [name, path] of [
    ["list", ""],
    ["detail", "/s-open"],
  ] as const) {
    test(name, async ({ page }) => {
      await installApiMock(page, fixtures());
      const stream = await installRealtimeStreamMock(page);
      await page.goto(`${BASE}${path}`);
      // Loaded state: the list card, or the detail tabs (loading and error states render neither).
      const ready = path ? page.getByRole("tab").first() : card(page, "s-open");
      await expect(ready).toBeVisible();
      await expect.poll(() => stream.urls.length).toBe(1);
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
        .analyze();
      const blocking = results.violations.filter(
        (v) => v.impact === "serious" || v.impact === "critical",
      );
      expect(blocking.map((v) => ({ id: v.id, nodes: v.nodes.length }))).toEqual([]);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    });
  }
});
