# ap3 trên Plexco — wave 2, runbook cho owner

Cập nhật 2026-09-09 (chiều), **sau khi wave 1 xong**. Đọc kèm `docs/autopilot-templates/ap3-workflow.md`
(mirror contract + phần sửa bắt buộc) và `~/Projects/Claude template/docs/level3-native/W1-HANDOVER.md`.

## Trạng thái sau wave 1 — cái gì đã đổi so với bản sáng

- **Kit đã xây xong** trên nhánh `feat/ap3` của repo `Claude template`: 25 file kit + 8 file test,
  `AP3_KIT_TEST: PASS`, 3 probe thật PASS, 4 vòng review Codex (~50 finding đã sửa). Chưa push/merge/cài.
- **Phân vai đã sửa theo phép đo (bắt buộc):** `codex` không khởi tạo được trong sandbox Seatbelt.
  ⇒ **writer chỉ code**, dừng ở `.ap3-run/READY-FOR-REVIEW`; **dispatcher** (bash launchd, ngoài sandbox)
  chạy scope-check độc lập → review Codex → **chỉ khi CLEAN** mới push + mở PR + ghi evidence.
  Hệ quả: writer **không cần** domain openai, không cần `gh`, không được push — `ap3/settings.plexco.json`
  đã cắt đúng như vậy.
- **Ba quyết định của owner đã chốt** (bạn không phải quyết lại):
  1. `writer_model: claude-sonnet-5` (đổi từ `claude-sonnet-4-5` ngày 2026-09-10 theo yêu cầu owner —
     Sonnet 5 là mặc định của repo, xem `fallbackModel` trong `.claude/settings.json`). Đã đo trên máy
     này: `claude -p … --model claude-sonnet-5` → `subtype: success`, `modelUsage: ['claude-sonnet-5']`
     (không fallback), **$0.116** cho một lượt nguội. `budget_usd: 6` của slice đầu vẫn dư.
  2. Hardening W2 số 1 = **CI làm cổng cuối**, không dựng re-verify phía dispatcher. Lý do: Plexco đã có
     `.github/workflows/ci.yml` chạy trên `pull_request:` với typecheck · format · `review:check` · lint ·
     build · `pnpm -w test` + Postgres service. Worktree của ap3 không có `node_modules` và cần DB ⇒
     re-verify tại chỗ dễ sinh `VERIFY_FAIL` giả. **Luật: không merge PR ap3 khi CI chưa xanh.**
  3. Ba ripple trong file chuẩn bị đã reconcile: `settings.plexco.json` (cắt openai/codex/gh),
     `CLAUDE.md` + `AGENTS.md` + DD-120 D3 + HANDOFF §5b (writer↛review/PR), `CLAUDE-section.md` (đánh dấu
     lịch sử), mirror `ap3-workflow.md` (thêm phần sửa bắt buộc).
- **`--max-turns` không tồn tại** trong Claude Code 2.1.177 (đã kiểm: `claude --help | grep -c -- --max-turns`
  = 0). Mọi lệnh `claude -p` chỉ dùng `--max-budget-usd`.

## ⚠️ Wave 1.1 — phải chạy trước wave 2 (phát hiện 09/09 tối)

Lần cài thử đầu tiên merge hợp đồng writer vào `.claude/settings.json` (repo-wide **và tracked**) và
lập tức chặn `gh` · `git push` · `docker` · `psql` trong chính session interactive của owner. Merge
không sai — kiến trúc sai: hai hook ap3 no-op được theo `$AP3_TASK`, còn `sandbox` và
`permissions.deny` thì không, nên chúng áp cho mọi session đọc file đó, và sẽ vào `main`.

Đã xử lý: `.claude/settings.json` đã revert về bản committed. Cách sửa: dispatcher truyền
`--settings <repo>/ap3/writer-settings.json` (đường dẫn tuyệt đối tới checkout chính, không phải
worktree — writer không sửa được hợp đồng của chính nó). Prompt 1.5 trong `ap3/PROMPTS.md` là bản
đặc tả đầy đủ, kèm probe bắt buộc chứng minh `--settings` có mang theo sandbox thật.

## Việc còn lại, theo thứ tự (prompt sẵn ở `ap3/PROMPTS.md`)

1. **Commit + push** phần governance ap3 (7 đường dẫn, không `git add -A`) — working tree đang có ~59 file
   docs khác của bạn từ 08/09, đừng gói chung.
2. **Cài kit**: `bash "$HOME/Projects/Claude template/ap3/install.sh" "$PWD"` — mặc định **dry run**, in diff
   merge settings; chạy lại với `--yes` mới ghi. Kiểm sau khi ghi: `fallbackModel` còn, **cả hai** hook
   `review:check:changed` còn, hai hook ap3 được thêm; plist được ghi nhưng **chưa load**.
3. **`ap3/env`** (gitignored): `DATABASE_URL_TEST=...` cho writer chạy `pnpm test:db`. Slice đầu
   (`core-package-const-has-no-consumer`) chỉ cần `pnpm test:core` — không có DB vẫn chạy được.
4. **Hai probe trên chính repo này**: (a) dispatcher push/`gh` (ngoài sandbox, rủi ro thấp hơn bản cũ);
   (b) writer chạy `pnpm test:core` trong sandbox từ một worktree sạch. Nếu (b) hỏng vì thiếu
   `node_modules` trong worktree → đó là dữ liệu thật cho `verify` của task, ghi lại rồi quyết.
5. **Lint + arm**: `bash ap3/lint-task.sh ap3/queue/core-package-const-has-no-consumer.md` → `OK`, rồi load
   plist. Tick 15 phút sau in `STARTED core-package-const-has-no-consumer`.
6. **Không đụng gì nữa.** Telegram báo READY kèm URL PR (hoặc HALT kèm lý do). Bạn mở PR, **đợi CI xanh**,
   rồi merge. Tick kế tiếp ghi `clean_runs = 1` và gỡ worktree.
7. **Sau khi bundle v6 merge**: đưa hai file trong `ap3/queue/_after-v6/` lên `ap3/queue/`, từng cái một
   (prompt 3).

## Dừng và bật lại

HALT/crash/PR bị đóng/sửa tay trước merge ⇒ class `code-quality-p2` bị `paused` trong `ap3/state/trust.json`;
bật lại bằng `bash ap3/unpause.sh <class>` hoặc sửa `ap3/routines.json` (commit có chủ ý). Kill switch toàn
cục: `touch ap3/PAUSED`. Worktree của một run HALT được **giữ lại** để bạn khám nghiệm — đừng xoá tay.

## Sau ba run READY

`bash ap3/report.sh --since 30d` → dán số vào `current-workflow.md § Position on the artifact ladder` bên
repo `Claude template`. Chỉ khi cả ba run `human_interventions = 0` trong run và `merged_unchanged = true`
thì mới ghi `DEMONSTRATED_STEP: 3`.
