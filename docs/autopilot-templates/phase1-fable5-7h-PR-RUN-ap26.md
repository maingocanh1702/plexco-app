# Phase-1 Autopilot — 7h unattended READY run · AP-26 (safe dispatcher)

> **Status:** current owner handoff · 2026-07-19 (supersedes the AP-22 dispatcher `phase1-fable5-7h-PR-RUN.md`, which stays as reference for the already-run egress slice)
> **Model:** `claude-fable-5`
> **Framework:** canonical `autopilot-prompt-GENERIC` **v0.6.0** or newer
> **Authority:** decisions **v1.77** (DD-80 ✅ B0 auth design-ready · DD-79 ✅ Home · DD-73..78 ✅ build-gated · DD-70..72 🟡) · web_auth tech **v2.8** (acceptance D0/D1) · `slice-readiness-verdicts.md` **v0.3** (D0 = CODE_READY · D1 = PLAN_READY) · merged `main` schema/migrations **0000–0013**; `0014` vẫn chỉ ở `feat/session-waitlist-expand`
> **Selected slice:** `docs-auth-d0-d1-implementation-packet` (AP-26 · P2 docs-only)

One Claude Code session runs in one feature worktree and ends at `READY_FOR_MANUAL_MERGE` or a watchdog-visible
`HALT-*` sentinel. Seven hours is a ceiling for this slice, not permission to widen scope or chain PRs.

## 1. Why this slice (and why NOT code BE trực tiếp)

- **P0 rule không đổi:** canonical v0.6.0 xếp mọi scope auth/token/migration/secret là P0 → cấm unattended
  codegen. `auth-s4-d0-revoke-core` là **CODE_READY** (Verdict 3) nhưng là P0 auth+migration → build phải là
  **founder-attended manual workflow**, không phải run này.
- AP-26 là cách hợp lệ để 7h unattended đẩy BE đi xa nhất: sản xuất packet copy-paste-grade (draft DDL
  0015/0016 + adapter/route/test skeleton map đủ D0-1..10/D1-1..15 + DD-38/39 readiness) để phiên attended
  của founder code D0 gần như chỉ còn gõ lại và chạy test.
- Single-slice: session không được chuyển task khác kể cả xong sớm. Xong sớm = STOP sớm.

## 2. Eligibility snapshot (re-verify live trước khi chạy)

| Task | State | Risk/gate | Run này? |
|---|---|---|---|
| `docs-auth-d0-d1-implementation-packet` | `ready` sau khi owner đẩy bộ artifact AP-26 lên `main` | P2 docs-only, manual merge, 1× FULL clean | **Yes — selection** |
| `infra-egress-compatibility-evidence` (AP-22) | ĐÃ chạy, đang `READY_FOR_MANUAL_MERGE` chờ founder | P2 | No — chờ merge, không chạy lại |
| `infra-inbound-webhook-auth-evidence` (AP-23) | `ready` | P2 | Alternate (handoff riêng) |
| `infra-provider-limits-evidence` (AP-24) | `ready`, chung `build-config` với AP-22 | P2 | No — chỉ sau khi AP-22 merged + reservation clean |
| `docs-session-management-acceptance-checklist` (AP-25) | `ready` | P2 | Alternate (handoff riêng) |
| `auth-s4-d0-revoke-core` | CODE_READY (Verdict 3) | **P0 auth+migration** | **No — attended manual only** |
| `auth-s4-d1-google-adapter` | PLAN_READY (Verdict 4) | P0 | No |

Nếu snapshot đổi (backlog/INFLIGHT khác), derive lại; không dùng bảng này thay live status.

## 3. Owner pre-launch (bạn chạy tay, một lần)

**Precondition quan trọng nhất:** toàn bộ authority hôm nay (DD-80 `c1a3957`, artifacts `352e6ec`, verdicts
`23d47f0`, bộ AP-26) đang nằm trên `feat/session-waitlist-expand`. Dispatcher yêu cầu mọi artifact **trên
`origin/main`**. Bạn phải đưa docs lên main trước — hoặc merge cả nhánh (kéo theo migration 0014, tự nó là
expand-only đã có invariant tests: một quyết định merge P1 bạn phải tự ra), hoặc tách docs-only. Đồng thời
merge PR AP-22 đang READY để dọn reservation.

```bash
set -euo pipefail
cd "/Users/maingocanh/Projects/Plexco app"

# 0) Merge AP-22 PR (READY) + đưa authority/AP-26 artifacts lên main theo cách bạn chọn, rồi:
git fetch origin
test "$(git branch --show-current)" = "main"
test -z "$(git status --porcelain)"
test "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)"

# 1) Artifact set AP-26 phải có trên origin/main
for f in \
  docs/autopilot-manifests/docs-auth-d0-d1-implementation-packet.json \
  docs/autopilot-docs-auth-d0-d1-implementation-packet.md \
  .claude/commands/ap-26-docs-auth-d0-d1-implementation-packet.md \
  docs/b0-auth-credential-lifecycle-design-probe.md \
  docs/autopilot-manifests/auth-s4-d0-revoke-core.json \
  docs/autopilot-manifests/auth-s4-d1-google-adapter.json ; do
  git show "origin/main:$f" >/dev/null || { echo "MISS $f on origin/main"; exit 1; }
done
grep -q "DD-80" docs/standards/decisions.md || { echo "MISS DD-80"; exit 1; }

# 2) Backlog/scope-gate sạch
scripts/autopilot-backlog-reconcile --check
test ! -e .autopilot/worktrees/docs-auth-d0-d1-implementation-packet
test -z "$(git branch --list feat/docs-auth-d0-d1-implementation-packet)"

# 3) Register + worktree
scripts/autopilot-scope-gate register \
  --manifest docs/autopilot-manifests/docs-auth-d0-d1-implementation-packet.json
git worktree add .autopilot/worktrees/docs-auth-d0-d1-implementation-packet \
  -b feat/docs-auth-d0-d1-implementation-packet main
test "$(git -C .autopilot/worktrees/docs-auth-d0-d1-implementation-packet rev-parse HEAD)" = \
     "$(git rev-parse main)"
```

Mở Claude Code với cwd **chính xác**:

```text
/Users/maingocanh/Projects/Plexco app/.autopilot/worktrees/docs-auth-d0-d1-implementation-packet
```

Chọn model `claude-fable-5`, gõ `/ap-26-docs-auth-d0-d1-implementation-packet`. Không mở ở repo root, không
paste prompt lịch sử. Bất kỳ pre-launch check nào fail → dừng; không xoá branch/worktree/reservation.

## 4. Runtime contract (tóm tắt — chi tiết trong task contract + launcher)

- `T0=$(date +%s)`; `HARD_STOP=$((T0 + 7*3600))`; 20 phút finish margin. Hết giờ giữa chừng → safe commit,
  push feature branch nếu được, `HALT-TIMEBOX.txt`, giữ worktree, STOP.
- State: `.autopilot/state/docs-auth-d0-d1-implementation-packet/{regions.log,fix-round-count.txt}`.
- Scope: đúng 2 file trong manifest. Đụng packages/, apps/, Reviewed specs, decisions.md, verdicts →
  scope breach HALT.
- Nội dung theo canonical read order; mâu thuẫn authority = `HALT-AUTHORITY_AMBIGUOUS.txt`, không tự quyết.
- Verification: `pnpm exec prettier --check docs/auth-d0-d1-implementation-packet.md` · `git diff --check` ·
  `git diff --stat main...HEAD` chỉ chứa manifest scope.
- Codex: `CODEX="${AUTOPILOT_CODEX_BIN:?HALT CODEX_UNAVAILABLE}"`; một FULL-base round
  `"$CODEX" review --base main > .autopilot/state/docs-auth-d0-d1-implementation-packet/round-01.txt 2>&1`;
  P2 cần 1 round clean trên HEAD hiện tại; fix round bounded (>5 = MAX_ROUNDS; 3 lần cùng region =
  REGION_THRASH; quota = CODEX_QUOTA). Không tee/PTY/degraded/substitute.
- READY: re-verify → `git merge-tree --write-tree origin/main feat/docs-auth-d0-d1-implementation-packet` →
  `scripts/autopilot-scope-gate ready --manifest ...` → push đúng feature branch (+PR nếu có GitHub) →
  emit `READY_FOR_MANUAL_MERGE` → STOP. Không merge, không slice thứ hai, không AP-21.

## 5. Final report (một task duy nhất)

- status: `READY_FOR_MANUAL_MERGE` | `HALT-<REASON>` | `HALT-TIMEBOX`;
- branch + HEAD/base SHA + PR/compare URL nếu có;
- bảng self-check §D của packet (PASS/GAP từng section, marker có/không);
- verification results + Codex verdict line cuối;
- scope diff + counters; xác nhận `main` untouched, không slice thứ hai.

## 6. Sau run này (không thuộc phạm vi autopilot)

1. Founder merge PR AP-26 → packet nằm trên main.
2. **Phiên attended P0** (bạn online): code D0 theo packet §A + acceptance D0-1..10, bạn review/merge tay
   (Codex 2×_clean theo manifest `auth-s4-d0-revoke-core.json`).
3. D0 merged → re-run closure D1 (Verdict 4 trigger) → phiên attended tiếp cho D1 Google.
4. Song song có thể chạy tiếp AP-23/AP-25 (handoff riêng, sau khi AP-26 merged) và AP-24 sau khi AP-22 merged.
