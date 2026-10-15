import { evaluateDevLoginGate, readDevLoginEnv, type DevLoginEnv, type GateHeaders } from "./gate";

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
 * a rewritten Host). A redirect is never proxied: Next only relativizes its Location, and the
 * browser itself follows it. Next's middleware adapter parses the Location as an absolute URL
 * (a relative one throws "Invalid URL", measured), so it is built from the raw Host the gate has
 * just verified to be a strict loopback form: the browser returns to exactly the host it used, and
 * the redirect can never point anywhere but this machine. 307 keeps the POST method and body.
 *
 * The implementation routes (`app/internal-dev-login/{page,session}/route.dev.ts`) are compiled only
 * when every process-level condition holds (next.config.mjs pageExtensions); otherwise they do not
 * exist either. Where they exist, every request to them runs the full gate inside the handler.
 */
export const DEV_LOGIN_PAGE_PATH = "/dev-login";
export const DEV_LOGIN_API_PATH = "/api/dev/login";

const INTERNAL_PREFIX = "/internal-dev-login";
export const DEV_LOGIN_PAGE_ROUTE = `${INTERNAL_PREFIX}/page`;
export const DEV_LOGIN_API_ROUTE = `${INTERNAL_PREFIX}/session`;

export interface RoutableRequest {
  nextUrl: { pathname: string; search: string };
  headers: GateHeaders;
}

/**
 * The redirect Location for this request (loopback-only, see above), or null to leave it alone (a
 * closed gate leaves the virtual public paths alone, which is exactly what makes them the
 * framework's own 404).
 */
export function devLoginRedirectLocation(
  request: RoutableRequest,
  env: DevLoginEnv = readDevLoginEnv(),
): string | null {
  const { pathname, search } = request.nextUrl;
  const route =
    pathname === DEV_LOGIN_PAGE_PATH
      ? DEV_LOGIN_PAGE_ROUTE
      : pathname === DEV_LOGIN_API_PATH
        ? DEV_LOGIN_API_ROUTE
        : null;
  if (route === null) return null;
  if (!evaluateDevLoginGate(env, request.headers).open) return null;
  // The gate just proved Host is exactly localhost / 127.0.0.1 / [::1] with an optional port, and
  // that the request is plain http (x-forwarded-proto absent or "http").
  const host = request.headers.get("host")!;
  return `http://${host}${route}${search}`; // ?error= is the page's closed-set message key
}
