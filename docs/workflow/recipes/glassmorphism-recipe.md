# Glassmorphism Recipe — CSS Design Pattern

> **Ported from Sporta** (2026-08-10) — Adapted cho vanilla CSS (no Tailwind).
> **Nguồn gốc:** `Sporta/docs/design/sporta-glassmorphism.md`
> **Mục đích:** Recipe chuẩn cho hiệu ứng glass (frosted blur, mesh gradient, sticky header). Copy tokens vào `design-tokens.md`, code vào CSS.

---

## 1. Glassmorphism Tokens

> Thêm vào `:root` trong `design-tokens.md` nếu project sử dụng glass effects.

### Light Mode (`:root` / `[data-theme="light"]`)

| Token | Value | Dùng cho |
|-------|-------|----------|
| `--glass-bg` | `rgba(255,255,255,0.7)` | Nền glass — card, search |
| `--glass-bg-strong` | `rgba(255,255,255,0.85)` | Header sticky, bottom nav |
| `--glass-bg-subtle` | `rgba(255,255,255,0.4)` | Overlay nhẹ |
| `--glass-blur` | `24px` | Backdrop-filter blur chính |
| `--glass-blur-sm` | `12px` | Blur cho elements nhỏ |
| `--glass-border` | `rgba(255,255,255,0.3)` | Viền glass — edge highlight |
| `--glass-border-subtle` | `rgba(255,255,255,0.15)` | Viền nhẹ cho cards |
| `--glass-shadow` | `0 8px 32px rgba(0,0,0,0.08)` | Shadow nhẹ |
| `--glass-shadow-lg` | `0 16px 48px rgba(0,0,0,0.12)` | Shadow lớn cho hero |
| `--glass-text-shadow` | `0 1px 2px rgba(0,0,0,0.06)` | Text readability |

### Dark Mode (`[data-theme="dark"]`)

| Token | Value | Ghi chú |
|-------|-------|---------|
| `--glass-bg` | `rgba(15,15,20,0.75)` | Warm dark tint |
| `--glass-bg-strong` | `rgba(15,15,20,0.9)` | Header, nav |
| `--glass-bg-subtle` | `rgba(15,15,20,0.5)` | Glass nhẹ |
| `--glass-blur` | `20px` | Ít hơn light mode |
| `--glass-blur-sm` | `10px` | Blur nhẹ |
| `--glass-border` | `rgba(255,255,255,0.08)` | Viền trắng nhẹ |
| `--glass-border-subtle` | `rgba(255,255,255,0.05)` | Subtle |
| `--glass-shadow` | `0 8px 32px rgba(0,0,0,0.3)` | Shadow đậm hơn |
| `--glass-shadow-lg` | `0 16px 48px rgba(0,0,0,0.4)` | Shadow lớn |

---

## 2. Mesh Gradient Background

Nền gradient cố định — content scroll trên nền này, tạo hiệu ứng glass khi `backdrop-filter: blur()`.

### Light Mode

```css
body::before {
  content: '';
  position: fixed;
  inset: 0;
  z-index: -1;
  background:
    /* Layer 1: Primary — top-left */
    radial-gradient(ellipse 60% 50% at 15% 10%,
      rgba(var(--primary-rgb), 0.08) 0%, transparent 70%),
    /* Layer 2: Accent — bottom-right */
    radial-gradient(ellipse 50% 60% at 85% 90%,
      rgba(var(--accent-rgb), 0.06) 0%, transparent 70%),
    /* Layer 3: Primary-light — center */
    radial-gradient(ellipse 40% 40% at 50% 50%,
      rgba(var(--primary-light-rgb), 0.04) 0%, transparent 60%),
    /* Base */
    linear-gradient(180deg, var(--bg), var(--bg-elevated));
  pointer-events: none;
}
```

### Dark Mode

```css
[data-theme="dark"] body::before {
  background:
    radial-gradient(ellipse 60% 50% at 15% 10%,
      rgba(var(--primary-rgb), 0.15) 0%, transparent 70%),
    radial-gradient(ellipse 50% 60% at 85% 90%,
      rgba(var(--accent-rgb), 0.08) 0%, transparent 70%),
    radial-gradient(ellipse 40% 40% at 50% 50%,
      rgba(var(--primary-light-rgb), 0.06) 0%, transparent 60%),
    linear-gradient(180deg, var(--bg), var(--bg-elevated));
}
```

---

## 3. Component Patterns

### 3.1 Sticky Frosted Header

```css
.top-bar {
  position: sticky;
  top: 0;
  z-index: 100;
  height: var(--topbar-height, 56px);
  background: var(--glass-bg-strong);
  backdrop-filter: blur(var(--glass-blur));
  -webkit-backdrop-filter: blur(var(--glass-blur));
  border-bottom: 1px solid var(--glass-border);
  transition: box-shadow var(--duration-fast, 150ms) var(--easing-default, ease);
}

.top-bar.scrolled {
  box-shadow: var(--glass-shadow);
}
```

### 3.2 Glass Card

```css
.glass-card {
  background: var(--glass-bg);
  backdrop-filter: blur(var(--glass-blur-sm));
  -webkit-backdrop-filter: blur(var(--glass-blur-sm));
  border: 1px solid var(--glass-border-subtle);
  border-radius: var(--radius-lg, 16px);
  box-shadow: var(--glass-shadow);
  padding: var(--space-md, 16px);
  transition: transform var(--duration-fast, 150ms) var(--easing-default, ease),
              box-shadow var(--duration-fast, 150ms) var(--easing-default, ease);
}

.glass-card:active {
  transform: scale(0.97);
  box-shadow: var(--glass-shadow-lg);
}
```

### 3.3 Hero Card — Colored Glass

```css
.hero-card {
  background: linear-gradient(
    135deg,
    rgba(var(--primary-rgb), 0.2),
    rgba(var(--accent-rgb), 0.1)
  );
  backdrop-filter: blur(var(--glass-blur));
  -webkit-backdrop-filter: blur(var(--glass-blur));
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-xl, 24px);
  box-shadow: var(--glass-shadow-lg);
}
```

### 3.4 Bottom Navigation

```css
.bottom-nav {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  z-index: 100;
  height: calc(var(--tabbar-height, 56px) + env(safe-area-inset-bottom));
  padding-bottom: env(safe-area-inset-bottom);
  background: var(--glass-bg-strong);
  backdrop-filter: blur(var(--glass-blur));
  -webkit-backdrop-filter: blur(var(--glass-blur));
  border-top: 1px solid var(--glass-border);
}
```

### 3.5 Glass Input

```css
.glass-input {
  background: var(--glass-bg-subtle);
  backdrop-filter: blur(var(--glass-blur-sm));
  -webkit-backdrop-filter: blur(var(--glass-blur-sm));
  border: 1px solid var(--glass-border-subtle);
  border-radius: var(--radius-md, 12px);
  padding: var(--space-sm, 8px) var(--space-md, 16px);
  color: var(--text);
}

.glass-input:focus {
  border-color: var(--primary);
  box-shadow: 0 0 0 3px var(--primary-subtle);
}
```

---

## 4. Scroll Interaction

```javascript
// Header shadow on scroll
const topBar = document.querySelector('.top-bar');
window.addEventListener('scroll', () => {
  topBar.classList.toggle('scrolled', window.scrollY > 10);
}, { passive: true });
```

---

## 5. Glass Hierarchy (Depth Levels)

```
┌─────────────────────────────────────┐
│  Level 3: Header (strong glass)     │  opacity 0.85, blur 24px
├─────────────────────────────────────┤
│  ┌───────────────────────────────┐  │
│  │  Level 2: Hero Card           │  │  colored gradient, blur 24px
│  └───────────────────────────────┘  │
│  ┌───────────────────────────────┐  │
│  │  Level 1: Standard Card       │  │  opacity 0.7, blur 12px
│  └───────────────────────────────┘  │
│  ┌───────────────────────────────┐  │
│  │  Level 0: Stat/Subtle Card    │  │  opacity 0.4, blur 12px
│  └───────────────────────────────┘  │
│  Level -1: Mesh Gradient (fixed)    │  3-layer radial gradient
├─────────────────────────────────────┤
│  Level 3: Bottom Nav (strong glass) │  opacity 0.85, blur 24px
└─────────────────────────────────────┘
```

---

## 6. Performance & Fallback

### Performance Rules

| Rule | Limit |
|------|-------|
| Max glass elements visible simultaneously | **≤ 5** |
| Low-end device detection | `navigator.hardwareConcurrency <= 4` → reduce blur to `8px` |
| `prefers-reduced-motion` | Tắt parallax, giữ static glass |

### Browser Fallback

```css
@supports not (backdrop-filter: blur(1px)) {
  .top-bar, .bottom-nav {
    background: var(--bg-card);
    border-bottom: 1px solid var(--border);
  }
  .glass-card { background: var(--bg-card); }
  body::before { display: none; }
}
```

### Accessibility

```css
@media (prefers-reduced-motion: reduce) {
  .top-bar, .glass-card, .hero-card { transition: none; }
}

@media (prefers-contrast: high) {
  :root {
    --glass-bg: var(--bg-card);
    --glass-bg-strong: var(--bg-card);
    --glass-blur: 0px;
    --glass-border: var(--border);
  }
}
```

---

## Changelog

| Date | Version | Thay đổi |
|------|---------|----------|
| 2026-08-10 | 1.1 | Ported → Plexco: bỏ SwiftUI/Kotlin code, giữ CSS+JS; replace hardcode colors → `var()` + `rgb` pattern; generalize brand colors |
| 2026-02-25 | 1.0 | Sporta original |
