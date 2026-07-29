<!-- review-readiness: enforce -->
# DD-32 Analysis — Channel-first booking funnel

> **Machine classification:** `enforce`
> **Ngày:** 2026-07-28
> **Decision status:** `DECISION_FINAL` — Option D
> **Runtime status:** Not implemented
> **Authority pin:** `main@784bc8dd297163a5ec5415f33beabbbf34bbc8d7` + exact files in §9
> **Canonical contract:** `features/feature_channel_booking_funnel.md` + `features/BE/feature_channel_booking_funnel_tech.md`

---

## 0. Kết luận

DD-32 được reopen và thay Option A bằng **Option D — browse tự do, link-or-pay ở final confirm**:

- User luôn xem được time, public area, fee, confirmed count và available slots trong Messenger/Zalo mà chưa link.
- Free session không ép link/payment.
- Paid session còn chỗ:
  - account-linked → active + canonical charge, được pay later;
  - unlinked → giữ chỗ 15 phút; verified full payment mới active.
- Full session → waitlist không link/payment/charge/venue.
- Approval session → request trước; chỉ sau approval mới áp final gate.
- Pay-now không khả dụng khi hệ thống không chứng minh được exact real-time settlement capability; fallback là link account hoặc web, không phải lời khai/ảnh CK.

Option A cũ cho unlinked paid guest active trước payment đã bị supersede. Generic web/marketplace guest join không tự bị cấm: gate này là channel finalisation policy và common Join service chỉ được gọi sau khi orchestrator chứng minh nhánh hợp lệ.

---

## 1. Vì sao reopen

Yêu cầu sản phẩm mới có hai mục tiêu đồng thời:

1. account link phải có giá trị rõ ràng: đặt chỗ trước, thanh toán sau;
2. user không muốn link vẫn không bị chặn tuyệt đối: họ có thể trả ngay.

Option A cũ không tạo khác biệt ở final confirm vì unlinked paid user cũng được active+charge/pay later. Option C (paid bắt buộc link) tạo conversion wall. Option D giữ browse/acquisition mềm nhưng chuyển rủi ro ở đúng mutation boundary.

---

## 2. Các phương án

| Option | Browse | Free booking | Paid linked | Paid unlinked | Verdict |
|---|---|---|---|---|---|
| A — soft funnel cũ | Mở | Active | Active/pay later | Active/pay later | Superseded: link không có final-booking value |
| B — hard link wall | Sau link | Cần link | Active/pay later | Không được book | Loại: friction quá sớm |
| C — paid requires link | Mở | Active | Active/pay later | Bị chặn | Loại: không đáp ứng pay-without-link |
| **D — final risk gate** | **Mở** | **Active** | **Active/pay later** | **Verified pay-now trước active** | **Chọn** |

---

## 3. Contract “linked”

`linkedForDeferredPayment=true` không có nghĩa “bot biết một Facebook/Zalo ID”. Nó chỉ đúng khi exact endpoint-scoped `ChannelIdentity` và một Plexco `Account` có verified account identity cùng resolve tới current canonical `Person`, không bị freeze/conflict.

- Messenger Page-scoped PSID ≠ Facebook Login App-scoped subject.
- Zalo bot/OA-scoped `from.id` ≠ Zalo Login subject nếu chưa có bằng chứng/provider contract.
- Display name, provider equality hoặc ID client tự gửi không phải proof.
- `link_code` là cơ chế hoàn tất binding; bản thân code/“linked-lite” không mở pay-later nếu chưa có real verified Account.
- Account link trên endpoint mới cần explicit handoff trừ khi exact ChannelIdentity đó đã cùng Person với Account.

---

## 4. Money, capacity và waitlist

### 4.1 Không tạo fake booking trước payment

Live `charges` bắt buộc có `player_id`; allocations bắt buộc có charge. Unlinked pay-now vì vậy cần một durable orchestration record/seat hold riêng. Không thêm `payment_pending` vào `players`, không tạo temporary charge và không nhận ảnh chụp/lời khai là paid.

### 4.2 Capacity duy nhất

```text
occupied = active_players + unexpired_payment_holds
available = max(0, slots_max - occupied)
```

Một helper phục vụ join, approval, promotion và projector. `confirmed_count` vẫn chỉ đếm active players; hold chỉ dùng nội bộ để tính availability, còn hold count/identity luôn private.

### 4.3 Payment outcomes

- Exact payment → finalise active + charge + allocation atomically.
- Overpayment → allocate tối đa amount due, active; remainder ở unmatched/manual review.
- Underpayment → không active; giữ hold tới TTL rồi manual review. V1 không cộng nhiều khoản pre-charge để auto top-up.
- Late/wrong-code/wrong-currency/session-invalid → không revive booking; manual refund-or-credit review.
- Payment event đầu tiên được ingest bền vững trước expiry có thể hoàn tất sau expiry-processing; event ingested sau cutoff là late.

### 4.4 Waitlist fairness

Không thu tiền khi chưa có slot. Khi promoted:

- free → activate;
- paid+linked → activate+charge pay later;
- paid+unlinked → giữ một slot 15 phút và cho chọn link/pay.

Hết hạn: release hold, đưa candidate xuống cuối queue đúng một lần, tiếp tục selector. Đây là explicit fairness policy để tránh một unlinked candidate chặn cả hàng.

---

## 5. Approval và provider failure

- Request approval ban đầu chỉ tạo `join_requests.pending`; không hold/player/charge/payment/venue.
- Sau host approval, recheck live rồi áp cùng free/paid × linked/unlinked table.
- `join_requests.status='approved'` giữ nghĩa approval; trạng thái chờ payment thuộc booking intent, không overload approval.
- Pay-now chỉ enable khi tenant có capability + entitlement + provider/bank/market/currency/consent đủ để verify settlement tự động.
- Provider unhealthy/unknown → không phát QR hứa confirm. Free và linked pay-later vẫn hoạt động; unlinked paid được offer link/web.

---

## 6. Privacy và UX

- Bot browse trả time, public area, fee display, `confirmed_count` và `slots_available`. Hold count/identity
  không public; khi cần chỉ dùng copy chung như “một số chỗ đang được giữ”.
- Exact venue chỉ sau `active` theo DD-06.
- Không trả roster, debt, raw IDs hoặc bank/identity secrets.
- Account-link handoff opaque, hash-at-rest, single-use, 15-minute TTL, exact actor+endpoint+session+action-bound.
- Link resume luôn recheck price/capacity/session; thay đổi cần confirm lại.

---

## 7. Implementation decomposition

Thứ tự mechanism-based:

1. Identity endpoint/account-link completion core.
2. Pure channel booking decision core.
3. `channel_booking_intents` schema, RLS và lifecycle.
4. Canonical occupancy helper + join/approval/promotion/projector consumers.
5. Verified-payment finalizer + late/manual-review path.
6. Approval/waitlist integration.
7. Opaque account-link resume.
8. Messenger adapter.
9. Zalo adapter.
10. Cross-transport E2E + enablement evidence.

Không gộp adapters với session/payment writer; Messenger/Zalo phải là thin ports.

---

## 8. Closure matrix

| # | Gate | Evidence hiện tại | Kết quả |
|---:|---|---|---|
| 1 | Owner/product decision | Option D được yêu cầu và pin trong DD-32 | PASS |
| 2 | Canonical Product spec | Funnel v1.0 | PASS |
| 3 | Canonical BE companion | Funnel BE v1.0 | PASS |
| 4 | Decision table | Free/paid × linked/unlinked × capacity/approval/promotion | PASS |
| 5 | Identity boundary | Exact Account-backed Person predicate + endpoint scope | PASS |
| 6 | Money lifecycle | exact/over/under/late/duplicate pinned | PASS |
| 7 | Capacity/waitlist | one helper + 15-minute hold + requeue-tail | PASS |
| 8 | Privacy/security | area-only, aggregate-only, opaque single-use handoff | PASS |
| 9 | Acceptance matrix | Funnel Product+BE coverage + Session checklist v1.2 full retrace (14 UC/26 edges/29 AC/84 unit rows) | PASS |
| 10 | Live hard dependencies | Session/Join/Identity/Payment business runtime not implemented | FAIL |
| 11 | Executable first slice | No exact manifest/targets/migration number/readiness packet | FAIL |
| 12 | Immutable authority | Pack committed at `adf5eff5c079622bfede1f1aaf40edd556e421ce` (2026-07-29) | PASS |

Contract/decision closure is complete; code authorization is not. Closure **10/12** — rows 10 and 11
remain FAIL and each blocks independently, so closing row 12 does **not** move the verdict.

---

## 9. Readiness verdict

```text
REVIEW_POLICY_VERSION: 1.3
REVIEW_VERDICT: NOT_CODE_READY
REVIEWED_AT: 2026-07-28
AUTHORITY_SHA: adf5eff5c079622bfede1f1aaf40edd556e421ce
BASE_BRANCH: main
TARGET_FILES:
  - README.md
  - docs/README.md
  - docs/00-start-here/HANDOFF.md
  - docs/00-start-here/identity-model.md
  - docs/dd-32-booking-funnel-analysis.md
  - docs/dd-73-78-share-activity-analysis.md
  - docs/issues/session-management-acceptance-checklist.md
  - docs/pre-code-open-items-2026-07-16.md
  - docs/product/BRD.md
  - docs/product/PRD.md
  - docs/product/TDD.md
  - docs/product/ROADMAP.md
  - docs/standards/decisions.md
  - docs/standards/business-rules.md
  - docs/standards/feature-dependency-graph.md
  - docs/standards/BUILD-STATUS.md
  - docs/features/README.md
  - docs/features/feature_channel_booking_funnel.md
  - docs/features/BE/feature_channel_booking_funnel_tech.md
  - docs/features/feature_cross_club_join.md
  - docs/features/BE/feature_cross_club_join_tech.md
  - docs/features/feature_session_management.md
  - docs/features/BE/feature_session_management_tech.md
  - docs/features/feature_marketplace_discovery.md
  - docs/features/BE/feature_marketplace_discovery_tech.md
  - docs/features/feature_identity.md
  - docs/features/BE/feature_identity_tech.md
  - docs/features/feature_web_auth_onboarding.md
  - docs/features/BE/feature_web_auth_onboarding_tech.md
  - docs/features/feature_payment_reconcile.md
  - docs/features/BE/feature_payment_reconcile_tech.md
  - docs/features/feature_player_messenger.md
  - docs/features/BE/feature_player_messenger_tech.md
  - docs/channels/messenger/messenger-channel-design.md
  - docs/channels/messenger/README.md
  - docs/features/feature_zalo_channel.md
  - docs/features/BE/feature_zalo_channel_tech.md
  - docs/channels/zalo/README.md
SLICE: channel-booking-decision-contract
IN_SCOPE: channel browse summary, qualified account link, link-or-pay final gate, payment hold, approval and waitlist integration, shared finalizer contract
OUT_OF_SCOPE: runtime code or migration, provider procurement and credentials, changing DD-06 venue privacy, changing generic web guest join, committing or publishing the current worktree
G1_DECISION: PASS
G2_SPEC: PASS
G3_DEPENDENCY: FAIL
G4_TEST: PASS
G5_SCOPE: FAIL
G6_EXTERNAL: ENABLEMENT_ONLY:meta-app-review,zalo-login-verification,instant-settlement-provider-evidence
HARD_DEPENDENCIES: Session Join Waitlist Identity WebAuth Payment business cores are not merged
PRIOR_SLICES: identity-account-link-core -> channel-booking-decision-core -> channel-booking-intent-store -> session-occupancy-helper -> verified-payment-booking-finalizer
OPEN_QUESTIONS_IN_SCOPE: 0
ENABLEMENT_ONLY_GATES: Meta App Review; DD-14 Zalo Login verification; provider-bank-market-currency-consent-entitlement evidence
LIVE_REPO_VERIFICATION: PASS
CONTRACT_MATRIX: PASS
CLOSURE_MATRIX: FAIL
ACCEPTANCE_MATRIX: PASS
SECURITY_AND_MIGRATION_GATE: PASS
IMPLEMENTATION_ARTIFACTS: FAIL
FIRST_IMPLEMENTATION_STEP: author and review the identity-account-link-core packet against the current post-merge main
REMAINING_BLOCKERS:
  - blocker: required Session Join Waitlist Identity WebAuth and Payment business cores are not all implemented and merged
    owner: feature core owners
    resolution: every named hard dependency has a merged probe and green contract tests on current main
  - blocker: channel booking intent migration occupancy helper and atomic payment finalizer have no exact implementation packets
    owner: Session and Payment architecture owners
    resolution: mechanism-sized manifests include exact files migrations lock order rollback and nine-group acceptance matrices
NEXT_REVIEW_TRIGGER: merged hard-dependency probes plus an exact first-slice implementation packet; the committed-authority condition is closed at adf5eff
```

**Binary verdict:** `NOT_CODE_READY`. Decision/spec are closed; runtime permission remains blocked by the three binary conditions above.

---

## 10. Changelog

| Date | Version | Thay đổi |
|---|---|---|
| 2026-07-29 | v1.3 | **Authority pack committed — row 12 closes.** Re-pin `AUTHORITY_SHA` `784bc8d` → `adf5eff5c079622bfede1f1aaf40edd556e421ce`, the squash carrying the exact 27-file Option D pack. Closure 9/12 → **10/12**; the uncommitted-authority blocker is removed from `REMAINING_BLOCKERS` and `NEXT_REVIEW_TRIGGER` drops that condition. **Verdict stays `NOT_CODE_READY`** — rows 10 (hard dependencies not merged) and 11 (no exact first-slice packet) each block independently, so this is a pin-only change with zero contract movement. Sibling `session-management-acceptance-checklist.md` re-pinned to the same SHA in the same commit; the two DD-32 artifacts previously disagreed (`2dc9b8c` vs `784bc8d`) and now cannot. |
| 2026-07-28 | v1.2 | Re-pin live base to `main@784bc8d`; the intervening Chat docs commits do not close DD-32's uncommitted authority, hard-dependency or implementation-packet blockers. Verdict remains `NOT_CODE_READY`. |
| 2026-07-28 | v1.1 | Complete mirror propagation and Session acceptance retrace; public browse exposes confirmed/available counts but no hold count/identity; sync BL-DSC-1/DD-78/share-card whitelist with additive `confirmed_count`; expand exact TARGET_FILES while preserving `NOT_CODE_READY`. |
| 2026-07-28 | v1.0 | Reopen DD-32; replace Option A with Option D; pin Account predicate, 15-minute hold, approval/waitlist fairness, over/under/late payment, provider fail-closed, implementation split and readiness verdict. |
| 2026-07-19 | v0.8 | Option A timing re-check. Superseded by v1.0. |
| 2026-07-13 | v0.1 | Chọn Option A soft funnel. Superseded by v1.0. |
