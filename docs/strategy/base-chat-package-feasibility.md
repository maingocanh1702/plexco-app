# Plexco — Base Chat / Acquisition Package: Feasibility & Hạ tầng

> Ngày 30/06/2026 · Rev 3 (sau review canonical). Scope gói này: host/group owner **connect club** — **Telegram/Zalo là scope chính**; **Messenger chỉ là optional proposal/spike, KHÔNG thuộc base package** cho tới khi có decision override BRD/PRD/ROADMAP (xem §6). Mục tiêu: hook host + player, tạo tiền đề bán Pro.

> **Làm rõ "KHÔNG có đối soát":** nghĩa là **không có auto bank reconcile** (đọc biến động số dư tự gán player — thuộc Pro/P2–P3). Gói base **vẫn có** payment instruction (hiển thị QR/STK, `/pay`) + **trạng thái nợ thủ công** (host tự đánh dấu đã/chưa trả, `/cash`). Tức là thu tiền + theo dõi nợ **bằng tay**, chưa tự động khớp giao dịch.

> **⚠️ Naming — tránh đụng canonical phases.** "Base chat/acquisition package" ở đây **KHÔNG phải** "Phase 1" của repo. Theo ROADMAP/PRD: **P0–P1** = foundation + connector onboarding; **P2–P3** = tenant engine + ledger/đối soát; **Messenger = P4.8 (post-MVP)**. Gói này là một **lát cắt GTM/packaging** dựng trên P0–P1 + connector, **không** override BRD/PRD/ROADMAP. Nếu muốn đưa Messenger lên sớm (xem §6) thì **phải cập nhật BRD/PRD/ROADMAP** như một scope override chính thức.

---

## 0. TL;DR

- **Telegram 🟢:** 1 bot chung đa tenant, route theo `chat_id`. Free (1 msg/s/chat, 20/phút/group, ~30/s bulk; paid broadcast qua Stars nếu cần). Kênh trụ cột — đủ flow group + DM.
- **Zalo 🟡 BLOCKED:** mỗi host 1 bot (BYO) deploy chung hạ tầng — **đang vướng CO-OQ-1**: chưa confirm sandbox `getMe`/`setWebhook`/`getWebhookInfo` trên tier CLB. Hiện giữ fallback "owner dán webhook URL". Auto-register là **thiết kế dự kiến**, chưa chốt.
- **Messenger 🟡 (proposal):** đa tenant kiểu Telegram **làm được** qua **1 Page Plexco + routing `ref`**, nhưng PSID là **person-scoped, không phải tenant-scoped** → player đa club làm vỡ routing mặc định; cần decision table + consent (xem §6). Canonical hiện chọn **Page-per-club/post-MVP**.
- **Nhắc chủ động trên Messenger ngoài 24h ở VN = trả phí** (Marketing Messages); Message Tags/OTN/Recurring Notifications đang bị bỏ → nhắc nhở đẩy qua **Telegram/Zalo/web**.
- **Hạ tầng:** theo `deployment-infra.md` §9 — gói base chat (không tiền) ≈ **Tier A ~$30–50/tháng** cho ≤ vài trăm tenant. **Ngay khi bật Pro/đối soát (tiền thật) → bắt buộc Tier B ~$120–200/tháng** (money-safe). Stack: monolith + managed Postgres + **pg-boss + SSE LISTEN/NOTIFY**, **không Redis, không serverless**.
- **Giá:** dư biên so với **giá đề xuất base chat ~70k** *(GTM draft)* — lưu ý đây **không phải** plan billing canonical **0đ / 79k / 159k / 199k** (DD-03).

---

## 1. Feasibility đa tenant theo từng kênh

| Kênh | Mô hình | Verdict | Điểm chặn chính |
|---|---|---|---|
| **Telegram** | 1 bot chung, route theo `chat_id` | 🟢 **Cao** | Rate limit → queue/throttle |
| **Zalo** | Mỗi host 1 bot (BYO), deploy chung | 🟡 **BLOCKED (CO-OQ-1)** | Chưa confirm sandbox API; giữ fallback dán webhook |
| **Messenger** | 1 Page Plexco + `ref` (Model A) HOẶC Page-per-club (Model B) | 🟡 **Được nhưng cần decision** | PSID person-scoped; multi-club routing; nhắc ngoài 24h trả phí; App Review |

### 1.1 Telegram — 1 bot đa tenant (🟢)

- 1 bot token, 1 webhook; nhận update từ mọi group + DM. **Route tenant theo `chat_id`** (TDD §3.3: định tuyến suy từ kênh).
- Đủ flow: announce group + nút [Tham gia]/[Rời], DM `/me /pay /join`, nhắc/xác nhận. *(`/pay` = hiển thị QR/STK + đánh dấu nợ thủ công, chưa auto-reconcile.)*
- **Rate limit (Telegram Bot FAQ, đã xác minh):** miễn phí, nhưng **≤1 msg/s/chat**, **≤20 msg/phút/group**, **bulk ≤~30 msg/s**. Vượt → 429. Có thể bật **paid broadcast** (Telegram Stars, tới 1000 msg/s; 0,1 Star/tin vượt 30/s; cần **≥100.000 Stars + ≥100.000 MAU**). ⇒ Bắt buộc **queue + throttle** cho broadcast nhắc buổi tối.

### 1.2 Zalo — BYO bot-per-club, 🟡 **BLOCKED bởi CO-OQ-1**

- Theo `feature_connector_onboarding.md` §4.1: pattern này **chưa triển khai**, đang chờ **confirm sandbox** endpoint/tham số `getMe` / `setWebhook` / `getWebhookInfo` của Zalo Bot API trên tier CLB. **Đến khi gỡ block, giữ luồng "owner tự dán webhook URL".**
- Thiết kế **dự kiến** (sau khi gỡ block): owner tạo bot → copy token → dán vào Plexco; Plexco lưu `botTokenEnc` (KMS) + sinh `webhookToken` (**route key, KHÔNG phải bot token**) + auto `setWebhook`. State machine: `connecting → registered → active → drift → …`.
- **Không phải N server:** N bot chạy trên 1 service đa tenant, route theo `webhookToken`/path. Chi phí biên mỗi bot ≈ token + traffic ≈ không đáng kể.
- Trần beta Zalo Bot Platform: 3 bot/tài khoản, **50 user/bot, 3.000 tin/tháng/bot** + rủi ro hết beta → xem quyết định overflow §4.

### 1.3 Messenger — xem deep-dive §6 (proposal, cần decision)

---

## 2. Thiết kế đa tenant (khớp `deployment-infra.md`)

- **Canonical store** = PostgreSQL/domain model; mọi surface → command API → domain service → Postgres → outbox event → projectors.
- **Queue/realtime:** **pg-boss** (queue) + **`LISTEN/NOTIFY`** cho SSE. **KHÔNG Redis** (anti-pattern §10). Webhook **durable-ingest**: ghi bền → ACK-sau-commit → xử lý async + dedup.
- **Tenant routing suy từ kênh:** Telegram `chat_id`; Zalo `webhookToken`; Messenger `page_id` (Model B) hoặc `ref`→PSID→club (Model A, xem cảnh báo §6).
- **Cô lập tiền/roster ở tầng app** (RLS + 3 tầng hiển thị, BRD §3.2 / TDD §3.2).
- **Web/app là sản phẩm chính**; bot là kênh thông báo + deep-link router.

---

## 3. Chi phí hạ tầng — theo Tier A/B canonical

> Nguồn chuẩn: `docs/standards/deployment-infra.md` §9. Stack: monolith (web+discovery+worker) + managed Postgres (HA+PITR) + pg-boss + SSE; Cloudflare; Sentry. **Không Redis, không serverless cho worker/webhook/SSE.**

**Gói base chat/acquisition KHÔNG có dòng tiền** (đối soát ở P2–P3) → có thể chạy **Tier A** để validate:

| Tier | Khi nào | Thành phần | Chi phí/tháng |
|---|---|---|---|
| **A — MVP cheap** | ≤ vài trăm tenant, **chưa có tiền thật** | App hosting (Fly.io/Railway) $5–20 · Managed Postgres (HA+PITR, no replica) $25–30 · Cloudflare free · Sentry free | **~$30–50** |
| **B — Money-safe baseline** | **bắt buộc khi bật Pro/đối soát** | A + read replica $25–40 · WAF/CDN Pro $20 · Sentry Team $26 · app scale $20–50 · KMS $0–10 | **~$120–200** |
| C — Hardening (P6) | DAST/load/soak/pen-test/restore drill | one-off + định kỳ, không gộp hosting | ước riêng |

**Ranh giới quan trọng (cảnh báo của chính deployment-infra §9):** **money-safe = Tier B**, KHÔNG phải Tier A. Đừng dùng số Tier A để kết luận "đã đủ production khi có tiền chạy qua". Gói base chat hợp Tier A *vì chưa có tiền*; chuyển sang Pro phải lên Tier B.

**Messaging API:** Telegram free · Zalo beta · Messenger free **trong 24h** (ngoài 24h trả phí, §6) → ~0đ ở gói base chat. Chi phí scale ~tuyến tính theo primary DB size + số replica.

---

## 4. Rủi ro & quyết định cần chốt

1. **Zalo CO-OQ-1 (blocker).** Auto `getMe`/`setWebhook`/`getWebhookInfo` chưa confirm trên tier CLB → **phải test sandbox trước**. Đến lúc đó onboarding Zalo = owner dán webhook URL thủ công (ma sát cao). Đây là **điều kiện tiên quyết**, không chỉ là câu hỏi "bao nhiêu bot".
2. **Messenger multi-club routing (§6.3).** PSID person-scoped → player đa club vỡ routing `/me /pay /join`. Phải chốt: sticky-context / picker / qualifier + fallback nhập mã + consent. Nếu chọn Model A phải cập nhật canonical docs.
3. **Messenger nhắc ngoài 24h = trả phí** ở VN. Không hứa nhắc nhở free; route qua Telegram/Zalo/web.
4. **Overflow Zalo (host >50 player/bot).** Fallback: (1) đẩy player sang web/app + Telegram (COGS ~0); (2) chỉ khi bắt buộc mới lên Zalo OA/ZNS có phí.
5. **Telegram rate limit.** Queue + throttle bắt buộc cho broadcast; cân nhắc paid broadcast (Stars) nếu volume lớn.
6. **Zalo hết beta.** Theo dõi mốc Zalo công bố pricing chính thức.

---

## 5. Câu cần xác minh / việc tiếp

- **Zalo (CO-OQ-1):** confirm sandbox `getMe`/`setWebhook`/`getWebhookInfo` + cơ chế webhook per-bot (path/`webhookToken`) trước khi cam kết auto-register.
- **Messenger:** quyết Model A vs B; nếu A → bổ sung decision table routing + consent vào BRD/PRD; xác nhận lại giá Marketing Messages + danh sách loại trừ Recurring Notifications tại VN.
- **Telegram:** webhook vs long-polling; thiết kế queue/throttle; ngưỡng cân nhắc paid broadcast.
- **Hạ tầng:** chốt mốc chuyển Tier A → Tier B trùng với mốc bật Pro/đối soát.

---

## 6. Deep-dive Messenger — đa tenant 1 Page (proposal, chấp nhận 24h)

**Câu hỏi:** chấp nhận giới hạn 24h, Messenger có đa tenant như Telegram không? **Kỹ thuật: CÓ** (1 Page Plexco + `ref`). **Nhưng** có 2 vấn đề thật phải xử lý: (a) routing multi-club do PSID không phải tenant-key; (b) policy nhắc ngoài 24h. Canonical hiện chọn **Page-per-club/post-MVP**, nên Model A là **đề xuất cần bổ sung thiết kế**.

### 6.1 Cơ chế (giống Telegram 1-bot)

- 1 Page Plexco, 1 App, 1 webhook → mọi player DM vào. Link `m.me/Plexco?ref=club_<id>`:
  - Lần đầu + Get Started → `ref` về trong `messaging_postbacks`.
  - Đã có hội thoại → `ref` về trong `messaging_referrals` (reset 24h).
  - App subscribe `messaging_postbacks` + `messaging_referrals`.

### 6.2 ⚠️ Vấn đề routing — PSID KHÔNG phải tenant-key (P1)

- Telegram `chat_id` = **1 group = 1 tenant** → routing sạch. Messenger **PSID = 1 người trên 1 Page**, **không gắn tenant**. Mapping PSID→club chỉ đúng khi player thuộc **đúng 1 club**.
- **Player đa club** (rất phổ biến với P4 discovery): tin "/pay", "/me", "/join", "đã chuyển khoản" gửi vào Page chung sẽ **không biết thuộc club nào** → route sai nếu lấy mapping mặc định.
- **Decision table cần chốt:**

  | Chiến lược | Cách làm | Ưu | Nhược |
  |---|---|---|---|
  | Sticky last-context | Nhớ club gần nhất player tương tác | Mượt khi 1 club | Sai khi xen kẽ nhiều club |
  | Explicit picker | Hỏi "club nào?" khi lệnh không xác định | Chính xác | Thêm 1 bước |
  | Per-action deep-link | Mỗi nút/nhắc nhúng `ref=club_x` | Chính xác, không hỏi | Chỉ áp được cho luồng có link |
  | Qualifier trong lệnh | `/pay@club_x` | Rõ ràng | Khó cho non-tech |

  → Khuyến nghị: **per-action deep-link** làm chính + **explicit picker** làm fallback cho lệnh không xác định (unqualified command routing).
- **Consent/privacy:** 1 Page Plexco thấy mọi club mà 1 người tham gia → phải đảm bảo **cô lập hiển thị** (không lộ club này cho host club khác), và xin **consent** rõ khi bind PSID↔person↔club.
- **`ref` best-effort:** Meta không đảm bảo 100% (lỗi vài client / Page georestrict) → **fallback nhập mã club** bắt buộc.

### 6.3 Policy nhắn tin — phân biệt rõ loại tin

| Loại tin | Điều kiện | Chi phí | Nhắc nợ/buổi tập? |
|---|---|---|---|
| **Standard messaging (24h)** | User nhắn trong 24h | Free | ✅ trong 24h |
| **Human Agent** | Người trả lời ≤7 ngày sau tin user | Free | ✅ nhưng do người, không tự động |
| **Message Tags** (ACCOUNT_UPDATE…) | Update phi-marketing ngoài 24h | Free | ⚠️ **đang khai tử toàn cầu** |
| **One-Time Notification (OTN)** | Opt-in, 1 lần | Free | ⚠️ deprecated |
| **Recurring Notifications** | Opt-in, lặp | Free | ❌ **dừng (trừ AU/EU/JP/KR/UK) 10/02/2026** |
| **Marketing Messages** | Opt-in, chủ động ngoài 24h | **Trả phí** | △ thay RN; nội dung phải đúng policy |

**Kết luận policy:** ngoài 24h, các đường free (tags/OTN/RN) đang đóng dần → nhắc **tự động** ngoài 24h ở VN thực tế phải **Marketing Messages (trả phí)**, và nội dung "nhắc nợ" còn phải qua kiểm duyệt policy. ⇒ **Messenger = reactive trong 24h**; nhắc chủ động đẩy qua Telegram/Zalo/web.

### 6.4 Hai mô hình & App Review

| | **1 Page Plexco (Model A)** | Page-per-club (Model B, canonical) |
|---|---|---|
| Giống | Telegram 1-bot | Zalo bot-per-host |
| Routing | `ref`→PSID→club (**cần decision §6.2**) | `page_id` = tenant (sạch) |
| Onboarding host | Nhẹ — share link `m.me?ref=` | Nặng — host cần FB Page + OAuth |
| Branding | Plexco | Của host |
| Identity (PSID) | 1 PSID/người xuyên club | Phân mảnh theo Page |
| Rủi ro tập trung | Cao (1 Page khóa = chết hết) | Thấp (cô lập) |
| App Review | 1 lần (Page Plexco) | 1 lần app + mỗi host grant quyền |

- **App Review + Business Verification:** để nhắn **công chúng** (người không có role) cần **Advanced Access** → App Review + xác minh doanh nghiệp (1 lần). Rate KHÔNG phải vấn đề: 300 calls/s/Page; ngân sách 24h = 200 × engaged users.
- **Khuyến nghị:** nếu muốn "Messenger của Plexco" đa tenant như Telegram → **Model A**, nhưng **bắt buộc** kèm: decision routing §6.2, consent/isolation, fallback mã, và **cập nhật BRD/PRD/ROADMAP** (vì canonical đang là Model B/post-MVP).

---

## Nguồn (citation trực tiếp)

- Telegram Bot FAQ — broadcasting & rate limits: https://core.telegram.org/bots/faq#broadcasting-to-users
- Meta Messenger Platform — Send Messages (24h window, message types): https://developers.facebook.com/docs/messenger-platform/send-messages
- Meta — Marketing Messages on Messenger FAQ (paid/opt-in, thay Recurring Notifications): https://developers.facebook.com/docs/messenger-platform/marketing-messages-on-messenger/faq
- Meta — m.me links & `messaging_referrals` webhook (routing `ref`): https://developers.facebook.com/docs/messenger-platform/reference/webhook-events/messaging_referrals
- Zalo Bot Platform: https://zbot.com.vn/
- Nội bộ: `docs/standards/deployment-infra.md` §9–§10, `docs/features/feature_connector_onboarding.md` §4.1 (CO-OQ-1), `docs/product/PRD.md`, `docs/channels/web/ux-sync-design.md`.

> ⚠️ Trang Meta Marketing Messages FAQ render bằng JS, chưa đọc trực tiếp được trong phiên này — số liệu policy lấy từ tài liệu Meta + kiểm chứng chéo; **xác nhận lại trên docs Meta live** (đặc biệt tình trạng Message Tags/OTN sau khai tử và giá Marketing Messages tại VN) trước khi build.
