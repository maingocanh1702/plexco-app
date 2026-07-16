# Pixel-Perfect Handoff — {Screen Name}

> **Template** — copy sang `docs/channels/web/handoff/<screen>-handoff.md` khi làm 1 màn mới.
> Nguồn: ported từ Sporta `docs/handoff/*-pixel-perfect-handoff.md`. Pipeline: `../../channels/web/frontend-pipeline.md`.
>
> **Screen:** {tên} · **Node/frame:** `{node_or_frame_id}` · **Source:** `{tracked_pen_path_or_figma_url}`
> **Status:** Draft | Reviewed · **Version:** 0.1 · {YYYY-MM-DD}
>
> ⚠️ **Chỉ ghi giá trị ĐỌC ĐƯỢC từ visual source đã chốt — KHÔNG suy đoán.** Thiếu → đo lại.

---

## 1. Frame gốc (canvas)
- width × height: `{W} × {H}` px
- background: `{#hex}` → token `var(--{token})`
- breakpoints áp dụng: mobile `{375}` · tablet `{768}` · desktop `{1024}` (theo `design-tokens.md §8`)

## 2. Design tokens bắt buộc dùng
> Liệt kê token đã có trong `design-tokens.md`. Giá trị chưa có token → thêm token trước, KHÔNG hardcode.

- **Colors:** `var(--primary)` `{#hex}` · `var(--surface)` `{#hex}` · `var(--text)` `{#hex}` · …
- **Radius:** `var(--radius-md)` `{8px}` · …
- **Spacing:** `var(--space-4)` `{16px}` · …
- **Typography:** `var(--font-sans)` · type scale `var(--text-base)` `{14px}` · …

## 3. Typography spec
| Element | Font | Size | Weight | Line-height | Color (token) |
|---|---|---|---|---|---|
| {H1} | {--font-sans} | {24px} | {700} | {1.3} | {var(--text)} |
| {Body} | {--font-sans} | {14px} | {400} | {1.5} | {var(--text-muted)} |

## 4. Layout chi tiết theo block
> Mỗi block = 1 sub-section, ghi geometry + màu + token + typography + shadow. Đặt node/frame id trong tiêu đề.

### 4.1 {Block name} (`{node_id}`)
- size: `{W} × {H}` px · padding `[T,R,B,L]` = `{[16,24,16,24]}` · gap `{8}` · justify `{space-between}`
- fill: `{#hex}` → `var(--{token})` · border: `{1px #hex}` → `var(--{token})`
- radius: `{px}` → `var(--radius-{x})`
- shadow: `{0 1 6 #00000014}` → `var(--shadow-{x})`
- gradient (nếu có): stops `{#hex @0 · #hex @0.6 · #hex @1}` · rotation `{135}`
- text: "{copy}" · font `{--font-sans} {15px} {600}` · color `var(--text)`

### 4.2 {Block name} (`{node_id}`)
- …

## 5. Dữ liệu text chuẩn (copy-paste — qua `t(vi,en)`)
> Chuỗi user-facing PHẢI đi qua `t(vi, en)` (HARD RULE 5). Ghi cả 2 ngôn ngữ.

- `{key}` → vi: "{…}" · en: "{…}"
- …

## 6. Checklist QA pixel-perfect
- [ ] Frame size khớp visual source đã chốt
- [ ] Mọi spacing/padding/gap khớp
- [ ] Radius đúng (`{16 / 24 / 9999}`)
- [ ] Gradient + shadow đúng màu/stop/rotation
- [ ] Border color đúng token
- [ ] Font family/size/weight đúng
- [ ] **Không màu/px hardcode ngoài `:root`** (FE-INV-2)
- [ ] Mọi chuỗi qua `t(vi,en)` (FE-INV-4)
- [ ] Đủ 4 state loading/ready/empty/error (FE-INV-1)
- [ ] Touch target ≥ 44px
- [ ] Verify tại đủ breakpoints

## 7. Gợi ý implementation (FE)
- Component tree đề xuất: `{…}`
- Tách `constants.ts` cho copy/mock data
- Data: fetch `/api/{resource}` → envelope `{ data | error,message,code }` (FE-INV-6)

---
_Template v0.1 · pipeline `../../channels/web/frontend-pipeline.md` · DD-58 (🟡)_
