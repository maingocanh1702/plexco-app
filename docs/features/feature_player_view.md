# Feature: Player View (Person-self) — Product/UX Spec

> **Canonical phase:** P4.6  
> **Track:** 👤 Player View  
> **Version:** 2.4 · 2026-07-28
> **Status:** Reviewed  
> **Implementation:** Not started · authority: `../standards/BUILD-STATUS.md` (Doc status ≠ Implementation status)  
> **Prerequisites:** P3.5 identity · P3 ledger · P4 web auth/magic link · P4 sync realtime  
> **Tài liệu liên quan:** `../product/BRD.md` FR-8 · `../product/PRD.md` FLOW 10 · `../product/TDD.md` §3.4/§4 (person-self contract) · `BE/feature_player_view_tech.md` · `../standards/decisions.md` DD-91 · `../proposals/in-app-chat-primary-player-surface-plan-2026-07-27.md`

> **DD-48 boundary:** `/me` vẫn person-self và không nhận arbitrary person id. Cross-user social profile thuộc `feature_user_settings` (`GET /api/persons/:id/profile`) với DTO riêng; host operational member/roster data đi tenant-scoped path riêng. Không tái dùng `/me` serializer cho hai path đó.

> **DD-91 primary-surface boundary:** một canonical person-self service `getSelfPaymentStatus` cấp cùng payment truth cho `/api/me/charges`, chat `/pay` và authenticated notification detail. Human DM có `tenant_id=NULL`, nên `/pay` không được đoán CLB từ peer/channel: server auto-select khi requester chỉ có một CLB đủ điều kiện, còn nhiều CLB thì trả picker opaque chỉ requester thấy. Không surface nào nhận arbitrary `person_id`; lỗi authz/integrity/dependency trả trạng thái `unknown`, không biến null/unproven thành 0.

> **Execution ownership:** mechanism slices 17 `player-self-charge-read-core`, 18 `player-self-profile-clubs-read-core` và 19 `player-self-sessions-waitlist-read-core` là ba read owner tách biệt; chat adapters 24–26 chỉ compose các owner này qua requester-only transport. Slice 19 được author read-only trực tiếp trên baseline `players JOIN memberships JOIN sessions` đã merge và **không** hard-depend full SessionService. Tuy nhiên `/sessions|/waitlist` beta giữ OFF cho tới khi strict current-authority packets `svc-session-crud`, `svc-session-join-leave`, `svc-waitlist-promotion-core` cùng production-shaped data E2E đều xanh. Reviewed doc không biến các packet hay runtime đó thành implemented; primary initiative vẫn `NOT_PLAN_READY` tới immutable authority re-pin.

---

## 1. Mô tả

Cho verified player xem **chỉ dữ liệu của chính mình**: clubs, upcoming sessions, charges/payment status và join requests **across tenants** trên web và bot. Đây là privileged cross-tenant read path — KHÔNG phải tenant-admin access.

### Bất biến

- Person authority chỉ từ **verified session/magic link** — KHÔNG từ URL/body person ID.
- DTO allowlisted: chỉ own membership/session/charge/allocation status — KHÔNG other roster/debt/admin fields.
- Cross-tenant errors KHÔNG reveal inaccessible club existence.
- `/api/me/charges`, chat `/pay` và authenticated notification detail phải đọc cùng `getSelfPaymentStatus`; không surface nào tự tính lại số còn nợ.
- Số 0 chỉ được hiển thị khi ledger chứng minh `SelfPaymentStatus.kind="known_zero"`; dữ liệu thiếu/không xác minh được phải fail-closed thành `unknown`.

---

## 2. Use Cases + Edge Cases

### Use Cases

| ID | Actor | Hành động | Kết quả |
|---|---|---|---|
| PVW-UC-1 | Player (web) | Authenticate + view /me dashboard | Own clubs + sessions + debts summary |
| PVW-UC-2 | Player (Zalo) | Nhận magic link → open web | Same person view as Google/email-authenticated web |
| PVW-UC-3 | Player (Messenger) | Chọn **My Clubs** trong persistent menu | Concise club/debt/session list trong cửa sổ hợp lệ |
| PVW-UC-4 | System | Join/payment/merge event | Realtime invalidate/refetch own data |
| PVW-UC-5 | Player | View active club memberships | List with role, status, debt summary |
| PVW-UC-6 | Player | View upcoming sessions across clubs | Timeline sorted by date |
| PVW-UC-7 | Player | View charge/payment status | Paid/partial/unpaid + allocation details |
| PVW-UC-8 | Player | View join request status | Pending/approved/rejected/expired |
| PVW-UC-9 | System | Account merge | Immediately converge to canonical Person view |
| PVW-UC-10 | Player | View left-club history | Historical ledger visible, membership status clear |
| PVW-UC-11 | Player | Gõ exact `/pay` trong club chat hoặc private bot thread | Card payment status của chính mình, chỉ requester thấy |
| PVW-UC-12 | Player | Gõ exact `/pay` trong human DM | Một CLB đủ điều kiện thì mở thẳng; nhiều CLB thì picker opaque chỉ requester thấy, peer không nhận command/result |
| PVW-UC-13 | Player | Mở authenticated payment notification detail | Cùng status/remaining amount như `/api/me/charges` và `/pay` tại thời điểm đọc |
| PVW-UC-14 | Player | Gõ exact `/sessions` hoặc `/waitlist` trong club chat/private Club Bot | Requester-only DTO của chính mình từ canonical person-self read; chỉ bật beta sau current Session packets + production-shaped data E2E |

### Edge Cases

| # | Category | Case | Hành vi bắt buộc |
|---|----------|------|-------------------|
| 1 | Security | URL/body chứa arbitrary person ID | Reject — chỉ accept verified session/magic link |
| 2 | Security | DTO chứa other-player roster/debt | ❌ NEVER — allowlist enforced |
| 3 | Data Integrity | Club display sau khi left | Hiện với clear "Đã rời" status — historical ledger visible |
| 4 | Security | Magic link replay/expired | Reject — hash-only, TTL, single-use, session-rotating |
| 5 | Security | Magic link wrong channel/person | Reject — channel/person bound |
| 6 | Cross-Feature | Account merge → old magic links | Invalidate old links/topics — use merged person |
| 7 | Security | Cross-tenant error reveal club existence | ❌ NEVER — return 403/empty, KHÔNG leak club name/info |
| 8 | Data Integrity | Partial/overpay/unallocated bank tx | Display only khi safely attributable to person |
| 9 | Security | Realtime topic guessing | 403 — authz enforced per topic |
| 10 | Resilience | Realtime disconnect | Fallback refetch/polling — no data loss |
| 11 | Security | Log/analytics chứa other-player PII | ❌ NEVER — opaque IDs only |
| 12 | Data Integrity | Merge session revocation | Old sessions/links invalidated immediately |
| 13 | Security | Human DM `/pay` có `tenant_id=NULL` | Không suy tenant từ peer; resolve chỉ từ own eligible memberships, trả picker opaque actor-bound khi có nhiều CLB |
| 14 | Privacy | Peer trong human DM quan sát slash/result | ❌ NEVER — command, picker và result là requester-only; không ghi shared message/history/notification |
| 15 | Data Integrity | Ledger/authz/dependency không chứng minh được balance | Trả `unknown` + retry/fallback generic; không diễn giải null/error là không nợ |
| 16 | Security | Client gửi `person_id`/raw `tenant_id` cùng `/pay` hoặc notification detail | Reject/ignore fail-closed; person từ authenticated context, CLB từ trusted channel hoặc opaque actor-bound ref |
| 17 | Enablement | Slice 19 read tests xanh nhưng một Session packet hoặc production-shaped E2E còn thiếu | Giữ `/sessions|/waitlist` beta OFF; không suy full Session authority từ read core |

---

## 3. Screens & States

| Surface | Screen | Loading | Ready | Error | Empty |
|---------|--------|---------|-------|-------|-------|
| Web | /me dashboard | Skeleton cards | Clubs + upcoming sessions + debt overview | Error banner + retry | "Chưa tham gia club nào" + Discover CTA |
| Web | /me — club detail | Skeleton | Sessions + charges for this club | Error banner | "Chưa có buổi chơi" |
| Web | /me — charge detail | Skeleton | Payment status + allocation breakdown | Error banner | N/A |
| Web | /me — join requests | Skeleton list | Pending/approved/rejected list | Error banner | "Không có yêu cầu nào" |
| Web | Auth required (unauthenticated /me) | — | Login CTA + magic link instructions | — | N/A |
| Web | Account merged banner | — | "🔄 Tài khoản đã được gộp — dữ liệu cập nhật" | — | N/A |
| Zalo/Messenger Bot | `/myclubs` (Zalo) · menu (Messenger) | "Đang tải..." | Club list + debt + upcoming session per club | "Lỗi" | "Bạn chưa tham gia club nào" |
| In-app chat | Exact `/pay` — club chat/private bot thread | "Đang kiểm tra..." | Requester-only payment status card | "Không kiểm tra được lúc này" + retry | "Bạn không còn khoản phải trả" chỉ khi ledger chứng minh |
| In-app human DM | Exact `/pay` | "Đang tải CLB..." | Một CLB → requester-only card; nhiều CLB → opaque club picker | Generic retry, không leak club | "Không có CLB phù hợp" |
| In-app notification | Authenticated payment detail | "Đang cập nhật..." | Canonical current payment status | Generic retry | Proven no-open-debt state |
| In-app chat / Club Bot | Exact `/sessions` / `/waitlist` | "Đang tải..." | Own upcoming/session/waitlist status từ canonical read | Generic retry; beta route OFF nếu Session gate chưa đủ | Không có session/waitlist item |

---

## 4. Domain Model

| Entity | Vai trò | Key constraints |
|--------|---------|-----------------|
| `persons` | Global identity | Verified/linked via web auth (Google/email target) và channel identities Zalo/Messenger; Telegram chỉ legacy |
| `memberships` | Person ↔ Tenant per club | `UNIQUE(person_id, tenant_id)`, historical kept |
| `players` | Player in sessions | `tenant_id`, `session_id`, `membership_id`, `status` |
| `charges` | Payment obligations | `player_id`, `membership_id`, `session_id`, effective status |
| `payment_allocations` | Bank tx/manual/cash → charge ledger | `charge_id`, `bank_transaction_id`, `amount`, `source` |
| `magic_links` | Short-lived web access tokens | `UNIQUE(hash)`, `person_id`, `channel`, `expires_at`, `used_at` |

---

## 5. Analytics Events

| Event | Khi nào | Payload tối thiểu |
|-------|---------|-------------------|
| `player_view_opened` | Player access /me | `person_id` (opaque), `source` (web/bot), `auth_method` |
| `magic_link_consumed` | Magic link used successfully | `person_id` (opaque), `channel` |
| `magic_link_failed` | Magic link invalid/expired | `reason` (expired/used/wrong_person) |
| `player_own_debt_viewed` | Player views charge details | `person_id` (opaque), `club_count`, `surface ∈ {web,chat,notification}` |
| `player_realtime_reconnect` | Realtime reconnect after disconnect | `person_id` (opaque) |

> Opaque person/session IDs only. No other-player PII.

---

## 6. Acceptance Criteria

- [ ] Player sees all and only their own memberships/sessions/charges
- [ ] Arbitrary person/tenant/topic guessing returns 403/empty safely
- [ ] Magic link security/replay/expiry tests pass
- [ ] Merge and membership-left history render correctly
- [ ] Partial/paid/cash/reversal status matches ledger
- [ ] Realtime authorization/reconnect/refetch works
- [ ] DTO/log/analytics contain no other-player PII
- [ ] `/api/me/charges`, chat `/pay` và authenticated notification detail trả cùng canonical `getSelfPaymentStatus` cho cùng snapshot; không consumer nào tự tính remaining amount.
- [ ] Human-DM `/pay` không suy tenant từ peer: một own eligible club auto-select, nhiều club dùng opaque actor-bound picker; peer không thấy command/picker/result và shared history không có artifact.
- [ ] Mọi person/club authority đến từ authenticated context, trusted club channel hoặc opaque requester-bound ref; arbitrary `person_id`/raw `tenant_id` không được chấp nhận.
- [ ] Null, authz failure, integrity failure và dependency failure trả `unknown`; chỉ proven `known_zero` mới hiển thị 0.
- [ ] Slice 19 chỉ đọc baseline `players/memberships/sessions`, không duplicate join/leave/promotion/session business rules và không cần full SessionService để author.
- [ ] `/sessions|/waitlist` beta chỉ enable khi cả ba strict current-authority packets `svc-session-crud`, `svc-session-join-leave`, `svc-waitlist-promotion-core` và production-shaped data E2E đều pass; tên cơ chế trong analysis cũ không tự là authority.

---

## 7. Open Questions / Changelog

### Changelog

| Date | Version | Thay đổi |
|---|---|---|
| 2026-07-28 | v2.4 | Mirror mechanism slices 17–19 và chat adapters 24–26. Pin slice 19 là read-only trên baseline đã merge, không hard-depend full SessionService; `/sessions|/waitlist` beta vẫn OFF tới strict current packets `svc-session-crud`/`svc-session-join-leave`/`svc-waitlist-promotion-core` + production-shaped data E2E. No runtime authorization. |
| 2026-07-27 | v2.3 | Mirror DD-91: canonical `getSelfPaymentStatus` cho web `/me/charges`, chat `/pay` và authenticated notification detail; human-DM picker requester-only vì `tenant_id=NULL`; fail-closed `unknown`, không arbitrary IDs/null→zero. Giữ Reviewed/not implemented. |
| 2026-07-19 | v2.2a | Metadata sweep (index v2.35): thêm trường **Implementation** đồng bộ BUILD-STATUS (Not started). Không đổi contract. |
| 2026-07-15 | v2.2 | **DD-37 closure:** active bot use cases chỉ còn Zalo/Messenger; thay TG-authenticated `/myclubs` bằng web-auth + Messenger persistent-menu contract. Telegram chỉ legacy trong domain note. |
| 2026-06-18 | v1.0 | Initial spec (English format) |
| 2026-06-19 | v2.0 | Chuẩn hoá Vietnamese numbered, thêm 10 use cases, 12 edge cases, /me dashboard screens |
| 2026-07-13 | v2.1 | Reconcile live schema: `players`, `charges.player_id/membership_id`, `payment_allocations`; auth/channel wording separates target from Telegram legacy. |
