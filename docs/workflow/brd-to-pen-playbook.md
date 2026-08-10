> **📌 Ported from Sporta** (2026-08-09) — Adapt cho Plexco context trước khi sử dụng. Xem `docs/expert/README.md` cho context mapping.

# Playbook: BRD → Design Tokens → `.pen`

**Version:** 3.0 (hợp nhất)

**Ngày:** 2026-07-19

**Nguồn hợp nhất:**
- `brd-to-pen-playbook.md` v2.0 — reverse-engineer cặp `saas-bot-tele-brd.md` ↔ `BotShopez.pen` (614 top-level objects, 84 reusable components, 34 variables).
- `design-token-playbook.md` — đúc kết từ Sporta (BRD v1.3 ↔ `design-token-sporta.pen`) + retro `design-to-code-improve.md`.

> **Mục đích:** Quy trình tái sử dụng để chuyển BRD thành file thiết kế Pencil (`.pen`) có traceability, design system, state coverage và nguồn sự thật rõ ràng — trong đó **build design tokens từ BRD** là bước được đào sâu nhất (Bước 6).
> **Cách dùng:** Đây là template phương pháp. Chỉ thay nội dung nghiệp vụ, role, enum, phase, token và screen inventory của dự án mới; không sao chép nguyên visual hoặc gap hiện tại của project ví dụ.
> **File này thay thế** cả `brd-to-pen-playbook.md` v2.0 lẫn `design-token-playbook.md`.

---

## TL;DR (bản rút gọn 1 phút)

- **Đừng vẽ `.pen` thẳng từ BRD.** Đi qua chuỗi: `BRD → Requirement-to-Surface Matrix → Feature Spec → Design Tokens → Component Library → Screens → Coverage/Audit → Code Handoff`.
- **3 authority tách bạch:** BRD (business, role, phase) · PRD + Feature Spec (route, field, state) · Design Tokens (màu, type, spacing). `.pen` chỉ là implementation, không phải nguồn sự thật — riêng **giá trị token** thì `.pen` variables là canonical máy-đọc-được, các file khác generate từ đó.
- **Thứ tự làm (10 bước):** ① authority + phase → ② trích design signals → ③ matrix traceability → ④ feature spec → ⑤ screen inventory → ⑥ **build tokens từ BRD (mine → benchmark → kiến trúc → drift audit)** → ⑦ component library (primitives → domain → composite) → ⑧ compose screens → ⑨ coverage/QA → ⑩ design-to-code handoff.
- **4 câu thần chú:** component trước screen · token trước pixel · **mọi token trace về 1 dòng BRD hoặc 1 decision có log** · state/role/device là first-class (chỉ tạo tổ hợp hợp lệ, KHÔNG nhân Cartesian).
- **Xong khi nào (DoD):** mọi Must FR có mapping hoặc `no-direct-ui`; không orphan surface; không token drift; không duplicate canonical name; đủ state/role/device theo inventory; contrast đạt WCAG AA ở mọi theme.
- **Bắt đầu nhanh:** copy templates §5.1–§5.10. Ví dụ thực tế: §6 (BotShopez + Sporta).

---

## 0. Nguyên tắc cốt lõi (đọc trước)

**KHÔNG thiết kế `.pen` trực tiếp từ BRD.** BRD trả lời *"hệ thống phải làm gì"*, không đủ để quyết định information architecture, field, layout, state, responsive behavior hay component contract. Nhảy thẳng từ BRD sang canvas thường dẫn tới bịa layout, sót state, sai role và drift token.

Pipeline chuẩn:

```
Authority + Phase
        │
        ▼
BRD / PRD / TDD
        │
        ▼
Requirement-to-Surface Matrix
        │
        ├──► Feature Spec FE ──► Screen Inventory
        │
        └──► Design Tokens (mine → benchmark → kiến trúc → audit)
                              │
                              ▼
                    Component Inventory
                              │
                              ▼
                    `.pen` screens / flows
                              │
                              ▼
                Traceability + Visual QA + Audit
                              │
                              ▼
                    Design-to-code handoff
```

Tám nguyên tắc:

1. **Authority trước canvas.** Chốt tài liệu nào sở hữu business rule, UI contract và visual token; khi có xung đột phải ghi decision, không tự đoán.
2. **Phase là scope ceiling.** Không biến toàn bộ future roadmap thành current UI. Mỗi surface phải có phase/status rõ ràng — nhưng **token cho feature tương lai thì được đặt tên chừa chỗ ngay từ đầu** (VD: `--karma-tier-*` khi Karma ở Phase 4).
3. **Traceability trước số lượng frame — áp cho cả token.** Mỗi Must FR phải map đến một surface hoặc có lý do `No direct UI`; mỗi surface phải trỏ ngược về requirement; **mỗi token phải trace về 1 dòng BRD hoặc 1 decision có log** — token không trace được = gu cá nhân = xóa hoặc đưa vào Conflict Log để chốt.
4. **Component trước, screen sau.** Xây primitives, domain variants và composites rồi ráp màn hình bằng `ref`/instance.
5. **Token trước, pixel sau — semantic theo vai trò, không theo màn hình.** Màu, spacing, radius và font lặp lại phải dùng semantic variables (`--bg-card`, `--text-on-accent` ✅). Token per-screen (`--fab-icon`, `--time-badge-bg` ❌) chỉ được là alias trỏ về core token, không chứa giá trị mới. Literal chỉ được phép nếu có allowlist và lý do.
6. **State, role và device là công dân hạng nhất.** Nhưng chỉ tạo các tổ hợp hợp lệ; không nhân cơ học toàn bộ ma trận.
7. **Canonical rõ ràng + pipeline 1 chiều.** Mỗi feature có một bản `CURRENT`; bản thử nghiệm/cũ ghi `REVIEW`, `DEPRECATED` hoặc `ARCHIVE`. Với token: 1 nguồn giá trị duy nhất, các file khác generate — **đổi thế hệ token = thay thế, không chồng thêm** (bài học Sporta: `.pen` chứa cả `--primary` tím cũ lẫn xanh lá mới vì append không dọn).
8. **Theme (light/dark) là dimension ngay từ ngày 1.** Retrofit sau đắt gấp nhiều lần. Dark mode không phải đảo màu: desaturate 20–30%, pastel hóa, tăng opacity subtle (Material 3).

---

## 1. Authority và chuỗi artifact

| # | Artifact | Vai trò | Ví dụ |
|---|----------|---------|-------|
| 0 | **Authority & Phase Contract** | Ai quyết định gì; phase nào đang thiết kế; conflict resolution | Header/status của BRD, roadmap, decision log |
| 1 | **BRD** | Personas, business model, rules, flows, FRs, RBAC, pricing, phase | `saas-bot-tele-brd.md`, `brd-final.md` (Sporta) |
| 2 | **PRD / TDD** | Route, domain field, enum, validation, API/data contract | `saas-bot-tele-prd.md` |
| 3 | **Requirement-to-Surface Matrix** | Trace `FR/NFR → actor → surface → state → phase` | Template §5.3 |
| 4 | **Feature Spec FE** | User job, zones, fields, actions, states, edge cases, responsive | `docs/Phase 1/FE/feature_dashboard.md` |
| 5 | **Screen Inventory** | Hợp đồng phạm vi frame và canonical status | Template §5.4 |
| 6 | **Design Tokens** | SSOT quyết định visual + Token Needs + benchmark | `docs/design/design-tokens.md` |
| 7 | *(tuỳ chọn)* **HTML iteration** | Duyệt visual direction nhanh trước khi dựng `.pen` | `.superdesign/design_iterations/*.html` |
| 8 | **`.pen`** | Design system, screens, flows, variants, annotations — và **canonical giá trị token** (variables) | `BotShopez.pen`, `design-token-sporta.pen` |
| 9 | **Coverage & Audit Report** | Requirement coverage, token drift, role/state/device gaps | Template §5.9 |
| 10 | **Mapping doc + Handoff spec** | Cầu nối `.pen` → code (tailwind mapping, icon map, sample data) | `home-screen-final-tailwind-mapping.md` |

### 1.1 Quy tắc authority

- **BRD thắng** khi tranh chấp về business rule, actor, permission, pricing hoặc phase.
- **PRD/feature spec thắng** khi tranh chấp về route, field, validation, UI state hoặc interaction đã được BRD cho phép.
- **Design tokens thắng** khi tranh chấp về màu, typography, spacing, radius và visual primitive.
- **`.pen` không tự động là authority** cho layout/screen — nó là implementation. Drift phải được sửa hoặc ghi nhận bằng decision.
- Nếu business/UI/visual source đều chưa quyết định, ghi `OPEN` và dừng surface liên quan; không tự điền bằng giả định.

### 1.2 Canonical cho GIÁ TRỊ token — pipeline 1 chiều

Phân biệt 2 thứ hay bị trộn lẫn:

- **Quyết định** (tại sao chọn tím, tại sao light default) → sống ở `design-tokens.md` dưới dạng Conflict Resolution Log + Change Log.
- **Giá trị** (`#6200EE`, `48px`) → sống ở **một nơi duy nhất**: `.pen` variables (machine-readable, đọc bằng `get_variables`). `design-tokens.css` và bảng giá trị trong `.md` phải là bản **generate/export**, có header "DO NOT EDIT", không sửa tay.

Khi có mâu thuẫn giữa các file: canonical thắng, file khác regenerate — không "sửa cho khớp" bằng tay.

> **Bằng chứng vì sao cần luật này (Sporta, 2026-07):** 3 file lệch nhau 3 kiểu — `.pen` chứa entries mới nhất là `--primary #059669` xanh lá (chồng lên tím cũ chưa dọn), `design-tokens.md` ghi tím `#6200EE` + dark bg `#0F0F14`, `design-tokens.css` ghi tím + dark bg `#121212` (cũ nhất). Tệ hơn: 2 doc cùng tự nhận "single source of truth". BotShopez cũng gặp đúng pattern này. "Đã có SSOT" chưa đủ — phải chạy drift audit (§2 Bước 6D).

### 1.3 Conflict Resolution Log bắt buộc

| Date | Scope | Sources in conflict | Decision | Authority | Propagation |
|---|---|---|---|---|---|
| YYYY-MM-DD | Primary color | tokens vs `.pen` | … | Design tokens | variables + components + screens |

---

## 2. Quy trình 10 bước

### Bước 1 — Chốt authority, phase và negative scope

Trước khi vẽ, ghi rõ:

- Business authority, UI authority và visual authority.
- Phase/release đang thiết kế; requirement nào là current, next, future hoặc out-of-scope.
- Surface nào **không** được tạo trong lượt này.
- Open decision nào đang block layout/flow.

BotShopez có 18 functional modules và 3 release phases. Nếu bỏ qua phase, canvas sẽ trộn MVP, CTV launch và Scale thành một "current product" giả.

### Bước 2 — Trích design signals từ BRD

| Thành phần BRD | Chuyển thành quyết định thiết kế |
|---|---|
| **Personas / jobs** | Landing screen, primary action, mật độ, ngôn ngữ, thiết bị chính |
| **Stakeholders / RBAC** | Navigation, role variants, hidden/disabled/read-only surfaces, 403 state |
| **Business rules / locks** | Guard, warning, disabled CTA, confirm flow, audit information |
| **Business flows** | Screen sequence, panels, dialogs, success/failure/recovery paths |
| **Functional requirements** | Surface, field, action, table column, filter, export, notification |
| **Enum / state machine** | Status badge, domain component variant, tab/filter option — **và semantic token** (Bước 6A) |
| **Pricing / tier** | Locked, upgrade, quota-exhausted, trial/plan state |
| **NFR responsive** | Breakpoint coverage và responsive transformation |
| **NFR ngữ cảnh sử dụng** | Ngoài trời/trong nhà, một tay/hai tay, đang vội → touch target, contrast, density, motion (Bước 6A) |
| **NFR security / isolation** | Negative visibility: data role này tuyệt đối không được thấy |
| **Edge case / risk** | Empty, error, stale, conflict, expired, retry và fail-closed state |
| **Glossary** | Canonical label, component name và vocabulary |

Không giả định "1 FR = 1 screen". Một FR có thể là:

- Một field hoặc action trong screen có sẵn.
- Một component variant.
- Một state của flow.
- Một modal/panel.
- Một constraint không có UI trực tiếp.

### Bước 3 — Lập Requirement-to-Surface Matrix

Đây là lớp traceability bắt buộc giữa BRD và feature spec:

| FR/NFR | Phase | Actor | User job | Trigger | Data | Action | Visibility | State/edge | Surface | Status |
|---|---|---|---|---|---|---|---|---|---|---|
| FR-7.1 | P1 | Admin | Xem tình hình shop | Login | revenue/orders/stock | drill-down | Admin only | loading/empty/error | Dashboard | mapped |
| NFR-10 | all | Admin/CTV | Dùng panel từ 375px+ | viewport | same data | same tasks | role-scoped | mobile nav/table | Responsive variants | gap-open |

Quy tắc:

- `gap-open` dùng cho requirement đã rõ nhưng còn thiếu design evidence; `blocked-open-decision` dùng khi chưa thể thiết kế vì authority chưa chốt.
- Requirement Must của current phase không được còn `gap-open` hoặc `blocked-open-decision` khi đánh dấu `DESIGN READY`.
- `no-direct-ui` phải có lý do, ví dụ transaction atomicity hoặc encryption at rest.
- Không có surface "mồ côi": mọi screen/panel/modal phải trỏ về ít nhất một FR, NFR, use case hoặc design-system need.

### Bước 4 — Viết Feature Spec FE

Feature spec biến business requirement thành interaction contract. Tối thiểu phải có:

1. Actor và primary user job.
2. Route/surface và entry point.
3. Một dominant region và các zones phụ.
4. Field, table columns, filters, sorting, pagination, CTA và destructive action.
5. Ready/loading/empty/error/filter-empty/validation/success feedback.
6. Role visibility và negative visibility.
7. Responsive transformation, không chỉ kích thước frame.
8. Edge cases, recovery và analytics event nếu cần.
9. BRD refs + acceptance criteria.

▸ *Ví dụ:* `FR-7.1` chỉ nói dashboard doanh thu/CTV/stock; `feature_dashboard.md` mới quyết định 4 zones, tab chart, recent orders, alerts và CTV-scoped variant.

### Bước 5 — Dựng Screen Inventory bằng tổ hợp hợp lệ

Mỗi dòng inventory là một surface thực sự cần design:

```text
Module → Surface kind → Canonical name → Role → State → Device → Theme → Phase
```

Không dùng phép nhân toàn phần `screens × states × roles × breakpoints`. Thay vào đó:

- Login không có empty state.
- Một modal có thể dùng cùng layout ở desktop/tablet nhưng chuyển thành sheet ở mobile.
- Admin và CTV chỉ cần tách frame nếu content/permission/hierarchy khác; đổi vài label có thể dùng override.
- Loading/error có thể là per-zone thay vì full-screen nếu feature spec yêu cầu partial failure.

Mỗi row phải có `canonical_status`: `CURRENT`, `REVIEW`, `DEPRECATED`, `ARCHIVE` hoặc `REFERENCE`.

### Bước 6 — Build design tokens từ BRD (mine → benchmark → kiến trúc → audit)

> Đây là bước được đào sâu nhất — 4 bước con 6A→6D. Làm xong mới compose screens.

#### 6A. Mine BRD → bảng Token Needs (chưa chọn giá trị)

Đọc BRD với 6 lăng kính, ghi ra bảng **Token Needs** (template §5.10):

| # | Lăng kính | Tìm gì trong BRD | Sinh ra token gì (ví dụ Sporta) |
|---|-----------|------------------|--------------------------------|
| 1 | **NFR / Ngữ cảnh sử dụng** | Môi trường, thiết bị, thời điểm dùng | "Ngoài trời, đang chơi thể thao, nút lớn, tương phản cao, card-based" → `--touch-target: 48px`, radius scale cho card, accent tương phản cao, light mode default |
| 2 | **Domain nghiệp vụ** | Loại dữ liệu đặc thù (tiền, thời gian, tỉ số...) | Fintech/split-bill → typography "Financial/Tabular" (tabular figures), semantic màu trạng thái thanh toán |
| 3 | **Enum & State machine** ⚠️ quan trọng nhất, dễ sót nhất | Mọi danh sách trạng thái, tier, phân loại | Karma 4 tiers (🔴🟡🟢💎), sân (Trống/Đã cọc/Đã thanh toán), payment (PENDING/CONFIRMED), W/L form → mỗi state = 1 semantic token |
| 4 | **Danh mục sản phẩm** | Category chạy xuyên app | Danh sách môn thể thao → `--sport-*` adaptive accents; BotShopez: product types → `ProductType/*` |
| 5 | **Personas** | Ai dùng, trình độ công nghệ, tần suất | Host thao tác nhanh khi đang bận → touch target, motion nhanh; Lễ tân dùng grid → density tokens |
| 6 | **Roadmap phases** | Feature tương lai cần "chừa chỗ" | Karma Phase 4 → đặt tên nhóm `--karma-*` ngay từ đầu, chưa cần dùng |

**Rule cho lăng kính 3:** quét BRD bằng câu hỏi *"chỗ nào liệt kê ≥2 trạng thái của cùng 1 thứ?"* — mỗi chỗ đó là 1 nhóm token bắt buộc. Không tokenize trước → màn hình tương ứng sẽ hardcode màu (gap thực tế của cả Sporta lẫn BotShopez).

#### 6B. Benchmark — chọn giá trị

BRD cho biết **cần gì**, không cho biết **giá trị bao nhiêu**. Chọn giá trị bằng benchmark 5–7 app cùng domain:

- Mỗi app ghi: primary, background, font, dark mode, đặc trưng (mẫu: `sporta-design-tokens-recommendation.md` §1).
- Rút insight dạng: *"pattern X xuất hiện ở N app → áp dụng/né"* (VD: dark bg `#121212` không pure black; dual-font brand+body; neon accent = premium; 8pt grid).
- **Chọn primary NGƯỢC với đối thủ** để tạo nhận diện (Sporta chọn tím vì Playo xanh lá, Strava cam, Decathlon xanh dương).

#### 6C. Kiến trúc token — 3 lớp + theme dimension

```
Lớp 1 PRIMITIVE   (tùy chọn, khi hệ lớn): palette thô — purple-500, space-4
Lớp 2 SEMANTIC    (bắt buộc): vai trò — --primary, --bg-card, --success, --karma-tier-1
Lớp 3 COMPONENT   (alias, không giá trị mới): --tab-active: var(--primary)
```

- Mỗi semantic token khai báo đủ giá trị cho mọi theme (light/dark từ ngày 1).
- Token cặp `X` + `X-subtle` (bg nhẹ 12–15% opacity) cho mọi semantic color — dùng cho badge/selected state.
- Token `--text-on-X` cho mọi màu nền đậm (`--text-on-primary`, `--text-on-accent`).

**Checklist độ phủ** (canonical phải chứa ĐỦ các nhóm này — thiếu nhóm nào, nhóm đó sẽ drift):

```
[ ] Color core: primary/accent + hover/light/subtle
[ ] Color semantic: success/warning/danger/info + subtle
[ ] Color state-enum từ BRD (6A lăng kính 3) — karma tiers, booking states...
[ ] Surface & text per theme: bg/bg-card/bg-elevated/bg-input/border/text/text-secondary/text-muted
[ ] Category accents (nếu có danh mục xuyên app)
[ ] Typography roles: font + size + weight + line-height + letter-spacing từng element
    (kể cả row đặc thù domain như Financial/Tabular) — không chỉ một font global
[ ] Spacing (--space-* theo grid 4/8pt) + Radius scale + Layout (topbar/tabbar/touch-target/safe-area)
[ ] Elevation/shadow per theme
[ ] Motion: duration + easing (Pencil chỉ biểu diễn phần schema hỗ trợ → phần còn lại document trong .md)
[ ] Effect đặc thù (glassmorphism, glow...) nếu style yêu cầu
```

> Bài học Sporta: `.pen` chỉ có color/radius/spacing → typography/shadow/motion sống rải rác trong `.md`, thêm font Inter vào `.md` mà quên `.pen`.

#### 6D. Khai báo Pencil variables + drift audit + verify

Dịch token đã chốt thành Pencil variables (theme axis `mode: [light, dark]` nếu sản phẩm thực sự hỗ trợ).

Policy cho literal:

- Semantic màu/spacing/radius lặp lại phải dùng variable.
- Chart series, illustration hoặc one-off brand asset chỉ được hardcode nếu có allowlist (§5.5).

Verify trước khi compose:

- [ ] **Coverage check:** đối chiếu bảng Token Needs (6A) — mọi enum/state trong BRD đã có token chưa?
- [ ] **Contrast WCAG AA** (≥4.5:1 text, ≥3:1 UI) cho mọi cặp text/bg ở CẢ 2 theme — đặc biệt accent sáng trên nền sáng (Sporta phải sinh `--accent-on-light` vì `#DFFF00` fail trên light bg).
- [ ] **Drift audit:** so sánh token doc ↔ `.pen` variables ↔ representative components ↔ canonical screens (§5.5). Có drift thì ghi decision rồi propagate; không gọi `.pen` là aligned khi chưa kiểm.
- [ ] Không còn token per-screen chứa giá trị mới (chỉ được alias).

### Bước 7 — Xây component library theo ba tầng

1. **Primitives:** Button, Input, Select, Checkbox, Toggle, Chip, Avatar, Badge, Tooltip, Progress, Pagination, Skeleton.
2. **Domain:** mỗi enum/state có variant rõ ràng, ví dụ `Status/*`, `ProductType/*`, `LinkStatus/*`, `KarmaTier/*`, `CTVStatus/*` — variant bind vào token state-enum từ Bước 6.
3. **Composite/layout:** Sidebar, PageHeader, FilterBar, StatCard, Tabs, Table, Modal, Toast, EmptyState, ConfirmDialog.

Quy ước Pencil:

- Reusable node dùng `reusable:true`; screen sử dụng `ref` + descendant overrides.
- Table bắt buộc `Table → Row → Cell → content`.
- Ưu tiên flex layout với `fill_container`, `fit_content`, `gap`, `padding`.
- Component API phải đủ generic để tránh tạo nhiều bản gần giống chỉ khác text.
- Mỗi component cần states tương tác liên quan: default/hover/focus/disabled/destructive nếu scope design yêu cầu.

### Bước 8 — Compose canonical screens và flow variants

Với mỗi surface:

1. Tạo root frame có tên, kích thước/device, theme, `clip:true` khi cần và `placeholder:true` trong lúc làm.
2. Dựng shell/navigation từ reusable component.
3. Mỗi zone trong feature spec thành một container có nhiệm vụ rõ.
4. Ráp primitives/composites bằng instances; không vẽ lại UI lặp.
5. Tạo flow variants bằng copy + override: ready → loading/empty/error; pending → paid → delivered/expired.
6. Hoàn tất một root frame, kiểm layout rồi mới bỏ `placeholder:true`.
7. Gắn annotation/metadata hoặc note nêu BRD refs, role, state, device, phase, canonical status.

▸ *Ví dụ Dashboard BotShopez:*

| Spec zone | `.pen` region | Main building blocks |
|---|---|---|
| Shell | Sidebar + Main Content | `Component/Sidebar/V3` |
| Header | Header Section | title, search, notification |
| Stats | Stats Section | Stat cards + trend indicators |
| Trend | Chart Section | Tabs, grouped bars, legend, time filter |
| Insights | Revenue & Customer Row | horizontal bars + donut |
| Actions | Orders & Alerts Row | Table + stock/CTV/debt widgets |

### Bước 9 — Coverage, visual QA và design handoff

Chạy bốn gate:

1. **Requirement gate:** Must FR coverage, phase, no orphan surfaces.
2. **Semantic gate:** role isolation, state machine, validation, recovery, pricing gate.
3. **System gate:** token drift, component reuse, naming, duplicate canonical names, archive hygiene.
4. **Visual gate:** layout, clipping, contrast, hierarchy, density, responsive transformation, screenshot review.

Chỉ đánh dấu feature `DESIGN READY` khi cả inventory và audit report được cập nhật. Một screenshot đẹp không thay thế coverage; nhiều frame không chứng minh requirement đã đúng.

### Bước 10 — Design-to-code handoff

> Retro từ 4 lần iterate Home Screen Sporta (V1→V4): accuracy tỷ lệ thuận số nguồn cross-reference — 1 nguồn ≈ 80–90%, **3 nguồn ≈ 98%**. KHÔNG BAO GIỜ code UI từ trí nhớ (~30% sai).

Quy trình chuẩn:

```
.pen (verify bằng get_variables + batch_get)
    → tailwind-mapping.md (guide cho dev)
        → code
            → cross-check pixel-perfect-handoff.md (spec cho QA)
```

Mapping doc phải có đủ 5 mục thường thiếu (mỗi mục thiếu mất 0.5–3% accuracy):

1. **Icon Map** — vị trí, tên Lucide icon, size, color. Dùng SVG library (Lucide), KHÔNG dùng emoji (render khác mỗi OS, không control được size/stroke/color).
2. **Decorative elements** — circle overlay, divider, gradient position.
3. **Sample data** — tên, số liệu thật để screenshot so được.
4. **Asset/avatar specs** — fallback, stack layout.
5. **Micro-interactions** — active/hover scale, transition.

Mỗi component ghi JSDoc nguồn tham chiếu (audit trail — khi debug sai lệch biết ngay giá trị lấy từ đâu):

```tsx
/**
 * HeroNextSession
 * Source: mapping §6 + handoff §4.3-B
 * .pen verified: radius 24, gradient 135deg, shadow 0 8 28
 */
```

---

## 3. Quy ước tổ chức canvas

Canvas Pencil là vô hạn — cần kỷ luật bố cục nếu không sẽ loạn ở quy mô hàng trăm frame:

- **00 — Cover / Map:** authority, phase, legend, canonical status và link tới inventory.
- **01 — Foundations:** token swatches, typography, spacing, radius, elevation và icon rules.
- **02 — Components:** primitives → domain → composites.
- **10+ — Feature bands:** mỗi module một băng ngang; cùng một flow xếp trái → phải theo thời gian/state.
- **Responsive bands:** desktop/tablet/mobile có nhãn riêng. Mobile Telegram mockup và responsive web mobile là hai loại surface khác nhau, không được tính thay cho nhau.
- **Archive zone:** bản cũ hoặc exploration chuyển vào vùng `ARCHIVE`, không để lẫn với canonical frames.
- **Panel/modal/detail:** đặt gần screen gọi nó, nhưng vẫn giữ group/label rõ để search được.
- **Notes ở lề trái:** ghi module, BRD refs, owner, phase, status, expected states/devices và known gaps.
- **Root hygiene:** chỉ root screen/frame lớn, reusable component hoặc note điều hướng. Không để text/icon/card/shape trần ở root.
- Dùng `FindEmptySpace` khi thêm root frame; không đặt tọa độ ngẫu nhiên đè lên module khác.

### 3.1 Lifecycle của một frame

```text
DRAFT/placeholder
    → REVIEW
    → CURRENT
    → DEPRECATED
    → ARCHIVE
```

- Mỗi logical surface chỉ có một `CURRENT` cho cùng `role + state + device + theme`.
- `v2`, `new`, `final-final` không phải lifecycle status. Version nằm trong note/metadata hoặc changelog.
- Khi thay canonical, chuyển bản cũ sang `ARCHIVE` trong cùng lượt; không chỉ tạo thêm bản mới. **Luật này áp cho cả token variables** (không chồng thế hệ giá trị).
- Duplicate root names là QA failure vì làm automation và handoff không xác định được target.

### 3.2 Bố cục flow

```text
Entry → Ready → Interaction overlay → Success
          │              │
          ├→ Loading     ├→ Validation error
          ├→ Empty       └→ Confirm/destructive
          └→ Error/retry
```

State hiếm nhưng quan trọng như stale, permission denied, quota exhausted, payment underpaid hoặc concurrency conflict phải nằm gần flow chính, không bị chôn trong một vùng rời rạc.

---

## 4. Quy ước đặt tên (bảng tra nhanh)

| Loại | Pattern | Ví dụ |
|---|---|---|
| Screen | `Screen / <Module> / <Surface> / <State> / <Device>` | `Screen / Orders / List / Ready / Desktop` |
| Role-specific | thêm `/ <Role>` trước state | `Screen / Dashboard / Overview / CTV / Ready / Desktop` |
| Panel phụ | `Panel / <Entity> / <State>` | `Panel / Order Detail / Pending` |
| Modal | `Modal / <Action> / <State>` | `Modal / Confirm Payment / Validation Error` |
| Dialog | `Dialog / <Flow> / <Step-State>` | `Dialog / Onboarding / Bot Token Error` |
| Bot mockup | `Bot / <Flow> / <State> / <Locale>` | `Bot / USDT Payment / Underpaid / VI` |
| Chart/khối | `Chart / <Metric> / <Variant>` | `Chart / Revenue / Grouped Bars` |
| Component | `Category/Name` | `Button/Primary`, `Table/DataRow`, `KarmaTier/Diamond` |
| Variable | `--<semantic>` | `--primary`, `--space-md`, `--radius-lg`, `--karma-tier-1` |
| Theme axis | `<axis>: [values]` | `mode: [light, dark]` |
| Canvas note | `SECTION / <Order> / <Module> / <Status>` | `SECTION / 20 / Orders / CURRENT` |

Quy tắc bổ sung:

- Dùng một separator convention duy nhất trong toàn file.
- Không dùng từ mơ hồ như `new`, `old`, `test2`, `final`, `updated` trong canonical name.
- Theme và device chỉ đưa vào tên khi thật sự có frame riêng; nếu chỉ là property override thì ghi trong metadata/note.
- Giữ glossary nghiệp vụ: `fulfilled` không tự đổi thành `delivered` nếu domain coi đó là hai state khác nhau.
- Tên component là API cho designer và automation; đổi tên cần update inventory và references.

---

## 5. Templates copy-paste

### 5.1 Authority & Phase Contract

```text
Project: ______________________________
Design slice / release: _______________
Business authority: ___________________
UI authority: _________________________
Visual/token authority: _______________
Token value canonical (file): _________
Current phase: ________________________
In scope: _____________________________
Negative scope: _______________________
Open decisions blocking design: ______
Canonical .pen file: __________________
Inventory owner: ______________________
```

### 5.2 BRD Extraction Worksheet

```
Module: __________________  (BRD §___, FR-__ → FR-__)
Phase / priority:      _______________________________
Primary actor/job:     _______________________________
Business rules/locks: _______________________________
Candidate surfaces:   _______________________________
Negative visibility:  _______________________________
Enum/state machine:   _______________________________
Fields (PRD/TDD):      _______________________________
States/edge cases:     _______________________________
Responsive needs:     _______________________________
Ngữ cảnh sử dụng (NFR): ______________________________
Pricing/permission gate: _____________________________
```

### 5.3 Requirement-to-Surface Matrix

| FR/NFR | Phase | Actor | User job | Trigger | Data/action | Permission | State/edge | Surface | Status/reason |
|---|---|---|---|---|---|---|---|---|---|
| FR-x.y | P1 | Admin | … | … | … | Admin only | ready/error | Screen / … | mapped |
| NFR-x | all | system | … | … | … | N/A | no UI | — | no-direct-ui: … |

Allowed status:

```text
mapped | no-direct-ui | gap-open | blocked-open-decision | deferred-phase | removed
```

### 5.4 Screen Inventory Matrix

| ID | Module | Kind | Canonical name | Role | State | Device | Theme | Phase | BRD refs | Main components | Status |
|---|---|---|---|---|---|---|---|---|---|---|---|
| SCR-DASH-001 | Dashboard | Screen | Screen / Dashboard / Overview / Ready / Desktop | Admin | ready | desktop | light | P1 | FR-7.1 | Sidebar, StatCard, Table | CURRENT |

Coverage is **row-based**, không tính bằng tích Descartes. Chỉ thêm row khi tổ hợp có behavior/hierarchy cần kiểm riêng.

### 5.5 Token Mapping & Drift Table

| Semantic role | Token doc | `.pen` variable | Component sample | Screen sample | Aligned? | Decision |
|---|---|---|---|---|---|---|
| Primary CTA | `#…` | `$--primary = #…` | Button/Primary | Dashboard CTA | yes/no | … |
| Heading font | … | `$--font-heading` | PageHeader | Dashboard title | yes/no | … |

Literal allowlist:

| Literal | Allowed scope | Reason | Owner | Review date |
|---|---|---|---|---|
| `#…` | Chart series 3 only | No semantic token yet | … | … |

### 5.6 Component Taxonomy Checklist

```
[ ] Primitives: Button* Input* Select Checkbox Toggle Chip* Avatar* Badge* Tooltip Progress Pagination Skeleton*
[ ] Domain (1 variant / enum): Status/* ProductType/* KarmaTier/* <YourEnum>/* ...
[ ] Composite: StatCard PageHeader FilterBar Sidebar/* Tab*/TabBar Table/* Modal/* Toast/* EmptyState ConfirmDialog/*
[ ] States: default / hover / focus / disabled / destructive as required
[ ] Every repeated pattern is a ref/instance, or has a documented reason not to be
[ ] Component names are unique and follow Category/Name
```

### 5.7 Per-Surface Coverage Checklist

```
Surface ID / canonical name: __________________________
BRD/feature refs: _____________________________________
Primary job/action: ___________________________________
[ ] Ready/data     [ ] Loading     [ ] Empty + next action
[ ] Error + retry [ ] Filter/search empty [ ] Validation
[ ] Success feedback [ ] Destructive confirm [ ] Permission denied
Flow states required: _________________________________
Roles required: ______________________________________
Negative visibility checked: __________________________
Devices required: desktop __ tablet __ mobile __
Responsive transformation: ____________________________
Themes required: light __ dark __
Canonical status: CURRENT __ REVIEW __ ARCHIVE __
```

### 5.8 Definition of Done (QA)

```
[ ] Authority + phase contract đã chốt; open blockers được ghi rõ
[ ] 100% Must FR là `mapped` hoặc `no-direct-ui` (có lý do); không còn `gap-open` / `blocked-open-decision`
[ ] Không có orphan screen/panel/modal
[ ] Screen Inventory khớp các frame CURRENT trong .pen
[ ] Mọi enum/state trong BRD có token (coverage check vs Token Needs §5.10)
[ ] Contrast WCAG AA ở cả light lẫn dark theme
[ ] Semantic token không drift giữa doc / variables / components / screens
[ ] .pen variables không chứa 2 thế hệ giá trị chồng nhau
[ ] Literal colors/values chỉ nằm trong allowlist
[ ] Layout không collapse / không tràn frame
[ ] Component reuse qua ref (không copy tay UI lặp)
[ ] Table đúng Table→Row→Cell→content
[ ] Đủ state/role/device theo các tổ hợp hợp lệ trong inventory
[ ] Negative visibility/RBAC đã được kiểm riêng
[ ] Responsive behavior khớp NFR, không lấy mobile bot mockup thay web mobile
[ ] Naming đúng convention (§4)
[ ] Không có duplicate canonical names hoặc bản v2 mơ hồ
[ ] CURRENT / REVIEW / ARCHIVE phân vùng rõ
[ ] Screenshot và hierarchy khớp Feature Spec
[ ] Snapshot/layout check không có clipping/overflow ngoài chủ ý
[ ] placeholder:true đã gỡ hết
[ ] Conflict Resolution Log và Coverage Audit đã cập nhật
[ ] Mapping doc handoff có đủ Icon Map / Decorative / Sample data / Assets / Micro-interactions (Bước 10)
```

### 5.9 Coverage & Audit Report

```text
Audit date: __________________
Audited .pen: ________________
BRD/PRD/feature versions: ____

Inventory
- Top-level objects: ______
- CURRENT screens: ________
- Components: _____________
- Variables/themes: ________

Coverage
- Must FR mapped: ___ / ___
- NFR with design evidence: ___ / ___
- BRD enums with tokens: ___ / ___
- Role gaps: __________________
- State gaps: _________________
- Device gaps: _______________

System health
- Token drift: _______________
- Stacked token generations: __
- Literal allowlist violations: _
- Duplicate canonical names: ___
- Deprecated frames outside archive: _
- Placeholder/layout issues: ____

Verdict: READY / NOT READY
Blocking actions: ______________
```

### 5.10 Token Needs Matrix (output Bước 6A)

| Nhu cầu | Nguồn BRD | Nhóm token | Trạng thái |
|---|---|---|---|
| Trạng thái thanh toán | FR 1.3 (PENDING/CONFIRMED) | `--success`, `--warning` + subtle | ✅ có |
| Karma 4 tiers | FR 3.3 (🔴🟡🟢💎) | `--karma-tier-1..4` + subtle | ❌ thiếu |
| Trạng thái sân | FR 4.1 (Trống/Cọc/Đã TT) | `--venue-free/held/paid` | ❌ thiếu |
| Số tiền hiển thị | Module 1 | Typography Financial/Tabular | ⚠️ có ở .md, chưa vào .pen |
| Môn thể thao | §1, FR 3.2 | `--sport-*` | ✅ có |
| Dùng ngoài trời | NFR §5 | `--touch-target`, contrast, light default | ✅ có |

---

## 6. Ví dụ xuyên suốt

### 6.1 BotShopez — Dashboard: một FR mở rộng thành screen contract

```
BRD FR-7.1 "Dashboard: doanh thu tổng, doanh thu từng CTV, stock"
  └─► feature_dashboard.md UC-1: layout 4 zone (stat cards / chart / bán chạy / cần xử lý)
        └─► design-tokens.md: --primary, --background-card, --radius-lg, --spacing-md
              └─► components: StatCard, TabBar, Table/*, Sidebar/V3
                    └─► BotShopez.pen current frame: "Screen / Dashboard v2 (Light)"
                          ├─► ready/loading/empty/error variants
                          └─► CTV-scoped dashboard variants
```

Tên `Dashboard v2` là tên đang tồn tại trong file; theo convention playbook, canonical mới nên là `Screen / Dashboard / Overview / Ready / Desktop`, còn version nằm trong changelog/metadata.

### 6.2 BotShopez — RBAC và CTV: permission trở thành negative visibility

BRD quy định CTV không thấy credential data, đơn/doanh thu của CTV khác và không được quản lý kho. Kết quả design không chỉ là "ẩn menu":

- Sidebar/navigation khác role.
- CTV dashboard dùng số liệu scoped.
- Product/credential surface có read-only/hidden behavior.
- `PAUSED` và `DEBT_PAUSED` có blocking state riêng.
- Admin có CTV list/detail/quota/debt/reconciliation; CTV có self-setup/pricing/quota/debt/orders/settings.

File hiện có 84 root frames `CTV / ...`: 33 Admin-view và 51 CTV self-service. Role/state có thể làm surface count tăng mạnh; inventory và naming phải giữ được quan hệ với BRD.

### 6.3 BotShopez — Orders: state machine trở thành panel variants

Order management cho thấy một list screen không đủ. File hiện có 52 panels, trong đó 36 biến thể `Order Detail`: pending, paid, delivering, delivered/fulfilled, cancelled, expired; invite/preorder/manual fulfillment; underpaid, payment detected after expiry, stale pending; USDT và PayPal states.

Mỗi variant phải tồn tại vì content/action/guard khác nhau, không chỉ vì badge đổi màu.

### 6.4 BotShopez — Enum BRD → component variants

| BRD | → Component |
|---|---|
| Order state machine (§4.6, FR-6) | `Status/{Pending,Paid,Delivered,Cancelled,Expired,Delivering}` |
| `FR-3.3` 3 product types | `ProductType/{Credential,Invite,Preorder}` |
| `FR-17.5` link states | `LinkStatus/{Live,Redeemed,Expired,Dead,Sold,Unknown,InDB,Cached}` |
| Module 12 discount flags | `DiscountBadge/{Group,User,Hidden,NewUser}` |
| `§4.5` data isolation CTV | Dashboard/Sidebar bản CTV + `CTVSidebarDebt`, `CTVSidebarLeaderboard` |

### 6.5 BotShopez — NFR responsive: requirement chưa được chứng minh bằng `.pen`

BRD yêu cầu admin panel mobile-first từ 375px. Audit `.pen` cho thấy: 251/251 root frames `Screen / ...` đều rộng 1440px; 20 frames 390×844 là Telegram bot mockups — **không được** tính là responsive coverage của admin web. NFR-10 phải giữ `gap-open` cho tới khi có design evidence.

### 6.6 Sporta — token drift và enum không token (case study cho Bước 6)

**Drift 3 nguồn 3 giá trị (phát hiện 2026-07):**

| Nguồn | `--primary` | `--bg` dark |
|---|---|---|
| `.pen` (entries mới nhất) | `#059669` xanh lá (chồng lên `#6200EE` tím cũ chưa dọn) | `#0F0F14` |
| `design-tokens.md` | `#6200EE` tím | `#0F0F14` |
| `design-tokens.css` | `#6200EE` tím | `#121212` (cũ nhất) |

Nguyên nhân: 2 doc cùng tự nhận SSOT + sửa tay từng file + append thế hệ token mới không dọn cũ. Fix theo §1.2 (pipeline 1 chiều) + §2 Bước 6D (drift audit).

**Enum trong BRD chưa có token:** Karma 4 tiers (FR 3.3), trạng thái sân (FR 4.1) — đã "gợi ý màu" ngay trong BRD (🔴🟡🟢💎) nhưng bị bỏ sót vì không chạy lăng kính 3 của Bước 6A → các màn Phase 4/5 sẽ hardcode màu nếu không bổ sung.

**Token sinh đúng từ BRD (mẫu tốt):** NFR "ngoài trời, nút lớn, tương phản cao" → `--touch-target: 48px` + light default; Module Fintech → semantic payment colors + typography Financial/Tabular; danh sách môn thể thao → `--sport-*` adaptive accents; benchmark 7 app → tím ngược đối thủ, `#121212` không pure black, dual-font.

---

## 7. Anti-patterns cần tránh

**Về phương pháp:**

- ❌ Vẽ `.pen` thẳng từ BRD, bỏ qua Feature Spec → bịa layout, sót state.
- ❌ Không chốt authority/phase → trộn future roadmap vào current product.
- ❌ Tạo full Cartesian product của screen × state × role × breakpoint → nhiều frame không có giá trị kiểm chứng.
- ❌ Có screen nhưng không có BRD/feature reference → orphan surface.
- ❌ Có Must FR nhưng không có surface hoặc `no-direct-ui` reason → coverage giả.
- ❌ Bỏ qua enum/state machine trong BRD khi tokenize → hardcode màu ở màn hình tương ứng (Sporta: Karma tiers, venue states).
- ❌ Không tạo token doc/needs trước → màu/spacing loạn, không có nguồn sự thật.
- ❌ Tin rằng có file token đồng nghĩa `.pen` đã aligned → phải audit variables và representative nodes.
- ❌ 2+ file cùng tự nhận "source of truth" → 3 file 3 giá trị (Sporta + BotShopez đều dính).
- ❌ Append thế hệ token mới không dọn thế hệ cũ → `.pen` chứa cả tím lẫn xanh lá.
- ❌ Cập nhật 1 file quên file kia (Inter vào `.md` nhưng không vào `.pen`) → dùng pipeline generate, không sửa tay.
- ❌ Token per-screen chứa giá trị mới (`--fab-icon`, `--time-badge-bg`) → chỉ được alias về core token.
- ❌ Vẽ từng screen như ốc đảo → quên role/state/breakpoint.
- ❌ Copy-paste UI thay vì `ref` component → sửa 1 chỗ phải sửa 84 chỗ.
- ❌ Tạo `Dashboard v2`, `Settings V2`, `final` nhưng không archive bản cũ → không biết frame nào canonical.
- ❌ Lấy mobile Telegram mockup làm bằng chứng responsive cho web admin.

**Về design-to-code:**

- ❌ Code UI từ trí nhớ, không đọc spec → sai ~30%.
- ❌ Chỉ dùng 1 nguồn tham khảo khi code → dừng ở 80–90% accuracy; cần ≥2, tốt nhất 3 nguồn.
- ❌ Dùng emoji làm icon UI → render khác mỗi OS, không control size/stroke/color; dùng Lucide SVG.
- ❌ Component không ghi JSDoc nguồn → debug sai lệch không biết giá trị lấy từ đâu.

**Về Pencil (schema-specific):**

- ❌ Hardcode semantic color/spacing thay vì variable; ngoại lệ one-off không có allowlist.
- ❌ Dùng `%`, `vh`, `calc()` cho `width/height` — **không hỗ trợ**.
- ❌ Text không set `fill` → vô hình.
- ❌ Nhét nội dung thẳng vào Table Row, bỏ qua Cell frame.
- ❌ Để node trần (text/icon/shape) ở document root.
- ❌ Set `layout`/`padding` trên node không phải `frame`.
- ❌ Duplicate root names → search/automation có thể chọn sai target.
- ❌ Quên `placeholder:true` trong lúc dựng hoặc quên gỡ khi hoàn tất.

---

## 8. Áp dụng cho dự án mới (quick-start)

1. Điền **Authority & Phase Contract** (§5.1) — nhớ chốt luôn file nào là canonical giá trị token.
2. Trích từng module bằng **BRD Extraction Worksheet** (§5.2).
3. Lập **Requirement-to-Surface Matrix** (§5.3); đóng mọi Must FR về status hợp lệ.
4. Viết/hoàn thiện **Feature Spec FE**: job, zones, field, action, state, role, device, edge cases.
5. Dựng **Screen Inventory** (§5.4) bằng các tổ hợp hợp lệ và canonical status.
6. **Build tokens từ BRD** (Bước 6A–6D): Token Needs Matrix (§5.10) → benchmark → kiến trúc 3 lớp + theme → khai báo `.pen` variables → drift table (§5.5) + WCAG check.
7. Xây component library theo primitives → domain → composites (§5.6), variants bind vào token state-enum.
8. Compose từng canonical screen/flow; verify từng root frame trước khi chuyển feature khác.
9. Chạy per-surface checklist, DoD và Coverage Audit (§5.7–§5.9).
10. Handoff design-to-code (Bước 10): mapping doc đủ 5 mục + JSDoc audit trail.

> Với **Plexco**: hệ token + component sẽ khác (design system riêng), nhưng *quy trình* và *templates* giữ nguyên. Chỉ thay nội dung enum/role/screen theo BRD Plexco — và áp dụng đúng HARD RULE sẵn có của Plexco: đọc canonical trước khi đề xuất, quyết định chưa chốt ghi proposal vào decision log.

---

## 9. Tài liệu tham chiếu

- Audit thực tế BotShopez: `botshopez-design-audit.md` (project saas-bot-tele — bằng chứng nguồn, bảng xác minh số liệu).
- Case study Sporta: `docs/design/design-tokens.md`, `sporta-design-tokens-recommendation.md` (benchmark 7 app), `design-to-code-improve.md` (retro 4 lần iterate), `design-token-sporta.pen`.
- File tiền nhiệm (đã supersede): `brd-to-pen-playbook.md` v2.0, `design-token-playbook.md`.

---

*Đúc kết từ `saas-bot-tele-brd.md` ↔ `BotShopez.pen` (Pencil schema v2.14) + Sporta BRD v1.3 ↔ `design-token-sporta.pen` + retro design-to-code Sporta.*
