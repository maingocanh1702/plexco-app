# Design Tokens — Plexco

> Foundation-level design tokens cho web app. Khai báo CSS custom properties trong `:root`.
> **Khi cần color/spacing/font mới → thêm vào đây kèm ghi chú.**
> v1.2 · 2026-07-28 · **SoT duy nhất cho giá trị token** — `channels/web/design-tokens.md` chỉ còn là pointer (DD-59 ✅).
> **Design System:** xem `design-system.md` (v1.0, 07/08/2026) cho component catalog, usage tokens, layout patterns, motion, a11y, và responsive grid — document đó reference values từ file này.
> **Authority boundary:** current active values bên dưới vẫn là Indigo + Outfit/Inter. DD-81 đã chọn target Candidate C Energetic Orange + Sora/Inter, nhưng chưa activate trước tracked owner-approved `design.pen` + visual/WCAG/drift gate. `design.pen` variables phải match file này; authority flip cần DD mới + exporter + drift proof. Nhu cầu token: `token-needs-matrix.md`.

---

## 1. Color Palette

### Primary (current active: Indigo → Deep Blue)

```css
:root {
  /* -- Primary -- */
  --primary: hsl(243, 75%, 59%);           /* #5B4CF5 — main brand */
  --primary-hover: hsl(243, 75%, 52%);     /* darker on hover */
  --primary-active: hsl(243, 75%, 46%);    /* pressed state */
  --primary-light: hsl(243, 75%, 95%);     /* subtle background */
  --primary-50: hsl(243, 75%, 97%);        /* lightest tint */

  /* -- Secondary (Teal) -- */
  --secondary: hsl(173, 80%, 40%);         /* #0EA5A5 — accent */
  --secondary-hover: hsl(173, 80%, 34%);
  --secondary-light: hsl(173, 80%, 94%);

  /* -- Semantic -- */
  --success: hsl(142, 71%, 45%);           /* #22C55E — paid, active */
  --success-light: hsl(142, 71%, 94%);
  --warning: hsl(38, 92%, 50%);            /* #F59E0B — pending, caution */
  --warning-light: hsl(38, 92%, 95%);
  --error: hsl(0, 84%, 60%);              /* #EF4444 — unpaid, error */
  --error-light: hsl(0, 84%, 95%);
  --info: hsl(217, 91%, 60%);             /* #3B82F6 — informational */
  --info-light: hsl(217, 91%, 95%);
}
```

### Neutral

```css
:root {
  --gray-50: hsl(210, 20%, 98%);           /* lightest bg */
  --gray-100: hsl(210, 17%, 95%);
  --gray-200: hsl(210, 16%, 89%);          /* borders, dividers */
  --gray-300: hsl(210, 14%, 81%);          /* disabled elements */
  --gray-400: hsl(210, 12%, 64%);          /* placeholder text */
  --gray-500: hsl(210, 10%, 47%);          /* secondary text */
  --gray-600: hsl(210, 12%, 36%);          /* body text (light mode) */
  --gray-700: hsl(210, 14%, 25%);          /* headings (light mode) */
  --gray-800: hsl(210, 18%, 15%);          /* near-black */
  --gray-900: hsl(210, 22%, 8%);           /* darkest */
}
```

### Dark Mode

```css
@media (prefers-color-scheme: dark) {
  :root {
    --bg-primary: hsl(220, 20%, 10%);
    --bg-secondary: hsl(220, 18%, 14%);
    --bg-card: hsl(220, 16%, 18%);
    --bg-elevated: hsl(220, 14%, 22%);
    --text-primary: hsl(0, 0%, 95%);
    --text-secondary: hsl(0, 0%, 72%);
    --text-muted: hsl(0, 0%, 50%);
    --border: hsl(220, 14%, 25%);
    --border-hover: hsl(220, 14%, 35%);
  }
}
```

### Light Mode (default)

```css
:root {
  --bg-primary: hsl(0, 0%, 100%);
  --bg-secondary: var(--gray-50);
  --bg-card: hsl(0, 0%, 100%);
  --bg-elevated: hsl(0, 0%, 100%);
  --text-primary: var(--gray-800);
  --text-secondary: var(--gray-600);
  --text-muted: var(--gray-400);
  --border: var(--gray-200);
  --border-hover: var(--gray-300);
}
```

---

## 2. Typography

### Font Stack

```css
:root {
  --font-sans: 'Inter', 'Roboto', system-ui, -apple-system, sans-serif;
  --font-mono: 'JetBrains Mono', 'Fira Code', ui-monospace, monospace;
}
```

> Import Google Fonts: `@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');`

### Type Scale

```css
:root {
  /* -- Font Size (rem) -- */
  --text-xs: 0.75rem;     /* 12px — captions, badges */
  --text-sm: 0.875rem;    /* 14px — secondary text, labels */
  --text-base: 1rem;      /* 16px — body text */
  --text-lg: 1.125rem;    /* 18px — card titles */
  --text-xl: 1.25rem;     /* 20px — section headers */
  --text-2xl: 1.5rem;     /* 24px — page titles */
  --text-3xl: 1.875rem;   /* 30px — hero headers */
  --text-4xl: 2.25rem;    /* 36px — hero large */

  /* -- Font Weight -- */
  --font-normal: 400;
  --font-medium: 500;
  --font-semibold: 600;
  --font-bold: 700;

  /* -- Line Height -- */
  --leading-tight: 1.25;
  --leading-normal: 1.5;
  --leading-relaxed: 1.625;

  /* -- Letter Spacing -- */
  --tracking-tight: -0.025em;
  --tracking-normal: 0;
  --tracking-wide: 0.025em;
}
```

---

## 3. Spacing

```css
:root {
  /* -- Spacing Scale (rem) -- */
  --space-0: 0;
  --space-1: 0.25rem;    /* 4px */
  --space-2: 0.5rem;     /* 8px */
  --space-3: 0.75rem;    /* 12px */
  --space-4: 1rem;       /* 16px — base unit */
  --space-5: 1.25rem;    /* 20px */
  --space-6: 1.5rem;     /* 24px */
  --space-8: 2rem;       /* 32px */
  --space-10: 2.5rem;    /* 40px */
  --space-12: 3rem;      /* 48px */
  --space-16: 4rem;      /* 64px */
  --space-20: 5rem;      /* 80px */
  --space-24: 6rem;      /* 96px */
}
```

---

## 4. Border & Radius

```css
:root {
  --radius-sm: 0.375rem;    /* 6px — chips, badges */
  --radius-md: 0.5rem;      /* 8px — cards, inputs */
  --radius-lg: 0.75rem;     /* 12px — modals, panels */
  --radius-xl: 1rem;        /* 16px — hero cards */
  --radius-full: 9999px;    /* pills, avatars */

  --border-width: 1px;
  --border-width-2: 2px;
}
```

---

## 5. Shadows

```css
:root {
  --shadow-sm: 0 1px 2px 0 hsl(0 0% 0% / 0.05);
  --shadow-md: 0 4px 6px -1px hsl(0 0% 0% / 0.1), 0 2px 4px -2px hsl(0 0% 0% / 0.1);
  --shadow-lg: 0 10px 15px -3px hsl(0 0% 0% / 0.1), 0 4px 6px -4px hsl(0 0% 0% / 0.1);
  --shadow-xl: 0 20px 25px -5px hsl(0 0% 0% / 0.1), 0 8px 10px -6px hsl(0 0% 0% / 0.1);

  /* Glassmorphism */
  --glass-bg: hsl(0 0% 100% / 0.7);
  --glass-blur: blur(12px);
  --glass-border: 1px solid hsl(0 0% 100% / 0.2);
}
```

---

## 6. Transitions & Animations

```css
:root {
  /* -- Duration -- */
  --duration-fast: 150ms;
  --duration-normal: 250ms;
  --duration-slow: 350ms;

  /* -- Easing -- */
  --ease-in-out: cubic-bezier(0.4, 0, 0.2, 1);
  --ease-out: cubic-bezier(0, 0, 0.2, 1);
  --ease-in: cubic-bezier(0.4, 0, 1, 1);
  --ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1);

  /* -- Common transitions -- */
  --transition-colors: color var(--duration-fast) var(--ease-in-out),
                       background-color var(--duration-fast) var(--ease-in-out),
                       border-color var(--duration-fast) var(--ease-in-out);
  --transition-transform: transform var(--duration-normal) var(--ease-out);
  --transition-all: all var(--duration-normal) var(--ease-in-out);
}
```

---

## 7. Layout

```css
:root {
  /* -- Container -- */
  --container-sm: 640px;
  --container-md: 768px;
  --container-lg: 1024px;
  --container-xl: 1280px;
  --container-max: 1440px;

  /* -- Sidebar -- */
  --sidebar-width: 240px;
  --sidebar-collapsed: 64px;

  /* -- Z-index -- */
  --z-base: 0;
  --z-dropdown: 100;
  --z-sticky: 200;
  --z-overlay: 300;
  --z-modal: 400;
  --z-toast: 500;
}
```

---

## 8. Breakpoints

| Token | Value | Sử dụng |
|---|---|---|
| `--bp-mobile` | 375px | Mobile test baseline |
| `--bp-tablet` | 768px | Sidebar collapse → hamburger |
| `--bp-desktop` | 1024px | Sidebar fixed 240px |
| `--bp-wide` | 1440px | Desktop test baseline |

```css
/* Responsive sidebar (desktop-first) */
/* >1024px: fixed 240px */
/* ≤1024px: collapse 64px icon-only */
/* ≤768px: ẩn + hamburger overlay */

/* IDs bắt buộc: #sidebar, #sidebar-backdrop, #menu-toggle */
```

---

## 9. Sport-specific Accent Colors

> Mỗi môn thể thao có accent color riêng cho badges/icons trong marketplace.

```css
:root {
  --sport-badminton: hsl(262, 83%, 58%);     /* purple — cầu lông */
  --sport-pickleball: hsl(142, 71%, 45%);    /* green — ⚠️ trùng --success, re-check khi chốt theme */
  --sport-tennis: hsl(48, 96%, 53%);         /* yellow — v1.1: đổi từ hsl(38,92%,50%) vì trùng --warning */
  --sport-football: hsl(217, 91%, 60%);      /* blue — bóng đá */
  --sport-default: var(--gray-500);          /* fallback */
  /* ⚠️ DD-08 seed 7 môn — còn thiếu padel/volleyball/basketball (xem token-needs-matrix.md §2) */
}
```

---

## 10. Tokens merged từ `channels/web` (v1.1 — 19/07/2026)

> Các token chỉ tồn tại ở `channels/web/design-tokens.md` cũ, đưa về SoT dưới dạng **alias về foundation token** khi có thể (playbook: token per-surface chỉ được alias, không giá trị mới).

```css
:root {
  --font-heading: 'Outfit', var(--font-sans);  /* current active; DD-81 target Sora chỉ activate sau visual/WCAG gate */
  --bg-page: var(--bg-secondary);              /* alias — nền page */
  --bg-input: var(--gray-100);                 /* alias — input, search */
  --bg-sidebar: hsl(230, 25%, 18%);            /* sidebar dark-trong-light (giữ từ channels/web); ⚠️ hue 230 lệch thang neutral 220 — re-check khi chốt theme */
  --text-inverse: hsl(0, 0%, 100%);
  --text-link: var(--primary);
}

@media (prefers-color-scheme: dark) {
  :root {
    --bg-input: var(--bg-elevated);
    --bg-sidebar: hsl(230, 30%, 12%);
  }
}
```

---

## Conflict Resolution Log

> Merge 19/07/2026 (`channels/web/design-tokens.md` v0.1 → SoT). Quy tắc: SoT thắng trừ khi có lý do ghi rõ.

| Ngày | Token | SoT (giữ) | channels/web (bỏ) | Quyết định / lý do |
|---|---|---|---|---|
| 19/07 | `--success` | hsl(142,71%,45%) | hsl(152,69%,41%) | SoT thắng; toàn bộ semantic re-check khi chốt theme |
| 19/07 | `--info` | hsl(217,91%,60%) | hsl(205,86%,53%) | SoT thắng |
| 19/07 | `--primary-hover` | 52% lightness | 50% | SoT thắng |
| 19/07 | `--primary-dark` | — (dùng `--primary-active`) | hsl(243,75%,35%) | Drop — trùng vai trò |
| 19/07 | `--sport-badminton` | purple 262 | green 142 | SoT thắng — bản channels/web trùng `--success` |
| 19/07 | `--sport-pickleball` | green 142 ⚠️ | orange 25 | SoT thắng tạm; green trùng `--success` → đổi khi chốt theme (needs-matrix §2) |
| 19/07 | `--sport-tennis` | **hsl(48,96%,53%)** ← đổi | (nguồn giá trị mới) | **channels/web thắng** — giá trị SoT cũ hsl(38,92%,50%) trùng đúng `--warning` |
| 19/07 | `--leading-relaxed` | 1.625 | 1.75 | SoT thắng |
| 19/07 | `--transition-fast/base/slow` | dùng `--duration-*` + `--ease-*` | alias gộp | Drop — 1 hệ motion duy nhất |

---

## Quy tắc sử dụng

1. **KHÔNG hardcode hex/rgba trong component CSS hoặc JS** — luôn dùng `var(--token)`.
2. Khi cần color/spacing mới → **thêm vào file này** kèm ghi chú, rồi mới dùng.
3. Naming: `--{category}-{variant}` → `--primary`, `--primary-hover`, `--bg-card`.
4. Dark mode: override trong `@media (prefers-color-scheme: dark)` — chỉ override semantic tokens (`--bg-*`, `--text-*`, `--border`).
5. Component-level tokens: đặt trong file CSS của component, reference foundation tokens.

---

## Changelog

| Ngày | Version | Thay đổi |
|------|---------|----------|
| 28/07/2026 | v1.2 | **Authority/status only; zero value change.** DD-59 chốt `.md` value SoT; DD-81 chọn target C + Sora/Inter nhưng current Indigo/Outfit giữ active tới tracked owner-approved `design.pen` + visual/WCAG/drift gate. |
| 19/07/2026 | v1.1 | **DD-59 reconcile (owner 19/07):** merge `channels/web/design-tokens.md` v0.1 về đây — file đó thành pointer. Thêm §10 (font-heading/bg-page/bg-input/bg-sidebar/text-inverse/text-link, alias-first) + Conflict Resolution Log. Sửa `--sport-tennis` → hsl(48,96%,53%) (SoT cũ trùng `--warning`). Header khai báo SoT duy nhất; link `token-needs-matrix.md`. |
| 19/06/2026 | — | Thêm Changelog table |
| 18/06/2026 | v1.0 | Design tokens foundation |
