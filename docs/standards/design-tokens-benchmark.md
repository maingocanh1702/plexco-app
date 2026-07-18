# Design Tokens — Benchmark Method & System Upgrade

> **Status:** 🟡 Deferred proposal (owner 2026-07-18) · **Version:** 0.2 · 2026-07-18
> **Nguồn:** ported từ Sporta `docs/design/sporta-design-tokens-recommendation.md`.
> **Decision:** `decisions.md` DD-59 (🟡).
> **Quan hệ:** đây là **method doc** — feed vào `design-tokens.md` (canonical tokens). KHÔNG thay `design-tokens.md`.
> **Đang trao đổi (live):** hướng theme bright/modern/sporty + 4 palette candidate + font → [`../channels/web/theme-direction-2026-07.md`](../channels/web/theme-direction-2026-07.md).
>
> **Reference-only:** DD-59 đã defer. Benchmark, usage-token layer và reconcile duplicate token file chưa active và **không gate build**; `design-tokens.md` hiện vẫn là token SoT, không thay đổi từ tài liệu này.

Hai mục tiêu:
1. **Method** — cách luận/điều chỉnh token từ benchmark app đối thủ (thay vì "tự chế").
2. **System upgrade** — nâng token từ mức *foundation* (đang có) lên mức *component/usage* (đang thiếu) — closing gap "token-only, chưa có component catalog".

> ⚠️ **Fidelity = template/method.** Bảng benchmark dưới để **cấu trúc** — điền giá trị thật khi chạy benchmark, KHÔNG bịa hex đối thủ.

---

## 0. Reconcile trước (dọn trùng lặp)
Hiện có **2 file token**: `standards/design-tokens.md` (canonical, đầy đủ) và `channels/web/design-tokens.md` (v0.1, trùng một phần). Đề xuất: **`standards/design-tokens.md` là SoT**; `channels/web/design-tokens.md` chỉ trỏ về SoT (surface note), không giữ giá trị song song → tránh drift. (DD-59)

---

## 1. Benchmark — apps tham khảo
> Chọn 5–7 app cùng ngành (thể thao/booking/social). Điền khi chạy.

| App | Loại | Primary | Background | Font chính | Dark mode | Đặc trưng |
|---|---|---|---|---|---|---|
| {App 1} | {sports tracking} | `{#hex}` | {white/dark} | {font} | {✅/❌} | {mô tả} |
| … | | | | | | |

### Key insights (rút ra từ bảng trên)
| Insight | Từ apps | Áp dụng cho Plexco |
|---|---|---|
| {…} | {…} | {…} |

## 2. Audit token hiện tại (`design-tokens.md`)
> Chia 3 nhóm verdict.

**✅ Giữ**
| Token | Value | Lý do |
|---|---|---|
| {--primary} | {…} | {identity} |

**⚠️ Bổ sung (đang thiếu)**
| Thiếu gì | Tham khảo từ | Đề xuất |
|---|---|---|
| {…} | {app} | {token} |

**🔄 Điều chỉnh**
| Token | Hiện tại | Đề xuất | Lý do |
|---|---|---|---|
| {…} | {…} | {…} | {…} |

## 3. Đề xuất token (nhóm theo category)
> Chỉ ghi delta so với `design-tokens.md`; đổi thật thì propagate sang SoT + bump version SoT.

- **Color core / semantic / surface & text**
- **Sport-adaptive accents** (đã có §9 trong `design-tokens.md` — mở rộng nếu cần)
- **Layout / spacing / typography / elevation / motion**

| Token | Value | Ghi chú |
|---|---|---|
| {--success} | {…} | {đã thanh toán / check-in OK} |

## 4. System upgrade — component/usage tokens (gap chính)
> Foundation token (màu/spacing) đã có. Thiếu **usage token** (semantic theo component) — nguồn gây hardcode. Đề xuất thêm lớp usage:

| Component | Usage token | Map về foundation |
|---|---|---|
| Button/primary | `--btn-primary-bg` | `var(--primary)` |
| Button/primary | `--btn-primary-fg` | `var(--on-primary)` |
| Card | `--card-bg` / `--card-border` | `var(--surface)` / `var(--border)` |
| Badge/paid | `--badge-paid-bg` / `--badge-paid-fg` | `var(--success-bg)` / `var(--success)` |
| Input | `--input-bg` / `--input-border-focus` | `var(--surface)` / `var(--primary)` |

Quy tắc: component CSS đọc **usage token**, usage token map về **foundation token** — đổi brand chỉ sửa foundation. (bổ trợ FE-INV-2)

## 5. So sánh Plexco vs competitors (positioning)
| Tiêu chí | {App A} | {App B} | Plexco (đề xuất) |
|---|---|---|---|

## References
| Source | Takeaway |
|---|---|
| {app design doc / công khai} | {…} |

## Changelog

| Ngày | Version | Thay đổi |
|------|---------|----------|
| 18/07/2026 | 0.2 | Owner defer DD-59; method/usage-token/reconcile là reference-only và không thay token SoT hiện tại. |
| 16/07/2026 | 0.1 | 🟡 Proposal — method benchmark + usage-token layer; reconcile duplicate token file. DD-59. |
