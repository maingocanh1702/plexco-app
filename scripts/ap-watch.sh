#!/usr/bin/env bash
# ap-watch.sh — ALERT vòng đời + sự cố autopilot session (macOS notification + Telegram):
#   START 🚀 · READY ✅ · DONE ✅(merged/cleanup) · HALT ⛔(kèm lý do) · CODEX HANG/AUTH ⚠️(L18) ·
#   STALL ⚠️(crash/idle) · SẮP MAX_ROUNDS ⚠️ · GIT INDEX.LOCK STALE ⚠️ · RESERVATION STALE ⚠️.
# Cơ chế: poll mỗi worktree; "fingerprint" = HEAD-sha + mtime mới nhất của state dir.
#   Fingerprint đứng im quá STALL_MIN phút (và codex KHÔNG chạy) = session dừng → phân loại + notification.
#   De-dupe: mỗi (slug, trạng-thái) chỉ alert 1 lần; có tiến triển lại thì reset + báo HỒI.
#
# MULTI-REPO: REPO tự suy từ vị trí script (scripts/.. ), ST marker tách theo repo, alert gắn [tên repo].
#   Cùng 1 file copy được vào mọi repo; chạy 1 watchdog/terminal cho mỗi repo có autopilot.
# Dùng:   scripts/ap-watch.sh [interval_sec=60] [stall_min=8]
# Dừng:   Ctrl-C
# macOS only (osascript/stat -f). Chạy ở 1 terminal riêng, để nền.
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"   # tự-định-vị: <repo>/scripts/ap-watch.sh → <repo>
REPO_TAG="$(basename "$REPO")"
WT_ROOT="$REPO/.autopilot/worktrees"
INFLIGHT="$REPO/.autopilot/INFLIGHT.md"
INTERVAL="${1:-60}"
STALL_MIN="${2:-8}"
STALL_SEC=$(( STALL_MIN * 60 ))
LOCK_STALL_SEC="${AP_WATCH_LOCK_SEC:-120}"   # .git/index.lock đứng > ngưỡng này = nghi kẹt (giây)
MAXR_WARN="${AP_WATCH_MAXR:-4}"              # cảnh báo khi fix-round-count >= ngưỡng (cap 5)
ST="/tmp/ap-watch-$(printf '%s' "$REPO_TAG" | tr -c 'A-Za-z0-9_.-' '_')"; mkdir -p "$ST"   # marker tách theo repo

# Telegram (tuỳ chọn) — config ở ~/.ap-watch.env (ngoài repo, không commit; LaunchAgent đọc qua $HOME):
#   AP_WATCH_TG_TOKEN="123456:ABC..."     # token bot
#   AP_WATCH_TG_CHAT="<owner chat_id>"    # DM RIÊNG của owner (không phải group)
[ -f "$HOME/.ap-watch.env" ] && . "$HOME/.ap-watch.env"
AP_WATCH_TG_TOKEN="${AP_WATCH_TG_TOKEN:-}"
AP_WATCH_TG_CHAT="${AP_WATCH_TG_CHAT:-}"

now() { date +%s; }

notify() { # $1=title $2=msg $3=sound
  local title="[$REPO_TAG] $1"
  /usr/bin/osascript -e "display notification \"${2//\"/\'}\" with title \"${title//\"/\'}\" sound name \"${3:-Glass}\"" 2>/dev/null
  printf '\a'
  echo "[$(date '+%H:%M:%S')] $title — $2"
  # Telegram push (nếu đã cấu hình ~/.ap-watch.env)
  if [ -n "$AP_WATCH_TG_TOKEN" ] && [ -n "$AP_WATCH_TG_CHAT" ]; then
    curl -s --max-time 10 "https://api.telegram.org/bot${AP_WATCH_TG_TOKEN}/sendMessage" \
      --data-urlencode "chat_id=${AP_WATCH_TG_CHAT}" \
      --data-urlencode "text=$title
$2" >/dev/null 2>&1 || echo "  (telegram send failed)"
  fi
}

alert_once() { # $1=slug $2=key $3=title $4=msg $5=sound
  local m="$ST/$1.$2"; [ -f "$m" ] && return 0; touch "$m"
  notify "$3" "$4" "${5:-Glass}"
}
clear_alerts() { rm -f "$ST/$1."alert.* 2>/dev/null; }

newest_mtime_in() { # $1=dir → epoch mtime mới nhất (xử lý path có space)
  [ -d "$1" ] || { echo 0; return; }
  find "$1" -type f -exec stat -f %m {} \; 2>/dev/null | sort -rn | head -1 | grep . || echo 0
}

inflight_status() { # $1=slug → in-flight|ready|""
  awk -v s="$1" '/^```/{f=!f;next} f{next} /^## feature:/{c=$3} /^status:/{if(c==s)print $2}' "$INFLIGHT" 2>/dev/null | tail -1
}

# codex_active "$dir" → 0 nếu có tiến trình codex đang chạy với cwd NẰM TRONG worktree này.
# Vì sao cần: `codex review` (xhigh) ghi round file ATOMIC lúc XONG, nên suốt nhiều phút model nghĩ
# KHÔNG có file nào trong worktree đổi → fingerprint tưởng "đứng im" → STALL/HANG giả. Tiến trình codex
# còn sống = đang review = đang tiến triển. Dò bằng cwd (lsof) vì args codex không chứa path worktree.
codex_active() { # $1 = worktree dir
  local pid cwd
  for pid in $(pgrep -f codex 2>/dev/null); do
    cwd="$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -1)"
    [ -n "$cwd" ] || continue
    case "$cwd" in "$1"|"$1"/*) return 0;; esac
  done
  return 1
}

echo "ap-watch[$REPO_TAG]: theo dõi $WT_ROOT · poll ${INTERVAL}s · stall ${STALL_MIN}m · Ctrl-C để dừng"
while true; do
  shopt -s nullglob

  # ===== BACKLOG STALE: task đã merged nhưng backlog còn planned/ready (derive từ code probe) =====
  if [ -x "$REPO/scripts/autopilot-backlog-reconcile" ]; then
    if "$REPO/scripts/autopilot-backlog-reconcile" --check >/dev/null 2>&1; then
      rm -f "$ST/_backlog.stale" 2>/dev/null   # hết stale → re-arm
    else
      alert_once _backlog stale "⚠️ BACKLOG STALE" "task đã merged nhưng backlog còn planned/ready — chạy: scripts/autopilot-backlog-reconcile --fix" "Basso"
    fi
  fi

  # ===== DONE: session từng active giờ worktree biến mất (merged + cleanup / đóng) =====
  for seen in "$ST"/*.seen; do
    [ -e "$seen" ] || continue
    nm="$(basename "$seen" .seen)"
    if [ ! -d "$WT_ROOT/$nm" ]; then
      if [ -f "$ST/$nm.alert.ready" ]; then
        notify "✅ AUTOPILOT DONE" "$nm — worktree đã gỡ (merged/cleanup hoặc đóng)" "Glass"
      else
        notify "✅ AUTOPILOT DONE" "$nm — worktree đã gỡ (merged/cleanup). LƯU Ý: chưa kịp bắn READY (ready→merge nhanh, hoặc watchdog restart sau khi worktree đã gỡ)" "Glass"
      fi
      rm -f "$ST/$nm".*   # xoá mọi marker của nó (seen/fp/ts/alert) → không báo lại
    fi
  done

  # ===== #1 .git/index.lock stale trên MAIN repo (git của bạn có thể đang kẹt) =====
  lk="$REPO/.git/index.lock"
  if [ -f "$lk" ]; then
    lkage=$(( $(now) - $(stat -f %m "$lk" 2>/dev/null || now) ))
    [ "$lkage" -gt "$LOCK_STALL_SEC" ] && \
      alert_once _main indexlock "⚠️ GIT INDEX.LOCK STALE" "main: .git/index.lock đứng ${lkage}s — git có thể kẹt. Không có git nào chạy → rm -f .git/index.lock" "Basso"
  else
    rm -f "$ST/_main.indexlock" 2>/dev/null   # lock hết → re-arm
  fi

  # ===== #5 reservation INFLIGHT active nhưng KHÔNG còn worktree (stale → cần cleanup) =====
  while read -r s; do
    [ -n "$s" ] || continue
    found=0
    for w in "$WT_ROOT"/*/; do
      [ -d "$w" ] || continue
      { [ -d "$w/.autopilot/state/$s" ] || [ "$(basename "$w")" = "$s" ]; } && { found=1; break; }
    done
    [ "$found" = 1 ] && { rm -f "$ST/_res_$s.stale" 2>/dev/null; continue; }
    alert_once "_res_$s" stale "⚠️ RESERVATION STALE" "$s: active trong INFLIGHT nhưng KHÔNG còn worktree — chạy: scripts/autopilot-scope-gate cleanup --feature $s" "Basso"
  done < <(awk '/^```/{f=!f;next} f{next} /^## feature:/{c=$3} /^status:/{if($2=="in-flight"||$2=="ready")print c}' "$INFLIGHT" 2>/dev/null)

  for wt in "$WT_ROOT"/*/; do
    [ -d "$wt" ] || continue
    dir="${wt%/}"; name="$(basename "$dir")"
    sdir="$dir/.autopilot/state"
    slug="$(ls "$sdir" 2>/dev/null | head -1)"; [ -n "$slug" ] || slug="$name"

    # CHỈ theo dõi worktree ĐANG ACTIVE trong INFLIGHT (in-flight|ready).
    st="$(inflight_status "$slug")"
    [ -n "$st" ] || { clear_alerts "$name"; continue; }
    # STARTED bookend — lần ĐẦU thấy worktree active này
    [ -f "$ST/$name.seen" ] || notify "🚀 AUTOPILOT START" "$slug — session bắt đầu (đang theo dõi)" "Glass"
    touch "$ST/$name.seen"

    # sắp MAX_ROUNDS — đọc fix-round-count, cảnh báo 1 lần khi >= ngưỡng
    frc="$(cat "$sdir/$slug/fix-round-count.txt" 2>/dev/null || echo 0)"
    case "$frc" in (''|*[!0-9]*) frc=0;; esac
    if [ "$frc" -ge "$MAXR_WARN" ] && [ ! -f "$ST/$name.maxwarned" ]; then
      touch "$ST/$name.maxwarned"
      notify "⚠️ SẮP MAX_ROUNDS" "$slug: fix-round-count=$frc (cap 5) — sắp thrash, chuẩn bị re-slice/escalate" "Basso"
    fi

    # ===== trạng thái KẾT THÚC dứt khoát — báo NGAY (không đợi cửa sổ stall) =====
    if [ "$st" = "ready" ]; then
      alert_once "$name" alert.ready "✅ AUTOPILOT READY" "$slug → READY, chờ merge tay" "Glass"; continue
    fi
    hf="$(find "$sdir" -iname 'HALT*' -type f 2>/dev/null | head -1)"
    if [ -n "$hf" ]; then
      why="$(grep -hoiE 'SCOPE_COLLISION|REGION_THRASH|MAX_ROUNDS|DEP_MISSING|POLICY_MISMATCH|CODEX_UNAVAILABLE|SCOPE_DRIFT|MERGE_GATE_FAIL|INVARIANT_UNKNOWN|TDD_ORACLE_VIOLATED|MONEY_GUESS|LEGACY_DRIFT|TRANSPORT_DRIFT|WRONG_BRANCH_HEAD|DIRTY_TREE|LIVE_DB_WRITE' "$hf" 2>/dev/null | head -1)"
      alert_once "$name" alert.halt "⛔ AUTOPILOT HALT" "$slug — ${why:-HALT} (cần founder xử lý — xem TUI)" "Basso"; continue
    fi

    head="$(git -C "$dir" rev-parse --short HEAD 2>/dev/null || echo '-')"
    nm="$(newest_mtime_in "$sdir")"
    sm="$(newest_mtime_in "$dir/src")"
    fp="$head:$nm:$sm"

    # fingerprint thay đổi → đang tiến triển → ghi nhận + reset alert
    fpf="$ST/$name.fp"; tsf="$ST/$name.ts"
    if [ "$(cat "$fpf" 2>/dev/null)" != "$fp" ]; then
      if ls "$ST/$name".alert.hang "$ST/$name".alert.stall >/dev/null 2>&1; then
        notify "▶️ AUTOPILOT HỒI" "$slug — đã chạy lại sau cảnh báo (codex/stall tự khỏi hoặc đã retry), đang tiến triển tiếp" "Glass"
      fi
      echo "$fp" > "$fpf"; now > "$tsf"; clear_alerts "$name"; continue
    fi
    idle=$(( $(now) - $(cat "$tsf" 2>/dev/null || now) ))
    [ "$idle" -lt "$STALL_SEC" ] && continue

    # GUARD review-chậm: codex đang chạy cho worktree này → đang review, KHÔNG phải stall.
    if codex_active "$dir"; then
      ls "$ST/$name".alert.hang "$ST/$name".alert.stall >/dev/null 2>&1 && \
        notify "▶️ AUTOPILOT HỒI" "$slug — codex review đang chạy (xhigh nghĩ lâu), không phải treo" "Glass"
      now > "$tsf"; clear_alerts "$name"; continue
    fi

    # ===== đứng im > STALL_MIN, codex KHÔNG chạy → phân loại =====
    rfile="$(ls -t "$sdir/$slug/"round-*.txt "$sdir/$slug/codex/"round-*.txt 2>/dev/null | head -1)"
    if [ -n "$rfile" ] && grep -qiE 'access token could not be refreshed|token_revoked|refresh token was revoked|refresh_token_invalidated|Review was interrupted|Your session has ended|Please log ?in again|invalid_grant' "$rfile" 2>/dev/null; then
      alert_once "$name" alert.hang "⚠️ CODEX AUTH CHẾT" "$slug: round có lỗi auth (401/token revoked) + đứng im ${idle}s — codex logout && login rồi retry /review" "Basso"; continue
    fi
    rinfo="$( [ -n "$rfile" ] && echo "round mới nhất $(stat -f %z "$rfile" 2>/dev/null)B" || echo 'chưa có round' )"
    alert_once "$name" alert.stall "⚠️ AUTOPILOT STALL" "$slug: ${idle}s không tiến triển (HEAD $head, $rinfo, codex không chạy) — XEM TUI: có thể HALT đang chờ founder quyết, hoặc crash/idle" "Basso"
  done
  sleep "$INTERVAL"
done
