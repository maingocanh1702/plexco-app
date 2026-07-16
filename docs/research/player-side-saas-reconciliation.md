# Phụ lục — Reconcile Player-side ↔ multi-tenant (Plexco)

> ⚠️ **Pre-pivot reference (superseded by DD-37, 2026-07-15):** doc này mô tả kênh **Telegram + Zalo, Messenger post-MVP** — **KHÔNG còn là canonical**. Authority hiện hành: kênh phase-1 = **Zalo + Facebook Messenger + web** (Telegram loại; Messenger **P2.5 phase-1**); auth = Google/email (DD-13); pricing = DD-29. Xem `../standards/decisions.md` DD-37/13/29. **Phần nền multi-tenant/identity/RLS/public-layer bên dưới vẫn hợp lệ làm reference.**
>
> ⚠️ **Identity note (DD-50, 2026-07-16):** mọi trust ladder SĐT/OTP/owner-approval bên dưới là lịch sử. Phase-1 không thu phone; debt-bearing claim chỉ dùng verified account email hoặc transactional one-time `link_code`. Owner/name/CK chỉ là review evidence.

> Bản nháp để review. **Chưa code.** Doc này **gộp toàn bộ tầng player-side (Telegram + Zalo)** + tầng identity, đặt chồng lên `docs/saas-implementation-plan.md` (nền multi-tenant). Phần nền (Postgres + RLS + repo choke point + routing owner) **giữ nguyên**. Kênh Messenger (post-MVP): `messenger-channel-design.md`.
>
> **Reposition v2 (18/06/2026):** Plexco là **platform đa môn 2 phía**. Tầng identity ở đây là **nền cho 2 thứ mới**: (1) **player view person-self** (§3b) = tầng hiển thị thứ 3; (2) **join cross-club từ marketplace** (TDD §3.9) — reuse đúng cơ chế *claim/membership* ở §3 (người lạ join kèo public → tạo **membership guest**; có tiền/định danh nhạy cảm vẫn cần khoá mạnh C2). **Public discovery layer** (đọc kèo cross-tenant, field-whitelist) **không** chứa identity/tiền → nằm ngoài phạm vi doc này (xem TDD §3.9 + AUDIT C8). Reachability bổ sung surface **web (SSE)** ngoài TG/Zalo/Msgr.

## 0. Quyết định đã chốt (định hình toàn phụ lục)

| # | Quyết định | Hệ quả |
|---|---|---|
| 1 | **Player dùng cả group VÀ DM** | Cả hai kênh phải resolve được tenant; DM cần lớp ghim-club (§2) |
| 2 | **Có Zalo** (không Telegram-only) | Zalo dùng **Zalo Bot Platform** (bot-token, **KHÔNG cần OA**) — **bot-token per-club** vì Zalo không có group/deep-link để ghim tenant. Telegram vẫn 1 bot chung (§4) |
| 3 | **Có global Person** | Identity xuyên club + xuyên platform: `Person` / `ChannelIdentity` global; `Membership` per-tenant (§1). Mở `/myclubs` player view (§3b) |
| 4 | **Zalo bot-token per-club, tenant BYO** | Tối ưu hơn shared: 1 bot/club tự ghim tenant, DM không mơ hồ. Free = 3 bot/tài khoản → owner tự tạo bot dưới tài khoản mình ⇒ **free-at-scale** (§4) |

Vì có global Person, **không còn** giả định "members per-tenant rời rạc" của bản nháp trước — `members` cũ tách thành **directory global (Person + ChannelIdentity)** và **Membership tenant-scoped**.

## 1. Identity model — tách "ai" khỏi "club nào"

```ts
// ── GLOBAL directory: chỉ định danh, KHÔNG chứa tiền/nợ, KHÔNG bị RLS ──
interface Person {              // 1 con người thật, xuyên club + xuyên platform
  id: string;                   // uuid
  displayName: string | null;
  phone: string | null;         // optional — khoá merge cross-platform mạnh nhất
  createdAt: string;
}

interface ChannelIdentity {     // 1 tài khoản nền tảng = thuộc đúng 1 Person
  id: string;
  personId: string;
  platform: "telegram" | "zalo";
  platformUserId: string;       // tg_user_id | zalo_user_id
  username: string | null;      // @handle TG (chỉ để mention đẹp)
  // UNIQUE(platform, platform_user_id)  ← global unique: 1 acc TG/Zalo → 1 Person
  // KHÔNG có canDm ở đây — xem ChannelReachability (AUDIT C1)
}

// ── TENANT-scoped: RLS áp dụng, nợ/lịch sử/pay_code nằm ở đây ──
interface Membership {          // Person ⇄ Tenant — "Minh trong club A"
  id: string;                   // == member_id cũ; players.member_id trỏ vào đây
  tenantId: string;
  personId: string;
  displayName: string;          // tên trong club này (có thể khác club khác)
  payCode: string | null;       // P4, UNIQUE(tenant_id, pay_code)
  // UNIQUE(tenant_id, person_id)
}

// ── Reachability per (person × tenant × platform) — KHÔNG global (AUDIT C1) ──
// Vì Zalo bot-per-club: nhắn bot club A ⇏ club B DM được → canDm phải theo tenant/bot.
interface ChannelReachability {
  personId: string; tenantId: string; platform: "telegram" | "zalo";
  canDm: boolean; lastInboundAt: string;   // UNIQUE(person_id, tenant_id, platform)
}
```

**Đổi so với plan player gốc:** `members.tg_user_id` / `zalo_user_id` / `tg_username` **chuyển lên `ChannelIdentity` global**; `tg_can_dm` cũ → **`ChannelReachability` per-tenant** (KHÔNG global — C1); `members` cũ → `Membership` (thêm `person_id`). `players`, `payments`, `aliases`... vẫn trỏ `membership.id` như `member_id` cũ — phần đường tiền không đổi. `notifyPlayersPaid`/reminder đọc `ChannelReachability` **theo đúng tenant** để chọn DM/mention.

**Pipeline resolve mọi inbound event:**

```
event
  → (platform, platformUserId)  → ChannelIdentity → Person      [GLOBAL]
  → channel context             → Tenant                        [theo kênh, §2]
  → Membership = (Person ∩ Tenant)  qua tenantRepo              [TENANT-scoped, RLS]
```

> **An toàn RLS:** `Person`/`ChannelIdentity` để **global, ngoài RLS** — chúng chỉ là bảng tra cứu, **không** chứa tiền. Mọi nợ/payment/session vẫn ở bảng tenant-scoped + RLS (saas §4). Bất biến "không rò rỉ tiền cross-tenant" giữ nguyên. Resolve `Person → Membership` vẫn đi qua `tenantRepo(tenant.id)` nên Membership cũng bị RLS.
>
> ⚠️ **Path privileged (AUDIT C4/C7):** thao tác **merge Person** và **player-view** chạm **nhiều tenant** → chạy NGOÀI RLS per-tenant → phải là **service path có kiểm soát + audit log**, KHÔNG để handler thường gọi. Merge chỉ di chuyển *liên kết danh tính*, **không** di chuyển payment giữa tenant.

## 2. Routing player — kênh ghim club; picker chỉ khi thật sự mơ hồ (trả lời #4)

"Club nào" hầu như **luôn được chính kênh ghim sẵn** → chỉ TG-DM mới cần đoán.

| Kênh | Ghim tenant bằng | Mơ hồ? |
|---|---|---|
| **TG group** | `chat_id` → `TelegramLink(group)` | ❌ không — tap-join/lệnh trong group là rõ |
| **Zalo (bot DM)** | bot-token per-club → **bot nào nhận = club đó** (§4) | ❌ không — **bot tự ghim club** |
| **TG private DM** | — (1 bot chung) | ⚠️ **chỉ chỗ này** mơ hồ khi Person ∈ >1 TG-club |

> Zalo Bot: **không inline button/callback**, GROUP mới **Beta** (§4) → MVP bám **DM 1-1**. Nên dù Minh ở 3 group Zalo (chỗ người chat), cái quyết định là **anh ấy DM bot nào** — mỗi club 1 bot → tự rõ, **không cần picker**.

**Xử TG-DM mơ hồ — thứ tự ưu tiên (đề xuất ✅):**
1. **Deep-link** `t.me/Bot?start=club_<slug>` (mỗi club đăng nút này trong group TG) → DM mở ra đã ghim club. ← tốt nhất, 0 ma sát
2. **Sticky** `PlayerChatContext` (club player tap/mở gần nhất) → đỡ hỏi lại lần sau
3. **Picker** inline-button liệt kê các club của Person → fallback khi >1 TG-club và chưa có context. Person ∈ đúng 1 TG-club → **auto, không hỏi**

```ts
interface PlayerChatContext {     // "club TG player đang mở gần nhất" — đổi được, KHÔNG phải TelegramLink
  telegramUserId: string;
  tenantId: string;
  updatedAt: string;
}
```

So với phương án khác: *sticky-only* sai khi Minh nhảy club liên tục; *luôn picker* phiền vô ích vì 90% kênh đã ghim. Ghim-theo-kênh + picker-khi-cần = tối ưu: chỉ hỏi đúng lúc thật sự không biết.

> ⚠️ **Sticky phải fail-closed (AUDIT B1):** lúc dùng, **validate `tenantId` ∈ membership của Person**; không còn → bỏ context, hỏi picker. Context KHÔNG bao giờ tự quyết tenant mà không qua giao `(Person ∩ Tenant)`.
> ⚠️ **Deep-link `club_<slug>` = chỉ ghim DM context, KHÔNG join (AUDIT B2):** join vẫn qua tap-in-group / `/join` + linking (+ duyệt nếu club kín). Slug đoán được → **không cấp quyền gì** qua slug; cần cấp quyền thì dùng **token opaque**.

### Ca mẫu — Minh: 3 group Zalo + 2 group TG, 1 TG + 1 Zalo là CÙNG 1 club

- Mỗi TG group → tenant (group link). Mỗi club Zalo → 1 bot-token → tenant. Tất cả ghim rõ trừ TG-DM của Minh.
- Club "TG + Zalo cùng nhau": có **cả** `TelegramLink(group)` **lẫn** `ZaloBot(token)`. `tg_user_id` và `zalo bot chat_id` của Minh đều → **cùng `Person`** → **cùng 1 `Membership`** trong club đó → **nợ gộp chung, không double**. ← chính là lý do cần global Person (#3).
- Minh DM bot TG mà chưa ghim → picker hiện đúng danh sách club Minh tham gia (suy từ `Person → Membership[]`).

## 3. Identity linking & merge (mọi nguồn + cross-platform, có global Person)

Linking xảy ra ở 2 mức:

**A. ChannelIdentity → Person (global, deterministic):** `tg_user_id`/`zalo_user_id` UNIQUE global → tra thẳng ra Person. Lần đầu thấy 1 acc → hoặc gắn vào Person sẵn có (qua merge B), hoặc tạo Person mới.

**B. Claim Membership trong 1 tenant — TÁCH "tạo mới" khỏi "claim cái có tiền" (AUDIT C2):** khi Person lần đầu xuất hiện ở club X, matcher tên chạy **scoped trong tenant X**, nhưng hành vi khác nhau theo việc membership ứng viên **có dính tiền hay không**:
- **Không khớp** → tạo Membership **mới** (chưa có nợ/payment) → **an toàn, auto**.
- Khớp Membership **chưa có payment/nợ** (vd import ảnh/sheet, chưa CK) → claim auto được.
- ⚠️ Khớp Membership **đã có payment/nợ** → **KHÔNG auto theo tên** (tên VN trùng nhiều; player tự đặt display name được → giả mạo). Cần ≥1 **khoá mạnh**: owner xác nhận, **hoặc** CK khớp từ STK của chính họ, **hoặc** mã link (C). Name-match chỉ **đề xuất ứng viên**.
- Mơ hồ (nhiều ứng viên) → hỏi (TG inline-button / Zalo number-reply) hoặc owner duyệt.

**C. Merge cross-platform (nâng Person):** Minh join club X bằng TG (Person P1), sau đó join **cùng club X** bằng Zalo. Cần gắn cả 2 kênh vào P1. Thứ tự khoá merge từ chắc → yếu (#1):

1. **Mã link một lần (round-trip) — đề xuất chính, deterministic, KHÔNG cần PII.** Bot A: Minh gõ `/link` → bot cấp mã + hướng dẫn "gửi mã này cho bot Zalo của club". Minh gửi mã ở bot B → tra mã → **gắn ChannelIdentity B vào đúng Person của A**.
   > ⚠️ **Mã = OTP, không phải code thường (AUDIT C3):** entropy cao, **single-use**, **TTL ngắn (vài phút)**, **rate-limit**, sinh on-demand, chỉ hiện cho chủ A. B gắn xong phải **xác nhận tường minh** ("Liên kết tài khoản này với <tên/club>?"). **Audit log** mọi merge. (Mã yếu = brute-force chiếm Person.)
2. **SĐT đã VERIFY (qua share-contact) — khoá auto-merge ma-sát-thấp.** Lấy số **đã được nền tảng xác thực** mà KHÔNG cần SMS OTP: Telegram nút **`request_contact`**, Zalo **share contact**. SĐT ~1:1 ở VN → **đủ mạnh để auto-merge xuyên platform** (kèm audit). SĐT verified + mã link bổ trợ nhau (số = gần tự động, mã link = đường không-PII).
   > 🔑 **Quy tắc lõi (AUDIT C2):** chỉ **verified** mới là khoá. **SĐT/email tự gõ = vô giá trị + nguy hiểm** (mạo danh) → chỉ là gợi ý, owner-mediated.
3. **Email đã VERIFY** → khoá mạnh nhưng thêm ma sát (phải dựng OTP email). Chỉ dùng nếu **web signup đã thu + verify sẵn**; đừng làm flow riêng chỉ để merge.
4. **Số tài khoản ngân hàng** → ⚠️ **chỉ owner-mediated, KHÔNG auto-merge xuyên club (AUDIT B4):** STK trả-hộ là nhiều–nhiều; dùng làm khoá toàn hệ thống = dựng đồ thị `account→person` xuyên tenant (privacy). Giữ **matching STK trong-tenant**; merge xuyên club để **owner duyệt**.
5. **Fuzzy tên trong tenant** → chỉ **sinh ứng viên** + hỏi xác nhận. **KHÔNG bao giờ auto-merge chỉ theo tên.**
6. **Admin merge tay** trong dashboard → fallback cuối, luôn cần.

> **PII (SĐT/email):** mã hoá at-rest, xin consent, **không log / không nhét URL**, có retention + quyền xoá. SĐT verified được auto-merge xuyên tenant (+audit); unverified thì chỉ gợi ý.

> Matcher tên luôn **scoped tenant** → không gộp nhầm "Minh club A" với "Minh club B". Liên kết xuyên club chỉ qua `ChannelIdentity` global (cùng acc) hoặc mã link — **không bao giờ** qua trùng tên đơn thuần.

**D. Reconcile membership trùng khi merge (AUDIT C4/C5).** Nếu Minh join 1 club bằng Zalo (tạo Person P2) **trước** khi link với Person TG (P1) → tenant có **2 membership** (P1, P2) cho 1 người → nợ/CK **tách hai sổ**. Khi merge P1+P2:
- Nếu cả hai có membership **cùng 1 tenant** → **gộp 2 membership thành 1**: cộng dồn nợ/lịch sử, giữ 1 `id`, trỏ lại toàn bộ `players`/`payments`, rồi mới merge Person. Phải có path xử lý — **không** để DB ném `UNIQUE(tenant_id, person_id)`.
- **Phòng ngừa ở join:** cố tìm Person sẵn có mạnh nhất (owner pre-link / phone) trước khi tạo mới; gắn **cờ "nghi trùng"** khi 2 membership cùng tenant + tên giống + chưa link → nhắc owner merge. Cần **tool owner merge 2 membership** trong dashboard.

## 3b. Player self-service view (#2) — `/myclubs` + web

Global Person mở đúng đường "1 player thấy mọi club của mình". Làm cả 2 mặt:
- **Bot:** lệnh `/myclubs` (TG/Zalo) → liệt kê các club Person tham gia + nợ/trạng thái từng club.
- **Web:** trang player (đăng nhập bằng chính kênh đã link) → bảng club + lịch sử CK + nút `/pay`.

> ⚠️ **Đây là read CROSS-tenant scoped-to-self — ngoại lệ có chủ đích của RLS.** Truy vấn thường đi qua `tenantRepo(1 tenant)` + RLS khoá đúng tenant đó; view này cần gộp **nhiều** tenant của 1 Person. Phải đi **đường query person-authorized riêng**: chỉ trả `Membership WHERE person_id = <person đã xác thực>` (chỉ field player được thấy: tên club, nợ của chính mình, ✅/❌ — KHÔNG roster/tiền người khác). Đường này **không** dùng `SET LOCAL app.tenant_id`; scope bằng `person_id` đã auth + audit log. Tách hẳn khỏi repo tenant để không phá bất biến "tiền không rò rỉ cross-tenant".
>
> ⚠️ **Auth (AUDIT C6):** `person_id` **bắt buộc** suy từ **phiên login đã verify** (TG Login Widget → telegramUserId → ChannelIdentity → Person), **KHÔNG** từ query param/client (nếu không → ai cũng xem nợ người khác). **Zalo chưa có login widget** → cần **magic-link do bot Zalo phát** để auth web. Field trả về theo whitelist.

## 3c. Khớp CK ↔ session: ambiguity 2 buổi identical (FIFO + VietQR-per-session)

Matcher hiện tại detect bằng **tên + số tiền + ngày** rồi gạch nợ. Ca khó: 1 player join **2 session cùng ngày, cùng giá (80K), cùng host** → cả 3 tín hiệu **trùng** → biết **AI** ck nhưng **không** pin được **buổi nào** từ CK. Đây là ambiguity **cố hữu**, không phải lỗi.

**Quy tắc chốt:**
- **Mặc định = FIFO settle (fungible).** 2 nợ giá y hệt → hoán đổi được. CK 80K → giảm tổng nợ Minh 160K→80K, đánh dấu **buổi tạo trước** (theo `session_id`/`created_at`) đã trả. Buổi nào hiện "đã trả" là tuỳ tiện nhưng **net đúng** (Minh còn nợ đúng 1×80K). Đủ cho mục đích host "ai còn nợ".
- **Chặn over-mark (BL-2 giữ nguyên):** chỉ gạch tới mức số tiền phủ. CK 160K phủ đúng 2×80K nợ của chính Minh → gạch cả hai; nếu CLB hay **trả hộ** thì 160K nhập nhằng ("2 buổi của tôi" vs "tôi + 1 bạn") → hạ confidence → `/unmatched` → **owner gán tay, KHÔNG tự đoán**.
- **pay_code theo member KHÔNG pin buổi** (chỉ pin AI).

**Khi club cần chính xác từng buổi** (roster từng buổi / khác attendee / số tiền nhập nhằng) → đường deterministic:
- **VietQR theo từng session (đề xuất):** QR của buổi A nhúng memo gắn `session_id` của A → Minh quét QR buổi nào → CK tự gắn đúng buổi đó. Không bắt gõ tay.
- (hoặc) **pay_code theo session-player** (mã riêng từng buổi) — nhiều mã hơn, để sau nếu cần.
- (hoặc) bot **hỏi lại** "CK này cho buổi nào?" khi thấy ≥2 buổi identical — thêm ma sát.

→ SaaS default: **FIFO settle + đẩy owner khi tiền không map gọn**; club cần chính xác → bật **VietQR-per-session**.

## 4. Zalo — Zalo Bot Platform, bot-token per-club (KHÔNG cần OA)

**Phát hiện (đã verify trên `bot.zapps.me/docs`):** Zalo có **Zalo Bot Platform** — mô hình bot-token kiểu Telegram, **không phải OA**. Tạo bot qua OA trung tâm "Zalo Bot Manager" → nhận **Bot Token** → dùng `getMe`/`getUpdates`/`setWebhook`/`sendMessage`/`sendPhoto`... Endpoint `https://bot-api.zaloplatforms.com/bot<TOKEN>/<method>`. Nhẹ như BotFather → **bỏ hẳn nỗi lo BYO-OA + verify OA** của bản nháp trước.

**Khả năng & giới hạn (đã verify trên docs — định hình player-flow Zalo):**

| Có | Không / Hạn chế |
|---|---|
| `sendMessage` (`chat_id`, `text`, `parse_mode` md/html, `text_styles`) | ❌ inline button / reply_markup |
| `sendPhoto` → **VietQR chạy** (P4); `sendVoice`/`sendSticker`/`sendChatAction` | ❌ callback_query → **không tap-to-join** |
| `getUpdates` (long-poll) + `setWebhook` (secret 8–256, header `X-Bot-Api-Secret-Token`) | ❌ deep-link `start=` kiểu Telegram |
| `from.id`/`chat.id` tách bạch; `chat_type` = **PRIVATE + GROUP (Beta)** | ⚠️ GROUP còn **Beta** → rủi ro nếu phụ thuộc ở MVP |
| Bot Token **không hết hạn** tới khi reset | events chỉ: `message.{text,image,sticker,voice,unsupported}.received` |

→ **Player-flow Zalo: DM number-reply** (join `/join` + trả lời số, không tap-to-join). GROUP có (Beta) nên *về sau* có thể làm group-based number-reply như TG, nhưng MVP bám **DM cho chắc**. `message.unsupported.received` (user nhóm bảo vệ: trẻ em/khuyết tật...) → **không nhận nội dung** → fallback owner xử tay.

**Deployment — bot-token PER-CLUB (tối ưu hơn shared, trả lời #4):**

```ts
interface ZaloBot {                // per-tenant — chính bot ghim tenant
  id: string;
  tenantId: string;
  botTokenEnc: string;             // Bot Token, mã hoá at-rest (AES-GCM)
  webhookToken: string;            // /webhook/zalo/<token> → tenant (route + auth)
  active: boolean;
}
```

Vì sao **per-club** thắng **shared 1 bot Zalo**:

| | Shared 1 bot Zalo | **Bot-token per-club** ✅ |
|---|---|---|
| Ghim tenant khi DM | ❌ không deep-link; group còn Beta → chủ yếu sticky/picker (kênh yếu) | ✅ **bot nào = club đó**, không bao giờ mơ hồ |
| Rate-limit (429 quota có thật) | dồn chung mọi club | tách theo club |
| Chi phí tạo | 1 token | nhẹ — tenant paste token (như nối SePay) |
| Chi phí nền tảng Zalo | nếu platform tạo tập trung → **cap cứng 3 club** (Free = 3 bot/tài khoản) | **tenant BYO bot** (tài khoản riêng) → 1 bot/club ≤ 3 free → **free-at-scale** ✅ |

> ✅ **Chi phí đã rõ — Free = 3 bot / tài khoản Zalo.** Cap **per-tài-khoản**, không per-platform → quyết định kiến trúc: **tenant tự tạo bot dưới tài khoản Zalo của CHÍNH HỌ** rồi dán token (BYO, như nối SePay). Mỗi club cần 1 bot → nằm gọn trong 3 bot free của owner → **không bao giờ đụng cap, free khi scale**. **KHÔNG** để platform tạo mọi bot từ 1 tài khoản trung tâm — kiểu đó cap cứng ở 3 club. (Owner ôm >3 club/1 tài khoản → hiếm; dùng tài khoản Zalo khác hoặc Premium.)

→ Telegram ngược lại (shared tối ưu vì group + deep-link đã ghim tenant). Hai platform, **hai quyết định deployment khác nhau** nhưng chung `core`/`repo`.

- **Inbound:** webhook `/webhook/zalo/:token` → `ZaloBot` → tenant. Mọi tin Zalo của club đi qua bot riêng → tự ghim, **0 picker** (§2).
- **Outbound:** nhắc/xác nhận Zalo gọi `bot-api.zaloplatforms.com/bot<token>/sendMessage` với **token của chính tenant**. `notifyPlayersPaid` chọn credential theo tenant.
- **Onboarding (saas Phase 4):** wizard = "tạo bot trong Zalo Bot Manager **dưới tài khoản Zalo của owner** → dán Bot Token → trỏ webhook" — nhẹ, **không cần verify OA**, BYO nên cap 3-bot/tài-khoản không bao giờ bind (1 bot/club). Có thể cho club launch Telegram trước, thêm Zalo sau (không chặn).
- **Hosting — tách 2 nghĩa (đã chốt):** **Runtime** (webhook/getUpdates/gửi tin) **LUÔN do platform host** — tenant KHÔNG chạy server gì; BYO chỉ là *tạo bot + đưa token*. **Tạo & sở hữu token = BYO dưới tài khoản owner** vì: (a) **không có API tạo bot** (chỉ thao tác thủ công in-app trong Zalo Bot Manager → không tạo hộ dưới account user từ xa được); (b) BYO → cap 3/account không bind + bot thuộc về club (bền) + free-at-scale. **"Platform tạo hộ" = tạo dưới account của platform** → dính cap 3/account → farm account (rủi ro Zalo ban) hoặc Premium (ăn margin) + bot platform-owned (single point of failure). → chỉ làm dạng **add-on "managed" opt-in trả phí** cho club không rành kỹ thuật, **không** mặc định.
- **DM cần user đã nhắn bot:** `ChannelIdentity.canDm` set khi user nhắn bot lần đầu (TG & Zalo như nhau). Docs Zalo **không** nêu cửa sổ re-engagement (chỉ có 401 token / 429 quota) → có vẻ không bị chặn kiểu OA 7 ngày, nhưng **test thực tế** + fallback group/owner nếu bị chặn.

## 5. UNIQUE constraints — bổ sung cho saas §3.2

```sql
-- GLOBAL (ngoài tenant):
ALTER TABLE channel_identities ADD CONSTRAINT uq_channel UNIQUE (platform, platform_user_id);
-- TENANT-scoped:
ALTER TABLE memberships          ADD CONSTRAINT uq_membership      UNIQUE (tenant_id, person_id);
ALTER TABLE memberships          ADD CONSTRAINT uq_membership_pay  UNIQUE (tenant_id, pay_code);
ALTER TABLE channel_reachability ADD CONSTRAINT uq_reach          UNIQUE (person_id, tenant_id, platform);  -- C1
-- giữ nguyên từ saas §3.2: UNIQUE(tenant_id, norm), UNIQUE(tenant_id, alias_norm),
--                          UNIQUE(tenant_id, provider, external_id)
```

> ⚠️ `platform_user_id` UNIQUE phải **global** (1 acc TG = 1 người), nhưng `Membership` UNIQUE phải **per-tenant**. Đặt nhầm tầng là sinh bug: để membership UNIQUE global → Minh join club B bị chặn; để channel UNIQUE per-tenant → cùng acc TG đẻ nhiều Person.

## 6. Validate phải đổi từ "config đơn" → "theo tenant"

- **TG group-validate callback (TG plan #5):** cũ `chat.id == config.groupChatId`. Mới: callback từ group → tenant của group đó → check **`session.tenant_id == tenant.id`** (chống `pjoin:<sid>` cross-tenant — sessionId trần không đủ).
- **`sessions.tg_announce_chat_id` (#4):** kèm `tenant_id`; live-roster edit chỉ trong group của tenant.
- **`isOwner` → 2 lớp:** `TelegramLink`/`ZaloBot`/`PlayerChatContext` định tuyến tenant; **`TenantAdmin` theo `from.id`** phân quyền owner (saas §5.2). Player không gated.
- **Webhook timing-safe ×3 (AUDIT B3):** SePay (`Apikey`), Zalo (`X-Bot-Api-Secret-Token`), Telegram (secret path) — so `timingSafeEq`, sai → 401; **lưu raw payload trước khi xử** (BL-1) nhưng **không log secret/token**.
- **Secret store (AUDIT C7):** `botTokenEnc` (Zalo/club) + `webhookSecret` (SePay) + **token TG shared** để trong **KMS/secret manager riêng**, mã hoá envelope, least-privilege; **scrub token khỏi log** (token nằm trong URL webhook). Lộ token = chỉ **messaging**, KHÔNG mở được tiền (payments tenant-scoped + role `app NOBYPASSRLS`). Có quy trình **reset token** (Zalo reset được). Lưu ý blast-radius: token TG shared lộ = messaging mọi club; nên cô lập chặt.

## 7. Phase

| Phase SaaS | Player/Identity thêm |
|---|---|
| 0–3 (nền tenant + bot/webhook biết tenant) | điều kiện cần |
| **+ Phase 3.5 — Identity directory** | `Person`/`ChannelIdentity`/`ChannelReachability` (C1) + merge link-code OTP (C3) + reconcile/owner-merge membership trùng (C4/C5); refactor `members` → `Membership(person_id)`; claim-có-tiền cần khoá mạnh (C2) |
| **Phase 4 — Web canonical + Sync + Onboarding** | web app canonical + sync engine (command/outbox/projection + SSE — TDD §3.8); wizard **dán Zalo Bot Token** (§4) cạnh wizard SePay; deep-link `club_<slug>` cho player TG |
| **Phase 4.3 — Marketplace discovery** | publish kèo → `public_sessions`; tìm kèo; **join cross-club** reuse claim/membership-guest (TDD §3.9, AUDIT C8) |
| **Phase 4.5 — Player-side Telegram** | tap-join group + DM (deep-link/sticky/picker §2); announce/roster/reminder/confirm per-tenant |
| **Phase 4.6 — Player view** (person-self) | `/myclubs` + web player, đường query person-authorized (§3b) |
| **Phase 4.7 — Player-side Zalo** | provider Zalo Bot DM-only (number-reply) qua `ZaloBot` per-club; chung core/repo |
| **Phase 4.9 — pay_code/VietQR** (tùy chọn) | UNIQUE per-tenant; Zalo VietQR qua `sendPhoto` |

Repo đã choke-point `tenantId` (saas §4.1) → helper player (`addMemberToSession`, `notifyPlayersPaid`, `setPlayerReminded`...) chỉ cần port vào `tenantRepo` + nhận `membershipId` thay `member_id`.

## 8. Trạng thái quyết định

**Đã chốt (vòng này):** ✅ player dùng cả group + DM · ✅ có Zalo qua **Zalo Bot Platform bot-token, KHÔNG OA** · ✅ **bot-token per-club** cho Zalo (Telegram vẫn shared) · ✅ có global Person + `/myclubs` view · ✅ merge ưu tiên **ChannelIdentity** > **mã link round-trip** > **SĐT verified (share-contact)** > **email verified** > STK/tên (owner-mediated, chỉ gợi ý) > admin tay — **chỉ verified mới là khoá; tự gõ = gợi ý** · ✅ **đã fold fixes AUDIT C1–C7 + B1–B6** (xem `player-side-saas-AUDIT.md`): reachability per-tenant (C1), claim-có-tiền cần khoá mạnh (C2), link-code = OTP (C3), reconcile membership trùng (C4/C5), player-view auth từ phiên verify (C6), secret KMS + timing-safe (C7/B3).

**Còn chốt tiếp (không chặn Phase 0–3):**

1. **Khoá merge — đã chốt:** **SĐT verified qua share-contact** (Telegram `request_contact` / Zalo share contact, không cần SMS OTP) = khoá auto-merge chính; **mã link** = fallback không-PII; **email** chỉ dùng nếu web đã verify sẵn. Quy tắc: **chỉ verified mới auto-merge; tự gõ = gợi ý owner-mediated.** (PII → mã hoá + consent + không log.)
2. **`pay_code` prefix tenant:** vì tenant đã được route qua STK/bank webhook *trước* khi tra code, code trần + `UNIQUE(tenant_id, pay_code)` là **đủ về kỹ thuật**. Prefix `BMC-<code>` chỉ thêm (a) owner đọc nội dung CK biết club, (b) cross-check chống dán nhầm memo club khác. Đề xuất: **giữ code trần trong DB, hiển thị có prefix** trong memo. Chốt?
3. **Chi phí Zalo — đã rõ:** Free = **3 bot / tài khoản Zalo**. Chốt model **tenant BYO bot dưới tài khoản của họ** → 1 bot/club ≤ 3 free → **free-at-scale**; **không** tạo tập trung (cap cứng 3 club). Còn lại chỉ là giá Premium — chỉ cần nếu 1 owner ôm >3 club/1 tài khoản (hiếm), không chặn MVP.

**Đã verify (không còn là unknown):**
- Cửa sổ gửi tin: docs **không** có lỗi "ngoài cửa sổ" (chỉ 401/429) → có vẻ không chặn kiểu OA 7 ngày; vẫn test thực tế khi build.
- Group: **có `chat_type=GROUP` (Beta)**, `from.id`≠`chat.id`; nhưng không button → number-reply. MVP không phụ thuộc Beta.
- Token không hết hạn; webhook secret per-bot (`X-Bot-Api-Secret-Token`); rate-limit 429 có thật (cần throttler); deep-link `start=` **không có**.

---

*Nền multi-tenant SaaS giữ nguyên. Phụ lục bổ sung tầng **identity directory global** (Person/ChannelIdentity) để gộp đúng 1 người xuyên club + xuyên TG/Zalo, **player view** scoped-to-self, và 2 nhánh kênh: **Telegram shared-bot group-first + DM**, **Zalo Bot Platform bot-token per-club DM-only**. Tất cả là "lớp cộng thêm" trên repo tenant-scoped — không đụng đường tiền, không phá bất biến RLS (trừ đúng 1 đường read person-authorized §3b, có audit).*

---

## Changelog

| Ngày | Version | Thay đổi |
|------|---------|----------|
| 19/06/2026 | — | Thêm Changelog table |
| 18/06/2026 | v1.0 | Reconcile player-side với multi-tenant |
