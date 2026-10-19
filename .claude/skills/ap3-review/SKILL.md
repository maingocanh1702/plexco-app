---
name: ap3-review
description: How ap3 reads a review verdict (pinned Codex, or the read-only Claude fallback only when Codex cannot run) — the exact marker contract, what counts as fixed, and the round limits. Reference for the dispatcher's review step and for anyone reading an ap3 findings file.
---

# ap3-review — the verdict contract

The independent reviewer is the pinned, read-only, ephemeral Codex wrapper
`ap3/codex-review-pin.sh` (K30; the legacy `scripts/codex-review-pin.sh` mirror is only a fallback), invoked by `ap3/review.sh` **in the dispatcher** (unsandboxed —
codex cannot initialize inside the writer's Seatbelt sandbox; see `W1-DECISION-codex-sandbox.md`).
It reviews exactly `git diff <base>...HEAD` against the task spec.

**Fallback (owner decisions 2026-10-15 / 2026-10-18).** Only when Codex could not run at all (pin/CLI
missing, auth or quota failure, or a crash that repeats on the one retry), `review.sh` re-runs the same
review in a fresh read-only Claude Code session — Opus 5.5 @ xhigh, Read/Glob/Grep only, no shell, never the
writer's session or a sub-agent of it. Its output starts with
`AP3_REVIEWER: claude-fallback reason=… model=… effort=… cost_usd=…` and ends with the same marker, and
`review.sh` records who reviewed in `ap3/state/runs/<slug>/reviewer-<mode>.r<N>.txt` — the record the
dispatcher trusts. A Codex run that completed is never handed to the fallback (see below); if neither
reviewer yields a marker the verdict is UNAVAILABLE. A run reviewed by the fallback is disclosed in the PR
body and the evidence row and never earns `clean_runs` (`current-workflow.md` § Reviewer fallback).

## The marker

`ap3/review.sh` asks the reviewer to put any numbered list of actionable findings FIRST and to end with
exactly one of these as the very last line — nothing may follow it:

- `AP3_REVIEW_VERDICT: CLEAN` — no actionable finding closable within the task's declared scope.
- `AP3_REVIEW_VERDICT: FINDINGS` — actionable findings exist; they are listed, numbered, above this line.

How `review.sh` reads a Codex attempt (owner decisions 2026-10-18, narrowed in review round 2): exit 0
with an exact marker as the **last** non-empty line — that marker is the verdict, and earlier marker lines
are ignored (codex echoes the prompt and the files it reads); a non-zero exit whose last line is exactly the
FINDINGS marker is FINDINGS (a CLEAN last line with a non-zero exit is a crash, never CLEAN); only an
attempt that did NOT end on an exact marker is FINDINGS when a full `AP3_REVIEW_VERDICT: FINDINGS` line
appears anywhere in it; an exit 0 with no verdict is UNAVAILABLE — no retry, no fallback. The fallback's
own reply is FINDINGS when a full FINDINGS line appears anywhere in it. Exit `0` CLEAN, `1` FINDINGS, `3`
UNAVAILABLE (no parseable verdict from Codex *or* the fallback — fail-closed, treated as a reviewer outage,
not a fixable finding).

## What counts

- A review with **any** actionable finding is not clean. CLEAN means zero.
- "Actionable" = closable by editing the change set itself. Pre-existing defects and work outside
  the diff are ADVISORY (the pin instructs codex to separate them) and do not block the verdict —
  a writer cannot edit outside its scope, so gating on them would loop forever.
- A CLEAN verdict on an **empty** diff is not evidence. `scope-check.sh` and the dispatcher both
  confirm the diff is non-empty and within scope before the review is trusted.

## Rounds

- Each FINDINGS verdict below the task's `max_review_rounds` re-dispatches a fix writer with
  `.ap3-run/REVIEW-FINDINGS.md`; the round counter increments.
- At `max_review_rounds` the dispatcher stops: `HALT MAX_ROUNDS`, the class is paused, no PR.
  Non-converging review is a design signal (re-slice the task), never "one more round".

## Security round

When the class sets `security_review: auto`, the dispatcher runs a second, security-focused review
(`ap3/review.sh security`) whenever the diff touches a trust boundary (auth, secrets, money,
external input, shell/SQL). Same marker contract; FINDINGS there blocks the same way.
