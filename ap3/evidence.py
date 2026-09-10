#!/usr/bin/env python3
"""Build one evidence JSONL row (DESIGN §8) from a run record + the writer's result.json.

  python3 ap3/evidence.py <record.json> [<result.json>]

record.json is the dispatcher's source of truth (it enriches it through the lifecycle:
head_sha, terminal, review_verdict, security_review, verify, pr_url, finished_at,
human_interventions, merged_unchanged). result.json is `claude -p --output-format json`
and supplies the cost telemetry. Anything unknown is emitted as null / "unavailable" —
never fabricated. Prints exactly one line of JSON to stdout.
"""
import json
import sys


def load(path):
    try:
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return {}


def main(argv):
    if len(argv) < 2:
        sys.stderr.write("usage: evidence.py <record.json> [<result.json>]\n")
        return 2
    rec = load(argv[1])
    res = load(argv[2]) if len(argv) > 2 else {}

    # Prefer the record's CUMULATIVE telemetry (summed across fix rounds by the dispatcher);
    # fall back to the last attempt's result.json for a single-round run.
    denials = res.get("permission_denials")
    cost = rec.get("spent_usd")
    if not isinstance(cost, (int, float)) or cost == 0:
        cost = res.get("total_cost_usd")
    turns = rec.get("total_turns") if isinstance(rec.get("total_turns"), int) and rec.get("total_turns") else res.get("num_turns")
    dens = rec.get("total_denials")
    if not isinstance(dens, int):
        dens = len(denials) if isinstance(denials, list) else None
    row = {
        "slug": rec.get("slug", "unavailable"),
        "class": rec.get("class", "unavailable"),
        "risk": rec.get("risk", "unavailable"),
        "base_sha": rec.get("base_sha"),
        "head_sha": rec.get("head_sha"),
        "started_by": rec.get("started_by", "unavailable"),
        "started_at": rec.get("started_at"),
        "finished_at": rec.get("finished_at"),
        "duration_ms": res.get("duration_ms"),
        "num_turns": turns,
        "total_cost_usd": cost,
        "permission_denials": dens,
        "verify": rec.get("verify", "unavailable"),
        "review_rounds": rec.get("review_round", 0),
        "review_verdict": rec.get("review_verdict", "unavailable"),
        "security_review": rec.get("security_review", "not_required"),
        "terminal": rec.get("terminal", "unavailable"),
        "pr_url": rec.get("pr_url"),
        "human_interventions": rec.get("human_interventions"),
        "merged_unchanged": rec.get("merged_unchanged"),
    }
    print(json.dumps(row))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
