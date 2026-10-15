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
 *
 * Bind evidence (positive, per request): the raw Host proves nothing about who can CONNECT, so the
 * gate also requires that the dev server itself is listening on 127.0.0.1 only. Measured on
 * next@15.5.25 `next dev` (both middleware and handler read the same values):
 *   -H 127.0.0.1 -> binds 127.0.0.1:P, __NEXT_PRIVATE_ORIGIN = http://127.0.0.1:P   (accepted)
 *   -H ::        -> binds *:P,          __NEXT_PRIVATE_ORIGIN = http://[::1]:P
 *   -H ::1       -> binds [::1]:P,      __NEXT_PRIVATE_ORIGIN = http://[::1]:P       (ambiguous)
 *   no -H, -H 0.0.0.0 -> binds *:P,     __NEXT_PRIVATE_ORIGIN = http://localhost:P
 *   -H localhost -> binds [::1]:P,      __NEXT_PRIVATE_ORIGIN = http://localhost:P   (ambiguous)
 * So the only unambiguous loopback-only evidence is exactly `http://127.0.0.1:<PORT>`, where PORT is
 * the port next/dist/server/lib/start-server.js stores alongside it. Anything else closes the gate.
 */

export type DevLoginClosedReason =
  "node_env" | "flag" | "ingress" | "database_url" | "bind" | "host" | "forwarded";

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
    // Written by next/dist/server/lib/start-server.js when the server starts listening.
    __NEXT_PRIVATE_ORIGIN: process.env.__NEXT_PRIVATE_ORIGIN,
    PORT: process.env.PORT,
  };
}

/** true only for a server Next itself reports as bound to 127.0.0.1 on its real port (see above). */
export function loopbackBindEvidence(env: DevLoginEnv): boolean {
  const port = env.PORT;
  if (typeof port !== "string" || !/^[1-9][0-9]{0,4}$/.test(port) || Number(port) > 65535) {
    return false;
  }
  return env.__NEXT_PRIVATE_ORIGIN === `http://127.0.0.1:${port}`;
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
 * the bind evidence, the raw Host and the forwarding headers. Order only decides which reason is
 * reported; every condition must hold for `open: true`. One relabel, never a different decision: a
 * port-less loopback Host (curl -H 'Host: localhost') fails the x-forwarded-port check, because Next
 * injects the server's real port, not 80. That is a Host problem, not a proxy: if the check passes
 * with the server's own port in place of the missing one, the reason is "host".
 */
export function evaluateDevLoginGate(env: DevLoginEnv, headers: GateHeaders): DevLoginGateDecision {
  const environment = devLoginEnvironmentVerdict(env);
  if (environment !== null) return { open: false, reason: environment };
  if (!loopbackBindEvidence(env)) return { open: false, reason: "bind" };
  const host = headers.get("host");
  const loopback = parseLoopbackHost(host);
  if (host === null || loopback === null) return { open: false, reason: "host" };
  if (forwardingHeadersDisqualify(headers, host, loopback.port)) {
    const onlyThePortIsMissing =
      loopback.port === null && !forwardingHeadersDisqualify(headers, host, env.PORT ?? null);
    return { open: false, reason: onlyThePortIsMissing ? "host" : "forwarded" };
  }
  return { open: true };
}

/**
 * Owner-facing hint for a closed-gate reason, written to the SERVER log only (never a response):
 * the 404 itself must stay indistinguishable from a missing route, so the console is the one place
 * that says why. No request data, no PII.
 */
export function gateClosedRemedy(reason: string): string | undefined {
  switch (reason) {
    case "bind":
      return "start the dev server with exactly -H 127.0.0.1 (not localhost, ::, ::1 or no -H)";
    case "flag":
      return "set PLEXCO_DEV_LOGIN=1 on the next dev command line";
    case "ingress":
      return "set TRUSTED_INGRESS_PROVIDER=direct";
    case "database_url":
      return "DATABASE_URL must name localhost, 127.0.0.1, [::1] or postgres, with no query string";
    case "host":
      return "open http://localhost:<port>/dev-login: the raw Host must be loopback and carry the dev server's port";
    case "forwarded":
      return "do not reach the dev server through a proxy or tunnel";
    default:
      return undefined;
  }
}

/**
 * The bare refusal (status 404, empty body: what next/navigation notFound() produces in a route
 * handler, measured). The documented public paths never get it: with the gate closed the middleware
 * leaves them alone and the framework answers its own 404. It answers requests to the
 * IMPLEMENTATION paths, which exist only while every process-level condition holds, whenever the
 * per-request gate is closed (from the middleware) or the handler's own checks fail (probe, DB
 * guard). It is a refusal, NOT the framework's 404 body: the owner-accepted residual (owner,
 * 2026-10-15, "S5 A2 waived"), described where the middleware produces it (routing.ts).
 */
export function devLoginNotFound(): Response {
  return new Response(null, { status: 404, headers: { "cache-control": "no-store" } });
}
