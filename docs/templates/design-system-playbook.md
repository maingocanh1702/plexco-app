# Design System & UI Playbook — từ BRD đến UI có taste

> **Version:** 1.1 · 2026-07-19 · **Status:** Reviewed — thành Active khi SSOT reconcile (§0.3) + mapping-theo-target (§Bước 8) được áp vào ít nhất 1 feature
> **Canonical:** repo Sporta (`docs/workflow/design-system-playbook.md`). Các project khác copy file này và ghi rõ nguồn; sửa đổi lớn sync ngược về đây.
> **Quan hệ với các doc khác:** đây là bản **end-to-end tinh gọn**. Chi tiết token/traceability → `../design/brd-to-pen-playbook.md` v3.0 (master, 10 bước). Recipe hiệu ứng → `../design/sporta-glassmorphism.md`. Bài học design-to-code → `../design/design-to-code-improve.md`.
> **Ngôn ngữ:** prose tiếng Việt, identifier/code tiếng Anh.

---

## 0. Nguyên tắc bất biến (mantras)

1. **Token trước pixel, component trước screen.** Không vẽ screen khi chưa có token + component library.
2. **Mọi token trace về 1 dòng BRD hoặc 1 quyết định có log.** Token không trace được = taste cá nhân → xoá hoặc log thành decision.
3. **Một canonical duy nhất — tách quyết định khỏi giá trị, và chỉ định file đích danh:**
   - **Quyết định + lý do** → sống ở `.md` (Conflict Resolution Log + Change Log).
   - **Giá trị token** → sống ở đúng 1 design file đích danh per-project. Sporta: **`design-token-sporta.pen`**.
   - **CSS/JSON/Markdown/Dart/Tailwind** → **generated exports**: ghi generator/check command + source revision (commit/hash của design file lúc export); không sửa tay.
   - File `.md` nào đang tự nhận "SSOT giá trị" phải re-label thành export/decision-log. *(Sporta: `docs/design/design-tokens.md` hiện vẫn tự nhận SSOT — reconcile là điều kiện Active của playbook này.)*
4. **State/role/device/theme là first-class** — chỉ build **tổ hợp hợp lệ** (coverage matrix, ô nào N/A ghi lý do), không phải tích Descartes.
5. **Đẹp là một bước có chủ đích, không phải may mắn** — flow này tách riêng "taste pass" (bước 4) để không bị governance nuốt mất (bài học Plexco `design1.pen`: token đầy đủ nhưng màn hình phẳng, không hero, không nhiệt).

---

## 1. Flow 9 bước (0–8)

| # | Bước | Artifact output | Gate để qua bước sau |
|---|------|-----------------|----------------------|
| 0 | Context lock | Authority & Phase contract + Mobile Context Discovery | Biết app type/stage/persona/KPI/device — chưa có thì KHÔNG design |
| 1 | Token needs từ BRD | Bảng Token Needs (6 lăng kính) | Mọi enum ≥2 trạng thái trong BRD có nhóm token |
| 2 | Benchmark | Bảng benchmark 5–7 app cùng ngành | Biết hue nào bị "chiếm"; chọn hue có identity |
| 3 | Token architecture | Token SSOT + Conflict/Change Log | Coverage đủ needs; WCAG AA cả 2 theme |
| 4 | **Taste pass** | N theme-variant frames + recipe set | Owner chọn được 1 variant bằng mắt |
| 5 | Components + Screens | Library 3 tầng + canonical screens | Coverage matrix điền đủ; màn chính có hero moment |
| 6 | Animation | Animation spec (micro-syntax) | Duration/easing là token; có reduced-motion |
| 7 | UI assets | Icon map + sample data + asset list | Không emoji; icon có px/stroke/màu chính xác |
| 8 | Handoff → code | Mapping theo target + pixel-perfect | Authority + generated artifacts có version + golden compare |

### Bước 0 — Context lock

Trả lời trước khi vẽ bất cứ gì: app type (booking/social/tool…), giai đoạn (MVP/scale), persona chính + ngữ cảnh dùng (một tay? ngoài trời? vội?), KPI màn hình, device target (vd mobile-first 375–430px), **target stack FE** (quyết định format handoff bước 8), negative scope (KHÔNG build gì đợt này).

### Bước 1 — Token needs từ BRD (6 lăng kính)

Chi tiết: master playbook §Bước 6A. Sáu lăng kính: NFR/ngữ cảnh · domain nghiệp vụ · **enum & state machine** (quan trọng nhất — mỗi chỗ BRD liệt kê ≥2 trạng thái của cùng 1 thứ = 1 nhóm token bắt buộc) · danh mục xuyên app · persona · roadmap. Output: bảng needs với cột trạng thái ✅/⚠️/❌.

### Bước 2 — Benchmark

5–7 app cùng ngành + khác ngành nhưng cùng vibe. Mỗi app: primary, bg light/dark, font, dark-mode default?, trait đáng học. Kết luận phải gồm: hue nào đã bị "chiếm". *"Chọn primary ngược đối thủ" là heuristic identity từ kinh nghiệm Sporta, không phải luật — được phép trùng vùng hue nếu có lý do ghi lại.*

### Bước 3 — Token architecture

3 lớp: Primitive → Semantic (theo vai trò: `--bg-card`, không theo màn: `--fab-icon`) → Component-alias. Theme là chiều day-1; heuristic khởi điểm: dark = desaturate 20–30% thay vì invert (tinh chỉnh theo mắt + WCAG, không áp cứng). Mỗi màu chức năng/sport có `-subtle` (12–15% alpha) và `--text-on-X`. Governance: một chiều SSOT → exports (§0.3); Conflict Resolution Log khi đảo giá trị; thế hệ token mới **replace, không append**.

### Bước 4 — Taste pass (bước hay bị bỏ quên — làm nghiêm túc)

> Các recipe dưới đây là **bài học/heuristic** rút từ exploration thực tế (Sporta Home, 8 variants) — không phải invariant. Lệch có chủ đích được phép khi có lý do ghi lại.

1. **Theme-variant exploration:** dựng 1 màn đại diện (thường là Home) thành component ref, nhân **N frame variant cạnh nhau** chỉ override màu (như `app-design-opus-4.6.pen`: Emerald/Coral/Ocean/Teal/White/Dark). Owner chọn bằng mắt, không chọn bằng bảng hex.
2. **Recipe set tối thiểu** (độc lập hue):
   - *Elevation mềm:* card = shadow thấp (`0 2px 10–16px #00000010`) + hairline stroke (`#00000008`) — không viền đậm.
   - *Hero gradient + glow:* màn chính/dashboard có 1 card anchor — gradient 135° ba stop (primary → sáng hơn @60% → đậm hơn @100%) + glow shadow cùng hue (`0 8px 28px primary@25%`). Màn phụ/utility không cần hero.
   - *Subtle-alpha icon container:* icon nằm trong container 44–48px, radius md, fill `--X-subtle` — tạo rhythm màu khắp màn.
   - *CTA pill nổi trên gradient:* fill trắng + shadow trắng, không border.
   - *Số tiền/KPI:* to, đậm, **có màu semantic**, `tabular-nums`.
3. **Typography có nhân vật:** cân nhắc display font riêng cho heading/hero (vd Archivo Black/Sora) + body legibility-first (Inter/Plus Jakarta Sans). 1 font an toàn = dễ nhạt.
4. **Visual hierarchy quyết đoán:** màn quan trọng có đúng 1 hero moment; mọi thứ khác lùi lại. Danh sách card đồng cấp = màn "admin tool".
5. (Optional) **Effect module:** glassmorphism/mesh gradient theo recipe riêng (`sporta-glassmorphism.md`) — có token, fallback, giới hạn performance (≤5 glass elements) và accessibility.

### Bước 5 — Component library + Screens

Library 3 tầng: Primitives (Button/Input/Badge…) → Domain (mỗi enum nghiệp vụ = 1 badge/tag bind domain token) → Composite (Card/Session, Nav…). Trong file design: `reusable: true` + instance `ref` + override — không copy-paste node. Screens: lập **coverage matrix `state × role × device × theme`** cho tổ hợp hợp lệ — screen dữ liệu động mặc định đủ Loading/Ready/Error/Empty + dark; static screen/confirmation sheet/permission gate được phép `N/A + lý do` per ô. Frame đặt tên `Screen / {Name} / {State} / {Device}`; canvas tổ chức: 00 Cover · 01 Foundations · 02 Components · 10+ Feature bands · Archive.

### Bước 6 — Animation

Viết spec bằng **micro-syntax**, mỗi dòng 1 interaction:

```
heroCard:  500ms ease-out [Y+40→0, α0→1]
chipTap:   150ms [S1→0.95→1]
skeleton:  2000ms ∞ [bg: muted↔accent]
sheetIn:   350ms spring [Y+280→0]
```

Quy tắc: duration/easing lấy từ token (`--duration-fast/normal/slow`, `--ease-out/spring`); animation phục vụ hierarchy (hero vào trước, list stagger sau); mọi motion gate sau `prefers-reduced-motion`; không animate quá 2 thuộc tính layout cùng lúc trên mobile.

### Bước 7 — UI assets

- **Icons:** 1 bộ duy nhất (Lucide hoặc Material Symbols) — **cấm emoji làm icon** (bài học retro: emoji làm sai px/stroke/màu). Lập **Icon Map**: element → tên icon → size/stroke/màu token.
- **Sample data:** synthetic production-shaped, tiếng Việt đúng domain (tên, giá, địa danh có cấu trúc/độ dài thật) — thống nhất trong 1 file để design/code dùng chung; không PII thật.
- **Ảnh/avatar:** quy tắc placeholder (initials, màu từ hash tên), nguồn ảnh public rõ ràng.
- **Decorative elements** (gradient blob, pattern): liệt kê riêng — thứ hay bị mất nhất khi port design → code.

### Bước 8 — Handoff → code (mapping theo target stack)

- **Doc handoff sinh từ design file** (qua `get_variables` + `batch_get`, không nhìn-rồi-chép), gồm:
  - `*-pixel-perfect-handoff.md` — layout block-by-block: height/padding/gap/radius/shadow/gradient stops (**QA spec, dùng chung mọi stack**).
  - Mapping doc **theo target**: Flutter → `*-dart-mapping.md` (hoặc generated Dart token/component map + golden test); web prototype → `*-tailwind-mapping.md`; stack khác → format tương ứng. *(Sporta: pipeline chính là `.pen → handoff → Dart tokens → golden test`; tailwind-mapping chỉ phục vụ web prototype — xem `frontend_architecture_flutter.md`.)*
- **Chống "code từ trí nhớ":** retro Sporta đo được code từ trí nhớ ≈ 30% sai; thêm nguồn đối chiếu tăng dần độ chính xác (1 nguồn ≈ 90%, đủ bộ ≈ 98%). *Các con số là bài học từ 4 iterations màn Home — heuristic, không phải invariant.* Lưu ý mapping + pixel-perfect **sinh từ cùng design file nên không phải nguồn độc lập** — giá trị của chúng là dạng dễ tiêu thụ + diff được. Gate đáng tin: **1 authority (design file) + generated artifacts có version/hash + render/golden comparison**.
- Mapping doc phải có 5 mục hay thiếu: Icon Map · Decorative · Sample data · Assets · Micro-interactions.
- Mỗi component code có comment trail về nguồn (JSDoc/docstring). Lock bằng golden/visual-regression test ở viewport chuẩn (vd 430×932) trước khi cho responsive.

---

## 2. Anti-patterns (từ thất bại thật)

| Anti-pattern | Hậu quả đã xảy ra | Phòng |
|---|---|---|
| Nhiều file cùng claim SSOT token | Sporta từng có 3 file · 3 giá trị `--primary` khác nhau; `design-tokens.md` vẫn tự nhận SSOT | §0.3: chỉ định file đích danh + exports + Conflict Log |
| Design từ nguyên tắc, bỏ taste pass | Plexco `design1.pen`: token đầy đủ nhưng UI phẳng, không hero, indigo lạnh | Bước 4 là bắt buộc, owner sign-off bằng mắt |
| Code UI từ trí nhớ | Home V1 sai ~30% (bịa tab pill, emoji, sai spacing) | Bước 8: authority + generated artifacts + golden |
| Emoji làm icon | Sai kích thước/màu, không control được | Icon Map + Lucide/Material |
| Per-screen token (`--fab-icon`) | Không tái dùng, drift | Semantic theo vai trò; per-screen chỉ là alias |
| Screenshot đẹp = xong | Thiếu states, thiếu coverage | 4 QA gates: Requirement/Semantic/System/Visual |
| Handoff format lệch stack thật | Bắt buộc tailwind-mapping trong khi FE chính là Flutter | Bước 0 chốt target stack → bước 8 mapping theo target |
| Workflow trên giấy ≠ thực tế | `.superdesign/` bỏ hoang trong khi iteration thật ở `.pen` + `research/` | Playbook chỉ giữ bước thật sự dùng; retro sau mỗi feature |
| Spec đã bỏ nhưng design vẫn vẽ (drift) | Quick Actions bị bỏ ở spec v2.3 nhưng design vẫn có | Trước khi vẽ: đọc spec version mới nhất; sau khi chốt: sync ngược |

---

## 3. Definition of Done (per feature/screen)

- [ ] Mọi giá trị style trong design file bind variable — zero literal hex/số lẻ
- [ ] Coverage matrix `state × role × device × theme` điền đủ — mỗi ô build hoặc `N/A + lý do`
- [ ] Màn chính/dashboard có hero moment; visual hierarchy rõ; số tiền-KPI to-đậm-có màu
- [ ] Token mới (nếu có) đã vào SSOT đích danh (§0.3) + changelog, trace được về BRD/decision
- [ ] Animation spec micro-syntax + reduced-motion
- [ ] Icon Map + sample data + decorative list đầy đủ
- [ ] Handoff: pixel-perfect + mapping đúng target stack, sinh từ design file kèm source revision; code có source trail; golden test pass ở viewport chuẩn
- [ ] WCAG AA cả light/dark cho text/CTA chính

---

## Changelog

| Ngày | Version | Thay đổi |
|------|---------|----------|
| 2026-07-19 | 1.1 | **Review fixes (9 findings):** §0.3 SSOT dứt khoát (quyết định ở `.md`, giá trị ở `design-token-sporta.pen`, exports ghi generator + source revision; flag `design-tokens.md` cần re-label); Bước 8 mapping theo target stack (Flutter dart-mapping là chính, tailwind cho web prototype) + reframe "3 nguồn" thành authority + generated artifacts + golden (mapping/pixel-perfect không độc lập); heuristics đánh dấu rõ (primary ngược đối thủ, desaturate 20–30%, 30/90/98%, hero chỉ cho màn chính); 4-states → coverage matrix với N/A+lý do; sửa "Flow 8 bước" → 9 bước (0–8); status Active → Reviewed chờ điều kiện adopt. |
| 2026-07-19 | 1.0 | Khởi tạo — chưng cất từ brd-to-pen-playbook v3.0, UIUX-skill, superdesign skill, glassmorphism, design-to-code retro, handoff pair, và phân tích so sánh Sporta `app-design-opus-4.6.pen` vs Plexco `design1.pen`. |
