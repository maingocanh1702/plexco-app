# Token Mapping — {Screen Name}

> **Template** — copy sang `docs/channels/web/handoff/<screen>-token-mapping.md`.
> **Authority:** DD-58 đã owner-defer 2026-07-18; template này là optional reference, chưa phải delivery gate.
> Nguồn: ported từ Sporta `docs/handoff/*-tailwind-mapping.md` — adapt **CSS variables (không Tailwind)**.
> Pipeline: `../../channels/web/frontend-pipeline.md` · Handoff: `<screen>-handoff.md` · Tokens: `../../standards/design-tokens.md`.
>
> **Status:** Draft | Reviewed · **Version:** 0.1 · {YYYY-MM-DD}
>
> Mục tiêu: map mỗi giá trị `.pen`/handoff → **CSS variable**. Giá trị chưa có token → **thêm token vào `design-tokens.md`**, KHÔNG dùng literal.

---

## 1. {Component / block}
> Cite handoff § cho mỗi dòng.

| Thuộc tính | Giá trị `.pen` | CSS variable / class | Nguồn |
|---|---|---|---|
| height | {54px} | `height: var(--h-topbar)` | handoff §4.1 |
| padding | {[14,24,0,24]} | `var(--space-…)` | handoff §4.1 |
| bg | {#FFFFFF} | `background: var(--surface)` | handoff §4.1 |
| radius | {24px} | `var(--radius-lg)` | handoff §4.2 |
| shadow | {0 8 28 #6200EE3D} | `var(--shadow-md)` | handoff §4.3 |
| text color | {#111827} | `color: var(--text)` | handoff §3 |

### Token còn thiếu (cần thêm vào `design-tokens.md`)
- [ ] `--{token}`: `{value}` — dùng cho `{block}` (handoff §{x})

## 2. Icons
> Icon rule 5 thuộc tính (library · name · size · color · weight). KHÔNG đoán library.

| Icon (`.pen`) | Library | Import | JSX | Nguồn |
|---|---|---|---|---|
| {bell 20×20} | {lucide-react} | `import { Bell } from 'lucide-react'` | `<Bell size={20} />` | handoff §4.2 |

## 3. Variant states
> Liệt kê biến thể (badge/status/hover…) → token tương ứng.

- {Paid}: `background: var(--success-bg)` · `color: var(--success)`
- {Unpaid}: `background: var(--warning-bg)` · `color: var(--warning)`

## 4. QA nhanh trước khi merge
- [ ] Mọi giá trị → token (không literal ngoài `:root`)
- [ ] Icon đúng library/size
- [ ] Radius/shadow đúng token
- [ ] Không đổi font/scale theo breakpoint nếu design không có variant
- [ ] Component có `// Source: <screen>-token-mapping.md §X · handoff §Y`

---
_Template v0.2 · DD-58 (🟡 deferred/reference-only)_
