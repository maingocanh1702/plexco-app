<!-- review-code-readiness:start -->
# Review / Plan Readiness — mandatory for every session

For every session that reviews, reconciles, fixes, or finalizes docs, decisions, specs, plans, or readiness:

1. **MUST read** `docs/standards/review-code-readiness-gate.md` before editing or issuing a final verdict.
2. **MUST use** `docs/templates/review-doc-plan-session-template.md` as the execution/output template; do not improvise a weaker review format.
3. **MUST verify live repo truth** (current base/commit, schema, migrations, code, grants/RLS, tests, dependent specs); prose alone is never sufficient.
4. **MUST keep status boundaries explicit:** `DECISION_FINAL` ≠ `PLAN_READY` ≠ `CODE_READY` ≠ `ENABLE_READY` ≠ `IMPLEMENTED`.
5. **MUST pin authority by commit SHA + exact target files.** Never invalidate a reviewed slice merely because an unrelated global decision version advanced; re-open only the affected blast radius.
6. **MUST finish with the canonical verdict block** from the gate file. `CODE_READY` requires G1–G5 PASS, G6 PASS/named enablement-only, the 12/12 closure matrix, `OPEN_QUESTIONS_IN_SCOPE: 0`, merged hard dependencies (or the slice is the root dependency), a complete acceptance matrix, and an executable first slice.
7. If not ready, return `NOT_PLAN_READY` or `NOT_CODE_READY` with the exact blocker, owner, binary resolution condition, and `NEXT_REVIEW_TRIGGER`; do not end with vague wording such as "almost final" or repeat an unbounded polish loop.
8. A later-phase or enablement-only question may remain open only when current behavior and negative scope are pinned and it cannot affect the slice being authorized.
9. Never call docs/contracts runtime proof. Code, migration, tests, deployment, and production E2E require separate evidence.

These rules are repo policy and apply even when the user only says "review", "check", "updated", "fix", "final", or asks whether a plan can start coding.
<!-- review-code-readiness:end -->

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **plexco-app** (2994 symbols, 3635 relationships, 40 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> Index stale? Run `node .gitnexus/run.cjs analyze` from the project root — it auto-selects an available runner. No `.gitnexus/run.cjs` yet? `npx gitnexus analyze` (npm 11 crash → `npm i -g gitnexus`; #1939).

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows. For regression review, compare against the default branch: `detect_changes({scope: "compare", base_ref: "main"})`.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `query({search_query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `context({name: "symbolName"})`.
- For security review, `explain({target: "fileOrSymbol"})` lists taint findings (source→sink flows; needs `analyze --pdg`).

## Never Do

- NEVER edit a function, class, or method without first running `impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `rename` which understands the call graph.
- NEVER commit changes without running `detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/plexco-app/context` | Codebase overview, check index freshness |
| `gitnexus://repo/plexco-app/clusters` | All functional areas |
| `gitnexus://repo/plexco-app/processes` | All execution flows |
| `gitnexus://repo/plexco-app/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->
