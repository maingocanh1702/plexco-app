# Front-End Design → Code Pipeline — `.pen` → Pixel-Perfect

> **Status:** 🟡 Proposal · **Version:** 0.1 · 2026-07-16
> **Nguồn:** ported từ Sporta `front-end/README.md` — adapt sang Pencil (`.pen`) + CSS-variable tokens (không Tailwind).
> **Decision:** `decisions.md` DD-58 (🟡).
> **Design SoT:** `Plexco-DS-fable5.pen` (repo root) — đọc qua Pencil MCP (`get_editor_state` → `batch_get`).
> **Kiến trúc FE:** `../../standards/frontend-architecture.md` · **Tokens:** `../../standards/design-tokens.md`.

Quy trình đưa 1 màn từ design (`.pen`) ra code pixel-perfect, có **truy vết ngược** về design. Áp dụng cho mọi màn `apps/web`.

---

## Quy tắc vàng

1. **`Plexco-DS-fable5.pen` = single source of truth.** Số đo/màu/spacing lấy từ `.pen`, **KHÔNG suy đoán**. Thiếu giá trị → hỏi/đo lại, không tự chế.
2. **3 file luôn đồng bộ:** `.pen` → `<screen>-handoff.md` → `<screen>-token-mapping.md` → code. Đổi 1 mắt xích phải cập nhật xuôi.
3. **Tokens-only:** giá trị ra code = `var(--token)` (`design-tokens.md`), không hardcode hex/px (FE-INV-2). Giá trị chưa có token → đề xuất thêm token, không hardcode.
4. **Source comment bắt buộc** trên mỗi component: `// Source: <screen>-token-mapping.md §X · handoff §Y` (song song luật BE `/** Source: feature_x_tech.md Section Y */`).

---

## 5 bước

### Bước 1 — Đọc design tokens từ `.pen`
- **Input:** `Plexco-DS-fable5.pen` · **Output:** cập nhật `../../standards/design-tokens.md` (chỉ khi design system đổi).
- Tokens dùng chung mọi màn — không lặp lại per-screen. Nếu màn cần token mới → thêm vào `design-tokens.md` trước.

### Bước 2 — Tạo Pixel-Perfect Handoff cho từng màn
- **Input:** node id trong `.pen` + tokens · **Output:** `docs/channels/web/handoff/<screen>-handoff.md` (template: `../../templates/feature-dev/fe-handoff-template.md`).
- Rule: **chỉ ghi giá trị đọc được từ `.pen`** (geometry px, hex, token name, typography, shadow/gradient, copy text).
- **Icon rule (5 thuộc tính):** `library · name · size · color/fill · weight`. Ghi rõ library (vd `lucide-react`) — **không đoán** library vì mỗi bộ có import khác nhau.

### Bước 3 — Tạo Token Mapping
- **Input:** handoff · **Output:** `docs/channels/web/handoff/<screen>-token-mapping.md` (template: `../../templates/feature-dev/fe-token-mapping-template.md`).
- Map mỗi giá trị `.pen` → **CSS variable/class** trong `styles/`. Giá trị chưa có token → tạo token mới (không dùng literal). Mỗi dòng cite handoff §.

### Bước 4 — Code Components
- **Input:** mapping · **Output:** component trong `apps/web` (`components/` shared hoặc `features/<name>/`).
- Tách shared vs screen-specific. Mỗi component mở đầu bằng `// Source: <screen>-token-mapping.md §X · handoff §Y`.
- Không hardcode; đủ 4 state (FE-INV-1); chuỗi qua `t(vi,en)` (FE-INV-4).

### Bước 5 — Verify Pixel-Perfect
- Screenshot compare code vs `.pen` (Pencil `get_screenshot`) tại **breakpoints** của `design-tokens.md §8` (mobile/tablet/desktop).
- Kiểm hover/touch/animation; đo lệch → quay lại Bước 4. Touch target ≥ 44px (`design-brief.md §8`).

```
.pen (SoT) ──► handoff.md ──► token-mapping.md ──► code ──► verify(screenshot×breakpoints)
     ▲                                                          │
     └──────────────── fix delta (loop về Bước 4) ◄────────────┘
```

## Checklist khi thêm màn mới
- [ ] Product spec §Screens & States Reviewed (`../../features/feature_<name>.md`).
- [ ] Node `.pen` tồn tại cho màn.
- [ ] `<screen>-handoff.md` (giá trị từ `.pen`, icon đủ 5 thuộc tính).
- [ ] `<screen>-token-mapping.md` (mọi giá trị → token; cite handoff §).
- [ ] Component có `// Source:` comment; không literal; đủ 4 state; `t(vi,en)`.
- [ ] Verify screenshot ở đủ breakpoints.

## Cross-references
- Handoff template: `../../templates/feature-dev/fe-handoff-template.md`
- Token-mapping template: `../../templates/feature-dev/fe-token-mapping-template.md`
- FE architecture: `../../standards/frontend-architecture.md` · Tokens: `../../standards/design-tokens.md`

## Changelog

| Ngày | Version | Thay đổi |
|------|---------|----------|
| 16/07/2026 | 0.1 | 🟡 Proposal — ported từ Sporta `.pen→code` pipeline; adapt Pencil + CSS-var tokens. DD-58. |
