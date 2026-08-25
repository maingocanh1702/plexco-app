import { sql } from "drizzle-orm";
import { assertTenantId } from "./tenant.js";
import type { Db } from "./client.js";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * Commercial-entitlement resolver — the first READER IMPLEMENTATION of the DD-29
 * capability registry (feature_billing_lifecycle_tech.md §4b `hasCapability`,
 * DD-29/DD-40). It answers ONE question: does this tenant's current plan grant
 * `capability`? It reads `plans.entitlements.capabilities[capability]` for the
 * plan the tenant's `subscriptions` row points at, and returns a fail-closed,
 * cause-agnostic decision. The `entitlements`/`capabilities` jsonb has had 0
 * PRODUCTION readers since 2026-08-07 (the only readers are tests —
 * migrate.test.ts asserts the DD-29 seed, and capability.test.ts exercises this
 * resolver); this adds the production resolver, but it stays CODE-DARK — no
 * production caller (index.ts only re-exports it) — until a separately-
 * authorized enforcement point calls it. The
 * first such point (a gate on `payment_reconcile_auto`, DD-114 D2) needs the
 * reconcile pipeline, which does not exist in code yet, so wiring is a
 * follow-up; this slice ships the reader as a code-dark root dependency.
 *
 * TWO axes, kept separate on purpose (single responsibility / choke-point):
 *   - STATUS (is the tenant/subscription active vs suspended/cancelled) is
 *     `authorizeTenantAction`'s axis (authorization.ts, DD-110 `billing-authz`).
 *   - ENTITLEMENT (does the plan include this capability) is THIS resolver's
 *     axis. It never reads tenant/subscription STATUS and never touches
 *     authorization.ts. A host_pro tenant that is suspended is still ENTITLED to
 *     `payment_reconcile_auto` here — being suspended is what stops it from
 *     ACTING, and that block is `authorizeTenantAction`'s job. A money action
 *     therefore composes BOTH inside one tx, e.g.:
 *       const authz = await authorizeTenantAction(tx, tenantId, actionClass);
 *       if (!authz.allowed) return authz;                       // status axis
 *       const ent = await resolveCapability(tx, tenantId, "payment_reconcile_auto");
 *       if (!ent.allowed) return ent;                           // entitlement axis
 *       // ...then, only for capabilities gated on real availability
 *       // (payment_reconcile_auto — §4b), a SEPARATE availability resolver
 *       // (provider × bank × market × currency × consent). That resolver is
 *       // NOT this function and is out of scope here (§4b: entitlement is not
 *       // availability; entitlement=true must NOT be rendered as "usable").
 *
 * `tx` must be an ALREADY-OPEN transaction (mirrors authorizeTenantAction and
 * tenant.ts's withTenant/tenantRepo): pass the same `tx` the caller holds for
 * its own read/mutation, e.g. `db.transaction((tx) => resolveCapability(tx,
 * tenantId, cap))`. This function never opens or commits a transaction itself,
 * and does no caching across transactions — every call reads fresh from the DB.
 *
 * Fail-closed on EVERY degenerate input — missing subscription row, a plan row
 * the subscription's (plan_key, plan_version) does not resolve to, a missing/
 * non-object `capabilities` map, a capability that is `false` / absent /
 * non-boolean, or an unrecognised capability name — all return the identical
 * cause-agnostic `{allowed:false, code:"PLAN_UPGRADE_REQUIRED"}` shape (billing
 * §4b invariant (b): missing entitlement → `PLAN_UPGRADE_REQUIRED`, no data
 * loss). A denial never reveals WHICH axis blocked or whether the tenant even
 * exists. `code` is resolved here at the choke-point, not re-derived per caller.
 *
 * A genuine ERROR is NOT a deny, and the deny-vs-throw boundary is deliberate:
 *   - DATA-STATE degenerate inputs — no subscription row, no matching plan
 *     catalog row, or valid jsonb whose `capabilities` content simply does not
 *     grant the flag — fail-closed to `PLAN_UPGRADE_REQUIRED` (the DD-29 spec's
 *     "missing subscription / missing plan / malformed jsonb / unknown
 *     capability => denied").
 *   - A genuine ERROR is thrown, never masked as a free-tier deny: there is no
 *     internal try/catch, so a query-execution failure (bad connection, RLS/
 *     grant denial) propagates as a rejected promise; and a STRUCTURALLY
 *     malformed result row — a NOT-NULL column this function explicitly SELECTed
 *     (subscriptions.plan_key/plan_version, plans.entitlements) absent from the
 *     returned row, i.e. a driver/contract regression, NOT a data state — is
 *     thrown too (codex round-05 [P2]). Neither can ever collapse into allow OR
 *     a false `PLAN_UPGRADE_REQUIRED` that would look like an ordinary free tier.
 */
export type Capability =
  | "web_app"
  | "bot_zalo"
  | "bot_messenger"
  | "session_management"
  | "discovery_marketplace"
  | "payment_mark_manual"
  | "payment_reconcile_auto"
  | "reminders_manual"
  | "reminders_auto"
  | "assistant_ai_kb"
  | "crm_dashboard";

/**
 * The closed capability vocabulary — transcribed VERBATIM from the free/host_pro
 * seed in 0028_dd29_capability_registry_expand.sql (itself transcribed from
 * feature_billing_lifecycle_tech.md:68-81), not re-derived. It is closed on
 * purpose: an unknown key fails closed here rather than being resolved from
 * whatever the jsonb happens to carry, so catalog drift (an unexpected extra key
 * in a plan's entitlements) can never grant a capability the code does not know.
 *
 * This does NOT break §4b's "config-driven" rule ("changing which feature is
 * free vs pro = edit the seed, not code"): flipping a KNOWN capability's
 * true/false in the seed needs no code change — the resolver reads the flag.
 * Only ADDING a NEW capability name needs both a migration AND this union (a new
 * capability is a new gate with new call sites — legitimately a code change).
 */
const RECOGNIZED_CAPABILITIES: ReadonlySet<Capability> = new Set([
  "web_app",
  "bot_zalo",
  "bot_messenger",
  "session_management",
  "discovery_marketplace",
  "payment_mark_manual",
  "payment_reconcile_auto",
  "reminders_manual",
  "reminders_auto",
  "assistant_ai_kb",
  "crm_dashboard",
]);

export type CapabilityDecision =
  { allowed: true } | { allowed: false; code: "PLAN_UPGRADE_REQUIRED" };

const DENY: CapabilityDecision = { allowed: false, code: "PLAN_UPGRADE_REQUIRED" };

/**
 * A plain data object — non-null, non-array, and with Object.prototype or a null
 * prototype. The prototype check rejects an object carrying a CUSTOM prototype
 * (codex round-03 [P1]): a bracket lookup traverses the prototype chain, so an
 * inherited `capabilities`/capability flag off a custom or polluted prototype
 * could otherwise fail OPEN on this authz gate. Legitimate jsonb the pg driver
 * parsed always has Object.prototype, so this rejects only maliciously/
 * accidentally non-plain shapes — fail-closed, no false negatives on real data.
 */
function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Extract `entitlements.capabilities` as a plain object, or `{}` for any shape
 * that is not one. `entitlements` is a jsonb column the pg driver has already
 * parsed to a JS value, so "malformed jsonb" surfaces here as an unexpected
 * SHAPE (a non-object `capabilities`, a missing key, a null) rather than a parse
 * error — every such shape collapses to `{}`, so the caller's strict own-key
 * `=== true` check below fails closed with no special-casing. `capabilities`
 * must be an OWN key (codex round-03 [P1]) so a `__proto__`-shaped jsonb key,
 * or an inherited one, cannot smuggle a map in.
 */
function extractCapabilities(entitlements: unknown): Record<string, unknown> {
  if (!isPlainRecord(entitlements)) return {};
  if (!Object.hasOwn(entitlements, "capabilities")) return {};
  const capabilities = entitlements["capabilities"];
  return isPlainRecord(capabilities) ? capabilities : {};
}

export async function resolveCapability(
  tx: Tx,
  tenantId: string,
  capability: Capability,
): Promise<CapabilityDecision> {
  assertTenantId(tenantId);

  // Unknown capability name → deny. Defense-in-depth beyond the compile-time
  // `Capability` union, for JS callers / `as any` (mirrors authorization.ts's
  // RECOGNIZED_ACTION_CLASSES gate).
  if (!RECOGNIZED_CAPABILITIES.has(capability)) {
    return DENY;
  }

  // subscriptions is tenant-scoped (ENABLE + FORCE ROW LEVEL SECURITY, 0009),
  // keyed on the app.tenant_id GUC (fail-closed: missing GUC → NULL → matches
  // nothing). Set it here so the resolver is self-sufficient when called
  // standalone; idempotent when a caller already ran authorizeTenantAction in
  // this same tx (it set the identical value).
  //
  // FOR SHARE pins the (plan_key, plan_version) binding for the rest of the
  // caller's transaction. `app` can execute it: it holds full CRUD on
  // subscriptions (0009), and PostgreSQL only requires UPDATE privilege for a
  // row-locking clause (the 0027 lesson — the very reason plans below CANNOT be
  // locked). Without it, a concurrent host_pro→free downgrade committing between
  // this read and the plans read below would leave the resolver reading the
  // stale (immutable) host_pro row and wrongly returning allowed:true (codex
  // round-01 [P1]). The lock makes the resolver correct on its OWN — standalone,
  // not only when composed after authorizeTenantAction — and, like
  // authorizeTenantAction's own FOR SHARE, it survives past this function's
  // return into the caller's transaction, so an `if (allowed) { ...mutate... }`
  // money action stays protected against a downgrade landing between the
  // decision and the mutation.
  await tx.execute(sql`SELECT set_config('app.tenant_id', ${tenantId}, true)`);
  const subResult = await tx.execute(
    sql`SELECT plan_key, plan_version FROM subscriptions WHERE tenant_id = ${tenantId} FOR SHARE`,
  );
  const subRows = subResult.rows as Record<string, unknown>[];
  const subscription = subRows[0];
  if (!subscription) {
    return DENY; // no subscription row — a legitimate degenerate state (spec: "missing subscription row => denied")
  }
  const planKey = subscription["plan_key"];
  const planVersion = subscription["plan_version"];
  // A returned row missing a NOT-NULL column this query explicitly SELECTed is a
  // driver/contract anomaly, not a data state — throw, never mask it as a
  // free-tier deny (codex round-05 [P2]; the error-propagation boundary above).
  if (typeof planKey !== "string" || typeof planVersion !== "number") {
    throw new Error(
      "resolveCapability: malformed subscriptions row (plan_key/plan_version missing or wrong type)",
    );
  }

  // plans is a global, un-versioned-in-place catalog (business-rules #19: a plan
  // version is immutable; a price/entitlement change creates a NEW version). It
  // carries no RLS (shared catalog, not tenant-scoped), and `app` holds SELECT
  // only (0009) — a `FOR SHARE` here would FAIL (PostgreSQL requires UPDATE
  // privilege for any row-locking clause, the 0027 lesson). A plain read is
  // therefore both necessary AND sufficient: the subscription FOR SHARE above
  // already pins which (plan_key, plan_version) this reads, and that catalog row
  // is immutable, so nothing about the resolved entitlement can change under the
  // caller's transaction.
  const planResult = await tx.execute(
    sql`SELECT entitlements FROM plans
        WHERE plan_key = ${planKey} AND version = ${planVersion}`,
  );
  const planRows = planResult.rows as Record<string, unknown>[];
  const plan = planRows[0];
  if (!plan) {
    return DENY; // subscription points at a plan (key, version) with no catalog row (spec: "missing plan => denied")
  }
  // entitlements is NOT NULL in the schema, so the COLUMN being absent from the
  // returned row (as opposed to a jsonb null/string/array VALUE, which is
  // legitimate content that denies below) is a driver/contract anomaly — throw
  // rather than mask it as a free-tier deny (codex round-05 [P2]).
  if (!Object.hasOwn(plan, "entitlements")) {
    throw new Error("resolveCapability: malformed plans row (entitlements column missing)");
  }

  const capabilities = extractCapabilities(plan["entitlements"]);
  // OWN key + strict boolean `true` only. Object.hasOwn (not a bare bracket
  // read) closes the inherited-property / prototype-pollution fail-open on this
  // authz gate (codex round-03 [P1]); `=== true` then rejects `false`, absent,
  // `"true"`, `1`, `{}` — every non-true shape denies.
  if (Object.hasOwn(capabilities, capability) && capabilities[capability] === true) {
    return { allowed: true };
  }
  return DENY;
}
