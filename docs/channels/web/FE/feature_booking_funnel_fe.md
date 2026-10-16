# Feature: Channel Booking Funnel — FE Design Spec (Web Surfaces)

> **Route(s):** `/s/:ref` · `/link/:handoff_id` · inline payment hold (bot surface)
> **Source authority:** `../../../features/FE/feature_channel_booking_funnel.md` v1.1 · baseline `0c5808fc7cf50d139bdd9c4ee79917bf4059c4f4`
> **Source contract status:** Reviewed — booking flow, hold, link, settlement
> **Projection/API contract:** Public session card from `public_sessions` whitelist; booking handoff single-use; payment hold per session
> **Capability/availability:** Public (shared link landing); auth required for account link
> **Priority:** — core booking flow
> **FE design status:** Draft
> **Runtime status:** Not started
> **Negative scope:** Bot card layouts (Messenger/Zalo) ngoài scope — chỉ spec web-rendered surfaces; bot-to-web handoff boundary. Settlement/reconcile → `feature_payments_fe.md`

> 📍 **Đọc nhanh (cập nhật 2026-09-15 — chỉ mục, không phải authority):** feature nguồn `../../../features/FE/feature_channel_booking_funnel.md`; scope/phase đọc ở `BRD.md` v3.10 §📍 · hành vi `PRD.md` v2.9 §📍 · contract `TDD.md` v3.2 §📍 · **tiến độ thật `ROADMAP.md` v3.17 §📍** (mốc `main@e235ea4`, 15/09).
>
> **Phase-1 (DD-114):** 🟡 free/linked qua Zalo bot; hold/pay-now ngoài · **Launch (DD-113):** 🟡
>
> **Surface:** Web app **PWA** (Next.js App Router, installable/offline — DD-113 launch = PWA + Zalo bot song song) — `/s/:ref` share link chặn bởi DD-41; `/link/:handoff_id` thuộc nhóm 4; **app native iOS (App Store) + Android (CH Play) là phase-2** (DD-69): tái dùng API/contract, màn native thiết kế lại theo platform sau gate, **không phải bản sao màn này**.
>
> **Trạng thái:** FE design Draft · 🔴 **FE PENDING (DD-116)** — không mở page/component, không track `.pen` tới khi đủ cả ba vế (chọn đúng một `.pen` canonical · tracked trên `main` · owner ký gate DD-81) · as-built @ `main@e235ea4`: **0 màn FE nối API** (đúng 1 `apps/web/app/page.tsx`); BE: `channel_booking_intents` chưa migrate.

---

## 1. Mô tả

Booking funnel chạy chủ yếu trên bot (Messenger/Zalo), nhưng một số surfaces render trên web: landing page khi ai đó share link kèo, trang link account khi user chưa có Plexco account, và trang countdown thanh toán hold. Spec này cover 4 web surfaces — bot card layouts do platform adapter quyết định, không thuộc FE design.

---

## 2. User Flows

### Flow 1: Ai đó share link kèo → Landing page

1. Người nhận mở link `/s/:ref` trên browser
2. Thấy public session card: sport, time, venue area (coarse), slots, price
3. CTA: "Đăng ký qua Plexco" → redirect app/bot hoặc "Tải Plexco"

### Flow 2: Account link handoff (từ bot)

1. Bot tạo opaque handoff link → user mở `/link/:handoff_id` trên web
2. Nếu đã có account → đăng nhập → confirm "Link tài khoản Plexco này với {channel}"
3. Nếu chưa có account → onboarding ngắn → verify → confirm link
4. Thành công → callback về bot → bot resume booking intent

### Flow 3: Payment hold countdown (web view trong bot)

1. User chọn "Thanh toán ngay" trong bot
2. Web view mở: QR code + pay_code + countdown 15:00
3. User thanh toán → webhook verify → "✅ Đã xác nhận"
4. Nếu hết hạn → "Hết hạn — chuyển về cuối hàng"

### Flow 4: Post-booking confirmation

1. Sau booking thành công → confirmation page
2. Active: hiện venue chi tiết + khoản cần trả/đã trả
3. Waitlisted: hiện vị trí trong hàng chờ, không venue/QR

---

## 3. Screens & States

### Shared Link Landing — `/s/:ref` (public)

#### Layout (Desktop 1440px)

```
┌──────────────────────────────────────────────────────────────┐
│                      🟠 plexco                                │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│     ┌──────────────────────────────────────────────┐        │
│     │         [Session Hero Image/Sport Icon]      │        │
│     │                                              │        │
│     │  🏸 Cầu lông tối thứ Tư                     │        │
│     │  🕒 19:00–21:00, 30/07/2026                  │        │
│     │  📍 Quận 3 · Khu vực (không lộ địa chỉ)     │        │
│     │  👥 12 đã xác nhận · 2 chỗ còn              │        │
│     │  💳 120,000đ                                 │        │
│     │                                              │        │
│     │  ─────────────────────────────────────────── │        │
│     │  Tổ chức bởi: CLB Cầu lông BT               │        │
│     │                                              │        │
│     │  [════ Đăng ký qua Plexco ════]             │        │
│     │  hoặc                                        │        │
│     │  [Tải Plexco →]                             │        │
│     │                                              │        │
│     └──────────────────────────────────────────────┘        │
│                                                              │
│     Powered by plexco · Privacy · Terms                     │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

#### Layout (Mobile 375px)

```
┌──────────────────────────┐
│       🟠 plexco          │
├──────────────────────────┤
│                           │
│  [Sport Icon / Hero]     │
│                           │
│ 🏸 Cầu lông tối thứ Tư  │
│ 🕒 19:00–21:00, 30/07   │
│ 📍 Quận 3               │
│ 👥 12 xác nhận · 2 chỗ  │
│ 💳 120,000đ              │
│                           │
│ ─────────────────────── │
│ CLB Cầu lông BT          │
│                           │
│ [══ Đăng ký Plexco ══]  │
│ hoặc [Tải Plexco →]     │
│                           │
├──────────────────────────┤
│ plexco · Privacy · Terms │
└──────────────────────────┘
```

#### States

- **Loading:** Skeleton card: sport icon circle + 5 text line skeletons + CTA skeleton button
- **Ready:** Session card with all fields populated + CTA buttons
- **Empty (session ended/cancelled):** Illustration 📅 + `t("Buổi chơi này đã kết thúc hoặc bị hủy", "This session has ended or was cancelled")` + CTA `t("Khám phá kèo khác", "Explore other sessions")`
- **Empty (session full):** Card hiện nhưng CTA đổi: `t("Hết chỗ — Vào danh sách chờ", "Full — Join waitlist")`
- **Error:** `t("Không tìm thấy buổi chơi. Link có thể đã hết hạn.", "Session not found. This link may have expired.")`

#### Error mapping

| Status | Error code | Visible state | i18n `t(vi, en)` |
|---|---|---|---|
| 404 | `SESSION_NOT_FOUND` | Error page: link expired | `t("Không tìm thấy buổi chơi", "Session not found")` |
| 410 | `SESSION_ENDED` | Info page: session ended | `t("Buổi chơi đã kết thúc", "Session has ended")` |
| — | *(unknown / timeout)* | **Fail closed** — error + retry | `t("Không tải được. Thử lại.", "Couldn't load. Try again.")` |

#### Responsive

| Breakpoint | Shared Link |
|---|---|
| 1440px | Card centered max-width 520px; generous whitespace |
| 768px | Card centered max-width 480px |
| 375px | Card full width with padding 16px |

---

### Account Link Handoff — `/link/:handoff_id`

#### Layout (Mobile 375px)

```
┌──────────────────────────┐
│       🟠 plexco          │
├──────────────────────────┤
│                           │
│  🔗 Liên kết tài khoản  │
│                           │
│  Liên kết tài khoản      │
│  Plexco của bạn với      │
│  Messenger để đặt kèo   │
│  nhanh hơn.              │
│                           │
│  ┌──────────────────────┐│
│  │ Messenger: Nguyễn A  ││
│  │ Plexco: nguyena@...  ││
│  └──────────────────────┘│
│                           │
│  [══ Xác nhận liên kết ══]│
│  [Không, quay lại]       │
│                           │
├──────────────────────────┤
│ plexco · Privacy · Terms │
└──────────────────────────┘
```

#### States

- **Loading:** Skeleton: link info card skeleton + 2 button skeletons
- **Ready:** Channel identity + Plexco identity + confirm/cancel CTAs
- **Already linked:** Info: `t("Tài khoản đã được liên kết", "Account already linked")` + CTA back to bot
- **Error (expired handoff):** `t("Link liên kết đã hết hạn. Quay lại bot để tạo link mới.", "Link expired. Go back to the bot to create a new one.")`
- **Error (unknown):** Generic error + retry

#### Error mapping

| Status | Error code | Visible state | i18n `t(vi, en)` |
|---|---|---|---|
| 404 | `HANDOFF_NOT_FOUND` | Error: expired/used | `t("Link liên kết không tìm thấy hoặc đã sử dụng", "Link not found or already used")` |
| 409 | `ALREADY_LINKED` | Info: already linked | `t("Tài khoản đã được liên kết", "Account already linked")` |
| 401 | `UNAUTHENTICATED` | Redirect login → return | `t("Đăng nhập để liên kết", "Log in to link your account")` |
| — | *(unknown / timeout)* | **Fail closed** — error + retry | `t("Lỗi liên kết. Thử lại.", "Link error. Try again.")` |

#### Responsive

| Breakpoint | Account Link |
|---|---|
| 1440px | Card centered max-width 440px |
| 768px | Card centered max-width 420px |
| 375px | Full width with padding 16px |

---

### Payment Hold Countdown — web view trong bot

#### Layout (Mobile 375px)

```
┌──────────────────────────┐
│  💳 Thanh toán giữ chỗ   │
├──────────────────────────┤
│                           │
│  Chuyển khoản chính xác: │
│                           │
│  ┌──────────────────────┐│
│  │     120,000đ         ││
│  │     Mã: PXC-A1B2    ││
│  └──────────────────────┘│
│                           │
│  ┌──────────────────────┐│
│  │     [QR Code]        ││
│  │                      ││
│  │  Quét để thanh toán  ││
│  └──────────────────────┘│
│                           │
│  ⏱️ Giữ chỗ còn:        │
│  ┌──────────────────────┐│
│  │      12:45           ││
│  │  (countdown timer)   ││
│  └──────────────────────┘│
│                           │
│  Chỗ chỉ xác nhận khi   │
│  Plexco nhận được CK.    │
│                           │
│  [Tôi đã thanh toán]    │
│  [Link Plexco thay thế] │
│  [Huỷ giữ chỗ]          │
│                           │
└──────────────────────────┘
```

#### States

- **Loading (creating hold):** Spinner + `t("Đang giữ chỗ...", "Holding your spot...")`
- **Ready (active hold):** QR + pay_code + countdown timer (green, counting down from 15:00)
- **Warning (≤2 min):** Countdown turns red + pulse animation
- **Success (payment verified):** ✅ animation + `t("Đã xác nhận thanh toán! Chỗ của bạn đã được giữ.", "Payment confirmed! Your spot is secured.")`
- **Expired:** Illustration ⏰ + `t("Hết hạn giữ chỗ — bạn đã được chuyển về cuối hàng", "Hold expired — you've been moved to the back of the queue")`
- **Error:** `t("Lỗi tạo giữ chỗ. Quay lại bot để thử lại.", "Error creating hold. Go back to the bot to try again.")`

#### Error mapping

| Status | Error code | Visible state | i18n `t(vi, en)` |
|---|---|---|---|
| 409 | `HOLD_ALREADY_EXISTS` | Show existing hold + countdown | `t("Bạn đã có giữ chỗ đang hoạt động", "You already have an active hold")` |
| 409 | `SESSION_FULL` | Info: full → waitlist | `t("Hết chỗ. Vào danh sách chờ?", "Full. Join waitlist?")` |
| 410 | `HOLD_EXPIRED` | Expired state | `t("Hết hạn giữ chỗ", "Hold expired")` |
| — | *(unknown / timeout)* | **Fail closed** | `t("Lỗi. Quay lại bot.", "Error. Go back to the bot.")` |

---

### Post-booking Confirmation

#### Layout (Mobile 375px)

```
┌──────────────────────────┐
│  ✅ Đã xác nhận          │
├──────────────────────────┤
│                           │
│  🏸 Cầu lông tối thứ Tư │
│  🕒 19:00–21:00, 30/07  │
│  📍 Sân ABC, 123 Lê Lợi │
│     Quận 3               │
│  💳 120,000đ — ✅ Đã trả │
│                           │
│  ─────────────────────── │
│                           │
│  📱 Mở trong Plexco để  │
│  xem chi tiết kèo       │
│                           │
│  [══ Mở Plexco ══]      │
│  [Chia sẻ cho bạn bè]   │
│                           │
└──────────────────────────┘
```

#### States

- **Active:** Full venue address revealed + payment status ✅ + CTA "Mở Plexco"
- **Waitlisted:** Vị trí hàng chờ + `t("Bạn đang ở vị trí #N trong hàng chờ", "You're #N on the waitlist")` — không venue, không QR
- **Pending approval:** `t("Yêu cầu đã gửi. Host sẽ phản hồi sớm.", "Request sent. The host will respond shortly.")`

---

## 4. Components Used

| Component | States | Mô tả |
|---|---|---|
| `SessionPublicCard` | loading (skeleton), ready, ended, full | Public session info card |
| `SlotIndicator` | available (green), limited (orange ≤3), full (red) | Availability indicator |
| `LinkAccountCard` | channel identity + plexco identity | Link confirmation card |
| `PaymentCountdown` | active (green), warning (red pulse ≤2min), expired (gray), verified (✅) | Countdown timer |
| `QRCodeBlock` | loading (skeleton), ready, expired (blur + "Hết hạn") | QR code + pay_code display |
| `PayCodeDisplay` | monospace, copy-on-tap | "PXC-A1B2" payment code |
| `ConfirmationCard` | active (venue), waitlisted (position), pending (approval) | Post-booking status card |
| `ShareButton` | default, copied (toast) | Share session link |
| `PlexcoBrandHeader` | logo + minimal nav | Branded top bar for public pages |

---

## 5. Edge Cases (UX)

| # | Case | Hiển thị |
|---|---|---|
| 1 | Hold hết hạn khi user đang ở trang | Countdown → 00:00 → auto-transition sang Expired state; không redirect tự động |
| 2 | Double-click "Xác nhận đăng ký" | Button disabled + spinner sau click đầu tiên |
| 3 | Link handoff đã sử dụng | "Link đã được sử dụng. Quay lại bot." + icon ⚠️ |
| 4 | Session full khi user vừa mở link | Card hiện bình thường nhưng CTA = "Hết chỗ — Vào danh sách chờ" |
| 5 | Price thay đổi giữa browse và confirm | Bot hiển thị giá mới và yêu cầu confirm lại — FE không cache giá cũ |
| 6 | QR code không load được (network) | Fallback: hiện pay_code text only + bank info text + "Quét mã không khả dụng" |
| 7 | User đã có account nhưng chưa verify | Link page redirect sang verify flow trước → sau verify → quay lại confirm link |
| 8 | Offline khi đang countdown | Toast "Mất kết nối — countdown tiếp tục phía server" — timer vẫn chạy local nhưng server authoritative |
| 9 | Session cancelled khi đang hold | Hold auto-void → UI transition sang "Buổi chơi đã bị hủy" + CTA khám phá kèo khác |
| 10 | Shared link mở trên desktop nhưng booking cần mobile | CTA "Tải Plexco" + deep link nếu đã cài app |

---

## 6. Data hiển thị

| Field | Format | i18n `t(vi, en)` | Ghi chú |
|---|---|---|---|
| Sport + session name | Text | `data — no copy` | Từ `public_sessions` |
| Time | "HH:mm–HH:mm, DD/MM" | locale formatter | |
| Venue area (coarse) | "Quận N" | `data — no copy` | KHÔNG address cụ thể trước confirm |
| Venue full (post-confirm) | Full address | `data — no copy` | Chỉ khi active |
| Slots available | "N chỗ còn" | `t("%d chỗ còn", "%d spots left")` | `slots_open` từ `getSessionOccupancy()` (DD-133); không có `confirmed_count` public |
| Price | "120,000đ" | `t("đ", "₫")` tabular-nums | VND format |
| Pay code | "PXC-XXXX" | `data — no copy` | Monospace, copy-on-tap |
| Countdown | "MM:SS" | `data — no copy` | Server-authoritative |
| Waitlist position | "#N" | `t("Vị trí #%d trong hàng chờ", "Position #%d on waitlist")` | |

> **i18n:** Mọi chuỗi user-facing qua `t(vi, en)`.

---

## 7. Responsive & Interaction Notes

- **Shared link page:** Centered card layout, max-width 520px. SEO: proper `<title>`, `og:title`, `og:image` for social sharing
- **QR code:** Min 200×200px; auto-scale up on larger screens. Blur + "Hết hạn" overlay when expired
- **Countdown timer:** Monospace font, large (32px mobile, 48px desktop). Red pulse animation ≤2min. Server-authoritative — client timer visual only
- **Payment hold:** "Tôi đã thanh toán" button chỉ refresh status — KHÔNG auto-mark paid
- **Link page:** Single-action UI. Confirm = prominent primary; Cancel = text link
- **Dark mode:** Card bg `var(--bg-card)`, countdown text `var(--text-primary)`, warning countdown `var(--error)`, success `var(--success)`, QR bg always white
- **Touch targets:** ≥ 44×44px
- **Deep link:** "Mở Plexco" attempts `plexco://` scheme → fallback app store link

---

_FE Design Spec v0.1 · 2026-08-10 · Source: feature_channel_booking_funnel.md v1.1_
_Changelog v0.1: Initial — 4 web surfaces (Shared Link, Account Link, Payment Hold, Confirmation), 7 sections, 10 edge cases, ASCII wireframes._
_FE Design Spec — 2026-09-08 (cấu trúc, không bump version): thêm khối 📍 Đọc nhanh dưới header — feature nguồn · phase-1 (DD-114) · launch (DD-113) · surface PWA trước, native iOS/Android phase-2 (DD-69) · FE PENDING (DD-116) · as-built @ `e235ea4`. Pointer core docs BRD v3.10 · PRD v2.9 · TDD v3.2 · ROADMAP v3.17. Nội dung thiết kế không đổi._

_Re-pin 2026-09-15 (cấu trúc, không bump version): as-built @ `e235ea4` theo `ROADMAP.md` v3.17 §📍 — 8 command session · 7 route nghiệp vụ · **0 màn FE**; FE PENDING (DD-116) không đổi, DD-119 vẫn 🟡 chưa ratify. Nội dung thiết kế không đổi._
