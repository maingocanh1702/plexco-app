# Feature: Sync Engine & Re-projection — Backend Tech Spec

> **Canonical phase:** P4
> **Version:** 2.5a · 2026-07-23
> **Status:** Reviewed (v2.4: live-schema rollout truth + endpoint-exact channel delivery)
> **Implementation:** Not started · authority: `../../standards/BUILD-STATUS.md` (Doc status ≠ Implementation status)  
> **Product spec:** `../feature_sync_engine.md`
> **References:** `../../product/TDD.md` §3.8 · `../../standards/decisions.md` DD-37 · **DD-65..68**
> **⚠️ Live-schema boundary:** endpoint-exact delivery ở đây dựa trên `channel_identity_id` và reachability theo `channel_identity_id` — đó là **target** DD-67; live `channel_reachability` vẫn PK `(person_id, tenant_id, platform)` và `channel_identities` là key 2-phần. Cần migration mới land trước runtime; `0014_players_waitlist` **đã merge trên `main`** (`1a6ac38`; tail = 0018, migrations 0000–0018), nên slice Sync vẫn phải sync mọi prerequisite đã merge rồi chọn **next available monotonic number** sau tail đã merge (0018), không hardcode/pin một số cố định. Live tables sync (`processed_commands`/`outbox_events`/`projector_deliveries`/`surface_refs`/`public_sessions`) không đổi.

> **Cập nhật v2.1 (DD-37 ✅, 2026-07-10):** projectors fan-out phase-1 = **Zalo DM · Facebook Messenger (cửa sổ 24h) · web realtime · public projection**. **Bỏ Telegram** edit-message projectors (`tg_announcement`/`tg_roster`) — Zalo không có inline button (DM number-reply), Messenger gửi message mới trong 24h. Idempotent/re-projection contract không đổi.

---

## 1. Tổng quan triển khai

```text
Surface → Command(id, tenant, actor, version)
  → Validate → Insert/check processed_commands → Lock aggregate
    → Domain mutation → Append monotonic event → Store result → COMMIT

Worker (FOR UPDATE SKIP LOCKED) → Claim events by aggregate order
  → Create projector_deliveries → Projector lease → Reload canonical
    → External call → Mark delivered | Retry | DLQ
```

**Design decisions:**
- Duplicate command → return stored result without re-running mutation.
- Event schemas versioned — avoid secrets/PII in payload.
- Crash after provider success handled via provider idempotency or convergent edit/upsert.
- Worker partitions by aggregate ordering key (not tenant-wide).
- Messenger và Zalo delivery đều resolve exact endpoint-bound `channel_identity_id` (Page hoặc bot/OA), authorize target tenant bằng check riêng, rồi chọn đúng một route. Logical notification id dedups mọi candidate; không broadcast.

---

## 2. Database Schema + Edge Cases (BE)

### Schema

```sql
CREATE TABLE processed_commands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  command_id text NOT NULL,
  command_type text NOT NULL,
  result_hash text,
  result_ref jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, command_id)
);

CREATE TABLE outbox_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  aggregate_type text NOT NULL,
  aggregate_id uuid NOT NULL,
  sequence integer NOT NULL,
  type text NOT NULL,
  schema_version integer NOT NULL DEFAULT 1,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  claimed_at timestamptz,
  UNIQUE (aggregate_id, sequence)
);

CREATE TABLE projector_deliveries (
  event_id uuid NOT NULL REFERENCES outbox_events(id),
  projector text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'delivered', 'failed', 'dlq')),
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz,
  delivered_at timestamptz,
  provider_ref text,
  error_code text,
  PRIMARY KEY (event_id, projector)
);

CREATE TABLE surface_refs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aggregate_id uuid NOT NULL,
  platform text NOT NULL,
  target text NOT NULL,
  external_ref text,
  UNIQUE (aggregate_id, platform, target)
);
```

Business tables: `ENABLE + FORCE ROW LEVEL SECURITY`. Worker claims through narrow function.

### Indexes

```sql
CREATE INDEX idx_outbox_unclaimed ON outbox_events(aggregate_id, sequence) WHERE claimed_at IS NULL;
CREATE INDEX idx_projector_pending ON projector_deliveries(next_attempt_at) WHERE status = 'pending';
CREATE INDEX idx_surface_refs_aggregate ON surface_refs(aggregate_id);
```

### Migration & Rollback

**Baseline đã live — reuse, không recreate:** toàn bộ DDL §2 (`processed_commands`, `outbox_events` kèm `UNIQUE(aggregate_id, sequence)`, `projector_deliveries`, `surface_refs` + 3 indexes) đã tồn tại nguyên trạng từ migration `0005_sync_engine.sql`; `public_sessions` từ `0006_discovery.sql`; RLS/grant ở `0009`. Rollout step 1 đã pin: **không** tạo duplicate sync migration. DROP các bảng này = ❌ NEVER (outbox/delivery ledger thật).

**Genuinely new (chưa land trên main) → migration riêng, monotonic:** endpoint-scoped identity/reachability theo DD-67 — live `channel_identities` (`0001`) vẫn key 2-phần và `channel_reachability` (`0002`) vẫn PK `(person_id, tenant_id, platform)`; migration này phải land trước khi bật endpoint-exact channel delivery (rollout step 2). Chọn **next available monotonic number** sau khi sync mọi prerequisite đã merge (header ⚠️); không sửa migration lịch sử.

**Rollback:**

| Bước | Hành động | An toàn? |
|------|-----------|----------|
| 1 | Sync core: không có migration mới → không có schema rollback riêng cho slice này | ✅ (n/a) |
| 2 | Revert endpoint-identity migration: tắt endpoint-exact dispatcher (quay lại shadow/flag off, fallback policy) trước, rồi migration revert additive-only | ✅ |
| 3 | DROP bảng `0005`/`0006` baseline | ❌ NEVER — chứa event/delivery/projection thật |

### Edge Cases (Backend)

| # | Category | Case | Xử lý |
|---|----------|------|-------|
| 1 | Concurrency | Duplicate command (same command_id) | UNIQUE constraint → return stored result |
| 2 | Data Integrity | Mutation rollback | No outbox event — atomic commit ensures consistency |
| 3 | Concurrency | Parallel workers claim same event | `FOR UPDATE SKIP LOCKED` partitioning |
| 4 | Concurrency | Aggregate ordering regression | Monotonic sequence enforced per aggregate |
| 5 | Resilience | Crash before provider call | Retry claims event — delivery pending |
| 6 | Resilience | Crash after provider success | Provider idempotency or convergent upsert |
| 7 | Resilience | Projector A fails, B succeeds | Independent tracking — B delivered, A retries |
| 8 | Data Integrity | Surface message (Zalo/Messenger) missing/deleted | Surface ref lookup fails → send replacement + ref update. Messenger ngoài cửa sổ 24h: không gửi được → dồn qua web + Zalo (best-effort) |
| 9 | Security | Public projector emits private data | Strict whitelist — delete private/closed/expired |
| 10 | Security | Reproject replays notifications | ❌ BLOCK — no re-send unless projector supports correction mode |
| 11 | Security | Realtime topic guessing | AuthZ per subscription — reject unauthorized |
| 12 | Resilience | DLQ overflow | Alert threshold → operator review — bounded retry |
| 13 | Data Integrity | Nhiều Messenger Page hoặc Zalo bot/OA candidate reachable / retry đổi endpoint | Resolve endpoint-bound `channel_identity_id`, authorize target tenant riêng; one logical delivery only, priority policy + claim/dedup ngăn broadcast/double send |
| 14 | Concurrency | Hai transaction cấp cùng sequence cho một aggregate | `UNIQUE(aggregate_id, sequence)` cho đúng một commit; loser retry sau khi reload next sequence, không ghi event trùng |

---

## 3. API Contract

### Endpoints

| Method | Path | Auth | Mô tả |
|--------|------|------|-------|
| POST | /api/reproject | PlatformAdmin | Trigger reproject |
| GET | /api/sync/status | TenantAdmin | Sync lag/health |
| GET | /api/realtime/subscribe | Authenticated | SSE/WS subscription |

### Realtime Authorization

```text
Topic: tenant:<id> → requires TenantAdmin role
Topic: person:<id> → requires authenticated person match
```

Short session-bound connection, heartbeat, reconnect cursor, per-account connection limits, fallback refetch.

### Error Codes

| Code | Error Code | Message | Trigger |
|------|-----------|---------|---------|
| 409 | `STALE_COMMAND` | Command đã xử lý | Duplicate command_id |
| 403 | `REPROJECT_UNAUTHORIZED` | Không có quyền reproject | Non-operator |
| 429 | `REPROJECT_THROTTLED` | Đang xử lý reproject khác | Rate-limited |

### Request/Response Examples

> Minh hoạ theo contract đã pin; envelope chuẩn DD-60 (`../../standards/api-reference-convention.md` §1.1). Field name DTO chưa pin sẽ chốt ở build slice. `GET /api/realtime/subscribe` là SSE/WS stream — không áp envelope JSON DD-60; doc này không có webhook inbound.

**POST `/api/reproject`** — `200` (data shape minh hoạ):

```json
{ "data": { "accepted": true }, "error": null, "meta": { "requestId": "req_…" } }
```

- Non-operator — `403`:

```json
{ "data": null, "error": { "code": "REPROJECT_UNAUTHORIZED", "message": "Không có quyền reproject", "statusCode": 403 }, "meta": { "requestId": "req_…" } }
```

- Đang chạy reproject khác — `429`: `error.code = "REPROJECT_THROTTLED"` cùng envelope.

### Idempotency

> Tổng hợp cơ chế đã pin trong doc — không thêm cơ chế mới.

| Interface | Idempotent? | Cơ chế |
|-----------|-------------|--------|
| Command mutation | ✅ | `UNIQUE(tenant_id, command_id)` — duplicate trả stored result, không re-run mutation (edge #1, `STALE_COMMAND`) |
| Outbox append | ✅ | `UNIQUE(aggregate_id, sequence)` monotonic; loser reload next sequence rồi retry (edge #14) |
| Worker claim | ✅ | `FOR UPDATE SKIP LOCKED` — không duplicate claim (edge #3) |
| Projector delivery | ✅ | PK `(event_id, projector)` tracking độc lập; crash-after-send hội tụ qua provider idempotency/convergent upsert (edge #6/#7) |
| Channel delivery route | ✅ | Claim logical notification key trước provider call — đúng một route, không broadcast (edge #13, DD-67 §4) |
| Reproject | ✅ bounded | Không re-send notification trừ projector có correction mode (edge #10); throttle `REPROJECT_THROTTLED`; audit entry (test 19) |

---

## 4. Chi tiết triển khai

### Projector Registry

| Projector | Surface | Behavior |
|-----------|---------|----------|
| `zalo_dm` | Zalo DM (exact bot/OA endpoint) | Resolve endpoint-bound `channel_identity_id`, authorize target tenant separately, then send/update through exactly one bot/OA; no inline button or broadcast |
| `messenger` | Messenger hybrid | Resolve endpoint-bound `channel_identity_id`, authorize target tenant separately, then select tenant Page reachable → central Page reachable; send one with logical dedup; outside policy window fallback web/Zalo |
| `web_realtime` | Web SSE/WS | Push invalidation event |
| `public_sessions` | Public search | Upsert/delete projection |

> **DD-37:** Telegram edit-message projectors (`tg_announcement`, `tg_roster`) **removed** — Telegram out of phase-1 scope. Không có "edit inline roster in group" cho Zalo/Messenger; roster hiển thị qua web + DM.

**Channel delivery boundary (DD-67):** candidate route là tuple server-derived `(channel_identity_id, provider_endpoint_id, target_tenant_id)`. Dispatcher phải (1) load reachability theo exact `channel_identity_id`; (2) xác minh identity thuộc đúng Messenger Page hoặc Zalo bot/OA registry row; (3) authorize `target_tenant_id` riêng, không suy tenant từ reachability/default endpoint; (4) claim logical notification key trước provider call và chọn đúng một route theo priority. Không candidate hoặc auth mơ hồ thì fail closed sang policy fallback; tuyệt đối không fan-out thử nhiều endpoint.

### SLO Targets

| Metric | Target |
|--------|--------|
| Sync lag p95 | ≤ 3s |
| Sync lag p99 | ≤ 10s |
| Payment reconcile p99 | ≤ 5s |
| DLQ size | Alert at > 100 |

### Caching Strategy

| Data | Cache? | TTL | Invalidation |
|------|--------|-----|-------------|
| Outbox / delivery / claim state | ❌ | — | Worker đọc + claim trực tiếp under lock (`FOR UPDATE SKIP LOCKED`); live, fail-closed |
| Canonical data cho projector | ❌ | — | "Reload canonical" trước external call (§1) — không render từ event payload hay snapshot cache |
| Reachability / endpoint identity khi dispatch | ❌ | — | Load live theo exact `channel_identity_id` (DD-67); không candidate/auth mơ hồ → fail closed sang policy fallback |
| `public_sessions` projection | — (derived store có chủ đích) | — | Không phải cache tự do: upsert/delete qua projector theo strict whitelist (edge #9/#10) |
| Realtime client state | — | — | Client reconnect cursor + fallback refetch (§3); server không cache authz — AuthZ per subscription |

### Security Checklist (template v2.33 — map về section đã pin)

| Mục | Trả lời trong spec |
|-----|---------------------|
| Authorization/ownership | §3: `/api/reproject` = PlatformAdmin, `/api/sync/status` = TenantAdmin; realtime topic authz per subscription (edge #11); channel delivery authorize `target_tenant_id` riêng, không suy từ reachability/default endpoint (DD-67 §4) |
| Injection/validation | §1/§2: command validate trước mutation; event schema versioned, payload jsonb minimal; worker claim qua narrow function; realtime reject topic không được phép (edge #11) |
| Secret & log redaction | §1 design decisions: event payload tránh secrets/PII; public projector strict whitelist, xoá private/closed/expired (edge #9) |
| Webhook signature + replay | N/A — doc này không nhận webhook inbound (provider verify thuộc channel/connector docs); replay nội bộ chống bằng command dedup + monotonic sequence + delivery ledger (§2) |
| Idempotency | Bảng Idempotency §3 |
| Data retention/xoá | Public projection delete theo whitelist (edge #10); retention outbox/delivery ledger chưa pin ở doc này — theo `feature_security_operations_tech.md` |

---

## 5. Testing Plan

### Unit Tests

| # | Test | Input | Expected |
|---|------|-------|----------|
| 1 | Command dedup | Duplicate command_id | Return stored result |
| 2 | Command concurrent | Same command_id parallel | One wins, one dedup |
| 3 | Atomic commit | Mutation + event | Both committed or neither |
| 4 | Rollback no event | Mutation fails | No outbox event |
| 5 | Aggregate ordering | Events out of order | Monotonic sequence enforced |
| 6 | Worker claim skip locked | Parallel workers | No duplicate claims |
| 7 | Projector A fail B success | Mixed results | Independent tracking |
| 8 | Missing surface message | Deleted Zalo/Messenger message ref | Replacement created (Messenger: only within 24h) |
| 9 | Public whitelist | Private session event | Not projected |
| 10 | Public deletion | Session closed event | Projection deleted |
| 11 | Reproject no notifications | Reproject command | No notification re-send |
| 12 | Realtime auth valid | Correct topic/person | Subscribed |
| 13 | Realtime auth invalid | Wrong topic | Rejected |
| 14 | Realtime disconnect | Connection drop | Reconnect + refetch |
| 15 | Crash recovery before send | Worker crash pre-send | Event reclaimed |
| 16 | Crash recovery after send | Worker crash post-send | Convergent (no duplicate) |
| 17 | DLQ threshold | Max retries exhausted | Moved to DLQ + alert |
| 18 | Event schema version | V1 vs V2 payload | Correct deserialization |
| 19 | Reproject audit | Reproject triggered | Audit entry created |
| 20 | Messenger route priority | both/tenant-only/central-only/neither reachable | Exactly expected one route or fallback; no duplicate |
| 21 | Zalo exact endpoint route | Two bot/OA identities for one Person; only one authorized for target tenant | Deliver through the authorized endpoint-bound `channel_identity_id` exactly once; no cross-bot/OA broadcast |
| 22 | Tenant isolation | Events from tenant A | Not visible to tenant B |
| 23 | Aggregate sequence race | Two concurrent transactions append the same `(aggregate_id, sequence)` | Exactly one event commits; unique loser reloads next sequence/retries, no duplicate or silent overwrite |

### Integration Tests

| # | Test | Setup | Expected |
|---|------|-------|----------|
| 1 | Command → outbox → projector | Create session | All projectors receive event |
| 2 | Reproject repair | Delete Zalo/Messenger message → reproject | Message recreated (Messenger within 24h) |
| 3 | Realtime end-to-end | Subscribe → trigger event | Client receives update |
| 4 | Load test 1k tenants | Parallel commands | SLO met, no data corruption |
| 5 | Messenger retry endpoint switch | Tenant Page fails/revokes after claim | Convergent fallback/no double-send according to delivery ledger |
| 6 | Concurrent aggregate append | Race two writers at the same next sequence | `UNIQUE(aggregate_id,sequence)` rejects duplicate; retry preserves strict monotonic order |

---

## 6. Rollout Plan + Changelog

### Rollout

1. Verify the existing live command/outbox tables and `UNIQUE(aggregate_id,sequence)` from migration `0005`; do **not** create a duplicate sync migration.
2. Land the separate forward migration for endpoint-scoped identity/reachability before enabling endpoint-exact channel delivery.
3. Shadow dispatcher (log events, no delivery).
4. Enable Zalo DM projector (P2) + Messenger projector (P2.5, 24h window).
5. Enable web realtime.
6. Enable public projector.
7. Monitor SLO targets.

### Metrics

- Outbox age / delivery lag per projector
- DLQ size / aggregate ordering stalls
- Realtime connections / disconnects
- Reproject count / audit trail
- SLO breach alerts (p95/p99)

### Changelog

| Date | Version | Thay đổi |
|---|---|---|
| 2026-07-23 | v2.5a | **Reconcile 0014 merge-state:** current-state Live-schema boundary sửa → `0014_players_waitlist` **đã merge trên `main`** (`1a6ac38`, migrations 0000–0018, tail = 0018). Migration-numbering guidance giữ nguyên (sync merged prerequisites → next available monotonic number sau tail đã merge, không hardcode), chỉ đổi justification. Pre-existing dated changelog giữ verbatim. Không đổi contract. |
| 2026-07-19 | v2.5 | **Template v2.30/v2.33 uplift:** thêm §2 Migration & Rollback (toàn bộ DDL §2 đã live ở `0005` — reuse; new chỉ là DD-67 endpoint identity migration riêng), §3 Request/Response Examples (DD-60) + Idempotency, §4 Caching Strategy + Security Checklist. Derivative/editorial — không đổi contract. |
| 2026-07-19 | v2.4a | Metadata sweep (index v2.35): thêm trường **Implementation** đồng bộ BUILD-STATUS (Not started). Không đổi contract. |
| 2026-07-17 | v2.4 | **Live-schema rollout closure:** clarify that migration `0005` already owns the command/outbox schema and aggregate-sequence uniqueness; only the separate endpoint identity/reachability migration remains before endpoint-exact delivery. |
| 2026-07-17 | v2.3 | Restore the already-live `UNIQUE(aggregate_id,sequence)` to this documentation and add its race regression; pin exact endpoint-bound identity, separate target-tenant authorization and one-route/no-broadcast for both Messenger Page and Zalo bot/OA; fix duplicate test IDs. |
| 2026-07-17 | v2.2 | **DD-65..68:** Page-endpoint candidate resolution, tenant→central priority, logical one-route dedup and retry/fallback tests. |
| 2026-06-18 | v1.0 | Initial BE tech spec (English format) |
| 2026-06-19 | v2.0 | Chuẩn hoá Vietnamese numbered (6 sections), full DDL, 12 BE edge cases, projector registry, SLO targets, 20 tests |
| 2026-07-10 | v2.1 | **DD-37 ✅:** projector registry — bỏ `tg_announcement`/`tg_roster` (Telegram); phase-1 fan-out = `zalo_dm` · `messenger` (24h window) · `web_realtime` · `public_sessions`. Cập nhật edge #8, tests #8/int#2, rollout step 3. |
