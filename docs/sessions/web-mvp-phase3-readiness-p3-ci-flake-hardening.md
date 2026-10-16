<!-- review-readiness: code-ready -->

# Step-0 readiness: p3-ci-flake-hardening (Phase 3 lane L1)

> Agent-facing (English). Session P3-S1 step 0, written by the readiness reviewer (Opus 5.5 / max), not the writer.
> Authority: lane block L1 in `docs/autopilot-templates/web-mvp-phase3-2026-10-16-RUN.md` (the owner wrote "Phase 3
> plan approved" on 2026-10-16; L1 needs no owner decision), the DD-122 D4 review policy, and this verdict.
> Base: `origin/main` `c762c900e4ca55bc8ed2a84c0a86f7d0d7d7cf0a` (PR #58 merged).
> Long evidence, outside the repo: `Claude outputs/plexco-phase3/status/P3-S1-notes/p3-ci-flake-hardening-readiness.md`.
> Every item in section 3.3 is "default applied, pending owner sign-off": the PR body repeats them and L17 consolidates
> them into one decisions entry. This file does not edit `docs/standards/decisions.md`.

## 1. Verdict

```text
REVIEW_POLICY_VERSION: 1.3
REVIEW_VERDICT: CODE_READY
REVIEWED_AT: 2026-10-16
AUTHORITY_SHA: c762c900e4ca55bc8ed2a84c0a86f7d0d7d7cf0a
BASE_BRANCH: main
TARGET_FILES:
  - packages/db/src/test-harness.ts
  - packages/db/src/test-harness.test.ts
  - packages/db/src/tenant-capability-authority.test.ts
  - packages/db/src/rls-invariants.test.ts
  - packages/db/src/migrate.test.ts
  - packages/db/src/roster-service.test.ts
  - apps/bot/src/test-db.ts
  - apps/bot/src/test-harness.ts
  - apps/bot/src/dispatcher.test.ts
  - apps/bot/src/preflight.test.ts
  - apps/bot/src/schedule.test.ts
  - apps/web/e2e/pwa.spec.ts
  - apps/web/playwright.config.ts
  - apps/web/app/api/auth/logout-all/route.test.ts
SLICE: p3-ci-flake-hardening
IN_SCOPE: test code in the 14 TARGET_FILES only (the lane's 13 plus logout-all/route.test.ts per D-7): one shared, serialised runtime-role test password with last-participant restore of the pre-run role state (P1-P5); the definer advisory-lock convoy removed for every test migrate() in the db, bot and web suites (I1-I5); setupRlsTestContext teardown drops the database it created; the tenant-capability-authority 57P01 pool and bare ALTER ROLE; the roster-service unhandled rejection; the pwa.spec.ts:39 root cause; a one-off drop of the 93 leaked per-pid databases by the two exact patterns (D-4)
OUT_OF_SCOPE: production code; migrations; CI workflows; any timeout or retry increase and any move of a wait into a hook (D-5); docs (runbook, .env.example, compose comments, backlog, decisions.md, RUN doc); every file outside TARGET_FILES, including the guard tests of section 2.6, which stay green unedited; the databases plexco, plexco_test and plexco_smoke and every database not matching the D-4 patterns
G1_DECISION: PASS # lane block: no owner decision needed; owner approval 2026-10-16; DD-122 D4 review policy
G2_SPEC: PASS # test-infrastructure slice: equivalent technical authority = RUN doc L1 block + 4 backlog rows + the contract in section 3
G3_DEPENDENCY: PASS # root slice; harness, bot helpers, lock keys, pg-boss 10.4.2 and Postgres 16.15 exist at c762c90
G4_TEST: PASS # invariants P1-P5 and I1-I5 and acceptance rows A1-A18 pinned before code
G5_SCOPE: PASS # 14 exact files, 3 modules, 0 migrations, explicit B3 exception (section 4), negative scope above
G6_EXTERNAL: PASS # no PII, money, provider or legal surface; local-only test infrastructure
HARD_DEPENDENCIES: none (root slice)
PRIOR_SLICES: none
OPEN_QUESTIONS_IN_SCOPE: 0 # every gap pinned as D-1..D-10
ENABLEMENT_ONLY_GATES: none
LIVE_REPO_VERIFICATION: PASS # section 2, corrections C1-C8
CONTRACT_MATRIX: PASS # section 3
CLOSURE_MATRIX: PASS # 12/12, section 6
ACCEPTANCE_MATRIX: PASS # section 5
SECURITY_AND_MIGRATION_GATE: PASS # no migration, no production code, no new credential, verifiers never logged (D-2)
IMPLEMENTATION_ARTIFACTS: PASS # DD-122 D4: no scope-gate lifecycle; RUN doc lane block + this file + the worktree at the exact base
FIRST_IMPLEMENTATION_STEP: in .autopilot/worktrees/p3-ci-flake-hardening (base c762c90 plus this readiness commit), take the DB/e2e lock and record the D-8 baseline (password probe, definer membership, per-pid count, one parallel db+bot+web run classified by cause, the pwa spec with traces), leave the cluster as found and release the lock; then write failing-first tests for P1-P5 and I1-I3 in packages/db/src/test-harness.test.ts before changing packages/db/src/test-harness.ts
REMAINING_BLOCKERS: none
```

## 2. Measured at base (c762c90)

### 2.1 Snapshot

- Worktree HEAD = `origin/main` = `c762c900e4ca55bc8ed2a84c0a86f7d0d7d7cf0a`, clean, no `index.lock`. The 14 target files
  and the runbook are byte-identical to `3546f6b` (empty diff), so the lane's line numbers hold. `pnpm review:check` PASS.

### 2.2 Cluster (read-only)

- PostgreSQL 16.15, `max_connections` 100, SCRAM. pg_hba: TCP from the host = scram-sha-256, loopback inside the container
  = trust, so container psql cannot test a password: probe over TCP from the host (node + pg).
- `app`, `app_worker`, `readonly`: LOGIN with a SCRAM verifier. Accepted now: `plexco_dev_app`, `plexco_dev_worker`,
  `plexco_dev_readonly` (runbook section 5); every test password returns 28P01.
- `job_definer`, `chat_definer`, `identity_definer`: exactly one member each, `plexco`. No scratch roles left over.
- 124 databases. Per-pid: 93 = 65 `plexco_guest_note_routes_<pid>` + 28 `plexco_close_route_db_<pid>`; 0
  `plexco_dev_login_<pid>`. 25 fixed-name test databases (24 harness, 1 logout-all) are reused, not growing.

### 2.3 Runtime-role password writers

- `ROLE_PW` `packages/db/src/test-harness.ts:88-92` (app `plexco_test_app`, app_worker `plexco_test_worker`, readonly
  `plexco_test_readonly`), written by `setRolePasswordRaceSafe` `:522-542` (ALTER at `:530`, retry on "tuple concurrently
  updated" up to 10 times) from `:571`, `:597`, `:829`, `:840`.
- Bot: `APP_WORKER_PASSWORD = "plexco_test_worker_jrd"` at `dispatcher.test.ts:25`, `preflight.test.ts:24`,
  `schedule.test.ts:35`, written by `apps/bot/src/test-db.ts:46-62` (ALTER at `:52`).
- No retry at all: `migrate.test.ts:940`, `:4369`, `:4497`, `tenant-capability-authority.test.ts:461`,
  `logout-all/route.test.ts:58`. Inline retry copies: `migrate.test.ts:1778`, `:1987`, `:4831`.
- No ALTER ROLE in migrations, bootstrap SQL or production code. `migrate.ts:154-166` creates the roles LOGIN without a
  password (the CI pre-run state). CI runs db first, then bot and web together (`pnpm -r`), so web's setupRlsTestContext
  resets app_worker under the bot (PR #56 CI: 2 of 4 runs red).

### 2.4 Definer locks and the convoy

- Keys: chad `0x63686164` (`test-harness.ts:327`), jobd `0x6a6f6264` (`:413`, same value in `apps/bot/src/test-db.ts:22`),
  idnm `0x69646e6d` (`:451`, the only key with a shared mode).
- `setupRlsTestContext` `:584-589` holds jobd while it waits for chad, across bootstrap and a full 56-file migrate.
  `acquireChatDefinerLock` is held from `bootstrapChatDefinerForOwner` (`:800`) until teardown (`:929-931`), i.e. for a
  whole non-superuser test. `migrate.test.ts:1366-1371` records the measured effect: JCL-4 starved in three full runs.
- Every full migrate of every suite serialises on jobd. Per parallel run: about 36 bot setups (dispatcher 19, preflight
  10, schedule 7), 26 setupRlsTestContext calls (23 db, 3 web), 31 non-superuser contexts in `migrate.test.ts`.
- Bot setups take jobd only (`dispatcher.test.ts:87-90`, `preflight.test.ts:84-87`, `schedule.test.ts:94-97`), not chad
  or idnm, although migrate() reaches 0030 and 0054. `logout-all/route.test.ts:56` migrates with no lock and no
  bootstrap. `migrate.test.ts` commits breaker windows on all three definers (e.g. `:1063-1080`, `:1183-1189`,
  `:3355-3373`; `GRANT <definer> TO app_worker` at `:1159`, `:3120`, `:3772`).

### 2.5 The named flakes

- JCL-4 `rls-invariants.test.ts:2062` (lock `:2072`) and JCL-12 `:2483` (lock `:2488`): 30 s default; wait on jobd (2.4).
- BR-5 `migrate.test.ts:678-737` (lock `:707`): 60 s; jobd plus a file-by-file replay of 0000-0021.
- JSO-2 `preflight.test.ts:209`, JSO-5 `schedule.test.ts:291`: 60 s with setup inside the test (`withTestContext`), so the
  jobd wait and a full migrate count against it; both connect as app_worker with the `_jrd` password. JSO-5 sleeps a fixed
  2.5 s (`:308`) before asserting `cron_on`; pg-boss 10.4.2 sets it via `setImmediate(onCron)` right after start.
- `roster-service.test.ts:229`: not a timeout. The command promise is created at `:237`, `before` is awaited at `:240`,
  the rejection handler attaches at `:241`: a fast SESSION_NOT_OPEN rejection is reported as unhandled.
- 57P01: `tenant-capability-authority.test.ts:466` unguarded `pg.Pool`, `:508` `end()`, `:509` teardown FORCE drop
  (mechanism documented at `test-harness.ts:9-21`).
- `pwa.spec.ts:39-66`: candidate cause, unproven: `apps/web/components/pwa/offline-view.tsx:52-55` adds the "online"
  listener in `useEffect` (after hydration) while the spec goes online at `:63` right after the SSR heading at `:61`.
- Leak: `setupRlsTestContext` teardown (`:633-640`) never drops its database; the two web route-db suites name theirs
  per pid (`session-guest-note-route-db.test.ts:37`, `sessions/[id]/close/route-db.test.ts:29`).

### 2.6 Constraints from files outside TARGET_FILES (stay green and unedited)

- `apps/bot/src/test-db.test.ts`: `bootstrapJobDefiner`, `withJobDefinerLock`, `setAppWorkerPasswordRaceSafe`, `testUrl`
  stay function declarations in `test-db.ts` and nowhere else in `apps/bot/src` (they may delegate, not become
  re-exports); `0x6a6f6264` appears only in `test-db.ts`; its `JOB_DEFINER_LOCK_KEY` equals the
  `JOB_DEFINER_LOCK_KEY = 0x...` text in `packages/db/src/test-harness.ts`.
- `apps/bot/src/test-harness.test.ts` (withTestContext lifecycle), `packages/db/src/tx-alias.test.ts`,
  `packages/db/src/tenant.test.ts:192-214` (no `tenantRepo(` in non-test modules, which includes both harness files).
- Out-of-scope callers keep working unchanged: setupRlsTestContext (26 sites), setupNonSuperuserOwnerContext +
  connectAsApp + withJobDefinerLock (`identity-link-web-nobypass.test.ts`), withIdentityDefinerNameLock
  (`identity-link-web.test.ts`). Harness files have no production importer (`@plexco/db` exports only `.` and `./schema`).

### 2.7 Inventory and tooling

- Collected tests (collection only, nothing run): db 1187 (rls-invariants 128, migrate 111, tenant-capability-authority
  26, roster-service 23, test-harness 6), bot 129, web 1677 (logout-all 8), Playwright 200 (pwa.spec.ts 5).
- vitest 4.1.11, pg-boss 10.4.2, @playwright/test 1.63.0, Node 25.6.0 locally (CI Node 22), 8 CPUs.
- GitNexus index is stale (dd5375f): withJobDefinerLock HIGH, setupRlsTestContext MEDIUM. Use the grep counts above as
  the fallback and state them in the PR body.

### 2.8 Corrections to the lane block

- C1 "migrate.test.ts:1372 BR-5": BR-5 is `:678-737`; `:1372` is the 0054 step-1 identity+chat window (describe
  `:1239`), the documented JCL-4 starver. Both are in scope.
- C2 "roster-service timeouts": an unhandled rejection, not a timeout (2.5).
- C3 "teardown around :866-897" is setupNonSuperuserOwnerContext's (`:869-934`); the leak is setupRlsTestContext's.
- C4 setAppWorkerPasswordRaceSafe spans `test-db.ts:46-62`. C5 leaked per-pid databases: 93, not about 85.
- C6 password writers the lane does not name: six `migrate.test.ts` sites and `logout-all/route.test.ts:58`.
- C7 bot setups lack the chat/identity protection. C8 `logout-all/route.test.ts` migrates with no lock (D-7).

## 3. Pinned contract

### 3.1 Passwords (lane TESTS: shared password, restored at teardown)

- P1 One authority: `ROLE_PW` in `packages/db/src/test-harness.ts` is the only place the three test passwords are spelled;
  every other test file imports it. `git grep -n plexco_test_worker_jrd` returns nothing.
- P2 Serialised: every `ALTER ROLE app|app_worker|readonly ... PASSWORD` in test code runs inside one cluster-wide critical
  section, so "tuple concurrently updated" cannot occur between participants; no retry loop for it remains.
- P3 Restored: after the last participant ends, each role's password state and `rolcanlogin` equal the pre-run state (D-2).
- P4 No mid-run change: no participant changes a runtime-role password while another may still connect with a test
  password. A per-file afterAll restore is that failure mode (reverted before, `preflight.test.ts:25-38`).
- P5 Loud failure: a failed snapshot, restore or lock acquisition fails the run with the original error; nothing is
  swallowed except the existing 57P01-during-own-teardown guard.

### 3.2 Locks (lane TESTS: JCL-4, JCL-12, BR-5, JSO-2, JSO-5 fixed at the cause)

- I1 Every breaker window (rename, drop, attribute drift, membership hand-off, `GRANT <definer> TO app_worker`) still
  excludes every concurrent reader of that role, across processes.
- I2 Readers (bootstrap + migrate; JCL-1/4/12-style name reads; JRD-11-style minimal-access assertions) never wait on
  other readers.
- I3 No hold-and-wait lets one test's body extend another lock's hold (the jobd-then-chad nest of 2.4 goes, or can no
  longer extend jobd).
- I4 Every test migrate() (bot setups, logout-all) gets the protection setupRlsTestContext gets for each definer its
  migrations reach (0022 job, 0030 chat, 0054 identity).
- I5 Signatures and guarantees for the out-of-scope callers of 2.6 stay as they are.

### 3.3 Defaults (each: default applied, pending owner sign-off)

- D-1 Values: keep the `ROLE_PW` values; retire `plexco_test_worker_jrd`. Only the bot (3 lines) differs today, while
  `plexco_test_app` is spelled on 18 lines in 4 files (comments excepted, A2 counts code literals only).
- D-2 Restore semantics: the pre-run state is the `pg_authid` password (verifier or NULL) and `rolcanlogin` of each role,
  captured before the first participant of an overlapping set writes a test password. A role absent at capture ends with
  no password and is never dropped. A
  run killed mid-way must leave the next complete run able to restore the original state (a test value never overwrites
  the snapshot). The snapshot is never logged, never inside the repo, never in plexco, plexco_test, plexco_smoke or
  postgres; a file store is mode 0600 outside the repo. The mechanism is the writer's.
- D-3 One parallel run = the three filtered suites started together and awaited (block below); clean = all three exit 0
  and no vitest "Unhandled" report. N = 5 consecutive clean runs, no reruns; a red in any file, in scope or not, is a
  flake. Logs stay in the P3-S1-notes directory.
- D-4 Cleanup, only inside the exclusive window: plain `DROP DATABASE "<name>"` (no FORCE; one with a live connection
  errors, stays and is reported) for each name matching exactly `^plexco_guest_note_routes_[0-9]+$` or
  `^plexco_close_route_db_[0-9]+$` (also allowed: `^plexco_dev_login_[0-9]+$`). Count with
  `SELECT count(*) FROM pg_database WHERE datname ~ '^plexco_(guest_note_routes|close_route_db|dev_login)_[0-9]+$'`. No
  code drops another process's database; the lasting fix is the teardown drop of the context's own database.
- D-5 No testTimeout, hookTimeout, per-test timeout, expect timeout, Playwright retry or retry-loop count goes up. Moving
  a lock wait or migrate from a test body into a hook with a larger budget counts as loosening. A fixed sleep may become
  a poll for the exact asserted condition, bounded by no more than the original allowance (JSO-5: 2.5 s).
- D-6 pwa: measure the cause first (traces). If it is production-side, production stays untouched: sequence the spec on
  a production-independent readiness signal, keep the assertions at `:61` and `:64-65`, and record the production race
  under OPEN with file:line. If no such signal exists, leave the spec unchanged and report the pwa item partial.
  `playwright.config.ts` changes only if the cause is there.
- D-7 Scope addition: `apps/web/app/api/auth/logout-all/route.test.ts`, test-only, for exactly two edits: its migrate()
  (`:56`) gets I4 protection (or the file moves to setupRlsTestContext), and its password write (`:58`, value `:23`)
  goes through the P2/P3 path with `ROLE_PW.app`. Its 8 assertions stay. Without it, A1 can fail for a reason no in-scope
  edit can fix. It is file-disjoint from L0, L1b and L2.
- D-8 Baseline before code, in one exclusive window: the password probe, the definer membership query, the per-pid
  count, one parallel run with each red classified by cause, and the pwa spec with traces. At the end of every window,
  probe again: if the runbook passwords are not accepted, run the runbook section 5 command, and if a definer has a member
  other than `plexco`, re-run the three bootstrap files with container psql (runbook section 3), before releasing the lock.
- D-9 B3 cap as in section 4.
- D-10 A test of the old mechanism itself (e.g. the injected "tuple concurrently updated" spy at `migrate.test.ts:4818-4846`)
  may be replaced only by a test of the new mechanism in `test-harness.test.ts`. Product assertions keep their intent;
  collected counts drop only by listed replacements.

```bash
# D-3, run with bash (the agent shell is zsh). Inside the exclusive DB/e2e window only.
export NODE_ENV=test DATABASE_URL_TEST=postgres://plexco:plexco_dev@localhost:5432/plexco_test
N="$HOME/Projects/Plexco app/Claude outputs/plexco-phase3/status/P3-S1-notes"
for i in 1 2 3 4 5; do
  pnpm --filter @plexco/db test > "$N/l1-run$i-db.log" 2>&1 & d=$!
  pnpm --filter @plexco/bot test > "$N/l1-run$i-bot.log" 2>&1 & b=$!
  pnpm --filter @plexco/web test > "$N/l1-run$i-web.log" 2>&1 & w=$!
  wait $d; ed=$?; wait $b; eb=$?; wait $w; ew=$?
  echo "run $i db=$ed bot=$eb web=$ew unhandled=$(cat "$N"/l1-run$i-*.log | grep -ci unhandled)"
done
```

## 4. B3 exception (budget: about 300 LOC, 3 modules, 1 migration)

- Modules: `packages/db` (harness + 5 DB test files), `apps/bot` (2 helper files + 3 DB test files), `apps/web` (pwa spec,
  Playwright config, logout-all test). 3 modules, the default limit; 0 migrations.
- LOC: the default is expected to be exceeded. Cap: 900 changed lines (insertions + deletions of
  `git diff --shortstat c762c90..HEAD`, this file excluded). Above the cap the writer stops and reports partial, with the
  rest under OPEN; the PR body cites the measured shortstat.
- Why a split breaks coherence: the one acceptance (A1) fails while any flake class remains, so no sub-lane can pass
  alone; both mechanisms are single choke points spanning all three suites (a db-only password fix leaves the bot clash,
  a db-only lock fix leaves the bot setups convoying); a split repeats the exclusive N=5 window that blocks every other
  lane, and the sub-lanes would edit `test-harness.ts` one after another anyway.
- Compatibility proof: `git diff --name-only c762c90..HEAD` is a subset of TARGET_FILES plus this file; the four
  non-test-named files in scope have no production importer (2.6); out-of-scope callers and guard tests keep working
  unedited (2.6, I5); the CI workflow and its db-before-bot-and-web order are untouched.

## 5. Acceptance matrix

| ID | Group | Input / precondition | Expected | Layer |
|---|---|---|---|---|
| A1 | Concurrency | D-3, N = 5, exclusive window, after D-4 | 5 of 5 clean: three exit codes 0, no Unhandled report, no rerun | local parallel |
| A2 | Concurrency | `git grep -n plexco_test_worker_jrd`; grep of test-password literals | no hit; code literals only in `ROLE_PW` (P1) | static |
| A3 | Concurrency | two participants write passwords at once | serialised; no "tuple concurrently updated" retry loop left (P2) | test-harness.test.ts + grep |
| A4 | Boundary | probe at window start (runbook passwords accepted) | same probe result after every run; test passwords rejected (P3) | probe |
| A5 | Boundary | role absent at capture; run killed after capture | no password, role kept; next full run restores the original (D-2) | test-harness.test.ts |
| A6 | Failure | snapshot, restore or lock query fails | run fails with the original pg error; nothing swallowed (P5) | test-harness.test.ts |
| A7 | Concurrency | breaker window vs reader in another process (bot setup and logout-all included); two readers | reader never sees the broken state; readers never queue on readers (I1-I4) | test-harness.test.ts + review |
| A8 | Regression | JCL-4, JCL-12, BR-5, JSO-2, JSO-5 in the A1 runs | pass in all 5 with timeouts unchanged | A1 |
| A9 | Failure | tenant-capability-authority non-superuser test | no unguarded pool, no bare ALTER, no unhandled 57P01 | A1 + static |
| A10 | Regression | roster-service SESSION_NOT_OPEN loop | `before` measured before the command starts; assertions unchanged | A1 |
| A11 | Migration | `packages/db/migrations`; D-4 count before and after one full run | no migration file touched; 0 and 0 after cleanup (no growth) | static + psql count |
| A12 | e2e | `pwa.spec.ts`, 8 consecutive local runs (one build) | 0 of 8 red, local retries 0, assertions unchanged, cause in PR body (D-6) | Playwright |
| A13 | Security | logs, diff, PR body | no password, verifier or URL credential printed; nothing secret committed | review |
| A14 | Regression | `vitest list` and `playwright test --list` | db >= 1187, bot >= 129, web >= 1677, e2e 200, except listed D-10 replacements | collection |
| A15 | Regression | S1 VERIFY set | typecheck, lint, format:check, review:check:changed, build, web unit, `pnpm -w test`, Playwright: pass | VERIFY |
| A16 | Observability | every exclusive window | owner.txt, per-run exit codes, counts and probe output cited; cluster left as found (D-8) | evidence |
| A17 | Authorization | RLS and grant suites | still assert from the app, app_worker and readonly seats, never superuser | review |
| A18 | Scope | `git diff` of the lane | files within TARGET_FILES plus this file, 0 migrations, cap of section 4 | static |

## 6. Closure matrix (gate section 8)

| # | Gate | Evidence | Result |
|---|---|---|---|
| 1 | Authority snapshot pinned by SHA | `c762c900e4ca55bc8ed2a84c0a86f7d0d7d7cf0a`, 14 exact TARGET_FILES, worktree HEAD equal | PASS |
| 2 | Decisions in scope closed | lane: no owner decision; owner approval 2026-10-16; DD-122 D4 | PASS |
| 3 | Scope IN/OUT and owner clear | verdict IN_SCOPE / OUT_OF_SCOPE, D-7, section 4 | PASS |
| 4 | Dependencies classified | root slice; every called helper and role exists on main (2.3-2.6) | PASS |
| 5 | Live code matches the doc | every lane path:line re-measured; corrections C1-C8 | PASS |
| 6 | Data/API/state/auth contract | P1-P5, I1-I5 (no product contract touched) | PASS |
| 7 | Fail-closed, idempotency, order | P4, P5, D-2, D-4, D-5 | PASS |
| 8 | Open questions in scope = 0 | D-1..D-10 pinned | PASS |
| 9 | Acceptance matrix has expected results | section 5, A1-A18 | PASS |
| 10 | Migration, security, rollback pinned | 0 migrations; test-only; revert of the PR is the rollback | PASS |
| 11 | First slice hard dependencies merged | none (root) | PASS |
| 12 | Implementation handoff ready | worktree at base, FIRST_IMPLEMENTATION_STEP, section 7 | PASS |

## 7. Handoff

1. D-8 baseline under the lock (FIRST_IMPLEMENTATION_STEP). Done: numbers in the notes and later in the PR body.
2. Failing-first tests in `test-harness.test.ts` for P1-P5 and I1-I3. Done: each fails at base for its stated reason.
3. Harness: single authority, serialised writes, restore (D-2), teardown drop of the context's own database.
4. Locks: reader/breaker separation, no hold-and-wait; bot `test-db.ts` and logout-all parity (I4) within 2.6.
5. Callers: the `migrate.test.ts` password sites; tenant-capability-authority (guarded or `connectAsApp`); the three bot
   files on `ROLE_PW`; roster ordering; in-scope comments that describe the old behaviour.
6. pwa per D-6.
7. D-4 cleanup, then the acceptance window (A1, A4, A11, A12), leaving the cluster as found (D-8).
8. S1 VERIFY set; independent opus/max review, at most 3 rounds.

PR body: "Codex waived by owner 2026-10-12; reviewed by independent Claude subagent"; D-1..D-10; the cause of each flake
with file:line; the measured numbers; the shortstat; the GitNexus or grep blast radius; OPEN: the runbook section 5 step
and troubleshooting row (`docs/runbooks/local-mvp-smoke.md:75-77`, `:178`), `.env.example:52-61`,
`infra/docker-compose.yml:105-110`, the S1 ENVIRONMENT and KNOWN FLAKES lines of the RUN doc, and the four backlog rows
(`app-worker-test-password-clash-flake`, `db-test-unhandled-57p01-and-load-timeouts`, `e2e-web-pwa-offline-online-flake`,
`dev-app-worker-password-not-restored`); any confirmed production race (D-6); any 53300 "too many clients" seen
(`max_connections` 100 is an infra setting, out of scope).
