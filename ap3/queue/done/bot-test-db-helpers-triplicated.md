---
slug: bot-test-db-helpers-triplicated
class: code-quality-p2
risk: P2
scope:
  - apps/bot/src/test-db.ts
  - apps/bot/src/test-db.test.ts
  - apps/bot/src/dispatcher.test.ts
  - apps/bot/src/preflight.test.ts
  - apps/bot/src/schedule.test.ts
verify: pnpm --filter @plexco/bot run typecheck && pnpm --filter @plexco/bot exec vitest run src/test-db.test.ts && pnpm exec eslint apps/bot/src && pnpm exec prettier --check apps/bot/src
budget_usd: 8
max_review_rounds: 3
---
## Problem

Three bot test files hand-copy the same job_definer DB test helpers. Measured 2026-09-23 at
`origin/main@4e69d1d`: the block of four functions is byte-identical (46 lines) in
`apps/bot/src/dispatcher.test.ts:42-87`, `apps/bot/src/preflight.test.ts:55-100` and
`apps/bot/src/schedule.test.ts:53-98`:

- `bootstrapJobDefiner(client)` — runs `infra/postgres-init/01-job-definer.sql`, ROLLBACK on error
- `withJobDefinerLock(base, fn)` — advisory lock `JOB_DEFINER_LOCK_KEY` on a dedicated client
- `setAppWorkerPasswordRaceSafe(client, password)` — retrying `ALTER ROLE app_worker`
- `testUrl(base, opts)` — rewrites db/user/password on a connection URL

Each file also re-declares the two constants those helpers use: `JOB_DEFINER_BOOTSTRAP_SQL_PATH`
(`dispatcher.test.ts:31-39`, `preflight.test.ts:39-47`, `schedule.test.ts:42-50`) and
`JOB_DEFINER_LOCK_KEY = 0x6a6f6264` (`dispatcher.test.ts:40`, `preflight.test.ts:53`,
`schedule.test.ts:51`). The lock key is load-bearing: it only coordinates with
`packages/db/src/test-harness.ts:355` (same key) because every copy happens to hold the same
literal — today that is a comment ("must match"), not a check. Re-derive at your base first:

```text
git grep -c -E '^(async )?function (bootstrapJobDefiner|withJobDefinerLock|setAppWorkerPasswordRaceSafe|testUrl)[<(]' -- apps/bot/src   # expect 4 in each of the three files
git grep -n '0x6a6f6264' -- apps/bot/src   # expect 3 hits, one per file
```

If the counts differ, or the three blocks are no longer byte-identical, HALT `MISSING_CONTEXT`
and report what differs; do not reconcile diverged copies yourself.

## Acceptance

1. New module `apps/bot/src/test-db.ts` holds the four helpers and the two constants, moved
   verbatim (same bodies, same behaviour). It exports the four helpers and `JOB_DEFINER_LOCK_KEY`.
   `JOB_DEFINER_BOOTSTRAP_SQL_PATH` is computed from `test-db.ts`'s own `import.meta.url`; the file
   sits in the same directory as the three test files, so the resolved path is unchanged. Move the
   "SAME key as packages/db/src/test-harness.ts" rationale (now at `preflight.test.ts:48-52`) next
   to the key in `test-db.ts`.
2. The three test files import the helpers from `./test-db.js` and delete their local copies of
   the four functions and the two constants. Nothing else moves: `HERE`, `APP_WORKER_PASSWORD`,
   every `setup*Context` function, context interfaces, database names and every test body stay in
   their own file, unchanged. Imports that become unused are removed; no other line changes.
3. Update each file's "--- DB test setup, ... duplicated ..." comment block to say the stateless
   helpers now live in `./test-db.ts` while each file still owns its own DB fixtures. Leave the
   `codex round-04 [P2]` app_worker-password comment in each file untouched.
4. RED test: new `apps/bot/src/test-db.test.ts`, filesystem-only (no database, no network):
   (a) walks `apps/bot/src/*.ts` and asserts each of the four helper definitions appears in exactly
   one file, `test-db.ts`; (b) asserts the literal `0x6a6f6264` appears in exactly one file under
   `apps/bot/src`, `test-db.ts`; (c) reads `packages/db/src/test-harness.ts` as TEXT, extracts its
   `JOB_DEFINER_LOCK_KEY` value and asserts it equals the `JOB_DEFINER_LOCK_KEY` exported by
   `./test-db.js`. It fails at base (three definitions per helper, no `test-db.ts`) and passes after.
   Follow the guard-test style of `packages/db/src/tx-alias.test.ts` and
   `packages/db/src/tenant.test.ts:192-213`.
5. `verify` is green in the sandbox: bot `tsc --noEmit`, the new guard test, eslint and prettier on
   `apps/bot/src`. The three DB suites (`dispatcher`, `preflight`, `schedule`) CANNOT run inside the
   writer sandbox — raw TCP to Postgres is refused there (measured on this repo 2026-09-10,
   `connect EPERM 127.0.0.1:5432`). CI runs them on the PR (`pnpm -w test` with a Postgres service)
   and is the last gate before merge. Do not run them, work around the sandbox, or HALT over it.
6. Runtime code never imports `packages/db/src/test-harness.ts`: it is not in the db package's
   `exports` map, which is the original reason these copies exist (`preflight.test.ts:34-37`).
   Reading its source as text in the guard test (item 4c) is the only allowed use.
7. No change to any non-test file under `apps/bot/src` other than creating `test-db.ts`, and no
   change to `apps/bot/src/test-harness.ts`. If either seems necessary, HALT `SCOPE_DRIFT`.

## Context
- **Dependencies: the worktree is a FRESH checkout with no `node_modules`.** pnpm workspaces are not
  shared across git worktrees, so run `pnpm install --frozen-lockfile` from the repo root **before**
  the first `verify`. It is gitignored, so it never enters the diff and never trips the clean-worktree
  check. If the install itself fails (network or store path blocked by the sandbox), that is not
  something to work around: HALT `MISSING_CONTEXT` and report the exact error.

- Owner decision 2026-09-23: this task is why the class ceiling in `ap3/routines.json` now covers the
  bot test files and the shared helper module. It is test-only; bot production code stays out.
- Why the copies exist: `apps/bot/src/preflight.test.ts:34-37` — the db package's own harness
  (`packages/db/src/test-harness.ts`) is not exported (`packages/db/package.json`), so bot tests
  could not import it. That reason does not forbid a bot-local shared module; it only rules out
  importing the db harness.
- Keep `apps/bot/src/test-harness.ts` single-purpose: it is the test-lifecycle wrapper added in
  552cedd ("DB fixture ownership stays local; the shared wrapper below only joins each test's
  original operation"). Do not add the DB helpers there — that is why the new module is separate,
  and why per-file fixtures (item 2) stay local.
- `packages/db/src/test-harness.ts:355-382` holds the db package's own `withJobDefinerLock`, which
  differs (inline connect/lock try-catch, `guardClientErrors`). Do NOT converge the bot copy onto
  it: this task moves code, it does not change the helper's behaviour.
- GitNexus: run `gitnexus_impact` (upstream) on the four helpers before editing — every caller is
  inside the three test files — and `gitnexus_detect_changes()` before committing, per `CLAUDE.md`.
- Commit message: `refactor(bot): share the job_definer test helpers -- were copied in three test files`.
- PR body must state the re-derived counts from Problem and the RED output from `.ap3-run/red.txt`.
