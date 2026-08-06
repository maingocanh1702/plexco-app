# 🚪 DD-05 Analysis — Join cross-club: open vs approval

> **Mục đích:** chốt policy join + **contract tiền/RLS ở đường approve** (không phải "chỉ policy"). Ground vào canonical.
> **Ngày:** 2026-07-13 · **Re-check:** 2026-07-19 · **Canonical:** `schema.ts` (sessions.join_policy · join_requests:611) · `feature_cross_club_join_tech.md` §4 · `feature_session_management.md` (SES-UC-8) · DD-45 (waitlist) · **DD-49 (rejoin/correction)** · DD-41 (gating) · DD-42/DD-52 (join restrictions) · DD-06 (venue). Ghi → `decisions.md` DD-05.

---

## 0. TL;DR — ✅ Chốt

- **`sessions.join_policy` per-session, mặc định `open`** (đã có enum `open|approval`, `schema.ts`).
- **Idempotency trước restriction:** dưới session lock, resolve identity + lookup existing player trước. `active|waitlisted` trả current outcome không mutation kể cả ban được áp về sau (DD-52 không auto-evict). Chỉ absent/`left` mới chạy DD-41/DD-42/shared DD-52 rồi mới tạo membership/request/player.
- **`open`:** sau preflight hợp lệ, resolve/tạo guest membership. First-entry còn slot → **active player + exactly-one charge + venue**, full → **waitlisted player, không charge/venue**. Existing `left` re-derive DD-49 disposition: active thì carry-over hoặc append refunded lifecycle; full thì waitlisted, chưa-refund giữ aggregate lịch sử còn refunded defer lifecycle mới tới activation. Unknown/unimplemented → `REJOIN_REQUIRES_REVIEW`.
- **`approval`:** first-entry request → **`join_requests(pending)` — KHÔNG membership/player/charge, KHÔNG chiếm capacity, KHÔNG lộ venue**. Existing `left` request-create chỉ preflight DD-41/DD-42/DD-52 + live DD-49 disposition; schema hiện tại **không lưu/bind financial proof**. Unknown/unimplemented → `REJOIN_REQUIRES_REVIEW`, không request/mutation. Host approve dưới tenant RLS + lock session→nonterminal root job→request→membership/player→finance, re-check DD-41/DD-42/DD-52 và **re-derive/revalidate live DD-49 disposition**; drift/unknown giữ request pending, zero mutation. First-entry còn slot → active+exactly-one-charge+venue; full → approved+waitlisted, không charge/venue. Rejoin active carry-over/append lifecycle; full waitlisted không new lifecycle/venue.
- **⚠️ Sửa nhận thức sai:** DD-05 **CÓ** đụng state tiền + RLS, không phải "chỉ policy join". Nhánh approve còn slot là money-write. First-entry full chỉ queue và charge được tạo lúc first-activation promotion; proven DD-49 rejoin full giữ aggregate đã chứng minh và không tạo charge mới lúc promotion.

---

## 0.1 Correction log
| Rev trước (SAI) | Sự thật |
|---|---|
| "DD-05 không đụng tiền/RLS; chỉ policy join" | Approve chạy dưới tenant RLS. First-entry capacity available tạo **membership+active player+charge**, full tạo **membership+waitlisted player không charge**; proven rejoin resolve/carry canonical aggregate theo DD-49. First-entry pending chỉ có request; existing-`left` pending giữ nguyên state/aggregate lịch sử và không tạo row hay mutation mới. |
| "Open/approve full → reject" | DD-45 supersede: open/approve full → waitlisted có position. First-entry không charge/venue; proven DD-49 rejoin không tạo charge mới/venue nhưng có thể giữ aggregate lịch sử. |

---

## 1. Canonical hiện trạng
| Sự thật | Nguồn |
|---|---|
| `sessions.join_policy text CHECK ('open','approval')` mặc định `open` | `schema.ts:214` (sessions) |
| `join_requests` (status `pending/approved/rejected/expired/cancelled`, **unique active per (session, person)** where pending) | `schema.ts:611-627` |
| **Open-join tx:** lock session → lookup player; active/waitlisted return current → absent/left validate DD-41/DD-42/DD-52 → membership idempotent → first-entry active+charge nếu còn slot, waitlisted/no-charge nếu full; existing `left` resolve DD-49 disposition rồi active/waitlisted + carry-over/no-new-charge | `feature_cross_club_join_tech` §4 Open Join Transaction |
| **Approval tx:** lookup player trước; active/waitlisted return current. Absent/left request-create preflight DD-41/DD-42/DD-52; first-entry pending không tạo membership/player/charge, existing-left preflight DD-49 và không lưu proof/mutate aggregate. Approve theo lock order session→root job→request→membership/player→financial aggregate, re-check restrictions + re-derive current disposition; drift/unknown giữ pending. Success mới chọn active-vs-waitlisted | `feature_cross_club_join_tech` §4 Approval Transaction |
| Discovery `POST /sessions/:id/join` route `session_id→tenant`; open→join, approval→`join_requests(pending)` | TDD §join |

---

## 2. Decision table
| Điều kiện | Hành động |
|---|---|
| `join_policy=open`, first-entry còn slot, eligible (DD-41) | **join ngay** — membership+player+exactly-one-charge atomic; return venue (DD-06) |
| `join_policy=open`, first-entry hết slot | **waitlisted** + positive tail position dưới session lock; không charge/venue |
| `join_policy=open`, existing `left` + valid live DD-49 disposition | Re-run eligibility/capacity. Active→carry-over/append refunded lifecycle; full→waitlisted, refunded no new lifecycle; no duplicate charge/venue |
| `join_policy=open`, existing `left` + unknown/unimplemented disposition | `REJOIN_REQUIRES_REVIEW`; player/charge/allocation unchanged |
| existing `active|waitlisted`, kể cả bị ban sau đó | Return current outcome idempotently; không rejoin mutation, không `PLAYER_BANNED`, không đổi queue/charge |
| absent/`left` + DD-41/DD-42/DD-52 restriction | Reject fail-closed; không membership/request/player/charge/host notification |
| `join_policy=approval`, first-entry request | **`join_requests(pending)`** — **no membership/player/charge/capacity/venue**; notify host |
| `join_policy=approval`, existing `left` + current DD-49 disposition representable | Preflight rồi create/keep pending request; **không persist financial proof**, không membership/player/charge/capacity/venue/mutation; notify host |
| `join_policy=approval`, existing `left` + unknown/unimplemented disposition | `REJOIN_REQUIRES_REVIEW`; no request/player/charge/allocation mutation |
| approve first-entry, còn slot + eligible | Lock session→root job→request→membership/player→finance; re-check DD-41/DD-42/DD-52; active+exactly-one-charge atomic dưới tenant RLS; return venue; nếu lấp capacity thì resolve already-locked nonterminal DD-45 roots |
| approve first-entry, slot đã hết + eligible | Mark request approved + membership+waitlisted player/position atomic; không charge/venue |
| approve existing `left`, live DD-49 disposition vẫn hợp lệ | Lock và re-derive/revalidate. Active: carry-over hoặc append refunded lifecycle; waitlisted: chưa-refund giữ aggregate lịch sử, refunded defer lifecycle mới; không duplicate charge; venue chỉ khi active |
| approve existing `left`, disposition drift/unknown kể từ request-create | `REJOIN_REQUIRES_REVIEW`; request giữ `pending`; player/financial aggregate byte-for-byte unchanged |
| approve nhưng request expired | Expiry transition/safe conflict theo request state machine; không roster/financial mutation mới; notify player theo terminal outcome |
| approve nhưng DD-41/DD-42/DD-52 fail/drift | Giữ request `pending`/blocked để host thấy và xử lý; zero membership/player/charge/venue mutation. Chỉ chuyển `rejected` khi host gọi Reject riêng |
| reject / expire | Mark rejected/expired; notify player; không có financial mutation mới, existing aggregate giữ nguyên |

---

## 3. Money/RLS invariants
- **Pending không phát sinh state/nợ mới** — first-entry chỉ có `join_requests` row (tenant-scoped RLS); existing-`left` request chỉ phản ánh preflight, không lưu proof và giữ nguyên player/canonical aggregate. First-entry charge chỉ tạo khi transition active. Rejoin-waitlisted chưa-refund có thể giữ aggregate lịch sử; refunded không append lifecycle mới tới activation.
- **Approve = tenant state-write; nhánh còn slot là money-write** → chạy dưới `withTenant(tenantId)` + RLS fail-closed; capacity lock chọn active vs waitlisted và chống over-fill.
- **DD-41/DD-42/DD-52 + DD-49 disposition đều re-check TRONG transaction lúc approve** — thuộc tính, restriction và aggregate có thể đổi giữa request↔approve; creation-time preflight không phải authority.
- Venue chỉ lộ khi approve/join tạo `players.status='active'`; approved-but-waitlisted vẫn ẩn (DD-06).

## 4. Dependencies
- **DD-41/DD-42/DD-52** eligibility/restriction — `active|waitlisted` idempotent return trước preflight; absent/`left` open/request và approve mutation đều gọi shared cores dưới lock.
- **DD-45 + DD-49** waitlist/rejoin — slot-hết ở cả open lẫn approve: first-entry → waitlisted/no-charge/no-venue; proven rejoin → waitlisted + carry-over canonical aggregate/no-new-charge/no-venue. Promotion first-activation tạo exactly-one charge; rejoin promotion không tạo charge thứ hai.
- **DD-06** venue reveal only for active outcome.
- **DD-46** personal tenant — cùng đường join.

## 5. Propagation (khi build)
`feature_cross_club_join(.md/_tech)` (CCJ-OQ-1 → ✅), `feature_session_management` (SES-UC-8), TDD §join. **Đã cập nhật:** cross-club + session product/BE specs pin active-vs-waitlisted outcome.

## 6. Test fixtures
open-join first-entry eligible+slot→active+exactly-one-charge+venue · first-entry full→waitlisted/no-charge/no-venue · active/waitlisted then banned→repeat join/request returns current state, no mutation · absent/left banned or reliability-restricted→no membership/request/player/charge/host alert · approval first-entry→pending(no membership/player/charge) · approval existing-`left` preflight-pass→pending/no-proof-storage/no-financial-mutation · preflight unknown→`REJOIN_REQUIRES_REVIEW`/no request · ban/restriction/state changes before approve→request remains pending/zero mutation · expired approve→terminal/safe-conflict with no roster/financial mutation · approve first-entry+slot→active+charge + resolve old promotion roots when capacity fills · approve first-entry+full→approved+waitlisted/no-charge/no-venue · rejoin not-refunded+slot→active+carry-over · refunded+slot→active+one idempotent lifecycle append · either full→waitlisted/no-new-lifecycle/no-venue · concurrent 2 first-entry join 1 slot→1 active+1 waitlisted.

## 7. Quyết định (đã chốt)
per-session default open; existing active/waitlisted return current trước restriction preflight. Absent/left request-create preflight DD-41/DD-42/DD-52 + live DD-49 disposition nhưng không persist proof; approve lock và re-check/re-derive, drift/unknown giữ pending + zero mutation. First-entry: còn slot→active+exactly-one-charge+venue, full→waitlisted/no-charge/no-venue. Rejoin active carry-over/append refunded lifecycle; waitlisted defer lifecycle mới và không venue. Ghi `decisions.md` DD-05 ✅.

**Nguồn:** `schema.ts:214/611` · `feature_cross_club_join_tech` §4 · `feature_session_management.md` SES-UC-8 · DD-06/41/42/45/46/49/52.
