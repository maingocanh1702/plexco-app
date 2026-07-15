# ⏳ DD-45 Analysis — Model hoá waitlist (đóng gap SES-UC-9)

> **Mục đích:** chốt waitlist model + **lifecycle tiền + queue ordering + promotion atomic**. Ground vào canonical.
> **Ngày:** 2026-07-13 · **Re-check:** 2026-07-15 · **Canonical:** `schema.ts` (players.status:288 · players/charges UNIQUE) · `feature_session_management.md` (SES-UC-9) · `feature_cross_club_join_tech` (final-join tạo charge) · `feature_payment_reconcile` (charge lifecycle) · DD-05/DD-41/DD-42/DD-06 · `feature_notifications_reminders`. Ghi → `decisions.md` DD-45.

---

## 0. TL;DR — ✅ Chốt
- Mở `players_status_chk` **`('active','left','waitlisted')`** + `waitlist_position int`; pin state-shape `CHECK ((status='waitlisted') = (waitlist_position IS NOT NULL))` và position dương khi có. Promote/leave phải clear position.
- **`waitlisted`: KHÔNG chiếm capacity, KHÔNG có/tạo charge, KHÔNG lộ venue** (như pending); chỉ tạo row waitlisted khi chưa có `players` row cho membership+session.
- **Promotion (`waitlisted→active`) tạo mới đúng MỘT `charge` ATOMICALLY** trong CÙNG transaction với leave/capacity-change (`SELECT ... FOR UPDATE`, không over-fill); existing charge là conflict fail-closed, không "activate"/overwrite.
- **Rejoin sau `left` phase-1 = fail-closed `REJOIN_REQUIRES_REVIEW`:** không tự chuyển `left→waitlisted|active`, không tạo/reuse/void charge. Host phải đi một correction flow có audit + explicit ledger policy sau khi PAY-OQ-3 được chốt.
- **Một total order duy nhất:** `waitlist_position`, `joined_at`, `id`. Position là tail rank dương, không cần contiguous hay monotonic theo lịch sử; deprioritize (DD-42) atomically chuyển candidate xuống cuối queue dưới session lock.
- **Skip-on-ineligible:** candidate fail eligibility (DD-41)/ban lúc promote → **skip người kế, giữ trong waitlist** (không remove).
- **Chỉ active-player `leave` hoặc `capacity INCREASE` kích hoạt fill → promote tới `available = slots_max - active_count` sau mutation.** Waitlisted leave không mở slot. `slots_max → NULL` (unlimited) promote toàn bộ candidate eligible; `capacity DECREASE` không promote/không evict và **vẫn reject `CAPACITY_BELOW_ROSTER`** nếu thấp hơn active roster.

---

## 0.1 Correction log
| Rev trước (thiếu) | Sự thật (chốt) |
|---|---|
| "waitlist_position hoặc joined_at" (2 ordering) | **Một total order** `waitlist_position`, `joined_at`, `id`. |
| Không nói money lifecycle | waitlisted **no charge**; **promote tạo đúng một charge atomic**; existing charge khi promote = conflict fail-closed. |
| Không nói capacity boundaries | capacity increase nhiều slot promote tới khi đầy; `NULL` promote mọi candidate eligible; decrease không promote/evict và không được thấp hơn active roster. |
| Không nói skip khi ineligible | candidate ineligible/ban → **skip, giữ trong waitlist**. |
| Không nói player đã `left` join lại | Phase-1 **không auto-rejoin**: `REJOIN_REQUIRES_REVIEW`, giữ nguyên player+ledger; correction thủ công phải audit + chốt disposition tiền. |

---

## 1. Canonical hiện trạng
| Sự thật | Nguồn |
|---|---|
| `players.status` CHECK **`('active','left')`** — chưa waitlist | `schema.ts:288` |
| Final join tạo **`charge` khi transition thành active**; full thì waitlisted không charge | `feature_cross_club_join_tech` §4 Open Join Transaction |
| Mỗi membership chỉ có một player row/session; mỗi player chỉ có một charge/session | `schema.ts:285-286` · `schema.ts:394` |
| SES-UC-9 đã pin auto-promote theo DD-45; code/schema live vẫn chưa có `waitlisted` | `feature_session_management.md:44` · `schema.ts:288` |
| Concurrency lock (`FOR UPDATE`) chống over-fill có sẵn (BE edge#1/#4) | `feature_session_management` edge |
| `slots_max` trên sessions (nullable = unlimited) | `schema.ts:214` |

---

## 2. State machine + lifecycle
```
join (full, chưa có player row) → waitlisted (position=N, no charge, no capacity, no venue)
join lại sau khi player.status=left → REJOIN_REQUIRES_REVIEW (no mutation)
   leave/capacity+ → compute available sau mutation, promote lowest ELIGIBLE tới khi đầy:
       waitlisted → active + clear position
       (assert no charge; create exactly one charge ATOMIC, same tx) → notify + reveal venue
   slots_max → NULL → promote mọi candidate eligible trong cùng locked transition
   ineligible/ban at promote → skip (stay waitlisted) → try next
   existing charge at promote → skip + audit/owner-review (stay waitlisted) → try next
   player leaves waitlist → status=left + clear position (no charge existed)
capacity DECREASE → NO promote, NO eviction; below active roster → REJECT
```

## 3. Entry + promotion decision tables

### 3.1 Join/rejoin dưới session lock

| Existing player state | Capacity | Hành động |
|---|---|---|
| Không có player row | Còn slot / unlimited | Tạo `active` + đúng một charge + reveal venue |
| Không có player row | Full | Tạo `waitlisted` + tail position; **không charge/venue** |
| `active` | Bất kỳ | Idempotent: trả current joined outcome; không tạo row/charge mới |
| `waitlisted` | Bất kỳ | Idempotent: trả current waitlist position; không đổi rank/charge |
| `left` | Bất kỳ | **Reject `REJOIN_REQUIRES_REVIEW`**; không mutation player/charge/ledger |

Lý do fail-closed: UNIQUE `(tenant_id,session_id,membership_id)` và UNIQUE charge `(tenant_id,session_id,player_id)` không cho tạo lifecycle thứ hai; refund/void/reversal sau leave chưa có policy đủ để tự động reuse charge. Correction flow tương lai phải lock player+charge, preview ledger disposition, require host confirm và ghi audit before/after.

### 3.2 Promotion (atomic, trong tx leave/capacity-change)

| Event/boundary | Hành động |
|---|---|
| Leave active | Re-count active; fill toàn bộ capacity đang available sau leave (thường 1 slot) |
| `slots_max` tăng | Re-count active; fill `new_slots_max - active_count`, không chỉ dùng delta cấu hình |
| `slots_max` từ finite → `NULL` | Promote toàn bộ candidate eligible; candidate fail eligibility vẫn ở waitlist |
| `slots_max` giảm nhưng ≥ active count | Không promote, không evict |
| `slots_max` giảm dưới active count | Reject `CAPACITY_BELOW_ROSTER`; không mutation |
| Candidate theo total order eligible + not banned + không existing charge | **Promote → active + clear position + tạo đúng một charge atomic** + notify + venue |
| Candidate ineligible / banned | **Skip → candidate kế**; candidate giữ `waitlisted` + position |
| Candidate có existing charge (invalid/legacy state) | **Fail-closed cho candidate:** không promote/không mutate charge; audit `WAITLIST_CHARGE_CONFLICT` + owner-review, rồi xét candidate kế |
| Hết candidate eligible | Slot để trống (open cho join mới) |

- **Atomic:** event mở slot lock session trước, re-count active, tính `available = max(0, slots_max-active_count)`, rồi lock candidate `FOR UPDATE`; với từng candidate phải assert không có charge trước insert. Vòng lặp dừng khi đủ capacity/hết candidate. Charge-create + status/position + outbox nằm cùng transaction. Retry dùng idempotency của command leave/capacity-change, nên không double-promote/charge.
- **Ordering:** `ORDER BY waitlist_position ASC, joined_at ASC, id ASC`. Position gán `max(position)+1` dưới session lock. Deprioritize (DD-42) atomically gán lại `max(position)+1`; không cần renumber toàn queue.
- **State CHECK:** `status='waitlisted'` iff `waitlist_position IS NOT NULL`, và `waitlist_position > 0` khi có; active/left luôn position NULL. Query capacity/projector chỉ đếm `status='active'`.

## 4. Money invariants
- **waitlisted KHÔNG có charge.** Charge chỉ **được tạo khi player lần đầu transition thành `active`** (DD-05/CCJ), rồi vẫn được giữ khi player về `left` để bảo toàn ledger/audit. Promotion là **money-write** (tạo đúng một charge) → dưới tenant RLS; existing charge là conflict, tuyệt đối không upsert/overwrite.
- Leave khi `active` → charge xử theo ledger (reversal/settle policy — ngoài DD-45). Leave khi `waitlisted` → no charge to reverse.
- Player row đã `left` → phase-1 **không self-rejoin**. `REJOIN_REQUIRES_REVIEW` giữ nguyên charge/allocation history; không suy `void=0`, không reopen charge, không reset `amount_allocated`.
- Không auto-split/không suy tiền từ waitlist.

## 5. Dependencies
- **DD-05** (open/approval join tạo charge — waitlist là nhánh khi full).
- **DD-41** eligibility re-check lúc promote.
- **DD-42** reliability deprioritize/ban → ordering + skip.
- **DD-06** venue reveal chỉ khi active.
- **`feature_notifications_reminders`** notify khi promote.
- Migration: mở `players_status_chk` + cột `waitlist_position` + state-shape/positive CHECK + queue index `(session_id,status,waitlist_position,joined_at,id)` (expand).

## 6. Propagation (khi build)
`feature_session_management(.md/_tech)` (SES-UC-9 + capacity/rejoin table), `feature_cross_club_join(.md/_tech)` (open/approval full→waitlist + rejoin guard), `schema.ts`+migration (status+position CHECK+index), projector (`slots_open` tính active only), `feature_notifications_reminders` (promote/review event), tests. **Đã cập nhật:** product + BE session và cross-club specs pin DD-45; schema/code vẫn pending build.

## 7. Test fixtures
join-full→waitlisted(position dương,no charge/no venue) · duplicate active/waitlisted→idempotent current outcome · `left` rejoin→`REJOIN_REQUIRES_REVIEW`+no mutation · leave→fill available + clear position + exactly-one-charge atomic · candidate existing charge→skip+audit/owner-review · ineligible→skip next/giữ queue · capacity increase→fill `new_max-active_count` · finite→NULL→promote mọi eligible · decrease below active→`CAPACITY_BELOW_ROSTER` · decrease hợp lệ→no promote/no eviction · concurrent leave×join→no over-fill · retry→no double promote/charge · total order position+joined_at+id · deprioritize move-to-tail atomic · waitlisted leave→clear position/no reversal · CHECK state-shape/positive reject row lệch.

## 8. Quyết định (đã chốt)
`+waitlisted`+position-shape/positive CHECK; promote atomic tạo đúng một charge + clear position; full path nhất quán open/approval; auto-rejoin sau `left` fail-closed `REJOIN_REQUIRES_REVIEW`; total order position/joined_at/id; fill available/unlimited boundaries; skip-on-ineligible/charge-conflict; capacity decrease giữ `CAPACITY_BELOW_ROSTER`; venue chỉ khi active, charge chỉ được tạo lúc activation và giữ lại làm ledger/audit sau leave. Ghi `decisions.md` DD-45 ✅.

**Nguồn:** `schema.ts:288/214/285-286/394` · `feature_session_management.md` SES-UC-9 · `feature_cross_club_join_tech` §4 · `feature_payment_reconcile` charge state machine · DD-05/41/42/06 · `feature_notifications_reminders`.
