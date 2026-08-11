# Feature: Sync Engine & Re-projection — Product/UX Spec

> **Canonical phase:** P4
> **Track:** 🔄 Sync Engine
> **Version:** 2.6 · 2026-08-10
> **Status:** Reviewed (v2.3: canonical command/outbox keys + endpoint-exact channel delivery)
> **Implementation:** Infrastructure in progress — lease/ack + preflight/dispatcher/flagged scheduler đã merge, nhưng schedule OFF/placeholder và chưa có producer/real projector/replay/sub-minute drain; business sync E2E chưa bắt đầu · authority: `../standards/BUILD-STATUS.md` (Doc status ≠ Implementation status)
> **Prerequisites:** P2 canonical domain services · P3 pg-boss/outbox · P4 channel adapters
> **Tài liệu liên quan:** `../product/BRD.md` FR-4 · `../product/PRD.md` FLOW 14 · `../product/TDD.md` §3.8 · BRD OD-7 · `../BE/feature_sync_engine_tech.md`

> **Cập nhật v3.4 (DD-37, 2026-07-10):** kênh phase-1 = **Zalo + Facebook Messenger** + web (bỏ Telegram). Projector fan-out ra **Zalo DM / Messenger (cửa sổ 24h) / web realtime / public projection** — **không còn TG projector**; "Messenger P4.8" cũ nay là **phase-1 P2.5**. Các đề cập "TG" dưới đây là projector Zalo/Messenger tương ứng.
>
> **As-built 2026-07-28 (`main@784bc8d`):** migrations `0022`/`0023` và bot worker đã tạo
> shared claim/lease/audit/ack mechanics, fail-closed preflight, dispatcher và schedule một phút sau cờ
> exact-string. Cờ mặc định OFF; projector registry/delivery vẫn placeholder fail-closed. Không có
> business producer, real projector, controlled replay hay sub-minute `NOTIFY` drain, nên các use case
> bên dưới vẫn là contract target chứ chưa phải delivered product behavior.

---

## 1. Mô tả

Normalize writes thành idempotent commands, persist canonical+outbox atomically, project tới web/Zalo/Messenger/public. Mỗi channel projector resolve `channel_identity_id` gắn đúng provider endpoint (Messenger Page hoặc Zalo bot/OA), authorize target tenant riêng, rồi chọn đúng một route — không broadcast — và không rollback canonical khi delivery fail.

### Entry points

| Entry | Route / Surface | Actor | Mô tả |
|-------|----------------|-------|-------|
| Domain service command | Any write (create/edit/close session, join, payment...) | Host/Player/System | Command → canonical + outbox atomic commit |
| Dispatcher (pg-boss) | Queue claim pipeline | System | Claim ordered outbox events → projector delivery |
| Zalo projector | Zalo DM adapter | System | Resolve endpoint-bound identity → send |
| Messenger projector | Messenger Send API adapter | System | Resolve Page-scoped identity → send (24h window) |
| Web projector (SSE) | Postgres `LISTEN/NOTIFY` → SSE | System | Realtime push to web clients |
| Public projector | `public_sessions` materialized view | System | Update/remove public listing |
| Reproject CLI | `pnpm ops:reproject` | Ops | Rebuild derived projections from canonical |

### Bất biến

- PostgreSQL/domain model là **source of truth duy nhất** — surfaces KHÔNG reconcile bằng cách write local state ngược lại.
- Duplicate command trả previous semantic result — duplicate event/delivery là no-op.
- Ordering key theo **aggregate/session**, không phải tenant-wide (khi có thể).
- Partial projector success tracked per projector — 1 fail KHÔNG block others indefinitely.
- Reachability của kênh gắn exact `channel_identity_id`; quyền gửi cho target tenant là check riêng. Một logical notification chỉ chọn một endpoint route, không broadcast qua nhiều Page/bot/OA.

---

## 2. Use Cases + Edge Cases

### Use Cases

| ID | Actor | Hành động | Kết quả |
|---|---|---|---|
| SYN-UC-1 | Host (any surface) | Gửi command (create/edit/close) | Command ID → domain service → state + command deduped + outbox commit |
| SYN-UC-2 | System | Dispatcher claim ordered events | Tạo projector delivery records |
| SYN-UC-3 | Zalo/Messenger Projector | Nhận event | Resolve exact endpoint-bound `channel_identity_id`, authorize target tenant riêng, rồi edit/send idempotently qua đúng một Zalo bot/OA hoặc Messenger Page (Messenger: cửa sổ 24h) |
| SYN-UC-4 | Web Projector | Nhận event | Push SSE/invalidation → client refetch canonical |
| SYN-UC-5 | Public Projector | Nhận event | Update/remove public session listing |
| SYN-UC-6 | Web client | Realtime disconnect | Fallback refetch/polling — không mất data |
| SYN-UC-7 | Admin | Reproject command | Rebuild 1/all derived projections từ canonical state |
| SYN-UC-8 | System | Zalo/Messenger message gửi fail | Retry → replacement message + surface-ref update |
| SYN-UC-9 | Messenger dispatcher | Central và tenant Page đều reachable | Chọn tenant Page; suppress central bằng logical notification dedup |
| SYN-UC-10 | Zalo dispatcher | Nhiều bot/OA identity hoặc tenant context cùng tồn tại | Chỉ route qua exact bot/OA của endpoint-bound identity sau target-tenant authorization; không broadcast |
| SYN-UC-11 | System | Event processing 1 projector fail | Track failure per projector, others continue |
| SYN-UC-12 | System | DLQ threshold reached | Alert → operator review |

### Edge Cases

| # | Category | Case | Hành vi bắt buộc |
|---|----------|------|-------------------|
| 1 | Data Integrity | Surface write local state back | ❌ NEVER — canonical is source of truth |
| 2 | Concurrency | Duplicate command (same command ID) | Return previous semantic result — idempotent |
| 3 | Concurrency | Duplicate event delivery | No-op — delivery key deduplicate |
| 4 | Data Integrity | Out-of-order events cùng aggregate | Ordering key enforced per aggregate/session — reject regressed version |
| 5 | Resilience | Zalo/Messenger message reference missing | Trigger replacement + surface-ref update |
| 6 | Resilience | Realtime SSE disconnect | Client falls back to refetch/polling — không data loss |
| 7 | Security | Public projector expose private data | Strict whitelist — delete private/closed/expired sessions |
| 8 | Security | Reproject replay external side effects | ❌ CANNOT replay blindly — authorized/rate-limited/audited |
| 9 | Resilience | Partial projector success | Track per projector — 1 fail independent, others continue |
| 10 | Resilience | Projector exhausts retries | Move to DLQ → alert policy — không retry vô hạn |
| 11 | Security | Realtime topic tenant leak | Enforce tenant/person authz per topic subscription |
| 12 | Data Integrity | Projector lag > SLO | Expiry guard prevents stale data — log SLO breach |
| 13 | Security | Reachable identity nhưng không authorized cho target tenant | Fail closed; không suy tenant từ reachability và không thử broadcast endpoint khác |

---

## 3. Screens & States

| Surface | Screen | Loading | Ready | Error | Empty |
|---------|--------|---------|-------|-------|-------|
| Web P4 | Any page with sync | "Đang lưu..." indicator | "✅ Đã lưu" | "⚠️ Đã lưu, đang đồng bộ..." (sync warning) | N/A |
| Web P4 | Offline/disconnect | "🔌 Mất kết nối — đang thử lại..." | Auto-recover + refetch | "❌ Không kết nối được — reload" | N/A |
| Web P4 | Admin reproject | "Đang rebuild..." | "✅ Reproject hoàn tất" | "⚠️ X/Y projectors failed" | N/A |

> UI phân biệt rõ: **canonical save success** (data safe) vs **delivery warning** (sync lag).

---

## 4. Domain Model

| Entity | Vai trò | Key constraints |
|--------|---------|-----------------|
| `processed_commands` | Command dedup registry | `UNIQUE(tenant_id, command_id)`, stored semantic result |
| `outbox_events` | Ordered event stream | `UNIQUE(aggregate_id, sequence)`, `claimed_at` nullable |
| `projector_deliveries` | Per-projector delivery tracking | `UNIQUE(event_id, projector)`, `status`, `attempts` |
| `surface_refs` | External reference tracking (Zalo/Messenger message_id, etc.) | `UNIQUE(aggregate_id, platform, target)` |

### Sync Pipeline

```text
Surface → Command → Domain Service → [State + Deduped Command + Outbox] COMMIT
                                              ↓
                              Dispatcher (pg-boss) claims ordered events
                                              ↓
                         ┌──────────┬──────────┬──────────┐
                         │ Ch Proj  │ Web Proj │ Pub Proj │
                         │ (edit/   │ (SSE     │ (search  │
                         │  send)   │  push)   │  index)  │
                         └──────────┴──────────┴──────────┘
                              ↓ fail? → retry → DLQ → alert
```

---

## 5. Analytics Events

| Event | Khi nào | Payload tối thiểu |
|-------|---------|-------------------|
| `sync_command_received` | Command enters pipeline | `tenant_id`, `aggregate_type`, `command_type`, `source` (web/chat/webhook) |
| `sync_projected` | Projector success | `tenant_id`, `projector`, `lag_ms` |
| `sync_projection_failed` | Projector exhaust retries | `tenant_id`, `projector`, `error_class` |
| `sync_reproject_triggered` | Admin reproject | `tenant_id`, `scope` (one/all), `actor_id` |
| `sync_slo_breach` | Lag > SLO threshold | `tenant_id`, `projector`, `lag_ms`, `threshold_ms` |

---

## 6. Acceptance Criteria

- [ ] State + command dedupe + outbox commit atomically
- [ ] Per-projector delivery ledger prevents duplicate side effects
- [ ] Aggregate ordering prevents roster/state regression
- [ ] Failed projector retries independently, reaches DLQ/alert policy
- [ ] Reproject repairs Zalo/Messenger/public/web derived state
- [ ] Messenger Page và Zalo bot/OA đều resolve exact endpoint-bound `channel_identity_id`; target-tenant authorization được check riêng
- [ ] Mỗi logical notification chọn đúng một route (Messenger tenant→central priority; Zalo exact bot/OA), không broadcast/no-double-send
- [ ] Realtime topics enforce tenant/person authz, recover after disconnect
- [ ] Public projection invariant passes under replay
- [ ] SLO: p95 ≤3s, p99 ≤10s — load tests pass

---

## 7. Open Questions / Changelog

### Open Questions

| ID | Quyết định | Trạng thái |
|---|---|---|
| SYN-OQ-1 | Realtime web transport | ✅ SSE + Postgres `LISTEN/NOTIFY` (DD-07) |
| SYN-OQ-2 | Event retention/replay horizon và DLQ operator UX | ⬜ Chưa chốt |

### Changelog

| Date | Version | Thay đổi |
|---|---|---|
| 2026-08-10 | v2.6 | **A-grade upgrade:** thêm Entry points table (7 entries); bump version. Không đổi contract/pipeline model. |
| 2026-07-28 | v2.5 | Re-pin as-built overlay to `main@784bc8d`; docs-only Chat authority commits do not add Sync producers/projectors/E2E, and schedule remains OFF/placeholder. |
| 2026-07-27 | v2.4 | Current-state mirror: shared job lease/ack + preflight/dispatcher/scheduler đã merge nhưng disabled/placeholder; business producer/projectors/replay/sub-minute drain và E2E vẫn chưa có. |
| 2026-07-19 | v2.3a | Metadata sweep (index v2.35): thêm trường **Implementation** đồng bộ BUILD-STATUS (Not started). Không đổi contract. |
| 2026-07-17 | v2.3 | Reconcile canonical stores/keys: `processed_commands UNIQUE(tenant_id,command_id)`, ordered outbox key và `surface_refs(aggregate_id,platform,target)`; pin exact endpoint-bound identity + separate target-tenant authorization + one-route/no-broadcast cho cả Messenger và Zalo; sửa duplicate use-case IDs. |
| 2026-07-17 | v2.2 | **DD-65..68:** hybrid Messenger endpoint selection, Page-scoped reachability and one-route logical dedup. |
| 2026-06-18 | v1.0 | Initial spec (English format) |
| 2026-06-19 | v2.0 | Chuẩn hoá Vietnamese numbered, thêm 10 use cases, 12 edge cases, pipeline diagram, SLO targets |
| 2026-07-10 | v2.1 | **DD-37 channel pivot:** projector fan-out Zalo DM / Messenger (cửa sổ 24h) / web SSE / public projection — bỏ TG projector; "Messenger P4.8" cũ → **phase-1 P2.5**. Nội dung sync pipeline/SLO không đổi. |
