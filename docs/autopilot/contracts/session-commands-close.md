# session-commands-close — slice contract (CloseSession, B1 of the split)

> **Authority:** `docs/standards/decisions.md` **DD-110 D1/D2/D3** (`close_session` is a ✅-under-suspension
> *obligation-termination* class; its literal enters the enum in the commit that lands the command) +
> **DD-110 Amendment 2026-08-26** (`6c67d72`, on `origin/main`: the suspension guard reads the LITERAL status,
> not the `effective_status` bucket — the durable authority this slice's `close_session` authz enforces) +
> **DD-117 D1/D3** (close with a finance root → fail-closed `CANCEL_REQUIRES_REVIEW`) + **DD-117 D5**
> (commandId-only dedup, content fingerprinting REJECTED) + **DD-12** (immediate-deny path — a
> privacy-reducing mutation raises `raise_public_session_fence(...)` in the same source transaction). This
> packet is a **contract + findings record**, not a review verdict.
> **Base (slice fork / immutable `base_sha`):** `3045c7f7802be3c5ef77f064ab00399e5d32b946` — current
> `origin/main` at fork. It carries migration `0033` (the fence functions + `public_projection_fences` + the
> guarded view `public_session_share_v`), the `update_open_session` / `announce_session` authorization
> classes, and the shared fence core `packages/db/src/public-session-fence.ts`. This slice adds NO migration
> and does NOT modify the fence functions/view/grants; the diff under review is exactly `3045c7f...HEAD`.

## Why this slice — B1 of the owner-ratified SPLIT

`CreateSession` · `PublishSession` · `AnnounceSession` · `UpdateSession` already land on the base. The two
obligation-terminating commands of the DD-110 family — **CloseSession** and **CancelSession** — were first built
as one slice, `session-commands-close-cancel`. That slice was clean on round 1 both times but surfaced a fresh
coverage corner on later rounds and hit **MAX_ROUNDS twice** (the two-command surface is too wide for one
loop budget). The owner ratified a **SPLIT (2026-08-26)**:

- **B1 = CloseSession** (this slice — the simpler half: an `open` session wound down normally; **no**
  past-guard, **no** draft-anomaly audit, **no** roster_count).
- **B2 = CancelSession** — lands **sequentially AFTER B1** (same file `session-service.ts`, so **no parallel
  writers**). B2 carries `cancel_session` (row/literal/handling), the cancel past-guard (edge #31), the
  draft-anomaly audit event (edge #28), and `sessionActiveRosterCount`.

CloseSession is ported from the read-only reference tag
`ap-reference/session-commands-close-cancel-v2-d9e1148` (the twice-MAX_ROUNDS branch, 658 tests green),
incorporating the fixes accumulated there **plus finding #1** (the no-op-wins version ordering, below). The
reference branch stays read-only; this slice is a fresh registration from `origin/main`.

## Design decision — obligation-termination tolerates a SUSPENDED tenant OR subscription (DD-110 D2)

Unlike `announce_session` / `update_open_session` (❌ suspended — new commercial activity), `close_session` is
**✅ for active/past_due/`suspended`** (the DD-110 D2 matrix's three columns). A suspended tenant must still be
able to **terminate a running obligation** (close a session it can no longer service); suspension freezes NEW
commercial activity, not the winding-down of existing ones. Mechanically it does **NOT** bypass the resolver —
it runs the **same fail-closed two-step** as every other recognised class and merely **ADDS** the `suspended`
state to the allow-set on **BOTH axes** (tenant AND subscription). DD-110 D2 accepts this explicitly,
**including a tenant-root abuse/ToS suspension** ("một tenant abuse huỷ được buổi của chính nó — phiền, không
phải thiệt hại"), and its ⚠️ note says the gate cannot distinguish the two suspension axes and that building that
distinction is **out of scope** — so `suspended` is allowed without asking which axis it came from. Every OTHER
deny is unchanged: a `cancelled`/missing/anomalous **TENANT or SUBSCRIPTION** still fails closed.

**Owner-ratified reading (2026-08-26).** The suspension guard compares the **LITERAL** `subscriptions.status` /
`tenants.status` value; it does **NOT** compute or infer an `effective_status` bucket; any status literal it
does not recognise is treated **fail-closed**. So each axis's allow-set carries the LITERAL `'suspended'`
**only** — NOT the billing §3 `effective_status='suspended'` BUCKET that the status-authority resolution
(billing §3 cases 1b/2b/4) collapses `cancelled` / missing-row / anomalous states into. The §3 collapse exists
so PUBLISH (❌ suspended) fail-closes those states through one matrix cell; applying the ✅-suspended cell to the
whole bucket would instead **fail-OPEN** close on terminal/anomalous tenants. The code reads the raw column and
allows only a genuine `'suspended'`, keeping `cancelled`/missing/anomalous fail-closed on either axis. **The
two-axis unpaid-vs-abuse limitation inherited from DD-110 is UNCHANGED and remains a named limitation.** The
**formal `decisions.md` amendment** pinning this literal reading under DD-110 is now **LANDED on `origin/main`
as commit `6c67d72` (2026-08-26)** — authored ahead of B1's gate per the owner's corrected sequencing (B1's
`close_session` authz IS this interpretation, so DD-111 D4 requires the durable authority to precede the code
review). It quotes this exact predicate verbatim from `authorization.ts`. This slice's diff does **not** edit
`decisions.md` (out of scope); the authority is on the base ref (`origin/main`), readable by the reviewer.
See F8.

## Design decision — fail-closed money guard `CANCEL_REQUIRES_REVIEW` (DD-117 D1/D3)

Closing a session that carries **any charge** is a **fail-closed refuse**, NOT a silent status flip: the command
throws `CANCEL_REQUIRES_REVIEW` and mutates nothing, until the payments/review_policy subsystem exists to
resolve the finance root (spec edge #5 — "no silent cancellation"). The guard is keyed on the **session's own
`charges`**, probed under the tenant GUC — NOT on billing status. This is the same fail-closed posture
UpdateSession's price guard uses (DD-117 D3). `sessionHasCharges` has **NO status filter** — a `void`-only
charge still blocks (C-VOID). A `charges` row binds its player only by `(tenant_id, player_id)` (0019 FK), not
by `session_id`, but for CLOSE that is immaterial: close operates only on an `open` session and refuses on ANY
`charges` row scoped to the session — there is no draft-anomaly branch here (that is B2).

## Design decision — commandId-only dedup (DD-117 D5)

Close dedups on `(tenant_id, command_id)` **ONLY**, exactly like the five sibling commands; content
fingerprinting is **REJECTED** (no PII-derivative ledger). The stored envelope carries EXACTLY
`{sessionId, status, version}` — no request content. A replayed `command_id` for the SAME session returns the
stored result; a different session OR a foreign command_type OR a corrupt same-type envelope → `COMMAND_ID_CONFLICT`.

## Design decision — DD-12 fence raised UNCONDITIONALLY on the terminal transition

`closed` is a privacy-reducing terminal state — a public listing must stop being served **immediately**, not
after the async projector. Close raises the DD-12 fence in its **own** transaction via the shared
`raisePublicSessionFence(tx, sessionId, 'closed')` core (`'closed'` is exactly `0033`'s enum — none invented).
The raise fires on **every** successful close **regardless of prior status or visibility** (owner carry-forward
2026-08-25, same rationale as UpdateSession's draft ruling: the fence PRODUCER must not depend on the unbuilt
projector's assumptions — the guarded view `public_session_share_v` has no `sessions.status` predicate, so "a
private row is never served" is a projector assumption, not a schema guarantee). The SECURITY DEFINER function
verifies the session is in the caller's tenant, so the raise is inside `withTenant`. The projector-worker
CAS-clears the fence later — a **separate lane**; this slice only RAISES.

## Mechanism — `closeSession`

Terminate an `open` session normally, one `withTenant` transaction, on the S2 pattern: upfront
`authorizeTenantAction(tx, tenantId, 'close_session')` (allowed for active/past_due/`suspended` on either axis;
DENIES a `cancelled`/missing subscription or a `cancelled`/anomalous tenant → `SessionCloseAuthorizationError`)
→ validate session-IDENTITY (`sessionId`) → advisory-xact command-key lock → dedup (`processed_commands`,
commandId-only, fail-closed on foreign/corrupt row; **a replay short-circuits here**) → lock session
`FOR UPDATE`, read current row → **idempotent no-op if already `closed`** → transition guard → **int4 +
mandatory `expected_version`** → charge guard → mutate → fence → event → record.

- **Idempotent no-op (edge #27 — WINS over the version guard):** an already-`closed` session returns the stored
  current envelope (no version bump, no event) **without checking `expected_version` at all** — neither its
  int4 validity nor its match. This is finding #1's ordering (below): the int4 validation runs on the mutate
  branch only, AFTER this no-op.
- **Transition guard (edge #11):** only `open` → `closed`. `draft` / `cancelled` → `SESSION_NOT_OPEN`. **NO
  past-guard** — closing a session whose `starts_at` has passed is legitimate completion (unlike cancel, whose
  past-guard is B2). (C-PAST.)
- **Optimistic version (edge #26) — MANDATORY on the mutate branch:** a PROVIDED value is validated as a
  positive int4 first; then missing OR ≠ the live version under lock → `STALE_VERSION`. Checked **before** the
  money guard (a stale charged request → `STALE_VERSION`, not `CANCEL_REQUIRES_REVIEW` — C-STALE-CHARGE).
- **Charge guard (edge #5, DD-117):** ANY `charges` row on the session → `CANCEL_REQUIRES_REVIEW`; zero
  mutation, no event. `void`-only still blocks (C-VOID).
- **Suspension:** the upfront `authorizeTenantAction('close_session')` allows a `suspended` LITERAL on **either
  axis** (DD-110 D2) so a suspended tenant still closes — but it **can DENY**: a `cancelled`/missing
  subscription, or a `cancelled`/anomalous **tenant**, fails closed → `SessionCloseAuthorizationError`
  (`TENANT_SUSPENDED`) upfront, before the session is touched. It is NOT an always-allow.
- **Mutate:** `status = 'closed'`, `version` + 1, `updated_at = clock_timestamp()`.
- **DD-12 fence:** `raisePublicSessionFence(tx, id, 'closed')` in the SAME tx (unconditional).
- **Event (§4):** one `session.closed` (`{session_id, close_reason: 'manual'}`, exact key-set, no `tenant_id`).
- **Idempotency (edge #3, DD-117 D5):** stored envelope EXACTLY `{sessionId, status, version}`.

## Findings (owner-requested durable record)

- **FINDING #1 (owner: REAL BUG, not a test gap) — the int4/version validation runs AFTER the terminal no-op.**
  In the predecessor, `isInt4(expectedVersion)` ran on the mutate path but an early guard could have let a
  malformed `expectedVersion` shadow the idempotent no-op. The owner ruled the correct behavior is: an
  already-`closed` session with a malformed `expectedVersion` (e.g. `0`, below the int4 min of 1) is
  **no-op-wins** (edge #27 no-op-wins-over-version), NOT `STALE_VERSION`. The fix places the `status === 'closed'`
  no-op branch FIRST (it returns before any version logic), and the int4 check
  (`if (expectedVersion !== undefined && !isInt4(expectedVersion, 1))`) on the mutate branch only, after the
  transition guard. Pinned by **C-NOOP-BADVER**: the SAME malformed `0` on an already-`closed` session succeeds
  as a no-op while on an `open` session it is `STALE_VERSION` — same input, opposite outcome, the only
  difference being whether the no-op branch fired first. (`session-service.ts` closeSession no-op/version block.)
- **FINDING #2 (owner) — competing-writer concurrency coverage.** Two concurrent `closeSession` commands with
  distinct `command_id`s and the SAME initial version, gated behind a holder's `FOR UPDATE` so the race is
  DETERMINISTIC (mirrors updateSession's `U-RACE`). Unlike update (distinct patches → the loser hits
  `STALE_VERSION`), close's loser reads `status='closed'` under `FOR UPDATE` after the winner commits and takes
  the idempotent no-op branch — so BOTH resolve successfully, but exactly ONE mutates and emits an event.
  Pinned by **C-RACE** (one `session.closed`, `version`+1, loser no-ops, not a double event, not `STALE_VERSION`).
- **F1 — the guard uses the typed Drizzle table.** `sessionHasCharges` probes `.from(charges)` for ANY row on
  the session (`.limit(1)`, no status filter — a `void`-only charge still blocks, matching UpdateSession's
  fail-closed money posture), scoped by `session_id` under the tenant GUC. (`sessionActiveRosterCount` /
  `sessionHasAnyPlayer` are B2 — close has no roster/anomaly branch.)
- **F4 — `index.ts` barrel export deferred (scope-minimalism).** `closeSession` is tested via direct import
  from `./session-service.js`. **Backlog:** `session-command-barrel-export` (shared with the update slice).
- **F5 — `close_reason` is the literal `'manual'`.** This slice is the manual owner-command path only.
  Automated close (session ended) reasons enter when their producer lands; the event key is present so that
  producer only widens the value, not the shape.
- **F6 — the obligation-termination `authorizeTenantAction` call is a REAL gate that can DENY, not a
  choke-point-shape retention.** DD-110 D2 relaxes the `suspended` cell on BOTH axes — so for `close_session` a
  `suspended` tenant OR subscription is allowed, but the resolver still DENIES a `cancelled`/missing
  subscription or a `cancelled`/anomalous TENANT → `SessionCloseAuthorizationError` (`TENANT_SUSPENDED`) upfront,
  before the session is touched. The call routes the four landed status-gated commands — publish, announce, update,
  and now close — through the one authorization choke-point. (`createSession` is DD-105-exempt: a draft is
  invisible-until-publish and money-free, so the resolver is NOT called; `cancel_session` lands with B2.)
  Two codex [P1]s from the predecessor bracket the exact boundary: a round caught a blanket
  short-circuit that allowed EVERY state (incl. cancelled/missing/unknown); a later round caught the
  over-correction that then denied a tenant-root `suspended`. The `AUTHZ-CC` resolver tests and the
  `C-SUSPENDED`(-`TENANT`) allow vs `C-CANCELLED-TENANT` deny service tests pin both sides.
- **F7 — close guard order: no-op → transition → int4/version → money.** Version is checked before the money
  guard, so a stale charged request → `STALE_VERSION` (C-STALE-CHARGE), and the no-op precedes the version
  guard (finding #1). Close has **NO past-guard** — the cancel-scoped past-guard (edge #31) and its guard-order
  reconciliation (transition/past → version → paid-impact) are **B2**.
- **F8 — DD-110 D2's ✅-suspended cell is read as the LITERAL column value, and this is now OWNER-RATIFIED.**
  The billing §3 status-authority resolution collapses subscription `cancelled` / missing-row / anomalous
  states into `effective_status='suspended'` (cases 1b/2b/4), so PUBLISH (❌ suspended) fail-closes them through
  one matrix cell. Applying the close ✅-suspended cell to that bucket would fail-OPEN close on
  terminal/anomalous tenants. The code reads the raw `subscription.status`/`tenants.status` column and allows
  only a genuine `'suspended'`, keeping `cancelled`/missing/anomalous fail-closed. In the predecessor this was
  the slice's fail-closed IMPLEMENTATION INTERPRETATION pending an owner decision; the **owner ratified it
  in-session on 2026-08-26** (the LITERAL-not-bucket principle above). The **formal `decisions.md` amendment**
  under DD-110 (owner-attributed, Vietnamese, quoting the exact predicate as it exists in code) is now **LANDED
  on `origin/main` as commit `6c67d72` (2026-08-26)** — authored ahead of B1's gate per the owner's corrected
  sequencing, because B1's `close_session` authz IS this interpretation, so DD-111 D4 requires the durable
  authority to precede the code review. This slice's diff does NOT edit `decisions.md` (out of scope); the
  authority is on the base ref and readable by the reviewer. Pinned this slice by `AUTHZ-CC` (cancelled/missing
  subscription + cancelled tenant + unknown → DENY) and `C-CANCELLED-TENANT`.
- **F9 — dedup rejects a same-type but CORRUPT stored envelope, not only a foreign type.** `isStoredCloseResult`
  validates the stored `result_ref` (UUID sessionId, exact terminal status, int4 version) before a replay is
  honored; a same-`command_type` row with a malformed envelope (out-of-int4 version) → `COMMAND_ID_CONFLICT`,
  never a trusted replay. Pinned by the extended `C-DED`.
- **F10 — OWNER-ASKED: does the already-merged `updateSession` carry the same ordering as finding #1? ANSWER:
  PARTIALLY — the int4-VALIDITY check runs BEFORE its no-op branch (the pre-fix close ordering), by explicit
  design; the version-MATCH does not.** Precise reading of `session-service.ts` `updateSession`: the
  `isInt4(expectedVersion, 1)` **validity** check sits at the top of the command (before the `FOR UPDATE`, well
  before the "nothing to change" no-op branch), with an in-code comment (paraphrased) that this is deliberate so
  "a malformed value cannot slip through the no-op branch." Consequence: a no-op update (all provided fields
  already equal current) carrying a **malformed** `expectedVersion` (e.g. `0`, non-positive-int4) → `STALE_VERSION`,
  **NOT** a no-op — which is exactly the ordering finding #1 REMOVED from close (close now runs int4 AFTER the
  no-op, so already-`closed` + `0` → no-op wins). By contrast, updateSession's no-op DOES win over the
  version-**MATCH** (a valid-but-mismatched version on a no-op update → no-op, same as close). So the divergence
  is narrow and specific: only a **non-int4** version, and only for update's "nothing to change" no-op — which is
  a *goal-reached* no-op, not a *terminal-state replay* like close's already-`closed`. Whether update should be
  aligned to finding #1's no-op-wins-over-malformed-version ruling is a **semantic decision for the owner** (the
  two no-op kinds differ); it is a **live behavior on `main`**. Per the owner's directive this is **NOT fixed in
  B1** (negative scope explicitly excludes any `updateSession` edit) — it is reported as its own small lane,
  `updateSession-noop-vs-malformed-version-ordering`. Recorded durably **here** (this packet is the record, same
  as the reference slice recorded its own out-of-scope edge #31 observation in-packet rather than editing the
  out-of-scope backlog) and surfaced in the READY report for the owner to schedule; `docs/autopilot-backlog.md`
  is outside this slice's registered scope, so filing there is the owner's/next-slice's call, not a B1 edit.

## Acceptance matrix (real-PG unless noted)

| # | Group | Precondition | Expected | Layer |
|---|---|---|---|---|
| C1 | Happy (close) | `open` session, correct `expected_version`, tenant active | `status='closed'`; `version`+1; one `session.closed` (exact key set); `processed_commands` row | real-PG |
| C2 | Boundary | close a `draft` | `SESSION_NOT_OPEN`; zero mutation, no event | real-PG |
| C3 | Boundary | close a `cancelled` session | `SESSION_NOT_OPEN` | real-PG |
| C-NOOP | Idempotent | close an already-`closed` session (no `expected_version`) | no-op success, version unchanged, no duplicate event | real-PG |
| C-NOOP-BADVER | Ordering (finding #1 / edge #27) | already-`closed` + malformed `expected_version` `0`; and the SAME `0` on an `open` session | already-closed → **no-op success** (int4 check never runs); open → `STALE_VERSION` (int4 rejects on the mutate branch) — proves the no-op precedes the version validation | real-PG |
| C-VER | Boundary | `expected_version` mismatch; and OMITTED on the mutate branch | `STALE_VERSION` both; zero mutation | real-PG |
| C-CHARGE | Money (edge #5) | close an `open` session carrying ANY charge | `CANCEL_REQUIRES_REVIEW`; zero mutation, no event | real-PG |
| C-VOID | Money (edge #5, fail-closed) | close an `open` session whose ONLY charge is `void` | `CANCEL_REQUIRES_REVIEW` — `sessionHasCharges` has NO status filter, a `void` charge still blocks (DD-117); zero mutation, no event | real-PG |
| C-STALE-CHARGE | Guard order (edge #26/#5) | close a charged `open` session with a stale `expected_version` | `STALE_VERSION`, NOT `CANCEL_REQUIRES_REVIEW` — version checked before the money guard; zero mutation, no event | real-PG |
| C-SUSPENDED | Suspend (DD-110 D2) | close an `open` session while the SUBSCRIPTION is suspended | SUCCEEDS (obligation-termination — relaxed cell, subscription axis) | real-PG |
| C-SUSPENDED-TENANT | Suspend (DD-110 D2) | close while the TENANT (abuse/ToS) is suspended | SUCCEEDS — DD-110 D2 allows the suspended cell on BOTH axes, incl. an abuse tenant closing its own session | real-PG |
| C-CANCELLED-TENANT | Suspend (DD-110 D2, fail-closed) | close while the TENANT is `cancelled` (terminated) | DENIED → `SessionCloseAuthorizationError` (`TENANT_SUSPENDED`); zero mutation | real-PG |
| C-PAST | Boundary | close an `open` session whose `starts_at` has PASSED | SUCCEEDS — close has NO past-guard | real-PG |
| C-FENCE | Privacy (DD-12) | close an `open` public session projected to `public_sessions` | fence `'closed'` fires in-tx; `public_session_share_v` denies IMMEDIATELY while the base row still exists | real-PG |
| C-FENCE-PRIVATE | Privacy (DD-12) | close a `private` session that carries a STALE public projection | fence `'closed'` STILL fires (raise is unconditional, NOT gated on prior visibility); guarded view denies | real-PG |
| C-DED | Dedup (DD-117 D5) | same `command_id`: same session · different session · foreign command_type · **corrupt same-type envelope** | same session → stored envelope; different session / foreign type / corrupt same-type (out-of-int4 version) → `COMMAND_ID_CONFLICT`; only one event total | real-PG |
| C-RACE | Concurrency (finding #2) | two competing closers, distinct `command_id`, SAME initial version, holder-gated `FOR UPDATE` | exactly ONE real close (one `session.closed`, `version`+1); the loser reads the closed row under `FOR UPDATE` and no-ops (NOT `STALE_VERSION`, NOT a double event) | real-PG |
| C-SEC | Cross-tenant | close tenant A's session as tenant B | `SESSION_NOT_FOUND` via RLS `FORCE`; zero mutation | real-PG |
| AUTHZ-CC | Auth-resolution (DD-110 D2) | `authorizeTenantAction('close_session')` across billing states | normal states → `{allowed, effectiveStatus}`; `suspended` LITERAL on EITHER axis (tenant, subscription, or both) → `{allowed, obligationTermination:true}`; `cancelled`/missing subscription, `cancelled` TENANT, and unknown tenant → DENY | real-PG (authorization.test.ts) |
| MIG1 | Migration | — | NONE: zero migration, zero `schema.ts` (0033 fence functions already on the base) | scope gate |
| REG1 | Regression | canonical db suite | rls-invariants + full db suite stay green | full db suite |

## Scope

Ships **CloseSession ONLY** — one SessionService command, one `withTenant` transaction, reusing the shared
fence core.

**In scope:** `packages/db/src/authorization.ts` (`close_session` → `ActionClass` + `RECOGNIZED_ACTION_CLASSES`
+ the `OBLIGATION_TERMINATION` set that adds the `suspended` LITERAL to the allow-set on both axes + the
`obligationTermination` decision variant), `packages/db/src/session-service.ts` (`closeSession` + its
`sessionHasCharges` probe + its fence raise), the two test files (`authorization.test.ts`,
`session-service.test.ts`), `docs/features/BE/feature_billing_lifecycle_tech.md` (the ONE `close_session` matrix
row + note + changelog), this packet.

**Out of scope (see manifest `negative_scope`):** **NO CancelSession / `cancel_session` / `sessionHasAnyPlayer`
/ `sessionActiveRosterCount` / past-guard / draft-anomaly / `session.expiry_anomaly_detected` / roster_count**
(all B2, the sequential successor); **NO migration / `schema.ts`** (0033 already on the base — this slice only
CALLS the fence); **NO edit to `public-session-fence.ts`** (reused verbatim); any request fingerprint /
PII-derivative storage (DD-117 D5); the projector + CAS-clear wiring (a separate lane); `index.ts` barrel export
(F4); routes/API/FE; DeleteSession (DD-104); **NO edit to `updateSession` (incl. its own no-op/version ordering
— F10, a separately-reported live-bug lane)**; a refund / payment / review_policy mutation — the finance root is
REFUSED, never resolved here (DD-117); and **any edit to `docs/standards/decisions.md`** (the literal-suspended
DD-110 amendment already LANDED on `origin/main` as `6c67d72` (2026-08-26) — the owner authored it directly
on main ahead of B1's gate, so it is not in this slice's diff).
