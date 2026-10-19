#!/usr/bin/env bash
# Independent Codex review, run by the DISPATCHER (unsandboxed — codex cannot init inside
# the writer's Seatbelt; see W1-DECISION-codex-sandbox.md). Feeds the task spec + the
# base...HEAD diff to the pinned, read-only, ephemeral reviewer and prints a final line
#   AP3_REVIEW_VERDICT: CLEAN | FINDINGS | UNAVAILABLE
# Exit: 0 CLEAN, 1 FINDINGS, 3 UNAVAILABLE (no verdict -- fail closed, never CLEAN).
#
# Verdict rules (owner decisions 2026-10-18, narrowed in review round 2; see classify() below):
#   - Exit 0 and the last non-empty line is an exact marker: that marker is the verdict. Marker-looking
#     lines earlier in the transcript (echoed tool output) are ignored.
#   - Nonzero exit and the last line is exactly FINDINGS: FINDINGS. A CLEAN last line with a nonzero exit
#     is contradictory: an `error`.
#   - The run did NOT end on an exact marker (any exit code): a full line `AP3_REVIEW_VERDICT: FINDINGS`
#     anywhere in it is FINDINGS (exit 1) -- no retry, no fallback.
#   - Otherwise a Codex run that exited 0 COMPLETED without a verdict: UNAVAILABLE (exit 3), no retry, no
#     fallback -- a second reviewer never gets to overrule a review that ran.
#   - Reviewer fallback (owner decision 2026-10-15): ONLY when Codex could not run at all -- the pin is
#     missing, auth or quota failed, or it crashed (`error`) on the first attempt AND on one retry -- the
#     same review is re-run by a fresh, read-only Claude session (agent-readonly.sh; Opus 5.5 @ xhigh by
#     default) and the output then STARTS with
#       AP3_REVIEWER: claude-fallback reason=<missing|auth|quota|error> model=<id> effort=<lvl> cost_usd=<n|null>
#     Both reviewers failing is UNAVAILABLE (exit 3), never CLEAN. Our own contract errors (bad --base,
#     refused pin subcommand) never fall back.
# Who gave the verdict is ALSO written, as one line, to $AP3_REVIEWER_OUT when that is set (the dispatcher
# sets a per-round, per-mode path): `codex` | `claude-fallback reason=... model=... effort=... cost_usd=...`
# | `none reason=... fallback=<failed|disabled|not_eligible> [cost_usd=...]`. That file, not the transcript,
# is what the dispatcher trusts: the transcript is stdout+stderr, and stderr noise ahead of the header
# hid a fallback once (2026-10-18 review, F2).
# Knobs: AP3_REVIEW_FALLBACK=0|off|false|no (any case) turns the fallback and its crash retry off;
# AP3_FALLBACK_REVIEW_MODEL, AP3_FALLBACK_REVIEW_EFFORT, AP3_FALLBACK_REVIEW_BUDGET_USD.
# No timeout: a Codex run that hangs blocks this script -- and the dispatcher tick holding the lock --
# until it ends or is killed (launchd starts no overlapping tick; a hand-run one reports BUSY). Nothing
# reaches READY meanwhile (fail closed).
#
# Usage:
#   ap3/review.sh code|security --base <sha> [--task <file>]
#   ap3/review.sh needs-security --base <sha>      -> prints yes|no (heuristic, §6.6)
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$DIR/.." && pwd)"
# K30 (W5.2.6): the reviewer pin is ap3's own file, installed beside this script; the legacy
# <target>/scripts/codex-review-pin.sh (old kit's mirror, never hardened by K25 on its canonical
# side) is only a fallback for a target installed before the kit copy existed.
PIN="${AP3_CODEX_PIN:-}"
if [ -z "$PIN" ]; then
  if [ -x "$DIR/codex-review-pin.sh" ]; then PIN="$DIR/codex-review-pin.sh"
  else PIN="$REPO/scripts/codex-review-pin.sh"; fi
fi

# Who reviewed, on a channel stderr cannot displace: one line, written atomically (tmp + mv) to
# $AP3_REVIEWER_OUT. A write failure leaves no file, which the dispatcher counts as "not Codex" (fail
# closed), so it is reported but never fatal here. The temp file is mktemp'd beside the record (review
# round 2): a predictable "<record>.tmp.<pid>" could be pre-planted as a symlink, and the write would
# then go through it and the mv would turn the record itself into that symlink.
reviewer_out() { # <line>
  [ -n "${AP3_REVIEWER_OUT:-}" ] || return 0
  local tmp=""
  if tmp="$(mktemp "${AP3_REVIEWER_OUT}.XXXXXX" 2>/dev/null)" \
     && printf '%s\n' "$1" > "$tmp" 2>/dev/null && mv -f "$tmp" "$AP3_REVIEWER_OUT" 2>/dev/null; then return 0; fi
  if [ -n "$tmp" ]; then rm -f "$tmp" 2>/dev/null || true; fi
  echo "review: could not write the reviewer record to $AP3_REVIEWER_OUT" >&2
  return 0
}

MODE="${1:-}"; shift || true
case "$MODE" in code|security|needs-security) ;; *) echo "review: mode must be code|security|needs-security" >&2; exit 2 ;; esac
BASE="${AP3_BASE_SHA:-}"
TASK="${AP3_TASK:-}"
while [ $# -gt 0 ]; do
  case "$1" in
    --base) BASE="$2"; shift 2 ;;
    --task) TASK="$2"; shift 2 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done
[ -n "$BASE" ] || { echo "review: --base (or AP3_BASE_SHA) required" >&2; exit 2; }
# Expand a ref/short sha to the full commit sha the pin requires. --verify + ^{commit}: a 40-hex string
# that names no commit is refused (plain rev-parse echoes any 40-hex back unchecked). 2>/dev/null: a ref
# that shares the base's NAME (e.g. a branch a writer named after the SHA) makes git warn "refname is
# ambiguous" on stderr -- noise the dispatcher captures 2>&1 into the transcript (F2). A base that is
# not a commit is our own contract error: an explicit UNAVAILABLE, never a `set -e` death with git's code.
if ! RBASE="$(git rev-parse --verify --quiet "$BASE^{commit}" 2>/dev/null)" || [ -z "$RBASE" ]; then
  echo "review: --base '$BASE' does not name a commit in this repository" >&2
  if [ "$MODE" = needs-security ]; then echo yes; exit 0; fi   # fail toward "yes", like the heuristic
  reviewer_out "none reason=bad_base fallback=not_eligible"
  echo "AP3_REVIEW_VERDICT: UNAVAILABLE"; exit 3
fi
BASE="$RBASE"

# --- security heuristic: does the diff touch a trust boundary? -----------------
if [ "$MODE" = "needs-security" ]; then
  # Fail toward "yes": missing a real auth/permission change is worse than an extra review.
  pat='pass(word|wd)|secret|token|credential|api[_-]?key|auth(z|oriz|entic)?|oauth|jwt|session|cookie|header|permission|privileg|rbac|role|acl|is[_]?admin|grant|access[_-]?control|cors|redirect|money|price|amount|payment|refund|charge|balance|invoice|child_process|subprocess|os\.system|shell=True|[^a-z]exec\(|eval\(|deserial|pickle|yaml\.load|sanitiz|escap|SELECT |INSERT |UPDATE |DELETE |process\.env|req\.(body|query|params|headers|cookies)'
  # Capture the diffs into variables FIRST, then grep the variables. Piping git straight into
  # `grep -q` under `pipefail` makes git die of SIGPIPE (141) after grep's early match, so the
  # pipeline reports failure on a MATCH and the trigger fails open. grep a here-string instead.
  diff_all="$(git diff "$BASE"..HEAD)"
  diff_names="$(git diff --name-only "$BASE"..HEAD)"
  if grep -iqE "$pat" <<< "$diff_all" \
     || grep -iqE 'auth|secret|token|payment|billing|sql|session|crypto|permission|rbac|role|acl|middleware|guard|policy|access' <<< "$diff_names"; then
    echo yes
  else
    echo no
  fi
  exit 0
fi

if [ "$MODE" = security ]; then
  FOCUS="Focus on security: auth/permission bypass, secret handling, money/amount correctness, injection (shell/SQL), and unsafe handling of external input."
else
  FOCUS="Focus on correctness bugs, scope creep beyond the declared scope, and missing or weak tests for the acceptance criteria."
fi

# A per-slice review is fed the task spec (the authority for what the change must do). A kit
# self-review (no task) just reviews the diff for defects — --task is optional.
if [ -n "$TASK" ] && [ -f "$TASK" ]; then
  # A spec line that is itself an exact verdict marker (a task about this very review step, say) would
  # reach codex's transcript verbatim when codex echoes this prompt, and FINDINGS-anywhere (below) would
  # then fire on every review of that task. Such a line is indented two spaces: the reviewer still
  # reads it, but it is no longer a full-line marker.
  SPEC="$(printf '%s\n' \
    "The task spec below is the full authority for what this change must do and must NOT do (its declared scope is the ceiling)." \
    "Do not propose work outside the task's scope; treat pre-existing code outside the diff as ADVISORY." \
    "" "===== TASK SPEC =====" "$(sed 's/^AP3_REVIEW_VERDICT:/  AP3_REVIEW_VERDICT:/' "$TASK")" "===== END TASK SPEC =====")"
else
  SPEC="Review this diff for correctness, security, scope discipline and obvious defects. Treat pre-existing code outside the diff as ADVISORY."
fi

# Decision 5 (2026-10-18): any findings list comes BEFORE the verdict line, and the verdict line is the
# very last line. No line below may itself be an exact marker: codex echoes this prompt into its
# transcript, and an exact `AP3_REVIEW_VERDICT: FINDINGS` line there would trip FINDINGS-anywhere.
MARKER="$(printf '%s\n' \
  "You are the independent reviewer for an autonomous ap3 change." \
  "$FOCUS" \
  "$SPEC" \
  "" \
  "Put any numbered list of actionable findings BEFORE the verdict line, never after it." \
  "End your review with EXACTLY one of these as the very last line -- nothing may follow it:" \
  "AP3_REVIEW_VERDICT: CLEAN      (no actionable finding closable within the declared scope)" \
  "AP3_REVIEW_VERDICT: FINDINGS   (actionable findings exist; they are listed, numbered, ABOVE this line)")"

# --- Codex first; the Claude fallback ONLY when Codex could not run at all -------------------------
# The fallback is a fresh read-only Claude session (ap3/agent-readonly.sh: Read/Glob/Grep, sandboxed, no
# settings sources, budget-capped) -- never the writer's own session or a sub-agent of it -- fed the same
# prompt contract and the exact diff. Its output carries an AP3_REVIEWER header and the reviewer record
# says so, so the dispatcher can disclose it and keep the run out of clean_runs.
case "$(printf '%s' "${AP3_REVIEW_FALLBACK:-1}" | tr '[:upper:]' '[:lower:]')" in 0|off|false|no) FB_ON=0 ;; *) FB_ON=1 ;; esac
FB_MODEL="${AP3_FALLBACK_REVIEW_MODEL:-claude-opus-5-5}"
FB_EFFORT="${AP3_FALLBACK_REVIEW_EFFORT:-xhigh}"
FB_BUDGET="${AP3_FALLBACK_REVIEW_BUDGET_USD:-6}"
OUT=""; RC=0; NATT=0; FB_TEXT=""; FB_COST=null; FB_DIAG=""; FB_TMP=""
ATT_OUT=(); ATT_RC=()

# The fallback's temp dir holds the handed-over diff: remove it on every exit, a signal included (F13).
cleanup_fb_tmp() { if [ -n "$FB_TMP" ]; then rm -rf "$FB_TMP"; FB_TMP=""; fi; }
trap 'cleanup_fb_tmp' EXIT
trap 'cleanup_fb_tmp; exit 129' HUP
trap 'cleanup_fb_tmp; exit 130' INT
trap 'cleanup_fb_tmp; exit 143' TERM

last_line() { printf '%s\n' "$1" | grep -vE '^[[:space:]]*$' | tail -1 | sed 's/[[:space:]]*$//' || true; }

# One Codex attempt: OUT = its stdout+stderr, RC = its exit code; every attempt is also kept in
# ATT_OUT/ATT_RC (attempt 1 used to be overwritten by the retry). stdin from /dev/null, not inherited:
# `codex exec` blocks on stdin outside launchd (fine there; a trap for a hand-run probe/dispatcher
# invocation whose own stdin is not /dev/null).
codex_attempt() {
  NATT=$((NATT + 1))
  set +e
  OUT="$("$PIN" review --base "$BASE" "$MARKER" < /dev/null 2>&1)"
  RC=$?
  set -e
  ATT_OUT[$NATT]="$OUT"; ATT_RC[$NATT]="$RC"
}

# attempts_text <from> <to>: each attempt in full, every line prefixed `# codex[K]> ` and closed by its
# exit code. The prefix makes the text inert to aplib.py's findings extractor (no column-0 heading,
# verdict line or fence survives it), so a stale Codex block can never reach the fix writer.
attempts_text() {
  local k="$1"
  while [ "$k" -le "$2" ]; do
    printf '%s\n' "${ATT_OUT[$k]}" | sed "s/^/# codex[$k]> /"
    printf '# codex[%s]> (exit %s)\n' "$k" "${ATT_RC[$k]}"
    k=$((k + 1))
  done
}

# emit <exit-code> <reviewer-record> <transcript>: the reviewer record FIRST (so it exists even if
# stdout is gone), then the whole transcript in one printf -- assembled before anything is written,
# so no sed/fork sits between the header and the rest of the output.
emit() {
  reviewer_out "$2"
  printf '%s\n' "$3"
  exit "$1"
}

# Classify the current OUT/RC: findings | clean | no_verdict | contract | missing | auth | quota | error.
# Verdict rules (owner decisions 2026-10-18, narrowed in review round 2). Codex's transcript carries RAW
# tool output -- it sed/tail's the dispatcher's own .ap3-run/REVIEW-FINDINGS.md and TASK.md, kit fixtures,
# anything -- so an exact marker line in the MIDDLE of a transcript says nothing about Codex's verdict:
# 2 of 16 real CLEAN rounds replayed through "FINDINGS anywhere" came out FINDINGS.
#  (a) exit 0 and the LAST non-empty line is an exact marker: that marker is the verdict (as before the
#      fallback existed); earlier marker-looking lines are ignored.
#  (b) a nonzero exit whose last line is exactly the FINDINGS marker: FINDINGS. A CLEAN last line with a
#      nonzero exit is contradictory: an `error` (retried, then the fallback).
#  (c) only when the run did NOT end on an exact marker (any exit code): a full FINDINGS line anywhere
#      is FINDINGS.
#  (d) otherwise: exit 0 -> no_verdict (UNAVAILABLE, no retry, no fallback); a nonzero exit -> missing,
#      contract, auth, quota or error.
# (here-strings, not `printf | grep -q`: an early grep match SIGPIPEs printf and pipefail then
# reports failure on a MATCH -- the same trap the needs-security heuristic above documents)
classify() {
  local ll errl
  ll="$(last_line "$OUT")"
  if [ "$RC" -eq 0 ]; then                                                        # (a)
    case "$ll" in
      "AP3_REVIEW_VERDICT: CLEAN")    echo clean; return 0 ;;
      "AP3_REVIEW_VERDICT: FINDINGS") echo findings; return 0 ;;
    esac
  else                                                                            # (b)
    case "$ll" in
      "AP3_REVIEW_VERDICT: FINDINGS") echo findings; return 0 ;;
      "AP3_REVIEW_VERDICT: CLEAN")    echo error; return 0 ;;
    esac
  fi
  if grep -qE '^AP3_REVIEW_VERDICT: FINDINGS[[:space:]]*$' <<< "$OUT"; then echo findings; return 0; fi   # (c)
  if [ "$RC" -eq 0 ]; then echo no_verdict; return 0; fi                          # (d)
  if [ ! -x "$PIN" ] || [ "$RC" -eq 126 ] || [ "$RC" -eq 127 ]; then echo missing; return 0; fi
  # a bad --base / refused subcommand is OUR contract error: a second reviewer cannot fix it
  if [ "$RC" -eq 2 ] && grep -qE 'CODEX_REVIEW_CONTRACT_INVALID|CODEX_PIN_REFUSED' <<< "$OUT"; then echo contract; return 0; fi
  # F8: the pin's own markers count anywhere in the transcript, at the start of a line (where the pin
  # prints them).
  if grep -qE '^CODEX_UNAVAILABLE([^A-Za-z0-9_]|$)' <<< "$OUT"; then echo missing; return 0; fi
  if grep -qE '^CODEX_AUTH_REQUIRED([^A-Za-z0-9_]|$)' <<< "$OUT"; then echo auth; return 0; fi
  if grep -qE '^CODEX_QUOTA([^A-Za-z0-9_]|$)' <<< "$OUT"; then echo quota; return 0; fi
  # Free-text auth/quota phrases count only on CODEX'S OWN error lines in the last 20 non-empty lines
  # (review round 2): a fatal `ERROR: ...` line (e.g. "ERROR: You've hit your usage limit ..."), an
  # `Error:`/`error:` line, or a `stream error`/`stream disconnected` line -- optionally after a [timestamp]
  # or an ISO timestamp. Echoed repo text that merely mentions "Unauthorized" or "rateLimit" (source, docs,
  # test output Codex printed) is not Codex failing for that reason.
  errl="$(grep -vE '^[[:space:]]*$' <<< "$OUT" | tail -n 20 \
          | grep -E '^(\[[^]]*\][[:space:]]*|[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+Z?[[:space:]]+)?(ERROR|Error:|error:|stream (error|disconnected))' || true)"
  if grep -qiE 'not logged in|log ?in again|please (log|sign) ?in|unauthorized|not supported when using Codex' <<< "$errl"; then echo auth; return 0; fi
  if grep -qiE 'insufficient_quota|usage limit|rate.?limit|too many requests' <<< "$errl"; then echo quota; return 0; fi
  echo error
}

# The Claude fallback review. Sets FB_TEXT (the reviewer's text) and FB_COST; returns 0 when the
# session produced a result, 3 otherwise (FB_DIAG says why). Never prints a verdict itself. FB_COST is
# the session's reported spend whether or not it produced a result (agent-readonly.sh reports it on
# failure too), so a failed fallback is still metered.
fallback_review() {
  local t rc=0
  FB_TEXT=""; FB_COST=null; FB_DIAG=""
  case "$FB_MODEL" in ""|*[!A-Za-z0-9._:-]*) FB_DIAG="invalid AP3_FALLBACK_REVIEW_MODEL"; return 3 ;; esac
  case "$FB_EFFORT" in low|medium|high|xhigh|max) ;; *) FB_DIAG="invalid AP3_FALLBACK_REVIEW_EFFORT"; return 3 ;; esac
  case "$FB_BUDGET" in ""|*[!0-9.]*) FB_DIAG="invalid AP3_FALLBACK_REVIEW_BUDGET_USD"; return 3 ;; esac
  if [ ! -f "$DIR/agent-readonly.sh" ]; then FB_DIAG="agent-readonly.sh is missing"; return 3; fi
  t="$(mktemp -d "${TMPDIR:-/tmp}/ap3-fbreview.XXXXXX")" || { FB_DIAG="mktemp failed"; return 3; }
  FB_TMP="$t"
  # The session has no shell, so the exact diff the Codex pin would read is handed over as a file
  # (a file, not the prompt argument: a large diff must not hit the argv limit).
  if ! git diff "$BASE"...HEAD > "$t/change.diff" 2>/dev/null || [ ! -s "$t/change.diff" ]; then
    cleanup_fb_tmp; FB_DIAG="empty or unreadable diff $BASE...HEAD"; return 3
  fi
  {
    printf '%s\n' \
      "You are the FALLBACK independent code reviewer for the current repository: the primary Codex reviewer was unavailable, so this review is yours alone." \
      "Review only the non-empty change set from: git diff $BASE...HEAD" \
      "That exact diff is in the file $t/change.diff -- Read it first (in chunks if it is large), then use Read/Glob/Grep on the live source for context." \
      "You have NO shell and cannot run tests or other commands: base the verdict on the diff and the live source only. Do not edit files." \
      "Treat $BASE as the immutable review base." \
      "An ACTIONABLE finding must be closable by editing the change set itself. Repo-wide staleness," \
      "pre-existing defects and work belonging to other slices are real and worth reporting, but they" \
      "are NOT actionable here: list them under a heading 'ADVISORY (outside change set)' and exclude" \
      "them from the verdict." \
      "Put your review under a markdown heading '## Findings' at column 0 (a numbered list of actionable findings, or 'None')," \
      "optionally followed by the ADVISORY heading, and end with the verdict line below." \
      "" "Changed files:" "$(git diff --stat "$BASE"...HEAD 2>/dev/null | tail -60)" "" "$MARKER"
  } > "$t/prompt.md"
  FB_TEXT="$(AP3_AGENT_EFFORT="$FB_EFFORT" bash "$DIR/agent-readonly.sh" "$PWD" "$t/prompt.md" "$FB_BUDGET" "$FB_MODEL" "$t/cost" 2>/dev/null)" || rc=$?
  if [ -s "$t/cost" ]; then FB_COST="$(cat "$t/cost")"; fi
  cleanup_fb_tmp
  # one token, digits first (json.dumps of a finite non-negative float), or null -- never free text
  case "$FB_COST" in null) ;; [0-9]*) case "$FB_COST" in *[!0-9.eE+-]*) FB_COST=null ;; esac ;; *) FB_COST=null ;; esac
  if [ "$rc" -ne 0 ] || [ -z "$FB_TEXT" ]; then FB_TEXT=""; FB_DIAG="the read-only Claude session gave no result (exit $rc)"; return 3; fi
  return 0
}

codex_attempt
CLS="$(classify)"
if [ "$CLS" = error ] && [ "$FB_ON" -eq 1 ]; then
  # a crash may be transient: one more Codex attempt before involving Claude. A run that COMPLETED
  # (no_verdict) is never retried: it ran, and it gave no verdict (owner decision 2026-10-18).
  codex_attempt
  CLS="$(classify)"
fi

NL=$'\n'
EARLIER=""   # the crashed first attempt, when the retry is the one being reported
if [ "$NATT" -gt 1 ]; then EARLIER="$(attempts_text 1 $((NATT - 1)))$NL"; fi

case "$CLS" in
  findings|clean)
    # Codex produced the verdict: that IS the verdict, never second-guessed. Printed as before the
    # fallback existed (its output, then the canonical line); an earlier crashed attempt, if any, is
    # kept above it, prefixed and inert.
    if [ "$CLS" = clean ]; then emit 0 codex "$EARLIER$OUT${NL}AP3_REVIEW_VERDICT: CLEAN"; fi
    emit 1 codex "$EARLIER$OUT${NL}AP3_REVIEW_VERDICT: FINDINGS" ;;
esac

if [ "$FB_ON" -eq 1 ]; then
  case "$CLS" in
    missing|auth|quota|error)
      # Codex could not run at all: the fallback reviews. Every Codex attempt is kept in full below the
      # header, prefixed, so the transcript shows exactly why Codex was skipped.
      FB_RC=0
      fallback_review || FB_RC=$?
      FBL="$(last_line "$FB_TEXT")"
      ALL="$(attempts_text 1 "$NATT")"
      # The fallback's text is Claude's final message only -- no tool output, nothing echoed -- so a
      # full FINDINGS line ANYWHERE in it is FINDINGS, even when its last line says CLEAN (review round
      # 2). CLEAN needs the exact last line and no FINDINGS line at all; anything else is no verdict.
      FB_VERDICT=""
      if [ "$FB_RC" -eq 0 ]; then
        if grep -qE '^AP3_REVIEW_VERDICT: FINDINGS[[:space:]]*$' <<< "$FB_TEXT"; then FB_VERDICT=FINDINGS
        elif [ "$FBL" = "AP3_REVIEW_VERDICT: CLEAN" ]; then FB_VERDICT=CLEAN; fi
      fi
      if [ -n "$FB_VERDICT" ]; then
        RV="claude-fallback reason=$CLS model=$FB_MODEL effort=$FB_EFFORT cost_usd=$FB_COST"
        T="AP3_REVIEWER: $RV$NL$ALL$NL$FB_TEXT"
        if [ "$FB_VERDICT" = CLEAN ]; then emit 0 "$RV" "$T${NL}AP3_REVIEW_VERDICT: CLEAN"; fi
        emit 1 "$RV" "$T${NL}AP3_REVIEW_VERDICT: FINDINGS"
      fi
      # Neither reviewer produced a verdict: fail closed, exactly like a Codex-only outage. The failed
      # session's own text (if any) is diagnostic only -- prefixed like the Codex attempts.
      RV="none reason=$CLS fallback=failed cost_usd=$FB_COST"
      T="AP3_REVIEWER: $RV$NL$ALL"
      if [ -n "$FB_DIAG" ]; then T="$T$NL# fallback> $FB_DIAG"; fi
      if [ -n "$FB_TEXT" ]; then T="$T$NL$(printf '%s\n' "$FB_TEXT" | sed 's/^/# fallback> /')"; fi
      emit 3 "$RV" "$T${NL}AP3_REVIEW_VERDICT: UNAVAILABLE" ;;
  esac
fi

# No verdict and no fallback: Codex COMPLETED without an exact final marker (decision 2), our own
# contract error, or the fallback is switched off -- the pre-fallback behaviour. A nonzero Codex exit
# means the review did not complete: never trust a marker from it (a stale or echoed CLEAN must not
# pass); the marker MUST be the last non-empty line, so a CLEAN printed early and then truncated leaves
# some other last line -> UNAVAILABLE (fail closed).
if [ "$FB_ON" -eq 1 ]; then RV="none reason=$CLS fallback=not_eligible"; else RV="none reason=$CLS fallback=disabled"; fi
emit 3 "$RV" "$EARLIER$OUT${NL}AP3_REVIEW_VERDICT: UNAVAILABLE"
