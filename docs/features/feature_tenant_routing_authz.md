# Feature: Tenant Routing & Admin Authorization — Product/UX Spec

> **Canonical phase:** P2  
> **Track:** 🔐 Routing & AuthZ  
> **Version:** 2.0 · 2026-06-19  
> **Status:** Reviewed  
> **Prerequisites:** P0–P1 foundation stable  
> **Tài liệu liên quan:** `../core/BRD.md` BR-1/BR-3/BR-12 · `../core/PRD.md` §2 + §4.2/4.3 · `../core/TDD.md` §3.3–3.5 · `BE/feature_tenant_routing_authz_tech.md`

---

## 1. Mô tả

Route mọi Telegram/admin interaction tới **đúng tenant** từ trusted channel bindings, sau đó authorize admin commands **độc lập** với routing. P2 cover: shared TG bot, group/admin link, player DM context, TenantAdmin roles. Zalo/Page routing deliver ở channel specs sau.

### Bất biến

- Routing **KHÔNG BAO GIỜ** resolve tenant từ message text, pay code, username hay client-supplied tenant ID.
- Routing **KHÔNG BAO GIỜ** grant authorization — đây là 2 bước tách biệt.
- Link code phải high-entropy, short-lived, single-use, bound to tenant/role.
- Fail-closed: nếu không resolve được tenant → reject, không guess.

---

## 2. Use Cases + Edge Cases

### Use Cases

| ID | Actor | Hành động | Kết quả |
|---|---|---|---|
| RTE-UC-1 | Owner | Mở one-time admin link + add bot vào group | TenantAdmin + TelegramLink created atomically |
| RTE-UC-2 | System | Group command/callback arrives | `chat_id → tenant`; session thuộc cùng tenant |
| RTE-UC-3 | Admin | DM arrives | Bound admin context hoặc explicit tenant picker |
| RTE-UC-4 | Player | Mở `club_<slug>` deep link | Sticky context only — KHÔNG grant membership/admin |
| RTE-UC-5 | Player | Thuộc nhiều clubs, DM bot | Valid sticky context hoặc picker nếu ambiguous |
| RTE-UC-6 | Non-admin | Chạy admin command | 403/Telegram denial — no mutation |
| RTE-UC-7 | System | Tenant bị suspended | Admin mutation blocked; ingestion/safety paths vẫn hoạt động |
| RTE-UC-8 | Owner | Rebind group sang tenant mới | Require owner confirmation + audit trail |
| RTE-UC-9 | Admin | Telegram account bị mất | Support runbook — owner recovery path |
| RTE-UC-10 | System | Rate limit link attempts | Block sau N attempts/window — fail closed |

### Edge Cases

| # | Category | Case | Hành vi bắt buộc |
|---|----------|------|-------------------|
| 1 | Security | Resolve tenant từ message text | ❌ NEVER — chỉ dùng trusted bindings (chat_id, link code) |
| 2 | Security | Link code reuse | ❌ Single-use — consumed/expired/revoked. Ref: BL-SEC-2 |
| 3 | Security | Link code brute force | Rate-limit per IP/actor. Ref: BL-SEC-5 |
| 4 | Concurrency | Group callback: chat binding ≠ session tenant | Reject — validate chat binding, callback session tenant, actor riêng biệt |
| 5 | Data Integrity | Sticky context stale (membership/link đã xoá) | Invalidate — fail closed. Không dùng stale context |
| 6 | Data Integrity | TG group migration/new chat ID | Require explicit rebind với audit trail |
| 7 | Data Integrity | 1 chat bound 2 tenants | ❌ Không cho phép — rebind require owner confirmation |
| 8 | Security | TG username thay đổi | Không ảnh hưởng auth — dùng stable numeric user ID |
| 9 | Security | Shared bot token leak | Platform-wide blast radius — secret rotation/runbook required |
| 10 | Security | Admin command from non-admin | 403 — routing thành công ≠ có quyền |
| 11 | Security | Suspended tenant admin cố mutate | Block mutation — chỉ cho read + system safety paths |
| 12 | Cross-Feature | Routing thành công nhưng authz fail | Trả lỗi authz, KHÔNG expose tenant info trong error message |

---

## 3. Screens & States

| Surface | Screen | Loading | Ready | Error | Empty |
|---------|--------|---------|-------|-------|-------|
| TG Bot | Admin link onboarding | "Đang tạo liên kết..." | Link code + hướng dẫn add bot | "Không thể tạo link — thử lại" | N/A |
| TG Bot | Group linked confirmation | — | "✅ Nhóm đã liên kết với [club name]" | "Nhóm này đã liên kết club khác" | N/A |
| TG Bot | Tenant picker (multi-club DM) | — | Inline buttons: list clubs | "Không tìm thấy clubs" | N/A |
| TG Bot | Unauthorized denial | — | "⛔ Bạn không có quyền admin" | — | N/A |
| TG Bot | Suspended tenant | — | "⚠️ Club đang tạm ngưng — liên hệ support" | — | N/A |
| Web P4 | Admin settings / link management | Skeleton | Link list + issue new link CTA | Error banner | "Chưa có nhóm nào liên kết" + CTA |

---

## 4. Domain Model

| Entity | Vai trò | Key constraints |
|--------|---------|-----------------|
| `telegram_links` | Binding group → tenant | `UNIQUE(chat_id)` active, `tenant_id` FK |
| `admin_links` | One-time link codes | `code` unique, `expires_at`, `used_at`, `tenant_id` FK, `intended_role` |
| `memberships` | Person ↔ Tenant relationship | `UNIQUE(person_id, tenant_id)`, `role` enum |

### Link State Machine

```mermaid
stateDiagram-v2
    [*] --> issued
    issued --> consumed: Admin dùng link
    issued --> expired: TTL hết
    issued --> revoked: Owner revoke
    consumed --> [*]
    expired --> [*]
    revoked --> [*]
```

### Routing Resolution Order (TDD §3.4)

```text
1. Group message → chat_id → telegram_links → tenant_id
2. Admin DM → person_id → memberships (role=admin) → 
   - 1 tenant → auto-select
   - N tenants → picker
3. Player DM → sticky context → validate membership still active
4. Deep link → slug → tenant_id (sticky, no admin grant)
5. Fallback → fail closed (403)
```

---

## 5. Analytics Events

| Event | Khi nào | Payload tối thiểu |
|-------|---------|-------------------|
| `tenant_link_issued` | Owner tạo admin link | `tenant_id`, `link_type`, `intended_role` |
| `tenant_chat_linked` | Bot added vào group thành công | `tenant_id`, `channel` (TG/Zalo) |
| `tenant_chat_rebound` | Group rebind sang tenant khác | `tenant_id` (new), `old_tenant_id` (opaque) |
| `admin_command_denied` | Non-admin cố chạy admin command | `tenant_id`, `actor_id` (opaque), `reason_code` |
| `player_context_selected` | Player chọn club trong DM picker | `tenant_id`, `person_id` (opaque) |
| `routing_failed` | Không resolve được tenant | `channel`, `reason_code` |

> Không bao giờ log bot tokens, link codes, message content trong analytics.

---

## 6. Acceptance Criteria

- [ ] Group/admin/player DM routing theo TDD precedence, fail closed
- [ ] Routing KHÔNG BAO GIỜ grant authorization — 2 bước tách biệt
- [ ] Non-admin không thể execute bất kỳ admin mutation
- [ ] Link/rebind: TTL, single-use, rate-limited, audited
- [ ] Callback không thể cross chat/tenant/session boundaries
- [ ] Multi-club DM picker và stale-context invalidation hoạt động
- [ ] Suspended behavior khớp billing contract
- [ ] Tenant A/B routing/authz isolation tests pass

---

## 7. Open Questions / Changelog

### Open Questions

| ID | Quyết định | Trạng thái |
|---|---|---|
| RTE-OQ-1 | Co-admin permission granularity — finalize trước P2 UI polish | ⬜ Chưa chốt |
| RTE-OQ-2 | Owner recovery path khi mất Telegram account — support runbook | ⬜ Chưa chốt |

### Changelog

| Date | Version | Thay đổi |
|---|---|---|
| 2026-06-18 | v1.0 | Initial spec (English format) |
| 2026-06-19 | v2.0 | Chuẩn hoá Vietnamese numbered format, thêm 10 use cases, 12 edge cases, link state machine, routing resolution order, screen states, analytics payload |
