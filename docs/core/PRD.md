# TÀI LIỆU YÊU CẦU SẢN PHẨM (PRD) — User Flows
## Plexco — platform thể thao đa môn (host + player): Telegram · Zalo + Web app *(Messenger post-MVP)*

**Sản phẩm:** **Plexco** — platform quản lý & khám phá hoạt động thể thao đa môn, 2 phía (host + player); bot-in-chat + web app sync 2 chiều; không app native
**Phiên bản:** 2.1
**Ngày cập nhật:** 18/06/2026
**Tài liệu tham chiếu:** `BRD.md` v3.1 · `TDD.md` v2.1 · `../appendices/saas-implementation-plan.md` · `../appendices/player-side-saas-reconciliation.md` · `../appendices/player-side-saas-AUDIT.md` · `../appendices/messenger-channel-design.md` (kênh Messenger, P4.8)

> **Changelog**
> - **v2.1 (18/06/2026):** Messenger ra khỏi MVP; canonical store = PostgreSQL/domain model; webhook durable-ingest; payment allocation hỗ trợ partial/overpay/multi-person.
> - **v2.0 (18/06/2026):** **reposition** → platform đa môn 2 phía. Thêm persona P4 discovery, web app là surface trung tâm, đa môn trong FLOW 1/2, FLOW 12 discovery/tìm kèo, FLOW 13 join cross-club, FLOW 14 sync 2 chiều. Bỏ tuyên bố "không phải marketplace".
> - **v1.1 (18/06/2026):** đổi tên → **Plexco**, thêm tham chiếu Messenger.
> - **v1.0 (16/06/2026):** bản đầu — flows theo kênh, identity directory, đối soát CK đa-tenant, billing.

---

# 1. PERSONAS

- **P1 — Host / Organizer** (tenant admin): tạo & quản lý kèo (chat + web), thu tiền, gán tay, **publish kèo lên marketplace**, xem dashboard club.
- **P2 — Co-admin** (tùy chọn): được host uỷ quyền chạy lệnh quản trị.
- **P3 — Player (member)**: người chơi trong CLB — join kèo, nhận nhắc/xác nhận, xem clubs/kèo/nợ của mình.
- **P4 — Player (discovery)**: người tìm kèo mới — **khám phá kèo xuyên CLB/môn** (lọc môn/khu vực/giờ/trình độ/giá), join kèo CLB chưa từng tham gia.
- **P5 — Platform Owner** (mình): vận hành Plexco, không xuất hiện trong flow người dùng cuối.

> Plexco **là** marketplace 2 phía (host publish kèo ↔ player tìm & join). **Không** làm matchmaking xếp cặp theo trình độ, **không** booking sân — discovery = *tìm kèo có sẵn*. Tiền/roster nội bộ vẫn **cô lập tuyệt đối** (3 tầng hiển thị, xem BRD §3.2 / TDD §3.2).

---

# 2. SURFACE & COMMAND MAP

Bề mặt tương tác MVP = **web app + Telegram + Zalo**; Messenger là post-MVP. PostgreSQL/domain model là canonical store; mọi action đi qua FLOW 14:

| Surface | Dùng cho | Ai |
|---|---|---|
| **Web app** (surface) | onboarding; host dashboard (kèo/roster/doanh thu); **discovery/tìm kèo**; player view; billing | P1, P3, P4 |
| **Telegram group** (bot in group) | announce kèo + nút Tham gia/Rời + nhắc/xác nhận (mention) | P1, P3 |
| **Telegram DM** | lệnh player (`/me`,`/pay`,`/leave`,`/myclubs`,`/discover`), DM nhắc/xác nhận | P3, P4 |
| **Zalo bot DM** (bot-per-club) | join number-reply, `/me`,`/pay`, nhắc/xác nhận | P3 |
| **Messenger** (Page per-club, post-MVP P4.8) | join (quick-reply) + xác nhận; nhắc best-effort 24h | P3 |

**Command map (rút gọn):**

| Lệnh / Action | Kênh | Quyền |
|---|---|---|
| `/newsession`, `/announce`, `/config`, `/cash`, `/unmatched`, publish/approve | TG group/DM + **web** | P1/P2 (admin) |
| Nút **[✅ Tham gia]/[❌ Rời]** | TG group | P3 |
| `/join`, `/me`, `/leave`, `/pay`, `/who`, `/myclubs` | TG group/DM, Zalo DM, web | P3 |
| **`/discover` / tìm kèo** (lọc môn/khu vực/giờ) + **join cross-club** | web + TG DM | P3, P4 |
| `/name` | Zalo DM | P3 |
| `/link` (sinh mã merge) | TG/Zalo DM | P3 |

> Định tuyến tenant **suy từ kênh** (group chat_id / Zalo bot / page_id / deep-link / web-session) — KHÔNG từ nội dung tin (TDD §3.3). **Discovery KHÔNG gắn 1 tenant** — đọc public read model cross-tenant (TDD §3.9).

> **Kênh Messenger (post-MVP, P4.8):** DM bot-per-Page (có nút/quick-reply), route theo `page_id`. Flows map sang Messenger ở `../appendices/messenger-channel-design.md` §3 (FLOW 3 group-tap **không** port; nhắc nợ best-effort trong cửa sổ 24h).

---

# 3. DETAILED USER FLOWS

---

## FLOW 1: ONBOARDING TENANT (Web) *(P4)*

**Mục tiêu:** chủ CLB tự đăng ký → vận hành được, không cần platform can thiệp.

1. **Đăng nhập** web bằng **Telegram Login Widget** → tạo `Account` + `Tenant` (CLB).
2. **Nối ngân hàng (SePay/ApiPay):** nhập số TK + bank; hệ thống sinh `webhookToken` + `webhookSecret`, hiện hướng dẫn trỏ webhook ở dashboard SePay.
3. **Link Telegram:** thêm bot dùng chung vào group CLB; bind admin qua deep-link `/start link_<code>` → ghi `TelegramLink(group/admin)` + `TenantAdmin`.
4. **Nối Zalo (tùy chọn, có thể sau):** owner **tự tạo bot** trong Zalo Bot Manager (tài khoản của họ, free ≤3 bot) → **dán Bot Token** → hệ thống set webhook `/webhook/zalo/<token>`.
5. **Cấu hình:** **môn mặc định** (badminton/pickleball/…), ngôn ngữ, giá mặc định, `roster on/off`, `auto-announce on/off`, **chính sách publish (private/public mặc định) + join (open/approval)**.
6. **Checklist** trên dashboard: ☐ nối bank ☐ link Telegram ☐ tạo & (tùy chọn) publish kèo đầu.

> **DoD:** người lạ đi hết flow tới khi tạo & publish được kèo đầu, không đụng env file.

---

## FLOW 2: TẠO & ĐĂNG KÈO — Host (chat **hoặc** web) *(P2 / P4 / P4.5)*

1. Host `/newsession` (TG) **hoặc** tạo trên **web** (hoặc cron định kỳ) → set **môn**, ngày/giờ, **khu vực/venue**, giá, **slot tối đa**, **trình độ**, **visibility (private/public)**, **join policy (open/approval)**.
2. Nếu `auto-announce=on` + có group → bot **tự đăng** message join + nút vào group; hoặc `/announce <id>` đăng tay.
3. Nếu `visibility=public` → kèo được **đẩy lên marketplace** (public projection field-whitelist — FLOW 12).
4. Message hiển thị roster trực tiếp; lưu `tg_announce_chat_id/message_id` để edit live. **Mọi thay đổi sync sang web + marketplace** (FLOW 14).
5. Host `/close` (hoặc trên web), xem danh sách + trạng thái trả; kèo đóng → **hạ khỏi marketplace**.

---

## FLOW 3: PLAYER JOIN — Telegram (group-first) *(P4.5)*

1. Player **tap [✅ Tham gia]** trong group → `callback_query` mang `from.id`.
2. **Validate:** session `open` + callback từ group khớp `TelegramLink(group)` của tenant + `session.tenant_id == tenant`.
3. Resolve identity (FLOW 5) → tạo/`addMemberToSession` (idempotent theo membership) → set `PlayerChatContext = tenant`.
4. `answerCallbackQuery` + **edit roster** (live).
5. `[❌ Rời]` → bỏ nếu chưa trả; đã trả → chặn + báo.
6. Lệnh phụ trong group/DM: `/join@bot`, `/me`, `/leave`, `/pay`, `/who`.

> TG-DM nhiều CLB → resolve theo deep-link `club_<slug>` > sticky > picker (xem FLOW 5 / edge #8).

---

## FLOW 4: PLAYER JOIN — Zalo (DM number-reply) *(P4.7)*

1. Player DM bot Zalo của club `/join` → bot liệt kê buổi đang mở, đánh số.
2. Player **trả lời số** (vd `1`).
3. Resolve identity (FLOW 5) → `addMemberToSession` → trả xác nhận + **nội dung CK name-based** (P1–P3) / pay_code+QR (P4).
4. Lệnh phụ: `/me`, `/name <tên>`, `/leave`, `/pay`, `/who`.

> Zalo **không inline button** → number-reply; bot-per-club nên DM tự ghim tenant (không cần picker).

---

## FLOW 5: IDENTITY — CLAIM & MERGE *(P3.5)*

**Khi player xuất hiện lần đầu ở 1 CLB:**

1. `(platform, platformUserId)` → `ChannelIdentity` → `Person` (global). Chưa có → tạo Person.
2. Tìm `Membership(Person, Tenant)`:
   - Chưa có → matcher tên scoped-tenant:
     - Không khớp → **tạo membership mới** (an toàn, auto).
     - Khớp membership **chưa có tiền** → claim auto.
     - ⚠️ Khớp membership **đã có nợ/payment** → **KHÔNG auto theo tên** → cần khoá mạnh (owner xác nhận / CK khớp / mã link). (AUDIT C2)
     - Mơ hồ → hỏi chọn (TG inline / Zalo số).

**Merge xuyên kênh (TG ⇄ Zalo cùng người):**

1. **`/link`** ở bot A → cấp **mã OTP** (entropy cao, TTL ngắn, single-use, rate-limit) → player gửi mã ở bot B → gắn ChannelIdentity B vào Person A + **xác nhận tường minh** + audit. (AUDIT C3)
2. **SĐT verified** (share-contact TG `request_contact` / Zalo) → auto-merge.
3. STK/tên → **chỉ gợi ý, owner duyệt** (không auto). (AUDIT B4)

> Merge mà 2 Person đều có membership cùng tenant → **reconcile gộp 1 membership** (cộng nợ, 1 id) + cờ nghi-trùng. (AUDIT C4/C5)

---

## FLOW 6: ĐỐI SOÁT CK & GẠCH NỢ *(P3)*

1. CK về → **webhook SePay** `/webhook/sepay/:token` → route đúng tenant theo `webhookToken` + verify số TK.
2. Trong **một DB transaction**: insert `bank_transactions` idempotent + enqueue reconcile job/outbox; commit thành công rồi mới ACK provider.
3. Matching engine (tenant-scoped): ưu tiên `pay_code` (nếu có) → fallback **tên + số tiền + ngày**.
4. Phân bổ CK vào `charges` qua `payment_allocations`; 2 buổi đồng giá cùng ngày → **FIFO**; tổng allocation không vượt CK và chỉ mark paid khi charge được phủ đủ.
5. Match được → cập nhật charge/debt → trigger FLOW 8 (xác nhận). Còn dư/không khớp → `/unmatched` (FLOW 9); worker retry an toàn sau crash.

---

## FLOW 7: NHẮC NỢ *(P2 manual → P3 auto)*

- **Manual (P2):** owner `/remind` → nhắc người chưa trả; rate-limit.
- **Auto (P3):** cron quét người chưa trả quá ngưỡng → **TG group-mention** (`tg://user?id=`) / **DM** (Zalo/TG nếu `ChannelReachability.canDm` theo đúng tenant) → set `last_reminded_at` chống spam; quiet-hours; max N.

> `canDm` **theo (person × tenant × platform)** — Zalo bot-per-club nên nhắn được hay không phụ thuộc đúng bot club đó (AUDIT C1).

---

## FLOW 8: XÁC NHẬN ĐÃ TRẢ *(P4.5 / P4.7)*

Sau **mọi** điểm markPaid (auto-match + gán tay) → `notifyPlayersPaid(tenant, paidMembershipIds[])`:
- Chọn kênh theo `ChannelReachability` của tenant: TG mention/DM, Zalo DM (token club đó).
- Best-effort try/catch, **không chặn dòng tiền**.

---

## FLOW 9: /UNMATCHED — Owner gán tay *(P3)*

1. CK không khớp → vào danh sách `/unmatched`.
2. Owner xem → gán cho đúng player → markPaid → FLOW 8.
3. Retry cron định kỳ thử khớp lại trước khi cần tay.

---

## FLOW 10: PLAYER VIEW — `/myclubs` + Web *(P4.6)*

1. `/myclubs` (bot) hoặc web (auth = phiên verify) → liệt kê **các CLB của Person + nợ/trạng thái từng CLB**.
2. **Chỉ dữ liệu của chính họ** — đường query person-authorized, KHÔNG qua tenant-RLS thường (AUDIT C6).
3. Web Zalo cần **magic-link do bot phát** để auth (Zalo không có login widget).

---

## FLOW 11: BILLING — 99k/tháng *(P5)*

1. Tạo tenant → `trialing` (đề xuất 14 ngày).
2. Owner CK 99k vào **tài khoản platform**, nội dung mang `invoiceCode` → webhook match → đẩy `currentPeriodEnd +1 tháng`, `status=active`.
3. Hết hạn không gia hạn → `past_due` (nhắc TG/email) → sau X ngày → `suspended`.
4. **Suspended:** chặn lệnh nhưng **vẫn nhận & lưu CK player** (không mất giao dịch khi quay lại).
5. MVP có thể **manual-activate** trước khi tự động hoá match 99k.

---

## FLOW 12: DISCOVERY — Tìm kèo (marketplace) *(P4.3)*

1. Player mở **web** (`/discover`) hoặc bot (`/discover` TG DM) — **không cần là member CLB nào**.
2. Lọc: **môn** (cầu lông/pickleball/…), **khu vực**, **ngày/giờ**, **trình độ**, **giá tối đa**, **còn slot**.
3. Hệ thống đọc **`public_sessions`** (read model cross-tenant, KHÔNG RLS, **field whitelist**) → trả danh sách: môn, giờ, **khu vực** (không địa chỉ chi tiết), giá, slot trống, tên host/CLB.
4. Xem chi tiết kèo công khai — **KHÔNG** roster người khác, **KHÔNG** STK/PII, **KHÔNG** ai trả/chưa.
5. Bấm **Join** → FLOW 13.

> ⚠️ **Bất biến public (AUDIT §C8):** marketplace chỉ chứa field whitelist; tiền/PII/roster không bao giờ lộ. `venue` chi tiết chỉ hiện sau khi join/được duyệt (OD-6). Rate-limit + phân trang chống scrape.

---

## FLOW 13: JOIN CROSS-CLUB — từ marketplace *(P4.3)*

1. Player bấm Join 1 kèo public → route `session_id → tenant` (route join, không lộ tenant ra ngoài).
2. Resolve identity (FLOW 5): `(platform/web-session) → Person`. Chưa là member CLB → tạo **membership guest**.
3. Theo `join_policy` của kèo:
   - **`open`** → `addMemberToSession` ngay (nếu còn slot) → xác nhận + nội dung CK; đối soát/xác nhận theo FLOW 6/8; hết slot → báo `SESSION_FULL`.
   - **`approval`** → tạo `join_requests(pending)` → **host duyệt** (web/bot); duyệt → vào roster + thông báo player; từ chối → báo.
4. Sau join, kèo + nợ xuất hiện trong **player view** của họ (FLOW 10); mọi surface sync (FLOW 14).

> Slug/elink chỉ ghim context, **không** tự cấp quyền (AUDIT B2). Join có tiền/định danh nhạy cảm vẫn theo khoá mạnh (AUDIT C2).

---

## FLOW 14: SYNC ĐA SURFACE — web ⇄ kênh *(P4)*

**Nguyên tắc:** PostgreSQL + domain model = **canonical store**; web và các kênh là surface. Một action ở bất kỳ đâu → nhất quán mọi nơi.

1. Action ở 1 surface (host tạo kèo trên **web**; player **tap join trên Zalo**; host sửa roster trên **TG**) → chuẩn hoá thành **command** (có `commandId`).
2. Command áp vào canonical store (tenantRepo + RLS) → ghi kèm **outbox event** (cùng transaction).
3. **Dispatcher** đẩy event → **projectors** fan-out:
   - Telegram: **edit** message roster (`tg_announce_message_id`) — không spam tin mới.
   - Zalo: DM theo `ChannelReachability` đúng tenant; Messenger projector chỉ bật ở P4.8.
   - Web: **push SSE** (`tenant:<id>` cho host, `person:<id>` cho player).
   - Marketplace: upsert/xoá `public_sessions` nếu kèo public.
4. **Idempotent** (`commandId` + `event.id`); surface lệch (msg cũ/SSE rớt) → **re-project** dựng lại từ canonical.

> Surface **không bao giờ** giữ sự thật → không có conflict multi-master. Độ trễ mục tiêu p95 ≤ 3 giây, p99 ≤ 10 giây. Xác nhận đã trả (FLOW 8) là projection của event `payment.settled`.

---

# 4. EDGE CASES

## 4.1 Payment

| # | Edge case | Hành vi hệ thống | Canonical phase |
|---|---|---|---|
| 1 | **2 buổi đồng giá cùng ngày, cùng player** | Biết ai, **không pin được buổi** → FIFO allocation (net đúng); cần chính xác → VietQR-per-session | P3 |
| 2 | **Trả hộ / 1 CK cho nhiều người** | Số tiền nhập nhằng → `/unmatched`; owner tạo nhiều `payment_allocations`, tổng không vượt CK; **không tự đoán** | P3 |
| 3 | **CK sai/thiếu nội dung** | Lưu unmatched + retry cron 1h + fallback owner | P3 |
| 4 | **Trả dư / trả thiếu** | Allocation phần đã xác định; charge chỉ paid khi phủ đủ; số dư chưa phân bổ được flag cho owner | P3 |
| 5 | **Webhook trùng (cùng external_id)** | Idempotent `UNIQUE(tenant_id, provider, external_id)` + `ON CONFLICT DO NOTHING` | P3 |
| 6 | **CK thiếu id từ provider** | Sinh id tổng hợp `sha256(provider\|acct\|amount\|date\|content)` → vẫn idempotent + unmatched | P3 |
| 7 | **Hủy buổi khi có CK** | Platform không giữ tiền → owner hoàn tiền tay; log refund | P2 |

## 4.2 Identity & Routing

| # | Edge case | Hành vi | Canonical phase |
|---|---|---|---|
| 8 | **TG-DM của player thuộc >1 CLB** | deep-link `club_<slug>` > sticky `PlayerChatContext` > picker; ∈1 club → auto | P4.5 |
| 9 | **Membership trùng do race (Zalo join trước khi link TG)** | cờ nghi-trùng + tool owner merge (reconcile gộp nợ) | P3.5 |
| 10 | **Claim membership có tiền theo tên** | Cấm auto → yêu cầu owner/CK/mã link | P3.5 |
| 11 | **Mã link bị đoán/brute-force** | OTP entropy cao + TTL ngắn + rate-limit + single-use + xác nhận | P3.5 |
| 12 | **Sticky context trỏ club player không còn là member** | fail-closed → bỏ context → picker | P4.5 |
| 13 | **Zalo `message.unsupported.received`** (user nhóm bảo vệ) | không nhận nội dung → fallback owner xử tay | P4.7 |

## 4.3 Tenant / Bảo mật

| # | Edge case | Hành vi | Canonical phase |
|---|---|---|---|
| 14 | **Webhook sai token/secret/số TK** | 401/409 từ chối; vẫn lưu raw payload, không log secret | P3 |
| 15 | **Zalo bot token bị lộ** | `getWebhookInfo`-drift detection → alert + auto-reset; kill-switch reset token (AUDIT §B2) | P4.7 |
| 16 | **Lệnh admin gửi trong group bởi non-admin** | Phân quyền theo `from.id` (`TenantAdmin`), không theo chat | P2 |
| 17 | **Tenant suspended** | Chặn lệnh nhưng vẫn nhận & lưu CK player | P5 |
| 18 | **Truy vấn quên scope tenant** | RLS fail-closed → 0 dòng (không lộ) | P1 |

## 4.4 Auth & Hạ tầng

| # | Edge case | Hành vi | Canonical phase |
|---|---|---|---|
| 19 | **Cron nhắc 1k CLB cùng giờ** | throttler + rải giờ (jitter) + hàng đợi | P3 |
| 20 | **TG Login / magic-link Zalo hết hạn** | yêu cầu đăng nhập lại | P4 |
| 21 | **DM player chưa từng nhắn bot** | `canDm=false` → fallback group-mention (TG) / bỏ qua + vào bản tổng hợp owner | P4.5/4.7 |

## 4.5 Discovery / Marketplace / Sync

| # | Edge case | Hành vi | Canonical phase |
|---|---|---|---|
| 22 | **Kèo public bị sửa/đóng/huỷ** | Projector upsert/xoá `public_sessions`; đóng/quá giờ → tự hạ khỏi marketplace | P4.3 |
| 23 | **Join khi vừa hết slot (race)** | Kiểm slot trong transaction canonical → `SESSION_FULL` nếu hết; không over-fill | P4.3 |
| 24 | **Approval-mode: host không duyệt** | `join_requests` hết hạn → tự huỷ + báo player; player có thể tìm kèo khác | P4.3 |
| 25 | **Scrape/enumerate marketplace** | Rate-limit + phân trang + chỉ field whitelist; không trả tiền/PII dù lặp request | P4.3 |
| 26 | **Vị trí riêng tư** | Public chỉ `area`; `venue` chi tiết lộ sau khi join/được duyệt (OD-6) | P4.3 |
| 27 | **Sync: 2 surface sửa gần như đồng thời** | Command serialize ở canonical store (transaction) per-tenant/session; event theo thứ tự → không lệch | P4 |
| 28 | **Surface state cũ** (msg roster lỗi thời / SSE rớt) | Re-project từ canonical (edit lại msg / refresh SSE); surface không giữ sự thật | P4 |
| 29 | **Command lặp** (retry kênh) | Idempotent theo `commandId` → `STALE_COMMAND` bỏ qua, không double | P4 |
| 30 | **Kèo môn lạ / chưa có trong `sports`** | Chỉ chọn môn từ danh sách `sports` active; không tự do nhập | P1 |

---

# END OF DOCUMENT
