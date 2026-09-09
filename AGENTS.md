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

<!-- feature-doc-templates:start -->
# Feature doc templates — two LAYERS, not two options

`docs/templates/feature-spec-template.md` and `docs/templates/feature-dev/fe-spec-template.md` are
**not duplicates**; they are consecutive layers. Choose by *what you are writing*, never by which one
looks more complete.

| Writing | Template | Destination | Precondition |
|---|---|---|---|
| A new feature (behavior + contract) | `docs/templates/feature-spec-template.md` (7 sections) | `docs/features/FE/feature_{name}.md` | always paired with BE |
| The BE side of that same feature | `docs/templates/be-tech-spec-template.md` (6 sections) | `docs/features/BE/feature_{name}_tech.md` | **one feature = one pair**, no orphans (current inventory: 26 pairs) |
| One specific web screen | `docs/templates/feature-dev/fe-spec-template.md` (11 sections) | `docs/channels/web/FE/feature_{name}_fe.md` | **only after** the Product spec is Reviewed |
| Build-time tracking | `docs/templates/feature-dev/feature-checklist.md` | — | — |

**The FE Design spec is downstream, not a parallel FE copy.** Its header must pin
`Source authority: features/FE/feature_{name}.md v{version} · baseline {40-char SHA}` — with no Reviewed
Product spec there is nothing to pin, so it must not be written yet. The Product/UX spec covers **every
channel** (web · Zalo · Messenger · notification); the FE Design spec covers `apps/web` only. That is why
26 Product specs map to 17 FE specs and **the mapping is not 1:1** — never create extra files to "complete
the pairs".

**`docs/templates/feature-docs-playbook.md` is NOT a template.** It sits in the same directory and is easy
to copy by mistake, but it is a Sporta port, status *"Reviewed — Active once Adoption B0+B1 completes"*
(**not Active**), and it describes a structure this repo does not use: FE with 10 sections (including API
Endpoints · Error Codes · Caching, which Plexco places in the BE spec), the status enum
`Draft|In Review|Approved|Superseded`, and a `docs/Phase {N}/` layout. Only its *governance* rules were
absorbed into `docs/features/README.md` v2.33 (`Reviewed` ≡ `Approved`, three-way gate). Read it for the
rules; never copy it as a skeleton.

> WARNING: do not cite `docs/research/template-comparison-2026-08-14.md` as grounds for deferring the FE
> spec layer. Its §2.1 and T6 state that the FE Design template has *"no instances written yet"* — false
> at the time of writing: 17 `docs/channels/web/FE/*_fe.md` files were committed on **10–11 Aug**, three to
> four days earlier. The rest of that document still holds; that one premise is rotten.

## Missing sections FAIL THE GATE — they are not "missing prose"

**Product/UX spec** — all three are subsections, so the 7-section count is **unchanged**:

- `### Entry points` inside §1, placed before `### Bất biến`. Table `Entry | Route / Surface | Actor | Mô tả`,
  listing every surface: route · tab · deep link · bot command · notification.
- The use-case table has **5 columns**: `ID | Actor | Hành động | Để… (benefit) | Kết quả`. A benefit that
  merely restates the action means the use case has no reason to exist. Already-`Reviewed` specs are
  **not retrofitted** — add the column the next time the spec is edited.
- `### NFR compliance` at the end of §6, pointing **back** to `docs/product/BRD.md` §8 and the NFR table in
  `docs/product/TDD.md`. Never define a new NFR here and never build a third catalog. If the feature touches
  no NFR, write `none` plus the reason: an empty table cannot distinguish "considered, not applicable" from
  "never considered".

**FE Design spec:**

- **§8–§11 must exist** (`DD-99` P1 gate) even if their only content is `TBD`. Template v0.4 shipped without
  all four and produced five specs on 11 Aug — `booking_funnel` · `club` · `club_assistant` ·
  `session_organize` · `tournament` — at 0/4, none of which can be promoted to this day. **Never delete an
  empty heading.**
- A `#### Error mapping` table for **every screen**, with codes copied verbatim from that feature's BE tech
  doc and closed by an unknown/missing/timeout **fail-closed** row. Prose saying "fails closed" does not
  replace the table. If BE has not pinned a catalog, write `UNPINNED error catalog — omit active UI` and
  **never invent codes**.
- The i18n column carries **real string pairs** `t("vi", "en")` (HARD RULE 5). This repo has no key-based
  i18n: `t('some.key')` resolves to nothing and no locale file exists in the tree.
- A field with no owner DTO gets `UNPINNED — omit active UI`. Wireframe fixtures are never implementation
  authority.
- Keep **exactly one** Responsive table (dashboard-shell with sidebar · player-facing 375 + desktop) and
  delete the other. Intermediate breakpoints on player-facing surfaces belong to F0 design authority —
  do not invent numbers.

## Volume floors — take the HIGHER number

> RESOLVED 2026-08-25: `feature-spec-template.md` §2 now says `Minimum 10 use cases`, matching the
> review gate floor of `≥10 UC` in `docs/features/README.md` — the 8-vs-10 mismatch measured by the
> 24/08 audit (V7) is closed at the source.

Product/UX: **≥10 use cases** · ≥10 edge cases across 4+ categories.
BE: ≥12 edge cases across 6 categories · ≥20 unit tests · ≥4 integration tests · ≥3 scenarios per status.
Any feature touching money, auth, or PII additionally requires a **decision table** for every money and
permission branch, plus abuse cases.
Floors are a necessary condition, never a target — hitting the numbers does not by itself pass review.
<!-- feature-doc-templates:end -->

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
   writing, passing the **runtime manifest**, never the authored contract:
   `scripts/autopilot-scope-gate register --manifest .autopilot/state/<feature>/manifest.json`
   (hand-write that file from `docs/autopilot-manifests/_TEMPLATE.json` first — it carries
   `manifest_schema_version: level3-operational-v2`, which the authored contract at
   `docs/autopilot-manifests/<slug>.json` is forbidden to carry). Passing the authored path is
   `HALT CONTRACT_INVALID`, checked on the branch's first statement before `INFLIGHT.md` is touched
   or any state dir is created (measured 2026-08-21 at KIT_VERSION 31;
   `grep -n 'CONTRACT_INVALID' scripts/autopilot-scope-gate`). After every register, confirm
   `.autopilot/state/<feature>/registered-manifest.sha256` exists before doing anything else — do not
   trust the printed word `registered`. Never hard-pin the kit version in prose; read it with
   `awk '/^# KIT_VERSION:/{print $3; exit}' scripts/autopilot-scope-gate` (a hand-copied `10` was
   already stale against an installed `11`). The root worktree stays on `main`. Slices sharing a
   migration, stateful invariant, or generated artifact are serialized, never parallelized.
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

<!-- ap3-workflow:start -->
# ap3 lane — dispatcher-started runs (DD-120, proposal, from 2026-09-09)

A named, conditional exception to the Level 3 section above. It applies only when this session was
started by `ap3/dispatch.sh` — detectable by the environment variables `AP3_SLUG`, `AP3_TASK`,
`AP3_BASE_SHA`, `AP3_STATE`. Without those four variables the Level 3 section above applies unchanged.

- **Procedure** = `.claude/skills/ap3-slice/SKILL.md` (kit `ap3/` installed from `Claude template`;
  contract mirror: `docs/autopilot-templates/ap3-workflow.md`). No `scope-gate register`, no runtime
  manifest, no `READY.txt`. READY = **an open pull request** on branch `ap3/<slug>` with `verify` green,
  `AP3_REVIEW_VERDICT: CLEAN`, and the evidence row the dispatcher pushes onto the branch.
- **The writer only writes code: it never reviews, pushes, or opens a PR** (corrected 2026-09-09 by
  measurement: `codex` cannot initialize inside the Seatbelt sandbox — `W1-DECISION-codex-sandbox.md` in
  the `Claude template` repo). The writer stops at `.ap3-run/READY-FOR-REVIEW`. The **dispatcher**
  (launchd bash, unsandboxed) then runs an independent scope-check, `ap3/review.sh code` (plus
  `security` when the heuristic fires), and **only on CLEAN** pushes the branch, creates the PR and
  appends the evidence row. On findings under the round cap it writes `.ap3-run/REVIEW-FINDINGS.md` and
  restarts a fix writer; at the cap it is `HALT MAX_ROUNDS` and the class is paused. A PR exists only
  after a clean review, and the writer can neither see nor influence the reviewer.
- **Authority to write code** = the task file `ap3/queue/<slug>.md` (passed `bash ap3/lint-task.sh`,
  present on `origin/main`) **plus** an `enabled` class in `ap3/routines.json` (owner-edited only).
  No verdict block in `docs/slice-readiness-verdicts.md` is required for such a class — that is DD-120.
- **Never ask a human.** The session is headless and `AskUserQuestion` is denied. Missing context or a
  decision → write `.ap3-run/HALT.md` with `MISSING_CONTEXT` and the exact question; open no PR. A needed
  file outside `scope` → `HALT SCOPE_DRIFT`. The countable boundary is
  `git diff --name-only $AP3_BASE_SHA..HEAD` ⊆ `scope`.
- **Every other repo rule stays in force:** the 5 HARD RULES; independent review still through the
  same `scripts/codex-review-pin.sh` (invoked by the dispatcher via `ap3/review.sh`, not by the writer);
  a security round when the diff touches auth/secret/permission/money/external input; GitNexus
  `gitnexus_impact` before editing a symbol and `gitnexus_detect_changes()` before committing; the
  `pnpm review:check:changed` hook; agent-facing text in English; the repo's commit-message convention.
- **CI is the last gate before merge.** A PR opened by ap3 triggers `.github/workflows/ci.yml`
  (`pull_request:`): typecheck, format, `review:check`, lint, build and `pnpm -w test` against a
  Postgres service. Do not merge an ap3 PR while CI is red, even with a CLEAN Codex verdict — CI is the
  only test execution not self-reported by the writer (`W1-KNOWN-GAPS.md` §1).
- **Deliberately narrow:** only classes listed in `ap3/routines.json` (currently `code-quality-p2`).
  P0/P1, schema/migration, auth, money, i18n strings, and any slice that already has a verdict in
  `docs/slice-readiness-verdicts.md` stay on the supervised Level 3 path above. Any HALT/crash/closed
  PR/hand-edit before merge pauses the class; re-enabling is a deliberate owner commit to `routines.json`.
- **Operations:** `ap3/README-W2.md` (owner) · kill switch `touch ap3/PAUSED` · runtime state
  `ap3/state/` (gitignored) · evidence `ap3/evidence.jsonl` (reaches `main` through the run's own PR).
<!-- ap3-workflow:end -->

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **plexco-app** (7523 symbols, 9070 relationships, 96 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope.

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
