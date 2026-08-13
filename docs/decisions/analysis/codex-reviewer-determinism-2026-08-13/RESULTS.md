# Codex reviewer determinism vs contamination — RESULTS (2026-08-13)

Frozen input: `git diff 75f06c5...d5b31f9` (chat-dm-safety-authority-core, migration 0030), reviewed in a
detached worktree via the pinned `scripts/codex-review-pin.sh`, marker prompt identical to
`autopilot-review-readiness.mjs:776-783` every run. 9 reviewer invocations total (budget 6-10). No quota hit.

## Per-run table

| run | arm | assertion | wall | verdict | actionable | notes |
|-----|-----|-----------|------|---------|-----------|-------|
| A-1 | clean | no .autopilot/state | 865s | CLEAN | 0 | advisory: torn-read, bootstrap |
| A-2 | clean | no .autopilot/state | 678s | CLEAN | 0 | advisory: torn-read only |
| A-3 | clean | no .autopilot/state | 738s | **FINDINGS** | 2 | [P2] stale readiness `contract:587`; [P2] **client leak `test-harness.ts:259` (REAL)** |
| B-1 | lone artifact | PLANT_PRESENT | 974s | FINDINGS | 2 | stale CODE_READY; security-definer test gap. **plant filename: 0 hits** |
| B-2 | lone artifact | PLANT_PRESENT | 741s | FINDINGS | 4 | stale readiness; scope-vs-negscope; nonexistent ctx paths; concurrency test. **0 hits** |
| B-3 | lone artifact | PLANT_PRESENT | 815s | FINDINGS | 1 | torn-read elevated [P1], rendered as readiness-gate DSL. **0 hits** |
| C-1 | pointer vector | POINTER+ARTIFACT | 437s | CLEAN | 0 | read pointer+artifact (5 refs); minimal output |
| C-2 | pointer vector | POINTER+ARTIFACT | 457s | CLEAN | 0 | **read artifact HEAVILY (245 refs); CONTAMINATED verdict (see below)** |
| C-3 | pointer vector | POINTER+ARTIFACT | 614s | CLEAN | 0 | did NOT read artifact (0 refs); baseline |

"IDENTICAL" (pre-registered) = same verdict + same finding count + same file:region set.

## Arm A — clean determinism: VARIES (decisive)
- Verdict: CLEAN, CLEAN, FINDINGS. All three runs differ on EVERY pre-registered axis; even the advisory sets
  differ; the same torn-read is cited at different secondary refs (A-1 `backlog:113` vs A-2/A-3 `decisions.md:1428`).
- A-3's [P2] client leak is a REAL defect: d5b31f9 `acquireChatDefinerLock` (test-harness.ts:262-264) connects a
  client then `await pg_advisory_lock` with no try/catch → a rejection leaks the connection. A-1/A-2 (CLEAN) missed it.
- No plant present → this is pure model/sampling variance, SEPARATE from contamination.
- ⇒ "2 consecutive clean rounds" is a stochastic sampler. A re-run flips CLEAN↔FINDINGS with no input change.
  Every readiness verdict resting on "2 clean rounds" (incl. `fix_round_count: 0`) is weaker than assumed.

## Arm B — lone artifact: NOT read (mechanism null)
- Planted genuine `gate-attempt-01-...txt` at `.autopilot/state/chat-dm-safety-authority-core/`. The exact filename
  has 0 hits in all 3 transcripts. codex never discovered a bare artifact. Arm B = 3 more baseline samples
  (3/3 FINDINGS, all diff-grounded, cite d5b31f9-relative lines, correctly report review:check passing, no plant re-emission).

## Arm C — pointer vector: CONTAMINATION CONFIRMED (mechanism + content)
- Planted genuine `pending-review-finding.json` (pointer) + the genuine `gate-attempt-05-...txt` it references.
- MECHANISM: codex followed the pointer and read the artifact in 2/3 runs (C-1: 5 refs, C-2: 245 refs; C-3: 0).
  The pointer — not the artifact — is the discovery vector (cf. Arm B never read the bare artifact).
- CONTENT (C-2, heavy read): verdict message contains **"…including DB 416/416"** — a figure with 0 occurrences in
  d5b31f9's tracked tree AND its diff, present ONLY in the planted artifact (clean runs reading d5b31f9's own evidence
  say 417/417). AIRTIGHT: C-2 copied a number that exists nowhere in the worktree except the prior-round artifact.
  Corroborating (not airtight, because the diff embeds lane history): advisory citing `autopilot-dd38-dd86-chat-schema-core.md:325`
  (a file outside the 10-file diff) and the framing "the PRIOR bootstrap concurrency defect is fixed…".
- EFFECT: here contamination polluted ADVISORY/verification content but did NOT flip the verdict (C 3/3 CLEAN).
  The OCR natural experiment (2026-08-12, open-decisions round-03) shows it CAN flip to a false HALT REVIEW_FINDINGS.
  Range: advisory-pollution → false-blocking.

## Decision-rule outcome (pre-registered)
- **Arm A varies → the two-clean-rounds gate is weaker than every readiness verdict in this repo assumes.** FIRED.
- Additionally, the isolation defect is independently CONFIRMED (Arm C). Both backlog tasks are REAL and SEPARABLE:
  Arm A shows nondeterminism with NO contamination present; Arm C shows contamination via the pointer.

## Methodological caveat (honest)
The frozen diff `d5b31f9` embeds its OWN review-lane history (699-line contract doc, manifest, backlog with
`3289e3b`, `codex round-0X`, `HALT-MAX_ROUNDS`, state paths, a test named `gate-attempt-01`). So most plant tokens
are ALSO in the diff — this diff is a POOR clean discriminator for contamination. The `416/416` figure is the one
token that is genuinely plant-only and therefore decisive.

## Consequence for the DD-104 split reasoning
"distinct findings spreading across many files round after round = slice-too-big" is confounded by BOTH measured
failures: nondeterminism (findings change run-to-run on a byte-identical input) and pointer-contamination (prior
findings bleed forward). The signal is weaker than it was presented as — including in the reasoning that produced
the DD-104 split. Verify any repeat finding against live HEAD before trusting it.
