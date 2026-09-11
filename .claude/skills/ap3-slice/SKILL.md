---
name: ap3-slice
description: The procedure an ap3 writer session follows to implement one queued task test-first and stop at a reviewable state. Loaded automatically in a dispatcher-started run (env AP3_SLUG present); do not invoke it by hand in a normal session.
---

# ap3-slice — implement one task, test-first, then stop

You are a headless writer in a git worktree on branch `ap3/$AP3_SLUG`, cut from `$AP3_BASE_SHA`.
You do the coding; the **dispatcher** (a separate, unsandboxed process) does the Codex review and,
only on a CLEAN verdict, the push + pull request. So you never run codex, never push, never open a
PR. You finish by leaving one of two files in `.ap3-run/` and stopping.

Your sandbox cannot reach a real database, docker, or any other raw TCP endpoint — only HTTP(S)
through the proxy. Never attempt `psql`, `docker`, or a DB-backed `test:db` run yourself; it will
just fail and waste budget. A `verify_host:` command (D5), if the task's class declares one, runs
on your behalf on the dispatcher's unsandboxed host, after review is CLEAN. That step is not yours
— write the code and whatever part of `verify` genuinely runs in-sandbox, then stop normally.

## Steps

1. **Read the task.** `cat "$AP3_TASK"`. Restate its scope and acceptance in `.ap3-run/plan.md`
   (≤ 20 lines). If anything required to finish is missing and not derivable from the repo, stop
   now: write `.ap3-run/HALT.md` with first line `MISSING_CONTEXT` and the exact question.

2. **RED.** Write or extend the test that pins the acceptance criterion. Run the task's `verify`
   command. It MUST fail, for the expected reason. Save the failing output to `.ap3-run/red.txt`.
   If you cannot make it fail (the behaviour already holds, or acceptance is untestable), stop:
   `.ap3-run/HALT.md` first line `VERIFY_FAIL`.

3. **GREEN.** Implement the change — inside the task's `scope` globs only. Re-run `verify` until it
   passes. Then run the project's full test command if the task names one and it is quick. Write
   `pass` to `.ap3-run/verify` when green.

4. **Commit** on the current branch with a conventional message (use the task's `Commit message`
   line if it gives one). One commit is fine; more is fine. Do not push.

5. **Self scope-check.** Run `bash ap3/scope-check.sh --base "$AP3_BASE_SHA"`. It must print `OK`.
   If it prints `SCOPE_DRIFT` with a file, you touched something out of scope — either revert that
   file (if the change does not need it) or stop: `.ap3-run/HALT.md` first line `SCOPE_DRIFT`, name
   the file and why it was needed. The committed diff, not your intentions, is the boundary.

6. **Hand off for review.** Write `.ap3-run/READY-FOR-REVIEW` — one short paragraph: what changed,
   the RED→GREEN proof (quote a line of `red.txt`), and the re-derived facts the task asked for
   (e.g. a grep hit count). Then **stop.** Do not run `ap3/review.sh`, do not push, do not `gh`.

## If you are restarted with findings

If `.ap3-run/REVIEW-FINDINGS.md` exists, the dispatcher's Codex review returned findings. Read it,
fix each finding inside scope, re-run `verify` to green, commit, re-run the scope-check, and rewrite
`.ap3-run/READY-FOR-REVIEW`. Do not argue with the reviewer in the file — fix or, if a finding needs
out-of-scope work, `.ap3-run/HALT.md` first line `SCOPE_DRIFT`.

## Stop rules (always: write `.ap3-run/HALT.md`, first line = the rule, then stop)

- `MISSING_CONTEXT` — a decision the task file does not give (you cannot ask; AskUserQuestion is denied).
- `SCOPE_DRIFT` — the change needs a file outside the declared scope.
- `VERIFY_FAIL` — the acceptance test cannot be made to pass honestly (no faking, no deleting tests).

Budget (`--max-budget-usd`) is enforced natively; if you run out you just stop — the dispatcher
records it as `BUDGET`. Never fabricate data, weaken an assertion, or edit `.claude/**` or `ap3/**`
to get to green — the scope-guard hook and the dispatcher's independent scope-check will catch it
and the run will HALT.
