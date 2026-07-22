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
#   1. Import state-machine: the shared canonical (~/.claude/shared/autopilot-invariants.md,
#      set up once per machine by the Claude template kit) is PRIORITY; this repo's bundled
#      copy (docs/autopilot-templates/autopilot-invariants.md) is a FALLBACK only used when the
#      shared canonical is missing/unreadable. Ensures exactly ONE active @import in
#      ~/.claude/CLAUDE.md at all times — repairs a missing import, and removes whichever
#      source is no longer the right one (never leaves two imports active).
#   2. If --codex given: append a guarded `export AUTOPILOT_CODEX_BIN=...` to ~/.zshrc.
#      (Without --codex it only CHECKS + prints instructions — never guesses the path.)
#   3. Point this clone's core.hooksPath at .githooks so the root-commit guard is live.
#      `.git/hooks` is not version-controlled, so without this step .githooks/pre-commit is inert
#      and concurrent sessions can again commit each other's staged files to main (eba1c27).
#      Never overwrites an existing non-default hooksPath — it warns instead.
#   4. Verify the per-repo kit files + a JSON tool (python3/node/jq) + scope-gate syntax.
# It does NOT codegen or run a review. The only git state it touches is this clone's local
# core.hooksPath (step 3) — never history, refs, index or working tree.
# Read docs/autopilot-ONBOARDING.md after.
#
# Written for the owner's macOS runtime: real /bin/bash 3.2 + BSD userland. No mapfile,
# no associative arrays, no ${var^^}. HOME is read from the environment (tests override it).
set -euo pipefail

# ---- args ----
CODEX_PATH=""; CHECK_ONLY=0
while [ $# -gt 0 ]; do
  case "$1" in
    --codex) CODEX_PATH="${2:-}"; shift 2 ;;
    --check) CHECK_ONLY=1; shift ;;
    -h|--help) sed -n '2,29p' "$0"; exit 0 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

# ---- locate repo + invariants ----
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
FALLBACK_TARGET="$REPO_ROOT/docs/autopilot-templates/autopilot-invariants.md"
GENERIC="$REPO_ROOT/docs/autopilot-templates/autopilot-prompt-GENERIC.md"

ok(){ printf '  \033[32mOK\033[0m   %s\n' "$1"; }
warn(){ printf '  \033[33mTODO\033[0m %s\n' "$1"; }
bad(){ printf '  \033[31mMISS\033[0m %s\n' "$1"; }

echo "Plexco autopilot onboarding — repo: $REPO_ROOT"
echo

EXIT_CODE=0

# =====================================================================================
# [1/4] Global invariants import state-machine → ~/.claude/CLAUDE.md
# =====================================================================================
echo "[1/4] Global invariants → \$HOME/.claude/CLAUDE.md"
if [ ! -f "$FALLBACK_TARGET" ]; then
  bad "invariants template missing: $FALLBACK_TARGET (is this the Plexco repo?)"; exit 1
fi

CLAUDE_DIR="${HOME}/.claude"; CLAUDE_MD="$CLAUDE_DIR/CLAUDE.md"
SHARED_CANONICAL="${HOME}/.claude/shared/autopilot-invariants.md"
CANONICAL_LINE="@~/.claude/shared/autopilot-invariants.md"
BEGIN="# >>> plexco-autopilot (managed by autopilot-onboard.sh) >>>"
END="# <<< plexco-autopilot (managed) <<<"
FALLBACK_LINE="@$FALLBACK_TARGET"

mkdir -p "$CLAUDE_DIR"
touch "$CLAUDE_MD"

# -- usability: `-r` follows symlinks and is false for missing/dangling/unreadable targets,
#    which doubles as our "correct target" check (an unusable link can't be the right target).
# NOTE: under `set -e`, a bare top-level `test && var=1` aborts the script when test is false
# (unlike inside an `if`) — always guard these with an explicit if/then.
shared_usable=0
if [ -r "$SHARED_CANONICAL" ]; then shared_usable=1; fi
fallback_usable=0
if [ -r "$FALLBACK_TARGET" ]; then fallback_usable=1; fi

# -- malformed-block detection: must run before any mutation and abort untouched if tripped.
begin_count=$(grep -cxF "$BEGIN" "$CLAUDE_MD" || true)
end_count=$(grep -cxF "$END" "$CLAUDE_MD" || true)
malformed=0
if [ "$begin_count" -gt 1 ] || [ "$end_count" -gt 1 ]; then
  malformed=1
elif [ "$begin_count" -eq 1 ] && [ "$end_count" -ne 1 ]; then
  malformed=1
elif [ "$begin_count" -eq 0 ] && [ "$end_count" -eq 1 ]; then
  malformed=1
elif [ "$begin_count" -eq 1 ] && [ "$end_count" -eq 1 ]; then
  # exactly one BEGIN/END pair: the block body must be EXACTLY one line, the fallback import.
  block_body=$(awk -v b="$BEGIN" -v e="$END" '
    $0==b{s=1; next} $0==e{s=0} s{print}
  ' "$CLAUDE_MD")
  block_lines=$(printf '%s\n' "$block_body" | grep -c . || true)
  if [ "$block_lines" -ne 1 ] || [ "$block_body" != "$FALLBACK_LINE" ]; then
    malformed=1
  fi
fi

if [ "$malformed" -eq 1 ]; then
  bad "managed block in $CLAUDE_MD is malformed (unexpected BEGIN/END shape) — not touching it."
  echo "  Fix or remove the '# >>> plexco-autopilot ... <<<' block by hand, then re-run."
  exit 1
fi

valid_fallback_present=0
if [ "$begin_count" -eq 1 ] && [ "$end_count" -eq 1 ]; then valid_fallback_present=1; fi
canonical_active=0
if grep -qxF "$CANONICAL_LINE" "$CLAUDE_MD"; then canonical_active=1; fi

if [ "$shared_usable" -eq 0 ] && [ "$fallback_usable" -eq 0 ]; then
  bad "neither the shared canonical ($SHARED_CANONICAL) nor this repo's bundled copy"
  bad "($FALLBACK_TARGET) is readable — nothing usable to import."
  exit 1
fi

if [ "$CHECK_ONLY" -eq 1 ]; then
  if [ "$shared_usable" -eq 1 ]; then
    if [ "$canonical_active" -eq 1 ] && [ "$valid_fallback_present" -eq 0 ]; then
      ok "canonical import active (sole import) — shared canonical is usable"
    else
      bad "expected sole canonical import; found canonical_active=$canonical_active fallback_present=$valid_fallback_present — run without --check"
      EXIT_CODE=1
    fi
  else
    if [ "$valid_fallback_present" -eq 1 ] && [ "$canonical_active" -eq 0 ]; then
      ok "fallback import active (sole import) — shared canonical unusable, repo copy in use"
    else
      bad "expected sole fallback import; found canonical_active=$canonical_active fallback_present=$valid_fallback_present — run without --check"
      EXIT_CODE=1
    fi
  fi
else
  if [ "$shared_usable" -eq 1 ]; then
    # Row 1: shared canonical usable -> it is priority. Ensure sole canonical import, drop fallback.
    if [ "$canonical_active" -eq 0 ]; then
      if [ -s "$CLAUDE_MD" ]; then
        last_char="$(tail -c1 "$CLAUDE_MD")"
        if [ "$last_char" != "" ]; then printf '\n' >> "$CLAUDE_MD"; fi
      fi
      printf '%s\n' "$CANONICAL_LINE" >> "$CLAUDE_MD"
      ok "added canonical import to $CLAUDE_MD"
    else
      ok "canonical import already present in $CLAUDE_MD"
    fi
    if [ "$valid_fallback_present" -eq 1 ]; then
      TMP="$CLAUDE_MD.tmp.$$"
      awk -v b="$BEGIN" -v e="$END" '$0==b{s=1} !s{print} $0==e{s=0}' "$CLAUDE_MD" > "$TMP" && mv "$TMP" "$CLAUDE_MD" || { rm -f "$TMP"; exit 1; }
      ok "removed superseded plexco-autopilot managed fallback block"
    fi
  else
    # Row 2: shared canonical unusable, fallback usable -> ensure sole fallback block, drop canonical line.
    if [ "$valid_fallback_present" -eq 0 ]; then
      { printf '\n%s\n' "$BEGIN"; printf '%s\n' "$FALLBACK_LINE"; printf '%s\n' "$END"; } >> "$CLAUDE_MD"
      ok "appended managed fallback block to $CLAUDE_MD"
    else
      ok "managed fallback block already present in $CLAUDE_MD"
    fi
    if [ "$canonical_active" -eq 1 ]; then
      TMP="$CLAUDE_MD.tmp.$$"
      grep -vxF "$CANONICAL_LINE" "$CLAUDE_MD" > "$TMP" && mv "$TMP" "$CLAUDE_MD" || { rm -f "$TMP"; exit 1; }
      ok "removed unusable canonical import line (shared canonical not readable on this machine)"
    fi
  fi
fi

# =====================================================================================
# [2/4] AUTOPILOT_CODEX_BIN (per-machine)
# =====================================================================================
echo "[2/4] Cross-model review binary → AUTOPILOT_CODEX_BIN"
ZSHRC="${HOME}/.zshrc"
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

# =====================================================================================
# [3/4] root-commit hook path (per-CLONE — cannot live in the repo)
# =====================================================================================
# `.git/hooks` is not version-controlled, so the guard lives in `.githooks/` and each clone must
# be pointed at it. Without this, `.githooks/pre-commit` is inert and concurrent sessions can
# again commit each other's staged files to main (incident 2026-07-22, eba1c27).
echo "[3/4] Root-commit guard → core.hooksPath"
HOOKS_CURRENT="$(git -C "$REPO_ROOT" config --local --get core.hooksPath 2>/dev/null || true)"
if [ ! -e "$REPO_ROOT/.githooks/pre-commit" ]; then
  bad ".githooks/pre-commit missing — pull latest main"
  EXIT_CODE=1
elif [ "$HOOKS_CURRENT" = ".githooks" ]; then
  ok "core.hooksPath = .githooks"
elif [ "$CHECK_ONLY" -eq 1 ]; then
  warn "core.hooksPath is '${HOOKS_CURRENT:-<unset>}' — run without --check, or: git config core.hooksPath .githooks"
elif [ -n "$HOOKS_CURRENT" ]; then
  # Someone pointed this clone somewhere else on purpose; overwriting silently would be the same
  # class of surprise this guard exists to prevent.
  warn "core.hooksPath is already '$HOOKS_CURRENT' — leaving it alone. Set it yourself if intended:"
  warn "  git config core.hooksPath .githooks"
else
  git -C "$REPO_ROOT" config core.hooksPath .githooks
  ok "core.hooksPath set to .githooks (commits to main from the root copy now require the lock)"
fi

# =====================================================================================
# [4/4] verify per-repo kit + tooling
# =====================================================================================
echo "[4/4] Verify per-repo kit"
miss=0
for f in \
  "scripts/autopilot-scope-gate" \
  "scripts/autopilot-root-lock" \
  ".githooks/pre-commit" \
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
if [ -e "$REPO_ROOT/scripts/autopilot-scope-gate" ]; then
  if bash -n "$REPO_ROOT/scripts/autopilot-scope-gate" 2>/dev/null; then ok "scope-gate syntax clean"; else bad "scope-gate has a syntax error"; miss=1; fi
fi
if [ "$miss" -ne 0 ]; then echo; echo "Some kit files are missing — pull latest main."; EXIT_CODE=1; fi

echo
echo "Done. Next:"
echo "  • Read   docs/autopilot-ONBOARDING.md   (mental model + per-task lifecycle)"
echo "  • Prompt template: docs/autopilot-templates/autopilot-prompt-GENERIC.md (v0.6.0)"
echo "  • If TODO above: source ~/.zshrc (codex) and/or restart Claude Code so CLAUDE.md reloads."
exit "$EXIT_CODE"
