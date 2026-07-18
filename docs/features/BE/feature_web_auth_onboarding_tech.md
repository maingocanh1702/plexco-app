# Feature: Web Authentication & Tenant Onboarding — Backend Tech Spec

> **Canonical phase:** P4
> **Version:** 2.6 · 2026-07-18
> **Status:** Reviewed
> **Product spec:** `../feature_web_auth_onboarding.md`
> **References:** `../../standards/business-rules.md` BL-SEC-1/BL-SEC-3/BL-MSG · `../../standards/decisions.md` DD-13 · DD-31 · **DD-33** · DD-50 · DD-60 · **DD-65..67** · `../../standards/api-reference-convention.md` · `auth-security-invariant-table.md`

---

## 1. Tổng quan triển khai

> **Cập nhật v2.2 (DD-37 + DD-13 ✅, 2026-07-10):** Bỏ **Telegram Login** adapter (Telegram out-of-scope — DD-37). Auth phase-1 = **Google OAuth + email/password** (DD-13 ✅). Việc này **đảo** OQ-1 của DD-31 (2026-07-06 "giữ TG Login only"): OQ-1 nay hết hiệu lực. `account_identities.platform ∈ {google, email, facebook, zalo}`; SI-2 keyed-hash áp cho `google.sub`/email thay `telegram:id` (§4). SI-1/SI-3 giữ nguyên hiệu lực.

```text
Auth Adapter (Google OAuth / email-password / Facebook gated) → Account/Session Service → Onboarding Workflow
    → Tenant Service → Integration Services (Bank/Zalo/Messenger)
```

Tables: auth/onboarding + tenant bank/Zalo. Messenger central/tenant registry and Page identity/reachability are global-protected via narrow services (DD-65..67); live tenant-only `messenger_pages` needs a new migration. Tenant Page is optional onboarding state, central readiness is a platform-level gate.

**Design decisions:**
- **(DD-13/DD-33 ✅)** Auth phase-1 = `google` + `email`, và `facebook` khi external enablement gate đã pass. **KHÔNG** tạo root table `users` — `persons` vẫn là anchor; password ở bảng credential riêng qua migration mới. Facebook adapter chỉ exchange code server-side, verify stable app-scoped subject của đúng configured Meta App, không log/persist raw code/access token và không auto-link Messenger PSID. `zalo` (DD-14 ⬜) chỉ cắm khi gate riêng được chốt.
- **(DD-50 ✅)** Google OIDC only mints a session after signature, exact issuer/audience, browser state/nonce/PKCE, `exp`/`iat`, and `email_verified === true` all pass. Email auth is one atomic feature set: verified-email gate + hash-only TTL/single-use verify/reset tokens + enumeration-safe forgot/reset + revoke-all sessions on password reset. Partial implementation remains disabled.
- Session token stored as hash — rotate on login, ownership assignment, tenant switch.
- Onboarding commands use `UNIQUE(run_id, step, idempotency_key)` — refresh/back safe.
- Integration verification async with status polling/outbox event — retries idempotent.
- **(DD-31 SI-1, added 2026-07-06)** Login is gated by a pre-auth, single-use, short-TTL, browser-bound login-state token (httpOnly cookie + `auth_login_state` row) — additive to, not a replacement for, the same-origin check. Áp cho OAuth callback (Google) và form email/password. See §4 "Login-State CSRF Binding".
- **(DD-31 SI-2, DD-33)** `account_identities.platform_user_hash` is a domain/provider-separated keyed HMAC over the provider subject (`google.sub`, normalized email, or Facebook app-scoped subject), never a bare hash — key sourced from AWS KMS in staging/prod, `ENCRYPTION_KEY` fallback in dev. See §4 "Web-Auth Identity Hash Keying".
- **(DD-31 SI-3, added 2026-07-06)** Every tenant-scoped read on this surface combines `withTenant` (RLS) **and** an explicit `tenant_id` predicate in the query — belt-and-suspenders, not RLS alone. See §4 "Explicit Tenant-Filter Policy".

> **Provider roadmap:** `google` + `email` là baseline; DD-33 đã chốt `facebook`, nhưng capability cho non-test users fail-closed OFF tới khi exact App Review/Business Verification/permission evidence được ghi nhận. Nếu chưa pass, dùng transactional one-time `link_code`. Facebook Login subject và Messenger Page-scoped PSID là hai identity layers độc lập. DD-14 `zalo` vẫn open.

---

## 2. Database Schema + Edge Cases (BE)

### Schema

```sql
CREATE TABLE accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id uuid REFERENCES persons(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE web_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id),
  token_hash text NOT NULL UNIQUE,
  csrf_secret text NOT NULL,
  expires_at timestamptz NOT NULL,
  rotated_from uuid REFERENCES web_sessions(id),
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE account_identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id),
  platform text NOT NULL,
  platform_user_hash text NOT NULL,
  verified_at timestamptz NOT NULL,
  UNIQUE (platform, platform_user_hash)
);

CREATE TABLE onboarding_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  status text NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'completed', 'abandoned')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE onboarding_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES onboarding_runs(id),
  step text NOT NULL,
  status text NOT NULL DEFAULT 'not_configured' CHECK (status IN ('not_configured', 'pending', 'verified', 'error', 'skipped')),
  idempotency_key text,
  error_code text,
  completed_at timestamptz,
  UNIQUE (run_id, step, idempotency_key)
);
```

> **Live-schema truth (2026-07-18):** `account_identities.platform` hiện là unrestricted `text`; migrations `0000`–`0013` không có `account_identities_platform_chk`. Build DD-33 phải audit/backfill legacy Telegram-era values rồi thêm validation gồm `facebook` trong **một migration self-contained dùng next available number**. Không được `DROP` một constraint giả định chưa tồn tại.

### Tenant readiness matrix (WAO-OQ-2 closed)

`GET /api/onboarding/readiness` and the only transition to `onboarding_runs.status='completed'` use one shared predicate:

- authenticated/verified account owns the run;
- tenant space is ready: club-config step `verified`, **or** DD-46 personal tenant was atomically provisioned (target `kind='personal'`, conditional owner relation);
- bank step is `verified` (not merely `registered`/`pending`);
- at least one first session exists for this tenant and its step is `verified`.

Zalo bot and tenant Messenger Page are optional: `not_configured|skipped|error|verified` never changes the predicate. Central Messenger availability is a deployment/platform release gate and cannot be copied into a per-tenant step. Handlers and UI call this shared predicate; they do not re-derive required steps.

### New table (DD-31 SI-1, added 2026-07-06)

Login-state CSRF binding needs its own server-side row per issued state — distinct from `auth_login_nonces` (which is a *replay* guard on the already-signed OAuth id_token / login payload, not a pre-auth browser-binding mechanism):

```sql
CREATE TABLE auth_login_state (
  state_hash  text PRIMARY KEY,   -- sha256(raw state token); raw token lives only in the pre-auth cookie, never in DB
  expires_at  timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
```

Single-use: a second consume attempt on the same `state_hash` must fail. Short TTL (10 minutes, matching `auth_login_nonces`'s freshness window).

### DD-50 email-auth storage design gate (required before DDL)

The lifecycle below is normative; physical tables/indexes remain **provisional** until B0 maps every register/verify/login/forgot/reset/revoke path and proves one transactional consume boundary. The probe must produce a decision table and exact uniqueness/expiry/cleanup constraints. It must not assume that the current single-token `revokeWebSession` helper already provides account-wide revocation.

- Credential record: one active password hash per email identity; unverified identity cannot login.
- Verify/reset artifact: purpose-bound, random high-entropy raw token returned only to the delivery boundary; database stores only its hash, `expires_at`, `consumed_at`, and audit metadata.
- Consume: one conditional update/transaction proves correct purpose + unexpired + unconsumed, then mutates verification/password exactly once.
- Password reset: credential update and revoke-all affected `web_sessions` commit atomically. If account-wide revocation cannot be proven, reset fails closed.

**Note on `account_identities.platform_user_hash` (DD-31 SI-2, updated 2026-07-10):** the column type is unchanged (`text`), but its VALUE is a keyed HMAC over the provider subject — the Google `sub` (provider `google`) or the normalized email (provider `email`) — never a bare `sha256(...)`. It must use a secret sourced per §4 "Secret / KMS Source". Write path (login/register) and read path (lookup) must resolve the identical key, or existing users are silently locked out. *(The old `sha256("telegram:" + id)` value is dropped with Telegram Login — DD-37; keyed HMAC retained for consistency.)*

### Edge Cases (Backend)

| # | Category | Case | Xử lý |
|---|----------|------|-------|
| 1 | Security | Google signature, exact issuer/audience, state/nonce/PKCE, `exp`/`iat`, or `email_verified` invalid | Reject — no account/session mutation |
| 2 | Security | Stale/replayed auth (expired token, reused state/nonce) | Reject — single-use consume + timestamp freshness check |
| 3 | Security | Session fixation | Rotate session on every privilege change |
| 4 | Concurrency | Concurrent tenant creation | Idempotency key — UNIQUE constraint |
| 5 | Concurrency | Wizard refresh/back | Idempotency key per step — safe |
| 6 | Security | Secret value returned after creation | ❌ NEVER — write-only, KMS |
| 7 | Data Integrity | Bank account bound to another tenant | Conflict error — `BANK_ALREADY_BOUND` |
| 8 | Data Integrity | Chat already bound to another tenant | Conflict error — `CHAT_ALREADY_BOUND` |
| 9 | Security | CSRF missing/invalid | Reject mutation — 403 |
| 10 | Resilience | Integration verify async failure | Store redacted error code — retry available |
| 11 | Security | Credential in URL/log | ❌ NEVER — KMS + redaction middleware |
| 12 | Data Integrity | Resume incomplete onboarding | Each step independent — status persisted |
| 13 | Security | Login-state cookie missing/mismatched/expired/already-consumed at callback | Reject — `AUTH_INVALID`, no session minted (DD-31 SI-1) |
| 14 | Security | `account_identities.platform_user_hash` (over `google.sub`/email) written/looked-up without the KMS-sourced key | ❌ NEVER — keyed HMAC only; write and lookup must resolve the identical key (DD-31 SI-2) |
| 15 | Data Integrity | Tenant-scoped read on this surface relies on RLS alone (no explicit predicate) | ❌ NEVER — explicit `tenant_id` predicate required as defense-in-depth on top of RLS (DD-31 SI-3) |
| 16 | Security | Verify/reset token expired, wrong-purpose, or consumed | Generic reject; no partial credential/session mutation |
| 17 | Privacy | Forgot-password for unknown email | Same public response/status class as known email; bounded equivalent work, no account-existence signal |
| 18 | Security | Password reset succeeds but an old session remains active | ❌ NEVER — credential update + account-wide session revoke are one transaction |
| 19 | Deployment | Register/login exists but verify/reset/revoke-all is missing | Email provider feature flag stays OFF; Google path remains independent |

---

## 3. API Contract

### Endpoints

| Method | Path | Auth | Mô tả |
|--------|------|------|-------|
| GET | /api/auth/google/state | ⬜ Public | Issue pre-auth login-state token + cookie (DD-31 SI-1) — call before redirecting to Google OAuth |
| GET | /api/auth/google/callback | ⬜ Public | Google OAuth verify (id_token/nonce) **+ login-state consume (DD-31 SI-1, additive — see §4)** |
| GET | /api/auth/facebook/state | ⬜ Public | Issue browser-bound, single-use login-state; return provider redirect only when external gate/config active |
| GET | /api/auth/facebook/callback | ⬜ Public | Consume login-state; server-side code exchange; verify configured-App app-scoped subject; issue/rotate session |
| POST | /api/auth/email/register | ⬜ Public | Email + password self-register (email verification) |
| POST | /api/auth/email/verify | ⬜ Public | Atomically consume verify token; mark email identity verified |
| POST | /api/auth/email/login | ⬜ Public | Email + password login **+ login-state consume (DD-31 SI-1)** |
| POST | /api/auth/email/forgot | ⬜ Public | Enumeration-safe reset request; issue hash-only TTL/single-use reset token when eligible |
| POST | /api/auth/email/reset | ⬜ Public | Atomically consume reset token, update password hash, revoke every affected web session |
| POST | /api/auth/logout | ✅ Account/Person | Revoke current session |
| POST | /api/auth/logout-all | ✅ Account/Person | Revoke all web sessions for current account |
| GET | /api/auth/session | ✅ Account/Person | Current session info; exact account-self |
| POST | /api/onboarding/start | ✅ Account/Person | Create tenant + run; becomes owner only through successful provision |
| PATCH | /api/onboarding/club | 🔑 Exact capability | Club config |
| POST | /api/onboarding/bank/connect | 🔑 Exact capability | Connect bank provider |
| POST | /api/onboarding/bank/verify | 🔑 Exact capability | Verify bank webhook |
| POST | /api/onboarding/zalo/connect | 🔑 Exact capability | Connect Zalo (dán Bot Token) |
| POST | /api/onboarding/messenger/connect | 🔑 Exact capability | Optional connect tenant Facebook Page; central fallback remains |
| GET | /api/onboarding/messenger/status | 🔑 Exact capability | Return central availability + optional tenant Page status |
| GET | /api/onboarding/readiness | 🔑 Exact capability | Readiness checklist |

### Error Codes

| Code | Error Code | Message | Trigger |
|------|-----------|---------|---------|
| 401 | `AUTH_INVALID` | Xác thực không hợp lệ | Invalid Google id_token/nonce or email credential |
| 401 | `AUTH_STALE` | Phiên xác thực đã hết hạn | Stale/expired id_token or reused nonce |
| 409 | `BANK_ALREADY_BOUND` | Tài khoản bank đã liên kết club khác | Conflict |
| 409 | `CHAT_ALREADY_BOUND` | Nhóm đã liên kết club khác | Conflict |
| 403 | `CSRF_INVALID` | Yêu cầu không hợp lệ | Missing/invalid CSRF |
| 429 | `LOGIN_RATE_LIMITED` | Quá nhiều lần thử — đợi | Rate limit |
| 400 | `AUTH_TOKEN_INVALID` | Liên kết không hợp lệ hoặc đã hết hạn | Verify/reset token invalid, expired, wrong-purpose, or consumed; intentionally generic |
| 503 | `AUTH_PROVIDER_UNAVAILABLE` | Phương thức đăng nhập chưa khả dụng | Facebook external gate/config/evidence chưa active; no identity/session mutation |

### Rate Limits

| Endpoint | Limit | Scope |
|----------|-------|-------|
| Login callback | 10/min | Per IP |
| Email register/verify/forgot/reset | 5/15min | Per normalized email hash + IP; public response remains enumeration-safe |
| Tenant creation | 3/hour | Per account |
| Provider verify | 5/10min | Per tenant |

---

## 4. Chi tiết triển khai

### Session Security

- `secure`, `httpOnly`, `sameSite=strict` cookies.
- CSRF token per session — verify on all mutations.
- CSP, X-Frame-Options, clickjacking protections.
- Session rotation on: login, owner assignment, tenant switch.
- Password reset uses an account-wide revoke primitive, not the current one-token revoke helper. Credential update + revoke-all are atomic and audited.

### Google OIDC proof matrix (DD-50)

The callback accepts identity only when **all** cells pass: provider signature/key rotation; exact configured `iss`; exact client-id `aud` (and `azp` when required); browser-bound state + nonce + PKCE; `exp`/`iat` freshness; stable `sub`; and `email_verified === true`. A display email, name, returned profile object, owner assertion, or matching person record cannot substitute for this proof.

### Email credential lifecycle (DD-50)

```text
register -> issue verify token(hash-only, TTL, purpose=verify) -> atomic consume -> verified
forgot   -> same generic response -> issue reset token(hash-only, TTL, purpose=reset) when eligible
reset    -> atomic consume -> replace password hash + revoke all account sessions -> login required
```

One canonical token-consume helper owns purpose/TTL/single-use checks. One canonical account-session revoke helper owns revoke-all. Delivery logs contain no raw token; analytics contain only outcome class. Enabling `email` requires all lifecycle endpoints, jobs/cleanup, audit fields, and regression tests to be green together.

### Login-State CSRF Binding (DD-31 SI-1, added 2026-07-06 · updated 2026-07-10 DD-13)

Three artifacts, additive to the existing same-origin check (defense-in-depth, does not replace it):

1. **Migration:** `auth_login_state` table (§2) — single-use, short-TTL (10 min), keyed by `state_hash`.
2. **Issue route:** `GET /api/auth/{google|facebook}/state` mints a random state token, stores `sha256(token)` in `auth_login_state`, and sets a short-TTL httpOnly pre-auth cookie. It only redirects when that provider's config/gate is active. The email/password login form reuses the same pre-auth state cookie.
3. **Callback consume:** `GET /api/auth/{google|facebook}/callback` (and `POST /api/auth/email/login`) reads the pre-auth cookie, hashes it, looks up `auth_login_state` — reject (`AUTH_INVALID`) if missing, expired or consumed; otherwise consume it single-use alongside provider proof/password + same-origin verification. Only after every provider-specific check passes may the flow issue/rotate a session.

This closes the gap the Origin/Referer check alone cannot: it proves the callback is a continuation of the SAME browser session that started the login (state-bound), independent of which transport delivered the callback request.

### Web-Auth Identity Hash Keying (DD-31 SI-2, added 2026-07-06 · updated 2026-07-10 DD-13/DD-37)

`account_identities.platform_user_hash` (web-auth layer — **not** `channel_identities.platform_user_lookup_hash`; see `feature_identity_tech.md` for the separately-governed channel-layer mandate) is computed as a keyed HMAC over the provider subject:

- Subject = Google `sub` (`google`), normalized email (`email`), or verified stable app-scoped subject of the configured Meta App (`facebook`). HMAC input is explicitly domain/provider separated (for example version + provider + subject); Messenger Page-scoped PSID stays exclusively in the channel-identity layer. `zalo` remains gated by DD-14.
- Key sourced per "Secret / KMS Source" below (DD-31 gap 3) — never hardcoded, never derived from the plaintext subject alone.
- The SAME key is used at write time (login/register, creating the `account_identities` row) and read time (login lookup), resolved through one shared helper — a key mismatch between the two silently breaks login for every existing user.
- The old `sha256("telegram:" + id)` value is dropped with Telegram Login (DD-37). The round-09 "Telegram user ID low-entropy / enumerable" finding is therefore **moot**, but the keyed HMAC is **retained** for consistency (Google `sub` is higher-entropy but still keyed).

### Explicit Tenant-Filter Policy (DD-31 SI-3, added 2026-07-06)

Every tenant-scoped read added under this feature's surface (onboarding runs/steps, and any future addition) combines:

1. `withTenant(db, tenantId, …)` — sets the `app.tenant_id` RLS GUC (the fail-closed backstop), **and**
2. An explicit `WHERE tenant_id = $tenantId` predicate inside the query itself.

Neither alone is the policy. RLS protects against the `app` role; the explicit predicate protects against a privileged or misrouted connection (e.g. `app_worker`/superuser reused incorrectly) that bypasses RLS outright and would otherwise silently fall back to the globally-latest row across all tenants. Applies to `onboardingSnapshot` today and to every tenant-scoped query added to this surface later.

### Secret / KMS Source (DD-31 gap 3, added 2026-07-06)

Blocks SI-2's hash key and, if the login-state token is signed rather than only stored row-side, SI-1's signing secret. **Decision (2026-07-06):** AWS KMS for staging/prod (`KMS_PROVIDER=aws-kms`, `KMS_KEY_ID=<arn>`); runtime receives references/secrets through the platform encrypted-env boundary documented in `environments-setup.md`, while local dev keeps the documented `ENCRYPTION_KEY` fallback. One shared helper resolves the key material for every auth-surface secret that needs it — SI-2's hash pepper today; any future secret on this surface reuses the same helper rather than deriving its own ad hoc key.

### Integration Verification Flow

```text
Connect → Save encrypted credentials → Async verify job (webhook test)
    → Status: pending → verified | error
    → Retry available (idempotent)
    → Failure stores redacted provider code
```

---

## 5. Testing Plan

### Unit Tests

| # | Test | Input | Expected |
|---|------|-------|----------|
| 1 | Valid Google login | Correct id_token sig + nonce + fresh iat | Session created |
| 1b | Valid email login | Correct email + password | Session created |
| 2 | Invalid Google id_token | Wrong signature | 401 `AUTH_INVALID` |
| 3 | Stale Google login | Expired iat/exp | 401 `AUTH_STALE` |
| 4 | Replayed login nonce | Same nonce reused | 401 |
| 5 | Session fixation test | Pre-login session | Rotated after login |
| 6 | CSRF valid | Correct token | Mutation accepted |
| 7 | CSRF invalid | Wrong/missing token | 403 |
| 8 | Concurrent tenant creation | Same idempotency key | One created |
| 9 | Wizard refresh | Same step + key | Idempotent |
| 10 | Bank already bound | Bank → other tenant | 409 `BANK_ALREADY_BOUND` |
| 11 | Chat already bound | Chat → other tenant | 409 `CHAT_ALREADY_BOUND` |
| 12 | Secret not returned | GET after save | Masked value |
| 13 | Secret in log | Request with credentials | Redacted |
| 14 | Secret rotation | New credentials | Old masked, new saved |
| 15 | Resume step verified | Step already complete | Skip/return status |
| 16 | Resume step error | Step with error | Error shown, retry available |
| 17 | Zalo skip | Skip Zalo step | Status=skipped, proceed |
| 18 | Readiness check | All required done | Ready=true |
| 19 | Readiness check partial | Bank not verified | Ready=false |
| 19b | Readiness without first session | Club + bank verified, no session | Ready=false |
| 19c | Optional channel failures | Required matrix complete; Zalo skipped/error and no tenant Page | Ready=true; central platform route reported separately |
| 20 | Tenant RLS isolation | Other tenant's data | Not accessible |
| 21 | Login-state missing | Valid Google/email login payload, no/wrong pre-auth cookie | 401 `AUTH_INVALID`, no session (DD-31 SI-1) |
| 22 | Login-state replay | Same state consumed twice | Second consume rejected (DD-31 SI-1) |
| 23 | Login-state expiry | State past TTL | Rejected (DD-31 SI-1) |
| 24 | Web-auth hash keyed | Fixed `google.sub` (or email) | Emitted hash ≠ bare `sha256(sub)`; changing the key changes the output (DD-31 SI-2) |
| 25 | Web-auth hash write/read parity | Register/login then re-login same user | Identical hash both times — no lockout (DD-31 SI-2) |
| 26 | Tenant-filter defense-in-depth | Superuser (RLS-bypassing) connection, two tenants' onboarding runs | Returns caller's OWN tenant's row only, via the explicit predicate (DD-31 SI-3) |
| 27 | Google wrong issuer/audience | Validly signed token for another issuer/client | 401, no session |
| 28 | Google unverified email | Valid token, `email_verified=false`/missing | 401, no account/session mutation |
| 29 | Verify token single-use | Consume same valid token twice | First succeeds; second generic reject |
| 30 | Reset token purpose/TTL | Verify token used at reset or expired reset token | Generic reject; credential unchanged |
| 31 | Forgot enumeration-safe | Known vs unknown normalized email | Same public response/status class; no identity leakage |
| 32 | Reset revoke-all atomicity | Account has multiple live sessions | Password changes and all sessions revoke in one commit |
| 33 | Revoke-all failure | Force session update failure | Password/token consume rolls back; old credential remains valid |
| 34 | Partial lifecycle gate | Verify/reset/revoke-all unavailable | Email provider disabled; Google login still works |
| 35 | Messenger central default | Tenant has no Page | Readiness can pass; central endpoint available for basic host/player flows |
| 36 | Optional Page conflict/failure | Page bound elsewhere/revoked | Reject/mark error; central fallback unchanged; no secret leak |
| 37 | Valid Facebook Login | Active external gate + browser-bound state + valid server-side code exchange for configured App | Facebook identity created/looked up; session issued; no raw code/token persisted |
| 38 | Facebook wrong App/subject proof | Provider response cannot be bound to configured App or has missing/invalid stable subject | 401; no identity/session mutation |
| 39 | Facebook login-state replay | Reuse a consumed Facebook callback state | Reject; provider result cannot mint a second session |
| 40 | Facebook hash parity | Same verified app-scoped subject on create then login | Identical domain/provider-separated HMAC; no lockout |
| 41 | Login subject vs PSID | Same person/profile hints exist in Messenger channel identity | No automatic link/merge; requires verified identity or consumed one-time `link_code` |
| 42 | Facebook external gate OFF | Non-test user requests state/callback without recorded evidence | Capability hidden/OFF or 503; no redirect, exchange, identity or session |

### Integration Tests

| # | Test | Setup | Expected |
|---|------|-------|----------|
| 1 | Full onboarding E2E | Login → club → bank → skip Zalo + tenant Page → first session via central | Tenant operational; readiness true only after session commit |
| 2 | Resume from bank fail | Club done → bank error → retry | Resumes correctly |
| 3 | Concurrent wizard sessions | 2 tabs same wizard | Idempotent |
| 4 | First session readiness | Complete all steps → create session | Session created |
| 5 | Optional tenant Page | Connect Page then revoke/fail | Branded endpoint status changes; central route remains available |

---

## 6. Rollout Plan + Changelog

### Rollout

1. Founder-only auth → tenant #1 replay.
2. Enable Google independently after OIDC matrix passes.
3. Enable email only after B0 design-probe + full verify/forgot/reset/revoke-all E2E pass; no partial rollout.
4. Enable Facebook for approved test users first; enable non-test users only after exact App Review/Business Verification/permission evidence is recorded and callback/PSID-separation E2E passes. Otherwise keep capability OFF and retain one-time `link_code` fallback.
5. Invited beta hosts.
6. Self-serve public launch.

### Metrics

- Auth failure rate / login funnel
- Onboarding funnel / step duration / drop-off
- Integration verification failure rate
- Duplicate conflicts
- Time-to-first-session

### Changelog

| Date | Version | Thay đổi |
|---|---|---|
| 2026-07-18 | v2.6 | **DD-33 + DD-60:** add gated Facebook state/callback contract, server-side exchange + app-scoped subject verification, domain-separated HMAC, PSID separation, exact external evidence gate/fallback, live-schema no-CHECK truth and auth legend convention. |
| 2026-07-17 | v2.5 | **WAO-OQ-2 closure:** one shared readiness predicate requires club-or-personal space, verified bank and first session; Zalo/tenant Page remain optional and central Messenger stays a platform release gate. |
| 2026-07-17 | v2.4 | **DD-65..67:** central Page is platform default; tenant Page optional, readiness can pass without it; hybrid registry migration/fallback tests added. |
| 2026-06-18 | v1.0 | Initial BE tech spec (English format) |
| 2026-06-19 | v2.0 | Chuẩn hoá Vietnamese numbered (6 sections), DDL, 12 edge cases, API contract, 20 tests |
| 2026-07-06 | v2.1 | Pin DD-31 gaps (security-design pass, auth-onboarding v3): login-state CSRF binding (SI-1, new `auth_login_state` table + issue route + callback consume), keyed web-auth identity hash (SI-2, `account_identities.platform_user_hash`), explicit tenant-filter policy (SI-3), AWS KMS secret source (gap 3). Additive only — rotation/channel-hash/HMAC mandates unchanged. Ref: `../../standards/decisions.md` DD-31, `auth-security-invariant-table.md`. |
| 2026-07-10 | v2.2 | **DD-37 + DD-13 ✅ (phase-1 pivot):** bỏ **Telegram Login** adapter; auth phase-1 = **Google OAuth + email/password**; `account_identities.platform ∈ {google,email,facebook,zalo}`. SI-2 keyed-hash áp cho `google.sub`/email (thay `telegram:id`; finding "TG id low-entropy" nay moot, giữ keyed HMAC). Endpoints `/api/auth/telegram/*` → `/api/auth/google/*` + `/api/auth/email/*`; onboarding `telegram/link` → `messenger/connect` + `zalo/connect`. Đảo OQ-1 của DD-31. Ref: DD-13 · DD-37 · DD-31. |
| 2026-07-16 | v2.3 | **Full propagation DD-50 (decisions v1.37):** exact Google OIDC proof matrix; complete email verify/forgot/reset/logout-all contract; hash-only TTL/single-use tokens; enumeration-safe responses; atomic password-reset + revoke-all; partial email provider fail-closed OFF. Physical schema remains gated by B0 mutation-path design-probe. |
