# 🔐 B0 Design-probe — Auth proof + credential lifecycle (Google + email)

> **Mục đích:** đóng gate **B0** ở `pre-code-open-items-2026-07-16.md` trước khi author bộ slice D1. Probe này cover đủ ba phần B0: Google OIDC proof, email register/verify/login/forgot/reset/revoke và `link_code` transactional consume. Nó pin state owner, transactional boundary, exact uniqueness/expiry/cleanup và ranh giới authz; **không** biến proposal thành runtime evidence.
> **Ngày:** 2026-07-18 · **Trạng thái:** ✅ **Owner duyệt cả 6 mục (2026-07-19) — DD-80, decisions v1.77.** Design-ready; migration/runtime chưa tồn tại, email provider fail-closed OFF
> **Review-fix (2026-07-18):** pending registration chuyển sang nhiều attempt độc lập, verify-first install credential (không last-writer-wins) · delivery reuse pg-boss với retry/backoff/DLQ và payload mã hoá · trusted-client-IP reuse đúng live DO/Fly resolver, Cloudflare là fail-closed revalidation gate · login credential freshness + optional rehash + session mint dùng một transactional finalizer để đóng race với reset · OAuth callback dùng transaction + browser-binding cookie `SameSite=Lax` riêng, còn email verify/reset dùng non-mutating landing → same-origin POST để cookie `Strict` không tự chặn flow và link scanner không consume token · OAuth state issue có bucket riêng trước insert/cookie · verify/reset pin thứ tự IP → non-mutating token-target resolve → target/invalid-artifact bucket → consume · PKCE ciphertext dùng canonical `bytea` · logout-all trả 401 khi gọi lại.
> **Defect fix v2 (2026-07-19, decisions v1.83 — từ AP-26 HALT v2):** §6/§10 pin rotate CREATE-OR-REPLACE parent-first trong 0015 (đóng deadlock logout-all×rotate), `auth_audit_events` tạo tại D0 (order-2 reuse), export root index.ts thuộc scope D0.
> **Defect fix (2026-07-19, decisions v1.78 — từ AP-26 HALT):** §4.1 `auth_oauth_transactions` thêm `terminal_at` + lifecycle CHECK (ciphertext NOT NULL chỉ khi chưa terminal) thay CHECK NOT-NULL vĩnh viễn tự mâu thuẫn với NULL-on-consume.
> **Review-fix (2026-07-19):** thống nhất parent-first auth lock hierarchy sau read-only candidate resolve + DD-70 inbox fence có điều kiện · password reset revoke account-issued `link_code` và cancel merge artifact còn actionable trong cùng transaction · tách public command receipt khỏi provider-send idempotency key · thêm cookie-reachable `POST /api/auth/email/verify/resend` · enforce Argon2id PHC format/floor tại mọi credential-install boundary · refresh authority theo Identity Product/Tech v1.10, Notifications Product v3.4g và `standards/decisions.md` v1.73. Đây vẫn chỉ là probe, không phải runtime evidence.
> **Canonical đã đọc (theo thứ tự HARD RULE):** `packages/db/schema.ts` + `packages/db/migrations/*.sql` → `features/BE/feature_web_auth_onboarding_tech.md` v2.7 §2–§4 → `features/feature_identity.md` v1.10 §3 → `features/BE/feature_identity_tech.md` v1.10 §4–§5 → `features/feature_notifications_reminders.md` v3.4g §4/§6 → `standards/decisions.md` v1.73 DD-13/DD-31/DD-33/DD-37/DD-50/DD-53/DD-70.
> **Live-runtime boundary:** `main@22c23aa` vẫn là Telegram-era auth. Google/email tables, adapters, routes, delivery job và `link_code` consume runtime dưới đây **chưa tồn tại**.

---

## 0. TL;DR — quyết định đề xuất

1. **Account-wide revoke chưa tồn tại.** `auth_revoke_web_session(p_token_hash)` chỉ thu hồi một session. Primitive mới phải tách thành helper nội bộ revoke-by-account và public wrapper derive account từ current session; không grant một function tin `account_id` do caller đưa vào.
2. **Email là provider-neutral verified contact**, không phải cột riêng của password credential. Bảng mới `account_emails` sở hữu `email_lookup_hash` + `email_enc`; Google và email/password cùng dùng record này. `email_password_credentials` chỉ sở hữu password hash.
3. **Giữ `account_identities.verified_at NOT NULL`.** Pending registration không tạo identity row. Verify-time mới atomically tạo `platform='email'` identity bằng hash đọc từ `account_emails`, không nhận hash từ request.
4. **Verify/reset token là 256-bit random token + một SHA-256 hash-at-rest.** Không copy `link_codes.code_hash/salt/failed_attempts`: slow verifier chỉ cần cho human-entered short code; email URL token đã có entropy cao.
5. **Forgot-password chạy qua protected outbox → canonical pg-boss.** Public request luôn normalize/hash/rate-limit, ghi encrypted delivery record bền rồi trả cùng response. `app_worker` dispatcher mới enqueue `auth-email-delivery` bằng pg-boss; worker delivery lookup account và send/no-op. Request role không được cấp pg-boss DML và không dựng queue/status/claim lifecycle song song.
6. **Canonical drift chọn một hướng:** migrations là runtime authority và `schema.ts` mirror mọi table, kể cả table chỉ được SECURITY DEFINER function chạm. Không tạo ngoại lệ “function-only table nằm ngoài Drizzle”.
7. **Email login finalize là một transaction bắt buộc.** Sau app-side Argon2 verify, DB phải re-check exact stored PHC dưới lock, optional rehash và create/rotate session + success audit atomically. Password reset dùng cùng lock order; không có cửa mint session bằng password cũ sau revoke-all.
8. **Không reuse transport của Telegram cho cross-site redirect/link.** Google/Facebook callback dùng `auth_oauth_transactions` + cookie browser-binding `Secure; HttpOnly; SameSite=Lax` path-scoped; không gọi `sameOriginRequest()`. Email verify/reset GET chỉ landing+scrub, không mutation; explicit same-origin POST mới consume. Session cookie vẫn `SameSite=Strict`.
9. **Mọi public artifact issuer/consumer phải bị chặn trước mutation.** OAuth state issue dùng bucket trusted-IP riêng trước insert/cookie; callback dùng bucket khác. Verify/reset check trusted-IP trước, rồi non-mutating resolve token hợp lệ sang stored email lookup hash để check target bucket; token invalid/inactive đi qua bucket HMAC riêng và không tạo account-existence signal.
10. **Một lock hierarchy cho toàn bộ auth/identity giao nhau.** Mọi path resolve candidate read-only trước, lock DD-70 inbox fence nếu path sẽ emit global item, rồi mới lock `accounts` → `account_emails` parent → attempt/token child → credential → sessions → account-issued `link_codes`/actionable merge artifacts → audit. Sau lock phải re-resolve/revalidate; drift rollback/retry. Không path global nào được fallback sang tenant outbox.
11. **Public command replay và provider-send replay là hai khóa khác nhau.** UUID `Idempotency-Key` của register/resend/forgot bind server-side với owner-scope + operation + target fingerprint; mismatch trả generic reject và zero credential/account/delivery mutation (redacted security audit được phép). Provider nhận một opaque key riêng derive từ immutable delivery id, không nhận command key của client.
12. **Mọi credential install đều đi qua một PHC validator owner-only.** Register, verify-copy, reset và login rehash chỉ persist Argon2id PHC đúng version/shape, không thấp hơn floor và không vượt operational ceiling đã version; direct table DML bị revoke và constraint trigger dùng cùng validator.

---

## 1. Live-schema inventory

| Đối tượng | Hình dạng thật | Kết luận |
|---|---|---|
| `accounts` | `{id, person_id, created_at}` | Không email/credential |
| `account_identities` | `{id, account_id, platform, platform_user_hash, verified_at NOT NULL}` · `UNIQUE(platform, platform_user_hash)` | Row tồn tại nghĩa là provider identity đã verify |
| `web_sessions` | `{id, account_id, token_hash UNIQUE, csrf_secret, expires_at, rotated_from, revoked_at, created_at}` | Revoke hiện là soft-flag từng token |
| `link_codes` | Live table còn thiếu `source_account_id`, `max_attempts`, `locked_until`, `revoked_at` so với current `feature_identity_tech.md` v1.10 (v1.9 chốt DD-70 merge-notification ownership; v1.10 chốt DD-50 parent-first consume) | Product/Tech contract đã cùng thứ tự với reset; migration/runtime consume và barrier proof reset-vs-consume chưa land |
| `magic_links` | `{hash UNIQUE, person_id, channel, session_id, expires_at, used_at}` | Không phù hợp verify/reset: thiếu purpose và lifecycle riêng |
| `auth_login_nonces` · `auth_login_state` · `rate_limit_hits` | Có trong `0012_auth_functions.sql`, chưa mirror ở `schema.ts` | Canonical mirror drift; xử lý ở §9 |

**Function surface live:** `auth_login_telegram` · `auth_login_state_issue/consume` · `auth_create_web_session` · `auth_resolve_web_session` · `auth_rotate_web_session` · `auth_revoke_web_session` (single-token) · `tenant_provision` · `tenant_ids_for_person` · `rate_limit_check`.

**Access pattern phải kế thừa:** role `app` không có blanket grant trên protected global tables. Mọi write/read auth đi qua narrow SECURITY DEFINER function, `SET search_path = public, pg_temp`, public privilege bị revoke, chỉ grant exact function cần thiết và trả tối thiểu dữ liệu.

---

## 2. B0 scope closure — không bỏ sót Google hoặc `link_code`

| B0 lane | Contract đã pin | Live evidence/gap | Probe disposition |
|---|---|---|---|
| **Google OIDC** | Verify provider signature/JWKS rotation; exact `iss`; exact configured client-id `aud` + `azp` khi có; browser-bound state + nonce + PKCE; `exp`/`iat`; stable `sub`; `email_verified === true` | Runtime vẫn là Telegram callback; chưa Google adapter/test | §4 pin identity/collision transaction; D1-Google build độc lập với email-password enablement |
| **Email credential lifecycle** | Không enable partial register/login; verify/reset hash-only, TTL, single-use; forgot enumeration-safe; reset + revoke-all atomic | Không có email/credential/token/delivery storage hoặc routes | §3–§8 pin full state machine, tables, functions, defaults và release gate |
| **`link_code` strong proof** | `feature_identity_tech.md` v1.10 §4 đã pin XOR issuer, read-only candidate resolve, issuer/account/Person parent-before-code lock, current Person revalidation, attempts/lock/revoke/TTL/action và transactional consume tạo durable merge plan; consume không emit global item, merge commit mới append `identity_merged` từ locked `merge_audit` trong cùng transaction | Live `link_codes`/runtime chưa đạt contract; parent-first contract đã aligned nhưng chưa có executable reset-vs-consume/merge barrier proof | B0 **reuse** proof + ordering ở §5.2; không nhồi email token vào `link_codes`; implementation thuộc serialized identity/auth core slice và vẫn fail-closed tới khi migration/runtime + race tests pass |

Google path và `link_code` không được coi là implemented chỉ vì contract đã đầy đủ. B0 là **design-ready gate**; runtime readiness vẫn cần migration, adapter/service, routes và tests.

---

## 3. Canonical owner + exact storage

### 3.1 Provider-neutral verified email

```sql
account_emails (
  id                uuid PRIMARY KEY,
  account_id        uuid NOT NULL REFERENCES accounts(id),
  email_lookup_hash text NOT NULL UNIQUE,
  email_enc         bytea NOT NULL,
  kms_key_version   text NOT NULL,
  verified_at       timestamptz,
  pending_expires_at timestamptz,
  created_at        timestamptz NOT NULL,
  updated_at        timestamptz NOT NULL,
  UNIQUE (account_id),
  CHECK (
    (verified_at IS NULL AND pending_expires_at IS NOT NULL)
    OR
    (verified_at IS NOT NULL AND pending_expires_at IS NULL)
  )
)

email_password_credentials (
  account_email_id uuid PRIMARY KEY REFERENCES account_emails(id),
  password_phc     text NOT NULL,
  updated_at       timestamptz NOT NULL
)

auth_pending_email_registrations (
  id               uuid PRIMARY KEY,
  account_email_id uuid NOT NULL REFERENCES account_emails(id) ON DELETE CASCADE,
  password_phc     text,
  registration_key_hash text UNIQUE,
  expires_at       timestamptz NOT NULL,
  consumed_at      timestamptz,
  superseded_at    timestamptz,
  created_at       timestamptz NOT NULL,
  UNIQUE (id, account_email_id),
  CHECK (
    (consumed_at IS NULL AND superseded_at IS NULL
      AND password_phc IS NOT NULL AND registration_key_hash IS NOT NULL)
    OR
    ((consumed_at IS NOT NULL) <> (superseded_at IS NOT NULL)
      AND password_phc IS NULL AND registration_key_hash IS NULL)
  )
)

CREATE INDEX auth_pending_email_registrations_active_idx
  ON auth_pending_email_registrations(account_email_id, created_at)
  WHERE consumed_at IS NULL AND superseded_at IS NULL;

CREATE INDEX auth_pending_email_registrations_expires_idx
  ON auth_pending_email_registrations(expires_at);

auth_email_deliveries (
  id               uuid PRIMARY KEY,
  kind             text NOT NULL CHECK (kind IN ('verify_email','password_reset')),
  token_id         uuid,
  payload_enc      bytea,
  kms_key_version  text,
  command_id       uuid NOT NULL UNIQUE,
  command_owner_hash text NOT NULL,
  command_operation text NOT NULL CHECK (command_operation IN ('register','verify_resend','forgot')),
  command_target_fingerprint text NOT NULL,
  provider_idempotency_key text NOT NULL UNIQUE,
  provider_key_version text NOT NULL,
  outcome          text NOT NULL CHECK (outcome IN ('queued','delivered','noop','dead_letter','failed_terminal')),
  enqueued_at      timestamptz,
  expires_at       timestamptz NOT NULL,
  terminal_at      timestamptz,
  last_error_class text,
  created_at       timestamptz NOT NULL,
  CHECK (
    (outcome = 'queued' AND terminal_at IS NULL)
    OR
    (outcome IN ('delivered','noop','dead_letter','failed_terminal') AND terminal_at IS NOT NULL)
  ),
  CHECK (
    (outcome IN ('queued','dead_letter') AND payload_enc IS NOT NULL AND kms_key_version IS NOT NULL)
    OR
    (outcome IN ('delivered','noop','failed_terminal') AND payload_enc IS NULL AND kms_key_version IS NULL)
  ),
  CHECK (
    (command_operation IN ('register','verify_resend') AND kind = 'verify_email')
    OR (command_operation = 'forgot' AND kind = 'password_reset')
  )
)

auth_audit_events (
  id               uuid PRIMARY KEY,
  event_type       text NOT NULL,
  account_id       uuid,
  account_email_id uuid,
  outcome_class    text NOT NULL,
  actor_class      text NOT NULL,
  request_ref      text NOT NULL,
  sessions_revoked integer CHECK (sessions_revoked IS NULL OR sessions_revoked >= 0),
  link_codes_revoked integer CHECK (link_codes_revoked IS NULL OR link_codes_revoked >= 0),
  merge_artifacts_cancelled integer CHECK (merge_artifacts_cancelled IS NULL OR merge_artifacts_cancelled >= 0),
  created_at       timestamptz NOT NULL
)

CREATE INDEX auth_email_deliveries_expires_idx
  ON auth_email_deliveries(expires_at);

CREATE INDEX auth_email_deliveries_terminal_idx
  ON auth_email_deliveries(terminal_at)
  WHERE terminal_at IS NOT NULL;

CREATE INDEX auth_email_deliveries_dispatch_idx
  ON auth_email_deliveries(created_at)
  WHERE outcome = 'queued' AND enqueued_at IS NULL;

CREATE INDEX auth_audit_events_created_at_idx
  ON auth_audit_events(created_at);
```

Phase-1 có đúng một primary email mỗi account (`UNIQUE(account_id)`) và đúng một account owner cho mỗi normalized email (`UNIQUE(email_lookup_hash)`). Google-only account có `account_emails` verified nhưng có thể chưa có `email_password_credentials`; một reset hợp lệ được phép tạo password fallback và `platform='email'` identity trong cùng transaction. `email_password_credentials` chỉ được tạo cho email đã verified; password của request chưa verified nằm trong protected `auth_pending_email_registrations` và chỉ attempt thắng mới được promote. Direct DML vào hai cột `password_phc` bị revoke; mọi owner function và một constraint trigger dùng chung `_auth_assert_password_phc(...)` ở §8.1, nên malformed/downgrade PHC không thể đi vào pending hay credential store.

### 3.2 Pending → verified lifecycle

1. **Register:** require UUID `Idempotency-Key`, normalize email một lần và derive command binding theo §3.4 trước mutation; derive lookup hash + encrypted delivery value từ cùng canonical string. App boundary validate raw-password policy, hash Argon2id, rồi owner function bắt buộc `_auth_assert_password_phc(...)` pass trước khi persist. Nếu email chưa có, tạo placeholder `persons` + `accounts` + pending `account_emails`; nếu đã pending, reuse đúng placeholder theo hierarchy §5.2. Mỗi command mới tạo **một** `auth_pending_email_registrations` riêng chứa password PHC + SHA-256 của 32-byte browser registration key, rồi tạo verify token bind đúng `pending_registration_id`. Raw registration key chỉ nằm trong cookie host-only `Secure; HttpOnly; SameSite=Strict`, TTL không vượt attempt, path đúng `/api/auth/email/verify`; đây **không** phải session cookie. **Chưa** tạo `email_password_credentials` hoặc `account_identities`; account chưa login được. Exact command replay không tạo attempt/delivery mới; semantic change, kể cả đổi password candidate, phải dùng command mới và tạo attempt mới.
2. **Re-register/resend:** `POST /api/auth/email/register` với command mới tạo attempt + token mới, **không supersede attempt/token của browser khác** và không thay credential chung. Resend đúng attempt chỉ đi qua `POST /api/auth/email/verify/resend`: path này nhận được cookie `Path=/api/auth/email/verify`, require `sameOriginRequest()`, trusted-IP gate trước read, rồi non-mutating resolve `registration_key_hash` sang candidate attempt/email để áp target-email hoặc invalid-artifact bucket trước hierarchy §5.2. Nó supersede chỉ active verify token của exact attempt, không đổi password/key candidate và không kéo dài attempt TTL. Missing/wrong/terminal key trả cùng generic response và zero mutation. Như vậy attacker có thể tạo traffic bị rate-limit nhưng không thể vô hiệu token/password candidate mà chủ email thật vừa tạo; không còn last-writer-wins trên global email slot.
3. **Verify:** link từ inbox mở `GET /auth/email/verify?token=…` theo two-hop §8.4. GET chỉ render landing + scrub token, **không** lookup/consume/mutate. Sau explicit user gesture, same-origin `POST /api/auth/email/verify` mới mang token và tự gửi cookie registration-key `Strict`; handler require `sameOriginRequest()`, rate-limit, rồi read-only resolve candidate → conditional DD-70 inbox fence → `accounts` → `account_emails` parent → exact pending attempt → token theo §5.2. Sau toàn bộ lock nó revalidate token/attempt/key/owner/fence set chưa drift và mọi artifact chưa expired/consumed/superseded. Trong một transaction: re-assert PHC đã lưu; copy `password_phc` của attempt thắng vào `email_password_credentials`; consume winner và **NULL password/key candidate sau khi copy**; set `verified_at`; clear `pending_expires_at`; insert `account_identities(platform='email', platform_user_hash=<hash read from locked account_emails>)`; supersede mọi attempt/token thua và NULL sensitive candidates; audit. Function không nhận identity hash hoặc password PHC từ verify request. Mở link ở thiết bị khác hoặc thiếu/sai cookie chỉ tạo limited handoff page; token không bị consume, user có thể quay lại browser gốc hoặc đăng ký lại trên browser mới, không silently activate password do browser khác đặt.
4. **Concurrency:** verify của hai attempt cùng email serialize trên `account_emails`. Đúng một transaction promote email; transaction thua thấy `verified_at IS NOT NULL`, không cài password và trả generic token-invalid/already-handled class. Rate limit vẫn giảm email-bombing/DoS nhưng **không được dùng làm ownership proof**.
5. **Login:** lookup verified `account_emails`, require matching verified `account_identities` row và app-side verify Argon2id hash. Sau verify, luôn gọi finalizer §8.1 để re-check expected PHC dưới lock + optional rehash + session mint/audit atomically. Pending/expired/mismatch hoặc finalizer CAS miss trả generic `AUTH_INVALID`, không mint session.
6. **Pending cleanup:** scheduled `auth-email-cleanup` job (**v1.85: kiêm sweep `auth_oauth_transactions` expired-unconsumed — terminalize + NULL ciphertext/key-version, giữ metadata ≤30d rồi delete**) inventory parent read-only, lock `accounts` rồi `account_emails` theo UUID, sau đó attempts/tokens theo UUID như §5.2; terminalize expired attempt (`superseded_at`) + NULL password/key candidate ngay, rồi giữ metadata tối đa 30 ngày để correlate token trước khi delete. Chỉ xoá pending `account_emails` khi không còn active attempt; orphan pending cleanup được phép cascade đúng attempts/tokens của email đó. Chỉ xoá orphan `accounts`/`persons` nếu protected function chứng minh không identity, session, membership, tenant-admin hoặc reference khác. Không cascade qua bảng nghiệp vụ. `pending_expires_at` theo expiry muộn nhất của active attempt và không được extend bởi resend của cùng attempt.

### 3.3 Email normalization + cryptographic binding

- Parse và reject invalid/ambiguous address; trim outer whitespace only.
- Domain: IDNA A-label + lowercase. Local-part: Unicode NFC nhưng **preserve case**; không Gmail dot/plus rewriting, không provider-specific alias folding.
- Một helper duy nhất `deriveEmailArtifacts(rawEmail)` trả `{canonicalEmail, emailLookupHash, emailEnc, kmsKeyVersion}`. HMAC input domain-separated (`plexco:account-email:v1:<canonical>`).
- `email_enc` dùng authenticated encryption; AAD chứa `account_emails.id`, `email_lookup_hash` và version. Delivery boundary decrypts, normalize+rehash lại và constant-time compare với stored lookup hash; mismatch/decrypt failure → fail-closed, không gửi, audit redacted. **v1.86:** khi row `account_emails` được tạo BÊN TRONG một SECURITY DEFINER function (Google cell 1, §4), id trong AAD = id do app preallocate và truyền vào function; function INSERT đúng id đó — không tồn tại path encrypt với id chưa xác định.
- Không log raw/canonical email, ciphertext, token, password hoặc lookup hash đầy đủ. Metrics chỉ giữ outcome class; support UI chỉ dùng masked email.

Như vậy `account_emails` là source of truth cho lookup + delivery. `account_identities(platform='email')` luôn copy hash từ locked row trong DB function, không nhận một cặp hash/ciphertext rời từ controller.

### 3.4 Public command receipt ≠ provider-send key

- `register`, `verify_resend` và `forgot` bắt buộc nhận một UUID `Idempotency-Key` làm `command_id`. UUID này là command identity có entropy cao, **không** phải ownership proof và không được chuyển ra email provider.
- Server derive `command_owner_hash = HMAC("auth-email-command-owner:v1", email_lookup_hash)` và `command_target_fingerprint = HMAC("auth-email-command-target:v1", canonical_json([operation,email_lookup_hash,pending_registration_id?]))`. Resend bắt buộc bind exact pending attempt; register/forgot bind normalized target. Không fingerprint raw password, PHC, token, IP hay ciphertext. Với register, command đầu tiên cố định password candidate; retry cùng command không được overwrite candidate, còn đổi password là command/attempt mới.
- `UNIQUE(command_id)` là fence toàn cục. Conflict chỉ được replay khi stored `command_owner_hash + command_operation + command_target_fingerprint` khớp constant-time; nếu bất kỳ field khác, protected owner ghi redacted `IDEMPOTENCY_KEY_REUSED`, trả public generic reject cùng response class và thực hiện **zero** attempt/token/delivery/account mutation ngoài security audit đó. Các field binding immutable sau insert.
- Exact replay trả fixed domain outcome/delivery ref và không issue token, attempt hoặc provider send thứ hai. Nếu response register đầu tiên mất trước khi browser nhận registration-key cookie, client phải tạo command mới/attempt mới; không được “reconstruct” hoặc trả raw key từ DB. Attempt cũ tự hết hạn theo cleanup.
- Lúc tạo delivery, server derive một khóa provider riêng: `provider_idempotency_key = base64url(HMAC(key_version,"auth-email-provider-send:v1",canonical_json([delivery_id,kind])))`, persist cả key + `provider_key_version` một lần. Retry/DLQ replay luôn dùng giá trị đã persist qua key rotation. Email provider không thấy `command_id`, owner hash hay target fingerprint; local command receipt không được dùng làm bằng chứng upstream dedupe.

---

## 4. Google OIDC account/email collision table

Sau khi **toàn bộ** proof matrix ở §2 pass, app-side mới tính domain-separated HMAC cho `google.sub` và email artifacts. **v1.86 (AAD handoff, owner 2026-07-19):** với cell tạo `account_emails` MỚI (cell 1 new/new), app **preallocate `account_emails.id`** (UUID) trước khi encrypt — AAD của `email_enc` chứa đúng id đó theo §3.3 — rồi truyền id vào function collision để INSERT với chính id này; các cell dùng row sẵn có (2/3/5/6) giữ nguyên ciphertext hiện hữu, không rebind và không nhận id từ caller. Một SECURITY DEFINER transaction xử lý:

| Google subject | Verified email owner | Kết quả |
|---|---|---|
| Chưa có | Chưa có | Tạo Person + Account + verified `account_emails` + Google identity atomically |
| Chưa có | Đã thuộc account A | Gắn Google identity vào **account A**; verified email là DD-50 strong proof, không tạo account thứ hai |
| Chưa có | Pending account A | Promote email cho A; **supersede toàn bộ pending registration attempts + verify tokens, NULL password/key candidates và không copy candidate nào**, rồi attach Google identity để chặn pre-registration hijack |
| Đã thuộc account A | Email cũng thuộc A | Idempotent login; không overwrite display name/email ciphertext ngầm |
| Đã thuộc account A | Chưa có | Login **account A bằng stable subject**; không tự tạo/promote `account_emails`. Muốn thêm/đổi contact phải qua workflow re-auth + verify/notify riêng |
| Đã thuộc account A | Pending account B | Login **account A bằng stable subject**; không attach email, không mutate/supersede attempt/token của B. Pending registration không được DoS một subject login đã sở hữu |
| Đã thuộc account A | Email thuộc account B | `AUTH_IDENTITY_CONFLICT`; không auto-merge Person/Account, không mint session; đi qua DD-53 recovery/link authority |
| Bất kỳ | `email_verified` false/missing hoặc proof cell khác fail | Generic reject; zero account/session mutation |

Existing Google subject là stable identity owner. Email change từ Google không silently rebind account; email-change workflow cần re-auth + verify/notify riêng và nằm ngoài D1 negative scope. Callback/collision transaction cũng phải theo §5.2: read-only inventory subject/email owners → conditional ordered inbox fences → parent tier → identity/attempt/token children; sau locks re-run toàn bộ collision cell. Google promotion không được giữ `account_emails` rồi late-lock một token mà verify đang giữ theo chiều ngược.

### 4.1 Cross-site OAuth transaction + browser binding

Live `auth_login_state` + cookie `SameSite=Strict` đang phục vụ Telegram **same-origin POST** và là primitive mục tiêu cho email form cùng-origin. Nó **không fit** Google/Facebook redirect: authorization response là top-level cross-site `GET`, nên cookie `Strict` không được gửi; `Origin/Referer` cũng không phải same-origin. D1 không được đổi session cookie sang Lax và không được ép OAuth callback qua `sameOriginRequest()`.

Google adapter dùng một owner chung cho redirect flow (Facebook adapter reuse sau khi external gate active):

```sql
auth_oauth_transactions (
  state_hash           text PRIMARY KEY, -- SHA-256 của state 32-byte trong authorization URL
  provider             text NOT NULL CHECK (provider IN ('google','facebook')),
  browser_binding_hash text NOT NULL,    -- SHA-256 của binding 32-byte chỉ nằm trong cookie
  nonce_hash           text,             -- bắt buộc với Google OIDC
  pkce_verifier_enc    bytea,            -- KMS ciphertext; canonical *_enc type; Google S256 only
  kms_key_version      text,             -- opaque KMS key/version reference metadata
  expires_at           timestamptz NOT NULL,
  consumed_at          timestamptz,
  terminal_at          timestamptz,      -- set khi consume HOẶC khi expiry-cleanup terminalize (pattern auth_email_deliveries)
  created_at           timestamptz NOT NULL DEFAULT now(),
  CHECK (consumed_at IS NULL OR terminal_at IS NOT NULL),
  CHECK (
    provider <> 'google'
    OR (terminal_at IS NULL  AND nonce_hash IS NOT NULL AND pkce_verifier_enc IS NOT NULL AND kms_key_version IS NOT NULL)
    OR (terminal_at IS NOT NULL AND pkce_verifier_enc IS NULL AND kms_key_version IS NULL)
  )
)
```

- **Issue:** trước khi insert row hoặc set cookie, require shared `oauth-state:<trusted-ip>` bucket **10/min trên cả Google + Facebook**; limiter/storage failure fail closed và response 429 không tạo row/cookie. Sau gate luôn generate independent `state` + browser binding; **chỉ Google OIDC** generate thêm nonce + PKCE verifier, persist verifier ciphertext với AAD `(state_hash, provider, kms_key_version)` và gửi `nonce + code_challenge=S256(verifier)`. Facebook phase-1 chỉ gửi state/binding theo exact configured-App flow; không claim PKCE capability chưa được pin. Set a provider-specific, host-only cookie containing `{state,binding}` với `Secure; HttpOnly; SameSite=Lax; Path=/api/auth/<provider>/callback; Max-Age<=600`; no `Domain`. Starting a newer flow for the same provider/browser overwrites the cookie, nên older callback fails closed.
- **Callback:** dùng bucket trusted-IP **10/min riêng**, check trước transaction claim/provider exchange; bucket issue không được dùng thay callback bucket. Chỉ exact registered `GET /api/auth/<provider>/callback`; compare query `state` to cookie state, atomically claim row by `state_hash + provider + browser_binding_hash + TTL + consumed_at IS NULL`, rồi clear matching path-scoped cookie. Google exchange dùng stored PKCE verifier và verify exact issuer/client/nonce/time claims; Facebook exchange verify stable subject của exact configured App theo DD-33. Missing/mismatched/expired/replayed state/cookie, **Google** PKCE downgrade, provider error, hoặc provider-specific proof fail ⇒ generic reject, zero account/session mutation. Callback **không** gọi `sameOriginRequest()`; CSRF/browser continuity luôn có one-time state + binding, còn PKCE/OIDC nonce là lớp Google-specific. Session chỉ mint sau mọi proof cell và collision rule tương ứng pass.
- **Leakage fence:** callback response sets `Referrer-Policy: no-referrer`, loads no third-party resource before redirect, and never logs query code/state, cookie binding, nonce or verifier. Row cleanup is indexed by `expires_at`; consumed/expired PKCE ciphertext is NULLed immediately and metadata retained tối đa 30 ngày — **thực thi bằng lifecycle CHECK đúng pattern `auth_email_deliveries` (defect fix v1.78):** ciphertext/key-version bắt buộc NOT NULL chỉ khi `terminal_at IS NULL`; consume và expiry-cleanup đều terminalize row (set `terminal_at`, NULL `pkce_verifier_enc`+`kms_key_version`) trong cùng transaction; metadata row giữ tối đa 30 ngày rồi delete. CHECK NOT-NULL-vĩnh-viễn cũ tự mâu thuẫn với NULL-on-consume và đã bị thay. **Cleanup owner + semantics (v1.85):** "NULLed immediately" cho expired-unconsumed = **tại sweep đầu tiên sau expiry**; cơ chế D1 là sweep-at-traffic trong chính narrow issue/claim functions (đúng shape 0012, không surface mới). Follow-up đã pin: job `auth-email-cleanup` (pg-boss, order-4, §3.2#6) mở rộng sweep thêm `auth_oauth_transactions` khi nó land — không tạo scheduled sweep riêng cho oauth. Chấp nhận cửa sổ order-3→order-4: hệ zero-traffic có thể giữ expired ciphertext quá 30d, mitigated bằng zero runtime grant + claim fail-closed + KMS encryption; consumed-path vẫn NULL ngay trong transaction consume.
- **Storage type:** `pkce_verifier_enc` là `bytea`, cùng convention live `*_enc` và `oauth_transactions.code_verifier_enc`; `kms_key_version` chỉ là metadata text. Không encode ciphertext thành base64 text hoặc tạo ngoại lệ schema ngầm.

---

## 5. Email token model — một verifier thật, không dead columns

### 5.1 Table + exact constraints

```sql
auth_email_tokens (
  id               uuid PRIMARY KEY,
  account_email_id uuid NOT NULL REFERENCES account_emails(id) ON DELETE CASCADE,
  pending_registration_id uuid,
  purpose          text NOT NULL CHECK (purpose IN ('verify_email','password_reset')),
  token_hash       text NOT NULL UNIQUE,
  expires_at       timestamptz NOT NULL,
  consumed_at      timestamptz,
  superseded_at    timestamptz,
  created_at       timestamptz NOT NULL,
  CHECK (consumed_at IS NULL OR superseded_at IS NULL),
  CHECK (
    (purpose = 'verify_email' AND pending_registration_id IS NOT NULL)
    OR
    (purpose = 'password_reset' AND pending_registration_id IS NULL)
  ),
  FOREIGN KEY (pending_registration_id, account_email_id)
    REFERENCES auth_pending_email_registrations(id, account_email_id)
    ON DELETE CASCADE
)

CREATE UNIQUE INDEX auth_email_tokens_one_active_verify_per_attempt_uq
  ON auth_email_tokens(pending_registration_id)
  WHERE purpose = 'verify_email'
    AND consumed_at IS NULL AND superseded_at IS NULL;

CREATE UNIQUE INDEX auth_email_tokens_one_active_reset_uq
  ON auth_email_tokens(account_email_id, purpose)
  WHERE purpose = 'password_reset'
    AND consumed_at IS NULL AND superseded_at IS NULL;

CREATE INDEX auth_email_tokens_expires_at_idx
  ON auth_email_tokens(expires_at);

ALTER TABLE auth_email_deliveries
  ADD CONSTRAINT auth_email_deliveries_token_fk
  FOREIGN KEY (token_id) REFERENCES auth_email_tokens(id) ON DELETE SET NULL;
```

- Raw token = 32 random bytes, base64url; database stores only lowercase SHA-256 hex.
- Không có `salt`, slow `code_hash` hay `failed_attempts`: token có 256-bit entropy và không được người dùng gõ đoán. Brute-force bị chặn ở endpoint rate limit; invalid hash không reveal row existence.
- Verify issue/resend read-only resolve exact pending attempt rồi lock parent → attempt → tokens theo §5.2; nó chỉ supersede active verify token cũ của **attempt đó**. Request từ browser khác tạo attempt/token độc lập. Reset issue read-only resolve email owner rồi lock parent → reset tokens, supersede active reset token cũ của email và insert token mới. Vì expired row có thể vẫn chưa sweep, issue luôn supersede trước insert; partial unique index không dựa vào volatile `now()`.
- Public verify/reset functions **hardcode purpose** theo endpoint. Không expose `p_purpose` để caller chọn.
- Verify delivery cho new/pending registration attempt được tạo với exact `token_id`; register trên email đã verified vẫn ghi cùng delivery shape nhưng `token_id=NULL`, worker đi `noop`. Forgot delivery ban đầu chưa có token; known-account worker issue token rồi set `token_id` + ciphertext trong cùng transaction, unknown account đi thẳng `noop`. FK được add sau token table trong cùng migration vì delivery table được mô tả trước ở §3.

### 5.2 Consume boundary + một canonical lock hierarchy

Internal helper không được grant trực tiếp:

```text
_auth_consume_email_token(p_token_hash, expected_purpose)
  read-only resolve candidate token -> account_email/account/person (+ attempt nếu verify)
  lock conditional DD-70 inbox fence(s), then parent -> attempt/token children
  re-resolve and require exact candidate/fence-set equality
  require exact purpose, unexpired, unconsumed, unsuperseded
  conditional UPDATE ... SET consumed_at = transaction_timestamp()
  RETURNING account_email_id, pending_registration_id
```

`auth_verify_email(p_token_hash, p_registration_key_hash)` gọi helper với literal `verify_email`, require token bind exact pending attempt + matching key, rồi promote email, install password PHC từ attempt thắng, supersede các attempt/token thua, create email identity + audit trong **cùng transaction**.

`auth_reset_password(p_token_hash, p_new_password_phc)` gọi helper với literal `password_reset`, bắt buộc `_auth_assert_password_phc(p_new_password_phc)` pass **trước consume**, rồi upsert credential + email identity fallback nếu cần, supersede mọi reset token còn lại, revoke account sessions, revoke active account-issued `link_codes`, cancel actionable merge artifacts chỉ dựa vào các code đó và audit counts trong **cùng transaction**. Bất kỳ bước nào fail ⇒ toàn bộ token/credential/session/link-code/merge-artifact/audit rollback; return generic invalid, không partial mutation.

**Hierarchy bắt buộc cho mọi register/resend/verify/login/forgot/reset/Google-collision/cleanup và account-issued `link_code` issue/consume giao nhau:**

1. Chạy trusted-IP/target rate gates; protected **read-only, non-locking** lookup inventory candidate `person_id`, `account_id`, `account_email_id`, attempt/token/delivery/code IDs và version cần thiết. Missing/invalid đi generic path, không late-discover owner sau khi đã giữ child lock.
2. Nếu DD-70(a) active **và** path là known global producer (`security_alert` hoặc merge commit phát `identity_merged`), lock mọi candidate Person inbox fence theo UUID trước bất kỳ blocking auth row/advisory lock nào; không emit thì không lock fence giả. Riêng `link_code` consume chỉ verify/consume và tạo durable merge plan, **không emit global notification**; merge commit mới sở hữu append `identity_merged` từ exact locked `merge_audit` trong cùng transaction theo `feature_identity_tech.md` v1.10. Re-read owner set ngay sau fences. Bất kỳ set drift nào rollback/retry; tenant outbox không phải fallback.
3. Với absent email, lấy domain-separated transaction-advisory lock từ `email_lookup_hash`; sau đó lock parent tier: mọi `accounts` row theo UUID, rồi `account_emails` theo UUID. Revalidate `account_emails.account_id`, `accounts.person_id`, verified/pending state và provider-subject collision cell.
4. Lock child tier theo UUID: pending registration attempts → email tokens → delivery/command rows. Không function được giữ token/code/delivery trước rồi đi ngược lên `accounts`/`account_emails` parent.
5. Lock `email_password_credentials`, rồi `web_sessions`, rồi active account-issued `link_codes` + actionable merge artifacts, mỗi tập UUID-order. Account-issued `link_code` issue/consume phải read-only resolve issuer rồi lock canonical account/Person parent trước code row như Identity Product/Tech v1.10; runtime implementation không được regress về code-first. Reset và consume cùng giữ thứ tự này để không tạo lock inversion.
6. Re-resolve toàn bộ mapping, lifecycle predicate, command binding và DD-70 fence set **sau tất cả locks, trước mutation**. Drift/late owner/new child ⇒ rollback/retry từ bước 1; không giữ partial mutation. Chỉ sau pass mới insert fixed audit/source rows, append global item nếu enabled và apply credential/session/code mutations trong cùng transaction.

Nếu reset lock/commit trước, login finalizer thấy PHC mismatch và không mint session; `link_code` consume thấy revoked. Nếu finalizer commit trước, reset chờ rồi revoke session vừa tạo. Nếu code consume tạo plan trước, reset cancel plan chưa apply; nếu merge đã commit hoặc owner mapping drift, reset fail closed sang DD-53 recovery thay vì mutate account sai. Không path nào create session ở transaction tách khỏi credential-freshness check, và không dùng deadlock retry như correctness mechanism.

### 5.3 TTL + retention

| Artifact | TTL | Reissue/invalidation | Cleanup |
|---|---:|---|---|
| Pending registration attempt | 24 giờ active | mỗi register tạo attempt riêng; resend chỉ supersede token của cùng attempt và không extend TTL; verify/Google promotion supersede mọi attempt thua | terminalize + NULL password/key candidate ngay; giữ metadata tối đa 30 ngày, hoặc cascade sớm khi orphan pending parent bị guarded cleanup |
| Verify-email token | 30 phút | resend supersede token cũ của cùng attempt; attempt khác không invalidate nhau | terminal/expired rows giữ 30 ngày cho incident correlation, sau đó delete bằng indexed `expires_at` batch |
| Password-reset token | 15 phút | token mới supersede token cũ; reset thành công supersede mọi reset token còn lại | terminal/expired rows giữ 30 ngày, sau đó indexed batch delete |
| Auth email delivery payload | `min(delivery TTL 24 giờ, bound token expiry)` | pg-boss retry cùng `delivery_id`; stable provider idempotency key + cùng encrypted token payload; khi worker issue reset token thì hạ delivery expiry về token expiry | NULL payload/key ngay khi delivered/noop/failed hoặc token/delivery expire; DLQ không giữ ciphertext quá expiry |
| Auth email delivery metadata | 30 ngày sau terminal | payload/key đã NULL; chỉ giữ opaque refs, outcome/error class/timestamps | indexed batch delete; incident cần lâu hơn dùng redacted audit 180 ngày |
| Redacted auth audit | 180 ngày mặc định | append-only | retention/legal gate có thể tăng, không giảm ngầm trong code |

### 5.4 Canonical async delivery — protected outbox → pg-boss

- Thêm bốn queue provision-time vào `apps/bot/src/queues.ts`: `auth-email-dispatch`, `auth-email-delivery`, `auth-email-delivery-dlq` và `auth-email-cleanup`; install dispatch/cleanup schedules idempotently khi provision/start worker. Runtime worker tiếp tục dùng `migrate:false` + `DATABASE_URL_DIRECT`; chỉ `app_worker` có pg-boss DML như live role contract. Request role không được grant queue schema/table access.
- Public request transaction insert `auth_email_deliveries(outcome='queued', enqueued_at=NULL)` với globally unique `command_id`, immutable owner/operation/target binding và riêng `provider_idempotency_key` theo §3.4. Register/resend issue attempt/token (hoặc verified-email no-op shape) và delivery row commit cùng nhau; forgot known/unknown đều chỉ ghi cùng shape này. Exact command replay reuse fixed domain row; mismatch reject trước mutation. Response chỉ trả sau durable row commit nhưng không chờ external provider.
- Recurring `auth-email-dispatch` job chạy bằng `app_worker`: qua narrow SECURITY DEFINER functions, lấy bounded batch `queued AND enqueued_at IS NULL FOR UPDATE SKIP LOCKED`, gọi `boss.send('auth-email-delivery', {deliveryId}, {db: sameWorkerTransaction, retryLimit: 5, retryDelay: 60, retryBackoff: true, expireInMinutes: 2, deadLetter: 'auth-email-delivery-dlq'})`, rồi stamp `enqueued_at` qua exact function. Enqueue + stamp cùng commit; crash trước commit rollback cả hai, crash sau commit đã có cả hai. Row lock là transaction-scoped, không có permanent claim flag và `app_worker` không được direct SELECT toàn bảng domain.
- pg-boss sở hữu dispatcher scheduling, delivery claim, active-job timeout/stale recovery, retry count/backoff và DLQ. Domain table không có `processing`, lease hay attempts và request path không poll pg-boss. Delivery handler luôn load row theo opaque `deliveryId`; terminal `delivered|noop|failed_terminal` ⇒ idempotent no-op. Job data không có raw email/token/ciphertext.
- Với forgot-password known email, lần chạy đầu atomically issue reset-token hash và cập nhật `token_id` + `payload_enc` bằng **cùng raw token đã mã hoá** trước external send; retry decrypt cùng payload, không phát token mới. Unknown/ineligible email chuyển `noop` trong protected transaction. Verify-email delivery đã có token bind đúng pending attempt từ register transaction.
- **Revalidate ngay trước mọi external send:** read delivery/token target non-locking, rồi lock parent → attempt/token → delivery theo §5.2; hash raw token vừa decrypt và constant-time compare; require purpose/binding/command đúng và token/attempt vẫn active, unexpired. Resend/new reset đã supersede token cũ ⇒ delivery cũ chuyển `noop` + NULL ciphertext/key, không gửi stale link. Đây là consume-time guard; queue ordering không được dùng làm correctness proof.
- Provider adapter chỉ chuyển persisted `provider_idempotency_key` ổn định tới **upstream API có idempotency guarantee**; tuyệt đối không chuyển `command_id`/owner/fingerprint. Local receipt ledger chỉ lưu provider message ID/audit sau response, không được coi là proof cho timeout/crash mơ hồ. Provider/adapter không chứng minh upstream dedupe ⇒ email provider giữ OFF; không gọi external send rồi giả định exactly-once. **Đây là external dependency, đã đăng ký thành gate `C7` ở `pre-code-open-items-2026-07-16.md` §C** (idempotency proof + DPA/data-region + deliverability + owner/due date) — phải kick off song song vì lead-time, không đợi tới lúc build delivery slice. Sau provider success, worker atomically set `payload_enc=NULL`, `kms_key_version=NULL`, `outcome='delivered'` + `terminal_at`.
- Handler của `auth-email-delivery-dlq` theo §5.2 khi cần inspect token, rồi chuyển domain row sang `dead_letter` + `terminal_at`, audit redacted + alert operator; nếu payload/token đã quá hạn thì NULL ciphertext/key và chuyển thẳng `failed_terminal`. Replay chỉ qua narrow operator command, require payload/token còn hạn, audit reason, chuyển row lại `queued`, clear `terminal_at` + `enqueued_at`; dispatcher sẽ enqueue job mới cho **cùng** delivery + persisted provider key. Decrypt/config/permanent-address error hoặc quá TTL ⇒ `failed_terminal`, không replay; user phải tạo request mới.
- `auth-email-cleanup` dùng indexed bounded batches để: terminalize/null expired pending candidates; chuyển mọi `queued|dead_letter` delivery quá `expires_at` sang `failed_terminal` + NULL ciphertext/key; xoá terminal token/attempt/delivery metadata sau retention; rồi mới guarded-clean orphan parent. Cleanup idempotent, có audit count và không gọi provider.

---

## 6. Revoke-all — account-self public boundary + internal primitive

> **Amendment v1.83 (owner 2026-07-19, từ AP-26 HALT v2 / Codex round-01):**
> (1) **Rotate lock-order:** live `auth_rotate_web_session` (0012) lock session→accounts (INSERT FK KEY SHARE) ngược parent-first §5.2 ⇒ deadlock thật với revoke-by-account. `0015` **CREATE OR REPLACE** rotate theo parent-first (lock `accounts` trước khi đụng `web_sessions`), **giữ nguyên signature/behavior**; mọi thay đổi behavior khác là scope breach. Rollback = DROP function mới + restore định nghĩa rotate từ 0012.
> (2) **`auth_audit_events` tạo tại D0/0015** — append-only theo shape §8.3; `logout_all` audit cùng transaction ngay từ D0. Slice order-2 **reuse/extend** bảng này, không tạo bảng audit song song.

> **Amendment v1.86 (owner 2026-07-19, từ AP-26 HALT MAX_ROUNDS / Codex round-03):**
> (1) **Issuance fence — reject-and-reauth:** `issueSession()` (`apps/web/lib/session-cookies.ts`) khi request CÓ session cookie mà `auth_rotate_web_session` trả NULL (token cũ revoked/expired — ví dụ logout-all vừa thắng race) **KHÔNG được fallback mint session mới**: clear session cookie, trả typed error để login route map generic `AUTH_INVALID` 401; chỉ path không-có-cookie mới được `createWebSession`. Retry login sau đó (không còn cookie) mint bình thường như một authentication mới — giữ nghĩa đen D0-7 "không token nào của account còn resolve" cho mọi token và cửa sổ race hiện hữu tại thời điểm revoke. Scope D0 thêm đúng function này (manifest D0); acceptance mới **D0-12**.
> (2) **Index revoke-all:** `0015` tạo thêm partial index `web_sessions(account_id) WHERE revoked_at IS NULL` (expand-only; rollback = DROP INDEX; mirror `schema.ts` cùng slice) — revoke-by-account không được full-table scan `web_sessions` trong khi giữ parent lock `accounts`; live `0001` chỉ có `UNIQUE(token_hash)`. Acceptance mới **D0-13** (catalog test).

### 6.1 Internal helper

```text
_auth_revoke_account_sessions(p_account_id uuid) -> integer
_auth_revoke_account_link_artifacts(p_account_id uuid)
  -> { link_codes_revoked, merge_artifacts_cancelled }
```

Hai helper chỉ được gọi từ SECURITY DEFINER auth/identity functions, **không GRANT EXECUTE TO app**. Helper session revoke mọi live session của account và trả row count. Helper link-artifact conditional-set `revoked_at` cho mọi active, unconsumed, unexpired `link_codes.source_account_id = account` và cancel mọi merge artifact chưa apply có authority duy nhất từ các code đó; terminal code/committed merge không bị rewrite. Identity companion schema phải làm plan durable, structurally reference exact `link_code_id`, có one-way state `pending → applied|cancelled` + `cancelled_at/reason`; thiếu owner/state này thì reset bundle **HALT**, không giả lập cancel trong memory. Cả hai helper chỉ được gọi sau parent-first inventory/locks §5.2 và trả count để audit.

### 6.2 Public logout-all

```text
auth_revoke_all_web_sessions(p_current_token_hash text) -> integer
```

Function read-only resolve **current live session**, đi qua hierarchy §5.2, derive `account_id` server-side rồi gọi session helper. Không nhận `account_id` từ body/controller. `/api/auth/logout-all` yêu cầu current session + valid CSRF; missing/expired session trả generic auth failure. Response clear cookie sau server-side revoke. Logout-all chỉ có nghĩa “đăng xuất mọi web session”; security recovery qua password reset mới revoke account-issued link artifacts như dưới, nên API không được gọi hai hành vi này là tương đương.

### 6.3 Password reset

`auth_reset_password` chỉ dùng token để **read-only resolve candidate**, rồi lấy account qua locked parent `accounts/account_emails`; caller không cung cấp account ID. Function theo đầy đủ §5.2: conditional inbox fence → parents → reset tokens → credential → sessions → account-issued link codes/actionable merge artifacts → revalidation. Nó validate PHC trước consume; credential change + consume/supersede reset tokens + revoke-all sessions + revoke/cancel link artifacts + audit counts commit trong một DB transaction. Reset-vs-link consume có hai kết quả hợp lệ: reset thắng ⇒ consume thấy `revoked_at`; consume tạo plan trước ⇒ reset cancel plan chưa apply. Committed merge/owner drift ⇒ rollback và chuyển DD-53 recovery, không tự đảo merge. Đây là primitive mở điều kiện fail-closed edge #18/#19; current single-token helper không được reuse như account-wide proof.

---

## 7. Full lifecycle decision table

| Path/case | Lock + mutation owner | Exact result |
|---|---|---|
| Register new email | rate-limit + bind command; read-only inventory → email-key advisory → parent/child hierarchy; validate PHC; create pending account/email + independent attempt/token + protected delivery | Generic accepted after durable commit; exact command replay fixed; dispatcher enqueue async; no shared credential/identity/session |
| Register existing pending | same command/lock hierarchy; append independent attempt/token, không mutate attempt browser khác (§3.2) | Generic accepted; no duplicate account; attacker không thể supersede token/password candidate của chủ email |
| Register existing verified | same command binding/response path; no credential/token mutation; insert delivery shape với `token_id=NULL` | Same status/copy/header class; worker records `noop`, không gửi mail và không lộ existence |
| Resend exact verify attempt | `POST /api/auth/email/verify/resend`; Strict path cookie + same-origin; IP→target/invalid bucket; parent→attempt→token | Supersede chỉ token cũ của attempt đó, TTL attempt không đổi; wrong/terminal cookie generic zero mutation |
| OAuth callback từ Google/Facebook | query state + matching provider-specific Lax binding cookie → atomic claim; provider exchange/proof outside DB; collision transaction follows parent-first §5.2 | Cross-site GET hợp lệ không cần same-origin header; missing/mismatch/replay fail closed; Google còn reject PKCE/nonce downgrade, Facebook verify exact configured-App subject; session chỉ mint sau full provider-specific proof |
| Verify/reset email link GET | non-mutating landing; scrub URL; no third-party resource; chờ explicit user gesture | Link scanner/prefetch không consume token, đổi password hay verify email |
| Verify valid | read-only token target → conditional fence → `accounts` → `account_emails` parents → exact attempt → token + matching registration key | Consume winner once; revalidate PHC, install winner password; promote email; supersede loser attempts/tokens; create email identity + audit; login still explicit |
| Verify expired/wrong-purpose/used/superseded | conditional consume returns zero | `AUTH_TOKEN_INVALID`; zero mutation |
| Email login valid | login-state consume + credential read + app-side Argon2 verify; finalizer follows conditional fence → parent → credential → sessions | Re-check exact expected PHC; validate optional no-downgrade PHC + rotate/mint session + success audit atomically |
| Email login invalid/pending | same lookup/hash path + rate limit; dummy Argon2 verify when no credential | Generic `AUTH_INVALID`; no account signal/session |
| Forgot known/unknown | public route always normalize/hash + dual-bucket rate-limit + bind command + insert same encrypted delivery shape, then return | Same status/copy/timing class; pg-boss dispatcher enqueue async; delivery worker sends only when verified eligible account exists, otherwise protected no-op |
| Reset valid | read-only reset target → conditional fence → parent → token → credential → sessions → account-issued link artifacts | Validate PHC before consume; password upsert + supersede reset tokens + revoke all sessions/codes + cancel actionable plans + audit atomically; require normal login afterward |
| Reset DB/PHC/audit/revoke failure | transaction rollback | Token remains unconsumed; old password/sessions/link codes/merge artifacts unchanged |
| Old-PHC login races password reset | both serialize on email → credential before sessions | Reset first ⇒ finalizer PHC mismatch, zero session. Login first ⇒ reset waits then revokes session vừa tạo |
| Logout-all | resolve account from current session token + CSRF | Revoke **mọi** session của account **kể cả session hiện tại**; lần gọi thứ hai không resolve được session ⇒ generic auth failure (401), **không** phải idempotent-success. Test phải assert 401, không assert 200 |
| Concurrent register/resend/verify/login/reset/link consume | command/attempt uniqueness + one parent-first hierarchy + conditional update | No deadlock-dependent correctness; attempts coexist; exactly one verify/reset consumes; stale PHC never mints session; reset revokes or cancels pre-issued account proof; never duplicate identity/double-consume |

**Enumeration-safe worker boundary:** public forgot route không lookup account rồi mới quyết định có enqueue. Nó luôn commit protected `auth_email_deliveries` cùng shape và cùng response path. `app_worker` dispatcher enqueue mọi row qua cùng queue/options; delivery worker mới decrypt/normalize, lookup và either issue+send hoặc record redacted `noop`. Raw reset token chỉ tồn tại trong worker memory hoặc KMS-encrypted retry payload; pg-boss job chỉ mang `delivery_id`, payload bị xoá khi terminal. Dispatch/claim/retry/backoff/DLQ/replay tuân §5.4, không do request role hoặc bảng domain tự triển khai.

### 7.1 Regression proofs bắt buộc

- Attacker tạo attempt A cho email nạn nhân; chủ email tạo attempt B; mọi resend/attempt mới của A không invalidate token B; verify B chỉ cài password B và terminalize A.
- Hai attempt valid verify đồng thời: đúng một email/password/identity winner; loser không overwrite credential. `POST /api/auth/email/verify/resend` nhận đúng Strict cookie vì path-prefix match, invalidates chỉ token cũ của exact attempt và không extend TTL; `/register` không được giả làm same-attempt resend.
- Existing Google subject A + returned email chưa có owner hoặc còn pending ở B: session chỉ mint cho A bằng subject; zero email/attempt mutation. Email verified đã thuộc B vẫn `AUTH_IDENTITY_CONFLICT` + zero session. Test chứng minh pending register không DoS subject login và callback không silently rebind/promote contact.
- Google/Facebook top-level callback từ provider phải pass với dedicated Lax binding cookie dù `Origin` absent/`Referer` là provider; cùng callback qua cookie `Strict`, thiếu/sai binding, state của browser khác hoặc replay đều reject. Test khẳng định OAuth callback không gọi `sameOriginRequest()` và session cookie sau login vẫn `Strict`.
- Google/Facebook state issue thứ 11 trong một phút từ cùng trusted IP (kể cả đổi provider) trả 429 **trước** insert/cookie; bucket callback độc lập. Missing/malformed ingress header đi vào bounded untrusted bucket; limiter/storage error fail closed. Schema-vs-catalog test giữ `pkce_verifier_enc=bytea`, không text.
- Email verify từ webmail: cross-site GET không mutation, URL được scrub; chỉ explicit same-origin POST với exact token + matching Strict registration cookie mới promote. Link scanner GET, POST thiếu/wrong cookie và link mở ở browser khác đều zero mutation/token-consume. Reset link cũng không consume/change credential trên GET.
- Verify/reset rate-limit ordering: trusted-IP bucket chạy trước mọi token lookup. Nếu pass, protected non-mutating resolver chỉ nội bộ map active/unexpired token hash → stored `email_lookup_hash`; check target bucket 5/15 trước consume. Token invalid/expired/consumed/superseded dùng `HMAC(domain='auth-invalid-artifact-rate', token_hash)` làm bucket thay thế, không lộ account existence. Bất kỳ bucket/storage failure nào cũng zero consume/mutation và trả generic rate/error class.
- Command receipt matrix: same `command_id` + exact owner/operation/target replays one fixed row; same UUID với email, operation hoặc attempt khác trả public generic reject và zero mutation. Provider spy chỉ thấy persisted opaque `provider_idempotency_key`, không command/owner/fingerprint; key rotation retry giữ đúng persisted value.
- Lock-race matrix chạy có barrier/timeout: forgot reset-token issue vs reset consume; verify-resend vs verify consume; Google pending promotion vs verify; cleanup vs verify; login vs reset. Mọi path acquire parent trước child, hoàn tất không deadlock và loser revalidate drift/terminal state thay vì dựa vào deadlock retry.
- Login verify old PHC rồi pause; reset commit password change + revoke-all; resume finalizer ⇒ `AUTH_INVALID`, zero session. Đảo thứ tự: finalizer commit session trước; reset sau phải revoke session đó. Chạy cả cell rehash-needed và no-rehash.
- Reset-vs-account-issued-`link_code`: reset lock trước ⇒ concurrent consume generic-reject trên `revoked_at`; consume tạo merge plan trước ⇒ reset cancel plan chưa apply; committed merge/owner drift ⇒ reset rollback + DD-53 recovery. Assert credential/token/session/code/plan/audit all-or-nothing in both orders.
- PHC owner-boundary tests cho register, verify-copy, reset và rehash: reject wrong algorithm/version, malformed base64/field duplication, m/t/p dưới floor, salt/hash ngắn và parameters vượt operational ceiling. Invalid reset PHC không consume token, không đổi credential và không revoke session/code; direct app DML/attempted trigger bypass bị deny.
- Delivery bind token đã superseded/expired không gọi provider; handler chuyển `noop|failed_terminal` và NULL ciphertext. Forgot known/unknown giữ cùng public status/copy/timing class.
- Dispatcher crash trước/sau commit không làm mất row hoặc tạo external send không được bảo vệ. Delivery worker crash sau provider success được upstream provider idempotency dedupe; retry dùng cùng token + persisted provider-send key.
- Retry exhaustion đi DLQ + audit/alert; replay trước expiry dùng cùng delivery; replay sau expiry bị từ chối và payload bị huỷ.
- Trusted-IP unit tests giữ exact DO/Fly header behavior; production-shaped ingress drill ở §8.2 phải pass trước email flag.

---

## 8. Password, rate-limit, audit và URL defaults

### 8.1 Password policy + hashing

- Password sau Unicode NFC: **15–128 Unicode code points**, không trim, không silent truncate; cho phép whitespace/Unicode/paste/password manager.
- Không composition rule và không periodic rotation. Reject password nằm trong common/compromised/context blocklist; không gửi raw password tới third party.
- Argon2id initial floor: **m=19,456 KiB, t=2, p=1**, random 16-byte salt, 32-byte output, lưu full PHC string gồm algorithm/version/parameters/salt/hash. Benchmark production-class hardware; target verify dưới 1 giây và có concurrency cap. Có thể tăng cost, không giảm dưới floor nếu chưa có security decision mới.
- Raw password chỉ tồn tại ở app auth boundary để Argon2 verify và được zero/released sớm nhất có thể. DB chỉ nhận PHC strings; không nhận raw password.

**Một owner cho PHC shape ở mọi write path:**

```text
_auth_assert_password_phc(p_phc text) -> void
```

Helper internal, fixed `search_path`, không grant cho `app`, tự đọc/literal-bind server-owned current install-policy version — caller không được chọn policy. Nó parse full PHC thay vì chỉ regex prefix: algorithm phải `argon2id`, version `v=19`, đúng một bộ `m,t,p`, base64 canonical, salt ≥16 byte, output ≥32 byte; m/t/p phải đạt floor và không vượt operational ceiling của current policy. Initial policy allow exact benchmarked tuple `m=19456,t=2,p=1`; tăng cost/ceiling chỉ qua versioned migration + benchmark, không đổi ad hoc bằng request. Helper chạy trong register owner trước lưu pending PHC, constraint trigger chạy trên cả pending/credential columns (NULL chỉ hợp lệ khi lifecycle CHECK terminal), verify re-assert trước copy, reset chạy **trước token consume/revoke**, và login finalizer chạy trước rehash update. Direct table INSERT/UPDATE bị revoke; malformed/unknown/downgrade/oversized PHC làm toàn transaction rollback. Raw-password length/blocklist vẫn do app auth boundary enforce vì DB không nhận raw password.

**Một login finalizer duy nhất — không có standalone rehash mutation:**

```text
auth_finalize_email_login(
  p_account_email_id uuid,
  p_expected_phc text,
  p_upgrade_phc text,          -- NULL nếu không cần rehash
  p_current_token_hash text,   -- NULL nếu browser chưa có web session
  p_new_token_hash text,
  p_new_csrf_secret text,
  p_session_ttl interval
) -> uuid
```

Function là SECURITY DEFINER narrow boundary, derive `account_id` từ locked parent tier và không nhận account ID từ caller. Theo lock order ở §5.2, nó require email verified + matching email identity + stored `password_phc = p_expected_phc`. `p_upgrade_phc`, nếu có, chỉ được nhận sau successful Argon2 verify và phải pass `_auth_assert_password_phc`; function reject malformed/downgrade/unknown policy. Trong **cùng transaction**, function optional update PHC, revoke/rotate current cookie session nếu có, create session mới cho derived account và ghi `login_success` audit; trả session ID.

PHC mismatch/identity drift/credential missing ⇒ generic `AUTH_INVALID`, zero credential/session/success-audit mutation. Điều này áp dụng cả khi không cần rehash: freshness check vẫn bắt buộc trước session mint. Login-state consume, rate-limit hit và failed-attempt audit giữ ở các narrow owner hiện có; chúng không thay thế finalizer và không được dùng làm credential-freshness proof.

### 8.2 Rate limits

- `GET /api/auth/{google|facebook}/state`: một bucket shared `oauth-state:<trusted-ip>` **10/min** trên cả hai provider, check trước insert/cookie. Callback dùng bucket `oauth-callback:<trusted-ip>` **10/min** độc lập, check trước claim/exchange; không dùng một bucket để thay bucket kia.
- `email login`: bucket trusted-IP 10/min **và** 5/15min email-hash bucket; deny nếu một bucket fail. ⚠️ Chính xác hoá: spec trước review chỉ có `Login callback | 10/min | Per IP` — đó là bucket cho **OAuth callback**, không phải email login. Áp cho path email login là **quyết định mới của probe này**, không phải bucket đã tồn tại cho path đó.
- `register/forgot`: 5/15min **hai bucket độc lập** — normalized-email-HMAC và trusted IP, không ghép thành một pair để attacker rotate một chiều.
- `verify_resend`: trusted-IP 5/15min chạy trước lookup registration cookie; active key resolve nội bộ sang stored email hash để dùng target bucket 5/15min, còn missing/terminal/invalid key dùng `HMAC(domain='auth-invalid-registration-key-rate', key_hash)` bucket. Same-origin + Strict cookie không thay rate limit hay ownership revalidation.
- `verify/reset`: trusted-IP 5/15min chạy **trước mọi token lookup**. Sau đó hash raw token, protected non-mutating resolver map chỉ token active/unexpired sang stored `email_lookup_hash`; check target-email bucket 5/15min trước transactional consume. Token không resolve dùng domain-separated HMAC của token hash làm invalid-artifact bucket 5/15min. Public response không phân biệt target-valid/invalid; resolver không consume, không trả email/account ra client. Deny nếu bất kỳ bucket hoặc rate-limit storage nào fail.
- **Reuse live provider-pinned resolver, không tạo chain mới trong D1:** production bắt buộc `TRUSTED_INGRESS_PROVIDER=digitalocean` và chỉ tin single-value valid `do-connecting-ip`; bounded Fly fallback chỉ tin `fly-client-ip`; missing/invalid header vào một bounded `*:untrusted` bucket; không bao giờ fallback sang `X-Forwarded-For`, `CF-Connecting-IP` hoặc header của provider khác. Authority: `apps/web/lib/session-cookies.ts::trustedIngressProvider/clientIp`, D8 đã DONE.
- **Cloudflare là topology revalidation gate, không phải owner preference.** Nếu Cloudflare proxy thật sự đứng trước DO khiến `do-connecting-ip` không còn là client IP, email auth flag giữ **OFF** cho tới khi ingress slice pin được cách chặn direct-origin bypass + exact trusted header và có production-shaped tests. Không được chỉ bắt đầu tin `CF-Connecting-IP`. Release drill bắt buộc chứng minh hai client khác nhau vào hai bucket khác nhau, spoofed XFF/CF/provider header không đổi bucket, và missing/malformed chain fail-closed. Nếu chưa pass, không claim dual-bucket và không enable email provider.
- Rate-limit response vẫn generic. Shared Postgres `rate_limit_check` là live precedent; bucket keys domain-separated và không chứa raw email/IP trong logs.

### 8.3 Audit

Protected append-only auth audit (`auth_audit_events` — **tạo tại D0/0015, các slice sau reuse/extend, v1.83**) ghi: opaque event id, event type, account/account-email ref khi có, outcome class, actor class, opaque command/request ref, session/link-code/merge-artifact counts và timestamp. Không ghi raw email/IP/token/password/PHC/ciphertext, command owner hash hay target fingerprint đầy đủ. Bắt buộc audit các outcome `register_requested`, `verify_resent`, `email_verified`, `login_success|failed`, `reset_requested`, `password_reset`, `logout_all`, `identity_conflict`, `idempotency_key_reused`, `delivery_dead_letter`, `delivery_replayed`, `delivery_failed_terminal`. **Per-lane finalizer (v1.85):** `login_success` chỉ được ghi trong cùng transaction của finalizer thuộc lane tương ứng — lane email: `auth_finalize_email_login`; lane Google: `auth_login_google` (collision cell 1–6 ghi `login_success`, cell 7 ghi `identity_conflict`, cùng transaction với mutation/reject của cell). OAuth proof-fail (cell 8) reject **trước khi chạm DB** nên KHÔNG ghi `login_failed` — defer có chủ đích (đã có trusted-IP bucket + generic reject + HTTP log); `login_failed` bắt buộc chỉ áp cho lane email nơi credential check chạm DB. PHC mismatch/race không được để lại success audit.

Nếu DD-70(a) được accept, verified capability first derives candidate Person read-only, then locks every candidate inbox fence UUID-order **before** any blocking auth/session/recovery/Person/audit row; canonical auth mutator follows §5.2, re-locks/re-derives context and rolls back on drift. Sau mọi lock/revalidation, nó captures `auth_audit_events.created_at` as immutable pre-mutation boundary, derives `trigger_context_ref + trigger_context_started_at` from the locked context, and calls the owner-only notification source helper with that audit id in the same transaction; durable item được append trước triggering trust/email mutation như DD-70. Request không chọn boundary/recipient/type. `tenant outbox_events(tenant_id NOT NULL)` tuyệt đối không phải fallback cho global event; nếu known auth producer không thể fence-first thì build HALT cho tới khi redesign, không emit tenant giả và không claim projector. Route factors must predate context start, excluding factors created by the compromised session even before the later event.

### 8.4 Reset/verify URL safety

- URL origin lấy từ fixed allowlisted config, không từ `Host` header; HTTPS only.
- `GET /auth/email/{verify|reset}` là **non-mutating landing**: không gọi consume function, không verify email, không đổi password và không mint session. Trang đặt `Referrer-Policy: no-referrer`, CSP không third-party, scrub token khỏi URL/history trước khi render form và yêu cầu explicit user gesture; link scanner/prefetch chỉ GET nên không thể consume.
- `POST /api/auth/email/verify` là same-origin, nhận token từ landing + registration-key cookie `Strict`; `POST /api/auth/email/verify/resend` nằm dưới đúng cookie Path, nhận cookie đó nhưng không nhận/đổi password; `POST /api/auth/email/reset` là same-origin form nhận token + password mới. Cả ba require `sameOriginRequest()`, rate-limit và generic error. Verify/resend thiếu/sai browser key chỉ hiện handoff/re-register, không consume token hay mutate attempt; reset không cần pre-existing session/cookie nhưng GET vẫn không mutation.
- Token/cookie/code/state không log/analytics. Landing/callback không load third-party resource trước khi scrub/redirect.
- Sau reset không auto-login; gửi notification email redacted và yêu cầu login bình thường.

Security defaults tham chiếu:

- [RFC 9106 — Argon2](https://www.rfc-editor.org/rfc/rfc9106.html)
- [NIST SP 800-63B-4 — Password Verifiers](https://pages.nist.gov/800-63-4/sp800-63b.html#passwordver)
- [OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)
- [OWASP Forgot Password Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html)
- [OWASP Email Validation and Verification Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Email_Validation_and_Verification_Cheat_Sheet.html)
- [RFC 9700 — OAuth 2.0 Security Best Current Practice](https://www.rfc-editor.org/rfc/rfc9700.html#section-2.1)
- [Google OpenID Connect API reference](https://developers.google.com/identity/openid-connect/reference)

Slice phải re-check dependency-specific API và benchmark thật, nhưng không được hạ các floor trên chỉ để test xanh.

---

## 9. Canonical drift — chọn `(a)`, không còn hai phương án

`packages/db/README.md` nói SQL migrations là runtime authority và `schema.ts` mirror tables. Vì Drizzle biểu diễn được table/index/check dù role `app` không có grant, resolution là:

1. Thêm `auth_login_nonces`, `auth_login_state`, `rate_limit_hits` vào `schema.ts` như mirror của `0012`; Google adapter thêm `auth_oauth_transactions` vào migration monotonic + `schema.ts` cùng slice. Không cấp app table access; OAuth issue/claim chỉ qua narrow functions.
2. Mọi auth table/field mới ở §3/§5 — gồm structural command binding, persisted provider-send key/version và reset audit counts — được thêm **cùng migration và cùng patch `schema.ts`**. pg-boss giữ schema queue riêng do provision step sở hữu; không mirror internal pg-boss tables vào Drizzle domain schema.
3. Function/grant/search-path, `_auth_assert_password_phc` + constraint trigger và parent-first owner helpers vẫn chỉ ở SQL migration; comments trong `schema.ts` trỏ migration sở hữu privileged behavior. Schema-vs-catalog test assert trigger/grant tồn tại, không chỉ column shape.
4. Cập nhật `packages/db/README.md` migration inventory khi slice land. Không sửa `CLAUDE.md` để tạo ngoại lệ function-only table.

Drift này thuộc D0/D1-core prerequisite và phải có schema-vs-catalog test; không được để tới cleanup sau provider swap.

---

## 10. Slice/release order — core trước, email là một release unit

| Order | Mechanism-named slice/bundle | Scope | Enablement |
|---:|---|---|---|
| 1 | **D0 session-account-revoke-core** | Internal revoke-by-account + current-session public wrapper + `/logout-all` + CSRF/tests + schema mirror drift hiện hữu + **CREATE OR REPLACE rotate parent-first (v1.83)** + **`auth_audit_events` append-only (§8.3)** + export root `packages/db/src/index.ts` | Có thể ship độc lập |
| 2 | **D1 account-email-token-core** | `account_emails`, pending-attempt/credential/token/delivery + command/provider-key storage (**audit: reuse/extend `auth_audit_events` đã tạo ở D0 — v1.83**); normalization/artifact + PHC validator/trigger; parent-first helpers; cleanup. Serialized identity companion implements the already-aligned v1.10 account-issued `link_code` order | Không bật email UI/provider; không READY trước migration/runtime + reset-vs-consume/merge barrier tests |
| 3 | **D1 Google-OIDC-adapter** | `auth_oauth_transactions` + path-scoped Lax binding cookie; state/nonce/PKCE + proof matrix + collision table §4 + session issue; không reuse `sameOriginRequest()`/Strict callback cookie của Telegram | Google độc lập với email-password flag |
| 4 | **D1 email-credential-lifecycle bundle** | Serialized sub-slices register/verify/resend → login finalizer/rehash → forgot/reset+link-artifact revoke → pg-boss delivery/DLQ, nhưng **một release unit/feature flag**; full contract tests chạy ở mỗi sub-slice | Flag OFF tới khi toàn bundle + lock-race matrix + PHC/command mismatch + cleanup/audit/revoke + ingress drill green |
| 5 | **D1 Telegram-auth-contract-removal** | Expand→contract remove Telegram routes/runtime only after Google/email consumers live and rollback window pass | Không delete sớm |

Bundle email có thể chia worktree/slice để giữ scope ceiling, nhưng không phần nào được enable/release riêng. Manifest mỗi sub-slice phải ghi negative scope và dependency; tất cả serialize trên auth/identity invariants.

---

## 11. Gate B0 — điều kiện thoát sau review-fix

- [x] Map đủ Google OIDC proof + identity/email collision path (§2, §4)
- [x] Map đủ email register/verify/resend/login/forgot/reset/logout-all path (§3–§8)
- [x] Reuse và revalidate full transactional `link_code` contract; không nhồi email token vào đó (§2)
- [x] Một canonical transactional consume boundary, purpose hardcoded theo endpoint (§5)
- [x] Exact uniqueness, independent pending attempts, concurrent verify winner, expiry, supersede, retention và indexed cleanup (§3, §5)
- [x] Account-self public revoke + ungranted internal revoke helper (§6)
- [x] Provider-neutral verified-email owner cover Google và email/password (§3–§4)
- [x] Enumeration-safe protected outbox → pg-boss boundary với atomic dispatcher enqueue, retry/backoff/DLQ/replay, dual rate-limit, password policy, audit và URL safety (§5.4, §7–§8)
- [x] Canonical schema mirror resolution chọn `(a)` (§9)
- [x] Pending-registration takeover: independent attempt + verify-first credential install, không last-writer-wins (§3.2, §5, §7)
- [x] Trusted-IP reuse live DO/Fly resolver; Cloudflare topology change là fail-closed engineering/release gate, không phải owner defer (§8.2)
- [x] Email login finalizer re-check PHC + optional rehash + session mint/audit atomically; shared reset lock order đóng stale-password post-reset session race (§5.2, §7, §8.1)
- [x] Cross-site boundary đã pin: OAuth transaction + Lax browser binding riêng; email verify/reset non-mutating GET → explicit same-origin POST; session cookie giữ Strict; link-scanner/cross-browser negative tests bắt buộc (§3.2, §4.1, §7.1, §8.4)
- [x] Public OAuth state issue bị rate-limit trước row/cookie; callback có bucket riêng; verify/reset pin exact IP → non-mutating target resolve → target/invalid bucket → consume ordering; PKCE ciphertext giữ canonical `bytea` (§4.1, §7.1, §8.2)
- [x] Một parent-first hierarchy cho auth + account-issued `link_code`, read-only resolve/fence-first/revalidate; reset revoke/cancel proof artifacts atomically; tenant outbox bị cấm làm global fallback (§5.2, §6, §7.1, §8.3)
- [x] Public command receipt bind owner/operation/target và tách khỏi persisted provider-send key; mismatch zero mutation + regressions (§3.4, §5.4, §7.1)
- [x] Cookie-reachable same-attempt resend có exact endpoint/rate/TTL semantics; `/register` chỉ tạo attempt mới (§3.2, §7, §8.2/§8.4)
- [x] Argon2id PHC validator/trigger owner mọi register/verify-copy/reset/rehash install; invalid reset rollback trước consume/revoke (§3.1, §5.2, §7.1, §8.1)
- [x] **Owner duyệt** §3 provider-neutral email owner · **§3.2 multi-attempt verify-first rule** · §4 Google collision behavior · §5 TTL/retention + delivery defaults · §8 password + initial rate-limit defaults · §10 slice/release order — ✅ **duyệt cả 6 as-written (owner 2026-07-19), ghi DD-80 · decisions v1.77**

> **Kết luận:** owner đã duyệt cả 6 mục (2026-07-19); quyết định ghi tại `standards/decisions.md` **DD-80 (v1.77)** — **B0 ✅ design-ready**. Bước kế: propagate Product/BE spec + author D0/D1 slice artifacts rồi re-run closure matrix (gate §8). Vẫn chưa claim code-ready; email provider fail-closed OFF cho tới khi toàn bundle + lock-race matrix + ingress drill green.
