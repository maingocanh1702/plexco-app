#!/usr/bin/env bash
# ap-watch-install.sh — cài LaunchAgent watchdog autopilot cho REPO hiện tại (1 lần/repo, macOS).
# Tạo ~/Library/LaunchAgents/com.autopilot.ap-watch.<repo>.plist trỏ tới <repo>/scripts/ap-watch.sh
# rồi load. Idempotent (reload nếu đã có). Telegram đọc ~/.ap-watch.env (DÙNG CHUNG mọi repo).
#
#   bash "<template>/autopilot/parallel/ap-watch-install.sh" [interval_sec=30] [stall_min=8]
#
# Gỡ:  launchctl unload ~/Library/LaunchAgents/com.autopilot.ap-watch.<repo>.plist
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || { echo "HALT: không ở trong git repo"; exit 1; }
SCRIPT="$ROOT/scripts/ap-watch.sh"
[ -f "$SCRIPT" ] || { echo "HALT: $SCRIPT chưa có — chạy autopilot-init.sh trước (nó copy ap-watch.sh vào scripts/)."; exit 1; }
chmod +x "$SCRIPT"

INTERVAL="${1:-30}"; STALL="${2:-8}"
SAFE="$(printf '%s' "$(basename "$ROOT")" | tr -c 'A-Za-z0-9' '-' | sed 's/^-*//;s/-*$//')"
LABEL="com.autopilot.ap-watch.$SAFE"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="/tmp/ap-watch-$SAFE.log"; ERR="/tmp/ap-watch-$SAFE.err"
mkdir -p "$HOME/Library/LaunchAgents"

launchctl unload "$PLIST" 2>/dev/null || true   # reload nếu đã cài
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$SCRIPT</string>
    <string>$INTERVAL</string>
    <string>$STALL</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict><key>AP_WATCH_REPO</key><string>$ROOT</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$ERR</string>
  <key>ProcessType</key><string>Background</string>
</dict>
</plist>
EOF
launchctl load "$PLIST"

echo "✅ Watchdog autopilot đã cài cho: $ROOT"
echo "   plist:  $PLIST  (label $LABEL)"
echo "   log:    $LOG     (tail -f để xem poll/alert)"
echo "   poll ${INTERVAL}s · stall ${STALL}m"
echo ""
echo "Telegram (tuỳ chọn, DÙNG CHUNG mọi repo) — tạo ~/.ap-watch.env:"
echo "   AP_WATCH_TG_TOKEN=\"<token BotFather>\""
echo "   AP_WATCH_TG_CHAT=\"<owner chat_id>\""
echo "Đổi config sau: sửa rồi launchctl unload && load lại plist trên."
