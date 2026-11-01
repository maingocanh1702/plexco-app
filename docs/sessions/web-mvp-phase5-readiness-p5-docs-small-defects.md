<!-- review-readiness: code-ready -->

# Step-0 readiness: L87 p5-docs-small-defects (session P5-S16a)

- **0 Status.** Agent-facing. Written by writer unit W1b (the fresh continuation of W1, which spent its budget reading and made no edit) as the branch's first commit, before the fixes: the readiness record is the writers' authority. Source: step 0 (three read-only reader units) at base 9eee265be97ea37947a87a9ad38594c5771e0289; each lead was read in the live worktree at that base, not taken from prose. Readers used: 3 of 3 (the cap of the owner's 16:40 rule of 2026-10-30, recorded as DD-157). Every replacement text is applied by an exact-string edit against the base, so an old text that does not match fails loudly. The record is English; the replacements that go into Vietnamese files (the go-live plan, the decision log) keep those files' language.
- **1 Authority.** B = `9eee265be97ea37947a87a9ad38594c5771e0289`, origin/main at the lane start (the merge of PR 156; the worktree HEAD equals B and the tree is clean). Paths: WS = `.github/workflows/deploy-staging.yml`, WP = `.github/workflows/deploy-production.yml`, AS = `infra/app.staging.yaml`, AP = `infra/app.prod.yaml`, DF = `infra/Dockerfile`, G = `docs/sessions/web-mvp-phase5-golive-plan.md`, BL = `docs/autopilot-backlog.md`, D = `docs/standards/decisions.md`, E = `docs/standards/environments-setup.md`, M = `docs/runbooks/env-manifest-staging-production.md`, O = `docs/runbooks/outbox-dispatch-enable-rollback.md`, WD = `infra/wait-for-deployment.sh`. The authority is the lane block of lane L87 as issued by the conductor; this record makes no owner decision. Every lane choice below (D1, D2, the line-count deviation, the wording) is "decided by the conductor under the owner's delegation of 2026-10-22", not an owner decision.

## §1 Step-0 table (items 1-6 and 8, each re-read at B)

| item | location at B | short quote (verbatim fragments) | verdict | outcome |
|---|---|---|---|---|
| 1 | WS:14-16 | `# DISPATCH THE WORKFLOW FROM THE COMMIT YOU WANT TO DEPLOY (branch/tag picker in the Run workflow` | STILL WRONG | re-worded to "from `main` only", 3 lines for 3 lines (deviation, §3) |
| 1 | WS:24-26 | `# migrations: lane L82 changes the image entrypoint for it and must merge before the first real` | STILL WRONG | re-worded: provisioning runs after the migrations in the same shell, lane L82 merged; 3 lines for 3 lines |
| 1 | WP:3-12 | `workflow_dispatch with a typed confirmation` | ALREADY CORRECT | untouched: no branch or tag picker claim |
| 2 | O:219 | `(DD-146 ... DD-149 ... docs/standards/decisions.md)` | ALREADY CORRECT | cites by decision ID, no line number; the whole file holds no line cite of D or E; untouched |
| 3 | G:228 | `DD-129 (docs/standards/decisions.md:144` | STILL WRONG | D:144 is the DD-134 index row; DD-129 has only an index row (D:149), no heading: cite "DD-129" by name |
| 3 | G:228 | `"protected CI job" ... docs/standards/environments-setup.md:357` | STILL WRONG | E:357 is a shell line in section 4.1; the sentence is in E section 5 ("Keep `DATABASE_URL_MIGRATION` in the protected CI environment/job only"): cite the section |
| 3 | G:240 (two cites) | `environments-setup.md:66` and `environments-setup.md:81` | STILL WRONG | E:66 is blank, E:81 is the ApiPay row; the "Gate status" paragraph and the rule "Until the gate closes, do not create the App Spec" are in E section 1.1 (`### 1.1 Fixed outbound-IP gate`): cite the section |
| 3 | G:200 | `L66, L67 (environments-setup.md:81)` | STILL WRONG | same class, same file, same fix as G:240 |
| 4 | BL:925 | `docs/standards/environments-setup.md:81 ("Until the gate closes, do not create the App Spec` | STILL WRONG | the cite only becomes "environments-setup.md section 1.1"; the dated 2026-10-28 paragraph is otherwise untouched |
| 5 | BL:7764-7777 (older row), BL:8075-8090 (new row) | older :7777 `that part is now carried by the row p5-wait-for-deployment-selects-by-id-or-created-at`; new :8088 `Related: constraint (1), await the deployment by id, of the row p5-deploy-awaits-deployment-id-and-keeps-spec-out-of-logs` | ALREADY CORRECT (both rows `status: idea`, cross-referenced both ways) | NOT superseded (§4); append-only G1 after BL:7777 and G2 after BL:8088; no field of either row changes |
| 6 | E:429 | `3. Then, in the same job and shell and with the same job-scoped credential, run provision:queue` | ALREADY CORRECT | untouched |
| 6 | M:71 | `DATABASE_URL_MIGRATION ... PRE_DEPLOY ... lane L82 ... provision:queue` | ALREADY CORRECT | untouched |
| 6 | O:161 | `lane L82 ... provision:queue ... 78-85 ... 84` | ALREADY CORRECT | untouched |
| 6 | AS:66-68 and AP:53-55 | `# Runs the database migrations with the new image. kind is written explicitly: an unspecified kind` | STILL WRONG (incomplete) | comment says the job only runs the migrations; it also runs the queue provisioning in the same shell; 3 lines each, same count |
| 6 | DF:74 | `# PROCESS_ROLE ... {web, discovery, worker} ... default web` | STILL WRONG (incomplete) | the entrypoint accepts five roles; lists all five and what `migrate` does; 1 line |
| 8 | D:126 and D:2009 (DD-152), D:1994 (DD-153), D:1840 (DD-157) | `at most TWO live sub-agents in total at any moment`; `at most one worker, reviewer or verifier live under it`; `fan out subagents` | ALREADY CORRECT | each owner text equals the conductor's record of the owner's decisions of 2026-10-26 (22:45, 16:46) and 2026-10-30 (14:59, 16:40); untouched |
| 8 | D:1998 (DD-153 related-entries bullet) | names `DD-152` and `DD-151` only | STILL WRONG (navigation only) | G3: one dated addendum bullet after D:1998 pointing to DD-157; no existing line changes (D2, §2) |

**Item 1 proof.** The main-only rule lives in `docs/runbooks/staging-deploy.md` (heading `### 2.4 GitHub environment`: the `Deployment branches` rule of both environments is the branch pattern `main`) and in `docs/sessions/web-mvp-phase5-readiness-p5-deploy-workflows.md:152` ("SR1-4 is an owner step (environment deployment branches = main)"); the go-live plan's step 8.5 row does not state it, so the new WS text cites the runbook, by heading text and not by number because lane L88 edits that file. The other clauses of the WS header are true and stay: manual-only trigger (`on:` holds only `workflow_dispatch`), the `staging` environment with one owner approval, the build uses github.sha (the checkout has no `ref:` and the image tag is the `git rev-parse HEAD` value), and WP:98 verifies the staging run by its head_sha. WS:24-26: `infra/entrypoint.sh:78-85` runs the migrations and then `exec`s `provision:queue` in one shell under `set -eu` (:5), so a failed migration exits before the queues, and lane L82 has merged.

## §2 Decisions (closed, decided by the conductor under the owner's delegation of 2026-10-22)

- **D1 (item 3).** G gets only the 5 cites on :200, :228 and :240 (named by the lane). Re-measured at B with `grep -n -o`: G holds 30 cites of the form `decisions.md:N` or `environments-setup.md:N` on 25 lines (source lines 14 x3, 42 x2, 48, 62, 63, 64, 74, 76, 78, 81, 113, 115, 123, 126, 128, 159, 168, 200, 228 x2, 240 x2, 248, 254, 276, 285, 342; the first probe printed 31, the re-measure wins; bare cites such as `(:64)` are not in the count). This lane edits 5 cites on 3 lines and does NOT edit the other 25 cites on 22 lines; they are reported to the conductor as an out-of-scope finding, each with its right anchor by name. The class is therefore not claimed fixed.
- **D2 (item 8).** One addendum bullet, G3, goes under DD-153 as a new line directly after D:1998 (D:1999 is blank, D:2000 is the `---`), with no blank line before it because the bullets are consecutive. Nothing else in D changes: no index row, nothing under DD-152 or DD-157. Read at B: D:119-127 and the 16:40 section of the conductor's record of the owner's decisions of 2026-10-30.
  - Index rows: D:120 DD-158; D:121 DD-157 (its source cell lists DD-153, DD-122 D4 and DD-158, so it points back to DD-153); D:122 DD-156; D:123 DD-155; D:124 DD-154; D:125 DD-153 (source cell lists the Phase 4 RUN doc, DD-152 and DD-151; its status cell has no pointer to DD-157); D:126 DD-152 (status cell ends with a dated replaced-by pointer to DD-153, 27/10 16:46); D:127 DD-151 (ends with a dated replaced-by pointer to DD-152, 26/10 22:45). The log puts a dated replaced-by pointer on the older row when a later rule REPLACES it; DD-157 AMENDS DD-153, so G3 adds the pointer under the DD-153 body only.
  - Owner record, 16:40 section: the three lines before the typed part are a blank line, the label "Typed part, verbatim:" and a blank line; the typed text is the next line. The pasted block (the line before) stops mid-sentence at "never past about 250k" and the typed line continues "), at most 2 lanes, one writer per worktree, merges one at a time.", so the join that DD-157 states (D:1852) is right. DD-157 carries the pasted block plus the typed part up to "merges one at a time." (D:1854) and states (D:1856) that the rest of the typed part, from "Record this verbatim" on, is not in the entry. That rest holds the recording instruction and the owner's one-off words of 16:49 about who merges PR 150 (already executed). DD-157 leaves them out on purpose and says so; this lane does not edit DD-157.

## §3 Item 1 line-count deviation

The reader's proposed text for WS:14-16 had 4 lines. This lane writes 3 (the same clauses, re-wrapped). Reason: `docs/runbooks/staging-deploy.md`, lane L88's file, pins about 29 lines of `WS:<n>` cites to WS lines after :16 (a grep capped at 30 hits printed 29); one extra line would move every one of them by one, which is the drift class this lane fixes. WS:24-26 is 3 lines for 3 lines too, so every WS line number after :16 is unchanged. Decided by the conductor.

## §4 Item 5: why the older row is not superseded

The older row `p5-deploy-awaits-deployment-id-and-keeps-spec-out-of-logs` covers more than the new row `p5-wait-for-deployment-selects-by-id-or-created-at` (scope: WD and its test only). (1) The deploy-path false success of an unchanged digest (a config-only redeploy passes at once on an earlier ACTIVE deployment): `active_deployment` appears in neither deploy job, only in step R4 of the rollback jobs. (2) The workflow side of a fix by id: the WD call sites in both deploy workflows pass only the app id, a digest and a timeout, and the new row's scope omits both workflows. (3) The standing check that the rendered App Spec stays out of logs, and (4) the standing check that WD is never traced, both re-measured at B and still met (no `tee`, `set -x`, `bash -x`, `xtrace` or `SHELLOPTS` in either workflow; `set -euo pipefail` is the only shell option line of WD). Closing the older row as superseded would lose (1), (2) and the only home of (3) and (4), so it stays open, and G1 and G2 record the split in both rows' notes.

## §5 Not in scope (recorded, not edited)

- The dated `:7752` cite inside the row at BL:7832 (labelled with its own older base: history, not a defect).
- `docs/runbooks/staging-deploy.md:94` (lane L88's file): after the item 1 fix it describes the old WS comment ("WS:14-16 still mentions a branch picker"); reported to the conductor.
- The owed list in `docs/sessions/web-mvp-phase5-readiness-p5-docs-reconcile.md` (line 56, the "Owed, NOT this lane" paragraph): `infra/Dockerfile:74` and the App Spec header comments are that debt and item 6 pays it; that dated record is not rewritten, nor are the other dated readiness records that list WS:14-16 as owed.
- The other 25 stale cites on 22 plan lines (D1), WP (already correct), `infra/entrypoint.sh` (its separate `provision)` arm stays), any code, any hand-set backlog status, any dated record.

## §6 Acceptance (checked before the second commit)

- WS: two hunks only (:14-16 and :24-26), 3 lines for 3 lines, no later line moves.
- AS, AP, DF: every changed line, old and new, is a `#` comment line outside any block scalar, no blank-line change, line counts 3, 3 and 1; `pnpm test:infra` passes.
- G: the 5 cites on :200, :228 and :240 are replaced by name, no other plan line changes. BL: the :925 cite only, G1 after :7777 and G2 after :8088 as new notes lines with the notes' two-space indent, no field change. D: G3 is one new line after D:1998, no existing line changes.
- The diff's file list is the seven target files plus this record; attribution and closing-keyword greps are clean; `pnpm review:check:changed` runs before each commit.

## §7 Verdict

Closure matrix (12 rows): 1 authority pinned by SHA PASS (B; TARGET_FILES = the seven existing target files); 2 decisions in scope final PASS (D1 and D2 closed, labelled with the delegation); 3 scope and owner clear PASS (seven files, comment and docs lines only, the lane block's ownership); 4 dependencies classified PASS (L82 and L83 are in B; L88 edits a different file and is not touched); 5 live repo matches the claims PASS (every lead re-read at B, §1; the G cite count re-measured by `grep -n -o`); 6 data, API, state and auth contract PASS (comments and docs only; no schema, status or contract change); 7 fail-closed PASS (no hand-set status, no dated record re-pinned, the older backlog row kept open, owner words verbatim or not at all); 8 open questions in scope = 0 PASS (D1, D2 closed); 9 acceptance matrix PASS (§6); 10 migration, security, rollback PASS (no migration, no secret value, no runtime change); 11 hard dependency merged PASS (L82, L83 in B); 12 handoff ready PASS (§1 and §2 give each edit its exact location and form).

```text
REVIEW_POLICY_VERSION: 1.3
REVIEW_VERDICT: CODE_READY
REVIEWED_AT: 2026-11-01
AUTHORITY_SHA: 9eee265be97ea37947a87a9ad38594c5771e0289
BASE_BRANCH: main
TARGET_FILES:
  - .github/workflows/deploy-staging.yml
  - infra/app.staging.yaml
  - infra/app.prod.yaml
  - infra/Dockerfile
  - docs/sessions/web-mvp-phase5-golive-plan.md
  - docs/autopilot-backlog.md
  - docs/standards/decisions.md
SLICE: p5-docs-small-defects
IN_SCOPE: lane L87, comment and docs lines only: the WS header comment lines 14-16 and 24-26; the three-line job comments in the two App Specs and the one-line role comment in infra/Dockerfile; the five stale cites on lines 200, 228 and 240 of the go-live plan; the stale cite at backlog line 925 and the two append-only notes G1 and G2 (the older wait-by-id row stays open); one addendum bullet G3 under DD-153; this readiness file
OUT_OF_SCOPE: deploy-production.yml; infra/entrypoint.sh; the other 25 stale plan cites; docs/runbooks/staging-deploy.md (lane L88); any dated record or dated readiness file; any hand-set backlog status or new backlog row; any code, schema or migration; any edit under DD-152 or DD-157; any index row of the decision log
G1_DECISION: PASS
G2_SPEC: PASS
G3_DEPENDENCY: PASS
G4_TEST: PASS
G5_SCOPE: PASS
G6_EXTERNAL: PASS
HARD_DEPENDENCIES: L82 (PR 151) and L83 (PR 154), merged before AUTHORITY_SHA per the lane block
PRIOR_SLICES: L64 env manifest, L67 deploy workflows, L71 outbox runbook, L82 entrypoint, L83 docs reconcile on main (read only)
OPEN_QUESTIONS_IN_SCOPE: 0
ENABLEMENT_ONLY_GATES: none
LIVE_REPO_VERIFICATION: PASS
CONTRACT_MATRIX: PASS
CLOSURE_MATRIX: PASS
ACCEPTANCE_MATRIX: PASS
SECURITY_AND_MIGRATION_GATE: PASS # comment and docs lines only, no migration, no secret value, no runtime change
IMPLEMENTATION_ARTIFACTS: PASS
FIRST_IMPLEMENTATION_STEP: W1b edits the seven target files exactly as in sections 1 to 4 (comment and docs lines only), runs pnpm test:infra, then commits the seven files once
REMAINING_BLOCKERS: none
NEXT_REVIEW_TRIGGER: re-issue this verdict if a target file changes on main before the L87 PR merges (every line window above is pinned to the base), if lane L88 moves a WS cite that needs a new pin, or if the conductor widens D1 to the other 25 plan cites
```
