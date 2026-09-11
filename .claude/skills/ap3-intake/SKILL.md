---
name: ap3-intake
description: Score a feature or task against the project's feature-readiness rubric and produce a numbered gap list the owner answers. Tier 1 of DESIGN-v2-product-flow.md. Invoked by the owner as `/ap3-intake <feature-slug-or-free-text>` or `/ap3-intake <slug> --apply`; never runs headless.
---

# ap3-intake — the readiness gate

You are answering one question for the owner: is this feature's documentation complete enough
that a headless writer could implement a slice of it without ever having to guess? You read docs
and code, you never invent facts, and you stop the moment you have questions instead of guessing
an answer.

This skill is interactive only — it is loaded when the owner types `/ap3-intake`, never by the
ap3 dispatcher. It writes only inside `ap3/features/<slug>/` and, in the `--apply` round, the
exact doc files the owner approved.

## First: find the rubric

`docs/standards/feature-readiness.md` must exist (`ap3/install.sh` copies a generic starter
template there only if the repo has none). If it is absent, STOP and tell the owner: no rubric,
no gate — running `ap3-intake` without one would mean inventing your own bar for "ready," which
defeats the point. Parse it once with `python3 ap3/aplib.py rubric docs/standards/feature-readiness.md`
— its `items` are the exact list you score below; do not add or drop items on your own judgement.

## Steps (score round — `/ap3-intake <slug-or-free-text>`)

0. **Validate the slug before touching a path or a git ref with it.** Once you have resolved a
   slug (your own choice in step 1, or one the owner typed), it MUST match
   `^[a-z0-9][a-z0-9-]{2,60}$` — the exact grammar `aplib.py` already enforces for a task slug.
   Refuse and ask the owner to clarify if it does not; never interpolate an unvalidated slug into
   `ap3/features/<slug>/`, a branch name, or a worktree path — a slug containing `..` or `/`
   could otherwise escape the feature directory entirely.

1. **Resolve the feature.** If given a slug, look for `docs/features/FE/feature_<slug>.md` and
   its `BE/feature_<slug>_tech.md` pair. If given free text instead, launch an Explore sub-agent
   to search `docs/features/**` for the closest matching spec pair. If nothing matches either
   way, STOP and ask the owner which feature they mean — do not guess a slug.

2. **Gather evidence, in parallel, with Explore sub-agents** (one per area, so a broad search in
   one area never limits how thoroughly another is read):
   - the FE spec and BE tech spec pair themselves;
   - the PRD's matching flow/section;
   - the project's TDD, the sections the rubric or the specs point at;
   - every decision ID (`DD-xxx` or equivalent) the specs cite, and its current status in the
     project's decisions doc;
   - the code surface the feature already touches — routes, services, existing tests — via
     GitNexus (`mcp__gitnexus__*`) when the project is indexed, else targeted grep.
   Each sub-agent reports findings as `file:section -> quote or fact`, never a bare verdict — you
   do the scoring yourself from their evidence, in the next step.

3. **Score every rubric item PASS / GAP / N/A**, each with the exact `file:section` that decided
   it. An item the docs simply do not address is a GAP — never infer PASS from code alone, and
   never infer GAP-because-Draft when the owner has already accepted a Draft spec in a prior
   `INTAKE.md`. N/A needs a one-line reason (why the item does not apply to this feature/task).

4. **Work from an isolated worktree before writing anything, never the owner's own checkout.**
   `git checkout -b` in place would switch the owner's OWN session to a different branch out from
   under them and can carry along any uncommitted work they had in progress. Instead:

   ```bash
   git fetch origin main
   git worktree add ap3/state/worktrees/intake-<slug> -b docs/intake-<slug> origin/main
   # if that worktree/branch already exists from an earlier round for this feature:
   #   cd ap3/state/worktrees/intake-<slug> && git pull
   ```

   Do every write below — the score round's `INTAKE.md`, and the answer round's doc edits — with
   that worktree directory as your cwd; the owner's own working directory is never touched. The
   answer round below continues in this SAME worktree, so `INTAKE.md` and any later doc edits
   always live together on the one branch. `ap3/state/` is already gitignored, so the worktree's
   own location is never itself tracked — only the commits made from inside it, on the real
   `docs/intake-<slug>` branch, matter. Then **write `ap3/features/<slug>/INTAKE.md`** (create the
   directory if needed) — a plain `git rev-parse HEAD` here already equals the pre-existing
   `origin/main` tip this worktree was just cut from, since nothing has been committed yet in this
   session; no separate commit is needed for `base_sha` to make sense in THIS round (contrast the
   answer round below, where NEW doc edits mean `base_sha` has to reference a commit that does not
   exist yet when you start):

   ```markdown
   ---
   feature: <slug>
   readiness_version: <the rubric's own readiness_version, or null if it has none>
   status: NOT_READY | READY_FOR_PLAN | READY_WITH_SUPERVISED_SLICES
   measured_at: <UTC ISO timestamp>
   base_sha: <git rev-parse HEAD>
   sources:
     - docs/features/FE/feature_<slug>.md
     - docs/features/BE/feature_<slug>_tech.md
     - docs/standards/feature-readiness.md
     - standards/decisions.md
   ---
   ## Rubric

   | id | gate | verdict | decided by | note |
   |----|------|---------|------------|------|
   | R1.1 | hard | PASS | docs/product/ROADMAP.md#phase-2 | |
   | R4.1 | hard | GAP | standards/decisions.md#DD-118 | still `proposal` |
   ...

   ## Questions

   1. (R4.1) DD-118 is still `proposal` — finalize it as written, or does the session-timeout
      value change? Proposed answer: keep as written, mark FINAL.
   2. (R6.1) ...

   ## Decisions to finalize

   - DD-118

   ## Answers
   <!-- the owner edits below this line, or dictates answers in chat and you write them here
        verbatim before the --apply round reads them -->
   ```

   `sources:` is the exact, complete list of repo-relative doc paths step 2's evidence-gathering
   actually read from (the FE/BE spec pair, the rubric, `decisions.md`, and any PRD/TDD/checklist
   file a rubric item or a spec cites) — not a fixed boilerplate list. `/ap3-plan` diffs exactly
   these paths to decide whether this intake is stale (see its own "Refuse first" section); a path
   missing from `sources:` is a path whose later changes `/ap3-plan` will never notice, so list
   everything you actually relied on, not just the FE/BE pair.

   Compute `status` with `python3 ap3/aplib.py intake-score docs/standards/feature-readiness.md
   <evidence.json>` (build `evidence.json` as `{"<id>": "PASS|GAP|N/A", ...}` from your own step-3
   scoring) — do not hand-derive NOT_READY vs READY_WITH_SUPERVISED_SLICES yourself; that mapping
   is the tested, deterministic part of this skill and must come from the tool, not your own
   arithmetic.

5. **Stop and print every numbered question** (or, if `status` is not `NOT_READY`/
   `READY_WITH_SUPERVISED_SLICES` with open questions, print the status and the `INTAKE.md` path).
   Do not proceed to planning yourself — that is `/ap3-plan`, a separate, later invocation.

## Steps (answer round — `/ap3-intake <slug> --apply`)

1. Read `ap3/features/<slug>/INTAKE.md` § Answers. If the owner dictated answers in chat instead
   of editing the file, write them into § Answers yourself first, verbatim, and show the owner
   the file before continuing — the record of what was decided lives in the file, not the chat.
2. For each answered question, propose the exact doc edit (FE/BE spec, `decisions.md`, etc.) as a
   unified diff. **Never edit a decision's status line to `FINAL` without the owner's explicit
   yes on that exact edit** — a DD becomes final only by the owner's own hand, never inferred from
   "they answered the question so they must mean yes."
3. Apply only the edits the owner approved, in the same `ap3/state/worktrees/intake-<slug>`
   worktree (branch `docs/intake-<slug>`) the score round already created. **This is TWO SEPARATE
   commits, in this exact order — never one:**
   1. Commit the doc edits ALONE (FE/BE spec, `decisions.md` — never `INTAKE.md` itself in this
      commit). Record `SHA_A = git rev-parse HEAD` — this is the new `base_sha`.
   2. Re-run step 3 of the score round for every item touched by an approved edit (not the whole
      rubric — only what changed), rewrite `INTAKE.md`'s frontmatter/table/status with
      `base_sha: <SHA_A>`, and commit `INTAKE.md` by itself, as a SECOND, separate commit.

   **Why two commits, not one (review round 5, security):** `base_sha` is supposed to identify the
   commit whose CONTENT was scored. A commit's own sha is a hash of its content — so a commit
   cannot contain, inside itself, its own sha; recording `git rev-parse HEAD` for a commit that
   also holds `INTAKE.md`'s frontmatter is self-referential and impossible to get right. Committing
   the doc edits first makes `SHA_A` a real, already-existing value by the time `INTAKE.md` is
   written to reference it — there is no chicken-and-egg problem once the two are split.
4. Print the branch name, the worktree path, and the changed files. **You never push or open a
   PR** — that choice, and its governance, belongs to the owner. If `status` is now
   `READY_FOR_PLAN` or `READY_WITH_SUPERVISED_SLICES`, say so and tell the owner plainly:
   **`/ap3-plan` cannot start until this PR is merged into `origin/main`** — its own staleness
   check (see `ap3-plan/SKILL.md`) diffs the merged content, not this branch directly.

## Fail-closed rules

- Validate `<slug>` against `^[a-z0-9][a-z0-9-]{2,60}$` before it touches any path or git ref.
- Work from `ap3/state/worktrees/intake-<slug>` before the first write, score round or apply
  round alike; never write in the owner's own working directory, even transiently.
- No `docs/standards/feature-readiness.md` -> refuse to score anything.
- Any R1-R5 item scored GAP -> overall `status` is `NOT_READY`, whatever R6-R8 say.
- Never infer a PASS from code alone; the rubric item must name the doc section that decided it.
- Never write a decision to `FINAL` except through the owner's explicit approval of that exact
  edit in the answer round.
- Re-running the score round always re-scores every item fresh from current docs — `INTAKE.md` is
  a snapshot at `base_sha`, never a cache you trust across a re-run.
