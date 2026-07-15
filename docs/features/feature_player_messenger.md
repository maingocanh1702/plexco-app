# Feature: Player Facebook Messenger Experience — Product/UX Spec

> **Canonical phase:** P2.5 / P4.5 (kênh phase-1 — thay `feature_player_telegram` đã archive)
> **Track:** 📱 Player Messenger
> **Version:** 0.3 · 2026-07-15
> **Status:** Draft
> **Prerequisites:** P2 routing/authz (Page per-club) · P3.5 identity · P2 session/join · P3 notifications · P4 sync · **App Review Meta** (DD-33)
> **Tài liệu liên quan:** `../product/BRD.md` FR-3.3 / BR-17 / CO-3 · `../standards/decisions.md` **DD-37** (kênh ✅) · **DD-33** (Facebook Login/link 🟡 phase-1) · `../channels/messenger/messenger-channel-design.md` · `feature_zalo_channel.md` · `feature_tenant_routing_authz.md` · `feature_identity.md` · `BE/feature_player_messenger_tech.md`

> **Kênh (DD-37 ✅):** Facebook Messenger là kênh **phase-1** (thay Telegram đã loại). **Link tài khoản Facebook (DD-33 🟡):** phụ thuộc **App Review / FB Business Verification** — nếu chậm → degrade sang OTP `/link` thủ công.

---

## 1. Mô tả

Cho player **join/leave kèo** và nhận **nhắc/xác nhận** qua **Facebook Messenger bot** của CLB, sau khi CLB đã kết nối Page. Cover: **Page-per-club routing**, quick-reply / persistent menu, **cửa sổ 24h**, đồng bộ hành động **lên web app** (add đúng session tương ứng).

**Ràng buộc kênh (CO-3):** Messenger standard messaging trong **cửa sổ 24h**; gửi ngoài cửa sổ chỉ qua cơ chế Meta đủ điều kiện/được phê duyệt → MVP dùng mô hình **"join + xác nhận"**, **nhắc best-effort trong 24h**, fallback **web + Zalo**. **Không inline button** kiểu Telegram → dùng **quick-reply / persistent menu**.

### Bất biến

- Routing suy **từ Page** (`recipient.id` = Page ID per-club → tenant), **KHÔNG** từ nội dung message (NFR-S3).
- **PSID page-scoped:** cùng một người ở 2 Page khác nhau có PSID khác — link về Person qua verified signal / OTP `/link` (DD-33), **không** auto-link chéo.
- Bot **KHÔNG** nhắn user trước khi có inbound hợp lệ / trong cửa sổ 24h (Meta policy).
- Meta API/rate-limit fail **KHÔNG** rollback canonical join/payment.
- Duplicate webhook / replay = **idempotent**.
- Hành động join tự **sync lên web** (canonical → projector); tiền/PII không lộ ra kênh công khai.

---

## 2. Use Cases + Edge Cases

### Use Cases

| ID | Actor | Hành động | Kết quả |
|---|---|---|---|
| PMS-UC-1 | Player | Nhắn bot / mở persistent menu | Bot chào + quick-reply (join / kèo của tôi / nợ) trong 24h window |
| PMS-UC-2 | Player | Chọn quick-reply "Tham gia kèo [X]" | Common join service: còn slot→active+charge+venue; full→waitlisted/no-charge/no-venue; sync web |
| PMS-UC-3 | Player | Chọn "Rời kèo" | Financial policy check → leave/block |
| PMS-UC-4 | Player | Xem "Kèo của tôi" | Person-self summary (chỉ dữ liệu của họ) |
| PMS-UC-5 | Player | Xem "Nợ của tôi" | Hiện số tiền còn nợ + QR/hướng dẫn CK |
| PMS-UC-6 | System | Gửi xác nhận đã trả (sau markPaid) | Gửi trong cửa sổ 24h nếu còn mở; ngoài 24h → web + Zalo |
| PMS-UC-7 | System | Nhắc nợ | **Best-effort trong 24h**; ngoài 24h dồn qua web + Zalo (CO-3) |
| PMS-UC-8 | Player | Link tài khoản Facebook vào Person (DD-33) | OTP `/link` hoặc verified signal; gắn PSID↔Person; claim có tiền cần khoá mạnh |
| PMS-UC-9 | System | Roster đổi | Sync projector cập nhật (không double announce) |
| PMS-UC-10 | System | Message ngoài cửa sổ 24h | Không gửi chủ động; chờ inbound / dồn kênh khác |

### Edge Cases

| # | Category | Case | Hành vi bắt buộc |
|---|----------|------|-------------------|
| 1 | Security | Routing từ nội dung message | ❌ NEVER — chỉ Page ID (recipient.id) → tenant |
| 2 | Security | Gửi ngoài cửa sổ 24h | ❌ Không dùng standard send; chỉ gửi nếu có cơ chế Meta đủ điều kiện/được phê duyệt, nếu không fallback web + Zalo |
| 3 | Concurrency | Duplicate webhook / replay | Idempotent — cùng kết quả, không double join |
| 4 | Security | Bot nhắn user chưa có inbound | ❌ KHÔNG — reachability chỉ set sau inbound hợp lệ |
| 5 | Identity | PSID khác giữa 2 Page | Không auto-merge; link qua OTP/verified (DD-33) |
| 6 | Resilience | Meta API rate-limit/timeout | Retry backoff — KHÔNG rollback canonical |
| 7 | Data Integrity | Announcement/roster reproject | Projector dedup — edit thay vì gửi mới |
| 8 | Security | Lộ nợ/tên ra kênh không riêng tư | Nhắc đi DM riêng; không lộ số tiền/tên |
| 9 | Ops | App Review chưa duyệt (DD-33) | Degrade: link OTP `/link` thủ công; kênh nhắc chính = web + Zalo |
| 10 | Cross-Feature | Account merge → PSID context cũ | Invalidate context cũ — dùng merged person |
| 11 | Financial | Paid/partial player rời kèo | Financial policy check — có thể cần host review |
| 12 | Security | Page token leak | Blast radius per-club (Page per-CLB) — rotation/runbook |
| 13 | Concurrency | Quick-reply ở final slot | Session lock: một active, người sau waitlisted với position dương; không charge/venue |
| 14 | Financial | Existing player đã `left` join lại | `REJOIN_REQUIRES_REVIEW`; adapter không tự reuse/duplicate charge |

---

## 3. Screens & States

| Surface | Screen | Loading | Ready | Error | Empty |
|---------|--------|---------|-------|-------|-------|
| Messenger | Persistent menu | — | Join kèo / Kèo của tôi / Nợ của tôi | — | N/A |
| Messenger | Join quick-reply | "⏳ Đang xử lý..." | Active: "✅ Đã tham gia! [venue]"; waitlisted: "⏳ Vị trí N"; duplicate trả current state | Rejoin cần host review / lỗi | N/A |
| Messenger | Kèo của tôi | "Đang tải..." | Clubs + kèo sắp tới | "Lỗi — thử lại" | "Chưa có kèo" |
| Messenger | Nhắc/Xác nhận (trong 24h) | — | "[Club] Bạn còn nợ [amount]. [QR]" / "✅ Đã nhận CK [amount]" | — | N/A |
| Messenger | Link tài khoản (DD-33) | — | Nhập OTP `/link` / xác nhận | "Mã sai/hết hạn" | N/A |

---

## 4. Domain Model

> Kênh Messenger **dùng lại** identity/routing/sync có sẵn. Schema binding Page ở mức **proposal** — nguồn AUTHORITATIVE: `../standards/decisions.md` DD-37/DD-33 + `packages/db/schema.ts`.

| Entity | Vai trò | Key constraints (dự kiến) |
|--------|---------|-----------------|
| Messenger Page binding | Page per-club → tenant (routing) | Page ID → `tenant_id`; secret/verify per-Page |
| `channel_identities` | PSID (page-scoped) ↔ Person | `platform='messenger'`; UNIQUE `(platform, platform_user_id)` |
| `account_identities` | Facebook Login link (DD-33) | `platform='facebook'`; link về Person qua OTP/verified |
| `channel_reachability` | DM availability per person/tenant/platform | `UNIQUE(person_id, tenant_id, platform='messenger')`; cửa sổ 24h |
| `players` | Player join state | Domain service dùng chung với web; lookup qua `membership_id` |

---

## 5. Analytics Events

| Event | Khi nào | Payload tối thiểu (no PII) |
|-------|---------|-------------------|
| `player_msgr_join_result` | Join/leave xử lý | `tenant_id`, `result` (active/waitlisted/left/rejoin_review/blocked/stale) |
| `player_msgr_reachability_changed` | DM reachability set/lost (24h) | `tenant_id`, `platform=messenger`, `available` |
| `player_msgr_link_result` | Link Facebook (DD-33) | `tenant_id`, `method` (otp/verified), `result` |
| `player_msgr_out_of_window` | Không gửi được ngoài 24h | `tenant_id`, `fallback` (web/zalo) |
| `player_msgr_projection_failed` | Roster/announcement fail | `tenant_id`, `error_class` |

> KHÔNG log message content, PSID thô, Page token trong analytics.

---

## 6. Acceptance Criteria

- [ ] Routing từ Page ID (recipient.id) → tenant; không từ nội dung (NFR-S3).
- [ ] Join qua quick-reply/persistent menu → atomic join → sync web + roster đúng session.
- [ ] Cửa sổ 24h tôn trọng: không gửi chủ động ngoài 24h; nhắc best-effort trong 24h, ngoài 24h dồn web + Zalo (CO-3).
- [ ] PSID page-scoped; link Facebook về Person qua OTP/verified (DD-33), không auto-link chéo.
- [ ] Duplicate webhook/replay idempotent; Meta API fail không rollback canonical.
- [ ] App Review chưa duyệt → degrade OTP `/link`; kênh nhắc chính web + Zalo.
- [ ] Tiền/PII không lộ ra kênh công khai; reachability tenant-specific.
- [ ] Full→waitlisted/no-charge/no-venue; existing `left`→rejoin review; Messenger chỉ render domain outcome, không tự quyết money/capacity.

---

## 7. Open Questions / Changelog

### Open Questions (→ decisions.md)

| ID | Quyết định | Trạng thái |
|---|---|---|
| DD-37 | Messenger là kênh phase-1 (thay Telegram) | ✅ Chốt |
| DD-33 | Facebook Login / Messenger account-link (phụ thuộc App Review) | 🟡 Đề xuất (phase-1) |
| PMS-OQ-1 | Nội dung persistent menu + tập quick-reply phase-1 | ⬜ Chưa chốt |
| PMS-OQ-2 | Lịch App Review + degrade path chi tiết nếu trượt/chậm | ⬜ Chưa chốt |

### Changelog

| Date | Version | Thay đổi |
|---|---|---|
| 2026-07-15 | v0.3 | **DD-45:** Messenger render active/waitlisted/current-state/rejoin-review; retire "Hết chỗ" outcome và không tạo charge/venue cho waitlisted. |
| 2026-07-13 | v0.2 | Reconcile join-state table với canonical `players` + `membership_id`; không dùng tên giả `session_roster`. |
| 2026-07-10 | v0.1 | Khởi tạo Draft (DD-37 kênh ✅ + DD-33 link 🟡): join qua Messenger bot (quick-reply/persistent menu), Page-per-club routing, cửa sổ 24h (nhắc best-effort 24h, ngoài 24h dồn web+Zalo), sync lên web. Thay `feature_player_telegram` (đã archive). Schema binding Page proposal-level trỏ decisions.md + `packages/db/schema.ts`. |
