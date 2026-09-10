---
name: ap3-review
description: How ap3 reads a Codex review verdict — the exact marker contract, what counts as fixed, and the round limits. Reference for the dispatcher's review step and for anyone reading an ap3 findings file.
---

# ap3-review — the verdict contract

The independent reviewer is the pinned, read-only, ephemeral Codex wrapper
`scripts/codex-review-pin.sh`, invoked by `ap3/review.sh` **in the dispatcher** (unsandboxed —
codex cannot initialize inside the writer's Seatbelt sandbox; see `W1-DECISION-codex-sandbox.md`).
It reviews exactly `git diff <base>...HEAD` against the task spec.

## The marker

`ap3/review.sh` requires the reviewer to end with exactly one final line:

- `AP3_REVIEW_VERDICT: CLEAN` — no actionable finding closable within the task's declared scope.
- `AP3_REVIEW_VERDICT: FINDINGS` — followed by a numbered list of actionable findings.

`review.sh` reads the **last** such line (codex may echo the rubric earlier) and exits `0` CLEAN,
`1` FINDINGS, `3` UNAVAILABLE (no parseable verdict — fail-closed, treated as a reviewer outage,
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
