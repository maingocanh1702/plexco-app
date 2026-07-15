# Technical Design Document (TDD) — Plexco
## Platform thể thao đa môn (host + player) — multi-tenant, marketplace discovery, sync đa surface, Zalo + Facebook Messenger + Web app *(Telegram đã loại khỏi phạm vi — DD-37)*

**Phiên bản:** 2.5 — **v3.4 channel pivot (DD-37) + DD-45 waitlist contract**: bỏ Telegram; kênh phase-1 = web + Zalo + Facebook Messenger; auth Google/email; mark-paid thủ công; final join active-vs-waitlisted dưới lock; chuẩn hoá canonical store và ledger tiền. **v2.4:** tham chiếu cụm session-model + social (DD-06/08/41–48) — contract build P2–P4+, chi tiết ở feature specs. **v2.5 (16/07):** DD-04 ✅ (c) DO co-locate (Postgres host = DO App Platform + Managed PG VPC private).
**Ngày tạo:** 16/06/2026 · **Cập nhật:** 15/07/2026
**Tài liệu tham chiếu:**
- `BRD.md` v3.6 — yêu cầu nghiệp vụ
- `PRD.md` v2.4 — user flows + edge cases
- `../strategy/saas-implementation-plan.md` — kiến trúc multi-tenant
- `../research/player-side-saas-reconciliation.md` — identity/kênh/matching
- `../research/player-side-saas-AUDIT.md` — threat model & must-fix (C1–C7, B1–B6, §B2, + threat model public discovery)
- `../channels/messenger/messenger-channel-design.md` — kênh Messenger (**phase-1, P2.5**): delta data model, routing theo `page_id`
- `../standards/decisions.md` — DD-05/45 (join/waitlist ✅), DD-06 (venue granularity ✅), DD-08 (sports+level rank ✅), DD-37 (channel pivot ✅), DD-13 (Google auth ✅), DD-33 (Facebook link 🟡), DD-38 (chat ✅), DD-39 (giá theo giới tính ✅), DD-40 (mark-paid thủ công ✅), DD-41 (session fields+gating ✅), DD-42/43/44 (attendance/tags/invite ✅ build P4+), DD-46 (personal tenant ✅), DD-47/48 (follow/visibility ✅ framework P4+) — contract chi tiết ở feature specs + `dd-*-analysis.md`

> [!IMPORTANT]
> **Scope:** TDD cover tới **P6** ở mức thiết kế. BRD là nguồn sự thật cho product scope; PRD cho behavior; TDD là implementation contract; ROADMAP cho thứ tự/progress. Security constraints nghiêm ngặt hơn giữa BRD và AUDIT luôn thắng.
> **Khác bot single-club hiện tại:** Plexco là **repo riêng**, lift logic thuần (matching, payments-logic, dates, format) sang `packages/core`; viết lại tầng data trên Postgres + RLS.
> **Bốn bất biến lõi:** (1) tiền/roster không rò cross-tenant; (2) tiền/PII không lọt public discovery; (3) allocation không làm mất/đếm quá tiền; (4) PostgreSQL/domain model là nguồn sự thật, surface chỉ là projection.

---

## 1. Overview

### 1.1 Mục đích
Platform **2 phía, đa môn**: **host** tạo & quản lý kèo, thu & đối soát tiền sân, quản club — qua Zalo/Facebook Messenger và web; **player** khám phá kèo xuyên CLB/môn & join, theo dõi kèo/nợ của mình. **PostgreSQL + domain model = canonical store**; web và kênh chat là surface, đồng bộ qua **sync engine**. **Telegram đã loại khỏi phạm vi (DD-37); Messenger là kênh phase-1 (P2.5, phụ thuộc App Review).** Mỗi CLB là 1 **tenant** cô lập tuyệt đối ở tầng tiền/roster/chat; **public discovery** là lớp đọc cross-tenant field-whitelist.

### 1.2 Phạm vi theo phase

| Scope | Pha | Ghi chú |
|---|---|---|
| **Nền tenant + Postgres/RLS + schema đa môn + 3 tầng hiển thị + Google login** | P0–P1 | repo choke-point + RLS fail-closed + `sports` + public read model skeleton + Google OAuth/email (DD-13) |
| **Zalo biết tenant** | P2 | bot-per-club, middleware resolve tenant theo `webhook_token`, mark-paid thủ công (DD-40), cron đa-tenant |
| **Facebook Messenger** (kênh phase-1) | P2.5 | Page per-club, route theo `page_id`, cửa sổ 24h, join+xác nhận, App Review |
| **Webhook CK biết tenant** (module tiền, auto = `host_pro`) | P3 | `/webhook/sepay/:token`, dedupe, FIFO settle |
| **Identity directory** | P3.5 | Person/ChannelIdentity/Reachability/Membership + link Facebook/Zalo + merge |
| **Web app + canonical backend + Sync engine + chat in-app + cài đặt hồ sơ** | P4 | command/event + outbox + projection ra surfaces + web realtime; onboarding; chat (DD-38 ✅) + giá theo giới tính (DD-39 ✅) |
| **Marketplace discovery** | P4.3 | publish kèo → public projection; tìm kèo (lọc môn/khu vực/giờ); join cross-club + approval |
| **Player-side Zalo/Messenger + view** | P4.5–4.7 | Zalo number-reply, Messenger quick-reply, my-clubs |
| **Billing** | P5 | subscription_invoices, vòng đời tenant |
| **Hardening** | P6 | pen-test isolation **+ public layer**, load test, observability sync-lag |

### 1.3 Ngoài phạm vi
Matchmaking xếp cặp tự động · venue/booking nhà thi đấu · scoring/trận đấu · gamification/ELO · app native · **Telegram và nền tảng chat khác ngoài Zalo/Messenger** · **bridge chat in-app ra group Zalo/Messenger** (chat in-app chỉ sống trong Plexco ở phase-1). (Multi-sport có nhưng **không** kèm luật chơi từng môn — chỉ là chiều phân loại + lọc.)

---

## 2. Requirements

### 2.1 Functional (theo module — chi tiết PRD)

| # | FR | Persona | Mô tả | Pha | Prio |
|---|---|---|---|---|---|
| FR-0 | Multi-sport | System | `sports` + `sessions.sport_id`; lọc/hiển thị theo môn | P1 | P0 |
| FR-1 | Onboarding tenant | P1 | **Google login / email** → tạo tenant → nối SePay → dán Zalo token → link Facebook Messenger (Page, App Review) → config (môn mặc định, publish/join policy) | P4 | P0 |
| FR-2 | Session CRUD (chat + web) | P1 | tạo/đóng kèo: môn/giá (một mức hoặc **giá nam/nữ**, DD-39 ✅)/giờ/khu vực/slot/trình độ/visibility/join_policy; auto/`/announce`; sửa trên web | P2/P4 | P0 |
| FR-3 | Join Messenger | P3 | quick-reply/persistent menu (Page-per-club) + validate `page_id`/tenant/session; cửa sổ 24h | P2.5/P4.5 | P0 |
| FR-4 | Join Zalo | P3 | `/join` + number-reply (bot-per-club DM) | P4.7 | P0 |
| FR-5 | Identity resolve | System | (platform,uid)→ChannelIdentity→Person→Membership(∩tenant); `platform ∈ {zalo,messenger}` (chat), account ∈ {google,email,facebook,zalo} | P3.5 | P0 |
| FR-6 | Claim/merge | System | claim-có-tiền cần khoá mạnh; merge OTP/SĐT-verified; **link Facebook/Zalo vào Person**; reconcile trùng | P3.5 | P0 |
| FR-7 | Webhook reconcile (auto = `host_pro`) | System | durable ingest → match (pay_code→tên/amount/ngày) → allocate transaction vào charges | P3 | P0 |
| **FR-7b** | **Mark-paid thủ công (mọi tier, DD-40)** | P1 | host chọn 1/nhiều player (tap/multi-select) đánh dấu **tiền mặt** (`source='cash'`) hoặc **CK** khớp `bank_transaction` (`source='manual'`); INSERT `payment_allocations` + cập nhật `charges`, audit, idempotent; preview+confirm (DD-25) | P2 | P0 |
| FR-8 | Payment ledger / BL-2 | System | charge (suy giá theo giới tính member nếu đặt giá nam/nữ) + bank transaction + allocation; hỗ trợ partial/multi-person; không phân bổ quá số tiền CK | P3 | P0 |
| FR-9 | /unmatched | P1 | gán tay + retry cron | P3 | P0 |
| FR-10 | Reminder | System | manual (mọi tier) → auto cron (`host_pro`) qua **web push + Zalo DM** (chính); Messenger best-effort trong cửa sổ 24h; theo Reachability | P2/P3 | P0 |
| FR-11 | notifyPlayersPaid | System | xác nhận đa-kênh sau mọi markPaid (thủ công + auto) + sync web | P4.5 | P0 |
| FR-12 | Player view (person-self) | P3/P4 | clubs/kèo/nợ của tôi, person-authorized; web + bot | P4.6 | P1 |
| FR-13 | Billing | System | subscription_invoices, trial→active→past_due→suspended (plan trả phí `host_pro`); `free` 0đ vào thẳng `active`, không invoice/past_due; entitlement = capability flags config-driven (DD-29 thay DD-03, BL-BIL-1) | P5 | P0 |
| **FR-14** | **Sync engine** | System | canonical store + command/event + **outbox** → projection ra Zalo/Messenger/web/public; idempotent; re-project khi lệch | P4 | P0 |
| **FR-15** | **Web app (surface)** | P1/P3/P4 | host dashboard (kèo/roster/doanh thu), player view, discovery UI, chat in-app (DD-38 ✅), cài đặt hồ sơ (DD-39 ✅); mọi ghi đi qua canonical backend | P4 | P0 |
| **FR-16** | **Publish kèo → public projection** | P1 | host set `visibility=public` → đẩy field-whitelist vào `public_sessions` (read model) | P4.3 | P0 |
| **FR-17** | **Discovery / tìm kèo** | P3/P4 | API/UI lọc môn/khu vực/ngày/giờ/trình độ/giá/slot; cross-tenant read model, KHÔNG RLS, KHÔNG tiền/PII/giới tính | P4.3 | P0 |
| **FR-18** | **Join cross-club** | P3/P4 | join kèo của CLB chưa là member → tạo membership guest; `join_policy=approval` → `join_requests` host duyệt | P4.3 | P0 |
| **FR-19** | **Chat in-app (DD-38 ✅, scope-committed phase-1)** | P3/P4 | chat toàn CLB (tenant, RLS) + 1-1 (person-self); chỉ Plexco, **không bridge** kênh ngoài; SSE; schema `chat_*` **chờ migration** (chưa vào canonical `schema.ts`; xem `../standards/decisions.md` DD-38 + doc Draft) | P4 | P1 |
| **FR-20** | **Cài đặt hồ sơ + giá theo giới tính (DD-39 ✅, scope-committed phase-1)** | P1/P3 | gender/dob/name/username/language; giá nam/nữ suy charge theo `person.gender`; PII consent, không lộ public; cột `person.gender/dob/...` **chờ migration** (xem DD-39 + doc Draft) | P4 | P1 |

### 2.2 Non-Functional (đo được)

| # | NFR | Yêu cầu | Metric |
|---|---|---|---|
| NFR-1 | **Cô lập tenant** | Repo scoped + RLS fail-closed + FORCE + role `NOBYPASSRLS` | 0 rò rỉ cross-tenant; test bất biến xanh |
| NFR-1b | **Public layer an toàn** | `public_sessions` read model chỉ field whitelist; tiền/PII/roster KHÔNG vào | 0 lộ tiền/PII ra public; test bất biến public xanh |
| NFR-1c | **Sync nhất quán** | canonical store + outbox + projection idempotent | sync-lag p95 ≤ 3s, p99 ≤ 10s; re-project hết lệch; 0 multi-master conflict |
| NFR-2 | **Latency reconcile** | webhook → markPaid → notify | ≤ 5s P99 |
| NFR-3 | **Concurrency** | webhook + cron + lệnh đồng thời | ≥1k tenant; slot/payment allocation không race |
| NFR-4 | **Idempotency** | webhook trùng | `UNIQUE(tenant,provider,external_id)` skip |
| NFR-5 | **Data safety** | không mất CK | transaction lưu raw + enqueue trước ack; audit allocation; retry tới terminal |
| NFR-6 | **Secret** | token/secret | KMS at-rest, không log, timing-safe verify, reset path |
| NFR-7 | **Rate-limit** | Zalo/Messenger outbound | throttler + jitter cron |
| NFR-8 | **API error** | luôn JSON `{error,message,code,statusCode}` | — |
| NFR-9 | **Privacy** | PII (SĐT/email) | consent, AES at-rest, soft-delete, không vào URL/log |
| NFR-10 | **Availability** | API uptime | ≥ 99.5% |

---

## 3. Technical Design

### 3.1 System Architecture

```mermaid
graph TB
    subgraph Surfaces
        ZALO["Zalo bots (per-club, BYO token)"]
        MSGR["Messenger Pages (per-club, phase-1, App Review)"]
        WEBUI["Web app (host dashboard · player view · discovery · chat in-app)"]
        SEPAY["SePay / ApiPay (kênh tiền)"]
    end

    subgraph Backend ["apps/bot + apps/web — Next.js + HTTP channel adapters (modular monolith)"]
        ZWH["/webhook/zalo/:token"]
        MWH["/webhook/messenger (page_id)"]
        PWH["/webhook/sepay/:token"]
        WAPI["Web API + SSE (realtime + chat)"]
        DISC["Discovery API (public projection, least-privilege readonly)"]
        MW["Tenant-resolve middleware"]
        AUTHZ["Authz (Google/email session · TenantAdmin / person-session)"]
        CMD["Command bus → Services"]
        SERV["Services (session/payment/identity/remind/billing/chat)"]
        REPO["tenantRepo(tenantId) — choke point (canonical writes)"]
        OUTBOX["Outbox → Event dispatcher"]
        PROJ["Projectors (Zalo/Msgr DM · web SSE · public_sessions)"]
        QUEUE["pg-boss (cron/jobs)"]
    end

    subgraph Core ["packages/core (logic thuần, test)"]
        MATCH["matching / payments-logic / dates / format / i18n / sports"]
    end

    subgraph Data
        PG["PostgreSQL (RLS tenant-private)"]
        PUB["public_sessions (read model, cross-tenant, no money/PII)"]
        KMS["Secret manager / KMS"]
    end

    ZALO --> ZWH --> MW
    MSGR --> MWH --> MW
    SEPAY --> PWH --> CMD
    WEBUI --> WAPI --> MW
    WEBUI -. browse .-> DISC --> PUB
    MW --> AUTHZ --> CMD --> SERV --> REPO --> PG
    SERV --> MATCH
    SERV --> OUTBOX --> PROJ
    PROJ -->|sendMessage| ZALO
    PROJ -->|sendMessage 24h| MSGR
    PROJ -->|SSE push| WEBUI
    PROJ -->|publish whitelist| PUB
    QUEUE --> SERV
    SERV -. read .-> KMS

    style PG fill:#336791,color:#fff
    style PUB fill:#7c3aed,color:#fff
    style MSGR fill:#0084FF,color:#fff
    style ZALO fill:#0068FF,color:#fff
    style SEPAY fill:#2ECC71,color:#fff
```

**Pattern:** Modular monolith. **PostgreSQL + domain model = canonical store**. Mọi surface (chat/web/webhook) gửi **command** → `CMD` bus → `Services` → ghi qua `tenantRepo` (choke-point, RLS). Mỗi thay đổi ghi kèm **outbox** event trong cùng transaction; dispatcher đẩy projectors ra surfaces (Zalo/Messenger/web) + cập nhật `public_sessions`. **Đọc** chia 3 đường: tenant-private (RLS), person-self (person-authorized), public discovery (`DISC` → `public_sessions`, không RLS, field whitelist). API stateless để scale ngang; pg-boss dùng cùng Postgres nhưng chạy bằng worker role tách biệt (§3.4).

### 3.2 Data Model

**Ba vùng (= 3 tầng hiển thị):**
1. **GLOBAL protected directory**: `persons`, `channel_identities`, `player_chat_context`, `sports`. Các bảng identity có PII, không cấp quyền trực tiếp cho API role; chỉ identity service được truy cập và mọi cross-person access phải audit.
2. **TENANT-scoped** (RLS fail-closed): `sessions`, `players`, `memberships`, `channel_reachability`, `charges`, `bank_transactions`, `payment_allocations`, `join_requests`, `outbox_events`, billing… — tiền/roster/nội bộ.
3. **PUBLIC read model** (cross-tenant, **không** RLS, field whitelist): `public_sessions` — projection của kèo đã publish, phục vụ marketplace. **Không** chứa tiền/PII/roster.

```mermaid
erDiagram
    PERSON ||--o{ CHANNEL_IDENTITY : has
    PERSON ||--o{ MEMBERSHIP : "is, per tenant"
    PERSON ||--o{ CHANNEL_REACHABILITY : reachable

    TENANT ||--o{ MEMBERSHIP : contains
    TENANT ||--o{ CHANNEL_REACHABILITY : scopes
    TENANT ||--o{ SESSION : has
    SPORT ||--o{ SESSION : categorizes
    SESSION ||--o| PUBLIC_SESSION : "projected if public"
    SESSION ||--o{ JOIN_REQUEST : "approval-mode"
    TENANT ||--o{ OUTBOX_EVENT : emits
    TENANT ||--o{ PROCESSED_COMMAND : deduplicates
    TENANT ||--o{ CHARGE : bills
    TENANT ||--o{ BANK_TRANSACTION : receives
    TENANT ||--o{ TELEGRAM_LINK : routes
    TENANT ||--o{ TENANT_ADMIN : authorizes
    TENANT ||--o{ ZALO_BOT : "channel (BYO)"
    TENANT ||--o{ BANK_ACCOUNT : receives
    TENANT ||--o| SUBSCRIPTION : billed
    TENANT ||--o{ SUBSCRIPTION_INVOICE : invoices

    MEMBERSHIP ||--o{ PLAYER : "joins session"
    SESSION ||--o{ PLAYER : roster
    PLAYER ||--o{ CHARGE : owes
    BANK_TRANSACTION ||--o{ PAYMENT_ALLOCATION : funds
    CHARGE ||--o{ PAYMENT_ALLOCATION : receives
    OUTBOX_EVENT ||--o{ PROJECTOR_DELIVERY : tracks

    PERSON {
        uuid id PK
        varchar display_name
        varchar phone "nullable, verified"
    }
    CHANNEL_IDENTITY {
        uuid id PK
        uuid person_id FK
        enum platform "zalo|messenger (chat) · google|email|facebook (account)"
        varchar platform_user_id "UNIQUE(platform,uid)"
        varchar username
    }
    CHANNEL_REACHABILITY {
        uuid person_id FK
        uuid tenant_id FK
        enum platform
        bool can_dm
        timestamptz last_inbound_at "UNIQUE(person,tenant,platform)"
    }
    TENANT {
        uuid id PK
        varchar name
        varchar slug UK
        enum status "trialing|active|past_due|suspended|cancelled"
        varchar locale
        varchar timezone
    }
    MEMBERSHIP {
        uuid id PK "= member_id cũ"
        uuid tenant_id FK
        uuid person_id FK
        varchar display_name
        varchar pay_code "UNIQUE(tenant,pay_code)"
    }
    SESSION {
        uuid id PK
        uuid tenant_id FK
        uuid sport_id FK
        timestamptz starts_at
        timestamptz ends_at
        varchar timezone "IANA"
        int price
        int slots_max "nullable"
        varchar area "khu vực (public)"
        varchar venue "địa điểm chi tiết (private tới khi join)"
        varchar skill_level "nullable"
        enum visibility "private|public"
        enum join_policy "open|approval"
        enum status "open|closed|cancelled"
        varchar tg_announce_chat_id
        bigint tg_announce_message_id
    }
    SPORT {
        uuid id PK
        varchar key "badminton|pickleball|tennis|..."
        varchar name
        bool active
    }
    PUBLIC_SESSION {
        uuid session_id PK "= sessions.id"
        uuid tenant_id "chỉ để join-routing, KHÔNG lộ tiền"
        varchar sport_key
        timestamptz starts_at
        timestamptz ends_at
        varchar area
        varchar skill_level
        int price
        int slots_open
        varchar host_display_name
        varchar club_display_name
        enum join_policy
    }
    JOIN_REQUEST {
        uuid id PK
        uuid tenant_id FK
        uuid session_id FK
        uuid person_id
        enum status "pending|approved|rejected|expired"
        timestamptz expires_at
    }
    OUTBOX_EVENT {
        uuid id PK
        uuid tenant_id FK
        varchar type "session.created|player.joined|payment.allocated|payment.settled|..."
        jsonb payload
        timestamptz dispatched_at "nullable"
    }
    PROCESSED_COMMAND {
        uuid tenant_id FK
        uuid command_id
        varchar command_type
        varchar result_hash
        timestamptz created_at "UNIQUE(tenant,command_id)"
    }
    PROJECTOR_DELIVERY {
        uuid event_id FK
        varchar projector
        enum status "pending|delivered|failed"
        int attempts
        timestamptz delivered_at "UNIQUE(event,projector)"
    }
    PLAYER {
        uuid id PK
        uuid tenant_id FK
        uuid session_id FK
        uuid membership_id FK
        timestamptz last_reminded_at
    }
    CHARGE {
        uuid id PK
        uuid tenant_id FK
        uuid session_id FK
        uuid player_id FK
        uuid membership_id FK
        int amount_due
        int amount_allocated
        enum status "open|partial|paid|void"
    }
    BANK_TRANSACTION {
        uuid id PK
        uuid tenant_id FK
        enum provider "sepay|apipay"
        varchar external_id "UNIQUE(tenant,provider,external_id)"
        int amount
        int unallocated_amount
        varchar account_number
        timestamptz occurred_at
        text content
        jsonb raw_payload
        enum reconcile_status "pending|matched|partial|unmatched|ignored"
        timestamptz received_at
    }
    PAYMENT_ALLOCATION {
        uuid id PK
        uuid tenant_id FK
        uuid bank_transaction_id FK "nullable for cash/waiver (auto/manual = có bank txn)"
        uuid charge_id FK
        int amount "signed; reversal âm"
        varchar source "auto|manual|cash|waiver|reversal (DD-40: cash=tiền mặt; CK thủ công khớp bank txn = manual)"
        uuid reverses_allocation_id "nullable"
        uuid created_by "nullable for system"
        timestamptz created_at
    }
    TELEGRAM_LINK {
        uuid tenant_id FK
        varchar chat_id
        enum kind "group|admin"
    }
    TENANT_ADMIN {
        uuid tenant_id FK
        varchar telegram_user_id
        enum role "owner|admin"
    }
    ZALO_BOT {
        uuid id PK
        uuid tenant_id FK
        varchar bot_token_enc
        varchar webhook_token UK
    }
    BANK_ACCOUNT {
        uuid id PK
        uuid tenant_id FK
        varchar account_number
        varchar webhook_token UK
        varchar webhook_secret_enc
    }
    SUBSCRIPTION_INVOICE {
        uuid id PK
        uuid tenant_id FK
        varchar invoice_code UK
        int amount_due
        int amount_paid
        enum status
    }
    SUBSCRIPTION {
        uuid id PK
        uuid tenant_id FK "UNIQUE"
        enum status "trialing|active|past_due|suspended|cancelled"
        timestamptz trial_ends_at
        timestamptz current_period_end
    }
```

#### Bảng tổng hợp

| # | Table | Vùng | RLS | Pha |
|---|---|---|---|---|
| 0 | `sports` | GLOBAL | ❌ (lookup) | P1 |
| 1 | `persons` | GLOBAL | ❌ (directory) | P3.5 |
| 2 | `channel_identities` | GLOBAL | ❌ | P3.5 |
| 3 | `channel_reachability` | TENANT | ✅ | P3.5 |
| 4 | `player_chat_context` | GLOBAL | ❌ | P4.5 |
| 5 | `tenants` | — | n/a | P1 |
| 6 | `accounts` / `memberships(admin)` | — | scoped | P4 |
| 7 | `memberships` | TENANT | ✅ | P3.5 |
| 8 | `sessions` | TENANT | ✅ | P1 |
| 9 | `players` | TENANT | ✅ | P1 |
| 10 | `charges` | TENANT | ✅ | P1/P3 |
| 11 | `aliases` | TENANT | ✅ | P1 |
| 12 | `telegram_links` | TENANT | ✅ | *(legacy — chỉ tenant #1 migration; Telegram đã loại khỏi phạm vi, DD-37)* |
| 13 | `tenant_admins` | TENANT | ✅ | P2 |
| 14 | `zalo_bots` | TENANT | ✅ | P2 |
| 15 | `bank_accounts` | TENANT | ✅ | P3 |
| 16 | `bank_transactions` + `payment_allocations` | TENANT | ✅ | P2/P3 (allocation `source ∈ auto/manual/cash/waiver/reversal`) |
| 17 | `settings` | TENANT `(tenant_id,key)` | ✅ | P1 |
| 18 | `subscriptions` | TENANT | ✅ | P5 |
| 19 | `subscription_invoices` | TENANT | ✅ | P5 |
| 20 | `messenger_pages` | TENANT | ✅ | **P2.5 (phase-1 — `../channels/messenger/messenger-channel-design.md` §4, App Review)** |
| 21 | `join_requests` | TENANT | ✅ | P4.3 (approval-mode join cross-club) |
| 22 | `outbox_events` | TENANT | ✅ | P4 (sync engine — outbox pattern) |
| 23 | **`public_sessions`** | **PUBLIC** | ❌ **(cross-tenant read model, field whitelist)** | P4.3 |
| 24 | `processed_commands` | TENANT | ✅ | P4 (command dedupe) |
| 25 | `projector_deliveries` | WORKER | narrow privileged access | P4 (projector inbox/delivery ledger) |
| 26 | `chat_*` (`chat_channels`/`chat_messages`/`chat_members`) — **scope-committed phase-1 (DD-38 ✅)** | TENANT (club-chat) / person-self (1-1) | ✅ | P4 — schema **chờ migration** (chưa vào canonical), xem doc Draft `../features/feature_inapp_chat.md` |
| 27 | hồ sơ người dùng (`person.gender/dob/username/language`) — **scope-committed phase-1 (DD-39 ✅)** | GLOBAL (PII, consent) | protected | P4 — cột **chờ migration**, xem doc Draft `../features/feature_user_settings.md` |

> **Kênh phase-1 (Messenger):** enum `platform` cho messaging = `'zalo' \| 'messenger'` (`channel_identities`, `channel_reachability`); bảng `messenger_pages` (song song `zalo_bots`, route theo `page_id`) + cột `window_expires_at`/`otn_token_enc` ở `channel_reachability`. Chi tiết delta: `../channels/messenger/messenger-channel-design.md` §4. `telegram_links` giữ lại **chỉ cho migrate tenant #1** (lịch sử), không phải kênh live.

> **Account identities (auth, DD-13):** `account_identities.platform ∈ {google,email,facebook,zalo}`; SI-2 keyed-hash áp cho `google.sub`/email (thay `telegram:id`). Chat/gender schema (`chat_*`, hồ sơ gender/dob): DD-38/DD-39 **scope-committed phase-1** nhưng **schema chưa vào canonical** (migration còn chờ) — nguồn authoritative vẫn là `packages/db/schema.ts` + `packages/db/migrations/*.sql`.

**UNIQUE quan trọng:** `channel_identities (platform, platform_user_id)` GLOBAL · `memberships (tenant_id, person_id)` · `(tenant_id, pay_code)` · `channel_reachability (person_id, tenant_id, platform)` · `players (tenant_id, session_id, membership_id)` · `charges (tenant_id, session_id, player_id)` · `bank_transactions (tenant_id, provider, external_id)` · `processed_commands (tenant_id, command_id)` · `projector_deliveries (event_id, projector)` · `(tenant_id, norm)`, `(tenant_id, alias_norm)`.

**Ledger invariants (DB constraint/transaction test):** `amount_due ≥ 0`; auto/manual bank allocation (đối soát CK tự động, `host_pro`) dương và bắt buộc có `bank_transaction_id`; **mark-paid thủ công tiền mặt `cash` (DD-40, mọi tier)** và `waiver` không có bank transaction nhưng **bắt buộc actor** (host, preview+confirm DD-25), idempotent theo (charge, membership); CK thủ công dùng `source='manual'` (khớp một `bank_transaction`); enum `source` canonical không có `bank_transfer`; reversal âm và tham chiếu allocation gốc. Tổng allocation hiệu lực của một bank transaction nằm trong `[0, bank_transactions.amount]`; tổng vào charge nằm trong `[0, amount_due]`; `unallocated_amount = amount - bank allocations`; charge chỉ `paid` khi được phủ đủ. `amount_allocated` được cập nhật dưới row lock hoặc tính từ ledger, không cho client tự ghi. Không sửa/xoá giao dịch gốc hoặc allocation đã audit—điều chỉnh bằng reversal entry.

### 3.3 Routing & Tenant Resolution (lõi multi-tenant)

```
INBOUND → resolve Tenant theo KÊNH (không từ nội dung):
  • Zalo              : webhook_token (bot-per-club) → zalo_bots → tenant
  • Messenger (P2.5)  : entry[].id (page_id) → messenger_pages → tenant
  • Web (host/admin)  : session Google/email + tenant đang chọn → AUTHZ(TenantAdmin) → tenant
  • SePay/ApiPay      : webhook_token + verify account_number → bank_accounts → tenant
  • (legacy) Telegram : chat_id → telegram_links → tenant #1 migration only (DD-37: out of scope)

THEN identity (nếu là tin nhắn người chơi):
  (platform, platform_user_id) → channel_identities → person   [platform ∈ zalo|messenger]
  → membership = (person ∩ tenant) qua tenantRepo  [RLS]

ĐƯỜNG ĐỌC KHÔNG GẮN 1 TENANT:
  • Discovery (public)  : KHÔNG resolve tenant — đọc public_sessions cross-tenant,
                          field whitelist, KHÔNG RLS, KHÔNG tiền/PII. Rate-limit + phân trang.
  • Person-self (my…)   : person_id từ phiên verify → memberships WHERE person_id=…,
                          ngoài RLS per-tenant, field whitelist (AUDIT C6).
  • Join cross-club     : từ public_session → session_id → tenant (route join) →
                          join_policy=open ⇒ tạo membership guest; =approval ⇒ join_requests.
```

Middleware kênh chat (Zalo/Messenger, rút gọn):

```ts
bot.use(async (ctx, next) => {
  // Zalo: webhook_token trong path → zalo_bots → tenant (bot-per-club)
  // Messenger: entry[].id (page_id) → messenger_pages → tenant (Page-per-club)
  const tenant = await resolveTenantByChannel(ctx);   // theo webhook_token / page_id, KHÔNG từ nội dung
  if (!tenant) return ctx.reply("Chưa nối club...");   // fail-closed
  ctx.tenant = tenant; ctx.repo = tenantRepo(tenant.id); await next();
});
// lớp 2: ADMIN_CMD → isTenantAdmin(tenant.id, ctx.from.id) (AUDIT B-authz)
// Web admin: phiên Google/email → AUTHZ(TenantAdmin)
```

### 3.4 Repository choke-point + RLS

```ts
// 1 nơi DUY NHẤT chèn tenant_id; handler nhận ctx.repo, không tự viết WHERE.
export function tenantRepo(tenantId: string) {
  return {
    getOpenSessions: () => withTenant(tenantId, tx =>
      tx.select().from(sessions).where(eq(sessions.status, "open"))),
    createCharge: (p) => withTenant(tenantId, tx => tx.insert(charges).values({ ...p, tenantId })),
    allocateTransaction: (a) => withTenant(tenantId, tx => allocateWithLedgerInvariants(tx, { ...a, tenantId })),
    // ... port toàn bộ API db.ts cũ, đều khép kín tenantId
  };
}
async function withTenant(tenantId, fn) {
  return dbq.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL app.tenant_id = ${tenantId}`); // RLS context, hết tx tự xoá
    return fn(tx);
  });
}
```

```sql
CREATE ROLE app LOGIN NOSUPERUSER NOBYPASSRLS;            -- app KHÔNG bypass RLS
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions FORCE  ROW LEVEL SECURITY;           -- chặn cả owner bảng
CREATE POLICY tenant_isolation ON sessions
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);  -- missing → NULL → 0 dòng (fail-closed)
-- lặp cho MỌI bảng tenant-scoped
```

**Worker/RLS contract (bắt buộc):** API role `app` không bao giờ quét cross-tenant. Scheduler/dispatcher dùng role riêng `app_worker` chỉ được gọi các stored function hẹp (`claim_outbox_batch`, `list_due_tenant_jobs`) hoặc đọc bảng queue cần thiết; role này không được trả dữ liệu nghiệp vụ ra HTTP. Mỗi job nhận `tenant_id`, mở transaction, `SET LOCAL app.tenant_id`, rồi gọi cùng service/repository như request thường. Claim job dùng `FOR UPDATE SKIP LOCKED`; mọi privileged cross-tenant call ghi audit (`job_id`, `tenant_id`, actor=`system`, reason). Không cấp `BYPASSRLS` chung cho application process.

**Identity/person-self contract:** `persons`, `channel_identities` là global nhưng protected. API role không có `SELECT` trực tiếp; identity service expose query hẹp theo `person_id` đã xác thực. `channel_reachability` là tenant-scoped + RLS. SSE topic `tenant:<id>` yêu cầu TenantAdmin; `person:<id>` phải trùng person trong session/magic-link. Subscription trái phép trả 403 và được audit.

### 3.5 API / Interface

**Convention:** `Response { data, meta? }` · `Error { error, message, code, statusCode }` (JSON, không HTML — NFR-8). Auth web: **Google OAuth / email+password → session** (DD-13); kênh chat mở web qua magic-link do bot phát.

**Webhook (system):**

| Method | Endpoint | Auth | Mô tả |
|---|---|---|---|
| POST | `/webhook/sepay/:token` | `Apikey` secret (timing-safe) + verify account | nhận CK → lưu raw → reconcile |
| POST | `/webhook/zalo/:token` | `X-Bot-Api-Secret-Token` (timing-safe) | update Zalo (bot-per-club) → resolve tenant |
| POST | `/webhook/messenger` | `X-Hub-Signature-256` (app secret, timing-safe) | update Messenger → route theo `page_id` → tenant |

**Auth (web):** `POST /auth/google` (OAuth callback) · `POST /auth/email` (login) · `POST /accounts/:id/link` (link Facebook/Zalo vào Person — DD-33/DD-14).

**Web onboarding (P1/owner):** `POST /tenants` · `POST /tenants/:id/bank` · `POST /tenants/:id/zalo-bot` · `POST /tenants/:id/messenger-page` (FB Login + chọn Page) · `PATCH /tenants/:id/config` · billing: `GET /billing`.

**Host quản lý kèo (tenant-scoped, RLS):** `POST /tenants/:id/sessions` (môn/giá — một mức hoặc giá nam/nữ DD-39/khu vực/slot/visibility/join_policy) · `PATCH /sessions/:id` · `GET /tenants/:id/sessions` · `POST /sessions/:id/mark-paid` (tap/multi-select membership → allocation `source ∈ cash|manual` — DD-40, preview+confirm) · `GET /tenants/:id/join-requests` + `POST /join-requests/:id/approve|reject`.

**Discovery (PUBLIC — không RLS, field whitelist):** `GET /discover?sport=&area=&date=&skill=&price_max=` → `public_sessions` · `GET /discover/sessions/:id` (public detail) · `POST /sessions/:id/join` (open → join; approval → `join_requests`).

**Person-self:** `GET /me/clubs` · `GET /me/sessions` · `GET /me/debts` · `PATCH /me/profile` (gender/dob/name/username/language — DD-39 ✅, cột chờ migration) (person-authorized, field whitelist).

**Chat in-app (DD-38 ✅, scope-committed phase-1; schema chờ migration):** `GET/POST /tenants/:id/chat` (club-wide, tenant RLS) · `GET/POST /me/chat/:peerPersonId` (1-1, person-self); realtime qua SSE.

**Realtime:** `GET /sse?topics=tenant:<id>,person:<id>` (SSE; OD-7).

**Bot commands** = interface người chơi/owner (xem PRD §2 command map).

### 3.6 Logic Flows

**Reconcile CK (P3 — killer flow):**

```mermaid
sequenceDiagram
    participant SePay
    participant API
    participant Repo as tenantRepo
    participant Queue as pg-boss/outbox
    participant Worker
    participant Match as matching(core)
    SePay->>API: POST /webhook/sepay/:token {external_id, amount, content, account}
    API->>API: findBankAccountByToken + timingSafe(secret) + verify account
    API->>Repo: BEGIN; INSERT bank_transaction (idempotent)
    API->>Queue: enqueue reconcile trong cùng DB transaction
    Repo-->>API: COMMIT
    API-->>SePay: 200 {success:true}
    Queue->>Worker: reconcile(tenant_id, bank_transaction_id)
    Worker->>Match: pay_code? → else tên+amount+ngày (tenant-scoped)
    alt match
        Match->>Repo: INSERT payment_allocations (FIFO, không vượt transaction/charge)
        Repo->>Queue: INSERT outbox payment.allocated/payment.settled
    else no match
        Match->>Repo: set reconcile_status=unmatched (retry cron 1h)
    end
```

ACK chỉ xảy ra sau khi raw transaction và durable job đã commit. Duplicate external ID trả 200 với transaction hiện có và không enqueue trùng. Nếu worker chết sau ACK, pg-boss retry idempotently; trạng thái `pending/unmatched` còn tồn tại để sweeper phục hồi.

**Identity merge (P3.5):** `/link` OTP round-trip → gắn ChannelIdentity vào Person → nếu trùng membership cùng tenant → reconcile gộp (1 id, cộng nợ) → audit. (AUDIT C3/C4/C5)

**Reminder cron (P3, auto = `host_pro`):** pg-boss `EVERY_MINUTE` → group theo tenant → mỗi tenant: query unpaid quá ngưỡng (mặc định 2h → 24h → …) → gửi qua **web push + Zalo DM** (chính) + **Messenger best-effort trong cửa sổ 24h** theo `ChannelReachability` → throttler + jitter → set `last_reminded_at`. Free tier: nhắc thủ công.

### 3.7 Background Jobs (pg-boss)

| Queue | Job | Lịch | Mô tả |
|---|---|---|---|
| `reconcile` | `match` | on webhook | match bank transaction → payment allocations |
| `reconcile` | `retry-unmatched` | EVERY_HOUR | thử khớp lại unmatched |
| `remind` | `send` | due/cron | nhắc unpaid theo tenant (auto = `host_pro`; web + Zalo chính, Messenger best-effort 24h) |
| `billing` | `lifecycle` | DAILY | trial→past_due→suspended + nhắc gia hạn (chỉ plan trả phí; bỏ qua `free` price=0) |
| `security` | `webhook-drift` | HOURLY | `getWebhookInfo` Zalo / Messenger Page subscription, lệch URL → alert/auto-reset (AUDIT §B2) |
| `session` | `transition` | EVERY_MIN | auto-close buổi quá giờ + hạ kèo khỏi public khi đóng/quá giờ |
| `sync` | `dispatch-outbox` | on insert / EVERY_SEC | đẩy `outbox_events` chưa `dispatched_at` → projectors (idempotent) |
| `sync` | `reproject` | on demand / retry | dựng lại message/UI/`public_sessions` khi phát hiện lệch |

### 3.8 Sync Engine (canonical store ⇄ surfaces) — *(P4)*

**Nguyên tắc:** **một nguồn sự thật** = canonical store (Postgres). Zalo/Messenger/web là surface phase-1 (Telegram đã loại, DD-37). Không multi-master → không cần conflict-resolution phức tạp.

```
1) WRITE (mọi surface):  surface action  → normalize → Command(commandId)
                         → CMD bus → Service → tenantRepo (RLS) ghi
                         → cùng transaction: INSERT outbox_events  ← outbox pattern
2) DISPATCH:             dispatch-outbox job đọc event chưa gửi → Projectors (fan-out)
3) PROJECT (ra surfaces):
     • Zalo     : sendMessage DM theo ChannelReachability đúng tenant
     • Messenger: sendMessage đúng Page trong cửa sổ 24h (ngoài 24h dồn web + Zalo)
     • Web      : push SSE theo kênh (tenant:<id> / person:<id>) — gồm chat in-app
     • Public   : upsert/delete public_sessions (nếu kèo public)
```

- **Idempotency:** `commandId` có UNIQUE/dedup record (chống double-apply lệnh) + projector inbox/delivery record UNIQUE `(projector,event_id)`. `dispatched_at` chỉ biểu thị dispatcher đã claim/gửi, **không đủ một mình** để chống double-project. Zalo/Messenger không có inline button → roster hiển thị chính ở web + message số/quick-reply, re-project từ canonical thay vì spam message mới.
- **Ordering:** xử lý outbox theo thứ tự per-tenant (hoặc per-session) để roster không "nhảy lùi".
- **Re-projection (chữa lệch):** state surface là *derived*; khi nghi lệch (msg cũ, SSE rớt) → `reproject` dựng lại từ canonical. Surface **không bao giờ** là nơi giữ sự thật.
- **Web realtime:** transport theo OD-7; baseline SSE theo topic `tenant:<id>` và `person:<id>`, bắt buộc authz như §3.4; fallback polling.
- **Phân biệt với module tiền:** webhook CK durable-ingest → worker tạo allocations → phát `payment.allocated`/`payment.settled` → projector chạy `notifyPlayersPaid` + realtime web.

### 3.9 Discovery / Public layer (marketplace) — *(P4.3)*

**Tách hẳn khỏi RLS** — đây là đường đọc cross-tenant **có chủ đích**, nên rủi ro nằm ở *rò rỉ field*, không ở isolation.

- **Publish:** host set `sessions.visibility='public'` → projector upsert `public_sessions` **chỉ field whitelist**: `sport_key, starts_at, area, skill_level, price, slots_open, host_display_name, club_display_name, join_policy`. **KHÔNG** roster, **KHÔNG** STK/PII, **KHÔNG** danh sách người trả/chưa trả. Đóng/huỷ/quá giờ → xoá khỏi `public_sessions`.
- **Đọc (Discovery API):** `GET /discover?sport=&area=&date=&skill=&price_max=` → query **`public_sessions`** (read model), **không** `SET LOCAL app.tenant_id`, **không** đụng bảng tiền. Rate-limit + phân trang chống enumeration/scrape (NFR-S2).
- **Vị trí (privacy, OD-6):** public chỉ hiện **`area`** (quận/khu vực); **`venue`** chi tiết chỉ lộ sau khi join/được duyệt.
- **Join từ marketplace:** `POST /sessions/:id/join` → route `session_id → tenant` → nếu `join_policy=open`: resolve/tạo `Person` + **membership guest** + `addMemberToSession`; nếu `approval`: tạo `join_requests(pending)` → host duyệt (event → projector thông báo player). Slot hết → từ chối.
- **Bất biến public (test CI):** mọi field trong `public_sessions` ∈ whitelist; thử join/đọc không bao giờ trả tiền/PII/roster người khác.

---

## 4. Security

- **Cô lập (NFR-1):** repo choke-point + RLS (ENABLE+FORCE, role `NOBYPASSRLS`, fail-closed). Path **privileged cross-tenant** (merge Person, player-view, discovery) chạy ngoài RLS qua service có audit (AUDIT C4/C6).
- **Worker cross-tenant:** scheduler/dispatcher chỉ dùng narrow DB functions; business job luôn quay lại tenant context (`SET LOCAL`) trước khi đọc/ghi. Không dùng một API role `BYPASSRLS` toàn năng.
- **Public layer (NFR-1b):** `public_sessions` chỉ chứa field whitelist; **tiền/PII/roster không bao giờ ghi vào**. Discovery API read-only, rate-limit, phân trang, không lộ `venue`/SĐT tới khi join/duyệt; chống scrape/enumeration. Bất biến public test trong CI.
- **Sync (NFR-1c):** command/outbox idempotent (`commandId`/`event.id`); canonical store là nơi duy nhất giữ sự thật; surface re-project được — không có ghi 2 chiều multi-master để lệch tiền.
- **Tenant từ kênh, không từ nội dung** (chống spoof) — §3.3.
- **Webhook:** timing-safe verify ×3 (SePay `Apikey` / Zalo `X-Bot-Api-Secret-Token` / Messenger `X-Hub-Signature-256`); lưu raw trước ack; không log secret.
- **Secret:** `bot_token_enc`, `page_token_enc`/app secret, `webhook_secret_enc`, Google OAuth client secret → KMS/envelope AES-GCM; che UI; reset path. Token Zalo/Page lộ → blast-radius messaging 1 club (không chạm tiền/DB/club khác) + `getWebhookInfo`/Page-subscription drift detection (AUDIT §B2).
- **Authz:** routing (ZaloBot/MessengerPage) tách phân quyền (`TenantAdmin` theo `from.id`; web = phiên Google/email); player không gated.
- **Chat in-app (DD-38 ✅):** club-chat scoped `tenant_id` + RLS; 1-1 person-self path; **không bridge** ra kênh ngoài; chống spam/rate-limit.
- **Identity:** claim-có-tiền cần khoá mạnh; merge chỉ verified; mã link = OTP (AUDIT C1/C2/C3).
- **PII:** SĐT/email consent + AES at-rest + soft-delete + không vào URL/log.
- **Realtime/auth:** mọi SSE subscription authorize theo tenant admin hoặc chính person; chống topic guessing, CSRF/session fixation và reconnect token reuse.

---

## 5. Error Handling

`{ error:true, message, code, statusCode }`.

| Module | Code | HTTP | Mô tả |
|---|---|---|---|
| Tenant | `TENANT_NOT_LINKED` | 404 | chat chưa nối tenant |
| Tenant | `TENANT_SUSPENDED` | 403 | quá hạn billing (vẫn lưu CK player) |
| Authz | `NOT_TENANT_ADMIN` | 403 | non-admin chạy lệnh admin |
| Webhook | `INVALID_WEBHOOK_SECRET` | 401 | timing-safe fail |
| Webhook | `ACCOUNT_MISMATCH` | 409 | số TK không khớp |
| Payment | `DUPLICATE_TXN` | 200 | trùng external_id → skip (idempotent) |
| Payment | `UNMATCHED` | — | bank transaction còn tiền chưa allocation, vào `/unmatched` |
| Payment | `ALLOCATION_EXCEEDS_FUNDS` | 409 | tổng allocation vượt số tiền CK hoặc số tiền charge còn thiếu |
| Identity | `CLAIM_REQUIRES_STRONG_KEY` | 409 | claim membership-có-tiền theo tên bị chặn |
| Identity | `MERGE_CONFLICT_SAME_TENANT` | 409 | 2 membership cùng tenant → cần reconcile |
| Identity | `LINK_CODE_INVALID` | 400 | OTP sai/hết hạn |
| Discovery | `SESSION_NOT_PUBLIC` | 404 | kèo không publish / đã hạ khỏi marketplace |
| Join | `JOIN_REQUIRES_APPROVAL` | 202 | đã tạo `join_requests` chờ host duyệt |
| Join | `REJOIN_REQUIRES_REVIEW` | 409 | existing player đã `left`; không tự reuse/duplicate charge/ledger |
| Sync | `STALE_COMMAND` | 409 | command trùng/đã áp (idempotent) → bỏ qua |

---

## 6. Testing Plan

### 6.1 Unit (core thuần — lift + test xanh trước)
matching (pay_code/tên/amount/ngày, FIFO 2-buổi-identical), ledger allocation (partial/overpay/multi-person/reversal, BL-2), **mark-paid thủ công (cash tiền mặt / manual CK khớp bank txn, idempotent) — DD-40**, identity-resolve, Zalo number-reply parse / Messenger quick-reply parse, dedupe external_id, link-code OTP.

### 6.2 Integration (Postgres)
- **Bất biến cô lập (CI bắt buộc):** tenant A/B — repo B không thấy session A; raw query quên `SET LOCAL` → 0 dòng (fail-closed).
- **Bất biến public (CI bắt buộc):** mọi field `public_sessions` ∈ whitelist; discovery/join không bao giờ trả tiền/PII/roster người khác; kèo private không xuất hiện trong discovery.
- **Sync (CI):** tạo kèo trên web → outbox phát event → projector gửi Zalo/Messenger + upsert public_sessions + SSE; áp lại cùng command/event → **không** double; re-project dựng đúng từ canonical.
- **Worker/RLS (CI):** API role không scan được cross-tenant; worker claim đúng batch nhưng từng job chỉ thấy tenant được `SET LOCAL`; privileged call có audit.
- **Ledger (CI):** một CK phân bổ nhiều charge/người; partial không mark paid; over-allocation bị chặn; **mark-paid thủ công tiền mặt `cash`** yêu cầu actor và không tạo bank transaction giả; CK thủ công dùng `source='manual'` khớp một `bank_transaction`; duplicate/retry/reversal giữ đúng tổng.
- **Chat (CI, DD-38 ✅):** club-chat không rò cross-tenant; 1-1 chỉ 2 person đọc được; không xuất hiện ở kênh ngoài.
- E2E đa surface: host tạo kèo (web) → hiện ở Zalo/Messenger + marketplace; player join (Zalo number-reply / Messenger quick-reply) → roster web cập nhật; join cross-club open/approval đúng.
- E2E tiền: join → **mark-paid thủ công** hoặc CK (curl SePay) → notify + SSE; webhook trùng → idempotent 1 lần.
- Merge: 2 Person có membership cùng tenant → reconcile gộp nợ.
- Suspended tenant: chặn lệnh quản trị nhưng vẫn durable-ingest CK; kèo public hiện có tự hạ khi đóng/hết giờ và không tạo/gia hạn mới.
- Routing: 2 token khác nhau → 2 club; sai token/secret/account → từ chối.

### 6.3 Load
webhook burst (≤5s P99), cron 1k tenant (throttler), join đồng thời (race).

---

## 7. Deployment & Infra

| Env | DB | Queue | Monitoring | Payment |
|---|---|---|---|---|
| dev | Postgres local (docker) | pg-boss local | verbose | mock |
| staging | Postgres managed | pg-boss | Sentry | sandbox |
| prod | Postgres managed (HA, PITR) | pg-boss | Sentry + metrics (log gắn `tenant_id`) | live |

Monorepo pnpm: `packages/core` (logic thuần + test, gồm `sports`) · `apps/bot` (HTTP channel adapters + cron + projectors) · `apps/web` (Next.js App Router: host dashboard, player view, discovery UI, API routes + realtime). **PostgreSQL/domain services là canonical**, không phải UI app. Bỏ volume SQLite. **DD-04 ✅ (2026-07-16) — (c) co-locate DigitalOcean:** compute = **DO App Platform** (thay Fly), DB = **DO Managed PG HA-standby cùng VPC private**, Singapore. Fly = fallback (a); pre-build gate = egress-IP verify (§7.1). Chi tiết `../dd-04-hosting-final-decision.md`.

---

## 8. Migration Plan

```
# P0–P1
drizzle: 01_tenants_rls → 02_sessions_players_charges(tenant_id) → 03_settings
# P3.5
04_identity_directory (persons, channel_identities, reachability, player_chat_context)
05_memberships (refactor members → membership(person_id))
# P2 / P2.5 / P3 / P5
06_bank_accounts_transactions_allocations · 07_zalo_bots · 07b_messenger_pages · 08_subscription_invoices
# P4
09_processed_commands_outbox_projector_deliveries · 10_public_sessions_projection · 11_chat (DD-38 ✅, migration còn chờ) · 12_person_profile_gender (DD-39 ✅, migration còn chờ)
```

**Migrate club hiện tại → tenant #1:** script đọc `data/bot.db` (SQLite của bot Telegram cũ — bằng chứng lịch sử) → tạo tenant "Bestminton" + Account owner (Google/email) + BankAccount → copy sessions/players/members/aliases gắn `tenant_id` → mỗi player-session tạo `charge`; payment lịch sử có giao dịch gốc thì import thành `bank_transaction` + `payment_allocation`, record thiếu bằng chứng gốc dùng synthetic `legacy:<source-id>` và `source=manual` để giữ provenance. Đối chiếu tổng charge/allocated/unallocated và số roster trước cutover; **go-forward CLB link Zalo + Facebook Messenger** (bot Telegram cũ đóng băng làm reference, DD-37).

---

## 9. Dependencies

| Package/Service | Mục đích |
|---|---|
| HTTP clients/adapters cho Zalo Bot API + Messenger Send/Webhook | kênh phase-1; không phụ thuộc grammY/Telegram |
| `drizzle-orm` + `pg` | ORM + Postgres |
| `pg-boss` | queue/cron trên Postgres |
| `express` | HTTP + webhook endpoints |
| throttler (rate-limit) | rate-limit outbound Zalo/Messenger |
| VietQR lib (`img.vietqr.io`) | QR P4 |
| Next.js App Router (standalone/container) | web (DD-10 ✅) |
| KMS / secret manager | mã hoá token/secret |
| Google Identity (OAuth) | đăng nhập Google + định danh (DD-13) |
| SePay / ApiPay | đối soát CK |
| Zalo Bot Platform | kênh Zalo (bot-per-club) |
| Meta Messenger Platform | kênh Messenger (**phase-1, P2.5**) — Graph API gửi tin, webhook `page_id`, cửa sổ 24h, App Review |

---

## 10. Risk Registry (kỹ thuật)

> Chi tiết threat model: `../research/player-side-saas-AUDIT.md`. Đây là các rủi ro phá vỡ hệ thống tài chính/đa-tenant.

### 10.1 Cô lập cross-tenant (nghiêm trọng nhất)
RLS sai/quên scope → CLB thấy tiền CLB khác. **Mitigation:** repo choke-point (hàm global không tồn tại → quên scope = không compile) + RLS ENABLE+FORCE+`NOBYPASSRLS`+fail-closed + **test bất biến CI**.

### 10.2 Identity — gán nhầm tiền / merge conflict (AUDIT C1/C2/C4/C5)
- `canDm` sai tầng (global) → confirm Zalo gửi nhầm/fail → **`ChannelReachability` per (person,tenant,platform)**.
- Claim membership-có-tiền theo tên → chiếm nợ → **cấm auto, cần khoá mạnh**.
- Merge 2 Person có membership cùng tenant → vỡ `UNIQUE` → **reconcile gộp 1 membership**.
- Membership trùng do race → **cờ nghi-trùng + tool owner merge**.

### 10.3 Webhook concurrency & idempotency (AUDIT)
2 webhook cùng `external_id` → double-count → `UNIQUE(tenant,provider,external_id)` + `ON CONFLICT DO NOTHING` + check `matched=false`. Thiếu id → synthetic sha256. Lưu raw **trước** ack; return 200 cả khi trùng.

### 10.4 Token Zalo lộ (AUDIT §B2)
Mạo danh bot (QR giả) / cướp webhook (MITM+DoS). **Mitigation:** KMS + không log + **`getWebhookInfo`-drift detection** + rotation/re-paste. Blast-radius gói trong messaging 1 club.

### 10.5 Scope drift theo pha
P3 phát hành memo **name-based**; matcher có thể chuẩn bị nhánh `pay_code` nullable nhưng chưa phụ thuộc vào nó. `pay_code`/VietQR chỉ được phát cho player từ P4; không dùng memo chỉ-có-code trước khi rollout + migration + test nhánh này hoàn tất.

---

## 11. Open Questions

> ⭐ **Nguồn canonical:** xem `../standards/decisions.md` (gồm DD-37/13/33/38/39/40). Bảng dưới giữ để tra nhanh; khi chốt, cập nhật ở `decisions.md`.

| # | Question | Status |
|---|---|---|
| 1 | Web stack = Next.js App Router, standalone/container; không Vercel | ✅ (→ DD-10) |
| 2 | Postgres host — HA+PITR+Singapore ✅; ✅ **(c) co-locate DigitalOcean** (App Platform + Managed PG, VPC private); Fly = fallback; egress-IP gate | ✅ (→ DD-04) |
| 3 | `pay_code` contract: suffix trần 4 ký tự + prefix namespace; resolver own/foreign/none; allocation invariant | ✅ chốt (→ DD-02) |
| 4 | Con số trial/past_due/suspended | đề xuất 14/7 ngày; pricing đã chốt ở DD-29, còn lifecycle timing |
| 5 | Zalo Premium (khi owner >3 CLB/tài khoản) + add-on managed | hỏi Zalo |
| 6 | Thu SĐT verified làm khoá merge | ✅ chốt |
| 7 | Web realtime: SSE + fan-out `LISTEN/NOTIFY` (dùng chung sync + chat) | ✅ chốt (→ DD-07) |
| 8 | Join cross-club mặc định: open vs approval | ✅ per-kèo, mặc định open; approval re-check trong tx (→ DD-05) |
| 9 | Độ chi tiết vị trí public: area vs venue | ✅ public area-only; venue sau active join/approval (→ DD-06) |
| 10 | Public read model = bảng `public_sessions` cập nhật qua projector | ✅ (→ DD-12; bảng đã có, projector implementation pending) |
| 11 | Danh sách môn khởi điểm + taxonomy trình độ | ✅ 7 môn seed extensible + level rank 5 bậc (→ DD-08) |
| 12 | Chat in-app schema (`chat_*`) | ✅ DD-38 scope-committed phase-1; schema chờ migration; tái dùng SSE (DD-07), RLS tenant + person-self |
| 13 | Giá theo giới tính (giá nam/nữ; `person.gender`) | ✅ DD-39 scope-committed phase-1; cột chờ migration; PII consent, không lộ public |
| 14 | Messenger App Review timeline (chặn GA phase-1) | rủi ro DD-37; degrade sang web + Zalo |

---

## Tham chiếu

| # | Tài liệu | Vai trò |
|---|---|---|
| 1 | `BRD.md` | Yêu cầu nghiệp vụ |
| 2 | `PRD.md` | User flows + edge cases |
| 3 | `../strategy/saas-implementation-plan.md` | Kiến trúc multi-tenant |
| 4 | `../research/player-side-saas-reconciliation.md` | Identity/kênh/matching |
| 5 | `../research/player-side-saas-AUDIT.md` | Threat model & must-fix (+ public discovery) |
| 6 | `../channels/messenger/messenger-channel-design.md` | Kênh Messenger (phase-1, P2.5) |
| 7 | `../standards/decisions.md` | Decision log — DD-37/13/33/38/39/40 |

---

*TDD v2.5 — implementation contract cho platform đa môn + marketplace + sync engine; kênh phase-1 = web + Zalo + Messenger (Telegram đã loại, DD-37). Join full → waitlisted/no-charge, promotion mới tạo charge (DD-45). Bốn bất biến: cô lập tenant (gồm chat) · không lộ tiền/PII/giới tính ra public · ledger không mất/đếm quá tiền · PostgreSQL/domain model là nguồn sự thật.*

---

## Changelog

| Ngày | Version | Thay đổi |
|------|---------|----------|
| 15/07/2026 | v2.4 | **Propagation (light):** mở rộng tham chiếu decisions.md sang cụm session-model + social (DD-06/08/41/42/43/44/46/47/48). Contract build P2–P4+, giữ 4 bất biến (tenant isolation/không lộ tiền-PII-tag public/ledger đúng/domain-model là nguồn sự thật). Schema/DDL + implementation contract chi tiết viết cùng build slice (không đổi §3 canonical schema body ở pass này). |
| 16/07/2026 | v2.5 | **DD-04 ✅ Accepted:** Postgres host = **(c) co-locate DigitalOcean** (App Platform + Managed PG VPC private); runtime summary + Q2 → (c). Fly = fallback; egress-IP gate; full DO App Spec = infra slice. Record `../dd-04-hosting-final-decision.md`. |
| 15/07/2026 | v2.3 | **DD-45:** retire `SESSION_FULL` cho joinable session; full→waitlisted/no-charge/no-venue, approval full cùng outcome; add `REJOIN_REQUIRES_REVIEW` fail-closed money guard. |
| 10/07/2026 | v2.2 (review fixes) | **Money vocab → canonical ledger:** FR-7b + ER diagram + bảng tổng hợp + ledger invariants + API + testing — mark-paid = INSERT `payment_allocations` (cash/manual) + cập nhật `charges`; bỏ bảng `payment` & source `bank_transfer` (enum canonical `auto/manual/cash/waiver/reversal`); CK host tự xác nhận chưa có bank_txn = impl còn mở. **DD-38/39 ✅ scope-committed phase-1** (FR-19/20, bảng §3.2 row 26/27, §3.5, §8, open questions) — schema `chat_*`/`person.gender` chờ migration (không claim done). Đồng bộ `decisions.md` v1.16. |
| 16/06/2026 | v2.0 | Initial TDD — canonical store, multi-tenant, RLS, sync engine |
| 18/06/2026 | v2.1 | Chuẩn hoá ledger, durable webhook, discovery schema |
| 19/06/2026 | v2.1 | Thêm Changelog table |
| 10/07/2026 | v2.2 | **v3.4 channel pivot: drop Telegram, Messenger + Zalo phase-1 + Google login/chat/gender-pricing/manual mark-paid — DD-37/13/33/38/39/40.** §1 scope + phase table (Messenger P4.8→P2.5); §2 FR table (FR-1 Google auth, FR-3 Messenger join, FR-7b mark-paid thủ công DD-40, FR-19 chat 🟡, FR-20 gender 🟡); §3.1 architecture (bỏ Telegram surface/webhook, thêm Messenger); §3.2 data model (platform enum zalo\|messenger + account google/email/facebook/zalo; `telegram_links` legacy; `messenger_pages` phase-1; chat/gender proposal); §3.3 routing (bỏ Telegram, Zalo webhook_token/Messenger page_id); §3.5 API (Google auth, mark-paid, chat, profile endpoints); §3.6–3.8 reminder/jobs/sync (web+Zalo chính, Messenger 24h); §4 security; §6 testing; §8 migration; §9 deps (Google Identity, Messenger phase-1). Chat/gender schema chỉ ở mức proposal (DD-38/DD-39) — không đụng canonical `packages/db/schema.ts`. |
