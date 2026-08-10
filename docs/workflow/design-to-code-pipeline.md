# Design-to-Code Pipeline — Plexco

> **Version:** 1.1 · 2026-08-10
> **Nguồn:** Adapted từ Sporta `front-end/README.md` + `design-to-code-improve.md`
> **Stack:** Vanilla CSS + design tokens (no Tailwind)

### Related Docs

| Doc | Mục đích |
|-----|----------|
| [fe-handoff-template.md](../templates/feature-dev/fe-handoff-template.md) | Template tạo handoff |
| [fe-token-mapping-template.md](../templates/feature-dev/fe-token-mapping-template.md) | Template mapping tokens |
| [handoff-example.md](examples/handoff-example.md) | Ví dụ thật (Sporta Home) |
| [design-token-playbook.md](design-token-playbook.md) | Cách mine tokens từ BRD |
| [glassmorphism-recipe.md](recipes/glassmorphism-recipe.md) | CSS glass effect recipe |
| [design-tokens.md](../standards/design-tokens.md) | Token SSOT |

---

## Pipeline Overview

```
.pen (design file)
    │
    ▼
Step 1: Identify Nodes ─── mcp_pencil_batch_get
    │
    ▼
Step 2: pixel-perfect-handoff.md ─── Extract measurements
    │
    ▼
Step 3: token-mapping.md ─── Map .pen values → CSS variables
    │
    ▼
Step 4: Code Components ─── Build with source comments
    │
    ▼
Step 5: Verify Pixel-Perfect ─── Side-by-side 3 breakpoints
```

### Accuracy Rule (from Sporta retro)

> **1 source ≈ 80–90% accuracy, 3 sources ≈ 98%.** Quy trình chuẩn:
> `.pen` (verify bằng MCP tools) → `mapping.md` → code → cross-check `handoff.md`

---

## Step 1: Identify Design Nodes

Xác định Node ID của screen/component trong `.pen` file.

**MCP Commands:**
```bash
# Lấy structure tree
mcp_pencil_batch_get (nodeId: "{root_frame}", readDepth: 3)

# Lấy screenshot verify
mcp_pencil_get_screenshot (nodeId: "{frame_id}")

# Lấy icon list
mcp_pencil_batch_get (patterns: [{type: "icon_font"}])
```

**Quy tắc:**
- Mỗi feature track node IDs trong handoff doc
- Frame naming: `Screen / {Name} / {State} / {Device}`

---

## Step 2: Create Pixel-Perfect Handoff

**Template:** [`fe-handoff-template.md`](../templates/feature-dev/fe-handoff-template.md)
**Example:** [`handoff-example.md`](examples/handoff-example.md)
**Output:** `docs/channels/web/handoff/<screen>-handoff.md`

**Quy tắc đo:**
- Mỗi component 1 section, thứ tự từ trên xuống
- KHÔNG suy đoán — chỉ ghi giá trị đọc được từ `.pen`
- Ghi rõ: `height`, `padding`, `gap`, `fontSize`, `fontWeight`, `color`, `borderRadius`, `shadow`

**Icon specification (5 thuộc tính BẮT BUỘC):**

```markdown
### 🔷 Icon: {tên} (ID: {nodeId})
- library: {lucide | Material Symbols Rounded | ...}
- name: {icon-name}
- size: {W}×{H}
- fill: $--{token} ({hex})
- weight: {value} (nếu Material Symbols)
```

> ⚠️ KHÔNG đoán icon library — `lucide` và `Material Symbols Rounded` import khác nhau.

**5 mục thường THIẾU trong handoff (từ Sporta retro — 4 lần iterate Home Screen):**

| # | Mục | Ví dụ |
|---|-----|-------|
| 1 | **Icon Map** đầy đủ | Lucide `Bell` 20×20 `--text-secondary` — KHÔNG emoji |
| 2 | **Decorative elements** | Gradient stops, glow shadow, notification dot |
| 3 | **Sample data** | Vietnamese text đúng length, "85,000đ" — production-shaped |
| 4 | **Asset/avatar specs** | Size, radius, placeholder, fallback |
| 5 | **Micro-interactions** | Hover scale 0.97, active shadow, transition duration |

---

## Step 3: Create Token Mapping

**Template:** [`fe-token-mapping-template.md`](../templates/feature-dev/fe-token-mapping-template.md)
**Output:** `docs/channels/web/handoff/<screen>-token-mapping.md`

**Format (vanilla CSS):**

```markdown
## ComponentName
| .pen value | CSS variable | Fallback | Nguồn |
|---|---|---|---|
| height: 54 | height: 54px | — | handoff §4.1 |
| padding: [14,24,0,24] | padding: 14px 24px 0 24px | — | handoff §4.1 |
| fontSize: 15 | font-size: var(--font-size-base) | 15px | handoff §3 |
| color: #6200EE | color: var(--primary) | — | handoff §2 |
```

**Icon mapping:**

```markdown
## Icons
| .pen icon | Library | Import | JSX/HTML | Ghi chú |
|---|---|---|---|---|
| lucide / bell / 20×20 | lucide-react | `import { Bell }` | `<Bell size={20} />` | PascalCase |
```

**Token còn thiếu:** Giá trị chưa có token → đề xuất vào `design-tokens.md`, KHÔNG dùng literal.

---

## Step 4: Code Components

**Quy tắc:**
1. **Shared components** (`components/shared/`) — dùng chung ≥2 screens
2. **Feature components** (`components/<feature>/`) — chỉ dùng trong 1 feature
3. **Source tracing BẮT BUỘC:**
   ```javascript
   /** Source: feature_{name}.md §3.2 + handoff §4.1 */
   ```
4. **KHÔNG hardcode** — dùng CSS variables từ `:root`
5. **4 states:** mỗi view/component phải handle loading / ready / empty / error
6. **KHÔNG BAO GIỜ code UI từ trí nhớ** — luôn đọc từ handoff/mapping (~30% sai khi dùng trí nhớ)

---

## Step 5: Verify Pixel-Perfect

**Checklist:**

- [ ] So sánh side-by-side: code running vs .pen screenshot (`mcp_pencil_get_screenshot`)
- [ ] Check spacing, colors, typography, shadows, radius
- [ ] Test 3 breakpoints: **375px** (mobile), **768px** (tablet), **1440px** (desktop)
- [ ] Touch targets ≥ 44px
- [ ] Hover effects hoạt động
- [ ] Dark mode (nếu applicable)
- [ ] Icons đúng library/name/size (không emoji)
- [ ] `font-variant-numeric: tabular-nums` cho số tiền
- [ ] Fix delta → quay lại Step 4 → verify lại

---

## Golden Rules

1. **`.pen` là source of truth duy nhất** — mọi giá trị design đều đọc từ đây
2. **KHÔNG bao giờ đoán** — nếu không đọc được từ .pen thì hỏi lại
3. **3 file luôn sync**: `.pen` → `handoff.md` → `mapping.md` → code
4. **Khi .pen thay đổi** → cập nhật handoff → cập nhật mapping → cập nhật code
5. **Design tokens chung** chỉ cần cập nhật 1 lần trong `design-tokens.md`
6. **Mọi CSS value PHẢI dùng `var(--token)`** — không hardcode hex/rgba
7. **Mỗi component có JSDoc source** — audit trail handoff §X + mapping §Y

---

## Anti-Patterns (từ Sporta retro — đã xảy ra thật)

| Anti-pattern | Hậu quả | Phòng |
|---|---|---|
| Code UI từ trí nhớ | Sai ~30% | Luôn đọc handoff/mapping |
| Emoji làm icon | Render khác mỗi OS | Icon library + 5 attributes |
| Hardcode hex trong component | Drift khi đổi token | `var(--token)` everywhere |
| Skip handoff → code thẳng từ .pen | Thiếu sample data, micro-interactions | Luôn qua 5-step pipeline |
| Không verify ở mobile breakpoint | Layout vỡ ≤375px | Verify 3 breakpoints bắt buộc |

---

## Checklist khi thêm screen mới

```
1. □ Xác định Node ID của screen trong .pen (mcp_pencil_batch_get)
2. □ Tạo pixel-perfect-handoff.md (template: fe-handoff-template.md)
3. □ Tạo token-mapping.md (template: fe-token-mapping-template.md)
4. □ Code components (with source comments)
5. □ Verify pixel-perfect (3 breakpoints + dark mode)
6. □ Cross-check: handoff ↔ mapping ↔ code consistent
```

---

## Changelog

| Date | Version | Thay đổi |
|------|---------|----------|
| 2026-08-10 | 1.1 | Added: MCP commands, 5 often-missed items, 3-source accuracy rule, anti-patterns table, cross-references to examples/templates/recipes, tabular-nums check, JSDoc source rule |
| 2026-08-09 | 1.0 | Initial — adapted from Sporta front-end/README.md |
