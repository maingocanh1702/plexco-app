# Web MVP — architecture & conventions (agent-owned design, 2026-10-12)

Decisions below are the primary agent's calls under the owner's "HOW is your call" mandate. Each new
dependency/pattern is reported by its lane in the PR body and filed by the primary as a 🟡 proposal in
`docs/standards/decisions.md` through the ledger PR (not inside slice PRs, to avoid conflicts with M0).

## 1. Stack (reuse what exists)

- `apps/web`: Next.js 15.5 App Router, React 19, TypeScript strict. **No Tailwind** (frontend-architecture.md).
  Styling = CSS custom properties (tokens) in `app/globals.css` + CSS Modules per component.
- `packages/db`: drizzle + pg, `withTenant`/`tenantRepo` choke-point (HR1). All reads/writes for UI go
  through new service functions here (`session-read.ts`, `roster-service.ts`, `payment-manual.ts`, …).
- `packages/core`: pure logic + `t(vi, en)` (ALS, server only).
- `apps/bot`: pg-boss worker; Zalo adapter lands here (M3) as a thin port.

## 2. Rendering model

- **Pages = Server Components** that (a) gate auth via `currentSession()` (redirect to `/signin`),
  (b) resolve `lang` and pass it down. **Screens = Client Components** rendering UI with `useT()`.
- Client reads/writes go through the authenticated API routes (`/api/**`, envelope `{data,error,meta}`,
  CSRF header `x-csrf-token` from `GET /api/auth/session`). Never self-HTTP from a Server Component.
- Tenant scope lives in the URL: `/c/[tenantId]/...` (API already keys on `?tenant=<uuid>`).
- Route map (Wave A): `/` (landing → redirect) · `/signin` · `/onboarding/new-club` ·
  `/c/[tenantId]` (home) · `/c/[tenantId]/sessions` · `/c/[tenantId]/sessions/new` ·
  `/c/[tenantId]/sessions/[id]` · `/c/[tenantId]/settings` · `/settings` (profile, linked channels) ·
  `/offline` (SW fallback).

## 3. i18n (HR5)

- Server strings: `t()` from `@plexco/core/i18n` inside `runWithLang(lang, …)` (as today).
- Client strings: `apps/web/lib/i18n-client.tsx` → `<LangProvider lang>` + `useT()` returning
  `t(vi, en)`. Same two-literal shape ⇒ lint/grep rule for "every user-facing string is t(vi,en)" holds.
- Pre-tenant surfaces (signin, create club) render `vi` (DD-118 bucket b). Inside `/c/[tenantId]`
  the lang = `tenants.locale` (DD-118), resolved server-side via `resolveTenantLang` only AFTER the
  tenant is proven to belong to the actor (the API route does that; the page just forwards).

## 4. Design tokens (DD-81 target C, agent-owned)

`globals.css` `:root` = semantic tokens (`--primary #FF5A1F`, `--on-primary #22100A`, Sora/Inter,
semantic paid/pending/unpaid, neutrals, spacing 4-pt, radius, shadow, touch-target 44px).
Dark via `@media (prefers-color-scheme: dark)` + `[data-theme="dark"]` override. Tokens-only rule
(FE-INV-2) enforced by a vitest that greps `apps/web/app/**/*.css` modules for hex/rgba literals outside
`globals.css`. Fonts: `next/font/google` (Sora, Inter) with system fallback.

## 5. PWA

`app/manifest.ts` (Next native) · `public/sw.js` hand-written (precache shell + `/offline`; network-first
for navigations with offline fallback; stale-while-revalidate for `_next/static`; API never cached) ·
`<RegisterSw/>` client component in root layout · icons 192/512 + maskable + apple-touch generated into
`public/icons/`. Install verified by Lighthouse PWA audit + manual Android/iOS notes in the PR.

## 6. Authorization (DD-56)

M2a replaces the temporary gate: migration `0049` SECURITY DEFINER `authorize_tenant_action(...)` +
`packages/db/src/tenant-capability-authority.ts` `authorize(tx, action, actor, target)` (fail-closed,
`admin ≡ co_admin`), consumed inside each command's transaction; the ESLint DD-56 block and
`ALLOWED_ROLES` are deleted; `GET /api/sessions`, `GET /api/sessions/[id]` ship behind `authorize()`.

## 7. Money (DD-40 manual mark-paid, Tier C)

`payment_allocations` writer with `source='cash'` (bank-transfer-confirmed-by-host also uses `cash`
with `reason_code='bank_transfer_manual'` — `alloc_shape_chk` reserves `manual` for rows bound to a
`bank_transactions` row). Charge status derived in one helper; reversal = negative `reversal` row.
Decision table + abuse cases in the PR; security reviewer mandatory.

## 8. Testing

vitest per package (DB tests need `DATABASE_URL_TEST`; CI provides Postgres). Browser E2E: Playwright
added in M1 (`apps/web/e2e`), run against `next start` with a seeded test DB in CI job `e2e`.
A11y: `@axe-core/playwright` in E2E + manual keyboard/SR notes.

## 9. Offline shell

Cached shell renders nav + "offline" banner + last-seen session list from `localStorage` snapshot
(no money/PII beyond what the signed-in user already sees; cleared on logout).
