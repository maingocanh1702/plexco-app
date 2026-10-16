# Feature: Notifications — FE Design Spec

> **Route(s):** Accessed via 🔔 header icon → dropdown/panel
> **Source authority:** `../../../features/FE/feature_notifications_reminders.md` v3.11 · baseline `0c5808fc7cf50d139bdd9c4ee79917bf4059c4f4` · STALE PIN: source is now v3.13, FE spec not re-reviewed
> **Source contract status:** Reviewed core notification contract; session/activity types deferred
> **Projection/API contract:** F11/A18 Inbox/detail HTTP DTO `UNPINNED — active UI omitted`
> **Capability/availability:** Current read visibility per item + closed type producer availability
> **Priority:** 11 — designer-kickoff.md §3B. *(Ràng buộc thứ tự: F11 payment Inbox/detail đi sau F0 và payment mechanisms 43→44/45→46; Home không phải prerequisite.)*
> **FE design status:** Draft
> **Runtime status:** Not started — inbox/global plane/UI chưa build
> **Negative scope:** Không session/join/leave/waitlist activity type; không snapshot tiền/PII; không archive/delete

> 📍 **Đọc nhanh (cập nhật 2026-09-15 — chỉ mục, không phải authority):** feature nguồn `../../../features/FE/feature_notifications_reminders.md`; scope/phase đọc ở `BRD.md` v3.10 §📍 · hành vi `PRD.md` v2.9 §📍 · contract `TDD.md` v3.2 §📍 · **tiến độ thật `ROADMAP.md` v3.17 §📍** (mốc `main@e235ea4`, 15/09).
>
> **Phase-1 (DD-114):** ✅ nhóm 6 nhắc/confirm (baseline) · **Launch (DD-113):** 🟡 Inbox/🔔 panel; **web push ngoài launch**
>
> **Surface:** Web app **PWA** (Next.js App Router, installable/offline — DD-113 launch = PWA + Zalo bot song song) — 🔔 header panel; **app native iOS (App Store) + Android (CH Play) là phase-2** (DD-69): tái dùng API/contract, màn native thiết kế lại theo platform sau gate, **không phải bản sao màn này**.
>
> **Trạng thái:** FE design Draft · 🔴 **FE PENDING (DD-116)** — không mở page/component, không track `.pen` tới khi đủ cả ba vế (chọn đúng một `.pen` canonical · tracked trên `main` · owner ký gate DD-81) · as-built @ `main@e235ea4`: **0 màn FE nối API** (đúng 1 `apps/web/app/page.tsx`); BE: 0 producer nhắc; Inbox DDL ⬜.

---

## 1. Mô tả

Thông báo in-app dùng closed-set type hiện có. Tenant plane: `reminder | settled | correction | owner_alert | announcement` (chỉ khi producer tương ứng đã land). Global plane: `follow_request | identity_link | identity_merged | security_alert`. Session lifecycle và join/leave/waitlist activity vẫn deferred bởi `NTF-OQ-18`, không được mô phỏng bằng generic type khác. Truy cập qua icon 🔔 trên header; dropdown trên desktop, full-screen panel trên mobile.

---

## 2. User Flows

### Flow 1: Xem thông báo

1. User tap 🔔 (badge hiện "3")
2. Dropdown/panel mở: danh sách notifications sorted by time
3. Tap notification → client gửi opaque source ref/authorized target về authenticated detail resolver; không tự build route từ type hay payload
4. Server re-authorize current visibility rồi mới tạo explicit read row; client không tự mark read trước response

### Flow 2: Mark all as read

1. Trong notification panel → "Đánh dấu tất cả đã đọc"
2. FE render unread count server trả sau bounded mark-all/reconcile; hidden, late hoặc concurrent items có thể giữ count > 0, client không tự reset về 0

---

## 3. Screens & States

### Notification Panel

> **Visual fixture only:** Copy, thời gian, unread count và thứ tự item trong wireframe chỉ kiểm tra
> hierarchy/spacing — không phải API contract, không dùng làm seed/default/fallback. Nội dung
> notification là **server-localized**, FE không tự dựng câu chữ từ type/payload. Closed-set type giới
> hạn ở tenant plane `reminder | settled | correction | owner_alert | announcement` (chỉ khi producer
> tương ứng đã land) và global plane `follow_request | identity_link | identity_merged | security_alert`;
> session/join/leave/waitlist activity còn **deferred bởi `NTF-OQ-18`** và không được mô phỏng bằng
> generic type khác. Route đích do resolver trả, không suy từ type (§2 bước 3).

#### Layout (Desktop — dropdown from 🔔)

```
                              ┌──────────────────────┐
                              │ 🔔 Thông báo     [✓] │
                              │ ─── Mới ──────────── │
                              │                      │
                              │ ⏰ Có lời nhắc thanh │
                              │ toán                 │
                              │ 5 phút trước    ●    │
                              │                      │
                              │ ✅ Thanh toán đã được│
                              │ ghi nhận             │
                              │ 10 phút trước   ●    │
                              │                      │
                              │ 🔐 Có cảnh báo bảo   │
                              │ mật mới              │
                              │ 30 phút trước   ●    │
                              │                      │
                              │ ─── Cũ hơn ──────── │
                              │                      │
                              │ 🔄 Thanh toán đã được│
                              │ điều chỉnh           │
                              │ Hôm qua              │
                              │                      │
                              │ [Xem tất cả →]       │
                              └──────────────────────┘
```

#### Layout (Mobile — full panel)

```
┌──────────────────────┐
│ [← Back] Thông báo ✓ │
├──────────────────────┤
│ Mới                   │
│ ┌──────────────────┐ │
│ │ ⏰ Có lời nhắc      │ │
│ │ thanh toán         │ │
│ │ 5 phút trước  ●  │ │
│ └──────────────────┘ │
│ ┌──────────────────┐ │
│ │ ✅ Thanh toán đã  │ │
│ │ được ghi nhận    │ │
│ └──────────────────┘ │
│ ┌──────────────────┐ │
│ │ 🔐 Có cảnh báo   │ │
│ │ bảo mật mới      │ │
│ │ 30 phút trước ●  │ │
│ └──────────────────┘ │
│ Cũ hơn               │
│ ...                   │
├──────────────────────┤
│ Bottom Nav            │
└──────────────────────┘
```

#### States

- **Loading:** Skeleton notification rows (3-5)
- **Ready:** Grouped: "Mới" (unread) + "Cũ hơn" (read). Each: icon + text + time + unread dot
- **Empty:** Icon 🔔 + "Không có thông báo nào" + "Thông báo sẽ hiện khi có hoạt động mới"
- **Error:** "Không tải được thông báo" + retry
- **All read:** No "Mới" section. ✓ icon hidden

#### Error mapping

| Status | Error code | Visible state | i18n `t(vi, en)` |
|---|---|---|---|
| 400 | `INVALID_CURSOR` | Dừng phân trang tại chỗ; refetch từ đầu list, không nối trang lỗi và không render Empty | `t("Không tải thêm được thông báo. Thử lại.", "Couldn't load more notifications. Try again.")` |
| 404 | `NOTIFICATION_NOT_FOUND` | Không tạo read mutation, không navigate; item hiện generic unavailable + reconcile list/count. Không phân biệt "không tồn tại" với "không thuộc actor" | `t("Nội dung không còn khả dụng", "This content is no longer available")` |
| 429 | `RATE_LIMITED` | Chặn poll/mark-all thêm; giữ list hiện có + retry sau, không tự reset badge về 0 | `t("Thao tác quá nhanh — thử lại sau", "Too many requests — try again shortly")` |
| — | *(unknown / missing / timeout)* | **Fail closed** — unavailable placeholder + retry; badge giữ last known count, panel không render Empty và không cache nội dung | `t("Không tải được thông báo. Thử lại.", "Couldn't load notifications. Try again.")` |

> **Error mapping:** Pin server error/status → exact visible state. Unknown/missing response fail closed;
> không invent success, zero, empty hoặc disabled control. Nếu BE chưa pin catalog cho một endpoint,
> ghi `UNPINNED error catalog — omit active UI` thay vì bịa mã.

#### Responsive

> Bảng này **chốt breakpoint cho hai layout đã vẽ ở trên** (Desktop — dropdown · Mobile — full panel),
> không mô tả thêm layout thứ ba.

| Breakpoint | Notification Panel |
|---|---|
| 1440px | Dropdown neo dưới icon 🔔 trên header: rộng 400px, `max-height: 480px`, cuộn dọc (§7); hàng đầu "🔔 Thông báo" + [✓] mark-all bên phải; section "Mới" / "Cũ hơn"; "[Xem tất cả →]" ở đáy dropdown; click ra ngoài → đóng (§5 #5, §7) |
| 768px | Vẫn là dropdown như 1440px, chiều rộng giới hạn theo viewport nếu 400px không đủ chỗ. File chỉ pin hai hình thức (dropdown · full panel) và **không pin ngưỡng chuyển giữa chúng** — không tự đặt số ở đây |
| 375px | Full-screen panel push navigation (§7) thay cho dropdown: hàng đầu [← Back] + "Thông báo" + ✓; item thành card stack; Bottom Nav giữ ở đáy; Back → return. Hành vi không đổi theo breakpoint — không auto-mark-read ở client (§2 bước 4), badge giữ last known count khi fail closed, và panel không render Empty từ response thiếu |

---

## 4. Components Used

| Component | States | Mô tả |
|---|---|---|
| `NotificationBell` | idle (no badge), unread (badge count), max (99+) | 🔔 icon trên header + badge |
| `NotificationPanel` | dropdown (desktop), full panel (mobile) | Container notification list |
| `NotificationItem` | unread (● dot + bold), read (normal), hover (highlight) | Row notification: icon + text + time |
| `NotificationIcon` | closed type mapping | ⏰ reminder · ✅ settled · 🔄 correction · ⚠️ owner_alert · 📣 announcement · 👤 follow_request · 🔗 identity_link/merged · 🔐 security_alert |
| `SectionDivider` | "Mới", "Cũ hơn" | Section separator |
| `MarkAllRead` | default, loading, reconciled, error | Mark visible/authorized items; render authoritative returned unread count, retry on error |

---

## 5. Edge Cases (UX)

| # | Case | Hiển thị |
|---|---|---|
| 1 | Unread > 99 | Badge "99+" |
| 2 | Notification arrives khi panel open | Prepend to top + subtle animation (slide in) |
| 3 | Opaque source ref bị forbidden/hidden khi tap | Resolver deny; không tạo read mutation, reconcile list/count và không lộ source |
| 3a | Source đã deleted nhưng item vẫn được current authz cho đọc | Server có thể trả generic "Nội dung không còn khả dụng"; read mutation chỉ theo authoritative response |
| 4 | Tap notification → navigate | Server re-authorize source trước read row/target; chỉ close/navigate khi response authorize |
| 5 | Desktop: click outside dropdown | Close dropdown |
| 6 | Notification text dài | Max 2 lines + truncate |
| 7 | Host vs Player notifications | Copy derive từ closed type + current authorization; không lấy role/client state để invent variant |
| 8 | Real-time payment notification | SSE → notification appears + bell badge update |
| 9 | Notification for merged account | "🔄 Tài khoản đã gộp". **Không hardcode route `/me`** — FE gửi opaque source ref về resolver và đi tới authorized target server trả (§2 bước 3: "không tự build route từ type hay payload"). Resolver deny ⇒ item ở lại inbox, không tạo read mutation |
| 10 | Offline | Badge giữ last known count. Nội dung panel KHÔNG cache — hiện "Cần kết nối để xem thông báo" |

---

## 6. Data hiển thị

| Field | Exact response path | Format | i18n `t(vi, en)` | Ghi chú |
|---|---|---|---|---|
| Notification type | `UNPINNED F11/A18 DTO — omit active UI` | Closed enum | `server-localized — FE không tự dịch` | Chỉ tenant/global types được owner contract pin |
| Opaque source ref | `UNPINNED F11/A18 DTO — omit active UI` | Opaque | N/A — never displayed | Không parse thành tenant/session/person ID |
| Notification text | `UNPINNED F11/A18 DTO — omit active UI` | Text (2 lines max) | `server-localized — FE không tự dịch` | Body copy sinh ở server theo closed type; FE không build/dịch chuỗi, không lộ tên/số tiền người khác |
| Time | `UNPINNED F11/A18 DTO — omit active UI` | Relative | N/A — locale formatter | "5 phút trước", "Hôm qua" |
| Unread dot | `UNPINNED F11/A18 DTO — omit active UI` | ● (blue) | Accessible label `t("Chưa đọc", "Unread")` | Chỉ hiện cho unread |
| Badge count | `UNPINNED F11/A18 DTO — omit active UI` | Number | Accessible label `t("Thông báo chưa đọc", "Unread notifications")`; value: `data — no copy` | Server-authoritative returned count |
| Category icon | `UNPINNED F11/A18 DTO — omit active UI` | Closed mapping | `data — no copy` | Glyph ⏰✅🔄⚠️📣👤🔗🔐; text đi kèm là notification text server-localized |

> **i18n:** Mọi chuỗi user-facing ở file này đi qua `t(vi, en)` (`packages/core/src/i18n.ts`). Repo không có key-based i18n; cặp vi/en ở cột trên là chuỗi thật, không phải key.

> ⚠️ **Privacy rule:** Persist closed type + opaque source ref, không snapshot tiền/PII/title tùy ý. Payment detail phải authenticated-fetch canonical `SelfPaymentStatus` cho chính requester; không bao giờ hiện tên/số tiền của người khác. Resolver không chứng minh được quyền hoặc source không còn tồn tại → generic unavailable.

---

## 7. Responsive & Interaction Notes

- **Desktop:** Dropdown panel (400px wide, max-height 480px, scrollable). Appears below 🔔 icon. Click outside → close
- **Mobile:** Full-screen panel (push navigation). Back button → return
- **Bell badge:** Pulse animation khi có notification mới. Badge scales in (spring animation)
- **Notification items:** Tap → gửi opaque source ref tới authenticated detail resolver → điều hướng theo **authorized target server trả**. **Không auto-mark-read ở client:** server re-authorize visibility hiện tại rồi mới tạo explicit read row (§2 bước 4); FE chỉ cập nhật sau response, không optimistic
- **Grouping:** "Mới" section = unread. "Cũ hơn" = read. Auto-sort by time DESC
- **Mark all read:** ✓ icon top-right. Tap → loading → reconcile exact server-returned visible reads + unread count; không local-clear toàn bộ dot/badge
- **SSE:** Real-time push. New notification → prepend + bell badge update
- **Dark mode:** Panel `var(--bg-card)`, unread dot `var(--primary)`, hover `var(--bg-hover)`
- **Z-index:** Dropdown above all content. Close on route change

---

## Analytics Events (Draft — đề xuất, chưa phải contract)

> Skeleton — chưa điền. Quy tắc khi điền: params cấm amount/tiền/PII; chỉ opaque id, enum, count, boolean. Nguồn template: Sporta FE porting analysis 2026-08-07.

| Event | Trigger | Params | Ghi chú |
|---|---|---|---|
| TBD (UNPINNED) | | | |

## State Machine (Draft)

> Skeleton — node lấy từ §States hiện có của file này: Notification Panel (§3): Loading · Ready · Empty · Error · All read. Transition: TBD (UNPINNED) — chỉ được điền từ flow/edge case đã pin, không suy diễn.

## Acceptance Criteria (Draft)

> Skeleton — mỗi AC khi điền phải trace về một § có sẵn trong file. TBD.

## Testing Notes (Draft)

> Skeleton — unit/component/e2e hooks map theo AC. TBD.

---

_FE Design Spec v0.5 · 2026-08-07 · Source: feature_notifications_reminders.md v3.11_
_Changelog v0.5: Thêm skeleton 4 section Draft (Analytics/State Machine/AC/Testing) — nguồn: Sporta FE porting analysis 2026-08-07_
_FE Design Spec — 2026-09-08 (cấu trúc, không bump version): thêm khối 📍 Đọc nhanh dưới header — feature nguồn · phase-1 (DD-114) · launch (DD-113) · surface PWA trước, native iOS/Android phase-2 (DD-69) · FE PENDING (DD-116) · as-built @ `e235ea4`. Pointer core docs BRD v3.10 · PRD v2.9 · TDD v3.2 · ROADMAP v3.17. Nội dung thiết kế không đổi._

_Re-pin 2026-09-15 (cấu trúc, không bump version): as-built @ `e235ea4` theo `ROADMAP.md` v3.17 §📍 — 8 command session · 7 route nghiệp vụ · **0 màn FE**; FE PENDING (DD-116) không đổi, DD-119 vẫn 🟡 chưa ratify. Nội dung thiết kế không đổi._
