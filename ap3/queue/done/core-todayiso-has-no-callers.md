---
slug: core-todayiso-has-no-callers
class: code-quality-p2
risk: P2
scope:
  - packages/core/src/time.ts
  - packages/core/src/index.test.ts
verify: pnpm --filter @plexco/core run typecheck && pnpm test:core
budget_usd: 6
max_review_rounds: 3
---
## Problem

`packages/core/src/time.ts:9` exports `todayIso(now = new Date()): string`. Measured at
`main@751e019` (2026-09-10): it has exactly one reader in the whole repository —
`packages/core/src/index.test.ts:8`, `expect(typeof core.todayIso).toBe("function")` — a test that
only asserts the export exists and therefore checks nothing. `@plexco/core` is `"private": true`
(workspace-only) and the bot lives in this monorepo (`apps/bot`), so there is no consumer outside
the repo either. Re-derive the count at your base before touching anything:

```text
git grep -n -w todayIso -- apps packages scripts   # expect exactly 2 hits: time.ts:9, index.test.ts:8
```

If the count differs, HALT `MISSING_CONTEXT` and report the extra hits; do not widen the change.

## Acceptance

1. `time.ts` no longer defines or exports `todayIso`: remove the function together with its JSDoc
   line (`/** Local calendar date as ISO "YYYY-MM-DD". */`) and the blank line after it. Nothing
   else in the file changes — the file header comment, `startOfDay` and `inferYear` stay
   byte-identical (`inferYear` is live: `packages/core/src/dates.ts:7,143,152`).
2. `index.test.ts` no longer reads `todayIso`. Replace the `typeof` line with a dead-export guard
   that uses a COMPUTED key so the acceptance grep below stays at 0 hits:
   `expect(["today", "Iso"].join("") in core).toBe(false);`
   (same pattern as the `CORE_PACKAGE` guard two lines above it — a literal `"todayIso"` string
   would itself match the grep; that was round-1's review finding on the previous slice).
   This is the RED test: it fails at base because the export exists, and stays as the guard.
3. `verify` is green: `tsc --noEmit` for `@plexco/core` and the core vitest suite (153 tests at
   base, expect 153 after — no test is removed, one assertion is replaced).
4. `git grep -n -w todayIso -- apps packages scripts` returns 0 hits.
5. Nothing else in either file changes; the barrel `packages/core/src/index.ts` is NOT in scope
   and must not be touched (`export * from "./time.js"` still exports `inferYear`).

## Context

- **Dependencies: the worktree is a FRESH checkout with no `node_modules`.** pnpm workspaces are not
  shared across git worktrees, so run `pnpm install --frozen-lockfile` from the repo root **before**
  the first `verify`. It is gitignored, so it never enters the diff and never trips the clean-worktree
  check. If the install itself fails, HALT `MISSING_CONTEXT` and report the exact error.
- Owner decision 2026-09-10: delete (the export was lifted from the old single-club bot; the
  current bot does not call it). The previous slice `core-package-const-has-no-consumer`
  (PR #2, merged 751e019) deliberately left it alone pending this decision.
- Blast radius is the two scope files; confirm zero callers with `gitnexus_context` on `todayIso`
  before editing, and run `gitnexus_detect_changes()` before committing per `CLAUDE.md`.
- Do NOT touch `inferYear`, `startOfDay`, or any other export of `@plexco/core`.
- Commit message: `chore(core): drop todayIso — zero callers, only reader was a typeof test`.
- PR body must state the re-derived hit count (Problem above) and the RED output from
  `.ap3-run/red.txt`.
