# Feature: Player View (Person-self) — Product/UX Spec

> **Canonical phase:** P4.6  
> **Track:** 👤 Player View  
> **Version:** 2.0 · 2026-06-19  
> **Status:** Reviewed  
> **Prerequisites:** P3.5 identity · P3 ledger · P4 web auth/magic link · P4 sync realtime  
> **Tài liệu liên quan:** `../core/BRD.md` FR-8 · `../core/PRD.md` FLOW 10 · `../core/TDD.md` §3.4/§4 (person-self contract) · `BE/feature_player_view_tech.md`

---

## 1. Mô tả

Cho verified player xem **chỉ dữ liệu của chính mình**: clubs, upcoming sessions, charges/payment status và join requests **across tenants** trên web và bot. Đây là privileged cross-tenant read path — KHÔNG phải tenant-admin access.

### Bất biến

- Person authority chỉ từ **verified session/magic link** — KHÔNG từ URL/body person ID.
- DTO allowlisted: chỉ own membership/session/charge/allocation status — KHÔNG other roster/debt/admin fields.
- Cross-tenant errors KHÔNG reveal inaccessible club existence.

---

## 2. Use Cases + Edge Cases

### Use Cases

| ID | Actor | Hành động | Kết quả |
|---|---|---|---|
| PVW-UC-1 | Player (web) | Authenticate + view /me dashboard | Own clubs + sessions + debts summary |
| PVW-UC-2 | Player (Zalo) | Nhận magic link → open web | Same person view as TG-authenticated |
| PVW-UC-3 | Player (TG) | `/myclubs` DM command | Concise club/debt/session list |
| PVW-UC-4 | System | Join/payment/merge event | Realtime invalidate/refetch own data |
| PVW-UC-5 | Player | View active club memberships | List with role, status, debt summary |
| PVW-UC-6 | Player | View upcoming sessions across clubs | Timeline sorted by date |
| PVW-UC-7 | Player | View charge/payment status | Paid/partial/unpaid + allocation details |
| PVW-UC-8 | Player | View join request status | Pending/approved/rejected/expired |
| PVW-UC-9 | System | Account merge | Immediately converge to canonical Person view |
| PVW-UC-10 | Player | View left-club history | Historical ledger visible, membership status clear |

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
| TG Bot | `/myclubs` | "Đang tải..." | Club list + debt + upcoming session per club | "Lỗi" | "Bạn chưa tham gia club nào" |

---

## 4. Domain Model

| Entity | Vai trò | Key constraints |
|--------|---------|-----------------|
| `persons` | Global identity | Verified via TG/Zalo/web auth |
| `memberships` | Person ↔ Tenant per club | `UNIQUE(person_id, tenant_id)`, historical kept |
| `session_roster` | Player in sessions | `session_id`, `person_id` |
| `charges` | Payment obligations | `person_id`, `session_id`, effective status |
| `allocations` | Bank tx → charge mapping | `charge_id`, `amount`, attribution |
| `magic_links` | Short-lived web access tokens | `UNIQUE(hash)`, `person_id`, `channel`, `expires_at`, `used_at` |

---

## 5. Analytics Events

| Event | Khi nào | Payload tối thiểu |
|-------|---------|-------------------|
| `player_view_opened` | Player access /me | `person_id` (opaque), `source` (web/bot), `auth_method` |
| `magic_link_consumed` | Magic link used successfully | `person_id` (opaque), `channel` |
| `magic_link_failed` | Magic link invalid/expired | `reason` (expired/used/wrong_person) |
| `player_own_debt_viewed` | Player views charge details | `person_id` (opaque), `club_count` |
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

---

## 7. Open Questions / Changelog

### Changelog

| Date | Version | Thay đổi |
|---|---|---|
| 2026-06-18 | v1.0 | Initial spec (English format) |
| 2026-06-19 | v2.0 | Chuẩn hoá Vietnamese numbered, thêm 10 use cases, 12 edge cases, /me dashboard screens |
