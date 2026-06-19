# Autopilot — parallel scope gate (SCOPE_COLLISION)

Repo-agnostic spec. Lets **multiple autopilot / Claude Code terminals run in parallel** (one git
worktree each) while keeping quality: **parallel when scope is disjoint, sequential when it overlaps.**
Ported into `autopilot-prompt-GENERIC` §A.3.1. Production mechanism = the repo-owned script
`scripts/autopilot-scope-gate` (this doc explains the WHY; the script is the source of truth).

## Why worktrees alone are not enough

A git worktree gives each session its own index + working dir, so concurrent commits are mechanically
safe. But 4 things still break quality:

1. **Same file edited by two features** (`schema`/migrations, i18n, package manifest) → merge conflict.
   → Gate catches AUTOMATICALLY (compares file paths in `scope`).
2. **Same SQLite/DB file in tests** → give each worktree its own `DB_PATH` (e.g. `/tmp/ap-<feature>.db`).
3. **Same *domain concept* in different files** (e.g. feature A changes `paidAmount`, feature B changes
   `refundAmount`, same money model) → git can't see it. → Gate catches ONLY IF both features declare a
   shared `invariants:` token (e.g. `money-model`). Undeclared domain still slips → needs human review.
   The **invariant catalog** (`docs/autopilot-invariant-catalog.md`) is the canonical token list; the
   gate HALTs on a token not in it (INVARIANT_UNKNOWN) to stop synonym drift.
4. **Race to merge into main** → serialize the merge step (one branch at a time; gate doesn't do this).

→ Rule: two autopilots run in parallel only when their **positive-scope file sets are disjoint** AND
they **share no domain invariant**.

## The gate (run in Pre-flight, BEFORE branch/worktree mutation)

```bash
scripts/autopilot-scope-gate register --manifest docs/autopilot-manifests/<feature>.json
```

The script: resolves the shared registry at MAIN `.autopilot/INFLIGHT.md` via `git rev-parse
--git-common-dir`; takes an atomic mkdir-lock around check+append (so two sessions starting at once
can't both pass against the stale registry); validates invariants against the catalog; checks
`depends_on` is merged (not still active); checks scope/invariant collision; on PASS replaces any old
block for this feature with a fresh `in-flight` block. At READY run `... ready`; after merge `...
cleanup` (or `cleanup --feature <slug>` if the manifest is gone).

## Manifest (tracked, one per feature)

`docs/autopilot-manifests/<feature>.json` — `feature`, `branch`, `base_ref`, `risk`, `change_class`,
`depends_on`, `invariants` (catalog tokens), `scope` (positive-scope files). It is the single source of
truth; the prompt's Scope section and the manifest must mirror each other.

## Breakers (added to GENERIC's set)
- **SCOPE_COLLISION** — scope file OR invariant intersects another active (`in-flight|ready`) feature.
- **DEP_MISSING** — a `depends_on` prerequisite is still active (not merged on base ref). Also covers
  interface-drift: re-derive dependent's symbol refs from the REAL merged code on base_ref.
- **INVARIANT_UNKNOWN** — manifest uses a token absent from the catalog. Add the canonical token first.

## Operating in parallel
- One git worktree per feature: `git worktree add .autopilot/worktrees/<slug> -b feat/<slug>`.
- Separate `DB_PATH` (or other shared mutable test state) per worktree.
- Stagger cross-model review (codex) to avoid auth/quota contention.
- Serialize merges into main: one branch at a time; rebase the rest. Batch via merge-train (GENERIC §C3).
- Natural partitioning that's usually safe to parallelize: distinct transports/adapters, docs-only,
  isolated modules. Usually-sequential (shared "pot"): schema/migrations, the money/settlement core,
  auth, i18n, package manifest/lockfile.

## Lesson (why a script, not pasteable shell)
The first version was pasteable awk in a prompt. Two workflow bugs: (a) shell self-exclusion was easy to
copy wrong; (b) check-then-append was non-atomic, so two autopilots starting together could both PASS
against the old registry. Once a gate coordinates multiple agents it must be executable state with
locking, not prose. Hence the repo-owned script + atomic lock + tracked manifests.
