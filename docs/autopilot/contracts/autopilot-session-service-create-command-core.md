<!-- review-readiness: code-ready -->

# session-service-create-command-core — task contract

> **Slice:** `session-service-create-command-core` (slug = mechanism: the `CreateSession` command
> boundary — trusted-context input → validation → `processed_commands` dedup → `tenantRepo` insert →
> `session.created` outbox row, one transaction, zero migration).
> **Risk:** P2 · **Change class:** code (service-only) · **Autonomy:** supervised.
> **Opened from:** M2 (`docs/sessions/2026-08-07-next-milestones.md` — Session BE vertical root).
> **Authored:** 2026-08-13 against `origin/main` @ `775cb9e` (docs-batch tip; runtime state = `1303c31`).
> **Manifest:** `docs/autopilot-manifests/session-service-create-command-core.json`.
> **Verdict:** `CODE_READY` at `a9fe5c0` — all four blockers (§7) resolved: B1 acceptance matrix
> re-traced to FE v2.25 / BE v2.22 (§4–6); B2 module home pinned `packages/db/src/session-service.ts`;
> B3 outbox producer insert contract pinned (§2 step 6); B4 suspension gate = owner-ratified
> draft-invisibility exemption (DD-105). This is a `code-ready` coding handoff — but this authoring pass
> did NOT register, open a worktree or write service code (the build session does that, per §7.2
> FIRST_IMPLEMENTATION_STEP).

## 0. Task contract (level3-workflow §3)

```text
TASK_ID: plexco:session-service-create-command-core
OUTCOME (target): a SessionService CreateSession command exists and is the single write path for
  creating a draft session: validates input per spec edges, dedups by commandId via
  processed_commands, inserts via tenantRepo.sessions.create, and writes one session.created outbox
  event — all in ONE transaction. First real feature-layer service and first outbox producer.
REPOSITORY_AND_BASE: plexco-app @ origin/main = a9fe5c0 (verified 2026-08-13). The build worktree
  re-verifies and pins its base from live main at register time.
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
HUMAN_DECISIONS_REQUIRED: none remaining — B4 resolved by owner 2026-08-13 (DD-105: create-draft
  ungated under the draft-invisibility exemption).
SLICE_GRAPH: root of the Session BE vertical. Depends only on merged substrate (schema 0002+,
  processed_commands, outbox 0022/0023, tenantRepo). Runs PARALLEL-SAFE with chat slices (0 migration,
  no shared files) — M2 constraint honored. Blocks: session-service-publish (next), routes, projector.
WORKTREE_PLAN: none until CODE_READY. Then 1 branch/worktree/writer, base pinned from verified main.
VERIFICATION (when built): pnpm test with DATABASE_URL_TEST (real PG); focused: session-service tests
  + rls-invariants unchanged-green; build/lint/typecheck; no e2e (no boundary crossed).
CODE_REVIEW: required — 2 clean rounds via scripts/codex-review-pin.sh.
SECURITY_REVIEW: not preplanned (no auth/secret/money/external-input); escalate if review disagrees.
BUDGETS: ≤440 changed LOC (OWNER-RATIFIED AMENDMENT #2 2026-08-13 — was ≤300, then ≤360; FINAL for
  this slice, see amendment notes below), ≤3 modules (M2 cap); fix_rounds_max 5.
STOP_CONDITIONS: any migration appears in the diff · any route/UI file appears · billing files appear ·
  budget exceeded without owner amendment · reviewer unavailable → HALT TOOL_UNAVAILABLE.
DELIVERABLES (when unblocked): service + tests green on real PG, 2 clean review rounds, backlog flip,
  merged_probe = session-service.ts :: createSession.
```

> **Budget amendment (owner-ratified 2026-08-13, DD-101 shape — measurement beats estimate):**
> `changed_loc_max` 300 → **360** for THIS slice only. Measured in-flight at 347 (service 176 + test
> 163 + index 8) with the overage driven entirely by codex round-1's required P1 concurrency fix
> (advisory-lock reserve + the "one wins, one dedup" concurrent test) plus the mandated
> acceptance-matrix coverage — not scope creep; the worker had already compacted 387 → 347.
> Rationale for not compressing to ≤300: the cut would fall on required test coverage (forbidden) or
> on the design-rationale comments (advisory-lock why, outbox producer rule, DD-105 boundary) that
> future session-command slices will copy from this ROOT slice — the wrong place to save 47 lines.
> **Boundary:** no automatic precedent; the ≤300/3-module cap stays for every other session slice;
> module cap and all other gates unchanged for this one.

> **Budget amendment #2 (owner-ratified 2026-08-13, DD-101 shape — FINAL for this slice):**
> `changed_loc_max` 360 → **440**. Codex round-2 raised two legitimate findings, both fixed and
> tested before this ratification: [P1] cross-command false replay on the shared
> `processed_commands` ledger — dedup keyed `(tenant, command_id)` blind-cast the stored result;
> fixed with a `command_type='CreateSession'` guard + full-shape `isStoredCreateResult()` check,
> fail-closed `COMMAND_ID_CONFLICT` (this is exactly the pattern every later command inherits from
> the ledger's FIRST consumer); [P2] integer validation gap — price/slots accepted
> fractional/overflow values through to raw DB errors; fixed with `Number.isInteger` + range
> [0, 2147483647] → typed `INVALID_PRICE`/`INVALID_SLOTS`. Honest LOC 413; both fixes converge on
> the two existing regions (dedup + validate), no spreading, no scope creep. Compressing to 360
> would cut the same rationale comments amendment #1 exists to keep — self-contradictory.
> **Convergence boundary:** 440 (~27 headroom over 413) is the LAST budget amendment for this
> slice. If a later round pushes past 440, that is a re-slice signal (split the mechanism or the
> test file into an authorized follow-up), NOT grounds for a third amendment.

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
4. **Suspension gate — NONE (owner-ratified, DD-105):** `createSession` does NOT call
   `authorizeTenantAction`. Creating a `draft` is exempt from the billing Suspended Action Matrix under
   the **draft-invisibility exemption** (DD-105): a draft is invisible until publish (never projected —
   TDD §3.8/§3.9, `feature_session_management_tech.md` §4 step 7 project-on-publish) AND money-free (a
   draft has no `players`/`charges` by design). The gated boundary is `PublishSession`
   (`publish_new_sessions`, ❌ when suspended) — a separate slice. The exemption is bounded to commands
   that are BOTH invisible-until-publish AND money-free; publish/announce/close/cancel/update-on-`open`
   (player-visible) or anything touching `charges` stays under the matrix with its own narrow per-op
   action class (DD-104 D2a precedent). This step is a no-op by design, not an omission.
5. **Insert** via `tenantRepo.sessions.create` (status `draft` default — SES-UC-1).
6. **Outbox (first producer — this slice defines the producer insert contract; no shared helper exists
   on `main`, verified 2026-08-13):** insert one `outbox_events` row in the SAME transaction, columns:
   `tenant_id` (context), `aggregate_type='session'`, `aggregate_id` = the new session id,
   `type='session.created'`, `payload = {session_id, tenant_id, visibility}` (BE §4 events:507); let
   `schema_version` default to 1 and `id`/`created_at` default, and leave
   `claimed_at`/`lease_expires_at`/`claim_token`/`acked_at` NULL (the available all-null shape that
   `outbox_events_lease_shape_chk` requires). **Per-aggregate `sequence` derivation (the reusable
   producer rule this slice establishes):** `sequence := COALESCE((SELECT MAX(sequence) FROM
   outbox_events WHERE aggregate_id = :sessionId), 0) + 1`, computed inside the writing transaction;
   `outbox_agg_seq_uq` UNIQUE (`aggregate_id`, `sequence`) is the final fence (allocator-under-lock +
   unique-constraint pair, same shape as DD-45a). For `CreateSession` this is deterministically **1**:
   the session id is freshly generated in this same transaction and has no prior `outbox_events` rows,
   so nothing can collide. The consumer (`claim_outbox_batch`, `autopilot-db-job-claim-lease-core.md`
   §4.2, `0022`) reads back `(event_id, tenant_id, aggregate_id, sequence, type)` — this producer
   supplies exactly those fields.
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

## 4–6. Slice-local acceptance matrix (B1 — enumerated before code, gate G4)

**Re-traced to the CURRENT specs `FE v2.25` / `BE v2.22`** (NOT the checklist's stale `P v2.17` /
`T v2.18a`). Every row below is an intent-faithful restatement of a specific line in the current
specs; expected results are pinned. `commandId`/`tenantId`/`actor` arrive from trusted context (never
from payload). The service runs one `withTenant` transaction; `visibility` defaults `private`,
`status` defaults `draft`, `version` = 1.

| # | Group | Input / precondition | Expected state / output | Test layer | Trace (FE v2.25 / BE v2.22) |
|---|---|---|---|---|---|
| A1 | Happy path | valid private create (sport active, `ends_at > starts_at`, price ≥ 0) | one `sessions` row `status='draft'`, `version=1`; **exactly one** `session.created` outbox row (`aggregate_type='session'`, `aggregate_id=session.id`, `sequence=1`, `payload={session_id,tenant_id,visibility}`); one `processed_commands` row; returns success envelope | real-PG unit | SES-UC-1; BE `U#1`; BE §4 events:507 |
| A2 | Happy path (public) | valid public create with sport + area + `starts_at` + finite `slots_max > 0` | draft, `visibility='public'`; outbox `payload.visibility='public'` | real-PG unit | E#7; BE#12 |
| B1 | Boundary | `ends_at <= starts_at` | `INVALID_TIME_RANGE` (400); **zero** mutation (no session / outbox / processed_commands row) | unit | E#1 / BL-DATA-1; BE §3; `U#2` |
| B2 | Boundary | `sport_id` not in the active sport taxonomy | `SPORT_INACTIVE` (400); zero mutation | unit | E#2; BE §3; `U#3` |
| B3 | Boundary | `visibility='public'` missing any of {sport, area, `starts_at`, finite `slots_max`} | `MISSING_DISCOVERY_FIELDS` (400) returned by the service **before** the `0024` DB CHECK fires; zero mutation | unit | E#7; BE#12; `U#9` |
| B4 | Boundary | `price_amount < 0` | rejected, zero mutation (service guard; DB CHECK `price_amount >= 0` is the final fence) | unit | BE §2 DDL:71; `U#38` |
| B5 | Boundary | `slots_max = 0` or negative | rejected (service typed error first; DB CHECK `slots_max IS NULL OR slots_max > 0` is the fence) | unit | BE §2 DDL:81 |
| C1 | Concurrency / **dedup-replay** | same `(tenant_id, command_id)` submitted twice | second call returns the **stored** result envelope; **zero** new `sessions` row, **zero** new `outbox_events` row, **zero** new `processed_commands` row (dedup via `processed_commands_tenant_cmd_uq`) | real-PG unit | edge #3; BE#3; `U#13` |
| OBS1 | **outbox-exactly-once** | one successful create, then a `commandId` replay | the successful create writes **exactly one** `session.created` row (`aggregate_id=session.id`, `sequence=1`); the replay writes **none**. `payload` is the whitelist `{session_id, tenant_id, visibility}` only — no roster/PII/venue | real-PG unit | BE §4 events:507; edge #3 |
| SEC1 | **cross-tenant-invisibility** | create in tenant A, then read as tenant B | the row is invisible to tenant B: `tenantRepo(B).sessions.list()`/`getById` return 0 rows (RLS `FORCE` via `withTenant` GUC). `tenant_id` is injected by `tenantRepo`, never read from input | real-PG unit + `rls-invariants.test.ts` unchanged-green | Bất biến (RLS choke-point); `U#18`; BE §4 Security Checklist |
| SEC2 | Security / trusted-context | `tenantId` non-UUID, or `tenant_id`/`actor` supplied in the payload | `assertTenantId` throws (never trusts payload); tenant/actor come from context only | unit | Bất biến; BE §1 / §4 |
| MIG1 | Migration | — | **NONE**: zero migration, zero `schema.ts` change; reuses merged substrate (`sessions` 0002, `processed_commands` + `outbox_events` 0005, lease/ack 0022/0023, `sessions_public_capacity_chk` 0024). A diff touching any migration or `schema.ts` is a STOP_CONDITION | asserted by scope gate | §0 NEGATIVE_SCOPE |
| REG1 | Regression | run the canonical db suite | `rls-invariants.test.ts` stays green (tenant isolation unchanged); the full db suite (813 at the 0032 gate) stays green | full db suite | canonical runner |
| OBS2 | Observability | successful create | canonical outbox `session.created` carries the identifiers; the surface analytics `session_created` (FE §5: `tenant_id`, `session_id`, `sport_id`, `visibility`, `source`) is emitted by the projector/route layer, out of this slice — this slice writes the canonical outbox row | trace only | FE §5; BE §1/§4 |

> **Authorization group (gate B2):** the non-admin **403** on create (BE#10 / `U#17`) is enforced by
> AuthZ middleware **before** the service, at the route layer — that is the later route slice, OUT of
> this service-only scope (§0 OUT_OF_SCOPE). The "wrong tenant" dimension is covered here by **SEC1**
> (RLS at the repo layer); role/capability authz is the route slice's responsibility. This is stated
> so G4 is honest about what the service tests can and cannot assert.

**B1 survival proof — the create rows survived BOTH passes (not assumed):**

- **DD-104 strip (FE changelog v2.25:875; BE header v2.22; decisions v2.27) removed ONLY DeleteSession
  content** — SES-UC-15, FE edges #27–#30, delete surfaces/analytics/state-transitions/permission row.
  It touched **no** create use-case, edge, or error code: SES-UC-1, E#1/#2/#7 and
  `INVALID_TIME_RANGE`/`SPORT_INACTIVE`/`MISSING_DISCOVERY_FIELDS` are byte-unchanged; the removed edge
  IDs were left blank, not renumbered, so the create edge numbers are stable.
- **The invite-friend pass (FE v2.21:879, "Additive-only — không đổi existing contract") added
  SES-UC-16/17/18 + edges #31–#38** (invite / guest-note / approve) with their own error codes; it did
  not alter create validation. The create-relevant BE DDL CHECKs (`ends_at > starts_at`,
  `price_amount >= 0`, `slots_max IS NULL OR slots_max > 0`, `sessions_public_capacity_chk`) are
  unchanged from `0002`/`0024`.

**B2 resolution — service module home = `packages/db/src/session-service.ts` (§0 SCOPE).** TDD **§3.2**
(Data Model, read 2026-08-13) names data-model tables, not a service-layer file; TDD §9 (Dependencies)
lists libraries only; §3.1/§3.6 say "PostgreSQL/domain services là canonical" and "CMD bus → Service →
tenantRepo". No TDD line pins a create-service file, so the **precedent** decides: the package's domain
services all live in `packages/db/src/` — `auth.ts` ("Auth/identity service", typed wrappers over the
0012 SECURITY DEFINER functions), `tenant.ts` (`tenantRepo`), `authorization.ts` (`authorizeTenantAction`).
`createSession` writes (`sessions` insert + `outbox_events` + `processed_commands`) inside one
`withTenant` transaction — all `packages/db` primitives — so `packages/db/src/session-service.ts` is
exactly on-precedent.

**B3 resolution — the outbox PRODUCER insert contract is pinned in §2 step 6** (this slice is the first
producer; no shared helper exists on `main`, verified 2026-08-13). It defines the reusable per-aggregate
`sequence` derivation and cites the consumer contract (`autopilot-db-job-claim-lease-core.md` §4.2,
`0022`) so `claim_outbox_batch`'s read-back of `(event_id, tenant_id, aggregate_id, sequence, type)`
lines up.

## 7. Closure matrix (12/12) + canonical verdict

### 7.1 Closure matrix — 12/12 PASS (re-run at the CODE_READY flip, `a9fe5c0`)

| # | Gate | Evidence | PASS/FAIL |
|---|---|---|---|
| 1 | Authority snapshot pinned by SHA | `git rev-parse HEAD` = `a9fe5c0…` (= `origin/main`); exact TARGET_FILES, no glob | PASS |
| 2 | In-scope decisions closed | B4 = **DD-105** (owner 2026-08-13, ungated draft-invisibility exemption); no product choice left on the create path | PASS |
| 3 | Scope IN/OUT + owner clear | §0 SCOPE / NEGATIVE_SCOPE; mechanism-named (`CreateSession` boundary); one writer | PASS |
| 4 | Dependency classified | all MERGED: `sessions` (0002), `processed_commands` + `outbox_events` (0005), lease/ack (0022/0023), `sessions_public_capacity_chk` (0024), `tenantRepo.sessions.create` (tenant.ts:82-102); B4→(b) adds **none** | PASS |
| 5 | Live schema/code matches doc | verified at `a9fe5c0`: schema.ts:583/1296/1308-1345, tenant.ts:41-105, authorization.ts:91-136, 0005_sync_engine.sql:21-35 | PASS |
| 6 | Data/API/state/auth contract complete | §2 mechanism, §4–6 acceptance matrix, outbox producer insert (B3, §2 step 6), error codes (BE §3) | PASS |
| 7 | Fail-closed / idempotency / order pinned | dedup-first (edge #3), typed errors before DB CHECK, per-aggregate `sequence` + `outbox_agg_seq_uq` fence, RLS by construction | PASS |
| 8 | In-scope open questions = 0 | B1–B4 resolved; SES-OQ-2 (recurrence-edit) / timezone-input (checklist §9-A) are NOT on the create path | PASS |
| 9 | Acceptance matrix has expected results | §4–6 rows A1..OBS2, each with expected state/output + test layer | PASS |
| 10 | Migration / security / rollback pinned | zero migration (STOP_CONDITION guards it); security = cross-tenant RLS invariant pre-specified (SEC1); rollback = delete the two new files | PASS |
| 11 | First slice hard deps merged | root slice of the Session BE vertical; all substrate merged + verified | PASS |
| 12 | Implementation handoff ready | authored contract (this file) + authored manifest + backlog block, mutually consistent; runtime manifest authored at register (first build step) | PASS |

### 7.2 Verdict — canonical block

```text
REVIEW_POLICY_VERSION: 1.3
REVIEW_VERDICT: CODE_READY
REVIEWED_AT: 2026-08-13
AUTHORITY_SHA: a9fe5c0b8b8731dff1ca8e688eea43c8b724dc2f
BASE_BRANCH: main
TARGET_FILES:
  - docs/autopilot/contracts/autopilot-session-service-create-command-core.md
  - docs/autopilot-manifests/session-service-create-command-core.json
  - docs/autopilot-backlog.md
  - docs/standards/decisions.md
SLICE: session-service-create-command-core
IN_SCOPE: the CreateSession command boundary as one service function in one transaction — dedup lookup
  in processed_commands, validation subset (edges 1/2/7), tenantRepo.sessions.create insert, one
  session.created outbox row (payload session_id/tenant_id/visibility), processed_commands result;
  plus its real-PG test file, index.ts export, and this packet's own files.
OUT_OF_SCOPE: publish/cancel/close/update/delete commands; any route/API/UI; any billing file (the
  action-class literal is a billing slice); any migration or schema.ts change; projector/dispatcher/
  schedule; waitlist/join/player/charge logic; channel adapters.
G1_DECISION: PASS
G2_SPEC: PASS
G3_DEPENDENCY: PASS
G4_TEST: PASS
G5_SCOPE: PASS
G6_EXTERNAL: PASS
HARD_DEPENDENCIES: none — root slice. sessions/processed_commands/outbox substrate (0002/0005/0022/
  0023/0024), tenantRepo.sessions.create (tenant.ts:82-102) and authorizeTenantAction (authorization.ts:91)
  are all merged on main, verified 2026-08-13 at a9fe5c0. B4 resolved to the ungated draft-invisibility
  exemption (DD-105), so NO billing docs slice is a dependency.
PRIOR_SLICES: none — this is the root slice of the Session BE vertical (M2).
OPEN_QUESTIONS_IN_SCOPE: 0
ENABLEMENT_ONLY_GATES: none
LIVE_REPO_VERIFICATION: PASS
CONTRACT_MATRIX: PASS
CLOSURE_MATRIX: PASS
ACCEPTANCE_MATRIX: PASS
SECURITY_AND_MIGRATION_GATE: PASS
IMPLEMENTATION_ARTIFACTS: PASS
FIRST_IMPLEMENTATION_STEP: author the runtime manifest
  .autopilot/state/session-service-create-command-core/manifest.json from the authored manifest (schema
  level3-operational-v2), register it via scripts/autopilot-scope-gate, confirm
  .autopilot/state/session-service-create-command-core/registered-manifest.sha256 exists, open one worktree
  from verified main, then implement createSession in packages/db/src/session-service.ts per §2 mechanism +
  §4–6 acceptance matrix (validate -> dedup -> tenantRepo.sessions.create -> one session.created outbox row
  -> processed_commands, one withTenant transaction) with session-service.test.ts on real PG.
REMAINING_BLOCKERS: none
```
