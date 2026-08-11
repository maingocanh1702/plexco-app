# 🎨 Design Checklist: `{Feature Name}`

> **FE Spec:** `FE/feature_{name}_fe.md` v{X.X}
> **Designer:** {Tên designer}
> **Ngày bắt đầu:** {YYYY-MM-DD}
> **Target:** design.pen → `Screen / {Feature} / {Screen Name}`

---

## Trước khi bắt đầu — Checklist chuẩn bị

- [ ] Đã đọc FE spec: `FE/feature_{name}_fe.md` (đọc kỹ §1-§7)
- [ ] Đã kiểm tra `design-tokens.md` — tokens hiện có đủ chưa? Cần token mới?
- [ ] Đã kiểm tra `design-system.md` — components nào đã có, cần tạo mới?
- [ ] Đã note các **fixture fence** (phần đánh `UNPINNED — omit active UI`)
- [ ] Đã note **negative scope** — phần nào KHÔNG thuộc feature này

---

## Phase 1: Component Inventory

> Từ §4 Components Used trong FE spec → kiểm tra component library.

| Component (từ FE spec §4) | Đã có trong .pen? | States đủ? | Cần tạo/sửa? |
|---|---|---|---|
| `{ComponentA}` | ☐ Có / ☐ Chưa | ☐ | ☐ |
| `{ComponentB}` | ☐ Có / ☐ Chưa | ☐ | ☐ |
| `{ComponentC}` | ☐ Có / ☐ Chưa | ☐ | ☐ |
| ... | | | |

**Components cần tạo mới:**
1. ...
2. ...

---

## Phase 2: Screen Design (4 States × 3 Breakpoints)

> Mỗi screen trong FE spec §3 → vẽ **4 states** × **3 breakpoints** = tối đa 12 frames.
> Naming convention: `Screen / {Feature} / {ScreenName} — {State} — {Breakpoint}`

### Screen 1: `{Screen Name}` — `/{route}`

| State | 1440px (Desktop) | 768px (Tablet) | 375px (Mobile) |
|---|---|---|---|
| **Loading** | ☐ Skeleton theo FE spec | ☐ | ☐ |
| **Ready** | ☐ Layout theo wireframe | ☐ | ☐ |
| **Empty** | ☐ Icon + text + CTA | ☐ | ☐ |
| **Error** | ☐ Error banner + retry | ☐ | ☐ |

**Notes:**
- Loading skeleton: {copy mô tả từ FE spec §3 States → Loading}
- Empty state: {copy text + CTA từ FE spec §3 States → Empty}
- Error: {copy message từ FE spec §3 Error mapping}
- Responsive: {copy từ FE spec §3 Responsive table}

---

### Screen 2: `{Screen Name}` — `/{route}`

| State | 1440px (Desktop) | 768px (Tablet) | 375px (Mobile) |
|---|---|---|---|
| **Loading** | ☐ | ☐ | ☐ |
| **Ready** | ☐ | ☐ | ☐ |
| **Empty** | ☐ hoặc N/A | ☐ | ☐ |
| **Error** | ☐ | ☐ | ☐ |

**Notes:**
- ...

---

### Screen 3: `{Screen Name}` — `/{route}`

| State | 1440px (Desktop) | 768px (Tablet) | 375px (Mobile) |
|---|---|---|---|
| **Loading** | ☐ | ☐ | ☐ |
| **Ready** | ☐ | ☐ | ☐ |
| **Empty** | ☐ hoặc N/A | ☐ | ☐ |
| **Error** | ☐ | ☐ | ☐ |

**Notes:**
- ...

---

*(Copy thêm block "Screen N" cho mỗi screen trong FE spec §3)*

---

## Phase 3: Edge Case Screens

> Từ FE spec §5 Edge Cases → lọc case nào cần frame riêng, case nào xử lý bằng component state.

| # | Edge Case (từ §5) | Cần frame riêng? | Tên frame | Status |
|---|---|---|---|---|
| 1 | {case description} | ☐ Có / ☐ Không (component state) | `Screen / ... — {EdgeCase}` | ☐ |
| 2 | {case description} | ☐ Có / ☐ Không | | ☐ |
| 3 | {case description} | ☐ Có / ☐ Không | | ☐ |
| ... | | | | |

**Quy tắc:**
- Text quá dài / truncate → ☐ component state (không cần frame riêng)
- Dialog / confirm / bottom sheet → ☐ **cần frame riêng**
- Toast / snackbar → ☐ overlay trên Ready frame (không cần frame riêng)
- Special empty / locked / suspended → ☐ **cần frame riêng**

---

## Phase 4: Error Mapping Frames

> Từ FE spec §3 Error mapping tables → vẽ frame cho mỗi error code quan trọng.

| Error Code | Visible State (từ FE spec) | Cần frame riêng? | Status |
|---|---|---|---|
| `{ERROR_CODE_1}` | {description} | ☐ Có / ☐ Toast | ☐ |
| `{ERROR_CODE_2}` | {description} | ☐ Có / ☐ Redirect | ☐ |
| *(unknown/timeout)* | Fail closed — retry | ☐ Dùng chung Error state | ☐ |

---

## Phase 5: Dark Mode

> DD-57 bắt buộc light + dark cho mọi screen.

- [ ] Tạo dark variant cho mỗi Ready screen (Desktop + Mobile)
- [ ] Verify contrast WCAG AA cho dark mode
- [ ] Tokens dùng đúng: `var(--bg-card)`, `var(--text-primary)`, semantic colors
- [ ] Status badges / chips vẫn đọc được trong dark mode

---

## Phase 6: Interaction & Motion

> Từ FE spec §7 Responsive & Interaction Notes.

| Interaction | Spec (từ §7) | Implemented in .pen? |
|---|---|---|
| Hover effect | {description} | ☐ |
| Transition/animation | {description} | ☐ |
| Touch gesture | {description} | ☐ |
| Keyboard nav | {description} | ☐ |

---

## Phase 7: Data & i18n Verification

> Từ FE spec §6 Data hiển thị.

- [ ] Mọi text trong frame dùng đúng copy từ FE spec §6 `t(vi, en)`
- [ ] Số tiền format "150,000đ" (tabular-nums)
- [ ] Ngày giờ format đúng locale (vi: "05/08 14:22")
- [ ] Badge text đúng enum (ví dụ: "Draft" = "Nháp")
- [ ] Không có text hardcode mà không có trong §6

---

## Coverage Matrix — Tổng kết

> Điền SAU khi hoàn tất → verify không thiếu state nào.

| Screen | Loading | Ready | Empty | Error | Edge Cases | Dark Mode | Tổng frames |
|---|---|---|---|---|---|---|---|
| {Screen 1} | ☐ | ☐ | ☐ | ☐ | {N} | ☐ | |
| {Screen 2} | ☐ | ☐ | ☐ | ☐ | {N} | ☐ | |
| {Screen 3} | ☐ | ☐ | ☐ | ☐ | {N} | ☐ | |
| **Tổng** | | | | | | | **{total}** |

---

## Fixture Fence Log

> Ghi lại những phần bị đánh `UNPINNED — omit active UI` hoặc `design-only fixture`.
> Designer dùng fixture wireframe cho hierarchy/spacing NHƯNG KHÔNG authorize data/interaction.

| Zone / Field | Status | Ghi chú |
|---|---|---|
| {zone/field description} | UNPINNED | {lý do — DTO owner pending / chưa pin} |
| | | |

---

## Sign-off

| Vai trò | Tên | Ngày | Ghi chú |
|---|---|---|---|
| Designer | | | |
| Product Owner | | | |
| FE Lead | | | |

---

_Template v1.0 · 2026-08-10 · Dùng kết hợp với FE Design Spec (`feature_*_fe.md`) và `designer-kickoff.md`_
