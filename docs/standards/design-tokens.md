# Design Tokens — Plexco

> Foundation-level design tokens cho web app. Khai báo CSS custom properties trong `:root`.
> **Khi cần color/spacing/font mới → thêm vào đây kèm ghi chú.**
> v2.1 · 2026-10-15 · **SoT duy nhất cho giá trị token** — `channels/web/design-tokens.md` chỉ còn là pointer (DD-59 ✅).
> **Design System:** xem `design-system.md` (v1.0, 07/08/2026) cho component catalog, usage tokens, layout patterns, motion, a11y, và responsive grid — document đó reference values từ file này.
> **Authority boundary (v2.0):** value set **target C — Energetic Orange + Be Vietnam Pro/Inter đã ACTIVE** (DD-81 chọn Sora/Inter, DD-123 OD-7 đổi heading Sora → Be Vietnam Pro ngày 15/10/2026 vì Sora không có subset vietnamese; DD-122 D1 kích hoạt ngày 12/10/2026, thay cho cổng `design.pen`; xem `channels/web/theme-direction-2026-07.md` §5–§6). Code đọc đúng các giá trị này từ `apps/web/app/globals.css` — file duy nhất được chứa literal màu; `apps/web/app/tokens-only.test.ts` fail nếu component CSS/TSX chứa hex/rgba hoặc dùng `var(--x)` chưa định nghĩa. Nhu cầu token: `token-needs-matrix.md`.
>
> ⚠️ **2026-10-12 — DD-122 D1 (owner):** gate `design.pen`/exporter/drift-proof **không còn áp dụng**; agent triển khai **được activate** target C (Orange `#FF5A1F` · `--on-primary #22100A` · Sora/Inter) vào `apps/web` và cập nhật giá trị trong file này trong PR FE đầu tiên (M1) theo bước 2 §6 `../channels/web/theme-direction-2026-07.md`. Cho tới PR đó, giá trị bên dưới vẫn là Indigo/Outfit (chưa đổi).

---

## 1. Color Palette

### Primary — Energetic Orange (target C, active)

> Chữ trắng trên `#FF5A1F` chỉ đạt 3.12:1 (trượt AA normal text) → `--on-primary` là `#22100A` (5.87:1). Cam dùng làm **chữ** trên nền sáng phải là `--primary-text` (`#B23A0B`, ≥5.7:1); trên nền tối là `#FF8A5C`.

```css
:root {
  /* -- Primary -- */
  --primary: #ff5a1f;           /* main brand — nền nút/chip, KHÔNG dùng làm màu chữ trên nền sáng */
  --primary-hover: #e8480f;     /* on-primary vẫn 4.68:1 */
  --primary-active: #d94410;    /* pressed */
  --on-primary: #22100a;        /* chữ/icon trên --primary */
  --primary-subtle: #ff5a1f1f;  /* 12% alpha — tinted icon container (theme-direction §7 recipe 1) */
  --primary-text: #b23a0b;      /* cam dùng làm chữ/link trên nền sáng */

  /* -- Accent (amber) -- */
  --accent: #f5a524;
  --on-accent: #22100a;

  /* -- Semantic (paid = success · pending = warning · unpaid = error) -- */
  --success: #15803d;  --success-text: #116b31;  --success-subtle: #e7f6ec;
  --warning: #b45309;  --warning-text: #92400e;  --warning-subtle: #fef3dc;
  --error:   #c62828;  --error-text:   #b71c1c;  --error-subtle:   #fdecec;
  --info:    #1d4ed8;  --info-subtle:  #e8eefc;
  --paid: var(--success);
  --pending: var(--warning);
  --unpaid: var(--error);
}
```

### Neutral (warm)

```css
:root {
  --gray-50: #faf8f6;   /* page bg */
  --gray-100: #f3f0ed;
  --gray-200: #e6e2de;  /* borders, dividers */
  --gray-300: #d2cdc8;
  --gray-400: #8a837c;  /* KHÔNG đạt AA cho chữ — chỉ dùng cho viền/disabled */
  --gray-500: #6b6560;  /* muted text (5.7:1 trên trắng) */
  --gray-600: #5c5650;  /* secondary text */
  --gray-700: #3f3a36;
  --gray-800: #25211e;  /* primary text */
  --gray-900: #14110f;
}
```

### Dark Mode

> Hai khối giống hệt nhau: `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { … } }` và `:root[data-theme="dark"] { … }` (CSS không chia sẻ được một danh sách khai báo giữa media query và selector). Chỉ override semantic tokens.

```css
:root[data-theme="dark"] {
  --bg-page: #0f1115;
  --bg-card: #181b21;
  --bg-elevated: #20242c;
  --bg-input: #20242c;
  --bg-overlay: #000000b3;
  --text-primary: #f3f4f6;
  --text-secondary: #b4bac4;
  --text-muted: #9aa1ad;
  --border: #2b303a;
  --border-strong: #6b7280;
  --border-hairline: #ffffff14;
  --focus-ring: #93b4ff;
  --primary-text: #ff8a5c;
  --success-text: #4ade80;  --success-subtle: #143d26;
  --warning-text: #fbbf24;  --warning-subtle: #3d2e0a;
  --error-text: #f87171;    --error-subtle: #4a1a1a;
  --info-subtle: #16254d;
  --primary-subtle: #ff5a1f2e;
  --shadow-card: 0 2px 12px #00000066;
  --shadow-overlay: 0 12px 32px #000000b3;
}
```

### Light Mode (default)

```css
:root {
  --bg-page: var(--gray-50);
  --bg-card: #ffffff;
  --bg-elevated: #ffffff;
  --bg-input: #ffffff;
  --bg-overlay: #14110f80;
  --text-primary: var(--gray-800);
  --text-secondary: var(--gray-600);
  --text-muted: var(--gray-500);
  --text-inverse: #ffffff;
  --text-link: var(--primary-text);
  --border: var(--gray-200);
  --border-strong: var(--gray-400);   /* viền control (≥3:1, WCAG 1.4.11) */
  --border-hairline: #1411140f;
  --focus-ring: #1d4ed8;
}
```

---

## 2. Typography

### Font Stack

```css
:root {
  --font-heading: var(--font-be-vietnam-pro), 'Be Vietnam Pro', var(--font-inter), system-ui, -apple-system, 'Segoe UI', sans-serif;
  --font-sans: var(--font-inter), 'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif;
  --font-mono: 'JetBrains Mono', 'Fira Code', ui-monospace, monospace;
}
```

> Fonts qua `next/font/google` (tự host lúc build, `display: swap`): **Be Vietnam Pro** (subsets `latin`, `latin-ext`, `vietnamese`; weights `600` + `700` — font chỉ có weight tĩnh, mọi heading dùng `--font-bold` 700, `--font-semibold` 600 là token còn lại) cho heading, Inter (`latin`, `vietnamese`) cho body. Subset `vietnamese` của Be Vietnam Pro có `unicode-range` phủ U+1EA0–1EF9 (đo ngày 15/10/2026 từ `font-data.json` của Next 15.5.25 và CSS Google Fonts; CSS build ra được kiểm lại trong `.next`), nên các nguyên âm xếp dấu của tiếng Việt hiện bằng chính font heading, không còn mixed-font. Sora (DD-81, subsets `latin`, `latin-ext` — KHÔNG có `vietnamese`, thiếu U+1EA0–1EF1) đã bị thay (DD-123 OD-7). `--font-be-vietnam-pro` / `--font-inter` do `next/font` gắn trên `<html>`.

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
  --tracking-tight: -0.02em;
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

  /* Card: elevation mềm + hairline (theme-direction §7 recipe 2) */
  --shadow-card: 0 2px 12px #14110f10;
  --shadow-overlay: 0 12px 32px #14110f33;

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
  --container-narrow: 24rem;   /* sign-in card, club chooser */
  --container-form: 28rem;     /* form một cột */
  --container-prose: 32rem;    /* hero copy */
  --container-sm: 640px;
  --container-md: 768px;
  --container-lg: 1024px;
  --container-xl: 1280px;
  --container-max: 1440px;

  /* -- Shell -- */
  --sidebar-width: 240px;   /* >=1024px */
  --rail-width: 72px;       /* 768-1023px icon rail */
  --header-height: 56px;
  --bottom-nav-height: 64px; /* <768px */
  --touch-target: 44px;     /* min interactive size (WCAG 2.5.8) */

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
| `--bp-tablet` | 768px | Bottom nav → icon rail |
| `--bp-desktop` | 1024px | Icon rail → sidebar 240px |
| `--bp-wide` | 1440px | Desktop test baseline |

```css
/* Shell (mobile-first, apps/web/components/shell): */
/* <768px: bottom nav 64px (3 mục) · 768–1023px: icon rail 72px · ≥1024px: sidebar 240px */
/* Media query không đọc được var() — breakpoint là literal trong CSS module (không phải màu). */
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

> Các token chỉ tồn tại ở `channels/web/design-tokens.md` cũ, đưa về SoT dưới dạng **alias về foundation token** khi có thể (playbook: token per-surface chỉ được alias, không giá trị mới). v2.0: `--font-heading` đã chuyển sang Sora, v2.1 sang Be Vietnam Pro (§2); `--bg-page`/`--bg-input` nay là role token ở §1; `--bg-sidebar` bỏ (sidebar dùng `--bg-card`).

```css
:root {
  --text-link: var(--primary-text);
}
```

---

## Conflict Resolution Log

> Merge 19/07/2026 (`channels/web/design-tokens.md` v0.1 → SoT). Quy tắc: SoT thắng trừ khi có lý do ghi rõ.

| Ngày | Token | SoT (giữ) | channels/web (bỏ) | Quyết định / lý do |
|---|---|---|---|---|
| 13/10 | toàn bộ palette | target C (cam `#FF5A1F`) | Indigo/Teal v1.x | DD-122 D1 kích hoạt DD-81; `--on-primary` tối vì trắng/cam = 3.12:1; thêm `*-text`/`*-subtle` cho semantic để chữ đạt AA ở cả hai theme. Lưu ý còn mở: `--sport-pickleball` (green 142) vẫn gần `--success` — re-check ở lane sport accents. |
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
4. Dark mode: override trong `@media (prefers-color-scheme: dark)` **và** `:root[data-theme="dark"]` — chỉ override semantic tokens (`--bg-*`, `--text-*`, `--border*`, `*-text`, `*-subtle`).
5. Component-level tokens: đặt trong file CSS của component, reference foundation tokens.

---

## Changelog

| Ngày | Version | Thay đổi |
|------|---------|----------|
| 15/10/2026 | v2.1 | **Heading font Sora → Be Vietnam Pro (DD-123 OD-7, owner 14/10/2026):** `--font-heading` = `var(--font-be-vietnam-pro), 'Be Vietnam Pro', var(--font-inter), …`; `--font-sora` thay bằng `--font-be-vietnam-pro` (`app/layout.tsx`, `app/tokens-only.test.ts`). Lý do: Sora không có subset `vietnamese`. Be Vietnam Pro có subset `vietnamese` (unicode-range phủ U+1EA0–1EF9, đã kiểm). Weights tải `600` + `700`. Không đổi màu/spacing/type-scale/weight token. |
| 13/10/2026 | v2.0 | **Activate target C (DD-122 D1 / theme-direction §6 bước 2):** Indigo/Outfit → Energetic Orange `#FF5A1F` + Sora/Inter. `--on-primary` `#22100A`; thêm `--primary-text`, `*-text`/`*-subtle` semantic, `--paid/--pending/--unpaid` alias, `--border-strong`/`--border-hairline`, `--focus-ring`, `--shadow-card`, `--touch-target`, shell layout tokens (`--rail-width`, `--header-height`, `--bottom-nav-height`). Giá trị dùng hex (đo contrast được); code = `apps/web/app/globals.css`. Giữ nguyên cấu trúc §1–§10. |
| 28/07/2026 | v1.2 | **Authority/status only; zero value change.** DD-59 chốt `.md` value SoT; DD-81 chọn target C + Sora/Inter nhưng current Indigo/Outfit giữ active tới tracked owner-approved `design.pen` + visual/WCAG/drift gate. |
| 19/07/2026 | v1.1 | **DD-59 reconcile (owner 19/07):** merge `channels/web/design-tokens.md` v0.1 về đây — file đó thành pointer. Thêm §10 (font-heading/bg-page/bg-input/bg-sidebar/text-inverse/text-link, alias-first) + Conflict Resolution Log. Sửa `--sport-tennis` → hsl(48,96%,53%) (SoT cũ trùng `--warning`). Header khai báo SoT duy nhất; link `token-needs-matrix.md`. |
| 19/06/2026 | — | Thêm Changelog table |
| 18/06/2026 | v1.0 | Design tokens foundation |
