<!-- review-readiness: code-ready -->

# Step-0 readiness: L44 p4-zalo-dm-deadline-and-clock (session P4-S3b)

> Agent-facing. Step-0 readers: S0a (the code), S0b (decisions, backlog, reconcile), S0c (tests and tools), opus/high, one at a time. This file was
> written by the session orchestrator (run 2) from their notes and its own re-measure after the catch-up merge. Writers: W1 opus/high (the projector
> and the dispatcher call site), W2 opus/high (the tests). Code reviewer: opus/max, one role in two area units (R1a, R1b), at most 3 rounds. No
> security round (section 9: the judgement and its void condition). RISK: P2 (bot transport code, retry liveness; no money, no schema).
> Base: `db8230e762bd36d21599fe4bd7dbb4725dbc364a` (main, the merge of PR #124). The branch carries it through the catch-up merge
> `00da218444dd8894fa3a9b78386810b2fe0f7a87` (parents `e1812aa5c56c6aea2da8d318f21b063f0de35b28`, the lane's first base, and the base; same tree as the
> base; nothing under apps/bot changed). Branch `feat/p4-zalo-dm-deadline-and-clock`; worktree `.autopilot/worktrees/p4-zalo-dm-deadline-and-clock`,
> clean at step 0. Every `path:line` below was MEASURED: the code lines by S0a at the first base and re-measured by the orchestrator at `00da218`; the
> decisions.md lines re-measured at `00da218` (the merge moved them by +14). The readers' notes live outside the repo (session notes P4-S3b:
> `step0-S0a-code.md`, `step0-S0b-process.md`, `step0-S0c-tests-and-tools.md`), so this file restates every fact it relies on. No tracked file was
> edited at step 0; no test or DB command ran.

## 1. Authority

- The owner's written approval of 2026-10-26, verbatim: "Phase 4 plan approved, Q1-Q10 default". It is the owner's own decision. It approves
  `docs/sessions/web-mvp-phase4-plan.md` (merged as PR #114), whose section 3 row L44 (:60) is this lane. None of Q1-Q10 names L44 (measured: the only
  plan line naming L44 and a Q is the waves line :100, whose Q2 and Q3 gate L56 and L57).
- Lane contract: lane block L44 of the conductor-authored P4-S3b session brief (not on main): leads (1)-(4), GOAL 1-5, FILE OWNERSHIP, NEGATIVE SCOPE,
  THREAT MODEL, TESTS, REVIEW PLAN, STOP, B3.
- RO-L44-1, a conductor ruling, decided by the conductor under the owner's delegation of 2026-10-22, not an owner signature (Tier B, reversible):
  (1) the catch-up merge of origin/main first (done: `00da218`); (2) one agent live at a time; (3) the design defaults (a)-(g), pre-approved as Tier B
  and listed in the PR body as "default applied, pending owner sign-off" (section 6); (4) B3 is an estimate: continue past the lane block's figures
  with the design reason logged, up to 200 non-test / 450 test / 650 total lines / 9 files, beyond that a ruling request; (5) no security round, with
  the void condition; (6) both rows closed by hand in the L37 form with slice-unique probes; (7) the bot suite through the lane's lock wrapper; (8) the
  PR body in the shape of PR #124.
- The owner's concurrency rule of 2026-10-26 18:32: one orchestrator, one agent live at a time.
- DD-146 (`docs/standards/decisions.md:2026`) and its defaults DF0-DF7, accepted under the owner's delegation of 2026-10-24 (assistant review) (DD-149):
  the bound this lane carries into deliver() (section 3).
- Every other choice in this file is labelled "default applied, pending owner sign-off" (section 6) and is repeated in the PR body.

## 2. Measured at base: the code

D = `apps/bot/src/dispatcher.ts` (624 lines), Z = `apps/bot/src/projectors/zalo-dm.ts` (246 lines), M22 / M71 = `packages/db/migrations/0022_job_claim_lease_core.sql` / `0071_zalo_dm_promotion_start_definer.sql`.

- The bound: `apps/bot/src/zalo-dm-delivery-age-bound.json` is `{ "maxAgeMinutes": 60, "untilSessionStart": ["player.promoted"] }`. D:63
  `export const ZALO_DM_MAX_AGE_MINUTES: number = zaloDmDeliveryAgeBound.maxAgeMinutes;`, D:70 `ZALO_DM_UNTIL_SESSION_START`.
- The verdicts: D:96-97 `ZaloDmAgeVerdict = { expired: false; ageSeconds: number } | { expired: true; ageSeconds: number | "unreadable" }`; D:103
  `return { expired: raw > ZALO_DM_MAX_AGE_MINUTES * 60, ageSeconds: raw };` (strict: the bound itself delivers, so `3600 - ageSeconds` is 0 or more,
  above 3600 when created_at is ahead of the DB clock, fractional); D:136-138 `ZaloDmStartVerdict` (`{ rule: "until_session_start"; expired: false;
  secondsToStart: number }` or expired); D:144 `if (value > 0) return { rule: "until_session_start", expired: false, secondsToStart: value };`.
- The clocks: D:129 `SELECT date_part('epoch', clock_timestamp() - $1::timestamptz) AS age_s` (the DB clock, its own autocommit query); M71:42
  `date_part('epoch', s.starts_at - clock_timestamp())` under the live claim (M71:51). Both return float8 (a JS number).
- The call site, D:357-371: ONE verdict per zalo_dm row, D:359-361 `expiry = ZALO_DM_UNTIL_SESSION_START.includes(job.event.eventType) ? await
  zaloDmPromotionStart(pool, job.eventId, job.claimToken) : await zaloDmDeliveryAge(pool, job.event.createdAt);`; D:362-365 a null start read counts a
  lease-lost skip and breaks; D:369-371 `outcome = expiry?.expired ? { result: "delivered", providerRef: "noop_expired" } : await deliver(job);`. Between
  the clock read and deliver's first statement (Z:88) only synchronous code runs: no awaited query, decrypt or registry read sits in that gap.
- The job and the type: D:26-35 `ClaimedDeliveryJob { eventId; tenantId; projector; claimToken; attempts; event }`; D:47 `export type DeliverFn = (job:
  ClaimedDeliveryJob) => Promise<DeliveryOutcome>;`. Implementations: D:57 `productionStubDeliver`; `apps/bot/src/projectors/public-sessions.ts:48` and
  `:94` (the wrapper `:102 return production(job);`); `apps/bot/src/projectors/web-realtime.ts:44`; Z:83 `createZaloDmDeliver` and Z:230 `deliverZaloDm`
  (the wrapper Z:238 `return production.deliver(job);`). One call site: D:371.
- The outcomes: D:42-45 the union (`retry` and `dlq` carry `errorCode: string`, a plain string); D:506 `export const ERROR_CODE_RE =
  /^[a-z][a-z0-9_]{0,63}$/;`. A retry at attempts 0..6 is rescheduled on the dispatcher's WALL clock (D:601-602 `nextAttemptAt: new
  Date(now().getTime() + retryDelayMs(attempts))`, the DB re-checks it against clock_timestamp(), D:165-166); at attempts 7 or more it becomes dlq
  `attempts_exhausted` (D:591); the schedule is 15 s x 2^(n-1), 8 attempts (D:13-23).
- The lease: set once at claim, M22:380 `lease_expires_at = now() + interval '5 minutes'`, never extended (grep `extend_.*lease|renew` over the
  migrations: 0 hits). Z:29 `const ATTEMPT_BUDGET_MS = 120_000; // Z-14: below the 5 min claim lease`.
- The projector's clock: Z:84 `const { db, send = sendMessage, now = Date.now, open = openConnectorSecret } = deps;` (the WALL clock), Z:63 `now?: () =>
  number;`, Z:88 `const started = now();`, Z:192-193 `const remaining = ATTEMPT_BUDGET_MS - (now() - started); if (remaining <= 0) return
  retry("send_budget_exhausted");`, Z:207 `await send(token, chatId, text, { timeoutMs: Math.min(sendTimeoutMs, remaining) });` (stale by the awaited
  decrypt at Z:198), Z:36 `const retry = (errorCode: string): DeliveryOutcome => ({ result: "retry", errorCode });`.
- The order inside deliver: the event checks (no I/O); Z:121 `await resolveConnectorSecretRoot();`; Z:136 the targets read `SELECT * FROM
  zalo_dm_delivery_targets($1, $2, $3)` (its definer writes the decrypt audit before it returns any ciphertext, Z:20-21); Z:155 the bot token decrypt;
  Z:189 the recipient loop: Z:190 the registry re-check, Z:192-193 the budget, Z:198 `chatId = await open(row.recipient_user_id_enc, binding);`, Z:207
  the send.
- The send: `packages/db/src/zalo-bot-api.ts:129` `opts: { timeoutMs?: number } = {},` leads to `:74` `signal: AbortSignal.timeout(timeoutMs),`, which
  covers the body, so a clamped timeoutMs ends our side of the request.
- GitNexus is stale for this area: `DeliverFn` is not indexed ("Target 'DeliverFn' not found"); `createZaloDmDeliver` shows risk LOW with 0 callers,
  which grep contradicts (Z:236 `production = { pool, deliver: createZaloDmDeliver({ db: pool }) };`); `runDispatchCycle` LOW, 1 direct caller
  (`apps/bot/src/worker.ts` main). The caller lists come from `git grep -w`.

## 3. Measured at base: DD-146

- `docs/standards/decisions.md:2026` the DD-146 heading; `:2031` the bound: the age is measured on `outbox_events.created_at` by the DB clock, expired
  when `age > bound` (a row exactly 60 minutes old still delivers).
- `:2032`, end of the line, verbatim: "Tuổi được kiểm một lần ở đầu mỗi lần giao, nên một lần gửi bắt đầu khi event còn trong ngưỡng vẫn có thể kết
  thúc muộn tới 120 s sau đó (`ATTEMPT_BUDGET_MS`, `zalo-dm.ts:29`): chấp nhận, như readiness mục 4.2 điểm 9 đã nêu." In English: the age is checked once,
  at the start of each attempt, so a send that starts inside the bound can end up to 120 s later; ACCEPTED.
- `:2042` DF3: the record of an EXPIRED row is `delivered` with `noop_expired`; for that record it rejects the M type, the dlq variant and the `retry`
  result (counted as a failed attempt). A deadline-cut attempt is not an expired row: it ends as one failed attempt, the next claim re-checks the age or
  the start and DF3 records the expiry. So no DD-146 text forbids the retry-family outcome (the lane block's STOP condition 2 does not fire).
- `:2054` the start read: for `player.promoted` the dispatcher reads the 0071 definer at one place before deliver(); `> 0` delivers, `<= 0` and NULL end
  as DF3. So `player.promoted` is bounded by the session start INSTEAD of the age. `:2056` names the same accepted 120 s window for the promotion DM.
- Hence this lane NARROWS an accepted DD-146 window; it does not fix a violation.

## 4. Measured at base: tests and tools

ZT = `apps/bot/src/projectors/zalo-dm.test.ts` (716 lines), DT = `apps/bot/src/dispatcher.test.ts` (1443), OT = `apps/bot/src/dispatcher-outcome.test.ts` (321).

- No test in ZT, DT or OT fakes timers or spies on Date (zero hits for `useFakeTimers`, `useRealTimers`, `advanceTimers`, `setSystemTime`,
  `spyOn(Date`, `performance`). Of the six `createZaloDmDeliver(` calls in ZT, five use the default `now` (ZT:72, :234, :530, :620, :634); only A27
  injects one (ZT:662 `createZaloDmDeliver({ db: ctx.worker, send, now: () => clock })`); ZT:690 and :692 use the registry entry `deliverZaloDm`.
- The fake sends (A21 ZT:628-631, A27 ZT:656-659) forward their arguments to the real `sendMessage` against the stub and record nothing; the stub
  records token, chat id and text only (`apps/bot/src/test-zalo-stub.ts:44`). So no test observes `timeoutMs` today.
- Jobs in ZT carry a HOST-clock `createdAt` (ZT:66, ZT:310), while the DD-146 age is measured on the DB clock (DT:181 asserts the D:129 SQL). That is
  why the deadline is computed by the dispatcher from its DB-clock verdict and carried as a relative number (D1, D2), never re-derived in deliver()
  from `createdAt`.
- Closest existing tests: (a) none observes `timeoutMs` (nearest ZT:540 A12, a slow reply under `sendTimeoutMs: 300`); (b) ZT:652 A27 (ZT:658
  `clock = 120_001;` inside the first send, ZT:663 `retry("send_budget_exhausted")`, ZT:664 one chat) and ZT:625 A21 (`projector_disabled` between two
  recipients); (c) `apps/bot/src/projector-registry.test.ts:638` BS-3 at the dispatcher level and the DD-146 blocks DT:145 (DA-1; DA-1b on the real DB
  at DT:193) and DT:213 (player.promoted: PSD-7 DT:238, PSD-9 DT:265); (d) none.
- Fake timers: vitest resolves to 4.1.12 (`apps/bot/package.json:23` `^4.1.12`). Its default `toFake` is every timer except `nextTick` and
  `queueMicrotask`, so `performance` is faked by default, and `vi.setSystemTime` does not move the faked `performance.now()` (vitest's dist, quoted in
  the S0c notes). The only fake-timer test in apps/bot/src is `apps/bot/src/projectors/web-realtime.test.ts:63-75`, which never reaches zalo_dm
  deliver(). So the monotonic default (D6) changes no existing test.
- The test cycle: `apps/bot/vitest.config.ts` (11 lines): `fileParallelism: true`, `sequence: { concurrent: false }`, `testTimeout: 60_000`,
  `hookTimeout: 120_000`, no fakeTimers option. ZT and DT use `apps/bot/src/test-db.ts` (the database; its reader lock shares the "jobd" key with
  packages/db's harness, test-db.ts:20); OT does not (a pure unit test). CI runs the bot suite only inside `pnpm -w test` (`.github/workflows/ci.yml:106`)
  with postgres:16-alpine and a 20-minute job limit (:29).
- The validator `scripts/check-review-readiness.mjs`: a file is a candidate by name (:15 `/(^|[-_.])(review|readiness|plan)([-_.]|$)/i`) or by a
  `REVIEW_VERDICT:` line (:591-592); a verdict block carries the 27 REQUIRED_FIELDS (:17-45); every TARGET_FILES path must exist on disk (:280,
  `TARGET_FILES_MISSING` :285), so the verdict lists existing files only.
- The backlog after the merge: 7328 lines; the rows' headings are `docs/autopilot-backlog.md:6984` (`zalo-dm-send-deadline-into-deliver`) and :6999
  (`zalo-dm-attempt-budget-monotonic-clock`), both `status: idea`, `merged_probe: null`, no `close_by`. Lead correction: the plan row
  (`docs/sessions/web-mvp-phase4-plan.md:60`) and the lane block point at older line numbers (about :6969-6985); the rows are matched by their text.

## 5. Decision table

| # | Input | `deliveryDeadlineMs` | Result |
|---|---|---|---|
| 1 | projector other than zalo_dm | absent: the same job object is passed | unchanged; no other projector reads the field |
| 2 | zalo_dm, age verdict expired or unreadable | deliver() not called | unchanged: delivered / noop_expired (DF3) |
| 3 | zalo_dm player.promoted, start verdict expired or NULL | deliver() not called | unchanged: delivered / noop_expired (DF3) |
| 4 | zalo_dm player.promoted, the start read finds the claim gone | deliver() not called | unchanged: lease-lost skip, break |
| 5 | zalo_dm, age verdict not expired | `(ZALO_DM_MAX_AGE_MINUTES * 60 - ageSeconds) * 1000` (0 or more) | deliver() with the deadline |
| 6 | zalo_dm player.promoted, start verdict not expired | `secondsToStart * 1000` (above 0) | deliver() with the deadline |
| 7 | in deliver(): field absent | the cap is ATTEMPT_BUDGET_MS | as today, measured on the monotonic clock |
| 8 | in deliver(): field present but not finite | counts as 0 (fail closed) | row 9 |
| 9 | in deliver(): deadline left `<= 0` right before the targets read | | retry `delivery_deadline_reached`; no targets read, no decrypt, no send |
| 10 | at a loop turn (before the chat-id decrypt): the binding cap's time left `<= 0` | | retry with the binding cap's code: `delivery_deadline_reached` when the deadline is below the budget, else `send_budget_exhausted` |
| 11 | after the chat-id decrypt, right before the send: time left `<= 0` | | the same retry code; this send is not made |
| 12 | right before the send: time left `> 0` | | send with `timeoutMs = Math.min(sendTimeoutMs, left)`, `left` re-measured after the decrypt |

The binding cap is the smaller of ATTEMPT_BUDGET_MS and the deadline: both run from the same `started`, so the smaller one always runs out first.

## 6. Pinned defaults

Each is "default applied, pending owner sign-off" (Tier B, reversible by editing this lane's files), except D2, which is derived (Tier A).

- D1 (RO-L44-1 3(a)): the deadline travels as an OPTIONAL FIELD `deliveryDeadlineMs?: number` of `ClaimedDeliveryJob` (D:26-35), set only at the D:371
  call and only for a non-expired zalo_dm verdict; `DeliverFn` (D:47) is unchanged and both wrappers (Z:238, public-sessions.ts:102) forward the job
  as is. Rejected: an optional second parameter of `DeliverFn` (Z:238 `return production.deliver(job)` would still compile and silently drop it in
  production while the projector's own tests pass); an absolute wall-clock deadline (a second "now", threat 4).
- D2 (Tier A, from D:359-361 and decisions.md:2054): the bound is the one the dispatcher's verdict applied: the age rule gives
  `(ZALO_DM_MAX_AGE_MINUTES * 60 - ageSeconds) * 1000`, the start rule (player.promoted) gives `secondsToStart * 1000`, computed by one pure exported
  helper `zaloDmDeliveryDeadlineMs` in D next to the verdicts. RO-L44-1 3(b)'s "minimum of the bounds that apply" is therefore the minimum of the 120 s
  budget and the one DD-146 bound that applies to that event: D:359-361 applies exactly one rule per event and DD-146 bounds player.promoted by the start
  instead of the age. Rejected: also computing the age bound for player.promoted (it would refuse promotion DMs the rule delivers today, a rule change
  outside the negative scope, and add a DB query).
- D3 (3(c)): the early check sits right before the targets read (Z:136): a deadline left `<= 0` returns the retry family, so nothing is read,
  decrypted or sent.
- D4 (3(d)): the time left is re-measured right before each send, after the chat-id decrypt (Z:198), and clamps the send's `timeoutMs`; the loop-turn
  check at Z:192-193 stays (it saves a decrypt when the time is already gone) and covers the deadline too.
- D5 (3(e)): the deadline outcome is `{ result: "retry", errorCode: "delivery_deadline_reached" }` (matches ERROR_CODE_RE; no shared union widens).
  Rejected: reusing `send_budget_exhausted` (an operator could not tell that the next claim will expire the row); a dlq (a deadline is not a failure of
  the message; threat 3); returning delivered / noop_expired from inside deliver() (the dispatcher's pre-send verdict stays the one place that expires a
  row).
- D6 (3(f)): the budget and the deadline are measured on a monotonic clock: `const monotonicNowMs = (): number => performance.now();` in Z is the default
  of `now` at Z:84 (an arrow, because Node checks the receiver of `performance.now`); the seam type Z:63 is unchanged. The dispatcher's wall-clock `now`
  (D:165-166, D:601-602) is untouched: the DB compares nextAttemptAt with clock_timestamp().
- D7 (3(g)): the residual: the deadline is late by the gap between the DB clock read (inside the age or start query) and Z:88's `started`: the rest of
  that statement, about half a round trip and synchronous code (section 2). Stated in the threat model and the PR body.
- D8: a present `deliveryDeadlineMs` that is not a finite number counts as 0 (fail closed: retry, nothing sent). The dispatcher only produces finite
  values (D:101-103 and D:144 reject non-finite reads), so this guards the type, not a known input.

## 7. Implementation steps

- W1 (opus/high, the only writer; GitNexus `impact` first on `createZaloDmDeliver`, `runDispatchCycle` and `DeliverFn`, recorded with a `git grep -w`
  callers line because the index is stale):
  1. D:26-35: add `deliveryDeadlineMs?: number` with a doc comment (milliseconds from the DB clock read to the DD-146 bound; zalo_dm only; deliver()
     anchors it at its own start on its monotonic clock).
  2. D: the pure helper `zaloDmDeliveryDeadlineMs(verdict)` for a non-expired age or start verdict (D2), next to the verdicts.
  3. D:369-371: pass `{ ...job, deliveryDeadlineMs: zaloDmDeliveryDeadlineMs(expiry) }` when `expiry` is a non-expired verdict, else `job` unchanged.
  4. Z: `monotonicNowMs` and the Z:84 default (D6); the deadline read once (D8); one small helper for the binding cap's time left and its code
     (section 5 rows 10-12); the early check right before Z:136 (D3); Z:192-193 through that helper; after Z:198 the re-measure, `<= 0` returns the
     retry, else Z:207 uses `Math.min(sendTimeoutMs, left)` (D4).
  5. Keep byte-identical: Z:121, the Z:136 query, Z:155, Z:196-198 (the decrypt lines); no new log line; no lease SQL.
  6. typecheck, lint, format:check and the three existing test files green (the bot suite through the lane's lock wrapper); commit.
- W2 (opus/high, the next orchestrator run): the tests of section 8 in the three existing files.

## 8. Acceptance matrix

| # | Case | File | Setup | Expected |
|---|---|---|---|---|
| a | a send that starts a few seconds inside the bound (lead (4)(a)) | ZT, DB-backed describe | `deliveryDeadlineMs: 3_000`, an injected fake `now`, the chat-id decrypt advances the clock by 1_000, a send that records its options | one send; its `timeoutMs` <= 2_000 and > 0: re-measured after the decrypt (D4) |
| a2 | no deadline field | ZT | the same without the field | `timeoutMs` = `Math.min(sendTimeoutMs, budget left)`: unchanged |
| b | the deadline passes between recipient 1 and 2 (lead (4)(b)) | ZT | the A27 shape with two recipients, `deliveryDeadlineMs: 5_000`, the first send moves the clock to 5_001 | one chat; outcome `{ result: "retry", errorCode: "delivery_deadline_reached" }` |
| b2 | the budget still binds when it is the smaller cap | ZT | A27 as is | `retry("send_budget_exhausted")`, unchanged |
| c1 | an attempt with no time left reads and sends nothing (lead (4)(c)) | ZT, before-any-DB-call describe | `deliveryDeadlineMs` 0, -1 and NaN | `retry("delivery_deadline_reached")`; the db fake sees no query; no decrypt; no send |
| c2 | the dispatcher passes the bound | DT, DD-146 blocks, real DB | a fresh zalo_dm row (age rule) and a player.promoted row (start rule), a deliver fake that records the job | the recorded `deliveryDeadlineMs` lies in (0, 3_600_000] and within a few seconds of `(3600 - age) * 1000`; for player.promoted within a few seconds of the seconds to start x 1000 (a bracket, never an exact value) |
| c3 | other projectors are untouched | DT | a non-zalo row | the fake gets the job without the field (`"deliveryDeadlineMs" in job` is false) |
| c4 | an expired row never reaches deliver() | DT | the existing DA and PSD tests | unchanged: extend, do not duplicate |
| c5 | the helper | OT, no DB | `zaloDmDeliveryDeadlineMs` for ageSeconds 0, 1800.5, 3600, -5 and secondsToStart 12.5 | 3_600_000, 1_799_500, 0, 3_605_000, 12_500 |
| d | a system clock jump does not change the budget under the default `now` (lead (4)(d)) | ZT, real timers | no `now` injected; `vi.spyOn(Date, "now")` moved by +2 h, and in a second case by -2 h, between the first and the second send of a two-recipient delivery with `deliveryDeadlineMs: 10_000`; the spy restored in `finally` | both sends made; the second send's `timeoutMs` <= 10_000 (a backward jump does not stretch the deadline, a forward jump does not starve the budget) |
| e | the bot cycle (lead (4)(e)) | all | `pnpm --filter @plexco/bot test` through the lane's lock wrapper | green; a failure only from the ACTIVE flake list gets one rerun |

Every loop test stays at most about 3 s locally with its own explicit `30_000` budget; no RegExp is built from data.

## 9. Verification

- Focused: `pnpm --filter @plexco/bot test` (the bot suite uses the database: run through the lane's lock wrapper, each window announced in the session
  report); then `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm review:check:changed` before every commit and the full `pnpm review:check`;
  `pnpm build` once; `pnpm -w test` once at the final head (one rerun for an entry on the clerk's ACTIVE flake list: the apps/bot timing tests
  outbox-wake A26 and A28, test-harness:149, schedule.test.ts, and the app_worker password failure in dispatcher.test.ts); GitNexus `detect_changes`
  at the end.
- CI-only patterns: every loop test at most about 3 s locally with its own explicit `30_000` budget; no RegExp built from data.
- Security judgement: no security round. The edits change neither decrypt call nor its inputs (Z:155, Z:198), nor the decrypt audit (the targets
  definer behind Z:136), nor the claim lease (M22:380, never extended), and add no log line. VOID if the diff touches Z:121, the Z:136 query, Z:155,
  Z:196-198, the targets definer or any lease SQL, or logs a token, chat id or DM text: then a security round is added and the reason recorded.

## 10. Budget (B3)

Lane block: up to 120 non-test, 300 test, 420 total lines (docs excluded), 7 files, 0 migrations. Estimate: about 30-45 non-test lines (S0a: 25-40)
and about 150-250 test lines in 6 files (zalo-dm.ts, dispatcher.ts, the three test files, docs/autopilot-backlog.md) plus this file; 0 migrations.
RO-L44-1 (4): past the lane block's figures the lane continues with the design reason logged, up to 200 / 450 / 650 lines and 9 files; beyond that a
ruling request before the next writer.

## 11. THREAT MODEL

Defends against: (1) a DM delivered after the DD-146 bound because a send started inside it (D2-D4: no send starts past the deadline, a running
send's timeout ends at it); (2) a budget stretched or shrunk by a system clock jump (D6: both run on the monotonic clock); (3) a regression of the
retry liveness (D5: the deadline ends in the retry family, the next claim expires the row through DF3, attempts 7 and more end in a visible dlq
`attempts_exhausted`; never a silent drop); (4) a second source of "now" (the DB clock for the bound, the monotonic clock for elapsed time; no wall
time enters the budget; the dispatcher's wall clock stays for the retry schedule only); (5) logging a token, chat id or DM text (no new log line).
Not defended: an in-flight HTTP request that the network completes after our timeout (the abort ends our side only); the D7 gap.

## 12. OPEN

None in scope. Out of scope and unchanged: the 60-minute bound and its JSON, the 120 s budget, the retry schedule, the claim lease, the registry and the
CLI that enables the projector, the dispatcher's wall clock, every other projector, PR #50. Rows: the two rows below are closed by hand in the L37 form;
at most 3 new rows for out-of-scope findings (none planned).

- `zalo-dm-send-deadline-into-deliver`: `merged_probe: apps/bot/src/projectors/zalo-dm.ts :: deliveryDeadlineMs`.
- `zalo-dm-attempt-budget-monotonic-clock`: `merged_probe: apps/bot/src/projectors/zalo-dm.ts :: monotonicNowMs`.
- Both identifiers are absent at the base (`git grep -w -c <identifier> db8230e762bd36d21599fe4bd7dbb4725dbc364a -- .`: 0 files each) and present at the
  head once W1 lands.

## 13. Closure matrix (12 of 12)

| # | Gate | Evidence | Result |
|---|---|---|---|
| 1 | Authority snapshot pinned by SHA | `AUTHORITY_SHA` = the base, whose tree the worktree HEAD `00da218` carries (measured); every TARGET_FILES path exists (`git ls-files`, measured) | PASS |
| 2 | Decisions in scope final | the owner approval of 2026-10-26 (section 1); DD-146 with DF0-DF7 (DD-149); RO-L44-1; D1-D8 pinned (section 6) | PASS |
| 3 | Scope IN/OUT and owner clear | lane block FILE OWNERSHIP and NEGATIVE SCOPE; the edit sites in section 7; section 12 | PASS |
| 4 | Dependencies classified | a root slice (plan :89 `L44 <- (none)`); no migration slot; L45 waits for its merge (plan :92) | PASS |
| 5 | Live schema and code match | sections 2-4, each fact measured | PASS |
| 6 | Data, API, state, auth contract | no migration, table, column, env var or dependency; `DeliverFn` unchanged; one optional job field (D1) | PASS |
| 7 | Fail-closed, idempotency, order | section 5; D8; the early check before any read (D3); the retry family, never a drop (D5) | PASS |
| 8 | Open questions in scope = 0 | D1-D8 pinned; section 12 holds only out-of-scope items | PASS |
| 9 | Acceptance matrix with expected results | section 8 | PASS |
| 10 | Migration, security, rollback | 0 migrations; no security round (the judgement and its void condition, section 9); rollback = revert of the lane's commits | PASS |
| 11 | First slice hard dependencies merged | none; base = origin/main at the merge of PR #124 | PASS |
| 12 | Implementation handoff ready | sections 5-9; the worktree exists, clean | PASS |

## 14. Verdict

```text
REVIEW_POLICY_VERSION: 1.3
REVIEW_VERDICT: CODE_READY
REVIEWED_AT: 2026-10-26
AUTHORITY_SHA: db8230e762bd36d21599fe4bd7dbb4725dbc364a
BASE_BRANCH: main
TARGET_FILES:
  - apps/bot/src/projectors/zalo-dm.ts (edited)
  - apps/bot/src/dispatcher.ts (edited)
  - apps/bot/src/projectors/zalo-dm.test.ts (edited)
  - apps/bot/src/dispatcher.test.ts (edited)
  - apps/bot/src/dispatcher-outcome.test.ts (edited)
  - docs/autopilot-backlog.md (edited)
  - apps/bot/src/zalo-dm-delivery-age-bound.json (read only: maxAgeMinutes 60, untilSessionStart player.promoted)
  - apps/bot/src/projectors/index.ts (read only: the PROJECTORS map)
  - apps/bot/src/projectors/public-sessions.ts (read only: the wrapper forwards the job)
  - apps/bot/src/projectors/web-realtime.ts (read only: a DeliverFn that ignores the new field)
  - packages/db/src/zalo-bot-api.ts (read only: timeoutMs to AbortSignal.timeout :74, :129)
  - packages/db/migrations/0022_job_claim_lease_core.sql (read only: the lease set once :380)
  - packages/db/migrations/0071_zalo_dm_promotion_start_definer.sql (read only: seconds to start :42, the live claim :51)
  - docs/standards/decisions.md (read only: DD-146 :2026-2056)
  - docs/sessions/web-mvp-phase4-plan.md (read only: section 3 row L44 :60, the authority)
SLICE: p4-zalo-dm-deadline-and-clock
IN_SCOPE: the DD-146 bound reaches zalo_dm deliver() as an optional relative job field set at the one dispatcher call site; no send starts or runs past it (the early check, the re-measure before each send, the clamped timeoutMs); the retry outcome delivery_deadline_reached; the attempt budget and the deadline on a monotonic clock (default performance.now, injectable); tests (a)-(e) in the three existing test files; the two backlog rows closed by hand
OUT_OF_SCOPE: the 60-minute bound and its JSON; the 120 s budget; the retry schedule; the claim lease; the registry and the CLI that enables the projector; the dispatcher's wall clock; any table, column, migration, env var or dependency; another projector's behaviour; a DeliverFn signature change; the decrypt calls and the decrypt audit; PR #50
G1_DECISION: PASS
G2_SPEC: PASS
G3_DEPENDENCY: PASS
G4_TEST: PASS
G5_SCOPE: PASS
G6_EXTERNAL: PASS
HARD_DEPENDENCIES: none
PRIOR_SLICES: L31 (DD-146, PR #108)
OPEN_QUESTIONS_IN_SCOPE: 0
ENABLEMENT_ONLY_GATES: none
LIVE_REPO_VERIFICATION: PASS
CONTRACT_MATRIX: PASS
CLOSURE_MATRIX: PASS
ACCEPTANCE_MATRIX: PASS
SECURITY_AND_MIGRATION_GATE: PASS # no migration; no security round (no auth, secret, money or permission surface), void if the diff touches the decrypt calls, the decrypt audit or the claim lease
IMPLEMENTATION_ARTIFACTS: PASS
FIRST_IMPLEMENTATION_STEP: W1 - GitNexus impact first, then in apps/bot/src/dispatcher.ts the optional job field deliveryDeadlineMs, the helper zaloDmDeliveryDeadlineMs and the call site, and in apps/bot/src/projectors/zalo-dm.ts monotonicNowMs as the default now, the early check before the targets read and the re-measured clamp before each send; commit in the worktree
REMAINING_BLOCKERS: none
```
