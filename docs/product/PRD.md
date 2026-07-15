# TÀI LIỆU YÊU CẦU SẢN PHẨM (PRD) — User Flows
## Plexco — platform thể thao đa môn (host + player): Zalo · Facebook Messenger + Web app *(Telegram đã loại khỏi phạm vi)*

**Sản phẩm:** **Plexco** — platform quản lý & khám phá hoạt động thể thao đa môn, 2 phía (host + player); bot-in-chat (Zalo/Messenger) + web app sync 2 chiều; không app native
**Phiên bản:** 2.4
**Ngày cập nhật:** 15/07/2026
**Tài liệu tham chiếu:** `BRD.md` v3.5 · `TDD.md` v2.4 · `../strategy/saas-implementation-plan.md` · `../research/player-side-saas-reconciliation.md` · `../research/player-side-saas-AUDIT.md` · `../channels/messenger/messenger-channel-design.md` (kênh Messenger — nay là phase-1) · `../standards/decisions.md` (DD-05/06/08/32/37/13/33/38/39/40/41/42/43/44/45/46/47/48)

## Changelog

| Ngày | Version | Thay đổi |
|------|---------|----------|
| 15/07/2026 | v2.4 | **Decision reconcile + review fixes:** refs qua DD-48 theo `decisions.md` v1.32; đồng bộ phase Messenger P2.5/P4.5 và Zalo P4.7; chuẩn hoá policy wording Messenger 24h. Session/social là contract build P2–P4+; flow chi tiết (gating/attendance/tags/invite/Skip-Club/follow) viết cùng build slice. |
| 15/07/2026 | v2.3 | **DD-45:** FLOW 13 và discovery race đổi `SESSION_FULL` thành active-vs-waitlisted outcome; full không charge/venue, promotion mới tạo charge; approval full cũng vào waitlist. |
| 10/07/2026 | v2.2 (review fixes) | **DD-38/39 ✅ scope-committed phase-1** — FLOW 15 + surface map + FLOW 1/2/6 bỏ 🟡/proposal (schema `chat_*`/`person.gender` vẫn chờ migration, không claim done). **Money vocab → canonical ledger:** FLOW 6 mark-paid = INSERT `payment_allocations` (cash/manual) + cập nhật `charges`, bỏ bảng `payment` & source `bank_transfer`. Đồng bộ `decisions.md` v1.16. |
| 10/07/2026 | v2.2 | **v3.4 channel pivot: bỏ Telegram; Messenger + Zalo là kênh phase-1 (+ Google login/chat/gender-pricing/manual mark-paid) — DD-37/13/33/38/39/40.** Surface & command map bỏ Telegram, thêm Messenger phase-1; FLOW 1 auth = Google OAuth + email (bỏ TG Login); FLOW 3 player join → Messenger (quick-reply, cửa sổ 24h); FLOW 6 thêm mark-paid thủ công tiền mặt/CK (tap/multi-select, DD-40); FLOW 7/8 nhắc & xác nhận qua web + Zalo (Messenger best-effort 24h); FLOW 5/10/14 bỏ Telegram identity/projector. Chat in-app (DD-38 🟡) + cài đặt hồ sơ/giá theo giới tính (DD-39 🟡) nêu ở dạng proposal. |
| 19/06/2026 | v2.1 | Chuẩn hoá Changelog table format |
| 18/06/2026 | v2.1 | Messenger ra khỏi MVP; canonical store = PostgreSQL/domain model; webhook durable-ingest; payment allocation hỗ trợ partial/overpay/multi-person |
| 18/06/2026 | v2.0 | **Reposition** → platform đa môn 2 phía. Thêm persona P4 discovery, web app là surface trung tâm, đa môn trong FLOW 1/2, FLOW 12 discovery/tìm kèo, FLOW 13 join cross-club, FLOW 14 sync 2 chiều |
| 18/06/2026 | v1.1 | Đổi tên → **Plexco**, thêm tham chiếu Messenger |
| 16/06/2026 | v1.0 | Bản đầu — flows theo kênh, identity directory, đối soát CK đa-tenant, billing |

---

# 1. PERSONAS

- **P1 — Host / Organizer** (tenant admin): tạo & quản lý kèo (chat + web), thu tiền, **mark-paid thủ công (tiền mặt/CK)** + gán tay, **publish kèo lên marketplace**, xem dashboard club.
- **P2 — Co-admin** (tùy chọn): được host uỷ quyền chạy lệnh quản trị.
- **P3 — Player (member)**: người chơi trong CLB — join kèo, nhận nhắc/xác nhận, xem clubs/kèo/nợ của mình.
- **P4 — Player (discovery)**: người tìm kèo mới — **khám phá kèo xuyên CLB/môn** (lọc môn/khu vực/giờ/trình độ/giá), join kèo CLB chưa từng tham gia.
- **P5 — Platform Owner** (mình): vận hành Plexco, không xuất hiện trong flow người dùng cuối.

> Plexco **là** marketplace 2 phía (host publish kèo ↔ player tìm & join). **Không** làm matchmaking xếp cặp theo trình độ, **không** booking sân — discovery = *tìm kèo có sẵn*. Tiền/roster/chat nội bộ vẫn **cô lập tuyệt đối** (3 tầng hiển thị, xem BRD §3.2 / TDD §3.2).

---

# 2. SURFACE & COMMAND MAP

Bề mặt tương tác phase-1 = **web app + Zalo + Facebook Messenger**. **Telegram đã loại khỏi phạm vi (DD-37).** PostgreSQL/domain model là canonical store; mọi action đi qua FLOW 14:

| Surface | Dùng cho | Ai |
|---|---|---|
| **Web app** (surface) | onboarding; host dashboard (kèo/roster/doanh thu); **discovery/tìm kèo**; player view; billing; **chat in-app** (DD-38 ✅); cài đặt hồ sơ (DD-39 ✅) | P1, P3, P4 |
| **Zalo bot DM** (bot-per-club) | join number-reply, `/me`,`/pay`,`/name`, nhắc/xác nhận (kênh chính cùng web) | P3 |
| **Facebook Messenger** (Page per-club, **phase-1**) | join (quick-reply / persistent menu) + xác nhận; nhắc **best-effort trong cửa sổ 24h** | P3 |

**Command map (rút gọn):**

| Lệnh / Action | Kênh | Quyền |
|---|---|---|
| `/newsession`, `/announce`, `/config`, `/cash`, **mark-paid (tap/multi-select tiền mặt/CK)**, `/unmatched`, publish/approve | web + Zalo/Messenger DM | P1/P2 (admin) |
| **Join** (Messenger quick-reply / Zalo number-reply / web 1-click) | Messenger, Zalo, web | P3 |
| `/me`, `/leave`, `/pay`, `/who`, `/myclubs` | Zalo/Messenger DM, web | P3 |
| **`/discover` / tìm kèo** (lọc môn/khu vực/giờ) + **join cross-club** | web + Zalo/Messenger DM | P3, P4 |
| `/name` | Zalo/Messenger DM | P3 |
| `/link` (sinh mã merge) | Zalo/Messenger DM | P3 |

> Định tuyến tenant **suy từ kênh** (Zalo `webhook_token` / Messenger `page_id` / deep-link / web-session) — KHÔNG từ nội dung tin (TDD §3.3). **Discovery KHÔNG gắn 1 tenant** — đọc public read model cross-tenant (TDD §3.9).

> **Kênh Messenger (phase-1):** DM bot-per-Page (quick-reply/persistent menu), route theo `page_id`; standard messaging trong **cửa sổ 24h**, ngoài cửa sổ chỉ qua cơ chế Meta đủ điều kiện/được phê duyệt → MVP tập trung "join + xác nhận" và nhắc **best-effort trong 24h**; cần **App Review** trước GA. Flows map sang Messenger ở `../channels/messenger/messenger-channel-design.md` §3 (không port tap-nút group; nhắc nợ chính dồn qua web + Zalo).

---

# 3. DETAILED USER FLOWS

---

## FLOW 1: ONBOARDING TENANT (Web) *(P4)*

**Mục tiêu:** chủ CLB tự đăng ký → vận hành được, không cần platform can thiệp.

1. **Đăng nhập** web bằng **Google OAuth** hoặc **tài khoản web (email + mật khẩu)** (DD-13) → tạo `Account` + `Tenant` (CLB). *(Telegram Login: đã loại.)*
2. **Nối ngân hàng (SePay/ApiPay):** nhập số TK + bank; hệ thống sinh `webhookToken` + `webhookSecret`, hiện hướng dẫn trỏ webhook ở dashboard SePay.
3. **Nối Zalo:** owner **tự tạo bot** trong Zalo Bot Manager (tài khoản của họ, free ≤3 bot) → **dán Bot Token** → hệ thống set webhook `/webhook/zalo/<token>` (bot-per-club).
4. **Link Facebook Messenger:** **FB Login** + **chọn Page** của CLB → hệ thống gắn `messenger_pages`, route theo `page_id`; kênh chạy dưới **App Review** của platform (DD-33 🟡, phase-1).
5. **Cấu hình:** **môn mặc định** (badminton/pickleball/…), ngôn ngữ, giá mặc định **+ tùy chọn giá theo giới tính (nam/nữ)** (DD-39 ✅, cột `person.gender` chờ migration), `roster on/off`, `auto-announce on/off`, **chính sách publish (private/public mặc định) + join (open/approval)**.
6. **Checklist** trên dashboard: ☐ nối bank ☐ link Zalo ☐ link Messenger ☐ tạo & (tùy chọn) publish kèo đầu.

> **DoD:** người lạ đi hết flow (đăng nhập Google, nối SePay, link Zalo + Messenger) tới khi tạo & publish được kèo đầu, không đụng env file.

---

## FLOW 2: TẠO & ĐĂNG KÈO — Host (chat **hoặc** web) *(P2 / P4)*

1. Host `/newsession` (Zalo/Messenger DM) **hoặc** tạo trên **web** (hoặc cron định kỳ) → set **môn**, ngày/giờ, **khu vực/venue**, giá (một mức hoặc **giá nam / giá nữ** — DD-39 ✅), **slot tối đa**, **trình độ**, **visibility (private/public)**, **join policy (open/approval)**.
2. Nếu `auto-announce=on` + có kênh → bot **tự đăng** message join vào Zalo/Messenger; hoặc `/announce <id>` đăng tay.
3. Nếu `visibility=public` → kèo được **đẩy lên marketplace** (public projection field-whitelist — FLOW 12).
4. Message hiển thị roster; lưu `announce` ref (Zalo/Messenger) để cập nhật live. **Mọi thay đổi sync sang web + marketplace + kênh** (FLOW 14).
5. Host `/close` (hoặc trên web), xem danh sách + trạng thái trả; kèo đóng → **hạ khỏi marketplace**.

---

## FLOW 3: PLAYER JOIN — Facebook Messenger *(base P2.5 · player workflow P4.5)*

1. Player nhắn **Page CLB** / dùng **persistent menu** → bot liệt kê buổi đang mở bằng **quick-reply**.
2. **Validate:** session `open` + `page_id` khớp `messenger_pages` của tenant + `session.tenant_id == tenant`.
3. Resolve identity (FLOW 5) → tạo/`addMemberToSession` (idempotent theo membership).
4. Trả **xác nhận qua Messenger** (trong **cửa sổ 24h**) + **nội dung CK name-based / pay_code+QR**; **roster sync lên web** (FLOW 14).
5. Rời: quick-reply **[Rời]** → bỏ nếu chưa trả; đã trả → chặn + báo.

> Messenger dùng standard messaging trong **cửa sổ 24h**; ngoài cửa sổ chỉ gửi khi có cơ chế Meta đủ điều kiện/được phê duyệt, còn MVP dồn nhắc/xác nhận qua **web + Zalo**. Không port tap-nút group Telegram. Route theo `page_id`, **không** từ nội dung tin.

---

## FLOW 4: PLAYER JOIN — Zalo (DM number-reply) *(P4.7)*

1. Player DM bot Zalo của club `/join` → bot liệt kê buổi đang mở, đánh số.
2. Player **trả lời số** (vd `1`).
3. Resolve identity (FLOW 5) → `addMemberToSession` → trả xác nhận + **nội dung CK name-based** (P1–P3) / pay_code+QR (P4).
4. Lệnh phụ: `/me`, `/name <tên>`, `/leave`, `/pay`, `/who`.

> Zalo **không inline button** → number-reply; bot-per-club nên DM tự ghim tenant (không cần picker). GROUP Zalo còn Beta → player-flow bám **DM number-reply**.

---

## FLOW 5: IDENTITY — CLAIM & MERGE *(P3.5)*

**Khi player xuất hiện lần đầu ở 1 CLB:**

1. `(platform, platformUserId)` → `ChannelIdentity` → `Person` (global). `platform ∈ {zalo, messenger}` (kênh chat), auth account ∈ `{google, email, facebook, zalo}`. Chưa có → tạo Person.
2. Tìm `Membership(Person, Tenant)`:
   - Chưa có → matcher tên scoped-tenant:
     - Không khớp → **tạo membership mới** (an toàn, auto).
     - Khớp membership **chưa có tiền** → claim auto.
     - ⚠️ Khớp membership **đã có nợ/payment** → **KHÔNG auto theo tên** → cần khoá mạnh (owner xác nhận / CK khớp / mã link). (AUDIT C2)
     - Mơ hồ → hỏi chọn (Zalo số / Messenger quick-reply).

**Merge xuyên kênh (Facebook Messenger ⇄ Zalo cùng người; link vào Person đăng nhập Google):**

1. **`/link`** ở bot A → cấp **mã OTP** (entropy cao, TTL ngắn, single-use, rate-limit) → player gửi mã ở bot B → gắn ChannelIdentity B vào Person A + **xác nhận tường minh** + audit. (AUDIT C3)
2. **SĐT verified** (share-contact Zalo / Messenger, hoặc email verified qua Google) → auto-merge.
3. STK/tên → **chỉ gợi ý, owner duyệt** (không auto). (AUDIT B4)

> Merge mà 2 Person đều có membership cùng tenant → **reconcile gộp 1 membership** (cộng nợ, 1 id) + cờ nghi-trùng. (AUDIT C4/C5)

---

## FLOW 6: ĐÁNH DẤU TIỀN — mark-paid thủ công + đối soát CK *(P2 / P3)*

**Mark-paid thủ công (mọi tier — DD-40):**
1. Host mở danh sách roster (web/bot) → chọn **1 hoặc nhiều player (tap/multi-select)** → đánh dấu **đã trả bằng tiền mặt** hoặc **đã trả bằng CK**.
2. Áp **preview + confirm** (DD-25, human-initiated money mutation) → INSERT `payment_allocations` (tiền mặt → `source='cash'`; CK khớp một `bank_transaction` → `source='manual'`) + cập nhật `charges`, có audit, **idempotent** → trigger FLOW 8 (xác nhận). *(Không có bảng `payment`; enum `source` không có `bank_transfer`; CK host tự xác nhận chưa có `bank_transaction` = impl còn mở.)*

**Đối soát CK tự động (`host_pro` — P3):**
3. CK về → **webhook SePay** `/webhook/sepay/:token` → route đúng tenant theo `webhookToken` + verify số TK.
4. Trong **một DB transaction**: insert `bank_transactions` idempotent + enqueue reconcile job/outbox; commit thành công rồi mới ACK provider.
5. Matching engine (tenant-scoped): ưu tiên `pay_code` (nếu có) → fallback **tên + số tiền + ngày**.
6. Phân bổ CK vào `charges` qua `payment_allocations`; 2 buổi đồng giá cùng ngày → **FIFO**; tổng allocation không vượt CK và chỉ mark paid khi charge được phủ đủ.
7. Match được → cập nhật charge/debt → trigger FLOW 8 (xác nhận). Còn dư/không khớp → `/unmatched` (FLOW 9); worker retry an toàn sau crash.

> `charge` mỗi lượt chơi suy giá theo **giới tính member** nếu kèo đặt giá nam/nữ (DD-39 ✅, cột `person.gender` chờ migration). Auto-reconcile CK là tính năng **`host_pro`**; free tier dùng **mark-paid thủ công**.

---

## FLOW 7: NHẮC NỢ *(P2 manual → P3 auto)*

- **Manual (mọi tier):** owner `/remind` → nhắc người chưa trả; rate-limit.
- **Auto (`host_pro`):** cron quét người chưa trả quá **ngưỡng cấu hình (mặc định 2h → 24h → …)** → gửi qua **web push + Zalo DM** (kênh chính, theo `ChannelReachability.canDm` đúng tenant); **Messenger chỉ best-effort trong cửa sổ standard 24h**, ngoài cửa sổ phụ thuộc cơ chế Meta đủ điều kiện/được phê duyệt → set `last_reminded_at` chống spam; quiet-hours; max N.

> `canDm` **theo (person × tenant × platform)** — Zalo/Messenger bot-per-club nên nhắn được hay không phụ thuộc đúng bot/Page club đó (AUDIT C1). Không còn group-mention Telegram.

---

## FLOW 8: XÁC NHẬN ĐÃ TRẢ *(P4.5 / P4.7)*

Sau **mọi** điểm markPaid (thủ công tiền mặt/CK + auto-match CK) → `notifyPlayersPaid(tenant, paidMembershipIds[])`:
- Chọn kênh theo `ChannelReachability` của tenant: **web push + Zalo DM** (kênh chính), **Messenger best-effort trong cửa sổ 24h**.
- Best-effort try/catch, **không chặn dòng tiền**.

---

## FLOW 9: /UNMATCHED — Owner gán tay *(P3)*

1. CK không khớp → vào danh sách `/unmatched`.
2. Owner xem → gán cho đúng player → markPaid → FLOW 8.
3. Retry cron định kỳ thử khớp lại trước khi cần tay.

---

## FLOW 10: PLAYER VIEW — `/myclubs` + Web *(P4.6)*

1. `/myclubs` (bot Zalo/Messenger) hoặc web (auth = phiên Google/email verify) → liệt kê **các CLB của Person + nợ/trạng thái từng CLB**.
2. **Chỉ dữ liệu của chính họ** — đường query person-authorized, KHÔNG qua tenant-RLS thường (AUDIT C6).
3. Web mở từ Zalo/Messenger cần **magic-link do bot phát** để auth (kênh chat không có login widget web).

---

## FLOW 11: BILLING — host subscription tiers *(P5)*

1. Tạo tenant: `free` → `active` ngay, không invoice; plan trả phí `host_pro` → `trialing` (đề xuất 14 ngày).
2. Owner chọn plan: `free` (0đ — web + **kết nối Zalo + Messenger** + **mark-paid thủ công (tiền mặt/CK)** + nhắc thủ công + **chat cơ bản in-app**) hoặc `host_pro` (250k — thêm **đối soát CK tự động** + báo thu + **nhắc nợ tự động** + Trợ lý AI + CRM). Tính năng do capability flags quyết định (DD-29, DD-40 giải nuance).
3. Với paid plan, owner CK đúng số tiền vào **tài khoản platform**, nội dung mang `invoiceCode` → webhook match → đẩy `currentPeriodEnd +1 tháng`, `status=active`.
4. Hết hạn không gia hạn → `past_due` (nhắc web/email) → sau X ngày → `suspended`.
5. **Suspended:** chặn lệnh nhưng **vẫn nhận & lưu CK player** (không mất giao dịch khi quay lại).
6. Free plan không cần payment để active nhưng bị giới hạn tính năng theo capability flags; MVP có thể **manual-activate** paid plan trước khi tự động hoá match.

---

## FLOW 12: DISCOVERY — Tìm kèo (marketplace) *(P4.3)*

1. Player mở **web** (`/discover`) hoặc bot (`/discover` Zalo/Messenger DM) — **không cần là member CLB nào**.
2. Lọc: **môn** (cầu lông/pickleball/…), **khu vực**, **ngày/giờ**, **trình độ**, **giá tối đa**, **còn slot**.
3. Hệ thống đọc **`public_sessions`** (read model cross-tenant, KHÔNG RLS, **field whitelist**) → trả danh sách: môn, giờ, **khu vực** (không địa chỉ chi tiết), giá, slot trống, tên host/CLB.
4. Xem chi tiết kèo công khai — **KHÔNG** roster người khác, **KHÔNG** STK/PII/giới tính, **KHÔNG** ai trả/chưa.
5. Bấm **Join** → FLOW 13.

> ⚠️ **Bất biến public (AUDIT §C8):** marketplace chỉ chứa field whitelist; tiền/PII/giới tính/roster không bao giờ lộ. `venue` chi tiết chỉ hiện sau khi join/được duyệt (OD-6). Rate-limit + phân trang chống scrape.

---

## FLOW 13: JOIN CROSS-CLUB — từ marketplace *(P4.3)*

1. Player bấm Join 1 kèo public → route `session_id → tenant` (route join, không lộ tenant ra ngoài).
2. Resolve identity (FLOW 5): `(platform/web-session) → Person`. Chưa là member CLB → tạo **membership guest**.
3. Theo `join_policy` của kèo:
   - **`open`** → final join dưới session lock: còn slot → active player + charge + venue/nội dung CK; full → waitlisted + position, **không charge/venue/QR**.
   - **`approval`** → tạo `join_requests(pending)` (không membership/player/charge/capacity) → host duyệt; còn slot → active+charge+venue, full → approved+waitlisted/no-charge/no-venue; từ chối/hết hạn → báo.
4. Active outcome: kèo + nợ xuất hiện trong **player view** (FLOW 10). Waitlisted outcome: hiện queue position, chưa có nợ/venue; promotion mới tạo charge atomically. Mọi surface sync (FLOW 14).

> Slug/elink chỉ ghim context, **không** tự cấp quyền (AUDIT B2). Join có tiền/định danh nhạy cảm vẫn theo khoá mạnh (AUDIT C2).

---

## FLOW 14: SYNC ĐA SURFACE — web ⇄ kênh *(P4)*

**Nguyên tắc:** PostgreSQL + domain model = **canonical store**; web và các kênh là surface. Một action ở bất kỳ đâu → nhất quán mọi nơi.

1. Action ở 1 surface (host tạo kèo trên **web**; player **join trên Zalo/Messenger**; host sửa roster trên **web/bot**) → chuẩn hoá thành **command** (có `commandId`).
2. Command áp vào canonical store (tenantRepo + RLS) → ghi kèm **outbox event** (cùng transaction).
3. **Dispatcher** đẩy event → **projectors** fan-out:
   - Zalo: DM/message theo `ChannelReachability` đúng tenant.
   - Messenger: message trong **cửa sổ 24h** đúng Page tenant (ngoài 24h dồn web + Zalo).
   - Web: **push SSE** (`tenant:<id>` cho host, `person:<id>` cho player).
   - Marketplace: upsert/xoá `public_sessions` nếu kèo public.
4. **Idempotent** (`commandId` + `event.id`); surface lệch (msg cũ/SSE rớt) → **re-project** dựng lại từ canonical.

> Surface **không bao giờ** giữ sự thật → không có conflict multi-master. Độ trễ mục tiêu p95 ≤ 3 giây, p99 ≤ 10 giây. Xác nhận đã trả (FLOW 8) là projection của event `payment.settled`.

---

## FLOW 15: CHAT IN-APP + CÀI ĐẶT HỒ SƠ — *(P4, DD-38 ✅ / DD-39 ✅ scope-committed phase-1)*

> **DD-38/DD-39 scope-committed phase-1** (đã chốt hướng). **Schema chưa vào canonical** `packages/db/schema.ts` — `chat_*` + cột `person.gender/dob/username/language` là **migration còn chờ** (nguồn authoritative vẫn là schema.ts + migrations). Nguồn: `../standards/decisions.md` (DD-38 chat, DD-39 giá theo giới tính) + doc Draft `../features/feature_inapp_chat.md`, `../features/feature_user_settings.md`.

- **Chat in-app (DD-38 ✅):** chat **toàn CLB** (member trong tenant, RLS) + chat **riêng 1-1** (person ↔ person, person-self); **chỉ sống trong Plexco**, **không bridge** ra group Zalo/Messenger; realtime SSE (DD-07), chống spam.
- **Cài đặt hồ sơ + giá theo giới tính (DD-39 ✅):** người dùng đặt **giới tính / ngày sinh / tên / username / ngôn ngữ**; host đặt **giá nam/nữ** cho kèo, hệ suy `charge` theo `person.gender`. Giới tính/ngày sinh là **PII có consent, không lộ public**.

---

# 4. EDGE CASES

## 4.1 Payment

| # | Edge case | Hành vi hệ thống | Canonical phase |
|---|---|---|---|
| 1 | **2 buổi đồng giá cùng ngày, cùng player** | Biết ai, **không pin được buổi** → FIFO allocation (net đúng); cần chính xác → VietQR-per-session | P3 |
| 2 | **Trả hộ / 1 CK cho nhiều người** | Số tiền nhập nhằng → `/unmatched`; owner tạo nhiều `payment_allocations`, tổng không vượt CK; **không tự đoán** | P3 |
| 3 | **CK sai/thiếu nội dung** | Lưu unmatched + retry cron 1h + fallback owner (mark-paid thủ công) | P3 |
| 4 | **Trả dư / trả thiếu** | Allocation phần đã xác định; charge chỉ paid khi phủ đủ; số dư chưa phân bổ được flag cho owner | P3 |
| 5 | **Webhook trùng (cùng external_id)** | Idempotent `UNIQUE(tenant_id, provider, external_id)` + `ON CONFLICT DO NOTHING` | P3 |
| 6 | **CK thiếu id từ provider** | Sinh id tổng hợp `sha256(provider\|acct\|amount\|date\|content)` → vẫn idempotent + unmatched | P3 |
| 7 | **Hủy buổi khi có CK** | Platform không giữ tiền → owner hoàn tiền tay; log refund | P2 |
| 7b | **Mark-paid thủ công trùng/nhầm** | markPaid idempotent theo (charge, membership); sửa bằng reversal có audit, không xoá allocation gốc (DD-40) | P2 |

## 4.2 Identity & Routing

| # | Edge case | Hành vi | Canonical phase |
|---|---|---|---|
| 8 | **Player thuộc >1 CLB (web session / DM)** | Zalo bot-per-club & Messenger Page-per-club **tự ghim tenant**; trên web dùng picker tenant; ∈1 club → auto | P4.5 |
| 9 | **Membership trùng do race (Zalo join trước khi link Messenger)** | cờ nghi-trùng + tool owner merge (reconcile gộp nợ) | P3.5 |
| 10 | **Claim membership có tiền theo tên** | Cấm auto → yêu cầu owner/CK/mã link | P3.5 |
| 11 | **Mã link bị đoán/brute-force** | OTP entropy cao + TTL ngắn + rate-limit + single-use + xác nhận | P3.5 |
| 12 | **Context trỏ club player không còn là member** | fail-closed → bỏ context → picker | P4.5 |
| 13 | **Zalo `message.unsupported.received`** (user nhóm bảo vệ) | không nhận nội dung → fallback owner xử tay | P4.7 |

## 4.3 Tenant / Bảo mật

| # | Edge case | Hành vi | Canonical phase |
|---|---|---|---|
| 14 | **Webhook sai token/secret/số TK** | 401/409 từ chối; vẫn lưu raw payload, không log secret | P3 |
| 15 | **Zalo bot token / Page token bị lộ** | `getWebhookInfo`-drift detection → alert + auto-reset; kill-switch reset token (AUDIT §B2) | P4.7 |
| 16 | **Lệnh admin gửi trong kênh bởi non-admin** | Phân quyền theo `from.id` (`TenantAdmin`), không theo chat | P2 |
| 17 | **Tenant suspended** | Chặn lệnh nhưng vẫn nhận & lưu CK player | P5 |
| 18 | **Truy vấn quên scope tenant** | RLS fail-closed → 0 dòng (không lộ) | P1 |

## 4.4 Auth & Hạ tầng

| # | Edge case | Hành vi | Canonical phase |
|---|---|---|---|
| 19 | **Cron nhắc 1k CLB cùng giờ** | throttler + rải giờ (jitter) + hàng đợi | P3 |
| 20 | **Phiên Google/email hết hạn / magic-link Zalo-Messenger hết hạn** | yêu cầu đăng nhập lại | P4 |
| 21 | **DM player chưa từng nhắn bot / ngoài cửa sổ 24h Messenger** | `canDm=false` hoặc quá 24h → fallback **web + Zalo**; vào bản tổng hợp owner | P4.5/4.7 |

## 4.5 Discovery / Marketplace / Sync

| # | Edge case | Hành vi | Canonical phase |
|---|---|---|---|
| 22 | **Kèo public bị sửa/đóng/huỷ** | Projector upsert/xoá `public_sessions`; đóng/quá giờ → tự hạ khỏi marketplace | P4.3 |
| 23 | **Join khi vừa hết slot (race)** | Session lock → một active+charge, người còn lại waitlisted/positive-position/no-charge; không over-fill | P4.3 |
| 24 | **Approval-mode: host không duyệt** | `join_requests` hết hạn → tự huỷ + báo player; player có thể tìm kèo khác | P4.3 |
| 25 | **Scrape/enumerate marketplace** | Rate-limit + phân trang + chỉ field whitelist; không trả tiền/PII/giới tính dù lặp request | P4.3 |
| 26 | **Vị trí riêng tư** | Public chỉ `area`; `venue` chi tiết lộ sau khi join/được duyệt (OD-6) | P4.3 |
| 27 | **Sync: 2 surface sửa gần như đồng thời** | Command serialize ở canonical store (transaction) per-tenant/session; event theo thứ tự → không lệch | P4 |
| 28 | **Surface state cũ** (msg roster lỗi thời / SSE rớt) | Re-project từ canonical (edit lại msg / refresh SSE); surface không giữ sự thật | P4 |
| 29 | **Command lặp** (retry kênh) | Idempotent theo `commandId` → `STALE_COMMAND` bỏ qua, không double | P4 |
| 30 | **Kèo môn lạ / chưa có trong `sports`** | Chỉ chọn môn từ danh sách `sports` active; không tự do nhập | P1 |

---

# END OF DOCUMENT
