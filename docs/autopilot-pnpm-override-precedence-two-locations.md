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

Four trials. 1 and 2 reverse magnitude to rule out a "lower/higher value always wins" confound; 3
repeats trial 1 to also capture `pnpm config get overrides --json` for the same live conflict; 4
isolates whole-map replacement from same-key precedence by touching a key (`esbuild`) `package.json`
never declares. All fully reverted before this slice's commit:

| Trial | What changed | package.json value | pnpm-workspace.yaml value | Resolved (lockfile) | `pnpm config get` | Result |
| ----- | ------------- | -------------------- | --------------------------- | ---------------------- | -------------------- | -------- |
| 1     | `picocolors` set in both | 1.0.0 (lower) | 1.0.1 (higher) | 1.0.0 | not checked | package.json's map applied |
| 2     | `ms` set in both, magnitude reversed | 2.1.2 (higher) | 2.1.1 (lower) | 2.1.2 | not checked | package.json's map applied |
| 3     | repeat of 1, `config get` also captured | 1.0.0 (lower) | 1.0.1 (higher) | 1.0.0 | 1.0.1 (disagrees) | package.json's map applied |
| 4     | `package.json`'s entire `pnpm.overrides` removed; `esbuild` untouched in either file | absent | `esbuild@<0.25.0 → 0.25.12` unchanged | `esbuild@0.18.20` → gone | not checked | with `package.json`'s map absent, workspace's previously-inert `esbuild` rule fires |

**Result: `package.json`'s `pnpm.overrides`, when non-empty, wholesale-replaces
`pnpm-workspace.yaml`'s entire `overrides` map for actual dependency resolution — not a per-key merge.**
(An empty `pnpm.overrides: {}` does not trigger this — pnpm deletes an empty override map before
applying root settings; see the standards doc.) Trials 1-3 alone cannot distinguish "package.json wins
ties" from "package.json's map replaces the other entirely" (both explanations fit a same-key
conflict). Trial 4 is what distinguishes them: it touches a key with no `package.json` counterpart at
all, so there is no tie — yet toggling only whether `package.json`'s override map is present and
non-empty flips whether `pnpm-workspace.yaml`'s unrelated rule fires. That is only explainable by
whole-map replacement, and it is a live, present-day condition in this repo, not
a hypothetical (see the standards doc's "A live consequence" section — `pnpm-workspace.yaml`'s
`esbuild@<0.25.0` override has never actually run). `pnpm config get overrides` disagrees with the
resolution outcome for a separate, source-cited reason (see the standards doc's "A critical
distinction"), not evidence against this finding. Full method, evidence, source citations, and caveats
are in `docs/standards/dependency-override-precedence.md` — this file does not duplicate them.

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

Third registration (after round 3, once two completed review rounds had already produced real,
addressed findings): round 3 found the closed three-value `Winner:` enum alone could not reject a
regression back to round 1's discredited per-key model, so `verification.focused` needed new checks —
a change to the hash-locked manifest, requiring another close-and-re-register. By this point the
branch carried 3 real commits, and `register` requires worktree `HEAD` to equal `base_sha` exactly, so
a bare close-and-reregister would have discarded them. Followed the sanctioned recovery: created
`archive/pnpm-override-precedence-two-locations-round3-content` pointing at the current tip,
`git reset --hard` the branch back to `base_sha` (content preserved on the archive ref, not lost),
closed the prior registration via `ap-finish.sh --authorized-close`, recreated the worktree on the
same branch (now at `base_sha`), authored and registered the strengthened manifest while `HEAD` still
equaled `base_sha`, then `git merge --ff-only` the archive ref back in — a clean fast-forward, since
the branch never diverged from what the archive ref pointed at. All content was verified byte-identical
after the merge before continuing.

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

**Round 2 (codex, 2026-08-03): FINDINGS — round 1's model was wrong, not just under-evidenced; all
three addressed.**

- **[P1, the substantive one]** Round 1 shipped "package.json wins when the two conflict on the same
  key" — a **per-key precedence** model. This is wrong. Direct isolation test: temporarily removed
  `package.json`'s entire `pnpm.overrides` field (touching no key that collides with anything in
  `pnpm-workspace.yaml`) and re-ran `pnpm install --lockfile-only`. `pnpm-workspace.yaml`'s
  `esbuild@<0.25.0 → 0.25.12` rule — previously silent — started firing immediately; restoring
  `package.json`'s field (unchanged, `esbuild` never mentioned) silenced it again. A key with no
  collision cannot be explained by "wins on conflict" — only by **whole-map replacement**:
  `package.json`'s non-empty override map replaces `pnpm-workspace.yaml`'s entire override map,
  including keys it never mentions (an *empty* `pnpm.overrides: {}` does not trigger this — see round
  3 below). This is now Trial 4 in Measurement above, and it is a **live, present-day gap**:
  `@esbuild-kit/core-utils@3.3.2` genuinely requests `esbuild: ~0.18.20`, entirely inside the range the
  workspace override targets, and the override has never actually applied to it. The standards doc
  (v1.2) was rewritten around this corrected model; the practical guidance that told readers to split
  overrides across the two files was deleted — it was actively unsafe under whole-map replacement, not
  merely imprecise — and replaced with "consolidate into one file." Round 1's unverified extrapolation
  that `assertWantedLockfileUpToDate` also reads the workspace-replaced view was retracted rather than
  defended; the variable it actually reads (`rootManifestOptions`) was not independently confirmed to
  be that same value, so the doc now makes no claim about that function either way. The live esbuild gap
  is not fixed here (negative scope) — recorded as backlog task `pnpm-workspace-esbuild-override-inert`.
- **[P2]** The launcher's step 4 and the backlog's original 2026-07-30 measurement recipe still taught
  plain `pnpm why` as the primary evidence — the exact trap round 1 fixed in the standards doc, still
  live in two other instructions. Fixed both: lockfile grep is now the stated primary evidence in the
  launcher, with `pnpm why`/`pnpm config get` explicitly downgraded to diagnostic-only; the backlog's
  original recipe line got an inline correction note pointing at this fix (original text preserved,
  per this repo's established convention for dated notes).
- **[P2]** `status: ready` with `merged_probe: null` meant `autopilot-backlog-reconcile` could never
  auto-detect this task landing. Added `docs/autopilot-manifests/pnpm-override-precedence-two-locations.json :: feature`
  — the manifest file is entirely absent at base and the probe string is slice-unique.

## Negative scope

No change to any real override declaration's effective behavior. No resolving a live override
conflict (none exists today — see the standards doc's "Why this matters" section). No edit to
`pnpm-lock.yaml`. No code change of any kind — this slice is docs-only.
