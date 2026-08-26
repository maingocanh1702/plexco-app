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
 * Recognised action classes are the "mutating" ones billing §3's Concurrency
 * clause names (publish_new_sessions, admin_mutation, integration_changes) plus
 * the DD-110 session commands that, like publish, are ❌ under suspension
 * (active/past_due ✅, suspended ❌): announce_session (with announceSession) and
 * update_open_session (with updateSession — UpdateSession on an `open` session).
 * Each lands its narrow per-op class in the commit that lands its command (DD-110
 * D3) and routes through the EXISTING fail-closed resolution below unchanged — no
 * special-casing. update_open_session is chosen at the call site ONLY when the
 * session is `open`; updateSession on a `draft` is exempt (DD-105) and does NOT
 * call this resolver at all — enforced by a service-layer negative test (DD-110
 * D4). The always-allow product-matrix classes (player CK ingest, read-only
 * queries, system safety) never consult tenant/subscription status at all (edge
 * #9: "Allow — safety path") and so structurally never route through this resolver.
 *
 * DD-110 also mints the obligation-termination classes. B1 lands close_session ONLY; cancel_session
 * joins with B2 (DD-110 D3). DD-110 D2's Suspended Action Matrix marks close/cancel ✅ for
 * active/past_due/`suspended` — a suspended tenant may still TERMINATE a running obligation (suspension
 * freezes NEW commercial activity, not the winding-down of existing ones). They do NOT bypass this
 * resolution: they run the SAME fail-closed two-step below.
 *
 * OWNER-RATIFIED READING (2026-08-26): the guard compares the LITERAL status value — it does NOT
 * compute or infer an "effective status" bucket, and any status literal it does not recognise is
 * fail-closed. So it ADDS the LITERAL `suspended` to the allow-set on BOTH axes, accepting (per
 * DD-110 D2) a tenant-root abuse/ToS suspension too ("một tenant abuse huỷ được buổi của chính nó —
 * phiền, không phải thiệt hại"). It does NOT tolerate the billing §3 `effective_status='suspended'`
 * BUCKET that collapses `cancelled`/missing/anomalous into `'suspended'` — applying ✅-suspended to
 * that bucket would fail-OPEN close/cancel on terminal/anomalous tenants. Every OTHER deny is
 * unchanged: a `cancelled`/missing/anomalous TENANT or SUBSCRIPTION still fails closed. The two-axis
 * limitation inherited from DD-110 (subscriptions.status = unpaid vs tenants.status = abuse/ToS
 * collapsing into one row, still indistinguishable) is UNCHANGED and stays a NAMED limitation. Their
 * money safety is separate from this resolver — the finance-root fail-closed refuse
 * (CANCEL_REQUIRES_REVIEW, DD-117 / edge #5) lives in the CloseSession service command, keyed on the
 * session's own `charges`, not status.
 */
export type ActionClass =
  | "publish_new_sessions"
  | "admin_mutation"
  | "integration_changes"
  | "announce_session"
  | "update_open_session"
  | "close_session";

const RECOGNIZED_ACTION_CLASSES: ReadonlySet<ActionClass> = new Set([
  "publish_new_sessions",
  "admin_mutation",
  "integration_changes",
  "announce_session",
  "update_open_session",
  "close_session",
]);

// DD-110 D2 obligation-termination classes. B1 lands close_session ONLY; cancel_session joins this set
// with B2 (DD-110 D3: a literal enters the enum with the command that uses it). They do NOT bypass the
// fail-closed resolution. OWNER-RATIFIED READING (2026-08-26): the guard compares the LITERAL status
// value; it does NOT compute or infer an "effective status" bucket; any status literal it does not
// recognise is fail-closed. So obligation-termination ADDITIONALLY tolerates a LITERAL `suspended` on
// BOTH axes (step 1 tenant AND step 2 subscription) — DD-110 D2 accepts this INCLUDING a tenant-root
// abuse/ToS suspension. The two-axis limitation inherited from DD-110 (subscriptions.status = unpaid
// vs tenants.status = abuse/ToS collapsing into one row, still indistinguishable) is UNCHANGED and
// stays a NAMED limitation — this reading does not silently close it. Every other deny is unchanged:
// a `cancelled`/missing/anomalous tenant OR subscription still fails closed.
const OBLIGATION_TERMINATION: ReadonlySet<ActionClass> = new Set(["close_session"]);

export type EffectiveStatus = "trialing" | "active" | "past_due";

export type AuthorizationDecision =
  | { allowed: true; effectiveStatus: EffectiveStatus }
  // Obligation-termination (close_session; cancel_session with B2) allowed when a LITERAL `suspended`
  // is on EITHER axis (tenant OR subscription, DD-110 D2) — there is no valid EffectiveStatus for
  // `suspended`, so a distinct allowed variant instead of a fake status. Callers gate on
  // `decision.allowed`; both allowed shapes pass.
  | { allowed: true; obligationTermination: true }
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
 * The `tenants` read below goes through `resolve_tenant_status_locked`
 * (0027, AP-43) — a narrow SECURITY DEFINER function, not a grant on the
 * table itself. `app` holds no direct privilege on `tenants` at all (unlike
 * the analogous platform-tier `plans`/`sports` tables, which get SELECT —
 * only `subscriptions` is covered by the tenant_tables RLS+grant loop in
 * 0009). A plain `GRANT SELECT` would not have been enough: PostgreSQL
 * requires UPDATE privilege (not just SELECT) to run any row-locking clause
 * — FOR SHARE included, not only FOR UPDATE — because the lock can block
 * other writers regardless of lock strength. Granting `app` raw UPDATE on
 * `tenants` would instead have been a real regression, not just an overly
 * broad grant: it would open the write path to `tenants.status` that must
 * stay closed until a trust-safety mechanism owning set+clear together
 * exists (AP-40's negative scope, still true today). The function runs the
 * identical locking read this resolver always performed and returns only
 * the `status` column — see
 * `packages/db/migrations/0027_resolve_tenant_status_locked.sql`.
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

  const isObligationTermination = OBLIGATION_TERMINATION.has(actionClass);

  const tenantResult = await tx.execute(
    sql`SELECT status FROM resolve_tenant_status_locked(${tenantId})`,
  );
  const tenantRows = tenantResult.rows as { status: string }[];
  const tenantStatus = tenantRows[0]?.status;

  // Step 1 (tenant axis, abuse/ToS). Allowlist, fail-closed on the whole column — a missing row or any
  // value other than active/trialing denies (case 1/1b). For OBLIGATION_TERMINATION (close/cancel),
  // `suspended` is ADDITIONALLY allowed, on THIS axis too: DD-110 D2 accepts that a suspended tenant —
  // INCLUDING a tenant-root abuse/ToS suspension — may still terminate its own running obligation
  // ("một tenant abuse huỷ được buổi của chính nó — phiền, không phải thiệt hại", decisions.md
  // DD-110 D2). The decision's own note says the gate CANNOT distinguish a non-payment suspension from
  // an abuse one and that building that distinction is explicitly out of scope for this slice — so
  // a LITERAL `suspended` is allowed without asking which axis it came from (owner-ratified reading
  // 2026-08-26: the guard compares the literal value, does NOT compute an effective_status bucket).
  // Still fail-closed on `cancelled`/missing/anomalous — the billing §3 effective_status collapse that
  // buckets those into `'suspended'` is NOT used here (it would fail-OPEN close/cancel on terminal
  // states). The two-axis unpaid-vs-abuse limitation is unchanged and stays a named DD-110 limitation.
  const tenantAllowed =
    tenantStatus === "active" ||
    tenantStatus === "trialing" ||
    (isObligationTermination && tenantStatus === "suspended");
  if (!tenantAllowed) {
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

  // Step 2 (subscription axis, billing) is an ALLOWLIST, not a denylist: only the explicitly-allowed
  // values pass and every OTHER value (a missing row, `cancelled`, or anything unrecognised) fails
  // closed — the owner-ratified reading that any status literal the guard does not recognise is
  // fail-closed. For OBLIGATION_TERMINATION, the LITERAL `suspended` joins the allow-set here too
  // (DD-110 D2, same rationale as step 1) — but NOT the effective_status bucket.
  const subSuspendedOt = isObligationTermination && subStatus === "suspended";
  if (
    subStatus !== "trialing" &&
    subStatus !== "active" &&
    subStatus !== "past_due" &&
    !subSuspendedOt
  ) {
    return DENY;
  }

  // Allowed. When suspension is involved on EITHER axis there is no valid EffectiveStatus, so return
  // the distinct obligation-termination shape (only reachable for close/cancel — a non-OT class with a
  // suspended axis already denied above). Otherwise both axes are in their normal allowed sets and
  // subStatus is a real EffectiveStatus. Callers gate on `decision.allowed` either way.
  if (tenantStatus === "suspended" || subStatus === "suspended") {
    return { allowed: true, obligationTermination: true };
  }
  if (subStatus === "trialing" || subStatus === "active" || subStatus === "past_due") {
    return { allowed: true, effectiveStatus: subStatus };
  }
  return DENY; // defensive fail-closed — unreachable given the step-2 guard above
}
