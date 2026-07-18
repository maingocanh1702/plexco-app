# ⏳ DD-45 Analysis — Model hoá waitlist (đóng gap SES-UC-9)

> **Mục đích:** chốt waitlist model + **lifecycle tiền + queue ordering + promotion atomic**. Ground vào canonical.
> **Ngày:** 2026-07-13 · **Re-check:** 2026-07-19 · **Canonical:** `schema.ts` + migration `0014_players_waitlist` trên nhánh `feat/session-waitlist-expand` · `feature_session_management.md` (SES-UC-9/SES-OQ-3) · `feature_cross_club_join_tech` (final-join tạo charge) · `feature_payment_reconcile` (charge lifecycle) · DD-39/`feature_user_settings_tech` (`deriveChargeAmount` fail-closed) · **DD-49 rejoin/correction lifecycle** · DD-05/DD-41/DD-42/**DD-52**/DD-06 · `feature_notifications_reminders`. Ghi → `decisions.md` DD-45.

---

## 0. TL;DR — ✅ Chốt
- Mở `players_status_chk` **`('active','left','waitlisted')`** + `waitlist_position int`; pin state-shape `CHECK ((status='waitlisted') = (waitlist_position IS NOT NULL))` và position dương khi có. Promote/leave phải clear position.
- **Waitlist entry:** `waitlisted` KHÔNG chiếm capacity, KHÔNG tạo charge/new-obligation, KHÔNG lộ venue. **DD-49:** rejoin chưa-refund có thể giữ aggregate lịch sử; rejoin đã refund **không append lifecycle mới khi còn waitlisted** — re-derive và append chỉ lúc activation.
- **Promotion (`waitlisted→active`) là một atomic transaction** (`SELECT ... FOR UPDATE`, không over-fill). Initial attempt chạy trong opener leave/capacity-change; bounded async retry là continuation riêng, phải re-lock/re-count. First-activation assert chưa có charge + derive amount rồi tạo đúng một charge; DD-49 rejoin re-derive live aggregate rồi carry-over hoặc append refunded lifecycle atomic với activation, KHÔNG tạo charge row thứ hai.
- **Charge derivation fail-closed (DD-39):** KMS/decrypt/price-derivation lỗi trên first-activation candidate → giữ nguyên `waitlisted`, không new charge/venue; first failure lazy-creates đúng một retry job keyed `(tenant_id,session_id,origin_command_id)` rồi ghi audit + one candidate event `waitlist.charge_derivation_failed` keyed `(session_id,player_id,waitlist_entry_version,origin_command_id,reason_code)` và reference stable `promotion_retry_id`. Job CAS/lease cho tối đa **3 claimed attempts**; mỗi completed sweep dùng current order và thử mỗi candidate tối đa một lần. Candidate khác fail chỉ ensure sibling event trên cùng job, không tạo budget/job mới; retry command ID không thay root origin. Expired final claim finalizes under `session→job` to resolved-or-terminal without derivation/attempt 4; owner digest dedupes per root.
- **Rejoin sau `left` theo DD-49:** re-derive dưới lock. Active: chưa refund→carry-over, đã refund→append lifecycle idempotent. Full: waitlisted; refunded chưa append tới activation. Unknown/core-missing→`REJOIN_REQUIRES_REVIEW`.
- **Một total order duy nhất:** `waitlist_position`, `joined_at`, `id`. Position là tail rank dương, không cần contiguous hay monotonic theo lịch sử; deprioritize (DD-42) atomically chuyển candidate xuống cuối queue dưới session lock. Root retry job luôn chạy canonical selector theo **current order**; candidate event không cấp quyền direct-promote player đã bind.
- **Skip-on-ineligible/restricted:** candidate fail eligibility DD-41, reliability restriction DD-42 hoặc manual safety ban qua shared `evaluateJoinRestriction()` DD-52 lúc promote/retry → **skip người kế, giữ trong waitlist** (không remove, không charge/venue).
- **Chỉ active-player `leave` hoặc `capacity INCREASE` tạo capacity trigger mới.** Async retry chỉ tiếp tục origin failure trên capacity còn trống, không tự mở slot. Waitlisted leave không mở slot. `slots_max → NULL` promote toàn bộ candidate eligible; `capacity DECREASE` không promote/không evict và vẫn reject `CAPACITY_BELOW_ROSTER` nếu thấp hơn active roster.

---

## 0.1 Correction log
| Rev trước (thiếu) | Sự thật (chốt) |
|---|---|
| "waitlist_position hoặc joined_at" (2 ordering) | **Một total order** `waitlist_position`, `joined_at`, `id`. |
| Không nói money lifecycle | Waitlisted **không tạo charge/new-obligation**. First-activation promotion tạo đúng một charge. DD-49 rejoin chưa-refund giữ aggregate lịch sử; refunded defer lifecycle mới tới activation; promotion re-derive live disposition và không tạo charge row thứ hai. |
| Không nói capacity boundaries | capacity increase nhiều slot promote tới khi đầy; `NULL` promote mọi candidate eligible; decrease không promote/evict và không được thấp hơn active roster. |
| Không nói skip khi ineligible | candidate ineligible/ban → **skip, giữ trong waitlist**. |
| Retry bind player nhưng không re-check reorder/manual ban | Event chỉ wake canonical selector theo current total order; initial/retry đều re-check DD-41, DD-42 và `evaluateJoinRestriction()` DD-52. |
| Không nói player đã `left` join lại | **DD-49 supersede default reject:** active carry-over/append refunded lifecycle; full waitlisted defers refunded lifecycle; unknown→`REJOIN_REQUIRES_REVIEW`. |
| Không nói `deriveChargeAmount` fail lúc promote | First-activation promotion derive trước mutation; failure → giữ waitlisted/no-charge/no-venue, one candidate audit event on lazy root; bounded retry 3 claimed attempts/backoff, no recursive event, expired-final/exhausted→resolve-or-owner-review/DLQ. Triggering leave/capacity vẫn commit. DD-49 rejoin promotion re-derive/carry-or-append lifecycle, không chạy charge-create derivation. |

---

## 1. Canonical hiện trạng
| Sự thật | Nguồn |
|---|---|
| Baseline `main`/`origin/main`@`22c23aa` vẫn chỉ có `players.status IN ('active','left')`; migration mới nhất là `0013` | `git ls-tree main` · `git show main:packages/db/schema.ts` |
| Schema commit `1a6ac38` trên `feat/session-waitlist-expand` (current HEAD `aa8afae`; latest commit comment/format-only) có `0014_players_waitlist`: `waitlisted` + `waitlist_position` + state-shape/positive CHECK + queue index; **schema-only, chưa merge main**. `waitlist_entry_version` + root promotion-retry store/sweep worker chưa có | `packages/db/migrations/0014_players_waitlist.sql` · `packages/db/schema.ts` · `waitlist-invariants.test.ts` |
| Final join lần đầu tạo charge khi outcome `active`; full tạo waitlisted không new charge. DD-49 rejoin có thể carry-over canonical aggregate lịch sử, không tạo charge thứ hai | `feature_cross_club_join_tech` §4 · DD-49 |
| Mỗi membership chỉ có một player row/session; mỗi player chỉ có một charge row/session — correction lifecycle không được lách bằng duplicate row | `packages/db/schema.ts` (`players`/`charges` UNIQUE) · DD-49 |
| SES-UC-9/SES-OQ-3 đã pin contract; SessionService/entry/promotion/charge/notify behavior chưa tồn tại | `feature_session_management.md` · on-disk runtime scan |
| `slots_max` trên sessions nullable = unlimited; promotion tương lai phải lock session chống over-fill | `packages/db/schema.ts` · `feature_session_management_tech` |
| `deriveChargeAmount`: `gender_enc != NULL` nhưng KMS/decrypt fail → không tạo charge, không fallback | DD-39 · `feature_user_settings_tech` §2/§5 |
| `0014` currently permits duplicate positions; invariant test pins equal `(position,joined_at)` as representable and orders by `id` | `0014_players_waitlist.sql` · `waitlist-invariants.test.ts` · DD-45a |

---

## 2. State machine + lifecycle
```
join (full, chưa có player row) → waitlisted (position=N, no charge, no capacity, no venue)
join lại sau player.status=left → DD-49 correction core + eligibility/ban/capacity:
   proven live disposition → active hoặc waitlisted theo capacity; no duplicate charge
   unknown/unimplemented disposition → REJOIN_REQUIRES_REVIEW (no mutation)
   leave/capacity+ → compute available sau mutation, promote lowest ELIGIBLE tới khi đầy:
       first-activation waitlisted → assert no charge; derive + create exactly one charge
       DD-49 rejoin waitlisted → re-derive disposition; carry-over hoặc append refunded lifecycle khi activate, no duplicate charge row
       success → active + clear position + notify + reveal venue (same tx)
   slots_max → NULL → promote mọi candidate eligible trong cùng locked transition
   ineligible/ban at promote → skip (stay waitlisted) → try next
   existing charge without proven DD-49 disposition → skip + audit/owner-review → try next
   first-activation charge derivation fail → stay waitlisted/no-new-charge/no-venue + one candidate audit event on lazy root; opener commits → try next
   first DD-39 failure lazy-creates one root retry job/failing opener → re-lock/re-count; max 3 claimed attempts/backoff; each completed sweep tries each candidate ≤1 time; expired final claim or exhausted completed attempt→resolve-or-owner-review/DLQ
   player leaves waitlist → status=left + clear position; never mutate historical aggregate implicitly
capacity DECREASE → NO promote, NO eviction; below active roster → REJECT
```

## 3. Entry + promotion decision tables

### 3.1 Join/rejoin dưới session lock

| Existing player state | Capacity | Hành động |
|---|---|---|
| Không có player row | Còn slot / unlimited | Tạo `active` + đúng một charge + reveal venue |
| Không có player row | Full | Tạo `waitlisted` + tail position; **không charge/venue** |
| Không có player row | Còn slot nhưng DD-39 amount derivation fail | Abort join fail-closed; không player/charge/venue, không fallback giá; caller retry an toàn |
| `active` | Bất kỳ | Idempotent: trả current joined outcome; không tạo row/charge mới |
| `waitlisted` | Bất kỳ | Idempotent: trả current waitlist position; không đổi rank/charge |
| `left` | Còn slot / unlimited | Re-derive DD-49 disposition + eligibility/ban pass → `active`; carry-over nếu chưa refund hoặc append lifecycle idempotent nếu đã refund, atomic với activation; không duplicate charge row. Unknown/unimplemented → `REJOIN_REQUIRES_REVIEW` |
| `left` | Full | Re-derive DD-49 disposition → `waitlisted` + tail position. Chưa-refund giữ aggregate lịch sử; refunded **không append lifecycle/nợ mới**. Promotion sẽ re-derive; không venue. Unknown/unimplemented → `REJOIN_REQUIRES_REVIEW` |

Lý do fail-closed: UNIQUE player/session/membership và UNIQUE charge/player/session cấm duplicate row. Flow phải lock player + aggregate, re-derive disposition và chỉ mutate khi live evidence đủ. Thiếu core/disposition thì giữ nguyên byte-for-byte.

### 3.2 Promotion attempt (atomic; initial attempt trong opener, retry ở transaction riêng)

| Event/boundary | Hành động |
|---|---|
| Leave active | Re-count active; fill toàn bộ capacity đang available sau leave (thường 1 slot) |
| `slots_max` tăng | Re-count active; fill `new_slots_max - active_count`, không chỉ dùng delta cấu hình |
| `slots_max` từ finite → `NULL` | Promote toàn bộ candidate eligible; candidate fail eligibility vẫn ở waitlist |
| `slots_max` giảm nhưng ≥ active count | Không promote, không evict |
| `slots_max` giảm dưới active count | Reject `CAPACITY_BELOW_ROSTER`; không mutation |
| First-activation candidate pass DD-41 + DD-42 + `evaluateJoinRestriction()` DD-52, không existing charge, derive amount thành công | **Promote → active + clear position + tạo đúng một charge atomic** + notify + venue |
| DD-49 rejoin candidate có live canonical disposition hợp lệ | Re-derive/revalidate aggregate → promote active + clear position; chưa-refund carry-over, refunded append lifecycle idempotent; **không tạo charge row thứ hai** + notify + venue |
| Candidate ineligible / DD-42 restricted / DD-52 manually banned | **Skip → candidate kế**; candidate giữ `waitlisted` + position, không charge/venue |
| Candidate có existing charge nhưng không có live DD-49 disposition hợp lệ | **Fail-closed cho candidate:** không promote/không mutate charge; audit `WAITLIST_CHARGE_CONFLICT` + owner-review, rồi xét candidate kế |
| First-activation candidate không derive được amount do KMS/decrypt/price error (DD-39) | **Fail-closed cho candidate:** giữ `waitlisted`, không new charge/venue; audit + đúng một candidate `waitlist.charge_derivation_failed` event reference root `promotion_retry_id`. First failure lazy-creates one retry job/failing opener; job owns max 3 claimed attempts, sibling candidate event không tạo job/budget mới. Expired final claim hoặc completed attempt 3→resolve nếu no longer applicable, else owner-review/DLQ. Opener commit; xét candidate kế |
| Hết candidate eligible | Slot để trống (open cho join mới) |

- **Atomic + retry lifecycle:** capacity opener lock session, re-count active, tính `available`, rồi lock candidate. Mỗi transition vào waitlisted tăng durable `waitlist_entry_version`; deprioritize không đổi version. First-activation derive trước mutation; success ghi charge + status/position + outbox cùng transaction. DD-49 rejoin re-derive live aggregate; success carry-over hoặc append refunded lifecycle cùng activation, không INSERT duplicate charge. **Chỉ failure đầu tiên** lazy-create retry job `(tenant_id,session_id,origin_command_id)`; mỗi derivation failure để candidate byte-for-byte, ghi audit + one candidate event keyed `(session_id,player_id,waitlist_entry_version,origin_command_id,reason_code)` reference cùng `promotion_retry_id`, rồi loop tiếp. Cuối same transaction: capacity đã đầy hoặc không còn retryable failure → job `resolved`; chỉ open capacity + remaining DD-39 failure → `due`. Candidate event projector consumes audit idempotently; owner-facing alert/digest dedupes **per `promotion_retry_id`**, aggregates server-side candidate count/reason classes without PII/amount/venue, so N candidate events do not emit N indistinguishable alerts. Terminal review is a separate root-state alert.
- **Retry ownership/state machine:** `promotion_retry_jobs` keeps history UNIQUE `(tenant_id,session_id,origin_command_id)` plus partial UNIQUE `(tenant_id,session_id) WHERE state IN ('due','claimed')`; fields include stable `promotion_retry_id`, `state=due|claimed|resolved|terminal`, `sweep_attempt_count`, `claim_generation`, `claim_token`, `next_attempt_at`, `lease_owner`, `lease_expires_at`, `last_reason_code`. Under session lock, a new capacity opener resolves/supersedes every old nonterminal root (bump generation/clear token) before lazily creating its own on first failure; any active join/approve/promotion that fills capacity, and close/start/cancel, resolves all nonterminal roots. Candidate events reference job but own no budget. CAS `due` or expired `claimed` with count `<3`→`claimed` is a **short job-only transaction**: increment claimed-attempt count/generation, mint token, commit/release. Worker domain transaction uses universal order **session→root job→candidate/finance**, then requires `state='claimed'`, exact token/generation and `lease_expires_at > now()` before selector/every mutation/final transition; stale claimant aborts zero mutation. Each completed current-order sweep visits each candidate at most once and re-checks session/capacity/entry version/DD-41/DD-42/DD-52/live financial state. Candidate fail ensures sibling event on same job/root origin; no child job. Closed/started/full/no-candidate resolves; remaining failure after completed attempt 1–2→`due(backoff)`, completed attempt 3→`terminal` owner-review/DLQ. Crash before commit rolls back; expiry permits fenced reclaim while count `<3`. For expired `claimed` with count `>=3`, maintenance finalizer locks `session→job`, rechecks same expired claim and live applicability, clears token/lease, then `resolved` if retry no longer applies or `terminal`+review/DLQ otherwise; no derivation or attempt 4.
- **Tenant boundary:** `promotion_retry_jobs` and candidate events are tenant-private with same-tenant session/event refs, `ENABLE+FORCE RLS`, no broad `app`/`readonly` table scan. Cross-tenant scheduler claims only through a narrow audited worker function/role, then re-enters exact tenant context before the `session→job→candidate/finance` domain transaction.
- **Ordering:** `ORDER BY waitlist_position ASC, joined_at ASC, id ASC`. Position gán `max(position)+1` dưới session lock. Deprioritize (DD-42) atomically gán lại `max(position)+1`; không cần renumber toàn queue.
- **State CHECK:** `status='waitlisted'` iff `waitlist_position IS NOT NULL`, và `waitlist_position > 0` khi có; active/left luôn position NULL. Query capacity/projector chỉ đếm `status='active'`.

## 4. Money invariants
- **Waitlist entry không tạo charge/new-obligation.** Charge first-entry được tạo khi lần đầu active. DD-49 rejoin chưa-refund có thể giữ aggregate lịch sử; refunded full→waitlisted không append lifecycle mới. Cả hai không cho phép INSERT charge row thứ hai.
- Promotion first-activation tạo đúng một charge dưới tenant RLS. Promotion DD-49 rejoin re-derive live aggregate: carry-over nếu chưa refund, append lifecycle idempotent nếu refunded, atomic với activation; không tạo charge row mới. Missing/malformed disposition là conflict; tuyệt đối không upsert/overwrite để lách UNIQUE.
- `deriveChargeAmount` phải chạy trước first-activation mutation. KMS/decrypt/price error → **không promote, không fallback**, giữ waitlisted + audit + one candidate event rồi xét candidate kế. Triggering leave/capacity không rollback; owner alert dedupes per root, còn domain retry re-runs derivation under lock với budget 3 claimed attempts/backoff và terminal owner-review/DLQ, không sinh event chain.
- Leave khi `active` → charge xử theo DD-49 ledger policy. Leave khi first-entry `waitlisted` → không có charge để reverse; leave khi DD-49 rejoin-waitlisted → không mutate aggregate lịch sử ngầm, phải đi correction policy.
- Player row đã `left` rejoin theo common join + DD-49 correction core. Chỉ `REJOIN_REQUIRES_REVIEW` khi core/disposition chưa chứng minh được; không suy `void=0`, không reopen charge, không reset `amount_allocated`.
- Không auto-split/không suy tiền từ waitlist.

## 5. Dependencies
- **DD-05** (open/approval join tạo charge — waitlist là nhánh khi full).
- **DD-41** eligibility re-check lúc promote.
- **DD-42** reliability deprioritize/ban → ordering + skip.
- **DD-52** manual safety ban → mọi join/promotion/retry gọi shared `evaluateJoinRestriction()`; waitlisted giữ queue nhưng bị skip.
- **DD-39 / `feature_user_settings_tech`** charge amount derivation cho first-entry/direct charge-create và first-activation promotion; KMS/decrypt fail → no charge, no fallback, candidate giữ waitlisted + bounded retry/audit. DD-49 rejoin promotion re-derive/carry-or-append lifecycle, không chạy charge-create derivation.
- **DD-06** venue reveal chỉ khi active.
- **DD-49** correction/rejoin lifecycle: carry-over/refunded disposition; refunded append only on activation; không duplicate charge.
- **`feature_notifications_reminders`** notify khi promote.
- Migration expand đã commit trên feature branch: mở `players_status_chk` + cột `waitlist_position` + state-shape/positive CHECK + queue index `(session_id,status,waitlist_position,joined_at,id)`; chưa merge main.

## 6. Propagation / build state
Schema expand + DDL invariant tests đã có trên feature branch. Product/BE session + cross-club phải phân biệt first-entry-no-charge với DD-49 rejoin carry-or-append-at-activation. Còn pending: SessionService entry/promotion, DD-39/41/42/52 helpers, DD-49 correction core, `waitlist_entry_version` migration, root promotion-retry store/CAS sweep worker/domain-DLQ, candidate failure-event/owner-alert consumers, projector (`slots_open` chỉ đếm active) và behavior tests.

**Trạng thái 2026-07-19:**

- ✅ **Schema đã land tại commit `1a6ac38` trên nhánh `feat/session-waitlist-expand` (current HEAD `aa8afae`; latest commit comment/format-only; chưa merge `main`, `origin/main`@`22c23aa` vẫn dừng ở `0013`)** — migration `0014_players_waitlist`, `schema.ts` sync, 21 DDL invariant test gồm app-role grant/RLS trên cột mới. Code dark.
- ⬜ **Behavior chưa build** — entry/promotion/charge/notify chờ DD-39/41/42/52, DD-49 correction core, SessionService, queue-entry version, root promotion-retry job/CAS lease worker/domain-DLQ và failure-event consumers. Missing helper/live disposition/infrastructure phải fail-closed.
- 🟡 **Mở thêm từ build slice:** §3.2 nói position không cần contiguous — điều đó **không** đồng nghĩa cho phép trùng; `max(position)+1` dưới session lock không thể sinh trùng. 0014 giữ đúng mức permissive như DDL đã viết, không siết thêm. Có nên thêm `UNIQUE (session_id, waitlist_position) WHERE status='waitlisted'` → quyết ở promotion slice.
- ⬜ **Ngoài scope DD-45:** same-tenant composite FK mà DDL block của tech spec yêu cầu là DD-68 prerequisite; 0014 không thêm.

## 7. Test fixtures
join-full first-entry→waitlisted/no charge/no venue · `left` not-refunded→active carry-over hoặc waitlisted giữ historical aggregate · `left` refunded+active→one idempotent lifecycle append; refunded+full→waitlisted/no new lifecycle · promotion re-derives and appends lifecycle only at activation · unknown disposition→`REJOIN_REQUIRES_REVIEW`/no mutation · first-activation promote→exactly-one-charge · existing charge missing valid disposition→skip+owner-review · opener with no failure→no root row · KMS fail→candidate unchanged + exactly-one candidate event carrying `promotion_retry_id`/entry/root-origin · A fails then B fills final slot→event durable but root job resolved/no worker claim · fail→direct active join fills→later leave/new opener→old root superseded, only new root sweeps · opener vs worker domain lock-order test proves no session↔job deadlock · failure→deprioritize→retry re-enters current selector · DD-52 manual ban after failure→skip/no charge/venue · two candidates fail→two sibling events, one retry job/counter + one root-deduped owner digest; each candidate ≤1 derivation/completed sweep · duplicate events/commands do not fork root job/alert budget · A lease expires/B reclaims/A resumes→A token fence rejects zero mutation · three consecutive pre-domain crashes→expired final claim finalizes resolved-or-terminal, never stuck/attempt 4 · crash after success→resolved/no duplicate · stale entry/session closed/started/slot filled/DD-41/DD-42/DD-52 restriction→safe skip/resolve · completed attempt 1..3 backoff; third persistent attempt→terminal owner-review/DLQ · cross-tenant app scan denied/narrow scheduler claim + exact tenant context succeeds · no over-fill/double charge · total order + capacity boundaries + state CHECKs.

## 8. Quyết định (đã chốt)
`+waitlisted`+position-shape/positive CHECK; waitlisted không tạo charge/new-obligation/venue; promotion first-activation tạo đúng một charge, DD-49 rejoin re-derive rồi carry-over hoặc append refunded lifecycle chỉ khi active, không duplicate charge row; unknown disposition→review. First failure in a capacity opener lazy-creates one root promotion-retry job; it owns CAS/lease max 3 claimed attempts/backoff, while candidate failure events bind `promotion_retry_id`+entry+root origin for audit only and owner alert/digest dedupes per root. Each completed sweep re-enters current order, re-checks DD-41/DD-42/DD-52 and tries each candidate at most once; sibling events never multiply budgets/jobs/alerts. Expired final claim finalizes under `session→job` to resolved-or-terminal without derivation/fourth attempt. Tenant-private RLS + narrow scheduler claim remain mandatory. Venue only when active. Ghi `decisions.md` DD-45 ✅.

**Nguồn:** `packages/db/schema.ts` (`sessions`/`players`/`charges`) · `packages/db/migrations/0014_players_waitlist.sql` · `feature_session_management.md` SES-UC-9/SES-OQ-3 · `feature_cross_club_join_tech` §4 · `feature_payment_reconcile` charge state machine · DD-39/49 · `feature_user_settings_tech` `deriveChargeAmount` · DD-05/41/42/52/06 · `feature_notifications_reminders`.
