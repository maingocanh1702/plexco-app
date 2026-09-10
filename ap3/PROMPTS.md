# ap3 — prompt cho các bước kế tiếp (Plexco app)

Cập nhật **2026-09-09 (tối)** sau khi lần cài thử đầu tiên lộ ra một lỗi thiết kế của kit. Payload
English theo luật agent-facing của repo. Chạy **theo thứ tự**, mỗi prompt một session Claude Code
**interactive** ở đúng repo ghi trên đầu.

> **Trạng thái (2026-09-10, tối):** wave 1 ✅ · wave 1.1 ✅ · **wave 2 ✅ — run tự trị đầu tiên đã READY và
> được merge**: PR #2 (`ap3/core-package-const-has-no-consumer`, head `02d1010`, merge `751e019`), $3.01,
> 49 turns, 1 finding Codex thật ở round 1 được fix writer tự sửa, CLEAN, dispatcher tự push + mở PR.
> Nhật ký đầy đủ: `ap3/state/W2-HANDOFF-2026-09-10.md`. Ba lỗi gốc tìm ra trên đường đi, đều đã sửa trên
> `origin/main` (`48c08bf`, `026bfdf`, `f00e613`): task file dẫn doc untracked → INVALID_TASK; launchd
> SIGKILL writer khi tick thoát → `AbandonProcessGroup=true`; CI `review:check` không có ref `main` trên
> checkout `pull_request` → step "Ensure local main ref". Ruleset `main-ci-gate` đã bật (require `verify`,
> admin bypass).
>
> **Luật vận hành rút ra (áp cho mọi session sau):**
> - Task trong `ap3/queue/` chỉ được dẫn file **tracked** — dispatcher lint trong worktree của `origin/main`.
> - **Push trước, unpause sau**: tick khởi động lại pin task + `writer_model` từ `origin/main`.
> - **Không bao giờ bấm "Update branch"/rebase/push lên nhánh `ap3/*`**: head khác SHA đã review ⇒
>   dispatcher tính "merged with human changes" ⇒ pause class, reset `clean_runs`. Ruleset để trống
>   "Require branches to be up to date" là vì thế.
> - Push thẳng lên `main` giờ là dùng quyền bypass admin — chỉ cho governance/docs; code thật đi qua PR.
> - Kit test suite (`ap3/test/run.sh` bên Claude template) FAIL chừng nào class Plexco còn paused (K4).
>
> Lịch sử wave 2 lần cài đầu (2026-09-09) giữ dưới đây để tra cứu:
>
> **Chuyện gì đã xảy ra.** `install.sh` merge hợp đồng writer vào `.claude/settings.json` của Plexco —
> merge **đúng** như đặc tả (giữ `fallbackModel`, giữ cả hai hook `review:check:changed`), nhưng file đó
> **repo-wide và tracked**, nên `sandbox` + `permissions.deny` của writer lập tức chặn `gh` · `git push` ·
> `docker` · `psql` trong **chính session interactive của bạn**, và sẽ bị commit vào `main`. Hai hook ap3
> thì không sao — chúng no-op khi không có `$AP3_TASK`; `sandbox`/`permissions.deny` **không có** đường
> no-op như vậy. Đó mới là lỗi, không phải cái merge.
>
> **Đã xử lý:** `.claude/settings.json` đã `git checkout` về bản committed (chỉ còn `fallbackModel` + hai hook
> cũ), và revert có hiệu lực **ngay trong session đang chạy** — Claude Code đọc lại settings trong phiên,
> không cần khởi động lại. Machinery `ap3/` và `.claude/skills/ap3-*` còn lại là bản tiền-1.1, sẽ bị ghi đè
> khi cài lại. Wave 1.1 đã sửa gốc: contract truyền theo lần chạy bằng `--settings` + `--setting-sources ''`.
>
> **Không chọn phương án `.claude/settings.local.json`**: `deny` thắng `allow` bất kể nguồn, nên nó nhiều
> khả năng không gỡ được; và kể cả gỡ được thì đó là băng dán che đúng chỗ cần sửa.

---

## Prompt 1 — Wave 1 · ✅ XONG

Kit `ap3/` trên nhánh `feat/ap3` của repo `Claude template`: 25 file kit + 8 file test,
`AP3_KIT_TEST: PASS`, 3 probe PASS, 4 vòng Codex (~50 finding). Chưa push/merge.
Bằng chứng: `docs/level3-native/W1-{HANDOVER,REVIEW,KNOWN-GAPS,DECISION-codex-sandbox}.md`.

---

## Prompt 1.5 — Wave 1.1: hợp đồng writer thành per-run · chạy ở repo **Claude template**

Chạy **trước** khi quay lại wave 2. Vẫn trên nhánh `feat/ap3`.

```text
ap3 wave 1.1 - one measured design fix, on the existing feat/ap3 branch.

WHAT HAPPENED. The first real install into ~/Projects/Plexco app merged the writer contract into that
repo's committed .claude/settings.json, exactly as install.sh intends. Within minutes it broke the
owner's own interactive session in that repo: `gh` (even `gh pr list`), `git push` (even --dry-run),
`docker ps` and `psql` were all hard-denied - and `docker ps` had worked in that same session minutes
earlier, before the install. The merge itself was correct: fallbackModel survived, both
review:check:changed hooks survived, the ap3 hooks were appended. The ARCHITECTURE is the bug:
.claude/settings.json is repo-wide AND tracked, so the writer's restrictions govern every Claude Code
session anyone opens in that repo, and they would have been committed to main.

The two ap3 hooks are fine - they no-op on `[ -n "$AP3_TASK" ]`. `sandbox` and `permissions.deny` have
no such escape: they are unconditional for every session that reads the file. That asymmetry is the
whole finding. The owner has already reverted the file in Plexco.

THE FIX. Make the writer contract per-run instead of repo-wide, with the flag that already exists:
`--settings <file-or-json>` ("Path to a settings JSON file or a JSON string to load additional settings
from"). Verified present in 2.1.177.

1. dispatch.sh, launch_writer(): pass `--settings` with an ABSOLUTE path to the MAIN checkout's copy,
   never the worktree's copy:  --settings "$REPO/ap3/writer-settings.json"
   The writer must not be able to edit its own contract - the same reason the task file is read with
   `git show <base_sha>:`. If that file is missing, HALT the run with a named reason; never silently
   start a writer with no sandbox (under dontAsk with no sandbox, generic bash is denied and every run
   would fail in a confusing way).

2. install.sh: by default do NOT touch .claude/settings.json at all. Resolve the writer contract (the
   target's ap3/settings.<project>.json if present, else settings.template.json) and write it to
   <target>/ap3/writer-settings.json - tracked, and printed as a diff when it already exists. If you
   keep the old behaviour, it must be behind an explicit --repo-wide flag whose help text states what
   it costs; merge-settings.py and its Plexco fixture test stay for that path only.

3. PROBE IT - this is the acceptance test; do not assume the flag carries what we need. In a scratch
   repo whose .claude/settings.json has NO sandbox and NO permissions:
     claude -p "Create a.txt containing ok, run 'bash -c \"echo probe-ok\"', then git add and commit it" \
       --permission-mode dontAsk --max-budget-usd 0.5 \
       --settings /abs/path/to/writer-settings.json --output-format json
   Expect permission_denials: [] and a real commit. That outcome is only possible if --settings carried
   BOTH the sandbox (so bash is auto-approved) and permissions.allow. Then prove the negative: the same
   run WITHOUT --settings must be denied. Record both runs in ap3/probes/RESULTS.md with real output.
   If --settings turns out NOT to carry the sandbox, stop and write the finding - do not fall back to
   the repo-wide install.

4. Tests in ap3/test/: assert that install.sh leaves an existing .claude/settings.json byte-identical
   by default, and that the writer invocation built by dispatch.sh contains --settings with an absolute
   path that is not inside the worktree.

5. Update in the same pass: DESIGN.md section 4 (the writer contract is per-run, and why), the ripple
   list in W1-DECISION-codex-sandbox.md, W1-KNOWN-GAPS.md (add this as a measured finding - close
   nothing), ap3/README.md, ap3/settings.template.notes.md.

6. One Codex round on the diff: bash ap3/review.sh code --base main. Fix the findings or record the
   disagreement. Then bash ap3/test/run.sh -> AP3_KIT_TEST: PASS.

7. Write docs/level3-native/W1.1-HANDOVER.md: what changed, BOTH probe results verbatim, the test line,
   the review verdict, and the exact re-install command for Plexco. Do not push, merge or install
   anything. Print that file's path as the last line.
```

---

## Prompt 2 — Wave 2: cài kit, probe, bắn run đầu tiên · chạy ở repo **Plexco app**

Chỉ chạy khi `W1.1-HANDOVER.md` đã có. Session interactive; prompt bắt dừng trước mỗi `git push` và
trước khi load plist.

```text
You are running ap3 wave 2 in this repo (Plexco app). Waves 1 and 1.1 are done in
~/Projects/Claude template (branch feat/ap3); nothing is installed here yet. An earlier attempt at this
was stopped at Step 4 because the kit installed its writer contract repo-wide into .claude/settings.json
and blocked gh/git push/docker in the owner's own session; wave 1.1 fixed that by passing the contract
per-run with --settings. That file has been reverted here, so this repo starts clean.

Read first, in order:
  ap3/README-W2.md
  the CLAUDE.md section between <!-- ap3-workflow:start --> and <!-- ap3-workflow:end -->
  docs/autopilot-templates/ap3-workflow.md   (part 2 is the BINDING correction: the writer only codes;
                                              the dispatcher reviews, pushes and opens the PR)
  ~/Projects/Claude template/docs/level3-native/W1-HANDOVER.md, W1-KNOWN-GAPS.md, W1.1-HANDOVER.md

Do the steps in order and stop where told. Pause and show me the exact command before every `git push`
and before loading any launchd plist. Never use --max-turns (it does not exist in this CLI version);
budget every claude -p with --max-budget-usd only.

Step 0 - Preconditions (report each; never fix silently)
- `git status --short`: this tree carries ~59 modified docs and untracked files that are NOT ap3 (my own
  work from 2026-09-08). Do not stage, stash, revert or clean them.
- `git status --short .claude/settings.json` prints nothing (it was reverted; it must stay untouched).
- `git fetch origin && git log --oneline origin/main..main`: expect one docs commit ahead.
- `gh auth status` succeeds; `gh pr list --limit 1` and `docker ps` both work in THIS session. If any of
  them is denied, a writer contract is still installed repo-wide somewhere: stop and report.
- W1.1-HANDOVER.md reports PROBE_SETTINGS: PASS and AP3_KIT_TEST: PASS.
- The FS_ISOLATION_UNSAFE tripwire will not fire: no settings scope may declare sandbox.filesystem while
  the writer's claude is < 2.1.246. Verified 2026-09-10 on this machine (~/.claude/settings.json,
  ~/.claude/settings.local.json, this repo's .claude/settings.json and .claude/settings.local.json all
  declare none). Re-check it, and if any of them has since gained a sandbox block, stop and tell me -
  the fix is upgrading claude to >= 2.1.246, not deleting the guard.

Step 1 - Commit what is still uncommitted. The governance commit 1688619 is ALREADY on origin/main
  from the previous attempt; do not redo it. What is left are the post-1688619 doc edits, the writer
  contract install.sh already wrote, and (owner decision below) the kit machinery. EXACT paths, never
  `git add -A`:
  git add .gitignore AGENTS.md CLAUDE.md docs/standards/decisions.md \
          docs/autopilot-templates/ap3-workflow.md \
          ap3/PROMPTS.md ap3/README-W2.md ap3/settings.plexco.json \
          ap3/writer-settings.json
  `git diff --cached --stat` must list only those paths, and must NOT list .claude/settings.json.
  ap3/writer-settings.json is NOT optional: dispatch.sh reads it from origin/main
  (`git cat-file -e "$origin_sha:ap3/writer-settings.json"`, then `git show` into the run dir) so the
  writer contract is the reviewed one, never a working-tree edit. While it is absent on origin/main
  every launchd tick exits NO_WRITER_SETTINGS and nothing ever starts.
  (.gitignore's only change is install.sh's own `.ap3-run/` line. ap3/settings.plexco.json gained the
  wave-1.1 hardening keys sandbox.failIfUnavailable=true and sandbox.allowUnsandboxedCommands=false -
  install.sh ABORTS without them, which is how they were found; ap3-workflow.md is the regenerated
  mirror of the post-1.1 DESIGN.md.)
  OWNER DECISION, ask me before acting: whether the ap3 machinery install.sh copies into ap3/
  (dispatch.sh, review.sh, aplib.py, hooks/, prompts/, ...) gets committed here. My default is YES -
  the machinery decides what may run autonomously in this repo, so its exact version should be
  reviewable, diffable and revertible with the repo - with a one-line header note in ap3/README.md
  saying it is generated by install.sh and must never be hand-edited. Committing it does not add a
  sync burden that untracked copies avoid: either way the only update path is re-running install.sh.
  Run `pnpm review:check:changed` (expect PASS). Commit message:
    docs(ap3): DD-120 proposal - ap3 proactive lane for code-quality-p2; first queue task + registry
  Pause and show me the push command; then push main.

Step 2 - Verify the kit install (ALREADY DONE by me on 2026-09-10 with the wave-1.1 kit:
  `bash "$HOME/Projects/Claude template/ap3/install.sh" "$PWD" --yes` — do NOT re-run it unless a
  check below fails; if one does, show me the dry run first). Verify and report each:
   - `git status --short .claude/settings.json` still prints NOTHING. If the install modified it, the
     kit is pre-1.1: revert the file, stop, and tell me.
   - ap3/writer-settings.json exists with sandbox.enabled true, autoAllowBashIfSandboxed true, no gh and
     no codex in permissions.allow, and `git push` in permissions.deny.
   - .claude/skills/ap3-slice and ap3-review exist; the launchd plist is written but NOT loaded
     (`launchctl list | grep ap3` is empty).
   - `gh pr list --limit 1` and `docker ps` STILL work in this session (the regression test for 1.1).

Step 3 - Writer env: ap3/env ALREADY EXISTS (install.sh wrote it). Only confirm `git check-ignore
  ap3/env` succeeds and that the file contains a `DATABASE_URL_TEST=` line - `grep -c '^DATABASE_URL_TEST=' ap3/env`
  must print 1. Never print its value back to me. If it is missing, create it with
  DATABASE_URL_TEST=<the value from my shell environment - do not print it back to me>
  The first slice does not need it (pnpm test:core has no DB); the later ones do. Never commit it.

Step 4 - Probes on this repo. Report each as: command, exit code, permission_denials, total_cost_usd,
what happened. Write raw output to ap3/state/probes/W2-<date>.md (gitignored).

  (a) Dispatcher push path - plain shell, because the dispatcher is unsandboxed bash: create branch
      ap3-probe-<timestamp> from origin/main, make an empty commit, push it, open a DRAFT PR with gh,
      then close the PR and delete the remote and local branch. Confirm the repo is left as before.

  (b) Writer path - the decisive one. From a throwaway worktree of origin/main
      (`git worktree add /tmp/ap3-probe-wt origin/main`), run the writer the way the dispatcher will,
      including the per-run contract by ABSOLUTE path to THIS repo's copy (not the worktree's):
        cd /tmp/ap3-probe-wt && claude -p "Run 'pnpm install --frozen-lockfile', then 'pnpm --filter @plexco/core run typecheck', then 'pnpm test:core'. Report the pass count of each. Change no files." \
          --permission-mode dontAsk --max-budget-usd 2 \
          --settings "<absolute path of this repo>/ap3/writer-settings.json" --setting-sources '' --output-format json
      This measures at once: that --settings carries the contract on Plexco's real files
      (expect permission_denials: []), that pnpm install works inside the sandbox from a worktree with
      no node_modules, and the real cost of a trivial writer turn. Expect core = 153 tests.
      If it fails ONLY because a pnpm store/cache path is blocked by the sandbox, the one allowed fix is
      adding that path to sandbox.filesystem.allowWrite in ap3/settings.plexco.json and re-running
      install.sh --yes - report it to me first. Never widen permissions.allow, never add
      excludedCommands, never disable the sandbox, never put the contract back into .claude/settings.json.
      Remove the throwaway worktree afterwards with `git worktree remove`.

Step 5 - Lint and arm:
      bash ap3/lint-task.sh ap3/queue/core-package-const-has-no-consumer.md      # expect: OK
  Pause; show me the launchd command; then:
      bash "$HOME/Projects/Claude template/ap3/install-launchd.sh" "$PWD" --load
  Confirm with `launchctl list | grep ap3`. Watch ~/Library/Logs/ap3/ for the first tick (within 15
  minutes) and report the line: expect `STARTED core-package-const-has-no-consumer`, or one of
  PAUSED / BUSY / FETCH_FAILED / NOTHING_QUEUED / CAP_HIT / INVALID_TASK with your reading of why.

Step 6 - Hands off. Do NOT open, edit, inspect-and-fix or clean anything under ap3/state/worktrees/.
Report: the two commit SHAs, the probe table, the dispatcher log lines, and what I should expect next
(Telegram READY with a PR URL, or HALT with a reason). Remind me that an ap3 PR is merged only after CI
is green. Stop.
```

---

## Prompt 3 — Sau khi PR đầu merge **và** bundle v6 đã merge · chạy ở repo **Plexco app**

```text
ap3 follow-up in Plexco app. Verify these preconditions first and stop if any fails:
- the PR for core-package-const-has-no-consumer is merged (PR #2, 751e019) and
  ap3/state/trust.json shows code-quality-p2 with clean_runs >= 1 and paused = false;
  slice 2 (core-todayiso-has-no-callers) is either merged or not yet started — never in flight
  (`tail -1 ~/Library/Logs/ap3/dispatch-Plexco-app.log` is not BUSY/STARTED);
- bundle v6 is merged: `git merge-base --is-ancestor 72394fe origin/main` succeeds.

1. Re-measure both drafts in ap3/queue/_after-v6/ against the current origin/main: the six copies of the
   `type Tx` alias and their line numbers; that apps/web/lib/request-policy.ts and its test exist; the
   duplicated redirect()/noReferrer() blocks and their lines. Update ONLY the Problem/Context text.
   Do not change class, scope, verify or budget unless a measurement forces it - then say why.
2. Promote ONLY db-tx-type-alias-duplicated-six-files.md into ap3/queue/. The web-oauth one stays a
   draft until the db task is merged (it will trigger a security round - do that with trust earned).
   Move every merged task file (core-package-const-has-no-consumer.md, and core-todayiso-has-no-callers.md
   if its PR is merged) to ap3/queue/done/.
3. bash ap3/lint-task.sh ap3/queue/db-tx-type-alias-duplicated-six-files.md   # expect: OK
   This one needs the DB suite: confirm ap3/env has DATABASE_URL_TEST and plexco-postgres-1 is up.
4. Commit exactly those files:
     docs(ap3): queue db-tx-type-alias after bundle v6; archive first slice
   Pause; show me the push command; then push.
5. Report what the next dispatcher tick should print, and stop.
```

---

## Prompt S — Nợ bảo mật có sẵn (ngoài ap3, PR thường) · chạy ở repo **Plexco app** · làm trong tuần

"OSV full dependency scan" đỏ trên **mọi** push main từ 2026-09-09 (đo run `34442926564`): `next 15.5.21`
→ 15.5.24 (GHSA-2xp9-vwfh-vxw4 9.5, GHSA-p293-qw3h-jr36 9.0), `sharp 0.35.3` → 0.35.4 (GHSA-rgj7-g3m4-5g8c
8.9, đang pin bằng `pnpm.overrides`), `vitest`/`@vitest/mocker 3.2.6` (GHSA-82fw-gwwq-j7x9 5.9, OSV chỉ
fix ở 4.1.11 = major). Không thuộc class `code-quality-p2`, không nằm trong `allowed_scope` → PR thường,
ruleset `main-ci-gate` gác. Chạy khi **không** có run ap3 đang BUSY (xem log dispatcher).

```text
Security dependency bump, two PRs, CI is the gate. Every push/PR creation pauses for my "go".

PR A — patch-level, do now:
1. `git switch -c fix/deps-next-sharp-2026-09 origin/main`.
2. apps/web/package.json: "next" stays "^15.1.4" (range already admits 15.5.24); root package.json
   pnpm.overrides.sharp: "^0.35.0" → "^0.35.4". Then `pnpm update next@15.5.24 sharp@0.35.4
   --recursive` (or `pnpm install` after editing the override) and confirm in pnpm-lock.yaml:
   `next@15.5.24` and `sharp@0.35.4` resolved, nothing else changed except their transitive deps
   (`git diff --stat pnpm-lock.yaml` and a quick read of the hunk).
3. Local gate, all green: `pnpm -w typecheck && pnpm -w lint && pnpm --filter @plexco/web run build
   && pnpm -w test` (Postgres plexco-postgres-1 must be up; DATABASE_URL_TEST from your shell).
4. Commit `fix(deps): next 15.5.24, sharp 0.35.4 — OSV Critical/High (GHSA-2xp9-vwfh-vxw4,
   GHSA-p293-qw3h-jr36, GHSA-rgj7-g3m4-5g8c)`; pause; push; `gh pr create` with the three GHSA
   links and the local gate output in the body; `gh pr checks --watch`. Do not merge — I merge.

PR B — vitest, only after PR A is merged:
5. Check `pnpm view vitest versions --json | tail` and the advisory GHSA-82fw-gwwq-j7x9 for a 3.x
   fixed release. If one exists, bump to it on a branch `fix/deps-vitest-2026-09` exactly like PR A.
   If the only fix is 4.x, STOP and write me a one-paragraph migration note (breaking changes that
   touch this repo's vitest configs and the 4 packages that depend on ^3.0.4) — the major bump is a
   separate decision, not part of this task.
```

---

## Prompt 4 — Sau ba run READY (`clean_runs = 3`) · Plexco **và** Claude template

Điều kiện: `ap3/state/trust.json` `code-quality-p2.clean_runs >= 3`, cả ba row trong
`ap3/state/evidence.local.jsonl` có `terminal: READY`, `human_interventions: 0`, `merged_unchanged: true`.

```text
ap3 trust milestone: three clean runs. Read-only first, quote the numbers:
`bash ap3/report.sh --since 30d`; the three READY rows of ap3/state/evidence.local.jsonl
(slug, total_cost_usd, review_rounds, permission_denials, merged_unchanged); trust.json.
Stop if any row has human_interventions != 0 or merged_unchanged != true.

1. Plexco: widen `code-quality-p2.allowed_scope` in ap3/routines.json ONLY to globs the three
   evidence rows actually touched plus the two _after-v6 drafts' scopes; update the class's
   `evidence` string with the three PR numbers. Optionally raise max_runs_per_day to 2 — say why.
   Commit `chore(ap3): widen code-quality-p2 scope from three clean runs`; pause; push.
2. Claude template (feat/ap3): delete the `--repo-wide` path from ap3/install.sh, its test branch
   in ap3/test/writer-settings.sh, and its mention in README/DESIGN — the owner rule was "delete
   after 3 clean runs; it reproduces the 2026-09-09 incident". `bash ap3/test/run.sh` → PASS.
   Commit `chore(ap3): remove --repo-wide (3 clean runs reached)`; pause; push feat/ap3.
3. Claude template: update `current-workflow.md § Position on the artifact ladder` with the
   report numbers and set DEMONSTRATED_STEP = 3, citing the three PRs and the ruleset as the
   human-merge gate. Commit `docs: ladder position — step 3 demonstrated (3 clean ap3 runs)`;
   pause; push.
4. Print the three commit SHAs and stop.
```
