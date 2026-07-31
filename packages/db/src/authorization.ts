import { sql } from "drizzle-orm";
import { assertTenantId } from "./tenant.js";
import type { Db } from "./client.js";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * Tenant-action authorization choke-point (feature_billing_lifecycle_tech.md
 * §3 Status Authority, founder-ratified 2026-07-24).
 *
 * Every caller passes a tenantId, never a pre-resolved status — this function
 * owns reading BOTH tenants.status and subscriptions.status and resolving the
 * fail-closed union itself (§1: "adapters cannot implement inconsistent
 * suspension rules").
 *
 * Recognised action classes are exactly the "mutating" ones billing §3's
 * Concurrency clause names (publish_new_sessions, admin_mutation,
 * integration_changes). The always-allow classes from the product-level
 * Suspended Action Matrix (player CK ingest, read-only queries, system
 * safety) never consult tenant/subscription status at all (edge #9: "Allow —
 * safety path") and so structurally never route through this resolver;
 * recognising them here is a future slice's decision once a real caller
 * exists, not this root dependency's.
 */
export type ActionClass = "publish_new_sessions" | "admin_mutation" | "integration_changes";

const RECOGNIZED_ACTION_CLASSES: ReadonlySet<ActionClass> = new Set([
  "publish_new_sessions",
  "admin_mutation",
  "integration_changes",
]);

export type EffectiveStatus = "trialing" | "active" | "past_due";

export type AuthorizationDecision =
  | { allowed: true; effectiveStatus: EffectiveStatus }
  | { allowed: false; code: "TENANT_SUSPENDED" };

const DENY: AuthorizationDecision = { allowed: false, code: "TENANT_SUSPENDED" };

/**
 * Fail-closed 2-step resolution — step 1 (tenants.status) is always evaluated
 * before step 2 (subscriptions.status) and wins unconditionally when it
 * locks. Both reads use a locking `SELECT ... FOR SHARE`, in the same table
 * order as the steps themselves (billing §3's own case-1-before-case-2
 * evaluation order), so a mutating caller's re-check under lock actually
 * serializes against the Daily Lifecycle Job's `FOR UPDATE SKIP LOCKED`
 * suspend-transition (billing §3 Concurrency) — a plain re-SELECT in the same
 * transaction does not, because holding a lock on one table does not
 * serialize against a writer on a different one under READ COMMITTED.
 *
 * `tx` must be an ALREADY-OPEN transaction — e.g. `db.transaction(async (tx)
 * => authorizeTenantAction(tx, tenantId, actionClass))`, or the same `tx` a
 * caller already holds for its own mutation (mirrors tenant.ts's
 * withTenant/tenantRepo, which likewise operate on a passed-in `tx`). This
 * function never opens or commits a transaction itself: an earlier draft did
 * (codex round-01 [P1] on this slice), which meant its FOR SHARE locks were
 * released the instant it returned — before any caller could act on the
 * decision inside the SAME transaction as its mutation, reopening exactly
 * the TOCTOU race billing §3 Concurrency exists to close. Requiring the
 * caller's own `tx` means the locks acquired here persist for the rest of
 * THAT transaction, so `const decision = await authorizeTenantAction(tx,
 * ...); if (decision.allowed) { ...mutate using tx... }` is safe — nothing
 * can suspend the tenant between the decision and the caller's own commit.
 *
 * Every deny path — missing tenant, missing subscription row, any blocking
 * status value, an unrecognised actionClass — returns the identical
 * cause-agnostic {allowed:false, code:"TENANT_SUSPENDED"} shape, so a denial
 * never reveals which axis blocked or whether the tenant even exists.
 *
 * No internal try/catch: a query failure (bad connection, RLS/grant denial,
 * etc.) propagates as a rejected promise and can never collapse into allow.
 *
 * NOTE for the slice that first wires a real caller: the `app` role
 * currently has no grant on `tenants` at all (unlike the analogous
 * platform-tier `plans`/`sports` tables, which get SELECT — only
 * subscriptions is covered by the tenant_tables RLS+grant loop in 0009).
 * A plain `GRANT SELECT` would NOT be enough to fix this: PostgreSQL
 * requires UPDATE privilege (not just SELECT) to run any row-locking clause
 * — FOR SHARE included, not only FOR UPDATE — because the lock can block
 * other writers regardless of lock strength. But `app` granted raw UPDATE
 * on `tenants` would ALSO be a real regression, not just an overly broad
 * grant: it would open exactly the write path to `tenants.status` this
 * slice's negative scope says must not exist yet (the trust-safety
 * mechanism that owns set+clear together). The fix that avoids both
 * problems is a narrow SECURITY DEFINER function in the style already used
 * for every other `app`-restricted privileged read in this codebase
 * (tenant_provision, auth_login_telegram, etc., 0012) — grant EXECUTE on a
 * function that runs the locking read, not GRANT SELECT/UPDATE on the table
 * itself. That is a migration, out of this slice's negative scope (both
 * columns already exist; no new .sql file here). This resolver is written
 * and tested to be correct once that access path lands; until then, calling
 * it with an `app`-role tx will fail with a Postgres permission error at
 * the tenants read, not a wrong authorization decision.
 */
export async function authorizeTenantAction(
  tx: Tx,
  tenantId: string,
  actionClass: ActionClass,
): Promise<AuthorizationDecision> {
  assertTenantId(tenantId);

  if (!RECOGNIZED_ACTION_CLASSES.has(actionClass)) {
    return DENY;
  }

  const tenantResult = await tx.execute(
    sql`SELECT status FROM tenants WHERE id = ${tenantId} FOR SHARE`,
  );
  const tenantRows = tenantResult.rows as { status: string }[];
  const tenantStatus = tenantRows[0]?.status;

  // case 1 / 1b: missing row, or any value other than active/trialing —
  // fail-closed on the whole column, not just the literal 'suspended'.
  if (tenantStatus !== "active" && tenantStatus !== "trialing") {
    return DENY;
  }

  // Tenant axis clear — step 2 needs the RLS GUC, since subscriptions is
  // tenant-scoped (FORCE RLS, 0009) unlike tenants itself.
  await tx.execute(sql`SELECT set_config('app.tenant_id', ${tenantId}, true)`);
  const subResult = await tx.execute(
    sql`SELECT status FROM subscriptions WHERE tenant_id = ${tenantId} FOR SHARE`,
  );
  const subRows = subResult.rows as { status: string }[];
  const subStatus = subRows[0]?.status;

  // case 3: allowlist, not a denylist (codex round-02 [P1] on this slice —
  // an earlier draft denied only 'suspended'/'cancelled'/missing and
  // allowed every OTHER value, which fails OPEN on anything unrecognised:
  // schema drift, a widened CHECK, or a value this resolver simply doesn't
  // know about yet. Mirrors step 1's own allowlist above, and the same class
  // of bug billing §3's own round-03 history already fixed once for the
  // tenant axis — reintroducing it on the subscription axis was the exact
  // mistake that round closed). Missing row (case 4, provisioning anomaly)
  // and everything outside the three explicitly-allowed values — including
  // 'suspended'/'cancelled' (case 2/2b) and anything not even in the CHECK
  // constraint — fail closed here.
  if (subStatus === "trialing" || subStatus === "active" || subStatus === "past_due") {
    return { allowed: true, effectiveStatus: subStatus };
  }
  return DENY;
}
