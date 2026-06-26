#!/usr/bin/env bash
# ap-finish.sh <slug> — DỌN SAU KHI đã merge+push feat/<slug> vào main (chạy ở repo gốc).
# Làm 3 việc còn thiếu để watchdog bắn ✅ DONE + repo sạch:
#   1. git worktree remove .autopilot/worktrees/<slug>   ← worktree biến mất → watchdog DONE
#   2. git branch -d feat/<slug>                          ← chỉ xoá nếu đã merged (không mất việc)
#   3. scripts/autopilot-scope-gate cleanup --feature <slug>  ← gỡ khỏi INFLIGHT
#
# AN TOÀN: từ chối gỡ worktree nếu còn thay đổi CHƯA commit; KHÔNG force-xoá branch chưa merge.
# Dùng:  bash scripts/ap-finish.sh <slug>     (sau khi merge+push xong — verify-on-disk của founder)
set -uo pipefail

SLUG="${1:?usage: ap-finish.sh <slug>}"
REPO="$(git rev-parse --show-toplevel 2>/dev/null)" || { echo "HALT: không ở trong git repo"; exit 1; }
cd "$REPO"
WT="$REPO/.autopilot/worktrees/$SLUG"
BR="feat/$SLUG"

# 1. worktree — chỉ gỡ khi tree SẠCH (tránh mất việc chưa commit); prunable/lock → --force (đã sạch nên ok)
if [ -d "$WT" ]; then
  dirty="$(git -C "$WT" --no-optional-locks status --porcelain 2>/dev/null)"
  if [ -n "$dirty" ]; then
    echo "⚠️  worktree '$SLUG' còn thay đổi CHƯA commit — KHÔNG gỡ (tránh mất việc):"
    printf '%s\n' "$dirty" | head
    echo "   → commit/discard trong worktree đó rồi chạy lại."
    exit 1
  fi
  git worktree remove "$WT" 2>/dev/null || git worktree remove --force "$WT"
  echo "✅ worktree removed: $SLUG (→ watchdog sẽ bắn DONE)"
else
  echo "• worktree '$SLUG' đã gỡ trước đó"
fi

# 2. branch — -d (chỉ xoá nếu merged); thất bại (vd squash) → GIỮ lại + nhắc, KHÔNG tự -D (tránh mất commit)
if git rev-parse --verify --quiet "$BR" >/dev/null 2>&1; then
  if git branch -d "$BR" 2>/dev/null; then
    echo "✅ branch deleted: $BR"
  else
    echo "• '$BR' chưa merged-ancestor (vd squash-merge) → GIỮ lại. Chắc chắn đã merge thì xoá tay: git branch -D $BR"
  fi
fi

# 3. scope-gate cleanup (gỡ khỏi INFLIGHT)
if [ -x scripts/autopilot-scope-gate ]; then
  scripts/autopilot-scope-gate cleanup --feature "$SLUG" 2>/dev/null && echo "✅ scope-gate cleaned: $SLUG" || echo "• scope-gate: không có reservation '$SLUG' (đã cleanup)"
fi

echo "Done. '$SLUG' đã dọn xong — watchdog bắn ✅ DONE ở poll kế tiếp."
