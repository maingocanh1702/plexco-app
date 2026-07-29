<!-- review-readiness: historical -->
# Implementation Plan — Plexco (platform thể thao đa môn, host + player)

> Xây **Plexco** như **một sản phẩm riêng** (repo riêng), tái dùng phần logic đã kiểm chứng của bot single-club hiện tại — KHÔNG refactor tại chỗ trên bot đang chạy live. Plexco là **platform 2 phía, đa môn**: **host** tự đăng ký, nối bank/SePay, link kênh, quản & publish kèo; **player** khám phá kèo xuyên CLB/môn (marketplace) & join. **PostgreSQL + domain model = canonical store**; web/Zalo/Messenger là surface đồng bộ 2 chiều (Telegram archived theo DD-37). Tài liệu làm **ngược từ end goal** về kiến trúc, rồi chia phase.
>
> **Reposition (v2 doc, 18/06/2026):** từ "SaaS thu phí cầu lông" → **platform đa môn + marketplace discovery + web sync 2 chiều**. Module đối soát CK (killer cũ) giữ nguyên thiết kế, thành 1 module. Thêm **3 tầng hiển thị** (public discovery / tenant-private RLS / person-self), **sync engine**, **chiều `sport`**.
>
> **Tài liệu liên quan hiện hành:** `../product/BRD.md` v3.9n · `../product/PRD.md` v2.8m · `../product/TDD.md` v3.1h · `../product/ROADMAP.md` v3.4l · `../standards/decisions.md` v2.11 current mirror · `../proposals/in-app-chat-primary-player-surface-plan-2026-07-27.md` v1.8 · `../research/auto-debt-reconciliation-regional-availability-2026-07-27.md` · `../dd-69-app-native-analysis.md` · `../research/player-side-saas-AUDIT.md` · `../channels/messenger/messenger-channel-design.md`.
>
> ⚠️ **Version note (19/07/2026):** body gốc là historical implementation analysis. Authority hiện hành = BRD 3.9d/PRD 2.8c/TDD 3.1/ROADMAP 3.3c/decisions v1.67. DD-57..59 deferred; DD-60 accepted; DD-61..64 accepted-in-principle/no-runtime; DD-69 direction accepted; DD-70..72 🟡, DD-73..78 ✅ chốt (build gated). PWA vẫn là target chưa có runtime evidence, native phase 2 chưa có lịch, và mọi implementation phải qua technical/store/legal gates trong DD-69.
>
> ⚠️ **Current supersession (28/07/2026):** DD-91 định hướng In-app Chat thành primary daily player
> surface; Zalo/Messenger chuyển thành acquisition/external/fallback target. Primary plan v1.8 đã
> `PLAN_READY` tại `90d292d`, nhưng từng slice vẫn phải strict `CODE_READY` và chưa có chat/payment
> runtime. Mark-paid thủ công là global baseline; Host Pro
> `payment_reconcile_auto` chỉ được advertise/enable khi entitlement + market/provider/bank/currency/
> consent cùng pass — current provider authority mới là `sepay|apipay` cho Việt Nam và runtime
> webhook→settle→notify chưa có. Shared job mechanics `0022`/`0023` và Session CHECK `0024` đã merge,
> nhưng schedule OFF/placeholder; body lịch sử dưới đây không được dùng để claim product E2E.
>
> ⚠️ **SUPERSEDED PARTIALLY:** Telegram historical sections remain reference only. Messenger target was updated again by DD-65..68: one App, central Page always + optional tenant Page; host/player parity, Page-scoped identity/reachability, protected target routing and one-route delivery. Any body text saying Page-per-club-only or `page_id→tenant` is superseded.

## 0. Quyết định đã chốt

| Trục | Lựa chọn | Hệ quả |
|---|---|---|
| Sản phẩm | **Repo/sản phẩm riêng** | Bot cá nhân hiện tại đóng băng, vẫn chạy; SaaS build mới, lift logic thuần sang `core`. Không refactor tại chỗ. |
| Kênh chat *(DD-37/DD-65..68)* | **Zalo per-club + Messenger central/optional tenant Page** | Zalo token pins tenant. Messenger Page pins endpoint/default; protected action/ref/picker resolves target; exact AuthZ follows. |
| Khách hàng | **Host CLB VN (đa môn), thu phí qua bank/SePay** | Billing VND, không cần Stripe ở MVP. |
| Định vị | **Platform 2 phía, đa môn** (reposition) | Host quản lý + player khám phá/join (marketplace). Payment là 1 module. |
| Web UI | **Primary product surface** (không phải canonical store) | Web: onboarding, dashboard host, **discovery/tìm kèo**, player view, billing. PostgreSQL/domain model là canonical; mọi surface sync qua command/outbox/projector. |
| Đa kênh | **Zalo + Facebook Messenger + web** (Telegram bỏ — DD-37; Messenger **phase-1, P2.5**) | Mỗi action ở 1 kênh sync sang web + kênh khác qua **sync engine** (command/outbox/projection). |
| Đa môn | **`sport` là chiều dữ liệu** | `sessions.sport_id`; discovery lọc theo môn. Không kèm luật chơi từng môn. |
| Hiển thị dữ liệu | **3 tầng** | public discovery (cross-tenant, whitelist) · tenant-private (RLS) · person-self. |
| Database | **Postgres + Drizzle (single DB, `tenant_id` + RLS + public read model)** | Tối ưu maintain/scale >1k tenants. Bỏ `node:sqlite`. |
| Billing | **DD-29 (thay DD-03): free 0đ / host_pro 250k VND/tháng** | Free = web + Zalo + Messenger bot + **mark-paid thủ công tiền mặt/CK (DD-40)**; host_pro = auto đối soát/nhắc + AI + CRM. Capability flags config-driven. Trial cho paid plan. |
| Phí provider | **Tenant tự mang & tự trả SePay/ApiPay** | Phí giao dịch là việc giữa tenant ↔ provider; mình không trung gian tiền. |
| LLM/STT | **Platform trả, có trần fair-use** | Chi phí nằm trong margin từng tier → phải cap để giữ margin & chặn lạm dụng. |

**Vì sao Postgres chứ không SQLite-per-tenant ở mức >1k club:** một club = nhiều webhook ghi đồng thời (CK về bất cứ lúc nào) + cron nhắc nợ + lệnh bot. SQLite khoá ghi toàn-file (kể cả WAL chỉ 1 writer); 1k+ file `.db` thì backup/migrate/observability thành ác mộng vận hành. Postgres cho ghi đồng thời thật, 1 schema để migrate, và **Row-Level Security** làm lưới an toàn chống rò rỉ dữ liệu tài chính giữa các club. Domain hiện tại chỉ ~vài triệu dòng ở mức 1k club — Postgres dư sức.

### Tách thành sản phẩm riêng (không refactor tại chỗ)

Bot hiện tại đang **chạy live cho club của m** (data thật — xem cảnh báo `data/bot.db`). Trộn refactor multi-tenant vào đó = tự đặt mìn lên công cụ đang dùng hằng ngày. SaaS là **repo riêng**, tái dùng phần *logic đã kiểm chứng*:

| Lift sang `core` (giữ nguyên + test) | Viết lại cho multi-tenant | Thêm mới |
|---|---|---|
| `matching`, `payments-logic`, `dates`, `format`, `domain`, `i18n`, `time`, `sessions` + test | `db` (→ Postgres/Drizzle), `config`, wiring `bot`, `providers`, `index`, `reminder` | tenant / account / billing / web / RLS / usage |

Bot cũ **đóng băng, vẫn chạy** làm (a) công cụ cho club của m, (b) "reference behavior" để đối chiếu. Khi SaaS ổn → migrate club của m thành tenant #1 rồi mới tắt bot cũ (§10). Lợi ích lớn nhất: refactor multi-tenant **không thể làm hỏng** thứ đang dùng mỗi ngày.

---

## 1. End goal (làm ngược về)

> **Hai phía cùng đúng:**
> - **Host:** một chủ club (cầu lông/pickleball/…) ở VN thấy Plexco → đăng ký web (Google/email) → nối bank qua SePay → link Zalo/Messenger → quản kèo trên **chat hoặc web** (nhất quán), **publish kèo lên marketplace**, trả phí tháng.
> - **Player:** mở Plexco → **tìm kèo** theo môn/khu vực/giờ → **join** (kể cả CLB chưa từng tham gia) → được xác nhận/nhắc, xem kèo & nợ của mình — tất cả sync giữa kênh chat ↔ web.

Để điều đó đúng, lần ngược các điều kiện cần (mỗi cái là một phase về sau):

```
J. Billing sống          → plan, thu phí SePay, trial, dunning, gate theo plan
I. Player-side channels   → join Zalo/Msgr + nhắc/xác nhận theo Reachability (web push + Zalo DM chính; Msgr 24h)
H. Marketplace discovery  → publish kèo → public_sessions → tìm kèo → join cross-club
G. Web app + Sync engine  → web canonical + command/outbox/projection + SSE (2 chiều)
F. Onboarding self-serve  → web signup → tạo tenant (+ chọn môn) → wizard SePay → link kênh
E. Identity directory     → Person/ChannelIdentity/Membership + merge an toàn
D. Bot biết tenant        → route update về đúng tenant suy từ kênh (Zalo webhookToken / Msgr page_id)
C. Webhook biết tenant    → CK SePay route về đúng club (token URL + match số TK)
B. Cô lập + 3 tầng        → tenant_id + RLS (tenant-private) · public read model · person-self
A. Domain đa môn          → Tenant, Account, ChannelLink(Zalo/Msgr), BankAccount, Subscription, Sport, Session(public/slot/join_policy)
```

Build xuôi là `A → B → … → J`, mỗi phase ship được. (Đối chiếu phase narrative ↔ canonical: xem `../product/ROADMAP.md`.)

---

## 2. Gap analysis — cái gì vỡ khi lên multi-tenant

Đối chiếu code hiện tại (đọc qua `src/`):

| Vùng | Hiện tại (single-tenant) | Vấn đề SaaS |
|---|---|---|
| `config.ts` | `ownerChatId`, `sepayApiKey`, `groupChatId` là **biến môi trường đơn** | Mỗi tenant cần giá trị riêng → phải vào DB, không phải env |
| `notify.ts` `isOwner()` | So `chat.id === OWNER_CHAT_ID` | Thành "chat này thuộc tenant nào + có quyền không" |
| `db.ts` (~50 hàm) | Hàm tự do trên 1 connection, **không có `tenant_id`** | Mọi hàm phải scoped tenant — đây là khối refactor lớn nhất |
| `index.ts` | 1 `bot.start()` long-polling, webhook đăng ký 1 lần | 1 bot webhook + middleware resolve tenant; webhook route theo tenant |
| `providers/sepay.ts` | 1 `SEPAY_API_KEY` chung, match với **mọi** open session | Phải route CK về đúng tenant *trước khi* match |
| `payments.ts` `pickSession()` | `db.getOpenSessions()` toàn cục | Phải là open sessions **của tenant đó** |
| `reminder.ts` | Cron cho 1 owner | Quét theo tenant, notify đúng chat từng club |
| `settings` table | Key-value toàn cục (`lang`, `default_fee`, `current_session_id`, host) | Thành per-tenant |
| LLM/STT | Key env dùng chung, không đo | Platform trả tiền → phải đo + giới hạn theo plan |

Tin tốt: i18n `t(vi,en)` + `/lang` đã xong và `lang` đã nằm trong `settings` → chỉ cần scope theo tenant. Logic "đường tiền" (`payments-logic.ts`, `matching.ts`, business-rules) **không đổi** — chỉ đổi *phạm vi dữ liệu* nó chạy trên đó.

---

## 3. Domain model (thiết kế trước)

> ⚠️ **DD-37 (v3.4):** các interface sketch dưới đây là bản v1.0 (viết theo Telegram). Kênh phase-1 nay là **Zalo + Messenger**; `TelegramLink` → **`ChannelLink`** (Zalo `webhookToken` / Messenger `page_id`), `Account.telegramUserId` → **Google/email** (DD-13). **Canonical schema là `packages/db/schema.ts`** (`persons/accounts/channel_identities/memberships`, `account_identities.platform ∈ {google,email,facebook,zalo}`) — không dùng sketch dưới làm nguồn schema.

Hai nhóm: **aggregate mới** (lớp SaaS) và **entity cũ** (giờ thuộc về 1 tenant).

### 3.1 Aggregate mới

```ts
// Tenant = 1 club. Root của mọi dữ liệu nghiệp vụ.
interface Tenant {
  id: string;                 // uuid
  name: string;               // "Bestminton Club"
  slug: string;               // unique, dùng cho URL/hỗ trợ
  status: "trialing" | "active" | "past_due" | "suspended" | "cancelled";
  locale: "vi" | "en";        // thay settings.lang toàn cục
  timezone: string;           // thay TZ env (mặc định Asia/Ho_Chi_Minh)
  hostName: string | null;    // thay HOST_NAME env
  createdAt: string;
}

// Account = 1 con người đăng nhập web. Nhiều account có thể quản 1 tenant.
interface Account {
  id: string;
  telegramUserId: string | null;  // đăng nhập bằng Telegram Login Widget
  email: string | null;
  name: string;
  createdAt: string;
}

interface Membership {              // Account ⇄ Tenant (n-n), có vai trò
  accountId: string;
  tenantId: string;
  role: "owner" | "admin";
}

// ROUTING: chat nào thuộc tenant nào — thay OWNER_CHAT_ID & GROUP_CHAT_ID.
interface TelegramLink {
  tenantId: string;
  chatId: string;                   // private chat của admin, hoặc group club
  kind: "admin" | "group";
  linkedAt: string;
}

// AUTHORIZATION (tách hẳn khỏi routing): ai (theo telegram user id) được chạy
// lệnh admin của tenant. Denormalize từ Account.telegramUserId + Membership để
// tra nhanh trong group. Người bind /start link_<code> = admin đầu tiên.
interface TenantAdmin {
  tenantId: string;
  telegramUserId: string;
  role: "owner" | "admin";
}

// Tài khoản ngân hàng nhận tiền — dùng để ROUTE webhook về tenant.
interface BankAccount {
  id: string;
  tenantId: string;
  provider: "sepay" | "apipay";
  accountNumber: string;            // verify với payload webhook
  bankCode: string | null;
  webhookToken: string;             // unique, nằm trong URL /webhook/sepay/:token
  webhookSecret: string;            // SePay HMAC secret, KMS-encrypted; không log/plaintext UI
  requireAccountMatch: boolean;     // provider luôn gửi accountNumber → bắt buộc khớp
  active: boolean;
}

// Subscription của tenant (HỌ trả phí host cho mình) — tách hẳn khỏi "payment"
// của player. Pricing chốt theo DD-29 (thay DD-03); plan version immutable.
interface Subscription {
  tenantId: string;
  plan: "free" | "host_pro";
  priceVnd: number;                 // 0 | 250000 theo plan_version
  status: "trialing" | "active" | "past_due" | "suspended" | "cancelled";
  trialEndsAt: string | null;
  currentPeriodEnd: string;         // CK gia hạn đẩy mốc này +1 tháng
  createdAt: string;
}

// LLM/STT do PLATFORM trả → đo để (a) chặn lạm dụng trong giá phẳng, (b) theo
// dõi margin. Không phải gate tier — là trần fair-use + degrade nhẹ nhàng.
interface UsageCounter {
  tenantId: string;
  periodYm: string;                 // "2026-06"
  ocrCount: number;                 // ảnh extract player (vision LLM)
  sttCount: number;                 // voice command (speech-to-text)
  sessionCount: number;
}
```

> **Phân biệt 2 dòng tiền — cực quan trọng để không lẫn (bám canonical `packages/db/schema.ts`):**
> - **Tiền player vào club** (CK/tiền mặt): **KHÔNG** có bảng `payments` — dùng ledger canonical **`charges`** (khoản nợ mỗi lượt chơi) + **`bank_transactions`** (CK webhook) + **`payment_allocations`** (phân bổ; `source ∈ auto|manual|cash|waiver|reversal`). *(Note lịch sử: bot single-club cũ có bảng `payments`; Plexco **KHÔNG** port nó — đã thay bằng charges/allocations.)*
> - **Club trả phí thuê bao cho platform**: bảng riêng **`subscription_invoices`** + `billing_transactions` + `billing_allocations`. Đừng trộn với ledger player.

### 3.2 Entity cũ — thêm `tenant_id`

> ⛔ **SUPERSEDED bởi canonical schema (`packages/db/schema.ts`).** §3.2 dưới đây là **bản lift-and-shift GỐC** từ bot single-club (giữ làm lịch sử). Schema thực tế đã land **KHÔNG** giữ bảng `payments`/`payment_players` cũ: đường tiền player được thay bằng ledger **`charges` + `bank_transactions` + `payment_allocations`** (xem note §3.1 + `feature_payment_reconcile(.md/_tech)`). Các `ALTER TABLE payments ...` / `insert(payments)` bên dưới **KHÔNG còn áp dụng** — đọc như bối cảnh, không phải hướng dẫn migration hiện hành. `sessions`/`players`/`members` vẫn tồn tại (đã có `tenant_id` trong schema.ts).

Tất cả nhận thêm cột `tenant_id NOT NULL` (FK → `tenants.id`):
`sessions`, `players`, `members`, ~~`payments`~~, `aliases`, `buddies`, ~~`payment_players`~~, và `settings` (giờ là `(tenant_id, key)`). *(payments/payment_players: thay bằng charges/bank_transactions/payment_allocations — xem banner trên.)*

Các ràng buộc UNIQUE phải kèm tenant:

```sql
-- cũ: UNIQUE(session_id, norm) -- vẫn đúng vì session đã thuộc 1 tenant
-- members: cũ UNIQUE(norm) toàn cục → SAI ở multi-tenant
ALTER TABLE members ADD CONSTRAINT uq_member UNIQUE (tenant_id, norm);
-- aliases: cũ UNIQUE(alias_norm) toàn cục → phải kèm tenant
ALTER TABLE aliases ADD CONSTRAINT uq_alias UNIQUE (tenant_id, alias_norm);
-- payments: cũ UNIQUE(sepay_id) → đổi cột sepay_id→external_id (+ cột provider)
ALTER TABLE payments ADD CONSTRAINT uq_payment UNIQUE (tenant_id, provider, external_id);
```

> ⚠️ Bug tiềm ẩn nếu quên: hiện `members.norm` và `aliases.alias_norm` UNIQUE **toàn cục**. Giữ nguyên ở multi-tenant thì club A đăng ký "Minh" sẽ chặn club B. Mọi UNIQUE phải prefix `tenant_id`.

---

### 3.3 Đa môn, kèo public & Sync (thêm cho reposition)

```ts
// Môn thể thao — chiều phân loại của kèo (không kèm luật chơi từng môn).
interface Sport { id: string; key: "badminton"|"pickleball"|"tennis"|string; name: string; active: boolean; }

// Session (kèo) — mở rộng entity cũ cho đa môn + marketplace.
interface Session {
  id: string; tenantId: string;
  sportId: string;                       // MỚI — đa môn
  date: string; price: number;
  slotsMax: number | null;               // MỚI — giới hạn slot (discovery hiển thị slot trống)
  area: string | null;                   // MỚI — khu vực (PUBLIC); địa chỉ chi tiết để ở `venue`
  venue: string | null;                  // chi tiết — CHỈ khi player active
  skillLevel: string | null;             // MỚI — gợi ý trình độ
  visibility: "private" | "public";      // MỚI — public ⇒ đẩy lên marketplace
  joinPolicy: "open" | "approval";       // MỚI — join trực tiếp hay chờ host duyệt
  status: "open" | "closed";
}

// PUBLIC read model — projection field-whitelist, CROSS-TENANT, KHÔNG RLS, KHÔNG tiền/PII.
interface PublicSession {
  sessionId: string; tenantId: string;   // tenantId chỉ để route join, KHÔNG lộ ra response
  sportKey: string; startsAt: string; area: string | null;
  price: number; slotsOpen: number;
  hostDisplayName: string; clubDisplayName: string; joinPolicy: "open"|"approval";
}

// Join cross-club (approval mode).
interface JoinRequest { id: string; tenantId: string; sessionId: string; personId: string; status: "pending"|"approved"|"rejected"; }

// SYNC ENGINE — outbox pattern. Mọi ghi vào canonical store kèm 1 event (cùng tx).
interface OutboxEvent {
  id: string; tenantId: string;
  type: "session.created"|"session.updated"|"player.joined"|"player.left"|"payment.matched"|string;
  payload: unknown; dispatchedAt: string | null;   // dispatcher đẩy → projectors (idempotent)
}
```

**Sync model — xem TDD §3.8:** PostgreSQL/domain services là nguồn sự thật. Dispatcher project Zalo/web/public và chọn đúng một Messenger endpoint (tenant Page reachable → central Page reachable) bằng logical delivery dedup; provider failure không rollback canonical.

**Marketplace (3 tầng hiển thị) — xem TDD §3.9:** publish kèo (`visibility=public`) → projector đẩy field-whitelist vào `public_sessions`. Discovery API đọc read model này **cross-tenant, ngoài RLS, không tiền/PII**. Join từ marketplace → route `session_id → tenant` → `open`: tạo membership guest + addMember; `approval`: tạo `join_requests` host duyệt.

---

## 4. Cô lập dữ liệu — phần an toàn quan trọng nhất

Đây là app tài chính: club A **không bao giờ** được thấy tiền của club B; và **tiền/PII không bao giờ lọt ra public marketplace**. Các lớp phòng thủ:

### 4.1 Choke point: tenant-scoped repository

Thay vì `db.getOpenSessions()` toàn cục, mọi handler đi qua một repo đã "đóng gói" sẵn `tenantId`. Analogy: hiện giờ cả toà nhà chung 1 chìa master; repo giống phát cho mỗi club **một chìa chỉ mở đúng tầng của họ** — không cầm nhầm chìa được vì hàm còn không nhận tham số "tầng nào".

```ts
// core/repo.ts — 1 nơi DUY NHẤT chèn tenant_id, không handler nào tự viết WHERE
export function tenantRepo(tenantId: string) {
  return {
    getOpenSessions: () =>
      dbq.select().from(sessions)
        .where(and(eq(sessions.tenantId, tenantId), eq(sessions.status, "open")))
        .orderBy(desc(sessions.date)),

    getUnpaidMatchables: (sessionId: number) => /* ... luôn kèm tenantId ... */,
    recordPayment: (p: NewPayment) => dbq.insert(payments).values({ ...p, tenantId }),
    // ... port toàn bộ API của db.ts cũ vào đây, đều khép kín tenantId
  };
}
export type Repo = ReturnType<typeof tenantRepo>;
```

Handler bot/đổi từ `import * as db` → nhận `repo: Repo` (gắn vào `ctx.repo`). Lợi: nếu lỡ quên scope, **không compile được** vì hàm cũ không còn tồn tại ở scope toàn cục.

### 4.2 Lưới an toàn: Postgres Row-Level Security

Repo là phòng thủ ở app; RLS là phòng thủ ở DB — kể cả query viết sai vẫn không lọt. Phải làm **chặt**, vì RLS có nhiều cửa hậu dễ quên:

```sql
-- 1. App KHÔNG được kết nối bằng owner bảng hay superuser — cả hai BỎ QUA RLS.
--    Tạo role riêng, quyền tối thiểu, KHÔNG có BYPASSRLS. App connect bằng role này.
CREATE ROLE app LOGIN PASSWORD '...' NOSUPERUSER NOBYPASSRLS;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app;

-- 2. ENABLE để bật, FORCE để áp luôn cho CẢ owner bảng (chặn cửa hậu khi
--    migration/script lỡ chạy bằng owner).
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions FORCE  ROW LEVEL SECURITY;

-- 3. current_setting(..., TRUE) = missing_ok: chưa set context thì trả NULL
--    (không ném lỗi lạ), và `tenant_id = NULL` → 0 dòng ⇒ FAIL-CLOSED.
CREATE POLICY tenant_isolation ON sessions
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
-- lặp ENABLE + FORCE + POLICY cho MỌI bảng có tenant_id
```

Vì sao từng dòng quan trọng: **(1)** superuser & owner mặc định bypass RLS → nếu app dùng nhầm owner thì RLS vô nghĩa; **(2)** `FORCE` bịt cả owner; **(3)** `, true` để quên set context thì **thấy 0 dòng** (an toàn) thay vì crash khó hiểu — và cũng không "thấy hết".

Mỗi request mở transaction (bằng role `app`) và set biến:

```ts
await dbq.transaction(async (tx) => {
  await tx.execute(sql`SET LOCAL app.tenant_id = ${tenantId}`); // LOCAL: hết tx tự xoá
  return fn(tx);   // mọi query trong đây bị RLS giới hạn về tenant
});
```

### 4.3 Test bất biến

Thêm test khẳng định cô lập, chạy trong CI:

```ts
// seed tenant A + B, rồi:
test("repo B không bao giờ thấy session của A", () => {
  const a = tenantRepo(tenantA); const b = tenantRepo(tenantB);
  const s = a.createSession("X", "2026-06-14");
  assert.equal(b.getSession(s.id), undefined);   // phải undefined
});

// RLS fail-closed: query bằng role `app` mà QUÊN set app.tenant_id → thấy 0 dòng
test("raw query không set tenant context thì không thấy gì", async () => {
  await withTenant(tenantA, (tx) => tx.insert(sessions).values({ ...mk, tenantId: tenantA }));
  const rows = await dbAsAppRole.select().from(sessions); // KHÔNG SET LOCAL app.tenant_id
  assert.equal(rows.length, 0);                           // policy missing_ok ⇒ fail-closed
});
```

---

## 5. Routing — đưa sự kiện về đúng tenant

### 5.1 Webhook SePay (điểm khó nhất)

CK về thì làm sao biết của club nào? **Token trong URL route account + HMAC timestamp/raw-body + verify số tài khoản** (defense in depth):

1. Khi tenant nối bank, sinh `webhookToken` (random) + `webhookSecret`; OAuth Webhooks API đăng ký URL
   `https://app.../webhook/sepay/<webhookToken>` với `authen_type=HMAC_SHA256` + `secret_key`. `Api_Key` chỉ là explicit bounded fallback, không tự downgrade production.
2. Endpoint động:

```ts
app.post("/webhook/sepay/:token", async (req, res) => {
  const acct = await findBankAccountByWebhookToken(req.params.token); // route theo token
  if (!acct) return res.status(404).json({ success: false });

  const timestamp = requireSepayTimestamp(req.headers["x-sepay-timestamp"]);
  const signature = requireSha256Signature(req.headers["x-sepay-signature"]);
  if (!isWithinSeconds(timestamp, 300)) return res.status(401).json({ success: false });
  if (!timingSafeHmacEq(acct.webhookSecret, `${timestamp}.${req.rawBody}`, signature))
    return res.status(401).json({ success: false });

  const body = parseSepayBody(req.rawBody); // parse chỉ sau auth; không ký JSON re-serialize
  // defense in depth: số TK nhận phải khớp TK đã đăng ký. ⚠️ KHÔNG để
  // "thiếu accountNumber thì pass" — đó là lỗ hổng. Quan điểm theo payload THẬT:
  //   - provider LUÔN gửi accountNumber (xác nhận bằng fixture) → require, thiếu = 400
  //   - provider KHÔNG luôn gửi → verify field khác (sub-account/gateway) hoặc
  //     ghi rõ fallback; token-in-URL đã là lớp route+auth chính.
  if (acct.requireAccountMatch) {                    // bật theo từng provider
    if (!body.accountNumber)
      return res.status(400).json({ success: false, message: "missing accountNumber" });
    if (body.accountNumber !== acct.accountNumber)
      return res.status(409).json({ success: false, message: "account mismatch" });
  }

  const repo = tenantRepo(acct.tenantId);
  const rec = recordIncomingTransaction(repo, toTx(body));            // BL-1 giữ nguyên
  res.json({ success: true });
  if (rec?.isNew) void processRecordedPayment(repo, rec.payment);
});
```

> ⛔ **SUPERSEDED bởi canonical durable-webhook (schema.ts + `feature_payment_reconcile(.md/_tech)`).** Đoạn code + note trên là **lift từ bot single-club** (lịch sử). Đường tiền thực tế **KHÔNG** dùng bảng `payments`/`rec.payment`:
> 1. Trong **cùng 1 transaction**: lưu **`bank_transactions`** (raw payload enc, `unallocated_amount=amount`, `reconcile_status='pending'`) **+ enqueue reconcile job / ghi outbox** → **commit rồi mới ACK** (NFR-R1: không mất CK). Không "process" đồng bộ sau `res.json`.
> 2. **Reconcile worker** (idempotent) match tên+tiền+ngày → tạo **`payment_allocations`** (`source='auto'`) vào **`charges`** tương ứng, cập nhật `amount_allocated`/`status`; không khớp → `reconcile_status='unmatched'` (`/unmatched` gán tay = `source='manual'`).
>
> _Historical:_ ~~`processRecordedPayment`/`settleMemberDebts` + bảng `payments` lưu trước ack (BL-1)~~ — thay bằng `bank_transactions` + outbox + allocation vào `charges`.

> **Dedupe & id (generic vì đã có SePay + ApiPay):** đổi cột `sepay_id` → `external_id` + thêm cột `provider`. Unique là **`UNIQUE(tenant_id, provider, external_id)`** — không chỉ `(tenant_id, sepay_id)`, vì id chỉ duy nhất *trong phạm vi 1 provider* (SePay id 12345 ≠ ApiPay id 12345).
> Provider gửi **thiếu/empty id** → KHÔNG drop (mất tiền): sinh khoá tổng hợp deterministic `external_id = sha256(provider|accountNumber|amount|txDate|content)` để vẫn idempotent + vẫn lưu vào `/unmatched`. (Hiện `IncomingTransaction.externalId` đã generic; chỉ cần đổi cột DB + chỗ sinh id.)

### 5.2 Telegram (1 bot dùng chung) — *superseded (DD-37), giữ làm tham chiếu cơ chế*

> ⚠️ **Historical mechanism only.** Zalo token still pins tenant. Messenger `/webhook/messenger` resolves Page endpoint, then actor/Page-bound opaque action/protected ref/server picker resolves target; `page_id→tenant` alone is invalid for central/cross-club. AuthZ stays separate.

Chuyển long-polling → **webhook** (1 endpoint, scale tốt, không cần nhiều process):

```ts
// index.ts
app.use(webhookCallback(bot, "express"));        // POST /telegram/<secret>
await bot.api.setWebhook(`${PUBLIC_URL}/telegram/${TG_WEBHOOK_SECRET}`);
```

Middleware resolve tenant cho mọi update — thay `isOwner`:

```ts
bot.use(async (ctx, next) => {
  const chatId = String(ctx.chat?.id ?? "");
  // /start link_<code>: gắn chat này vào tenant (sinh code ở web onboarding)
  if (ctx.message?.text?.startsWith("/start link_")) {
    return bindChatToTenant(ctx, ctx.message.text.slice("/start link_".length));
  }
  const link = await findTelegramLink(chatId);    // chat_id → tenant
  if (!link) {
    return ctx.reply(t("Chưa nối club. Mở app... để bắt đầu.",
                       "Not linked yet. Open app... to start."));
  }
  const tenant = await getTenant(link.tenantId);
  if (tenant.status === "suspended")              // gate theo billing
    return ctx.reply(t("Club đang tạm dừng (thanh toán).", "Club suspended (billing)."));
  ctx.tenant = tenant;
  ctx.repo = tenantRepo(tenant.id);               // mọi command dùng ctx.repo
  await next();
});
```

Toàn bộ `bot.ts` đổi `db.*` → `ctx.repo.*`; `notifyOwner`/`postToGroup` đổi từ hằng số env → tra `TelegramLink` của tenant (kind `admin`/`group`).

> ⚠️ **`chat_id → tenant` mới biết "club nào", CHƯA biết "ai được phép".** Trong group club, *mọi thành viên* đều gửi lệnh được — nếu chỉ check `chat_id` thì bất kỳ ai trong group cũng gọi được `/delete`, `/cash`, `/backup`, `/restore`. Phải phân quyền theo **`ctx.from.id`** (định danh người), tách hẳn khỏi routing theo chat.

Authorization là lớp thứ 2, sau middleware tenant:

```ts
// Lệnh thay đổi dữ liệu / nhạy cảm → chỉ admin của tenant. Lệnh đọc (/status,
// /debt, /playerlist) thì ai trong group cũng chạy được.
const ADMIN_CMD = /^\/(delete|cash|unpay|fee|close|remove|add|autopaid|buddy|rename|backup|restore|post|use)\b/;

bot.use(async (ctx, next) => {
  if (ADMIN_CMD.test(ctx.message?.text ?? "")) {
    const uid = String(ctx.from?.id ?? "");
    // admin = Account có telegram_user_id này + Membership(tenant) role owner/admin.
    // Bảng tra nhanh `tenant_admins(tenant_id, telegram_user_id)` denormalize từ đó.
    if (!(await isTenantAdmin(ctx.tenant.id, uid)))
      return ctx.reply(t("Bạn không có quyền chạy lệnh này.", "You can't run this command."));
  }
  await next();
});
```

`TelegramLink` (chat→tenant) và `tenant_admins` (telegram_user_id→quyền) là **hai việc khác nhau**: link để định tuyến, admin-list để phân quyền. Lúc `/start link_<code>` cũng đồng thời ghi người bind làm admin đầu tiên.

> Rate limit: 1 bot có trần ~30 msg/s toàn cục + ~1 msg/s mỗi chat. Lúc cron nhắc nợ 1k club cùng giờ sẽ đụng trần → dùng grammY **throttler** (`@grammyjs/transformer-throttler`) cho outbound, và rải cron (jitter).

### 5.3 Cron nhắc nợ — đa tenant

`reminder.ts` đổi từ "1 owner" thành quét tất cả rồi notify đúng chat:

```ts
// 1 query lấy mọi session cần nhắc của MỌI tenant (đã join tenant + link),
// group theo tenant, gửi qua throttled bot. Tránh N+1: KHÔNG loop tenant rồi
// query từng cái — select 1 phát, xử lý theo nhóm.
```

---

## 6. Billing — host subscription tiers (VN bank/SePay)

Pricing host chốt theo **DD-29** (thay DD-03 4-tier theo kênh):

| Plan | Giá / tháng / CLB | Bao gồm |
|---|---:|---|
| `free` | 0đ | Web app + kết nối **Zalo + Facebook Messenger** bot + quản kèo/roster + **mark-paid thủ công (tiền mặt/CK)** + nhắc thủ công |
| `host_pro` | 250.000đ | Toàn bộ free + đối soát CK **tự động** & báo thu + **nhắc nợ tự động** + **Trợ lý AI + KB** + CRM dashboard |

Tính năng free/pro theo **capability flags config-driven** (registry ở `../features/BE/feature_billing_lifecycle_tech.md §4b`). Tenant **tự mang tài khoản** (hoặc dùng **APIpay enterprise auto-provision** — DD-30) và tự chịu phí provider — mình không cầm tiền của club, chỉ cầm phí subscription của chính tenant. *Messenger nay là kênh **phase-1 (P2.5)** — DD-37 (thay ghi chú post-MVP cũ).

Thu subscription tái dùng đúng hạ tầng webhook, nhưng trỏ vào **tài khoản nhận của MÌNH** (không phải của club):

- **Thu phí:** tenant CK đúng số tiền invoice theo plan vào TK của mình, nội dung gồm mã định danh/invoiceCode (vd `BMC-<tenantSlug>`) → webhook match → đẩy `currentPeriodEnd` +1 tháng, set `status=active`. Giống y logic match của bot, chỉ khác bảng đích (`subscription_invoices`).
- **Vòng đời (plan trả phí, DD-51):** `trialing` 14 ngày, remind D-2; hết trial chưa trả → khoá ngay về `free` (không grace). Subscription active trễ invoice → `past_due` + grace 7 ngày → `suspended`. Khi suspended, middleware chặn admin mutation nhưng vẫn durable-ingest CK player; auto-settle/auto-notify OFF fail-closed.
- **`free` (0đ):** tạo tenant → thẳng `active` vô thời hạn — **không** trial/invoice, **không** `past_due`/`suspended` vì non-payment; daily job bỏ qua plan 0đ (chỉ suspend vì ToS/abuse). Ref: DD-29, BL-BIL-1.
- **MVP có thể manual:** giai đoạn đầu mình tự xác nhận CK đúng invoice → bật `active` bằng tay; tự động hoá khâu match nội dung sau. Không chặn launch.

### Schema `subscription_invoices` (bank transfer dễ lệch → phải chặt)

CK ngân hàng hay lệch: gõ sai nội dung, trả dư, trả thiếu, trả trễ, trả 1 CK cho 2 kỳ. Schema phải lường trước:

```ts
interface SubscriptionInvoice {
  id: string;
  tenantId: string;
  invoiceCode: string;        // UNIQUE — mã nhúng vào nội dung CK, vd "BMC-a1b2-202606"
  periodYm: string;           // kỳ áp dụng, "2026-06"
  amountDue: number;          // lấy từ plan_version: 0 | 250000
  amountPaid: number;         // tổng đã khớp (có thể từ nhiều CK)
  status: "open" | "partial" | "paid" | "overpaid" | "void";
  providerTxnIds: string[];   // external_id đã áp vào invoice này — idempotency
  paidAt: string | null;
  createdAt: string;
}
```

Quy tắc xử lý:

- **Match bằng `invoiceCode`** (không chỉ slug) trong nội dung CK → tìm đúng invoice; không thấy code → vào "unmatched subscription" cho mình gán tay (như `/unmatched` của bot), KHÔNG tự đoán.
- **Idempotency:** mỗi `external_id` chỉ cộng vào `amountPaid` một lần (lưu trong `providerTxnIds`); webhook trùng không double-count.
- **Underpay** (trả thiếu): `partial` — chưa gia hạn đủ; nhắc trả nốt phần còn lại.
- **Overpay** (trả dư): `overpaid` — ghi credit sang kỳ sau (hoặc đánh dấu để refund tay).
- **Trả trễ:** CK tới lúc `past_due`/`suspended` vẫn khớp được invoice → reactivate + đẩy `currentPeriodEnd`.
- Đối soát: tổng `amountPaid` các invoice `paid` phải khớp tiền thực nhận vào TK billing.

### Fair-use LLM/STT (platform trả)

Vì LLM/STT nằm trong margin từng tier, `UsageCounter` đóng vai **trần chống lạm dụng**, không phải gate tier:

- Trần đề xuất/tháng/tenant: **OCR ~200 ảnh**, **STT ~500 voice** (thừa sức cho 1 club chơi 2–4 buổi/tuần). Vượt trần → degrade nhẹ: tắt OCR/STT, nhắc dùng `/add` thủ công + gõ lệnh, **không** chặn nghiệp vụ.
- Theo dõi tổng usage để soi margin; nếu một provider rẻ hơn (Gemini Flash cho vision, Groq Whisper cho STT) thì set làm mặc định platform.

> **Sanity-check margin:** paid tier host_pro 250k/tháng vẫn đủ cho usage bình thường (~16–32 lượt OCR + ít STT/tháng); vision Flash + Whisper-turbo chỉ tốn **vài cent/tenant/tháng**. Trần fair-use chủ yếu để chặn outlier (ai đó spam 10k ảnh), không phải để vắt tiền user.

---

## 7. Kiến trúc & tech stack

```
┌──────────── apps/web (Next.js) — PRIMARY WEB SURFACE ────┐
│  onboarding · dashboard host (kèo/roster/doanh thu) ·    │
│  DISCOVERY/tìm kèo · player view · billing · API + SSE   │
└───────────────────────┬───────────────────────────────────┘
                         │  dùng chung
┌──────────────── packages/core ────────────────────────────┐
│  domain types (+ Sport) · pure business logic              │
│  payments-logic · matching · sports     (logic thuần, test)│
└───────────────────────┬───────────────────────────────────┘
┌──────────── apps/bot (HTTP adapters + worker) ────────────┐
│  Zalo/Msgr webhook + middleware tnt · command bus ·       │
│  /webhook/sepay/:token · /webhook/messenger · /webhook/   │
│  zalo/:token · cron (pg-boss) · throttler · PROJECTORS    │
│  (reply Zalo · DM · Msgr 24h · SSE · upsert public_sessions)│
└───────────────────────┬───────────────────────────────────┘
                         ▼
   Postgres (RLS tenant-private) + public_sessions (read model, no money/PII)
                         ←  managed (Neon/Supabase/Railway)
```

> **PostgreSQL + domain model = canonical store**; bot/web/webhook gửi **command** → ghi + `outbox` (cùng tx) → projectors fan-out ra surfaces. Đọc chia 3 đường: tenant-private (RLS), person-self, public discovery (read model, no-RLS, whitelist). Chi tiết sync/discovery: TDD §3.8/§3.9.

- **Monorepo** (pnpm workspaces): `packages/core` chứa domain logic thuần; `packages/db` chứa Drizzle schema + `tenantRepo`/RLS boundary; web & bot dùng chung core. Logic core không biết gì về kênh/HTTP.
- **Web auth**: **Google OAuth + email/password** làm primary (DD-13 ✅); link **Facebook** (DD-33 ✅ phase-1; App Review pending) + **Zalo** (DD-14 ⬜) vào cùng Person để nhận diện xuyên kênh. *(Telegram Login đã bỏ — DD-37.)*
- **Queue/cron**: `pg-boss` (hàng đợi trên chính Postgres) — không thêm hạ tầng, đủ cho reminders + dunning ở mức 1k.
- **Secrets tenant** (SePay secret, BYO LLM key nếu có): mã hoá at-rest (AES-GCM với master key, hoặc KMS).
- **Deploy**: app 1 service (web có thể tách sau), Postgres managed có PITR backup. Bỏ volume SQLite của Railway.

---

## 8. Lộ trình theo phase

Ước lượng cho **1 dev**, rất thô. Mỗi phase ship được & có "definition of done". *(Phase numbering ở đây là đơn giản hoá; canonical P-numbers xem `../product/ROADMAP.md` v2.1.)*

### Phase 0 — Scaffolding & schema (≈1 tuần)
Monorepo pnpm; `packages/core` với Drizzle; Postgres local (docker) + managed; schema đầy đủ `tenant_id` + RLS policies; CI chạy migrate + test.
**DoD:** `drizzle-kit push` lên Postgres sạch, RLS bật, test cô lập (§4.3) xanh.

### Phase 1 — Core + tầng data multi-tenant (≈2.5–3 tuần) ⚠️ khối lớn nhất
Vì SaaS là repo riêng (§0), **không cần strangler tại chỗ** trên bot live. Hai bước:

1. **Lift logic thuần** (`matching`, `payments-logic`, `dates`, `format`, `domain`, `i18n`, `time`, `sessions`) + **test đi kèm** sang `packages/core` repo mới — copy + sửa import, *không đổi hành vi*; test phải xanh ngay (đây là lưới chắn cho bước 2).
2. **Viết tầng data mới** trên Postgres/Drizzle qua `tenantRepo(tenantId)` + RLS — thay hẳn `db.ts` SQLite, không bọc adapter. Đây là phần việc chính.

Bot cũ KHÔNG bị đụng → an toàn tuyệt đối; nó là bản tham chiếu hành vi khi viết lại.
**DoD:** test logic (`matching/payments/stt`) xanh trong `core` mới; tầng data mới + test cô lập (§4.3) xanh trên Postgres.

### Phase 2 — Bot biết tenant (≈1.5 tuần)
Long-polling → webhook; middleware resolve tenant; thay `isOwner`/`OWNER_CHAT_ID`/`GROUP_CHAT_ID` bằng `TelegramLink`; thread `ctx.repo` qua mọi command; cron đa-tenant + throttler; settings per-tenant.
**DoD:** 2 tenant test trên cùng 1 bot, lệnh + nhắc nợ không lẫn nhau.

### Phase 3 — Webhook biết tenant (≈1 tuần)
`/webhook/sepay/:token` + `/webhook/apipay/:token`; auth + verify số TK per-tenant (`requireAccountMatch` theo provider); dedupe `UNIQUE(tenant_id, provider, external_id)` + synthetic id khi thiếu. **Thu thập payload THẬT của SePay & ApiPay làm fixture** (gồm case thiếu `accountNumber`) trước khi chốt stance require/fallback — viết test từ fixture đó.
**DoD:** CK tới 2 token khác nhau vào đúng 2 club; sai token/secret/số TK đều bị từ chối; thiếu accountNumber xử lý đúng theo cờ; webhook trùng (cùng external_id) chỉ xử lý 1 lần.

### Phase 4 — Web app canonical + Sync engine + Onboarding + Marketplace (≈4–5 tuần) ⚠️ trụ mới
Next.js web: Google/email → tenant → bank/Zalo; Messenger central is platform-ready, optional tenant Page connect; dashboard host + player view.
- **Sync engine (P4):** command bus + `outbox_events` (ghi cùng tx) + dispatcher + projectors (reply Zalo · DM Messenger · **SSE web** · upsert `public_sessions`); idempotent `commandId`/`event.id`; re-project khi lệch.
- **Marketplace (P4.3):** publish kèo (`visibility=public`) → projector đẩy field-whitelist `public_sessions`; **Discovery API** (`/discover`, cross-tenant, no-RLS, whitelist, rate-limit); **join cross-club** (open → membership guest; approval → `join_requests`).
**DoD:** host tạo kèo trên web → hiện ở Zalo/Messenger **và** marketplace ≤ vài giây (sync 2 chiều); player lạ tìm kèo theo môn/khu vực và **join được**; test bất biến public (không lộ tiền/PII) xanh; không đụng env file.

### Phase 5 — Billing tiers (≈2 tuần)
`subscription_invoices` đầy đủ (invoiceCode unique, amount due/paid, status, idempotency theo `providerTxnIds`, overpay/underpay/late); webhook gia hạn match theo `invoiceCode`; vòng đời trial → past_due → suspended (suspended vẫn lưu webhook player); trần fair-use `UsageCounter` cho LLM/STT + degrade nhẹ; nhắc gia hạn qua Zalo/web + email. (Có thể manual-activate trước khi tự động hoá match.)
**DoD:** tenant hết trial bị chặn lệnh nhưng CK player vẫn được lưu; CK đúng `invoiceCode` + đúng/đủ amount theo plan tự kích hoạt lại; trả thiếu→`partial`, trả dư→credit, webhook trùng không cộng 2 lần; nội dung sai code → vào unmatched chứ không tự đoán; vượt trần OCR → fallback `/add` chứ không vỡ.

### Phase 6 — Hardening & scale (≈1–1.5 tuần)
Pen-test cô lập (thử mọi endpoint với tenant sai); load test mô phỏng >1k tenant + burst webhook; observability (log có `tenant_id`, metrics, error tracking); rate-limit webhook; ToS/Privacy cho dữ liệu tài chính; runbook backup/restore.
**DoD:** load test đạt mục tiêu p95; không có đường rò rỉ cross-tenant; backup/restore diễn tập xong.

**Tổng:** ~16–20 tuần cho 1 dev tới platform thu phí được (Phase 4 nay gồm web canonical + sync engine + marketplace nên nặng hơn bản cũ). Có thể "soft launch" sau Phase 4 (miễn phí) để validate marketplace trước khi làm billing.

---

## 9. Rủi ro & bất biến

| Rủi ro | Mức | Giảm thiểu |
|---|---|---|
| **Rò rỉ dữ liệu cross-tenant** (tiền!) | Nghiêm trọng | Repo choke point + RLS + test bất biến + log review |
| **Lộ tiền/PII ra public marketplace** | Nghiêm trọng | `public_sessions` field-whitelist; tiền/PII không vào read model; test bất biến public; rate-limit chống scrape; `venue` ẩn tới khi join |
| **Sync lệch trạng thái kênh ↔ web** | Cao | Canonical store + outbox + re-projection; idempotent `commandId`/`event.id`; metrics sync-lag |
| **Webhook route nhầm club** | Cao | Token-in-URL + verify `accountNumber` + luôn lưu raw payload trước |
| Zalo/Messenger rate-limit khi cron 1k club | Trung bình | Throttler + rải giờ (jitter) + hàng đợi pg-boss |
| Chi phí LLM/STT vượt margin plan | Trung bình | Platform trả → trần fair-use `UsageCounter` + degrade về `/add` thủ công; chọn provider rẻ (Flash/Whisper-turbo) làm mặc định |
| Refactor làm hỏng club hiện tại | **Thấp** | SaaS là repo riêng → bot cũ KHÔNG bị đụng; migrate từ bản copy; cutover chỉ khi SaaS đã ổn |
| Lẫn "payment club" vs "subscription" | Trung bình | Tách 2 ledger rõ ràng: **player** = `charges`/`bank_transactions`/`payment_allocations` (KHÔNG bảng `payments`) vs **subscription** = `subscription_invoices`/`billing_transactions`/`billing_allocations` |

**Bất biến phải giữ:** (1) mọi truy cập DB tenant-private đi qua repo có `tenantId` (RLS); (2) lưu **`bank_transaction`** (raw enc) + **enqueue reconcile job/outbox** trong cùng txn **trước khi ack 200** (BL-1/NFR-R1) — kèm `tenant_id`; allocation vào `charges` do worker (không bảng `payments`); (3) không bao giờ auto-mark nhiều người hơn số tiền phủ (BL-2); (4) **`public_sessions` chỉ field whitelist — tiền/PII/roster không bao giờ vào** (test bất biến public); (5) **canonical store là nguồn sự thật duy nhất** — surface là projection, không multi-master (sync idempotent qua `commandId`/`event.id`).

---

## 10. Migrate club hiện tại → tenant #1 (sau khi SaaS ổn)

Bot cũ chạy **song song** tới khi SaaS đã chứng minh ổn định; lúc đó mới đưa club của m lên làm tenant #1 và retire bản standalone. Script một lần đọc `data/bot.db` (SQLite cũ) và chèn vào Postgres dưới 1 `tenant_id`:

```ts
// scripts/migrate-sqlite-to-pg.ts
// 1. tạo tenant "Bestminton" + Account của Ngoc-Anh + Membership(owner)
// 2. TelegramLink: OWNER_CHAT_ID(.env) → kind=admin; GROUP_CHAT_ID → kind=group
// 3. BankAccount: số TK + SEPAY_API_KEY cũ → webhookSecret, sinh webhookToken mới
// 4. copy sessions/players/members/aliases/buddies + gắn tenant_id;
//    map tiền cũ: bot.db `payments`/`payment_players` → canonical `bank_transactions` + `payment_allocations` + `charges`
//    (KHÔNG tạo bảng `payments` trong Postgres — schema.ts không có)
// 5. settings cũ (lang, default_fee, host...) → settings per-tenant + cột Tenant
```

Cutover: chạy migrate trên copy → verify đối chiếu số dòng & vài session → đổi webhook SePay sang URL token mới → tắt bot cũ.

---

## 11. Trạng thái quyết định

**Đã chốt:** ✅ **DD-29 (thay DD-03):** host **free 0đ / host_pro 250k VND/tháng**, capability flags config-driven · ✅ **DD-30:** APIpay enterprise auto-provision per-host (tiền vẫn về TK host) · ✅ tenant **tự mang & tự trả** phí SePay/ApiPay · ✅ **LLM/STT platform trả** + trần fair-use.

**Đã chốt sau bản gốc:** hosting DD-04; capability registry DD-56; lifecycle DD-51; Messenger hybrid/shared surface DD-65..68. Các quyết định không tự chứng minh code đã land.

**Còn mở:** trần fair-use OCR/STT chính thức trước P7 go-live; provider LLM/privacy due-diligence DD-18; external DD-14/15/33; legal A3 và các design-probe B0/B1/B2/B3 trong `../pre-code-open-items-2026-07-16.md`.

**Đã chốt sau bản gốc:** web stack = Next.js App Router, standalone/container (DD-10 ✅); public read model = `public_sessions` projector (DD-12 ✅).

---

*Logic nghiệp vụ (matching, đường tiền, business-rules) giữ nguyên — SaaS hoá là bài toán **phạm vi dữ liệu + định tuyến + vòng đời tenant**, không phải viết lại lõi.*

---

## Changelog

| Ngày | Version | Thay đổi |
|------|---------|----------|
| 28/07/2026 | v2.0 | Refresh current-authority pointers; mirror primary plan v1.8 `PLAN_READY` at `90d292d` while retaining per-slice `CODE_READY`, regional auto-reconcile gates and historical-body boundary. |
| 27/07/2026 | v1.9 | Refresh current-authority pointers; add DD-91 surface direction, regional auto-reconcile gates and `0022`–`0024` implemented-but-not-product-runtime boundary. Historical body remains preserved. |
| 18/07/2026 | v1.8 | Current authority → BRD v3.9d/PRD v2.8b/TDD v3.1/ROADMAP v3.3b/decisions v1.47; reconcile DD-57..64 statuses and DD-69 accepted direction without changing historical body/runtime claims. |
| 18/07/2026 | v1.7 | Current authority → BRD v3.9c/PRD v2.8a/TDD v3.1/ROADMAP v3.3a/decisions v1.46; link DD-69 proposal và ghi rõ không đổi phase-1 scope/timeline. Historical body unchanged. |
| 17/07/2026 | v1.6 | Current authority → BRD v3.9b/PRD v2.8/TDD v3.1/ROADMAP v3.3/decisions v1.45; feature-doc closure only, historical body/scope unchanged. |
| 17/07/2026 | v1.5 | Authority → TDD v3.0/decisions v1.45; generalized provider-endpoint identity/reachability cho Messenger + Zalo. Historical body/scope không đổi. |
| 17/07/2026 | v1.4 | Current-reference closure: BRD v3.9a + feature contract propagation DD-67; historical body/scope không đổi. |
| 17/07/2026 | v1.3 | Authority v1.44/ROADMAP 3.2; supersede Page-per-club-only with DD-65..68 hybrid shared surface, protected target resolver and one-route delivery. |
| 16/07/2026 | v1.2 | Authority refresh v1.39; replace stale hosting/admin/trial open items with DD-04/51/56 outcomes; pin suspended ingest ON + automation OFF; retain explicit historical/superseded boundary. |
| 19/06/2026 | — | Thêm Changelog table |
| 18/06/2026 | v1.0 | Implementation plan SaaS multi-tenant |
| 10/07/2026 | v1.1 | **DD-37 channel pivot (BRD v3.4):** bỏ Telegram; kênh phase-1 = web + Zalo + Facebook Messenger (Messenger P2.5). §0 decision table + §1 end-goal + §6/§7 đổi TG→Zalo/Messenger; web-auth = Google/email (DD-13); free-tier bots = Zalo+Messenger + mark-paid thủ công tiền mặt/CK (DD-40). Cơ chế Telegram §5.2 + interface sketch §3 giữ làm tham chiếu lift từ bot cũ (superseded). |
