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
> DRAFT — bundle v6 merged (PR #7 / cffa993, 2026-09-10) so `apps/web/lib/request-policy.ts` (it did
> not exist on `main@30a3e90`; it arrives with v6, lane B3) is present and the line numbers below are
> re-measured at the post-merge base. Still a draft: per `ap3/PROMPTS.md` Prompt 3, promote only
> AFTER `db-tx-type-alias-duplicated-six-files.md` has merged — this is the first slice expected to
> trigger `review.sh`'s security heuristic (auth routes), and that path gets exercised with trust
> already earned from a clean db-tx run, not as the very next thing after v6.

## Problem

`redirect()` and `noReferrer()` are duplicated byte-for-byte in
`apps/web/app/api/auth/google/callback/route.ts:225-235` (doc comment at `:224`) and
`apps/web/app/api/auth/google/complete/route.ts:137-147` (doc comment at `:136`) — re-measured at
`origin/main@c59674a`, post bundle-v6 merge PR #7 / `cffa993` (v6 shifted both blocks down from the
pre-v6 `~219-230`/`~90-101`; only the leading doc-comment sentence still differs between the two).
Call sites (re-measured — v6 restructured both routes, the pre-v6 `callback:72,85`/`complete:47`
numbers no longer apply): `callback/route.ts` calls `redirect()` once, at `:101` (inside its local
`fail()` closure), and `noReferrer()` twice, at `:77` and `:90`. `complete/route.ts` calls
`redirect()` three times, at `:50`, `:70` (inside its own `fail()` closure) and `:133`, and
`noReferrer()` twice, at `:61` and `:85`. Note: `callback/route.ts`'s top-level catch handler
(`:63-69`) builds its own 302 inline instead of calling `redirect()` — a third, un-deduplicated copy
of the same shape that Acceptance #1 does not name; leaving it alone is in scope, not an oversight,
unless the writer judges otherwise. The right home is `apps/web/lib/request-policy.ts` (same concern:
referrer / navigation policy), NOT `lib/api-envelope.ts` (JSON envelopes only).

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
4. `verify` green: web typecheck, web vitest (426 at `c59674a` + the new test), `next build`.
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
- GitNexus: run `gitnexus_impact` on `redirect` / `noReferrer` (upstream) before editing; re-measured
  post bundle-v6 — expect eight call sites total (four `redirect()`: complete `:50,:70,:133` +
  callback `:101`; four `noReferrer()`: complete `:61,:85` + callback `:77,:90`), not the pre-v6
  three. `redirect()`'s manual inline copy in callback's top-level catch (`:63-69`) is a ninth,
  structurally-similar site that `gitnexus_impact` on the named functions will NOT surface.
- Commit message: `refactor(web): hoist google OAuth 302 helpers into lib/request-policy`.
