#!/usr/bin/env bash
# Write (and optionally load) the launchd plists for a target repo: the dispatcher every
# 900s and the weekly report Monday 09:00 local. By default it only WRITES the plists — the
# owner loads them after the push/probe steps (README-W2). Pass --load to load now.
#   ap3/install-launchd.sh <target-repo> [--load]
set -euo pipefail
TARGET="${1:?usage: install-launchd.sh <target-repo> [--load]}"
LOAD=0; [ "${2:-}" = "--load" ] && LOAD=1
TARGET="$(cd "$TARGET" && pwd)"
SLUG="$(basename "$TARGET" | tr ' /' '--' | tr -cd '[:alnum:]._-')"
AGENTS="$HOME/Library/LaunchAgents"
LOGDIR="$HOME/Library/Logs/ap3"
mkdir -p "$AGENTS" "$LOGDIR"

# Compose a PATH launchd can use to find claude/gh/codex/python3/git/node.
dirof() { command -v "$1" 2>/dev/null | xargs -I{} dirname {} 2>/dev/null || true; }
PATHSET="$(printf '%s\n' \
  "$(dirof claude)" "$(dirof gh)" "$(dirof codex)" "$(dirof python3)" "$(dirof git)" "$(dirof node)" \
  /opt/homebrew/bin /usr/local/bin /usr/bin /bin /usr/sbin /sbin | awk 'NF && !seen[$0]++' | paste -sd: -)"

# XML-escape any value interpolated into the plist (a repo path could contain & < > " ').
xmle() { printf '%s' "$1" | sed 's/&/\&amp;/g; s/</\&lt;/g; s/>/\&gt;/g; s/"/\&quot;/g; s/'"'"'/\&apos;/g'; }
TARGET_X="$(xmle "$TARGET")"; PATHSET_X="$(xmle "$PATHSET")"; HOME_X="$(xmle "$HOME")"; LOGDIR_X="$(xmle "$LOGDIR")"

# AbandonProcessGroup=true is load-bearing: dispatch.sh exits right after STARTED and leaves the
# writer (`nohup claude -p ... &`) running. launchd's default is to SIGKILL every process still in
# the job's process group when the job's main process exits — W2 run 1 (Plexco, 2026-09-10) died
# that way within the same second as STARTED, with 0-byte result.json/stderr.log. nohup only
# covers SIGHUP; this key is what keeps the writer alive between ticks.
write_plist() { # <label> <logname> <program-args-xml> <schedule-xml>
  local label logname args sched file
  label="$(xmle "$1")"; logname="$(xmle "$2")"; args="$3"; sched="$4"; file="$AGENTS/$1.plist"
  cat > "$file" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$label</string>
  <key>ProgramArguments</key>
  <array>
$args
  </array>
  <key>WorkingDirectory</key><string>$TARGET_X</string>
  <key>EnvironmentVariables</key>
  <dict><key>PATH</key><string>$PATHSET_X</string><key>HOME</key><string>$HOME_X</string></dict>
  <key>RunAtLoad</key><false/>
  <key>AbandonProcessGroup</key><true/>
$sched
  <key>StandardOutPath</key><string>$LOGDIR_X/$logname.log</string>
  <key>StandardErrorPath</key><string>$LOGDIR_X/$logname.log</string>
</dict>
</plist>
PLIST
  echo "$file"
}

DISPATCH_LABEL="com.ap3.dispatch.$SLUG"
REPORT_LABEL="com.ap3.report.$SLUG"

P1="$(write_plist "$DISPATCH_LABEL" "dispatch-$SLUG" \
  "    <string>/bin/bash</string>
    <string>$TARGET_X/ap3/dispatch.sh</string>" \
  "  <key>StartInterval</key><integer>900</integer>")"
P2="$(write_plist "$REPORT_LABEL" "report-$SLUG" \
  "    <string>/bin/bash</string>
    <string>$TARGET_X/ap3/report.sh</string>
    <string>--since</string><string>7d</string>
    <string>--telegram</string>" \
  "  <key>StartCalendarInterval</key><dict><key>Weekday</key><integer>1</integer><key>Hour</key><integer>9</integer><key>Minute</key><integer>0</integer></dict>")"

echo "wrote: $P1"
echo "wrote: $P2"
if [ "$LOAD" = 1 ]; then
  launchctl unload "$P1" 2>/dev/null || true; launchctl load "$P1"
  launchctl unload "$P2" 2>/dev/null || true; launchctl load "$P2"
  echo "loaded: $DISPATCH_LABEL $REPORT_LABEL"
else
  echo "NOT loaded (run with --load, or: launchctl load $P1 && launchctl load $P2)"
fi
