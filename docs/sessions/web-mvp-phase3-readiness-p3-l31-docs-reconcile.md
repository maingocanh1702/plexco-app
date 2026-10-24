<!-- review-readiness: code-ready -->

# Step-0 readiness: L33 p3-l31-docs-reconcile (session P3-S16k)

> Agent-facing. Step-0 readiness reviewer opus/high, as lane block L33 assigns, run in two parts under the owner's token rule: part 1 measured Q1-Q6 at the base, part 2 (this file) consolidates it with the orchestrator's readings and two git spot-checks (the merge parents of B and P; the probe at B, P and A). Writers sonnet/high, one file or one section each, sequential; reviewer opus/max, at most 3 rounds; docs only, no security round (void if any code, migration, workflow, script or secret-bearing file enters the diff). Every number below is MEASURED at base B = `07165d659e291e38c1477437cfc946bbdc19f55e` (merge of PR #108) in the lane worktree: branch `docs/p3-l31-docs-reconcile`; before this file's commit HEAD = B, `git status --porcelain` empty, no `index.lock`. P = `4aafb28586e036508dc6f0bab19110abd5c1c353` (merge of PR #107, the first parent of B); A = `acdd8612b0e0c4b92023b77555dd9b637c277936` (the base L31 started on).

## 1. Authority

- The owner's standing delegation of 2026-10-22, verbatim: "chọn các option mang lại lợi ích long term và tối đa cho pj" (recorded as conductor decision D14 of P3-S16). Lane block L33 is conductor-authored under it; every choice of this lane is "decided by the conductor under the owner's delegation of 2026-10-22, not an owner signature", and the owner can reverse any of them.
- Owner-signed means only the rows of DD-145's table; no text of this lane says owner-signed. Owner decisions needed: none; a source that cannot be found is a ruling request, never an invented fact (A1, A3). Hard dependency: PR #108 (L31) MERGED 2026-10-24T03:14:57Z, merge = B, PR head `1a760e6ebad7a6a7282c525cbadf8d2a00e89ecf`; PR #107 (L30) MERGED 2026-10-23T21:56:38Z, merge = P, PR head `b4e2dd823a8989a7747327501014ca2792ce03c3` (from `gh`, measured by the orchestrator on 2026-10-24; both parent pairs re-checked with `git show -s` in part 2).

## 2. Live truth at B

- Q1 claims about L31. Fix (current state, owned): backlog :6745 `status: blocked` and :6752 `merged_probe: null` (row `zalo-dm-delivery-age-expiry`), :6888 `status: idea` (watch row `ci-definer-role-class-flake-retire-watch`); decisions.md :120 (DD-148 summary row, the pending wording twice) and section F :1908, :1910, :1914 (D5), :1915-:1922 (DF0-DF7), :1923 (RO-L31-1, beyond the lead's list: R4); status doc :65 and :134. Leave: backlog :6754 (the row's history notes) and :6744, :6755, :6887, :6896 (no status claim); decisions.md :1767 (R1), :1787, :1789, :1864 (true), :1854 (a dated section D default), DD-146 :122, :1947, :1951, :1967 (true, negative scope) and :1968 (R2), :134 and :5065 (a DD-134 mention, a dated version row); status doc :16 (L30's dated line, A4) and :64 (R3); runbook :61, :71, :115 (DD-146 behaviour text); the readiness files of L29, L30 and L31 and `level3.1-design-discussion` (dated records, substring hits).
- Q2 probe: `merged_probe: apps/bot/src/dispatcher.ts :: zaloDmDeliveryAge`, a bare identifier: the declaration `export async function zaloDmDeliveryAge(` at :96 and its one guarded call at :304, before `deliver(job)` at :309 (`git grep -w` at B: exactly :96 and :304). `git grep -c -F` at B: dispatcher.ts 4 (:8, :63, :96, :304; the substring also matches `zaloDmDeliveryAgeBound`), dispatcher.test.ts 4, projector-registry.test.ts 1, `scripts/outbox-projector-enable.mjs` 2, docs 1; at P and at A: 0 in the whole tree. The reconcile reads `<file> :: <grep -E regex>` (`scripts/autopilot-backlog-reconcile` :140, `is_symbol_probe` :223-:226) and its `--check` reads only planned, ready and blocked rows, so after the flip only the probe re-check script (V2) checks the row. Format as the precedent :6441-:6457: `status`, `merged` and `note_merged` directly after `title`; `merged_probe` stays at :6752.
- Q3 DD-148 section F: heading :1908 `### F. Lane L31 (tạm dừng, chưa merge): chờ`, paragraph :1910, table header :1912-:1913, D5 :1914, DF0-DF7 :1915-:1922, RO-L31-1 :1923; summary row :120. Sections C and D use the columns `Mã | Lane, PR | Nội dung | Nguồn | Phương án bị bỏ | Cách đảo ngược` (:1851), and W3 copies their placement of the "default chờ owner ký" label. Sources the rows quote, not paraphrase: DD-146 :1947-:1968 (DF0 :1960 to DF7 :1967, each ending "Default chờ owner ký."; the 120 s window accepted at :1953) and readiness 8.4 (`docs/sessions/web-mvp-phase3-readiness-p3-zalo-dm-delivery-age-expiry.md:326`; PR #108 body :158); RO-L31-1's durable source is the PR #108 body :14 and :32-:36. Minimal wording: the heading and the paragraph say L31 merged as PR #108 (dated 2026-10-24, lane L33); each Lane, PR cell reads `L31, #108`; each DFn quotes DD-146's DFn up to "; loại" (which also drops DF6's stale "tới khi L31 merge" clause); D5's reversal follows section A (D1 :1776).
- Q4 status doc (134 lines at B): the dated lines :14-:16 have the form `> **YYYY-MM-DD** (phiên P3-Sxx, lane Lxx): ...`, with no separate last-updated line; ONE new dated line goes directly after :16 (P3-S16k, lane L33: the #108 and #107 merge facts from `gh`, the rows L33 flips and adds, D5 and DF0-DF7 not owner-signed); :65 takes the form of :63 (merged SHA, date, PR link, `L31 · DD-146`); :134 (item 9) the form of items 4 and 5 (:128, :130); :16 stays byte-identical.
- Q5 watch row :6886-:6901: :6888 becomes `status: merged`, with `merged` and `note_merged` lines after it (hand-close precedents :6616-:6635 and :6122-:6126); the title, `close_by` :6896 and the notes :6897-:6900 (REOPEN CONDITION :6898) stay byte-identical. CI runs measured by the orchestrator with `gh run view`, each conclusion success at attempt 1: PR #107 run 40029145358 (pull_request) and main push run 40030323498 (head P); PR #108 run 40056734780 (pull_request) and main push run 40057522117 (head B); one CI run per PR branch, so no rerun and no class failure after #105. The task line counted six run ids; the step-0 notes carry these four, so W1 cites only ids that `gh run view` shows (A3).
- Q5 new rows, appended after :6946 (the last line) in the format of :6934-:6946 (`status: idea`, `risk: P2`, `change_class: code`, `depends_on: []`, `invariants: [transport-zalo, retry-liveness]` as :6749, `manifest: null`, `merged_probe: null`, notes ending with a `Source:` line); no duplicate at B. `zalo-dm-send-deadline-into-deliver` ("pass a send deadline into `deliver()`", scope `apps/bot/src/projectors/zalo-dm.ts` and `apps/bot/src/dispatcher.ts`): the age is checked once before `deliver()` (dispatcher.ts :304, :309), `apps/bot/src/projectors/zalo-dm.ts:29` `ATTEMPT_BUDGET_MS = 120_000`, `:207` sends with `timeoutMs: Math.min(sendTimeoutMs, remaining)`, and DD-146 accepts the window (decisions.md :1953); source PR #108 body :88 (also :47). `zalo-dm-attempt-budget-monotonic-clock` ("measure the attempt budget on a monotonic clock", scope `apps/bot/src/projectors/zalo-dm.ts`): `:84` `now = Date.now`, `:88` `started = now()`, `:192` `remaining = ATTEMPT_BUDGET_MS - (now() - started)`, and `now` is also a test seam (:61); source PR #108 body :89. Both notes sit under the body's heading :86 "Out-of-scope notes from the security reviews".
- Q6 runbook `docs/runbooks/outbox-dispatch-enable-rollback.md`: at P its :61 carried "follow-up lane L31"; #108 rewrote that line, and at B 0 lines contain `L31` or `follow-up`: no edit, the runbook stays out of the diff.

## 3. Scope

- Ownership, exactly as lane block L33: `docs/autopilot-backlog.md` (the two rows of Q1 and the two new rows), `docs/standards/decisions.md` (DD-148 section F only, plus its summary row :120), `docs/sessions/web-mvp-program-status.md`, `docs/runbooks/outbox-dispatch-enable-rollback.md` (one sentence at most) and this file. This lane changes four of them: the backlog, decisions.md, the status doc and this file (not the runbook, Q6).
- Negative scope (lane block L33): no code, no test, no migration, no workflow or script change; no edit of a Reviewed spec or of docs/legal; no rewriting of dated changelog rows or of DD-146; no row that states a conductor decision as owner-signed; no fabricated fact (every PR number, SHA and run id from `gh` or `git`); PR #50 untouched. A diff outside the ownership list is a HALT.

## 4. Writer units and B3

- W1 backlog: flip `zalo-dm-delivery-age-expiry` by its probe (Q2; `merged_probe` set at :6752, the notes :6754 untouched) and close `ci-definer-role-class-flake-retire-watch` by hand (Q5); about 7 lines.
- W2 backlog: the two new rows (Q5); about 26 lines.
- W3 decisions.md: DD-148 section F heading, paragraph, D5, DF0-DF7 and RO-L31-1, plus the summary row :120 (Q3); about 13 lines; no version row (outside the ownership list).
- W4 status doc: :65, :134 and one new dated line after :16 (Q4); 3 to 4 lines.
- Sequential, one writer per unit, sonnet/high. B3 (pre-approved): at most 250 docs lines, 6 files, 0 code lines, 0 migrations; estimate about 50 lines in W1-W4 plus this file (at most 110): about 160 of 250, 4 of 6 files, 0 code lines, 0 migrations; none of the four targets is in `docs/standards/kit-pack-membership.json`.

## 5. Readings pinned

- R1 (decisions.md :1767, DD-148's Phạm vi bullet outside section F), R2 (DD-146 :1968 "Sổ ký": the rows are reconciled when L31 merges, which is what L33 does) and R3 (status doc :64, L30's self-dated row; GOAL item 3 names only the L31 row, item 9 and one dated line): LEAVE, dated text or outside the ownership list (A4); the new section F paragraph and the new dated line carry the 2026-10-24 reconcile; PR OPEN list F-1 and F-2.
- R4 (RO-L31-1, :1923, inside section F and owned, still "chờ: lane L31 chưa merge"): INCLUDE in W3. It stays a conductor ruling and D5 a conductor decision, both "decided by the conductor under the owner's delegation of 2026-10-22, not an owner signature"; DF0-DF7 stay "default applied, pending owner sign-off"; no row of this lane says owner-signed.
- R5 (PR #108 body :231: `zalo_dm_record_recipient` does not check the lease, `0057:225`): a readiness note, not a security-review note, so not one of the two new rows; OUT_OF_SCOPE, PR OPEN list F-3.

## 6. Verification

| # | Check | Expected |
|---|---|---|
| V1 | `pnpm review:check:changed` before every commit (for this file inside `check-and-commit.sh`, before the branch's first commit); the full `pnpm review:check` at the end; `pnpm format:check` (prettier on every changed file) | pass |
| V2 | `scripts/autopilot-backlog-reconcile --check`; a probe re-check script (a file, run with `bash`) on the final head | refused 2 and malformed 0 at B, at head malformed 0 and refused not above 2; `zaloDmDeliveryAge` present in `apps/bot/src/dispatcher.ts` at head and absent at A; the watch row has no probe (`close_by: hand`) |
| V3 | the audit tests that read the backlog or the decision log: `git grep -l -e autopilot-backlog.md -e standards/decisions.md -- '*.test.*'` at head, each run with its narrowest command (a DB-bound one only through `locked-run.sh`) | pass |
| V4 | GitNexus `detect_changes`; `git diff --stat B...HEAD`; the AI-reference grep on commit messages and the PR body | docs only, the four files; 0 |

## 7. Closure matrix (12 of 12)

| # | Gate | Evidence | Result |
|---|---|---|---|
| 1 | Authority snapshot pinned by SHA | `AUTHORITY_SHA` = B = the PR #108 merge = the worktree HEAD at step 0; every TARGET_FILES path exists at B or is this file | PASS |
| 2 | Decisions in scope are final | the lane records merge facts and makes no product decision; D5 and RO-L31-1 stay the conductor's, DF0-DF7 stay pending owner sign-off (section 5) | PASS |
| 3 | Scope IN/OUT and owner clear | section 3; docs only | PASS |
| 4 | Dependencies classified | PR #108 merged at B (hard); PR #107 merged at P; PR #50 is not one | PASS |
| 5 | Live schema and code match the claims | the probe at B, P and A (Q2); `zalo-dm.ts` :29, :84, :88, :192, :207 and `dispatcher.ts` :96, :304, :309 at B (Q5) | PASS |
| 6 | Data, API, state and auth contract complete | not applicable beyond HARD RULES: records only, no behavior change | PASS |
| 7 | Fail-closed, idempotency, order | no runtime behavior; one flip per row, dated history untouched, the probe re-check (V2) | PASS |
| 8 | Open questions in scope = 0 | R1-R5 pinned as readings inside the lane block (section 5); no new owner question | PASS |
| 9 | Acceptance matrix has expected results | section 6, V1-V4 | PASS |
| 10 | Migration, security and rollback pinned | no migration, no secret, no PII; rollback = revert the single docs PR | PASS |
| 11 | First slice has hard dependency merged | PR #108 is on main at B | PASS |
| 12 | Implementation handoff ready | Q1-Q6 with line anchors, the readings, the writer units, the verification table | PASS |

## 8. Findings for the PR OPEN list

- F-1 (R1, R2): two texts outside the ownership list still describe L31's rows as pending: decisions.md :1767 (DD-148's Phạm vi bullet quotes section F's old status) and DD-146 :1968 ("Sổ ký"); both left as dated text; :1767 is a one-clause follow-up the conductor may want, :1968 is information only.
- F-2 (R3): status doc :64, L30's own row, still says "số PR chưa có khi ghi dòng này" although PR #107 merged at P; left (self-dated; the new dated line states #107's merge facts); recommended for a later docs pass.
- F-3 (R5): PR #108 body :231 (readiness note: `zalo_dm_record_recipient` does not check the lease, `0057:225`) has no backlog row; OUT_OF_SCOPE for this lane.
- F-4 (process): the first step-0 reviewer ran to about 275k tokens of context, past the owner's token rule (stop at about 200k; no worker past about 250k); it handed off its measured answers, and this second reviewer consolidated them within the step-0 call budget.

## 9. Verdict

```text
REVIEW_POLICY_VERSION: 1.3
REVIEW_VERDICT: CODE_READY
REVIEWED_AT: 2026-10-24
AUTHORITY_SHA: 07165d659e291e38c1477437cfc946bbdc19f55e
BASE_BRANCH: main
TARGET_FILES:
  - docs/autopilot-backlog.md
  - docs/standards/decisions.md
  - docs/sessions/web-mvp-program-status.md
  - docs/sessions/web-mvp-phase3-readiness-p3-l31-docs-reconcile.md
SLICE: p3-l31-docs-reconcile
IN_SCOPE: docs-only reconcile after L31 merged as PR 108: flip the backlog row zalo-dm-delivery-age-expiry by its probe (apps/bot/src/dispatcher.ts :: zaloDmDeliveryAge); close the watch row ci-definer-role-class-flake-retire-watch by hand with the CI run ids of PRs 107 and 108, keeping its REOPEN rule; add the two follow-up rows from the out-of-scope notes of L31's security reviews; DD-148 section F (heading, paragraph, D5, DF0-DF7, RO-L31-1) and its summary row say L31 merged as PR 108 and point to DD-146 and readiness 8.4, with DF0-DF7 still default applied, pending owner sign-off; the program status row and item 9 say merged, plus one new dated line
OUT_OF_SCOPE: any code, test, migration, workflow, script, env or secret-bearing file; Reviewed specs and docs/legal; DD-146 and any DD body except DD-148 section F and its summary row; the runbook (no stale sentence survived PR 108); rewriting dated history (status doc line 16, DD-148 dated text); any owner-signature claim outside the DD-145 table; PR 50
G1_DECISION: PASS
G2_SPEC: PASS
G3_DEPENDENCY: PASS
G4_TEST: PASS
G5_SCOPE: PASS
G6_EXTERNAL: PASS
HARD_DEPENDENCIES: PR 108 (L31) merged on main, merge 07165d659e291e38c1477437cfc946bbdc19f55e = AUTHORITY_SHA
PRIOR_SLICES: L30 merged as PR 107 (merge 4aafb28586e036508dc6f0bab19110abd5c1c353); L31 merged as PR 108
OPEN_QUESTIONS_IN_SCOPE: 0
ENABLEMENT_ONLY_GATES: none
LIVE_REPO_VERIFICATION: PASS
CONTRACT_MATRIX: PASS
CLOSURE_MATRIX: PASS
ACCEPTANCE_MATRIX: PASS
SECURITY_AND_MIGRATION_GATE: PASS # docs only, no migration, no secret, no runtime change
IMPLEMENTATION_ARTIFACTS: PASS
FIRST_IMPLEMENTATION_STEP: W1 on docs/autopilot-backlog.md: flip zalo-dm-delivery-age-expiry by probe and close ci-definer-role-class-flake-retire-watch by hand; then W2 (the two new rows), W3 (DD-148 section F and the summary row) and W4 (status doc lines 65 and 134 plus one dated line after 16), one sonnet/high writer each, sequential
REMAINING_BLOCKERS: none
```
