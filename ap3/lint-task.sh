#!/usr/bin/env bash
# Task-file gate (DESIGN §5.1). Prints 'OK' or 'INVALID_TASK <slug>: <reason>' and exits
# non-zero on failure. Runs in the repo being linted (cwd) and reads that repo's
# ap3/routines.json — it does NOT require the ap3 kit to be installed there, so the owner
# can lint a prepared task before installing anything:
#   bash /path/to/kit/ap3/lint-task.sh ap3/queue/<slug>.md
# The dispatcher runs the same lint on every candidate and skips failures.
# Set AP3_LINT_NO_REMOTE=1 to skip the origin-branch probe (tests / offline).
#
# --at <ref>: lint the PINNED SNAPSHOT at <ref>, not the working tree (K2). The plain form above
# can pass on a Context file that only exists untracked, which the dispatcher's real origin/main
# worktree would never see — both 2026-09-10 INVALID_TASK ticks were exactly that. `--at` first
# confirms the file really exists on <ref>, then relints it — frontmatter, scope, verify, body
# headings and every Context path — inside a throwaway detached worktree of <ref>, so "Context
# path must exist" is checked against what <ref> actually contains. The worktree is always removed
# (trap), even on failure. AP3_TRUST_PATH is honoured (defaulting to the caller repo's own
# ap3/state/trust.json), since a fresh worktree's own ap3/state is always empty.
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

AT=""
TASK=""
while [ $# -gt 0 ]; do
  case "$1" in
    --at) AT="${2:?--at requires a ref}"; shift 2 ;;
    *) TASK="$1"; shift ;;
  esac
done
[ -n "$TASK" ] || { echo "usage: lint-task.sh [--at <ref>] ap3/queue/<slug>.md" >&2; exit 2; }
slug="$(basename "$TASK" .md)"

if [ -n "$AT" ]; then
  if ! git cat-file -e "$AT:$TASK" 2>/dev/null; then
    echo "INVALID_TASK $slug: not on $AT"; exit 1
  fi
  trust="${AP3_TRUST_PATH:-ap3/state/trust.json}"
  case "$trust" in /*) ;; *) trust="$PWD/$trust" ;; esac   # must survive the cd into the worktree below
  wt="$(mktemp -d "${TMPDIR:-/tmp}/ap3-lint-at-XXXXXX")"
  trap 'git worktree remove --force "$wt" >/dev/null 2>&1 || rm -rf "$wt"' EXIT
  git worktree add -q --detach "$wt" "$AT" >/dev/null
  rc=0
  ( cd "$wt" && AP3_TRUST_PATH="$trust" python3 "$DIR/aplib.py" lint "$TASK" ) || rc=$?
  exit "$rc"
fi

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
