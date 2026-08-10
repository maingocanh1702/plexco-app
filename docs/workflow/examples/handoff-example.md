# Handoff Example — Sporta Home Screen (Reference)

> **📌 Ported from Sporta** — Đây là ví dụ THẬT (không phải template) về pixel-perfect handoff.
> Dùng làm tham khảo khi tạo handoff mới. Template: [`fe-handoff-template.md`](../../templates/feature-dev/fe-handoff-template.md).
> **Nguồn:** `Sporta/docs/handoff/home-screen-final-pixel-perfect-handoff.md` + `home-screen-final-tailwind-mapping.md`

---

## Part A: Pixel-Perfect Handoff

### 1) Frame gốc

- Kích thước: `430 × 932` px
- Background: `#F5F5F7` → `var(--bg)`
- Layout: `vertical`, `clip: true`
- Cấu trúc:
  1. StatusBar (top)
  2. TopBar + ScrollContent
  3. TabBar (bottom, fixed)

### 2) Design tokens sử dụng

**Colors:**

| Token | Value | Vai trò |
|-------|-------|---------|
| `--bg` | `#F5F5F7` | Nền app |
| `--bg-card` | `#FFFFFF` | Nền card |
| `--border` | `#E0E0E0` | Border chính |
| `--primary` | `#6200EE` | Brand CTA |
| `--accent` | `#DFFF00` | Highlight |
| `--danger` | `#FF5252` | Error, notification |
| `--text` | `#1A1A1A` | Text chính |
| `--text-secondary` | `#6B7280` | Text phụ |
| `--text-muted` | `#00000059` | Placeholder |

**Radius:** `sm=8`, `md=12`, `lg=16`, `xl=24`, `full=9999`
**Spacing:** `xs=4`, `sm=8`, `md=16`, `lg=24`, `xl=32`

### 3) Typography spec

| Element | Font | Size | Weight | Color |
|---------|------|------|--------|-------|
| User name | Archivo Black | 18 | 900 | `--text` |
| Section title | Plus Jakarta Sans | 16 | 700 | `--text` |
| Body/meta | Plus Jakarta Sans | 13 | 500/600 | `--text-secondary` |
| Tab label (active) | — | 10 | 700 | `--primary` |
| Tab label (inactive) | — | 10 | 500 | `--text-muted` |

### 4) Layout chi tiết

#### 4.1 StatusBar
- height: `54px`, padding: `14px 24px 0 24px`
- time: fontSize `15`, fontWeight `600`, color `#1A1A1A`
- indicators: gap `6`, icon size `16`

#### 4.2 TopBar
- height: `60px`, justify `space-between`
- Avatar: `44×44`, `border-radius: 9999`
- Greeting: `13px`, weight `400`, color `--text-secondary`
- User name: `18px`, weight `900`, font `Archivo Black`
- Action buttons: `40×40`, `border-radius: 9999`, border `1px --border`, bg `white`
- Notification dot: `10×10`, bg `--danger`, offset `right:6 top:6`

#### 4.3 KarmaDebtStrip
- Grid: `2 columns`, gap `10px`
- Each card: `rounded-2xl`, border `1px --border`, bg `white`, padding `14px 14px`, shadow `0 1px 6px #00000008`
- Icon container: `36×36`, `border-radius: 9999`, bg `{color}-subtle`
- Label: `11px`, weight `500`, color `--text-secondary`
- Value: `16px`, weight `700`, color `--text`

---

## Part B: Token Mapping (CSS Variables)

> Đây là mapping sang **CSS variables** (không Tailwind) — adapted cho Plexco.

### Root Screen

```css
.home-screen {
  max-width: 430px;
  margin: 0 auto;
  min-height: 100dvh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--bg);
}
```

### TopBar

```css
.top-bar {
  display: flex;
  height: 60px;
  align-items: center;
  justify-content: space-between;
}

.top-bar__avatar {
  width: 44px;
  height: 44px;
  border-radius: var(--radius-full);
  overflow: hidden;
}

.top-bar__greeting {
  font-size: var(--font-size-sm, 13px);
  font-weight: 400;
  color: var(--text-secondary);
}

.top-bar__name {
  font-family: 'Archivo Black', sans-serif;
  font-size: 18px;
  font-weight: 900;
  line-height: 1;
  color: var(--text);
}

.top-bar__action {
  width: 40px;
  height: 40px;
  display: grid;
  place-items: center;
  border-radius: var(--radius-full);
  border: 1px solid var(--border);
  background: var(--bg-card);
}

.top-bar__notification-dot {
  position: absolute;
  right: 6px;
  top: 6px;
  width: 10px;
  height: 10px;
  border-radius: var(--radius-full);
  border: 2px solid var(--bg-card);
  background: var(--danger);
}
```

### KarmaDebtStrip

```css
.karma-strip {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: var(--space-sm, 10px);
}

.karma-card {
  display: flex;
  align-items: center;
  gap: var(--space-sm, 10px);
  border-radius: var(--radius-lg);
  border: 1px solid var(--border);
  background: var(--bg-card);
  padding: 12px 14px;
  box-shadow: 0 1px 6px rgba(0,0,0,0.03);
}

.karma-card__icon {
  width: 36px;
  height: 36px;
  display: grid;
  place-items: center;
  border-radius: var(--radius-full);
  /* bg: respective --{color}-subtle */
}

.karma-card__label {
  font-size: 11px;
  font-weight: 500;
  color: var(--text-secondary);
}

.karma-card__value {
  font-size: 16px;
  font-weight: 700;
  color: var(--text);
}
```

### Icons Used

| Icon | Library | Name | Size | Color |
|------|---------|------|------|-------|
| Search | lucide-react | `Search` | 20×20 | `--text-secondary` |
| Bell | lucide-react | `Bell` | 20×20 | `--text-secondary` |
| Home | Material Symbols | `home` | 24×24 | `--primary` (active) |
| Trophy | lucide-react | `Trophy` | 16×16 | `--accent` |
| AlertCircle | lucide-react | `AlertCircle` | 16×16 | `--danger` |

---

## Key Takeaways

1. **Mọi giá trị đều trace về token** — không hardcode hex ngoài `:root`
2. **Icon có đủ 5 thuộc tính** — library, name, size, color, weight
3. **Spacing/radius dùng token** — `var(--space-*)`, `var(--radius-*)`
4. **Source tracing** — mỗi component reference handoff section
5. **Verify tại 3 breakpoints** — 375px, 430px (design), 768px

---

> _Example v1.0 · 2026-08-10 · Adapted from Sporta Home Screen handoff_
