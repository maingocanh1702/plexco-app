#!/usr/bin/env bash
# ap-merge.sh <slug> -F <msgfile> [--probe 'path::needle'] [--test] [--push] [--yes]
#
# Squash-merge feat/<slug> vào main MỘT CÁCH KHÔNG THỂ CHẠY NỬA VỜI.
#
# VÌ SAO CÓ FILE NÀY (sự cố 2026-07-22, Plexco): runbook merge nhiều bước dán vào terminal đã hỏng
# HAI lần trong một buổi:
#   1. Các bước để trên dòng RIÊNG → `git merge --squash` abort vì tree bẩn, nhưng `git commit` ngay
#      sau vẫn chạy và commit thứ đang staged sẵn → main nhận một commit mang subject của slice
#      nhưng chứa hai file docs không liên quan.
#   2. Cổng chặn dùng `git status --porcelain` → lệnh đó TÍNH CẢ FILE UNTRACKED, mà repo luôn có vài
#      file untracked → luôn báo "bẩn" → BỎ QUA hẳn bước merge, rồi vẫn push và xoá branch.
#      Việc không mất chỉ vì commit còn trong object store — may, không phải thiết kế.
# Bài học: một chuỗi nhiều bước CÓ TÁC DỤNG PHỤ không nên tồn tại dưới dạng văn bản để paste.
#
# NGUYÊN TẮC TRONG SCRIPT NÀY:
#   - `set -euo pipefail` + mọi bước kiểm exit code → fail ở đâu là DỪNG ở đó.
#   - Gate tree sạch bằng `git diff --quiet` (chỉ xét TRACKED), KHÔNG dùng `status --porcelain`.
#   - In danh sách file đã stage và BẮT xác nhận trước khi commit (trừ khi --yes).
#   - `--push` là opt-in; verify probe TRÊN CÂY trước khi push.
#   - KHÔNG bao giờ tự xoá branch — đó là việc của ap-finish.sh sau khi origin đã xác nhận.
set -euo pipefail

SLUG="" MSGFILE="" PROBE="" DO_TEST=0 DO_PUSH=0 ASSUME_YES=0
while [ $# -gt 0 ]; do
  case "$1" in
    -F) MSGFILE="${2:?-F cần đường dẫn file message}"; shift 2 ;;
    --probe) PROBE="${2:?--probe cần 'path::needle'}"; shift 2 ;;
    --test) DO_TEST=1; shift ;;
    --push) DO_PUSH=1; shift ;;
    --yes|-y) ASSUME_YES=1; shift ;;
    -*) echo "HALT: cờ lạ '$1'"; exit 2 ;;
    *) [ -z "$SLUG" ] && SLUG="$1" || { echo "HALT: thừa tham số '$1'"; exit 2; }; shift ;;
  esac
done
[ -n "$SLUG" ]    || { echo "usage: ap-merge.sh <slug> -F <msgfile> [--probe 'path::needle'] [--test] [--push] [--yes]"; exit 2; }
[ -n "$MSGFILE" ] || { echo "HALT: thiếu -F <msgfile> (commit message phải soạn sẵn, không gõ vội)"; exit 2; }
[ -f "$MSGFILE" ] || { echo "HALT: không thấy msgfile: $MSGFILE"; exit 1; }

REPO="$(git rev-parse --show-toplevel)" || { echo "HALT: không ở trong git repo"; exit 1; }
cd "$REPO"
BR="feat/$SLUG"

git rev-parse --verify --quiet "$BR" >/dev/null || { echo "HALT: không có branch '$BR'"; exit 1; }

# 1. phải ở main
CUR="$(git rev-parse --abbrev-ref HEAD)"
[ "$CUR" = "main" ] || { echo "HALT: đang ở '$CUR', không phải main"; exit 1; }

# 2. tree sạch — CHỈ xét tracked (untracked như design.pen/.probe/ KHÔNG chặn)
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "HALT: còn thay đổi TRACKED chưa commit — commit/stash trước đã:"
  git --no-pager diff --stat; git --no-pager diff --cached --stat
  exit 1
fi
echo "✓ tracked tree sạch (untracked bỏ qua — đúng ý)"

# 3. đồng bộ với origin
git pull --ff-only
echo "✓ main == origin/main"

# 4. squash-merge; fail là dừng, và dọn index để không để lại trạng thái nửa vời
if ! git merge --squash "$BR"; then
  echo "HALT: merge thất bại — reset index về sạch, KHÔNG commit gì."
  git reset --hard HEAD
  exit 1
fi

STAGED="$(git diff --cached --name-only)"
[ -n "$STAGED" ] || { echo "HALT: merge không stage gì (branch đã merged rồi?)"; git reset --hard HEAD; exit 1; }

echo
echo "── SẼ COMMIT $(echo "$STAGED" | wc -l | tr -d ' ') file ──"
git --no-pager diff --cached --stat
echo

# 5. checkpoint người xác nhận
if [ "$ASSUME_YES" -eq 0 ]; then
  printf "Đúng danh sách trên? [y/N] "
  read -r ans </dev/tty || ans=""
  case "$ans" in
    y|Y) ;;
    *) echo "Huỷ theo yêu cầu — reset index, không commit."; git reset --hard HEAD; exit 1 ;;
  esac
fi

git commit -F "$MSGFILE"
echo "✓ committed: $(git rev-parse --short HEAD)"

# 6. verify probe TRÊN CÂY — bắt đúng lớp lỗi "commit mang subject đúng nhưng nội dung sai"
if [ -n "$PROBE" ]; then
  P_FILE="${PROBE%%::*}"; P_NEEDLE="${PROBE##*::}"
  if git grep -q -- "$P_NEEDLE" -- "$P_FILE"; then
    echo "✓ probe OK: $P_FILE chứa '$P_NEEDLE'"
  else
    echo "HALT: probe THẤT BẠI — '$P_NEEDLE' không có trong $P_FILE."
    echo "      Commit $(git rev-parse --short HEAD) có thể sai nội dung. KHÔNG push. Kiểm tra rồi tự xử lý."
    exit 1
  fi
fi

# 7. test (opt-in) — fail là dừng trước push
if [ "$DO_TEST" -eq 1 ]; then
  echo "── chạy test suite ──"
  pnpm test
  echo "✓ suite xanh"
fi

# 8. push (opt-in)
if [ "$DO_PUSH" -eq 1 ]; then
  git push origin main
  echo "✓ pushed"
  echo "→ Kế tiếp: xác nhận trên remote RỒI mới dọn:  scripts/ap-finish.sh $SLUG"
else
  echo "→ Chưa push (thiếu --push). Kiểm tra xong thì: git push origin main"
fi
