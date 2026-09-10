#!/usr/bin/env bash
# ap3 dispatcher (DESIGN §7, as corrected by W1-DECISION-codex-sandbox.md). Runs from
# launchd every 15 min. Idempotent, fail-closed, one live run at a time. Every tick ends
# by printing exactly one of: PAUSED BUSY FETCH_FAILED NO_WRITER_SETTINGS NOTHING_QUEUED CAP_HIT
# STARTED RECONCILED. (NO_WRITER_SETTINGS is non-terminal, like FETCH_FAILED: the per-run writer
# contract is absent on the base, so the tick starts nothing until it is committed + pushed.)
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

DID_RECONCILE=0

pause_class() { # <class> <reason> — trust is re-earned by hand, never auto-restored
  jsetj "$TRUST" "$1.paused" true
  jset  "$TRUST" "$1.last_exception" "$2"
  jsetj "$TRUST" "$1.clean_runs" 0
}

# Evidence lives in the local ledger only (ap3/state/evidence.local.jsonl) — never an unreviewed
# commit on the PR branch. Written at READY (so a READY claim always has a durable row) and again
# at merge/reject with the final outcome; report.sh dedups by slug, keeping the last row. Returns
# non-zero if the append fails, so a caller can fail closed.
write_evidence() { # <slug>
  python3 "$DIR/evidence.py" "$RUNS/$1/record.json" "$RUNS/$1/result.json" >> "$STATE/evidence.local.jsonl"
}

# Sum a finished attempt's cost/turns/denials into the record so a multi-round run reports its
# CUMULATIVE spend, not just the last attempt (round-2 finding).
accumulate_telemetry() { # <slug>
  local rec="$RUNS/$1/record.json" res="$RUNS/$1/result.json"
  [ -s "$res" ] || return 0
  REC="$rec" RES="$res" python3 -c 'import json,os
r=json.load(open(os.environ["REC"])); s=json.load(open(os.environ["RES"]))
def num(x):
    return x if isinstance(x,(int,float)) else 0
r["spent_usd"]=round(num(r.get("spent_usd"))+num(s.get("total_cost_usd")),6)
r["total_turns"]=int(num(r.get("total_turns")))+int(num(s.get("num_turns")))
d=s.get("permission_denials"); r["total_denials"]=int(num(r.get("total_denials")))+(len(d) if isinstance(d,list) else 0)
json.dump(r,open(os.environ["REC"],"w"),indent=2)' 2>/dev/null || true
}

halt() { # <slug> <reason> <msg>
  local slug="$1" reason="$2" msg="$3" rec="$RUNS/$1/record.json"
  local cls; cls="$(jget "$rec" class unknown)"
  jset "$rec" status halted; jset "$rec" terminal "$reason"; jset "$rec" finished_at "$(now)"
  jset "$rec" review_verdict "$(jget "$rec" review_verdict unavailable)"
  pause_class "$cls" "$reason"
  write_evidence "$slug" || log "WARN $slug: evidence append failed at halt"
  notify "⛔ HALT $slug ($reason): $msg"
  log "RECONCILED $slug HALT $reason — $msg (worktree kept for forensics)"
  DID_RECONCILE=1
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
  # push the reviewed tip by SHA to an explicit ref (not a mutable named branch), then verify the
  # remote OID equals what we reviewed — the PR can only ever carry the reviewed commit.
  if ! ( cd "$wt" && git push -q origin "$nowsha:refs/heads/ap3/$slug" 2>/dev/null ); then
    halt "$slug" PUSH_FAILED "git push of ap3/$slug failed"; return
  fi
  remote_oid="$( cd "$wt" && { git ls-remote origin "refs/heads/ap3/$slug" 2>/dev/null || true; } | awk '{print $1}' )"
  if [ "$remote_oid" != "$nowsha" ]; then   # empty on ls-remote failure -> mismatch -> terminal HALT (not a set -e crash)
    halt "$slug" REMOTE_TIP_MISMATCH "pushed tip '$remote_oid' != reviewed tip $nowsha"; return
  fi
  url="$( cd "$wt" && gh pr create --head "ap3/$slug" --base main \
            --title "ap3: $slug" --body "Autonomous ap3 change. Independent review: CLEAN. Evidence in ap3/state." \
            2>/dev/null | tail -1 )" || true
  case "$url" in http*) : ;; *) halt "$slug" PR_FAILED "gh pr create returned no URL"; return ;; esac
  jset "$rec" pr_url "$url"; jset "$rec" terminal READY
  # a READY claim must have a durable evidence row (written before we announce it)
  if ! write_evidence "$slug"; then halt "$slug" EVIDENCE_FAILED "could not write the evidence row"; return; fi
  jset "$rec" status ready
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

  if [ "$crc" -eq 3 ] || [ "$sec" = UNAVAILABLE ]; then
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
  # don't re-dispatch if too little budget remains for another writer session
  if ! BT="$(jget "$rec" budget_usd 0)" SP="$(jget "$rec" spent_usd 0)" \
       python3 -c 'import os,sys;sys.exit(0 if (float(os.environ["BT"])-float(os.environ["SP"]))>=0.5 else 1)'; then
    halt "$slug" BUDGET "insufficient remaining budget for another fix round"; return
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
  model="$(jget "$rec" writer_model claude-sonnet-4-5)"   # pinned at start, not the live tree
  # remaining budget = declared - already spent across fix rounds (never re-grants the full cap)
  budget="$(BT="$(jget "$rec" budget_usd 0)" SP="$(jget "$rec" spent_usd 0)" \
    python3 -c 'import os;print(round(max(0.0,float(os.environ["BT"])-float(os.environ["SP"])),4))')"
  prompt="$(cat "$DIR/prompts/run.md")"
  jset "$rec" status running
  mkdir -p "$wt/.ap3-run"
  # `--settings` LOADS ON TOP of the user/project/local scopes and array keys (permissions.allow/deny,
  # allowedDomains, filesystem.allowRead) UNION across scopes — so the target repo's own
  # `.claude/settings.json` (or ~/.claude, or a .local) could weaken the writer's sandbox/denies.
  # `--setting-sources ''` loads NONE of those scopes, so the contract stands alone (proved by
  # probe-settings-flag.sh: a hostile project `deny: Bash(git *)` is ignored with it, applied without).
  # ap3/env is sourced INSIDE this subshell only, so secrets never reach the dispatcher/reviewer.
  ( cd "$wt"
    if [ -f "$REPO/ap3/env" ]; then set -a; . "$REPO/ap3/env"; set +a; fi
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
  accumulate_telemetry "$slug"       # sum this attempt's cost/turns/denials before any decision
  jset "$rec" head_sha "$( git -C "$wt" rev-parse HEAD )"
  jset "$rec" finished_at "$(now)"
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
        notify "merged with human changes $slug — class $cls paused, clean_runs reset"
      fi
      jset "$rec" status archived
      write_evidence "$slug"    # complete row now that merge outcome is known
      git worktree remove --force "$wt" 2>/dev/null || true
      log "RECONCILED $slug merged (unchanged=$(jget "$rec" merged_unchanged))"; DID_RECONCILE=1 ;;
    CLOSED)
      jset "$rec" status halted; jset "$rec" terminal REJECTED
      pause_class "$cls" REJECTED
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

in_flight() {  # a writer is running OR an unmerged PR is open — serialize to one at a time so
               # two tasks never modify overlapping scope from stale bases
  local rec st
  [ -d "$RUNS" ] || return 1
  for rec in "$RUNS"/*/record.json; do
    [ -e "$rec" ] || continue
    st="$(jget "$rec" status)"
    { [ "$st" = running ] || [ "$st" = ready ]; } && return 0
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
  local origin_sha cands path slug cls cap n rjson tsrc fm risk budget wt
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
    rm -f "$tsrc" "$fm"
    # validate the WHOLE task against the pinned snapshot: lint INSIDE the worktree (it is the
    # origin_sha checkout, so task + routines.json + Context paths are the authoritative versions).
    wt="$WT/$slug"
    git worktree add -q -b "ap3/$slug" "$wt" "$origin_sha" 2>/dev/null \
      || { log "INVALID_TASK $slug (worktree add failed)"; continue; }
    if ! ( cd "$wt" && AP3_TRUST_PATH="$TRUST" bash "$DIR/lint-task.sh" "$path" ) >/dev/null 2>&1; then
      git worktree remove --force "$wt" 2>/dev/null || true
      git branch -D "ap3/$slug" 2>/dev/null || true
      log "INVALID_TASK $slug"; notify "INVALID_TASK $slug (see lint)"; continue
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
    local rsec rmodel
    rsec="$(jget "$rjson" "classes.$cls.security_review" auto)"
    rmodel="$(jget "$rjson" writer_model claude-sonnet-4-5)"
    RSLUG="$slug" RCLASS="$cls" RRISK="$risk" RBASE="$origin_sha" RBUDGET="$budget" RSTART="$(now)" \
      RSEC="$rsec" RMODEL="$rmodel" \
      RREC="$RUNS/$slug/record.json" python3 -c 'import json,os
o={"slug":os.environ["RSLUG"],"class":os.environ["RCLASS"],"risk":os.environ["RRISK"],
   "base_sha":os.environ["RBASE"],"budget_usd":float(os.environ["RBUDGET"]),"spent_usd":0,
   "security_policy":os.environ["RSEC"],"writer_model":os.environ["RMODEL"],
   "started_by":"ap3-dispatch","started_at":os.environ["RSTART"],
   "nonce":os.environ["RSLUG"]+"-"+os.environ["RSTART"],
   "status":"running","phase":"writing","review_round":0}
open(os.environ["RREC"],"w").write(json.dumps(o,indent=2)+"\n")'
    if launch_writer "$slug"; then log "STARTED $slug"; fi   # else it HALTed (e.g. NO_WRITER_SETTINGS)
    rm -f "$rjson"; return
  done <<< "$cands"
  rm -f "$rjson"
  [ "$saw_capped" = 1 ] && log CAP_HIT || { [ "$DID_RECONCILE" = 1 ] && log RECONCILED || log NOTHING_QUEUED; }
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
  if in_flight; then log BUSY; exit 0; fi
  start_next "$origin_sha"
}

main "$@"
