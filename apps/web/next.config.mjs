import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  assertDevLoginBootSafe,
  assertNoDevLoginInProductionCompile,
  pageExtensionsFor,
} from "./lib/dev-login/env-policy.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/**
 * Dev-login boot fail-closed (lib/dev-login/env-policy.mjs). next dev, next build and next start all
 * evaluate this file before doing anything else, so PLEXCO_DEV_LOGIN present with ANY value while
 * NODE_ENV is not "development" stops the process here, with the reason on stderr.
 */
assertDevLoginBootSafe(process.env);

/**
 * `route.dev.ts` files are routes only for a development server with every process-level dev-login
 * condition true; every other build and start uses Next's default extensions, so the dev-login route
 * modules are never compiled into a production build.
 */
const pageExtensions = pageExtensionsFor(process.env);

/**
 * Baseline security headers on EVERY response (audit 2026-09-06 W-2: none were
 * set anywhere; fly.toml force_https redirects but sends no HSTS; only the
 * OAuth landing built its own CSP/XFO). HSTS is harmless over plain http —
 * browsers ignore it — so there is deliberately no NODE_ENV branch.
 *
 * The CSP is DELIBERATELY without `default-src`/`script-src`. The App Router
 * bootstraps every page with inline `<script>self.__next_f.push(...)</script>`
 * tags, so a `default-src 'self'` policy would block them on every route and
 * the next reader would "fix" it with `'unsafe-inline'`, which is worse than
 * nothing. What IS sent is the directive set that needs no nonce and cannot
 * break rendering: `frame-ancestors 'none'` (clickjacking — the same intent as
 * X-Frame-Options DENY; both go out because old engines honour only one),
 * `base-uri 'self'`, `form-action 'self'` (a hijacked form cannot post
 * elsewhere) and `object-src 'none'`. A nonce-based `script-src` is the
 * documented Next pattern (middleware issuing a per-request nonce); it is a
 * backlog row, not a config line — see `web-csp-script-src-nonce`.
 *
 * Precedence, measured on Next 15.5.28 under next dev and next build + next
 * start alike (durable record:
 * docs/research/web-mvp-phase5-production-hardening-2026-10-29.md): a config
 * header REPLACES a route's own header of the same key, so the OAuth completion
 * landing's own CSP, X-Frame-Options and Referrer-Policy headers never reach the
 * browser; the landing runs under the global CSP and Referrer-Policy (its own
 * CSP: backlog row p5-oauth-landing-own-csp-browser-check). Of two `headers()`
 * entries setting one key on a path the LATER entry wins (one header line, no
 * join), and config headers also reach a `notFound()` 404.
 *
 * @type {{ key: string; value: string }[]}
 */
export const SECURITY_HEADERS = [
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  {
    key: "Content-Security-Policy",
    value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'",
  },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  pageExtensions,
  async headers() {
    return [
      { source: "/(.*)", headers: SECURITY_HEADERS },
      // Must stay AFTER the global entry: of two entries setting one key, the later one wins.
      {
        source: "/session/:slug",
        headers: [
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
        ],
      },
    ];
  },
  // Pin tracing to this monorepo; do not let unrelated lockfiles above the
  // repository make Next.js infer /Users/maingocanh as the workspace root.
  outputFileTracingRoot: repoRoot,
  // Workspace packages are consumed as TypeScript source (see their `exports`).
  transpilePackages: ["@plexco/core", "@plexco/db"],
  webpack: (config, { dev }) => {
    // `dev` is false for every `next build` compilation, whatever NODE_ENV says: a production
    // compilation with the dev-login flag present or its routes enabled stops here.
    assertNoDevLoginInProductionCompile({ dev, pageExtensions, env: process.env });
    // The workspace packages are NodeNext ESM: relative imports use ".js"
    // specifiers that resolve to ".ts" sources (required by tsc/tsx/vitest).
    // Teach webpack the same extension aliasing so `next build` resolves them.
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      ".js": [".ts", ".tsx", ".js"],
    };
    return config;
  },
};

export default nextConfig;
