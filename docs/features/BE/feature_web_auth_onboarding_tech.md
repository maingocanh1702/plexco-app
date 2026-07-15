# Feature: Web Authentication & Tenant Onboarding — Backend Tech Spec

> **Canonical phase:** P4
> **Version:** 2.2 · 2026-07-10
> **Status:** Reviewed
> **Product spec:** `../feature_web_auth_onboarding.md`
> **References:** `../../standards/business-rules.md` BL-SEC-1/BL-SEC-3 · `../../standards/decisions.md` DD-13 · DD-37 · DD-31 · `auth-security-invariant-table.md`

---

## 1. Tổng quan triển khai

> **Cập nhật v2.2 (DD-37 + DD-13 ✅, 2026-07-10):** Bỏ **Telegram Login** adapter (Telegram out-of-scope — DD-37). Auth phase-1 = **Google OAuth + email/password** (DD-13 ✅). Việc này **đảo** OQ-1 của DD-31 (2026-07-06 "giữ TG Login only"): OQ-1 nay hết hiệu lực. `account_identities.platform ∈ {google, email, facebook, zalo}`; SI-2 keyed-hash áp cho `google.sub`/email thay `telegram:id` (§4). SI-1/SI-3 giữ nguyên hiệu lực.

```text
Auth Adapter (Google OAuth / email-password) → Account/Session Service → Onboarding Workflow
    → Tenant Service → Integration Services (Bank/Zalo/Messenger)
```

Tables: `accounts`, `web_sessions`, `account_identities`, `onboarding_runs/steps`; existing `tenant_admins`, `bank_accounts`, `zalo_bots`, `messenger_pages`. Authentication tables = protected global. Tenant resources = RLS-scoped. *(`telegram_links` = legacy, tenant-1 only — DD-37.)*

**Design decisions:**
- **(DD-13 ✅)** Auth phase-1 = provider `google` (OAuth) + `email` (email + password self-register). **KHÔNG** tạo root table `users` — `persons` vẫn là anchor; password ở bảng credential riêng qua migration mới (expand→contract). `facebook` (DD-33 🟡) + `zalo` (DD-14 ⬜) cắm cùng adapter khi ✅.
- Session token stored as hash — rotate on login, ownership assignment, tenant switch.
- Onboarding commands use `UNIQUE(run_id, step, idempotency_key)` — refresh/back safe.
- Integration verification async with status polling/outbox event — retries idempotent.
- **(DD-31 SI-1, added 2026-07-06)** Login is gated by a pre-auth, single-use, short-TTL, browser-bound login-state token (httpOnly cookie + `auth_login_state` row) — additive to, not a replacement for, the same-origin check. Áp cho OAuth callback (Google) và form email/password. See §4 "Login-State CSRF Binding".
- **(DD-31 SI-2, updated 2026-07-10)** `account_identities.platform_user_hash` is a keyed HMAC over the provider subject (`google.sub` / normalized email), never a bare hash — key sourced from AWS KMS in staging/prod, `ENCRYPTION_KEY` fallback in dev. See §4 "Web-Auth Identity Hash Keying".
- **(DD-31 SI-3, added 2026-07-06)** Every tenant-scoped read on this surface combines `withTenant` (RLS) **and** an explicit `tenant_id` predicate in the query — belt-and-suspenders, not RLS alone. See §4 "Explicit Tenant-Filter Policy".

> **Provider roadmap (DD-13 ✅ · DD-33 🟡 phase-1 · DD-14 ⬜):** phase-1 auth chốt = `google` + `email`. `facebook` (DD-33, phase-1 nhưng phụ thuộc App Review / FB Business Verification) và `zalo` (DD-14, chưa xác minh) cắm cùng adapter → `account_identities(platform, platform_user_hash)` khi DD tương ứng ✅. Google/email **không** cấp SĐT → phone vẫn chỉ là merge signal (DD-01); verified email là auto-merge signal. Ref: `../../standards/decisions.md` DD-13 · DD-33 · DD-14, `../../00-start-here/identity-model.md §7` (provider/channel phase matrix).

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

**Note on `account_identities.platform_user_hash` (DD-31 SI-2, updated 2026-07-10):** the column type is unchanged (`text`), but its VALUE is a keyed HMAC over the provider subject — the Google `sub` (provider `google`) or the normalized email (provider `email`) — never a bare `sha256(...)`. It must use a secret sourced per §4 "Secret / KMS Source". Write path (login/register) and read path (lookup) must resolve the identical key, or existing users are silently locked out. *(The old `sha256("telegram:" + id)` value is dropped with Telegram Login — DD-37; keyed HMAC retained for consistency.)*

### Edge Cases (Backend)

| # | Category | Case | Xử lý |
|---|----------|------|-------|
| 1 | Security | Google OAuth id_token signature/nonce invalid, or email/password mismatch | Reject — verify id_token sig + nonce (Google) / password hash (email) |
| 2 | Security | Stale/replayed auth (id_token iat/exp expired, reused nonce) | Reject — nonce single-use + timestamp freshness check |
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

---

## 3. API Contract

### Endpoints

| Method | Path | Auth | Mô tả |
|--------|------|------|-------|
| GET | /api/auth/google/state | Public | Issue pre-auth login-state token + cookie (DD-31 SI-1) — call before redirecting to Google OAuth |
| GET | /api/auth/google/callback | Public | Google OAuth verify (id_token/nonce) **+ login-state consume (DD-31 SI-1, additive — see §4)** |
| POST | /api/auth/email/register | Public | Email + password self-register (email verification) |
| POST | /api/auth/email/login | Public | Email + password login **+ login-state consume (DD-31 SI-1)** |
| POST | /api/auth/logout | Authenticated | Revoke session |
| GET | /api/auth/session | Authenticated | Current session info |
| POST | /api/onboarding/start | Authenticated | Create tenant + run |
| PATCH | /api/onboarding/club | TenantOwner | Club config |
| POST | /api/onboarding/bank/connect | TenantOwner | Connect bank provider |
| POST | /api/onboarding/bank/verify | TenantOwner | Verify bank webhook |
| POST | /api/onboarding/zalo/connect | TenantOwner | Connect Zalo (dán Bot Token) |
| POST | /api/onboarding/messenger/connect | TenantOwner | Connect Facebook Messenger (FB Login + chọn Page) |
| GET | /api/onboarding/messenger/status | TenantOwner | Check Messenger Page bind status |
| GET | /api/onboarding/readiness | TenantOwner | Readiness checklist |

### Error Codes

| Code | Error Code | Message | Trigger |
|------|-----------|---------|---------|
| 401 | `AUTH_INVALID` | Xác thực không hợp lệ | Invalid Google id_token/nonce or email credential |
| 401 | `AUTH_STALE` | Phiên xác thực đã hết hạn | Stale/expired id_token or reused nonce |
| 409 | `BANK_ALREADY_BOUND` | Tài khoản bank đã liên kết club khác | Conflict |
| 409 | `CHAT_ALREADY_BOUND` | Nhóm đã liên kết club khác | Conflict |
| 403 | `CSRF_INVALID` | Yêu cầu không hợp lệ | Missing/invalid CSRF |
| 429 | `LOGIN_RATE_LIMITED` | Quá nhiều lần thử — đợi | Rate limit |

### Rate Limits

| Endpoint | Limit | Scope |
|----------|-------|-------|
| Login callback | 10/min | Per IP |
| Tenant creation | 3/hour | Per account |
| Provider verify | 5/10min | Per tenant |

---

## 4. Chi tiết triển khai

### Session Security

- `secure`, `httpOnly`, `sameSite=strict` cookies.
- CSRF token per session — verify on all mutations.
- CSP, X-Frame-Options, clickjacking protections.
- Session rotation on: login, owner assignment, tenant switch.

### Login-State CSRF Binding (DD-31 SI-1, added 2026-07-06 · updated 2026-07-10 DD-13)

Three artifacts, additive to the existing same-origin check (defense-in-depth, does not replace it):

1. **Migration:** `auth_login_state` table (§2) — single-use, short-TTL (10 min), keyed by `state_hash`.
2. **Issue route:** `GET /api/auth/google/state` — mints a random state token, stores `sha256(token)` in `auth_login_state`, sets it in a short-TTL httpOnly pre-auth cookie (separate from the post-login session cookie). Called before redirecting the browser to Google OAuth; the OAuth `state` param is bound to this row. The email/password login form reuses the same pre-auth state cookie.
3. **Callback consume:** `GET /api/auth/google/callback` (and `POST /api/auth/email/login`) reads the pre-auth cookie, hashes it, looks up `auth_login_state` — reject (`AUTH_INVALID`) if the row is missing, expired, or already consumed; otherwise consume it (single-use) alongside Google id_token/nonce (or password) + same-origin verification. Only after all checks pass does the flow proceed to session issuance/rotation.

This closes the gap the Origin/Referer check alone cannot: it proves the callback is a continuation of the SAME browser session that started the login (state-bound), independent of which transport delivered the callback request.

### Web-Auth Identity Hash Keying (DD-31 SI-2, added 2026-07-06 · updated 2026-07-10 DD-13/DD-37)

`account_identities.platform_user_hash` (web-auth layer — **not** `channel_identities.platform_user_lookup_hash`; see `feature_identity_tech.md` for the separately-governed channel-layer mandate) is computed as a keyed HMAC over the provider subject:

- Subject = Google `sub` (provider `google`) or the normalized email (provider `email`); `facebook`/`zalo` subjects plug in the same way when DD-33/DD-14 land.
- Key sourced per "Secret / KMS Source" below (DD-31 gap 3) — never hardcoded, never derived from the plaintext subject alone.
- The SAME key is used at write time (login/register, creating the `account_identities` row) and read time (login lookup), resolved through one shared helper — a key mismatch between the two silently breaks login for every existing user.
- The old `sha256("telegram:" + id)` value is dropped with Telegram Login (DD-37). The round-09 "Telegram user ID low-entropy / enumerable" finding is therefore **moot**, but the keyed HMAC is **retained** for consistency (Google `sub` is higher-entropy but still keyed).

### Explicit Tenant-Filter Policy (DD-31 SI-3, added 2026-07-06)

Every tenant-scoped read added under this feature's surface (onboarding runs/steps, and any future addition) combines:

1. `withTenant(db, tenantId, …)` — sets the `app.tenant_id` RLS GUC (the fail-closed backstop), **and**
2. An explicit `WHERE tenant_id = $tenantId` predicate inside the query itself.

Neither alone is the policy. RLS protects against the `app` role; the explicit predicate protects against a privileged or misrouted connection (e.g. `app_worker`/superuser reused incorrectly) that bypasses RLS outright and would otherwise silently fall back to the globally-latest row across all tenants. Applies to `onboardingSnapshot` today and to every tenant-scoped query added to this surface later.

### Secret / KMS Source (DD-31 gap 3, added 2026-07-06)

Blocks SI-2's hash key and, if the login-state token is signed rather than only stored row-side, SI-1's signing secret. **Decision (2026-07-06):** AWS KMS for staging/prod (`KMS_PROVIDER=aws-kms`, `KMS_KEY_ID=<arn>` — matches the existing `fly secrets` convention in `environments-setup.md`); local dev keeps the documented `ENCRYPTION_KEY` fallback. One shared helper resolves the key material for every auth-surface secret that needs it — SI-2's hash pepper today; any future secret on this surface reuses the same helper rather than deriving its own ad hoc key.

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
| 20 | Tenant RLS isolation | Other tenant's data | Not accessible |
| 21 | Login-state missing | Valid Google/email login payload, no/wrong pre-auth cookie | 401 `AUTH_INVALID`, no session (DD-31 SI-1) |
| 22 | Login-state replay | Same state consumed twice | Second consume rejected (DD-31 SI-1) |
| 23 | Login-state expiry | State past TTL | Rejected (DD-31 SI-1) |
| 24 | Web-auth hash keyed | Fixed `google.sub` (or email) | Emitted hash ≠ bare `sha256(sub)`; changing the key changes the output (DD-31 SI-2) |
| 25 | Web-auth hash write/read parity | Register/login then re-login same user | Identical hash both times — no lockout (DD-31 SI-2) |
| 26 | Tenant-filter defense-in-depth | Superuser (RLS-bypassing) connection, two tenants' onboarding runs | Returns caller's OWN tenant's row only, via the explicit predicate (DD-31 SI-3) |

### Integration Tests

| # | Test | Setup | Expected |
|---|------|-------|----------|
| 1 | Full onboarding E2E | Login (Google/email) → club → bank → Zalo/Messenger → session | Tenant operational |
| 2 | Resume from bank fail | Club done → bank error → retry | Resumes correctly |
| 3 | Concurrent wizard sessions | 2 tabs same wizard | Idempotent |
| 4 | First session readiness | Complete all steps → create session | Session created |

---

## 6. Rollout Plan + Changelog

### Rollout

1. Founder-only auth → tenant #1 replay
2. Invited beta hosts
3. Self-serve public launch

### Metrics

- Auth failure rate / login funnel
- Onboarding funnel / step duration / drop-off
- Integration verification failure rate
- Duplicate conflicts
- Time-to-first-session

### Changelog

| Date | Version | Thay đổi |
|---|---|---|
| 2026-06-18 | v1.0 | Initial BE tech spec (English format) |
| 2026-06-19 | v2.0 | Chuẩn hoá Vietnamese numbered (6 sections), DDL, 12 edge cases, API contract, 20 tests |
| 2026-07-06 | v2.1 | Pin DD-31 gaps (security-design pass, auth-onboarding v3): login-state CSRF binding (SI-1, new `auth_login_state` table + issue route + callback consume), keyed web-auth identity hash (SI-2, `account_identities.platform_user_hash`), explicit tenant-filter policy (SI-3), AWS KMS secret source (gap 3). Additive only — rotation/channel-hash/HMAC mandates unchanged. Ref: `../../standards/decisions.md` DD-31, `auth-security-invariant-table.md`. |
| 2026-07-10 | v2.2 | **DD-37 + DD-13 ✅ (phase-1 pivot):** bỏ **Telegram Login** adapter; auth phase-1 = **Google OAuth + email/password**; `account_identities.platform ∈ {google,email,facebook,zalo}`. SI-2 keyed-hash áp cho `google.sub`/email (thay `telegram:id`; finding "TG id low-entropy" nay moot, giữ keyed HMAC). Endpoints `/api/auth/telegram/*` → `/api/auth/google/*` + `/api/auth/email/*`; onboarding `telegram/link` → `messenger/connect` + `zalo/connect`. Đảo OQ-1 của DD-31. Ref: DD-13 · DD-37 · DD-31. |
