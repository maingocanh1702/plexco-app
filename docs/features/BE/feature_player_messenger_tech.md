# Feature: Shared Host & Player Facebook Messenger Experience — Backend Tech Spec

> **Canonical phase:** P2.5
> **Version:** 0.4 · 2026-07-17
> **Status:** Reviewed contract · Implementation pending
> **Product spec:** `../feature_player_messenger.md`
> **References:** `../../standards/decisions.md` DD-37 · **DD-65..68** · DD-33 · DD-45 · `../../channels/messenger/messenger-channel-design.md` · `feature_session_management_tech.md` · `feature_tenant_routing_authz_tech.md`

> Adapter dùng **Session/Join/AuthZ services chung** với web/Zalo. `packages/db/schema.ts` là live truth nhưng **chưa đáp ứng** hybrid contract; DD-65..68 là authority cho migration triển khai mới, không được sửa migration lịch sử.

---

## 1. Tổng quan triển khai

```text
Messenger webhook → verify signature → endpoint registry (central|tenant)
    → provider dedup → domain-separated HMAC(scope Page, user PSID) identity + endpoint reachability
    → opaque action/context resolver → exact AuthZ capability
    → shared Session/Join service → outbox → one-route delivery
```

**Hybrid:** một Meta App, một central Page bắt buộc ở cấp Plexco và optional tenant Page. `page_id` resolve endpoint/default context; target tenant/session chỉ từ opaque action, protected public ref/referral hoặc server-side eligible-role picker. **PSID là page-scoped**, nên identity và reachability đều neo theo Page endpoint.

**Ràng buộc chính sách 2026 (DD-37 / CO-3):**
- **Cửa sổ 24h:** chỉ gửi message tự do trong 24h kể từ inbound cuối của user.
- **Ngoài cửa sổ:** standard send dừng sau 24h; chỉ dùng cơ chế Meta đủ điều kiện/được phê duyệt. MVP coi luồng là **"join + xác nhận"**, **nhắc best-effort trong 24h**, fallback **web + Zalo**.
- **App Review bắt buộc** trước GA (rủi ro lịch phase-1) → degrade sang web + Zalo nếu chậm.
- **Không inline button kiểu Telegram** → dùng **quick-reply / persistent menu**.

---

## 2. Database Schema + Edge Cases (BE)

### Schema

Live schema hiện có chỉ biểu diễn one-tenant↔one-Page. Slice Messenger phải tạo migration mới cho hybrid registry, Page binding/reachability và durable interaction/action; không coi các comment dưới đây là DDL copy-paste cuối cùng trước design-probe.

```sql
-- Target contract (DD-65..68; exact names finalized by migration design-probe):
-- messenger_pages(scope central|tenant, tenant_id nullable, page_id UNIQUE,
--   status, verified_at, ...): metadata only
--   CHECK central=>tenant_id IS NULL; tenant=>tenant_id IS NOT NULL
--   partial UNIQUE one active central; partial UNIQUE one active Page per tenant
--   GLOBAL protected: narrow resolver only, no blanket app/readonly table grant
-- messenger_page_secrets(messenger_page_id UNIQUE, page_token_enc, ...):
--   narrow protected Page-token store. Meta App Secret is ONE deployment/platform
--   secret for the App and MUST NOT be copied into Page/tenant rows.
-- messenger channel identity explicitly binds messenger_page_id and uses:
--   provider_scope_lookup_hash = HMAC("channel-scope:messenger:" || page_id)
--   platform_user_lookup_hash = HMAC("channel-user:messenger:" || PSID)
--   UNIQUE(platform, provider_scope_lookup_hash, platform_user_lookup_hash)
-- endpoint reachability(channel_identity_id UNIQUE,
--   last_inbound_at, window_expires_at, eligibility...)
-- pending interaction/action storage: actor+Page-bound, TTL, target ref, version/snapshot,
--   consumed/revoked state and idempotent command_id.
```

### Edge Cases (Backend)

| # | Category | Case | Xử lý |
|---|----------|------|-------|
| 1 | Security | Tenant từ nội dung message | ❌ NEVER — Page resolves endpoint/default only; protected action/context resolver owns target tenant |
| 2 | Security | Webhook giả mạo | ❌ Reject — verify `X-Hub-Signature-256` (app secret, timing-safe) |
| 3 | Concurrency | Replay message (mid/event) | Update dedup — idempotent |
| 4 | Reachability | Gửi ngoài cửa sổ 24h | ❌ Không standard-send; chỉ gửi nếu eligible/approved mechanism tồn tại, nếu không fallback web + Zalo; đánh dấu unreachable-24h |
| 5 | Data Integrity | PSID cùng người khác Page | Page-scoped — 2 PSID; link về cùng Person qua verified account identity hoặc transactional `link_code`; không auto-merge chéo |
| 5b | Data Integrity | PSID text trùng xuyên Page | Hai domain-separated hashes + unique 3-part key; Page scope tách identity, không gán nhầm xuyên endpoint |
| 6 | Concurrency | Number/quick-reply reply last slot | Shared service locks session: first active, second waitlisted/no-charge/no-venue |
| 7 | Security | Page token / App Secret trong log/row sai owner | ❌ NEVER — Page token ở protected endpoint store; App Secret chỉ ở deployment secret manager; log redaction |
| 8 | Resilience | Provider rate-limit/outage | Backoff — không rollback canonical |
| 9 | Security | Cross-Page reachability | Scoped per channel identity + Page endpoint; never reuse window/token across Pages |
| 10 | Data Integrity | Stale/wrong/replayed quick-reply | Reject/re-render; opaque action bound actor+Page+TTL+target+snapshot/version |
| 11 | Cross-Feature | Account merge invalidates PSID context | Invalidate old context → merged person |
| 12 | Onboarding | Page chưa qua App Review | Degrade — kênh join hạn chế; nhắc qua web + Zalo |
| 13 | Financial | Existing player `left` join lại | Emit shared join payload; render canonical DD-49 outcome. Only pass through `REJOIN_REQUIRES_REVIEW` for unknown/unimplemented disposition; no adapter ledger logic |
| 14 | AuthZ | Host create from central/tenant Page | Resolve eligible tenant, require `session.manage`, re-check inside final command transaction |
| 15 | State | Wizard cancel/expire/context switch | Single pre-dispatch interceptor clears/invalidates; no scattered branch state or partial create |
| 16 | Delivery | Central and tenant endpoint both reachable | Select tenant Page then central fallback; one logical notification key prevents duplicate send |

---

## 3. API Contract

### Messenger Adapter (webhook + send)

| Interface | Auth | Mô tả |
|-----------|------|-------|
| `GET /webhook/messenger` | Public (verify_token) | Meta webhook verification handshake |
| `POST /webhook/messenger` | Signed (app secret) | Inbound events → endpoint/identity/action resolver → AuthZ → shared service |
| Quick-reply: Join | Player DM | Validate → join domain service (shared) |
| Persistent menu: `/me` `/pay` | Player DM | Personal summary / payment instructions |
| Persistent menu: `/newsession` | Host DM | Start durable wizard; preview/confirm → idempotent shared `CreateSession` |
| Host status/approve/announce/close | Host DM | Exact action capability; reuse existing deterministic handler payload/service |
| Send API (outbound) | System | Gửi trong 24h window; ngoài 24h → skip |

### Join/Error Responses (Messenger DM)

| Situation | Response |
|-----------|----------|
| Central, one eligible club | Auto-select server-side and show role-aware menu |
| Central, multiple eligible clubs | Show bounded club picker; no mutation before selection |
| No eligible club for host action | "Bạn chưa có quyền quản lý CLB phù hợp"; player discovery remains available |
| Active | "✅ Đã tham gia! [venue]" |
| Waitlisted | "⏳ Bạn đang ở vị trí N" (không venue/QR) |
| Already active/waitlisted | Render current state idempotently; không đổi rank/charge |
| Rejoin after `left` | Render shared `active`/`waitlisted`/`current`; chỉ hiện host-review khi core trả `REJOIN_REQUIRES_REVIEW` |
| Session closed | "❌ Buổi chơi đã kết thúc" |
| Stale quick-reply | "Danh sách đã thay đổi, gõ menu để xem lại" |

### Rate Limits

| Endpoint | Limit |
|----------|-------|
| `POST /webhook/messenger` | Edge per-page/IP burst cap + body-size cap (deployment-infra §6); verify trước xử |

---

## 4. Chi tiết triển khai

### Routing + PSID

```text
1. Verify X-Hub-Signature-256, parse bounded event, provider-event dedup
2. page_id → messenger_pages(active) → endpoint(scope, default_tenant?)
3. Page id + PSID → two domain-separated HMACs → 3-part channel identity bound to endpoint
   - absent → create Person + ChannelIdentity idempotently (join/approved action mới tạo membership)
4. Set/refresh endpoint reachability for that identity/Page only
5. Resolve role-aware menu or opaque action; derive target tenant/resource in protected resolver
6. Authorize exact capability; consume TTL/snapshot/version under lock; execute shared domain command
```

### Host create-session wizard

- One pre-dispatch interceptor owns `kind=create_session`, tenant, step, validated draft, expiry, version/snapshot and command id.
- Tenant/context switch, cancel, expiry or unrelated action invalidates the wizard deterministically.
- Each consume and final confirm re-checks Page/actor binding, `session.manage`, tenant status and snapshot.
- Final confirm emits exactly one `CreateSession` command to the same SessionService used by web; duplicate webhook/confirm returns prior outcome.
- Advanced configuration may deep-link web, but required/basic fields from DD-41 must complete in Messenger.

### Choices/action tokens

- Render at most 8 business choices/page plus Prev/Next/Cancel.
- Payload is an opaque server-side token; raw tenant/session/member IDs carry no authority.
- Token stores actor/Page binding, target reference, TTL, version/snapshot and one-time/replay state.

### 24h Window Handling

- Mọi outbound kiểm reachability của **candidate Page endpoint**; không project tenant-level window sang Page khác.
- Trong 24h → gửi; ngoài 24h → **skip Messenger**, để notifications dispatcher dồn **web + Zalo** (`feature_notifications_reminders_tech.md`).
- **Nhắc nợ:** Messenger **best-effort trong 24h**; không phải kênh nhắc chính (web + Zalo là chính).
- Dispatcher chọn một route: reachable tenant Page → reachable central Page linked Person → web/Zalo; logical dedup chặn double send.

### Join → sync

Join qua quick-reply/persistent menu → domain join service chung → canonical `players`/roster → outbox → project lên **web + public projection**. Adapter render outcome `active|waitlisted|current|rejoin_review`; DD-49 carry-over/refunded lifecycle nằm trong correction core, không ở adapter. Idempotent theo command id.

### Account link (DD-33 ✅ phase-1; App Review pending)

FB Login (web-auth `account_identities.platform='facebook'`) và Messenger **PSID** là hai subject khác nhau → gắn về cùng `person` qua verified account identity hoặc transactional one-time `link_code`, không auto-link chéo. Nếu App Review chậm, dùng `/link` fallback (DD-32). Không đụng core `Person`/`Membership`.

---

## 5. Testing Plan

### Unit Tests

| # | Test | Input | Expected |
|---|------|-------|----------|
| 1 | Webhook resolves endpoint | central/tenant page_id | Correct scope/default; central không tự chế tenant |
| 2 | Forged webhook | Bad signature | Rejected |
| 3 | Join opaque action valid | Correct actor/Page/target/snapshot | Joined in target tenant |
| 4 | Cross-club join from tenant Page | Source Page A, valid target session B action | Resolve B via protected ref; source A grants no authority |
| 5 | Event replay | Same mid | Idempotent |
| 6 | Outbound in 24h | Window open | Sent |
| 7 | Outbound outside 24h | Window expired | Skip Messenger, fallback web/Zalo |
| 8 | PSID page-scoped | Same person, 2 pages | 2 PSID, link via transactional `link_code` |
| 9 | Stale/wrong/replayed action | Expired/wrong actor/Page/consumed | Denied; no mutation; choices re-rendered |
| 10 | Reachability isolated | Page A vs B | Independent |
| 11 | Token/secret ownership + redaction | Config rows/logs | Page token only in endpoint secret store; App Secret only deployment secret manager; neither logged |
| 12 | Account merge | Old PSID context | Invalidated → merged person |
| 13 | Concurrent final slot | 2 quick-replies | One active+charge; one waitlisted/no-charge with positive position |
| 14 | Rejoin after left, carry-over | Paid, not refunded | Shared core rejoins with canonical current outcome; allocation preserved; no duplicate charge |
| 14b | Rejoin after refund | Refund complete | Shared core starts canonical new obligation lifecycle; adapter renders outcome |
| 14c | Rejoin disposition unknown | Core cannot prove state | `REJOIN_REQUIRES_REVIEW`; player/charge/allocations unchanged |
| 15 | Host create authorized | central and tenant Page | Same preview/command/result; one session only |
| 16 | Host create denied | player/non-admin/expired grant | `CAPABILITY_DENIED`; no session |
| 17 | Wizard lifecycle | cancel/expire/context switch/duplicate confirm | Cleared or prior result; no partial/double create |
| 18 | Pagination | >8 sessions/clubs | Stable pages + Prev/Next/Cancel, no raw IDs |
| 19 | Delivery priority | both Page endpoints open | One tenant-Page send; central suppressed by logical dedup |

### Integration Tests

| # | Test | Setup | Expected |
|---|------|-------|----------|
| 1 | Join → web sync | Quick-reply join → check web roster | Roster updated (≤ vài giây) |
| 2 | Hybrid matrix | central + 2 tenants, one tenant has Page, one does not | Host/player work on both; isolation preserved |
| 3 | 24h window fallback | Trigger reminder outside 24h | Delivered via web + Zalo |
| 4 | App Review degrade | Page pending review | Join hạn chế, nhắc web/Zalo |
| 5 | Role/context matrix | host, player, dual-role, multi-club | Correct menu/picker/capability on central+tenant Page |
| 6 | Race/replay matrix | final slot + duplicate webhook/command | One active, one waitlisted; no duplicate session/player/charge |
| 7 | Provider failure after commit | Canonical command commits, Send API fails | State retained; outbox retry/fallback; no rollback |

---

## 6. Rollout Plan + Changelog

### Rollout

1. FB App + webhook verify handshake; sandbox Page.
2. Submit **App Review** sớm (rủi ro lịch).
3. Hybrid registry migration + protected resolver + central Page binding; optional club-Page onboarding.
4. Page-scoped identity/reachability + opaque action store + single pre-dispatch interaction interceptor.
5. Role-aware host create/manage and player local/global join via shared services.
6. One-route delivery + settled confirm/best-effort reminder; outside window fallback web/Zalo.
7. (DD-33/DD-50) Account-link verified identity/transactional `link_code`.

### Metrics

- Webhook validity / signature failures
- Join result distribution
- 24h-window send success vs fallback rate
- Reachability changes / App Review status

### Changelog

| Date | Version | Thay đổi |
|---|---|---|
| 2026-07-17 | v0.4 | **decisions v1.45:** App Secret stays deployment-level; Page token moves to narrow endpoint secret store; Page/user HMAC split with 3-part key; DD-49 rejoin carry-over/refunded/review matrix. |
| 2026-07-17 | v0.3 | **DD-65..68:** hybrid registry, shared host/player pipeline, central/tenant fail-closed resolver, Page-scoped identity/reachability, durable wizard, opaque paginated actions, one-route delivery và full hybrid E2E matrix. Live schema/runtime vẫn pending migration/implementation. |
| 2026-07-15 | v0.2 | **DD-45:** thin adapter renders active/waitlisted/current/rejoin-review; final-slot and ledger-unchanged tests; remove "Full" error. |
| 2026-07-10 | v0.1 | Draft khởi tạo (DD-37 ✅ kênh + DD-33 🟡 link): routing `page_id → tenant`, PSID page-scoped identity, standard window 24h (join+confirm, nhắc best-effort 24h; outside-window chỉ khi Meta eligibility/approval cho phép), quick-reply/persistent menu, join→sync web; account-link FB↔PSID qua OTP/verified. Thay `feature_player_telegram_tech.md` (archived). |
