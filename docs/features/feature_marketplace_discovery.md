# Feature: Marketplace Discovery & Public Projection — Product/UX Spec

> **Canonical phase:** P4.3  
> **Track:** 🔍 Discovery & Marketplace  
> **Version:** 2.4 · 2026-07-28
> **Status:** Reviewed  
> **Implementation:** Not started — `public_sessions` có sẵn và `0024` đã enforce public session phải finite-capacity; publish/projector/routes/UI vẫn chưa có · authority: `../standards/BUILD-STATUS.md` (Doc status ≠ Implementation status). *Tail migration hiện hành là `0029` (đo 06/08 tại `2cd52ce`), nhưng `0025`–`0029` không chạm marketplace: rename CHECK, definer read-only và DD-29 billing registry.*
> **Prerequisites:** P2 session management · P4 sync/public projector  
> **Tài liệu liên quan:** `../product/BRD.md` FR-3/NFR-S2 · `../product/PRD.md` FLOW 12 · `../product/TDD.md` §3.9 · `../standards/decisions.md` DD-32 · `feature_channel_booking_funnel.md` · BRD OD-6/OD-8 · `BE/feature_marketplace_discovery_tech.md`

---

## 1. Mô tả

Cho bất kỳ player nào tìm **public sessions đang joinable** across clubs/sports — mà KHÔNG expose tenant-private roster, money, contact hay exact venue. Cover: publishing, filtering/ranking, detail view, privacy, expiry và abuse controls. Joining là feature riêng (cross_club_join).

### Bất biến

- Public serializer **chỉ** emit whitelist fields — không bao giờ expose internal routing/tenant ID.
- Private/**draft** (chưa publish)/incomplete/closed/cancelled/past sessions **KHÔNG BAO GIỜ** xuất hiện.
- Exact venue chỉ reveal khi canonical player outcome là `active`; approved-but-waitlisted vẫn ẩn.
- `confirmed_count` là canonical active players; `slots_open = max(0, slots_max - active players - live payment holds)`. Hai field public là advisory projection từ một shared occupancy helper; hold count không public và final confirm luôn recheck transactionally.
- Messenger central mặc định global discovery; tenant Page mặc định local + “Khám phá tất cả”. Mỗi trang tối đa 8 business choices; Join CTA là opaque action, không raw routing ID.

---

## 2. Use Cases + Edge Cases

### Use Cases

| ID | Actor | Hành động | Kết quả |
|---|---|---|---|
| MKT-UC-1 | Host | Set session public (chỉ tại create hoặc edit — `PublishSession` status-only, không đổi `visibility`) | Projection appears sau sync projector — chỉ khi session đồng thời `status='open'`; còn `draft` (chưa Host publish) thì chưa xuất hiện dù đã set public |
| MKT-UC-2 | Player (anon) | Browse sessions — filter sport/area/time | Results list + no-result fallback |
| MKT-UC-3 | Player (auth) | Filter thêm skill/price/available slot | Filtered results |
| MKT-UC-4 | Player | Mở public detail | Session info (whitelist) + Join CTA |
| MKT-UC-5 | Player | Proceed to join flow | Web → cross-club join; Zalo/Messenger → shared DD-32 safe detail + final link-or-pay gate |
| MKT-UC-6 | Host | Edit session (time/price/visibility) | Projection updates via projector |
| MKT-UC-7 | Host | Set session private/close/cancel | Projection removed immediately |
| MKT-UC-8 | System | Session expired | Auto-disappear — expiry guard |
| MKT-UC-9 | Player | Search với unknown filters | Empty results + filter reset CTA — KHÔNG expose taxonomy internals |
| MKT-UC-10 | System | Rate-limit exceeded | 429 — "Quá nhiều truy vấn, thử lại sau" |

### Edge Cases

| # | Category | Case | Hành vi bắt buộc |
|---|----------|------|-------------------|
| 1 | Security | Private session leak vào public | ❌ NEVER — projector chỉ emit khi `visibility=public` **và** `status='open'` + required fields present; `draft` không bao giờ project dù đã set public |
| 2 | Security | Tenant routing ID serialized | ❌ NEVER — internal routing ID stripped from public response |
| 3 | Security | Exact venue/address trong browse | ❌ NEVER — chỉ area (quận/khu vực). Ref: OD-6 |
| 4 | Security | Roster/membership/bank/charge/payment/PII leak | ❌ NEVER — strict whitelist |
| 5 | Data Integrity | Aggregate counts stale khi browse | Advisory only — final join/hold rechecks shared occupancy under session lock |
| 6 | Security | Pagination enumeration attack | Stable cursors + rate-limit per IP/session/account |
| 7 | Data Integrity | Club/host display name inappropriate | Moderation/privacy policy gate — reject offensive names |
| 8 | Data Integrity | Projector lag > SLO | Expiry guard prevents stale past offers |
| 9 | Security | Ranking dùng financial/identity data | ❌ NEVER — ranking explainable, chỉ dùng public attributes |
| 10 | Data Integrity | Closed/cancelled session vẫn trong search index | Projector must delete — reproject verifies clean |
| 11 | Security | Unknown filter values probe taxonomy | Return empty — KHÔNG expose taxonomy internals in error |
| 12 | Security | Scraping/bot abuse | Rate-limit + CAPTCHA challenge sau threshold |
| 13 | Privacy | Personal-tenant session has blank/unverified owner alias | Fail closed: do not project; never fall back to internal tenant name, person name or account identity |

---

## 3. Screens & States

| Surface | Screen | Loading | Ready | Error | Empty |
|---------|--------|---------|-------|-------|-------|
| Web | Marketplace browse | Skeleton cards (3x2 grid) | Session cards: sport icon, area, time, price, confirmed count, slots, join CTA | Error banner + retry | "Không tìm thấy buổi chơi nào" + filter reset CTA |
| Web | Filter panel | — | Sport/area/time/skill/price/slot pickers | — | N/A |
| Web | Session public detail | Skeleton | Whitelist info + Join CTA | "Buổi chơi không còn khả dụng" | N/A |
| Web | Rate-limited | — | "Quá nhiều truy vấn — thử lại sau [countdown]" | — | N/A |
| Zalo/Messenger Bot | `/search` (Zalo) · quick-reply (Messenger) | "🔍 Đang tìm..." | Messenger: max 8 kết quả/page + Prev/Next/Cancel; Zalo theo number-reply contract | "Không tìm thấy" | "Không có buổi nào phù hợp" |

---

## 4. Domain Model

| Entity | Vai trò | Key constraints |
|--------|---------|-----------------|
| `public_sessions` | Materialized public read/projection table | Whitelist columns only; `id=session.id` + internal `session_id` reference **without FK by design** so public plane cannot cascade/query canonical tenant tables; auto-expire |
| `sessions` | Canonical source | `visibility` enum, required discovery fields |

### Public Contract (whitelist)

| Field | Nguồn | Notes |
|-------|-------|-------|
| `session_id` (opaque) | sessions.id | Masked — không expose internal routing |
| `sport_key` | sessions.sport_id → sports | Taxonomy key |
| `starts_at` / `ends_at` | sessions | UTC timestamptz |
| `area` | sessions.area | Coarse — quận/khu vực, KHÔNG address |
| `skill_level` | sessions | **Live legacy only** during DD-41 expand/backfill; must disappear from projection at cutover |
| `level_min_rank` / `level_max_rank` / `level_strict` | sessions policy (DD-41 target) | Ordered DD-08 ranks + advisory/hard flag; replaces `skill_level`, never exposes a player's level |
| `price` | sessions.price_amount | Amount in VND |
| `confirmed_count` | active `players` count | Advisory aggregate; no roster identity |
| `slots_open` | shared occupancy helper | `max(0, slots_max - active - live holds)`; advisory |
| `club_display_name` | Club tenant: moderated `tenants.display_name`; personal tenant (DD-46 target): owner membership `display_name` | Personal tenant must never expose internal tenant name; blank alias => no projection |
| `host_display_name` | memberships.display_name | Moderated; never raw person/account identity fallback |
| `join_policy` | sessions | open / approval |

> **Excluded:** tenant_id, venue address, roster, phone, email, bank, charges, channel IDs.

> **DD-41 target delta (decided, migration pending):** expand projector/API to public `title`, `session_type`, `level_min_rank`, `level_max_rank`, `level_strict`, `gender_restriction`, `age_min`, `age_max`; backfill rank fields, switch readers, then stop projecting/drop legacy `skill_level`. `notes`, `instructions`, `byoe`, `cost_shared` remain private. Until this expand→contract slice lands, the live legacy field is compatibility evidence, not the final Product contract.

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
- [ ] Messenger central/tenant Page local-vs-global context đúng; opaque action TTL/snapshot/replay tests pass
- [ ] Public DTO emits `confirmed_count` + `slots_open` from one shared occupancy projection; hold count/identities remain private, adapters never re-derive and final mutation ignores stale counts.
- [ ] Personal-tenant session uses only nonblank moderated owner-membership alias for `club_display_name`; blank alias stays absent and internal tenant/person name never leaks

---

## 7. Open Questions / Changelog

### Open Questions

| ID | Quyết định | Trạng thái |
|---|---|---|
| MKT-OQ-1 | BRD OD-6: public location granularity | ✅ Chốt (DD-06, clarified v1.60): **`area` only public; venue active-only** (approved-waitlisted no venue). |
| MKT-OQ-2 | BRD OD-8: initial sport/skill taxonomy | ✅ Chốt (DD-08, 2026-07-13): 7 môn seed (badminton/pickleball/tennis/padel/volleyball/basketball/football, extensible qua `sports`) + level 5-bậc ordered rank. |
| MKT-OQ-3 | Initial ranking: upcoming/area vs optional distance provider | ⬜ Chưa chốt |

### Changelog

| Date | Version | Thay đổi |
|---|---|---|
| 2026-07-28 | v2.4 | Mirror DD-32 public aggregates: confirmed active count and slots-open (active + live holds) from one occupancy helper; hold count stays private. Bot Join CTA routes safe detail/final gate while web retains cross-club join. No projector/runtime claim. |
| 2026-07-27 | v2.3 | Mirror `0024`: public + unlimited capacity đã bị DB CHECK loại và dữ liệu hiện có đã validate; đây là invariant nền, không phải publish/projector/Marketplace runtime. |
| 2026-07-24 | v2.2b | **Public-projection timing, explicit (`docs-prd-flow2-publish-projection-reconcile`, hard dependency of `docs-session-publish-contract`):** MKT-UC-1 + edge #1 + Bất biến bullet reworded to require `status='open'` in addition to `visibility='public'` — a `draft` session is never projected regardless of visibility. Closes the same cross-authority conflict already fixed in `BE/feature_marketplace_discovery_tech.md` §4 and PRD FLOW 2/12/14; this Product-spec mirror was the codex round-01 P1 gap (Reviewed spec still permitted project-on-visibility-alone). Codex round-02 [P2]: MKT-UC-1 wording corrected — `visibility` is set only at create/edit, never at publish (`PublishSession` is status-only per `feature_session_management_tech.md` §4; publish only flips `draft`→`open`, which is what actually triggers the already-public row to project). No schema/algorithm change. |
| 2026-07-19 | v2.2a | Metadata sweep (index v2.35): thêm trường **Implementation** đồng bộ BUILD-STATUS (Not started). Không đổi contract. |
| 2026-07-17 | v2.2 | **Live/DD-46 projection closure:** document intentional no-FK public session reference; personal tenants source public club alias only from owner membership and fail closed when blank; ranking remains deterministic time-order until MKT-OQ-3 is resolved. |
| 2026-07-17 | v2.1 | **DD-65/66/68:** Messenger central global vs tenant Page local-default discovery; max 8 business choices/page và opaque Join actions. |
| 2026-06-18 | v1.0 | Initial spec (English format) |
| 2026-06-19 | v2.0 | Chuẩn hoá Vietnamese numbered, thêm 10 use cases, 12 edge cases, public contract whitelist, screen states |
