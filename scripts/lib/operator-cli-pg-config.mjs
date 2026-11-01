import { createRequire } from "node:module";

/**
 * The one pg connection config of the owner CLIs under scripts/ (lane L90): the shared helper
 * packages/db/src/pg-ssl-options.ts, always evaluated as a production build, so the caller's
 * NODE_ENV (unset on the owner's machine) never turns the rule off. A host that is not loopback or
 * a Unix socket then needs DATABASE_CA_CERT, and with it a URL that weakens TLS is refused.
 *
 * The helper is TypeScript and the CLIs run under plain node, so tsx (a devDependency of
 * @plexco/db, resolved from that package) loads it on the first call; the promise is cached. No
 * fallback: a load failure or a PgSslConfigError rejects, and the CLI's own catch prints its one
 * error line and exits 1. No top-level await: the enable CLI is imported in-process by tests.
 */
let helper;

export async function operatorCliPgConfig(connectionString, env = process.env) {
  helper ??= createRequire(new URL("../../packages/db/package.json", import.meta.url))(
    "tsx/esm/api",
  ).tsImport(new URL("../../packages/db/src/pg-ssl-options.ts", import.meta.url).href, {
    parentURL: import.meta.url,
    tsconfig: false,
  });
  const { pgSslConnectionConfig } = await helper;
  return pgSslConnectionConfig(connectionString, { ...env, NODE_ENV: "production" });
}
