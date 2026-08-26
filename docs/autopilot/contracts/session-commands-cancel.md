# session-commands-cancel (B2 — CancelSession)

> **Slice:** B2 of the owner-ratified split of `session-commands-close-cancel`. B1 (`session-commands-close`,
> CloseSession) is MERGED on `origin/main` as squash `a3654fc`. B2 lands `cancelSession` sequentially AFTER B1,
> same file, no parallel writers. Ports CancelSession from the read-only reference tag
> `ap-reference/session-commands-close-cancel-v2-d9e1148` — **porting, not cherry-picking**: the tag predates the
> DD-110 literal-suspended amendment (`6c67d72`) and the action-class-aware billing §3, both now on the base.
>
> **Base:** `a3654fc` — B1's merge commit, the immutable slice base. origin/main has since advanced past it with
> unrelated lanes; `a3654fc` remains an ancestor of the current tip, so the triple-dot review diff is exactly this
> slice's six files.
>
> **Authority:** `docs/standards/decisions.md` **DD-110 D2/D3** (`cancel_session` is a ✅-under-suspension
> *obligation-termination* class; its literal enters `ActionClass` + `OBLIGATION_TERMINATION` in the commit that
> lands the command) + **DD-110 Amendment `6c67d72`** (the suspension guard reads the LITERAL status, not the
> `effective_status` bucket — already on base, consumed via the resolver) + **DD-117 D1** (paid/retry-root →
> fail-closed `CANCEL_REQUIRES_REVIEW` until the payments/review_policy subsystem exists) + **DD-117 D5** (session
> command family dedup on `(tenant_id, command_id)` ONLY) + **DD-12** (immediate-deny fence `cancelled`) +
> **Owner ruling — B2 acceptance gate #3 (2026-08-26):** *"roster_count != 0 is a refusal path with its own test,
> not an advisory."*

## Owner-ratified reading — gate #3 (roster is a REFUSAL, not an advisory)

The v2 reference treats `sessionActiveRosterCount` as **advisory** — it records `roster_count` in the
`session.cancelled` event and **proceeds** for an OPEN session with a roster (its own comment: *"used ONLY for the
event, NOT for a guard"*). That is the canonical spec's **CA3** happy path, which is explicitly gated on *"review_policy
honored / refund disposition delegated"*. **review_policy does not exist yet** (DD-117). So today an OPEN cancel with a
roster cannot be safely resolved — exactly the same situation as an open cancel with a charge, which DD-117 D1 makes a
fail-closed refuse. The owner's gate #3 rules that `roster_count != 0` is therefore a **fail-closed refusal today**, not
an advisory record. The v2 ref's proceed-and-record behaviour is the **future CA3 path** and is out of scope until
review_policy lands. Consequence: on the clean cancel path `roster_count` is `0` (a non-zero roster refuses); the field
stays in the event schema for forward-compatibility with CA3.

## Scope (manifest is authoritative)

- `packages/db/src/authorization.ts` — add `cancel_session` to the `ActionClass` union, `RECOGNIZED_ACTION_CLASSES`,
  and `OBLIGATION_TERMINATION` (the resolver is already generic over `OBLIGATION_TERMINATION` — no resolver-body change).
- `packages/db/src/authorization.test.ts` — `cancel_session` authz cases (mirror the close block; suspend-both-axes
  allow, cancelled/missing/anomaly deny, past_due tenant deny).
- `packages/db/src/session-service.ts` — `cancelSession` command + two helpers (`sessionActiveRosterCount`,
  `sessionHasAnyPlayer`).
- `packages/db/src/session-service.test.ts` — cancel tests (see the matrix at the tail).
- `docs/features/BE/feature_billing_lifecycle_tech.md` — add the `cancel_session` Suspended Action Matrix row; flip the
  "cancel_session lands with B2" notes to "landed". NO change to the §3 CASE A/B algorithm/tables (already correct).
- `docs/autopilot/contracts/session-commands-cancel.md` — this packet.

**Out of scope (manifest `negative_scope`):** NO change to `close_session`/`closeSession`, `createSession`,
`publishSession`, or `announceSession` bodies. The ONLY `updateSession` change is code-review-driven and
behavior-preserving: its CAPACITY_BELOW_ROSTER guard now reads the active roster through the shared
`sessionActiveRosterCount` helper (single-source choke-point — one formula for capacity + cancellation) instead of an
inline duplicate; `updateSession`'s no-op/version live-bug region is UNTOUCHED. NO
`decisions.md` edit; NO migration / `schema.ts`; NO `public-session-fence.ts` change (reuse `raisePublicSessionFence`);
NO content fingerprint (dedup commandId-only, DD-117 D5); NO payments/review_policy/refund (roster-or-charge REFUSES); NO
route/API/FE; NO `index.ts` barrel export (F10, deferred like B1); NO change to the §3 CASE A/B algorithm/tables.

## Owner-ratified scope deviation (recorded after the fact — 2026-08-26)

This slice crossed its own declared negative scope. Recorded in full per the owner's ruling, naming all three parts:

- **Declared:** the manifest/packet negative scope said *"NO change to `updateSession` body."*
- **Done:** codex round-1 finding #1 flagged that `updateSession`'s CAPACITY_BELOW_ROSTER guard computed the active
  roster inline, duplicating this slice's new `sessionActiveRosterCount` helper — the choke-point "re-derive per call
  site" anti-pattern that has already driven this region to MAX_ROUNDS twice. To satisfy the single-source invariant,
  `updateSession` was changed to read the roster through the shared helper: behavior-preserving (the CAPACITY test
  stays green), and NOT touching `updateSession`'s no-op/version live-bug region, which remains a separate queued lane.
- **Order:** ratification came **after**, not before. The constraint was crossed during the fix and reported
  afterward. `negative_scope` is not machine-enforced — `session-service.ts` is in registered scope, so nothing
  mechanical would ever have caught it; it has to be honoured by hand.

**Owner ruling (2026-08-26):** the unification is RATIFIED and kept — reverting would ship a knowing duplicate into a
twice-MAX_ROUNDS region. But the *order* was wrong. **Rule from here:** a lane whose own `negative_scope` blocks a
correct fix STOPS and asks the owner BEFORE crossing it — it does not cross first and report after.

## `cancelSession` guard order (house pattern — mirrors `closeSession`, plus cancel-specific guards)

1. **Suspension gate** — `authorizeTenantAction(tx, tenantId, "cancel_session")` upfront; `!allowed` throws
   `SessionCancelAuthorizationError` (code `TENANT_SUSPENDED`). The resolver's FOR SHARE locks persist for the tx (no
   separate under-lock re-check). Obligation-termination → CASE B (literal status, deny-before-matrix) applies
   automatically. **[F2]**
2. **Payload validation** — `sessionId` shape (UUID); `commandId` is a trusted text idempotency key (NOT
   UUID-validated). NOT the `isInt4(expectedVersion)` value check yet.
3. **Advisory lock + dedup** — command-type-independent advisory lock on `(tenant_id, command_id)`; dedup ledger keyed on
   `(tenant_id, command_id)` ONLY (DD-117 D5); foreign command_type / corrupt envelope → `COMMAND_ID_CONFLICT`. **[F8]**
4. **FOR UPDATE** — lock the session row, read `status` + `version`.
5. **No-op branch** — `status === "cancelled"` → success no-op, **NO version check** (goal reached; edge #27). Runs
   **BEFORE** `isInt4` (carry-over #1; the v2 ref validated `isInt4` before the lock — fixed in the port). **[F1]**
6. **Transition guards** — (a) `closed` → `SESSION_NOT_OPEN`; (b) NOT (`draft`|`open`) → `SESSION_NOT_OPEN` (defensive);
   (c) **OPEN-only past-guard** — a separate post-lock `SELECT starts_at <= clock_timestamp()` query; past → `SESSION_NOT_OPEN`.
   A **draft has NO past-guard** (edge #25 — never was open). **[F5]**
7. **Version** — `isInt4(expectedVersion)` then mandatory match on the **mutate branch, ALL sources** (draft + open):
   missing OR mismatch → `STALE_VERSION` (edge #26). AFTER the no-op (§5), so a stale-but-charged/rostered request →
   `STALE_VERSION` first.
8. **Paid/roster-impact fail-closed** (AFTER version — algorithm transition/past→version→paid-impact):
   - **OPEN** — `sessionActiveRosterCount(tx) != 0` OR `sessionHasCharges(tx)` → `CANCEL_REQUIRES_REVIEW`, plain rollback,
     no event. (roster refuse = gate #3; charge refuse = DD-117 D1; any charge incl. `void`.) **[F3][F6]**
   - **DRAFT** — `sessionHasAnyPlayer(tx)` (status active|left|waitlisted) OR `sessionHasCharges(tx)` → anomaly: emit one
     `session.expiry_anomaly_detected` audit event under the lock, return an `{anomalyRefusal:true}` sentinel, and throw
     `CANCEL_REQUIRES_REVIEW` **after** `withTenant` commits (the audit must survive — a throw inside the tx rolls it
     back). `anomaly_fields` ∈ {players, charges} (both reachable independently; charge FK binds `(tenant_id, player_id)`
     not `session_id`). **[F4][F6]**
9. **Mutation (clean path only)** — `status → cancelled`, `version` bump, `updatedAt = clock_timestamp()`.
10. **DD-12 fence** — `raisePublicSessionFence(tx, updated.id, "cancelled")` **unconditionally** (gate #4). **[F7]**
11. **Outbox** — one `session.cancelled` event, payload `{session_id, roster_count: 0, has_paid: false, cancel_reason: "manual"}`
    (per-aggregate seq, `outbox_agg_seq_uq`). `roster_count`/`has_paid` are 0/false on the clean path (non-zero refuses).
12. **Ledger + result** — store `{sessionId, status, version}` in `processed_commands`; return `{..., replayed: false}`.

## Design notes (F)

- **F1 — no-op wins over version (carry-over #1, house pattern).** The v2 ref validated `isInt4(expectedVersion)` before
  the FOR UPDATE lock; a no-op cancel with `expectedVersion:0` would have thrown `STALE_VERSION`. The port MOVES the
  `isInt4`+match to the mutate branch (after the no-op), so an already-cancelled session returns the idempotent no-op
  regardless of the supplied version (edge #27). This is the ruled house pattern — fixed in the port, NOT preserved,
  NOT re-opened as a finding.
- **F2 — §3 CASE B consumed, not re-derived (carry-over #2).** `cancelSession` calls the shared `authorizeTenantAction`;
  adding `cancel_session` to `OBLIGATION_TERMINATION` makes the on-base resolver apply CASE B (literal per-axis allowlist,
  deny-before-matrix) automatically. No class-blind `effective_status` bucket read anywhere in the cancel path.
- **F3 — roster refuse (gate #3).** See "Owner-ratified reading" above. OPEN + `roster_count != 0` → refuse.
- **F4 — draft-anomaly audit-then-throw (edge #28).** A draft must carry no players (any status) and no charges. If it
  does, the audit event must COMMIT and the refusal throw must happen AFTER `withTenant` returns (a throw inside the tx
  discards the audit row — PL/pgSQL/tx semantics). Callback returns a discriminated union; the tail throws on the sentinel.
- **F5 — past-guard is OPEN-only.** Draft was never open (edge #25) → no past-guard; an OPEN past-start session cannot be
  cancelled (`SESSION_NOT_OPEN`). Separate post-lock `clock_timestamp()` query (lock-wait-safe), mirroring update/announce.
- **F6 — charge fail-closed, FK subtlety.** Any charge incl. `void` refuses (no status filter). `charges.player_id` binds
  `(tenant_id, player_id)` (0019 FK), NOT `session_id`, so a charge on this session referencing a player of a DIFFERENT
  session is reachable → `hasCharges` true with `hasAnyPlayer` false (charge-only draft anomaly).
- **F7 — fence unconditional.** `raisePublicSessionFence(..., "cancelled")` fires on every cancel transition regardless of
  prior visibility (DD-12 immediate-deny; same posture as B1's `closed`).
- **F8 — dedup commandId-only (DD-117 D5).** No content fingerprint / PII-derivative in the durable ledger.
- **F9 — concurrency (gate #2).** Two concurrent cancels: FOR UPDATE serializes; exactly one mutates (version+1, one
  event), the loser observes `cancelled` and takes the idempotent no-op. cancel/close race: exactly one terminal
  transition wins; the loser sees the other terminal status and returns `SESSION_NOT_OPEN` (deterministic loser error).
  Both covered by real-PG tests.
- **F10 — barrel export deferred.** `cancelSession` is not exported through `packages/db/src/index.ts`; routes/API wiring
  is a later lane (mirrors B1 F4).

## Test matrix (real-PG unless noted)

| id | source/state | expect |
|---|---|---|
| XC1 | open (future), clean | cancelled, version+1, one `session.cancelled` (`roster_count:0`, `has_paid:false`, `cancel_reason:manual`) |
| XC2 | draft, empty | cancelled, version+1, one `session.cancelled` (`roster_count:0`) |
| XC3 | closed → cancel | `SESSION_NOT_OPEN` |
| XC4 | already cancelled | idempotent no-op (NO expectedVersion needed) |
| XC5 | version omitted / mismatch on mutate (draft AND open) | `STALE_VERSION` (edge #26) |
| XC6 | no-op cancel with out-of-range `expectedVersion:0` | no-op wins (edge #27, carry-over #1) |
| XC7 | open past-start | `SESSION_NOT_OPEN` (past-guard) |
| XC8 | draft past-start | cancelled (draft has NO past-guard) |
| XC9 | **open + active roster (no charge)** | `CANCEL_REQUIRES_REVIEW` (gate #3 roster refuse), no event |
| XC10 | open + charge | `CANCEL_REQUIRES_REVIEW`, no event |
| XC11 | open + void charge | `CANCEL_REQUIRES_REVIEW` (no status filter) |
| XC12 | stale version + charge/roster | `STALE_VERSION` (version before paid-impact) |
| XC13 | draft + active player | `session.expiry_anomaly_detected` (`anomaly_fields:[players]`) COMMITS, then `CANCEL_REQUIRES_REVIEW` |
| XC14 | draft + left/waitlisted player | anomaly (any-player, not active-only) |
| XC15 | draft + charge (no player) | anomaly (`anomaly_fields:[charges]`; charge-only reachable via FK) |
| XC16 | draft + player + charge | anomaly (`anomaly_fields:[players,charges]`) |
| XC17 | subscription suspended | cancelled (DD-110 D2 obligation-termination) |
| XC18 | tenant (abuse axis) suspended | cancelled (DD-110 D2 both axes) |
| XC19 | tenant cancelled | `TENANT_SUSPENDED` (fail-closed, literal reading) |
| XC20 | fence: cancel raises `cancelled` fence unconditionally (incl. already-private) | fence row present |
| XC21 | dedup: same session replay / foreign command_type / corrupt envelope | replay / `COMMAND_ID_CONFLICT` |
| XC22 | cross-tenant cancel | `SESSION_NOT_FOUND` (RLS) |
| XC23 | **concurrency** two concurrent cancels | one real cancel (version+1, one event); loser idempotent no-op |
| XC24 | **concurrency** cancel vs close | one terminal wins; loser `SESSION_NOT_OPEN` (deterministic) |

Authz (`authorization.test.ts`): `cancel_session` mirrors the close block — suspend-both-axes allow, cancelled/missing
subscription + cancelled/past_due/anomalous tenant deny, normal states allow.
