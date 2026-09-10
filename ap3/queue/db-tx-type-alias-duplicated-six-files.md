---
slug: db-tx-type-alias-duplicated-six-files
class: code-quality-p2
risk: P2
scope:
  - packages/db/src/client.ts
  - packages/db/src/tenant.ts
  - packages/db/src/capability.ts
  - packages/db/src/authorization.ts
  - packages/db/src/public-session-fence.ts
  - packages/db/src/session-service.ts
  - packages/db/src/chat-schema-invariants.test.ts
  - packages/db/src/tx-alias.test.ts
verify: pnpm --filter @plexco/db run typecheck && pnpm test:db
budget_usd: 10
max_review_rounds: 3
---

## Problem

The same type alias, `type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0]`, is hand-copied in
six files of `packages/db/src` (re-measured at `origin/main@c59674a`, post bundle-v6 merge PR #7 /
`cffa993`, 2026-09-10): `tenant.ts:27`, `capability.ts:5`, `authorization.ts:5`,
`public-session-fence.ts:7`, `session-service.ts:1581`, `chat-schema-invariants.test.ts:163`. Only
`session-service.ts` moved (was `:1571` at the pre-v6 `30a3e90` measurement); the other five sit at
byte-identical line numbers. Six copies of a derived type drift independently; the type is derived
purely from `Db`, which `client.ts` owns, so `client.ts` is its home. Re-derive the list at your base
first:

```text
git grep -n 'type Tx = Parameters<Parameters<Db\["transaction"\]>\[0\]>\[0\]' -- packages/db/src
```

`capability.test.ts:38` also declares a `type Tx`, but it is a DIFFERENT type
(`Parameters<typeof resolveCapability>[0]`) — leave it alone.

## Acceptance

1. `client.ts` exports `Tx` once (`export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];`).
2. Every other listed file imports `type Tx` from `./client.js` (or the existing relative path
   style used in that file) and drops its local copy. No other line in those files changes.
3. RED test: new `packages/db/src/tx-alias.test.ts` walks `packages/db/src/**/*.ts` (excluding
   `capability.test.ts`) and asserts the alias literal appears in exactly one file, `client.ts` —
   mirroring the guard pattern in `tenant.test.ts:192-213`. It must fail at base (6 hits) and pass
   after the change (1 hit).
4. `verify` green: `@plexco/db` typecheck and the full db suite (764 tests at `c59674a`; expect
   764 + the new guard).
5. `packages/db/src/index.ts` (the package barrel) is NOT in scope: if `Tx` must be re-exported
   from the package root for a consumer outside `packages/db/src`, HALT `SCOPE_DRIFT` and say
   which consumer.

## Context
- **Dependencies: the worktree is a FRESH checkout with no `node_modules`.** pnpm workspaces are not
  shared across git worktrees, so run `pnpm install --frozen-lockfile` from the repo root **before**
  the first `verify`. It is gitignored, so it never enters the diff and never trips the clean-worktree
  check. If the install itself fails (network or store path blocked by the sandbox), that is not
  something to work around: HALT `MISSING_CONTEXT` and report the exact error.

- **First ap3 slice to run `pnpm test:db` inside the sandboxed writer** (slices 1-2 only exercised
  `test:core`). Confirmed before promotion: `ap3/env` has a `DATABASE_URL_TEST=` line and
  `plexco-postgres-1` is up and healthy. If the sandbox cannot reach Postgres at all, that is a new
  finding, not something to work around: HALT `MISSING_CONTEXT` and report the exact error.
- Row text: owner's untracked backlog-rows note of 2026-09-08 § db-tx-type-alias-duplicated-six-files (NOT in the repo)
  (explains why `client.ts`, not `tenant.ts`, is the home).
- Guard-test precedent: `packages/db/src/tenant.test.ts:192-213` (file walk + `toEqual` on the hit list).
- Invariants named by the row: `session-command`, `billing-authz` — a type-only change must not
  alter any runtime behaviour; the db suite is the proof.
- Run `gitnexus_impact` on `Tx`-consuming functions is not required (type-level only), but run
  `gitnexus_detect_changes()` before committing per `CLAUDE.md`.
- Commit message: `refactor(db): export Tx once from client.ts — was copied in six files`.
