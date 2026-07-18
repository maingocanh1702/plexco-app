# Feature: Home — Personal Dashboard (PWA) — Backend Tech Spec

> **Canonical phase:** S9 (cùng PWA shell) — DD-79 ✅  
> **Version:** 0.1 · 2026-07-19  
> **Status:** ✅ Reviewed contract theo DD-79 (owner 2026-07-19); implementation pending S9  
> **Implementation:** Not started · authority: `../../standards/BUILD-STATUS.md` (Doc status ≠ Implementation status)  
> **Product spec:** `../feature_home.md`  
> **References:** `../../standards/decisions.md` **DD-79** · `feature_player_view_tech.md` (person-self resolver + DTO allowlist — canonical) · `feature_marketplace_discovery_tech.md` (public read model) · `feature_notifications_reminders_tech.md` §A (unread) · `../../standards/api-reference-convention.md` (DD-60 envelope)

> **Ranh giới quan trọng (DD-79):** Home là **composition read** — KHÔNG bảng mới, KHÔNG migration, KHÔNG write path, KHÔNG mở đường đọc vượt person-self/public boundary. Endpoint thuộc surface `/api/me*` của player_view; DTO allowlist của player_view là **canonical**, doc này không định nghĩa lại field tiền/PII nào.

---

## 1. Tổng quan triển khai

```text
Authenticated session → Person resolver (player_view canonical)
    → parallel person-self reads: debt summary · upcoming sessions (host-first) · unread count
    → parallel public read: suggested sessions (public_sessions whitelist, limit 3)
    → compose HomeDTO (per-section degradable) → SSE topic person:<id> cho cập nhật
```

Không service/worker mới: reuse person-self query layer (player_view), public read model (marketplace), notification read model §A. Composition chạy trong 1 request handler; mỗi section độc lập — section lỗi trả `null` + reason, KHÔNG fail cả aggregate (trừ auth).

> **Gate 3 chiều:** doc này không chứa claim kỹ thuật độc lập — mọi invariant tiền/PII/authz trỏ về spec canonical tương ứng; khi build, đối chiếu handler ↔ doc này ↔ contract nguồn (player_view/marketplace/§A).

---

## 2. Database Schema + Edge Cases (BE)

### Schema

**KHÔNG bảng mới, không sửa bảng.** Bảng đọc (qua contract sẵn có, không query trực tiếp từ handler):

| Nguồn | Qua contract | Ghi chú |
|-------|--------------|---------|
| `memberships`/`players`/`sessions`/`charges`/`payment_allocations` | player_view person-self (`feature_player_view_tech.md` §4 DTO allowlist) | Cross-tenant own-data; KHÔNG qua tenantRepo đơn lẻ mà qua person-self path đã định nghĩa |
| `public_sessions` | marketplace public read model | Field whitelist HR2 — KHÔNG RLS, KHÔNG tiền/PII |
| Notification read model §A | `feature_notifications_reminders_tech.md` | Chỉ unread count |
| `onboarding_steps` | migration `0008` (đã có trên `main`) | Checklist trạng thái person-self |

### Migration & Rollback

- **Migration:** KHÔNG có — DD-79 composition-only. Nếu build slice phát hiện cần cột/bảng mới ⇒ dừng, quay lại DD (vi phạm ranh giới DD-79).
- **Rollback:**

| Bước | Hành động | An toàn? |
|------|-----------|----------|
| 1 | Disable route `GET /api/me/home` (landing fallback về `/me` hiện có) | ✅ Không mất dữ liệu — không có state riêng |

### Edge Cases (Backend)

| # | Category | Case | Xử lý |
|---|----------|------|-------|
| 1 | Security | Request kèm person/tenant ID trong query/body | ❌ Ignore — identity chỉ từ verified session (player_view invariant) |
| 2 | Security | Suggested section trả field ngoài whitelist `public_sessions` | ❌ NEVER — test bất biến HR2 chạy trên DTO composition |
| 3 | Security | Debt section rò charge của person khác (join lỗi) | ❌ NEVER — chỉ đi qua person-self query layer, không viết join mới trong handler |
| 4 | Security | Aggregate làm rò club không truy cập được qua error message | Generic error per-section — không reveal tồn tại tenant (player_view edge #7) |
| 5 | Security | SSE topic guessing `person:<other>` | AuthZ per subscription — reject (player_view edge #10) |
| 6 | Data Integrity | User vừa host vừa player cùng session | Dedupe 1 entry, role=host ưu tiên — logic 1 chỗ trong composer, không để client tự dedupe |
| 7 | Data Integrity | Section nguồn trả partial (notification model chưa build §B/C/D) | Section `null` + `reason='UNAVAILABLE'`; các section khác vẫn trả |
| 8 | Concurrency | Charge settle giữa 2 section read trong cùng request | Chấp nhận eventual trong 1 response (read-only, không quyết định tiền); SSE đẩy bản mới |
| 9 | Concurrency | 2 request Home song song cùng person | Vô hại — read-only, không side effect |
| 10 | Cross-Feature | Person merge trong lúc session sống | Session/topic invalidate theo player_view edge #12; Home request sau merge trả data hợp nhất |
| 11 | Cross-Feature | CLB suspended (billing) | Kèo person-self vẫn hiện; CTA theo billing rule — Home không thêm logic riêng |
| 12 | Infra | Một nguồn (marketplace/notification) timeout | Per-section timeout ngắn (đề xuất 2s) → section `null` + reason; không kéo sập aggregate |
| 13 | Infra | SSE drop | Client tự re-subscribe; Home vẫn đúng qua refetch — SSE là enhancement, không phải nguồn đúng đắn |

---

## 3. API Contract

### Endpoints

| Method | Path | Auth | Mô tả |
|--------|------|------|-------|
| GET | /api/me/home | ✅ Authenticated Person (person-self) | Aggregate dashboard DTO — thuộc surface `/api/me*` (DD-48 boundary giữ nguyên: không nhận `:personId`) |

> Suggested section có thể compose server-side từ public read model hoặc client gọi thẳng marketplace public API — chốt ở build slice; contract DTO dưới đây không đổi.

### Request/Response Examples

> Envelope DD-60 (`{data, error, meta.requestId}`). Field name minh hoạ, chốt ở build slice; **field tiền/PII theo đúng DTO allowlist player_view — không thêm field mới ở đây.**

**GET `/api/me/home`** — `200`:

```json
{
  "data": {
    "debt": { "totalDue": 85000, "clubCount": 2 },
    "weekSessions": { "count": 3 },
    "upcoming": [
      { "sessionRef": "…", "title": "Cầu lông T3", "club": "CLB Rồng Xanh", "startAt": "…", "role": "host", "paymentStatus": "unpaid" }
    ],
    "suggested": [
      { "publicId": "…", "sport": "badminton", "title": "Cầu lông Q7", "startAt": "…", "priceAmount": 120000, "slots": "5/8" }
    ],
    "unreadNotifications": 3,
    "onboarding": null
  },
  "error": null,
  "meta": { "requestId": "req_…" }
}
```

- `200` — một section nguồn unavailable (partial degradation, KHÔNG phải HTTP error):

```json
{
  "data": { "debt": null, "debtReason": "UNAVAILABLE", "upcoming": ["…"], "suggested": ["…"] },
  "error": null,
  "meta": { "requestId": "req_…" }
}
```

- `401` — chưa đăng nhập:

```json
{ "data": null, "error": { "code": "AUTH_REQUIRED", "message": "Cần đăng nhập", "statusCode": 401 }, "meta": { "requestId": "req_…" } }
```

### Idempotency

| Endpoint | Idempotent? | Key |
|----------|-------------|-----|
| GET /api/me/home | ✅ (read-only, no side effect) | Natural — hỗ trợ `ETag`/`If-None-Match` là optimization, chốt ở build slice |

### Rate Limits

| Endpoint | Limit |
|----------|-------|
| GET /api/me/home | 60/min per account (đồng bộ nhóm `/api/me*` — BL-SEC-5) |

### Error Codes

| Code | Error Code | Message | Trigger |
|------|-----------|---------|---------|
| 401 | `AUTH_REQUIRED` | Cần đăng nhập | No valid session (reuse player_view catalog) |
| 429 | `RATE_LIMITED` | Quá nhiều yêu cầu — thử lại sau | Vượt rate limit |

> Section-level failure là `reason` trong DTO, không phải HTTP error code — một catalog với product spec §3 (toast "Không tải được trang chủ" chỉ khi toàn aggregate fail).

---

## 4. Chi tiết triển khai

### Composition

```text
1. resolvePerson(session)                    # player_view canonical — fail → 401
2. parallel (per-section timeout ~2s):
   a. debtSummary   = personSelf.charges → sum open per club     # DTO allowlist
   b. upcoming      = personSelf.sessions → dedupe(role=host ưu tiên)
                      → sort(host-first, startAt ASC) → take 4
   c. suggested     = publicReadModel.upcoming → take 3           # whitelist fields only
   d. unread        = notificationReadModel.unreadCount(person)   # §A
   e. onboarding    = onboarding_steps(person) nếu chưa complete
3. compose DTO — section fail → null + reason
4. SSE: client subscribe person:<id> (topic sẵn có của player_view)
```

Hero = phần tử đầu của `upcoming` — client không tự chọn; server sort là nguồn đúng đắn (product spec §3).

### Caching Strategy

| Data | Cache? | TTL | Invalidation |
|------|--------|-----|-------------|
| Person-self sections (debt/upcoming/unread/onboarding) | ❌ server-side cross-user | — | Luôn per-request theo person; client cache ngắn + SSE update |
| Suggested (public read model) | ✅ shared được | 30–60s | Public data, không PII — theo caching của marketplace |
| Aggregate DTO | Client-side | 1 phút | Pull-to-refresh, app foreground, SSE event |

### Security Checklist (template v2.33 — map về contract nguồn)

| Mục | Trả lời trong spec |
|-----|---------------------|
| Authorization/ownership | Person-self only qua player_view resolver; không nhận person/tenant ID từ client; DD-48 boundary giữ nguyên |
| Injection/validation | Không query param nghiệp vụ; handler không build SQL — chỉ gọi query layer sẵn có |
| Secret & log redaction | Log opaque IDs; không log số tiền/tên CLB người khác (player_view edge #11) |
| Webhook signature + replay | N/A — không webhook |
| Idempotency | GET read-only (bảng §3) |
| Data retention/xoá | Không state riêng — theo retention của bảng nguồn |

---

## 5. Testing Plan

### Unit Tests

| # | Test | Input | Expected |
|---|------|-------|----------|
| 1 | Aggregate happy path | Person có nợ + 3 kèo | Đủ sections, đúng số |
| 2 | No session | Unauthenticated | 401 `AUTH_REQUIRED` |
| 3 | Person ID trong query | `?personId=other` | Ignored — data của self |
| 4 | Debt sum per club | 2 CLB có nợ | `totalDue` + `clubCount=2` khớp ledger DTO |
| 5 | Debt = 0 | Không nợ | `totalDue: 0` (chip vẫn render) |
| 6 | Dedupe host+player cùng session | 1 session 2 vai | 1 entry, role=host |
| 7 | Sort host-first | Host kèo xa + player kèo gần | Host lên đầu |
| 8 | Upcoming limit | 6 kèo | 4 entries |
| 9 | Hero = first element | Sorted list | Server order quyết định |
| 10 | Suggested whitelist | Public read model | Chỉ field whitelist — HR2 assert từng key |
| 11 | Suggested limit | 10 public sessions | 3 entries |
| 12 | Section timeout | Notification model treo | Section null + reason; sections khác OK |
| 13 | Onboarding incomplete | 1/3 steps | `onboarding` object với trạng thái đúng |
| 14 | Onboarding complete | 3/3 | `onboarding: null` |
| 15 | Left membership | Kèo CLB đã rời | Theo player_view rule (historical, không lộ thêm) |
| 16 | Suspended tenant | CLB suspended | Kèo vẫn hiện; không field mới |
| 17 | Merge person | Sau merge | Data hợp nhất, session cũ invalid |
| 18 | Week count | 3 kèo completed tuần này | `weekSessions.count=3` |
| 19 | Log redaction | Request logs | Không PII/person khác |
| 20 | Rate limit | 61 req/min | 429 `RATE_LIMITED` |

### Integration Tests

| # | Test | Setup | Expected |
|---|------|-------|----------|
| 1 | Login → Home E2E | Google/email → GET /api/me/home | Đủ DTO, đúng person |
| 2 | HR2 invariant | Seed public + private sessions | Suggested không chứa field ngoài whitelist; private không xuất hiện |
| 3 | Settle → SSE → Home | Mark-paid charge → SSE event → refetch | Debt giảm đúng |
| 4 | Cross-person isolation | 2 persons, seed chéo | Home của A không chứa bất kỳ ref nào của B |

---

## 6. Rollout Plan + Changelog

### Rollout

1. Route sau feature flag, landing giữ `/me` cũ
2. Internal: verify HR2/person-self fixtures trên staging
3. Bật landing = Home (HOME-OQ-2 ✅) cho tenant #1
4. Public cùng PWA shell S9

### Metrics

- Home load p95 · per-section failure rate · suggested CTR (`home_suggested_tapped`) · hero CTA rate · pull-to-refresh rate

### Changelog

| Date | Version | Thay đổi |
|---|---|---|
| 2026-07-19 | v0.1 | Khởi tạo theo DD-79 ✅ (composition-only): aggregate `GET /api/me/home` thuộc surface `/api/me*`, không bảng/migration mới; per-section degradation; DTO tiền/PII theo allowlist player_view (canonical); suggested qua public read model HR2; chips phase-1 = [Còn nợ, Kèo tuần] (defer host-receivable OQ-1(c) + streak OQ-3). Template v2.30/v2.33 đầy đủ. |
