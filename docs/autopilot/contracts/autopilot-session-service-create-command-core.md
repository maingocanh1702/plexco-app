<!-- review-readiness: enforce -->

# session-service-create-command-core — task contract

> **Slice:** `session-service-create-command-core` (slug = mechanism: the `CreateSession` command
> boundary — trusted-context input → validation → `processed_commands` dedup → `tenantRepo` insert →
> `session.created` outbox row, one transaction, zero migration).
> **Risk:** P2 · **Change class:** code (service-only) · **Autonomy:** supervised.
> **Opened from:** M2 (`docs/sessions/2026-08-07-next-milestones.md` — Session BE vertical root).
> **Authored:** 2026-08-13 against `origin/main` @ `775cb9e` (docs-batch tip; runtime state = `1303c31`).
> **Manifest:** `docs/autopilot-manifests/session-service-create-command-core.json`.
> **Verdict:** `NOT_CODE_READY` — four named blockers (§7), each with a binary resolution. This is an
> `enforce` evidence artifact, **not** a coding handoff. Do not register or open a worktree from it.

## 0. Task contract (level3-workflow §3)

```text
TASK_ID: plexco:session-service-create-command-core
OUTCOME (target): a SessionService CreateSession command exists and is the single write path for
  creating a draft session: validates input per spec edges, dedups by commandId via
  processed_commands, inserts via tenantRepo.sessions.create, and writes one session.created outbox
  event — all in ONE transaction. First real feature-layer service and first outbox producer.
REPOSITORY_AND_BASE: plexco-app @ origin/main. No base pinned for building — NOT_CODE_READY.
CONTEXT_SOURCES: docs/features/BE/feature_session_management_tech.md v2.22 (§1 commands, §2 edges
  1/2/3/7, §3 error codes, §4 events table `session.created` payload session_id/tenant_id/visibility);
  docs/features/FE/feature_session_management.md v2.25 (SES-UC-1, Bất biến);
  docs/issues/session-management-acceptance-checklist.md v1.2 (STALE sources — see B1);
  packages/db/src/tenant.ts (tenantRepo.sessions.create exists, comment says the command set grows
  here); packages/db/schema.ts (sessions 583, processedCommands 1296, outboxEvents 1308);
  docs/features/BE/feature_billing_lifecycle_tech.md §3 (Suspended Action Matrix — see B4);
  docs/autopilot/contracts/autopilot-db-job-claim-lease-core.md (outbox claim/ack contract — see B3).
APPLICABLE_SKILLS: none resident.
SCOPE (intended, not authorized): packages/db/src/session-service.ts (new — location per B2);
  packages/db/src/session-service.test.ts (new, real-PG); packages/db/src/index.ts (export);
  packages/db/src/tenant.ts ONLY if the command needs a repo method that does not exist yet;
  this contract + manifest + backlog block. ZERO migration, zero schema.ts change.
NEGATIVE_SCOPE: no PublishSession/Cancel/Close/Update/Delete (each is its own slice); no route/API/UI;
  no billing-contract edit (the action-class literal is a billing slice — B4); no waitlist/join/player
  logic; no projector/dispatcher change (schedule stays OFF; rows may accumulate unclaimed); no
  channel adapter; no edit to migrations or schema.ts.
RISK: P2 — no money mutation (draft has no charges), no PII surface, no external input; P0/P1 rules
  untouched. RLS choke-point honored by construction (tenantRepo only).
AUTONOMY_MODE: supervised
MODEL_POLICY: planner=primary-agent; worker=assigned-agent; reviewer=scripts/codex-review-pin.sh
  (2 clean code rounds; security round NOT required unless review finds a trust-boundary touch).
SANDBOX_AND_PERMISSIONS: network none; secrets none; external side effects none.
HUMAN_DECISIONS_REQUIRED: B4 (suspension-gate class for create) unless the billing contract already
  answers it at authoring-verify time.
SLICE_GRAPH: root of the Session BE vertical. Depends only on merged substrate (schema 0002+,
  processed_commands, outbox 0022/0023, tenantRepo). Runs PARALLEL-SAFE with chat slices (0 migration,
  no shared files) — M2 constraint honored. Blocks: session-service-publish (next), routes, projector.
WORKTREE_PLAN: none until CODE_READY. Then 1 branch/worktree/writer, base pinned from verified main.
VERIFICATION (when built): pnpm test with DATABASE_URL_TEST (real PG); focused: session-service tests
  + rls-invariants unchanged-green; build/lint/typecheck; no e2e (no boundary crossed).
CODE_REVIEW: required — 2 clean rounds via scripts/codex-review-pin.sh.
SECURITY_REVIEW: not preplanned (no auth/secret/money/external-input); escalate if review disagrees.
BUDGETS: ≤300 changed LOC, ≤3 modules (M2 cap); fix_rounds_max 5.
STOP_CONDITIONS: any migration appears in the diff · any route/UI file appears · billing files appear ·
  budget exceeded without owner amendment · reviewer unavailable → HALT TOOL_UNAVAILABLE.
DELIVERABLES (when unblocked): service + tests green on real PG, 2 clean review rounds, backlog flip,
  merged_probe = session-service.ts :: createSession.
```

## 1. Why this slice, why now

M2 names Session Management the lowest unbuilt node with a closed contract (publish/draft-lifecycle
closed 23–24/07; `0024` DB invariant landed; **0 SessionService, 0 routes**). The M2 instruction is
explicit: author the first slice as **service-only (0 migration)** so it can run parallel with chat
lanes without colliding on the migration tail. `CreateSession` is the root command: every other
session command mutates a row this one creates. `tenantRepo.sessions.create` already exists as a thin
repo method with a comment reserving exactly this growth path; `processed_commands` and the
0022/0023 outbox substrate are merged and code-dark — this slice is the first producer.

## 2. Mechanism (what gets built, exactly)

One exported service function (name pinned at build: `createSession`), executing inside a single
`withTenant` transaction:

1. Trusted context in: `(db, tenantId, actorContext, commandId, input)`. Tenant id is injected by the
   caller boundary, never parsed from input (Bất biến, FE spec).
2. **Dedup first** (edge #3): look up `processed_commands` by `(tenant_id, command_id)`; hit → return
   stored result envelope, zero mutation.
3. **Validate** (slice subset): `ends_at > starts_at` (edge #1, BL-DATA-1); `sport_id` in active
   taxonomy (edge #2); `visibility='public'` requires sport, area, starts_at and **finite**
   `slots_max > 0` (edge #7 / E#7 — DB CHECK `0024` is the invariant, service returns the typed error
   before hitting it); price ≥ 0. Typed errors per BE §3 (`MISSING_DISCOVERY_FIELDS`, 400 envelope
   via packages/core `api-contract` codes — map at build).
4. **Suspension gate:** per B4 — shape decided before build, not invented during it.
5. **Insert** via `tenantRepo.sessions.create` (status `draft` default — SES-UC-1).
6. **Outbox:** one `session.created` row (payload exactly `session_id`, `tenant_id`, `visibility` —
   BE §4 events table:507) in the same transaction; sequence per B3.
7. Record `processed_commands` result; commit; return envelope.

Dispatcher schedule stays OFF — rows accumulate unclaimed by design; that is the documented state of
the job substrate and is not this slice's problem to change.

## 3. What is already proven (measured 2026-08-13)

- `sessions` (schema.ts:583), `processedCommands` (:1296), `outboxEvents` (:1308) all live on main.
- `tenantRepo.sessions.create/list/getById` exist (tenant.ts:61-107) with tenant injection.
- `authorizeTenantAction(tx, tenantId, actionClass)` merged (authorization.ts:91), 0 callers.
- 813 tests green at the 0032 gate; harness requires DATABASE_URL_TEST.
- Billing Suspended Action Matrix (billing tech §3): `Admin mutation | active ✅ | past_due ✅ |
  suspended ❌` — row exists; **no action-class literal for it** (only `'publish_new_sessions'`).

## 4–6. Acceptance direction (to be completed at B1 resolution)

Slice-local acceptance matrix = create-related rows of the checklist re-traced to FE v2.25 / BE v2.22
+ spec edges #1/#2/#3/#7 + dedup-replay + outbox-exactly-once + RLS isolation (create in tenant A
invisible to tenant B). Exact expected assertions are the B1 deliverable — enumerated before code,
per gate G4.

## 7. Verdict — canonical block

```text
REVIEW_POLICY_VERSION: 1.3
REVIEW_VERDICT: NOT_CODE_READY
REVIEWED_AT: 2026-08-13
AUTHORITY_SHA: 775cb9eefc593df2d30684e48899709af55fe50e
BASE_BRANCH: main
TARGET_FILES:
  - docs/autopilot/contracts/autopilot-session-service-create-command-core.md
  - docs/autopilot-manifests/session-service-create-command-core.json
  - docs/autopilot-backlog.md
SLICE: session-service-create-command-core
IN_SCOPE: the CreateSession command boundary as one service function in one transaction — dedup lookup
  in processed_commands, validation subset (edges 1/2/7), tenantRepo.sessions.create insert, one
  session.created outbox row (payload session_id/tenant_id/visibility), processed_commands result;
  plus its real-PG test file, index.ts export, and this packet's own files.
OUT_OF_SCOPE: publish/cancel/close/update/delete commands; any route/API/UI; any billing file (the
  action-class literal is a billing slice); any migration or schema.ts change; projector/dispatcher/
  schedule; waitlist/join/player/charge logic; channel adapters.
G1_DECISION: FAIL
G2_SPEC: PARTIAL
G3_DEPENDENCY: FAIL
G4_TEST: FAIL
G5_SCOPE: PARTIAL
G6_EXTERNAL: PASS
HARD_DEPENDENCIES: none unmerged today — sessions/processed_commands/outbox substrate,
  tenantRepo.sessions.create and authorizeTenantAction are all on main (verified 2026-08-13, §3).
  CONDITIONAL: if B4 resolves to branch (a), the billing action-class docs slice becomes a hard
  dependency and must be added to the manifest before the verdict flips.
PRIOR_SLICES: none — this is the root slice of the Session BE vertical (M2).
OPEN_QUESTIONS_IN_SCOPE: 4
ENABLEMENT_ONLY_GATES: none
LIVE_REPO_VERIFICATION: PASS
CONTRACT_MATRIX: PARTIAL
CLOSURE_MATRIX: FAIL
ACCEPTANCE_MATRIX: FAIL
SECURITY_AND_MIGRATION_GATE: PASS
IMPLEMENTATION_ARTIFACTS: FAIL
FIRST_IMPLEMENTATION_STEP: blocked — do not register or open a worktree. The next step is the S1
  authoring session (next-lanes 2026-08-13): resolve B1-B4, run closure matrix 12/12, flip the marker
  to code-ready with a strict CODE_READY block, then author the runtime manifest.
REMAINING_BLOCKERS:
  - blocker: B1 (G4/G2) — slice-local acceptance matrix not extracted; the checklist v1.2 traces spec
    versions P v2.17 / T v2.18a while current files are FE v2.25 / BE v2.22 (DD-104 strip +
    invite-friend pass), so every create-related row must be re-traced, and dedup-replay /
    outbox-exactly-once / cross-tenant-invisibility assertions enumerated.
    owner: S1 authoring session
    resolution: contract §6 lists the exact assertions verified against the CURRENT spec versions.
  - blocker: B2 (G5) — service module home unpinned; proposal packages/db/src/session-service.ts on
    the auth.ts precedent.
    owner: S1 authoring session
    resolution: TDD §3.2 read and cited — either it names the location (use it) or the precedent is
    recorded with the checked line.
  - blocker: B3 (G3) — outbox PRODUCER insert contract unpinned; outbox_agg_seq_uq demands a
    per-aggregate monotonic sequence and 0022/0023 authored only the consumer side. This slice is the
    first producer.
    owner: S1 authoring session
    resolution: the exact insert shape including sequence derivation is written into §2 step 6, citing
    the db-job-claim-lease-core contract and the 0022 header.
  - blocker: B4 (G1) — suspension gate for CreateSession undecided: billing matrix row 'Admin
    mutation | suspended blocked' exists with no action-class literal for create (only
    publish_new_sessions); DD-104 D2a set the narrow-per-op-class precedent and D4a the ordering.
    owner: owner (one line) or the billing-contract docs slice
    resolution: recorded in decisions.md as either (a) narrow class added to the billing contract
    first, with that slice added here as a hard dependency, or (b) create-draft pinned ungated with
    written rationale (drafts invisible; publish is the gated boundary).
NEXT_REVIEW_TRIGGER: the S1 authoring session (next-lanes-2026-08-13-RUN.md) resolves B1-B4 —
  B1-B3 are read-and-pin within one session, B4 may need one owner line — completes closure matrix
  12/12 and flips this packet to strict CODE_READY. AP-51 precedent (NOT_CODE_READY 08-10 ->
  CODE_READY 08-11) is the intended shape.
```
