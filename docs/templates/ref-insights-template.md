# Reference Insights: {product-name}

> Tham khảo từ: {ref-project-1}, {ref-project-2}, ...
> Ngày tạo: {YYYY-MM-DD HH:mm} (UTC+7)

---

## 1. Business Logic đáng tham khảo

| Từ project | Logic/Flow | Áp dụng cho {product-name} |
|------------|-----------|---------------------------|
| {ref} | {mô tả logic} | {cách áp dụng} |

---

## 2. Code Patterns tốt

| Từ project | Pattern | File tham khảo | Lý do nên dùng |
|------------|---------|---------------|----------------|
| {ref} | {pattern} | `{path/to/file}` | {lý do} |

---

## 3. UIUX & Design Insights

| Từ project | Element | Chi tiết | Áp dụng |
|------------|---------|---------|---------|
| {ref} | Color Palette | {primary, secondary, accent, neutral} | {cách dùng} |
| {ref} | Typography | {font-family, sizes, weights, line-height} | {cách dùng} |
| {ref} | Icons | {icon set, style: outlined/filled/rounded} | {cách dùng} |
| {ref} | Layout | {grid, sidebar, navigation pattern} | {cách dùng} |
| {ref} | Spacing | {padding, gap, margin system} | {cách dùng} |
| {ref} | Border & Radius | {border style, corner radius} | {cách dùng} |
| {ref} | Shadows | {box-shadow, elevation levels} | {cách dùng} |
| {ref} | Hover Effects | {hover states, cursor changes} | {cách dùng} |
| {ref} | Animations | {transitions, micro-animations, duration} | {cách dùng} |
| {ref} | Components | {buttons, cards, modals, forms, tables} | {cách dùng} |
| {ref} | Design Patterns | {bottom sheet, FAB, toast, empty state} | {cách dùng} |
| {ref} | Responsive | {breakpoints, mobile-first rules} | {cách dùng} |
| {ref} | Dark/Light Mode | {theme switching, CSS variables} | {cách dùng} |
| {ref} | Gesture Interactions | {swipe actions, long press, pull-to-refresh, tap-to-reveal} | {cách dùng} |

---

## 3.5 Interaction Patterns (BẮT BUỘC)

> [!CAUTION]
> **KHÔNG chỉ liệt kê file utility.** Phải mô tả CHI TIẾT cách interaction được sử dụng,
> ở NHỮNG MÀN HÌNH NÀO, và logic xử lý (auto-pay, reveal actions, snap back, etc.).
> Thiếu section này = risk bỏ sót core UX features khi implement.

### Gesture Interactions

| Pattern | Mô tả chi tiết | Màn hình sử dụng | File tham khảo | Logic xử lý |
|---------|----------------|-------------------|---------------|-------------|
| {VD: Swipe bidirectional} | {Vuốt phải → CK, vuốt trái → TM} | {Dashboard, Session Detail} | {`swipe.js`, `dashboard.js`} | {Auto-pay + fade-out animation, snapBack: false} |
| {VD: Swipe-to-reveal} | {Vuốt trái hiện Edit/Delete} | {Players list} | {`players.js`} | {Reveal 2 actions, tap outside to close} |
| {VD: Tap-to-action-menu} | {Chạm row → hiện context menu/bottom sheet actions} | {Players, Sessions} | {`players.js`} | {Show bottom sheet với Edit/Delete/Share options} |
| {VD: Long-press-to-select} | {Nhấn giữ ~500ms → bật multi-select mode} | {Players list, Sessions} | {`players.js`} | {Toggle checkbox UI, show batch action bar (Delete All, Export)} |
| {VD: Pull-to-refresh} | {Kéo xuống để refresh data} | {Sessions, Players} | {`pull-refresh.js`} | {Threshold 60px, fetch API + re-render} |
| {VD: Double-tap} | {Chạm 2 lần nhanh để toggle trạng thái} | {N/A} | {N/A} | {N/A} |

### Animation & Transition Patterns

| Pattern | Mô tả | Màn hình | Duration/Easing | Trigger |
|---------|-------|----------|----------------|---------|
| {VD: Row fade-out} | {Opacity 0 + maxHeight 0 khi thanh toán} | {Dashboard, Detail} | {0.3s ease} | {Sau API success} |
| {VD: Bottom sheet} | {Slide up từ bottom} | {All modals} | {0.25s cubic-bezier} | {User action} |
| {VD: Toast notification} | {Slide in + auto dismiss} | {Global} | {0.2s in, 2.5s hold, 0.15s out} | {API success/error} |

### Screen-Pattern Mapping

> BẮT BUỘC: Map rõ mỗi pattern xuất hiện ở màn hình nào để không bỏ sót khi implement.

| Màn hình | Patterns áp dụng |
|----------|-----------------|
| {Dashboard/Home} | {Swipe bidirectional, row fade-out, pull-to-refresh} |
| {Session/Match Detail} | {Swipe bidirectional, swipe-to-undo, row fade-out} |
| {Players list} | {Swipe-to-reveal (edit/delete), pull-to-refresh} |
| {Settings} | {Bottom sheet modal} |

---

## 4. Những điều cần tránh

| Từ project | Vấn đề | Ảnh hưởng | Cách tránh |
|------------|--------|----------|-----------|
| {ref} | {bug/issue} | {impact} | {solution} |

---

## 5. Feature Parity Checklist (BẮT BUỘC khi có ref-project)

> So sánh feature-by-feature giữa ref-project và product mới.
> Checklist này là INPUT cho BRD — mọi feature ✅ phải có section tương ứng trong BRD.

| # | Feature (từ ref-project) | Có trong {product-name}? | BRD Section | Ghi chú |
|---|------------------------|------------------------|-------------|----------|
| 1 | {VD: Swipe-to-pay bidirectional} | ✅ Có / ❌ Bỏ / 🔄 Adapt | FR-{X} | {Lý do nếu bỏ} |
| 2 | {VD: Hoàn tác thanh toán} | | | |
| 3 | {VD: Tap → action menu} | | | |
| 4 | {VD: Long-press → multi-select} | | | |
| 5 | {VD: Pull-to-refresh} | | | |
| ... | | | | |

**Quy tắc:**

- ✅ = Phải implement, phải có trong BRD
- ❌ = Không implement, ghi rõ LÝ DO. **Phải được user approve**
- 🔄 = Adapt/cải tiến, ghi rõ THAY ĐỔI GÌ

---

## 6. Tổng kết

- **Reuse trực tiếp:** {list — code/components copy được}
- **Adapt/cải tiến:** {list — cần sửa cho phù hợp}
- **Không áp dụng:** {list — lý do không phù hợp}

---

## Template Change Log

| Date | Change | Lý do |
|------|--------|-------|
| 2026-02-22 13:43 | Thêm Section 5: Feature Parity Checklist (BẮT BUỘC) — so sánh feature-by-feature ref vs product mới | MatchOS thiếu 5+ features vì không có bảng so sánh, chỉ liệt kê file |
| 2026-02-22 12:45 | Thêm Section 3.5 Interaction Patterns (BẮT BUỘC) với 3 bảng: Gestures, Animations, Screen-Pattern Mapping | MatchOS lesson: chỉ liệt kê file utility mà không phân tích interaction patterns → bỏ sót core UX features |
| 2026-02-22 12:48 | Bổ sung ví dụ Tap-to-action-menu và Long-press-to-select vào bảng Gesture Interactions | Cần ví dụ rõ ràng cho từng loại gesture, không chỉ swipe |
| 2026-02-22 10:47 | Tạo template ref-insights.md | Chuẩn hóa output cho research phase |
