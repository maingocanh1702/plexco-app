#!/usr/bin/env bash
# Stop hook: don't let the writer stop until it has handed off for review
# (.ap3-run/READY-FOR-REVIEW) or recorded a HALT (.ap3-run/HALT.md). The writer does NOT
# open the PR — the dispatcher does that after a CLEAN review. Exit 2 keeps the session going
# once; the stop_hook_active guard makes it fire at most once so it cannot loop. No-op outside
# an ap3 run so a normal interactive session in the same repo can always stop.
set -euo pipefail
[ -n "${AP3_TASK:-}" ] || exit 0

active="$(python3 -c 'import json,sys
try:
    d = json.load(sys.stdin)
except Exception:
    d = {}
print("1" if d.get("stop_hook_active") else "0")')"
[ "$active" = "1" ] && exit 0

if [ -f .ap3-run/READY-FOR-REVIEW ] || [ -f .ap3-run/HALT.md ]; then
  exit 0
fi
echo "ap3: before stopping, write .ap3-run/READY-FOR-REVIEW (the dispatcher reviews it and opens the PR) or write .ap3-run/HALT.md naming a stop rule (SCOPE_DRIFT|VERIFY_FAIL|MISSING_CONTEXT|MAX_ROUNDS)." >&2
exit 2
