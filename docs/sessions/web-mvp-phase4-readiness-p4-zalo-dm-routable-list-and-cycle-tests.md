<!-- review-readiness: code-ready -->

# Step-0 readiness: L45 p4-zalo-dm-routable-list-and-cycle-tests (session P4-S4b)

> Agent-facing. Step-0 readers R0a (Q1, Q4), R0b1 and R0b2 (Q2, Q3), opus/high, one at a time; the orchestrator read Q5-Q7 and the live CHECK. Their
> notes live outside the repo (session notes P4-S4b: `step0-R0a.md`, `step0-R0b1.md`, `step0-R0b2.md`, `design-decisions.md`), so this file restates
> every fact it relies on. Writers: W1 opus/high (D1, D6, D9), W2 opus/high (D3-D5), W3 opus/high (D2, D7); D8 and D10 by the orchestrator. Reviewers
> opus/max, R1a then R1b, each alone, at most 3 rounds counting pre-push rounds. No security round (section 7). RISK: P2 (bot transport code, owner
> CLIs, test infrastructure, one runbook note; no money, no schema, no migration).
> Base: `8e918f0ec541ef4f72740be652a3a86584d381c3` (origin/main, the merge of PR #126, L48); L44's merge `d1154dbc5ad72ba084ff954f37876f2651970e7f`
> (PR #125) is an ancestor; migration tail 0073. Branch `feat/p4-zalo-dm-routable-list-and-cycle-tests`; worktree
> `.autopilot/worktrees/p4-zalo-dm-routable-list-and-cycle-tests`, clean at step 0. Every `path:line` below was MEASURED at the base; the live CHECK was
> read from plexco_test at schema_migrations max 0073 (D2). Nothing tracked was edited and no test or CLI ran at step 0: the CLI texts in Q4 are derived
> from code, and D7 measures them.

## 1. Authority

- The owner's written approval of 2026-10-26 (DD-150), verbatim: `Phase 4 plan approved, Q1-Q10 default` (the owner's own decision). It approves `docs/sessions/web-mvp-phase4-plan.md`, whose section 3 row L45 (:61) is this lane (dependencies :92 `L45 <- L44`; note 5 :211). No plan line naming L45 ties it to a Q (the one Q mention among them, :100, gates L56 and L57).
- Lane contract: lane block L45 of the conductor's P4-S4b brief (not on main): leads (1)-(5), GOAL (1)-(6), FILE OWNERSHIP, Q1-Q7, NEGATIVE SCOPE, THREAT MODEL, DEFAULTS, TESTS, REVIEW PLAN, STOP, B3. The four rows it closes are pre-existing contracts (Q6): the lane implements them and changes no rule.
- RO-L45-1, decided by the conductor under the owner's delegation of 2026-10-22, not an owner signature (Tier B, reversible): (1) one agent live at a time; (3) the lane block's design defaults are pre-approved, deviation only with evidence; no new `scripts/` file; a routing-set change, or a cell that cannot be isolated without changing the dispatcher's logic, is a ruling request; (5) one new out-of-scope row (D10); (7) this file is the first content commit; DB commands only through the lane's lock wrapper; each cycle file twice in a row; the clerk's flake list (Q7); rows closed by hand with slice-unique bare-identifier probes.
- The owner's concurrency rule of 2026-10-26 18:32 (one orchestrator, one agent live). Review: the Web MVP program's named exception (CLAUDE.md, DD-122 D4): independent Claude subagent review, no Codex; CI unchanged.
- Every other choice is "default applied, pending owner sign-off" (section 3) and is repeated in the PR body.

## 2. Step-0 answers (measured at the base)

D = `apps/bot/src/dispatcher.ts`, E = `scripts/outbox-projector-enable.mjs`, R = `scripts/outbox-dlq-replay.mjs`, T = `apps/bot/src/projector-registry.test.ts`, ZT = `packages/db/src/zalo-dm-delivery.test.ts`, J = `apps/bot/src/zalo-dm-delivery-age-bound.json`; M22, M56, M71 = the migrations `0022_job_claim_lease_core.sql`, `0056_outbox_projector_registry_dlq_replay.sql`, `0071_zalo_dm_promotion_start_definer.sql`.

**Q1 (R0a).** J:1 is `{ "maxAgeMinutes": 60, "untilSessionStart": ["player.promoted"] }`, read by D:8 (import), E:60 (`createRequire`) and T:32 (only `.untilSessionStart`, T:704); nobody compares the whole object, so an additive key breaks no reader. The copies: D:77-82 `const ZALO_DM_ROUTABLE_EVENT_TYPES: readonly unknown[]` and E:66-71 `const ZALO_DM_EVENT_TYPES`, both unexported, each used only by its untilSessionStart subset check (D:83-94, E:73-79); E prints no type name (E:50-51); T:11 and `packages/db/src/outbox-projector-enable.test.ts:17` import E. With one list, both subset checks compare two keys of ONE file: only the drift test ties it to 0056, and the key needs its own load check per side (D1). The CHECK: M56:99-102 `outbox_projector_routes_zalo_dm_chk`, `event_type IN` the four; the live text is in D2; no migration 0057-0073 alters it (0058:26 is a comment); no test reads the definition (`packages/db/src/outbox-projector-registry.test.ts:189-190` pins two refusals only).

**Q2 (R0b1 sections 1-4; R0b2 items 3, 5).** A pass claims ANY claimable zalo_dm row: D:345-348 `claim_projector_delivery_batch($1, 1)`; M22:369-377 filters projector, status and due time, `ORDER BY pd.event_id`; `DispatchCycleOptions` (D:176-181) is `{ projectors; limit?; now? }`, with no id or time filter. Event ids are random v4 (`0005_sync_engine.sql:22`): the claim order across cells is random (the intermittent reds). `apps/bot/vitest.config.ts` sets `fileParallelism: true`, `sequence: { concurrent: false }`; no bot test file runs cycles on the shared `plexco_test` (T creates its own database, T:109, T:121-122; ZT too, ZT:16), so every cross-claim comes from an EARLIER CELL OF THE SAME FILE: serial files would not remove the cause, and no other cycle-driving bot file needs an edit. Leftovers: PSD-12 a pending row (T:1507-1512); PSD-13 unacked events (T:1581-1582); PSD-8 (T:1323-1325: EVERY claimed zalo_dm row) and DA-8 (T:1198) delete rows whose acked events a later `enable` re-prepares (T:811-812); PSD-14 drains them (T:1590-1593). Cleanup limit: `projector_deliveries` (0005:39) and `job_audit_events` (M22:135) reference outbox_events with NO ACTION and audit rows are append-only (M22:149-157), so `verify` (T:131) can delete own delivery rows but not a cycled cell's events. Hence NZ, the own-id neutralize `UPDATE projector_deliveries SET status = 'delivered', claim_token = NULL, lease_expires_at = NULL WHERE projector = 'zalo_dm' AND event_id = $1`: not claimable, not re-preparable (prepare is `ON CONFLICT DO NOTHING`, M22:306). Per cell: section 4.

**Q3 (R0b1 sections 5, 7; R0b2 items 1-2).** PSD-8 has one claimable row, so `break` -> `continue` at the stale stop D:378 passes (`if (!row) break;` D:350 ends the pass alike); its stub check was lost in 22d7009 (the start stub became own-only, T:1273, and the skip a sum over up to 20 cycles). PSD-10c (ZT:507-525) kills the deletion of M71:50, :51 and `AND p.enabled` (:45), not of `pd.projector = 'zalo_dm'` (:48) or `pd.status = 'claimed'` (:49); real exits from `claimed` null the token and lease (M22:355, :444, :454, :464), so only a forged status (nothing couples status and token, M22:263-264) kills :49; web_realtime routes player.promoted (M56:107-108) and is seeded off (M56:74). L44's cells: two titled `L44-c2` (T:1204 age rule, T:1226 start rule), looping on their own status (T:1212); no `c4` in T.

**Q4 (R0a Q4.7-Q4.10).** E: `main` E:283; parse refusal 2, unset URL 1 (E:285-295); the `pg` require E:296 and `new pg.Client({ connectionString: url, application_name: "plexco_outbox_projector_enable_cli" })` E:297 sit BEFORE `try` E:298; catch E:302-312 (redact E:271-281): Refusal 2, else `error: <code> <message>` plus the re-run hint, 1; finally E:313-315 `await client.end().catch(() => {});`. R: client R:101 (`application_name: "plexco_outbox_dlq_cli"`) BEFORE `try` R:102; catch R:111-118 (2 or 1); finally R:119-121. Both run under a top-level await (E:319-321, R:124). Today `postgres://u:FakePw123@[bad` throws in the constructor (pg `connection-parameters.js:59-60`; pg-connection-string `index.js:35-36` masks only `err.input`), outside `try`: Node's uncaught dump on stderr (`TypeError: Invalid URL`, a stack through `main`), exit 1. After the move: `error: ERR_INVALID_URL Invalid URL` (E adds its re-run hint), exit 1, the finally runs; this needs `let client;` and `client?.end()` (else the finally throws and the dump returns). Verdict (Q4.8): NO, NO: neither state prints a byte of the connection string; the moved lines hold only the DB client; no connector-secret path is touched. Tests run a CLI in T (`runCli` T:38-48, `runEnableCli` T:334-349) and in `packages/db/src/outbox-projector-enable.test.ts` (:447-456, `expectNoSecret` :458). Both CLIs are kit-pack members (`docs/standards/kit-pack-membership.json:172`, `:177`).

**Q5 (orchestrator).** `docs/runbooks/outbox-dispatch-enable-rollback.md`: step 4 (:52), its bash block :54-57 (the `export DATABASE_URL_MIGRATION` line :55); the DLQ section reuses it at :129; L53 rewords :61-62, :81, :98 later. The note: ONE line after :57 (D8).

**Q6 (orchestrator).** `docs/autopilot-backlog.md`: `owner-cli-pg-client-inside-try` :6733 (status :6735, merged_probe :6742, close_by :6743), `zalo-dm-routable-event-types-one-list` :7081 (:7083, :7090), `bot-zalo-dm-cycle-tests-isolation-and-cells` :7095 (:7097, :7104), `bot-queues-outbox-schedule-default-comment` :7153 (:7155, :7162); all `status: idea`, `merged_probe: null`, which the reconcile never flips (`scripts/autopilot-backlog-reconcile:289`, per :6990). Close form = L44's row :6986-6997: `status: merged` (:6988), `merged:` with no PR number or SHA (:6989), `note_merged:` (:6990), `merged_probe` (:6997). The CLI row's `close_by` (:6743) asks for the merge SHA; GOAL (5) and lead (3) say probe, no SHA: the lane block is followed and `note_merged:` says so.

**Q7 (RO-L45-1 (7), the clerk's list).** ACTIVE entries: the apps/bot timing tests outbox-wake A26 and A28, test-harness:149, schedule.test.ts, the app_worker password failure in dispatcher.test.ts: ONE rerun each; anything else is real. None is in a lane file.

## 3. Design (D1-D10)

Each item: "default applied, pending owner sign-off" (Tier B, reversible by editing this lane's files); RO-L45-1 (3) pre-approves D1-D3, D6 and D9.

- D1 one list: J gains the sibling key `routableEventTypes` (the four; additive). D:77-82 and E:66-71 drop their literals and read it; each side adds a fail-closed load check (an array of distinct non-empty strings, else throw, like D:70 / E:63) and keeps its subset check; both lists become exports (`ZALO_DM_ROUTABLE_EVENT_TYPES: readonly string[]` in D, `ZALO_DM_EVENT_TYPES` in E). Rejected: a shared module (the .mjs CLI cannot import TypeScript; a new `scripts/` file needs a kit-pack record); two copies plus a drift test (two definitions drift silently). Probe `apps/bot/src/zalo-dm-delivery-age-bound.json :: routableEventTypes`.
- D2 PSD-16 in T right after PSD-11 (T:703-717): through `verify`, `pg_get_constraintdef(oid)` of `outbox_projector_routes_zalo_dm_chk` (exactly one row); only its `ARRAY[...]` part (the text also holds `'zalo_dm'` and `'session'`); the quoted literals by a literal pattern (never a RegExp built from data, C11); their sorted set equals the J key, and both exports equal it. Live text at 0073: `CHECK (((projector <> 'zalo_dm'::text) OR ((aggregate_type = 'session'::text) AND (event_type IS NOT NULL) AND (event_type = ANY (ARRAY['session.updated'::text, 'session.cancelled'::text, 'session.announcement_requested'::text, 'player.promoted'::text])))))`. Rejected: a literal copy of the CHECK (a third list).
- D3 isolation by own event ids (section 4). Applied reading: a cell's stubs, assertions and cleanup read and change only its own ids, it leaves nothing claimable or re-preparable, and a planted realistic foreign claimable row does not change its result; the pass still CLAIMS that row (Q2) and the cell's stub delivers it. Means: own-id deliver and pool wrappers (a foreign job gets `delivered`, never a stop); stub calls and warn lines filtered by own chats and ids; drains on the own row's status (at most 20 cycles) instead of single-cycle comparisons and the `!fullBatch` error; NZ cleanup by own id (PSD-8 and DA-8 no longer delete by `status = 'claimed'`); PSD-12 and PSD-13 clean their own state; PSD-14 loses its drain; both `L44-c2` cells get NZ cleanup. Rejected: "a foreign row is never claimed" (a dispatcher scope option or a migration: negative scope); serial files (the cause is same-file leftovers, Q2).
- D4 committed plant: `plantForeignZaloDmRow` in T inserts ONE realistic foreign claimable zalo_dm delivery (a routed type on a valid event inside the bound) with event id `00000000-0000-4000-8000-000000000000`, so it sorts first, and neutralizes it by id after the cell (an audited event cannot be deleted, Q2: the helper re-arms the same row for the next cell). Every pass cell runs with it and asserts it was claimed (not vacuous) and its own result unchanged. "Twice in a row green" = the file twice under the lock (a fresh database, so a new random id order, each run). Rejected: a one-off manual plant. Probe `apps/bot/src/projector-registry.test.ts :: plantForeignZaloDmRow`.
- D5 the three cells. PSD-8b in T: two own promotions sorted by uuid; the own start stub stops the FIRST; in that cycle the SECOND stays pending, attempts 0, no deliver() call; one plain cycle then delivers it. PSD-8's stub check: the start stub ran once, for the own event and its live claim token (read through `verify`); `leaseLostSkips === 1` on that cycle, not summed. In ZT beside PSD-10c: a finished-delivery cell (forged statuses delivered, failed, dlq, pending with token and lease kept read `[]`; restored `claimed` reads one row; it ends on `claimed`, since `claimed()` ZT:124-134 claims up to 100 rows) and an other-projector-token cell (web_realtime enabled, its row claimed, its token reads `[]` while the zalo_dm token reads one row; OFF again in `finally`). Rejected: finishing through the real path (an equivalent mutant for M71:49).
- D6 in E and R: `let client;` before `try`, the construction inside it (with E's `pg` require), `finally { await client?.end().catch(() => {}); }`; no new flag or output. Each CLI names its `application_name` in a module constant `CLI_APPLICATION_NAME` (absent at the base, measured). Rejected: a URL pre-parse (new output). Probe `scripts/outbox-dlq-replay.mjs :: CLI_APPLICATION_NAME`.
- D7 a no-DB describe in T beside D-10 (T:50-70): R `list` and E `enable --projector zalo_dm` through `execFile` with `DATABASE_URL_MIGRATION` = `postgres://u:FakePw123@[bad`: exit code 1, `FakePw123` in neither stream, stderr holds the handler's `error: ` line and no `at main` line. Rejected: a new test file (T already runs both CLIs).
- D8 ONE runbook line, in the runbook's own style, right after :57: a password with URL-reserved characters is percent-encoded before it goes into `DATABASE_URL_MIGRATION`, else the CLI stops with `error: ERR_INVALID_URL ...`, exit 1, without printing the URL.
- D9 `apps/bot/src/queues.ts:11-13`: the committed default is "true" (`.env.example:91`, `infra/docker-compose.yml:133`; DD-141); an unset or other value leaves the schedule off (`apps/bot/src/worker.ts:45`); delivery still waits on the 0056 registry (projectors seeded off; only the owner CLI enables one). Probe `apps/bot/src/queues.ts :: committed` (absent at the base, measured).
- D10 (orchestrator, apply script): the four rows closed BY HAND in the L44 form (Q6) with the probes of D1, D4, D6, D9; ONE new out-of-scope row (section 11).

## 4. Decision table (D3): every cell of T that runs a zalo_dm pass

RS = the real deliverer feeding this cell's stub (`zalo.projectors`), any job; EAD = `expiredAtDelivery` (T:725-753: ONE cycle, ALL stub calls `[]` :734, ALL warn lines = the own line :744-746); PC = `promotionCycle` (T:1028-1045: ONE cycle, ALL calls and lines); OC = an own-chat filter. Every row also runs with the D4 plant; the effect column is the plant's effect on the cell's result at the base.

| Cell (T) | Own events | Stub | Assertions | Cleanup | Planted-row effect today | The edit |
|---|---|---|---|---|---|---|
| BS-3 :638-667 | 3 | RS | 2 cycles; chats = own 2, every call has the own token (:651-654) | disable, close | CHANGED | OC at :651-654 |
| DA-3 :669-689 | 1 | RS | ONE cycle; `toMatchObject([own])` :680 | same | CHANGED | OC at :680; `cycleUntil` (:1357-1362) on own status |
| DA-4 :755-770 | 1 | RS | EAD | same | CHANGED | EAD fixed once: OC, foreign template lines dropped, own-status drain |
| DA-5, DA-6 :799-806 | 1 each | RS | disabled cycle, re-enable (:777-797), EAD | same | CHANGED | through EAD |
| DA-11 :824-856 | 2 | RETRYING (:813-815, any job), RS | EAD; chats = [fresh] :844 | same | CHANGED | RETRYING per own id; OC at :844 |
| DA-11b :858-880 | 1 | RETRYING, RS | as DA-11, `EAD(.., 2)` | same | CHANGED | as DA-11 |
| PSD-1..6, 4b :1048-1101 | 2 | RS; RETRYING; DLQ_ONCE (:912-914) | PC `sent`, `lines` toEqual (:1053-1064, :1074-1085) | same | CHANGED (PSD-6 dead-letters it) | PC fixed once (OC, lines, own-status drain); RETRYING, DLQ_ONCE per own id |
| PSD-15 :1103-1127 | 1 | RS | ONE PC: `sent` [], own noop_expired, one own line | disable | CHANGED | through PC; "never sent" = no deliver() for the own id |
| DA-7 :1129-1169 | 2 | dlq map, any job (:1140-1142), RS | EAD; chats = [fresh] :1157 | same | CHANGED | dlq map per own id; OC at :1157 |
| DA-8 :1171-1202 | 1 | AGE_SQL rejected for any row (:1175-1178); `vi.fn(delivered)` | the cycle rejects (:1190); deliver never called (:1191); own claimed, attempts 0 | DELETE own row (:1198) | CHANGED, both orders | AGE_SQL rejected only for the own `created_at`; deliver checked for the own id; :1198 becomes NZ |
| L44-c2 age :1204-1224 | 1 | `vi.fn(delivered)` | own-status loop (:1212), own job by id | disable | unchanged | NZ cleanup |
| L44-c2 start :1226-1255 | 1 | same | same, start-rule range | disable | unchanged | NZ cleanup |
| PSD-8 v1, v2 :1257-1330 | 1 | own start read only (:1273); `vi.fn(delivered)` (:1265) | up to 20 cycles; v2 summed skips 1 (:1297, :1309); own lines, own deliver calls (:1311, :1314); own claimed (:1319-1321) | DELETE every claimed zalo_dm row (:1323-1325) | unchanged if realistic; a pass-stopping row: skips 2 or `!fullBatch` (:1302) | NZ by own id; `!fullBatch` error dropped; stub check (D5) |
| BS-5 :1517-1551 | 2 | `vi.fn(delivered)` | own audits; `cycleUntil` on own delivered (:1542) | disable | unchanged | none |
| PSD-14 :1586-1640 | 2 | RS | drain (:1590-1593); PC x2 on ALL `sent`, `lines`; `stub.calls.slice` (:1639) | disable | CHANGED if planted after the drain | no drain; OC and own lines |

No zalo_dm pass, own cleanup only: PSD-12 (:1494-1516) NZ on its pending row; PSD-13 (:1553-1584) deletes its never-claimed events (no audit row yet; delivery rows first) or acks them; BS-7 (:1468-1492) no edit. The order rules (:811-812, :916-920) go once the edits land. ZT runs no dispatch pass (D5 states its one ordering constraint).

## 5. Implementation steps

- W1: GitNexus `impact` on `ZALO_DM_ROUTABLE_EVENT_TYPES`, `ZALO_DM_EVENT_TYPES` and both `main` (stale index: add a `git grep -w` callers line); D1 (J, D:77-94, E:60-79), D6 (E:296-315, R:101-121), D9; typecheck, lint, format:check, T under the lock; commit.
- W2: D3-D5 per section 4 (T, ZT); each file twice in a row under the lock; commit. W3: D2 (after T:717) and D7 (beside T:50-70); commit.
- Orchestrator: D8, D10, section 7 in full, the PR (body modelled on PRs #124-#126: every default labelled, RO-L45-1 as a conductor ruling, both B3 counts, the lead corrections).

## 6. Acceptance matrix

Mutants are throwaway edits made after the cell is committed, run under the lock and reverted (`git checkout -- <file>`), never committed; R1b states how it applied the two M71 mutants.

| # | GOAL | Proof | Fails on |
|---|---|---|---|
| 1a | (1) one list | PSD-16: both exports equal the J key | a side with a different literal |
| 1b | (1) the live CHECK | PSD-16: one constraint row; the ARRAY literals' sorted set = the J key | a J key or a CHECK ARRAY that differs |
| 2a | (2) own ids | T, then ZT, twice in a row under the lock, green each time | a cell that depends on another cell's rows |
| 2b | (2) planted cross-claim | every pass cell of section 4 asserts the plant claimed and its own result unchanged | an own-scoped assertion reverted to its global form (e.g. EAD :734) |
| 2c | (2) PSD-8b | the second own row stays pending | `break` -> `continue` at D:378 |
| 2d | (2) PSD-8 stub check | one start-stub call for the own event and live token; skips 1 on that cycle | a stub answering every start read |
| 2e | (2) finished-delivery cell | forged statuses read `[]`; `claimed` reads one row | dropping M71:49 |
| 2f | (2) other-projector-token cell | the web_realtime token reads `[]` | dropping M71:48 |
| 3a | (3) clients inside `try` | D7 | the base (the uncaught dump) |
| 3b | (3) runbook | the runbook diff is ONE added line after :57 | any other runbook line changed |
| 4 | (4) comment | the queues.ts diff is comment-only and says true | a code line changed |
| 5 | (5) rows | the Q6 form; each probe absent at the base (measured), present at the head; one new row | a probe present at the base |
| 6 | (6) nothing else | `git diff --name-only <base>..HEAD` within FILE OWNERSHIP; no migration; B3 at the head | a file outside FILE OWNERSHIP |

## 7. Verification

- Through the lane's lock wrapper, each window announced: `pnpm --filter @plexco/bot exec vitest run src/projector-registry.test.ts` and `pnpm --filter @plexco/db exec vitest run src/zalo-dm-delivery.test.ts`, each twice in a row; then `pnpm --filter @plexco/bot test`.
- `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm review:check:changed` before every commit; the full `pnpm review:check` after the first; `pnpm build` once (outside the sandbox); `pnpm -w test` once at the final head (one rerun for an ACTIVE flake, Q7); the CI-only patterns C11/C12 (no RegExp built from data; each loop test at most about 3 s locally with its own explicit `30_000` budget); GitNexus `detect_changes` before every commit.
- Security: no round (the Q4 verdict; the CLI row's `change_class: security-posture` is served by the move itself and D7's no-secret assertions). VOID if the CLI change alters what a CLI prints about the connection string or touches the connector-secret path: then a security round is added and the reason stated.

## 8. Budget (B3)

Caps: 140 non-test, 420 test, 560 total lines (docs excluded), 11 files, 0 migrations; an overrun with a design reason is logged, not asked, up to 200 non-test / 600 test. Estimate: J 8-12 (the longer object wraps), D 10-20, E 15-25, R 5-10, queues.ts 2-4 (non-test about 40-70); T 210-330 (isolation and plant 120-180, PSD-8b 40-60, stub check 8-15, PSD-16 20-30, CLI cells 25-40), ZT 45-70 (test about 255-400); total about 295-470. Files: 10 (the 9 edited TARGET_FILES and this file); 0 migrations.

## 9. THREAT MODEL

Verbatim from the lane block: defends against (1) the two lists drifting from each other or from the CHECK (a routed type the CLI refuses, or a type the CLI accepts that 0056 forbids); (2) a test cell passing or failing because of another file's rows (a false green hides a regression of the stale stop; a false red costs a PR); (3) an invalid owner URL surfacing a connection string outside the redaction path, or leaving a client open; (4) a stale comment steering an operator to the wrong default. Not defended: an operator who pastes a secret into an issue; a test database shared with unrelated suites.

Measured at step 0 for (2): the foreign rows come from earlier cells of the SAME file (Q2); D3 and D4 defend against both sources. Map: (1) D1, D2; (2) D3-D5; (3) D6, D7; (4) D9.

## 10. Lead corrections (repeated in the PR body)

- (1): the dispatcher list is D:77-82 (lead about :72-77); E:60, E:66-71 and T:703 match.
- (2): the claim is D:345-348 and the stale-stop `break` D:378 (lead :331-336, :364); PSD-13 and PSD-14 are T:1553 and T:1586 (lead :1500, :1533). The cause is not a shared database but same-file leftovers in random v4 order (Q2; also backlog :7106). "c2 and c4" are two cells both titled `L44-c2`; no `c4` exists (Q3). PSD-12's pending row and DA-8's re-preparable event are leftovers the lead does not name.
- (3): E's `new pg.Client` is E:297 with `try` at E:298, and the `pg` require E:296 also precedes `try` (lead :260, :274); R matches. pg-connection-string masks only `err.input`; that the message carries no input is derived (D7 measures it).
- R0b1 section 6's "delete own rows, then own events": audited events cannot be deleted and a deleted row leaves its event re-preparable (Q2), so cleanup is NZ.
- The lane block's row lines (about :6731, :7075, :7089, :7147) are :6733, :7081, :7095, :7153 (Q6).

## 11. OPEN

None in scope. Out of scope and unchanged: the routing set (a type change is a migration), the 60-minute bound, `untilSessionStart` semantics, the dispatcher's cycle logic, every projector, the retry schedule, CLI behaviour beyond the client move, the runbook beyond one note, the other cycle-driving bot test files, PR #50.

- New out-of-scope row (D10): ten session.manage web routes read the actor from a second `currentSession()` call (at the base: `sessions/[id]/mark-paid/route.ts:32`, `payments/[allocationId]/reverse/route.ts:20`, `players/route.ts:27`, `players/[playerId]/route.ts:20`, `join-requests/[id]/approve/route.ts:26`, `reject/route.ts:25`, `join-requests/[id]/route.ts:30`, `sessions/[id]/join/route.ts:35`, `leave/route.ts:30`, `share-link/route.ts:25`; the six host routes use `context.personId`). Source: PR #126 body, section 9 (line 233; also section 6, line 214).
- Observations, no row (negative scope; in the PR body): an E parse failure also prints E's existing re-run hint, which does not apply to it; redact strips the exact URL, not pg-connection-string's `@___DUMMY___/` retry form (URLs with `@/` only), whose error carries no input (derived; D7 measures the texts).

## 12. Closure matrix (12 of 12)

| # | Gate | Evidence | Result |
|---|---|---|---|
| 1 | Authority snapshot pinned by SHA | `AUTHORITY_SHA` = the base = the worktree HEAD at step 0; every TARGET_FILES path exists (`git ls-files`, measured) | PASS |
| 2 | Decisions in scope final | DD-150 (section 1); RO-L45-1; D1-D10 pinned (section 3) | PASS |
| 3 | Scope IN/OUT and owner clear | lane block FILE OWNERSHIP and NEGATIVE SCOPE; sections 4, 5 and 11 | PASS |
| 4 | Dependencies classified | plan :92 `L45 <- L44`; L44 merged (PR #125, an ancestor of the base); the base is the PR #126 merge; no migration slot (lane block; plan :61) | PASS |
| 5 | Live schema and code match | section 2, each fact measured at the base; the live CHECK at 0073 (D2) | PASS |
| 6 | Data, API, state, auth contract | no migration, table, column, env var, dependency or new file; one additive JSON key; CLI output only loses the uncaught dump (D6) | PASS |
| 7 | Fail-closed, idempotency, order | the load checks throw (D1); `client?.end()` (D6); NZ cleanup (D3); the plant re-armed by id (D4) | PASS |
| 8 | Open questions in scope = 0 | D1-D10 pinned; section 11 holds only out-of-scope items | PASS |
| 9 | Acceptance matrix with expected results | section 6 | PASS |
| 10 | Migration, security, rollback | 0 migrations; no security round, with its void condition (section 7); rollback = revert of the lane's commits | PASS |
| 11 | First slice hard dependencies merged | L44 (#125) and L48 (#126) merged; base = origin/main | PASS |
| 12 | Implementation handoff ready | sections 3-7; the worktree exists, clean | PASS |

## 13. Verdict

```text
REVIEW_POLICY_VERSION: 1.3
REVIEW_VERDICT: CODE_READY
REVIEWED_AT: 2026-10-27
AUTHORITY_SHA: 8e918f0ec541ef4f72740be652a3a86584d381c3
BASE_BRANCH: main
TARGET_FILES:
  - apps/bot/src/dispatcher.ts (edited)
  - apps/bot/src/zalo-dm-delivery-age-bound.json (edited)
  - scripts/outbox-projector-enable.mjs (edited)
  - scripts/outbox-dlq-replay.mjs (edited)
  - apps/bot/src/queues.ts (edited)
  - apps/bot/src/projector-registry.test.ts (edited)
  - packages/db/src/zalo-dm-delivery.test.ts (edited)
  - docs/runbooks/outbox-dispatch-enable-rollback.md (edited)
  - docs/autopilot-backlog.md (edited)
  - packages/db/migrations/0056_outbox_projector_registry_dlq_replay.sql (read only: the CHECK :99-102, web_realtime :74 and :107-108)
  - packages/db/migrations/0071_zalo_dm_promotion_start_definer.sql (read only: the predicates :45-55)
  - packages/db/migrations/0022_job_claim_lease_core.sql (read only: the claim :369-377, the audit FK :135 and trigger :149-157)
  - apps/bot/vitest.config.ts (read only: fileParallelism true, sequence.concurrent false)
  - .env.example (read only: the schedule default :91)
  - infra/docker-compose.yml (read only: the schedule default :133)
  - docs/standards/kit-pack-membership.json (read only: both CLIs are members :172, :177)
  - docs/sessions/web-mvp-phase4-plan.md (read only: section 3 row L45 :61, dependencies :92)
SLICE: p4-zalo-dm-routable-list-and-cycle-tests
IN_SCOPE: the routableEventTypes key in apps/bot/src/zalo-dm-delivery-age-bound.json read by the dispatcher and the enable CLI with their own load checks and tied by PSD-16 to the live outbox_projector_routes_zalo_dm_chk; every zalo_dm dispatch-cycle cell of apps/bot/src/projector-registry.test.ts scoped to its own event ids, proven by the committed plant plantForeignZaloDmRow and two runs in a row; PSD-8b, the restored PSD-8 stub check and the two PSD-10c cells; both owner CLIs build the pg client inside try (client?.end in finally) with a no-DB invalid-URL test; one runbook note on percent-encoding; the queues.ts comment; the four backlog rows closed by hand and one new out-of-scope row
OUT_OF_SCOPE: the routing set (a type change is a migration); the 60-minute bound and untilSessionStart semantics; the dispatcher's cycle logic; every projector; the retry schedule; CLI behaviour beyond the client move (no new flag, no new output); the runbook beyond one note; the other cycle-driving bot test files; any new script file, migration or dependency; PR #50
G1_DECISION: PASS
G2_SPEC: PASS
G3_DEPENDENCY: PASS
G4_TEST: PASS
G5_SCOPE: PASS
G6_EXTERNAL: PASS
HARD_DEPENDENCIES: p4-zalo-dm-deadline-and-clock (L44) merged as PR #125 (merge d1154dbc5ad72ba084ff954f37876f2651970e7f, an ancestor of the base) and every earlier lane merged: the base commit is the merge of PR #126 (L48)
PRIOR_SLICES: L44 (PR #125); L34 (PR #111, the source of two rows); L24 (PR #102, the source of the CLI row); L37 (the source of the queues row)
OPEN_QUESTIONS_IN_SCOPE: 0
ENABLEMENT_ONLY_GATES: none
LIVE_REPO_VERIFICATION: PASS
CONTRACT_MATRIX: PASS
CLOSURE_MATRIX: PASS
ACCEPTANCE_MATRIX: PASS
SECURITY_AND_MIGRATION_GATE: PASS # no migration; no security round (the client move prints no byte of the connection string and touches no connector-secret path), void if the CLI change alters what a CLI prints about the connection string or touches the connector-secret path
IMPLEMENTATION_ARTIFACTS: PASS
FIRST_IMPLEMENTATION_STEP: W1 - GitNexus impact first (with a git grep -w callers line), then the routableEventTypes key read by apps/bot/src/dispatcher.ts and scripts/outbox-projector-enable.mjs with their load checks, the client move in both CLIs and the queues.ts comment; commit in the worktree
REMAINING_BLOCKERS: none
```
