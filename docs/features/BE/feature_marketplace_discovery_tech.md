# Feature: Marketplace Discovery & Public Projection — Backend Tech Spec

> **Canonical phase:** P4.3  
> **Version:** 2.0 · 2026-06-19  
> **Status:** Reviewed  
> **Product spec:** `../feature_marketplace_discovery.md`  
> **References:** `../../core/TDD.md` §3.9

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

CREATE INDEX idx_public_starts ON public_sessions(starts_at) WHERE starts_at > now();
CREATE INDEX idx_public_sport_time ON public_sessions(sport_key, starts_at);
CREATE INDEX idx_public_area_time ON public_sessions(area, starts_at);
CREATE INDEX idx_public_price ON public_sessions(price_amount);
```

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
| `skill` | string | Skill level |
| `max_price` | integer | Price ceiling |
| `available_only` | boolean | Only sessions with slots |
| `cursor` | string | Opaque pagination cursor |

### Error Codes

| Code | Error Code | Message | Trigger |
|------|-----------|---------|---------|
| 429 | `DISCOVERY_RATE_LIMITED` | Quá nhiều truy vấn | Rate limit exceeded |
| 400 | `INVALID_FILTER` | Bộ lọc không hợp lệ | Unknown filter value |

---

## 4. Chi tiết triển khai

### Ranking

- Version explicit for analytics/reproducibility.
- Default: upcoming sessions by `starts_at`, weighted by area proximity.
- Ranking KHÔNG dùng financial/identity data.
- Bounded date range/page size enforced.

### Projector Logic

```text
Session event → Check: public? open? future? required fields present?
  → YES: Upsert public_sessions (reload canonical safe fields)
  → NO: Delete from public_sessions
Periodic sweep: DELETE WHERE expires_at < now()
```

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

### Integration Tests

| # | Test | Setup | Expected |
|---|------|-------|----------|
| 1 | Publish → search → find | Create public session → search | Found in results |
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
| 2026-06-18 | v1.0 | Initial BE tech spec (English format) |
| 2026-06-19 | v2.0 | Chuẩn hoá Vietnamese numbered (6 sections), DDL, 12 edge cases, 20 tests |
