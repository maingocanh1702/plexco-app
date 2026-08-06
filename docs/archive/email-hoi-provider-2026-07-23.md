# Ba email hỏi provider — soạn 2026-07-23

Mục đích: mở đồng hồ đếm ngược cho các gate chỉ đóng được bằng câu trả lời của nhà cung cấp.
Gửi càng sớm càng tốt; nội dung đã viết để họ **trả lời được trong một lượt**, không phải hỏi lại.

Nguyên tắc khi soạn: hỏi cụ thể tới mức người trực support có thể trả lời mà không cần leo thang;
nêu rõ vì sao hỏi (để họ hiểu đây là câu hỏi kỹ thuật thật, không phải khảo sát); và **luôn hỏi
"nếu không có thì xác nhận là không có"** — vì im lặng không đóng được gate, còn một câu "chúng tôi
không áp chính sách này" thì đóng được.

Gate liên quan: `infra-egress-compatibility-evidence` (DD-04, cả ba email) ·
`apipay-signed-body-reconciliation` (P0, đường tiền — email #2) ·
`email-provider-c7-evidence` (gate C7 — chưa có trong 3 email này, xem ghi chú cuối).

---

## Email #1 — SePay

**To:** support SePay (kênh hỗ trợ kỹ thuật đang dùng)
**Subject:** Chính sách IP nguồn khi gọi API my.sepay.vn từ server — xin xác nhận

Chào đội ngũ SePay,

Chúng tôi đang hoàn thiện thiết kế hạ tầng cho hệ thống đối soát thanh toán và cần xác nhận
một điểm mà tài liệu công khai chưa nêu rõ. Hệ thống của chúng tôi gọi API `my.sepay.vn`
từ server (server-to-server, không qua trình duyệt).

Xin xác nhận giúp ba ý:

1. **SePay có áp chính sách nào theo địa chỉ IP nguồn của bên gọi API không?** Cụ thể, có yêu
   cầu hoặc hỗ trợ đăng ký/allowlist IP nguồn cho tài khoản merchant không? Nếu **không có**
   chính sách nào, xin xác nhận rõ giúp là không có — đây cũng là một câu trả lời hợp lệ với
   chúng tôi.
2. Nếu có: giới hạn bao nhiêu IP cho một tài khoản, đăng ký ở đâu, và **thời gian có hiệu lực**
   sau khi đăng ký?
3. Nếu IP nguồn của chúng tôi thay đổi (ví dụ khi đổi nhà cung cấp hạ tầng hoặc scale ra
   nhiều node), quy trình cập nhật ra sao và có gián đoạn dịch vụ trong lúc cập nhật không?

Lý do hỏi: chúng tôi cần chốt có triển khai sau một địa chỉ egress cố định hay không **trước khi**
xây dựng, vì quyết định này khó đảo ngược về sau.

Cảm ơn đội ngũ,
Ngoc-Anh — Bestminton / Plexco

---

## Email #2 — ApiPay ⚠️ QUAN TRỌNG NHẤT

Email này gộp **hai** câu hỏi thuộc hai gate khác nhau. Câu hỏi 2 là **P0 nằm trên đường tiền** —
nếu trả lời sai hướng, adapter webhook của chúng ta sẽ từ chối 100% callback hợp lệ.

**To:** support / onboarding ApiPay
**Subject:** Hai câu hỏi kỹ thuật trước khi tích hợp: IP nguồn outbound và cách tính ApiPay-Signature

Chào đội ngũ ApiPay,

Chúng tôi đang chuẩn bị tích hợp và có hai điểm cần xác nhận trước khi viết code, vì tài liệu
công khai chưa đủ để chốt.

**1. Chính sách IP nguồn khi chúng tôi gọi API của ApiPay**

Khi hệ thống chúng tôi gọi API ApiPay từ server, ApiPay có áp chính sách nào theo **IP nguồn** không
(yêu cầu allowlist, giới hạn số IP, hay ràng buộc nào khác)? Xin xác nhận cho **cả hai bề mặt**:
tích hợp enterprise và trường hợp dùng khoá do chúng tôi tự quản (BYO-key) — nếu hai bề mặt này
khác nhau về chính sách, xin nêu rõ từng bên. Nếu **không áp** chính sách nào, xin xác nhận giúp
là không có.

**2. `ApiPay-Signature` được tính trên đúng chuỗi byte nào?**

Đây là câu hỏi quan trọng nhất với chúng tôi. Tài liệu đưa ví dụ Node/Express tính:

```
crypto.createHmac("sha256", secretKey).update(JSON.stringify(req.body)).digest("hex")
```

tức là HMAC trên **body đã parse rồi serialize lại**, không phải raw bytes như gửi đi. Nhưng
`JSON.stringify` không phải một biểu diễn ổn định: thứ tự key, khoảng trắng và cách escape unicode
đều có thể khác giữa các ngôn ngữ và phiên bản. Nếu bên nhận dựng lại chuỗi khác một byte thì chữ ký
không khớp và **mọi callback hợp lệ đều bị từ chối**.

Xin xác nhận giúp:

- **(a)** Chữ ký được tính trên **raw request body đúng như ApiPay gửi đi**, hay trên chuỗi thu được
  sau khi parse rồi serialize lại?
- **(b)** Nếu là phương án **parse rồi serialize lại**, ApiPay dùng **canonical form** nào — thứ tự key,
  khoảng trắng, cách escape ký tự non-ASCII (tiếng Việt có dấu)?
- **(c)** Bên nhận nên verify bằng cách nào để **đảm bảo đúng 100%**, kể cả khi payload chứa tiếng
  Việt có dấu?
- **(d)** ApiPay có **replay/timestamp window** không (bao nhiêu giây), hay chữ ký không kèm ràng
  buộc thời gian?

Nếu có **môi trường sandbox**, xin cấp một test account cho phép chúng tôi cấu hình URL webhook của mình
và nhận ít nhất một event `transaction.in` thử. Chúng tôi sẽ lưu raw HTTP body cùng header
`ApiPay-Signature` (không bao giờ gửi secret) để tự đối chiếu HMAC. Xin xác nhận sandbox dùng **cùng**
representation được ký và cùng replay/timestamp behavior như production — nếu khác, xin nêu rõ khác ở đâu.

Cảm ơn đội ngũ,
Ngoc-Anh — Bestminton / Plexco

---

## Email #3 — Zalo Bot Platform

**To:** support Zalo Bot Platform
**Subject:** Chính sách IP nguồn khi gọi bot-api.zaloplatforms.com và giới hạn gửi tin

Chào đội ngũ Zalo,

Chúng tôi đang xây dựng bot cho câu lạc bộ thể thao, gọi `bot-api.zaloplatforms.com` từ server.
Xin xác nhận giúp hai điểm mà tài liệu chưa nêu:

1. **Chính sách IP nguồn:** Zalo Bot Platform có áp yêu cầu hoặc hỗ trợ allowlist **IP nguồn** của
   bên gọi API không? Nếu không có, xin xác nhận giúp là không có. Nếu có, xin cho biết giới hạn
   số IP, nơi đăng ký và thời gian hiệu lực.
2. **Giới hạn gửi tin:** bot có **hạn mức** nào về số tin nhắn (theo giây/ngày/tháng), số người
   nhận, hay phân tầng theo gói dịch vụ không? Nếu có, xin cho biết con số cụ thể và điều gì xảy ra
   khi vượt hạn mức (chặn tạm, tính phí, hay khoá).

Câu 2 giúp chúng tôi ước lượng đúng quy mô trước khi triển khai, tránh việc thiết kế xong mới phát
hiện chạm trần.

Cảm ơn đội ngũ,
Ngoc-Anh — Bestminton / Plexco

---

## Ghi chú

**Vì sao câu 2 của email #3 lại có mặt ở đây:** slice AP-24 hiện `ready` nhưng **chưa launch**, để tra
tài liệu về giới hạn tin nhắn. Nếu tài liệu im lặng khi slice chạy, nó sẽ HALT đúng luật — và thứ cần
khi đó chính là câu trả lời này. Hỏi kèm bây giờ tốn thêm ba dòng; hỏi sau khi AP-24 HALT thì mất thêm
một chu kỳ chờ.

**Gate C7 (nhà cung cấp email) chưa nằm trong ba email này** — vì chưa chọn nhà cung cấp. C7 cần:
(a) cam kết **idempotency phía upstream** bằng văn bản (header/tham số cụ thể, và hành vi khi timeout
hoặc crash mơ hồ); (b) DPA + vùng dữ liệu + retention + danh sách subprocessor; (c) SPF/DKIM/DMARC,
warm-up domain, xử lý bounce/complaint; (d) người chịu trách nhiệm + hạn chót + phương án dự phòng.
Ngay khi có provider shortlist/chốt được để hỏi, kick off C7 song song với thiết kế email: gửi (a) và
(b) cho sales/pháp lý, hỏi (c) với đội technical/deliverability, và chốt (d) nội bộ. (a) và (b) hầu như
luôn phải leo thang khỏi support tuyến 1; không đợi tới lúc build email delivery mới hỏi.

**Khi có trả lời:** giữ nguyên email/số ticket trong hệ thống riêng của owner, nhưng chỉ dán vào chat/repo
bản **đã redaction** (xóa API key, webhook secret, token, credential, dữ liệu tài khoản/PII không cần
thiết). Kèm nguồn/ticket, ngày nhận và phần trích dẫn đủ để quy chiếu; không thay bằng diễn giải không
có nguồn.

Sau đó mới đưa evidence vào đúng nơi: `environments-setup.md` §1.1 cho từng row DD-04 và
`webhook-verification-matrix.md` §3.2 cho ApiPay. Không chỉ “lật” backlog: AP-22 chỉ được promote khi
cả SePay, ApiPay (**enterprise và BYO-key**) và Zalo có evidence quy chiếu được; P0 ApiPay chỉ được
promote khi support xác nhận representation được ký hoặc sandbox capture raw body + `ApiPay-Signature`
cho kết quả HMAC xác định. Khi đó phải reconcile hai internal raw-body specs trước khi viết adapter.
