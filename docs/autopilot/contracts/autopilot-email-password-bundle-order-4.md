<!-- review-readiness: enforce -->

# email-password-bundle-order-4 — task contract

> **Slice (intended):** `email-password-bundle-order-4` — wire the already-merged email/password
> schema (`0016`: `email_password_credentials`, `auth_pending_email_registrations`,
> `auth_email_tokens`, `account_emails`, `auth_email_deliveries`) into working web auth routes
> **register / verify-email / login / password-reset**, with rate-limit, audit and real-PG tests,
> behind a feature flag that stays OFF. This is "order-4" of the DD-80 auth bundle.
> **Risk:** P1 (auth / identity / secret / external-input) · **Change class:** code (migration + DB
> functions + routes + bot-worker delivery) · **Autonomy:** supervised.
> **Opened from:** P-A / L2 (DD-80 §10 order 4).
> **Authored:** 2026-08-14 against `origin/main` @ `519fb9f91fffe4712668f24a1af697d5f1a002bd`
> (= HEAD, verified `git rev-parse HEAD`).
> **Manifest:** `docs/autopilot-manifests/email-password-bundle-order-4.json`.
> **Lane ledger:** `.autopilot/state/email-password-bundle-order-4/DECISIONS.md`.
> **Verdict:** **`NOT_CODE_READY`** — three Tier-C blockers, all DEPENDENCY + SCOPE, none is unpinned
> policy. DD-80 + the B0 probe pin every runtime-affecting value (§3). The failure is that the slice
> as scoped reads/calls DB functions and a delivery pipeline that do **not** exist on base and that the
> packet's own negative scope forbids creating. See §7. This authoring pass wrote only this contract +
> the manifest + the ledger; it did **not** register, open a worktree, run codex, or edit the backlog.

## 0. Task contract (level3-workflow §3)

```text
TASK_ID: plexco:email-password-bundle-order-4
OUTCOME (target): the DD-80 order-4 email/password provider bundle — register / verify-email / login /
  forgot / password-reset routes calling public SECURITY DEFINER DB functions, enumeration-safe forgot
  via the pg-boss delivery pipeline, dual-bucket rate limits, audit, real-PG tests — behind a feature
  flag that stays OFF (no enablement).
REPOSITORY_AND_BASE: plexco-app @ origin/main = 519fb9f91fffe4712668f24a1af697d5f1a002bd
  (verified 2026-08-14, = HEAD). Migration tail on base = 0032.
CONTEXT_SOURCES: docs/standards/decisions.md DD-80 (body §1024-1029 + summary row 96; §10 slice order,
  G3 revoke-all epoch contract), DD-13, DD-50; docs/probes/b0-auth-credential-lifecycle-design-probe.md
  (§3.1 storage, §5.2 consume/lock hierarchy, §5.3 TTL/retention, §5.4 pg-boss delivery, §6 revoke-all,
  §7 lifecycle+regression matrix, §8.1 password/PHC, §8.2 rate limits, §8.3 audit, §10 slice order);
  docs/features/BE/feature_web_auth_onboarding_tech.md v2.15 (Reviewed — §3 endpoints/rate-limits,
  §4 session security + acceptance matrix D1E-1..D1E-23); docs/features/FE/feature_web_auth_onboarding.md
  v2.13 (Reviewed); docs/features/BE/auth-security-invariant-table.md v1.4; docs/auth/auth-s4-session-
  handoff.md (D0a/D0b/D1/d1b merged, order-4 OFF); packages/db/migrations/0015_auth_revoke_account.sql,
  0016_account_email_token_core.sql; packages/db/schema.ts (247-403); packages/db/src/auth.ts;
  apps/web/lib/session-cookies.ts.
APPLICABLE_SKILLS: none resident (better-auth skill exists but the design is bespoke SQL-definer).
SCOPE (intended, NOT authorized): a NEW SQL migration creating the order-4 public SECURITY DEFINER
  functions (auth_register/request_email + auth_verify_email + auth_finalize_email_login +
  auth_forgot_password + auth_reset_password) with grants; schema.ts comment mirror; packages/db/src/
  auth.ts thin app-boundary wrappers + index.ts exports + auth.test.ts (real PG); the five
  apps/web/app/api/auth/email/* route handlers + apps/web/lib/email-auth.ts; apps/bot/src/queues.ts
  auth-email-* queues + dispatch/cleanup schedules; this contract + manifest + backlog block.
NEGATIVE_SCOPE: NO enablement (flag OFF, no env flip — Tier C item 5); NO removal of the 2 telegram-era
  auth routes (order-5); NO OAuth/Google changes (order-3, merged); NO change to the session
  revoke/rotate/epoch model (D0a/D0b, merged — reuse only); NO change to session-service.ts or the
  sports-domain sessions vertical.
RISK: P1 — password + verify/reset tokens + email delivery are auth/secret/external-input. Mandatory
  security review round (§8) in addition to 2 clean code rounds. 5 HARD RULES: HR4 (claim-with-money
  needs strong factor — verified email is exactly this) applies; no PII to public.
AUTONOMY_MODE: supervised
MODEL_POLICY: planner=primary-agent; worker=assigned-agent; reviewer=scripts/codex-review-pin.sh
  (2 clean code rounds + 1 mandatory security round).
SANDBOX_AND_PERMISSIONS: network none (flag OFF, no real provider send); secrets none authored;
  external side effects none.
HUMAN_DECISIONS_REQUIRED: THREE Tier-C blockers (§7 REMAINING_BLOCKERS) — all require owner ruling
  before any build: the new-migration-in-negative-scope contradiction, the pg-boss pipeline scope
  expansion, and the missing order-4 route acceptance contract + deferred D1E-18b barrier.
SLICE_GRAPH: DD-80 §10 order-4 is a MULTI-SLICE release unit (register/verify -> login-finalizer ->
  forgot/reset+link-artifact -> pg-boss delivery), one feature flag, none enable-able alone. It is NOT
  a single ~300 LOC service+route slice. Depends on merged order-2 STORAGE (0016) + D0a epoch (0015),
  and on the UNBUILT account-issued link_code concept for the reset barrier (D1E-18b).
WORKTREE_PLAN: NONE — verdict is NOT_CODE_READY. No worktree, no registration, no code.
VERIFICATION (when a re-sliced lane is built): pnpm test with DATABASE_URL_TEST (real PG), the full
  b0 §7.1 lock-race + PHC + command-mismatch + cleanup/audit/revoke matrix, check:quick, plus the
  ingress drill (§8.2) before any flag flip.
CODE_REVIEW: required — 2 clean rounds via scripts/codex-review-pin.sh.
SECURITY_REVIEW: required (mandatory) — trust boundary: password, tokens, external email, session mint.
BUDGETS: order-4 as a whole far exceeds ~300 LOC / <=3 modules; a re-slice splits it per b0 §10 with
  each sub-slice inside budget. fix_rounds_max 5.
STOP_CONDITIONS: this is a NOT_CODE_READY packet — no build authorized · any build touching a new SQL
  migration or apps/bot without owner re-scope authorization · reviewer unavailable -> HALT
  TOOL_UNAVAILABLE · enablement -> AWAIT owner.
DELIVERABLES: this contract + manifest + lane ledger + a proposed backlog block for the conductor.
```

## 1. Why NOT_CODE_READY, in one paragraph

The packet asks to "wire the already-merged 0016 schema into working routes" within ~300 LOC, service +
routes + lib, with **no new migration** and scope confined to `apps/web/**` + `packages/db/src/auth.ts`.
But the merged authority makes clear order-4 is not a wiring job on top of complete DB primitives: `0016`
merged the **storage and internal helpers only**, and its own header binds the public functions the
routes must call to order-4 (see §3). Those functions **must be SQL SECURITY DEFINER** (the whole
security model — `app` has zero table grant, direct DML on `password_phc` is revoked, a PHC validator
trigger owns every write path), so they cannot be implemented in TypeScript, and they require a **new SQL
migration** — which the packet's negative scope forbids. The forgot/reset path additionally needs the
**pg-boss delivery pipeline** (a bot-worker slice outside the declared scope), and the reset path's
account-issued-`link_code` revocation depends on a concept the base does not yet have (D1E-18b, explicitly
DEFERRED). None of this is an *unpinned-policy* problem: DD-80 + the B0 probe pin every TTL, rate-limit,
audit field and error code. It is a **scope-design + dependency** problem, and correcting it is an owner
re-slice decision (Tier C), not something this authoring pass may resolve.

## 2. What is proven MERGED on base (measured 2026-08-14 at 519fb9f)

- **Order-2 storage** — all five tables + constraints in `schema.ts`: `accountEmails` (:249),
  `emailPasswordCredentials` (:277), `authPendingEmailRegistrations` (:283), `authEmailTokens` (:314),
  `authEmailDeliveries` (:362); and in `0016_account_email_token_core.sql`.
- **Order-2 internal helpers/triggers** in `0016`: `_auth_assert_password_phc` (:316, PHC validator,
  `REVOKE ALL FROM PUBLIC`), the PHC constraint triggers on both write paths (:411-417), the
  verified-email gate trigger (:440-442), `_auth_consume_email_token` (:488, the parent-first consume
  helper), and the retention/cleanup functions (:607-801). All function-only, **zero grant to `app`**.
- **D0a epoch core** (`0015_auth_revoke_account.sql`): `auth_audit_events` (the order-4 audit reuse
  target), `session_epoch`/`minted_epoch` revoke-all, rotate parent-first.
- **App-boundary pure helpers** in `packages/db/src/auth.ts`: `normalizeEmail` (:336),
  `deriveEmailArtifacts` (:484), `decryptEmailEnc` (:511), `deriveProviderIdempotencyKey` (:558) —
  exported via `index.ts` (:55-61). These are *pure* (injected keys, no DB coupling).
- **Session substrate**: `web_sessions` (schema.ts:122), `createWebSession`/`resolveWebSession`/
  `rotateWebSession`/`revokeAllWebSessions` (auth.ts:85/96/123/158); `apps/web/lib/session-cookies.ts`
  `issueSession`/`rateLimited` (:277, wraps DB `rate_limit_check`).
- **Existing auth routes** (8): `google/{state,callback,complete}`, `logout`, `logout-all`, `session`,
  `telegram/{state,callback}`. No `email/*` route exists — a new email route ADDS, does not collide.

## 3. Runtime-affecting policy IS pinned (this is NOT the blocker)

Recorded to show the verdict does **not** rest on unpinned policy. Every value below is owner-ratified
(DD-80 v1.77, 2026-07-19) in the B0 probe, which both Reviewed specs cite as canonical authority:

| Policy | Value | Authority |
|---|---|---|
| Verify-email token TTL | **30 minutes** | b0 §5.3 (:355) |
| Password-reset token TTL | **15 minutes** | b0 §5.3 (:356) |
| Pending registration attempt TTL | **24 hours** | b0 §5.3 (:354) |
| Token/metadata retention | 30 days; audit 180 days | b0 §5.3 (:358-359) |
| Password policy | 15-128 Unicode NFC; Argon2id floor **m=19456, t=2, p=1**; PHC validator owner-only | b0 §8.1 (:464-466); enforced by `_auth_assert_password_phc` |
| Rate limits | register/forgot **5/15min ×2** (email-HMAC + IP); login **10/min IP + 5/15min email**; verify/reset **5/15min**; state/callback **10/min** | b0 §8.2 (:497-501) |
| Audit events (exact taxonomy) | register_requested, verify_resent, email_verified, login_success\|failed, reset_requested, password_reset, logout_all, identity_conflict, idempotency_key_reused, delivery_dead_letter\|replayed\|failed_terminal | b0 §8.3 (:508) |
| Error behavior | generic `AUTH_INVALID` / `AUTH_TOKEN_INVALID`; enumeration-safe forgot; fail-closed on any bucket/storage error | b0 §7 (:426-429), §8.2 (:501) |
| Verification flow | register -> pending attempt (verify-first, multi-attempt) -> hash-only token -> non-mutating GET landing -> same-origin POST consume -> credential + email identity | b0 §3.2 (:193-199), §5.2 |

> A sub-agent's first read reported TTLs "ABSENT". That was a miss: it looked only at rate-limit windows
> and retention, not B0 **§5.3**, which pins them exactly. Verified by direct read (§5.3 lines 350-359)
> against a known-present control. Policy is more pinned than that read concluded — reinforcing that the
> blockers are dependency + scope, not policy.

## 4-6. Acceptance matrix — cannot be authored at CODE_READY depth

The Reviewed BE spec's acceptance matrix (§4, rows **D1E-1..D1E-23**) covers **only order-2 storage**
(table shapes, `_auth_consume_email_token`, PHC validator, grant matrix, cleanup, schema.ts mirror). It
has **no acceptance rows for the order-4 route handlers** (`register`/`verify`/`login`/`forgot`/`reset`),
their rate-limit wiring, or the public `auth_verify_email`/`auth_reset_password`/`auth_finalize_email_login`
functions — those appear only in the §3 endpoint table with status ⬜ (unbuilt). Critically,
**D1E-18b is explicitly ⏸ DEFERRED** (spec line 484) with a binding trigger: the reset path's
account-issued-`link_code` barrier "cannot be proven at this slice" because `link_codes` on base is
person/channel-scoped with no account-issued concept, and the spec states this barrier must pass "before
that slice is considered CODE_READY". Authoring a full CODE_READY acceptance matrix here would mean
inventing contract the owner has not written (review-code-readiness-gate.md §11.2 forbids a verdict on a
slice whose contract does not yet exist). The matrix therefore stays at evidence-inventory depth until a
re-sliced order-4 lane is authored against a spec that pins the route acceptance rows.

## 7. Closure matrix + canonical verdict

### 7.1 Closure matrix — NOT 12/12

| # | Gate | Evidence | PASS/FAIL |
|---|---|---|---|
| 1 | Authority snapshot pinned by SHA | `git rev-parse HEAD` = `519fb9f…`; TARGET_FILES exist on base, no glob | PASS |
| 2 | In-scope decisions closed | Policy pinned (DD-80/B0, §3); BUT the migration-vs-negative-scope, pipeline-scope and route-contract questions are **open Tier-C** | FAIL |
| 3 | Scope IN/OUT + owner clear | Declared scope (~300 LOC, apps/web + packages/db/src, no migration) CONTRADICTS what order-4 requires (new SQL migration + apps/bot); order-4 is a multi-slice unit, not one slice | FAIL |
| 4 | Dependency classified | Order-2 storage MERGED (§2); BUT the order-4 public SECURITY DEFINER functions are ABSENT on base and unbuilt (no owner/slice); pg-boss pipeline ABSENT | FAIL |
| 5 | Live schema/code matches doc | Verified at 519fb9f: schema.ts 247-403, 0016 header 25-37, auth.ts 46-558, 0015 audit table | PASS |
| 6 | Data/API/state/auth contract complete | Storage + policy pinned; BUT the route request/response + the public-function signatures are NOT pinned in a Reviewed acceptance contract (D1E rows are order-2 only) | PARTIAL |
| 7 | Fail-closed / idempotency / order pinned | Design pinned in B0 §5.2/§7; but its correct realization needs the unbuilt public functions + delivery guard | PARTIAL |
| 8 | In-scope open questions = 0 | 3 Tier-C blockers open (below) | FAIL |
| 9 | Acceptance matrix has expected results | Order-2 D1E rows have them; order-4 route rows do NOT exist; D1E-18b DEFERRED | FAIL |
| 10 | Migration / security / rollback pinned | Order-4 REQUIRES a new SQL migration (forbidden by packet negative scope); mandatory security review not yet run | FAIL |
| 11 | First slice hard deps merged | Order-2 storage + D0a merged; but order-4 public functions + delivery pipeline + account-issued link_code (D1E-18b) are NOT merged | FAIL |
| 12 | Implementation handoff ready | No executable single-slice handoff — order-4 is a multi-slice release unit needing an owner re-slice | FAIL |

### 7.2 Verdict — canonical block

```text
REVIEW_POLICY_VERSION: 1.3
REVIEW_VERDICT: NOT_CODE_READY
REVIEWED_AT: 2026-08-14
AUTHORITY_SHA: 519fb9f91fffe4712668f24a1af697d5f1a002bd
BASE_BRANCH: main
TARGET_FILES:
  - docs/standards/decisions.md
  - docs/probes/b0-auth-credential-lifecycle-design-probe.md
  - docs/features/BE/feature_web_auth_onboarding_tech.md
  - docs/features/FE/feature_web_auth_onboarding.md
  - packages/db/migrations/0015_auth_revoke_account.sql
  - packages/db/migrations/0016_account_email_token_core.sql
  - packages/db/schema.ts
  - packages/db/src/auth.ts
SLICE: email-password-bundle-order-4
IN_SCOPE: the DD-80 order-4 email/password provider bundle — register / verify-email / login / forgot /
  password-reset routes calling public SECURITY DEFINER DB functions, enumeration-safe forgot via the
  pg-boss delivery pipeline, dual-bucket rate limits, audit and real-PG tests, feature flag OFF.
OUT_OF_SCOPE: enablement / env flip; telegram-era route removal (order-5); OAuth/Google (order-3, merged);
  the session revoke/rotate/epoch model (D0a/D0b, merged); session-service.ts and the sports-domain
  sessions vertical.
G1_DECISION: FAIL
G2_SPEC: PARTIAL
G3_DEPENDENCY: FAIL
G4_TEST: FAIL
G5_SCOPE: FAIL
G6_EXTERNAL: FAIL
HARD_DEPENDENCIES: order-2 storage 0016 (MERGED) + D0a epoch 0015 (MERGED) are present; BUT the order-4
  public SECURITY DEFINER functions (auth_verify_email / auth_reset_password / auth_finalize_email_login
  + register/forgot owner functions), the pg-boss email delivery pipeline (apps/bot/src/queues.ts), and
  the account-issued link_code concept (D1E-18b reset barrier) are all UNBUILT / ABSENT on base.
PRIOR_SLICES: DD-80 §10 order-1 D0a (0015, merged), order-2 account-email-token-core storage (0016,
  merged), order-3 Google-OIDC-adapter (0017, merged), d1b (0018, merged).
OPEN_QUESTIONS_IN_SCOPE: 3
ENABLEMENT_ONLY_GATES: email-provider flag OFF + external gate C7 (b0 §5.4) — enablement-only, correctly
  out of scope; does NOT gate a re-sliced code build of the dark path.
LIVE_REPO_VERIFICATION: PASS
CONTRACT_MATRIX: PARTIAL
CLOSURE_MATRIX: FAIL
ACCEPTANCE_MATRIX: FAIL
SECURITY_AND_MIGRATION_GATE: FAIL
IMPLEMENTATION_ARTIFACTS: FAIL
FIRST_IMPLEMENTATION_STEP: none — NOT_CODE_READY, no build authorized. The first action is an OWNER
  re-slice decision on the three Tier-C blockers below (authorize an order-4 DB-function slice with a
  new SQL migration + an apps/bot delivery slice, per b0 §10), not opening a worktree.
REMAINING_BLOCKERS:
  - blocker: order-4 requires a NEW SQL migration creating the public SECURITY DEFINER functions the
      routes call (auth_verify_email / auth_reset_password / auth_finalize_email_login + register/forgot
      owner functions) — the security model (b0 §9a/§8.1: app has zero table grant, direct password_phc
      DML revoked, PHC validator trigger owns every write path) forbids implementing them in TypeScript.
      The packet's negative scope says "NO new migration". This is a direct scope-design contradiction.
    owner: owner (product/architecture) — a re-slice decision
    resolution: owner authorizes an order-4 DB-function slice WITH a new SQL migration in scope (Tier C
      items 4 + 7). Binary: the re-sliced manifest's scope includes packages/db/migrations/NNNN_*.sql
      and the owner ratifies it, OR order-4 stays deferred.
    tier: C
  - blocker: the forgot/reset path cannot deliver a reset link without the pg-boss delivery pipeline
      (apps/bot/src/queues.ts auth-email-dispatch/-delivery/-delivery-dlq/-cleanup + schedules, b0 §5.4),
      which does NOT exist on base and is OUTSIDE the declared apps/web + packages/db/src scope (it is an
      app_worker slice). order-4 is a multi-slice release unit (b0 §10), not one ~300 LOC slice.
    owner: owner — re-slice / scope decision
    resolution: owner authorizes splitting order-4 per b0 §10 (register/verify -> login-finalizer ->
      forgot/reset+link-artifact -> pg-boss delivery), with apps/bot in the delivery sub-slice's scope.
      Binary: a split plan with per-sub-slice budgets is ratified, OR order-4 stays deferred.
    tier: C
  - blocker: no Reviewed acceptance contract exists for the order-4 ROUTES (D1E-1..D1E-23 are all
      order-2 storage; the routes are ⬜ in §3), and D1E-18b (reset ↔ account-issued link_code barrier)
      is explicitly DEFERRED with a CODE_READY-gating trigger whose prerequisite (account-issued
      link_codes; link_codes is person/channel-scoped on base) is unbuilt.
    owner: owner + spec author (feature_web_auth_onboarding_tech.md)
    resolution: the BE spec adds a Reviewed acceptance matrix for the order-4 route/function behavior AND
      the account-issued link_code concept lands (or the reset sub-slice is scoped to explicitly defer
      the link-artifact revocation with a pinned negative contract). Binary: those acceptance rows exist
      as Reviewed content and D1E-18b's prerequisite is resolved or negatively scoped.
    tier: C
NEXT_REVIEW_TRIGGER: owner ruling on the three Tier-C blockers (re-slice order-4 into b0 §10 sub-slices
  with a new-migration DB-function slice + an apps/bot delivery slice) AND the BE spec landing a Reviewed
  order-4 route acceptance matrix — then re-author a per-sub-slice packet. Not "updated docs".
```
