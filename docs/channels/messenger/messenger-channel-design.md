# Thiết kế kiến trúc & kế hoạch — Thêm kênh **Facebook Messenger**

## Plexco — platform thể thao đa môn: thêm kênh Messenger (port từ Telegram + Zalo)

**Phiên bản:** 2.1
**Ngày tạo:** 16/06/2026 · **Cập nhật tham chiếu:** 15/07/2026
**Tài liệu tham chiếu:** `BRD.md` v3.5 · `PRD.md` · `TDD.md` · `player-side-saas-reconciliation.md` · `player-side-saas-AUDIT.md`

> **Cập nhật v3.4 (DD-37 ✅):** Messenger nay là **kênh phase-1 (P2.5)** — không còn post-MVP. Telegram đã bị loại khỏi phạm vi; nhắc nợ chính = **web + Zalo**, Messenger best-effort trong standard window 24h. Ngoài cửa sổ chỉ dùng cơ chế Meta đủ điều kiện/được phê duyệt; **App Review bắt buộc**, Page per-club. Phase-label **P2.5.x** bên dưới thay cho P4.8.x cũ. Auth-link Facebook = **DD-33 🟡** (phase-1).

> **TL;DR:** Về kiến trúc, Messenger là **kênh thứ ba kiểu DM-only**, gần Zalo hơn Telegram. Nó **fit gần như nguyên** vào channel-abstraction sẵn có (chỉ thêm 1 enum + 1 bảng + 1 adapter + 1 webhook route). **Rủi ro lớn nhất KHÔNG phải kỹ thuật mà là chính sách:** standard messaging bị giới hạn 24h; mọi đường ngoài cửa sổ phụ thuộc eligibility/approval theo cơ chế Meta hiện hành. Vì vậy MVP fail-closed sang web + Zalo (xem §2 và §7).

> **Reposition v3.4 (Plexco platform, DD-37):** Messenger là **một surface** trong sync engine (TDD §3.8) — action ở Messenger → command → canonical store → projection; xác nhận/nhắc là projection của event. Quick-reply/button của Messenger **hợp với discovery** (liệt kê kèo để chọn) hơn Zalo number-reply. Nay là **kênh phase-1 (P2.5)** cùng web + Zalo; đường tới hạn là **App Review + Business Verification** (nộp sớm). Tái dùng ~90% khung Zalo — không còn phụ thuộc player-side Telegram (đã loại).

---

# 1. Vì sao Messenger ≠ Telegram (và giống Zalo)

| Tiêu chí | Telegram | Zalo | **Messenger** |
|---|---|---|---|
| Bot trong **group chat** | ✅ (core flow) | ❌ DM-only | **❌ DM-only** (Chat Extensions đã khai tử; group bot chỉ có trên Workplace) |
| Mô hình bot | 1 shared bot, nhiều group | bot-per-club (BYO token) | **1 App, nhiều Page** (mỗi club 1 Page) |
| Webhook | 1 endpoint `/telegram/<secret>` | per-bot `/webhook/zalo/:token` | **1 endpoint duy nhất**, route theo `entry[].id` (page_id) |
| Nút bấm / inline | ✅ inline keyboard + callback | ❌ number-reply | **✅ quick replies + buttons + postback** (giàu hơn Zalo) |
| User id | global `from.id` | per-OA user id | **PSID — page-scoped** (mỗi Page 1 id khác nhau) |
| Chia sẻ SĐT verified | ✅ `request_contact` | ✅ | **❌ không có native** → merge khó hơn |
| Nhắn chủ động ngoài 24h | ✅ không giới hạn | ⚠️ có hạn chế | **❌ rất hạn chế (xem §2)** |

**Hệ quả thiết kế cốt lõi:**

1. **Không có "phòng chung".** Flow Telegram "đăng vào group + tap [✅ Tham gia]" (PRD FLOW 3) **không port được**. Messenger phải dùng mô hình **DM bot-per-Page giống Zalo** (PRD FLOW 4) — nhưng nâng cấp number-reply thành **button/quick-reply**.
2. **Routing theo Page**, không theo nội dung — khớp đúng nguyên tắc TDD §3.3 ("tenant từ kênh, không từ nội dung").
3. **PSID page-scoped là một điểm cộng** cho multi-tenant: PSID chỉ có nghĩa trong phạm vi 1 Page = 1 tenant → `channel_identities` của Messenger **tự nhiên bị buộc vào tenant**, không lo cross-tenant id collision.

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
| **5. Identity claim & merge** | Như cũ, **trừ auto-merge bằng SĐT** (Messenger không share contact) → chỉ còn **OTP `/link`** + owner duyệt. PSID page-scoped → identity tự gắn tenant. | Vừa |
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

**Bảng mới — `messenger_pages`** (TENANT-scoped, RLS ✅; song song `zalo_bots`):

```
MESSENGER_PAGE {
    uuid id PK
    uuid tenant_id FK
    varchar page_id UK            -- route key: entry[].id từ webhook
    varchar page_access_token_enc -- KMS/AES-GCM, không log (NFR-6)
    varchar app_scoped_verify     -- (optional) phục vụ matching identity xuyên Page qua FB Login
    timestamptz token_expires_at  -- token Page có thể cần refresh
    enum status 'active|revoked'
}
```

**`channel_identities`** (GLOBAL) — thêm bản ghi cho Messenger:

```
platform = 'messenger'
platform_user_id = PSID   -- LƯU Ý: page-scoped. UNIQUE(platform, platform_user_id) vẫn đúng
                          -- vì PSID khác nhau giữa các Page → không đụng nhau.
                          -- Nếu cần merge Person xuyên Page, dùng FB Login app-scoped ID
                          -- làm canonical platform_user_id (hoặc thêm UNIQUE(platform, platform_user_id, page_id)).
```

**`channel_reachability`** — thêm dòng `(person, tenant, platform='messenger')` với:

```
can_dm: bool              -- còn trong cửa sổ 24h?
window_expires_at: timestamptz   -- MỚI: thời điểm hết cửa sổ 24h (Messenger-specific)
otn_token_enc: varchar nullable  -- MỚI: token One-Time Notification nếu user đã opt-in
```

> `window_expires_at` là bổ sung quan trọng: reminder cron phải **lọc theo cửa sổ còn hiệu lực** trước khi gửi, nếu không sẽ bị Meta chặn/khoá.

**Bảng tổng hợp (thêm vào TDD §3.2):**

| # | Table | Vùng | RLS | Pha |
|---|---|---|---|---|
| 20 | `messenger_pages` | TENANT | ✅ | P2.5 |

---

# 5. Routing & Adapter

### 5.1 Webhook — một endpoint, route theo page_id

Khác Zalo (per-bot URL). Messenger gửi **mọi** event của **mọi** Page về **một** webhook của App:

| Method | Endpoint | Auth | Mô tả |
|---|---|---|---|
| GET | `/webhook/messenger` | `hub.verify_token` (so khớp hằng số App) | xác thực webhook lúc đăng ký |
| POST | `/webhook/messenger` | **`X-Hub-Signature-256`** (HMAC app_secret, timing-safe) | nhận event mọi Page |

**Tenant resolution (bám TDD §3.3 — từ kênh, không từ nội dung):**

```
INBOUND Messenger:
  verify X-Hub-Signature-256 (timing-safe, app_secret)   // NFR-6
  for each entry in body.entry:
      page_id = entry.id
      tenant  = messenger_pages.findByPageId(page_id) -> tenant   // route key
      for each messaging in entry.messaging:
          psid = messaging.sender.id
          // cập nhật cửa sổ 24h MỖI inbound:
          reachability.upsert(person, tenant, 'messenger',
                              can_dm=true, window_expires_at = now()+24h)
          (platform='messenger', psid) -> channel_identities -> person
          membership = person ∩ tenant     // RLS qua tenantRepo
          route theo postback/text:
            'GET_STARTED' | 'pjoin:<id>' | '/me' | '/leave' | '/pay' | '/link' ...
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
- `sendChoices` → Messenger **quick replies** hoặc **button template** (postback payload = `pjoin:<sessionId>`).
- `canDeliver` (Messenger) = `now() < reachability.window_expires_at` **HOẶC** có `otn_token` chưa dùng → đây là choke-point chống vi phạm 24h.
- **Throttler** dùng lại `@grammyjs/transformer-throttler`-tư-tưởng; Messenger có rate-limit riêng theo Page → thêm bucket per page_id.

---

# 6. Onboarding tenant — nối Facebook Page (bổ sung FLOW 1)

```mermaid
sequenceDiagram
    participant Owner
    participant Web as Web onboarding
    participant FB as Facebook Login
    participant App as Backend (App)
    Owner->>Web: "Nối Facebook Page"
    Web->>FB: OAuth (scope: pages_show_list, pages_messaging, pages_manage_metadata)
    FB-->>Web: short-lived user token + danh sách Page
    Owner->>Web: chọn Page CLB
    Web->>App: exchange -> long-lived Page Access Token
    App->>App: lưu messenger_pages(page_id, token_enc) [KMS]
    App->>FB: subscribe Page vào App webhook (subscribed_apps)
    App-->>Owner: ✅ Page đã nối; gửi thử "GET_STARTED"
```

**Phải có để chạy production:**

- **Facebook App** (của platform owner) + **App Review** cho `pages_messaging` (và `Human Agent` nếu dùng cách (C)). Đây là rào cản thời gian — Meta review có thể vài ngày–tuần; **bắt đầu sớm**.
- **Business Verification** cho Business của bạn.
- Mỗi club nối Page riêng → token Page riêng (blast-radius lộ token = messaging 1 Page, không chạm tiền/DB — giống lập luận token Zalo trong AUDIT §B2).
- **Webhook drift / token revoke detection** (cron, bám TDD §3.7 `security/webhook-drift`): Page token có thể bị thu hồi khi owner đổi mật khẩu/gỡ App → phát hiện → báo owner nối lại.

---

# 7. Kế hoạch theo phase (P2.5 — phase-1, ngay sau Zalo)

> Nguyên tắc: **lift logic thuần đã có** (matching, payments, identity-resolve, format) — **0 thay đổi**. Chỉ thêm tầng kênh. Đặt **P2.5** ngay sau Zalo (P2) vì Messenger tái dùng gần hết khung Zalo; **App Review + Business Verification chạy song song từ đầu** (critical path).

| Phase | Hạng mục | DoD |
|---|---|---|
| **P2.5.0 — Spike chính sách** | Xác nhận thực địa: OTN còn mở ở VN? Utility Templates khả dụng? App Review `pages_messaging` mất bao lâu? | Có/không từng cơ chế ngoài-24h → chốt chiến lược (A/B/C) |
| **P2.5.1 — App & webhook** | Tạo FB App, verify chữ ký `X-Hub-Signature-256`, GET verify, route theo `page_id`, `messenger_pages` + migration `09_messenger_pages`, enum `messenger`. | curl giả event 2 Page → route đúng 2 tenant; sai chữ ký → 401 |
| **P2.5.2 — Adapter gửi** | `ChannelAdapter` Messenger: sendText/sendChoices (quick-reply), throttler per-page, `canDeliver` theo cửa sổ 24h. | Gửi được DM + nút; quá 24h → `canDeliver=false` |
| **P2.5.3 — Join flow** | `GET_STARTED` → resolve identity → `/join` (button list buổi, postback `pjoin:<id>`) → `addMemberToSession` (idempotent) → xác nhận + nội dung CK. | Player join qua nút; roster cập nhật |
| **P2.5.4 — Reachability 24h + reminder** | Upsert `window_expires_at` mỗi inbound; reminder cron lọc cửa sổ; OTN opt-in (nếu có); HUMAN_AGENT path cho owner bấm. | Nhắc trong 24h chạy; ngoài 24h fallback đúng (web + Zalo) |
| **P2.5.5 — notifyPlayersPaid + /myclubs** | Thêm Messenger vào `ChannelReachability` multi-kênh; magic-link cho web view. | Xác nhận trả tiền tới đúng kênh khả dụng |
| **P2.5.6 — Onboarding web** | FB Login + chọn Page + subscribe webhook + token refresh/revoke detection. | Owner lạ nối Page tới khi join được, không đụng env |

**Đường tới hạn (critical path):** App Review + Business Verification → bắt đầu ngay từ P2.5.0 vì nó chặn mọi thứ khác.

---

# 8. Rủi ro & quyết định mở

| # | Rủi ro / Câu hỏi | Mitigation / Trạng thái |
|---|---|---|
| R1 | **Nhắc nợ ngoài 24h không khả thi (VN)** — tính năng lõi yếu trên Messenger | Chiến lược A+C (+B nếu OTN mở); nói rõ kỳ vọng cho chủ CLB; định vị Messenger là kênh "join + xác nhận", **web + Zalo** gánh nhắc |
| R2 | **App Review chậm/bị từ chối** | Nộp sớm; chuẩn screencast use-case rõ ràng; có sản phẩm Zalo/web chạy thật để minh hoạ; degrade → OTP `/link` thủ công (DD-33) |
| R3 | **Không merge được bằng SĐT** (no contact share) | Chỉ dùng OTP `/link` + owner duyệt (AUDIT C3); chấp nhận tỉ lệ merge thấp hơn |
| R4 | **PSID page-scoped** — cùng người ở 2 club = 2 PSID khác | Đúng kỳ vọng multi-tenant; merge xuyên-Page qua FB Login app-scoped id (optional) hoặc OTP |
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
| 15/07/2026 | v2.1 | Chuẩn hoá policy contract: standard window 24h; outside-window chỉ khi Meta eligibility/approval cho phép; MVP fail-closed sang web + Zalo. Bỏ claim tuyệt đối rằng ngoài cửa sổ không còn bất kỳ cơ chế nào. |
| 10/07/2026 | v2.0 | **Promote phase-1 (DD-37 ✅, thay DD-09):** post-MVP/P4.8.x → **phase-1/P2.5.x**; nhắc chính = **web + Zalo** (bỏ Telegram); OD-C ✅; refs BRD v3.4. Ghi nhận ràng buộc cửa sổ 24h · outside-window policy · App Review · Page per-club. Auth-link Facebook = DD-33 🟡. |
| 19/06/2026 | — | Thêm Changelog table |
| 18/06/2026 | v1.0 | Thiết kế kênh Messenger post-MVP |
