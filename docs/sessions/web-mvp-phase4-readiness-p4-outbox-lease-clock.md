<!-- review-readiness: code-ready -->

# Step-0 readiness: L46 p4-outbox-lease-clock (session P4-S5a)

> Agent-facing. Step-0 inputs: the orchestrator's own measurements (Q1 the lease stamps and compares, the Q2 precedent and the
> scratch-database catalog probe, the Q3 tail pins, Q6 the backlog row, Q7 the flake list) and one researcher, reader A (opus/high:
> QA1 the runner and the migration role, QA2 the harness, QA3 the pins of the old body, QA4 the test design, QA5 the dispatcher).
> This file was written by the step-0 readiness-file writer (opus/high). Writers: W2 opus/high (the lease-clock test, FIRST, D7), W1
> opus/high (the generator and the migration); the 14 pin lines and the backlog rows by the orchestrator with an apply script.
> Reviewers opus/max, one after another: R1a (the migration against 0022 and the live catalog), R1b (the tests, the pins, the rows) and
> the mandatory security reviewer SEC; at most 3 rounds counting pre-push rounds. RISK: P1 (a SECURITY DEFINER re-creation in the job
> family, role mechanics, one migration; security round required). Base `8e918f0ec541ef4f72740be652a3a86584d381c3` (main, the merge of
> PR #126; migration tail `0073_member_name_length_cap_120.sql`; open PRs: #50 only); branch `feat/p4-outbox-lease-clock`; worktree
> `.autopilot/worktrees/p4-outbox-lease-clock`, clean at step 0 (measured: HEAD = base, `status --porcelain` empty). Every `path:line`
> below was MEASURED at the base on the source text; the catalog rows were measured by the orchestrator on a lane scratch database
> migrated to 0073 on the compose cluster, with one catalog query, inside the lane's lock. The step-0 notes live outside the repo, so
> this file restates every fact it relies on. No tracked file was edited at step 0; no DB suite ran.

Short forms: `0022` = `packages/db/migrations/0022_job_claim_lease_core.sql`; `0023` = `packages/db/migrations/0023_outbox_ack_marker.sql`;
`0067` = `packages/db/migrations/0067_session_venue_visibility.sql`; "the function" = `claim_projector_delivery_batch(text, integer)`; a
bare `name.ts:line` is under `packages/db/src/`.

## 1. Authority

- **DD-150** (`docs/standards/decisions.md:121` summary row, `:1779` section): the owner's written approval of 2026-10-26, verbatim
  `Phase 4 plan approved, Q1-Q10 default` (the owner's own decision). It approves `docs/sessions/web-mvp-phase4-plan.md`, whose section 3
  row L46 (`:62`) is this lane: backlog row `projector-delivery-batch-lease-clock-consistency`; outcome: the delivery batch lease uses one
  consistent clock (the L24 review residual); acceptance: the lease does not expire early in a long transaction, a migration test, the
  dispatcher tests green; dependencies L45 and L41.
- **The migration number.** DD-150's row names migrations 0072 and 0073 only (`:121`). DD-151 (`docs/standards/decisions.md:120`,
  section `:1774`; the owner's decision of 2026-10-26) records that L42 took 0073 under the conductor's ruling D35 and that L46 takes the
  next free number at its start (expected 0074), DD-150's text staying as written. Measured at the base: the directory ends at
  `0073_member_name_length_cap_120.sql`, so this lane takes **0074**.
- **The contract implemented**: the backlog row `projector-delivery-batch-lease-clock-consistency` (`docs/autopilot-backlog.md:6972`
  heading, `:6974` `status: idea`, risk P1, `change_class: schema-migration`, `scope: []`, `merged_probe: null`; source: L24 readiness
  section 10 residual R3, PR #102 body line 81, "harmless today"). This lane implements it and changes no other contract.
- **RO-L46-1** ("decided by the conductor under the owner's delegation of 2026-10-22, not an owner signature"; Tier B, reversible): the
  lane block's design defaults are pre-approved Tier B (`clock_timestamp()` at the lease stamp, the compare side untouched, the shape and
  role mechanics of the closest recent precedent, the home of the new test); database and e2e commands are run by the orchestrator only;
  item 3: main can move while L45 is parked, so before the push the orchestrator runs `git fetch` and, if origin/main moved, merges it
  once more (`git merge --no-ff origin/main`) and re-runs what the merge touches; item 5: the 14 tail pins move to 0074; item 6: the
  security reviewer is mandatory.
- **Dependencies.** L41 merged: its `0072_member_name_definers_qualify_builtins.sql` is on the base (and L42's 0073). L45 is an ORDER
  dependency only: at step 0 it is parked; its branch touches `apps/bot/src/dispatcher.ts`, a `queues.ts`, a json file, its readiness file
  and two scripts: no migration and none of this lane's files; the only expected overlap is the END of `docs/autopilot-backlog.md`. Its
  non-merge is handled by RO-L46-1 item 3 (fetch and catch-up merge before the push), so no hard dependency is open.
- Provenance: every design choice below is "default applied, pending owner sign-off" (section 4) or the conductor's ruling above;
  nothing here is an owner signature.

## 2. Measured at base

### 2.1 Lease stamps and compares (Q1)

Command at the base: `git grep -n -E "lease_expires_at *=|lease_expires_at *(<|>)|claimed_at *=" -- packages/db/migrations`.

| site | what | clock | live |
|---|---|---|---|
| 0022:380 | the function's claim stamp: `SET status = 'claimed', claim_token = gen_random_uuid(), lease_expires_at = now() + interval '5 minutes'` | `now()` | **yes: the only live now() stamp** |
| 0023:194 | `claim_outbox_batch` (0023 DROP + CREATE at :137-138): `SET claimed_at = clock_timestamp(), lease_expires_at = clock_timestamp() + interval '5 minutes'` | `clock_timestamp()` | yes |
| 0010:30, 0022:234 | the old `claim_outbox_batch` bodies | `now()` | no: replaced by the 0023:137-138 DROP + CREATE |
| 0022:110 | a one-time backfill, `claimed_at + interval '5 minutes'` | none (data) | no: runs once |
| compares | 0022:203; :348 (the function's reclaim scan, `pd.lease_expires_at < clock_timestamp()`); :373 (its due scan, `pd.next_attempt_at <= clock_timestamp()`); :451, :461, :471 (`complete_projector_delivery`); 0023:155, :286; 0056:202; 0057:109; 0071:51 | `clock_timestamp()` everywhere | yes |

- `git grep -n claim_projector_delivery_batch -- packages/db/migrations` shows only 0022: the CREATE OR REPLACE at :322, the closing
  `$$;` at :397, the stamp at :380, the owner at :499 (`ALTER FUNCTION claim_projector_delivery_batch(text, integer) OWNER TO
  job_definer;`, inside the :495 `GRANT CREATE ON SCHEMA public TO job_definer;` and :504 `REVOKE CREATE ON SCHEMA public FROM
  job_definer;` bracket), `REVOKE ALL ... FROM PUBLIC` at :523 and `GRANT EXECUTE ... TO app_worker` at :529, inside `SET ROLE
  job_definer;` :520 and `RESET ROLE;` :532.
- Live-catalog confirmation (the scratch database at 0073): a scan of every live function body found exactly one body stamping
  `lease_expires_at` with now(), `claim_projector_delivery_batch(text,integer)`, and none stamping `claimed_at` with now(). No other
  writer needs the fix, so the lane block's STOP condition "another writer stamps with now()" does not fire.
- The defect: `now()` is the transaction start, so a claim made inside a transaction already open for t seconds stamps a lease t
  seconds short, while every compare reads the live clock. 0023:189-191 states the same class for the outbox twin: "a caller running
  claim_outbox_batch inside an explicit transaction open more than five minutes would otherwise receive an already-expired lease".

### 2.2 Role mechanics (Q2, QA1, QA2)

- Runner: `migrate.ts:11` "runs as the MIGRATION/owner role (DATABASE_URL_MIGRATION), never a runtime role"; `:12-14` "EACH FILE IN ONE
  TRANSACTION"; `:351-357` `BEGIN`, the file, the `schema_migrations` row, `COMMIT`; `:360` `ROLLBACK`. A failed GRANT or SET ROLE undoes
  the whole file and its ledger row; the file carries no BEGIN/COMMIT of its own. Checksum (reader A): `:296` sha256 of the file; a
  recorded name with another hash is a hard error (`:328`); the same hash is skipped (the re-run path).
- Roles (reader A): locally and in CI the migration user is `plexco`, a real superuser (`test-harness.ts:868-869`); production is managed
  Postgres without a superuser (`infra/postgres-init/01-job-definer.sql:96-100`); the bootstrap grants `job_definer` to CURRENT_USER
  (`01-job-definer.sql:77-78`, `:159`; `packages/db/README.md:359` "GRANT job_definer TO <migration_role>; -- CURRENT_USER at bootstrap
  time, in every environment"); `job_definer` is NOINHERIT (`01-job-definer.sql:31-32`) with USAGE only on public (`:179`). 0022:510-518
  calls a NOINHERIT migration role "a valid, more cautious production posture" and runs SET ROLE "regardless of inherit".
- Consequence: a CREATE OR REPLACE of a `job_definer`-owned function must run AS `job_definer` (the owner), and `job_definer` needs
  CREATE on public for that statement only.
- Precedent, the closest recent plain CREATE OR REPLACE of a `job_definer`-owned function: 0067:160-161 `GRANT CREATE ON SCHEMA public TO
  job_definer;` `SET ROLE job_definer;`; the CREATE OR REPLACE at 0067:201, with 0067:199-200 "CREATE OR REPLACE keeps the owner and the
  ACL but resets every omitted attribute, so all of them are restated"; the ACL restated at 0067:378-382; then 0067:384-385 `RESET ROLE;`
  `REVOKE CREATE ON SCHEMA public FROM job_definer;`. Older: 0023:134-135 and :300-301 (around a DROP + CREATE). Newest bracket of any
  kind: 0071:33-34 and :60-61 (a new CREATE FUNCTION). The same bracket already ran in production in 0022:495, 0023:134, 0067:160 and
  0071:33, so 0074 needs no new privilege and no role change.
- Harness (reader A; no harness change): `withJobDefinerLock` (`test-harness.ts:574-576`, the shared side of the "jobd" advisory lock)
  and `bootstrapAndMigrateAsOwner` (`:1047-1055`: the job_definer bootstrap and `runMigration()` under one `withJobDefinerLock` hold).
  BR-6 (`migrate.test.ts:743-761`) migrates under a NOINHERIT non-superuser owner (`setupNonSuperuserOwnerContext(..., { inherit: false
  })`), so it runs the 0074 bracket in that posture at no extra cost.
- Catalog before (section 10 has every row): owner `job_definer`; proacl `{job_definer=X/job_definer,app_worker=X/job_definer}`;
  `job_definer` has no CREATE on public; `job_definer` is NOLOGIN, not superuser, BYPASSRLS, NOINHERIT, and its one member is `plexco`
  (admin false, inherit true, set true); 27 functions are owned by `job_definer` (list and ACL md5 `6da0c2c3c079fea85f82b44c55d1fd46`);
  current_user after the probe `plexco`.

### 2.3 Tests and pins (Q3, QA3)

- No test pins this function's body, md5, prosrc or its now() stamp (reader A, QA3 (a)); `member-name-writer-guard.test.ts:176-182`
  loads every function's source for its name-writer scan, and 0074 adds no name write. So no body pin moves (GOAL (4)); threat (4) is
  checked by the generator equality, the reverse-edit catalog md5 and the independent diff (sections 3 and 9).
- The 14 tail pins at the base, each moving 74 -> 75 and 0073 -> 0074 (the count comments add the 0074 entry), nothing else on the line:
  - `migrate.test.ts:53` `const MIGRATION_COUNT = 74; // 0000..0073 (0073 member name length cap 120) ...` and `:755`
    `expect(res.applied[res.applied.length - 1]).toBe("0073_member_name_length_cap_120.sql");`;
  - `outbox-projector-registry.test.ts:119` `it("A1: 74 migrations apply with tail 0073 and re-run idempotently", ...`, `:120`
    `toBe(74)`, `:122` the tail, `:125` `expect(again.skipped.length).toBe(74);`;
  - `rls-invariants.test.ts:70` (`toBe(74)` and the count comment), `:73` (skipped), `:1841`, `:1846`, `:2122` (JCL-1's tail), `:4739`
    (the UCC-8 title), `:4741`, `:4742`.
- Owner and ACL pins that stay true (QA3 (b)): the `job_definer` function-owner lists `rls-invariants.test.ts:2131` and `:2606` (JCL-12
  at `:2593`), JCL-9 `:2364-2376` (app_worker has no direct SELECT on `projector_deliveries`) and `packages/db/README.md:113` INV-8:
  CREATE OR REPLACE keeps the owner and the ACL, and the restated ACL equals 0022:523/:529.
- Runtime exercisers expected green unchanged (QA3 (c)): `rls-invariants.test.ts` :2307, :2310, :2339, :2346, :2490, :2526, :2552,
  :2579; `outbox-projector-registry.test.ts` :100, :609, :617, :747, :778, :792; `outbox-projector-enable.test.ts:372`;
  `zalo-dm-delivery.test.ts:132`; the apps/bot `dispatcher.test.ts` :490, :513, :524 (and :560, :578, :610) and
  `projectors/zalo-dm.test.ts:32` (used at :321). Mocks and name lists (QA3 (d)): `dispatcher-outcome.test.ts` :204, :297;
  `dispatcher.test.ts` :341 (JRD-5), :814, :852; `rls-invariants.test.ts:2088`; `schema.ts:1587`; `packages/db/README.md:386-388`.
- Lease-versus-clock assertions exist only for `outbox_events` (OAM-12 `rls-invariants.test.ts:2961-3000`;
  `outbox-projector-enable.test.ts:346`). The projector tests only backdate (`now() - interval`) or assert NULL, so the stamp clock does
  not affect them.

### 2.4 Dispatcher (Q5, QA5)

`apps/bot/src/dispatcher.ts:345-348` is the only call: `pool.query<ClaimedProjectorDelivery>("SELECT * FROM
claim_projector_delivery_batch($1, 1)", [projector])`, one pool statement, so today now() is about clock_timestamp() and the defect is
latent. There is no client-side lease math (the non-test `lease` hits are comments or counters: `dispatcher.ts:189-190`, `:227-266`;
`projector-registry.ts:36`, `:59`); lease validity is checked in SQL by `complete_projector_delivery` (0022:451, :461, :471). The bot DB
tests migrate themselves and apps/ holds no tail pin (`git grep`: 0 hits). Bot change: none (D8).

### 2.5 Flakes (Q7)

The conductor's clerk flake list, active entries touching this area: "packages/db tests BR-3 and JCL-1", "the app_worker password
failure in apps/bot dispatcher.test.ts" and the apps/bot timing tests: one rerun each at the final head, as the lane block's TESTS
allow. The cluster-role entries are RETIRED: a red there is real.

### 2.6 Lead corrections

The conductor's leads were read at `db8230e762bd36d21599fe4bd7dbb4725dbc364a`; measured at the base:

- `outbox-projector-registry.test.ts` tail pins are at :119, :120, :122, :125, not :114, :115, :117, :120 (L48 added fixture lines).
- The 0022 block closes at :397 (`$$;`), not about :399. The SET ROLE of 0022's ACL step is :520 (RESET ROLE :532).
- The backlog row heading is `docs/autopilot-backlog.md:6972` (`:6973` title, `:6974` `status: idea`), not about :6970.
- The due scan is 0022:373; the function's two audit INSERTs are 0022:360-363 (reclaim) and :385-391 (claim).
- The 0023 note on why the stamp must read the live clock is 0023:186-192 (the aged-transaction sentence :189-191), the stamp :194.
- The next free test id is **JCL-15**: JCL-13/JCL-13b are reserved (`rls-invariants.test.ts:2085`) and JCL-14 is the 0022 contract's
  regression row (`docs/autopilot/contracts/autopilot-db-job-claim-lease-core.md:194`); `git grep -n -E 'JCL-1[5-9]|JCL-2[0-9]'` finds
  nothing at the base.
- 0067's ACL restatement is :378-382 (a comment and four statements; :382 is a view grant with no counterpart here).

## 3. Migration mechanics

- File: `packages/db/migrations/0074_projector_delivery_lease_clock.sql` (new; the next free number; a descriptive name with no decision
  number; append-only). Written ONLY by a generator script kept outside the repo (the L41 and L42 method; its output and equality proof go
  in the PR body); never edited by hand.
- Layout, in order:
  1. Header, comments only, ASCII only: the file name; lane L46, authority DD-150 and RO-L46-1, the backlog row; `-- WHAT:` the one
     stamp edit; `-- WHY (THREAT MODEL):` section 9 and 0023:186-194 (the stamp must read `clock_timestamp()`: "a caller running
     claim_outbox_batch inside an explicit transaction open more than five minutes would otherwise receive an already-expired lease");
     `-- NOT CHANGED:` every attribute, the owner, the ACL, the 5-minute length, the reclaim and due scans, and the two audit INSERTs,
     which keep the `job_audit_events` `created_at` column default (D5; the 0023:167-170 precedent is a backlog row, not changed here);
     `-- ROLLBACK:` a forward migration restating 0022:322-397.
  2. `GRANT CREATE ON SCHEMA public TO job_definer;`
  3. `SET ROLE job_definer;`
  4. 0022:322-397 byte for byte, with ONE edit on the 0022:380 line: `now() + interval '5 minutes'` -> `clock_timestamp() + interval
     '5 minutes'`.
  5. `REVOKE ALL ON FUNCTION claim_projector_delivery_batch(text, integer) FROM PUBLIC;` and `GRANT EXECUTE ON FUNCTION
     claim_projector_delivery_batch(text, integer) TO app_worker;` (0022:523 and :529 byte for byte, run as the owner as after 0022:520).
  6. `RESET ROLE;`
  7. `REVOKE CREATE ON SCHEMA public FROM job_definer;`
- Not in the file: BEGIN or COMMIT (the runner wraps each file, `migrate.ts:351-357`); `ALTER`, `OWNER`, `DROP`, `COMMENT ON`, `DEFAULT
  PRIVILEGES`; any other GRANT or REVOKE; any other function.
- Generator checks, each failing the run: the old text `now() + interval '5 minutes'` occurs exactly once in the 0022 block, on its line
  (the block's two other `now()` are in the comments at :344 and :366 and do not match); the new text occurs zero times in the old block
  and exactly once in the new one; line 1 of the block starts `CREATE OR REPLACE FUNCTION `; the `SECURITY DEFINER` and `SET search_path
  = public, pg_temp` lines are unchanged; no CR; authored lines ASCII only, non-ASCII only where inherited (the U+2014 dashes in the
  comments at 0022:335, :344, :366); each bracket statement exactly once and in the order above; the file ends with one newline.
- **Equality rule:** the new block with the edit reverted (new text back to old, on its line) equals 0022:322-397 byte for byte; the
  line count is the same (76); exactly one line differs (block line 59 = 0022:380).
- **Catalog equality** (after, on the scratch database): `md5(replace(prosrc, 'clock_timestamp() + interval ''5 minutes''', 'now() +
interval ''5 minutes'''))` equals the before `md5(prosrc)` `ddc6f09f0def69c98fbda444924ecfd3` (the new text occurs once in the body),
  so the live body equals the 0022 body except the edit.
- The CREATE is unqualified, as 0022's is; the probe's overload count (1) must stay 1 (no second function in another schema).
- Role mechanics: the temporary CREATE on public and the role switch both end inside the file; a migration role that lacks the
  membership or the schema grant fails loudly at the first statement it cannot run (the GRANT or `SET ROLE job_definer`) and the whole
  file rolls back (`migrate.ts:360`), never a partial apply.

## 4. Pinned defaults

Each is "default applied, pending owner sign-off" (Tier B, pre-approved by RO-L46-1 item 4), with its rejected alternatives.

- **D1 `clock_timestamp()` at the stamp.** It matches every compare (section 2.1) and 0023:194, so the lease is five real minutes from
  the claim. Rejected: `statement_timestamp()`, which still ignores time spent inside the statement; changing the compare side to now(),
  which would shorten every lease (and touches other functions: negative scope).
- **D2 the 0022 text verbatim, no attribute keyword added.** The catalog before shows VOLATILE (`v`), CALLED ON NULL INPUT (`proisstrict`
  false), PARALLEL UNSAFE (`u`), NOT LEAKPROOF, COST 100, ROWS 1000: the defaults CREATE OR REPLACE re-applies to an omitted clause, so
  the same text yields the same catalog. Rejected: stating them explicitly as 0067 did (0067:199-200, `VOLATILE` at :204), which changes
  bytes outside the one edit (the equality rule) without changing the catalog.
- **D3 the 0067 bracket, the ACL restated.** Rejected: no bracket, which fails for a NOINHERIT migration role (no SET ROLE, so not the
  owner) and without CREATE on public; `ALTER FUNCTION ... OWNER TO job_definer`, not needed since CREATE OR REPLACE keeps the owner
  (0067:199). The restated ACL is a catalog no-op (proacl before = after) and states the intended ACL next to the body, as 0067:378 does.
- **D4 the test home.** `rls-invariants.test.ts`, in the 0022 describe (`:2094`), one new `it` **JCL-15** placed after JCL-10
  (`:2474-2517`), modelled on OAM-12 (`:2961-3000`): a worker client (`ctx.workerPool.connect()`); `BEGIN`;
  `job_prepare_projector_delivery(ev, P)` for an event from `seedOutboxEvent(ctx.tenantA, ...)` (`:2095`) and a unique projector name P
  (both scans filter `pd.projector = p_projector`, 0022:348 and :372); `SELECT pg_sleep(2)`; `b = clock_timestamp()::text`; the claim
  (exactly one row for the event); `a = clock_timestamp()::text`; `COMMIT`; then, as `ctx.owner` (app_worker has no direct SELECT,
  JCL-9), `lease_expires_at BETWEEN b::timestamptz + interval '5 minutes' AND a::timestamptz + interval '5 minutes'` is true. The bounds
  are computed in SQL from the text values (microseconds kept), with no tolerance. Cleanup: `complete_projector_delivery` 'delivered'
  with the claim token, as JCL-10 does (`:2496-2499`); `ROLLBACK` on error, `release()` in finally. No jobd lock (as OAM-12 and JCL-10);
  no enable flag (the claim body never reads `outbox_projectors`; `enabled` is enforced only in the bot, `dispatcher.ts:338`). On the old
  body the lease is the BEGIN-time now() + 5 minutes, about 2 s below the lower bound: false (RED). Rejected: a new test file (the 0022
  describe holds the claim's contract; tests are a semantic map); a JS tolerance window (millisecond truncation plus a tolerance could
  let a short lease pass).
- **D5 the two audit INSERTs unchanged.** GOAL (1): every other byte unchanged. Their `created_at` keeps the `job_audit_events` column
  default (now()), while 0023:167-170 moved the outbox claim's audit rows to an explicit `clock_timestamp()` ("so an aged-transaction
  caller never gets a created_at timestamped before the outbox_events stamp it is auditing"). Recorded as ONE new out-of-scope backlog
  row, slug `projector-delivery-claim-audit-created-at-clock` (P2, `status: idea`; measured absent at the base). Rejected: changing them
  here (a second edit beyond the row's contract and the lane GOAL).
- **D6 merged_probe** `packages/db/migrations/0074_projector_delivery_lease_clock.sql :: claim_projector_delivery_batch`: the file is
  absent at the base and present at the head; the symbol is a bare identifier; the reconcile splits `<file> :: <symbol>`
  (`scripts/autopilot-backlog-reconcile:296`) and scans only planned, ready and blocked rows (`:289`), so the row is closed by hand.
  Rejected: a probe on 0022 (present at the base: a false merged).
- **D7 test-first order.** The test is committed and run RED (by the orchestrator) before the migration exists; then 0074 and the pin
  moves make it GREEN. This deviates from the run plan's W1-then-W2 order for evidence: the RED of the committed test needs the old
  definition live. Rejected: a planted old body or a scratch-only SQL RED (weaker: not the committed test).
- **D8 no README, bot or harness change.** `packages/db/README.md` states no lease clock (0 `clock_timestamp` hits; `:386-388` says
  "reclaim-then-claim, same pattern as outbox"); the bot needs nothing (section 2.4); the harness needs nothing (section 2.2).
- **D9 a body pin: JCL-15b.** Lead (6) of the lane block: the migration body pin follows the L42 RC-BODY pattern
  (`member-name-invisible-chars.test.ts:684-716`, RC-BODY-0073: each re-created body is its previous body with exactly the named
  edits, and the file holds exactly the named `CREATE OR REPLACE FUNCTION` lines) when no existing test pins this function's body, and
  none does (section 2.3). So one more `it`, **JCL-15b**, right after JCL-15 in the 0022 describe of `rls-invariants.test.ts`, asserts
  (i) without a database, on the file texts: the `claim_projector_delivery_batch` CREATE block of 0074 equals the 0022:322-397 block
  with exactly the one edit: the old stamp text `now() + interval '5 minutes'` occurs once in the 0022 block, the new stamp text
  `clock_timestamp() + interval '5 minutes'` occurs once in the 0074 block, the 0074 block with the new text put back to the old
  equals the 0022 block byte for byte (nothing else differs), and 0074 holds exactly one `CREATE OR REPLACE FUNCTION`; (ii) on the
  database: the live `prosrc` of `claim_projector_delivery_batch(text, integer)` equals the body of the 0074 block (the text between
  its two `$$`). A block runs from its `CREATE OR REPLACE FUNCTION claim_projector_delivery_batch(` line to the first `$$;` line after
  it (0022:322 and :397); the two once-checks keep the equality from passing on an empty or a wrong cut. Both halves read the files
  inside the `it`: 0074 is absent at step 2, and a read at module load would fail every test of the file. RED at step 2 (0074
  absent), GREEN from step 4 (section 5); about 40 test lines, inside the section 8 test cap (350). A later migration that re-creates
  the function moves this pin with it (GOAL (4)). Rejected: no pin (threat (4) names byte pins, and nothing else would catch a later
  in-place edit of 0074 on a fresh database: the generator and the scratch probe run once, in this lane, and the runner's checksum
  guard, `migrate.ts:328`, fires only where 0074 is already recorded); a hard-coded md5 constant (the 0022 file is the authority, not
  a measured number).

## 5. Implementation steps (commits in order)

1. This file, the branch's first content commit.
2. W2: JCL-15 (D4) and JCL-15b (D9) in `rls-invariants.test.ts`, one commit; the orchestrator runs the file under the lock: JCL-15 RED
   (the lease below the lower bound) and JCL-15b RED (0074 absent), every other test of the file green.
3. W1: the generator run and `0074_projector_delivery_lease_clock.sql` (section 3), one commit; the orchestrator measures the after rows
   and a re-run on the scratch database (section 10).
4. The orchestrator's apply script, one commit: the 14 pin lines (section 2.3); the backlog row closed BY HAND in the L44 form
   (`docs/autopilot-backlog.md:6986-7001`: `status: merged`, `merged:` naming the branch and the probe, `note_merged:`, `scope:` filled,
   `merged_probe:` D6; no PR number or SHA); the one new row D5 at the END. JCL-15 and JCL-15b GREEN from this commit on.
5. Checks (section 7); R1a, R1b and SEC one after another; RO-L46-1 item 3 before the push; the PR; CI.

## 6. Acceptance matrix

| # | GOAL | expected result | evidence |
|---|---|---|---|
| A1 | (1) one migration, one edit | 0074 is the only new migration; its block equals 0022:322-397 with the edit reverted; one line differs | the generator output; the independent plain diff; `git diff --name-only <base>...HEAD` |
| A2 | (1) attributes, owner, ACL, no privilege left | section 10: every row equal except `md5(prosrc)` and the stamp rows; the reverse-edit md5 equals the before md5; `job_definer` has no CREATE on public; current_user `plexco` | the scratch after probe |
| A3 | (1) re-run | a second migrate skips 0074 (same sha256, `migrate.ts:296`) and changes nothing | the re-run probe equals the after column; `rls-invariants.test.ts:73` and `outbox-projector-registry.test.ts:125` (skipped 75) |
| A4 | (2) PR body | the before/after table, the generator equality and an independent diff | the PR body |
| A5 | (3) the lease clock | JCL-15 RED at step 2, GREEN from step 4 | the locked runs (logs summarized in the PR body) |
| A6 | (3) existing suites | rls-invariants, outbox-projector-registry, outbox-projector-enable, zalo-dm-delivery, migrate (BR-6 under NOINHERIT) and the bot suite green | `pnpm --filter @plexco/db test`, the bot suite, `pnpm -w test` |
| A7 | (4) pins | the 14 lines read 75 and 0074; no body pin exists, so no other pin moves | a grep of the 14 lines; the diff |
| A8 | (5) backlog | the row closed by hand (probe absent at the base, present at the head); one new row; reconcile refused at most 2 (the baseline), malformed 0 | `scripts/autopilot-backlog-reconcile --check` |
| A9 | (6) nothing else | the diff names exactly the 6 files of section 8; no apps/ file | `git diff --name-only <base>...HEAD` |
| A10 | (4) the body pin | JCL-15b (D9): (i) the 0074 block equals the 0022:322-397 block with the one edit put back (the old stamp text once in the 0022 block, the new once in the 0074 block, one `CREATE OR REPLACE FUNCTION` in 0074); (ii) the live `prosrc` equals the 0074 block's body; RED at step 2 (0074 absent), GREEN from step 4 | the locked runs of `rls-invariants.test.ts` (logs summarized in the PR body) |

## 7. Verification

- The lane block's TESTS: the focused files first (`rls-invariants.test.ts`, `outbox-projector-registry.test.ts`, `migrate.test.ts`),
  then `pnpm --filter @plexco/db test` and the bot suite through the lane's locked-run wrapper (orchestrator only; plexco_test reset
  only through the sanctioned script when the checksum guard demands it, announced; 0074 moves the tail, so the first db run applies
  it); typecheck, lint, format:check, `pnpm review:check:changed` before every commit and the FULL `pnpm review:check`; `pnpm build`
  once; `pnpm -w test` once at the final head (one rerun for a flake on the active list, section 2.5); the CI-only patterns C11 and C12;
  GitNexus `impact` before editing any TypeScript symbol (expected: none; the test edits add an `it` and change literals) and
  `detect_changes` before every commit.
- The scratch catalog probe, the same query: before (done, section 10), after 0074, after a re-run of the migrations.
- RED and GREEN: JCL-15 at step 2 (RED) and from step 4 (GREEN).

## 8. Budget (B3 estimate)

Non-test about 120 lines (cap 260: the 76 block lines, about 30 header lines, 8 bracket lines); test about 80 (cap 350: JCL-15 about
50, the 14 pin lines); total about 200 (cap 610, docs excluded); files 6 including this file (cap 9): this file, 0074,
`migrate.test.ts`, `outbox-projector-registry.test.ts`, `rls-invariants.test.ts`, `docs/autopilot-backlog.md`; migrations 1 (cap 1).
Measured by the lane's B3 script at each commit; an overrun with a design reason is logged, not asked, up to 350 non-test and 500 test
(RO-L46-1 item 5).

## 9. Threat model

The lane block's THREAT MODEL, verbatim:

> THREAT MODEL (state it in the readiness file and the migration header): defends against (1) a re-creation that silently drops or changes an attribute of a SECURITY DEFINER worker function (owner, search_path, volatility, ACL); (2) a schema privilege (CREATE on public) or a role switch left in place after the migration; (3) a lease stamped short (an early reclaim lets a second worker claim a row still in flight: a duplicate delivery) or stamped long (a stuck row): the lease must be five real minutes from the claim; (4) body drift between the migration file, the byte pins and the live catalog; (5) a re-run on an already-migrated database failing or changing anything; (6) the migration role lacking the membership it needs (a failure that must be loud, never a partial apply). Not defended: a database superuser; clock skew between the database and the bot (the lease is a database-clock value end to end).

Where each defended item is checked:

- (1) An attribute, the owner or the ACL dropped or changed: the generator equality (section 3: the block with the edit reverted
  equals 0022:322-397 byte for byte; the `SECURITY DEFINER` and `SET search_path` lines unchanged) and JCL-15b (D9); the after column
  of section 10 (every attribute row, `owner` and `proacl` equal).
- (2) CREATE on public or the role switch left in place: the scratch catalog probe before, after 0074 and after the re-run (section
  10): `job_definer CREATE on public` stays `false` and `current_user after probe` is back to the migration role, `plexco`.
- (3) A lease stamped short or long: JCL-15 (D4), RED on the old body at step 2 and GREEN from step 4 (D7); its bounds are five real
  minutes from the claim, computed in SQL with no tolerance.
- (4) Body drift between the file, the pins and the catalog: JCL-15b (D9) on every run of the suite (0074 against 0022, the live
  `prosrc` against 0074); at the migration commit also the generator equality, the reverse-edit catalog md5 (section 3) and the
  independent diff (A1, A4).
- (5) A re-run failing or changing anything: the runner skips an applied file with the same sha256 (`migrate.ts:296`; A3), and a
  second direct run of the file on the scratch database by the orchestrator (CREATE OR REPLACE, the restated ACL and the bracket are
  idempotent) leaves the re-run probe equal to the after column (section 10).
- (6) The migration role lacking the membership: one transaction per file (`migrate.ts:12-14`, `:351-357`; ROLLBACK `:360`) and
  `SET ROLE job_definer` failing loudly, so the file and its ledger row roll back, never a partial apply (section 3); the bracket runs
  under a NOINHERIT non-superuser owner in BR-6 (`migrate.test.ts:743-761`).

## 10. Before/after attribute table

Before: measured by the orchestrator on a lane scratch database migrated to 0073, one catalog query, inside the lane's lock. After:
the expected value, measured by the orchestrator with the same query at the migration commit (section 5 step 3) and again after the
re-run (threat (5)). "equal" means byte-equal to the before value.

| key | before (measured at 0073) | after (expected; measured at the migration commit) |
|---|---|---|
| fn | `claim_projector_delivery_batch(text,integer)` | equal |
| prosecdef | `true` | equal |
| proconfig | `{"search_path=public, pg_temp"}` | equal |
| provolatile | `v` | equal |
| proisstrict | `false` | equal |
| proparallel | `u` | equal |
| proleakproof | `false` | equal |
| procost | `100` | equal |
| prorows | `1000` | equal |
| proretset | `true` | equal |
| prolang | `plpgsql` | equal |
| result | `TABLE(event_id uuid, tenant_id uuid, projector text, claim_token uuid, attempts integer)` | equal |
| args | `p_projector text, p_limit integer DEFAULT 100` | equal |
| owner | `job_definer` | equal |
| proacl | `{job_definer=X/job_definer,app_worker=X/job_definer}` | equal |
| md5(prosrc) | `ddc6f09f0def69c98fbda444924ecfd3` | changes; the reverse-edit md5 (section 3) equals the before value |
| stamp now() | `true` | `false` |
| stamp clock_timestamp() | `false` | `true` |
| overloads named claim_projector_delivery_batch | `1` | equal |
| schema public nspacl | `{pg_database_owner=UC/pg_database_owner,=U/pg_database_owner,job_definer=U/pg_database_owner,app=U/pg_database_owner,app_worker=U/pg_database_owner,readonly=U/pg_database_owner,chat_definer=U/pg_database_owner,identity_definer=U/pg_database_owner} owner pg_database_owner` | equal |
| job_definer CREATE on public | `false` | equal (`false`) |
| job_definer attrs | `false super false bypassrls true inherit false` | equal |
| job_definer members | `plexco:admin=false:inherit=true:set=true` | equal |
| job_definer member of | `-` | equal |
| live bodies stamping lease_expires_at with now() | `claim_projector_delivery_batch(text,integer)` | `-` (none) |
| live bodies stamping claimed_at with now() | `-` | equal |
| functions owned by job_definer | `27 md5 6da0c2c3c079fea85f82b44c55d1fd46` | equal |
| current_user after probe | `plexco` | equal (`plexco`) |

## 11. Open questions

In scope: none (`OPEN_QUESTIONS_IN_SCOPE: 0`). Out of scope, recorded (none changes this slice's behaviour or any step):

- The `created_at` of the function's two audit INSERTs (D5): kept at the `job_audit_events` column default; ONE new backlog row
  `projector-delivery-claim-audit-created-at-clock` (P2, `status: idea`), written at step 4.
- The 0022:366-367 comment ("clock_timestamp(), not now() ... this is a liveness/due check, not a value being stamped") is kept
  verbatim inside the copied block (the equality rule): it explains the due check, not the stamp; the 0074 header answers it with
  0023:189-194 (a stamp must read the live clock too).
- The production migration role's INHERIT setting is undocumented; it does not affect the SET ROLE bracket, which runs regardless of
  inherit (0022:510-518) and runs under NOINHERIT in BR-6 (`migrate.test.ts:743-761`).
- L45 is an order dependency only: before the push the orchestrator fetches and, if origin/main moved, merges it once more (RO-L46-1
  item 3).
- PR #50: untouched.

## 12. Closure matrix (12 of 12 PASS)

| # | Gate | Evidence | Result |
|---|---|---|---|
| 1 | Authority snapshot pinned by SHA | `AUTHORITY_SHA` = the worktree HEAD at step 0, the merge of PR #126 (measured); every TARGET_FILES path exists on disk (measured: the 20 inputs are tracked at that HEAD, `git ls-files --error-unmatch`; this file is written at step 0) | PASS |
| 2 | Decisions in scope final | DD-150 (the owner's approval of 2026-10-26) and DD-151 (the number 0074); RO-L46-1 (the conductor, Tier B); D1-D9 pinned as defaults pending owner sign-off (section 4) | PASS |
| 3 | Scope IN/OUT and owner clear | the lane block's FILE OWNERSHIP and NEGATIVE SCOPE; the 6 files of section 8; W2, W1 and the orchestrator's apply script each own one commit (section 5) | PASS |
| 4 | Dependencies classified | L41 merged (0072 on the base) and L42's 0073 on the base; L45 an order dependency only, parked (RO-L46-1 item 3); other Phase 4 lanes share only the END of the backlog | PASS |
| 5 | Live schema and code match | section 2 (the stamps and compares, the role mechanics, the pins, the dispatcher) measured at the base; section 10 measured on the live catalog at 0073 | PASS |
| 6 | Data, API, state, auth contract | the only behaviour change is the lease stamp clock (D1); no attribute, owner, ACL, table, column, role, grant or env change; the 5-minute length, both scans and the audit INSERTs unchanged (D5); no bot change (D8) | PASS |
| 7 | Fail-closed, idempotency, order | one transaction per file and a loud SET ROLE failure (threat (6)); a re-run skips the file or changes nothing (threat (5)); the compares already read `clock_timestamp()` (section 2.1); test-first order (D7) | PASS |
| 8 | Open questions in scope = 0 | section 11 | PASS |
| 9 | Acceptance matrix with expected results | section 6 (A1-A10) | PASS |
| 10 | Migration, security, rollback | exactly one append-only migration 0074 (DD-151); the security round is mandatory (SEC, RO-L46-1 item 6); rollback = a forward migration restating 0022:322-397 (section 3) | PASS |
| 11 | First slice hard dependencies merged | L41 merged (PR #119; its 0072 is on the base); L45 is an order dependency, not a hard one (section 1) | PASS |
| 12 | Implementation handoff ready | sections 3-8; the worktree at the base with this file as its first commit; W2 has every input for JCL-15 and JCL-15b (D4, D9), W1 for the generator and 0074 (section 3), the orchestrator for the pins and the rows (sections 2.3, 5) | PASS |

## 13. Verdict

```text
REVIEW_POLICY_VERSION: 1.3
REVIEW_VERDICT: CODE_READY
REVIEWED_AT: 2026-10-27
AUTHORITY_SHA: 8e918f0ec541ef4f72740be652a3a86584d381c3
BASE_BRANCH: main
TARGET_FILES:
  - packages/db/src/rls-invariants.test.ts (edited: JCL-15 and JCL-15b in the 0022 describe after JCL-10 :2474-2517; tail pins :70, :73, :1841, :1846, :2122, :4739, :4741, :4742 only)
  - packages/db/src/migrate.test.ts (edited: tail pins :53, :755 only; BR-6 :743-761 expected green)
  - packages/db/src/outbox-projector-registry.test.ts (edited: tail pins :119, :120, :122, :125 only)
  - docs/autopilot-backlog.md (edited: the row headed :6972 closed by hand in the L44 form :6986-7001; one new row D5 at the END)
  - packages/db/migrations/0022_job_claim_lease_core.sql (read only: the block :322-397 copied with the one edit at :380; the owner :495-504; :510-518; the ACL :520-532)
  - packages/db/migrations/0023_outbox_ack_marker.sql (read only: :134-138, :167-170, :186-194)
  - packages/db/migrations/0067_session_venue_visibility.sql (read only: :160-161, :199-204, :378-385)
  - packages/db/src/migrate.ts (read only: :11-14, :296, :328, :351-360)
  - packages/db/src/test-harness.ts (read only: :574-576, :868-869, :1047-1055)
  - packages/db/src/member-name-invisible-chars.test.ts (read only: RC-BODY-0073 :684-716, the D9 pattern)
  - packages/db/src/member-name-writer-guard.test.ts (read only: :176-182; expected green)
  - packages/db/src/outbox-projector-enable.test.ts (read only: :346, :372; expected green)
  - packages/db/src/zalo-dm-delivery.test.ts (read only: :132; expected green)
  - infra/postgres-init/01-job-definer.sql (read only: :31-32, :77-78, :96-100, :159, :179)
  - packages/db/README.md (read only: :113, :359, :386-388; D8)
  - apps/bot/src/dispatcher.ts (read only: :338, :345-348; D8)
  - docs/autopilot/contracts/autopilot-db-job-claim-lease-core.md (read only: :194)
  - scripts/autopilot-backlog-reconcile (read only: :289, :296)
  - docs/sessions/web-mvp-phase4-plan.md (read only: section 3 row L46 :62)
  - docs/standards/decisions.md (read only: DD-150 :121, :1779; DD-151 :120, :1774)
  - docs/sessions/web-mvp-phase4-readiness-p4-outbox-lease-clock.md (this file, the branch's first content commit)
SLICE: p4-outbox-lease-clock
IN_SCOPE: packages/db/migrations/0074_projector_delivery_lease_clock.sql (new) re-creating claim_projector_delivery_batch(text, integer) as 0022:322-397 with the one stamp edit to clock_timestamp() + interval '5 minutes' by the generator method, inside the 0067 bracket with the ACL restated, every attribute, the owner and the ACL unchanged; JCL-15 and JCL-15b in rls-invariants.test.ts; the 14 migration-tail pin lines; the backlog row closed by hand with merged_probe D6 and the one new row D5; this readiness file
OUT_OF_SCOPE: the 5-minute lease length; the retry schedule; the compare side, the reclaim and due scans; the created_at of the two audit INSERTs (D5, a backlog row); any other function's body (claim_outbox_batch, complete_projector_delivery, the registry); any ACL, owner, role, grant, table or column change; a new function, table, CHECK constraint or dependency; any apps/ file (the dispatcher and the projectors, D8); packages/db/README.md and the harness (D8); edits of migrations 0000-0073; enabling anything; PR #50
G1_DECISION: PASS
G2_SPEC: PASS
G3_DEPENDENCY: PASS
G4_TEST: PASS
G5_SCOPE: PASS
G6_EXTERNAL: PASS
HARD_DEPENDENCIES: p4-name-definers-and-rule-tests (L41) merged: PR #119, its 0072 is on the base; L45 is an order dependency only (RO-L46-1 item 3: fetch and catch-up merge before the push)
PRIOR_SLICES: L24 (merged, PR #102: the source of residual R3); L41 (merged: migration 0072, PR #119); L42 (merged: migration 0073, on the base)
OPEN_QUESTIONS_IN_SCOPE: 0
ENABLEMENT_ONLY_GATES: none
LIVE_REPO_VERIFICATION: PASS
CONTRACT_MATRIX: PASS
CLOSURE_MATRIX: PASS
ACCEPTANCE_MATRIX: PASS
SECURITY_AND_MIGRATION_GATE: PASS # one append-only migration 0074; security round mandatory (SEC, opus/max, RO-L46-1 item 6); rollback = a forward migration restating 0022:322-397
IMPLEMENTATION_ARTIFACTS: PASS
FIRST_IMPLEMENTATION_STEP: W2 - add JCL-15 (D4) and JCL-15b (D9) to the 0022 describe of rls-invariants.test.ts and commit in the worktree; the orchestrator then runs the file under the lock: JCL-15 RED (the lease below the lower bound), JCL-15b RED (0074 absent), every other test green
REMAINING_BLOCKERS: none
```
