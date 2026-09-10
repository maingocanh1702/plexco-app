#!/usr/bin/env bash
# Cost / cycle-time / intervention monitor (DESIGN §8). Aggregates the evidence rows —
# ap3/evidence.jsonl (READY runs, committed on branches / merged to main) and
# ap3/state/evidence.local.jsonl (HALTs, local). Real numbers only; nothing estimated.
#   ap3/report.sh [--since 7d] [--telegram]
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$DIR/.." && pwd)"; cd "$REPO"
SINCE_DAYS=0; TG=0
while [ $# -gt 0 ]; do
  case "$1" in
    --since) SINCE_DAYS="$(printf '%s' "$2" | tr -dc '0-9')"; shift 2 ;;
    --telegram) TG=1; shift ;;
    *) echo "usage: report.sh [--since Nd] [--telegram]" >&2; exit 2 ;;
  esac
done

OUT="$(SINCE_DAYS="${SINCE_DAYS:-0}" python3 - ap3/evidence.jsonl ap3/state/evidence.local.jsonl <<'PY'
import json, os, sys, datetime
since = int(os.environ.get("SINCE_DAYS", "0"))
cutoff = None
if since > 0:
    cutoff = datetime.datetime.utcnow() - datetime.timedelta(days=since)
rows = []
for path in sys.argv[1:]:
    try:
        with open(path, encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    rows.append(json.loads(line))
                except ValueError:
                    pass
    except OSError:
        pass
# one row per slug — a run appends a READY row then a merge/reject row; the last wins (no
# double-counting of cost across the two rows)
_by = {}
for r in rows:
    _by[r.get("slug", id(r))] = r
rows = list(_by.values())
def within(r):
    if cutoff is None:
        return True
    s = r.get("started_at")
    if not s:
        return True
    try:
        return datetime.datetime.strptime(s[:19], "%Y-%m-%dT%H:%M:%S") >= cutoff
    except ValueError:
        return True
rows = [r for r in rows if within(r)]
n = len(rows)
ready = [r for r in rows if r.get("terminal") == "READY"]
costs = [r["total_cost_usd"] for r in rows if isinstance(r.get("total_cost_usd"), (int, float))]
durs = [r["duration_ms"] for r in rows if isinstance(r.get("duration_ms"), (int, float))]
inter = sum(r["human_interventions"] for r in rows if isinstance(r.get("human_interventions"), int))
den = sum(r["permission_denials"] for r in rows if isinstance(r.get("permission_denials"), int))
term = {}
for r in rows:
    term[r.get("terminal", "unavailable")] = term.get(r.get("terminal", "unavailable"), 0) + 1
def mean(xs):
    return round(sum(xs) / len(xs), 4) if xs else None
print("ap3 report" + (" (last %dd)" % since if since else " (all)"))
print("  runs=%d  READY=%d  READY_rate=%s" % (n, len(ready), ("%.0f%%" % (100.0 * len(ready) / n)) if n else "n/a"))
print("  cost_usd mean=%s max=%s total=%s" % (mean(costs), max(costs) if costs else None, round(sum(costs), 4) if costs else None))
print("  cycle_ms mean=%s max=%s" % (mean(durs), max(durs) if durs else None))
print("  human_interventions=%d  permission_denials=%d" % (inter, den))
print("  terminals=" + json.dumps(term))
PY
)"
printf '%s\n' "$OUT"
[ "$TG" = 1 ] && bash "$DIR/notify.sh" "$OUT" || true
