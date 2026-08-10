# Next milestones — snapshot 2026-08-07

> **Loại file:** session output (kế hoạch thực thi đề xuất tại một snapshot). **KHÔNG phải** review/readiness
> artifact, không chứa verdict, không authorize code/worktree/merge/enablement nào. Readiness của từng slice
> thuộc verdict canonical của chính nó (`docs/slice-readiness-verdicts.md` + slice doc); delivery order canonical
> thuộc `docs/product/ROADMAP.md`. File này chỉ trả lời: *làm gì tiếp, theo thứ tự nào, ai mở khoá cái gì.*
>
> **Snapshot pin:** `main` = `origin/main` = `64e9ccb8ac1b1079f85c3b646d9db99a183632f0` (07/08/2026).
> Trạng thái đo được tại snapshot: migrations `0000`–`0029` · canonical runner 683 @`528540e` (07/08, máy owner)
> · 10 API route (0 nghiệp vụ) · 0 màn FE · ⛔ CI infra-blocked từ 06/08 · lane
> `feat/chat-dm-safety-authority-core--v2` @ `31bd4d9` đỗ chờ codex quota · `design.pen` + `fe.pen` untracked.
> Nếu bạn đọc file này sau nhiều commit: coi mọi claim ở đây là **claim lúc soạn**, re-verify trước khi hành động
> (bài học scheduled-prompt-state-decays).

---

## M0 — Gỡ nghẽn hạ tầng delivery (trước mọi thứ khác)

**M0.1 · CI (owner, ~10 phút):**

1. GitHub → Settings → Billing → kiểm tra Actions minutes/spending limit (repo private; mọi run fail đồng loạt
   "job was not acquired by hosted Runner" từ 06/08 ~18:37Z).
2. Sau khi xử lý: re-run workflow CI trên `main` (hoặc chờ push kế tiếp) → cần **1 run xanh** để xác nhận
   mitigation `4cc574c`.
3. Tới lúc đó: mọi merge-gate dựa CI đứng yên; CI đỏ ≠ lỗi code.

**M0.2 · Commit 2 khối đang chờ trên máy owner** (sandbox không commit được). ⚠️ **Xác nhận lúc soạn
(07/08 02:53): có `.git/index.lock` mồ côi 0-byte** do session sandbox để lại (sandbox không unlink được) —
mọi lệnh git sẽ fail "Another git process seems to be running" tới khi xoá. Xoá trước, an toàn vì không có
git process nào đang chạy:

```bash
cd ~/Projects/"Plexco app"
rm -f .git/index.lock
# khối 1 — chore gitnexus refresh (lane riêng, đã prettier-sạch):
git add AGENTS.md CLAUDE.md .claude/skills/gitnexus
git commit -m "chore(gitnexus): refresh tool blocks after 2026-08-07 reindex (7523 symbols)"
# khối 2 — docs reconcile của review round này:
git add README.md CHANGELOG.md docs/00-start-here/HANDOFF.md docs/standards/BUILD-STATUS.md \
  docs/product/ROADMAP.md docs/README.md docs/autopilot-backlog.md docs/sessions/2026-08-07-next-milestones.md
git commit -m "docs: live-truth reconcile at 64e9ccb — tests axis 683, parked lane recorded, ROADMAP v3.4o, next-milestones plan"
git push
```

**M0.3 · Owner chọn canonical design file (DD-81 — mở khoá M4):** đúng 1 trong 2, file còn lại archive/xoá:

```bash
# Phương án A — design.pen (22/07, 562KB) là canonical:
git add design.pen && git commit -m "docs(design): track canonical design.pen (DD-81)"
# Phương án B — fe.pen (07/08, 169KB) là canonical:
git add fe.pen && git commit -m "docs(design): track canonical fe.pen (DD-81)"
```

Sau track còn bước **owner nghiệm thu làm authority** — FE HOLD chỉ gỡ khi cả hai xong.

**⚠️ Cấm trong suốt M0–M1: `git worktree prune`** — worktree
`.autopilot/worktrees/chat-dm-safety-authority-core--v2` có thể hiện `prunable` tuỳ máy/path; prune sẽ xoá state
`.autopilot/` không cứu được.

## M1 — Resume Chat vertical (khi codex quota reset — ghi nhận lúc park: 13:09 ngày 08/08)

1. Final review round cho lane v2: `scripts/codex-review-pin.sh` trên worktree
   `chat-dm-safety-authority-core--v2` @ `31bd4d9` (P1 schema-migration → cần clean rounds theo gate; reviewer
   không gọi được → HALT TOOL_UNAVAILABLE, không tự hạ gate).
2. READY → owner merge qua `scripts/ap-merge.sh` (re-verify migration tail lúc merge; số `0030` là provisional)
   → `autopilot-backlog-reconcile --fix` chạy trong bước merge.
3. Sau merge: `dd38-dd86-chat-schema-core` (AP-45) **re-run gate của chính nó** — dependency thứ hai lúc đó mới
   `MERGED`; rồi mới bàn tiếp chuỗi slice theo Chat plan v1.8 (`PLAN_READY` @ `90d292d`; từng slice vẫn phải đạt
   strict `CODE_READY` riêng).

## M2 — Mở Session BE vertical (P4 root, chạy xen kẽ với M1)

Node thấp nhất chưa build có contract đóng: Session Management (publish/draft-lifecycle contract đã đóng 23–24/07,
`0024` là DB invariant, **0 SessionService · 0 route**). Việc đầu tiên là **author slice** (chưa có slice nào được
author cho vertical này — không nhảy thẳng vào code):

1. Author slice đầu theo dependency: SessionService core (command/service trên `tenantRepo`, chưa route) — scope
   gọn theo budget ≤300 LOC/≤3 modules; acceptance matrix từ
   `docs/issues/session-management-acceptance-checklist.md`.
2. Qua gate strict `CODE_READY` của repo rồi mới mở worktree.
3. **Ràng buộc tuần tự:** slice DB-migration của Chat (M1) và Session đụng chung `schema.ts` + dãy số migration →
   không chạy song song 2 slice cùng ghi migration; Session slice đầu nên là service-only (0 migration) để chạy
   song song an toàn với M1.

## M3 — Job runtime productize (sau khi M2 có producer đầu tiên)

Giữ `OUTBOX_DISPATCH_SCHEDULE_ENABLED=false`. Thứ tự: real projector → business producer (từ SessionService M2)
→ replay/DLQ path (backlog: `db-projector-dlq-no-replay-path`, `job-outbox-dispatch-sync-lag-slo`,
`job-consumers-per-feature` — hiện là `idea`, cần author). Chỉ bàn enablement khi đủ producer + projector + replay
+ invariant tests land trước enablement.

## M4 — FE unlock (sau M0.3 + nghiệm thu)

1. F0 shell theo `docs/channels/web/frontend-architecture.md` v0.7 (route mỏng/barrel/`toAppError` — mapper đã có
   code + 14 tests) + breakpoint rule 2 lớp DD-99 OQ-1.
2. Thứ tự backlog FE owner đã chốt: **P2** (player session-detail/join/leave/waitlist — cần gỡ mâu thuẫn
   header/§6 `feature_sessions_fe.md` trước) → **P4** (mark-paid `cash|waiver` surface; refund-on-cancel tách chờ
   refund policy) → **P3** (account-management). 12 FE spec hiện Draft — Draft→Reviewed cần đủ 4 section DD-99 P1.

## M5 — Enablement & owner decisions (độc lập, không chặn code)

| Việc | Ai/gate |
|---|---|
| Google login go-live (set credentials) | Owner; các gate độc lập (A3 legal/PII) đứng riêng |
| Messenger App Review | External evidence gate (DD-33) |
| Zalo DD-14/DD-15 spikes | `blocked` — cần bằng chứng người thật từ provider |
| DD-96 Part B (host receivable cross-club) | 4 blocker B1–B4, có `authorizeTenantAction` 0-caller trong đó |
| DD-97 mechanism (statement/export DTO) | Chờ DTO owner Reviewed (cùng họ blocker B3 DD-96) |
| Scheduler ON | Chỉ sau M3 đủ producer/projector/replay |

## Negative scope của chính file này

Không mở FE page/component trước khi M0.3 + nghiệm thu xong; không bật scheduler; không sửa migration lịch sử;
không code trực tiếp từ file này — mọi slice đi qua gate + manifest + worktree theo `CLAUDE.md`/HANDOFF §5.
