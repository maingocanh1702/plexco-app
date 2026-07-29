# Feature: Shared Host & Player Facebook Messenger Experience — Backend Tech Spec

> **Canonical phase:** P2.5
> **Version:** 0.9 · 2026-07-28
> **Status:** Reviewed contract · Implementation pending
> **Implementation:** Not started — `apps/bot` đã có shared job lease/ack + preflight/dispatcher/scheduler gated, nhưng chưa có Messenger adapter/handler/projector; schedule mặc định OFF và delivery placeholder · authority: `../../standards/BUILD-STATUS.md` (Doc status ≠ Implementation status)
> **Product spec:** `../feature_player_messenger.md`
> **References:** `../../standards/decisions.md` DD-32/DD-33/DD-37/DD-45/DD-49/DD-65..68 · `../../channels/messenger/messenger-channel-design.md` · `feature_channel_booking_funnel_tech.md` · `feature_session_management_tech.md` · `feature_tenant_routing_authz_tech.md`

> Adapter dùng **Session/Join/AuthZ services chung** với web/Zalo. `packages/db/schema.ts` là live truth nhưng **chưa đáp ứng** hybrid contract; DD-65..68 là authority cho migration triển khai mới, không được sửa migration lịch sử.

---

## 1. Tổng quan triển khai

```text
Messenger webhook → verify signature → endpoint registry (central|tenant)
    → provider dedup → domain-separated HMAC(scope Page, user PSID) identity + endpoint reachability
    → opaque action/context resolver → exact AuthZ capability
    → session detail projection → shared channel-booking decision/finalizer
    → canonical Session/Join/Payment owners → outbox → one-route delivery
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

### Migration & Rollback

**Baseline đã live — reuse, không recreate:** `messenger_pages` đã tồn tại từ migration `0004_channels_connectors.sql` ở shape one-tenant↔one-Page (`tenant_id NOT NULL UNIQUE`, `page_id UNIQUE`, `page_token_enc`/`app_secret_enc` inline, status vocabulary `connecting|…|revoked`), RLS/grant tenant-private ở `0009_rls_policies_grants.sql`. DROP bảng baseline = ❌ NEVER.

**Genuinely new theo DD-65..68 (chưa land trên main) → migration mới monotonic:**

1. Hybrid registry: mở `messenger_pages` sang scope `central|tenant` (tenant_id nullable + CHECK + partial UNIQUE như comment DDL trên) — thay đổi shape live hiện tại.
2. `messenger_page_secrets`: chuyển `page_token_enc` ra narrow protected store; per-Page `app_secret_enc` bị loại vì Meta App Secret là deployment/platform secret, không nằm trong Page/tenant row.
3. Endpoint-scoped channel identity 3-phần — live `channel_identities` (`0001`) vẫn UNIQUE `(platform, platform_user_lookup_hash)` 2-phần.
4. Endpoint reachability theo `channel_identity_id` — live `channel_reachability` (`0002`) vẫn PK `(person_id, tenant_id, platform)` (đã có `window_expires_at` cho 24h nhưng chưa endpoint-bound).
5. Durable interaction/action store (wizard + opaque action).

Exact names/DDL chốt ở migration design-probe (đã pin ở đầu §2); chọn **next available monotonic number** sau khi sync mọi prerequisite đã merge; không sửa migration lịch sử.

**Rollback:**

| Bước | Hành động | An toàn? |
|------|-----------|----------|
| 1 | Disable Messenger webhook receiver/adapter + tắt route Messenger ở dispatcher trước khi revert schema | ✅ |
| 2 | Migration revert mới: drop bảng/cột/constraint additive vừa thêm (registry columns, `messenger_page_secrets`, action store, endpoint-identity objects) | ✅ Additive-only revert |
| 3 | DROP `messenger_pages` baseline (`0004`) hoặc identity/reachability rows đã tạo | ❌ NEVER — dữ liệu binding/identity thật |

### Edge Cases (Backend)

| # | Category | Case | Xử lý |
|---|----------|------|-------|
| 1 | Security | Tenant từ nội dung message | ❌ NEVER — Page resolves endpoint/default only; protected action/context resolver owns target tenant |
| 2 | Security | Webhook giả mạo | ❌ Reject — verify `X-Hub-Signature-256` (app secret, timing-safe) |
| 3 | Concurrency | Replay message (mid/event) | Update dedup — idempotent |
| 4 | Reachability | Gửi ngoài cửa sổ 24h | ❌ Không standard-send; chỉ gửi nếu eligible/approved mechanism tồn tại, nếu không fallback web + Zalo; đánh dấu unreachable-24h |
| 5 | Data Integrity | PSID cùng người khác Page | Page-scoped — 2 PSID; link về cùng Person qua verified account identity hoặc transactional `link_code`; không auto-merge chéo |
| 5b | Data Integrity | PSID text trùng xuyên Page | Hai domain-separated hashes + unique 3-part key; Page scope tách identity, không gán nhầm xuyên endpoint |
| 6 | Concurrency | Two final-confirm actions at last slot | Shared occupancy locks session and counts active + live holds; exactly one holds/occupies slot, second waitlisted/no-charge/no-venue |
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
| 17 | Identity | PSID exists but no qualified Account link | Browse remains available; paid final confirm returns link-or-pay, never silently grants pay-later |
| 18 | Payment | Pay-now capability unavailable/unknown | No hold/reference/QR; return link/web alternatives |
| 19 | Concurrency | Link callback races payment event | One shared intent/finalizer terminal result; duplicate callbacks re-read current state |
| 20 | Financial | Under/over/late pay-now | Under/late no active; over allocates due only and leaves remainder unmatched |
| 21 | Fairness | Promoted unlinked player's hold expires | Shared funnel releases capacity and requeues once at tail; adapter only renders |
| 22 | Delivery | Payment display send rejects vs times out | Definite reject reports cancel-undelivered; ambiguous timeout keeps resumable hold to TTL |

---

## 3. API Contract

### Messenger Adapter (webhook + send)

| Interface | Auth | Mô tả |
|-----------|------|-------|
| `GET /webhook/messenger` | Public (verify_token) | Meta webhook verification handshake |
| `POST /webhook/messenger` | Signed (app secret) | Inbound events → endpoint/identity/action resolver → AuthZ → shared service |
| Quick-reply: Session | Player DM | Validate opaque action → shared detail projection; final-confirm action → shared channel-booking funnel |
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
| Session detail | Time + public area + fee + confirmed count + slots from shared projection |
| Paid final gate | “Liên kết Plexco — giữ chỗ, trả sau” hoặc, khi available, “Thanh toán & giữ chỗ 15 phút” |
| Awaiting payment | Exact safe payment display + expiry; “Tôi đã thanh toán” chỉ poll |
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

### Request/Response Examples

> Doc này không có app-facing API route → envelope DD-60 (`../../standards/api-reference-convention.md` §1.1) **không áp dụng** ở đây. Webhook trả theo **Meta provider contract**; DM response theo bảng Join/Error Responses đã pin ở trên.

- **`GET /webhook/messenger`** (verification handshake): echo challenge theo Meta contract khi `verify_token` đúng; sai → reject, không echo.
- **`POST /webhook/messenger`** signature hợp lệ: parse bounded event → resolver/AuthZ/shared service → ACK theo provider contract. Replay cùng `mid` → dedup idempotent, vẫn ACK, không mutation mới (edge #3).
- **Signature sai** (`X-Hub-Signature-256` không khớp): reject fail-closed, không xử lý event (edge #2); HTTP mapping chi tiết chốt ở build slice cùng receiver.
- **DM flow minh hoạ:** quick-reply join stale/consumed → "Danh sách đã thay đổi, gõ menu để xem lại"; join thành công → "✅ Đã tham gia! [venue]" (bảng đã pin).

### Idempotency

> Tổng hợp cơ chế đã pin trong doc — không thêm cơ chế mới.

| Interface | Idempotent? | Cơ chế |
|-----------|-------------|--------|
| Webhook event ingest | ✅ | Provider dedup theo `mid`/event — replay không mutation mới (edge #3, test 5) |
| Opaque action / quick-reply consume | ✅ single-use | Token bound actor+Page+TTL+target+version/snapshot; consume under lock; stale/replayed → reject/re-render (edge #10, test 9) |
| Host create-session confirm | ✅ | Đúng một `CreateSession` theo command id; duplicate webhook/confirm trả prior outcome (§4, test 17) |
| Player booking intent/finalizer | ✅ | Shared intent key + command id; already active/waitlisted/terminal returns current canonical outcome |
| Outbound delivery | ✅ | One logical notification key dedup mọi candidate route (edge #16, test 19; ledger ở `feature_sync_engine_tech.md`) |

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
6. Authorize exact capability; consume TTL/snapshot/version under lock; selection reads detail, final-confirm delegates to shared channel-booking funnel
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

### Booking funnel port → sync

Quick-reply selection reads the shared session projection only. Final confirm delegates to `decideChannelBooking()` / `finalizeChannelBookingIntent()` from `feature_channel_booking_funnel_tech.md`; Messenger never derives fee, occupancy, linked state, settlement or waitlist rank.

- Free + available → canonical active without Account/payment.
- Full → waitlisted/no charge/no venue.
- Approval → pending; no hold/payment until approved.
- Paid + qualified Account link → canonical active + exactly one charge, pay later.
- Paid + unlinked + proven settlement capability → one 15-minute hold and exact payment reference; verified full payment finalizes.
- Unknown provider/price/identity state fails closed to link/web.

Only a completed shared finalizer writes canonical `players`/charge/allocation, then outbox projects to web/roster. Adapter renders tagged `active|waitlisted|approval_pending|awaiting_link|awaiting_payment|reconfirm|manual_review|current` outcomes.

### Account link (DD-33 ✅ phase-1; App Review pending)

FB Login (web-auth `account_identities.platform='facebook'`) và Messenger **PSID** là hai subject khác nhau → explicit handoff gắn về cùng current `person`, không auto-link chéo. Booking chỉ coi linked-for-pay-later khi exact Page-scoped ChannelIdentity và một Account có verified account identity resolve cùng current Person. `/link` là mechanism/fallback, không tự nó bypass predicate; callback consumes once rồi shared finalizer revalidates session/quote/identity.

### Caching Strategy

| Data | Cache? | TTL | Invalidation |
|------|--------|-----|-------------|
| Page token / App Secret (plaintext) | ❌ NEVER | — | Page token chỉ ở narrow endpoint secret store, App Secret chỉ ở deployment secret manager; decrypt hẹp per-call |
| Reachability / 24h window | ❌ | — | Đọc live theo exact candidate Page endpoint (§4 24h Window); fail-closed — ngoài window skip, không đoán từ cache |
| Action token / wizard state | ❌ | — | Durable store, consume/invalidate under lock; single pre-dispatch interceptor (edge #15) |
| Page registry (`messenger_pages` resolve) | ❌ (fail-closed) | — | Narrow resolver đọc DB; nếu build slice cần cache thì chốt riêng kèm invalidation theo status |

### Security Checklist (template v2.33 — map về section đã pin)

| Mục | Trả lời trong spec |
|-----|---------------------|
| Authorization/ownership | Edge #1/#14: Page chỉ resolve endpoint/default, target tenant từ protected action/context resolver; exact AuthZ capability + re-check trong final command transaction; central không tự chế tenant (test 1) |
| Injection/validation | §4: parse bounded event; payload là opaque server-side token — raw tenant/session/member IDs không mang authority; consume validate actor/Page/TTL/target/snapshot |
| Secret & log redaction | Edge #7, test 11: Page token chỉ ở endpoint secret store, App Secret chỉ ở deployment secret manager, không copy vào Page/tenant row; log redaction |
| Webhook signature + replay | Edge #2/#3: verify `X-Hub-Signature-256` (app secret, timing-safe) trước xử lý; provider dedup `mid` idempotent |
| Idempotency | Bảng Idempotency §3 |
| Data retention/xoá | Chưa pin per-table ở doc này — theo `feature_security_operations_tech.md`; account merge invalidate PSID context cũ (edge #11) |

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
| 13 | Concurrent final slot | Linked confirm + unlinked pay-now confirm | One active/live hold occupies slot; other waitlisted, no oversubscription |
| 14 | Rejoin after left, carry-over | Paid, not refunded | Shared core rejoins with canonical current outcome; allocation preserved; no duplicate charge |
| 14b | Rejoin after refund | Refund complete | Capacity available→shared core appends one lifecycle + active; full→waitlisted/no new lifecycle until promotion. Adapter only renders outcome |
| 14c | Rejoin disposition unknown | Core cannot prove state | `REJOIN_REQUIRES_REVIEW`; player/charge/allocations unchanged |
| 15 | Host create authorized | central and tenant Page | Same preview/command/result; one session only |
| 16 | Host create denied | player/non-admin/expired grant | `CAPABILITY_DENIED`; no session |
| 17 | Wizard lifecycle | cancel/expire/context switch/duplicate confirm | Cleared or prior result; no partial/double create |
| 18 | Pagination | >8 sessions/clubs | Stable pages + Prev/Next/Cancel, no raw IDs |
| 19 | Delivery priority | both Page endpoints open | One tenant-Page send; central suppressed by logical dedup |
| 20 | Browse without link | Unlinked Page-scoped identity | Detail shows safe time/area/fee/counts; no identity/payment mutation |
| 21 | Final gate branches | free/full/approval/paid-linked/paid-unlinked | Exact shared tagged outcome; adapter performs no business derivation |
| 22 | Link resume | Single-use callback, wrong Page/replay/changed quote | Valid resumes same intent; wrong/replay rejected; changed quote requires reconfirm |
| 23 | Pay-now evidence | exact/over/under/late/wrong reference | Exact active once; over remainder unmatched; others no active |
| 24 | Link/payment race + retry | Concurrent callbacks/duplicate webhook | One terminal booking/player/charge/allocation |
| 25 | Payment display delivery | Definite reject vs timeout after hold commit | Reject cancels only if no evidence/claim; timeout keeps hold resumable |

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
| 8 | Messenger funnel parity | Same fixtures as Zalo/shared core | Identical domain outcomes; only rendering differs |
| 9 | Promotion hold expiry | Waitlisted unlinked paid candidate | Hold releases; candidate requeued tail once; selector continues |

---

## 6. Rollout Plan + Changelog

### Rollout

1. FB App + webhook verify handshake; sandbox Page.
2. Submit **App Review** sớm (rủi ro lịch).
3. Hybrid registry migration + protected resolver + central Page binding; optional club-Page onboarding.
4. Page-scoped identity/reachability + opaque action store + single pre-dispatch interaction interceptor.
5. Role-aware host create/manage plus player local/global browse and DD-32 final gate via shared funnel.
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
| 2026-07-28 | v0.9 | Mirror DD-32 Option D: selection becomes read-only detail, final confirm delegates to one shared decision/finalizer; pin qualified Account link, 15-minute verified-payment hold, provider fail-closed, race/fairness tests and thin-renderer outcomes. No runtime claim. |
| 2026-07-27 | v0.8 | Current-state mirror: shared job mechanics đã merge nhưng Messenger adapter/handler/projector chưa có; không đọc queue infrastructure thành channel runtime. |
| 2026-07-19 | v0.7 | **Template v2.30/v2.33 uplift:** thêm §2 Migration & Rollback (baseline `messenger_pages` `0004` reuse; new = hybrid registry/`messenger_page_secrets`/endpoint identity·reachability/action store), §3 Request/Response Examples + Idempotency, §4 Caching Strategy + Security Checklist. Derivative/editorial — không đổi contract. |
| 2026-07-19 | v0.6a | Metadata sweep (index v2.35): thêm trường **Implementation** đồng bộ BUILD-STATUS (Not started). Không đổi contract. |
| 2026-07-19 | v0.6 | **DD-49 timing mirror:** refunded rejoin active→append; full→waitlisted/defer until promotion. Messenger adapter remains thin and creates no financial state. |
| 2026-07-19 | v0.5 | **DD-45×DD-49 mirror consistency:** final-slot no-charge test is explicitly first-entry; existing-left rejoin remains delegated to shared correction core and never creates a duplicate charge in the adapter. |
| 2026-07-17 | v0.4 | **decisions v1.45:** App Secret stays deployment-level; Page token moves to narrow endpoint secret store; Page/user HMAC split with 3-part key; DD-49 rejoin carry-over/refunded/review matrix. |
| 2026-07-17 | v0.3 | **DD-65..68:** hybrid registry, shared host/player pipeline, central/tenant fail-closed resolver, Page-scoped identity/reachability, durable wizard, opaque paginated actions, one-route delivery và full hybrid E2E matrix. Live schema/runtime vẫn pending migration/implementation. |
| 2026-07-15 | v0.2 | **DD-45:** thin adapter renders active/waitlisted/current/rejoin-review; final-slot and ledger-unchanged tests; remove "Full" error. |
| 2026-07-10 | v0.1 | Draft khởi tạo (DD-37 ✅ kênh + DD-33 🟡 link): routing `page_id → tenant`, PSID page-scoped identity, standard window 24h (join+confirm, nhắc best-effort 24h; outside-window chỉ khi Meta eligibility/approval cho phép), quick-reply/persistent menu, join→sync web; account-link FB↔PSID qua OTP/verified. Thay `feature_player_telegram_tech.md` (archived). |
