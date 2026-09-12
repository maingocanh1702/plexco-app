---
name: ap3-plan
description: Turn a READY intake into milestones, slices and lint-clean ap3 queue tasks. Tier 2 of DESIGN-v2-product-flow.md. Invoked by the owner as `/ap3-plan <slug>`; never runs headless. Merging the resulting PR is what actually queues the feature for tier 3.
---

# ap3-plan — turn readiness into a queue

You turn an already-READY intake into the exact set of slices a headless writer can execute one
at a time. You do the impact/risk/test-mapping analysis; the mechanical, testable part — turning
your decisions into lint-clean queue files — is `python3 ap3/aplib.py plan-emit <plan.json>`, not
your own hand-editing. This skill is interactive only; the dispatcher never loads it.

## Refuse first

**Prerequisite the owner must have already done: merge the `docs/intake-<slug>` PR into
`origin/main`.** `/ap3-plan` reads only `origin/main` (like every headless-facing part of ap3) —
if you can see the owner's approved intake answers only on the still-open `docs/intake-<slug>`
branch, that is not planning against origin/main yet, and the check below is DESIGNED to refuse
in exactly that case. Tell the owner to merge it first if this is why you refused.

Validate `<slug>` (`^[a-z0-9][a-z0-9-]{2,60}$`) before it touches any path or git ref — the same
rule as ap3-intake's, for the same reason (an unvalidated slug could escape
`ap3/features/<slug>/` via `..` or `/`).

**Read `INTAKE.md` from the fetched `origin/main`, never from the local working directory**
(review round 5, security: reading a local file would let a not-yet-merged, or locally-edited,
`INTAKE.md` satisfy every check below — a still-open `docs/intake-<slug>` branch simply checked
out in the owner's own working directory looks, to a naive local file read, exactly like the
merged state):

```bash
git fetch origin main
git show origin/main:ap3/features/<slug>/INTAKE.md
```

If that path does not exist on `origin/main` at all, refuse — the intake was never merged.
Otherwise parse ITS frontmatter/body (not a local copy) for everything below. Refuse and stop,
telling the owner why, unless BOTH hold:

- its `status` is `READY_FOR_PLAN` or `READY_WITH_SUPERVISED_SLICES`;
- `git fetch origin main`, then **none of `INTAKE.md`'s own `sources:` paths differ** between
  `base_sha` and the fetched `origin/main` tip:
  `git diff --quiet <base_sha> origin/main -- <every path in sources:>`.
  Two things that do NOT work, and why: **(a) ancestry alone** (`git merge-base --is-ancestor
  <base_sha> origin/main`) can never detect staleness — a past `base_sha` is *always* still an
  ancestor of a later `origin/main` (history only grows forward), so once that check passes it
  can never fail again. **(b) exact SHA equality** self-invalidates the very case it needs to
  allow: once `docs/intake-<slug>` (carrying the owner-approved edits `/ap3-intake --apply` made)
  merges, `origin/main`'s tip necessarily moves to a NEW commit, so `base_sha` can never equal it
  again — planning would be refused forever after the one merge that was supposed to unblock it.
  A **content diff scoped to the recorded `sources:` paths** is immune to both: right after the
  intake's own merge, that merge changed exactly those paths to what was already scored, so the
  diff between the old (`base_sha`) and new (`origin/main`) content of those paths is empty — but
  BEFORE that merge, `origin/main` still has the OLD content, so the diff is genuinely non-empty
  and the check correctly refuses (this is the prerequisite above, enforced mechanically, not just
  by instruction). It still correctly catches a **later, unrelated** commit that touches one of
  those same paths after the intake was scored, whether or not that commit had anything to do with
  this feature. If `sources:` is missing or empty, refuse — an intake that does not say what it
  read cannot be checked for staleness at all.

## Before writing anything: an isolated worktree

Never run `git checkout -b` in the owner's own working directory — it would switch their session
to a different branch out from under them and can carry along any uncommitted work they had in
progress. Instead, before step 5's first write:

```bash
git fetch origin main
git worktree add ap3/state/worktrees/plan-<slug> -b plan/<slug> origin/main
# if that worktree/branch already exists from an earlier round for this feature:
#   cd ap3/state/worktrees/plan-<slug> && git pull
```

Do steps 5-8 with that worktree directory as your cwd. Steps 1-4 are read-only analysis and may
happen before or after this `worktree add`, but nothing that writes may happen anywhere else.

## Steps

1. **Analyze, in parallel, with sub-agents** (each reports facts with file:line, not a plan of
   its own — you make the slicing decisions from their findings):
   - **Impact**: `mcp__gitnexus__impact` / `detect_changes` when the repo is indexed, else a
     targeted grep, to find every existing file the feature's FE/BE specs imply touching.
   - **Test-plan mapping**: the BE spec's testing-plan rows (or the readiness checklist's rows,
     when a project keeps one) against tests that already exist — which rows have no test today
     (RED candidates) and which behaviour already has coverage.
   - **Risk**: does any touched surface cross auth, RLS/row-level security, permissions, or
     money/pricing? That makes the slice (and usually the whole feature) `risk: P1` and forces
     `security_review: always` on its class. Everything else defaults to `P2`.
   - **Registration points**: every place a new command, route, error code, or status value must be
     REGISTERED before its own consumers can see it — barrel/index exports, error-code or
     action-class registries, status/message tables, rate-limit bucket contracts, route manifests.
     Impact analysis above finds the files that HOLD the new logic; this finds the separate files
     that make it REACHABLE. A slice whose `scope` omits the registration file can only halt
     `SCOPE_DRIFT` once the writer discovers it needs to touch it (a real pilot hit this twice --
     $2.67 and $3.25 -- for exactly this reason, on a command and a route respectively). Put every
     registration file this feature needs into scope up front, in the slice that adds the thing
     being registered.

2. **Design milestones and slices.** A milestone is a coherent, shippable increment (M1, M2, ...);
   each ends with one slice that finishes it. Order slices so behaviour lands in the smallest
   possible increments: the first slice of a class (or of a milestone) that class has never run
   before should be the SMALLEST slice that turns one already-failing test green. There is no
   separate "test-only, stays red" slice type — `ap3-slice/SKILL.md` requires every slice's own
   `verify` to pass (GREEN) before it can finish, so a slice scoped to test files only, with no
   production code to make it pass, could never reach READY; it would halt `VERIFY_FAIL` every
   time. RED still happens, inside that one slice's own RED-then-GREEN cycle (ap3-slice steps 2-3
   already do this for every slice) — proving R2.2's "real RED" claim does not need a slice of its
   own. This smallest-first slice is how the trust ladder starts for that class/milestone
   combination: watch its review rounds and cost closely before trusting the rest of the milestone
   to run unattended. Rules you enforce yourself (not lint-checked): about 5 files or fewer per
   slice; one concern per slice; sibling slices in the same milestone keep disjoint `scope`
   wherever the code allows it (say so in `PLAN.md` when it does not, so the owner knows they must
   run serially).

3. **Mark `supervised: true`, with a one-line reason, for a slice instead of writing it into the
   plan's queue set** when it: needs a schema migration, adds or changes a user-visible string
   (i18n), touches a page/display component/design tokens (UI/UX), **or came out of step 1's risk
   analysis as `P1` or `P3`.** Today's task lint only auto-dispatches `risk: P2` — a P1/P3 slice
   would fail lint as a queue file regardless of how carefully it is scoped, so treat it as
   supervised (a human runs it, same as a migration) rather than emitting a task that cannot pass.
   Say in `PLAN.md` which later slice must wait for each supervised one to land. `plan-emit`
   enforces this mechanically: it refuses to emit ANY slice after a supervised one until that
   supervised slice's `plan.json` entry carries `"landed": true` AND a companion `"landed_sha"`
   (a 7-40 char hex commit id). Never set `landed: true` yourself on the owner's behalf, and never
   invent a `landed_sha` — both come from the owner telling you the exact commit. **Before writing
   either into `plan.json`, verify `landed_sha` yourself**: `git fetch origin main && git
   merge-base --is-ancestor <landed_sha> origin/main`. `plan-emit` cannot do this verification
   itself (it has no git access at all, by this kit's own design — git/network checks live
   outside `aplib.py`); a `landed_sha` that merely LOOKS like a commit id is not proof it is real,
   so the check has to happen here, in the one place that can run `git`. **`plan-emit` has no
   memory across invocations** (review
   round 4: an earlier version of this skill suggested splitting a blocked milestone across two
   separate `plan-emit` runs, which silently lost the `after:` chain and the `milestone: true`
   marker for whatever came after the split) — if a milestone contains a not-yet-landed supervised
   slice, do not emit ANY of that milestone's dispatchable slices yet, even the ones that come
   before it and don't themselves depend on it. Wait until the owner confirms the prerequisite has
   landed, then submit the WHOLE milestone (every one of its slices, dispatchable and supervised
   alike, with `landed: true` now set) in one single `plan-emit` invocation.

4. **Pick `model:` per dispatchable slice**, per the class/model rule
   (`DESIGN-v2-product-flow.md` §6): a single-package, test-only, or pure-refactor slice ->
   `claude-sonnet-5`; a slice crossing packages, touching authz/RLS/money, or needing invariant
   reasoning -> `claude-opus-5`. Omit `model:` to accept the class's own `writer_model` default
   instead of pinning one.

5. **Write `ap3/features/<slug>/PLAN.md`**: one section per milestone, each slice (dispatchable
   or supervised) listed with the PRD acceptance row(s) it satisfies, its `scope`, and — for a
   supervised slice — the reason and which slice must wait for it.

6. **Build `plan.json`** (a scratch file, not committed) from the same decisions:

   ```json
   {
     "feature": "<slug>",
     "slices": [
       {"slug": "<slug>-m01-expiry-check", "milestone": 1, "class": "...", "risk": "P2",
        "scope": ["...", "test/..."], "verify": "npm test -- ...", "budget_usd": 8,
        "max_review_rounds": 3, "model": "claude-sonnet-5",
        "problem": "...", "acceptance": "a new test pins the behaviour and passes",
        "context": "..."},
       {"slug": "<slug>-m01-expiry-cleanup", "milestone": 1, "class": "...", "risk": "P2",
        "scope": ["...", "test/..."], "verify": "...", "budget_usd": 10, "max_review_rounds": 3,
        "problem": "...", "acceptance": "...", "context": "..."},
       {"slug": "<slug>-m01-migration", "milestone": 1, "supervised": true,
        "reason": "adds sessions.expires_at — schema migration, owner runs by hand"}
     ]
   }
   ```

   Each dispatchable slice is fully self-contained (its own RED, inside its own GREEN, inside its
   own scope) — never a scope-limited "just the test" slice with a companion "just the
   implementation" slice for the same behaviour.

   List slices in the exact execution order across the whole plan (milestones back to back).
   `plan-emit` derives `after:` from this order by itself (each dispatchable slice chains to the
   previous dispatchable one — a supervised entry is transparent to the chain, since ap3 cannot
   mechanically wait on a human-run task) and stamps `milestone: true` + an explicit `milestone_id`
   (e.g. `"M1"`) on the last dispatchable slice of each milestone number. Do not set `after:`,
   `milestone:`, or `milestone_id` yourself in `plan.json`. Only ever add `"landed": true` and
   `"landed_sha"` to a `supervised: true` entry, and only after the `git merge-base
   --is-ancestor` check in step 3 above — never guess a sha, and never set `landed: true` without
   one.

7. **Emit and verify.** Run `python3 ap3/aplib.py plan-emit plan.json` from the repo root. It is
   all-or-nothing: if anything is wrong with ANY slice (a bad slug, a missing field, a file that
   already exists, a `supervised` prerequisite not yet `landed: true`, or a rendered file that
   itself fails `lint()` — plan-emit validates every file it writes against the same rules
   `lint-task.sh` will and rolls all of them back on any failure, so a bad slug is never left
   occupying its path), it writes NOTHING and prints the reason for each. For an un-landed
   prerequisite specifically: do NOT submit a smaller `plan.json` that stops before it (step 3
   above explains why — `plan-emit` cannot see across separate invocations, so that would silently
   lose the `after:` chain and the milestone marker for whatever comes after the split); wait for
   the owner to confirm it landed and resubmit the WHOLE milestone. For every other failure, fix
   `plan.json` and re-run — the failed slug is free again since nothing was left behind. On success
   it prints `WROTE
   <slug>` per queued file and `SKIPPED <slug> (supervised: <reason>)` for each supervised one —
   check every dispatchable slug you designed got a `WROTE` line. Then, for every `WROTE` file:
   `bash ap3/lint-task.sh ap3/queue/<slug>.md`. **Refuse to finish while any file reports
   `INVALID_TASK`** — fix the plan.json input and re-emit, never hand-edit an emitted queue file
   directly (it would drift from `PLAN.md`'s own description of it). This final `lint-task.sh`
   pass still matters even though plan-emit already checked `lint()` itself: `lint-task.sh` adds
   the git-side checks (no run record, no existing `ap3/<slug>` branch on origin) that a
   working-tree-only check cannot see.

8. **Deliver as a docs-only PR.** In the `ap3/state/worktrees/plan-<slug>` worktree (branch
   `plan/<slug>`), stage exactly `ap3/features/<slug>/**` and the new `ap3/queue/<slug>-*.md`
   files, commit. **You never push or open the PR yourself** — print the exact commands (`git
   push -u origin plan/<slug>`, `gh pr create ...`) for the owner to run from that worktree. Tell
   the owner plainly: merging this PR is what queues the feature for the dispatcher — nothing
   runs before that merge.

## Fail-closed rules

- Validate `<slug>` against `^[a-z0-9][a-z0-9-]{2,60}$` before it touches any path or git ref.
- Refuse to plan until the `docs/intake-<slug>` PR is merged into `origin/main` — the staleness
  check below is exactly this requirement, mechanically enforced, not just stated.
- Work from `ap3/state/worktrees/plan-<slug>` before the first write; never write in the owner's
  own working directory.
- Refuse an intake that is not READY, that has no `sources:` list, or where any `sources:` path
  differs in content between `base_sha` and the fetched `origin/main` tip (neither ancestry nor
  exact-SHA equality can detect this correctly — see "Refuse first" above).
- Never emit a `supervised: true` slice as a queue file — `plan-emit` refuses this by
  construction; do not work around it by hand-writing one.
- Never emit a slice that comes after a not-yet-`landed` supervised prerequisite — `plan-emit`
  refuses this too, and writes nothing at all for that `plan.json` until it is fixed.
- Never set `landed: true` without a `landed_sha` you have personally verified with `git
  merge-base --is-ancestor <landed_sha> origin/main` — `plan-emit` requires the field to be
  present and sha-shaped, but it has no git access and cannot confirm the sha is real; that
  verification is this skill's own responsibility, not a bare claim to pass through.
- Never split one milestone's slices across two separate `plan-emit` invocations to work around
  an un-landed prerequisite — `plan-emit` has no memory between calls, so the `after:` chain and
  the milestone marker for whatever comes after the split would be silently lost. Wait for the
  prerequisite to land, then submit the whole milestone once.
- A milestone with an un-landed supervised member never gets a `milestone: true` marker on any of
  its dispatchable slices, even the one that would otherwise be "last" — `plan-emit` prints a
  `NOTE` instead of the marker. There is currently no way to add the marker retroactively once
  that slice has already merged; a milestone whose only unfinished part is a supervised item stays
  unannounced until W6's real milestone-review lands (tell the owner this plainly if it applies).
- Never finish while any generated queue file is `INVALID_TASK`; `plan-emit` itself already rolls
  back and refuses to leave behind any file that fails `lint()`.
- Never push, open a PR, or touch anything outside `ap3/features/<slug>/**` and
  `ap3/queue/<slug>-*.md`.
