# Feature: Web Authentication & Tenant Onboarding — Backend Tech Spec

> **Canonical phase:** P4
> **Version:** 2.8 · 2026-07-19
> **Status:** Reviewed
> **Implementation:** In progress — Onboarding v3 Telegram-era merged (`5b1193b`); Google/email DD-37 chưa code · authority: `../../standards/BUILD-STATUS.md` (Doc status ≠ Implementation status)  
> **Product spec:** `../feature_web_auth_onboarding.md`
> **References:** `../../standards/business-rules.md` BL-SEC-1/BL-SEC-3/BL-MSG · `../../standards/decisions.md` DD-13 · DD-31 · **DD-33** · DD-50 · DD-60 · **DD-65..67** · **DD-80 (B0 ✅ v1.77)** · `../../b0-auth-credential-lifecycle-design-probe.md` · `../../standards/api-reference-convention.md` · `auth-security-invariant-table.md`

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
- **(DD-31 SI-1, corrected 2026-07-18)** Pre-auth continuity has two transport-specific owners. Same-origin email login keeps the live `auth_login_state` + Strict cookie + `sameOriginRequest()` pattern. Google/Facebook redirect uses `auth_oauth_transactions` + dedicated path-scoped Lax binding cookie; the cross-site GET callback **must not** call `sameOriginRequest()`. See §4.
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

### Pre-auth continuity stores (DD-31 SI-1; cross-site correction 2026-07-18)

The live table remains the owner for same-origin pre-auth continuity (Telegram today; email form target); it is not sufficient for OAuth redirect state:

```sql
CREATE TABLE auth_login_state (
  state_hash  text PRIMARY KEY,   -- live Telegram today; same-origin email form target; raw token only in Strict cookie
  expires_at  timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
```

Google adapter adds one protected transaction table; Facebook reuses it only when its external gate is active:

```sql
CREATE TABLE auth_oauth_transactions (
  state_hash           text PRIMARY KEY,
  provider             text NOT NULL CHECK (provider IN ('google','facebook')),
  browser_binding_hash text NOT NULL,
  nonce_hash           text,
  pkce_verifier_enc    bytea,            -- canonical KMS ciphertext type; Google PKCE S256 only
  kms_key_version      text,             -- opaque KMS key/version reference metadata
  expires_at           timestamptz NOT NULL,
  consumed_at          timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  CHECK (provider <> 'google' OR
         (nonce_hash IS NOT NULL AND pkce_verifier_enc IS NOT NULL AND kms_key_version IS NOT NULL))
);
CREATE INDEX auth_oauth_transactions_expiry_idx ON auth_oauth_transactions(expires_at);
```

No table grant to runtime roles. Narrow issue/claim functions hash state+binding, encrypt/decrypt the Google PKCE verifier with AAD `(state_hash,provider,key_version)`, consume once and NULL verifier ciphertext at terminal/expiry. `pkce_verifier_enc` stays `bytea`, matching canonical live `*_enc` storage and `oauth_transactions.code_verifier_enc`; `kms_key_version` is separate text metadata, not a ciphertext envelope type. Both stores use a 10-minute TTL; the OAuth callback also verifies exact provider, cookie binding and query state. This is distinct from `auth_login_nonces`, which remains a replay guard on the verified provider payload.

### DD-50 email-auth storage design gate (required before DDL)

The lifecycle below is normative; physical tables/indexes remain **provisional** until B0 maps every register/verify/login/forgot/reset/revoke path and proves one transactional consume boundary. The probe must produce a decision table and exact uniqueness/expiry/cleanup constraints. It must not assume that the current single-token `revokeWebSession` helper already provides account-wide revocation.

> **(2026-07-18) Probe draft:** `../../b0-auth-credential-lifecycle-design-probe.md` — maps every register/verify/login/forgot/reset/revoke path, pins the single transactional consume boundary, the account-wide revoke primitive (ungranted internal helper + current-session-derived public wrapper), multi-attempt verify-first registration, the protected outbox → pg-boss delivery boundary and the login finalizer that closes the stale-password/reset race. **Still awaiting owner approval**, so the tables/indexes below stay provisional: no migration/DDL may be authored from it yet and the email provider stays fail-closed OFF (external gate `C7` in `../../pre-code-open-items-2026-07-16.md` §C).

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
| GET | /api/auth/google/state | ⬜ Public | Trusted-IP issue bucket trước row/cookie; issue OAuth transaction + provider-specific Lax binding; redirect với state+nonce+PKCE S256 |
| GET | /api/auth/google/callback | ⬜ Public | Separate trusted-IP callback bucket; cross-site GET claims exact state+binding, exchanges code+PKCE, verifies OIDC proof; **no `sameOriginRequest()`** |
| GET | /api/auth/facebook/state | ⬜ Public | Shared trusted-IP issue bucket trước row/cookie; issue OAuth transaction + Lax binding only when external gate/config active |
| GET | /api/auth/facebook/callback | ⬜ Public | Separate trusted-IP callback bucket; claim state+binding; server-side code exchange + configured-App subject proof; **no same-origin header gate** |
| POST | /api/auth/email/register | ⬜ Public | Email + password self-register (email verification) |
| GET | /auth/email/verify | ⬜ Public | Non-mutating landing; scrub token; no lookup/consume; explicit user confirmation only |
| POST | /api/auth/email/verify | ⬜ Public | Same-origin POST + exact Strict registration cookie; atomically consume token/attempt and verify |
| POST | /api/auth/email/login | ⬜ Public | Email + password login **+ login-state consume (DD-31 SI-1)** |
| POST | /api/auth/email/forgot | ⬜ Public | Enumeration-safe reset request; issue hash-only TTL/single-use reset token when eligible |
| GET | /auth/email/reset | ⬜ Public | Non-mutating reset landing; scrub token; no consume/credential mutation before explicit form submit |
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
| OAuth state issue | 10/min | Shared trusted-IP bucket across Google+Facebook; check before transaction insert/cookie; limiter/storage failure creates neither |
| OAuth callback | 10/min | Separate trusted-IP bucket; check before claim/provider exchange |
| Email login | 10/min trusted-IP + 5/15min normalized-email-HMAC | Independent buckets; both must pass before Argon2/session path |
| Email register/forgot | 5/15min | Independent normalized-email-HMAC + trusted-IP buckets |
| Email verify/reset | 5/15min | Trusted-IP first; then non-consuming active-token→stored-email-hash target bucket, or domain-separated invalid-artifact bucket; both before consume |
| Tenant creation | 3/hour | Per account |
| Provider verify | 5/10min | Per tenant |

Verify/reset ordering is normative: trusted-IP limit runs before token lookup; a protected non-mutating resolver may map only an active, unexpired token hash to the stored `email_lookup_hash`. The second bucket is target-email for a resolved token, otherwise `HMAC(domain='auth-invalid-artifact-rate', token_hash)`. No branch returns email/account data or changes the public response. Any bucket/rate-limit-storage failure fails closed with zero token consume or credential/session mutation.

---

## 4. Chi tiết triển khai

### Session Security

- Session cookie: `Secure`, `HttpOnly`, `SameSite=Strict`, host-only. Email login/registration pre-auth cookies are also path-scoped Strict. OAuth binding is a separate provider-specific `Secure; HttpOnly; SameSite=Lax` cookie scoped to the exact callback path and ≤10 minutes; it is never accepted as a session.
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

### Pre-auth browser continuity (DD-31 SI-1 · cross-site correction 2026-07-18)

The transport is part of the security contract; one cookie policy cannot safely serve both:

1. **Same-origin credential form:** `GET /api/auth/email/state` mints a row in live `auth_login_state` and a host-only `Secure; HttpOnly; SameSite=Strict` cookie scoped to `/api/auth/email/login`. `POST /api/auth/email/login` requires both `sameOriginRequest()` and atomic state consume before credential finalization.
2. **Cross-site OAuth redirect:** `GET /api/auth/{google|facebook}/state` always generates independent 32-byte state + browser binding; Google additionally generates nonce + PKCE verifier and stores the encrypted verifier in `auth_oauth_transactions`. It sets a provider-specific host-only `SameSite=Lax` cookie containing `{state,binding}` at the exact callback path, then redirects with provider-specific parameters. The callback is a top-level cross-site GET, so it intentionally does **not** call `sameOriginRequest()` or require same-origin Origin/Referer. It atomically claims exact state+provider+binding+TTL before exchange/proof; missing/mismatch/replay always rejects, Google additionally rejects PKCE/nonce downgrade, and Facebook verifies the stable subject of the exact configured App. Session mint occurs only after full provider-specific proof, and the new session cookie is Strict.
3. **Email links:** verify/reset GET is non-mutating landing only, with no third-party resources and token scrub. An explicit user action submits same-origin POST. Verify additionally requires the exact Strict registration-key cookie; wrong browser gets handoff/re-register without consuming the token. Reset GET never consumes or changes credentials. This makes link scanners/prefetch harmless.

OAuth state/binding, authorization code, nonce, verifier and email URL token are excluded from logs/analytics. Callback/landing responses set `Referrer-Policy: no-referrer`. These bindings prove browser continuity without misclassifying a legitimate provider redirect as same-origin.

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

### Acceptance matrix — slice D0 `auth-s4-d0-revoke-core` (DD-80 §6/§9a)

> Điều kiện PASS của slice: mọi row dưới có test executable với expected result đúng; grant/RLS chạy trên Postgres thật. Manifest: `../../autopilot-manifests/auth-s4-d0-revoke-core.json`.

| # | Case | Setup | Expected |
|---|---|---|---|
| D0-1 | Internal revoke-by-account | Account A có 3 web_sessions, B có 1; gọi `auth_revoke_account_sessions(A)` (owner conn) | 3 session của A có `revoked_at`, session B nguyên vẹn; return count=3 |
| D0-2 | Helper không granted | Role `app` EXECUTE internal helper | `permission denied`; grant matrix chỉ có public wrapper |
| D0-3 | Public wrapper derive account | Session cookie hợp lệ + CSRF đúng → `POST /api/auth/logout-all` | Mọi session của account hiện tại (kể cả current) revoked; response ok; wrapper KHÔNG nhận `account_id` param |
| D0-4 | Logout-all replay | Gọi lại với cookie đã revoked | 401 `AUTH_INVALID`, zero mutation (B0 §6.2) |
| D0-5 | CSRF fail | Thiếu/sai CSRF secret | 403 `CSRF_INVALID`, không revoke gì |
| D0-6 | Rotated chain | rotate session rồi logout-all | Cả token cũ (rotated_from chain) lẫn mới đều không resolve được |
| D0-7 | Race logout-all × rotate | 2 connection concurrent | Không deadlock; trạng thái cuối: không token nào của account còn resolve; rotate-sau-revoke trả AUTH_INVALID |
| D0-8 | Audit atomic | logout-all thành công | `logout_all` audit ghi cùng transaction; không log token/raw |
| D0-9 | Schema mirror §9(a) | `schema.ts` mirror `auth_login_nonces`/`auth_login_state`/`rate_limit_hits` | Type-check + Drizzle mirror pass; zero runtime/DDL behavior change |
| D0-10 | Lock order | Helper lock `accounts` parent trước `web_sessions` con (§5.2 B0) | Trace/regression: không path nào lock sessions trước accounts |

### Acceptance matrix — slice D1 `auth-s4-d1-google-adapter` (DD-80 §2/§4/§4.1/§8.2)

> Google độc lập với email-password flag; Facebook giữ `AUTH_PROVIDER_UNAVAILABLE`. Manifest: `../../autopilot-manifests/auth-s4-d1-google-adapter.json`.

| # | Case | Setup | Expected |
|---|---|---|---|
| D1-1 | State issue + bucket-trước-mutation | 11 GET `/api/auth/google/state` cùng trusted-IP trong 1 phút | 10 lần đầu: row `auth_oauth_transactions` + Lax path-scoped binding cookie; lần 11: 429, KHÔNG tạo row/cookie |
| D1-2 | Callback happy path (cell new/new) | State+binding+PKCE+nonce hợp lệ, id_token JWKS-verified, `email_verified=true`, sub/email chưa tồn tại | Một transaction tạo Person+Account+verified `account_emails`+Google identity; session mint; cookie session `Strict` |
| D1-3 | State single-use | Replay callback cùng state | Generic reject, zero mutation |
| D1-4 | Binding cookie thiếu/sai | Callback không có/lệch binding cookie | Reject; transaction không bị claim |
| D1-5 | Proof matrix negatives | Từng cell sai: `iss`/`aud`/`azp`/`exp`/nonce/`email_verified=false` | Generic reject từng cell; zero account/session mutation (table-driven) |
| D1-6 | Collision: email thuộc account A | Sub mới + verified email của A | Attach Google identity vào A (DD-50 strong proof); không account thứ hai |
| D1-7 | Collision: pending account A | Email đang pending 2 attempts | Promote email cho A; supersede TOÀN BỘ attempts+tokens, NULL password/key candidates, không copy candidate; attach identity |
| D1-8 | Collision: sub thuộc A, email thuộc B | Hai account khác nhau | `AUTH_IDENTITY_CONFLICT`; không auto-merge, không mint session (→ DD-53) |
| D1-9 | Collision: sub thuộc A, email pending B | — | Login A bằng stable subject; KHÔNG mutate/supersede attempt/token của B |
| D1-10 | Collision: sub thuộc A, email mới từ Google | Google trả email khác đã lưu | Login A; KHÔNG tự tạo/promote `account_emails` (email-change là workflow riêng, ngoài scope) |
| D1-11 | Callback bucket độc lập | Exhaust `oauth-state` bucket | `oauth-callback` bucket không bị ảnh hưởng và ngược lại |
| D1-12 | PKCE ciphertext | Kiểm tra storage | Canonical `bytea` + key version text riêng (v2.7 contract) |
| D1-13 | Không same-origin gate | Cross-site GET callback với binding Lax | Hoạt động; KHÔNG gọi `sameOriginRequest()`; session cookie vẫn Strict |
| D1-14 | Telegram regression | Chạy test suite Telegram hiện có | Pass nguyên vẹn (chưa remove route nào) |
| D1-15 | Facebook negative scope | GET facebook state/callback | `AUTH_PROVIDER_UNAVAILABLE` như v2.6; zero mutation |

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
| 43 | Google cross-site callback | Top-level GET from Google; Origin absent or Referer=provider; matching Lax binding/state/PKCE/nonce | Login succeeds; callback never invokes `sameOriginRequest()`; issued session cookie remains Strict |
| 44 | OAuth callback wrong browser/binding | Valid provider code+state opened without matching provider binding cookie | 401 generic; no exchange-derived identity/session mutation; transaction not reusable after a valid claim |
| 45 | Google PKCE downgrade/mix-up | Missing challenge/verifier, wrong provider row or callback path | Reject; no token/identity/session; exact redirect/provider enforced. Facebook remains state/binding + configured-App proof unless a later provider contract explicitly adds PKCE |
| 46 | Email link scanner | GET verify/reset URL without user POST | 200 landing or generic page; zero token consume, verification, credential or session mutation |
| 47 | Verify wrong browser | Valid token but missing/wrong Strict registration cookie on same-origin POST | Generic handoff/re-register; token and pending winner remain unconsumed |
| 48 | OAuth state issue exhaustion | 11 starts/min from one trusted IP, alternating Google/Facebook | 11th returns 429 before row/cookie; callback bucket remains independent; limiter error also creates nothing |
| 49 | Verify/reset limit ordering | IP over limit; valid target over limit; invalid/expired token | IP denial performs no token lookup; target denial performs no consume; invalid uses HMAC artifact bucket; all responses remain generic/no mutation |
| 50 | OAuth PKCE ciphertext schema parity | Schema/migration/catalog inspection | `auth_oauth_transactions.pkce_verifier_enc=bytea`; no base64-text exception; key version remains separate metadata |

### Integration Tests

| # | Test | Setup | Expected |
|---|------|-------|----------|
| 1 | Full onboarding E2E | Login → club → bank → skip Zalo + tenant Page → first session via central | Tenant operational; readiness true only after session commit |
| 2 | Resume from bank fail | Club done → bank error → retry | Resumes correctly |
| 3 | Concurrent wizard sessions | 2 tabs same wizard | Idempotent |
| 4 | First session readiness | Complete all steps → create session | Session created |
| 5 | Optional tenant Page | Connect Page then revoke/fail | Branded endpoint status changes; central route remains available |
| 6 | Real redirect transport | Browser starts Google flow, returns by cross-site top-level GET | Lax binding arrives and full proof succeeds; Strict session cookie is issued only afterward |
| 7 | Webmail/link-scanner transport | Scanner GET then user opens link in original/wrong browser | Scanner is no-op; original-browser explicit POST can verify; wrong browser cannot install its attempt credential |

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
| 2026-07-19 | v2.8 | **DD-80 propagate + slice artifacts:** refs thêm DD-80/B0 probe (owner-approved v1.77); thêm acceptance matrix D0 revoke-core (10 case) + D1 Google adapter (15 case) bind manifests `auth-s4-d0-revoke-core.json`/`auth-s4-d1-google-adapter.json`. Contract §2–§4 không đổi; chưa claim runtime. |
| 2026-07-19 | v2.7a | Metadata sweep (index v2.35): thêm trường **Implementation** đồng bộ BUILD-STATUS (In progress). Không đổi contract. |
| 2026-07-18 | v2.7 | **Cross-site auth + final review correction:** live Strict/same-origin login-state remains only for same-origin form; Google/Facebook use protected OAuth transaction + provider-specific Lax binding; verify/reset links use non-mutating GET → explicit same-origin POST. OAuth state issue now has a pre-insert/cookie trusted-IP bucket distinct from callback; verify/reset pin IP→non-mutating target resolve→target/invalid-artifact bucket→consume ordering; Google PKCE KMS ciphertext uses canonical `bytea` while key version remains separate text metadata. Add transport/link-scanner/rate-order/Google-PKCE tests. |
| 2026-07-18 | v2.6 | **DD-33 + DD-60:** add gated Facebook state/callback contract, server-side exchange + app-scoped subject verification, domain-separated HMAC, PSID separation, exact external evidence gate/fallback, live-schema no-CHECK truth and auth legend convention. |
| 2026-07-17 | v2.5 | **WAO-OQ-2 closure:** one shared readiness predicate requires club-or-personal space, verified bank and first session; Zalo/tenant Page remain optional and central Messenger stays a platform release gate. |
| 2026-07-17 | v2.4 | **DD-65..67:** central Page is platform default; tenant Page optional, readiness can pass without it; hybrid registry migration/fallback tests added. |
| 2026-06-18 | v1.0 | Initial BE tech spec (English format) |
| 2026-06-19 | v2.0 | Chuẩn hoá Vietnamese numbered (6 sections), DDL, 12 edge cases, API contract, 20 tests |
| 2026-07-06 | v2.1 | Pin DD-31 gaps (security-design pass, auth-onboarding v3): login-state CSRF binding (SI-1, new `auth_login_state` table + issue route + callback consume), keyed web-auth identity hash (SI-2, `account_identities.platform_user_hash`), explicit tenant-filter policy (SI-3), AWS KMS secret source (gap 3). Additive only — rotation/channel-hash/HMAC mandates unchanged. Ref: `../../standards/decisions.md` DD-31, `auth-security-invariant-table.md`. |
| 2026-07-10 | v2.2 | **DD-37 + DD-13 ✅ (phase-1 pivot):** bỏ **Telegram Login** adapter; auth phase-1 = **Google OAuth + email/password**; `account_identities.platform ∈ {google,email,facebook,zalo}`. SI-2 keyed-hash áp cho `google.sub`/email (thay `telegram:id`; finding "TG id low-entropy" nay moot, giữ keyed HMAC). Endpoints `/api/auth/telegram/*` → `/api/auth/google/*` + `/api/auth/email/*`; onboarding `telegram/link` → `messenger/connect` + `zalo/connect`. Đảo OQ-1 của DD-31. Ref: DD-13 · DD-37 · DD-31. |
| 2026-07-16 | v2.3 | **Full propagation DD-50 (decisions v1.37):** exact Google OIDC proof matrix; complete email verify/forgot/reset/logout-all contract; hash-only TTL/single-use tokens; enumeration-safe responses; atomic password-reset + revoke-all; partial email provider fail-closed OFF. Physical schema remains gated by B0 mutation-path design-probe. |
