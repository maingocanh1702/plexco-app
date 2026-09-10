#!/usr/bin/env bash
# Owner-only: the manual HALT-recovery sequence used by hand on 2026-09-10 (K3). A HALTed run
# leaves BOTH ap3/state/runs/<slug>/ and the run's worktree + local branch ap3/<slug> in place, by
# design, for forensics -- so start_next refuses to ever re-dispatch that slug again. This clears
# them (never deletes: the run record is archived), fail-closed:
#   ap3/retry.sh <slug>
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$DIR/.." && pwd)"; cd "$REPO"
SLUG="${1:?usage: retry.sh <slug>}"
# the same slug shape enforced everywhere else (aplib.py, dispatch.sh) -- reject BEFORE any
# filesystem path is built from it, so a path-traversing value (e.g. ../../../etc) can never
# reach the worktree/branch/mv operations below.
echo "$SLUG" | grep -qE '^[a-z0-9][a-z0-9-]{2,60}$' \
  || { echo "retry: invalid slug '$SLUG' (must match ^[a-z0-9][a-z0-9-]{2,60}\$)" >&2; exit 1; }
REC="ap3/state/runs/$SLUG/record.json"
WT="ap3/state/worktrees/$SLUG"

[ -e "$REC" ] || { echo "retry: no run record at $REC" >&2; exit 1; }

status="$(python3 "$DIR/rec.py" get "$REC" status "")"
if [ "$status" != halted ]; then
  echo "retry: refusing $SLUG -- status is '$status', not 'halted' (a READY run with an open PR is never retried)" >&2
  exit 1
fi
remote_out="$(git ls-remote --heads origin "ap3/$SLUG" 2>&1)" || {
  echo "retry: refusing $SLUG -- could not query origin for branch ap3/$SLUG ($remote_out)" >&2
  exit 1
}
if [ -n "$remote_out" ]; then
  echo "retry: refusing $SLUG -- origin already has branch ap3/$SLUG (a pushed branch means a PR exists -- human decision)" >&2
  exit 1
fi

terminal="$(python3 "$DIR/rec.py" get "$REC" terminal unknown)"
ts="$(date -u +%Y%m%dT%H%M%SZ)"
archive="ap3/state/runs-archive/$SLUG-$terminal-$ts"

git worktree remove --force "$WT" 2>/dev/null || true
if [ -e "$WT" ]; then
  echo "retry: refusing $SLUG -- could not remove worktree at $WT (still present); resolve by hand and retry" >&2
  exit 1
fi
git branch -D "ap3/$SLUG" 2>/dev/null || true
if git rev-parse --verify --quiet "refs/heads/ap3/$SLUG" >/dev/null; then
  echo "retry: refusing $SLUG -- could not delete local branch ap3/$SLUG (still present); resolve by hand and retry" >&2
  exit 1
fi
mkdir -p "$(dirname "$archive")"
mv "ap3/state/runs/$SLUG" "$archive"

echo "retry: cleared $SLUG (was HALT $terminal) -- worktree and local branch removed, run archived to $archive"
echo "retry: the class is still paused -- run 'ap3/unpause.sh <class>' yourself when ready (not chained here)"
