#!/usr/bin/env bash
# Independent Codex review, run by the DISPATCHER (unsandboxed — codex cannot init inside
# the writer's Seatbelt; see W1-DECISION-codex-sandbox.md). Feeds the task spec + the
# base...HEAD diff to the pinned, read-only, ephemeral reviewer and prints a final line
#   AP3_REVIEW_VERDICT: CLEAN | FINDINGS | UNAVAILABLE
# Exit: 0 CLEAN, 1 FINDINGS, 3 UNAVAILABLE (reviewer gave no parseable verdict).
#
# Usage:
#   ap3/review.sh code|security --base <sha> [--task <file>]
#   ap3/review.sh needs-security --base <sha>      -> prints yes|no (heuristic, §6.6)
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$DIR/.." && pwd)"
PIN="${AP3_CODEX_PIN:-$REPO/scripts/codex-review-pin.sh}"

MODE="${1:-}"; shift || true
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
BASE="$(git rev-parse "$BASE")"   # expand a ref/short sha to the full sha the pin requires

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

case "$MODE" in code|security) ;; *) echo "review: mode must be code|security|needs-security" >&2; exit 2 ;; esac

if [ "$MODE" = security ]; then
  FOCUS="Focus on security: auth/permission bypass, secret handling, money/amount correctness, injection (shell/SQL), and unsafe handling of external input."
else
  FOCUS="Focus on correctness bugs, scope creep beyond the declared scope, and missing or weak tests for the acceptance criteria."
fi

# A per-slice review is fed the task spec (the authority for what the change must do). A kit
# self-review (no task) just reviews the diff for defects — --task is optional.
if [ -n "$TASK" ] && [ -f "$TASK" ]; then
  SPEC="$(printf '%s\n' \
    "The task spec below is the full authority for what this change must do and must NOT do (its declared scope is the ceiling)." \
    "Do not propose work outside the task's scope; treat pre-existing code outside the diff as ADVISORY." \
    "" "===== TASK SPEC =====" "$(cat "$TASK")" "===== END TASK SPEC =====")"
else
  SPEC="Review this diff for correctness, security, scope discipline and obvious defects. Treat pre-existing code outside the diff as ADVISORY."
fi

MARKER="$(printf '%s\n' \
  "You are the independent reviewer for an autonomous ap3 change." \
  "$FOCUS" \
  "$SPEC" \
  "" \
  "End your review with EXACTLY one of these as the final line:" \
  "AP3_REVIEW_VERDICT: CLEAN      (no actionable finding closable within the declared scope)" \
  "AP3_REVIEW_VERDICT: FINDINGS   (then a numbered list of actionable findings)")"

set +e
OUT="$("$PIN" review --base "$BASE" "$MARKER" 2>&1)"
RC=$?
set -e
printf '%s\n' "$OUT"

# Integrity: a nonzero reviewer exit means the review did not complete — never trust a marker
# from it (a stale/echoed CLEAN must not pass). `codex exec` exits 0 on any completed review;
# findings live in the text, not the exit code.
if [ "$RC" -ne 0 ]; then
  echo "AP3_REVIEW_VERDICT: UNAVAILABLE"; exit 3
fi
# The marker MUST be the reviewer's last non-empty line — codex is told to end with it, and it
# does. A CLEAN printed early then truncated leaves some other last line -> UNAVAILABLE (fail
# closed), so a cut-off review cannot pass.
LAST="$(printf '%s\n' "$OUT" | grep -vE '^[[:space:]]*$' | tail -1 | sed 's/[[:space:]]*$//' || true)"
case "$LAST" in
  "AP3_REVIEW_VERDICT: CLEAN")    echo "AP3_REVIEW_VERDICT: CLEAN";    exit 0 ;;
  "AP3_REVIEW_VERDICT: FINDINGS") echo "AP3_REVIEW_VERDICT: FINDINGS"; exit 1 ;;
  *)                              echo "AP3_REVIEW_VERDICT: UNAVAILABLE"; exit 3 ;;
esac
