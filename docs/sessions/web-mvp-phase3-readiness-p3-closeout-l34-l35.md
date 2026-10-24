<!-- review-readiness: code-ready -->

# Step-0 readiness: L36 p3-closeout-l34-l35 (session P3-S16n)

> Agent-facing. Step-0 readiness reviewer opus/high, as lane block L36 assigns, run in two parts under the owner's token rule: part 1 answered Q1-Q5 at the base and was stopped under that rule before its verdict; part 2 (this file) consolidates its answers with the orchestrator's measured readings, which close every item part 1 left unverified, and one git spot-check (the probe's lines at B). Writers sonnet/high, one file or one section each, sequential; reviewer opus/max, at most 3 rounds; docs only, no security round (void if any code, migration, workflow, script or secret-bearing file enters the diff). Every number below is MEASURED at base B = `ca1d2cae2e1d0b637d5419e6fc0b8671b615b512` (merge of PR #111) in the lane worktree: branch `docs/p3-closeout-l34-l35`; before this file's commit HEAD = B, `git status --porcelain` empty, no commit yet. M35 = `3acbfd1755ec8f60b1b112d78d41a67af0abc93b` (merge of PR #110, the first parent of B); A = `54db28e6bc025ce729b65ed14cfd685949e20053` (merge of PR #109, the pre-L35 base).

## 1. Authority

- Lane block L36 is conductor-authored under the owner's standing delegation of 2026-10-22, verbatim "chọn các option mang lại lợi ích long term và tối đa cho pj", and the owner's decisions of 2026-10-24 (owner instruction, verbatim "Chọn các decision mang lại lợi ích tối đa cho mvp"); it is recorded as conductor decision D17 of P3-S16. Every choice of this lane is "decided by the conductor under the owner's delegation of 2026-10-22, not an owner signature"; the owner's 2026-10-24 choices keep their label "accepted under the owner's delegation of 2026-10-24 (assistant review)"; DD-145's table stays the only owner-signed P3-S16 table; the owner can reverse any of them. Owner decisions needed: none; a source that cannot be found is a ruling request, never an invented fact.
- Hard dependencies, from `gh` (measured by the orchestrator on 2026-10-24; every run success at attempt 1): PR #110 (L35) MERGED 2026-10-24T11:32:59Z, merge = M35, PR head `060df42b5a61981200e69c41186767687adbe11c`, PR CI run 40089655598 (pull_request), main CI run 40090352281 and Security run 40090352484 on M35 (push); PR #111 (L34) MERGED 2026-10-24T16:19:57Z, merge = B, PR head `22d7009e18c050d7921e9f12f3082f7af53243de`, PR CI run 40110178764 (pull_request), main CI run 40111062832 and Security run 40111063342 on B (push). Parents: B = M35 + the #111 head; M35 = A + the #110 head.

## 2. Live truth at B

- Q1 the D8 row `public-card-hide-exact-address-real-stack-proof`, `docs/autopilot-backlog.md` :6667-:6681 (the file has 6997 lines): `status: in-flight` :6669, `merged_probe: apps/web/e2e/public-card-hide-address.spec.ts :: SCRATCH_DB_PATH` :6676, `_probe_note` :6677 (dated "1 file, 2 matches"; stays byte-identical), notes :6678-:6681. The probe is a bare identifier; its uses at B are spec :30 (`const SCRATCH_DB_PATH = "/plexco_l35_scratch";`), :123 (the round-2 guard) and :215; in the code tree (docs excluded) B 3 lines in 1 file, M35 3, A 0 (control `GOLDEN_PATH_BASE_URL` at A: 2 files). `scripts/autopilot-backlog-reconcile:289` (`flush()`) scans only planned, ready and blocked rows, so this `in-flight` row flips by hand, as the PR #110 body :110 (D-r2-1) planned. Format: L33's flips (:6750-:6751 and :6895-:6896 at B): `status: merged`, then `merged:` and `note_merged:`; the rest of the row byte-identical. Decision record: D8 of DD-148 section A, built now by DD-149 item 3 (summary row decisions.md:120).
- Q2 L35's three round-3 P3s (PR #110 body :99, items (a)-(c), section "Review (three rounds, the cap; independent reviewers)"); `apps/web/e2e/public-card-hide-address-proof.sh` and `docs/runbooks/local-mvp-smoke.md` are unchanged from M35 to B. (a) proof.sh :16 says "Fail closed, unknown means stop", but the check is `lsof -nP -iTCP:3000 -sTCP:LISTEN` (:21), exit 1 with an empty stderr reads as free (:26), a non-root `lsof` does not list another user's listener on `[::1]:3000`, and the clients use `http://localhost:3000` (:87); minimal fix: a connect probe after :29: row `public-card-proof-port-preflight-any-owner`. (b) runbook :206 and proof.sh :9-10 name only the preflight refusal as a run without the drop line, but every stop before the trap (:68) prints none: also the repo-root check :12-13 (exit 2), the password lookup :46 and the BEFORE listing :50 (exit 1); harmless (nothing is created before the DROP and CREATE :70-71; runbook :207): row `public-card-proof-no-drop-line-exception-complete` (scope both files). (c) runbook :209 pins the latest result to `dbaf348`, a run of an older runner, while the final runs are at the PR head: row `local-smoke-step11-latest-result-depin`. All three `change_class: test-infra`, `invariants: [web-app, test-chain]`.
- Q3 L34 rows (PR #111 body, section "Reported P3s and observations, not fixed" :33-:50; post-round fix D1 :70): L34-a `zalo-dm-routable-event-types-one-list` (R1-F3, :35; `code`): the four routable types are written twice, `ZALO_DM_ROUTABLE_EVENT_TYPES` at `apps/bot/src/dispatcher.ts:72-77` and `ZALO_DM_EVENT_TYPES` at `scripts/outbox-projector-enable.mjs:66-71`, and PSD-11 (`apps/bot/src/projector-registry.test.ts:703`) ties only `untilSessionStart`. L34-b `bot-zalo-dm-cycle-tests-isolation-and-cells` (R1-F4, R1b-F1, R1b-F2, R2-F3, R2b-F3, :36-:40, and the parallel-claim observation, :70; `test-infra`; scope `apps/bot/src/projector-registry.test.ts` and `packages/db/src/zalo-dm-delivery.test.ts`): a cycle claims one `zalo_dm` row at a time (`dispatcher.ts:331-336`, `claim_projector_delivery_batch($1, 1)`) in `event_id` order (`packages/db/migrations/0022_job_claim_lease_core.sql:349` and `:374`) whichever test file emitted it, which cost PR #111 two red full bot-suite runs; PSD-8 :1204/:1209, PSD-13 :1500, PSD-14 :1533, the stale stop's `break` (`dispatcher.ts:364`), PSD-10c at `packages/db/src/zalo-dm-delivery.test.ts:507`; seven other bot test files run a dispatch cycle (dispatcher-outcome, dispatcher, outbox-wake, projectors/public-sessions, projectors/web-realtime, projectors/zalo-dm, schedule). L34-c `outbox-runbook-zalo-dm-expiry-wording` (R3-F4, R3b-F3, R3c-F1, :41-:43; `docs`): in `docs/runbooks/outbox-dispatch-enable-rollback.md` the new lines :84-:85 use `<id>`, the older :75 and :131 `<event-uuid>`; the NULL bullet :85 omits an infinite `starts_at` (0071 :17 and :42, `isfinite`); :110 does not scope the `player.promoted` exception to `zalo_dm`, as `scripts/outbox-projector-enable.mjs:173` does. L34-d `decisions-dd148-dd149-acceptance-labels` (R3-F3, R3-F5, :41; `docs-reconcile`; scope `docs/standards/decisions.md`): the status cell :121 and the heading :1791 name the 2026-10-24 acceptance for section F only while :1796 carries sections A-F; the context paragraph :1777 calls DD-146 DF0-DF7 and DD-147 D1-D8 and N1-N4 the conductor's defaults and rulings, though they are lane defaults (L31, L29); imprecise, not proven false, so a row for a lane that owns decisions.md, not a ruling request. All four classes are in use at B.
- Q3 no row: R3-F2 (decisions.md:2002), ruled accepted as left by RO-L33-1 item 3; R2b-F1, R2b-F2 and R3b-F2 (:40, :42), the merged L34 readiness file's dated step-0 record; R3-F6 (:44), covered by PSD-11 and `dispatcher.ts:69`; R3-F7 and R3b-F5 (:44), the status doc's stale labels (:35, :76, :96), fixed by W2 (Q5); the 120 s send window and R5's stale fee (:48-:50), existing rows `zalo-dm-send-deadline-into-deliver` (:6956) and `zalo-dm-promotion-live-balance-at-delivery` (:6986), cross-referenced; the enable CLI's R1-R4 (:138-:146), accepted residuals already stated in the runbook. OUT_OF_SCOPE: R3b-F4 (section 8). The six slugs of part 1 had 0 matches of `## task: <slug>` at B; W1 checks the seventh (`decisions-dd148-dd149-acceptance-labels`) the same way before writing; the rows copy the `status: idea` row :6956 and go after :6997, one blank line before each.
- Q4 `docs/sessions/web-mvp-program-status.md` (136 lines at B): the dated lines :12-:18 have the form `> **YYYY-MM-DD** (phiên P3-Sxx, lane Lxx): ...` (:17 L33; :18 L34, written before its PR number existed); ONE new dated line goes after :18 (session P3-S16n, lane L36: the #110 and #111 merge facts and run ids of section 1, from `gh` and re-checked with `git cat-file -t` and `git log`; L34's PR number #111; migration tail `0071`; the flip, the new rows, the two table rows and the stale phrases fixed, :35, :38 and :39 included). The P3-S16 lane table :55-:67 (L31 #108 :67) gets two rows after :67: L35 #110 (merge M35, 2026-10-24 11:32Z) and L34 #111 (merge B, 2026-10-24 16:19Z, DD-149, migration 0071), in UTC to the minute as its other rows.
- Q5 stale claims (no doc links the old headings or the :96 text; the one other hit, `docs/sessions/web-mvp-phase3-readiness-p3-docs-decisions-sync.md:154`, is a dated row citing line ranges): :76 heading (the DD-122 D3 defaults await the owner's signature by the M0 merge) STALE: decisions.md:3337 (effective when PR M0 merges) and :3342 (the owner's merge of PR M0 is the signature); `git`: `1681f5fb9e43fa48c8f85e71fbc743b0a087ed41` is "Merge pull request #42 from maingocanh1702/feat/mvp-m0-decisions" (2026-10-13T18:49:06Z), an ancestor of B; the doc's own M0 row :27 (#42); fix: the heading says the owner signed by the M0 merge. :35, :38 and :39 (the M6, M9 and M10 cells: DD-138's defaults await the owner's signature, a proposal added by lane L17; exactly these 3 lines) and :96 (the DD-138 bullet: the Phase 3 defaults await the owner's signature) STALE: decisions.md:2290 (DD-138 heading: owner signed 2026-10-21 except 6 rows) and :2299 (the owner's signing result of 2026-10-21); the doc's own :14 and :134 agree; fix: the cells say signed 2026-10-21 except 6 rows, and :96 takes the closed form of :87 and :90. :83 heading (open proposals awaiting the owner's signature) TRUE: its item :92 is still open (backlog `identity-link-hardening-consumer-column` :6179, `status: idea` :6181): no edit. :27 and :32 TRUE; nothing UNPROVABLE, so no owner question.

## 3. Scope

- Ownership, exactly as lane block L36: `docs/autopilot-backlog.md` (the D8 row and the new rows only), `docs/sessions/web-mvp-program-status.md` and this file; `docs/standards/decisions.md` is not owned. Negative scope (lane block L36): no code, no test, no migration, no workflow or script change; no edit of decisions.md, of a Reviewed spec or of docs/legal; no rewriting of dated changelog rows or dated status lines; no row that states a conductor decision as owner-signed (only DD-145's table is owner-signed; the owner's 2026-10-24 acceptances keep their own label); no fabricated fact (every PR number, SHA, time and run id from `gh` or `git`); PR #50 untouched. A diff outside the ownership list is a HALT.

## 4. Writer units and B3

- W1 `docs/autopilot-backlog.md`: :6669 becomes `status: merged`, `merged:` and `note_merged:` (Q1: the merge facts of section 1, the probe counts, D-r2-1 and the decision record with its labels), the rest of the row byte-identical, then the seven rows of Q2 and Q3 after :6997 (about 3 + 7 x 14 = 101 lines). W2 `docs/sessions/web-mvp-program-status.md`: two table rows after :67, ONE dated line after :18 and the five edits :35, :38, :39, :76 and :96 (Q4, Q5); :83 and every dated line untouched (about 3 added, 5 changed). Sequential, one writer per unit, sonnet/high, each applying an orchestrator-prepared text. B3 (pre-approved): at most 250 docs lines, 6 files, 0 code lines, 0 migrations; estimate this file (at most 100) + W1 about 101 + W2 about 8 = about 210 of 250, 3 of 6 files, 0 code lines, 0 migrations.

## 5. Readings pinned

- Signed claims: the lane restates only owner signatures recorded in-repo (DD-138: decisions.md:2290 and :2299; DD-122 by the M0 merge: decisions.md:3342); it states no P3-S16 conductor decision or default as signed. The flip labels D8 "conductor decision under the owner's delegation of 2026-10-22, not an owner signature" and DD-149 item 3 "accepted under the owner's delegation of 2026-10-24 (assistant review)".
- decisions.md stays untouched: R3-F2 (:2002) is ruled by RO-L33-1 item 3 (accepted as left; tracked in `docs/sessions/web-mvp-phase3-readiness-p3-l31-docs-reconcile.md` :37 and :69); R3-F3 and R3-F5 are recorded as row L34-d, not edited. No dated line or existing row is rewritten: the status doc's :12-:18 and every backlog row except the D8 row's status line stay byte-identical.

## 6. Verification

| # | Check | Expected |
|---|---|---|
| V1 | `pnpm review:check:changed` before every commit (for this file before the branch's first commit); the full `pnpm review:check` at the end; `pnpm format:check` (prettier on every changed file) | pass |
| V2 | `scripts/autopilot-backlog-reconcile --check` and `--audit`; a probe re-check script (a file, run with `bash`) on the final head | `--check` refused 2 and malformed 0 at B, at head malformed 0 and refused not above 2; `--audit` as at B; `SCRATCH_DB_PATH` at head 3 lines in 1 file (the spec, docs excluded), at A 0 |
| V3 | the tests that read the backlog or the status doc: `git grep -l -e autopilot-backlog.md -e web-mvp-program-status.md -- '*.test.*'` at head, each with its narrowest command (a DB-bound one only inside the shared DB lock) | pass |
| V4 | GitNexus `detect_changes`; `git diff --stat B...HEAD`; the AI-reference grep on commit messages and the PR body | docs only, the three files; 0 |

## 7. Closure matrix (12 of 12)

| # | Gate | Evidence | Result |
|---|---|---|---|
| 1 | Authority snapshot pinned by SHA | `AUTHORITY_SHA` = B = the PR #111 merge = the worktree HEAD at step 0; every TARGET_FILES path exists at B or is this file | PASS |
| 2 | Decisions in scope are final | the lane records merge facts and review findings and makes no product decision; every label stays as recorded (section 5) | PASS |
| 3 | Scope IN/OUT and owner clear | section 3; docs only, three files | PASS |
| 4 | Dependencies classified | PR #110 merged at M35 and PR #111 merged at B (hard); PR #50 is not one | PASS |
| 5 | Live schema and code match the claims | the probe at B, M35 and A (Q1, its lines spot-checked at B); the proof runner, the two runbooks, `dispatcher.ts`, the enable CLI, 0022, 0071 and the test files at the lines of Q2 and Q3 | PASS |
| 6 | Data, API, state and auth contract complete | not applicable beyond HARD RULES: records only, no behavior change | PASS |
| 7 | Fail-closed, idempotency, order | no runtime behavior; one flip, dated history untouched, the probe re-check (V2) | PASS |
| 8 | Open questions in scope = 0 | every claim verdicted with in-repo evidence (Q5: none unprovable); every finding dispositioned (Q3, section 8); no new owner question | PASS |
| 9 | Acceptance matrix has expected results | section 6, V1-V4 | PASS |
| 10 | Migration, security and rollback pinned | no migration, no secret, no PII; rollback = revert the single docs PR | PASS |
| 11 | First slice has hard dependency merged | PR #110 and PR #111 are on main at B | PASS |
| 12 | Implementation handoff ready | Q1-Q5 with line anchors, the readings, the writer units, the verification table | PASS |

## 8. Findings for the PR OPEN list

- F-1 (R3b-F4) OUT_OF_SCOPE: the reviewer suggests `money-model` (a valid token, 16 rows) for the invariants :6992 `[transport-zalo, schema]` of the row `zalo-dm-promotion-live-balance-at-delivery` (:6986); that row is outside this lane's ownership: no edit.
- F-2 (R3-F3, R3-F5): recorded as row L34-d, since decisions.md is not owned; the conductor may rule an edit by a lane that owns decisions.md.
- F-3: the P3-S16 lane table has no row for L33 (PR #109, merge A); not added (GOAL (5)); the conductor may rule it in. F-4 (process): the first step-0 reviewer ran to about 279k tokens of context (the orchestrator's measurement), past the owner's token rule (stop at about 200k; no worker past about 250k); it handed off its answers, and this second reviewer consolidated them within the step-0 call budget.

## 9. Verdict

```text
REVIEW_POLICY_VERSION: 1.3
REVIEW_VERDICT: CODE_READY
REVIEWED_AT: 2026-10-24
AUTHORITY_SHA: ca1d2cae2e1d0b637d5419e6fc0b8671b615b512
BASE_BRANCH: main
TARGET_FILES:
  - docs/autopilot-backlog.md
  - docs/sessions/web-mvp-program-status.md
  - docs/sessions/web-mvp-phase3-readiness-p3-closeout-l34-l35.md
SLICE: p3-closeout-l34-l35
IN_SCOPE: docs-only closeout after L35 (PR 110) and L34 (PR 111) merged: flip the backlog row public-card-hide-exact-address-real-stack-proof to merged by hand with the merge facts from gh and its probe (apps/web/e2e/public-card-hide-address.spec.ts :: SCRATCH_DB_PATH, present at B and at the PR 110 merge, absent at the pre-L35 base); add seven status idea rows (three from the round-3 P3s of L35, four from the reported P3s and observations of L34), each with file:line evidence and a Source line; the program status doc records PR 110 and PR 111 as merged (two table rows, one dated line) and fixes the five current-state phrases that decisions.md and git prove stale
OUT_OF_SCOPE: any code, test, migration, workflow, script, env or secret-bearing file; docs/standards/decisions.md (R3-F3 and R3-F5 become a backlog row); Reviewed specs and docs/legal; every existing backlog row except the status line of the D8 row (R3b-F4 is reported, not edited); rewriting dated history (status doc lines 12-18, dated rows); any new owner-signature claim (DD-145 stays the only owner-signed P3-S16 table); a table row for L33 (PR 109); PR 50
G1_DECISION: PASS
G2_SPEC: PASS
G3_DEPENDENCY: PASS
G4_TEST: PASS
G5_SCOPE: PASS
G6_EXTERNAL: PASS
HARD_DEPENDENCIES: PR 110 (L35) merged on main, merge 3acbfd1755ec8f60b1b112d78d41a67af0abc93b; PR 111 (L34) merged on main, merge ca1d2cae2e1d0b637d5419e6fc0b8671b615b512 = AUTHORITY_SHA
PRIOR_SLICES: L33 merged as PR 109 (merge 54db28e6bc025ce729b65ed14cfd685949e20053); L35 merged as PR 110; L34 merged as PR 111
OPEN_QUESTIONS_IN_SCOPE: 0
ENABLEMENT_ONLY_GATES: none
LIVE_REPO_VERIFICATION: PASS
CONTRACT_MATRIX: PASS
CLOSURE_MATRIX: PASS
ACCEPTANCE_MATRIX: PASS
SECURITY_AND_MIGRATION_GATE: PASS # docs only, no migration, no secret, no runtime change
IMPLEMENTATION_ARTIFACTS: PASS
FIRST_IMPLEMENTATION_STEP: W1 on docs/autopilot-backlog.md: flip public-card-hide-exact-address-real-stack-proof to merged by hand (status line 6669 becomes status, merged and note_merged) and append the seven status idea rows after line 6997; then W2 on docs/sessions/web-mvp-program-status.md (two table rows after line 67, one dated line after line 18, the five edits at lines 35, 38, 39, 76 and 96), one sonnet/high writer each, sequential
REMAINING_BLOCKERS: none
```
