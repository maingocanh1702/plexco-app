# Feature: Connector Onboarding (Zalo · SePay · ApiPay) — Auto-Register Upgrade

> **Canonical phase:** P3 (payment ingest) · P4 (web onboarding) · P4.7 (Zalo) — *cross-cutting upgrade*
> **Track:** 🔌 Connector / Onboarding
> **Version:** 1.0 · 2026-07-27
> **Status:** Draft (standard provider contracts reviewed; ApiPay enterprise provider gate open)
> **Implementation:** Not started · authority: `../standards/BUILD-STATUS.md` (Doc status ≠ Implementation status)  
> **Prerequisites:** P3 webhook ingest stable · P4 onboarding wizard scaffold
> **Tài liệu liên quan:** `feature_web_auth_onboarding.md` (nâng cấp step bank/zalo/messenger) · `feature_zalo_channel.md` · `feature_player_messenger.md` · `feature_payment_reconcile.md` · `../channels/zalo/README.md` §6–7 · `../standards/decisions.md` DD-30/DD-37/DD-33 · `../product/TDD.md` · `../standards/business-rules.md` BL-PAY-6, BL-SEC-1/2, BL-TEN-1, BL-ID-6, BL-SEC-5 · `../research/player-side-saas-AUDIT.md` §B2 · `../research/auto-debt-reconciliation-regional-availability-2026-07-27.md` (research input, không phải provider/rollout authority)

> **Authority DD-65 (2026-07-17):** doc này vẫn cover connector Zalo/SePay/ApiPay. Messenger central Page do platform vận hành; FB Login + Page riêng là **optional tenant connector**, không chặn tenant readiness. Chi tiết ở `feature_player_messenger.md` + `feature_web_auth_onboarding.md`.
>
> **Regional/capability boundary (2026-07-27):** connector contract hiện hành chỉ có
> `sepay|apipay`, thuộc rail Việt Nam. `payment_reconcile_auto` là commercial entitlement riêng; UI chỉ
> được hiện `Available` khi market/provider/bank/currency/consent và runtime webhook→settle→notify cùng
> pass. Ngoài Việt Nam giữ mark-paid thủ công và waitlist/coming-later cho auto-reconcile; research không
> tự thêm provider hay authorize implementation.

---

## 0. TL;DR — vấn đề & đề xuất

**Vấn đề (hiện trạng spec):** Cả ba connector đều bắt **chủ CLB (non-tech)** tự tay làm bước khó nhất:

| Connector | Owner đang phải làm tay (theo spec hiện tại) |
|---|---|
| Zalo | Tạo bot → dán token → **tự vào Zalo platform dán webhook URL** `{api_base}/webhook/zalo/{token}` (`channels/zalo/README.md` §6) |
| SePay | Nhập credential → **tự vào SePay dashboard tạo webhook** trỏ về Plexco (`feature_web_auth_onboarding` step bank) |
| ApiPay | Nhập credential → **tự vào ApiPay dashboard tạo webhook** |

Bước "copy URL → mò vào dashboard bên thứ ba → dán đúng chỗ → set trigger/secret" là điểm rơi onboarding lớn nhất cho non-tech user, và cũng là nguồn lỗi "webhook drift".

**Đề xuất:** Đảo nguyên tắc — **owner chỉ xác nhận tài khoản nhận tiền hoặc cấp credential thuộc về họ; Plexco tự đăng ký webhook bằng API**. Mức độ chắc chắn (kiểm chứng dashboard/docs thật ngày 2026-06-20):

- **SePay** — ✅ *verified*. Có **OAuth2** (scopes `bank-account:read`, `transaction:read`, `webhook:read|write|delete`) + `POST /api/v1/webhooks` (contract đầy đủ — §4.2) + `GET /api/v1/transactions` + **giả lập giao dịch** → "Kết nối SePay" 1 nút, không dán token.
- **ApiPay** — **phase-1 primary = enterprise auto-provision (DD-30):** host không nhập platform credential; Plexco provision bank-account/webhook riêng cho host, tiền vẫn về TK host. API-key BYO qua `GET /v2/client/banks` + `POST /v1/client/webhooks` là fallback explicit. Standard webhook API đã verified; request shape/terms của enterprise phải được xác nhận trước production.
- **Zalo** — 🟡 *candidate, blocked by sandbox confirmation (CO-OQ-1)*. Pattern token + `getMe`/`setWebhook` xuất hiện trong các SDK Zalo Bot cộng đồng, **nhưng chưa kiểm chứng endpoint/tham số chính thức** trên tier Zalo Bot mà CLB dùng. **Không** đưa vào triển khai cho tới khi confirm sandbox; trước đó giữ luồng nhập tay hiện có.

**Kết quả:** 3 flow rối → 1 pattern "Kết nối" thống nhất, kết thúc bằng tín hiệu xanh "đã nhận giao dịch/tin nhắn thử". SePay/ApiPay standard webhook auto-register bỏ bước dán URL; enterprise ApiPay chỉ bật sau khi provider contract chứng minh request shape + replay safety; Zalo theo sau khi gỡ block.

### Quan hệ với spec hiện tại

Đây là **bản nâng cấp**, không thay thế:

- `feature_web_auth_onboarding.md` — step `bank_connect`/`bank_verify` và `zalo_optional`: từ "manual portal config" → **auto-register + verify-by-event**.
- `channels/zalo/README.md` §6 — giữ manual webhook cho tới khi gỡ CO-OQ-1; sau đó mới chuyển sang **Plexco gọi `setWebhook`**. §7 drift từ "alert" → **auto re-register** khi API chính thức được xác nhận.
- `feature_payment_reconcile.md` — phần ingest giữ nguyên; chỉ thay đường *thiết lập* webhook.

### Nguồn kiểm chứng provider (refresh 2026-07-17)

| Provider | Nguồn chính | Đã chốt trong spec | Còn phải sandbox |
|---|---|---|---|
| SePay | `https://developer.sepay.vn/en/sepay-webhooks/xac-thuc`, `https://developer.sepay.vn/en/sepay-oauth2/api-webhook` | OAuth Webhooks API; production default `authen_type=HMAC_SHA256`; headers `X-SePay-Signature` + `X-SePay-Timestamp`; signed bytes `{timestamp}.{raw_body}`; API-key fallback exact `Authorization: Apikey <key>` | sandbox status/error/retry mapping; auth header/signing contract đã chốt |
| ApiPay | standard/BYO docs: `https://docs.apipay.vn/vi/api/authentication`, `https://docs.apipay.vn/vi/api/banks`, `https://docs.apipay.vn/vi/api/webhooks`; DD-30 là authority cho primary path | Standard/BYO: `Authorization: Bearer base64(accessKey:secretKey)`; banks `/v2/client/banks`; webhooks `/v1/client/webhooks`; `ApiPay-Signature` HMAC raw body | enterprise request/response + exact replay mechanism + terms/SLA; standard sandbox status/error mapping |
| Zalo | `channels/zalo/README.md` + SDK/community references | tenant routing + secret verify pattern | endpoint/tham số chính thức `getMe`/`setWebhook`/`getWebhookInfo` trên tier CLB (CO-OQ-1) |

---

## 1. Mô tả

Cung cấp một trải nghiệm "Kết nối" (Connect) thống nhất cho 3 connector. ApiPay phase-1 dùng enterprise auto-provision nên host chỉ chọn/xác nhận TK nhận tiền, không nhập platform credential; SePay dùng OAuth consent; Zalo và ApiPay-BYO fallback mới nhận credential thuộc về owner. Việc đăng ký webhook về Plexco và xác minh hoạt động do hệ thống tự làm.

### Bất biến

- **B1 — Routing theo opaque token, KHÔNG theo nội dung payload.** Tenant luôn suy ra từ `:token` trong path → `*.webhook_token → tenant_id`, rồi mới verify `account_fingerprint`/account khớp. Ref: **BL-PAY-6**, **BL-ID-6**.
- **B2 — Secret at-rest qua KMS, write-only.** Mọi token/secret (`bot_token_enc`, `webhook_secret_enc`, OAuth tokens, PKCE verifier) mã hoá envelope (AES-GCM); không log; không trả lại sau khi lưu; có reset path. Ref: **BL-SEC-1**.
- **B3 — Verify webhook timing-safe trên RAW body.** Sai chữ ký/timestamp → 401, không persist payload nghiệp vụ, security log không chứa secret. SePay production dùng HMAC-SHA256 trên `{unix_timestamp}.{raw_body}`, timestamp freshness ±300s và constant-time compare. API key chỉ explicit fallback/sandbox. Ref: **BL-SEC-2**, AUDIT B-webhook.
- **B4 — RLS fail-closed.** Mọi bảng tenant-scoped ENABLE + FORCE RLS theo `app.tenant_id`. Riêng `oauth_transactions` là bảng bootstrap trước-tenant cho OAuth callback, không đọc trực tiếp qua tenant RLS; chỉ truy cập qua SECURITY DEFINER function lookup-by-state single-use. Ref: **BL-TEN-1**.
- **B5 — Tự động hoá KHÔNG nới lỏng bảo mật.** Auto-register chỉ chạy trong context tenant đã auth (TenantOwner), idempotent, chịu rate limit **BL-SEC-5**.
- **B6 — Auto-register là tiện ích, không phải điểm chết.** ApiPay enterprise không khả dụng/không phủ bank → hiện CTA **BYO API key fallback**; provider webhook API vẫn fail mới tới rescue nhập URL tay. Không tự downgrade `auth_mode` hoặc chuyển sang BYO mà chưa có hành động rõ ràng của owner.

---

## 2. Nguyên tắc thiết kế chung — "Connect" pattern

### 2.1 Credential-minimization

Owner chỉ đưa đúng **một thứ chỉ họ mới có**; mọi thao tác cấu hình webhook là việc của Plexco:

| Connector | Owner đưa gì | Plexco tự làm | Bước tay còn lại (không bỏ được) |
|---|---|---|---|
| SePay ✅ | OAuth2 consent (nút "Đồng ý") | `GET /api/v1/bank-accounts` → `POST /api/v1/webhooks` *hoặc* poll `/transactions` | — (chỉ bấm Đồng ý) |
| ApiPay ✅ — phase-1 primary (DD-30) | Không nhập credential; platform dùng enterprise credential để provision per-host | Tạo/bind bank account riêng của host + webhook | Chọn/xác nhận TK ngân hàng của chính host theo flow provider |
| ApiPay BYO — fallback | accessKey + secretKey | `GET /v2/client/banks` → `POST /v1/client/webhooks` | Copy 2 key từ ApiPay → Plexco |
| Zalo 🟡 | Bot token (per-CLB) | `getMe` → `setWebhook` → store enc *(sau khi gỡ CO-OQ-1)* | Tạo bot trong Zalo Bot Creator |

> Zalo còn 1 bước tạo bot vì Zalo **không** có API tạo bot (owner tự tạo trong Zalo Bot Creator). SePay là "rảnh tay" nhất nhờ OAuth2.

### 2.2 Capability-driven UI

Một interface chung, UI render theo `auth_mode` của provider — thêm provider mới = khai báo capability, không viết lại màn hình.

```typescript
type AuthMode =
  | { kind: "oauth2"; scopes: string[] }                      // SePay
  | { kind: "api_token"; fields: ["apiToken"] }               // SePay outbound fallback
  | { kind: "enterprise"; tenantCredentialFields: [] }         // ApiPay primary; platform KMS credential
  | { kind: "api_key"; fields: ["accessKey", "secretKey"] }   // ApiPay BYO fallback
  | { kind: "bot_token" };                                     // Zalo

interface ConnectorProvider {
  id: "zalo" | "sepay" | "apipay";
  auth: AuthMode;
  validate(creds: Credentials): Promise<ProviderIdentity>;      // getMe / OAuth /me / banks
  autoRegisterWebhook(ctx: TenantCtx, creds): Promise<WebhookHandle>;
  verify: { kind: "wait_inbound" } | { kind: "wait_transaction" } | { kind: "simulate" };
}
```

### 2.3 Verify 2 tầng (chốt: kết hợp register-OK + event thật)

```
Tier 1 — "Đã kết nối"  := validate() OK  &&  autoRegisterWebhook() OK   (wiring kỹ thuật xong)
Tier 2 — "Đã xác minh" := nhận event thật đầu tiên qua webhook          (chứng minh end-to-end)
```

- **Tier 1** = trạng thái `registered`. UI hiện "✅ Đã kết nối — đang chờ tín hiệu thử".
- **Tier 2** = trạng thái `active`. Đạt khi: Zalo = owner DM bot 1 tin · SePay/ApiPay = 1 giao dịch thật **hoặc** SePay "giả lập giao dịch" (không cần tiền thật).

---

## 3. Domain Model (delta lên schema hiện tại)

### 3.1 Vocabulary trạng thái (canonical — dùng CHUNG cho cả 3 bảng)

Một enum duy nhất, khớp đúng state machine ở §3.3:

| status | Ý nghĩa |
|---|---|
| `connecting` | Đã nhận credential, đang validate / đăng ký webhook |
| `registered` | **Tier 1** — credential OK + webhook đã đăng ký (Zalo `setWebhook`/SePay/ApiPay) hoặc OAuth đã linked |
| `active` | **Tier 2** — đã nhận event thật đầu tiên |
| `drift` | Webhook URL bị lệch (cron phát hiện) |
| `error` | Lỗi credential / đăng ký / refresh token |
| `revoked` | Owner gỡ kết nối |

> Áp dụng cho `zalo_bots.status`, `bank_accounts.webhook_status`, `provider_connections.status`. `provider_connections.status` do **connector lifecycle service** ghi: connect/retry/revoke/OAuth-refresh có thể set trực tiếp ở mức provider; còn sau mỗi thay đổi `bank_accounts.webhook_status`, service recompute rollup theo §3.1.1. Không để UI/job con ghi đè trực tiếp ngoài service này.

#### 3.1.1 Ownership & rollup của `provider_connections.status`

- **Nguồn ghi duy nhất:** connector lifecycle service. API handler, webhook handler, refresh job và drift job đều gọi service này, không update raw table trực tiếp.
- **Direct provider events:** owner connect/retry → `connecting`; credential/OAuth refresh fail → `error`; owner revoke → `revoked`.
- **Child rollup:** sau mỗi thay đổi `bank_accounts.webhook_status`, recompute cho connection tương ứng: `drift` nếu có TK drift; `error` nếu tất cả TK selected đều error/revoked hoặc provider credential lỗi; `connecting` nếu chưa có TK registered/active hoặc còn TK selected đang pending kích hoạt; `active` nếu có ít nhất 1 TK active và không có drift/error/connecting blocking; `registered` nếu đã đăng ký webhook nhưng chưa có event thật.
- **Audit:** mọi transition ghi `actor`, `source` (`connect_flow|webhook|drift_job|refresh_job|revoke`) và `reason_code`.

### 3.2 DDL delta

```sql
-- (NEW) Credential mức "kết nối" cho SePay (OAuth/API-token fallback) /
-- ApiPay (enterprise primary/BYO API-key fallback).
-- Tách khỏi bank_accounts vì 1 kết nối có thể quản nhiều TK ngân hàng.
CREATE TABLE provider_connections (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id),
  provider          text NOT NULL CHECK (provider IN ('sepay','apipay')),
  auth_mode         text NOT NULL CHECK (auth_mode IN ('oauth2','api_token','api_key','enterprise')),
  -- OAuth (SePay)
  access_token_enc  bytea,
  refresh_token_enc bytea,
  provider_api_token_enc bytea,                         -- SePay outbound API-token fallback
  scope             text,
  token_expires_at  timestamptz,
  -- API key (ApiPay)
  api_access_key_enc bytea,
  api_secret_key_enc bytea,
  status            text NOT NULL DEFAULT 'connecting'
                    CHECK (status IN ('connecting','registered','active','drift','error','revoked')),
  last_error_code   text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, provider),
  CHECK (
    (provider='sepay' AND auth_mode='oauth2'
      AND access_token_enc IS NOT NULL
      AND provider_api_token_enc IS NULL
      AND api_access_key_enc IS NULL AND api_secret_key_enc IS NULL)
    OR
    (provider='sepay' AND auth_mode='api_token'
      AND provider_api_token_enc IS NOT NULL
      AND access_token_enc IS NULL AND refresh_token_enc IS NULL
      AND api_access_key_enc IS NULL AND api_secret_key_enc IS NULL)
    OR
    (provider='apipay' AND auth_mode='api_key'
      AND api_access_key_enc IS NOT NULL AND api_secret_key_enc IS NOT NULL
      AND access_token_enc IS NULL AND refresh_token_enc IS NULL
      AND provider_api_token_enc IS NULL)
    OR
    (provider='apipay' AND auth_mode='enterprise'
      AND access_token_enc IS NULL AND refresh_token_enc IS NULL
      AND provider_api_token_enc IS NULL
      AND api_access_key_enc IS NULL AND api_secret_key_enc IS NULL)
  )
);
-- ENABLE + FORCE RLS theo app.tenant_id (BL-TEN-1).

-- (NEW) Giao dịch OAuth ngắn hạn cho SePay — PKCE + state, KHÔNG dựa cookie (xem §4.2.3)
CREATE TABLE oauth_transactions (
  state             text PRIMARY KEY,              -- random, đối chiếu ở callback
  tenant_id         uuid NOT NULL REFERENCES tenants(id),
  provider          text NOT NULL CHECK (provider IN ('sepay')),
  code_verifier_enc bytea NOT NULL,                -- PKCE verifier, KMS enc
  redirect_uri      text NOT NULL,
  created_by        uuid NOT NULL,                 -- owner person id
  created_at        timestamptz NOT NULL DEFAULT now(),
  expires_at        timestamptz NOT NULL           -- ví dụ 10 phút
);

-- OAuth bootstrap table: KHÔNG đặt dưới tenant-RLS thường theo app.tenant_id.
-- Direct SELECT/UPDATE/DELETE từ role app bị REVOKE; callback chỉ dùng
-- SECURITY DEFINER function consume_oauth_transaction(state) để lookup-by-state
-- (state random ≥128-bit, TTL 10', SELECT FOR UPDATE, DELETE trong cùng txn).

-- (ALTER) bank_accounts: liên kết về connection + metadata auto-register
ALTER TABLE bank_accounts
  ADD COLUMN provider_connection_id uuid REFERENCES provider_connections(id),
  ADD COLUMN provider_webhook_id    text,        -- SePay webhook id / ApiPay wh_xxx
  ADD COLUMN provider_bank_ref      text,        -- SePay bank_account_id / ApiPay bankPublicId
  ADD COLUMN auto_registered        boolean NOT NULL DEFAULT false,
  ADD COLUMN webhook_auth_mode      text CHECK (webhook_auth_mode IN ('hmac_sha256','api_key')),
  ADD COLUMN webhook_status         text NOT NULL DEFAULT 'connecting'
             CHECK (webhook_status IN ('connecting','registered','active','drift','error','revoked')),
  ADD COLUMN last_register_at       timestamptz;

-- Backfill TK đang chạy webhook thủ công trước khi auto-register tồn tại.
UPDATE bank_accounts
SET webhook_status = CASE WHEN active THEN 'active' ELSE 'revoked' END,
    auto_registered = false
WHERE provider_connection_id IS NULL
  AND webhook_token IS NOT NULL
  AND webhook_secret_enc IS NOT NULL;

-- LIVE từ migration 0004: zalo_bots đã có lifecycle
-- connecting|registered|active|drift|error|revoked cùng auto_registered,
-- rotation_pending và last_setwebhook_at. Không deploy lại phần schema đó.

-- TARGET forward migration: chọn next available monotonic number sau khi sync
-- merged prerequisites (`0014_players_waitlist` đã merge trên main tại 1a6ac38; verify tail hiện hành tại packages/db/migrations/, không hard-pin số); legacy
-- `secret text` không đạt BL-SEC-1.
-- Add nullable first; application migration KMS-encrypts every usable legacy value.
ALTER TABLE zalo_bots ADD COLUMN webhook_secret_enc bytea;

-- Sau KMS backfill: row không chứng minh được secret hợp lệ → status='error',
-- chặn webhook và yêu cầu owner reconnect. Mọi trạng thái nhận webhook phải có ciphertext.
ALTER TABLE zalo_bots ADD CONSTRAINT zalo_bots_webhook_secret_ready_chk
  CHECK (webhook_secret_enc IS NOT NULL OR status IN ('connecting','error','revoked'))
  NOT VALID;
ALTER TABLE zalo_bots VALIDATE CONSTRAINT zalo_bots_webhook_secret_ready_chk;
ALTER TABLE zalo_bots DROP COLUMN secret;
```

Không mã hoá legacy secret bằng SQL hoặc copy bytes plaintext sang cột `_enc`. Deployment job phải gọi KMS/envelope service, redacted-audit từng row và fail closed; sau cutover không còn dual-read `secret`. `webhook_token` là random opaque URL locator, không phải provider verification secret và không thay thế `webhook_secret_enc`.

### 3.3 State machine (per connection — đúng từ vựng §3.1)

```mermaid
stateDiagram-v2
    [*] --> connecting: owner cung cấp credential
    connecting --> registered: validate() OK + autoRegisterWebhook() OK  (Tier 1)
    connecting --> active: event thật đến sớm + ciphertext verify OK
    connecting --> error: credential sai / provider API fail
    registered --> active: nhận event thật đầu tiên              (Tier 2)
    registered --> error: webhook verify fail liên tục
    active --> drift: cron getWebhookInfo phát hiện URL lệch
    drift --> registered: auto re-register OK
    drift --> error: re-register fail → alert owner
    error --> connecting: owner retry / fallback nhập tay
    active --> revoked: owner gỡ kết nối (revoke + delete webhook)
```

---

## 4. Per-provider flow

### 4.1 Zalo — BYO per-club bot (DM-only) — 🟡 CANDIDATE, BLOCKED by CO-OQ-1

> **Trạng thái:** chưa triển khai. Cần **confirm sandbox** endpoint/tham số `getMe`/`setWebhook`/`getWebhookInfo` của Zalo Bot API trên tier CLB dùng (CO-OQ-1). Đến khi đó giữ luồng "owner dán webhook URL" hiện có. Phần dưới là **thiết kế dự kiến** nếu pattern được xác nhận.

**Owner làm:** Tạo bot trong Zalo Bot Creator → copy token → dán vào Plexco. (1 lần / CLB.)

**Plexco làm (DỰ KIẾN, sau khi gỡ block):**

```typescript
async function connectZalo(ctx: TenantCtx, botToken: string) {
  const me = await zalo.getMe(botToken);              // ⚠️ endpoint cần confirm (CO-OQ-1)
  const webhookToken = randomOpaque();                // route key, KHÔNG phải bot token
  const secret = randomSecret();
  await db.zaloBots.beginConnect(ctx, {
    botTokenEnc: kms.enc(botToken), webhookToken,
    webhookSecretEnc: kms.enc(secret),
    status: "connecting",
  }); // idempotent retry must not downgrade registered/active; rotation uses pending KMS version
  await zalo.setWebhook(botToken, {                    // ⚠️ AUTO — owner KHÔNG đụng
    url: `${API_BASE_URL}/webhook/zalo/${webhookToken}`,
    secret_token: secret,                             // verify X-Bot-Api-Secret-Token timing-safe (raw)
  });
  await db.zaloBots.markRegisteredWithoutDowngrade(ctx, {
    autoRegistered: true, lastSetwebhookAt: now(),
  }); // CAS connecting→registered; preserve active if an early verified event already won
  const state = await db.zaloBots.getStatus(ctx);
  return { state, bot: me, verifyHint: "Nhắn 1 tin cho bot để xác minh" };
}
```

- **Tier 2 trigger:** event `user_send_text`/`follow` đầu tiên (`bot-zalo` §6.1) chỉ được xử lý khi row có `webhook_secret_enc` và status thuộc `connecting|registered|active|drift`. `connecting|registered` CAS sang `active`; `active` giữ nguyên; `drift` vẫn xử lý event nhưng **không** tự xóa drift. `connecting` thiếu ciphertext, `error` và `revoked` fail closed. Connect finalization chỉ CAS `connecting→registered`, nên không thể hạ một early-event winner từ `active` về `registered`. Riêng identity service resolve/create đúng `channel_identity_id` bound với bot/OA endpoint đã xác thực rồi upsert **chỉ** reachability row đó `can_dm=true`. Hai effect tách transaction/outbox; không update một person/tenant-level reachability chung và không suy tenant từ payload.
- **Drift (nâng cấp §7):** cron `security/webhook-drift` gọi `getWebhookInfo` → URL lệch → **tự `setWebhook` lại**; chỉ alert nếu re-register fail.
- **Fallback:** nếu CO-OQ-1 cho kết quả "không có API set webhook" → giữ nguyên luồng owner dán URL (đã spec) + drift detection alert-only.

### 4.2 SePay — OAuth2 (ưu tiên) / API token (fallback) — ✅ verified

**Base URL:** `https://my.sepay.vn/api/v1` · **Scopes:** `transaction:read`, `webhook:read`, `webhook:write`, `webhook:delete`, `bank-account:read`.

```mermaid
sequenceDiagram
  Owner->>Plexco: bấm "Kết nối SePay"
  Plexco->>Plexco: tạo oauth_transactions (state + PKCE)
  Plexco->>SePay: redirect authorize (scopes, state, code_challenge)
  Owner->>SePay: Đồng ý
  SePay-->>Plexco: GET callback ?code&state
  Plexco->>Plexco: lookup state → tenant + code_verifier
  Plexco->>SePay: đổi code+verifier → access+refresh token
  Plexco->>SePay: GET /bank-accounts  (owner chọn TK)
  Plexco->>SePay: POST /webhooks (contract §4.2.2)
  Note over Plexco: status=registered (Tier 1)
  Owner->>SePay: giả lập giao dịch / CK thật
  SePay->>Plexco: webhook → status=active (Tier 2)
```

#### 4.2.1 Lưu trữ

`provider_connections` (auth_mode=`oauth2`, access/refresh enc, scope, `token_expires_at`). Mỗi TK owner chọn → 1 `bank_accounts` row (`provider_connection_id`, `webhook_token`, `provider_webhook_id`, `provider_bank_ref` = SePay `bank_account_id`, `auto_registered=true`).

#### 4.2.2 Contract `POST /api/v1/webhooks` (đầy đủ — sửa theo góp ý)

`bank_account_id` lấy từ `GET /api/v1/bank-accounts`. Plexco production set `authen_type=HMAC_SHA256` (SePay recommended): `secret_key` sinh ngẫu nhiên, lưu KMS-encrypted, receiver verify timestamp + raw-body signature ở §5. `Api_Key` chỉ được chọn bằng explicit fallback/sandbox config; không tự downgrade khi HMAC lỗi.

| Field | Kiểu | Bắt buộc | Giá trị Plexco dùng |
|---|---|---|---|
| `bank_account_id` | integer | ✓ | id TK từ `GET /api/v1/bank-accounts` |
| `name` | string | ✓ | `"Plexco — {club_slug}"` |
| `event_type` | string | ✓ | `In_only` (chỉ tiền vào) — hoặc `All` |
| `authen_type` | string | ✓ | `HMAC_SHA256` (production default) |
| `webhook_url` | string | ✓ | `{API_BASE_URL}/webhook/sepay/{webhook_token}` |
| `is_verify_payment` | integer | ✓ | `0` (Plexco tự match P3 theo name+amount+date) |
| `secret_key` | string | ✓ (khi `HMAC_SHA256`) | secret sinh ngẫu nhiên → `webhook_secret_enc` |
| `request_content_type` | string | ✓ | `Json` |
| `skip_if_no_code` | integer | tùy chọn | `0` (nhận hết, không cần pay-code ở P3) |
| `active` | integer | tùy chọn | `1` |
| `only_va` | integer | tùy chọn | `0` (đặt `1` nếu dùng VA → kèm `bank_sub_account_ids` lấy từ `GET /api/v1/bank-accounts/{id}/sub-accounts`) |
| `retry_conditions` | object | tùy chọn | `{ "non_2xx_status_code": 1 }` |

```jsonc
// POST /api/v1/webhooks  (Authorization: Bearer <access_token>)
{
  "bank_account_id": 19,
  "name": "Plexco — bestminton-club",
  "event_type": "In_only",
  "authen_type": "HMAC_SHA256",
  "webhook_url": "https://api.plexco.app/webhook/sepay/{webhook_token}",
  "is_verify_payment": 0,
  "skip_if_no_code": 0,
  "active": 1,
  "secret_key": "<secret-sinh-ngau-nhien>",
  "request_content_type": "Json"
}
// → { "message": "Thêm WebHooks thành công", "id": 23 }   // lưu id vào provider_webhook_id
```

> Quản lý vòng đời: `GET/PATCH/DELETE /api/v1/webhooks/{id}` (scopes `webhook:read|write|delete`). Mã lỗi SePay: 400 `validation_error`, 401 `unauthorized`, 403 `forbidden`, 404 `not_found`.

#### 4.2.3 OAuth state/PKCE & cookie (sửa theo góp ý)

- Callback `?code&state` là **top-level navigation từ SePay** → cookie session `sameSite=strict` **không** được gửi kèm. Vì vậy callback **không dựa cookie**.
- `*/oauth/start` (auth = TenantOwner, có cookie + CSRF) sinh `state` ngẫu nhiên + PKCE `code_verifier`/`code_challenge`, lưu `oauth_transactions` (TTL ~10 phút) qua `create_oauth_transaction(...)`, rồi redirect.
- `*/oauth/callback` gọi SECURITY DEFINER `consume_oauth_transaction(state)` trước khi có `app.tenant_id`, lấy `tenant_id` + `code_verifier`, đổi token bằng `authorization_code` + verifier; function đã xóa `state` trong cùng transaction (single-use). Sau đó backend `SET LOCAL app.tenant_id` cho phần ghi tenant-scoped, **rotate/khôi phục session** rồi mới về wizard.
- Direct query vào `oauth_transactions` từ runtime app bị cấm; state không đoán được, TTL 10 phút, single-use.

#### 4.2.4 Thay thế webhook bằng poll (tùy chọn)

Có `GET /api/v1/transactions` → TK nào không set được webhook có thể **poll** (pg-boss cron) ra cùng `bank_transactions` ingest. Verify Tier 2 ưu tiên **"giả lập giao dịch"** của SePay.

**Fallback:** chưa kịp đăng ký OAuth partner (CO-OQ-2) → owner dán **API token** có scope webhook cần dùng → vẫn `POST /api/v1/webhooks`. Inbound auth vẫn mặc định HMAC; fallback API-key phải explicit và lưu `webhook_auth_mode`, không downgrade động. Cuối cùng mới tới luồng dán URL tay (B6).

### 4.3 ApiPay — enterprise auto-provision PRIMARY; BYO API key FALLBACK

#### 4.3.1 Primary — enterprise auto-provision (DD-30 ✅ · DD-02)

Platform giữ **1 credential ApiPay enterprise** và tự động provision per-host; host không phải tạo/copy API key:

- **Onboarding host:** host chọn/xác nhận TK ngân hàng của chính mình theo flow provider, rồi web gọi `POST /api/onboarding/apipay/provision` với `Idempotency-Key`, `bankSelectionRef` opaque và consent. Request **không** nhận platform secret, accessKey/secretKey hay số TK thô.
- **Provision:** backend resolve `bankSelectionRef` đúng tenant/owner, dùng enterprise credential trong platform KMS để tạo/bind **per-host** bank-account + webhook `/webhook/apipay/{webhookToken}`; response chỉ trả Plexco IDs + `registered`, không trả credential/webhook secret.
- **Money-custody KHÔNG đổi:** tiền vẫn về **tài khoản ngân hàng RIÊNG của host**; Plexco **không** thu hộ → giữ invariant `feature_payment_reconcile` + 5 HARD RULES ("platform không giữ tiền player"). Routing tenant vẫn `:token → bank_accounts.webhook_token → tenant_id` (**BL-PAY-6**); verify `ApiPay-Signature` HMAC per-host **không đổi**.
- **Fallback có chủ đích:** chỉ hiện CTA "Dùng ApiPay key riêng" khi enterprise không khả dụng/không phủ bank hoặc host muốn tự quản key. Không tự đổi `auth_mode='enterprise'` sang `api_key`.
- **Bảo mật:** enterprise credential là tài sản **KMS cấp platform** (không per-tenant); lộ = ảnh hưởng nhiều tenant → rotation + audit riêng + rate-limit provisioning. `provider_connections.auth_mode='enterprise'` phân biệt rõ với `api_key`.
- **Production gate:** xác nhận điều khoản + request/response thực tế của enterprise ApiPay (giới hạn account/webhook, phí, SLA) và một replay mechanism chứng minh được: provider idempotency key **hoặc** exact lookup/reuse bằng deterministic provision ref. Không có một trong hai → `APIPAY_ENTERPRISE_UNAVAILABLE`, không gọi create mù sau timeout và không suy từ standard BYO API.

> Nguồn authority: **DD-30** (`../standards/decisions.md`). Provider vẫn `apipay`; chỉ khác ai cấp credential và ai provision. KHÔNG đụng ledger/reconcile core. Internal endpoint chi tiết ở `BE/feature_connector_onboarding_tech.md` §3.

#### 4.3.2 Fallback — BYO API key + auto-register (standard API ✅ verified)

**Base URL:** `https://app.apipay.vn` · **Auth:** `Authorization: Bearer base64(accessKey:secretKey)` · **Banks:** `/v2/client/banks` · **Webhooks:** `/v1/client/webhooks`.

**Owner làm (chỉ fallback):** ApiPay dashboard → *Tích hợp → API Keys* → copy `accessKey` + `secretKey` → dán vào Plexco. TK ngân hàng phải đã được liên kết trong ApiPay.

```typescript
async function connectApiPayByo(ctx: TenantCtx, accessKey: string, secretKey: string) {
  const conn = await db.providerConnections.upsert(ctx, {
    provider: "apipay", authMode: "api_key",
    apiAccessKeyEnc: kms.enc(accessKey), apiSecretKeyEnc: kms.enc(secretKey),
    status: "connecting",
  });

  // 1. validate + liệt kê TK ĐÃ LIÊN KẾT (v2)
  const res = await apipay.get("/v2/client/banks", { accessKey, secretKey });
  const banks = res.message; // [{ id, publicId, status, manualActivationPending, ... }]

  // 2. chỉ đăng ký webhook cho TK dùng được
  for (const bank of selected) {
    if (bank.status !== "ACTIVE" || bank.manualActivationPending) {
      markPendingActivation(ctx, bank);
      continue;
    }
    const webhookToken = randomOpaque();
    const wh = await apipay.post("/v1/client/webhooks", { accessKey, secretKey }, {
      webhookUrl: `${API_BASE_URL}/webhook/apipay/${webhookToken}`,
      bankPublicId: bank.publicId,
      type: "ALL",
    });
    await db.bankAccounts.insert(ctx, {
      provider: "apipay", providerConnectionId: conn.id, webhookToken,
      providerWebhookId: wh.id, providerBankRef: bank.publicId,
      webhookSecretEnc: kms.enc(wh.secret),
      autoRegistered: true, webhookStatus: "registered",
    });
  }
}
```

- **Trạng thái TK BYO:** `ACTIVE` dùng được; `INACTIVE` đã tắt; `PENDING`/`manualActivationPending=true` chưa được register, UI hiện "đang chờ kích hoạt" và cron re-check.
- **Chưa có TK liên kết:** `GET /v2/client/banks/available` để hiện bộ chọn/hướng dẫn flow ApiPay; Plexco không nhập hộ PII tài chính.
- **Verify Tier 2:** `transaction.in` đầu tiên qua webhook → `webhook_status='active'`.
- **Vòng đời:** `PATCH /v1/client/webhooks/:id`, `DELETE /v1/client/webhooks/:id`, `GET /v1/client/webhooks/:id/history`.

---

## 5. Webhook receiver (thống nhất)

| Method | Path | Verify chữ ký (timing-safe trên RAW body, BL-SEC-2) |
|---|---|---|
| POST | `/webhook/zalo/:token` | Resolve opaque token through the narrow tenant-bound endpoint resolver; require ciphertext and `connecting|registered|active|drift`, KMS-decrypt `zalo_bots.webhook_secret_enc` and timing-safe compare `X-Bot-Api-Secret-Token`; `connecting` without ciphertext plus `error|revoked` fail closed; no plaintext fallback |
| POST | `/webhook/sepay/:token` | Production: `X-SePay-Signature: sha256=<hex>` = HMAC-SHA256(`{X-SePay-Timestamp}.{rawBody}`, secret), timestamp ±300s. Explicit API-key fallback: `Authorization: Apikey <key>` |
| POST | `/webhook/apipay/:token` | `ApiPay-Signature` == HMAC-SHA256(**rawBody**, `webhook_secret`) |

### 5.1 Raw-body requirement (sửa theo góp ý)

Chữ ký HMAC **phải** tính trên **bytes thô của request**, không phải JSON đã parse → stringify lại (re-serialize đổi thứ tự key/spacing làm sai chữ ký). Contract handler (Next.js Route Handler hoặc adapter HTTP tương đương):

```typescript
// Đọc raw bytes MỘT LẦN trước khi JSON.parse; không gọi request.json() trước.
const rawBody = Buffer.from(await request.arrayBuffer());

function verifyApipay(request: Request, rawBody: Buffer): boolean {
  const sig = request.headers.get("ApiPay-Signature") ?? "";
  const expected = crypto.createHmac("sha256", secret)
                         .update(rawBody)                // RAW, không JSON.stringify(parsedBody)
                         .digest("hex");
  const actualBytes = Buffer.from(sig, "hex");
  const expectedBytes = Buffer.from(expected, "hex");
  return actualBytes.length === expectedBytes.length
    && crypto.timingSafeEqual(actualBytes, expectedBytes);
}

function verifySepay(request: Request, rawBody: Buffer): boolean {
  const timestamp = request.headers.get("X-SePay-Timestamp") ?? "";
  const signature = request.headers.get("X-SePay-Signature") ?? "";
  if (!/^\d+$/.test(timestamp) || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  const expected = "sha256=" + crypto.createHmac("sha256", secret)
    .update(Buffer.concat([Buffer.from(`${timestamp}.`), rawBody]))
    .digest("hex");
  const a = Buffer.from(signature), b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
```

### 5.2 Pipeline (giữ ingest hiện có — TDD §3.6)

```
1. :token → (zalo_bots | bank_accounts).webhook_token → tenant_id + encrypted-secret ref (B1)
2. require encrypted secret + allowed state (`connecting|registered|active|drift`); narrow KMS decrypt + timing-safe verify trên RAW body; missing secret/`error|revoked`/bad verify → 401, không persist; không log/return secret (B3)
3. verify account_fingerprint khớp payload (token A + account B → 409)   (BL-PAY-6)
4. BEGIN; SET LOCAL app.tenant_id;
   INSERT bank_transactions ... ON CONFLICT (tenant_id,provider,external_id) DO NOTHING
   enqueue pg-boss 'reconcile' cùng transaction; COMMIT
5. nếu là event ĐẦU TIÊN của connection → CAS Tier 2 chỉ từ connecting|registered:
     zalo_bots.status='active' · bank_accounts.webhook_status='active'; active giữ nguyên, drift không bị clear
     emit analytics connector_verified
6. return 200 (cả first-time lẫn duplicate)
```

---

## 6. Screens & States (nâng cấp wizard onboarding)

| Surface | Loading | Ready | Error | Empty |
|---|---|---|---|---|
| SePay connect | redirect OAuth | "Kết nối SePay" → chọn TK → `registered` → `active` (giả lập GD) | OAuth từ chối / token hết hạn → kết nối lại | chưa kết nối: CTA + giải thích |
| ApiPay connect | spinner provision/status | **Primary:** chọn/xác nhận TK host → enterprise provision → `registered` → `active`; CTA phụ "Dùng ApiPay key riêng" mở BYO form | enterprise unavailable/unsupported → mời BYO; provision fail → retry cùng idempotency key; BYO key sai/PENDING hiện lỗi riêng | chưa chọn TK: CTA "Thiết lập tài khoản nhận tiền"; BYO chỉ ở fallback |
| Zalo connect 🟡 | (blocked) | *thiết kế dự kiến* — ô dán token → `registered` → `active` | token sai / setWebhook fail → fallback dán URL | chưa kết nối: CTA "Kết nối Zalo" |

> Mọi màn có trạng thái "đang chờ tín hiệu thử" (registered→active) với CTA rõ ("Nhắn cho bot" / "Giả lập giao dịch" / "CK thử").

---

## 7. API Contract (endpoint nội bộ Plexco — nâng cấp `/api/onboarding/*`)

| Method | Path | Auth | Mô tả |
|---|---|---|---|
| POST | `/api/onboarding/sepay/oauth/start` | TenantOwner (cookie+CSRF) | Tạo `oauth_transactions` (state+PKCE) → trả authorize URL |
| GET  | `/api/onboarding/sepay/oauth/callback` | **state-bound (PKCE), KHÔNG cookie** | `consume_oauth_transaction(state)` SECURITY DEFINER → đổi token → list bank-accounts → rotate session |
| POST | `/api/onboarding/sepay/webhooks/register` | TenantOwner | `POST /api/v1/webhooks` cho TK đã chọn (contract §4.2.2) |
| POST | `/api/onboarding/sepay/token/connect` | TenantOwner | **Fallback explicit:** store outbound API token as `auth_mode='api_token'`; never relabel as OAuth/APIpay key |
| POST | `/api/onboarding/apipay/provision` | TenantOwner | **Primary:** `Idempotency-Key` + `{bankSelectionRef, consent:true}` → enterprise provision/bind per-host bank + webhook; response chỉ IDs/status, không secret. Full contract: BE spec §3 |
| POST | `/api/onboarding/apipay/connect` | TenantOwner | **Fallback BYO:** nhận accessKey+secretKey → `GET /v2/client/banks` |
| POST | `/api/onboarding/apipay/webhooks/register` | TenantOwner | BYO fallback: `POST /v1/client/webhooks` cho TK `ACTIVE` đã chọn |
| POST | `/api/onboarding/zalo/connect` 🟡 | TenantOwner | *(blocked CO-OQ-1)* token → `getMe` → `setWebhook` |
| GET  | `/api/onboarding/connectors/status` | TenantOwner | Trạng thái từng connector theo vocabulary §3.1 |

### Rate limits (BL-SEC-5)

| Endpoint | Limit |
|---|---|
| `*/connect`, `*/provision`, `*/webhooks/register` (gọi provider API) | 5 / 10 phút / tenant |
| OAuth start/callback | 10 / phút / IP |
| `POST /webhook/{provider}/:token` | Không áp app-level user limit; edge per-token/IP burst cap + body-size cap theo `deployment-infra.md §6` (sized ≥100/s/token target) |

### Error codes (tiếng Việt, không lộ secret)

| Code | Error Code | Message | Trigger |
|---|---|---|---|
| 400 | `APIPAY_BANK_SELECTION_INVALID` | "Phiên chọn tài khoản không hợp lệ hoặc đã hết hạn" | `bankSelectionRef` sai tenant/owner, expired hoặc consent thiếu |
| 409 | `IDEMPOTENCY_KEY_REUSED` | "Yêu cầu này đã được dùng cho dữ liệu khác" | cùng key, request hash khác |
| 422 | `APIPAY_ENTERPRISE_BANK_UNSUPPORTED` | "Ngân hàng này chưa được hỗ trợ tự động" | enterprise không phủ bank → hiện BYO fallback |
| 502 | `APIPAY_ENTERPRISE_PROVISION_FAILED` | "Chưa thể thiết lập ApiPay, vui lòng thử lại" | provider create/bind fail; retry cùng key |
| 503 | `APIPAY_ENTERPRISE_UNAVAILABLE` | "Kết nối tự động tạm chưa sẵn sàng" | platform credential/enterprise gate unavailable → hiện BYO fallback |
| 401 | `APIPAY_KEY_INVALID` | "accessKey/secretKey không đúng" | `GET /v2/client/banks` 401 |
| 409 | `APIPAY_BANK_NOT_ACTIVE` | "Tài khoản chưa kích hoạt, vui lòng đợi" | bank `PENDING`/`manualActivationPending` |
| 502 | `PROVIDER_WEBHOOK_REGISTER_FAILED` | "Đăng ký webhook thất bại" | provider API lỗi → fallback |
| 401 | `SEPAY_OAUTH_DENIED` | "Bạn chưa cấp quyền cho Plexco" | OAuth deny/timeout |
| 400 | `OAUTH_STATE_INVALID` | "Phiên kết nối hết hạn, thử lại" | `state` không khớp/đã dùng/hết hạn |
| 400 | `ZALO_TOKEN_INVALID` 🟡 | "Token bot không hợp lệ" | `getMe` fail |
| 409 | `BANK_ALREADY_BOUND` | "TK ngân hàng đã gắn ở CLB khác" | fingerprint trùng tenant khác |

### Idempotency

| Endpoint | Idempotent? | Key |
|---|---|---|
| `*/webhooks/register` | ✅ | `(tenant_id, provider, provider_bank_ref)` — đã có webhook thì reuse |
| `apipay/provision` | ✅ | Required `Idempotency-Key`, stored as `(tenant_id, route, key, request_hash, response)`; same key+hash returns original IDs, different hash → 409. Provider-side replay requires verified idempotency key or exact deterministic lookup/reuse; otherwise enterprise path stays unavailable |
| `zalo/connect` | ✅ | `(tenant_id)` — `zalo_bots` UNIQUE(tenant) |
| `oauth/callback` | ✅ | `state` dùng 1 lần |

---

## 8. Edge Cases (Backend)

| # | Category | Case | Xử lý |
|---|---|---|---|
| 1 | Provider-failure | `setWebhook`/`POST /webhooks` timeout | `status=error`, giữ credential, cho retry; vẫn fail → fallback dán URL (B6) |
| 2 | Concurrency/Security | Webhook đến trước khi `registered` xong | Chỉ row `connecting` **đã có ciphertext** mới được verify; hợp lệ → CAS `connecting→active`. Connect finalization sau đó chỉ CAS `connecting→registered`, nên giữ `active`. `connecting` thiếu ciphertext/`error|revoked` reject; không plaintext fallback |
| 3 | Security | Token A + account B trong payload | 409/401, không route theo nội dung (BL-PAY-6) |
| 4 | Security | HMAC tính trên JSON re-serialize | **Dùng raw body** (§5.1); test bằng payload có unicode/space lạ |
| 5 | Concurrency | 2 lần bấm "Kết nối" đồng thời | UNIQUE(tenant,provider) + upsert idempotent; 1 webhook |
| 6 | Data integrity | Provider tạo webhook OK nhưng DB commit fail | Lưu `provider_webhook_id` trong cùng transaction; lệch → reconcile job `DELETE` webhook mồ côi |
| 7 | Concurrency | Duplicate transaction đồng thời | `UNIQUE(tenant,provider,external_id)` DO NOTHING |
| 8 | Drift | Owner tự đổi webhook URL ở dashboard | cron phát hiện → auto re-register (Zalo `setWebhook`, ApiPay `PATCH`) |
| 9 | Token lifecycle | SePay refresh token hết hạn | `status=error` + nhắc kết nối lại; không ảnh hưởng TK khác |
| 10 | Data integrity (ApiPay) | TK `PENDING`/`manualActivationPending` | Không register; hiển thị "chờ kích hoạt"; cron re-check; register khi `ACTIVE` |
| 11 | Security (OAuth) | `state` giả/replay ở callback | `OAUTH_STATE_INVALID`; state dùng 1 lần, TTL 10', không có state → từ chối |
| 12 | Cross-feature | Gỡ connector | revoke OAuth / `DELETE /webhooks/:id` + set `revoked`; giữ lịch sử `bank_transactions` |
| 13 | Security | Secret rò trong log | Redact mọi tầng; chỉ lưu `last_error_code` (BL-SEC-1) |
| 14 | Abuse | Spam `*/connect` dò key | Rate limit BL-SEC-5 5/10min/tenant |
| 15 | Data integrity | ApiPay trả secret mới khi rotate | Cập nhật `webhook_secret_enc` atomic; verify dùng secret hiện hành |
| 16 | Security | SePay HMAC timestamp stale/future hoặc signature sai | 401 trước JSON parse/persist; không fallback sang API key |
| 17 | Security | SePay API-key fallback sai scheme/header | Chỉ accept exact `Authorization: Apikey <key>` constant-time; bare `Apikey` header hoặc casing/scheme khác reject |
| 18 | Concurrency (ApiPay enterprise) | retry/time-out hoặc 2 request provision đồng thời | Lock `(tenant_id,'apipay')` + persisted idempotency record; không tạo account/webhook thứ hai |
| 19 | Security (ApiPay enterprise) | client gửi platform secret/API key hoặc bankSelectionRef tenant khác | schema reject unknown secret fields; ref phải bound tenant+owner+TTL+consent, fail trước provider call |

---

## 9. Analytics Events

| Event | Khi nào | Payload (no PII) |
|---|---|---|
| `connector_connect_started` | bấm Kết nối | provider, tenant_id |
| `connector_registered` | Tier 1 (`registered`) | provider, auto_registered, duration_ms |
| `connector_verified` | Tier 2 (`active`) | provider, time_to_verify_ms |
| `connector_register_failed` | provider API fail | provider, error_code |
| `connector_drift_repaired` | auto re-register OK | provider |

---

## 10. Acceptance Criteria

- [ ] Chủ CLB kết nối SePay chỉ bằng OAuth consent (không dán token); webhook tạo tự động theo contract §4.2.2.
- [ ] ApiPay phase-1 primary dùng enterprise auto-provision: host không nhập platform credential, tiền vẫn về TK riêng của host; BYO 2-key chỉ là fallback và TK `PENDING` hiển thị đúng.
- [ ] `/apipay/provision` retry/crash không tạo provider resource trùng; enterprise path fail-closed OFF nếu provider chưa chứng minh idempotency key hoặc exact deterministic lookup/reuse.
- [ ] Luồng chính SePay/ApiPay không bắt owner dán webhook URL; manual URL chỉ còn là fallback khi provider API fail hoặc Zalo chưa gỡ CO-OQ-1.
- [ ] Mỗi connector hiện trạng thái theo vocabulary §3.1 (`registered` → `active`) và xác minh được bằng event/giả lập.
- [ ] Early verified event không bị connect finalization hạ `active→registered`; transition dùng CAS decision table và chỉ emit `connector_verified` một lần.
- [ ] Verify webhook timing-safe **trên raw body**; routing theo token (BL-PAY-6); RLS fail-closed (BL-TEN-1).
- [ ] OAuth callback không phụ thuộc cookie; chống replay bằng state 1 lần + PKCE.
- [ ] Provider API fail có fallback, không chặn cứng onboarding (B6).

---

## 11. Rollout Plan (work-backwards, phân pha)

> Đích: owner thấy chip xanh "Đã xác minh" mà không đụng webhook URL. Đi ngược:

1. **M1 — Webhook receiver + verify 2 tầng + raw-body HMAC** trên route đã có; flip `active` khi nhận event đầu.
2. **M2 — ApiPay enterprise auto-provision (PRIMARY, DD-30):** platform KMS credential → per-host bank/webhook, idempotent + audited; tiền vẫn về TK host. Ship cùng BYO `api_key` fallback và xử lý `PENDING`.
3. **M3 — SePay OAuth2**: cần đăng ký partner lấy `client_id/secret` (CO-OQ-2) + state/PKCE; fallback token mode kèm; tùy chọn poll `/transactions`.
4. **M4 — Zalo auto `setWebhook`** — *chỉ bắt đầu sau khi gỡ CO-OQ-1 (sandbox confirm)*; land KMS legacy-secret migration + ciphertext/state decision table + early-event CAS regressions trước khi bật receiver; kèm drift auto re-register.
5. **M5 — Dọn fallback & telemetry**: đo `time_to_verify`, tỉ lệ auto-register; ẩn dần luồng nhập tay.

### Metrics

Tỉ lệ kết nối không-chạm-webhook, `time_to_verify_ms` trung vị, tỉ lệ `connector_register_failed`, số lần drift auto-repair.

---

## 12. Open Questions

| ID | Quyết định | Trạng thái |
|---|---|---|
| CO-OQ-1 | **(P0 blocker Zalo)** Zalo Bot API có `setWebhook`/`getWebhookInfo` chính thức trên tier CLB dùng? endpoint/tham số/secret header — confirm qua sandbox | ⬜ Chưa chốt |
| CO-OQ-2 | Đăng ký Plexco làm SePay OAuth2 partner (`client_id`/`client_secret`, redirect URI) | ⬜ Chưa chốt |
| CO-OQ-3 | SePay: webhook (`webhook:write`) hay poll `/transactions`, hay hybrid theo TK | ⬜ Chưa chốt |
| CO-OQ-4 | Giữ luồng "dán webhook URL tay" làm fallback chính thức hay chỉ cứu hộ | ⬜ Chưa chốt |
| CO-OQ-5 | Verify Tier 2 SePay: ưu tiên "giả lập giao dịch" hay CK thật số nhỏ | ⬜ Chưa chốt |
| CO-OQ-6 | SePay `is_verify_payment`/`skip_if_no_code` | ✅ Chốt (DD-02): **`skip_if_no_code=0`** (giữ tx không-code cho name-fallback), `is_verify_payment=0` (Plexco tự match qua resolver core). Options này chỉ thuộc **SePay adapter**, không vào core contract. |
| CO-OQ-7 | SePay inbound authentication | ✅ **Chốt 2026-07-17 theo official docs:** production `HMAC_SHA256`, `X-SePay-Signature` + `X-SePay-Timestamp`, signed `{timestamp}.{raw_body}`, freshness 300s; API-key fallback exact `Authorization: Apikey <key>`. Retry/status mapping vẫn là sandbox evidence, không làm auth contract mở |

---

## 13. Changelog

| Date | Version | Thay đổi |
|---|---|---|
| 2026-07-27 | v1.0 | Add regional capability boundary: current connector authority is Vietnam `sepay|apipay`; entitlement is distinct from market/provider/bank/currency/consent/runtime availability. Manual remains global; research does not authorize a provider/rollout. |
| 2026-07-24 | v0.9c | **De-pin migration-tail** (docs-migration-tail-0018-to-0020-sweep, round-01 codex expansion): TARGET-migration comment (`zalo_bots` `webhook_secret_enc`, L230) hard-pinned `tail = 0018` → non-pinned "verify tail hiện hành tại `packages/db/migrations/`, không hard-pin số" (live tail nay `0020`; `0019`/`0020` tenant-integrity FKs DD-68). Numbering guidance giữ nguyên. Pre-existing dated changelog giữ verbatim. Không đổi contract. |
| 2026-07-23 | v0.9b | **Reconcile 0014 merge-state:** current-state TARGET-migration comment (`zalo_bots` `webhook_secret_enc`) sửa → `0014_players_waitlist` **đã merge trên `main`** (`1a6ac38`, tail = 0018), trước ghi "hiện branch-only". Numbering guidance giữ nguyên. Pre-existing dated changelog giữ verbatim. Không đổi contract. |
| 2026-07-19 | v0.9a | Metadata sweep (index v2.35): thêm trường **Implementation** đồng bộ BUILD-STATUS (Not started). Không đổi contract. |
| 2026-07-17 | v0.9 | **Zalo secret/lifecycle closure:** distinguish live `0004` from the pending KMS migration; replace plaintext `secret` with `webhook_secret_enc`, backfill-or-disable/drop/no-dual-read; pin ciphertext+state receiver matrix and CAS transitions so an early event cannot be downgraded from `active` to `registered`. |
| 2026-07-17 | v0.8 | **ApiPay enterprise-first closure:** make DD-30 provisioning the primary Product/UI/API path; move BYO API key to explicit owner-selected fallback; pin `/apipay/provision` input, secret-free response boundary, durable idempotency and enterprise-specific errors/tests mirror. |
| 2026-07-17 | v0.7 | **DD-30/DD-67 closure:** Product capability/DDL/API/rollout now represent ApiPay `enterprise` as phase-1 primary with BYO `api_key` fallback; Zalo Tier-2 reachability binds the exact bot/OA-scoped channel identity instead of a tenant/person-wide row. |
| 2026-07-17 | v0.6 | **SePay auth closure:** refresh official provider contract; production HMAC_SHA256 + timestamp/raw-body/constant-time verify; exact API-key fallback header; close CO-OQ-7 without claiming sandbox retry evidence. |
| 2026-07-10 | v0.5 | **DD-37:** note kênh phase-1 = Zalo + Messenger + web (Telegram loại). Messenger onboarding (FB Login + Page per-club, DD-33) trỏ `feature_player_messenger.md`; connector Zalo/SePay/ApiPay không đổi. Bỏ ẩn dụ "như Telegram". |
| 2026-06-20 | v0.4 | Fix review: dùng `rotation_pending` thay lifecycle status ngoài enum; `oauth_transactions` dùng SECURITY DEFINER lookup-by-state thay vì tenant RLS; backfill `bank_accounts.webhook_status`; định nghĩa owner/rollup của `provider_connections.status`; đồng bộ edge webhook limit |
| 2026-06-20 | v0.3 | Thêm bảng nguồn kiểm chứng provider, làm rõ Zalo vẫn manual đến khi gỡ CO-OQ-1, sửa endpoint UI ApiPay thành `/v2/client/banks`, làm rõ acceptance cho fallback manual, thêm CO-OQ-7 cho SePay inbound webhook sandbox. Patch nit: bổ sung scope `bank-account:read` ở TL;DR cho khớp §2.1/§4.2, ghi nguồn `bank_sub_account_ids` = `/bank-accounts/{id}/sub-accounts` (verified docs). |
| 2026-06-20 | v0.2 | **Sửa theo review:** (1) Zalo hạ xuống *candidate, blocked CO-OQ-1*, nhất quán đầu↔cuối file. (2) SePay `POST /api/v1/webhooks` viết lại contract đầy đủ (`bank_account_id`, `name`, `event_type`, `authen_type`, `is_verify_payment`, `api_key`, `request_content_type`...). (3) ApiPay banks → `/v2/client/banks` + xử lý `ACTIVE/INACTIVE/PENDING`/`manualActivationPending`. (4) Thống nhất vocabulary trạng thái + migration đổi CHECK `zalo_bots`. (5) SePay OAuth state/PKCE + `oauth_transactions`, callback không dựa cookie. (6) Verify HMAC trên raw body. |
| 2026-06-20 | v0.1 | Bản plan đầu: auto-register webhook 3 connector, verify 2 tầng, delta schema, rollout 5 mốc. |
