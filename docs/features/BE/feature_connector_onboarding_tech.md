# Feature: Connector Onboarding (Zalo · SePay · ApiPay) — Backend Tech Spec

> **Canonical phase:** P3 (payment ingest) · P4 (onboarding) · P4.7 (Zalo) — *cross-cutting*
> **Version:** 0.10 · 2026-08-10
> **Status:** Draft · SePay inbound auth reconciled; ApiPay enterprise-primary internal contract pinned, provider gate open
> **Implementation:** Not started · authority: `../../standards/BUILD-STATUS.md` (Doc status ≠ Implementation status)  
> **Product spec:** `../FE/feature_connector_onboarding.md`
> **References:** `../../product/TDD.md` §3.2/3.6 · `../../standards/business-rules.md` BL-PAY-6, BL-SEC-1/2, BL-TEN-1, BL-ID-6, BL-SEC-5 · `feature_payment_reconcile_tech.md` (ingest downstream) · `feature_zalo_channel_tech.md` (channel events downstream) · `feature_web_auth_onboarding_tech.md` (wizard) · `../../research/player-side-saas-AUDIT.md` §B2 · `../../research/auto-debt-reconciliation-regional-availability-2026-07-27.md`

> **Current availability/runtime boundary (`main@784bc8d`):** provider enum vẫn chỉ
> `sepay|apipay` (Việt Nam); không provider/market abstraction nào từ research được coi là authority.
> Shared job scheduler đã merge nhưng OFF/placeholder và chưa đăng ký OAuth refresh, bank recheck,
> orphan cleanup, payment producer hay connector projector trong spec này. `payment_reconcile_auto`
> entitlement không bypass market/provider/bank/currency/consent gates.

---

## 1. Tổng quan triển khai

**Phạm vi feature này:** lớp *provisioning → auto-register webhook → verify 2 tầng → lifecycle* của kết nối. **KHÔNG** bao gồm: reconcile/matching giao dịch (xem `feature_payment_reconcile_tech.md`) và number-reply/reachability của Zalo (xem `feature_zalo_channel_tech.md`). Feature này thay **đường thiết lập** webhook (từ owner dán tay → Plexco gọi API), rồi **delegate** cho handler hạ nguồn đã có.

Hai pipeline:

### Entry points

| Entry | Caller | Mô tả |
|-------|--------|-------|
| `POST /api/onboarding/bank` | Host (wizard) | SePay OAuth / ApiPay enterprise / BYO fallback → validate + autoRegisterWebhook |
| `POST /api/onboarding/zalo` | Host (wizard) | BYO bot token → validate + setWebhook |
| `POST /api/webhooks/sepay` | SePay callback | Inbound auth verify → payment ingest |
| `POST /api/webhooks/apipay` | ApiPay callback | Webhook verify → payment ingest |
| `POST /api/webhooks/zalo/:token` | Zalo callback | Bot event ingestion |
| OAuth refresh job (pg-boss) | System | Refresh SePay OAuth tokens before expiry |
| Bank recheck job (pg-boss) | System | Periodic connectivity/drift check |
| `POST /api/clubs/:id/connectors/:id/rotate` | Host | Credential rotation (write-only/KMS) |

```text
CONNECT (owner-initiated, trong onboarding wizard)
  credential {oauth2 | enterprise | api_key (BYO fallback) | bot_token}
    → validate()           [SePay: token exchange + /me · ApiPay enterprise: platform-credential auto-provision per-host (DD-30) · ApiPay BYO fallback: GET /v2/client/banks · Zalo: getMe*]
    → autoRegisterWebhook() [SePay: POST /api/v1/webhooks · ApiPay: POST /v1/client/webhooks · Zalo: setWebhook*]
    → persist provider_connections / bank_accounts / zalo_bots  (status = registered)   ← Tier 1
    → chờ event thật                                            (status = active)        ← Tier 2

WEBHOOK (provider-initiated)
  POST /webhook/{provider}/:token
    → :token → tenant + secret                       (B1, BL-PAY-6)
    → timing-safe verify trên RAW body               (B3, BL-SEC-2)
    → nếu là event ĐẦU TIÊN của connection → flip status=active + emit analytics (idempotent)
    → delegate:
         sepay/apipay → durable ingest bank_transactions  (payment_reconcile_tech §3)
         zalo         → channel event handler              (zalo_channel_tech §4)
```

`*` Zalo `getMe`/`setWebhook` **blocked by CO-OQ-1** (product spec) — code path tồn tại nhưng feature-flag tắt cho tới khi confirm sandbox; trước đó dùng luồng owner dán URL.

**Quyết định thiết kế:** (1) `autoRegisterWebhook` là điểm thay đổi duy nhất so với luồng thủ công hiện tại; ingest & channel handler hạ nguồn giữ nguyên. (2) Adapter connector **không** ghi trạng thái payment/charge ở feature này. (3) Tenant luôn từ opaque token, không bao giờ từ nội dung payload.

---

## 2. Database Schema + Edge Cases (BE)

### Schema

```sql
-- (NEW) Credential mức "kết nối" cho SePay (OAuth/API token fallback) / ApiPay (enterprise/BYO)
CREATE TABLE provider_connections (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES tenants(id),
  provider           text NOT NULL CHECK (provider IN ('sepay','apipay')),
  auth_mode          text NOT NULL CHECK (auth_mode IN ('oauth2','api_token','api_key','enterprise')),
  access_token_enc   bytea,                 -- SePay OAuth (KMS)
  refresh_token_enc  bytea,                 -- SePay OAuth (KMS)
  provider_api_token_enc bytea,              -- SePay outbound API-token fallback (KMS)
  scope              text,
  token_expires_at   timestamptz,
  api_access_key_enc bytea,                 -- ApiPay BYO api_key (KMS)
  api_secret_key_enc bytea,                 -- ApiPay BYO api_key (KMS)
  status             text NOT NULL DEFAULT 'connecting'
                     CHECK (status IN ('connecting','registered','active','drift','error','revoked')),
  last_error_code    text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, provider),
  -- Shape ĐẦY ĐỦ theo (provider, auth_mode) — enforce mọi credential column + chặn cặp không hỗ trợ:
  CHECK (
    -- SePay OAuth2: access token bắt buộc; KHÔNG có ApiPay key columns
    (provider = 'sepay'  AND auth_mode = 'oauth2'
       AND access_token_enc   IS NOT NULL
       AND provider_api_token_enc IS NULL
       AND api_access_key_enc IS NULL AND api_secret_key_enc IS NULL)
    OR
    -- SePay outbound API-token fallback: separate mode/column; never confuse with inbound webhook Api_Key.
    (provider = 'sepay' AND auth_mode = 'api_token'
       AND provider_api_token_enc IS NOT NULL
       AND access_token_enc IS NULL AND refresh_token_enc IS NULL
       AND api_access_key_enc IS NULL AND api_secret_key_enc IS NULL)
    OR
    -- ApiPay BYO api_key: cả access + secret key bắt buộc; KHÔNG có OAuth columns
    (provider = 'apipay' AND auth_mode = 'api_key'
       AND api_access_key_enc IS NOT NULL AND api_secret_key_enc IS NOT NULL
       AND access_token_enc   IS NULL AND refresh_token_enc IS NULL
       AND provider_api_token_enc IS NULL)
    OR
    -- ApiPay ENTERPRISE: MỌI credential column NULL (credential ở platform/KMS, không per-tenant)
    (provider = 'apipay' AND auth_mode = 'enterprise'
       AND access_token_enc   IS NULL AND refresh_token_enc  IS NULL
       AND provider_api_token_enc IS NULL
       AND api_access_key_enc IS NULL AND api_secret_key_enc IS NULL)
    -- Mọi cặp (provider, auth_mode) khác → vi phạm CHECK (fail-closed)
  )
);
-- ApiPay ENTERPRISE (DD-30 · Phase-1 primary): credential enterprise của PLATFORM lấy từ
-- secret-manager/KMS ở runtime (KHÔNG lưu trong provider_connections). Row enterprise chỉ
-- ánh xạ tenant → bank_account đã auto-provision; các cột *_enc = NULL. Auth webhook vẫn
-- verify per-tenant (token + account) như §receiver.

-- (NEW) Giao dịch OAuth ngắn hạn — PKCE + state, KHÔNG dựa cookie (§4.3)
CREATE TABLE oauth_transactions (
  state             text PRIMARY KEY,
  tenant_id         uuid NOT NULL REFERENCES tenants(id),
  provider          text NOT NULL CHECK (provider IN ('sepay')),
  code_verifier_enc bytea NOT NULL,          -- PKCE verifier (KMS)
  redirect_uri      text NOT NULL,
  created_by        uuid NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  expires_at        timestamptz NOT NULL     -- created_at + 10m
);

-- OAuth bootstrap table: KHÔNG tenant-RLS theo app.tenant_id vì callback
-- chưa có cookie/tenant context. Runtime app không được SELECT trực tiếp.
-- Chỉ expose SECURITY DEFINER functions với search_path cố định:
--   create_oauth_transaction(...)   -- gọi từ TenantOwner đã auth
--   consume_oauth_transaction(state) -- callback lookup-by-state, SELECT FOR UPDATE,
--                                      -- TTL check, DELETE single-use, return tenant_id+verifier

-- (ALTER) bank_accounts: gắn connection + metadata auto-register (schema gốc: payment_reconcile_tech §2)
ALTER TABLE bank_accounts
  ADD COLUMN provider_connection_id uuid REFERENCES provider_connections(id),
  ADD COLUMN provider_webhook_id    text,   -- SePay webhook id (int→text) / ApiPay wh_xxx
  ADD COLUMN provider_bank_ref      text,   -- SePay bank_account_id / ApiPay bankPublicId
  ADD COLUMN auto_registered        boolean NOT NULL DEFAULT false,
  ADD COLUMN webhook_auth_mode      text CHECK (webhook_auth_mode IN ('hmac_sha256','api_key')),
  ADD COLUMN webhook_status         text NOT NULL DEFAULT 'connecting'
             CHECK (webhook_status IN ('connecting','registered','active','drift','error','revoked')),
  ADD COLUMN last_register_at       timestamptz;

ALTER TABLE bank_accounts
  ADD CONSTRAINT bank_accounts_auto_auth_mode_chk
  CHECK (NOT auto_registered OR webhook_auth_mode IS NOT NULL);

-- Backfill TK webhook thủ công đang chạy trước auto-register.
UPDATE bank_accounts
SET webhook_status = CASE WHEN active THEN 'active' ELSE 'revoked' END,
    auto_registered = false
WHERE provider_connection_id IS NULL
  AND webhook_token IS NOT NULL
  AND webhook_secret_enc IS NOT NULL;

-- LIVE từ migration 0004: lifecycle/rotation columns và status vocabulary
-- connecting|registered|active|drift|error|revoked đã tồn tại; không add lại.

-- TARGET forward migration: choose next available monotonic number after
-- syncing merged prerequisites (`0014_players_waitlist` merged on main at 1a6ac38; verify current tail at packages/db/migrations/ at author time, do not hard-pin);
-- remove legacy plaintext verification secret.
ALTER TABLE zalo_bots ADD COLUMN webhook_secret_enc bytea;

-- Application migration MUST KMS/envelope-encrypt each legacy `secret` value.
-- Rows that cannot be proved/backfilled become status='error', receive no webhook
-- traffic and require owner reconnect. Do not byte-copy plaintext into `_enc`.
ALTER TABLE zalo_bots ADD CONSTRAINT zalo_bots_webhook_secret_ready_chk
  CHECK (webhook_secret_enc IS NOT NULL OR status IN ('connecting','error','revoked'))
  NOT VALID;
ALTER TABLE zalo_bots VALIDATE CONSTRAINT zalo_bots_webhook_secret_ready_chk;
ALTER TABLE zalo_bots DROP COLUMN secret;
```

`webhook_token` remains a random opaque lookup value and is not an authentication secret. Runtime resolves the tenant-bound endpoint through a narrow accessor, requires ciphertext and status `connecting|registered|active|drift`, KMS-decrypts `webhook_secret_enc` only for timing-safe header verification, and never returns/logs/caches plaintext. A `connecting` row without ciphertext plus every `error|revoked` row fails closed. After cutover there is no dual-read of legacy `secret`.

`provider_connections`, `bank_accounts` (đã có), `zalo_bots` (đã có) đều tenant-scoped với **ENABLE + FORCE RLS** dùng `app.tenant_id` (BL-TEN-1). `oauth_transactions` là ngoại lệ bootstrap: direct table access bị revoke khỏi runtime role; callback dùng SECURITY DEFINER `consume_oauth_transaction(state)` để lookup-by-state single-use trước khi set `app.tenant_id`, sau đó mọi ghi tenant-scoped quay lại RLS thường.

> **Vocabulary status** (product §3.1): `connecting → registered`(Tier 1) `→ active`(Tier 2); `drift`/`error`/`revoked`. `provider_connections.status` chỉ do connector lifecycle service ghi: direct provider events (connect/retry/revoke/OAuth refresh) set provider-level state; sau mỗi child update, service recompute rollup từ `bank_accounts.webhook_status` theo product §3.1.1. Không update raw table từ webhook/job/UI ngoài service này.

### Migration & Rollback

**Baseline đã live — reuse, không recreate:** `provider_connections`, `oauth_transactions`, `zalo_bots` (+`zalo_reply_contexts`) đã tồn tại từ `0004_channels_connectors.sql`; các cột connector trên `bank_accounts` (`provider_connection_id`, `provider_webhook_id`, `provider_bank_ref`, `auto_registered`, `webhook_status`, `last_register_at`) đã có sẵn từ `0003_payments_ledger.sql` (FK wire ở `0004`); RLS/grant ở `0009` và SECURITY DEFINER cho `oauth_transactions` ở `0010`. Phần DDL `(NEW)`/`(ALTER)` ở trên với các object này mô tả contract, không phải lệnh chạy lại; DROP bảng baseline = ❌ NEVER.

**Genuinely new (chưa land trên main) → migration mới monotonic:**

1. `provider_connections`: mở CHECK `auth_mode` từ live `('oauth2','api_key')` sang `('oauth2','api_token','api_key','enterprise')` + cột `provider_api_token_enc` + full credential-shape CHECK theo `(provider, auth_mode)` (§2).
2. `bank_accounts`: cột `webhook_auth_mode` + CHECK `bank_accounts_auto_auth_mode_chk` (live chưa có) + backfill `webhook_status` cho TK webhook thủ công.
3. `zalo_bots`: `webhook_secret_enc` + ready CHECK + DROP legacy `secret` theo trình tự KMS backfill-or-disable đã pin ở TARGET block trên.

Chọn **next available monotonic number** sau khi sync mọi prerequisite đã merge; không sửa migration lịch sử (`0003`/`0004`).

**Rollback:**

| Bước | Hành động | An toàn? |
|------|-----------|----------|
| 1 | Disable endpoints connect/provision/register + jobs §4.4 và tắt receiver enablement mới trước khi revert schema | ✅ |
| 2 | Migration revert mới: drop cột/CHECK vừa thêm, restore CHECK `auth_mode` cũ | ✅ Additive-only revert (row đã dùng mode mới phải revoke/reconnect trước) |
| 3 | Khôi phục plaintext `zalo_bots.secret` sau khi đã DROP | ❌ KHÔNG THỂ — plaintext đã xóa theo BL-SEC-1; connector phải owner reconnect |
| 4 | DROP `provider_connections`/`oauth_transactions`/`zalo_bots`/`bank_accounts` baseline | ❌ NEVER — chứa credential/lịch sử thật |

### Indexes

- `provider_connections (status)` và `(token_expires_at) WHERE auth_mode='oauth2'` — cho job refresh token.
- `bank_accounts (provider_connection_id)`; `(webhook_status) WHERE webhook_status IN ('connecting','registered')` — cho recheck pending / drift.
- `oauth_transactions (expires_at)` — sweep hết hạn.
- `zalo_bots (webhook_token)` — lookup webhook (đã cần ở routing).
- Đã có: `bank_accounts.webhook_token UNIQUE`, `bank_transactions (tenant,provider,external_id) UNIQUE`.

### Edge Cases (Backend)

| # | Category | Case | Xử lý |
|---|----------|------|-------|
| 1 | Security | Tenant suy từ nội dung payload | ❌ NEVER — chỉ `:token`→`webhook_token`, rồi verify `account_fingerprint` (BL-PAY-6) |
| 2 | Security | HMAC verify trên JSON re-serialize | Dùng **raw body** (§4.5); SePay signed input còn gồm exact timestamp prefix; test payload unicode/space lạ |
| 3 | Security | Forged/unknown webhook token | 401, verify secret timing-safe, không persist (BL-SEC-2) |
| 4 | Security | `state` giả/replay ở OAuth callback | `OAUTH_STATE_INVALID`; state single-use, TTL 10', thiếu state → từ chối |
| 5 | Security | Secret/token rò ra log | KMS at-rest, redaction; chỉ lưu `last_error_code` (BL-SEC-1) |
| 6 | Concurrency | 2 lần "Kết nối" đồng thời | `UNIQUE(tenant,provider)` + upsert; chỉ 1 webhook đăng ký |
| 7 | Concurrency | Event đến trước khi `registered` commit | Chỉ `connecting` + ciphertext được verify; hợp lệ → CAS `connecting→active`. Register finalization CAS `connecting→registered` và preserve `active`; thiếu ciphertext/`error|revoked` reject |
| 8 | Concurrency | Replay event nhà cung cấp | Flip Tier 2 idempotent; ingest dedup `(tenant,provider,external_id)` |
| 9 | Data Integrity | Provider tạo webhook OK nhưng DB commit fail | Lưu `provider_webhook_id` cùng transaction; lệch → job `connectors/cleanup-orphan-webhook` gọi `DELETE` webhook mồ côi |
| 10 | Data Integrity (ApiPay) | TK `PENDING`/`manualActivationPending` | Không register; `webhook_status='connecting'`; job `connectors/recheck-pending-bank` (≤24h) |
| 11 | Data Integrity | Drift — owner đổi URL ở dashboard | `security/webhook-drift` (hourly) → auto re-register; fail → `drift`/alert |
| 12 | Token lifecycle | SePay refresh token hết hạn/refresh fail | `status='error'` + nhắc kết nối lại; **không** ảnh hưởng connection/TK khác |
| 13 | Token lifecycle | ApiPay BYO key bị thu hồi bên ngoài | Delivery fail liên tục → `error` + alert; runbook rotate (enterprise credential có platform-level rotation/audit riêng) |
| 14 | Cross-Feature | Gỡ connector | revoke OAuth / `DELETE webhook` → `status='revoked'`; **giữ** lịch sử `bank_transactions` |
| 15 | Cross-Feature | `BANK_ALREADY_BOUND` (fingerprint trùng tenant khác) | 409, không bind; tránh route nhầm tenant |
| 16 | Abuse | Spam `*/connect` dò key | Rate limit BL-SEC-5 (§3) |
| 17 | Security | SePay HMAC stale/future timestamp, bad signature hoặc missing header | 401 trước parse/persist; no auth downgrade |
| 18 | Security | SePay API-key fallback header sai | Chỉ exact `Authorization: Apikey <key>` constant-time; reject bare/custom header |

---

## 3. API Contract

### Endpoints nội bộ (nâng cấp `/api/onboarding/*`)

| Method | Path | Auth | Mô tả |
|--------|------|------|-------|
| POST | `/api/onboarding/sepay/oauth/start` | TenantOwner (cookie+CSRF) | Tạo `oauth_transactions` (state+PKCE) → trả authorize URL |
| GET  | `/api/onboarding/sepay/oauth/callback` | **state-bound (PKCE), KHÔNG cookie** | `consume_oauth_transaction(state)` SECURITY DEFINER → exchange token → `GET /api/v1/bank-accounts` → rotate session |
| POST | `/api/onboarding/sepay/webhooks/register` | TenantOwner | `POST /api/v1/webhooks` cho TK đã chọn (contract product §4.2.2) |
| POST | `/api/onboarding/sepay/token/connect` | TenantOwner | Explicit outbound fallback: persist KMS token under `auth_mode='api_token'`, then register webhook; no auth-mode downgrade |
| POST | `/api/onboarding/apipay/provision` | TenantOwner | **Phase-1 primary:** platform enterprise credential provision/bind bank+webhook riêng của host; client không gửi platform secret |
| POST | `/api/onboarding/apipay/connect` | TenantOwner | **Explicit BYO fallback:** accessKey+secretKey → `GET /v2/client/banks` (lọc `ACTIVE`) |
| POST | `/api/onboarding/apipay/webhooks/register` | TenantOwner | **BYO fallback:** `POST /v1/client/webhooks` cho TK `ACTIVE` đã chọn |
| POST | `/api/onboarding/zalo/connect` 🟡 | TenantOwner | *(blocked CO-OQ-1)* bot token → `getMe` → `setWebhook` |
| GET  | `/api/onboarding/connectors/status` | TenantOwner | Status từng connector theo vocabulary §2 |
| DELETE | `/api/onboarding/connectors/:provider` | TenantOwner | Gỡ kết nối (revoke + delete webhook → `revoked`) |

### `POST /api/onboarding/apipay/provision` — enterprise primary contract

**Headers:** cookie session + CSRF của TenantOwner; `Idempotency-Key: <UUID>` bắt buộc. Key được persist theo `(tenant_id, route, key)` cùng `request_hash` và response canonical; không chỉ giữ trong memory/cache.

```jsonc
// Request
{
  "bankSelectionRef": "bsr_opaque_server_issued",
  "consent": true
}

// 201 lần đầu; retry cùng key + cùng body trả 200 với đúng các ID này
{
  "provider": "apipay",
  "authMode": "enterprise",
  "connectionId": "uuid",
  "bankAccountId": "uuid",
  "status": "registered",
  "verifyHint": "Chuyển khoản thử để xác minh"
}
```

- `bankSelectionRef` là reference opaque, TTL ngắn, do server cấp sau flow host chọn/xác nhận TK theo cơ chế enterprise đã được ApiPay phê duyệt; nó bound với tenant + owner + bank selection. Nó **không** phải accessKey/secretKey, platform credential, số TK thô hay provider webhook secret. Nếu enterprise contract thực tế không cung cấp được reference tương đương, HALT production mapping và xác nhận lại provider request shape; không tự mở input PII/secret mới.
- Request schema `additionalProperties=false`: reject mọi field credential/secret ngoài shape trên. `consent` phải đúng `true`; resolve ref + authorization + TTL trước provider I/O.
- Handler lock logical `(tenant_id, provider='apipay')`, upsert `provider_connections.auth_mode='enterprise'`, rồi provision/bind bank + webhook. Provider-side replay phải dùng **một cơ chế đã được enterprise contract chứng minh**: stable derived idempotency key nếu provider hỗ trợ, hoặc exact lookup/reuse bằng deterministic provision ref. Không có cơ chế nào → trả `APIPAY_ENTERPRISE_UNAVAILABLE`, không gọi create mù sau timeout. Enterprise credential chỉ đọc từ platform KMS, không lưu vào tenant row, response, analytics hay log.
- Provider success + DB commit fail đi qua orphan cleanup §4.2; retry cùng key phải reuse provider resource/response, không tạo bank/webhook thứ hai. Cùng key nhưng body hash khác → `409 IDEMPOTENCY_KEY_REUSED` trước provider call.
- Tenant đã có compatible enterprise binding → trả resource hiện hữu. Muốn đổi bank hoặc đổi `enterprise ↔ api_key` phải qua replace/revoke flow explicit; endpoint không silently downgrade sang BYO.
- Enterprise unavailable/unsupported chỉ trả error có type để UI hiện CTA **"Dùng ApiPay key riêng"**; BYO endpoints không được gọi tự động.

### Webhook receiver (provider-initiated)

| Method | Path | Verify (timing-safe trên RAW body) | Delegate |
|--------|------|-----------------------------------|----------|
| POST | `/webhook/sepay/:token` | Default `hmac_sha256`: `X-SePay-Signature=sha256=<hex>` over `{X-SePay-Timestamp}.{rawBody}`, freshness ±300s. Explicit fallback `api_key`: exact `Authorization: Apikey <key>` | bank_transactions ingest |
| POST | `/webhook/apipay/:token` | `ApiPay-Signature` == HMAC-SHA256(rawBody, `webhook_secret`) | bank_transactions ingest |
| POST | `/webhook/zalo/:token` 🟡 | Narrow endpoint resolve → require ciphertext + `connecting|registered|active|drift` → KMS-decrypt `zalo_bots.webhook_secret_enc` → timing-safe compare `X-Bot-Api-Secret-Token`; `connecting` without ciphertext plus `error|revoked` fail closed; no plaintext fallback | channel event handler |

### Rate Limits (BL-SEC-5)

| Endpoint | Limit |
|----------|-------|
| `*/connect`, `*/provision`, `*/webhooks/register` (gọi provider API) | 5 / 10 phút / tenant |
| `*/oauth/start`, `*/oauth/callback` | 10 / phút / IP |
| `DELETE /connectors/:provider` | 5 / phút / tenant |
| `POST /webhook/{provider}/:token` | Không áp app-level user limit; edge per-token/IP burst cap + body-size cap theo `deployment-infra.md §6` (sized ≥100/s/token target) |

### Error Codes

| HTTP | Error Code | Message (VI) | Trigger |
|------|-----------|--------------|---------|
| 400 | `APIPAY_BANK_SELECTION_INVALID` | "Phiên chọn tài khoản không hợp lệ hoặc đã hết hạn" | ref sai tenant/owner, expired, consent thiếu hoặc request có field ngoài schema |
| 409 | `IDEMPOTENCY_KEY_REUSED` | "Yêu cầu này đã được dùng cho dữ liệu khác" | cùng idempotency key, request hash khác |
| 422 | `APIPAY_ENTERPRISE_BANK_UNSUPPORTED` | "Ngân hàng này chưa được hỗ trợ tự động" | enterprise không phủ bank; UI có thể mời BYO |
| 502 | `APIPAY_ENTERPRISE_PROVISION_FAILED` | "Chưa thể thiết lập ApiPay, vui lòng thử lại" | provider create/bind fail; retry cùng key |
| 503 | `APIPAY_ENTERPRISE_UNAVAILABLE` | "Kết nối tự động tạm chưa sẵn sàng" | platform KMS credential/enterprise release gate unavailable; UI có thể mời BYO |
| 401 | `APIPAY_KEY_INVALID` | "accessKey/secretKey không đúng" | `GET /v2/client/banks` 401 |
| 409 | `APIPAY_BANK_NOT_ACTIVE` | "Tài khoản chưa kích hoạt, vui lòng đợi" | bank `PENDING`/`manualActivationPending` |
| 502 | `PROVIDER_WEBHOOK_REGISTER_FAILED` | "Đăng ký webhook thất bại" | provider API lỗi → fallback |
| 401 | `SEPAY_OAUTH_DENIED` | "Bạn chưa cấp quyền cho Plexco" | OAuth deny/timeout |
| 400 | `OAUTH_STATE_INVALID` | "Phiên kết nối hết hạn, thử lại" | state không khớp/đã dùng/hết hạn |
| 400 | `ZALO_TOKEN_INVALID` 🟡 | "Token bot không hợp lệ" | `getMe` fail |
| 409 | `CONNECT_SUPERSEDED` | "Một lần kết nối mới hơn đã thay thế lần này." | `zalo/connect`: một lần connect mới hơn đã thay webhook token của lần này (DD-126; `COMMAND_ID_CONFLICT` chỉ dành cho `commandId` đã thuộc command khác) |
| 409 | `BANK_ALREADY_BOUND` | "TK ngân hàng đã gắn ở CLB khác" | fingerprint trùng tenant khác |
| 401 | `INVALID_WEBHOOK_SECRET` | — (không trả nội dung) | verify webhook fail |
| 429 | `RATE_LIMITED` | "Thao tác quá nhanh, thử lại sau" | vượt BL-SEC-5 |

### Request/Response Examples

> Minh hoạ theo contract đã pin; envelope chuẩn DD-60 (`../../standards/api-reference-convention.md` §1.1) áp cho **app-facing routes** (`/api/onboarding/*`). Payload request/response của `apipay/provision` đã pin nguyên khối ở trên — không lặp lại; field name DTO chưa pin sẽ chốt ở build slice.

**GET `/api/onboarding/connectors/status`** — `200` (field name minh hoạ theo vocabulary §2):

```json
{ "data": { "connectors": [ { "provider": "apipay", "status": "active" }, { "provider": "sepay", "status": "connecting" } ] }, "error": null, "meta": { "requestId": "req_…" } }
```

**OAuth callback state sai/hết hạn** — `400`:

```json
{ "data": null, "error": { "code": "OAUTH_STATE_INVALID", "message": "Phiên kết nối hết hạn, thử lại", "statusCode": 400 }, "meta": { "requestId": "req_…" } }
```

**Webhook receiver** (`POST /webhook/{provider}/:token`) — trả theo **provider contract**, KHÔNG áp envelope DD-60:

- `401 INVALID_WEBHOOK_SECRET` — verify fail (timing-safe, trước parse/persist); không trả nội dung (bảng Error Codes).
- Replay event: flip Tier 2 idempotent; duplicate ingest dedup `(tenant, provider, external_id)` — HTTP mapping duplicate `200` theo ingest contract `feature_payment_reconcile_tech.md` §3.

### Idempotency

| Endpoint | Idempotent? | Key |
|----------|-------------|-----|
| `*/webhooks/register` | ✅ | `(tenant_id, provider, provider_bank_ref)` — đã có `provider_webhook_id` thì reuse |
| `apipay/provision` | ✅ | required `(tenant_id, route, Idempotency-Key)` + request hash + persisted canonical response; provider replay dùng verified idempotency key hoặc exact deterministic lookup/reuse; thiếu cả hai thì path fail-closed unavailable; same key/different body → 409 |
| `apipay/connect` (BYO), `sepay/oauth/start` | ✅ | upsert `(tenant_id, provider)` |
| `oauth/callback` | ✅ | `state` single-use (xóa sau exchange) |
| `zalo/connect` 🟡 | ✅ | `(tenant_id)` — `zalo_bots` UNIQUE(tenant) |
| Webhook ingest | ✅ | `(tenant, provider, external_id)` (delegate payment ingest) |
| Flip Tier 2 | ✅ | CAS `UPDATE ... WHERE status IN ('connecting','registered') RETURNING`; emit analytics only when one row transitions. `active` is idempotent; `drift` is processed without clearing drift; `error|revoked` reject |

---

## 4. Chi tiết triển khai

### 4.1 State machine (impl — product §3.3)

| Từ | Sự kiện | Đến | Side-effect |
|----|---------|-----|-------------|
| `connecting` | validate + autoRegister OK | `registered` | CAS only if still `connecting`; lưu `provider_webhook_id`, `last_register_at`, `auto_registered=true`; if early event already set `active`, update metadata without status downgrade |
| `connecting` | verified event arrives before register finalization | `active` | requires ciphertext; CAS once + emit `connector_verified`; later finalization preserves `active` |
| `connecting` | validate/register fail | `error` | `last_error_code`; giữ credential cho retry |
| `registered` | event thật đầu tiên | `active` | emit `connector_verified` (1 lần) |
| `active` | drift cron URL lệch | `drift` | thử re-register |
| `drift` | re-register OK | `registered` | `last_setwebhook_at` |
| `drift` | re-register fail | `error` | alert owner |
| `error` | owner retry | `connecting` | — |
| `*` | owner gỡ | `revoked` | revoke OAuth / DELETE webhook |

### 4.2 Auto-register (2-phase, chống mồ côi)

```text
BEGIN
  upsert provider_connections / bank_accounts (status=connecting)
COMMIT                          -- credential bền trước
call provider create-webhook    -- ngoài transaction (I/O)
BEGIN
  set provider_webhook_id, last_register_at, auto_registered=true
  status = CASE WHEN status='connecting' THEN 'registered' ELSE status END
  WHERE status IN ('connecting','registered','active') -- never downgrade early active
COMMIT
-- nếu create-webhook OK nhưng commit-2 fail → job cleanup-orphan-webhook
--   so khớp provider list (GET webhooks) vs provider_webhook_id → DELETE cái thừa
```

### 4.3 OAuth state/PKCE (SePay)

- `start`: sinh `state` (≥128-bit) + `code_verifier`/`code_challenge` (S256), lưu `oauth_transactions` (TTL 10') qua `create_oauth_transaction(...)`, redirect authorize.
- `callback`: top-level GET từ SePay → **không** có cookie `sameSite=strict`. Gọi SECURITY DEFINER `consume_oauth_transaction(state)` (search_path cố định, `SELECT FOR UPDATE`, TTL check, `DELETE` single-use) → `tenant_id` + `code_verifier`; exchange `authorization_code`+verifier → token; sau đó `SET LOCAL app.tenant_id` và ghi tenant-scoped bình thường; rotate/khôi phục session rồi về wizard.

### 4.4 Jobs (pg-boss)

| Queue | Cadence | Việc |
|-------|---------|------|
| `security/webhook-drift` | hourly (mở rộng từ zalo §7) | `getWebhookInfo`/list webhooks → URL lệch → auto re-register; fail → `drift`+alert |
| `connectors/oauth-refresh` | mỗi 15' | refresh SePay access token khi còn `< 5'` tới `token_expires_at`; fail → `error` |
| `connectors/recheck-pending-bank` | mỗi 30' (tối đa 24h/TK) | ApiPay `GET /v2/client/banks` → TK `ACTIVE` → register webhook |
| `connectors/cleanup-orphan-webhook` | mỗi 15' | xóa webhook tạo ở provider nhưng không có `provider_webhook_id` khớp |

### 4.5 Raw-body verify

```typescript
app.use("/webhook", express.json({
  verify: (req, _res, buf) => { (req as any).rawBody = buf; },   // giữ Buffer thô
}));

function verifyHmacSha256(req, secret: string): boolean {        // ApiPay
  const sig = req.header("ApiPay-Signature") ?? "";
  const expected = crypto.createHmac("sha256", secret).update(req.rawBody).digest("hex");
  const a = Buffer.from(sig), b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function verifySepayHmac(req, secret: string): boolean {
  const ts = req.header("X-SePay-Timestamp") ?? "";
  const sig = req.header("X-SePay-Signature") ?? "";
  if (!/^\d+$/.test(ts) || Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;
  const expected = "sha256=" + crypto.createHmac("sha256", secret)
    .update(Buffer.concat([Buffer.from(`${ts}.`), req.rawBody]))
    .digest("hex");
  const a = Buffer.from(sig), b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
```

### 4.6 Timeout/Expiry Spec

| Variant | Giá trị | Lý do |
|---------|---------|-------|
| `oauth_transactions` TTL | 10 phút | chống replay, đủ cho consent |
| SePay token refresh ngưỡng | còn < 5 phút | tránh gián đoạn webhook/poll |
| Drift cron | 1 giờ | theo §7 hiện hữu |
| ApiPay pending recheck | 30 phút, dừng sau 24h | manual activation ≤ 24h |
| Provider API call | timeout 10s, 1 retry (backoff) | provider chậm, tránh treo onboarding |

### 4.7 Caching

| Data | Cache? | TTL | Invalidation |
|------|--------|-----|-------------|
| Danh sách bank (provider) khi chọn TK | ✅ in-request | 60s | sau khi register |
| Access/refresh token, secret | ❌ | — | luôn đọc enc từ DB |
| `connectors/status` | ❌ | — | đọc trực tiếp (số connector nhỏ) |

### 4.8 Security Checklist (template v2.33 — map về section đã pin)

| Mục | Trả lời trong spec |
|-----|---------------------|
| Authorization/ownership | §3: mọi endpoint onboarding = TenantOwner (cookie+CSRF); callback OAuth = state-bound PKCE qua SECURITY DEFINER `consume_oauth_transaction` (§4.3); tenant từ `:token` opaque, không bao giờ từ payload (edge #1, BL-PAY-6) |
| Injection/validation | §4.5: verify trên raw body trước parse/persist; `apipay/provision` schema `additionalProperties=false`, reject field credential/secret lạ (edge #2, tests 4–5, 28) |
| Secret & log redaction | BL-SEC-1: mọi credential KMS at-rest (`*_enc`), log chỉ `last_error_code` (edge #5, tests 21/33); platform enterprise credential chỉ ở KMS, không vào tenant row/response/log |
| Webhook signature + replay | §3 receiver + §4.5: HMAC-SHA256 raw-body timing-safe; SePay freshness ±300s + `sha256=` + no-downgrade; ApiPay header riêng; Zalo KMS ciphertext + state matrix (edge #2/#3/#17/#18, tests 25–26/36) |
| Idempotency | Bảng Idempotency §3 (per-endpoint keys + CAS flip Tier 2) |
| Data retention/xoá | Revoke connector giữ lịch sử `bank_transactions` (edge #14); retention/erasure per-table chưa pin ở doc này — theo `feature_security_operations_tech.md` |

---

## 5. Testing Plan

### Unit Tests

| # | Test | Input | Expected |
|---|------|-------|----------|
| 1 | Webhook route đúng tenant | token hợp lệ | tenant đúng |
| 2 | Forged token | token lạ | 401 |
| 3 | HMAC ApiPay đúng (raw) | payload + chữ ký đúng | pass |
| 4 | HMAC sai khi re-serialize | verify trên JSON.stringify | fail → bắt buộc dùng rawBody |
| 5 | HMAC payload unicode/space | nội dung có dấu | pass với rawBody |
| 6 | SePay HMAC verify | fresh timestamp + raw payload + correct `sha256=` signature | pass; reserialize/stale/future/bad/missing → 401 before persist |
| 7 | `validate()` ApiPay key sai | 401 từ `/v2/client/banks` | `APIPAY_KEY_INVALID` |
| 8 | Lọc bank ACTIVE | mix ACTIVE/PENDING | chỉ register ACTIVE |
| 9 | Bank PENDING | `manualActivationPending=true` | `APIPAY_BANK_NOT_ACTIVE`, enqueue recheck |
| 10 | SePay build webhook body | club ctx | đủ field bắt buộc + production `authen_type=HMAC_SHA256` + `secret_key`; explicit fallback alone uses `Api_Key` + `api_key` |
| 11 | Auto-register lưu webhook id | create OK | `provider_webhook_id` set, `registered` |
| 12 | Orphan cleanup | commit-2 fail | webhook bị DELETE |
| 13 | OAuth state hợp lệ | state khớp | exchange OK |
| 14 | OAuth state replay/expired | state đã dùng/hết hạn | `OAUTH_STATE_INVALID` |
| 15 | PKCE verifier sai | verifier lệch challenge | exchange fail |
| 16 | Token refresh ngưỡng | hết hạn < 5' | refresh gọi |
| 17 | Refresh fail | refresh token revoked | `status=error`, không ảnh hưởng TK khác |
| 18 | Flip Tier 2 idempotent | 2 event đầu | `active` 1 lần, analytics 1 lần |
| 19 | Idempotent register | gọi 2 lần | reuse `provider_webhook_id`, không tạo trùng |
| 20 | `BANK_ALREADY_BOUND` | fingerprint trùng tenant khác | 409 |
| 21 | Secret không vào log | trigger error | log chỉ `last_error_code` |
| 22 | Revoke connector | DELETE | webhook xóa, `revoked`, lịch sử txn giữ |
| 23 | Drift auto re-register | URL lệch | re-register → `registered` |
| 24 | Rate limit connect | spam | `RATE_LIMITED` |
| 25 | SePay API-key fallback exact header | `Authorization: Apikey <key>` vs bare/custom scheme | exact passes constant-time; all variants reject |
| 26 | No downgrade | HMAC configured but invalid signature with valid-looking API key | 401; verifier never tries alternate mode |
| 27 | SePay outbound token shape | `provider='sepay', auth_mode='api_token'` | Only `provider_api_token_enc` present; OAuth/ApiPay credential columns NULL; unsupported mixed shapes fail CHECK |
| 28 | ApiPay enterprise request shape | valid ref+consent vs secret/accessKey/extra field | valid accepted; unknown/credential fields rejected before provider call |
| 29 | ApiPay enterprise ref boundary | expired, wrong-tenant, wrong-owner refs | `APIPAY_BANK_SELECTION_INVALID`; no provider I/O |
| 30 | ApiPay enterprise idempotent retry | same key+body twice, including timeout after provider success | same connection/bank/webhook IDs; one provider resource |
| 31 | ApiPay idempotency conflict | same key, different `bankSelectionRef` | `IDEMPOTENCY_KEY_REUSED`; no second provider call |
| 32 | ApiPay enterprise fallback is explicit | provider unavailable/unsupported | typed error only; BYO handler is not invoked until owner selects fallback |
| 33 | ApiPay platform secret boundary | success/error/log/tenant row snapshot | no platform credential or webhook secret in response/log/tenant credential columns |
| 34 | ApiPay provider replay gate | enterprise contract has neither idempotency key nor exact deterministic lookup | `APIPAY_ENTERPRISE_UNAVAILABLE` before create; no blind retry/provision |
| 35 | Zalo legacy secret migration | backfillable and unprovable legacy rows | KMS ciphertext written for valid row; unprovable row becomes `error`; constraint validates; plaintext column/value removed; no dual-read |
| 36 | Zalo receiver state/ciphertext matrix | every status × ciphertext present/absent | only `connecting|registered|active|drift` with ciphertext may verify; all missing-secret and `error|revoked` cases reject |
| 37 | Zalo early-event CAS | event wins between provider registration and DB finalization | exactly one `connecting→active`; finalization writes metadata but preserves `active`; analytics once |
| 38 | Zalo repeated finalization/event | registered/active/drift plus duplicate event | no `active→registered`, no drift clear, no duplicate analytics or provider/domain mutation |

### Integration Tests

| # | Test | Setup | Expected |
|---|------|-------|----------|
| 1 | ApiPay enterprise E2E (primary) | selection ref → provision → webhook txn | `auth_mode='enterprise'`; riêng account/webhook host; `registered`→`active`; txn ingest 1 lần |
| 2 | ApiPay enterprise retry after crash | provider success, DB commit-2 fail, retry same key | provider idempotency/orphan reconciliation yields exactly one bound bank+webhook |
| 3 | ApiPay BYO E2E (fallback) | owner explicitly chooses BYO → connect → register → webhook txn | `auth_mode='api_key'`; `registered`→`active`; no enterprise row mutation |
| 4 | SePay OAuth E2E | start→callback→register→giả lập GD | token lưu, webhook tạo, `active` |
| 5 | OAuth không cookie | callback từ domain ngoài (no cookie) | vẫn thành công nhờ state/PKCE |
| 6 | 2 tenant cô lập | 2 connection, 2 token | routing độc lập, RLS không rò |
| 7 | Crash giữa register | kill sau create-webhook, trước commit-2 | cleanup-orphan dọn webhook thừa |
| 8 | ApiPay PENDING→ACTIVE (BYO) | bank kích hoạt sau | recheck job tự register |
| 9 | Enterprise bank unsupported → BYO handoff | provision trả 422, owner chọn fallback | không auto-downgrade; BYO form/endpoint chỉ mở sau action của owner |
| 10 | Zalo secret migration E2E | legacy plaintext rows → deploy forward migration → receive webhook | valid rows verify from KMS ciphertext; unprovable rows are non-routable `error`; plaintext column absent |
| 11 | Zalo register/event race E2E | pause connect after provider success; deliver signed event; resume finalization | final state `active`, metadata committed, one delivery/analytics event, no downgrade |

---

## 6. Rollout Plan + Changelog

### Rollout (khớp product §11)

1. **M1** — receiver verify 2 tầng + SePay/ApiPay raw-body HMAC; SePay freshness/no-downgrade; flip `active` khi event đầu.
2. **M2** — **ApiPay ENTERPRISE auto-provision per-host = Phase-1 PRIMARY (DD-30 ✅ · DD-02)**: platform giữ 1 credential enterprise, tự provision per-host (không bắt host tự lấy `api_key`); BYO `api_key` là fallback. Xử lý bank `PENDING`. *(rủi ro thấp nhất, giao trước)*
3. **M3** — SePay OAuth2 (cần partner CO-OQ-2) + state/PKCE + refresh job; fallback token mode; tùy chọn poll `/transactions`.
4. **M4** — Zalo auto `setWebhook` *(chỉ sau khi gỡ CO-OQ-1)*: land KMS backfill-or-disable/drop migration, state+ciphertext decision table and early-event CAS tests before receiver enablement; then drift auto re-register.
5. **M5** — dọn fallback, telemetry, ẩn dần luồng nhập tay.

### Metrics

Tỉ lệ connect không-chạm-webhook; `time_to_verify_ms` (registered→active) trung vị; tỉ lệ `connector_register_failed`; số drift auto-repair; số orphan-webhook dọn; tỉ lệ refresh fail. Log chỉ ID/`last_error_code`, không secret/raw payload.

### Definition of Done

- [ ] Schema/RLS/indexes + forward migration `zalo_bots` áp dụng: KMS-backfill-or-disable legacy rows, enforce encrypted secret, drop plaintext `secret`, không dual-read.
- [ ] Receiver/state decision table pass: only allowed status + ciphertext verifies; early event CAS cannot be downgraded by register finalization; analytics emits once.
- [ ] Verify webhook timing-safe **trên raw body** (test re-serialize fail).
- [ ] SePay production register dùng `HMAC_SHA256`; verify `{timestamp}.{raw_body}`, ±300s, `sha256=` format và no-downgrade. API-key fallback chỉ exact `Authorization: Apikey <key>`.
- [ ] `/api/onboarding/apipay/provision` là ApiPay phase-1 primary: request/response secret-free, ref bound tenant+owner, durable idempotency qua crash/retry, platform credential chỉ ở KMS.
- [ ] Enterprise unavailable/unsupported trả typed error và chỉ **mời** BYO; không tự gọi BYO hoặc đổi `auth_mode`.
- [ ] Auto-register idempotent + orphan cleanup pass crash test.
- [ ] OAuth state/PKCE, callback không phụ thuộc cookie, state single-use.
- [ ] ApiPay xử lý đúng `ACTIVE/PENDING/manualActivationPending`.
- [ ] Tenant isolation (RLS) + `BANK_ALREADY_BOUND` pass.
- [ ] Provider API fail → fallback, không chặn onboarding (B6).
- [ ] Acceptance criteria ở `../FE/feature_connector_onboarding.md` pass.

### Changelog

| Date | Version | Thay đổi |
|---|---|---|
| 2026-08-10 | v0.10 | **A-grade upgrade:** thêm Entry points table (8 entries); bump version. Không đổi contract/pipeline model. |
| 2026-07-28 | v0.9 | Re-pin current availability/runtime boundary to `main@784bc8d`; provider enum and unregistered/disabled connector-job status remain unchanged. |
| 2026-07-27 | v0.8 | Mirror regional provider boundary and implemented-but-unwired shared scheduler: no connector/payment jobs are registered or enabled; entitlement remains separate from capability availability. |
| 2026-07-24 | v0.7b | **De-pin migration-tail** (docs-migration-tail-0018-to-0020-sweep, round-01 codex expansion): TARGET-migration comment (§2 `zalo_bots`, L144) hard-pinned `tail = 0018` -> non-pinned "verify current tail at `packages/db/migrations/` at author time, do not hard-pin" (live tail now `0020`; `0019`/`0020` tenant-integrity FKs DD-68). Numbering guidance unchanged. Pre-existing dated changelog preserved verbatim. No contract change. |
| 2026-07-23 | v0.7a | **Reconcile 0014 merge-state:** current-state TARGET-migration comment (§2 `zalo_bots`) sửa → `0014_players_waitlist` **đã merge trên `main`** (`1a6ac38`, tail = 0018), trước ghi "branch-only today". Numbering guidance (next available monotonic number sau merged prerequisites) giữ nguyên. Pre-existing dated changelog giữ verbatim. Không đổi contract. |
| 2026-07-19 | v0.7 | **Template v2.30/v2.33 uplift:** thêm §2 Migration & Rollback (baseline `0003`/`0004` reuse; new = auth_mode mở rộng/`webhook_auth_mode`/`webhook_secret_enc`), §3 Request/Response Examples (DD-60 cho app routes; webhook theo provider contract), §4.8 Security Checklist. Idempotency (§3) và Caching (§4.7) đã có từ trước — giữ nguyên. Derivative/editorial — không đổi contract. |
| 2026-07-19 | v0.6a | Metadata sweep (index v2.35): thêm trường **Implementation** đồng bộ BUILD-STATUS (Not started). Không đổi contract. |
| 2026-07-17 | v0.6 | **Zalo secret/lifecycle closure:** mark lifecycle columns live; specify KMS backfill-or-disable/drop/no-dual-read; add one state+ciphertext decision table, CAS-safe early-event/finalization transitions and unit/E2E regressions. |
| 2026-07-17 | v0.5 | **ApiPay enterprise-primary closure:** add full `/api/onboarding/apipay/provision` request/response, tenant-bound opaque bank selection, platform-secret boundary, durable/provider idempotency, typed errors and primary-vs-BYO regression tests. |
| 2026-07-17 | v0.4 | **Credential-shape closure:** add explicit SePay outbound `api_token` fallback mode/column; keep it distinct from OAuth, ApiPay BYO `api_key`, enterprise mode and inbound webhook `Api_Key` auth. |
| 2026-07-17 | v0.3 | **SePay auth closure:** production HMAC_SHA256 registration, exact timestamp/raw-body verification, replay freshness, constant-time compare, explicit API-key fallback header and no-downgrade tests. |
| 2026-06-20 | v0.2 | Fix review: `rotation_pending` thay lifecycle state ngoài enum; `oauth_transactions` bootstrap qua SECURITY DEFINER lookup-by-state; backfill `bank_accounts.webhook_status`; định nghĩa owner/rollup của `provider_connections.status`; webhook receiver dùng edge per-token/body cap thay vì wording unbounded. |
| 2026-06-20 | v0.1 | BE tech spec đầu: provisioning + auto-register + verify 2 tầng + lifecycle (refresh/drift/recheck/cleanup); schema delta `provider_connections`/`oauth_transactions` + ALTER `bank_accounts`/`zalo_bots`; 16 edge cases; 24 unit + 6 integration tests. Delegate ingest→`payment_reconcile_tech`, channel→`zalo_channel_tech`. |
