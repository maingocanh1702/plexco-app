# Proposal — T1 (cột `Để…` cho UC table) + T7 (NFR ref trong AC)

> **Trạng thái:** 🟡 Đề xuất — chưa áp · 2026-08-14
> **Loại:** Planning artifact. **KHÔNG** phải spec Reviewed, không authorize coding.
> **Nguồn:** `../research/template-comparison-2026-08-14.md` v2.1 §4.1 (T1, T7)
> **Target file:** `../templates/feature-spec-template.md` (Product/UX spec template) — **chỉ 1 file**
> **Patch kèm theo:** `uc-benefit-nfr-ref-2026-08-14.patch` (2 hunk, `git apply --check` sạch)

---

## 0. Vì sao là patch chứ không sửa thẳng

Lúc soạn (2026-08-14), `docs/templates/feature-spec-template.md` đang mang thay đổi **chưa commit**
của lane `docs-debt-2026-08-13` (thêm `### Entry points`, README v2.65). `CLAUDE.md` quy định
**1 writing slice = tối đa 1 writer**. Sửa thẳng lúc này là writer thứ hai trên cùng file.

Patch được sinh **against working-tree state hiện tại** — tức là bản **đã có** Entry points — nên nó
apply sạch ngay sau khi lane docs-debt land, không cần rebase thủ công.

---

## 1. T1 — Cột `Để… (benefit)` trong §2 Use Cases

### Vấn đề

UC table hiện 4 cột `ID | Actor | Hành động | Kết quả`. **25/26** FE spec dùng đúng format này
(ngoại lệ: `feature_notifications_reminders.md`). Không có chỗ nào ghi **vì sao** UC tồn tại, nên
reviewer không có điểm tựa để challenge "UC này có cần không?" — chỉ kiểm được nó mô tả đúng hay sai,
không kiểm được nó đáng làm hay không.

### Thay đổi

```diff
-| ID | Actor | Hành động | Kết quả |
-|---|---|---|---|
+| ID | Actor | Hành động | Để… (benefit) | Kết quả |
+|---|---|---|---|---|
```

Kèm guidance: đọc thành *"Là {Actor}, tôi muốn {Hành động} **để** {benefit}"* — và nếu benefit chỉ
lặp lại Hành động thì UC đó đang thiếu lý do, không phải thiếu chữ.

### Phạm vi áp

- **Spec mới:** bắt buộc.
- **Spec đang `Reviewed`:** **không** sửa hồi tố. Bổ sung khi spec đó được sửa lần kế — cùng cơ chế
  README đã dùng cho uplift v2.33 ("spec hiện có bổ sung khi được sửa lần kế").
- **Không** đổi status/scope/contract của spec nào.

---

## 2. T7 — Subsection `### NFR compliance` trong §6 Acceptance Criteria

### Vấn đề

Catalog NFR **đã tồn tại và đủ tốt** — `BRD.md` §8 (NFR-S1..S7 / NFR-P / NFR-PF / NFR-R) và bảng
`NFR-1..N` của `TDD.md` có cột Metric đo được. Gap không nằm ở catalog mà ở **chiều ngược lại**:
feature spec không trỏ về NFR nào, nên audit "feature X có tuân NFR-S2 không" phải đọc thủ công.

> ⚠️ Bản v1 của doc so sánh từng đề xuất tạo `NFR-requirements.md` riêng. **Đã loại** — đó là dựng
> catalog thứ ba song song với khái niệm đã có, đúng thứ `CLAUDE.md` cấm. T7 là bản thay thế.

### Thay đổi

Thêm subsection cuối §6, sau `### Analytics`:

| NFR ref | Áp vào đâu trong feature này | Cách chứng minh |
| ------- | ---------------------------- | --------------- |

Cộng 2 checkbox, trong đó có: feature không chạm NFR nào → ghi rõ `none` + lý do, **không** để bảng
rỗng (bảng rỗng không phân biệt được "đã xét, không áp" với "chưa xét").

### Không làm gì

- Không định nghĩa NFR mới trong feature spec — chỉ trỏ ngược.
- Không đổi `BRD.md` / `TDD.md`.
- Không thêm section top-level thứ 8; đây là **subsection của §6**, count 7 section không đổi.

---

## 3. Cách áp (sau khi lane docs-debt land)

```bash
cd "<repo>"
git apply --check docs/proposals/uc-benefit-nfr-ref-2026-08-14.patch   # phải im lặng
git apply         docs/proposals/uc-benefit-nfr-ref-2026-08-14.patch
```

Sau khi apply, cập nhật kèm:

1. `docs/features/README.md` Document Convention — ghi cột `Để…` là bắt buộc cho UC table, và
   `### NFR compliance` là subsection §6 bắt buộc; **nói rõ count 7/6 không đổi** (cùng cách README
   v2.65 đã xử lý Entry points).
2. Changelog `docs/features/README.md` — thêm 1 dòng version.

Patch **không** tự làm 2 việc trên vì `README.md` cũng đang là hot file của lane docs-debt.

---

## 4. Việc chưa làm trong proposal này

| # | Hạng mục | Ghi chú |
| --- | --- | --- |
| T2 | §0 Tóm tắt 1 trang | Chưa soạn — cần chốt format trước |
| T3 | AC gắn gần UC | Chờ pilot 1 feature doc, đo có giảm review round không |
| T6 | Đẩy wireframe chi tiết xuống tầng FE Design spec | §3 chiếm 599/907 dòng ở Session Management. Cơ chế đã có (`templates/feature-dev/fe-spec-template.md`), chưa instance nào viết — đợi FE tới lượt dev |

---

## Changelog

| Ngày | Version | Thay đổi |
| --- | --- | --- |
| 2026-08-14 | v0.1 | Bản đầu — T1 + T7 dạng patch, chưa áp. Patch sinh against working tree có Entry points, `git apply --check` sạch. |
