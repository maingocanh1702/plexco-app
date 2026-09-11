---
slug: session-management-m02-read-routes-admin-scoped
class: feature-session-p2
risk: P2
scope:
  - apps/web/app/api/sessions/route.ts
  - apps/web/app/api/sessions/[id]/route.ts
  - apps/web/app/api/sessions/route.test.ts
  - apps/web/app/api/sessions/[id]/route.test.ts
  - apps/web/lib/session-command-route.ts
verify: pnpm --filter @plexco/web run typecheck && pnpm --filter @plexco/web exec vitest run app/api/sessions
verify_host: pnpm --filter @plexco/web exec vitest run app/api/sessions
budget_usd: 10
max_review_rounds: 3
feature: session-management
after: session-management-m01-timezone-validation-canonical-iana
milestone: true
milestone_id: M2
---
## Problem
docs/features/BE/feature_session_management_tech.md's own status header (line 6) lists read routes (GET /api/sessions, GET /api/sessions/:id) as not yet built, alongside the 6 already-merged commands. Confirmed on live main: apps/web/app/api/sessions/route.ts exports only POST, and apps/web/app/api/sessions/[id]/route.ts exports only PUT -- no file anywhere under apps/web/app/api/sessions exports GET. The BE spec's API Contract table (section 3) pins both as TenantAdmin-auth, tenant-scoped endpoints.
## Acceptance
A new GET handler on apps/web/app/api/sessions/route.ts returns a tenant-scoped, paginated list of sessions for the caller's tenant (shape per BE spec section 3 'GET /api/sessions' success example, ~line 450). A new GET handler on apps/web/app/api/sessions/[id]/route.ts returns full session detail (matching the BE spec's Host-view example, ~line 457, including the roster) for a TenantAdmin caller in their own tenant, and SESSION_NOT_FOUND (404) for a session outside the caller's tenant. Both routes reuse the exact TenantAdmin-capable-role auth/tenant-resolution primitives apps/web/lib/session-command-route.ts already exposes for the existing POST/PUT/publish/close/cancel routes -- no hand-rolled duplicate role check (this file's own header comment states the DD-56 design intent: one choke-point, not scattered `role === ...` checks across routes). Both routes get sibling .test.ts coverage (mocked DB, matching the existing route-test style, no DATABASE_URL_TEST needed) for: happy path, non-admin/wrong-tenant 403, and not-found 404.
## Context
Negative scope, explicit: this slice does NOT add a Player-facing view of GET /api/sessions/:id. The BE spec's full contract eventually wants this endpoint to also serve Player callers with a role-scoped, redacted response (Host sees full roster + payment amounts; Player sees only area/queue-position until players.status='active', per FE spec E#6 venue-visibility and BE edge #8/#19's public-serializer-whitelist precedent) -- that is new, security-sensitive response-shaping logic with zero existing precedent in this codebase (verified: apps/web/lib/session-command-route.ts has exactly one auth gate today, and it is TenantAdmin-capability-only; there is no Player-facing session route anywhere to branch from). That extension is deliberately left for a separate, human-supervised slice -- see ap3/features/session-management/PLAN.md, Deferred item D5. This slice's own GET /api/sessions/:id must reject (403) any caller who is not TenantAdmin-capable in the session's tenant; it must not attempt to also serve Player-scoped output, and must not invent query-param filtering the BE spec's own list example does not show.
