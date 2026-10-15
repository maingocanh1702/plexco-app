import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { expect, test, type APIRequestContext } from "@playwright/test";

/**
 * Production exclusion of the local-only dev-login (lib/dev-login). This suite runs against the
 * REAL production build (`next build && next start`, playwright.config.ts), so it proves what a
 * deployment would serve:
 *  1. every dev-login surface (the virtual /dev-login and /api/dev/login, and the internal
 *     implementation paths) answers exactly like a route that does not exist, for every method —
 *     same status, content type, Allow header and body as a truly missing path of the same kind;
 *  2. no dev-login module was compiled into the build output (a marker scan of .next).
 */
// PROPFIND: a method no route module can export (an existing route answers it 400 in Next).
const METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "PROPFIND"] as const;

/**
 * Each control is a truly missing path of the SAME shape (segment count and lengths, an /api
 * target keeps its "api" segment): a missing route's body embeds its own path, and a streamed RSC
 * payload is cut into fixed-size chunks whose split points move with the path's length.
 */
const TARGETS = [
  { kind: "page", target: "/dev-login", control: "/qqq-qqqqq" },
  { kind: "api", target: "/api/dev/login", control: "/api/qqq/qqqqq" },
  { kind: "page", target: "/internal-dev-login/page", control: "/qqqqqqqq-qqq-qqqqq/qqqq" },
  { kind: "api", target: "/internal-dev-login/session", control: "/qqqqqqqq-qqq-qqqqq/qqqqqqq" },
] as const;

/** Only per-request values are removed, plus the embedded path ("c") and RSC chunk boundaries. */
function normalize(body: string): string {
  return body
    .split('"])</script><script>self.__next_f.push([1,"')
    .join("")
    .replace(/v=\d{10,}/g, "v=TS")
    .replace(/N\d{10,}(\.\d+)?/g, "NTS")
    .replace(/nonce="[^"]*"/g, 'nonce="N"')
    .replace(/\\"c\\":\[[^\]]*\]/g, '\\"c\\":[PATH]')
    .replace(/"c":\[[^\]]*\]/g, '"c":[PATH]');
}

async function snapshot(request: APIRequestContext, method: string, url: string) {
  const response = await request.fetch(url, {
    method,
    maxRedirects: 0,
    ...(method === "POST" || method === "PUT" || method === "PATCH"
      ? {
          headers: { "content-type": "application/x-www-form-urlencoded" },
          data: "persona=owner&csrf=x",
        }
      : {}),
  });
  const headers = response.headers();
  return {
    status: response.status(),
    contentType: headers["content-type"] ?? "",
    allow: headers["allow"] ?? "",
    body: normalize(method === "HEAD" ? "" : await response.text()),
  };
}

test.describe("dev-login does not exist in the production build", () => {
  for (const { kind, target, control } of TARGETS) {
    for (const method of METHODS) {
      test(`${method} ${target} is indistinguishable from a missing ${kind} path`, async ({
        request,
      }) => {
        const actual = await snapshot(request, method, target);
        const missing = await snapshot(request, method, control);
        expect(actual.status).toBe(404);
        expect(actual).toEqual(missing);
      });
    }
  }

  test("no dev-login module is compiled into .next (marker scan)", () => {
    const webRoot = path.dirname(test.info().config.configFile!);
    const distDir = path.join(webRoot, ".next");
    expect(existsSync(path.join(distDir, "BUILD_ID"))).toBe(true);

    // Strings that exist only inside the dev-login modules (routing, gate, csrf, personas,
    // persona-account, handlers, page-document, the seed helper) and never in middleware.ts,
    // whose own source (a dead `require` branch) legitimately sits in middleware.js.map.
    // String LITERALS survive minification; identifiers do not, so the identifiers below only
    // catch unminified output (a source map's sourcesContent, a dev build in .next).
    const markers = [
      "internal-dev-login",
      "/api/dev/login",
      "PLEXCO_DEV_LOGIN",
      "plexco.dev_login",
      "plx_dev_login_csrf",
      "plexco:web-auth:v1:dev-login:",
      "auth.dev_login",
      "@dev.invalid",
      "DEV ONLY",
      "evaluateDevLoginGate",
      "resolveDevPersonaAccount",
      "ensureDevClubMember",
    ];
    // .next/cache holds compiler/type-check/lint caches (tsbuildinfo lists every source path,
    // dev-login files included); it is never served or executed, so it is not build output.
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = path.join(dir, entry);
        if (statSync(full).isDirectory()) {
          if (full !== path.join(distDir, "cache")) walk(full);
        } else files.push(full);
      }
    };
    walk(distDir);

    const middleware = path.join(distDir, "server", "middleware.js");
    expect(files).toContain(middleware);
    expect(files).toContain(path.join(distDir, "server", "app-paths-manifest.json"));
    expect(files.length).toBeGreaterThan(100);

    const hits = files.flatMap((file) => {
      const text = readFileSync(file, "latin1");
      return markers.filter((marker) => text.includes(marker)).map((m) => `${file}: ${m}`);
    });
    expect(hits).toEqual([]);

    // The production middleware dropped the dev-login branch entirely. If it survived (a NODE_ENV
    // test webpack cannot inline), routing.ts, gate.ts and env-policy.mjs would be compiled in and
    // their string literals with them: mutation-tested once (a dynamic process.env["NODE_" + "ENV"]
    // check in middleware.ts made both this and the marker scan above fail).
    const compiled = readFileSync(middleware, "utf8");
    for (const literal of ["/api/dev/login", "internal-dev-login", "PLEXCO_DEV_LOGIN"]) {
      expect(compiled).not.toContain(literal);
    }

    const manifest = JSON.parse(
      readFileSync(path.join(distDir, "server", "app-paths-manifest.json"), "utf8"),
    ) as Record<string, string>;
    expect(Object.keys(manifest).some((route) => route.includes("dev-login"))).toBe(false);
  });
});
