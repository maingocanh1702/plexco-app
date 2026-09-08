# Feature: Members & Merge — FE Design Spec

> **Route(s):** `/dashboard/members`
> **Source authority:** `../../../features/FE/feature_identity.md` v1.11 + `../../../features/FE/feature_payment_reconcile.md` v1.10 + DD-25 · baseline `0c5808fc7cf50d139bdd9c4ee79917bf4059c4f4`
> **Source authority (BE tokens):** `../../../features/BE/feature_identity_tech.md` — `hasFinancialHistory` (merge gate predicate) và `MERGE_REQUIRES_REVIEW` / `LINK_CODE_INVALID` / `LINK_CODE_RATE_LIMITED`; `../../../features/FE/feature_tenant_routing_authz.md` — capability `money.mark_paid`, `member.manage_routine`. Các token này **không** nằm trong `feature_identity.md` v1.11; FE lấy nguyên văn, không tự đặt.
> **Source contract status:** Reviewed identity/payment safety contracts
> **Projection/API contract:** Member directory/merge DTO `UNPINNED`; money action delegates to canonical mark-paid contract
> **Capability/availability:** Exact `money.mark_paid` for payment action; server-owned identity/merge authority
> **Priority:** 7 — designer-kickoff.md §3B
> **FE design status:** Draft
> **Runtime status:** Partial identity storage only — member directory/merge UI chưa build
> **Negative scope:** Không hard-delete membership/ledger; không merge debt-bearing identity thiếu strong proof; không author host membership-status mutation

> 📍 **Đọc nhanh (2026-09-08 — chỉ mục, không phải authority):** feature nguồn `../../../features/FE/feature_identity.md` + `../../../features/FE/feature_session_management.md`; scope/phase đọc ở `BRD.md` v3.10 §📍 · hành vi `PRD.md` v2.9 §📍 · contract `TDD.md` v3.2 §📍 · **tiến độ thật `ROADMAP.md` v3.17 §📍** (mốc `main@0aff7ad`, 04/09).
>
> **Phase-1 (DD-114):** 🟡 roster thuộc nhóm 6; merge P3.5 · **Launch (DD-113):** 🟡 roster trong session management; merge UI ⬜
>
> **Surface:** Web app **PWA** (Next.js App Router, installable/offline — DD-113 launch = PWA + Zalo bot song song) — `/dashboard/members`; **app native iOS (App Store) + Android (CH Play) là phase-2** (DD-69): tái dùng API/contract, màn native thiết kế lại theo platform sau gate, **không phải bản sao màn này**.
>
> **Trạng thái:** FE design Draft · 🔴 **FE PENDING (DD-116)** — không mở page/component, không track `.pen` tới khi đủ cả ba vế (chọn đúng một `.pen` canonical · tracked trên `main` · owner ký gate DD-81) · as-built @ `main@0aff7ad`: **0 màn FE nối API** (đúng 1 `apps/web/app/page.tsx`); BE: `0034` link resolver code dark; merge service ⬜.

---

## 1. Mô tả

Quản lý thành viên CLB: xem danh sách, tìm kiếm, xem profile, xử lý trùng (merge), và quản lý claim requests. Member directory/merge/debt projection chưa có exact response DTO, nên các wireframe là target fixtures; active rows, debt badge và merge controls bị omit tới khi owner contract được pin.

---

## 2. User Flows

### Flow 1: Xem danh sách thành viên

1. Host vào `/dashboard/members`
2. Future target table/grid gồm name, platform, sessions joined, debt, status; baseline active rows bị omit vì directory/debt DTO chưa pin
3. Search: tìm theo tên
4. Filter: Active / Left / Tất cả
5. Click member → side panel detail

### Flow 2: Xử lý merge gợi ý (suspected duplicates)

1. Banner trên đầu: "3 cặp thành viên có thể trùng"
2. Click → xem danh sách cặp: Nguyễn A (Zalo) ↔ Nguyen A (Web) — 85% match
3. Click cặp → preview merge impact: sessions, debts, identities
4. **Gate check:** dùng server-owned `hasFinancialHistory`, không dùng remaining debt:
   - `hasFinancialHistory=false` được chứng minh từ full charge/allocation query → Host chọn "Merge" → confirm → done
   - `hasFinancialHistory=true` hoặc unknown/denied/dependency error → **chặn merge**, kể cả nợ hiện tại là 0. Chỉ mở khi có verified account email hoặc consumed link_code. Fuzzy name match KHÔNG đủ
5. "Không trùng" → dismiss suggestion

### Flow 3: Xem chi tiết member

1. Click member row → side panel
2. Future target profile gồm tên, platform, linked accounts, sessions history, debt summary; baseline panel data bị omit
3. Action hiện tại: "Mở mark-paid" khi exact `money.mark_paid` active
4. Mark-paid action chỉ hiện với exact `money.mark_paid`; nó mở canonical preview với exact `membership_id`/`charge_id`, amount + method, rồi explicit confirm. Server owns idempotency/audit; member panel không mutate money trực tiếp
5. Host "Chuyển sang Left" không có owner command/capability trong source hiện tại nên CTA bị omit; player-self leave là flow khác

---

## 3. Screens & States

### `/dashboard/members` — Member List

> **Current implementation boundary:** Directory/merge/debt response DTO `UNPINNED`; wireframes dưới
> đây không authorize active rows, debt amounts, merge suggestions hoặc fallback data.

#### Layout (Desktop 1440px)

```
┌──────────┬──────────────────────────────────────────────────┐
│          │  Header: "Thành viên" (48) · [Search 🔍]         │
│ Sidebar  ├──────────────────────────────────────────────────┤
│          │                                                  │
│          │  ⚠️ Banner: "3 cặp thành viên có thể trùng"     │
│          │  [Xem chi tiết →]                                │
│          │                                                  │
│          │  Filter: [Active (42)] [Left (6)] [Tất cả (48)] │
│          │                                                  │
│          │  ┌────────────────────────────────────────────┐  │
│          │  │ 👤  │ Tên         │ Platform │ Kèo  │ Nợ  │  │
│          │  ├────────────────────────────────────────────┤  │
│          │  │ NA  │ Nguyễn Văn A│ 🌐 Web  │ 12   │ 0đ  │  │
│          │  │ TB  │ Trần Thị B  │ 💬 Zalo │ 8    │ 300k│  │
│          │  │ LC  │ Lê Văn C    │ 📱 Msg  │ 5    │ 0đ  │  │
│          │  │ PD  │ Phạm D      │ 💬 Zalo │ 3    │ 150k│  │
│          │  └────────────────────────────────────────────┘  │
│          │                                                  │
│          │  Pagination: [← 1 2 3 →]                        │
│          │                                                  │
│          │  ─── Member Detail Panel (slide-out) ──────     │
│          │  ┌────────────────────────────────────────────┐  │
│          │  │ 👤 Trần Thị B                              │  │
│          │  │ 💬 Zalo · Joined 15/03/2026                │  │
│          │  │ Linked: 🌐 Web ✅                          │  │
│          │  │                                            │  │
│          │  │ Sessions: 8 buổi (3 tháng gần nhất)       │  │
│          │  │ Nợ: 300,000đ (2 kèo)                       │  │
│          │  │                                            │  │
│          │  │ [💰 Mở mark-paid]                          │  │
│          │  └────────────────────────────────────────────┘  │
│          │                                                  │
└──────────┴──────────────────────────────────────────────────┘
```

#### States

- **Current implementation:** Omit directory rows, debt badge, merge banner và detail-panel data; render neutral unavailable placeholder. **Các state dưới đây là design target, chưa authorize render** — cùng cách viết như `feature_payments_fe.md` và `feature_settings_fe.md`
- **Loading:** Skeleton table rows + skeleton banner
- **Ready (target):** Member table + search + filter + merge banner (nếu có). Click row → detail panel
- **Empty:** Icon 👥 + "Chưa có thành viên nào" + "Thành viên sẽ xuất hiện khi có người join kèo"
- **Empty Search:** "Không tìm thấy thành viên" + CTA "Xoá bộ lọc"
- **Error:** Error banner + retry

#### Error mapping

| Status | Error code | Visible state | i18n `t(vi, en)` |
|---|---|---|---|
| — | `UNPINNED error catalog — omit active UI` | Directory rows, debt badge và merge banner: không fetch, không render ở baseline vì directory/debt DTO chưa pin | `N/A — surface omitted` |
| 403 | `NOT_TENANT_ADMIN` | Route không render; redirect về dashboard | `t("Bạn không có quyền admin của club này", "You don't have admin access to this club")` |
| 403 | `CAPABILITY_DENIED` | `money.mark_paid` thiếu/expired/revoked → CTA "Mở mark-paid" absent (không phải disabled); không gửi mutation | `t("Bạn không có quyền thực hiện thao tác này", "You don't have permission for this action")` |
| 403 | `TENANT_SUSPENDED` | Mọi money action absent; detail panel chỉ còn read-only | `t("Club đang tạm ngưng", "This club is suspended")` |
| 409 | `ATTESTED_TRANSFER_UNSUPPORTED` | Chặn ở bước confirm của mark-paid; không tạo bank transaction giả, không fallback `cash`/`manual` | `t("Chưa hỗ trợ xác nhận chuyển khoản chưa vào sổ", "Attested transfers aren't supported yet")` |
| — | `CHARGE_ALREADY_SETTLED` | Preview/confirm dừng lại + refetch debt từ server; không tự trừ nợ ở client | `t("Khoản này đã được thanh toán", "This charge is already settled")` |
| 429 | `RATE_LIMITED` | Chặn submit mark-paid theo server; không auto-retry (idempotency vẫn do server sở hữu) | `t("Quá nhiều yêu cầu — thử lại sau", "Too many requests — try again later")` |
| — | *(unknown / missing / timeout)* | **Fail closed** — unavailable placeholder + retry; debt hiện unavailable (không collapse thành 0đ) và money action bị block | `t("Không tải được dữ liệu thành viên. Thử lại.", "Couldn't load member data. Try again.")` |

> **Error mapping:** Pin server error/status → exact visible state. Unknown/missing response fail closed;
> không invent success, zero, empty hoặc disabled control. Nếu BE chưa pin catalog cho một endpoint,
> ghi `UNPINNED error catalog — omit active UI` thay vì bịa mã.

#### Responsive

| Breakpoint | Member List |
|---|---|
| 1440px | Sidebar fixed 240px full label (`feature_dashboard_fe.md` §3); header "Thành viên" + ô [Search 🔍] cùng hàng; filter tabs (Active / Left / Tất cả) trên một hàng; directory dạng table (avatar · Tên · Platform · Kèo · Nợ) full width; pagination dưới table; detail panel = slide-out phải 400px (§7), table vẫn hiển thị bên trái |
| 768px | Sidebar ẩn + hamburger ☰ (`feature_dashboard_fe.md` §3: ≤768px hidden + overlay); table thu nhỏ, ô search xuống dòng riêng dưới header; filter tabs giữ nguyên một hàng; detail panel vẫn slide-out phải |
| 375px | Sidebar ẩn + hamburger; directory thành card list (§7) thay cho table; filter tabs scroll ngang; ô search full-width; pagination full-width; detail panel = bottom sheet full-height (§7); merge banner giữ sticky dưới header. Baseline omit set không đổi theo breakpoint — directory rows, debt badge và merge banner vẫn **không fetch/không render** ở mọi kích thước (directory/debt DTO `UNPINNED`), và CTA "Mở mark-paid" absent chứ không disabled khi thiếu exact `money.mark_paid` |

### Merge Review (modal / page)

**Server chứng minh `hasFinancialHistory=false` → cho merge:**

```
┌──────────────────────────────────────────┐
│  Gợi ý merge                    [✕]    │
│                                          │
│  Cặp 1/3:                               │
│  ┌──────────┐    ↔    ┌──────────┐      │
│  │ Trần B   │         │ Tran B   │      │
│  │ 💬 Zalo  │         │ 🌐 Web   │      │
│  │ 3 kèo    │         │ 2 kèo    │      │
│  │ No history│         │ No history│     │
│  └──────────┘         └──────────┘      │
│                                          │
│  hasFinancialHistory: false (server)      │
│                                          │
│  [Không trùng]         [✅ Merge]        │
│                                          │
│  [← Prev]  Cặp 1/3  [Next →]            │
└──────────────────────────────────────────┘
```

**`hasFinancialHistory=true` dù nợ hiện tại 0 → chặn merge:**

```
┌──────────────────────────────────────────┐
│  Gợi ý merge                    [✕]    │
│                                          │
│  Cặp 2/3:                               │
│  ┌──────────┐    ↔    ┌──────────┐      │
│  │ Nguyễn A │         │ Nguyen A │      │
│  │ 💬 Zalo  │         │ 🌐 Web   │      │
│  │ 5 kèo    │         │ 7 kèo    │      │
│  │ Nợ: 0đ   │         │ Nợ: 0đ   │      │
│  └──────────┘         └──────────┘      │
│                                          │
│  ⚠️ hasFinancialHistory: true.         │
│  Cần xác minh tài khoản trước khi gộp. │
│                                          │
│  [Không trùng]    [🔒 Cần xác minh]     │
│                   (disabled)             │
│                                          │
│  [← Prev]  Cặp 2/3  [Next →]            │
└──────────────────────────────────────────┘
```

#### Error mapping

> `MERGE_REQUIRES_REVIEW` được pin là generic error ở `feature_identity_tech.md` §4 nhưng chưa pin HTTP status; FE map theo `error.code`, không theo status đoán.

| Status | Error code | Visible state | i18n `t(vi, en)` |
|---|---|---|---|
| — | `MERGE_REQUIRES_REVIEW` | Nút Merge chuyển "🔒 Cần xác minh" (disabled) — chặn kể cả khi nợ hiện tại là 0đ; message generic, không tiết lộ person/email có tồn tại hay không | `t("Cần xác minh tài khoản trước khi gộp", "Account verification required before merging")` |
| 400 | `LINK_CODE_INVALID` | Inline error ở ô nhập mã; không phân biệt sai / hết hạn / đã dùng / revoked | `t("Mã liên kết không hợp lệ hoặc đã hết hạn", "That link code is invalid or expired")` |
| 429 | `LINK_CODE_RATE_LIMITED` | Khoá ô nhập mã theo server; không auto-retry, không tự đặt đếm ngược ở client | `t("Quá nhiều lần thử — thử lại sau", "Too many attempts — try again later")` |
| 403 | `NOT_TENANT_ADMIN` | Merge modal không mở; merge banner absent | `t("Bạn không có quyền admin của club này", "You don't have admin access to this club")` |
| 403 | `CAPABILITY_DENIED` | Merge control absent (không render placeholder disabled); không gửi merge command | `t("Bạn không có quyền thực hiện thao tác này", "You don't have permission for this action")` |
| — | *(unknown / missing / timeout)* | **Fail closed** — unavailable placeholder + retry; `hasFinancialHistory` unknown/denied/error đều **chặn merge**, không suy thành `false` | `t("Không kiểm tra được điều kiện gộp. Thử lại.", "Couldn't verify merge eligibility. Try again.")` |

> **Error mapping:** Pin server error/status → exact visible state. Unknown/missing response fail closed;
> không invent success, zero, empty hoặc disabled control. Nếu BE chưa pin catalog cho một endpoint,
> ghi `UNPINNED error catalog — omit active UI` thay vì bịa mã.

#### Responsive

| Breakpoint | Merge Review |
|---|---|
| 1440px | Centered modal 640px (§7) overlay lên member list; hai thẻ person nằm cạnh nhau với ký hiệu ↔ ở giữa; dòng gate (`hasFinancialHistory` / cảnh báo cần xác minh) full width dưới cặp thẻ; hàng action [Không trùng] · [✅ Merge] cùng dòng; carousel [← Prev] · "Cặp n/3" · [Next →] ở đáy modal |
| 768px | Vẫn centered modal, thu hẹp theo viewport; hai thẻ person giữ cạnh nhau; hàng action và carousel không đổi cấu trúc |
| 375px | Full-screen modal (§7); hai thẻ person xếp dọc, ký hiệu ↔ nằm giữa hai thẻ; hai nút action full-width xếp dọc; carousel prev/next giữ ở đáy. Gate không đổi theo breakpoint — `hasFinancialHistory=true`/unknown/denied/error vẫn hiện "🔒 Cần xác minh" disabled, và khi `CAPABILITY_DENIED`/`NOT_TENANT_ADMIN` thì merge control absent ở mọi kích thước |

---

## 4. Components Used

| Component | States | Mô tả |
|---|---|---|
| `MemberTable` | loading, ready, empty, error | Bảng thành viên — sortable, searchable |
| `MemberRow` | default, hover (highlight), selected (detail open) | Row member: avatar initials + name + platform icon + stats |
| `AvatarInitials` | default (random bg color per name) | Circle avatar with initials |
| `PlatformBadge` | Web 🌐, Zalo 💬, Messenger 📱 | Platform icon badge |
| `DebtBadge` | omitted/unavailable, known-zero, known-amount | Current projection unpinned nên omit; unknown/denied/error hiện unavailable và block money action, không collapse thành 0 |
| `MergeBanner` | visible (count > 0), hidden | Warning banner gợi ý merge |
| `MemberDetailPanel` | slide-out (desktop), bottom sheet (mobile) | Panel chi tiết member |
| `MergeReviewModal` | carousel mode (prev/next cặp) | Modal review + confirm merge |
| `MergeImpactPreview` | loading, safe, blocked, unknown, denied, error | Merge chỉ enable khi server chứng minh `hasFinancialHistory=false`; mọi true/unknown/error block |
| `MarkPaidAction` | hidden, ready, preview, confirming, success, error | Exact `money.mark_paid`; preview amount/method + confirm; server idempotency/audit |
| `SearchInput` | default, focus, active (has query) | Search bar with clear button |
| `FilterTabs` | Active, Left, Tất cả | Tab filter |

---

## 5. Edge Cases (UX)

| # | Case | Hiển thị |
|---|---|---|
| 1 | Member name quá dài | Truncate + tooltip |
| 2 | Member trên nhiều platform | Hiện platform chính + "+1 more" badge |
| 3 | `hasFinancialHistory=true` dù remaining debt = 0 | **Chặn merge.** Hiện "Cần xác minh tài khoản trước khi gộp"; unknown/denied/dependency error cũng block |
| 4 | Merge dismissed → gợi ý lại sau? | FE gửi exact dismiss action rồi follow server result; cooldown/reappearance policy `UNPINNED`, không đặt timer 30 ngày client-side |
| 5 | Member "Left" có canonical `known_amount` trong future DTO | Future debt badge đỏ; current projection unpinned nên omit. Unknown/denied/error hiện unavailable, không hidden như zero |
| 6 | 0 merge suggestions | Banner ẩn — không hiện "0 cặp" |
| 7 | Search không dấu | Fuzzy match: "nguyen" match "Nguyễn" |
| 8 | Host muốn chuyển member sang Left | CTA absent. **Capability `member.manage_routine` CÓ tồn tại và mặc định được cấp cho host** (`feature_tenant_routing_authz.md:106` — "Routine member management + manual ban \| ✅"); thứ còn thiếu là **command/endpoint + response DTO**, không phải quyền. Không render control disabled và không suy quyền ở client — chờ endpoint được pin |
| 9 | Claim request pending | Hiện banner: "1 yêu cầu xác nhận thành viên" |
| 10 | Member chưa link account | Status: "Chưa liên kết" (gray) — nhắc link |
| 11 | `money.mark_paid` thiếu/wrong tenant/expired/revoked | Action absent/denied; không gửi mutation |
| 12 | Mark-paid retry/double click | Disable sau submit; server idempotency trả canonical result, refresh debt/charge from source |

---

## 6. Data hiển thị

| Field | Exact response path | Format | i18n `t(vi, en)` | Ghi chú |
|---|---|---|---|---|
| Member name | `UNPINNED member-directory DTO — omit active UI` | Text | N/A — person content | Display name from Person, không dịch |
| Platform | `UNPINNED member-directory DTO — omit active UI` | Icon badge | Label `t("Nền tảng", "Platform")`; tên nền tảng: `data — no copy` | 🌐 Web, 💬 Zalo, 📱 Messenger |
| Sessions count | `UNPINNED member-directory DTO — omit active UI` | Number | Label `t("Kèo", "Sessions")`; số: `data — no copy` | "12 buổi" |
| Debt | `UNPINNED canonical member-payment projection — omit` | Currency VNĐ | Label `t("Nợ", "Balance due")`; số tiền: `data — no copy` | Không sum ledger client-side |
| Joined date | `UNPINNED member-directory DTO — omit active UI` | Date (vi) | Label `t("Tham gia từ", "Joined")`; ngày: `data — no copy` | "15/03/2026" |
| Status | `UNPINNED member-directory DTO — omit active UI` | Active / Left | `t("Đang hoạt động", "Active")` · `t("Đã rời", "Left")` · `t("Chưa liên kết", "Not linked")` | Green / Gray |
| Merge confidence | `UNPINNED merge-preview DTO — omit active UI` | Percentage | Label `t("Độ khớp", "Match confidence")`; % : `data — no copy` | Không dùng fuzzy score làm merge authority |
| Financial history gate | `UNPINNED merge-preview DTO — omit active merge` | Boolean/unknown | `t("Cần xác minh tài khoản trước khi gộp", "Account verification required before merging")` | Server-owned `hasFinancialHistory`; chỉ exact false enable merge |

> **i18n:** Mọi chuỗi user-facing ở file này đi qua `t(vi, en)` (`packages/core/src/i18n.ts`). Repo không có key-based i18n; cặp vi/en ở cột trên là chuỗi thật, không phải key.

---

## 7. Responsive & Interaction Notes

- **Table:** Desktop = full table. Mobile = card list; debt omitted tới khi canonical member-payment projection được pin
- **Detail panel:** Desktop = slide-out right (400px). Mobile = bottom sheet full-height
- **Search:** Debounce 300ms. Clear button khi có query
- **Merge banner:** Sticky top (dưới header). Click → modal/page
- **Merge modal:** Desktop = centered modal (640px). Mobile = full-screen modal
- **Sort:** Click column header → toggle sort direction
- **Avatar colors:** Deterministic from name hash (consistent per person)
- **Dark mode:** Table `var(--bg-card)`; future proven debt amount dùng `var(--error)`, unavailable dùng neutral token
- **Keyboard:** Tab qua rows, Enter mở detail, Escape đóng panel

---

## Analytics Events (Draft — đề xuất, chưa phải contract)

> Skeleton — chưa điền. Quy tắc khi điền: params cấm amount/tiền/PII; chỉ opaque id, enum, count, boolean. Nguồn template: Sporta FE porting analysis 2026-08-07.

| Event | Trigger | Params | Ghi chú |
|---|---|---|---|
| TBD (UNPINNED) | | | |

## State Machine (Draft)

> Skeleton — node lấy từ §States hiện có của file này: Member List (§3): Current implementation (omit) · Loading · Ready (target) · Empty · Empty Search · Error (section Merge Review không có block §States riêng). Transition: TBD (UNPINNED) — chỉ được điền từ flow/edge case đã pin, không suy diễn.

## Acceptance Criteria (Draft)

> Skeleton — mỗi AC khi điền phải trace về một § có sẵn trong file. TBD.

## Testing Notes (Draft)

> Skeleton — unit/component/e2e hooks map theo AC. TBD.

---

_FE Design Spec v0.5 · 2026-08-07 · Source: feature_identity.md v1.11 + feature_payment_reconcile.md v1.10 + DD-25 · BE tokens: feature_identity_tech.md, feature_tenant_routing_authz.md_
_Changelog v0.5: Thêm skeleton 4 section Draft (Analytics/State Machine/AC/Testing) — nguồn: Sporta FE porting analysis 2026-08-07_
_FE Design Spec — 2026-09-08 (cấu trúc, không bump version): thêm khối 📍 Đọc nhanh dưới header — feature nguồn · phase-1 (DD-114) · launch (DD-113) · surface PWA trước, native iOS/Android phase-2 (DD-69) · FE PENDING (DD-116) · as-built @ `0aff7ad`. Pointer core docs BRD v3.10 · PRD v2.9 · TDD v3.2 · ROADMAP v3.17. Nội dung thiết kế không đổi._
