#!/usr/bin/env bash
# ap-watch.sh — ALERT vòng đời + sự cố autopilot session (macOS notification + Telegram).
# GENERIC / PORTABLE: REPO tự dò từ vị trí script (hoặc env AP_WATCH_REPO). Cài 1 LaunchAgent / repo.
#   START 🚀 · READY ✅(+time) · DONE ✅(+time) · HALT ⛔(kèm lý do) · CODEX AUTH CHẾT ⚠️ ·
#   STALL ⚠️ · HỒI ▶️ · SẮP/HARD MAX_ROUNDS ⚠️/⛔ · GIT INDEX.LOCK STALE ⚠️ · RESERVATION STALE ⚠️ ·
#   BACKLOG STALE ⚠️(nếu repo có scripts/autopilot-backlog-reconcile).
# Cơ chế: poll mỗi worktree; "fingerprint" = HEAD-sha + mtime mới nhất của state dir + src/.
#   Fingerprint đứng im quá STALL_MIN phút (và codex KHÔNG chạy) = dừng → phân loại + notify + chuông.
#   READY/HALT báo NGAY (tín hiệu dứt khoát). De-dupe: mỗi (slug,trạng-thái) 1 lần; tiến triển lại → HỒI.
#   CODEX AUTH CHẾT nhận diện bằng NỘI DUNG round (401/token_revoked…), KHÔNG bằng size (review xhigh
#   nghĩ lâu cũng để file nhỏ → tránh false-positive). Mọi alert sau START kèm thời gian trôi (+Xm).
#
# Dùng:   scripts/ap-watch.sh [interval_sec=30] [stall_min=8]      (env: AP_WATCH_REPO ghi đè repo)
# Dừng:   Ctrl-C  ·  macOS only (osascript/stat -f/lsof). Chạy nền qua LaunchAgent (ap-watch-install.sh).
set -uo pipefail

# REPO: ưu tiên env; else dò repo-root từ vị trí script (script nằm ở <repo>/scripts/ap-watch.sh); else cwd.
REPO="${AP_WATCH_REPO:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." 2>/dev/null && git rev-parse --show-toplevel 2>/dev/null)}"
REPO="${REPO:-$(pwd)}"
WT_ROOT="$REPO/.autopilot/worktrees"
INFLIGHT="$REPO/.autopilot/INFLIGHT.md"
INTERVAL="${1:-30}"
STALL_MIN="${2:-8}"
STALL_SEC=$(( STALL_MIN * 60 ))
LONG_IDLE_SEC="${AP_WATCH_LONG_IDLE:-900}"   # claude còn sống + đứng im > ngưỡng này (15') = nghi đã
                                             # HALT/chờ founder dù TUI mở (nghĩ thật hiếm khi >15' không ghi gì)
LOCK_STALL_SEC="${AP_WATCH_LOCK_SEC:-120}"   # .git/index.lock đứng > ngưỡng này = nghi kẹt (giây)
MAXR_WARN="${AP_WATCH_MAXR:-4}"              # cảnh báo SẮP khi fix-round-count >= ngưỡng (cap 5)
MAXR_HALT="${AP_WATCH_MAXR_HALT:-6}"         # MAX_ROUNDS hard-stop: luật ">5 → HALT" = halt ở frc=6
                                             # (frc=5 agent VẪN được chạy round kế → không halt)
# state dir RIÊNG theo repo → nhiều repo chạy watchdog song song không đè marker của nhau
ST="/tmp/ap-watch-$(printf '%s' "$REPO" | tr -c 'A-Za-z0-9' '_' | tail -c 40)"; mkdir -p "$ST"

# Telegram (tuỳ chọn) — config ở ~/.ap-watch.env (ngoài repo, không commit; LaunchAgent đọc qua $HOME):
#   AP_WATCH_TG_TOKEN="123456:ABC..."     # token bot Telegram bất kỳ (BotFather)
#   AP_WATCH_TG_CHAT="<owner chat_id>"    # DM RIÊNG của owner (không phải group)
[ -f "$HOME/.ap-watch.env" ] && . "$HOME/.ap-watch.env"
AP_WATCH_TG_TOKEN="${AP_WATCH_TG_TOKEN:-}"
AP_WATCH_TG_CHAT="${AP_WATCH_TG_CHAT:-}"

now() { date +%s; }

notify() { # $1=title $2=msg $3=sound
  /usr/bin/osascript -e "display notification \"${2//\"/\'}\" with title \"${1//\"/\'}\" sound name \"${3:-Glass}\"" 2>/dev/null
  printf '\a'
  echo "[$(date '+%H:%M:%S')] $1 — $2"
  # Telegram push (nếu đã cấu hình ~/.ap-watch.env)
  if [ -n "$AP_WATCH_TG_TOKEN" ] && [ -n "$AP_WATCH_TG_CHAT" ]; then
    curl -s --max-time 10 "https://api.telegram.org/bot${AP_WATCH_TG_TOKEN}/sendMessage" \
      --data-urlencode "chat_id=${AP_WATCH_TG_CHAT}" \
      --data-urlencode "text=$1
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

# since_start "$name" → " (+Xm)" / " (+XhYm)" thời gian trôi từ lúc START (mốc $ST/<name>.started ghi 1
# lần khi bắn START). Rỗng nếu chưa có mốc. Gắn vào MỌI alert sau START (vd "READY (+45m)").
since_start() {
  local f="$ST/$1.started" s d h m
  s="$(cat "$f" 2>/dev/null)"; case "$s" in (''|*[!0-9]*) echo ""; return;; esac
  d=$(( $(now) - s )); [ "$d" -lt 0 ] && d=0
  h=$(( d/3600 )); m=$(( (d%3600)/60 ))
  if [ "$h" -gt 0 ]; then echo " (+${h}h${m}m)"; else echo " (+${m}m)"; fi
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

# claude_active "$dir" → 0 nếu có tiến trình Claude Code với cwd NẰM TRONG worktree này.
# Agent "thinking with max effort" + chỉ Read/Grep (không ghi file) >8' → fingerprint đứng im, codex
# KHÔNG chạy → STALL giả. Process claude còn sống = session còn mở (đang nghĩ/đọc, hoặc chờ ở decision
# đã có alert riêng) → KHÔNG phải crash. STALL chung chỉ đúng khi process đã biến mất.
claude_active() { # $1 = worktree dir — gắn worktree qua cwd HOẶC file đang mở (session hay mở ở repo gốc
  local pid cwd                          # rồi `cd` vào worktree mỗi lệnh → cwd process = repo gốc, không khớp).
  for pid in $(pgrep -f 'claude' 2>/dev/null); do
    cwd="$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -1)"
    case "$cwd" in "$1"|"$1"/*) return 0;; esac
    lsof -p "$pid" 2>/dev/null | grep -qF "$1/" && return 0   # có file mở trong worktree
  done
  return 1
}
# any_claude_alive → 0 nếu có BẤT KỲ process Claude Code nào → phân biệt crash thật (không có) với
# "đang chạy nhưng không attribute được vào worktree" (đừng khẳng định crash).
any_claude_alive() { pgrep -f 'claude' >/dev/null 2>&1; }

echo "ap-watch: theo dõi $WT_ROOT · poll ${INTERVAL}s · stall ${STALL_MIN}m · state $ST · Ctrl-C để dừng"
while true; do
  shopt -s nullglob

  # ===== BACKLOG STALE: task đã merged nhưng backlog còn planned/ready (nếu repo có tool) =====
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
      el="$(since_start "$nm")"   # tính TRƯỚC khi rm xoá .started
      if [ -f "$ST/$nm.alert.ready" ]; then
        notify "✅ AUTOPILOT DONE${el}" "$nm — worktree đã gỡ (merged/cleanup hoặc đóng)" "Glass"
      else
        notify "✅ AUTOPILOT DONE${el}" "$nm — worktree đã gỡ (merged/cleanup). LƯU Ý: chưa kịp bắn READY (ready→merge nhanh, hoặc watchdog restart sau khi worktree đã gỡ)" "Glass"
      fi
      rm -f "$ST/$nm".*   # xoá mọi marker của nó (seen/fp/ts/alert/started) → không báo lại
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

    # Theo dõi worktree nếu: đã REGISTER trong INFLIGHT (in-flight|ready) HOẶC có process Claude đang
    # SỐNG trong đó (session mới chưa kịp scope-gate register vẫn track NGAY). Worktree bỏ hoang (không
    # register + không process) → bỏ qua (hết nhiễu). → mọi session mới auto-track từ đầu.
    st="$(inflight_status "$slug")"
    if [ -z "$st" ] && ! claude_active "$dir"; then clear_alerts "$name"; continue; fi
    # fix-round-count (đọc SỚM — dùng cho nhãn START + maxwarn)
    frc="$(cat "$sdir/$slug/fix-round-count.txt" 2>/dev/null || echo 0)"
    case "$frc" in (''|*[!0-9]*) frc=0;; esac

    # STARTED bookend — phân biệt TIẾP TỤC/resume (worktree ĐÃ có việc: round file hoặc frc>0 — founder
    # reset frc để resume, hoặc reload/đổi ST-dir) vs session MỚI → nhãn rõ ràng.
    if [ ! -f "$ST/$name.seen" ]; then
      now > "$ST/$name.started"
      if [ -n "$(ls "$sdir/$slug/"round-*.txt "$sdir/$slug/codex/"round-*.txt 2>/dev/null)" ] || [ "$frc" -gt 0 ]; then
        notify "🔄 AUTOPILOT TIẾP TỤC" "$slug — tiếp tục theo dõi (resume/reload — session ĐÃ có việc trước, KHÔNG phải bắt đầu mới)" "Glass"
      else
        notify "🚀 AUTOPILOT START" "$slug — session bắt đầu (đang theo dõi)" "Glass"
      fi
    fi
    touch "$ST/$name.seen"

    # SẮP MAX_ROUNDS — cảnh báo 1 lần khi frc >= ngưỡng. Re-arm khi frc TỤT < ngưỡng (resume/frc-reset).
    [ "$frc" -lt "$MAXR_WARN" ] && rm -f "$ST/$name.maxwarned" 2>/dev/null
    if [ "$frc" -ge "$MAXR_WARN" ] && [ ! -f "$ST/$name.maxwarned" ]; then
      touch "$ST/$name.maxwarned"
      notify "⚠️ SẮP MAX_ROUNDS$(since_start "$name")" "$slug: fix-round-count=$frc (HALT khi ≥$MAXR_HALT) — sắp thrash, chuẩn bị re-slice/escalate" "Basso"
    fi

    # ===== trạng thái KẾT THÚC dứt khoát — báo NGAY (KHÔNG đợi cửa sổ stall) =====
    if [ "$st" = "ready" ]; then
      alert_once "$name" alert.ready "✅ AUTOPILOT READY$(since_start "$name")" "$slug → READY, chờ merge tay" "Glass"; continue
    fi
    # File 'HALT*' (hard halt) HOẶC 'AWAIT*' (agent dừng HỎI/chờ founder quyết) → báo NGAY.
    hf="$(find "$sdir" \( -iname 'HALT*' -o -iname 'AWAIT*' \) -type f 2>/dev/null | head -1)"
    if [ -n "$hf" ]; then
      case "$(basename "$hf")" in
        [Aa][Ww][Aa][Ii][Tt]*) ttl="⏸️ CẦN FOUNDER QUYẾT"; dtl="$(head -1 "$hf" 2>/dev/null)";;
        *) ttl="⛔ AUTOPILOT HALT"; dtl="$(grep -hoiE 'SCOPE_COLLISION|REGION_THRASH|MAX_ROUNDS|DEP_MISSING|POLICY_MISMATCH|CODEX_UNAVAILABLE|SCOPE_DRIFT|MERGE_GATE_FAIL|INVARIANT_UNKNOWN|TDD_ORACLE_VIOLATED|MONEY_GUESS|LEGACY_DRIFT|TRANSPORT_DRIFT|WRONG_BRANCH_HEAD|DIRTY_TREE|LIVE_DB_WRITE' "$hf" 2>/dev/null | head -1)";;
      esac
      alert_once "$name" alert.halt "${ttl}$(since_start "$name")" "$slug — ${dtl:-$(basename "$hf")} (xem TUI)" "Basso"; continue
    fi
    # MAX_ROUNDS DỨT KHOÁT — báo NGAY (không đợi 8'): frc chạm cap = agent dừng chờ founder quyết.
    # Guard codex_active: nếu codex còn review thì CHƯA halt. fix-round-count.txt agent LUÔN ghi.
    if [ "$frc" -ge "$MAXR_HALT" ] && ! codex_active "$dir" && ! claude_active "$dir"; then
      alert_once "$name" alert.halt "⛔ AUTOPILOT HALT$(since_start "$name")" "$slug — MAX_ROUNDS (fix-round-count=$frc, trần >5) — agent dừng, CẦN FOUNDER QUYẾT (re-slice/escalate) — xem TUI" "Basso"; continue
    fi

    head="$(git -C "$dir" rev-parse --short HEAD 2>/dev/null || echo '-')"
    nm="$(newest_mtime_in "$sdir")"
    sm="$(newest_mtime_in "$dir/src")"
    fp="$head:$nm:$sm"

    # fingerprint thay đổi → đang tiến triển → ghi nhận + reset alert (+ báo HỒI nếu từng cảnh báo)
    fpf="$ST/$name.fp"; tsf="$ST/$name.ts"
    if [ "$(cat "$fpf" 2>/dev/null)" != "$fp" ]; then
      if ls "$ST/$name".alert.hang "$ST/$name".alert.stall "$ST/$name".alert.halt >/dev/null 2>&1; then
        notify "▶️ AUTOPILOT HỒI$(since_start "$name")" "$slug — đã chạy lại sau cảnh báo (founder phản hồi / codex-stall tự khỏi / retry), đang tiến triển tiếp" "Glass"
      fi
      echo "$fp" > "$fpf"; now > "$tsf"; clear_alerts "$name"; continue
    fi
    idle=$(( $(now) - $(cat "$tsf" 2>/dev/null || now) ))
    [ "$idle" -lt "$STALL_SEC" ] && continue

    # codex review đang chạy → tiến triển → reset + HỒI nếu từng cảnh báo.
    if codex_active "$dir"; then
      ls "$ST/$name".alert.hang "$ST/$name".alert.stall "$ST/$name".alert.halt >/dev/null 2>&1 && \
        notify "▶️ AUTOPILOT HỒI$(since_start "$name")" "$slug — codex review chạy lại, không phải treo" "Glass"
      now > "$tsf"; clear_alerts "$name"; continue
    fi
    # Claude còn sống + frc CHƯA chạm trần + chưa tới ngưỡng idle-DÀI → coi là đang nghĩ/đọc → bỏ qua.
    # KHÔNG reset ts (để idle TÍCH LŨY): nghĩ thật vài phút sẽ có hoạt động lại (reset ở fingerprint),
    # còn HALT-chờ-founder thì đứng im vô hạn → vượt LONG_IDLE_SEC sẽ rớt xuống cảnh báo bên dưới.
    if claude_active "$dir" && [ "$frc" -lt "$MAXR_HALT" ] && [ "$idle" -lt "$LONG_IDLE_SEC" ]; then
      continue
    fi

    # ===== phân loại (codex không chạy; + frc>=trần HOẶC idle rất dài HOẶC process đã chết) =====
    # MAX_ROUNDS hard-stop: fix-round-count chạm trần. Ưu tiên TRƯỚC auth/stall để gắn nhãn đúng.
    if [ "$frc" -ge "$MAXR_HALT" ]; then
      alert_once "$name" alert.halt "⛔ AUTOPILOT HALT$(since_start "$name")" "$slug — MAX_ROUNDS (fix-round-count=$frc, trần >5, đứng im ${idle}s) — founder re-slice/escalate (xem TUI)" "Basso"; continue
    fi
    # CODEX AUTH CHẾT — verdict-first + strip rmcp noise (L18b): bỏ dòng 'rmcp::transport::worker' rồi
    # chỉ bắt dấu auth của CHÍNH codex (review thành công dính nhiễu connector vẫn không bị quy chết).
    rfile="$(ls -t "$sdir/$slug/"round-*.txt "$sdir/$slug/codex/"round-*.txt 2>/dev/null | head -1)"
    if [ -n "$rfile" ] && grep -v 'rmcp::transport::worker' "$rfile" 2>/dev/null | grep -qiE 'access token could not be refreshed|codex_login::auth::manager.*[Ff]ailed to refresh token|Review was interrupted|Your session has ended|Please log ?in again'; then
      alert_once "$name" alert.hang "⚠️ CODEX AUTH CHẾT$(since_start "$name")" "$slug: codex auth chết (đứng im ${idle}s) — codex logout && login rồi retry /review" "Basso"; continue
    fi
    # Còn lại: claude SỐNG + đứng im RẤT lâu (>LONG_IDLE) → nghi đã HALT/chờ founder ở frc thấp (agent
    # quên ghi sentinel). claude CHẾT → session đóng/crash. Hai nhãn khác nhau.
    rinfo="$( [ -n "$rfile" ] && echo "round mới nhất $(stat -f %z "$rfile" 2>/dev/null)B" || echo 'chưa có round' )"
    if claude_active "$dir"; then
      alert_once "$name" alert.stall "⏸️ NGHI CHỜ FOUNDER$(since_start "$name")" "$slug: đứng im ${idle}s, claude còn sống nhưng KHÔNG codex/không tiến triển — nhiều khả năng đã HALT/chờ founder (agent quên ghi sentinel), hoặc nghĩ rất lâu — XEM TUI" "Basso"
    elif any_claude_alive; then
      alert_once "$name" alert.stall "⏸️ ĐỨNG IM$(since_start "$name")" "$slug: ${idle}s không tiến triển ($rinfo) — có Claude đang chạy nhưng không gắn được vào worktree (có thể nghĩ rất lâu / mở ở repo gốc) — XEM TUI (CHƯA chắc crash)" "Basso"
    else
      alert_once "$name" alert.stall "⚠️ AUTOPILOT STALL$(since_start "$name")" "$slug: ${idle}s đứng im, KHÔNG còn process codex/claude nào ($rinfo) — session đóng/crash — XEM TUI" "Basso"
    fi
  done
  sleep "$INTERVAL"
done
