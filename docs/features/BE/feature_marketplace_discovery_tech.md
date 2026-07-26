# Feature: Marketplace Discovery & Public Projection — Backend Tech Spec

> **Canonical phase:** P4.3  
> **Version:** 2.4 · 2026-07-26
> **Status:** Reviewed  
> **Implementation:** Not started — `public_sessions` có sẵn · authority: `../../standards/BUILD-STATUS.md` (Doc status ≠ Implementation status)  
> **Product spec:** `../feature_marketplace_discovery.md`  
> **References:** `../../product/TDD.md` §3.9

---

## 1. Tổng quan triển khai

```text
Session Projector → public_sessions (dedicated projection table)
    → Discovery API (SELECT-only role) → Public DTO (whitelist)
    → Cache (short TTL + purge on privacy-critical unpublish)
```

`public_sessions` là **dedicated projection**, không phải view join tenant-private tables. Discovery DB role có SELECT-only trên approved public view/function.

---

## 2. Database Schema + Edge Cases (BE)

### Schema

The DDL below mirrors the current live projection for upgrade safety. `skill_level` is explicitly legacy: the DD-41 slice adds public policy fields (`title`, `session_type`, `level_min_rank`, `level_max_rank`, `level_strict`, `gender_restriction`, `age_min`, `age_max`), backfills/switches projector+API, then drops `skill_level` and updates the exact-column invariant. Do not treat the compatibility column as final target schema.

```sql
CREATE TABLE public_sessions (
  id uuid PRIMARY KEY,
  session_id uuid NOT NULL,
  tenant_id uuid NOT NULL,  -- internal routing only, never serialized
  sport_key text NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  area text NOT NULL,
  skill_level text,
  price_amount integer NOT NULL,
  slots_open integer NOT NULL,
  club_display_name text NOT NULL,
  host_display_name text,
  join_policy text NOT NULL,
  projected_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

-- Plain btree: PostgreSQL forbids STABLE `now()` in an index predicate; query supplies `$now` at runtime.
CREATE INDEX idx_public_starts ON public_sessions(starts_at);
CREATE INDEX idx_public_sport_time ON public_sessions(sport_key, starts_at);
CREATE INDEX idx_public_area_time ON public_sessions(area, starts_at);
CREATE INDEX idx_public_price ON public_sessions(price_amount);
```

### Migration & Rollback

> Grep live `packages/db/migrations/` (0000–0013 đã merge trên main): `public_sessions` + 4 index trên **đã tồn tại từ `0006_discovery.sql`**, khớp DDL này (kể cả plain btree thay partial-index `now()`) — baseline để đọc, **reuse, không recreate**.

- **Migration (genuinely new → migration mới monotonic sau tail đã merge):** DD-41 expand→contract như đã pin ở đầu §2 — expand thêm public policy fields (`title`, `session_type`, `level_min_rank`, `level_max_rank`, `level_strict`, `gender_restriction`, `age_min`, `age_max`) → backfill/switch projector+API → contract drop `skill_level` + cập nhật exact-column invariant.
- **Rollback:**

| Bước | Hành động | An toàn? |
|------|-----------|----------|
| 1 | Disable discovery API + session projector + expiry sweep | ✅ |
| 2 | Migration revert mới: revert **CHỈ additive objects của slice** (cột DD-41 mới, trước bước contract); projection rebuild được bằng Reproject từ canonical `sessions` (integration test #3) | ✅ Có điều kiện |
| 3 | Drop baseline `public_sessions` của `0006` | ❌ NEVER — migration đã apply trên main; slice rollback không đụng baseline objects |

### Edge Cases (Backend)

| # | Category | Case | Xử lý |
|---|----------|------|-------|
| 1 | Security | tenant_id serialized in API response | ❌ NEVER — DTO serializer excludes it |
| 2 | Security | ORM row spread leaks fields | ❌ NEVER — explicit DTO/schema allowlist |
| 3 | Data Integrity | Private session in projection | Projector only upserts public/open/future/complete |
| 4 | Data Integrity | Stale expired session | Periodic expiry sweep + expiry guard |
| 5 | Security | Sequential tenant enumeration | No tenant list endpoint — opaque IDs |
| 6 | Security | Unknown filter probes taxonomy | Parameterized queries — empty results, no error details |
| 7 | Security | Cache stores private data | Cache key/value = public DTO only |
| 8 | Security | CDN serves stale after unpublish | Short TTL + purge on privacy-critical changes |
| 9 | Security | Pagination cursor reveals internals | Signed/opaque sort keys |
| 10 | Concurrency | Slot race (browse vs join) | Slots advisory — join rechecks transactionally |
| 11 | Security | Scrape/bot abuse | Layered IP/account/device rate limits |
| 12 | Data Integrity | Discovery role reads tenant tables | ❌ IMPOSSIBLE — SELECT-only on public view |
| 13 | Privacy | Personal-tenant owner alias blank | Do not upsert projection; never fall back to internal tenant/person/account name |
| 14 | Data Integrity | Public session chưa publish (`draft`) | Projector KHÔNG upsert — chỉ `status='open'` (đã publish) mới chiếu; `visibility='public'` một mình không đủ. Timing authority: `feature_session_management_tech.md` §4 bước 7 (`PublishSession` `draft`→`open`) |
| 15 | Data Integrity | Public session với `slots_max IS NULL` tồn tại ngoài SessionService validation choke-point (legacy/fixture/writer bypass — cột DB vẫn nullable, chưa có DB CHECK) | Projector KHÔNG upsert; XOÁ projection row đã tồn tại cho session đó (nếu có) VÀ purge cached public DTO/CDN entry cho session đó (cùng cơ chế edge #8 unpublish, §4 Caching Strategy) — không giữ lại state cũ ở bất kỳ tầng nào (DB projection lẫn cache/CDN); ghi audit/integrity signal xác định `session_id`, không silent skip. Authority: `feature_session_management_tech.md` §2 (Capacity × visibility, PRD E#7) — `visibility='public'` bắt buộc `slots_max IS NOT NULL`, enforced ở SessionService validation choke-point trên create và mọi update dẫn tới public; row vi phạm tồn tại ngoài choke-point là invalid state, fail-closed: không được xuất hiện trong public discovery projection (concrete handling delegated tới doc này). Áp dụng khi projector chạm session đó (event hoặc reproject) — không phải guarantee độc lập việc có bao giờ chạm hay không. Gap đã biết: bypass-write biến một row đang project hợp lệ thành invalid (out-of-band `slots_max` → `NULL`) không tự phát session event; bản chiếu + cache cũ không bị đụng, tiếp tục lộ công khai — periodic sweep hiện tại chỉ bắt time-based expiry (`expires_at < now()`), không bắt anomaly này. Đóng gap này cần durable-event contract cho bypass writer hoặc periodic canonical reconciliation — phụ thuộc job-infra slice riêng, ngoài scope slice này (hardening candidate kiểu DB CHECK đã ghi ở `feature_session_management_tech.md` §2, chưa chốt thời điểm). Residual này track bằng backlog task `job-infra-public-projection-reconciliation` (`docs/autopilot-backlog.md`) — ENABLEMENT_ONLY gate cho PROJECTOR chứ không phải cho spec này: projector không được enable trước khi gap này được đóng bằng MỘT trong ba lối thoát mà task đó liệt kê: (a) durable-event contract cho bypass writer, (b) periodic canonical reconciliation, hoặc (c) DB CHECK `NOT (visibility='public' AND slots_max IS NULL)` đã VALIDATE kèm dọn/kiểm hàng vi phạm sẵn có — (c) xoá invalid state tại nguồn nên tự nó đóng gap và có thể làm (a)/(b) thành thừa. Gate có tên và tra được, không phải lời hứa; nhưng nó không được loại trừ chính lối thoát rẻ nhất mà task tracking của nó đã ghi |

---

## 3. API Contract

### Endpoints

| Method | Path | Auth | Mô tả |
|--------|------|------|-------|
| GET | /api/discover | Public | Browse/filter sessions |
| GET | /api/discover/sessions/:publicId | Public | Session detail |

### Query Parameters

| Param | Type | Mô tả |
|-------|------|-------|
| `sport` | string | Sport key filter |
| `area` | string | Area filter |
| `start_after` / `start_before` | ISO datetime | Time window |
| `skill` | string | Legacy compatibility filter only during DD-41 migration |
| `level_min_rank` / `level_max_rank` | integer | DD-41 target range filter using DD-08 ranks |
| `level_strict` | boolean | DD-41 target: distinguish hard gate from advisory range |
| `max_price` | integer | Price ceiling |
| `available_only` | boolean | Only sessions with slots |
| `cursor` | string | Opaque pagination cursor |

### Error Codes

| Code | Error Code | Message | Trigger |
|------|-----------|---------|---------|
| 429 | `DISCOVERY_RATE_LIMITED` | Quá nhiều truy vấn | Rate limit exceeded |
| 400 | `INVALID_FILTER` | Bộ lọc không hợp lệ | Unknown filter value |

### Request/Response Examples

> DTO minh hoạ theo contract đã pin; field name cụ thể chốt ở build slice; envelope DD-60 (`../../standards/api-reference-convention.md`). DTO chỉ chứa field trong whitelist §2 — không `tenant_id`/venue/roster.

**GET `/api/discover`** — browse (field derive từ `public_sessions` whitelist §2; cursor opaque §3):

```json
{
  "data": {
    "items": [
      { "publicId": "…", "sportKey": "badminton", "startsAt": "…", "area": "q7", "priceAmount": 50000, "slotsOpen": 2, "clubDisplayName": "…", "joinPolicy": "open" }
    ],
    "nextCursor": "…"
  },
  "error": null,
  "meta": { "requestId": "req_…" }
}
```

**`400`** — bộ lọc không hợp lệ (không lộ error details — edge #6):

```json
{ "data": null, "error": { "code": "INVALID_FILTER", "message": "Bộ lọc không hợp lệ", "statusCode": 400 }, "meta": { "requestId": "req_…" } }
```

**`429`** — rate limit (edge #11):

```json
{ "data": null, "error": { "code": "DISCOVERY_RATE_LIMITED", "message": "Quá nhiều truy vấn", "statusCode": 429 }, "meta": { "requestId": "req_…" } }
```

### Idempotency

| Endpoint | Idempotent? | Key |
|----------|-------------|-----|
| GET `/api/discover` | ✅ | Read-only — không mutation |
| GET `/api/discover/sessions/:publicId` | ✅ | Read-only |
| Projector upsert/delete (system) | ✅ | Replay idempotent theo `public_sessions.id` (= session id, PK — §2; test #16) |

---

## 4. Chi tiết triển khai

### Ranking

- Version explicit for analytics/reproducibility.
- Until Product MKT-OQ-3 is owner-resolved, default is deterministic `ORDER BY starts_at ASC, id ASC`; `area` is an explicit filter only. Distance/area weighting is feature-gated OFF and cannot be represented as final ranking contract yet.
- Ranking KHÔNG dùng financial/identity data.
- Bounded date range/page size enforced.

### Projector Logic

```text
Session event → Check: public? open? future? required fields present? (visibility='public' ⇒ includes slots_max IS NOT NULL)
  → YES: resolve public aliases
      club tenant     → moderated tenants.display_name
      personal tenant → nonblank moderated owner membership.display_name (DD-46 target)
      personal alias blank/invalid → NO projection (never internal tenant/person fallback)
    → Upsert public_sessions (reload canonical safe fields; session_id remains no-FK internal reference)
  → NO: Delete from public_sessions
Periodic sweep: DELETE WHERE expires_at < now()
```

> **Timing = PUBLISH, open-only (cross-ref `feature_session_management_tech.md` §4 bước 7):** `open?` ở trên nghĩa là `sessions.status='open'` — trạng thái chỉ đạt được sau khi Host **publish** (`PublishSession`, `draft`→`open`). Một session `visibility='public'` còn `draft` **chưa** qua được check này → **NO projection**; `session.created` khi vẫn `draft` không upsert dù đã chọn public. Publish emit `session.published` cùng transaction (session_management §4 bước 6-7) — projector consume event đó (hoặc reproject) rồi mới upsert khi `open`. Đóng/huỷ/quá giờ hạ khỏi projection như cũ (edge #3/#4); PRD FLOW 2 bước 2 + FLOW 12 mô tả cùng timing này ở tầng product.

> **Capacity × visibility gate (cross-ref `feature_session_management_tech.md` §2, PRD E#7 authority):** `required fields present?` cho `visibility='public'` bao gồm `slots_max IS NOT NULL`. Row public + `slots_max IS NULL` tồn tại ngoài SessionService choke-point (edge #15) fail vào nhánh `NO`: projector KHÔNG upsert, XOÁ projection row đã tồn tại cho session đó (nếu có), purge cached public DTO/CDN entry cho session đó (cùng trigger class edge #8 unpublish — Caching Strategy Invalidation bên dưới; cache không được phép giữ DTO invalid tới hết TTL), và ghi audit/integrity signal xác định `session_id` — không silent skip. Fail-closed chỉ áp dụng cho ĐÚNG row vi phạm đó; batch projection CONTINUE bình thường với các row hợp lệ khác trong cùng batch, KHÔNG halt toàn bộ projector (một row lỗi data-integrity không được biến thành discovery outage).

### Caching Strategy

| Data | Cache? | TTL | Invalidation |
|------|--------|-----|-------------|
| Public session DTO (browse/detail) | ✅ | Ngắn (short TTL — §1; số cụ thể chốt ở build slice) | Purge on privacy-critical unpublish (§1, edge #8, test #19); same purge on projector fail-closed skip of an invalid public + `slots_max IS NULL` row (edge #15, §4 Capacity × visibility gate — test #26); cache key/value = public DTO only (edge #7, test #18) |
| `slots_open` | Advisory only (trong DTO cache) | Như DTO | Join re-checks transactionally (edge #10) — không phải nguồn quyết định capacity/tiền |
| Tenant-private data (venue/roster/financial/identity) | ❌ | — | Không bao giờ vào projection/cache/CDN (edge #1/#2/#7; ranking không dùng financial/identity — §4) |

### Security Checklist (template v2.33 — map về section đã pin)

| Mục | Trả lời trong spec |
|-----|---------------------|
| Authorization/ownership | §1/§2: Discovery DB role SELECT-only trên approved public view (edge #12, test #20); endpoints Public nhưng chỉ chạm dedicated projection, không join tenant-private tables |
| Injection/validation | Edge #6: parameterized queries; unknown filter → empty results/`INVALID_FILTER`, không lộ error details; cursor signed/opaque (edge #9, test #14) |
| Secret & log redaction | N/A — feature không chạm secret; DTO/schema allowlist chặn `tenant_id`/venue/roster/PII (edge #1/#2, tests #8–#10) |
| Webhook signature + replay | N/A — không có webhook; projector consume event nội bộ, replay idempotent (test #16) |
| Idempotency | §3 bảng Idempotency (read-only endpoints + projector replay theo PK) |
| Data retention/xoá | §4: periodic sweep `DELETE WHERE expires_at < now()`; unpublish → delete + CDN purge (edge #8); còn lại theo `feature_security_operations_tech.md` |

---

## 5. Testing Plan

### Unit Tests

| # | Test | Input | Expected |
|---|------|-------|----------|
| 1 | DTO whitelist exact match | Full session | Only whitelist fields |
| 2 | Nested field fuzzing | DTO with extra fields | Stripped |
| 3 | Private session excluded | visibility=private | Not in projection |
| 4 | Closed session excluded | status=closed | Deleted from projection |
| 5 | Cancelled session excluded | status=cancelled | Deleted |
| 6 | Past session excluded | starts_at in past | Deleted by sweep |
| 7 | Incomplete session excluded | Missing required fields | Not projected |
| 8 | Venue not leaked | Public DTO | No venue address |
| 9 | Tenant ID not leaked | API response | No tenant_id |
| 10 | Roster not leaked | API response | No roster data |
| 11 | Filter sport works | sport=badminton | Filtered results |
| 12 | Filter area works | area=q7 | Filtered results |
| 13 | Cursor pagination | 2 pages | Stable cursor |
| 14 | Cursor tamper | Modified cursor | Rejected |
| 15 | Rate limit | Exceed threshold | 429 |
| 16 | Projector replay idempotent | Same event twice | No duplicate |
| 17 | Expiry sweep | Expired session | Removed |
| 18 | Cache public DTO only | Cache inspection | No private data |
| 19 | CDN purge on unpublish | Set private | Cache purged |
| 20 | Discovery role isolation | Direct DB query | No tenant table access |
| 21 | Public start index migration | Apply DDL on supported PostgreSQL | Plain index succeeds; no non-IMMUTABLE predicate error |
| 22 | Personal-tenant alias | Owner membership alias nonblank vs blank | Nonblank projects as club_display_name; blank deletes/skips projection; no internal-name fallback |
| 23 | Ranking unresolved gate | No experimental ranking flag | Stable `(starts_at,id)` order only; area/distance weight absent |
| 24 | DD-41 projection cutover | Expand/backfill/switch/contract fixture | Target policy fields are public; legacy `skill_level` absent after contract; private notes/instructions/byoe/cost_shared absent throughout |
| 25 | Draft public session excluded | `visibility='public'`, `status='draft'` (not yet published) | Not projected; only appears after `PublishSession` flips `status='open'` (edge #14) |
| 26 | Public capacity-guard fail-closed, skip-and-continue | Batch: session A = `visibility='public'`, `status='open'`, `slots_max IS NULL` (invalid fixture, outside SessionService choke-point — edge #15), already projected + cached from a prior valid state before the out-of-band change, alongside sibling session B valid + public in the same batch. Scope note: A is manually placed into the projector's batch here — this proves handling once the projector reaches the row, not that every out-of-band-invalidated row is guaranteed to be reached in production (edge #15 residual: a bypass-write may not emit a session event) | Session A: not projected; any pre-existing `public_sessions` row for A is removed; cached public DTO/CDN entry for A is also purged, not left to expire by TTL; audit/integrity signal emitted for A. Session B: still projects normally in the same batch, its cache untouched — projector does not halt on A's fault |

### Integration Tests

| # | Test | Setup | Expected |
|---|------|-------|----------|
| 1 | Publish → search → find | Create session (`draft`, public) → `PublishSession` (`draft`→`open`) → search | Absent while `draft`; found in results only after publish |
| 2 | Unpublish → search → gone | Set private → search | Not in results |
| 3 | Reproject → verify | Reproject command | Projection matches canonical |
| 4 | Load test | 1k sessions, concurrent queries | Latency target met |

---

## 6. Rollout Plan + Changelog

### Rollout

1. Seed tenant #1 public sessions
2. Internal-only endpoint
3. Security/pen-test
4. Beta with cache/rate limits
5. Public launch

### Metrics

- Query latency / result/no-result ratio
- Projection lag / stale removals
- Rate-limit hits / cache hit ratio
- Privacy invariant failures (page immediately)

### Changelog

| Date | Version | Thay đổi |
|---|---|---|
| 2026-07-26 | v2.4 | **Public capacity-guard delegation, executed (`docs-marketplace-public-capacity-guard`):** §2 Edge Cases gets new row #15 pinning `visibility='public'` + `slots_max IS NULL` existing outside the SessionService validation choke-point (legacy/fixture/writer bypass — DB column stays nullable, no CHECK) as an invalid state, cross-ref `feature_session_management_tech.md` §2 (Capacity × visibility, PRD E#7 authority). §4 Projector Logic gate made explicit — `required fields present?` for `visibility='public'` now spells out `slots_max IS NOT NULL` — plus a new note pinning the concrete handling: projector does not upsert, deletes any pre-existing projection row for that session, purges the cached public DTO/CDN entry for that session (same trigger class as unpublish — §4 Caching Strategy), emits an audit/integrity signal, and CONTINUEs the batch (does not halt the projector on one bad row). §4 Caching Strategy Invalidation cell for Public session DTO extended to name this fail-closed skip as a purge trigger alongside unpublish. Added unit test #26 (invalid-but-previously-cached fixture + sibling-still-projects regression, asserting both the projection row and the cache/CDN entry are purged — catches a halt-on-fault implementation and a stale-cache-serves-invalid-row implementation). This slice executes the technical delegation `feature_session_management_tech.md` §2 already assigned to this doc as owner of public projection — it does not re-open that decision. No schema/migration/DB CHECK change: the hardening candidate `NOT (visibility='public' AND slots_max IS NULL)` stays an unscoped future migration exactly as `feature_session_management_tech.md` §2 already records it. |
| 2026-07-24 | v2.3 | **Public-projection timing, explicit (`docs-prd-flow2-publish-projection-reconcile`, hard dependency of `docs-session-publish-contract`):** §4 Projector Logic gets an explicit timing note — `open?` = `sessions.status='open'`, reached only after Host publish (`PublishSession`, `draft`→`open`; `feature_session_management_tech.md` §4 bước 7); a public `draft` is NOT projected. Added edge case #14 + unit test #25 pinning draft-exclusion; integration test #1 setup reworded from "Create public session → search" to explicit create(`draft`)→publish(`open`)→search so it no longer implies project-on-create. No schema/algorithm change — the `public? open?` gate already existed (edge #3); this closure only makes the authority explicit and closes the PRD/session cross-authority conflict. |
| 2026-07-19 | v2.2 | **Template v2.30/v2.33 uplift:** thêm §2 Migration & Rollback (reuse `public_sessions` từ `0006`; DD-41 expand→contract = migration mới monotonic), §3 Request/Response Examples (DD-60 envelope) + Idempotency, §4 Caching Strategy + Security Checklist. Derivative/editorial — không đổi contract. |
| 2026-07-19 | v2.1a | Metadata sweep (index v2.35): thêm trường **Implementation** đồng bộ BUILD-STATUS (Not started). Không đổi contract. |
| 2026-07-17 | v2.1 | **Live schema/DD-46 closure:** replace invalid `now()` partial index with live plain btree; pin no-FK public reference, personal-tenant owner-membership alias fail-closed projection, and deterministic time ranking while MKT-OQ-3 stays open. |
| 2026-06-18 | v1.0 | Initial BE tech spec (English format) |
| 2026-06-19 | v2.0 | Chuẩn hoá Vietnamese numbered (6 sections), DDL, 12 edge cases, 20 tests |
