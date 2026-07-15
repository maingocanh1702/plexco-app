# 🚪 DD-05 Analysis — Join cross-club: open vs approval

> **Mục đích:** chốt policy join + **contract tiền/RLS ở đường approve** (không phải "chỉ policy"). Ground vào canonical.
> **Ngày:** 2026-07-13 · **Re-check:** 2026-07-15 · **Canonical:** `schema.ts` (sessions.join_policy · join_requests:611) · `feature_cross_club_join_tech.md` §4 · `feature_session_management.md` (SES-UC-8) · DD-45 (waitlist) · DD-41 (gating) · DD-06 (venue). Ghi → `decisions.md` DD-05.

---

## 0. TL;DR — ✅ Chốt

- **`sessions.join_policy` per-session, mặc định `open`** (đã có enum `open|approval`, `schema.ts`).
- **`open`:** join → lock session + resolve/tạo guest membership; còn slot → **active player + charge + venue**, full → **waitlisted player, không charge/venue** (DD-45).
- **`approval`:** request → **`join_requests(pending)` — KHÔNG membership/player/charge, KHÔNG chiếm capacity, KHÔNG lộ venue**. Host duyệt dưới tenant RLS + lock session/request + eligibility re-check (DD-41): còn slot → active+charge+venue; full → approved+waitlisted, không charge/venue (DD-45).
- **⚠️ Sửa nhận thức sai:** DD-05 **CÓ** đụng state tiền + RLS, không phải "chỉ policy join". Nhánh approve còn slot là money-write; nhánh full chỉ queue và charge được tạo lúc promotion.

---

## 0.1 Correction log
| Rev trước (SAI) | Sự thật |
|---|---|
| "DD-05 không đụng tiền/RLS; chỉ policy join" | Approve chạy dưới tenant RLS; capacity available tạo **membership+active player+charge**, full tạo **membership+waitlisted player không charge**. Pending mới là no-state/no-money. |
| "Open/approve full → reject" | DD-45 supersede: open/approve full → waitlisted có position, không charge/venue. |

---

## 1. Canonical hiện trạng
| Sự thật | Nguồn |
|---|---|
| `sessions.join_policy text CHECK ('open','approval')` mặc định `open` | `schema.ts:214` (sessions) |
| `join_requests` (status `pending/approved/rejected/expired/cancelled`, **unique active per (session, person)** where pending) | `schema.ts:611-627` |
| **Open-join tx:** lock session → validate/gating → membership idempotent → active+charge nếu còn slot, waitlisted/no-charge nếu full | `feature_cross_club_join_tech` §4 Open Join Transaction |
| **Approval tx:** pending không tạo membership/player/charge; approve theo lock order session→request→membership, rồi active+charge hoặc waitlisted/no-charge | `feature_cross_club_join_tech` §4 Approval Transaction |
| Discovery `POST /sessions/:id/join` route `session_id→tenant`; open→join, approval→`join_requests(pending)` | TDD §join |

---

## 2. Decision table
| Điều kiện | Hành động |
|---|---|
| `join_policy=open`, còn slot, eligible (DD-41) | **join ngay** — membership+player+charge atomic; return venue (DD-06) |
| `join_policy=open`, hết slot | **waitlisted** + positive tail position dưới session lock; không charge/venue |
| `join_policy=approval`, request | **`join_requests(pending)`** — **no membership/player/charge/capacity/venue**; notify host |
| approve, còn slot + eligible | Lock session→request; re-check DD-41; membership+active player+charge atomic dưới tenant RLS; return venue |
| approve, slot đã hết + eligible | Mark request approved + membership+waitlisted player/position atomic; không charge/venue |
| approve nhưng ineligible/expired | Reject/safe conflict; không tạo membership/player/charge; notify player |
| reject / expire | mark rejected/expired; notify player; no money |

---

## 3. Money/RLS invariants
- **Pending KHÔNG phát sinh nợ/state roster** — chỉ `join_requests` row (tenant-scoped RLS). Charge chỉ **được tạo khi transition active**; waitlisted không charge, charge/ledger giữ lại sau `left`.
- **Approve = tenant state-write; nhánh còn slot là money-write** → chạy dưới `withTenant(tenantId)` + RLS fail-closed; capacity lock chọn active vs waitlisted và chống over-fill.
- **Eligibility re-check TRONG transaction lúc approve** (DD-41) — thuộc tính player có thể đổi giữa request↔approve.
- Venue ẩn tới join/approve thành công (DD-06).

## 4. Dependencies
- **DD-41** eligibility (`evaluateSessionEligibility`) — gọi ở cả open-join lẫn approve, trước roster mutation.
- **DD-45** waitlist — slot-hết ở cả open lẫn approve → waitlisted, không charge/venue; promotion mới tạo charge.
- **DD-06** venue reveal post-join.
- **DD-46** personal tenant — cùng đường join.

## 5. Propagation (khi build)
`feature_cross_club_join(.md/_tech)` (CCJ-OQ-1 → ✅), `feature_session_management` (SES-UC-8), TDD §join. **Đã cập nhật:** cross-club + session product/BE specs pin active-vs-waitlisted outcome.

## 6. Test fixtures
open-join eligible+slot→active+charge+venue · open-join full→waitlisted/no-charge/no-venue · approval→pending(no membership/player/charge) · approve+slot→active+charge · approve+full→approved+waitlisted/no-charge · approve-but-ineligible/expired→reject · reject/expire→no money · concurrent 2 join 1 slot→1 active+1 waitlisted · pending/waitlisted không lộ venue.

## 7. Quyết định (đã chốt)
per-session default open; pending=no membership/player/charge; final open/approve dưới tenant RLS + eligibility re-check: còn slot→active+charge+venue, full→waitlisted/no-charge/no-venue (DD-45). Ghi `decisions.md` DD-05 ✅.

**Nguồn:** `schema.ts:214/611` · `feature_cross_club_join_tech` §4 · `feature_session_management.md` SES-UC-8 · DD-41/06/45/46.
