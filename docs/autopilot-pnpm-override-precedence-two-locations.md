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

Three independent trials — 1 and 2 with magnitude deliberately reversed between them to rule out a
"lower/higher value always wins" confound, 3 repeating trial 1 to also capture
`pnpm config get overrides --json` for the same live conflict — all fully reverted before this
slice's commit:

| Trial | Package    | package.json value | pnpm-workspace.yaml value | Resolved (lockfile) | `pnpm config get` | Winner (resolution) |
| ----- | ---------- | ------------------- | -------------------------- | ---------------------- | -------------------- | ---------------------- |
| 1     | picocolors | 1.0.0 (lower)        | 1.0.1 (higher)              | 1.0.0                   | not checked           | package.json            |
| 2     | ms         | 2.1.2 (higher)       | 2.1.1 (lower)               | 2.1.2                   | not checked           | package.json            |
| 3     | picocolors | 1.0.0 (lower)        | 1.0.1 (higher)              | 1.0.0                   | 1.0.1 (disagrees)     | package.json            |

**Result: `package.json`'s `pnpm.overrides` wins for actual dependency resolution.** `pnpm config get
overrides` disagrees — it only ever surfaces `pnpm-workspace.yaml`'s map, a separate, source-cited
phenomenon, not evidence against the resolution finding. Full method, evidence, source citation, and
caveats are in `docs/standards/dependency-override-precedence.md` — this file does not duplicate them.

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

## Steps

Steps 1-7 happened, in order, before the commit that carries this file. Step 8 is the readiness
process itself — this review is part of it — so it cannot be described as already-completed prose in
a commit it is still evaluating; its outcome lives only in the gate's own artifacts
(`gate-attempt-*-code-review-round-*.txt`, `gate-result.json`, `READY.txt`/`HALT-*.txt`), never in
this file.

1. Verified `base_sha` == current `origin/main` tip (no drift) before creating the worktree.
2. Created worktree + branch from `base_sha`; authored + registered the runtime manifest while `HEAD`
   still equaled `base_sha` (see mechanics note above for the two registration attempts).
3. Ran the trial experiment(s) inside the worktree; reverted every trial via `git checkout` before any
   commit; confirmed `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml` byte-identical to
   `base_sha` afterward.
4. Checked `docs/standards/deployment-infra.md` and `docs/standards/environments-setup.md` for an
   existing home (zero `pnpm`/`override` mentions in either) before creating a new standards file.
5. Authored `docs/standards/dependency-override-precedence.md`, this slice doc, the authored contract,
   the launcher, and the `docs/autopilot-backlog.md` task-block update.
6. Self-verified every `verification.focused` and `verification.canonical` command by hand.
7. Committed the scoped files (one commit per fix round; see "Fix rounds" below for round 2+).
8. Authored/refreshed `readiness.json` and ran `scripts/autopilot-scope-gate ready`. Terminal outcome
   (`READY | AWAIT | HALT`) is recorded by the gate itself, not asserted here. Not merged regardless of
   outcome — merge is a separate, human-authorized action.

## Fix rounds

**Round 1 (codex, 2026-08-03): FINDINGS, both addressed.**

- **[P1]** The v1.0 standards doc claimed `package.json` wins without addressing that
  `pnpm config get overrides --json` reports only `pnpm-workspace.yaml`'s map, and flagged that the
  reproduction's `pnpm why` step can read a stale installed graph rather than the freshly-written
  lockfile. Both concerns were real. Resolution: added Trial 3 (captures `pnpm config get` and the
  resolved lockfile for the identical live conflict, proving they disagree), source-traced *why*
  `pnpm config get` disagrees (`getOptionsFromRootManifest`/`getOptionsFromPnpmSettings` whole-field
  replacement in the installed pnpm 10.30.2 CLI bundle, cited by file and function name), and
  reproduced the `pnpm why` staleness trap directly (plain `why` reported the stale pre-experiment
  version while a direct lockfile grep showed the correct, freshly-resolved one) — confirming Trials 1
  and 2 were unaffected (that worktree never had `node_modules` installed) while rewriting the
  documented reproduction recipe to lead with lockfile inspection. The headline conclusion
  (`package.json` wins **for actual resolution**) is unchanged and now more rigorously scoped and
  evidenced; the mechanism for *why* resolution honors `package.json` was not fully source-traced in
  the time available, and the standards doc says so explicitly rather than overclaiming.
- **[P2]** This file's "Steps" section framed step 8 (running the readiness gate) as already executed
  at commit time, when the gate — including the review round that found this — was still running.
  Resolution: reworded to distinguish pre-commit steps from the gate process itself; terminal state is
  now described as living in the gate's own artifacts, never asserted here.

Manifest `verification.focused` was not changed: its `Winner:` check already accepts a closed
three-value vocabulary (`package.json (pnpm.overrides)` / `pnpm-workspace.yaml (overrides)` /
`inconsistent / pnpm errors on conflicting overrides`) rather than free text, and the value this fix
round records continues to be independently justified by the evidence in the same file. Loosening
that further would need a new registration (the manifest is hash-locked); not done here since the
substantive finding was about the conclusion's rigor, not the check's mechanics.

## Negative scope

No change to any real override declaration's effective behavior. No resolving a live override
conflict (none exists today — see the standards doc's "Why this matters" section). No edit to
`pnpm-lock.yaml`. No code change of any kind — this slice is docs-only.
