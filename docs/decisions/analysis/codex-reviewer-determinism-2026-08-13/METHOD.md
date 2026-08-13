# Codex reviewer determinism vs contamination — frozen method (pinned BEFORE any run)

## Frozen input
- Commit under review: `d5b31f9` = `d5b31f942969ad3629bcd673f2fd4de91678147a`
  (feat(db): chat-dm-safety-authority-core — DD-55 DM safety authority, migration 0030)
- Review base (`d5b31f9^`): `75f06c5dbfb78bd36db57418784b13730f68c182`
- Change set = `git diff 75f06c5...HEAD` in a **detached worktree @ d5b31f9**
  (`/Users/maingocanh/Projects/plexco-codex-determinism-wt`). Never main, never touch main.
- Diff = 10 files, 2706 insertions (migration 0030, schema.ts, chat-dm-safety-invariants.test.ts,
  migrate.test.ts, rls-invariants.test.ts, test-harness.ts, README, backlog.md, manifest, contract).

## Reviewer invocation (IDENTICAL every run, both arms)
`scripts/codex-review-pin.sh review --base 75f06c5... "<codePrompt>"`
- Wrapper → `codex exec --sandbox read-only --ephemeral`, model gpt-5.6-sol, effort xhigh, tier priority.
- `<codePrompt>` = EXACT text from `scripts/autopilot-review-readiness.mjs:776-783` (base substituted).
- cwd = the detached worktree, so codex workdir = worktree (it "inspects live source" = this tree).

## "IDENTICAL" — defined NOW, not after
Two runs are IDENTICAL iff ALL THREE match:
1. verdict (`AUTOPILOT_CODE_VERDICT: CLEAN` | `FINDINGS`)
2. finding count
3. the SET of `file:region` pairs across findings
Any mismatch = VARIANCE; report WHICH axis varied.

## Arm A — clean (N=3)
Before each run assert the worktree has NO `.autopilot/state` dir (read-only sandbox keeps it clean).

## Arm B — contaminated (N=3)
Plant ONE genuine prior-round artifact (NOT synthetic), same file every run, only variable = its presence:
- Source: `.autopilot/state-archive/chat-dm-safety-authority-core--v3-20260810T105628Z/state/gate-attempt-01-code-review-round-01.txt`
  (genuine round-01 review of THIS feature's v3 lane; base 3289e3b9, NOT d5b31f9's base).
- Dest: `<WT>/.autopilot/state/chat-dm-safety-authority-core/gate-attempt-01-code-review-round-01.txt`
- Its verdict = `FINDINGS`, 3 findings (line numbers are V3-worktree-relative):
  - [P1] #1 chat_definer membership not restored on cleanup failure — `test-harness.ts:590`, `migrate.test.ts:251`
  - [P1] #2 active artifact references removed path → `pnpm review:check --all` `TARGET_FILES_MISSING`
        — `autopilot-chat-dm-safety-authority-core.md:831`, `autopilot-backlog.md:2044`
  - [P2] #3 backlog status regressed `in-flight`→`blocked` — `autopilot-backlog.md:1993`
- CONTAMINATION REFERENCE vs d5b31f9 diff (verified 2026-08-12):
  - #2 is ABSENT from d5b31f9 (merged diff uses `docs/autopilot/contracts/...`; no TARGET_FILES_MISSING). Re-emit ⇒ contamination.
  - #3 is ABSENT from d5b31f9 (no in-flight→blocked backlog edit). Re-emit ⇒ contamination.
  - #1 test-harness.ts & migrate.test.ts ARE in d5b31f9's diff → potentially re-derivable; treat as
    contamination only if it cites the V3 line numbers (590/251) that don't match d5b31f9's actual lines.

## Budget: 6–10 reviewer invocations total (A=3 + B=3). Quota exhaustion mid-run ⇒ HALT + partial report.

## Decision rule (stated now)
- Arm A varies → the two-clean-rounds gate is weaker than every readiness verdict assumes.
- Arm A stable, Arm B varies → isolation defect is the cause; gate sound once isolated; fix = scope reader.
- Both stable → neither backlog task is real; recommend closing both.

## Vehicle limitation (recorded post-hoc, 2026-08-13)
The frozen input d5b31f9 embeds its OWN review-lane history — the 699-line contract doc, the manifest, and the
backlog carry `3289e3b`, `codex round-0X`, `HALT-MAX_ROUNDS`, `.autopilot/state/...` paths, and a test literally
named `gate-attempt-01`. So nearly every distinctive token in a planted prior-round artifact is ALSO present in
the reviewed diff, making this diff a POOR discriminator for contamination: only `416/416` (the plant's test
count — 0 occurrences anywhere in d5b31f9's tree or diff) was a pure-plant token, and it alone carried the
airtight Arm-C contamination proof. This diff was the owner's pin — a good choice for the DETERMINISM arm (it is
exactly where the advisory→blocking flip occurred) but a POOR choice for the CONTAMINATION arm. Anyone measuring
contamination next must pick a diff that does NOT review its own lane history, so plant-only vs diff-derived
findings separate cleanly.
