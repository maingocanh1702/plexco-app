# Design Tokens — Benchmark Method & System Upgrade

> **Status:** ✅ Active advisory method (owner 2026-07-28) · **Version:** 0.3 · 2026-07-28
> **Nguồn:** ported từ Sporta `docs/design/sporta-design-tokens-recommendation.md`.
> **Decision:** `decisions.md` DD-59 (✅).
> **Quan hệ:** đây là **method doc** — feed vào `design-tokens.md` (canonical tokens). KHÔNG thay `design-tokens.md`.
> **Theme direction:** DD-81 chọn Candidate C Energetic Orange + Sora/Inter; giá trị hiện hành chỉ đổi sau visual/WCAG gate tại [`../channels/web/theme-direction-2026-07.md`](../channels/web/theme-direction-2026-07.md).
>
> **Authority boundary:** benchmark chỉ là evidence tư vấn, không tự đặt/đổi giá trị và không gate build. `design-tokens.md` là value SoT; `design.pen` phải mirror value đó. Đảo authority cần DD mới + exporter + drift proof.

Hai mục tiêu:
1. **Method** — cách luận/điều chỉnh token từ benchmark app đối thủ (thay vì "tự chế").
2. **System upgrade** — nâng token từ mức *foundation* (đang có) lên mức *component/usage* (đang thiếu) — closing gap "token-only, chưa có component catalog".

> ⚠️ **Fidelity = template/method.** Bảng benchmark dưới để **cấu trúc** — điền giá trị thật khi chạy benchmark, KHÔNG bịa hex đối thủ.

---

## 0. Reconcile đã hoàn tất (dọn trùng lặp)
`standards/design-tokens.md` là value SoT duy nhất; `channels/web/design-tokens.md` đã thành pointer và không giữ giá trị song song. Đây là nhánh reconcile DD-59 đã hoàn tất ngày 19/07/2026.

---

## 1. Benchmark — apps tham khảo
> Chọn 5–7 app cùng ngành (thể thao/booking/social). Điền từ evidence kiểm chứng được; bảng chỉ tư vấn, không tự override product requirements, accessibility hay value SoT.

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

## 4. System upgrade — component/usage tokens
> Chỉ thêm usage/component alias khi một screen đã được owner duyệt cần state đó và semantic được tái sử dụng giữa screen/component. Không bulk-generate từ inventory hoặc benchmark. Mọi usage token map về foundation token trong value SoT:

| Component | Usage token | Map về foundation |
|---|---|---|
| Button/primary | `--btn-primary-bg` | `var(--primary)` |
| Button/primary | `--btn-primary-fg` | `var(--on-primary)` |
| Card | `--card-bg` / `--card-border` | `var(--surface)` / `var(--border)` |
| Badge/paid | `--badge-paid-bg` / `--badge-paid-fg` | `var(--success-bg)` / `var(--success)` |
| Input | `--input-bg` / `--input-border-focus` | `var(--surface)` / `var(--primary)` |

Quy tắc:

1. Owner-approved screen/state là demand evidence; benchmark không phải demand.
2. Reused semantic dùng usage token chung; one-off visual detail ở component owner chỉ alias token hiện có, không tạo foundation value mới.
3. Usage token luôn map về **foundation token** trong `design-tokens.md`; không chứa value song song.

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
| 28/07/2026 | 0.3 | **DD-59 ✅:** activate advisory benchmark method; `.md` giữ value SoT; usage aliases chỉ sinh từ owner-approved accepted/reused states; authority flip cần DD/exporter/drift proof. |
| 18/07/2026 | 0.2 | Owner defer DD-59; method/usage-token/reconcile là reference-only và không thay token SoT hiện tại. |
| 16/07/2026 | 0.1 | 🟡 Proposal — method benchmark + usage-token layer; reconcile duplicate token file. DD-59. |
