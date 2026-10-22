<!-- review-readiness: code-ready -->

# Step-0 readiness: L18 p3-test-harness-job-definer-bootstrap-lock (session P3-S16c)

> Agent-facing. Step-0 readiness reviewers: opus/high (lane block L18 MODELS; reviewers 1-3, the order proof closed by the P3-S16c orchestrator); this file is
> written by the step-0 readiness-file writer (opus/high). Writers: opus/max (W1, W2). Code reviewer opus/max, at most 3 rounds; no security round (lane block
> judgement, void if the diff touches anything outside `packages/db/src/test-harness*.ts`, the backlog row's own scope and this file). RISK: P2 (test
> infrastructure used by every DB suite). Lane contract: lane block L18 of the conductor-authored P3-S16c brief (not on main). Base
> `e049c9269554d72c60b21b8c1ecc5329c5cbcf1d` (main, the merge of PR #97); branch `test/p3-job-definer-bootstrap-lock`; worktree
> `.autopilot/worktrees/p3-test-harness-job-definer-bootstrap-lock`, clean at step 0 (measured: HEAD = base, `status --porcelain` empty, no index.lock).
> Every `path:line` below is MEASURED at the base by the step-0 reviewers (their notes live outside the repo, `status/P3-S16c-notes`: `step0-handoff.md`,
> `RULING-RQ1-L18-colliding-writer.md`, `step0-order-proof.md`); "R1" / "R2" mark a reviewer-1 / reviewer-2 row that the later reviewer did not re-read.
> Static reading plus the saved CI log: no database was touched and no test was run at step 0.

## 1. Authority

- Owner decision 2026-10-22 (`OWNER-DECISIONS-2026-10-22.md` item 9, recorded by the owner's assistant, owner-confirmed in chat 10:47), verbatim: "Item 9 (lane
  L18): YES. Serialize bootstrapJobDefiner with an advisory lock (no extra retry); fixes the "tuple concurrently updated" race (test-harness.ts:232) that hit PR
  #85, #87 and main after #95."
- Lane block L18 (conductor-authored under item 9; P2; B3 pre-approved up to 200 lines in total, 3 files, 0 migrations): concurrent suites no longer collide inside
  `bootstrapJobDefiner`; its execution of `01-job-definer.sql` is serialized by ONE advisory lock taken on the caller's client before the SQL runs and released in
  a finally even when the SQL throws, with NO added retry loop, compatible with the existing lock order (proved at step 0). FILE OWNERSHIP:
  `packages/db/src/test-harness.ts`, `packages/db/src/test-harness.test.ts`, this file; no other file.
- Conductor ruling RO-L18-1 (2026-10-22, answers `RULING-RQ1-L18-colliding-writer.md`): a conductor ruling, NOT an owner approval; listed here and in the PR body
  as "default applied, pending owner sign-off". Option B: `withJobDefinerBootstrapLock` takes the migration runner's existing key "plxc" (0x706c7863) as a
  SESSION lock on the caller's client around the execution of 01-job-definer.sql, released in a finally even when the SQL throws, NO retry, NO new key. Binding
  conditions: (1) the full Q2 lock-order proof before any writer (section 3: PROOF_HOLDS); (2) a test pins the key against `migrate.ts`'s source (JDB-1); (3) the
  deterministic serialization test plus the repeated runs (JDB-2, JDB-4, section 7); (4) `bootstrapChatDefiner`, `bootstrapIdentityDefiner` and the
  `apps/bot/src/test-db.ts:25` copy stay untouched (D5); (5) a read-only check of the PR #85 / #87 CI logs is welcome in the PR body (O2); (6) the deviation
  below goes in the PR body and this file.
- **Deviation from lane block L18** (RO-L18-1 condition 6): the lane block asks for "a distinct constant key documented next to the other keys"; this lane uses
  the runner's existing key instead of a distinct key ("plxc", `packages/db/src/migrate.ts:31`). Reason: the measured colliding writer is `migrate(BASE!)`
  (section 2), which takes only "plxc"; a distinct key inside `bootstrapJobDefiner` would not serialize those two writers (option C of the ruling request,
  rejected: it would close the backlog row with the flake still live); the runner's key does, inside `test-harness.ts` and its test (no production file, no
  `migrate.test.ts` edit). The helper keeps the backlog probe name `withJobDefinerBootstrapLock`.
- Backlog row `db-test-job-definer-bootstrap-tuple-concurrently-updated-flake` (`docs/autopilot-backlog.md:6437-6449`; scope `[packages/db/src/test-harness.ts]`;
  merged_probe `packages/db/src/test-harness.ts :: withJobDefinerBootstrapLock`): the race failed CI on PR #85, PR #87 and main after #95
  (`status/conductor-scripts/clerk-flake-list.txt` entry 12), always one db test file at setup. NOT edited: the conductor's closeout flips it.
- Review per DD-122 D4 (Codex waived by the owner 2026-10-12): an independent Claude reviewer. No dependency (root slice on the base); L26 (P3-S16a) and L28
  (P3-S16b) run beside it with disjoint files; L24 and L27 start after it.

## 2. Measured at base

| Fact | Evidence (at the base) |
|---|---|
| Q1: 01 (181 lines) is ONE transaction, `BEGIN` `:22` ... `COMMIT` `:181` | `infra/postgres-init/01-job-definer.sql` |
| Unlocked prefix, no in-place catalog UPDATE: DO #1 `:29-36` `CREATE ROLE job_definer NOLOGIN ... BYPASSRLS ...` (`:31-32`), `EXCEPTION WHEN duplicate_object OR unique_violation THEN NULL` (an existing role raises before any write; a concurrent insert waits on the unique index, then unique_violation, swallowed); DO #2 `:42-54` read-only `SELECT ... INTO STRICT FROM pg_roles` drift check | 01 |
| DO #3 `:75-177`: `:124` `PERFORM pg_advisory_xact_lock(1784966251)` ("jdlk", xact, database-local per `:82-87`); `:127-133` `LOCK TABLE pg_auth_members IN SHARE UPDATE EXCLUSIVE MODE` (shared catalog: cluster-wide when superuser; a WARNING on insufficient_privilege); runtime-role refusals `:140-158`; `:159` `EXECUTE format('GRANT job_definer TO %I', v_grant_to)` | 01 |
| **The race**: `:179` `GRANT USAGE ON SCHEMA public TO job_definer;` is the ONLY in-place catalog UPDATE in 01: it rewrites the `pg_namespace` row of `public` in the CONNECTED database (the base, plexco_test in CI) even when the ACL is unchanged; it runs after `:124`, inside the transaction. 01 has NO `ALTER ROLE` and NO `ALTER DEFAULT PRIVILEGES` (grep: 0 hits; the "early ALTER ROLE" lead does not hold) | 01 |
| CI evidence: main CI run 39665900008 attempt 1, job 119450731475: the postgres service log shows `[837] ERROR: tuple concurrently updated` followed directly by `STATEMENT:` (the whole script) with NO `CONTEXT:` line, while every error raised inside a DO block prints `CONTEXT: PL/pgSQL function inline_code_block ...` (858 such lines), so the error came from a top-level statement; the only top-level catalog write in 01 is `:179` | saved log `status/P3-S16c-notes/ci-job-119450731475-full.log:14736` (outside the repo) |
| Two 01 runs cannot collide: `:124` takes jdlk unconditionally as DO #3's first statement and holds it to `COMMIT` `:181`, so `:179` is serialized for every run in one database; in different databases `:179` touches different rows and `:159` is serialized by SUE. A lock that serializes `bootstrapJobDefiner` only against itself changes nothing for this race | 01 |
| `bootstrapJobDefiner(client)` `:229-232` reads 01 and runs it with `client.query(sql)` with no lock of its own, then ROLLBACKs on error; siblings `bootstrapChatDefiner` `:262`, `bootstrapIdentityDefiner` `:285` have the same shape. GitNexus impact (upstream) resolves `Function:packages/db/src/test-harness.ts:bootstrapJobDefiner` (not the bot copy): risk MEDIUM, 4 direct, 55 at depth 2, 0 processes, 1 module | `packages/db/src/test-harness.ts` |
| **The colliding writer**: `migrate(BASE!)` is called six times (`:2735` `:2769` `:2850` `:2877` `:2904` `:2962`); the test at `:2952` ("names its own site on a pg_policies count failure") fails only AFTER `migrate.ts` has applied every pending migration (lock `:195`, apply loop, pg_policies probe `:376`); no harness lock around those calls (no `withJobDefiner*` or `withDefinerReadLock`, no BEGIN in `:2700-2975`): outside the jobd discipline | `packages/db/src/migrate.test.ts`, `packages/db/src/migrate.ts` |
| The migrations rewrite the same row: GRANT/REVOKE ... ON SCHEMA public at `0000:36`, `0022:495`/`:504`, `0023:134`/`:301`, `0030:346`/`:350`, `0031:318`/`:321`, `0032:80` | `packages/db/migrations` |
| Why CI-only: CI never migrates plexco_test (`.github/workflows/ci.yml:95-103` only bootstraps: `pnpm db:bootstrap` `:103`, then `pnpm -w test` `:106`), so in CI `:2962` applies every migration to plexco_test while other db files bootstrap; locally plexco_test is already migrated and the call applies nothing. Only packages/core and packages/db were testing at 19:58 (topological `pnpm -r run test`, `package.json:11`); no apps test calls `migrate(base)`; no test holds "plxc" itself | ci.yml, package.json, saved log |
| The runner's lock: private `ADVISORY_LOCK_KEY` "plxc" 0x706c7863 = 1886156899 `:31`; `SELECT pg_advisory_lock($1)` `:195` on migrate's private client (`:176`, first statement after connect `:178`); unlock `:390` in a finally (`.catch(() => {})`), then `client.end()` `:391`. No other plxc site: a grep for plxc, 0x706c7863, 1886156899 and ADVISORY_LOCK_KEY over packages, apps, infra and scripts hits only `migrate.ts:31`/`:195`/`:390` and the comments `test-harness.ts:446`, `:611`, `01:125`, `02:171`, `03:74` | `packages/db/src/migrate.ts` |
| Other writers of the base's `public` ACL row (proof 7(f)): `grep -i -E` for ON SCHEMA public, DROP OWNED, REASSIGN OWNED and ALTER SCHEMA public over packages/db/src, apps/bot/src, apps/web/lib, apps/web/app, scripts and infra: only `migrate.test.ts:349` (scratch DB plexco_migrate_gate, not base), `:1080` (the REVOKE inside `hideRealJobDefiner`, every caller `:1092` `:1106` `:1127` `:2388` `:3206` `:4149` inside `withJobDefinerBreakerLock(BASE!)` = jobd X, which already excludes every jobd-wrapped bootstrap in other db files) and `01:179` itself; `migrate(BASE!)` is the one writer outside the jobd discipline | grep at the base |
| Siblings: `02-chat-definer.sql` and `03-identity-definer.sql` have NO `GRANT USAGE ON SCHEMA` (grep: 0 hits): among the three scripts only `01:179` writes a database's `public` row; no race measured in 02 or 03 | `infra/postgres-init` |
| Q4: the harness's own test file exists (`git ls-files`); the suites that bootstrap concurrently in CI are the db files (about 50 through `setupRlsTestContext`, the `bootstrapJobDefinerForOwner` callers, `rls-invariants.test.ts`, `migrate.test.ts`; section 3.3) under `fileParallelism` true (`packages/db/vitest.config.ts:18`, about 2.6 workers on average in the saved log); web (7 harness files) and bot (2 harness files, 6 bot-copy files) run after the db suite | `packages/db/src/test-harness.test.ts`, section 3 |
| Hits re-measured: 1 of 3 (main after #95); PR #85 and #87 not re-read (O2) | `RULING-RQ1` finding 4 |

## 3. Lock map and order proof

### 3.1 Lock map (Q3: keys in use)

| Site | Key | Mode, level | Connection / database |
|---|---|---|---|
| `migrate.ts:31` const, `:195` acquire, `:390` release | plxc 0x706c7863 = 1886156899; single bigint (`pg_advisory_lock($1)`: one parameter resolves to the bigint overload, objsubid 1) | exclusive, blocking; session; unlock `.catch(() => {})` in a finally, then `client.end()` `:391` (a disconnect also releases) | migrate's private `new pg.Client({connectionString: migrationUrl})` `:176` = the database being migrated; first statement after connect `:178` (nothing held before it) |
| any other plxc site | none (grep, section 2) | - | - |
| `withAdvisoryLocks` `test-harness.ts:558-583` | per caller; single bigint | exclusive: `pg_advisory_lock` per key in array order; shared: `lockAllShared` `:585-600` (try all; on busy unlock_all, block shared on that key, unlock it, retry; never waits while holding); session | dedicated lockClient = Client(base) `:562`; release `pg_advisory_unlock_all` + end |
| `withJobDefinerLock` `:537`, `withJobDefinerBreakerLock` `:542`, `withDefinerReadLock` `:547` | jobd 0x6a6f6264 (R1 `:534`), chst 0x63687374 (R1 `:451`) | jobd S / jobd X / jobd S + chst S; session | `withAdvisoryLocks(base)` |
| `withChatDefinerLock` `:454`, `acquireChatDefinerLock` `:472` | chad 0x63686164 (`:446`), then chst | exclusive; session | lock client to base (R1 `:475`, unlock `:514`) |
| `withIdentityDefinerNameLock` `:613` | idnm 0x69646e6d (`:611`) | S or X; session; documented: taken BEFORE the chat/job locks | dedicated Client(base) (R1 `:619`) |
| role-password leaser | rlpw 0x726c7077, rlpr 0x726c7072 (R1 `:127-174`) | X / try-X / S; session | the leaser's own Client(base) (R1) |
| `01:124` / `01:129` | jdlk 1784966251 / `pg_auth_members` | X / SHARE UPDATE EXCLUSIVE (SUE); xact | caller's client; jdlk database-local, SUE cluster-wide (shared catalog) |
| `02:170` / `:175`, `03:73` / `:77` | cdlk 1667525739, idlk 1768189035 / `pg_auth_members` | X / SUE; xact | caller's client |
| migrations | `pg_advisory_xact_lock` only as PERFORM with parameter keys in function bodies (`0012:349`, `0017:351-352`, `0046:13`, `0060:137`/`:219`, `0061:200`/`:401`/`:437`, `0067:239`, `0068:144`); `0029:95` top-level `LOCK TABLE plans IN ACCESS EXCLUSIVE MODE` | xact, inside migrate's per-file BEGIN/COMMIT | no `LOCK TABLE pg_auth_members` and no harness key in any migration |

While holding plxc, `migrate()` (`migrate.ts:195-390`) runs only its own statements: CREATE TABLE IF NOT EXISTS schema_migrations, readdir, SELECT
schema_migrations, a pg_roles pre-check, `ensureRoleExists` (DO-block CREATE ROLE, autocommit), per file `BEGIN; <sql>; INSERT schema_migrations; COMMIT`
(incl. GRANT/REVOKE ON SCHEMA public and 0029's ACCESS EXCLUSIVE on plans), `count(*) FROM pg_policies`. Signature `migrate(migrationUrl: string)`: no callback;
it awaits only its own client and fs reads, so a plxc holder never waits client-side; its only waits are server-side lock waits of its own statements.

### 3.2 `migrate()` call sites (Q2)

| Site | Database | Caller holds |
|---|---|---|
| `migrate.test.ts:2735`, `:2769`, `:2877`, `:2904` | BASE (`DATABASE_URL_TEST`) | nothing (no `with*Lock`, no extra client, no BEGIN in `:2700-2975`); short plxc holds |
| `migrate.test.ts:2850` | BASE | `mockQuerySiteFailure("pg_advisory_lock", ...)` (`:2845`) spies `pg.Client.prototype.query` process-wide and fails the lock statement: plxc never acquired |
| `migrate.test.ts:2962` | BASE | nothing; applies every pending migration first (CI plexco_test is unmigrated): the LONG plxc@base hold |
| `migrate.test.ts:2825`, `:2459` | unreachable host, "" | never connects |
| `migrate.test.ts` `:135` `:160` `:183` `:209` `:216` `:233` `:245` `:258` `:278` `:344` `:355` `:426` `:1365` `:1389` `:2431` `:2934` `:4886`; `rls-invariants.test.ts` `:1839` `:1860` `:4225` `:4270` | per-test or scratch DBs | plxc in another database = a different lock tag (advisory locks are database-local) |
| `test-harness.ts:703` (setupRlsTestContext), `:745` remigrate, `:994` runMigration | per-file or per-owner DB | `:703` runs under `withDefinerReadLock(base)`, after `bootstrapJobDefiner` returned |
| `apps/web/app/api/auth/logout-all/route.test.ts:58`; apps/bot dispatcher `:91`, preflight `:77`, schedule `:97`, outbox-wake `:137`, projector-registry `:113`, projectors/zalo-dm `:203` | per-file DBs | not base |
| `migrate.ts:415` CLI | `DATABASE_URL_MIGRATION` | CI runs `pnpm db:bootstrap` (`ci.yml:103`) then `pnpm -w test` (`:106`); no migrate CLI step |

Every base-DB `migrate()` lives in `migrate.test.ts`, whose tests run sequentially (`fileParallelism` true at `packages/db/vitest.config.ts:18` parallelizes
files; `sequence.concurrent` false `:21`, R1), so they never overlap that file's own bootstraps, only OTHER db files' bootstraps.

### 3.3 `bootstrapJobDefiner` call sites (Q2)

"CDB" = a DROP/CREATE DATABASE ran on the same client just before the call; CREATE DATABASE cannot run inside a transaction block, so that client has no open
transaction and holds no lock. Every `migrate.test.ts` site shares the (sequential) file of every base `migrate()`, so none can wait behind `:2962`.

| Site | Client -> DB | On that client at the call | Caller holds elsewhere | Timeout |
|---|---|---|---|---|
| `test-harness.ts:702` setupRlsTestContext (about 50 db, 7 web, 2 bot files) | admin Client(base) `:690-693` | nothing (CDB `:694-695`) | jobd S + chst S (`withDefinerReadLock(base)` `:701`); then `migrate(per-file)` `:703` | db hooks 120 s; explicit 120_000 in bot public-sessions `:112`, web-realtime `:152`, web close/route-db `:36`, chat-stream-db `:59`, realtime-listener-db `:30` |
| `test-harness.ts:901` bootstrapJobDefinerForOwner | the context's admin Client(base) `:843` | nothing (GUC SET/RESET `:899`/`:903` only) | every caller wraps it: jobd S at identity-link-web-nobypass `:28`, me-player-reads-nobypass `:32`, public-alias-nobypass `:27`, `rls-invariants.test.ts:2120`, `tenant-capability-authority.test.ts:454`, `migrate.test.ts` `:712` `:764` `:788` `:928` `:1417` `:1475` `:1521` `:1566` `:1621` `:1833` `:2009` `:2046` `:2089` `:2223` `:2264` `:4337` `:4465` `:4677` `:4705` `:5102`; jobd X at `migrate.test.ts:1159`; no BEGIN in any 8-line window before | hooks 120 s; JCL-1 60 s; `tenant-capability-authority.test.ts:451` 120 s (L1) |
| `migrate.test.ts:95` beforeAll | file admin = connect(BASE!) `:91` | nothing: `healHiddenIdentityDefiner(admin)` `:93` (`:1220-1240`) runs autocommit SELECT / DROP ROLE / ALTER ROLE RENAME only | nothing (its idnm X -> chad X, only when parked, are released before `:93` returns) | 120_000 `:96` |
| `migrate.test.ts:387` | admin (BASE) | nothing (GUC only `:385`, R2) | chad X (`acquireChatDefinerLock(BASE!)` `:383`) | (R2) |
| `migrate.test.ts:1148` JCL-3 | ctx.superuser = the context's admin Client(base) (`test-harness.ts:990`) | nothing (first statement after setupNonSuperuserOwnerContext) | nothing (no wrapper) | not read |
| `migrate.test.ts:1760` / `:1952` / `:2142` | local admin Client(BASE!) `:1741` / `:1938` / `:2132` | nothing (CDB `:1748-1749` / `:1944-1945` / `:2138-2139`) | jobd S (`:1759` / `:1951` / `:2141`) | not read |
| `migrate.test.ts:3050` | connect(BASE!) `:3046` | nothing (GUC SET `:3049` only) | jobd X (`:3045`) | 30_000 `:3062` |
| `migrate.test.ts:3068` / `:3071` | local admin connect(BASE!) `:3066` | nothing (GUC SET `:3069` between) | jobd X (`:3065`) | not read |
| `migrate.test.ts:3092` / `:3095` | not printed | not printed | jobd X (`:3089`, R2) | never waits: 3.6 (b) |
| `migrate.test.ts:3134` | file admin (BASE) | nothing (no BEGIN in `:3128-3134`; CDB `:3136-3137` follows) | jobd X (`:3133`) | never waits: 3.6 (b) |
| `rls-invariants.test.ts:1838` TI-7 | describe admin connect(BASE) `:1593-1610` | nothing (CDB `:1827-1828`) | jobd S + chst S (`:1837`) | 120_000 `:1864` |
| `rls-invariants.test.ts:2003` PVC-6 | local admin Client(BASE) `:1979-1982` | nothing (CDB `:1989-1990`) | jobd S (`:2002`) | 120_000 `:2059` |
| `rls-invariants.test.ts:2121` JCL-1 | nsCtx admin(base) via `test-harness.ts:901` | nothing | jobd S (`:2120`); the chat bootstrap (internal chad hold) starts only after it returns | 60_000 `:2167` |
| `rls-invariants.test.ts:3357` CND-1/2/3 | local admin Client(BASE) `:3337-3339` | nothing (CDB `:3341-3342`) | jobd S (`:3356`) | 60_000 `:3403` |
| `rls-invariants.test.ts:4224` CND-7 / `:4269` UCC-6 | local admin Client(BASE) `:4214-4216` / `:4259-4261` | nothing (CDB `:4218-4219` / `:4263-4264`) | jobd S + chst S (`:4223` / `:4268`) | 60_000 `:4254` / `:4302` |
| `rls-invariants.test.ts:4397` UCC-2 | local admin Client(BASE) `:4385-4387` | nothing (CDB `:4389-4390`) | jobd S (`:4396`) | 60_000 `:4421` |
| `apps/bot/src/test-db.ts:25` own copy (6 bot files) | base (R1) | - | never takes plxc (untouched, D5) | bot 60 / 120 s |

### 3.4 Runs of 01 outside `bootstrapJobDefiner` (`git grep "01-job-definer"`, `git grep JOB_DEFINER_BOOTSTRAP_SQL_PATH`)

| Run | Where / holds | Can it wait on a plxc holder? |
|---|---|---|
| `apps/bot/src/test-db.ts:11`/`:18`/`:26` own copy (6 bot files) | base (R1); web/bot pnpm chunk only; no plxc | only server-side on jdlk(base)/SUE held by a running harness 01 (finite: that holder only runs SQL); never meets a base `migrate()` |
| `migrate.test.ts:3143-3153` racySql, clientA@BASE + clientB@scratch | inside jobd X (`:3133`) | no: under jobd X no plxc@base holder exists (3.6 (b)); takes no plxc |
| `migrate.test.ts:3211` setupClient@BASE; `:3215-3226` racySql clientA/B@BASE | inside jobd X (`:3206`) + `hideRealJobDefiner` | no (same) |
| `migrate.test.ts:4151-4152` scratchClient@BASE | inside jobd X (`:4149`) + `hideRealJobDefiner` | no (same) |
| `migrate.test.ts:3362-3373` catalog snapshot guards | read the SQL source (readFile `:3373`); execution not printed | lead only |
| `pnpm db:bootstrap` (`package.json:25`) | `ci.yml:103`, before `pnpm -w test` `:106` | no: serial, before every suite |

Non-executing references: `infra/docker-compose.yml:76`, `packages/db/README.md:339`/`:350`, `scripts/check-dev-login-exclusion.test.mjs:71`,
`migrate.test.ts:1076`, the 02/03 headers, `0022:8`. The race tests' timing assertions (elapsedMs > 3000, `migrate.test.ts:3158`, `:3232`) measure 01's own
LOCK TABLE serialization on direct `client.query` calls; the helper is not on those paths, so they keep their meaning.

### 3.5 Timeouts and liveness inputs

- `packages/db/vitest.config.ts:22-23` testTimeout 30_000, hookTimeout 120_000; `apps/bot/vitest.config.ts:8-9` 60_000 / 120_000; `apps/web/vitest.config.ts` sets neither (vitest defaults 5_000 / 10_000 unless a hook passes its own).
- No lock_timeout or statement_timeout on any client known to reach `bootstrapJobDefiner`; per-test SET LOCAL timeouts exist only on unrelated clients (`auth.test.ts:501`/`:545`/`:625`, `tenant-capability-authority.test.ts:407`/`:436`, `chat-edit-delete.test.ts:495`, `channel-identity-link-gate.test.ts:448`); `migrate.test.ts:4872` adds `lock_timeout=500ms` to a URL for `migrate()` `:4886` on the OWNER db, while `bootstrapJobDefinerForOwner` runs on base: no interaction (`:4860-4890` not read).
- CI order: `ci.yml:106` `pnpm -w test` = `... && pnpm -r run test` (`package.json:11`); @plexco/web and @plexco/bot depend on "@plexco/db": "workspace:*" (`apps/web/package.json:16`, `apps/bot/package.json:14`), so the db suite completes before web and bot start; web and bot may overlap each other, never the db suite. Saved CI log: core done 19:58:17.68, db done 19:59:57.17; web and bot never ran there (db failed).
- Longest plxc@base hold = `migrate.test.ts:2962`: hard bound <= 68.9 s (the whole file, 111 tests, 68928 ms in the saved log); estimate about 3.8 s per full migration under CI contention on average (db Duration 100.88 s, file durations summing to 257.71 s, about 2.6 workers: about 2 bootstraps can queue ahead).
- Closed by the orchestrator (measured at the base): L1 `tenant-capability-authority.test.ts:451` `it` closes at `:504` with `}, 120_000)`; L2 every explicit timeout within 8 lines of a db harness bootstrap is 120_000 or 180_000; L3 the `:2952` `it` (closes about `:2977`) passes no timeout, so the db default testTimeout 30_000 applies: in any green run each base `migrate()` hold is < 30 s.

### 3.6 Proof (step-0 reviewer 3, closed by the orchestrator; RO-L18-1 condition 1)

Global acquisition order: [idnm] -> {chad -> chst, or jobd S/X (+ chst S)} (harness session locks, each on its own lock client to base) -> **plxc@D on the caller's client** (NEW; D = base on every harness path) -> in-script jdlk/cdlk/idlk (xact) -> SUE(pg_auth_members) -> catalog rows. `migrate(D)`: plxc@D first -> its own DDL locks. No path takes a harness key while it holds plxc (a bootstrap window runs only 01's SQL; `migrate()` has no callback), and plxc windows never nest (a bootstrap window contains no `migrate()`; `migrate()` contains no bootstrap). Keys are distinct (Q3): plxc 1886156899 vs jobd/chst/chad/idnm/rlpw/rlpr vs jdlk 1784966251 / cdlk 1667525739 / idlk 1768189035, all single-bigint, so the helper's session lock and 01's in-script xact lock on the same session cannot collide.

- (a) Server-visible cycles. The only new wait edge is "caller session C waits for plxc@base". At every call C holds no lock and has no open transaction (3.3: 10 sites proven by CDB; the rest GUC-only, a fresh connect or the first statement; `:3092`/`:3095` not printed but they never wait, (b)). A waiter that holds nothing is a sink: no cycle passes through C. A plxc holder waits only server-side on jdlk/SUE/catalog rows held by running statements or open transactions, and never requests a harness key. Postgres would also detect any server-visible cycle (a deadlock error, not a hang).
- (b) Client-side cycles (invisible to Postgres) need a process blocked on plxc while another of its sessions sits idle in a transaction holding a lock a plxc holder needs, or a plxc holder that awaits a blocked process. Measured: at every call no other connection of the caller has an open transaction (per-test db clients are fresh, lock clients hold only session advisory locks, ns contexts are idle); a plxc holder awaits only its own client (helper window = lock -> 01 -> ROLLBACK on error -> unlock; `migrate()` has no callback). The jobd X sites (`migrate.test.ts:1160`, `:3050`, `:3068`, `:3071`, `:3092`, `:3095`, `:3134`) never wait: every bootstrap site in another db file is jobd-wrapped (S or X; GitNexus depth 1 = 4), web/bot run in a later pnpm chunk, and every base `migrate()` is in `migrate.test.ts` itself (sequential), so plxc@base is uncontended there. Lock clients holding jobd/chst/chad/idnm/rlpw/rlpr while their process waits on plxc cannot be waited on by a plxc holder (01 never requests a harness key). The bot copy and the direct 01 runs (3.4) never request plxc.
- (c) Re-entrancy. plxc has one other acquirer (`migrate.ts:195`, a private client never exposed), so no caller's client already holds it; session advisory locks are counted per session (a same-session second acquire succeeds at once; one unlock per lock); no site runs two bootstraps at once on one client (the allSettled races use direct `client.query`).
- (d) Liveness. Waits are finite: no cycle ((a), (b)), every holder finishes (one 01 run or one `migrate()`), the lock queue is FIFO. Only sites in other db files can wait behind the long hold (`:2962`): < 30 s in any green run (L3) plus queued 01 runs (well under 1 s each), below the tightest overlapping waiter (60 s `it` in `rls-invariants.test.ts`) and every hook (120 / 180 s; L1, L2). A hold long enough to time out a waiter would first fail the holder's own 30 s test (a red run for its own reason). Liveness HOLDS.
- (e) Writer conditions (binding): single-bigint form, taken before 01's BEGIN (autocommit); release in a finally AFTER the catch's ROLLBACK (an unlock inside an aborted transaction fails); rethrow the ORIGINAL error unchanged (`migrate.test.ts:3050` asserts code 42704 and the exact message, `:3071` `/runtime role/i`); an unlock failure must not mask that error; the spy caution (D7).
- (f) Residual (not an ordering issue): the bot copy runs 01 without plxc in the web/bot chunk, where no base `migrate()` runs (O1); the other direct writers of the base's `public` ACL row run inside jobd X (section 2); `migrate(BASE!)` is the one writer outside the jobd discipline, and plxc closes exactly that gap.

**VERDICT: PROOF_HOLDS** (`step0-order-proof.md`): no lock-order inversion, no self-deadlock and no client-side cycle at any call site; liveness holds; no counterexample.

## 4. Pinned defaults

Tier B per level3 §6.1 (lane block DEFAULTS: reversible); each is "default applied, pending owner sign-off" here and in the PR body.

- **D1** key = "plxc" 0x706c7863 (= 1886156899), the migration runner's own key (`packages/db/src/migrate.ts:31`, acquired `:195` with `SELECT pg_advisory_lock($1)`, released `:390`), per RO-L18-1 (a conductor ruling, not an owner approval; the deviation of section 1); default applied, pending owner sign-off.
- **D2** constant `MIGRATE_ADVISORY_LOCK_KEY` exported from `packages/db/src/test-harness.ts` next to the helper; its comment names `migrate.ts`'s `ADVISORY_LOCK_KEY` (`:31`) as the source; JDB-1 pins the two equal; default applied, pending owner sign-off.
- **D3** helper `export async function withJobDefinerBootstrapLock<T>(client: pg.Client, fn: () => Promise<T>): Promise<T>` (the backlog row's probe name, exactly): the runner's exact lock SQL (single-bigint form, `SELECT pg_advisory_lock($1)`) on the caller's client before `fn`; `SELECT pg_advisory_unlock($1)` in a finally; no retry; `fn`'s error is never replaced by an unlock error; an unlock error after a successful `fn` propagates; default applied, pending owner sign-off.
- **D4** `bootstrapJobDefiner` (`test-harness.ts:229-232`) reads the file outside the lock and runs the SQL plus its existing catch-ROLLBACK-rethrow inside `fn`, so the ROLLBACK precedes the unlock and the original error propagates unchanged (`migrate.test.ts:3050` and `:3071` assert it); default applied, pending owner sign-off.
- **D5** siblings `bootstrapChatDefiner` (`:262`) and `bootstrapIdentityDefiner` (`:285`) untouched: 02 and 03 have no `ON SCHEMA` grant and no race was measured there (RO-L18-1 condition 4 binds; the lane block's "same one-line change" option is not taken); the `apps/bot/src/test-db.ts:25` copy untouched (OUT_OF_SCOPE, O1: it runs only in the web/bot pnpm chunk, which never overlaps the db suite and has no base `migrate()`); default applied, pending owner sign-off.
- **D6** the tests live in a new describe of `packages/db/src/test-harness.test.ts` on a scratch database the describe creates and drops itself (never plexco, plexco_test or plexco_smoke); every client of a JDB test connects to that scratch database (advisory locks are database-local, 3.2); default applied, pending owner sign-off.
- **D7** a one-line comment at the helper: `migrate.test.ts:2789-2791` / `:2845` spy `pg.Client.prototype.query` on the text "pg_advisory_lock", which the helper's lock SQL contains (safe: no bootstrap runs inside those tests); default applied, pending owner sign-off.

## 5. Implementation steps

One file per writer, never two at once; each commits in the worktree, no push; GitNexus impact before each symbol edit, detect_changes before each commit;
`b3-measure.sh` after each writer.

- **W1** opus/max: `packages/db/src/test-harness.ts`: D2 (the constant), D3 (the helper), D4 (`bootstrapJobDefiner` `:229-232` runs its SQL and its
  catch-ROLLBACK-rethrow inside the helper; the file read stays outside), D7, and one comment beside the helper stating what races (`01:179` against
  `migrate(BASE!)`, section 2), why a lock and not a retry (owner item 9: no extra retry), why the runner's key (RO-L18-1) and the lock order (3.6), pointing at
  this file. Siblings untouched (D5). GitNexus impact on `bootstrapJobDefiner` first (MEDIUM: 4 direct, 55 at depth 2).
- **W2** opus/max: `packages/db/src/test-harness.test.ts`: one new describe with JDB-1..JDB-4 (section 6) on its own scratch database (D6); existing tests unchanged.

## 6. Acceptance matrix

| Row | Test | Expected | Authority |
|---|---|---|---|
| JDB-1 | key pin | the exported `MIGRATE_ADVISORY_LOCK_KEY` equals `ADVISORY_LOCK_KEY` parsed from `migrate.ts`'s source, and `migrate.ts` still acquires it with the single-argument `pg_advisory_lock($1)` | RO-L18-1 condition 2 |
| JDB-2 | deterministic serialization | client H holds plxc with the runner's SQL; client B's `bootstrapJobDefiner` is observed waiting in `pg_locks` (locktype advisory, classid 0, objid 1886156899, objsubid 1, granted false, pid = B's backend) and has not settled; H then commits a runner-like GRANT/REVOKE USAGE ON SCHEMA public to a scratch role and unlocks; B resolves and afterwards holds no advisory lock | condition 3 |
| JDB-3 | release after a throw | a bootstrap whose SQL throws deterministically rejects with the ORIGINAL error, leaves its client usable, and leaves plxc free: another client's `pg_try_advisory_lock` returns true | lane block GOAL (finally) |
| JDB-4 | two-client concurrency N=20 | 20 rounds of the bootstrap racing a runner-like writer holding plxc around a GRANT/REVOKE transaction: all fulfilled | condition 3, lane block TESTS |
| REG | regression | the existing harness tests green; no other suite's assertion changed; `migrate.test.ts:3050` and `:3071` green unchanged (original error); the race-test timing assertions `:3158`, `:3232` unchanged (direct `client.query`, 3.4) | NEGATIVE SCOPE |

## 7. Verification

Cite measured output through `| tail -40`. DB runs go through the session's lock wrapper (`locked-run.sh`, `status/.db-e2e.lock`), one at a time.

1. Focused: `NODE_ENV=test DATABASE_URL_TEST=... pnpm --filter @plexco/db exec vitest run src/test-harness.test.ts` (JDB-1..JDB-4) under the lock wrapper.
2. `NODE_ENV=test DATABASE_URL_TEST=... pnpm --filter @plexco/db test` under the lock, 3 times in a row, zero "tuple concurrently updated" in each log. Locally
   plexco_test is already migrated (section 2), so these runs prove no deadlock and no regression, not the race's absence; JDB-2 and JDB-4 prove the
   serialization; the PR CI run on an unmigrated plexco_test is the CI-shaped run.
3. `NODE_ENV=test pnpm --filter @plexco/web test` and `NODE_ENV=test pnpm --filter @plexco/bot test` (DB-bound files under the lock); once at the final head
   `NODE_ENV=test DATABASE_URL_TEST=... pnpm -w test` under the lock.
4. `pnpm typecheck`; `pnpm lint`; `pnpm format:check`; `pnpm review:check:changed` and `pnpm review:check`. `pnpm build` is not required (no production file);
   no Playwright run (no UI change).
5. GitNexus impact before editing a symbol; `detect_changes` before each commit; the risk goes in the PR body.
6. Known flakes: `status/conductor-scripts/clerk-flake-list.txt` (entry 12 is this race), one rerun, a second red is real; re-run the role-password step after a
   full run.
7. PR CI: check "verify" green, every other check pass or skipping ("OSV full dependency scan" ignored per S1).

## 8. Tool hazard

- Owner tool-hygiene rule (2026-10-16): no `bash -c`, `sh -c`, `zsh -c`, `python -c`, `node -e` or `perl -e`, no inline loops or awk programs: scripts from
  files under `status/P3-S16c-notes/scripts`; the Bash tool's shell is zsh. Step-0 reviewer 2 broke it once (one inline awk, disclosed in the proof notes).
- One shared local Postgres: never two DB suites, migrations or e2e runs at once; never `docker compose down -v`; the JDB tests create and drop only their own
  scratch database (D6).
- The spy at `migrate.test.ts:2789-2791` / `:2845` fails statements by the text "pg_advisory_lock" process-wide: the helper's lock SQL contains that text, its
  unlock SQL does not; no bootstrap runs inside those tests (D7).
- The Edit and Write tools turn a backslash-u escape into the raw character: this lane needs none (the key is the number literal 0x706c7863); never type one.

## 9. Budget (B3)

Lane cap, pre-approved: up to 200 lines in total (the harness counts as test-class), 3 files, 0 migrations. Estimate: `test-harness.ts` about +40,
`test-harness.test.ts` about +130, total about 170 of the 200-line cap (the two code files); 3 files of 3 counting this file; 0 migrations; module packages/db
only. No B3 exception needed. Measured with `b3-measure.sh` after every writer; a crossed cap is a ruling request before the next writer.

## 10. OPEN

None in scope (OPEN_QUESTIONS_IN_SCOPE: 0). OUT_OF_SCOPE residue:

- O1 the bot copy `apps/bot/src/test-db.ts:25` (6 bot files) runs 01 without plxc, only in the web/bot pnpm chunk, which never overlaps the db suite and has no
  base `migrate()`, so the measured `01:179`-against-migrate collision cannot occur there (proof 7(f)); untouched (D5, RO-L18-1 condition 4); the PR body says so.
- O2 ruling condition 5: the PR #85 / #87 CI logs were NOT checked at step 0; the orchestrator checks them later for the PR body, read-only (`gh pr view 85
  --json statusCheckRollup`, `gh pr view 87 --json statusCheckRollup`, then `gh run view <run-id> --log-failed | grep -c "tuple concurrently updated"`, sandbox
  off); if the logs are gone, the PR body says so.
- O3 the backlog row flips at the conductor's closeout through its probe; `docs/autopilot-backlog.md` is not edited by this lane.

## 11. Closure matrix (12 of 12)

| # | Gate | Evidence | Result |
|---|---|---|---|
| 1 | Authority snapshot pinned by SHA | `AUTHORITY_SHA` = the conductor-pinned base = the worktree HEAD at step 0 (`git rev-parse`, measured); every TARGET_FILES path exists (`git ls-files`, measured) | PASS |
| 2 | Decisions in scope final | owner item 9 (2026-10-22, verbatim in section 1); RO-L18-1 option B with its six conditions; D1-D7 pinned as defaults pending owner sign-off; the deviation stated | PASS |
| 3 | Scope IN/OUT and owner clear | lane block FILE OWNERSHIP (the two harness files and this file) and NEGATIVE SCOPE; section 5 edit sites; section 10 residue; L26 and L28 run beside it with disjoint files | PASS |
| 4 | Dependencies classified | root slice: no hard dependency; no migration slot; L24 and L27 start after it | PASS |
| 5 | Live schema and code match | sections 2 and 3, each row measured at the base | PASS |
| 6 | Data, API, state, auth contract | no production file, migration, bootstrap SQL or definer ACL change; the existing lock keys and order unchanged (one addition reusing the runner's key, D1); helper signature pinned (D3) | PASS |
| 7 | Fail-closed, idempotency, order | order proof PROOF_HOLDS (3.6); unlock in a finally after the ROLLBACK; the original error unchanged; no retry; release after a throw tested (JDB-3) | PASS |
| 8 | Open questions in scope = 0 | D1-D7 pinned; section 10 residue is out of scope | PASS |
| 9 | Acceptance matrix with expected results | section 6: JDB-1..JDB-4 and REG | PASS |
| 10 | Migration, security, rollback | 0 migrations; no security round (the lane block judgement with its void condition); rollback = revert of the two harness files before merge | PASS |
| 11 | First slice hard dependencies merged | none; base = origin/main at the merge of PR #97 | PASS |
| 12 | Implementation handoff ready | sections 4-9; the worktree exists at the base, clean | PASS |

## 12. Verdict

```text
REVIEW_POLICY_VERSION: 1.3
REVIEW_VERDICT: CODE_READY
REVIEWED_AT: 2026-10-22
AUTHORITY_SHA: e049c9269554d72c60b21b8c1ecc5329c5cbcf1d
BASE_BRANCH: main
TARGET_FILES:
  - packages/db/src/test-harness.ts
  - packages/db/src/test-harness.test.ts
  - packages/db/src/migrate.ts (read only: ADVISORY_LOCK_KEY :31, acquire :195, release :390; JDB-1 parses it)
  - packages/db/src/migrate.test.ts (read only: the colliding writer :2952-2962; the original-error asserts :3050, :3071; the spy :2789-2791, :2845)
  - packages/db/src/rls-invariants.test.ts (read only: bootstrap call sites, regression)
  - packages/db/vitest.config.ts (read only: fileParallelism :18, timeouts :22-23)
  - infra/postgres-init/01-job-definer.sql (read only: the race :179, jdlk :124)
  - infra/postgres-init/02-chat-definer.sql (read only: D5)
  - infra/postgres-init/03-identity-definer.sql (read only: D5)
  - apps/bot/src/test-db.ts (read only: the OUT_OF_SCOPE copy :25)
  - .github/workflows/ci.yml (read only: :95-106, why the race is CI-only)
  - docs/autopilot-backlog.md (read only: the row :6437-6449; not edited)
SLICE: p3-test-harness-job-definer-bootstrap-lock
IN_SCOPE: in packages/db/src/test-harness.ts one exported constant MIGRATE_ADVISORY_LOCK_KEY (= the runner's ADVISORY_LOCK_KEY "plxc", RO-L18-1) and one exported helper withJobDefinerBootstrapLock (the backlog probe name: a session advisory lock on the caller's client before fn, unlock in a finally, no retry, the original error kept); bootstrapJobDefiner runs 01-job-definer.sql and its existing catch-ROLLBACK-rethrow inside the helper; the documenting comments (what races, why a lock and not a retry, why the runner's key, the lock order, the spy caution); tests JDB-1..JDB-4 in a new describe of packages/db/src/test-harness.test.ts on a self-created scratch database; this readiness file
OUT_OF_SCOPE: any retry or backoff; any production file (packages/db/src/migrate.ts included), migration, bootstrap SQL (infra/postgres-init/*.sql) or definer ACL; packages/db/src/migrate.test.ts and every other suite's assertions; the keys and ordering of the existing locks (withJobDefinerLock, withJobDefinerBreakerLock, withDefinerReadLock, the chat and identity definer locks, the rlpw/rlpr leaser); bootstrapChatDefiner, bootstrapIdentityDefiner and the apps/bot/src/test-db.ts copy (D5); any timeout relaxation; docs/autopilot-backlog.md and docs/standards/decisions.md
G1_DECISION: PASS
G2_SPEC: PASS
G3_DEPENDENCY: PASS
G4_TEST: PASS
G5_SCOPE: PASS
G6_EXTERNAL: PASS
HARD_DEPENDENCIES: none
PRIOR_SLICES: none
OPEN_QUESTIONS_IN_SCOPE: 0
ENABLEMENT_ONLY_GATES: none
LIVE_REPO_VERIFICATION: PASS
CONTRACT_MATRIX: PASS
CLOSURE_MATRIX: PASS
ACCEPTANCE_MATRIX: PASS
SECURITY_AND_MIGRATION_GATE: PASS # no migration, no production file; no security round (lane block judgement, void if the diff touches anything outside packages/db/src/test-harness*.ts, the backlog row's own scope and this file)
IMPLEMENTATION_ARTIFACTS: PASS
FIRST_IMPLEMENTATION_STEP: W1 - in packages/db/src/test-harness.ts add the exported MIGRATE_ADVISORY_LOCK_KEY and withJobDefinerBootstrapLock beside bootstrapJobDefiner and run its SQL and catch-ROLLBACK-rethrow inside the helper (D2-D4, D7, the order comment), GitNexus impact first, commit in the worktree
REMAINING_BLOCKERS: none
```
