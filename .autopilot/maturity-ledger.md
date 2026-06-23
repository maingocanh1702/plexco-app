# Autopilot maturity ledger · Plexco (TRACKED — per-repo credit ledger, GENERIC §A.6)

One line per `<change_class>`. Auto-merge graduates a class to `mature` only after **≥3** clean
READY runs merged UNCHANGED (no founder fix before merge); any founder fix → reset count to 0.
P0/P1 NEVER auto-merge regardless of count. Only P2 `mature` + explicit `Auto-merge requested: yes`
may auto-merge. Increment on a clean unchanged squash; never edit by hand to inflate.

```
change_class            | tier | clean_ready_runs_merged_unchanged | status
identity-feature        | P1   | 0                                 | pilot
billing-feature         | P1   | 0                                 | pilot
cross-club-feature      | P1   | 0                                 | pilot
marketplace-feature     | P2   | 0                                 | pilot
web-feature             | P2   | 0                                 | pilot
```
