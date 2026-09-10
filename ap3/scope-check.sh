#!/usr/bin/env bash
# The boundary that actually counts (DESIGN §6.7): git diff --name-only <base>..HEAD must
# be a subset of the task's scope globs. The PreToolUse hook only sees Claude's own
# Edit/Write; a `sed -i` inside sandboxed bash can still touch any file, so the committed
# diff is re-checked here (by the writer as a self-check, and independently by the
# dispatcher before it trusts a READY). Prints OK, or one `DRIFT <file>` line per stray
# file and exits 1.
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BASE="${AP3_BASE_SHA:-}"
TASK="${AP3_TASK:-}"
while [ $# -gt 0 ]; do
  case "$1" in
    --base) BASE="$2"; shift 2 ;;
    --task) TASK="$2"; shift 2 ;;
    *) echo "usage: scope-check.sh --base <sha> [--task <file>]" >&2; exit 2 ;;
  esac
done
[ -n "$BASE" ] || { echo "scope-check: --base (or AP3_BASE_SHA) required" >&2; exit 2; }
[ -n "$TASK" ] && [ -f "$TASK" ] || { echo "scope-check: --task (or AP3_TASK) must be a file" >&2; exit 2; }

# scopecheck exits 1 on drift; guard set -e/pipefail so we still reach the print below.
# three-dot (base...HEAD) matches the reviewer's diff definition exactly, so the scope gate and the
# reviewer can never examine different file sets.
set +e
out="$(git diff --name-only "$BASE"...HEAD | python3 "$DIR/aplib.py" scopecheck "$TASK")"
rc=$?
set -e
if [ "$rc" -eq 0 ]; then
  echo "OK"
else
  echo "$out"
  echo "SCOPE_DRIFT"
fi
exit "$rc"
