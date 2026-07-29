<!-- review-readiness: enforce -->
# Session Management — Acceptance Checklist (issue-ready, source-traced)

> **Version:** 1.2 · 2026-07-28
> **Machine classification:** `enforce`
> **Review policy:** 1.3

> **Purpose.** Convert the acceptance criteria + Definition-of-Done already written in the two Session
> Management specs into a source-traced, issue-ready checklist a host/founder can paste into a tracker
> **before** the (manual, separately risk-classified) Session Management build slice.
>
> **This document is TRACEABILITY ONLY.** Checking an item does **not** authorize building Session
> Management, does **not** choose storage/API/mutation shapes, and does **not** resolve any open design
> question the specs leave open (those are quarantined in [§9](#9-unresolved--needs-spec-fail-closed)).
> Every item is an intent-faithful restatement of a specific spec line — nothing here is invented. Where a
> spec leaves a criterion open, it is recorded as a gap, never filled.

## Sources (LOCAL, authoritative — no other input used)

| Key | File | Version / status |
| --- | --- | --- |
| **P** | `docs/features/feature_session_management.md` (Product / UX) | v2.17 · 2026-07-28 · **Reviewed** |
| **T** | `docs/features/BE/feature_session_management_tech.md` (Backend Tech) | v2.18a · 2026-07-28 · **Reviewed** |

- **Origin:** `docs/product/ROADMAP.md` → Next Actions **#3** ("Review/sign-off feature specs của phase sắp
  build; **chuyển acceptance criteria thành issue checklist**").
- **Feature status (both specs):** `Implementation: Not started` for SessionService/routes/projectors and
  waitlist/channel-booking behaviour. DB substrate `0014` (waitlist), `0019` (same-tenant integrity) and
  `0024` (public finite-capacity CHECK) is merged, but DD-45a's partial unique position fence and DD-32's
  `channel_booking_intents`, shared occupancy helper, account predicate, verified-payment finalizer and
  expiry/requeue integration are **not** implemented. This is a **pre-build** acceptance checklist over the
  uncommitted Product v2.17 / Tech v2.18a working-tree contract; `docs/standards/BUILD-STATUS.md` remains the
  implementation-status authority. See [§9](#9-unresolved--needs-spec-fail-closed).
- **Cross-feature references (pointer-only):** publish billing suspension additionally cites
  `docs/features/BE/feature_billing_lifecycle_tech.md` §3/§5; positive public materialisation cites
  `docs/features/BE/feature_marketplace_discovery_tech.md`; DD-32 final-slot/settlement/projection branches
  cite `docs/features/feature_channel_booking_funnel.md` and
  `docs/features/BE/feature_channel_booking_funnel_tech.md` integration tests #1/#3/#8. These owning specs
  are not retraced end-to-end here. **P/T above remain the sole primary sources for the Session inventory**;
  cross-feature tests prove the delegated branches named explicitly below.

## How to read a row

`- [ ] <testable acceptance statement>  — src: <pointer(s)>`

**Pointer legend**

- `P §N` / `T §N` — section _N_ of that spec.
- `P §1·INV` — Product §1 "Bất biến" (invariants).
- `P UC-n` — Product §2 use case `SES-UC-n`.
- `P E#n` — Product §2 edge case #_n_.
- `P AC#n` — Product §6 acceptance criterion #_n_ (numbered 1–29, top→bottom).
- `P §5·EV` — Product §5 analytics event.
- `T BE#n` — Tech §2 Backend edge case #_n_.
- `T U#n` / `T I#n` — Tech §5 unit / integration test #_n_.
- `T ERR:<CODE>` — Tech §3 error code.
- `T §4·WE` / `T §4·WP` / `T §4·REC` — Tech §4 "Waitlist entry + rejoin disposition" / "Waitlist promotion"
  (DD-45/DD-49) / "Recurrence Implementation".

Section groups follow the areas named in the slice contract: create/edit/close · roster ·
waitlist/capacity · timezone · RLS/isolation · audit. Invariants ([§0](#0-invariants-that-must-always-hold))
are principles verified by the area checks that follow and are cross-referenced there. The concrete
verification list (Definition of Done) is [§7](#7-definition-of-done--test-plan-tech-5), preserved in the
spec's own Unit/Integration structure.

---

## 0. Invariants that must always hold

_Principles from `P §1·INV`; each is verified concretely by the referenced area check._

- [ ] Chat and web invoke the **same domain service** — session logic is never duplicated — src: `P §1·INV`;
      `T §1` (single shared domain service); verified §1 + `T I#2`
- [ ] Every session is bound to `tenant_id` as the **RLS choke-point** — src: `P §1·INV`; `T §2`
      (`sessions.tenant_id NOT NULL`, `ENABLE`+`FORCE` RLS); verified §5
- [ ] **Admission capacity is never exceeded** — every join, payment-hold, expiry/promotion and
      capacity-change locks the session row and reads one occupancy helper:
      `active players + unexpired channel payment holds`; waitlisted rows and account-link-only intents do
      not occupy — src: `P §1·INV`; verified §3 (`P AC#5`/`#6`, `T BE#1`/`#14`/`#16`)
- [ ] A **price change after any charge exists** requires preview + an explicit policy — no silent mutation
      — src: `P §1·INV`; verified §1 (`P AC#10`, `T BE#4`)
- [ ] **Venue detail** (name, phone, map) is shown **only** when the canonical player outcome is `active`;
      pending and approved-but-waitlisted see area/queue-position only — src: `P §1·INV`; verified §2
      (`P E#6`)
- [ ] Messenger `/newsession` uses **one durable wizard owner** at the pre-dispatch boundary; every step +
      final confirm re-checks `session.manage`, tenant context and snapshot; central/tenant Page is an
      adapter/context surface only (no per-Page business rule) — src: `P §1·INV`; `T §1`, `T §3` (Messenger
      create path); verified §1 + §5

---

## 1. Create / edit / close / cancel (session lifecycle)

- [ ] Host creates a one-off session (private/public) with all fields validated → status `draft`; the Host
      then **publishes** (`draft → open`, `P §4`) to accept joins — src: `P UC-1` (create=`draft`/publish→`open`,
      reconciled v2.12c), `T §2` (DDL default `draft`), `T §3` (POST example `draft`), `T U#1`. The publish
      transition's own command/idempotency/gating mechanics are traced separately below (this bullet covers
      create-status only).
- [ ] Create/update is rejected when `ends_at <= starts_at` — src: `P E#1` (Ref: BL-DATA-1); `T §2`
      (`CHECK (ends_at > starts_at)`), `T ERR:INVALID_TIME_RANGE`, `T U#2`
- [ ] Create is rejected when the sport key is not in the **active** sport taxonomy — src: `P E#2`;
      `T ERR:SPORT_INACTIVE`, `T U#3`
- [ ] `visibility` and `join_policy` accept only their enum values (`private|public`, `open|approval`); DB
      CHECK enforces — src: `P AC#4`; `T §2` (`CHECK` visibility/join_policy)
- [ ] Public visibility without the required discovery fields (sport, area, `starts_at`, `slots_max`) is
      rejected — src: `P E#7`; `T BE#12`, `T ERR:MISSING_DISCOVERY_FIELDS`, `T U#9`
- [ ] Base price cannot be negative (`price_amount >= 0`); DB CHECK rejects with no session/outbox mutation
      — src: `T §2` (`CHECK (price_amount >= 0)`), `T U#38`
- [ ] Capacity, when set, must be positive (`slots_max IS NULL OR slots_max > 0`): a zero/negative
      `slots_max` on create/update is rejected by DB CHECK — src: `P AC#4`; `T §2`
      (`CHECK (slots_max IS NULL OR slots_max > 0)`)
- [ ] Host edits time/price/capacity/visibility; the command writes canonical state **plus** an outbox
      event — src: `P UC-4`; `T §4` (`session.updated`)
- [ ] Host edits a session on web (P4) through the **same** service/validation as chat — src: `P UC-7`;
      `T §1`, `T I#2`
- [ ] Concurrent web + chat edits use optimistic `version` locking; the stale edit is rejected — src:
      `T BE#2`, `T ERR:STALE_VERSION`, `T U#4`, `T U#12`
- [ ] A duplicate command (same `commandId`) returns the previous result (command dedup) — src: `T BE#3`,
      `T §3` (Idempotency), `T U#13`
- [ ] Create/update/announce endpoints are idempotent, keyed by `commandId` — src: `T §3` (Idempotency
      table)
- [ ] Host closes a session: no new joins are accepted and the public projection is removed — src: `P UC-5`;
      `P §4` (state machine `open → closed`)
- [ ] The system auto-closes a session when its time ends: status → `closed`, projection removed — src:
      `P UC-10`; `P §5·EV` (`session_closed`, `close_reason=auto`)
- [ ] Closing an already-closed session is an idempotent no-op success — src: `T §3` (Idempotency, close
      no-op), `T U#8`
- [ ] Host cancels a session; the roster/paid impact is shown as a preview and the refund/review policy is
      applied — a paid roster requires **explicit review**, never a silent charge mutation — src: `P AC#10`,
      `P UC-6`; `T BE#5`, `T ERR:CANCEL_REQUIRES_REVIEW`, `T U#7`
- [ ] Cancelling an already-cancelled session is an idempotent no-op success — src: `T §3` (Idempotency,
      cancel no-op)
- [ ] Any mutation on a closed/cancelled/past session is rejected — **except** a privileged correction,
      which must carry an audit trail — src: `P E#11`; `T BE#11`, `T ERR:SESSION_NOT_OPEN`, `T U#16`
- [ ] A **price** change when a charge already exists requires **explicit impact handling** — existing
      charges are kept **or** adjustment entries are written, never silent mutation — src: `P AC#10`,
      `P E#5`; `T BE#4`, `T ERR:PRICE_CHANGE_REQUIRES_POLICY`, `T U#6`
- [ ] Host creates a session on **both** the central Plexco Page and a tenant Page; a club without a Page is
      not forced onto web — src: `P AC#2`, `P UC-11` (DD-65..68); `T §3` (Messenger create path), `T U#35`,
      `T I#7`
- [ ] Messenger `/newsession`: role/tenant picker + wizard cancel/expiry/context-switch/replay/non-admin all
      fail closed; a duplicate confirm creates **exactly one** session — src: `P AC#3`, `P E#15`, `P UC-11`;
      `T BE#20`, `T §3` (Messenger create path), `T U#36`, `T U#37`
- [ ] Full CRUD lifecycle (create → update → close) drives correct state transitions — src: `P §4` (state
      machine); `T I#1`
- [ ] Host publishes a `draft` session to `open` via a **distinct `PublishSession` command** (chat + web, same
      shared service) — status-only, does **not** change `visibility`; only Host (`session.manage`) may call
      it — src: `P UC-12`, `P AC#15`; `T §4` (Publish transition), `T BE#21`, `T §3`
      (`POST /api/sessions/:id/publish`), `T U#40`
- [ ] Publish surfaces on **bot** (single-action lệnh/callback "Đăng kèo" on a draft, no wizard) and on **web**
      (Publish button on draft detail + confirm dialog); both invoke the same `PublishSession` command and map
      the same error states — src: `P AC#20`, `P §3` (Screens & States); `T §3`
- [ ] Re-publishing a session already `open` is an **idempotent no-op**: `commandId` replay or a new
      `commandId` both return success with **no** duplicate `session.published` event, and idempotency wins
      even over a stale `expectedVersion` (goal state already reached) — **but authz/billing win over the
      no-op**: AuthZ + the billing-suspension check re-run on **every** publish call including a replay,
      **before** dedup/state lookup, so an actor who has since lost `session.manage`, or a tenant that has
      since gone billing-`suspended`, still gets 403 on replay even though the session is already `open` (the
      no-op is only for an actor who still holds authority) — src: `P E#16`, `P AC#16`; `T BE#21`, `T §4`
      (step 1 ordering, step 3), `T U#41`, `T U#47` (cf. `T U#44`, `T U#46`). A `commandId` reused for a
      **different** resource/payload is handled by the canonical `processed_commands` dedup (edge #3), not
      special-cased by publish — `T U#48`
- [ ] Publishing a `public` session re-validates discovery completeness (`P E#7`); missing fields reject
      `MISSING_DISCOVERY_FIELDS` with zero mutation — src: `P E#17`, `P AC#17`; `T BE#22`, `T §4` (step 5),
      `T U#42`
- [ ] Publishing a session that is `closed`/`cancelled`, or a `draft` whose `starts_at` has already passed, is
      rejected `SESSION_NOT_OPEN` with zero mutation — src: `P E#18`, `P AC#18`; `T BE#23`, `T §4` (step 4),
      `T U#43`
- [ ] A stale `expectedVersion` on the actual `draft → open` mutation (not the idempotent-no-op branch) is
      rejected `STALE_VERSION` (409) — src: `T §4` (step 6), `T U#45`
- [ ] Publish is blocked fail-closed with `TENANT_SUSPENDED` (403) when the tenant is billing-`suspended`, per
      the billing **Suspended Action Matrix** — status-authority is owned/resolved by `feature_billing_lifecycle`
      (`feature_billing_lifecycle_tech.md` §3, founder-ratified) and re-checked, inside the same transaction as
      the mutation, via a **locking read on both status rows in order** — `SELECT ... FOR SHARE` on `tenants`
      **then** `subscriptions` (same order as status-authority's own step 1→step 2) — so the re-check either
      blocks on the Daily Lifecycle Job's `subscriptions` `FOR UPDATE SKIP LOCKED` suspend transition until it
      resolves, or that job's `SKIP LOCKED` defers to its next run; a lock on `tenants` alone would not
      serialize with the job (it locks `subscriptions`) and would not actually close the race — src: `P E#19`,
      `P AC#19`; `T BE#24`, `T §4` (step 6 + "Billing suspension" blockquotes), `T U#46`; competing-writer race
      closed by billing test #36 / test #36a (`feature_billing_lifecycle_tech.md` §5, cross-feature)
- [ ] Host discards a verified-empty unpublished `draft` through the existing `CancelSession` transition:
      `draft → cancelled`, bump `version`, emit exactly one `session.cancelled` with
      `cancel_reason='manual'`; source `draft` has no past-time guard and only `session.manage` may mutate —
      src: `P UC-13`, `P E#20`, `P AC#21`; `T BE#25`, `T U#49`, `T U#50`
- [ ] `CancelSession.expectedVersion` is mandatory on every real `draft|open → cancelled` mutation; omitted
      or mismatched after a concurrent publish/edit returns `STALE_VERSION` with zero mutation — src:
      `P E#21`, `P AC#23`; `T BE#26`, `T U#51`, `T U#58`
- [ ] Cancelling an already-`cancelled` session remains an idempotent no-op without a version match, while a
      `closed` session is rejected `SESSION_NOT_OPEN` — src: `P E#20`, `P AC#24`; `T BE#27`, `T U#52`,
      `T U#53`
- [ ] The draft-only no-past guard does not leak to an `open` session: cancelling `open` with
      `starts_at <= now()` is still rejected `SESSION_NOT_OPEN` with zero mutation — src: `P E#24`,
      `P AC#22`; `T BE#31`, `T U#61`
- [ ] A `draft` carrying any player/charge anomaly is never silently discarded or auto-expired. Host
      discard returns the existing `CANCEL_REQUIRES_REVIEW`; background expiry leaves the row `draft` and
      emits `session.expiry_anomaly_detected` on every detection. Consumer-level owner alert dedupe is
      separate — src: `P E#23`, `P AC#25`/`#28`; `T BE#28`, `T U#59`, `T U#60`
- [ ] The owner-alert consumer coalesces repeated `session.expiry_anomaly_detected` events by `session_id`
      so repeated auto-expiry detection does not spam the owner. The implementation packet may choose the
      exact consumer/storage mechanism, but must include a cross-tick duplicate-event integration test —
      src: `P AC#28`; `T BE#28`, `T §4` (Events + Draft cleanup). `T U#60` intentionally covers event
      append-only truth only and does not satisfy this consumer test.
- [ ] Auto-expiry transitions only verified-empty `draft` rows with `starts_at <= now()` to `cancelled`
      (`cancel_reason='auto'`, exactly one event); future drafts and all non-draft sessions remain unchanged —
      src: `P UC-14`, `P E#20`, `P AC#26`; `T §4` (Draft cleanup), `T U#54`, `T U#55`
- [ ] Overlapping auto-expiry runs use `FOR UPDATE SKIP LOCKED`; exactly one transition/event occurs and
      tenant isolation remains fail-closed — src: `P E#22`, `P AC#27`; `T BE#30`, `T U#56`, `T I#8`
- [ ] Auto-expiry racing `PublishSession` is deterministic under the shared session-row lock: job-first
      makes publish observe `cancelled`; publish-first makes the job skip and never re-match the now-`open`
      row; neither order double-transitions — src: `T BE#29`, `T U#57`
- [ ] Draft-discard surfaces exist on bot (`Huỷ nháp`) and web (button + confirm), invoke the same
      `CancelSession`, and render `SESSION_NOT_OPEN`, `STALE_VERSION` and
      `CANCEL_REQUIRES_REVIEW` consistently — src: `P §3`, `P AC#29`; `T §3`

---

## 2. Roster (join / leave / rejoin / venue gating)

- [ ] A player joins a public session: request → auto-approve **or** host-approve per join policy — src:
      `P UC-8`
- [ ] On first-entry join when the session is full, **both** the auto- and host-approve paths land the
      player in `waitlisted` with a positive position — no charge, no venue — src: `P UC-8`, `P E#4`;
      `T §4·WE` (step 5), `T U#21`
- [ ] A player can leave before play time → status `left`; the opener atomically evaluates the queue — src:
      `P UC-9`; `T §4·WP`
- [ ] Venue detail is withheld until `players.status='active'`; an approved-but-waitlisted player still sees
      area/position only (no leak) — src: `P E#6`, `P §1·INV`; `T BE#8`
- [ ] An existing `active` or `waitlisted` player returns the **current outcome idempotently** (position /
      charge unchanged); a later ban does not turn that replay into an error — src: `P AC#8`; `T §4·WE`
      (step 2)
- [ ] An existing `left` player self-rejoin re-derives the **live DD-49 disposition under lock**:
      still-owed → carry-over; refunded → append lifecycle only at activation; full → `waitlisted` (refunded
      adds no new lifecycle until promotion); unknown/unimplemented → `REJOIN_REQUIRES_REVIEW` with **zero
      mutation** — src: `P AC#8`, `P E#13` (DD-49); `T BE#17`, `T §4·WE` (steps 3–6),
      `T ERR:REJOIN_REQUIRES_REVIEW`, `T U#28`, `T U#29`, `T U#30`
- [ ] A rejoin never inserts a **duplicate `charges` row** — src: `P E#13`; `T BE#17`, `T §4·WE` (step 6)
- [ ] A direct active join whose amount cannot be derived **aborts fail-closed**: no membership/player/
      charge/venue, no fallback, retry-safe — src: `P E#14` ("Direct active join aborts"); `T §4·WE`
      (step 5), `T U#34`

---

## 3. Waitlist & capacity (DD-45 / DD-49 + retry-liveness)

- [ ] Concurrent capacity/join/payment-hold operations cannot over-fill — the session row is locked and
      shared occupancy (`active + unexpired holds`) is re-counted (first-commit-wins) — src: `P AC#5`,
      `P E#4`/`#25`; `T BE#1`/`#14`/`#16`, `T U#11`, `T U#25`, `T I#5`; Funnel BE integration #1
      (active-or-hold final-slot race, pointer-only)
- [ ] Two first-entry players joining the last slot concurrently: exactly one becomes `active` (+ exactly
      one charge), the other becomes `waitlisted` with a positive position and no charge — src: `P E#4`;
      `T U#11`
- [ ] A waitlisted row itself occupies **no capacity**, is never shown venue, and creates **no charge /
      new-obligation**. The only exception in occupancy is a separate live DD-32 payment hold associated
      with a paid-unlinked promotion candidate; the candidate row remains waitlisted — src: `P AC#6`,
      `P E#26`; `T §0` (DD-32/DD-45/DD-49 contract), `T §4·WE`, `T §4·WP`
- [ ] Waitlist rows satisfy the state-shape invariant: `status='waitlisted' ⇔ waitlist_position IS NOT NULL`
      and `waitlist_position > 0`; `active`/`left` carry no position — DB CHECK rejects violations — src:
      `T §2` (`players_waitlist_shape_chk`, `players_waitlist_position_positive_chk`), `T BE#13`
- [ ] On the existing free/qualified-linked activation path, promotion creates **exactly one canonical
      charge/lifecycle as applicable** (assert-no-charge, then one write atomic with activation). A
      paid-unlinked candidate does not enter this path before verified settlement — src: `P AC#6`;
      `T §4·WP` (steps 9–10), `T U#22`, `T U#25a`
- [ ] A leave or capacity increase fills every admission slot left after `active + live holds`, in total
      order (`waitlist_position, joined_at, id`); finite→unlimited fills every eligible candidate. A
      decrease below active rejects `CAPACITY_BELOW_ROSTER`; a decrease between active and active+holds
      rejects `CAPACITY_BELOW_OCCUPANCY`; neither evicts/cancels a hold or mutates silently — src:
      `P AC#7`, `P E#3`/`#25`; `T BE#15`/`#16`,
      `T ERR:CAPACITY_BELOW_ROSTER`/`CAPACITY_BELOW_OCCUPANCY`, `T U#23`, `T U#24`, `T U#25`.
      **finite→unlimited (`slots_max→NULL`) is allowed only for _non-public_ sessions**: a public session
      must carry a finite `slots_max` (`P E#7`, reconciled v2.12c/v2.13b), so `finite→NULL` on a public
      session is rejected (`MISSING_DISCOVERY_FIELDS`) and the consume-time entry choke-point + promotion
      path never treat a public+`NULL` row as unbounded — src: `P E#7`, `T §2` / `T BE#12`, `T U#24a` / `U#24b`.
- [ ] Promotion re-checks `evaluateSessionEligibility()` (DD-41), DD-42 reliability and shared
      `evaluateJoinRestriction()` (DD-52) before resolving financial disposition — src: `T §4·WP`
      (steps 5, 8)
- [ ] A candidate failing a **DD-41** eligibility check is skipped, **keeps its position**, and promotion
      continues to the next — src: `T §4·WP` (step 5), `T U#26`. (DD-42 deprioritize → **tail** and DD-52
      ban → **skip** are distinct queue outcomes, covered separately below.)
- [ ] A waitlisted DD-49 rejoin candidate re-derives live disposition at promotion (carry-over **or** append
      refunded lifecycle), activates + clears position, with no duplicate charge row — src: `P AC#6`;
      `T §4·WP` (steps 5, 9), `T U#31`
- [ ] A paid-unlinked candidate reaching promotion receives exactly one 15-minute booking intent/payment
      hold under the same session lock, remains waitlisted with venue hidden and no charge, and is excluded
      from subsequent selection while the hold is live — src: `P E#26`, `P AC#6`; `T §4·WP` (steps 3, 10),
      `T U#25a`
- [ ] Verified settlement re-enters the shared funnel finalizer and activates atomically. Hold expiry
      releases occupancy, moves the candidate to queue tail exactly once, and continues canonical
      promotion; duplicate expiry is a no-op. Concurrent Account-link/payment callbacks still produce one
      terminal booking and at-most-one allocation — src: `P E#26`, `P AC#6`; `T §4·WP` (step 10),
      `T U#25b`; Funnel BE integration #3 (pointer-only)
- [ ] Public projection keeps `confirmed_count=active players` while `slots_open` subtracts
      `active + unexpired holds`; hold count/identity stays private and final mutation ignores stale
      projection — src: `T §6` (projector parity); Funnel BE integration #8 and Marketplace BE aggregate
      tests (pointer-only)
- [ ] DD-45a is decision-final but not implemented: the future monotonic migration preflights duplicates,
      HALTs for manual repair without auto-renumber, then adds partial
      `UNIQUE (session_id, waitlist_position) WHERE status='waitlisted'`; gaps remain valid and the
      three-key order stays as compatibility/defense — src: `P` header/DD-45a; `T §2`, `T §4·WP`,
      `T U#33r`
- [ ] A promotion candidate whose live DD-49 disposition is missing/malformed is **not** promoted: audit
      `WAITLIST_CHARGE_CONFLICT` + owner-review, then continue to the next — src: `T BE#18`, `T §4·WP`
      (step 5), `T U#31a`
- [ ] Promotion is idempotent under a duplicate command / redelivery: same result, no double
      charge/promotion — src: `T U#27`, `T U#33b`
- [ ] `deriveChargeAmount` failure at first-activation keeps the candidate waitlisted/no-charge/no-venue;
      the opener commits and writes **one** candidate event bound to a lazily-created root
      `promotion_retry_id`; the leave/capacity opener is **not** rolled back; the queue continues — src:
      `P AC#9`, `P E#14`; `T BE#19`, `T §4·WP` (steps 6–9), `T U#32`, `T I#6`
- [ ] The retry job runs under **one** CAS/lease owner with an atomic **max-3 claimed-attempt** budget; each
      completed current-order sweep tries each candidate at most once and re-checks session-open/joinable,
      `starts_at > now()`, capacity, entry version, DD-41/DD-42/DD-52 and live financial state — src:
      `P AC#9`; `T §4·WP` (steps 7–9), `T U#33a`, `T U#33b`, `T U#33d`
- [ ] Sibling/duplicate failure events cannot fork the job or budget (no N×N attempt multiplication); a
      stale candidate event is alert-dedupe only and cannot drive promotion or resolve the root — src:
      `P AC#9`; `T §4·WP` (step 10), `T U#33c`, `T U#33j`
- [ ] Reorder (DD-42 deprioritize) or a later DD-52 ban after a failure event cannot let a candidate bypass
      the current-order selector — src: `T §4·WP` (deprioritize→tail), `T U#33h`, `T U#33i`
- [ ] Concurrent retry claims resolve to exactly one CAS winner + one sweep increment; the loser does no
      domain work — src: `T U#33e`
- [ ] Worker crash **before** domain commit is reclaim-safe while count `< 3` (claimed-attempt count never
      exceeds 3; no promotion/charge before commit); crash **after** commit observes persisted
      `resolved|due|terminal` (no second charge/promotion) — src: `T §4·WP` (step 9), `T U#33f`, `T U#33g`,
      `T U#33l`
- [ ] An expired `claimed` at count 3 is finalized under lock order `session → job`: resolved if retry no
      longer applies, else terminal + owner-review/DLQ — no stuck job, no derivation, no attempt 4, no
      fallback — src: `P AC#9`, `P E#14`; `T §4·WP` (step 9), `T U#33o`
- [ ] A capacity outcome that fills/observes full, plus close/start/cancel, resolves **every** nonterminal
      retry root in the same transaction (universal lock order `session → root job → candidate/finance`) —
      src: `T BE#4`/`#5`, `T §4·WP` (steps 1–2, 6, 8), `T U#33k`, `T U#33m`, `T U#33n`, `T U#33p`, `T U#33q`
- [ ] `promotion_retry_jobs` + candidate events are tenant-private (same-tenant refs, `ENABLE`+`FORCE` RLS,
      no broad `app`/`readonly` scan); cross-tenant scheduling uses only a narrow audited worker-claim role
      that re-enters exact tenant context before the domain transaction — src: `T §4·WP`
      (`promotion_retry_jobs` RLS paragraph)

---

## 4. Timezone & recurrence

- [ ] Host creates a recurring template; future instances are generated **idempotently** in the tenant
      timezone — src: `P UC-2`
- [ ] Recurrence generation is idempotent and timezone-safe across a **DST boundary** — IANA timezone +
      occurrence idempotency key — src: `P AC#12`, `P E#9`; `T U#14`, `T U#15`, `T I#3`
- [ ] Duplicate occurrence generation is prevented by `UNIQUE(recurrence_rule_id, local_occurrence_key)` —
      src: `T §2` (`session_occurrences` UNIQUE), `T BE#6`, `T U#15`
- [ ] DST ambiguity uses a tested timezone library with a documented policy (prefer earlier) — src:
      `T BE#7`, `T §4·REC`
- [ ] Editing a recurrence rule creates a **new version**; past/generated occurrences are **not** silently
      rewritten — src: `T §4·REC`
- [ ] Occurrences are generated within a bounded (configurable) horizon — src: `T §4·REC`

> Recurrence **edit granularity** (edit one occurrence vs this-and-future) is an **open** question — see
> [§9](#9-unresolved--needs-spec-fail-closed).

---

## 5. RLS / tenant isolation / authz

- [ ] Only **TenantAdmin** can mutate sessions; a non-admin receives **403** — routing is not authorization
      — src: `P AC#14`, `P E#12`; `T BE#10`, `T §3` (endpoints = TenantAdmin), `T U#17`, `T U#44` (publish)
- [ ] AuthZ middleware rejects a non-admin session command **before** the service — src: `T BE#10`, `T §4`
      (Security Checklist)
- [ ] `sessions` has RLS `ENABLE` + `FORCE`; a session from tenant A is not visible to tenant B — src:
      `T §2`, `T §4` (Security Checklist), `P §1·INV`; `T U#18`
- [ ] The public endpoint exposes **no** venue/roster/financial data — a separate public serializer applies
      a whitelist — src: `T BE#8`, `T §4` (Security Checklist), `P E#6`; `T U#19`
- [ ] `tenant`/`actor` are taken from **trusted context**, never from the request payload — src: `T §1`,
      `T §4` (Security Checklist → Injection/validation)
- [ ] Messenger wizard final consume re-authorizes `session.manage` + target tenant + snapshot **before**
      `SessionService` — src: `T §3` (Messenger create path), `T BE#20`, `T §4` (Security Checklist),
      `P §1·INV`
- [ ] Hybrid Page host matrix: an authorized host creates the correct tenant's session across central +
      tenant Page; non-admin and wrong-context are denied — src: `T I#7`

> Same-tenant **composite FK** tenant integrity (`(tenant_id, session_id)` → `sessions`,
> `(tenant_id, membership_id)` → `memberships`, `session_surface_refs` same-tenant) has landed separately in
> `0019` (DD-68). This is DB substrate only; it does not implement SessionService, admission or channel
> booking behaviour.

---

## 6. Audit / analytics / observability

- [ ] Host announces a session to the linked group; **exactly one** canonical announcement reference is
      stored in the DB — src: `P UC-3`; `T §4` (`session.announcement_requested`)
- [ ] An announcement send failure does **not** roll back the canonical write; the projector
      retries/reprojects (reproject works after a provider failure) — src: `P AC#13`, `P E#10`; `T BE#9`,
      `T U#20`, `T I#4`
- [ ] Public/private/closed **projection behaviour** is correct: changing a session **to private**, and
      **closing** it, remove it from public search — the privacy-critical direction per `P E#8`
      ("Visibility private → remove projection: immediate remove from public search"), `P AC#11` and
      `P UC-5`/`P UC-10` — src: `P AC#11`, `P E#8`, `P UC-5`, `P UC-10`; `T U#10` ("Public → private removes
      projection"), `T U#19`. (The **positive** direction — a public session **materialising into** public
      discovery search — is owned by `feature_marketplace_discovery` per `T §4` caching note, not this spec;
      here `AC#11` covers projection **removal** + the public-serializer whitelist.)
- [ ] Projector failure is recovered via **outbox retry** — canonical state is already committed (no data
      loss) — src: `T BE#9`, `T §1`/`§4` (outbox), `T I#4`
- [ ] Each lifecycle transition emits its analytics event with the minimal payload — `session_created`,
      `session_published`, `session_updated`, `session_announced`, `session_closed`, `session_cancelled`,
      `session_projection_failed` — src: `P §5·EV`
- [ ] Analytics **never** logs roster names, venue details, or contact info — src: `P §5` (note)
- [ ] Outbox events carry identifiers + safe changed fields only; projectors reload canonical data for
      sensitive rendering — src: `T §1`, `T §4` (Events)
- [ ] A privileged correction on a closed/cancelled/past session is recorded with an **audit trail** — src:
      `P E#11`
- [ ] The retry owner alert/digest is **unique per root** and aggregates server-side counts/reason classes
      without PII/amount/venue; terminal review is a separate root-state alert — src: `T §4·WP`
      (`promotion_retry_jobs` RLS paragraph)

---

## 7. Definition of Done — test plan (Tech §5)

_The concrete DoD, preserved in the spec's own Unit/Integration structure. This section **is** the source
test inventory: each row's `U#n` / `I#n` label **is** its `src:` pointer — the row is `T §5 U#n` (unit) or
`T §5 I#n` (integration) by that id, which the §0–§6 area rows cite. Passing all of them is the tech spec's
stated bar._

### Unit tests (`T §5`)

- [ ] `U#1` Create session valid → session created, event emitted
- [ ] `U#2` Create invalid time (`ends_at <= starts_at`) → `INVALID_TIME_RANGE`
- [ ] `U#3` Create inactive sport → `SPORT_INACTIVE`
- [ ] `U#4` Update with stale `version` → `STALE_VERSION`
- [ ] `U#5` Reduce capacity below active roster → `CAPACITY_BELOW_ROSTER`
- [ ] `U#6` Price change with existing charges, no policy → `PRICE_CHANGE_REQUIRES_POLICY`
- [ ] `U#7` Cancel with paid roster, no review → `CANCEL_REQUIRES_REVIEW`
- [ ] `U#8` Close already-closed → no-op success
- [ ] `U#9` Public without discovery fields → `MISSING_DISCOVERY_FIELDS`
- [ ] `U#10` Public → private removes projection → event emitted (removed from public search) — matches
      `P E#8` / `P AC#11` / `P UC-5` / `P UC-10`
- [ ] `U#11` Concurrent first-entry join last slot → one `active` + exactly one charge; one `waitlisted`
      (positive position, no charge)
- [ ] `U#12` Concurrent web/chat edit → one success, one `STALE_VERSION`
- [ ] `U#13` Command dedup (same `commandId`) → previous result
- [ ] `U#14` DST timezone boundary → correct UTC calculation
- [ ] `U#15` Recurrence idempotency (generate twice) → same occurrences, no duplicates
- [ ] `U#16` Mutation on cancelled session → `SESSION_NOT_OPEN`
- [ ] `U#17` Non-admin create → 403
- [ ] `U#18` Tenant isolation → session of tenant A not visible to tenant B
- [ ] `U#19` Public serializer whitelist → no venue/roster/financial data
- [ ] `U#20` Announcement retry → retry succeeds, no duplicate message
- [ ] `U#21` First-entry join full → `waitlisted`, positive position, no charge/venue/capacity
- [ ] `U#22` Leave opens slot (one eligible first-activation candidate) → promote + clear position + one
      charge atomically
- [ ] `U#23` Capacity 7→12, active=7, live holds=1, six eligible → fill exactly 4 admission slots in total
      order
- [ ] `U#24` Capacity finite→NULL, eligible + banned → promote all eligible; banned stay waitlisted
- [ ] `U#24a` Public + unlimited through API/direct SQL → service rejects
      `MISSING_DISCOVERY_FIELDS`; `sessions_public_capacity_chk` rejects direct write; private+NULL control
      succeeds
- [ ] `U#24b` Public+NULL compatibility/bypass row enters any admission branch → fail-closed, never treat as
      unbounded; zero candidate/finance mutation + audit/review
- [ ] `U#25` Capacity below active, then between active and active+live-holds →
      `CAPACITY_BELOW_ROSTER` / `CAPACITY_BELOW_OCCUPANCY`; no mutation or hold cancellation
- [ ] `U#25a` Paid-unlinked candidate reaches promotion head → one 15-minute hold, stays
      waitlisted/no venue/no charge, selector excludes the live hold
- [ ] `U#25b` Promotion hold expires → release slot + requeue-tail exactly once + continue selector;
      duplicate expiry no-op
- [ ] `U#26` Candidate ineligible (first fails DD-41) → skip first, promote next, first keeps position
- [ ] `U#27` Promotion retry (same `commandId` twice) → same result, no double charge/promotion
- [ ] `U#28` Rejoin after left, paid not refunded → **re-activate/waitlist per capacity**; carry-over same
      obligation/allocation; no duplicate financial row
- [ ] `U#29` Rejoin after full refund → capacity: append one lifecycle + active; full: waitlisted, no new
      lifecycle/venue; no duplicate charge row
- [ ] `U#30` Rejoin disposition unknown → `REJOIN_REQUIRES_REVIEW`; player/charge/allocations byte-for-byte
      unchanged
- [ ] `U#31` Promotion rejoin disposition → re-derive; carry-over or append refunded lifecycle; activate +
      clear position; no duplicate charge row
- [ ] `U#31a` Promotion charge conflict (missing/malformed live DD-49) → not promoted; audit + owner-review;
      next may fill slot
- [ ] `U#32` Promotion amount derivation fails (KMS/decrypt throws) → candidate unchanged; one candidate
      audit event on lazy root; opener committed; next may fill; no fallback
- [ ] `U#33` Derivation retry after slot filled (same `promotion_retry_id`, capacity full) → resolve root
      job no-op; no promotion/charge; candidates keep rank
- [ ] `U#33a` Persistent derivation failure (same root completes claimed attempts 1..3) → backoff + durable
      claimed-attempt count; sibling events do not fork jobs/root digest; completed attempt 3 → terminal
      owner-review/DLQ
- [ ] `U#33b` Retry succeeds (sweep ≤3, capacity remains) → canonical selector promotes in order; root
      resolves when no failure remains/capacity fills; event redelivery no-op
- [ ] `U#33c` Stale candidate event (player re-enters with incremented `waitlist_entry_version`, old event
      redelivered) → alert-dedupe only; cannot drive promotion or resolve the root
- [ ] `U#33d` Candidate no longer applicable during sweep (left/active, DD-41 ineligible, DD-42 restricted or
      DD-52 banned) → skip with exact reason, continue; transition derives from the whole sweep
- [ ] `U#33e` Concurrent retry claim (two workers on one due/expired `promotion_retry_id`) → exactly one CAS
      winner + one sweep increment; loser does no domain work
- [ ] `U#33f` Worker crash before domain commit (lease expires before attempt 1/2 commit) → reclaim safe
      while count `<3`; claimed-attempt count never exceeds 3; no promotion/charge before commit
- [ ] `U#33g` Worker crash after success (promotion + job transition committed) → redelivery/reclaim observes
      persisted state; no second charge/promotion
- [ ] `U#33h` Reorder after failure (DD-42 deprioritize moves A behind B before retry) → root sweep re-enters
      current selector; A cannot bypass B; no out-of-order charge/promotion
- [ ] `U#33i` Manual ban after failure (DD-52 imposed after event, before retry) → shared
      `evaluateJoinRestriction()` skips candidate; no active/charge/venue
- [ ] `U#33j` Two candidates fail in one opener (unique events → one `promotion_retry_id`; two
      workers/redeliveries) → one CAS sweep job, one shared counter ≤3; each derived at most once/sweep;
      events/commands cannot multiply attempts N×N
- [ ] `U#33k` Failure then final slot fills (A fails, later B succeeds and fills last capacity) → A alert
      event stays durable, root commits `resolved`, no worker may claim; next genuine opener uses a new root
- [ ] `U#33l` Stale claimant resumes (A lease expires, B reclaims next generation/token, A resumes) → A fails
      token/lease fence, makes zero selector/domain/job change; only B may sweep; total sweep count ≤3
- [ ] `U#33m` Opener/worker lock order (worker claimed job while a new capacity opener starts) → CAS claim
      commits job-only; both domain paths lock `session→job→candidate/finance`; no deadlock; superseded token
      cannot mutate
- [ ] `U#33n` Old root across capacity epochs (J1 due; direct active join fills slot; later leave creates
      opener J2) → fill resolves J1 under session lock; J2 supersedes any older nonterminal root; partial
      unique holds
- [ ] `U#33o` Three pre-domain crashes exhaust claims (attempts 1..3 claim then expire before domain commit)
      → finalizer locks `session→job`, rechecks exact expired claim; resolved or terminal+owner-review/DLQ;
      no stuck `claimed`, derivation, mutation or attempt 4
- [ ] `U#33p` Initial opener after start (session already started/past; leave/capacity edit would expose a
      slot) → no candidate lock/promotion/charge; under `session→job`, resolve every nonterminal root as
      no-longer-applicable
- [ ] `U#33q` Cancel / price-capacity update vs claimed worker (paid roster + claimed root; concurrent cancel
      or update) → both use `session→root→roster/finance`, no deadlock; review-required abort leaves root
      unchanged; successful close/cancel/full-capacity outcome resolves it
- [ ] `U#33r` DD-45a future migration duplicate fence → dirty preflight HALTs/manual with zero
      auto-renumber; clean migration adds partial unique and rejects duplicate insert; gaps remain valid
- [ ] `U#34` Direct active join amount derivation fails → aborts; no player/charge/venue; no fallback;
      retry-safe
- [ ] `U#35` Messenger host create parity (central / tenant Page / web) → same command/service result and
      canonical session shape
- [ ] `U#36` Messenger wizard lifecycle (cancel/expire/context-switch/wrong actor/Page/stale) → deny/clear;
      zero sessions created
- [ ] `U#37` Messenger duplicate confirm (action/webhook/`commandId` replay) → exactly one session/outbox
      sequence; previous result returned
- [ ] `U#38` Negative base price (API or migration fixture) → DB CHECK rejects; no session/outbox mutation
- [ ] `U#39` Live skill-level upgrade (non-null `sessions.skill_level`) → value preserved; public
      projection/filter valid until DD-41 ranked-field contract completes
- [ ] `U#40` Publish `draft`→`open` (Host, `starts_at > now()`) → `status='open'`, `version` bumped, exactly
      one `session.published` event; `visibility` unchanged
- [ ] `U#41` Re-publish already-`open` (`commandId` replay or new `commandId`, actor still holds
      `session.manage` and tenant not billing-suspended) → no-op success; no duplicate `session.published`;
      `status`/`version`/`visibility` unchanged. Authz/billing win over the no-op — same replay from an actor
      who lost `session.manage`, or a now-`suspended` tenant, still gets 403 (`U#44`/`U#46`), not a no-op
- [ ] `U#42` Publish `public` `draft` missing discovery fields → `MISSING_DISCOVERY_FIELDS`; zero mutation
- [ ] `U#43` Publish `closed`/`cancelled`, or `draft` with `starts_at <= now()` → `SESSION_NOT_OPEN`; zero
      mutation
- [ ] `U#44` Non-admin calls publish → 403; AuthZ rejects before service; zero mutation
- [ ] `U#45` Publish `draft` with stale `expectedVersion` (concurrent edit bumped it) → `STALE_VERSION` (409)
      on the mutation path; zero mutation
- [ ] `U#46` Publish while tenant billing-`suspended` (static case) → fail-closed `TENANT_SUSPENDED` (403);
      `status` stays `draft`; zero mutation. Competing-writer race is billing test #36 / #36a
      (`feature_billing_lifecycle_tech.md` §5)
- [ ] `U#47` Re-publish already-`open` with a stale `expectedVersion` → no-op success (idempotency wins over
      `STALE_VERSION`); zero mutation
- [ ] `U#48` Publish `commandId` reused for a different resource/payload → handled by the canonical
      `processed_commands` dedup (edge #3), not special-cased; collision-safety strengthens to
      `IDEMPOTENCY_CONFLICT` once the canonical `request_hash` migration lands (Session Organize plan,
      cross-feature — not asserted here)
- [ ] `U#49` Host discards verified-empty draft → `cancelled`, version bump, exactly one manual-cancel event
- [ ] `U#50` Non-admin discards draft → 403 before service; zero mutation
- [ ] `U#51` Draft was concurrently published; old `expectedVersion` discard → `STALE_VERSION`, zero mutation
- [ ] `U#52` Discard `closed` session → `SESSION_NOT_OPEN`, zero mutation
- [ ] `U#53` Discard already-`cancelled` → no-op; no duplicate event; no version match required
- [ ] `U#54` Auto-expiry verified-empty past draft → `cancelled`, `cancel_reason='auto'`, exactly one event
- [ ] `U#55` Auto-expiry leaves future draft and open past session untouched
- [ ] `U#56` Overlapping auto-expiry runs → one `SKIP LOCKED` winner, exactly one transition/event
- [ ] `U#57` Auto-expiry vs publish race → deterministic first-lock winner; no double transition
- [ ] `U#58` Omitted `expectedVersion` on a real discard mutation → `STALE_VERSION`, zero mutation
- [ ] `U#59` Draft with roster/charge anomaly on host discard → `CANCEL_REQUIRES_REVIEW`; stays draft;
      anomaly event written
- [ ] `U#60` Auto-expiry detects anomalous draft on two ticks → row stays draft; one anomaly event per
      detection; no cancel event; notification dedupe belongs to consumer
- [ ] `U#61` Cancel `open` session after start → `SESSION_NOT_OPEN`; draft-only no-past guard did not leak

### Integration tests (`T §5`)

- [ ] `I#1` Full CRUD lifecycle (create → update → close) → state transitions correct
- [ ] `I#2` Chat + web same service (Zalo/Messenger create → web edit) → same session, consistent state
- [ ] `I#3` Recurrence generation (create rule → generate) → occurrences match timezone
- [ ] `I#4` Outbox → projector delivery → event delivered, projection updated
- [ ] `I#5` Concurrent leave + join last slot → lock order preserves capacity; one canonical outcome, no
      double charge
- [ ] `I#6` Leave + first-activation candidate KMS failure → leave commits; first unchanged + one
      audit/origin event; second may promote; bounded retries happen separately
- [ ] `I#7` Hybrid Page host matrix (central + tenant Page; host/player/dual-role across two tenants) →
      authorized host creates correct tenant session; non-admin/wrong-context denied
- [ ] `I#8` Auto-expiry + host discard across tenants → manually discarded row is not re-claimed; remaining
      due drafts cancel once; RLS isolation holds

---

## 8. Source coverage ledger

_Proof that every acceptance-criterion / DoD inventory item in both specs is mapped to a traceable row
above. "Mapped in" points to the section(s) that carry it._

| Spec inventory | Count | Mapped in | Uncovered |
| --- | --- | --- | --- |
| `P §1·INV` invariants | 6 | §0 (verified across §1–§6) | 0 |
| `P §2` use cases `SES-UC-1..14` | 14 | §1 (1,4,5,6,7,10,11,12,13,14), §2 (8,9), §4 (2), §6 (3) | 0 |
| `P §2` edge cases `#1..#26` | 26 | §1 (1,2,5,7,11,15–24), §2 (4,6,13,14), §3 (3,4,25,26), §4 (9), §5 (12), §6 (8,10) | 0 |
| `P §5·EV` analytics events | 7 | §6 | 0 |
| `P §6` acceptance criteria `AC#1..#29` | 29 | §0 (1), §1 (2–4,10,15–29), §3 (5–7,9), §2 (8), §4 (12), §6 (11,13), §5 (14) | `AC#4` timezone-**input** branch → §9-A (spec-unpinned); `AC#11` public-**materialise** branch → §9-B (cross-feature, `feature_marketplace_discovery`); rest 0 |
| `T §2` backend edge cases `BE#1..#31` | 31 | §1 (2–5,11,12,20–31), §2 (8,17), §3 (1,13–19), §4 (6,7), §5 (10), §6 (9) | 0 |
| `T §3` error codes | 11 | §1, §3, §5 (each code cited at its row) | 0 |
| `T §5` unit tests `U#1..#61` (incl. `#24a/b`, `#25a/b`, `#31a`, `#33a–r`) | 84 | §7 (all) + cited in §1–§6 | 0 |
| `T §5` integration tests `I#1..#8` | 8 | §7 (all) + cited in §1–§6 | 0 |

Every current Product v2.17 / Tech v2.18a acceptance and DoD row is mapped. The four historical
source-spec inconsistencies (`T §5 U#10` projection direction, `0014` status, create-result-status, and
public × unlimited-capacity) remain reconciled. `P AC#4`'s malformed-timezone-input case and recurrence-edit
granularity remain §9-A gaps. DD-45a is now decision-final but its migration is deferred; DD-32 hold/finalizer
objects are contract-only. These are recorded in §9-B, never presented as runtime.

---

## 9. Unresolved / needs spec (fail-closed)

_The specs explicitly leave these open or defer them out of their own acceptance body. They are recorded as
gaps — **not** resolved, guessed, or converted into acceptance criteria. This checklist stays behaviour-only
and does not pick any storage/API/mutation shape for them._

### A. Genuinely undecided (no clean acceptance criterion exists)

- [ ] **Recurrence edit granularity** — edit a single occurrence vs "this-and-future". `P §7 SES-OQ-2` =
      ⬜ **Chưa chốt (undecided)**. Partial coverage exists (`T §4·REC`: "edit rule → new version; past
      occurrences not rewritten"), but the per-occurrence-vs-series contract is undefined. **Needs spec
      before any recurrence-edit acceptance can be written.** — src: `P §7 SES-OQ-2`, `T §4·REC`
- [ ] **Timezone input validation** — `P AC#4` lists "Timezone … validations", but the specs pin timezone
      **handling** (IANA + DST correctness: `T U#14`/`U#15`, `T I#3`, `T §4·REC`), **not** rejection of a
      malformed timezone string as a discrete test. That input-validation case is **not** concretely
      specified, so it is recorded here rather than asserted as covered under `P AC#4`. — src: `P AC#4` vs
      `T §4·REC` / `T U#14`/`U#15`

### B. Decided-but-deferred — scope boundaries this checklist must not cross

- [ ] **DD-49 obligation storage/API shape** — `P §7 SES-OQ-1` is ✅ decided at behaviour level (carry-over /
      refunded / unknown), but "storage/API chờ design-probe". Behaviour is covered (§1/§2/§3); the storage
      and API shapes remain open and are **not** chosen here. — src: `P §7 SES-OQ-1`
- [ ] **Waitlist auto-promote — schema merged, behaviour unbuilt.** `0014_players_waitlist` (waitlist
      **schema only**) is merged on `main` at `1a6ac38` (verify tail hiện hành tại `packages/db/migrations/`,
      không hard-pin số). Current DB substrate also includes `0019` same-tenant integrity and `0024`
      public finite-capacity validation; only the **behaviour** (auto-promote, retry, DD-32 holds/finalizer)
      is unbuilt, so §3 remains a pre-build target. — src: `P §7 SES-OQ-3`, `T §6` (Rollout steps 2–4),
      `T §2`; `docs/standards/BUILD-STATUS.md`
- [ ] **DD-45a waitlist-position final fence — decided, migration unbuilt.** Owner-final contract requires a
      new monotonic migration with duplicate preflight HALT/manual, no auto-renumber, partial unique
      `(session_id, waitlist_position) WHERE status='waitlisted'`, valid gaps, and the existing three-key
      selector as compatibility/defense. `0014` remains permissive until that slice lands — src: `P`
      header/DD-45a; `T §2`, `T §4·WP`, `T U#33r`
- [ ] **DD-32 channel booking occupancy — contract authored, runtime unbuilt.** Session acceptance now
      includes active+unexpired-hold occupancy, capacity-decrease fail-closed, paid-unlinked promotion hold,
      verified-settlement activation and expiry requeue-tail. Storage and money truth stay owned by the
      Funnel/Identity/Payment specs; `channel_booking_intents`, account-link completion, shared occupancy
      helper, verified-payment finalizer and expiry integration do not exist in code — src: `P E#25/#26`,
      `P AC#5/#6`; `T BE#14–#16`, `T §4·WP`, `T U#23/#25/#25a/#25b`;
      `feature_channel_booking_funnel_tech.md`
- [ ] **Draft-anomaly owner-alert consumer mechanism.** Behaviour is pinned by `P AC#28`: repeated
      anomaly events coalesce per session and must not spam. Exact consumer/storage/notification mechanism
      remains a build-slice choice; it must satisfy the testable §1 row and cannot weaken append-only event
      truth in `T U#60` — src: `P AC#28`; `T BE#28`, `T §4` (Events/Draft cleanup)
- [ ] **Session description fields + gating (DD-41)** — `P §7 SES-OQ-4` is ✅, but the field-level detail
      (title/notes/`session_type`/byoe/cost_shared + level-rank/gender/age gating, 9 codes) lives in
      `dd-41-session-fields-gating-analysis.md`, outside these two specs; body/schema "propagate lúc build".
      These two specs reference DD-41 as a promotion/entry re-check (§2/§3) **and** for live
      `sessions.skill_level` preservation through an expand→contract migration (`T §2`, `T U#39` — value +
      public projection/filter stay valid until the DD-41 ranked-field contract completes). — src:
      `P §7 SES-OQ-4`, `T U#39`
- [ ] **Reliability / no-show (DD-42)** — `P §7 SES-OQ-5` ✅, per-tenant, build **P4+**; detail in
      `dd-42-reliability-analysis.md`. Referenced only as a promotion/entry re-check (§2/§3). — src:
      `P §7 SES-OQ-5`
- [ ] **Membership tags / announce audience (DD-43)** — `P §7 SES-OQ-6` ✅, notification audience only,
      build **P4+**; detail in `dd-43-membership-tags-analysis.md`. Outside these specs' acceptance body. —
      src: `P §7 SES-OQ-6`
- [ ] **Invite-link token (DD-44/DD-52)** — `P §7 SES-OQ-7` ✅; detail in `dd-44-invite-token-analysis.md`.
      These specs reference DD-52 only as the shared join-restriction re-check (§2/§3). — src:
      `P §7 SES-OQ-7`
- [ ] **Data retention / deletion contract (unpinned)** — `T §4` Security Checklist (`Data retention/xoá`)
      states this is **not pinned** in these specs ("Chưa pin trong doc này — theo
      `feature_security_operations_tech.md`"). Recorded as an unpinned cross-feature dependency; no
      retention/deletion acceptance is asserted here. — src: `T §4` (Security Checklist)
- [ ] **Public discovery projection — positive materialisation (cross-feature).** `P AC#11`'s
      public/private/closed projection includes a public session **appearing in** public search. That
      **positive** materialisation is owned by `feature_marketplace_discovery` (`T §4` caching note: "Public
      discovery projection | Thuộc `feature_marketplace_discovery_tech.md`"), **not** these specs — here
      `AC#11` covers projection **removal** (private/close) + the public-serializer whitelist (`T U#19`).
      Recorded as a cross-feature dependency; not asserted here. — src: `P AC#11`, `T §4` (Caching Strategy)

---

## Result — complete

Every current Product v2.17 and Tech v2.18a acceptance/DoD line maps to a traceable row: 6 invariants,
14 use cases, 26 Product edges, 7 events, 29 Product ACs, 31 BE edges, 11 error codes, 84 unit-test rows and
8 integration-test rows. Re-verified on disk against the uncommitted working tree over
`main@784bc8dd297163a5ec5415f33beabbbf34bbc8d7`; this is not an immutable authority pin.

Historical inconsistencies remain closed: create=`draft`/publish=`open`; public sessions require finite
capacity; `0014` is merged schema-only; public→private removes projection. The v1.2 retrace also closed two
DD-32 residual prose drifts in Tech v2.18a: capacity decrease now guards active+live-hold occupancy, and
projector parity explicitly separates public `confirmed_count=active` from `slots_open=capacity-active-holds`
without exposing hold count/identity.

§9-A now contains only genuine source gaps: recurrence edit granularity and malformed-timezone-input
validation. DD-45a is no longer open; its final fence is decision-final/deferred in §9-B. Other §9-B entries
remain explicit contract/runtime boundaries: DD-49 storage/API, auto-promotion runtime, DD-32
intent/hold/account/finalizer runtime, DD-41/42/43/44 details, retention, and marketplace positive
materialisation. DB integrity `0019` is landed substrate and therefore no longer listed as a deferred
prerequisite.

Publish (`UC-12`, edges 16–19, AC15–20, tests 40–48), draft cleanup (`UC-13/14`, edges 20–24, AC21–29,
tests 49–61/I8), DD-45a (`U#33r`) and DD-32 occupancy/promotion-hold coverage (`E#25/26`,
`U#23/#25/#25a/#25b`) are all folded into the ledgers above. This is **spec-level traceability only**:
SessionService, waitlist behaviour, booking intents, payment finalizer and adapters remain unbuilt.

**Overall result: SESSION_MGMT_CHECKLIST_COMPLETE** — every stated acceptance criterion is source-traced and
open spec questions are quarantined in §9. This marker proves traceability coverage only, **not** build
authorization: session runtime remains a separate, risk-classified slice.

---

## Readiness closure matrix

| # | Closure item | Result |
|---:|---|---|
| 1 | Exact Product + BE source files identified | PASS |
| 2 | Product inventory fully traced | PASS |
| 3 | BE edge/error inventory fully traced | PASS |
| 4 | Unit/integration inventory fully traced | PASS |
| 5 | DD-32 delegated branches point to owning Funnel tests | PASS |
| 6 | DB substrate verified against live migrations | PASS |
| 7 | In-scope Product questions closed | FAIL — recurrence edit granularity + malformed-timezone input remain |
| 8 | Hard Session/Identity/Payment dependencies merged | FAIL |
| 9 | Exact migration/rollback packets authored | FAIL |
| 10 | Exact implementation artifacts and first slice | FAIL |
| 11 | Security/RLS/fail-closed acceptance specified | PASS |
| 12 | Immutable reviewed authority | PASS — pack committed at `adf5eff5c079622bfede1f1aaf40edd556e421ce` (2026-07-29) |

```text
REVIEW_POLICY_VERSION: 1.3
REVIEW_VERDICT: NOT_CODE_READY
REVIEWED_AT: 2026-07-28
AUTHORITY_SHA: adf5eff5c079622bfede1f1aaf40edd556e421ce
BASE_BRANCH: main
TARGET_FILES:
  - docs/issues/session-management-acceptance-checklist.md
  - docs/features/feature_session_management.md
  - docs/features/BE/feature_session_management_tech.md
  - docs/features/feature_channel_booking_funnel.md
  - docs/features/BE/feature_channel_booking_funnel_tech.md
SLICE: session-management-acceptance-retrace
IN_SCOPE: source traceability for current Session Product and BE contracts including DD-32 occupancy and promotion holds
OUT_OF_SCOPE: runtime implementation migrations provider enablement and choosing unresolved recurrence or timezone behavior
G1_DECISION: FAIL
G2_SPEC: PASS
G3_DEPENDENCY: FAIL
G4_TEST: PASS
G5_SCOPE: FAIL
G6_EXTERNAL: ENABLEMENT_ONLY:meta-app-review,zalo-login-verification,instant-settlement-provider-evidence
HARD_DEPENDENCIES: Session Join Waitlist Identity WebAuth Payment and channel booking cores are not all implemented and merged
PRIOR_SLICES: exact mechanism packets must be authored after immutable authority and dependency verification
OPEN_QUESTIONS_IN_SCOPE: 2
ENABLEMENT_ONLY_GATES: Meta App Review; Zalo Login verification; instant-settlement provider evidence
LIVE_REPO_VERIFICATION: PASS
CONTRACT_MATRIX: PASS
CLOSURE_MATRIX: FAIL
ACCEPTANCE_MATRIX: PASS
SECURITY_AND_MIGRATION_GATE: FAIL
IMPLEMENTATION_ARTIFACTS: FAIL
FIRST_IMPLEMENTATION_STEP: author the first mechanism-sized prerequisite packet; the commit-and-re-pin step is done at adf5eff
REMAINING_BLOCKERS:
  - blocker: recurrence edit granularity and malformed-timezone input behavior remain unresolved for the whole Session feature
    owner: Product and Session architecture owner
    resolution: both behaviors are decided in canonical specs or explicitly excluded from a bounded implementation slice
  - blocker: hard business cores and exact migration implementation packets are absent
    owner: Session Identity and Payment architecture owners
    resolution: every named dependency has a merged probe and each mechanism-sized packet pins exact files lock order rollback and acceptance tests
NEXT_REVIEW_TRIGGER: bounded first-slice packet plus merged hard-dependency probes; the immutable-authority condition is closed at adf5eff
```

**Binary verdict:** `NOT_CODE_READY`. Traceability is complete; code authorization is not.

---

## Changelog

| Date | Version | Thay đổi |
| --- | --- | --- |
| 2026-07-29 | v1.4 | **Authority pack committed — row 12 closes; và sửa một `AUTHORITY_SHA` sai.** Bản v1.3 khai `AUTHORITY_SHA: 2dc9b8c` trong khi artifact anh em `dd-32-booking-funnel-analysis.md` cùng phiên khai `784bc8d` — hai artifact DD-32 bất đồng authority, và khối readiness này là **mới thêm** ở v1.3 (bản committed trước đó không có khối nào) nên `2dc9b8c` là giá trị chép sót, không phải pin lịch sử. Nay cả hai cùng pin `adf5eff5c079622bfede1f1aaf40edd556e421ce` — squash mang đúng 27-file Option D pack. Row 12 `FAIL` → `PASS`; blocker uncommitted-authority gỡ khỏi `REMAINING_BLOCKERS`; `FIRST_IMPLEMENTATION_STEP` và `NEXT_REVIEW_TRIGGER` bỏ điều kiện commit-and-re-pin. **Verdict giữ `NOT_CODE_READY`** — `OPEN_QUESTIONS_IN_SCOPE: 2` (recurrence edit granularity, malformed-timezone) cộng rows 8/9/10 vẫn FAIL, mỗi cái chặn độc lập. Pin-only, không đổi dòng contract nào. |
| 2026-07-28 | v1.3 | Re-pin on-disk retrace base to `main@784bc8d`; Chat docs-only commits after `2dc9b8c` do not close Session runtime dependencies or change `NOT_CODE_READY`. |
| 2026-07-28 | v1.2 | Full retrace from Product v2.13a/Tech v2.14c to Product v2.17/Tech v2.18a. Restore `U#24a/b` omitted by checklist v1.1 (its source baseline was 68, not 66), then add 16 source rows: draft cleanup U49–61/I8, DD-45a U33r and DD-32 U25a/b; update U23/U25 semantics. The checklist therefore gains 18 rows and now maps 6 INV / 14 UC / 26 P edges / 7 events / 29 AC / 31 BE edges / 11 errors / 84 unit / 8 integration. Add testable AC28 owner-alert dedupe, cite Funnel integration #1/#3/#8 for delegated DD-32 race/projection branches, reclassify DD-45a as decided-deferred, record DD-32 runtime dependencies and remove landed `0019` from deferred prerequisites. Reconcile Tech v2.18a capacity/projector drifts. Add `enforce` classification, 12-row closure matrix and canonical `NOT_CODE_READY` verdict; no runtime/schema authorization. |
| 2026-07-24 | v1.1 | **Publish-mechanics retrace** (`docs-session-acceptance-checklist-publish-retrace`): Sources pin bumped `P` v2.12b→v2.13a, `T` v2.13a→v2.14c. §9-B's "publish transition — decided-to-exist, mechanics deferred" bullet removed (no longer accurate — mechanics are authored and its 3 former hard dependencies are resolved at spec level) and replaced with traced coverage: 7 new §1 bullets (`SES-UC-12`, edges `#16–19`, `AC#15–20`), `T U#44` folded into the existing §5 non-admin bullet, `session_published` added to the §6 analytics-event bullet, 9 new §7 DoD rows (`U#40–48`). §8 ledger totals updated (use cases 11→12, edge cases 15→19, analytics events 6→7, AC 14→20, BE edge cases 20→24, error codes 9→10, unit tests 57→66); AC-numbering legend `1–14`→`1–20`. Feature-status migration-tail wording de-pinned to match `P`/`T`'s own de-pin sweep (tail no longer hard-pinned to `0018`). Result section's stale `0014`-status/§9-B cross-refs corrected; prior "Re-verified on-disk against `main@0dec63b`" (2026-07-23) marker preserved verbatim, this pass adds its own re-verification against `main@58788e6`. Pre-existing dated provenance preserved verbatim throughout; no new design question resolved; `AC#11` public-materialise cross-ref to `feature_marketplace_discovery` unchanged. |

<!-- SESSION_MGMT_CHECKLIST_CLOSED -->
