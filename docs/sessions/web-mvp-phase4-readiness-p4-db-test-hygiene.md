<!-- review-readiness: code-ready -->

# Step-0 readiness: L55 p4-db-test-hygiene (session P4-S1a)

> Agent-facing. Step-0 readiness reviewers: opus/high, split by area (RA + RA2: the guard and TTL rows; RB + RB2: the bootstrap order, size and
> run plan). This file was written by the step-0 readiness-file writer (opus/high). Writers: W1 opus/high, W2 sonnet/high, W3 opus/max, W4 sonnet/high.
> Code reviewer: opus/max, one role in two area units (R1a, R1b), at most 3 rounds. No security round (test code only; this judgement is void if any
> production file enters the diff). RISK: P2 (test code only). Base `2ff2fd736284d0004f23737967516049f8a9cc0a` (main, the merge of PR #114); branch
> `test/p4-db-test-hygiene`; worktree `.autopilot/worktrees/p4-db-test-hygiene`, clean at step 0 (measured: HEAD = base, `status --porcelain` empty).
> Every `path:line` below was MEASURED at the base by the step-0 reviewers. Their notes live outside the repo (session notes P4-S1a:
> `step0-RA-guard-ttl.md`, `step0-RB-bootstrap.md`), so this file restates every fact it relies on. No tracked file was edited at step 0. The guard ran
> once; no DB suite ran.

## 1. Authority

- The owner's written approval of 2026-10-26, verbatim: "Phase 4 plan approved, Q1-Q10 default". It is the owner's own decision. It approves
  `docs/sessions/web-mvp-phase4-plan.md` (merged as PR #114), whose section 3 row L55 is this lane. None of Q1-Q10 touches L55.
- Lane contract: lane block L55 of the conductor-authored P4-S1a session brief (not on main): GOAL items 1-5, FILE OWNERSHIP, NEGATIVE SCOPE, THREAT
  MODEL, B3.
- RO-L55-1, a conductor ruling, decided by the conductor under the owner's delegation of 2026-10-22, not an owner signature. Verbatim: "the files ceiling
  of lane block L55 rises from 10 to 12; the other ceilings stay (600 test lines, 0 non-test lines, 0 migrations); record the measured count and this
  ruling in the readiness file and the PR body".
- Every other choice in this file is labelled "default applied, pending owner sign-off" (section 6) and is repeated in the PR body.

## 2. Measured at base

- The rows (`docs/autopilot-backlog.md`), all `status: idea`, `risk: P2`, `change_class: test-infra`:
  - `db-test-link-code-ttl-upper-bound-host-clock-flake` at :6492-6505. Its merged_probe is `packages/db/src/identity-link-code.test.ts :: remainingTtlMs`.
  - `db-test-nonsuperuser-owner-bootstrap-jobd-before-chat-slot-hold-and-wait`: the heading is at :6520 (measured; the row's end was not re-measured).
    Its merged_probe is `bootstrapAndMigrateAsOwner`.
  - `db-test-role-isolation-guard-residual-p3s` at :6880-6893. Its merged_probe is `null`. The row's source is PR #105's body, section "Review",
    line 49, which matches the row.
- Both probes are absent at the base. `git grep -c -e bootstrapAndMigrateAsOwner -e remainingTtlMs -- packages apps` found nothing (exit 1).
- The guard is green at the base, and it needs no database. `vitest.config.ts` has no `globalSetup` and no `setupFiles`.
  - Command: `pnpm --filter @plexco/db exec vitest run src/role-hiding-isolation-guard.test.ts`.
  - Result: 1 file, 3 tests passed, 416 ms.
  - It scans 577 files, by root: apps/bot 36, apps/web 411, packages/core 22, packages/db 108. The single floor is `> 550` (:145-146).
- `packages/db/src/test-harness.ts` is a test helper, and its lines count as test lines (b3-measure.sh shows it on its own line).
  - Measured: `git -C W grep -l test-harness -- packages apps` lists 77 files, and none of them is production code.
  - 71 of them are `.test.ts` files. 3 are test helpers: `test-harness.ts` itself, `packages/db/src/roster-money-fixtures.ts` and
    `apps/bot/src/test-db.ts`. Both of those helpers are imported only by `.test.ts` files (`git grep -l -e roster-money-fixtures -e /test-db`).
  - The 3 non-TS hits only mention the name: prose at `packages/db/README.md:365`, and SQL comments at migrations `0037...:13` and `0042...:11`.
- Lead corrections (the file wins; repeated in the PR body):
  - JCL-1's hand-off is at `rls-invariants.test.ts:2120-2122`, and its jobd hold runs to :2167. The lead said about :2104 / :2104-2107.
  - The floor margin is 27 files over 550 at this base. The row's "24" was measured at e37411a (574 files).
  - The four P3s do not all "only fail closed". Only P3-3 fails closed only. P3-1 also has a false-GREEN path, so it can hide a violation. P3-2 and
    P3-4 are coverage gaps, which stay green by nature.
  - The BR-6 tail pin is `migrate.test.ts:769`.
  - The fix covers 12 jobd-first sites plus W1, not the lead's five files plus two `migrate.test.ts` sites:
    - The `migrate.test.ts` sites :4337, :4465, :4677, :4705 and :5102 ARE wrapped in `withJobDefinerLock`.
    - The row and PR #62 both miss two chat-slot requesters: `migrate.test.ts:3369-3370` (W1) and :383 (C3).
    - PR #62's harness option is "slot and jobd all-or-nothing"; the row's probe is the ordered form.

## 3. Guard residuals (`packages/db/src/role-hiding-isolation-guard.test.ts`, 207 lines)

How the guard works today:
- `scan()` (:91-102) blanks comments through STRIP (:21-22), whose callback is at :92. It then matches STATEMENT (:24), exempts object grants and
  per-database settings (:95-97), and pushes the SHARED/DYNAMIC regions and the MUTATORS names.
- PINS (:55-88) are 24 `file, text, count` entries, 8 of them from MUTATORS (:40-49). The checks are at :129-144 and the floor at :145-146.
- The guard scans its own file, so every fixture splits its keywords the way :116 and :121 do.

- **P3-1, regex literals** (STRIP :21-22, callback :92).
  - The miss:
    - (a) False green: `/[/*]/` opens a "comment" that blanks a later role statement.
    - (b) False red: a regex literal holding a backtick keeps a later real comment.
  - Red tests:
    - P3-1a: a regex literal, then a query template with the :116 statement, then a block comment. It expects the region; current `[]`.
    - P3-1b: a backtick regex, then a commented statement. It expects `[]`; current flags the statement.
  - Fix: one STRIP alternative for a regex literal (D1).
  - Accepted-set proof: the stripped text changes in 11 files, but the hits change in 0 files.
- **P3-2, a move within one file** (PINS :55-88, check :129-132).
  - The miss: a pin carries no position, so a reviewed hit can move to an unreviewed context inside its file and keep its count.
  - Red test: factor :129-140 into a pure function over a hits map, then move `IF EXISTS ${ownerRole}` (`test-harness.ts:1063`) to another scope in
    the fixture map. Count pins: mismatched 0 (blind). Scoped pins: mismatched 1, naming `packages/db/src/test-harness.ts`.
  - Fix: scope-keyed pins (D2).
  - Accepted-set proof: 36 pinned hits give 34 scoped rows. At the base, mismatched is 0, outside is 0, and the keys are equal. MUTATORS becomes 18
    name-and-scope rows.
- **P3-3, a bare grant/revoke before `;`** (STATEMENT :24, SPLIT_LIST :29, DYNAMIC :35-36).
  - The miss: `return grant;` leaves an empty region and gives a false red.
  - Red test: `scan("return gr" + "ant;")`. Current `[""]`; after the fix `[]`.
  - Fix: D3.
  - Accepted-set proof: 0 empty-region hits at the base; P3-1 + P3-3 together change the hits of 0 files; the :116, :117 and :121 expectations
    PASS before and after.
- **P3-4, the single floor** (:145-146).
  - The miss: a lost root or subtree smaller than the margin passes silently.
  - Red test: drop packages/core (22 files). The total is 555, so the single floor still passes, while the per-root floors fail on packages/core.
  - Fix: D4.
  - Accepted-set proof: no root is under its floor at the base.

## 4. TTL helper (`packages/db/src/identity-link-code.test.ts`)

The code at the base:
- :254 is the account-issued `it` (10-minute TTL).
- :261-266 compare `first.expiresAt.getTime() - Date.now()` with `(LINK_CODE_TTL_SECONDS - 30) * 1000` (lower bound) and with
  `LINK_CODE_TTL_SECONDS * 1000` (upper bound, no tolerance).

Where the expiry comes from:
- `identity.ts:27` sets `LINK_CODE_TTL_SECONDS = 10 * 60`. `identity.ts:212-213` selects from `link_code_issue(..., make_interval(secs => $6), ...)`,
  :220 passes the TTL and :234 returns `expiresAt: r.expires_at`.
- `link_code_issue` is created once, at `0043_identity_link_code_issue_consume.sql:112`. It returns a table (:121). Its INSERT sets
  `clock_timestamp() + p_ttl` (:212) and returns with `RETURNING ... lc_ret.expires_at INTO ...` (:213-214).
- So the returned `expires_at` IS the stored value, set on the database clock. Nothing in 0043 sets it later.
- Schema: `packages/db/schema.ts:92-93` (`link_codes`, `id` primary key) and :104 (`expires_at`).

The design (D5):
- `remainingTtlMs(linkCodeId)` sits beside `row()` (:99-106) and goes through `ctx.owner`. It runs ONE statement:
  `SELECT extract(epoch FROM expires_at - clock_timestamp())::float8 * 1000 AS ms FROM link_codes WHERE id = $1`.
  - Both operands are on the database clock.
  - The `::float8` cast is needed because `extract` returns numeric, which node-pg hands back as a string.
- The two assertions read `ttlMs` from the helper and keep the 30 s lower margin. The upper bound then holds exactly. No sleep, no retry.
- Other clock mixes in the file:
  - :133-134 use the host clock only.
  - :405 (`lockedUntil` against `Date.now()`, 5 s cooldown at :401-403) is excluded by the row itself; confirmed out of scope.
  - :652 runs on the database only.

## 5. Lock map, decision table, order proof (`packages/db/src/test-harness.ts` and the sites)

Every harness session lock is taken on `base` (DATABASE_URL_TEST), so they share one lock space.

| Lock | Mode | Held | file:line |
|---|---|---|---|
| chad 0x63686164 (chat slot) | X, own client | `acquireChatDefinerLock` to `release()`; in an owner context from `bootstrapChatDefinerForOwner` (:969) to `teardown()` | :482, :508-557 |
| chad, then chst (chat window) | X, array order | the fn | `withChatDefinerLock` :490-493 |
| jobd 0x6a6f6264 reader | S, `lockAllShared` :621-636 (never holds while it waits) | the fn | `withJobDefinerLock` :573-575 |
| jobd breaker | X | the fn; only migrate.test.ts calls it | `withJobDefinerBreakerLock` :578-580 |
| jobd + chst reader | S, all-or-nothing | the fn | `withDefinerReadLock` :583-586; the bot's `withJobDefinerLock` (apps/bot/src/test-db.ts:36-37) |
| idnm 0x69646e6d | S or X, taken before the chat and job locks | the fn | :647, :649-677 |
| plxc 0x706c7863; jdlk/cdlk/idlk | X; xact X | one 01 run or one migrate(); the script transaction | :245-262, migrate.ts :31, :195, :390 |

| Site | Order today | Holds while it waits | Order after |
|---|---|---|---|
| H1-H3 identity-link-web-nobypass :28-32, me-player-reads-nobypass :32-36, public-alias-nobypass :27-31 | jobd S, then chad (three calls) | jobd S while it waits for chad | method (slot first) |
| H4 rls-invariants :2120-2167 (JCL-1; body: migrate, tail pin :2124-2126, job_definer-owned list) | jobd S, then chad, then the body | jobd S while it waits for chad; the slot is freed at :2169, before JCL-4 at :2183 | method + body |
| H5 tenant-capability-authority :454-458 | three calls | jobd S while it waits for chad | method |
| H6, H7 migrate.test.ts :764-768 (BR-6, pin :769), :928-932 (0037) | three calls | jobd S while it waits for chad | method |
| H8, H9 migrate.test.ts :4337-4341, :4465-4469 | three calls | jobd S while it waits for chad | method |
| H10-H12 migrate.test.ts :4677-4688, :4705-, :5102- (bodies with migrate passes and asserts) | jobd S, then chad, then the body | jobd S while it waits for chad | method + body |
| W1 migrate.test.ts :3369-3370 (catalog snapshot guards) | jobd S, then chad X, then chst X | jobd S while it waits for chad | chat window outer, jobd inner (2 lines) |
| C1, C2 migrate.test.ts :871-875, :895-898; C3 :383 | chad only | nothing; C3 never requests jobd | unchanged |
| W2: 22 `withChatDefinerLock` windows in migrate.test.ts; W3: :1225-1226, :1374-1375 (idnm, chad, chst) | chad, then chst (after idnm for W3) | chad while it waits for chst (finite) | unchanged |
| B1-B11 breakers, migrate.test.ts :1092 to :4149 | jobd X | jobd X; never requests chad | unchanged |
| R: 69 jobd readers (db, bot 15, web 1); T: test-harness.test.ts | jobd S (+ chst S); chad only or jobd only | nothing (lockAllShared); T pins no owner sequence | unchanged; test-harness.test.ts not edited |

Order proof (RB, measured census):
- Total order: idnm < chad < chst < jobd (S/X) < plxc < jdlk/cdlk/idlk (xact) < `pg_auth_members` SHARE UPDATE EXCLUSIVE.
- The rule: no process requests an earlier lock while it holds a later one. A JS edge counts too: holding L on session A while awaiting session B is
  B waiting while L is held.
- Why no cycle remains:
  - jobd holders never wait for chad or chst. Readers never hold while they wait, and breakers never request chad. After the fix no reader fn requests
    chad: H1-H12 take the slot first, their bodies hold no chat call, and W1 is flipped.
  - chad holders wait only for jobd S, plxc and the xact keys, and every one of those waits is finite.
  - PR #62's three-party cycle (slot holder, queued breaker, jobd-first site) needs a jobd-first site that waits for the slot. None is left.
- Preconditions (measured):
  - In `infra/postgres-init/02-chat-definer.sql`, `job_definer` appears only on `--` comment lines (:15, :26, :31, :34, :37, :171).
    `03-identity-definer.sql` has no hit. So the chat bootstrap may run outside jobd S.
  - H4 frees the slot at :2169, and the tests in a file run in order (vitest.config.ts:44).
- Unchanged: the advisory keys and modes, the role model, every timeout, and the slot held until `teardown()`.

## 6. Pinned defaults

Each item is "default applied, pending owner sign-off", here and in the PR body.

- **D1 (P3-1).** STRIP gains one alternative for a regex literal:
  - The `/` follows one of `= ( [ , ; { : ! & | ?`, `=>`, or one of the keywords `return typeof case void yield await delete throw in of else do`.
    So a division is never read as a regex.
  - The first body char is not `*` or `/`. Escapes and character classes are allowed, then the flags.
  - The match is kept like a string. The :92 callback blanks only a match that starts with `//` or `/*`.
  - A `ponytail:` comment names the ceiling: an identifier spelled like a keyword before a division is misread, and the match is then kept, never
    blanked.
- **D2 (P3-2).** Pins are keyed by file, scope, text and count:
  - Scope = the nearest preceding column-0 declaration (`function`, `const`, `let`, `var`, `class`), or a column-0
    `describe/it/test/beforeAll/afterAll/beforeEach/afterEach` call with its title.
  - The pin check becomes a pure function over a hits map. Line-number pins are rejected, because they go red on every edit above them.
  - A `ponytail:` comment names the ceiling: a move inside one top-level unit stays invisible.
  - W1 derives the rows on W3's head.
- **D3 (P3-3).** STATEMENT gains the zero-width lookahead `(?=(;)?)`. For GRANT/REVOKE only, an empty region that ends at `;` is skipped. One that
  ends at a backtick or at the end of input stays flagged.
- **D4 (P3-4).** Per-root floors:
  - The roots are the first-level directories under `packages/` and `apps/`.
  - Floor = floor(0.9 x the count measured at this base), minimum 1: apps/bot 32, apps/web 369, packages/core 19, packages/db 97.
  - A pinned root that is missing or under its floor fails, naming the root. A new root is scanned but not required.
  - The `> 550` total floor is kept beside them, because the negative scope forbids deleting an assertion. GOAL 1's "in place of the single floor"
    is read as "in addition to".
- **D5 (TTL).** `remainingTtlMs` as in section 4. The clock-free check of the returned value is kept:
  `expect(first.expiresAt).toEqual((await row(first.linkCodeId)).expires_at)`. It may share the :267 read.
- **D6 (row 3).** Fix B, the harness owns the order (the row's second choice): `NonSuperuserOwnerContext.bootstrapAndMigrateAsOwner(body?)`.
  - What it does: the chat slot first (`bootstrapChatDefinerForOwner`, held until `teardown()`), then jobd S around the job bootstrap and `body`. The
    default body is `migrate(ownerUrl)`.
  - What it returns: the body's value, or `MigrateResult`. Errors propagate unchanged.
  - All 12 jobd-first sites call it in ONE change.
  - Tie-breaks:
    - fail-closed: B (new sites inherit the order);
    - one source of truth: B (one function, not 12 copies);
    - fewer concepts: about even;
    - precedent: B (the harness already owns lock holding);
    - reversible: a tie.
  - Rejected:
    - A no-argument method, because it would move H4 and H10-H12's work out of the jobd hold (a weakening).
    - PR #62's all-or-nothing variant, because it would need a new mixed-mode helper.
- **D7 (W1).** `migrate.test.ts:3369-3370` is a chat window, not an owner context. It is IN scope and is flipped in place in the same change, because
  GOAL 3 says every site and the negative scope forbids a subset reorder.

## 7. Implementation steps

The lane has one writer at a time. Each writer commits in the worktree and does not push. GitNexus impact runs before each symbol edit, and
`detect_changes` runs before each commit. `b3-measure.sh` runs after every writer.

Run order: W3, then W1 (its P3-2 rows are derived on W3's head), then W2 (its file is disjoint, so it can take any slot), then W4.

- **W3** (opus/max), `test-harness.ts` and the six site files:
  - D6: add the method to the interface (about :805-848) and to the returned object (about :1024-1032).
  - H1-H3 and H5-H9: replace the five-line block with `await <ctx>.bootstrapAndMigrateAsOwner();`.
  - H4 and H10-H12: only the three opening lines become `await <ctx>.bootstrapAndMigrateAsOwner(async () => {`. The body and its closing stay
    byte-identical.
  - W1: swap the nesting (D7).
  - Rewrite these comments: test-harness.ts:484-486 and :819-824; BR-6 :749-763; 0037 :926-927; JCL-1 :2114-2119; H11 :4703-4704.
  - First read H11 from :4712 and H12 from :5110 to their closing lines. A second lock request inside a body is a ruling request.
- **W1** (opus/high), the guard file only:
  - D1-D4, each written test-first: the new test is shown red against the unchanged guard, then the fix, then green.
  - Re-run the step-0 measurement script on W3's head before writing the P3-2 rows.
- **W2** (sonnet/high), `identity-link-code.test.ts` only: D5.
- **W4** (sonnet/high), `docs/autopilot-backlog.md` only:
  - Close the three rows BY HAND in the L33/L36/L37 form (no PR number, no SHA).
  - Add at most 3 new OUT_OF_SCOPE rows (section 12, O1).

## 8. Acceptance matrix

Seeding: violations are in-memory fixtures inside the test (keywords split as at :116 and :121), or a scratch copy outside the repo. A tracked
product or test file never receives a violating edit.

| Row | Check | Expected |
|---|---|---|
| G1a, G1b | P3-1 fixtures (section 3) | red on the base guard; green after D1 |
| G2 | P3-2 moved-hit fixture | count pins blind; scoped pins report 1 mismatch in test-harness.ts |
| G3 | P3-3 bare verb fixture | `[""]` on the base guard; `[]` after D3 |
| G4 | P3-4 drop of packages/core | the per-root floors fail on packages/core |
| G-ACC | guard on the repository | green; hits unchanged in every file; scoped rows: mismatched 0, outside 0; no root under floor; :116, :117, :121 PASS |
| T1 | TTL | the probe `remainingTtlMs` exists; one statement; both operands on the database clock; the 30 s margin kept; the DTO check kept; no sleep, no retry |
| B1 | bootstrap census | the probe `bootstrapAndMigrateAsOwner` exists; the 12 sites call it; no jobd-first three-call block is left; W1 flipped |
| B2 | bodies and pins | H4 and H10-H12 bodies byte-identical inside the jobd hold; the 0071 tail-pin diff grep prints nothing |
| B3 | load windows | B', C' (D') at N=5: every run green, no timeout, no Unhandled, equal counts, no rerun |
| REG | regression | db suite, the six focused files and `pnpm -w test` green; no assertion weakened or deleted; detect_changes shows test files only |
| BL | backlog | three rows closed by hand; at most 3 new rows |

## 9. Verification

- **Before every commit:** `pnpm typecheck`, `pnpm lint`, `pnpm format:check` and `pnpm review:check:changed`; `pnpm review:check` once in full.
  - `pnpm build` is not required (no production file).
  - The tail-pin check must print nothing:
    `git -C <worktree> diff -U0 2ff2fd736284d0004f23737967516049f8a9cc0a -- packages/db/src | grep -n '^[-+].*0071'`.
- **DB and load commands** run through the lane's locked-run wrapper (session notes, `scripts/locked-run.sh`) with the sandbox off. The wrapper
  sets NODE_ENV=test and DATABASE_URL_TEST itself.
  - The guard file (no DB, so it may also run outside the lock).
  - `src/identity-link-code.test.ts`.
  - The six focused files, each through `pnpm --filter @plexco/db exec vitest run`. All six are isolated files; migrate.test.ts alone takes about
    45-69 s.
  - `pnpm --filter @plexco/db test` at the final head.
  - `pnpm -w test` once at the final head, with one rerun for a listed flake.
  - Never add a `--sequence.*` flag (vitest.config.ts:33-35).
- **Load windows:** PR #62's D-3 block (`docs/sessions/web-mvp-phase3-readiness-p3-ci-flake-hardening.md:214-223`), repeated N=5 times per window
  through the runner `scripts/l55-parallel-load-window.sh <w> 5` (session notes).
  - Each run starts the db, bot and web suites in parallel. It is clean only with three exit 0 and no "Unhandled". The 5 runs must be consecutive,
    with no rerun.
  - The windows:
    - B' runs once W1-W3 are committed, before review.
    - C' runs after the R1b fixes.
    - D' runs at the final head, if it differs.
  - Each window holds the lock for 11-17 min (PR #62's B, C, D took 1020 s, 741 s and 683 s for their runs), worst about 24 min. The runner prints the
    window's start and end in UTC: announce them to L39.
- **PROOF-REACH** (measured; not a blocker):
  - Every hand-off file and every breaker file is in vitest's isolated list (`packages/db/vitest.config.ts:5-13`), and bot and web have no chat-slot
    requester. So a load window cannot form the cycle, before or after the fix.
  - The windows are the regression gate the row asks for. The proof that no cycle remains is the static total order plus the site census
    (section 5).
- **A classifier denial** comes back as a permission denial, and the command never runs. Do not retry or reroute. Write
  `AWAIT-RQ<n>-<unit>.md` in the session notes with the exact owner commands (a `cd` into the worktree, the wrapper call, then `tail -40` of the log).
- **Security round:** not required (test code only). The judgement is void if any production file enters the diff.

## 10. Budget (B3)

- The pre-approved ceiling (lane block, files raised by RO-L55-1): 600 test lines added or changed, 0 non-test lines, 12 files, 0 migrations.
- Measured file count: 11, which is within the 12-file ceiling. They are the nine code files (the guard, the TTL file, `test-harness.ts`,
  rls-invariants, tenant-capability-authority, identity-link-web-nobypass, me-player-reads-nobypass, public-alias-nobypass, migrate.test.ts), the
  backlog, and this file.
- Estimate: 225-360 test lines (row 3 about 110-130; the guard about 115-140; TTL about 13-15).
- 0 non-test lines (`test-harness.ts` is a test helper, section 2), 0 migrations, one module (packages/db).
- A crossed ceiling is a ruling request before the next writer.

## 11. THREAT MODEL

Lane block, verbatim: "this lane defends against false green and false red in the DB test chain (a guard that cannot see a violation, a flake that
hides a real regression, a lock-order cycle that hangs the suite), not against an adversary; the failure it must not introduce is a guard that passes
while a role-hiding violation exists."

## 12. OPEN

None in scope. Out-of-scope items:

- **O1 (a backlog row, W4).** A GRANT/REVOKE verb held in a variable is invisible to the guard today, which is a false green. In
  `const verb = up ? "GRANT" : "REVOKE";` the region is exempt, and a template that starts with `${verb}` contains no keyword.
- **O2 (recorded ceilings, `ponytail:` comments, not rows).** D1's keyword-spelled identifier; D2's move inside one top-level unit; D4's lost subtree
  no larger than its root's margin (4, 42, 3 and 11 files).
- **O3 (not introduced by the fix).** A hand-off still waits for the slot while another file holds it; there is no cycle. A dynamic red-first proof would
  need two db processes at once, so it is not proposed.

## 13. Closure matrix (12 of 12)

| # | Gate | Evidence | Result |
|---|---|---|---|
| 1 | Authority snapshot pinned by SHA | `AUTHORITY_SHA` = the worktree HEAD at step 0 (measured); every TARGET_FILES path exists (`git ls-files`, measured) | PASS |
| 2 | Decisions in scope final | the owner approval of 2026-10-26 (section 1); RO-L55-1; D1-D7 pinned as defaults pending owner sign-off | PASS |
| 3 | Scope IN/OUT and owner clear | lane block FILE OWNERSHIP and NEGATIVE SCOPE; the edit sites in sections 5 and 7; the residue in section 12 | PASS |
| 4 | Dependencies classified | a root slice (wave 1); no migration slot; L41 and L46 wait for its merge (the pin :769 sits next to H6's hunk) | PASS |
| 5 | Live schema and code match | sections 2-5, each fact measured at the base | PASS |
| 6 | Data, API, state, auth contract | no production file, migration, advisory key or role-model change; the method's signature is pinned (D6) | PASS |
| 7 | Fail-closed, idempotency, order | the order proof (section 5); errors unchanged; no sleep or retry; the accepted set is unchanged (section 3) | PASS |
| 8 | Open questions in scope = 0 | D1-D7 pinned; the section 12 items are out of scope | PASS |
| 9 | Acceptance matrix with expected results | section 8 | PASS |
| 10 | Migration, security, rollback | 0 migrations; no security round (the judgement and its void condition, section 9); rollback = revert of test files | PASS |
| 11 | First slice hard dependencies merged | none; base = origin/main at the merge of PR #114 | PASS |
| 12 | Implementation handoff ready | sections 6-9; the worktree exists at the base, clean | PASS |

## 14. Verdict

```text
REVIEW_POLICY_VERSION: 1.3
REVIEW_VERDICT: CODE_READY
REVIEWED_AT: 2026-10-26
AUTHORITY_SHA: 2ff2fd736284d0004f23737967516049f8a9cc0a
BASE_BRANCH: main
TARGET_FILES:
  - packages/db/src/role-hiding-isolation-guard.test.ts (edited)
  - packages/db/src/identity-link-code.test.ts (edited)
  - packages/db/src/test-harness.ts (edited)
  - packages/db/src/rls-invariants.test.ts (edited)
  - packages/db/src/tenant-capability-authority.test.ts (edited)
  - packages/db/src/identity-link-web-nobypass.test.ts (edited)
  - packages/db/src/me-player-reads-nobypass.test.ts (edited)
  - packages/db/src/public-alias-nobypass.test.ts (edited)
  - packages/db/src/migrate.test.ts (edited)
  - docs/autopilot-backlog.md (edited)
  - packages/db/src/test-harness.test.ts (read only: pins no owner sequence, unchanged)
  - packages/db/src/identity.ts (read only: LINK_CODE_TTL_SECONDS :27, the issue wrapper :212-234)
  - packages/db/migrations/0043_identity_link_code_issue_consume.sql (read only: link_code_issue :112, :121, :212-214)
  - packages/db/schema.ts (read only: link_codes :92-93, :104)
  - packages/db/src/migrate.ts (read only: two scanned guard hits in ensureRoleExists, the plxc key :31)
  - packages/db/vitest.config.ts (read only: isolated list :5-13, file order :44, sequence flags :33-35)
  - infra/postgres-init/02-chat-definer.sql (read only: job_definer only in comments)
  - infra/postgres-init/03-identity-definer.sql (read only: no job_definer)
  - apps/bot/src/test-db.ts (read only: the bot reader lock :36-37)
  - docs/sessions/web-mvp-phase4-plan.md (read only: section 3 row L55, the authority)
  - docs/sessions/web-mvp-phase3-readiness-p3-ci-flake-hardening.md (read only: the D-3 load block :214-223)
SLICE: p4-db-test-hygiene
IN_SCOPE: the four residual P3s of the role-isolation guard closed with red-then-green tests and an unchanged accepted set (D1-D4); remainingTtlMs on the database clock for the two TTL assertions (D5); NonSuperuserOwnerContext.bootstrapAndMigrateAsOwner with an optional body, called by all 12 jobd-first sites in one change, and the W1 nesting flip (D6, D7); the comment rewrites named in section 7; PR #62's load windows repeated under the lock and recorded; the three backlog rows closed by hand and at most 3 new out-of-scope rows; this readiness file
OUT_OF_SCOPE: any production file; any migration; a new advisory-lock key; any change of the job_definer, chat_definer or role model; a reorder of only a subset of the sites; a sleep or retry; weakening or deleting an existing assertion; the migration-tail pins; enabling anything; test-harness.test.ts; the lockedUntil check at identity-link-code.test.ts:405; docs/standards/decisions.md; PR #50
G1_DECISION: PASS
G2_SPEC: PASS
G3_DEPENDENCY: PASS
G4_TEST: PASS
G5_SCOPE: PASS
G6_EXTERNAL: PASS
HARD_DEPENDENCIES: none
PRIOR_SLICES: none
OPEN_QUESTIONS_IN_SCOPE: 0
ENABLEMENT_ONLY_GATES: none
LIVE_REPO_VERIFICATION: PASS
CONTRACT_MATRIX: PASS
CLOSURE_MATRIX: PASS
ACCEPTANCE_MATRIX: PASS
SECURITY_AND_MIGRATION_GATE: PASS # no migration, no production file; no security round (test code only), void if any production file enters the diff
IMPLEMENTATION_ARTIFACTS: PASS
FIRST_IMPLEMENTATION_STEP: W3 - in packages/db/src/test-harness.ts add NonSuperuserOwnerContext.bootstrapAndMigrateAsOwner(body?) (slot first, then jobd shared around the job bootstrap and the body, default migrate), then switch all 12 sites and flip W1 in the same change, GitNexus impact first, commit in the worktree
REMAINING_BLOCKERS: none
```
