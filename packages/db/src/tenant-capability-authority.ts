import { sql } from "drizzle-orm";
import type { Tx } from "./client.js";
import { assertTenantId } from "./tenant.js";

/**
 * DD-56 capability authorization (BE tech spec feature_tenant_routing_authz_tech.md §4). A thin,
 * typed wrapper over the locked SECURITY DEFINER `tenant_capability_authorize` (0049) -- the
 * decision table lives THERE, once; this file never re-derives a role check.
 *
 * Contract:
 *  - `tx` must be an already-open `withTenant` transaction. The definer's FOR SHARE locks on the
 *    actor's tenant_admins row (and grant row) live until the CALLER's commit, which is the
 *    actor-recheck-under-lock property; this function never opens a transaction.
 *  - Domain denials (unknown action, wrong tenant, not a member, no grant, ...) come back as
 *    `{ allowed: false, reason }`. Anything else -- a query failure, a missing function, a
 *    malformed row -- is RETHROWN: an infrastructure error can never collapse into allow, and the
 *    route's catch-all turns it into a 5xx rather than a fake 403.
 *  - Unlike authorizeTenantAction (tenant status axis) this answers only "may THIS PERSON do THIS
 *    ACTION in THIS tenant"; the two gates are orthogonal and both apply to a mutation.
 */
export type AuthorizeRole = "owner" | "admin" | "co_admin";

export type AuthorizeDecision =
  { allowed: true; role: AuthorizeRole } | { allowed: false; reason: string };

export interface AuthorizeParams {
  tenantId: string;
  action: string;
  actorPersonId: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROLES: ReadonlySet<string> = new Set<AuthorizeRole>(["owner", "admin", "co_admin"]);

export async function authorize(tx: Tx, params: AuthorizeParams): Promise<AuthorizeDecision> {
  assertTenantId(params.tenantId);
  if (typeof params.actorPersonId !== "string" || !UUID_RE.test(params.actorPersonId)) {
    return { allowed: false, reason: "not_a_member" };
  }
  if (typeof params.action !== "string") {
    return { allowed: false, reason: "unknown_action" };
  }
  // The definer binds p_tenant_id to app.tenant_id itself (denies `tenant_context`); passing the
  // caller's value rather than reading the GUC here keeps that check meaningful.
  const result = await tx.execute(
    sql`SELECT allowed, role, reason
          FROM tenant_capability_authorize(${params.tenantId}::uuid, ${params.action}, ${params.actorPersonId}::uuid)`,
  );
  const rows = result.rows as { allowed: unknown; role: unknown; reason: unknown }[];
  const row = rows.length === 1 ? rows[0] : undefined;
  if (!row || typeof row.allowed !== "boolean") {
    throw new Error("authorize: tenant_capability_authorize returned a malformed result");
  }
  if (!row.allowed) {
    return { allowed: false, reason: typeof row.reason === "string" ? row.reason : "denied" };
  }
  if (typeof row.role !== "string" || !ROLES.has(row.role)) {
    // Allowed without a recognised role is a contract violation, never an allow.
    throw new Error("authorize: tenant_capability_authorize allowed without a recognised role");
  }
  return { allowed: true, role: row.role as AuthorizeRole };
}
