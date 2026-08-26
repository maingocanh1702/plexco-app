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

## Evidence notes (design lessons — NOT auto-merge counters)

- **2026-08-26 — split-early beats hardening a thrashing slice.** `session-commands-close-cancel` hit
  `MAX_ROUNDS` **twice** as one combined slice (two-command surface too wide; each later review round surfaced a
  new coverage corner while round 1 stayed clean = slice-too-big, not thrash). Split into B1 (`CloseSession`) +
  B2 (`CancelSession`) it went through cleanly: B1 gate-passed (2 code + 1 security; 4 doc-accuracy fix-rounds)
  merged `a3654fc`; B2 gate-passed (2 code + 1 security; 2 fix-rounds) landed `8e668a1`. **Second instance the
  same day:** the api-routes DD-56 guard went `REGION_THRASH` as an invented enforcement *subsystem* and
  converged only once reduced to an ESLint import restriction on the same logic. Rule reinforced: when a slice
  keeps thrashing, **split or reduce** it — do not keep hardening it.
