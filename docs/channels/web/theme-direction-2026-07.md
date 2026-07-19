# Theme Direction — Plexco Web (bright · modern · sporty)

> **Status:** 🟡 Discussion / chờ chốt hue+font (tool ✅ DD-81) · **Version:** 0.5 · 2026-07-19
> **Scope surface (DD-69):** UI **phase-1 = PWA** trên `apps/web` (mobile-first 375px, cài đặt được) — "web" là tên surface, không phải desktop-only. Native phase-2 tái dùng nguyên bộ token qua export JSON (`../../standards/token-needs-matrix.md` §6), không làm lại theme.
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
- **CẦN CHỐT:** (1) ⬜ hue A/B/C/D (hoặc phối, vd Volt Green primary + Lime accent); (2) ⬜ xác nhận font Sora+Inter; (3) ✅ **tool — chốt DD-81 (owner 19/07): Pencil, file `plexco-app-design.pen` tại root repo, git-tracked; variables khai khớp SoT ngay khi tạo.** (1)(2) chốt qua theme exploration trên chính file này (N variant frames màn Home + hero recipe §7).

## 6. Propagation path (sau khi chốt — thứ tự bắt buộc, theo playbook `../../templates/brd-to-pen-playbook.md` §1.2 + Bước 6D)

> ✅ Bước cũ "reconcile `channels/web/design-tokens.md`" đã làm xong 19/07 (DD-59 reconcile): file đó giờ là pointer, SoT duy nhất = `standards/design-tokens.md` v1.1. Mọi thay đổi giá trị từ đây chỉ đi 1 đường:

1. **Chốt quyết định** (hue A/B/C/D + font + tool file design) → ghi vào `decisions.md` (DD) trước.
2. **Ghi giá trị vào SoT** `../../standards/design-tokens.md` (hybrid — đổi giá trị, giữ cấu trúc; bump version + changelog + Conflict Resolution Log nếu đảo giá trị cũ).
3. **Cùng đợt, đóng gap từ BRD:** đối chiếu `../../standards/token-needs-matrix.md` — bổ sung tối thiểu: `--reconcile-unmatched`, usage-token layer (debt/sub/join/session), sports đủ 7 môn không trùng semantic, `--level-1..5`, `--touch-target`, Financial/tabular-nums, `--locked`/`--upgrade-accent`.
4. **Điền benchmark verdict** vào `../../standards/design-tokens-benchmark.md` (DD-59 — không bịa số liệu).
5. **File design mới:** khai báo variables trong `.pen` mới (hoặc Figma variables) **khớp SoT ngay khi tạo file** — không vẽ bằng literal rồi tokenize sau. Đánh dấu `Plexco-DS-fable5.pen` **superseded** trong `frontend-pipeline.md` + `designer-kickoff.md`.
6. **Code:** generate/`:root` CSS trong `apps/web` từ SoT (pipeline 1 chiều — code không tự thêm giá trị; hiện `apps/web` chưa có CSS token nên đây là cơ hội setup sạch từ đầu).
7. **Drift audit + WCAG gate trước khi dùng:** so SoT ↔ file design ↔ CSS ↔ representative components (playbook template §5.5); contrast WCAG AA cả light/dark — đặc biệt primary sáng (Lime/Pink cần chữ tối, đã note §5).

**Định nghĩa xong:** cả 7 bước hoàn thành trong cùng đợt chốt theme; không có trạng thái "đã đổi SoT nhưng chưa propagate".

## 7. Benchmark bổ sung — Sporta Home (internal, 19/07/2026)

> Nguồn: `Sporta/app-design-opus-4.6.pen` — màn Home có 8 variant cạnh nhau (Emerald final · Coral Orange · Ocean Blue · Teal · White BG · Dark · V2 ×2) + frame Loading/Empty riêng. Các recipe dưới đây **độc lập hue** — áp dụng được với bất kỳ candidate A–D nào khi chốt.

| # | Recipe | Giá trị tham khảo (trích từ .pen) | Đề xuất token hoá (ghi vào SoT khi chốt theme) |
|---|---|---|---|
| 1 | **Subtle-alpha pattern** — mỗi màu chức năng/sport có biến thể `-subtle` = chính màu đó @12% alpha (hex `1F`), dùng làm tinted icon container | `#EA580C1F`, `#2ECC711F`… xuyên suốt mọi card | `--{color}-subtle` cho primary/semantic/sport — đồng thời là nền cho usage-token layer (needs-matrix §1) |
| 2 | **Elevation mềm** — card không viền đậm: shadow thấp + hairline stroke | shadow `0 2px 10–16px #00000010` + stroke 1px `#00000008` | `--shadow-card` + `--border-hairline` (bổ sung cạnh `--shadow-sm..xl`) |
| 3 | **Hero gradient + glow cùng hue** — card tài chính/next-session nổi bằng gradient 3 stop + shadow cùng màu primary | gradient 135°: primary 0% → sáng hơn 60% → đậm hơn 100%; glow `0 8px 28px primary@25%` | `--gradient-hero` + `--shadow-glow` (công thức theo `--primary`, tự đổi khi chốt hue) |
| 4 | **CTA pill trắng trên gradient** — nổi bằng shadow trắng thay vì border | fill `#FFFFFF` + shadow `0 2px 12px #FFFFFF55` | component-level, không cần token mới |
| 5 | **Sport icon container** — nhất quán cho mọi card session | 48×48 · radius 12 · fill `--sport-{x}-subtle` + icon/emoji | dùng recipe #1; sports đủ 7 môn theo needs-matrix §2 |

**Data points cho các quyết định đang mở (§5):**

- **Hue:** Sporta chốt Emerald `#059669` làm final; variant **Coral Orange `#EA580C`** (được đánh giá đẹp) rất gần **candidate C · Energetic Orange `#FF5A1F`** — thêm một điểm tham khảo cho C nếu muốn hype/ấm. Lưu ý Strava `#FC5200` cùng vùng cam (benchmark §2 đã nêu).
- **Font:** Sporta body = **Plus Jakarta Sans** — trùng alternative đã list ở §3; heading Archivo Black là display nặng, không hợp hướng legibility-first (giữ đề xuất Sora + Inter).
- **⚠️ KHÔNG copy dải sport colors của Sporta:** `--sport-football #00E676` ≈ success-green, `--sport-tennis #CCFF00` ≈ accent lime — đúng lỗi trùng semantic mà needs-matrix §2 bắt tránh.
- **Workflow cho §6 bước 5 (file design mới):** như Sporta — layout làm component ref, nhân N frame variant chỉ override màu để so A/B/C/D cạnh nhau trong cùng file; và file design phải có đủ frame **Loading/Empty/Dark** như kỷ luật 4-states của feature spec, không chỉ happy path.

## 8. Governance bổ sung (từ `../../templates/design-system-playbook.md` v1.1)

- **Coverage matrix cho screens:** khi vẽ file design mới, lập matrix `state × role × device × theme` cho tổ hợp hợp lệ — screen dữ liệu động đủ Loading/Ready/Error/Empty + dark; static/confirmation/permission gate được `N/A + lý do` per ô. Không blanket, không tích Descartes.
- **Handoff mapping theo target stack:** Plexco phase-1 = PWA (`apps/web`) → `*-tailwind-mapping.md`/CSS mapping là **đúng stack** (khác Sporta — Flutter cần dart-mapping); `*-pixel-perfect-handoff.md` dùng chung. Native phase-2 (DD-69) → thêm platform mapping riêng từ token export JSON, không viết lại theme.
- **⬜ PROPOSAL — vị trí SSOT giá trị token khi có file design mới:** hiện DD-59 chốt SoT giá trị = `../../standards/design-tokens.md` (.md), file design phải khai variables khớp SoT ngay khi tạo + drift audit (§6 bước 5/7). Playbook chung khuyến nghị ngược lại: **giá trị sống trong file design**, `.md` chỉ giữ decision log + exports (generator + source revision). Nếu muốn theo playbook → cần **DD mới đảo DD-59** tại đợt chốt theme; chưa chốt thì giữ nguyên DD-59, không tự đổi. Ghi đây làm input cho founder-decision đợt theme.

## Changelog

| Ngày | Version | Thay đổi |
|------|---------|----------|
| 19/07/2026 | 0.5 | **DD-81 ✅ (owner):** tool = Pencil, file `plexco-app-design.pen` root repo — §5 điểm (3) resolved; còn ⬜ hue + font, chốt qua theme exploration trên chính file. SSOT giá trị vẫn theo DD-59 (§8 proposal giữ mở). |
| 19/07/2026 | 0.4 | §8 **Governance bổ sung** (design-system-playbook v1.1): coverage matrix `state × role × device × theme` cho file design mới; handoff mapping theo target stack (PWA → tailwind/CSS mapping đúng stack Plexco); ⬜ proposal vị trí SSOT giá trị token (giữ DD-59 .md-SoT vs đảo sang design-file-SoT theo playbook — chờ DD tại đợt chốt theme, không tự đổi). |
| 19/07/2026 | 0.3 | §7 **Benchmark Sporta Home** (internal, `app-design-opus-4.6.pen`): 5 recipe độc lập hue (subtle-alpha `-subtle`, elevation mềm shadow+hairline, hero gradient 135° + glow cùng hue, CTA pill trắng, sport icon container) + data points (Coral `#EA580C` ủng hộ candidate C; Plus Jakarta Sans trùng alternative §3; cảnh báo sport colors Sporta trùng semantic; workflow N-variant frames + đủ frame Loading/Empty/Dark). Sửa header version drift (0.1→0.3). Thêm header **Scope surface (DD-69)**: phase-1 = PWA `apps/web` mobile-first, native phase-2 tái dùng token qua export JSON. Vẫn 🟡 — giá trị chỉ vào SoT khi chốt theme theo §6. |
| 19/07/2026 | 0.2 | §6 → **propagation path 7 bước** (decision → SoT → token-needs gaps → benchmark → file design → code → drift audit + WCAG) với định nghĩa xong; ghi nhận reconcile channels/web đã hoàn thành 19/07 (DD-59, design-tokens.md v1.1). Vẫn 🟡 chờ chốt hue/font/tool. |
| 16/07/2026 | 0.1 | 🟡 Discussion brief — mục tiêu bright/modern/sporty, benchmark Strava+Playo, font Sora+Inter, 4 palette candidate (Volt Green/Lime/Orange/Pink), loại blue/cyan. Chờ chốt hue. |
