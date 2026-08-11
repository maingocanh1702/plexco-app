# Feature: Zalo Player Channel — Backend Tech Spec

> **Canonical phase:** P4.7  
> **Version:** 2.8 · 2026-08-10
> **Status:** Reviewed · reconciled to DD-15/DD-32/DD-45/DD-49/DD-67
> **Implementation:** Not started · authority: `../../standards/BUILD-STATUS.md` (Doc status ≠ Implementation status)  
> **Product spec:** `../FE/feature_zalo_channel.md`
> **References:** `../../standards/decisions.md` DD-15/DD-32/DD-45/DD-49/DD-67 · `../FE/feature_connector_onboarding.md` BL-SEC-1 secret lifecycle · `feature_channel_booking_funnel_tech.md` · `feature_cross_club_join_tech.md`
> **⚠️ Live-schema boundary:** live `channel_identities` vẫn là key **2-phần** `(platform, platform_user_lookup_hash)` và `channel_reachability` PK `(person_id, tenant_id, platform)`. Mô hình endpoint-scoped DD-67 (3-phần `provider_scope_lookup_hash`, reachability theo `channel_identity_id`) là **target**, cần migration mới land trước runtime. `0014_players_waitlist` **đã merge trên `main`** (`1a6ac38`; verify tail hiện hành tại `packages/db/migrations/`, không hard-pin số), nên slice Zalo vẫn phải sync mọi prerequisite đã merge rồi chọn **next available monotonic number** sau tail đã merge, không hardcode/pin một số cố định và không sửa migration lịch sử. Live `zalo_bots` đã có lifecycle mới ở `0004` và RLS tenant-private ở `0009`, nhưng vẫn còn legacy `secret text`; cột này **không đạt BL-SEC-1**. Target DDL dưới thay nó bằng `webhook_secret_enc`; forward migration phải KMS-encrypt/backfill hoặc vô hiệu hóa connector chưa backfill được trước khi runtime Zalo được bật.

---

## 1. Tổng quan triển khai

```text
Webhook (opaque token → bot/tenant) → Verify provider secret
    → Normalize stable event/user IDs → Update dedup
    → session detail projection → shared channel-booking decision/finalizer
    → canonical Identity/Session/Payment owners → Outbox → Delivery
```

Bot-per-club model: webhook path token resolves bot endpoint/default tenant. Provider payload is NOT tenant authority. Identity lookup uses domain-separated HMACs for bot/OA scope and `from.id`; target tenant/action still re-authorize separately.

### Entry points

| Entry | Caller | Mô tả |
|-------|--------|-------|
| `POST /api/webhooks/zalo/:webhookToken` | Zalo webhook | Opaque token → bot/tenant → verify provider secret |
| Identity resolver (HMAC) | Zalo event | Domain-separated HMAC(bot/OA scope, `from.id`) → ChannelIdentity |
| Session detail projection | Player (Zalo DM) | Number-reply → session card (no inline button) |
| Shared channel-booking decision | Internal | `decideChannelBookingPath()` → join/hold/link |
| `finalizeChannelBookingIntent()` | Account-link / bank event | Atomic settle for Zalo-origin booking |
| Zalo DM delivery adapter | Dispatcher (notifications) | DM delivery via bot/OA endpoint |
| Reply context store | Zalo adapter | `zalo_reply_contexts` → stateful number-reply mapping |

---

## 2. Database Schema + Edge Cases (BE)

### Schema

```sql
CREATE TABLE zalo_bots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) UNIQUE,
  bot_token_enc text NOT NULL,          -- KMS/envelope ciphertext, never plaintext
  webhook_token text NOT NULL UNIQUE,  -- random opaque route lookup; not a provider secret
  webhook_secret_enc bytea,            -- KMS/envelope ciphertext; narrow decrypt only
  status text NOT NULL DEFAULT 'connecting'
    CHECK (status IN ('connecting','registered','active','drift','error','revoked')),
  auto_registered boolean NOT NULL DEFAULT false,
  rotation_pending boolean NOT NULL DEFAULT false,
  last_setwebhook_at timestamptz,
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (webhook_secret_enc IS NOT NULL OR status IN ('connecting','error','revoked'))
);
ALTER TABLE zalo_bots ENABLE ROW LEVEL SECURITY;
ALTER TABLE zalo_bots FORCE ROW LEVEL SECURITY;

CREATE TABLE zalo_reply_contexts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id uuid NOT NULL REFERENCES persons(id),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  bot_id uuid NOT NULL REFERENCES zalo_bots(id),
  context_type text NOT NULL DEFAULT 'session_list',
  item_ids jsonb NOT NULL,  -- ordered session IDs
  version integer NOT NULL DEFAULT 1,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE zalo_reply_contexts ENABLE ROW LEVEL SECURITY;
ALTER TABLE zalo_reply_contexts FORCE ROW LEVEL SECURITY;
```

`channel_booking_intents` and its hold/payment-reference constraints are owned by `feature_channel_booking_funnel_tech.md`. The Zalo slice reuses that table/service and must not add a transport-specific intent, capacity counter, charge or payment ledger.

`webhook_token` chỉ là random opaque locator trong URL; nó không thay cho provider verification secret. Handler resolve row theo token dưới narrow endpoint resolver, decrypt `webhook_secret_enc` qua KMS, so sánh header bằng constant-time compare rồi xóa secret khỏi memory sớm nhất có thể. Migration forward thực hiện theo thứ tự: add nullable encrypted column → application/KMS backfill legacy `secret` → connector không backfill được chuyển `error` và bắt owner reconnect → add/validate CHECK buộc mọi row có thể nhận webhook (`registered|active|drift`) phải có ciphertext → drop legacy `secret`. `connecting` có thể giữ NULL trong khi setup nhưng chỉ được nhận traffic sau khi ciphertext tồn tại; verified early event CAS `connecting→active`, và register finalization phải preserve `active`. `error|revoked` không nhận traffic. Không có dual-read plaintext sau cutover.

### Migration & Rollback

**Baseline đã live — reuse, không recreate:** `zalo_bots` và `zalo_reply_contexts` đã tồn tại từ migration `0004_channels_connectors.sql` (lifecycle status `connecting|registered|active|drift|error|revoked`, `rotation_pending`, UNIQUE `webhook_token`), RLS/grant tenant-private ở `0009_rls_policies_grants.sql`. Slice Zalo dùng lại các bảng này; DROP bảng baseline = ❌ NEVER (có thể chứa connector/context thật).

**Genuinely new (chưa land trên main) → migration mới monotonic:**

1. `zalo_bots.webhook_secret_enc` thay legacy `secret text` — theo đúng trình tự đã pin ở trên (add nullable column → KMS backfill → row không chứng minh được → `error` → CHECK `NOT VALID`/VALIDATE → DROP `secret`); DDL executable pin ở `feature_connector_onboarding_tech.md` §2.
2. Endpoint-scoped identity/reachability theo DD-67 — live `channel_identities` (`0001`) vẫn key 2-phần và `channel_reachability` (`0002`) vẫn PK `(person_id, tenant_id, platform)`; mô hình 3-phần + reachability theo `channel_identity_id` cần migration riêng land trước runtime Zalo (header ⚠️).

Chọn **next available monotonic number** sau khi sync mọi prerequisite đã merge; không pin số cứng, không sửa migration lịch sử.

**Rollback:**

| Bước | Hành động | An toàn? |
|------|-----------|----------|
| 1 | Disable Zalo adapter/webhook receiver (feature flag + kill switch §4) trước khi revert schema | ✅ |
| 2 | Migration revert mới: drop cột/constraint additive vừa thêm (`webhook_secret_enc` + CHECK, endpoint-identity objects) | ✅ Constraint/column-only |
| 3 | Khôi phục plaintext `secret` sau khi đã DROP | ❌ KHÔNG THỂ — plaintext đã xóa theo BL-SEC-1; muốn dùng lại connector phải owner reconnect |
| 4 | DROP `zalo_bots`/`zalo_reply_contexts` baseline (`0004`) | ❌ NEVER |

### Edge Cases (Backend)

| # | Category | Case | Xử lý |
|---|----------|------|-------|
| 1 | Security | Tenant from message content | ❌ NEVER — webhook token/bot binding only |
| 2 | Data Integrity | Stale number (list expired/changed) | Reject — "Danh sách đã thay đổi" |
| 3 | Data Integrity | Number out of range | "Số không hợp lệ" |
| 4 | Security | Forged/unknown webhook | Reject — narrow KMS decrypt + timing-safe verify; no plaintext fallback |
| 5 | Concurrency | Replayed event | Update dedup — idempotent |
| 6 | Concurrency | Concurrent final-confirm replies at last slot | Shared occupancy locks session and counts active + live holds; exactly one holds/occupies, second waitlisted/no-charge/no-venue |
| 7 | Security | Bot token in logs | ❌ NEVER — KMS encrypted, log redaction |
| 8 | Data Integrity | Webhook drift (URL changed) | Hourly `getWebhookInfo` — alert on drift |
| 9 | Security | DM reachability cross-club/bot | Scoped exact `channel_identity_id` bound bot/OA; independent; target tenant re-authorized |
| 10 | Resilience | Provider rate-limit/outage | Degrade — no canonical corruption |
| 11 | Security | Free numeric message without context | NEVER execute join — require active context |
| 12 | Data Integrity | Token rotation overlap | Support overlap period before revoke |
| 13 | Financial | Existing player `left` join lại | Emit shared join payload; render canonical DD-49 outcome. Only pass through `REJOIN_REQUIRES_REVIEW` for unknown/unimplemented disposition; no adapter ledger logic |
| 14 | Identity | Exact Zalo identity lacks qualified Account link | Browse remains available; paid final confirm returns link-or-pay, never pay-later |
| 15 | Payment | Settlement capability unavailable/unknown | No payment hold/reference/QR; return link/web alternatives |
| 16 | Concurrency | Link resume races payment event | One shared intent/finalizer terminal result; duplicate callbacks re-read |
| 17 | Financial | Under/over/late pay-now | Under/late no active; over allocates amount due only and leaves remainder unmatched |
| 18 | Fairness | Promotion hold expires | Shared funnel releases slot, audits and requeues tail once; adapter only renders |
| 19 | Delivery | Payment display reject vs timeout | Definite reject reports cancel-undelivered; ambiguous timeout keeps resumable hold to TTL |

---

### Query Patterns

```sql
-- resolveIdentityFromZaloUID (protected function, per OA)
SELECT ci.id, ci.person_id, ci.platform
FROM channel_identities ci
WHERE ci.platform = 'zalo'
  AND ci.provider_scope_lookup_hash = $1  -- HMAC(oa_id + zalo_uid)
  AND ci.status = 'active';

-- getZaloBotConfig (tenant-scoped via RLS)
SELECT zb.id, zb.oa_id, zb.oa_name, zb.status,
       zb.access_token_enc, zb.refresh_token_enc
FROM zalo_bots zb
WHERE zb.tenant_id = current_setting('app.tenant_id', true)::uuid;
```

## 3. API Contract

### Endpoints

| Method | Path | Auth | Mô tả |
|--------|------|------|-------|
| POST | `/webhook/zalo` | Signed (Zalo webhook signature) | Inbound OA events → resolver → AuthZ → service |

> Không có app-facing REST API — mọi interaction qua Zalo OA webhook + DM.

### Error Codes (webhook + DM)

| Code | Error Code | Message | Trigger |
|------|-----------|---------|---------|
| 200 | (ACK) | — | Valid webhook event processed |
| 400 | `WEBHOOK_SIGNATURE_INVALID` | — | Zalo signature mismatch |
| 400 | `WEBHOOK_PAYLOAD_MALFORMED` | — | Unparseable body |
| 429 | `WEBHOOK_RATE_LIMITED` | — | Burst cap exceeded |

### DM Error Responses (user-facing)

| Situation | Response (tiếng Việt) | Error Code (internal) |
|-----------|----------------------|----------------------|
| Invalid number input | "Mình chưa hiểu, gõ số từ menu để chọn" | `INVALID_INPUT` |
| Session closed | "❌ Buổi chơi đã kết thúc" | `SESSION_CLOSED` |
| Session full | "Hết chỗ — bạn đã được thêm vào danh sách chờ" | `SESSION_FULL` |
| Payment expired | "Chỗ giữ đã hết hạn" | `HOLD_EXPIRED` |
| No eligible club | "Bạn chưa có quyền quản lý CLB phù hợp" | `NO_ELIGIBLE_CLUB` |
| Unknown command | "Gõ số để chọn từ menu" | `UNKNOWN_COMMAND` |

### Request/Response Examples

> Webhook trả theo **Zalo provider contract**; DM response theo bảng Error Responses.

**`POST /webhook/zalo`** — signature hợp lệ:

```json
{
  "event_name": "user_send_text",
  "sender": { "id": "zalo_user_id" },
  "message": { "text": "1" },
  "timestamp": "1722000000000"
}
```

Response: `200 OK` (ACK).

**Signature sai:**

```json
{ "error": "WEBHOOK_SIGNATURE_INVALID" }
```


### Zalo Adapter Commands

| Command | Auth | Mô tả |
|---------|------|-------|
| `/join` | Player DM | List open sessions |
| Number reply: session selection | Player DM | Resolve opaque context → shared safe session detail; no mutation |
| Number reply: final booking | Player DM | Resolve second context → shared channel-booking funnel |
| `/me` | Player DM | Personal summary |
| `/pay` | Player DM | Existing canonical debt/payment instructions; not a new pay-now booking intent |
| `/leave` | Player DM | Leave session |

### Join/Error Responses (Zalo DM)

| Situation | Response |
|-----------|----------|
| Stale list | "Danh sách đã thay đổi, gõ /join để xem lại" |
| Invalid number | "Số không hợp lệ — chọn từ 1 đến N" |
| Session detail | Time + public area + fee + confirmed count + slots |
| Paid final gate | “1. Liên kết Plexco — giữ chỗ, trả sau”; “2. Thanh toán & giữ chỗ 15 phút” only when available |
| Awaiting payment | Exact safe payment display + expiry; “đã trả” only polls |
| Active | "✅ Đã tham gia [session]! [venue]" |
| Waitlisted | "⏳ Bạn đang ở vị trí N" (không venue/QR) |
| Existing active/waitlisted | Render current state idempotently |
| Rejoin after `left` | Render shared result: `active`/`waitlisted`/`current`; only `REJOIN_REQUIRES_REVIEW` shows host-review copy |
| Unsupported | "Lệnh không được hỗ trợ" |

### Request/Response Examples

> Doc này không có app-facing API route → envelope DD-60 (`../../standards/api-reference-convention.md` §1.1) **không áp dụng** ở đây. Webhook trả theo **provider contract**; DM reply theo bảng copy đã pin ở trên.

- **Webhook inbound hợp lệ** (opaque token đúng, header `X-Bot-Api-Secret-Token` verify pass): xử lý event → ACK theo provider contract. Replay cùng event ID → dedup idempotent, vẫn ACK, không side-effect mới (edge #5).
- **Signature/secret sai hoặc row không đủ điều kiện** (thiếu ciphertext, `error|revoked`): reject fail-closed, không xử lý event — HTTP mapping của receiver pin ở `feature_connector_onboarding_tech.md` §3 (`401 INVALID_WEBHOOK_SECRET`, không trả nội dung).
- **DM flow minh hoạ:** player gõ `/join` → numbered list; reply `"2"` với context hết hạn → "Danh sách đã thay đổi, gõ /join để xem lại" (bảng Join/Error Responses).

### Idempotency

> Tổng hợp cơ chế đã pin trong doc — không thêm cơ chế mới.

| Interface | Idempotent? | Cơ chế |
|-----------|-------------|--------|
| Webhook event ingest | ✅ | Provider event ID dedup — replay update dedup, không side-effect mới (edge #5, test 11) |
| Number-reply consume | ✅ single-use | Lock context → validate channel identity/bot/tenant/version/TTL → consume (`consumed_at`); stale/replay reject (§4) |
| Booking intent/finalizer | ✅ | Deterministic intent + command id; terminal/current state replay returns same canonical outcome |
| `connecting→active` flip + analytics | ✅ | CAS đúng một lần; register finalization preserve `active`; analytics 1 lần (tests 25–26) |
| Outbound delivery | — | Thuộc sync engine (`feature_sync_engine_tech.md`): logical notification key + delivery ledger |

---

## 4. Chi tiết triển khai

### Number-reply Context

```text
/join → Create ordered list (opaque session refs + version + TTL)
Player replies "2" → Lock list context → Validate:
  - Same person? Same bot/tenant? Version match? Not expired?
  → YES: Consume context → resolve session → render shared safe detail
Player replies "1" to “Đăng ký” → Lock confirm context → Validate again
  → YES: Consume context → shared channel-booking decision/finalizer
  → NO: Reject with appropriate message
```

Before resolving Person, compute `provider_scope_lookup_hash=HMAC("channel-scope:zalo:"+bot_or_oa_id)` and `platform_user_lookup_hash=HMAC("channel-user:zalo:"+from.id)`. Lookup uniqueness is the three-part channel key; never use raw `from.id` alone or assume it is global across bots (DD-15).

The adapter renders only the funnel's tagged outcomes. Link handoff consumes once and resumes the same intent; pay-now uses the shared 15-minute hold and durable exact payment evidence. QR, screenshot or “đã trả” never writes booking/payment state.

### Token Operations

- Envelope encrypt bot token and webhook verification secret (KMS); persist ciphertext only.
- UI: masked display only.
- Rotation: store pending credential version in KMS → verify → atomic promote → revoke old; `rotation_pending` is metadata, never a plaintext staging field.
- Drift monitor: hourly `getWebhookInfo` compare expected URL.
- Kill switch: privileged, owner-authenticated, audited.

### Caching Strategy

| Data | Cache? | TTL | Invalidation |
|------|--------|-----|-------------|
| Bot token / webhook secret (plaintext sau KMS decrypt) | ❌ NEVER | — | Narrow decrypt per-request, xóa khỏi memory sớm nhất (§2/§4) |
| Reply context (`item_ids`/version/TTL) | ❌ | — | Đọc + lock + consume trực tiếp trong transaction; single-use |
| Channel identity / reachability | ❌ | — | Live read, fail-closed — trạng thái quyết định gửi/nhận không đọc từ cache |
| Webhook token → bot resolution | ❌ (fail-closed) | — | Đọc DB qua narrow endpoint resolver; nếu build slice cần cache thì chốt riêng kèm invalidation theo status |

### Security Checklist (template v2.33 — map về section đã pin)

| Mục | Trả lời trong spec |
|-----|---------------------|
| Authorization/ownership | §1/§2 edge #1: tenant chỉ từ webhook token/bot binding, không bao giờ từ nội dung message; DD-67: target tenant/action re-authorize riêng; kill switch owner-authenticated + audited (§4) |
| Injection/validation | §4: number-reply validate person/bot/tenant/version/TTL trước khi consume; free numeric không context → không execute (edge #11); message không hỗ trợ → safe fallback (test 18) |
| Secret & log redaction | §2/§4: bot token + webhook secret là KMS ciphertext, UI masked, log redaction (edge #7, test 24); không dual-read plaintext sau cutover |
| Webhook signature + replay | §2 edge #4: KMS decrypt hẹp + constant-time compare `X-Bot-Api-Secret-Token`, no plaintext fallback; replay dedup idempotent (edge #5) |
| Idempotency | Bảng Idempotency §3 |
| Data retention/xoá | Chưa pin per-table ở doc này — theo `feature_security_operations_tech.md` |

---

## 5. Testing Plan

### Unit Tests

| # | Test | Input | Expected |
|---|------|-------|----------|
| 1 | Webhook routes correct tenant | Valid webhook token | Correct tenant |
| 2 | Forged webhook rejected | Unknown token | Rejected |
| 3 | /join lists sessions | Open sessions exist | Numbered list |
| 4 | Valid list number reply | "2" with active context | Safe detail for session 2; no player/charge |
| 5 | Stale number reply | Expired context | "Danh sách đã thay đổi" |
| 6 | Wrong person reply | Different person | Rejected |
| 7 | Wrong bot reply | Different bot/tenant | Rejected |
| 8 | Number out of range | "99" | "Số không hợp lệ" |
| 9 | Free numeric no context | "3" without /join | No action |
| 10 | Concurrent final slot | Linked confirm + unlinked pay-now confirm | One active/live hold occupies; one waitlisted; no oversubscription |
| 11 | Event replay | Same event ID | Idempotent |
| 12 | Reachability set | First interaction | Reachable |
| 13 | Reachability isolated | Same `from.id`, two bot/OA endpoints | Two endpoint-bound identities/reachability rows; no token/window reuse |
| 14 | Blocked user | Bot blocked | Not reachable |
| 15 | Token decrypt | Encrypted token | Correct decryption |
| 16 | Token rotation | New token | Old revoked after overlap |
| 17 | Drift detected | URL mismatch | Alert triggered |
| 18 | Unsupported message | Image/sticker | Safe fallback |
| 19 | Rate limit | Excessive requests | Throttled |
| 20 | Canonical independence | Provider error | State intact |
| 21 | Rejoin after left, carry-over | Existing `left`, paid and not refunded | Shared core rejoins active/waitlisted/current and preserves effective obligation/allocation; no duplicate charge |
| 22 | Rejoin after refund | Existing `left`, refund complete | Capacity available→shared core appends one lifecycle + active; full→waitlisted/no new lifecycle until promotion. Adapter only renders result |
| 23 | Rejoin disposition unknown | Existing `left`, correction core cannot prove state | `REJOIN_REQUIRES_REVIEW`; player/charge/allocations unchanged |
| 24 | Webhook secret persistence | Connect/rotate Zalo credential | DB/log/API contain ciphertext/redacted metadata only; no raw header or plaintext secret |
| 25 | Legacy secret cutover | Legacy row can/cannot be KMS-backfilled | Encrypt then drop plaintext; unprovable row becomes `error`; receiver accepts only `connecting|registered|active|drift` with ciphertext |
| 26 | Early event vs registration | Signed event arrives after `setWebhook` but before register finalization | Event CAS sets `active`; finalization writes metadata without downgrading; analytics once |
| 27 | Browse without Account link | Exact unlinked channel identity | Safe time/area/fee/counts; no mutation |
| 28 | Final gate matrix | free/full/approval/paid-linked/paid-unlinked | Same tagged outcomes as shared decision table |
| 29 | Link resume | valid/wrong OA/replay/changed quote | Valid resumes once; invalid fails; changed quote reconfirm |
| 30 | Pay-now evidence | exact/over/under/late/wrong account/currency | Exact active once; over remainder unmatched; others no active |
| 31 | Provider unavailable | entitlement/availability unknown | No hold/reference/QR; link/web only |
| 32 | Payment display delivery | Definite reject vs timeout after hold commit | Reject cancels only if no evidence/claim; timeout keeps hold resumable |

### Integration Tests

| # | Test | Setup | Expected |
|---|------|-------|----------|
| 1 | /join → reply → joined | Full flow | Joined + venue revealed |
| 2 | Two bots isolated | 2 tenants, 2 bots | Independent routing |
| 3 | Token rotation E2E | Rotate → verify | No downtime |
| 4 | Drift detection | Change URL → wait | Alert within 1h |
| 5 | Secret migration E2E | Upgrade legacy `secret` row | KMS ciphertext verifies webhook; plaintext column/value is absent after cutover |
| 6 | Registration race E2E | Pause finalization, deliver signed event, resume | Final state remains `active`; exactly one domain delivery/analytics event |
| 7 | Zalo funnel parity | Run shared fixtures through number-reply adapter | Domain outcomes equal Messenger; rendering only differs |
| 8 | Link/payment race | Concurrent callbacks + duplicate provider event | One terminal booking/player/charge/allocation |
| 9 | Promotion hold expiry | Waitlisted unlinked paid candidate | Release + requeue tail once; next selector runs |

---

## 6. Rollout Plan + Changelog

### Rollout

1. Land forward migration for endpoint identity/reachability and `webhook_secret_enc`; KMS-backfill or disable every legacy plaintext-secret connector, then drop `secret`.
2. Sandbox bot testing with narrow decrypt/timing-safe verification and no secret in DB/log/API output.
3. Tenant #1 optional connection.
4. Browse + DD-32 final-gate commands through shared funnel.
5. Reminders/confirmations.
6. Beta clubs.

### Metrics

- Webhook validity / lag
- Reply-context expiry rate
- Join result distribution
- Booking gate/hold/settlement/expiry result distribution
- Outbound failure / rate-limit
- Drift detections / token rotations

### Changelog

| Date | Version | Thay đổi |
|---|---|---|
| 2026-08-10 | v2.8 | **A-grade upgrade:** thêm Entry points table (7 entries); bump version. Không đổi contract/adapter model. |
| 2026-07-28 | v2.7 | Mirror DD-32 Option D: number selection becomes safe detail, second context enters shared link-or-pay funnel; add qualified Account link, verified-payment hold, provider fail-closed, race/fairness tests and thin-adapter boundary. No runtime claim. |
| 2026-07-24 | v2.6b | **De-pin migration-tail** (docs-migration-tail-0018-to-0020-sweep): Live-schema boundary note hard-pinned `tail = 0018, migrations 0000–0018` + numbering guidance `(0018)` → non-pinned "verify tail hiện hành tại `packages/db/migrations/`, không hard-pin số" (live tail nay `0020`; `0019`/`0020` tenant-integrity FKs DD-68). Pre-existing dated changelog giữ verbatim. Không đổi contract. |
| 2026-07-23 | v2.6a | **Reconcile 0014 merge-state:** current-state Live-schema boundary sửa → `0014_players_waitlist` **đã merge trên `main`** (`1a6ac38`, migrations 0000–0018, tail = 0018), trước ghi "hiện chỉ ở nhánh feat/session-waitlist-expand, chưa merge". Migration-numbering guidance giữ nguyên (sync merged prerequisites → next available monotonic number sau tail đã merge, không hardcode/sửa lịch sử), chỉ đổi justification. Pre-existing dated changelog giữ verbatim. Không đổi contract. |
| 2026-07-19 | v2.6 | **Template v2.30/v2.33 uplift:** thêm §2 Migration & Rollback (baseline `0004`/`0009` reuse; new = `webhook_secret_enc` + DD-67 endpoint identity), §3 Request/Response Examples + Idempotency, §4 Caching Strategy + Security Checklist. Derivative/editorial — không đổi contract. |
| 2026-07-19 | v2.5a | Metadata sweep (index v2.35): thêm trường **Implementation** đồng bộ BUILD-STATUS (Not started). Không đổi contract. |
| 2026-07-19 | v2.5 | **DD-49 timing mirror:** refunded rejoin active→append; full→waitlisted/defer until promotion. Adapter remains thin and creates no financial state. |
| 2026-07-19 | v2.4 | **DD-45×DD-49 mirror consistency:** final-slot no-charge test is explicitly first-entry; existing-left rejoin remains delegated to shared correction core and never creates a duplicate charge in the adapter. |
| 2026-07-17 | v2.3 | **Security/lifecycle closure:** target current connector lifecycle; replace plaintext `secret` with KMS `webhook_secret_enc`; require backfill-or-disable/drop/no-dual-read plus ciphertext/state matrix and CAS race regressions before runtime. |
| 2026-07-17 | v2.2 | **DD-15/DD-49/DD-67:** endpoint-scoped Zalo identity/reachability using two domain-separated hashes; target tenant re-auth; rejoin carry-over/refunded/review test matrix. |
| 2026-07-15 | v2.1 | **DD-45:** thin adapter renders active/waitlisted/current/rejoin-review; final-slot and ledger-unchanged tests; remove "Full" error. |
| 2026-06-18 | v1.0 | Initial BE tech spec (English format) |
| 2026-06-19 | v2.0 | Chuẩn hoá Vietnamese numbered (6 sections), DDL, 12 edge cases, reply context detail, 20 tests |
