# Feature: Onboarding Wizard — FE Design Spec

> **Route(s):** `/onboarding`
> **Source authority:** `../../../features/feature_web_auth_onboarding.md` v2.11 + `../../../features/feature_connector_onboarding.md` v1.0 · baseline `0c5808fc7cf50d139bdd9c4ee79917bf4059c4f4`
> **Source authority (BE connector catalog + contract):** `../../../features/BE/feature_connector_onboarding_tech.md` §3 — *Error Codes* (`APIPAY_BANK_SELECTION_INVALID` · `APIPAY_KEY_INVALID` · `APIPAY_BANK_NOT_ACTIVE` · `APIPAY_ENTERPRISE_BANK_UNSUPPORTED` · `APIPAY_ENTERPRISE_PROVISION_FAILED` · `APIPAY_ENTERPRISE_UNAVAILABLE` · `PROVIDER_WEBHOOK_REGISTER_FAILED` · `SEPAY_OAUTH_DENIED` · `OAUTH_STATE_INVALID` · `BANK_ALREADY_BOUND` · `IDEMPOTENCY_KEY_REUSED` · `RATE_LIMITED`) và `POST /api/onboarding/apipay/provision` — nơi định nghĩa `bankSelectionRef` là reference **opaque, TTL ngắn, server-cấp**, không phải số TK thô/credential.
> **Source authority (BE auth catalog):** `../../../features/BE/feature_web_auth_onboarding_tech.md` §3 — `AUTH_INVALID` · `CSRF_INVALID` lấy nguyên văn từ bảng Error Codes ở đó.
> **Source contract status:** Auth onboarding Reviewed; connector auto-register Draft/externally gated
> **Projection/API contract:** Target readiness/connector DTO `UNPINNED`; live readiness endpoint is legacy/non-consumable
> **Capability/availability:** Server-owned readiness + connector lifecycle; Zalo manual-only until CO-OQ-1 closes
> **Priority:** 2 — designer-kickoff.md §3B
> **FE design status:** Draft
> **Runtime status:** Partial legacy only — live readiness endpoint còn dùng `tg_bind` và coi `first_session` optional, nên FE target không được consume; shared target predicate + connector wizard/UI chưa build
> **Negative scope:** Zalo manual configuration only tới khi CO-OQ-1 đóng; không hiện auto-verified state

---

## 1. Mô tả

Wizard giúp host mới thiết lập CLB khi server-authorized navigation đưa họ vào `/onboarding`. Gồm 4 bước chính: Tạo CLB → Kết nối ngân hàng → Kết nối Zalo (optional) → Kết nối Messenger Page (optional). Sau khi hoàn tất và tạo buổi đầu tiên, FE chỉ follow exact next destination do server trả; không hardcode Dashboard theo role/tenant count. Connector dùng lifecycle server-owned `connecting | registered | active | drift | error | revoked`; authorization denial/expired grant là overlay, không phải lifecycle mới.

---

## 2. User Flows

### Flow 1: Onboarding hoàn chỉnh (happy path)

1. Host chỉ vào `/onboarding` khi exact server-authorized navigation response trỏ tới route này; FE không suy từ "lần đầu", role hoặc tenant count
2. **Step 1 — Tạo CLB:** Nhập tên CLB, chọn timezone, môn thể thao chính, giá mặc định, chế độ hiển thị → Save
3. **Step 2 — Kết nối ngân hàng:** Chọn provider (ApiPay mặc định) → xác nhận TK nhận tiền → hệ thống tự provision webhook → `registered` → chờ server xác nhận `active`
4. **Step 3 — Kết nối Zalo (optional):** Dán token → lưu secret → copy webhook URL sang Zalo Bot Creator → chờ một inbound event được server xác nhận thì mới thành `active`; hoặc "Bỏ qua" → Step 4
5. **Step 4 — Messenger Page (optional):** Mặc định "Dùng Plexco central Page" → hoặc FB Login → chọn Page riêng → hoặc "Bỏ qua"
6. **Readiness checklist** hiện: ✅ CLB, ✅ Bank, ⬜ Zalo (bỏ qua), ✅ Messenger
7. Click "Tạo buổi chơi đầu tiên" → form tạo session → publish → follow exact server-authorized next destination; FE không giả định route đích

### Flow 2: Resume onboarding (host rời giữa chừng)

1. Host quay lại `/onboarding` → thấy stepper với trạng thái mỗi step
2. Steps đã hoàn tất hiện ✅ (click vào xem lại / sửa)
3. Step hiện tại hiện active → tiếp tục từ đây

### Flow 3: Bank connect thất bại → fallback

1. ApiPay enterprise không khả dụng → hiện nút "Dùng API key riêng" (BYO fallback)
2. Host nhập accessKey + secretKey → save → verify
3. Hoặc chọn SePay OAuth → redirect SePay → consent → callback → verify

---

## 3. Screens & States

### `/onboarding` — Wizard Container

#### Layout (Desktop 1440px)

```
┌──────────────────────────────────────────────────────────────┐
│  Header: Logo · "Thiết lập CLB"          [Thoát (về Landing)]│
├──────────────────────────────────────────────────────────────┤
│                                                              │
│   ┌──────────────────────────────────────────────────┐       │
│   │  Stepper (horizontal)                            │       │
│   │  ① CLB ─── ② Ngân hàng ─── ③ Zalo ─── ④ Page   │       │
│   │  ✅         ● (active)      ○            ○       │       │
│   └──────────────────────────────────────────────────┘       │
│                                                              │
│   ┌──────────────────────────────────────────────────┐       │
│   │                                                  │       │
│   │  Step Content (max-width: 640px, centered)       │       │
│   │                                                  │       │
│   │  {Content changes per step — see below}          │       │
│   │                                                  │       │
│   └──────────────────────────────────────────────────┘       │
│                                                              │
│   ┌──────────────────────────────────────────────────┐       │
│   │  Footer Actions:                                 │       │
│   │  [← Quay lại]                    [Tiếp tục →]   │       │
│   │  (hoặc [Bỏ qua] cho step optional)              │       │
│   └──────────────────────────────────────────────────┘       │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

#### Layout (Mobile 375px)

```
┌──────────────────────┐
│ Logo       [✕ Thoát] │
├──────────────────────┤
│  Stepper (compact)   │
│  Step 2/4 · Ngân hàng│
│  ████████░░░░ 50%    │
├──────────────────────┤
│                      │
│  Step Content        │
│  (full width,        │
│   padding 16px)      │
│                      │
│  {content}           │
│                      │
├──────────────────────┤
│ [← Quay lại]         │
│ [    Tiếp tục →    ] │
│ [    Bỏ qua        ] │
└──────────────────────┘
```

#### Error mapping

| Status | Error code | Visible state | i18n `t(vi, en)` |
|---|---|---|---|
| 401 | `AUTH_REQUIRED` | Không render wizard; redirect về `/` theo exact server-authorized navigation | `t("Bạn cần đăng nhập để tiếp tục.", "Please sign in to continue.")` |
| 401 | `AUTH_INVALID` | Không render wizard; toast generic + quay về `/` | `t("Xác thực không hợp lệ.", "Sign-in failed. Please try again.")` |
| 403 | `CSRF_INVALID` | Toast generic + tải lại wizard; không retry ngầm | `t("Yêu cầu không hợp lệ. Tải lại trang và thử lại.", "Invalid request. Reload the page and try again.")` |
| 429 | `RATE_LIMITED` | Footer CTA disabled + inline message; không auto-retry | `t("Thao tác quá nhanh — thử lại sau.", "Too many requests — try again shortly.")` |
| — | *(unknown / missing / timeout)* | **Fail closed** — unavailable placeholder + retry | `t("Không tải được. Thử lại.", "Couldn't load. Try again.")` |

> **Error mapping:** Pin server error/status → exact visible state. Unknown/missing response fail closed;
> không invent success, zero, empty hoặc disabled control. Nếu BE chưa pin catalog cho một endpoint,
> ghi `UNPINNED error catalog — omit active UI` thay vì bịa mã.

#### Responsive

| Breakpoint | Thay đổi |
|---|---|
| 1440px (Desktop) | Header đầy đủ (Logo · "Thiết lập CLB" · [Thoát]). Stepper horizontal 4 step có label ("① CLB — ② Ngân hàng — ③ Zalo — ④ Page"). Step content `max-width: 640px` centered. Footer actions inline trong content area |
| 768px (Tablet) | Giữ stepper horizontal, label rút gọn; step content giãn hết chiều rộng khả dụng trong padding; footer actions vẫn inline |
| 375px (Mobile) | Header rút còn Logo + [✕ Thoát]. Stepper → compact bar "Step N/4 · {tên step}" + progress %. Content full width, padding 16px. Footer actions sticky đáy màn hình, mỗi nút full-width ≥ 44px |

---

### Step 1: Tạo CLB

#### Content Layout

```
┌──────────────────────────────────────┐
│  🏟️ "Tạo CLB của bạn"              │
│                                      │
│  Tên CLB *        [_______________]  │
│  Múi giờ          [Asia/Ho_Chi_Mi▾]  │
│  Môn chính *      [⚽ Bóng đá     ▾] │
│  Giá mặc định     [___________] VNĐ │
│  Hiển thị mặc định [● Riêng tư    ] │
│                    [○ Công khai    ] │
│                                      │
│  Ghi chú: "Bạn có thể thay đổi sau │
│  trong Cài đặt CLB"                 │
└──────────────────────────────────────┘
```

#### States

- **Loading:** Skeleton form (5 skeleton inputs)
- **Ready:** Form pre-filled defaults (timezone auto-detect, VNĐ, private)
- **Error:** Inline errors per field ("Tên CLB không được để trống", "Giá phải ≥ 0")
- **Empty:** N/A (form luôn có defaults)

#### Error mapping

| Status | Error code | Visible state | i18n `t(vi, en)` |
|---|---|---|---|
| 400 | `INVALID_BODY` | Inline error trên field liên quan (tên / múi giờ / ngôn ngữ / giá); giữ nguyên input đã nhập | `t("Dữ liệu không hợp lệ. Kiểm tra lại các ô đã nhập.", "Invalid data. Check the fields above.")` |
| 401 | `AUTH_REQUIRED` | Không submit; quay về `/` theo exact server-authorized navigation | `t("Bạn cần đăng nhập để tiếp tục.", "Please sign in to continue.")` |
| 401 | `AUTH_INVALID` | Không submit; toast generic + quay về `/` | `t("Xác thực không hợp lệ.", "Sign-in failed. Please try again.")` |
| 403 | `CSRF_INVALID` | Toast generic + tải lại form; không tự submit lại | `t("Yêu cầu không hợp lệ. Tải lại trang và thử lại.", "Invalid request. Reload the page and try again.")` |
| 409 | `SLUG_TAKEN` | Inline error dưới ô "Tên CLB"; giữ form, không tạo tenant | `t("Tên này đã có CLB khác dùng. Chọn tên khác.", "That name is already taken. Pick another one.")` |
| 429 | `RATE_LIMITED` | Nút "Tiếp tục" disabled + inline message; không auto-retry | `t("Thao tác quá nhanh — thử lại sau.", "Too many requests — try again shortly.")` |
| — | *(unknown / missing / timeout)* | **Fail closed** — unavailable placeholder + retry; KHÔNG coi là đã tạo CLB | `t("Không tải được. Thử lại.", "Couldn't load. Try again.")` |

> **Error mapping:** Pin server error/status → exact visible state. Unknown/missing response fail closed;
> không invent success, zero, empty hoặc disabled control. Nếu BE chưa pin catalog cho một endpoint,
> ghi `UNPINNED error catalog — omit active UI` thay vì bịa mã.

#### Responsive

| Breakpoint | Thay đổi |
|---|---|
| 1440px (Desktop) | 5 field một cột trong khung 640px, label bên trái + ô nhập bên phải cùng dòng; hai lựa chọn hiển thị (Riêng tư / Công khai) xếp dọc; ghi chú "Bạn có thể thay đổi sau…" dưới cùng |
| 768px (Tablet) | Giữ cấu trúc label-trái/ô-phải; ô nhập giãn theo chiều rộng khung |
| 375px (Mobile) | Label lên trên, ô nhập xuống dưới (stack), ô full-width; dropdown múi giờ/môn dùng picker full-width; ghi chú giữ nguyên cuối form |

---

### Step 2: Kết nối ngân hàng

> **Visual fixture only:** "***1234 VCB", "NGUYEN VAN HOST" và mọi giá trị tài khoản trong wireframe dưới đây là
> fixture minh hoạ, **không phải API contract**. §6 đánh dấu bank/connector là `UNPINNED target bank/connector DTO — omit`
> và endpoint readiness live là legacy/non-consumable ⇒ baseline **không fetch và không render** bank name, masked STK
> hay tên chủ TK. Chỉ implement sau khi owner pin exact response DTO.

#### Content Layout

```
┌──────────────────────────────────────┐
│  💳 "Thiết lập tài khoản nhận tiền" │
│                                      │
│  "Tiền sẽ chuyển thẳng về tài khoản │
│   ngân hàng của bạn"                │
│                                      │
│  ┌──────────────────────────────┐    │
│  │ [Chọn tài khoản nhận tiền ▾]│    │
│  │ (danh sách TK từ provider)  │    │
│  │                              │    │
│  │ TK đã chọn: ***1234 VCB     │    │
│  │ Chủ TK: NGUYEN VAN HOST     │    │
│  │                              │    │
│  │ [  Xác nhận  ]              │    │
│  └──────────────────────────────┘    │
│                                      │
│  ── hoặc ──────────────────────────  │
│  [🔗 Dùng SePay OAuth]              │
│  [🔑 Dùng ApiPay key riêng (BYO)]   │
│                                      │
│  Status chips:                       │
│  ○ Chưa đăng ký                      │
│  🔄 Đang kết nối...                  │
│  ✅ Đã đăng ký — chờ kích hoạt      │
│  ✅ Đang hoạt động                   │
│  ❌ Lỗi kết nối — [Thử lại]         │
└──────────────────────────────────────┘
```

> ⚠️ **Contract:** Mặc định = ApiPay enterprise auto-provision. Host chỉ **chọn/xác nhận** TK từ danh sách provider trả (opaque `bankSelectionRef`), KHÔNG nhập raw STK/chủ TK. BYO key là CTA phụ, không default.

#### States

- **Loading:** Skeleton card
- **Ready (no row):** Form chọn bank + kết nối
- **Connecting:** Spinner + "Đang thiết lập..."
- **Registered (tier 1):** Chip "✅ Đã đăng ký" + text "Đang chờ kích hoạt..."
- **Active (tier 2):** Chip "✅ Đang hoạt động" — bank info masked (***1234)
- **Drift / revoked:** Warning hoặc blocked state do server trả; CTA sửa/kết nối lại chỉ hiện khi capability còn hợp lệ
- **Error:** Inline error + nút "Thử lại" — "Không thể kết nối. Kiểm tra thông tin và thử lại."
- **Empty:** N/A

#### Error mapping

| Status | Error code | Visible state | i18n `t(vi, en)` |
|---|---|---|---|
| 400 | `APIPAY_BANK_SELECTION_INVALID` | Inline error trên `BankSelector` + buộc chọn lại từ danh sách provider; không cho nhập raw STK | `t("Phiên chọn tài khoản không hợp lệ hoặc đã hết hạn. Chọn lại.", "That account selection is invalid or expired. Pick again.")` |
| 400 | `OAUTH_STATE_INVALID` | Quay lại card SePay ở trạng thái chưa kết nối + CTA "Thử lại" | `t("Phiên kết nối hết hạn. Thử lại.", "The connection session expired. Try again.")` |
| 401 | `APIPAY_KEY_INVALID` | Inline error trên form BYO (accessKey/secretKey); không đổi lifecycle | `t("accessKey/secretKey không đúng.", "That access key or secret key is incorrect.")` |
| 401 | `SEPAY_OAUTH_DENIED` | Card SePay về trạng thái chưa kết nối + CTA cấp quyền lại | `t("Bạn chưa cấp quyền cho Plexco.", "You haven't granted Plexco access.")` |
| 409 | `APIPAY_BANK_NOT_ACTIVE` | Giữ chip "✅ Đã đăng ký — chờ kích hoạt"; không hiện "Đang hoạt động" | `t("Tài khoản chưa kích hoạt, vui lòng đợi.", "This account isn't active yet — please wait.")` |
| 409 | `BANK_ALREADY_BOUND` | Inline error + không bind; CTA chọn tài khoản khác | `t("Tài khoản ngân hàng này đã gắn với CLB khác.", "This bank account is already linked to another club.")` |
| 409 | `IDEMPOTENCY_KEY_REUSED` | Không tạo thêm connector; giữ nguyên state hiện tại + CTA tải lại | `t("Yêu cầu này đã được dùng cho dữ liệu khác.", "This request was already used with different data.")` |
| 422 | `APIPAY_ENTERPRISE_BANK_UNSUPPORTED` | Ẩn đường auto-provision cho bank đó; hiện CTA phụ SePay / BYO | `t("Ngân hàng này chưa được hỗ trợ tự động.", "This bank isn't supported automatically yet.")` |
| 429 | `RATE_LIMITED` | CTA "Xác nhận"/"Thử lại" disabled + inline message; không auto-retry | `t("Thao tác quá nhanh — thử lại sau.", "Too many requests — try again shortly.")` |
| 502 | `APIPAY_ENTERPRISE_PROVISION_FAILED` | State `error` + nút "Thử lại" (retry cùng idempotency key) | `t("Chưa thể thiết lập ApiPay, vui lòng thử lại.", "We couldn't set up ApiPay. Please try again.")` |
| 502 | `PROVIDER_WEBHOOK_REGISTER_FAILED` | State `error` + nút "Thử lại"; không tự khẳng định đã `active` | `t("Đăng ký webhook thất bại.", "Webhook registration failed.")` |
| 503 | `APIPAY_ENTERPRISE_UNAVAILABLE` | Ẩn ApiPay default; hiện CTA phụ SePay / BYO | `t("Kết nối tự động tạm chưa sẵn sàng.", "Automatic setup is temporarily unavailable.")` |
| — | *(unknown / missing / timeout)* | **Fail closed** — unavailable placeholder + retry; KHÔNG suy `registered`/`active` | `t("Không tải được. Thử lại.", "Couldn't load. Try again.")` |

> **Error mapping:** Pin server error/status → exact visible state. Unknown/missing response fail closed;
> không invent success, zero, empty hoặc disabled control. Nếu BE chưa pin catalog cho một endpoint,
> ghi `UNPINNED error catalog — omit active UI` thay vì bịa mã.

#### Responsive

| Breakpoint | Thay đổi |
|---|---|
| 1440px (Desktop) | `ConnectorCard` chọn TK + nút [Xác nhận] trong khung 640px; hai CTA phụ (SePay OAuth · ApiPay BYO) nằm dưới divider "hoặc"; status chip hiển thị dưới card |
| 768px (Tablet) | Không đổi cấu trúc; card và CTA phụ giãn theo chiều rộng khung |
| 375px (Mobile) | Card full-width; hai CTA phụ full-width xếp dọc; dòng "TK đã chọn" / "Chủ TK" được phép wrap 2 dòng — masked label do provider trả không truncate |

---

### Step 3: Kết nối Zalo (optional)

> ⚠️ **CO-OQ-1: Zalo OA integration chưa đóng.** Step này chỉ cho phép manual secret registration. FE không gọi `getMe`, không tự set webhook và không suy `active`. Host phải cấu hình webhook thủ công; chỉ server mới được chuyển connector sang `active` sau khi nhận và xác minh inbound event.

#### Content Layout

```
┌──────────────────────────────────────┐
│  💬 "Kết nối bot Zalo" (optional)   │
│                                      │
│  "Cho phép thành viên đặt kèo qua   │
│   Zalo. Bạn có thể thêm sau."       │
│                                      │
│  Bot Token *  [____________________] │
│  (Paste thủ công từ Zalo Bot Creator)│
│                                      │
│  [  Lưu token  ]                     │
│                                      │
│  1. Copy webhook URL                 │
│  2. Dán vào Zalo Bot Creator         │
│  3. Gửi thử một tin nhắn             │
│                                      │
│  Status: ○ Chưa đăng ký              │
└──────────────────────────────────────┐┘
```

#### States

- **Loading:** Skeleton
- **Ready (no row):** Form nhập token + hướng dẫn cấu hình thủ công
- **Connecting:** Spinner "Đang lưu..."
- **Registered:** "✅ Đã lưu cấu hình — hoàn tất webhook thủ công"; chưa hiện badge connected/active
- **Active:** Chỉ hiện sau khi server báo đã xác minh inbound event
- **Drift / error / revoked:** Hiện reason tổng quát do server trả + CTA phù hợp capability; không khẳng định token sai từ client
- **Skipped:** Step hiện "Bỏ qua" trên stepper (stepper icon = ⏭)

#### Error mapping

| Status | Error code | Visible state | i18n `t(vi, en)` |
|---|---|---|---|
| 401 | `AUTH_REQUIRED` | Không lưu token; quay về `/` theo exact server-authorized navigation | `t("Bạn cần đăng nhập để tiếp tục.", "Please sign in to continue.")` |
| 403 | `CSRF_INVALID` | Toast generic + tải lại step; không tự submit lại secret | `t("Yêu cầu không hợp lệ. Tải lại trang và thử lại.", "Invalid request. Reload the page and try again.")` |
| 409 | `IDEMPOTENCY_KEY_REUSED` | Giữ nguyên state hiện tại + CTA tải lại; không tạo connector thứ hai | `t("Yêu cầu này đã được dùng cho dữ liệu khác.", "This request was already used with different data.")` |
| 429 | `RATE_LIMITED` | Nút "Lưu token" disabled + inline message; không auto-retry | `t("Thao tác quá nhanh — thử lại sau.", "Too many requests — try again shortly.")` |
| — | *(unknown / missing / timeout)* | **Fail closed** — unavailable placeholder + retry; giữ `registered`, KHÔNG suy `active` | `t("Không tải được. Thử lại.", "Couldn't load. Try again.")` |

> **Error mapping:** Pin server error/status → exact visible state. Unknown/missing response fail closed;
> không invent success, zero, empty hoặc disabled control. Nếu BE chưa pin catalog cho một endpoint,
> ghi `UNPINNED error catalog — omit active UI` thay vì bịa mã.
> **CO-OQ-1:** `ZALO_TOKEN_INVALID` trong BE tech doc còn 🟡 và gắn với `getMe` — nằm ngoài scope manual-only
> của step này, nên KHÔNG map vào UI; lỗi token chỉ hiện reason tổng quát do server trả.

#### Responsive

| Breakpoint | Thay đổi |
|---|---|
| 1440px (Desktop) | Ô Bot Token + nút [Lưu token] trong khung 640px; ba bước hướng dẫn thủ công (copy webhook URL → dán vào Zalo Bot Creator → gửi thử tin nhắn) hiển thị mở sẵn dưới form; status chip cuối card |
| 768px (Tablet) | Không đổi cấu trúc; ô token và khối hướng dẫn giãn theo khung |
| 375px (Mobile) | Ô token full-width, cho phép wrap; khối hướng dẫn thu về `InstructionAccordion` collapsed, tap để mở; nút [Lưu token] full-width ≥ 44px |

---

### Step 4: Messenger Page (optional)

#### Content Layout

```
┌──────────────────────────────────────┐
│  📱 "Kết nối Facebook Messenger"    │
│       (optional)                     │
│                                      │
│  [● Dùng Plexco central Page]        │
│     (mặc định — không cần setup)     │
│                                      │
│  [○ Dùng Page riêng của CLB]         │
│     → [Đăng nhập Facebook]           │
│     → Chọn Page: [My Club Page ▾]    │
│                                      │
│  Status: ○ Central Page (mặc định)   │
└──────────────────────────────────────┘
```

#### States

- **Loading:** Skeleton
- **Ready:** Radio chọn central (default) hoặc custom Page
- **FB Login flow:** Redirect → chọn Page → callback
- **Connected custom:** "✅ Page: {page_name}"
- **Error custom:** "Không thể kết nối Page" + retry + CTA "Dùng central Page thay"
- **Skipped / Central selected:** Step ✅ trên stepper

#### Error mapping

| Status | Error code | Visible state | i18n `t(vi, en)` |
|---|---|---|---|
| 400 | `OAUTH_STATE_INVALID` | Quay lại radio "Dùng Plexco central Page" + CTA "Thử lại" | `t("Phiên kết nối hết hạn. Thử lại.", "The connection session expired. Try again.")` |
| 409 | `CHAT_ALREADY_BOUND` | Inline error trên Page picker + CTA "Dùng central Page thay" | `t("Page này đã liên kết CLB khác.", "This Page is already linked to another club.")` |
| 409 | `IDEMPOTENCY_KEY_REUSED` | Giữ nguyên state hiện tại + CTA tải lại | `t("Yêu cầu này đã được dùng cho dữ liệu khác.", "This request was already used with different data.")` |
| 429 | `RATE_LIMITED` | CTA "Đăng nhập Facebook" disabled + inline message; không auto-retry | `t("Thao tác quá nhanh — thử lại sau.", "Too many requests — try again shortly.")` |
| 503 | `AUTH_PROVIDER_UNAVAILABLE` | Ẩn hoàn toàn nhánh "Page riêng" + FB Login; chỉ còn central Page | `t("Phương thức đăng nhập chưa khả dụng.", "This sign-in method is not available yet.")` |
| — | *(unknown / missing / timeout)* | **Fail closed** — unavailable placeholder + retry; KHÔNG suy Page đã kết nối | `t("Không tải được. Thử lại.", "Couldn't load. Try again.")` |

> **Error mapping:** Pin server error/status → exact visible state. Unknown/missing response fail closed;
> không invent success, zero, empty hoặc disabled control. Nếu BE chưa pin catalog cho một endpoint,
> ghi `UNPINNED error catalog — omit active UI` thay vì bịa mã.

#### Responsive

| Breakpoint | Thay đổi |
|---|---|
| 1440px (Desktop) | Hai radio (central Page mặc định / Page riêng) xếp dọc trong khung 640px; nhánh "Page riêng" hiện [Đăng nhập Facebook] + Page picker thụt vào dưới radio; status chip cuối card |
| 768px (Tablet) | Không đổi cấu trúc; radio và picker giãn theo khung |
| 375px (Mobile) | Radio, CTA [Đăng nhập Facebook] và Page picker đều full-width ≥ 44px; nhãn Page dài truncate + tooltip/tap để xem đủ. Khi `AUTH_PROVIDER_UNAVAILABLE`, nhánh "Page riêng" absent ở mọi breakpoint |

---

### Readiness Checklist (sau step cuối)

> **Visual fixture only:** "Badminton Saigon", "Ngân hàng Vietcombank ***1234" và bộ readiness chip
> `[✅ CLB] [✅ Bank] [❌ First Session]` dưới đây là fixture minh hoạ, **không phải API contract**. §6 đánh dấu
> readiness là `UNPINNED target readiness DTO — omit` và bank/connector là `UNPINNED target bank/connector DTO — omit`
> ⇒ baseline **không render checklist động**, không derive completion ở client, không render CTA "Tiếp tục".
> Wireframe này chỉ mô tả target sau khi shared predicate mới land và navigation owner trả exact authorized destination.

```
┌──────────────────────────────────────┐
│  🎉 "Sắp xong rồi!"                │
│                                      │
│  ✅ CLB "Badminton Saigon"           │
│  ✅ Ngân hàng Vietcombank ***1234    │
│  ⏭ Zalo (bỏ qua)                   │
│  ✅ Messenger (central Page)         │
│                                      │
│  ─────────────────────────────────   │
│  "Tạo buổi chơi đầu tiên để bắt    │
│   đầu nhận đặt kèo!"                │
│                                      │
│  [  🏸 Tạo buổi chơi đầu tiên  ]    │
│                                      │
│  Readiness:                          │
│  [✅ CLB] [✅ Bank] [❌ First Session] │
│  "Hoàn thành bước trên để tiếp tục" │
│  [Tiếp tục →]                         │
│  (omitted tới khi server trả exact   │
│   authorized next destination)        │
└──────────────────────────────────────┘
```

> ⚠️ **Completion gate:** CTA "Tiếp tục" chỉ xuất hiện khi (a) server chứng minh TẤT CẢ required steps passed — club configured + bank `active` + first session created — **và** (b) cùng response pin exact authorized next destination. Readiness một mình không authorize route; FE không tự derive hoặc hardcode destination.
> **Legacy runtime warning:** Endpoint live hiện chưa dùng predicate này (`tg_bind` còn required, `first_session` còn optional), nên không được nối vào target UI. Chỉ enable completion sau khi shared predicate mới land, contract test chứng minh parity và navigation owner trả exact authorized destination.

#### Error mapping

| Status | Error code | Visible state | i18n `t(vi, en)` |
|---|---|---|---|
| — | `UNPINNED error catalog — omit active UI` | Target readiness DTO chưa pin và endpoint live là legacy/non-consumable → không render checklist động, không render CTA "Tiếp tục" | — |
| — | *(unknown / missing / timeout)* | **Fail closed** — unavailable placeholder + retry; KHÔNG suy ready, KHÔNG hiện CTA "Tiếp tục" | `t("Không tải được. Thử lại.", "Couldn't load. Try again.")` |

> **Error mapping:** Pin server error/status → exact visible state. Unknown/missing response fail closed;
> không invent success, zero, empty hoặc disabled control. Nếu BE chưa pin catalog cho một endpoint,
> ghi `UNPINNED error catalog — omit active UI` thay vì bịa mã.

#### Responsive

| Breakpoint | Thay đổi |
|---|---|
| 1440px (Desktop) | Card "Sắp xong rồi!" trong khung 640px centered; checklist 1 cột; hàng readiness chip nằm trên một dòng; CTA "Tạo buổi chơi đầu tiên" full-width trong card |
| 768px (Tablet) | Không đổi cấu trúc; card giãn theo khung |
| 375px (Mobile) | Card full-width padding 16px; hàng readiness chip wrap xuống nhiều dòng thay vì scroll ngang; tên CLB / bank label dài truncate + tooltip. CTA "Tiếp tục" vẫn omit ở mọi breakpoint cho tới khi completion gate mở |

---

## 4. Components Used

| Component | States | Mô tả |
|---|---|---|
| `Stepper` | steps: completed ✅, active ●, upcoming ○, skipped ⏭ | Horizontal stepper (desktop) / compact progress bar (mobile) |
| `StepContent` | varies per step | Container cho nội dung từng bước |
| `ConnectorCard` | no-row, connecting, registered, active, drift, error, revoked | Card kết nối provider; render lifecycle server-owned, không tự derive |
| `StatusChip` | connecting, registered, active, drift, error, revoked | Chip trạng thái canonical; authorization denial/expired grant hiển thị overlay riêng |
| `ProviderSelector` | ApiPay selected (default), SePay, BYO | Radio/tabs chọn provider ngân hàng |
| `BankSelector` | loading list, no selection, selected, invalid/expired ref, disabled | Chọn **một tài khoản nhận tiền từ danh sách provider trả về** (mỗi option = label masked do provider cấp, ví dụ `***1234` + tên chủ TK). Submit đúng `bankSelectionRef` opaque server-cấp; **không** phải picker ngân hàng VN và **không** có input raw STK/chủ TK. Ref sai/hết hạn → `APIPAY_BANK_SELECTION_INVALID`, buộc chọn lại từ danh sách |
| `InstructionAccordion` | collapsed, expanded | Hướng dẫn step-by-step (Zalo Bot Creator, SePay) |
| `ReadinessChecklist` | per-item: done ✅, skipped ⏭, pending ○ | Danh sách trạng thái tổng hợp |
| `TextInput` | default, focus, error, disabled | Input field chung |
| `PrimaryButton` | default, hover, loading, disabled | CTA chính |
| `GhostButton` | default, hover | "Bỏ qua", "Quay lại" |

---

## 5. Edge Cases (UX)

| # | Case | Hiển thị |
|---|---|---|
| 1 | Host refresh giữa wizard | Resume đúng step (stepper hiện progress đã lưu) |
| 2 | Bank chưa active | Chip "✅ Đã đăng ký — chờ kích hoạt"; chỉ hiển thị instruction server trả, không tự yêu cầu giao dịch thử |
| 3 | ApiPay enterprise không khả dụng | Ẩn ApiPay default, hiện "Dùng SePay" hoặc "Dùng API key" |
| 4 | Zalo manual setup chưa thành công | Giữ trạng thái `registered`; hiện hướng dẫn kiểm tra webhook hoặc generic server error, không client-side validate token |
| 5 | FB Page đã thuộc CLB khác | Error: "Page này đã liên kết CLB khác" — CTA "Dùng central Page" |
| 6 | Host bỏ qua TẤT CẢ optional steps | Readiness yêu cầu 3 steps: CLB config + bank active + first session tạo. Bỏ Zalo/Messenger không ảnh hưởng. Bank + first session đều required. |
| 7 | Bank không xác minh được | Toast: "Tài khoản không thể xác minh" (opaque — không hiện chi tiết validation) |
| 8 | Network lỗi khi connecting | Toast: "Không có kết nối. Thử lại." + form giữ nguyên input |
| 9 | Stepper click step đã hoàn tất | Mở review/edit mode cho step đó (không reset steps sau) |

---

## 6. Data hiển thị

| Field | Exact response path | Format | i18n `t(vi, en)` | Ghi chú |
|---|---|---|---|---|
| Step titles | Static copy | Text | `t("Tạo CLB", "Create club")` · `t("Ngân hàng", "Bank")` · `t("Zalo", "Zalo")` · `t("Messenger", "Messenger")` | "Tạo CLB", "Ngân hàng", "Zalo", "Messenger" |
| Club name | Target request field `UNPINNED` | Text input | Label `t("Tên CLB", "Club name")`; giá trị là `data — no copy` | Không submit tới khi owner pin request DTO; max 100 chars |
| Timezone | Target request field `UNPINNED` | Dropdown | Label `t("Múi giờ", "Time zone")`; giá trị IANA zone là `data — no copy` | Default auto-detect chỉ là proposed form behavior |
| Sport | Target request field `UNPINNED` | Dropdown + icons | Label `t("Môn chính", "Main sport")`; options `t("Bóng đá", "Football")` · `t("Cầu lông", "Badminton")` · `t("Tennis", "Tennis")` · `t("Bóng chuyền", "Volleyball")` | ⚽🏸🎾🏐 + tên |
| Default price | Target request field `UNPINNED` | Number + "VNĐ" | Label `t("Giá mặc định", "Default price")`; số tiền là `data — no copy` | Không submit tới khi owner pin unit/currency semantics |
| Bank name | `UNPINNED target bank/connector DTO — omit` | Text (masked after save) | `data — no copy` | Không consume legacy readiness endpoint |
| Readiness items | `UNPINNED target readiness DTO — omit` | Checklist | `t("CLB", "Club")` · `t("Ngân hàng", "Bank")` · `t("Buổi chơi đầu tiên", "First session")` | Không derive completion client-side |

> **i18n:** Mọi chuỗi user-facing ở file này đi qua `t(vi, en)` (`packages/core/src/i18n.ts`). Repo không có key-based i18n; cặp vi/en ở cột trên là chuỗi thật, không phải key.

---

## 7. Responsive & Interaction Notes

- **Stepper:** Desktop = horizontal (icon + label per step). Mobile = compact bar (step N/4 + progress %)
- **Step content:** `max-width: 640px` centered. Mobile = full width + padding 16px
- **Step transitions:** Slide left/right animation khi chuyển step (200ms ease-out)
- **ConnectorCard:** Có animation pulse khi `connecting`; mọi transition tiếp theo bám đúng lifecycle server trả
- **Provider switcher:** Tab-style (ApiPay | SePay | BYO) — animated underline
- **Footer actions:** Fixed bottom trên mobile (sticky). Desktop = inline trong content area
- **"Bỏ qua" button:** Ghost/text style — nhỏ hơn CTA chính, vị trí dưới CTA hoặc bên trái
- **Dark mode:** Card backgrounds `var(--bg-card)`, status chips theo semantic colors
- **Auto-focus:** Mỗi step auto-focus vào input đầu tiên
- **Keyboard:** Tab qua inputs, Enter submit, Esc thoát modal (nếu có)

---

> **Boundary:** Bank `active` chỉ là onboarding readiness evidence. Nó không tự bật auto-reconcile; payment availability còn cần entitlement, provider/bank/market/currency, consent và runtime gates riêng.

---

## 8. Analytics Events (Draft — đề xuất, chưa phải contract)

> Đề xuất instrumentation phía FE, **chưa phải contract** — tên event/param chưa được owner chốt và
> KHÔNG thuộc BE error catalog. Params tuân thủ ràng buộc cứng: **không amount/tiền (giá mặc định là
> tiền — không bao giờ vào params), không PII (tên, sđt, email), không token/secret, không tên CLB,
> không bank label/STK, không page name** — chỉ opaque id, enum, count, boolean, duration.
> Event chỉ bắn khi flow tương ứng reachable: connector wizard/UI chưa build (header Runtime status)
> nên funnel dưới đây là target.

### Step funnel (§2 Flow 1 · Flow 2 · Flow 3)

| Event | Khi nào bắn | Params (đề xuất) |
|---|---|---|
| `onboarding_started` | Wizard render lần đầu sau exact server-authorized navigation (§2 Flow 1 bước 1) | — |
| `onboarding_step_viewed` | Step content hiển thị (§3) | `step` (enum: `club` \| `bank` \| `zalo` \| `messenger` \| `readiness`) · `is_resume` (boolean — §2 Flow 2) |
| `onboarding_step_completed` | Step chuyển sang completed ✅ trên stepper (§4 `Stepper`) | `step` (enum) · `duration_ms` (từ `onboarding_step_viewed` của step đó) |
| `onboarding_step_skipped` | User bấm "Bỏ qua" trên step optional (§2 Flow 1 bước 4–5) | `step` (enum: `zalo` \| `messenger`) |
| `onboarding_step_failed` | Một mã trong bảng Error mapping của step được render (§3) | `step` (enum) · `error_code` (enum — đúng nguyên văn mã BE catalog, không đặt mã mới) |
| `onboarding_bank_fallback_selected` | Chọn nhánh fallback ở Step 2 (§2 Flow 3) | `fallback` (enum: `sepay_oauth` \| `apipay_byo`) |
| `onboarding_exited` | Click [Thoát] trên header wizard (§3 Layout) | `step` (enum — step đang active) · `completed_steps_count` (count) |
| `onboarding_completed` | TBD (UNPINNED) — completion gate phụ thuộc target readiness DTO chưa pin (§3 Readiness); KHÔNG bắn ở baseline | — |

- **Drop-off:** đo bằng phân tích funnel — `step_viewed` không có `step_completed`/`step_skipped` tương ứng (kết hợp `onboarding_exited`); không cần event drop-off riêng.

---

## 9. State Machine (Draft)

> Chỉ dùng các state đã có trong file: step state của `Stepper` (§4) và connector lifecycle
> server-owned `connecting | registered | active | drift | error | revoked` (§1 · §4). FE chỉ render
> lifecycle server trả, không tự derive transition connector; mọi chuyển trạng thái connector là
> server-authoritative. Transition suy từ §2 Flows và §5 Edge Cases; thiếu căn cứ → TBD (UNPINNED).

### Step-level (`Stepper` — §4)

- `upcoming ○` → flow đưa tới step → `active ●` (§2 Flow 1)
- `active ●` → save/confirm step thành công → `completed ✅` (§2 Flow 1)
- `active ●` → "Bỏ qua" (chỉ step optional Zalo/Messenger) → `skipped ⏭` (§2 Flow 1 bước 4–5 · §3 Step 3 States)
- `completed ✅` → click trên stepper → mở review/edit mode cho step đó, không reset steps sau (§5 case 9)
- Refresh giữa wizard → resume đúng step đang `active`, steps đã xong giữ ✅ (§2 Flow 2 · §5 case 1)

### Connector lifecycle (server-owned — §1)

- (no row) → user xác nhận TK / lưu token → `connecting` (§3 Step 2/3 States)
- `connecting` → server provision/lưu OK → `registered` (§2 Flow 1 bước 3 · §3 Step 2 tier 1)
- `registered` → server xác nhận (bank kích hoạt / Zalo inbound event verified) → `active` (§3 Step 2 tier 2 · Step 3 States)
- `connecting` / `registered` → server trả lỗi → `error` + CTA "Thử lại" (§3 Step 2 States)
- `error` → retry (provision retry dùng cùng idempotency key — §3 Step 2 Error mapping 502) → `connecting`
- `active` → `drift` / `revoked`: chỉ do server trả; FE render warning/blocked + CTA theo capability (§3 Step 2 States)
- Authorization denial / expired grant → **overlay**, KHÔNG phải lifecycle state mới (§1 · §4 `StatusChip`)
- `drift` / `revoked` → recover: TBD (UNPINNED) — CTA sửa/kết nối lại chỉ hiện khi capability còn hợp lệ, flow recover chưa được pin (§3 Step 2 States)

### Completion (Readiness — §3)

- Mọi transition sang "onboarding hoàn tất" / next destination: TBD (UNPINNED) — chỉ mở khi server chứng minh required steps passed **và** cùng response pin exact authorized next destination (§3 Readiness completion gate); FE không tự derive.

---

## 10. Acceptance Criteria (Draft)

| # | Criterion | Trace |
|---|---|---|
| AC-1 | Wizard chỉ render sau exact server-authorized navigation; 401 → không render, quay về `/` | §2 Flow 1 bước 1 · §3 Error mapping wizard |
| AC-2 | Resume: refresh giữa wizard quay lại đúng step; steps đã hoàn tất giữ ✅ và click vào mở review/edit, không reset steps sau | §2 Flow 2 · §5 case 1, 9 |
| AC-3 | Step 2 chỉ submit `bankSelectionRef` opaque server-cấp; không tồn tại input raw STK/chủ TK ở bất kỳ state nào | §3 Step 2 contract note · §4 `BankSelector` |
| AC-4 | `APIPAY_ENTERPRISE_UNAVAILABLE` / `APIPAY_ENTERPRISE_BANK_UNSUPPORTED` → ẩn đường auto-provision, hiện CTA phụ SePay / BYO | §3 Step 2 Error mapping · §5 case 3 |
| AC-5 | Zalo manual-only: không gọi `getMe`, không tự set webhook, không tự suy `active`; `active` chỉ sau server xác minh inbound event | §3 Step 3 note CO-OQ-1 |
| AC-6 | Phân biệt đúng 2 tier: `registered` ("chờ kích hoạt") ≠ `active` ("đang hoạt động"); không nhảy tier ở client | §3 Step 2 States · §5 case 2 |
| AC-7 | Readiness checklist động + CTA "Tiếp tục" omit hoàn toàn ở baseline (target DTO `UNPINNED`, legacy endpoint non-consumable), ở mọi breakpoint | §3 Readiness · §6 |
| AC-8 | Bỏ qua Zalo/Messenger không chặn readiness; club config + bank `active` + first session vẫn required | §5 case 6 |
| AC-9 | `IDEMPOTENCY_KEY_REUSED` → không tạo connector thứ hai, giữ nguyên state hiện tại + CTA tải lại | §3 Step 2/3/4 Error mapping |
| AC-10 | Mọi mã trong các bảng Error mapping render đúng visible state + i18n copy đã pin; unknown/missing/timeout → fail closed, KHÔNG suy `registered`/`active`/ready | §3 (mọi bảng Error mapping) |
| AC-11 | Mobile: footer actions sticky đáy màn hình, mỗi nút full-width ≥ 44px | §3 Responsive wizard · §7 |
| AC-12 | Analytics events không chứa tên CLB, giá (tiền), bank label/STK, token/secret, page name hay PII; chỉ opaque id, enum, count, boolean, duration | §8 |

---

## 11. Testing Notes (Draft)

- **Unit — error mapping:** mỗi row trong các bảng Error mapping §3 (wizard container, Step 1–4, Readiness) có test: response (status + code) → đúng visible state + copy `t(vi,en)`; unknown/missing/timeout → fail-closed placeholder + retry, KHÔNG suy trạng thái thành công.
- **Unit — lifecycle render:** `StatusChip`/`ConnectorCard` chỉ nhận 6 state canonical `connecting | registered | active | drift | error | revoked` (§4); authorization denial/expired grant render overlay, không thêm state; giá trị lạ từ server → fail closed.
- **Unit — BankSelector:** không tồn tại đường nhập raw STK/chủ TK; payload submit chỉ chứa `bankSelectionRef` opaque; ref sai/hết hạn → `APIPAY_BANK_SELECTION_INVALID` → buộc chọn lại từ danh sách (§3 Step 2 · §4).
- **Unit — omit set:** readiness checklist động + CTA "Tiếp tục" absent trong DOM ở baseline (§3 Readiness); contract-test guard bảo đảm legacy readiness endpoint không bị FE target consume (Legacy runtime warning §3).
- **Unit — Zalo manual-only:** không có request `getMe`/set-webhook nào từ client; save token chỉ tới endpoint lưu secret; `active` chỉ render khi server trả (§3 Step 3 · CO-OQ-1).
- **Integration — resume:** refresh tại mỗi step → đúng step active + stepper đúng trạng thái (§5 case 1); click step completed → review mode, steps sau không reset (§5 case 9).
- **Integration — idempotency:** double-submit/retry → đúng 1 connector; `IDEMPOTENCY_KEY_REUSED` giữ state hiện tại (§3 Step 2/3/4 Error mapping).
- **Analytics guard:** snapshot test payload các event §8 — assert không có key club_name/price/bank/account/token/secret/page_name/email/phone.
- **E2E (target-gated):** connector wizard/UI chưa build (header Runtime status) → E2E đánh dấu skipped-by-gate; không giả lập provider, không coi legacy readiness endpoint là target (§3 Readiness).

---

_FE Design Spec v0.2 · 2026-07-31 · Source: feature_web_auth_onboarding.md v2.11 + feature_connector_onboarding.md v1.0_
_FE Design Spec v0.3 · 2026-08-07 · Changelog: Thêm 4 section Draft (Analytics/State Machine/AC/Testing) — nguồn: Sporta FE porting analysis 2026-08-07_
