# Web MVP program: session handoff 2 (2026-10-15)

> **Supersedes sections 2 and 4 of `docs/sessions/2026-10-14-web-mvp-program-handoff.md`** (the PR stack table and the open
> review findings). Those two sections describe the world at 2026-10-14 00:30 and are stale. The rest of the old file is only
> partly valid; the exact stale parts are:
>
> - Section 1, "Environment" bullet ("Docker daemon DOWN ... DB suite only in CI ... Playwright only in CI"): stale. A local Postgres
>   container and local Playwright (sandbox off) work now; see section 6 below. Section 1, "Rate limits" bullet: a dated note, ignore.
>   The review-rule, owner-prompt and MUST HOLD bullets of section 1 stay valid.
> - Section 3 ("What is built"): predates #55 and #56, and its "Infra" bullet describes #50 (frozen, not on main). Use section 3
>   below instead.
> - Section 5 (next steps): overtaken by section 7 below; its step 6 ("M7 needs provider accounts") is stale because DD-132 put M7 out
>   of scope.
> - Section 6 (final-report skeleton): its list of owner blockers is stale. DD-132 removed DigitalOcean resources/secrets, Google
>   OAuth staging credentials and M7 from the MVP, and DD-131 decided DD-117 close/cancel, DD-127 definer ownership and the DD-123
>   heading font. Section 7 (lessons) stays valid.
>
> **Verified:** 2026-10-15 21:56 Asia/Saigon (PR state read from GitHub; `mergedAt` values below are UTC, Asia/Saigon = UTC+7).
> **`origin/main` = `7fe55256df8af45ffac8c83a1b760bea5ea52322`** (merge of #56).
>
> Owner-facing status (Vietnamese) lives in `docs/sessions/web-mvp-program-status.md`. This file is the agent-facing copy.

## 1. Rules still in force

- Review rule of DD-122 D4: no Codex, no `scope-gate register/ready`, no `ap-finish`; ordinary branches, one PR per coherent change;
  independent Claude reviewer (not the writer); max 3 review rounds per PR; owner keeps merge, deploy and production credentials.
- HARD RULES: RLS fail-closed; money and PII never public; Postgres is the single source of truth (web and bots send commands);
  identity or debt claims need a verified email or a one-time link code; every user-facing string is `t(vi, en)`.
- MVP scope is fixed by DD-132 / DD-131 OD-0 (signed 2026-10-14): no bank integration (SePay/ApiPay), no billing or `host_pro`, no
  automatic reminders, no DigitalOcean deploy, no secret or Google OAuth provisioning; M7, M8, M11, M12, M13 are out of scope.
  Money is manual only (`cash` | `attested_transfer`), partial payments allowed, reversal owner-only (`money.correct`).
  M9 depends on M6 only. #50 (M5) is frozen and owner-only.

## 2. PR state (#42-#57)

| PR  | State  | Merge commit | Head      | mergedAt (UTC)   | Content                                                                              |
| --- | ------ | ------------ | --------- | ---------------- | ------------------------------------------------------------------------------------ |
| #42 | MERGED | `1681f5f`    | `15cde0f` | 2026-10-13 18:49 | M0 decision docs (DD-122)                                                            |
| #43 | MERGED | `b2391ff`    | `019266f` | 2026-10-13 18:59 | M2a `authorize()`, migration 0049                                                    |
| #44 | MERGED | `83f36dc`    | `a4a362f` | 2026-10-14 03:53 | M1a PWA shell, DD-81 tokens, Google sign-in UI, create club                          |
| #45 | MERGED | `535471b`    | `80d7378` | 2026-10-13 19:06 | M1b club config (0052); merged into a dead parent branch, content reached main via #54 |
| #46 | MERGED | `10774d6`    | `42ff94a` | 2026-10-13 19:00 | M2c BE roster + manual mark-paid (0050-0051); same: reached main via #54             |
| #47 | MERGED | `2339c8a`    | `da6a413` | 2026-10-14 07:44 | M3a Zalo connect + durable verified webhook (0053)                                   |
| #48 | MERGED | `802e051`    | `c7f98ce` | 2026-10-14 04:00 | M2b host session workspace                                                           |
| #49 | MERGED | `561086a`    | `10a214c` | 2026-10-14 20:29 | M3b web account <-> Zalo link (0054, `identity_definer`)                             |
| #50 | OPEN   | n/a          | `f3ceab7` | n/a              | M5 staging (DigitalOcean): FROZEN, owner-only, out of MVP scope (DD-132 / OD-0)      |
| #51 | OPEN   | n/a          | n/a       | n/a              | This PR (docs ledger + handoff-2 + backlog); merged LAST, after #57                  |
| #52 | MERGED | `b06f33f`    | `55eae56` | 2026-10-14 20:38 | M4 settings (`/me/settings`, club settings, 0055)                                    |
| #53 | MERGED | `d962b0c`    | `6bbefd6` | 2026-10-14 20:45 | M2c-fe host roster UI, manual mark-paid preview -> confirm, ledger                   |
| #54 | MERGED | `9c07a33`    | `80d7378` | 2026-10-13 19:35 | Catch-up PR landing the #46 + #45 content on main                                    |
| #55 | MERGED | `8d4b4b6`    | `7c07de1` | 2026-10-15 06:39 | DD-131 OD-1 close/cancel policy (`CLOSE_BLOCKED_OPEN_DEBT`)                          |
| #56 | MERGED | `7fe5525`    | `19331f7` | 2026-10-15 13:10 | Local-only dev-login                                                                 |
| #57 | OPEN   | n/a          | n/a       | n/a              | Local polish + golden path (see below); in review                                    |

#57 (branch `feat/mvp-local-polish`) carries: `venueAddress` on create (OD-4a), one VND formatter plus a guard test (OD-4b), heading
font Be Vietnam Pro and `worker-src 'self'` (OD-7), a local-only golden-path Playwright spec, and `docs/runbooks/local-mvp-smoke.md`.
Cite it by number and merge order only: its head can still move. **Final merge round (owner): #57 first, #51 last.**

## 3. What is on main now (origin/main 7fe5525)

- Migration tail, measured with `git ls-tree --name-only origin/main packages/db/migrations/ | tail -3`:
  `0053_zalo_ingress.sql`, `0054_link_code_reparent_empty_person.sql`, `0055_me_settings_definers.sql` (56 migration files, contiguous).
- Host UI and API: PWA shell, Google sign-in UI, create club, club settings (name, timezone, locale, session defaults, Zalo bot connect),
  session list/create/detail/edit/publish/close/cancel, roster add/remove, manual mark-paid (cash | attested transfer, partial),
  ledger and reversal, `/me/settings`, `/me/link`.
- Backend: `authorize()` capability gate (0049), roster and mark-paid services (0050-0051), tenant profile definers (0052),
  Zalo ingress with durable verified webhook (0053), empty-person re-parent definer owned by `identity_definer` (0054), me-settings
  definers (0055).
- Close/cancel policy (#55): `close` refuses open debt with 409 `CLOSE_BLOCKED_OPEN_DEBT` plus a list of players with an open balance
  (ids and display names only); `cancel` blocks only charges carrying recorded money (net allocated > 0).
- Dev-login (#56): local only, documented in the README section "Dev-login"; `pnpm dev:seed` creates the dev club and personas.
- NOT on main yet: everything in #57. Wave B/C items M6, M9, M10 have no PR.

## 4. Open findings and residuals (backlog row slugs in `docs/autopilot-backlog.md`)

Test infrastructure and flakes:

- `app-worker-test-password-clash-flake`: `ROLE_PW.app_worker` in `packages/db/src/test-harness.ts` differs from `APP_WORKER_PASSWORD`
  in three `apps/bot` tests; web and bot suites run in parallel, so `dispatcher.test.ts` sometimes fails with `password authentication
  failed for user app_worker` (2 of 4 runs on #56, green on rerun).
- `dev-app-worker-password-not-restored`: the harness resets the cluster-wide passwords of `app`, `app_worker` and `readonly` and
  never restores them, breaking the README login `app:plexco_dev_app` after a test run. It absorbed a duplicate row on 2026-10-15;
  keep it and `app-worker-test-password-clash-flake` from being fixed by two lanes at once (cross-referenced in both rows).
- `db-test-unhandled-57p01-and-load-timeouts`: `appPool` without an `error` listener in `tenant-capability-authority.test.ts` leads to an
  unhandled 57P01 at teardown; plus load-only timeouts seen locally.
- `e2e-web-pwa-offline-online-flake`: `apps/web/e2e/pwa.spec.ts:39` offline -> online navigation (local 3/8 fails, passes on rerun).
- `osv-full-scan-red-on-main-2026-10`: Security run 38456110453, 9 advisories on main.

Product and security residuals:

- `identity-link-hardening-consumer-column` (owner schema decision, optional), `dev-login-residuals-pr-56`,
  `session-commands-actor-recheck-under-lock`, `offline-page-csp-nonce-missing` (flag-gated: fix before enabling
  `CSP_SCRIPT_NONCE_ENABLED`), `session-text-fields-control-char-validation`, `session-venue-address-error-field-contract` (both from
  PR #57 review round 1),
  `club-name-rule-unicode-separators`, `zalo-connect-bot-revoked-error-mapping`.
- `channel-inbound-events-retention-reclaimer`: reclaimer for stuck `received` rows; waits on the owner proposal in section 5 (accept synchronous processing, then ack, in #47).
- `routing-audit-retention`: stays a post-MVP idea; OD-2 decided no retention job for `routing_audit` in the MVP.

Web UX and code hygiene:

- `web-command-id-persistence-and-conflict-copy`, `web-api-client-timeout-and-refresh-notice-focus`,
  `list-sessions-occupied-count-single-source`, `small-code-hygiene-reversal-zalo-roster-comment`,
  `next-config-route-header-precedence-claim`, `dockerignore-env-nested-files`,
  `local-smoke-toast-overlap-and-blank-band-measure` (unmeasured, seen on screenshots of the 2026-10-15 local smoke run, may be a screenshot artifact), `m2c-round3-nits-follow-up`.
- `web-bot-vnd-display-convention`: web part in flight in #57, not merged.

Docs: `docs-drift-sessions-fe-zalo-tech-readme-pins` (route names, Zalo shape rows, README pins, old font and U+20AB; includes
`docs/standards/BUILD-STATUS.md`, not yet updated for M4 and later).

Review residuals carried by frozen and merged PRs (owner reads; no agent lane):

- #50 (M5, frozen, owner-only): at head `f3ceab7` two round-3 SHOULD_FIX items are still unfixed: (1) three runbooks say to expect ONE
  `LOCK TABLE` warning, but `pnpm db:bootstrap` runs more than one definer script (the round-3 reviewer expected two `DEGRADED` warnings), and the
  2026-08-05 evidence was a doadmin-shaped role on local PG16, not a DO cluster; (2) the section 8 probe `GET /api/sessions` hits a
  POST-only route and returns 405 without `x-request-id`. The PR body has a "Round 3 - final" heading with no table under it, so the
  exact text survives only in section 4 of the old handoff. Moot while #50 stays out of MVP scope.
- Post-cap commits (DD-131 OD-9; all four PRs are merged, so this is a retroactive owner read): #42 `15cde0f` (doc-only, `review:check`
  pass, no review round); #43 `7535e26` (9 files, +60/-10, the primary read the diff, no review round); #44 `f84237b` (`safeReturnTo`
  control characters; applied after the OD-9 targeted round at `fb386e0`, not re-reviewed); #47 `da6a413` (fixes SF-1..SF-3 and nits
  of the OD-9 targeted security round at `3ab6794`, not re-reviewed).

Delivered and closed in the backlog by this PR: `identity-definer-bypassrls-ownership-0054` (#49) and
`session-close-cancel-roster-review-policy` (#55; delivered by policy, no `review_policy` model).

## 5. Owner decisions

- 2026-10-14: DD-131 OD-0..OD-9 and DD-132 (scope, close/cancel reversal, Zalo shape, `identity_definer`, `venueAddress` + one VND
  formatter, heading font). Implementation status notes are in `decisions.md` (v2.56).
- **2026-10-15 18:39, no new DD number:** (1) finding A2 of the PR #56 security review is waived: with dev-login enabled, the
  `/internal-dev-login` prefix may answer an empty 404 when only per-request checks fail; (2) migration `auth_audit_dev_login` is NOT authorised: dev logins stay recorded as
  `login_success` / `google`, a known limitation.
- Owner notes: the OD-4(b) format shows `1.500đ` in the English UI too, so English screen readers may read it as a decimal (owner-signed
  format); the compose re-bind behaviour is in section 6.
- Still open proposals (owner-open, not decided): (a) accept synchronous processing then ack in #47 for the MVP (DD-131 OD-2 described
  ack first, then asynchronous processing); (b) wave A exits when local Playwright `e2e-web` is GREEN on the stack tip (DD-132
  removed the "E2E staging" gate and named no replacement).

## 6. Operating facts for the next agent

- **One shared Postgres and one e2e port:** every agent on this machine uses the same local Postgres and the same Playwright port, so
  never run two DB suites (`pnpm -w test`, `pnpm db:reset:test`), two migration runs or two Playwright runs at the same time. When an
  orchestration kit provides a lock, take it before such a run and release it on exit, also on failure; without one, serialize by hand.
- `pnpm db:bootstrap` must run as superuser (`DATABASE_URL_MIGRATION`) BEFORE migration 0054; it now runs three scripts
  (`01-job-definer.sql`, `02-chat-definer.sql`, `03-identity-definer.sql`). A local DB that applied an older text of 0054 or 0055 fails
  the sha256 guard in `migrate()` and must be reset (`pnpm db:reset:test` for test DBs; drop and recreate other local DBs).
- Known CI flakes: bot `dispatcher.test.ts` (app_worker password), `tenant-capability-authority.test.ts` 57P01, `pwa.spec.ts:39`.
  Policy: rerun a red check ONCE; a second red on the same check is a real failure, not a flake.
- The GitNexus index is stale (last indexed `dd5375f`): re-run `node .gitnexus/run.cjs analyze` from the owner's root checkout before
  trusting impact results for M2c and later symbols; until then use `git grep`.
- Sandbox must be OFF for `git fetch/push`, `gh`, `git worktree add`, Docker socket access and local port binding (Playwright, `next dev`).
- Running `docker compose -f infra/docker-compose.yml up -d postgres` from a different checkout path (e.g. a PR worktree) recreates
  `plexco-postgres-1` with its init-script bind mount pointing at that checkout. The data persists in the `plexco_pgdata` volume and
  the init scripts only run on an empty volume, so it is harmless; running the same command once from the main checkout re-binds it.
  Never run `docker compose down -v`.
- Shell is zsh: in `git show origin/x:path` write `${ref}:path` when `ref` is a variable (`$ref:path` is a zsh modifier and breaks).
- The repo root checkout is stale (main @ 0db92b9) and holds owner-local edits: read current main with `git show origin/main:<path>`,
  work only in a worktree, and cascade with `git merge --no-ff` (never rebase a pushed branch).

## 7. Next steps (in order)

1. Owner final merge round: #57, then #51. After #57 lands: re-measure the migration tail, flip `web-bot-vnd-display-convention` to
   `merged` by hand, and re-measure the font and U+20AB counts of the docs-drift row on main.
2. Owner runs `docs/runbooks/local-mvp-smoke.md` (it arrives with #57): Postgres local, dev-login, golden path by hand or with the
   Playwright spec. Record the result in the ledger.
3. Owner decides the two open proposals of section 5; the second one defines when wave A is considered exited.
4. Fresh lane prompts (one lane per row) for the flake rows, `osv-full-scan-red-on-main-2026-10`, and the docs drift row.
5. Next planning session: scope-limited Wave B/C = M6, M9 (depends on M6 only), M10; M7, M8, M11, M12, M13 stay out. #50 stays frozen.
