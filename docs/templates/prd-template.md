> **📌 Ported from Sporta** (2026-08-10) — Adapt placeholders cho Plexco context trước khi sử dụng.

# {PROJECT_NAME} — Product Requirement Document (PRD)

> Copy file này vào folder project và thay `{PROJECT_NAME}`, `{product-name}` bằng tên thực tế.

> [!NOTE]
> **PRD dành cho stakeholders/user non-tech.**
> Viết bằng ngôn ngữ đơn giản, mô tả feature từ góc nhìn người dùng.
> KHÔNG dùng thuật ngữ kỹ thuật (API, database, component, schema, endpoint...).
> Chi tiết kỹ thuật nằm ở TDD — không nằm ở đây.

---

## 1. Tổng quan sản phẩm

- **Tên:** {product-name}
- **Mục tiêu:** {Sản phẩm này giúp người dùng làm gì? — 1-2 câu đơn giản}
- **Đối tượng:** {Ai sẽ dùng sản phẩm này?}

---

## 2. Tiến độ tổng quan

> **Cập nhật bảng này sau mỗi phiên implement.**
> Công thức: `% = (số feature ✅) / (tổng features trong version) × 100`

| Version | Tổng features | ✅ Xong | 🔧 Đang làm | 🔲 Chưa bắt đầu | Tiến độ |
|---------|--------------|---------|-------------|-----------------|---------|
| **v1 — MVP** | {N} | {n1} | {n2} | {n3} | {n1/N × 100}% |
| **v2 — Nâng cấp** | {N} | {n1} | {n2} | {n3} | {n1/N × 100}% |
| **v3+ — Tương lai** | {N} | — | — | {N} | 0% |

**Ký hiệu trạng thái feature:**

- ✅ = Hoàn thành (đã implement + QA pass)
- 🔧 = Đang triển khai
- 🔲 = Chưa bắt đầu
- ❌ = Huỷ bỏ (không implement, ghi lý do)

---

## 3. Chi tiết Feature

> Mỗi feature có **1 file riêng** trong folder `docs/`.
> File chi tiết: `docs/F{N}-{tên-feature}.md` (tự tạo từ template `.agents/templates/feature.md`)

### 🟢 v1 — MVP

| # | Tính năng | Mô tả ngắn | Chỉ số đo lường | File | Trạng thái |
|---|-----------|------------|-----------------|------|------------|
| F1 | {Tạo kèo mới} | {Nhập tên, chọn người, chọn ngày} | {< 30 giây} | [F1](docs/F1-tao-keo-moi.md) | 🔲 |
| F2 | {Ghi nhận thanh toán} | {Vuốt tên → thanh toán} | {1 vuốt, < 2s} | [F2](docs/F2-ghi-nhan-thanh-toan.md) | 🔲 |
| F3 | {Xem lịch sử} | {Danh sách kèo đã xong} | {Load < 1s} | [F3](docs/F3-xem-lich-su.md) | 🔲 |

**Tiến độ v1: 0/3 = 0%** ░░░░░░░░░░

### 🔵 v2 — Nâng cấp

| # | Tính năng | Mô tả ngắn | Chỉ số đo lường | File | Trạng thái |
|---|-----------|------------|-----------------|------|------------|
| F4 | {Hoàn tác thanh toán} | {Vuốt trái → undo} | {< 2 giây} | [F4](docs/F4-hoan-tac-thanh-toan.md) | 🔲 |
| F5 | {Nhắc nợ} | {1 chạm → copy tin nhắn} | {1 chạm} | [F5](docs/F5-nhac-no.md) | 🔲 |

**Tiến độ v2: 0/2 = 0%** ░░░░░░░░░░

### ⚪ v3+ — Tương lai

| # | Tính năng | Mô tả ngắn | Chỉ số đo lường | File | Trạng thái |
|---|-----------|------------|-----------------|------|------------|
| F6 | {Thống kê chi tiêu} | {Biểu đồ theo tháng} | {Render < 2s} | [F6](docs/F6-thong-ke.md) | 🔲 |

**Tiến độ v3+: 0/1 = 0%** ░░░░░░░░░░

---

## 4. Chỉ số đo lường (Success Metrics)

> Mỗi chỉ số phải đo được, có ngưỡng cụ thể, và gắn với version.

### Chỉ số sản phẩm (Product-level)

| # | Chỉ số | Mô tả | Mục tiêu v1 | Mục tiêu v2 | Đạt? |
|---|---------|-------|------------|------------|------|
| M1 | {VD: Thời gian hoàn thành tác vụ chính} | {Mở app → xong việc chính} | {< 30 giây} | {< 15 giây} | 🔲 |
| M2 | {VD: Tỉ lệ lỗi} | {Lỗi / tổng lần sử dụng} | {< 5%} | {< 2%} | 🔲 |
| M3 | {VD: Tốc độ tải trang} | {Trang hiển thị hoàn chỉnh} | {< 2 giây} | {< 1 giây} | 🔲 |
| M4 | {VD: Tỉ lệ quay lại} | {Dùng lại trong 7 ngày} | {> 30%} | {> 50%} | 🔲 |

### Chỉ số theo feature

| Feature | Chỉ số | Ngưỡng đạt | Đạt? |
|---------|---------|-------------|------|
| F1 | {Tạo kèo xong trong bao lâu?} | {< 30 giây, ≤ 5 bước} | 🔲 |
| F2 | {Thanh toán mất mấy thao tác?} | {1 vuốt, < 2 giây} | 🔲 |
| F3 | {Lịch sử load bao lâu?} | {< 1 giây, scroll 60fps} | 🔲 |

> [!TIP]
> **Cách viết chỉ số tốt:**
>
> - ✅ "Tạo kèo xong trong < 30 giây" (cụ thể, đo được)
> - ✅ "Thanh toán chỉ cần 1 thao tác" (rõ ràng, kiểm chứng được)
> - ❌ "App chạy nhanh" (mơ hồ, không đo được)
> - ❌ "UX tốt" (chủ quan, không có ngưỡng)

---

## 5. Cách thức tương tác chính

> Mô tả cách người dùng thao tác với sản phẩm — bằng ngôn ngữ đơn giản.

| Thao tác | Mô tả | Ở đâu? | Thuộc version |
|----------|-------|--------|---------------|
| {VD: Vuốt sang phải} | {Thanh toán chuyển khoản} | {Trang chính, Chi tiết kèo} | v1 |
| {VD: Vuốt sang trái} | {Thanh toán tiền mặt} | {Trang chính, Chi tiết kèo} | v1 |
| {VD: Chạm vào tên} | {Mở menu hành động} | {Danh sách người chơi} | v2 |
| {VD: Nhấn giữ} | {Chọn nhiều người cùng lúc} | {Danh sách người chơi} | v2 |
| {VD: Kéo xuống} | {Làm mới dữ liệu} | {Mọi trang} | v1 |

---

## 6. Điều kiện hoàn thành (Definition of Done)

### v1 hoàn thành khi

- [ ] Tất cả features v1 đạt trạng thái ✅ (100%)
- [ ] Tất cả chỉ số M1–M4 đạt ngưỡng v1
- [ ] Giao diện tốt trên điện thoại (375px) và máy tính (1440px)
- [ ] Dữ liệu lưu lại sau khi đóng app
- [ ] Không có lỗi crash khi sử dụng bình thường
- [ ] QA pass (xem `{product-name}-QA-run-{N}.md`)

### v2 hoàn thành khi

- [ ] v1 vẫn ổn định (regression pass)
- [ ] Tất cả features v2 đạt trạng thái ✅ (100%)
- [ ] Tất cả chỉ số M1–M4 đạt ngưỡng v2
- [ ] Các thao tác mới hoạt động mượt

---

## 7. Câu hỏi cần xác nhận

> Liệt kê những điểm cần stakeholder/user xác nhận trước khi triển khai.

| # | Câu hỏi | Trả lời | Ảnh hưởng feature |
|---|---------|---------|-------------------|
| 1 | {VD: Phương thức thanh toán gồm những gì?} | {CK + Tiền mặt} | F2 |
| 2 | {VD: Có cần export dữ liệu không?} | {Chưa — v3+} | F10 |

---

## PRD Change Log

| Date | Change | Lý do |
|------|--------|-------|
| {YYYY-MM-DD HH:mm} | Tạo PRD | Khởi tạo từ BRD + Research |

---

## Quy trình cập nhật tiến độ

> [!IMPORTANT]
> **Sau mỗi phiên implement, BẮT BUỘC cập nhật PRD:**
>
> 1. Đổi trạng thái features đã xong: 🔲 → 🔧 → ✅
> 2. Tính lại % trong dòng "Tiến độ vX" bên dưới mỗi bảng feature
> 3. Cập nhật bảng "Tiến độ tổng quan" (Section 2)
> 4. Kiểm tra chỉ số đo lường (Section 4) — đánh dấu ✅/❌
>
> **Progress bar visual:**
>
> - 0%: ░░░░░░░░░░
> - 30%: ███░░░░░░░
> - 60%: ██████░░░░
> - 100%: ██████████

---

## Template Change Log

| Date | Change | Lý do |
|------|--------|-------|
| 2026-02-22 14:01 | Thêm tracking tiến độ: bảng tổng quan (Section 2), cột Trạng thái trong feature tables, progress bar visual, quy trình cập nhật | Để biết mỗi version hoàn thành bao nhiêu % |
| 2026-02-22 13:58 | Thêm Section "Chỉ số đo lường" với product-level KPIs và per-feature metrics | PRD phải đảm bảo đo lường được |
| 2026-02-22 13:55 | Viết lại cho non-tech audience, thêm "Cách thức tương tác" và "Câu hỏi cần xác nhận" | PRD dành cho stakeholders |
| 2026-02-22 13:52 | Tạo template prd.md | Thêm PRD vào build-product workflow |
