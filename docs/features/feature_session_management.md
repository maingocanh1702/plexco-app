# Feature: Session Management — Product/UX Spec

> **Canonical phase:** P2 (chat CRUD) · P4 (web parity)  
> **Track:** 📋 Session CRUD  
> **Version:** 2.9a · 2026-07-17
> **Status:** Reviewed  
> **Prerequisites:** P0–P1 foundation stable · P2 tenant routing/authz  
> **Tài liệu liên quan:** `../product/BRD.md` FR-2 · `../product/PRD.md` FLOW 2 · `../product/TDD.md` §3.2/3.8 · `../standards/decisions.md` DD-37/**DD-65..68** · `BE/feature_session_management_tech.md`

> **Cập nhật v3.4 (DD-37, 2026-07-10):** kênh phase-1 = **Zalo + Messenger** + web (bỏ Telegram). **Giá theo giới tính** (giá nam/nữ) nay **✅ phase-1** — xem **DD-39 (✅ Chốt)** / `feature_user_settings.md`; schema giới tính sống ở `feature_user_settings`, KHÔNG thêm vào doc này (chỉ pointer).

---

## 1. Mô tả

Cho phép host (TenantAdmin) tạo, sửa, thông báo, đóng và huỷ **session thể thao đa môn** — với time, venue, price, capacity, visibility và join policy nhất quán. P2 deliver qua **Zalo + Messenger admin commands**; trên Messenger host dùng được **central Plexco Page hoặc optional Page riêng của club** với chức năng cơ bản tương đương. P4 bổ sung web parity và event projections.

**Ngoài phạm vi:** Đặt sân (court booking), chấm điểm theo môn (sport-specific scoring) — **được theo dõi riêng ở `feature_session_organize.md` + `BE/feature_session_organize_tech.md` (DD-61..64 ✅ accept-in-principle, build post-P4)**; pointer only, không thêm scope organize vào body Reviewed này.

### Bất biến

- Chat và web gọi **cùng domain service** — không duplicate logic.
- Session luôn gắn `tenant_id` — RLS choke-point.
- Capacity không bao giờ bị vượt (concurrent join/capacity change lock session).
- Giá thay đổi sau khi đã charge → bắt buộc preview + explicit policy.
- Venue chi tiết (tên, SĐT, bản đồ) chỉ hiện sau join/approval — area là public whitelist.
- Messenger `/newsession` dùng một durable wizard owner ở pre-dispatch boundary; mỗi bước/final confirm re-check `session.manage`, tenant context và snapshot. Central/tenant Page chỉ là adapter/context surface, không chứa business rule riêng.

---

## 2. Use Cases + Edge Cases

### Use Cases

| ID | Actor | Hành động | Kết quả |
|---|---|---|---|
| SES-UC-1 | Host | Tạo session one-off | Session open (private/public) với validated fields |
| SES-UC-2 | Host | Tạo recurring template | Instances tương lai generated idempotently theo tenant timezone |
| SES-UC-3 | Host | Announce lên linked group | Một canonical announcement reference lưu DB |
| SES-UC-4 | Host | Sửa time/price/capacity/visibility | Command writes canonical state + outbox event |
| SES-UC-5 | Host | Đóng session | Không nhận join mới; public projection removed |
| SES-UC-6 | Host | Huỷ session | Roster/paid impact hiện preview; refund-needed policy applied |
| SES-UC-7 | Host (Web) | Sửa session qua web P4 | Cùng service/validation như chat |
| SES-UC-8 | Player | Join session public | Request → auto-approve hoặc host-approve tuỳ policy; nếu full thì cả hai path vào `waitlisted`, không charge/venue |
| SES-UC-9 | Player | Leave session trước giờ chơi | Player → `left`, slot giải phóng → **auto-promote waitlist ATOMICALLY** (DD-45 ✅): `waitlisted` không chiếm capacity/charge; promote derive giá trước mutation rồi tạo charge + clear position + eligibility re-check. DD-39 derivation fail giữ candidate waitlisted/no-charge/no-venue, audit+retry, không rollback leave và xét candidate kế. Total order `waitlist_position, joined_at, id`; leave/capacity increase fill toàn bộ `slots_max-active_count`, `slots_max→NULL` fill mọi eligible; decrease dưới active roster reject. Xem `../dd-45-waitlist-analysis.md`. |
| SES-UC-10 | System | Auto-close session hết giờ | Status → closed, projection removed |
| SES-UC-11 | Host (Messenger central/tenant Page) | Chạy `/newsession` | Role-aware tenant picker nếu cần → wizard → preview → confirm → đúng một shared `CreateSession` command |

### Edge Cases

| # | Category | Case | Hành vi bắt buộc |
|---|----------|------|-------------------|
| 1 | Data Integrity | `ends_at` ≤ `starts_at` | Reject — end phải sau start. Ref: BL-DATA-1 |
| 2 | Data Integrity | Sport key không tồn tại trong taxonomy | Reject — chỉ accept từ active sport taxonomy |
| 3 | Concurrency | Giảm `slots_max` xuống dưới active roster | Reject `CAPACITY_BELOW_ROSTER`; không kick/evict hay mutation ngầm |
| 4 | Concurrency | 2 players join đồng thời, chỉ còn 1 slot | Transaction lock — first-commit-wins; second vào `waitlisted` với position dương, không charge/venue |
| 5 | Financial | Price change sau khi đã có charges | Preview bắt buộc: existing charges giữ nguyên HOẶC adjustment entries — KHÔNG silent mutation |
| 6 | Security | Venue details leak trước join | Chỉ hiện area (quận/khu vực). Chi tiết sau join/approval |
| 7 | Data Integrity | Visibility public thiếu discovery fields | Reject — required fields: sport, area, starts_at, slots_max |
| 8 | Data Integrity | Visibility private → remove projection | Immediate remove từ public search |
| 9 | Data Integrity | Recurrence qua DST boundary | Handle deterministically — dùng IANA timezone + occurrence idempotency key |
| 10 | Resilience | Announcement gửi group fail | KHÔNG rollback canonical write — projector retries/reprojects |
| 11 | Security | Mutation on closed/cancelled/past session | Reject mọi mutation — trừ privileged correction với audit trail |
| 12 | Security | Non-admin cố sửa session | 403 — routing ≠ authz. Ref: tenant_routing_authz |
| 13 | Financial | Player đã `left` tự join lại cùng session | Chạy join/gating/ban bình thường. Chưa refund → carry-over obligation/allocation; đã refund → obligation lifecycle mới qua correction core; không double charge. Chưa chứng minh được disposition → `REJOIN_REQUIRES_REVIEW`, không mutation |
| 14 | Financial/Resilience | Active join hoặc promotion không suy được amount do KMS/decrypt/price error | Direct active join aborts, không player/charge/venue; promotion giữ waitlisted/no-charge/no-venue + audit + đúng một canonical failure outbox event cho retry/owner-alert consumers, leave/capacity opener vẫn commit và xét candidate kế; không fallback giá |
| 15 | Security/State | Messenger wizard stale/expired/context-switch/non-admin | Clear/deny fail-closed; final confirm không tạo partial/duplicate session |

---

## 3. Screens & States

| Surface | Screen | Loading | Ready | Error | Empty |
|---------|--------|---------|-------|-------|-------|
| Bot (Zalo/Messenger) | `/newsession` wizard | Typing indicator | Step-by-step input (sport → time → venue → price → capacity → visibility) | Inline error per field ("Giờ kết thúc phải sau giờ bắt đầu") | N/A (wizard luôn có content) |
| Bot (Zalo/Messenger) | Session detail (`/status`) | "Đang tải..." message | Roster + payment status + session info | "Không tìm thấy session" | N/A |
| Bot (Zalo/Messenger) | Session cancel confirm | — | Preview: roster count, paid amount, refund responsibility | — | N/A |
| Web P4 | Session list | Skeleton rows | Table/card list sortable by date | Error banner + retry | "Chưa có buổi chơi nào" + CTA "Tạo buổi mới" |
| Web P4 | Session create/edit form | Skeleton form | Full form with validation | Inline errors per field | N/A |
| Web P4 | Session detail | Skeleton cards | Roster + QR + payments + timeline | Error banner | N/A |

---

## 4. Domain Model

| Entity | Vai trò | Key constraints |
|--------|---------|-----------------|
| `sessions` | Buổi chơi chính | `tenant_id` FK, `sport_id` FK, `starts_at/ends_at` timestamptz, `slots_max` nullable/positive, `visibility` enum (private/public), `status` enum |
| `players` | Player tham gia/waitlist | `UNIQUE(tenant_id, session_id, membership_id)`, `status ∈ active\|left\|waitlisted`; waitlisted có position dương |
| `session_surface_refs` | Reference message/session trên từng surface | `tenant_id`, `session_id`, `platform`, `target`, `external_ref`; unique `(session_id, platform, target)` |
| `session_recurrence_rules` + `session_occurrences` | Template lặp + occurrence idempotent | `rrule`, IANA `timezone`, `last_generated_at`; unique `(recurrence_rule_id, local_occurrence_key)` |

### State Machine

```mermaid
stateDiagram-v2
    [*] --> draft
    draft --> open: Host publish
    open --> closed: Host close / auto (hết giờ)
    open --> cancelled: Host cancel
    closed --> [*]
    cancelled --> [*]
    note right of open: Accepts join/leave
    note right of closed: No new joins, read-only
    note right of cancelled: Read-only, refund flag
```

---

## 5. Analytics Events

| Event | Khi nào | Payload tối thiểu |
|-------|---------|-------------------|
| `session_created` | Host tạo session thành công | `tenant_id`, `session_id`, `sport_id`, `visibility`, `source` (chat/web) |
| `session_updated` | Host sửa bất kỳ field | `tenant_id`, `session_id`, `fields_changed[]`, `source` |
| `session_announced` | Announcement gửi thành công | `tenant_id`, `session_id`, `channel` |
| `session_closed` | Session đóng (manual/auto) | `tenant_id`, `session_id`, `close_reason` (manual/auto) |
| `session_cancelled` | Host huỷ | `tenant_id`, `session_id`, `roster_count`, `has_paid` |
| `session_projection_failed` | Projector fail | `tenant_id`, `session_id`, `error_code` |

> Không bao giờ log roster names, venue details, contact info trong analytics.

---

## 6. Acceptance Criteria

- [ ] Chat và web gọi cùng domain service — không duplicate logic
- [ ] Host tạo session cơ bản thành công trên cả central Page và tenant Page; club không Page không bị buộc sang web
- [ ] Messenger role/tenant picker + wizard cancel/expiry/context-switch/replay/non-admin tests pass; duplicate confirm chỉ tạo một session
- [ ] Timezone, sport, price, capacity, visibility và join-policy validations pass
- [ ] Concurrent capacity/join operations không thể over-fill (lock test)
- [ ] Waitlisted không chiếm capacity/charge/venue; position dương + total order; promote tạo charge/clear position/notify atomically
- [ ] Active leave/capacity increase fill toàn bộ slot available; finite→unlimited fill mọi eligible; decrease dưới active roster reject
- [ ] Existing `active|waitlisted` join lại trả current outcome idempotently; existing `left` re-activate theo DD-49 khi correction core chứng minh được refunded/carry-over disposition; unknown/unimplemented → `REJOIN_REQUIRES_REVIEW` fail-closed
- [ ] Mọi active join/promotion derive amount trước mutation: direct join fail thì không player/charge/venue; promotion fail giữ candidate waitlisted/no-charge/no-venue, audit+retry một lần, không rollback opener; không fallback giá
- [ ] Price/cancel changes khi đã có charge → bắt buộc explicit impact handling
- [ ] Public/private/closed projection behavior correct (projector test)
- [ ] Recurring generation idempotent và timezone-safe (DST test)
- [ ] Announcement reproject works sau provider failure
- [ ] Chỉ TenantAdmin mutate sessions — non-admin nhận 403

---

## 7. Open Questions / Changelog

### Open Questions

| ID | Quyết định | Trạng thái |
|---|---|---|
| SES-OQ-1 | Behavior khi host change price mà đã có charges | ✅ **Chốt DD-49/v1.37** — host chọn per-change: append signed obligation adjustment hoặc grandfather; allocation reversal chỉ đảo tiền đã nhận, không phải price adjustment. Rejoin thường: chưa refund carry-over, đã refund append obligation lifecycle mới; không mặc định row `charges` thứ hai. Storage/API chờ mutation-path design-probe live UNIQUE charge/player/session. |
| SES-OQ-2 | Recurrence editing: sửa 1 occurrence hay this-and-future? | ⬜ Chưa chốt |
| SES-OQ-3 | Waitlist + auto-promote | ✅ **Chốt DD-45** — thuộc Reviewed contract; schema/code migration pending build |
| SES-OQ-4 | Field mô tả session + gating (title/notes/`session_type`/byoe/cost_shared + gating level-rank/gender/age) | ✅ **Chốt DD-41** — enforce ở shared `evaluateSessionEligibility`←`addMemberToSession`, self-attested, 9 exact codes; body/schema propagate lúc build → `../dd-41-session-fields-gating-analysis.md` |
| SES-OQ-5 | No-show/attendance/reliability + policy deprioritize/ban | ✅ **Chốt DD-42** — per-tenant (attendance trên `players`, reliability trên `memberships`, RLS, không public); build P4+ → `../dd-42-reliability-analysis.md` |
| SES-OQ-6 | Nhãn thành viên + audience targeting khi announce | ✅ **Chốt DD-43** — `membership_tags` per-tenant chỉ cho notification audience; join eligibility vẫn DD-41; public không lộ tag; build P4+ → `../dd-43-membership-tags-analysis.md` |
| SES-OQ-7 | Invite-link token cho kèo private | ✅ **Chốt DD-44** — `session_invite_tokens` (entropy ≥128-bit/hash/bound/used_count-on-redeem); redeem vẫn qua join_policy+gating; không hạ visibility → `../dd-44-invite-token-analysis.md` |

### Changelog

| Date | Version | Thay đổi |
|---|---|---|
| 2026-07-17 | v2.9a | §1 Ngoài phạm vi: thêm **pointer** court booking + scoring → `feature_session_organize` (DD-61..64 🟡 proposal, post-phase-1). Pointer-only, không thêm scope organize vào body Reviewed (cùng pattern one-line pointer DD-39 ở v2.1). |
| 2026-07-17 | v2.9 | **DD-65..68:** host create-session parity trên central+optional tenant Page; durable pre-dispatch wizard, protected tenant context, final AuthZ/snapshot re-check và idempotent shared command acceptance. |
| 2026-07-16 | v2.8 | **Full DD-49 propagation:** body/edge/AC thay left-rejoin reject mặc định bằng normal rejoin + carry-over/refunded disposition; giữ `REJOIN_REQUIRES_REVIEW` chỉ cho unknown/unimplemented correction state. Price change dùng signed obligation adjustment contract, không giả định delta/new `charges` row. Authority: decisions v1.37. |
| 2026-07-15 | v2.6 | **DD-39×DD-45 failure contract:** promotion derive amount trước mutation; derivation fail giữ waitlisted/no-charge/no-venue, audit+retry/owner-alert, không rollback leave/capacity opener và tiếp tục candidate kế. |
| 2026-07-15 | v2.5 | **Propagation (light):** neo DD-41 (session fields+gating), DD-42 (attendance/reliability), DD-43 (membership_tags audience), DD-44 (invite token) vào Open Questions với pointer file phân tích. Decision-level đã ✅; body/schema/migration propagate lúc build slice (không đổi Reviewed body). |
| 2026-07-15 | v2.4 | **DD-45 closure:** pin open/approval full→waitlisted và `left` self-rejoin fail-closed `REJOIN_REQUIRES_REVIEW`; không reuse/duplicate charge khi refund/void policy còn mở. |
| 2026-07-15 | v2.3 | **DD-45 ✅:** pin waitlist state-shape/positive position, total order, atomic charge-on-promote, fill-available/unlimited capacity boundaries, skip-on-ineligible và giữ `CAPACITY_BELOW_ROSTER`; code/migration vẫn pending. |
| 2026-06-18 | v1.0 | Initial spec (English format) |
| 2026-06-19 | v2.0 | Chuẩn hoá Vietnamese numbered format, thêm 10 use cases, 12 edge cases, state machine, screen states chi tiết |
| 2026-07-10 | v2.1 | **DD-37:** kênh phase-1 = Zalo + Messenger (bỏ Telegram); screens "TG Bot" → "Bot (Zalo/Messenger)". Thêm **one-line pointer giá theo giới tính → DD-39 (proposal) / feature_user_settings** (không thêm schema giới tính vào body Reviewed). |
| 2026-07-13 | v2.2 | Reconcile canonical schema vocabulary: `players`, `session_surface_refs`, `session_recurrence_rules/session_occurrences`. SES-UC-9 chỉ giải phóng slot; waitlist auto-promote deferred tới khi DD-45 được chốt + migration. |
| 2026-07-16 | v2.7 | **Propagation (light) DD-49:** SES-OQ-1 ✅ (đổi giá host-choice delta/grandfather; rejoin carry-over thay left-rejoin fail-closed DD-45). Body/schema từng defer build slice; được full-propagate ở v2.8. |
