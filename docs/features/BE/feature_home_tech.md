# Feature: Home — Personal Dashboard (PWA) — Backend Tech Spec

> **Canonical phase:** S9 (cùng PWA shell) — DD-79 ✅  
> **Version:** 0.6 · 2026-08-10
> **Status:** ✅ Reviewed contract theo DD-79; implementation pending S9. Primary plan v1.8 đã `PLAN_READY` tại `90d292d`, nhưng từng slice vẫn phải strict `CODE_READY`
> **Implementation:** Not started · authority: `../../standards/BUILD-STATUS.md` (Doc status ≠ Implementation status)  
> **Product spec:** `../FE/feature_home.md`  
> **References:** `../../standards/decisions.md` **DD-79/DD-91** · `feature_player_view_tech.md` (person-self resolver + canonical `getSelfPaymentStatus`) · `feature_payment_reconcile_tech.md` · `feature_marketplace_discovery_tech.md` (public read model) · `feature_notifications_reminders_tech.md` §A (unread) · `../../standards/api-reference-convention.md` (DD-60 envelope)

> **Ranh giới quan trọng (DD-79 + DD-91):** Home là **composition read** — KHÔNG bảng mới, KHÔNG migration, KHÔNG write path, KHÔNG mở đường đọc vượt person-self/public boundary. Endpoint thuộc surface `/api/me*` của player_view; `getSelfPaymentStatus` + `remainingAmount` là payment truth duy nhất. Home không query/sum ledger và không tạo formula/serializer tiền riêng. Exact requester-only `/pay` là target deterministic/no-store/no-LLM ở chat surfaces; chưa có runtime.

---

## 1. Tổng quan triển khai

```text
Authenticated session → Person resolver (player_view canonical)
    → parallel person-self reads: canonical payment summary · upcoming sessions (host-first) · streak count · unread count
    → parallel public read: suggested sessions (public_sessions whitelist, limit 3)
    → compose HomeDTO (per-section degradable; chip selection = FE logic) → SSE topic person:<id> cho cập nhật
```

Không service/worker mới: reuse person-self query layer (player_view), public read model (marketplace), notification read model §A. Composition chạy trong 1 request handler; mỗi section độc lập — section lỗi trả `null` + reason, KHÔNG fail cả aggregate (trừ auth). Các service/route trên hiện chưa được build; đây là target contract, không phải runtime proof.

### Entry points

| Entry | Caller | Mô tả |
|-------|--------|-------|
| `GET /api/me/home` | Player (PWA) | Composition aggregate: payment + upcoming + streak + unread + suggested |
| `GET /api/me/payment-summary` | Reuse (player_view) | Canonical `getSelfPaymentStatus` → `remainingAmount` |
| `GET /api/me/upcoming-sessions` | Reuse (player_view) | Person-self upcoming sessions (host-first sort) |
| `GET /api/public/sessions/suggested` | Reuse (marketplace) | Public read model, whitelist fields, limit 3 |
| SSE `person:<id>` topic | System | Realtime push for payment/session/unread changes |

> **Gate 3 chiều:** doc này không chứa claim kỹ thuật độc lập — mọi invariant tiền/PII/authz trỏ về spec canonical tương ứng; khi build, đối chiếu handler ↔ doc này ↔ contract nguồn (player_view/marketplace/§A).

---

## 2. Database Schema + Edge Cases (BE)

### Query Patterns

```sql
-- getUpcomingSessions (per tenant, via RLS)
SELECT s.id, s.sport_key, s.starts_at, s.ends_at, s.area, s.price,
       COUNT(p.id) FILTER (WHERE p.status = 'active') AS confirmed_count,
       s.max_players
FROM sessions s
LEFT JOIN players p ON p.session_id = s.id
WHERE s.starts_at > now()
  AND s.status = 'open'
GROUP BY s.id
ORDER BY s.starts_at
LIMIT 10;

-- getPlayerPaymentSummary (person-self)
SELECT SUM(c.amount) FILTER (WHERE c.status = 'unpaid') AS total_unpaid,
       COUNT(*) FILTER (WHERE c.status = 'unpaid') AS unpaid_count
FROM charges c
JOIN players p ON p.id = c.player_id
WHERE p.person_id = $1;
```

### Schema

**KHÔNG bảng mới, không sửa bảng.** Bảng đọc (qua contract sẵn có, không query trực tiếp từ handler):

| Nguồn | Qua contract | Ghi chú |
|-------|--------------|---------|
| `memberships`/`players`/`sessions`/`charges`/`payment_allocations` | player_view person-self (`getSelfPaymentStatus`, target `/api/me/charges`) | Player View sở hữu query + integrity validation + aggregate; Home chỉ consume typed status, không đọc/sum các bảng này |
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
| 14 | Money/Data | Player View trả `SelfPaymentStatus.kind='unknown'` | Debt section `null`/unavailable + retry metadata; không coerce thành `totalDue: 0`, không fallback sang direct ledger query/cached amount |

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
    "debt": { "kind": "known_amount", "totalOutstanding": 85000, "clubCount": 2, "asOf": "…" },
    "weekSessions": { "count": 3 },
    "streak": { "days": 5, "asOf": "…" },
    "upcoming": [
      { "sessionRef": "…", "title": "Cầu lông T3", "club": "CLB Rồng Xanh", "startAt": "…", "role": "host", "paymentStatus": "open", "payAction": { "kind": "open_protected_pay", "href": "/pay/…" } }
    ],
    "suggested": [
      { "publicId": "…", "sport": "badminton", "title": "Cầu lông Q7", "startAt": "…", "priceAmount": 120000, "slotsOpen": 5 }
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
| GET /api/me/home | ✅ (read-only, no side effect) | Natural; response person-self dùng `Cache-Control: private, no-store`, không ETag/client persistence |

### Rate Limits

| Endpoint | Limit |
|----------|-------|
| GET /api/me/home | 60/min per account (đồng bộ nhóm `/api/me*` — BL-SEC-5) |

### Error Codes

| Code | Error Code | Message | Trigger |
|------|-----------|---------|---------|
| 401 | `AUTH_REQUIRED` | Cần đăng nhập | No valid session (reuse player_view catalog) |
| 429 | `RATE_LIMITED` | Quá nhiều yêu cầu — thử lại sau | Vượt rate limit |

> Section-level failure là `reason` trong DTO, không phải HTTP error code — một catalog với product spec §3 (toast "Không tải được trang chủ" chỉ khi toàn aggregate fail). `debt.kind='known_zero'` chỉ đến từ authoritative query hoàn tất; `unknown` map thành section unavailable, không map thành zero.

---

## 4. Chi tiết triển khai

### Composition

```text
1. resolvePerson(session)                    # player_view canonical — fail → 401
2. parallel (per-section timeout ~2s):
   a. debtSummary   = playerView canonical payment projection    # wraps
                      getSelfPaymentSummary; Player View owns cross-club aggregate
   b. upcoming      = personSelf.sessions → dedupe(role=host ưu tiên)
                      → sort(host-first, startAt ASC) → take 4
                      → enrich hero (first element) với payAction nếu Player View expose nó
   c. streak        = count consecutive days backward from today
                      với ≥ 1 session (host hoặc player) per day
                      Data: person-self session history (player_view)
   d. suggested     = publicReadModel.upcoming → take 3           # whitelist fields only
   e. unread        = notificationReadModel.unreadCount(person)   # §A
   f. onboarding    = onboarding_steps(person) nếu chưa complete
3. compose DTO — section fail → null + reason
4. SSE: client subscribe person:<id> (topic sẵn có của player_view)
```

Hero = phần tử đầu của `upcoming` — client không tự chọn; server sort là nguồn đúng đắn (product spec §3).

**Hero CTA (gated bởi HOME-OQ-4):** Nếu upcoming session DTO kèm `payAction` (additive contract từ Player View) → composer kèm `payAction` vào hero item. FE render CTA theo role (player → pay, host → board). Nếu Player View chưa expose `payAction` trong upcoming projection → trả `null` (không CTA, không placeholder). **Không tự tạo `payAction`** — composition-only.

**Streak count:** Read-only computation trên person-self session history đã có; không bảng/migration mới. Query: group sessions by calendar date (local timezone), đếm ngược từ today. Streak = 0 → trả `{ days: 0 }`; FE quyết định ẩn chip.

**Adaptive chip selection:** Chạy ở FE, không phải BE. BE trả đủ data (debt + streak + weekSessions); FE chọn top 2 theo priority matrix (§3 product spec).

Home composer **không** được triển khai `SUM(amount_due-amount_allocated)`, gọi ledger repository, hay suy `unknown → 0`. Nếu Player View chưa expose canonical cross-club summary cần thiết, build Home phải dừng ở dependency đó và mở rộng Player View owner; không tạo helper thứ hai trong Home. Hero CTA chỉ render khi `payAction` available từ upstream; nếu chưa có thì hero không CTA (HOME-OQ-4 gate). Exact `/pay` chat gọi cùng service nhưng không phải endpoint/handler do Home sở hữu.

### Caching Strategy

| Data | Cache? | TTL | Invalidation |
|------|--------|-----|-------------|
| Person-self sections (debt/upcoming/unread/onboarding) | ❌ server/client persistence | — | Luôn per-request theo person; `private, no-store`; SSE chỉ invalidate/refetch live |
| Suggested (public read model) | ✅ shared được | 30–60s | Public data, không PII — theo caching của marketplace |
| Aggregate DTO | ❌ | — | Chứa person-self data nên không cache; offline ẩn person-self sections |

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
| 4 | Canonical debt summary | Player View trả 2 CLB có `known_amount` | Home giữ đúng `totalOutstanding` + `clubCount=2`; không gọi ledger/sum lần hai |
| 5 | Proven debt = 0 | Player View trả `known_zero` sau authoritative query | Chip render 0 |
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
| 21 | Unknown payment truth | Player View trả `unknown` vì authz/integrity/dependency | Debt section unavailable/retry; không `0`, không direct ledger fallback |
| 22 | Streak happy path | 3 ngày liên tiếp có kèo (host+player) | `streak.days=3` |
| 23 | Streak reset | 2 ngày có kèo, 1 ngày trống, 1 ngày có kèo | `streak.days=1` (chỉ đếm từ hôm nay ngược lại) |
| 24 | Streak zero | Không có kèo hôm nay hoặc hôm qua | `streak.days=0` |
| 25 | Streak section fail | Session history query timeout | `streak: null` + reason; không block aggregate |
| 26 | Hero CTA with payAction | Upcoming hero session có `payAction` từ Player View | Hero item kèm `payAction`; FE render CTA |
| 27 | Hero CTA without payAction | Player View chưa expose `payAction` trong upcoming | Hero item không có `payAction`; FE không render CTA |

### Integration Tests

| # | Test | Setup | Expected |
|---|------|-------|----------|
| 1 | Login → Home E2E | Google/email → GET /api/me/home | Đủ DTO, đúng person |
| 2 | HR2 invariant | Seed public + private sessions | Suggested không chứa field ngoài whitelist; private không xuất hiện |
| 3 | Settle → SSE → Home | Mark-paid charge → SSE event → refetch | Debt giảm đúng |
| 4 | Cross-person isolation | 2 persons, seed chéo | Home của A không chứa bất kỳ ref nào của B |
| 5 | Cross-surface payment parity | Cùng snapshot qua `/api/me/charges`, Home và exact `/pay` | Cùng known status/remaining amount; Home không có formula riêng. `/pay` response requester-only/no-store và không qua LLM |

---

## 6. Rollout Plan + Changelog

### Rollout

1. Land Player View canonical `remainingAmount` + `getSelfPaymentStatus` + cross-club summary trước; nếu dependency chưa có thì Home route vẫn OFF
2. Route sau feature flag, landing giữ `/me` cũ
3. Internal: verify HR2/person-self/payment-parity fixtures trên staging
4. Bật landing = Home (HOME-OQ-2 ✅) cho tenant #1
5. Public cùng PWA shell S9

### Metrics

- Home load p95 · per-section failure rate · suggested CTR (`home_suggested_tapped`) · hero-card tap rate · pull-to-refresh rate

### Changelog

| Date | Version | Thay đổi |
|---|---|---|
| 2026-08-10 | v0.6 | **A-grade upgrade:** thêm Entry points table (5 entries); bump version. Không đổi composition-only boundary. |
| 2026-08-08 | v0.5 | **Port Sporta UX decisions (BE):** (1) Streak count composition: read-only trên person-self session history, không bảng mới; đếm backward from today, streak=0 → FE ẩn chip. (2) Hero CTA gating: kèm `payAction` vào hero item nếu Player View expose nó (HOME-OQ-4); không tự tạo `payAction`. (3) DTO response thêm `streak` + `payAction` trong upcoming. (4) 6 unit tests mới (#22–27). Không đổi composition-only boundary DD-79; không migration/bảng mới. |
| 2026-07-31 | v0.4 | Align Home with canonical dependent contracts: public suggested uses `slotsOpen`; hero CTA gated on `payAction` availability; person-self aggregate is `private, no-store`, with only public suggested cacheable. No runtime authorization. |
| 2026-07-28 | v0.3 | Reconcile primary plan v1.8 `PLAN_READY` at `90d292d`; preserve composition-only, per-slice `CODE_READY` and no-runtime boundaries. |
| 2026-07-27 | v0.2 | Đồng bộ DD-91: Home chỉ consume Player View payment truth (`remainingAmount`/`getSelfPaymentStatus`), không query/sum ledger hay tạo serializer thứ hai; `known_zero` khác `unknown`, payment CTA dùng protected route. Thêm parity/unknown tests và hard dependency Player View trước Home. Contract only; route/service/chat runtime chưa build. |
| 2026-07-19 | v0.1 | Khởi tạo theo DD-79 ✅ (composition-only): aggregate `GET /api/me/home` thuộc surface `/api/me*`, không bảng/migration mới; per-section degradation; DTO tiền/PII theo allowlist player_view (canonical); suggested qua public read model HR2; chips phase-1 = [Còn nợ, Kèo tuần] (defer host-receivable OQ-1(c) + streak OQ-3). Template v2.30/v2.33 đầy đủ. |
