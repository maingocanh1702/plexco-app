#!/usr/bin/env bash
# Owner-only: the manual HALT-recovery sequence used by hand on 2026-09-10 (K3). A HALTed run
# leaves BOTH ap3/state/runs/<slug>/ and the run's worktree + local branch ap3/<slug> in place, by
# design, for forensics -- so start_next refuses to ever re-dispatch that slug again. This clears
# them (never deletes: the run record is archived), fail-closed:
#   ap3/retry.sh <slug>                  full rewrite: wipe worktree+branch, archive, re-queue fresh
#   ap3/retry.sh --review-only <slug>    K8: resume ONLY the review step of an OUTAGE halt (the
#                                        reviewer/push/PR/evidence/isolation infra failed, not the
#                                        writer) -- no second writer session. Refuses outside that
#                                        fixed terminal set, or if the worktree no longer holds
#                                        .ap3-run/READY-FOR-REVIEW at the recorded head_sha.
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$DIR/.." && pwd)"; cd "$REPO"

REVIEW_ONLY=0
if [ "${1:-}" = --review-only ]; then REVIEW_ONLY=1; shift; fi
SLUG="${1:?usage: retry.sh [--review-only] <slug>}"
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

if [ "$REVIEW_ONLY" = 1 ]; then
  # kept in sync BY HAND with dispatch.sh's OUTAGE_TERMINALS -- this script never sources
  # dispatch.sh (it unconditionally runs main() at the bottom, so it cannot be sourced for its
  # functions without also dispatching a tick).
  terminal="$(python3 "$DIR/rec.py" get "$REC" terminal unknown)"
  case " REVIEW_UNAVAILABLE PUSH_FAILED PR_FAILED REMOTE_TIP_MISMATCH EVIDENCE_FAILED FS_ISOLATION_UNSAFE NO_WRITER_SETTINGS DB_ISOLATION_LOST TELEMETRY_FAILED " in
    *" $terminal "*) : ;;
    *) echo "retry: refusing --review-only $SLUG -- terminal '$terminal' is not an outage terminal (use a full 'retry.sh $SLUG' instead)" >&2; exit 1 ;;
  esac
  [ -d "$WT" ] || { echo "retry: refusing --review-only $SLUG -- no worktree at $WT" >&2; exit 1; }
  [ -f "$WT/.ap3-run/READY-FOR-REVIEW" ] \
    || { echo "retry: refusing --review-only $SLUG -- $WT/.ap3-run/READY-FOR-REVIEW is missing (use a full 'retry.sh $SLUG' instead)" >&2; exit 1; }
  rec_head="$(python3 "$DIR/rec.py" get "$REC" head_sha "")"
  wt_head="$(git -C "$WT" rev-parse HEAD 2>/dev/null || true)"
  if [ -z "$rec_head" ] || [ "$rec_head" != "$wt_head" ]; then
    echo "retry: refusing --review-only $SLUG -- the head moved (worktree HEAD $wt_head != recorded head_sha $rec_head)" >&2
    exit 1
  fi
  # review round-1 finding 4: halt() drops this run's per-run database on EVERY halt, including
  # outage -- db_name stays pinned on the record, so recreate it before resuming, or a later fix
  # round would rewrite DATABASE_URL_TEST to point at a database that no longer exists.
  # review round-2 finding 3: tolerating a bare "already exists" on CREATE cannot distinguish a
  # database our own prior DROP left absent (safe to recreate) from one whose DROP silently
  # failed (round-1's cleanup_run_db swallowed every psql error) -- resuming against THAT one
  # means reviewing a database that may still hold dirty state from the run being retried. DROP
  # (idempotent, IF EXISTS) then CREATE unconditionally instead, so a resumed run always gets a
  # verified fresh, empty database -- any failure at either step refuses fail-closed.
  db_name="$(python3 "$DIR/rec.py" get "$REC" db_name "")"
  if [ -n "$db_name" ]; then
    db_admin_url=""
    if [ -f "$REPO/ap3/env" ]; then
      db_admin_url="$( set -a; . "$REPO/ap3/env"; set +a; printf '%s' "${AP3_DB_ADMIN_URL:-}" )"
    fi
    if [ -z "$db_admin_url" ]; then
      echo "retry: refusing --review-only $SLUG -- db_name '$db_name' is pinned but AP3_DB_ADMIN_URL is not set in ap3/env, cannot recreate it" >&2
      exit 1
    fi
    if ! psql "$db_admin_url" -c "DROP DATABASE IF EXISTS \"$db_name\"" >/dev/null 2>&1; then
      echo "retry: refusing --review-only $SLUG -- could not drop existing database \"$db_name\" before recreating it fresh" >&2
      exit 1
    fi
    if ! psql "$db_admin_url" -c "CREATE DATABASE \"$db_name\"" >/dev/null 2>&1; then
      echo "retry: refusing --review-only $SLUG -- could not recreate database \"$db_name\" after dropping it" >&2
      exit 1
    fi
  fi
  python3 "$DIR/rec.py" set "$REC" status running
  # W4.1 round-2 review finding 1: resume_review tells reconcile_running to SKIP re-accumulating
  # this attempt's telemetry, because normally it was already summed the first time this same
  # result.json was processed -- summing it again would double-count. But TELEMETRY_FAILED means
  # accumulation itself is exactly what failed: it was NEVER successfully counted, so skipping it
  # on resume would let this attempt's real cost go permanently unaccounted, with spent_usd
  # unchanged, while the run proceeds toward READY. Leave resume_review unset for this one
  # terminal so the next reconcile properly (re)attempts accumulation -- if the underlying bad
  # data is still there, it fails closed again (TELEMETRY_FAILED), exactly as it should.
  if [ "$terminal" != TELEMETRY_FAILED ]; then
    python3 "$DIR/rec.py" setjson "$REC" resume_review true
  fi
  # no live process backs this resumed attempt -- clear pid so a coincidentally-reused pid can
  # never make reconcile_running read this run as still BUSY.
  python3 "$DIR/rec.py" setjson "$REC" pid 0
  echo "retry: $SLUG resumed for review only (was HALT $terminal) -- next dispatcher tick re-enters the review step, no writer relaunch"
  echo "retry: the class is still paused -- run 'ap3/unpause.sh <class>' yourself when ready (not chained here)"
  exit 0
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
