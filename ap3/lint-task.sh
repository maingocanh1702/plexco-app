#!/usr/bin/env bash
# Task-file gate (DESIGN §5.1). Prints 'OK' or 'INVALID_TASK <slug>: <reason>' and exits
# non-zero on failure. Runs in the repo being linted (cwd) and reads that repo's
# ap3/routines.json — it does NOT require the ap3 kit to be installed there, so the owner
# can lint a prepared task before installing anything:
#   bash /path/to/kit/ap3/lint-task.sh ap3/queue/<slug>.md
# The dispatcher runs the same lint on every candidate and skips failures.
# Set AP3_LINT_NO_REMOTE=1 to skip the origin-branch probe (tests / offline).
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TASK="${1:-}"
[ -n "$TASK" ] || { echo "usage: lint-task.sh ap3/queue/<slug>.md" >&2; exit 2; }
slug="$(basename "$TASK" .md)"

# git-side checks (a run in flight, or a branch already on origin, means "not queueable")
if [ -e "ap3/state/runs/$slug/record.json" ]; then
  echo "INVALID_TASK $slug: a run record already exists at ap3/state/runs/$slug/"; exit 1
fi
if [ -z "${AP3_LINT_NO_REMOTE:-}" ] && git rev-parse --git-dir >/dev/null 2>&1; then
  if git ls-remote --heads origin "ap3/$slug" 2>/dev/null | grep -q .; then
    echo "INVALID_TASK $slug: origin already has branch ap3/$slug"; exit 1
  fi
fi

# frontmatter / scope / body / context checks (reads ./ap3/routines.json and the working tree)
exec python3 "$DIR/aplib.py" lint "$TASK"
