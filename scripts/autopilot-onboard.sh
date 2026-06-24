#!/usr/bin/env bash
# autopilot-onboard.sh — one-shot machine setup for a new dev joining Plexco autopilot.
# Idempotent + safe: re-running it never duplicates anything; it only writes the two
# per-MACHINE pieces that can't live in the repo, then verifies the per-repo kit.
#
#   scripts/autopilot-onboard.sh                 # wire CLAUDE.md import + verify kit
#   scripts/autopilot-onboard.sh --codex /abs/path/to/codex   # also pin AUTOPILOT_CODEX_BIN in ~/.zshrc
#   scripts/autopilot-onboard.sh --check         # verify only, write nothing
#
# What it does:
#   1. @import this repo's invariants into ~/.claude/CLAUDE.md (managed block, idempotent).
#   2. If --codex given: append a guarded `export AUTOPILOT_CODEX_BIN=...` to ~/.zshrc.
#      (Without --codex it only CHECKS + prints instructions — never guesses the path.)
#   3. Verify the per-repo kit files + a JSON tool (python3/node/jq) + scope-gate syntax.
# It does NOT codegen, touch git, or run a review. Read docs/autopilot-ONBOARDING.md after.
set -euo pipefail

# ---- args ----
CODEX_PATH=""; CHECK_ONLY=0
while [ $# -gt 0 ]; do
  case "$1" in
    --codex) CODEX_PATH="${2:-}"; shift 2 ;;
    --check) CHECK_ONLY=1; shift ;;
    -h|--help) sed -n '2,18p' "$0"; exit 0 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

# ---- locate repo + invariants ----
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
INVARIANTS="$REPO_ROOT/docs/autopilot-templates/autopilot-invariants.md"
GENERIC="$REPO_ROOT/docs/autopilot-templates/autopilot-prompt-GENERIC.md"

ok(){ printf '  \033[32mOK\033[0m   %s\n' "$1"; }
warn(){ printf '  \033[33mTODO\033[0m %s\n' "$1"; }
bad(){ printf '  \033[31mMISS\033[0m %s\n' "$1"; }

echo "Plexco autopilot onboarding — repo: $REPO_ROOT"
echo

# ---- 1) CLAUDE.md @import (per-machine) ----
echo "[1/3] Global invariants → ~/.claude/CLAUDE.md"
if [ ! -f "$INVARIANTS" ]; then
  bad "invariants template missing: $INVARIANTS (is this the Plexco repo?)"; exit 1
fi
CLAUDE_DIR="$HOME/.claude"; CLAUDE_MD="$CLAUDE_DIR/CLAUDE.md"
BEGIN="# >>> plexco-autopilot (managed by autopilot-onboard.sh) >>>"
END="# <<< plexco-autopilot (managed) <<<"
IMPORT_LINE="@$INVARIANTS"
if [ "$CHECK_ONLY" -eq 1 ]; then
  if [ -f "$CLAUDE_MD" ] && grep -qF "$IMPORT_LINE" "$CLAUDE_MD"; then ok "import present in $CLAUDE_MD"
  else warn "not imported yet — run without --check"; fi
else
  mkdir -p "$CLAUDE_DIR"; touch "$CLAUDE_MD"
  if grep -qF "$IMPORT_LINE" "$CLAUDE_MD"; then
    ok "import already present in $CLAUDE_MD"
  else
    # drop any stale managed block, then append a fresh one
    if grep -qF "$BEGIN" "$CLAUDE_MD"; then
      awk -v b="$BEGIN" -v e="$END" '$0==b{s=1} !s{print} $0==e{s=0}' "$CLAUDE_MD" > "$CLAUDE_MD.tmp" && mv "$CLAUDE_MD.tmp" "$CLAUDE_MD"
    fi
    { printf '\n%s\n' "$BEGIN"; printf '%s\n' "$IMPORT_LINE"; printf '%s\n' "$END"; } >> "$CLAUDE_MD"
    ok "appended @import to $CLAUDE_MD"
  fi
fi

# ---- 2) AUTOPILOT_CODEX_BIN (per-machine) ----
echo "[2/3] Cross-model review binary → AUTOPILOT_CODEX_BIN"
ZSHRC="$HOME/.zshrc"
if [ -n "$CODEX_PATH" ]; then
  if [ ! -x "$CODEX_PATH" ]; then bad "--codex '$CODEX_PATH' is not an executable file"; exit 1; fi
  EXPORT_LINE="export AUTOPILOT_CODEX_BIN=\"$CODEX_PATH\""
  if [ "$CHECK_ONLY" -eq 1 ]; then warn "--check given, not writing ~/.zshrc"
  elif grep -qF "$EXPORT_LINE" "$ZSHRC" 2>/dev/null; then ok "already in $ZSHRC"
  else
    { printf '\n%s\n%s\n%s\n' "$BEGIN" "$EXPORT_LINE" "$END"; } >> "$ZSHRC"
    ok "added to $ZSHRC — run: source ~/.zshrc  (or open a new terminal)"
  fi
elif [ -n "${AUTOPILOT_CODEX_BIN:-}" ] && [ -x "${AUTOPILOT_CODEX_BIN:-}" ]; then
  ok "AUTOPILOT_CODEX_BIN already set → $AUTOPILOT_CODEX_BIN"
elif grep -q 'AUTOPILOT_CODEX_BIN' "$ZSHRC" 2>/dev/null; then
  warn "found AUTOPILOT_CODEX_BIN in ~/.zshrc but not active in THIS shell — run: source ~/.zshrc"
else
  warn "not set. Re-run with: scripts/autopilot-onboard.sh --codex /abs/path/to/codex"
  warn "(unset → flow HALTs CODEX_UNAVAILABLE by design; never self-review as a substitute)"
fi

# ---- 3) verify per-repo kit + tooling ----
echo "[3/3] Verify per-repo kit"
miss=0
for f in \
  "scripts/autopilot-scope-gate" \
  "docs/autopilot-ONBOARDING.md" \
  "docs/autopilot-invariant-catalog.md" \
  "docs/autopilot-backlog.md" \
  "docs/autopilot-parallel-scope-gate.md" \
  "docs/autopilot-manifests/_TEMPLATE.json" \
  "docs/autopilot-templates/autopilot-prompt-GENERIC.md" \
  ".autopilot/maturity-ledger.md" ; do
  if [ -e "$REPO_ROOT/$f" ]; then ok "$f"; else bad "$f"; miss=1; fi
done
if command -v python3 >/dev/null 2>&1 || command -v node >/dev/null 2>&1 || command -v jq >/dev/null 2>&1; then
  ok "JSON tool present (python3/node/jq) — scope-gate can parse manifests"
else warn "install one of python3 / node / jq so scope-gate can parse manifest JSON"; fi
if bash -n "$REPO_ROOT/scripts/autopilot-scope-gate" 2>/dev/null; then ok "scope-gate syntax clean"; else bad "scope-gate has a syntax error"; miss=1; fi
[ "$miss" -eq 0 ] || { echo; echo "Some kit files are missing — pull latest main."; exit 1; }

echo
echo "Done. Next:"
echo "  • Read   docs/autopilot-ONBOARDING.md   (mental model + per-task lifecycle)"
echo "  • Prompt template: docs/autopilot-templates/autopilot-prompt-GENERIC.md (v0.4.8)"
echo "  • If TODO above: source ~/.zshrc (codex) and/or restart Claude Code so CLAUDE.md reloads."
