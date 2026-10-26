# Design System — Plexco

> **Version:** 1.2 · 2026-10-26
> **Status:** ✅ Active design reference
> **Nguồn:** Tổng hợp từ `design-tokens.md` v1.2, `theme-direction-2026-07.md` (DD-81), `token-needs-matrix.md`, `frontend-architecture.md`, `design-brief.md` v2.3, BRD v3.9n, 12 FE spec files.
> **Audience:** Designer (build `.pen`), FE Developer (implement components)
> **Quan hệ:** Document này tổng hợp và mở rộng — `design-tokens.md` vẫn là **value SoT** cho token giá trị. Design system không override token values.
>
> **Dual-track:** Document ghi cả **current active** (Indigo/Outfit) và **target** (Energetic Orange/Be Vietnam Pro). Designer build `.pen` theo **target palette**. Code giữ current cho đến khi visual/WCAG gate đóng (DD-81 §5).
>
> ⚠️ **Ba ràng buộc không được vẽ đè, dù component catalog dưới đây gợi ý gì:**
> 1. **i18n (HARD RULE 5 / FE-INV-4):** mọi chuỗi user-facing đi qua `t(vi, en)` (`packages/core/src/i18n.ts`). Repo **không có key-based i18n** — không viết `t('some.key')`, và mọi copy trong catalog/wireframe phải có **cả bản vi và en**. Copy do server trả (message đã localize) thì FE không tự dịch.
> 2. **Chỉ vẽ cái đã có owner contract.** Field/state mà §6 của FE spec đánh `UNPINNED — omit active UI` thì **không có component**, không vẽ placeholder "tạm". Component bị gỡ được ghi thẳng trong §5.6 kèm lý do — đọc lý do trước khi định vẽ lại.
> 3. **Fail closed.** Response thiếu/unknown/timeout → unavailable placeholder + retry; **không** coerce về 0, empty hay disabled control. Mỗi screen có bảng `#### Error mapping` riêng trong FE spec (31 bảng / 78 mã); design system không tự đặt mã lỗi.
>
> **Đồng bộ:** phiên bản này đã reconcile với 12 FE spec **sau round 4** (2026-08-06). v1.0 tổng hợp từ bản trước round 3/4 nên mang theo 5 component/enum đã bị gỡ khỏi spec — xem changelog v1.1.

---

## §1 — Brand Identity & Theme

### 1.1 Product Positioning

**Plexco** — Platform quản lý & khám phá hoạt động thể thao đa môn.

| Attribute | Value |
|-----------|-------|
| **Vibe** | Bright · Modern · Sporty · Trẻ trung |
| **Target users** | Host (25–45, quản CLB) + Player (18–40, mobile-first) |
| **Platform** | PWA mobile-first (phase-1), Native (phase-2) |
| **Tone** | Năng động, thân thiện, tin cậy cho tài chính |

### 1.2 Theme Direction (DD-81)

| Property | Current Active | Target (DD-81) | Gate |
|----------|---------------|----------------|------|
| **Primary** | Indigo `#5B4CF5` | Energetic Orange `#FF5A1F` | Visual/WCAG gate |
| **Heading font** | Outfit | Be Vietnam Pro | Visual gate |
| **Body font** | Inter | Inter | ✅ (no change) |
| **Accent** | Teal `#0EA5A5` | Amber `#FFB020` | Visual gate |
| **On-primary** | White `#FFFFFF` | Dark `#22100A` (5.874:1 AA) | ✅ Verified |

> ⚠️ **WCAG note:** White text on `#FF5A1F` = 3.118:1 (FAIL AA normal). Dark `#22100A` on `#FF5A1F` = 5.874:1 (PASS AA normal). Primary buttons MUST use dark text.

### 1.3 Brand Keywords → Design Principles

| Keyword | Design Principle | Implementation |
|---------|-----------------|----------------|
| **Energetic** | Warm hue, bold CTAs | Orange primary, gradient heroes |
| **Trustworthy** | Clear financial data, consistent states | Tabular-nums, 4-state screens |
| **Community** | Welcoming empty states, sport identity | Onboarding CTAs, sport accent colors |
| **Modern** | Clean spacing, subtle motion | 8px grid, spring easing, glassmorphism |

---

## §2 — Foundation Tokens

> **Value SoT:** `design-tokens.md` v1.2. Giá trị dưới đây là **target palette** (DD-81). Current active xem `design-tokens.md`.

### 2.1 Color — Primary & Accent (Target)

```css
:root {
  /* -- Primary (Energetic Orange) -- */
  --primary: #FF5A1F;
  --primary-hover: #E8480F;
  --primary-active: #C73D0A;
  --primary-light: #FFF1EB;           /* subtle bg */
  --primary-50: #FFF7F2;              /* lightest tint */
  --on-primary: #22100A;              /* dark text on orange — 5.874:1 */

  /* -- Accent (Amber) -- */
  --accent: #FFB020;
  --accent-hover: #E89E10;
  --accent-light: #FFF8E6;

  /* -- Secondary (Teal — giữ nguyên) -- */
  --secondary: hsl(173, 80%, 40%);
  --secondary-hover: hsl(173, 80%, 34%);
  --secondary-light: hsl(173, 80%, 94%);
}
```

### 2.2 Color — Semantic

```css
:root {
  /* -- Semantic (unchanged across themes) -- */
  --success: #16A34A;                 /* paid, active, verified */
  --success-light: #F0FDF4;
  --success-subtle: #16A34A1F;        /* @12% alpha — tinted bg */

  --warning: #F59E0B;                 /* pending, caution */
  --warning-light: #FFFBEB;
  --warning-subtle: #F59E0B1F;

  --error: #EF4444;                   /* unpaid, error, danger */
  --error-light: #FEF2F2;
  --error-subtle: #EF44441F;

  --info: #3B82F6;                    /* informational */
  --info-light: #EFF6FF;
  --info-subtle: #3B82F61F;
}
```

### 2.3 Color — Neutral (warm-aligned)

```css
:root {
  /* -- Neutrals (warm undertone for Orange theme) -- */
  --gray-50: #FAFAF9;
  --gray-100: #F5F5F4;
  --gray-200: #E7E5E4;
  --gray-300: #D6D3D1;
  --gray-400: #A8A29E;
  --gray-500: #78716C;
  --gray-600: #57534E;
  --gray-700: #44403C;
  --gray-800: #292524;
  --gray-900: #1C1917;
}
```

### 2.4 Surface & Text (Light/Dark)

```css
/* -- Light Mode (default) -- */
:root {
  --bg-primary: #FFFFFF;
  --bg-secondary: var(--gray-50);
  --bg-page: #FFF7F2;                 /* warm tint */
  --bg-card: #FFFFFF;
  --bg-elevated: #FFFFFF;
  --bg-input: var(--gray-100);
  --bg-sidebar: #2D1810;              /* dark warm sidebar */

  --text-primary: var(--gray-800);
  --text-secondary: var(--gray-600);
  --text-muted: var(--gray-400);
  --text-inverse: #FFFFFF;
  --text-link: var(--primary);

  --border: var(--gray-200);
  --border-hover: var(--gray-300);
  --border-hairline: rgba(0, 0, 0, 0.03);
}

/* -- Dark Mode -- */
@media (prefers-color-scheme: dark) {
  :root {
    --bg-primary: #170F0A;
    --bg-secondary: #1D1410;
    --bg-page: #170F0A;
    --bg-card: #221510;
    --bg-elevated: #2D1C14;
    --bg-input: var(--bg-elevated);
    --bg-sidebar: #120A06;

    --text-primary: #F5F5F4;
    --text-secondary: #A8A29E;
    --text-muted: #78716C;

    --border: #3D2E24;
    --border-hover: #57453A;
  }
}
```

### 2.5 Sport-Specific Accent Colors (7 môn — no semantic collision)

```css
:root {
  /* -- Sport Accents (tránh trùng semantic) -- */
  --sport-badminton: #7C3AED;         /* violet — cầu lông */
  --sport-badminton-subtle: #7C3AED1F;
  --sport-pickleball: #06B6D4;        /* cyan — pickleball (đổi từ green trùng success) */
  --sport-pickleball-subtle: #06B6D41F;
  --sport-tennis: #EAB308;            /* yellow — tennis */
  --sport-tennis-subtle: #EAB3081F;
  --sport-football: #2563EB;          /* blue — bóng đá */
  --sport-football-subtle: #2563EB1F;
  --sport-padel: #EC4899;             /* pink — padel (MỚI) */
  --sport-padel-subtle: #EC48991F;
  --sport-volleyball: #F97316;        /* orange-warm — volleyball (MỚI, hue gần primary nhưng distinct) */
  --sport-volleyball-subtle: #F973161F;
  --sport-basketball: #DC2626;        /* red-deep — basketball (MỚI, tối hơn --error) */
  --sport-basketball-subtle: #DC26261F;
  --sport-default: var(--gray-500);   /* fallback cho môn mới */
}
```

### 2.6 Level Badge Ramp (5 bậc — 1-hue gradient)

```css
:root {
  /* -- Skill Level (1-hue ramp: warm amber→deep orange) -- */
  --level-1-beginner: #FCD34D;        /* lightest */
  --level-2-intermediate: #F59E0B;
  --level-3-upper: #EA580C;
  --level-4-advanced: #C2410C;
  --level-5-pro: #9A3412;             /* darkest */

  --level-text: #FFFFFF;              /* white text on all levels */
}
```

---

## §3 — Usage Token Layer

> Aliases mapping domain states → foundation tokens. Mỗi usage token `var(--foundation)`.

### 3.1 Debt/Charge States

```css
:root {
  --debt-unpaid: var(--error);
  --debt-unpaid-bg: var(--error-subtle);
  --debt-partial: var(--warning);
  --debt-partial-bg: var(--warning-subtle);
  --debt-paid: var(--success);
  --debt-paid-bg: var(--success-subtle);
  --debt-reversed: var(--gray-500);
  --debt-reversed-bg: var(--gray-100);
}
```

### 3.2 Reconciliation (killer-feature — distinct color)

```css
:root {
  --reconcile-unmatched: #8B5CF6;     /* purple — distinct from all semantic */
  --reconcile-unmatched-bg: #8B5CF61F;
  --reconcile-matched: var(--success);
  --reconcile-surplus: var(--info);
}
```

### 3.3 Session Lifecycle

```css
:root {
  --session-draft: var(--gray-400);
  --session-open: var(--success);
  --session-full: var(--warning);
  --session-waitlist: var(--info);
  --session-closed: #2563EB;          /* blue */
  --session-expired: var(--gray-500);
  --session-cancelled: var(--error);
}
```

### 3.4 Subscription Lifecycle

```css
:root {
  --sub-trial: var(--info);
  --sub-active: var(--success);
  --sub-pastdue: var(--warning);
  --sub-suspended: var(--error);
}
```

### 3.5 Join/Membership

```css
:root {
  --join-pending: var(--warning);
  --join-approved: var(--success);
  --join-rejected: var(--error);
  --member-guest: var(--gray-400);
  --member-banned: var(--error);
}
```

### 3.6 Payment Source

Enum canonical có **5** giá trị — `auto | manual | cash | waiver | reversal`
(`../features/FE/feature_payment_reconcile.md:275`). Mỗi giá trị một token; **không gộp `auto` với
`manual`** (khớp tự động ≠ host tự xác nhận — khác nguồn phán quyết) và không thêm giá trị ngoài enum.

```css
:root {
  --source-auto: var(--success);      /* khớp tự động từ bank feed */
  --source-manual: var(--info);       /* host xác nhận CK thủ công */
  --source-cash: var(--gray-600);     /* tiền mặt */
  --source-waiver: var(--gray-400);   /* miễn */
  --source-reversal: var(--warning);  /* đảo — append-only, không xoá allocation cũ */
}
```

> ⚠️ **Đã gỡ `--source-attested`.** `attested transfer` không phải nguồn tiền: nó là mã lỗi
> `ATTESTED_TRANSFER_UNSUPPORTED` (409) — tức **chưa hỗ trợ**. Cấp token cho nó ngụ ý một nguồn tiền
> tồn tại, và designer sẽ vẽ trạng thái không có thật.

### 3.7 Sync/Delivery

```css
:root {
  --sync-live: var(--success);
  --sync-pending: var(--warning);
  --sync-stale: var(--error);
  --delivery-fallback: var(--gray-500);
}
```

### 3.8 Capability/Tier Gating

```css
:root {
  --locked: var(--gray-300);
  --locked-bg: var(--gray-100);
  --upgrade-accent: var(--primary);
}
```

---

## §4 — Typography System

### 4.1 Font Stack (Target)

```css
:root {
  --font-heading: 'Be Vietnam Pro', 'Outfit', var(--font-sans);
  --font-sans: 'Inter', 'Roboto', system-ui, -apple-system, sans-serif;
  --font-mono: 'JetBrains Mono', 'Fira Code', ui-monospace, monospace;
}
```

```html
<!-- Google Fonts Import -->
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:wght@400;500;600;700&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
```

> ⚠️ Sora không có subset `vietnamese` nên heading dùng Be Vietnam Pro, face có subset tiếng Việt (DD-131 OD-7). Inter cũng full coverage.

### 4.2 Type Scale

| Token | Size | Use | Font | Weight |
|-------|------|-----|------|--------|
| `--text-xs` | 12px / 0.75rem | Captions, badge labels | Inter | 400–500 |
| `--text-sm` | 14px / 0.875rem | Secondary text, labels, table cells | Inter | 400–500 |
| `--text-base` | 16px / 1rem | Body text, input values | Inter | 400 |
| `--text-lg` | 18px / 1.125rem | Card titles, list headers | Be Vietnam Pro | 500–600 |
| `--text-xl` | 20px / 1.25rem | Section headers | Be Vietnam Pro | 600 |
| `--text-2xl` | 24px / 1.5rem | Page titles | Be Vietnam Pro | 600–700 |
| `--text-3xl` | 30px / 1.875rem | Hero headers | Be Vietnam Pro | 700 |
| `--text-4xl` | 36px / 2.25rem | Landing hero | Be Vietnam Pro | 700 |

### 4.3 Financial Typography

```css
.financial {
  font-family: var(--font-sans);      /* Inter — excellent tabular support */
  font-variant-numeric: tabular-nums;
  font-weight: 600;
  letter-spacing: -0.025em;
}

.pay-code {
  font-family: var(--font-mono);      /* JetBrains Mono */
  font-weight: 500;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}
```

---

## §5 — Component Catalog

> 45+ components extracted từ 12 FE specs. Chia 6 categories.

### 5.1 Navigation

| Component | Variants/States | Source | Token Mapping |
|-----------|----------------|--------|---------------|
| `Sidebar` | expanded (240px), collapsed (64px), hidden+hamburger | Dashboard FE | `--bg-sidebar`, `--sidebar-width/collapsed` |
| `BottomNav` | 4 tabs + center FAB, active highlighted | Home FE | `--primary` active, `--gray-400` inactive |
| `FilterTabs` | horizontal scrollable, active/inactive | Sessions FE | `--primary` underline active |
| `TenantSettingsTabs` | vertical (desktop), horizontal (tablet), dropdown (mobile) | Settings FE | `--border`, `--primary` active |
| `PersonalSettingsTabs` | horizontal/compact | Settings FE | Same as above |
| `Breadcrumb` | separator `>`, current page bold | Dashboard FE | `--text-muted` separator, `--text-primary` current |

### 5.2 Data Display

| Component | Variants/States | Source | Token Mapping |
|-----------|----------------|--------|---------------|
| `StatCard` | loading (skeleton), ready (value+trend), error (dash) | Dashboard FE | `--bg-card`, `--shadow-sm`, trend: `--success`/`--error` |
| `SessionListCard` | default, hover (lift), status variants per `--session-*` | Sessions FE | `--bg-card`, `--shadow-md` hover, `--sport-*-subtle` icon bg |
| `HeroCard` | loading (skeleton), ready (gradient+glow), empty, countdown | Home FE | `--gradient-hero` (3 stop from primary), `--shadow-glow` |
| `ClubCard` | default, hover, debt badge (red) | Player View FE | `--bg-card`, `--debt-*` badge |
| `OutstandingItemCard` | open (orange), partial (yellow) | Player View FE | `--debt-unpaid`, `--debt-partial` |
| `StatusBadge` | draft/open/closed/cancelled + semantic | Sessions FE | `--session-*` colors |
| `UnreadBadge` | count (1–99), 99+ | Chat FE | `--error` bg, white text |
| `CountdownBadge` | active (counting), expired | Settings FE | `--warning` bg |
| `ProgressBar` | 0–100%, color: green >80%, yellow 50–80%, red <50% | Sessions FE | `--success`/`--warning`/`--error` |
| `Avatar` | image, initials circle, size sm/md/lg | Shared | `--primary-light` bg for initials |
| `FinanceChips` | loading, ready (value), error (dash), zero (proven green) | Home FE | `--debt-*`, `--success` for zero |
| `UpcomingRow` | default, payment dot (🔴 open, ⚠️ partial), unavailable | Home/Player FE | `--debt-*`, `--gray-300` unavailable |
| `MemberRow` | active, left (grayed), banned (red border) | Members FE | `--member-*` tokens |

### 5.3 Input

| Component | Variants/States | Source | Token Mapping |
|-----------|----------------|--------|---------------|
| `TextField` | default, focus (primary ring), error (red ring), disabled | Shared | `--bg-input`, `--primary` focus, `--error` error |
| `SearchBar` | idle, focus, loading (spinner), results | Marketplace FE | `--bg-input`, `--primary` focus |
| `SportSelector` | dropdown with sport icons | Sessions FE | `--sport-*` icon colors |
| `DateTimePicker` | date picker, time picker | Sessions FE | `--primary` selected date |
| `CapacityInput` | positive finite, private-unlimited, +/- buttons | Sessions FE | `--primary` buttons |
| `VisibilityToggle` | private (lock), public (globe) | Sessions FE | `--gray-400` / `--primary` |
| `UsernameInput` | default, checking (debounce), available ✅, taken ❌ | Settings FE | `--success` / `--error` feedback |
| `GenderSelector` | dropdown: Nam, Nữ, Khác, Không tiết lộ | Settings FE | Standard select |
| `MessageInput` | default, focus, sending, slash hint, read-only, denied | Chat FE | `--bg-input`, `--primary` focus |
| `MentionPicker` | loading, ready, empty, denied | Chat FE | `--bg-elevated`, `--primary` selected |
| `FilterChips` | selected, unselected, scrollable horizontal | Marketplace FE | `--primary` selected, `--gray-200` unselected |
| `PaymentSourceSelector` | cash selected, bank selected | Sessions FE | Radio: `--primary` selected |

### 5.4 Feedback

| Component | Variants/States | Source | Token Mapping |
|-----------|----------------|--------|---------------|
| `Toast` | success (green), error (red), warning (yellow), info (blue) | Shared | `--success/error/warning/info` bg |
| `EmptyState` | icon + title + description + CTA button | All screens (FE-INV-1) | `--gray-400` icon, `--primary` CTA |
| `ErrorState` | icon + title + description + retry + error code | All screens (FE-INV-1) | `--error` icon, `--primary` retry |
| `LoadingSkeleton` | card, table row, form, chart variants | All screens (FE-INV-1) | `--gray-100` / `--gray-200` shimmer |
| `ConfirmDialog` | title + description + cancel/confirm buttons | Sessions/Settings FE | `--bg-card`, `--primary` confirm, `--error` danger confirm |
| `OfflineBanner` | visible, hidden | Home FE | `--warning` bg |
| `MergedBanner` | visible, dismissed | Player View FE | `--info` bg |
| `NotificationBell` | idle (no badge), unread (pulse + badge), max (99+) | Notifications FE | `--error` badge |

### 5.5 Layout

| Component | Variants/States | Source | Token Mapping |
|-----------|----------------|--------|---------------|
| `Card` | default, hover (shadow lift), selected (primary border) | Shared | `--bg-card`, `--shadow-sm/md`, `--border-hairline` |
| `Modal` | centered overlay, close button, sizes sm/md/lg | Shared | `--bg-card`, `--shadow-xl`, `--z-modal` |
| `Panel` | full-screen (mobile), side panel (desktop) | Notifications FE | `--bg-card`, `--z-overlay` |
| `PageHeader` | title + breadcrumb + action buttons | Dashboard FE | `--text-primary` title, `--primary` action |
| `SectionDivider` | text label ("Mới", "Cũ hơn") | Notifications FE | `--gray-300` line, `--text-muted` label |
| `OnboardingStepper` | steps with progress, completed/active/upcoming | Onboarding FE | `--primary` active, `--success` completed, `--gray-300` upcoming |

### 5.6 Domain-Specific

| Component | Variants/States | Source | Token Mapping |
|-----------|----------------|--------|---------------|
| ~~`ServerPaymentWidget`~~ | **KHÔNG có component này** | Sessions FE | `feature_sessions_fe.md:402` — payment widget **omit hoàn toàn** tới khi owner contract Reviewed. FE **không** dựng QR/STK/pay_code, kể cả từ `payAction` player-self. Đừng vẽ |
| `RosterTable` | loading, ready, empty, error | Sessions FE | `--bg-card`, `--debt-*` payment status |
| `MarkPaidPanel` | collapsed, expanded, confirming, success | Sessions FE | `--primary` confirm, `--source-*` radio |
| `MergeReview` | `hasFinancialHistory=false` (✅ Merge) · `true` / unknown / denied / dependency error (🔒 disabled) | Members FE | `--success` merge, `--locked` disabled. **Gate là `hasFinancialHistory` server-owned, KHÔNG phải số nợ hiện tại** — nợ = 0 vẫn chặn nếu từng có lịch sử tiền (HARD RULE 4) |
| `BankAccountCard` | no-row, connecting, registered, active, drift, error, revoked | Settings FE | `--success/warning/error` per state |
| `ConnectorCard` | **lifecycle canonical:** `connecting` · `registered` · `active` · `drift` · `error` · `revoked` | Settings FE | `--success/warning/error` per state. **Không có `disconnected`** (`feature_settings_fe.md:155`: "không invent `disconnected`" — server không trả row thì render empty "Chưa đăng ký"). `insufficient_grant` và expired/revoked authorization là **overlay**, không phải status; `expired_token` là một *reason* của `error` → dùng `--locked` cho overlay, không cấp bậc lifecycle riêng |
| `ThreadRow` | default, unread (bold + badge), selected | Chat FE | `--primary-light` selected, bold unread |
| `MessageBubble` | sent (primary), received (gray), edited, tombstone | Chat FE | `--primary` sent, `--gray-100` received. **Không có variant `system`** — `feature_chat_fe.md:217`: chưa producer nào được authorize ghi system message (chỉ P7 bot SECURITY DEFINER), và session join/slot activity còn deferred bởi `NTF-OQ-18` |
| `NotificationItem` | unread (● dot + bold), read (normal), hover | Notifications FE | `--primary` dot, `--bg-elevated` hover |
| `ClubPayAction` | absent, ready, loading, error | Player View FE | `--primary` CTA, `--error` error state |
| `SessionForm` | create mode, edit mode (pre-filled) | Sessions FE | Standard form tokens. **Không có `impact_policy` selector** — `feature_sessions_fe.md:371`: đổi giá khi đã có charges thì Save **bị block**, chỉ trình bày hai policy target, "không tự invent `impact_policy`". Cũng **không có field SĐT sân** (DD-50: phase-1 không thu SĐT) |

---

## §6 — Layout Patterns

### 6.1 Dashboard Layout (Host — Desktop)

```
┌──────────┬──────────────────────────────────────────┐
│          │  Header: Title · Notifications 🔔 · CTA  │
│ Sidebar  ├──────────────────────────────────────────┤
│ 240px    │                                          │
│          │  Content Area                            │
│ Nav:     │  ┌─────────┐ ┌─────────┐ ┌─────────┐   │
│ 📊 Tổng  │  │StatCard │ │StatCard │ │StatCard │   │
│ 📅 Buổi  │  └─────────┘ └─────────┘ └─────────┘   │
│ 💰 Thu   │                                          │
│ 👥 TV    │  ┌───────────────────┬──────────────┐   │
│ ⚙️ Đặt   │  │  Primary Content  │  Side Panel  │   │
│          │  └───────────────────┴──────────────┘   │
└──────────┴──────────────────────────────────────────┘
```

### 6.2 Mobile PWA Layout (Player)

```
┌────────────────────────┐
│  Header: Logo · 💬 🔔  │
├────────────────────────┤
│                        │
│  Content (scrollable)  │
│                        │
│  ┌──────────────────┐  │
│  │   Hero Card      │  │
│  └──────────────────┘  │
│  ┌──────────────────┐  │
│  │   Content List   │  │
│  └──────────────────┘  │
│                        │
├────────────────────────┤
│ 🏠  📰  [🔍]  🏟️  ⚙️ │
│ Home Feed Discover Club Set│
└────────────────────────┘
```

### 6.3 Responsive Sidebar Rules

| Breakpoint | Sidebar | Content |
|------------|---------|---------|
| >1024px | Fixed 240px, expanded with labels | Full width - 240px |
| ≤1024px | Collapsed 64px, icon-only | Full width - 64px |
| ≤768px | Hidden + hamburger overlay | Full width |

**IDs bắt buộc:** `#sidebar`, `#sidebar-backdrop`, `#menu-toggle`

### 6.4 Card Grid

```css
.card-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: var(--space-4);
}

.card-grid > * {
  min-width: 0;
  overflow: hidden;
}
```

### 6.5 Form Layout

```css
.form-container {
  max-width: 640px;
  margin: 0 auto;
  padding: var(--space-6);
}

.form-field + .form-field {
  margin-top: var(--space-4);
}
```

---

## §7 — 4-State Design Philosophy (FE-INV-1)

> **Bắt buộc:** Mọi screen data-driven PHẢI xử lý đủ 4 states.

### 7.1 Loading State (⏳ Skeleton)

- **Pattern:** Skeleton screens, KHÔNG dùng spinner (trừ inline actions)
- **Colors:** `--gray-100` base, `--gray-200` shimmer pulse
- **Animation:** Shimmer left→right, `--duration-slow` (350ms)
- **Variants:**
  - Skeleton Card: rounded rect matching card dimensions
  - Skeleton Table: 3–5 rows of gray bars
  - Skeleton Form: gray bars matching input heights
  - Skeleton Chart: static tinted bars

```css
.skeleton {
  background: linear-gradient(90deg,
    var(--gray-100) 25%,
    var(--gray-200) 50%,
    var(--gray-100) 75%
  );
  background-size: 200% 100%;
  animation: shimmer var(--duration-slow) ease-in-out infinite;
  border-radius: var(--radius-md);
}

@keyframes shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
```

### 7.2 Ready State (✅ Data)

- **Goal:** Maximum efficiency and clear navigation
- **Patterns:** Animated count-ups for stats, interactive tables, live data
- **Financial values:** `tabular-nums`, right-aligned

### 7.3 Empty State (📭 Onboarding)

- **Pattern:** Large icon + welcoming title + contextual description + primary CTA
- **KHÔNG dùng:** Plain "Không có dữ liệu" text
- **Structure:**

```
┌──────────────────────────────┐
│        (large icon)          │
│                              │
│    "Chưa có buổi chơi nào"  │
│    "Tạo buổi chơi đầu tiên │
│     để bắt đầu quản lý"     │
│                              │
│    [🏸 Tạo buổi chơi]      │
│                              │
│    (optional: guide steps)   │
└──────────────────────────────┘
```

- **Colors:** Icon = `--gray-400`, Title = `--text-primary`, Desc = `--text-secondary`, CTA = `--primary`

### 7.4 Error State (❌ Recovery)

- **Pattern:** Distinct icon + concise title + non-technical explanation + retry CTA + error code (discreet)
- **Structure:**

```
┌──────────────────────────────┐
│        (error icon)          │
│                              │
│    "Không thể tải dữ liệu"  │
│    "Kiểm tra kết nối mạng   │
│     và thử lại"              │
│                              │
│    [🔄 Thử lại]             │
│                              │
│    Mã lỗi: DASH_LOAD_001   │
└──────────────────────────────┘
```

- **Colors:** Icon = `--error`, Title = `--text-primary`, Code = `--text-muted` (12px)

---

## §8 — Motion & Interaction

### 8.1 Transition Tokens

```css
:root {
  --duration-fast: 150ms;
  --duration-normal: 250ms;
  --duration-slow: 350ms;

  --ease-in-out: cubic-bezier(0.4, 0, 0.2, 1);
  --ease-out: cubic-bezier(0, 0, 0.2, 1);
  --ease-in: cubic-bezier(0.4, 0, 1, 1);
  --ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1);
}
```

### 8.2 Interaction Patterns

| Interaction | Animation | Duration | Easing |
|-------------|-----------|----------|--------|
| Button hover | `background-color` shift | `--duration-fast` | `--ease-in-out` |
| Card hover | `translateY(-2px)` + shadow lift | `--duration-normal` | `--ease-out` |
| Modal open | `scale(0.95→1)` + `opacity(0→1)` | `--duration-normal` | `--ease-spring` |
| Toast enter | `translateY(100%→0)` + `opacity` | `--duration-normal` | `--ease-spring` |
| Toast exit | `translateY(0→100%)` + `opacity` | `--duration-fast` | `--ease-in` |
| Badge pulse | `scale(1→1.2→1)` | 600ms | `--ease-spring` |
| Stat count-up | Number increment animation | 800ms | `--ease-out` |
| Progress fill | `width` transition | `--duration-slow` | `--ease-out` |
| Skeleton shimmer | `background-position` loop | `--duration-slow` | `--ease-in-out` |
| Tab switch | `border-bottom` slide | `--duration-fast` | `--ease-out` |

### 8.3 Hero Gradient & Glow (from Sporta benchmark §7)

```css
.hero-card {
  background: linear-gradient(
    135deg,
    var(--primary) 0%,
    color-mix(in srgb, var(--primary), white 30%) 60%,
    color-mix(in srgb, var(--primary), black 20%) 100%
  );
  box-shadow: 0 8px 28px color-mix(in srgb, var(--primary), transparent 75%);
}

/* CTA pill on hero */
.hero-cta {
  background: #FFFFFF;
  color: var(--on-primary);
  box-shadow: 0 2px 12px rgba(255, 255, 255, 0.33);
}
```

### 8.4 Glassmorphism

```css
.glass {
  background: rgba(255, 255, 255, 0.7);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid rgba(255, 255, 255, 0.2);
}

@media (prefers-color-scheme: dark) {
  .glass {
    background: rgba(23, 15, 10, 0.8);
    border: 1px solid rgba(255, 255, 255, 0.08);
  }
}
```

---

## §9 — Accessibility (A11y)

### 9.1 Contrast Requirements (WCAG AA)

| Surface | Text Color | Background | Ratio | Status |
|---------|-----------|------------|-------|--------|
| Primary button | `#22100A` | `#FF5A1F` | 5.874:1 | ✅ AA |
| Body text (light) | `#292524` | `#FFFFFF` | 14.68:1 | ✅ AAA |
| Body text (dark) | `#F5F5F4` | `#170F0A` | 15.12:1 | ✅ AAA |
| Secondary text | `#57534E` | `#FFFFFF` | 7.14:1 | ✅ AA |
| Muted text | `#A8A29E` | `#FFFFFF` | 3.36:1 | ⚠️ Large only |
| Error on white | `#EF4444` | `#FFFFFF` | 3.94:1 | ⚠️ Large + icon |

> **Rule:** Muted text (`--text-muted`) chỉ dùng cho captions ≥ 14px bold hoặc ≥ 18px. Error indicators PHẢI có icon đi kèm (không dùng color-only).

### 9.2 Touch Targets

```css
:root {
  --touch-target: 44px;               /* Apple HIG minimum */
}

/* Ensure all interactive elements meet minimum */
button, a, [role="button"], input, select, textarea {
  min-height: var(--touch-target);
  min-width: var(--touch-target);
}
```

### 9.3 Focus States

```css
:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 2px;
  border-radius: var(--radius-sm);
}
```

### 9.4 Semantic Landmarks

```html
<header role="banner">         <!-- Header + nav -->
<nav role="navigation">         <!-- Sidebar, BottomNav -->
<main role="main">              <!-- Content area -->
<aside role="complementary">    <!-- Side panels -->
<footer role="contentinfo">     <!-- Footer -->
```

### 9.5 Color-Not-Only Rule

- ❌ KHÔNG dùng color alone để convey meaning
- ✅ LUÔN kèm icon/pattern/text bên cạnh color
- Ví dụ: Debt status = color + icon (🔴/⚠️/✅) + text ("Chưa trả" / "Trả thiếu" / "Đã trả")

---

## §10 — Icon System

### 10.1 Sport Icons (Emoji + Custom)

| Sport | Emoji | Custom icon | Color token |
|-------|-------|-------------|-------------|
| Cầu lông | 🏸 | shuttlecock | `--sport-badminton` |
| Pickleball | 🏓 | paddle | `--sport-pickleball` |
| Tennis | 🎾 | racket | `--sport-tennis` |
| Bóng đá | ⚽ | football | `--sport-football` |
| Padel | 🏏 | padel racket | `--sport-padel` |
| Volleyball | 🏐 | volleyball | `--sport-volleyball` |
| Basketball | 🏀 | basketball | `--sport-basketball` |

### 10.2 Sport Icon Container

```css
.sport-icon {
  width: 48px;
  height: 48px;
  border-radius: var(--radius-lg);    /* 12px */
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 24px;
  /* bg = --sport-{x}-subtle (from §2.5) */
}
```

### 10.3 Status Icons

| State | Icon | Context |
|-------|------|---------|
| Paid | ✅ | Payment status |
| Unpaid | 🔴 | Debt indicator |
| Partial | ⚠️ | Partial payment |
| Pending | ⏳ | Waiting/processing |
| Error | ❌ | Action failed |
| Lock | 🔒 | Restricted/gated |
| Info | ℹ️ | Informational |

### 10.4 Notification Type Icons

| Type | Icon | Color |
|------|------|-------|
| reminder | ⏰ | `--warning` |
| settled | ✅ | `--success` |
| correction | 🔄 | `--info` |
| owner_alert | ⚠️ | `--warning` |
| announcement | 📣 | `--primary` |
| follow_request | 👤 | `--info` |
| identity_link | 🔗 | `--secondary` |
| security_alert | 🔐 | `--error` |

### 10.5 Icon Sizing

| Size | Value | Use |
|------|-------|-----|
| `xs` | 16px | Inline text icons |
| `sm` | 20px | Badges, list items |
| `md` | 24px | Standard actions, nav |
| `lg` | 32px | Cards, headers |
| `xl` | 48px | Sport containers, empty states |
| `2xl` | 64px | Hero empty states |

---

## §11 — Responsive Grid & Breakpoints

### 11.1 Breakpoints

| Token | Value | Device | Key changes |
|-------|-------|--------|-------------|
| `--bp-mobile` | 375px | Mobile (baseline test) | Single column, card stack, BottomNav |
| `--bp-tablet` | 768px | Tablet | Sidebar → hamburger, 2-col grid |
| `--bp-desktop` | 1024px | Desktop | Sidebar 64px icon-only → 240px expanded |
| `--bp-wide` | 1440px | Wide desktop (baseline test) | Max content width, 3–4 col grid |

### 11.2 Content Containers

```css
:root {
  --container-sm: 640px;    /* Forms, settings */
  --container-md: 768px;    /* Content pages */
  --container-lg: 1024px;   /* Dashboard content */
  --container-xl: 1280px;   /* Wide layouts */
  --container-max: 1440px;  /* Maximum width */
}
```

### 11.3 Responsive Transformations

| Component | Desktop (≥1024px) | Tablet (768px) | Mobile (375px) |
|-----------|-------------------|----------------|----------------|
| Sidebar | Fixed 240px expanded | Collapsed 64px | Hidden + hamburger |
| Session list | Table rows | Table (scrollable) | Card stack |
| Settings tabs | Vertical left | Horizontal top | Dropdown selector |
| Stat cards | 4-column row | 2×2 grid | 2-column (compact) |
| Roster table | Full table | Scrollable table | Card list per player |
| Notifications | Dropdown panel (400px) | Dropdown (full width) | Full-screen push |
| Chat | 2-panel (threads + messages) | Same | Single panel (threads ↔ messages) |
| Login card | Centered card | Centered card | `max-width: 90vw` |

---

## §12 — Spacing & Elevation Reference

### 12.1 Spacing Scale (8px base)

| Token | Value | Use |
|-------|-------|-----|
| `--space-1` | 4px | Tight gaps (badge padding) |
| `--space-2` | 8px | Compact spacing (chip gaps) |
| `--space-3` | 12px | List item padding |
| `--space-4` | 16px | Standard padding, form gap |
| `--space-5` | 20px | Section padding |
| `--space-6` | 24px | Card padding |
| `--space-8` | 32px | Section margins |
| `--space-10` | 40px | Large gaps |
| `--space-12` | 48px | Page section gaps |
| `--space-16` | 64px | Hero spacing |

### 12.2 Elevation (Shadows)

| Token | Value | Use |
|-------|-------|-----|
| `--shadow-sm` | `0 1px 2px hsl(0 0% 0% / 0.05)` | Subtle (cards at rest) |
| `--shadow-card` | `0 2px 10px rgba(0,0,0,0.06)` + `--border-hairline` | Card default (Sporta recipe) |
| `--shadow-md` | `0 4px 6px hsl(0 0% 0% / 0.1)` | Hover elevation |
| `--shadow-lg` | `0 10px 15px hsl(0 0% 0% / 0.1)` | Dropdowns, panels |
| `--shadow-xl` | `0 20px 25px hsl(0 0% 0% / 0.1)` | Modals |
| `--shadow-glow` | `0 8px 28px color-mix(in srgb, var(--primary), transparent 75%)` | Hero glow (primary hue) |

### 12.3 Border Radius

| Token | Value | Use |
|-------|-------|-----|
| `--radius-sm` | 6px | Chips, badges |
| `--radius-md` | 8px | Cards, inputs |
| `--radius-lg` | 12px | Modals, panels, sport icon containers |
| `--radius-xl` | 16px | Hero cards |
| `--radius-full` | 9999px | Pills, avatars |

---

## §13 — Z-Index Stack

| Token | Value | Use |
|-------|-------|-----|
| `--z-base` | 0 | Default content |
| `--z-dropdown` | 100 | Dropdowns, popovers |
| `--z-sticky` | 200 | Sticky headers, BottomNav |
| `--z-overlay` | 300 | Sidebar backdrop, panels |
| `--z-modal` | 400 | Modals, confirm dialogs |
| `--z-toast` | 500 | Toast notifications (always on top) |

---

## Cross-references

| Document | Role |
|----------|------|
| `design-tokens.md` | **Value SoT** — canonical token values |
| `token-needs-matrix.md` | Gap inventory — candidate tokens from BRD |
| `design-tokens-benchmark.md` | Method doc — benchmark approach |
| `frontend-architecture.md` | FE governance (invariants, data flow, state pattern) |
| `../channels/web/theme-direction-2026-07.md` | Theme target & activation gates |
| `../channels/web/design-brief.md` | Designer brief (personas, journeys, sitemap) |
| `../channels/web/FE/feature_*_fe.md` | Per-feature screen specs & components |
| `../product/BRD.md` | Product scope & business rules |

---

## Changelog

| Ngày | Version | Thay đổi |
|------|---------|----------|
| 26/10/2026 | 1.2 | **Sync DD-131 OD-7 (Owner ký OD-0…OD-9 (14/10)); docs-only.** Heading font Sora → **Be Vietnam Pro** (Sora không có subset `vietnamese`) ở :9, :38, :326, :336, :339, :348-:352. |
| 07/08/2026 | 1.1 | **Reconcile với 12 FE spec sau round 4 — v1.0 tổng hợp từ bản TRƯỚC round 3/4 nên hồi sinh 5 thứ đã bị gỡ khỏi spec, mỗi thứ là một ràng buộc an toàn chứ không phải chi tiết trình bày.** (1) `ServerPaymentWidget` "server-owned QR + bank info" → **không có component**; payment widget omit hoàn toàn tới khi owner contract Reviewed, FE không dựng QR/STK/pay_code. (2) `MergeReview` "0-debt pair → ✅ Merge" → gate là `hasFinancialHistory` server-owned, **chặn kể cả nợ = 0**; luật cũ cho gộp identity từng có lịch sử tiền chỉ vì số dư hiện tại tình cờ bằng 0 (HARD RULE 4). (3) `MessageBubble` variant `system` → gỡ; chưa producer nào được authorize ghi system message. (4) `SessionForm` "`impact_policy` selector" → gỡ; đổi giá khi đã có charges thì Save bị block, không tự invent enum. (5) `ConnectorCard` `disconnected` → gỡ; lifecycle canonical là `connecting\|registered\|active\|drift\|error\|revoked`, `insufficient_grant`/`expired_token` là overlay/reason chứ không phải status. **§3.6 Payment Source:** 4 token `cash/manual/auto/attested` → đủ **5** theo enum canonical `auto/manual/cash/waiver/reversal`; gỡ `--source-attested` vì attested transfer là mã lỗi `ATTESTED_TRANSFER_UNSUPPORTED` (chưa hỗ trợ), không phải nguồn tiền. **Header:** thêm 3 ràng buộc bắt buộc — i18n `t(vi, en)` (v1.0 không nhắc HARD RULE 5 lần nào), chỉ vẽ cái có owner contract, và fail-closed. Token values không đổi; `design-tokens.md` vẫn là value SoT. |
| 07/08/2026 | 1.0 | Initial design system. 13 sections covering brand, tokens (foundation + usage layer), typography, 45+ component catalog, layout patterns, 4-state philosophy, motion, a11y, icons, responsive grid, spacing/elevation, z-index. Dual-track: current Indigo + target Orange (DD-81). Built from BRD v3.9n, 12 FE specs, design-tokens v1.2, theme-direction, frontend-architecture. |
