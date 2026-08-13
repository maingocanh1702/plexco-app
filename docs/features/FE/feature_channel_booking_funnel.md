# Feature: Channel-first Booking Funnel — Product/UX Spec

> **Canonical phase:** P4.3 / P4.7 + Messenger P2.5
> **Track:** Growth / Channel Acquisition
> **Version:** 1.3 · 2026-08-12
> **Status:** Reviewed contract — DD-32 Option D (`browse freely → link hoặc pay-now ở final confirm`)
> **Implementation:** Not started · authority: `../standards/BUILD-STATUS.md` (Doc status ≠ Implementation status)
> **Prerequisites:** Identity/account link · common Session/Join/Waitlist core · payment settlement capability · Zalo/Messenger adapters · web-auth handoff
> **Tài liệu liên quan:** `../standards/decisions.md` DD-05/06/32/33/39/45/49/50/67 · `../standards/business-rules.md` BL-CBF · `feature_cross_club_join.md` · `feature_identity.md` · `feature_web_auth_onboarding.md` · `../BE/feature_channel_booking_funnel_tech.md`

---

## 1. Mục tiêu và ranh giới

Plexco cho phép người dùng tìm hiểu và đăng ký session ngay trong Messenger/Zalo mà không buộc cài app trước:

1. **Browse không ma sát:** xem thời gian, khu vực, phí, số người đã xác nhận và số chỗ đang khả dụng.
2. **Final confirm có hai đường:**
   - link Plexco account một lần cho đúng channel identity rồi đặt chỗ, chưa cần trả ngay;
   - không link thì thanh toán ngay để xác nhận chỗ.
3. **Deepen:** account đã link mở lịch sử xuyên CLB, nhắc, app và các hành động sâu hơn.

Feature này không tạo một hệ booking riêng trong bot. Messenger/Zalo chỉ thu intent và render kết quả; mọi eligibility, capacity, waitlist, giá, charge và payment allocation đi qua shared core.

### Entry points

| Entry | Route / Surface | Actor | Mô tả |
|-------|----------------|-------|-------|
| Messenger browse | Messenger window → structured menu/postback | Player | Xem session card trong Messenger |
| Zalo browse | Zalo OA DM → structured menu | Player | Xem session card trong Zalo |
| Shared link (deep) | `plexco.app/s/:ref` → bot redirect | Player | Nhấn link session được chia sẻ |
| Final confirm gate | Bot inline CTA | Player | Đăng ký / TT ngay / Link Plexco |
| Web handoff (link) | `/link/:handoff_id` | Player | Binding Account từ bot |
| Webhook settlement | Provider callback | System | Verified payment → finalizer |

### Bất biến sản phẩm

- **Browse luôn mở:** không yêu cầu account link trước khi xem session.
- **Địa điểm theo DD-06:** trước khi `players.status='active'`, bot chỉ hiển thị `area`; exact venue chỉ hiện sau khi booking active.
- **Không lộ roster/nợ:** chỉ hiển thị aggregate count, không tên người đăng ký, debt hay dữ liệu cá nhân.
- **Gate chỉ ở final confirm:** không chèn link wall giữa discovery và session detail.
- **Free session không có pay-wall giả:** `amount_due_now=0` thì unlinked user được confirm theo common join.
- **Paid session còn chỗ:** linked account được active + tạo nghĩa vụ thanh toán như join hiện hành; unlinked user phải hoàn tất verified full payment trong hold 15 phút trước khi active.
- **Full session:** vào waitlist không cần link, không thu tiền, không tạo charge và không lộ venue.
- **Approval session:** tạo pending request trước; chỉ sau host approval mới áp link-or-pay gate. Không thu tiền trước khi host duyệt.
- **Provider/connector không chứng minh được settlement:** fail closed; không chấp nhận ảnh chụp, tin nhắn “đã chuyển” hay manual mark-paid như instant proof. Bot đề nghị link account hoặc mở web.
- **Linked-for-deferred-payment** phải là một Plexco `account` có verified account identity và cùng current `Person` với exact endpoint-scoped `ChannelIdentity`. Display name, PSID/`from.id` tự khai hoặc một `link_code` chưa hoàn tất binding không đủ.

---

## 2. Decision table

`paid` dưới đây nghĩa là canonical pricing core trả một `amount_due_now > 0` chính xác. Nếu không chứng minh được giá, final confirm bị chặn và user được hướng dẫn link/hoàn thiện hồ sơ trên web.

| Join policy / capacity | Fee | Account state | Final-confirm outcome |
|---|---:|---|---|
| Open · còn chỗ | 0 | Linked hoặc unlinked | Common join → `active`; không charge/payment hold |
| Open · còn chỗ | >0 | Linked | Common join → `active` + exactly-one canonical charge; pay later |
| Open · còn chỗ | >0 | Unlinked | Tạo một payment hold 15 phút + QR/instructions; chỉ verified full settlement mới finalise `active` + charge + allocation atomically |
| Open · full | Bất kỳ | Linked hoặc unlinked | `waitlisted`; không link wall, không charge/payment/venue |
| Approval · chưa duyệt | Bất kỳ | Linked hoặc unlinked | `join_requests.pending`; không charge/payment/hold |
| Approval · đã duyệt, còn chỗ | 0 | Linked hoặc unlinked | Common join → `active` |
| Approval · đã duyệt, còn chỗ | >0 | Linked | Common join → `active` + exactly-one charge |
| Approval · đã duyệt, còn chỗ | >0 | Unlinked | Payment hold 15 phút; verified settlement mới active |
| Approval · đã duyệt nhưng full | Bất kỳ | Linked hoặc unlinked | `waitlisted`; không charge/payment/venue |

### Promotion từ waitlist

- Linked candidate được revalidate rồi activate theo DD-45/DD-49; paid session tạo/carry canonical obligation, không cần pay ngay.
- Unlinked candidate ở paid session nhận một offer/hold 15 phút với hai CTA: **Link Plexco** hoặc **Thanh toán ngay**.
- Hold hết hạn thì release capacity, giữ candidate trong waitlist nhưng đưa về cuối hàng bằng một audited requeue transition; bot báo rõ và selector tiếp tục candidate kế tiếp. Không lặp offer vô hạn ở đầu hàng.
- Payment/link hoàn tất trước expiry thì revalidate live và finalise một lần. Callback đến sau expiry không tự book lại.

---

## 3. Luồng UX

### 3.1 Browse session

Bot trả một card ngắn:

```text
🏸 Cầu lông tối thứ Tư
🕒 19:00–21:00, 30/07
📍 Quận 3 · địa điểm cụ thể sau khi xác nhận
👥 12 người đã xác nhận · 2 chỗ đang khả dụng
💳 120.000đ

[Đăng ký] [Xem kèo khác]
```

`confirmed_count` là active players; `slots_available` trừ cả active players và live payment holds. Khi có hold, hai số có thể không cộng thành capacity; UI có thể thêm “một số chỗ đang được giữ trong lúc thanh toán”, không hiển thị danh tính.

### 3.2 Final confirm — linked

```text
Bạn đã liên kết Plexco ✓
Xác nhận giữ 1 chỗ — 120.000đ, thanh toán sau?

[Xác nhận đăng ký] [Quay lại]
```

Sau confirm:

- active: hiện exact venue + khoản cần trả/CTA thanh toán;
- waitlisted: hiện vị trí, không venue/QR/charge mới;
- price/capacity đổi: bot hiển thị dữ liệu mới và yêu cầu confirm lại, không dùng consent cũ.

### 3.3 Final confirm — unlinked paid

```text
Để xác nhận chỗ, chọn một cách:

[Link Plexco — trả sau]
[Thanh toán ngay — không cần link]
```

Nếu chọn pay-now:

```text
Mình đang giữ chỗ cho bạn trong 15:00.
Chuyển đúng 120.000đ với mã PXC-••••.
Chỗ chỉ được xác nhận khi Plexco nhận được thanh toán.

[Tôi đã thanh toán] [Link Plexco thay thế] [Huỷ]
```

Nút “Tôi đã thanh toán” chỉ refresh trạng thái; không tự đánh dấu paid.

### 3.4 Account link lần đầu

1. Bot tạo opaque, single-use booking handoff bound với exact channel identity, provider endpoint, session và action.
2. User mở Plexco trên web:
   - đã có account → đăng nhập;
   - chưa có account → onboarding ngắn + verify account identity;
   - xem rõ “Link tài khoản Plexco này với Messenger/Zalo này” và confirm.
3. Identity service hoàn tất binding/merge theo DD-50; callback chỉ nhận opaque result.
4. Bot resume đúng booking intent, recheck session/price/capacity và hiển thị final confirm lại nếu dữ liệu đổi.

Messenger có thể dùng provider-native account-link CTA khi capability được duyệt; Zalo có thể dùng Zalo Login khi DD-14 enable. Cả hai luôn có transactional Plexco handoff/`link_code` fallback. Facebook Login subject và Messenger Page-scoped PSID, cũng như Zalo Login subject và bot/OA-scoped `from.id`, không được auto-link chỉ vì cùng provider.

### 3.5 Free, full và approval

- Free + còn chỗ: nút **Đăng ký miễn phí**, không ép link.
- Full: nút **Vào danh sách chờ**, không QR/payment.
- Approval: nút **Gửi yêu cầu tham gia**; sau host approval bot mới mở final gate nếu có tiền.

### 3.6 Component tables

**Component: Session browse card (bot) — unified `SessionCard` data alignment:**

| Field | Data source | Ghi chú |
|-------|-------------|---------|
| Sport + session name | `public_sessions.sport_key` + `sessions.name` | |
| Time range | `sessions.starts_at/ends_at` | Format `HH:mm – HH:mm, DD/MM` |
| Area | `sessions.area` | Coarse, KHÔNG address |
| Going count | Shared occupancy helper | `N/M Going` (active_count / slots_max) |
| Urgency text | `slots_open` | "⚠️ Chỉ còn N chỗ!" khi `≤ 3`. Text-only (bot không có badge). Ẩn khi `> 3` |
| Slots available | `slots_max - active - live_holds` | Advisory |
| Fee | `sessions.price_amount` | VND + "/Người" |
| Skill level | `sessions.skill_level` | Range format: "Người mới – Trung bình" (khi có min+max) |
| CTA buttons | `[Đăng ký]` `[Xem kèo khác]` | Platform quick-reply |

**Component: Final confirm gate (decision table):**

| Condition | CTA shown | Flow |
|-----------|-----------|------|
| Linked + paid + còn chỗ | [Xác nhận đăng ký] | Active + charge |
| Unlinked + paid + còn chỗ | [Link Plexco] / [TT ngay] | Link handoff HOẶC hold 15' |
| Free + còn chỗ | [Đăng ký miễn phí] | Active, no link needed |
| Full (hết chỗ) | [Vào danh sách chờ] | Waitlisted, no payment |
| Approval required | [Gửi yêu cầu] | Pending → host approve |

**Component: Payment hold timer:**

| State | Display | Timeout |
|-------|---------|---------|
| Active hold | "Giữ chỗ: [MM:SS]" countdown | 15:00 |
| ≤2 min left | Countdown turns red/pulse | Warning |
| Expired | "Hết hạn — chuyển về cuối hàng" | Auto-requeue |
| Payment verified | "✅ Đã xác nhận" | Timer stops |

### 3.7 Data source mapping

| Component | Data source | Ghi chú |
|-----------|-------------|---------|
| Browse card | `public_sessions` (whitelist) | No roster/PII |
| Occupancy | Shared occupancy helper | Holds counted |
| Payment hold | `payment_holds` per session | 15' TTL, capacity deducted |
| Link handoff | `booking_handoffs` (opaque, single-use) | Bound to channel+session+action |
| Settlement | Provider webhook → reconcile | Verified exact match |
| Waitlist | `players` WHERE `status='waitlisted'` | Ordered, requeue-to-tail |

### 3.8 State coverage matrix

| Screen/Surface | Loading | Ready | Error | Empty |
|--------|---------|-------|-------|-------|
| Browse card (bot) | N/A (inline message) | ✅ Session summary card | ✅ "Kèo này không còn" | ✅ "Chưa có buổi chơi nào" |
| Final confirm (linked) | — | ✅ Confirm gate + price | ✅ "Giá đã đổi — xem lại" | ⚪ N/A |
| Final confirm (unlinked) | — | ✅ Link/Pay-now choice | ✅ "Lỗi — thử lại" | ⚪ N/A |
| Payment hold | ✅ Creating hold... | ✅ QR + countdown | ✅ "Hết hạn — cuối hàng" | ⚪ N/A |
| Post-confirm (active) | — | ✅ Venue + payment status | — | ⚪ N/A |
| Post-confirm (waitlisted) | — | ✅ Position + no venue | — | ⚪ N/A |
| Link handoff | ✅ "Đang mở Plexco..." | ✅ Web binding page | ✅ "Link hết hạn" | ⚪ N/A |
| Free/Full/Approval | — | ✅ Appropriate CTA | ✅ "Lỗi — thử lại" | ⚪ N/A |

---

## 4. Use cases


| ID | Actor | Hành động | Kết quả |
|---|---|---|---|
| CBF-UC-1 | Guest | Xem session qua Messenger/Zalo | Nhận summary aggregate, không link wall |
| CBF-UC-2 | Linked player | Confirm paid session còn chỗ | Active + exactly-one charge; pay later |
| CBF-UC-3 | Unlinked player | Chọn pay-now | Hold 15 phút; verified full settlement mới active |
| CBF-UC-4 | Unlinked player | Chọn link | Web handoff → binding → resume/reconfirm |
| CBF-UC-5 | Player | Join free session | Active không cần link/payment |
| CBF-UC-6 | Player | Join full session | Waitlisted không link/payment/venue |
| CBF-UC-7 | Player | Request approval session | Pending request; không thu trước |
| CBF-UC-8 | Host/System | Approve request | Chạy capacity + link/pay decision table tại thời điểm approval |
| CBF-UC-9 | Waitlisted player | Được mời khi có slot | Linked activate; unlinked paid nhận 15-minute offer |
| CBF-UC-10 | Player | Link trên Page/OA thứ hai | Explicit endpoint-bound link; không auto-link xuyên endpoint |
| CBF-UC-11 | System | Nhận duplicate callback | Trả current outcome; không double player/charge/allocation |
| CBF-UC-12 | Player | Payment thiếu/dư/đến muộn | Thiếu hoặc muộn không auto-book; dư được allocate tối đa amount due và phần còn lại vào unmatched/manual review |

---

## 5. Edge cases và copy

| Nhóm | Case | Hành vi |
|---|---|---|
| Concurrency | Hai user tranh final slot | Session lock + live holds: đúng một active/hold; người còn lại waitlisted |
| Concurrency | Link callback và payment callback cùng lúc | Một finalizer thắng; callback còn lại idempotently gắn/allocate vào outcome hiện hành, không tạo booking thứ hai |
| Data integrity | Session/price/capacity đổi trong lúc link | Recheck; hiển thị delta và require reconfirm |
| Financial | Underpay/overpay/wrong currency | Underpay/wrong currency không finalise; overpay chỉ allocate amount due rồi giữ phần dư unmatched/manual review |
| Financial | Payment đến sau hold expiry | Không auto-book kể cả còn slot; route manual review/refund-or-credit |
| Financial | Payment provider timeout | Giữ trạng thái tới expiry nếu chưa có negative proof; không giả paid |
| Delivery | Hold đã commit nhưng bot không gửi được payment display | Definite pre-delivery reject → cancel hold + release slot nếu chưa có payment evidence/finalizer claim; timeout/unknown → giữ resumable hold tới TTL vì user có thể đã nhận |
| Identity | Channel identity đã merge sang Person khác | Re-resolve current Person; stale intent fail closed hoặc resume bằng binding mới sau explicit confirm |
| Identity | Account tồn tại nhưng email/provider chưa verified | Không đủ linked-for-deferred-payment |
| Privacy | User chưa active hỏi venue/roster | Chỉ area + aggregate counts |
| Cross-feature | Existing `left` / prior charge/refund | Dùng DD-49 disposition; unknown → review, adapter không tự tính |
| Cross-feature | Restricted/banned/ineligible | Reject trước mọi hold/charge/payment request |
| Infra | Tenant không có real-time exact settlement capability | Ẩn pay-now; offer Link Plexco / mở web; không nhận manual proof |

Copy lỗi phải nói trạng thái và bước tiếp theo, không đổ lỗi kỹ thuật:

- “Giá vừa thay đổi từ 100.000đ thành 120.000đ. Xem lại và xác nhận nhé.”
- “Chỗ giữ thanh toán đã hết hạn. Bạn vẫn ở danh sách chờ và đã được chuyển về cuối hàng.”
- “Plexco chưa xác minh được khoản chuyển này. Chỗ chưa được xác nhận; đội hỗ trợ sẽ xử lý hoàn/credit nếu cần.”

---

## 6. Analytics

| Event | Khi nào | Payload no-PII |
|---|---|---|
| `channel_session_viewed` | Summary render | channel, session_ref, linked, fee_class, capacity_state |
| `channel_booking_gate_shown` | Final gate | channel, linked, path_options |
| `channel_link_started` | Mở handoff | channel, source, provider_path |
| `channel_link_completed` | Binding thành công | channel, method, resumed |
| `channel_payment_hold_started` | Hold được tạo | channel, ttl_bucket, amount_bucket |
| `channel_payment_settled` | Exact payment verified | channel, latency_bucket |
| `channel_booking_completed` | Active/waitlisted/pending | channel, outcome, path |
| `channel_booking_expired` | Intent/hold expiry | channel, stage |
| `channel_booking_manual_review` | Late/wrong payment | channel, reason_code |

Không log raw platform UID, email, tên, token/link code, nội dung message, bank reference hay exact account number.

---

## 7. Acceptance criteria

- [ ] Messenger và Zalo cho browse time, area, fee display, confirmed count và slots available mà không cần link.
- [ ] Exact venue chỉ trả sau active; roster/debt không xuất hiện trong browse response.
- [ ] Free session confirm được khi unlinked; full/approval flow không thu tiền sai thời điểm.
- [ ] Linked paid booking active + exactly-one canonical charge và không cần pay ngay.
- [ ] Unlinked paid booking chỉ active sau verified full settlement; overpay allocate tối đa amount due, QR/“Tôi đã trả” không phải proof.
- [ ] Payment hold 15 phút chiếm admission capacity nhưng không tạo player/charge/venue trước settlement.
- [ ] Payment-display delivery failure phân biệt definite reject với ambiguous timeout; chỉ definite-undelivered mới cancel/release ngay, ambiguous giữ resumable hold tới TTL.
- [ ] Expired waitlist offer release slot, audited requeue-to-tail và tiếp tục selector.
- [ ] Link handoff bound exact channel identity + endpoint + session/action, single-use/TTL; resume luôn recheck live.
- [ ] Facebook Login↔PSID và Zalo Login↔`from.id` không auto-link bằng provider/name.
- [ ] One finalizer bảo đảm no duplicate player/charge/allocation dưới replay và link/payment race.
- [ ] DD-49 rejoin, DD-41 eligibility, DD-42/DD-52 restriction và DD-45 promotion vẫn do shared core quyết.
- [ ] Pay-now chỉ enable khi connector/market/currency/entitlement chứng minh real-time exact settlement; fallback fail closed.

---

## 8. Open questions và changelog

### Open questions

Không còn product question trong scope. DD-14/DD-15, Meta App Review và payment-provider availability là enablement gates; chúng không đổi decision table hay dark-runtime contract.

### Changelog

| Date | Version | Thay đổi |
|---|---|---|
| 2026-08-12 | v1.3 | **SessionCard upgrade (Playo reference #2):** Bot card thêm urgency text ("⚠️ Chỉ còn N chỗ!" khi ≤3 slots, text-only), skill range format ("Người mới – Trung bình"). 2 fields mới. Bot platform limited (không pill/badge). |
| 2026-08-12 | v1.2 | **Unified SessionCard data alignment (Playo-inspired):** Bot session browse card sync với unified `SessionCard` fields: time range (`HH:mm – HH:mm, DD/MM`), `N/M Going` count (thay `Confirmed count`), price format VND + "/Người", thêm skill level tag (legacy text). Không đổi CTA/flow — bot platform limited. |
| 2026-08-10 | v1.1 | **A-grade upgrade:** thêm Entry points table (6 entries); bump version. Không đổi contract/decision table. |
| 2026-07-28 | v1.0 | Reopen + chốt DD-32 Option D: browse tự do; final confirm linked→pay later, unlinked paid→verified pay-now; free/full/approval exceptions; 15-minute capacity hold; waitlist promotion/requeue; exact account-link predicate; provider fail-closed. |
| 2026-07-19 | v0.8a | Metadata/implementation reconciliation; Option A soft funnel. Superseded by v1.0/DD-32 Option D. |
| 2026-07-15 | v0.3 | DD-32 Option A: guest book free/paid. Superseded by v1.0. |
| 2026-07-06 | v0.1 | Khởi tạo channel-first funnel Draft. |
