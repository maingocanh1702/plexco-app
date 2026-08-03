# Autopilot task contract — `pnpm-override-precedence-two-locations`

## Why this file exists

`package.json`'s `pnpm.overrides` and `pnpm-workspace.yaml`'s `overrides` are two different files that
accept the exact same override syntax. This repo has genuine entries in both (`package.json`:
`brace-expansion@1`, `sharp`, `postcss`; `pnpm-workspace.yaml`: `esbuild@<0.25.0`, `postcss@<8.5.10`)
and `postcss` sits in both today. Nobody knew which file would win if the two ever disagreed for a live
key — `deps-security-bump` (AP-39, 2026-07-30) considered pinning the same exact version in both
locations as its own `DSB-4` resolution, reasoning that "whichever wins gives the same result," but
that specific change was reverted mid-task (commit `cf031f0`) when an unrelated security issue
deferred the whole `postcss` bump — the precedence question was never actually measured. This task
measures it and records the result in `docs/standards/dependency-override-precedence.md`.

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
`esbuild@<0.25.0` override has been inert since `package.json` first gained a non-empty
`pnpm.overrides` field, commit `f1af6e3`, 2026-07-22 — not "never," it worked before that commit).
`pnpm config get overrides` disagrees with the
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
  workspace override targets, and the override has been inert since `f1af6e3` (see round 5 below —
  it worked before that commit). The standards doc
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

  **Superseded by round 3, below: `"feature"` is a generic JSON key present in nearly every manifest
  in this repo, not slice-unique.** `autopilot-backlog-reconcile` would reject it. The backlog reverted
  to `merged_probe: null` plus `close_by: hand`, matching `deps-security-bump`'s own precedent for the
  same reason. This entry is left as written rather than edited, per this repo's convention of
  preserving prior round notes and correcting forward.

**Round 3 (codex, 2026-08-03): FINDINGS, all 5 addressed — a precision refinement of round 2's
correct model, not a reversal.**

- **[P1]** Round 2's "package.json's non-empty override map replaces the workspace map" needed a
  boundary condition: pnpm deletes an *empty* root override map before applying it
  (`getOptionsFromPnpmSettings`, `pnpm.cjs:20826`), so `pnpm.overrides: {}` does **not** trigger
  replacement — the precise condition is "non-empty," not merely "declared." The root-derived map also
  includes `package.json`'s Yarn-compatibility `resolutions` field. Fixed throughout the standards doc,
  this file, the launcher, and the backlog.
- **[P2]** `merged_probe: ... :: feature` (added when this task first reached `status: ready`) is not
  slice-unique — `autopilot-backlog-reconcile` requires a genuinely unique code symbol, and `feature`
  is a generic JSON key shared by nearly every manifest in this repo. Reverted to `merged_probe: null`
  plus `close_by: hand`, matching `deps-security-bump`'s own precedent for the identical reason.
- **[P2]** Manifest `verification.focused` (hash-locked) asserted only the `Winner:` enum value, which
  could not reject a regression back to round 1's discredited per-key model while keeping the same
  enum value. Required a second re-registration: archived the then-current 3-commit tip on
  `archive/pnpm-override-precedence-two-locations-round3-content`, reset the branch to `base_sha`,
  closed the prior registration via `ap-finish.sh --authorized-close`, registered a strengthened
  manifest (new checks assert `"whole-map replacement"` and the literal `esbuild@0.18.20` — Trial 4's
  evidence — are present in the standards doc) while `HEAD` still equaled `base_sha`, then
  `git merge --ff-only` the archive ref back in. See "Registration mechanics note" above for the full
  procedure.
- **[P2]** The DSB-4 provenance in "Why this matters" was unverified: it read as though `deps-security-bump`
  (AP-39) had shipped a same-version postcss pin still live today. Verified via `git log -S`/`git show`
  before rewriting: today's `postcss` values predate AP-39 entirely; AP-39 did unify both locations to
  `postcss@<8.5.18: 8.5.18` mid-flight, as its own `DSB-4` resolution, but that change was reverted in
  the same task (commit `cf031f0`) when its own security round found an unrelated real issue in
  `8.5.18`, deferring the whole bump to `deps-security-bump--postcss` (still `blocked`). Rewrote the
  provenance narrative with the verified commit history instead of the assumed one.
- **[P3]** `git diff --check` failed on trailing whitespace at `dependency-override-precedence.md:52`
  — removed.

**Round 4 (codex, 2026-08-03): FINDINGS, all 5 addressed — completeness gaps in round-3-originated
fixes, not new substantive issues.**

- **[P1]** The new backlog task `pnpm-workspace-esbuild-override-inert` (added in round 2, above) was
  missing its `## task:` header line entirely — the live backlog parser only opens a new block on that
  exact prefix, so the block's `status: idea` line was silently attributed to the *previous* block
  (this task), corrupting its parsed status. Confirmed directly against
  `scripts/autopilot-backlog-reconcile` after the fix: this task still parses as `ready` with its
  `close_by: hand` disposition; the new task is correctly excluded (its own `status: idea` is not
  reconciler-tracked). Root cause not fully determined; fixed by inserting the missing header.
- **[P2]** That same new backlog task's notes repeated the pre-non-empty-precision "declares... at all"
  phrasing — written before round 3's empty-map finding existed. Fixed to "non-empty root-derived
  override map," matching every other instance.
- **[P2]** This file's own round-2 entry (above) asserted the `feature` probe resolution as final,
  before round 3 corrected it. Annotated as superseded (see above) rather than rewritten.
- **[P2]** The standards doc's closing "Practical guidance" section had a second, uncorrected mention
  of `DSB-4`'s postcss entries as though still mirrored/live — the same provenance error round 3 fixed
  in "Why this matters" but missed here. Fixed to "current/pre-existing duplicate postcss rules."
  Swept for every remaining "declares... any/at all" phrasing across all five scoped files while fixing
  this (two more instances found in the standards doc, both fixed) and every remaining DSB-4-as-live
  phrasing (one more instance found in this file's own intro paragraph, fixed) — round 4 exists
  specifically because round 3's fixes were correct in substance but applied to only the first instance
  found per issue, not swept exhaustively; this round's fixes were swept.

**Round 5 (codex, 2026-08-03): FINDINGS, both addressed — a real historical-precision gap, verified via
`git show`, not trusted from the finding text alone.**

- **[P2]** "The esbuild override has never actually applied/run" (this file, the backlog task title and
  notes) was itself imprecise, discovered the same way the DSB-4 provenance error was: checking only
  the base commit's state instead of the full history. Verified independently before fixing, not taken
  on trust: at commit `7146f51` (2026-07-17), `git show 7146f51:pnpm-lock.yaml` shows the override
  correctly resolving `@esbuild-kit/core-utils@3.3.2` to `esbuild@0.25.12` — the rule worked. Commit
  `f1af6e3` (2026-07-22, `git show f1af6e3 -- package.json`) added `package.json`'s first-ever
  `pnpm.overrides` entries (`brace-expansion@1`, `sharp`, closing two unrelated OSV advisories,
  `esbuild` not among them) and that non-empty map has silenced the workspace `esbuild` rule ever
  since, as an unmeasured side effect. Every "never ran/applied"/`chưa từng chạy` instance across the
  standards doc, this file, and the backlog task (title and notes) corrected to "inert since `f1af6e3`
  (2026-07-22)."
- **[P2]** The launcher's negative scope described the current matching `postcss` resolution as "both
  values currently agree," implying two independently-active rules that happen to coincide — the same
  misconception whole-map replacement disproves. Fixed to state that only `package.json`'s map governs
  and `pnpm-workspace.yaml`'s copy is inert, matching the standards doc's own framing.

**Round 6 (codex, 2026-08-03): FINDINGS, addressed — the standard's guidance wasn't reconciled with
two other active backlog tasks it makes newly obsolete.**

- **[P2]** `deps-security-bump--postcss` (blocked, pre-existing, not authored by this slice) instructed
  updating overrides in both `package.json` and `pnpm-workspace.yaml`, reasoning that leaving
  `pnpm-workspace.yaml`'s rewrite unpatched would let it "still pull every transitive postcss down to
  the vulnerable version" — the same per-key-conflict misconception round 2 disproved for this slice.
  Corrected in place (not rewriting the block's preserved historical `notes:`, per this repo's
  convention — appended as a dated correction) without touching `deps-security-bump` itself (merged,
  historical, left untouched).
- **[P2]** This task's own new backlog entry, `pnpm-workspace-esbuild-override-inert` (added round 2),
  offered option (a) — mirror `esbuild` into `package.json` — without saying what to do with
  `pnpm-workspace.yaml`'s now-redundant copy, which would perpetuate the exact two-location state the
  standard calls unsafe. Made explicit that option (a) must also remove (or clearly comment) the
  workspace copy.

**Round 7 (codex, 2026-08-03): FINDINGS, addressed — round 6's fix was itself incomplete, plus a
documentation-only round-numbering defect in this section.**

- **[P2]** Round 6 fixed the *reasoning* in both active tasks but not the *residual claim*: the
  postcss task still said to update both locations (not just the one that matters for resolution), and
  the esbuild task's option (a) — even after round 6's fix — only ever addresses the `esbuild` key, so
  it cannot honestly claim "full consolidation" while `postcss` remains split across both files.
  Rewrote both: the postcss task now states updating `package.json` alone is the only step that
  affects resolution, with syncing `pnpm-workspace.yaml` explicitly optional and explicitly *not*
  equivalent to consolidation unless the entry is removed, not just matched; the esbuild task's option
  (a) is now explicitly scoped as "fixes `esbuild` only, does not by itself achieve full-file
  consolidation" rather than implying it does.
- **[P2]** This "Fix rounds" section itself mislabeled the missing-header/completeness-sweep findings
  as "Round 3" and jumped straight to "Round 5," because a genuine Round 3 entry (the empty-map
  precision, `merged_probe` correction, verification-strengthening re-registration, and DSB-4
  provenance fixes — all real, all previously recorded only in the backlog notes) was never added here.
  Inserted the missing Round 3 entry above, relabeled the mislabeled section to Round 4, and added this
  Round 6/7 pair — this section should now match `regions.log` and the backlog's own round-by-round
  notes exactly.

## Negative scope

No change to any real override declaration's effective behavior. No resolving a live override
conflict (none exists today — see the standards doc's "Why this matters" section). No edit to
`pnpm-lock.yaml`. No code change of any kind — this slice is docs-only.
