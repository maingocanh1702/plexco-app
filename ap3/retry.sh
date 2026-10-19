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
#   ap3/retry.sh --extend-rounds <N> <slug>    W5.2 I3 (K16/K19): owner-authorized recovery from a
#   ap3/retry.sh --extend-budget <USD> <slug>  MAX_ROUNDS or BUDGET halt, OR (W5.2.1, K21) a
#                                        VERIFY_HOST_FAIL halt whose OWN round/budget ceiling is
#                                        what exhausted (halt_cause verify_host_rounds /
#                                        verify_host_budget) -- all three hold real, reviewed,
#                                        committed work no other tool can take forward. A
#                                        VERIFY_HOST_FAIL caused by a MUTATED worktree (halt_cause
#                                        verify_host_mutated) is never extendable: see
#                                        dispatch.sh's finalize_ready. Raises the ceiling that
#                                        actually blocked and resumes review at the same head -- no
#                                        second writer session either. Both flags may be given
#                                        together. Marks the record owner_extended so a later
#                                        unchanged merge is never counted as a clean UNATTENDED run
#                                        (see reconcile_ready).
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$DIR/.." && pwd)"; cd "$REPO"

now() { date -u +%Y-%m-%dT%H:%M:%SZ; }
# exact verdict-marker lines indented two spaces in what is staged into the worktree -- the same filter
# as dispatch.sh's neutralize_markers (review round 2; see stage_pinned_task below)
neutralize_markers() { sed 's/^AP3_REVIEW_VERDICT:/  AP3_REVIEW_VERDICT:/'; }

REVIEW_ONLY=0
ANSWER=0
EXTEND_ROUNDS=""
EXTEND_BUDGET=""
while [ $# -gt 0 ]; do
  case "$1" in
    --review-only) REVIEW_ONLY=1; shift ;;
    --answer) ANSWER=1; shift ;;
    --extend-rounds) EXTEND_ROUNDS="${2:?--extend-rounds requires an integer}"; shift 2 ;;
    --extend-budget) EXTEND_BUDGET="${2:?--extend-budget requires a USD amount}"; shift 2 ;;
    *) break ;;
  esac
done
SLUG="${1:?usage: retry.sh [--review-only] [--answer] [--extend-rounds N] [--extend-budget USD] <slug>}"
if [ "$REVIEW_ONLY" = 1 ] && { [ -n "$EXTEND_ROUNDS" ] || [ -n "$EXTEND_BUDGET" ]; }; then
  echo "retry: refusing $SLUG -- --review-only cannot be combined with --extend-rounds/--extend-budget (different recovery modes)" >&2
  exit 1
fi
# W5.2.3 (K23): --answer is its own recovery mode -- it re-dispatches the WRITER, where the other
# three deliberately never do. Combining it with a mode that resumes review (or raises a ceiling
# for a review that is not about to run) can only express owner confusion, so refuse rather than
# silently letting one win.
if [ "$ANSWER" = 1 ] && { [ "$REVIEW_ONLY" = 1 ] || [ -n "$EXTEND_ROUNDS" ] || [ -n "$EXTEND_BUDGET" ]; }; then
  echo "retry: refusing $SLUG -- --answer cannot be combined with --review-only/--extend-rounds/--extend-budget (different recovery modes)" >&2
  exit 1
fi
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

# Shared by --review-only and --extend-rounds/--extend-budget: halt() unconditionally drops a
# pinned per-run database (K7's cleanup_run_db, called from every halt() path), and both recovery
# modes resume the SAME worktree/diff without a second writer session -- so both need it recreated
# fresh, identically. review round-1 finding 4 (K8): db_name stays pinned on the record even after
# the drop, so recreate it before resuming, or a later fix round/verify_host would rewrite
# DATABASE_URL_TEST to point at a database that no longer exists. review round-2 finding 3:
# tolerating a bare "already exists" on CREATE cannot distinguish a database our own prior DROP
# left absent (safe to recreate) from one whose DROP silently failed (cleanup_run_db swallows every
# psql error) -- resuming against THAT one means reviewing a database that may still hold dirty
# state from the run being retried. DROP (idempotent, IF EXISTS) then CREATE unconditionally
# instead, so a resumed run always gets a verified fresh, empty database.
recreate_pinned_db() { # <label for error text, e.g. "--review-only"> -> exits 1 itself on failure
  local label="$1" db_name db_admin_url
  db_name="$(python3 "$DIR/rec.py" get "$REC" db_name "")"
  [ -n "$db_name" ] || return 0
  db_admin_url=""
  if [ -f "$REPO/ap3/env" ]; then
    db_admin_url="$( set -a; . "$REPO/ap3/env"; set +a; printf '%s' "${AP3_DB_ADMIN_URL:-}" )"
  fi
  if [ -z "$db_admin_url" ]; then
    echo "retry: refusing $label $SLUG -- db_name '$db_name' is pinned but AP3_DB_ADMIN_URL is not set in ap3/env, cannot recreate it" >&2
    exit 1
  fi
  if ! psql "$db_admin_url" -c "DROP DATABASE IF EXISTS \"$db_name\"" >/dev/null 2>&1; then
    echo "retry: refusing $label $SLUG -- could not drop existing database \"$db_name\" before recreating it fresh" >&2
    exit 1
  fi
  if ! psql "$db_admin_url" -c "CREATE DATABASE \"$db_name\"" >/dev/null 2>&1; then
    echo "retry: refusing $label $SLUG -- could not recreate database \"$db_name\" after dropping it" >&2
    exit 1
  fi
}

# W5.2.4 (K24): shared by every resume mode that can relaunch or re-review a writer session --
# copies the PINNED ap3/state/runs/<slug>/task.md (the copy the owner amends and the reviewer
# reads -- run_review's own `task="$RUNS/$slug/task.md"`) to <worktree>/.ap3-run/TASK.md, the copy
# launch_writer prefers whenever present (K23 + follow-up df7686e). Before this, only --answer
# staged the file: an owner amendment made alongside --extend-rounds/--extend-budget/--review-only
# reached the reviewer (which reads the pinned copy directly) but never a writer relaunched out of
# a later FINDINGS round (which reads whatever launch_writer finds staged -- the stale committed
# queue copy, or a stale .ap3-run/TASK.md left over from an earlier --answer). Fails closed on
# either side missing -- never silently leaves an amendment unseen. Must NEVER write the
# git-TRACKED <worktree>/ap3/queue/<slug>.md instead: the writer commits with `git add -A`, so
# that would put an undeclared file in the diff and halt the run SCOPE_DRIFT (measured -- see
# K23's own comment on this exact trap).
#
# W5.2.4 review round-1 finding 1 (K24 follow-up): `.ap3-run/` is writable by the SANDBOXED
# writer, and this `cp` runs UNSANDBOXED on the owner's machine. A writer that left
# `.ap3-run/TASK.md` as a symlink would make this `cp` (which follows a destination symlink by
# default) overwrite whatever that symlink points at with task content -- a file-clobber outside
# the worktree entirely, on the owner's own filesystem. `rm -f` the destination first: it removes
# the directory entry (never follows/deletes the symlink's TARGET), so the following `cp` always
# creates a fresh regular file, no matter what a prior writer session left there.
#
# W5.2.4 review round-1 finding 4 (K24 follow-up): also sets STAGE_PINNED_TASK_CHANGED (0 or 1) --
# whether the content just staged actually differs from what the writer would otherwise have seen
# (the previously-staged .ap3-run/TASK.md if one exists, else the tracked ap3/queue/<slug>.md).
# --review-only is the one caller that does not already mark owner_extended unconditionally (a
# pure infra-outage retry with no task change is correctly NOT human-assisted); this flag lets it
# mark owner_extended only when a real owner amendment rode along.
stage_pinned_task() { # <label for error text> -- copies the pinned task.md into the worktree, or exits 1
  local label="$1" rec_task="ap3/state/runs/$SLUG/task.md" baseline
  [ -f "$rec_task" ] \
    || { echo "retry: refusing $label $SLUG -- no pinned task at $rec_task to stage" >&2; exit 1; }
  [ -d "$WT/.ap3-run" ] \
    || { echo "retry: refusing $label $SLUG -- no $WT/.ap3-run to stage the task in" >&2; exit 1; }
  if [ -f "$WT/.ap3-run/TASK.md" ]; then
    baseline="$WT/.ap3-run/TASK.md"
  else
    baseline="$WT/ap3/queue/$SLUG.md"
  fi
  # Review round 2 (2026-10-18): the staged copy is the pinned task with exact verdict-marker lines
  # indented two spaces -- dispatch.sh's refresh_staged_task applies the same filter (codex reads this
  # file while reviewing and echoes it into its transcript). Compare like with like: a staged copy that
  # differs from the raw pinned task ONLY by that filter is not an owner amendment.
  STAGE_PINNED_TASK_CHANGED=1
  [ -f "$baseline" ] && cmp -s <(neutralize_markers < "$rec_task") <(neutralize_markers < "$baseline") && STAGE_PINNED_TASK_CHANGED=0
  # both steps guarded by the SAME if -- a bare `rm -f` that fails (e.g. an immutable/locked
  # destination) would otherwise trip `set -e` and crash the whole script instead of the clean,
  # explanatory exit 1 every other refusal in this script gives.
  if ! rm -f "$WT/.ap3-run/TASK.md" || ! neutralize_markers < "$rec_task" > "$WT/.ap3-run/TASK.md"; then
    echo "retry: refusing $label $SLUG -- could not place $rec_task at $WT/.ap3-run/TASK.md" >&2
    exit 1
  fi
}

# W6 (I2/I3): the dispatcher's auto-resolver calls this script with AP3_RESOLVER=1. The resume
# mechanics are identical; what differs is WHO assisted. An owner-assisted run is owner_extended
# (human_interventions 1 at merge); an agent-assisted run is agent_resolved (human_interventions 0
# at merge, but clean_runs still NOT bumped -- a run that needed a decision, from anyone, is not
# evidence of hands-off reliability). Both flags can be true on one run; each is set only by its
# own actor.
mark_assisted() { # <flags>
  if [ "${AP3_RESOLVER:-0}" = 1 ]; then
    python3 "$DIR/rec.py" setjson "$REC" agent_resolved true
    python3 "$DIR/rec.py" set "$REC" agent_resolved_at "$(now)"
    prev="$(python3 "$DIR/rec.py" get "$REC" agent_resolved_flags "")"
    python3 "$DIR/rec.py" set "$REC" agent_resolved_flags "${prev:+$prev,}$1"
  else
    python3 "$DIR/rec.py" setjson "$REC" owner_extended true
    python3 "$DIR/rec.py" set "$REC" owner_extended_at "$(now)"
    python3 "$DIR/rec.py" set "$REC" owner_extended_flags "$1"
  fi
}

if [ "$ANSWER" = 1 ]; then
  # W5.2.3 (K23): MISSING_CONTEXT is the one terminal that means the writer STOPPED ON PURPOSE to
  # ask an owner-level question -- the skill's own contradiction-handling rule tells it to halt
  # rather than guess, and every other recovery mode is wrong for it. --review-only refuses it
  # (not an outage) and would resume review over a diff the writer never finished; --extend-*
  # refuses it (no ceiling was hit) and likewise never relaunches a writer. That left only a full
  # `retry.sh <slug>`, which WIPES the worktree and branch -- so a writer that asked a GOOD
  # question cost the owner every dollar of committed work on the run, and the incentive it
  # created (guess rather than ask) is the exact failure the halt exists to prevent. This mode
  # keeps the run intact and re-dispatches the writer, which reads the owner's answer from the
  # pinned ap3/state/runs/<slug>/task.md the owner edits before calling this.
  terminal="$(python3 "$DIR/rec.py" get "$REC" terminal unknown)"
  # W5.2.5 review (code 2): the answer relaunch itself can halt TASK_REFRESH_FAILED (the staged
  # .ap3-run/TASK.md could not be refreshed from the pinned task) BEFORE any writer ran. dispatch.sh
  # raises that halt before it consumes answer_pending, so the record still carries the owner's
  # intent; that one combination -- an outage terminal AND a still-pending answer -- is answerable
  # again here once the owner has fixed the stage, without the worktree-wiping full retry. Any
  # other terminal is still refused: only a writer's own question is answerable.
  REANSWER=0
  if [ "$terminal" = TASK_REFRESH_FAILED ] && [ "$(python3 "$DIR/rec.py" get "$REC" answer_pending false)" = true ]; then
    REANSWER=1
  elif [ "$terminal" = SCOPE_DRIFT ] && [ "${AP3_RESOLVER:-0}" = 1 ]; then
    # W6 (I2): the dispatcher's scope-widen resolution -- the pinned task's scope was just widened
    # (aplib.py widen-scope, inside the class ceiling) and the writer is relaunched to re-run its
    # own scope-check against it. Only the resolver may take this path: an owner who wants to
    # widen scope edits the queue task and re-queues. No HALT.md is required (the dispatcher's
    # independent re-check halts SCOPE_DRIFT without one).
    REANSWER=1
  elif [ "$terminal" != MISSING_CONTEXT ]; then
    echo "retry: refusing --answer $SLUG -- terminal '$terminal' is not MISSING_CONTEXT (only a writer's own question is answerable; use a full 'retry.sh $SLUG' instead)" >&2
    exit 1
  fi
  [ -d "$WT" ] || { echo "retry: refusing --answer $SLUG -- no worktree at $WT (use a full 'retry.sh $SLUG' instead)" >&2; exit 1; }
  # the question itself. Its absence means this record's MISSING_CONTEXT did not come from a
  # writer that actually asked one -- fail closed rather than relaunch a writer into an unknown
  # state (and never silently answer a question nobody can read). A re-answer after a failed
  # relaunch has already consumed HALT.md (the first --answer removed it), so the check is skipped
  # there -- the pending flag on the record is the proof a question was answered.
  if [ "$REANSWER" = 0 ]; then
    [ -f "$WT/.ap3-run/HALT.md" ] \
      || { echo "retry: refusing --answer $SLUG -- $WT/.ap3-run/HALT.md is missing (nothing to answer)" >&2; exit 1; }
  fi
  # same guard the full-rewrite path uses below: a pushed branch means a PR exists, and what
  # happens to a PR is a human decision, never this script's.
  remote_out="$(git ls-remote --heads origin "ap3/$SLUG" 2>&1)" || {
    echo "retry: refusing --answer $SLUG -- could not query origin for branch ap3/$SLUG ($remote_out)" >&2
    exit 1
  }
  if [ -n "$remote_out" ]; then
    echo "retry: refusing --answer $SLUG -- origin already has branch ap3/$SLUG (a pushed branch means a PR exists -- human decision)" >&2
    exit 1
  fi
  # W5.2.4 review round-1 finding 2 (K24 follow-up): halt() drops the per-run database on EVERY
  # halt, including MISSING_CONTEXT -- --review-only and --extend-* both recreate it before
  # resuming, but --answer never did (a gap that predates K24; --answer never called this at all).
  # A `needs_db` run relaunched without it would get DATABASE_URL_TEST rewritten to a database that
  # no longer exists, and the relaunched writer's own verify would fail against a dead connection --
  # wasting a full writer session on a run doomed from the start.
  recreate_pinned_db --answer
  # K23 follow-up (K24): the two task copies are NOT the same file, and only one of them reaches
  # the writer -- see stage_pinned_task above for the full story. An owner who writes the answer
  # into the pinned copy -- the natural place, and what this script's own success message points
  # at -- reaches the REVIEWER but never the WRITER unless staged here too. Measured on a real
  # run: three owner amendments landed in the pinned copy, the writer saw none of them, and the
  # loop only broke because the reviewer happened to quote one back through REVIEW-FINDINGS.md.
  stage_pinned_task --answer
  # Removed BEFORE the record is published: reconcile_running halts on HALT.md's mere presence, so
  # leaving it would re-halt this run on the very next tick no matter what the owner wrote.
  rm -f "$WT/.ap3-run/HALT.md"
  # NOT resume_review: there is nothing new to review -- the writer never finished this attempt.
  # dispatch.sh's reconcile_running consumes answer_pending by re-dispatching the WRITER instead.
  # The asking attempt's telemetry was already accumulated (reconcile_running sums it strictly
  # before it reads HALT.md), and the relaunched writer produces a NEW result.json, so there is no
  # double-count to suppress here the way --review-only has to.
  python3 "$DIR/rec.py" setjson "$REC" terminal null
  python3 "$DIR/rec.py" setjson "$REC" halt_cause null
  python3 "$DIR/rec.py" setjson "$REC" terminal_kind null
  python3 "$DIR/rec.py" setjson "$REC" pid 0
  python3 "$DIR/rec.py" setjson "$REC" answer_pending true
  # Read by reconcile_ready: a run that only got unstuck because a human answered its question is
  # a human-ASSISTED outcome, not evidence of hands-off reliability -- an unchanged merge must not
  # bump the class's clean_runs. Same flag (and same reason) as the --extend-* modes.
  mark_assisted answer
  # published LAST, for the same reason spelled out on the --review-only path below
  python3 "$DIR/rec.py" set "$REC" status running
  echo "retry: $SLUG resumed after an owner answer (was HALT $terminal) -- next dispatcher tick re-dispatches the writer, which reads your answer from ap3/state/runs/$SLUG/task.md"
  echo "retry: the class is still paused -- run 'ap3/unpause.sh <class>' yourself when ready (not chained here)"
  exit 0
fi

if [ "$REVIEW_ONLY" = 1 ]; then
  # kept in sync BY HAND with dispatch.sh's OUTAGE_TERMINALS -- this script never sources
  # dispatch.sh (it unconditionally runs main() at the bottom, so it cannot be sourced for its
  # functions without also dispatching a tick).
  terminal="$(python3 "$DIR/rec.py" get "$REC" terminal unknown)"
  case " REVIEW_UNAVAILABLE PUSH_FAILED PR_FAILED REMOTE_TIP_MISMATCH EVIDENCE_FAILED FS_ISOLATION_UNSAFE NO_WRITER_SETTINGS DB_ISOLATION_LOST TELEMETRY_FAILED TASK_REFRESH_FAILED " in
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
  recreate_pinned_db --review-only
  # K24: stage the pinned task now too -- if this resumed review still returns FINDINGS,
  # run_review relaunches a fix writer that reads whatever is staged here (see stage_pinned_task
  # above), and that must reflect any amendment the owner made to the pinned copy before retrying.
  stage_pinned_task --review-only
  # W5.2.4 review round-1 finding 4 (K24 follow-up): --review-only exists for pure infra-outage
  # recovery (nothing about the task/code needed a human judgment call), so unlike --answer/
  # --extend-* it does NOT mark owner_extended unconditionally -- a plain outage retry still counts
  # toward clean_runs, correctly. But K24 also lets an owner ride a task amendment along with a
  # --review-only resume, and THAT is exactly as human-assisted as --answer/--extend-*: only mark
  # it when stage_pinned_task actually found the staged content changed.
  if [ "$STAGE_PINNED_TASK_CHANGED" = 1 ]; then
    mark_assisted review-only-amendment
  fi
  # security review round 1 finding 5: status is published LAST, once every other field this
  # resumed run depends on is already in place -- reconcile_running/reconcile_all key off `status`
  # alone to decide whether to touch this record at all, and each `rec.py set` below is its own
  # separate atomic write (not one transaction). Publishing `status: running` FIRST left a window
  # where a concurrent dispatcher tick (launchd fires every 15 minutes, but a manual tick or a
  # slow write could still land in it) could see status=running with resume_review/pid not yet
  # updated -- e.g. re-accumulating this attempt's already-counted telemetry a second time.
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
  python3 "$DIR/rec.py" set "$REC" status running
  echo "retry: $SLUG resumed for review only (was HALT $terminal) -- next dispatcher tick re-enters the review step, no writer relaunch"
  echo "retry: the class is still paused -- run 'ap3/unpause.sh <class>' yourself when ready (not chained here)"
  exit 0
fi

# W5.2 I3 (K16/K19): owner-authorized recovery from a MAX_ROUNDS or BUDGET halt -- both hold real,
# reviewed, committed work (a MAX_ROUNDS halt fires INSIDE run_review, before REVIEW-FINDINGS.md is
# even written; a BUDGET halt can fire either there or in reconcile_running, before the writer's
# just-finished attempt has been checked at all) that no other tool in the kit can take forward.
# Same shape as --review-only (resume review at the same head, no second writer session) but for a
# DIFFERENT terminal set, and it also raises the ceiling that actually blocked -- --review-only
# alone would just re-halt the SAME way immediately. dispatch.sh's run_review prefers a recorded
# max_review_rounds_override over the task's own max_review_rounds; every budget check already
# reads the record's live budget_usd, so raising it here is picked up automatically.
#
# W5.2.1 (K21): widened to also accept a VERIFY_HOST_FAIL halt whose OWN round/budget ceiling
# exhausted (dispatch.sh's finalize_ready, gated on the SAME review_round/max_review_rounds_override
# and budget_usd/spent_usd fields run_review's own MAX_ROUNDS/BUDGET checks use -- raising them here
# is picked up by finalize_ready's checks exactly the same way, automatically). Resuming re-enters
# run_review, so a resumed VERIFY_HOST_FAIL run pays for one redundant re-review of the unchanged,
# already-CLEAN diff before verify_host ever runs again -- the SAME "+2 not +1" consequence already
# documented below for MAX_ROUNDS applies identically here. Deliberate: this script cannot call
# dispatch.sh's launch_writer directly (it is never sourced by dispatch.sh -- see the top-of-file
# comment), and duplicating launch_writer's own env/sandbox/model-escalation logic a second time
# just to skip one redundant review round is not worth the maintenance surface. A VERIFY_HOST_FAIL
# caused by a MUTATED worktree (halt_cause verify_host_mutated) is refused by EITHER flag: no
# fix-round edit to application code could ever address verify_host breaking its own read-only
# contract. A record with no halt_cause at all (an older run, or any future halt() call site that
# forgets to set it) fails closed the same way -- not-recognized means not-extendable.
if [ -n "$EXTEND_ROUNDS" ] || [ -n "$EXTEND_BUDGET" ]; then
  terminal="$(python3 "$DIR/rec.py" get "$REC" terminal unknown)"
  # review round 2 (code) finding 1: the flag that actually raises the ceiling which HALTED must
  # be present -- accepting EITHER flag for EITHER terminal let `--extend-budget` alone resume a
  # MAX_ROUNDS halt (an owner mistake, or a repeated wrong-flag call) for a free extra review
  # without ever raising max_review_rounds, silently spending real reviewer cost on a resume that
  # re-hits the SAME unraised cap every time. The other flag may still be given ADDITIONALLY.
  case "$terminal" in
    MAX_ROUNDS)
      [ -n "$EXTEND_ROUNDS" ] \
        || { echo "retry: refusing $SLUG -- terminal MAX_ROUNDS requires --extend-rounds (use a full 'retry.sh $SLUG' instead)" >&2; exit 1; }
      ;;
    BUDGET)
      [ -n "$EXTEND_BUDGET" ] \
        || { echo "retry: refusing $SLUG -- terminal BUDGET requires --extend-budget (use a full 'retry.sh $SLUG' instead)" >&2; exit 1; }
      ;;
    VERIFY_HOST_FAIL)
      # W5.2.1 (K21): same flag-matching rule as MAX_ROUNDS/BUDGET above, keyed off the
      # machine-readable halt_cause dispatch.sh's finalize_ready records, never off this halt's
      # English message.
      halt_cause="$(python3 "$DIR/rec.py" get "$REC" halt_cause "")"
      case "$halt_cause" in
        verify_host_rounds)
          [ -n "$EXTEND_ROUNDS" ] \
            || { echo "retry: refusing $SLUG -- terminal VERIFY_HOST_FAIL (halt_cause verify_host_rounds) requires --extend-rounds (use a full 'retry.sh $SLUG' instead)" >&2; exit 1; }
          ;;
        verify_host_budget)
          [ -n "$EXTEND_BUDGET" ] \
            || { echo "retry: refusing $SLUG -- terminal VERIFY_HOST_FAIL (halt_cause verify_host_budget) requires --extend-budget (use a full 'retry.sh $SLUG' instead)" >&2; exit 1; }
          ;;
        verify_host_mutated)
          echo "retry: refusing $SLUG -- terminal VERIFY_HOST_FAIL (halt_cause verify_host_mutated) cannot be extended -- verify_host itself broke its own read-only contract, no fix-round edit to application code could ever address that (use a full 'retry.sh $SLUG' instead)" >&2
          exit 1
          ;;
        *)
          echo "retry: refusing $SLUG -- terminal VERIFY_HOST_FAIL has no recognized halt_cause (got '${halt_cause:-<absent>}') -- refusing to extend an unclassified halt (use a full 'retry.sh $SLUG' instead)" >&2
          exit 1
          ;;
      esac
      ;;
    *) echo "retry: refusing --extend-rounds/--extend-budget $SLUG -- terminal '$terminal' is not MAX_ROUNDS, BUDGET or VERIFY_HOST_FAIL (use a full 'retry.sh $SLUG' instead)" >&2; exit 1 ;;
  esac
  [ -d "$WT" ] || { echo "retry: refusing extend $SLUG -- no worktree at $WT" >&2; exit 1; }
  [ -f "$WT/.ap3-run/READY-FOR-REVIEW" ] \
    || { echo "retry: refusing extend $SLUG -- $WT/.ap3-run/READY-FOR-REVIEW is missing (the worktree is not in a reviewable state; use a full 'retry.sh $SLUG' instead)" >&2; exit 1; }
  rec_head="$(python3 "$DIR/rec.py" get "$REC" head_sha "")"
  wt_head="$(git -C "$WT" rev-parse HEAD 2>/dev/null || true)"
  if [ -z "$rec_head" ] || [ "$rec_head" != "$wt_head" ]; then
    echo "retry: refusing extend $SLUG -- the head moved (worktree HEAD $wt_head != recorded head_sha $rec_head)" >&2
    exit 1
  fi

  # Validate + COMPUTE first, write nothing yet -- a failure anywhere below (a bad flag value, or
  # recreate_pinned_db) must leave the record exactly as found, the same discipline every other
  # refusal in this script already follows.
  FLAGS_USED=""
  NEW_MAX_ROUNDS=""
  NEW_BUDGET=""
  if [ -n "$EXTEND_ROUNDS" ]; then
    case "$EXTEND_ROUNDS" in
      ''|*[!0-9]*) echo "retry: refusing --extend-rounds '$EXTEND_ROUNDS' $SLUG -- must be a positive integer" >&2; exit 1 ;;
    esac
    review_round="$(python3 "$DIR/rec.py" get "$REC" review_round 0)"
    min_rounds=$((review_round + 1))
    # review round 1 (code) finding 2: the comparison and the upper bound both run in Python
    # (arbitrary precision) rather than bash's native `[ -lt ]` -- an oversized digit string (more
    # than bash's ~19-digit safe range) makes `[ ]` error "integer expression expected" and
    # evaluate FALSE, both here and at every later `[ "$round" -ge "$maxr" ]` check in
    # dispatch.sh, silently disabling the round ceiling entirely instead of refusing it. Capped at
    # 10000 -- comfortably beyond any real fix-round count, comfortably inside bash's safe range.
    # review round 2 (code) finding 3: NEW_MAX_ROUNDS is the PYTHON-PRINTED canonical int, not the
    # raw user string -- a non-canonical shape like "0004" is valid shell digits (passes the case
    # check above) but invalid JSON (leading zeros), and rec.py's setjson would crash on it AFTER
    # recreate_pinned_db has already dropped/recreated the database.
    if ! NEW_MAX_ROUNDS="$(MIN="$min_rounds" N="$EXTEND_ROUNDS" python3 -c 'import os,sys
n = int(os.environ["N"]); mn = int(os.environ["MIN"])
sys.exit(1) if not (mn <= n <= 10000) else print(n)')"; then
      echo "retry: refusing --extend-rounds $EXTEND_ROUNDS $SLUG -- must be >= the current round + 1 ($min_rounds) and <= 10000" >&2
      exit 1
    fi
    FLAGS_USED="extend-rounds"
  fi
  if [ -n "$EXTEND_BUDGET" ]; then
    if ! ADD="$EXTEND_BUDGET" python3 -c 'import os,sys,math
v = float(os.environ["ADD"])
sys.exit(0 if math.isfinite(v) and v > 0 else 1)' 2>/dev/null; then
      echo "retry: refusing --extend-budget '$EXTEND_BUDGET' $SLUG -- must be a finite positive number" >&2
      exit 1
    fi
    cur_budget="$(python3 "$DIR/rec.py" get "$REC" budget_usd 0)"
    spent_usd="$(python3 "$DIR/rec.py" get "$REC" spent_usd 0)"
    # review round 2 (code) finding 3: the SUM can overflow to `inf` even when both operands are
    # individually finite (a large-but-finite cur_budget plus a large-but-finite delta); `inf` has
    # no JSON literal, and rec.py's setjson would crash on it AFTER recreate_pinned_db has already
    # run. Validate the computed total itself is finite before ever trusting it.
    if ! NEW_BUDGET="$(CUR="$cur_budget" ADD="$EXTEND_BUDGET" python3 -c 'import os,math,sys
v = round(float(os.environ["CUR"])+float(os.environ["ADD"]),4)
sys.exit(1) if not math.isfinite(v) else print(v)')"; then
      echo "retry: refusing --extend-budget $EXTEND_BUDGET $SLUG -- the resulting budget_usd is not finite" >&2
      exit 1
    fi
    # review round 1 (code) finding 3 + round 4 (code) finding 1: a real increase over the OLD
    # budget_usd is necessary but not sufficient on its own (see the remaining-floor check below)
    # -- without this, an already-sufficient budget could accept a delta that rounds away to
    # nothing and silently not do what the owner asked, even though the run happens to proceed.
    if ! NEW="$NEW_BUDGET" CUR="$cur_budget" python3 -c 'import os,sys;sys.exit(0 if float(os.environ["NEW"])>float(os.environ["CUR"]) else 1)'; then
      echo "retry: refusing --extend-budget $EXTEND_BUDGET $SLUG -- rounds to no real increase over the current budget_usd $cur_budget (use a larger delta)" >&2
      exit 1
    fi
    # review round 3 (code) finding 1: a real increase is not enough either -- new_budget could
    # still be <= spent_usd (an immediate BUDGET re-halt, no new review even attempted) or leave a
    # sliver too small to afford the fix round a fresh review just earned. review round 5 (code)
    # finding 1: uses the SAME aplib.py budget_remaining() run_review's own pre-flight check and
    # finalize_ready's verify_host check use -- a hand-rolled copy here could (and did) drift from
    # theirs on the exact floating-point boundary, violating I4's own "gated on the SAME
    # round/budget ceilings" contract.
    if ! REMAINING="$(python3 "$DIR/aplib.py" budget-remaining "$NEW_BUDGET" "$spent_usd")"; then
      echo "retry: refusing --extend-budget $EXTEND_BUDGET $SLUG -- leaves only \$$REMAINING remaining over spent_usd \$$spent_usd (need > \$0.50 to attempt another round)" >&2
      exit 1
    fi
    FLAGS_USED="${FLAGS_USED:+$FLAGS_USED,}extend-budget"
  fi
  recreate_pinned_db extend
  # K24: stage the pinned task now too -- see stage_pinned_task above. If this resumed review
  # still returns FINDINGS, run_review relaunches a fix writer that reads whatever is staged
  # here, and that must reflect any amendment the owner made to the pinned copy before extending.
  stage_pinned_task extend

  # Every check above passed -- now apply. security review round 1 finding 5: `status` is
  # published LAST, once every other field this resumed run depends on is already in place -- see
  # the matching comment on the --review-only path above for why (each rec.py write is its own
  # separate atomic file write, not one transaction; reconcile_running/reconcile_all key off
  # `status` alone to decide whether to touch this record at all).
  [ -n "$NEW_MAX_ROUNDS" ] && python3 "$DIR/rec.py" setjson "$REC" max_review_rounds_override "$NEW_MAX_ROUNDS"
  [ -n "$NEW_BUDGET" ] && python3 "$DIR/rec.py" setjson "$REC" budget_usd "$NEW_BUDGET"
  python3 "$DIR/rec.py" setjson "$REC" terminal null
  # W5.2.1 (K21): clear alongside terminal -- a resumed run that halts again gets a freshly
  # stamped halt_cause from that new halt() call regardless, but nothing should read a
  # VERIFY_HOST_FAIL-era cause while this record no longer carries that terminal.
  python3 "$DIR/rec.py" setjson "$REC" halt_cause null
  python3 "$DIR/rec.py" setjson "$REC" resume_review true
  python3 "$DIR/rec.py" setjson "$REC" pid 0
  # Read by reconcile_ready: a run that only reached READY because the owner raised a ceiling
  # mid-flight is a human-ASSISTED outcome, not evidence of hands-off reliability -- an unchanged
  # merge must not bump the class's clean_runs the way a genuinely unattended run does.
  mark_assisted "$FLAGS_USED"
  python3 "$DIR/rec.py" set "$REC" status running
  WHO=owner; [ "${AP3_RESOLVER:-0}" = 1 ] && WHO=agent
  echo "retry: $SLUG resumed with an $WHO-extended ceiling ($FLAGS_USED, was HALT $terminal) -- next dispatcher tick re-enters review at the same head, no writer relaunch"
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
