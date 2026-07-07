# 🎨 Design Tokens — Web App

> **Version:** v0.1 · 2026-06-19
> **Áp dụng cho:** `apps/web` (plexco.app)
> **Template gốc:** `../../templates/design-tokens-template.md`

---

## Quy tắc

1. **Mọi giá trị** (color, spacing, typography, radius, shadow) PHẢI khai báo CSS variable trong `:root`
2. **KHÔNG hardcode** hex/rgba/px trong component CSS — luôn dùng `var(--token)`
3. **Naming:** `--{category}-{variant}` → `--primary`, `--primary-hover`, `--bg-card`
4. Thêm color mới → thêm vào `:root` kèm ghi chú

---

## Colors

```css
:root {
  /* --- Brand --- */
  --primary: hsl(243, 75%, 59%);           /* Indigo — main CTA */
  --primary-hover: hsl(243, 75%, 50%);
  --primary-light: hsl(243, 75%, 95%);
  --primary-dark: hsl(243, 75%, 35%);

  /* --- Semantic --- */
  --success: hsl(152, 69%, 41%);           /* Green — paid, confirmed */
  --success-light: hsl(152, 69%, 95%);
  --warning: hsl(38, 92%, 50%);            /* Amber — partial, pending */
  --warning-light: hsl(38, 92%, 95%);
  --error: hsl(0, 84%, 60%);              /* Red — overdue, failed */
  --error-light: hsl(0, 84%, 95%);
  --info: hsl(205, 86%, 53%);

  /* --- Neutral (light mode) --- */
  --bg-page: hsl(220, 14%, 96%);
  --bg-card: hsl(0, 0%, 100%);
  --bg-sidebar: hsl(230, 25%, 18%);
  --bg-input: hsl(220, 14%, 96%);
  --border: hsl(220, 13%, 91%);
  --border-hover: hsl(220, 13%, 80%);

  /* --- Text --- */
  --text-primary: hsl(222, 47%, 11%);
  --text-secondary: hsl(215, 16%, 47%);
  --text-muted: hsl(215, 16%, 65%);
  --text-inverse: hsl(0, 0%, 100%);
  --text-link: var(--primary);

  /* --- Sport badges --- */
  --sport-badminton: hsl(142, 71%, 45%);
  --sport-pickleball: hsl(25, 95%, 53%);
  --sport-tennis: hsl(48, 96%, 53%);
  --sport-football: hsl(217, 91%, 60%);
}
```

### Dark mode

```css
@media (prefers-color-scheme: dark) {
  :root {
    --bg-page: hsl(222, 47%, 11%);
    --bg-card: hsl(223, 30%, 16%);
    --bg-sidebar: hsl(230, 30%, 12%);
    --bg-input: hsl(223, 30%, 20%);
    --border: hsl(223, 20%, 25%);
    --border-hover: hsl(223, 20%, 35%);
    --text-primary: hsl(210, 40%, 96%);
    --text-secondary: hsl(215, 20%, 65%);
    --text-muted: hsl(215, 16%, 50%);
  }
}
```

---

## Typography

```css
:root {
  /* --- Font families --- */
  --font-body: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
  --font-heading: 'Outfit', var(--font-body);
  --font-mono: 'JetBrains Mono', 'Fira Code', monospace;

  /* --- Font sizes (rem) --- */
  --text-xs: 0.75rem;     /* 12px */
  --text-sm: 0.875rem;    /* 14px */
  --text-base: 1rem;      /* 16px */
  --text-lg: 1.125rem;    /* 18px */
  --text-xl: 1.25rem;     /* 20px */
  --text-2xl: 1.5rem;     /* 24px */
  --text-3xl: 1.875rem;   /* 30px */
  --text-4xl: 2.25rem;    /* 36px */

  /* --- Line heights --- */
  --leading-tight: 1.25;
  --leading-normal: 1.5;
  --leading-relaxed: 1.75;

  /* --- Font weights --- */
  --font-normal: 400;
  --font-medium: 500;
  --font-semibold: 600;
  --font-bold: 700;
}
```

---

## Spacing

```css
:root {
  --space-1: 0.25rem;    /* 4px */
  --space-2: 0.5rem;     /* 8px */
  --space-3: 0.75rem;    /* 12px */
  --space-4: 1rem;       /* 16px */
  --space-5: 1.25rem;    /* 20px */
  --space-6: 1.5rem;     /* 24px */
  --space-8: 2rem;       /* 32px */
  --space-10: 2.5rem;    /* 40px */
  --space-12: 3rem;      /* 48px */
  --space-16: 4rem;      /* 64px */
}
```

---

## Radius & Shadows

```css
:root {
  --radius-sm: 0.375rem;   /* 6px — inputs, badges */
  --radius-md: 0.5rem;     /* 8px — cards, buttons */
  --radius-lg: 0.75rem;    /* 12px — modals, panels */
  --radius-xl: 1rem;       /* 16px — hero cards */
  --radius-full: 9999px;   /* pill buttons, avatars */

  --shadow-sm: 0 1px 2px hsla(0, 0%, 0%, 0.05);
  --shadow-md: 0 4px 6px -1px hsla(0, 0%, 0%, 0.1), 0 2px 4px -2px hsla(0, 0%, 0%, 0.1);
  --shadow-lg: 0 10px 15px -3px hsla(0, 0%, 0%, 0.1), 0 4px 6px -4px hsla(0, 0%, 0%, 0.1);
  --shadow-xl: 0 20px 25px -5px hsla(0, 0%, 0%, 0.1), 0 8px 10px -6px hsla(0, 0%, 0%, 0.1);
}
```

---

## Breakpoints

```css
/* Desktop-first responsive */
/* Default: >= 1440px */
@media (max-width: 1024px) { /* tablet */ }
@media (max-width: 768px)  { /* mobile landscape */ }
@media (max-width: 375px)  { /* mobile portrait */ }
```

---

## Transitions

```css
:root {
  --transition-fast: 150ms ease;
  --transition-base: 200ms ease;
  --transition-slow: 300ms ease;
  --transition-spring: 300ms cubic-bezier(0.34, 1.56, 0.64, 1);
}
```

---

## Z-index Scale

```css
:root {
  --z-dropdown: 100;
  --z-sticky: 200;
  --z-overlay: 300;
  --z-modal: 400;
  --z-toast: 500;
}
```

---

*Design tokens v0.1. Finalize trước P4 implementation. Khi dùng trong code: `color: var(--primary);` — không `color: #6366f1;`.*

---

## Changelog

| Ngày | Version | Thay đổi |
|------|---------|----------|
| 19/06/2026 | — | Thêm Changelog table |
| 18/06/2026 | v0.1 | Initial design tokens draft |
