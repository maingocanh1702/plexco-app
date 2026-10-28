<!-- review-readiness: code-ready -->

# Step-0 readiness: L74 p5-staging-smoke-golden-path (session P5-S3b)

> Agent-facing. Step 0 measured by the readers S0a (Q1, Q4), S0b (Q2, Q3) and S0c (O1-O3), written by S0d (all opus); writers W1 and W2 (opus) one at a time; ONE reviewer role (opus, a Claude subagent: the Web MVP program's named exception DD-122 D4). No security round is planned for this lane; the reviewer checks the credential rule and the production refusal line by line (section 8). RISK: P2 code (test tooling and a smoke script; no product route, no migration). Base `4230c752ec0ddb2a14e2a07714a901c6022e862c` (origin/main, measured; it is the merge commit of PR 137, lane L65); branch `feat/p5-staging-smoke-golden-path`; worktree `.autopilot/worktrees/p5-staging-smoke-golden-path`; HEAD = base at step 0. Every `path:line` below was re-checked on disk at the base by S0d (the readers' lines are leads). The session notes live outside the repo, so this file restates every fact it relies on.

Short forms: SP = `scripts/smoke-predeploy.mjs`; SC = `infra/smoke-check.sh` (lane L65's, on main); PC = `apps/web/playwright.config.ts` (the default config, CI's); GP = `apps/web/e2e/golden-path.spec.ts`; GC = `apps/web/e2e/golden-path.config.ts`; GH = `apps/web/e2e/support/golden-path-helpers.ts`; HS = `apps/web/e2e/support/golden-path-host-steps.ts`, SG = `apps/web/e2e/support/staging-golden-path-guard.ts`, SGS = `apps/web/e2e/staging-golden-path-guard.spec.ts`, STC = `apps/web/e2e/staging-golden-path.config.ts`, STS = `apps/web/e2e/staging-golden-path.spec.ts`, SMS = `apps/web/e2e/smoke-predeploy.spec.ts` (all six new); PL = `docs/sessions/web-mvp-phase5-golive-plan.md`; RB = `docs/runbooks/local-mvp-smoke.md`; BL = `docs/autopilot-backlog.md`; CI = `.github/workflows/ci.yml`; DL = `docs/standards/decisions.md`.

## 1. Authority

- The owner's written approval of 2026-10-28 of PL (DD-154, DL:120): §3 row L74 (PL:86), the Q1 default, the Q9 default (PL:131: the staging golden path signs in through the real Google OAuth flow with owner-created Google test accounts, by hand in a headed browser; no password, cookie or storage state stored; no test-only sign-in path; the dev-login exposure gate never weakened), the raise of L74's run cap to 6, and ruling RO-L79-2 item 2 (L74 starts when L65 has merged; the owner's Google test accounts gate only the staging RUN of the spec at step 8.6, gate G2, not the lane). Recorded in D46 of the conductor's decision log.
- Conductor rulings, each "decided by the conductor under the owner's delegation of 2026-10-22, not an owner signature" (Tier B, reversible): RO-L74-1 (one agent at a time; DB, e2e, Playwright and local-server runs only by the orchestrator through the DB/e2e lock; never the staging spec against a real remote host; nothing the browser holds after a sign-in written anywhere; ONE push); RO-L74-2 (D1-D10 accepted as the lane's design with two conditions: (a) the host-step move keeps the local spec's behavior identical, is a move and not a rewrite in its own first commit, and the local golden path ends `4 passed` on the final head or an honest NOT RUN; (b) SC may become a node adapter of SP that keeps every L65 check and its exit codes, with a backlog row for L67, and the default-suite smoke spec stays small and the PR body states its duration); RO-L74-3 (2026-10-29: RQ-L74-1 option (i), the 8.3 consequence, the D9 host rule, O2 and O3 accepted, the plan shifted by one run).
- Scope: the 13 files of section 7, and nothing else (the lane block's FILE OWNERSHIP narrowed to what D1-D10 need).
- Negative scope (the lane block's NEGATIVE SCOPE and STOP, as-is): no dev-login change and no dev-login call from the staging spec (never `apps/web/lib/dev-login/`); no stored credential of any kind (no storageState file, no cookie dump, no password env); no product code (no product route or component); no change of the local golden path's behavior or of the pacer's budget; no CI job for the staging spec; never production data; no workflow (L67); no App Spec (L66); never a run of the staging spec against a real remote host in this lane (RO-L74-1 item 3). Added at step 0: no change of the local golden path's behavior or of its pacer (GH:24-32 and the L60 wait stay byte-identical), and no test-only membership or role path (RO-L74-2 item 2).

## 2. Measured at base

### 2.1 Q1: the smoke surface (S0a items 1-4)

- SP (61 lines): `SMOKE_BASE_URL` default `http://localhost:3000`, trailing slashes stripped (SP:18); `SMOKE_TIMEOUT_MS` default 10 000 (SP:19); exit 2 when the base is not `^https?://` (SP:21-24; http allowed for any host) or the timeout is not a positive number (SP:25-28). One check, GET `/healthz` (SP:31) with `AbortSignal.timeout` and `redirect: "error"` (SP:35); status 200 (SP:39-41); `res.json()` (SP:43-47); `body?.ok !== true` fails and ECHOES the body through `JSON.stringify(body)` (SP:48-49). A pass prints the ms (SP:56) and exits 0 (SP:57); any throw exits 1 (SP:58-60). No `/`, no manifest, no content-type check.
- SC (26 lines, L65): one positional `https://` origin, else exit 1 (SC:6-8); `curl -q -fsS --max-time 15 --retry 6 --retry-delay 10 --retry-all-errors` (SC:10: 7 tries 10 s apart, per request); `/healthz` must be exactly one JSON document whose `.ok` is the boolean true, jq's stderr dropped (SC:12-16); `/` 2xx and `text/html` (SC:19-23); `/manifest.webmanifest` 2xx only, no content type (SC:25-26). Under `set -euo pipefail` (SC:5) a curl failure exits with curl's own code (7, 22, 28), not 1. No test exists: `package.json:12` runs `infra/render-app-spec.test.mjs` only.
- Callers: `package.json:19` `"smoke:predeploy": "node scripts/smoke-predeploy.mjs"`; the kit record `docs/standards/kit-pack-membership.json:126` (`"overwrite_path": "none"`, "No canonical copy."); PL:202 (step 8.6 runs SP with `SMOKE_BASE_URL`) and PL:241 (G2); no caller in `.github/workflows/` (S0a: grep `smoke` = 0 hits). SC has no code caller; BL:7763 records that L67's workflows will call it.
- The routes the smoke reads: `apps/web/app/healthz/route.ts:5-7` is `Response.json({ ok: true })` (no import, no DB, no auth) and PC:43 already uses it as the `next start` readiness URL; `/manifest.webmanifest` is served as `application/manifest+json` (Next 15.5.28, `apps/web/node_modules/next/dist/build/webpack/loaders/next-metadata-route-loader.js:64`), which the default suite already asserts (`apps/web/e2e/pwa.spec.ts:13-15`); GET `/` signed out renders the landing page without a DB read (S0b item 6; read, not run).

### 2.2 Q4: the default config and CI (S0a item 5)

- PC: `testDir: "./e2e"` (PC:20); no `testMatch`, so Playwright 1.63's default matches every `*.spec.ts` and `*.test.ts` under it; `testIgnore: ["**/golden-path.spec.ts", "**/public-card-hide-address.spec.ts"]` (PC:22); `retries` 1 on CI (PC:26); reporter `list`, plus html on CI (PC:27); `baseURL` `http://127.0.0.1:${PORT}` with `PORT` default 3217 (PC:14, PC:29); `webServer` is an ARRAY: the fake Postgres on 3218 (PC:34-40) and `next start` (PC:41-50) with `DATABASE_URL` pointed at the fake (PC:47).
- CI: only job `e2e-web` (CI:112) runs Playwright, `pnpm --filter @plexco/web exec playwright test` (CI:143; no `--config`, so PC). A new STS with no testIgnore entry WOULD run there: Playwright prefixes a string pattern with `**/` and matches the whole last path segment, so `**/golden-path.spec.ts` does not match `staging-golden-path.spec.ts`. Config and support files without a `.spec.` or `.test.` infix are not loaded as tests.
- Vitest excludes `e2e/**` (`apps/web/vitest.config.ts:6`) and PC would load an `e2e/**/*.test.ts`, so the lane's own checks are Playwright specs with pure calls, never vitest files under `e2e/`.
- PR 50's row-10 hunk (an object-form `webServer`) does not apply to PC; only its intent, a staging run that never runs in CI, is ported (D5).

### 2.3 Q2: the local golden path (S0b items 1-2)

- GP: 517 lines, 4 tests (GP:44 host, GP:270 player, GP:378 chat, GP:471 member chat); opt-in by `GOLDEN_PATH_BASE_URL` (GP:39, GP:41); `GOLDEN_PATH_ALLOW_SEEDED_CLUB` (GP:40). The club limit, 3 per account per hour, is documented at GP:33-37 and enforced at `apps/web/app/api/onboarding/start/route.ts:38` (`rateLimited` with key `tenant-create:<accountId>`, limit 3, window 3600 s).
- T1 (GP:44-248): `paceSessionApi(page, 43)` (GP:54); `let sessionUrl` (GP:55), `let devTenantId` (GP:56); a dev-login sign-in inline (from GP:58); onboarding at `/onboarding/new-club` (GP:92); the throttled branch (GP:105-124) throws unless `GOLDEN_PATH_ALLOW_SEEDED_CLUB=1`, then continues in the seeded Dev Club; the host steps GP:130-244, from the step "create a draft session (venue name + address, price 100.000)" (GP:130) to the end of the close step (GP:244), all product steps (draft, publish, roster add, refused close, partial cash, refused cancel, pay, reversal, pay, close, then a fresh load of `sessionUrl` at GP:242-243). `sessionUrl` is used nowhere after GP:244.
- T2-T4 rely on the seeded Dev Club memberships and roles (S0b item 1); no product path gives a test account those (2.5).
- Pacer (GH): `WINDOW_MS = 60_000` (GH:24), `BUDGET = 45` (GH:25), `PACE_FILE` under `os.tmpdir()` (GH:26), `MAX_HOLD_MS = 8_000` with an import-time guard against `API_TIMEOUT_MS` (GH:27-32); it imports nothing dev-login specific (S0b item 2). The server limits it paces are Postgres-backed, `ACTOR_LIMIT = { limit: 60, windowSeconds: 60 }` (`apps/web/lib/session-command-route.ts:99`) and the shared store behind `rateLimited` (`apps/web/lib/session-cookies.ts:415-423`), so both apply on staging.
- `screenshotter` writes a PNG per step only when `GOLDEN_PATH_SCREENSHOT_DIR` is set (GH:116-127); `readSession` reads GET `/api/auth/session` (GH:198-204); `signInAsPersona` is dev-login only (GH:211-223). GP is not importable as a library: it has a top-level `test.skip`, `test.use` and `test()` (GP:41-44).
- GC: `testDir: "."`, `testMatch: "golden-path.spec.ts"` (GC:26-27); reporters `list` plus the NOT_PROVEN reporter (GC:35); `trace: "retain-on-failure"` (GC:37); no webServer.

### 2.4 Q3: the real sign-in and the hosts (S0b items 3-5, S0c section 6)

- The landing card's link `<Button href="/api/auth/google/state">` with t("Tiếp tục với Google", "Continue with Google") (`apps/web/components/landing/landing-view.tsx:47-49`).
- GET `/api/auth/google/state` (state route = `apps/web/app/api/auth/google/state/route.ts`): top-level navigation only (`apps/web/lib/request-policy.ts:119-123`; else 403, state route :36-38); limited per IP by `oauth-state:<ip>` (state route :45; 10 per 60 s by default, `apps/web/lib/session-cookies.ts:420`); 503 `AUTH_UNAVAILABLE` unless `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` and `APP_BASE_URL` are set (state route :61-70); the binding cookie (:95); a 302 to Google whose `redirectUri` is `${APP_BASE_URL}/api/auth/google/callback` (:63, :97-105). A callback failure redirects to `/?auth_error=<CODE>` (`apps/web/app/api/auth/google/callback/route.ts:101-102`).
- Proof of sign-in: GET `/api/auth/session` answers 401 `AUTH_REQUIRED` signed out (`apps/web/app/api/auth/session/route.ts:18-19`) and 200 with `personId` and `csrfToken` signed in (:30-35). The URL proves nothing: a signed-in `/` sends 0 clubs to `/onboarding/new-club`, 1 club to `/c/<id>`, more to a chooser (`apps/web/components/landing/workspace-redirect.tsx:15-31`).
- The session cookie is `__Host-plx_session` under `NODE_ENV=production` (`apps/web/lib/session-cookies.ts:25-31`) and httpOnly; no page renders a cookie or token value.
- Playwright 1.63 (S0b item 4): screenshot, trace and video default to "off"; a failed test writes `error-context.md` into its output dir (`node_modules/.pnpm/playwright@1.63.0/node_modules/playwright/lib/index.js:709`); with `preserveOutput: "never"` the worker removes that dir when the test ends (`.../playwright/lib/worker/workerProcessEntry.js:1734-1736`; read, not run). `.gitignore:78-79` ignores `playwright-report/` and `test-results/`.
- Hosts: `plexco.app` is production in docs only (PL:126 Q4; DL:1799 inside DD-154); staging gets its own subdomain (PL:126) and the env names `STAGING_BASE_URL` and `PRODUCTION_BASE_URL` (PL:198, step 8.2). No staging host or host pattern is pinned at base, and no code reads either name (S0c section 6).

### 2.5 O1: which persona has a product path on staging (S0c sections 1-3, RQ-L74-1)

- Owner persona: PATH_EXISTS (Google sign-in, then onboarding, then `tenant_provision`; T1 already).
- Co-admin: NO_PATH. `tenant_admins` rows come only from `tenant_provision`, with role `'owner'` (`packages/db/migrations/0072_member_name_definers_qualify_builtins.sql:317-318`); `packages/db/scripts/dev-seed-club-members.ts:10-12` states that the product has no entry point that adds an existing account's person to a club and none that grants co_admin; DD-56 (DL:77) keeps role management owner-only, its grant lifecycle unbuilt.
- Active member: NO_PATH. A product join needs a live membership (`packages/db/src/session-join-service.ts:350-354` returns FORBIDDEN "caller is not a member of this club" without `allowGuestMembership`); the only stranger path is the public `/discover` guest join, owner-gated four ways (S0c section 3); no invite (DD-44, DL:64, unbuilt) and no guest-to-full upgrade (DD-52, DL:73, deferred); a guest gets no chat entry (`apps/web/components/player/my-clubs-view.tsx:28-34`).

## 3. Lead corrections

Each: the lead, what differs at base, what the lane follows.

- C1. S0b item 5 and the first D9 named `www.plexco.app` as a production name pinned in the repo. `git grep -i "www\.plexco"` = 0 hits at base (S0c section 6, control `plexco\.app` = 137 hits). The lane follows RO-L74-3 item 3 (D9): `www.plexco.app` is still refused by name, as a production alias of the Q4 apex, not as a repo line.
- C2. D3's positive case was left open at run 1 (O2: a healthy-shaped stub if `/healthz` needed a DB). `/healthz` opens no DB (2.1), so the positive case runs against PC's real `next start` with no stub (RO-L74-3 item 4).
- C3. The lane block lead (1) lists SC's manifest check as if it matched the others: SC checks the manifest's status only, no content type (SC:25-26), and its curl failures exit 7, 22 or 28, not 1. The lane follows D1 and D2: the manifest also needs `application/manifest+json`, and every failure stays non-zero.
- C4. The lane block lead (1) describes SP as one check with exit 0, 1 or 2: correct, but SP:49 echoes the response body when `ok` is not true. The lane follows D1: no message quotes a body.
- C5. S0b: T1 signs in inline through dev-login (from GP:58), not through `signInAsPersona` (GH:211). The measurements doc's row 10 cites PC's webServer as :33-47; at base it spans PC:33-51.
- C6. Q9 (PL:131) and step 8.3 (PL:199) name one Google test account per golden-path persona. Under RO-L74-3 items 1-2 the staging spec needs ONE, for the owner persona. PL is not this lane's file and is not edited; this file, RB and the PR body carry the change (section 4).
- C7. The lane block lead (4) cites `apps/web/lib/dev-login/gate.ts` about :133-145 and `network-exposure.ts` about :4-8: not re-measured. The lane reads, edits and calls nothing there, and STS has no dev-login path.
- C8. The run-2 handoff's plan line named the smoke writer W1 and the staging writer W2. The move must be the first commit after this file (RO-L74-2 item 1(a)), so here W1 is the staging writer and starts with the move; W2 writes the smoke (section 6).

## 4. Decisions

D1-D10 are each "default applied, pending owner sign-off" (accepted as the lane's design by RO-L74-2 item 1).

- D1. ONE smoke definition, SP, against `SMOKE_BASE_URL` (default `http://localhost:3000` kept): GET `/healthz` = status 200, a JSON content type, the WHOLE body parses as exactly one JSON document (two documents fail), `.ok === true`; GET `/` = 2xx and `text/html`; GET `/manifest.webmanifest` = 2xx and `application/manifest+json`. Every request uses `redirect: "error"` (a 3xx fails) and the existing `SMOKE_TIMEOUT_MS` timeout; a failure message names the check, the status and the content type, NEVER a response body (SP:49's echo goes). The exit meanings stay: 0 pass, 1 a failed check, 2 a bad invocation. Reason: one source of truth for "a healthy deployment answers"; testable with plain-http stubs on 127.0.0.1 (an https-only bash script cannot be); one module grows and its checks run in CI. Rejected: two surfaces (two definitions of `/healthz` drift and the bash one stays untested); SC as the definition (it refuses http, so neither the local default nor a stub works).
- D2. SC becomes a thin adapter of SP (RO-L74-1 and RO-L74-2 item 1(b) allow it): the same interface `infra/smoke-check.sh https://<origin>`; the https-only refusal kept and checked before any request (SC:6-8 unchanged); then `node <repo>/scripts/smoke-predeploy.mjs` with `SMOKE_BASE_URL=<origin>` and `SMOKE_TIMEOUT_MS=15000` (SC:10's `--max-time 15`), the whole smoke tried up to 7 times 10 s apart (SC:10's 1 + 6 retries, 10 s delay). It keeps every L65 check (D1 is a superset: one healthz JSON document with `ok` true, `/` as `text/html`, the manifest) and L65's exit contract: 0 only on a pass, 1 for a refused origin, non-zero for a smoke that still fails after the 7th try (SP's last code, 1 or 2, passed through); curl's codes 7, 22 and 28 no longer occur. It needs node and the repo checkout instead of curl and jq: backlog row 1 tells L67 (section 11).
- D3 (settled by O2). The smoke's tests are a default-suite Playwright spec, SMS (CI e2e-web runs it). The positive case runs SP against the default config's real `next start` (the `baseURL` fixture, `http://127.0.0.1:3217` by default) and passes; there is no stub for it. The negatives use 127.0.0.1 `node:http` stubs for a redirect, a 500, a non-JSON body, two JSON documents, a wrong content type and a timeout (a small `SMOKE_TIMEOUT_MS`): each exits non-zero and its output never contains the stub's body marker; the adapter `infra/smoke-check.sh http://127.0.0.1:<port>` is refused before any request. SP runs through an async `execFile` with an argument array (no shell; the in-process stub must keep answering), no RegExp is built from data (C11 Semgrep), every test has an explicit timeout; the spec stays small and the PR body states its measured duration. Reason: root `package.json` (`test:infra` lists files) and `docs/standards/kit-pack-membership.json` (a new `scripts/` file needs a record) are outside L74's ownership; the e2e suite is where the real app runs in CI.
- D4. `package.json` unchanged (`pnpm smoke:predeploy` keeps working); no new file under `scripts/`; `infra/render-app-spec*` and `infra/wait-for-deployment.sh` untouched.
- D5. Names: STC and STS; PC's `testIgnore` gains `"**/staging-golden-path.spec.ts"` and nothing else in PC changes; STS ALSO refuses itself without the opt-in env (defence in depth). PR 50 row 10: its intent only, never its object-form hunk.
- D6. The guards (the opt-in env, the base-URL rule) are one pure function in SG, called by STC at module load BEFORE any browser starts, and again by STS. Checked (a) by SGS, a small default-suite spec with pure calls only (no page, no navigation, no request), and (b) by the orchestrator's locked runs of STC that stop before any navigation (opt-in missing; a production host).
- D7. Sign-in by hand: one fresh in-memory browser context for the persona (the owner persona only, RO-L74-3 item 1); open `/` signed out and click the t("Tiếp tục với Google", "Continue with Google") link; BEFORE the human acts, read the Google authorize request's `redirect_uri` and require its origin to equal the base origin (fail closed: it proves the server's own `APP_BASE_URL` is this host, 2.4); print one stdout line naming the persona; then wait (a long per-persona timeout, the test timeout raised to match) until GET `/api/auth/session` answers 200 with a `personId`; a return to the app with `auth_error` in the query fails at once. The test never types a password and never reads or prints a cookie, a token or the `csrfToken`.
- D8. Nothing stored: STC sets `trace: "off"`, `screenshot: "off"`, `video: "off"`, no `storageState` anywhere, reporter `list` only (no html report, no attachments) and `preserveOutput: "never"` (2.4: the test's output dir, `error-context.md` included, is removed when the test ends); contexts are closed in `finally`; the shared host steps' `shot` argument is a no-op on staging (STS never calls `screenshotter`). Step-0 detail from S0b item 4 and GOAL (2): STC also sets `headless: false` (a headed browser for the human), `retries: 0` (a retry would sign in again and create a second club against the 3-per-hour limit) and `workers: 1`.
- D9 (corrected, and replaced by RO-L74-3 item 3; the staging host name is the owner's choice at step 8.2): the spec runs only with its opt-in env set; its base URL comes from `STAGING_BASE_URL`; it requires https and a host that is a subdomain of `plexco.app` whose first label starts with "staging"; it refuses `plexco.app` and `www.plexco.app` by name, any other host, loopback and IP literals, and an origin equal to `PRODUCTION_BASE_URL`'s when that is set; every check runs before any browser starts. The owner's staging subdomain must start with "staging" (for example staging.plexco.app) or the spec refuses it. Step-0 details (Tier A): the opt-in is `STAGING_GOLDEN_PATH=1`, exactly `1` (the precedent of `GOLDEN_PATH_ALLOW_SEEDED_CLUB === "1"`, GP:40); a missing or unparsable `STAGING_BASE_URL`, or a `PRODUCTION_BASE_URL` that is set but does not parse, refuses too (neither can be proven safe). Changing the host pattern is a reviewed code change.
- D10. Reuse: move the host steps GP:130-244 VERBATIM into ONE exported function in HS (for example `runHostSessionMoneyPath(page, { venue, address, alice, bob }, shot)`), called by GP's T1 and by STS; titles, order, assertions and pacer calls unchanged; `sessionUrl` (GP:55) becomes function-local; the onboarding step stays in each spec (the local throttle fallback; staging fails closed, section 9). The move is the first commit after this file and is a move, not a rewrite (RO-L74-2 item 1(a)). The pacer is imported unchanged (2.3); STS paces its session-API calls with a room at least as large as the host steps need (T1's 43 is safe: a larger room only waits longer). B3: the move alone is about 246 changed lines (section 7).

Outcomes of the step-0 open item and its consequence:

- O1 (RO-L74-3 item 1), "decided by the conductor under the owner's delegation of 2026-10-22, not an owner signature": STS is ONE owner-persona test: Google sign-in by hand (D7), then onboarding creates the run's club through the product, then the shared host steps of D10 (the same function T1 runs). T2-T4 do not run on staging: T2 (player) has no member path unless the owner first enables the owner-gated public `/discover` guest join (2.5), which would also break Q10's premise that the staging golden path needs no `/api/discover*` (PL:132), and its badge would read guest, not member; T3 (co-admin chat) has no co_admin grant path (`0072_member_name_definers_qualify_builtins.sql:317-318`, `dev-seed-club-members.ts:10-12`, DD-56 at DL:77); T4 (member chat) has no active-member path (`session-join-service.ts:350-354`) and a guest gets no chat (`my-clubs-view.tsx:28-34`). One backlog row records them (section 11, row 2). The local golden path keeps its 4 tests unchanged.
- The 8.3 consequence (RO-L74-3 item 2), "default applied, pending owner sign-off": step 8.3 needs ONE Google test account for the staging spec (the owner persona), not three (C6).

## 5. Acceptance matrix (A-1..A-16; expected results)

Layers: SMS and SGS run in the default suite (PC); every Playwright, local-server, DB or e2e run is the orchestrator's, through the lock with the sandbox off (RO-L74-1 item 2); greps and static checks are each writer's.

| # | Group | Input and precondition (who, layer) | Expected |
|---|---|---|---|
| A-1 | Happy path | SMS positive: SP with `SMOKE_BASE_URL` = the `baseURL` fixture against PC's `next start` (orchestrator, default suite) | exit 0; one PASS line naming the three checks; no stub |
| A-2 | Failure | SMS negatives, one 127.0.0.1 stub each with a unique body marker: `/healthz` 302; `/` 500; `/healthz` body `ok` (non-JSON); `/healthz` `{"ok":true}{"ok":true}`; `/` as `application/json` and the manifest as `text/html` (wrong type); `/healthz` never answers with a small `SMOKE_TIMEOUT_MS` | each exits 1; stderr names the check, never the marker; the timeout case ends in under 5 s |
| A-3 | Boundary | SMS: `/healthz` `{"ok":"true"}`; `SMOKE_BASE_URL=ftp://x` | exit 1; exit 2 (kept) |
| A-4 | Security | SMS: `bash infra/smoke-check.sh http://127.0.0.1:<port>` against a counting stub | exit 1, "origin must be https://", the stub counts 0 requests |
| A-5 | Regression | `grep -n -E 'https|SMOKE_TIMEOUT_MS|curl|jq|sleep' infra/smoke-check.sh` (W2) | the SC:8 refusal unchanged and before the node call; 7 tries 10 s apart; `SMOKE_TIMEOUT_MS=15000`; no `curl`, no `jq` |
| A-6 | Boundary, authorization | SGS (pure calls): refused: opt-in missing or not `1`; `http://staging.plexco.app`; `https://plexco.app`; `https://www.plexco.app`; another host (`https://example.com`, `https://app.plexco.app`); a "staging" label under another domain (`https://staging.example.com`, `https://staging.plexco.app.example.com`); loopback (`https://localhost`, `https://[::1]`); IP literals (`https://127.0.0.1`, `https://10.0.0.1`, `https://[2001:db8::1]`); an origin equal to `PRODUCTION_BASE_URL` (both `https://staging.plexco.app`); `STAGING_BASE_URL` missing or unparsable; `PRODUCTION_BASE_URL` set but unparsable. Accepted: `https://staging.plexco.app` with the opt-in set | each refused case throws a named message; the accepted case returns its origin |
| A-7 | Failure, security | orchestrator, locked: `pnpm --filter @plexco/web exec playwright test --config e2e/staging-golden-path.config.ts` (a) with `STAGING_BASE_URL=https://staging.plexco.app` and no opt-in; (b) with `STAGING_GOLDEN_PATH=1 STAGING_BASE_URL=https://plexco.app` | each exits non-zero with the guard's message before any browser starts and before any navigation or request |
| A-8 | Security, privacy | `grep -n -E 'trace|screenshot|video|storageState|reporter|preserveOutput|headless|retries' apps/web/e2e/staging-golden-path.config.ts`; `grep -n -E 'storageState|screenshotter|launchPersistentContext|csrfToken|cookies|dev-login|api/dev' apps/web/e2e/staging-golden-path.spec.ts apps/web/e2e/support/staging-golden-path-guard.ts` (W1) | STC: trace, screenshot and video `"off"`, no storageState, reporter `list` only, `preserveOutput: "never"`, `headless: false`, `retries: 0`; STS and SG: no match |
| A-9 | Regression | orchestrator, locked: `pnpm --filter @plexco/web exec playwright test` (PC) and `... playwright test --list` | all green, SMS and SGS included; `--list` names no `staging-golden-path.spec.ts` |
| A-10 | Regression, concurrency | orchestrator, locked: the local golden path once on the final head (sandbox off) | `4 passed`, with the interface facts, the club-limit timing and the pacer's wait lines; or an honest NOT RUN with the dev-login probe facts, never a workaround |
| A-11 | Regression | `git show --stat <move commit>`; `git diff --color-moved=zebra <base> <move commit>`; `grep -c '^test(' apps/web/e2e/golden-path.spec.ts` (W1, orchestrator) | the move commit touches HS (added) and GP (modified) only; GP:130-244 shows as moved, HS adds only its imports, the signature, the local `sessionUrl` and the closing brace; GP keeps 4 tests and its titles |
| A-12 | Static | `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm review:check:changed` before every commit (each writer); `pnpm review:check` at the end (orchestrator) | green |
| A-13 | Full suite | `pnpm -w test` once on the final head through the lock (orchestrator) | green |
| A-14 | Scope | the lane's final-checks.sh (orchestrator) | attribution 0; closing keywords 0; porcelain 0; files outside the ownership 0; file list = section 7; the B3 line logged with section 7's reason |
| A-15 | Scope | GitNexus `detect_changes` against the base (orchestrator) | only the section-7 files' symbols: SP's checks, SC, the e2e module; no product symbol |
| A-16 | Observability, scope | `git diff <base> -- docs/autopilot-backlog.md` (each writer) | at most 3 new `## task:` rows, all after BL's last line at base (7792); nothing else in BL changed |

## 6. Verification and review

- Order of work (RO-L74-2 item 1(a), RO-L74-3 item 5, C8): commit 1 = this file (the orchestrator); W1 (opus) = commit 2, the verbatim move alone (HS added, GP modified), then SG, SGS, STC, STS and PC's testIgnore line, then backlog row 2; W2 (opus) = SP, SC, SMS, RB's staging section and backlog row 1. One writer at a time; each writer runs A-12 and its own grep rows before each commit and commits in the worktree; the orchestrator runs A-1 to A-4, A-6, A-7, A-9, A-10 and A-13 to A-15 through the lock.
- RB's staging section (W2; owner-facing, so in the runbook's own language, Vietnamese prose with English commands and env names): the env NAMES `SMOKE_BASE_URL`, `STAGING_GOLDEN_PATH`, `STAGING_BASE_URL`, `PRODUCTION_BASE_URL` (no value of any secret); the smoke command and the staging golden path command; the opt-in; the rule that the staging subdomain must start with "staging" (for example staging.plexco.app) or the spec refuses it; ONE Google test account (the owner persona), whose password the owner keeps and types by hand; `${APP_BASE_URL}/api/auth/google/callback` as an authorized redirect URI of the staging Google client (PL:199); nothing stored (no storageState, trace, screenshot or video), so the list output can be kept as G2's run log (PL:241).
- Review (the lane block's REVIEW PLAN): ONE opus reviewer role, at most 3 rounds counting pre-push rounds (C16), with the credential rule and the production refusal (section 8) checked line by line. The last round follows the L44 policy: a P3 or lower = a docs- or comment-only fix labelled "fix applied after the final round, not re-reviewed (3-round cap)"; a P1 or P2 or any code change = the notes folder's RQ-L74-R3.md and RESULT: AWAIT. CI green on ONE push.

## 7. Budget (B3) and files

The lane block estimates about 250 changed lines in 2 modules, 0 migrations. Step-0 estimate per file (changed = added + deleted). Class as the lane's b3-measure.sh counts it: `apps/web/e2e/**` and `*.spec.ts` = test; `*.md` = docs, outside the caps; everything else = non-test.

| File | A/M | Needed by | Class | Estimate |
|---|---|---|---|---|
| `scripts/smoke-predeploy.mjs` | M | D1 | non-test | ~90 |
| `infra/smoke-check.sh` | M | D2: the adapter (RO-L74-1 allows it; every L65 check and its exit codes kept) | non-test | ~30 |
| `apps/web/playwright.config.ts` | M | D5: the testIgnore entry only | non-test | ~2 |
| `apps/web/e2e/smoke-predeploy.spec.ts` | A | D3: default suite, small; the PR body states its duration | test | ~100 |
| `apps/web/e2e/support/golden-path-host-steps.ts` | A | D10: the verbatim move of GP:130-244 | test | ~125 |
| `apps/web/e2e/golden-path.spec.ts` | M | D10: calls the moved function, behavior identical; the move is the first commit after this one | test | ~121 |
| `apps/web/e2e/support/staging-golden-path-guard.ts` | A | D6, D9 | test | ~55 |
| `apps/web/e2e/staging-golden-path-guard.spec.ts` | A | D6: default suite, pure calls only | test | ~60 |
| `apps/web/e2e/staging-golden-path.config.ts` | A | D5, D8 | test | ~35 |
| `apps/web/e2e/staging-golden-path.spec.ts` | A | D5, D7; in testIgnore | test | ~110 |
| `docs/runbooks/local-mvp-smoke.md` | M | the staging section the owner reads at 8.6 (section 6) | docs | ~40 |
| `docs/autopilot-backlog.md` | M | at most 3 rows at the END (section 11) | docs | ~35 |
| `docs/sessions/web-mvp-phase5-readiness-p5-staging-smoke-golden-path.md` | A | this file | docs | 232 (measured at write time) |

Totals: about 122 non-test and about 606 test lines, 728 code lines in 2 code modules (the smoke surface: `scripts/` and `infra/`; the e2e module: `apps/web/e2e/` and PC), plus about 307 docs lines outside the caps; 0 migrations. The lane block's 250 will be overrun (about 2.9 times): logged with its design reason, not a stop. GOAL (3) asks for reuse, not a copy: the verbatim move alone is about 246 changed lines, because a move counts as delete plus add (about 115 lines deleted from GP, about 125 added in HS, about 6 edited). The rest is D1's one tested definition (SMS) and D6's pure guard with its own spec, which the estimate did not count. This is a property of the contract (the estimate predates D1, D6 and D10), not of a slice; the non-test code, about 122 lines, stays well inside the gate's default of about 300. A second overrun on the same cause is a design signal (re-slice), not more lines.

## 8. The credential rule and the production refusal (checked line by line by the reviewer)

- R1. No credential stored: STC and STS write no storageState, cookie dump, password env, trace, screenshot, video or html report (D8); the browser context lives in memory and is closed in `finally`; the only stdout lines are the persona prompt and the list reporter's; nothing prints the `csrfToken` (session route :33) or a cookie; the session cookie is httpOnly (2.4).
- R2. Residual, low: a failure message on the list reporter's stdout can quote page text; it holds no cookie, token or password because none is rendered. `error-context.md` (an ARIA snapshot of the page) is removed when the test ends under `preserveOutput: "never"` (2.4; read, not run).
- R3. The production refusal (D9) runs in STC at module load, before any browser or request, and again in STS; SGS covers every refused class and the accepted shape (A-6); the locked runs prove "before any navigation" (A-7). The `redirect_uri` origin check (D7) is a second guard at run time: it proves the server's own `APP_BASE_URL` before the human acts.
- R4. No test-only path: STS calls no dev-login route (`/dev-login`, `/api/dev/login`, `signInAsPersona`), not T2's test-only join call, and no seed; its only sign-in is the product's Google flow (2.4) and its only data is the club and session it creates through the product.
- R5. Smoke output: SP prints the check, the status and the content type, never a body (A-2); SC prints SP's lines and its own fixed refusal text.
- R6. SC never downgrades to http (SC:8 before any request, A-4). SP keeps accepting http for local use (SP:21, D1); the owner's step-8.6 commands in RB use https.

## 9. Known risk

- K1. The club limit, 3 per account per hour (`onboarding/start/route.ts:38`), and the pacer's server limit, 60 per 60 s per account (`session-command-route.ts:99`), are Postgres-backed and apply on staging; the owner plans the step-8.6 runs around them. STS's throttled branch fails closed: no seeded club fallback (STS reads no `GOLDEN_PATH_ALLOW_SEEDED_CLUB`), and a refused club creation fails the test with a named message.
- K2. The sign-in wait must prove sign-in through GET `/api/auth/session` (200 with a `personId`, D7), never through the URL (2.4); a human-wait timeout fails with a named message.
- K3. The Google `redirect_uri` origin check runs before the human acts (D7); a mismatch (the server's `APP_BASE_URL` is not this host) fails before any password is typed.
- K4. Google may refuse an automated Chromium: no repo evidence either way (S0b item 4). The owner's first headed run at 8.6 is the probe; this lane never runs STS against a remote host (RO-L74-1 item 3).
- K5. The OAuth routes allow 10 requests per 60 s per IP (2.4); one persona per run stays far below.
- K6. Staging itself is not exercised by this lane: the guard, the move and the smoke are proven locally; the staging run is the owner's (8.6), with a staging host whose first label starts with "staging" (8.2) and ONE Google test account (8.3).
- K7. SC now retries the whole smoke (7 tries, 10 s apart) instead of each curl call; the worst case is about 7 x (3 x 15 s + 10 s). Whether L67 still needs the retry once it awaits the deployment by id is L67's call (S0a unresolved 1; backlog row 1).
- K8. The stubs bind 127.0.0.1 (S0a unresolved 2): the agent sandbox may refuse it, so SMS runs only in the orchestrator's locked default-suite run with the sandbox off, and in CI e2e-web.

## 10. Open

`OPEN_QUESTIONS_IN_SCOPE: 0`. Out of scope with the current behavior pinned: T2-T4 on staging (RO-L74-3 item 1; backlog row 2); L67's adapter requirement (backlog row 1); the owner's steps 8.2, 8.3 and 8.6 (enablement only: STS is inert without its opt-in and refuses every non-staging host); the owner's sign-off of D1-D10 and of the 8.3 consequence (defaults applied).

## 11. Hard dependencies and backlog rows

- PR 137 merged (lane L65): the base `4230c752ec0ddb2a14e2a07714a901c6022e862c` IS the merge commit of PR 137 (its subject names PR 137 and the branch `feat/p5-staging-tooling-port`; parents `779619deca20b07f20173cea98e66df442fecd8d` and `3abe991c66c5cf9551b1d862fe0f760d301c85a8`). `git merge-base --is-ancestor 4230c752ec0ddb2a14e2a07714a901c6022e862c HEAD` is true and `git rev-parse origin/main` equals the base (measured). Lane L73 runs beside this lane: no shared file; the ONE DB/e2e lock is shared, so wait for it.
- At most 3 rows at the END of BL (7792 lines at base; its last row is `## task: p5-entrypoint-provision-role-fails-if-no-package-matches` at BL:7780). Row 1 (W2, D2): L67's deploy workflows call `infra/smoke-check.sh https://<origin>` with the same shape but need node 22 and the repo checkout on the runner, no curl or jq, and decide whether the 7 x 10 s retry stays once they await the deployment by id (K7). Row 2 (W1, RO-L74-3 item 1): the staging golden path gains the player, co-admin and member-chat tests when a product path exists (DD-44 invite tokens, DD-52 guest-to-full approval, DD-56 grant lifecycle), or the player test through `/discover` once discovery is live on staging. Row 3: only if a writer finds an out-of-scope fact that needs one.

## 12. Closure matrix (12 of 12 PASS)

| # | Gate | Evidence | Result |
|---|---|---|---|
| 1 | Authority snapshot pinned by SHA | `AUTHORITY_SHA` = HEAD = base = origin/main = the merge commit of PR 137 (measured); every TARGET_FILES path exists at the base | PASS |
| 2 | Decisions in scope final | DD-154 (PL row L74, Q1, Q9); RO-L74-1, RO-L74-2, RO-L74-3; D1-D10 and the 8.3 consequence as defaults pending owner sign-off; O1 decided by the conductor (section 4) | PASS |
| 3 | Scope IN/OUT and owner clear | section 7's 13 files; section 1's negative scope; section 6's writer order | PASS |
| 4 | Dependencies classified | PR 137 merged (section 11); L73 beside (no shared file, the shared lock); L67 downstream (backlog row 1) | PASS |
| 5 | Live schema and code match | section 2 re-measured at the base; no schema, no migration | PASS |
| 6 | Data, API, state, auth contract | the smoke contract (D1, D2), the guard contract (D9), the sign-in contract (D7, 2.4), nothing stored (D8) | PASS |
| 7 | Fail-closed, idempotency, order | D1 (redirects fail, one timeout per request, one JSON document); D9 (an allowlist, every check before a browser); K1 (the throttled branch fails closed); D10 (the move first, alone) | PASS |
| 8 | Open questions in scope = 0 | section 10 | PASS |
| 9 | Acceptance matrix with expected results | section 5 (A-1..A-16) | PASS |
| 10 | Migration, security, rollback | no migration; no security round planned, the reviewer checks section 8 line by line; rollback = revert the PR | PASS |
| 11 | First slice hard dependencies merged | W1's first commit depends on nothing unmerged (section 11) | PASS |
| 12 | Implementation handoff ready | sections 2, 4, 5, 6 and 7; W1 has every input | PASS |

## 13. Verdict

```text
REVIEW_POLICY_VERSION: 1.3
REVIEW_VERDICT: CODE_READY
REVIEWED_AT: 2026-10-29
AUTHORITY_SHA: 4230c752ec0ddb2a14e2a07714a901c6022e862c
BASE_BRANCH: main
TARGET_FILES:
  - scripts/smoke-predeploy.mjs (edited: the one smoke definition, D1)
  - infra/smoke-check.sh (edited: the adapter, D2)
  - apps/web/e2e/golden-path.spec.ts (edited: calls the moved host steps, D10)
  - apps/web/playwright.config.ts (edited: the testIgnore entry only, D5)
  - docs/runbooks/local-mvp-smoke.md (edited: the staging section only)
  - docs/autopilot-backlog.md (edited: new rows at the end only, cap 3)
  - apps/web/e2e/support/golden-path-helpers.ts (read-only: the pacer, imported unchanged)
  - apps/web/e2e/golden-path.config.ts (read-only: the local config, unchanged)
  - apps/web/app/healthz/route.ts (read-only: the healthz body)
  - apps/web/e2e/pwa.spec.ts (read-only: the manifest content type)
  - apps/web/app/api/auth/google/state/route.ts (read-only: the redirect_uri)
  - apps/web/app/api/auth/session/route.ts (read-only: the sign-in proof)
  - apps/web/app/api/onboarding/start/route.ts (read-only: the club limit)
  - .github/workflows/ci.yml (read-only: the e2e-web job)
  - package.json (read-only: smoke:predeploy and test:infra)
  - docs/sessions/web-mvp-phase5-golive-plan.md (read-only: row L74, Q4, Q9, Q10, steps 8.2, 8.3, 8.6, G2)
SLICE: p5-staging-smoke-golden-path
IN_SCOPE: the smoke surface (scripts/smoke-predeploy.mjs as the one definition, infra/smoke-check.sh as its adapter, apps/web/e2e/smoke-predeploy.spec.ts); the host-step move (apps/web/e2e/support/golden-path-host-steps.ts, apps/web/e2e/golden-path.spec.ts); the staging golden path (apps/web/e2e/support/staging-golden-path-guard.ts, apps/web/e2e/staging-golden-path-guard.spec.ts, apps/web/e2e/staging-golden-path.config.ts, apps/web/e2e/staging-golden-path.spec.ts, the testIgnore entry of apps/web/playwright.config.ts); the staging section of docs/runbooks/local-mvp-smoke.md; at most 3 backlog rows; this readiness file
OUT_OF_SCOPE: apps/web/lib/dev-login/ and any dev-login call from the staging spec; any stored credential (storageState, cookie dump, password env); product code (routes, components); the local golden path's behavior and the pacer's budget; a CI job for the staging spec; production data; workflows (L67); App Specs (L66); root package.json and any new scripts/ file (D4); a test-only membership or role path; a run of the staging spec against a real remote host
G1_DECISION: PASS
G2_SPEC: PASS
G3_DEPENDENCY: PASS
G4_TEST: PASS
G5_SCOPE: PASS
G6_EXTERNAL: ENABLEMENT_ONLY:owner-step-8.6-staging-run
HARD_DEPENDENCIES: PR 137 merged (the base is its merge commit; git merge-base --is-ancestor is true, measured)
PRIOR_SLICES: PR 137 (merged, lane L65: infra/smoke-check.sh); PR 136 (merged, in the base)
OPEN_QUESTIONS_IN_SCOPE: 0
ENABLEMENT_ONLY_GATES: owner-step-8.6-staging-run (the owner's staging run: a staging host whose first label starts with "staging" from step 8.2, ONE Google test account from step 8.3; the spec is inert without its opt-in and refuses every other host)
LIVE_REPO_VERIFICATION: PASS
CONTRACT_MATRIX: PASS
CLOSURE_MATRIX: PASS
ACCEPTANCE_MATRIX: PASS
SECURITY_AND_MIGRATION_GATE: PASS # no migration; no security round planned, the reviewer checks the credential rule and the production refusal line by line (section 8); rollback = revert the PR
IMPLEMENTATION_ARTIFACTS: PASS
FIRST_IMPLEMENTATION_STEP: W1 - move golden-path.spec.ts:130-244 verbatim into one exported function in apps/web/e2e/support/golden-path-host-steps.ts that T1 calls (one commit: the move and nothing else), run pnpm typecheck, pnpm lint, pnpm format:check and pnpm review:check:changed, commit in the worktree
REMAINING_BLOCKERS: none
```
