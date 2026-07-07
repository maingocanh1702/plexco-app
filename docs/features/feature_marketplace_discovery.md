# Feature: Marketplace Discovery & Public Projection — Product/UX Spec

> **Canonical phase:** P4.3  
> **Track:** 🔍 Discovery & Marketplace  
> **Version:** 2.0 · 2026-06-19  
> **Status:** Reviewed  
> **Prerequisites:** P2 session management · P4 sync/public projector  
> **Tài liệu liên quan:** `../product/BRD.md` FR-3/NFR-S2 · `../product/PRD.md` FLOW 12 · `../product/TDD.md` §3.9 · BRD OD-6/OD-8 · `BE/feature_marketplace_discovery_tech.md`

---

## 1. Mô tả

Cho bất kỳ player nào tìm **public sessions đang joinable** across clubs/sports — mà KHÔNG expose tenant-private roster, money, contact hay exact venue. Cover: publishing, filtering/ranking, detail view, privacy, expiry và abuse controls. Joining là feature riêng (cross_club_join).

### Bất biến

- Public serializer **chỉ** emit whitelist fields — không bao giờ expose internal routing/tenant ID.
- Private/incomplete/closed/cancelled/past sessions **KHÔNG BAO GIỜ** xuất hiện.
- Exact venue chỉ reveal sau successful join/approval.
- `slots_open` trong browse là advisory — join recheck capacity transactionally.

---

## 2. Use Cases + Edge Cases

### Use Cases

| ID | Actor | Hành động | Kết quả |
|---|---|---|---|
| MKT-UC-1 | Host | Set session public | Projection appears sau sync projector |
| MKT-UC-2 | Player (anon) | Browse sessions — filter sport/area/time | Results list + no-result fallback |
| MKT-UC-3 | Player (auth) | Filter thêm skill/price/available slot | Filtered results |
| MKT-UC-4 | Player | Mở public detail | Session info (whitelist) + Join CTA |
| MKT-UC-5 | Player | Proceed to join flow | → Redirect sang cross_club_join |
| MKT-UC-6 | Host | Edit session (time/price/visibility) | Projection updates via projector |
| MKT-UC-7 | Host | Set session private/close/cancel | Projection removed immediately |
| MKT-UC-8 | System | Session expired | Auto-disappear — expiry guard |
| MKT-UC-9 | Player | Search với unknown filters | Empty results + filter reset CTA — KHÔNG expose taxonomy internals |
| MKT-UC-10 | System | Rate-limit exceeded | 429 — "Quá nhiều truy vấn, thử lại sau" |

### Edge Cases

| # | Category | Case | Hành vi bắt buộc |
|---|----------|------|-------------------|
| 1 | Security | Private session leak vào public | ❌ NEVER — projector chỉ emit visibility=public + required fields present |
| 2 | Security | Tenant routing ID serialized | ❌ NEVER — internal routing ID stripped from public response |
| 3 | Security | Exact venue/address trong browse | ❌ NEVER — chỉ area (quận/khu vực). Ref: OD-6 |
| 4 | Security | Roster/membership/bank/charge/payment/PII leak | ❌ NEVER — strict whitelist |
| 5 | Data Integrity | `slots_open` stale khi browse | Advisory only — join rechecks transactionally |
| 6 | Security | Pagination enumeration attack | Stable cursors + rate-limit per IP/session/account |
| 7 | Data Integrity | Club/host display name inappropriate | Moderation/privacy policy gate — reject offensive names |
| 8 | Data Integrity | Projector lag > SLO | Expiry guard prevents stale past offers |
| 9 | Security | Ranking dùng financial/identity data | ❌ NEVER — ranking explainable, chỉ dùng public attributes |
| 10 | Data Integrity | Closed/cancelled session vẫn trong search index | Projector must delete — reproject verifies clean |
| 11 | Security | Unknown filter values probe taxonomy | Return empty — KHÔNG expose taxonomy internals in error |
| 12 | Security | Scraping/bot abuse | Rate-limit + CAPTCHA challenge sau threshold |

---

## 3. Screens & States

| Surface | Screen | Loading | Ready | Error | Empty |
|---------|--------|---------|-------|-------|-------|
| Web | Marketplace browse | Skeleton cards (3x2 grid) | Session cards: sport icon, area, time, price, slots, join CTA | Error banner + retry | "Không tìm thấy buổi chơi nào" + filter reset CTA |
| Web | Filter panel | — | Sport/area/time/skill/price/slot pickers | — | N/A |
| Web | Session public detail | Skeleton | Whitelist info + Join CTA | "Buổi chơi không còn khả dụng" | N/A |
| Web | Rate-limited | — | "Quá nhiều truy vấn — thử lại sau [countdown]" | — | N/A |
| TG Bot | `/search` command | "🔍 Đang tìm..." | Inline results (max 10) + "Xem thêm" link | "Không tìm thấy" | "Không có buổi nào phù hợp" |

---

## 4. Domain Model

| Entity | Vai trò | Key constraints |
|--------|---------|-----------------|
| `public_sessions` | Materialized view / projection table | Whitelist columns only, `session_id` FK, auto-expire |
| `sessions` | Canonical source | `visibility` enum, required discovery fields |

### Public Contract (whitelist)

| Field | Nguồn | Notes |
|-------|-------|-------|
| `session_id` (opaque) | sessions.id | Masked — không expose internal routing |
| `sport_key` | sessions.sport_id → sports | Taxonomy key |
| `starts_at` / `ends_at` | sessions | UTC timestamptz |
| `area` | sessions.area | Coarse — quận/khu vực, KHÔNG address |
| `skill_level` | sessions | Optional enum |
| `price` | sessions.price_amount | Amount in VND |
| `slots_open` | calculated | Advisory |
| `club_display_name` | tenants.display_name | Moderated |
| `host_display_name` | memberships.display_name | Moderated |
| `join_policy` | sessions | open / approval |

> **Excluded:** tenant_id, venue address, roster, phone, email, bank, charges, channel IDs.

---

## 5. Analytics Events

| Event | Khi nào | Payload tối thiểu |
|-------|---------|-------------------|
| `marketplace_searched` | Player search/filter | `filters_used[]` (bucketed), `result_count`, `source` (web/bot) |
| `marketplace_detail_opened` | Player mở session detail | `session_id` (opaque), `source` |
| `marketplace_join_cta_clicked` | Player click Join | `session_id` (opaque), `source` |
| `marketplace_no_results` | Search trả 0 results | `filters_used[]` |
| `marketplace_projection_lag` | Projector lag > threshold | `lag_ms`, `threshold_ms` |

> Không retain IP, PII, raw location ngoài security policy.

---

## 6. Acceptance Criteria

- [ ] Public serializer exactly match whitelist — penetration test pass
- [ ] Private/closed/cancelled/expired sessions absent from search
- [ ] Filters sport/area/time/skill/price/slot work correctly
- [ ] Exact venue và tenant routing ID KHÔNG BAO GIỜ leak
- [ ] Edit/close/reproject converge correctly
- [ ] Rate-limit/pagination/cache không bypass privacy
- [ ] Public invariant test pass under replay
- [ ] Browse latency target documented và met

---

## 7. Open Questions / Changelog

### Open Questions

| ID | Quyết định | Trạng thái |
|---|---|---|
| MKT-OQ-1 | BRD OD-6: public location granularity (quận vs bán kính) | ⬜ Chưa chốt |
| MKT-OQ-2 | BRD OD-8: initial sport/skill taxonomy | ⬜ Chưa chốt |
| MKT-OQ-3 | Initial ranking: upcoming/area vs optional distance provider | ⬜ Chưa chốt |

### Changelog

| Date | Version | Thay đổi |
|---|---|---|
| 2026-06-18 | v1.0 | Initial spec (English format) |
| 2026-06-19 | v2.0 | Chuẩn hoá Vietnamese numbered, thêm 10 use cases, 12 edge cases, public contract whitelist, screen states |
