---
slug: db-test-lock-barrier-helpers-duplicated
class: code-quality-p2
risk: P2
scope:
  - packages/db/src/test-harness.ts
  - packages/db/src/authorization.test.ts
  - packages/db/src/capability.test.ts
  - packages/db/src/auth.test.ts
  - packages/db/src/lock-barrier-helpers.test.ts
verify: pnpm --filter @plexco/db run typecheck && pnpm --filter @plexco/db exec vitest run src/lock-barrier-helpers.test.ts && pnpm exec eslint packages/db/src/test-harness.ts packages/db/src/authorization.test.ts packages/db/src/capability.test.ts packages/db/src/auth.test.ts packages/db/src/lock-barrier-helpers.test.ts && pnpm exec prettier --check packages/db/src/test-harness.ts packages/db/src/authorization.test.ts packages/db/src/capability.test.ts packages/db/src/auth.test.ts packages/db/src/lock-barrier-helpers.test.ts
budget_usd: 25
max_review_rounds: 3
---
## Problem

Three DB concurrency suites hand-copy the same lock-wait barrier helpers. Measured 2026-09-26 at
`origin/main@7f6d00e` (function bodies compared byte-for-byte, JSDoc excluded):

- `backendPid(client: pg.PoolClient)` (4 lines) is identical in
  `packages/db/src/authorization.test.ts:72-75`, `packages/db/src/capability.test.ts:92-95` and
  `packages/db/src/auth.test.ts:76-79`.
- `waitUntilSomeoneBlockedByHolder(owner: pg.Client, holderPid: number)` (16 lines) is identical in
  `packages/db/src/authorization.test.ts:86-101` and `packages/db/src/capability.test.ts:104-119`.
  The capability copy's JSDoc even says it "mirrors authorization.test.ts's helper of the same name".

All three files already import `setupRlsTestContext` from `./test-harness.js`, the db package's
shared test module, so the helpers have an obvious single home. Re-derive at your base first:

```text
git grep -n -E '^async function (backendPid|waitUntilSomeoneBlockedByHolder)\(' -- packages/db/src
# expect exactly 6 hits: backendPid in auth.test.ts, authorization.test.ts, capability.test.ts
# (all `client: pg.PoolClient`) and in identity-link-code.test.ts (`client: pg.ClientBase` -- NOT
# part of this task, see Context); waitUntilSomeoneBlockedByHolder in authorization.test.ts and
# capability.test.ts.
```

If the counts differ, or the copies named above are no longer byte-identical in their bodies, HALT
`MISSING_CONTEXT` and report what differs; do not reconcile diverged copies yourself.

## Acceptance

1. `packages/db/src/test-harness.ts` exports `backendPid` and `waitUntilSomeoneBlockedByHolder`,
   moved verbatim from `authorization.test.ts` (same signatures, same bodies, same 5 s deadline and
   15 ms poll, same error message). Carry over one JSDoc for the barrier that keeps the substance of
   the existing two: it discovers whichever backend is blocked specifically by `holderPid` via
   `pg_blocking_pids()`, for tests that have no handle on which pool connection drizzle used, and
   it is a deterministic barrier, not a timing sleep (G3 §8).
2. `authorization.test.ts` and `capability.test.ts` import both helpers from `./test-harness.js`
   and delete their local copies (with the copies' JSDoc). `auth.test.ts` imports `backendPid` from
   `./test-harness.js` and deletes its local copy. Every call site stays byte-identical. Imports
   that become unused are removed; no other line changes.
3. `auth.test.ts`'s own `waitUntilBlockedByHolder(owner, holderPid, waiterPid)` STAYS where it is,
   unchanged: it checks one known waiter, a different contract. So do every nested/local barrier in
   `session-service.test.ts` and everything in `identity-link-code.test.ts`.
4. RED test: new `packages/db/src/lock-barrier-helpers.test.ts`, filesystem-only (no database, no
   network, no import of `./test-harness.js` -- that module needs `DATABASE_URL_TEST` at runtime in
   its callers, and this guard must run without it). It walks `packages/db/src/*.ts` and asserts
   (a) a top-level definition `async function backendPid(client: pg.PoolClient)` -- matched at
   column 0 and exported or not -- appears in exactly one file, `test-harness.ts`; (b) a top-level
   definition of `waitUntilSomeoneBlockedByHolder(` appears in exactly one file, `test-harness.ts`.
   Build the searched literals from two halves (as `tx-alias.test.ts` does) so the guard does not
   match itself. Indented (nested) helpers in `session-service.test.ts` must NOT count -- anchor on
   column 0. It fails at base (3 and 2 definitions, none in `test-harness.ts`) and passes after.
   Follow the style of `packages/db/src/tx-alias.test.ts`.
5. `verify` is green in the sandbox: db `tsc --noEmit`, the new guard test, eslint and prettier on
   the five files. The three DB suites (`auth`, `authorization`, `capability`) CANNOT run inside the
   writer sandbox -- raw TCP to Postgres is refused there (measured on this repo 2026-09-10,
   `connect EPERM 127.0.0.1:5432`). CI runs them on the PR (`pnpm -w test` with a Postgres service)
   and is the last gate before merge. Do not run them, work around the sandbox, or HALT over it.
6. No change to any non-test behaviour: `test-harness.ts` gains two exports and nothing else in it
   changes. No file outside `scope` changes. If one seems necessary, HALT `SCOPE_DRIFT`.

## Context
- **Dependencies: the worktree is a FRESH checkout with no `node_modules`.** pnpm workspaces are not
  shared across git worktrees, so run `pnpm install --frozen-lockfile` from the repo root **before**
  the first `verify`. It is gitignored, so it never enters the diff and never trips the clean-worktree
  check. If the install itself fails (network or store path blocked by the sandbox), that is not
  something to work around: HALT `MISSING_CONTEXT` and report the exact error.
- Pre-measured 2026-09-26 on `7f6d00e` (outside the sandbox): db `tsc --noEmit`, eslint and prettier
  are all clean on the four existing files at base, and a trial move of exactly this shape stayed
  clean on all three. So a red `verify` means something in your diff, not a pre-existing failure.
- Test-only, behaviour-preserving: no auth/permission logic, no schema, no migration is touched. The
  suites merely live in auth-named files; the class ceiling (`ap3/routines.json`,
  `packages/db/src/**`) already covers them.
- Why `test-harness.ts`: it is the db package's shared, non-exported test module (the bot copies
  in `apps/bot/src/test-db.ts` exist precisely because it is not in `packages/db/package.json`'s
  `exports`). The three suites already import from it, so no new module is needed.
- Out of scope on purpose: `identity-link-code.test.ts:127` types `backendPid` on `pg.ClientBase`,
  and `session-service.test.ts` has five closure barriers with different signatures and a recursive
  `reach` CTE. Converging those changes signatures or semantics, not just location; leave them.
- GitNexus: run `gitnexus_impact` (upstream) on the two helpers before editing -- every caller is
  inside the three suites -- and `gitnexus_detect_changes()` before committing, per `CLAUDE.md`.
- Commit message: `refactor(db): share the lock-wait barrier test helpers -- were copied in three suites`.
- PR body must state the re-derived counts from Problem and the RED output from `.ap3-run/red.txt`.
