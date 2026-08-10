# Sporta session docs → Plexco: gap analysis

> **Loại:** research / comparative analysis. **KHÔNG phải** review verdict, readiness gate, hay build contract.
> Không sửa doc nào; không resolve open question nào; không tạo decision nào.
>
> **Ngày:** 2026-08-07
> **Input (external, non-authoritative):** `feature_session.md` · `feature_session_detail.md` — sản phẩm "Sporta", mobile-first, host-centric. User xác nhận: **sản phẩm khác / bản cũ**, dùng làm tham khảo UX, KHÔNG phải authority.
> **Baseline Plexco:** `docs/features/FE/feature_session_management.md` v2.17 · `docs/features/BE/feature_session_management_tech.md` v2.18b · `docs/features/FE/feature_session_organize.md` v0.5a · `docs/channels/web/FE/feature_sessions_fe.md` v0.2 · `docs/standards/decisions.md`
> **Method:** mọi claim "Plexco có/không có" đều verify bằng live repo (`packages/db/schema.ts`, `packages/db/migrations/`), không suy từ prose.

---

## 0. Live-repo baseline (verified, không phải prose)

Đây là mặt bằng để mọi so sánh dưới đây đứng lên. Đo tại 2026-08-07.

**`sessions` — cột thực tế trong `packages/db/schema.ts`:**

```
id · tenantId · sportId · startsAt · endsAt · timezone · venueName · venueAddress
area · skillLevel · priceAmount · slotsMax · visibility · joinPolicy · status
version · createdAt · updatedAt
```

**`players` — cột thực tế:**

```
id · tenantId · sessionId · membershipId · status · joinedAt · lastRemindedAt · waitlistPosition
```

**Migration tail thực tế:** `0029_dd29_capability_registry_contract.sql`
(⚠️ `feature_session_management.md` header và `BE/*_tech.md` header đều đang nói tail là `0024`. Không sai về *nội dung* — `0024` đúng là migration public-capacity CHECK — nhưng đọc lướt dễ tưởng đó là tail hiện hành. `0025`–`0029` đã land sau đó.)

**Bảng KHÔNG tồn tại trong live schema** (dù có trong doc hoặc trong Sporta):
`session_courts` · `matches` · `match_sets` · `match_participants` · `score_events` · `session_invite_tokens` · `membership_tags` · `check_ins` · `player_history` · bất kỳ bảng `slots` nào.

**Bảng session-related CÓ tồn tại:**
`sessions` · `players` · `session_surface_refs` · `session_recurrence_rules` · `session_occurrences` · `public_sessions` · `join_requests` · `charges` · `processed_commands` · `outbox_events`.

---

## 1. Mapping: file nào đối ứng file nào

| Sporta | Phạm vi | Đối ứng Plexco | Trạng thái Plexco |
|---|---|---|---|
| `feature_session.md` | Pre-session: tạo kèo, join, leave, explore, waitlist, share | `feature_session_management.md` + `BE/feature_session_management_tech.md` + `FE/feature_sessions_fe.md` | Reviewed (product+BE), FE Draft. Runtime: **chỉ DB substrate**, SessionService/routes/UI chưa build |
| `feature_session_detail.md` | During-session: match, score, check-in, payment, kết thúc | `feature_session_organize.md` + `BE/feature_session_organize_tech.md` | ✅ Accept-in-principle (DD-61..64), build **post-P4**. Runtime: **không có gì** |

Hai file Sporta cắt theo trục **thời gian** (trước / trong buổi chơi). Plexco cắt theo trục **capability** (CRUD/admission vs. orchestration/scoring). Trục cắt giống nhau về kết quả — cả hai đều tách làm 2 — nên mapping 1-1 sạch, không có phần nào rơi giữa khe.

---

## 2. Category A — Plexco đã có, không cần import

| Sporta | Plexco tương đương | Ghi chú |
|---|---|---|
| Waitlist + auto-promote + position | DD-45/DD-45a/DD-49, `players.status='waitlisted'` + `waitlistPosition` (migration `0014` **đã merge**) | Plexco chi tiết hơn nhiều: retry job CAS/lease max-3-attempt, DLQ, re-check DD-41/42/52 mỗi sweep |
| Join khi full → waitlist | SES-UC-8, edge #4 | Plexco pin cả first-commit-wins + không tạo charge/venue cho waitlisted |
| `requireApproval` / `autoApprove` | `sessions.joinPolicy ∈ open\|approval` (live) + DD-05 | Plexco 1 field, Sporta 2 field chồng nhau — xem §6 |
| `repeatType: NONE\|WEEKLY\|BIWEEKLY` | `session_recurrence_rules` + `session_occurrences` (live), rrule + IANA tz + `UNIQUE(rule_id, local_occurrence_key)` | **Plexco mạnh hơn.** Enum 3 giá trị của Sporta là bước lùi — DST-safe và idempotent occurrence là thứ Plexco đã có |
| Gating theo trình độ / giới tính / độ tuổi | DD-41 ✅ Chốt — `evaluateSessionEligibility` ← `addMemberToSession`, self-attested, 9 error code | Decision đã chốt, **schema chưa migrate**. Sporta đặt 3 field phẳng trên session; DD-41 pin gender/age qua `gender_enc`/`dob_enc` + consent state |
| Check-in / attendance / absent | DD-42 ✅ Chốt — attendance trên `players`, reliability trên `memberships`, RLS, không public | Concept đã chốt (P4+), UI chưa author |
| Cancel/hủy session + notify | SES-UC-6, edge #23, `CANCEL_REQUIRES_REVIEW` | Plexco thêm nhánh fail-closed cho draft anomaly mà Sporta không có |
| Explore / search kèo public | `feature_marketplace_discovery.md` + `public_sessions` (live table) | Plexco tách hẳn thành feature riêng với field-whitelist projection |
| Invite link cho kèo private | DD-44 `session_invite_tokens` | Xem §4 — cơ chế Sporta **vi phạm** ngưỡng entropy của DD-44 |

---

## 3. Category B — Sporta có, Plexco thiếu hẳn. Import candidate.

Xếp theo mức "đáng lấy" giảm dần.

### B1. Pricing model `SPLIT_EQUAL` (chia đều tiền sân) — 🔴 gap đáng kể

Plexco live schema chỉ có `priceAmount integer`. DD-39 thêm giá nam/nữ (chưa migrate). **Không có** khái niệm "tổng tiền sân ÷ số slot".

Đây là mô hình giá phổ biến nhất của cầu lông VN — host trả tiền sân trước rồi chia đầu người. Với Plexco hiện tại host phải tự tính nhẩm rồi nhập `price_amount`, và khi số slot đổi thì giá/người sai mà hệ thống không biết.

Sporta pin đủ 4 mode: `FREE` · `SPLIT_EQUAL` (input `totalVenueCost`, derive `pricePerSlot`) · `FIXED_PER_SLOT` · gender-based.

**Vướng:** `SPLIT_EQUAL` làm giá **phụ thuộc capacity**, mà Plexco đã có edge #5 "price change sau khi đã có charges → bắt buộc preview + explicit policy" và DD-49 carry-over/adjustment. Giảm/tăng `slots_max` sẽ ngầm đổi giá của mọi người → chạm thẳng vào lớp financial đã pin. Không phải "thêm 1 cột", cần một decision.

### B2. Duplicate-schedule warning — 🟢 rẻ, không đụng invariant

Sporta edge #1: host tạo kèo trùng giờ với kèo cũ → dialog cảnh báo, cho chọn "Vẫn tạo" / "Hủy". Plexco không có gì tương đương ở bất kỳ layer nào.

Non-blocking warning, không cần schema mới (query `sessions` cùng tenant overlap time range), không đụng RLS/money/authz. Ứng viên tốt nhất để lấy nguyên.

### B3. `hostRole: ORGANIZE_ONLY | ORGANIZE_AND_PLAY` — 🟡 gap khái niệm

Plexco không có khái niệm host tự chiếm một slot. Trong Plexco host là TenantAdmin, player là `memberships`→`players` — hai vai tách hẳn. Sporta cho host tự động join 1 slot khi `ORGANIZE_AND_PLAY` (default).

Thực tế host CLB cầu lông gần như luôn chơi cùng. Nếu Plexco không mô hình hoá, host phải tự join như player bình thường — không sai, nhưng thiếu default hợp lý và làm lệch capacity count nếu host quên.

**Vướng:** đụng identity model (`persons`/`accounts`/`memberships`) — host có `membership` trong chính tenant mình không? Cần đọc `feature_identity.md` trước khi đề xuất.

### B4. `leaveDeadlineHours` / `cancelDeadlineHours` — 🟡 gap hành vi

Sporta: chặn player rời kèo trong N giờ trước `startTime` (null | 2 | 4 | 8), + `CANCEL_DEADLINE_PASSED` 400.

Plexco SES-UC-9 cho leave tự do trước giờ chơi, không có deadline lock. Đây là nhu cầu thật (bỏ kèo sát giờ làm host không kiếm được người thay) và Plexco đã có DD-42 reliability để *ghi nhận* no-show — nhưng không có cơ chế *chặn*.

### B5. Rate limit tạo session theo tier — 🟡

Sporta: 5 kèo/ngày cho Free tier, `SESSION_LIMIT_REACHED` 429.

Plexco có `plans`/`subscriptions`/`billing_*` (live) và DD-71 nhắc "quota cao hơn" cho `host_pro`, nhưng session docs không pin quota tạo session. Có `rate_limit_hits` table trong live schema — cơ chế đã có, chưa gắn vào session create.

### B6. Venue với toạ độ + GPS "sân gần tôi" — 🟡

Sporta: `venueLatLng {lat,lng}`, venue picker có search + GPS nearby + hiển thị khoảng cách km.
Plexco: `venueName`/`venueAddress` text + `area` (whitelist quận). Không toạ độ, không venue entity.

Ảnh hưởng thẳng tới `feature_marketplace_discovery` (search theo radius). Là quyết định sản phẩm, không phải gap kỹ thuật.

### B7. Multi-court + slot-level join

Sporta: `Court` (name, maxSlots, order) + `Slot` (courtId, playerId, status, slotOrder). Player chọn **sân cụ thể** khi join.

Plexco: `slots_max` scalar. Court chỉ xuất hiện ở `feature_session_organize` (`session_courts`, post-P4) và **sau** khi session đã bắt đầu, để xếp trận — không phải để join.

Đây là khác biệt thiết kế có chủ đích, không hẳn là gap: Plexco tách "admission" (bao nhiêu người vào) khỏi "orchestration" (xếp ai vào sân nào). Sporta gộp. Xem §4.C3.

### B8. Score input UX + validation theo môn

`feature_session_detail.md` §3 `ScoreInputSheet` có bảng validation cụ thể per sport (cầu lông max 30 / thắng ≥21 hơn 2 / Bo3; pickleball 15, set 3 là 5; tennis tiebreak 7...).

Plexco `feature_session_organize` có `target_points`/`best_of`/`win_by` generic + `INVALID_SCORING_CONFIG`, nhưng **không pin preset per sport**. Bảng của Sporta là input tốt cho slice organize khi build — không xung đột gì, chỉ là dữ liệu cấu hình.

### B9. Analytics funnel granularity

Sporta log ~28 event chỉ riêng create flow (`session_create_sport_selected`, `_venue_picker_opened`, `_advanced_expanded`...). Plexco session_management có 7 event tổng.

Không có event nào của Sporta chứa PII → không vi phạm "Không bao giờ log roster names, venue details, contact info". DD-73 còn nói "opaque funnel telemetry là hard requirement". Granularity này lấy được, chỉ cần giữ nguyên rule không-PII.

---

## 4. Category C — Xung đột. KHÔNG import nguyên trạng.

### C1. 🔴 Không có `tenant_id` ở bất kỳ đâu — vi phạm HARD RULE #1

Sporta domain model là host-centric: `Session.hostId → users`. Không có tenant, không có RLS, không có membership.

Plexco: "Session luôn gắn `tenant_id` — RLS choke-point" là **bất biến** của `feature_session_management` và là 1 trong 5 HARD RULES của `HANDOFF.md`. Live schema confirm: `sessions.tenantId`, `players.tenantId`, `tenantSessionFk`, `tenantMembershipFk`.

⇒ Toàn bộ §4 Domain Model của cả 2 file Sporta **không dùng lại được**. Chỉ dùng được ở mức ý tưởng field.

### C2. 🔴 `PlayerHistory` là fact table — mâu thuẫn trực tiếp DD-74

Sporta: bảng `PlayerHistory` denormalized (`totalMatches`, `totalWins`, `winRate`, `currentStreak`, `recentForm`), update khi match COMPLETED, rollback khi CANCELLED.

DD-74 ✅ Chốt (owner 2026-07-19): *"Activity per player = **read model, không phải fact table mới**"* — derive từ `players ⋈ sessions` (+DD-42); chỉ verified Person-self publish khi session ended + attendance=`present`; **không co-participant phase-1**.

Sporta còn công khai `GET /api/v1/players/:id/history/:sport` — public history của player khác. DD-74 phase-1 nói không co-participant, và `feature_session_organize` bất biến: *"Organize là tenant-private; không có projector sang `public_sessions`"*.

⇒ Xung đột 2 lớp: storage model (fact vs read model) **và** privacy boundary (public vs tenant-private). Không import.

### C3. 🔴 `IN_PROGRESS` là status — mâu thuẫn thiết kế đã pin

Sporta state machine: `DRAFT → OPEN → FULL → IN_PROGRESS → COMPLETED`.
Plexco: `draft → open → closed → cancelled` (live `statusChk` CHECK constraint xác nhận đúng 4 giá trị).

`feature_session_organize.md` §1 nói rõ: *"`past` là trạng thái **suy ra từ thời gian**, không phải giá trị của `sessions.status`"*, và lifecycle table dùng `status='open' AND starts_at <= now < ends_at` thay cho một status riêng.

Tương tự `FULL`: Plexco derive từ capacity helper (`active + unexpired holds`, DD-32) chứ không materialize thành status — vì `FULL` sẽ phải flip qua lại mỗi lần có người leave, tạo thêm một nguồn sự thật cần đồng bộ.

⇒ Thêm `IN_PROGRESS`/`FULL` sẽ phải sửa CHECK constraint + mọi guard đã pin quanh time-derived lifecycle. Không phải additive.

### C4. 🔴 Invite code 6 ký tự — vi phạm ngưỡng entropy DD-44

Sporta: `inviteCode: string (6 chars, unique)` lưu thẳng trên `Session`, endpoint public `GET /api/v1/sessions/join/:inviteCode`.

DD-44 ✅ Chốt: `session_invite_tokens` — **entropy ≥128-bit**, lưu **hash** (không lưu plaintext), bound `session_id`+`tenant_id`, có `expires_at`/`max_uses`/`used_count`/`revoked_at`.

6 ký tự alphanumeric ≈ 36⁶ ≈ 2.2×10⁹ ≈ **31 bit**. Thấp hơn ngưỡng 128-bit khoảng 10²⁹ lần, và lưu plaintext. Brute-force enumerable.

⇒ Không import. Nếu muốn UX "mã 6 số dễ đọc" thì đó là một decision riêng về trade-off (ví dụ: mã ngắn + rate limit + expiry ngắn + chỉ dùng cho kèo không có tiền), phải qua `decisions.md`, không phải lấy từ doc này.

### C5. 🟠 Slot status gộp với payment status

Sporta `Slot.status`: `AVAILABLE → RESERVED → CONFIRMED → CANCELLED`, trong đó `RESERVED` = "đã join, chờ thanh toán" và `CONFIRMED` = "đã thanh toán".

Plexco tách hẳn: `players.status ∈ active|left|waitlisted` (chỗ ngồi) vs `charges` (tiền). DD-32 thêm "live payment hold" chiếm slot tạm 15 phút — nhưng hold là *một khái niệm thứ ba*, không phải một giá trị của player status.

⇒ Gộp seat-state với payment-state là thứ Plexco cố tình tránh (HARD RULE: tiền/PII không ra public; và edge #6 "venue chỉ hiện khi outcome là `active`" phụ thuộc vào việc 2 trục này độc lập). Không import.

### C6. 🟠 Score consensus model vs capability model

Sporta Phase 1: **bất kỳ player nào** propose score → 100% player trong match confirm → chính thức. Host có `force-confirm` override. Kèm 2 bảng `ScoreProposal` + `ScoreConfirmation`, 10 error code riêng.

Plexco DD-62/DD-64 ✅ accept-in-principle: `session.score` là **grant session-scoped**, độc lập với `session.organize`; ledger `score_events` append-only (point/reversal); undo có bounded terminal-correction guard. Player `active` chỉ **read**.

Cả hai đều defensible. Nhưng đây là hai triết lý sản phẩm khác nhau (đồng thuận phi tập trung vs. uỷ quyền tập trung), owner Plexco đã chọn hướng thứ hai và đã accept-in-principle. Đổi = mở lại DD-64.

**Điểm đáng giữ từ Sporta bất kể chọn hướng nào:** edge #8 — *"1 player không confirm (AFK/bỏ về sớm) → block cả match"*. Consensus model có failure mode này; Plexco's capability model thì không. Đây chính là lý do kỹ thuật ủng hộ lựa chọn hiện tại của Plexco, đáng ghi vào decision rationale.

---

## 5. Category D — Plexco có, Sporta thiếu. Đừng regress.

Nếu sau này lấy ý tưởng từ 2 file này, đừng vô tình đánh rơi những thứ Plexco đã pin mà Sporta không có:

| Plexco có | Sporta không có |
|---|---|
| `tenant_id` + RLS fail-closed mọi bảng | — |
| Idempotency qua `commandId` + `processed_commands` (live table) | Không có khái niệm idempotency key |
| Optimistic concurrency `version` + `STALE_VERSION` bắt buộc trên nhánh mutate | Chỉ nhắc "optimistic locking" ở edge case, không pin field/error |
| Outbox pattern + projector retry (`outbox_events`, `projector_deliveries` live) | Không có |
| Venue-detail gating: chi tiết sân chỉ lộ khi `players.status='active'` (edge #6) | Venue hiện công khai từ đầu |
| Public discovery completeness E#7 + CHECK constraint `0024` (public ⇒ finite `slots_max`) | Không ràng buộc |
| Recurrence idempotency key + DST handling | Enum 3 giá trị, không nhắc timezone |
| Billing suspend gate khi publish (`TENANT_SUSPENDED` 403, DD edge #19) | Không có billing |
| i18n `t(vi, en)` bắt buộc mọi chuỗi user-facing | Hardcode tiếng Việt |
| Draft-lifecycle: auto-expiry draft quá giờ + `FOR UPDATE SKIP LOCKED` + anomaly fail-closed | `DRAFT` có trong enum nhưng không có transition ra khỏi nó |
| Fail-closed error mapping ở FE (unknown/timeout → placeholder, không invent success) | Không pin |

---

## 6. Lỗi trong file nguồn (nếu 2 file này còn dùng thật ở đâu đó)

| # | File | Vị trí | Vấn đề |
|---|---|---|---|
| 1 | `feature_session_detail.md` | dòng 394–417 | Bảng error code bị chèn vào **giữa** ASCII diagram của `PaymentTabContent`. Cả block diagram lẫn bảng đều hỏng; dòng 394 và 417 là hai mảnh bị cắt dán chồng lên nhau. §6 phía dưới (dòng 607+) có bảng error code đầy đủ — có vẻ đây là bản duplicate lỗi của nó |
| 2 | `feature_session_detail.md` | dòng 43, 45 | UC `#13` xuất hiện 2 lần (một là "Player xem tỉ số", một là "Host tạo nhiều matches") |
| 3 | `feature_session_detail.md` | dòng 45, 46 | UC `#13` và `#16` nội dung y hệt: "Tạo nhiều matches liên tiếp (round-robin)" |
| 4 | `feature_session_detail.md` | §6 vs §3 | `SCORE_EDIT_EXPIRED` (grace 24h) chỉ có trong bảng §6 dòng 621 và State Machine §8, không có trong bảng lỗi bị hỏng ở §3 — không rõ bản nào là bản đúng |
| 5 | `feature_session.md` | dòng 640 vs 113 | AC ghi "đủ **10** screens", bảng liệt kê **11** screen. Danh sách trong AC cũng thiếu "Fixed Gender" |
| 6 | `feature_session.md` | dòng 171–185 | State Coverage Matrix thiếu dòng "Ready (Fixed Gender)" dù đó là screen #4 |
| 7 | `feature_session.md` | dòng 328 vs 67 | `pricingType` enum trong domain model chỉ có `FREE\|SPLIT_EQUAL\|FIXED_PER_SLOT` — **thiếu** biến thể theo giới tính, dù UI §3 và bảng Pricing Variant đều có nó và có `priceMale`/`priceFemale` |
| 8 | `feature_session.md` | dòng 331 vs 358 | `requireApproval` (dòng 331) và `autoApprove` (dòng 359) là hai field điều khiển cùng một hành vi theo hai chiều ngược nhau. Không doc nào giải thích khi cả hai cùng bật thì sao |
| 9 | `feature_session.md` | dòng 34 vs 542 | Auto-complete: edge case #7 nói "sau 2h kể từ `end_time`", State Machine nói "auto sau `endTime + 2h`" — khớp; nhưng §10 AC dòng 633 lại thêm "Auto chuyển IN_PROGRESS khi đến `startTime`" mà state machine dòng 541 nói "Hoặc Host bấm Bắt đầu" — không rõ auto hay manual là canonical |

---

## 7. Đề xuất (proposal — chưa phải quyết định)

Không có gì ở đây là decision. Ba nhóm theo thứ tự nên xử lý:

**Nhóm 1 — lấy được ngay, không đụng invariant nào:**
- B2 duplicate-schedule warning
- B8 bảng score validation per sport (làm input cho slice organize, không build gì bây giờ)
- B9 analytics funnel granularity

**Nhóm 2 — cần một decision trong `decisions.md` trước:**
- B1 `SPLIT_EQUAL` pricing → đụng edge #5 (price change có charges) + DD-49
- B3 `hostRole` → đụng identity model, phải đọc `feature_identity.md` trước
- B4 leave deadline → đụng SES-UC-9 + DD-42
- B5 quota tạo session theo tier → đụng `feature_billing_lifecycle`
- B6 venue toạ độ/GPS → đụng `feature_marketplace_discovery`

**Nhóm 3 — không lấy, hoặc chỉ lấy sau khi mở lại decision:**
- C1 host-centric model, C2 PlayerHistory fact table, C3 `IN_PROGRESS`/`FULL` status, C4 invite code 6 ký tự, C5 slot-payment gộp — mỗi cái đều đối đầu một thứ đã pin (HARD RULE hoặc DD đã chốt)
- C6 consensus scoring — mở lại DD-64 nếu thật sự muốn đổi hướng

**Việc cần làm không liên quan tới Sporta, phát hiện trong lúc đối chiếu:**
- `feature_sessions_fe.md` dòng 67–71 tự ghi nhận header và §6 mâu thuẫn về phạm vi `UNPINNED`, chưa owner nào gỡ. Bất kỳ ai lấy ý tưởng UX từ 2 file Sporta vào FE doc sẽ vấp ngay chỗ này — §6 hiện đánh **toàn bộ** session/capacity/roster DTO là omit-active-UI, nghĩa là chưa có field nào được phép render thật.
- Header của `feature_session_management.md` + `BE/*_tech.md` nhắc migration `0024` ở vị trí dễ đọc nhầm thành tail; tail thực tế là `0029`.
