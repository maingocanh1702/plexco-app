#!/usr/bin/env bash
# Fixture tests for autopilot-onboard.sh's import state-machine (shared canonical priority,
# repo fallback, exactly-one-active-import). Runs entirely against temp HOME dirs — never
# touches the real ~/.claude/CLAUDE.md. Must run under real /bin/bash (3.2-safe, no bashisms).
#
#   /bin/bash scripts/autopilot-onboard-fixtures.sh
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ONBOARD="$REPO_ROOT/scripts/autopilot-onboard.sh"
BEGIN="# >>> plexco-autopilot (managed by autopilot-onboard.sh) >>>"
END="# <<< plexco-autopilot (managed) <<<"
CANONICAL_LINE_TEMPLATE="@~/.claude/shared/autopilot-invariants.md"
LOG="/tmp/plexco-onboard-fixture-lastrun.log"

PASS=0
FAIL=0

assert_true() {
  # assert_true <description> <condition-as-shell-test-args...>
  local desc="$1"; shift
  if "$@"; then
    PASS=$((PASS+1))
    printf '  \033[32mPASS\033[0m %s\n' "$desc"
  else
    FAIL=$((FAIL+1))
    printf '  \033[31mFAIL\033[0m %s\n' "$desc"
  fi
}

assert_eq() {
  local desc="$1" expected="$2" actual="$3"
  if [ "$expected" = "$actual" ]; then
    PASS=$((PASS+1))
    printf '  \033[32mPASS\033[0m %s\n' "$desc"
  else
    FAIL=$((FAIL+1))
    printf '  \033[31mFAIL\033[0m %s (expected [%s], got [%s])\n' "$desc" "$expected" "$actual"
  fi
}

new_home() {
  local h
  h="$(mktemp -d /tmp/plexco-onboard-fixture-home.XXXXXX)"
  mkdir -p "$h/.claude"
  printf '%s\n' "$h"
}

make_shared_usable() {
  local home="$1"
  mkdir -p "$home/.claude/shared"
  printf '# scratch shared canonical\n- some rule\n' > "$home/.claude/shared/autopilot-invariants.md"
}

run_onboard() {
  # run_onboard <home> [--check]  -> sets $LAST_EXIT
  local home="$1"; shift
  HOME="$home" /bin/bash "$ONBOARD" "$@" >"$LOG" 2>&1
  LAST_EXIT=$?
}

echo "=== Fixture 1: canonical-import-missing repair (shared usable, nothing present) ==="
H1="$(new_home)"
make_shared_usable "$H1"
printf '# my CLAUDE.md\nsome other content\n' > "$H1/.claude/CLAUDE.md"
run_onboard "$H1"
assert_eq   "fixture1: apply exits 0" "0" "$LAST_EXIT"
assert_true "fixture1: canonical import line present" grep -qxF "$CANONICAL_LINE_TEMPLATE" "$H1/.claude/CLAUDE.md"
assert_true "fixture1: no managed BEGIN block leaked in" bash -c "! grep -qxF '$BEGIN' '$H1/.claude/CLAUDE.md'"
run_onboard "$H1" --check
assert_eq   "fixture1: --check passes after repair" "0" "$LAST_EXIT"

echo
echo "=== Fixture 2: fallback-block-missing repair (shared unusable, nothing present) ==="
H2="$(new_home)"
# deliberately do NOT create $H2/.claude/shared/... -> shared_usable=0
printf '# my CLAUDE.md\n' > "$H2/.claude/CLAUDE.md"
run_onboard "$H2"
assert_eq   "fixture2: apply exits 0" "0" "$LAST_EXIT"
assert_true "fixture2: BEGIN marker present" grep -qxF "$BEGIN" "$H2/.claude/CLAUDE.md"
assert_true "fixture2: END marker present" grep -qxF "$END" "$H2/.claude/CLAUDE.md"
assert_true "fixture2: fallback import line present" grep -qF "$REPO_ROOT/docs/autopilot-templates/autopilot-invariants.md" "$H2/.claude/CLAUDE.md"
assert_true "fixture2: no canonical line leaked in" bash -c "! grep -qxF '$CANONICAL_LINE_TEMPLATE' '$H2/.claude/CLAUDE.md'"
run_onboard "$H2" --check
assert_eq   "fixture2: --check passes after repair" "0" "$LAST_EXIT"

echo
echo "=== Fixture 3a: double-import cleanup (shared usable, BOTH already active -> keep canonical) ==="
H3A="$(new_home)"
make_shared_usable "$H3A"
{
  printf '# my CLAUDE.md\n'
  printf '%s\n' "$CANONICAL_LINE_TEMPLATE"
  printf '%s\n' "$BEGIN"
  printf '@%s/docs/autopilot-templates/autopilot-invariants.md\n' "$REPO_ROOT"
  printf '%s\n' "$END"
} > "$H3A/.claude/CLAUDE.md"
run_onboard "$H3A"
assert_eq   "fixture3a: apply exits 0" "0" "$LAST_EXIT"
assert_true "fixture3a: canonical import remains" grep -qxF "$CANONICAL_LINE_TEMPLATE" "$H3A/.claude/CLAUDE.md"
assert_true "fixture3a: managed block removed" bash -c "! grep -qxF '$BEGIN' '$H3A/.claude/CLAUDE.md'"
canon_n=$(grep -cxF "$CANONICAL_LINE_TEMPLATE" "$H3A/.claude/CLAUDE.md" 2>/dev/null || true)
assert_eq   "fixture3a: exactly one active import remains" "1" "$canon_n"
run_onboard "$H3A" --check
assert_eq   "fixture3a: --check passes after cleanup" "0" "$LAST_EXIT"

echo
echo "=== Fixture 3b: double-import cleanup mirror (shared UNusable, BOTH active -> keep fallback) ==="
H3B="$(new_home)"
# no shared canonical created -> shared_usable=0
{
  printf '# my CLAUDE.md\n'
  printf '%s\n' "$CANONICAL_LINE_TEMPLATE"
  printf '%s\n' "$BEGIN"
  printf '@%s/docs/autopilot-templates/autopilot-invariants.md\n' "$REPO_ROOT"
  printf '%s\n' "$END"
} > "$H3B/.claude/CLAUDE.md"
run_onboard "$H3B"
assert_eq   "fixture3b: apply exits 0" "0" "$LAST_EXIT"
assert_true "fixture3b: fallback block remains" grep -qxF "$BEGIN" "$H3B/.claude/CLAUDE.md"
assert_true "fixture3b: unusable canonical line removed" bash -c "! grep -qxF '$CANONICAL_LINE_TEMPLATE' '$H3B/.claude/CLAUDE.md'"
run_onboard "$H3B" --check
assert_eq   "fixture3b: --check passes after cleanup" "0" "$LAST_EXIT"

echo
echo "=== Fixture 4: malformed-block no-mutation ==="
H4="$(new_home)"
make_shared_usable "$H4"
{
  printf '# my CLAUDE.md\n'
  printf '%s\n' "$BEGIN"
  printf 'some unexpected extra line\n'
  printf '@%s/docs/autopilot-templates/autopilot-invariants.md\n' "$REPO_ROOT"
  printf '%s\n' "$END"
} > "$H4/.claude/CLAUDE.md"
before_sha=$(shasum -a 256 "$H4/.claude/CLAUDE.md" | awk '{print $1}')
run_onboard "$H4"
assert_true "fixture4: apply exits non-zero on malformed block" bash -c "[ $LAST_EXIT -ne 0 ]"
after_sha=$(shasum -a 256 "$H4/.claude/CLAUDE.md" | awk '{print $1}')
assert_eq   "fixture4: CLAUDE.md byte-unchanged after failed apply" "$before_sha" "$after_sha"
run_onboard "$H4" --check
assert_true "fixture4: --check ALSO exits non-zero on malformed block" bash -c "[ $LAST_EXIT -ne 0 ]"
after_check_sha=$(shasum -a 256 "$H4/.claude/CLAUDE.md" | awk '{print $1}')
assert_eq   "fixture4: CLAUDE.md byte-unchanged after --check too" "$before_sha" "$after_check_sha"

echo
echo "=== Fixture 4b: malformed variant — BEGIN with no END (truncated block) ==="
H4B="$(new_home)"
make_shared_usable "$H4B"
{
  printf '# my CLAUDE.md\n'
  printf '%s\n' "$BEGIN"
  printf '@%s/docs/autopilot-templates/autopilot-invariants.md\n' "$REPO_ROOT"
} > "$H4B/.claude/CLAUDE.md"
before_sha_b=$(shasum -a 256 "$H4B/.claude/CLAUDE.md" | awk '{print $1}')
run_onboard "$H4B"
assert_true "fixture4b: apply exits non-zero (BEGIN w/o END)" bash -c "[ $LAST_EXIT -ne 0 ]"
after_sha_b=$(shasum -a 256 "$H4B/.claude/CLAUDE.md" | awk '{print $1}')
assert_eq   "fixture4b: CLAUDE.md byte-unchanged (BEGIN w/o END)" "$before_sha_b" "$after_sha_b"

echo
echo "=== Fixture 5: second-apply byte equality (idempotency) ==="
H5="$(new_home)"
make_shared_usable "$H5"
printf '# my CLAUDE.md\nunrelated content here\n' > "$H5/.claude/CLAUDE.md"
run_onboard "$H5"
first_exit=$LAST_EXIT
first_sha=$(shasum -a 256 "$H5/.claude/CLAUDE.md" | awk '{print $1}')
run_onboard "$H5"
second_exit=$LAST_EXIT
second_sha=$(shasum -a 256 "$H5/.claude/CLAUDE.md" | awk '{print $1}')
assert_eq   "fixture5: first apply exits 0" "0" "$first_exit"
assert_eq   "fixture5: second apply exits 0" "0" "$second_exit"
assert_eq   "fixture5: byte-identical after second apply" "$first_sha" "$second_sha"

echo
echo "=== Bonus fixture 6: both shared and fallback unusable -> fail before mutation ==="
NOFALLBACK_COPY="/tmp/plexco-onboard-fixture-nofallback"
rm -rf "$NOFALLBACK_COPY"
mkdir -p "$NOFALLBACK_COPY/scripts" "$NOFALLBACK_COPY/docs/autopilot-templates"
cp "$ONBOARD" "$NOFALLBACK_COPY/scripts/autopilot-onboard.sh"
printf 'placeholder\n' > "$NOFALLBACK_COPY/docs/autopilot-templates/autopilot-invariants.md"
chmod 000 "$NOFALLBACK_COPY/docs/autopilot-templates/autopilot-invariants.md"
H6="$(new_home)"
# no shared canonical either
printf '# my CLAUDE.md\n' > "$H6/.claude/CLAUDE.md"
before_sha6=$(shasum -a 256 "$H6/.claude/CLAUDE.md" | awk '{print $1}')
HOME="$H6" /bin/bash "$NOFALLBACK_COPY/scripts/autopilot-onboard.sh" >"$LOG" 2>&1
LAST_EXIT=$?
assert_true "fixture6: apply exits non-zero (both unusable)" bash -c "[ $LAST_EXIT -ne 0 ]"
after_sha6=$(shasum -a 256 "$H6/.claude/CLAUDE.md" | awk '{print $1}')
assert_eq   "fixture6: CLAUDE.md byte-unchanged (both unusable)" "$before_sha6" "$after_sha6"
chmod 644 "$NOFALLBACK_COPY/docs/autopilot-templates/autopilot-invariants.md"
rm -rf "$NOFALLBACK_COPY"

echo
echo "=== Bonus fixture 7: --check catches a currently-broken double-import (regression for the real bug found) ==="
H7="$(new_home)"
make_shared_usable "$H7"
{
  printf '# my CLAUDE.md\n'
  printf '%s\n' "$CANONICAL_LINE_TEMPLATE"
  printf '%s\n' "$BEGIN"
  printf '@%s/docs/autopilot-templates/autopilot-invariants.md\n' "$REPO_ROOT"
  printf '%s\n' "$END"
} > "$H7/.claude/CLAUDE.md"
run_onboard "$H7" --check
assert_true "fixture7: --check exits NON-ZERO on live double-import (not just a warning)" bash -c "[ $LAST_EXIT -ne 0 ]"

# cleanup temp home dirs from this run
rm -rf /tmp/plexco-onboard-fixture-home.*

echo
echo "================================================================"
echo "RESULTS: $PASS passed, $FAIL failed"
echo "================================================================"
[ "$FAIL" -eq 0 ]
