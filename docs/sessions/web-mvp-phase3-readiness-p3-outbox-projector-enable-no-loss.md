<!-- review-readiness: code-ready -->

# Step-0 readiness: L24 p3-outbox-projector-enable-no-loss (session P3-S16d)

> Agent-facing. Readiness reviewers: opus/high (lane block L24), split by area: S0a (SQL, the A5 run, local volumes) and S0b (dispatcher, projectors, guards,
> tests, runbook). Writers: opus/max (U1-U3), sonnet/high (U4). Code reviewer opus/max plus a separate opus/max security round (external DMs, delivery policy,
> owner-seat SQL). RISK: P1.
> Lane contract: lane block L24 of the conductor-authored P3-S16d brief (not on main). Base `575c766047899966782194337f360b6c058ca4ce` (merge of PR #99, L18;
> `e049c92`, the merge of PR #97, is an ancestor: measured); branch `feat/p3-outbox-enable-no-loss`; worktree
> `.autopilot/worktrees/p3-outbox-projector-enable-no-loss`, clean at step 0 (measured: `git status --porcelain` empty, no `index.lock`).
> Every `path:line` below is MEASURED at the base by the step-0 reviewers (their notes live outside the repo, `status/P3-S16d-notes`: `s0a-sql-inventory.md`,
> `s0b-ts-inventory.md` and the orchestrator's `design-decision.md`); each fact carries its repo `path:line`, so it can be re-checked at the base. `0056:131` means
> line 131 of `packages/db/migrations/0056_*.sql`; bare bot names (`dispatcher.ts`, `worker.ts`, `projector-registry.ts`, `outbox-wake.ts`) are under
> `apps/bot/src/`, the projector modules (`web-realtime.ts`, `zalo-dm.ts`, `zalo-dm-templates.ts`, `public-sessions.ts`) under `apps/bot/src/projectors/`.

## 1. Authority

- Owner decision 2026-10-22, item 1 of `OWNER-DECISIONS-2026-10-22.md` (recorded by the owner's assistant, owner-confirmed in chat 10:47), verbatim:

  > Item 1 (outbox NEVER_DELIVERED, before dispatch is enabled anywhere real): owner delegated the choice ("B xu ly luon di"). Chosen under that delegation: build the fix, do not rely on the runbook order alone. A lane makes events that were handled while a projector was off reachable by that projector later (stay pending, or a bounded replay/backfill per projector), with the runbook enable order as the interim rule. Orchestrator measures the cheapest correct design first (migration only if unavoidable), keeps probe guard and the DD-134 rollback path, adds tests for the boot sequence "flags default true, projectors off, then on".

- The owner's conductor prompt for P3-S16 (printed verbatim in the session brief), its L24 line, verbatim:

  > L24 (item 1): outbox events handled while a projector was off must not be lost for that projector. Measure the cheapest correct design first (migration only if unavoidable; if one is needed it takes the next number after 0068 and is serialized). Tests for "flags default true, projectors off, then on". Keep the probe guard, DD-134 rollback and OUTBOX_DISPATCH_SCHEDULE_ENABLED semantics from DD-141. Update docs/runbooks/outbox-dispatch-enable-rollback.md.

- Lane block L24 of the P3-S16d brief is conductor-authored authority under these two texts (GOAL, NEGATIVE SCOPE, THREAT MODEL, DEFAULTS, DECISION TABLE,
  TESTS, ACCEPTANCE COMMANDS, STOP). Conductor note A1: the design decision is the orchestrator's under the owner's delegation, presented with its alternatives
  and measurements; the choice and the rejected alternatives go in the PR body as "default applied, pending owner sign-off".
- No new decision number; every choice below is a Tier-B default, pending owner sign-off. `docs/standards/decisions.md` is read, never edited (S1 UNPINNED);
  DD-134 (`:2716-2739`) and DD-141 (`:1780-1799`) bind this lane unchanged.
- The design is the orchestrator's (P3-S16d run 1, `design-decision.md`); section 3 restates it and this file does not re-decide it. Review per DD-122 D4 (Codex
  waived by the owner 2026-10-12). Dependencies: L18 recommended, not required (merged: the base is its merge); L27 (P3-S16e) runs beside with disjoint files;
  no migration in this lane, so no migration slot is requested.

## 2. Measured at base

### 2.1 The lead, re-verified

Lead: `status/P3-S15c-notes/ro-l22-2-measurement.md` (untracked, written at `ef3418a`); its 12 claims hold at the base (S0a), with line drift only in `schema.ts`.

| Fact | Evidence (at the base) |
|---|---|
| Phase 1 claims only `claimed_at IS NULL AND acked_at IS NULL`; the reclaim pass also skips acked events | `0023:180`, `0023:155`; last def of `claim_outbox_batch` `0023:138`; caller `dispatcher.ts:179` |
| `acked_at` is one per-EVENT column, set once, never cleared; its only writer is `ack_outbox_event` (claimed, unacked, token match, live lease); `app` cannot insert it set; acked implies claimed; no TS writer outside tests | `schema.ts:1537-1539`; `0023:54`; writer `0023:280-286` (`:281`), last def `0023:228`; guards `0023:109-113`, `0023:95-96` |
| The ack stores no projector set: the array is checked only against the event's existing delivery rows; one generic audit row | anti-join `0023:257-267`; `outbox_acked` `0023:289-292` |
| The required set drops disabled projectors in SQL; read once per event, one prepare per member, then the ack with the same array; no enabled routed projector => ack `'{}'` (stated in code) | `0056:131-136` (`WHERE p.enabled` `:134`); `dispatcher.ts:187`, `:188-194`, `:199-202`; `dispatcher.ts:107-109`, `0056:13-15` |
| Readers of the required set: one SQL definition with no SQL caller, one non-test TS reader | `0056:113-139` (EXECUTE app_worker only `:140-141`); `projector-registry.ts:38-45`, called once at `dispatcher.ts:187` |
| The only non-test INSERT into `projector_deliveries` is `job_prepare_projector_delivery`: it checks only the name shape and that the event exists (no route, enabled, `acked_at` or age check); `ON CONFLICT (event_id, projector) DO NOTHING`; audit `projector_delivery_prepared` only on insert; owner job_definer | `0022:280-317` (`:292-302`, `:304-306`, `:309-315`); PK `0005:48`; `0022:498`; one non-test caller `dispatcher.ts:188-193` |
| Phase 2 claims only EXISTING rows (`pending` or due `failed`) in event_id (uuid) order, not age; projectors not enabled at cycle start are skipped; the envelope needs a live claim, an enabled projector and a route, and returns `created_at` | `0022:369-377`; `dispatcher.ts:174-176`, `:223`; `0056:187-206` (`:197`, `:203-205`, `:189`, `:194`) |
| DLQ replay needs an existing `dlq` row; owner only | `0056:253-264` (P0002 `:256-259`, 55000 `:261-264`); sole caller `scripts/outbox-dlq-replay.mjs:84` |
| Test A5 pins the loss and was EXECUTED under the lock on plexco_test: 1 file passed, 1 test passed and 22 skipped of 23, exit 0, 4 s, no `probe CHANGED` line | `packages/db/src/outbox-projector-registry.test.ts:274-298` (asserts `:279`, `:287`, `:289`, `:293`, `:297`); log `status/P3-S16d-notes/s0a-a5.log` |
| Since #94 the committed flag is `"true"` and every projector is seeded disabled: at the first worker boot events ack `'{}'` and are lost for a projector enabled later | `.env.example:91`, `infra/docker-compose.yml:133`; seed `0056:105-106` |
| Phase 1 runs each statement in autocommit on the pool: the set is read under one statement snapshot, the ack commits later | `dispatcher.ts:179`, `:187`, `:190`, `:199-201` |
| Batch and drain: 25 events per phase-1 cycle, up to 25 deliveries per projector per cycle, at most 20 cycles per drain (500 per projector) | `dispatcher.ts:9`, `:164`; `worker.ts:160`; `outbox-wake.ts:14-15`, `:54-67` |
| No retention: no DELETE or TRUNCATE of `outbox_events`, `projector_deliveries` or `job_audit_events` in any non-test file; every claimed event has an append-only audit row FK-ing it | `0022:135`, `:146-157` |
| Owner path = superuser or migration seat + `SET ROLE job_definer`: it reads `outbox_events` (BYPASSRLS), owns the routes, reads and writes `projector_deliveries`, owns `job_audit_events` (no runtime-role grant, append-only) | `scripts/outbox-dlq-replay.mjs:9-12`, `:96-108`; `0022:79`, `:538`, `:539`, `:502`, `:129-131`; `0056:70-71` |
| `job_audit_events`: job_id NOT NULL FK `outbox_events(id)`, tenant_id NOT NULL FK tenants, actor DEFAULT 'system', reason text (no CHECK), fn_name NOT NULL, operation_id NOT NULL, created_at | `0022:133-142` |
| `outbox_projector_set_enabled`: FOR UPDATE on the projector row; P0002 `projector_not_found`; updates only on change and returns changed; no audit row, no delivery row; no GRANT (owner only) | `0056:157-180` (`:170`, `:171-174`, `:175-178`), `:181` |
| The public_sessions canonical rebuild: `public_sessions_tenant_candidates(t)` = the tenant's projected rows UNION its open public future sessions; `public_sessions_project_session(session, NULL)` recomputes from canonical rows only, writes no audit row for a NULL event id, is idempotent (`unchanged`) and raises 25000 unless read committed (measured by L23 step 0; migrations are append-only); both owned by job_definer | `0061:330-340`; `0067:201-376`, `0061:11-12`, `:160-163`, `:28-31`; `0067:234-236`; `0061:24-25`; owner loop 4.7 (h) `docs/sessions/web-mvp-phase3-readiness-p3-m9-public-projector.md:314-316` |

### 2.2 Routes per projector

| Projector | Aggregate | Event types | Added at |
|---|---|---|---|
| web_realtime | session | NULL = every session-aggregate event (the wildcard is allowed for web_realtime only, `0056:97-98`) | `0056:107-108` |
| zalo_dm | session | session.updated, session.cancelled, session.announcement_requested | `0057:242-245` |
| zalo_dm | session | player.promoted (a CHECK admits exactly these four, `0056:99-102`) | `0058:105-106` |
| public_sessions | session | session.published, session.updated, session.visibility_changed, session.closed, session.cancelled, player.added, player.waitlisted, player.removed, player.promoted, guest_note.created, guest_note.deleted, join_request.approved | `0061:492-504` |
| public_sessions | tenant | tenant.public_alias_set, tenant.public_alias_approved, tenant.public_alias_rejected | `0061:505-507` |

Measured on plexco_smoke at tail 0068: public_sessions 15 routes, web_realtime 1, zalo_dm 4 (matches A2, `outbox-projector-registry.test.ts:126`). Routed only
through the web_realtime wildcard: session.created, session.expiry_anomaly_detected, join_request.created/rejected/cancelled (`0061:489-491`) and payment.*.

### 2.3 A late delivery, per projector

| Projector, event | An old event delivered after a later enable | Class | Evidence |
|---|---|---|---|
| web_realtime, any session event | a NOTIFY of the bare event id; the listener re-reads it under the subscriber tenant's RLS and re-authorizes `session.manage`; a frame older than what the tab saw is dropped client-side, otherwise one refetch; no subscriber, nothing happens | HARMLESS | `web-realtime.ts:5-10`, `:53-55`; `packages/db/src/realtime-event-read.ts:25-34`; `apps/web/lib/realtime-auth.ts:62-88`; `apps/web/lib/use-realtime.ts:120-125` |
| public_sessions, 12 session + 3 tenant types | payload never read; a recompute from CURRENT canonical rows that clears the DD-12 fence; identical to the canonical rebuild (a backlog is waste, not harm) | CORRECT | `public-sessions.ts:6-16`, `:50-56`, `:68-69`, `:71-76` |
| zalo_dm, session.updated | `changed_fields` from the payload, start time and locale from the current row: `"your session at {start} changed: {old fields}"` days later; N updates while off = N DMs | HARMFUL | `zalo-dm.ts:90`, `:96-103`, `:160-171`; `zalo-dm-templates.ts:88-97`; `0057:147-163` |
| zalo_dm, session.announcement_requested | requester from the payload: a late "ready to forward" invite to the host, one per request | HARMFUL (host only) | `zalo-dm.ts:105-106`; `zalo-dm-templates.ts:70-75`; `0057:141-143` |
| zalo_dm, player.promoted | player and `amount_due` from the payload, not re-read: a fee from the promotion-time snapshot after the player may have paid; the single fee-bearing DM | HARMFUL (stale amount owed) | `zalo-dm.ts:110-116`; `zalo-dm-templates.ts:4-10`, `:77-86`; `0057:144-145`, `:159-163` |
| zalo_dm, session.cancelled | status re-checked: still true, and only while the session has not ended | CORRECT but late | `0057:116-126` (`:119-121`) |

Loss (not lateness): public_sessions loses the most (a session published while it was off is never projected; the DD-12 fence stays until a recompute: fail
closed, a functional loss, `public-sessions.ts:10-13`, `:88-93`); zalo_dm loss = notifications never sent (runbook `:64` accepts it today); web_realtime loss =
nothing for a tab opened later (2.4).

### 2.4 web_realtime: an un-notified client recovers

- Every view loads through its authorized GET on mount (`apps/web/lib/use-sessions-data.ts:101-104`).
- The hub emits `resync` on EVERY open, the first included (`apps/web/lib/use-realtime.ts:10-12`, `:110-115`), and on the first failure after an open
  (`:137-140`); views refetch on it (`use-sessions-data.ts:105-110`; `apps/web/lib/use-chat.ts:84`).
- The server states it: a missed NOTIFY cannot be replayed, clients reconnect and refetch (`apps/web/lib/realtime-listener.ts:13-18`). Its queue is bounded at
  `MAX_PENDING_EVENTS = 1_000` and an overflow closes every stream (`:21`, `:132-133`).
- Consequence: a tab opened after the gap is correct; a tab that stayed open across the gap stays stale until it reopens, the case in-bound hints help.

### 2.5 zalo_dm: a real sender with no event-age bound

- Real: `sendMessage` from `@plexco/db/zalo-bot-api` (`zalo-dm.ts:8`, `:207`) performs a real `fetch` to the bot API (`packages/db/src/zalo-bot-api.ts:70`,
  `:125`); the token is decrypted per delivery (`zalo-dm.ts:151-158`); `apps/bot/src/test-zalo-stub.ts` is test-only; dark only because 0056 seeds the projector
  disabled and the bot is an owner P0 step (`zalo-dm.ts:225-229`).
- Age bound today: none on event age. The only gates are the targets definer (session exists, `ends_at > now`, status matches, `0057:116-126`) and
  `joined_at <= event created_at` (`0057:162`); TS never reads `job.event.createdAt` (0 hits over `dispatcher.ts` and `projectors/*.ts`, non-test); the 120 s
  attempt budget and 5 s send timeout (`zalo-dm.ts:29-30`) bound one attempt only. A session.updated for a session two weeks ahead is deliverable for two weeks.
- Already present: the registry is re-checked before each send (`projector_disabled` -> retry, `zalo-dm.ts:189-191`); per-recipient records
  (`zalo-dm.ts:23-25`, `:173-186`, `:215-217`).

### 2.6 Local volume (read-only, 2026-10-22 07:21-07:22Z, superuser container psql, SELECT only)

| Database | Migrations | outbox_events | projector_deliveries | Projectors | Heartbeat |
|---|---|---|---|---|---|
| plexco | 32, tail 0031 (no 0056 objects) | 0 | 0 | table absent | not read |
| plexco_smoke | 69, tail 0068 | 213, all aggregate session: 76 acked (2026-10-16 12:38:42 to 20:26:04), 137 unclaimed and unacked (5.4 h to 5.4 days old) | web_realtime delivered 66, nothing else | all 3 disabled | schedule true, last seen 2026-10-16 20:26:01 (no worker running) |

Already lost on plexco_smoke (acked, routed, no row): public_sessions 68, zalo_dm 64 (all session.updated), web_realtime 10. At the next boot with the
committed default the 137 pending events ack `'{}'` in one drain: routed to web_realtime 137, public_sessions 62 (player.added 31, session.closed 11,
session.published 20), zalo_dm 0. Smoke and golden-path test traffic only; no production database is in reach.

### 2.7 Guards and DD-134 homes (byte-identical under the chosen design)

| Guard or value | Home |
|---|---|
| exact-"true" flag | `worker.ts:31-33` (`return rawValue === "true";`) |
| stub or empty-map refusal (X-3) | `worker.ts:40-55` (`:47`) |
| registry probe (D-14) | `worker.ts:63-79` (`:70-77`); `projector-registry.ts:88-90`; SQL it reads: `0056:144-154`, `0056:319-331` |
| boot order | `worker.ts:115-177` |
| 8 attempts; 15 s x 2^(n-1); DLQ on the 8th failure; a throw fails closed | `dispatcher.ts:16`, `:17`, `:21-23`, `:466-472`, `:18`, `:457-465`, `:255-269` |
| owner-only DLQ replay | `0056:237`, `:274`; `scripts/outbox-dlq-replay.mjs:9-12`, `:84`, `:104` |
| delivery matrix | `zalo-dm-templates.ts:14-20`, `:22-28`; `web-realtime.ts:45-47`; `projectors/index.ts:21-25` |
| DD-141 and DD-134 | `docs/standards/decisions.md:1780-1799` (D-14 `:1784`, B3 `:1788`, `:1795`; row `:1919`); `:2716-2739` (signed override of (c) `:2739`) |

## 3. Design decision

### 3.1 Candidates (measured)

| Design | Migration (objects) | Race vs the required-set read | Stale-DM bound | DD-134 and guard effect | Cost | Verdict |
|---|---|---|---|---|---|---|
| A: hold the ack while a registered but disabled projector is routed, up to an age bound, then ack `'{}'` with an expiry | YES: a job_definer definer returning the routed set regardless of `enabled` (app_worker cannot read routes, `0056:70-71`; the set filters `p.enabled`, `:134`; changing it breaks A4) and a definer for the expiry row (`0022:129-131`) | none on enable | a hold-time bound plus a phase-2 check for retries | worker untouched; runbook step 2.3 never completes while projectors are off (`:44-48`) | held events re-leased every 5 min (`0023:194`) with 2 audit rows each (`0023:153-173`, `:199-205`); claim passes ORDER BY created_at (`0023:156`, `:181`): 25 held events fill every batch (`dispatcher.ts:183`) and spin the drain (`outbox-wake.ts:54-67`) | rejected: fail-closed (head-of-line), fewest concepts, migration |
| B1: owner CLI, transaction 1 refuses an unacked routed backlog older than the bound (AM1) or enables, transaction 2 backfills within a bound | NO: job_definer reads events (`0022:538`), owns routes, reads/writes deliveries (`0022:539`), owns the prepare function (`0022:498`); the expiry record is an INSERT on the owner path (`0022:502`, a new direct-DML pattern) | race-free iff the scan starts after the enable commit and has no `acked_at` filter (3.2) | selection bound at the CLI run (DB clock); retries follow DD-134 (F1) | none: no SQL object; `dispatcher.ts`, `worker.ts` untouched; a backfilled row is an ordinary `pending`, attempts 0 row (`0022:304-306`) | one owner script and tests; a raw enable still skips it until a CLI re-run (R1) | CHOSEN, with C's per-projector rule |
| B2: the backfill inside `outbox_projector_set_enabled` or a trigger | YES: CREATE OR REPLACE of the pinned 0056 function (A7 `:349`, A13 `:699`) or a new trigger | NOT race-free: one READ COMMITTED transaction misses an event committed after its scan whose set was read before the enable commit (the STABLE read `0056:117`, `:131` ignores the FOR UPDATE of `:170`) | as B1 | holds the row lock for the whole backfill; db A5 breaks (`:287`, `:297`), bot A5 flips (`projector-registry.test.ts:208-229`); a trigger fires on fixtures' raw writes (`dispatcher.test.ts:96`, `:714`) | migration, slot, 14 pin lines | rejected: migration, not race-free, breaks A5 |
| C alone: web_realtime nothing, public_sessions rebuild, zalo_dm short bound | public_sessions part NO (`0061:28-31`); zalo_dm borrows A, B1 or D | rebuild race-free after the enable commit (`0061:11-12`, `:160-163`) | zalo_dm short bound (borrowed) | untouched | three behaviours to explain and test | folded into B1; "web_realtime nothing" rejected: the open tab never resyncs (2.4) |
| D: prepare rows for every routed projector at ack time, age check at delivery | YES: a routed-regardless set (A4) and an expiry outcome: a new status (`0022:263-264`, `0025:142`) or `dlq` + a new code (a DD-134 matrix question) | none on enable | strongest: one check before `deliver()` (`dispatcher.ts:240-256`), also on DLQ replays (a DD-134 (b) change) | "disabled" changes meaning; A5 pins flip (db `:274-298`, bot `:208-229`) | rows pile up forever for a never-enabled projector (web_realtime wildcard = one row per session event); smoke would hold 137 + 62 waiting rows | rejected: migration, unbounded rows, DD-134 change |

### 3.2 Chosen design (orchestrator, restated as `design-decision.md` states it)

**B1 + the per-projector rule = "the owner enable CLI with a bounded backfill" (NO migration).** A new owner CLI
`scripts/outbox-projector-enable.mjs enable --projector <name>` IS the enable step (it replaces the runbook's raw `SELECT outbox_projector_set_enabled(...)` step;
same owner-path conventions as `scripts/outbox-dlq-replay.mjs`: `DATABASE_URL_MIGRATION` only, `SET LOCAL ROLE job_definer` inside each READ COMMITTED transaction (so the role ends with the transaction; no `RESET ROLE`),
arguments validated before connecting, no credential or payload in output, exit 0 done / 2 refusal / 1 other).

Role (RO-L24-1 condition 2, nothing new): the CLI connects with `DATABASE_URL_MIGRATION` only, read from the environment exactly as
`scripts/outbox-dlq-replay.mjs` reads it (`:9-11`, `:96-98`; no DSN on the command line, never printed): the migration seat, a `job_definer` member after
`pnpm db:bootstrap`. It runs every statement inside a READ COMMITTED transaction that opens with `SET LOCAL ROLE job_definer`, so the role ends with each transaction and
there is no `RESET ROLE` (the precedent `scripts/outbox-dlq-replay.mjs` brackets its calls with `SET ROLE` ... `RESET ROLE`, `:104`, `:108`). `job_definer` reads `outbox_events`
(BYPASSRLS, `0022:538`), owns `outbox_projector_routes` (`0056:68`, `:70-71`), reads and writes `projector_deliveries` (`0022:539`), owns
`job_prepare_projector_delivery` (`0022:498`) and `job_audit_events` (`0022:502`; the expiry INSERT is the table owner's own write, and the append-only
trigger fires only BEFORE UPDATE OR DELETE, `0022:146-157`), and owns both rebuild functions: `public_sessions_project_session` (`0061:164`) and
`public_sessions_tenant_candidates` (`0061:332`) are created inside 0061's `SET ROLE job_definer` bracket (`0061:91`, `:509`), the 0067 replacement of the
first runs inside 0067's (`0067:161`, `:201`, `:384`), and their only EXECUTE grants go to `app_worker` (`0061:484-485`, `0067:381`), which the owner does not
need. So the CLI needs no new function, grant, role or migration; a write that could not go this way would be a STOP with a slot request, never a widened ACL.

1. Transaction 1 (AM1): `SELECT ... FROM outbox_projectors WHERE name = $name FOR UPDATE`, then REFUSE before enabling (ROLLBACK, exit 2 `unacked_backlog`,
   the count only in the output; nothing enabled, no row, no record) while any event routed to `$name` (the step 2 route join) has `acked_at IS NULL` and
   `created_at` older than `BACKFILL_MAX_AGE` (DB clock); the check also runs on a re-run for an already enabled projector. Otherwise
   `SELECT outbox_projector_set_enabled($name, true)` (existing owner function, unchanged; prints changed t/f) in the same transaction, then COMMIT. Only new
   events can appear after the check (`created_at` is the producer's transaction time), so no old unacked event can follow the enable commit: D8's step 2.3
   is a CLI precondition enforced by code, not only by the runbook.
2. Transaction 2 (starts AFTER transaction 1 committed; this ordering is what makes it race-free): `SELECT ... FROM outbox_projectors WHERE name = $name FOR UPDATE`
   (serializes concurrent CLI runs; refuse with exit 2 `projector_disabled` if it is not enabled at this point), then ONE scan of every outbox event ROUTED to
   `$name` (join `outbox_projector_routes`, exact type or the NULL wildcard, same rule as `outbox_required_projectors` `0056:131-136`) that has NO
   `projector_deliveries` row for `$name` and NO expiry record for (event, `$name`); NO `acked_at` filter (an event claimed but not yet acked must be included).
   Classify with the DB clock (`clock_timestamp()`), per AM5:
   - an UNACKED candidate (`acked_at IS NULL`; by AM1 it is inside the bound) -> ALWAYS `SELECT job_prepare_projector_delivery(id, $name)`, outside the
     count cap (the normal path would deliver it anyway once its ack reads the enabled set; the row closes the in-flight race).
   - an ACKED candidate with `created_at` within `BACKFILL_MAX_AGE` = 30 minutes AND among the newest `BACKFILL_MAX_ROWS` = 200 of the ACKED in-window
     candidates -> `SELECT job_prepare_projector_delivery(id, $name)` (existing, idempotent ON CONFLICT DO NOTHING, audited `projector_delivery_prepared`).
     Phase 2 then delivers every prepared row through the unchanged DD-134 path.
   - every other ACKED candidate (older than the bound, or beyond the count cap) -> ONE expiry record: `INSERT INTO job_audit_events` (job_id = event id, tenant_id =
     the event's tenant_id, actor `'owner'`, reason `'projector_delivery_expired:<projector>:<age|cap>'`, fn_name `'outbox_projector_enable'`, operation_id = one
     uuid per CLI run, created_at `clock_timestamp()`). The reason must carry the projector because the existing delivery audit rows do not (`0022:309-315`,
     `0022:475-481`, `0056:268-270`); idempotency check = NOT EXISTS a row with that job_id and `starts_with(reason, 'projector_delivery_expired:<projector>:')` (`starts_with`, not `LIKE`: the `_` a projector name may hold is a LIKE wildcard).
   - Invariant (AM5): a record is written only for an acked event, and an acked event is never claimed again (`0023:180`), so no expiry record is ever
     followed by a delivery.
   - Execution: transaction 2 classifies ONCE (the single scan above) and writes with TWO set-based statements fed by that one result: `SELECT job_prepare_projector_delivery(id, $name) FROM unnest($ids::uuid[]) AS id`
     for every candidate to prepare, and ONE `INSERT INTO job_audit_events ... SELECT ... FROM unnest(...)` for every expiry record. An event therefore lands in exactly one of them, and the
     projector row lock a DD-134 disable waits for is held for three statements (the scan and the two writes), never one round trip per candidate.
3. public_sessions only, after transaction 2: the canonical rebuild of the 4.7 (h) owner loop with existing functions, for EVERY tenant that has an outbox event
   (complete set: a public session always produced events; this also covers a tenant whose alias was rejected while the projector was off):
   `SELECT public_sessions_project_session(c, NULL) FROM public_sessions_tenant_candidates(t) AS c` (NULL event id = no audit row, `0061:28-31`). Older
   public_sessions events are thus expired-with-record AND their state is rebuilt from canonical rows. The tenant list is read once, then the rebuild is ONE
   READ COMMITTED transaction per tenant, each opening with a plain read of `outbox_projectors.enabled` with NO row lock, so a DD-134 disable never waits for the
   rebuild; a disable stops it with exit 2 `projector_disabled` at the first tenant after it, and the tenants already rebuilt stay committed.
4. Output: one JSON summary line `{projector, changed, prepared, expired_age, expired_cap, rebuilt_sessions}`: the projector name, the changed flag and counts
   only (RO-L24-1 condition 3); the run's operation_id goes into the expiry records only (`job_audit_events.operation_id` is NOT NULL, `0022:133-142`) and is
   never printed. Re-running on an already enabled projector is allowed and idempotent (changed=false; a second run adds no row and no record): it is also the
   recovery path if someone enabled with the raw function.

Unchanged, byte-identical: `apps/bot/src/dispatcher.ts`, `apps/bot/src/worker.ts` (probe guard, exact-"true", boot order), every migration and SQL function
(0022/0023/0056 untouched), the DD-134 values (`dispatcher.ts:16-23`, `:457-472`), the rollback path (rows prepared before a disable wait and resume at
re-enable), the committed defaults. Test A5 is KEPT: it pins the claim path (an acked event is never reclaimed), which stays true; the new reachability comes from
the CLI.

Why the ordering is race-free (S0a Q3, B1 row): an event's set read needs the event claimed, so committed; if that read preceded the enable commit, the event
was visible before transaction 2's scan started, and the scan takes it acked or not; an event committed after the scan started is claimed after the enable
commit, so its own set read includes the projector; overlaps are absorbed by ON CONFLICT DO NOTHING. A scan restricted to `acked_at IS NOT NULL` would lose the
claimed-not-acked events.

### 3.3 Deciding tie-breaks

1. Migration only if unavoidable (owner text): B1 is the only migration-free design that closes the loss for all three projectors (A, B2 and D need one; C
   alone covers public_sessions only).
2. Fail-closed: nothing older than the bound is delivered by the backfill, every unacked candidate gets a row and every other acked candidate is recorded
   (AM5); A starves fresh events, D grows rows without bound.
3. Fewest concepts: one script, existing functions, one bound and one cap for all three projectors, the existing audit table as the record.
4. Precedent: `scripts/outbox-dlq-replay.mjs` (owner seat, `SET ROLE job_definer`, exit codes) and the 4.7 (h) owner loop.
5. Reversible: a script and its tests; no schema and no runtime-path change; removing the script restores today's behaviour.

## 4. Pinned defaults

Tiers per level3 §6.1. D1-D8 are Tier B: each is "default applied, pending owner sign-off" here and in the PR body. D9 is Tier A (derived from the base).

- **D1** design: B1 + the per-projector rule = the owner enable CLI with a bounded backfill, NO migration (3.2). Rejected: A (head-of-line starvation, audit
  churn, migration), B2 (migration replacing a pinned 0056 function, not race-free in one transaction, breaks A5), D (migration, unbounded rows for a
  never-enabled projector, an expiry status or DLQ class = a DD-134 matrix change), C alone (folded in; "web_realtime nothing" loses the open tab). Default
  applied, pending owner sign-off.
- **D2** age bound: `BACKFILL_MAX_AGE` = 30 minutes on `outbox_events.created_at`, DB clock at the scan and at the AM1 check. Restated by AM2: the bound caps
  the event's age when its row is PREPARED; DD-134's unchanged retries (8 attempts, waits 15 s x 2^(n-1), `dispatcher.ts:16-17`, `:21-23`, `:457-465`) add
  their own stretch, 15 s x 127 = 1905 s of backoff (the runbook `:71-72` states about 39 minutes), so a backfilled DM's worst case is about 70 minutes after
  the event versus about 39 for the live path. 30 minutes is kept as the default because it covers the enable procedure and a short rollback window and is
  of the same order as DD-134's own retry stretch. A tighter total bound needs a delivery-time age check in zalo_dm, which would also change how DD-134
  rollback-resumed rows end: that is the owner's DD-134 decision (OPEN, F1), not this lane's. The bound exists because zalo_dm late deliveries are harmful
  for three types (2.3) and the negative scope requires an age bound and a test for any design that can deliver an old event as a DM. Rejected: a
  delivery-time check (a DD-134 outcome change, F1); no bound (threat 2;
  plexco_smoke holds events 5.4 days old); per-projector bounds (D4); the session end as the bound (it already gates only cancelled correctly, `0057:116-126`).
  Default applied, pending owner sign-off.
- **D3** count cap: `BACKFILL_MAX_ROWS` = 200 per projector per CLI run, newest first among the ACKED in-window candidates; every acked candidate beyond it
  gets an expiry record (`...:cap`), never left silently; an unacked candidate is outside the cap and always gets a row (AM5). Flood guard (threat 2): one
  drain delivers up to 500 rows per projector (2.1), the web listener closes every stream
  past 1,000 queued events (2.4), and phase 2 interleaves backfilled and fresh rows by event_id (`0022:374`). Newest first: the newest are the least stale.
  Rejected: no cap; oldest first (spends the cap on the events nearest the bound); leaving the remainder for a later run without a record. Default applied,
  pending owner sign-off.
- **D4** one bound and one cap for all three projectors, web_realtime included: fewest concepts; in-bound hints are harmless and refresh a tab open across the
  gap (2.4); public_sessions also gets the rebuild (D7). Rejected: "web_realtime nothing" (C, and S0b's conclusion "an expiry record is enough": the open tab
  stays stale); per-projector values (three numbers to justify and test). Default applied, pending owner sign-off.
- **D5** the enable-time step is an owner command, `scripts/outbox-projector-enable.mjs enable --projector <name>`, the only sanctioned enable; it replaces the
  runbook's raw enable (`:13`, `:52-56`). The disable (rollback) stays the raw owner function with `false` (runbook `:60`): pending rows wait (DD-134). Rejected:
  automatic inside the function or a trigger (B2); an enable plus a separate backfill command (two steps to pair: the raw path, R1). Default applied, pending
  owner sign-off.
- **D6** the expiry record (3.2 step 2): one `job_audit_events` row per (event, projector), only for an ACKED candidate older than the bound or beyond the cap
  (AM5), reason `'projector_delivery_expired:<projector>:<age|cap>'`, actor
  `'owner'`, fn_name `'outbox_projector_enable'`, one operation_id per run, the event's tenant_id; idempotent by NOT EXISTS. Rejected: a delivery row completed
  `delivered` + providerRef `noop_expired` (`zalo-dm.ts:40-46` precedent: completion needs the claim token and live lease of a `claimed` row, `0022:443-451`,
  and the claim picks rows in event_id order, `0022:369-377`, so the owner cannot target one; it would also read as delivered); a `dlq` row (a replayable DLQ
  entry: a DD-134 matrix change); one summary row per run (no per-event outcome); a new table or column (a migration). Default applied, pending owner sign-off.
- **D7** the rebuild tenant set: every tenant that has an outbox event, after transaction 2, public_sessions only (3.2 step 3); the candidates include the
  tenant's already-projected rows (`0061:330-340`). Rejected: the 4.7 (h) loop's "tenants with an approved alias" (misses a tenant whose alias was rejected while
  the projector was off). Default applied, pending owner sign-off.
- **D8** the interim runbook order. Until this lane merges: the current runbook order is the rule (2.1 all projectors off, flag `"true"`, restart the worker;
  2.2 heartbeat `outbox_dispatch_schedule_live()` = t; 2.3 wait until no event is unacked; 2.4 enable with the raw function), accepting the loss its `:11`
  states. After the merge: 2.1-2.3 unchanged, 2.3 restated as the precondition of every CLI enable or re-enable and ENFORCED BY CODE (AM1): the CLI's
  transaction 1 refuses with exit 2 `unacked_backlog` (nothing enabled, no row, no record) while an event routed to the projector is unacked and older than
  the bound, so the CLI's classification is final; 2.4 = the CLI; the raw enable is forbidden and a CLI re-run is the recovery (R1). Rejected: a
  runbook-only precondition (the pre-AM1 text: one operator slip would contradict an expiry record, F2); dropping 2.3 (the operator still waits for the
  drain, the CLI refuses otherwise). Default applied, pending owner sign-off.
- **D9** (Tier A): U1 runs both transactions and the rebuild at READ COMMITTED (`0067:234-236` raises 25000 otherwise); the route join uses the predicate of
  `0056:131-136` (exact event type or the NULL wildcard, on the route's aggregate type); no new GRANT, SQL object, env value or committed default; the FOR UPDATE
  of transaction 2 waits only on another enable or disable of that projector, never blocks the dispatcher (its reads take no lock, `0056:117`, `:131`,
  `:144-152`).

## 5. Implementation steps

Dependency order U1 -> U2 -> U3 -> U4, one file per writer, never two at once; each commits in the worktree and never pushes (the orchestrator pushes once);
GitNexus `impact` before each symbol edit (U3 is the only writer editing existing symbols), `detect_changes` before each commit; a writer stops at the owner's
token rule and hands off.

- **U1** opus/max: NEW `scripts/outbox-projector-enable.mjs`: 3.2 steps 1-4 with D2-D9, on the conventions of `scripts/outbox-dlq-replay.mjs` (`:9-12`, `:84`,
  `:96`, `:104`, `:108`): exit 2 for `projector_not_found` (P0002, `0056:171-174`), `unacked_backlog` (AM1: transaction 1,
  before enabling; the count only in the output), `projector_disabled` and bad arguments (before connecting), exit 1 otherwise;
  a header comment states the threat model (6.2), the bound, the cap, the AM1 refusal and that a raw enable skips the backfill. Calls only `outbox_projector_set_enabled`,
  `job_prepare_projector_delivery`, `public_sessions_tenant_candidates`, `public_sessions_project_session` plus the D6 INSERT. Classification per AM5 (3.2
  step 2): every unacked candidate gets a row outside the cap; the cap and the expiry records apply to ACKED candidates only. Connection only from the
  environment; stdout only the step 4 summary (RO-L24-1 condition 3).
- **U2** opus/max: NEW `packages/db/src/outbox-projector-enable.test.ts` (real DB: a per-file database through `setupRlsTestContext`, `withJobDefinerLock`,
  owner helpers as in `outbox-projector-registry.test.ts:42-108`; the script run as a child process, as the owner-CLI test
  `apps/bot/src/projector-registry.test.ts:257` runs `outbox-dlq-replay.mjs`; events aged by an owner UPDATE of `created_at`, as A5 ages a lease `:288-291`):
  rows EN-1..EN-15 (6.3; EN-13 is the AM1 refusal), including (AM5, RO-L24-1 conditions 3-4): an unacked in-window candidate beyond the 200 cap gets a
  delivery row, not a record (EN-14); the `unacked_backlog` way forward: after the exit-2 refusal a worker cycle acks the old events (or the runbook drain
  step runs), then the CLI succeeds and those acked events older than the bound get an expiry record, never a dead end (EN-15); a second run adds no row
  and no record (EN-3); the CLI reads its connection only from the environment and prints only counts and projector names (EN-10).
- **U3** opus/max: `apps/bot/src/projector-registry.test.ts` (extend; lane-owned, AM3; its database `plexco_bot_projector_registry`, helpers `insertEvent` `:148`,
  `deliveries` `:157`, `asOwner` `:166`, `cycle` `:177`; seams `setWebRealtimeDbForTests(workerPool)`, `createZaloDmDeliver({db, send})` with
  `startZaloStub` (`apps/bot/src/test-zalo-stub.ts:34`), `createPublicSessionsDeliver({db: workerPool})`): rows BS-1..BS-7 (6.3); the rollback pin `:180-206`
  and the bot A5 pin `:208-229` unchanged. Per projector (web_realtime, zalo_dm, public_sessions; RO-L24-1 condition 5): the boot sequence "the committed
  flag default true read from `.env.example`, every projector disabled, events produced and acked with `'{}'`, the CLI enables: within the bound delivered
  (or claimed to the projector), older -> expired with a record, over the cap -> expired with a record" (BS-1..BS-4), the exit-2 refusal (BS-7), the
  rollback path (disable with pending rows, re-enable) unchanged (BS-5), and "`git diff` shows no change to `apps/bot/src/worker.ts`,
  `apps/bot/src/dispatcher.ts` or any migration" (section 7 item 7).
- **U4** sonnet/high: `docs/runbooks/outbox-dispatch-enable-rollback.md` (owner-facing Vietnamese prose kept, commands in English): `:3` (source: lane L24, item
  1); `:10-11` (the 2026-10-21 loss sentence `:11` kept and stated as correct for the OLD path, a direct `outbox_projector_set_enabled` call; through the CLI,
  events acked while a projector is off are reachable within the bound, otherwise expired with a record); `:13`, `:52-56` (the new enable procedure: the CLI is
  the only enable, with the bound values, 30 minutes and the newest 200 acked candidates, every unacked candidate prepared outside the cap (AM5); JSON summary,
  exit codes, the raw enable forbidden, a CLI re-run recovers); `:14-15` (stale: all three modules are wired,
  `projectors/index.ts:21-25`; the stub code is `no_projector_implemented`, `dispatcher.ts:56-59`); `:44-50` (2.3 as the precondition, D8, with the way
  forward for `unacked_backlog`: let the worker drain and ack the old events, the drain step 2.3, then run the CLI again; the "never assigned
  more" rationale replaced); `:62-64` (rollback note: a disable keeps pending rows, which wait and resume; a re-enable through the CLI is idempotent; events
  acked while disabled follow the CLI rule at re-enable; the public_sessions rebuild is part of the CLI). Unchanged: `:12`, `:65-67`, `:71-73`, `:87-98`.

## 6. Acceptance matrix

### 6.1 Decision table

Events: **E1** = produced while the projector was disabled and, at the scan, either unacked (always prepared, outside the cap; inside the bound by AM1) or
acked, created within 30 minutes of the CLI run and among its newest 200 acked candidates (AM5); **E2** = produced while disabled, ACKED, older than the
bound or beyond the cap; **E3** = produced while the projector was enabled. In-flight events (claimed, not yet acked at the scan) are always E1 (no
`acked_at` filter; AM5), never E2. Outcomes: **DELIVERED** = a delivery row (backfilled, prepared by phase 1, or resumed) delivered by
phase 2 on the unchanged DD-134 path; **EXPIRED** = one D6 expiry record for an acked event, never delivered (the AM5 invariant, 3.2 step 2); **REBUILT** =
the public_sessions state recomputed from canonical rows by 3.2 step 3; **N/A** = not applicable, reason given.

| Scenario | Event | web_realtime | zalo_dm | public_sessions |
|---|---|---|---|---|
| S1 enabled later through the CLI | E1 | DELIVERED (backfilled id-only hint; an open tab refetches) | DELIVERED (backfilled; the bound caps the event's age when its row is PREPARED (AM2), DD-134's unchanged retries add their own time; ended or changed sessions still refused, `0057:116-126`; retries: F1) | DELIVERED (backfilled recompute) and REBUILT |
| S1 | E2 | EXPIRED (a tab refetches on its next open, 2.4) | EXPIRED (no stale DM; precondition F2) | EXPIRED and REBUILT |
| S1 | E3 (after the enable commit) | DELIVERED (phase 1 prepares: its set read follows the enable commit) | DELIVERED (same) | DELIVERED (same) |
| S2 re-enabled through the CLI after a disable with pending rows | E1 (disable window) | DELIVERED (backfilled at the re-enable) | DELIVERED (backfilled at the re-enable) | DELIVERED and REBUILT |
| S2 | E2 (disable window) | EXPIRED | EXPIRED (precondition F2) | EXPIRED and REBUILT |
| S2 | E3 (before the disable; row pending at the disable) | DELIVERED (the row waited and resumes: rollback pin) | DELIVERED (resumes at any age: R2, DD-134 unchanged) | DELIVERED (resumed recompute) and REBUILT |
| S3 never enabled | E1 | N/A: no consumer exists, so nothing is lost for it; the ack `'{}'` is recorded (`outbox_acked`, `0023:289-292`); a later CLI enable makes it S1 | N/A (same; no DM is owed while the projector never runs) | N/A (same; sessions stay non-public, fail closed: the fence clears only by a projection, `public-sessions.ts:10-13`) |
| S3 | E2 | N/A (as E1; at a later CLI enable it is EXPIRED) | N/A (same) | N/A (same) |
| S3 | E3 | N/A: no event is produced while a never-enabled projector is enabled | N/A (same) | N/A (same) |
| S4 enabled with the raw function, CLI run later | E1 (in bound at the CLI run) | DELIVERED (backfilled at the CLI run, changed=false) | DELIVERED (backfilled at the CLI run) | DELIVERED and REBUILT |
| S4 | E2 (older at the CLI run, also when it was in bound at the raw enable: R1) | EXPIRED | EXPIRED | EXPIRED and REBUILT |
| S4 | E3 (after the raw enable) | DELIVERED (phase 1; an event whose set was read before the raw enable commit has no row and is E1 or E2 at the CLI run) | DELIVERED (same) | DELIVERED (same) |

36 cells (12 rows x 3 projectors): 18 DELIVERED, 9 EXPIRED, 9 N/A with the reason; REBUILT is added to the public_sessions cells of S1, S2 and S4 (E1, E2, and
S2 E3). No cell is silently dropped. Every E2 cell holds unconditionally by the AM5 invariant (3.2 step 2): E2 holds only ACKED events, the only events that
get an expiry record, and an acked event is never claimed again, so no expiry record is ever followed by a delivery; an unacked candidate always gets a row
instead, and AM1 keeps every unacked routed event inside the bound (transaction 1 refuses with exit 2 `unacked_backlog`, nothing enabled, while one is older
than the bound; only new events can appear after that check) (F2 RESOLVED).

### 6.2 Threat model (stated in U1's header and the PR body)

| # | Threat | Mechanism | Proven by |
|---|---|---|---|
| 1 | Silent loss for a projector enabled later | the CLI is the enable; transaction 2 (after the enable commit, routes join, no `acked_at` filter) prepares every unacked candidate and the newest 200 acked in-bound ones and records every other acked candidate (AM5); a CLI re-run recovers a raw enable (R1) | EN-1, EN-2, EN-4, EN-5, EN-9, EN-11, EN-14; BS-2, BS-3, BS-4 |
| 2 | A flood of stale events at enable | the 30-minute bound (DB clock) and the 200-row cap on acked candidates, newest first; the acked remainder EXPIRED (AM5); public_sessions recomputed from canonical rows, not replayed; D8 step 2.3, enforced by the CLI's AM1 refusal | EN-1, EN-2, EN-13; BS-2..BS-4 (back-dated events never delivered), BS-7 |
| 3 | A fail-open boot | `worker.ts` unchanged (exact-"true", stub refusal, probe, boot order); projectors seeded disabled (`0056:105-106`); phase 2 skips disabled projectors (`dispatcher.ts:223`); events acked `'{}'` stay reachable within the bound, the rest recorded; the CLI refuses to enable over an unacked routed backlog older than the bound (AM1, exit 2 `unacked_backlog`, nothing enabled; the way forward is the drain, EN-15), so no such event gets an expiry record and a later delivery | BS-1; EN-13, EN-15; BS-2..BS-4 first step, BS-7; unchanged `schedule.test.ts:200-217`, `:566-585`, `:587-620` |
| 4 | Duplicate delivery | ON CONFLICT DO NOTHING on the PK (`0022:306`, `0005:48`); FOR UPDATE serializes CLI runs; the scan skips any event with a row or a record; NOT EXISTS on the record | EN-3, EN-6, EN-7; precedent `outbox-wake.test.ts:229` |
| 5 | Cross-tenant leakage | delivery rows carry no tenant_id and every reader joins `outbox_events` (`0022:361-363`, `:387-395`, `0056:196`); a record copies its event's tenant_id; the rebuild runs per tenant; owner seat only, no new grant | EN-8, EN-9 |

### 6.3 Tests mapped to files

U2, `packages/db/src/outbox-projector-enable.test.ts` (real DB):

- EN-1 bound: an event acked `'{}'` aged 29 min -> one `pending` row, attempts 0, audit `projector_delivery_prepared`; aged 31 min -> one `...:age` record, no
  row; ages measured with the DB clock; also on a re-enable after a disable (S2).
- EN-2 cap: more than 200 ACKED in-window candidates -> the newest 200 prepared, the rest `...:cap`; the summary counts match.
- EN-3 idempotent: a second run -> changed=false, prepared 0, expired 0; one row or one record per (event, projector).
- EN-4 routes: only routed types are candidates (a zalo_dm non-route gets neither); the web_realtime wildcard covers session-aggregate types; tenant-aggregate
  public_sessions types are candidates.
- EN-5 in-flight: an event claimed (live lease) but not acked at the scan is a candidate and gets a row, never a record (AM5); its later ack without the
  projector still succeeds (`0023:257-267`).
- EN-6 existing: an event with any row for the projector (pending, failed, delivered, dlq) gets no prepare and no record.
- EN-7 concurrent: two CLI runs at once -> still one row or one record per (event, projector).
- EN-8 tenant: two tenants in one run -> each record's tenant_id equals its event's.
- EN-9 rebuild: a session published while off, older than the bound -> EXPIRED and public after the run; a session cancelled while off -> its public row
  deleted; no audit row from the rebuild; a tenant whose alias was rejected while off is covered.
- EN-10 refusals and output: unknown projector -> exit 2; `projector_disabled` -> exit 2, nothing written (the writer picks the seam); bad arguments or no
  `DATABASE_URL_MIGRATION` -> refused before connecting; the connection is read only from the environment (no DSN argument); one JSON line with exactly the
  3.2 step 4 keys (no operation_id: the projector name, the changed flag and counts only); no credential or payload in stdout or stderr.
- EN-11 raw then CLI: a raw enable, events produced, then the CLI -> changed=false, in-bound no-row events prepared, the rest recorded, rebuild run.
- EN-12 A5 kept: `outbox-projector-registry.test.ts:274-298` unchanged and green (the claim path; it never runs the CLI).
- EN-13 unacked backlog refusal (AM1): an unacked event routed to the projector and older than the bound -> exit 2 `unacked_backlog`, the count only in the
  output, the projector stays disabled, no delivery row, no expiry record; the same refusal on a re-run for an already enabled projector, nothing written.
- EN-14 unacked beyond the cap (AM5): an unacked in-window candidate beyond the 200 cap (more than 200 newer acked in-window candidates) gets a delivery
  row, not a record; the newest 200 acked ones are prepared and the rest `...:cap`.
- EN-15 the `unacked_backlog` way forward (RO-L24-1 condition 4): after the exit-2 refusal a worker cycle acks the old events (or the runbook drain step
  runs), then the CLI succeeds and those acked events older than the bound get an expiry record, never a dead end.

U3, `apps/bot/src/projector-registry.test.ts`:

- BS-1 flag: the committed `OUTBOX_DISPATCH_SCHEDULE_ENABLED` read from `.env.example:91` is `"true"`; `resolveWorkerDispatchEnablement(value, PROJECTORS,
  () => probeOutboxRegistry(workerPool))` -> enabled with every projector disabled (the 0056 seed).
- BS-2 web_realtime, BS-3 zalo_dm, BS-4 public_sessions (RO-L24-1 condition 5): the committed flag default `"true"` (BS-1), every projector disabled, events
  produced for the projector's routes -> a cycle acks `'{}'`, no row, no record -> the CLI enables -> the next cycle delivers the in-bound events through the
  projector's seam (or claims them to the projector; zalo_dm: the stub receives each in-bound DM once); a back-dated event gets a record and is never
  delivered; over the 200 cap the acked remainder gets a record (`...:cap`) and is never delivered; public_sessions: an old published session is public after
  the CLI (rebuild) without its event being delivered.
- BS-5 rollback kept: `:180-206` unchanged and green; per projector, a disable with pending rows then a CLI re-enable: the pending rows resume (DD-134
  unchanged) and the CLI adds no row and no record for their events. BS-6 bot A5 kept: `:208-229` unchanged and green (a raw enable still gains no delivery: R1).
- BS-7 refusal, per projector: an unacked routed event older than the bound -> the CLI exits 2 `unacked_backlog`, the projector stays disabled, no row, no
  record; after a cycle acks it, the CLI succeeds and the event gets an expiry record (EN-15 in the boot sequence).
- Probe guard untouched: `git diff` shows no change to `apps/bot/src/worker.ts`, `apps/bot/src/dispatcher.ts` or any migration (section 7 item 7);
  `schedule.test.ts:200-217`, `:566-585`, `:587-620`, the DD-134 tests in `dispatcher.test.ts` and the DLQ pins
  A6-A11 (`outbox-projector-registry.test.ts:302`, `:349`, `:571-639`) unchanged and green.

Cells to tests: S1 -> BS-2..BS-4, EN-1, EN-2, EN-4, EN-5, EN-9, EN-14; S2 -> EN-1 (re-enable), EN-6, BS-5; S3 -> EN-12, BS-6, BS-2..BS-4 first step; S4 ->
EN-11, BS-6; the AM1 precondition of every E2 cell -> EN-13, EN-15, BS-7.

## 7. Verification

Cite measured output through `| tail -40`. Every DB run goes through the session's lock wrapper `status/P3-S16d-notes/scripts/locked-run.sh` (outside the
repo; lock `status/.db-e2e.lock`; S0a ran A5 through it), one at a time; L27 (P3-S16e) shares the lock.

1. Focused, locked: `NODE_ENV=test DATABASE_URL_TEST=... pnpm --filter @plexco/db exec vitest run src/outbox-projector-enable.test.ts` and the same for
   `@plexco/bot` `src/projector-registry.test.ts`.
2. `pnpm typecheck`; `pnpm lint`; `pnpm format:check`; `pnpm review:check:changed` and `pnpm review:check`.
3. Locked: `NODE_ENV=test DATABASE_URL_TEST=... pnpm --filter @plexco/db test`; `NODE_ENV=test DATABASE_URL_TEST=... pnpm --filter @plexco/bot test`.
4. `NODE_ENV=test pnpm --filter @plexco/web test` (S1 VERIFY; no web file changes; no UI change, so no Playwright or golden path).
5. Once at the final head: locked `NODE_ENV=test DATABASE_URL_TEST=... pnpm -w test` (one rerun for a listed flake) and `pnpm build` (sandbox off).
6. Known flakes: the S1 list, one rerun, a second red is real; re-run the role-password step after every full run.
7. Byte-identical guards: `git diff --stat 575c766047899966782194337f360b6c058ca4ce -- apps/bot/src/dispatcher.ts apps/bot/src/worker.ts packages/db/migrations`
   prints nothing; B3 measured before the PR (section 9).

## 8. Tool hazard

- The Bash tool's shell is zsh: loops, awk and multi-step logic go in a script under `status/P3-S16d-notes/scripts/`, run with `bash <file>`; never `bash -c`,
  `sh -c`, `zsh -c`, `python -c`, `node -e` or `perl -e`; in zsh write `${ref}:path` for `git show`.
- Sandbox off for Docker (container psql only, no host psql), `git fetch` and `push`, `gh`, `git worktree add` and local port binding.
- One shared local Postgres and one e2e port = one lock across lanes: never two DB suites, migrations or e2e runs at once.
- Never `docker compose down -v`; compose started from another checkout re-binds the Postgres mount: re-bind by running compose once from the root checkout (a
  command, never a file edit).
- The CLI enables a projector: run it ONLY against a database the test itself created, never against plexco, plexco_smoke or another shared database (negative
  scope; STOP: HALT). `.env.example` and the committed defaults stay as they are; no real deliverer, bot token or production env.

## 9. Budget (B3)

Lane caps, pre-approved: 900 non-test, 1,500 test, 2,400 total, 24 files; 0 migrations for this design (a migration would be a STOP without a slot).

| Unit | File | Non-test | Test | Docs | Files |
|---|---|---|---|---|---|
| U1 | `scripts/outbox-projector-enable.mjs` (new) | 200-280 | 0 | 0 | 1 |
| U2 | `packages/db/src/outbox-projector-enable.test.ts` (new) | 0 | 400-560 | 0 | 1 |
| U3 | `apps/bot/src/projector-registry.test.ts` | 0 | 280-420 | 0 | 1 |
| U4 | `docs/runbooks/outbox-dispatch-enable-rollback.md` | 0 | 0 | 40-80 changed | 1 |
| step 0 | this file | 0 | 0 | 300-360 | 1 |
| Total | | 200-280 | 680-980 | 340-440 | 5 |

Docs counted as non-test: 540-720 of 900; total 1,220-1,700 of 2,400; 5 of 24 files; 0 migrations. No B3 exception needed; a crossed cap is a ruling request
before the next writer starts.

## 10. OPEN

Residual risks (stated in the runbook and the PR body; none is an open question in scope):

- R1 a raw-function enable skips the backfill, as today, until the CLI is run; the runbook forbids it and a CLI re-run recovers (within the bound DELIVERED,
  otherwise EXPIRED, public_sessions REBUILT); the bound is measured at the CLI run, so a long gap turns in-bound events into expired ones.
- R2 OUT_OF_SCOPE, DD-134 unchanged: a zalo_dm row prepared BEFORE a rollback disable resumes at any age after the re-enable (the targets definer still refuses
  ended or changed sessions, `0057:116-126`); an age check at delivery would be a DD-134 decision for the owner (owner questions OQ1 and OQ2 below).
- R3 OUT_OF_SCOPE nit (S0a): `claim_projector_delivery_batch` stamps the delivery lease with `now()` (`0022:380`), the outbox claim with `clock_timestamp()`
  (`0023:194`); harmless for autocommit callers.

Owner questions for the PR body (RO-L24-1 condition 6; not lane work: this lane neither builds them nor waits on them):

- OQ1 (F1, a DD-134 decision): should zalo_dm deliveries get a delivery-time age check? This lane adds none; its 30-minute bound applies when a row is
  prepared (D2, AM2).
- OQ2 (R2, unchanged): rows resuming after a rollback re-enable deliver at any age, as DD-134 has it today; should that stay?

Flagged against `design-decision.md` by the inventories (recorded, not changed; the orchestrator rules):

- F1 OWNER QUESTION OQ1 (PR body), the owner's DD-134 decision, not this lane (AM2): D2 bounds a backfilled row's age when it is PREPARED; DD-134's unchanged retries add 1905 s of
  backoff (the runbook `:71-72` states about 39 minutes), so a backfilled zalo_dm DM's worst case is about 70 minutes after the event versus about 39 for the
  live path. A tighter total bound needs a delivery-time age check in zalo_dm (`zalo-dm.ts` step 1, `:89-117`, on `job.event.createdAt`), which would also
  change how DD-134 rollback-resumed rows end (R2); the owner decides it with DD-134. The design adds none and keeps 30 minutes as the default (D2).
- F2 RESOLVED by AM1: the CLI's transaction 1 refuses with exit 2 `unacked_backlog` (nothing enabled, no row, no record) while an event routed to the
  projector is unacked and older than the bound, so no such event can get an expiry record and then be claimed and delivered at any age; D8's step 2.3 is
  enforced by code (EN-13). plexco_smoke holds 137 such events today (0 routed to zalo_dm): the CLI refuses for web_realtime and public_sessions there until
  the worker has acked them.
- F3 RESOLVED by AM3: `apps/bot/src/projector-registry.test.ts` is lane-owned (orchestrator Tier-A reading of FILE OWNERSHIP "the dispatcher ... and their
  tests": it holds the A5 pin, the rollback pin and the cycle helpers); L27 owns none of it.
- F4 reconciled, design wins pending sign-off: S0b concluded "web_realtime needs NO replay; an expiry record is enough"; D4 includes web_realtime (2.4).
- F5 reconciled: S0b's B1 race (a set read before the enable commit, acked after the backfill selected its candidates) is closed by S0a's no-`acked_at`-filter
  rule the design adopts (3.2), no second pass needed; S0b's "migration-free only if the owner seat may prepare a row for an acked event" is answered by reading
  (`0022:292-302`, `0023:257-267`, `0022:369-377`) and proven by execution in EN-1.
- F6 RESOLVED by AM4: the audit inserts are cited as `0022:309-315` and `0022:475-481` (3.2); the phase-1 claim takes 25 events per cycle (2.1), so the
  plexco_smoke backlog of 137 is 6 cycles in one drain.

## 11. Closure matrix (12 of 12)

| # | Gate | Evidence | Result |
|---|---|---|---|
| 1 | Authority snapshot pinned by SHA | `AUTHORITY_SHA` = the base `575c766047899966782194337f360b6c058ca4ce` (merge of PR #99, L18) = the worktree HEAD at step 0 (measured, header); `e049c92` (PR #97) is an ancestor; every TARGET_FILES path exists on disk | PASS |
| 2 | Decisions in scope final | owner item 1 of 2026-10-22 (design delegated) and the lane block (section 1); DD-134 and DD-141 unchanged (2.7); D1-D8 pinned as defaults pending owner sign-off, D9 Tier A (section 4); AM1-AM5 applied (3.2, 3.3, D2, D3, D6, D8, section 5, 6.1, 6.2, 6.3, section 10); RO-L24-1 conditions 2-6 applied (3.2, section 5, 6.3, section 10) | PASS |
| 3 | Scope IN/OUT and owner clear | section 5 units U1-U4, one file each; the lane's NEGATIVE SCOPE and FILE OWNERSHIP (`projector-registry.test.ts` lane-owned, AM3); B3 within the pre-approved caps (section 9); section 10 residue | PASS |
| 4 | Dependencies classified | L18 merged (the base is its merge); L27 (P3-S16e) beside with disjoint files and the shared DB lock (section 7); no migration slot requested (D1) | PASS |
| 5 | Live schema and code match | section 2, each row measured at the base (S0a SQL inventory and the A5 run, S0b TS inventory) | PASS |
| 6 | Data, API, state, auth contract | no migration and no SQL object, column, table, endpoint, grant or product error code; the CLI runs on the owner path only (`DATABASE_URL_MIGRATION`, `SET ROLE job_definer`) and calls existing functions plus the D6 audit INSERT (3.2, U1); `job_definer` owns or reads every object it touches, so no new function, grant or role (3.2 role paragraph, RO-L24-1 condition 2); `dispatcher.ts` and `worker.ts` untouched | PASS |
| 7 | Fail-closed, idempotency, order | transaction 1 refuses an unacked routed backlog older than the bound before enabling (AM1); transaction 2 starts after the enable commit, FOR UPDATE, no `acked_at` filter (3.2); ON CONFLICT DO NOTHING and NOT EXISTS on the record (threat 4); age and count bounds (3.2, D2, D3); expiry records only for acked events, so none is followed by a delivery (AM5) | PASS |
| 8 | Open questions in scope = 0 | D1-D9 pinned; F2, F3, F6 resolved (AM1, AM3, AM4); F1 and R2 are owner questions OQ1 and OQ2 for the PR body, outside this lane (AM2, RO-L24-1 condition 6); R1-R3 residue out of scope | PASS |
| 9 | Acceptance matrix with expected results | section 6: the decision table of 36 cells with no silent drop (6.1), the threat model of 5 rows (6.2), EN-1..EN-15 and BS-1..BS-7 mapped to files (6.3) | PASS |
| 10 | Migration, security, rollback | no migration (D1); opus/max security round (owner credential path, external DMs, delivery policy); the DD-134 rollback path and the probe guard byte-identical (2.7, threat 3); rollback = revert before merge | PASS |
| 11 | First slice hard dependencies merged | U1 needs only objects present at the base (the owner functions it calls, section 2); L18 merged | PASS |
| 12 | Implementation handoff ready | sections 5, 7, 8 and 9; the worktree exists at the base, clean at step 0 | PASS |

## 12. Verdict

```text
REVIEW_POLICY_VERSION: 1.3
REVIEW_VERDICT: CODE_READY
REVIEWED_AT: 2026-10-22
AUTHORITY_SHA: 575c766047899966782194337f360b6c058ca4ce
BASE_BRANCH: main
TARGET_FILES:
  - docs/runbooks/outbox-dispatch-enable-rollback.md
  - apps/bot/src/projector-registry.test.ts
  - docs/sessions/web-mvp-phase3-readiness-p3-outbox-projector-enable-no-loss.md
NEW_FILES (implementation scope, units U1-U2): scripts/outbox-projector-enable.mjs, packages/db/src/outbox-projector-enable.test.ts
SLICE: p3-outbox-projector-enable-no-loss
IN_SCOPE: the owner enable CLI scripts/outbox-projector-enable.mjs (U1: transaction 1 the AM1 unacked-backlog refusal, then the existing enable function; transaction 2 one bounded backfill per projector per AM5, every unacked candidate prepared outside the cap and the newest 200 acked candidates within 30 minutes prepared, one expiry record in job_audit_events for every other acked routed candidate; the public_sessions canonical rebuild; one JSON summary line of the projector name, the changed flag and counts); its real-DB tests packages/db/src/outbox-projector-enable.test.ts (U2, EN-1..EN-15); the boot-sequence tests (flags default true, projectors off, events produced, then the CLI enable, per projector) in apps/bot/src/projector-registry.test.ts (U3, BS-1..BS-7); the runbook docs/runbooks/outbox-dispatch-enable-rollback.md (U4)
OUT_OF_SCOPE: enabling any projector in any environment; a real deliverer, bot token or production env; apps/bot/src/dispatcher.ts, apps/bot/src/worker.ts and the projector modules (unchanged); the probe guard, the DD-134 policy values and rollback path, the exact-"true" semantics of DD-141; any migration or SQL object change; a delivery-time age check (F1, the owner's DD-134 decision); how events are produced; Reviewed specs, docs/legal and decisions.md; PR 50; the files of L27
G1_DECISION: PASS
G2_SPEC: PASS
G3_DEPENDENCY: PASS
G4_TEST: PASS
G5_SCOPE: PASS
G6_EXTERNAL: PASS
HARD_DEPENDENCIES: none required; L18 (PR 99, recommended) is merged as the base 575c766047899966782194337f360b6c058ca4ce
PRIOR_SLICES: PR 94 (DD-141, OUTBOX_DISPATCH_SCHEDULE_ENABLED defaults true); 0056 projector registry and owner DLQ replay (scripts/outbox-dlq-replay.mjs, the CLI conventions U1 follows); PR 66 zalo_dm, PR 67 web_realtime and PR 72 public_sessions (projector modules, unchanged); L22 RO-L22-2 (the loss measurement)
OPEN_QUESTIONS_IN_SCOPE: 0
ENABLEMENT_ONLY_GATES: none
LIVE_REPO_VERIFICATION: PASS
CONTRACT_MATRIX: PASS
CLOSURE_MATRIX: PASS
ACCEPTANCE_MATRIX: PASS
SECURITY_AND_MIGRATION_GATE: PASS # none: no migration, no SQL object changes; opus/max security round (owner credential path, external DMs, delivery policy)
IMPLEMENTATION_ARTIFACTS: PASS
FIRST_IMPLEMENTATION_STEP: unit U1 (opus/max) - create scripts/outbox-projector-enable.mjs per section 3.2 steps 1-4 with D2-D9 (transaction 1: FOR UPDATE, the AM1 unacked_backlog refusal, then the existing enable; transaction 2: the bounded backfill per AM5, every unacked candidate prepared outside the cap, the cap and the expiry records for acked candidates only; the public_sessions rebuild; one JSON summary line without operation_id) on the conventions of scripts/outbox-dlq-replay.mjs, then commit in the worktree
REMAINING_BLOCKERS: none
```
