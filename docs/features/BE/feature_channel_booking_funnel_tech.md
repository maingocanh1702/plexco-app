# Channel-first Booking Funnel — Backend Technical Spec

> **Canonical phase:** P4.3 / P4.7 + Messenger P2.5
> **Version:** 1.2 · 2026-08-25
> **Status:** Reviewed contract · Implementation pending
> **Implementation:** Not started — live schema has no channel booking intent/payment hold/finalizer
> **Product spec:** `../FE/feature_channel_booking_funnel.md`
> **References:** `../../standards/decisions.md` DD-05/06/32/33/39/45/49/50/67 · `feature_cross_club_join_tech.md` · `feature_session_management_tech.md` · `feature_identity_tech.md` · `feature_web_auth_onboarding_tech.md` · `feature_payment_reconcile_tech.md`

---

## 1. Tổng quan triển khai

### 1.1 Pipeline

```text
Messenger/Zalo adapter
  → resolve exact endpoint-scoped ChannelIdentity
  → channelSessionSummary()                         # read-only/advisory
  → startChannelBookingIntent()                     # final CTA only
  → decideChannelBookingPath()                      # pure shared core
       free/full/approval → common Join service
       paid + linked      → common Join service, charge remains open
       paid + unlinked    → durable seat/payment hold
       unknown/blocked    → fail closed
  → account-link callback OR verified bank event
  → finalizeChannelBookingIntent()                  # single atomic writer
  → render opaque outcome
```

Adapters must not calculate fee, capacity, linked state, payment result or waitlist order. They pass opaque action IDs to shared services and render the returned tagged outcome.

### 1.2 Entry points

| Entry | Caller | Mô tả |
|-------|--------|-------|
| `channelSessionSummary()` | Messenger/Zalo adapter | Read-only session listing for player |
| `startChannelBookingIntent()` | Adapter (final CTA) | Create durable booking intent |
| `decideChannelBookingPath()` | Internal (intent service) | Pure shared core: free/full/approval/paid path |
| `finalizeChannelBookingIntent()` | Account-link callback / bank event | Single atomic writer — settle intent |
| `POST /api/webhooks/:provider` | Bank provider | Verified payment event → finalizer |
| Hold expiry job (pg-boss) | System cron | Expire unpaid 15-min holds |
| Manual review queue | Admin dashboard | Inspect late/over/under payments |

### 1.3 Canonical truths

| Concern | Single source of truth |
|---|---|
| Booking/roster | `players` (`active|waitlisted|left`) |
| Approval | `join_requests`; `approved` remains approval truth even while fulfillment awaits payment |
| Account link | current `ChannelIdentity → Person ← Account` binding plus verified `account_identities` |
| Money | `bank_transactions → charges → payment_allocations` |
| Final interaction/seat hold | new `channel_booking_intents`; never presented as a player or charge |
| Admission capacity | one shared `getSessionOccupancy()` helper: active players + unexpired payment holds |
| Public/channel counts | one projector/helper output; adapters never derive `slots_max - slots_open` |

`channel_booking_intents` is an orchestration and reservation record, not a second booking ledger. Only a completed finalizer may create/return canonical player/charge/allocation refs.

### 1.3 Decision core

Inputs are server-resolved values only:

```ts
type ChannelBookingDecisionInput = {
  actor: ResolvedChannelActor;
  session: LockedSessionSnapshot;
  joinState: CanonicalJoinState;
  approvalState: CanonicalApprovalState;
  eligibility: EligibilityResult;
  restriction: JoinRestrictionResult;
  price: AuthoritativePriceQuote;
  linkedForDeferredPayment: boolean;
  instantSettlementCapability: SettlementCapability;
  occupancy: SessionOccupancy;
};
```

The exhaustive result union has no default/fall-through:

```ts
type ChannelBookingDecision =
  | { kind: "return_current"; outcome: CanonicalJoinOutcome }
  | { kind: "create_pending_request" }
  | { kind: "join_free" }
  | { kind: "join_linked_pay_later" }
  | { kind: "join_waitlist" }
  | { kind: "offer_link_or_pay_now"; quote: PriceQuote }
  | { kind: "require_link_or_web"; reason: "settlement_unavailable" | "price_unprovable" }
  | { kind: "reject"; reason: SafeJoinRejection };
```

### 1.4 Decision table

| State | Result |
|---|---|
| Existing active/waitlisted + replay | Return current canonical state; no gate/hold/payment |
| Eligibility/restriction/price not provable | Reject or require link/web; zero mutation |
| Open, free, available | Join active; no account/payment requirement |
| Open, free, full | Waitlist; no charge/hold/venue |
| Open, paid, linked, available | Join active + exactly-one open/partial/paid canonical charge; pay later |
| Open, paid, linked, full | Waitlist; no new charge |
| Open, paid, unlinked, available, verifier healthy | Create one 15-minute payment hold |
| Open, paid, unlinked, verifier unavailable | Do not issue QR; offer account link/web |
| Approval request not yet approved | Pending request only; no hold/payment/player/venue |
| Approved, free | Recheck then active or waitlisted |
| Approved, paid + linked | Recheck then active+charge or waitlisted |
| Approved, paid + unlinked | Available→hold; full→waitlisted |
| Promotion, free | Revalidate and activate |
| Promotion, paid + linked | Revalidate and activate + canonical charge |
| Promotion, paid + unlinked | Create 15-minute hold; candidate remains non-active and venue-hidden |

---

## 2. Database schema và edge cases

### 2.1 Live baseline

Live `main@784bc8dd297163a5ec5415f33beabbbf34bbc8d7` already has `persons`, `channel_identities`, `accounts`, `account_identities`, `link_codes`, `sessions`, `players`, `join_requests`, `charges`, `bank_transactions` and `payment_allocations`; the two commits after `2dc9b8c` are docs-only.

It does **not** have:

- a durable channel booking intent;
- a pre-player payment reference;
- a seat hold counted in admission capacity;
- an atomic verified-payment booking finalizer;
- Session/Join/Waitlist business runtime.

`charges.player_id` and `payment_allocations.charge_id` are required. Therefore pre-payment must not be represented by a fake `player.active`, a zero/temporary charge or an allocation without a charge.

### 2.2 New table: `channel_booking_intents`

One tenant-private table owns both account-link resume and the optional payment hold:

| Column/group | Contract |
|---|---|
| Identity | `id`, `tenant_id`, `session_id`, exact `channel_identity_id`, observed `person_id`; finalizer re-resolves current Person |
| Origin | `provider`, exact endpoint ref, `origin_command_id`, `origin_kind` (`direct|approval|promotion`) |
| State | `status ∈ awaiting_choice|awaiting_link|awaiting_payment|finalizing|completed|expired|cancelled|manual_review` |
| Quote | `amount_due`, `currency`, `price_fingerprint`, `session_version`; DB money representation follows canonical ledger |
| Link resume | unique `resume_token_lookup_hash`, `resume_expires_at`, `resume_consumed_at`; raw token never stored |
| Payment hold | `hold_expires_at`, unique deterministic payment-reference lookup hash, optional protected display code |
| Completion | `player_id`, `charge_id`, `bank_transaction_id`, `completed_at`, `terminal_reason` |
| Audit | `created_at`, `updated_at`, idempotency/request fingerprint |

Required constraints:

- same-tenant composite FK to session and every tenant-owned completion ref;
- one live intent per current channel identity/session;
- one payment reference for the full lifetime of the row;
- link token and payment fields exist only in their matching state;
- `awaiting_payment` requires authoritative quote, live hold expiry and payment reference;
- terminal rows cannot re-enter a live state;
- `completed` requires canonical player; paid-unlinked completion additionally requires charge + bank transaction;
- no raw PSID, Zalo `from.id`, OAuth token, link code, bank memo or account number.

### 2.3 RLS and grants

- `ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY`.
- No direct table grant to channel adapters, web route or provider worker.
- Narrow functions own start, resume, cancel, expire and finalise transitions.
- Every function derives tenant/session/channel/account from protected refs and current auth context; caller-supplied IDs are never authority.
- Global identity reads use the existing function-only identity plane. Tenant intent rows do not grant tenant roles a global-directory browse path.

### 2.4 Capacity helper

Exactly one helper is authoritative:

```text
confirmed_count = count(players where status='active')
held_count      = count(channel_booking_intents
                        where status='awaiting_payment'
                          and hold_expires_at > clock_timestamp())
occupied_count  = confirmed_count + held_count
slots_available = max(0, sessions.slots_max - occupied_count)
```

Join, approval fulfillment, promotion, hold creation and projector all call this helper under the session lock for mutation. Read projections are advisory and may lag; finalisation always rechecks live.

Waitlisted players are not occupied. An account-link-only intent does not occupy capacity. A payment event first observed before hold expiry may finish after expiry only if the durable ingest timestamp proves it arrived before the cutoff and the intent was atomically claimed; otherwise it is late.

### 2.5 Expiry and retention

- Payment hold TTL: exactly 15 minutes from DB `transaction_timestamp()` at successful hold creation.
- Resume token TTL: 15 minutes; it does not extend a payment hold.
- “Refresh status” never extends TTL.
- Expirer runs through shared job mechanics and the same transition function as traffic-path lazy expiry.
- Direct-book expired intents release capacity and become terminal.
- Promotion expiry releases capacity, audibly requeues candidate to the queue tail once, and immediately continues the canonical selector.
- Terminal rows retain opaque audit/ref fields for 180 days; secret/display payment material is removed at terminal. Retention policy must match privacy/financial audit requirements before migration is authored.

### 2.6 Migration and rollback

- Add a new monotonic migration after syncing the current tail; never edit applied migrations.
- Preflight all same-tenant FK candidates and existing Session capacity constraints.
- Add schema + narrow functions dark first; no adapter flag enabled.
- Rollback after data exists means flags OFF + preserve rows/functions needed for reconciliation. Do not blind-drop intent rows with received payments or audit evidence.
- Backfill is not applicable because the lifecycle is net-new; existing players/charges remain untouched.

### 2.7 Edge cases

| # | Group | Case | Required result |
|---:|---|---|---|
| 1 | Concurrency | Two users request last slot | One active/hold; second waitlisted |
| 2 | Concurrency | Duplicate postback/webhook | Same outcome, no duplicate mutation |
| 3 | Concurrency | Link and payment complete together | One finalizer wins; loser re-reads terminal/current state |
| 4 | Concurrency | Expirer races settlement | Ingest-before-expiry proof wins; otherwise expiry wins |
| 5 | Security | Wrong Page/OA replays intent | Generic reject; zero mutation |
| 6 | Security | Raw person/account/session ID in payload | Ignore/reject; resolve opaque ref server-side |
| 7 | Security | Link callback uses different logged-in account | Explicit impact screen; conflict-safe identity flow, never silent rebind |
| 8 | Data integrity | Person merged during intent | Re-resolve current binding; stale observed Person cannot authorise |
| 9 | Data integrity | Session/price/capacity changed | Requote/reconfirm or waitlist; no stale consent |
| 10 | Financial | Exact payment | Atomic player + charge + allocation; active |
| 11 | Financial | Overpayment | Allocate only amount due, confirm booking, leave remainder unallocated/manual review |
| 12 | Financial | Underpayment | No active; hold remains until TTL, then manual review; v1 has no automatic top-up accumulation |
| 13 | Financial | Late/wrong-code/wrong-currency | No revive; manual review/refund-or-credit |
| 14 | Financial | Provider says sent but ledger row absent | Not paid |
| 15 | Cross-feature | Existing `left` with prior money | DD-49 disposition decides quote/carry/append; unknown→review |
| 16 | Cross-feature | Approval revoked before payment | Cancel hold; later payment manual review |
| 17 | Cross-feature | Restricted while hold live | Finalizer cancels/fails closed; payment manual review |
| 18 | Infra | Verifier unhealthy or entitlement absent | No QR/hold; link/web fallback |
| 19 | Delivery | Hold committed, channel send definitely rejected | If zero delivery/evidence and cancellation wins the intent lock: cancel + release; otherwise return current state |
| 20 | Delivery | Channel send times out/ack is ambiguous | Keep hold until TTL; expose resume/status through fresh inbound or authenticated web |

---

### Query Patterns

```sql
-- getSessionForBooking (public projection)
SELECT ps.session_id, ps.sport_key, ps.starts_at, ps.ends_at,
       ps.area, ps.price, ps.slots_open, ps.join_policy,
       ps.club_display_name
FROM public_sessions ps
WHERE ps.session_id = $1;

-- checkPlayerEligibility (tenant-scoped)
SELECT p.id, p.status, p.person_id
FROM players p
WHERE p.session_id = $1
  AND p.person_id = $2;
```

## 3. API contract

### 3.1 Internal service interfaces

```ts
channelSessionSummary(actor, sessionRef): Promise<ChannelSessionSummary>
startChannelBookingIntent(actor, sessionRef, commandId): Promise<BookingGateOutcome>
chooseChannelBookingPath(actor, intentRef, choice, commandId): Promise<BookingGateOutcome>
resumeLinkedChannelBooking(accountContext, resumeToken): Promise<BookingGateOutcome>
recordVerifiedBookingPayment(bankTransactionRef): Promise<BookingGateOutcome>
finalizeChannelBookingIntent(intentId, trigger): Promise<CanonicalJoinOutcome>
expireChannelBookingIntent(intentId, originJobId): Promise<ExpiryOutcome>
```

All mutations require a canonical request fingerprint. Reusing the same command ID + same fingerprint returns the stored outcome; same ID + different fingerprint is a conflict.

### 3.2 Channel summary DTO

```json
{
  "sessionRef": "opaque",
  "title": "Cầu lông tối thứ Tư",
  "startsAt": "2026-07-30T12:00:00Z",
  "endsAt": "2026-07-30T14:00:00Z",
  "area": "Quận 3",
  "fee": { "kind": "exact", "amount": 120000, "currency": "VND" },
  "confirmedCount": 12,
  "slotsAvailable": 2,
  "joinPolicy": "open",
  "viewerState": "eligible"
}
```

The DTO never includes venue, roster, raw tenant/session/person IDs, debt or bank details. `fee.kind` may be `free|exact|range|profile_required`; only `free|exact` can enter finalisation.

### 3.3 Tagged outcomes

```ts
type BookingGateOutcome =
  | { kind: "active"; sessionRef: string; venue: SafeVenue; payment: PaymentSummary }
  | { kind: "waitlisted"; sessionRef: string; position: number }
  | { kind: "pending_approval"; requestRef: string }
  | { kind: "choose_link_or_pay"; intentRef: string; amount: Money }
  | { kind: "awaiting_link"; openUrl: string; expiresAt: string }
  | { kind: "awaiting_payment"; intentRef: string; paymentDisplay: SafePaymentDisplay; expiresAt: string }
  | { kind: "manual_review"; supportRef: string }
  | { kind: "reconfirm"; summary: ChannelSessionSummary }
  | { kind: "rejected"; code: SafeBookingError };
```

Provider adapters render this shared union. App-facing HTTP routes use the DD-60 `{data,error,meta}` envelope; provider webhook replies keep provider-required wire shape.

### 3.4 Rate limits

- Summary reads: 30/minute per exact channel identity + endpoint.
- Start/choice: 10/minute per actor, 30/minute per endpoint.
- Account-link issue: 5/hour per actor and 20/hour per IP/browser bucket.
- Payment refresh button: 6/minute; it only reads canonical state.
- Rate-limit denial occurs before creating intent/token/hold.

### 3.5 Error codes

`BOOKING_STALE`, `BOOKING_PRICE_CHANGED`, `BOOKING_FULL_WAITLISTED`, `BOOKING_LINK_REQUIRED`, `BOOKING_PAYMENT_UNAVAILABLE`, `BOOKING_PAYMENT_PENDING`, `BOOKING_HOLD_EXPIRED`, `BOOKING_REQUIRES_REVIEW`, `BOOKING_NOT_ELIGIBLE`.

External copy is generic where identity/payment enumeration is possible; logs contain opaque refs and reason codes only.


### Endpoints

| Method | Path | Auth | Mô tả |
|--------|------|------|-------|
| POST | `/api/booking/intent` | Channel identity | Tạo booking intent (browse → confirm gate) |
| POST | `/api/booking/confirm` | Channel identity (linked) | Confirm paid booking (pay-later) |
| POST | `/api/booking/hold` | Channel identity (unlinked) | Tạo 15-min payment hold |
| POST | `/api/booking/free-join` | Channel identity | Join free session |
| POST | `/api/booking/waitlist` | Channel identity | Join waitlist |
| POST | `/api/booking/approval-request` | Channel identity | Request approval join |
| GET | `/api/booking/status/:intentId` | Channel identity | Current booking status |
| POST | `/api/booking/handoff` | System | Create link handoff token |
| POST | `/api/booking/handoff/callback` | System | Link handoff completion callback |

> Mọi endpoint qua channel adapter (bot); không có user-facing REST.

### Error Codes

| Code | Error Code | Message | Trigger |
|------|-----------|---------|---------|
| 400 | `SESSION_FULL` | Hết chỗ | No slots available |
| 400 | `SESSION_CLOSED` | Buổi chơi đã kết thúc | Session ended |
| 400 | `HOLD_EXPIRED` | Chỗ giữ đã hết hạn | Payment hold TTL exceeded |
| 400 | `PAYMENT_INSUFFICIENT` | Số tiền không đủ | Underpay |
| 400 | `ALREADY_ACTIVE` | Bạn đã tham gia buổi chơi này | Duplicate join |
| 400 | `HANDOFF_EXPIRED` | Link đã hết hạn | Handoff TTL exceeded |
| 400 | `HANDOFF_CONSUMED` | Link đã được sử dụng | Single-use consumed |
| 400 | `PRICE_CHANGED` | Giá đã thay đổi, vui lòng xác nhận lại | Price delta detected |
| 400 | `CAPACITY_CHANGED` | Số chỗ đã thay đổi | Capacity delta detected |
| 403 | `RESTRICTED_PLAYER` | Không đủ điều kiện tham gia | DD-42 restriction |
| 429 | `BOOKING_RATE_LIMITED` | Quá nhiều yêu cầu | Per-user burst |
---

## 4. Chi tiết triển khai

### 4.1 Linked-for-deferred-payment predicate

The predicate is true only when all are true at finalisation:

1. exact active `channel_identities` row resolves to current canonical Person;
2. an active `accounts` row resolves to that same Person;
3. the account is **verified under the web-auth contract per DD-50** — phase-1 predicate (DD-50 amendment, owner 2026-08-25): **≥1 `account_emails` row with `verified_at IS NOT NULL`** (verified account email). Legacy `account_identities` rows do **NOT** qualify (Telegram-era writer only — DD-37). *(The former literal "at least one currently verified account identity" was pre-DD-37 wording drift, ruled superseded by the amendment.)*;
4. no merge/freeze/conflict state blocks the identity;
5. account/channel binding was established through verified auth or a fully consumed transactional link flow with explicit confirmation.

Provider equality, display-name equality and raw platform IDs never satisfy the predicate. A `link_code` is a linking mechanism, not an account tier; it qualifies only after it has bound the channel Person to a real verified Account.

### 4.2 Link/resume

- Bot issues a random high-entropy token; only a domain-separated lookup hash is stored.
- Token binds intent, channel identity, exact provider endpoint, action and expiry.
- Web user authenticates/creates account through Web Auth, then explicitly confirms the account↔channel binding.
- Identity service owns merge/claim and audit. Booking service receives only a consumed, server-verified result.
- Resume token is consumed once, then finalizer re-resolves identity and live session.
- Changed price/session version returns `reconfirm`; resume cannot silently reuse the old confirm.
- A different Page/OA requires its own explicit channel binding unless both exact channel identities already resolve to the same Account-backed Person.

### 4.3 Payment hold and settlement

- Hold creation locks session, expires stale holds, computes occupancy and quote, then inserts exactly one live intent.
- QR/payment instructions are emitted only after the insert commits.
- Adapter reports delivery disposition back to the funnel. A proven pre-delivery reject may call `cancelUndeliveredPaymentHold()`; it re-locks session+intent, requires no durable matching bank evidence/finalizer claim, then cancels and releases capacity. Timeout/unknown acknowledgment never cancels because the user may have received the instructions; the hold remains resumable until TTL.
- “Tôi đã thanh toán” polls; it cannot manufacture a bank transaction or allocation.
- Provider ingest commits canonical `bank_transactions` first. A separate job/event invokes finalisation after the ingest transaction ends; it must not call while holding a bank-row lock.
- An exact channel-booking reference is reserved from the generic name/date/amount matcher. Only the dedicated funnel job may claim/allocate that transaction; ambiguous routing fails closed to manual review.
- A safe match requires exact tenant/connector/currency/reference and a provable amount allocation.
- Exact or overpayment may cover the charge. Underpayment never activates in v1.

### 4.4 Atomic finalizer and lock order

Every entry point calls one finalizer. Fixed domain order:

```text
session
→ applicable promotion root/job
→ booking intent
→ current channel identity / canonical Person parent
→ membership / join request / player
→ charge
→ bank transaction
→ payment allocation
```

The payment worker claims a job in a short transaction, releases it, then enters this order. No path may lock a bank transaction and call back into Session/Join.

Under the locks, finalizer:

1. revalidates intent state/TTL/source;
2. re-resolves current Person and linked predicate;
3. re-runs eligibility/restriction/DD-49 disposition;
4. rechecks session status, price fingerprint and canonical occupancy;
5. invokes the common join mutation;
6. creates/reuses exactly one canonical charge;
7. for pay-now, allocates from the verified bank transaction up to amount due;
8. stamps the intent terminal and appends outbox/audit in the same transaction.

Unique constraints on player/session, charge/player/session, allocation keys and live intent are the final fences. Any unprovable value rolls back/fails closed.

### 4.5 Approval and promotion

- Approval and payment fulfillment are separate. `join_requests.status='approved'` is not overloaded with `payment_pending`.
- Approval first locks/revalidates request and session, then decision core chooses active/waitlist/hold.
- Promoted unlinked paid candidate remains `waitlisted` until payment settles; the intent alone holds capacity and venue stays hidden.
- Promotion expiry transaction marks intent expired, moves that candidate to a new tail position once, then creates/continues the canonical promotion root. Queue mutation is audited.
- A linked callback during a payment hold may convert the same intent to pay-later finalisation. Any later matching payment allocates idempotently to the resulting charge; it never creates a second player.

### 4.6 Late and exceptional money

- Bank event first ingested after expiry, session closure/cancel, invalid price or revoked approval cannot revive the booking.
- If exact/overpayment is late, retain transaction evidence and route owner-visible manual review for refund or credit under canonical money policy.
- Underpayment remains unallocated/manual review; no automatic “top-up” across multiple pre-charge bank rows in v1.
- Overpayment allocates only amount due and leaves the remainder unallocated for `/unmatched`.
- Reversal after activation follows Payment/Session correction policy; the adapter does not evict a player itself.

### 4.7 Caching

| Data | Cache? | Rule |
|---|---|---|
| Session browse summary | Short ≤15s allowed | advisory only; invalidate on session/player/hold event |
| Linked predicate | No cross-request positive cache | live resolve at finalisation |
| Price/capacity | No mutation-time cache | re-read under lock |
| Payment result | No adapter cache | canonical ledger read |
| Provider capability | ≤30s negative/health cache | stale/unknown disables pay-now |

### 4.8 Security checklist

- [ ] Opaque action refs; no raw IDs trusted from Messenger/Zalo.
- [ ] Exact Page/OA binding and current actor re-authorization on every mutation/replay.
- [ ] Link/resume token random, hash-at-rest, short TTL, action/actor/endpoint-bound and single-use.
- [ ] No raw provider/bank/token/PII in logs or analytics.
- [ ] No direct DML grants on intent/identity/ledger tables.
- [ ] Price/capacity/eligibility/payment fail closed.
- [ ] Venue only after active.
- [ ] Rate limits before durable issuance.
- [ ] Audit contains command, state before/after, action, outcome and reason.

---

## 5. Testing plan

### Unit/decision-table tests

1. free+unlinked+available → active;
2. free+full → waitlisted;
3. paid+linked+available → active+one charge;
4. paid+linked+full → waitlisted/no new charge;
5. paid+unlinked+healthy → hold/no player;
6. paid+unlinked+unhealthy → link/web/no hold;
7. pending approval → pending/no payment;
8. approved paid unlinked → hold;
9. unprovable price → fail closed;
10. restricted/ineligible → no hold;
11. current active/waitlisted replay → current state;
12. valid link predicate;
13. Account missing/identity unverified/person mismatch → predicate false;
14. exact payment → full settlement;
15. overpayment → paid charge + unallocated remainder;
16. underpayment → no active;
17. late/wrong-code/wrong-currency → manual review;
18. expired promotion → requeue tail once;
19. stale price/session → reconfirm;
20. privacy DTO excludes venue/roster/debt/raw IDs;
21. definite-undelivered payment display cancels/releases only with no evidence/claim;
22. ambiguous delivery keeps a resumable hold to TTL.

### Integration/concurrency tests

1. Two actors race final slot: active/hold count never exceeds capacity.
2. Duplicate channel command and duplicate bank webhook create one intent/player/charge/allocation.
3. Link callback races payment callback: one terminal booking, payment allocated at most once.
4. Expirer races pre-expiry durable ingest and post-expiry ingest at the boundary.
5. Approval revoked/restriction added while hold lives: no activation; payment manual review.
6. DD-49 left/refunded/not-refunded dispositions remain canonical.
7. Wrong Page/OA/account/browser replay returns generic reject with zero mutation.
8. Projection reports `confirmedCount` from active players and `slotsAvailable` from active+holds; final mutation ignores stale projection.
9. RLS/role tests prove adapters cannot select/write intent, identity or money base tables.
10. Provider outage hides pay-now while free and linked pay-later paths remain available.


### Testing Plan

#### Unit Tests

| # | Test | Input | Expected |
|---|------|-------|----------|
| 1 | Browse session → public summary | Valid session | Summary with aggregate counts |
| 2 | Linked paid confirm → active | Linked player, paid session | Active + charge |
| 3 | Unlinked pay-now → hold | Unlinked, paid | 15-min hold created |
| 4 | Hold expires → requeue | After 15 min | Requeued to tail |
| 5 | Free join → active | Free session, slot available | Active, no payment |
| 6 | Full session → waitlist | No slots | Waitlisted |
| 7 | Approval session → pending | Approval required | Pending request |
| 8 | Concurrent slot grab | 2 players, 1 slot | Exactly one active |
| 9 | Price changed during intent | Price delta | Reconfirm required |
| 10 | Capacity changed during intent | Capacity delta | Reconfirm required |
| 11 | Duplicate callback → idempotent | Same callback twice | Same outcome |
| 12 | Payment after expiry → reject | Late payment | No auto-book |
| 13 | Overpay → allocate due | Amount > charge | Allocate due, rest unmatched |
| 14 | Handoff single-use → reject 2nd | Same handoff code | HANDOFF_CONSUMED |
| 15 | Handoff expired → reject | Past TTL | HANDOFF_EXPIRED |
| 16 | Restricted player → reject | DD-42 restriction | RESTRICTED_PLAYER |
| 17 | Already active → idempotent | Same player, same session | Current state returned |
| 18 | Waitlist promotion → offer | Slot freed | 15-min offer created |
| 19 | Waitlist offer expires → requeue | After 15 min | Requeued to tail |
| 20 | Link callback + payment race | Simultaneous | One finalizer wins |

#### Integration Tests

| # | Test | Setup | Expected |
|---|------|-------|----------|
| 1 | Full linked flow | Browse → confirm → active | Player active + charge |
| 2 | Full unlinked pay-now flow | Browse → hold → payment → active | Player active after settlement |
| 3 | Link handoff flow | Create handoff → web binding → callback → resume | Booking resumed |
| 4 | Concurrent race conditions | 2 players, 1 slot, same time | Exactly one active |
---

## 6. Rollout plan

1. Land identity/account-link and Web Auth provider contract behind flags.
2. Land pure decision core.
3. Add intent schema/RLS/narrow lifecycle functions dark.
4. Land shared occupancy helper and update join/approval/promotion/projector consumers together.
5. Land verified-payment finalizer + late/manual-review handling.
6. Integrate approval and waitlist promotion.
7. Add account-link resume.
8. Add Messenger adapter, then Zalo adapter.
9. Run cross-transport sandbox E2E.
10. Enable per tenant only when provider/market/currency/consent/entitlement evidence is present.

Flags/kill switches are separate:

- `channel_booking_funnel`
- `channel_account_link`
- `channel_pay_now`
- `channel_booking_messenger`
- `channel_booking_zalo`

Disabling pay-now stops new holds but keeps finaliser/expiry/manual-review consumers running until every nonterminal intent settles. Disabling a provider never discards received bank transactions.

Metrics: funnel conversion, hold creation/expiry, settlement latency, over/under/late payments, manual-review value/age, link completion, requeue count, capacity conflicts, duplicate suppression and provider-health disablement. Alerts use opaque refs only.

### Changelog

| Date | Version | Thay đổi |
|---|---|---|
| 2026-08-25 | v1.2 | **Vá wording theo DD-50 amendment (owner 2026-08-25; bản vá được amendment xếp hàng cho phiên docs):** §4.1 predicate bước 3 — "verified Account" phase-1 = **≥1 `account_emails.verified_at IS NOT NULL`** (verified email theo DD-50), thay literal cũ "≥1 currently verified account identity" (wording drift trước DD-37; legacy `account_identities` không tính). Correction của quyết định đã chốt (mirror `decisions.md` DD-50 amendment), không phải quyết định mới. Không đổi các vế còn lại của predicate/pipeline. |
| 2026-08-10 | v1.1 | **A-grade upgrade:** thêm Entry points table (7 entries); bump version. Không đổi contract/pipeline model. |
| 2026-07-28 | v1.0 | Tạo BE companion cho DD-32 Option D: shared decision core, qualified Account link, durable intent/15-minute hold, occupancy helper, atomic finalizer, approval/waitlist/late-payment behavior, API/security/test/rollout contract. No runtime. |
