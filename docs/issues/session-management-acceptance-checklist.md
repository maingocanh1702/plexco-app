# Session Management — Acceptance Checklist (issue-ready, source-traced)

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
| **P** | `docs/features/feature_session_management.md` (Product / UX) | v2.12b · 2026-07-23 · **Reviewed** |
| **T** | `docs/features/BE/feature_session_management_tech.md` (Backend Tech) | v2.13a · 2026-07-23 · **Reviewed** |

- **Origin:** `docs/product/ROADMAP.md` → Next Actions **#3** ("Review/sign-off feature specs của phase sắp
  build; **chuyển acceptance criteria thành issue checklist**").
- **Feature status (both specs):** `Implementation: Not started` — migration `0014_players_waitlist`
  (waitlist **schema only**) is **merged on `main`** at `1a6ac38` (migrations `0000–0018`); the waitlist
  **behaviour** (auto-promote, retry) is still **unbuilt**. Both spec headers and `P §7 SES-OQ-3` state this
  (reconciled `P` v2.12b / `T` v2.13a, 2026-07-23; verified on-disk this slice), designating
  `docs/standards/BUILD-STATUS.md` as the implementation-status authority. This is a **pre-build** acceptance
  checklist. See [§9](#9-unresolved--needs-spec-fail-closed).

## How to read a row

`- [ ] <testable acceptance statement>  — src: <pointer(s)>`

**Pointer legend**

- `P §N` / `T §N` — section _N_ of that spec.
- `P §1·INV` — Product §1 "Bất biến" (invariants).
- `P UC-n` — Product §2 use case `SES-UC-n`.
- `P E#n` — Product §2 edge case #_n_.
- `P AC#n` — Product §6 acceptance criterion #_n_ (numbered 1–14, top→bottom).
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
- [ ] **Capacity is never exceeded** — concurrent join / capacity-change lock the session row — src:
      `P §1·INV`; verified §3 (`P AC#5`, `T BE#1`/`#14`)
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

- [ ] Host creates a one-off session (private/public) with all fields validated — src: `P UC-1`; `T U#1`.
      ⚠️ The **create result status** is a spec inconsistency (`P UC-1` "open" vs DDL/POST-example `draft` +
      `P §4` `draft → open` publish) — quarantined in [§9](#9-unresolved--needs-spec-fail-closed).
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

- [ ] Concurrent capacity/join operations cannot over-fill — the session row is locked (first-commit-wins)
      — src: `P AC#5`, `P E#4`; `T BE#1`/`#14`, `T U#11`, `T I#5`
- [ ] Two first-entry players joining the last slot concurrently: exactly one becomes `active` (+ exactly
      one charge), the other becomes `waitlisted` with a positive position and no charge — src: `P E#4`;
      `T U#11`
- [ ] Waitlisted players occupy **no capacity**, are never shown venue, and create **no charge /
      new-obligation** — src: `P AC#6`; `T §0` (DD-45/DD-49 contract), `T §4·WE`
- [ ] Waitlist rows satisfy the state-shape invariant: `status='waitlisted' ⇔ waitlist_position IS NOT NULL`
      and `waitlist_position > 0`; `active`/`left` carry no position — DB CHECK rejects violations — src:
      `T §2` (`players_waitlist_shape_chk`, `players_waitlist_position_positive_chk`), `T BE#13`
- [ ] Promotion first-activation creates **exactly one charge** (assert-no-charge, then a single insert,
      atomic with activation) — src: `P AC#6`; `T §4·WP` (step 9), `T U#22`
- [ ] A leave or capacity increase fills every available slot in total order
      (`waitlist_position, joined_at, id`); finite→unlimited fills every eligible candidate; a decrease
      below the active roster is rejected (`CAPACITY_BELOW_ROSTER`) with no evict / no mutation — src:
      `P AC#7`, `P E#3`; `T BE#15`/`#16`, `T ERR:CAPACITY_BELOW_ROSTER`, `T U#23`, `T U#24`, `T U#25`.
      ⚠️ Whether **finite→unlimited is allowed for a _public_ session** (`slots_max→NULL` vs `P E#7`
      requiring public `slots_max`) is unresolved — quarantined in
      [§9](#9-unresolved--needs-spec-fail-closed).
- [ ] Promotion re-checks `evaluateSessionEligibility()` (DD-41), DD-42 reliability and shared
      `evaluateJoinRestriction()` (DD-52) before resolving financial disposition — src: `T §4·WP`
      (steps 5, 8)
- [ ] A candidate failing a **DD-41** eligibility check is skipped, **keeps its position**, and promotion
      continues to the next — src: `T §4·WP` (step 5), `T U#26`. (DD-42 deprioritize → **tail** and DD-52
      ban → **skip** are distinct queue outcomes, covered separately below.)
- [ ] A waitlisted DD-49 rejoin candidate re-derives live disposition at promotion (carry-over **or** append
      refunded lifecycle), activates + clears position, with no duplicate charge row — src: `P AC#6`;
      `T §4·WP` (steps 5, 9), `T U#31`
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
      — src: `P AC#14`, `P E#12`; `T BE#10`, `T §3` (endpoints = TenantAdmin), `T U#17`
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
> `(tenant_id, membership_id)` → `memberships`, `session_surface_refs` same-tenant) is a documented **DD-68
> prerequisite** that is **not** in baseline `0014` and lands in a separate migration — see
> [§9](#9-unresolved--needs-spec-fail-closed).

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
      `session_updated`, `session_announced`, `session_closed`, `session_cancelled`,
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
- [ ] `U#23` Capacity 7→12, six eligible → promote exactly 5 in total order
- [ ] `U#24` Capacity finite→NULL, eligible + banned → promote all eligible; banned stay waitlisted
- [ ] `U#25` Capacity below active → `CAPACITY_BELOW_ROSTER`, no mutation
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

---

## 8. Source coverage ledger

_Proof that every acceptance-criterion / DoD inventory item in both specs is mapped to a traceable row
above. "Mapped in" points to the section(s) that carry it._

| Spec inventory | Count | Mapped in | Uncovered |
| --- | --- | --- | --- |
| `P §1·INV` invariants | 6 | §0 (verified across §1–§6) | 0 |
| `P §2` use cases `SES-UC-1..11` | 11 | §1 (1,4,5,6,7,10,11), §2 (8,9), §4 (2), §6 (3) | 0 |
| `P §2` edge cases `#1..#15` | 15 | §1 (1,2,5,7,11,15), §2 (4,6,13,14), §3 (3,4), §4 (9), §5 (12), §6 (8,10) | 0 |
| `P §5·EV` analytics events | 6 | §6 | 0 |
| `P §6` acceptance criteria `AC#1..#14` | 14 | §0 (1), §1 (2,3,4,10), §3 (5,6,7,9), §2 (8), §4 (12), §6 (11,13), §5 (14) | `AC#4` timezone-**input** branch → §9-A (spec-unpinned); `AC#11` public-**materialise** branch → §9-B (cross-feature, `feature_marketplace_discovery`); rest 0 |
| `T §2` backend edge cases `BE#1..#20` | 20 | §1 (2,3,4,5,11,12,20), §2 (8,17), §3 (1,13,14,15,16,18,19), §4 (6,7), §5 (10), §6 (9) | 0 |
| `T §3` error codes | 9 | §1, §3, §5 (each code cited at its row) | 0 |
| `T §5` unit tests `U#1..#39` (incl. `#31a`, `#33a–q`) | 57 | §7 (all) + cited in §1–§6 | 0 |
| `T §5` integration tests `I#1..#7` | 7 | §7 (all) + cited in §1–§6 | 0 |

Most acceptance criteria and DoD lines trace cleanly (the 2026-07-23 spec reconcile fixed the earlier
`T §5 U#10` projection direction + the `0014` status). **Two source-spec inconsistencies remain and block a
clean completion** — the **create result status** (`P UC-1` "open" vs `draft` default + `draft → open`
publish) and **public-session finite→unlimited capacity** (`P E#7` vs `T` unlimited) — both quarantined in
§9-A. `P AC#4`'s malformed-timezone-**input** case is likewise a §9-A gap. Items the specs themselves leave
open or defer are **not** counted as acceptance criteria here; they are recorded in §9.

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
- [ ] **`waitlist_position` uniqueness** — `T §4` "Open DD-45a (live truth, 2026-07-19)": the DDL carries
      **no** uniqueness on `waitlist_position`; equal `(position, joined_at)` rows are currently
      representable and pinned by `waitlist-invariants.test.ts` (deterministic `id` tie-break). Recommended
      hardening `UNIQUE (session_id, waitlist_position) WHERE status='waitlisted'` is **not decided/landed**.
      **Needs decision + migration before a position-uniqueness acceptance can be asserted.** — src:
      `T §4` (Open DD-45a), `T §2` (Migration: DD-45a "nếu chốt")
- [ ] **Timezone input validation** — `P AC#4` lists "Timezone … validations", but the specs pin timezone
      **handling** (IANA + DST correctness: `T U#14`/`U#15`, `T I#3`, `T §4·REC`), **not** rejection of a
      malformed timezone string as a discrete test. That input-validation case is **not** concretely
      specified, so it is recorded here rather than asserted as covered under `P AC#4`. — src: `P AC#4` vs
      `T §4·REC` / `T U#14`/`U#15`
- [ ] **Create result status — spec inconsistency (blocks completion).** `P UC-1` states create → "Session
      **open**", but the Tech DDL defaults `status='draft'` (`T §2`), the `T §3` POST example returns
      `"status": "draft"`, and `P §4`'s state machine defines a separate `draft → open` "Host publish"
      transition. Whether creating a session yields `open` directly or `draft` (needing a separate publish)
      is **not** consistently defined, so it cannot be certified without guessing. **Needs the specs to
      reconcile `P UC-1` against the `draft` default + `draft → open` publish step.** — src: `P UC-1` vs
      `T §2` / `T §3` (POST example) / `P §4`
- [ ] **Public session finite→unlimited capacity — unresolved interaction.** `T` supports a `finite→NULL`
      (unlimited) capacity change (`T BE#15`, `T U#24`), but `P E#7` requires a **public** session to carry
      `slots_max`. The specs do **not** say whether `finite→NULL` is rejected for public sessions (allowed
      only for private) or whether `P E#7` binds only at creation. **Needs the specs to pin the
      public-visibility × unlimited-capacity interaction.** — src: `T BE#15` / `T U#24` vs `P E#7`

### B. Decided-but-deferred — scope boundaries this checklist must not cross

- [ ] **DD-49 obligation storage/API shape** — `P §7 SES-OQ-1` is ✅ decided at behaviour level (carry-over /
      refunded / unknown), but "storage/API chờ design-probe". Behaviour is covered (§1/§2/§3); the storage
      and API shapes remain open and are **not** chosen here. — src: `P §7 SES-OQ-1`
- [ ] **Waitlist auto-promote — schema merged, behaviour unbuilt.** `0014_players_waitlist` (waitlist
      **schema only**) is merged on `main` at `1a6ac38` (migrations `0000–0018`); only the **behaviour**
      (auto-promote, retry) is unbuilt, so the §3 rows are pre-build targets. Both spec headers,
      `P §7 SES-OQ-3` and `T §6` (Rollout step 2) now state this consistently (reconciled 2026-07-23),
      designating `docs/standards/BUILD-STATUS.md` as the implementation-status authority. — src:
      `P §7 SES-OQ-3`, `T §6` (Rollout step 2), `T §2` (schema note); `docs/standards/BUILD-STATUS.md`
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
- [ ] **Same-tenant composite FK tenant integrity (DD-68)** — `T §2` states composite candidate keys/FKs
      (`(tenant_id, session_id)` → `sessions`, `(tenant_id, membership_id)` → `memberships`,
      `session_surface_refs` same-tenant) are a **prerequisite** but are "CHƯA có trong 0014" — a separate
      monotonic migration (DD-68 scope, not DD-45). Recorded as a documented deferred prerequisite. — src:
      `T §2` (Schema comment + Migration & Rollback)
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

## Result — fail-closed

The 2026-07-23 spec reconcile fixed the two originally-cited defects, and both are re-verified on-disk
(base `main@1304cf7`):

- **Projection direction (was blocking):** `T §5` test #10 now reads "Public → private removes projection",
  matching `P E#8` / `P AC#11` / `P UC-5` / `P UC-10`. Traced directly in §6 / §7 `U#10`.
- **Migration `0014` status (was stale):** both spec headers, `P §7 SES-OQ-3`, `T §2` and `T §6` (Rollout
  step 2) state `0014_players_waitlist` (schema only) is merged on `main` at `1a6ac38` (migrations
  `0000–0018`); behaviour unbuilt. Reflected in the header and §9-B.

However, deeper traceability surfaced **two further source-spec inconsistencies** — not among the two fixed
defects — that a checklist must not paper over, so this document **fails closed** (completion marker withheld):

- **Blocking #1 — create result status.** `P UC-1` says create → "Session **open**", but the DDL defaults
  `status='draft'` (`T §2`), the `T §3` POST example returns `"status":"draft"`, and `P §4` has a separate
  `draft → open` "Host publish" transition. Quarantined in §9-A.
- **Blocking #2 — public session finite→unlimited capacity.** `T` supports `finite→NULL` (`T BE#15`,
  `T U#24`), but `P E#7` requires a **public** session to carry `slots_max`; the specs never resolve the
  interaction. Quarantined in §9-A.

Everything else in §0–§8 is cleanly source-traced and usable as-is (an evidence / coverage inventory — each
row → a `src:` pointer). Items the specs leave open or defer are recorded in §9 (never guessed).

**Overall result: HALT-SPEC_INCOMPLETE** — the completion marker is deliberately **not** emitted, so this
document is not detectable as complete. To reach completion, the specs must reconcile the create-result-status
(`P UC-1` vs `draft`/publish) and the public × unlimited-capacity interaction (`P E#7` vs `T`), then re-run
this checklist — the same reconcile→re-run cycle that fixed `U#10` / `0014`.
