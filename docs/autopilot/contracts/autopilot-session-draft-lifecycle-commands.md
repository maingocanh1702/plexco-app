<!-- review-readiness: historical -->

# session-draft-lifecycle-commands — task contract (IMPLEMENTED)

> **STATUS: IMPLEMENTED, historical record — NOT a coding handoff.** `publishSession` is carried forward VERBATIM in THIS
> diff, on the successor branch `feat/session-draft-lifecycle-commands--v3`: the DD-109-authorized
> successor to `--v2`, which HALTed at `MAX_ROUNDS` (fix-round 5) UNMERGED. v3 closes v2's three accepted
> findings (§0.3) at `fix_rounds_max=5` (owner-ruled 2026-08-14; DD-109's 8 is not machine-executable, see
> the lane Decision Ledger D0). Do not use this document to open a new
> worktree or re-implement `publishSession`; there is nothing left to build. `FIRST_IMPLEMENTATION_STEP`
> in §7.2 below is preserved verbatim as the historical record of what the original `CODE_READY` verdict
> pointed at — it is not a live instruction, and no step in this document authorizes a duplicate run.
>
> **Provenance.** This mechanism was first built on `feat/session-draft-lifecycle-commands` (v1), which
> HALTed at `MAX_ROUNDS` (fix-round 5) with four ACCEPTED, not-contested findings after five rounds
> hardened the design (authz-fail-fast order, replay-binding, sessionId canonicalization, a real
> in-flight competing-writer test — see `DECISIONS.md` D3-D10). v1 is preserved read-only for forensics —
> `.autopilot/worktrees/session-draft-lifecycle-commands/.autopilot/state/session-draft-lifecycle-commands/HALT-MAX_ROUNDS.txt`
> and its `DECISIONS.md` (D3-D10, NOT D1 — that ledger has no D1/D2 entry, codex round-03 [P2] caught a
> second stale "D1-D10" citation after round-02 already fixed one elsewhere in this same file) — and its
> shared scope-gate reservation was closed via a disposition
> record (`authorized_close`) that touches ONLY the shared registry, not the v1 worktree/branch/state.
> This lane (`--v2`) is the pre-authorized successor: it carries the five-rounds-hardened
> `publishSession` forward verbatim (only the two spots below actually changed) and closes all four v1
> findings as its first deliverables (§0.2).
>
> **Slice:** `session-draft-lifecycle-commands` (slug = mechanism: the `PublishSession` command boundary —
> trusted-context input → dedup → session `FOR UPDATE` lock → billing suspension re-check under lock via
> `authorizeTenantAction('publish_new_sessions')` → `draft`→`open` transition → one `session.published`
> outbox row, one transaction, zero migration). **Shipped scope = PublishSession ONLY** (see §0.1 — the
> cancel-draft half was dropped to a named follow-up; it diverges from the Reviewed `CancelSession` spec).
> **Risk:** P1 · **Change class:** code (service-only) · **Autonomy:** `autonomous_to_ready` (DD-107).
> **Opened from:** the Session BE vertical (M2), sibling of `createSession` (merged on base).
> **Design verified at:** `519fb9f91fffe4712668f24a1af697d5f1a002bd` (v1's frozen base — the `CODE_READY`
> analysis in §3/§7 below was done here and is preserved verbatim).
> **Built + registered at:** `b333960827758b6a0405f401f5c2ed67fabeffcc` (`--v2`'s frozen `base_sha` — the
> `origin/main` tip at registration time). `519fb9f` is an ancestor of `b333960` with zero
> `packages/db` changes in between (`git log --oneline 519fb9f..b333960 -- packages/db` = empty, the one
> intervening commit is docs-only), so the dependency/schema analysis below still holds verbatim at the
> later base — it was re-verified, not merely carried forward.
> **Manifest (authored):** `docs/autopilot-manifests/session-draft-lifecycle-commands.json`.
> **Original verdict:** `CODE_READY` at `519fb9f` (§7 below, unchanged as historical record) — all
> blockers resolved: publish is fully spec'd (BE §4 Publish transition, edges #21–#24, `session.published`
> event `{session_id, tenant_id, visibility}`), DD-105 confirms it is the real visibility boundary (❌ when
> suspended), `authorizeTenantAction` + `publish_new_sessions` action class both exist on base (0 callers
> — this makes it the first), all substrate merged.

## 0.2 The four v1 findings closed by this lane

All four were ACCEPTED by v1 (not contested) — see `HALT-MAX_ROUNDS.txt` "The four open findings" and
`DECISIONS.md` D10. Closed here as the first deliverables, before any new review round was requested:

1. **[P1] DB clock, not app clock — and not just any DB-clock expression.** The past-start cutoff reads
   `starts_at <= clock_timestamp()` via a query issued AFTER the `FOR UPDATE` lock (§2 step 7) has already
   resolved — never `Date.now()`, and (after a first attempt that folded the comparison into the SAME
   locked `SELECT`, which codex round-02 caught as insufficient — see D12 in the Decision Ledger) never a
   time expression sharing a statement with that lock wait either. File: `packages/db/src/session-service.ts`
   (§2 steps 5/7 below). Two regression tests in `session-service.test.ts`: `REG-CLOCK1` seeds a real
   near-future draft, then skews `Date.now()` to `2099-01-01` via `vi.spyOn(Date, "now")` and asserts the
   publish still succeeds (proves app-clock independence). `REG-CLOCK2` holds the session row's `FOR
   UPDATE` lock on a separate connection, starts a real publish (it blocks), lets `starts_at` pass in real
   wall-clock time WHILE still blocked, then releases — proving the guard uses the time AFTER the wait,
   not a value frozen when the blocked statement was first issued.
2. **[P1] Packet classification, decided up front.** This lane ships code + packet together, so this
   document uses `<!-- review-readiness: historical -->` and an IMPLEMENTED framing, not `code-ready`.
   §7.2's verdict block is preserved as the historical record of the original analysis; it is not a
   live `FIRST_IMPLEMENTATION_STEP` that could authorize a duplicate run from the stale `519fb9f` base.
3. **[P2] Verification commands, corrected.** `pnpm -w check:quick` is `lint + test:core`
   (`package.json:16`) only — it does NOT build, typecheck, or touch `packages/db` at all. Replaced
   throughout this contract and the runtime manifest with the actual commands run for this lane: real-PG
   `pnpm --filter @plexco/db test`, `pnpm --filter @plexco/db run typecheck`, root `pnpm run lint`, root
   `pnpm run build` (recursive typecheck + build across every workspace package).
4. **[P2] create→publish sequence proven.** Every other publish test seeds its draft directly via
   `seedDraft()`, which proves `publishSession` in isolation but never the ordered PAIR the contract
   claims (`session.created` seq 1, `session.published` seq 2 on one aggregate). New test `SEQ1` drives
   the real `createSession` then the real `publishSession` on the same aggregate and asserts exactly
   that ordered pair.

## 0.3 The three v2 findings closed by this lane (v3)

v2 (`--v2`, base `b333960`) carried v1's hardened design forward and closed v1's four findings, then
HALTed at `MAX_ROUNDS` with THREE new ACCEPTED findings (v2 `HALT-MAX_ROUNDS.txt`). This lane (`--v3`,
base `2f859dd`) carries v2's HEAD `da8385c` forward VERBATIM and closes those three as its first
deliverables. Full reasoning: the lane Decision Ledger
(`.autopilot/state/session-draft-lifecycle-commands--v3/DECISIONS.md`, D0–D4).

1. **[P2] CONC1/CONC2 billing-#36 fidelity — IMPLEMENTED in-lane (v3 gate-attempt-01 reviewer finding).**
   The competing-writer tests prove publishSession's under-lock billing read (`FOR SHARE`) BLOCKS a
   competing job claim (CONC1) / a competing `SKIP LOCKED` claim DEFERS against the real in-flight publish
   (CONC2). **Initial v3 decision** deferred the exact eligible-row predicate to a follow-up (the merged
   `authorization.test.ts` E1-E3 precedent takes the same stance for the same resolver, treating the exact
   predicate as the future Daily-Lifecycle-Job slice's obligation). **The gate-attempt-01 code reviewer
   overruled it:** `feature_session_management_tech.md:542` incorporates billing #36 into THIS slice
   ("build slice phải tự chứng minh implementation thoả bằng billing test #36"), so the deferral left a
   mandatory acceptance criterion unmet. **Resolution (Ledger D1):** CONC1/CONC2 now seed the job's EXACT
   eligible row (paid `host_pro` price 250000 > 0, `status='past_due'`, `grace_end <= now()`) via a new
   `seedEligibleTenant()` helper and run the job's real claim predicate (`JOIN plans WHERE price > 0 ...
   FOR UPDATE OF s SKIP LOCKED`, shared `jobClaimSql`); CONC1 asserts the claim matches the fixture
   (`rows === 1`), CONC2 asserts it defers (`rows === 0`). No follow-up test-fidelity debt remains.
2. **[P2] REG-CLOCK2 precondition timing — window eliminated.** The round-03 `still_future` precondition
   pre-seeded `starts_at = dbNow + 400ms` before connect/BEGIN/lock/publish-start/block-detection, so
   setup overhead > 400ms would flake CORRECT code (round-05's poll only hardened the LATER wait).
   **Fix (Ledger D2):** the holder establishes `starts_at = clock_timestamp() + interval '500 milliseconds'`
   in one statement AFTER publish is confirmed blocked (it owns the row lock) — future BY CONSTRUCTION,
   no earlier window; still future relative to publish's already-started transaction, so the same proof
   is preserved. The poll now re-reads the row's own `starts_at` against the DB clock.
3. **[P2] Undisclosed budget overrun — DD-107 disposition recorded (§0 BUDGETS).** `session-service.ts`
   overruns the authored 300 ceiling (~+25% at this writing; measure via `git diff --stat`, not a
   hard-pinned count — it drifts with formatting). **Decision (Ledger D3, owner-ruled):** record the
   measured overrun + design cause; do NOT re-slice now. If this lane HALTs, the pre-identified re-slice
   is docs-first: land the tracked contract + authored manifest as a separate docs commit, shrinking the
   code/test lane by the docs' share of the diff (measure via `git diff --stat`, not a hard-pinned count),
   per DD-109 condition 2.

**Historical-reference reconciliation.** §3 and §7 below are preserved VERBATIM as v2/v1's authoring
record; §0 (task contract) is v2's record too EXCEPT its BUDGETS block, which THIS lane extended with the
DD-107 overrun disposition (finding 3) — so §0 is otherwise verbatim, not literally byte-for-byte. They
cite `TASK_ID --v2`, base `b333960`, and the design base `519fb9f`. v3's
operative identity is the runtime manifest (`--v3`, base `2f859dd`); the design analysis holds verbatim at
`2f859dd` because it differs from `b333960` only by the DD-109 docs commit (`git diff --name-only
b333960..2f859dd -- packages` = empty). The `<!-- review-readiness: historical -->` classification and the
§7.2 verdict block are unchanged historical evidence, not a live coding authorization.

## 0. Task contract (level3-workflow §3)

```text
TASK_ID: plexco:session-draft-lifecycle-commands--v2
OUTCOME (achieved): a SessionService PublishSession command exists and is the single write path for the
  draft→open transition: dedups by commandId via processed_commands, locks the session row FOR UPDATE,
  re-checks billing suspension under lock via authorizeTenantAction('publish_new_sessions') (fail-closed
  TENANT_SUSPENDED), flips status draft→open + bumps version, and writes exactly one session.published
  outbox event — all in ONE withTenant transaction, with the past-start cutoff read from the DATABASE
  clock. First PRODUCTION caller of authorizeTenantAction (AP-40's purpose) and the durable producer a
  future public_sessions projector will consume.
REPOSITORY_AND_BASE: plexco-app @ origin/main = b333960827758b6a0405f401f5c2ed67fabeffcc (frozen,
  registered `base_sha`; ancestor 519fb9f is where the CODE_READY design analysis was performed).
CONTEXT_SOURCES: docs/features/BE/feature_session_management_tech.md (§1 commands, §3 endpoints/error
  codes/idempotency, §4 "Publish transition (draft → open)" steps 1-7 + billing blockquotes, §4 events
  table session.published:508, BE edges #21-#24); docs/features/FE/feature_session_management.md
  (SES-UC-12 publish, session_published analytics); packages/db/src/session-service.ts (createSession —
  the command pattern this mirrors: dedup, advisory-lock reserve, outbox producer insert, processed_commands
  record); packages/db/src/authorization.ts (authorizeTenantAction(tx, tenantId, actionClass), the
  publish_new_sessions class, fail-closed TENANT_SUSPENDED, requires the caller's own tx); packages/db/src/
  tenant.ts (withTenant / tenantRepo, RLS choke-point); packages/db/schema.ts (sessions:583 with
  sessions_status_chk draft/open/closed/cancelled:615, version:599; outboxEvents:1308; processedCommands:1296);
  docs/standards/decisions.md DD-105 (:1940-1983 — publish_new_sessions is the real visibility boundary,
  gated ❌ when suspended) and DD-107 (autonomous_to_ready + Decision Ledger protocol);
  docs/autopilot/contracts/autopilot-db-job-claim-lease-core.md (outbox claim/ack consumer contract §4.2);
  .autopilot/worktrees/session-draft-lifecycle-commands/.autopilot/state/session-draft-lifecycle-commands/HALT-MAX_ROUNDS.txt
  (the four findings this lane closes) and its DECISIONS.md (D3-D10, v1's design history — that ledger has
  no D1/D2 entry).
APPLICABLE_SKILLS: none resident.
SCOPE (write these only): packages/db/src/session-service.ts (publishSession + its typed errors, DB-clock
  guard); packages/db/src/session-service.test.ts (real-PG publish tests + REG-CLOCK1 + SEQ1);
  packages/db/src/index.ts (export publishSession + its types — barrel, a known merge-time touch); this
  contract + authored manifest. ZERO migration, zero schema.ts change.
NEGATIVE_SCOPE: NO public_sessions projector / no public projection at all (owner = feature_marketplace_
  discovery; this slice only writes the canonical outbox row). NO CancelDraftSession / CancelSession /
  Update / Close / Announce / Delete (blocked siblings; cancel-draft dropped to a named follow-up — §0.1).
  NO new action-class literal (publish REUSES the existing publish_new_sessions). NO edit to billing files.
  NO migration, no schema.ts change. NO OUTBOX_DISPATCH_SCHEDULE_ENABLED change (schedule stays OFF; rows
  accumulate unclaimed by design). Do NOT modify createSession's own logic (its section is byte-identical
  to base except the shared import line). Do NOT touch docs/autopilot-backlog.md (conductor-owned hot
  file). NO route/API/UI (web/bot boundary is a later slice; the non-admin 403 and the HTTP status
  envelope live at the route layer).
RISK: P1 — trust boundary: PublishSession calls authorizeTenantAction and gates on billing suspension
  (money/authz gate). No money MUTATION (publish moves status, not charges), no PII surface, no external
  input. RLS choke-point honored by construction (withTenant only).
AUTONOMY_MODE: supervised (the level3-operational manifest value the readiness gate requires for P1 — it
  MATCHES the runtime + authored manifest; validated by scripts/autopilot-review-readiness.mjs, which
  accepts only "supervised"/"proactive_routine" and forces "supervised" for P1). The lane's DD-107
  OPERATING mode is `autonomous_to_ready` (Tier A derive+log, Tier B decide+log, Tier C AWAIT) — a
  session policy, not the manifest field; both are recorded here without contradiction.
MODEL_POLICY: planner=primary-agent; worker=self; reviewer=scripts/codex-review-pin.sh (2 consecutive
  FULL-clean code rounds on current HEAD + 1 clean SECURITY round — P1 trust boundary). Fallback:
  HALT TOOL_UNAVAILABLE.
SANDBOX_AND_PERMISSIONS: network none; secrets none; external side effects none.
HUMAN_DECISIONS_REQUIRED: none remaining — DD-105 (owner 2026-08-13) settles the suspension boundary;
  publish is gated, create-draft is exempt, cancel-draft is the follow-up. v1's disposal (this section's
  Provenance note) was owner-directed in-conversation, recorded in
  .autopilot/dispositions/session-draft-lifecycle-commands.json.
SLICE_GRAPH: sibling of the merged createSession (root of the Session BE vertical). Depends only on merged
  substrate (schema 0002+ sessions/status enum, processed_commands + outbox 0005, lease/ack 0022/0023,
  authorizeTenantAction authorization.ts, resolve_tenant_status_locked 0027, tenantRepo/withTenant). Blocks:
  the future public_sessions projector (consumes session.published), the publish route/API, cancel-draft.
WORKTREE_PLAN: 1 branch (feat/session-draft-lifecycle-commands--v2) + 1 worktree + 1 writer, base pinned
  from the verified origin/main tip. Root worktree stays on main. v1's worktree/branch is a separate,
  untouched, read-only reference — not reused.
VERIFICATION: DATABASE_URL_TEST=postgres://plexco:plexco_dev@localhost:5432/plexco_test pnpm --filter
  @plexco/db test (real PG — runs session-service.test.ts AND rls-invariants.test.ts together, plus every
  other db-package suite, unchanged-green); pnpm --filter @plexco/db run typecheck (tsc --noEmit); pnpm
  run lint (root eslint .); pnpm run build (root: pnpm -r run typecheck && pnpm -r run build, across every
  workspace package including apps/web). NOT `pnpm -w check:quick` (finding #3 — that script is
  `lint + test:core` only and never touches packages/db). Plus: inspect the exact diff vs the live base =
  declared scope only (enforced mechanically by the gate's own SCOPE_DRIFT check).
CODE_REVIEW: required — 2 consecutive FULL-clean rounds via scripts/codex-review-pin.sh, bound to current
  HEAD/base/diff, exact clean tail marker, run within a single `scope-gate ready` invocation.
SECURITY_REVIEW: REQUIRED — publish touches a trust boundary (authz + billing suspension gate). One
  security-focused round via the same pinned reviewer, in the same `ready` invocation.
BUDGETS: ~≤300 changed LOC in packages/db/src/session-service.ts (P1 ceiling; publish is a single atomic
  command narrower than create). fix_rounds_max 5. Budget is a SIGNAL (DD-107): overrun ⇒ re-slice or log
  the design cause; it is not a gate to amend.
  DD-107 DISPOSITION (v3 finding 3): a MEASURED overrun of session-service.ts additions vs the 300
  ceiling (~+25% at this writing; measure via `git diff --stat <base>...HEAD`, not a hard-pinned count). DESIGN CAUSE: publishSession is one cohesive trust-boundary command whose
  correctness needs a dual billing authorization (upfront serialization + under-lock re-affirmation via
  authorizeTenantAction), the empirically-verified DB-clock past-start check (separate post-lock
  clock_timestamp() + microsecond direct re-read), full idempotency (advisory lock + fail-closed dedup
  bound to input.sessionId), competing-writer serialization, and the outbox producer -- ~370 LOC of one
  transaction; the 300 default under-budgeted the clock-correctness + dual-authz hardening this specific
  trust-boundary command required. This is the FIRST log of this cause (v2 never disposed it -- that
  omission WAS the finding), not a 2nd overrun on an already-logged cause. Owner-ruled 2026-08-14: LOG the
  cause, do NOT re-slice now. Splitting the LOGIC would fragment one transaction; the correct shrink path
  is docs-first: land the tracked contract + authored manifest as a separate commit; the code/test lane
  then shrinks by the docs' share of the diff (measure via `git diff --stat`, not a hard-pinned count) --
  pre-identified in the Decision Ledger, used only if this lane HALTs.
STOP_CONDITIONS: any migration or schema.ts appears in the diff · any route/UI/billing file appears ·
  a NEW action-class literal is needed (Tier C — STOP) · budget overrun repeats on the same design cause
  (re-slice) · reviewer unavailable → HALT TOOL_UNAVAILABLE · MAX_ROUNDS (>5) · REGION_THRASH (same
  file:region 3 consecutive rounds).
DELIVERABLES: publishSession + real-PG tests green (session-service.test.ts and the full db suite both
  pass in full -- exact counts intentionally not pinned here; see the gate's own
  gate-attempt-*-verify-focused-*.txt artifacts, which go stale-proof by construction since they are
  regenerated every attempt), 2 clean code rounds + 1 clean security round, gate artifact + READY.txt, merged_probe =
  publishSession (bare identifier, verified absent on base), Decision Ledger at
  .autopilot/state/session-draft-lifecycle-commands--v2/DECISIONS.md.
```

## 0.1 Why PublishSession-only (cancel-draft dropped to a follow-up)

The lane was scoped as two cores (Publish + CancelDraft). CancelDraft was dropped via the prompt's explicit
FALLBACK and recorded as a named follow-up. This rationale predates v1's
`.autopilot/state/session-draft-lifecycle-commands/DECISIONS.md`, which starts at D3, not D1 (codex
round-02 [P2] on `--v2`: the earlier "D1" citation here pointed at a ledger entry that was never actually
written) — the durable authority is the Reviewed BE spec cited in the bullets below, not a decision-ledger
entry:

- The Reviewed BE spec (`feature_session_management_tech.md` edges #25–#31 + §4 "Draft discard +
  auto-expiry") pins the canonical draft-cancel mechanism as an **extension of the existing `CancelSession`
  command** (source `{draft, open}`), NOT a new `CancelDraftSession` command, and it **mandates a
  fail-closed anomaly path**: a `draft` carrying `players`/`charges` must NOT auto-cancel — it returns
  `CANCEL_REQUIRES_REVIEW` and emits `session.expiry_anomaly_detected`, verified under lock ("KHÔNG được
  giả định rỗng").
- The prompt's CancelDraft ("transition draft→cancelled via the tenant choke-point", non-draft → typed
  error, no anomaly path) would either contradict the Reviewed command name or omit the mandated
  money-safety fail-closed path — a money/data-integrity contract deviation beyond a DD-named change =
  **Tier C**. DD-105's hard boundary also does not name a draft-only cancel as authz-exempt.
- Widening scope to build the spec's real `CancelSession` pulls in the open-source cancel path (edge #5
  `review_policy`, paid-roster preview, refund implications) — its own multi-slice feature, beyond this
  P1 ≤3-module ceiling.

**Follow-up (owner queue):** `session-cancel-command-draft-and-open` — implement the spec's `CancelSession`
(source `{draft,open}`, `expectedVersion` mandatory, under-lock `players`/`charges` verify → fail-closed
`CANCEL_REQUIRES_REVIEW` + `session.expiry_anomaly_detected` for the draft anomaly path, `review_policy`
roster/paid preview for the open path, one `session.cancelled` outbox event). Binary CODE_READY condition:
matches edges #25–#31 + §4 and passes its own gate. NOT in this lane's diff.

## 1. Why this slice, why now

`createSession` (the Session BE vertical root) is merged on base and writes `draft` sessions + the first
`session.created` outbox rows. `PublishSession` is the next command in the state machine: it is the ONLY
way a draft becomes visible (`draft`→`open`), and it is the **real billing-visibility boundary** (DD-105).
`authorizeTenantAction` + the `publish_new_sessions` action class have been merged and code-dark since AP-40
with **0 production callers** — this slice makes publish the first, wiring the suspension gate into a real
command exactly as AP-40 was built to enable. The `session.published` outbox event is the durable producer
a future `public_sessions` projector consumes (not built here).

## 2. Mechanism (what gets built, exactly)

One exported service function `publishSession(db, params)` where `params = { tenantId, commandId, input:
{ sessionId, expectedVersion? } }`, executing inside a single `withTenant` transaction, mirroring
`createSession`'s structure, but with a spec-pinned order (BE §4 Publish step 1: authz BEFORE dedup +
state lookup, authz beats replay/no-op):

1. **Trusted context in.** `tenantId`/`commandId` from trusted routing (never payload); `withTenant`
   asserts `tenantId` is a UUID and pins the RLS GUC.
2. **Billing suspension — FAIL-FAST, BEFORE dedup and state lookup** (BE §4 step 1: "AuthZ re-checked trên
   MỌI publish call (kể cả replay/no-op — authz đứng TRƯỚC dedup + state lookup) … authz thắng no-op"):
   `authorizeTenantAction(tx, tenantId, 'publish_new_sessions')`. `allowed:false` → `TENANT_SUSPENDED`
   immediately, before the ledger read — so a suspended tenant gets `TENANT_SUSPENDED` even on a REPLAY of
   a previously-successful publish or a no-op against an already-open session (suspension beats every
   replay/no-op/domain outcome below). This upfront call already serializes against the suspend (its `FOR SHARE` is retained to commit per authorization.ts:41); step 9 re-affirms under the session lock (defense-in-depth, redundant under the current helper — see the §2 step 9 note).
3. **Reserve the command key GLOBALLY** (command-type-INDEPENDENT advisory xact lock keyed
   `'processed-command:' || tenantId::uuid::text || ':' || commandId`), IDENTICAL to createSession — matches
   the `processed_commands (tenant_id, command_id)` global uniqueness so a concurrent command of ANY type
   sharing the id serializes and dedups instead of racing to a raw 23505.
4. **Dedup** (edge #3, AFTER the fail-fast authz gate): look up `processed_commands` by `(tenant_id,
   command_id)`. A hit with `command_type='PublishSession'` AND a domain-valid stored envelope → return it
   (replayed, zero mutation). A hit that is a foreign `command_type` or a corrupt/unusable/domain-invalid
   result → fail-closed `COMMAND_ID_CONFLICT` (the same shared-ledger fail-closed pattern createSession
   established as the ledger's first consumer). Explicit 4-field projection on replay (never spread the
   stored value).
5. **Lock the session row `FOR UPDATE`** in tenant context (RLS choke-point) and read `status`,
   `visibility`, raw `starts_at`, `version` under lock (BE §4 step 2 — decide from the locked row, not a
   cache). No time comparison in this statement. Not found (0 rows under the tenant GUC) → `SESSION_NOT_FOUND`.
6. **Idempotent no-op (wins `expectedVersion`)** (BE §4 step 3): if `status='open'` already → return
   success no-op — no status/version change, NO duplicate `session.published`. It DOES write its own
   `processed_commands` row (one per distinct commandId), so a later replay of that id short-circuits on
   the ledger exactly like the mutating path. `expectedVersion` is NOT checked here (goal state reached).
   (Authz already passed at step 2, so a suspended tenant never reaches this no-op.)
7. **Transition guard** (BE §4 step 4): `status ∈ {closed, cancelled}` → `SESSION_NOT_OPEN` immediately, no
   time check needed. Only `status='draft'` proceeds to the past-start check: a **SEPARATE, SUBSEQUENT**
   query — `` select (${sessions.startsAt} <= clock_timestamp()) as "isPastStart" from ${sessions} where
   ${sessions.id} = ${sessionId} `` issued AFTER step 5's `FOR UPDATE` has already resolved — decides
   `isPastStart`, reading the DATABASE clock, never the application's `Date.now()` (fix #1, §0.2). **Not**
   a `starts_at <= clock_timestamp()` expression folded into step 5's own SELECT: measured directly
   against real Postgres (codex round-02 [P1] on the first fix attempt), a lock wait on step 5's own `FOR
   UPDATE` makes `clock_timestamp()` in THAT statement ALSO return the pre-wait time, not just `now()` —
   despite `clock_timestamp()` being labeled VOLATILE, it does not re-evaluate at row-production time when
   it shares a statement with the LockRows node it is waiting behind. A separate statement issued only
   after that wait has already resolved does not have this defect. **Also not** a parameter built from
   `current.startsAt` (a JS `Date`, millisecond precision) compared against `clock_timestamp()`: codex
   round-05 [P2] caught that Postgres `timestamptz` carries microsecond precision, so parameterizing the
   already-truncated JS value could reject or admit a draft fractionally around its true stored
   `starts_at` — the query instead re-reads `starts_at` directly from the table (no JS round-trip for the
   compared value; `sessionId` is the only parameter, and it carries no precision). `isPastStart` true →
   `SESSION_NOT_OPEN`, zero mutation. Only `draft` with a future `starts_at` proceeds.
8. **Public precondition** (BE §4 step 5): if `visibility='public'` → re-validate E#7 discovery completeness
   (sport, area, starts_at, `slots_max IS NOT NULL`) since publish turns on public projection → missing →
   `MISSING_DISCOVERY_FIELDS`, zero mutation. Private → skip (visibility unchanged at publish).
9. **Billing re-check under lock — defense-in-depth re-affirmation** (BE §4 step 6): immediately before mutating,
   `authorizeTenantAction(tx, tenantId, 'publish_new_sessions')` AGAIN in the SAME transaction holding the
   session lock. `authorizeTenantAction` itself performs the locking reads (`resolve_tenant_status_locked` +
   `subscriptions FOR SHARE`, tenant axis before billing axis) — this is why it must receive the caller's
   own `tx` (authorization.ts contract). `allowed:false` → `TENANT_SUSPENDED`, abort, zero mutation, NO
   event. NOTE (v3 gate-attempt-03 [P1]): step 2 is ITSELF this same locking `authorizeTenantAction`, and
   per the helper contract (`authorization.ts:41`) its `FOR SHARE` row locks are RETAINED to this
   transaction's commit — so the serialization against the Daily Lifecycle Job's suspend is already
   established at step 2, and a suspend cannot land in the window between step 2 and here. Step 9 is
   therefore a defense-in-depth RE-AFFIRMATION under the session lock, redundant under the current
   lock-retaining helper (it would become load-bearing only if the helper released its `FOR SHARE` early
   — an authority/helper-slice design point, out of this slice's scope, flagged advisory by the gate
   reviewer). CONC1/CONC2 (§4-6) prove the #36/#36a locking-serialization acceptance criterion (block/
   deny; defer); they do not, and under the current helper cannot, isolate step 9 from step 2.
10. **`expectedVersion` guard** (mutate branch only): if the caller supplied `expectedVersion` and it ≠ the
    live `version` under lock → `STALE_VERSION`, zero mutation.
11. **Mutate + produce** (BE §4 step 6 tail): set `status='open'`, bump `version`, stamp `updated_at =
    clock_timestamp()` (codex round-03 [P2] — not `now()`, which could be frozen from before an earlier
    wait in this same transaction; this UPDATE is itself a separate, subsequent statement issued only
    after every earlier wait already resolved, so `clock_timestamp()` here is measured-safe — see
    `REG-CLOCK3`), and write exactly one `session.published` outbox row in the SAME tx:
    `aggregate_type='session'`, `aggregate_id=sessionId`, `type='session.published'`,
    `payload={session_id, tenant_id, visibility}` (BE §4 events:508), `sequence :=
    COALESCE((SELECT MAX(sequence) FROM outbox_events WHERE aggregate_id=:sessionId),0)+1` (the reusable
    per-aggregate producer rule createSession established; `outbox_agg_seq_uq` is the fence — publish's
    sequence is deterministically 2 after the create's 1, or higher, never colliding — proven end to end by
    the `SEQ1` test, §0.2 fix #4), lease/ack columns left NULL (the all-null shape
    `outbox_events_lease_shape_chk` + the `app` producer-boundary CHECK require). This is status-only —
    `visibility` is NOT changed.
12. **Record `processed_commands`** result (`command_type='PublishSession'`, the 4-field result envelope);
    commit; return the envelope with `replayed:false`.

Dispatcher schedule stays OFF — rows accumulate unclaimed by design (documented state of the job substrate,
not this slice's concern). The `public_sessions` projector is a later slice.

## 3. What is already proven (measured 2026-08-14 at design-base 519fb9f; re-verified at registered base
b333960 — zero packages/db drift between the two, see the header note)

- `createSession` + `SessionCommandError` + the session command taxonomy live on base
  (packages/db/src/session-service.ts; index.ts:26 exports them) — this slice extends the SAME file.
- `sessions.status` CHECK = `IN ('draft','open','closed','cancelled')` (schema.ts:615-616); `version` int
  default 1 (schema.ts:599). So `draft`→`open` needs **zero migration**.
- `authorizeTenantAction(tx, tenantId, actionClass)` merged (authorization.ts:91), `publish_new_sessions`
  in `RECOGNIZED_ACTION_CLASSES` (:27-31), fail-closed `TENANT_SUSPENDED` `{allowed:false}` (:39), requires
  the caller's own tx (:53-64 docstring). `resolve_tenant_status_locked` (0027) backs the tenant read.
- `outboxEvents` (schema.ts:1308) with `outbox_agg_seq_uq` (aggregate_id, sequence),
  `outbox_events_lease_shape_chk`, `outbox_events_producer_lease_boundary_chk`;
  `processedCommands` (:1296) with `processed_commands_tenant_cmd_uq`. All merged.
- `withTenant`/`tenantRepo` (tenant.ts:29/61) — the RLS choke-point.
- Test harness requires `DATABASE_URL_TEST`; `setupRlsTestContext` gives `appDb`, `tenantA`/`tenantB`,
  `owner` (superuser), `appPool`, `superuserDb`, `badmintonSportId` (used by the create tests — the same
  fixtures).
- DD-105 (decisions.md:1940-1983) — owner-final: publish is gated (`publish_new_sessions` ❌ when
  suspended); create-draft exempt; cancel-draft/announce/close/update-on-open remain under the matrix.
- BE §4 events:508 `session.published` payload = `session_id, tenant_id, visibility` (matches
  `session.created`). BE edges #21 (lock + status-only flip + one event), #22 (public missing discovery →
  `MISSING_DISCOVERY_FIELDS`), #23 (non-draft/past → `SESSION_NOT_OPEN`), #24 (suspended → `TENANT_SUSPENDED`
  under lock). Error codes `SESSION_NOT_OPEN`/`STALE_VERSION`/`MISSING_DISCOVERY_FIELDS`/`SESSION_NOT_FOUND`
  all pre-exist in BE §3; `TENANT_SUSPENDED` is billing-owned (returned as the authz decision, not a new
  session error literal).
- Measured on THIS lane's branch, re-run after every fix round: `pnpm --filter @plexco/db run typecheck`
  clean; `pnpm run lint` clean; `DATABASE_URL_TEST=... pnpm --filter @plexco/db test` passes in full
  across every file in the package (codex round-02 [P2]: an exact hard-pinned count here went stale the
  moment the round-01 fix added a test; deliberately not repeating that mistake — the gate's own
  `gate-attempt-*-verify-focused-*.txt` is the authoritative, self-refreshing count); `pnpm run build`
  clean (core + db typecheck, bot + web typecheck +
  build, including `apps/web`'s `next build`).

## 4-6. Slice-local acceptance matrix (enumerated before code, gate G4)

Traced to `feature_session_management_tech.md` §4 Publish + BE edges #21–#24 + FE SES-UC-12. `commandId`/
`tenantId` from trusted context. One `withTenant` transaction. This is a service-only slice — the non-admin
**403** (BE#10) is AuthZ middleware at the route layer, OUT of scope; the "wrong tenant" dimension is
covered here by RLS (SEC1). Domain errors surface as typed `SessionPublishError` (its `code` is one of
`PublishSessionErrorCode`); the billing-suspension denial is the distinct `SessionPublishAuthorizationError`
(`code: 'TENANT_SUSPENDED'`), never `SessionCommandError` (that class belongs to `createSession`). The
HTTP status envelope is the route slice's mapping.

| # | Group | Input / precondition | Expected state / output | Test layer | Trace |
|---|---|---|---|---|---|
| A1 | Happy (private) | publish a `draft` (private, `starts_at > now()`), tenant active | `status='open'`, `version` bumped; **exactly one** `session.published` outbox row (`aggregate_type='session'`, `aggregate_id=session.id`, `payload={session_id,tenant_id,visibility='private'}`, lease/ack NULL); one `processed_commands` row (`command_type='PublishSession'`); returns success `{replayed:false, status:'open'}`. `visibility` UNCHANGED | real-PG unit | SES-UC-12; BE#21; events:508 |
| A2 | Happy (public) | publish a `draft` with `visibility='public'`, sport+area+starts_at+finite slots_max present, active | `status='open'`; outbox `payload.visibility='public'` | real-PG unit | BE#21/#22 |
| SEQ1 | Happy / sequence | `createSession` then `publishSession` on the SAME aggregate, with a run-time-relative future `starts_at` (codex round-03 [P1]: not the shared fixture's fixed calendar date, which would eventually be in the past) (fix #4, §0.2) | outbox = exactly `[{type:'session.created',sequence:1},{type:'session.published',sequence:2}]`, ordered | real-PG unit | events:508; outbox_agg_seq_uq |
| B1 | Boundary | publish (a NEW commandId) against a session already `open` | idempotent no-op success; **zero** new outbox rows, `version` unchanged, NO duplicate `session.published`; the no-op **does** record its own `processed_commands` row (one per distinct commandId — so a later replay of that id short-circuits on the ledger, mirroring the mutating path) | real-PG unit | BE#21 (no-op); §4 step 3 |
| B2 | Boundary | publish a `closed` or `cancelled` session | `SESSION_NOT_OPEN`; zero mutation | unit | BE#23; §4 step 4 |
| B3 | Boundary | publish a `draft` with `starts_at <= now()` (past, real clock) | `SESSION_NOT_OPEN`; zero mutation | unit | BE#23; §4 step 4 |
| REG-CLOCK1 | Regression (fix #1, §0.2) | publish a `draft` with a real near-future `starts_at`, THEN stub `Date.now()` to `2099-01-01` via `vi.spyOn` | the guard reads `isPastStart` from a Postgres query, unaffected by the app-clock stub → publish still succeeds, `status='open'` | real-PG unit + clock stub | HALT-MAX_ROUNDS.txt finding #1 |
| REG-CLOCK2 | Regression (fix #1, §0.2, codex round-02/03/04/05) | hold the session row `FOR UPDATE` on a separate connection; deterministically confirm `starts_at` is still future per the DB clock at the moment publish is confirmed blocked (round-03: not a bare timing margin; round-04: the seed threshold is DB-sourced, not `Date.now()`); POLL the DB's own `clock_timestamp()` until `starts_at` has definitely passed, rather than sleeping a fixed duration and hoping it was enough (codex round-05 [P2]: a fixed sleep could still flake on a slow runner or release before the boundary on a fast one); release | the post-lock query observes the post-wait time and correctly returns `SESSION_NOT_OPEN` — proves the separate-subsequent-query shape, not just any `clock_timestamp()` use | real-PG unit, deterministic barrier | codex round-02 [P1], round-03/04/05 [P2] |
| REG-CLOCK3 | Regression (codex round-03/04 [P2]) | hold the session row `FOR UPDATE` on a separate connection; start a real publish (blocks); wait 500ms while still blocked; release | the resulting `updated_at` is at or after a reference instant read from the DB's own `clock_timestamp()` right before the wait (codex round-04 [P2]: not `Date.now()`, which would be skew-sensitive against a DB-generated column) — proves the mutate step's `clock_timestamp()` also reflects post-wait time, not a frozen transaction-start value | real-PG unit, deterministic barrier | codex round-03/04 [P2] |
| B4 | Boundary | publish a `public` `draft` missing area / finite slots_max | `MISSING_DISCOVERY_FIELDS`; zero mutation (before the transition) | unit | BE#22; §4 step 5 |
| B5 | Boundary | publish a `sessionId` absent in tenant context | `SESSION_NOT_FOUND`; zero mutation | unit | §3 error codes SESSION_NOT_FOUND |
| AUTHZ1 | Authorization | publish a valid `draft` when the tenant is billing-`suspended` (tenants.status='suspended') | `TENANT_SUSPENDED` (authz decision); zero mutation, **no** `session.published` event; row stays `draft` | real-PG unit | BE#24; §4 step 6; DD-105 |
| AUTHZ2 | Authorization | publish when the SUBSCRIPTION is suspended/cancelled (tenants.status active) | `TENANT_SUSPENDED`; zero mutation (fail-closed 2-step union) | real-PG unit | BE#24; billing §3 |
| AUTHZ3 | Authorization | publish when the tenant has NO subscription row (active tenant) | `TENANT_SUSPENDED` (case 4 fail-closed) | real-PG unit | billing §3 case 4 |
| AUTHZ4 | Authorization / **authz-beats-replay** | a tenant suspended AFTER a successful publish, then the SAME commandId is replayed | `TENANT_SUSPENDED` (not the stored success); exactly one event / one processed_commands row — the suspended replay mutates nothing | real-PG unit | BE §4 step 1 (authz before dedup, authz wins no-op) |
| AUTHZ5 | Authorization / **authz-beats-no-op** | a NEW commandId against an already-`open` session in a now-suspended tenant | `TENANT_SUSPENDED`; the no-op path does NOT run — no processed_commands row written for the new id; still exactly the one prior publish event | real-PG unit | BE §4 step 1 (authz wins no-op) |
| CONC1 | Concurrency / job-first | a job-shape holder takes `subscriptions FOR UPDATE` then suspends WHILE publish is blocked on its own `FOR SHARE` billing read | publish blocks, observes the fresh `suspended` value, denies; zero mutation, no event | real-PG unit, deterministic barrier | billing #36 through publishSession: the job claims its EXACT eligible row (paid `past_due`, grace elapsed, `JOIN plans WHERE price>0 ... FOR UPDATE SKIP LOCKED`) and suspends mid-race; publish's `FOR SHARE` blocks, observes `suspended`, denies (§0.3 finding 1) |
| CONC2 | Concurrency / publish-first, real in-flight | a REAL publish is blocked at its outbox insert (past its billing lock + session update) while a competing `SKIP LOCKED` subscription claim runs | the competing claim returns zero rows (deferred); once unblocked, publish completes `status='open'`, exactly one event | real-PG unit, deterministic barrier | billing #36a through publishSession: the job's EXACT eligible-row claim (`JOIN plans WHERE price>0 ... FOR UPDATE SKIP LOCKED`) defers against the real in-flight publish's `FOR SHARE`; publish then commits `open`, exactly one event (§0.3 finding 1) |
| CC1 | Concurrency / dedup-replay | same `(tenant_id, command_id)` publish submitted twice, sequentially | second returns the stored envelope; zero new outbox / processed_commands; `version` unchanged | real-PG unit | edge #3; §4 step 3 |
| CC1b | Concurrency / dedup-replay, real race | same `(tenant_id, command_id)` publish submitted twice via `Promise.all` (genuinely concurrent, not sequential) | one call returns fresh (`replayed:false`), the other replays (`replayed:true`); exactly one outbox row, one `processed_commands` row — proves the advisory lock actually serializes, not just that a later sequential call replays | real-PG unit | edge #3; codex round-01 [P1] |
| CC2 | Concurrency / foreign ledger | a `processed_commands` row under this `commandId` owned by a different `command_type` (or a corrupt PublishSession result) | fail-closed `COMMAND_ID_CONFLICT`, not a raw 23505 / not a false replay | real-PG unit | edge #3 fail-closed |
| CC2c | Concurrency / cross-session replay | a commandId reused for session B after publishing session A | fail-closed `COMMAND_ID_CONFLICT` for B, not a false replay of A's success; B stays `draft`, A unchanged | real-PG unit | replay bound to input.sessionId |
| CC2d | Concurrency / canonicalization | publish + replay using an UPPER-CASE session id | both succeed; the replay is recognized (canonical lower-case id), not a false `COMMAND_ID_CONFLICT` | real-PG unit | sessionId canonicalization |
| VER1 | Concurrency / optimistic | publish a `draft` with `expectedVersion` ≠ live `version` under lock | `STALE_VERSION`; zero mutation. (expectedVersion omitted on an `open` session still returns no-op success — idempotency wins) | real-PG unit | §1 STALE_VERSION; §4 step 6 |
| OBS1 | outbox-exactly-once | one successful publish, then a `commandId` replay | publish writes **exactly one** `session.published`; replay writes none. `payload` is the whitelist `{session_id, tenant_id, visibility}` only — no roster/PII/venue | real-PG unit | events:508; edge #3 |
| SEC1 | cross-tenant-invisibility | create+publish in tenant A, then read/publish as tenant B | tenant B cannot see or publish A's session: publish as B → `SESSION_NOT_FOUND` (RLS hides the row under B's GUC, no tenant predicate in the lock query) | real-PG unit + rls-invariants unchanged-green | Bất biến (RLS choke-point); BE §4 Security |
| SEC2 | trusted-context | `tenantId` non-UUID | `assertTenantId` throws (never trusts payload) | unit | Bất biến; BE §1 |
| MIG1 | Migration | — | **NONE**: zero migration, zero schema.ts change; reuses merged substrate (sessions/status enum 0002, processed_commands + outbox 0005, lease/ack 0022/0023, authorizeTenantAction, resolve_tenant_status_locked 0027). A diff touching any migration or schema.ts is a STOP_CONDITION | scope gate | §0 NEGATIVE_SCOPE |
| REG1 | Regression | run the canonical db suite | `rls-invariants.test.ts` + the createSession tests stay green; the full db suite stays green (exact count: the gate's own verification artifact, not this table) | full db suite | canonical runner |

## 7. Closure matrix (12/12) + canonical verdict — HISTORICAL, as originally reached at 519fb9f

> Preserved verbatim from the original `CODE_READY` analysis. It is evidence of why the design was ready
> to build, not a live instruction — see the STATUS banner at the top of this document and §0.2.

### 7.1 Closure matrix — 12/12 PASS

| # | Gate | Evidence | PASS/FAIL |
|---|---|---|---|
| 1 | Authority snapshot pinned by SHA | frozen base `519fb9f91fffe4712668f24a1af697d5f1a002bd`; exact TARGET_FILES (§7.2), no glob | PASS |
| 2 | In-scope decisions closed | DD-105 (owner 2026-08-13) settles suspension: publish gated ❌; no product choice left on the publish path | PASS |
| 3 | Scope IN/OUT + owner clear | §0 SCOPE / NEGATIVE_SCOPE; mechanism-named (PublishSession boundary); one writer; cancel-draft dropped (§0.1) | PASS |
| 4 | Dependency classified | all MERGED on base: sessions/status enum (0002), processed_commands + outbox (0005), lease/ack (0022/0023), authorizeTenantAction (authorization.ts:91) + publish_new_sessions class, resolve_tenant_status_locked (0027), withTenant/tenantRepo (tenant.ts) — verified at 519fb9f | PASS |
| 5 | Live schema/code matches doc | verified at 519fb9f: session-service.ts (createSession), authorization.ts:25-138, schema.ts:598-616/1296/1308-1360, tenant.ts:29-105 | PASS |
| 6 | Data/API/state/auth contract complete | §2 mechanism steps 1-12, §4-6 acceptance matrix, outbox producer insert (§2 step 11), error codes (BE §3), authz gate (BE §4 step 6) | PASS |
| 7 | Fail-closed / idempotency / order pinned | authz-fail-fast FIRST (§2 step 2 — authz beats replay/no-op, BE §4 step 1), then dedup (edge #3, replay bound to input.sessionId), billing authz serializes against a concurrent Daily-Lifecycle-Job suspend via a retained `FOR SHARE` locking read (established at §2 step 2, re-affirmed under lock at §2 step 9 — see the §2 step 9 note on the helper's lock-retention), no-op-before-transition-guard order, per-aggregate sequence + outbox_agg_seq_uq fence, RLS by construction | PASS |
| 8 | In-scope open questions = 0 | publish path fully specified; cancel-draft is a named follow-up (§0.1), not an in-scope open question | PASS |
| 9 | Acceptance matrix has expected results | §4-6 rows A1..REG1, each with expected state/output + test layer | PASS |
| 10 | Migration / security / rollback pinned | zero migration (STOP_CONDITION guards it); security = authz/suspension trust boundary → security round (§0 SECURITY_REVIEW) + cross-tenant RLS invariant (SEC1); rollback = revert the file diffs | PASS |
| 11 | First slice hard deps merged | sibling of merged createSession; all substrate merged + verified at 519fb9f | PASS |
| 12 | Implementation handoff ready | this contract + authored manifest, mutually consistent; runtime manifest authored at register (first build step) | PASS |

### 7.2 Verdict — canonical block (historical: the original CODE_READY analysis at 519fb9f)

```text
REVIEW_POLICY_VERSION: 1.3
REVIEW_VERDICT: CODE_READY
REVIEWED_AT: 2026-08-14
AUTHORITY_SHA: 519fb9f91fffe4712668f24a1af697d5f1a002bd
BASE_BRANCH: main
TARGET_FILES:
  - docs/features/BE/feature_session_management_tech.md
  - packages/db/src/session-service.ts
  - packages/db/src/authorization.ts
  - packages/db/schema.ts
  - docs/standards/decisions.md
SLICE: session-draft-lifecycle-commands
IN_SCOPE: the PublishSession command boundary as one service function in one withTenant transaction —
  dedup lookup in processed_commands (fail-closed COMMAND_ID_CONFLICT), session FOR UPDATE lock,
  idempotent-open no-op, transition/public/version guards, under-lock billing re-check via
  authorizeTenantAction('publish_new_sessions') (fail-closed TENANT_SUSPENDED), draft->open + version bump,
  exactly one session.published outbox row (payload session_id/tenant_id/visibility), processed_commands
  result; plus its real-PG tests, index.ts export, and this packet's own files.
OUT_OF_SCOPE: cancel-draft / CancelSession / update / close / announce / delete commands (cancel-draft is a
  named follow-up, §0.1); the public_sessions projector or any public projection; any route/API/UI; any
  billing file; any NEW action-class literal (publish reuses publish_new_sessions); any migration or
  schema.ts change; projector/dispatcher/schedule; createSession.
G1_DECISION: PASS
G2_SPEC: PASS
G3_DEPENDENCY: PASS
G4_TEST: PASS
G5_SCOPE: PASS
G6_EXTERNAL: PASS
HARD_DEPENDENCIES: none — sibling of the merged root slice. sessions/status-enum (0002),
  processed_commands/outbox (0005/0022/0023), authorizeTenantAction + publish_new_sessions (authorization.ts,
  merged, 0 callers), resolve_tenant_status_locked (0027), withTenant/tenantRepo (tenant.ts) all merged on
  main, verified 2026-08-14 at 519fb9f.
PRIOR_SLICES: session-service-create-command-core (merged on base — createSession + the outbox producer
  pattern + processed_commands dedup this slice mirrors).
OPEN_QUESTIONS_IN_SCOPE: 0
ENABLEMENT_ONLY_GATES: none
LIVE_REPO_VERIFICATION: PASS
CONTRACT_MATRIX: PASS
CLOSURE_MATRIX: PASS
ACCEPTANCE_MATRIX: PASS
SECURITY_AND_MIGRATION_GATE: PASS
IMPLEMENTATION_ARTIFACTS: PASS
FIRST_IMPLEMENTATION_STEP (historical — DO NOT execute; the build already happened on --v2): author the
  runtime manifest .autopilot/state/session-draft-lifecycle-commands/manifest.json from the authored
  manifest (schema level3-operational-v2), register it via scripts/autopilot-scope-gate, confirm
  .autopilot/state/session-draft-lifecycle-commands/registered-manifest.sha256 exists, open one worktree
  from the frozen base, then implement publishSession in packages/db/src/session-service.ts per §2
  mechanism + §4-6 acceptance matrix with session-service.test.ts on real PG.
REMAINING_BLOCKERS: none
```
