#!/usr/bin/env bash
# W6 (I1): the intake pre-flight -- "does this task carry enough context for a headless writer to
# START?" Run by the dispatcher inside the candidate's freshly-created worktree (the exact
# origin/main snapshot), BEFORE any run state exists, once per task CONTENT (the dispatcher caches
# the verdict by the task blob id). Owner decision 2026-09-18: questions go to Telegram and
# ap3/state/questions/<slug>.md; the owner answers by adding `## Owner context` to the task and
# pushing main; the changed blob re-triggers this check on the next tick.
#   ap3/preflight.sh --task <file> --model <m> --budget <usd> [--cwd <dir>]
# Prints the model's text, then EXACTLY one canonical last line:
#   AP3_PREFLIGHT: READY | QUESTIONS | UNAVAILABLE       exit 0 | 1 | 3
# Fail-closed on the marker: a reply that does not END with a marker is UNAVAILABLE, never READY.
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TASK=""; MODEL="claude-sonnet-5"; BUDGET="0.5"; CWD="$PWD"
while [ $# -gt 0 ]; do
  case "$1" in
    --task) TASK="$2"; shift 2 ;;
    --model) MODEL="$2"; shift 2 ;;
    --budget) BUDGET="$2"; shift 2 ;;
    --cwd) CWD="$2"; shift 2 ;;
    *) echo "preflight: unknown arg $1" >&2; exit 2 ;;
  esac
done
[ -n "$TASK" ] && [ -f "$TASK" ] || { echo "preflight: --task must be a file" >&2; exit 2; }
PROMPT="$(mktemp)"; COST="$(mktemp)"
trap 'rm -f "$PROMPT" "$COST"' EXIT
{ cat "$DIR/prompts/preflight.md"; echo; echo "===== TASK ====="; cat "$TASK"; echo "===== END TASK ====="; } > "$PROMPT"
set +e
OUT="$(bash "$DIR/agent-readonly.sh" "$CWD" "$PROMPT" "$BUDGET" "$MODEL" "$COST")"
RC=$?
set -e
if [ "$RC" -ne 0 ]; then echo "AP3_PREFLIGHT: UNAVAILABLE"; exit 3; fi
printf '%s\n' "$OUT"
echo "AP3_PREFLIGHT_COST: $(cat "$COST" 2>/dev/null || echo null)"
LAST="$(printf '%s\n' "$OUT" | grep -vE '^[[:space:]]*$' | tail -1 | sed 's/[[:space:]]*$//' || true)"
case "$LAST" in
  "AP3_PREFLIGHT: READY")     echo "AP3_PREFLIGHT: READY";     exit 0 ;;
  "AP3_PREFLIGHT: QUESTIONS") echo "AP3_PREFLIGHT: QUESTIONS"; exit 1 ;;
  *)                          echo "AP3_PREFLIGHT: UNAVAILABLE"; exit 3 ;;
esac
