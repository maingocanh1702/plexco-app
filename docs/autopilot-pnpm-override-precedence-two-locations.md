# Autopilot task contract — `pnpm-override-precedence-two-locations`

## Why this file exists

`package.json`'s `pnpm.overrides` and `pnpm-workspace.yaml`'s `overrides` are two different files that
accept the exact same override syntax. This repo has genuine entries in both (`package.json`:
`brace-expansion@1`, `sharp`, `postcss`; `pnpm-workspace.yaml`: `esbuild@<0.25.0`, `postcss@<8.5.10`)
and `postcss` sits in both today. Nobody knew which file would win if the two ever disagreed for a live
key — `deps-security-bump` (AP-39, 2026-07-30) hit this as `DSB-4` and sidestepped it by pinning the
same exact version in both locations rather than measuring. This task measures it and records the
result in `docs/standards/dependency-override-precedence.md`.

## Task contract

```text
TASK_ID: plexco:pnpm-override-precedence-two-locations
OUTCOME: Measure, by reproducible experiment, which override location wins when package.json's
  pnpm.overrides and pnpm-workspace.yaml's overrides both declare the same package with different
  values, at the pnpm version this repo pins (10.30.2). Record the result and reproduction steps in
  docs/standards/dependency-override-precedence.md.
REPO: Plexco app
BASE_SHA: b3d3b4a26abc3fddbbb51ebb3d9f4d33d899ab43 (== origin/main tip at authoring time, verified no drift)
RISK: P2 (corrected from the backlog's P3 — autopilot-review-readiness.mjs hard-rejects register for
  risk outside P1/P2; same correction docs-billing-authz-signature-reconcile made for the same
  change_class, 2026-08-03)
DEPENDS_ON: [] (backlog lists deps-security-bump; that task is merged (61a2575) but its own
  merged_probe is documented as a non-slice-unique weak probe with no constructible dep_checks proof —
  the dependency is historical and already on this slice's base)
SCOPE: docs/autopilot-manifests/pnpm-override-precedence-two-locations.json,
  docs/autopilot-pnpm-override-precedence-two-locations.md,
  .claude/commands/ap-45-pnpm-override-precedence-two-locations.md, docs/autopilot-backlog.md,
  docs/standards/dependency-override-precedence.md
NEGATIVE_SCOPE: no change to package.json / pnpm-workspace.yaml / pnpm-lock.yaml lands in the commit —
  the experiment is transient, reverted before commit, and verification.focused asserts identity to
  base_sha for all three files
```

## Measurement

Two independent trials, magnitude deliberately reversed between them to rule out a "lower/higher value
always wins" confound, both fully reverted before this slice's commit:

| Trial | Package    | package.json value | pnpm-workspace.yaml value | Resolved | Winner       |
| ----- | ---------- | ------------------- | -------------------------- | -------- | ------------ |
| 1     | picocolors | 1.0.0 (lower)        | 1.0.1 (higher)              | 1.0.0    | package.json |
| 2     | ms         | 2.1.2 (higher)       | 2.1.1 (lower)               | 2.1.2    | package.json |

**Result: `package.json`'s `pnpm.overrides` wins.** Full method, evidence, and caveats are in
`docs/standards/dependency-override-precedence.md` — this file does not duplicate them.

## Registration mechanics note (found live, kept for the next slice)

First registration attempt HALTed `CONTRACT_INVALID` on a `context_sources` entry containing a literal
`->` (arrow shorthand for "to") — `autopilot-review-readiness.mjs`'s placeholder guard rejects any
string containing `<` or `>`, and `->` contains `>`. Fixed by spelling out "to" instead of using an
arrow. That HALT never created an INFLIGHT.md lifecycle and was left on disk untouched, not deleted.

Second registration succeeded and hash-locked, but pre-`ready` self-verification (run by hand before
calling `ready`, as this template's own launchers require) found that 2 of 8 `verification.focused`
grep commands used `-qF '- ...'` patterns starting with a literal hyphen — BSD `grep` (this machine's
`/usr/bin/grep`) rejects any pattern argument starting with `-` as an invalid option regardless of
content, so those two checks could never pass. The hash-locked manifest had no in-place fix (confirmed:
`register` rejects a duplicate `register` call for an already-active feature with
`FEATURE_ALREADY_ACTIVE`). Closed via
`scripts/ap-finish.sh pnpm-override-precedence-two-locations --authorized-close --reason "..."` — zero
commits and zero review rounds existed on that registration, so nothing was lost; disposition recorded
at `.autopilot/dispositions/pnpm-override-precedence-two-locations.json`. Re-registered fresh under the
same feature id with `-e` added before every grep pattern; all then-testable `verification.focused`
commands were run by hand against `/usr/bin/grep` and `/usr/bin/git` directly (not the interactive
shell's `grep` wrapper) before the second `register` call, and passed.

## Steps (already executed by the time this file lands in a commit)

1. Verified `base_sha` == current `origin/main` tip (no drift) before creating the worktree.
2. Created worktree + branch from `base_sha`; authored + registered the runtime manifest while `HEAD`
   still equaled `base_sha` (see mechanics note above for the two registration attempts).
3. Ran the two-trial experiment inside the worktree; reverted both trials via `git checkout` before any
   commit; confirmed `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml` byte-identical to
   `base_sha` afterward.
4. Checked `docs/standards/deployment-infra.md` and `docs/standards/environments-setup.md` for an
   existing home (zero `pnpm`/`override` mentions in either) before creating a new standards file.
5. Authored `docs/standards/dependency-override-precedence.md`, this slice doc, the authored contract,
   the launcher, and the `docs/autopilot-backlog.md` task-block update.
6. Self-verified every `verification.focused` and `verification.canonical` command by hand.
7. Committed the five scoped files in one commit.
8. Authored `readiness.json`, ran `scripts/autopilot-scope-gate ready`, stopped at
   `READY | AWAIT | HALT`. Did not merge.

## Negative scope

No change to any real override declaration's effective behavior. No resolving a live override
conflict (none exists today — see the standards doc's "Why this matters" section). No edit to
`pnpm-lock.yaml`. No code change of any kind — this slice is docs-only.
