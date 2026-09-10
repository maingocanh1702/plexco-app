---
slug: core-package-const-has-no-consumer
class: code-quality-p2
risk: P2
scope:
  - packages/core/src/index.ts
  - packages/core/src/index.test.ts
verify: pnpm --filter @plexco/core run typecheck && pnpm test:core
budget_usd: 6
max_review_rounds: 3
---
## Problem

`packages/core/src/index.ts:14` exports `CORE_PACKAGE = "@plexco/core"`. Measured at
`main@30a3e90` (slop audit 2026-09-08, owner's backlog-rows note, row
`core-package-const-has-no-consumer`): the constant has exactly one reader in the whole repository —
`packages/core/src/index.test.ts:6`, `expect(core.CORE_PACKAGE).toBe("@plexco/core")` — a test that
asserts the constant against itself and therefore checks nothing. Re-derive the count at your base
before touching anything:

```text
git grep -n -w CORE_PACKAGE -- apps packages scripts   # expect exactly 2 hits: index.ts:14, index.test.ts:6
```

If the count differs, HALT `MISSING_CONTEXT` and report the extra hits; do not widen the change.

## Acceptance

1. `@plexco/core`'s browser-safe barrel no longer exports `CORE_PACKAGE`; the definition line is gone.
2. `index.test.ts` no longer reads `CORE_PACKAGE`. Replace the self-assertion with a one-line
   dead-export guard inside the existing first `it(...)`: `expect("CORE_PACKAGE" in core).toBe(false);`
   — this is the RED test (fails at base because the export exists) and it stays as the guard.
3. `verify` is green: `tsc --noEmit` for `@plexco/core` and the core vitest suite (153 tests at
   base, expect 153 after — no test is removed, one assertion is replaced).
4. `git grep -n -w CORE_PACKAGE -- apps packages scripts` returns 0 hits.
5. Nothing else in either file changes. The barrel's header comment and every `export * from`
   line stay byte-identical.

## Context
- **Dependencies: the worktree is a FRESH checkout with no `node_modules`.** pnpm workspaces are not
  shared across git worktrees, so run `pnpm install --frozen-lockfile` from the repo root **before**
  the first `verify`. It is gitignored, so it never enters the diff and never trips the clean-worktree
  check. If the install itself fails (network or store path blocked by the sandbox), that is not
  something to work around: HALT `MISSING_CONTEXT` and report the exact error.

- Row text and measurements are inlined above (the source row lives in the owner's untracked
  backlog-rows note of 2026-09-08 — it is NOT in the repo, do not look for it).
- The two scope files are the entire blast radius; there is no production caller, so no GitNexus
  impact run is needed beyond confirming `CORE_PACKAGE` has zero callers (`gitnexus_context`).
- Do NOT touch `todayIso` (`packages/core/src/time.ts`) even though `index.test.ts:8` only checks
  `typeof`: it is a public export lifted from the production bot and keeping or deleting it is an
  owner decision, explicitly excluded from this row. `inferYear` in the same file is live.
- Do NOT touch any other `export * from` line in the barrel, and do not add anything to it —
  the barrel must stay browser-safe (see its header comment: the i18n module must never be
  re-exported here).
- Independence: bundle v6 (`fix/audit-2026-09-06` @ `72394fe`) does not touch either scope file
  (`git diff --name-only 30a3e90..72394fe -- packages/core/src/index.ts packages/core/src/index.test.ts` is empty),
  so this task is valid before or after that merge.
- Commit message: `chore(core): drop CORE_PACKAGE — only reader was a self-asserting test`.
- PR body must state the re-derived hit count (item 1 above) and the RED output from
  `.ap3-run/red.txt`.
