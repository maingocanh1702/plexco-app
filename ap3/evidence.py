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
        # K28: null when the record carries no review_round at all (never a fabricated 0); a real
        # 0 -- a run halted before its first review -- is emitted as 0.
        "review_rounds": rec.get("review_round"),
        "review_verdict": rec.get("review_verdict", "unavailable"),
        "security_review": rec.get("security_review", "not_required"),
        "terminal": rec.get("terminal", "unavailable"),
        "terminal_kind": rec.get("terminal_kind"),
        # K28: the machine-readable sub-reason halt() records (today only for VERIFY_HOST_FAIL:
        # verify_host_rounds | verify_host_budget | verify_host_mutated); null on every other halt
        # and on READY, so the ledger can separate an exhausted ceiling from a mutated worktree.
        "halt_cause": rec.get("halt_cause"),
        "verify_host": rec.get("verify_host", "n/a"),
        "feature": rec.get("feature"),
        "escalated_model": rec.get("escalated_model"),
        "pr_url": rec.get("pr_url"),
        "human_interventions": rec.get("human_interventions"),
        "merged_unchanged": rec.get("merged_unchanged"),
        # W5.2 I3 (K16/K19): absence is a known fact (this run was never owner-extended), not an
        # unknown one -- False, not null, matching report.sh/the trust ladder's own reading of it.
        "owner_extended": rec.get("owner_extended", False),
        # W6: a run the resolver decided on mid-run (never counted toward clean_runs), the flags
        # naming what it did, and the two read-only session costs that are NOT in total_cost_usd
        # (the writer's own metering) -- null when the run predates W6 or never needed them.
        "agent_resolved": rec.get("agent_resolved", False),
        "agent_resolved_flags": rec.get("agent_resolved_flags"),
        "preflight_cost_usd": rec.get("preflight_cost_usd"),
        "resolver_cost_usd": rec.get("resolver_cost_usd"),
    }
    print(json.dumps(row))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
