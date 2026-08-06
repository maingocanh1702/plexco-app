# Sporta payment UX → design input cho các surface chưa có owner

> **Loại:** design input, **non-authoritative**. Không phải spec, không phải contract, không authorize
> migration/route/UI/runtime. Consumer là owner tương lai của từng surface; mọi thứ dưới đây phải được
> reshape vào spec pair có gate riêng trước khi implement.
>
> **Ngày:** 2026-08-07 · Baseline `main@7e21f65dc4eff0fb845448d8c9a974bcb64f7edb`
> **Nguồn ý tưởng:** Sporta Phase-2 FE docs (external, sản phẩm khác) — xem
> `../research/sporta-payment-fe-port-analysis-2026-08-07.md` cho đối chiếu đầy đủ + quy tắc chuyển đổi.
> **Ranh giới:** DD-98 ✅ `DECISION_FINAL` (owner-delegated 2026-08-07) liệt kê các mechanic **không** port
> (NP-1..5: custom split · hold cho linked member · push kèm tiền/QR · auto-archive nợ · geo/radius —
> mâu thuẫn DD-06). File này không chứa chúng. DD-97 cũng đã ✅ direction + entitlement cùng ngày.
> **Dedup:** DD-99 own P2 session-detail FE · P3 account-management · P4 mark-paid/refund-on-cancel;
> `../research/sporta-fe-docs-gap-2026-08-07.md` đã track recent-searches (ADAPT) và FilterSheet
> preview-count/sort (GAP FE-level). File này không lặp lại các mục đó.

---

## §1 · Protected pay surface (đích của `status.payAction.href`)

**Owner hiện tại: CHƯA CÓ.** `feature_player_view_fe.md` chỉ pin CTA mở `href` (`open_protected_pay`);
surface hiển thị QR/STK/pay_code phía sau chưa có FE spec. Khi mở spec đó, các pattern sau đáng dùng:

| Pattern | Mô tả | Ràng buộc Plexco giữ nguyên |
|---|---|---|
| Tap-to-copy per field | STK · số tiền · nội dung CK, mỗi field 1 tap copy + toast xác nhận | Copy đúng giá trị server trả — không dựng lại/format lại thành giá trị mới |
| Bank deep link | CTA chính "Mở app ngân hàng" auto-fill amount + nội dung CK | Deep-link map (BIN → app scheme) là server/config data; bank không hỗ trợ → fallback hiển thị full bank info text + copy từng field |
| QR-fail fallback | QR render/generation fail → fallback text đủ 3 field + retry | Fail-closed: không render QR từ pay_code ở client (negative scope player_view_fe giữ nguyên) |
| Live settle status | "Đang chờ thanh toán…" → settle → trạng thái xác nhận (có thể confetti) + số tiền từ response | SSE (DD-07) + reconnect → authenticated refetch; polling chỉ bounded theo owner policy; badge "Đang kết nối lại"; không client state transition — mọi chuyển trạng thái từ canonical response |
| Latency indicator | "Xác nhận tự động trong X.Xs" (optional, nice-to-have) | X do server đo/trả; không đo ở client rồi trình bày như con số hệ thống |
| Cancel-at-bank edge | User quét QR rồi cancel trên banking app → không đổi state, retry không giới hạn | Đã đúng bản chất contract hiện tại (QR/“Tôi đã trả” không phải proof — CBF) |

Telemetry nếu có: bucket theo chuẩn CBF (`amount_bucket`, không raw amount/PII).

## §2 · Host reminder-policy config UI (họ A17 preferences / F11, sau F0)

**Owner hiện tại: CHƯA CÓ FE spec.** BE contract đã pin đủ knob (NTF v3.11); UI chỉ trình bày, không
sinh policy mới. Wireframe hướng theo Sporta AutoRemindConfigScreen, reshape:

```
┌──────────────────────────────┐
│ Nhắc nợ tự động      [toggle]│   ← entitlement `reminders_auto` (host_pro, DD-40);
│                              │      thiếu entitlement/availability → SURFACE ABSENT
│ Ngưỡng nhắc: (policy server) │   ← escalation thresholds mặc định 2h → 24h (NTF-UC-2);
│                              │      KHÔNG hardcode 6h/12h/24h kiểu Sporta
│ Giờ yên tĩnh: 22:00 – 07:00  │   ← tenant timezone (spec :95), không device-local
│                              │
│ Preview: "Nhắc kế: (server)" │   ← server tính; FE không tự tính schedule
│                              │
│ [Nhắc thủ công…]             │   ← manual remind = preview eligible/excluded trước gửi
│                              │      (NTF-UC-1); override cooldown require reason (NTF-UC-6)
│ [Xem delivery report →]      │   ← sent/failed/skipped/unknown (NTF-UC-9)
└──────────────────────────────┘
```

Ràng buộc bắt buộc khi author spec thật:

- Toàn bộ HTTP DTO `UNPINNED` (A17/F11 chưa build) → tới lúc đó mọi thứ là design target, không fetch.
- 4 states + error mapping fail-closed theo chuẩn FE template hiện hành.
- Không hiển thị per-player "đã nhắc N lần" kèm PII vượt quá delivery report contract.
- "Nhắc gộp" đa session **không** thiết kế ở đây — thuộc DD-88 `DEFERRED_PROPOSAL`.

## §3 · Hold countdown display (CBF bot hiện tại; web nếu funnel lên web)

Áp cho payment hold 15' của unlinked pay-now (DD-32 Option D) — **không** áp cho linked member (DD-98 NP-2):

- Nguồn thời gian duy nhất = server (`timeout_at`/TTL trong payment display). Client không tự đếm giờ
  làm authority; mất kết nối → refetch, không suy "còn X phút" từ timer local drift.
- Warning mốc <5' và <1' — web đổi màu; bot gửi nhắc mốc theo đúng budget message của funnel
  (không spam thêm attempt ngoài contract delivery hiện có).
- Expiry: thông điệp release + requeue-tail đúng CBF (candidate về cuối hàng, selector tiếp tục);
  không hứa "gia hạn" — contract hiện tại không có extend.
- Payment đến sau expiry: hiển thị đúng đường manual review/refund-or-credit đã pin, không tự nhận tiền.

## §4 · Thứ tự tiêu thụ đề xuất

1. Owner mở spec protected-pay surface → nhét §1.
2. F0 design authority xong + A17/F11 có DTO → §2 thành FE spec thật.
3. CBF display slice (bot) khi build funnel → §3.
4. DD-97 (statement/export) nếu owner ✅ → FE surface của nó tự có spec riêng, không dùng file này.

## §5 · Bổ sung vòng 2 (2026-08-07, sweep Phase-1 — phần chưa ai own sau DD-99)

### 5a · Bank setup — verify STK + auto-fill tên chủ TK

Consumer: tab "Ngân hàng" của `feature_settings_fe.md` (capability `bank_account.manage`, lifecycle
`no-row | connecting | registered | active | drift | error | revoked` giữ nguyên — mục này chỉ thêm UX
lớp nhập liệu, không đổi lifecycle):

- Nhập STK → debounce (server verify qua provider lookup) → auto-fill tên chủ TK, host xác nhận rồi lưu.
- Lookup fail vì STK sai → inline error "Số tài khoản không tồn tại"; lookup **service down** → cho nhập
  tên thủ công + warning "Chưa xác minh được STK" — fail-open chỉ cho *tên hiển thị*, không cho trạng
  thái verified: account chưa verify không được coi là `active`.
- Verify call đi từ server (không lộ API key client); rate-limit budget của provider là server concern.

### 5b · Gate "chưa có bank" khi tạo kèo có giá

Product rule chưa được pin ở đâu — **cần owner chốt trước khi vào spec** (`feature_sessions_fe.md`
create flow / `feature_session_management.md`): tạo kèo `price_amount > 0` khi tenant chưa có bank
account `active` → chặn fail-closed với screen giải thích + primary CTA "Thiết lập ngân hàng"
(→ settings tab Ngân hàng) + secondary CTA "Tạo kèo không thu tiền" (giữ flow, set free). Không chặn
kèo free. Nếu owner không muốn gate cứng: tối thiểu warning tại publish.

### 5c · Marketplace — giữ search state khi quay lại

Client-local: từ `/discover/:sessionId` back về `/discover` giữ nguyên keyword + filter + vị trí
scroll (in-memory, không persist storage — surface public nhưng vẫn không cache response vượt policy
hiện có). Bổ sung cho "Search behavior (Draft)" đã có trong `feature_marketplace_fe.md`.

### 5d · Candidate cần DD riêng (không thuộc file này)

- **Global search đa entity** (players/clubs như Sporta search overlay): đụng DD-47/48 profile
  visibility + public non-PII whitelist. Nếu owner muốn → DD mới; search sessions-only hiện tại của
  marketplace không bị chặn bởi mục này.
