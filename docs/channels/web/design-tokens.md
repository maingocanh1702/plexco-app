# 🎨 Design Tokens — Web App → xem SoT

> ⚠️ **File này không còn chứa giá trị token.** Đã merge về SoT ngày 19/07/2026 (DD-59 reconcile, owner approve).
>
> **SoT duy nhất:** [`../../standards/design-tokens.md`](../../standards/design-tokens.md) (v1.1+)
> **Nhu cầu token từ BRD:** [`../../standards/token-needs-matrix.md`](../../standards/token-needs-matrix.md)
> **Theme mới (chờ chốt hue/font):** [`theme-direction-2026-07.md`](./theme-direction-2026-07.md)

## Chuyện gì đã xảy ra

File này (v0.1, 19/06/2026) từng khai báo bộ token song song với `standards/design-tokens.md` và đã **drift** (khác giá trị `--success`, `--info`, `--primary-hover`, sport colors…). Theo playbook `../../templates/brd-to-pen-playbook.md` §1.2 (một canonical duy nhất) và DD-59:

- Token chỉ-có-ở-đây (`--font-heading`, `--bg-page`, `--bg-input`, `--bg-sidebar`, `--text-inverse`, `--text-link`) → đã merge vào SoT §10, dạng alias.
- Giá trị xung đột → xử lý trong **Conflict Resolution Log** của SoT (đa số SoT thắng; riêng `--sport-tennis` lấy giá trị file này vì SoT cũ trùng `--warning`).
- KHÔNG thêm giá trị token vào file này nữa — mọi thay đổi vào SoT + changelog.

## Changelog

| Ngày | Version | Thay đổi |
|------|---------|----------|
| 19/07/2026 | v1.0 | Merge về SoT (DD-59 reconcile); file thành pointer. |
| 19/06/2026 | — | Thêm Changelog table |
| 18/06/2026 | v0.1 | Initial design tokens draft |
