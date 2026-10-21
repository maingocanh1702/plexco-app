<!-- review-readiness: code-ready -->

# Step-0 readiness: L21 p3-zalo-join-amount-owed (session P3-S15b)

> Agent-facing. Readiness reviewer: W0d, opus/max (same model and effort as the lane's code reviewer). Writers W1, W2, W3: opus/max. Code reviewer opus/max; security round opus/max, REQUIRED (money shown on an external channel); the judgement "no security round" never applies here.
> Lane block: L21 of the P3-S15b brief, conductor-authored under owner decision B2 of 2026-10-21 (recorded by L19 as DD-140, PR 93). Owner decisions needed: none beyond B2; every design choice below is a Tier-B pin worded "default applied, pending owner sign-off".
> Evidence tags. [M] = re-read by this reviewer at the base in this pass (three spot-checks, all matched, 0 discrepancies). [A] = measured by the step-0 readers W0, W0b and W0c (status/P3-S15b-notes/w0-step0-handoff.md, outside git) and not re-read here.
> Method limit: W0, W0b and W0c each stopped at an orchestrator stop notice; this file is written from their handoff plus the orchestrator's rulings R1-R10. Gate V1 therefore makes every writer re-read each [A] line with `sed -n` BEFORE relying on it; a mismatch stops that item (dropped and reported, never reworded) and the orchestrator rules.

## Authority and base

- Owner decision B2 (2026-10-21), confirmed by the owner in the conductor terminal, recorded in `docs/standards/decisions.md` as DD-140 by L19 (PR 93, merge `6d7bfccac7401d0052be643d29e5bb0cbfbc0c0e`, an ancestor of the base [A]). The owner's words (verbatim, English as written): "B2. Show the amount owed in the Zalo /join confirmation (active outcome) and in the waitlist-promotion DM (this also matches the DD-134 override: "saying they now hold a seat and the fee owed"). Waitlisted and requested replies stay without an amount. No bank data, no QR (DD-132/DD-135 unchanged). Z-13's "no price in any DM" is amended for these two messages only."
- DD-140 on the base [A]: row decisions.md:122; entry :1803-1821 (B2 verbatim :1811; P-11 and Z-13 amended for the two messages only :1817; spec follow-up feature_zalo_channel_tech.md:222 named at :1819; nothing implemented :1820). DD-138 P-11 is at :1957 and Z-13 at :1925, both signed and amended by DD-140.
- Base: worktree `.autopilot/worktrees/p3-zalo-join-amount-owed`, branch `feat/p3-zalo-join-amount-owed`, `git rev-parse HEAD` = `797d648cc8cd598443fac2d2247e49d2a756954a`; `git status --porcelain` empty and no index.lock at the start [M]; nothing is committed on the branch before this file.
- Migrations: none, no slot requested. No schema, data-model, join, charge, price, occupancy or promotion-order change; `packages/db/src/session-join-service.ts` and every apps/bot product file stay out of the diff.

## Live truth at the base

### Q1 the /join path
- The seat is taken on the NUMBER reply, not on /join (joinList player-commands.ts:107-115 only lists) [A]. numberReply :147-153 [M]: listJoinable, claimContext, `row` = the listed row whose sessionId equals the claimed item, `r = await deps.join(row.sessionId)` (:152), `reply(OUTCOME[r.outcome], ...)` (:153). OUTCOME :105 = {active: R1, waitlisted: R2, requested: R3} [M]; R1 :41 [M].
- Wiring process-event.ts:151-169 [A]: join = joinSession (:159; commandId `zalo:${externalEventId}` :150), readCharges = readMyCharges(handle.pool, accountRef) (:166), payContext = readZaloPayContext (:167).
- JoinSessionResult session-join-service.ts:46-54 [M]: exactly five keys (outcome, playerId, waitlistPosition, requestId, replayed) under the comment "P-18: no amount, no venue". The join result does not carry the amount and is not extended.
- The charge is written in the SAME withTenant transaction as the seat (joinSession :334-453; seatPlayer roster-service.ts:240-304 calls upsertCharge at :300-302, active seats only) [A]. An existing seat returns active with zero writes (:378-383); a replay returns the stored outcome (:338-347) [A].

### Q2 the canonical outstanding-amount source (the /pay reads)
- payReply player-commands.ts:158-184 [M]: accountRef UUID check :160-161 -> R17; readCharges(account) :162; summary unknown -> R17 :163; slug from payContext([]) :164-165, null -> R17; club = clubs.find(clubRef === slug) :166; club missing or known_zero -> R16 :167; not known_amount or no items -> R17 :168; per item formatVnd(i.remaining) :177 plus R15partial :179; total formatVnd(totalOutstanding) :182; lines joined by newline :183.
- readMyCharges me-player-reads.ts:227-276 [A]: one REPEATABLE READ snapshot, never throws (READ_FAILED, TOO_MANY_OPEN_CHARGES, LEDGER_INCONSISTENT give summary unknown). MyChargeItem :59-66: sessionRef = session_id (:195), remaining = chargeRemaining (:192; the one formula, payment-manual.ts:63-69). Definer 0059_me_player_reads_definers.sql:151-191, filter status IN ('open','partial') (:188), person found through the account (:166-169).
- readZaloPayContext zalo-ingress.ts:236-262 CAN throw on a DB error [A].
- Match field: item.sessionRef === row.sessionId, the uuid deps.join received [A]. The /join amount needs no new query shape: the same readCharges(gate.accountRef) and payContext([]) calls (R1).

### Q3 formatter
- Two VND formatters exist [A]: formatVnd (apps/web/lib/money.ts:28-31, "150.000đ", em dash for a non-integer) and @plexco/core fmtMoney (packages/core/src/format.ts:12, used by apps/bot zalo-dm-templates.ts). /pay on this channel uses formatVnd (player-commands.ts:177, :182 [M]), so /join uses formatVnd (R6). The duplicate is backlog 1, not merged here.

### Q4 the promotion DM (W0c Q-DM: NO GAP)
- zalo-dm-templates.ts:4-11 rule "No price either, with ONE exception: 'promoted'"; renderZaloDm :60-98; promoted :77-87 fills {fee} = fmtMoney(v.amountDue) at :79, the ONLY read of amountDue; cancelled :62-69 and announce :70-76 fill {start, link}; updated :88-97 fills {start, fields, link}, where FIELD_GROUPS :23-27 gives the label "giá"/"price", never a number [A].
- zalo-dm.ts:107-117 DM-6 admits player.promoted only with a uuid player_id and an amount_due safe integer in 0..INT4_MAX, else dlq malformed_payload; values :162-168; club locale :169-170 [A].
- Recipient 0057_zalo_delivery_targets_definer.sql:138-172: v_player = the payload player_id; one newest active zalo identity per active person with an active or guest membership whose players row in THIS session is active and pl.id = v_player (:159-163); none gives no_recipients [A].
- Emitter session-join-service.ts:596-618: seat active, upsertCharge, read THAT charge's amount_due, emit {session_id, player_id, membership_id, charge_id, amount_due}, one transaction [A]. W0c: a prior charge with effective != 0 throws REJOIN_REQUIRES_REVIEW (roster-service.ts:342) before the emit; otherwise the charge is non-void with effective 0, so remaining = amount_due at emission (payment-manual.ts:68) [A]. The DM fee is what the promoted player owes at emission (free: 0đ).

### Q5 P-11 sameness and the R1 pins
- P-11 decisions.md:1957 [A]: "trả lời /join chỉ hiện trạng thái (active / waitlisted at N / requested), cùng chữ cho chỗ mới và chỗ đã có; không số tiền, không địa điểm", amended by DD-140 for the active confirmation only. The sameness half stays: a new and an existing seat get the same text shape, so /join carries no R15partial marker (the number shown is already the remaining).
- Existing pins in player-commands.test.ts [A]: copy rows :23; R-1..R-3 :278-292 (:281 active expects exactly "You have a place in ${ref}.", :288 toBe, :289 expectSafe on every outcome); expectSafe :96-99 = expectNoBankData plus no digit followed by đ/₫ and no vnd (:98); default deps :147-148 set readCharges and payContext to unexpected(); /pay describe :534, :567-605; payDeps :521-522.
- No explicit sameness test exists today. A non-left seat of the same person under another membership fails ALREADY_JOINED (session-join-service.ts:398-409) -> R4, an error outcome, unchanged [A].

### Q-ID (W0c): identity.personId versus the account's person: NOT PROVABLY EQUAL
- identity.personId = ci.person_id of the zalo row (0053_zalo_ingress.sql:217-220), active persons only (:246-250), in its own transaction (process-event.ts:128-137). The link gate is a separate autocommit call (process-event.ts:139; 0064:57-59 -> 0034 core: the canonical active person, exactly one verified account on the chain, FOR SHARE revalidation 0034:246-253, :316-339) [A].
- A 0054 reparent committing between :128 and :139 makes accountRef the target's account while identity.personId is the merged empty person; that join fails (no live membership; create_guest_membership refuses a non-active person, 0058_player_self_join.sql:59-61). A third writer adding a membership for the merged person is NOT ruled out (the person-status guard of every memberships writer is unmeasured) [A]. So a club-level known_zero for the account is no proof that the joined seat owes 0, and R3 renders R17 there.

### Threat model item 4 measured: DMs only
- isDirectZaloChat process-event.ts:101-102 [M] = (chatType null or PRIVATE) and chatId === fromId; a non-DM returns "ignored" at :114 before any identity, link code or reply [M]; the reply goes to chatId (= fromId) at :220 [A]. The webhook's pre-store drop is cited from the comment at :112-113 only (route file not read); the processor gate at :114 is the enforced one. No shared or group context can receive a /join reply, so no ruling request is needed.

## Threat model

Defends against:

1. A wrong amount: one canonical source (the /pay reads through ONE shared helper), remaining = chargeRemaining (payment-manual.ts:63-69), formatVnd as /pay; every case that is not "known_amount with the joined session's item" renders R17, never 0 and never a guess.
2. Someone else's amount: the read is keyed by gate.accountRef from the L13 link gate (process-event.ts:139-146), never by a client-supplied id; the item is matched by the session uuid of the server-side claimed row. Under the unruled-out concurrent 0054 path the amount shown is still the replying account's own seat, or R17.
3. Payment-detail leakage on an external channel: no bank data, account number, QR or payment link (DD-132, DD-135); no R15pay line; every amount-bearing reply passes expectNoBankData.
4. The amount reaching anyone but that player: the bot answers one-to-one chats only (above); the amount rides the reply to the requesting player's own conversation.

Not defended here (stated so nobody reads it as covered): the person-status guard of every memberships writer (backlog 2); real delivery on Zalo (owner P0: bot token and deliverer).

## Decision table (the /join reply)

The amount branch runs only when `r.outcome === "active"`, after `deps.join` resolved (:152). The amount read (the helper call plus the item lookup) sits in its OWN try/catch: a throw there renders R17 and never reaches the outer handler or R18; `deps.join` stays outside it. The two lines are joined with a newline as /pay does (:183).

| # | Row | Branch | Reply | Named test (player-commands.test.ts) |
|---|---|---|---|---|
| D1 | active, new seat, amount known | helper gives known_amount with an item whose sessionRef === row.sessionId | R1, newline, R1amount with formatVnd(item.remaining) | "R-1 active new seat: R1 + amount line", vi and en, exact toBe, expectNoBankData |
| D2 | active, existing seat, partly paid | same branch (an existing seat is active with zero writes, :378-383) | same shape, current remaining, no R15partial | "R-1 active existing partly paid seat: same shape, current remaining, no partial marker" |
| D3 | active, amount unknown or the read fails | accountRef missing; accountRef not a UUID; summary unknown; slug null; club absent; club status unknown; joined session absent from the known_amount items; readCharges throws; payContext throws | R1, newline, R17 | it.each "R-1 active, amount unavailable: <cause>", one row per cause (9); exact toBe, expectSafe, never R18 |
| D4 | active, amount proven 0 (free session) | club known_zero (a free charge starts paid, payment-manual.ts:48-52 [A], so it is never an open item); a per-seat 0 is not provable from the account-keyed source (Q-ID) | R1, newline, R17 (R3) | "R-1 active free session: R17, not R16" |
| D5 | waitlisted at N | OUTCOME only | R2 unchanged | existing :282 kept, plus "readCharges and payContext not called" |
| D6 | requested | OUTCOME only | R3 unchanged | existing :283 kept, plus "readCharges and payContext not called" |
| D7 | any error outcome | deps.join throws; the outer handler is unchanged | unchanged (ALREADY_JOINED -> R4; others as today) | "join error ALREADY_JOINED: R4, no amount read" |
| D8 | same source | the helper shared with payReply | the /join amount equals /pay's R15item amount for the same seat | "join and pay read the same item" (same accountRef, same slug, same formatted remaining) |

Test pins: "not called" is asserted with vi.fn spies and toHaveBeenCalledTimes(0), not by unexpected() alone, because the local catch would swallow a throwing stub on the active path. D1 and D2 also assert readCharges called once with gate.accountRef and payContext called once with []. The R-1 active pin (:281, :288-289) changes by design (DD-140); the R-2 and R-3 pins and the whole /pay describe (:534-605) stay byte-identical and green, which proves /pay's behaviour is unchanged.

## DM table (proof; no apps/bot product change)

| # | Event or template | Code (read-only) [A] | Status | Test |
|---|---|---|---|---|
| M1 | player.promoted -> promoted: one DM, promoted player only, own amount_due | templates :77-87 (:79 the sole amountDue read); DM-6 zalo-dm.ts:107-117; recipient 0057:138-172; emitter session-join-service.ts:596-618 | PROVEN | zalo-dm.test.ts:95-111, :113, :382-402 (two other linked active players get nothing :384, :396; the text ends with the fee :399-400; no venue, name or session price :401), :467-485 (free "Fee: 0đ" :480-482, no resend :477, unlinked noop :483); session-join-service.test.ts:586, :781; session-service.test.ts:2664 |
| M2 | announce: no price | :70-76 | PROVEN (zalo-dm.test.ts:374-376) | also in NEW zalo-dm-templates.test.ts |
| M3 | cancelled: no price | :62-69 | GAP (prefix regex only, zalo-dm.test.ts:342-351) | NEW zalo-dm-templates.test.ts |
| M4 | updated: no price, label only | :88-97, FIELD_GROUPS :23-27 | GAP (prefix regex only, :325-332) | NEW zalo-dm-templates.test.ts |

NEW `apps/bot/src/projectors/zalo-dm-templates.test.ts` (pure unit, no DB): renderZaloDm for updated, cancelled and announce with amountDue 95_000 set, in vi and en (language selected the way zalo-dm.ts:169-170 does), contains neither fmtMoney(95_000) nor "Phí"/"Fee" nor a digit followed by đ/₫; plus one positive control (promoted with the same values contains fmtMoney(95_000)) so the negative assertions are not vacuous.

## Copy (pinned)

| Id | vi | en | Status |
|---|---|---|---|
| R1 (:41, unchanged) | "Bạn đã có chỗ trong buổi {ref}." | "You have a place in {ref}." | existing |
| R1amount (NEW row in the same reply table) | "Số tiền cần trả cho buổi này: {amount}" | "Amount due for this session: {amount}" | default applied, pending owner sign-off |
| R17 (:62, reused verbatim) | "Hiện chưa xem được số tiền cần trả. Vui lòng thử lại sau hoặc hỏi chủ kèo." | "Your amount due is unavailable right now. Please try again later or ask the host." | existing; one copy for the unknown state across /pay and /join |

R16 ("Bạn không có khoản nào cần trả." / "You have nothing to pay.", :61) is NOT used by /join (R3). R1amount is a real (vi, en) pair in the file's existing reply table, the pattern every reply row already uses (HARD RULE 5); W2 adds it to the copy rows at player-commands.test.ts:23.

## Pinned rulings R1-R10

- R1 amount source: the /pay reads, deps.readCharges(gate.accountRef) plus deps.payContext([]), extracted from payReply (:160-166) into ONE module-private helper used by /pay and by the /join amount line. It returns "unavailable" for the three R17 causes (account, summary, slug), otherwise the club's status or "absent"; it never catches. /pay keeps its exact mapping (absent or known_zero -> R16 at :167; the rest as :168-183), behaviour byte-identical; match item.sessionRef === row.sessionId; no export, caller or deps type changes. Suggested name ownClubPaymentStatus (writer's choice). Default applied, pending owner sign-off.
- R2 known_amount with the item present: R1, newline, R1amount with formatVnd(item.remaining); no R15partial marker, no R15pay line. Default applied, pending owner sign-off.
- R3 every other active case: R1, newline, R17 verbatim. Causes: accountRef missing or not a UUID, summary unknown, slug null, club absent, club status unknown, the joined session absent from known_amount, any throw inside the amount read (caught locally, never R18), AND club known_zero (Q-ID). Alternatives recorded, not taken: R16 as /pay renders it, once the memberships-writer check (backlog 2) proves person equality; the join result carrying chargeRemaining, rejected because P-18 pins "no amount" in JoinSessionResult (:46 [M]) and the lane block requires the same read as /pay. The lane-block row "amount proven 0" is therefore unreachable (the account-keyed source never proves a per-seat 0) and is tested as R17 (D4). Known consequence, stated for sign-off: a fully paid existing seat or a free session gets the R17 "unavailable" line, not "nothing to pay" (a recoverable wrong deny; /pay still lists the club). Default applied, pending owner sign-off.
- R4 waitlisted, requested and every error outcome unchanged (the lane block); readCharges and payContext are not called for them. Default applied, pending owner sign-off (the "not called" half).
- R5 promotion DM: Q-DM NO GAP; proven by the existing tests (M1) plus ONE new pure unit test file (M2-M4); no apps/bot product code change. Default applied, pending owner sign-off.
- R6 formatter: formatVnd, the channel's /pay formatter; the fmtMoney duplicate is backlog 1. Default applied, pending owner sign-off.
- R7 writer split (below); no copy-only unit, because the one copy row ships inside W1. Default applied, pending owner sign-off.
- R8 B3 estimate (below): a plan figure, measured by the writers.
- R9 spec follow-ups (below): PR body only, no edit.
- R10 impact: the GitNexus index dates from 2026-09-26; run impact on payReply and runPlayerCommand where it resolves, else the grep of callers (payReply is module-private; the importers of player-commands.ts are process-event.ts:36 and player-commands.test.ts:13 [A]); risk LOW; stated in the PR body.

## B3 budget and measurement

Caps pre-approved by the lane block: 300 non-test, 600 test, 900 total, 12 files, 0 migrations.

| Kind | Estimate (added) | Cap | Basis |
|---|---|---|---|
| Non-test | 35 to 50 | 300 | player-commands.ts: helper about 10, amount branch about 25, one copy row; payReply shrinks by the extracted lines |
| Test | 180 to 260 | 600 | player-commands.test.ts about 150 to 220 (D1-D8), NEW zalo-dm-templates.test.ts about 30 to 40 |
| Docs (reported separately) | this file, 213 lines (measured with `wc -l` before C0) | not counted against the non-test cap | step-0 readiness |
| Total | about 525 even if this file counts | 900 | |
| Files | 4 (2 existing: player-commands.ts, player-commands.test.ts; 2 new: zalo-dm-templates.test.ts and this file) | 12 | |
| Migrations | 0 | 0 | |
| Modules | 3: apps/web (lib/zalo), apps/bot (test only), docs | 3 | |

No B3 exception is needed. Writers measure the real numbers at their head with `git diff --numstat 797d648cc8cd598443fac2d2247e49d2a756954a...HEAD`; a figure above any cap is a ruling request BEFORE the push.

## Writer split and commit order (one live writer at a time in the worktree)

| Commit | Writer | File | Content |
|---|---|---|---|
| C0 | W0d (this reviewer) | this file | step-0 readiness, the branch's first commit |
| C1 | W1 opus/max | apps/web/lib/zalo/player-commands.ts | the helper (R1), the active-outcome amount line with its local try/catch (R2, R3), the R1amount copy row |
| C2 | W2 opus/max | apps/web/lib/zalo/player-commands.test.ts | D1-D8 with the named tests, the R1amount pair in vi and en, the same-source test, expectSafe kept for waitlisted and requested, spy-based "not called" |
| C3 | W3 opus/max | NEW apps/bot/src/projectors/zalo-dm-templates.test.ts | M2-M4 plus the positive control |

C1 alone turns the R-1 active pin (:281) red by design: W1 runs typecheck and lint and does NOT edit the test file; the web suite must be green at C2. Reviewers: code opus/max plus security opus/max, at most 3 rounds.

## Acceptance and verification

- V1 every [A] line is re-read with `sed -n` before use; a mismatch stops that item and the orchestrator rules.
- V2 scope: `git diff --name-only 797d648cc8cd598443fac2d2247e49d2a756954a...HEAD` lists only the 4 files; the same diff restricted to apps/bot shows only the new test file, and restricted to packages it is empty.
- V3 /pay unchanged: the /pay describe (player-commands.test.ts:534-605) passes with no expectation edited.
- V4 no amount elsewhere: D5-D7 pass expectSafe with the spies at 0 calls; M2-M4 pass with the positive control green.
- V5 impact per R10 before editing; detect_changes (or the grep fallback) before each commit, stated in the PR body.
- Commands (cite measured output through `| tail -40`): pnpm typecheck; pnpm lint; pnpm format:check; pnpm review:check:changed; NODE_ENV=test pnpm --filter @plexco/web test (the FULL web vitest); NODE_ENV=test DATABASE_URL_TEST=... pnpm --filter @plexco/bot test (DB lock); NODE_ENV=test DATABASE_URL_TEST=... pnpm -w test (DB lock); pnpm build once at the final head (sandbox off). The db package suite and Playwright are not required: no db file and no web UI changes (if either does, run it).

## Spec follow-ups (not edited; PR body only)

- docs/features/BE/feature_zalo_channel_tech.md (Status Reviewed :5), :222 Active row (`Đã tham gia [session]! [venue]`): add the amount owed line (DD-140, named at decisions.md:1819); its [venue] already contradicts Z-13 and P-11 (older drift, note only). Optionally :224 "Existing active/waitlisted, Render current state idempotently": add "with the current amount owed". :223 Waitlisted is consistent [A].
- The W0b corpus grep of docs/features, docs/channels and docs/product found no other Zalo /join or Zalo DM no-amount statement; dated readiness records keep the old rule as history and are not edited [A].

## OUT_OF_SCOPE and backlog candidates

1. Two VND formatters: formatVnd (apps/web/lib/money.ts:28-31) and @plexco/core fmtMoney (packages/core/src/format.ts:12); unify them, or pin their equality with one test.
2. Person equality (Q-ID): prove that every memberships writer refuses a non-active person (W0c grep for `INSERT INTO memberships` and `insert(memberships)` in packages/db/migrations and packages/db/src, then each hit's guard). EQUAL would let D4 render R16 as /pay does, and an absent item render a per-session "nothing to pay" line (a later lane flips those R3 arms).
3. resolveZaloIdentity's active-person requirement is measured by proxy only (22023 "person is not active", process-event.ts:228-229).
4. The webhook route's pre-store drop of non-DM events is cited from a comment (process-event.ts:112-113); the route file was not read.
5. readMyCharges' club cap (TOO_MANY_OPEN_CHARGES above 200 gives summary unknown, so R17 already; not blocking).
6. DD-140's own citations of P-11 and Z-13 use older line numbers; at the base they are decisions.md:1957 and :1925 (lanes never edit decisions.md; L17 consolidates).

## Closure matrix (12 of 12)

| # | Gate | Evidence | Result |
|---|---|---|---|
| 1 | Authority snapshot pinned by SHA | `AUTHORITY_SHA` below = worktree HEAD at the step-0 start; the DD-140 merge is an ancestor; every TARGET_FILES path exists | PASS |
| 2 | Decisions in scope are final | B2 confirmed by the owner, DD-140 on the base; R1-R7 are Tier-B pins | PASS |
| 3 | Scope IN/OUT and owner clear | lane block negative scope; file ownership beside L23 (the shared packages/db/src/index.ts is untouched) | PASS |
| 4 | Dependencies classified | L19 merged and in the base; L23 (P3-S15d) runs beside with disjoint files | PASS |
| 5 | Live schema and code match the claims | Q1-Q5, Q-ID and Q-DM [A]; three [M] spot-checks matched | PASS |
| 6 | Data, API, state and auth contract complete | no schema, route, deps-type or join-result change; the helper contract and the copy table pin the only new behaviour | PASS |
| 7 | Fail-closed, idempotency, order | R17 on every non-proof case, throws and known_zero included; a replay re-reads the current amount; the read runs only after the committed join | PASS |
| 8 | Open questions in scope = 0 | R1-R7 pinned as defaults pending owner sign-off; Q-ID resolved fail-closed | PASS |
| 9 | Acceptance matrix has expected results | D1-D8, M1-M4, V1-V5 | PASS |
| 10 | Migration, security and rollback pinned | no migration, no secret; security round opus/max; rollback = revert the single PR | PASS |
| 11 | First slice has hard dependency merged | the base contains the L19 merge | PASS |
| 12 | Implementation handoff ready | rulings, copy, decision and DM tables, writer split, commit order, verification | PASS |

## Verdict

```text
REVIEW_POLICY_VERSION: 1.3
REVIEW_VERDICT: CODE_READY
REVIEWED_AT: 2026-10-21
AUTHORITY_SHA: 797d648cc8cd598443fac2d2247e49d2a756954a
BASE_BRANCH: main
TARGET_FILES:
  - apps/web/lib/zalo/player-commands.ts
  - apps/web/lib/zalo/player-commands.test.ts
SLICE: p3-zalo-join-amount-owed
IN_SCOPE: the Zalo number-reply confirmation of the ACTIVE join outcome gains one line with the amount owed for that session, read through one module-private helper shared with the /pay reply (same readCharges and payContext reads, formatVnd, item sessionRef equal to the joined session id), R17 on every case that is not a proof; tests for every decision-table row; a new pure unit test file apps/bot/src/projectors/zalo-dm-templates.test.ts proving that the updated, cancelled and announce DMs carry no price
OUT_OF_SCOPE: an amount in the waitlisted, requested, error or any other reply or DM; bank data, account number, QR or payment link; any change to the join outcome, prices, charges, occupancy or promotion order; session-join-service.ts and JoinSessionResult; apps/bot product code; a second outstanding-amount formula or a formatter merge; venue in any Zalo message; a migration; a Reviewed spec; decisions.md; web UI; the files owned by L23
G1_DECISION: PASS
G2_SPEC: PASS # DD-140 (B2) amends DD-138 P-11 and Z-13 for the two messages; the Reviewed Zalo channel spec is not edited (follow-ups listed)
G3_DEPENDENCY: PASS
G4_TEST: PASS
G5_SCOPE: PASS # 4 files, 0 migrations, 3 modules, inside the pre-approved caps
G6_EXTERNAL: ENABLEMENT_ONLY:owner-P0-real-zalo-bot-token-and-deliverer # no provider call in this lane; tests inject deps
HARD_DEPENDENCIES: all merged with probes (L19 PR 93 merge 6d7bfccac7401d0052be643d29e5bb0cbfbc0c0e is an ancestor of the base and carries DD-140; probes: payReply in player-commands.ts, readMyCharges in me-player-reads.ts, renderZaloDm in zalo-dm-templates.ts)
PRIOR_SLICES: L8 (the promoted DM template); L13 p3-m9-zalo-player-commands (/join, /pay, link gate); L19 p3-owner-decisions-2026-10-21 (PR 93)
OPEN_QUESTIONS_IN_SCOPE: 0
ENABLEMENT_ONLY_GATES: owner P0 for real use: the Zalo bot token and the real deliverer; none is claimed done or changed by this lane
LIVE_REPO_VERIFICATION: PASS # measured at AUTHORITY_SHA by W0, W0b and W0c; three spot-checks re-read by this reviewer matched
CONTRACT_MATRIX: PASS
CLOSURE_MATRIX: PASS
ACCEPTANCE_MATRIX: PASS
SECURITY_AND_MIGRATION_GATE: PASS # no migration, no secret; money on an external channel: opus/max security round required
IMPLEMENTATION_ARTIFACTS: PASS # DD-122 D4: lane block, this file and the worktree at the exact base; no scope-gate lifecycle
FIRST_IMPLEMENTATION_STEP: W1 extracts the module-private helper from payReply (player-commands.ts:160-166) with /pay behaviour byte-identical, adds the R1amount pair and the active-outcome amount line after :152 in its own try/catch, and commits C1
REMAINING_BLOCKERS: none
```
