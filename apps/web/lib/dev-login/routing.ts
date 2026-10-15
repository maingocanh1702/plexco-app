import { log } from "../log";
import { DEV_LOGIN_FLAG, devLoginEnvironmentVerdict } from "./env-policy.mjs";
import {
  evaluateDevLoginGate,
  gateClosedRemedy,
  readDevLoginEnv,
  type DevLoginClosedReason,
  type DevLoginEnv,
  type GateHeaders,
} from "./gate";

/**
 * Dev-login URL layout, decided in middleware (Edge). Loaded by middleware.ts ONLY in development
 * bundles (a constant-false `require` branch in production), so none of this is compiled into a
 * production build.
 *
 * WHY THE PUBLIC PATHS HAVE NO ROUTE FILES. Measured on next@15.5.25: a missing route's 404 body
 * embeds its own path in the RSC payload (`"c":["","<path>"]`) and a middleware rewrite embeds the
 * REWRITE TARGET instead, so an existing route cannot be made to 404 indistinguishably. The two
 * documented paths are therefore VIRTUAL: nothing exists at /dev-login or /api/dev/login. With the
 * gate closed the middleware leaves them alone and the framework renders its own 404 for a path
 * that really does not exist, for every HTTP method.
 *
 * WHY A REDIRECT AND NOT A REWRITE. With the gate open the virtual path is answered with a 307 to
 * the implementation route. Measured on next@15.5.25 `next dev -H 127.0.0.1`: an absolute middleware
 * rewrite is compared against the router's own origin, which does not match the origin middleware
 * sees, so the rewrite was proxied as an EXTERNAL request (socket hang up, or a re-sent request with
 * a rewritten Host). A redirect is never proxied; the browser follows it. Next's middleware adapter
 * requires an absolute Location (a relative one throws "Invalid URL", measured), so it is built from
 * the gate-verified loopback Host; Next then serves it as `http://localhost:<port>/…` for ANY
 * loopback Host (measured: Host 127.0.0.1 -> Location http://localhost:<port>/…). Either way the
 * redirect can only ever point at this machine. 307 keeps the POST method and body.
 *
 * THE IMPLEMENTATION ROUTES (`app/internal-dev-login/{page,session}/route.dev.ts`) are compiled only
 * when every process-level condition holds (next.config.mjs pageExtensions); otherwise they do not
 * exist, and every request to their paths is the framework's own 404. Where they do exist, a request
 * to them with the per-request gate closed (non-loopback Host, forwarding headers, no 127.0.0.1 bind
 * evidence) or with a method no route handler can export (PROPFIND, …) is answered here with a
 * bare 404 for every method. That is still NOT the framework's 404 body: an existing route cannot be
 * made byte-identical to a missing one (above), which is the stated residual. The handlers re-check
 * everything themselves.
 */
export const DEV_LOGIN_PAGE_PATH = "/dev-login";
export const DEV_LOGIN_API_PATH = "/api/dev/login";

const INTERNAL_PREFIX = "/internal-dev-login";
export const DEV_LOGIN_PAGE_ROUTE = `${INTERNAL_PREFIX}/page`;
export const DEV_LOGIN_API_ROUTE = `${INTERNAL_PREFIX}/session`;

/** The only methods an App Router route module can export. */
const ROUTE_METHODS: readonly string[] = [
  "GET",
  "HEAD",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "OPTIONS",
];

export interface RoutableRequest {
  method: string;
  nextUrl: { pathname: string; search: string };
  headers: GateHeaders;
}

export type DevLoginRouting = { kind: "redirect"; location: string } | { kind: "not_found" } | null;

function decodedOrRaw(pathname: string): string {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return pathname;
  }
}

/** Case- and percent-encoding-insensitive: every spelling that could reach the internal routes. */
export function isInternalDevLoginPath(pathname: string): boolean {
  return [pathname, decodedOrRaw(pathname)].some((candidate) => {
    const lower = candidate.toLowerCase();
    return lower === INTERNAL_PREFIX || lower.startsWith(`${INTERNAL_PREFIX}/`);
  });
}

/**
 * Server-console explanation of a refusal the middleware answers itself (no handler runs, so the
 * handlers' own gate_closed lines never fire for these): reason and remedy only, never in the
 * response, no request data. Silent unless PLEXCO_DEV_LOGIN is present, i.e. unless the developer
 * meant to use dev-login; a normal dev server stays quiet.
 */
export type GateClosedReporter = (reason: DevLoginClosedReason) => void;

export function reportGateClosedToServerLog(reason: DevLoginClosedReason): void {
  const remedy = gateClosedRemedy(reason);
  log.warn("auth.dev_login.gate_closed", { reason, ...(remedy ? { remedy } : {}) });
}

/** What the middleware does with this request; null = leave it alone. */
export function devLoginRouting(
  request: RoutableRequest,
  env: DevLoginEnv = readDevLoginEnv(),
  report: GateClosedReporter = reportGateClosedToServerLog,
): DevLoginRouting {
  const { pathname, search } = request.nextUrl;
  const intended = env[DEV_LOGIN_FLAG] !== undefined;

  if (isInternalDevLoginPath(pathname)) {
    // Not compiled (a process-level condition is false): the framework's own 404 is already exact.
    if (devLoginEnvironmentVerdict(env) !== null) return null;
    const decision = evaluateDevLoginGate(env, request.headers);
    if (!decision.open) report(decision.reason);
    const methodOk = ROUTE_METHODS.includes(request.method.toUpperCase());
    // Owner-accepted residual (owner, 2026-10-15, "S5 A2 waived"): with dev-login on, a request to
    // the /internal-dev-login prefix that fails only the per-request checks gets this empty 404,
    // not the framework's HTML 404. That reveals that dev-login is on; it cannot log anyone in.
    return methodOk && decision.open ? null : { kind: "not_found" };
  }

  const route =
    pathname === DEV_LOGIN_PAGE_PATH
      ? DEV_LOGIN_PAGE_ROUTE
      : pathname === DEV_LOGIN_API_PATH
        ? DEV_LOGIN_API_ROUTE
        : null;
  if (route === null) return null;
  const decision = evaluateDevLoginGate(env, request.headers);
  if (!decision.open) {
    if (intended) report(decision.reason);
    return null;
  }
  // The gate just proved Host is exactly localhost / 127.0.0.1 / [::1] with an optional port and
  // that the request is plain http; Next re-serves the Location as http://localhost:<port>/….
  const host = request.headers.get("host")!;
  return { kind: "redirect", location: `http://${host}${route}${search}` };
}
