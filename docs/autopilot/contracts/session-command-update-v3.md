# session-command-update-v3 — slice contract (UpdateSession + DD-12 immediate-deny fence)

> **Authority:** `docs/standards/decisions.md` DD-117 **incl. D5** (commandId-only dedup, content
> fingerprinting REJECTED) + DD-110 D1/D2/D3 (`update_open_session`) + DD-105 (draft update exempt from the
> suspension gate) + DD-112 (capacity guarded by `CAPACITY_BELOW_ROSTER` only) + **DD-12 (immediate-deny
> path)** — a privacy-reducing mutation raises `raise_public_session_fence(...)` in the same source
> transaction. This packet is a **contract + findings record**, not a review verdict.
> **Base:** `origin/main` @ `1215a6a5037b1cd895f18874d54d71ff11f9c026` (has migration 0033 — the fence
> functions, `public_projection_fences`, and the guarded view `public_session_share_v`).

## Why v3 — base drift from v2

v3 is the successor to `session-command-update-v2`, which built correctly against `e5baf9e` (5 converged fix
rounds, verify green) but was **closed BASE_DRIFT**: while it was building, `origin/main` merged
`public-projection-fences` (migration `0033`, DD-12). DD-12 requires a **privacy-reducing mutation** to raise
the immediate-deny fence **in its own transaction**, and `updateSession` public→private is such a mutation —
but the fence functions were **absent on `e5baf9e`**, so v2 could not satisfy it (and the run base must never
be rebased). v3 re-registers on current `main` (which has `0033`, so the dependency is satisfied), **ports the
converged v2 updateSession VERBATIM**, and **adds the fence integration**. The v2 branch
`feat/session-command-update-v2` is retained as read-only reference.

## Design decision — commandId-only dedup (DD-117 D5), carried forward UNCHANGED

`updateSession` dedups on `(tenant_id, command_id)` **ONLY**, exactly like createSession/publishSession/
announceSession; content fingerprinting is **REJECTED** (no PII-derivative ledger storage; no pepper/KMS
surface). The prior `updateRequestFingerprint()` stored an unkeyed SHA-256 over low-entropy location PII in a
delete-surviving ledger (dictionary-recoverable, the P1 that HALTed the first lane). **A reviewer re-raising
"bind replay to request content" (the round-2 class) is OUT-OF-CONTRACT** — cite DD-117 D5.

## Design decision — DD-12 immediate-deny fence integration (v3 addition)

DD-12 ("Immediate-deny path"): a privacy-reducing mutation raises the fence **in the same source transaction**;
the guarded view `public_session_share_v` anti-joins `public_projection_fences`, so the public read path denies
**immediately**, not after the async projector. Migration `0033` ships the FUNCTIONS only (no trigger); the
comment `raise_public_session_fence(session, reason) EXECUTE app (source tx)` means the **producer (command
handler) calls it explicitly**. `updateSession` public→private is a producer.

- **Shared core** `packages/db/src/public-session-fence.ts` exports `raisePublicSessionFence(tx, sessionId,
  reason)` with `reason: 'visibility_private' | 'cancelled' | 'closed'` — exactly `0033`'s enum (none invented).
  Extracted so a later cancel/close slice reuses it with `'cancelled'`/`'closed'`; **this slice wires ONLY
  `updateSession`'s `'visibility_private'`**.
- **Gate:** the raise fires on **every** `→private` visibility change, **regardless of status** (owner
  ruling 2026-08-25, DD-12 literal "privacy-reducing mutation"). Measured rationale: the guarded view
  `public_session_share_v` has **NO `sessions.status` predicate**, so "a draft is never publicly served" is a
  **projector ASSUMPTION, not a schema guarantee** — and the fence PRODUCER must not depend on the behavior of
  the (unbuilt) projector. So a **draft `→private` ALSO raises** the fence. `private→private` is not a
  visibility change, so it raises NOTHING. (This supersedes an earlier "draft raises nothing" design; the
  runtime manifest's `negative_scope` is a register-time snapshot, immutable post-register by hash-lock, so
  this packet is the authoritative record of the superseding rule.)
- The SECURITY DEFINER function verifies the session is in the caller's tenant (fail-closed on a
  missing/mismatched `app.tenant_id` GUC), so the raise is inside `withTenant`. The projector-worker later
  CAS-clears the fence after convergence — a **separate lane**; this slice only RAISES.

## Scope

Ships **UpdateSession ONLY** — a SessionService command in one `withTenant` transaction, PLUS its DD-12 fence
raise via a shared core.

**In scope:** `packages/db/src/session-service.ts` (`updateSession` + the fence raise),
`packages/db/src/authorization.ts` (`update_open_session` → `ActionClass` + `RECOGNIZED_ACTION_CLASSES`,
DENY-when-suspended), `packages/db/src/public-session-fence.ts` (the shared `raisePublicSessionFence` core),
the three test files (`authorization.test.ts`, `session-service.test.ts`, `public-session-fence.test.ts`),
`docs/features/BE/feature_billing_lifecycle_tech.md` (the `Update open session` matrix row + note +
changelog), this packet.

**Out of scope (see manifest `negative_scope`):** **NO migration / `schema.ts`** (0033 already on the base — this
slice only CALLS the fence, never modifies the functions/view/grants/`public_sessions`); any request
fingerprint / PII-derivative storage / pepper/KMS (DD-117 D5); the projector + CAS-clear wiring (a separate
lane); `index.ts` barrel export (F4); routes/API/FE; CloseSession/CancelSession + their fence-raise (a later
slice); DeleteSession (DD-104); the allow-when-suspended branch; capacity→`impact_policy` (DD-112 open);
`CAPACITY_BELOW_OCCUPANCY` (F3); payments/review_policy/refund; and any edit to `docs/standards/decisions.md`.

## Mechanism — `updateSession`

Partial field update on a `draft` or `open` session, one `withTenant` transaction, on the S2 pattern:
validate session-IDENTITY (`sessionId`) → advisory-xact command-key lock → dedup (`processed_commands`,
commandId-only, fail-closed on foreign/corrupt row; **a replay short-circuits here**) → validate the PATCH
(ledger-miss only) → lock session `FOR UPDATE`, read current row → transition guard → suspension gate
(status-dependent) → optimistic-version guard → money/capacity/discovery guards → mutate the changed fields
+ version bump + `updated_at = clock_timestamp()` → one `session.updated` outbox row → (visibility change)
`session.visibility_changed` → **(any public→private) raise the DD-12 fence** → record result.

- **Editable fields (all optional; only provided-and-different fields mutate):** `starts_at`, `ends_at`,
  `timezone`, `price_amount`, `slots_max`, `visibility`, `area`, `venue_name`, `venue_address`,
  `join_policy`. Empty change-set → idempotent no-op (no version bump, no event), record dedup.
- **Transition guard (edge #11):** `closed`/`cancelled` → `SESSION_NOT_OPEN`. `draft`/`open` proceed.
- **Past-guard (edge #11 "past"), TWO fences:** (a) an EARLY guard — an `open` session whose CURRENT
  `starts_at` has passed → `SESSION_NOT_OPEN` (before the version/field guards); (b) a FINAL atomic fence
  AFTER the mutation — the RESULTING `starts_at` must still be in the future (re-read vs `clock_timestamp()`),
  so neither SETTING a past `starts_at` NOR a clock-cross during a lock wait can leave a past `open` session
  mutated (throws → tx rolls back). Both use a SEPARATE post-lock/post-write `clock_timestamp()` query. A
  `draft` has NO past-guard.
- **Suspension gate (DD-110 D1/D4, DD-105):** if status is `open`, re-check under lock via
  `authorizeTenantAction(tx, tenantId, 'update_open_session')` (DENY-when-suspended) → `TENANT_SUSPENDED`. If
  status is `draft`, **do NOT call** `authorizeTenantAction` (DD-105 exemption). Under-lock (the literal is
  status-chosen); a suspended replay returns the stored envelope (no new mutation).
- **Optimistic version (edge #2/#26) — MANDATORY on the mutate branch:** a non-empty change-set requires
  `expected_version`; missing OR ≠ the live version under lock → `STALE_VERSION`. A PROVIDED value is
  validated as a positive int4 on the ledger-miss path (after dedup, before no-op/mutate). The no-op branch
  does NOT re-check it.
- **Idempotency (edge #3) — dedup on `(tenant_id, command_id)` ONLY (DD-117 D5):** the stored envelope carries
  EXACTLY `{sessionId, status, version, visibility}` — NO request content, NO fingerprint. A replayed
  `command_id` for the SAME session returns the stored result **regardless of the patch**; a different
  session OR a foreign command_type → `COMMAND_ID_CONFLICT` (`isStoredUpdateResult` is a superset of
  `isStoredCreateResult`: UUID id, enum status/visibility, integer version in `[1, INT4_MAX]`). Only
  session-IDENTITY is validated BEFORE the dedup; the rest of the patch AFTER the ledger-miss, so a MALFORMED
  retry of a committed command returns the stored result, not a spurious error.
- **Capacity (edge #16, DD-112):** new `slots_max` < active roster count → `CAPACITY_BELOW_ROSTER` (no
  `impact_policy` coupling).
- **Price (edge #4/#5, DD-117):** `price_amount` change AND **ANY** existing charge (including a
  `void` one — **no status exemption**: the Reviewed edge #4 requires policy for a price change with
  "existing charges", and DD-117 D3 authorizes the charge branch only as a fail-closed refuse) →
  `PRICE_CHANGE_REQUIRES_POLICY` (fail-closed refuse; money never moves silently).
- **Discovery (edge #7/#12):** transition to `public` (or a public session mutating `area`/`slots_max`)
  missing `area` or a finite `slots_max` → `MISSING_DISCOVERY_FIELDS`.
- **Time (edge #1):** effective `ends_at` ≤ `starts_at` → `INVALID_TIME_RANGE`.
- **Events (§4):** one `session.updated` (`{session_id, changed_fields[]}`, exact key-set, no `tenant_id`);
  AND, when `visibility` changes, `session.visibility_changed` (`{session_id, new_visibility}`, exact
  key-set), sequenced in the same tx.
- **DD-12 fence (v3):** on **every** `→private` visibility change (any status — no `status` gate), call
  `raise_public_session_fence(session_id, 'visibility_private')` in the SAME transaction (via the shared
  helper). The guarded view `public_session_share_v` denies IMMEDIATELY (the base `public_sessions` row may
  still exist until the async projector converges). A draft `→private` ALSO raises (the producer does not
  rely on the projector never projecting drafts); `private→private` raises NOTHING.

## Findings (owner-requested durable record)

- **F1 — `charges` / `players` are Drizzle-declared; the probes use the typed tables.** Capacity roster count
  (`.from(players)` `status='active'`) and the charge probe (`.from(charges)` for ANY charge on the session —
  no status filter, `.limit(1)`), scoped by `session_id` under the tenant GUC.
- **F2 — retry-root dimension is vacuously false.** No `promotion_retry`/retry-root table on base; the guards
  check `charges` only. Add the retry-root check when the waitlist-promotion subsystem lands.
- **F3 — `CAPACITY_BELOW_OCCUPANCY` deferred.** No booking-hold table on base; occupancy == active roster,
  so only `CAPACITY_BELOW_ROSTER` is implemented (DD-112).
- **F4 — `index.ts` barrel export deferred (scope-minimalism).** `updateSession` is tested via direct import
  from `./session-service.js`. **Backlog:** `session-command-barrel-export`.
- **F5 — successor to a BASE_DRIFT-closed lane.** `session-command-update-v2` (correct on `e5baf9e`) was
  authorized-closed BASE_DRIFT when `0033` merged; v3 re-registers on `1215a6a` and adds the fence. The v2
  branch is retained as read-only reference; forensics archived under `.autopilot/state-archive/`.
- **F6 — out-of-scope doc conflict (backlog).** `feature_session_management_tech.md:534` still promises a
  future `request_hash` binding that DD-117 D5 REJECTS; PRE-EXISTING, outside this diff. **Backlog:**
  `session-mgmt-tech-request-hash-retire`.
- **F7 — cross-command fence-raise is a future slice.** `cancelSession` (`'cancelled'`) and `closeSession`
  (`'closed'`) are also privacy-reducing and must raise the fence via the SAME shared helper
  (`raisePublicSessionFence`) when they land — **unconditionally on their transitions, with NO status-based
  skips** (owner carry-forward guidance 2026-08-25, same rationale as the draft ruling: the fence producer
  must not depend on projector assumptions). This slice ships only `updateSession`'s `'visibility_private'`;
  the helper is extracted so those slices stay thin. The projector + CAS-clear (`clear_public_session_fence`,
  `app_worker`) is a separate lane.

## Acceptance matrix (real-PG unless noted)

| # | Group | Precondition | Expected | Layer |
|---|---|---|---|---|
| U1 | Happy | valid field change on `open`, correct `expected_version`, tenant active | fields mutated; `version`+1; one `session.updated` (exact key set); `processed_commands` row | real-PG |
| U-ALLFIELDS | Field coverage | one update of ALL ten editable fields on `open` | every column persisted; exact 10-name `changed_fields`; both event payloads exact | real-PG (U-ALLFIELDS) |
| U-VIS | Event | private→public with discovery fields on `open` | `session.updated` + `session.visibility_changed`, exact payloads, sequenced | real-PG (U-VIS) |
| **U-FENCE** | **Privacy (DD-12)** | OPEN public session projected to `public_sessions`, then updated →private | `raise_public_session_fence(...,'visibility_private')` fires in-tx; guarded view `public_session_share_v` denies IMMEDIATELY while the base row still exists (no projector) | real-PG (U-FENCE) |
| **U-FENCE-DRAFT** | **Privacy (DD-12)** | draft public→private; and open private→private (with an area change) | draft `→private` ALSO raises `'visibility_private'` (unconditional, no status gate); private→private raises nothing | real-PG (U-FENCE-DRAFT) |
| FENCE-1 | Fence core | `raisePublicSessionFence(tx, id, 'visibility_private')` under a tenant GUC | one `public_projection_fences` row: surface `session_share`, target_kind `session`, deny_scope `public`, reason `visibility_private` | real-PG (public-session-fence.test.ts) |
| FENCE-2 | Fence core | helper called with `'cancelled'` then `'closed'` | each reason literal is written verbatim (proves reuse by a later cancel/close slice) | real-PG (public-session-fence.test.ts) |
| FENCE-3 | Fence core (fail-closed) | raise for a session in ANOTHER tenant (GUC = tenant A, session in tenant B) | throws (SECURITY DEFINER tenant check); nothing fenced | real-PG (public-session-fence.test.ts) |
| U2 | Boundary | `expected_version` mismatch (mutate) | `STALE_VERSION`; zero mutation | real-PG |
| U-VER | Boundary | non-empty change, `expected_version` OMITTED | `STALE_VERSION`; zero mutation | real-PG (U-VERSION) |
| U-BADVER | Boundary | malformed `expected_version` on a NEW command (ledger miss) | `STALE_VERSION` before the no-op branch; zero mutation | real-PG (U-BADVER) |
| U-RACE | Concurrency (spec :739) | two competing writers share the initial version (holder-gated deterministic race, both blocked before release) | exactly ONE success (version +1) and ONE `STALE_VERSION`; one mutation + one event | real-PG (U-RACE) |
| U3 | Money | reduce `slots_max` below active roster | `CAPACITY_BELOW_ROSTER`; zero mutation | real-PG |
| U4 | Money | `price_amount` change with an existing OPEN charge | `PRICE_CHANGE_REQUIRES_POLICY`; zero mutation (U-VOID proves a `void`-only charge ALSO blocks → any charge blocks) | real-PG |
| U-VOID | Money (fail-closed) | price change with the ONLY charge `void` | `PRICE_CHANGE_REQUIRES_POLICY` — any charge, incl. void, requires policy (no status exemption) | real-PG (U-VOID) |
| U5 | Suspend | tenant `suspended`, session `open` | `TENANT_SUSPENDED` UNDER LOCK; zero mutation | real-PG |
| U6 | DD-110 D4 negative | tenant `suspended`, session `draft` | update SUCCEEDS (DD-105) — proves `authorizeTenantAction` NOT called on a draft | real-PG |
| U7 | Boundary | update a `closed`/`cancelled` session | `SESSION_NOT_OPEN`; zero mutation | real-PG |
| U7b | Boundary | update an `open` session whose `starts_at` has passed | `SESSION_NOT_OPEN`; zero mutation | real-PG (U-PAST) |
| U7c | Concurrency | a lock wait spanning `starts_at` | `SESSION_NOT_OPEN` via the post-lock `clock_timestamp()` query | real-PG (REG-CLOCK-UPDATE) |
| U7d | Money/State | SET `starts_at` to a PAST value | `SESSION_NOT_OPEN` via the FINAL post-write fence; tx rolls back | real-PG (U-SETPAST) |
| U8 | Discovery | →`public` missing `area`/finite `slots_max` | `MISSING_DISCOVERY_FIELDS`; zero mutation | real-PG |
| U9 | Idempotent | empty effective change-set | no-op success, version unchanged, no event, dedup recorded | real-PG |
| U10 | Auth-recognition | `authorizeTenantAction('update_open_session')` on a suspended tenant | DENY (`TENANT_SUSPENDED`) | real-PG (authorization.test.ts) |
| DED1 | Dedup-replay (DD-117 D5) | same `command_id`, same session (any patch) · different session · foreign type | same session → stored envelope (any patch); else `COMMAND_ID_CONFLICT` | real-PG |
| DED2 | Dedup precedes validation | replay a committed `command_id` with a MALFORMED payload | returns the stored result, not a validation error | real-PG (DED2) |
| U-PII | Security/PII (DD-117 D5) | after an update carrying venue/area, inspect `result_ref` | stores EXACTLY `{sessionId, status, version, visibility}`; no PII, no 64-char digest | real-PG (U-PII) |
| U-CORRUPT | Boundary (fail-closed) | stored envelope corrupted to out-of-int4 `version` | rejected → `COMMAND_ID_CONFLICT` | real-PG (U-CORRUPT) |
| SEC1 | Cross-tenant | update tenant A's session as tenant B | denied via RLS `FORCE` | real-PG |
| MIG1 | Migration | — | NONE: zero migration, zero `schema.ts` (0033 fence functions already on the base) | scope gate |
| REG1 | Regression | canonical db suite | rls-invariants + full db suite stay green | full db suite |
