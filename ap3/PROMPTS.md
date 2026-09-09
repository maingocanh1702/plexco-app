# ap3 — prompt cho các bước kế tiếp (Plexco app)

Cập nhật 2026-09-09 (chiều), **sau khi wave 1 xong**. Payload English theo luật agent-facing của repo;
phần dẫn tiếng Việt chỉ nói khi nào dùng. Chạy **theo thứ tự**, mỗi prompt một session Claude Code
**interactive** ở đúng repo ghi trên đầu.

> **Đã đổi so với bản sáng, đọc trước khi dùng:**
> 1. `--max-turns` **không tồn tại** trong Claude Code 2.1.177 (`claude --help | grep -c -- --max-turns` = 0).
>    Mọi lệnh `claude -p` chỉ dùng `--max-budget-usd`. Bản prompt cũ có cờ này — đã bỏ.
> 2. **Writer không review, không push, không mở PR** (phép đo wave 1: `codex` không khởi tạo được trong
>    sandbox Seatbelt). Probe push vì thế là của **dispatcher** — chạy trong shell thường, không qua `claude -p`.
> 3. Hai câu hỏi owner của wave 1 đã trả lời xong, **không phải làm lại**: `claude-sonnet-4-5` hợp lệ,
>    không fallback, $0.0196/lượt nguội; hardening số 1 = **CI làm cổng cuối** (Plexco đã có `ci.yml` chạy
>    trên `pull_request:`), không dựng re-verify phía dispatcher.
> 4. Task file đã thêm dòng: worktree là checkout sạch, **không có `node_modules`** → writer phải
>    `pnpm install --frozen-lockfile` trước `verify`. Probe (b) ở prompt 2 kiểm đúng điều đó.

---

## Prompt 1 — Wave 1 · ✅ XONG 2026-09-09

Kit `ap3/` đã xây trên nhánh `feat/ap3` của repo `Claude template`: 25 file kit + 8 file test,
`AP3_KIT_TEST: PASS`, 3 probe thật PASS, 4 vòng review Codex (~50 finding đã sửa), chưa push/merge/cài.
Bằng chứng: `docs/level3-native/W1-{HANDOVER,REVIEW,KNOWN-GAPS,DECISION-codex-sandbox}.md`.
Không cần chạy lại. Prompt gốc giữ trong git history của file này.

---

## Prompt 2 — Wave 2: cài kit, probe, bắn run đầu tiên · chạy ở repo **Plexco app**

Session interactive. Prompt bắt Claude dừng trước mỗi `git push` và trước khi load plist launchd.

```text
You are running ap3 wave 2 in this repo (Plexco app). Wave 1 is done: the kit lives on branch feat/ap3
of ~/Projects/Claude template and is not installed anywhere yet.

Read first, in order:
  ap3/README-W2.md
  the CLAUDE.md section between <!-- ap3-workflow:start --> and <!-- ap3-workflow:end -->
  docs/autopilot-templates/ap3-workflow.md   (part 2 is the BINDING correction: the writer only codes;
                                              the dispatcher reviews, pushes and opens the PR)
  ~/Projects/Claude template/docs/level3-native/W1-HANDOVER.md and W1-KNOWN-GAPS.md

Then do the steps below in order and stop where told. This is an interactive session: pause and show me
the exact command before every `git push` and before loading any launchd plist. Never use --max-turns
(it does not exist in this CLI version); budget every claude -p with --max-budget-usd only.

Step 0 - Preconditions (report each; never fix silently)
- `git status --short`: this working tree carries ~59 modified docs and several untracked files that are
  NOT ap3 (my own work from 2026-09-08). Do not stage, stash, revert or clean them.
- `git fetch origin && git log --oneline origin/main..main`: expect exactly one docs commit ahead.
- `gh auth status` succeeds and `git config --get remote.origin.url` is the plexco-app repo.
- W1-HANDOVER.md reports AP3_KIT_TEST: PASS and 3 probes PASS.
- `docker ps` shows plexco-postgres-1 on 5432 (needed later, not by the first slice).

Step 1 - Commit the ap3 governance change. EXACT paths, never `git add -A`:
  git add .gitignore AGENTS.md CLAUDE.md docs/00-start-here/HANDOFF.md docs/autopilot-ONBOARDING.md \
          docs/standards/decisions.md docs/autopilot-templates/ap3-workflow.md ap3/
  `git diff --cached --stat` must list only those paths. Run `pnpm review:check:changed` (expect PASS).
  Commit message:
    docs(ap3): DD-120 proposal - ap3 proactive lane for code-quality-p2; first queue task + registry
  Pause and show me the push command; then push main.

Step 2 - Install the kit. It is a DRY RUN by default:
  bash "$HOME/Projects/Claude template/ap3/install.sh" "$PWD"
  Show me the printed .claude/settings.json merge diff and wait for my go-ahead, then:
  bash "$HOME/Projects/Claude template/ap3/install.sh" "$PWD" --yes
  Verify after the write, and report each:
   - .claude/settings.json still has fallbackModel and BOTH existing review:check:changed hooks, and now
     also has the two ap3 hooks (scope-guard on PreToolUse Edit|Write|MultiEdit, finish-guard on Stop);
   - sandbox.enabled true, autoAllowBashIfSandboxed true, and the allow list has NO gh/codex entry and
     the deny list blocks `git push` (the writer must not be able to push);
   - .claude/skills/ap3-slice and ap3-review exist;
   - the launchd plist is written but NOT loaded (`launchctl list | grep ap3` is empty);
   - `git status --short` shows .claude/settings.json and .gitignore modified, ap3/ machinery untracked.

Step 3 - Writer env: create ap3/env (confirm `git check-ignore ap3/env` succeeds) containing
  DATABASE_URL_TEST=<the value from my shell environment - do not print it back to me>
  The first slice does not need it (pnpm test:core has no DB), the later ones do. Never commit it.

Step 4 - Probes on this repo. Report each as: command, exit code, permission_denials, total_cost_usd,
what happened. Write the raw results to ap3/state/probes/W2-<date>.md (gitignored).

  (a) Dispatcher push path - plain shell, NOT claude -p, because the dispatcher is unsandboxed bash:
      create branch ap3-probe-<timestamp> from origin/main, make an empty commit, push it, open a DRAFT
      PR with gh, then close the PR and delete both the remote and local branch. Confirm the repo is
      left exactly as before (no branch, no open PR).

  (b) Writer path - the decisive one. From a throwaway worktree of origin/main
      (`git worktree add /tmp/ap3-probe-wt origin/main`), run the writer exactly as the dispatcher will:
        cd /tmp/ap3-probe-wt && claude -p "Run 'pnpm install --frozen-lockfile', then 'pnpm --filter @plexco/core run typecheck', then 'pnpm test:core'. Report the pass count of each. Change no files." \
          --permission-mode dontAsk --max-budget-usd 2 --output-format json
      This measures three things at once: the E12 fix on Plexco's real merged settings
      (expect permission_denials: []), whether pnpm install works inside the sandbox from a fresh
      worktree (no node_modules there), and the real cost of a trivial writer turn.
      Expect core = 153 tests. If it fails ONLY because a pnpm store/cache path is blocked by the
      sandbox, the allowed fix is adding that path to sandbox.filesystem.allowWrite in
      ap3/settings.plexco.json and re-running install.sh --yes - report it to me first. Never widen
      permissions.allow, never add excludedCommands, never disable the sandbox.
      Remove the throwaway worktree afterwards with `git worktree remove`.

Step 5 - Lint and arm:
      bash ap3/lint-task.sh ap3/queue/core-package-const-has-no-consumer.md      # expect: OK
  Pause; show me the launchd command; then:
      bash "$HOME/Projects/Claude template/ap3/install-launchd.sh" "$PWD" --load
  Confirm with `launchctl list | grep ap3`. Then watch ~/Library/Logs/ap3/ for the first tick (within
  15 minutes) and report the line: expect `STARTED core-package-const-has-no-consumer`, or one of
  PAUSED / BUSY / FETCH_FAILED / NOTHING_QUEUED / CAP_HIT / INVALID_TASK with your reading of why.

Step 6 - Hands off. Do NOT open, edit, inspect-and-fix or clean anything under ap3/state/worktrees/ -
that is the writer's worktree and the dispatcher owns its lifecycle. Report: the two commit SHAs, the
probe table, the dispatcher log lines, and what I should expect next (Telegram READY with a PR URL, or
HALT with a reason). Remind me that an ap3 PR is merged only after CI is green. Stop.
```

---

## Prompt 3 — Sau khi PR đầu merge **và** bundle v6 đã merge · chạy ở repo **Plexco app**

```text
ap3 follow-up in Plexco app. Verify these preconditions first and stop if any fails:
- the PR for core-package-const-has-no-consumer is merged, its CI was green, and
  ap3/state/trust.json shows code-quality-p2 with clean_runs = 1 and paused = false;
- bundle v6 is merged: `git merge-base --is-ancestor 72394fe origin/main` succeeds.

1. Re-measure both drafts in ap3/queue/_after-v6/ against the current origin/main: the six copies of the
   `type Tx` alias and their line numbers; that apps/web/lib/request-policy.ts and its test exist; the
   duplicated redirect()/noReferrer() blocks and their lines. Update ONLY the Problem/Context text.
   Do not change class, scope, verify or budget unless a measurement forces it - then say why.
2. Promote ONLY db-tx-type-alias-duplicated-six-files.md into ap3/queue/. The web-oauth one stays a
   draft until the db task is merged (the class allows one run per day anyway, and the oauth task will
   trigger a security review round - do that with trust already earned).
   Move the finished task file to ap3/queue/done/core-package-const-has-no-consumer.md.
3. bash ap3/lint-task.sh ap3/queue/db-tx-type-alias-duplicated-six-files.md   # expect: OK
   This task needs the DB suite: confirm ap3/env has DATABASE_URL_TEST and plexco-postgres-1 is up.
4. Commit exactly those files:
     docs(ap3): queue db-tx-type-alias after bundle v6; archive first slice
   Pause; show me the push command; then push.
5. Report what the next dispatcher tick should print, and stop.
```

---

## Sau ba run READY

`bash ap3/report.sh --since 30d` → dán số vào `current-workflow.md § Position on the artifact ladder`
bên repo `Claude template`, rồi đo lại `DEMONSTRATED_STEP`. Chỉ ghi step 3 khi cả ba run có
`human_interventions = 0` trong run và `merged_unchanged = true`.
