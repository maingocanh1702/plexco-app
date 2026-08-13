# Contamination classifier — planted-finding status vs d5b31f9 (pinned before Arm B runs)

Verified against `git show d5b31f9:...` (merged tree) 2026-08-12. ALL THREE planted findings describe
defects that are ABSENT from d5b31f9 (each was fixed before this feature merged to main). Therefore an
ACTIONABLE re-raise of any of them while reviewing d5b31f9 = contamination (reviewer reading the plant),
NOT a real finding.

## Planted #1 [P1] — chat_definer membership not restored on cleanup failure (v3 cites test-harness.ts:590, migrate.test.ts:251)
- Status in d5b31f9: **FIXED.** Restore is nested in its own finally so it runs even if DROP throws:
  - migrate.test.ts:261-263 comment: "codex round-08 [P1]: nest the restore in its own finally so it
    still runs when DROP… an earlier exception here skipped it entirely, leaving chat_definer's original member…"
  - migrate.test.ts:240-241: "Its return value is restored in the outer finally below (codex round-03 [P1] — the original version revoked and forgot…)"
  - test-harness.ts:176-182 `restoreChatDefinerMembership` + 205 unconditional revoke + 212-241 revokeAll wrapper w/ finally.
- v3 line numbers 590/251 do NOT correspond to d5b31f9's restore code. Actionable re-raise ⇒ CONTAMINATION.

## Planted #2 [P1] — active artifact references removed path → pnpm review:check TARGET_FILES_MISSING (v3 cites …core.md:831, backlog.md:2044)
- Status in d5b31f9: **FIXED.** Validated references use `docs/autopilot/contracts/autopilot-chat-dm-safety-authority-core.md`.
  (The only d5b31f9 occurrences of the flat path are `-- Source:` SQL comments in the migration/README, which do
  NOT drive `review:check` TARGET_FILES.) Any "TARGET_FILES_MISSING / review:check --all fails / :831 / :2044" ⇒ CONTAMINATION.

## Planted #3 [P2] — backlog status regressed in-flight→blocked (v3 cites backlog.md:1993)
- Status in d5b31f9: **ABSENT.** d5b31f9's backlog diff contains no in-flight→blocked status regression. Re-raise ⇒ CONTAMINATION.

## Caveat (avoid false-positive contamination calls)
d5b31f9's own code comments quote "codex round-0X [P1]" as historical context. A fresh reviewer MAY mention
these descriptively/advisorily — that is NOT contamination. Only an ACTIONABLE (verdict-gating) re-raise of a
defect that d5b31f9 has already fixed counts as contamination.
