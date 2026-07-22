# AP-29 — `core-matcher-grouped-amount-parsing`

Task: make `splitNameAmount` return an exhaustive fail-closed ambiguity union — bugfix.

You are in the dedicated worktree for Plexco slice `core-matcher-grouped-amount-parsing`. No prior
conversation context is required.

Risk header:

- Risk tier: P2 parser/money proposal
- Change class: bugfix
- Merge policy: `manual_only`
- Auto-merge requested: no
- Autopilot maturity: pilot
- Codex review: 2× consecutive FULL-base clean on current HEAD
- Framework: canonical `autopilot-prompt-GENERIC` v0.6.0

## Hard preflight

1. Require branch `feat/core-matcher-grouped-amount-parsing` in a dedicated worktree based on synced
   `main`; never run from the repo root.
2. Require a clean tree, no git lock and HEAD equal to the `main` SHA from which the worktree was created.
3. Require these files on `origin/main`:
   - `docs/dd-87-splitnameamount-decision-table-analysis.md`;
   - `docs/autopilot-core-split-name-amount-ambiguity-contract.md`;
   - `docs/autopilot-manifests/core-matcher-grouped-amount-parsing.json`;
   - this launcher.
4. Require the task contract's first line to be exactly `<!-- review-readiness: code-ready -->` and its
   active verdict to be strict `CODE_READY`. If it is still `enforce`/`NOT_CODE_READY`, HALT `DEP_MISSING`.
5. Register/re-register the manifest before edits:

   ```bash
   scripts/autopilot-scope-gate register \
     --manifest docs/autopilot-manifests/core-matcher-grouped-amount-parsing.json
   ```

6. Resolve only `CODEX="${AUTOPILOT_CODEX_BIN:?HALT CODEX_UNAVAILABLE}"`; require executable. Never
   substitute PATH `codex`, manual review or another model.
7. Run the green-base checks:

   ```bash
   pnpm --filter @plexco/core test
   pnpm --filter @plexco/core typecheck
   ```

Any failure writes worktree-local `.autopilot/state/core-matcher-grouped-amount-parsing/HALT-<REASON>.txt`
before the report and stops.

## State and design-probe gate

Create before production edits:

```bash
mkdir -p .autopilot/state/core-matcher-grouped-amount-parsing/codex
: > .autopilot/state/core-matcher-grouped-amount-parsing/regions.log
echo 0 > .autopilot/state/core-matcher-grouped-amount-parsing/fix-round-count.txt
```

Read completely:

1. `docs/dd-87-splitnameamount-decision-table-analysis.md`;
2. `docs/autopilot-core-split-name-amount-ambiguity-contract.md`;
3. `packages/core/src/payments-logic.ts` (`splitNameAmount`, `AMOUNT_TOKEN_RE`);
4. `packages/core/src/dates.ts` (`parseMoney`);
5. `packages/core/src/payments-logic.test.ts` (`splitNameAmount` suite).

Before editing, write `design-probe.md` with `FOUNDER_CONFIRMATION: DD-87 owner-ratified 2026-07-22`,
the exact tagged union, and current-vs-required candidate sets for `Wang 110 500`, `Player 2 110k` and
`Player 0 110k`. This is the GENERIC v0.6.0 breaker-26 confirmation. The mechanism is already approved;
continue only if the probe matches DD-87 exactly. Any need for a second grammar, threshold, known-name lookup,
fuzzy rule or blocklist is `DESIGN_UNFIT` HALT.

## Implementation

1. Add the mandatory DD-87/SNA failing tests first; verify the current base fails for the expected contract
   reason. Unexpected pass is `TDD_ORACLE_VIOLATED` HALT.
2. In `payments-logic.ts`, export the pinned candidate/result types and enumerate all positive
   `parseMoney`-valid trailing runs. Dedupe by `(name,amount)`, order shortest-to-longest and return
   `none|resolved|ambiguous` by candidate count.
3. Ambiguous results must not expose top-level `name` or `amount`. Do not modify `parseMoney`, add a second
   grammar, choose a preferred candidate or touch any other classifier.
4. Update exact existing assertions; never replace them with partial object matching.
5. Only these files may change:
   - `docs/autopilot-manifests/core-matcher-grouped-amount-parsing.json`;
   - `packages/core/src/payments-logic.ts`;
   - `packages/core/src/payments-logic.test.ts`.

Run after implementation and every fix:

```bash
pnpm --filter @plexco/core test
pnpm --filter @plexco/core typecheck
git diff --check
git diff --stat main...HEAD
```

The final stat must be non-empty and scope-exact. Stage per file, never `git add -A` or `git add .`.

## Codex and loop breakers

Persist each FULL round by direct redirection:

```bash
"$CODEX" review --base main \
  > .autopilot/state/core-matcher-grouped-amount-parsing/codex/round-NN.txt 2>&1
```

The target is two consecutive FULL-base rounds with zero findings on the same current HEAD. A round counts
only with a real tail verdict and non-empty `git diff --stat main...HEAD`. On a finding, append
`file:function` to `regions.log`, increment the counter file, fix all in-scope money/data findings, rerun
verification and commit. Counter `>5` is `MAX_ROUNDS`; the same region in three consecutive rounds is
`REGION_THRASH`; a reachable missing row is `TABLE_GAP`. Quota/auth/transient triage follows GENERIC v0.6.0;
there is no degraded reviewer mode.

## Finish

After the second clean round, finish in the same turn:

1. rerun all verification;
2. confirm at least one commit, clean tree, scope-exact non-empty diff and counters present;
3. prove mergeability against current `origin/main` with `git merge-tree --write-tree`;
4. run `scripts/autopilot-scope-gate ready --manifest
   docs/autopilot-manifests/core-matcher-grouped-amount-parsing.json`;
5. push only the feature branch if access exists;
6. emit `READY_FOR_MANUAL_MERGE` and stop.

Do not merge, clean the reservation, remove the worktree or start another task.
