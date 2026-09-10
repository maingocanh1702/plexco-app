#!/usr/bin/env bash
# Telegram notification. No-op (exit 0) when the env is missing, so a dev machine without
# ~/.ap-watch.env never fails a tick. Reuses the ap-watch Telegram creds by owner choice.
#   ap3/notify.sh "message text"   (or pipe the message on stdin)
set -euo pipefail
ENVF="${AP_WATCH_ENV:-$HOME/.ap-watch.env}"
# shellcheck disable=SC1090
[ -f "$ENVF" ] && . "$ENVF" || true
TOKEN="${AP_WATCH_TG_TOKEN:-}"
CHAT="${AP_WATCH_TG_CHAT:-}"
MSG="${1:-$(cat)}"
if [ -z "$TOKEN" ] || [ -z "$CHAT" ]; then
  echo "notify: no telegram env ($ENVF), skipping" >&2
  exit 0
fi
curl -sS -m 15 "https://api.telegram.org/bot${TOKEN}/sendMessage" \
  --data-urlencode "chat_id=${CHAT}" \
  --data-urlencode "text=${MSG}" >/dev/null 2>&1 || echo "notify: send failed" >&2
exit 0
