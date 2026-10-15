import { DEV_LOGIN_FLAG, devLoginEnvironmentVerdict } from "./env-policy.mjs";

/**
 * The PER-REQUEST dev-login gate. Evaluated by the middleware router (Edge, first) and again inside
 * every dev-login route handler (Node, second) on every request and every HTTP method. Any false
 * condition => the caller answers like a route that does not exist.
 *
 * Runtime-agnostic on purpose: no Node built-ins, no DB, no cookies.
 *
 * Host evidence is the RAW `Host` header only. Forwarding headers are never evidence FOR opening the
 * gate; they can only close it. Measured on next@15.5.25 `next dev` (2026-10-15, temporary probe
 * route + middleware echo): with no forwarding header sent by the client, BOTH middleware and route
 * handlers see `x-forwarded-for` (= socket remote address), `x-forwarded-host` (= Host),
 * `x-forwarded-port` (= server port) and `x-forwarded-proto` (= http), injected by
 * next/dist/server/base-server.js with `??=`. A client-supplied value is kept as sent. So "any
 * forwarding header closes the gate" would close it for every request; instead the four injected
 * headers must carry exactly the values Next itself would inject for a direct loopback connection,
 * and every other forwarding/proxy header closes the gate outright.
 */

export type DevLoginClosedReason =
  "node_env" | "flag" | "ingress" | "database_url" | "host" | "forwarded";

export type DevLoginGateDecision = { open: true } | { open: false; reason: DevLoginClosedReason };

export type DevLoginEnv = Readonly<Record<string, string | undefined>>;

/** The only header surface the gate reads. */
export type GateHeaders = Pick<Headers, "get" | "forEach">;

/**
 * The variables the gate reads, each via a direct `process.env.X` access (Edge middleware exposes
 * process.env as a runtime object; NODE_ENV is inlined at build time on both runtimes).
 */
export function readDevLoginEnv(): DevLoginEnv {
  return {
    NODE_ENV: process.env.NODE_ENV,
    [DEV_LOGIN_FLAG]: process.env.PLEXCO_DEV_LOGIN,
    TRUSTED_INGRESS_PROVIDER: process.env.TRUSTED_INGRESS_PROVIDER,
    DATABASE_URL: process.env.DATABASE_URL,
  };
}

/**
 * Strict loopback Host: exactly `localhost`, `127.0.0.1` or `[::1]`, lowercase, optionally followed
 * by `:<port>` (1-65535, no leading zero). Everything else is refused: `localhost.evil.test`,
 * `127.0.0.1.nip.io`, userinfo forms, a trailing dot, an empty or absent header.
 */
const LOOPBACK_HOST = /^(?:localhost|127\.0\.0\.1|\[::1\])(?::([1-9][0-9]{0,4}))?$/;

export function parseLoopbackHost(raw: string | null): { port: string | null } | null {
  if (raw === null) return null;
  const match = LOOPBACK_HOST.exec(raw);
  if (match === null) return null;
  const port = match[1] ?? null;
  if (port !== null && Number(port) > 65535) return null;
  return { port };
}

/** Socket addresses Next writes into x-forwarded-for for a loopback client (IPv4, IPv6, mapped). */
const LOOPBACK_SOCKET_ADDRESSES: readonly string[] = ["127.0.0.1", "::1", "::ffff:127.0.0.1"];

/**
 * Proxy/tunnel headers Next never injects. Any one of them present closes the gate: ngrok,
 * cloudflared, localtunnel, VS Code tunnels, Tailscale serve and ordinary reverse proxies all add at
 * least one of these or a non-loopback x-forwarded-* value.
 */
const PROXY_HEADER =
  /forwarded|^via$|client-?ip|real-ip|connecting-ip|^x-original-|^x-host$|^cf-|^cdn-loop$|^fly-|^x-envoy-|^x-azure-|^x-appengine-|^tailscale-/;

const INJECTED_BY_NEXT: readonly string[] = [
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-port",
  "x-forwarded-proto",
];

/** true when some forwarding header shows the request did not arrive directly over loopback. */
export function forwardingHeadersDisqualify(
  headers: GateHeaders,
  host: string,
  hostPort: string | null,
): boolean {
  let disqualified = false;
  headers.forEach((_value, rawName) => {
    const name = rawName.toLowerCase();
    if (!INJECTED_BY_NEXT.includes(name) && PROXY_HEADER.test(name)) disqualified = true;
  });
  if (disqualified) return true;

  const forwardedHost = headers.get("x-forwarded-host");
  if (forwardedHost !== null && forwardedHost !== host) return true;
  const forwardedPort = headers.get("x-forwarded-port");
  if (forwardedPort !== null && forwardedPort !== (hostPort ?? "80")) return true;
  const forwardedProto = headers.get("x-forwarded-proto");
  if (forwardedProto !== null && forwardedProto !== "http") return true;
  const forwardedFor = headers.get("x-forwarded-for");
  if (forwardedFor !== null && !LOOPBACK_SOCKET_ADDRESSES.includes(forwardedFor)) return true;
  return false;
}

/**
 * Process-level conditions first (env-policy.mjs, shared with next.config.mjs and the seed), then
 * the raw Host, then the forwarding headers. Order only decides which reason is reported; every
 * condition must hold for `open: true`.
 */
export function evaluateDevLoginGate(env: DevLoginEnv, headers: GateHeaders): DevLoginGateDecision {
  const environment = devLoginEnvironmentVerdict(env);
  if (environment !== null) return { open: false, reason: environment };
  const host = headers.get("host");
  const loopback = parseLoopbackHost(host);
  if (host === null || loopback === null) return { open: false, reason: "host" };
  if (forwardingHeadersDisqualify(headers, host, loopback.port)) {
    return { open: false, reason: "forwarded" };
  }
  return { open: true };
}

/**
 * The refusal inside a dev-login handler (status 404, empty body: what next/navigation notFound()
 * produces in a route handler, measured). The documented public paths never reach it with a closed
 * gate (the middleware leaves them unrewritten, so the framework answers its own 404); it answers a
 * DIRECT request to an implementation path while the gate is closed per request (non-loopback Host,
 * forwarding headers, network-exposed server), and anything that ever bypassed the middleware. It
 * is a refusal, not the indistinguishable response: that residual is stated in the PR.
 */
export function devLoginNotFound(): Response {
  return new Response(null, { status: 404, headers: { "cache-control": "no-store" } });
}
