#!/usr/bin/env bash
# ap3 dispatcher (DESIGN §7, as corrected by W1-DECISION-codex-sandbox.md). Runs from
# launchd every 15 min. Idempotent, fail-closed. One live run per class by default (D3:
# max_parallel raises that per class, gated on every candidate's scope staying disjoint from
# every other running/ready record's, any class). A tick's log can contain more than one
# STARTED line when capacity allows; it otherwise prints one of: PAUSED BUSY FETCH_FAILED
# NO_WRITER_SETTINGS NOTHING_QUEUED CAP_HIT RECONCILED. (NO_WRITER_SETTINGS is non-terminal, like
# FETCH_FAILED: the per-run writer contract is absent on the base, so the tick starts nothing
# until it is committed + pushed.)
#
# The writer session (claude -p, sandboxed) does coding only and stops at
# .ap3-run/READY-FOR-REVIEW or .ap3-run/HALT.md. The dispatcher (this script, unsandboxed)
# does the scope-check, the Codex review (+ security), and — only on a CLEAN verdict —
# the push + PR + evidence row. On findings it re-dispatches a fix writer up to the round cap.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$DIR/.." && pwd)"
cd "$REPO"
# Neutralize any git metadata a writer could set in its worktree (core.hooksPath/fsmonitor could
# otherwise run a .ap3-run script UNSANDBOXED when the dispatcher runs git). Injected into every
# git the dispatcher spawns.
export GIT_CONFIG_COUNT=2
export GIT_CONFIG_KEY_0=core.hooksPath GIT_CONFIG_VALUE_0=/dev/null
export GIT_CONFIG_KEY_1=core.fsmonitor GIT_CONFIG_VALUE_1=false
# Absolute so they survive the `cd "$wt"` subshells that run the writer/review in a worktree.
STATE="$REPO/ap3/state"; RUNS="$STATE/runs"; WT="$STATE/worktrees"
ROUTINES="$REPO/ap3/routines.json"; TRUST="$STATE/trust.json"

# ap3/env (gitignored secrets like DATABASE_URL_TEST) is sourced ONLY inside the writer subshell
# (launch_writer), never globally — otherwise its values would reach the dispatcher, the
# independent reviewer (a AP3_CODEX_PIN there could substitute a fake CLEAN), git and gh.

now() { date -u +%Y-%m-%dT%H:%M:%SZ; }
today() { date -u +%Y-%m-%d; }
log() { echo "[$(now)] ap3: $*"; }
notify() { bash "$DIR/notify.sh" "$1" >/dev/null 2>&1 || true; }
jget() { python3 "$DIR/rec.py" get "$@"; }
jset() { python3 "$DIR/rec.py" set "$@"; }
jsetj() { python3 "$DIR/rec.py" setjson "$@"; }

# D3: db_per_run reads exactly these two ap3/env values, each in its OWN subshell — never
# sourced into this process's own environment (the same reason ap3/env is otherwise only ever
# sourced inside the writer subshell: leaking it here would reach git/gh/the independent reviewer).
db_env_get() { # <DATABASE_URL_TEST|AP3_DB_ADMIN_URL> -> the value, or empty if file/key absent
  [ -f "$REPO/ap3/env" ] || return 0
  case "$1" in
    DATABASE_URL_TEST) ( set -a; . "$REPO/ap3/env"; set +a; printf '%s' "${DATABASE_URL_TEST:-}" ) ;;
    AP3_DB_ADMIN_URL)  ( set -a; . "$REPO/ap3/env"; set +a; printf '%s' "${AP3_DB_ADMIN_URL:-}" ) ;;
  esac
}
rewrite_db_url() { # <original-url> <new-dbname> -> the URL with its path replaced
  URL="$1" NEWNAME="$2" python3 -c 'import os
from urllib.parse import urlsplit, urlunsplit
p = urlsplit(os.environ["URL"])
print(urlunsplit((p.scheme, p.netloc, "/" + os.environ["NEWNAME"], p.query, p.fragment)))'
}
# W4.1 round-1 review finding 1: shared by run_review's pre-check (before it destroys this run's
# recovery signal, see there) and launch_writer/finalize_ready's own defense-in-depth checks (the
# INITIAL launch from start_next has no run_review pre-check ahead of it). No side effects --
# callers decide how to halt.
db_isolation_ok() { # <slug> -> 0 if this run's db_name (if any) can currently produce a valid
                    # rewritten DATABASE_URL_TEST, 1 otherwise (env drift, or a malformed URL).
                    # Sets DB_ISOLATION_URL to the rewritten value on success so callers never
                    # need to (and never silently could) recompute it differently.
  local rec="$RUNS/$1/record.json" db_name db_orig_url
  DB_ISOLATION_URL=""
  db_name="$(jget "$rec" db_name "")"
  [ -n "$db_name" ] || return 0
  db_orig_url="$(db_env_get DATABASE_URL_TEST)"
  [ -n "$db_orig_url" ] || return 1
  # W4.1 round-4 review finding 3: presence alone is not validity -- a non-empty but malformed
  # DATABASE_URL_TEST (e.g. an unclosed IPv6-bracket netloc) passed this check before, then
  # rewrite_db_url's own urlsplit/urlunsplit threw uncaught, exiting the whole script instead of
  # reaching a clean DB_ISOLATION_LOST halt. Actually attempt the rewrite here and treat any
  # failure (thrown exception, or unexpectedly empty output) the same as a missing URL.
  DB_ISOLATION_URL="$(rewrite_db_url "$db_orig_url" "$db_name" 2>/dev/null)" || { DB_ISOLATION_URL=""; return 1; }
  [ -n "$DB_ISOLATION_URL" ] || return 1
  return 0
}

cleanup_run_db() { # <slug> — idempotent no-op if this run never had a per-run database. Called
                   # from every terminal path (halt, finalize_ready, merge/reject archive) so the
                   # database is dropped on whichever one a given run actually reaches first.
                   # review round-2 finding 3: a failure to actually drop a pinned db_name is
                   # loudly logged + notified (never silently accepted) — callers add `|| true`
                   # since the run itself is already terminal by the time this runs; a human
                   # sees the warning and cleans up the leftover database by hand.
  local rec="$RUNS/$1/record.json" db_name admin_url
  [ -e "$rec" ] || return 0
  db_name="$(jget "$rec" db_name "")"
  [ -n "$db_name" ] || return 0
  admin_url="$(db_env_get AP3_DB_ADMIN_URL)"
  if [ -z "$admin_url" ]; then
    log "WARN $1: db_name \"$db_name\" is pinned but AP3_DB_ADMIN_URL is unset -- database NOT dropped, clean up by hand"
    notify "⚠️ $1: leftover per-run database \"$db_name\" (AP3_DB_ADMIN_URL unset, could not drop)"
    return 1
  fi
  if ! psql "$admin_url" -c "DROP DATABASE IF EXISTS \"$db_name\"" >/dev/null 2>&1; then
    log "WARN $1: DROP DATABASE \"$db_name\" failed -- database NOT confirmed dropped, clean up by hand"
    notify "⚠️ $1: DROP DATABASE \"$db_name\" failed, clean up by hand"
    return 1
  fi
}

DID_RECONCILE=0

pause_class() { # <class> <reason> [--keep-trust] — trust is re-earned by hand, never
                # auto-restored, EXCEPT --keep-trust (K7 outage terminals): nothing could
                # proceed (reviewer/push/PR infra), so the writer's own work may have been
                # fine — clean_runs survives, only last_exception records the outage.
  jsetj "$TRUST" "$1.paused" true
  jset  "$TRUST" "$1.last_exception" "$2"
  [ "${3:-}" = --keep-trust ] || jsetj "$TRUST" "$1.clean_runs" 0
}

# K7: a fixed, explicit terminal-reason set. Nothing outside it is ever inferred — a NEW
# terminal reason defaults to writer-fault (today's behaviour) unless deliberately added here.
# outage = nothing could proceed (reviewer/push/PR/evidence/isolation infra failed); the writer's
# own diff may have been fine, so trust is kept. Everything else (including MISSING_CONTEXT, a
# bare HALT.md with no recognised reason, and REJECTED / "merged with human changes" below) is
# writer-fault: the writer (or a human) produced something the run could not stand behind.
OUTAGE_TERMINALS=" REVIEW_UNAVAILABLE PUSH_FAILED PR_FAILED REMOTE_TIP_MISMATCH EVIDENCE_FAILED FS_ISOLATION_UNSAFE NO_WRITER_SETTINGS DB_ISOLATION_LOST TELEMETRY_FAILED "
terminal_kind() { # <reason> -> writer-fault | outage
  case "$OUTAGE_TERMINALS" in *" $1 "*) echo outage ;; *) echo writer-fault ;; esac
}

# Evidence lives in the local ledger only (ap3/state/evidence.local.jsonl) — never an unreviewed
# commit on the PR branch. Written at READY (so a READY claim always has a durable row) and again
# at merge/reject with the final outcome; report.sh dedups by slug, keeping the last row. Returns
# non-zero if the append fails, so a caller can fail closed.
write_evidence() { # <slug>
  python3 "$DIR/evidence.py" "$RUNS/$1/record.json" "$RUNS/$1/result.json" >> "$STATE/evidence.local.jsonl"
}

# Sum a finished attempt's cost/turns/denials into the record so a multi-round run reports its
# CUMULATIVE spend, not just the last attempt (round-2 finding). W4.1 round-1 review finding 2:
# K11's budget cap depends on spent_usd being TRUSTWORTHY -- the old version coerced a
# missing/non-numeric total_cost_usd to 0 (silently understating spend), accepted negative/
# non-finite values unchanged (a NaN, once summed in, poisons every future budget comparison,
# since NaN compares false against everything), and swallowed every failure (parse error, write
# failure) with `2>/dev/null || true` (record silently never updated, spent_usd stays stale).
# Fails closed instead: a cost that is not a finite, non-negative number is refused outright
# (exit 1, record untouched); a write failure now propagates too (no more blanket `|| true`).
# Callers must not proceed trusting spent_usd if this returns non-zero.
accumulate_telemetry() { # <slug> -> 0 on success; 1 if the cost telemetry was unusable or the
                         # record could not be persisted
  local rec="$RUNS/$1/record.json" res="$RUNS/$1/result.json"
  [ -s "$res" ] || return 0
  REC="$rec" RES="$res" python3 -c '
import json, math, os, sys
def finite_nonneg(x):
    return isinstance(x, (int, float)) and not isinstance(x, bool) and math.isfinite(x) and x >= 0
r = json.load(open(os.environ["REC"]))
s = json.load(open(os.environ["RES"]))
cost = s.get("total_cost_usd")
if not finite_nonneg(cost):
    sys.exit(1)
turns = s.get("num_turns")
turns = turns if isinstance(turns, int) and not isinstance(turns, bool) and turns >= 0 else 0
denials = s.get("permission_denials")
denials = len(denials) if isinstance(denials, list) else 0
# W4.1 round-2 review finding 2: an invalid EXISTING spent_usd must fail closed too, not just a
# bad NEW cost -- coercing a corrupted cumulative value to 0 would silently restore budget this
# run already spent, letting it exceed budget_usd across the full lifecycle.
prior_spent = r.get("spent_usd", 0)
if not finite_nonneg(prior_spent):
    sys.exit(1)
r["spent_usd"] = round(prior_spent + cost, 6)
r["total_turns"] = int(r.get("total_turns") or 0) + turns
r["total_denials"] = int(r.get("total_denials") or 0) + denials
# W4.1 round-3 review finding 3: write atomically (tmp + fsync + os.replace, the same pattern
# rec.py already uses) -- a plain open(path,"w") truncates immediately, so a crash mid-write
# would leave record.json (the ONLY record for this run) partially written and unparseable, and
# even the halt() call below, which also reads/writes this same file, would then fail too.
tmp = os.environ["REC"] + ".tmp"
with open(tmp, "w") as fh:
    json.dump(r, fh, indent=2)
    fh.write("\n")
    fh.flush()
    os.fsync(fh.fileno())
os.replace(tmp, os.environ["REC"])
'
}

halt() { # <slug> <reason> <msg>
  local slug="$1" reason="$2" msg="$3" rec="$RUNS/$1/record.json" kind
  local cls; cls="$(jget "$rec" class unknown)"
  kind="$(terminal_kind "$reason")"
  jset "$rec" status halted; jset "$rec" terminal "$reason"; jset "$rec" finished_at "$(now)"
  jset "$rec" review_verdict "$(jget "$rec" review_verdict unavailable)"
  jset "$rec" terminal_kind "$kind"
  if [ "$kind" = outage ]; then pause_class "$cls" "$reason" --keep-trust; else pause_class "$cls" "$reason"; fi
  cleanup_run_db "$slug" || true
  write_evidence "$slug" || log "WARN $slug: evidence append failed at halt"
  notify "⛔ HALT $slug ($reason): $msg"
  log "RECONCILED $slug HALT $reason — $msg (worktree kept for forensics)"
  DID_RECONCILE=1
}

# review round-6 finding 2: the single place a PR is reused, discovered or created. Called
# directly (never via `$(...)`) because it calls halt() on failure, which sets globals
# (DID_RECONCILE, record state) that a subshell would lose. Sets RESOLVED_PR_URL and returns 0 on
# success; on failure it has already called halt() and returns 1.
# W4.1 round-3 review finding 2: shared verification for EVERY path resolve_pr can adopt a PR
# from (recorded, discovered by branch, or freshly created) -- state must be OPEN, headRefOid
# must match the reviewed sha, baseRefName must be main. Sets PR_STATE/PR_HEAD/PR_BASE so a
# caller can build a detailed halt message on failure. Before this, the freshly-created path
# trusted `gh pr create`'s own report unverified while the other two paths did not -- the exact
# kind of one-path-misses-the-check gap this consolidation (round-6 finding 2) exists to close.
pr_matches() { # <wt> <url> <nowsha> -> 0 if OPEN and head/base match, 1 otherwise
  local wt="$1" url="$2" nowsha="$3"
  # W4.1 round-4 review finding 2: PR_HEAD/PR_BASE must be defined on EVERY return path, not just
  # the one where state happens to be OPEN -- every caller's halt message interpolates all three
  # unconditionally on failure, and under this script's `set -u`, referencing a variable that was
  # never assigned in this process's lifetime (e.g. the very first pr_matches call ever returning
  # early here) aborts the WHOLE dispatcher with an unbound-variable error instead of a clean
  # halt. Initialize all three up front so a short-circuit return still leaves them defined.
  PR_STATE=""; PR_HEAD=""; PR_BASE=""
  PR_STATE="$( cd "$wt" && gh pr view "$url" --json state -q .state 2>/dev/null || true )"
  [ "$PR_STATE" = OPEN ] || return 1
  PR_HEAD="$( cd "$wt" && gh pr view "$url" --json headRefOid -q .headRefOid 2>/dev/null || true )"
  PR_BASE="$( cd "$wt" && gh pr view "$url" --json baseRefName -q .baseRefName 2>/dev/null || true )"
  [ "$PR_HEAD" = "$nowsha" ] && [ "$PR_BASE" = main ]
}

resolve_pr() { # <slug> <wt> <branch> <nowsha>
  local slug="$1" wt="$2" branch="$3" nowsha="$4" rec="$RUNS/$1/record.json"
  local recorded_url
  RESOLVED_PR_URL=""
  recorded_url="$(jget "$rec" pr_url "")"
  if [ -n "$recorded_url" ]; then
    if pr_matches "$wt" "$recorded_url" "$nowsha"; then
      RESOLVED_PR_URL="$recorded_url"; return 0
    fi
    if [ "$PR_STATE" = OPEN ]; then
      halt "$slug" PR_FAILED "recorded PR $recorded_url head/base ($PR_HEAD/$PR_BASE) != pushed tip $nowsha on main"
      return 1
    fi
    # not OPEN (closed/merged/unreadable) -- fall through to create/discover, exactly as before
  fi
  local url
  url="$( cd "$wt" && gh pr create --head "$branch" --base main \
            --title "ap3: $slug" --body "Autonomous ap3 change. Independent review: CLEAN. Evidence in ap3/state." \
            2>/dev/null | tail -1 )" || true
  case "$url" in
    http*)
      if pr_matches "$wt" "$url" "$nowsha"; then
        RESOLVED_PR_URL="$url"; return 0
      fi
      halt "$slug" PR_FAILED "gh pr create returned $url but its state/head/base ($PR_STATE/$PR_HEAD/$PR_BASE) != pushed tip $nowsha on main"
      return 1
      ;;
  esac
  # `gh pr create` fails exactly this way when a PR for this branch already exists but
  # record.pr_url was never persisted -- the documented crash window between create succeeding
  # and the write landing. Discover it by branch, verify head+base before adopting -- a
  # different, unrelated open PR could share a head SHA or branch name while targeting a base
  # other than `main`, so filter AND independently verify baseRefName, never trust either alone.
  local found_url
  found_url="$( cd "$wt" && gh pr list --head "$branch" --base main --state open --json url -q '.[0].url' 2>/dev/null || true )"
  if [ -n "$found_url" ]; then
    if pr_matches "$wt" "$found_url" "$nowsha"; then
      RESOLVED_PR_URL="$found_url"; return 0
    fi
    halt "$slug" PR_FAILED "gh pr create failed and existing PR $found_url head/base ($PR_HEAD/$PR_BASE) != pushed tip $nowsha on main"
    return 1
  fi
  halt "$slug" PR_FAILED "gh pr create returned no URL"
  return 1
}

finalize_ready() { # <slug> — review was CLEAN. Fail closed: READY means an OPEN PR whose tip is
                   # EXACTLY the reviewed SHA, with a durable evidence row, or it HALTs.
  local slug="$1" rec="$RUNS/$1/record.json" wt="$WT/$1"
  local rsha nowsha remote_oid url
  rsha="$(jget "$rec" reviewed_sha "")"
  nowsha="$( git -C "$wt" rev-parse HEAD )"
  if [ -n "$rsha" ] && [ "$rsha" != "$nowsha" ]; then
    halt "$slug" TIP_MOVED "HEAD moved between review and push"; return
  fi
  jset "$rec" review_verdict CLEAN; jset "$rec" head_sha "$nowsha"
  # review round-1 finding 5: clear any terminal_kind left by a PRIOR outage halt on this same
  # run (e.g. a --review-only recovery) -- a run that reaches READY is neither writer-fault nor
  # outage, and a stale "outage" here would misclassify a successful run in evidence/report.
  jsetj "$rec" terminal_kind null
  # D5: verify_host (optional) is a DISPATCHER-side command, run unsandboxed in the worktree, only
  # now that review is CLEAN and strictly before anything is pushed -- so only reviewed code ever
  # executes on the host (the sandboxed writer cannot open raw TCP to Postgres, so a DB-backed
  # check has to happen here instead). With db_per_run (D3) the per-run database is REUSED here,
  # not recreated -- cleanup_run_db below (after push/PR) drops it once this is also done with it.
  local verify_host; verify_host="$(python3 "$DIR/aplib.py" frontmatter "$RUNS/$slug/task.md" | python3 -c 'import json,sys;print(json.load(sys.stdin).get("verify_host",""))')"
  if [ -n "$verify_host" ]; then
    local vh_db_name vh_db_url_override="" vh_rc=0
    vh_db_name="$(jget "$rec" db_name "")"
    if [ -n "$vh_db_name" ]; then
      # review round-6 finding 3: this run was provisioned an ISOLATED database (db_name pinned);
      # if ap3/env can no longer produce a rewritten DATABASE_URL_TEST for it (env drift between
      # start and this later verify_host launch), silently running verify_host WITHOUT the
      # override would point it at whatever's inherited -- a shared or default database, defeating
      # isolation. Halt rather than run an unverified-isolation check.
      if ! db_isolation_ok "$slug"; then
        halt "$slug" DB_ISOLATION_LOST "db_name '$vh_db_name' is pinned but ap3/env cannot produce a rewritten DATABASE_URL_TEST for it -- check DATABASE_URL_TEST in ap3/env before resuming"
        return
      fi
      vh_db_url_override="$DB_ISOLATION_URL"
    fi
    ( cd "$wt"
      if [ -f "$REPO/ap3/env" ]; then set -a; . "$REPO/ap3/env"; set +a; fi
      if [ -n "$vh_db_url_override" ]; then export DATABASE_URL_TEST="$vh_db_url_override"; fi
      bash -c "$verify_host"
    ) > "$RUNS/$slug/verify-host.txt" 2>&1 || vh_rc=$?
    if [ "$vh_rc" -ne 0 ]; then
      jset "$rec" verify_host fail
      halt "$slug" VERIFY_HOST_FAIL "verify_host exited $vh_rc: $verify_host (see ap3/state/runs/$slug/verify-host.txt)"
      return
    fi
    # review round-3 finding 1: push below always pushes nowsha regardless of what verify_host
    # did to the worktree -- so a PASS here is only meaningful if verify_host left the reviewed
    # tree EXACTLY as it was. A command that generates, edits, or commits files (even one that
    # ultimately exits 0) would otherwise validate code that never actually reaches the PR (a new
    # commit on top of nowsha) or was never really committed at all (a stray working-tree write).
    # Re-verify HEAD is still exactly nowsha AND the tree is porcelain-clean before trusting PASS.
    local vh_head vh_dirty
    vh_head="$(git -C "$wt" rev-parse HEAD)"
    vh_dirty="$(git -C "$wt" status --porcelain -uall)"
    if [ "$vh_head" != "$nowsha" ] || [ -n "$vh_dirty" ]; then
      jset "$rec" verify_host fail
      halt "$slug" VERIFY_HOST_FAIL "verify_host mutated the worktree (HEAD $vh_head, reviewed $nowsha, dirty=$([ -n "$vh_dirty" ] && echo yes || echo no)) -- refusing to push a tree verify_host did not actually validate"
      return
    fi
    jset "$rec" verify_host pass
  fi
  # push the reviewed tip by SHA to an explicit ref (not a mutable named branch), then verify the
  # remote OID equals what we reviewed — the PR can only ever carry the reviewed commit.
  if ! ( cd "$wt" && git push -q origin "$nowsha:refs/heads/ap3/$slug" 2>/dev/null ); then
    halt "$slug" PUSH_FAILED "git push of ap3/$slug failed"; return
  fi
  remote_oid="$( cd "$wt" && { git ls-remote origin "refs/heads/ap3/$slug" 2>/dev/null || true; } | awk '{print $1}' )"
  if [ "$remote_oid" != "$nowsha" ]; then   # empty on ls-remote failure -> mismatch -> terminal HALT (not a set -e crash)
    halt "$slug" REMOTE_TIP_MISMATCH "pushed tip '$remote_oid' != reviewed tip $nowsha"; return
  fi
  # review round-6 finding 2: resolve_pr is the ONE place a PR is reused/discovered/created --
  # the recorded-url reuse path (round 1) used to only check OPEN state, never head/base, while
  # the discover-by-branch fallback (round 3, hardened round 5) verified both. A retargeted
  # recorded PR could be marked READY. Both paths now share the same verification.
  if ! resolve_pr "$slug" "$wt" "ap3/$slug" "$nowsha"; then return; fi
  url="$RESOLVED_PR_URL"
  jset "$rec" pr_url "$url"; jset "$rec" terminal READY
  # a READY claim must have a durable evidence row (written before we announce it)
  if ! write_evidence "$slug"; then halt "$slug" EVIDENCE_FAILED "could not write the evidence row"; return; fi
  jset "$rec" status ready
  cleanup_run_db "$slug" || true   # D3/D5: the writer's own verify and any verify_host have both already run; the per-run db is not needed past this point
  local cost; cost="$(jget "$rec" spent_usd "$(jget "$RUNS/$slug/result.json" total_cost_usd unavailable)")"
  notify "✅ READY $slug $url \$$cost"
  log "RECONCILED $slug READY $url cost=$cost"
  DID_RECONCILE=1
}

run_review() { # <slug> — CLEAN -> finalize_ready ; FINDINGS -> fix loop or MAX_ROUNDS
  local slug="$1" rec="$RUNS/$1/record.json" wt="$WT/$1"
  local base task cls maxr
  base="$(jget "$rec" base_sha)"; cls="$(jget "$rec" class)"
  task="$RUNS/$slug/task.md"   # immutable base copy — the writer cannot widen its own review scope
  maxr="$(python3 "$DIR/aplib.py" frontmatter "$task" | python3 -c 'import json,sys;print(json.load(sys.stdin).get("max_review_rounds",3))')"
  # count this review attempt (a first-try CLEAN still records review_rounds=1)
  local round; round=$(( $(jget "$rec" review_round 0) + 1 )); jsetj "$rec" review_round "$round"
  jset "$rec" reviewed_sha "$( git -C "$wt" rev-parse HEAD )"   # bind the PR tip to this SHA later

  local crc=0
  ( cd "$wt" && AP3_TASK="$task" bash "$DIR/review.sh" code --base "$base" ) > "$RUNS/$slug/review-code.txt" 2>&1 || crc=$?
  # Security policy comes from the pinned record (captured from origin at start), not the live
  # tree. always -> always run; none -> skip; anything else (auto or a typo) -> fail closed:
  # run whenever the heuristic fires (and the heuristic itself errs toward yes).
  local sec=not_required src=0 policy run_sec=no
  policy="$(jget "$rec" security_policy auto)"
  case "$policy" in
    none) run_sec=no ;;
    always) run_sec=yes ;;
    *) [ "$( cd "$wt" && bash "$DIR/review.sh" needs-security --base "$base" )" = yes ] && run_sec=yes ;;
  esac
  if [ "$run_sec" = yes ]; then
    ( cd "$wt" && AP3_TASK="$task" bash "$DIR/review.sh" security --base "$base" ) > "$RUNS/$slug/review-security.txt" 2>&1 || src=$?
    case "$src" in 0) sec=CLEAN;; 1) sec=FINDINGS;; *) sec=UNAVAILABLE;; esac
  fi
  jset "$rec" security_review "$sec"

  # review round-4 finding 2: a real FINDINGS verdict from EITHER completed review must win over
  # an UNAVAILABLE result from the OTHER -- otherwise an unavailable security round could mask
  # confirmed code-review defects (or vice versa) as a trust-preserving outage (REVIEW_UNAVAILABLE
  # is in K7's outage set) instead of resetting trust the way a genuine finding must. Only when
  # NEITHER completed review found anything does "was either one unavailable" get to decide.
  local any_findings=0
  [ "$crc" -eq 1 ] && any_findings=1
  [ "$sec" = FINDINGS ] && any_findings=1
  if [ "$any_findings" -eq 0 ] && { [ "$crc" -eq 3 ] || [ "$sec" = UNAVAILABLE ]; }; then
    halt "$slug" REVIEW_UNAVAILABLE "codex returned no parseable verdict"; return
  fi
  if [ "$crc" -eq 0 ] && { [ "$sec" = not_required ] || [ "$sec" = CLEAN ]; }; then
    finalize_ready "$slug"; return
  fi
  # findings -> halt AT the round cap (>=), else re-dispatch a fix writer
  jset "$rec" review_verdict FINDINGS
  if [ "$round" -ge "$maxr" ]; then
    halt "$slug" MAX_ROUNDS "review findings at round cap $maxr"; return
  fi
  # K11: total spend across the writer + every fix round must never SILENTLY exceed budget_usd
  # without being caught and halted. This is necessarily POST-HOC breach detection, not a hard
  # real-time cap -- --max-budget-usd is enforced by claude ITSELF during the writer's own
  # session, not by this dispatcher, and that enforcement is not perfectly precise (measured: a
  # $0.30-capped probe call reported $0.735, see probes/RESULTS.md; W4.1 round-4 review finding
  # 1). ap3 has no way to interrupt a writer mid-session, only to react once it reports back. What
  # IS guaranteed: (a) each launch is capped at the REMAINING amount, never the full budget again
  # (below), bounding how much a single overshoot can compound across rounds; (b) the
  # post-accumulation check in reconcile_running halts BUDGET the moment any single attempt's
  # reported cost pushes cumulative spend over budget_usd, before review or a further round can
  # ever run against it; (c) this pre-flight refusal stops even ATTEMPTING another round once
  # remaining is at or below $0.50 (not strictly below -- exactly $0.50 is too little to be worth
  # a round too). spent_usd is accumulated after every completed attempt (accumulate_telemetry).
  if ! BT="$(jget "$rec" budget_usd 0)" SP="$(jget "$rec" spent_usd 0)" \
       python3 -c 'import os,sys;sys.exit(0 if (float(os.environ["BT"])-float(os.environ["SP"]))>0.5 else 1)'; then
    halt "$slug" BUDGET "insufficient remaining budget for another fix round"; return
  fi
  # W4.1 round-1 review finding 1: check the DB-isolation precondition BEFORE destroying this
  # run's recovery signal (READY-FOR-REVIEW/result.json) below. launch_writer enforces the SAME
  # check, but by the time IT halts the signal is already gone, and retry.sh --review-only's
  # recovery (which requires READY-FOR-REVIEW to still exist) can then never succeed -- recovery
  # always refused, forcing a full rewrite every time. Halting HERE, before any deletion, keeps
  # the run recoverable exactly like every other outage halt: fix ap3/env, retry.sh
  # --review-only re-enters review (a redundant re-review of the SAME unchanged diff, since
  # nothing about the code itself changed), which reaches this exact check again and this time
  # proceeds to actually relaunch the fix writer.
  if ! db_isolation_ok "$slug"; then
    halt "$slug" DB_ISOLATION_LOST "db_name is pinned but ap3/env cannot produce a rewritten DATABASE_URL_TEST for it -- check DATABASE_URL_TEST in ap3/env before resuming"
    return
  fi
  { echo "# Review findings (round $round) — fix these, re-verify, rewrite .ap3-run/READY-FOR-REVIEW"; echo;
    cat "$RUNS/$slug/review-code.txt"; [ "$sec" = FINDINGS ] && { echo; echo "## Security"; cat "$RUNS/$slug/review-security.txt"; }; } \
    > "$wt/.ap3-run/REVIEW-FINDINGS.md"
  rm -f "$RUNS/$slug/result.json" "$wt/.ap3-run/READY-FOR-REVIEW"
  if launch_writer "$slug"; then          # a refused writer already HALTed + logged inside launch_writer
    log "RECONCILED $slug findings round $round — re-dispatched fix writer"
    DID_RECONCILE=1
  fi
}

# `--setting-sources ''` excludes the user/project/local PERMISSIONS on 2.1.177 (proved by
# probe-settings-flag.sh), but excluding an inherited scope's ENTIRE sandbox.filesystem block needs
# claude >= 2.1.246. Below that, an inherited allowRead/allowWrite/disabled could widen the writer
# beyond the contract (denyRead alone is narrowing, but distinguishing widening from narrowing per
# sub-key is an open-ended chase — so we fail closed on ANY inherited sandbox.filesystem block, the
# clean design cut). Only when the risk is actually present (a scope defines sandbox.filesystem) does
# the writer-version probe run, so fake writer bins in the tests are never invoked with --version.
fs_scopes_have_filesystem() { # <worktree> -> 0 if any loadable scope defines a sandbox.filesystem block
  SC1="$HOME/.claude/settings.json" SC2="$1/.claude/settings.json" SC3="$1/.claude/settings.local.json" \
  python3 -c 'import json,os,sys
def fs(p):
    try: d=json.load(open(p))
    except Exception: return False
    return bool((d.get("sandbox") or {}).get("filesystem"))
sys.exit(0 if any(fs(os.environ[k]) for k in ("SC1","SC2","SC3")) else 1)'
}
writer_supports_fs_exclusion() { # <cbin> -> 0 if claude >= 2.1.246 (sandbox.filesystem source-exclusion)
  local v; v="$("$1" --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)"
  V="$v" python3 -c 'import os,sys
try: t=tuple(int(x) for x in (((os.environ.get("V","") or "0")+".0.0").split("."))[:3])
except ValueError: t=(0,0,0)
sys.exit(0 if t>=(2,1,246) else 1)'
}

launch_writer() { # <slug> — start (or restart) the sandboxed coding session, cwd = its worktree.
                  # Returns non-zero (after HALT) if it refused to start, so callers skip STARTED.
  local slug="$1" rec="$RUNS/$1/record.json" wt="$WT/$1"
  local base budget model prompt
  local cbin="${AP3_CLAUDE_BIN:-claude}"    # resolve the writer binary BEFORE sourcing ap3/env
  # The writer's sandbox+permission contract is PER-RUN via `claude --settings`, not the target's
  # repo-wide `.claude/settings.json` (which would also govern the owner's own interactive sessions
  # — the W1.1 finding). The file is materialized from the PINNED base into run state at START
  # (start_next), exactly like task.md, so neither the sandboxed writer (in its worktree) nor a live
  # working-tree edit on the main checkout can change the contract between fix rounds. Missing file =>
  # HALT: never start an unsandboxed writer — under `dontAsk` with no sandbox the generic bash a slice
  # needs (mkdir/grep/…) is denied and every run would fail confusingly.
  local settings="$RUNS/$slug/writer-settings.json"
  if [ ! -s "$settings" ]; then
    halt "$slug" NO_WRITER_SETTINGS "run-state writer-settings.json missing/empty — refusing an unsandboxed writer"
    return 1
  fi
  # Fail closed on the filesystem-isolation residual (W1-KNOWN-GAPS §6): only when a scope actually
  # defines sandbox.filesystem AND the writer's claude can't exclude it (< 2.1.246). This is a
  # BEST-EFFORT tripwire for the common misconfig — it reads $HOME/.claude + the worktree scopes with
  # the pre-`ap3/env` PATH, so an owner ap3/env that redirects HOME/CLAUDE_CONFIG_DIR/PATH is out of
  # its reach. Chasing those bypasses is a tool-defect rabbit hole; the airtight fix is claude
  # >= 2.1.246 (then `--setting-sources ''` excludes these scopes natively and this guard is moot).
  if fs_scopes_have_filesystem "$wt" && ! writer_supports_fs_exclusion "$cbin"; then
    halt "$slug" FS_ISOLATION_UNSAFE "a settings scope defines sandbox.filesystem and the writer's claude < 2.1.246 cannot exclude it via --setting-sources (W1-KNOWN-GAPS §6): upgrade claude to >=2.1.246 or remove that scope's sandbox.filesystem"
    return 1
  fi
  base="$(jget "$rec" base_sha)"
  model="$(jget "$rec" writer_model claude-sonnet-5)"   # pinned at start, not the live tree
  # D2: escalate to the class's fix_model (also pinned at start) from the SECOND fix round on.
  # run_review already incremented review_round to the round that just produced findings before
  # re-entering here, so review_round>=2 means this writer is fixing round-2-or-later findings —
  # the round-1 fix (review_round==1) still gets the normal pinned model.
  local fix_model round_now
  fix_model="$(jget "$rec" fix_model "")"
  round_now="$(jget "$rec" review_round 0)"
  if [ -n "$fix_model" ] && [ "$round_now" -ge 2 ]; then
    model="$fix_model"
    jset "$rec" escalated_model "$model"
  fi
  # remaining budget = declared - already spent across fix rounds (never re-grants the full cap)
  budget="$(BT="$(jget "$rec" budget_usd 0)" SP="$(jget "$rec" spent_usd 0)" \
    python3 -c 'import os;print(round(max(0.0,float(os.environ["BT"])-float(os.environ["SP"])),4))')"
  prompt="$(cat "$DIR/prompts/run.md")"
  jset "$rec" status running
  mkdir -p "$wt/.ap3-run"
  # D3: db_per_run -- the database itself was created once at start_next time; every launch of
  # this run (initial or a later fix round) gets DATABASE_URL_TEST rewritten to point at it, so
  # a concurrent sibling run's verify never touches the same database.
  local db_name db_url_override=""
  db_name="$(jget "$rec" db_name "")"
  if [ -n "$db_name" ]; then
    # review round-6 finding 3: this run was provisioned an ISOLATED database at start; if ap3/env
    # can no longer produce a rewritten DATABASE_URL_TEST for it (env drift between the initial
    # launch and a later fix-round relaunch), silently launching the writer WITHOUT the override
    # would let it run its verify against whatever's inherited -- a shared or default database,
    # defeating isolation. Halt rather than launch an unverified-isolation writer. (run_review's
    # own pre-check, W4.1 round 1, covers the fix-round-redispatch call path before this one is
    # even reached; this stays as defense-in-depth for the INITIAL launch from start_next, which
    # has no such pre-check ahead of it.)
    if ! db_isolation_ok "$slug"; then
      halt "$slug" DB_ISOLATION_LOST "db_name '$db_name' is pinned but ap3/env cannot produce a rewritten DATABASE_URL_TEST for it -- check DATABASE_URL_TEST in ap3/env before resuming"
      return 1
    fi
    db_url_override="$DB_ISOLATION_URL"
  fi
  # `--settings` LOADS ON TOP of the user/project/local scopes and array keys (permissions.allow/deny,
  # allowedDomains, filesystem.allowRead) UNION across scopes — so the target repo's own
  # `.claude/settings.json` (or ~/.claude, or a .local) could weaken the writer's sandbox/denies.
  # `--setting-sources ''` loads NONE of those scopes, so the contract stands alone (proved by
  # probe-settings-flag.sh: a hostile project `deny: Bash(git *)` is ignored with it, applied without).
  # ap3/env is sourced INSIDE this subshell only, so secrets never reach the dispatcher/reviewer.
  ( cd "$wt"
    if [ -f "$REPO/ap3/env" ]; then set -a; . "$REPO/ap3/env"; set +a; fi
    if [ -n "$db_url_override" ]; then export DATABASE_URL_TEST="$db_url_override"; fi
    nohup env AP3_SLUG="$slug" AP3_TASK="$wt/ap3/queue/$slug.md" AP3_BASE_SHA="$base" \
      AP3_STATE="$RUNS/$slug" \
      "$cbin" -p "$prompt" \
        --settings "$settings" --setting-sources '' \
        --permission-mode dontAsk --max-budget-usd "$budget" --model "$model" --output-format json \
      > "$RUNS/$slug/result.json" 2> "$RUNS/$slug/stderr.log" &
    echo $! > "$RUNS/$slug/pid" )
  jsetj "$rec" pid "$(cat "$RUNS/$slug/pid" 2>/dev/null || echo 0)"
}

reconcile_running() {
  local slug="$1" rec="$RUNS/$1/record.json" wt="$WT/$1"
  local result="$RUNS/$slug/result.json" run="$wt/.ap3-run"
  local pid; pid="$(jget "$rec" pid 0)"
  local alive=0; { [ "$pid" != 0 ] && kill -0 "$pid" 2>/dev/null; } && alive=1
  # a non-empty result.json that is not yet valid JSON means the writer is mid-write -> if its
  # process is alive it is still running (BUSY); if dead, the result is truncated/corrupt.
  if [ ! -s "$result" ] || ! python3 -c 'import json,sys;json.load(open(sys.argv[1]))' "$result" 2>/dev/null; then
    [ "$alive" = 1 ] && { log "BUSY $slug (writer live pid $pid)"; return; }
    halt "$slug" WRITER_ERROR "writer died with no valid result.json"; return
  fi
  # even with a valid result, if the process is still alive the run is not finished
  [ "$alive" = 1 ] && { log "BUSY $slug (writer live pid $pid)"; return; }
  # W4.1 round-2 review finding 1 (self-caught while testing): head_sha/finished_at must be
  # recorded BEFORE any halt below, not after -- retry.sh --review-only verifies the worktree
  # hasn't moved by comparing against recorded head_sha, and a halt here (e.g. TELEMETRY_FAILED)
  # would otherwise leave it empty, making that check always fail and recovery always refuse.
  jset "$rec" head_sha "$( git -C "$wt" rev-parse HEAD )"
  jset "$rec" finished_at "$(now)"
  # K8: ap3/retry.sh --review-only re-enters this SAME result.json (no new writer attempt) to
  # resume only the review step of an outage halt. That attempt's cost was already accumulated
  # the first time this result.json was processed -- summing it again would double-count
  # spent_usd/total_turns/total_denials. Consume the flag once, then accumulate normally again.
  if [ "$(jget "$rec" resume_review false)" = true ]; then
    jsetj "$rec" resume_review false
  else
    # W4.1 round-1 review finding 2: accumulate_telemetry now fails closed (bad/unusable cost, or
    # a failed persist) instead of silently swallowing it -- a budget decision must never rest on
    # spent_usd that failed to update. Treated as outage (the writer's own diff may be fine; it's
    # the metering that's unreliable), not writer-fault.
    accumulate_telemetry "$slug" || { halt "$slug" TELEMETRY_FAILED "writer result.json cost telemetry is missing/invalid or could not be persisted -- refusing to trust spent_usd for a budget decision"; return; }
  fi
  # W4.1 round-3 review finding 1: --max-budget-usd is the WRITER's own soft ceiling, enforced by
  # claude itself -- not a guarantee the actually-reported cost never exceeds it (measured: a
  # $0.30-capped probe call reported $0.735, see probes/RESULTS.md). Without this check, a writer
  # that overshoots its cap would still sail through review and, if CLEAN, reach READY -- silently
  # violating K11's own invariant that total spend never exceeds budget_usd. Checked here,
  # immediately after telemetry is confirmed trustworthy, so it fires regardless of what the
  # review verdict would otherwise have been.
  local bt sp
  bt="$(jget "$rec" budget_usd 0)"; sp="$(jget "$rec" spent_usd 0)"
  if ! BT="$bt" SP="$sp" python3 -c 'import os,sys;sys.exit(0 if float(os.environ["SP"])<=float(os.environ["BT"]) else 1)'; then
    halt "$slug" BUDGET "cumulative spend \$$sp exceeds budget_usd \$$bt after this attempt's reported cost"; return
  fi
  if [ -f "$run/HALT.md" ]; then
    local reason; reason="$(grep -oaE 'SCOPE_DRIFT|VERIFY_FAIL|MISSING_CONTEXT|MAX_ROUNDS|BUDGET' "$run/HALT.md" | head -1 || true)"
    halt "$slug" "${reason:-HALT}" "writer wrote HALT.md"; return
  fi
  # require an EXPLICIT is_error:false (a missing field must not be read as success)
  if [ "$(jget "$result" is_error MISSING)" != false ]; then
    if [ "$(jget "$result" subtype "")" = error_max_budget_usd ]; then halt "$slug" BUDGET "hit --max-budget-usd"
    else halt "$slug" WRITER_ERROR "writer result.json is_error or missing is_error:false"; fi
    return
  fi
  if [ ! -f "$run/READY-FOR-REVIEW" ]; then
    halt "$slug" NO_SIGNAL "writer stopped without READY-FOR-REVIEW or HALT.md"; return
  fi
  # require a recorded green verify — the writer proves its acceptance test passed
  if [ "$(head -1 "$run/verify" 2>/dev/null || true)" != pass ]; then
    halt "$slug" VERIFY_FAIL "writer did not record .ap3-run/verify=pass"; return
  fi
  jset "$rec" verify pass
  # the worktree must be clean: uncommitted/untracked changes are NOT in the PR, so verify could
  # have passed against code the reviewer/human never sees. `-uall` forces untracked visibility so a
  # hostile status.showUntrackedFiles=no cannot hide them (.ap3-run is gitignored, so excluded).
  if [ -n "$( git -C "$wt" status --porcelain -uall )" ]; then
    halt "$slug" DIRTY_WORKTREE "uncommitted or untracked changes outside the committed diff"; return
  fi
  local base task; base="$(jget "$rec" base_sha)"
  task="$RUNS/$slug/task.md"   # the IMMUTABLE base copy — never the writer-editable worktree file
  # the pinned base must remain an ancestor of HEAD — a rebase/history-rewrite could otherwise hide
  # files from the scope gate that still appear in the reviewer's base...HEAD diff
  if ! git -C "$wt" merge-base --is-ancestor "$base" HEAD 2>/dev/null; then
    halt "$slug" HISTORY_REWRITE "pinned base is no longer an ancestor of HEAD"; return
  fi
  # a CLEAN review of an empty diff is not evidence — require a real committed change (three-dot,
  # the same diff definition the reviewer and scope-check use)
  if [ -z "$( git -C "$wt" diff --name-only "$base"...HEAD )" ]; then
    halt "$slug" EMPTY_DIFF "no committed change between base and HEAD to review"; return
  fi
  # independent RED signal: the committed diff must touch a test file. The dispatcher trusts the
  # writer's verify=pass but requires evidence a test was authored/changed (the writer runs verify
  # in-session; dispatcher-side RE-EXECUTION is the top W2 hardening — see W1-KNOWN-GAPS.md).
  # Capture the name list first — piping git into `grep -q` under pipefail fails open on SIGPIPE.
  local diff_names; diff_names="$( git -C "$wt" diff --name-only "$base"...HEAD )"
  if ! grep -qE '(^|/)(test|tests|spec|__tests__)/|(\.|_)(test|spec)\.[a-z]+$|(^|/)test_[^/]+\.py$' <<< "$diff_names"; then
    halt "$slug" VERIFY_FAIL "committed diff contains no test file (no RED test authored)"; return
  fi
  if ! ( cd "$wt" && AP3_TASK="$task" bash "$DIR/scope-check.sh" --base "$base" >/dev/null 2>&1 ); then
    halt "$slug" SCOPE_DRIFT "committed diff is not a subset of the task scope"; return
  fi
  run_review "$slug"
}

reconcile_ready() { # <slug> — a PR is open; watch for merge / close
  local slug="$1" rec="$RUNS/$1/record.json" wt="$WT/$1"
  local cls url state merged_head head
  cls="$(jget "$rec" class)"; url="$(jget "$rec" pr_url "")"
  head="$(jget "$rec" head_sha "")"   # finalize_ready commits nothing after review -> PR tip == head_sha
  [ -n "$url" ] || return
  state="$( cd "$wt" && gh pr view "$url" --json state -q .state 2>/dev/null || echo UNKNOWN )"
  case "$state" in
    MERGED)
      merged_head="$( cd "$wt" && gh pr view "$url" --json headRefOid -q .headRefOid 2>/dev/null || echo "" )"
      if [ -n "$head" ] && [ "$merged_head" = "$head" ]; then
        jsetj "$rec" merged_unchanged true; jsetj "$rec" human_interventions 0
        jsetj "$TRUST" "$cls.clean_runs" "$(( $(jget "$TRUST" "$cls.clean_runs" 0) + 1 ))"
        notify "🎉 merged unchanged $slug — clean_runs=$(jget "$TRUST" "$cls.clean_runs" 0)"
      else
        jsetj "$rec" merged_unchanged false
        jsetj "$rec" human_interventions "$(( $(jget "$rec" human_interventions 0) + 1 ))"
        pause_class "$cls" "merged with human changes"   # a human fix-before-merge re-earns trust
        # review round-1 finding 5: the K7 contract explicitly classifies this as writer-fault
        # (a human had to fix-before-merge); record it, the same as every halt() path does.
        jset "$rec" terminal_kind writer-fault
        notify "merged with human changes $slug — class $cls paused, clean_runs reset"
      fi
      jset "$rec" status archived
      cleanup_run_db "$slug" || true    # D3: idempotent -- finalize_ready already dropped it on the READY path
      write_evidence "$slug"    # complete row now that merge outcome is known
      git worktree remove --force "$wt" 2>/dev/null || true
      log "RECONCILED $slug merged (unchanged=$(jget "$rec" merged_unchanged))"; DID_RECONCILE=1 ;;
    CLOSED)
      jset "$rec" status halted; jset "$rec" terminal REJECTED; jset "$rec" terminal_kind "$(terminal_kind REJECTED)"
      pause_class "$cls" REJECTED
      cleanup_run_db "$slug" || true
      write_evidence "$slug"
      git worktree remove --force "$wt" 2>/dev/null || true
      notify "⛔ PR closed unmerged $slug — class $cls paused"
      log "RECONCILED $slug REJECTED"; DID_RECONCILE=1 ;;
    *) : ;;  # OPEN / UNKNOWN — nothing to do this tick
  esac
}

reconcile_all() {
  [ -d "$RUNS" ] || return 0
  local rec slug st
  for rec in "$RUNS"/*/record.json; do
    [ -e "$rec" ] || continue
    slug="$(jget "$rec" slug)"; st="$(jget "$rec" status)"
    case "$st" in
      running) reconcile_running "$slug" ;;
      ready)   reconcile_ready "$slug" ;;
      *) : ;;  # halted / archived are terminal
    esac
  done
}

# D3: was a boolean single-writer gate; now a count so start_next can allow more than one
# concurrent run per class (max_parallel). A class that never sets max_parallel still gets
# exactly today's behaviour, because the default cap compared against this count is 1.
in_flight() { # [<class>] -> count of running/ready records, optionally filtered to one class
  local cls="${1:-}" rec st n=0
  [ -d "$RUNS" ] || { echo 0; return; }
  for rec in "$RUNS"/*/record.json; do
    [ -e "$rec" ] || continue
    if [ -n "$cls" ]; then [ "$(jget "$rec" class "")" = "$cls" ] || continue; fi
    st="$(jget "$rec" status)"
    { [ "$st" = running ] || [ "$st" = ready ]; } && n=$((n+1))
  done
  echo "$n"
}

# review round-4 finding 1: the tick's FINAL printed line must accurately reflect "a writer is
# live" whenever true, however that writer came to be running this tick -- reconcile_running
# finding one already alive, start_next launching a fresh candidate, or run_review re-dispatching
# a fix writer after findings. Round 3 threaded a flag (ANY_BUSY) through reconcile_running's
# alive-check only, and round 4 immediately found the gap: run_review's re-dispatch (a SEPARATE
# launch_writer call site) never set it. A flag is exactly the kind of thing a call site -- this
# one, or a future one -- forgets to set. Query the ACTUAL state instead, once, at the very end of
# the tick: any run record claiming status "running" whose recorded pid is still a live process.
any_writer_running() { # -> 0 (true) if some run record's own writer process is still alive
  local rec pid
  [ -d "$RUNS" ] || return 1
  for rec in "$RUNS"/*/record.json; do
    [ -e "$rec" ] || continue
    [ "$(jget "$rec" status)" = running ] || continue
    pid="$(jget "$rec" pid 0)"
    [ "$pid" != 0 ] && kill -0 "$pid" 2>/dev/null && return 0
  done
  return 1
}

# review round-1 finding 2: a class that never sets max_parallel (default 1) must be blocked by
# ANY other running/ready record, of ANY OTHER class too -- not just capped within itself. Two
# classes that BOTH stay on the default are still mutually exclusive, exactly as pre-D3. True iff
# some running/ready record belongs to a class whose OWN max_parallel is <=1 (unset counts as 1).
default_class_active() { # <rjson> -> 0 (true) / 1 (false)
  local rjson="$1" rec st rcls rmp
  [ -d "$RUNS" ] || return 1
  for rec in "$RUNS"/*/record.json; do
    [ -e "$rec" ] || continue
    st="$(jget "$rec" status)"
    { [ "$st" = running ] || [ "$st" = ready ]; } || continue
    rcls="$(jget "$rec" class "")"
    rmp="$(jget "$rjson" "classes.$rcls.max_parallel" 1)"
    # review round-2 finding 2: a malformed max_parallel (non-integer, e.g. a stray string) must
    # not silently pass this numeric comparison as false (bash `[ -le ]` errors -> falsy -> read
    # as "not <=1" -> wrongly treated as an opted-in-to-parallel class) -- coerce to the safe
    # default (1, fully exclusive) whenever it is not a plain positive integer.
    case "$rmp" in ''|*[!0-9]*) rmp=1 ;; esac
    [ "$rmp" -le 1 ] && return 0
  done
  return 1
}

# D3: candidate's scope vs every running/ready record's PINNED scope, any class -- concurrency
# is capped per class (in_flight), but two DIFFERENT classes must still never touch overlapping
# files from stale bases. Prints the first colliding slug found, or nothing if none collide.
scope_busy_with() { # <candidate-scope-json> -> colliding slug, or empty
  local cjson="$1" rec st oslug oscope
  [ -d "$RUNS" ] || return 0
  for rec in "$RUNS"/*/record.json; do
    [ -e "$rec" ] || continue
    st="$(jget "$rec" status)"
    { [ "$st" = running ] || [ "$st" = ready ]; } || continue
    # review round-2 finding 2: a record predating D3 (or otherwise missing `scope`) must be
    # treated as touching EVERYTHING (busy), never as touching nothing (wrongly disjoint) --
    # "**" overlaps any non-empty candidate scope (lint guarantees candidates are non-empty).
    oscope="$(jget "$rec" scope '["**"]')"
    if [ "$(python3 "$DIR/aplib.py" scopes-overlap "$cjson" "$oscope")" = OVERLAP ]; then
      oslug="$(jget "$rec" slug "")"; echo "$oslug"; return 0
    fi
  done
}

# review round-2 finding 1: scope_busy_with only sees file globs, so two tasks with disjoint
# files but a shared invariant (a port, an external fixture, a domain data table) could still
# race under max_parallel>1. invariant_tokens (optional, per-task, default none) is a coarser
# exact-match tag a task can declare for state a file glob cannot express -- any shared token
# with another running/ready record means busy. Absent/empty on both sides = today's
# file-scope-only behaviour, unaffected.
invariant_busy_with() { # <candidate-tokens-json> -> colliding slug, or empty
  local cjson="$1" rec st oslug otok
  [ -d "$RUNS" ] || return 0
  for rec in "$RUNS"/*/record.json; do
    [ -e "$rec" ] || continue
    st="$(jget "$rec" status)"
    { [ "$st" = running ] || [ "$st" = ready ]; } || continue
    otok="$(jget "$rec" invariant_tokens '[]')"
    if [ "$(python3 "$DIR/aplib.py" tokens-overlap "$cjson" "$otok")" = OVERLAP ]; then
      oslug="$(jget "$rec" slug "")"; echo "$oslug"; return 0
    fi
  done
}

# review round-1 finding 1: after:'s shape must be validated BEFORE ever treating an unmet
# reference as an (indefinitely) self-resolving WAITING_ON -- otherwise a malformed slug never
# surfaces as INVALID_TASK, it just loops forever. Cheap (no worktree): mirrors aplib.py lint()'s
# after: shape check. Existence (git cat-file against the pinned origin_sha) is checked by the
# caller, which has origin_sha in scope; this file stays git-free by design.
after_slugs_or_error() { # <fm-file> -> each valid after: slug on its own line, or one 'ERROR: ...' line
  python3 -c '
import json, re, sys
fm = json.load(open(sys.argv[1]))
after = fm.get("after")
if after is None:
    sys.exit(0)
slugs = [after] if isinstance(after, str) else (after if isinstance(after, list) else None)
if slugs is None:
    print("ERROR: after must be a slug string or a list of slug strings"); sys.exit(0)
# review round-4 finding 4: mirrors the same rejection in aplib.py lint() -- after: present but
# blank is near-certainly a templating/authoring mistake, not "no dependency" (that case never
# reaches here at all: after stays None when the key is absent entirely). No apostrophes in this
# comment block -- it lives inside a bash single-quoted python3 -c string.
if not slugs:
    print("ERROR: after is present but empty -- remove the key entirely for no dependency, or fill in at least one slug"); sys.exit(0)
for s in slugs:
    if not isinstance(s, str) or not re.match(r"^[a-z0-9][a-z0-9-]{2,60}$", s):
        print("ERROR: after entry %r must match ^[a-z0-9][a-z0-9-]{2,60}$" % (s,)); sys.exit(0)
    print(s)
' "$1"
}

# review round-6 finding 1: aplib.py's lint only ever sees ONE task file, so it can reject a
# self-reference but not a genuine A<->B (or longer) cycle across separate files -- that needs the
# whole queue's after: graph, which only the dispatcher (reading every task off the pinned
# origin_sha) can see. A walk only follows QUEUED predecessors (ap3/queue/<s>.md) -- one already in
# ap3/queue/done/ has, by definition, already run and resolved its own after: chain, so a path
# through it is not live and is not explored further.
#
# W4.1 round-1 review finding 3: the original BFS-with-a-flat-"seen"-set only flagged a cycle when
# traversal revisited the ORIGINAL starting slug -- so for outer -> A -> B -> A (A and B cycle with
# each other; outer merely depends on A and is not itself part of the cycle), checking "outer"
# returned false, and outer sat WAITING_ON A forever even after A/B were individually quarantined
# (each of THEIR OWN checks correctly found the cycle, since starting from A or from B does revisit
# itself). A flat "already seen anywhere" set can't fix this either: it would also misfire on a
# legitimate DIAMOND (two tasks sharing a common, non-cyclic ancestor reached via two different
# after: entries) -- a shared dependency is not a cycle. The correct signal is a back-edge to a
# node CURRENTLY ON THE ACTIVE PATH (DFS "gray"), distinct from a node already fully explored on
# some OTHER path with no cycle found under it (DFS "black", never re-examined). Recursive, so the
# active path is naturally the call stack; GRAY is threaded through as a string argument (shrinks
# back on return, exactly matching the path popping in real DFS); BLACK is one global set shared
# across the whole traversal from a single after_cycle_detected() call (a node fully cleared once
# is never worth re-walking from a different path). No bash arrays anywhere, /bin/bash 3.2
# compatible (matches the rest of this file's existing convention).
after_cycle_from() { # <origin_sha> <slug> <gray-set, space-delimited with leading/trailing space> -> 0 (true, cycle reachable from here) / 1 (false)
  local origin_sha="$1" s="$2" gray="$3" tf fmt lines a
  case "$gray" in *" $s "*) return 0 ;; esac    # back-edge to a node on the CURRENT path -- real cycle
  case "$AFTER_CYCLE_BLACK" in *" $s "*) return 1 ;; esac  # already fully explored elsewhere, no cycle under it
  gray="$gray$s "
  tf="$(mktemp)"; git show "$origin_sha:ap3/queue/$s.md" > "$tf" 2>/dev/null || { rm -f "$tf"; AFTER_CYCLE_BLACK="$AFTER_CYCLE_BLACK$s "; return 1; }
  fmt="$(mktemp)"; python3 "$DIR/aplib.py" frontmatter "$tf" > "$fmt" 2>/dev/null; rm -f "$tf"
  if [ ! -s "$fmt" ]; then rm -f "$fmt"; AFTER_CYCLE_BLACK="$AFTER_CYCLE_BLACK$s "; return 1; fi
  lines="$(after_slugs_or_error "$fmt")"; rm -f "$fmt"
  case "$lines" in
    ERROR:*) AFTER_CYCLE_BLACK="$AFTER_CYCLE_BLACK$s "; return 1 ;;
  esac
  for a in $lines; do
    if after_cycle_from "$origin_sha" "$a" "$gray"; then return 0; fi
  done
  AFTER_CYCLE_BLACK="$AFTER_CYCLE_BLACK$s "
  return 1
}
after_cycle_detected() { # <origin_sha> <starting-slug> -> 0 (true, cycle) / 1 (false)
  AFTER_CYCLE_BLACK=" "
  after_cycle_from "$1" "$2" " "
}

# D3: a class that allows concurrent runs (max_parallel>1) WITHOUT per-run database isolation
# (db_per_run false, the default) must not run two verify commands that touch a shared test
# database at once. review round-3 finding 3: class-agnostic -- what actually avoids colliding on
# the shared DATABASE_URL_TEST is db_per_run isolation (a non-empty db_name), not class
# membership, so a DIFFERENT class with its own max_parallel>1 and db_per_run false could
# otherwise race a same-class-only check would never see. True iff some OTHER active,
# non-isolated record's own pinned verify also mentions the shared test database.
db_shared_conflict() { # -> 0 (true) / 1 (false)
  local rec st overify odbname
  [ -d "$RUNS" ] || return 1
  for rec in "$RUNS"/*/record.json; do
    [ -e "$rec" ] || continue
    st="$(jget "$rec" status)"
    { [ "$st" = running ] || [ "$st" = ready ]; } || continue
    odbname="$(jget "$rec" db_name "")"
    [ -n "$odbname" ] && continue   # db_per_run isolated -- not touching the shared database
    overify="$(jget "$rec" verify "")"
    case "$overify" in *test:db*) return 0 ;; esac
  done
  return 1
}

count_today() { # <class> -> runs of this class started today
  local cls="$1" rec n=0
  [ -d "$RUNS" ] || { echo 0; return; }
  for rec in "$RUNS"/*/record.json; do
    [ -e "$rec" ] || continue
    [ "$(jget "$rec" class "")" = "$cls" ] || continue
    case "$(jget "$rec" started_at "")" in "$(today)"*) n=$((n+1)) ;; esac
  done
  echo "$n"
}

start_next() {
  local origin_sha cands path slug cls cap n rjson tsrc fm risk budget wt inv lint_out reason blocker feature task_model
  local max_par running_now cscope cverify cinv dbpr busy_slug inv_busy_slug started_any=0
  local after_lines after_missing s db_orig_url db_orig_name db_admin_url db_provision_failed rdbname
  origin_sha="$1"
  # only top-level queue files whose basename is a valid slug (excludes EXAMPLE.md,
  # _-prefixed drafts and any queue/done or queue/_after-*/ subdirectory).
  cands="$(git ls-tree -r --name-only origin/main -- ap3/queue 2>/dev/null | grep -E '^ap3/queue/[a-z0-9][a-z0-9-]*\.md$' | sort || true)"
  [ -n "$cands" ] || { log NOTHING_QUEUED; return; }
  # kit-level fail-closed, checked ONCE per tick (not per task): every writer is launched with
  # --settings pointing at the contract materialized from the pinned base, so it MUST exist there. A
  # missing contract reports like FETCH_FAILED and starts nothing — never a terminal record + orphan
  # worktree per queued task that then re-attempts every tick.
  if ! git cat-file -e "$origin_sha:ap3/writer-settings.json" 2>/dev/null; then
    log "NO_WRITER_SETTINGS (ap3/writer-settings.json absent on origin/main — run ap3/install.sh, commit + push it)"; return
  fi
  local saw_capped=0
  # authority is the fetched origin/main snapshot, never the mutable working tree
  rjson="$(mktemp)"; git show "origin/main:ap3/routines.json" > "$rjson" 2>/dev/null || : > "$rjson"
  while IFS= read -r path; do
    [ -n "$path" ] || continue
    slug="$(basename "$path" .md)"
    [ -e "$RUNS/$slug/record.json" ] && continue                       # already has a run

    # W4.1 round-4 review finding 4: a DB_PROVISION_FAILED whose OWN cleanup also failed leaves a
    # local worktree/branch stranded at this exact path -- every later tick's git worktree add
    # would fail identically forever with no durable record of why. Not origin_sha-keyed like
    # K1's quarantine below (the problem is stuck LOCAL git state, not bad content -- a new
    # commit would not fix it): skip unconditionally while this marker exists.
    if [ -e "$STATE/stranded/$slug.json" ]; then
      log "DB_PROVISION_FAILED $slug (quarantined, stranded worktree/branch -- see $STATE/stranded/$slug.json)"
      continue
    fi

    # K1: quarantine an INVALID_TASK by the pinned origin_sha it was last found invalid at — an
    # invalid file was rebuilt into a worktree and re-notified on EVERY tick; once a given commit
    # is known-bad, skip it silently (one log line, no network branch probe, no worktree) until
    # origin/main moves. Keyed on the WHOLE commit, not just the task file's own blob (round-1
    # review finding 4): lint also depends on routines.json (class enabled/paused/scope) and on
    # Context-path existence elsewhere in the tree, so a fix landing in EITHER of those without
    # touching the task file itself must still clear the quarantine — and any such fix is, by
    # construction, a new commit, hence a new origin_sha.
    inv="$STATE/invalid/$slug.json"
    if [ -e "$inv" ] && [ "$(jget "$inv" origin_sha "")" = "$origin_sha" ]; then
      log "INVALID_TASK $slug (quarantined, at ${origin_sha:0:7})"
      continue
    fi
    rm -f "$inv"   # origin moved (or no record yet) — clear any stale verdict and re-lint fresh

    git ls-remote --heads origin "ap3/$slug" 2>/dev/null | grep -q . && continue  # branch exists
    # class + cap + paused, all from the origin snapshot / real trust (cheap, no worktree yet)
    tsrc="$(mktemp)"; git show "origin/main:$path" > "$tsrc" 2>/dev/null || { rm -f "$tsrc"; continue; }
    fm="$(mktemp)"; python3 "$DIR/aplib.py" frontmatter "$tsrc" > "$fm" 2>/dev/null || { rm -f "$tsrc" "$fm"; continue; }
    cls="$(jget "$fm" class "")"; risk="$(jget "$fm" risk "")"; budget="$(jget "$fm" budget_usd "")"
    [ -n "$cls" ] || { rm -f "$tsrc" "$fm"; continue; }
    if [ "$(jget "$TRUST" "$cls.paused" false)" = true ]; then rm -f "$tsrc" "$fm"; continue; fi
    cap="$(jget "$rjson" "classes.$cls.max_runs_per_day" 1)"
    n="$(count_today "$cls")"
    if [ "$n" -ge "$cap" ]; then rm -f "$tsrc" "$fm"; saw_capped=1; continue; fi
    # D3: max_parallel (default 1 == today's behaviour) caps how many of THIS class may be
    # running/ready at once. in_flight() sees every candidate already STARTED earlier in this
    # same tick (its record.json is on disk before the loop continues), so a second same-class
    # candidate in one tick is correctly capped too, not just across ticks.
    #
    # review round-1 finding 2: max_parallel is per-class, but a DEFAULT class (<=1, unset
    # counts as 1) must still get EXACTLY pre-D3 behaviour -- blocked by anything else running,
    # of ANY class, and itself blocking every other class while active. Only once a class has
    # explicitly opted into max_parallel>1 does cross-class concurrency become possible, and
    # even then never alongside an active default-class record (which still expects exclusivity).
    max_par="$(jget "$rjson" "classes.$cls.max_parallel" 1)"
    # review round-2 finding 2: same fail-open hazard as default_class_active's rmp -- a
    # malformed max_parallel must coerce to the safe default (1), never silently fall through the
    # numeric comparison into the parallel-admission branch.
    case "$max_par" in ''|*[!0-9]*) max_par=1 ;; esac
    running_now="$(in_flight "$cls")"
    if [ "$max_par" -le 1 ]; then
      if [ "$(in_flight)" -ge 1 ]; then rm -f "$tsrc" "$fm"; saw_capped=1; continue; fi
    else
      if [ "$running_now" -ge "$max_par" ]; then rm -f "$tsrc" "$fm"; saw_capped=1; continue; fi
      if default_class_active "$rjson"; then rm -f "$tsrc" "$fm"; saw_capped=1; continue; fi
    fi
    # review round-1 finding 1: validate after:'s shape (aplib.py lint() does the same check,
    # but only once a worktree exists -- this must happen BEFORE the WAITING_ON check below, or
    # a malformed slug is silently indistinguishable from "valid but not done yet" and loops
    # forever instead of ever surfacing as INVALID_TASK).
    after_lines="$(after_slugs_or_error "$fm")"
    case "$after_lines" in
      ERROR:*)
        rm -f "$tsrc" "$fm"
        reason="INVALID_TASK $slug: ${after_lines#ERROR: }"
        jset "$inv" origin_sha "$origin_sha"; jset "$inv" reason "$reason"; jset "$inv" at "$(now)"
        log "INVALID_TASK $slug"; notify "INVALID_TASK $slug (see lint)"; continue
        ;;
    esac
    after_missing=""
    for s in $after_lines; do
      if ! git cat-file -e "$origin_sha:ap3/queue/$s.md" 2>/dev/null \
         && ! git cat-file -e "$origin_sha:ap3/queue/done/$s.md" 2>/dev/null; then
        after_missing="$s"; break
      fi
    done
    if [ -n "$after_missing" ]; then
      rm -f "$tsrc" "$fm"
      reason="INVALID_TASK $slug: after entry '$after_missing' has no ap3/queue/$after_missing.md or ap3/queue/done/$after_missing.md"
      jset "$inv" origin_sha "$origin_sha"; jset "$inv" reason "$reason"; jset "$inv" at "$(now)"
      log "INVALID_TASK $slug"; notify "INVALID_TASK $slug (see lint)"; continue
    fi
    # review round-6 finding 1: a genuine A<->B (or longer) after: cycle across separate task
    # files would otherwise loop WAITING_ON forever below -- quarantine it the same way as any
    # other unfixable-without-a-new-commit task (K1), before ever reaching the WAITING_ON check.
    if after_cycle_detected "$origin_sha" "$slug"; then
      rm -f "$tsrc" "$fm"
      reason="INVALID_TASK $slug: after: dependency chain forms a cycle (would wait on itself, directly or transitively)"
      jset "$inv" origin_sha "$origin_sha"; jset "$inv" reason "$reason"; jset "$inv" at "$(now)"
      log "INVALID_TASK $slug"; notify "INVALID_TASK $slug (see lint)"; continue
    fi
    # D1: after: <slug> (one or a list, optional) gates this candidate until every named
    # predecessor's LATEST run record is status:archived AND merged_unchanged:true — a still-
    # running/halted/rejected/merged-with-changes predecessor blocks it. Logged, never notified:
    # an unmet dependency is an expected, self-resolving wait, not an anomaly. Only reached once
    # after: is confirmed well-formed above.
    blocker="$(RUNS="$RUNS" FM="$fm" python3 -c '
import json, os
fm = json.load(open(os.environ["FM"]))
after = fm.get("after")
slugs = [after] if isinstance(after, str) else (after if isinstance(after, list) else [])
runs = os.environ["RUNS"]
for s in slugs:
    try:
        rec = json.load(open(os.path.join(runs, s, "record.json")))
    except (OSError, ValueError):
        print(s); break
    if rec.get("status") != "archived" or rec.get("merged_unchanged") is not True:
        print(s); break
')"
    if [ -n "$blocker" ]; then rm -f "$tsrc" "$fm"; log "WAITING_ON $blocker"; continue; fi
    feature="$(jget "$fm" feature "")"       # D1: optional, copied into the record + evidence row
    task_model="$(jget "$fm" model "")"      # D2: optional, top of the writer_model precedence
    cscope="$(jget "$fm" scope '[]')"        # D3: pinned into the record for later disjointness checks
    cverify="$(jget "$fm" verify "")"        # D3: pinned into the record for the DB_SHARED check
    cinv="$(jget "$fm" invariant_tokens '[]')"   # review round-2 finding 1: pinned for the invariant-token gate
    dbpr="$(jget "$rjson" "classes.$cls.db_per_run" false)"
    rm -f "$tsrc" "$fm"
    # D3: scope disjointness against every OTHER running/ready record, any class -- max_parallel
    # only raises how many of THIS class may run; two DIFFERENT classes must still never collide.
    busy_slug="$(scope_busy_with "$cscope")"
    if [ -n "$busy_slug" ]; then log "SCOPE_BUSY $slug (overlaps running $busy_slug)"; continue; fi
    # review round-2 finding 1: file-glob disjointness alone can't see a shared invariant (a
    # port, an external fixture, a domain data table) -- an optional invariant_tokens tag also
    # gates admission. No tokens declared (the common case) means this never fires.
    inv_busy_slug="$(invariant_busy_with "$cinv")"
    if [ -n "$inv_busy_slug" ]; then log "INVARIANT_BUSY $slug (shares an invariant token with running $inv_busy_slug)"; continue; fi
    # D3: a class allowing concurrency without per-run database isolation must not start a
    # second same-class run whose verify also touches the shared test database.
    if [ "$max_par" -gt 1 ] && [ "$dbpr" != true ]; then
      case "$cverify" in
        *test:db*)
          if db_shared_conflict; then log "DB_SHARED $slug"; continue; fi
          ;;
      esac
    fi
    # validate the WHOLE task against the pinned snapshot: lint INSIDE the worktree (it is the
    # origin_sha checkout, so task + routines.json + Context paths are the authoritative versions).
    wt="$WT/$slug"
    git worktree add -q -b "ap3/$slug" "$wt" "$origin_sha" 2>/dev/null \
      || { log "INVALID_TASK $slug (worktree add failed)"; continue; }
    if ! lint_out="$( cd "$wt" && AP3_TRUST_PATH="$TRUST" bash "$DIR/lint-task.sh" "$path" 2>&1 )"; then
      git worktree remove --force "$wt" 2>/dev/null || true
      git branch -D "ap3/$slug" 2>/dev/null || true
      reason="$(printf '%s\n' "$lint_out" | head -1)"
      jset "$inv" origin_sha "$origin_sha"; jset "$inv" reason "$reason"; jset "$inv" at "$(now)"
      log "INVALID_TASK $slug"; notify "INVALID_TASK $slug (see lint)"; continue
    fi
    # review round-1 finding 3: db_per_run provisioning is fail-closed -- a missing
    # DATABASE_URL_TEST/AP3_DB_ADMIN_URL or a failed CREATE DATABASE must refuse to start this
    # candidate (retried next tick, self-resolving once ap3/env or connectivity is fixed), never
    # silently proceed with an empty/unusable db_name pinned into the record regardless.
    rdbname=""
    if [ "$dbpr" = true ]; then
      db_orig_url="$(db_env_get DATABASE_URL_TEST)"
      db_admin_url="$(db_env_get AP3_DB_ADMIN_URL)"
      db_provision_failed=0
      if [ -z "$db_orig_url" ] || [ -z "$db_admin_url" ]; then
        db_provision_failed=1
      else
        db_orig_name="$(URL="$db_orig_url" python3 -c 'import os
from urllib.parse import urlsplit
print(urlsplit(os.environ["URL"]).path.lstrip("/"))')"
        # review round-4 finding 5: an 8-char slug PREFIX collides (payments-one/payments-two both
        # truncate to "payments"), and appending to the full source db name ignores Postgres's
        # 63-byte identifier limit (silent further truncation/collision). Hash the COMPLETE slug
        # (collision-resistant, fixed width) for the unique part, and bound the whole name to 63
        # bytes by truncating db_orig_name's contribution only as far as actually needed --
        # uniqueness never depends on db_orig_name, only on the full-slug hash.
        # review round-5 finding 2: the limit is 63 BYTES, not 63 characters -- db_orig_name comes
        # from the operator's own DATABASE_URL_TEST and isn't guaranteed ASCII (unlike slug, which
        # lint already constrains to [a-z0-9-]). Slicing a Python str by [:N] counts codepoints, so
        # a multibyte db_orig_name could still overflow 63 UTF-8 bytes and have Postgres's own
        # truncation-on-create cut into the hash suffix, reopening the exact collision this fix
        # closes. Truncate the ENCODED bytes instead, then decode with errors="ignore" to drop any
        # partial trailing multibyte sequence -- this is the only way to make the byte budget exact
        # regardless of what characters db_orig_name contains.
        rdbname="$(ORIG="$db_orig_name" SLUG="$slug" python3 -c 'import hashlib, os
h = hashlib.sha256(os.environ["SLUG"].encode()).hexdigest()[:12]
suffix = "_ap3_" + h
budget = 63 - len(suffix.encode())
prefix = os.environ["ORIG"].encode()[:budget].decode("utf-8", "ignore")
print(prefix + suffix)')"
        psql "$db_admin_url" -c "CREATE DATABASE \"$rdbname\"" >/dev/null 2>&1 || db_provision_failed=1
      fi
      if [ "$db_provision_failed" = 1 ]; then
        git worktree remove --force "$wt" 2>/dev/null || true
        git branch -D "ap3/$slug" 2>/dev/null || true
        # review round-6 finding 4: re-check the removals actually succeeded (retry.sh's own
        # pattern), rather than trusting the exit codes above (both swallowed via `|| true`). A
        # stranded worktree/branch here does NOT self-resolve like the routine DB_PROVISION_FAILED
        # case (which retries cleanly next tick once ap3/env is fixed) -- a later tick's
        # `git worktree add -b ap3/$slug` would fail on the SAME stale path/branch forever,
        # misreporting as INVALID_TASK (worktree add failed) with no route back to a real retry. No
        # run record exists yet to halt() against here, so surface it loudly instead.
        if [ -e "$wt" ] || git rev-parse --verify --quiet "refs/heads/ap3/$slug" >/dev/null 2>&1; then
          # W4.1 round-4 review finding 4: a log line is not a durable artifact -- without one,
          # every LATER tick blindly re-attempts `git worktree add` at this same stuck path,
          # fails identically, and misreports as a fresh INVALID_TASK (worktree add failed) with
          # no record of the real cause. Write a marker the loop above checks and skips on,
          # cleared only by the owner fixing the worktree/branch by hand and removing the file.
          mkdir -p "$STATE/stranded"
          jset "$STATE/stranded/$slug.json" reason "DB_PROVISION_FAILED cleanup also failed"
          jset "$STATE/stranded/$slug.json" at "$(now)"
          jset "$STATE/stranded/$slug.json" fix_by_hand "git worktree unlock \"$wt\" 2>/dev/null; git worktree remove --force \"$wt\"; git branch -D ap3/$slug"
          log "DB_PROVISION_FAILED $slug -- ALSO could not clean up (worktree/branch still present) -- stranded, will NOT self-resolve, fix by hand: git worktree unlock \"$wt\" 2>/dev/null; git worktree remove --force \"$wt\"; git branch -D ap3/$slug"
          notify "⚠️ $slug: DB_PROVISION_FAILED and cleanup also failed -- worktree/branch stranded, needs manual cleanup"
          continue
        fi
        log "DB_PROVISION_FAILED $slug (db_per_run is true but the database could not be created -- check DATABASE_URL_TEST/AP3_DB_ADMIN_URL in ap3/env)"
        continue
      fi
    fi
    # START — pin the class policy (security_review, writer_model) from the origin snapshot into
    # the record so a later working-tree edit cannot change how this run is reviewed/modelled.
    mkdir -p "$RUNS/$slug"
    # materialize the IMMUTABLE base task AND writer contract from the SAME pinned base into run state
    # — the gate reads task.md, the writer is launched with --settings pointing at the contract, so
    # neither the writer nor a later working-tree edit can change them between fix rounds (finding 1).
    # The contract's presence on the base was gated once per tick above, so both git-shows succeed.
    git show "$origin_sha:$path" > "$RUNS/$slug/task.md"
    git show "$origin_sha:ap3/writer-settings.json" > "$RUNS/$slug/writer-settings.json"
    local rsec rmodel rfixmodel
    rsec="$(jget "$rjson" "classes.$cls.security_review" auto)"
    # D2: task model: > class writer_model > top-level writer_model > claude-sonnet-5. Pinned
    # once here from the origin snapshot (like security_policy) so a later working-tree edit, or
    # a live routines.json change mid-run, cannot change which model a run uses between rounds.
    rmodel="$task_model"
    [ -n "$rmodel" ] || rmodel="$(jget "$rjson" "classes.$cls.writer_model" "")"
    [ -n "$rmodel" ] || rmodel="$(jget "$rjson" writer_model "")"
    [ -n "$rmodel" ] || rmodel="claude-sonnet-5"
    rfixmodel="$(jget "$rjson" "classes.$cls.fix_model" "")"
    # D3: db_per_run's database (rdbname) was already created fail-closed, above, before any
    # run-state was written for this candidate -- reused here only to pin it into the record.
    RSLUG="$slug" RCLASS="$cls" RRISK="$risk" RBASE="$origin_sha" RBUDGET="$budget" RSTART="$(now)" \
      RSEC="$rsec" RMODEL="$rmodel" RFEATURE="$feature" RFIXMODEL="$rfixmodel" \
      RSCOPE="$cscope" RVERIFY="$cverify" RINV="$cinv" RDBNAME="$rdbname" \
      RREC="$RUNS/$slug/record.json" python3 -c 'import json,os
o={"slug":os.environ["RSLUG"],"class":os.environ["RCLASS"],"risk":os.environ["RRISK"],
   "base_sha":os.environ["RBASE"],"budget_usd":float(os.environ["RBUDGET"]),"spent_usd":0,
   "scope":json.loads(os.environ["RSCOPE"]),"verify":os.environ["RVERIFY"],
   "invariant_tokens":json.loads(os.environ["RINV"]),
   "security_policy":os.environ["RSEC"],"writer_model":os.environ["RMODEL"],
   "started_by":"ap3-dispatch","started_at":os.environ["RSTART"],
   "nonce":os.environ["RSLUG"]+"-"+os.environ["RSTART"],
   "status":"running","phase":"writing","review_round":0}
if os.environ.get("RFEATURE"): o["feature"]=os.environ["RFEATURE"]
if os.environ.get("RFIXMODEL"): o["fix_model"]=os.environ["RFIXMODEL"]
if os.environ.get("RDBNAME"): o["db_name"]=os.environ["RDBNAME"]
open(os.environ["RREC"],"w").write(json.dumps(o,indent=2)+"\n")'
    # D3: no early return -- capacity (max_parallel) and scope-disjointness above already decide
    # per candidate whether starting it is safe, so the tick keeps trying the rest of the queue
    # instead of stopping at the first launch.
    if launch_writer "$slug"; then log "STARTED $slug"; started_any=1; fi   # else it HALTed (e.g. NO_WRITER_SETTINGS)
  done <<< "$cands"
  rm -f "$rjson"
  if [ "$started_any" != 1 ]; then
    [ "$saw_capped" = 1 ] && log CAP_HIT || { [ "$DID_RECONCILE" = 1 ] && log RECONCILED || log NOTHING_QUEUED; }
  fi
}

main() {
  if [ -f ap3/PAUSED ]; then log PAUSED; exit 0; fi
  mkdir -p "$RUNS" "$WT"
  if ! mkdir "$STATE/.lock" 2>/dev/null; then
    local lp; lp="$(cat "$STATE/.lock/pid" 2>/dev/null || echo "")"
    if [ -n "$lp" ] && kill -0 "$lp" 2>/dev/null; then log "BUSY (lock $lp)"; exit 0; fi
    rm -rf "$STATE/.lock"; mkdir "$STATE/.lock" 2>/dev/null || { log "BUSY (lock race)"; exit 0; }
  fi
  echo $$ > "$STATE/.lock/pid"
  trap 'rm -rf "$STATE/.lock"' EXIT

  # fail closed on a corrupt trust file: a partially-written trust.json must never read as
  # "nothing paused" and silently restart a paused class.
  if [ -f "$TRUST" ] && ! python3 -c 'import json,sys;json.load(open(sys.argv[1]))' "$TRUST" 2>/dev/null; then
    log "TRUST_CORRUPT (ap3/state/trust.json unparseable — not dispatching)"; exit 0
  fi

  if ! git fetch -q origin main 2>/dev/null; then log FETCH_FAILED; exit 0; fi
  local origin_sha; origin_sha="$(git rev-parse origin/main)"

  reconcile_all
  # review round-5 finding 4: reconcile_all can detect (via `gh pr view`'s live state, not a git
  # fetch) that an after:-predecessor's PR merged just now, unblocking its successor in THIS same
  # tick -- but origin_sha was bound BEFORE reconcile_all ran, so start_next would dispatch that
  # successor from a base that doesn't yet contain the predecessor's own merged changes, exactly
  # what after: exists to prevent. Refetch and rebind origin_sha after reconciliation, before
  # start_next ever reads it -- cheap (one more idempotent fetch per tick) and removes the race
  # rather than deferring the unblock to a later tick.
  if ! git fetch -q origin main 2>/dev/null; then log FETCH_FAILED; exit 0; fi
  origin_sha="$(git rev-parse origin/main)"
  # D3: no blanket single-writer gate here any more -- start_next decides per candidate, per
  # class (max_parallel, default 1 == today's behaviour) and per scope (never two overlapping).
  start_next "$origin_sha"
  # review round-3/round-4 findings: reprint BUSY as the tick's TRUE last line whenever any
  # writer process is still alive at this point -- queried directly (any_writer_running), not a
  # flag some call site might have forgotten to set. Catches every way a writer can end up
  # running this tick: reconcile_all found one already alive, start_next just launched one, or
  # run_review just re-dispatched one after findings. In addition to, never instead of, whatever
  # start_next itself already logged (D3 can legitimately start unrelated work in the same tick).
  # `if` (not a bare `[ ] &&`) -- under set -e a false `[ ] &&` as the LAST statement of main()
  # would exit 1 on every non-busy tick.
  if any_writer_running; then log BUSY; fi
}

main "$@"
