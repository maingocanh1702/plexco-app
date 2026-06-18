# Feature: Sync Engine & Re-projection — Product/UX Spec

> **Canonical phase:** P4  
> **Track:** 🔄 Sync Engine  
> **Version:** 2.0 · 2026-06-19  
> **Status:** Reviewed  
> **Prerequisites:** P2 canonical domain services · P3 pg-boss/outbox · P4 channel adapters  
> **Tài liệu liên quan:** `../core/BRD.md` FR-4 · `../core/PRD.md` FLOW 14 · `../core/TDD.md` §3.8 · BRD OD-7 · `BE/feature_sync_engine_tech.md`

---

## 1. Mô tả

Normalize writes từ web/chat/webhooks thành **idempotent commands**, persist canonical state + outbox atomically, project changes tới web/TG/Zalo/public và **repair derived surface state**. Messenger adapter deliver P4.8.

### Bất biến

- PostgreSQL/domain model là **source of truth duy nhất** — surfaces KHÔNG reconcile bằng cách write local state ngược lại.
- Duplicate command trả previous semantic result — duplicate event/delivery là no-op.
- Ordering key theo **aggregate/session**, không phải tenant-wide (khi có thể).
- Partial projector success tracked per projector — 1 fail KHÔNG block others indefinitely.

---

## 2. Use Cases + Edge Cases

### Use Cases

| ID | Actor | Hành động | Kết quả |
|---|---|---|---|
| SYN-UC-1 | Host (any surface) | Gửi command (create/edit/close) | Command ID → domain service → state + command deduped + outbox commit |
| SYN-UC-2 | System | Dispatcher claim ordered events | Tạo projector delivery records |
| SYN-UC-3 | TG Projector | Nhận event | Edit/send TG message idempotently |
| SYN-UC-4 | Web Projector | Nhận event | Push SSE/invalidation → client refetch canonical |
| SYN-UC-5 | Public Projector | Nhận event | Update/remove public session listing |
| SYN-UC-6 | Web client | Realtime disconnect | Fallback refetch/polling — không mất data |
| SYN-UC-7 | Admin | Reproject command | Rebuild 1/all derived projections từ canonical state |
| SYN-UC-8 | System | TG message gửi fail | Retry → replacement message + surface-ref update |
| SYN-UC-9 | System | Event processing 1 projector fail | Track failure per projector, others continue |
| SYN-UC-10 | System | DLQ threshold reached | Alert → operator review |

### Edge Cases

| # | Category | Case | Hành vi bắt buộc |
|---|----------|------|-------------------|
| 1 | Data Integrity | Surface write local state back | ❌ NEVER — canonical is source of truth |
| 2 | Concurrency | Duplicate command (same command ID) | Return previous semantic result — idempotent |
| 3 | Concurrency | Duplicate event delivery | No-op — delivery key deduplicate |
| 4 | Data Integrity | Out-of-order events cùng aggregate | Ordering key enforced per aggregate/session — reject regressed version |
| 5 | Resilience | TG message reference missing | Trigger replacement + surface-ref update |
| 6 | Resilience | Realtime SSE disconnect | Client falls back to refetch/polling — không data loss |
| 7 | Security | Public projector expose private data | Strict whitelist — delete private/closed/expired sessions |
| 8 | Security | Reproject replay external side effects | ❌ CANNOT replay blindly — authorized/rate-limited/audited |
| 9 | Resilience | Partial projector success | Track per projector — 1 fail independent, others continue |
| 10 | Resilience | Projector exhausts retries | Move to DLQ → alert policy — không retry vô hạn |
| 11 | Security | Realtime topic tenant leak | Enforce tenant/person authz per topic subscription |
| 12 | Data Integrity | Projector lag > SLO | Expiry guard prevents stale data — log SLO breach |

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
| `commands` | Command dedup registry | `UNIQUE(command_id)`, `status` enum (processed/rejected) |
| `outbox_events` | Ordered event stream | `aggregate_id`, `sequence`, `claimed_at` nullable |
| `projector_deliveries` | Per-projector delivery tracking | `UNIQUE(event_id, projector)`, `status`, `attempts` |
| `surface_refs` | External reference tracking (TG message_id, etc.) | `UNIQUE(aggregate_id, surface, ref_type)` |

### Sync Pipeline

```text
Surface → Command → Domain Service → [State + Deduped Command + Outbox] COMMIT
                                              ↓
                              Dispatcher (pg-boss) claims ordered events
                                              ↓
                         ┌──────────┬──────────┬──────────┐
                         │ TG Proj  │ Web Proj │ Pub Proj │
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
- [ ] Reproject repairs TG/public/web derived state
- [ ] Realtime topics enforce tenant/person authz, recover after disconnect
- [ ] Public projection invariant passes under replay
- [ ] SLO: p95 ≤3s, p99 ≤10s — load tests pass

---

## 7. Open Questions / Changelog

### Open Questions

| ID | Quyết định | Trạng thái |
|---|---|---|
| SYN-OQ-1 | BRD OD-7: SSE/WebSocket/polling — baseline contract transport-neutral | ⬜ Chưa chốt |
| SYN-OQ-2 | Event retention/replay horizon và DLQ operator UX | ⬜ Chưa chốt |

### Changelog

| Date | Version | Thay đổi |
|---|---|---|
| 2026-06-18 | v1.0 | Initial spec (English format) |
| 2026-06-19 | v2.0 | Chuẩn hoá Vietnamese numbered, thêm 10 use cases, 12 edge cases, pipeline diagram, SLO targets |
