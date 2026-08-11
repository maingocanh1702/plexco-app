# Feature: Shared Host & Player Facebook Messenger Experience — Product/UX Spec

> **Canonical phase:** P2.5 / P4.5 (kênh phase-1 — thay `feature_player_telegram` đã archive)
> **Track:** 📱 Shared Host & Player Messenger
> **Version:** 0.10 · 2026-08-10
> **Status:** Reviewed contract · Implementation pending
> **Implementation:** Not started — shared job mechanics đã merge nhưng Messenger adapter/handler/projector chưa có; schedule OFF/placeholder · authority: `../standards/BUILD-STATUS.md` (Doc status ≠ Implementation status)
> **Prerequisites:** P2 routing/authz · P3.5 identity · P2 session/join · P3 notifications · P4 sync · **App Review Meta** (DD-33)
> **Tài liệu liên quan:** `../product/BRD.md` FR-3.3 / BR-17 / CO-3 · `../standards/decisions.md` **DD-32/DD-33/DD-37/DD-45/DD-49/DD-65..68** · `../channels/messenger/messenger-channel-design.md` · `feature_channel_booking_funnel.md` · `feature_session_management.md` · `feature_tenant_routing_authz.md` · `feature_identity.md` · `../BE/feature_player_messenger_tech.md`

> **Kênh (DD-37 ✅):** Facebook Messenger là kênh phase-1. **Link tài khoản Facebook (DD-33 ✅ phase-1):** App Review/BM verification submission pending; nếu chậm → degrade sang transactional one-time `/link` code.

> **Booking gate (DD-32 ✅):** player luôn được xem time/area/fee/confirmed count/slots trước. Ở final confirm: free vẫn join không cần link/pay; paid + Account-linked được active và pay later; paid + unlinked chỉ active sau verified full payment trong một hold 15 phút. Adapter chỉ render tagged outcome từ shared funnel.

---

## 1. Mô tả

Cho host **tạo/quản lý session cơ bản** và player **discover/join/leave kèo** trên cùng Messenger surface. Plexco central Page luôn dùng được; Page riêng per-club là tuỳ chọn nhưng có capability parity. Cover: role-aware menu, fail-closed context/action routing, durable create-session wizard, quick-reply/postback, cửa sổ 24h và đồng bộ canonical lên web.

**Ràng buộc kênh (CO-3):** Messenger standard messaging trong **cửa sổ 24h**; gửi ngoài cửa sổ chỉ qua cơ chế Meta đủ điều kiện/được phê duyệt → MVP dùng mô hình **"join + xác nhận"**, **nhắc best-effort trong 24h**, fallback **web + Zalo**. **Không inline button** kiểu Telegram → dùng **quick-reply / persistent menu**.

### Entry points

| Entry | Route / Surface | Actor | Mô tả |
|-------|----------------|-------|-------|
| Messenger persistent menu | Central Page / tenant Page | Host/Player | Role-aware menu: tạo session, xem kèo, join, nợ... |
| User DM → bot | Direct message window | Player | Inbound message trigger bot response |
| Central Page → Discover | `m.me/plexco` | Player | Global discovery, eligible-role picker |
| Tenant Page → local | `m.me/<page_id>` | Player | CLB-scoped default context |
| Quick-reply session card | Inline bot response | Player | Session detail → final confirm gate |
| Web handoff (link Account) | `/link/:handoff_id` | Player | Single-use binding callback |
| Webhook receiver | Meta webhook → bot adapter | System | Messenger event ingestion |

### Bất biến

- Page ID resolve **endpoint**; tenant Page pin default club, central Page dùng eligible-role picker. Target tenant/session chỉ từ opaque action/protected public ref/server context, **KHÔNG** từ free text/client body (DD-66).
- **PSID page-scoped:** cùng một người ở 2 Page có PSID khác — link về Person qua verified account identity hoặc transactional one-time `/link` code; không auto-link chéo.
- Identity key là `(platform, provider_scope_lookup_hash, platform_user_lookup_hash)` với HMAC domain-separated cho Page id và PSID; reachability/window gắn `channel_identity_id` (DD-67).
- Bot **KHÔNG** nhắn user trước khi có inbound hợp lệ / trong cửa sổ 24h (Meta policy).
- Meta API/rate-limit fail **KHÔNG** rollback canonical join/payment.
- Duplicate webhook / replay = **idempotent**.
- Hành động join tự **sync lên web** (canonical → projector); tiền/PII không lộ ra kênh công khai.
- Host mutation re-authorize capability/snapshot tại consume/final confirm; adapter gọi cùng Session/Join service với web/Zalo, không lặp business rule.
- Quick-reply chọn session chỉ mở detail/final-confirm state; không được trực tiếp tạo player/charge. Capacity, qualified Account link, payment proof và waitlist đều do shared channel-booking funnel quyết định.

---

## 2. Use Cases + Edge Cases

### Use Cases

| ID | Actor | Hành động | Kết quả |
|---|---|---|---|
| PMS-UC-1 | Host/player/dual-role | Nhắn bot / mở persistent menu | Menu đúng capability; central Page auto-select một club hoặc hiện picker khi có nhiều context |
| PMS-UC-2 | Player | Chọn một session từ quick-reply | Xem time/area/fee/confirmed count/slots; bấm final confirm mới gọi shared funnel: free→active, full→waitlisted, approval→pending, paid→qualified link pay-later hoặc unlinked pay-now |
| PMS-UC-3 | Player | Chọn "Rời kèo" | Financial policy check → leave/block |
| PMS-UC-4 | Player | Xem "Kèo của tôi" | Person-self summary (chỉ dữ liệu của họ) |
| PMS-UC-5 | Player | Xem "Nợ của tôi" | Hiện số tiền còn nợ + QR/hướng dẫn CK |
| PMS-UC-6 | System | Gửi xác nhận đã trả (sau markPaid) | Gửi trong cửa sổ 24h nếu còn mở; ngoài 24h → web + Zalo |
| PMS-UC-7 | System | Nhắc nợ | **Best-effort trong 24h**; ngoài 24h dồn qua web + Zalo (CO-3) |
| PMS-UC-8 | Player | Link Plexco Account từ Messenger | Web-auth/link-code handoff single-use; sau callback bot resume đúng intent và chỉ coi linked khi exact Page-scoped ChannelIdentity + current Person + verified Account cùng owner |
| PMS-UC-9 | System | Roster đổi | Sync projector cập nhật (không double announce) |
| PMS-UC-10 | System | Message ngoài cửa sổ 24h | Không gửi chủ động; chờ inbound / dồn kênh khác |
| PMS-UC-11 | Host | Chọn “Tạo session” / `/newsession` | Wizard thu thập field cơ bản → preview → confirm → đúng một idempotent `CreateSession` command |
| PMS-UC-12 | Host | Xem status/approve/announce/close | Exact capability check; shared handler/domain service; advanced edit có thể deep-link web |
| PMS-UC-13 | Player | Discover từ central hoặc tenant Page | Central = global; tenant Page = local mặc định + “Khám phá tất cả”; opaque action resolve đúng target tenant |
| PMS-UC-14 | Club không có Page | Host và player dùng central Page | Đủ create/join flow cơ bản, không yêu cầu onboarding Page |
| PMS-UC-15 | Player unlinked | Chọn “Thanh toán & giữ chỗ” cho paid session | Khi settlement capability proven: tạo hold 15 phút + exact payment reference; verified full payment mới confirm booking, không nhận screenshot/nút “đã trả” làm proof |

### Edge Cases

| # | Category | Case | Hành vi bắt buộc |
|---|----------|------|-------------------|
| 1 | Security | Routing từ nội dung message | ❌ NEVER — Page ID chỉ resolve endpoint/default; target tenant/resource từ protected resolver |
| 2 | Security | Gửi ngoài cửa sổ 24h | ❌ Không dùng standard send; chỉ gửi nếu có cơ chế Meta đủ điều kiện/được phê duyệt, nếu không fallback web + Zalo |
| 3 | Concurrency | Duplicate webhook / replay | Idempotent — cùng kết quả, không double join |
| 4 | Security | Bot nhắn user chưa có inbound | ❌ KHÔNG — reachability chỉ set sau inbound hợp lệ |
| 5 | Identity | PSID khác giữa 2 Page | Không auto-merge; dùng verified account identity hoặc transactional `link_code` |
| 6 | Resilience | Meta API rate-limit/timeout | Retry backoff — KHÔNG rollback canonical |
| 7 | Data Integrity | Announcement/roster reproject | Projector dedup — edit thay vì gửi mới |
| 8 | Security | Lộ nợ/tên ra kênh không riêng tư | Nhắc đi DM riêng; không lộ số tiền/tên |
| 9 | Ops | App Review chưa duyệt (DD-33) | Degrade: transactional one-time `/link` code; kênh nhắc chính = web + Zalo |
| 10 | Cross-Feature | Account merge → PSID context cũ | Invalidate context cũ — dùng merged person |
| 11 | Financial | Paid/partial player rời kèo | Financial policy check — có thể cần host review |
| 12 | Security | Page token leak | Blast radius theo đúng Page (central hoặc tenant); rotation/runbook + audit; token không vào tenant query/log |
| 13 | Concurrency | Hai final-confirm ở slot cuối | Shared occupancy đếm active + live payment holds: đúng một outcome giữ/chiếm slot; người sau waitlisted, không charge/venue |
| 14 | Financial | Existing player đã `left` join lại | Route shared DD-49 join/correction handler; render active/waitlisted/carry-over outcome. Chỉ render `REJOIN_REQUIRES_REVIEW` khi core trả unknown/unimplemented; adapter không tự mutate ledger |
| 15 | Security | Stale/wrong/replayed action token | Deny/re-render choices; token bound actor+Page, TTL, target, snapshot/version; raw ID không có authority |
| 16 | State | Wizard context-switch/cancel/expire | Một pre-dispatch owner clear state; final confirm luôn re-authorize/revalidate, không partial create |
| 17 | Delivery | Cả central và tenant Page đều reachable | Chọn tenant Page rồi central fallback; logical notification chỉ gửi một route |
| 18 | Payment | Paid + unlinked, provider unavailable/unknown | Không phát QR/hold; offer “Liên kết Plexco” hoặc “Tiếp tục trên web”, free/linked path vẫn hoạt động |
| 19 | State | Link callback và payment callback cùng lúc | Một intent/finalizer quyết định terminal outcome; không duplicate player/charge/allocation |
| 20 | Fairness | Promotion hold hết hạn | Release slot, audit, requeue player về cuối hàng đúng một lần và tiếp tục selector; không lộ venue |
| 21 | Delivery | Hold commit nhưng Send API fail | Definite reject → shared cancel/release; timeout/unknown → giữ resumable hold tới TTL, không đoán user chưa nhận |

---

## 3. Screens & States

> Messenger bot interface (Facebook Messenger platform). No web surface.

### Messenger — Persistent menu + welcome

**Layout:**

```
┌──────────────────────────────────────┐
│ 🏸 Plexco Bot                       │
├──────────────────────────────────────┤
│                                      │
│  Chào bạn! 👋                        │
│  Mình là Plexco — trợ lý thể thao.  │
│                                      │
│  Bạn muốn làm gì?                   │
│  [🏸 Xem kèo]                       │
│  [💰 Thanh toán]                     │
│  [⚙️ Cài đặt]                       │
│                                      │
└──────────────────────────────────────┘
```

**Component: Persistent menu (max 3 top-level):**

| Slot | Label | Action |
|------|-------|--------|
| 1 | 🏸 Kèo của tôi | Show active sessions |
| 2 | 💰 Thanh toán | Payment status / QR |
| 3 | ⚙️ Cài đặt | Settings / link account |

### Messenger — Session card (rich template)

**Layout (Generic template):**

```
┌──────────────────────────────────────┐
│ [Session image / sport icon]         │
│                                      │
│ 🏸 Cầu lông chiều T5                │
│ 📍 Q3 · 19:00 · 120,000₫            │
│ 👥 6/8 · 2 chỗ còn                  │
│                                      │
│ [Đăng ký] [Chi tiết]                │
└──────────────────────────────────────┘
```

> Max 10 generic templates per carousel; max 3 buttons per card.

### Messenger — Quick replies

**Layout:**

```
Bot: Bạn muốn xem kèo môn nào?

[🏸 Cầu lông] [⚽ Bóng đá] [🏓 Pickle] [Tất cả]
```

### Data source mapping

| Component | Data source | Ghi chú |
|-----------|-------------|---------|
| Persistent menu | Static config per Page | Max 3 top-level |
| Session cards | `public_sessions` / roster | Carousel format |
| Quick replies | Sport taxonomy | Max 13 per message |
| Payment status | `charges` per person-self | Via canonical service |

### State coverage matrix

| Screen | Loading | Ready | Error | Empty |
|--------|---------|-------|-------|-------|
| Welcome | — | ✅ Greeting + menu | — | ⚪ N/A |
| Session list | ✅ "Đang tải..." | ✅ Carousel cards | ✅ "Lỗi — thử lại" | ✅ "Chưa có kèo nào" |
| Payment status | ✅ "Đang kiểm tra..." | ✅ Amount + status | ✅ "Lỗi" | ✅ "Không có khoản nào" |
| Quick replies | — | ✅ Sport chips | — | ⚪ N/A |
---

## 4. Domain Model

> Kênh Messenger **dùng lại** identity/routing/sync có sẵn. Schema binding Page ở mức **proposal** — nguồn AUTHORITATIVE: `../standards/decisions.md` DD-37/DD-33 + `packages/db/schema.ts`.

| Entity | Vai trò | Key constraints (dự kiến) |
|--------|---------|-----------------|
| Messenger Page registry | central + optional tenant Page | `scope='central\|tenant'`; nullable tenant with CHECK; partial uniques; global-protected resolver |
| `channel_identities` | Page-scoped PSID ↔ Person | Scope/user keyed HMAC domain-separated; 3-part uniqueness; explicit Page binding; no cross-Page auto-merge |
| `account_identities` | Facebook Login link (DD-33) | `platform='facebook'`; link về Person qua verified identity/transactional `link_code` |
| Page endpoint reachability | DM availability per channel identity/Page | window/eligibility belongs to endpoint; delivery picks one route |
| `players` | Player join state | Domain service dùng chung với web; lookup qua `membership_id` |
| Durable interaction/action | Wizard + pagination/replay fence | kind/tenant/step/draft/expiry/version/snapshot; opaque actor/Page-bound action token |
| `channel_booking_intents` | Resume link + optional payment hold | Tenant-private orchestration only; exact ChannelIdentity/session, quote/version, TTL, terminal canonical refs; không phải booking/money ledger |

---

## 5. Analytics Events

| Event | Khi nào | Payload tối thiểu (no PII) |
|-------|---------|-------------------|
| `player_msgr_join_result` | Join/leave xử lý | `tenant_id`, `result` (active/waitlisted/left/rejoin_review/blocked/stale) |
| `player_msgr_reachability_changed` | DM reachability set/lost (24h) | `tenant_id`, `platform=messenger`, `available` |
| `player_msgr_link_result` | Link Facebook (DD-33) | `tenant_id`, `method` (`link_code`/`verified_account`), `result` |
| `player_msgr_out_of_window` | Không gửi được ngoài 24h | `tenant_id`, `fallback` (web/zalo) |
| `player_msgr_projection_failed` | Roster/announcement fail | `tenant_id`, `error_class` |
| `player_msgr_booking_gate_result` | Final gate/finalizer outcome | `tenant_id`, `branch` (`free`/`linked_pay_later`/`unlinked_pay_now`), `result`, `reason_code` |

> KHÔNG log message content, PSID thô, Page token trong analytics.

---

## 6. Acceptance Criteria

- [ ] Central Page + tenant Page đều phục vụ host/player; club không Page hoàn tất create/join cơ bản qua central.
- [ ] Page ID → endpoint/default context; protected opaque action/picker → target tenant/resource; không từ nội dung (NFR-S3/DD-66).
- [ ] Quick-reply mở session detail với time/public area/fee/canonical counts; final confirm gọi shared funnel, không adapter-side join/fee/capacity/link/payment logic.
- [ ] Host `/newsession` wizard → preview/confirm → một idempotent shared `CreateSession`; non-admin/stale/context-switch bị chặn.
- [ ] Cửa sổ 24h tôn trọng: không gửi chủ động ngoài 24h; nhắc best-effort trong 24h, ngoài 24h dồn web + Zalo (CO-3).
- [ ] PSID page-scoped; link Facebook về Person qua verified identity/transactional `link_code`, không auto-link chéo.
- [ ] Duplicate webhook/replay idempotent; Meta API fail không rollback canonical.
- [ ] App Review chưa duyệt → degrade transactional one-time `/link` code; kênh nhắc chính web + Zalo.
- [ ] Tiền/PII không lộ; identity/reachability Page-scoped; delivery priority không gửi trùng central+tenant Page.
- [ ] First-entry full→waitlisted/no-charge/no-venue. Existing `left` render canonical `active|waitlisted|current|rejoin_review`; DD-49 active→carry-or-append, full→carry-history-or-defer-refunded; Messenger không tự quyết money/capacity.
- [ ] Choices phân trang tối đa 8 business items/page + Prev/Next/Cancel; token TTL/snapshot/version/actor/Page-bound.
- [ ] Paid final gate: qualified Account link→active+one charge/pay-later; unlinked→15-minute hold only when settlement capability proven, full payment→one active+charge+allocation; under/late/wrong proof không active.
- [ ] Free/full/approval giữ timing riêng: free không ép link/pay; full waitlist không charge/venue; approval không hold/pay trước khi approved.

---

## 7. Open Questions / Changelog

### Open Questions (→ decisions.md)

| ID | Quyết định | Trạng thái |
|---|---|---|
| DD-37 | Messenger là kênh phase-1 (thay Telegram) | ✅ Chốt |
| DD-65..68 | Hybrid Page + shared host/player + routing/identity/interaction contract | ✅ Chốt (owner 2026-07-17) |
| DD-33 | Facebook Login / Messenger account-link (App Review pending) | ✅ Chốt (phase-1, owner 18/07) |
| DD-32 | Browse freely; link-or-pay ở final confirm | ✅ Option D (owner 28/07) |
| PMS-OQ-1 | Nội dung persistent menu + tập quick-reply phase-1 | ✅ Chốt theo DD-66/68: role-aware menu, 8 business choices/page + navigation |
| PMS-OQ-2 | App Review/Business Verification chưa pass | ✅ Enablement-only: non-test capability OFF; transactional link/web fallback, không mở lại DD-32 design |

### Changelog

| Date | Version | Thay đổi |
|---|---|---|
| 2026-08-10 | v0.10 | **A-grade upgrade:** thêm Entry points table (7 entries); bump version. Không đổi contract/domain model. |
| 2026-07-28 | v0.9 | Mirror DD-32 Option D: quick-reply mở detail rồi shared final gate; qualified Account link gets pay-later, unlinked paid path gets verified-payment hold, free/full/approval keep no-premature-pay semantics. Adapter remains thin; no runtime claim. |
| 2026-07-27 | v0.8 | Current-state mirror: job infrastructure không đồng nghĩa Messenger runtime; adapter/handler/projector và App Review/E2E vẫn pending. |
| 2026-07-19 | v0.7a | Metadata sweep (index v2.35): thêm trường **Implementation** đồng bộ BUILD-STATUS (Not started). Không đổi contract. |
| 2026-07-19 | v0.7 | **DD-49 timing mirror:** active rejoin carry/append; full rejoin carry-history/defer-refunded. Messenger remains a thin renderer; authority v1.67. |
| 2026-07-19 | v0.6 | **DD-45×DD-49 mirror consistency:** qualify no-charge final-slot outcome as first-entry; existing-left rejoin renders shared carry-over/refunded active/waitlisted outcome without creating a new charge. |
| 2026-07-17 | v0.5 | **decisions v1.45:** 3-part Page-scoped identity key, App-secret ownership clarified in BE, link analytics bỏ OTP-era label, và DD-49 rejoin canonical outcomes. |
| 2026-07-17 | v0.4 | **DD-65..68:** nâng từ player/Page-per-club spec thành shared host+player hybrid surface; central fallback, optional tenant Page, protected routing, Page-scoped identity/reachability, wizard/opaque actions/one-route delivery và E2E acceptance. |
| 2026-07-15 | v0.3 | **DD-45:** Messenger render active/waitlisted/current-state/rejoin-review; retire "Hết chỗ" outcome và không tạo charge/venue cho waitlisted. |
| 2026-07-13 | v0.2 | Reconcile join-state table với canonical `players` + `membership_id`; không dùng tên giả `session_roster`. |
| 2026-07-10 | v0.1 | Khởi tạo Draft (DD-37 kênh ✅ + DD-33 link 🟡): join qua Messenger bot (quick-reply/persistent menu), Page-per-club routing, cửa sổ 24h (nhắc best-effort 24h, ngoài 24h dồn web+Zalo), sync lên web. Thay `feature_player_telegram` (đã archive). Schema binding Page proposal-level trỏ decisions.md + `packages/db/schema.ts`. |
