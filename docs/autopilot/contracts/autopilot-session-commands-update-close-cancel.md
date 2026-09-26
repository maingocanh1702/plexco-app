<!-- review-readiness: enforce -->

# session-commands-update-close-cancel — task contract

> **Slice:** `session-commands-update-close-cancel` (slug = mechanism: the remaining SessionService
> command boundaries — `UpdateSession`, `CloseSession`, `CancelSession` (and `AnnounceSession` if it
> fits budget) — built on top of S2's `session-service.ts` (`b48625c`, on base), each command giving
> `authorizeTenantAction` its first production caller via a **narrow per-op action class**).
> **Risk:** P2 · **Change class:** code (service + billing-authz contract) · **Autonomy:** supervised.
> **Opened from:** P-C / L4 (DD-104 D2a) — the Session BE vertical continuation after S2 (CreateSession).
> **Authored:** 2026-08-14 against `main` @ `519fb9f91fffe4712668f24a1af697d5f1a002bd`.
> **Manifest:** `docs/autopilot-manifests/session-commands-update-close-cancel.json`.
> **Verdict:** **`NOT_CODE_READY`** at `519fb9f…`. One class of blocker gates ALL candidate ops:
> each of Update/Close/Cancel/Announce is player-visible/roster/money (DD-105 excludes them from the
> draft-invisibility exemption) and therefore needs a **narrow per-op suspension action-class literal**
> in `authorizeTenantAction` + the billing Suspended Action Matrix — a literal that **NO decision
> record names**. DD-105 pins the DIRECTION ("mỗi cái một class hẹp khi build") and DD-104 D2a names
> only `delete_draft_session` (a different, out-of-scope op). Minting a NEW money-gate action-class
> value is a Tier-C billing-contract decision reserved for the owner (DD-105: for a different session
> command "the author must come back here + DD-104 D2a to get the narrow class"). An honest
> `NOT_CODE_READY` with a named binary blocker is the correct outcome for this packet — see §7. This is
> an AUTHORING pass only: it did NOT register, open a worktree, run codex, or edit the backlog.

## 0. Task contract (level3-workflow §3)

```text
TASK_ID: plexco:session-commands-update-close-cancel
OUTCOME (target): the remaining session commands — UpdateSession (field mutation + optimistic
  expected_version), CloseSession (open->closed), CancelSession (draft|open->cancelled) and, if budget
  allows, AnnounceSession — exist as SessionService command functions on S2's CreateSession pattern.
  Each PLAYER-VISIBLE/roster/money command re-checks tenant suspension under lock via
  authorizeTenantAction(tx, tenantId, <narrow-per-op-class>), giving that choke-point (merged ddb69a9,
  0 production callers for 8+ days) its first production caller. BLOCKED: the per-op action-class
  literal is undefined (Tier C).
REPOSITORY_AND_BASE: plexco-app @ main = 519fb9f91fffe4712668f24a1af697d5f1a002bd (verified 2026-08-14
  via git rev-parse HEAD). The build worktree re-verifies and re-pins its base from live main at
  register time — once the blocker is resolved.
CONTEXT_SOURCES: docs/standards/decisions.md DD-105 (:1940-1983, suspension exemption boundary) +
  DD-104 D2a (:1524-1527, delete_draft_session precedent); docs/features/BE/feature_session_management_tech.md
  v2.22 (§1 commands :25; entry points :38-42; edges #4/#5/#25-31; §3 error codes; §4 algorithms for
  cancel :548-559; §4 events table :508-513); docs/features/FE/feature_session_management.md v2.25
  (SES-UC-4/5/6/13/14 :65-75); docs/features/BE/feature_billing_lifecycle_tech.md §3 (Suspended Action
  Matrix :269-278, Concurrency :329, action-class literals); packages/db/src/session-service.ts (S2 —
  the CreateSession pattern, validateInput/dedup/outbox helpers to reuse); packages/db/src/authorization.ts
  (:25 ActionClass = {publish_new_sessions, admin_mutation, integration_changes}; :98-100 unknown class
  → fail-closed DENY); packages/db/src/tenant.ts (:65 tenantRepo.sessions = list/getById/create — no
  update path); packages/db/schema.ts (sessions status enum); autopilot-session-service-create-command-core.md
  (the precedent this mirrors).
APPLICABLE_SKILLS: none resident.
SCOPE (intended, NOT authorized): packages/db/src/session-service.ts (new command fns on S2 pattern);
  packages/db/src/session-service.test.ts (extend, real-PG); packages/db/src/authorization.ts (add the
  owner-named per-op action-class literal(s) to ActionClass + RECOGNIZED_ACTION_CLASSES);
  packages/db/src/index.ts (export new fns); docs/features/BE/feature_billing_lifecycle_tech.md (add the
  per-op class row(s) to the Suspended Action Matrix — the DD-104 D2a "sửa contract billing" shape);
  this contract + manifest + backlog block. ZERO migration, ZERO schema.ts change.
NEGATIVE_SCOPE: no CreateSession change (S2's, done); no PublishSession re-gate (publish_new_sessions
  wired); no DeleteSession (parked behind DD-104 slice); NO action-class literal INVENTED by the author
  (owner supplies the name — Tier C); no change to the DD-105 exemption principle or to the billing
  fail-closed resolution / FOR SHARE ordering; no route/API/UI; no migration/schema.ts; no
  projector/dispatcher/schedule; no refund/settlement engine (emit the event + honor review_policy gate,
  do NOT move money here).
RISK: P2 — no NEW money mutation in this slice (charges disposition stays with payments/waitlist slices),
  but it DOES edit the tenant-suspension trust boundary (authorizeTenantAction) → security review REQUIRED
  when authorized. RLS choke-point honored by construction (tenantRepo / withTenant only).
AUTONOMY_MODE: supervised
MODEL_POLICY: planner=primary-agent; worker=assigned-agent; reviewer=scripts/codex-review-pin.sh
  (2 clean code rounds + 1 security round — the billing-authz gate edit is a trust boundary).
SANDBOX_AND_PERMISSIONS: network none; secrets none; external side effects none.
HUMAN_DECISIONS_REQUIRED: ONE, and it blocks the whole slice — the owner must NAME the narrow per-op
  suspension action-class literal(s) for the player-visible session commands (e.g. a value like
  'update_session' / 'close_session' / 'cancel_session' / 'announce_session', or a decision to reuse an
  existing class), added to the billing contract + authorizeTenantAction (DD-104 D2a shape). Until then
  the slice is NOT_CODE_READY (see §7 REMAINING_BLOCKERS).
SLICE_GRAPH: depends on S2 (session-service-create-command-core, MERGED b48625c). Depends on a NEW
  billing-authz contract decision (the per-op action-class — currently OPEN, Tier C). Blocks: the
  session route/API slice; the marketplace projection consumers of session.updated/closed/cancelled.
WORKTREE_PLAN: none — slice is NOT_CODE_READY. When unblocked: 1 branch/worktree/writer, base re-pinned
  from verified main; serialize on the billing-authz invariant token against any other authz lane.
VERIFICATION (when built): pnpm test with DATABASE_URL_TEST (real PG); focused: session-service tests +
  rls-invariants unchanged-green; build/lint/typecheck; no e2e (no route boundary). Security round on
  the authorizeTenantAction edit.
CODE_REVIEW: required — 2 clean rounds via scripts/codex-review-pin.sh.
SECURITY_REVIEW: REQUIRED (trust boundary: the tenant-suspension gate gains new recognised action
  classes). Not void-able — the trigger is definite. Run one security-focused codex round through the
  pinned wrapper in addition to the 2 code rounds.
BUDGETS: ~360 compact LOC (estimate, NOT calibrated — re-pin after the acceptance matrix, basis pinned
  up front, per the S2 process lesson), ≤3 modules (session-service.ts + authorization.ts + billing
  spec), fix_rounds_max 5. Budget is a SIGNAL (DD-107 / §6.1): overrun → re-slice to the ready subset,
  never a budget-amendment round-trip.
STOP_CONDITIONS: any migration/schema.ts in the diff · any route/UI file · the billing action-class edit
  changing anything beyond the owner-named class value(s) + matrix row(s) · the author about to INVENT a
  class name → HALT (the exact Tier-C blocker) · budget exceeded → re-slice · reviewer unavailable →
  HALT TOOL_UNAVAILABLE.
DELIVERABLES (when unblocked): the command functions + real-PG tests green, 2 clean code rounds + 1
  security round, backlog flip, merged_probe = session-service.ts :: cancelSession.
```

## 1. Why this slice, why now — and why it is blocked

S2 (`CreateSession`) landed the root of the Session BE vertical: the first feature-layer service and
first outbox producer. The natural continuation is the remaining session commands — Update / Close /
Cancel (and Announce). Each is a state or field mutation on a session S2's `createSession` produced.

The packet's stated draw is that these commands give `authorizeTenantAction` (merged `ddb69a9`, **0
production callers** on base — confirmed HANDOFF LIVE TRUTH) its **first production caller**. That is
precisely where the block is. DD-105 ruled that `CreateSession` is exempt from the suspension gate
(draft-invisibility), but it drew an explicit HARD BOUNDARY: `PublishSession` / `AnnounceSession` /
`CloseSession` / `CancelSession` / `UpdateSession`-when-`open` are **player-visible or touch
roster/money** and each "gets a **narrow per-op action class when built**" (decisions.md:1972-1983).
DD-105 names the *direction*; it names **no literal**. DD-104 D2a — the precedent DD-105 points at —
names exactly **one** literal, `delete_draft_session`, for `DeleteSession`, which this slice does not
implement.

So the first production caller of `authorizeTenantAction` cannot be written until the owner mints the
per-op action-class value(s) in the billing contract + `authorizeTenantAction`. Per the demotion rule
(plexco-level3-autonomy.md §6.1), a change a DD authorizes **by name (artifact AND change)** is Tier
A; "a DD that says 'we should improve X' authorizes nothing." DD-105 approves the direction only →
this is **not** demoted → it stays **Tier C item #1** (new/changed money/billing contract). This is a
correct `NOT_CODE_READY`, not a failure of authoring.

## 2. Mechanism (what would get built, once unblocked)

Each command is an exported SessionService function inside one `withTenant` transaction, on S2's
pattern (advisory-lock reserve → dedup via `processed_commands` → validate → mutate → outbox → record
result). The three player-visible mutations additionally re-check suspension **under lock** exactly as
publish does (billing §3 Concurrency + `feature_session_management_tech.md` §4 step 6): re-evaluate
`authorizeTenantAction(tx, tenantId, <per-op-class>)` inside the same transaction holding the session
`FOR UPDATE` lock, immediately before mutating, via the `FOR SHARE` locking read the resolver already
performs — a wrong ALLOW here lets a suspended tenant mutate a live/money session (tie-break #1
fail-closed).

- **UpdateSession** (`PATCH /api/sessions/:id`, SES-UC-4, `session.updated`): mutate fields with
  optimistic `expected_version` (`STALE_VERSION` on mismatch). Price/capacity changes with existing
  charges gate on `PRICE_CHANGE_REQUIRES_POLICY` / `CAPACITY_BELOW_ROSTER` (edge #4/#5 — touches
  `charges`). Player-visible on `open`. **Needs a suspension class — UNNAMED.**
- **CloseSession** (`POST /api/sessions/:id/close`, SES-UC-5, `session.closed`): `open`→`closed`,
  public projection removed, no new joins. Player-visible; paid roster → `review_policy` (edge #5).
  **Needs a suspension class — UNNAMED.**
- **CancelSession** (`POST /api/sessions/:id/cancel`, SES-UC-6/13/14, `session.cancelled`): **one
  command, two sources** — `draft` (discard, verify `players`/`charges` empty under lock, anomaly →
  `CANCEL_REQUIRES_REVIEW`, edge #28) OR `open` (cancel, roster/paid-impact + `review_policy`).
  `expected_version` mandatory on the mutate branch (edge #26). The `open` source is player-visible and
  money-touching. **Needs a suspension class — UNNAMED.** (The draft source ALONE would fit DD-105, but
  the command is spec'd as one unit accepting both — see §4 B4.)
- **AnnounceSession** (`POST /api/sessions/:id/announce`, SES-UC-3, `session.announcement_requested`): notification
  to a linked group; no status transition, no roster/money. Money-free but player-visible. Whether it
  even needs a suspension class is itself a contract question (it is not in the matrix) — DD-105 lists
  it as needing "a narrow class when built". Cheapest; only if budget allows.

Dispatcher schedule stays OFF; rows accumulate unclaimed by design.

## 3. What is already proven (measured 2026-08-14 at `519fb9f`)

- **S2 MERGED:** `packages/db/src/session-service.ts` on base exports `createSession`,
  `SessionCommandError`, `validateInput`, `isStoredCreateResult` (squash `b48625c`, ancestor of base;
  `git merge-base --is-ancestor b48625c 519fb9f` → true). Backlog `session-service-create-command-core`
  = `status: merged`. → the code dependency (G3) is satisfied; no live-writer conflict.
- **`authorizeTenantAction`** (authorization.ts:91) recognises exactly `{publish_new_sessions,
  admin_mutation, integration_changes}` (`ActionClass` :25, `RECOGNIZED_ACTION_CLASSES` :27); an
  unrecognised class fail-closes to `DENY` (:98-100). Comment :20-24: recognising a NEW class "is a
  future slice's decision once a real caller exists."
- **billing Suspended Action Matrix** (feature_billing_lifecycle_tech.md:269-278): rows `Admin
  mutation`, `Integration changes`, `Publish new sessions` (`active ✅ / past_due ✅ / suspended ❌`).
  Only `publish_new_sessions` is session-op-specific (:208, :275, :463-464). **No update/close/cancel/
  announce row.**
- **sessions status enum** already `('draft','open','closed','cancelled')` (schema + migration 0002) —
  every target status exists; **no migration** needed. Outbox `type` is free-text — no enum, no
  migration for `session.updated/closed/cancelled/announced`.
- **`tenantRepo.sessions`** = `list`/`getById`/`create` only (tenant.ts:65) — an update write path is a
  service-layer addition (build-time Tier-B choice), not a migration.
- **candidate literals absent on base** (grep whole tree at `519fb9f`, 0 files each): `updateSession`,
  `closeSession`, `cancelSession`, `announceSession`, `update_session`, `close_session`,
  `cancel_session`, `announce_session`. Control probe `isStoredCreateResult` → 1 file (query engine
  works).

## 4. Blocker analysis (the closure-matrix failures, enumerated)

**B1 — the per-op suspension action-class literal is UNNAMED for every candidate op (Tier C).** DD-105
(decisions.md:1972-1983) names the four ops and rules each "gets a narrow per-op action class when
built", pointing at DD-104 D2a as the HOW. DD-104 D2a (decisions.md:1524-1527) names only
`delete_draft_session`. `grep -oE "'(create_session|update_session|close_session|cancel_session|
announce_session|publish_new_sessions|delete_draft_session)'" decisions.md` → EMPTY for all four ops.
`authorizeTenantAction` fail-closes on an unrecognised class, so a command cannot simply call the gate
with a made-up literal. **Owner decision required:** the exact per-op class name(s) (or an explicit
ruling to reuse an existing class), added to the billing contract + `authorizeTenantAction`. Reusing
`publish_new_sessions` (semantically "publish NEW sessions", billing :275) or the broad `admin_mutation`
both CONTRADICT DD-105's "narrow per-op class" and silently widen the money-gate contract — rejected
(DECISIONS.md D4). This blocks Update, Close, Cancel-on-`open`, and Announce.

**B2 — G6 external/security gate is not clear for code.** This slice edits the tenant-suspension trust
boundary (`authorizeTenantAction` gains new recognised classes). That is a security-sensitive change:
a mis-scoped class value is a wrong-allow on the money/tenant path. G6 needs the named security round
scoped — but the round cannot be specified until B1 fixes the class contract. Not `ENABLEMENT_ONLY`
(it changes dark runtime behavior: which mutations a suspended tenant can perform).

**B3 — CancelSession cannot ship as a draft-only self-contained subset (Tier C, re-slice).** SES-UC-13
(draft discard) alone IS invisible-until-publish + money-free and would fit DD-105 exactly — but the
spec defines ONE `CancelSession` command accepting BOTH `draft` and `open`
(feature_session_management_tech.md:25, :40, edge #25, algorithm :548-559 branches on source INSIDE one
command). Shipping a draft-only stub that a later slice must re-open to add the `open`/money branch
means the first slice's shape is wrong (the "deferred money-gap" anti-pattern). A draft-source-only
CancelSession slice IS a legitimate re-scope — but that is a NEW owner-scoped slice, not something this
packet self-authorizes (Tier C item #7: never widen/re-draw the declared command silently). See §7
recommendation.

**These are the only blockers.** Everything else is green or Tier A: the code dependency (S2) is
merged (G3 for the code); the specs are Reviewed with acceptance surfaces (G2); zero migration (schema
enum + free-text outbox already exist); the module home is on-precedent (`packages/db/src`); the
mechanism is derivable from the specs + S2 pattern.

## 5. Slice-local acceptance matrix (drafted; gated behind B1 — not yet a G4 PASS)

Enumerated so the matrix is ready the day the class contract lands. `commandId`/`tenantId`/`actor`
arrive from trusted context; each command runs one `withTenant` transaction; `expected_version` guards
lost updates.

| # | Group | Command | Input / precondition | Expected state / output | Test layer | Trace |
|---|---|---|---|---|---|---|
| U1 | Happy | Update | valid field change on `open`, correct `expected_version`, tenant active | fields mutated; `version` bump; one `session.updated` outbox (`fields_changed[]`); `processed_commands` row | real-PG | SES-UC-4; §4 events:509 |
| U2 | Boundary | Update | `expected_version` mismatch/missing | `STALE_VERSION` (409); zero mutation | unit | edge #26 |
| U3 | Money | Update | reduce `slots_max` below active roster | `CAPACITY_BELOW_ROSTER` (409); zero mutation | real-PG | edge #5; §3 |
| U4 | Money | Update | price change with existing charges | `PRICE_CHANGE_REQUIRES_POLICY` (400) unless `impact_policy` given; zero mutation | real-PG | edge #4; §3 |
| U5 | **Suspend** | Update | tenant billing-`suspended` (open session) | `TENANT_SUSPENDED` (403) via `authorizeTenantAction(tx, tenantId, <per-op-class>)` re-checked UNDER LOCK; zero mutation | real-PG | **BLOCKED B1**; billing §3 |
| CL1 | Happy | Close | `open`→`closed`, tenant active | `status='closed'`; `version` bump; one `session.closed` (`close_reason='manual'`); projection-removal is the projector's job (out of scope) | real-PG | SES-UC-5; §4 events:511 |
| CL2 | Boundary | Close | close a non-`open` session (draft/closed/cancelled) | `SESSION_NOT_OPEN` (409); already-closed → idempotent no-op | unit | edge #11/#27 |
| CL3 | **Suspend** | Close | tenant `suspended` | `TENANT_SUSPENDED` (403) UNDER LOCK; zero mutation | real-PG | **BLOCKED B1** |
| CA1 | Happy (draft) | Cancel | source `draft`, `players`/`charges` empty under lock, `expected_version` ok | `status='cancelled'`; `version` bump; one `session.cancelled` (`cancel_reason='manual'`, `roster_count=0`, `has_paid=false`) | real-PG | SES-UC-13; edge #25; §4:548-559 |
| CA2 | Data-integrity (draft) | Cancel | source `draft` carrying anomalous `players`/`charges` | `CANCEL_REQUIRES_REVIEW` (400); zero mutation; one `session.expiry_anomaly_detected` (`anomaly_fields[]`, no roster/amount) | real-PG | edge #28; §4 events:513 |
| CA3 | Happy (open) | Cancel | source `open`, roster/paid-impact preview + review_policy honored, `expected_version` ok | `status='cancelled'`; `version` bump; one `session.cancelled` (`roster_count`, `has_paid`); refund disposition delegated | real-PG | SES-UC-6; edge #5 |
| CA4 | Boundary | Cancel | already-`cancelled` (either source) | idempotent no-op, `version` unchanged, no duplicate event, `expected_version` NOT required on no-op | unit | edge #27 |
| CA5 | **Suspend** | Cancel (open) | tenant `suspended`, source `open` | `TENANT_SUSPENDED` (403) UNDER LOCK; zero mutation | real-PG | **BLOCKED B1** |
| AN1 | Happy + guard | Announce | announce an `open` session, tenant active | if `ends_at > now()`: one canonical announcement ref + one `session.announcement_requested` outbox (`channel`); no status change; no roster/money. If `ends_at <= now()` (auto-expiry not built, so the row stays `open`): `SESSION_ALREADY_ENDED` (409), zero mutation (DD-111 D1/D2) | real-PG | SES-UC-3; §4 events:514; DD-111 |
| SEC1 | cross-tenant | all | mutate as tenant B a session in tenant A | invisible/denied via RLS `FORCE` (withTenant GUC); `tenant_id` injected, never from payload | real-PG + rls-invariants unchanged-green | Bất biến |
| DED1 | dedup-replay | all | same `(tenant_id, command_id)` twice | second returns stored envelope, zero new mutation (shared `processed_commands` ledger, S2 pattern; foreign command_type → `COMMAND_ID_CONFLICT`) | real-PG | edge #3; S2 |
| MIG1 | Migration | — | — | NONE: zero migration, zero schema.ts; reuses status enum (0002) + free-text outbox `type` | scope gate | §0 |
| REG1 | Regression | — | canonical db suite | rls-invariants + full db suite stay green | full db suite | canonical runner |

Rows **U5 / CL3 / CA5** (the suspension re-checks) cannot be authored to a PASS because the
`<per-op-class>` literal they call does not exist (B1). That is why G4 is `PARTIAL` and the verdict is
`NOT_CODE_READY`.

## 6. Tier classification of every open question (plexco-level3-autonomy.md §6.1)

| Question | Tier | Disposition |
|---|---|---|
| Module home for the command fns | **A** | `packages/db/src/session-service.ts` (precedent = S2 + auth.ts/authorization.ts). Decided. |
| merged_probe symbol | **A** | `cancelSession` — bare identifier, absent on base (grep). Decided. |
| Update write path (repo method vs direct `tx.update`) | **B** | Build-time choice inside `packages/db/src`; direct `tx.update(sessions)` on S2 pattern is default. Deferred to build. |
| Dedup / `expected_version` / outbox mechanics | **A** | Reuse S2's `processed_commands` + producer contract; spec pins the events. Decided. |
| **Per-op suspension action-class literal(s)** | **C** | **BLOCKER B1** — new/changed billing contract; DD-105 names direction only. Owner must supply. |
| **CancelSession draft-only subset split** | **C** | **B3** — re-drawing one spec'd command by source-status = owner re-slice. |
| **Security round scope on the authz edit** | **C→gated** | **B2** — cannot spec until B1 fixes the class contract. |
| AnnounceSession suspension treatment | **C** | Same class as B1 (is it gated at all? which literal?) — owner decides with the others. |

## 7. Closure matrix + canonical verdict — `NOT_CODE_READY`

### 7.1 Closure matrix (re-run at `519fb9f`)

| # | Gate | Evidence | PASS/FAIL |
|---|---|---|---|
| 1 | Authority snapshot pinned by SHA | `git rev-parse HEAD` = `519fb9f…`; exact TARGET_FILES, no glob | PASS |
| 2 | In-scope decisions closed | **FAIL** — the per-op suspension action-class contract (B1) is an OPEN owner decision; DD-105 names direction only | FAIL |
| 3 | Scope IN/OUT + owner clear | §0 SCOPE / NEGATIVE_SCOPE; mechanism-named; one writer; author-mints-no-class fenced | PASS |
| 4 | Dependency classified | code dep S2 MERGED (`b48625c`, probe `isStoredCreateResult`); **billing action-class contract dep UNMET** (B1) — a NEW decision, not a merged/prior-slice/enablement/deferred dependency | FAIL |
| 5 | Live schema/code matches doc | verified at `519fb9f`: session-service.ts (S2), authorization.ts:25/91/98, billing :269-278, tenant.ts:65, schema status enum | PASS |
| 6 | Data/API/state/auth contract complete | **FAIL** — the auth contract (which action class each command calls) is undefined (B1); U5/CL3/CA5 unspecifiable | FAIL |
| 7 | Fail-closed / idempotency / order pinned | mechanism pinned (dedup-first, expected_version, FOR UPDATE + FOR SHARE re-check) — but the re-check's class arg is undefined (B1) | PARTIAL |
| 8 | In-scope open questions = 0 | **FAIL** — B1 (action-class), B3 (subset split), B2 (security scope) open in-scope | FAIL |
| 9 | Acceptance matrix has expected results | §5 drafted with expected results, EXCEPT the suspension rows U5/CL3/CA5 (blocked on B1) | PARTIAL |
| 10 | Migration / security / rollback pinned | zero migration (guarded); **security round REQUIRED but unspecifiable until B1** (B2); rollback = revert the edits | PARTIAL |
| 11 | First slice hard deps merged | code dep S2 merged; the action-class contract dep (B1) is NOT merged/decided | FAIL |
| 12 | Implementation handoff ready | contract + manifest authored + consistent, but NOT executable (author cannot mint the class; B1) | FAIL |

**Closure: NOT 12/12 (7 PASS-or-partial short of the bar) → `NOT_CODE_READY`.**

### 7.2 Verdict — canonical block

```text
REVIEW_POLICY_VERSION: 1.3
REVIEW_VERDICT: NOT_CODE_READY
REVIEWED_AT: 2026-08-14
AUTHORITY_SHA: 519fb9f91fffe4712668f24a1af697d5f1a002bd
BASE_BRANCH: main
TARGET_FILES:
  - packages/db/src/session-service.ts
  - packages/db/src/authorization.ts
  - packages/db/src/tenant.ts
  - packages/db/schema.ts
  - docs/features/BE/feature_session_management_tech.md
  - docs/features/FE/feature_session_management.md
  - docs/features/BE/feature_billing_lifecycle_tech.md
  - docs/standards/decisions.md
  - docs/autopilot/contracts/autopilot-session-service-create-command-core.md
SLICE: session-commands-update-close-cancel
IN_SCOPE: UpdateSession / CloseSession / CancelSession (and AnnounceSession if budget allows) as
  SessionService command functions on S2's CreateSession pattern in one withTenant transaction each
  (dedup, expected_version, transition guard, outbox event); a NARROW per-op suspension action-class
  literal added to authorizeTenantAction + the billing Suspended Action Matrix so the player-visible
  commands re-check tenant suspension under lock; real-PG tests; index.ts export.
OUT_OF_SCOPE: CreateSession (S2); PublishSession re-gate; DeleteSession (DD-104 slice); any
  author-invented action-class name; any change to the DD-105 exemption principle or the billing
  fail-closed resolution / FOR SHARE ordering; route/API/UI; migration/schema.ts; projector/dispatcher/
  schedule; refund/settlement money movement.
G1_DECISION: FAIL
G2_SPEC: PASS
G3_DEPENDENCY: FAIL
G4_TEST: PARTIAL
G5_SCOPE: PASS
G6_EXTERNAL: FAIL
HARD_DEPENDENCIES: session-service-create-command-core — MERGED (squash b48625c, ancestor of base;
  merged_probe packages/db/src/session-service.ts :: isStoredCreateResult). UNMET: a new billing-authz
  contract decision — the narrow per-op suspension action-class literal(s) for the player-visible
  session commands (DD-105 names the direction, no literal; DD-104 D2a names only delete_draft_session).
PRIOR_SLICES: session-service-create-command-core (S2, merged).
OPEN_QUESTIONS_IN_SCOPE: 3
ENABLEMENT_ONLY_GATES: none
LIVE_REPO_VERIFICATION: PASS
CONTRACT_MATRIX: FAIL
CLOSURE_MATRIX: FAIL
ACCEPTANCE_MATRIX: FAIL
SECURITY_AND_MIGRATION_GATE: FAIL
IMPLEMENTATION_ARTIFACTS: PASS
FIRST_IMPLEMENTATION_STEP: BLOCKED — resolve B1 first (owner decision below), then re-review to CODE_READY.
REMAINING_BLOCKERS:
  - blocker: The narrow per-op suspension action-class literal(s) for UpdateSession / CloseSession /
      CancelSession-on-open / AnnounceSession are undefined. Each is player-visible/roster/money (DD-105
      excludes them from the draft-invisibility exemption) and must call authorizeTenantAction(tx,
      tenantId, <class>) under lock, but authorizeTenantAction recognises only {publish_new_sessions,
      admin_mutation, integration_changes} and fail-closes on any other value. DD-105 names the
      DIRECTION ("mỗi cái một class hẹp khi build"); DD-104 D2a names only delete_draft_session. Minting
      a new money-gate class value is a Tier-C billing-contract decision (level3 §6.1 item 1) the author
      may not make (DD-105: "tác giả phải quay lại đây + DD-104 D2a để lấy class hẹp").
    owner: repo owner (billing/authorization contract) — via a decision-record entry (DD-104 D2a shape)
    resolution: owner adds, to docs/features/BE/feature_billing_lifecycle_tech.md Suspended Action Matrix
      AND authorizeTenantAction's ActionClass/RECOGNIZED_ACTION_CLASSES, the exact narrow per-op class
      name(s) for these commands (or an explicit ruling to reuse a named existing class). Binary: the
      literal(s) exist in the billing contract + authorization.ts, or they do not.
    tier: C
  - blocker: CancelSession is spec'd as ONE command accepting both draft (invisible/money-free) and open
      (player-visible/money) sources; it cannot ship as a draft-only self-contained subset without
      re-drawing the command boundary (level3 §6.1 item 7 — re-slice, never widen/narrow silently).
    owner: repo owner
    resolution: owner either (a) supplies the per-op class (closes B1, enabling the full CancelSession),
      or (b) authorizes a NEW re-scoped slice `session-cancel-draft-discard` covering ONLY source=draft
      (ungated under DD-105, open source explicitly negative-scoped). Binary: an owner decision selecting
      (a) or (b) exists.
    tier: C
  - blocker: G6 security round on the authorizeTenantAction trust-boundary edit cannot be specified until
      B1 fixes the action-class contract (the round must review the exact new recognised classes).
    owner: same as B1 (dependent)
    resolution: auto-resolves when B1 lands — then a security-focused codex round is scheduled through
      scripts/codex-review-pin.sh alongside the 2 code rounds.
    tier: C
NEXT_REVIEW_TRIGGER: a decisions.md entry (DD-104 D2a shape) that NAMES the per-op suspension
  action-class literal(s) for these session commands (and rules on the CancelSession draft-only subset),
  merged on main — re-review this packet to CODE_READY at that commit. NOT "updated docs".
```

## 8. Recommendation to the conductor (highest-benefit path)

The cleanest unblock, in priority order:

1. **Owner mints one decision** naming the per-op suspension action-class literal(s) for
   Update/Close/Cancel/Announce (DD-104 D2a shape: "sửa contract billing, slice riêng"). That single
   decision closes B1 + B2 and makes this whole packet CODE_READY as authored (all four ops).
2. **If the owner wants earlier progress**, authorize a smaller re-scoped slice
   `session-cancel-draft-discard` (source=`draft` ONLY): invisible-until-publish + money-free, so it is
   ungated under DD-105 exactly like CreateSession — no new action-class needed, self-contained
   CODE_READY, `open` source explicitly negative-scoped. This ships the draft-lifecycle cleanup
   (SES-UC-13/14) now and parks Update/Close/Cancel-on-open/Announce behind decision (1). Note the
   invariant catalog may need a one-line `session-command` token added first.

Cost is not a factor in this recommendation: option (1) is the higher-benefit path (one owner decision
unlocks the full command family and gives `authorizeTenantAction` its first real caller with the
narrow-class shape DD-105 designed). Option (2) is a legitimate faster partial if the owner prefers it.
