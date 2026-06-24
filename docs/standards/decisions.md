# Decision Log (ADR-lite) — Plexco

> Nguồn sự thật duy nhất cho các quyết định thiết kế/kỹ thuật. Gom từ `core/BRD.md §16 (Open Decisions)` và `core/TDD.md §11 (Open Questions)`.
> Khi chốt một quyết định ở đây, cập nhật trạng thái và xoá khỏi "Open" ở BRD/TDD (giữ một nguồn).

## Quy ước

- **Trạng thái:** ✅ Chốt · 🟡 Đề xuất (chờ xác nhận) · ⬜ Mở (chờ chọn) · 🔗 Phụ thuộc ngoài
- **ID:** `DD-NN`. DD-01..DD-10 kế thừa OD-1..OD-10 (BRD). DD-11+ là quyết định chỉ có trong TDD.
- Mỗi mục: Bối cảnh → Quyết định → Lý do → Hệ quả.

## Bảng tổng hợp

| ID | Quyết định | Trạng thái | Phase | Nguồn |
|---|---|---|---|---|
| DD-01 | SĐT verified (share-contact) là khoá merge chính | ✅ Chốt | P3.5 | BRD OD-1 · TDD Q6 |
| DD-02 | `pay_code` lưu trần trong DB, hiển thị có prefix CLB | 🟡 Đề xuất | P3 | BRD OD-2 · TDD Q3 |
| DD-03 | Pricing/tier subscription host | ✅ Chốt | P5 | BRD OD-3 · TDD Q4 |
| DD-04 | Hosting PostgreSQL — HA+PITR+Singapore chốt; Neon vs Supabase còn lại | 🟡 Đề xuất | P0 | BRD OD-4 · TDD Q2 · `deployment-infra.md §2` |
| DD-05 | Join cross-club: open vs approval | 🟡 Đề xuất | P4.3 | BRD OD-5 · TDD Q8 |
| DD-06 | Độ chi tiết vị trí public: area vs venue | 🟡 Đề xuất | P4.3 | BRD OD-6 · TDD Q9 |
| DD-07 | Web realtime: SSE + fan-out qua `LISTEN/NOTIFY` | ✅ Chốt | P4 | BRD OD-7 · TDD Q7 · `deployment-infra.md §2` |
| DD-08 | Danh sách môn khởi điểm + taxonomy trình độ | ⬜ Mở | P0 | BRD OD-8 |
| DD-09 | Messenger vào lộ trình lúc nào | ✅ Chốt | P4.8 | BRD OD-9 |
| DD-10 | Web stack — cùng container (không Vercel) chốt; Express SSR vs Next standalone còn lại | 🟡 Đề xuất | P4 | BRD OD-10 · TDD Q1 · `deployment-infra.md §2` |
| DD-11 | Zalo Premium + add-on managed (owner >3 CLB) | 🔗 Phụ thuộc ngoài | P4.7 | TDD Q5 |
| DD-12 | Public read model: bảng projection vs materialized view | 🟡 Đề xuất | P4.3 | TDD Q10 |

---

## DD-01 — SĐT verified là khoá merge chính · ✅ Chốt

- **Bối cảnh:** Một người thật xuất hiện ở nhiều kênh (Telegram/Zalo/web); cần tránh gán nhầm tiền/merge sai (AUDIT C1/C2/C4/C5).
- **Quyết định:** Dùng số điện thoại đã verified qua share-contact làm khoá định danh chính để merge `Person`.
- **Lý do:** SĐT verified là tín hiệu định danh mạnh nhất, người dùng kiểm soát được; giảm rủi ro merge nhầm so với tên/username.
- **Hệ quả:** Luồng claim/merge bắt buộc bước verify SĐT; kênh không cấp SĐT verified chỉ link mềm cho tới khi verify.

## DD-02 — `pay_code` lưu trần, hiển thị có prefix · 🟡 Đề xuất

- **Bối cảnh:** Mã đối soát chuyển khoản cần dễ đọc cho player nhưng phải match bền ở backend.
- **Quyết định:** Lưu code **trần** trong DB; **hiển thị** kèm prefix CLB (vd `BMC-xxxx`).
- **Lý do:** Match đối soát ổn định không phụ thuộc cách hiển thị; prefix chỉ là lớp trình bày giúp người dùng nhận diện CLB.
- **Hệ quả:** Parser webhook strip prefix trước khi match; cần test edge case người dùng gõ kèm/không kèm prefix.
- **Còn lại:** Chốt cuối format prefix.

## DD-03 — Pricing/tier subscription host · ✅ Chốt

- **Bối cảnh:** Cần pricing rõ cho host subscription theo giá trị kênh sử dụng.
- **Quyết định:** 4 tier theo tháng/CLB:
  - `free_web` — **0đ**: Web app.
  - `telegram` — **79.000đ**: Web app + bot Telegram.
  - `plus_channel` — **159.000đ**: Web app + bot Telegram + **1 kênh chọn thêm**: Zalo hoặc Messenger.
  - `all_channels` — **199.000đ**: Web app + bot Telegram + bot Zalo + bot Messenger.
- **Lý do:** Giữ cửa vào miễn phí cho web app, monetization tăng theo số kênh chat mà host cần vận hành.
- **Hệ quả:** Billing phải version plan/tier; entitlement channel gate theo plan. Messenger vẫn theo P4.8/post-MVP, quyền Messenger chỉ unlock khi kênh GA.
- **Còn lại:** Chốt lifecycle timing riêng (trial/past_due/suspended ~ 14/7 ngày — TDD Q4) và chính sách cancellation/refund/credit.

## DD-04 — Hosting PostgreSQL · 🟡 Đề xuất (đã thu hẹp)

- **Bối cảnh:** Cần chọn nhà cung cấp Postgres managed.
- **Đã chốt:** Managed Postgres **HA + PITR**, **region Singapore (ap-southeast-1)**. Railway PG chỉ dùng dev/staging (PITR/HA yếu cho hệ tiền).
- **Còn lại:** **Neon** (branching hợp CI migration gate; nhưng scale-to-zero xung đột pg-boss → phải tắt autosuspend) vs **Supabase** (RLS-native, Supavisor pooler sẵn).
- **Tiêu chí:** Hỗ trợ RLS, pooler, branching/backup, chi phí, độ trễ region.
- **Hệ quả:** RPO/RTO chốt sau khi chọn provider; bắt buộc restore drill định kỳ. Quyết định sớm (P0); không đổi domain model.
- **Chi tiết:** `deployment-infra.md §2 (DD-04)`.

## DD-05 — Join cross-club: open vs approval · 🟡 Đề xuất

- **Bối cảnh:** Player join kèo từ marketplace xuyên CLB.
- **Quyết định (đề xuất):** Cấu hình **per-kèo**, mặc định **open**, host có thể bật **approval**.
- **Lý do:** Cân bằng tốc độ lấp slot (open) và quyền kiểm soát của host.
- **Hệ quả:** Thêm field cấu hình ở session; state machine join có nhánh chờ duyệt.

## DD-06 — Độ chi tiết vị trí public · 🟡 Đề xuất

- **Bối cảnh:** Lộ địa điểm chính xác ra public gây rủi ro riêng tư/spam.
- **Quyết định (đề xuất):** Public chỉ hiện **khu vực/quận**; lộ **venue chính xác** sau khi join/được duyệt.
- **Lý do:** Bảo vệ host/venue, vẫn đủ thông tin để player quyết định join.
- **Hệ quả:** Public projection whitelist field theo trạng thái join.

## DD-07 — Web realtime · ✅ Chốt

- **Bối cảnh:** Web cần cập nhật slot/đối soát theo thời gian thực.
- **Quyết định:** **SSE**, fan-out qua Postgres **`LISTEN/NOTIFY`** (không Redis/broker). Worker `NOTIFY` sau projector; mỗi `web` replica `LISTEN`.
- **Lý do:** Nhu cầu chủ yếu một chiều server→client; SSE đơn giản hơn WebSocket, tốt hơn polling về độ trễ/chi phí.
- **Hệ quả:**
  - Listener SSE cần **session/direct connection riêng** (`DATABASE_URL_LISTEN`) vì txn-mode pooler không hỗ trợ `LISTEN`.
  - Post-write read của user đã auth nên đọc **primary** (read-your-writes) để tránh lệch với event — xem `deployment-infra.md §5.2`.
  - Cần endpoint stream + reconnect; size memory theo số connection; tier thấp fallback polling.
- **Chi tiết:** `deployment-infra.md §2 (DD-07)`.

## DD-08 — Môn khởi điểm + taxonomy trình độ · ⬜ Mở

- **Bối cảnh:** `Sport` là chiều dữ liệu của kèo; cần chốt danh sách môn ban đầu và thang trình độ.
- **Gợi ý:** Cầu lông, pickleball, … + taxonomy trình độ chuẩn hoá.
- **Hệ quả:** Ảnh hưởng schema/seed sớm (P0) và filter discovery.

## DD-09 — Messenger vào lộ trình · ✅ Chốt

- **Quyết định:** Messenger là **post-MVP, phase P4.8**.
- **Lý do:** Ưu tiên Telegram/Zalo/web cho MVP; Messenger thêm sau khi canonical store + sync ổn định.
- **Hệ quả:** Thiết kế giữ surface-agnostic; chi tiết ở `appendices/messenger-channel-design.md`.

## DD-10 — Web stack · 🟡 Đề xuất (đã thu hẹp)

- **Bối cảnh:** Chọn framework cho web app.
- **Đã chốt:** Web chạy **trong cùng container/monolith**, **không** tách lên Vercel (giữ SSE long-lived + webhook durable + pg-boss sống được; giảm đầu mối vận hành).
- **Còn lại:** **Express SSR** vs **Next.js standalone/custom-server**.
- **Lý do:** Contract API/DTO không đổi dù chọn stack nào → có thể chốt muộn (P4).
- **Hệ quả:** Chỉ ảnh hưởng tầng channel adapter web.
- **Chi tiết:** `deployment-infra.md §2 (DD-10)`.

## DD-11 — Zalo Premium + add-on managed · 🔗 Phụ thuộc ngoài

- **Bối cảnh:** Khi owner quản >3 CLB/tài khoản có thể chạm giới hạn Zalo OA.
- **Trạng thái:** Cần xác nhận với Zalo về Premium/giới hạn + mô hình add-on managed.
- **Hệ quả:** Ảnh hưởng pricing host nhiều CLB (P4.7); chặn bởi câu trả lời từ Zalo.

## DD-12 — Public read model · 🟡 Đề xuất

- **Bối cảnh:** Marketplace cần đọc public nhanh, không lộ tiền/PII.
- **Quyết định (đề xuất):** Bảng `public_sessions` cập nhật qua **projector** (thay vì materialized view).
- **Lý do:** Kiểm soát field whitelist & thời điểm cập nhật rõ ràng; tách read model khỏi canonical.
- **Hệ quả:**
  - Sync engine có projector ghi `public_sessions`; cần đảm bảo nhất quán cuối.
  - **Bảo mật:** role `readonly` (process `discovery`) **chỉ `GRANT SELECT` trên `public_sessions`/public view, zero grant bảng canonical tiền/PII** → cô lập cross-tenant ở **tầng quyền**, không phụ thuộc RLS. Xem `deployment-infra.md §4/§6`.

---

## Changelog

| Ngày | Version | Thay đổi |
|------|---------|----------|
| 20/06/2026 | v1.0 | Khởi tạo decision log; gom OD-1..OD-10 (BRD §16) + Open Questions (TDD §11) thành DD-01..DD-12 |
| 20/06/2026 | v1.1 | Đồng bộ với `deployment-infra.md`: DD-07 → ✅ Chốt (SSE+`LISTEN/NOTIFY`); DD-04 & DD-10 → 🟡 đã thu hẹp; thêm ghi chú grant scope `readonly` vào DD-12 |
| 20/06/2026 | v1.2 | Chốt DD-03 pricing 4 tier: free web, 79k Telegram, 159k thêm Zalo/Messenger, 199k tất cả |
