<!-- review-readiness: code-ready -->

# Step-0 readiness: L60 p4-golden-path-pacer-deadline (session P4-S9)

> Agent-facing. Step 0 measured by the orchestrator (O), who also runs every database, e2e and local-server command under the program's DB/e2e lock. One writer W1 (opus); reviewers R1-R3 opus, one at a time (Claude subagents: the Web MVP program's named exception DD-122 D4), at most 3 rounds. RISK: P2 (test tooling only: no product code, no migration, no secret, no money). Base `dc1ca89bf759e9069d92f5e4d71bbf10e69aa3da` (main after `git fetch`, measured); branch `fix/p4-golden-path-pacer-deadline`; worktree `.autopilot/worktrees/p4-golden-path-pacer-deadline`; HEAD = base at step 0. Every `path:line` below was measured at the base. The orchestrator's notes live outside the repo, so this file restates every fact it relies on.

Short forms: H = `apps/web/e2e/support/golden-path-helpers.ts`, S = `apps/web/e2e/golden-path.spec.ts`, AC = `apps/web/lib/api-client.ts`, SCR = `apps/web/lib/session-command-route.ts`, WU = `apps/web/e2e/support/golden-path-warmup.ts`, VC = `apps/web/vitest.config.ts`, BL = `docs/autopilot-backlog.md`.

## 1. Authority

- **D44** of the conductor's decision log, "decided by the conductor under the owner's delegation of 2026-10-22, not an owner signature" (reversible: close the lane unmerged). The Phase 4 plan (`docs/sessions/web-mvp-phase4-plan.md` section 5) makes the local golden path the independent acceptance run of Phase 4; it failed on main, so fixing the cause is part of closing Phase 4. This lane is an ADDITION to the 17 lanes of the owner-approved plan, disclosed as such.
- **RO-L60-1**, a conductor ruling under the same delegation (Tier B, reversible): the confirmation experiment before any edit; database, e2e and local-server commands are the orchestrator's only, under the locked wrapper; the proof is two consecutive full runs; this file is the branch's first content commit; the review policy (section 8).
- **Negative scope** (the lane block): no product code (`apps/web/lib`, `apps/web/app`, `apps/web/components`, `packages/*`); no change to AC (the deadline), to `ACTOR_LIMIT`, to the dev-login gate or its network-exposure probe; no change to the other e2e specs or to `e2e/golden-path.config.ts`; no change to any assertion, locator, timeout or step of S; no migration; the smoke key and passwords are never printed.

## 2. Measured at base

### 2.1 The failure (the independent verifier's runs at the base)

- Two full runs of `e2e/golden-path.config.ts` on `dc1ca89bf759e9069d92f5e4d71bbf10e69aa3da`: 3 passed, 1 failed each (327 s and 316 s), the same test and step both times: S:270 "player golden path", step "the owner publishes an open session in Dev Club" (S:295), the toast "Đã đăng kèo." (S:320) never shows; the confirm dialog stays open with the client-timeout alert. `/dev-login` answered 307 in both runs (the exposure gate did not refuse). The last full PASS was 2026-10-25 on main `8086f8e`.
- The browser trace: `POST /api/sessions/<id>/publish` ended `net::ERR_ABORTED` after 14999 ms (run 2: 15004 ms); the dev server logged no line for it (the request never reached the server).

### 2.2 The two mechanisms

- The pacer (test-only), H:12-20 (doc comment), H:21 `WINDOW_MS = 60_000`, H:22 `BUDGET = 45`, H:23 `PACE_FILE` (a temp file shared by tests and back-to-back runs), H:36-53 `paceSessionApi(page)`: a `page.route` handler on `/api/sessions` that queues each browser request and holds it (the `setTimeout` loop at H:40-48) until fewer than `BUDGET` hits are in the last 60 s. Installed at S:54 (host test) and S:275 (player test); two more callers pass no argument: `apps/web/e2e/public-card-hide-address.spec.ts:136` (a local real-server run that CI ignores, `apps/web/playwright.config.ts:22`) and `apps/web/e2e/public-share-page.proof.ts:162` (not a spec); `apps/web/tsconfig.json:17` includes `e2e`, so both are typechecked (section 4). It exists because SCR:99 `ACTOR_LIMIT = { limit: 60, windowSeconds: 60 }` (SCR:116-118) limits every ACCOUNT to 60 session API calls per rolling 60 s; both tests sign in as the same owner persona (`/Chủ CLB/`, S:61 and S:296).
- The product deadline, AC:43-47 and AC:76-85: `API_TIMEOUT_MS = 15_000`; every GET/HEAD and every non-PATCH JSON command with a string `commandId` (and no caller `signal`) aborts 15 s after `apiFetch` calls `fetch()`. A request held in the browser by the pacer counts against it. Before L49 (PR #129) nothing aborted a held request, so the same hold was invisible.

### 2.3 Call counts (Q2)

- Host test: 41 paced calls: 8 warm-up calls through the browser's own `fetch` (WU:47-54) and 33 flow calls (the verifier's run-1 dev server log); its run-2 pace file holds the same 41 host hits within 17.6 s. At the head 51c260f4cfa41c262be39dbb84a71d07f2c4258a the host test made 42 paced calls in each of the three runs that reached the player test (the pacer's line at the player test's start: `42 of 45 used in the last 60 s`).
- Player test: 5 paced calls in 4.27 s (E1 below: POST create, two GETs, POST publish, one GET) plus one test-only join through `page.request` (S:343-350; the player's own account, and `page.request` is not intercepted by `page.route`).
- The verifier's run-2 pace file (45 hits over 59.166 s): 44 hits in the first 17.87 s, a 41.299 s gap, then the 45th hit at +59.166 s: the held publish released when the oldest hit left the window, about 41 s after it was queued, 26 s after the browser had aborted it.

### 2.4 The confirmation experiment (Q3, E1)

- Before: the pace file deleted (the test's own temp file); port 3000 without a listener; the network interface facts identical to the verifier's.
- Run: only the player test (`--grep "player golden path"`) under the lock: `/dev-login` answered 307; `✓ player golden path (30.7s)`, `1 passed (31.4s)`, exit 0; the projector registry before and after `public_sessions=false web_realtime=false zalo_dm=false`.
- Reading: with an empty window the publish POST is not held and the step passes; no later step failed. The cause is the pacer's hold meeting the product deadline, not a product defect.

### 2.5 Other facts

- VC:6 excludes `e2e/**` from vitest: a unit test next to H is not picked up (the lane block's condition for one is false), and VC is out of scope.
- `docs/runbooks/local-mvp-smoke.md` has no sentence about the pacer: no runbook edit.
- Playwright 1.63.0 (installed): a rejected route handler is rethrown (`playwright-core/lib/coreBundle.js:60149-60166`), the page's route dispatch is not awaited, so the rejection is unhandled, and the test worker fails the current test with that error (`playwright/lib/worker/workerProcessEntry.js:1382`, `:1460-1475`).

## 3. Design

- **D1 (the wait moves into the test).** `paceSessionApi(page, room)` first computes how long until at most `BUDGET - room` hits remain in the shared window, prints one stdout line (`golden path pacer: waiting <s> s for <room> free session API slots (<n> of 45 used in the last 60 s)`) and waits that long in test code; only then it installs the route handler. `room` is the test's measured number of paced calls plus 1 (2.3, D4): host 43, player 6. A test therefore starts its session API calls only when its whole run fits the budget, and the handler normally holds nothing. A caller that has not measured its calls gets the default `room = 1` (D7): today's rule, wait only for the next free slot.
- **D2 (the handler is a bounded backstop).** The route handler keeps the queue and `BUDGET`, but before every sleep it checks the hold so far plus the needed wait against `MAX_HOLD_MS = 8_000` (well under `API_TIMEOUT_MS`, imported from AC so the relation is checked, never copied). Beyond it, the handler aborts the request and throws one error naming the pacer, the request, the window count and the remedy (raise that test's `room`); the throw fails the test at once (2.5); once the page has closed (its test ended), the handler prints the error instead of throwing it, so a late error cannot fail the next test. A hold of 100 ms or more within the cap prints one stdout line (`golden path pacer: held <method> <path> <ms> ms`); a shorter hold is silent by design. A hold that would pass the cap is aborted instead (H:90, checked before each sleep), so the pacer's hold alone can no longer reach the 15 s client deadline: it leaves about 7 s of it for the server.
- **D3.** `PACE_FILE`'s path and JSON format, `WINDOW_MS` and `BUDGET = 45` stay (older runs share the window; the margin of 15 below the server ceiling stays).
- **One computation.** A single pure function gives the wait for `room` free slots from the sorted window; the pre-wait uses it with the test's `room`, the handler with 1 (the same rule as H:43-47 today).

## 4. Lead corrections

- The lane block's evidence line 3 cites the doc comment as H:13-19 and `paceSessionApi` as H:36-51: the comment block is H:12-20 (its text lines are 13-19) and the function is H:36-53 (the route handler H:38-52). Same code; line ranges only.
- Q1 (O) looked for `paceSessionApi` callers in S only and missed two (section 2.2); W1's typecheck found them (TS2554 with a required `room`). Resolved inside the lane's files by the default `room = 1` (D7); the two callers stay untouched and inherit the one-slot pre-wait and the bounded hold (A-10).
- The verifier's report left "whether the request left the browser" unmeasured: E1 (2.4) settles the cause by experiment.
- The lane block expects the second proof run to "start with a nearly full pace window". Measured: E1's whole run took 40 s, about 9 s of it before the test; after a full run's last paced call (the player test's) the chat tests and the setup of the next run follow, so the next host test may well start with an empty window. The proof records the pre-wait lines of both runs instead of assuming either; the hard case the pacer exists for is inside every run (the player test right after the host test's 41 calls).

## 5. Pinned defaults (Tier B; each "default applied, pending owner sign-off")

| # | Default | Rejected alternative |
|---|---|---|
| D1 | wait in the test before the calls (3, D1) | a bounded-hold release in the handler (a burst of queued requests still waits longer than 15 s each); removing the pacer (429s from the 60 per 60 s ceiling) |
| D2 | the 8 s backstop that fails the test with a pacer message (3, D2) | changing or removing the product deadline, or an env override of it for the golden path (product code for a test); a silent longer hold |
| D3 | `PACE_FILE`, `WINDOW_MS`, `BUDGET = 45` unchanged | a per-run file (back-to-back runs would no longer share the window) |
| D4 | `room` = the measured paced-call count per test plus 1: host 43 (42 measured at the head, 41 at the base), player 6 (5 measured); one call more than measured still leaves the handler nothing to hold, and the cost is a few seconds of waiting at a test start | exactly the measured count (the head's 42nd host call could then wait for an old hit, bounded by the 8 s cap but a hold); a larger margin (longer waits for no measured need; the backstop already names a drift); one global room (the player test would wait for the host test's whole budget) |
| D5 | no unit test (VC:6 excludes `e2e/**`; VC is out of scope); the proof is the two full runs with their wait and hold lines | editing VC; a test file outside the lane's files |
| D6 | `MAX_HOLD_MS` checked against the imported `API_TIMEOUT_MS` at module load (one source of truth for the deadline) | a copied 15 s literal (drifts silently if the product deadline changes) |
| D7 | `room` defaults to 1 (today's rule) for the two unmeasured callers (2.2); their files are not edited | editing them with an explicit room (outside the lane's negative scope "no change to the other e2e specs", for no measured need) |

## 6. Implementation steps

1. W1 (writer, no DB, no e2e): GitNexus `impact` on `paceSessionApi`; edit H (3) and the two call sites S:54 and S:275 (the argument and the trailing comment only); run the web typecheck, lint, `prettier --check`, `pnpm review:check:changed`; commit in the worktree.
2. O: the proof (section 7, A-1) under the lock, then R1 (section 8).
3. Fixes re-reviewed in round 2; round 3 is the last; then one push, the PR, CI.

## 7. Acceptance matrix (A-1..A-10)

| ID | Check | Where |
|---|---|---|
| A-1 | the full golden path TWICE in a row on the final head: both end `4 passed`; elapsed times recorded | O, locked wrapper |
| A-2 | no product file in the diff: `git diff --name-only` against the base lists only H, S, this file and BL; B3 non-test lines 0 | O, `git diff`; R1 |
| A-3 | no request is held beyond `MAX_HOLD_MS`: the check precedes every sleep (code); every `held` line of A-1 is at most 8000 ms and no backstop error occurs | R1; A-1 logs |
| A-4 | each test's wait happens in test code before its first session API call: the `waiting` lines of A-1 (at least the player test of each run) | A-1 logs |
| A-5 | `PACE_FILE`, `WINDOW_MS`, `BUDGET = 45` and the queue unchanged; the ceiling relation (45 below 60) stated | H diff; R1 |
| A-6 | S changes only the two `paceSessionApi` lines: no assertion, locator, timeout or step | S diff; R1 |
| A-7 | the backstop aborts the request (never left pending) and its one error names the pacer, the request, the window count and the remedy | H; R1 |
| A-8 | web typecheck, lint, `format:check`, `review:check:changed` and the full `review:check`, `pnpm build`, the backlog reconcile `--check` and `--audit` green | O |
| A-9 | before/after: at the base the verifier's two runs FAIL (3 passed, 1 failed, the publish step); at the head A-1 passes | 2.1; A-1 |
| A-10 | the two other callers (2.2) are unchanged and typecheck with the default `room = 1`; their behaviour changes in two ways: a pre-wait in test code for one free slot (H:64-72), which replaces the hold of their first request, and the bounded hold (before: a hold without limit; the 15 s client deadline aborted a held read or `commandId` command sent without a caller `signal` (AC:76-83), and any other request was held, then sent) | `git diff`; the web typecheck; R1 |

## 8. Verification and review

- TESTS: W1 runs only no-DB checks (typecheck, lint, prettier, `pnpm review:check:changed`). O runs the golden path (`gp-golden-path.sh` under the locked wrapper, sandbox off) for E1 and A-1, `pnpm build` (sandbox off), the reconcile `--check` and `--audit`, and the full `pnpm review:check`. CI runs the e2e-web job, not the golden path (S is local opt-in, S:22-28).
- REVIEW (RO-L60-1): R1, one code-reviewer (opus) ALONE on the whole diff: any path that still holds a request longer than the deadline; the wait across tests and back-to-back runs; `BUDGET` and the ceiling; no assertion or timeout weakened; no product file; the new messages. Round 2 on its fixes; round 3 the last (a P3 or lower is a docs- or comment-only fix labelled "fix applied after the final round, not re-reviewed (3-round cap)"; a P1 or P2, or any code or test-logic change, is a ruling request).

## 9. Budget (B3) and files

- Estimate (the lane block): 2-3 non-docs files, test lines up to 150 (H and S are e2e test tooling), non-test lines 0 (any non-test product line is a ruling request), 0 migrations; docs: this file and backlog rows (new-row cap 3).
- Edited: H, S (test tooling); BL (rows only). Read-only: AC (`API_TIMEOUT_MS` imported), SCR, the two other callers (2.2). New: this file.

## 10. Threat model

| # | Threat | Defended by |
|---|---|---|
| 1 | the fix hides a product timeout (a real slow server passes as a pacer wait) | the pacer waits only before a test's calls and holds at most 8 s; a product timeout still fails the test as before (A-3, A-6) |
| 2 | the golden path exceeds the server ceiling (429 "too fast") | `BUDGET = 45` and the shared window unchanged; the pre-wait makes room for the whole test (D1, A-5) |
| 3 | a weakened acceptance run | no assertion, locator, timeout or step changed (A-6) |

SECURITY_REVIEW: not required: the diff touches no auth, secret, money or external input; the pacer reads and writes only its existing temp file. This judgement is VOID if the diff starts to read or write any other file, touches the dev-login gate or its exposure probe, or changes product code: then one security round is added and the reason recorded.

## 11. Open

- **In scope: 0.**
- Out of scope, captured as backlog rows (cap 3, one mechanism each): the golden path is local opt-in and outside CI, so a product change that breaks it (here L49's deadline) stays unnoticed until someone runs it.

## 12. Closure matrix (12 of 12 PASS)

| # | Gate | Evidence | Result |
|---|---|---|---|
| 1 | Authority snapshot pinned by SHA | `AUTHORITY_SHA` = the worktree HEAD at step 0 (measured); every TARGET_FILES path exists at the base | PASS |
| 2 | Decisions in scope final | D44 and RO-L60-1 (conductor, under the owner's delegation); D1-D6 pinned as defaults pending owner sign-off (section 5) | PASS |
| 3 | Scope IN/OUT and owner clear | the lane block's FILE OWNERSHIP and negative scope (section 1); the files (section 9) | PASS |
| 4 | Dependencies classified | none; runs beside L45 (shared file only BL, end-of-file rule) | PASS |
| 5 | Live schema and code match | section 2 measured at the base; no schema, no migration | PASS |
| 6 | Data, API, state, auth contract | no product contract changes; the pacer's temp-file format unchanged (D3) | PASS |
| 7 | Fail-closed, idempotency, order | the backstop fails the test with a named error instead of holding (D2); the queue order unchanged | PASS |
| 8 | Open questions in scope = 0 | section 11 | PASS |
| 9 | Acceptance matrix with expected results | section 7 (A-1..A-10) | PASS |
| 10 | Migration, security, rollback | no migration; no security round, with its voiding condition (section 10); rollback = revert the PR | PASS |
| 11 | First slice hard dependencies merged | W1 depends on nothing unmerged | PASS |
| 12 | Implementation handoff ready | sections 3 and 5-7; W1 has every input | PASS |

## 13. Verdict

```text
REVIEW_POLICY_VERSION: 1.3
REVIEW_VERDICT: CODE_READY
REVIEWED_AT: 2026-10-28
AUTHORITY_SHA: dc1ca89bf759e9069d92f5e4d71bbf10e69aa3da
BASE_BRANCH: main
TARGET_FILES:
  - apps/web/e2e/support/golden-path-helpers.ts (edited: the pre-wait, the bounded hold, one wait function, the doc comment)
  - apps/web/e2e/golden-path.spec.ts (edited: the two paceSessionApi call sites only)
  - apps/web/e2e/public-card-hide-address.spec.ts (read-only: calls paceSessionApi with the default room)
  - apps/web/e2e/public-share-page.proof.ts (read-only: calls paceSessionApi with the default room)
  - apps/web/lib/api-client.ts (read-only: API_TIMEOUT_MS imported by the helper)
  - apps/web/lib/session-command-route.ts (read-only: ACTOR_LIMIT)
  - docs/autopilot-backlog.md (edited: new rows only, cap 3)
SLICE: p4-golden-path-pacer-deadline
IN_SCOPE: the golden path pacer in golden-path-helpers.ts (wait in the test before a test's session API calls, an 8 s bounded hold that fails the test with a pacer message); the two pacer call sites of golden-path.spec.ts; backlog rows; this readiness file
OUT_OF_SCOPE: product code (apps/web/lib, apps/web/app, apps/web/components, packages/*); API_TIMEOUT_MS and ACTOR_LIMIT; the dev-login gate and its exposure probe; golden-path.config.ts and the other e2e specs; any assertion, locator, timeout or step of the spec; the vitest config; migrations; PR #50
G1_DECISION: PASS
G2_SPEC: PASS
G3_DEPENDENCY: PASS
G4_TEST: PASS
G5_SCOPE: PASS
G6_EXTERNAL: PASS
HARD_DEPENDENCIES: none
PRIOR_SLICES: L49 (merged, PR #129: the 15 s client deadline)
OPEN_QUESTIONS_IN_SCOPE: 0
ENABLEMENT_ONLY_GATES: none
LIVE_REPO_VERIFICATION: PASS
CONTRACT_MATRIX: PASS
CLOSURE_MATRIX: PASS
ACCEPTANCE_MATRIX: PASS
SECURITY_AND_MIGRATION_GATE: PASS # no migration; no security round (test tooling; void if the diff reads or writes another file, touches the dev-login gate or product code); rollback = revert the PR
IMPLEMENTATION_ARTIFACTS: PASS
FIRST_IMPLEMENTATION_STEP: W1 - GitNexus impact on paceSessionApi, then edit golden-path-helpers.ts (the wait function, the pre-wait, the bounded hold, the doc comment) and the two call sites of golden-path.spec.ts; no-DB checks; commit in the worktree
REMAINING_BLOCKERS: none
```
