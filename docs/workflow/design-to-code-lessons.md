> **📌 Ported from Sporta** (2026-08-09) — Adapt cho Plexco context trước khi sử dụng. Xem `docs/expert/README.md` cho context mapping.

# Design-to-Code — Bài học rút ra

> Tổng kết từ 4 lần iterate Home Screen (V1→V4) — 2026-02-25

---

## 1. Code từ trí nhớ = sai ~30%

**V1 (port 5174):** Code hoàn toàn từ trí nhớ, không tham khảo bất kỳ tài liệu nào.

| Sai | Chi tiết |
|-----|----------|
| Tab bar style | Tự sáng tạo floating pill — design dùng flat border-top |
| Icon system | Dùng emoji (🔍🏸🏆) — design dùng SVG |
| Spacing | `padding: 10px 14px` thay vì `12px 14px` |
| Radius | `14px` thay vì `16px` |
| Layout | Avatar bên phải — design đặt bên trái |

**Bài học:** KHÔNG BAO GIỜ code UI từ trí nhớ. Luôn có spec document.

---

## 2. Một nguồn tham khảo ≠ pixel-perfect

**V2 (port 5173):** Chỉ đọc `tailwind-mapping.md` → đạt ~90%.

**V3 (port 5175):** Chỉ copy `home-screen-final/` folder → đạt ~80%.

| Version | Nguồn | Accuracy | Thiếu gì |
|---------|-------|----------|----------|
| V2 | 1 doc (mapping) | ~90% | Icon cụ thể, decorative elements |
| V3 | 1 folder (code sẵn) | ~80% | CTA icon, avatar stack, SVG icons |
| **V4** | **3 nguồn** | **~98%** | Chỉ thiếu icon Scan (đã fix nhờ user feedback) |

**Bài học:** Accuracy tỷ lệ thuận với số nguồn cross-reference. Cần ≥2 nguồn.

---

## 3. Emoji ≠ Icons

Emoji render khác nhau trên mỗi OS/browser, thiếu chuyên nghiệp.

| | Emoji | Lucide SVG |
|---|---|---|
| Consistency | ❌ Khác trên iOS/Android/Chrome | ✅ Giống nhau mọi nơi |
| Size control | ❌ Không chính xác px | ✅ `size-4` = 16px exact |
| Stroke | ❌ Không điều chỉnh được | ✅ `strokeWidth={2.2}` |
| Color | ❌ Fixed bởi OS | ✅ Tự chọn `text-[#6200EE]` |

**Bài học:** Luôn dùng Lucide React (hoặc icon library tương tự). KHÔNG dùng emoji làm icon UI.

---

## 4. Mapping doc cần bổ sung 5 thứ để đạt 100%

Hiện tại mapping doc đạt ~93%. Cần thêm:

### 4.1 Icon Map (quan trọng nhất — +3%)

```markdown
| Vị trí | Lucide Icon | Size | Color |
|--------|-------------|------|-------|
| Badge "SẮP DIỄN RA" | Zap | 12px | #DFFF00 |
| CTA "Thanh toán" | Scan | 14px | #121212 |
```

### 4.2 Decorative Elements (+1%)

```markdown
- Hero: circle overlay 200px, -right-10 -top-10, bg white/6%
- Divider: h-1px bg white/10%
```

### 4.3 Sample Data (+0.5%)

```markdown
| Field | Value |
|-------|-------|
| User name | Huy Nguyen |
| Karma | 92 / 100 |
```

### 4.4 Asset/Avatar Specs (+0.5%)

```markdown
| Element | Fallback |
|---------|----------|
| User avatar | Initials gradient from-[#6200EE] to-[#9D46FF] |
| Avatar stack | 4 circles, size-7, border-2, -space-x-1.5 |
```

### 4.5 Micro-interactions (+0.5%)

```markdown
| Element | Effect |
|---------|--------|
| Buttons | active:scale-95 transition-transform |
| Cards | active:scale-[0.98] cursor-pointer |
```

---

## 5. Workflow chuẩn (đã áp dụng cho V4)

```
.pen file ──→ tailwind-mapping.md ──→ code
   (verify)       (guide)              ↓
                                   pixel-perfect-handoff.md
                                       (cross-check)
```

### Hierarchy nguồn dữ liệu

| # | Nguồn | Vai trò | Accuracy |
|---|-------|---------|----------|
| 🥇 | `.pen` file | Source of truth | 100% |
| 🥈 | `tailwind-mapping.md` | Guide cho dev | ~93% |
| 🥉 | `pixel-perfect-handoff.md` | Spec cho QA | ~90% |
| 4️⃣ | Code sẵn | Tham khảo, có thể sai | ~80% |

---

## 6. JSDoc = Audit trail

Mỗi component nên ghi rõ nguồn tham khảo:

```tsx
/**
 * HeroNextSession
 * Source: mapping §6 + handoff §4.3-B
 * .pen verified: radius 24, gradient 135deg, shadow 0 8 28
 */
```

Lợi ích: khi debug sai lệch, biết ngay giá trị nào lấy từ đâu.

---

## Checklist cho screen mới

- [ ] Đã đọc `.pen` file (`get_variables` + `batch_get`)
- [ ] Đã đọc `tailwind-mapping.md` (hoặc tạo mới nếu chưa có)
- [ ] Đã cross-verify bằng `pixel-perfect-handoff.md`
- [ ] Mapping doc có **Icon Map** cho mọi icon position
- [ ] Mapping doc có **Sample Data**
- [ ] Dùng **Lucide SVG** (không emoji)
- [ ] Mỗi component có **JSDoc** ghi source
- [ ] Screenshot verify ở viewport **430×932**
