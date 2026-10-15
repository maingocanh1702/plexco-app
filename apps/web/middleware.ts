import { NextResponse, type NextRequest } from "next/server";
import {
  buildNonceCsp,
  cspNonceEnabled,
  newNonce,
  parseProcessRole,
  pathAllowedForRole,
} from "./lib/request-policy";

/**
 * Local dev-login router (lib/dev-login/routing.ts), present ONLY in development bundles.
 * `process.env.NODE_ENV` is inlined at build time, so in a production bundle this is
 * `"production" === "development" ? require(...) : null`: webpack evaluates the constant condition,
 * never resolves the require, and no dev-login module is compiled into the build (the e2e
 * production spec scans .next for it).
 */
const devLoginRouting: typeof import("./lib/dev-login/routing").devLoginRouting | null =
  process.env.NODE_ENV === "development"
    ? // eslint-disable-next-line @typescript-eslint/no-require-imports -- build-time dead branch
      (require("./lib/dev-login/routing") as typeof import("./lib/dev-login/routing"))
        .devLoginRouting
    : null;

/**
 * Edge middleware — thin adapter over lib/request-policy.ts (read the policy and its reasons
 * there; audit 2026-09-06 W-10 + backlog `web-csp-script-src-nonce`).
 *
 * 1. PROCESS_ROLE=discovery serves only the discovery surface; everything else is a 404 with no
 *    body and no handler run.
 * 2. Development only: while the per-request dev-login gate is open (127.0.0.1 bind evidence
 *    included), the two virtual dev-login paths answer a 307 to their implementation routes. The
 *    Location is absolute and Next serves it as http://localhost:<port>/… for any loopback Host.
 *    The implementation paths get a bare 404 here when the gate is closed or the method is not a
 *    route method. Otherwise the router changes nothing.
 * 3. CSP_SCRIPT_NONCE_ENABLED="true" issues a per-request nonce, hands it to Next through the
 *    request's Content-Security-Policy + x-nonce headers (Next applies it to its inline
 *    bootstrap), and sets the same policy on the response. OFF by default — see request-policy.ts.
 */
export function middleware(request: NextRequest): NextResponse {
  const role = parseProcessRole(process.env.PROCESS_ROLE);
  if (!pathAllowedForRole(request.nextUrl.pathname, role)) {
    return new NextResponse(null, { status: 404, headers: { "cache-control": "no-store" } });
  }

  const devLogin = devLoginRouting ? devLoginRouting(request) : null;
  if (devLogin?.kind === "redirect") {
    // No Referrer-Policy: a redirect's policy becomes the policy of the re-sent POST, and a POST
    // under `no-referrer` carries `Origin: null`, which sameOriginRequest() refuses.
    return new NextResponse(null, {
      status: 307,
      headers: { location: devLogin.location, "cache-control": "no-store" },
    });
  }
  if (devLogin?.kind === "not_found") {
    return new NextResponse(null, { status: 404, headers: { "cache-control": "no-store" } });
  }

  if (!cspNonceEnabled(process.env.CSP_SCRIPT_NONCE_ENABLED)) return NextResponse.next();

  const nonce = newNonce();
  const csp = buildNonceCsp(nonce);
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("content-security-policy", csp);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("content-security-policy", csp);
  return response;
}

export const config = {
  // Skip Next's own static assets and the favicon; every page and API route goes through.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
