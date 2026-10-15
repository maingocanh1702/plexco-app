/**
 * Dev-login environment policy: the PROCESS-LEVEL rules of the local-only sign-in (session S5).
 *
 * Plain ESM JavaScript on purpose. next.config.mjs imports it untranspiled at boot (next dev, next
 * build and next start all evaluate the config first), and the TypeScript gate, middleware router and
 * seed import the very same functions, so every rule below has exactly one definition.
 *
 * Threat model (what this defends against, and what it does not):
 *  - DEFENDS: dev-login code or behaviour reaching any deployed or CI environment; a production build
 *    that carries the dev routes; the flag left on in a shell that then runs `next build`/`next start`.
 *  - PRE-FILTERS ONLY: "the database is on this machine". isLocalDatabaseUrl below checks the host
 *    STRING, which an ssh -L / kubectl port-forward / fly proxy to a shared database, or a bare
 *    `postgres` resolved through a DNS search domain, would also pass. The positive check is
 *    database-side (database-guard.ts: the database owner's `plexco.dev_login = 'on'` opt-in, and
 *    an RLS-enforced role), run by the seed and by every dev-login handler.
 *  - DOES NOT DEFEND: a malicious process on the developer's own machine (it can already read the env
 *    and the database). Per-request concerns (bind evidence, Host, forwarding headers) are gate.ts.
 *
 * Runtime-agnostic: no Node built-ins (the per-request gate runs inside Edge middleware too). The URL
 * constructor is read from globalThis because this file is linted as plain JS with no browser/Node
 * globals declared.
 */

/** The opt-in switch. Only the exact value "1" enables dev-login; mere presence already matters at boot. */
export const DEV_LOGIN_FLAG = "PLEXCO_DEV_LOGIN";

/**
 * Route files named `route.dev.ts` become App Router routes only when this extension is configured.
 * pageExtensionsFor() adds it solely for a development server with the flag on, so `next build`
 * never even compiles the dev-login route modules.
 */
export const DEV_ROUTE_EXTENSION = "dev.ts";

/** Next.js' own default (next/dist/server/config-shared.js). */
const DEFAULT_PAGE_EXTENSIONS = ["tsx", "ts", "jsx", "js"];

/**
 * Hosts a dev-login database URL may name: loopback, plus the compose service name `postgres`
 * (infra/docker-compose.yml) that the brief explicitly allows. Note the residual: outside compose,
 * a bare `postgres` resolves through the machine's normal DNS search path.
 */
const LOCAL_DATABASE_HOSTS = ["localhost", "127.0.0.1", "[::1]", "postgres"];

/**
 * @param {Record<string, string | undefined>} env
 * @returns {boolean} true when the flag is present with ANY value, the empty string included.
 */
export function devLoginFlagPresent(env) {
  return env[DEV_LOGIN_FLAG] !== undefined;
}

/**
 * Boot fail-closed. Called at the top of next.config.mjs, so it runs before next dev / next build /
 * next start do anything else. Refuses when the flag is present at all outside NODE_ENV=development,
 * and refuses Turbopack (the production-compile guard below is a webpack hook).
 *
 * @param {Record<string, string | undefined>} env
 */
export function assertDevLoginBootSafe(env) {
  if (!devLoginFlagPresent(env)) return;
  if (env.NODE_ENV !== "development") {
    throw new Error(
      `[dev-login] ${DEV_LOGIN_FLAG} is set while NODE_ENV is "${env.NODE_ENV ?? ""}" — refusing to start. ` +
        `Dev login exists only under \`next dev\` (NODE_ENV=development); remove ${DEV_LOGIN_FLAG} from ` +
        `this environment (shell, .env files, deploy config) to build or start the app.`,
    );
  }
  if (env.TURBOPACK) {
    throw new Error(
      `[dev-login] ${DEV_LOGIN_FLAG} is set under Turbopack — refusing to start. Dev login supports ` +
        `the webpack dev server only (the production-compile guard is a webpack hook).`,
    );
  }
}

/**
 * Strict "this URL names this machine" pre-filter, shared by the gate and the seed (a host-string
 * check; the database-side opt-in in database-guard.ts is the positive one). Accepts only
 * `postgres://` / `postgresql://` URLs whose host is exactly one of LOCAL_DATABASE_HOSTS, with no
 * query string and no fragment: node-postgres copies every query parameter into the connection
 * config (`?host=` would silently override the URL host), and it resolves a scheme-less string
 * against a dummy base, so anything it could read differently from this check is refused.
 *
 * @param {string | undefined} raw
 * @returns {boolean}
 */
export function isLocalDatabaseUrl(raw) {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 2048) return false;
  // Whitespace, control characters, backslashes and non-ASCII are where URL parsers disagree;
  // local URLs never need them. Printable ASCII only (code points 0x21..0x7e, space excluded).
  for (let index = 0; index < raw.length; index += 1) {
    const code = raw.charCodeAt(index);
    if (code < 0x21 || code > 0x7e || code === 0x5c) return false;
  }
  let url;
  try {
    url = new globalThis.URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") return false;
  if (url.search !== "" || url.hash !== "" || raw.includes("?") || raw.includes("#")) return false;
  if (raw.includes(",")) return false; // multi-host lists
  return LOCAL_DATABASE_HOSTS.includes(url.hostname);
}

/**
 * First failing PROCESS-LEVEL gate condition, or null when all hold. The per-request gate (gate.ts)
 * calls this first, then checks Host and forwarding headers.
 *
 * @param {Record<string, string | undefined>} env
 * @returns {"node_env" | "flag" | "ingress" | "database_url" | null}
 */
export function devLoginEnvironmentVerdict(env) {
  if (env.NODE_ENV !== "development") return "node_env";
  if (env[DEV_LOGIN_FLAG] !== "1") return "flag";
  if (env.TRUSTED_INGRESS_PROVIDER !== "direct") return "ingress";
  if (!isLocalDatabaseUrl(env.DATABASE_URL)) return "database_url";
  return null;
}

/**
 * @param {Record<string, string | undefined>} env
 * @returns {boolean}
 */
export function devLoginRoutesEnabled(env) {
  return devLoginEnvironmentVerdict(env) === null;
}

/**
 * pageExtensions for next.config.mjs: the default set, plus `dev.ts` only when every process-level
 * condition holds. Any process-level condition false => the dev-login route files are not routes at
 * all, so every request to them is the framework's own 404.
 *
 * @param {Record<string, string | undefined>} env
 * @returns {string[]}
 */
export function pageExtensionsFor(env) {
  return devLoginRoutesEnabled(env)
    ? [...DEFAULT_PAGE_EXTENSIONS, DEV_ROUTE_EXTENSION]
    : [...DEFAULT_PAGE_EXTENSIONS];
}

/**
 * Called from the webpack hook in next.config.mjs. `dev` is false for every `next build`
 * compilation whatever NODE_ENV says, so a production compilation that would carry the dev-login
 * routes (or that runs with the flag present, e.g. `NODE_ENV=development next build`) stops here.
 *
 * @param {{ dev: boolean; pageExtensions: readonly string[]; env: Record<string, string | undefined> }} input
 */
export function assertNoDevLoginInProductionCompile({ dev, pageExtensions, env }) {
  if (dev) return;
  if (devLoginFlagPresent(env) || pageExtensions.includes(DEV_ROUTE_EXTENSION)) {
    throw new Error(
      `[dev-login] refusing a production compilation with ${DEV_LOGIN_FLAG} set or the dev-login ` +
        `routes enabled. Dev login exists only under \`next dev\`; unset ${DEV_LOGIN_FLAG} to build.`,
    );
  }
}
