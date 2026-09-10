---
slug: web-oauth-302-helper-duplicated-two-routes
class: code-quality-p2
risk: P2
scope:
  - apps/web/app/api/auth/google/callback/route.ts
  - apps/web/app/api/auth/google/complete/route.ts
  - apps/web/lib/request-policy.ts
  - apps/web/lib/request-policy.test.ts
verify: pnpm --filter @plexco/web run typecheck && pnpm test:web && pnpm --filter @plexco/web run build
budget_usd: 10
max_review_rounds: 3
---
> DRAFT — move up into `ap3/queue/` only AFTER bundle v6 has merged (it did: PR #7 / cffa993, 2026-09-10): `apps/web/lib/request-policy.ts`
> does not exist on `main@30a3e90`; it arrives with v6 (lane B3). Re-measure the duplicated block's
> line numbers at the post-merge base. This task touches auth routes, so `review.sh`'s security
> heuristic WILL trigger a security round — that is expected and is the W3 evidence for the
> security path.

## Problem

`redirect()` and `noReferrer()` are duplicated byte-for-byte in
`apps/web/app/api/auth/google/callback/route.ts` (~219-230 at `30a3e90`) and
`apps/web/app/api/auth/google/complete/route.ts` (~90-101); only one docstring sentence differs.
Call sites: `callback:72,85`, `complete:47`. The right home is `apps/web/lib/request-policy.ts`
(same concern: referrer / navigation policy), NOT `lib/api-envelope.ts` (JSON envelopes only).

## Acceptance

1. `request-policy.ts` exports `redirect()` and `noReferrer()` once; both route files import them
   and their local copies are deleted. Behaviour is identical: same status, same headers, same
   `Referrer-Policy`.
2. RED test: extend `apps/web/lib/request-policy.test.ts` (it exists on v6 beside the module) so it
   asserts the two helpers' exact response shape (status 302, `Location`, `Referrer-Policy: no-referrer`,
   `Cache-Control` if present at base). Must fail at base (helpers not exported) and pass after.
3. **Route files export nothing new.** App Router route modules may export only HTTP verbs and the
   fixed config set; a stray export breaks `next build` and neither vitest nor tsc catches it
   (audit 06/09, bug 13). `verify` therefore includes `next build`.
4. `verify` green: web typecheck, web vitest (399 at `0aff7ad` + the new test), `next build`.
5. No change to auth logic, cookie handling, CSRF, or state validation in either route — helpers
   only. If the deduplication needs any behavioural change, HALT `MISSING_CONTEXT`.

## Context
- **Dependencies: the worktree is a FRESH checkout with no `node_modules`.** pnpm workspaces are not
  shared across git worktrees, so run `pnpm install --frozen-lockfile` from the repo root **before**
  the first `verify`. It is gitignored, so it never enters the diff and never trips the clean-worktree
  check. If the install itself fails (network or store path blocked by the sandbox), that is not
  something to work around: HALT `MISSING_CONTEXT` and report the exact error.

- Row text: owner's untracked backlog-rows note of 2026-09-08 § web-oauth-302-helper-duplicated-two-routes (NOT in the repo).
- `apps/web/lib/request-policy.ts` — read its existing exports (`isTopLevelNavigation` from lane B3)
  and keep the file's style.
- HARD RULE 5 (i18n) is not touched: the helpers carry no user-visible strings.
- GitNexus: run `gitnexus_impact` on `redirect` / `noReferrer` (upstream) before editing; expect
  only the three call sites.
- Commit message: `refactor(web): hoist google OAuth 302 helpers into lib/request-policy`.
