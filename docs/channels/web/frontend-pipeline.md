# Front-End Design → Code Pipeline — Visual Source → Pixel-Perfect

> **Status:** ✅ Active governance; execution HOLD · **Version:** 0.6 · 2026-07-28
> **Nguồn:** ported từ Sporta `front-end/README.md` — adapt cho canonical Pencil `design.pen` + CSS-variable tokens (không Tailwind).
> **Decision:** `decisions.md` DD-58 (✅).
> **Token SoT:** `../../standards/design-tokens.md`.
> **Visual SoT hiện tại:** DD-81 đã chọn canonical path `design.pen`, nhưng file trong root đang
> untracked và chưa được owner nghiệm thu; vì vậy **chưa có visual authority usable**.
>
> **Cập nhật 06/08 — có FE spec rồi, vẫn chưa có visual authority.** 12 spec `FE/feature_*_fe.md` đã
> commit và đóng được **contract layer** của pipeline (route, state, error mapping có mã thật, i18n
> `t(vi, en)`, field nào `UNPINNED` phải omit). Nhưng bước 1 dưới đây — "mỗi screen phải trỏ tới exact
> node trong canonical `design.pen` đã được track + owner duyệt" — **vẫn chưa đóng**, nên handoff
> per-screen vẫn dừng trước code. Có spec không thay được gate nguồn visual.
> `Plexco-DS-fable5.pen` đã superseded. Chỉ sau persist/track + owner approval mới được dùng stable node
> IDs cho handoff/code.
> **Kiến trúc FE:** `../../standards/frontend-architecture.md` · **Tokens:** `../../standards/design-tokens.md`.
>
> **Activation boundary:** DD-58 đã chốt, nhưng mỗi screen fail-closed trước handoff/code cho tới khi Product spec được Reviewed và exact node trong canonical `design.pen` đã được track + owner duyệt. Pipeline active không tự chứng minh screen/FE đã implement.
>
> **DD-91 note:** Chat-primary/`/pay` plan v1.8 đã `PLAN_READY` tại `90d292d`, nhưng không tạo screen
> artifacts trước khi exact slice đạt `CODE_READY` và visual-source gate cùng đóng.

Quy trình đưa 1 màn từ visual source đã chọn ra code pixel-perfect, có **truy vết ngược** về design. Áp dụng cho mọi màn `apps/web`.

---

## Quy tắc vàng

1. **Mỗi screen phải trỏ tới exact node trong canonical `design.pen` đã được track + owner duyệt.** Số đo/màu/spacing chỉ lấy từ node đó, **KHÔNG suy đoán**. Chưa đóng source gate → dừng trước handoff/code.
2. **Các mắt xích luôn đồng bộ:** visual source → `<screen>-handoff.md` → `<screen>-token-mapping.md` → code. Đổi 1 mắt xích phải cập nhật xuôi.
3. **Tokens-only:** giá trị ra code = `var(--token)` (`design-tokens.md`), không hardcode hex/px (FE-INV-2). Giá trị chưa có token → đề xuất thêm token, không hardcode.
4. **Source comment có owner rõ:** đặt `// Source: <screen>-token-mapping.md §X · handoff §Y` tại screen/feature visual owner hoặc shared primitive. Presentational atom kế thừa từ owner đó **không lặp comment**.

---

## 5 bước

### Bước 1 — Chốt visual source và đối chiếu design tokens
- **Input:** canonical `design.pen` đã track + owner duyệt · **Output:** exact node id cố định cho từng màn; chỉ cập nhật `../../standards/design-tokens.md` khi design system đổi và owner duyệt.
- Tokens dùng chung mọi màn — không lặp lại per-screen. Nếu màn cần token mới → thêm vào `design-tokens.md` trước.

### Bước 2 — Tạo Pixel-Perfect Handoff cho từng màn
- **Input:** canonical `design.pen` + exact node/frame id + tokens · **Output:** `docs/channels/web/handoff/<screen>-handoff.md` (template: `../../templates/feature-dev/fe-handoff-template.md`).
- Rule: **chỉ ghi giá trị đọc được từ visual source đã chọn** (geometry px, hex, token name, typography, shadow/gradient, copy text).
- **Icon rule (5 thuộc tính):** `library · name · size · color/fill · weight`. Ghi rõ library (vd `lucide-react`) — **không đoán** library vì mỗi bộ có import khác nhau.

### Bước 3 — Tạo Token Mapping
- **Input:** handoff · **Output:** `docs/channels/web/handoff/<screen>-token-mapping.md` (template: `../../templates/feature-dev/fe-token-mapping-template.md`).
- Map mỗi giá trị visual → **CSS variable/class** trong `styles/`. Giá trị chưa có token → đề xuất theo DD-59; chỉ materialize usage alias cho accepted/reused state, không dùng literal. Mỗi dòng cite handoff §.

### Bước 4 — Code Components
- **Input:** mapping · **Output:** component trong `apps/web` (`components/` shared hoặc `features/<name>/`).
- Tách shared vs screen-specific. Screen/feature visual owner hoặc shared primitive mở đầu bằng `// Source: <screen>-token-mapping.md §X · handoff §Y`; atom con không lặp comment.
- Không hardcode; đủ 4 state (FE-INV-1); chuỗi qua `t(vi,en)` (FE-INV-4).

### Bước 5 — Verify Pixel-Perfect
- Screenshot compare code với screenshot exact node trong `design.pen` tại **breakpoints** của `design-tokens.md §8` (mobile/tablet/desktop).
- Kiểm hover/touch/animation; đo lệch → quay lại Bước 4. Touch target ≥ 44px (`design-brief.md §8`).

```
visual source ──► handoff.md ──► token-mapping.md ──► code ──► verify(screenshot×breakpoints)
      ▲                                                            │
      └────────────────── fix delta (loop về Bước 4) ◄─────────────┘
```

## Checklist khi thêm màn mới
- [ ] Product spec §Screens & States Reviewed (`../../features/FE/feature_<name>.md`).
- [ ] Canonical `design.pen` đã được track + owner duyệt.
- [ ] Exact node/frame tồn tại cho màn và ID được ghi trong handoff.
- [ ] `<screen>-handoff.md` (giá trị từ visual source, icon đủ 5 thuộc tính).
- [ ] `<screen>-token-mapping.md` (mọi giá trị → token; cite handoff §).
- [ ] Screen/feature visual owner hoặc shared primitive có `// Source:` comment; atom con không lặp; không literal; đủ 4 state; `t(vi,en)`.
- [ ] Verify screenshot ở đủ breakpoints.

## Cross-references
- Handoff template: `../../templates/feature-dev/fe-handoff-template.md`
- Token-mapping template: `../../templates/feature-dev/fe-token-mapping-template.md`
- FE architecture: `../../standards/frontend-architecture.md` · Tokens: `../../standards/design-tokens.md`

## Changelog

| Ngày | Version | Thay đổi |
|------|---------|----------|
| 28/07/2026 | 0.6 | Reconcile plan v1.8 `PLAN_READY` at `90d292d`; keep exact-slice `CODE_READY`, approved visual source and no-runtime gates. |
| 28/07/2026 | 0.5 | **DD-58 ✅:** activate Pencil-only `design.pen → handoff → token-mapping → code → screenshot verify`; source comment ở visual owner/shared primitive; giữ per-screen authority gate và FE HOLD. |
| 27/07/2026 | 0.4 | Reconcile DD-81 canonical path vs untracked/unapproved state; add DD-91 no-screen-before-readiness boundary. |
| 18/07/2026 | 0.3 | Owner defer DD-58; pipeline/templates chuyển thành reference-only, không gate delivery hiện tại. |
| 17/07/2026 | 0.2 | Gỡ claim sai về `Plexco-DS-fable5.pen` không tồn tại; tách token SoT khỏi visual SoT và fail-closed cho tới khi `.pen` mới/Figma source được chốt, track/link. |
| 16/07/2026 | 0.1 | 🟡 Proposal — ported từ Sporta `.pen→code` pipeline; adapt Pencil + CSS-var tokens. DD-58. |
