<!-- review-readiness: code-ready -->

# Step-0 readiness: L31 p3-zalo-dm-delivery-age-expiry (session P3-S16h)

> Agent-facing. Readiness reviewers: opus/high (lane block L31), split by area: S0a (bot delivery flow and tests), S0b (DB state machine, records, ACL), S0c
> (the bound, its single definition, the CLI tests), S0d (dispatcher mechanics, DLQ replay, adversarial cases); S0e composed sections 1-10 from their notes and
> the orchestrator's design; S0f writes the closure matrix and the verdict and runs the validator. Writers: opus/max (dispatcher, CLI, tests), sonnet/high
> (runbook, DD text). Code reviewer opus/max plus a separate opus/max security round (external DMs, delivery policy). RISK: P1.
> Lane contract: lane block L31 of the conductor-authored P3-S16h brief (not on main). Base `acdd8612b0e0c4b92023b77555dd9b637c277936` (merge of PR #105; the L24
> merge `adda1e0` (PR #102) and the merge `e7322c1` (PR #103, `chore/p3-deps-osv-next-and-fixable`) are ancestors: measured); branch
> `feat/p3-zalo-dm-delivery-age-expiry`; worktree `.autopilot/worktrees/p3-zalo-dm-delivery-age-expiry`, clean at step 0 (measured: HEAD = base,
> `git status --porcelain` empty, no `index.lock`).
> Every `path:line` below is MEASURED at the base, by the step-0 reviewers (notes outside the repo, `status/P3-S16h-notes`: `s0a-bot-findings.md`,
> `s0b-db-findings.md`, `s0c-bound-findings.md`, `s0d-dispatcher-replay-findings.md`, and the orchestrator's `design-decision.md` v2) or re-read by the composer.
> `0022:443` means line 443 of `packages/db/migrations/0022_*.sql`; bare bot names (`dispatcher.ts`, `worker.ts`, `projector-registry.ts`, `outbox-wake.ts`) are
> under `apps/bot/src/`, `zalo-dm.ts` under `apps/bot/src/projectors/`; CLI = `scripts/outbox-projector-enable.mjs`; replay script =
> `scripts/outbox-dlq-replay.mjs`; DT = `apps/bot/src/dispatcher.test.ts`; RT = `apps/bot/src/projector-registry.test.ts`.

## 1. Authority and base

- Conductor decision D5 (recorded in `status/P3-S16-conductor-decisions.md`), taken under the owner's standing delegation of 2026-10-22, the owner's words
  verbatim:

  > chọn các option mang lại lợi ích long term và tối đa cho pj

  It is a conductor decision, never an owner signature: the owner can reverse it. Every choice below is a Tier-B default, "default applied, pending owner
  sign-off", repeated in the PR body with its rejected alternatives (conductor note A1).
- Lane block L31 (conductor-authored, P3-S16h brief) is the lane contract: GOAL, NEGATIVE SCOPE, THREAT MODEL, DEFAULTS, DECISION TABLE, TESTS, ACCEPTANCE
  COMMANDS, REVIEW PLAN, STOP. It closes the two points lane L24 (PR #102) left open: (a) a delivery-time age check for `zalo_dm`; (b) rows prepared before a
  rollback disable resume at any age after a re-enable (DD-134 as it stands).
- It does not touch the owner's decision behind L24 (`OWNER-DECISIONS-2026-10-22.md` item 1: no event lost for a projector enabled later); it adds the opposite
  protection, no stale user-facing DM. The L24 enable CLI, its backfill and its records stay; only the `zalo_dm` bound it reads changes (8.4 DF6).
- Decision record: ONE new entry DD-146 (conductor note A5; lane L29 takes DD-147). DD-146 is free at the base (measured: no `DD-146`..`DD-149` in
  `docs/standards/decisions.md`; the newest entry is DD-145, heading `:1760`, summary row `:120`). DD-134 (heading `:2902`, summary row `:131`) and DD-141
  (heading `:1966`) bind this lane; DD-134's values stay byte-identical (9.1 states the delta).
- The design is the orchestrator's (`design-decision.md` v2, P3-S16h run 1; it wins over the findings where they differ); this file restates it and does not
  re-decide it. Review per the S1 REVIEW rule (DD-122 D4, owner 2026-10-12): reviewers that did not write the code, at most 3 rounds (9.4).
- Dependencies: L24 merged (hard; measured: `adda1e0` is an ancestor of the base). L29 (P3-S16g) may run beside with disjoint files (names and definers). This
  lane needs no migration (section 4), so no slot is requested.

## 2. The lead, re-verified (Q1)

The conductor lead and Q1, claim by claim. "holds" = same fact, same lines; "drift" = same fact, other lines; "stale" = the cited place says something else.

| # | Lane block claim (cite) | At the base (measured) | Status |
|---|---|---|---|
| 1 | Delivery states (`0022:263-264`, `0025:142`) | CHECK values `pending`, `claimed`, `delivered`, `failed`, `dlq` at `0022:263-264`, renamed `projector_status_chk` at `0025:142`, mirror `schema.ts:1594`. pending = prepared, claimable; claimed = token plus a 5-minute lease (`0022:380`); delivered = terminal; failed = retry, claimable once `next_attempt_at <= clock_timestamp()` (`0022:373`); dlq = terminal, never claimed, listed by `outbox_dlq_list`, re-pended only by an owner replay. No other terminal value. | holds |
| 2 | DD-134 values (`dispatcher.ts:16-17`, `:21-23`) | `MAX_DELIVERY_ATTEMPTS = 8` `:16`, `RETRY_BASE_MS = 15_000` `:17`, `ATTEMPTS_EXHAUSTED` `:18`, `retryDelayMs` = `RETRY_BASE_MS * 2 ** attempts` `:21-23`; doc comment `:11-15` ("15, 30, 60, 120, 240, 480, 960 s, seven waits, 1905 s in all"). | holds |
| 3 | DD-134 matrix (`dispatcher.ts:457-465`, `:457-472`) | `completionArgs` retry case `:454-473`: attempts not an integer, negative or `>= MAX_DELIVERY_ATTEMPTS - 1` -> dlq `attempts_exhausted` `:457-465`, else retry at `now() + retryDelayMs(attempts)` `:466-472`; `now` is the worker-clock option `:64-65`, re-checked by the DB against `clock_timestamp()` (`0022:430`). | holds |
| 4 | Claim and `deliver()` (`dispatcher.ts:240-256`) | claim `SELECT * FROM claim_projector_delivery_batch($1, 1)` `:230-233`; `if (!row) break` `:235`; envelope `claimedEvent()` `:240` (`outbox_claimed_event`, `0056:187-206`; no row = lease lost, projector disabled or unrouted: `leaseLostSkips`, break, no `deliver()`, `:241-244`); job build `:245-252`; `let outcome` `:254`; `deliver(job)` `:256` inside the try `:255-269` (a throw -> dlq `deliver_threw`, `:268`); `completionArgs` `:271`; `complete_projector_delivery` `:285-297` (SQLSTATE 22023 -> dlq `malformed_outcome` `:298-317`; false = stale token or lease: `staleCompletionSkips`, break, `:324-343`). `deliver()` has ONE call site, `:256`. | holds |
| 5 | Event time (implied by the lead) | the claim returns `(event_id, tenant_id, projector, claim_token, attempts)` only (`0022:322-323`): no event time; `outbox_claimed_event` returns `o.created_at` (`0056:189`, `:194`) as `job.event.createdAt` (`projector-registry.ts:20`, `:80`); `outbox_events.created_at timestamptz NOT NULL DEFAULT now()` (`0005:30`); no DB "now" reaches the bot today. | holds |
| 6 | Targets-definer refusal (`0057:116-126`) | inside `deliver()`, `zalo_dm_delivery_targets` (`zalo-dm.ts:133-149`; definer `0057:70-194`) returns disposition `stale` when the session is missing, has ended (`ends_at <= clock_timestamp()`) or is not in the status the event implies (`0057:117-126`, the return at `:121-125`); `zalo-dm.ts:40-46` maps it to `delivered("noop_stale")` (`:41`): status delivered, attempts +1 (`0022:444`), audit `projector_delivery_delivered`, never retried, so not one of the 8. It cannot see a seat or fee change inside a session that is still open. | holds |
| 7 | Stale DM content (`zalo-dm.ts:113-116`) | the payload carries `amount_due` at `zalo-dm.ts:112-113` (S0a, S0d). | drift (one line) |
| 8 | Live path "about 39 minutes" (runbook `:71-72`) | `:71` is the raw-path paragraph; the "about 39 minutes" sentence is at `:87-88` and counts backoff plus pickup delay only (1905 s + 7 x 60 s); the "about 70 vs about 39" pair appears only in the CLI comment `:56-58`. The measured worst case is 3225 s (section 3). | stale |
| 9 | Backoff `15 s x 127 = 1905 s` | `dispatcher.ts:12-14`. | holds |
| 10 | Enable CLI bound `BACKFILL_MAX_AGE_MINUTES` (30) | exported at `CLI:61` (doc `:56-58`); uses `:141` (step-1 refusal), `:146` (refusal text), `:161` (candidates); no per-projector bound; the only projector branch is `:196` (`public_sessions` rebuild). | holds |
| 11 | DD-134 rollback: a disable keeps pending rows, a re-enable resumes them at any age | runbook `:78`; `outbox_projector_set_enabled` only flips the flag (`0056:157-180`); the CLI skips every event that already has a delivery row (`CLI:106`), so it never sees a resumed row. The runbook already names L31 as the follow-up (`:61`, `:78`). | holds |
| 12 | Q1: an outcome an expiry can reuse without a migration and without a failed attempt | every completion branch increments `attempts` (`0022:444`, `:454`, `:464`) and only `job_definer` has DML on `projector_deliveries` (`0022:539`), so no existing call ends a row with attempts unchanged. `delivered` with a `noop_*` provider_ref (precedent `noop_stale`, `zalo-dm.ts:41`; `provider_ref` has no CHECK, `0005:46`; the dispatcher accepts any NUL-free string, `dispatcher.ts:443-444`) is terminal, never claimed again (`0022:369-377`), outside the DLQ (`0056:232`) and never reaches the retry matrix: the +1 lands on a row that can never be retried, so it is not a failed attempt of the 8. `dlq` with `delivery_expired` also passes the code regex (`0022:434`) but is a DLQ row (rejected, 4.1). | reuse found |
| 13 | DD-134 and DD-141 homes in `decisions.md` | DD-134 heading `:2902` (L24's readiness cited `:2716-2739` at its own base), summary row `:131`; DD-141 heading `:1966`. | drift |

## 3. The bound: measurement and choice (Q2)

Live-path worst case at the 8th check before `deliver()` (where the 4.2 check runs): worker up, no backlog, every attempt at its budget, every due retry
picked up 60 s late (S0c Q2b).

| Term | Value | Source |
|---|---|---|
| First claim: NOTIFY wake, else the 1-minute cron | <= 60 s | `worker.ts:87`, `:162`; cron `* * * * *` at `queues.ts:47`, registered at `worker.ts:111` |
| Seven attempt budgets before the 8th check | 7 x 120 s = 840 s | `zalo-dm.ts:29` `ATTEMPT_BUDGET_MS = 120_000` ("below the 5 min claim lease"; send timeout 5 s, `:30`) |
| DD-134 backoff, attempts 0..6 | 15 + 30 + 60 + 120 + 240 + 480 + 960 = 1905 s | `dispatcher.ts:12-17`, `:21-23`, `:467` |
| Seven due-retry pickups (wake or tick) | 7 x 60 s = 420 s | runbook `:87-88` |
| Total at the 8th check | 3225 s = 53.75 min (the 8th send ends by 3345 s) | sum |
| Typical (5 s sends) | about 2420 s, about 40 min | S0c |

- Choice: **60 minutes = 3600 s**, on `outbox_events.created_at`, measured with the DB clock: 375 s (6.25 min, about 12 %) above the measured worst case, so
  the live path with the worker up behaves exactly as today. Edge: expire only on strict `age > bound`, the CLI's own edge (`CLI:99` cutoff
  `clock_timestamp() - make_interval(mins => $2)`, `CLI:103` `in_window = o.created_at >= cutoff`: an event of exactly the bound's age is prepared; the step-1
  refusal counts `created_at < cutoff`, `CLI:88`).
- Abnormal conditions. Threat 5 covers DD-134's retry stretch with the worker up; a DM pushed past the bound by the cases below is the stale message threat 1
  targets, so it expires with a record (fail closed). A worker death mid-attempt costs up to the 5-minute lease plus a 60 s tick and no attempt (`0022:380`;
  the claim never increments attempts): one death = 3585 s (15 s spare); two = 3945 s (expired); a backlog over `DEFAULT_BATCH_LIMIT = 25` rows per projector
  per cycle (`dispatcher.ts:9`, `:224-228`) adds whole cycles; a worker outage longer than the bound expires the DMs of the events produced during it at their
  first claim. Rejected values: 45 (below the live worst case), 65 or 70 (later DMs allowed for rare crash cases), 30 (L24's CLI default, below the live worst
  case).
- The CLI today: `BACKFILL_MAX_AGE_MINUTES = 30` (`CLI:61`), one value for every projector (`:141`, `:146`, `:161`). Under the design the CLI reads the shared
  60 for `zalo_dm` only (8.4 DF6), so each projector has one bound.
- One definition (S0c Q2c): the scripts load only npm packages, through `createRequire` (`CLI:259`, `outbox-dlq-replay.mjs:21`); no script imports workspace
  code; `@plexco/db` exports TS source (`packages/db/package.json:6-17`); at the Node floor `^22.13.0 || >=24` (`package.json:6`) a plain `.mjs` cannot import
  `.ts`; the bot is `"type": "module"` (`apps/bot/package.json:5`) under `module` and `moduleResolution` `NodeNext` with `resolveJsonModule: true`
  (`tsconfig.base.json:5-6`, `:14`), TypeScript `^5.7.3`. The one form both sides load is a JSON data file:
  - `apps/bot/src/zalo-dm-delivery-age-bound.json` = `{ "maxAgeMinutes": 60 }` (new, next to its runtime user);
  - `dispatcher.ts`: `import zaloDmDeliveryAgeBound from "./zalo-dm-delivery-age-bound.json" with { type: "json" };` (NodeNext ESM requires the attribute),
    validated at load (a positive integer, else throw: fail closed) and exported as `ZALO_DM_MAX_AGE_MINUTES`;
  - CLI: `createRequire(import.meta.url)("../apps/bot/src/zalo-dm-delivery-age-bound.json").maxAgeMinutes`, the same validation, exported as
    `ZALO_DM_MAX_AGE_MINUTES`;
  - the drift test DA-10 (7.2) fails if the two exports differ and pins `ZALO_DM_MAX_AGE_MINUTES x 60 > 60 + 7 x 120 + 1905 + 7 x 60`, computed from the
    exported `MAX_DELIVERY_ATTEMPTS` and `RETRY_BASE_MS` (the 120 s attempt budget is a literal with a comment citing `zalo-dm.ts:29`, a file this lane does not
    own).
  Versions measured (`tsx ^4.19.2`, `prettier ^3.4.2`, `typescript-eslint ^8.20.0`); their parse support of the import attribute is proven by U1's typecheck,
  lint and format run, not assumed.

## 4. Candidate designs and the choice (Q3)

### 4.1 Candidates

| Candidate | Mechanism | Paths covered | Cost | Migration | Verdict |
|---|---|---|---|---|---|
| **A** delivery-time check | for `zalo_dm` rows only, between the job build (`dispatcher.ts:252`) and `let outcome` (`:254`): age on the DB clock, a row past the bound ends `delivered` with `noop_expired` | all six: every path passes claim `:230`, envelope `:240`, `deliver()` `:256` | about 45-70 non-test lines in `dispatcher.ts`, the 3-line JSON, 15-30 in the CLI (the bound branch), one JRD-5 allow-list entry, tests in DT and RT (8.3) | none: reuses the delivered branch of `complete_projector_delivery` (`0022:443-451`); the age literal reads no table | **chosen** |
| **B** expiry at the CLI enable or resume step | the CLI expires stale rows when it enables | CLI runs only: misses the live retry stretch, a raw `outbox_projector_set_enabled(name, true)` (`0056:157-180`), rows resumed after a rollback and DLQ replays; the CLI skips events that already have a delivery row (`CLI:106`), so resumed rows are outside its scan today | a new owner-seat write that ends existing delivery rows, and still no cover for the paths above | none for the scan; ending existing rows would be a second write path on the shared state machine | rejected: incomplete coverage (fail-closed) |
| **C** A plus a CLI expiry at enable | A, and the CLI also expires backfill rows at enable | as A; it only expires backfill rows earlier (fewer claims) | A plus a second expiry path for one rule | none | rejected: no extra coverage; one source of truth; fewer concepts |
| **M** migration | a new `expired` value in `projector_status_chk` (and `schema.ts:1594`), a `job_definer` SECURITY DEFINER (for example `expire_projector_delivery(event, projector, token, p_max_age_seconds)`) computing the age in SQL with attempts unchanged, an audit row carrying age and bound | as A | a CHECK change and a SECURITY DEFINER on the shared state machine, a migration slot behind L29, two homes for "not sent" outcomes (`noop_*` and `expired`) | yes (slot request, AWAIT) | rejected: the lane block allows a migration only if no migration-free design records the expiry, and A does |
| **dlq variant** | `complete_projector_delivery(..., 'dlq', NULL, NULL, 'delivery_expired')` (passes `0022:434`) | as A | puts non-failures in the owner's DLQ (`outbox_dlq_list`, `0056:232`) and changes its meaning; a replay re-pends with attempts 0 (`0056:265`) and the check sends it back to dlq (a loop); +1 attempt on a failure-shaped outcome | none | rejected |

S0b's "MIGRATION NEEDED: YES" follows from the strict reading "attempts unchanged and a durable age-and-bound record written by `app_worker`". The design takes
the lane GOAL's words ("never counted as a failed attempt of the 8", "recorded") and meets them without a migration (5.1); the residual is R4 in section 10.

### 4.2 Chosen design A (`design-decision.md` D1), mechanics

1. Guard: `job.projector === "zalo_dm"`; `web_realtime` and `public_sessions` rows never reach the check.
2. Place: after the job build (`dispatcher.ts:245-252`), before `let outcome` and OUTSIDE the `deliver()` try (`:255-269`): inside it a DB error would become
   dlq `deliver_threw` (`:268`), a non-failure in the owner's DLQ.
3. Unreadable time, checked in JS BEFORE any SQL: `job.event.createdAt instanceof Date && Number.isFinite(job.event.createdAt.getTime())`, else expire with age
   "unreadable" (an Invalid Date sent as `$1` makes the query throw, which would abort every cycle at every lease and never end the row: S0d Q8). Defensive:
   the column is `NOT NULL DEFAULT now()` (`0005:30`).
4. Age on the DATABASE clock, ONE literal kept in `dispatcher.ts` (JRD-5 scans that file):
   `SELECT date_part('epoch', clock_timestamp() - $1::timestamptz) AS age_s`, with `$1` = `job.event.createdAt` (read from the DB by `outbox_claimed_event`);
   never `Date.now()` or `options.now`. `date_part` returns double precision, which node-pg returns as a JS number; the reading goes through `Number()` and a
   non-finite value expires as "unreadable". Not the bare interval `clock_timestamp() - $1::timestamptz`: node-pg parses an interval into an object (no
   `setTypeParser` in `apps/bot/src` or `packages/db/src`: measured), `Number()` of that object is NaN, and every DM would expire. Not `EXTRACT`: it returns
   numeric on PostgreSQL 14 and later, a string in node-pg (the repo runs `postgres:16-alpine`, `infra/docker-compose.yml:11`).
5. Rule: expire iff `ageSeconds > ZALO_DM_MAX_AGE_MINUTES x 60` (strict).
6. Expired: `outcome = { result: "delivered", providerRef: "noop_expired" }`; `deliver()` is not called (no targets read, no secret decrypt, no recipient
   write). From `:271` on everything is reused: the delivered branch of `completionArgs` (`:442-453`), the one `complete` call (`:285-297`), its 22023
   containment (`:298-317`) and the true or stale handling (`:324-343`). No second completion path, no new summary counter.
7. Record: after the completion returns true, ONE `console.warn` line in the dispatcher's existing `[dispatcher] ... (event <id>, projector <p>)` form
   (`:273-275`, `:281-283`, `:307-309`), for example `[dispatcher] delivery expired: age 3725s > bound 3600s (event <id>, projector zalo_dm)`. Fields: event id,
   projector, age in seconds or "unreadable", bound in seconds; never payload, tenant, recipient, amount or message text. A stale completion (false) logs
   nothing; the row is re-checked at its reclaim.
8. DB clock query fails: the error propagates; the cycle aborts like every other phase-2 infra error today (claim `:230`, envelope `:240`, a non-22023
   completion error `:306`), and the runner logs `[worker] dispatch cycle failed: <error>` (`outbox-wake.ts:57-62`). The row stays claimed with attempts
   unchanged; the claim after its 5-minute lease (`0022:345-363`, `:380`) re-checks it. Projectors run sorted (`dispatcher.ts:174`), `zalo_dm` last, so an
   abort skips only the remaining `zalo_dm` rows of that cycle.
9. Residuals, stated, no fix: `deliver()` runs after the check (at most the 120 s attempt budget, far below the bound); precision errs toward expiry (a JS Date
   keeps the milliseconds of a microsecond column; `created_at` is `now()` at the start of the producing transaction).
10. Unchanged: `worker.ts` (exact `"true"` `:32`, probe gate `:59-75`, runner `:160`), the enabled-set check (`dispatcher.ts:223`), the DD-134 block
    (`:11-23`) and `completionArgs` (`:418-490`).

### 4.3 Deciding tie-breaks (level3 §6.1 order)

1. Fail-closed: A is the only candidate that covers every path; an unreadable time expires; a failed clock read never delivers.
2. One source of truth: one bound in one JSON file read by both users; one completion call; the one `deliver()` call site guarded.
3. Fewer concepts: no new status, definer, outcome type or counter; `noop_expired` joins the `noop_*` family (`zalo-dm.ts:41-43`, `:101`).
4. Precedent: `delivered("noop_stale")` for an ended or changed session; JRD-5's exact-literal entry for `pg_notify` (DT `:197-198`).
5. Reversible: no migration; the value is one JSON edit; deleting the check block restores today's behavior.

10x test: a second user-facing projector reuses the predicate with its own key in the same JSON file (not built now).

## 5. The recorded outcome and the DLQ replay rule

### 5.1 The recorded outcome: record shape, role and ACL (Q4)

- Writer: the dispatcher runs as `app_worker` and ends the row through `complete_projector_delivery` (SECURITY DEFINER, owner `job_definer`, EXECUTE
  `app_worker`: `0022:405-484`, `:500`, `:530`), delivered branch: status `delivered`, attempts +1, `delivered_at = now()` (DB clock), `provider_ref =
  'noop_expired'`, `error_code` NULL (`0022:443-451`, `:445`). The definer appends one `job_audit_events` row, reason `projector_delivery_delivered`, actor
  `system` (`0022:474-481`). No new grant, definer, role or table write: only `job_definer` has DML on `projector_deliveries` (`0022:539`); `job_audit_events`
  is append-only (trigger `0022:146-157`), owned by `job_definer` (`0022:502`), with no runtime-role grant; `app_worker` cannot write a caller-chosen audit
  reason (S0b Q4).
- The row afterwards: terminal; never claimed again (the claim takes `pending` or a due `failed` row, `0022:369-377`); not in `outbox_dlq_list` (`status =
  'dlq'` only, `0056:232`); a replay is refused (5.2). No `dlq` row is created.
- Age: `delivered_at - outbox_events.created_at`, both on the DB clock. Bound: in the warning line and in the versioned JSON file (git history).
- What the owner sees (owner seat: `DATABASE_URL_MIGRATION` plus `SET ROLE job_definer`, the runbook's `$OWNER_SQL`): delivery-time expiries are
  `projector_deliveries` rows with `projector = 'zalo_dm' AND provider_ref = 'noop_expired'` (joined to `outbox_events` for the age); CLI-time expiries are
  `job_audit_events` rows with `starts_with(reason, 'projector_delivery_expired:')` (L24: `CLI:19`, `:66`, `:175-177`, `:186-190`; runbook `:65-68`); plus the
  warning lines in the worker log. The runbook gives both queries (design D6).
- No leak: the row and the line carry ids, the projector name and integers only; never the payload (`amount_due`, `zalo-dm.ts:112-113`), a recipient, a
  display name, the tenant or message text.
- Label caveat, accepted (precedent `noop_stale`): the audit reason of an expiry reads `projector_delivery_delivered`; `provider_ref` tells it apart.

### 5.2 The DLQ replay rule (Q5)

- Measured: `outbox_dlq_replay` (`0056:243-273`, SECURITY DEFINER, owner-only: REVOKE PUBLIC `:274`, zero grantees pinned at
  `packages/db/src/outbox-projector-registry.test.ts:357`) locks the row (`:253-255`), raises `delivery_not_found` (`:256-260`) or, for any status but `dlq`,
  `delivery_not_in_dlq` (`:261-264`), then sets `status = 'pending', attempts = 0, next_attempt_at = NULL` (`:265-266`) and appends one audit row
  `projector_delivery_replayed`, actor `owner` (`:268-270`); it never touches `outbox_events.created_at`. The replay script: owner credential only (`:9`;
  missing: exit 1, `:96-99`), `SET ROLE job_definer` (`:104`, `:108`), exit 0 when done (`:110`), exit 2 for argument errors (`:92-94`) and for
  `delivery_not_found` or `delivery_not_in_dlq` (`:28`, `:113-115`), exit 1 otherwise (`:117-118`); it reads no age and no payload.
- Rule (design D4, default DF4): no script or function change. A replayed row is a plain pending row, claimed by the same claim (`dispatcher.ts:230-231`) and
  read by the same envelope (`:240`), so the 4.2 check sees it: past the bound it expires with a record at its next claim and is never re-sent; inside, it is
  delivered as today. An expired row is `delivered`, so a replay of it is refused with `delivery_not_in_dlq`, exit 2. No owner-override concept is needed.

## 6. Threat model and decision table

### 6.1 Threat model (lane block items 1-6; stated in U1's code comment and the PR body)

| # | Threat | Mechanism | Proven by |
|---|---|---|---|
| 1 | A stale `zalo_dm` message (a person told "you hold a seat, fee X" long after it stopped being true) | the 4.2 check before `deliver()` for every `zalo_dm` row: DB-clock age, strict `> 60 min` ends the row as `noop_expired` without a send, a targets read or a recipient write. The targets definer's `stale` refusal stays (`0057:117-126`) but checks only existence, end time and status, not a seat or fee change inside an open session: the age check is the guard for that case. | DA-4..DA-7 (stub never called); BS-3 as edited (never sent) |
| 2 | Bypasses: a raw re-enable that skips the CLI, a rollback-resumed row, a DLQ replay | every path reaches `deliver()` only through claim `:230`, envelope `:240` and the single call site `:256`; the check sits between `:252` and `:254`, so no path skips it (S0d Q8: no hole found) | DA-4 (backfilled), DA-5 (CLI re-enable), DA-6 (raw re-enable), DA-7 (DLQ replay) |
| 3 | Clock error | the age is `date_part('epoch', clock_timestamp() - $1::timestamptz)` with `$1` = `created_at` read from the DB envelope; never `Date.now()` or `options.now` (the worker clock, `dispatcher.ts:64-65`); precision errors err toward expiry (4.2 item 9) | JRD-5 pins the exact literal; DA-1; review area 1 (no worker clock in the check) |
| 4 | A silent drop | every delivery-time expiry leaves a durable row (`delivered`, `noop_expired`, `delivered_at` on the DB clock, age derivable), the definer's audit row and one warning line after a true completion (event id, projector, age or "unreadable", bound); every CLI-time expiry keeps L24's `projector_delivery_expired:zalo_dm:age` or `:cap` record; the runbook gives both queries; a failed clock read leaves the row claimed for a re-check, never ended unrecorded | DA-4..DA-7 assert the row and one warning line; BS-3 asserts one record; DA-8 |
| 5 | The opposite error: dropping a legitimate live retry | 3600 s > the measured live worst case 3225 s at the 8th check (375 s margin, worker up, no backlog); at the bound a row is delivered (strict `>`); DD-134 values untouched. Residual: one worker death leaves 15 s; two deaths or a backlog over 25 rows per cycle can push a retry past the bound, which then expires with a record (accepted: such a DM is the stale message of threat 1) | DA-10 (the worst-case pin); DA-1 (at the bound); DA-3 (45 minutes delivered); A23, JRD-7..JRD-9 unchanged |
| 6 | A second definition of the bound drifting from the first | ONE JSON file read by both users, each validating a positive integer at load (fail closed); the CLI's other projectors keep `BACKFILL_MAX_AGE_MINUTES` | DA-10 (CLI export equals dispatcher export; 30 kept for the others); EN-1 (`packages/db/src/outbox-projector-enable.test.ts:235`) unchanged |

### 6.2 Decision table

Rows = path; columns = the event's age at the delivery-time check (bound = 3600 s, DB clock). DELIVERED = `deliver()` runs and the row ends on today's
DD-134 path; EXPIRED-WITH-RECORD = no send, the row ends `delivered` with `noop_expired` plus one warning line (or, where stated, the CLI's age record);
REFUSED = the request is rejected with an error; NOT DELIVERED = no send and no terminal state, the row waits for a re-check.

| Path | Inside the bound (age < 3600 s) | At the bound (age = 3600 s) | Past the bound (age > 3600 s) | Event time unreadable |
|---|---|---|---|---|
| P1 live first attempt | DELIVERED (as today) | DELIVERED (strict `>`; pinned by DA-1) | EXPIRED-WITH-RECORD (reachable only after a worker outage or backlog longer than the bound) | EXPIRED-WITH-RECORD (age "unreadable"; JS check before any SQL) |
| P2 live retry n (n = 1..7) | DELIVERED (retry scheduled as today, `dispatcher.ts:466-472`) | DELIVERED | EXPIRED-WITH-RECORD (not reachable with the worker up and no backlog: worst case 3225 s; reachable after two worker deaths or a backlog) | EXPIRED-WITH-RECORD |
| P3 backfilled by the enable CLI | DELIVERED (prepared in window, `CLI:103`, then delivered) | DELIVERED (the CLI prepares at the bound and the dispatcher delivers at the bound) | EXPIRED-WITH-RECORD in one of two forms: past the bound at the CLI run, never prepared, one CLI record `projector_delivery_expired:zalo_dm:age` (L24, with the shared bound); prepared inside and past at claim, `noop_expired` plus the warning | EXPIRED-WITH-RECORD (at delivery; the CLI's SQL never sees an unreadable time: the column is NOT NULL) |
| P4 resumed after a CLI re-enable | DELIVERED (resumes as today) | DELIVERED | EXPIRED-WITH-RECORD (at delivery; the CLI adds nothing for an event that has a row, `CLI:106`): the DD-134 delta | EXPIRED-WITH-RECORD |
| P5 resumed after a raw re-enable | DELIVERED (resumes as today) | DELIVERED | EXPIRED-WITH-RECORD (the raw function only flips the flag, `0056:157-180`): the DD-134 delta | EXPIRED-WITH-RECORD |
| P6 DLQ replay of a dlq row | DELIVERED (re-pended with attempts 0, then delivered as today) | DELIVERED | EXPIRED-WITH-RECORD at the next claim (the replay leaves `created_at` as it was, `0056:265-266`): never re-sent | EXPIRED-WITH-RECORD |
| P6b DLQ replay of an already-expired row | REFUSED: `delivery_not_in_dlq`, exit 2 (status `delivered`, `0056:261-264`; replay script `:113-115`) | REFUSED (as inside) | REFUSED (as inside) | REFUSED (as inside: the function refuses any status but `dlq`, whatever the age) |
| X the DB clock query fails (any path) | NOT DELIVERED: the cycle aborts like any phase-2 infra error, logged `[worker] dispatch cycle failed` (`outbox-wake.ts:57-62`); the row stays claimed, attempts unchanged, reclaimed after the 5-minute lease (`0022:345-363`) and re-checked | NOT DELIVERED (as inside) | NOT DELIVERED (as inside) | EXPIRED-WITH-RECORD: the JS check expires it before any SQL, so no clock query runs |

32 cells: 12 DELIVERED, 13 EXPIRED-WITH-RECORD, 4 REFUSED, 3 NOT DELIVERED (each NOT DELIVERED row is re-checked at its next claim, never ended without a
record). No cell is silently dropped; "event time unreadable" fails closed on every path. `web_realtime` and `public_sessions` rows are not checked
(unchanged). The at-bound column cannot be reproduced against `clock_timestamp()` in a DB test, so DA-1 pins it on literal numbers with the CLI's operator.

## 7. Tests (Q6, design D5)

### 7.1 Existing tests whose outcome changes (exact new outcomes)

- **JRD-5** (DT `:196`; allow-list `:197-198`; scan `:184-225`): today PASS; with the new literal it FAILS (the literal matches none of the allowed forms); new
  outcome PASS after ONE exact anchored alternative in the `pg_notify` form:
  `^SELECT date_part\('epoch', clock_timestamp\(\) - \$1::timestamptz\) AS age_s$`. The literal stays in `dispatcher.ts`: a helper in an unscanned file would
  escape the pin.
- **BS-3** (RT `:518-546`): today a `zalo_dm` event back-dated 40 minutes (`backdate`, RT `:354-359`, the literal at `:357`) gets no delivery row (`:540`), one
  `projector_delivery_expired:zalo_dm:age` record (`:541-543`), and the stub sees only the two in-bound DMs (`:531-533`). Under the 60-minute `zalo_dm` CLI bound
  that event would be prepared and DELIVERED (three DMs, no record). New outcome: the test back-dates that event to `ZALO_DM_MAX_AGE_MINUTES + 1` minutes
  (derived from the shared constant) and every assertion stays as today (never sent, no row, one age record, two DMs, the two rows `delivered` with attempts 1,
  `:537`). The `backdate` helper takes the minutes; its other users (`:499`, `:608`: events back-dated 40 minutes, past the 30-minute bound of the other
  projectors) keep 40 and their outcomes.
- No other existing test changes outcome: DT never uses `zalo_dm` (`TEST_PROJECTOR`, DT `:28`), and every other `zalo_dm` delivery in RT is fresh (BS-5) (S0a,
  S0c).

### 7.2 New tests (extend DT and RT; do not scatter)

| ID | File (unit) | Case | Expected |
|---|---|---|---|
| DA-1 | DT (U3) | the pure parts of the check, exported by U1 (the Date readability test and the age-versus-bound comparison): ages 3599, 3600, 3600.001; NaN, Infinity, a string; an Invalid Date and a non-Date `createdAt` | 3599 and 3600 deliver; 3600.001 expires; every non-finite reading and every unreadable time expires as "unreadable" with no SQL issued |
| DA-2 | DT (U3) | a `TEST_PROJECTOR` event back-dated past the bound | delivered once (the check is `zalo_dm` only); covers the `web_realtime` and `public_sessions` branch |
| DA-3 | RT (U4) | a `zalo_dm` event aged 45 minutes, acked while off, then the CLI enables | the CLI prepares it (window 60) and the stub gets it once; row `delivered`, attempts 1 (the DF6 delta: L24 expired it) |
| DA-4 | RT (U4) | a row the CLI prepared inside the bound, back-dated past it before the cycle | stub never called; row `delivered`, `provider_ref = 'noop_expired'`, attempts 1; one warning line (console.warn spy) with event id, projector, age and bound and no payload field |
| DA-5 | RT (U4) | a `zalo_dm` row pending at a disable (BS-5 shape, RT `:706`), back-dated past the bound, then a CLI re-enable and a cycle | as DA-4; the CLI adds no row and no record for it |
| DA-6 | RT (U4) | the same with a raw `SELECT outbox_projector_set_enabled('zalo_dm', true)` on the owner seat | as DA-4 |
| DA-7 | RT (U4) | a `zalo_dm` row driven to `dlq` (a dlq-returning deliverer under the `zalo_dm` key), back-dated past the bound, owner replay (exit 0), then a cycle with the real `zalo_dm` deliverer (A9 shape, RT `:231-255`) | `stub.calls` empty; row `delivered`, `noop_expired`, `error_code` null, attempts 1; a second replay exits 2 `delivery_not_in_dlq`; a twin without the back-date is sent once |
| DA-8 | RT (U4) | a pool wrapper that rejects only the age literal | the cycle rejects; `deliver()` never called; the row stays `claimed` with attempts unchanged |
| DA-9 | RT (U4) | `web_realtime` and `public_sessions` unchanged | BS-1, BS-2, BS-4 and BS-7 green and unmodified (with DA-2) |
| DA-10 | RT (U4) | the CLI imported with `// @ts-expect-error` (precedent `packages/db/src/outbox-projector-enable.test.ts:16-17`) | `cli.ZALO_DM_MAX_AGE_MINUTES` equals the dispatcher's `ZALO_DM_MAX_AGE_MINUTES`; `cli.BACKFILL_MAX_AGE_MINUTES` is 30; `ZALO_DM_MAX_AGE_MINUTES x 60 > 60 + 7 x 120 + 1905 + 7 x 60`, computed from `MAX_DELIVERY_ATTEMPTS` and `RETRY_BASE_MS` |

DA-4..DA-8 live in the L24 boot-sequence describe (RT `:299`) and reuse BS-3's helpers (`zaloBoot`, promotions, `backdate`, the CLI, cycles, the stub); the
`deliveries()` helper selects no `provider_ref`, so read it directly. IDs are the composer's; the writers may renumber in their handoff.

### 7.3 Unchanged pins and conventions

- DD-134 matrix and paths: DT `:523` (A23), `:273` (JRD-7), `:301` (JRD-8), `:372` (JRD-9), grammar `:942-1007`.
- A5 and rollback: RT `:180`, `:208` (A4, A5), `:231` (A9), `:257` (D-10, A9-A11), `:706` (BS-5, it.each over the projector names, `zalo_dm` included).
- L24 boot sequence: RT `:299` (describe), BS-1 `:475`, BS-2 `:492`, BS-4 `:577`, cap `:632-637`, BS-7 `:680`.
- packages/db: `outbox-projector-enable.test.ts` (EN-1 pins 30 at `:235`; `zalo_dm` appears only in EN-4, `:296-328`, routing) and
  `outbox-projector-registry.test.ts` (routes and flag `:126`, `:706-724`; A9 SQL `:577-599`; refusals `:618-632`): unchanged, provided the CLI branch is
  "`zalo_dm` -> the shared bound, any other name -> `BACKFILL_MAX_AGE_MINUTES`" (the `en*_test` projectors rely on the default).
- Probe guard and flag: `worker.ts` and its tests are untouched.
- Conventions (S0a Q6): spies are injected as a projector map (DT `:28-29`, `runDispatchCycle(pool, { projectors: only(deliver) })`, for example `:282`,
  `:440`; RT `vi.fn(delivered)` maps `:182`, `:714-715`; the real `zalo_dm` deliverer against `startZaloStub`, RT `:375-393`, `:466`, asserting `zalo.stub.calls`
  `:526-534`). No test fakes the DB clock: rows are moved instead (`created_at`, `next_attempt_at`, `lease_expires_at` relative to `now()`: DT `:344`, `:430`,
  `:548`; RT `:354-359`, `:641-642`). Every DB run goes through the session lock wrapper `status/P3-S16h-notes/scripts/locked-run.sh` (lock
  `status/.db-e2e.lock`), one at a time, shared with L29.

## 8. Scope, budget and pinned defaults

### 8.1 FILE scope

TARGET_FILES (every path exists at the base: measured):

- `apps/bot/src/dispatcher.ts`
- `apps/bot/src/dispatcher.test.ts`
- `apps/bot/src/projector-registry.test.ts`
- `scripts/outbox-projector-enable.mjs`
- `docs/runbooks/outbox-dispatch-enable-rollback.md`
- `docs/standards/decisions.md`

Files this lane creates (not TARGET_FILES): `apps/bot/src/zalo-dm-delivery-age-bound.json` (the lane DEFAULTS item "where the constant lives", design D3; not
under `scripts/`, so no `docs/standards/kit-pack-membership.json` record, common note C10) and this readiness file (the lane branch's first commit).

Out of scope although the lane block names them: `apps/bot/src/projectors/zalo-dm.ts` (allowed only if step 0 proved the check belongs there; step 0 places it
in the dispatcher, at the one `deliver()` call site), `scripts/outbox-dlq-replay.mjs` (5.2: no change), `packages/db/src/outbox-projector-enable.test.ts` and
`packages/db/src/outbox-projector-registry.test.ts` (7.3: unchanged).

### 8.2 Negative scope

- No change to the 8 attempts, the 15 s x 2^(n-1) backoff, the DLQ rule, the owner-only replay, the probe guard (`apps/bot/src/worker.ts`) or the exact-"true"
  flag semantics: `dispatcher.ts:11-23` and `:418-490` are not touched; `worker.ts` is byte-identical.
- No enabling of any projector anywhere: tests enable only inside databases the test itself created; `.env.example` and the committed defaults stay as they are;
  no real deliverer, bot token or production env.
- No change to `web_realtime` or `public_sessions` behavior (the CLI keeps 30 minutes for every name but `zalo_dm`); no change to how events are produced.
- No migration (none is needed; a migration without a slot is a STOP); no edit under `packages/db/migrations`, `packages/db/src` or `apps/bot/src/projectors`.
- No edit of a Reviewed spec; no change to `docs/legal`; PR #50 untouched.
- `docs/standards/decisions.md`: only the DD-146 section, its summary row and the DD-134 cross-reference mark (9.1).
- No new summary counter, no new owner-override concept, no new grant, role or definer.

### 8.3 B3 estimate against the caps

Caps, pre-approved: 300 non-test, 800 test, 1,200 total excluding docs, 10 files, 0 migrations.

| Unit | File | Non-test | Test | Docs | Files |
|---|---|---|---|---|---|
| U1 | `apps/bot/src/zalo-dm-delivery-age-bound.json` (new) | 3 | 0 | 0 | 1 |
| U1 | `apps/bot/src/dispatcher.ts` | 45-70 | 0 | 0 | 1 |
| U2 | `scripts/outbox-projector-enable.mjs` | 15-30 | 0 | 0 | 1 |
| U3 | `apps/bot/src/dispatcher.test.ts` | 0 | 60-120 | 0 | 1 |
| U4 | `apps/bot/src/projector-registry.test.ts` | 0 | 250-420 | 0 | 1 |
| U5 | `docs/runbooks/outbox-dispatch-enable-rollback.md` | 0 | 0 | 15-35 changed | 1 |
| U6 | `docs/standards/decisions.md` | 0 | 0 | 25-45 | 1 |
| step 0 | this file | 0 | 0 | this file | 1 |
| Total | | 63-103 | 310-540 | docs excluded | 8 |

Total excluding docs 373-643 of 1,200; non-test 63-103 of 300; test 310-540 of 800; 8 of 10 files; 0 migrations. No B3 exception needed. Measured before the
PR (`status/P3-S16h-notes/scripts/b3-measure.sh`); a crossed cap is a ruling request before the next writer starts.

### 8.4 Pinned defaults

Tiers per level3 §6.1. DF0-DF7 are Tier B: each is "default applied, pending owner sign-off" here and in the PR body, with its rejected alternatives. Tier A
(derived, no sign-off): the number DD-146 (conductor-assigned, free at the base), the export name `ZALO_DM_MAX_AGE_MINUTES` in both modules (pinned so the
units agree), the age literal and its JRD-5 entry, the test IDs.

- **DF0** design: A, a delivery-time check before `deliver()` for `zalo_dm` only, no migration (4.2). Rejected: B (incomplete coverage), C (a second expiry
  path, no extra coverage), M (a CHECK change, a SECURITY DEFINER on the shared state machine, a slot), the dlq variant (non-failures in the DLQ, a replay loop)
  (4.1). Default applied, pending owner sign-off.
- **DF1** the bound value: 60 minutes (3600 s) on `outbox_events.created_at`, DB clock, expire on strict `age > bound` (section 3). Rejected: 45 (below the
  measured live worst case, 53.75 min), 65 or 70 (later DMs allowed for rare crash cases), 30 (below the live worst case). Default applied, pending owner
  sign-off.
- **DF2** where the constant lives: ONE JSON file `apps/bot/src/zalo-dm-delivery-age-bound.json` = `{ "maxAgeMinutes": 60 }`, loaded by `dispatcher.ts` (import
  attribute) and the CLI (`createRequire`), each validating a positive integer at load and exporting `ZALO_DM_MAX_AGE_MINUTES`; drift test DA-10. Rejected: a
  TS constant (the CLI runs on plain Node 22 and cannot import `.ts`), a shared `.mjs` (`@ts-expect-error` in runtime code, or a second `.d.mts`), JSON under
  `packages/db/src` (an `exports` entry outside ownership, or a deep import that bypasses `exports`), a SQL function (a migration), two literals plus a drift
  test (two definitions). Default applied, pending owner sign-off.
- **DF3** the expiry outcome and record shape: `delivered` with `providerRef` `noop_expired` through the one `complete_projector_delivery` call; the record is
  the durable row, the definer's audit row and one warning line after a true completion; no new counter (4.2 items 6-7, 5.1). Rejected: M (a new `expired`
  status, a definer and an audit row with age and bound), the dlq variant (`delivery_expired`), a `retry` outcome (it re-enters the DD-134 matrix and counts as
  a failed attempt, against the GOAL). A `provider_ref` that also carries the bound is rejected by DF7 (the orchestrator's ruling on section 10, R4). Default applied, pending
  owner sign-off.
- **DF4** the DLQ replay rule: no script or function change; the delivery-time check expires a stale replay at its next claim; a replay of an expired row is
  refused with `delivery_not_in_dlq`, exit 2 (5.2). Rejected: the replay script refusing expired rows (a third user of the bound), an owner-override concept
  (not needed). Default applied, pending owner sign-off.
- **DF5** whether the CLI also expires at enable: no new CLI expiry path (A, not C); the CLI keeps L24's classification (prepare, `age`, `cap`) with the bound of
  DF6, and every row it prepares is re-checked at delivery. Rejected: C (a second expiry path, no extra coverage), B alone (4.1). Default applied, pending owner
  sign-off.
- **DF6** the CLI's per-projector branch: its first per-projector bound branch (precedent: the `public_sessions` branch, `CLI:196`): bound = `zalo_dm` ?
  `ZALO_DM_MAX_AGE_MINUTES` : `BACKFILL_MAX_AGE_MINUTES` (30, unchanged for every other name, the `en*_test` projectors included), applied at all three uses
  (`:141` step-1 refusal, `:146` refusal text, `:161` candidates); the comment `:56-58` is restated. Delta for the PR body: `zalo_dm`'s CLI window widens from
  L24's pending 30-minute default (`CLI:54`) to 60 minutes: events aged 30-60 minutes, which L24 expires at enable, are now prepared and then re-checked at
  delivery. Rejected: one value for all three projectors (it widens the `web_realtime` and `public_sessions` backfill: negative scope), 30 kept for `zalo_dm` at
  the CLI (two bounds for one projector). Default applied, pending owner sign-off.
- **DF7** the bound in the expiry record (section 10, R4; the orchestrator's ruling): `provider_ref` stays the categorical code `noop_expired`; the bound is
  carried by the warning line and is derivable for any row from `delivered_at` and the DD-146 log (the bound only changes by a dated decision). Rejected:
  embedding the bound in `provider_ref` (possible without a migration: no CHECK, `0005:46`; any NUL-free string accepted, `dispatcher.ts:443-444`), because it
  breaks the categorical query `provider_ref = 'noop_expired'`. Default applied, pending owner sign-off.

## 9. Decision record, units, verification and review

### 9.1 Decision record plan (DD-146)

- `docs/standards/decisions.md`, three edits and nothing else: (1) a new section DD-146, placed in the file's order (newest first: above DD-145, `:1760`); (2)
  its summary-table row (above DD-145's row, `:120`); (3) the DD-134 cross-reference: one mark to DD-146 in DD-134's summary-row status cell (`:131`), in the
  form of the existing DD-141 mark in that cell. DD-134's own text and values are not edited. If a catch-up merge conflicts ONLY in this file (L29 adds DD-147
  the same way), keep both entries in number order and say so in the report (conductor note A5); any other conflict is an AWAIT.
- Language: owner-facing Vietnamese prose (the repo rule for `decisions.md`; conductor note C5), with the owner's delegation quoted verbatim (section 1). Status:
  the repo's proposal mark for an unsigned decision, never the owner-decision mark; provenance stated as "decided by the conductor under the owner's delegation
  of 2026-10-22 (D5), not an owner signature".
- Content (stated here in English; the writer renders it): the bound (60 minutes on the event's `created_at`, DB clock, strict, one JSON definition shared by
  the dispatcher and the enable CLI); the design (A, before `deliver()`, `zalo_dm` only, no migration); the alternatives (B, C, M, the dlq variant); the record
  (row, audit, warning line; the runbook's two queries); and the DD-134 delta, exactly:
  - unchanged: (a) at most 8 deliveries, failure n < 8 retries after 15 s x 2^(n-1) (1905 s in all), the 8th failure dead-letters as `attempts_exhausted`; (b)
    DLQ replay is owner-only; a disable keeps prepared rows and a re-enable resumes them; the delivery matrix of `web_realtime` and `public_sessions`;
  - new: a `zalo_dm` delivery whose event is older than 60 minutes at the moment of delivery is not sent; it ends `delivered` with `provider_ref = 'noop_expired'`,
    terminal, outside the DLQ and the retry matrix, recorded. This holds on every path, including rows resumed after a rollback re-enable (which DD-134 today
    resumes at any age) and rows re-pended by an owner DLQ replay;
  - the enable CLI's `zalo_dm` backfill bound becomes the same 60-minute constant (from L24's pending 30-minute default); 30 stays for every other projector.

### 9.2 Implementation units (one file or one section per writer; each commits in the worktree, none pushes)

| Unit | Model | Files | Content | After |
|---|---|---|---|---|
| U1 | opus/max | `apps/bot/src/zalo-dm-delivery-age-bound.json` (new), `apps/bot/src/dispatcher.ts` | the JSON; the import, load validation and export; the 4.2 check, its pure parts exported for DA-1; the warning line; the threat-model comment | step 0 |
| U2 | opus/max | `scripts/outbox-projector-enable.mjs` | load, validate and export `ZALO_DM_MAX_AGE_MINUTES`; the DF6 branch at `:141`, `:146`, `:161`; the `:56-58` comment | U1 |
| U3 | opus/max | `apps/bot/src/dispatcher.test.ts` | the JRD-5 entry; DA-1, DA-2 | U1 |
| U4 | opus/max | `apps/bot/src/projector-registry.test.ts` | BS-3 edit; DA-3..DA-10 | U1, U2 |
| U5 | sonnet/high | `docs/runbooks/outbox-dispatch-enable-rollback.md` | `:61` (the `zalo_dm` bound is the shared 60, 30 for the others; the delivery-time check replaces the L31 follow-up note); `:65-68` (add the delivery-time expiry query beside the CLI one); `:78` (a resumed `zalo_dm` row past the bound is not sent and ends `noop_expired`); `:87-88` (the measured live stretch and the bound); section 4 (a stale replay expires at its next claim; an expired row cannot be replayed, exit 2) | U1, U2 |
| U6 | sonnet/high | `docs/standards/decisions.md` | 9.1 | U1, U2 |

U1 creates two files because the dispatcher's import needs the JSON (one line of data). U3 and U4 run serially under the lock. U5 and U6 state what the code
does, so they follow U1 and U2.

### 9.3 Verification

Cite measured output through `| tail -40`; `NODE_ENV=test` always; every DB run through the lock wrapper (7.3), one at a time.

1. Focused, locked: `NODE_ENV=test DATABASE_URL_TEST=... pnpm --filter @plexco/bot exec vitest run src/dispatcher.test.ts src/projector-registry.test.ts`.
2. `pnpm typecheck`; `pnpm lint`; `pnpm format:check`; `pnpm review:check:changed` and the FULL `pnpm review:check`.
3. Locked: `NODE_ENV=test DATABASE_URL_TEST=... pnpm --filter @plexco/db test` (the db suite) and `pnpm --filter @plexco/bot test`.
4. `NODE_ENV=test pnpm --filter @plexco/web test` (S1 VERIFY; no web or UI change, so no Playwright and no golden path).
5. Once at the final head: locked `NODE_ENV=test DATABASE_URL_TEST=... pnpm -w test` (one rerun for a listed flake; a second red is real; re-run the
   role-password step after every full run) and `pnpm build` once (sandbox off).
6. Byte-identical guards: `git diff --stat acdd8612b0e0c4b92023b77555dd9b637c277936 -- apps/bot/src/worker.ts apps/bot/src/projectors packages/db
   scripts/outbox-dlq-replay.mjs` prints nothing; `git diff -U0 acdd8612b0e0c4b92023b77555dd9b637c277936 -- apps/bot/src/dispatcher.ts` has no hunk whose old
   range touches `:11-23` or `:418-490`.
7. GitNexus: `impact` (upstream) on `runDispatchCycle` and on the CLI's enable function before editing them; `detect_changes()` before every commit; if a
   symbol does not resolve, a grep of its callers goes in the PR body.
8. CI GREEN: the check "verify" passes and every other check passes or skips ("OSV full dependency scan" ignored).

Tool hazards (S1): the Bash tool's shell is zsh, so loops, awk and multi-step logic go in a script under `status/P3-S16h-notes/scripts/`, run with `bash
<file>`, never an inline `-c` or `-e` script; sandbox off for Docker (container psql only), `git fetch` and push, `gh` and the build; never `docker compose
down -v`; the CLI and the raw enable run only against a database the test itself created.

### 9.4 Review plan

- An opus/max code reviewer plus an opus/max security round (external DMs, delivery policy), at most 3 rounds in all (pre-push rounds count), area-split from
  round 1: (1) every decision-table cell (no silent drop; an unreadable event time fails closed; no worker clock in the check); (2) the DD-134 values and the
  probe guard unchanged (the 9.3 item 6 diffs empty); (3) the single bound and the live path unchanged (DF1, DF2, DF6, DA-10); (4) the recorded outcome (role,
  ACL, no message text or personal data in the row or the line); (5) the runbook and DD-146 state exactly what the code does.
- Findings are BLOCKING, SHOULD_FIX or NIT, each with `file:line` and a one-line failure scenario; reviewers trust code, not comments or PR text. A fix after the
  final round is labelled "fix applied after the final round, not re-reviewed (3-round cap)". The PR body carries the S1 REVIEW line and lists DF0-DF7 as
  "default applied, pending owner sign-off" with their rejected alternatives.
- STOP: HALT if the lane would need to change an attempt count, a backoff, the DLQ rule or the probe guard, enable a projector, or write a migration without a
  slot; BLOCKED on 3 failed rounds; AWAIT only for a slot request or a concrete new owner-level decision.

## 10. OPEN

No open question in scope: every choice is a pinned default (8.4). Residual risks, stated in the runbook and the PR body:

- R1 60 minutes is thin under abnormal conditions: one worker death mid-attempt leaves 15 s; two deaths or a backlog over 25 rows per cycle can push a live
  retry past the bound, and it then expires with a record (section 3; accepted by tie-break 1).
- R2 a worker outage longer than the bound expires the DMs of the events produced during it at their first claim; today they would be sent at any age. Intended
  (threat 1).
- R3 the audit reason of a delivery-time expiry reads `projector_delivery_delivered` (as `noop_stale` today); `provider_ref` tells it apart.
- R4 the durable row does not hold the bound: the bound lives in the warning line and the JSON file's history. `provider_ref` has no CHECK (`0005:46`) and the
  dispatcher accepts any NUL-free string (`dispatcher.ts:443-444`), so a `noop_expired` value that also carries the bound is possible without a migration; the
  design keeps the fixed value (the exact-match `noop_*` family). CLOSED by the orchestrator's ruling, pinned as DF7 (8.4; default applied, pending owner
  sign-off): `provider_ref` stays the categorical code `noop_expired`; the bound is carried by the warning line and is derivable for any row from `delivered_at`
  and the DD-146 log (the bound only changes by a dated decision); embedding it in `provider_ref` was rejected because it breaks the categorical query
  `provider_ref = 'noop_expired'`.
- R5 the lane block's FILE OWNERSHIP list does not name the new JSON file; it is the DEFAULTS item "where the constant lives" (design D3), the orchestrator's
  Tier-A reading, stated in 8.1. CLOSED by the orchestrator's ruling: it is that DEFAULTS item, already pinned as DF2 (8.4).
- R6 DF6 widens `zalo_dm`'s CLI window from 30 to 60 minutes (a delta to L24's pending default): PR body, runbook `:61`.

Flagged against `design-decision.md` and the findings (recorded, not changed; the orchestrator rules):

- F1 D1 names the age literal as `clock_timestamp() - $1::timestamptz` "(or date_part epoch)". With node-pg's default parsers (no `setTypeParser` in the repo:
  measured) the bare interval comes back as an object, `Number()` of it is NaN, and every `zalo_dm` DM would expire as "unreadable". 4.2 item 4 pins the
  `date_part('epoch', ...)` form (double precision, a JS number) and JRD-5 pins that exact literal.
- F2 the lane block's runbook `:71-72` is stale (the "about 39 minutes" text is at `:87-88`); `zalo-dm.ts:113-116` drifted to `:112-113`; DD-134 now sits at
  `decisions.md:2902` (section 2).
- F3 S0b's "MIGRATION NEEDED: YES" and S0a's dlq-variant option are superseded by D1 (4.1): the GOAL is met without a migration; residual R4.
- F4 D2 cites the CLI edge as `CLI:98-103`: the cutoff is at `:99` and the `in_window` operator at `:103` (S0c); same rule.
- F5 D3's "createRequire(import.meta.url) (its existing loading pattern)": the CLI's existing call anchors `createRequire` at `packages/db/package.json`
  (`CLI:259`) to resolve `pg`; loading the JSON relative to the script with `createRequire(import.meta.url)` is the same mechanism, a different anchor. No
  conflict.

OUT_OF_SCOPE (recorded, not lane work): `zalo_dm_record_recipient` checks claimed plus token but not the lease (`0057:225`), with an `ON CONFLICT DO NOTHING`
insert: benign (S0b). `claim_projector_delivery_batch` stamps the delivery lease with `now()` (`0022:380`): L24's R3, unchanged.

NOT MEASURED at step 0, proven by the writers' runs: `app_worker` EXECUTE on `clock_timestamp()` and `date_part` (the PUBLIC default; the orchestrator found no
migration revoking `clock_timestamp()`); the import-attribute parse support (3, last item); whether any `staleCompletionSkips` summary pin in DT is a full
`toEqual` (no new counter is added, so none changes).

Closure of this section (S0f, by the orchestrator's rulings for P3-S16h): R4 is closed as the pinned default DF7 and R5 as the pinned DEFAULTS item DF2 (8.4);
the line-number drifts (F2, F4) are facts, not questions. Nothing listed above is an open question in scope: R1-R3 and R6 are residual risks stated in the
runbook and the PR body; F1-F5 are recorded with their resolution in-line; the two OUT_OF_SCOPE items stay outside the lane by its negative scope (8.2: no
migration, no edit under `packages/db/migrations`); the NOT MEASURED items are proofs the writers' runs supply (9.3 items 1-3), not decisions.

## 11. Closure matrix (12 of 12)

| # | Gate | Evidence | Result |
|---|---|---|---|
| 1 | Authority snapshot pinned by SHA | `AUTHORITY_SHA` = the base `acdd8612b0e0c4b92023b77555dd9b637c277936` (merge of PR #105) = the worktree HEAD at step 0 (header) and at this close (re-measured by S0f: HEAD = base, this file the only untracked change, no `index.lock`); the L24 merge `adda1e0741cf3728eb50856be7f99296d0c0b21d` (PR #102) is an ancestor (re-measured, `git merge-base --is-ancestor`); every TARGET_FILES path exists on disk (8.1) | PASS |
| 2 | Decisions in scope final | conductor decision D5 under the owner's standing delegation of 2026-10-22, quoted verbatim, and lane block L31 as the contract (section 1); the orchestrator's design (`design-decision.md` v2) restated, not re-decided (section 4); DF0-DF7 pinned as Tier-B defaults, "default applied, pending owner sign-off", each with its rejected alternatives, and the Tier-A items derived (8.4); DD-146 free at the base, DD-134 and DD-141 bind, DD-134's values byte-identical and its delta stated exactly (section 1, 9.1); R4 ruled as DF7 and R5 as DF2 (section 10) | PASS |
| 3 | Scope IN/OUT and owner clear | TARGET_FILES, the two created files and the lane-block files left out with their reason (8.1); the negative scope (8.2); units U1-U6, one file or one section per writer, with model and order (9.2); B3 inside the pre-approved caps: non-test 63-103 of 300, test 310-540 of 800, 8 of 10 files, 0 migrations, no exception (8.3); L29 holds the names and definers with disjoint files (section 1) | PASS |
| 4 | Dependencies classified | L24 hard and merged: `adda1e0` is an ancestor of the base (section 1; re-measured by S0f); L29 (P3-S16g) beside with disjoint files, the shared DB lock and DD-147 (section 1, 7.3, 9.1); no migration, so no slot request (section 4, 8.2) | PASS |
| 5 | Live schema and code match | sections 2 and 3: every `path:line` measured at the base by S0a-S0d or re-read by the composer (header); the lead's stale line numbers recorded as facts (F2, F4, section 10); the measured live worst case of 3225 s against the 3600 s bound (6.1 threat 5, 6.2 row P2) | PASS |
| 6 | Data, API, state, auth contract | no migration and no SQL object, column, table, endpoint, grant, role or definer (8.2); the expiry reuses the `delivered` state with `provider_ref` `noop_expired` through the one `complete_projector_delivery` call: terminal, outside the DLQ and the retry matrix, never a failed attempt of the 8 (4.2, 5.1, DF3, DF7); the record's role and ACL (5.1) and no message text or personal data in the row or the warning line (7.2 DA-4, 9.4 area 4); the DLQ replay function and script unchanged (5.2, DF4) | PASS |
| 7 | Fail-closed, idempotency, order | the decision table, 32 cells, none silently dropped: an unreadable event time expires with a record on every path (JS check before any SQL); a failed DB clock read leaves the row claimed with attempts unchanged for a re-check after the lease; strict `>` at the bound (6.2, DA-1, DA-8); DB clock only, never the worker clock (6.1 threat 3); one check before the single `deliver()` call site covers every path (6.1 threat 2); an expired row is terminal and its replay is refused, exit 2 (6.2 row P6b, DF4) | PASS |
| 8 | Open questions in scope = 0 | DF0-DF7 pinned (8.4); R4 closed as DF7 and R5 as DF2 by the orchestrator's rulings, the line-number drifts are facts (section 10); R1-R3 and R6 are residual risks for the runbook and the PR body; F1-F5 resolved in-line; the OUT_OF_SCOPE items held by the negative scope (8.2); the NOT MEASURED items are writer-run proofs (9.3), not questions | PASS |
| 9 | Acceptance matrix with expected results | the decision table of 32 cells (6.2); the threat model of 6 rows, each with its proof (6.1); JRD-5 and BS-3 with their exact new outcomes (7.1); DA-1..DA-10 with expected results (7.2); the unchanged DD-134, A5, rollback and L24 boot-sequence pins (7.3) | PASS |
| 10 | Migration, security, rollback | no migration (section 4, 8.2); an opus/max security round (external DMs, delivery policy) beside the opus/max code review, at most 3 rounds (9.4); DD-134's attempts, backoff, DLQ rule and replay and the probe guard byte-identical, proven by the 9.3 item 6 diffs; rollback = a revert of the lane's commits, with no migration or SQL object to undo (8.2) | PASS |
| 11 | First slice hard dependencies merged | U1 needs only what the base holds: the claim path, the envelope and the single `deliver()` call site in `dispatcher.ts` and the existing `complete_projector_delivery` (section 2, 4.2, 6.1 threat 2); L24 merged (row 4) | PASS |
| 12 | Implementation handoff ready | sections 4.2, 7, 8 and 9: the mechanics, the tests, the scope, units U1-U6 with model, files, content and order, the verification and the review plan; the worktree exists at the base, clean but for this file (header; re-measured by S0f) | PASS |

## 12. Verdict

```text
REVIEW_POLICY_VERSION: 1.3
REVIEW_VERDICT: CODE_READY
REVIEWED_AT: 2026-10-23
AUTHORITY_SHA: acdd8612b0e0c4b92023b77555dd9b637c277936
BASE_BRANCH: main
TARGET_FILES:
  - apps/bot/src/dispatcher.ts
  - apps/bot/src/dispatcher.test.ts
  - apps/bot/src/projector-registry.test.ts
  - scripts/outbox-projector-enable.mjs
  - docs/runbooks/outbox-dispatch-enable-rollback.md
  - docs/standards/decisions.md
  - docs/sessions/web-mvp-phase3-readiness-p3-zalo-dm-delivery-age-expiry.md
NEW_FILES (implementation scope, unit U1): apps/bot/src/zalo-dm-delivery-age-bound.json
SLICE: p3-zalo-dm-delivery-age-expiry
IN_SCOPE: the delivery-time age check for zalo_dm rows in apps/bot/src/dispatcher.ts before the single deliver() call (U1: the bound file apps/bot/src/zalo-dm-delivery-age-bound.json, its load validation and the ZALO_DM_MAX_AGE_MINUTES export; the DB-clock age literal; strict age > 3600 s ends the row delivered with provider_ref noop_expired through complete_projector_delivery, terminal, plus one warning line; an unreadable event time expires before any SQL); the enable CLI's zalo_dm bound branch in scripts/outbox-projector-enable.mjs (U2, DF6); the tests in apps/bot/src/dispatcher.test.ts (U3: the JRD-5 entry, DA-1, DA-2) and apps/bot/src/projector-registry.test.ts (U4: the BS-3 edit, DA-3..DA-10); the runbook docs/runbooks/outbox-dispatch-enable-rollback.md (U5); DD-146, its summary row and the DD-134 cross-reference mark in docs/standards/decisions.md (U6)
OUT_OF_SCOPE: the 8 attempts, the 15 s x 2^(n-1) backoff, the DLQ rule, the owner-only replay and scripts/outbox-dlq-replay.mjs, the probe guard (apps/bot/src/worker.ts) and the exact-"true" flag semantics (dispatcher.ts:11-23 and :418-490 untouched); enabling any projector anywhere; a real deliverer, bot token or production env; web_realtime and public_sessions behavior; how events are produced; any migration and any edit under packages/db/migrations, packages/db/src or apps/bot/src/projectors; a new counter, owner-override concept, grant, role or definer; Reviewed specs and docs/legal; decisions.md beyond DD-146, its summary row and the DD-134 mark; PR 50; the files of L29
G1_DECISION: PASS
G2_SPEC: PASS
G3_DEPENDENCY: PASS
G4_TEST: PASS
G5_SCOPE: PASS
G6_EXTERNAL: PASS
HARD_DEPENDENCIES: L24 (PR 102) merged as adda1e0741cf3728eb50856be7f99296d0c0b21d, an ancestor of the base acdd8612b0e0c4b92023b77555dd9b637c277936 (probe: git merge-base --is-ancestor)
PRIOR_SLICES: PR 102 (L24: the owner enable CLI scripts/outbox-projector-enable.mjs, its backfill bound, the expiry record projector_delivery_expired:<projector>:<age|cap> and the boot-sequence tests this lane extends); PR 94 (DD-141, OUTBOX_DISPATCH_SCHEDULE_ENABLED defaults true); 0056 projector registry and owner DLQ replay (scripts/outbox-dlq-replay.mjs, unchanged); PR 66 zalo_dm projector (unchanged)
OPEN_QUESTIONS_IN_SCOPE: 0
ENABLEMENT_ONLY_GATES: none
LIVE_REPO_VERIFICATION: PASS
CONTRACT_MATRIX: PASS
CLOSURE_MATRIX: PASS
ACCEPTANCE_MATRIX: PASS
SECURITY_AND_MIGRATION_GATE: PASS # none: no migration, no SQL object, grant, role or definer change; opus/max security round (external DMs, delivery policy)
IMPLEMENTATION_ARTIFACTS: PASS
FIRST_IMPLEMENTATION_STEP: unit U1 (opus/max) - per 9.2 and 4.2: GitNexus impact (upstream) on runDispatchCycle, then create apps/bot/src/zalo-dm-delivery-age-bound.json ({ "maxAgeMinutes": 60 }) and, in apps/bot/src/dispatcher.ts, its json-attribute import, positive-integer load validation and ZALO_DM_MAX_AGE_MINUTES export, the 4.2 check for zalo_dm rows before the single deliver() call (JS readability check first, then the JRD-5 age literal on the DB clock; strict age > bound ends the row delivered with provider_ref noop_expired plus one warning line), its pure parts exported for DA-1 and the threat-model comment; then commit in the worktree
REMAINING_BLOCKERS: none
```
