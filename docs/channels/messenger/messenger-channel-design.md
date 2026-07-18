# Thiết kế kiến trúc & kế hoạch — Thêm kênh **Facebook Messenger**

## Plexco — platform thể thao đa môn: thêm kênh Messenger (port từ Telegram + Zalo)

**Phiên bản:** 2.4
**Ngày tạo:** 16/06/2026 · **Cập nhật tham chiếu:** 17/07/2026
**Tài liệu tham chiếu:** `../../product/BRD.md` v3.9b · `../../product/PRD.md` v2.8 · `../../product/TDD.md` v3.1 · `../../standards/decisions.md` v1.45 · `../../research/player-side-saas-reconciliation.md` · `../../research/player-side-saas-AUDIT.md`

> **Authority hiện hành (DD-65..68 ✅):** topology là **hybrid** — Plexco central Page luôn có, Page per-club là tuỳ chọn; cả hai là shared role-aware surface cho host và player. Các assumption Page-per-club-only/player-only trước v2.2 bị supersede. Auth-link Facebook = DD-33 ✅ (phase-1; App Review pending).

> **TL;DR:** Messenger là kênh DM-only dùng **một adapter + shared domain services**. Delta không chỉ là enum/bảng: cần global-protected hybrid Page registry, Page-scoped identity/reachability, protected context/action resolver và durable interaction owner. Rủi ro delivery lớn nhất vẫn là policy window; ngoài cửa sổ phải fail-closed sang web + Zalo.

> **Reposition v3.4 (Plexco platform, DD-37):** Messenger là **một surface** trong sync engine (TDD §3.8) — action ở Messenger → command → canonical store → projection; xác nhận/nhắc là projection của event. Quick-reply/button của Messenger **hợp với discovery** (liệt kê kèo để chọn) hơn Zalo number-reply. Nay là **kênh phase-1 (P2.5)** cùng web + Zalo; đường tới hạn là **App Review + Business Verification** (nộp sớm). Tái dùng ~90% khung Zalo — không còn phụ thuộc player-side Telegram (đã loại).

---

# 1. Vì sao Messenger ≠ Telegram (và giống Zalo)

| Tiêu chí | Telegram | Zalo | **Messenger** |
|---|---|---|---|
| Bot trong **group chat** | ✅ (core flow) | ❌ DM-only | **❌ DM-only** (Chat Extensions đã khai tử; group bot chỉ có trên Workplace) |
| Mô hình bot | 1 shared bot, nhiều group | bot-per-club (BYO token) | **1 App; central Page + optional Page per-club** |
| Webhook | 1 endpoint `/telegram/<secret>` | per-bot `/webhook/zalo/:token` | **1 endpoint duy nhất**, route theo `entry[].id` (page_id) |
| Nút bấm / inline | ✅ inline keyboard + callback | ❌ number-reply | **✅ quick replies + buttons + postback** (giàu hơn Zalo) |
| User id | global `from.id` | per-OA user id | **PSID — page-scoped** (mỗi Page 1 id khác nhau) |
| Phase-1 identity proof | Verified account email / transactional `link_code` (DD-50) | Cùng contract | Cùng contract; không phụ thuộc phone |
| Nhắn chủ động ngoài 24h | ✅ không giới hạn | ⚠️ có hạn chế | **❌ rất hạn chế (xem §2)** |

**Hệ quả thiết kế cốt lõi:**

1. **Không có "phòng chung".** Messenger dùng DM + button/quick-reply; host và player đều thao tác trên central hoặc tenant Page.
2. **Page là trusted endpoint, không luôn là tenant.** Tenant Page pin default context; central Page và cross-club action resolve target qua opaque action/public ref/server-side picker. Tenant/session không bao giờ lấy từ free text/client body.
3. **PSID chỉ có nghĩa cùng `page_id`.** Identity dùng hai keyed HMAC domain-separated: `provider_scope_lookup_hash = HMAC("channel-scope:messenger:" + page_id)` và `platform_user_lookup_hash = HMAC("channel-user:messenger:" + PSID)`, unique theo ba phần với platform. Hai PSID xuyên Page chỉ link cùng Person bằng verified identity/transactional `link_code`, không auto-merge.

---

# 2. ⚠️ Ràng buộc chính sách 2026 — phần PHẢI đọc trước khi build

Messenger có **cửa sổ nhắn 24 giờ**: Page chỉ được nhắn user tự do trong vòng 24h kể từ tin nhắn cuối của user; mỗi lần user nhắn/bấm nút → reset 24h. Ngoài 24h, các lối thoát đã thay đổi mạnh trong 2026:

| Cơ chế ngoài-24h | Trạng thái 2026 (cho VN) | Dùng được cho "nhắc nợ tự động"? |
|---|---|---|
| **Message Tags** (`ACCOUNT_UPDATE`, `POST_PURCHASE_UPDATE`, `CONFIRMED_EVENT_UPDATE`) | **❌ Đã chết.** Từ **27/04/2026** API trả error code 100. | Không |
| **Marketing Messages** (tên cũ: Recurring Notifications) | **❌ Tắt ở VN từ 10/02/2026** (chỉ còn AU, EU, JP, KR, UK). | Không (VN) |
| **HUMAN_AGENT tag** | ✅ Còn — nhắn trong **7 ngày**, nhưng **chỉ người thật trả lời câu hỏi**, không promo, không bot blast tự động. | Một phần (bán-thủ công, owner bấm gửi) |
| **One-Time Notification (OTN)** | ⚠️ Còn (cần verify region) — xin **trong** 24h quyền gửi **đúng 1 tin** ngoài 24h. | Có, nhưng 1-shot/lần opt-in |
| **Utility Templates** (Meta gợi ý thay message tags) | 🆕 Đường thay thế Meta chỉ định — cần kiểm tra khả dụng ở VN + App Review. | Có thể (đường tương lai, cần xác minh) |
| **Trong 24h, tự động** | ✅ Miễn phí, không giới hạn (đừng spam) | **Có** ✅ |

**Kết luận thẳng:** với CLB cầu lông ở VN giữa-2026, **nhắc nợ tự động ngoài 24h trên Messenger gần như không khả thi** bằng API tiêu chuẩn. So với Telegram (không có cửa sổ) và Zalo, Messenger **yếu nhất đúng ở tính năng quan trọng nhất của sản phẩm** (FLOW 7 — nhắc nợ).

**3 cách sống chung (thiết kế phải chọn):**

- **(A) Giữ user trong 24h.** Thiết kế để mỗi lượt tương tác (join, xem `/me`, bấm nút) **reset cửa sổ**; gửi nhắc/ xác nhận ngay khi còn cửa sổ. Hợp với nhịp "join hôm nay → nhắc cuối ngày".
- **(B) OTN opt-in:** lúc player join, hỏi "Cho phép bot nhắc bạn 1 lần khi tới hạn đóng tiền?" → nhận token → bắn đúng 1 nhắc ngoài 24h.
- **(C) Human-agent fallback:** ngoài 24h, **owner bấm gửi** (HUMAN_AGENT, ≤7 ngày) — bán tự động, nằm trong giới hạn "trả lời câu hỏi của user".

> Khuyến nghị phase-1: **(A) + (C)**, thêm **(B)** nếu OTN còn mở ở VN. Tài liệu hoá rõ cho chủ CLB rằng "nhắc tự động" trên Messenger = best-effort trong 24h, ngoài đó **web + Zalo** gánh hoặc owner bấm tay. (Telegram đã loại — DD-37.)

---

# 3. Đối chiếu 11 FLOW của PRD → Messenger

| FLOW (PRD) | Map sang Messenger | Độ khó |
|---|---|---|
| **1. Onboarding tenant** | Thêm bước "Nối Facebook Page": owner login FB → chọn Page → grant `pages_messaging` → lưu **Page Access Token** + đăng ký Page vào App webhook. | Vừa (cần App Review) |
| **2. Tạo & đăng buổi** | **Không có group để auto-announce.** Owner tạo buổi như cũ; "đăng" = bot **broadcast DM** tới member còn trong cửa sổ 24h / đã OTN-opt-in. | Cần đổi |
| **3. Join (Telegram group tap)** | **Không port.** Thay bằng FLOW-4-style. | N/A |
| **4. Join (Zalo number-reply)** | **Map thẳng + nâng cấp:** `/join` → bot gửi **danh sách buổi dạng quick-reply/button** → user bấm (postback `pjoin:<id>`) thay vì gõ số. | Dễ (tốt hơn Zalo) |
| **5. Identity claim & merge** | PSID page-scoped; verified account identity hoặc transactional one-time `/link` code. Owner/name/CK chỉ là review evidence, không bypass DD-50. | Vừa |
| **6. Đối soát CK & gạch nợ** | **Không đổi** — kênh tiền (SePay) độc lập với kênh chat. | Không đổi |
| **7. Nhắc nợ** | **Điểm đau** — xem §2. Tự động chỉ trong 24h / OTN; ngoài đó owner bấm (HUMAN_AGENT). | Khó (chính sách) |
| **8. Xác nhận đã trả** | Gửi DM xác nhận; **chỉ chắc gửi được nếu còn trong 24h**. Đưa vào `notifyPlayersPaid` theo `ChannelReachability(messenger)`. | Vừa |
| **9. /unmatched owner gán tay** | Không đổi (web/DM owner). | Không đổi |
| **10. Player view `/myclubs`** | Map thẳng (quick-reply liệt kê club). Web auth: cần **magic-link bot phát** như Zalo (Messenger không có login widget cho web view). | Dễ |
| **11. Billing** | Không đổi (kênh tiền platform). | Không đổi |

---

# 4. Delta Domain Model (chỉ phần thêm/sửa)

> Theo phong cách domain-first: Messenger là một `ChannelIdentity.platform` mới + một bảng kênh song song với `zalo_bots`. **Không** đụng vùng tiền (payments/sessions) — tách bạch kênh-chat khỏi kênh-tiền vẫn giữ nguyên.

**Sửa enum:**

```
platform: 'telegram' | 'zalo' | 'messenger'   // channel_identities, channel_reachability
```

**Registry `messenger_pages`** (GLOBAL-protected; thay schema tenant-only hiện tại bằng migration mới):

```
MESSENGER_PAGE {
    uuid id PK
    enum scope 'central|tenant'
    uuid tenant_id FK nullable    -- NULL iff central
    varchar page_id UK            -- route key: entry[].id từ webhook
    varchar page_access_token_enc -- KMS/AES-GCM, không log (NFR-6)
    varchar app_scoped_verify     -- (optional) phục vụ matching identity xuyên Page qua FB Login
    timestamptz token_expires_at  -- token Page có thể cần refresh
    enum status 'active|revoked'
    CHECK scope/tenant_id consistent
    UNIQUE active central; UNIQUE active tenant binding
}
```

Meta **App Secret là deployment-level secret cấp App**, không nằm/lặp trong từng Page row. Page registry/secret store chỉ sở hữu Page access token và metadata rotation/revoke tương ứng.

**`channel_identities`** (GLOBAL) — thêm bản ghi cho Messenger:

```
platform = 'messenger'
provider_scope_lookup_hash = HMAC("channel-scope:messenger:" + page_id)
platform_user_lookup_hash = HMAC("channel-user:messenger:" + PSID)
messenger_page_id = resolved registry row
UNIQUE(platform, provider_scope_lookup_hash, platform_user_lookup_hash)
// Hai hash dùng key/domain riêng; PSID thô không phải global key; không auto-link xuyên Page.
```

**Page-endpoint reachability** — gắn với `channel_identity_id`/`messenger_page_id`, không chỉ `(person, tenant, platform)`:

```
can_dm: bool              -- còn trong cửa sổ 24h?
window_expires_at: timestamptz   -- MỚI: thời điểm hết cửa sổ 24h (Messenger-specific)
otn_token_enc: varchar nullable  -- MỚI: token One-Time Notification nếu user đã opt-in
```

> `window_expires_at` là bổ sung quan trọng: reminder cron phải **lọc theo cửa sổ còn hiệu lực** trước khi gửi, nếu không sẽ bị Meta chặn/khoá.

**Bảng tổng hợp (thêm vào TDD §3.2):**

| # | Table | Vùng | RLS | Pha |
|---|---|---|---|---|
| 20 | `messenger_pages` | GLOBAL protected | resolver hẹp; no blanket grant | P2.5 |

---

# 5. Routing & Adapter

### 5.1 Webhook — một endpoint, route theo page_id

Khác Zalo (per-bot URL). Messenger gửi **mọi** event của **mọi** Page về **một** webhook của App:

| Method | Endpoint | Auth | Mô tả |
|---|---|---|---|
| GET | `/webhook/messenger` | `hub.verify_token` (so khớp hằng số App) | xác thực webhook lúc đăng ký |
| POST | `/webhook/messenger` | **`X-Hub-Signature-256`** (HMAC app_secret, timing-safe) | nhận event mọi Page |

**Context/action resolution (DD-65..68; fail-closed):**

```
INBOUND Messenger:
  verify X-Hub-Signature-256 (timing-safe, app_secret)   // NFR-6
  for each entry in body.entry:
      page_id = entry.id
      endpoint = messenger_pages.findActiveByPageId(page_id)      // central | tenant(default)
      for each messaging in entry.messaging:
          psid = messaging.sender.id
          scope_hash = HMAC("channel-scope:messenger:" + page_id)
          user_hash = HMAC("channel-user:messenger:" + psid)
          identity = lookup("messenger", scope_hash, user_hash)
          reachability.upsert(identity.id, endpoint.id, window_expires_at=now()+24h)
          action = resolveOpaqueActionOrRolePicker(message, identity, endpoint)
          context = resolveTargetTenantAndResource(action)
          authorize(action.capability, identity.person, context.tenant)
          sharedDomainService.execute(action.command)
          // missing/stale/ambiguous/replayed => deny/re-pick; never guess
```

### 5.2 Adapter trong `packages/core` / `apps/bot`

grammY không hỗ trợ Messenger sẵn → viết **một adapter mỏng** đồng dạng interface kênh hiện có (giống cách TDD §9 mô tả "grammY + adapter Zalo cùng kiểu"):

```ts
interface ChannelAdapter {
  sendText(to: ChannelRef, text: string, opts?: SendOpts): Promise<void>;
  sendChoices(to: ChannelRef, prompt: string, choices: Choice[]): Promise<void>; // TG inline | Zalo số | Messenger quick-reply
  canDeliver(to: ChannelRef): Promise<boolean>; // TG/Zalo: ~luôn true; Messenger: kiểm tra cửa sổ 24h/OTN
}
```

- **Messenger send:** `POST https://graph.facebook.com/v<ver>/<page_id>/messages` với `page_access_token`.
- `sendChoices` → quick replies/button template với **opaque server-side action token** (TTL + actor/Page binding + target + snapshot/version), không raw `sessionId`.
- `canDeliver` (Messenger) = `now() < reachability.window_expires_at` **HOẶC** có `otn_token` chưa dùng → đây là choke-point chống vi phạm 24h.
- **Throttler** dùng lại `@grammyjs/transformer-throttler`-tư-tưởng; Messenger có rate-limit riêng theo Page → thêm bucket per page_id.
- Choice list có tối đa **8 business choices/page** + Prev/Next/Cancel. Root menu role-aware; `/newsession` dùng một durable pre-dispatch interaction owner và final confirm phát đúng một idempotent `CreateSession` command.

---

# 6. Onboarding tenant — Page riêng là optional

```mermaid
sequenceDiagram
    participant Owner
    participant Web as Web onboarding
    participant FB as Facebook Login
    participant App as Backend (App)
    Owner->>Web: "Nối Page riêng (không bắt buộc)"
    Web->>FB: OAuth (scope: pages_show_list, pages_messaging, pages_manage_metadata)
    FB-->>Web: short-lived user token + danh sách Page
    Owner->>Web: chọn Page CLB
    Web->>App: exchange -> long-lived Page Access Token
    App->>App: lưu messenger_pages(page_id, token_enc) [KMS]
    App->>FB: subscribe Page vào App webhook (subscribed_apps)
    App-->>Owner: ✅ Page riêng đã nối; central Page vẫn là fallback
```

**Phải có để chạy production:**

- **Facebook App** (của platform owner) + **App Review** cho `pages_messaging` (và `Human Agent` nếu dùng cách (C)). Đây là rào cản thời gian — Meta review có thể vài ngày–tuần; **bắt đầu sớm**.
- **Business Verification** cho Business của bạn.
- Plexco central Page token do platform quản lý; Page riêng chỉ tồn tại khi club opt-in. Token leak vẫn giới hạn ở Page tương ứng và bắt buộc rotation/audit.
- **Webhook drift / token revoke detection** (cron, bám TDD §3.7 `security/webhook-drift`): Page token có thể bị thu hồi khi owner đổi mật khẩu/gỡ App → phát hiện → báo owner nối lại.

---

# 7. Kế hoạch theo phase (P2.5 — phase-1, ngay sau Zalo)

> Nguyên tắc: **lift logic thuần đã có** (matching, payments, identity-resolve, format) — **0 thay đổi**. Chỉ thêm tầng kênh. Đặt **P2.5** ngay sau Zalo (P2) vì Messenger tái dùng gần hết khung Zalo; **App Review + Business Verification chạy song song từ đầu** (critical path).

| Phase | Hạng mục | DoD |
|---|---|---|
| **P2.5.0 — Spike chính sách** | Xác nhận thực địa: OTN còn mở ở VN? Utility Templates khả dụng? App Review `pages_messaging` mất bao lâu? | Có/không từng cơ chế ngoài-24h → chốt chiến lược (A/B/C) |
| **P2.5.1 — App, hybrid registry & webhook** | Tạo FB App, verify signature, migration mới chuyển registry thành central+tenant, protected resolver, Page-scoped identity/reachability. | central + 2 tenant Page route/context đúng; sai signature/context → deny |
| **P2.5.2 — Adapter gửi** | `ChannelAdapter` Messenger: sendText/sendChoices (quick-reply), throttler per-page, `canDeliver` theo cửa sổ 24h. | Gửi được DM + nút; quá 24h → `canDeliver=false` |
| **P2.5.3 — Role-aware session flows** | `GET_STARTED` → host/player/dual menu; host create wizard; player local/global discovery + opaque join action; cùng Session/Join services với web/Zalo. | Host tạo session và player join trên central lẫn tenant Page; roster/web sync |
| **P2.5.4 — Reachability 24h + reminder** | Upsert `window_expires_at` mỗi inbound; reminder cron lọc cửa sổ; OTN opt-in (nếu có); HUMAN_AGENT path cho owner bấm. | Nhắc trong 24h chạy; ngoài 24h fallback đúng (web + Zalo) |
| **P2.5.5 — one-route delivery + /myclubs** | Page-endpoint reachability; tenant Page → central → web/Zalo priority; logical dedup. | Xác nhận tới đúng một route khả dụng, không gửi trùng |
| **P2.5.6 — Optional Page onboarding** | FB Login + chọn Page + subscribe webhook + token refresh/revoke detection. | Club không nối Page vẫn dùng central đầy đủ; club nối Page có branded parity |

**Đường tới hạn (critical path):** App Review + Business Verification → bắt đầu ngay từ P2.5.0 vì nó chặn mọi thứ khác.

---

# 8. Rủi ro & quyết định mở

| # | Rủi ro / Câu hỏi | Mitigation / Trạng thái |
|---|---|---|
| R1 | **Nhắc nợ ngoài 24h không khả thi (VN)** — tính năng lõi yếu trên Messenger | Chiến lược A+C (+B nếu OTN mở); nói rõ kỳ vọng cho chủ CLB; định vị Messenger là kênh "join + xác nhận", **web + Zalo** gánh nhắc |
| R2 | **App Review chậm/bị từ chối** | Nộp sớm; degrade → transactional one-time `/link` code (DD-33/DD-50) |
| R3 | **Không có native phone share** | Không ảnh hưởng phase-1 proof: dùng verified account email hoặc transactional `link_code`; phone dormant |
| R4 | **PSID page-scoped** — cùng người ở 2 club = 2 PSID khác | Đúng kỳ vọng multi-tenant; merge xuyên-Page qua verified FB identity hoặc transactional `link_code` |
| R5 | **Page token bị thu hồi** | webhook-drift/health cron → báo owner nối lại; blast-radius gói trong 1 Page |
| OD-A | OTN còn mở ở VN không? | ⬜ Spike P2.5.0 |
| OD-B | Utility Templates khả dụng VN + có hợp "nhắc đóng phí"? | ⬜ Spike P2.5.0 |
| OD-C | Có cần Messenger ở MVP? | ✅ **Có — kênh phase-1 (DD-37, thay DD-09)**; xem khuyến nghị dưới |

---

# 9. Khuyến nghị

1. **Có làm được** — Messenger lắp vào kiến trúc hiện tại sạch sẽ (1 enum + 1 bảng + 1 adapter + 1 webhook). Phần code **không phải** chỗ khó.
2. **Chỗ khó là chính sách 2026**, không phải kỹ thuật. Messenger **mạnh ở join (nút bấm) và xác nhận trong ngày**, nhưng **yếu ở nhắc nợ chủ động** — đúng tính năng giá trị nhất.
3. **Thứ tự phase-1:** Zalo (P2, phổ biến VN) → **Messenger (P2.5)** cho CLB có cộng đồng sống trên FB, tái dùng ~90% khung Zalo. *(Telegram đã loại khỏi phạm vi — DD-37.)*
4. **Bắt đầu App Review + Business Verification NGAY** — đó là đường tới hạn duy nhất của lịch phase-1.
5. **Định vị với chủ CLB:** trên Messenger, "join + xác nhận" tự động tốt; "nhắc nợ" là best-effort trong 24h hoặc owner bấm — ngoài 24h **web + Zalo** gánh; không hứa nhắc tự động vô hạn.

---

## Nguồn (chính sách Messenger — re-verify khi build/GA)

- [Messenger Platform Changelog — Meta for Developers](https://developers.facebook.com/docs/messenger-platform/changelog/) — nguồn primary để kiểm tra standard window và cơ chế outside-window còn eligible tại thời điểm build/GA; không hardcode một Tag/template là luôn khả dụng.
- [How To Comply with Facebook Messenger Rules in 2026 — Chatimize](https://chatimize.com/facebook-messenger-policy/) — quy tắc 24h, OTN, Marketing Messages (region-dependent 2026), HUMAN_AGENT 7 ngày.
- [Meta's deprecation of the Message Tags feature — Manychat](https://community.manychat.com/product-updates/meta-s-deprecation-of-the-message-tags-feature-on-messenger-9010) — Marketing Messages tắt 10/02/2026 trừ AU/EU/JP/KR/UK; cooldown subscription_token 24h→48h từ 01/09/2025.
- [Group and Chat Bots — Meta Workplace docs](https://developers.facebook.com/docs/workplace/bots/) — group chat bot chỉ tồn tại trên Workplace, không phải Messenger thường.

*Tài liệu này là companion cho `tdd.md`/`prd.md`; khi conflict, giữ thứ tự ưu tiên AUDIT → reconciliation → saas-implementation-plan → BRD, và cập nhật `platform` enum để có giá trị `messenger` (phase-1 — DD-37; Telegram loại khỏi phạm vi, enum có thể giữ `telegram` forward-compat trong `schema.ts`).*

---

## Changelog

| Ngày | Version | Thay đổi |
|------|---------|----------|
| 17/07/2026 | v2.4 | Feature-doc closure: identity dùng hai HMAC domain-separated + unique ba phần; App Secret là deployment-level, Page store chỉ giữ Page access token. Authority → BRD v3.9b/PRD v2.8/TDD v3.1. Runtime chưa implement. |
| 17/07/2026 | v2.3 | Authority → TDD v3.0/decisions v1.45. Messenger Page scope is one provider-endpoint instance of the shared channel identity/reachability contract; runtime scope unchanged. |
| 17/07/2026 | v2.2 (reference fix) | Current references → BRD v3.9a/PRD v2.7/TDD v2.9/decisions v1.44; contract/scope không đổi. |
| 17/07/2026 | v2.2 | **DD-65..68:** hybrid central+optional tenant Page, shared host/player surface, protected context/action resolver, Page-scoped identity/reachability, durable wizard, opaque paginated actions và one-route delivery. Gỡ assumption mỗi Page luôn bằng một tenant. |
| 15/07/2026 | v2.1 | Chuẩn hoá policy contract: standard window 24h; outside-window chỉ khi Meta eligibility/approval cho phép; MVP fail-closed sang web + Zalo. Bỏ claim tuyệt đối rằng ngoài cửa sổ không còn bất kỳ cơ chế nào. |
| 10/07/2026 | v2.0 | **Promote phase-1 (DD-37 ✅, thay DD-09):** post-MVP/P4.8.x → **phase-1/P2.5.x**; nhắc chính = **web + Zalo** (bỏ Telegram); OD-C ✅; refs BRD v3.4. Ghi nhận ràng buộc cửa sổ 24h · outside-window policy · App Review · Page per-club. Auth-link Facebook = DD-33 🟡. |
| 19/06/2026 | — | Thêm Changelog table |
| 18/06/2026 | v1.0 | Thiết kế kênh Messenger post-MVP |
