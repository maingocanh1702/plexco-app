import type { DbHandle } from "@plexco/db";

/**
 * DB-SIDE conditions of dev-login, checked by the seed (before any write) and by every dev-login
 * handler (before any cookie or write). They close what a host-string check cannot:
 *
 *  1. Positive per-database opt-in. `isLocalDatabaseUrl` (env-policy.mjs) only proves the URL NAMES
 *     this machine; an `ssh -L` / `kubectl port-forward` / `fly proxy` to a shared database, or a bare
 *     `postgres` resolved through a DNS search domain, would still pass it. So the database itself
 *     must carry `plexco.dev_login = 'on'`, a per-database default that only the database owner or a
 *     superuser can set:   ALTER DATABASE <db> SET plexco.dev_login = 'on';
 *     It is configuration, not schema (no migration, no table). The `app` role cannot set it, and no
 *     shared or deployed database has it. A new value reaches only NEW connections: restart the dev
 *     server after setting it.
 *  2. An RLS-enforced role. A superuser or BYPASSRLS role would make every dev-persona request
 *     bypass RLS while dev-login promises RLS parity with real sign-in, so both are refused.
 */
export type DevLoginDatabaseVerdict =
  | { ok: true; database: string }
  | { ok: false; reason: "database_not_opted_in" | "role_bypasses_rls"; database: string };

export const DEV_LOGIN_DB_SETTING = "plexco.dev_login";

export function devLoginOptInCommand(database: string): string {
  return `ALTER DATABASE ${database} SET ${DEV_LOGIN_DB_SETTING} = 'on'`;
}

export async function devLoginDatabaseVerdict(
  pool: Pick<DbHandle["pool"], "query">,
): Promise<DevLoginDatabaseVerdict> {
  const { rows } = await pool.query(
    `SELECT current_database() AS database,
            current_setting('${DEV_LOGIN_DB_SETTING}', true) AS opt_in,
            r.rolsuper AS superuser,
            r.rolbypassrls AS bypassrls
       FROM pg_catalog.pg_roles r
      WHERE r.rolname = current_user`,
  );
  const row = rows[0] as
    { database: string; opt_in: string | null; superuser: boolean; bypassrls: boolean } | undefined;
  if (!row) return { ok: false, reason: "role_bypasses_rls", database: "?" };
  if (row.superuser !== false || row.bypassrls !== false) {
    return { ok: false, reason: "role_bypasses_rls", database: row.database };
  }
  if (row.opt_in !== "on") {
    return { ok: false, reason: "database_not_opted_in", database: row.database };
  }
  return { ok: true, database: row.database };
}
