# Playbook: FE Spec → Design Screens (.pen)

> 🔴 **DỪNG — FE PENDING theo lệnh owner 2026-08-13. KHÔNG thực hiện playbook này lúc này.**
> DD-81 / M0.3 / M4 và **mọi việc FE** đang treo: **không track `.pen`**, không mở page/component,
> không chạy lane FE. Nguồn: `../../autopilot-templates/next-lanes-2026-08-13-RUN.md`.
>
> Cần nói rõ vì playbook này dễ đọc nhầm: đây **không phải** "HOLD chờ gate". Trước 13/08, FE bị chặn bởi
> một gate (canonical `.pen` được track + owner nghiệm thu) — làm xong gate là đi tiếp. Nay là **lệnh owner
> tạm dừng**: gate không còn là thứ chặn, và ai làm theo §0.2/§3/§6.3 dưới đây để "mở khoá" — đặc biệt là
> `git add design.pen` hay ghi canonical node ID vào file — là **đi ngược lệnh owner**.
>
> Playbook giữ lại vì nội dung phương pháp vẫn dùng được khi FE mở lại. **Đọc để hiểu, không để thi hành.**

> **Version:** 1.1 · 2026-08-13 *(v1.0 · 2026-08-10 — bản gốc, không có ranh giới gate)*
> **Dành cho:** Designer bắt đầu vẽ UI/màn cho Plexco App — **khi FE được mở lại**
> **Prerequisite:** Đã đọc `designer-kickoff.md` (scope + ràng buộc DD-57)
> **Template kèm theo:** `../../templates/design-feature-checklist.md` (copy per feature)
>
> ⚠️ **Hai chỗ playbook này KHÔNG còn khớp contract, sửa trước khi dùng lại:**
> 1. **Breakpoint** (§ Responsive, các dòng 375/768/1440 áp cho *mọi* screen) — DD-99 OQ-1 chốt phương án
>    (a) ngày 07/08: 768px **chỉ** cho dashboard-shell surface; player-facing pin 375 + desktop và **cấm**
>    tự đặt số trung gian. Các FE spec đã tuân thủ; playbook thì chưa ⇒ **spec thắng**.
> 2. **Thứ tự ưu tiên** ở §0.4 tự khai là "theo `designer-kickoff.md §3B`" nhưng **không khớp** §3B, và
>    không phản ánh thứ tự P2→P4→P3 owner đã chốt ở DD-99. Đừng dùng bảng đó làm thứ tự thi công.

---

## Tổng quan

Playbook này hướng dẫn designer **từng bước** để đi từ FE Design Specs có sẵn đến screens hoàn chỉnh trong `design.pen`. Plexco đã có **17 FE Specs A-grade** — mỗi file chứa đầy đủ wireframe, 4 states, error mapping, i18n, edge cases và responsive breakpoints. Designer không cần đọc BRD/Product spec/BE tech docs — **FE spec là nguồn sự thật duy nhất** khi vẽ màn.

```
FE Spec (feature_*_fe.md)
       │
       ├── §1 Mô tả → hiểu feature
       ├── §2 User Flows → hiểu luồng
       ├── §3 Screens & States → vẽ màn (wireframe + 4 states + error mapping + responsive)
       ├── §4 Components → kiểm component library
       ├── §5 Edge Cases → vẽ edge case screens
       ├── §6 Data hiển thị → copy text chính xác
       └── §7 Responsive & Interaction → animation + dark mode + touch targets
```

---

## Bước 0: Setup — Chuẩn bị trước khi vẽ bất kỳ feature nào

> Chỉ làm 1 lần, khi bắt đầu dự án.

### 0.1 Đọc context (2 file)

| # | File | Thời gian | Mục đích |
|---|------|-----------|----------|
| 1 | [designer-kickoff.md](./designer-kickoff.md) | 15 phút | Scope, thứ tự vẽ, ràng buộc DD-57, checklist nghiệm thu |
| 2 | [design-brief.md](./design-brief.md) | 20 phút | Personas, user journeys, sitemap, deliverables |

### 0.2 Setup Design System trong .pen (2 file)

| # | File | Thời gian | Mục đích |
|---|------|-----------|----------|
| 3 | [design-tokens.md](../../standards/design-tokens.md) | 30 phút | Tạo variables trong .pen khớp chính xác file này (color, typography, spacing, radius, shadow, motion) |
| 4 | [design-system.md](../../standards/design-system.md) | 45 phút | Build component library theo catalog 45+ components. Mỗi component đủ states: default · hover · focus · active · disabled · loading |

### 0.3 Build Component Library trong .pen

Trước khi vẽ bất kỳ screen nào:

1. **Tạo page `DS /`** (Design System) trong .pen
2. Từ `design-system.md` → build mỗi primitive:
   - Button (primary, secondary, ghost, danger, disabled, loading)
   - Input/Field (default, focus, error, disabled)
   - Card (default, hover, skeleton)
   - Badge/Tag/Chip (mỗi variant)
   - Toast (success, error, warning, info)
   - Skeleton (text, avatar, card, table-row)
   - Empty State (icon + text + CTA)
   - Modal / Bottom Sheet
   - Tabs
   - Avatar
   - Table / List row
3. Mỗi component có:
   - [x] Light variant
   - [x] Dark variant
   - [x] Tất cả states (default, hover, focus, active, disabled, loading)
   - [x] Text mẫu vi + en
4. **Tokens check:** Chỉ dùng token từ `design-tokens.md`. Nếu thiếu → ghi vào `token-needs-matrix.md`, KHÔNG hardcode.

### 0.4 Chọn feature đầu tiên

Theo thứ tự ưu tiên trong `designer-kickoff.md §3B`:

| Ưu tiên | Feature | FE Spec |
|---|---|---|
| 🔴 1st | Auth (Landing + Login) | `feature_auth_fe.md` |
| 🔴 2nd | Onboarding Wizard | `feature_onboarding_fe.md` |
| 🔴 3rd | Dashboard | `feature_dashboard_fe.md` |
| 🔴 4th | Sessions | `feature_sessions_fe.md` |
| 🟠 5th | Payments | `feature_payments_fe.md` |
| 🟠 6th | Members | `feature_members_fe.md` |
| 🟠 7th | Settings | `feature_settings_fe.md` |
| 🟡 8th | Marketplace | `feature_marketplace_fe.md` |
| 🟡 9th | Player View | `feature_player_view_fe.md` |
| 🟡 10th | Chat | `feature_chat_fe.md` |
| 🟢 11th | Notifications | `feature_notifications_fe.md` |
| 🟢 12th | Home | `feature_home_fe.md` |
| 🟢 13th | Club | `feature_club_fe.md` |
| 🟢 14th | Assistant | `feature_club_assistant_fe.md` |
| 🟢 15th | Booking Funnel | `feature_booking_funnel_fe.md` |
| 🟢 16th | Session Organize | `feature_session_organize_fe.md` |
| 🟢 17th | Tournament | `feature_tournament_fe.md` |

> [!TIP]
> **Home (#12) nên vẽ ĐẦU TIÊN** (theo `designer-kickoff.md #13`) để confirm/tune target theme C + Sora/Inter trên light/dark. Tuy output priority ở cuối, Home là nơi test visual direction.

---

## Bước 1: Đọc FE Spec — Hiểu feature (15-30 phút)

> Cho MỖI feature, bắt đầu ở đây.

### 1.1 Đọc header

```markdown
> **Route(s):** /clubs/:tenantId/...
> **Source contract status:** Reviewed / Draft
> **Capability/availability:** Host Pro / Public / Auth required
> **Negative scope:** {phần nào KHÔNG thuộc feature này}
```

**Ghi nhận:**
- [ ] Route(s) — biết URL pattern
- [ ] Ai xài (Host / Player / Public)
- [ ] Negative scope — KHÔNG vẽ phần này

### 1.2 Đọc §1 Mô tả + §2 User Flows

- Hiểu feature làm gì, ai dùng, flow chính
- Note số lượng flows — mỗi flow sẽ thành 1+ screens

### 1.3 Scan §3 trước — note tổng screens

- Đếm bao nhiêu screens trong §3
- Check có `UNPINNED` / fixture fence không → mark phần KHÔNG vẽ
- Note error mapping table per screen

### 1.4 Copy template checklist

Copy file `design-feature-checklist.md` → đặt tên `design-checklist-{feature}.md`, điền tên feature.

---

## Bước 2: Kiểm Component Library (30 phút)

> Từ FE spec §4 "Components Used"

### 2.1 Liệt kê components từ §4

Mở FE spec §4, copy bảng components. Với mỗi component:

| Hành động | Chi tiết |
|---|---|
| ✅ Đã có trong .pen | Kiểm tra states có đủ theo cột "States" trong §4 không |
| ❌ Chưa có | → Tạo trong page `DS /` TRƯỚC khi vẽ screen |
| ⚠️ Có nhưng thiếu state | → Bổ sung state còn thiếu |

### 2.2 Tạo components thiếu

Mỗi component mới:
1. Đặt trong page `DS / {Feature} / {ComponentName}`
2. Vẽ TẤT CẢ states (từ cột "States" trong §4)
3. Light + Dark variant
4. Touch target ≥ 44×44px
5. Text mẫu vi + en

---

## Bước 3: Vẽ Screens — 4 States × 3 Breakpoints (bulk work)

> Đây là phần chính — chiếm 70% effort.

### 3.1 Tạo page structure trong .pen

```
Screen / {Feature} /
├── {Screen 1} — Loading — Desktop
├── {Screen 1} — Loading — Tablet
├── {Screen 1} — Loading — Mobile
├── {Screen 1} — Ready — Desktop
├── {Screen 1} — Ready — Tablet
├── {Screen 1} — Ready — Mobile
├── {Screen 1} — Empty — Desktop    (nếu applicable)
├── {Screen 1} — Empty — Mobile
├── {Screen 1} — Error — Desktop
├── {Screen 1} — Error — Mobile
├── {Screen 2} — ...
└── ...
```

### 3.2 Vẽ từng screen theo FE spec §3

Với **mỗi screen** trong FE spec §3:

#### A. Loading state

1. Đọc phần "**States → Loading**" trong FE spec
2. FE spec mô tả exact skeleton layout (ví dụ: "3 card skeletons + header skeleton")
3. Dùng `Skeleton` component từ DS library
4. Vẽ Desktop (1440px) → Tablet (768px) → Mobile (375px)

#### B. Ready state

1. Đọc **ASCII wireframe** trong FE spec (thường có Desktop + Mobile)
2. **ASCII wireframe = layout guide**, KHÔNG phải pixel-perfect target. Dùng component library để implement
3. Đọc phần "**Responsive**" table → biết layout thay đổi thế nào ở mỗi breakpoint
4. Vẽ Desktop (1440px) trước → adapt xuống Tablet (768px) → Mobile (375px)
5. Dữ liệu hiển thị: dùng **seed data tiếng Việt thực tế** (không "Lorem ipsum")

> [!IMPORTANT]
> **Sidebar responsive rule (mọi màn có sidebar):**
> - `>1024px`: Sidebar fixed 240px
> - `≤1024px`: Collapse 64px icon-only
> - `≤768px`: Ẩn + hamburger overlay
> - IDs: `#sidebar`, `#sidebar-backdrop`, `#menu-toggle`

#### C. Empty state

1. Đọc phần "**States → Empty**" — FE spec cho exact copy: icon + text + CTA
2. Dùng `EmptyState` component
3. Nếu FE spec ghi "N/A" → bỏ qua (form screens thường không có empty)
4. Chỉ cần Desktop + Mobile (Tablet inherits Desktop layout)

#### D. Error state

1. Đọc phần "**States → Error**" + "**Error mapping**" table
2. Generic error: Banner + message + retry button
3. Error mapping table liệt kê specific errors (403, 404, 409...) → quyết định:
   - Redirect (403 unauthorized) → không cần frame riêng
   - Banner inline → dùng chung Error state frame
   - Full-page error (404) → cần frame riêng
4. Chỉ cần Desktop + Mobile cho generic error

### 3.3 Data check

Với mỗi screen đã vẽ, cross-check §6 "Data hiển thị":
- [ ] Text đúng `t(vi, en)` — không bịa copy
- [ ] Số tiền format "150,000đ" (tabular-nums)
- [ ] Ngày giờ format đúng locale vi
- [ ] Badge/chip text đúng enum values

---

## Bước 4: Vẽ Edge Case Screens (45 phút)

> Từ FE spec §5 "Edge Cases (UX)"

### 4.1 Phân loại edge cases

Đọc bảng §5, phân thành 3 nhóm:

| Nhóm | Ví dụ | Cần frame riêng? |
|---|---|---|
| **Component state** | Text truncate, double-click, debounce | ❌ Không — handle trong component |
| **Toast/snackbar** | Network error, copy success | ❌ Không — overlay trên Ready frame |
| **Special screen** | Offline mode, locked state, confirmation dialog, bottom sheet | ✅ Có — vẽ frame riêng |

### 4.2 Vẽ edge case frames

Với mỗi edge case cần frame riêng:
- Đặt tên: `Screen / {Feature} / {Screen} — Edge / {CaseName}`
- Chỉ cần Mobile 375px (edge cases hiếm khi cần 3 breakpoints)

---

## Bước 5: Dark Mode (30 phút per screen)

> DD-57 bắt buộc.

### 5.1 Quy tắc

- Dùng semantic tokens: `var(--bg-card)`, `var(--bg-surface)`, `var(--text-primary)`, `var(--text-secondary)`
- KHÔNG invert manually — switch token values trong .pen variables
- Status badges / chips: verify vẫn đọc được (contrast AA)
- QR codes: luôn white background (bất kể theme)

### 5.2 Frames cần vẽ

- Chỉ cần dark variant cho **Ready state** (Desktop + Mobile)
- Loading/Empty/Error thừa hưởng dark tokens tự động nếu dùng component library đúng

Naming: `Screen / {Feature} / {Screen} — Ready — Dark — Desktop`

---

## Bước 6: Interaction & Motion Notes (15 phút)

> Từ FE spec §7

### 6.1 Annotate trên frame

Đọc §7, annotate trực tiếp trên Ready frame:
- Hover effects (desktop only)
- Tap animations (scale, ripple)
- Transitions (slide-in, fade)
- Touch targets (mark ≥ 44×44px)

### 6.2 Motion spec (nếu có)

Prototype trong .pen hoặc ghi annotation:
```
Hover: opacity 0.9, transition 150ms ease
Press: scale(0.97), transition 100ms
Page transition: slide-left 300ms ease-out
Toast: slide-up 200ms + auto-dismiss 3s
Skeleton: shimmer pulse 1.5s infinite
```

---

## Bước 7: Coverage Audit & Sign-off (15 phút)

### 7.1 Điền Coverage Matrix

Trong `design-checklist-{feature}.md`, điền matrix cuối cùng:

| Screen | Loading | Ready | Empty | Error | Edge Cases | Dark | Total |
|---|---|---|---|---|---|---|---|
| {Screen 1} | ✅ | ✅ | ✅ | ✅ | 3 | ✅ | 15 |
| {Screen 2} | ✅ | ✅ | N/A | ✅ | 1 | ✅ | 9 |
| **Tổng** | | | | | | | **24** |

### 7.2 Self-audit checklist

- [ ] Mọi screen trong FE spec §3 đều có frame
- [ ] Mọi screen data-driven đủ 4 states (Loading · Ready · Empty · Error)
- [ ] 3 breakpoints: 375px / 768px / 1440px
- [ ] Light + Dark cho mọi Ready screen
- [ ] Chỉ dùng tokens từ `design-tokens.md`
- [ ] Mọi text có vi + en
- [ ] Touch ≥ 44×44px
- [ ] Contrast WCAG AA
- [ ] Không vẽ phần `UNPINNED` / fixture fence
- [ ] Không vẽ phần Negative Scope
- [ ] Money dùng tabular-nums
- [ ] Không PII/tiền trên public pages

### 7.3 Request sign-off

Giao cho Product Owner + FE Lead review theo checklist nghiệm thu trong `designer-kickoff.md §4`.

---

## Bước 8: Handoff (per screen)

> Pipeline DD-58. Sau khi screen được sign-off.

1. **Ghi canonical path** trong .pen: exact page/frame/node ID
2. **Tạo handoff file**: `handoff/{screen}-handoff.md` (theo `fe-handoff-template.md`)
3. **Tạo token mapping**: `handoff/{screen}-token-mapping.md` (theo `fe-token-mapping-template.md`)
4. **FE code** → verify screenshot × 3 breakpoints khớp design

---

## Quick Reference: FE Spec §1-§7 Cheatsheet

| Section | Designer dùng để | Thời điểm |
|---|---|---|
| **§1 Mô tả** | Hiểu feature tổng quan | Bước 1 |
| **§2 User Flows** | Hiểu luồng, quyết định screen flow | Bước 1 |
| **§3 Screens & States** | ⭐ Vẽ màn — wireframe + 4 states + error + responsive | Bước 3 |
| **§4 Components Used** | Kiểm tra component library | Bước 2 |
| **§5 Edge Cases** | Vẽ edge case screens | Bước 4 |
| **§6 Data hiển thị** | Copy text chính xác (i18n) | Bước 3 (verify) |
| **§7 Responsive & Interaction** | Dark mode, animation, touch targets | Bước 5-6 |

---

## ⚠️ Những điều KHÔNG ĐƯỢC LÀM

1. **KHÔNG vẽ thẳng từ BRD/Product spec** — luôn theo FE spec
2. **KHÔNG hardcode color/spacing** — luôn dùng token
3. **KHÔNG bịa copy text** — lấy exact `t(vi, en)` từ FE spec §6
4. **KHÔNG vẽ phần `UNPINNED`** — kể cả Product spec có mô tả
5. **KHÔNG vẽ payment widget** (QR/STK/pay_code) — chưa có owner contract
6. **KHÔNG vẽ client-side running total** — số tiền do server trả
7. **KHÔNG skip Empty/Error state** — DD-57 bắt buộc 4 states
8. **KHÔNG tạo token mới** mà không ghi vào `token-needs-matrix.md`

---

## Ví dụ: Vẽ feature Dashboard

### Input: `feature_dashboard_fe.md`

**§3 liệt kê 1 screen chính** (Dashboard Overview) với 4 zones:
- Zone A: Revenue summary
- Zone B: Today's sessions
- Zone C: Pending payments
- Zone D: Quick actions

**Số frames cần vẽ:**

| | Desktop | Tablet | Mobile |
|---|---|---|---|
| Loading (skeleton) | 1 | 1 | 1 |
| Ready (data) | 1 | 1 | 1 |
| Empty (CLB mới) | 1 | — | 1 |
| Error (load fail) | 1 | — | 1 |
| Dark mode (Ready) | 1 | — | 1 |
| **Subtotal** | 5 | 2 | 5 |

**+ Edge cases (~3 frames):** Multi-club switch, badge overflow, sidebar animation

**Tổng: ~15 frames** cho 1 feature Dashboard.

---

## Liên kết tài liệu

| Tài liệu | Đường dẫn | Vai trò |
|---|---|---|
| Designer Kickoff | [designer-kickoff.md](./designer-kickoff.md) | Scope + ràng buộc |
| Design Brief | [design-brief.md](./design-brief.md) | Personas + sitemap |
| Design Tokens | [design-tokens.md](../../standards/design-tokens.md) | Token values (SoT) |
| Design System | [design-system.md](../../standards/design-system.md) | Component catalog |
| Feature Checklist Template | [design-feature-checklist.md](../../templates/design-feature-checklist.md) | Copy per feature |
| Theme Direction | [theme-direction-2026-07.md](./theme-direction-2026-07.md) | Target C Energetic Orange |
| Handoff Pipeline | [frontend-pipeline.md](./frontend-pipeline.md) | design → code pipeline |
| BRD-to-pen Playbook | [brd-to-pen-playbook.md](../../templates/brd-to-pen-playbook.md) | Generic methodology (reference) |
| 17 FE Specs | [FE/](./FE/) | ⭐ Nguồn sự thật cho từng màn |

> 📌 **9/11 link trong bảng này từng hỏng** (viết như thể file nằm sâu hơn một cấp) — sửa 13/08. Nếu thêm
> dòng mới: file này ở `docs/channels/web/`, nên `./` là cùng thư mục, `../../` mới ra `docs/`.

---

_Playbook v1.0 · 2026-08-10_
_Changelog v1.0: Initial — 8 bước (Setup → Đọc FE Spec → Components → Screens → Edge Cases → Dark Mode → Motion → Audit & Handoff), ví dụ Dashboard, liên kết đầy đủ._
