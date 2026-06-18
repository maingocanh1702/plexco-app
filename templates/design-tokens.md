# Design Tokens — Template

> Template cho design tokens. Copy file này khi khởi tạo design system cho project mới.
> Điều chỉnh values theo brand/product cụ thể.

---

## Color Palette

```css
:root {
  /* -- Primary -- */
  --primary: hsl({H}, {S}%, {L}%);
  --primary-hover: hsl({H}, {S}%, {L-7}%);
  --primary-active: hsl({H}, {S}%, {L-13}%);
  --primary-light: hsl({H}, {S}%, 95%);

  /* -- Secondary -- */
  --secondary: hsl({H}, {S}%, {L}%);
  --secondary-hover: hsl({H}, {S}%, {L-6}%);
  --secondary-light: hsl({H}, {S}%, 94%);

  /* -- Semantic -- */
  --success: hsl(142, 71%, 45%);
  --warning: hsl(38, 92%, 50%);
  --error: hsl(0, 84%, 60%);
  --info: hsl(217, 91%, 60%);

  /* -- Neutral (gray scale) -- */
  --gray-50: hsl(210, 20%, 98%);
  --gray-100: hsl(210, 17%, 95%);
  --gray-200: hsl(210, 16%, 89%);
  --gray-300: hsl(210, 14%, 81%);
  --gray-400: hsl(210, 12%, 64%);
  --gray-500: hsl(210, 10%, 47%);
  --gray-600: hsl(210, 12%, 36%);
  --gray-700: hsl(210, 14%, 25%);
  --gray-800: hsl(210, 18%, 15%);
  --gray-900: hsl(210, 22%, 8%);

  /* -- Surfaces -- */
  --bg-primary: hsl(0, 0%, 100%);
  --bg-secondary: var(--gray-50);
  --bg-card: hsl(0, 0%, 100%);
  --text-primary: var(--gray-800);
  --text-secondary: var(--gray-600);
  --text-muted: var(--gray-400);
  --border: var(--gray-200);
}
```

## Typography

```css
:root {
  --font-sans: '{FontFamily}', system-ui, -apple-system, sans-serif;
  --font-mono: 'JetBrains Mono', ui-monospace, monospace;

  --text-xs: 0.75rem;     /* 12px */
  --text-sm: 0.875rem;    /* 14px */
  --text-base: 1rem;      /* 16px */
  --text-lg: 1.125rem;    /* 18px */
  --text-xl: 1.25rem;     /* 20px */
  --text-2xl: 1.5rem;     /* 24px */
  --text-3xl: 1.875rem;   /* 30px */

  --font-normal: 400;
  --font-medium: 500;
  --font-semibold: 600;
  --font-bold: 700;
}
```

## Spacing

```css
:root {
  --space-1: 0.25rem;    /* 4px */
  --space-2: 0.5rem;     /* 8px */
  --space-3: 0.75rem;    /* 12px */
  --space-4: 1rem;       /* 16px */
  --space-6: 1.5rem;     /* 24px */
  --space-8: 2rem;       /* 32px */
  --space-12: 3rem;      /* 48px */
  --space-16: 4rem;      /* 64px */
}
```

## Border & Shadows

```css
:root {
  --radius-sm: 0.375rem;
  --radius-md: 0.5rem;
  --radius-lg: 0.75rem;
  --radius-full: 9999px;

  --shadow-sm: 0 1px 2px 0 hsl(0 0% 0% / 0.05);
  --shadow-md: 0 4px 6px -1px hsl(0 0% 0% / 0.1);
  --shadow-lg: 0 10px 15px -3px hsl(0 0% 0% / 0.1);
}
```

## Transitions

```css
:root {
  --duration-fast: 150ms;
  --duration-normal: 250ms;
  --ease-in-out: cubic-bezier(0.4, 0, 0.2, 1);
}
```

## Quy tắc

1. KHÔNG hardcode hex/rgba — luôn dùng `var(--token)`
2. Naming: `--{category}-{variant}`
3. Thêm token mới → thêm vào file này kèm ghi chú
