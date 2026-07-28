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
10. Every persisted review/readiness artifact must declare its machine classification, include `REVIEW_POLICY_VERSION` and `CLOSURE_MATRIX`, and pass `pnpm review:check:changed` before verdict/commit. A final implementation plan/coding handoff MUST use `<!-- review-readiness: code-ready -->`; the validator must reject it unless every active verdict is strict `CODE_READY`. `enforce` may preserve a draft/blocker audit but can never authorize coding. A failing validator is a hard stop; historical exemptions cannot authorize current work.

These rules are repo policy and apply even when the user only says "review", "check", "updated", "fix", "final", or asks whether a plan can start coding.
<!-- review-code-readiness:end -->

<!-- level3-workflow:start -->
# Default workflow — Level 3 supervised autonomy

```text
WORKFLOW_LEVEL: 3
WORKFLOW_MODE: supervised_autonomy
HUMAN_ROLE: manager_of_managers
DEFAULT_STOP_MODE: STOP_AT_READY
AUTO_MERGE: off
```

Every task/session/feature opened **after** this kit was installed runs on
`docs/autopilot-templates/level3-workflow.md` (canonical contract, mirrored from `Claude template`).
An already-running session keeps its existing contract — forward-only, never migrated in place.
Operational entry point: `docs/autopilot-ONBOARDING.md`.

1. Before implementing, the primary agent resolves the **task contract** (`level3-workflow.md` §3):
   outcome, repository and base, context sources, applicable skills, scope and negative scope, risk
   P0–P3, autonomy mode, model policy, sandbox and permissions, human decisions, slice graph,
   worktree plan, verification, code and security review, budgets, stop conditions, deliverables.
2. The primary agent pulls its own context (code + `docs/features/*` + `docs/standards/decisions.md`),
   decomposes the outcome, delegates and monitors child agents, then integrates and verifies the
   whole result. It does not ask the owner to route every step.
3. **One writing slice = one branch + one worktree + at most one live writer.** Register before
   writing: `scripts/autopilot-scope-gate register --manifest docs/autopilot-manifests/<slug>.json`
   (KIT_VERSION 10, fail-closed). The root worktree stays on `main`. Slices sharing a migration,
   stateful invariant, or generated artifact are serialized, never parallelized.
4. Verify with the repo's real commands (`pnpm test` with `DATABASE_URL_TEST`, build, lint,
   typecheck, e2e when a real boundary is crossed), then the mandatory independent review through
   `scripts/codex-review-pin.sh`; a slice touching auth, secrets, permissions, money, external
   input, or deployment gets an extra security round. If the reviewer cannot run, emit
   `HALT TOOL_UNAVAILABLE` — never silently downgrade the gate. Prose is not evidence.
5. Finish at **`READY | AWAIT | HALT`**. `READY` means the exact diff, gate executed directly, and a
   clean review. `AWAIT` means exactly one missing external decision, context, or authority, with a
   recommended option and a binary resume condition. `HALT` means a hard breaker (`MAX_ROUNDS` past
   five rounds, `REGION_THRASH` on the same region three rounds running).
6. The owner keeps outcome, priority, policy, budget, material product decisions, exceptions, and
   merge/deploy authority.

**Level 3 does not imply auto-merge.** P0 stays prepare-only until the owner grants execution
authority, P1 stays supervised, and `proactive_routine` is earned by a narrow class after repeated
clean runs — never enabled by default. Agent counts in the source model illustrate scale; they are
not acceptance criteria, and a small task needs no artificial fan-out.

The review/readiness gate above applies in parallel and the **stricter rule wins**: docs, plans, and
specs still go through `docs/standards/review-code-readiness-gate.md` and `pnpm review:check:changed`.
<!-- level3-workflow:end -->

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
