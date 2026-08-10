# Feature: Home — Personal Dashboard (PWA) — Product/UX Spec

> **Canonical phase:** S9 (cùng PWA shell; sau P4.6 player_view vì data từ đó) — DD-79 ✅  
> **Track:** 🏠 Home Hub  
> **Version:** 0.12 · 2026-08-08
> **Status:** ✅ **Reviewed contract theo DD-79** — composition-only; implementation pending S9. Primary plan v1.8 đã `PLAN_READY` tại `90d292d`, nhưng từng slice vẫn phải strict `CODE_READY`; không có Home/payment/chat runtime. Fork từ Sporta `feature_home.md` v2.5 + học từ design `app-design-opus-4.6.pen`.
> **Implementation:** Not started · authority: `../standards/BUILD-STATUS.md` (Doc status ≠ Implementation status)  
> **Prerequisites:** P4 web auth · P4.6 player_view (data backbone) · P4.3 marketplace (suggested) · 🔔 notifications §A  
> **Tài liệu liên quan:** `../standards/decisions.md` **DD-79/DD-91** · `feature_player_view.md` FR-8 (person-self contract) · `feature_payment_reconcile.md` · `feature_marketplace_discovery.md` · `feature_notifications_reminders.md` §A · `../channels/web/theme-direction-2026-07.md` §7 (hero recipe) · `../BE/feature_home_tech.md` · Sporta ref: `Sporta/docs/Phase 1/FE/feature_home.md`

> **Ranh giới DD-91:** Home chỉ **consume** canonical self-payment projection (`remainingAmount`, phân biệt `known_zero`/`unknown`) do Player View/payment core sở hữu. Home không query ledger, không tự cộng lại tiền, không tạo result/history riêng. Exact requester-only `/pay` là target deterministic ở club bot/private bot/human DM; không gọi LLM, không ghi chat transcript và hiện chưa có runtime.

---

## 1. Mô tả

Home là **màn đầu tiên sau đăng nhập** trên PWA — personal dashboard tổng hợp: tiền (còn nợ xuyên CLB), kèo sắp tới (mọi CLB, cả vai host lẫn player), và gợi ý kèo từ marketplace. Nguyên tắc: **glanceable, mobile-first 375px, ưu tiên 1 màn không scroll cho nội dung chính**. Đây là màn "có taste" nhất — áp hero recipe từ theme-direction §7.

**Home là composition surface, KHÔNG phải data owner:** mọi dữ liệu đến từ contract đã có — person-self aggregate (player_view), public marketplace (whitelist), notification inbox §A. Home không tạo bảng mới, không mở đường đọc mới vượt person-self/public boundary.

### Bất biến

- Dữ liệu cá nhân trên Home đi qua **person-self contract của player_view** (verified session; KHÔNG nhận person ID từ client) — Home không nới rộng nó.
- Suggested sessions chỉ từ `public_sessions` field-whitelist (HR2 — không tiền/PII/roster).
- Mọi chuỗi hiển thị `t(vi, en)` (HR5).
- Số tiền hiển thị lấy từ **một payment truth** của player_view (`remainingAmount`, cùng canonical helper/service `getSelfPaymentStatus`) — Home KHÔNG tự tính tiền phía client/server. Chỉ `known_zero` mới hiển thị 0; `unknown` phải hiện unavailable/retry, không fail-open thành 0.
- **Chips adaptive:** Home hiển thị đúng 2 chips, chọn từ pool theo priority — KHÔNG cố định. Pool phase-1 gồm 3 chips [💸 Còn nợ, 🔥 Streak, 📅 Kèo tuần]; phase-2 thêm [💰 Chưa thu] (sau B1–B4 đóng, DD-96 Part B). Logic chọn chạy ở FE, data từ upstream canonical.
- **Hero CTA:** Hero card có thể hiển thị CTA "Thanh toán" **chỉ khi** upstream upcoming DTO kèm `payAction`; không có `payAction` = không CTA (hiện tại `payAction` có ở per-club `SelfPaymentStatus`, chưa có trong upcoming session DTO — gated bởi HOME-OQ-4).

---

## 2. Use Cases + Edge Cases

### Use Cases

| ID | Actor | Hành động | Kết quả |
|---|---|---|---|
| HOME-UC-1 | User | Mở app/đăng nhập xong | Thấy chips tài chính + hero kèo kế tiếp + list kèo sắp tới xuyên CLB |
| HOME-UC-2 | Player | Tap chip "💸 Còn nợ" | → màn debt person-self (player_view) — tổng hợp xuyên CLB |
| HOME-UC-3 | User | Tap hero card | → session detail (đúng tenant context) |
| HOME-UC-4 | Player | Tap CTA "Thanh toán" trên hero (khi available) | → protected payment screen (QR/chuyển khoản). **Gated:** chỉ render khi upcoming DTO kèm `payAction` (HOME-OQ-4); ẩn khi: free session HOẶC đã thanh toán HOẶC `payAction` chưa available |
| HOME-UC-4b | Host | Tap CTA "Bảng thu tiền" trên hero (khi available) | → payment board (danh sách player đã/chưa trả). **Gated:** cùng điều kiện HOME-OQ-4 |
| HOME-UC-5 | User | Glance streak chip | Thấy số ngày liên tục có kèo (VD: 🔥 5 ngày). Hiển thị khi không có nợ (adaptive fallback) |
| HOME-UC-6 | User | Tap "Tất cả →" | → danh sách session person-self đầy đủ |
| HOME-UC-7 | User | Tap kèo gợi ý | → public session detail (marketplace) → join flow CCJ |
| HOME-UC-8 | User | Tap 🔔 / 💬 trên header | 🔔 → notification inbox (§A) · 💬 → chat in-app (DD-38, club + DM) |
| HOME-UC-9 | User mới | Chưa thuộc CLB nào | Onboarding checklist (từ `onboarding_steps`) + suggested sessions |
| HOME-UC-10 | User | Pull-to-refresh | Refresh aggregate; SSE cập nhật realtime giữa các lần |

### Edge Cases

| # | Category | Case | Hành vi bắt buộc |
|---|----------|------|-------------------|
| 1 | Security | Client gửi person/tenant ID để đổi dashboard | ❌ Ignore — identity từ verified session (player_view invariant) |
| 2 | Security | Suggested card chứa field ngoài whitelist | ❌ NEVER — test bất biến HR2 |
| 3 | Data | User vừa host vừa player cùng session | 1 entry, role badge `Host` ưu tiên |
| 4 | Data | Không có kèo sắp tới, có nợ | Chips vẫn hiện nợ; list → suggested sessions |
| 5 | Data | Payment core chứng minh `known_zero` và không kèo | Empty state + chip nợ = 0 + CTA "Khám phá kèo" → marketplace |
| 6 | Data | Nhiều CLB, nhiều kèo cùng giờ | Sort: host trước, rồi start time ASC; hiển thị max 4 + "Tất cả →" |
| 7 | Cross-Feature | Session bị hủy/đổi giờ khi đang xem | SSE cập nhật card + toast; recalc chips |
| 8 | Cross-Feature | Charge được settle (webhook/mark-paid) khi đang xem | SSE cập nhật chip Còn nợ + payment dot |
| 9 | Network | Mất kết nối | Banner offline; không render cached person-self chips/hero/upcoming. Chỉ public suggested cache có thể còn theo Marketplace policy |
| 10 | Security | Token/session hết hạn | Refresh; fail → về login, không giữ data cá nhân trên màn |
| 11 | Data | CLB bị suspended (billing) | Kèo CLB đó vẫn hiện person-self; CTA theo rule billing (không mở đường mới) |
| 12 | UX | Danh sách CLB dài (>5) | Chips/list vẫn tổng hợp; không bắt user chọn tenant trước khi thấy Home |
| 13 | Cross-Feature | Tab Feed khi DD-76 chưa clear | Registry gate = OFF — slot không render; KHÔNG tab trống/coming-soon; bật = đổi config, không sửa layout code |
| 14 | Money/Data | Payment truth `unknown`/unavailable | Chip/CTA tiền hiện trạng thái unavailable + retry; không hiển thị 0, không tự sum ledger và không dùng cached amount như authority |

---

## 3. Screens & States

> Coverage matrix `state × role`: Home là screen dữ liệu động → đủ 4 states + Onboarding variant; dark theo token. Mobile-first 375px; desktop ≥1024 chuyển layout 2 cột (list trái, suggested phải), không đổi nội dung.

**Layout (mobile, tham chiếu — số đo chốt ở design file theo theme-direction §6/§7):**

```
┌──────────────────────────────────────┐
│ [Avatar] Xin chào 👋 {tên}   💬 🔔● │  header
│ ┌──────────────┐  ┌───────────────┐ │
│ │ 💸 Còn nợ    │  │ 🔥 Streak     │ │  adaptive chips (top 2 from pool)
│ │ 85.000₫ ·2CLB│  │ 5 ngày        │ │
│ └──────────────┘  └───────────────┘ │
│ ┌──────────────────────────────────┐ │
│ │ ⭐ HERO — kèo kế tiếp            │ │  gradient + glow (theme §7)
│ │ 🏸 Cầu lông T3 · CLB Rồng Xanh  │ │  role badge · countdown
│ │ T3 22/07 · 19:30                 │ │
│ │ [💳 Thanh toán]                   │ │  CTA conditional (gated: HOME-OQ-4)
│ └──────────────────────────────────┘ │
│ KÈO SẮP TỚI                Tất cả → │
│ · 🏸 Đánh cầu CN — Player · 🔴      │  compact rows, max 4
│ · ⚽ FC Phượng Hoàng — Host · 🟢    │
│ KÈO GỢI Ý (marketplace)             │
│ · 🏸 Cầu lông Q7 · T5 · 120k · 5 chỗ trống │  public whitelist: scalar price + slots_open, no denominator
└──────────────────────────────────────┘
```

**Payment status dots (compact rows):**

| Dot | Trạng thái | Nguồn |
|-----|-----------|-------|
| 🔴 | Chưa thanh toán (`open`) | Canonical `getSelfPaymentStatus` |
| 🟡 | Đợi xác nhận (`partial`) | Canonical `getSelfPaymentStatus` |
| 🟢 | Đã thanh toán | Canonical `getSelfPaymentStatus` |
| (none) | Free session | `pricePerSlot = 0` hoặc null |

**Role badges trên session cards:**

| Badge | Hiển thị khi |
|-------|-------------|
| `Host` | User là host (`hostId = me`) — ưu tiên khi vừa host vừa player (EC #3) |
| `Player` | User là player (có membership slot) |

**Countdown hero card:**

| Điều kiện | Hiển thị |
|-----------|----------|
| Session trong 24h tới | ⏱️ Countdown badge trên hero (VD: "Còn 2h30") |
| Session > 24h | Chỉ ngày giờ, không countdown |

**Bottom Nav (DD-79 amendment 19/07 — shell contract, config-driven):**

| Slot | Tab | Route/đích | Phase-1 |
|------|-----|-----------|---------|
| 1 | 🏠 Home | Landing (màn này) — chứa hero + upcoming; **"Kèo của tôi" đầy đủ = sub-screen** mở từ "Tất cả →" và chip Còn nợ (person-self, player_view) | ✅ |
| 2 | 📰 Feed | Activity feed (DD-76) | ⛔ **config-OFF tới DD-76 clear** — slot reserved, không tab chết |
| 3 | **🔍 Khám phá** | Tìm & join kèo public mọi CLB — `/discover` marketplace, **center emphasized/FAB** | ✅ |
| 4 | 🏸 **Club** | CLB của tôi — **cả 2 nhóm**: (a) CLB user tạo/sở hữu (role owner/admin) và (b) CLB user tham gia (member/guest) — cùng từ person-self memberships (`/me/clubs`, player_view), phân nhóm + role badge. Club context theo quyền: owner/admin → host board (mark-paid, roster, settings); member → member view (sessions CLB, chat club). CTA **+ Tạo CLB** → onboarding wizard sẵn có | ✅ |
| 5 | ⚙️ Setting | Profile/user_settings | ✅ |

**Header (mọi màn chính):** `[Avatar] Xin chào {tên} … 💬 🔔●` — **Chat entry ở header** (inapp_chat DD-38, badge unread), KHÔNG chiếm tab; 🔔 notification inbox §A.

- **Registry config-driven:** 1 ordered list duy nhất trong `apps/web` — tab = `{key, route, icon, label t(vi,en), gate}`; đổi tab = sửa registry một chỗ. **User tự customize tab: KHÔNG phase-1** (defer).
- Phase-1 render **4 tab** (Feed off): Home · [Khám phá FAB] · Club · Setting — FAB lệch vị trí 2/4, designer giải cân bằng ở taste pass; Feed bật → 5 tab, FAB về đúng giữa. Gộp Kèo của tôi vào Home = mô hình Sporta (đánh đổi thêm-1-chạm owner đã chấp nhận 19/07).

| State | Nội dung |
|-------|----------|
| Loading | Skeleton shimmer giữ đúng layout: 2 chip skeletons + hero card skeleton + 3 compact row skeletons |
| Ready | Như layout trên — full data |
| Error | Toast "Không tải được trang chủ" + retry; không giữ/render person-self snapshot cũ |
| Empty | Chips = [💸 Còn nợ 0đ (chỉ proven `known_zero`), 📅 0 kèo]; CTA "Khám phá kèo" → marketplace. Streak vẫn deferred |
| Onboarding | Thay chips bằng welcome checklist từ `onboarding_steps` (migration `0008`) + suggested sessions |

**Empty state layout:**

```
┌──────────────────────────────────────┐
│ [Avatar] Xin chào 👋 {tên}   💬 🔔  │  header
│ ┌──────────────┐  ┌───────────────┐ │
│ │ 💸 Còn nợ    │  │ 📅 Kèo tuần   │ │  chips (proven known_zero)
│ │ 0₫           │  │ này: 0        │ │
│ └──────────────┘  └───────────────┘ │
│ ┌──────────────────────────────────┐ │
│ │         📅                       │ │
│ │   Không có kèo sắp tới          │ │
│ │   Tìm kèo phù hợp với bạn!     │ │
│ │                                  │ │
│ │     [🔍 Khám phá kèo]           │ │  CTA → marketplace
│ └──────────────────────────────────┘ │
│ KÈO GỢI Ý (marketplace)             │
│ · (suggested sessions nếu có)        │
└──────────────────────────────────────┘
```

**Onboarding state layout:**

```
┌──────────────────────────────────────┐
│ [Avatar] Xin chào 👋 {tên}   💬 🔔  │  header
│ ┌─ Welcome Checklist ──────────────┐ │
│ │ 👋 Chào mừng đến Plexco!         │ │  ~120px (thay chips)
│ │ Hoàn thành để bắt đầu:           │ │
│ │                                  │ │
│ │ ✅ Tạo tài khoản                │ │  auto-done
│ │ ⬜ Chọn môn yêu thích     [→]  │ │  tappable
│ │ ⬜ Tham gia kèo đầu tiên  [→]  │ │  tappable
│ └──────────────────────────────────┘ │
│ KÈO GỢI Ý CHO BẠN       Xem thêm → │
│ · 🏸 Cầu lông Q7 · T5 · 120k · 5 chỗ│  suggested sessions
│ · ⚽ FC Weekend · CN · 85k · 3 chỗ  │  (by location/popular)
└──────────────────────────────────────┘
```

**Onboarding checklist logic:**

| Step | Label | Trigger hoàn thành | Tap action |
|------|-------|-------------------|------------|
| 1 | ✅ Tạo tài khoản | Đã đăng ký (auto) | — (disabled) |
| 2 | ⬜ Chọn môn yêu thích | Chọn ≥ 1 sport trong settings | → sport picker / settings |
| 3 | ⬜ Tham gia kèo đầu tiên | Join ≥ 1 session | → marketplace |

Auto-dismiss: khi 3/3 hoàn thành → chuyển sang Ready state (chips + session list).

**Loading skeleton layout:**

```
┌──────────────────────────────────────┐
│ [░░░░] ░░░░░░░░░░░░░   ░░ ░░        │  shimmer header
│ ┌──────────────┐  ┌───────────────┐ │
│ │ ░░░░░░░░░░░░ │  │ ░░░░░░░░░░░░ │ │  2 chip skeletons
│ └──────────────┘  └───────────────┘ │
│ ┌──────────────────────────────────┐ │
│ │ ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ │ │  hero skeleton (gradient shimmer)
│ │ ░░░░░░░░░░░░░░░░░░░░           │ │
│ └──────────────────────────────────┘ │
│ ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  │  3 row skeletons
│ ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  │
│ ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  │
└──────────────────────────────────────┘
```

**Adaptive Chip Selection (thay cố định 2 — update theo hướng Sporta):**

| Phase | Pool | Priority (cao → thấp) |
|-------|------|----------------------|
| Phase-1 (S9) | 💸 Còn nợ · 🔥 Streak · 📅 Kèo tuần | 💸 > 🔥 > 📅 |
| Phase-2 (sau B1–B4) | 💰 Chưa thu · 💸 Còn nợ · 🔥 Streak · 📅 Kèo tuần | 💰 > 💸 > 🔥 > 📅 |

**Chip selection matrix (phase-1, FE logic):**

| Condition | Chip 1 | Chip 2 |
|-----------|--------|--------|
| Nợ > 0, streak > 0 | 💸 Còn nợ {amount} · {N} CLB | 🔥 Streak {N} ngày |
| Nợ > 0, streak = 0 | 💸 Còn nợ {amount} · {N} CLB | 📅 Kèo tuần này: {N} |
| Nợ = 0 (`known_zero`), streak > 0 | 🔥 Streak {N} ngày | 📅 Kèo tuần này: {N} |
| Nợ = 0, streak = 0 | 📅 Kèo tuần này: {N} | (ẩn chip 2 hoặc CTA "Khám phá kèo") |
| Nợ = `unknown` | ⚠️ Unavailable + retry | 📅 Kèo tuần này: {N} |

Phase-2 thêm 💰 Chưa thu (host, cross-club, DD-96 Part B): khi > 0 → đẩy xuống 1 bậc, top 2 hiện. Chip tiền: đỏ/vàng theo semantic token; số dùng `tabular-nums`.

**🔥 Streak logic:** đếm ngày liên tiếp (backward from today) mà user có ít nhất 1 session (host hoặc player). Reset về 0 khi có ngày trống. Data từ person-self upcoming/history (player_view). Streak = 0 → chip ẩn, fallback sang 📅 Kèo tuần.

**Hero CTA (conditional — gated bởi HOME-OQ-4):**

| Role | CTA | Điều kiện hiện | Tap action |
|------|-----|---------------|------------|
| Player | 💳 Thanh toán | `payAction` available + `paymentStatus ∈ [open, partial]` + `pricePerSlot > 0` | → protected payment screen (QR/chuyển khoản) |
| Host | 📋 Bảng thu tiền | `payAction` available + session có charges | → payment board (roster trả/chưa trả) |
| (any) | (ẩn) | Free session HOẶC đã paid HOẶC `payAction` chưa available | Chỉ tap card → session detail |

> **Gate:** Hero CTA **chỉ render khi** upcoming session DTO kèm `payAction` (HOME-OQ-4). Hiện tại `payAction` có ở per-club `SelfPaymentStatus` (player_view v2.6) nhưng chưa có trong upcoming session projection. Cần additive contract change từ Player View owner trước khi Home render CTA. Nếu `payAction` chưa available → hero card tap toàn bộ → session detail (behavior hiện tại giữ nguyên).

---

## 4. Domain Model

**Không bảng mới.** Home đọc qua 1 aggregate DTO person-self (BE contract chốt ở build slice, thuộc player_view surface):

| Nguồn | Dữ liệu trên Home | Contract sẵn có |
|-------|--------------------|-----------------|
| player_view person-self | Canonical `remainingAmount` + `known_zero/unknown`, per-club payment status; upcoming sessions + role | `feature_player_view.md` FR-8, canonical `getSelfPaymentStatus`/target `/api/me/charges` (chưa build) |
| marketplace public read model | Suggested sessions (whitelist fields) | `feature_marketplace_discovery.md` |
| notifications §A | Unread count | `feature_notifications_reminders.md` |
| onboarding_steps | Checklist trạng thái | migration `0008` (đã có bảng) |

---

## 5. Analytics Events

| Event | Khi nào | Payload tối thiểu |
|-------|---------|-------------------|
| `home_viewed` | Mở Home | `state` (ready/empty/onboarding) |
| `home_chip_tapped` | Tap chip | `chip_type` |
| `home_hero_tapped` | Tap hero | `role` (host/player) — session ID opaque |
| `home_session_item_tapped` | Tap row | opaque session ref |
| `home_view_all_tapped` | Tap "Tất cả →" | — |
| `home_suggested_tapped` | Tap kèo gợi ý | `position` |
| `home_suggested_view_more_tapped` | Tap "Xem thêm →" (suggested) | — |
| `home_onboarding_step_tapped` | Tap checklist step | `step` |
| `home_onboarding_completed` | Hoàn thành 3/3 → auto-dismiss banner | — |
| `home_empty_explore_tapped` | Tap CTA "Khám phá kèo" (empty state) | — |
| `home_notification_tapped` | Tap 🔔 bell | `unread_count` |
| `home_pull_to_refresh` | Pull-to-refresh | — |
| `home_nav_tab_tapped` | Tap bottom nav tab | `tab_key` |
| `home_hero_pay_tapped` | Tap CTA "Thanh toán"/"Bảng thu tiền" trên hero | `role` (host/player), opaque session ref |

> Opaque IDs only, không PII (theo convention analytics hiện hành).

---

## 6. Acceptance Criteria

### Functional

- [ ] Home render đủ theo coverage matrix (Loading/Ready/Error/Empty/Onboarding + dark)
- [ ] Chips **adaptive** top 2 from pool (phase-1: 3 chips, phase-2: 4); selection matrix đúng priority; số tiền chỉ từ canonical `remainingAmount`, không client/server re-derive; `unknown` không hiển thị 0
- [ ] **Streak chip** đếm ngày liên tiếp đúng; reset khi ngày trống; ẩn khi = 0 (fallback 📅)
- [ ] Hero = kèo kế tiếp (host ưu tiên), tap card tới session detail; áp hero recipe theme-direction §7
- [ ] Hero **CTA "Thanh toán"** (player) / **"Bảng thu tiền"** (host) render đúng điều kiện: có `payAction` + chưa paid + không free. Ẩn khi gated (HOME-OQ-4)
- [ ] Hero countdown badge hiển thị khi session trong 24h; ẩn khi > 24h
- [ ] Upcoming: dedupe host/player, sort host-first + time ASC, max 4 + "Tất cả →"
- [ ] Mỗi session card hiện **role badge** (Host/Player) và **payment dot** (🔴🟡🟢) đúng mapping
- [ ] Suggested chỉ hiện field whitelist; test bất biến HR2 pass
- [ ] SSE cập nhật chips/rows khi settle/cancel; offline banner + chặn money action
- [ ] Không cache person-self Home sections; offline chỉ được giữ public suggested projection theo Marketplace cache policy
- [ ] Không request nào nhận person/tenant ID từ client cho dữ liệu cá nhân
- [ ] Pull-to-refresh refresh toàn bộ aggregate

### States

- [ ] Loading: skeleton shimmer giữ đúng layout (2 chip skeletons + hero skeleton + 3 row skeletons)
- [ ] Ready: full data hiển thị chính xác
- [ ] Error: toast + retry; không giữ/render person-self snapshot cũ
- [ ] Empty: chips = [💸 0đ (proven `known_zero`), 📅 0]; CTA "Khám phá kèo" → marketplace
- [ ] Onboarding: welcome checklist (3 steps) + suggested sessions; auto-dismiss khi 3/3 hoàn thành

### UI/UX

- [ ] Mọi string `t(vi,en)`; touch target ≥ 44px (PWA)
- [ ] Chip tiền: đỏ/vàng theo semantic token; số dùng `tabular-nums`
- [ ] Hero card gradient + glow theo theme-direction §7
- [ ] Payment dots dùng đúng semantic colors (🔴 open, 🟡 partial, 🟢 paid)
- [ ] Bottom nav render từ registry duy nhất; Feed gate OFF không để lại khoảng trống/tab chết; thêm/bớt tab không sửa component nav
- [ ] Dark mode: same layout, dark theme variant

### Analytics

- [ ] Mọi event trong §5 fire đúng trigger + payload
- [ ] `home_nav_tab_tapped` (`tab_key`) cho mọi tab
- [ ] `home_hero_pay_tapped` fire khi tap hero CTA (gated — chỉ khi CTA visible)
- [ ] Opaque IDs only — không PII trong analytics payload

---

## 7. Open Questions / Changelog

### Open Questions

| ID | Quyết định | Trạng thái |
|---|---|---|
| HOME-OQ-1 | Chip "💰 Chưa thu" (host, aggregate xuyên CLB — cần contract host-self) | 🟡 **DD-96 Part B đảo DD-79 defer → direction ✅, mechanism 🟡.** Owner chốt có chip Chưa thu. 4 blocker B1–B4 chưa đóng: (B1) design-probe host-self cross-tenant, (B2) `authorizeTenantAction` 0 caller, (B3) chưa Reviewed DTO owner, (B4) fan-out semantics. **Thứ tự: B3→B1→B2→chip.** Phase-2 — negative scope tới khi đóng (không placeholder/slot trống). |
| HOME-OQ-2 | Home thay landing hiện tại của web shell? | ✅ **Chốt DD-79: yes, S9 cùng PWA shell** |
| HOME-OQ-3 | Streak chip phase-1? | ✅ **Un-defer (v0.12):** Streak vào pool adaptive phase-1 (priority #2, fallback khi không nợ). Logic: đếm ngày liên tiếp backward; data từ person-self history (player_view). Không cần contract mới — read-only trên sessions đã có. |
| HOME-OQ-4 | Hero CTA "Thanh toán" / "Bảng thu tiền" | 🟡 **Mới (v0.12).** Direction: có CTA (theo Sporta). **Gated:** cần Player View expose `payAction` trong upcoming session DTO (hiện chỉ có ở per-club `SelfPaymentStatus`, v2.6 pin "never a global/item action"). Cần additive contract change request tới Player View owner. Không CTA = tap hero → session detail (giữ behavior hiện tại). |

### Changelog

| Date | Version | Thay đổi |
|---|---|---|
| 2026-08-08 | v0.12 | **Port Sporta UX decisions:** (1) Chips chuyển từ cố định 2 → **adaptive selection** (pick top 2 from pool by priority) — phase-1 pool [💸 Còn nợ, 🔥 Streak, 📅 Kèo tuần], phase-2 thêm [💰 Chưa thu] sau B1–B4. (2) **Hero CTA** "Thanh toán" (player) / "Bảng thu tiền" (host) — conditional, gated bởi HOME-OQ-4 (`payAction` trong upcoming DTO). (3) **Streak un-defer** (HOME-OQ-3) — đếm ngày liên tiếp, vào pool phase-1 priority #2. (4) HOME-OQ-1 reopen theo DD-96 Part B. Thêm HOME-UC-4b/UC-5, chip selection matrix, hero CTA spec table, 1 analytics event (`hero_pay_tapped`). Không đổi composition-only boundary DD-79. |
| 2026-08-08 | v0.11 | Port Sporta ưu điểm: thêm component spec tables (payment dots, role badges, countdown), per-state ASCII layouts (Empty/Onboarding/Loading), 6 analytics events mới (`view_all`, `suggested_view_more`, `onboarding_completed`, `empty_explore`, `notification`, `pull_to_refresh`), AC restructure thành Functional/States/UI/Analytics sub-sections. Không đổi boundary/contract. |
| 2026-07-31 | v0.10 | Restore the fixed two-chip Empty contract: proven-zero debt + zero weekly sessions; streak remains deferred. No runtime authorization. |
| 2026-07-31 | v0.9 | Gỡ hero payment/management CTA vì current Home DTO không có hero amount/`payAction`; cấm client cache person-self Home sections để khớp Player View, chỉ public suggested được cache. Không đổi runtime/readiness. |
| 2026-07-31 | v0.8 | Đồng bộ public Marketplace projection: suggested chỉ render scalar public price + `slots_open` ("N chỗ trống"), không denominator; upcoming person-self hero không invent capacity field. Không đổi runtime/readiness. |
| 2026-07-28 | v0.7 | Reconcile primary plan v1.8 `PLAN_READY` at `90d292d`; preserve composition-only, per-slice `CODE_READY` and no-runtime boundaries. |
| 2026-07-27 | v0.6 | Đồng bộ DD-91: Home consume duy nhất canonical self-payment projection (`remainingAmount`/`getSelfPaymentStatus`), pin `known_zero` khác `unknown`, không query/sum ledger hay tạo payment state riêng. CTA route tới protected payment renderer; exact requester-only `/pay` là target deterministic/no-store/no-LLM và chưa có runtime. |
| 2026-07-19 | v0.5a | Làm rõ Club tab (owner): gồm cả CLB user **tạo/sở hữu** lẫn CLB **tham gia** (cùng contract memberships person-self, phân nhóm + role badge; context theo quyền) + CTA Tạo CLB → onboarding. Không đổi contract. |
| 2026-07-19 | v0.5 | **Nav final v3 (owner):** 5 slot Home · Feed · [Khám phá FAB] · **Club** (mới — `/me/clubs` person-self → club context) · Setting; **Chat lên header 💬 cạnh 🔔** (không chiếm tab). Feed OFF tới DD-76 → phase-1 render 4. |
| 2026-07-19 | v0.4 | **DD-79 amendment final (owner):** gộp Kèo của tôi vào Home (sub-screen "Tất cả →"/chip Còn nợ) — nav 4 slot, phase-1 render 3 tab (1-FAB-1). |
| 2026-07-19 | v0.3a | Label fix (owner): tab 2 = **Kèo của tôi** · tab 3 = **Khám phá** — làm rõ 2 vai trò (của tôi vs tìm & join); cấu trúc không đổi. |
| 2026-07-19 | v0.3 | **DD-79 amendment (owner) — bottom nav:** 5 slot Home · Session · [Discover center/FAB] · Feed · Setting; registry config-driven (user-customize defer); Feed config-OFF tới DD-76 clear, phase-1 render 4 tab. Thêm edge #13 + 2 AC nav. |
| 2026-07-19 | v0.2 | **DD-79 ✅ chốt (owner) → promote Reviewed contract.** HOME-OQ-1..3 resolve theo defaults: chips phase-1 cố định [Còn nợ, Kèo tuần] (defer Chưa thu + streak), landing S9. Thêm BE companion `../BE/feature_home_tech.md` v0.1. |
| 2026-07-19 | v0.1 | 🟡 Khởi tạo Draft **proposal** — fork từ Sporta `feature_home.md` v2.5 (chips adaptive, hero next-session, onboarding checklist, 4 states, sort/dedupe logic) + adapt sang canonical Plexco: person-self contract (player_view), public whitelist (HR2), i18n (HR5), SSE, `onboarding_steps` sẵn có; hero theo theme-direction §7. Không bảng/API mới ngoài aggregate DTO thuộc player_view surface. Chờ DD chốt scope/phase; BE companion viết cùng build slice sau DD. |
