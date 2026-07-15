# Feature: Connector Onboarding (Zalo · SePay · ApiPay) — Backend Tech Spec

> **Canonical phase:** P3 (payment ingest) · P4 (onboarding) · P4.7 (Zalo) — *cross-cutting*
> **Version:** 0.2 · 2026-06-20
> **Status:** Draft
> **Product spec:** `../feature_connector_onboarding.md`
> **References:** `../../product/TDD.md` §3.2/3.6 · `../../standards/business-rules.md` BL-PAY-6, BL-SEC-1/2, BL-TEN-1, BL-ID-6, BL-SEC-5 · `feature_payment_reconcile_tech.md` (ingest downstream) · `feature_zalo_channel_tech.md` (channel events downstream) · `feature_web_auth_onboarding_tech.md` (wizard) · `../../research/player-side-saas-AUDIT.md` §B2

---

## 1. Tổng quan triển khai

**Phạm vi feature này:** lớp *provisioning → auto-register webhook → verify 2 tầng → lifecycle* của kết nối. **KHÔNG** bao gồm: reconcile/matching giao dịch (xem `feature_payment_reconcile_tech.md`) và number-reply/reachability của Zalo (xem `feature_zalo_channel_tech.md`). Feature này thay **đường thiết lập** webhook (từ owner dán tay → Plexco gọi API), rồi **delegate** cho handler hạ nguồn đã có.

Hai pipeline:

```text
CONNECT (owner-initiated, trong onboarding wizard)
  credential {oauth2 | api_key | enterprise | bot_token}
    → validate()           [SePay: token exchange + /me · ApiPay BYO: GET /v2/client/banks · ApiPay enterprise: platform-credential auto-provision per-host (DD-30) · Zalo: getMe*]
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
-- (NEW) Credential mức "kết nối" cho SePay (OAuth) / ApiPay (API key)
CREATE TABLE provider_connections (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES tenants(id),
  provider           text NOT NULL CHECK (provider IN ('sepay','apipay')),
  auth_mode          text NOT NULL CHECK (auth_mode IN ('oauth2','api_key','enterprise')),
  access_token_enc   bytea,                 -- SePay OAuth (KMS)
  refresh_token_enc  bytea,                 -- SePay OAuth (KMS)
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
       AND api_access_key_enc IS NULL AND api_secret_key_enc IS NULL)
    OR
    -- ApiPay BYO api_key: cả access + secret key bắt buộc; KHÔNG có OAuth columns
    (provider = 'apipay' AND auth_mode = 'api_key'
       AND api_access_key_enc IS NOT NULL AND api_secret_key_enc IS NOT NULL
       AND access_token_enc   IS NULL AND refresh_token_enc IS NULL)
    OR
    -- ApiPay ENTERPRISE: MỌI credential column NULL (credential ở platform/KMS, không per-tenant)
    (provider = 'apipay' AND auth_mode = 'enterprise'
       AND access_token_enc   IS NULL AND refresh_token_enc  IS NULL
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
  ADD COLUMN webhook_status         text NOT NULL DEFAULT 'connecting'
             CHECK (webhook_status IN ('connecting','registered','active','drift','error','revoked')),
  ADD COLUMN last_register_at       timestamptz;

-- Backfill TK webhook thủ công đang chạy trước auto-register.
UPDATE bank_accounts
SET webhook_status = CASE WHEN active THEN 'active' ELSE 'revoked' END,
    auto_registered = false
WHERE provider_connection_id IS NULL
  AND webhook_token IS NOT NULL
  AND webhook_secret_enc IS NOT NULL;

-- (ALTER + MIGRATION) zalo_bots: vocabulary status chung (gốc: zalo_channel_tech §2 active|inactive|drift)
ALTER TABLE zalo_bots
  ADD COLUMN auto_registered    boolean NOT NULL DEFAULT false,
  ADD COLUMN rotation_pending   boolean NOT NULL DEFAULT false,
  ADD COLUMN last_setwebhook_at timestamptz;

UPDATE zalo_bots SET status = CASE
  WHEN status = 'inactive' THEN 'revoked'
  ELSE status END;                          -- 'active'/'drift' giữ nguyên nghĩa

ALTER TABLE zalo_bots DROP CONSTRAINT IF EXISTS zalo_bots_status_check;
ALTER TABLE zalo_bots ADD CONSTRAINT zalo_bots_status_check
  CHECK (status IN ('connecting','registered','active','drift','error','revoked'));
```

`provider_connections`, `bank_accounts` (đã có), `zalo_bots` (đã có) đều tenant-scoped với **ENABLE + FORCE RLS** dùng `app.tenant_id` (BL-TEN-1). `oauth_transactions` là ngoại lệ bootstrap: direct table access bị revoke khỏi runtime role; callback dùng SECURITY DEFINER `consume_oauth_transaction(state)` để lookup-by-state single-use trước khi set `app.tenant_id`, sau đó mọi ghi tenant-scoped quay lại RLS thường.

> **Vocabulary status** (product §3.1): `connecting → registered`(Tier 1) `→ active`(Tier 2); `drift`/`error`/`revoked`. `provider_connections.status` chỉ do connector lifecycle service ghi: direct provider events (connect/retry/revoke/OAuth refresh) set provider-level state; sau mỗi child update, service recompute rollup từ `bank_accounts.webhook_status` theo product §3.1.1. Không update raw table từ webhook/job/UI ngoài service này.

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
| 2 | Security | HMAC verify trên JSON re-serialize | Dùng **raw body** (§4.5); test payload có unicode/space lạ |
| 3 | Security | Forged/unknown webhook token | 401, verify secret timing-safe, không persist (BL-SEC-2) |
| 4 | Security | `state` giả/replay ở OAuth callback | `OAUTH_STATE_INVALID`; state single-use, TTL 10', thiếu state → từ chối |
| 5 | Security | Secret/token rò ra log | KMS at-rest, redaction; chỉ lưu `last_error_code` (BL-SEC-1) |
| 6 | Concurrency | 2 lần "Kết nối" đồng thời | `UNIQUE(tenant,provider)` + upsert; chỉ 1 webhook đăng ký |
| 7 | Concurrency | Event đến trước khi `registered` commit | Verify vẫn chạy; hợp lệ → flip `active` (UPDATE WHERE status IN ('registered','connecting')) idempotent |
| 8 | Concurrency | Replay event nhà cung cấp | Flip Tier 2 idempotent; ingest dedup `(tenant,provider,external_id)` |
| 9 | Data Integrity | Provider tạo webhook OK nhưng DB commit fail | Lưu `provider_webhook_id` cùng transaction; lệch → job `connectors/cleanup-orphan-webhook` gọi `DELETE` webhook mồ côi |
| 10 | Data Integrity (ApiPay) | TK `PENDING`/`manualActivationPending` | Không register; `webhook_status='connecting'`; job `connectors/recheck-pending-bank` (≤24h) |
| 11 | Data Integrity | Drift — owner đổi URL ở dashboard | `security/webhook-drift` (hourly) → auto re-register; fail → `drift`/alert |
| 12 | Token lifecycle | SePay refresh token hết hạn/refresh fail | `status='error'` + nhắc kết nối lại; **không** ảnh hưởng connection/TK khác |
| 13 | Token lifecycle | ApiPay key bị thu hồi bên ngoài | Delivery fail liên tục → `error` + alert; runbook rotate |
| 14 | Cross-Feature | Gỡ connector | revoke OAuth / `DELETE webhook` → `status='revoked'`; **giữ** lịch sử `bank_transactions` |
| 15 | Cross-Feature | `BANK_ALREADY_BOUND` (fingerprint trùng tenant khác) | 409, không bind; tránh route nhầm tenant |
| 16 | Abuse | Spam `*/connect` dò key | Rate limit BL-SEC-5 (§3) |

---

## 3. API Contract

### Endpoints nội bộ (nâng cấp `/api/onboarding/*`)

| Method | Path | Auth | Mô tả |
|--------|------|------|-------|
| POST | `/api/onboarding/sepay/oauth/start` | TenantOwner (cookie+CSRF) | Tạo `oauth_transactions` (state+PKCE) → trả authorize URL |
| GET  | `/api/onboarding/sepay/oauth/callback` | **state-bound (PKCE), KHÔNG cookie** | `consume_oauth_transaction(state)` SECURITY DEFINER → exchange token → `GET /api/v1/bank-accounts` → rotate session |
| POST | `/api/onboarding/sepay/webhooks/register` | TenantOwner | `POST /api/v1/webhooks` cho TK đã chọn (contract product §4.2.2) |
| POST | `/api/onboarding/apipay/connect` | TenantOwner | accessKey+secretKey → `GET /v2/client/banks` (lọc `ACTIVE`) |
| POST | `/api/onboarding/apipay/webhooks/register` | TenantOwner | `POST /v1/client/webhooks` cho TK `ACTIVE` đã chọn |
| POST | `/api/onboarding/zalo/connect` 🟡 | TenantOwner | *(blocked CO-OQ-1)* bot token → `getMe` → `setWebhook` |
| GET  | `/api/onboarding/connectors/status` | TenantOwner | Status từng connector theo vocabulary §2 |
| DELETE | `/api/onboarding/connectors/:provider` | TenantOwner | Gỡ kết nối (revoke + delete webhook → `revoked`) |

### Webhook receiver (provider-initiated)

| Method | Path | Verify (timing-safe trên RAW body) | Delegate |
|--------|------|-----------------------------------|----------|
| POST | `/webhook/sepay/:token` | header api-key SePay gửi khi `authen_type=Api_Key` == `webhook_secret` (header chính xác: CO-OQ-7) | bank_transactions ingest |
| POST | `/webhook/apipay/:token` | `ApiPay-Signature` == HMAC-SHA256(rawBody, `webhook_secret`) | bank_transactions ingest |
| POST | `/webhook/zalo/:token` 🟡 | `X-Bot-Api-Secret-Token` == `zalo_bots.secret` | channel event handler |

### Rate Limits (BL-SEC-5)

| Endpoint | Limit |
|----------|-------|
| `*/connect`, `*/webhooks/register` (gọi provider API) | 5 / 10 phút / tenant |
| `*/oauth/start`, `*/oauth/callback` | 10 / phút / IP |
| `DELETE /connectors/:provider` | 5 / phút / tenant |
| `POST /webhook/{provider}/:token` | Không áp app-level user limit; edge per-token/IP burst cap + body-size cap theo `deployment-infra.md §6` (sized ≥100/s/token target) |

### Error Codes

| HTTP | Error Code | Message (VI) | Trigger |
|------|-----------|--------------|---------|
| 401 | `APIPAY_KEY_INVALID` | "accessKey/secretKey không đúng" | `GET /v2/client/banks` 401 |
| 409 | `APIPAY_BANK_NOT_ACTIVE` | "Tài khoản chưa kích hoạt, vui lòng đợi" | bank `PENDING`/`manualActivationPending` |
| 502 | `PROVIDER_WEBHOOK_REGISTER_FAILED` | "Đăng ký webhook thất bại" | provider API lỗi → fallback |
| 401 | `SEPAY_OAUTH_DENIED` | "Bạn chưa cấp quyền cho Plexco" | OAuth deny/timeout |
| 400 | `OAUTH_STATE_INVALID` | "Phiên kết nối hết hạn, thử lại" | state không khớp/đã dùng/hết hạn |
| 400 | `ZALO_TOKEN_INVALID` 🟡 | "Token bot không hợp lệ" | `getMe` fail |
| 409 | `BANK_ALREADY_BOUND` | "TK ngân hàng đã gắn ở CLB khác" | fingerprint trùng tenant khác |
| 401 | `INVALID_WEBHOOK_SECRET` | — (không trả nội dung) | verify webhook fail |
| 429 | `RATE_LIMITED` | "Thao tác quá nhanh, thử lại sau" | vượt BL-SEC-5 |

### Idempotency

| Endpoint | Idempotent? | Key |
|----------|-------------|-----|
| `*/webhooks/register` | ✅ | `(tenant_id, provider, provider_bank_ref)` — đã có `provider_webhook_id` thì reuse |
| `apipay/connect`, `sepay/oauth/start` | ✅ | upsert `(tenant_id, provider)` |
| `oauth/callback` | ✅ | `state` single-use (xóa sau exchange) |
| `zalo/connect` 🟡 | ✅ | `(tenant_id)` — `zalo_bots` UNIQUE(tenant) |
| Webhook ingest | ✅ | `(tenant, provider, external_id)` (delegate payment ingest) |
| Flip Tier 2 | ✅ | `UPDATE ... WHERE status <> 'active'` — chỉ lần đầu emit analytics |

---

## 4. Chi tiết triển khai

### 4.1 State machine (impl — product §3.3)

| Từ | Sự kiện | Đến | Side-effect |
|----|---------|-----|-------------|
| `connecting` | validate + autoRegister OK | `registered` | lưu `provider_webhook_id`, `last_register_at`, `auto_registered=true` |
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
  set provider_webhook_id, webhook_status=registered, last_register_at
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
| 6 | SePay api-key header verify | header == secret | pass; sai → 401 |
| 7 | `validate()` ApiPay key sai | 401 từ `/v2/client/banks` | `APIPAY_KEY_INVALID` |
| 8 | Lọc bank ACTIVE | mix ACTIVE/PENDING | chỉ register ACTIVE |
| 9 | Bank PENDING | `manualActivationPending=true` | `APIPAY_BANK_NOT_ACTIVE`, enqueue recheck |
| 10 | SePay build webhook body | club ctx | đủ field bắt buộc + `authen_type=Api_Key` |
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

### Integration Tests

| # | Test | Setup | Expected |
|---|------|-------|----------|
| 1 | ApiPay E2E | connect → register → webhook txn | `registered`→`active`, txn ingest 1 lần |
| 2 | SePay OAuth E2E | start→callback→register→giả lập GD | token lưu, webhook tạo, `active` |
| 3 | OAuth không cookie | callback từ domain ngoài (no cookie) | vẫn thành công nhờ state/PKCE |
| 4 | 2 tenant cô lập | 2 connection, 2 token | routing độc lập, RLS không rò |
| 5 | Crash giữa register | kill sau create-webhook, trước commit-2 | cleanup-orphan dọn webhook thừa |
| 6 | ApiPay PENDING→ACTIVE | bank kích hoạt sau | recheck job tự register |

---

## 6. Rollout Plan + Changelog

### Rollout (khớp product §11)

1. **M1** — receiver verify 2 tầng + raw-body HMAC; flip `active` khi event đầu.
2. **M2** — **ApiPay ENTERPRISE auto-provision per-host = Phase-1 PRIMARY (DD-30 ✅ · DD-02)**: platform giữ 1 credential enterprise, tự provision per-host (không bắt host tự lấy `api_key`); BYO `api_key` là fallback. Xử lý bank `PENDING`. *(rủi ro thấp nhất, giao trước)*
3. **M3** — SePay OAuth2 (cần partner CO-OQ-2) + state/PKCE + refresh job; fallback token mode; tùy chọn poll `/transactions`.
4. **M4** — Zalo auto `setWebhook` *(chỉ sau khi gỡ CO-OQ-1)* + drift auto re-register.
5. **M5** — dọn fallback, telemetry, ẩn dần luồng nhập tay.

### Metrics

Tỉ lệ connect không-chạm-webhook; `time_to_verify_ms` (registered→active) trung vị; tỉ lệ `connector_register_failed`; số drift auto-repair; số orphan-webhook dọn; tỉ lệ refresh fail. Log chỉ ID/`last_error_code`, không secret/raw payload.

### Definition of Done

- [ ] Schema/RLS/indexes + migration `zalo_bots` áp dụng, không vỡ data cũ.
- [ ] Verify webhook timing-safe **trên raw body** (test re-serialize fail).
- [ ] Auto-register idempotent + orphan cleanup pass crash test.
- [ ] OAuth state/PKCE, callback không phụ thuộc cookie, state single-use.
- [ ] ApiPay xử lý đúng `ACTIVE/PENDING/manualActivationPending`.
- [ ] Tenant isolation (RLS) + `BANK_ALREADY_BOUND` pass.
- [ ] Provider API fail → fallback, không chặn onboarding (B6).
- [ ] Acceptance criteria ở `../feature_connector_onboarding.md` pass.

### Changelog

| Date | Version | Thay đổi |
|---|---|---|
| 2026-06-20 | v0.2 | Fix review: `rotation_pending` thay lifecycle state ngoài enum; `oauth_transactions` bootstrap qua SECURITY DEFINER lookup-by-state; backfill `bank_accounts.webhook_status`; định nghĩa owner/rollup của `provider_connections.status`; webhook receiver dùng edge per-token/body cap thay vì wording unbounded. |
| 2026-06-20 | v0.1 | BE tech spec đầu: provisioning + auto-register + verify 2 tầng + lifecycle (refresh/drift/recheck/cleanup); schema delta `provider_connections`/`oauth_transactions` + ALTER `bank_accounts`/`zalo_bots`; 16 edge cases; 24 unit + 6 integration tests. Delegate ingest→`payment_reconcile_tech`, channel→`zalo_channel_tech`. |
