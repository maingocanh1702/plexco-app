# Audit-fix lanes — prompt sẵn dùng cho toàn bộ findings 06/09

**Ngày:** 06/09/2026 · **Base:** `main@30a3e90` (re-pin `origin/main` trước khi register) ·
**Nguồn:** `docs/sessions/2026-09-06-repo-audit.md` (derived) · **Ưu tiên:** BE + infra trước, FE sau.

> **Vì sao là lane chứ không phải một commit "fix hết".** Mọi item dưới đây chạm code chạy thật (migration,
> auth route, dispatcher, CI gate). Repo cấm sửa thẳng `main` (`CLAUDE.md` §Workflow), mỗi writing slice
> phải register qua scope-gate và qua ít nhất một vòng codex; và **ba** trong số này đụng invariant có
> owner (`billing-authz`, `publish-suspend-gate`, `auth`). "Fix hết" nghĩa là: **mọi finding có lane, mọi
> lane có prompt chạy được, và không finding nào không có chủ.** Hai item cần owner ký (A9, C-list) được
> soạn sẵn tới mức chỉ còn ký.

**Dán khối `REPO CONTEXT` ở `be-infra-lanes-2026-09-02-RUN.md` §"Bối cảnh chung" trước mọi lane**, sửa
`Base: main @ 30a3e90` và đọc thêm `docs/sessions/2026-09-06-repo-audit.md` (chỉ mục §2 của finding lane
mình sở hữu). §00 + §00b của doc 02/09 vẫn hiệu lực nguyên văn (`risk` chỉ P1/P2, `autonomy_mode`
= `supervised`, `check-review-readiness.mjs` là file consumer — **không** phải kit-sync, đo
`kit-pack-membership.json`: `overwrite_path: none`).

---

## Thứ tự và song song

| Lane | Vùng | Đóng | Migration tail | Chạy sau | Song song được với |
|---|---|---|---|---|---|
| **A1** | ci | X-1, X-6 | — | — | A3, A5, A6, A8 |
| **A2** | db | D-2 | **0037** | — | A1, A3, A5, A6 |
| **A3** | web+db | W-5, W-1 | — | — | A1, A2, A5 |
| **A4** | db | D-1 | **0038** | **A2** (tail) | A5, A6 |
| **A5** | bot | B-1, X-3 | — | — | mọi lane |
| **A6** | web | W-2, W-3 | — | **A3** (cùng `apps/web/app/api/auth/google/`) | A1, A2, A4, A5 |
| **A7** | infra | X-2, X-4 | — | **A2** (web dev sang role `app` sẽ lộ D-2) | A5, A6 |
| **A8** | docs+backlog | §3 drift, §4 gap | — | sau A3 (row telegram) | — (root lock, docs only) |
| **A9** | authoring | Gap #1 (GET routes) | — | owner ký amendment | — |

Hai lane cùng chạm `packages/db/migrations/` **không** chạy song song (tail). A3 và A6 cùng chạm
`apps/web/app/api/auth/` — tuần tự. Mọi lane đều `risk: P2`, `autonomy_mode: supervised`,
`code_review.clean_rounds: 2` cho lane chạm auth/money/permission (A2, A3, A4, A6), `1` cho còn lại;
`security_review.required: true` cho A2, A3, A4, A6.

---

## A1 · ci · `review:check` không resolve được `main` ngoài checkout của `main`

**Đo:** `scripts/check-review-readiness.mjs:189` `merge-base --is-ancestor <sha> main`;
`gitSucceeds` `:154-162` trả `false` với mọi exit ≠ 0. `ci.yml:6` trigger `pull_request` + `push:
feat/**`; `:36-42` `fetch-depth: 0` chỉ tạo `refs/remotes/origin/*`. Git không DWIM `main` →
`origin/main`. 50 verdict block ⇒ 50 × `AUTHORITY_NOT_MAIN`. `ci.yml` không có `permissions:`.
**Không phải kit file** — sửa tại consumer.

**Tier C:** 0 · **Rủi ro:** P2

```text
TASK: ci-review-check-resolve-origin-main
RISK: P2
BASE: current origin/main

OUTCOME
  `pnpm -w review:check` passes on a pull_request checkout and on a feat/** push checkout,
  not only on main. CI declares least-privilege token permissions.

MEASURE FIRST, then fix
  M1. scripts/check-review-readiness.mjs:189 passes the literal "main" to
      `git merge-base --is-ancestor`. Reproduce the failure locally without GitHub:
        git clone --no-checkout . /tmp/rr && cd /tmp/rr && git checkout --detach origin/main
        git branch -D main 2>/dev/null; node <path>/check-review-readiness.mjs --all
      Expect AUTHORITY_NOT_MAIN on every pinned verdict. Record the count in the ledger.
  M2. Confirm no other call site hard-codes "main" in that file (grep). If there is, fix all.

FIX
  - Resolve the main ref once: prefer `refs/remotes/origin/main` when it exists, else `main`,
    else fail with a NEW error code MAIN_REF_UNRESOLVABLE that names both refs tried. Never
    silently pass.
  - Add a test in scripts/check-review-readiness.test.mjs that builds a throwaway repo with
    ONLY origin/main (no local main) and asserts the pin is accepted; and one with neither ref
    asserting MAIN_REF_UNRESOLVABLE. Property tests, no pinned SHAs.
  - .github/workflows/ci.yml: add top-level `permissions: { contents: read }` (security.yml and
    linear-sync already declare theirs — copy the shape). Do NOT change concurrency; note in the
    ledger that cancel-in-progress on main is a known, accepted trade-off (X-6), not fixed here.
  - Remove the comment at ci.yml:38-41 that claims fetch-depth: 0 alone is sufficient; replace
    with one sentence pointing at the resolver.

SCOPE
  scripts/check-review-readiness.mjs
  scripts/check-review-readiness.test.mjs
  .github/workflows/ci.yml
NEGATIVE SCOPE
  No change to autopilot-review-readiness.mjs, autopilot-scope-gate, ap-finish.sh,
  codex-review-pin.sh (all kit-sync). No change to what review:check VALIDATES — only how it
  resolves the main ref. No workflow trigger changes.
INVARIANTS
  review-integrity, test-chain

ACCEPTANCE
  - M1 reproduction fails BEFORE the fix and passes AFTER, both recorded verbatim.
  - `pnpm -w test` green (the readiness layer count moves; do not pin it).
  - One clean independent review round.
```

---

## A2 · db · `tenant_provision()` / `tenant_ids_for_person()` vỡ dưới RLS khi owner không `BYPASSRLS`

**Đo:** `0028:218-283` SECURITY DEFINER, owner = migration role, `INSERT INTO memberships /
tenant_admins / subscriptions / onboarding_runs` — cả bốn FORCE RLS `WITH CHECK tenant_id = GUC`
(`0009:51-55`) — thân hàm **0** `set_config`. FORCE áp cả table owner. `migrate.test.ts:1336-1341`
tự ghi nhận hazard. `0022:28-50` pin attribute cho `job_definer` nhưng không có precondition cho
owner của hàm này. `tenant_ids_for_person` (`0012:305-318`) đọc `tenant_admins` cross-tenant cùng
cách.

**Tier C:** 0 (không mở quyền nào — hàm tự scope GUC bên trong) · **Rủi ro:** P2 · **Tail:** 0037

```text
TASK: db-tenant-provision-rls-self-scope
RISK: P2
BASE: current origin/main

OUTCOME
  tenant_provision() and tenant_ids_for_person() work when their owner role is
  NOSUPERUSER NOBYPASSRLS, without granting BYPASSRLS to anyone.

MEASURE FIRST
  M1. Reproduce under packages/db/src/test-harness.ts setupNonSuperuserOwnerContext: replay
      0000..0036 as the non-superuser owner, call tenant_provision(...) as role app. Expect
      "new row violates row-level security policy for table memberships". Record verbatim.
  M2. Same context, tenant_ids_for_person(<person with 2 tenants>) as app. Expect [] or an
      RLS error. Record which.

FIX — migration 0037 (next tail; verify with ls before naming)
  - CREATE OR REPLACE FUNCTION tenant_provision(text,text,text,text,uuid) with the SAME
    signature, SAME body, plus: immediately after v_tenant is known and before the first
    tenant-scoped INSERT, `PERFORM set_config('app.tenant_id', v_tenant::text, true);` (txn-local).
    Keep SECURITY DEFINER, `SET search_path = public, pg_temp`, and re-issue
    REVOKE ALL FROM PUBLIC / GRANT EXECUTE TO app exactly as 0028:282-283 does — CREATE OR
    REPLACE preserves grants, but restate them so the migration is self-describing.
  - tenant_ids_for_person: it must read tenant_admins ACROSS tenants for one person. A GUC
    cannot express that. Two acceptable designs — pick one, ledger the choice (Tier B):
      (a) declare the function's read as RLS-exempt by making tenant_admins readable through a
          dedicated definer owned by a BYPASSRLS NOLOGIN role (the job_definer/chat_definer
          bootstrap pattern: infra/postgres-init/*.sql + attribute precondition like 0022:28-50);
      (b) add a narrow policy on tenant_admins: `person_id = current_setting('app.person_id')`
          style read, if such a GUC already exists (grep chat_current_is_member for precedent).
    Prefer (b) if the person GUC is already a repo concept; else (a). Either way the function
    must fail CLOSED (empty) when the GUC/precondition is absent.
  - Add a precondition block at the top of 0037 (shape of 0022:28-50) asserting whatever
    attribute the chosen design needs; RAISE with a `pnpm db:bootstrap` hint.

TESTS (packages/db/src/rls-invariants.test.ts or migrate.test.ts — pick the file whose harness
already has setupNonSuperuserOwnerContext)
  - M1 and M2 rewritten as assertions that PASS after 0037, run under the non-superuser owner.
  - A negative test: app cannot read tenant_admins rows of a person it did not authenticate as.

SCOPE
  packages/db/migrations/0037_tenant_provision_rls_self_scope.sql   (new)
  packages/db/src/migrate.test.ts  OR  packages/db/src/rls-invariants.test.ts (one, declare which)
  infra/postgres-init/03-tenant-definer.sql                          (only if design (a))
NEGATIVE SCOPE
  No change to 0009 policies, no BYPASSRLS on app/app_worker/readonly/migration role, no
  schema.ts change, no change to apps/web/app/api/onboarding/start/route.ts.
INVARIANTS
  schema, auth

ACCEPTANCE
  - Full suite green under BOTH harness contexts (superuser and non-superuser owner).
  - Security round: reviewer confirms no role gained a privilege it lacked at base.
  - Two clean rounds.
```

---

## A3 · web + db · Readiness không bao giờ `ready`; gỡ đường auth Telegram còn sống

**Đo:** `readiness/route.ts:19-20` `REQUIRED_STEPS` có `tg_bind` (0 writer toàn repo), `first_session`
optional — spec `feature_web_auth_onboarding_tech.md:120-129` nói ngược. Telegram: `api/auth/
telegram/{state,callback}/route.ts`, `apps/web/lib/telegram-login.ts`, `packages/db/src/auth.ts:46
loginTelegram`, `infra/fly.toml:6` `TELEGRAM_BOT_TOKEN`, test pin `google/callback/route.test.ts:312`
(D1-14 assert route Telegram **tồn tại**). DD-37 loại Telegram từ 16/07; backlog
`auth-provider-google-email-swap` `idea`, điều kiện "sau khi Google land" đã thoả 22/07.

**Tier C:** 0 (DD-37 đã quyết; đây là thi hành) · **Rủi ro:** P2 · **Không migration** — thu hẹp
`channel_identities_platform_chk` là row riêng (A8 tạo), vì `account_identities` có thể còn row
`telegram` dữ liệu thật; xoá code trước, siết schema sau khi đo dữ liệu.

```text
TASK: web-onboarding-readiness-predicate-and-telegram-removal
RISK: P2
BASE: current origin/main

OUTCOME
  (1) GET /api/onboarding/readiness implements the spec predicate and CAN return ready:true.
  (2) No Telegram auth code path exists in apps/web or packages/db exports.

PART 1 — readiness
  - Replace REQUIRED_STEPS/OPTIONAL_STEPS at readiness/route.ts:19-20 with the spec
    (feature_web_auth_onboarding_tech.md:120-129): required = club_config, bank_connect,
    first_session; optional = zalo_connect (and messenger_page if that step literal already
    exists in onboarding_steps — measure, do not invent). Remove tg_bind entirely.
  - Keep the DD-118 seam and the owner check EXACTLY as they are (route.ts:24-44 comment block
    is a disclosure boundary; do not move resolveTenantLang up).
  - Test: a tenant whose three required steps are `verified` gets ready:true; one with
    bank_connect=`registered` gets ready:false; zalo_connect=`error` does not change the answer.
    Today no test can produce ready:true — that is the defect being fixed; say so in the test
    name.

PART 2 — telegram removal (code only)
  - Delete apps/web/app/api/auth/telegram/state/route.ts and .../callback/route.ts and their
    tests; delete apps/web/lib/telegram-login.ts (+test).
  - packages/db/src/auth.ts: remove loginTelegram and any Telegram-only helper it alone uses;
    packages/db/src/index.ts: remove the export. Do NOT touch the SQL function
    auth_login_telegram (0012) — dropping it is a migration and is out of scope here.
  - apps/web/app/api/auth/google/callback/route.test.ts:312 (D1-14) pins the Telegram route's
    existence. Rewrite the pin to assert the OPPOSITE property (no file under
    apps/web/app/api/auth/telegram/) so the removal cannot silently regress.
  - infra/fly.toml: remove TELEGRAM_BOT_TOKEN from the secrets list; .env.example: remove the
    variable and its comment block. If any other file references TELEGRAM_BOT_TOKEN, list it in
    the ledger — do not chase beyond scope.
  - Route count in docs is A8's job; do not edit ROADMAP here.

SCOPE
  apps/web/app/api/onboarding/readiness/route.ts (+ its test)
  apps/web/app/api/auth/telegram/state/route.ts, .../callback/route.ts (+ tests)  [delete]
  apps/web/lib/telegram-login.ts (+ test)                                        [delete]
  apps/web/app/api/auth/google/callback/route.test.ts
  packages/db/src/auth.ts, packages/db/src/index.ts
  infra/fly.toml, .env.example
NEGATIVE SCOPE
  No migration. No schema.ts change (platform CHECK narrowing is a follow-up row). No change to
  onboarding/start. No FE.
INVARIANTS
  auth, transport-telegram

ACCEPTANCE
  - `grep -rn telegram apps/web/app apps/web/lib packages/db/src/index.ts` returns only comments
    that explain the removal, or nothing.
  - Full suite green; DD-56 lint guard (readiness is an allowlisted file) still passes.
  - Security round; two clean rounds.
```

---

## A4 · db · `app` có full DML trên `subscriptions` — nguồn sự thật của entitlement + suspension

**Đo:** `0009:42,57` `GRANT SELECT, INSERT, UPDATE, DELETE ON subscriptions TO app`; không REVOKE nào
sau đó. `authorization.ts:190-209` đọc `status` `FOR SHARE`; `capability.ts:184-235` đọc `plan_key,
plan_version` `FOR SHARE`. `0027:6-10` đã đóng đúng lỗ này cho `tenants.status` bằng
`resolve_tenant_status_locked`. `FOR SHARE` đòi privilege UPDATE — REVOKE trần sẽ làm hai gate vỡ.
`tenant_provision` (definer) là writer duy nhất hôm nay.

**Tier C:** 0 — không đổi allow-set, không đổi matrix; chỉ đổi *cơ chế đọc*. **Nhưng chạm hai
invariant có owner** ⇒ security round bắt buộc, cite DD-110 D2 + DD-29. · **Rủi ro:** P2 ·
**Tail:** 0038 (sau A2)

```text
TASK: db-subscriptions-read-via-definer
RISK: P2
BASE: current origin/main   (A2 must have landed: tail is 0037)

OUTCOME
  Role app can no longer INSERT/UPDATE/DELETE subscriptions. Both gates still read the row
  under FOR SHARE, through one SECURITY DEFINER in the exact shape of 0027.

MEASURE FIRST
  M1. As app inside withTenant(T): UPDATE subscriptions SET plan_key='host_pro',
      plan_version=<current>, status='active' WHERE tenant_id=T. Expect success at base
      (that is the finding). Then resolveCapability(T,'payment_reconcile_auto') → ALLOW.
      Record both. This becomes the negative test after the fix.
  M2. grep every writer of subscriptions in packages/ apps/ (non-test). Expect only
      tenant_provision (definer). If a TS writer exists, STOP and AWAIT — the premise is wrong.

FIX — migration 0038
  - CREATE FUNCTION resolve_subscription_locked(p_tenant_id uuid)
      RETURNS TABLE(status text, plan_key text, plan_version int)
      SECURITY DEFINER, SET search_path = public, pg_temp, STABLE is WRONG here (it locks) —
      VOLATILE. Body: `SELECT status, plan_key, plan_version FROM subscriptions WHERE tenant_id
      = p_tenant_id FOR SHARE`. It must assert `p_tenant_id = NULLIF(current_setting(
      'app.tenant_id', true),'')::uuid` and RAISE insufficient_privilege otherwise — the 0033
      raise_public_session_fence shape (0033:173-180), NOT the 0027 shape which accepts any
      tenant. Copy the header comment discipline of 0027 (why FOR SHARE needs a definer).
  - REVOKE ALL ON FUNCTION ... FROM PUBLIC; GRANT EXECUTE TO app.
  - REVOKE INSERT, UPDATE, DELETE ON subscriptions FROM app. Keep SELECT (RLS-scoped reads are
    legitimate for the future billing UI; the finding is about writes).
  - packages/db/src/authorization.ts:190-209 and capability.ts:184-235: replace the direct
    FOR SHARE reads with `SELECT * FROM resolve_subscription_locked($1)`. Keep every branch,
    every allow-set literal, every error identical. The diff of the decision logic must be
    empty; only the data source moves. Say that in the commit message and prove it with the
    existing tests staying untouched.

TESTS (rls-invariants.test.ts — the file that already owns 0027's tests)
  - M1 inverted: app UPDATE on subscriptions → 42501. app DELETE → 42501.
  - resolve_subscription_locked with a foreign tenant_id → insufficient_privilege.
  - Both gates still return the same verdict table as before (reuse existing tests; do not
    duplicate them).

SCOPE
  packages/db/migrations/0038_subscriptions_read_via_definer.sql   (new)
  packages/db/src/authorization.ts
  packages/db/src/capability.ts
  packages/db/src/rls-invariants.test.ts
NEGATIVE SCOPE
  No change to the ActionClass enum, the allow-set literals, the Suspended Action Matrix, or
  0027. No change to tenant_provision. No change to subscription_invoices.
INVARIANTS
  schema, billing, billing-authz, publish-suspend-gate

ACCEPTANCE
  - Decision-logic diff in authorization.ts/capability.ts is limited to the query call.
  - Full suite green; security round cites DD-110 D2 and DD-29 and confirms allow-sets are
    byte-identical; two clean rounds.
```

---

## A5 · bot · Dispatcher chết cả cycle khi projector thật trả outcome sai grammar; tiền đề "no producer" đã mục

**Đo:** `dispatcher.ts:233-247` try/catch chỉ bọc `deliver()`; `complete_projector_delivery` gọi ngoài
try `:250-262`; `0022:424-437` RAISE `invalid_parameter_value` (SQLSTATE `22023`) khi `error_code !~
'^[a-z][a-z0-9_]{0,63}$'` hoặc `retry` với `next_attempt_at <= clock_timestamp()`. Reclaim
expired-first + `ORDER BY event_id` (`0022:343-349`) ⇒ cùng row lặp lại. Comment `:139-151` chỉ đúng
với throw. `dispatcher.ts:60-64` + `queues.ts:12-13` nói "no producer inserts outbox_events" —
`session-service.ts:274,656,919,1510,1526,1814,2150,2189` insert 8 loại event.

**Tier C:** 0 (flag vẫn OFF; lane KHÔNG bật) · **Rủi ro:** P2

```text
TASK: bot-dispatcher-outcome-grammar-fail-closed
RISK: P2
BASE: current origin/main

OUTCOME
  A projector returning a malformed DeliveryOutcome cannot abort the dispatch cycle or
  head-of-line-block the queue. Stale "no producer" comments are corrected. Enabling the
  schedule with the stub deliverer is refused at startup.

MEASURE FIRST (dispatcher.test.ts, real PG)
  M1. deliver = () => ({ result: "dlq", errorCode: "ECONNRESET" }). Expect runDispatchCycle to
      REJECT with 22023 and the delivery row to stay `claimed`. Record.
  M2. deliver = () => ({ result: "retry", nextAttemptAt: new Date(0), errorCode: "x" }). Same.

FIX
  - completionArgs(): normalise before the SQL call — errorCode lower-snake, truncated to 64,
    non-matching input replaced by a canonical code (e.g. "malformed_error_code") with the
    original preserved in a log line; retry with a non-future nextAttemptAt is coerced to a
    dlq with code "malformed_next_attempt" (fail closed: a retry we cannot schedule is not a
    retry). Document the mapping table in a comment.
  - Wrap the complete_projector_delivery call: on SQLSTATE 22023 ONLY, retry once with
    {result:"dlq", errorCode:"malformed_outcome"}; any other SQLSTATE propagates as today.
  - Fix the two stale comments (dispatcher.ts:60-64, queues.ts:12-13): producers exist; the
    schedule stays OFF because dlq is terminal (worker.ts:24-33 is the accurate text — point
    to it, do not duplicate it).
  - worker.ts: when OUTBOX_DISPATCH_SCHEDULE_ENABLED === "true" AND the configured deliverer
    is productionStubDeliver, refuse to register the schedule (log one line naming the
    reason) and keep the existing unschedule() path. Ledger this as Tier B: it narrows an
    already-documented hazard; it does not enable anything.

TESTS
  - M1/M2 inverted: cycle completes, row ends `dlq` with the canonical code, next cycle
    proceeds to other rows.
  - A test that the stub + enabled flag does NOT create a pgboss.schedule row.

SCOPE
  apps/bot/src/dispatcher.ts (+test)
  apps/bot/src/queues.ts
  apps/bot/src/worker.ts (+ schedule.test.ts if that is where the enable path is tested)
NEGATIVE SCOPE
  No SQL change (0022/0023 untouched). Do not enable the flag. No replay path (that is
  db-projector-dlq-no-replay-path, already queued).
INVARIANTS
  retry-liveness

ACCEPTANCE
  - bot suite green (count moves; do not pin).
  - One clean round.
```

---

## A6 · web · Không có security header; `google/complete` không rate-limit, body không giới hạn

**Đo:** `next.config.mjs:7-24` không `headers()`; không `middleware.ts`; `fly.toml:44-46` chỉ
`force_https`. CSP/XFO chỉ trên landing OAuth (`session-cookies.ts:175-183`). `complete/route.ts:40-74`:
`sameOriginRequest` ✓, `request.formData()` không trần, không `rateLimited(...)`, mỗi request một
UPDATE. Spec `:305-315,554-566` không gán bucket cho hop này; spec `:327` claim CSP/XFO đã có.

**Tier C:** 0 · **Rủi ro:** P2 · **Sau A3** (cùng cây `api/auth/google/`)

```text
TASK: web-security-headers-and-complete-ratelimit
RISK: P2
BASE: current origin/main   (A3 landed)

OUTCOME
  Every response from apps/web carries a baseline security header set; the OAuth completion
  hop is rate-limited and bounded like its siblings.

PART 1 — headers (next.config.mjs)
  - Add `headers()` returning, for source "/(.*)": Strict-Transport-Security
    "max-age=31536000; includeSubDomains"; X-Frame-Options "DENY"; X-Content-Type-Options
    "nosniff"; Referrer-Policy "strict-origin-when-cross-origin"; Permissions-Policy
    "camera=(), microphone=(), geolocation=()". HSTS is harmless on http (browsers ignore it),
    so no NODE_ENV branch — say so in a comment.
  - Content-Security-Policy: MEASURE the OAuth landing first (session-cookies.ts:175-183 sets
    its own CSP for the completion-hop page). A global CSP must not be stricter than that page
    needs, or the hop breaks. Start with `default-src 'self'; frame-ancestors 'none';
    base-uri 'self'; form-action 'self'` and prove the landing still submits (the existing
    completion-hop test). If the landing needs an exception, scope it to that route via a
    second `source` entry — do not weaken the global policy.
  - Test: a route-level test that fetches /healthz and asserts each header name is present
    (property: presence + one exact value for HSTS).

PART 2 — google/complete
  - Add `rateLimited(...)` with a trusted-IP bucket BEFORE reading the body. Limit: take the
    documented neighbour used by the other auth mutation hops (measure google/state and
    logout-all; cite the value); do not invent one.
  - Accept only `application/x-www-form-urlencoded`; read via the existing readBoundedBody
    helper (measure its name/signature in apps/web/lib) with a bound just above the handoff
    token length (measure: 43 chars per the audit — verify).
  - Tests: over-limit → 429 with the same envelope siblings use; oversized body → 413/400 per
    sibling precedent; wrong content-type → 415/400 per precedent.

SCOPE
  apps/web/next.config.mjs
  apps/web/app/healthz/route.test.ts   (or the nearest existing route test file; declare)
  apps/web/app/api/auth/google/complete/route.ts (+test)
NEGATIVE SCOPE
  No middleware.ts. No change to session-cookies.ts landing CSP unless the measurement in
  PART 1 proves it necessary — then ledger it. No change to logout/session routes (W-7/W-14 are
  separate P3 rows).
INVARIANTS
  auth, web-app

ACCEPTANCE
  - Completion-hop e2e/test still passes with the global CSP in place.
  - Security round; two clean rounds.
```

---

## A7 · infra · Dev Postgres superuser publish `0.0.0.0`; web dev chạy bằng superuser nên RLS vô hình

**Đo:** `docker-compose.yml:13-17` `plexco/plexco_dev`, `ports: "5432:5432"`; web `:40-41`,
discovery `:116` `DATABASE_URL` = superuser; `entrypoint.sh:3`, `.env.example:15` nói web = role
`app`; worker `env_file: ../.env` (`:99-101`) dù chỉ đọc 2 biến. `app_worker` đã có khuôn cấp
password một lần (`:76-88`).

**Tier C:** 0 · **Rủi ro:** P2 · **Sau A2** — chuyển web dev sang `app` sẽ làm `onboarding/start`
vỡ ở dev cho tới khi 0037 land (đó chính là D-2 hiện ra ở dev, và là *mục đích*).

```text
TASK: infra-dev-compose-loopback-and-app-role
RISK: P2
BASE: current origin/main   (A2 landed)

OUTCOME
  Dev compose binds Postgres and both web ports to loopback only; the web and discovery
  services connect as role `app` (RLS enforced in dev); the worker receives only the
  variables it reads.

FIX (infra/docker-compose.yml)
  - ports: "127.0.0.1:5432:5432", "127.0.0.1:3000:3000", "127.0.0.1:3001:3000".
  - Add an `app` dev password using the SAME one-time ALTER ROLE recipe already documented
    for app_worker (:76-88); document it in the same comment block and in .env.example next
    to the app_worker note. Point web/discovery DATABASE_URL at postgres://app:<dev
    pw>@postgres:5432/plexco. Keep DATABASE_URL_MIGRATION on the superuser (migrations need
    it) — entrypoint.sh:3 already separates the two; verify, do not assume.
  - worker: replace `env_file` with an explicit `environment:` list of exactly the variables
    apps/bot/src reads (grep process.env in apps/bot/src — record the list in the ledger).
  - Fix stale comments in the same file: :61 "0000→0033" → describe as "all migrations"
    (never pin the tail in prose — it rots); entrypoint.sh:25-27 references a service
    `queue-provision` that does not exist — remove or correct.

VERIFY
  - `docker compose config` renders; `pnpm smoke:predeploy` (measure what it checks) passes.
  - As the dev web role, `SELECT count(*) FROM sessions` without app.tenant_id returns 0
    (RLS live in dev) — record the psql transcript in the ledger.

SCOPE
  infra/docker-compose.yml
  infra/entrypoint.sh
  .env.example
NEGATIVE SCOPE
  No change to fly.toml, Dockerfile, or any migration. No change to CI's DATABASE_URL_TEST.
INVARIANTS
  (none from the catalog apply; declare [] — precedent: L4a)

ACCEPTANCE
  - One clean round.
```

---

## A8 · docs + backlog · Đóng 16 điểm drift và cấp chủ cho mọi gap §4

Một commit docs-only dưới root lock (không lane, không worktree — tiền lệ `a06a7eb`, `ae20e80`).
**Sau A3** để row Telegram ghi đúng trạng thái. Người làm: session housekeeping, `PLEXCO_COMMIT_OWNER`
đặt, `scripts/autopilot-backlog-reconcile` read-only trước và sau.

```text
TASK: docs-audit-2026-09-06-drift-and-ownership
RISK: P2 (docs-only, but backlog rows are authority for lanes)
BASE: current origin/main

PART 1 — fix the 16 drifts listed in docs/sessions/2026-09-06-repo-audit.md §3, one edit each:
  #1  ROADMAP.md:562 route count 13→15, remove "thiếu close · cancel"; :574 "5 route" stays.
  #2  autopilot-backlog.md row `session-commands-update-close-cancel`: status → merged,
      merged_probe → a slice-unique bare identifier from session-service.ts (measure with
      `git grep -c` on origin/main; candidates: an exported error class name that exists in
      exactly one file). Do NOT hand-flip without a probe unless none exists — then follow
      the L4a precedent and say why.
  #3  ROADMAP.md:584 remove the phantom `identity-account-link.ts`; cite 0034:83 + the test file.
  #4  ROADMAP.md:632 Module 10 BE → 🟡 (onboarding/start exists); add one line under DD-114 D6
      in decisions.md as an OPEN NOTE (not an amendment): launch may run on self-serve
      provisioning — owner to confirm (Tier C item, see A9-C list).
  #5  ROADMAP.md:577, PRD.md:280 "no producer" → producers exist (session-service.ts), schedule
      OFF because dlq is terminal.
  #6  feature_session_management_tech.md:6 header: commands + 5 routes exist; FE 0.
  #7/#8 covered by A3 (readiness, telegram) — add the backlog row for the platform CHECK
      narrowing: `db-channel-identities-platform-chk-drop-telegram` (P2, schema, needs a data
      measurement of existing `platform='telegram'` rows before DROP/ALTER).
  #9  ROADMAP.md:642 "0 caller" → 5 callers (list the six line numbers).
  #10 ROADMAP.md:585, user_settings_tech.md:449 readiness now runWithLang.
  #11 session_mgmt_tech.md:121 players_status_chk: match 0014:79-80 (no 'pending').
  #12 notifications_tech.md:5 header: DDL exists (0008, schema.ts:1589-1650).
  #13 verify `ls eslint.config.*` on main; if present, no doc change; if absent, open a row.
  #14 DD-113:2126-2128 bans the word "PWA" until manifest+SW exist: sweep BRD/PRD/ROADMAP
      occurrences to "web app" per the DD's own wording. List each line changed.
  #15 ROADMAP.md:557 test files 46→50.
  #16 web_auth_tech.md:327 (CSP/XFO) → mark "pending lane A6"; :326 CSRF-every-mutation →
      reconcile with SI-4 (:91-99): logout is Origin-gated only (W-7 row); :214,585 redaction
      middleware → "not built"; :41 path → /api/auth/google/state.

PART 2 — one backlog row per unowned gap in audit §4, minimum fields per _TEMPLATE, status
  `planned` unless noted, merged_probe null with NO close_by (reconcile will report `?`, which
  is the correct state for unbuilt work):
  - session-read-routes-list-detail            (P2; blocked on DD-56 amendment #3 — see A9)
  - session-roster-first-writer                (P2; blocked on owner Tier C: host-add vs bot-join)
  - session-mark-paid-manual                   (P2; DD-40; depends on roster writer)
  - onboarding-club-config-route               (P2)
  - user-settings-route-and-schema             (P2; blocked on Tier C language decision)
  - reminder-cron-and-confirm-paid             (P2)
  - zalo-webhook-adapter-core                  (P2; depends on L6 authoring)
  - identity-link-code-issue-consume           (P2; D-9 schema first)
  - web-pwa-manifest-and-service-worker        (P2; unblocks the word "PWA" per DD-113)
  - web-realtime-sse                           (P3)
  - projector-real-replace-stub                (P2; depends on db-projector-dlq-no-replay-path)
  - observability-sentry-loglevel-readers      (P3; NFR-O2)
  - backup-pitr-drill                          (P3; NFR-R5)
  - test-harness-job-definer-lock-client-leak  (P2; body already written 2026-09-03 — paste it)
  - one row each for audit P3 findings D-3, D-4, D-5, D-6(outbox half), D-7, D-8, D-9,
    D-11, D-12, D-13, D-14, D-15, W-4, W-6, W-7, W-8, W-9, W-10, W-11, W-13, W-14, B-2,
    B-3, B-4, X-4, X-5, X-7, C-1, C-2, C-3. Title = the audit's one-line; notes = the audit
    text verbatim + "source: docs/sessions/2026-09-06-repo-audit.md". Group by file so
    reconcile's WEAK/REFUSED logic is not tripped (no close_by on rows whose scope has source).

PART 3 — cross-links
  - HANDOFF.md live-truth block: one line pointing at the audit + this RUN doc.
  - ROADMAP.md §Next Actions: insert A1..A9 in the order of this doc's table.

ACCEPTANCE
  - `scripts/autopilot-backlog-reconcile` read-only: no new REFUSED, no new MALFORMED;
    every new row parses.
  - `pnpm review:check:changed` green.
  - Commit under root lock with PLEXCO_COMMIT_OWNER; push; report the SHA.
```

---

## A9 · authoring · `GET /api/sessions` + `GET /api/sessions/:id` — chỉ còn owner ký

**Vì sao không phải lane code ngay:** DD-56 amendment #1 điều khoản 1 — *"KHÔNG route nào khác được
copy pattern này mà không có decision riêng"* — và amendment #2 (`decisions.md:757-768`) là tiền lệ
đúng khuôn: liệt kê tường minh route, chứng minh bề mặt cưỡng chế không rộng thêm, gọi tên điểm khác.
Hai route đọc cần **amendment #3** cùng khuôn. Lane này **soạn** amendment + DTO + manifest để owner
ký một lượt; code chạy ở lane kế (`session-read-routes-list-detail`, row do A8 tạo).

**Tier C:** 1 (ký amendment) · **Rủi ro:** P2 (docs) · **Đây là điều kiện cần của launch khối 3/4.**

```text
TASK: dd56-amendment-3-session-read-routes-authoring
RISK: P2
BASE: current origin/main

OUTCOME
  A ready-to-ratify DD-56 amendment #3 text + the read DTO + the runtime manifest for
  `session-read-routes-list-detail`, so the owner signs once and the code lane registers the
  same day.

DRAFT — amendment #3, same skeleton as #2 (decisions.md:757-768), 8 clauses:
  1. SCOPE: exactly two routes, named: GET /api/sessions (list), GET /api/sessions/:id (detail).
     Total covered by the temporary gate: SEVEN.
  2. ENFORCEMENT SURFACE UNCHANGED: both routes import ONLY resolveSessionCommandContext (or the
     read-only variant the lane must add to session-command-route.ts if the command wrapper
     assumes a mutation — measure; if a variant is needed, it lives in the same allowlisted
     file, so the ESLint no-restricted-imports guard still covers it without a rule change).
  3. DIFFERENCE FROM THE FIVE: reads have no money/roster fence to fall back on — the role
     gate IS the only gate. State it. Therefore the consume-time window (amendment #1 clause
     4) is a DISCLOSURE risk (a just-revoked co_admin reads one more page), not a mutation
     risk. Name it as accepted, bounded by session TTL, and reversible by revoke-all.
  4. DTO WHITELIST (HR2 does not bind — authenticated tenant-scoped — but least-disclosure
     does): id, status, version, sport_key, starts_at, ends_at, timezone, price_amount,
     slots_max, visibility, area, venue_name, venue_address, join_policy, created_at,
     updated_at. EXCLUDED and why: confirmed_count / any roster or hold-derived number
     (0033:69 rationale, BL-DSC-1), charges, processed_commands, outbox. Roster appears
     only when a roster writer exists (Tier C item below), as a separate field added by its
     own amendment.
  5. LIST SEMANTICS: tenant from the caller's membership (same as the five); cursor pagination
     by (starts_at DESC, id), limit ≤ 50; filter `status` optional from the enum only; no
     free-text search (marketplace is out of phase-1).
  6. RATE LIMIT: the documented neighbour (create 10/min) — reads take 60/min per tenant;
     ledger it as Tier B with the reasoning that reads are cheaper and non-mutating.
  7. EXPIRY: void together with #1/#2 when tenant-capability-authority-core lands; the core
     slice inherits SEVEN routes.
  8. Doc-sync: ROADMAP:562 route count 15→17 when the code lane lands.

ALSO PRODUCE
  - docs/autopilot-manifests/session-read-routes-list-detail.json (authored contract, NO
    manifest_schema_version) with scope: the two new route files + tests,
    apps/web/lib/session-command-route.ts (only if a read-only context helper is needed),
    packages/db/src/session-service.ts is NOT in scope (reads use drizzle via withTenant
    directly — a `listSessions`/`getSession` query module under packages/db/src/ is; name it).
  - The DECISION request for the owner, one paragraph, three checkboxes: amendment #3 ✓/✗ ·
    DTO ✓/edit · rate limit ✓/edit.

SCOPE
  docs/standards/decisions.md (append amendment #3 DRAFT under DD-56, marked ⬜ until signed)
  docs/autopilot-manifests/session-read-routes-list-detail.json (new)
NEGATIVE SCOPE
  No code. No route files. No change to amendment #1/#2 text.
INVARIANTS
  api-contract, workflow-authority

ACCEPTANCE
  - `pnpm review:check:changed` green; reconcile read-only clean; one docs review round.
```

---

## Danh sách C — chỉ owner quyết được (Tier C), soạn sẵn để ký

Mỗi mục là **một câu hỏi, một khuyến nghị, một điều kiện resume nhị phân** (khuôn AWAIT).

| # | Câu hỏi | Khuyến nghị | Resume khi |
|---|---|---|---|
| C1 | **Roster writer đầu tiên** là gì: (a) host thêm tay trên web (`POST /api/sessions/:id/players`), hay (b) bot join DD-32 Option D? | **(a)** — nó là điều kiện của launch khối 3/4 (DD-113), không phụ thuộc Zalo adapter chưa có (nhóm 3 ngoài launch), và nó là writer đầu tiên của `players` mà mọi vế tiền (mark-paid, reminder) cần. (b) đến sau ở làn B. | Owner viết một dòng vào DD-114 D6: "làn A gồm host-add roster" |
| C2 | **Ngôn ngữ per-user** ở launch khối 5: giữ chữ DD-113 ("ngôn ngữ") hay giữ DD-118 (đã gỡ `persons.language`)? | **Giữ DD-118**, sửa chữ DD-113 khối 5 thành "settings tối thiểu: hồ sơ + liên kết kênh"; ngôn ngữ là của tenant. Rẻ nhất, không mở schema, không mâu thuẫn authority. | Owner sửa một dòng DD-113:2119 |
| C3 | Launch chạy trên **self-serve `onboarding/start`** (đã build) hay **tenant provision thủ công** (DD-114 D6 làn A)? | **Self-serve** — code có rồi, D-2 sửa ở A2; "thủ công" chỉ còn là chữ trong DD-114. Sửa D6 làn A/B cho khớp: nhóm 2 vào làn A. | Owner sửa DD-114 D1 hàng 2 + D6 |
| C4 | Ký **DD-56 amendment #3** (A9) | Ký theo bản A9 soạn | Owner ✓ ba ô |
| C5 | **A3 legal** — gửi luật sư | Gửi tuần này; lead-time là thứ duy nhất không lane nào rút ngắn được | Có ngày gửi |
| C6 | Bật `GOOGLE_OAUTH_*` (go-live auth) — **sau** A6 land | Sau A6 + A3 | Owner set secret |

---

## Bảng gộp — 9 lane + 6 chữ ký, và chỗ nên dừng

Sau A1–A8 land: **0 P2 mở** trong audit, mọi P3 có row, CI dùng được cho PR, dev chạy đúng role,
Telegram sạch khỏi code, docs khớp code. Sau C1 + C4: lane `session-read-routes-list-detail` +
`session-roster-first-writer` register được — đó là hai lane **đầu tiên làm launch khối 3/4 khả thi**,
và là chỗ FE PENDING mới thực sự trở thành thứ chặn cuối cùng.

**Không viết prompt cho:** mark-paid, reminder, Zalo adapter, settings — chúng phụ thuộc C1/C2 và
roster writer; viết trước là viết cho một nền chưa có.
