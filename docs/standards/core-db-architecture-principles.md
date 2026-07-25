# Core / DB / Architecture Principles — Plexco

> Principles dùng khi thiết kế core domain, database schema, service boundary và architecture slice cho Plexco.
> Tài liệu này không thay thế `product/TDD.md`, `standards/business-rules.md` hoặc `standards/decisions.md`; khi conflict, cập nhật decision/source document trước rồi sync lại file này.

**Version:** 1.6
**Date:** 2026-06-21 (cập nhật 2026-07-25)
**Scope:** multi-tenant core, PostgreSQL/RLS, sync engine, identity, payment ledger, marketplace discovery, web/chat/native surfaces.

> **Cập nhật v1.2 — 16/07/2026 (DD-50):** phase-1 không thu SĐT. Strong proof cho claim membership có tiền chỉ là verified account email hoặc transactional one-time `link_code`; owner/name/CK chỉ là review evidence. Phone schema giữ dormant.
>
> **Cập nhật v1.3 — 17/07/2026 (DD-15/DD-67):** channel identity/reachability scoped theo provider endpoint cho Messenger + Zalo; reachability canonical gắn `channel_identity_id`, target-tenant eligibility authorize riêng.
>
> **Cập nhật v1.4 — 19/07/2026:** initial DD-70 lock-order propagation; superseded by v1.5.
>
> **Cập nhật v1.5 — 19/07/2026 (DD-70(a) proposal, decisions v1.70):** known global-notification producers use bounded read-only Person discovery → inbox fences UUID-order → canonical Person/source/audit → same-transaction item. `link_code` consume emits nothing; merge commit owns `identity_merged`. Tenant outbox is never a global fallback; an unfit path is a build halt pending an explicit GLOBAL PROTECTED source-event contract.
>
> **Cập nhật v1.6 — 25/07/2026 (DD-89/DD-90):** một cross-tenant job function trên bảng `FORCE RLS` phải do lane-specific, `NOLOGIN BYPASSRLS` definer sở hữu, được bootstrap ở privileged cluster tier trước migration và chỉ có exact table grants. Runtime `app_worker` vẫn `NOBYPASSRLS`/EXECUTE-only; direct DML không thay stored-operation boundary. Mọi claim/reclaim có audit per-event, và function-owner allowlist là invariant.

---

## 1. Why This Exists

Plexco không phải CRUD app đơn tenant. Sản phẩm có nhiều tenant, nhiều surface cùng ghi/đọc dữ liệu, payment ledger, identity xuyên platform, marketplace public cross-tenant, web/app native và bot channel cùng tồn tại.

Vì vậy, mỗi thay đổi core/db phải được thiết kế như một hệ thống phân quyền + nhất quán dữ liệu + vận hành lâu dài, không chỉ là một bảng hoặc endpoint mới.

Mục tiêu của principles này:

- Giữ tenant isolation đúng từ schema tới service boundary.
- Giữ money/identity/session state nhất quán dù nhiều surface cùng thao tác.
- Scale được về tenant count, job volume, webhook volume và realtime projection.
- Dễ audit, dễ migrate, dễ rollback, dễ debug khi dữ liệu lệch.
- Tránh thiết kế tạo nợ kỹ thuật ở choke-point: tenant routing, identity merge, payment allocation, sync/projector, public projection.

---

## 2. Non-Negotiable Invariants

Những bất biến này phải pass trước khi một thiết kế được coi là hợp lệ.

| ID | Invariant | Meaning |
|---|---|---|
| INV-1 | Tenant isolation is a security boundary | `tenant_id` không phải filter tiện lợi; nó là ranh giới bảo mật. Tenant-private data phải qua RLS fail-closed + service/repo scoped. |
| INV-2 | PostgreSQL + domain model are canonical | Web, bot, app native, provider webhook, worker chỉ là surfaces/adapters. Không surface nào giữ sự thật riêng. |
| INV-3 | Public discovery is a projection, not a privileged read | Marketplace chỉ đọc field whitelist từ `public_sessions`/public projection. Không query bảng canonical rồi "ẩn bớt field" ở API. |
| INV-4 | Money is append-only and fail-closed | Không xoá/sửa ledger đã audit. Không chứng minh được allocation an toàn thì block/manual review, không đoán. |
| INV-5 | Identity merge needs strong proof | Tên, username, bank display name chỉ là hint. Membership có tiền/nợ không được auto-claim bằng fuzzy match. |
| INV-6 | Every mutation is idempotent | Command, webhook, job, projector delivery đều có dedupe key và retry an toàn. |
| INV-7 | Derived aggregate has one owner | Tiền còn nợ, slots open, paid state, public visibility, reachability phải có canonical helper/projection. Không re-derive khác công thức ở nhiều call site. |
| INV-8 | Cross-tenant jobs use narrow privilege | Worker/scheduler có thể scan nhiều tenant, nhưng từng mutation phải quay lại tenant context hoặc gọi function audited hẹp do lane-specific `NOLOGIN BYPASSRLS` definer sở hữu; runtime `app_worker` không có broad BYPASSRLS/direct DML. |
| INV-9 | Secrets/PII never leak through logs/events/URLs | Token, phone, platform ID, webhook secret, account number phải hash/encrypt/redact theo purpose. |
| INV-10 | Data corrections are explicit events | Sửa sai tiền/identity/session dùng reversal/correction/audit, không silent update. |

---

## 3. Architecture Mental Model

### 3.1 Data Visibility Planes

Thiết kế schema/API phải luôn chỉ rõ dữ liệu thuộc plane nào.

| Plane | Examples | Access model | Rule |
|---|---|---|---|
| Global protected | `persons`, `channel_identities`, phone, platform IDs, merge audit | Protected service functions, purpose-bound, audited | Global không có nghĩa public. API role không được broad SELECT. |
| Tenant-private | `sessions`, `memberships`, `charges`, `bank_transactions`, `payment_allocations`, `outbox_events` | RLS fail-closed with `SET LOCAL app.tenant_id` | Default path cho host/player club data. |
| Person-self | `/myclubs`, own debt/session view | Authenticated person authorization | Cross-tenant by person, but only own data and no tenant admin data. |
| Public projection | `public_sessions`, marketplace search | Least-privilege readonly role, field whitelist | No PII, no roster, no exact private venue, no payment/debt. |

### 3.2 Write Paths

Mọi ghi dữ liệu phải thuộc một trong ba nhóm:

| Write path | Source | Required controls |
|---|---|---|
| User command | Web, bot, native app | `command_id`, authz, tenant/person resolution, aggregate lock, domain mutation, outbox in same transaction. |
| Provider ingest | SePay/ApiPay/Zalo/Messenger webhook | Signature/token verify, raw durable insert before ACK, idempotency, async processing, audit. |
| Operator correction | Admin/support/manual reconcile | Strong authz, reason code, before/after audit, append-only correction/reversal where money/identity is involved. |

Nếu một path không fit bảng trên, thiết kế chưa đủ rõ.

### 3.3 Read Paths

Không dùng một generic "read everything" repository.

| Read path | Purpose | Boundary |
|---|---|---|
| Tenant read | Host dashboard, club roster, tenant config | RLS tenant context. |
| Person read | Player own clubs/sessions/debts | Authenticated `person_id`, only own data. |
| Public read | Discovery/search | Projection-only, no canonical grants. |
| Support read | Debug/audit | Break-glass role, logged, scoped by ticket/reason. |

---

## 4. Core Design Principles

### P1. Model the Domain Before Modeling Tables

Start from aggregate, lifecycle and invariants, then write schema.

For every new core object, define:

- Aggregate owner: tenant, person, session, payment transaction, subscription, or global directory.
- State machine: allowed states and forbidden transitions.
- Invariants: what must never be false after commit.
- Idempotency key: how duplicate commands/webhooks/jobs are handled.
- Audit requirement: whether money, identity, tenant routing, secret, authz or public visibility is touched.
- Projection impact: what needs to be updated in web, bot, public discovery, notification or analytics.

Do not add a table because a screen needs a shape. Add a canonical table only when the domain has persistent truth; otherwise use view/projection/DTO.

### P2. Tenant Scope Must Be Enforced by the Database and the Service Boundary

Every tenant-private table should have:

- `tenant_id NOT NULL`.
- RLS `ENABLE` + `FORCE`.
- Policy based on `current_setting('app.tenant_id', true)`.
- Indexes starting with `tenant_id` for hot queries.
- Unique constraints scoped by `tenant_id` unless the business rule is truly global.

Every service call that mutates tenant-private data must receive tenant context from trusted routing/authz, not from client-submitted body fields.

Bad:

```text
POST /sessions { tenantId, ... }
handler trusts tenantId from body
```

Good:

```text
trusted channel/web session -> resolve tenant -> authorize actor -> tenantRepo(tenantId).createSession(...)
```

### P3. Keep Adapters Thin; Put Behavior in Core Services

Zalo, Messenger, web and native app should normalize input into commands. They should not own business rules.

Adapter responsibilities:

- Verify provider signature/token.
- Extract stable provider identity.
- Resolve trusted route context.
- Map provider-specific input to domain command.
- Render provider-specific output/projection.

Core service responsibilities:

- Validate business rules.
- Lock aggregates.
- Mutate canonical state.
- Emit outbox events.
- Return stable domain result.

If the same rule appears in two adapters, extract it to core before shipping.

### P4. One Canonical Owner for Derived Data

Derived values must have one canonical owner/helper.

Examples:

| Derived data | Canonical owner |
|---|---|
| `charge.paid` / outstanding amount | Payment ledger helper over `charges` + `payment_allocations` + reversals. |
| `slots_open` | Session capacity helper/projection from canonical roster and capacity. |
| `public_sessions.slots_open` | Public projector, never hand-computed by discovery API. |
| Person's clubs/debts | Person-self query service, not tenant dashboard query reused with bypass. |
| Reachability | `channel_reachability(channel_identity_id)`; endpoint binding thuộc `channel_identities`, tenant eligibility kiểm tra riêng. |

Never let each endpoint compute its own version of money, slot count or paid state.

### P5. Money Ledger Is a Ledger, Not a Status Flag

Payment design must answer:

- What is the source of funds?
- What charge does it allocate to?
- Can one transaction fund multiple charges?
- Can one charge be partially paid?
- What happens on overpay, underpay, refund, reversal, cancellation or merge?
- What audit row explains the change?

Required rules:

- Bank transaction insert is durable and idempotent before provider ACK.
- Allocation total never exceeds transaction amount.
- Charge settlement never exceeds amount due.
- Paid state is derived from effective allocations.
- Corrections use reversal/correction rows, not destructive edits.
- Manual/cash/waiver paths record actor, reason and provenance.
- Suspended tenant still ingests player payments safely.

### P6. Identity Is Global Protected Data; Membership Is Tenant Data

Keep these concepts separate:

- `Person`: real-world user identity, global protected.
- `ChannelIdentity`: Zalo/Messenger/Google/native identity linked to Person.
- `Membership`: relation between Person and Tenant.
- `Player/session roster row`: participation in a session.

Rules:

- First contact may create `Person`/`ChannelIdentity`, but should not grant tenant membership unless there is an explicit join/approval action.
- Membership with existing money/history needs verified account email or a transactional one-time `link_code` before claim; owner confirmation/name/CK are review evidence only.
- Merge produces a plan first, then a transaction with locks, tombstones and audit.
- Merge must preserve ledger rows and re-parent references; it must not rewrite payment facts.

### P7. Public Data Must Be Published, Not Queried from Private Tables

Discovery needs cross-tenant visibility, but not cross-tenant power.

Therefore:

- Public API role gets SELECT only on public projection/view.
- Public projection stores only approved fields.
- `tenant_id` inside projection is routing metadata, not serialized externally.
- Exact venue, roster, contact, STK, payment status, debt and PII never enter public projection.
- Public projection update/delete is driven by outbox projector.
- Closed/cancelled/private/expired sessions are removed or hidden by projector.

Filtering private data at API response time is not enough.

### P8. Idempotency Is a First-Class Schema Requirement

Every path that can retry must define a durable dedupe key.

| Path | Dedupe key |
|---|---|
| Web/native command | `(tenant_id, command_id)` or `(person_id, command_id)` depending on scope. |
| Channel message/callback (Zalo/Messenger) | Provider message/update ID + route context. |
| Webhook transaction | `(tenant_id, provider, external_id)` or deterministic hash fallback. |
| Outbox event | `(aggregate_id, sequence)` plus event ID. |
| Projector delivery | `(event_id, projector)`. |
| External provider send/edit | Provider idempotency key or convergent update/upsert where provider lacks it. |

Idempotency is not "catch duplicate error and hope"; it must return or converge to a known prior result.

### P9. Transactions Own Consistency; Workers Own Progress

Use DB transactions for invariants that must be true immediately after commit:

- capacity not over-filled;
- command processed once;
- outbox event exists if mutation committed;
- payment allocation within bounds;
- merge plan still valid while committing;
- public/private state not half-updated in canonical tables.

Use workers/projectors for eventual side effects:

- Zalo/Messenger sends/edits;
- web realtime invalidation;
- public projection update;
- retryable notification;
- reconciliation jobs.

Do not call external providers while holding locks unless there is no alternative. Commit canonical state first, then project.

### P10. Lock the Smallest Aggregate That Protects the Invariant

Concurrency control should be explicit.

Examples:

- Join/capacity change locks the session aggregate.
- Payment allocation locks the bank transaction and target charges.
- Identity merge locks involved persons in deterministic order.
- When DD-70(a) notification rows/fences are in scope, identity merge/delete first discovers affected Persons read-only and locks their inbox fences in deterministic UUID order; only then does it lock Persons/sources and append from the canonical locked audit. Drift restarts. Known producers must be reordered; inability to obey is a build halt, not permission to emit through tenant outbox or take a late fence.
- Tenant routing rebind locks current and target binding rows.
- Subscription state transition locks the subscription row.

Prefer database constraints + row locks over app-memory locks. App locks do not scale across workers/replicas.

### P11. Event Payloads Are Contracts, Not Dumped Rows

Outbox events should contain enough data to identify what changed, not every private field.

Rules:

- Version event schema.
- Avoid secrets and raw PII in payload.
- Include aggregate ID, tenant ID, event type, sequence and minimal payload.
- Projectors should reload canonical data under the correct boundary when they need render state.
- Reprojection must not resend one-time notifications unless explicitly in correction mode.

### P12. Schema Evolves Through Expand-Backfill-Contract

For production data:

1. Expand: add nullable column/table/index/dual-write path.
2. Backfill: bounded jobs, resumable, observable.
3. Validate: constraints `NOT VALID` then `VALIDATE CONSTRAINT` where possible.
4. Flip reads: use new source after invariants pass.
5. Contract: remove old path only after metrics and rollback window.

Avoid destructive migrations in the same deploy that changes application behavior.

### P13. Security Is Designed at the Boundary, Not Added by Middleware Later

Every feature spec must identify:

- trusted inputs vs untrusted inputs;
- actor type: tenant admin, co-admin, player/person, provider, worker, platform operator;
- route source of tenant/person context;
- authz matrix;
- rate limit;
- PII/secret handling;
- audit requirement;
- public/private projection impact.

Middleware helps enforce decisions; it cannot rescue an ambiguous data model.

### P14. Scaling Starts with Bounded Access Patterns

Before adding data, name the hot queries.

Required for each table/read model:

- primary lookup path;
- tenant/person/public filter;
- pagination key;
- retention/archive plan for high-volume rows;
- cardinality expectation;
- index plan;
- background job access pattern.

Scale posture:

- Start with modular monolith + Postgres.
- Index for tenant-scoped and time/status scoped reads.
- Partition only when measured volume justifies it, likely first for ledger/audit/outbox.
- Keep API stateless so horizontal scale is available.
- Keep workers partitionable by aggregate or tenant without changing domain behavior.

### P15. Observability Is Part of the Feature

Any core/db feature should emit enough telemetry to answer:

- Did it mutate canonical state?
- Did the outbox event get created?
- Did each projector deliver?
- How old is the oldest pending job/event?
- Which tenant/person/session/payment is affected?
- Was the action auto/manual/system/provider?
- What invariant failed if it blocked?

Minimum:

- structured logs with redaction;
- metrics for success/failure/latency/retry/DLQ;
- audit rows for money, identity, tenant routing, admin authz, secret changes;
- correlation IDs from command/webhook through projector.

### P16. Tests Must Target Invariants, Not Only Happy Paths

Every core/db slice should include tests for:

- tenant A cannot read/mutate tenant B;
- public projection has no forbidden fields;
- duplicate command/webhook/job is safe;
- concurrency race cannot violate invariant;
- rollback does not leave outbox/state half-committed;
- money allocation totals stay bounded;
- identity merge preserves ledger totals;
- RLS policies fail closed when tenant context is missing;
- migration can run on existing data.

Test names should state the invariant being protected.

---

## 5. Database Design Checklist

Use this before approving a new table, migration or read model.

### 5.1 Ownership

- [ ] Is this table global protected, tenant-private, person-self support data, or public projection?
- [ ] Who owns the lifecycle?
- [ ] What state machine applies?
- [ ] What rows are immutable after audit?
- [ ] What is the retention/archive policy?

### 5.2 Keys and Constraints

- [ ] Does every tenant-private row have `tenant_id NOT NULL`?
- [ ] Are unique constraints correctly scoped by tenant/person/provider?
- [ ] Are idempotency keys durable?
- [ ] Are status values constrained?
- [ ] Are amount fields integer minor units, never float?
- [ ] Are timestamps `timestamptz` and user-facing timezone stored separately where needed?
- [ ] Are foreign keys present for canonical relationships?
- [ ] Are soft-delete/tombstone semantics explicit where needed?

### 5.3 RLS and Grants

- [ ] RLS enabled and forced on tenant-private tables?
- [ ] App role has `NOBYPASSRLS`?
- [ ] No broad grants to protected global identity tables?
- [ ] Public/discovery role has zero grants on canonical private tables?
- [ ] Worker privilege is narrow and audited?
- [ ] RLS behavior tested with missing/wrong `app.tenant_id`?

### 5.4 Query and Index Plan

- [ ] List top 3 read queries.
- [ ] List top 3 write/job queries.
- [ ] Add indexes matching filters/order.
- [ ] Pagination is keyset/cursor for unbounded lists.
- [ ] Cross-tenant scan is only for worker/support/public projection with explicit limit and purpose.

### 5.5 Migration Plan

- [ ] Can this deploy without downtime?
- [ ] Does old code tolerate new schema?
- [ ] Does new code tolerate old data during rollout?
- [ ] Is backfill bounded/resumable?
- [ ] Are constraints validated after backfill?
- [ ] Is rollback/correction plan written?

---

## 6. Service Boundary Checklist

Use this before adding a service, endpoint, worker or adapter handler.

- [ ] What trusted source resolves tenant/person?
- [ ] What actor is authorized for this command/query?
- [ ] What aggregate is locked?
- [ ] What idempotency key is required?
- [ ] What invariant can fail and what error code is returned?
- [ ] What outbox event is emitted?
- [ ] What projectors are affected?
- [ ] What audit rows are written?
- [ ] What rate limit applies?
- [ ] What data is forbidden in logs/events/URLs?
- [ ] What happens on retry after partial external failure?

---

## 7. Slice Design Gate

Before implementation, every core/db feature slice should fit in a small, reviewable surface.

Preferred slice shape:

1. Migration + RLS/constraints.
2. Core service/repository for one aggregate.
3. Command/API/adapter entry point.
4. Outbox/projector if the feature affects surfaces.
5. Focused invariant tests.
6. Metrics/audit for production diagnosis.

Do not mix unrelated choke-points in one slice. Examples that should usually be split:

- identity merge + payment allocation;
- public discovery + tenant admin dashboard;
- billing lifecycle + player payment ledger;
- sync engine infrastructure + feature-specific projector behavior;
- native app auth + tenant routing rework.

If one state is mutated across many paths, design the interaction table first and split into core + edge slices.

---

## 8. Common Anti-Patterns to Reject

| Anti-pattern | Why it is unsafe | Better design |
|---|---|---|
| Passing `tenant_id` from request body into repo | Tenant spoof risk | Resolve tenant from trusted channel/session, then inject into tenantRepo. |
| API queries canonical session table for discovery and strips fields | Easy to leak PII/money/venue later | Public projection with least-privilege readonly role. |
| `is_paid` manually toggled in multiple places | Money drift | Derive from ledger allocations through one helper/projection. |
| Fuzzy name auto-claim for debt-bearing membership | Wrong person can inherit debt/payment | Verified account email or transactional one-time `link_code`; owner/name/CK cannot bypass. |
| Bot handler contains business rule duplicated from web | Divergent behavior across surfaces | Normalize to command and use core service. |
| Worker uses superuser/bypass RLS for convenience | Cross-tenant blast radius | Narrow claim function, then tenant-scoped mutation. |
| Event payload contains full row snapshot | PII/secret leakage and schema coupling | Minimal versioned event; projector reloads allowed state. |
| External provider call inside DB transaction | Locks held during network failure | Commit canonical state + outbox, then projector sends. |
| Destructive update to ledger/history | Audit loss | Reversal/correction event with provenance. |
| Backfill without resume cursor | Deploy/ops risk | Bounded batches with cursor, metrics and rerun safety. |

---

## 9. Standard Decision Template

Use this in feature tech specs or `standards/decisions.md` when a core/db decision is non-trivial.

```md
## Decision: <short name>

### Context
- What user/business/system problem requires this?
- Which existing invariant or decision is relevant?

### Options
1. Option A
2. Option B
3. Option C

### Decision
Chosen: <option>

### Why
- Security:
- Data correctness:
- Scalability:
- Operational simplicity:

### Consequences
- Schema impact:
- Service/API impact:
- Migration impact:
- Test impact:
- Open risks:
```

---

## 10. Definition of Ready for Core/DB Work

A core/db implementation task is ready only when these are written down:

- [ ] Aggregate and lifecycle.
- [ ] Tenant/person/public boundary.
- [ ] Authz and routing source.
- [ ] Schema + constraints + indexes.
- [ ] RLS/grant plan.
- [ ] Idempotency strategy.
- [ ] Transaction and locking strategy.
- [ ] Outbox/projector impact.
- [ ] Audit/logging/metrics.
- [ ] Migration/backfill/rollback.
- [ ] Tests for security, concurrency and invariant behavior.

If any box is unknown, the task is still design work.

---

## 11. Definition of Done for Core/DB Work

A core/db change is done only when:

- [ ] Migrations apply cleanly and are safe for existing data.
- [ ] RLS/grants are implemented and tested.
- [ ] Unit tests cover domain invariants.
- [ ] Integration tests cover tenant isolation and idempotent retry.
- [ ] Public projection tests prove no forbidden fields leak.
- [ ] Money/identity changes have audit tests.
- [ ] Concurrency-sensitive paths have race tests or DB constraint proof.
- [ ] Projectors can retry without duplicate harmful side effects.
- [ ] Metrics/logs/audit are sufficient for on-call diagnosis.
- [ ] Relevant `business-rules.md` / `decisions.md` / feature tech spec is updated if behavior changed.

---

## 12. Quick Review Questions

Before merging any core/db architecture change, ask:

1. What exact data would leak if this handler runs under the wrong tenant?
2. What happens if the same command/webhook arrives twice?
3. What happens if the worker crashes after DB commit but before external send?
4. Which rows are locked when two users join/pay/merge at the same time?
5. Which single helper/projection owns the derived value?
6. Can public/discovery code reach private canonical tables at the grant level?
7. Can this migration run on real production data without downtime?
8. What audit record explains this mutation six months later?
9. How do we detect and repair projection drift?
10. Which test would fail if this invariant regresses?

---

## Source References

- `docs/product/TDD.md`
- `docs/product/PRD.md`
- `docs/standards/business-rules.md`
- `docs/standards/decisions.md`
- `docs/strategy/saas-implementation-plan.md`
- `docs/research/player-side-saas-AUDIT.md`
- `docs/research/player-side-saas-reconciliation.md`

---

## Changelog

| Date | Version | Change |
|---|---|---|
| 2026-06-21 | 1.0 | Initial Plexco core/db/architecture principles. |
| 2026-07-10 | 1.1 | DD-37 channel pivot (BRD v3.4): ví dụ adapter/provider-ingest/idempotency đổi Telegram→Zalo/Messenger; `ChannelIdentity` = Zalo/Messenger/Google/native. Không đổi nguyên tắc. |
| 2026-07-16 | 1.2 | DD-50: replace phone/owner-confirm claim language with verified account email or transactional one-time `link_code`; keep phone schema dormant. |
| 2026-07-17 | 1.3 | DD-15/DD-67: provider-endpoint channel identity/reachability for Messenger + Zalo; reachability keyed by `channel_identity_id`, tenant eligibility separate. |
| 2026-07-19 | 1.5 | DD-70(a) v1.70 ownership: known global producers append from canonical audit in the same fence-first transaction; link-code consume emits nothing; tenant outbox fallback forbidden and unfit paths halt. No runtime. |
| 2026-07-19 | 1.4 | Superseded initial DD-70(a) lock-order propagation. No runtime. |
