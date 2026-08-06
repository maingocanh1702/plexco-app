<!-- review-readiness: code-ready -->
# Autopilot task contract — `core-matcher-grouped-amount-parsing`

> **Framework:** canonical `autopilot-prompt-GENERIC` v0.6.0.
> **Risk:** P2 parser/money proposal · `manual_only` · auto-merge `false` · 2× consecutive FULL-base
> Codex clean · STOP_AT_READY.
> **Authority:** DD-87 owner-ratified 2026-07-22.
> **Current state:** `CODE_READY` (Verdict 16, `main@827d24d`) — packet committed/pushed and re-pinned.
> Launchable: open a dedicated worktree from `origin/main`, register the manifest, run the AP-29 design
> probe, then implement.

## 1. Task

Change only the pure `splitNameAmount` contract so every positive `parseMoney`-valid trailing
interpretation is returned deterministically:

- zero candidates → `none`;
- one candidate → `resolved`;
- two or more distinct `(name, amount)` candidates → `ambiguous` with an ordered candidate tuple and
  no top-level settleable amount.

This slice does not build a UI picker or write money. It makes ambiguity impossible to ignore before
future consumers are wired.

## 2. Exact code scope

Positive scope:

- `packages/core/src/payments-logic.ts`
  - export `SplitNameAmountCandidate` and `SplitNameAmountResult`;
  - collect/dedupe/order all valid trailing interpretations;
  - return the tagged union from `splitNameAmount`.
- `packages/core/src/payments-logic.test.ts`
  - convert existing exact-object assertions to the tagged union;
  - add every DD-87 row, including `Player 0 110k`.
- `docs/autopilot-manifests/core-matcher-grouped-amount-parsing.json`
  - scope authority only; no feature-branch expansion without re-registering.

Negative scope:

- no `parseMoney` grammar change and no new amount/grouping regex;
- no threshold, price plausibility, known-name lookup, fuzzy match or blocklist;
- no `classifyAmount`, settlement/FIFO, DB/schema/migration, transport, adapter, UI or i18n change;
- no consumer picker and no auto-selection of candidate index 0;
- no lift/edit of ignored historical decision-table files.

Budget: at most two code modules and approximately 180 net LOC; no migration.

## 3. Exact data contract

```ts
export interface SplitNameAmountCandidate {
  name: string;
  amount: number;
  rawAmount: string;
}

export type SplitNameAmountResult =
  | { kind: "none"; name: string }
  | { kind: "resolved"; name: string; amount: number }
  | {
      kind: "ambiguous";
      candidates: readonly [
        SplitNameAmountCandidate,
        SplitNameAmountCandidate,
        ...SplitNameAmountCandidate[],
      ];
    };
```

Generation contract:

1. Enumerate digit-led trailing runs within the existing amount-token envelope.
2. Call the existing `parseMoney` for every run; accept only non-null values greater than zero.
3. Map to `{name, amount, rawAmount}`.
4. Dedupe by exact `(name, amount)`, preserving the first shortest-run occurrence.
5. Preserve shortest-to-longest order.
6. Return `none`, `resolved` or `ambiguous` by candidate count.

## 4. Design-probe gate — before production edits

The launcher must create worktree-local
`.autopilot/state/core-matcher-grouped-amount-parsing/design-probe.md` before editing. It records:

- `FOUNDER_CONFIRMATION: DD-87 owner-ratified 2026-07-22`;
- the exact tagged union above;
- actual current outputs and expected candidate sets for:
  - `Wang 110 500`;
  - `Player 2 110k`;
  - `Player 0 110k`.

DD-87 is the founder confirmation required by GENERIC breaker 26. If the probe shows the mechanism
cannot produce the pinned sets without a second grammar/heuristic, write `HALT-DESIGN_UNFIT.txt` and
stop. Do not choose a new mechanism or ask code review to invent policy.

## 5. Acceptance matrix

The exact 18-row output table in DD-87 §4 is mandatory. In addition:

| ID | Case | Expected assertion |
|---|---|---|
| SNA-1 | one valid run | exact `resolved` object |
| SNA-2 | zero/null-only run | exact `none`; no `amount` property |
| SNA-3 | distinct amount interpretations | exact ordered `ambiguous.candidates`; no top-level `name`/`amount` |
| SNA-4 | equal amount, different payer-name | still `ambiguous` (`Player 0 110k`) |
| SNA-5 | duplicate call | deep-equal output, no mutable/shared state |
| SNA-6 | current grammar variants | spaced `k`, unit suffix and zero final group remain resolved |
| SNA-7 | type safety | TypeScript rejects treating ambiguous result as resolved without narrowing `kind` |
| SNA-8 | scope | no diff outside manifest + two core files; no log/IO/DB import |

Authorization/concurrency/migration are N/A because this is a deterministic pure function. Their safety
equivalent is the absence of IO/state and the scope-gate assertion.

## 6. Implementation order and Definition of Done

1. Run the design probe without production edits.
2. Add failing unit assertions for SNA-3/SNA-4 and the DD-87 rows; current base must fail.
3. Export the result types and implement candidate collection/deduplication.
4. Update all existing `splitNameAmount` assertions; do not weaken them to partial matching.
5. Run:

   ```bash
   pnpm --filter @plexco/core test
   pnpm --filter @plexco/core typecheck
   git diff --check
   git diff --stat main...HEAD
   ```

6. Confirm the diff is non-empty and contains only the three manifest scope files.
7. Commit per-file, then obtain two consecutive FULL-base Codex clean rounds on the same HEAD using only
   `AUTOPILOT_CODEX_BIN`, with direct round-file redirection.
8. Re-run verification, prove mergeability, mark scope-gate ready, push feature branch if available and
   stop at `READY_FOR_MANUAL_MERGE`.

Rollback is one code commit revert. There is no storage, data migration, rollout flag or enablement gate.

## 7. Canonical current verdict

```text
REVIEW_POLICY_VERSION: 1.3
REVIEW_VERDICT: CODE_READY
REVIEWED_AT: 2026-07-22
AUTHORITY_SHA: 827d24d17e7004c15f277fb8a53f0cb7d90f6547
BASE_BRANCH: main
TARGET_FILES:
  - docs/decisions/analysis/dd-87-splitnameamount-decision-table-analysis.md
  - docs/standards/decisions.md
  - docs/autopilot-manifests/core-matcher-grouped-amount-parsing.json
  - docs/autopilot/contracts/autopilot-core-split-name-amount-ambiguity-contract.md
  - .claude/commands/ap-29-core-split-name-amount-ambiguity-contract.md
  - docs/autopilot-backlog.md
  - docs/slice-readiness-verdicts.md
  - docs/auth/auth-s4-session-handoff.md
SLICE: core-matcher-grouped-amount-parsing
IN_SCOPE: splitNameAmount exhaustive tagged-union ambiguity contract and exact unit assertions
OUT_OF_SCOPE: all transports, DB/migrations, ledger mutation, classifyAmount/FIFO and consumer picker implementation
G1_DECISION: PASS
G2_SPEC: PASS
G3_DEPENDENCY: PASS
G4_TEST: PASS
G5_SCOPE: PASS
G6_EXTERNAL: PASS
HARD_DEPENDENCIES: none -- this slice is its own root dependency; authority packet committed/pushed on main
PRIOR_SLICES: none
OPEN_QUESTIONS_IN_SCOPE: 0
ENABLEMENT_ONLY_GATES: none
LIVE_REPO_VERIFICATION: PASS
CONTRACT_MATRIX: PASS
CLOSURE_MATRIX: PASS (12/12)
ACCEPTANCE_MATRIX: PASS
SECURITY_AND_MIGRATION_GATE: PASS
IMPLEMENTATION_ARTIFACTS: PASS (committed and pushed on origin/main@827d24d)
FIRST_IMPLEMENTATION_STEP: open a dedicated worktree from origin/main@827d24d; then AP-29 design probe
REMAINING_BLOCKERS: none
NEXT_REVIEW_TRIGGER: n/a -- CODE_READY; see docs/slice-readiness-verdicts.md Verdict 16
```
