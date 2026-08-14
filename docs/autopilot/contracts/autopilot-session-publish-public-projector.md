<!-- review-readiness: enforce -->

# session-publish-public-projector — task contract

> **Slice (as framed):** `session-publish-public-projector` (slug = mechanism: the `PublishSession`
> command boundary `draft`→`open`, **plus** the first REAL `public_sessions` projector — the first
> genuine outbox consumer, turning merged-but-code-dark job infra into a working product path).
> **Risk:** P1 (public projection / byte-boundary / HARD RULE #2 trust boundary). **Change class:** code
> + **migration (unavoidable, see §3)**. **Autonomy:** supervised.
> **Opened from:** P-B / L1 (`docs/autopilot-templates/next-lanes-*` S2 line — first real outbox consumer).
> **Authored:** 2026-08-14 against `origin/main` @ `519fb9f91fffe4712668f24a1af697d5f1a002bd`
> (= HEAD, verified `git rev-parse HEAD` and `git merge-base --is-ancestor 519fb9f… main`).
> **Manifest:** `docs/autopilot-manifests/session-publish-public-projector.json`.
> **Verdict:** **`NOT_CODE_READY`** — the `PublishSession` service half is fully derivable (Tier A), but
> the slice OUTCOME (the first real `public_sessions` projector) collides with two Tier-C obligations that
> the declared negative scope (`NO new migration`, `~300 LOC / ≤3 modules`) forbids: the DD-73 Q5
> owner-ratified immediate-deny fence/guarded-view/**REVOKE-readonly** migration (HARD RULE #2), and the
> DD-32 `confirmed_count` + `getSessionOccupancy()` + channel-booking-hold + DD-46 alias infrastructure
> that does not exist on base. This is an `enforce` (blocker-audit) artifact — it authorizes NO worktree.

## 0. Task contract (level3-workflow §3)

```text
TASK_ID: plexco:session-publish-public-projector
OUTCOME (target, NOT reached): PublishSession (draft session -> published) exists AND the first REAL
  public_sessions projector consumes session.published (the first genuine outbox consumer), writing ONLY
  the 15-column public whitelist — no money, no PII, no gender (HARD RULE #2).
REPOSITORY_AND_BASE: plexco-app @ origin/main = 519fb9f91fffe4712668f24a1af697d5f1a002bd (= HEAD,
  verified 2026-08-14). A successor re-slice re-verifies and re-pins its base from live main at register.
CONTEXT_SOURCES: docs/features/BE/feature_session_management_tech.md v2.22 (§2 edges #21-24, §3
  error codes, §4 Publish transition steps 1-7, §4 Events table `session.published` payload
  session_id/tenant_id/visibility:508); docs/features/FE/feature_session_management.md v2.25 (SES-UC-12,
  edges #16-19, state machine draft-->open:735, analytics session_published:790); docs/features/BE/
  feature_marketplace_discovery_tech.md v2.7 (§2 DDL, §4 Projector Logic:183-201, edge #14/#15, timing
  note:199); docs/features/FE/feature_marketplace_discovery.md v2.7 (§3 SessionCard:168-188 — DD-106 Q3,
  referenced not frozen); packages/db/migrations/0006_discovery.sql:11-27 (public_sessions 15-col
  whitelist); packages/db/migrations/0009_rls_policies_grants.sql:117 (GRANT SELECT public_sessions TO
  readonly — the grant DD-73 Q5 says the projector slice must REVOKE); packages/db/src/rls-invariants.
  test.ts:171-205 (EXACT 15-column whitelist forcing function); packages/db/src/authorization.ts:25,91
  (publish_new_sessions action class + authorizeTenantAction); packages/db/src/session-service.ts:187-292
  (CreateSession producer pattern + first outbox producer, ON BASE); apps/bot/src/dispatcher.ts (stub
  productionStubDeliver only DLQs — where the first real projector would wire in); docs/standards/
  decisions.md DD-73 Q5 (254-259, 901-913), DD-32 (47, 904), DD-46 (62, 617, 2123), DD-105 (HANDOFF LIVE
  TRUTH 13/08), DD-106 Q3 (prompt ruling).
APPLICABLE_SKILLS: none resident.
SCOPE (intended, NOT authorized): see manifest _scope_note. As framed it needs packages/db/src/session-
  service.ts (add publishSession) + its test, a new projector module, packages/db/src/index.ts barrel
  (shared merge-time touch), apps/bot/src/dispatcher.ts (wire first real consumer), AND a new
  packages/db/migrations/00NN_*.sql (DD-73 Q5 fence/guarded-view/REVOKE-readonly + DD-32 confirmed_count).
  The migration requirement is the contradiction that blocks the slice.
NEGATIVE_SCOPE: projector writes ONLY the 15 whitelist cols (0006:11-27) — no money, no PII, no gender,
  no roster, no exact venue (HARD RULE #2); do NOT loosen rls-invariants.test.ts:171-205; do NOT enable
  OUTBOX_DISPATCH_SCHEDULE_ENABLED (Tier C #5); do NOT modify createSession; do NOT freeze DD-106 Q3
  SessionCard; NO new migration in THIS framing — which the projector outcome structurally violates.
RISK: P1 — public projection at a byte boundary, HARD RULE #2 trust boundary; a security-focused codex
  round is REQUIRED for the projector (Phase 2), plus the immediate-deny fence integration test.
AUTONOMY_MODE: supervised
MODEL_POLICY: planner=primary-agent; worker=assigned-agent; reviewer=scripts/codex-review-pin.sh
  (2 clean code rounds for S-publish; 2 clean code rounds + 1 security round for S-projector).
SANDBOX_AND_PERMISSIONS: network none; secrets none; external side effects none.
HUMAN_DECISIONS_REQUIRED: yes — the projector's mandated fence/REVOKE migration + confirmed_count column
  (DD-73 Q5 + DD-32) fall OUTSIDE this slice's declared negative scope; the owner must approve the re-slice
  (S-publish now, S-projector as its own Tier-C slice sequenced after DD-32/DD-46/occupancy). See §7.
SLICE_GRAPH: PublishSession depends only on merged substrate (session-service CreateSession producer on
  base, authorizeTenantAction, 0022/0023 outbox). The projector depends on UNMERGED design/migration work
  (DD-73 Q5 fence, DD-32 confirmed_count, getSessionOccupancy, channel-booking holds, DD-46 alias) — none
  authored as slices yet, so the projector cannot start.
WORKTREE_PLAN: NONE — NOT_CODE_READY. No worktree opened by this authoring pass.
VERIFICATION (when re-sliced): pnpm test with DATABASE_URL_TEST (real PG); rls-invariants unchanged-green;
  build/lint/typecheck; projector crosses a real boundary -> security round + fence integration test.
CODE_REVIEW: required — 2 clean rounds via scripts/codex-review-pin.sh per sub-slice.
SECURITY_REVIEW: REQUIRED for the projector (public byte-boundary, HARD RULE #2) — a security-focused
  codex round through the pinned wrapper. If the probe finds any tenant/money/PII column reachable in the
  projected row, this judgement is already void — the projector is a trust boundary by construction.
BUDGETS: default ~300 LOC / ≤3 modules / ≤1 migration CANNOT hold the slice as framed (see manifest
  budgets._loc_note); fix_rounds_max 5. Re-slice into S-publish (~120 LOC, 0 migration) + S-projector.
STOP_CONDITIONS: authoring-only; opens no worktree. For S-projector: a 16th public column, a missing
  DD-73 Q5 fence/REVOKE, or unwritten confirmed_count -> STOP (HARD RULE #2 / scope-design error).
DELIVERABLES (this pass): this contract + authored manifest + a backlog block (proposed for the conductor
  to paste) + the lane ledger .autopilot/state/session-publish-public-projector/DECISIONS.md. NO code.
```

## 1. Why this slice, why now — and why it does not reach CODE_READY as framed

The next-lanes brief names "the first real `public_sessions` projector" as the highest-leverage next step:
the 0022/0023 job substrate, the dispatcher and the recovery schedule all merged but stay code-dark
(schedule OFF, `productionStubDeliver` only DLQs, no producer, no real projector). The CreateSession
producer (S2) landed on base and writes the first `session.created` outbox row. Turning that into a working
product path means (a) `PublishSession` (the transition that MAKES a draft joinable and, per
project-on-publish, projectable) and (b) a projector that consumes the event and writes `public_sessions`.

Half (a) is genuinely buildable today. Half (b) — the actual OUTCOME word "projector" — cannot be built
under this slice's declared negative scope, because the projector's own owner-spec and two owner-ratified
decisions require infrastructure that (1) needs a migration this slice forbids and (2) does not exist on
base. A slice whose correct end-state needs an out-of-scope migration is a scope-design error: the right
move is to re-slice, not to ship a naive projector that leaks under HARD RULE #2. Hence `NOT_CODE_READY`
with named binary blockers (§7) — an honest, successful authoring outcome.

## 2. Mechanism — the buildable half (PublishSession), fully pinned (Tier A)

One exported service function (name pinned at build: `publishSession`), a sibling of `createSession`,
executing inside a single `withTenant` transaction. Every step is pinned by `feature_session_management_
tech.md` §4 "Publish transition" steps 1-7 and edges #21-24:

1. Resolve trusted actor/tenant from context (never payload). **AuthZ re-checked on EVERY call including
   replay/no-op (authz precedes dedup + state lookup):** `session.manage` (Host) else 403; **billing
   fail-fast:** `authorizeTenantAction(tx, tenantId, 'publish_new_sessions')` upfront (gates no-op too —
   authz wins no-op). Then `commandId` dedup via canonical `processed_commands` (edge #3), same mechanism
   as every session command — inherited, not re-specified.
2. Lock the session row `FOR UPDATE` in tenant context (RLS choke-point). Read `status`, `visibility`,
   `starts_at`, `version` under lock.
3. **Idempotent no-op (wins expectedVersion):** if already `open` → success no-op, zero mutation, no
   duplicate `session.published` (mirror close/cancel no-op). `expectedVersion` NOT checked here.
4. **Transition guard:** `status ∈ {closed,cancelled}`, or `draft` with `starts_at <= now()` (past) →
   `SESSION_NOT_OPEN` (409), zero mutation. Only `draft` with `starts_at > now()` proceeds.
5. **Public precondition:** if `visibility='public'` → re-validate E#7 discovery completeness (sport,
   area, starts_at, `slots_max IS NOT NULL`) → `MISSING_DISCOVERY_FIELDS` (400), zero mutation.
6. **Commit (only for draft→open):** billing **re-check under LOCKING read** — `authorizeTenantAction`
   MUST read `FOR SHARE` on `tenants` then `subscriptions` in the SAME transaction holding the session
   lock (a plain re-SELECT does NOT serialize against the Daily Lifecycle Job's `FOR UPDATE SKIP LOCKED`).
   Suspended → `TENANT_SUSPENDED` (403) wins, abort, zero mutation, no event. Else, if the client sent
   `expectedVersion`, check it (mismatch → `STALE_VERSION` 409); then set `status='open'`, bump `version`,
   write exactly one `session.published` outbox row (payload `{session_id, tenant_id, visibility}`,
   §4 Events:508), per-aggregate `sequence = COALESCE(MAX(sequence) WHERE aggregate_id=:id,0)+1`,
   `aggregate_type='session'`, lease/ack NULL — the exact producer contract `createSession` established.
7. Record `processed_commands` result; commit; return envelope.

**Suspension gate is DECIDED, not open** (a prompt watch-point, resolved to Tier A): DD-105 (HANDOFF LIVE
TRUTH 13/08) states the real `publish_new_sessions` boundary is `❌ when suspended`; edge #24 + §4 step 6
pin it, and the action-class literal `publish_new_sessions` EXISTS on base (`authorization.ts:25`). This is
the demotion rule — a boundary the DD authorizes by name is Tier A.

## 3. Mechanism — the blocked half (the projector), and exactly why it is Tier C

The projector's owner is `feature_marketplace_discovery` (session-management §4 step 7 says so — publish
emits the event, the marketplace projector upserts). Its §4 Projector Logic (lines 183-201) mandates, for
each event: resolve public aliases (`club_display_name` from moderated `tenants.display_name`;
`host_display_name` from personal-tenant owner `membership.display_name`, DD-46 target; fail-closed skip if
blank), call `getSessionOccupancy(session)` once, and upsert with `confirmed_count=active`,
`slots_open=max(0, slots_max-active-live holds)`. On private/closed/cancelled/expired → delete + cache
purge. Three of these have no substrate on base, and one requires a forbidden migration:

- **DD-73 Q5 (owner-ratified 2026-07-19, decisions.md:254-259, 901-913):** the DD-12/marketplace projector
  slice MUST include `public_projection_fences` (GLOBAL PROTECTED) + a guarded public view + narrow
  raise/CAS-clear functions + `public_projection_version` + a grant migration that **REVOKEs `readonly`
  SELECT on base `public_sessions`** ("REVOKE base SELECT truoc khi bat consumer moi", :259) and grants
  only the guarded view. Reason: marketplace has NO immediate-deny path — a session flipped private/cancel
  keeps leaking on the base table (which `readonly` can still read, `0009:117`) until the async projector
  deletes it. That is the HARD RULE #2 gap this obligation exists to close. It is a **new migration** — the
  negative scope forbids one, and Tier C #7 forbids silently widening negative scope.
- **DD-32 `confirmed_count` (decisions.md:904, marketplace §2:71):** additive column, "chua co trong live
  projection", "backfill/reproject must run before readers require it" → a **new migration** + column.
  0 matches for `confirmed_count` in `packages/db/` (control: `outbox_events` present).
- **`getSessionOccupancy()`:** 0 matches in `packages/` (control: `createSession` = 2 present). It reads
  `players` (active) + channel-booking **live holds** — and the DD-32 booking-intent/hold tables have 0
  matches in `schema.ts`. The occupancy source does not exist.
- **DD-46 moderated alias resolution:** the personal-tenant owner-membership alias + moderation gate is a
  "tach design-probe/slice rieng khi build" (decisions.md:617) — unbuilt. Blank-alias fail-closed skip
  (edge #13) is part of the projector's correctness and depends on it.

So "writes ONLY the 15 whitelist cols" is not the constraint that makes the projector easy — the 15-col
**list** is pinned (0006 + rls-invariants.test.ts:171-205), but the **values** (`sport_key`, `slots_open`,
`club/host_display_name`, and — per the projector's mandated DD-32 semantics — `confirmed_count`) require a
migration and three unbuilt subsystems. `getSessionOccupancy(0 holds)=0` is derivable, but the DD-32 spec
does not let the projector pretend the holds subsystem exists, and `confirmed_count` has no column to write.

## 4. What is already proven on base (measured 2026-08-14 at 519fb9f)

- `createSession` + the first outbox producer are MERGED (`session-service.ts:187-292`); barrel export at
  `index.ts:26-33`. The producer contract (per-aggregate `sequence`, `aggregate_type='session'`, null
  lease/ack) is exactly what `session.published` reuses.
- `authorizeTenantAction` + the `'publish_new_sessions'` action class exist (`authorization.ts:25,91-138`),
  0 production callers.
- `public_sessions` = 15 cols (`0006:11-27`, `schema.ts:1418-1441`); the EXACT-whitelist + no-money/PII
  smell invariant is `rls-invariants.test.ts:171-205`.
- `readonly` holds `GRANT SELECT ON public_sessions` (`0009:117`) — the grant DD-73 Q5 mandates REVOKing.
- Dispatcher `runDispatchCycle` + `productionStubDeliver` (DLQ-only) are on base (`dispatcher.ts`); the
  `REQUIRED_PROJECTORS` array is the wire-in point for a real projector (with the documented rolling-deploy
  caveat, `dispatcher.ts:16-33`). Schedule OFF.
- ABSENT on base (grep, with present controls): `getSessionOccupancy`, `confirmed_count`,
  channel-booking hold/intent tables, `public_projection_fences`, guarded public view,
  `public_projection_version`.

## 5. Slice-local acceptance matrix — PARTIAL (buildable half only; projector half unspecifiable here)

The `PublishSession` half has a complete, spec-traceable matrix (below). The projector half **cannot** have
a complete acceptance matrix in this packet, because its expected rows depend on undecided/unbuilt
infrastructure (confirmed_count values, occupancy semantics, fence deny-path) — which is precisely why
G4/ACCEPTANCE fail for the slice as a whole.

| # | Group | Input / precondition | Expected | Test layer | Trace |
|---|---|---|---|---|---|
| P1 | Happy | Host publish a `draft`, `starts_at > now()` | `status='open'`, `version` bumped; exactly one `session.published` (payload `{session_id,tenant_id,visibility}`, `sequence` = MAX+1); dedup row | real-PG unit | SES-UC-12; BE edge #21, §4:508; `U#40` |
| P2 | Idempotency | re-publish an already-`open` session (commandId replay OR new commandId, actor still has session.manage, tenant not suspended) | no-op success; NO duplicate `session.published`; version unchanged; idempotency wins `STALE_VERSION` | real-PG unit | BE edge #21, §4 step 3; `U#41` |
| P3 | AuthZ-wins-no-op | replay on an `open` session but actor lost `session.manage` OR tenant now suspended | 403 (`session.manage`) / `TENANT_SUSPENDED` — BEFORE the no-op | unit | BE §4 step 1/3; checklist `U#48` |
| P4 | Boundary (public) | publish a `public` session missing sport/area/starts_at/finite slots_max | `MISSING_DISCOVERY_FIELDS` (400), zero mutation, no event | unit | BE edge #22, §4 step 5; `U#...` |
| P5 | State guard | publish a `closed`/`cancelled` session, or a `draft` with `starts_at <= now()` | `SESSION_NOT_OPEN` (409), zero mutation | unit | BE edge #23, §4 step 4 |
| P6 | Security/Billing (concurrency) | suspend transition commits BETWEEN upfront check and mutation | `TENANT_SUSPENDED` wins via in-tx `FOR SHARE` locking re-check; zero mutation, no event | real-PG unit (competing writer) | BE edge #24, §4 step 6; billing test #36 |
| P7 | Concurrency | auto-expiry job races publish on the same draft | both lock the row `FOR UPDATE`; job-first → publish sees `cancelled` → `SESSION_NOT_OPEN`; publish-first → job `SKIP LOCKED` skips | real-PG unit | BE edge #29 |
| P8 | Security (RLS) | publish in tenant A, verify tenant B invisibility | RLS `FORCE` via `withTenant`; `tenant_id` injected, never from payload | real-PG unit + rls-invariants unchanged-green | Bat bien; BE §4 Security |
| PROJ* | Projector (public byte-boundary) | publish a public session → project into `public_sessions` | **UNSPECIFIABLE in this packet** — expected `slots_open`/`confirmed_count`/alias values + the immediate-deny fence behaviour depend on DD-32/DD-46/getSessionOccupancy + the DD-73 Q5 migration, none of which exist on base. This row is why ACCEPTANCE_MATRIX = FAIL for the slice. | — | §3 blockers; marketplace §4:183-201 |

> **Authorization group note:** the non-admin 403 on publish (BE edge #10) is enforced by AuthZ middleware
> at the route layer (a later slice), OUT of this service-only scope; P8 covers the RLS/tenant dimension.

## 6. What the projector re-slice must carry (for the successor, not this packet)

Recorded so the out-of-scope findings do not live only in this transcript (an explicit backlog exception):

1. **S-publish** (Tier A, buildable now): `publishSession` service fn + real-PG test + barrel export.
   0 migration, ~120 LOC, 2 clean codex rounds. `merged_probe` = `publishSession`.
2. **S-projector** (Tier C, its own slice, sequenced AFTER its deps): the `public_sessions` projector +
   the DD-73 Q5 immediate-deny migration (`public_projection_fences` + guarded view + REVOKE readonly base
   SELECT + `public_projection_version`) + the DD-32 `confirmed_count` column + `getSessionOccupancy()`
   (needs the channel-booking hold subsystem) + DD-46 moderated alias. Security codex round + fence
   integration test REQUIRED before enablement. `merged_probe` = `projectPublicSession`. This slice's deps
   (DD-32 booking-hold tables, DD-46 alias moderation, occupancy helper) must be authored first.

## 7. Closure matrix (partial) + canonical verdict

### 7.1 Closure matrix — 8/12 PASS, 4 FAIL (re-run at authoring, 519fb9f)

| # | Gate | Evidence | PASS/FAIL |
|---|---|---|---|
| 1 | Authority snapshot pinned by SHA | `git rev-parse HEAD` = 519fb9f… (= origin/main, ancestor of main); exact TARGET_FILES, no glob | PASS |
| 2 | In-scope decisions closed | publish path: DD-105 (suspended ❌), edge #24 pinned. Projector path: DD-73 Q5/DD-32/DD-46 are DECIDED but require unbuilt migrations/subsystems — the decision exists, the buildability does not | PARTIAL → treated FAIL for the slice (see G3) |
| 3 | Scope IN/OUT + owner clear | §0; but the OUTCOME (projector) needs a migration the negative scope forbids → scope-design error | FAIL |
| 4 | Dependency classified | publish deps MERGED; projector deps (fence migration, confirmed_count, getSessionOccupancy, holds, DD-46) UNMERGED/UNBUILT | FAIL |
| 5 | Live schema/code matches doc | verified at 519fb9f: session-service.ts:187-292, authorization.ts:25/91, 0006:11-27, 0009:117, rls-invariants.test.ts:171-205, dispatcher.ts | PASS |
| 6 | Data/API/state/auth contract complete | publish: §2 + matrix P1-P8. Projector: values/deny-path not specifiable (§3) | PARTIAL |
| 7 | Fail-closed / idempotency / order pinned | publish: dedup-first, typed errors, in-tx locking billing re-check, RLS by construction. Projector: immediate-deny fence NOT built | PARTIAL |
| 8 | In-scope open questions = 0 | publish: 0. Projector: the migration/occupancy/alias questions are IN the slice outcome and OPEN | FAIL |
| 9 | Acceptance matrix has expected results | publish rows P1-P8 complete; PROJ* row unspecifiable | FAIL (ACCEPTANCE_MATRIX) |
| 10 | Migration / security / rollback pinned | the projector REQUIRES a migration (DD-73 Q5 + DD-32) that this slice forbids; security round required but slice not buildable | FAIL |
| 11 | First slice hard deps merged | publish deps merged; projector deps not authored as slices | FAIL |
| 12 | Implementation handoff ready | this contract + manifest + backlog block are consistent, but authorize NO worktree (NOT_CODE_READY) | PARTIAL |

### 7.2 Verdict — canonical block

```text
REVIEW_POLICY_VERSION: 1.3
REVIEW_VERDICT: NOT_CODE_READY
REVIEWED_AT: 2026-08-14
AUTHORITY_SHA: 519fb9f91fffe4712668f24a1af697d5f1a002bd
BASE_BRANCH: main
TARGET_FILES:
  - docs/autopilot/contracts/autopilot-session-publish-public-projector.md
  - docs/autopilot-manifests/session-publish-public-projector.json
  - docs/autopilot-backlog.md
  - docs/standards/decisions.md
  - docs/features/BE/feature_session_management_tech.md
  - docs/features/BE/feature_marketplace_discovery_tech.md
  - packages/db/migrations/0006_discovery.sql
  - packages/db/migrations/0009_rls_policies_grants.sql
  - packages/db/src/session-service.ts
  - packages/db/src/authorization.ts
  - packages/db/src/rls-invariants.test.ts
  - apps/bot/src/dispatcher.ts
SLICE: session-publish-public-projector
IN_SCOPE: (as framed) the PublishSession command boundary draft->open as one service function in one
  withTenant transaction (authz + fail-fast billing, session-row FOR UPDATE, idempotent no-op, transition
  guard, public discovery re-validation, in-transaction FOR SHARE billing re-check, one session.published
  outbox row, processed_commands dedup) PLUS the first real public_sessions projector consuming
  session.published and writing only the 15-column whitelist, wired into the dispatcher as the first real
  outbox consumer.
OUT_OF_SCOPE: any route/API/UI; enabling OUTBOX_DISPATCH_SCHEDULE_ENABLED; modifying createSession;
  loosening rls-invariants.test.ts 15-column whitelist; freezing the DD-106 Q3 SessionCard shape;
  cancel/close/update/announce/delete commands; waitlist/join/player/charge logic; channel adapters.
G1_DECISION: PASS
G2_SPEC: PARTIAL
G3_DEPENDENCY: FAIL
G4_TEST: PARTIAL
G5_SCOPE: FAIL
G6_EXTERNAL: FAIL
HARD_DEPENDENCIES: publish half — MERGED: createSession producer (session-service.ts:187-292),
  authorizeTenantAction + publish_new_sessions class (authorization.ts:25/91), outbox substrate
  (0022/0023). Projector half — UNMET: the DD-73 Q5 immediate-deny migration (public_projection_fences +
  guarded view + REVOKE readonly SELECT on public_sessions + public_projection_version, decisions.md:254-259/
  901-913), the DD-32 confirmed_count column (decisions.md:904), getSessionOccupancy() (0 matches on base),
  the channel-booking live-hold tables (0 matches on base), and DD-46 moderated alias resolution
  (decisions.md:617). None are authored slices.
PRIOR_SLICES: session-service-create-command-core (the CreateSession producer S2, on base) — the producer
  whose session.published sibling and outbox contract this slice reuses.
OPEN_QUESTIONS_IN_SCOPE: 2
ENABLEMENT_ONLY_GATES: none
LIVE_REPO_VERIFICATION: PASS
CONTRACT_MATRIX: PARTIAL
CLOSURE_MATRIX: PARTIAL
ACCEPTANCE_MATRIX: FAIL
SECURITY_AND_MIGRATION_GATE: FAIL
IMPLEMENTATION_ARTIFACTS: FAIL
FIRST_IMPLEMENTATION_STEP: BLOCKED — re-slice per owner decision. Recommended: author S-publish
  (publishSession service fn + real-PG test + barrel export; 0 migration; Tier A) as its own CODE_READY
  packet now, and defer S-projector (the public_sessions projector + its mandated DD-73 Q5 fence/REVOKE +
  DD-32 confirmed_count migration + getSessionOccupancy + DD-46 alias) to its own Tier-C slice sequenced
  after those dependencies are authored.
REMAINING_BLOCKERS:
  - blocker: The slice OUTCOME (first real public_sessions projector) requires a NEW migration that the
      declared negative scope forbids — DD-73 Q5 mandates public_projection_fences + a guarded public view
      + REVOKE of readonly SELECT on base public_sessions + public_projection_version (the HARD RULE #2
      immediate-deny path), and DD-32 mandates an additive confirmed_count column. A projector without them
      ships a privacy leak (base table stays readable after a private/cancel until the async projector
      deletes) and is out-of-negative-scope.
    owner: owner (product/policy) + marketplace-discovery spec owner (DD-12/DD-73 Q5, DD-32)
    resolution: owner authorizes the re-slice — S-publish (0 migration, buildable now) split from
      S-projector (its own Tier-C slice carrying the DD-73 Q5 fence/guarded-view/REVOKE-readonly +
      confirmed_count migration). Binary: re-slice approved (yes/no).
  - blocker: The projector's mandated aggregates + alias have no substrate on base — getSessionOccupancy()
      (0 matches), channel-booking live-hold tables (0 matches), DD-32 confirmed_count column (0 matches),
      DD-46 moderated owner-membership alias resolution (unbuilt, decisions.md:617). Their absence makes
      the projector's slots_open/confirmed_count/club_display_name/host_display_name values and the
      fail-closed blank-alias skip unspecifiable, so the projector acceptance matrix cannot be completed.
    owner: DD-32 booking-funnel slice owner + DD-46 personal-tenant/identity slice owner + marketplace
      projector slice owner
    resolution: those dependency slices (channel-booking hold subsystem + getSessionOccupancy, DD-46 alias
      moderation) are authored and merged, then S-projector re-derives its base and acceptance matrix.
      Binary: all named dependency substrate merged on main (yes/no).
NEXT_REVIEW_TRIGGER: an S-publish CODE_READY packet is authored (grep-absent merged_probe `publishSession`
  becomes the slice probe) OR the DD-73 Q5 fence/REVOKE migration + DD-32 confirmed_count column + a
  getSessionOccupancy() helper land on main (verify with a merged probe on each), at which point the
  projector re-slice can be re-reviewed against a fresh base.
```
