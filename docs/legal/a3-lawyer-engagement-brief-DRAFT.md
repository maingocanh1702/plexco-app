# A3 — Brief mời tư vấn luật sư (data privacy VN) — DRAFT

> **⚠️ DRAFT — input cho luật sư, KHÔNG phải legal advice, KHÔNG phải authority.** Derived doc, suy từ
> live schema + docs đang commit (baseline `f2af39d6dba4c335f95a15ab7e8da46861f1400b`, nhánh `main`).
> Đi kèm chi tiết: **`a3-pii-data-class-matrix-DRAFT.md`** (ma trận từng bảng/cột).

## Plexco là gì

Nền tảng SaaS **multi-tenant** quản lý CLB thể thao & lịch chơi (kèo) tại **Việt Nam**. Mỗi CLB là một
"tenant" cô lập. Host (chủ CLB) quản kèo/roster/thu tiền/đối soát/nhắc; player tìm & tham gia kèo qua
marketplace và chat. Dữ liệu người dùng **được lưu trên PostgreSQL đặt tại Singapore** (DigitalOcean
Managed PG, VPC private — quyết định DD-04), dù người dùng và hầu hết bên xử lý ở VN.

## Các surface (nơi thu & hiển thị dữ liệu)

- **Web app** (`apps/web`): dashboard host, player view, marketplace discovery, đăng nhập
  (email+mật khẩu, Google OIDC), API.
- **Bot Zalo** (VNG): tương tác host/player qua tin nhắn OA/bot.
- **Messenger (Meta)**: kênh tin nhắn; Facebook Login (tương lai, chưa bật).
- **Notification**: nhắc/ xác nhận qua các kênh trên.
- **Telegram**: kênh **legacy**, đang trong kế hoạch gỡ bỏ.

## Luồng dữ liệu (ngôn ngữ thường)

1. **Định danh & đăng nhập:** người dùng cung cấp **email** (bắt buộc, verified) và/hoặc đăng nhập
   **Google**; hoặc được gắn từ kênh chat (Zalo/Messenger) qua mã liên kết một lần. SĐT **không thu**
   ở phase-1 (schema giữ cột dormant). Gender/DOB **optional**, chỉ thu khi CLB bật cấu hình.
   Tên/biệt danh lưu ở dạng đọc được để hiển thị roster.
2. **Tiền & đối soát:** host khai STK; hệ thống **ingest chuyển khoản (CK)** qua **SePay/ApiPay**
   (webhook). **Nội dung memo CK và payload gốc được lưu** — memo thường chứa **tên/SĐT người chuyển**
   (có thể không phải người dùng hệ thống). Sổ tiền (bank transaction/allocation) **immutable** — không
   sửa/xoá, chỉ điều chỉnh bằng bút toán đảo có chữ ký.
3. **Chat trong app:** tin nhắn CLB và **DM riêng tư** lưu **nội dung dạng đọc được**; có block/report
   (report có ô ghi chú tự do). Không hard-delete, chỉ ẩn/tombstone.
4. **Bên thứ ba xử lý:** DigitalOcean (hosting/DB/KMS, **Singapore**), SePay/ApiPay (CK, VN),
   Zalo/VNG (VN), **Meta** (Messenger, **US**), **Google** (đăng nhập, **US**), email provider (chưa
   chọn, đang OFF), LLM provider (chat assistant, hoãn tới sau). Chi tiết & cột: xem §7 ma trận.
5. **Retention hiện đang code:** audit tài chính 3 năm, identity 1 năm, session/auth 90 ngày, token
   30 ngày, sổ tiền bất biến. **Chưa có** đường export/xoá dữ liệu hướng người dùng (DSAR).
6. **Public:** marketplace chỉ lộ field whitelist (môn/giờ/khu vực/giá/slot/tên CLB/**tên host**);
   không bao giờ lộ tiền/PII/roster/STK/giới tính.

## Chúng tôi cần gì ở luật sư

Trả lời **15 câu hỏi** ở **§9 của ma trận** (`a3-pii-data-class-matrix-DRAFT.md`). Tóm tắt nhóm:

1. **Văn bản áp dụng** — NĐ 13/2023 (PDPD) hay Luật 91/2025 + NĐ 356/2025? (Q1)
2. **Căn cứ hợp pháp & consent** — cho từng lớp dữ liệu; cái nào bắt buộc consent tường minh; consent thu **ở đâu/khi nào/dạng gì** trên web + Zalo + Messenger. (Q2, Q10)
3. **Phân loại nhạy cảm** — gender/DOB, tài chính, nội dung chat, report, quan hệ block. (Q3)
4. **Bank memo** — căn cứ thu/giữ PII bên thứ ba trong memo CK; xử lý khi ledger bất biến vs quyền xoá. (Q4)
5. **Retention floors & DSAR** — sàn giữ tối thiểu theo luật; nghĩa vụ & thời hạn truy cập/xoá/export/rút đồng ý; ta chưa có pipeline. (Q5, Q6)
6. **Chuyển dữ liệu ra nước ngoài** — lưu ở Singapore + processor US: có cần hồ sơ đánh giá tác động & nộp ai; DPA với những bên nào. (Q7, Q8)
7. **Người vị thành niên** — nghĩa vụ consent giám hộ nếu có user chưa đủ tuổi. (Q9)
8. **Tài liệu & vận hành** — nội dung Privacy Policy/ToS; encrypted/hash có còn là PII; host name public; breach notification; controller vs processor giữa Plexco và CLB. (Q11–Q15)

## Vì sao gấp

A3 là **blocker phase-1** (DD-114 D5) và **lead-time luật sư là item dài nhất** trên critical path.
Mục tiêu phiên này: đủ tài liệu để **bắt đầu engagement trong tuần**. Kết quả tư vấn sẽ được ghi vào
`standards/decisions.md` (A3/USR-OQ-3/SEC-OQ-2) — **không** viết ngược vào các file DRAFT này.
