# Feature: Auth & Landing — FE Design Spec

> **FE route(s):** `/` · `/auth/email/verify` · `/auth/email/reset`
> **API-owned callback(s):** Provider callback routes belong to the backend and are not FE pages
> **Source authority:** `../../../features/FE/feature_web_auth_onboarding.md` v2.11 · baseline `0c5808fc7cf50d139bdd9c4ee79917bf4059c4f4`
> **Source authority (password rule):** `../../../standards/decisions.md` DD-80 (owner-chốt 2026-07-19) — password **15–128 Unicode**, không composition rule. Quy tắc này **không** nằm trong feature doc v2.11 ở trên; đừng tìm ở đó.
> **Source (chưa Reviewed):** `../../../probes/b0-auth-credential-lifecycle-design-probe.md` §8 — blocklist common/compromised/context. Là **design probe**, không phải Reviewed contract ⇒ copy blocklist là design target, không phải hợp đồng đã chốt.
> **Source authority (BE error catalog):** `../../../features/BE/feature_web_auth_onboarding_tech.md` §3 → *Error Codes* (`AUTH_INVALID` · `AUTH_STALE` · `CSRF_INVALID` · `LOGIN_RATE_LIMITED` · `AUTH_TOKEN_INVALID` · `AUTH_PROVIDER_UNAVAILABLE`) + §5 acceptance matrix D1-8 (`AUTH_IDENTITY_CONFLICT`). Mã trong §3 của file này lấy nguyên văn từ đó; FE không tự đặt mã.
> **Source contract status:** Reviewed; provider enablement vẫn fail-closed
> **Projection/API contract:** Email verify/reset endpoints pinned in BE §3; provider-availability response shape `UNPINNED` — omit provider controls until owner DTO lands
> **Capability/availability:** Per-provider server availability; email OFF at baseline
> **Priority:** 1 — designer-kickoff.md §3B
> **FE design status:** Draft
> **Runtime status:** Partial — Google backend lane có route; landing/login UI và email order-4 chưa build, email capability OFF
> **Negative scope:** Không render provider chưa active; không coi target email lifecycle là runtime

---

## 1. Mô tả

Trang đầu tiên host và player thấy khi vào plexco.app. Gồm Landing page giới thiệu sản phẩm + Auth section để đăng nhập / đăng ký. Google OAuth, email/password và Facebook Login là ba provider độc lập: FE chỉ render provider khi server trả availability active; availability thiếu, unknown, expired hoặc revoked thì ẩn toàn bộ control của provider đó. Ở baseline này email capability đang OFF, nên form email dưới đây là target design, chưa phải runtime. Live Google completion hiện chỉ redirect về `/`; post-auth destination theo role chưa có DTO/owner contract nên FE không tự chọn `/onboarding`, `/dashboard` hay `/me`.

---

## 2. User Flows

### Flow 1: Đăng nhập Google (chính — 1 click)

1. User mở `/` → thấy landing hero + nút "Đăng nhập"
2. Click "Tiếp tục với Google" → redirect Google consent screen. **Bước này chỉ tồn tại khi server trả availability active cho Google**; ở baseline provider-availability DTO còn `UNPINNED` nên control bị omit và flow này chưa reachable (§6)
3. Google callback → auto login → server redirect về `/` theo live contract
4. Mọi post-auth destination khác phải chờ exact authorized navigation response; FE không suy từ role, tenant count hoặc token

### Flow 2: Đăng ký Email/Password

1. User click tab "Đăng ký" trên login card
2. Nhập: Email, Họ tên, Mật khẩu, Xác nhận mật khẩu
3. Submit → hiện thông báo "Kiểm tra email để xác thực"
4. User mở email → click verify link → browser mở `/auth/email/verify?token=xxx`
5. **Trang hiện nút "Xác nhận email"** (GET inert — không tự verify). Token được scrub khỏi URL
6. User click nút → **POST `/api/auth/email/verify`**
7. Success render ngay tại `/auth/email/verify` + CTA đăng nhập; không invent route success riêng

> ⚠️ **Safety:** Email scanner/prefetch mở link → trang hiện nhưng KHÔNG verify (GET inert). Chỉ explicit POST mới consume token.

### Flow 3: Đăng nhập Email/Password

1. Click tab "Đăng nhập" → nhập email + mật khẩu
2. Submit thành công → chỉ follow exact server destination khi contract đó được pin; baseline target quay về `/`
3. Sai, pending hoặc không tồn tại → cùng generic `AUTH_INVALID`: "Xác thực không hợp lệ"

### Flow 4: Quên mật khẩu

1. Click "Quên mật khẩu?" trên login form
2. Nhập email → submit → "Kiểm tra email" (hiện dù email tồn tại hay không)
3. Email → click link → `/auth/email/reset?token=xxx`; GET chỉ scrub token vào memory và render form, không validate/consume token
4. Nhập mật khẩu mới + xác nhận → submit đúng một lần tới `POST /api/auth/email/reset`
5. Server atomically validate + consume token, đổi mật khẩu và revoke các session bị ảnh hưởng → FE hiện "Đã đổi, đăng nhập lại"

### Flow 5: Đăng nhập Facebook (khi enabled)

1. Nút "Tiếp tục với Facebook" hiện BÊN DƯỚI Google
2. Click → Facebook consent → callback → login
3. Khi gate chưa active → nút này KHÔNG HIỆN (không hiện disabled/grayed)

---

## 3. Screens & States

### `/` — Landing + Login

> **Visual fixture only — baseline omit set:** Hai wireframe dưới đây vẽ *target* login card, không phải baseline render.
> Theo §6, baseline **omit hoàn toàn**: nút Google và nút Facebook (`UNPINNED provider availability — omit control`,
> chỉ render sau khi owner pin active availability DTO) **và** cả khối email — ô Email, ô Mật khẩu, "Quên mật khẩu?",
> CTA "Đăng nhập", CTA "Đăng ký" ("Không render ở baseline", email capability OFF). Control bị omit thì **biến mất**,
> không vẽ disabled/grayed. Baseline còn lại: nav, hero, features grid, footer. Mọi control gated trong wireframe đều
> mang annotation `(ẩn …)` — annotation là ranh giới, không phải trang trí.

#### Layout (Desktop 1440px)

```
┌──────────────────────────────────────────────────────────────┐
│  Nav:  Logo  ·  "Về Plexco"  ·  "Tính năng"  ·  [Đăng nhập]│
├────────────────────────────┬─────────────────────────────────┤
│                            │                                 │
│   Hero Section             │   Login Card (max-w: 440px)     │
│                            │                                 │
│   "Quản lý kèo thể thao   │   ┌─────────────────────────┐   │
│    thông minh"             │   │ [G] Tiếp tục với Google │   │
│                            │   │    (ẩn nếu gate off)    │   │
│                            │   ├─────────────────────────┤   │
│   "Tạo kèo, theo dõi      │   │ [F] Tiếp tục với FB     │   │
│    quản lý thành viên      │   │    (ẩn nếu gate off)    │   │
│    và thanh toán rõ ràng." │   ├────── hoặc ─────────────┤   │
│                            │   │     (ẩn ở baseline)     │   │
│   ⚽🏸🎾🏐               │   │ Email     [___________]  │   │
│                            │   │ Mật khẩu  [___________]  │   │
│                            │   │           [Quên MK?   ]  │   │
│                            │   │ [    Đăng nhập         ] │   │
│                            │   │ Chưa có TK? Đăng ký    │   │
│                            │   └─────────────────────────┘   │
│                            │                                 │
├────────────────────────────┴─────────────────────────────────┤
│  Features Section (cards grid — auto-fit)                    │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐     │
│  │ Tạo kèo  │  │ Theo dõi │  │ Quản lý  │  │ Đa kênh  │     │
│  │  nhanh   │  │thanh toán│  │ thành viên│  │Zalo+Web  │     │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘     │
├──────────────────────────────────────────────────────────────┤
│  Footer: © Plexco · Links                                    │
└──────────────────────────────────────────────────────────────┘
```

#### Layout (Mobile 375px)

```
┌──────────────────────┐
│ Logo     [Đăng nhập] │
├──────────────────────┤
│                      │
│  Hero Section        │
│  (stacked, centered) │
│                      │
│  "Quản lý kèo       │
│   thể thao           │
│   thông minh"        │
│                      │
├──────────────────────┤
│                      │
│  Login Card          │
│  (full-width,        │
│   max-w: 90vw)       │
│                      │
│  [G] Google          │
│  (ẩn nếu gate off)   │
│  ── hoặc ──          │
│  (ẩn ở baseline)     │
│  Email [________]    │
│  MK    [________]    │
│  [Quên MK?]          │
│  [ Đăng nhập ]       │
│  Chưa có TK? Đăng ký│
│                      │
├──────────────────────┤
│  Features (1 cột)    │
│  ┌──────────────────┐│
│  │ Tạo kèo nhanh   ││
│  └──────────────────┘│
│  ┌──────────────────┐│
│  │ Theo dõi thanh toán│
│  └──────────────────┘│
│  ...                 │
├──────────────────────┤
│  Footer              │
└──────────────────────┘
```

#### States

- **Loading:** Không cần skeleton — trang tĩnh, render server-side
- **Ready:** Hero + Login card + features. Mỗi provider chỉ hiện khi server trả availability active cho chính provider đó. Provider không active, thiếu hoặc unknown → ẩn hoàn toàn (không hiện disabled, không suy từ provider khác).
- **Error — auth fail:** Toast "Xác thực thất bại. Vui lòng thử lại." + login card vẫn sẵn
- **Error — form validation:** Inline error dưới mỗi input field (đỏ, text nhỏ)
  - "Email không hợp lệ"
  - "Mật khẩu cần 15–128 ký tự"
  - "Xác thực không hợp lệ"
  - Register luôn trả generic accepted; không hiện email đã tồn tại/pending
- **Empty:** N/A (landing luôn có content)

#### Error mapping

| Status | Error code | Visible state | i18n `t(vi, en)` |
|---|---|---|---|
| 401 | `AUTH_INVALID` | Inline generic dưới login card; Google lane trả cùng mã qua redirect `/?auth_error=AUTH_INVALID` → toast. Không phân biệt sai/pending/không tồn tại | `t("Xác thực không hợp lệ.", "Sign-in failed. Please try again.")` |
| 401 | `AUTH_STALE` | Toast + yêu cầu bắt đầu lại từ login card | `t("Phiên xác thực đã hết hạn. Đăng nhập lại nhé.", "Your sign-in session expired. Please sign in again.")` |
| 403 | `CSRF_INVALID` | Toast generic + reload form; không retry ngầm | `t("Yêu cầu không hợp lệ. Tải lại trang và thử lại.", "Invalid request. Reload the page and try again.")` |
| 429 | `LOGIN_RATE_LIMITED` | Toast + disable submit tạm thời | `t("Quá nhiều lần thử — đợi một phút rồi thử lại.", "Too many attempts — wait a minute and try again.")` |
| 503 · 302 `?auth_error=` | `AUTH_UNAVAILABLE` | Ẩn toàn bộ control Google (fail-closed enablement gate); redirect về `/` kèm toast | `t("Đăng nhập Google chưa khả dụng.", "Google sign-in is not available yet.")` |
| 503 | `AUTH_PROVIDER_UNAVAILABLE` | Ẩn hoàn toàn control của provider đó (Facebook) — không hiện disabled/grayed | `t("Phương thức đăng nhập chưa khả dụng.", "This sign-in method is not available yet.")` |
| 302 `?auth_error=` | `AUTH_IDENTITY_CONFLICT` | Toast generic trên `/`; không auto-merge, không CTA gộp tài khoản, không session | `t("Không thể đăng nhập bằng tài khoản này. Liên hệ hỗ trợ.", "We can't sign you in with this account. Please contact support.")` |
| — | *(unknown / missing / timeout)* | **Fail closed** — unavailable placeholder + retry | `t("Không tải được. Thử lại.", "Couldn't load. Try again.")` |

> **Error mapping:** Pin server error/status → exact visible state. Unknown/missing response fail closed;
> không invent success, zero, empty hoặc disabled control. Nếu BE chưa pin catalog cho một endpoint,
> ghi `UNPINNED error catalog — omit active UI` thay vì bịa mã.

#### Responsive

| Breakpoint | Thay đổi |
|---|---|
| 1440px (Desktop) | 2 cột: hero trái + login card phải `max-width: 440px`, card center theo trục dọc. Nav full (Logo · "Về Plexco" · "Tính năng" · [Đăng nhập]). Features grid `auto-fit, minmax(280px, 1fr)` → 4 cột |
| 768px (Tablet) | Giữ 2 cột nhưng thu hẹp cả hero lẫn card; features grid cùng công thức `auto-fit` rớt xuống 2 cột; nav giữ đủ item |
| 375px (Mobile) | Stack 1 cột: hero trên → login card dưới (`max-width: 90vw`, padding giảm). Nav rút còn Logo + [Đăng nhập]. Features 1 cột. Baseline omit set không đổi theo breakpoint — control gated vẫn absent ở mọi kích thước |

---

### `/auth/email/verify` — Xác thực email

> ⚠️ **GET inert:** Trang này không tự xác thực khi load. GET chỉ hiện landing với nút confirm. User phải bấm nút → POST verify.

#### Layout

```
┌──────────────────────────┐
│  Logo (centered)         │
├──────────────────────────┤
│                          │
│   ┌──────────────────┐   │
│   │  ✉️ icon (large)  │   │
│   │                  │   │
│   │  "Xác nhận      │   │
│   │   email của bạn" │   │
│   │                  │   │
│   │  [✅ Xác nhận]   │   │
│   └──────────────────┘   │
│                          │
└──────────────────────────┘
```

#### States

- **Landing (GET):** Icon ✉️ + "Xác nhận email của bạn" + nút [✅ Xác nhận]. Token được scrub từ URL vào memory. KHÔNG tự gọi API.
- **Verifying (POST):** Spinner trên nút + disabled. "Đang xác thực..."
- **Success:** Icon ✅ + "Email đã xác thực thành công" + nút "Đăng nhập"
- **Error (expired/invalid):** Icon ⚠️ + "Link đã hết hạn hoặc không hợp lệ". Chỉ hiện "Gửi lại" khi exact browser-bound verify-attempt cookie còn hợp lệ; nếu không, CTA quay về đăng ký
- **Empty:** N/A

#### Error mapping

| Status | Error code | Visible state | i18n `t(vi, en)` |
|---|---|---|---|
| 400 | `AUTH_TOKEN_INVALID` | Icon ⚠️ + error state generic; không phân biệt hết hạn / sai purpose / đã dùng | `t("Link đã hết hạn hoặc không hợp lệ.", "This link has expired or is invalid.")` |
| 403 | `CSRF_INVALID` | Toast generic + tải lại trang; KHÔNG tự POST lại (token là single-use) | `t("Yêu cầu không hợp lệ. Tải lại trang và thử lại.", "Invalid request. Reload the page and try again.")` |
| 429 | `LOGIN_RATE_LIMITED` | Nút "Xác nhận" disabled + inline message; không auto-retry | `t("Quá nhiều lần thử — đợi một phút rồi thử lại.", "Too many attempts — wait a minute and try again.")` |
| — | *(unknown / missing / timeout)* | **Fail closed** — unavailable placeholder + retry; KHÔNG hiện success | `t("Không tải được. Thử lại.", "Couldn't load. Try again.")` |

> **Error mapping:** Pin server error/status → exact visible state. Unknown/missing response fail closed;
> không invent success, zero, empty hoặc disabled control. Nếu BE chưa pin catalog cho một endpoint,
> ghi `UNPINNED error catalog — omit active UI` thay vì bịa mã.

#### Responsive

| Breakpoint | Thay đổi |
|---|---|
| 1440px (Desktop) | Một card đơn centered ngang + dọc, logo trên đầu; icon ✉️ lớn + nút [✅ Xác nhận] inline trong card |
| 768px (Tablet) | Không đổi cấu trúc — vẫn một card centered, chỉ giảm padding ngoài |
| 375px (Mobile) | Card full-width trong padding an toàn; nút "Xác nhận" full-width, chiều cao ≥ 44px (§7 touch target). Không đổi hành vi GET inert ở bất kỳ breakpoint nào |

---

### `/auth/email/reset` — Đổi mật khẩu

> ⚠️ **GET inert:** GET scrub token vào memory rồi render form đổi mật khẩu. Không có bước POST validate riêng. Chỉ submit cuối cùng mới gọi `POST /api/auth/email/reset`; server atomically validate + consume token, đổi mật khẩu và revoke session liên quan.

#### Layout

```
┌──────────────────────────┐
│  Logo (centered)         │
├──────────────────────────┤
│                          │
│   ┌──────────────────┐   │
│   │  🔒 icon         │   │
│   │                  │   │
│   │  "Đặt mật khẩu  │   │
│   │   mới"           │   │
│   │                  │   │
│   │  MK mới [_____]  │   │
│   │  Xác nhận [____] │   │
│   │  (15–128 ký tự)  │   │
│   │                  │   │
│   │  [Đổi mật khẩu]  │   │
│   └──────────────────┘   │
│                          │
└──────────────────────────┘
```

#### States

- **Ready (GET):** Token scrub từ URL vào memory; render form đổi MK (2 fields, 15–128 Unicode). Không gọi API và không xác nhận trước token.
- **Submitting (single POST):** Nút disabled + spinner "Đang đổi mật khẩu..."; không có pre-validation request.
- **Success:** "Đã đổi mật khẩu! Đăng nhập lại." + nút "Đăng nhập"
- **Error (POST trả token invalid/expired/already used):** "Link đã hết hạn hoặc không hợp lệ" + nút "Gửi lại link"
- **Empty:** N/A

#### Error mapping

| Status | Error code | Visible state | i18n `t(vi, en)` |
|---|---|---|---|
| 400 | `AUTH_TOKEN_INVALID` | Error state generic + nút "Gửi lại link"; không phân biệt hết hạn / sai purpose / đã dùng | `t("Link đã hết hạn hoặc không hợp lệ.", "This link has expired or is invalid.")` |
| 403 | `CSRF_INVALID` | Toast generic + tải lại trang; KHÔNG tự POST lại (consume là single-use) | `t("Yêu cầu không hợp lệ. Tải lại trang và thử lại.", "Invalid request. Reload the page and try again.")` |
| 429 | `LOGIN_RATE_LIMITED` | Nút "Đổi mật khẩu" disabled + inline message; không auto-retry | `t("Quá nhiều lần thử — đợi một phút rồi thử lại.", "Too many attempts — wait a minute and try again.")` |
| — | *(unknown / missing / timeout)* | **Fail closed** — unavailable placeholder + retry; KHÔNG khẳng định mật khẩu đã đổi | `t("Không tải được. Thử lại.", "Couldn't load. Try again.")` |

> **Error mapping:** Pin server error/status → exact visible state. Unknown/missing response fail closed;
> không invent success, zero, empty hoặc disabled control. Nếu BE chưa pin catalog cho một endpoint,
> ghi `UNPINNED error catalog — omit active UI` thay vì bịa mã.

#### Responsive

| Breakpoint | Thay đổi |
|---|---|
| 1440px (Desktop) | Một card đơn centered ngang + dọc; hai ô mật khẩu xếp dọc + helper "(15–128 ký tự)" ngay dưới ô thứ hai |
| 768px (Tablet) | Không đổi cấu trúc — card centered, giảm padding ngoài |
| 375px (Mobile) | Card full-width trong padding an toàn; hai ô mật khẩu full-width; nút "Đổi mật khẩu" full-width ≥ 44px (§7 touch target). Single-POST discipline không đổi theo breakpoint |

---

### Client-local states (Draft)

> Các state dưới đây là **client-local, không phải BE token** — không thuộc error catalog của
> `feature_web_auth_onboarding_tech.md` §3 và không được thêm vào bất kỳ bảng Error mapping nào ở trên.
> FE tự quản lý hoàn toàn ở phía client; không gửi lên server như error code.

| State | Điều kiện vào (client-side) | Hành vi hiển thị |
|---|---|---|
| `AUTH_CANCELLED` (client-local, không phải BE token) | User hủy giữa OAuth consent: bấm Back từ consent screen hoặc đóng popup/tab rồi quay về `/` **không kèm** query `auth_error` và không có callback hoàn tất (§2 Flow 1 · Flow 5) | Quay về entry point (`/`) **im lặng**: landing + login card ở state Ready (§3 `/` States), **KHÔNG** hiện error banner/toast, không log như auth failure |

- **Phân biệt với `AUTH_INVALID`:** bảng Error mapping §3 chỉ áp khi server **thực sự trả** mã (401 hoặc redirect `/?auth_error=AUTH_INVALID`). Quay về `/` sạch (không có `auth_error`) → `AUTH_CANCELLED`, không rơi nhầm vào `AUTH_INVALID` và không hiện "Xác thực không hợp lệ" sai ngữ cảnh.
- Nếu provider denial khiến BE redirect **kèm** `?auth_error=AUTH_INVALID` → vẫn theo đúng bảng Error mapping §3 (pinned, không đổi). BE có tách user-denied-consent thành tín hiệu riêng hay không → TBD (UNPINNED); FE không tự đặt mã mới.

---

## 4. Components Used

| Component | States | Mô tả |
|---|---|---|
| `LoginCard` | login tab, register tab, forgot-password mode | Card auth chính — chứa social buttons + form |
| `SocialButton` | default, hover, loading (spinner), disabled | Nút OAuth (Google / Facebook) — icon bên trái + text |
| `TextInput` | default, focus, error, disabled | Input field — label floating hoặc trên |
| `PasswordInput` | default, focus, error + toggle show/hide | TextInput + eye icon |
| `PrimaryButton` | default, hover, active, loading (spinner), disabled | CTA chính — full width trong card |
| `InlineError` | visible, hidden | Text lỗi đỏ nhỏ dưới input |
| `Toast` | success (green), error (red), warning (orange) | Top-right notification tạm thời |
| `FeatureCard` | default, hover | Card giới thiệu tính năng trên landing — icon + title + desc |
| `HeroSection` | static | Hero với typography lớn + sport icons |
| `Divider` | with text "hoặc" | Phân cách social vs email login |

---

## 5. Edge Cases (UX)

| # | Case | Hiển thị |
|---|---|---|
| 1 | Google full-page redirect/callback fail | Callback/completion trả generic auth error rồi quay về `/`; chỉ thêm CTA email nếu server đồng thời trả email availability active |
| 2 | Email mới/đã tồn tại/pending (register) | Cùng generic accepted: "Nếu có bước tiếp theo, hãy kiểm tra email"; không lộ lifecycle |
| 3 | Login sai, pending hoặc không tồn tại | Cùng generic `AUTH_INVALID`: "Xác thực không hợp lệ"; không hiện resend từ login |
| 4 | Mật khẩu không đạt độ dài | Inline error `t("Mật khẩu cần 15–128 ký tự", "Password must be 15–128 characters")` — KHÔNG composition rules (DD-80) |
| 4b | Mật khẩu bị blocklist từ chối | Server quyết định, FE chỉ render message trả về. Copy target: `t("Mật khẩu này quá phổ biến hoặc không an toàn, chọn mật khẩu khác", "This password is too common or unsafe — choose another")`. **Nguồn là design probe §8 (common/compromised/context blocklist), chưa Reviewed** ⇒ chưa authorize state này ở baseline. FE **không** tự kiểm tra và **không** gửi raw password tới third party |
| 5 | Quên MK — email không tồn tại | CÙNG thông báo "Kiểm tra email" (không lộ email tồn tại) |
| 6 | Link verify/reset hết hạn | Page error generic. Verify resend chỉ từ browser-bound attempt hợp lệ; reset CTA quay về forgot flow |
| 7 | Facebook gate OFF | Nút Facebook KHÔNG HIỆN (không disabled/grayed) |
| 8 | Offline / network error | Toast: "Không có kết nối. Kiểm tra mạng và thử lại." |
| 9 | Login card trên mobile nhỏ | Login card max-width: 90vw, padding giảm |
| 10 | Double-click submit | Button disabled + spinner sau click đầu |

---

## 6. Data hiển thị

| Field | Exact response path | Format | i18n `t(vi, en)` | Ghi chú |
|---|---|---|---|---|
| Hero title | Static copy | Text | `t("Quản lý kèo thể thao thông minh", "Smart sports game management")` | "Quản lý kèo thể thao thông minh" |
| Hero subtitle | Static copy | Text | `t("Tạo kèo, theo dõi thanh toán, quản lý thành viên — rõ ràng trong một nơi.", "Create games, track payments, manage members — all in one place.")` | "Tạo kèo, theo dõi thanh toán, quản lý thành viên — rõ ràng trong một nơi." |
| Google button | `UNPINNED provider availability — omit control` | Text | `t("Tiếp tục với Google", "Continue with Google")` | Chỉ render sau khi owner pin active availability DTO |
| Facebook button | `UNPINNED provider availability — omit control` | Text | `t("Tiếp tục với Facebook", "Continue with Facebook")` | Chỉ render sau khi owner pin active availability DTO |
| Email label | Static target copy; email capability OFF | Text | `t("Email", "Email")` | Không render ở baseline |
| Password label | Static target copy; email capability OFF | Text | `t("Mật khẩu", "Password")` | Không render ở baseline |
| Login CTA | Static target copy; email capability OFF | Text | `t("Đăng nhập", "Sign in")` | Không render ở baseline |
| Register CTA | Static target copy; email capability OFF | Text | `t("Đăng ký", "Sign up")` | Không render ở baseline |
| Forgot password | Static target copy; email capability OFF | Link text | `t("Quên mật khẩu?", "Forgot password?")` | Không render ở baseline |
| Feature cards | Static copy | Array | `t("Tạo kèo nhanh", "Create games fast")` · `t("Theo dõi thanh toán", "Track payments")` · `t("Quản lý thành viên", "Manage members")` · `t("Đa kênh Zalo + Web", "Zalo + web in one place")` | 4 cards: tạo kèo, theo dõi thanh toán, quản lý TV, đa kênh; không hứa auto-reconcile |

> **i18n:** Mọi chuỗi user-facing ở file này đi qua `t(vi, en)` (`packages/core/src/i18n.ts`). Repo không có key-based i18n; cặp vi/en ở cột trên là chuỗi thật, không phải key.

---

## 7. Responsive & Interaction Notes

- **Layout split:** Desktop = 2 cột (hero trái + login card phải). Tablet = 2 cột nhỏ hơn. Mobile = stack (hero trên, login card dưới)
- **Login card:** `max-width: 440px` desktop, `max-width: 90vw` mobile. Center vertically trên desktop
- **Social buttons:** Full width trong card. Google nút có brand icon + text. Hover: slight lift shadow
- **Form inputs:** Label floating transition on focus. Error state: red border + inline error text dưới
- **Submit button:** Loading state = spinner thay text + disabled. Transition: `opacity 0.2s`
- **Tab switch (Đăng nhập ↔ Đăng ký):** Animated underline indicator slide. Form fields transition height
- **Features section:** Grid `auto-fit, minmax(280px, 1fr)`. Cards: subtle hover lift + shadow increase
- **Dark mode:** Hero background dùng `var(--bg-primary)`, card dùng `var(--bg-card)`, text dùng `var(--text-primary)`
- **Touch targets:** Tất cả buttons ≥ 44px height. Links có padding đủ 44×44 touch area
- **Focus ring:** Visible focus ring cho keyboard nav (outline: 2px solid `var(--primary)`)

---

## 8. Analytics Events (Draft — đề xuất, chưa phải contract)

> Đề xuất instrumentation phía FE, **chưa phải contract** — tên event/param chưa được owner chốt và
> KHÔNG thuộc BE error catalog. Params tuân thủ ràng buộc cứng: **không amount/tiền, không PII
> (tên, sđt, email), không mật khẩu/token** — chỉ opaque id, enum, count, boolean, duration.
> Event chỉ bắn khi flow tương ứng reachable: baseline Google flow chưa reachable (provider DTO
> `UNPINNED` — §2 Flow 1) và email capability OFF (§6), nên funnel dưới đây phần lớn là target.

### Funnel login (§2 Flow 1 · Flow 3 · Flow 5)

| Event | Khi nào bắn | Params (đề xuất) |
|---|---|---|
| `auth_login_started` | Login card hiển thị ở state Ready (§3 `/` States) | `providers_rendered_count` (count — số provider đang active-render theo §6) |
| `auth_method_selected` | User click một provider control đang render: Google (§2 Flow 1) · Facebook (§2 Flow 5) · tab email (§2 Flow 3) | `method` (enum: `google` \| `facebook` \| `email`) |
| `auth_submitted` | OAuth redirect bắt đầu, hoặc email form submit (§2 Flow 3) | `method` (enum) |
| `auth_succeeded` | Completion quay về `/` theo live contract (§2 Flow 1 bước 3) | `method` (enum) · `duration_ms` (duration từ `auth_submitted`) |
| `auth_failed` | Một mã trong bảng Error mapping §3 được render | `method` (enum) · `error_code` (enum — đúng nguyên văn mã BE catalog §3, không đặt mã mới) |
| `auth_cancelled` | Vào state `AUTH_CANCELLED` (§3 Client-local states — client-local, không phải BE token) | `method` (enum: `google` \| `facebook`) |

### Funnel phụ: register / verify / reset (§2 Flow 2 · Flow 4)

| Event | Khi nào bắn | Params (đề xuất) |
|---|---|---|
| `auth_register_submitted` | Submit form Đăng ký (§2 Flow 2 bước 3) | — (không gửi email/họ tên — PII) |
| `auth_verify_viewed` | GET `/auth/email/verify` render landing (§3) | — (không gửi token) |
| `auth_verify_confirmed` | POST verify success (§2 Flow 2 bước 6–7) | `duration_ms` (từ `auth_verify_viewed`) |
| `auth_reset_started` | GET `/auth/email/reset` render form (§2 Flow 4 bước 3) | — |
| `auth_reset_completed` | POST reset success (§2 Flow 4 bước 5) | — |

---

## 9. State Machine (Draft)

> Chỉ dùng các state đã liệt kê trong §3 (kèm client-local state ở §3 → Client-local states).
> Transition suy từ §2 Flows và §5 Edge Cases; điểm chưa có căn cứ ghi TBD (UNPINNED).
> Lưu ý: §3 `/` không liệt kê screen-level state "Submitting" — trạng thái đang submit được mô tả
> bằng component loading state (`PrimaryButton`/`SocialButton` loading — §4, §5 case 10, §7),
> không phát minh screen state mới.

### `/` — Landing + Login (§3)

- `Ready` → user submit/click provider (§2 Flow 1/3/5) → component loading state: button spinner + disabled (§4 · §5 case 10 · §7)
- (loading) → success → follow exact server destination; baseline quay về `/` (§2 Flow 1 bước 3 · Flow 3 bước 2) — post-auth destination khác `/` là TBD (UNPINNED) (§1)
- (loading) → BE trả mã trong bảng Error mapping §3 → `Error — auth fail` hoặc `Error — form validation` theo đúng visible state đã pin
- `Error — auth fail` / `Error — form validation` → user sửa input hoặc retry → `Ready` (login card vẫn sẵn — §3 States)
- OAuth redirect → user hủy consent → `AUTH_CANCELLED` (client-local, không phải BE token) → `Ready` im lặng (§3 Client-local states)
- `LOGIN_RATE_LIMITED` → submit disabled tạm thời (§3 Error mapping) → thời điểm re-enable: TBD (UNPINNED) — retry-after chưa được pin trong file này

### `/auth/email/verify` (§3)

- `Landing (GET)` → click [✅ Xác nhận] → `Verifying (POST)` (§3 States)
- `Verifying (POST)` → 2xx → `Success` → CTA "Đăng nhập" → `/` (§3 States)
- `Verifying (POST)` → `AUTH_TOKEN_INVALID` / `CSRF_INVALID` / `LOGIN_RATE_LIMITED` / unknown → `Error` theo đúng bảng Error mapping §3 (unknown → fail closed)
- `Error` → "Gửi lại" chỉ khi exact browser-bound verify-attempt cookie còn hợp lệ; ngược lại CTA quay về đăng ký (§3 States · §5 case 6)

### `/auth/email/reset` (§3)

- `Ready (GET)` → submit → `Submitting (single POST)` (§3 States — không có pre-validation request)
- `Submitting (single POST)` → 2xx → `Success` ("Đã đổi mật khẩu! Đăng nhập lại.") (§3 States)
- `Submitting (single POST)` → token invalid/expired/đã dùng → `Error` + nút "Gửi lại link" (§3 States)
- `Error` / `Success` → không có transition quay lại `Submitting` với cùng token (token single-use — §3 GET inert note)

---

## 10. Acceptance Criteria (Draft)

| # | Criterion | Trace |
|---|---|---|
| AC-1 | Baseline omit set đúng: không render Google/Facebook/email control khi availability `UNPINNED`/OFF; control absent hoàn toàn, không disabled/grayed, ở mọi breakpoint | §3 `/` fixture note · §3 Responsive · §6 |
| AC-2 | GET `/auth/email/verify` không consume token; chỉ explicit POST sau click [✅ Xác nhận] mới verify | §2 Flow 2 bước 5–6 · §3 verify |
| AC-3 | Token được scrub khỏi URL vào memory trên cả verify và reset | §2 Flow 2 bước 5 · Flow 4 bước 3 |
| AC-4 | Reset là đúng một POST tới `/api/auth/email/reset`, không pre-validation request | §2 Flow 4 bước 4 · §3 reset |
| AC-5 | Login sai/pending/không tồn tại đều là generic `AUTH_INVALID`; register/forgot không lộ email lifecycle | §2 Flow 3–4 · §5 case 2, 3, 5 |
| AC-6 | Mọi mã trong 3 bảng Error mapping render đúng visible state + i18n copy đã pin; unknown/missing/timeout → fail closed | §3 Error mapping (cả 3 màn) |
| AC-7 | Password chỉ validate độ dài 15–128 Unicode, không composition rule; blocklist là server-side, FE không tự kiểm và không gửi raw password tới third party | §5 case 4, 4b · header DD-80 |
| AC-8 | User hủy OAuth consent → quay về `/` im lặng (state `AUTH_CANCELLED`, client-local), không error banner; chỉ khi URL có `auth_error` mới hiện toast | §3 Client-local states |
| AC-9 | Double-submit bị chặn: button disabled + spinner ngay sau click đầu | §5 case 10 · §7 |
| AC-10 | Touch target ≥ 44px và focus ring visible cho mọi control auth | §7 |
| AC-11 | Mọi chuỗi user-facing đi qua `t(vi, en)` — chuỗi thật, không phải key | §6 i18n note |
| AC-12 | Analytics events không chứa amount/tiền/PII/mật khẩu/token; chỉ opaque id, enum, count, boolean, duration | §8 |

---

## 11. Testing Notes (Draft)

- **Unit — error mapping:** mỗi row trong 3 bảng Error mapping §3 có test: response (status + code) → đúng visible state + copy `t(vi,en)`; case unknown/missing/timeout → fail-closed placeholder + retry, KHÔNG render success.
- **Unit — GET inert:** load `/auth/email/verify` và `/auth/email/reset` với token trong URL → assert không có request verify/consume nào được gửi (§2 Flow 2 · Flow 4); token biến mất khỏi URL/history sau scrub (§3).
- **Unit — omit set:** availability thiếu/unknown/expired/revoked → provider control absent trong DOM (không phải hidden/disabled) ở mọi breakpoint (§3 States Ready · §5 case 7).
- **Unit — client-local cancel:** vào `/` không kèm `auth_error` (sau khi rời trang sang consent) → không toast, login card Ready (§3 Client-local states); vào `/?auth_error=AUTH_INVALID` → toast đúng copy pinned (§3 Error mapping).
- **Unit — enumeration safety:** register và forgot-password luôn render cùng generic copy cho mọi nhánh response đã pin (§5 case 2, 5).
- **Integration:** double-click submit chỉ tạo đúng 1 request (§5 case 10); `LOGIN_RATE_LIMITED` → submit disabled, không auto-retry (§3).
- **Analytics guard:** snapshot test payload các event §8 — assert không có key email/name/phone/password/token/amount.
- **E2E (target-gated):** funnel email và Google end-to-end chỉ chạy khi capability bật; baseline email OFF + provider DTO `UNPINNED` → E2E đánh dấu skipped-by-gate, không giả lập enablement (header Runtime status · §6).

---

_FE Design Spec v0.2 · 2026-07-31 · Source: feature_web_auth_onboarding.md v2.11_
_FE Design Spec v0.3 · 2026-08-07 · Changelog: Thêm 4 section Draft (Analytics/State Machine/AC/Testing) + subsection "Client-local states (Draft)" với `AUTH_CANCELLED` (client-local) — nguồn: Sporta FE porting analysis 2026-08-07_
