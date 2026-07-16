# Front-End Design → Code Pipeline — Visual Source → Pixel-Perfect

> **Status:** 🟡 Proposal · **Version:** 0.2 · 2026-07-17
> **Nguồn:** ported từ Sporta `front-end/README.md` — adapt cho Pencil/Figma + CSS-variable tokens (không Tailwind).
> **Decision:** `decisions.md` DD-58 (🟡).
> **Token SoT:** `../../standards/design-tokens.md`.
> **Visual SoT hiện tại:** **chưa chọn/chưa có asset được track**. `Plexco-DS-fable5.pen` không có trong repo và đã superseded theo `theme-direction-2026-07.md`; phải chốt một `.pen` mới được commit hoặc Figma file/node được link trước handoff/code.
> **Kiến trúc FE:** `../../standards/frontend-architecture.md` · **Tokens:** `../../standards/design-tokens.md`.

Quy trình đưa 1 màn từ visual source đã chọn ra code pixel-perfect, có **truy vết ngược** về design. Áp dụng cho mọi màn `apps/web`.

---

## Quy tắc vàng

1. **Mỗi screen phải trỏ tới visual source duy nhất đã được owner duyệt.** Pencil = file `.pen` được track + node id; Figma = URL file + node/frame id ổn định. Số đo/màu/spacing chỉ lấy từ source đó, **KHÔNG suy đoán**. Chưa có source → dừng trước handoff/code.
2. **Các mắt xích luôn đồng bộ:** visual source → `<screen>-handoff.md` → `<screen>-token-mapping.md` → code. Đổi 1 mắt xích phải cập nhật xuôi.
3. **Tokens-only:** giá trị ra code = `var(--token)` (`design-tokens.md`), không hardcode hex/px (FE-INV-2). Giá trị chưa có token → đề xuất thêm token, không hardcode.
4. **Source comment bắt buộc** trên mỗi component: `// Source: <screen>-token-mapping.md §X · handoff §Y` (song song luật BE `/** Source: feature_x_tech.md Section Y */`).

---

## 5 bước

### Bước 1 — Chốt visual source và đối chiếu design tokens
- **Input:** `.pen` được track **hoặc** Figma file/node được link · **Output:** source id cố định cho từng màn; chỉ cập nhật `../../standards/design-tokens.md` khi design system đổi và owner duyệt.
- Tokens dùng chung mọi màn — không lặp lại per-screen. Nếu màn cần token mới → thêm vào `design-tokens.md` trước.

### Bước 2 — Tạo Pixel-Perfect Handoff cho từng màn
- **Input:** source URL/path + node/frame id + tokens · **Output:** `docs/channels/web/handoff/<screen>-handoff.md` (template: `../../templates/feature-dev/fe-handoff-template.md`).
- Rule: **chỉ ghi giá trị đọc được từ visual source đã chọn** (geometry px, hex, token name, typography, shadow/gradient, copy text).
- **Icon rule (5 thuộc tính):** `library · name · size · color/fill · weight`. Ghi rõ library (vd `lucide-react`) — **không đoán** library vì mỗi bộ có import khác nhau.

### Bước 3 — Tạo Token Mapping
- **Input:** handoff · **Output:** `docs/channels/web/handoff/<screen>-token-mapping.md` (template: `../../templates/feature-dev/fe-token-mapping-template.md`).
- Map mỗi giá trị visual → **CSS variable/class** trong `styles/`. Giá trị chưa có token → tạo token mới (không dùng literal). Mỗi dòng cite handoff §.

### Bước 4 — Code Components
- **Input:** mapping · **Output:** component trong `apps/web` (`components/` shared hoặc `features/<name>/`).
- Tách shared vs screen-specific. Mỗi component mở đầu bằng `// Source: <screen>-token-mapping.md §X · handoff §Y`.
- Không hardcode; đủ 4 state (FE-INV-1); chuỗi qua `t(vi,en)` (FE-INV-4).

### Bước 5 — Verify Pixel-Perfect
- Screenshot compare code vs visual source tại **breakpoints** của `design-tokens.md §8` (mobile/tablet/desktop). Với Pencil dùng screenshot node; với Figma dùng export/screenshot đúng frame id.
- Kiểm hover/touch/animation; đo lệch → quay lại Bước 4. Touch target ≥ 44px (`design-brief.md §8`).

```
visual source ──► handoff.md ──► token-mapping.md ──► code ──► verify(screenshot×breakpoints)
      ▲                                                            │
      └────────────────── fix delta (loop về Bước 4) ◄─────────────┘
```

## Checklist khi thêm màn mới
- [ ] Product spec §Screens & States Reviewed (`../../features/feature_<name>.md`).
- [ ] Visual source đã chốt, truy cập được và được track/link bền vững.
- [ ] Node/frame tồn tại cho màn và ID được ghi trong handoff.
- [ ] `<screen>-handoff.md` (giá trị từ visual source, icon đủ 5 thuộc tính).
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
| 17/07/2026 | 0.2 | Gỡ claim sai về `Plexco-DS-fable5.pen` không tồn tại; tách token SoT khỏi visual SoT và fail-closed cho tới khi `.pen` mới/Figma source được chốt, track/link. |
| 16/07/2026 | 0.1 | 🟡 Proposal — ported từ Sporta `.pen→code` pipeline; adapt Pencil + CSS-var tokens. DD-58. |
