# Feature: Home — Personal Dashboard (PWA) — Product/UX Spec

> **Canonical phase:** S9 (cùng PWA shell; sau P4.6 player_view vì data từ đó) — DD-79 ✅  
> **Track:** 🏠 Home Hub  
> **Version:** 0.2 · 2026-07-19  
> **Status:** ✅ **Reviewed contract theo DD-79 (✅ owner 2026-07-19, `../standards/decisions.md` v1.76)** — composition-only; implementation pending S9. Fork từ Sporta `feature_home.md` v2.5 + học từ design `app-design-opus-4.6.pen`.  
> **Implementation:** Not started · authority: `../standards/BUILD-STATUS.md` (Doc status ≠ Implementation status)  
> **Prerequisites:** P4 web auth · P4.6 player_view (data backbone) · P4.3 marketplace (suggested) · 🔔 notifications §A  
> **Tài liệu liên quan:** `../standards/decisions.md` **DD-79** · `feature_player_view.md` FR-8 (person-self contract) · `feature_marketplace_discovery.md` · `feature_notifications_reminders.md` §A · `../channels/web/theme-direction-2026-07.md` §7 (hero recipe) · `BE/feature_home_tech.md` · Sporta ref: `Sporta/docs/Phase 1/FE/feature_home.md`

---

## 1. Mô tả

Home là **màn đầu tiên sau đăng nhập** trên PWA — personal dashboard tổng hợp: tiền (còn nợ xuyên CLB), kèo sắp tới (mọi CLB, cả vai host lẫn player), và gợi ý kèo từ marketplace. Nguyên tắc: **glanceable, mobile-first 375px, ưu tiên 1 màn không scroll cho nội dung chính**. Đây là màn "có taste" nhất — áp hero recipe từ theme-direction §7.

**Home là composition surface, KHÔNG phải data owner:** mọi dữ liệu đến từ contract đã có — person-self aggregate (player_view), public marketplace (whitelist), notification inbox §A. Home không tạo bảng mới, không mở đường đọc mới vượt person-self/public boundary.

### Bất biến

- Dữ liệu cá nhân trên Home đi qua **person-self contract của player_view** (verified session; KHÔNG nhận person ID từ client) — Home không nới rộng nó.
- Suggested sessions chỉ từ `public_sessions` field-whitelist (HR2 — không tiền/PII/roster).
- Mọi chuỗi hiển thị `t(vi, en)` (HR5).
- Số tiền hiển thị lấy từ ledger-derived DTO của player_view — Home KHÔNG tự tính tiền phía client.

---

## 2. Use Cases + Edge Cases

### Use Cases

| ID | Actor | Hành động | Kết quả |
|---|---|---|---|
| HOME-UC-1 | User | Mở app/đăng nhập xong | Thấy chips tài chính + hero kèo kế tiếp + list kèo sắp tới xuyên CLB |
| HOME-UC-2 | Player | Tap chip "💸 Còn nợ" | → màn debt person-self (player_view) — tổng hợp xuyên CLB |
| HOME-UC-3 | User | Tap hero card | → session detail (đúng tenant context) |
| HOME-UC-4 | Player | Tap CTA "Thanh toán" trên hero | → payment QR/hướng dẫn CK của charge tương ứng |
| HOME-UC-5 | Host | Tap CTA trên hero (kèo mình host) | → host board của session (mark-paid, roster) |
| HOME-UC-6 | User | Tap "Tất cả →" | → danh sách session person-self đầy đủ |
| HOME-UC-7 | User | Tap kèo gợi ý | → public session detail (marketplace) → join flow CCJ |
| HOME-UC-8 | User | Tap 🔔 | → notification inbox (§A read model khả dụng phase-1) |
| HOME-UC-9 | User mới | Chưa thuộc CLB nào | Onboarding checklist (từ `onboarding_steps`) + suggested sessions |
| HOME-UC-10 | User | Pull-to-refresh | Refresh aggregate; SSE cập nhật realtime giữa các lần |

### Edge Cases

| # | Category | Case | Hành vi bắt buộc |
|---|----------|------|-------------------|
| 1 | Security | Client gửi person/tenant ID để đổi dashboard | ❌ Ignore — identity từ verified session (player_view invariant) |
| 2 | Security | Suggested card chứa field ngoài whitelist | ❌ NEVER — test bất biến HR2 |
| 3 | Data | User vừa host vừa player cùng session | 1 entry, role badge `Host` ưu tiên |
| 4 | Data | Không có kèo sắp tới, có nợ | Chips vẫn hiện nợ; list → suggested sessions |
| 5 | Data | Nợ = 0 và không kèo | Empty state + CTA "Khám phá kèo" → marketplace |
| 6 | Data | Nhiều CLB, nhiều kèo cùng giờ | Sort: host trước, rồi start time ASC; hiển thị max 4 + "Tất cả →" |
| 7 | Cross-Feature | Session bị hủy/đổi giờ khi đang xem | SSE cập nhật card + toast; recalc chips |
| 8 | Cross-Feature | Charge được settle (webhook/mark-paid) khi đang xem | SSE cập nhật chip Còn nợ + payment dot |
| 9 | Network | Mất kết nối | Hiện cached view + banner offline; hành động tiền bị chặn (không optimistic money) |
| 10 | Security | Token/session hết hạn | Refresh; fail → về login, không giữ data cá nhân trên màn |
| 11 | Data | CLB bị suspended (billing) | Kèo CLB đó vẫn hiện person-self; CTA theo rule billing (không mở đường mới) |
| 12 | UX | Danh sách CLB dài (>5) | Chips/list vẫn tổng hợp; không bắt user chọn tenant trước khi thấy Home |

---

## 3. Screens & States

> Coverage matrix `state × role`: Home là screen dữ liệu động → đủ 4 states + Onboarding variant; dark theo token. Mobile-first 375px; desktop ≥1024 chuyển layout 2 cột (list trái, suggested phải), không đổi nội dung.

**Layout (mobile, tham chiếu — số đo chốt ở design file theo theme-direction §6/§7):**

```
┌──────────────────────────────────────┐
│ [Avatar] Xin chào 👋 {tên}      🔔● │  header
│ ┌──────────────┐  ┌───────────────┐ │
│ │ 💸 Còn nợ    │  │ 📅 Kèo tuần   │ │  chips (adaptive, xuyên CLB)
│ │ 85.000₫ ·2CLB│  │ này: 3        │ │
│ └──────────────┘  └───────────────┘ │
│ ┌──────────────────────────────────┐ │
│ │ ⭐ HERO — kèo kế tiếp            │ │  gradient + glow (theme §7)
│ │ 🏸 Cầu lông T3 · CLB Rồng Xanh  │ │  role badge · countdown
│ │ T3 22/07 · 19:30 · 8/10          │ │
│ │ [💳 Thanh toán 85.000₫]          │ │  CTA theo role
│ └──────────────────────────────────┘ │
│ KÈO SẮP TỚI                Tất cả → │
│ · 🏸 Đánh cầu CN — Player · 🔴      │  compact rows, max 4
│ · ⚽ FC Phượng Hoàng — Host · 🟢    │
│ KÈO GỢI Ý (marketplace)             │
│ · 🏸 Cầu lông Q7 · T5 · 120k · 5/8 │  public whitelist only
└──────────────────────────────────────┘
```

| State | Nội dung |
|-------|----------|
| Loading | Skeleton giữ đúng layout: 2 chip + hero + 3 rows |
| Ready | Như layout trên |
| Error | Toast "Không tải được trang chủ" + retry; giữ cached data |
| Empty | Chips = [📅 0 kèo, 🔥 streak 0]; CTA "Khám phá kèo" |
| Onboarding | Thay chips bằng checklist từ `onboarding_steps` (đã có bảng, migration `0008`) + suggested sessions |

**Chips phase-1 (theo DD-79 ✅):** cố định 2 chips — 1) 💸 **Còn nợ** (tổng xuyên CLB + số CLB; hiện cả khi 0) · 2) 📅 **Kèo tuần này**. Chip 💰 Chưa thu (host) **defer** theo HOME-OQ-1 (c); 🔥 Streak **defer** theo HOME-OQ-3. Chip tiền: đỏ/vàng theo semantic token; số dùng `tabular-nums`.

---

## 4. Domain Model

**Không bảng mới.** Home đọc qua 1 aggregate DTO person-self (BE contract chốt ở build slice, thuộc player_view surface):

| Nguồn | Dữ liệu trên Home | Contract sẵn có |
|-------|--------------------|-----------------|
| player_view person-self | Còn nợ (tổng + per-club), upcoming sessions + role + payment status | `feature_player_view.md` FR-8, BE `/me` |
| marketplace public read model | Suggested sessions (whitelist fields) | `feature_marketplace_discovery.md` |
| notifications §A | Unread count | `feature_notifications_reminders.md` |
| onboarding_steps | Checklist trạng thái | migration `0008` (đã có bảng) |

---

## 5. Analytics Events

| Event | Khi nào | Payload tối thiểu |
|-------|---------|-------------------|
| `home_viewed` | Mở Home | `state` (ready/empty/onboarding) |
| `home_chip_tapped` | Tap chip | `chip_type` |
| `home_hero_tapped` / `home_hero_pay_tapped` | Tap hero / CTA tiền | `role` (host/player) — session ID opaque |
| `home_session_item_tapped` | Tap row | opaque session ref |
| `home_suggested_tapped` | Tap gợi ý | `position` |
| `home_onboarding_step_tapped` | Tap checklist | `step` |

> Opaque IDs only, không PII (theo convention analytics hiện hành).

---

## 6. Acceptance Criteria

- [ ] Home render đủ theo coverage matrix (Loading/Ready/Error/Empty/Onboarding + dark)
- [ ] Chips adaptive đúng priority; số tiền từ DTO server, không client-derive
- [ ] Hero = kèo kế tiếp (host ưu tiên), CTA route đúng theo role; áp hero recipe theme-direction §7
- [ ] Upcoming: dedupe host/player, sort host-first + time ASC, max 4 + "Tất cả →"
- [ ] Suggested chỉ hiện field whitelist; test bất biến HR2 pass
- [ ] SSE cập nhật chips/rows khi settle/cancel; offline banner + chặn money action
- [ ] Mọi string `t(vi,en)`; touch target ≥ 44px (PWA — needs-matrix §4)
- [ ] Không request nào nhận person/tenant ID từ client cho dữ liệu cá nhân

---

## 7. Open Questions / Changelog

### Open Questions

| ID | Quyết định | Trạng thái |
|---|---|---|
| HOME-OQ-1 | Chip "💰 Chưa thu" (host, aggregate xuyên CLB — cần contract host-self chưa tồn tại) | ✅ **Chốt DD-79: (c) defer phase-1.** Muốn bật sau: cần DD mới + design-probe contract host-self cross-tenant |
| HOME-OQ-2 | Home thay landing hiện tại của web shell? | ✅ **Chốt DD-79: yes, S9 cùng PWA shell** |
| HOME-OQ-3 | Streak/gamification phase-1? | ✅ **Chốt DD-79: defer** — phase-1 chỉ 📅 đếm kèo tuần |

### Changelog

| Date | Version | Thay đổi |
|---|---|---|
| 2026-07-19 | v0.2 | **DD-79 ✅ chốt (owner) → promote Reviewed contract.** HOME-OQ-1..3 resolve theo defaults: chips phase-1 cố định [Còn nợ, Kèo tuần] (defer Chưa thu + streak), landing S9. Thêm BE companion `BE/feature_home_tech.md` v0.1. |
| 2026-07-19 | v0.1 | 🟡 Khởi tạo Draft **proposal** — fork từ Sporta `feature_home.md` v2.5 (chips adaptive, hero next-session, onboarding checklist, 4 states, sort/dedupe logic) + adapt sang canonical Plexco: person-self contract (player_view), public whitelist (HR2), i18n (HR5), SSE, `onboarding_steps` sẵn có; hero theo theme-direction §7. Không bảng/API mới ngoài aggregate DTO thuộc player_view surface. Chờ DD chốt scope/phase; BE companion viết cùng build slice sau DD. |
