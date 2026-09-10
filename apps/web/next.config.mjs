import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

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
 * The OAuth completion landing (apps/web/lib/session-cookies.ts) sets its OWN
 * Content-Security-Policy on that one response; a route-level header replaces
 * this global one for that response only (Next applies config headers first,
 * the response's own header wins), so the landing's nonce policy is unchanged.
 * And should a Next version ever send BOTH, the intersection still lets the
 * landing work: its auto-submit posts to the same origin (`form-action
 * 'self'`), and nothing here touches `script-src`.
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
  async headers() {
    return [{ source: "/(.*)", headers: SECURITY_HEADERS }];
  },
  // Pin tracing to this monorepo; do not let unrelated lockfiles above the
  // repository make Next.js infer /Users/maingocanh as the workspace root.
  outputFileTracingRoot: repoRoot,
  // Workspace packages are consumed as TypeScript source (see their `exports`).
  transpilePackages: ["@plexco/core", "@plexco/db"],
  webpack: (config) => {
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
