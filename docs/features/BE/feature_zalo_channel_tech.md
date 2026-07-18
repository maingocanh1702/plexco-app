# Feature: Zalo Player Channel — Backend Tech Spec

> **Canonical phase:** P4.7  
> **Version:** 2.5a · 2026-07-19
> **Status:** Reviewed · reconciled to decisions v1.67/DD-15/DD-45/DD-49/DD-67
> **Implementation:** Not started · authority: `../../standards/BUILD-STATUS.md` (Doc status ≠ Implementation status)  
> **Product spec:** `../feature_zalo_channel.md`
> **References:** `../../standards/decisions.md` DD-15/DD-45/DD-49/DD-67 · `../feature_connector_onboarding.md` BL-SEC-1 secret lifecycle · `feature_cross_club_join_tech.md` shared join outcomes
> **⚠️ Live-schema boundary:** live `channel_identities` vẫn là key **2-phần** `(platform, platform_user_lookup_hash)` và `channel_reachability` PK `(person_id, tenant_id, platform)`. Mô hình endpoint-scoped DD-67 (3-phần `provider_scope_lookup_hash`, reachability theo `channel_identity_id`) là **target**, cần migration mới land trước runtime. `0014_players_waitlist` hiện chỉ ở nhánh `feat/session-waitlist-expand`, chưa merge; slice Zalo phải sync mọi prerequisite đã merge rồi chọn **next available monotonic number**, không pin `≥0014` và không sửa migration lịch sử. Live `zalo_bots` đã có lifecycle mới ở `0004` và RLS tenant-private ở `0009`, nhưng vẫn còn legacy `secret text`; cột này **không đạt BL-SEC-1**. Target DDL dưới thay nó bằng `webhook_secret_enc`; forward migration phải KMS-encrypt/backfill hoặc vô hiệu hóa connector chưa backfill được trước khi runtime Zalo được bật.

---

## 1. Tổng quan triển khai

```text
Webhook (opaque token → bot/tenant) → Verify provider secret
    → Normalize stable event/user IDs → Update dedup
    → Identity/Domain Service (shared) → Outbox → Delivery
```

Bot-per-club model: webhook path token resolves bot endpoint/default tenant. Provider payload is NOT tenant authority. Identity lookup uses domain-separated HMACs for bot/OA scope and `from.id`; target tenant/action still re-authorize separately.

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

`webhook_token` chỉ là random opaque locator trong URL; nó không thay cho provider verification secret. Handler resolve row theo token dưới narrow endpoint resolver, decrypt `webhook_secret_enc` qua KMS, so sánh header bằng constant-time compare rồi xóa secret khỏi memory sớm nhất có thể. Migration forward thực hiện theo thứ tự: add nullable encrypted column → application/KMS backfill legacy `secret` → connector không backfill được chuyển `error` và bắt owner reconnect → add/validate CHECK buộc mọi row có thể nhận webhook (`registered|active|drift`) phải có ciphertext → drop legacy `secret`. `connecting` có thể giữ NULL trong khi setup nhưng chỉ được nhận traffic sau khi ciphertext tồn tại; verified early event CAS `connecting→active`, và register finalization phải preserve `active`. `error|revoked` không nhận traffic. Không có dual-read plaintext sau cutover.

### Edge Cases (Backend)

| # | Category | Case | Xử lý |
|---|----------|------|-------|
| 1 | Security | Tenant from message content | ❌ NEVER — webhook token/bot binding only |
| 2 | Data Integrity | Stale number (list expired/changed) | Reject — "Danh sách đã thay đổi" |
| 3 | Data Integrity | Number out of range | "Số không hợp lệ" |
| 4 | Security | Forged/unknown webhook | Reject — narrow KMS decrypt + timing-safe verify; no plaintext fallback |
| 5 | Concurrency | Replayed event | Update dedup — idempotent |
| 6 | Concurrency | Concurrent first-entry number replies last slot | Shared service locks session: first active+exactly-one-charge, second waitlisted/no-charge/no-venue |
| 7 | Security | Bot token in logs | ❌ NEVER — KMS encrypted, log redaction |
| 8 | Data Integrity | Webhook drift (URL changed) | Hourly `getWebhookInfo` — alert on drift |
| 9 | Security | DM reachability cross-club/bot | Scoped exact `channel_identity_id` bound bot/OA; independent; target tenant re-authorized |
| 10 | Resilience | Provider rate-limit/outage | Degrade — no canonical corruption |
| 11 | Security | Free numeric message without context | NEVER execute join — require active context |
| 12 | Data Integrity | Token rotation overlap | Support overlap period before revoke |
| 13 | Financial | Existing player `left` join lại | Emit shared join payload; render canonical DD-49 outcome. Only pass through `REJOIN_REQUIRES_REVIEW` for unknown/unimplemented disposition; no adapter ledger logic |

---

## 3. API Contract

### Zalo Adapter Commands

| Command | Auth | Mô tả |
|---------|------|-------|
| `/join` | Player DM | List open sessions |
| Number reply | Player DM | Join selected session |
| `/me` | Player DM | Personal summary |
| `/pay` | Player DM | Payment instructions |
| `/leave` | Player DM | Leave session |

### Join/Error Responses (Zalo DM)

| Situation | Response |
|-----------|----------|
| Stale list | "Danh sách đã thay đổi, gõ /join để xem lại" |
| Invalid number | "Số không hợp lệ — chọn từ 1 đến N" |
| Active | "✅ Đã tham gia [session]! [venue]" |
| Waitlisted | "⏳ Bạn đang ở vị trí N" (không venue/QR) |
| Existing active/waitlisted | Render current state idempotently |
| Rejoin after `left` | Render shared result: `active`/`waitlisted`/`current`; only `REJOIN_REQUIRES_REVIEW` shows host-review copy |
| Unsupported | "Lệnh không được hỗ trợ" |

---

## 4. Chi tiết triển khai

### Number-reply Context

```text
/join → Create ordered list (session IDs + version + TTL)
Player replies "2" → Lock context → Validate:
  - Same person? Same bot/tenant? Version match? Not expired?
  → YES: Consume context → resolve session → domain join service
  → NO: Reject with appropriate message
```

Before resolving Person, compute `provider_scope_lookup_hash=HMAC("channel-scope:zalo:"+bot_or_oa_id)` and `platform_user_lookup_hash=HMAC("channel-user:zalo:"+from.id)`. Lookup uniqueness is the three-part channel key; never use raw `from.id` alone or assume it is global across bots (DD-15).

### Token Operations

- Envelope encrypt bot token and webhook verification secret (KMS); persist ciphertext only.
- UI: masked display only.
- Rotation: store pending credential version in KMS → verify → atomic promote → revoke old; `rotation_pending` is metadata, never a plaintext staging field.
- Drift monitor: hourly `getWebhookInfo` compare expected URL.
- Kill switch: privileged, owner-authenticated, audited.

---

## 5. Testing Plan

### Unit Tests

| # | Test | Input | Expected |
|---|------|-------|----------|
| 1 | Webhook routes correct tenant | Valid webhook token | Correct tenant |
| 2 | Forged webhook rejected | Unknown token | Rejected |
| 3 | /join lists sessions | Open sessions exist | Numbered list |
| 4 | Valid number reply | "2" with active context | Joined session 2 |
| 5 | Stale number reply | Expired context | "Danh sách đã thay đổi" |
| 6 | Wrong person reply | Different person | Rejected |
| 7 | Wrong bot reply | Different bot/tenant | Rejected |
| 8 | Number out of range | "99" | "Số không hợp lệ" |
| 9 | Free numeric no context | "3" without /join | No action |
| 10 | Concurrent first-entry final slot | 2 replies same slot | One active+exactly-one-charge; one waitlisted/no-charge with positive position |
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

### Integration Tests

| # | Test | Setup | Expected |
|---|------|-------|----------|
| 1 | /join → reply → joined | Full flow | Joined + venue revealed |
| 2 | Two bots isolated | 2 tenants, 2 bots | Independent routing |
| 3 | Token rotation E2E | Rotate → verify | No downtime |
| 4 | Drift detection | Change URL → wait | Alert within 1h |
| 5 | Secret migration E2E | Upgrade legacy `secret` row | KMS ciphertext verifies webhook; plaintext column/value is absent after cutover |
| 6 | Registration race E2E | Pause finalization, deliver signed event, resume | Final state remains `active`; exactly one domain delivery/analytics event |

---

## 6. Rollout Plan + Changelog

### Rollout

1. Land forward migration for endpoint identity/reachability and `webhook_secret_enc`; KMS-backfill or disable every legacy plaintext-secret connector, then drop `secret`.
2. Sandbox bot testing with narrow decrypt/timing-safe verification and no secret in DB/log/API output.
3. Tenant #1 optional connection.
4. Join-only commands.
5. Reminders/confirmations.
6. Beta clubs.

### Metrics

- Webhook validity / lag
- Reply-context expiry rate
- Join result distribution
- Outbound failure / rate-limit
- Drift detections / token rotations

### Changelog

| Date | Version | Thay đổi |
|---|---|---|
| 2026-07-19 | v2.5a | Metadata sweep (index v2.35): thêm trường **Implementation** đồng bộ BUILD-STATUS (Not started). Không đổi contract. |
| 2026-07-19 | v2.5 | **DD-49 timing mirror:** refunded rejoin active→append; full→waitlisted/defer until promotion. Adapter remains thin and creates no financial state. |
| 2026-07-19 | v2.4 | **DD-45×DD-49 mirror consistency:** final-slot no-charge test is explicitly first-entry; existing-left rejoin remains delegated to shared correction core and never creates a duplicate charge in the adapter. |
| 2026-07-17 | v2.3 | **Security/lifecycle closure:** target current connector lifecycle; replace plaintext `secret` with KMS `webhook_secret_enc`; require backfill-or-disable/drop/no-dual-read plus ciphertext/state matrix and CAS race regressions before runtime. |
| 2026-07-17 | v2.2 | **DD-15/DD-49/DD-67:** endpoint-scoped Zalo identity/reachability using two domain-separated hashes; target tenant re-auth; rejoin carry-over/refunded/review test matrix. |
| 2026-07-15 | v2.1 | **DD-45:** thin adapter renders active/waitlisted/current/rejoin-review; final-slot and ledger-unchanged tests; remove "Full" error. |
| 2026-06-18 | v1.0 | Initial BE tech spec (English format) |
| 2026-06-19 | v2.0 | Chuẩn hoá Vietnamese numbered (6 sections), DDL, 12 edge cases, reply context detail, 20 tests |
