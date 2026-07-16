# Theme Direction — Plexco Web (bright · modern · sporty)

> **Status:** 🟡 Discussion / chờ chốt hue · **Version:** 0.1 · 2026-07-16
> **Mục đích:** doc trao đổi để chốt **màu chủ đạo + font** cho theme mới. Là input cho `../../standards/design-tokens-benchmark.md` (DD-59) → khi chốt sẽ ghi vào `../../standards/design-tokens.md`.
> **Cách tiếp cận:** **Hybrid** — giữ nguyên *cấu trúc* token (tên semantic, thang bậc), chỉ đổi *giá trị* (brand/accent/semantic + neutrals). Code map không đổi.

---

## 1. Mục tiêu & ràng buộc

- Theme phải **tươi sáng, hiện đại, trẻ trung, thể thao**. Bỏ hướng **Indigo → Deep Blue** cũ (trầm, corporate).
- **Blue/Cyan bị loại** — cảm giác "tin cậy/corporate" hơn là tươi-trẻ (feedback owner).
- **Font dễ nhìn hơn** — ưu tiên legibility, nhất là số/tiền.
- Giữ **dark mode** + đủ semantic (paid / pending / unpaid) + sport-accent.
- Design SoT chuyển sang **file design mới** (không dùng `Plexco-DS-fable5.pen` — đánh dấu superseded).

## 2. Benchmark (2 app tham khảo)

| App | Primary | Font | Vibe | Loại | Nguồn |
|---|---|---|---|---|---|
| **Strava** | `#FC5200` (cam) | UI sans; exact family **không được official guideline ở đây xác nhận** | Nhiệt, hype, data-heavy | Tracking/social | [official guidelines](https://developers.strava.com/guidelines/) · [font observation (third-party)](https://sensatype.com/what-font-does-strava-use-in-2026) · [color observation (third-party)](https://mobbin.com/colors/brand/strava) |
| **Playo** | ~teal-green (**xấp xỉ**) | Sans humanist | Tươi, cộng đồng, thân thiện | **Booking + community** (cùng ngành Plexco) | [playo.co](https://playo.co/) — *không công bố brand guide/hex chính thức* |

**Takeaways**
1. **Font:** **Inter cho body là đề xuất của Plexco** vì legibility và tabular-number support; nguồn official Strava đang cite không đủ để dùng Strava làm bằng chứng cho exact font family. Font brand riêng để dành nâng cấp thương hiệu sau.
2. **Màu — 2 cực đã bị "chiếm":** Strava cam (hype), Playo teal-green (fresh/community). Plexco là booking+community → **nếu chọn teal-green sẽ đụng Playo**; nên chọn hue **tách biệt** mà vẫn tươi-trẻ.
3. **Cấu trúc chung:** neutrals sạch + 1 primary mạnh + semantic rõ → khớp hướng hybrid.

## 3. Font direction

- **Body:** `Inter` (đã kiểm chứng qua Strava — số/tiền dễ đọc). Dùng `tabular-nums` cho tiền/slot.
- **Heading:** `Sora` (Google — hình học, khỏe, sporty, vẫn dễ đọc). *(Thay `Outfit` cũ trong `design-tokens.md`.)*
- **Alternatives cân nhắc:** `Plus Jakarta Sans` (1 font cho cả hai — mềm, đồng bộ, rất dễ đọc) · `Space Grotesk` (heading, tech-sporty hơn).
- **Đề xuất:** **Sora (heading) + Inter (body)**.

## 4. Palette candidates (bright · trẻ · sporty — no blue)

> Mỗi option = 1 bộ token đầy đủ (hex), sẵn sàng ghi vào `design-tokens.md`. Semantic dùng chung: `--success #16A34A` · `--warning #F59E0B` · `--danger #EF4444`.

| Token (role) | A · Volt Green | B · Electric Lime | C · Energetic Orange | D · Pink Punch |
|---|---|---|---|---|
| `--primary` | `#00C853` | `#9AE600` | `#FF5A1F` | `#FF2E93` |
| `--primary-hover` | `#00B24A` | `#8AD400` | `#E8480F` | `#EA1E82` |
| `--on-primary` (chữ trên nút) | `#062A18` (tối) | `#1A2E05` (tối) | `#FFFFFF` | `#FFFFFF` |
| `--accent` | `#B8FF00` (volt) | `#12D8A0` (mint) | `#FFB020` (amber) | `#C6FF00` (lime) |
| `--bg-page` (light) | `#F3FFF8` | `#FBFFEF` | `#FFF7F2` | `#FFF5FA` |
| `--bg-card` (light) | `#FFFFFF` | `#FFFFFF` | `#FFFFFF` | `#FFFFFF` |
| `--text-primary` (light) | `#0A1F14` | `#14210A` | `#22100A` | `#240C1A` |
| `--bg-page` (dark) | `#0B1510` | `#10140A` | `#170F0A` | `#170E14` |
| `--bg-card` (dark) | `#12201A` | `#1A2010` | `#221510` | `#22141C` |
| Vibe | Nike-energy, khỏe, an toàn cho app tiền | Gen-Z, bắt mắt (primary sáng → chữ tối) | Hype, ấm, cuốn | Trẻ, nổi bật, khác biệt nhất |

> **Đã loại (không tươi-trẻ):** bright-modern blue/cyan — Azure `#0B84FF`, Cyan `#00BCE0` (giữ lại đây để tra cứu lịch sử quyết định).

## 5. Đề xuất & câu hỏi mở

- **Đề xuất:** **A · Volt Green** (`#00C853`) — tươi-trẻ + sporty nhưng vẫn dễ dùng cho mảng lớn/nút tiền; hoặc **C · Orange** nếu muốn nhiệt/hype rõ. Font **Sora + Inter**.
- **Lưu ý dùng:** primary sáng (Lime/Pink) cần **chữ tối** trên nút + hạn chế phủ mảng lớn (dễ chói) — kiểm tra tương phản WCAG AA khi chốt.
- ⬜ **CẦN CHỐT:** (1) hue A/B/C/D (hoặc phối, vd Volt Green primary + Lime accent); (2) xác nhận font Sora+Inter; (3) tên/công cụ file design mới (`.pen` mới hay Figma).

## 6. Bước tiếp theo (sau khi chốt)

1. Ghi bộ token đã chọn vào `../../standards/design-tokens.md` (hybrid — đổi giá trị, giữ cấu trúc; bump version + changelog).
2. Điền `../../standards/design-tokens-benchmark.md` với dữ liệu Strava/Playo + verdict.
3. Trỏ **design SoT** sang file design mới; đánh dấu `Plexco-DS-fable5.pen` **superseded** trong `frontend-pipeline.md` + `designer-kickoff.md`.
4. Reconcile `channels/web/design-tokens.md` → trỏ về SoT (DD-59).

## Changelog

| Ngày | Version | Thay đổi |
|------|---------|----------|
| 16/07/2026 | 0.1 | 🟡 Discussion brief — mục tiêu bright/modern/sporty, benchmark Strava+Playo, font Sora+Inter, 4 palette candidate (Volt Green/Lime/Orange/Pink), loại blue/cyan. Chờ chốt hue. |
