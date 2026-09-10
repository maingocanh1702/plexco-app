#!/usr/bin/env bash
# Owner-only: clear a class's AUTOMATIC pause so it can dispatch again. A class auto-pauses on
# any HALT / crash / rejected PR / human-fixed merge; trust is then re-earned, so this also
# resets clean_runs to 0. Pair it with confirming the class is `enabled` in ap3/routines.json.
#   ap3/unpause.sh <class>
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$DIR/.." && pwd)"; cd "$REPO"
CLS="${1:?usage: unpause.sh <class>}"
TRUST="ap3/state/trust.json"
python3 "$DIR/rec.py" setjson "$TRUST" "$CLS.paused" false
python3 "$DIR/rec.py" setjson "$TRUST" "$CLS.clean_runs" 0
echo "unpaused $CLS (clean_runs reset to 0). Confirm ap3/routines.json has $CLS enabled."
