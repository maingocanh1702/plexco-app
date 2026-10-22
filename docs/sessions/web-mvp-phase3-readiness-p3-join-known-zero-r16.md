<!-- review-readiness: code-ready -->

# Step-0 readiness: L28 p3-join-known-zero-r16 (session P3-S16b)

> Agent-facing. Readiness reviewers S0, then S0b (fresh, finishing S0 from its handoff), opus/high as lane block L28 assigns. Writer sonnet/high; code reviewer opus/max, at most 3 rounds; no separate security round (lane block L28; void condition in the verdict block).
> Evidence tags. [M] = re-read by S0b at the base in this pass (three spot-checks of S0's measurements, all matched, 0 discrepancies; plus the spec, DD-143, GitNexus and validator reads). [A] = measured by S0 at the same base (status/P3-S16b-notes/handoff-s0.md, outside git) and not re-read here.
> Method limit: S0 stopped at the orchestrator's token notice; this file is written from its handoff plus the S0b reads. The writer re-reads each [A] line it relies on with `sed -n` first; a mismatch stops that item (reported, never reworded) and the orchestrator rules.

## Authority and base

- Owner decision item 5 of status/OWNER-DECISIONS-2026-10-22.md (recorded by the owner's assistant, owner-confirmed in chat 10:47; choice B at 10:53), verbatim: "Item 5 (known_zero on /join): owner chose B (10:53): when the club owes nothing (free session or fully paid) the /join confirmation shows R16 ("Bạn không có khoản nào cần trả."), exactly as /pay does, instead of R17. The owner accepts the small residual risk (informational message only, no in-app payment in the MVP; the P-29 identity-merge window is narrow). This supersedes default 7 of PR #95. Follow-up backlog item 2 (prove person equality) stays as hardening, no longer blocking."
- Citation (note A1): `git grep -c "DD-143" HEAD -- docs/standards/decisions.md` finds nothing at the base [M]. L26 (P3-S16a) records item 5, expected as DD-143. If L26 has not merged when the PR opens, the PR body quotes item 5 verbatim and names "DD-143 (expected, recorded by L26)"; otherwise it cites the number measured on main.
- Base: worktree `.autopilot/worktrees/p3-join-known-zero-r16`, branch `feat/p3-join-known-zero-r16`, `git rev-parse HEAD` = `e049c9269554d72c60b21b8c1ecc5329c5cbcf1d` (the lane block's expected base); porcelain empty and no index.lock at the start [M]; this file is the branch's first commit.
- Migrations: none, no slot requested. No change in packages/db, apps/bot, /pay or any copy.

## Q1 The /join active branch, the helper and the kinds

- `apps/web/lib/zalo/player-commands.ts` numberReply (:133-173 [A]): join :153, seat line :154, a non-active outcome returns the seat only :155 (no money read), DD-140 comment :156-160, `let line = reply("R17")` :161, `const st = await ownClubPaymentStatus(deps)` :163, items only for `st.kind === "known_amount"` filtered on `sessionRef === row.sessionId` :164-165, exactly one :166, R1amount with `formatVnd(item.remaining)` :167, a throw logs `zalo_join_amount_read_failed` by reason only :168-171, `return [seat, line]` :172 [M].
- ownClubPaymentStatus :186-196 (module-private, never catches; doc :179-185): accountRef missing or not a UUID gives unavailable :189-190; summary unknown gives unavailable :192; slug null gives unavailable :193-194; else the club's status, or absent when the club is not listed :195 [M].
- ClubPaymentStatus :177 [M] = readMyCharges `clubs[].status` (packages/db/src/me-player-reads.ts SelfPaymentStatus :79-80): known_zero :76; known_amount with chargeCount and items :77, :80; unknown (LEDGER_INCONSISTENT, TOO_MANY_OPEN_CHARGES, READ_FAILED) :71-75. There is no partial kind (partial is an item status, :68); the helper adds unavailable and absent (:188). Any unknown club makes the summary unknown (me-player-reads.ts:267-268) [A].
- payReply :199-219: unavailable gives R17 :201; absent or known_zero gives R16 :202; not known_amount or 0 items gives R17 :203 [M].
- Copy: R1amount :42; R16 :62 (vi "Bạn không có khoản nào cần trả.", en "You have nothing to pay."); R17 :63 [A; the conductor's measurement in the lane brief agrees].
- Blast radius (GitNexus impact upstream, index refreshed at e049c92) [M]: numberReply risk LOW, d1 runPlayerCommand, d2 processZaloEvent, d3 the Zalo webhook POST, module Zalo only; ownClubPaymentStatus risk LOW, d1 numberReply and payReply, d2 runPlayerCommand, d3 processZaloEvent. Grep: runPlayerCommand is called only from apps/web/lib/zalo/process-event.ts:173 and the unit test.

## Q2 Can absent mean "nothing owed" for a just-joined active seat? Not provable

absent stays R17: not provable; a conductor-approved narrowing, not the owner's wording. Evidence [A]:

- Club list: account_my_clubs (packages/db/migrations/0059_me_player_reads_definers.sql:46-77) goes account, then `a.person_id` with `p.status = 'active'` (:61-63), then that person's memberships with status active or guest (:69-73); club_ref = `t.slug` (:69).
- Charges: account_my_open_charges (0059:151-195) goes through players and memberships of that person in any membership status (:182-185), `c.status IN ('open','partial')` (:188).
- me-player-reads.ts:254-264: the club set is the own active or guest clubs plus the clubs with an own open charge; known_zero = listed with 0 open rows (clubStatus :208); one REPEATABLE READ snapshot (:236).
- Join: one withTenant transaction (packages/db/src/session-join-service.ts:21-29, :336); the seat comes from a live active or guest membership (:148-161) or a minted guest membership (:430); seatPlayer (packages/db/src/roster-service.ts:240-304) writes the player and, for an active seat, upsertCharge in the SAME transaction (:300-302); the insert status is chargeStatusFor(price, 0) (:331) and price 0 gives 'paid' (packages/db/src/payment-manual.ts:47-52); the already-seated path returns active with zero writes (session-join-service.ts:378-383).
- So when the account's person is the joining person, a committed active seat lists the club (known_zero or known_amount), never absent. absent therefore means the account's person is not the joining person (the P-29 window: the join binds `identity.personId`, player-commands.ts:22, while the read uses `gate.accountRef`) or the membership ended between the commit and the read. That read never saw the seat or its charge, so absent proves nothing about what the seat owes.
- known_zero for the same person means the seat's charge is paid: a free session (price 0 is 'paid') or an older fully paid seat on the already-seated path. Residual, owner-accepted in item 5: a different account person with its own active or guest membership in the club and no open charge also reads known_zero.

## Threat model (lane block L28)

The message is informational (no in-app payment in the MVP). The owner accepts the residual P-29 risk: an identity merge between the join's person and the account's person could make a seat that owes money read as "nothing to pay". The lane must not widen it: R16 only for the helper's explicit known_zero, never for absent, a throw, an unknown summary or an ambiguous charge match.

## Decision table (the amount line after the seat line of the ACTIVE /join reply)

| Helper result or read | BEFORE (base) | AFTER (L28) |
|---|---|---|
| known_amount with exactly one item whose sessionRef is the joined session | R1amount | R1amount (unchanged) |
| known_zero (a free session or a fully paid seat) | R17 | R16, the /pay text (NEW, owner item 5) |
| absent (the club is not in the account's list) | R17 | R17 (unchanged; Q2 not provable) |
| unavailable: accountRef missing or not a UUID, summary unknown, slug null | R17 | R17 (unchanged) |
| club status unknown | R17 | R17 (unchanged) |
| known_amount with 0 or 2+ items for the joined session | R17 | R17 (unchanged; never summed, never picked) |
| readCharges or payContext throws | R17, logged by reason only | unchanged |
| waitlisted, requested or an error outcome | no money read | unchanged |

The superseded row is known_zero to R17: L21's row D4, pinned by player-commands.test.ts:674-677 [M]; the owner names it default 7 of PR #95.

## One source

The /join amount line (:163) and payReply (:200) read the same `ownClubPaymentStatus(deps)` result [M]. The new arm consumes the `st` already read at :163: no new read (readCharges once with the own account and payContext once with `[]`, as readOnceWithOwnAccount pins at test :660-664 [M]), no second formula, and payReply's :202 arm stays byte-identical. A diff that adds a read, a formula or a /pay change is a HALT (lane block STOP).

## Test rows for the writer

apps/web/lib/zalo/player-commands.test.ts:

- DELETE the superseded row :674-677 ("club known_zero, a free session (D4): R-17, not R-16") from UNAVAILABLE (:667-688) [M]; the it.each D3 (:728-746 [A]) runs that table in en and vi through unavailableText (:658-659 [M]), so the deletion removes the old row in both languages.
- ADD "D4 active, club known_zero (owner item 5): R-1 then R-16" in en and vi: `amountDeps({ readCharges: clubA({ kind: "known_zero", currency: "VND", asOf: AT }) })`; expect the R1 line then R16, no log, readOnceWithOwnAccount.
- ADD the agreement test, modeled on D8 (:801-815 [A]): with the same known_zero deps, the /join amount line (`split("\n")[1]`) equals the whole /pay reply (R16), in en and vi.
- Byte-identical: UNAVAILABLE rows :668, :669, :670, :671, :672 ("club missing" = absent, stays R17), :673, :678-681, :682-685, :686, :687 [M]; copy pins :25, :45, :46; confirm test :280-293 (row :285); /pay tests :571-615 (known_zero and absent give R16 :573-582, vi :605); D1 :691-701, D2 :703-715, D1-D2 :717-726, D5-D6 :748-778, D7 :780-799, D8 :801-815 [A].

apps/web/app/api/webhooks/zalo/[token]/route.test.ts: no row pins known_zero on /join, so 0 rows change. T-3 :512-526 (a thrown read gives R1 + R17, :523), T-6 :528-533 (R1 + R1amount 100.000), :535 (R7) and :536 (R18) [M]; /pay T-14 :592 (absent, R16), :599 (known_zero, R16) and T-15 :593-597 [A] stay byte-identical.

Count: 1 row removed, 2 tests added (each in en and vi), 0 route rows.

## B3 estimate (caps 150 non-test / 400 test / 550 total / 4 files / 0 migrations)

Non-test: about 3-8 LOC in player-commands.ts (the arm and the :156-160 comment); about 130 with this doc counted. Test: about 30-45 LOC (minus 4, plus 2 tests). Total: under 60 LOC of code, under 180 with this doc. Files: 2 edited plus this doc (route.test.ts expected untouched) of 4. Migrations: 0. Inside every cap; no B3 exception needed.

## Defaults (Tier B, reversible; repeat in the PR body)

- D-A: absent stays R17 (Q2 not provable): a conductor-approved narrowing, not the owner's wording. Default applied, pending owner sign-off.
- D-B: no new copy; R16 is reused in both languages (player-commands.ts:62). Default applied, pending owner sign-off.
- D-C: no new route-test row; the unit decision-table and agreement tests pin known_zero, and no route row reaches a known_zero /join. Default applied, pending owner sign-off.

## Spec follow-up (PR body only; no spec is edited)

docs/features/BE/feature_zalo_channel_tech.md (Status Reviewed :5) [M] is the Zalo channel tech spec (docs/channels/zalo holds only README.md at the base [M]). Its /join rows: :222 Active, :224 Existing active/waitlisted ("Render current state idempotently"), :225 Rejoin after `left` ("Render shared result") [M]. PR-body text:

> Spec follow-up, not edited (feature_zalo_channel_tech.md :222, :224, :225): the active /join confirmation and its re-renders show, after the seat line, R1amount for exactly one charge of the joined session; R16 "You have nothing to pay." when the club owes nothing (known_zero; owner item 5, DD-143 expected via L26; it supersedes default 7 of PR #95); R17 in every other case (absent stays R17).

## OUT_OF_SCOPE and backlog candidates

1. Follow-up backlog item 2 (prove person equality) stays as hardening (owner item 5); it is what could later prove absent.
2. Pointer drift: the session brief names a "docs/channels zalo channel tech spec"; at the base the spec is docs/features/BE/feature_zalo_channel_tech.md (note only).

## Closure matrix (12 of 12)

| # | Gate | Evidence | Result |
|---|---|---|---|
| 1 | Authority snapshot pinned by SHA | `AUTHORITY_SHA` below = worktree HEAD at the start; every TARGET_FILES path exists at it | PASS |
| 2 | Decisions in scope are final | owner item 5 (choice B), quoted verbatim; D-A to D-C are Tier-B defaults pending sign-off | PASS |
| 3 | Scope IN/OUT and owner clear | lane block file ownership and negative scope; files disjoint from L26 and L18 | PASS |
| 4 | Dependencies classified | none; the L21 code it edits is on the base (ownClubPaymentStatus :186-196 [M]) | PASS |
| 5 | Live schema and code match the claims | Q1-Q4; three [M] spot-checks matched S0 | PASS |
| 6 | Data, API, state and auth contract complete | no schema, route, deps-type or read change; the decision table pins the only new behaviour | PASS |
| 7 | Fail-closed, idempotency, order | R16 only for the explicit known_zero; absent, unknown, ambiguous and thrown reads stay R17; the already-seated re-render reads the status again (:163) | PASS |
| 8 | Open questions in scope = 0 | Q2 resolved fail-closed (D-A); D-A to D-C pinned | PASS |
| 9 | Acceptance matrix has expected results | decision-table rows in en and vi, the agreement test, unchanged route rows, the lane's acceptance commands | PASS |
| 10 | Migration, security and rollback pinned | no migration, no secret; no separate security round, with its void condition; rollback = revert the single PR | PASS |
| 11 | First slice has hard dependency merged | root slice; the L21 helper is on the base | PASS |
| 12 | Implementation handoff ready | decision table, test rows, defaults, spec follow-up, first step | PASS |

## Verdict

```text
REVIEW_POLICY_VERSION: 1.3
REVIEW_VERDICT: CODE_READY
REVIEWED_AT: 2026-10-22
AUTHORITY_SHA: e049c9269554d72c60b21b8c1ecc5329c5cbcf1d
BASE_BRANCH: main
TARGET_FILES:
  - apps/web/lib/zalo/player-commands.ts
  - apps/web/lib/zalo/player-commands.test.ts
  - apps/web/app/api/webhooks/zalo/[token]/route.test.ts
SLICE: p3-join-known-zero-r16
IN_SCOPE: the Zalo number-reply confirmation of the ACTIVE join outcome renders R16 (the /pay text) when the shared helper ownClubPaymentStatus returns known_zero, from the same helper result (no new read, no second formula); the superseded UNAVAILABLE row is removed; a D4 known_zero test and a /join and /pay agreement test in en and vi
OUT_OF_SCOPE: /pay; the amount formatter; R1amount; the unavailable path; absent (stays R17); the waitlisted, requested and error replies; the promotion DM; bank data, QR or payment links; any new money read; a Reviewed spec; decisions.md; packages/db; apps/bot; a migration; the files of L26 and L18
G1_DECISION: PASS
G2_SPEC: PASS # owner item 5 (DD-143 expected via L26); the Reviewed Zalo channel tech spec is not edited (follow-up text for the PR body pinned above)
G3_DEPENDENCY: PASS
G4_TEST: PASS
G5_SCOPE: PASS # 3 files (2 edited plus this doc), 1 module, 0 migrations, inside the pre-approved caps
G6_EXTERNAL: ENABLEMENT_ONLY:owner-P0-real-zalo-bot-token-and-deliverer # no provider call in this lane; tests inject deps
HARD_DEPENDENCIES: none
PRIOR_SLICES: L13 p3-m9-zalo-player-commands (/join, /pay); L21 p3-zalo-join-amount-owed (PR 95: ownClubPaymentStatus and the R1amount line; probes ownClubPaymentStatus and payReply in player-commands.ts)
OPEN_QUESTIONS_IN_SCOPE: 0
ENABLEMENT_ONLY_GATES: owner P0 for real use: the Zalo bot token and the real deliverer; none is claimed done or changed by this lane
LIVE_REPO_VERIFICATION: PASS # measured at AUTHORITY_SHA by S0; three spot-checks re-read by S0b matched
CONTRACT_MATRIX: PASS
CLOSURE_MATRIX: PASS
ACCEPTANCE_MATRIX: PASS
SECURITY_AND_MIGRATION_GATE: PASS # no migration, no secret; no separate security round per lane block L28 (no new trust boundary); void if the diff touches a file outside TARGET_FILES and this doc or adds a read of money data: then an opus/max security round is required
IMPLEMENTATION_ARTIFACTS: PASS # DD-122 D4: lane block, this file and the worktree at the exact base; no scope-gate lifecycle
FIRST_IMPLEMENTATION_STEP: the writer adds `if (st.kind === "known_zero") line = reply("R16");` right after player-commands.ts:163 (same st, before the items lines), updates the DD-140 comment :156-160, deletes the superseded UNAVAILABLE row player-commands.test.ts:674-677 and adds the D4 known_zero and agreement tests in en and vi
REMAINING_BLOCKERS: none
```
