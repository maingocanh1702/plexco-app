import { once } from "node:events";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, test } from "@playwright/test";
import { buildCompletionLanding, COMPLETION_PATH, HANDOFF_FIELD } from "../lib/session-cookies";
import { SECURITY_HEADERS } from "../next.config.mjs";

/**
 * The Google sign-in landing's own half, proven in a real browser: a permanent CI guard.
 *
 * The OAuth callback answers with buildCompletionLanding(), a document whose one inline script
 * auto-submits a same-origin POST of the one-time handoff to COMPLETION_PATH. Unit tests read its
 * markup and headers; only a browser proves that the script runs under the headers production
 * really sends, that the form posts, and which Origin and Referer that POST carries.
 *
 * Production's header precedence is reproduced from next.config.mjs, not assumed: SECURITY_HEADERS
 * reach every path, and a SECURITY_HEADERS key replaces the landing's own header of the same name
 * (case-insensitive), so the stand-in callback sets them over the landing's headers the same way.
 *
 * No database, no Google, no request to the Next server: a local node:http server stands in for
 * the callback route and page.route answers the completion POST. No secret: test values only.
 */

const HANDOFF = "lcs-test-handoff-0123456789";
const CALLBACK = "/api/auth/google/callback?code=c&state=s";
const REPORTER = "__lcsReportCspViolation";

type CspViolation = { directive: string; blocked: string };
type Reporter = (violation: CspViolation) => unknown;
type CapturedRequest = { method: string; headers: Record<string, string>; body: string | null };

/** The landing's own headers with every SECURITY_HEADERS entry set over them, keys lower-cased. */
function withSecurityHeaders(own: Record<string, string>): Record<string, string> {
  const siteWide = SECURITY_HEADERS.map(({ key, value }): [string, string] => [key, value]);
  return Object.fromEntries(
    [...Object.entries(own), ...siteWide].map(([key, value]) => [key.toLowerCase(), value]),
  );
}

test.describe("sign-in completion landing", () => {
  let server: Server;
  let serverOrigin: string;

  test.beforeAll(async () => {
    server = createServer((req, res) => {
      if (req.method === "GET" && req.url === CALLBACK) {
        const landing = buildCompletionLanding(HANDOFF);
        res.writeHead(200, withSecurityHeaders(landing.headers)).end(landing.body);
        return;
      }
      res.writeHead(404).end();
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    serverOrigin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  test.afterAll(async () => {
    const closed = once(server, "close");
    server.close();
    server.closeAllConnections();
    await closed;
  });

  test("auto-submits the handoff as a same-origin POST under production's headers", async ({
    page,
  }) => {
    const captured: CapturedRequest[] = [];
    const violations: CspViolation[] = [];
    await page.route(`**${COMPLETION_PATH}`, async (route, request) => {
      captured.push({
        method: request.method(),
        headers: await request.allHeaders(),
        body: request.postData(),
      });
      await route.fulfill({
        status: 200,
        contentType: "text/html",
        body: "<!doctype html><title>ok</title>",
      });
    });
    await page.exposeFunction(REPORTER, (violation: CspViolation) => {
      violations.push(violation);
    });
    await page.addInitScript((reporter: string) => {
      document.addEventListener("securitypolicyviolation", (event) => {
        const report = (window as unknown as Record<string, Reporter>)[reporter]!;
        void report({ directive: event.effectiveDirective, blocked: event.blockedURI });
      });
    }, REPORTER);
    const posted = page.waitForRequest(
      (request) =>
        request.method() === "POST" && new URL(request.url()).pathname === COMPLETION_PATH,
    );

    const landingUrl = `${serverOrigin}${CALLBACK}`;
    // The landing navigates away by itself, so the POST, not a load event, is the sync point.
    await page.goto(landingUrl, { waitUntil: "commit" });
    // The route handler records a request before fulfilling it: once the POST has its response,
    // its record exists.
    await (await posted).response();

    // (a) The nonce script ran and the form submitted: one request, a POST of exactly the handoff.
    expect(
      captured.map((record) => record.method),
      "one request, a POST, reaches the completion path",
    ).toEqual(["POST"]);
    const post = captured[0]!;
    expect(post.body, "the POST body is exactly the handoff field").toBe(
      `${HANDOFF_FIELD}=${HANDOFF}`,
    );

    // (b) A "null" Origin fails the completion route's same-origin check.
    expect(post.headers.origin, "the POST carries a real Origin").not.toBe("null");
    expect(post.headers.origin, "the POST's Origin is the landing's origin").toBe(
      new URL(landingUrl).origin,
    );

    // (c) Base value: the full landing URL (SECURITY_HEADERS' strict-origin-when-cross-origin
    // replaces the landing's own no-referrer; the POST is same-origin).
    // D1 (W2b, same PR) flips this to the origin only: new URL(landingUrl).origin + "/".
    expect(post.headers.referer, "the POST's Referer is the full landing URL").toBe(landingUrl);

    // (d) A script-src* or form-action violation would block the landing; any other one (a
    // favicon under default-src 'none', say) is recorded on the test, never failed.
    const blocking: string[] = [];
    const { annotations } = test.info();
    for (const { directive, blocked } of violations) {
      if (directive.startsWith("script-src") || directive === "form-action") {
        blocking.push(directive);
      } else {
        annotations.push({ type: "csp-violation", description: `${directive} ${blocked}` });
      }
    }
    expect(blocking, "no script-src or form-action CSP violation").toEqual([]);
  });
});
