# Feature: Tournament (Giải đấu) — Backend Tech Spec

> **Canonical phase:** P4+ (sau session core)
> **Version:** 0.3 · 2026-08-10
> **Status:** Draft *(chưa qua readiness gate — KHÔNG phải Reviewed contract)*
> **Implementation:** Not started
> **Product spec:** `../FE/feature_tournament.md`
> **References:** `../../standards/decisions.md` DD-82 · DD-83 · DD-73/DD-75 · DD-12 · DD-06 · DD-41 · `../../standards/business-rules.md` (HR2, BL-SEC-5) · `../../standards/api-reference-convention.md` (DD-60 envelope)

---

## Changelog

| Date | Version | Thay đổi |
|---|---|---|
| 2026-08-10 | v0.3 | **A-grade upgrade:** thêm Entry points table (7 entries); bump version. Không đổi contract/tournament model. |
| 2026-07-24 | v0.2a | **De-pin migration-tail** (docs-migration-tail-0018-to-0020-sweep): §Migration&Rollback baseline note hard-pinned `baseline main = 0000–0018` → non-pinned "verify tail hiện hành tại `packages/db/migrations/` trước khi build, không hard-pin số" (live tail nay `0020`; `0019`/`0020` tenant-integrity FKs DD-68). Auth lane `0015`–`0018` citation giữ nguyên. Pre-existing dated changelog giữ verbatim. Không đổi contract. |
| 2026-07-23 | v0.2 | **Reconcile migration-tail 0018:** current-state §2 migration baseline sửa `baseline main = 0000–0014; 0015 in-flight chưa merge` → `0000–0018` (0014 waitlist schema-only; lane auth DD-80 `0015`–`0018` đã merge nhưng ⛔ chưa enable). Numbering guidance giữ nguyên (số next-available monotonic sau synced tail, verify live `packages/db/migrations/` trước khi tạo, không hardcode). Pre-existing dated changelog giữ verbatim. Không đổi contract. |
| 2026-07-21 | v0.1 | Khởi tạo từ DD-82. Data model aggregate độc lập (`tournaments` + `tournament_registrations` tenant-scoped/RLS + `public_tournaments` read model whitelist). v1 không đụng tiền; bracket/standings/entry-fee = slice sau. Draft, chưa readiness gate — DDL là **contract cần build**, chưa migrate. |

---

## 1. Tổng quan triển khai

Tournament là **aggregate độc lập** hang off `tenants` (không hang off `sessions`). Theo canonical store pattern của Plexco:

```text
Host/Player command → TournamentService → tenantRepo (choke-point, RLS)
  → ghi tournaments/tournament_registrations + Outbox event (cùng tx)
  → Projector public_tournaments (field-whitelist) → URL share /tournament/<slug> (DD-83, guarded view DD-12)
```

**Design decisions:**

- **Không tái dùng `sessions`/`players`.** `players.session_id` là FK cứng tới `sessions`; ép tournament vào đó sẽ trộn hai khái niệm. Tournament có bảng đăng ký riêng key theo `person_id` (global), qua `tenantRepo`.
- **v1 không đụng tiền.** Đăng ký **không** tạo `charges`/`payment_allocations`. Entry-fee (mô hình tiền riêng) deferred — giữ đường tiền sạch, không mở blast radius sang ledger.
- **Public qua read model, không canonical.** `public_tournaments` mirror pattern `public_sessions` (`id = tournaments.id`, `tenant_id` internal-only, field-whitelist, `projected_at`/`expires_at`), projector-owned. Guarded view (DD-12) đọc read model, không đọc canonical.
- **Retire `session_type='tournament'`** — coordinate DD-41 (xem §2 Migration; live schema **hiện chưa có** cột `session_type`).

### Entry points

| Entry | Caller | Mô tả |
|-------|--------|-------|
| `POST /api/tournaments` | Host (web) | Create tournament (tenant-scoped, RLS) |
| `PATCH /api/tournaments/:id` | Host | Update tournament details |
| `POST /api/tournaments/:id/publish` | Host | Publish → open registration |
| `POST /api/tournaments/:id/register` | Player (web) | Register person (v1 no payment) |
| `DELETE /api/tournaments/:id/register` | Player | Cancel own registration |
| `GET /api/public/tournaments/:slug` | Anonymous | Guarded view via `public_tournaments` read model (DD-12/DD-83) |
| Projector `public_tournaments` | Outbox consumer | Field-whitelist projection |

> **Gate 3 chiều (trước khi Reviewed):** mọi claim (tên bảng/cột, CHECK, index, độ dài slug) phải khớp cả ba: (a) bảng/claim trong spec ↔ (b) snippet DDL trong spec ↔ (c) live code/schema trên `main`. Hiện chưa migrate ⇒ (c) = "chưa tồn tại"; khi build phải re-verify với `packages/db/schema.ts` + migrations.

---

## 2. Database Schema + Edge Cases (BE)

### Schema

> ⚠️ **Đối chiếu live schema (2026-07-21):** `tournaments`/`tournament_registrations`/`public_tournaments` **chưa tồn tại** trong `packages/db/schema.ts` hay migrations. `session_type` và chuỗi `tournament` **không xuất hiện** ở đâu trong `packages/db` — nên "retire `session_type='tournament'`" là việc **coordinate với DD-41 (chưa migrate)**, KHÔNG phải backfill dữ liệu live. DDL dưới đây là contract cần build.

```sql
-- Canonical: tournaments (tenant-private, RLS)
CREATE TABLE tournaments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  sport_id uuid NOT NULL REFERENCES sports(id),
  title text NOT NULL,
  notes text,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  timezone text NOT NULL,
  venue_name text,            -- lộ cho registered/authenticated, KHÔNG public
  venue_address text,         -- KHÔNG public
  area text,                  -- chỉ field ra public (DD-06)
  slots_max integer,
  status text NOT NULL DEFAULT 'draft',
  registration_status text NOT NULL DEFAULT 'closed',   -- đăng ký đang mở/đóng (trục thời điểm)
  registration_policy text NOT NULL DEFAULT 'members_only', -- AI được đăng ký (TRN-OQ-1, host config)
  slug text,                  -- opaque slug (DD-83); cấp khi publish; NULL khi draft
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tournaments_time_chk    CHECK (ends_at > starts_at),
  CONSTRAINT tournaments_slots_chk   CHECK (slots_max IS NULL OR slots_max > 0),
  CONSTRAINT tournaments_status_chk  CHECK (status IN ('draft','published','completed','cancelled')),
  CONSTRAINT tournaments_regstat_chk CHECK (registration_status IN ('closed','open')),
  -- TRN-OQ-1 (owner 2026-07-21): host chọn 1 trong 3 chế độ đăng ký.
  -- members_only = chỉ member cùng tenant; approval = bất kỳ ai, host duyệt; anyone = bất kỳ user Plexco tự đăng ký.
  CONSTRAINT tournaments_regpolicy_chk CHECK (registration_policy IN ('members_only','approval','anyone'))
);

-- Đăng ký tham gia (tenant-private, RLS). v1 KHÔNG có cột tiền.
CREATE TABLE tournament_registrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  tournament_id uuid NOT NULL REFERENCES tournaments(id),
  person_id uuid NOT NULL REFERENCES persons(id),
  status text NOT NULL DEFAULT 'registered',
  registered_at timestamptz NOT NULL DEFAULT now(),
  decided_by uuid REFERENCES persons(id),   -- host duyệt (chỉ chế độ approval)
  decided_at timestamptz,
  withdrawn_at timestamptz,
  command_id text,            -- idempotency (giống join_requests.command_id)
  -- 'pending' chỉ dùng cho registration_policy='approval' (chờ host duyệt);
  -- members_only/anyone đi thẳng 'registered'. 'rejected' = host từ chối.
  CONSTRAINT tr_status_chk CHECK (status IN ('pending','registered','withdrawn','rejected'))
);
-- Idempotency + chống đăng ký trùng: một person một tournament một "active" row.
-- Active = đang chiếm chỗ hoặc chờ duyệt (pending|registered).
CREATE UNIQUE INDEX tournament_reg_active_uq
  ON tournament_registrations (tournament_id, person_id)
  WHERE status IN ('pending','registered');

-- Public read model (field-whitelist, KHÔNG money/PII, KHÔNG serialize tenant_id).
-- Mirror pattern public_sessions (schema.ts:603).
CREATE TABLE public_tournaments (
  id uuid PRIMARY KEY,                 -- = tournaments.id
  tournament_id uuid NOT NULL,
  tenant_id uuid NOT NULL,             -- internal routing only — NEVER serialized
  slug text NOT NULL,                  -- opaque (DD-83)
  sport_key text NOT NULL,
  title text NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  area text NOT NULL,                  -- area-only (DD-06); no venue
  slots_max integer,
  slots_open integer NOT NULL,         -- projected remaining (mirror public_sessions.slots_open); no roster
  registration_status text NOT NULL,
  club_display_name text NOT NULL,
  host_display_name text,
  status text NOT NULL,
  projected_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE UNIQUE INDEX idx_public_tournaments_slug ON public_tournaments (slug);
```

> All canonical tables tenant-scoped + `ENABLE` + `FORCE ROW LEVEL SECURITY` dùng `app.tenant_id`, policy theo grant matrix (giống `sessions`/`players` trong migration `0002`/`0009`). `public_tournaments` KHÔNG RLS (cross-tenant read model) nhưng **field-whitelist** cưỡng chế bằng cột — không có cột tiền/PII để lộ. `tenant_id` chỉ để projector/route, **không** nằm trong bất kỳ serializer public nào (test bất biến CI).

### Indexes

- `tournaments`: `(tenant_id, status)`; `(starts_at)` partial `WHERE status='published'`; unique `(tenant_id, slug) WHERE slug IS NOT NULL`.
- `tournament_registrations`: partial unique `(tournament_id, person_id) WHERE status='registered'`; `(tournament_id)` cho đếm slot.
- `public_tournaments`: unique `(slug)`; `(sport_key, starts_at)`; `(area, starts_at)`.

### Migration & Rollback

- **Migration:** `packages/db/migrations/{NNNN}_tournament.sql` — **monotonic, file mới, số next-available tại build time** (baseline committed trên `main` gồm `0014_players_waitlist` waitlist schema-only và lane auth DD-80 `0015`–`0018` **đã merge** nhưng ⛔ **chưa enable** — verify tail hiện hành tại `packages/db/migrations/` trước khi build, **không** hardcode số, chọn số kế tiếp chưa dùng tại build sau khi sync `main`). **Verify với live `packages/db/migrations/` ngay trước khi tạo file** (source-of-truth khi conflict = migrations trên `main`, không phải prose HANDOFF). Chứa CREATE TABLE + ENABLE/FORCE RLS + policies + grants (role `app` NOBYPASSRLS) + projector function/trigger cho `public_tournaments`.
- **Retire `session_type='tournament'` (coordinate DD-41):** DD-41 định nghĩa `session_type` (chưa migrate). Hai nhánh:
  - **(a) DD-41 chưa ship `session_type`** (hiện trạng — không có cột trong `packages/db`): chỉ cần **loại giá trị `'tournament'`** khỏi enum/CHECK của DD-41 khi nó được migrate. Không có dữ liệu để backfill.
  - **(b) DD-41 đã ship `session_type` gồm `'tournament'`:** migration backfill chuyển các session `session_type='tournament'` sang aggregate `tournaments` (hoặc mark, tuỳ policy owner), rồi thắt CHECK bỏ `'tournament'`. **KHÔNG** gọi là "no breakage".
  - Sequencing này là **hard dependency** của DD-82 với DD-41 — chốt ở readiness gate trước build.

| Bước | Hành động | An toàn? |
|------|-----------|----------|
| 1 | Disable route `/api/tournaments*` + projector | ✅ |
| 2 | `DROP TABLE public_tournaments; DROP TABLE tournament_registrations; DROP TABLE tournaments;` (revert migration mới) | ✅ pre-GA (chưa có dữ liệu thật) |
| 3 | Nếu đã coordinate DD-41 (b): revert backfill cần plan riêng | ⚠️ mất mapping nếu đã xoá session gốc — v1 khuyến nghị không xoá session gốc |

### Edge Cases (Backend)

| # | Category | Case | Xử lý |
|---|----------|------|-------|
| 1 | Concurrency | Hai đăng ký slot cuối | Đếm `status='registered'` dưới `SELECT ... FOR UPDATE` trên tournament row; chỉ một thắng, người kia `TOURNAMENT_FULL` |
| 2 | Concurrency | Đóng đăng ký ⟂ đăng ký | Re-check `registration_status='open'` trong cùng tx; đóng thắng → `REGISTRATION_CLOSED` |
| 3 | Concurrency | Đăng ký trùng đồng thời | Partial unique `(tournament_id,person_id) WHERE status='registered'` là fence cuối; lần 2 trả trạng thái hiện tại (idempotent qua `command_id`) |
| 4 | Security | Query `tournaments` không qua `tenantRepo` | RLS fail-closed; role `app` NOBYPASSRLS. Ref: HR1 |
| 5 | Security | Serialize `tenant_id`/venue/PII ra public | Serializer public chỉ đọc `public_tournaments` whitelist; CI invariant test cấm cột tiền/PII/`tenant_id`. Ref: HR2/BI-TRN-2 |
| 6 | Security | Guest publish/sửa giải người khác | Authz per-resource qua RLS + service check (chỉ host/co-admin có capability). Ref: DD-56 |
| 7 | Data Integrity | Publish thiếu field bắt buộc | Validate (sport/starts_at/ends_at/area) trước khi `status='published'` + cấp slug |
| 8 | Data Integrity | `ends_at <= starts_at` | CHECK `tournaments_time_chk` từ chối |
| 9 | Data Integrity | Rút rồi đăng ký lại | Partial unique chỉ chặn active row; withdrawn không chặn re-register; không double-count slot |
| 10 | Cross-Feature | Slug đổi tên | Registry DD-83 tombstone slug cũ; `public_tournaments.slug` cập nhật; link cũ resolve tombstone → redirect/410 |
| 11 | Cross-Feature | DD-41 `session_type='tournament'` | Coordinate migration (§2); giá trị này retire, không tồn tại song song |
| 12 | Infra | Projector chậm/lỗi sau publish | Outbox retry idempotent; `public_tournaments` upsert theo `id`; `expires_at` để dọn stale |
| 13 | Infra | Guarded view đọc canonical thay read model | Cấm — view chỉ đọc `public_tournaments` (DD-12); test bất biến |
| 14 | Data Integrity | Huỷ giải đã có đăng ký | `status='cancelled'`; đăng ký giữ lịch sử (audit) nhưng vô hiệu; public card đánh dấu huỷ/gỡ |

> Minimum 12 edge cases, 5 categories — đây là floor chống lười. v1 low-money (không đụng tiền) nên không cần decision table tiền; nếu entry-fee slice sau vào thì nâng risk class + decision table.

---

## 3. API Contract

### Endpoints

| Method | Path | Auth | Mô tả |
|--------|------|------|-------|
| POST | /api/tournaments | Host (capability) | Tạo giải (`draft`) |
| PATCH | /api/tournaments/:id | Host | Sửa thông tin (khi chưa completed/cancelled) |
| POST | /api/tournaments/:id/publish | Host | Publish → cấp slug + project public |
| POST | /api/tournaments/:id/registration | Host | Mở/đóng đăng ký (`{status:'open'|'closed'}`) |
| POST | /api/tournaments/:id/complete | Host | Kết thúc giải |
| POST | /api/tournaments/:id/cancel | Host | Huỷ giải |
| GET | /api/tournaments/:id/registrations | Host | Roster đăng ký (RLS, không public) |
| POST | /api/tournaments/:id/register | Player (auth) | Đăng ký tham gia |
| POST | /api/tournaments/:id/withdraw | Player (auth) | Rút đăng ký |
| GET | /api/me/tournaments | Player (auth) | Giải mình đã đăng ký (person-self) |
| GET | /tournament/:slug | Public (guarded) | Trang public (đọc `public_tournaments`) |

### Request/Response Examples

> Envelope chuẩn DD-60 (`../../standards/api-reference-convention.md`, khớp `apps/web/lib/api-envelope.ts`). Field name minh hoạ; chốt ở build slice trừ khi invariant đã pin.

**POST `/api/tournaments/:id/register`** — `200`:

```json
{ "data": { "registrationId": "reg_...", "status": "registered", "slotsRemaining": 7 }, "error": null, "meta": { "requestId": "req_..." } }
```

— `409` (full):

```json
{ "data": null, "error": { "code": "TOURNAMENT_FULL", "message": "Giải đấu đã đủ số lượng đăng ký.", "statusCode": 409 }, "meta": { "requestId": "req_..." } }
```

**GET `/tournament/:slug`** — `200` (public whitelist, KHÔNG tenant_id/venue/tiền):

```json
{ "data": { "title": "Giải cầu lông mở rộng T7", "sportKey": "badminton", "startsAt": "2026-08-15T01:00:00Z", "area": "Quận Cầu Giấy", "slotsMax": 16, "slotsOpen": 12, "registrationStatus": "open", "clubDisplayName": "CLB Bestminton", "status": "published" }, "error": null, "meta": { "requestId": "req_..." } }
```

### Rate Limits

> Xem `../../standards/business-rules.md` BL-SEC-5 Rate Limit Registry.

| Endpoint | Limit |
|----------|-------|
| POST /api/tournaments | ~10 per giờ per tenant |
| POST /api/tournaments/:id/register | ~20 per giờ per person |
| GET /tournament/:slug | public read — CDN/cache, rate-limit theo IP |

### Error Codes

| Code | Error Code | Message (tiếng Việt) | Trigger |
|------|-----------|---------|---------|
| 409 | `TOURNAMENT_FULL` | Giải đấu đã đủ số lượng đăng ký. | Đăng ký khi đủ `slots_max` |
| 409 | `REGISTRATION_CLOSED` | Giải đấu hiện không mở đăng ký. | Đăng ký khi `registration_status='closed'` |
| 400 | `TOURNAMENT_INVALID_TIME` | Thời gian kết thúc phải sau thời gian bắt đầu. | `ends_at <= starts_at` |
| 400 | `TOURNAMENT_PUBLISH_INCOMPLETE` | Thiếu thông tin bắt buộc để công bố giải. | Publish thiếu field |
| 403 | `TOURNAMENT_FORBIDDEN` | Bạn không có quyền thao tác giải đấu này. | Authz/RLS fail |
| 404 | `TOURNAMENT_NOT_FOUND` | Không tìm thấy giải đấu. | Slug tombstoned/không tồn tại |

> Catalog dùng chung FE (Product §3 Error state). Không tự chế bảng riêng.

### Idempotency

| Endpoint | Idempotent? | Key |
|----------|-------------|-----|
| POST /api/tournaments/:id/register | ✅ | `command_id` + partial unique `(tournament_id,person_id) WHERE status='registered'` |
| POST /api/tournaments/:id/publish | ✅ | State transition (`draft`→`published`) idempotent; replay trả trạng thái hiện tại |
| POST /api/tournaments | ⬜ | `command_id` (chốt ở build) |

---

## 4. Chi tiết triển khai

### State machine

Ref Product §4. `status: draft → published → completed|cancelled`; `registration_status: closed ⇄ open` chỉ có nghĩa khi `published`.

### Scenarios by Status

| # | Scenario | Actor | Trigger | Kết quả |
|---|----------|-------|---------|---------|
| ST-1 | Đăng ký khi published + open + còn slot | Player | register | `registered`, slot--, project count |
| ST-2 | Đăng ký khi closed | Player | register | `REGISTRATION_CLOSED`, no write |
| ST-3 | Đăng ký khi full | Player | register | `TOURNAMENT_FULL`, no write |
| ST-4 | Publish draft đủ field | Host | publish | `published`, cấp slug, project public |
| ST-5 | Huỷ giải đã có đăng ký | Host | cancel | `cancelled`, đăng ký giữ audit vô hiệu |

### Caching Strategy

| Data | Cache? | TTL | Invalidation |
|------|--------|-----|-------------|
| `public_tournaments` (guarded view) | ✅ | ~1 phút | Re-project on publish/edit/cancel; `expires_at` dọn stale |
| Host roster đăng ký | ❌ | — | Luôn đọc canonical qua RLS (dữ liệu nội bộ) |

### Security Checklist

| Mục | Trả lời trong spec |
|-----|---------------------|
| Authorization/ownership per-resource | Canonical qua `tenantRepo` + RLS fail-closed; host action cần capability (DD-56); register/withdraw là person-self authenticated; public chỉ đọc `public_tournaments` |
| Injection/validation | Validate sport/time/area/slots; param binding; `title/notes` plain-text bounded, không markup |
| Secret & log redaction | Không secret trong flow v1 (không đụng tiền/provider); không log PII người đăng ký |
| Webhook signature + replay window | N/A v1 (không webhook/tiền) |
| Idempotency | Ref §3 Idempotency (`command_id` + partial unique) |
| Data retention/xoá | Huỷ giữ audit đăng ký; xoá cứng chỉ pre-GA; PII minor không ra public (DD-84) |

---

## 5. Testing Plan

### Unit Tests

| # | Test | Input | Expected |
|---|------|-------|----------|
| 1 | Tạo tournament hợp lệ | field đủ | row `draft` |
| 2 | Tạo với `ends_at<=starts_at` | time xấu | `TOURNAMENT_INVALID_TIME` |
| 3 | Publish thiếu area | draft thiếu | `TOURNAMENT_PUBLISH_INCOMPLETE` |
| 4 | Publish đủ field | draft đủ | `published` + slug cấp |
| 5 | Đăng ký khi open + còn slot | player | `registered`, slot-- |
| 6 | Đăng ký khi closed | player | `REGISTRATION_CLOSED` |
| 7 | Đăng ký khi full | player | `TOURNAMENT_FULL` |
| 8 | Đăng ký trùng (cùng person) | register x2 | idempotent, 1 active row |
| 9 | Rút rồi đăng ký lại | withdraw→register | active row mới, slot đúng |
| 10 | Huỷ giải | host cancel | `cancelled`, đăng ký vô hiệu |
| 11 | RLS cô lập cross-tenant | tenant A đọc B | 0 rows |
| 12 | `public_tournaments` không có cột tiền/PII | schema introspect | pass (whitelist) |
| 13 | Serializer public không lộ `tenant_id` | serialize | không có tenant_id |
| 14 | Venue không ra public | public read | area có, venue không |
| 15 | Slug tombstone sau rename | rename | link cũ → 404/410 |
| 16 | Guarded view đọc read model | view source | chỉ `public_tournaments` |
| 17 | Authz: non-host publish | guest publish | `TOURNAMENT_FORBIDDEN` |
| 18 | i18n: message có vi+en | error | `t(vi,en)` |
| 19 | v1 register không tạo charge | register | 0 rows `charges` |
| 20 | Retire session_type: enum không có 'tournament' | DD-41 CHECK | 'tournament' rejected |

> Floor 20; v1 low-risk (no money) nên floor đủ. Nếu entry-fee slice sau: thêm decision table tiền + concurrency + abuse.

### Integration Tests

| # | Test | Setup | Expected |
|---|------|-------|----------|
| 1 | Create→publish→project public | host flow | `public_tournaments` row + slug resolve |
| 2 | Concurrency slot cuối (2 player) | slots_max=1, 2 register song song | 1 registered, 1 FULL |
| 3 | Đóng đăng ký ⟂ register | close + register song song | close thắng → REGISTRATION_CLOSED |
| 4 | Cross-tenant isolation public + canonical | tenant A/B | A không thấy canonical B; public whitelist đúng |

---

## 6. Rollout Plan + Changelog

### Rollout

1. Readiness gate DD-82 (analysis doc + coordinate DD-41 sequencing) → owner ratify build.
2. Migration mới (số next-available) + RLS/grants + projector; behind feature flag OFF.
3. Host CRUD + publish → projector public → guarded view `/tournament/<slug>` (DD-83 slug registry).
4. Player register/withdraw; `/me/tournaments`.
5. Bật flag sau invariant tests xanh (public whitelist, RLS, concurrency).

### Metrics

Số giải tạo/publish, tỉ lệ đăng ký/slot, register rejected (full/closed), public view→register funnel (opaque telemetry, no PII).

### Changelog

Xem bảng Changelog ở đầu file.
