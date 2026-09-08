# Feature: Host Settings — FE Design Spec

> **Route(s):** `/dashboard/settings` · `/me/settings`
> **Source authority:** `../../../features/FE/feature_user_settings.md` v0.9a + `../../../features/FE/feature_tenant_routing_authz.md` v2.7 + `../../../features/FE/feature_payment_reconcile.md` v1.10 + `../../../features/FE/feature_connector_onboarding.md` v1.0 · baseline `0c5808fc7cf50d139bdd9c4ee79917bf4059c4f4`
> **Source authority (BE tokens):** `../../../features/BE/feature_tenant_routing_authz_tech.md` — capability string `content.manage` · `bank_account.manage` · `connector.secret_manage` và mã `TENANT_CONTEXT_REQUIRED` / `NOT_TENANT_ADMIN` / `TENANT_SUSPENDED` / `CAPABILITY_DENIED`; `../../../features/BE/feature_connector_onboarding_tech.md` — mã connector/bank. Ba capability string trên **không** có trong `feature_tenant_routing_authz.md` v2.7; FE lấy nguyên văn từ BE tech doc.
> **Source contract status:** User settings + connector onboarding Draft; routing/authz + payment safety Reviewed
> **Projection/API contract:** User/settings response DTO `UNPINNED`; active form implementation omitted until Reviewed
> **Capability/availability:** `content.manage` · `bank_account.manage` · `connector.secret_manage`
> **Priority:** 8 — designer-kickoff.md §3B
> **FE design status:** Draft
> **Runtime status:** Not started — settings/capability-grant UI chưa build
> **Negative scope:** Tenant và person-self tách route; không expose secret; actions chỉ từ exact canonical capability; security credential/session/link mutations omitted

> 📍 **Đọc nhanh (2026-09-08 — chỉ mục, không phải authority):** feature nguồn `../../../features/FE/feature_user_settings.md` + `../../../features/FE/feature_connector_onboarding.md`; scope/phase đọc ở `BRD.md` v3.10 §📍 · hành vi `PRD.md` v2.9 §📍 · contract `TDD.md` v3.2 §📍 · **tiến độ thật `ROADMAP.md` v3.17 §📍** (mốc `main@0aff7ad`, 04/09).
>
> **Phase-1 (DD-114):** ✅ nhóm 7 settings/privacy · **Launch (DD-113):** ✅ **khối 5/5 settings**
>
> **Surface:** Web app **PWA** (Next.js App Router, installable/offline — DD-113 launch = PWA + Zalo bot song song) — `/dashboard/settings` · `/me/settings`; **app native iOS (App Store) + Android (CH Play) là phase-2** (DD-69): tái dùng API/contract, màn native thiết kế lại theo platform sau gate, **không phải bản sao màn này**.
>
> **Trạng thái:** FE design Draft · 🔴 **FE PENDING (DD-116)** — không mở page/component, không track `.pen` tới khi đủ cả ba vế (chọn đúng một `.pen` canonical · tracked trên `main` · owner ký gate DD-81) · as-built @ `main@0aff7ad`: **0 màn FE nối API** (đúng 1 `apps/web/app/page.tsx`); BE: cột hồ sơ `person.gender/dob/username` ⬜; locale = `tenants.locale` (DD-118).

---

## 1. Mô tả

Trang cài đặt gồm **hai surface tách biệt**:

- **Tenant settings** (`/dashboard/settings`): CLB config, ngân hàng, kênh — yêu cầu exact capability/grant
- **Personal settings** (`/me/settings`): hồ sơ, bảo mật — person-self surface

KHÔNG trộn tenant secrets và personal profile trong cùng 1 route.

Tenant mutations dùng exact canonical capabilities: `content.manage` cho CLB config, `bank_account.manage` cho bank mutations và `connector.secret_manage` cho connector secret/actions. Missing, wrong tenant, expired hoặc revoked grant đều fail-closed; FE không invent capability alias.

---

## 2. User Flows

### Flow 1: Sửa thông tin CLB

1. Host vào `/dashboard/settings` → Tab "CLB"
2. Sửa: tên, timezone, môn mặc định, giá mặc định, chế độ hiển thị
3. Save → toast "Đã lưu"

### Flow 2: Quản lý ngân hàng

1. Tab "Ngân hàng"
2. Thấy bank account hiện tại (masked) + canonical lifecycle `no-row | connecting | registered | active | drift | error | revoked`
3. "Đổi tài khoản" → pending 24h → QR vẫn dùng TK cũ
4. "Hủy đổi" nếu `pending_change` overlay đang active; overlay không thay lifecycle

### Flow 3: Kết nối / sửa kênh

1. Tab "Kênh"
2. Zalo bot: status + actions (reconnect/disconnect)
3. Messenger Page: central vs custom + reconnect
4. Mỗi connector render lifecycle canonical `connecting | registered | active | drift | error | revoked`

### Flow 4: Cài đặt cá nhân (route riêng `/me/settings`)

1. Vào `/me/settings` → Tab "Hồ sơ" → form: tên, username, ngôn ngữ; **giới tính + ngày sinh chỉ hiện sau khi bật consent PII** (`feature_user_settings.md:29`). Có CTA xem/thu hồi consent (USR-UC-6)
2. Tab "Bảo mật" chỉ hiện dependency placeholder; đổi mật khẩu, session list/revoke và linked-account mutations chưa thuộc source authority của spec này

> ⚠️ **Security planes:** Tenant settings và personal settings PHẢI ở route riêng. Không đặt bank secrets và personal profile chung.

---

## 3. Screens & States

### `/dashboard/settings` — Settings (Tabbed)

> **Visual fixture only:** Tenant settings DTOs/mutations còn unpinned theo header. Baseline active form
> phải omit; các tabs/wireframes dưới đây chỉ giữ composition và canonical lifecycle vocabulary.

#### Layout (Desktop 1440px)

```
┌──────────┬──────────────────────────────────────────────────┐
│          │  Header: "Cài đặt"                               │
│ Sidebar  ├──────────────────────────────────────────────────┤
│          │                                                  │
│          │  Tabs (vertical left):                           │
│          │  ┌──────────┬───────────────────────────────┐    │
│          │  │ 🏟️ CLB  │  Tab Content (max-w: 640px)    │    │
│          │  │ 💳 Bank  │                               │    │
│          │  │ 📡 Kênh  │  {varies per tab}             │    │
│          │  └──────────┴───────────────────────────────┘    │
│          │                                                  │
└──────────┴──────────────────────────────────────────────────┘
```

#### Tab: CLB

```
┌──────────────────────────────────────┐
│  🏟️ Thông tin CLB                   │
│                                      │
│  Tên CLB *        [Badminton SG   ]  │
│  Múi giờ          [Asia/Ho_Chi_Mi▾]  │
│  Môn mặc định *   [🏸 Cầu lông   ▾] │
│  Giá mặc định     [150,000    ] VNĐ │
│  Hiển thị          [● Riêng tư    ] │
│                    [○ Công khai   ] │
│                                      │
│  [       Lưu thay đổi       ]       │
└──────────────────────────────────────┘
```

#### Tab: Ngân hàng

```
┌──────────────────────────────────────┐
│  💳 Tài khoản nhận tiền             │
│                                      │
│  Ngân hàng:  Vietcombank             │
│  Số TK:      ***1234                 │
│  Chủ TK:     NGUYEN VAN HOST         │
│  Provider:   ApiPay ✅               │
│  Trạng thái: ✅ Active               │
│                                      │
│  [Đổi tài khoản]                     │
│                                      │
│  ⚠️ Đang chờ đổi (còn 18h)          │
│  TK mới: ***5678                     │
│  [Hủy đổi]                           │
│                                      │
│  ── Lịch sử đổi ──                   │
│  15/07/2026 · ***9999 → ***1234      │
└──────────────────────────────────────┘
```

#### Tab: Kênh

```
┌──────────────────────────────────────┐
│  📡 Kết nối kênh                    │
│                                      │
│  ┌──────────────────────────────┐    │
│  │ 💬 Zalo Bot                  │    │
│  │ @my_badminton_bot            │    │
│  │ ✅ Active                    │    │
│  │ [Kết nối lại] [Ngắt kết nối]│    │
│  └──────────────────────────────┘    │
│                                      │
│  ┌──────────────────────────────┐    │
│  │ 📱 Facebook Messenger        │    │
│  │ Dùng: Plexco central Page    │    │
│  │ ✅ Active                    │    │
│  │ [Đổi sang Page riêng]        │    │
│  └──────────────────────────────┘    │
│                                      │
│  [+ Thêm kênh]                       │
└──────────────────────────────────────┘
```

> ⚠️ **Capability gates:**
>
> - CLB Save: exact `content.manage`
> - Bank Đổi/Hủy đổi: exact `bank_account.manage`
> - Connector secret/reconnect/disconnect/change Page: exact `connector.secret_manage`
> - Missing, wrong-tenant, expired hoặc revoked grant: deny; actions hidden hoặc disabled theo server response, không gửi mutation

> **Connector lifecycle:** `connecting | registered | active | drift | error | revoked`. `insufficient_grant` và expired/revoked authorization là overlay, không phải connector status. `expired_token` là một reason của `error`. Khi server không trả connector row, render empty state "Chưa đăng ký", không invent `disconnected`.

#### Error mapping

| Status | Error code | Visible state | i18n `t(vi, en)` |
|---|---|---|---|
| 401 | `AUTH_REQUIRED` | Không render tab content; redirect về `/` theo exact server-authorized navigation | `t("Bạn cần đăng nhập để tiếp tục.", "Please sign in to continue.")` |
| 403 | `CAPABILITY_DENIED` | Ẩn/disable đúng action thiếu grant (`content.manage` · `bank_account.manage` · `connector.secret_manage`); không gửi mutation, không lộ tenant internals | `t("Bạn không có quyền thực hiện thao tác này.", "You don't have permission for this action.")` |
| 403 | `NOT_TENANT_ADMIN` | Ẩn toàn bộ action mutate của tab; chỉ giữ read-only | `t("Bạn không có quyền admin.", "You're not an admin of this club.")` |
| 403 | `TENANT_SUSPENDED` | Banner đỏ trên settings + mọi mutation disabled (edge case #8) | `t("Gói đã tạm ngưng.", "This club's plan is suspended.")` |
| 403 | `TENANT_CONTEXT_REQUIRED` | Không render tab content; hiện tenant picker do server trả | `t("Chọn CLB để tiếp tục.", "Pick a club to continue.")` |
| 403 | `CSRF_INVALID` | Toast generic + tải lại form; không tự submit lại | `t("Yêu cầu không hợp lệ. Tải lại trang và thử lại.", "Invalid request. Reload the page and try again.")` |
| 400 | `APIPAY_BANK_SELECTION_INVALID` | Inline error trên `BankAccountCard`; buộc chọn lại từ danh sách provider | `t("Phiên chọn tài khoản không hợp lệ hoặc đã hết hạn. Chọn lại.", "That account selection is invalid or expired. Pick again.")` |
| 400 | `OAUTH_STATE_INVALID` | `ConnectorCard` quay về state trước đó + CTA "Kết nối lại" | `t("Phiên kết nối hết hạn. Thử lại.", "The connection session expired. Try again.")` |
| 400 | `STALE_CALLBACK` | Bỏ kết quả callback + CTA thao tác lại; không đổi lifecycle | `t("Yêu cầu đã hết hạn — thử lại.", "This request expired — please try again.")` |
| 409 | `BANK_ALREADY_BOUND` | Inline error trên bank tab; giữ TK cũ, không bind | `t("Tài khoản ngân hàng này đã gắn với CLB khác.", "This bank account is already linked to another club.")` |
| 409 | `CHAT_ALREADY_BOUND` | Inline error trên `ConnectorCard`; CTA "Dùng central Page" | `t("Kênh này đã liên kết CLB khác.", "This channel is already linked to another club.")` |
| 409 | `IDEMPOTENCY_KEY_REUSED` | Không áp mutation; giữ state hiện tại + CTA tải lại | `t("Yêu cầu này đã được dùng cho dữ liệu khác.", "This request was already used with different data.")` |
| 429 | `RATE_LIMITED` | Nút "Lưu thay đổi" / connector actions disabled + inline message | `t("Thao tác quá nhanh — thử lại sau.", "Too many requests — try again shortly.")` |
| 503 | `APIPAY_ENTERPRISE_UNAVAILABLE` | Ẩn CTA đổi tài khoản qua ApiPay; giữ read-only bank card | `t("Kết nối tự động tạm chưa sẵn sàng.", "Automatic setup is temporarily unavailable.")` |
| — | *(unknown / missing / timeout)* | **Fail closed** — unavailable placeholder + retry; KHÔNG suy lifecycle, KHÔNG hiện action | `t("Không tải được. Thử lại.", "Couldn't load. Try again.")` |

> **Error mapping:** Pin server error/status → exact visible state. Unknown/missing response fail closed;
> không invent success, zero, empty hoặc disabled control. Nếu BE chưa pin catalog cho một endpoint,
> ghi `UNPINNED error catalog — omit active UI` thay vì bịa mã.

#### Responsive

| Breakpoint | `/dashboard/settings` |
|---|---|
| 1440px | Sidebar fixed 240px full label (`feature_dashboard_fe.md` §3); header "Cài đặt"; vertical tenant tabs left (200px) + tab content phải, `max-width: 640px` (§7); trong tab, label trái + ô nhập phải |
| 768px | Sidebar ẩn + hamburger ☰ (`feature_dashboard_fe.md` §3: ≤768px hidden + overlay); horizontal tenant tabs top + content below, form giãn hết chiều rộng khả dụng trong `max-width: 640px` |
| 375px | Sidebar ẩn + hamburger; dropdown tenant section selector thay tab bar (§5 #9) + content below; label lên trên, ô nhập full-width; nút "Lưu thay đổi" và các action của `BankAccountCard`/`ConnectorCard` full-width ≥ 44px (§7 touch targets). Baseline omit set không đổi theo breakpoint — active tenant form vẫn omit (DTO/mutations unpinned), và action thiếu grant (`content.manage` · `bank_account.manage` · `connector.secret_manage`) ẩn/disable theo server response ở mọi kích thước, không suy quyền ở client |

---

### `/me/settings` — Personal Settings (person-self)

> ⚠️ **Route riêng.** Hồ sơ và Bảo mật ở đây, KHÔNG ở `/dashboard/settings`.
> **Current boundary:** Profile DTO vẫn Draft/UNPINNED nên active profile form bị omit. Security chỉ
> là dependency placeholder; không render credential/session/link data hoặc mutations.

#### Layout (Desktop 1440px)

```
┌──────────────────────────────────────────────────┐
│  Header: "Cài đặt cá nhân"                           │
├──────────────────────────────────────────────────┤
│                                                  │
│  Tabs: [👤 Hồ sơ] [🔒 Bảo mật]                     │
│                                                  │
│  Tab Content (max-w: 640px, centered)             │
│  {varies per tab}                                 │
│                                                  │
└──────────────────────────────────────────────────┘
```

```
┌──────────────────────────────────────┐
│  👤 Hồ sơ cá nhân                   │
│                                      │
│  Tên hiển thị   [Nguyễn Văn Host  ]  │
│  Username        [@hostng          ] │
│                  ✅ Available        │
│  ── PII có consent (NFR-P1) ──       │
│  ☐ Đồng ý lưu giới tính & ngày sinh  │
│     (mã hoá at-rest · không lộ ra    │
│      public marketplace · thu hồi    │
│      được bất cứ lúc nào)            │
│  Giới tính       [Nam           ▾]   │
│  Ngày sinh       [📅 15/03/1990  ]   │
│  ── hết PII ──                        │
│  Ngôn ngữ        [🇻🇳 Tiếng Việt ▾]  │
│                                      │
│  [       Lưu thay đổi       ]       │
│  [   Xem/thu hồi consent PII    ]    │
└──────────────────────────────────────┘
```

> ⚠️ **PII consent bắt buộc (`feature_user_settings.md:29`, USR-UC-1/USR-UC-6).** `gender` và `dob` là
> **PII có consent**, mã hoá at-rest và **không** nằm trong public field-whitelist. Hai field này chỉ
> được render/ghi khi consent toggle bật; consent tắt ⇒ ẩn cả hai, không prefill, không giữ giá trị cũ
> ở client. Phải có lối **xem/thu hồi consent** (USR-UC-6) kèm retention/anonymization do server áp.
> Vòng trước wireframe thu hai field này mà **không có consent affordance nào** — đó là lỗi, không phải
> đơn giản hoá.

#### Tab: Bảo mật — dependency placeholder

```
┌──────────────────────────────────────┐
│  🔒 Bảo mật                          │
│                                      │
│  Chưa khả dụng trong settings spec.  │
│  Cần Reviewed auth UI contract pin   │
│  exact credential/session/link DTO,  │
│  mutations, authz và error mapping.  │
│                                      │
│  Không render form/list/action.       │
└──────────────────────────────────────┘
```

#### Personal settings states

- **Current implementation:** Omit active profile/security controls; render neutral dependency placeholder. **Ready/Success dưới đây là design target, chưa authorize render** — không đọc hai dòng này như trạng thái baseline
- **Loading:** Skeleton form per tab
- **Ready (target):** Form pre-filled với data hiện tại. Save button disabled tới khi có thay đổi. `gender`/`dob` chỉ render khi consent bật; consent tắt ⇒ ẩn field, không prefill
- **Error:** Inline errors per field + toast cho server errors
- **Success:** Toast "Đã lưu thành công" (2s auto-dismiss)

#### Error mapping

| Status | Error code | Visible state | i18n `t(vi, en)` |
|---|---|---|---|
| — | `UNPINNED error catalog — omit active UI` | Person-self profile DTO/mutations còn Draft/UNPINNED và Bảo mật chỉ là dependency placeholder → omit active form; không render credential/session/link data hoặc mutations | — |
| 401 | `AUTH_REQUIRED` | Không render person-self surface; redirect về `/` theo exact server-authorized navigation | `t("Bạn cần đăng nhập để tiếp tục.", "Please sign in to continue.")` |
| — | *(unknown / missing / timeout)* | **Fail closed** — unavailable placeholder + retry; KHÔNG render form rỗng như thể đã load | `t("Không tải được. Thử lại.", "Couldn't load. Try again.")` |

> **Error mapping:** Pin server error/status → exact visible state. Unknown/missing response fail closed;
> không invent success, zero, empty hoặc disabled control. Nếu BE chưa pin catalog cho một endpoint,
> ghi `UNPINNED error catalog — omit active UI` thay vì bịa mã.

#### Responsive

| Breakpoint | `/me/settings` |
|---|---|
| 1440px | Không có sidebar ở route này — chỉ header "Cài đặt cá nhân" full width; horizontal personal tabs ([👤 Hồ sơ] · [🔒 Bảo mật]) above centered content `max-width: 640px` (§7); trong tab Hồ sơ, label trái + ô nhập phải |
| 768px | Horizontal personal tabs, scrollable nếu thiếu chỗ; content giãn hết chiều rộng khả dụng trong `max-width: 640px` |
| 375px | Compact segmented/dropdown personal tab selector (§5 #9); label lên trên, ô nhập full-width; nút "Lưu thay đổi" và "Xem/thu hồi consent PII" full-width ≥ 44px (§7 touch targets). Baseline omit set không đổi theo breakpoint — active profile form vẫn omit (profile DTO Draft/UNPINNED) và tab Bảo mật chỉ render dependency placeholder ở mọi kích thước, không có form/list/action. Consent gate cũng không đổi: `gender`/`dob` chỉ render khi consent bật, tắt ⇒ ẩn cả hai, không prefill |

---

## 4. Components Used

| Component | States | Mô tả |
|---|---|---|
| `TenantSettingsTabs` | vertical (desktop), horizontal (tablet), dropdown (mobile) | Chỉ `/dashboard/settings` |
| `PersonalSettingsTabs` | horizontal/compact | Chỉ `/me/settings`; Bảo mật hiện dependency placeholder |
| `SettingsForm` | pristine, dirty (save enabled), saving (spinner), saved (toast) | Form chung — detect changes |
| `BankAccountCard` | no-row, connecting, registered, active, drift, error, revoked + pending-change overlay | Canonical lifecycle riêng; `pending_change` là overlay, mutations gated by `bank_account.manage` |
| `ConnectorCard` | no-row, connecting, registered, active, drift, error, revoked | Card kênh render canonical lifecycle; authz denial/expiry là overlay riêng |
| `UsernameInput` | default, checking (debounce), available ✅, taken ❌ | Input username + live check |
| `GenderSelector` | dropdown: Nam, Nữ, Khác, Không tiết lộ | Dropdown giới tính |
| `CountdownBadge` | active (counting), expired | Countdown đổi bank (24h) |

---

## 5. Edge Cases (UX)

| # | Case | Hiển thị |
|---|---|---|
| 1 | Username đã tồn tại | Inline: "Username đã được sử dụng" (realtime check) |
| 2 | Đổi bank 2 lần/30 ngày | Disabled + tooltip: "Tối đa 2 lần đổi / 30 ngày" |
| 3 | Bank pending cancel | Chỉ hiện với `bank_account.manage`; "Hủy đổi" → confirm → TK cũ giữ nguyên |
| 4 | Disconnect Zalo bot | Chỉ hiện với `connector.secret_manage`; confirm: "Bot sẽ ngừng nhận tin nhắn. Tiếp tục?" |
| 4a | Capability thiếu/wrong tenant/expired/revoked | Không gửi mutation; action hidden/disabled + server authorization message |
| 5 | Form chưa save → navigate away | Confirm: "Có thay đổi chưa lưu. Rời trang?" |
| 6 | Giới tính "Không tiết lộ" | Save OK + note: "Kèo giá nam/nữ sẽ dùng giá mặc định cho bạn" |
| 7 | Personal security tab | Dependency placeholder only; không render password/session/linked-account mutation |
| 8 | Tenant billing suspended | Banner red trên settings: "Gói đã tạm ngưng" |
| 9 | Mobile: tabs nhiều | Dropdown selector thay vì tab bar |

---

## 6. Data hiển thị

| Field | Exact response path | Format | i18n `t(vi, en)` | Ghi chú |
|---|---|---|---|---|
| Club name | `UNPINNED tenant-settings DTO — omit active form` | Text | Label `t("Tên CLB", "Club name")`; giá trị là `data — no copy` | Max 100 chars |
| Bank number | `UNPINNED tenant-bank DTO — omit active form` | Masked "***1234" | Label `t("Số TK", "Account number")`; giá trị là `data — no copy` | Chỉ hiện 4 số cuối; không expose secret |
| Bank holder | `UNPINNED tenant-bank DTO — omit active form` | Uppercase text | Label `t("Chủ TK", "Account holder")`; giá trị là `data — no copy` | Provider-owned content |
| Provider | `UNPINNED connector DTO — omit active form` | "ApiPay" / "SePay" | Label `t("Provider", "Provider")` (đúng copy wireframe); tên provider là `data — no copy` | Exact server lifecycle only |
| Bank change countdown | `UNPINNED tenant-bank DTO — omit active form` | "Còn 18h" | `t("Đang chờ đổi (còn {h}h)", "Change pending ({h}h left)")` | Server-authoritative deadline |
| Username | `UNPINNED person-settings DTO — omit active form` | "@hostng" | Label `t("Username", "Username")` (đúng copy wireframe); handle là `data — no copy` | Personal route only |
| PII consent | `UNPINNED person-settings DTO — omit active form` | Toggle | `t("Đồng ý lưu giới tính & ngày sinh", "Allow storing gender & date of birth")` | **Gate cho 2 dòng dưới.** `feature_user_settings.md:29` + USR-UC-6 (xem/thu hồi) |
| Gender | `UNPINNED person-settings DTO — omit active form` | Dropdown text | `t("Nam", "Male")` · `t("Nữ", "Female")` · `t("Khác", "Other")` · `t("Không tiết lộ", "Prefer not to say")` | **PII có consent**, mã hoá at-rest, KHÔNG vào public whitelist. Chỉ render khi consent bật |
| Date of birth | `UNPINNED person-settings DTO — omit active form` | Date | Label `t("Ngày sinh", "Date of birth")`; giá trị là `data — no copy` | **PII có consent** — cùng gate với Gender. Vòng trước field này có trong wireframe nhưng không có row §6 |
| Session device | *(ngoài scope file này — xem ghi chú dưới)* | — | — | Negative scope: security credential/session/link mutations omitted |
| Session time | *(ngoài scope file này — xem ghi chú dưới)* | — | — | Negative scope: security credential/session/link mutations omitted |

> ⚠️ **Hai dòng session ở trên không thuộc spec này.** Header negative scope ghi "security
> credential/session/link mutations omitted" và tab Bảo mật chỉ là dependency placeholder ("Không render
> form/list/action"), nhưng §6 vòng trước vẫn liệt kê `Session device`/`Session time` như field sẽ hiện —
> mâu thuẫn. Giữ dòng để đánh dấu ranh giới; **exact DTO/response path thuộc một Reviewed auth UI
> contract chưa tồn tại**, và không doc nào trong Source authority của file này pin chúng.

> **i18n:** Mọi chuỗi user-facing ở file này đi qua `t(vi, en)` (`packages/core/src/i18n.ts`). Repo không có key-based i18n; cặp vi/en ở cột trên là chuỗi thật, không phải key.

---

## 7. Responsive & Interaction Notes

- **Tenant tabs:** `/dashboard/settings` dùng vertical → horizontal → dropdown theo bảng tenant
- **Personal tabs:** `/me/settings` luôn top-oriented; desktop/tablet horizontal, mobile compact segmented/dropdown
- **Forms:** `max-width: 640px`. All inputs full width within form
- **Username check:** Debounce 500ms. Show ✅/❌ inline after check
- **Bank change:** 24h countdown timer updates every minute. Warning color
- **Connector cards:** Group in section. Hover: border highlight. Actions: secondary buttons
- **Unsaved changes guard:** Browser `beforeunload` + custom confirm dialog
- **Dark mode:** Form bg `var(--bg-card)`, section headers `var(--text-muted)`
- **Touch targets:** All buttons ≥ 44px. Toggle switches standard iOS/Material size

---

## Analytics Events (Draft — đề xuất, chưa phải contract)

> Skeleton — chưa điền. Quy tắc khi điền: params cấm amount/tiền/PII; chỉ opaque id, enum, count, boolean. Nguồn template: Sporta FE porting analysis 2026-08-07.

| Event | Trigger | Params | Ghi chú |
|---|---|---|---|
| TBD (UNPINNED) | | | |

## State Machine (Draft)

> Skeleton — node lấy từ §States hiện có của file này: Personal settings states (§3 `/me/settings`): Current implementation (omit) · Loading · Ready (target) · Error · Success; `/dashboard/settings` không có block §States riêng — TBD (UNPINNED). Transition: TBD (UNPINNED) — chỉ được điền từ flow/edge case đã pin, không suy diễn.

## Acceptance Criteria (Draft)

> Skeleton — mỗi AC khi điền phải trace về một § có sẵn trong file. TBD.

## Testing Notes (Draft)

> Skeleton — unit/component/e2e hooks map theo AC. TBD.

---

_FE Design Spec v0.5 · 2026-08-07 · Sources: feature_user_settings.md v0.9a + feature_tenant_routing_authz.md v2.7 + feature_payment_reconcile.md v1.10 + feature_connector_onboarding.md v1.0_
_Changelog v0.5: Thêm skeleton 4 section Draft (Analytics/State Machine/AC/Testing) — nguồn: Sporta FE porting analysis 2026-08-07_
_FE Design Spec — 2026-09-08 (cấu trúc, không bump version): thêm khối 📍 Đọc nhanh dưới header — feature nguồn · phase-1 (DD-114) · launch (DD-113) · surface PWA trước, native iOS/Android phase-2 (DD-69) · FE PENDING (DD-116) · as-built @ `0aff7ad`. Pointer core docs BRD v3.10 · PRD v2.9 · TDD v3.2 · ROADMAP v3.17. Nội dung thiết kế không đổi._
