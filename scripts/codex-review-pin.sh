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
  exec "$REAL_BIN" "${PIN_FLAGS[@]}" review "$@"
fi

exec "$REAL_BIN" "$@"
