# Plexco — GTM mới & Bài toán đối soát chuyển khoản

> Tài liệu quyết định, tổng hợp nghiên cứu ngày 30/06/2026. Mục đích: chốt kiến trúc kênh + đối soát cho mô hình "host connect club", và làm checklist đi hỏi sales.
>
> **Rev 30/06/2026 (sau review):** sửa nhãn gói ApiPay (BUSINESS↔ENTERPRISE), reframe GTM theo web/app-first, hạ payOS từ "default free" → "candidate pending sales" (P0 same-owner), tách reconcile thành add-on, thêm quyết định overflow Zalo.
>
> **Rev 10/07/2026 (DD-37 / BRD v3.4):** **bỏ Telegram** khỏi phạm vi; kênh phase-1 = **Zalo + Facebook Messenger + web**; Messenger **lên phase-1 (P2.5)**, không còn post-MVP. Auth phase-1 = Google/email (DD-13). Các bảng/nhãn "Telegram (MVP)" và "Messenger (post-MVP)" bên dưới đã cập nhật theo DD-37.
>
> **Rev 19/07/2026:** Messenger hybrid giữ nguyên. Authority hiện hành: `../standards/decisions.md` **v1.67** · BRD v3.9d · PRD v2.8c · TDD v3.1. Đây là tài liệu GTM lịch sử; khi lệch, ưu tiên authority hiện hành.

---

## 1. Tóm tắt GTM mới

> **Framing (đã chỉnh theo product direction):** Plexco là **web/app-first operations product**; chat (**Zalo + Facebook Messenger**; Telegram bỏ — DD-37) là kênh **acquisition + notification/deep-link**, KHÔNG phải sản phẩm chính. GTM đúng là *"vận hành trên web/app + thu hút & nhắc việc qua chat"*, không phải "chat là sản phẩm chính". Tham chiếu: `docs/product/PRD.md` (MVP = web app + Zalo + Facebook Messenger) và `docs/channels/web/ux-sync-design.md` (web/app là main product, bot = notification/deep-link adapter).

- **Acquisition qua chat giá rẻ:** cho host connect club qua **Zalo / Facebook Messenger**, chi phí rất thấp (từ ~70k/tháng) để kéo user vào — rồi **điều hướng nghiệp vụ chính về web/app**.
- **Upsell bằng tính năng vận hành:** tier trả phí cao hơn có tự động đối soát chuyển khoản của player và các tính năng khác.
- **Kết luận tài chính cốt lõi:** kênh chat gần như không tốn chi phí biên → gói 70k có biên tốt. Nhưng **đối soát là chi phí biến theo giao dịch/host**, dễ vượt 70k → phải tách thành **add-on/tier riêng** và chọn rail chi phí thấp.

---

## 2. Kiến trúc kênh chat

| Kênh | Thiết kế | Chi phí messaging |
|---|---|---|
| Zalo *(phase-1)* | **Mỗi host tự tạo & own 1 bot** qua Zalo Bot Platform, deploy trên hạ tầng Plexco | **Free (đang Beta)** |
| Messenger *(phase-1, P2.5)* | **1 App; central Plexco Page + optional Page per-club**; 24h/App Review | Central covers clubs without Page; optional branded endpoint; outside-window fail-closed |
| ~~Telegram~~ | **Bỏ khỏi phạm vi (DD-37 thay DD-09)** | — |

> Theo BRD v3.4/DD-37: surface phase-1 = **web app + Zalo + Facebook Messenger** (Telegram bỏ; Messenger P2.5). Web/app là workspace chính, bot chỉ giữ action cực ngắn + nhắc/deep-link.

**Lưu ý Zalo Bot Platform:**
- Mỗi tài khoản Zalo cá nhân tạo tối đa 3 bot free → quota tính trên từng host, không dồn về Plexco.
- Trần free: **50 user/bot** và **3.000 tin/tháng/bot** → host 3+ sân có thể vượt 50 player, cần xử lý tràn.
- **Rủi ro: đây là giá Beta.** Khi Zalo công bố pricing chính thức, chi phí có thể từ 0 → có phí. Không xây mô hình tài chính dựa trên "Zalo free mãi mãi".

**Quyết định cần chốt — overflow Zalo (host > 50 player/bot):** fallback theo thứ tự — (1) điều hướng player sang **web/app + Messenger** (đúng product direction, COGS ~0); (2) chỉ khi bắt buộc mới lên **Zalo OA/ZNS có phí** (200–800đ/tin). Mặc định KHÔNG mua ZNS để giữ biên; web/app là surface chính, Zalo bot chỉ là 1 kênh nhắc.

**Hệ quả:** cả 2 kênh chat + web ≈ 0đ messaging (Messenger free trong 24h) → chi phí kênh thực chất chỉ là **hạ tầng deploy**. Nên route thông báo (nhắc đóng tiền…) qua **web push + Zalo DM** (chính) + Messenger best-effort trong 24h + in-app để giữ free; tránh Zalo OA/ZNS (200–800đ/tin) khi không cần.

---

## 3. Chi phí hạ tầng (riêng — chưa gồm đối soát)

Giả định: 100 host ≈ 3.000 player ≈ ~120k tin/tháng; 1.000 host ≈ 30.000 player ≈ ~1,2tr tin/tháng. Tải dồn buổi tối.

**Kịch bản VPS/container**

| Thành phần | 100 host | 1.000 host |
|---|---|---|
| Compute (bot handler, Zalo multi-tenant) | $20–40 | $80–160 |
| Database (Postgres) | $15–30 | $60–120 |
| Cache/queue (Redis) | $10 | $20–40 |
| Storage + CDN | $5 | $15 |
| Bandwidth | $5 | $20–40 |
| Monitoring/logs | — | $20 |
| **Tổng** | **~$55–90 (~1,4–2,3tr đ)** | **~$215–395 (~5,4–9,9tr đ)** |

**Kịch bản Serverless** (rẻ hơn khi tải bursty): 100 host ~$20–50 (~0,5–1,3tr đ); 1.000 host ~$100–250 (~2,5–6,2tr đ).

**Quy ra/host:** ~12.000đ/host ở 100 host → ~6.000đ/host ở 1.000 host (lợi thế quy mô). So với 70k → biên hạ tầng rất thoải mái.

*Chi phí vận hành ẩn:* mỗi host 1 Zalo bot = nhiều token phải lưu/quản (bảo mật) + onboarding (host tự tạo & xác thực bot).

---

## 4. Chi phí đối soát chuyển khoản (riêng — biến theo giao dịch)

Giả định host 3+ sân: ~150 giao dịch vào/tháng. Đây là khối chi phí then chốt.

### 4.1 Hai mô hình giá

- **Trả theo giao dịch / slot** (apipay, Casso, SePay-API): chi phí **tăng theo số host** → tệ khi scale.
- **Rail chi phí ≈ 0, không tăng theo host** (payOS free, SePay app chia sẻ BĐSD, free bank tier): chỉ hạ tầng tăng → tốt khi scale.

### 4.2 So sánh provider (1 host, ~150 tx/tháng)

| Dịch vụ | Mô hình giá | Phí/giao dịch | ~1 host (150 tx) | Ghi chú |
|---|---|---|---|---|
| SePay VPBank PRO | Gói + tx vượt | ~640đ | ~96k | Không giới hạn số bank account |
| **SePay + VPBank free** | 500 tx/tháng free (năm 1) | ~0đ | **~0** | Mở VPBank qua mã giới thiệu |
| Casso Cơ bản | Thuê bao + trần tx | ~1.139đ hiệu dụng | ~170k | 1.139.000đ/th, ≤1.000 tx, 5 bank |
| apipay.vn | Theo gói, **không tính phí/tx** | 0đ/tx | = giá gói | Không tính cả giao dịch lỗi |

**Điểm hòa apipay (phẳng) vs SePay (per-tx):** ~100 tx/tháng (64.000 ÷ 640). Host > 100 tx → apipay rẻ & đoán trước được; < 100 tx → SePay/VPBank-free rẻ hơn.

### 4.3 Bảng giá apipay (theo số tài khoản bank, không giới hạn giao dịch)

| Gói | Giá/tháng | Số bank acc | Hiệu dụng/host-account |
|---|---|---|---|
| BASIC | 100k | 1 | 100.000đ |
| STARTER | 200k | 3 | 66.700đ |
| PRO | 400k | 5 | 80.000đ |
| TEAM | 700k | 10 | 70.000đ |
| BUSINESS | 1.700k | 25 | 68.000đ |
| ENTERPRISE | 3.200k | 50 | **64.000đ** |

> ⚠️ Nhãn gói theo trang ApiPay: **BUSINESS = 1.700.000đ / 25 acc**, **ENTERPRISE = 3.200.000đ / 50 acc**. Mức ~64k/host vẫn đúng ở 50 acc.

---

## 5. Bài toán mở rộng 100+ host & các rail thay thế

**Vấn đề:** mua lẻ gói ENTERPRISE (50 acc, 3,2tr) không scale — 100 host = ~2 gói = ~6,4tr/tháng, càng đông càng đắt. Cần rail **không tăng chi phí theo số host**.

### 5.1 Các rail scale được tới 100+ host

| Giải pháp | Chi phí tăng theo? | COGS @100 host | Việc host phải làm | Tin cậy |
|---|---|---|---|---|
| apipay ENTERPRISE (gom slot, 50 acc) | Số host | ~6,4tr/th | Chỉ link bank | Cao |
| SePay API (per-tx) | Số giao dịch | ~9,6tr/th | Link bank | Cao |
| **SePay app chia sẻ BĐSD** | Không | **~0** | Cài app + bật noti | Trung bình (phụ thuộc máy host) |
| **payOS free** (từ 23/01/2026) | Không | **~0** | Link bank (+VietQR) | ⚠️ Chờ xác minh* |
| **VPBank free (SePay)** | Không (năm 1) | **~0** | Mở VPBank | Cao |
| Reseller/wholesale deal | Số host (giá sỉ) | < retail | Link bank | Cao |

*⚠️ **P0:** FAQ payOS hiện chỉ cho thêm tài khoản **khớp tên chủ đã định danh** (same-owner), CHƯA hỗ trợ tài khoản chủ khác → **chưa dùng được làm rail aggregator nhiều host** cho bank do host sở hữu. Phải hỏi sales: có **delegated / multi-merchant / sub-account / partner model** không.

### 5.2 Mô hình "gom tài khoản" (platform aggregator)

Plexco sở hữu **1 tài khoản provider duy nhất**; mỗi host **link tài khoản bank của họ vào tài khoản Plexco**. Plexco đọc biến động của tất cả host qua 1 webhook trung tâm, route theo từng tài khoản. Host chỉ làm **1 thao tác link bank** (wizard 2–3 phút), không setup kỹ thuật.

> Ràng buộc bất biến: muốn đọc số dư host thì **tài khoản host phải được kết nối với sự đồng ý của chủ tài khoản** — không có đường tắt. Khác biệt giữa provider là thao tác link nặng hay nhẹ.

> **⚠️ P0 — mô hình aggregator CHƯA chứng minh, đặc biệt với payOS:** FAQ payOS hiện chỉ thêm được tài khoản **same-owner** (khớp tên cá nhân/doanh nghiệp đã định danh), không nhận tài khoản chủ khác → **chưa áp dụng được cho bank do host sở hữu**. Chỉ provider có **delegated / multi-merchant / sub-account / partner model** mới làm được aggregator nhiều host. Đây là câu hỏi sales số 1 trước khi cam kết bất kỳ rail nào.

---

## 6. Các dịch vụ tương tự payOS (link bank → webhook)

| Dịch vụ | Cơ chế | Chi phí | Bank cá nhân hỗ trợ | Hợp platform nhiều host? |
|---|---|---|---|---|
| **payOS** (của Casso) | VietQR + Virtual Account + Open Banking | Free (từ 23/01/2026) | MB, OCB, KienLongBank, ACB, BIDV | ⚠️ Chặn: FAQ chỉ **same-owner** — cần partner/sub-account model (P0) |
| **SePay** | API Banking + VietQR + webhook; có app chia sẻ BĐSD | Free tier + per-tx | VCB, BIDV, VTB, MB, ACB, VPBank, TPB, STB, MSB, OCB, KLB | Tốt — định vị reseller |
| **VietQR.io / api.vietqr.vn** | Napas VietQR + webhook/MQTT realtime | Low/free tier | Nhiều bank | Đáng thử, realtime tốt |
| Casso | VietQR + VA + Open Banking | Trả phí (~1,14tr+/th) | 10+ banks | Đắt khi đông host |
| apipay.vn | Open Banking, per-slot | 100k–3,2tr theo slot | MB, ACB, BIDV, OCB, VCB, TCB | Đắt khi đông host |

**Lưu ý:** payOS hỗ trợ cá nhân **không có VPBank**; rail VPBank-free nằm ở **SePay**. → Muốn payOS free thì steer host mở **MB/ACB/OCB**; muốn SePay free tier thì steer host mở **VPBank**. Chuẩn hóa về 1–2 bank có rail free để giảm cả chi phí lẫn ma sát onboarding.

**Virtual Account (VA) — pattern scalable nhất:** cấp số tài khoản ảo riêng cho từng host/player dưới 1 tài khoản mẹ → không cần kết nối tài khoản cá nhân từng host. Đánh đổi: thường cần tài khoản doanh nghiệp/merchant + tiền có thể đi qua tài khoản mẹ trước (custody + payout). Dùng được nếu host chấp nhận nhận tiền qua VA của Plexco.

---

## 7. Khuyến nghị kiến trúc

1. **Kênh:** web/app + Zalo bot per host + Messenger hybrid (central always, optional club Page; DD-65..68). Host/player capability parity trên Messenger; Telegram bỏ.
2. **Đối soát — tách 2 đường:**
   - **Candidate default (free, chờ xác minh sales):** ưu tiên rail đã rõ cơ chế — **SePay app chia sẻ BĐSD** / **VPBank free tier**; **payOS free** chỉ khi xác nhận có partner/multi-merchant model (P0). COGS ~0, scale 100+ host chỉ tăng hạ tầng.
   - **Cao cấp (managed, có phí):** host muốn "bao mượt" hoặc dùng bank không có rail free → gom apipay (ENTERPRISE)/SePay-API, charge add-on cao hơn để cover ~64k COGS.
3. **Pricing:** **base chat 70k** (biên tốt) **+ reconcile dạng ADD-ON 99–149k/tháng**, KHÔNG gộp thành 1 tier tổng. Lý do: COGS managed tốt nhất ~64k/host (ApiPay 50 slots) **chưa gồm** hạ tầng, support, onboarding, xử lý link lỗi, provider drift → nếu 99k là giá tổng (gồm cả chat) thì biên quá mỏng. Add-on tách bạch mới giữ an toàn biên.
4. **Onboarding:** chuẩn hóa host về 1–2 ngân hàng có rail free + wizard link bank. Truyền thông rõ: các dịch vụ này **read-only**, không rút/chuyển được tiền.

---

## 8. Checklist đi hỏi sales (payOS / SePay / apipay / VietQR.io)

1. Một tài khoản platform **quản được bao nhiêu tài khoản host**? Slot có được là **chủ khác nhau** không? **(P0 — payOS: FAQ ghi chỉ same-owner → hỏi rõ có delegated / multi-merchant / sub-account / partner model không.)**
2. Luồng host **link bank** trông thế nào — host non-tech làm được trong mấy phút?
3. Giá khi **vượt free tier** và ở **quy mô 100+ host** (có hợp đồng reseller/wholesale không)?
4. Danh sách **ngân hàng cá nhân** hỗ trợ + cá nhân hay buộc tài khoản doanh nghiệp?
5. **Độ tin cậy** khi máy host offline (với rail app chia sẻ BĐSD)?
6. payOS: bản chất Beta/giá free duy trì bao lâu, điều khoản đổi giá?

---

## 9. Số cần bạn cung cấp để siết mô hình P&L

- Player trung bình/host và **% host 3+ sân**.
- **Giao dịch trung bình/tháng/host** (quyết định chọn per-tx hay phẳng).
- **% host sẽ bật tính năng đối soát** (tier cao).
- Host có chấp nhận nhận tiền qua **VA của Plexco** không (quyết định có dùng được pattern VA).

---

*Nguồn: apipay.vn, sepay.vn (bảng giá, chia sẻ BĐSD, API ngân hàng), payos.vn, casso.vn, vietqr.io, zalo.solutions, zbot.com.vn. Các con số chi phí hạ tầng/đối soát là ước tính theo giả định nêu trong tài liệu — cần dữ liệu thực để chốt.*
