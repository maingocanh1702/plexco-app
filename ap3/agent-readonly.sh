#!/usr/bin/env bash
# W6: run ONE read-only `claude -p` session (Read/Glob/Grep only, dontAsk, no settings sources,
# native budget cap) in a given directory and print the model's final text to stdout. Shared by
# preflight.sh (I1) and resolve.sh (I3). The caller owns the prompt and the marker contract.
#   ap3/agent-readonly.sh <cwd> <prompt-file> <budget_usd> <model> <cost-out-file>
# Exit 0 with the text on stdout; exit 3 (nothing printed) when the session failed to produce a
# parseable result -- the caller treats that as UNAVAILABLE, never as a verdict.
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CWD="${1:?cwd}"; PROMPT_FILE="${2:?prompt}"; BUDGET="${3:?budget}"; MODEL="${4:?model}"; COST_OUT="${5:?cost-out}"
CBIN="${AP3_CLAUDE_BIN:-claude}"
# W6 review round (security 1): the session reads untrusted task/source content, so it runs under
# the SAME sandbox + denyRead the writer does, granting only Read/Glob/Grep -- a prompt-injected
# "read ~/.ssh and print it" cannot reach a secret. --setting-sources '' still stops the target's
# own .claude/settings from loosening it. Fail closed if the contract is missing (never fall back
# to an unhardened session that has the owner's full filesystem).
RS="${AP3_READONLY_SETTINGS:-$DIR/settings.readonly.json}"
if [ ! -f "$RS" ]; then echo "agent-readonly: read-only settings contract $RS is missing -- refusing to start an unhardened session" >&2; exit 3; fi
RAW="$(mktemp)"
trap 'rm -f "$RAW"' EXIT
set +e
( cd "$CWD" && "$CBIN" -p "$(cat "$PROMPT_FILE")" \
    --allowedTools "Read,Glob,Grep" --permission-mode dontAsk --settings "$RS" --setting-sources '' \
    --max-budget-usd "$BUDGET" --model "$MODEL" --output-format json ) > "$RAW" 2>/dev/null < /dev/null
RC=$?
set -e
# W6 review round (code 1 / security 2): a non-zero exit, or a budget/error envelope whose text
# merely ENDS with a valid marker, must NOT be trusted. Require exit 0 AND is_error:false AND a
# success subtype AND a finite non-negative cost, before the result text is emitted at all.
[ "$RC" -eq 0 ] || exit 3
# The JSON envelope carries the text in .result and the cost in .total_cost_usd. Anything else --
# empty output, malformed JSON, a missing result -- is UNAVAILABLE (exit 3), never a verdict.
python3 - "$RAW" "$COST_OUT" <<'PY' || exit 3
import json, sys, math
try:
    d = json.load(open(sys.argv[1], encoding="utf-8"))
except Exception:
    sys.exit(3)
if not isinstance(d, dict) or not isinstance(d.get("result"), str) or not d["result"].strip():
    sys.exit(3)
# an errored or non-success envelope is UNAVAILABLE even if its text ends with a valid marker
if d.get("is_error") is True:
    sys.exit(3)
if d.get("subtype") not in (None, "success"):   # success or unset; anything else (error_max_turns, error_during_execution, ...) is not trusted
    sys.exit(3)
cost = d.get("total_cost_usd")
if cost is not None and (not isinstance(cost, (int, float)) or isinstance(cost, bool) or not math.isfinite(cost) or cost < 0):
    sys.exit(3)
open(sys.argv[2], "w").write(json.dumps(cost if isinstance(cost, (int, float)) and not isinstance(cost, bool) else None))
sys.stdout.write(d["result"])
PY
