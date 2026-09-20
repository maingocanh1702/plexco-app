---
feature: tenant-routing-authz
intake: ap3/features/tenant-routing-authz/INTAKE.md (status: READY_WITH_SUPERVISED_SLICES, measured_at: 2026-09-20T09:45:10Z)
base_sha: 56e860dac30cbf7b33c2ce7160de398f6b572bf9
planned_at: 2026-09-20
---

## Emission status (this PR)

**Every milestone in this plan is `supervised: true`. Zero queue files are emitted.** `plan-emit`
confirms this mechanically (`python3 ap3/aplib.py plan-emit plan.json` prints three `SKIPPED
(supervised: ...)` lines, `WROTE` count 0, exit 0) — see run output referenced in this PR's
description. This is not a partial plan waiting on a later dispatchable slice: the whole task's
risk profile (P1 throughout — schema-migration in M1, auth-primitive in M2, live-choke-point change
in M3) puts every milestone outside `ap3/routines.json`'s two enabled classes (`code-quality-p2`,
`feature-session-p2`, both `risk: P2`). All three milestones execute via `docs/autopilot-templates/
level3-workflow.md` (Level 3 supervised autonomy), run by a human/Level-3 session, one milestone at
a time, in the order below — M2 depends on M1's tables, M3 depends on M2's `authorize()` existing.

This is intentionally consistent with the intake's own framing (`INTAKE.md` §"Scope note" +
R6.1's supervised-gap verdict, plus the task prompt that requested this plan): the task's core
deliverable is exactly a new-schema authorization primitive, not incremental product surface.

## What already exists (not re-planned)

- `packages/db/src/authorization.ts` — `authorizeTenantAction(tx, tenantId, actionClass)`, the
  **billing-status** gate (DD-27/DD-110 axis). Unrelated mechanism; do not conflate with this
  task's `authorize(action, actor, target)`.
- `packages/db/src/capability.ts` — `resolveCapability(tx, tenantId, capability)`, the **DD-29
  commercial-entitlement** reader (`plans.entitlements.capabilities.*`, billing-plan gate: free vs
  host_pro). A different registry from DD-56's action→capability registry. `docs/autopilot-backlog.md`'s
  own `update_2026-08-25` note on this task already makes this distinction explicit — repeating it
  here because the two names ("capability") collide easily.
- `apps/web/lib/session-command-route.ts:82` — `ALLOWED_ROLES = new Set(["owner","admin","co_admin"])`,
  consumed at `:181` inside `resolveSessionCommandContext`, the **single shared choke-point** all
  seven DD-56-gated routes call through `handleSessionCommand` (`:603-621`). No route file
  duplicates this check — the switch in M3 is a small, centralized change, not a seven-file rewrite.
- `docs/autopilot-invariant-catalog.md:60` — the `actor-recheck-under-lock` token **already exists**
  (added ahead of this plan, presumably alongside the BE spec's A3 edit). No milestone below needs to
  register it; M2/M3 just need to actually satisfy what it already promises.
- `packages/db/src/test-harness.ts` — `setupRlsTestContext`, `seedPersonAccount`,
  `setupNonSuperuserOwnerContext` and friends. Reuse this for every new DB test in M1/M2; do not
  reinvent a harness. `authorization.test.ts`/`capability.test.ts` each hand-roll a small local
  `seedTenant()` on top of it — follow that pattern for the new tests too.
- `packages/db/migrations/0038_subscriptions_read_via_definer.sql` — the exact SECURITY DEFINER
  shape to follow for M2's new locked-read function: `LANGUAGE plpgsql SECURITY DEFINER SET
  search_path = public, pg_temp`, fail-closed `p_tenant_id` bound to `current_setting('app.tenant_id',
  true)`, `FOR SHARE` inside, `REVOKE ALL ... FROM PUBLIC` + `GRANT EXECUTE ... TO app`.
- `packages/db/migrations/0009_rls_policies_grants.sql` — the tenant-scoped `CREATE POLICY
  tenant_isolation ON <table> ...` pattern to follow for `tenant_capability_grants`/
  `tenant_capability_grant_audit`'s RLS policies (the BE spec's DDL block only pins
  `ENABLE`/`FORCE ROW LEVEL SECURITY` + `REVOKE`, not the policy body itself — M1 authors it
  following this precedent).

Everything below is a genuine gap the BE/FE spec v2.9 (ap3-intake A1-A6 pass, closed 2026-09-19)
requires and that live `main@56e860d` does not have.

## Milestone 1 — capability schema migration (supervised — schema-migration)

Slug: `tenant-routing-authz-m01-capability-schema-migration`

**Deliverable:** `packages/db/migrations/0047_tenant_capability_authority_core.sql` (confirmed next
open monotonic number; re-verify at implementation time in case another migration lands first) —
the exact DDL pinned at `docs/features/BE/feature_tenant_routing_authz_tech.md:115-175`:
`tenant_capability_actions` (closed registry, no app/app_worker/readonly DML), `tenant_capability_grants`
(tenant-private, RLS, no direct app INSERT/UPDATE/DELETE), `tenant_capability_grant_audit`
(append-only via `forbid_tenant_capability_grant_audit_mutation` trigger, same shape as
`job_audit_events`, `0022_job_claim_lease_core.sql:146-157`). Plus:
- RLS policy bodies for `tenant_capability_grants`/`tenant_capability_grant_audit` (BE spec pins
  `ENABLE`/`FORCE`/`REVOKE` only — author the `CREATE POLICY` text against the `0009` precedent
  above).
- Seed data: the DD-56 action matrix (`docs/features/BE/feature_tenant_routing_authz_tech.md:387-407`,
  `decisions.md:736`) plus the four Chat keys.
- `packages/db/schema.ts` — add the three Drizzle table definitions, pattern-matched against
  `tenant_admins` (`schema.ts:787-801`).
- A new DB test file (name at implementer's discretion, e.g.
  `packages/db/src/tenant-capability-schema.test.ts`) covering: registry REVOKE posture (no app/
  app_worker/readonly DML succeeds), grants RLS isolation + no direct app write, the audit table's
  immutability trigger (`UPDATE`/`DELETE` both raise), the partial-unique-active-grant index, the
  `expires_at > granted_at` check, and — importantly — that the seeded registry contains **exactly**
  the expected action-key set (see open flag below).

**Open flag for the implementer, not blocking:** the BE spec's §4 Action Matrix table (`:387-407`)
gives dotted `action_key` strings for 17 rows (`session.manage` through `role.manage`) but the last
two rows — "DD-51 global billing override" and "DD-53 freeze/split/relink" — carry no such string;
both are `authority_class: platform_admin_only`, dedicated PlatformAdmin paths per DD-51/DD-53, and
§4's "Canonical implementation split" text describes this registry as owning tenant-scoped action
authority only. Read as: **seed exactly the 17 tenant-scoped keys; do not invent action_key strings
for the two PlatformAdmin-only rows** — they are not resolved through this registry at all. If the
implementer's own reading of the spec differs, that is a one-line owner confirmation, not a redesign.

**Negative scope, explicit:**
- No grants-issuing command/API. `GET/POST/DELETE /api/tenants/:tid/grants(/:gid)` and their DTOs
  belong to the not-yet-authored follow-up `tenant-sensitive-capability-grant-lifecycle` (BE spec
  §3 `:340-342`, FE spec `:138`). This migration only creates the tables `authorize()` (M2) will
  read.
- No `authorize()` function yet — that is M2. This migration's own tests assert schema/constraint/
  seed correctness only, not authorization decisions.

Scope: `packages/db/migrations/0047_tenant_capability_authority_core.sql`, `packages/db/schema.ts`,
one new `packages/db/src/*.test.ts` file.

## Milestone 2 — `authorize()` primitive (supervised — auth primitive)

Slug: `tenant-routing-authz-m02-authorize-primitive`

**Deliverable:** the fail-closed `authorize(action, actor, target)` primitive
(`docs/features/BE/feature_tenant_routing_authz_tech.md:385,422-451`), implementing the invariant
catalog's own `actor-recheck-under-lock` entry (`docs/autopilot-invariant-catalog.md:60`, already
registered — see "What already exists"):
- A new migration (next open number after M1 lands — do not hard-pin `0048`; re-measure) creating a
  SECURITY DEFINER PL/pgSQL function, following `resolve_subscription_locked`
  (`0038_subscriptions_read_via_definer.sql`) exactly: fail-closed `p_tenant_id` bound to
  `current_setting('app.tenant_id', true)`, `SELECT ... FOR SHARE` on the actor's `tenant_admins`
  row and, when the action is `delegable`, the matching `tenant_capability_grants` row, every time
  predicate (`expires_at`, `revoked_at`) read via `clock_timestamp()` — never `now()` (2026-09-06
  audit lesson C1, already the convention `authorizeTenantAction`/`resolve_subscription_locked`/
  `session-service.ts` all follow).
- A new TS wrapper exporting `authorize(tx, action, actor, target)`. **Naming note:** neither
  `authorization.ts` (billing-status axis) nor `capability.ts` (DD-29 entitlement axis) is the right
  home — both are established, differently-scoped primitives; put this in its own new file (e.g.
  `packages/db/src/tenant-capability-authority.ts`) so the module name doesn't collide with either
  existing "capability" concept. Export it from `packages/db/src/index.ts`'s barrel (a registration
  point the `session-management` plan's own attempt log flagged as easy to miss — see that PLAN.md's
  "M3b attempt log").
- Core unit tests — BE spec §5 rows #21-28 (registry/preset/deny/grant/expiry-under-lock portions
  only, per the spec's own "Test ownership / dependency fence" note at `:527`) and #32 (exact Chat
  keys). Confirmed zero existing coverage for any of these (test-mapping research pass, this PR).
  Reuse `setupRlsTestContext` + a local `seedTenant`-style fixture, matching
  `authorization.test.ts`/`capability.test.ts`'s own pattern.

**Negative scope, explicit:**
- Do NOT touch `apps/web/lib/session-command-route.ts` or any route file in this milestone — the
  primitive must exist and pass its own tests before anything consumes it. That's M3.
- Do NOT implement tests #33-35 (Chat target re-check / moderation boundary / timed mute) or
  integration tests #5/#7 (external-surface parity, Chat capability parity) — the spec explicitly
  assigns these to later Chat consumer tasks (`chat-club-moderation-core`,
  `chat-shared-message-command-core`) and a DD-65-68 adapter rollout task, not this one.
- Do NOT build the grants-issuing command (same follow-up boundary as M1).

Scope: one new migration file, one new `packages/db/src/*.ts` primitive file, one new
`packages/db/src/*.test.ts` file, `packages/db/src/index.ts` (barrel export edit).

## Milestone 3 — seven-route switch + guard retirement (supervised — live choke-point change)

Slug: `tenant-routing-authz-m03-route-switch-guard-retirement`

**Deliverable — three things landing in the same change, per the BE spec's own definition of
"land" (`:366-370,372-377`) and DD-56 amendment #1 clause 5 (`decisions.md:752`, verbatim: *"amendment
này void ngay khi `tenant-capability-authority-core` land. Thay choke-point này bằng `authorize(action,
actor, target)` NẰM TRONG SCOPE của slice core theo cấu tạo"*):**

1. **The switch.** `apps/web/lib/session-command-route.ts:181`'s `ALLOWED_ROLES.has(membership.role)`
   check is replaced by a call to `authorize("session.manage", actor, target)` (M2's primitive),
   inside the same command transaction per `actor-recheck-under-lock`. Because all seven routes
   already call through this one function (`resolveSessionCommandContext` /
   `handleSessionCommand`), this is a single-file behavioral change, not seven edits — confirmed by
   the impact research pass (no route file reads `.role` or imports `tenantsForPerson` directly).
2. **Guard retirement.** `eslint.config.mjs:121-186` (the DD-56 clause-2 block: the
   `no-restricted-imports` rule banning `tenantsForPerson` outside the 3-file allowlist, plus the
   three `no-restricted-syntax` selectors) is deleted — its own comment at `:121-123` already
   anticipates exactly this. `apps/web/lib/session-command-route.test.ts`'s AST-walk tests
   (`describe` at `:1143-1329`, `roleRead()`/`importsRoleSource()`) are retired or rewritten: once
   `session-command-route.ts` no longer decides on `.role` at all, the "exactly these N files read/
   import role" assertions (`:1204-1207`, `:1308-1318`) need re-deriving against whatever role-reading
   surface remains (`app/api/onboarding/readiness/route.ts` stays; `session-command-route.ts` and
   `app/api/auth/session/route.ts` need re-verifying against the post-switch code, not assumed).
3. **Decision closure.** `docs/standards/decisions.md:739-817` (DD-56 amendments #1, #2, #2's
   09-04 correction block, and #3 in full) is removed from the document per clause 5's own text
   ("khi land thì xoá luôn amendment này") — all three amendments share the same expiry condition,
   worded identically in each ("void ngay khi `tenant-capability-authority-core` land"). Keep DD-56's
   own core decision text (`:732-738`) and its summary-table row (`:77`, update "chưa runtime" to
   reflect the primitive now existing); only the three amendment blocks are retired. This is a
   docs edit that must land in the **same** commit/PR as the code switch — not a follow-up — since
   leaving stale amendment text describing a choke-point that no longer exists would mislead the
   next reader.

**Functional test update.** `apps/web/lib/session-command-route.test.ts:525-585` (owner/admin/
co_admin allow, unrecognized-role deny, tenant isolation) gets rewritten against `authorize()`'s
behavior rather than `ALLOWED_ROLES` directly — same observable behavior (owner/admin/co_admin
allowed via the least-privilege preset, everyone else denied), different mechanism under test.
**Verify, don't assume, whether the 7 per-route test files** (`apps/web/app/api/sessions/route.test.ts`
and its 6 siblings, each with 2 role-gating assertions per the test-mapping research pass) need
mock changes — they currently mock the DB layer directly; if `authorize()`'s SECURITY DEFINER call
can't be exercised through the same mock shape, these tests need their `authorize()` call mocked
instead. This is exactly the kind of thing to confirm by reading the current mock setup before
editing, not to guess.

**Negative scope, explicit:**
- Do NOT extend the switch to `app/api/onboarding/readiness/route.ts` or
  `app/api/auth/session/route.ts` — neither is one of the seven DD-56-gated routes; both are
  out of this task's scope entirely (per DD-56 amendment #1 clause 6's own allowlist).
- Do NOT add new action keys or new routes beyond the seven already named in
  `docs/features/BE/feature_tenant_routing_authz_tech.md:356-364`.

Scope: `apps/web/lib/session-command-route.ts`, `apps/web/lib/session-command-route.test.ts`,
`eslint.config.mjs`, `docs/standards/decisions.md`, and (pending the verify-don't-assume check
above) up to 7 per-route `.test.ts` files under `apps/web/app/api/sessions/**`.

---

## Deferred — not planned this round, with reasons

**D1. `tenant-sensitive-capability-grant-lifecycle`** (grants-issuing command + management UI at
`/clubs/:id/settings/team/:memberId/grants`) — explicitly out of scope for all three milestones
above per both specs (BE `:340-342`, FE `:138`). Not authored as a task yet; the owner should open
its own intake once this core lands, since it depends on `tenant_capability_grants` existing.

**D2. Chat capability consumers** (`chat-club-channel-lifecycle-core`,
`chat-authorized-member-target-read-core`, `chat-club-moderation-core`,
`chat-shared-message-command-core`) — all remain `HOLD` per `docs/autopilot-backlog.md`'s own note
on this task, until this core (all 3 milestones) has landed. Tests #33-35 and integration #7
belong to those tasks, not this plan.

**D3. DD-65-68 Messenger/Zalo adapter rollout** — integration test #5 ("registry used by every
external surface") is explicitly deferred to that rollout task per the BE spec's own test-ownership
note (`:529`). Not part of this plan.

**D4. A naming discrepancy worth flagging, not a blocker:** `docs/autopilot-backlog.md`'s own task
title/`split_note` for `tenant-capability-authority-core` mentions `hasCapability` as part of the
deliverable — an older working name from before the FE/BE specs (v2.9, Reviewed) settled on the
`authorize(action, actor, target)` signature (ap3-intake A5, closed 2026-09-19). The Reviewed specs
are the authority here; `hasCapability` should be treated as superseded terminology, not a second
function to build. Worth a one-line backlog title cleanup whenever that block is next touched, not
urgent enough to hold up this plan.

## Unresolved questions for the owner

1. **M1's open flag above** (DD-51/DD-53 rows have no `action_key` string in the BE spec's matrix
   table) — confirm the reading that these two rows are NOT seeded into `tenant_capability_actions`
   at all (they resolve through a separate PlatformAdmin-only path), or provide the two key strings
   if they should be seeded.
2. **M3's per-route test files** — genuinely unverified whether their existing DB mocks can exercise
   `authorize()` unchanged or need updating; flagged for the M3 implementer to resolve by reading the
   current mocks first, not a design question for the owner, but noted here so M3 doesn't silently
   skip it.
3. **D4's naming cleanup** — low priority, mentioned for completeness.
