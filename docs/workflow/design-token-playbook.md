# Playbook — Build Design Tokens từ BRD

> **Ported from Sporta** (2026-08-10) — Adapted cho mọi project.
> **Nguồn gốc:** `Sporta/docs/design/design-token-playbook.md`
> **Quan hệ:** Nội dung này cũng nằm trong `brd-to-pen-playbook.md` §Bước 6. File này là phiên bản **standalone** — dùng khi chỉ cần refresh tokens mà không chạy lại toàn bộ BRD→.pen pipeline.

---

## 0) Ba nguyên tắc bất biến

1. **Mọi token phải trace về 1 dòng BRD hoặc 1 quyết định có log.** Token không trace được = gu cá nhân = xóa hoặc đưa vào Conflict Log để chốt.
2. **Một canonical duy nhất.** Chỉ 1 file là source of truth. Mọi file khác (`.css`, `.md`) là **bản export**, không sửa tay. Hai file cùng tự nhận "single source of truth" = drift chắc chắn xảy ra.
3. **Semantic theo vai trò, không theo màn hình.** `--bg-card`, `--text-on-accent` ✅. `--fab-icon`, `--time-badge-bg` ❌ — token per-screen phải là alias trỏ về core token.

---

## 1) Mine BRD — trích xuất "nhu cầu token" (chưa chọn giá trị)

Đọc BRD với **6 lăng kính**, ghi ra bảng **Token Needs**:

| # | Lăng kính | Tìm gì trong BRD | Ví dụ output |
|---|-----------|-------------------|-------------|
| 1 | **NFR / Ngữ cảnh sử dụng** | Môi trường, thiết bị, thời điểm dùng | `--touch-target: 48px`, contrast cao, light default |
| 2 | **Domain nghiệp vụ** | Loại dữ liệu đặc thù (tiền, thời gian, tỉ số) | Typography "Financial/Tabular" (`font-variant-numeric: tabular-nums`) |
| 3 | **Enum & State machine** ⚠️ quan trọng nhất | Mọi danh sách trạng thái, tier, phân loại | Mỗi state = 1 semantic token |
| 4 | **Danh mục sản phẩm** | Category chạy xuyên app | `--category-*` adaptive accents |
| 5 | **Personas** | Ai dùng, trình độ, tần suất | Touch target, motion speed, density |
| 6 | **Roadmap phases** | Feature tương lai cần "chừa chỗ" | Đặt tên nhóm token trước, chưa cần giá trị |

**Rule cho lăng kính 3:** quét BRD bằng câu hỏi *"chỗ nào liệt kê ≥2 trạng thái của cùng 1 thứ?"* — mỗi chỗ đó là 1 nhóm token bắt buộc.

**Output bước 1:** bảng Token Needs — mỗi dòng: `Nhu cầu | Nguồn BRD (section/FR) | Nhóm token dự kiến`.

---

## 2) Benchmark — chọn giá trị

BRD cho biết **cần gì**, không cho biết **giá trị bao nhiêu**. Chọn giá trị bằng benchmark 5–7 app cùng domain:

- Mỗi app ghi: primary, background, font, dark mode, đặc trưng.
- Rút insight dạng: *"pattern X xuất hiện ở N app → áp dụng/né"*.
- **Chọn primary NGƯỢC với đối thủ** để tạo nhận diện (heuristic, không phải luật).

**Output bước 2:** bảng benchmark + danh sách giá trị đề xuất cho từng token need.

---

## 3) Kiến trúc token — 3 lớp + theme dimension

```
Lớp 1 PRIMITIVE   (tùy chọn, khi hệ lớn): palette thô — purple-500, space-4
Lớp 2 SEMANTIC    (bắt buộc): vai trò — --primary, --bg-card, --success
Lớp 3 COMPONENT   (alias, không giá trị mới): --tab-active: var(--primary)
```

- **Theme (light/dark) là dimension ngay từ ngày 1** — retrofit sau đắt gấp nhiều lần.
- Dark mode: desaturate 20–30%, pastel hóa, tăng opacity subtle.
- Token cặp `X` + `X-subtle` (bg nhẹ 12–15% opacity) cho mọi semantic color.
- Token `--text-on-X` cho mọi màu nền đậm.

### Checklist độ phủ (canonical phải chứa ĐỦ các nhóm này)

- [ ] Color core: primary/accent + hover/light/subtle
- [ ] Color semantic: success/warning/danger/info + subtle
- [ ] Color state-enum từ BRD (bước 1, lăng kính 3)
- [ ] Surface & text per theme: bg/bg-card/bg-elevated/bg-input/border/text/text-secondary/text-muted
- [ ] Category accents (nếu có danh mục xuyên app)
- [ ] Typography scale: font + size + weight + line-height + letter-spacing
- [ ] Spacing (`--space-*` theo grid 4/8pt) + Radius scale + Layout
- [ ] Elevation/shadow per theme
- [ ] Motion: duration + easing
- [ ] Effect đặc thù (glassmorphism, glow...) nếu style yêu cầu

---

## 4) Governance — chống drift

1. **Pipeline 1 chiều:** Canonical → export `.css`/`.md` (generate, có header "DO NOT EDIT").
2. **Conflict Resolution Log:** `Ngày | Mâu thuẫn | Quyết định | Lý do` (tham chiếu `decisions.md`).
3. **Change Log** mỗi lần sửa token.
4. **Đổi thế hệ token = thay thế, không chồng thêm.**
5. Khi mâu thuẫn: **canonical thắng** — không "sửa cho khớp" bằng tay.

---

## 5) Verify trước khi dùng

- [ ] **Coverage check:** đối chiếu bảng Token Needs (bước 1) — mọi enum/state trong BRD đã có token?
- [ ] **Contrast WCAG AA** (≥4.5:1 text, ≥3:1 UI) cho mọi cặp text/bg ở CẢ 2 theme.
- [ ] **Sync check:** canonical ↔ exports cùng giá trị.
- [ ] Không còn token per-screen chứa giá trị mới (chỉ được alias).

---

## 6) Anti-patterns (đã xảy ra thật)

| Anti-pattern | Hậu quả | Phòng |
|---|---|---|
| 2+ file cùng nhận "source of truth" | 3 file 3 giá trị primary khác nhau | §4.1 — pipeline 1 chiều |
| Append thế hệ token mới không dọn cũ | Canonical chứa cả thế hệ cũ lẫn mới | §4.4 |
| Token per-screen từ screenshot | `--fab-icon` không tái dùng | §0.3 — chỉ alias |
| Bỏ qua enum trong BRD | States không có token → hardcode | §1 lăng kính 3 |
| Cập nhật 1 file quên file kia | Font mới vào `.md` nhưng không vào canonical | §3 checklist + §5 sync |
| Emoji làm icon | Render khác mỗi OS | §6 |
| Code UI từ trí nhớ | Sai ~30% | Luôn đọc từ source |

---

## Phụ lục — Template bảng Token Needs

| Nhu cầu | Nguồn BRD | Nhóm token | Trạng thái |
|---|---|---|---|
| {Trạng thái thanh toán} | {FR X (PENDING/CONFIRMED)} | {`--success`, `--warning` + subtle} | {✅/❌} |
| {Category xuyên app} | {§X} | {`--category-*`} | {✅/❌} |
| {Số tiền hiển thị} | {Module X} | {Typography Financial/Tabular} | {✅/❌} |

---

## Changelog

| Date | Version | Thay đổi |
|------|---------|----------|
| 2026-08-10 | 1.1 | Ported → Plexco: bỏ Sporta-specific examples, generalize cho mọi project |
| 2026-07-19 | 1.0 | Sporta original (DEPRECATED → merged vào brd-to-pen-playbook.md) |
