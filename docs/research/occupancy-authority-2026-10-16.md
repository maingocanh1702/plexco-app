# Occupancy authority: one helper, one formula, one public number

Status: proposal backing DD-133 (unsigned). Not a decision, not a readiness verdict, not an authorization to code.
Measured at `origin/main` `3546f6b49bc32e82dbe12e5da636c62206c63b2e` (2026-10-16). Every `path:line` below was re-read at that SHA.
Owner-facing decision row: `docs/standards/decisions.md` DD-133 (Web MVP Phase 3 decision D1). Plan: `docs/sessions/web-mvp-phase3-plan.md`.

Abbreviations: TDD=`docs/product/TDD.md`; BR=`docs/standards/business-rules.md`; DEC=`docs/standards/decisions.md`;
CBF-P / CBF-B=`docs/features/FE/feature_channel_booking_funnel.md` / `docs/features/BE/feature_channel_booking_funnel_tech.md`;
MKT-P / MKT-B=`docs/features/FE/feature_marketplace_discovery.md` / `docs/features/BE/feature_marketplace_discovery_tech.md`;
MKT-W=`docs/channels/web/FE/feature_marketplace_fe.md`; SES-P / SES-B=`docs/features/FE/feature_session_management.md` / `docs/features/BE/feature_session_management_tech.md`;
SS / SR / RS=`packages/db/src/session-service.ts` / `session-read.ts` / `roster-service.ts`.

## 1. Problem: docs pin four different formulas, the live code pins a fifth

| Source | Formula it pins |
|---|---|
| TDD:111 FR-17, :673, :676 | public `confirmed_count` + `slots_open` from active + live payment holds; "one shared helper"; capacity decision under the session lock |
| TDD:306 | `PUBLIC_SESSION.confirmed_count` = "active players only" |
| BR:50 BL-DSC-1 | whitelist carries `confirmed_count` (active) and `slots_open` (active + holds); hold count/identity never serialized |
| BR:63 BL-CBF-3, BR:75 BL-SES-2, DEC:467 DD-32 | admission occupancy = active players + unexpired `awaiting_payment` holds, one helper |
| DEC:464 DD-32 Browse (owner-signed 2026-07-28; mirror row DEC:3596 v2.09) | confirmed count and slots available always visible to unlinked browsers |
| CBF-B:54, :164-179, :259-277 (DTO :269-270) | confirmed = count(active); held = live `awaiting_payment` intents; occupied = confirmed + held; DTO carries `confirmedCount` + `slotsAvailable` |
| CBF-P:17, :86, :92, :162, :164 | "N confirmed" and "N/M Going"; `slots_available` subtracts active + live holds |
| MKT-B:30, :51, :71, :191-193; MKT-P:35, :178, :241, :460, :502-503, :544 | `getSessionOccupancy()` = active + live holds; NEW column `public_sessions.confirmed_count`; `slots_open = max(0, slots_max - active - holds)` |
| MKT-W:243, :276, :406 (AC-9, Draft) | renders `slots_open` only, "no denominator" |
| SES-P:49, :113 vs :882; SES-B:10, :249-250, :270, :815, :820, :832, :884-886, :1095 | split between "active + holds" and "active + pending + guest notes + holds" |
| SES-B:12, :251; DEC:124 DD-128 (signed via DD-131 OD-4) | LIVE: active + guest notes through ONE `sessionOccupancy`; the client never adds |
| Live code SS:2066-2072 `sessionActiveRosterCount` | `count(players.status='active')`, "SINGLE source for the active-roster aggregate" (SS:2061) |
| Live code SS:2664-2670 `sessionOccupancy` | active + `count(session_guest_notes)`; pending and holds omitted as structurally zero (SS:2651-2662; `0014_players_waitlist.sql:80-81` enum has no `pending`; no hold table) |
| Live code SR:200-211 `listSessions` | a SECOND hand-written SQL copy (backlog `docs/autopilot-backlog.md:6107` `list-sessions-occupied-count-single-source`) |
| Live code `apps/web/components/sessions/roster-counts.tsx:11` | the client derives `free = max(0, slotsMax - counts.occupied)` |
| `public_sessions` (`0006_discovery.sql:21`, `packages/db/schema.ts:1552`, view `0033_public_projection_fences.sql:132-145`) | `slots_open NOT NULL`, no `>= 0` CHECK, no writer (`app` DML revoked at `0036_revoke_app_dml_public_sessions.sql:36`); `confirmed_count` exists nowhere (`0033:69`, SR:25-27) |

Root cause: the DD-32 mirror (DEC:3596, 2026-07-28) predates guest notes and pending invites (SES v2.21, SES-B:1125). Only SES section 4 and the live code know guest notes; only the live code knows the real `players` enum.
`sessionOccupancy` callers: RS:180-181 (full => waitlisted, no charge); SS:1455-1462 (`CAPACITY_BELOW_ROSTER`, then `CAPACITY_BELOW_OCCUPANCY`); SS:2802 (`SESSION_FULL`); SS:3003; SR:371 (`counts.occupied`).

## 2. Proposal: ONE shared helper

- Module `packages/db/src/session-occupancy.ts` (new). Name `getSessionOccupancy` (already used by CBF-B:54, MKT-B:30, DEC:2473). It replaces SS:2664 and the SR:211 copy. Exports:
  `occupiedCountSql(sessionId)` (THE formula as one SQL expression); `getSessionOccupancy(tx, sessionId): Promise<number>`;
  `slotsOpen(slotsMax: number | null, occupied: number): number | null` (pure); `activeCountSql` + `sessionActiveRosterCount` move here (the `confirmed_count` authority).
  It returns ONE number, never a per-term breakdown, so no caller can serialize a hold count (BR:50 by construction).
- SQL today: `(select count(*) from players where session_id = $s and status = 'active') + (select count(*) from session_guest_notes where session_id = $s)`.
  Keyed by session id only: the same-tenant composite FKs (`0019_tenant_integrity_fks.sql:129-131` players; `0044_session_guest_notes.sql:100` guest notes) keep it tenant-exact under app RLS and inside a BYPASSRLS definer. Indexes exist: `idx_players_session`, `idx_session_guest_notes_session` (0044:102).
- Counted: active players; guest notes (DD-128, SES-OQ-8 SES-P:908); live holds (a term added only by the migration that creates a hold table; bank-dependent, out of MVP per DD-132, so 0 for now); pending invites (SES-P:76, SES-B:820; a term added only by the migration that makes `pending` representable).
- Not counted: pending `join_requests` (capacity is checked when the host approves: DEC:465, TDD:676, CBF-B:410); waitlisted rows (CBF-B:179); `left` rows; expired holds; charges (a void charge belongs to a `left` player, RS:360 + RS:364; unpaid debt never frees a seat).
- Consistency: a capacity DECISION calls the helper inside the command's `withTenant` transaction AFTER `sessions ... FOR UPDATE`, in the lock order of SS:1800-1806, and writes the occupying row before commit. Every current writer already locks first (RS:156-160 add, RS:334 remove, SS:2747-2756 create note, SS:2978-2983 delete note, `0044:129` trigger); future writers (join, approve, promote, invite, hold) MUST too (CBF-B:369 already does). READ COMMITTED suffices because the row lock serializes writers. Unlocked reads (list, detail, projector, bots) are advisory and never admit anyone.
- Consumers: RS:181, SS:1460, SS:2802, SS:3003 (rename only); SR:211 uses `occupiedCountSql(sessions.id)` (closes backlog `:6107`); SR:371 unchanged; both DTOs gain a server `slotsOpen`, so `roster-counts.tsx:11` stops deriving. M9 projector: a SECURITY DEFINER writer (EXECUTE `app_worker`; a writer role is ruled out by DEC:2488-2490 and `apps/bot/src/preflight.ts:98-118`; an app re-grant is forbidden by `0033:232-236`) recomputes `slots_open` from canonical rows at delivery time, order-independent (DEC:2485). Discovery: `readonly` reads `slots_open` from `public_session_share_v` (`0033:239`); `available_only` = `slots_open > 0`.

## 3. `confirmed_count` and `slots_open`

- `confirmed_count(s)` := count of `players` with `session_id = s` and `status = 'active'` (`sessionActiveRosterCount`). It excludes guest notes, pending invites, holds, waitlisted and left rows. Tenant-private (host list `activeCount`, detail `counts.active`). NOT public.
- `slots_open(s)` := NULL when `slots_max IS NULL` (private sessions only), else `greatest(0, slots_max - getSessionOccupancy(s))`. A public row is always finite: `sessions_public_capacity_chk` (`0024_public_visibility_capacity_check.sql:117-118`, `packages/db/schema.ts:642-643`) forbids public + NULL; `sessions_slots_chk` (`schema.ts:638`) keeps `slots_max > 0`; the projector still skips and deletes a violating row (MKT-B:98, :201). The 0 clamp covers occupied > `slots_max` (legacy rows, a future over-cap path such as DD-115 D6 at BR:178, a finalizer race).
- Public DTO: `slots_open` ONLY. (a) `0033` projects `slots_open` (`0033:140`) and defers `confirmed_count` (`0033:69`); adding it needs a migration, a view change and an edit to the literal whitelist test (`packages/db/src/rls-invariants.test.ts:171`). (b) Least disclosure: "is there room" is the only decision input a joiner needs. (c) With both public, `confirmed_count + slots_open` isolates holds plus guest notes when `slots_max` is known or deltas are watched (DEC:2491-2495); one blended number cannot leak it. (d) SR:25-27 already keeps it out; MKT-W:243/:276/:406 already render `slots_open` without a denominator. `slots_max` stays non-public.
- This amends DEC:464 ("confirmed count and slots available always visible" becomes "slots available always visible") and BL-DSC-1 (BR:50).

## 4. Check against the two sibling bots (sibling working trees, not part of this repo; re-read 2026-10-16)

Payment bot `Bestminton Club Payment check bot` @`4e78919`, `src/db.ts`:
- MATCH: a seat is a `players` row with `waitlisted = 0`; buddies and guests are real member rows that also occupy (db.ts:2542-2546). `spotsLeft = cap - confirmedCount`, `<= 0` shows full (db.ts:8994-8995; `src/format.ts:34-39`). Unlimited is capacity 0 or no default (db.ts:2531-2538); Plexco uses NULL.
- DIVERGE (right for Plexco): the bot INSERTs, then counts, then demotes to the waitlist if `confirmedCount > cap` (db.ts:7920 + :7953; twin :8002/:8031). Safe only because `node:sqlite DatabaseSync` (db.ts:1) is synchronous with one writer. Under Postgres READ COMMITTED two concurrent inserts each count committed rows plus their own, both see `<= cap`, and the session oversells. Plexco locks `sessions FOR UPDATE` (RS:156-160), counts (RS:180-181), then inserts (RS:195), with `players_tenant_session_member_uq` (`schema.ts:711-712`) as the final fence.
- DIVERGE: host and auto-paid seats bypass the cap (db.ts:7943) and `membershipAwareCapacity` raises it per member (db.ts:3825). Plexco keeps one cap per session (BR:75); a member over cap is open DD-115 D6 (BR:178), so do not copy it.
- No approval or pending state exists in the bot, so it is no evidence for the pending rules; that split is Plexco's own.

Chatbot `bestminton-club-chatbot` @`4905f00`: it never counts; it renders the payment bot's `spotsLeft`/`joinedCount`/`capacity` (`src/ai/prompt-builder.js:301-304`), treats `spotsLeft <= 0` as a waitlist join (`src/payment/action-gate.js:116-131`) and re-validates status, `spotsLeft`, fee and title at confirm time, failing to `stale` (action-gate.js:186-199). That equals "adapters render the server number" (CBF-B:55) plus a re-check under the lock. It also puts `joinedCount` and `capacity` into the LLM prompt; Plexco's unlinked and public surfaces receive `slots_open` only.

## 5. Docs to synchronize (lane L0 of the Phase 3 plan; after DD-133 is signed)

Canonical text: "occupied = `getSessionOccupancy()` = active players + guest notes + live holds (+ pending invites after the migration that adds them); `slots_open` = `slots_max IS NULL ? NULL : max(0, slots_max - occupied)`; `confirmed_count` = active players, tenant-private, never public."
1. TDD:673 canonical text and remove `confirmed_count` from the whitelist; :676 "active + live holds" becomes `getSessionOccupancy()`; :111 FR-17 "public `slots_open` only"; :306 delete `confirmed_count`.
2. BR:50 delete `confirmed_count (active players)`; BR:63 and BR:75 point to `getSessionOccupancy()`.
3. DEC: DD-133 amends DEC:464 and DEC:467 (done in the same decision row once signed).
4. CBF-B:54 and :164-179 canonical text (keep `held_count` as the future term); :259-277 drop `confirmedCount`, rename `slotsAvailable` to `slotsOpen`.
5. CBF-P:17, :86, :92, :162, :164 (drop "N confirmed" and the Going-count row; show `slots_open`); `docs/channels/web/FE/feature_booking_funnel_fe.md:335`.
6. MKT-B:30, :51 (delete the `confirmed_count` DDL line), :71 (delete (b)), :99, :191-193, :209, :259; MKT-P:35, :178, :241, :460, :502-503, :544.
7. SES-P:49, :113, :882; SES-B:10, :12, :249-250, :270, :815, :832, :884-886, :1095 point to `getSessionOccupancy()`; SES-B:820 (pending invites occupy) stays.
8. `docs/autopilot-backlog.md:3475` becomes a pointer to DD-133; backlog `:6107` is closed by stage 1.
Reviewed specs get a version bump and a changelog row; the public-DTO parts wait for the D1 signature, the formula parts do not (DD-128 already signed active + guest notes).

## 6. Schema impact

- Stage 1 (code only, no migration, no owner wait): the new module, a rename at 4 call sites, the SR:211 fragment, a server `slotsOpen` in both DTOs plus the web read, and equivalence tests over active / waitlisted / left / guest-note fixtures. Phase 3 lane L7.
- Stage 2 (M9, migration, needs explicit owner authorization): inside the migration that adds the projector's SECURITY DEFINER writer, add `CREATE FUNCTION session_occupancy(p_session_id uuid) RETURNS integer LANGUAGE sql SECURITY INVOKER SET search_path = public, pg_temp` with the section 2 body, `REVOKE ... FROM PUBLIC`, `GRANT EXECUTE` to `app` and to the definer owner role. `occupiedCountSql` then emits `session_occupancy(x)`, so TS and SQL share one body. An optional `CHECK (slots_open >= 0)` on `public_sessions` is safe because the table has no writer. The function must be SQL because `app_worker` has zero base grants and the projector reads canonical rows only inside a definer; a TS-only formula would force a second PL/pgSQL copy (forbidden, DEC:2472-2474). Phase 3 lane L10.
- NOT needed: a `confirmed_count` column (contrary to MKT-B:51 and :71), a view change (`0033:140` already has `slots_open`), an index, a base-SELECT re-grant (`0033:232-238` stays).
- Later, each owner-authorized with its own feature: the hold-table migration adds the hold term (and makes the function VOLATILE because of `clock_timestamp()`); the `players_status_chk` migration adds the pending term.

## 7. Owner questions (parts (a) and (b) of D1 = DD-133, the public read model epic; parts (c)-(e) are decided in DD-133, not here)

- Part (a): sign "Occupancy authority" as written in sections 2-3, including the public-DTO amendment of DEC:464 and BR:50. Proposal: yes. Resume iff the owner's approval event (PR #58 merged, or "Phase 3 plan approved") signs DD-133 part (a) and L0 records it.
- Part (b): authorize the stage-2 `session_occupancy(uuid)` function inside the L10 projector migration. Proposal: yes; it changes no table, column, view or index. Resume iff the same approval event signs DD-133 part (b). Otherwise the projector stays blocked: no TS-only path exists for `app_worker`.
- Stage 1 (L7) never waits for either part, because it changes no semantics.
