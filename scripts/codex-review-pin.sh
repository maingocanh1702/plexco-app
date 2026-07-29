#!/usr/bin/env bash
# KIT_VERSION: 1
# Repo-agnostic pinned Codex wrapper for Level 3 independent review.
set -euo pipefail

REAL_BIN="${AUTOPILOT_CODEX_REAL_BIN:-$HOME/.npm-global/bin/codex}"
REVIEW_MODEL="${AUTOPILOT_CODEX_REVIEW_MODEL:-gpt-5.6-sol}"
REVIEW_EFFORT="${AUTOPILOT_CODEX_REVIEW_EFFORT:-xhigh}"
REVIEW_TIER="${AUTOPILOT_CODEX_REVIEW_TIER:-priority}"

[ -x "$REAL_BIN" ] || {
  echo "CODEX_UNAVAILABLE: set AUTOPILOT_CODEX_REAL_BIN to an executable Codex CLI" >&2
  exit 1
}

PIN_FLAGS=(
  -m "$REVIEW_MODEL"
  -c "model_reasoning_effort=\"$REVIEW_EFFORT\""
  -c "service_tier=\"$REVIEW_TIER\""
  -c "mcp_servers={}"
)

if [ "${1:-}" = "review" ]; then
  shift
  # Codex CLI 0.144.5 exposes a [PROMPT] in `review --help` but rejects a custom prompt when
  # --base/--commit/--uncommitted is also present. The Level 3 gate needs both an immutable base
  # and exact verdict markers, so adapt that one stable contract to a read-only ephemeral exec.
  # Other review invocations retain the native subcommand.
  if [ "${1:-}" = "--base" ] && [ "$#" -eq 3 ]; then
    REVIEW_BASE="$2"
    MARKER_PROMPT="$3"
    case "$REVIEW_BASE" in
      ""|*[!0-9a-fA-F]*)
        echo "CODEX_REVIEW_CONTRACT_INVALID: --base must be a full commit SHA" >&2
        exit 2
        ;;
    esac
    case "${#REVIEW_BASE}" in
      40|64) ;;
      *)
        echo "CODEX_REVIEW_CONTRACT_INVALID: --base must be a full commit SHA" >&2
        exit 2
        ;;
    esac
    case "$REVIEW_BASE" in
      *[1-9a-fA-F]*) ;;
      *)
        echo "CODEX_REVIEW_CONTRACT_INVALID: --base must be a real nonzero commit SHA" >&2
        exit 2
        ;;
    esac
    PINNED_REVIEW_PROMPT="$(
      printf '%s\n' \
        "Act as the independent code reviewer for the current repository." \
        "Review only the non-empty change set from: git diff $REVIEW_BASE...HEAD" \
        "Treat $REVIEW_BASE as the immutable review base. Do not edit files or mutate repository state." \
        "Inspect live source and run read-only verification needed to support the verdict." \
        "" \
        "$MARKER_PROMPT"
    )"
    exec "$REAL_BIN" "${PIN_FLAGS[@]}" exec --sandbox read-only --ephemeral "$PINNED_REVIEW_PROMPT"
  fi
  exec "$REAL_BIN" "${PIN_FLAGS[@]}" review "$@"
fi

exec "$REAL_BIN" "$@"
