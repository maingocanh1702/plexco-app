import type { DbHandle } from "@plexco/db";

/**
 * DB-SIDE conditions of dev-login, checked by the seed (before any write) and by every dev-login
 * handler (before any cookie or write). They close what a host-string check cannot:
 *
 *  1. Positive per-database opt-in. `isLocalDatabaseUrl` (env-policy.mjs) only proves the URL NAMES
 *     this machine; an `ssh -L` / `kubectl port-forward` / `fly proxy` to a shared database, or a bare
 *     `postgres` resolved through a DNS search domain, would still pass it. So the database itself
 *     must carry the DATABASE-LEVEL setting
 *        ALTER DATABASE <db> SET plexco.dev_login = 'on';
 *     which only a superuser, or a role granted SET ON PARAMETER plexco.dev_login, can write (since
 *     PG 15 a database owner without that grant gets "permission denied to set parameter", measured
 *     on 16.15). It is read from the catalog (pg_db_role_setting, setrole = 0, setdatabase = this
 *     database), never with current_setting(): the session value can be forged by any client
 *     (PGOPTIONS='-c plexco.dev_login=on', measured by review round 2) and a role-level
 *     `ALTER ROLE … SET` belongs to the role, not to the database. Read per request, so a RESET
 *     takes effect on the next request (warm pooled connections do not matter). Configuration, not
 *     schema: no migration, no table.
 *  2. An RLS-enforced role. A superuser or BYPASSRLS role would make every dev-persona request
 *     bypass RLS while dev-login promises RLS parity with real sign-in. Checked for BOTH
 *     current_user and session_user (a superuser login plus `-c role=app` changes only
 *     current_user), the same pair assertRuntimeDbRole (session-cookies.ts) compares.
 */
export type DevLoginDatabaseVerdict =
  | { ok: true; database: string }
  | { ok: false; reason: "database_not_opted_in" | "role_bypasses_rls"; database: string };

export const DEV_LOGIN_DB_SETTING = "plexco.dev_login";

/** Who can run the opt-in command (see 1. above); quoted by the seed and handler refusals. */
export const DEV_LOGIN_OPT_IN_RUN_AS = `a superuser (or a role granted SET ON PARAMETER ${DEV_LOGIN_DB_SETTING})`;

export function devLoginOptInCommand(database: string): string {
  return `ALTER DATABASE ${database} SET ${DEV_LOGIN_DB_SETTING} = 'on'`;
}

export async function devLoginDatabaseVerdict(
  pool: Pick<DbHandle["pool"], "query">,
): Promise<DevLoginDatabaseVerdict> {
  const { rows } = await pool.query(
    `SELECT current_database() AS database,
            EXISTS (
              SELECT 1
                FROM pg_catalog.pg_db_role_setting s
                JOIN pg_catalog.pg_database d ON d.oid = s.setdatabase
               WHERE s.setrole = 0
                 AND d.datname = current_database()
                 AND $1 = ANY (s.setconfig)
            ) AS opt_in,
            (SELECT r.rolsuper OR r.rolbypassrls
               FROM pg_catalog.pg_roles r WHERE r.rolname = current_user) AS current_bypasses,
            (SELECT r.rolsuper OR r.rolbypassrls
               FROM pg_catalog.pg_roles r WHERE r.rolname = session_user) AS session_bypasses`,
    [`${DEV_LOGIN_DB_SETTING}=on`],
  );
  const row = rows[0] as
    | {
        database: string;
        opt_in: boolean;
        current_bypasses: boolean | null;
        session_bypasses: boolean | null;
      }
    | undefined;
  if (!row) return { ok: false, reason: "role_bypasses_rls", database: "?" };
  // A role that cannot be found counts as bypassing (fail closed).
  if (row.current_bypasses !== false || row.session_bypasses !== false) {
    return { ok: false, reason: "role_bypasses_rls", database: row.database };
  }
  if (row.opt_in !== true) {
    return { ok: false, reason: "database_not_opted_in", database: row.database };
  }
  return { ok: true, database: row.database };
}
