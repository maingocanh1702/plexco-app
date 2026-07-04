# Port-map cấp hàm — pattern P1 từ 2 bot → Plexco

> **Trạng thái:** 🟡 Draft đề xuất — chờ review · 2026-07-05
> **Khác với `single-club-bot-port-map.md`:** file đó viết khi CHƯA có repo (nhiều dòng *(giả định)*). File này **verify trực tiếp trên source thật** của 2 repo tại HEAD `main`: chatbot `2ad0e7e`, payment bot `2c6d99b` (đều 2026-07-05). Số dòng là **point-in-time** theo HEAD đó.
> **Phạm vi:** chỉ 5 pattern **P1** trong `bots-weekly-review-2026-07-05.md` (O2, A1, A2, A3+DD-28, I1/I2, M1). Kèm M2 (allow-list).
> **Quy ước verdict:** ♻️ lift pure · ⚠️ lift một phần (tách I/O/persist) · 🔁 viết lại (chỉ mượn ý) · ⛔ không lift.

---

## 0. Bản đồ file nguồn (đã xác định)

**chatbot `bestminton-club-chatbot`** (JS, `src/`):
- `src/ai/engine.js` — `createAIEngine`, `generate` (L735), `detectHallucination` (L1006), `detectAmbiguity`, `detectQueryTopic`, `selectModel` (L205), `buildUserPrompt` (L614), `estimateTokens`, `extractActionTag`, `formatContextSummary`/`formatRegistrationContext`.
- `src/admission/` — `controller.js` (`createAdmissionController`, `check`, `checkChannelBudget` L129), `classifier.js` (`classify` L11), `noise.js`, `spam.js`.
- `src/metrics/collector.js` — registry counters + `inc(name)` (no-op nếu name chưa register).
- `src/payment/` — `intent-router.js` (`classifyActionIntent` L197), `action-gate.js` (`evaluateProposal` L21, `evaluateAffirmation` L171), `bridge-client.js`, `zalo-bridge-client.js` (forward `expectNextText`, cap-cancel signal), `classifier.js`, `action-chips.js`.
- `src/kb/` — KB ingest/retrieve.

**payment bot `bestmintonclub-payment-check-bot`** (TS, `src/`):
- `src/buddy-actions-core.ts` — `createManagedBuddy` (L119), `parseCompanionNames` (L203), `seatCompanions` (L331), `resolveBuddyCollision` (L392), `resolveBuddyCollisionDeferred` (L493).
- `src/messenger/cmds/refund-capture-state.ts` — `armRefundCapture` (L27), `getRefundCapture` (L32), `setRefundCaptureBankInfo` (L43), `clearRefundCapture` (L50).
- `src/zalo/bridge.ts` — `createMessageDedupe` (L155), dedup-in-flight-outcome (reserve-before-dispatch), `control:'pending_cancel'`, `expectNextText` relay contract, `DEDUPE_TTL_MS`.
- `src/paid-leave-core.ts` — refund/credit compute (`parseRefundBankInfo`, `buildRefundTransferQr` — đã ghi ở scan 21/06).

---

## 1. O2 — pending-slot / multi-step interaction → **DD-24**

| Nguồn (file:func) | Vai trò trong bot | Target Plexco | Verdict |
|---|---|---|---|
| payment `messenger/cmds/refund-capture-state.ts` : `armRefundCapture`/`getRefundCapture`/`setRefundCaptureBankInfo`/`clearRefundCapture` | State machine 1-slot per-psid (arm → capture bank info → clear; **fail-closed clear** khi không resolve) | `pending_interaction` (canonical, tenant-private) + command bus | ⚠️ **Lift shape, rewrite storage** |
| payment `zalo/bridge.ts` : `createMessageDedupe` + reserve-before-dispatch + `control:'pending_cancel'` + `expectNextText` relay + `DEDUPE_TTL_MS` (~1h) | Dedup in-flight (await outcome thật), cancel signal, quan hệ pending cross-process | idempotency `command_id` (P8/INV-6) + cancelable slot + timeout sweep (pg-boss) | ⚠️ **Lift ý dedup/cancel, bỏ HTTP bridge** |
| chatbot `payment/zalo-bridge-client.js` / `bridge-client.js` : forward `expectNextText`, cap-cancel | Client-side đẩy pending giữa 2 process | ⛔ **KHÔNG lift** (đây là O3 bridge) — Plexco hand-off in-process | ⛔ |

**Cách port:** giữ **shape state-machine** (`arm → await input → (cancel | resolve) → clear`, fail-closed) + **reserve-before-dispatch dedup**; thay **in-memory per-psid map → row canonical** khoá `(tenant, actor, flow, command_id)`, **bounded re-arm + timeout sweep**. Bỏ hẳn: `X-Bridge-Secret` HTTP relay, keying theo `psid`. Chủ sở hữu = module tiền/host (không phải trợ lý).

---

## 2. A1 — grounding / hallucination / metrics → **DD-21 §6.6**

| Nguồn (file:func) | Vai trò | Target Plexco | Verdict |
|---|---|---|---|
| chatbot `ai/engine.js` : `detectHallucination(response, kbChunks)` (L1006), `detectAmbiguity` | Chặn/gắn cờ câu trả lời vượt khỏi KB; nới câu mơ hồ | `packages/core` grounding helpers (thuần) → gọi trong answer worker (§5.2) | ♻️ **Lift pure** (2 hàm này không I/O) |
| chatbot `ai/engine.js` : `buildUserPrompt(kbChunks,…)` (L614) — "chỉ trả lời từ NGỮ CẢNH" | Prompt grounding | Prompt builder trong answer worker | ♻️/⚠️ **Lift template**, giữ DATA-label |
| chatbot `metrics/collector.js` : registry + `inc()` (no-op nếu chưa register) | Counter vận hành (grounding/action-tag) | Observability Plexco (§6.6) — counter **tenant-tagged** | 🔁 **Viết lại** theo metric stack Plexco, giữ pattern "explicit-register" |

**Cách port:** `detectHallucination`/`detectAmbiguity` là **pure → lift thẳng** vào `packages/core`; đấu vào answer worker để sinh **grounding/truthfulness counter** (bằng chứng đo được cho DD-21). Giữ pattern registry (`inc` no-op nếu chưa khai báo) để tránh metric "ma".

---

## 3. A2 — intent router pre-LLM → **DD-23 §5.2 bước 0**

| Nguồn (file:func) | Vai trò | Target Plexco | Verdict |
|---|---|---|---|
| chatbot `payment/intent-router.js` : `classifyActionIntent(text, ctx)` (L197) | Phân loại action-intent (rẻ, pre-LLM) | `packages/core` intent classifier (thuần) = bước 0 trước hybrid-retrieve | ♻️ **Lift pure** |
| chatbot `admission/classifier.js` : `classify(text)` (L11) + `ai/engine.js` : `detectQueryTopic` | Seed/topic classification | Gộp vào classifier core, seed **cấu hình per-tenant** | ♻️ **Lift**, generalize seeds |

**Cách port:** lift logic seed/TF-IDF (thuần) → route `KB-question | live-context(DD-28) | out-of-scope`; **generalize** keyword khỏi "badminton/club-specific" thành seed theo tenant.

---

## 4. A3 — live-context tool (tách khỏi KB-RAG) → **DD-28**

| Nguồn (file:func) | Vai trò | Target Plexco | Verdict |
|---|---|---|---|
| chatbot `ai/engine.js` : `selectModel(…,{contextPresent,actionLikely})` (L205), `formatContextSummary`/`formatRegistrationContext` | Fold live-context (session/roster) vào trả lời | ⛔ **Không** đưa roster vào prompt như bot; chỉ mượn ý "field nào an toàn" | 🔁 **Viết lại** |
| payment context providers (PR #48/#51: joinedCount/capacity, joinable-only) | Nguồn field whitelist | `read_live_context(tenant)` — matrix non-PII + RLS + authz (DD-28) | 🔁 **Viết lại** (đóng khung whitelist) |

**Cách port:** **KHÔNG** bê cách bot nhét roster/context vào LLM (single-club, không ranh giới tenant). Chỉ lấy **danh sách field an toàn** (môn/giờ/slot còn/tối đa/joinable) làm **whitelist matrix**; tool riêng `read_live_context(tenant)` dưới RLS + authz member; **cấm** ledger/charges/memberships/SĐT vào prompt. Field whitelist = test bất biến.

---

## 5. I1/I2 — confirm-before-persist + collision (identity) → **DD-26**

| Nguồn (file:func) | Vai trò | Target Plexco | Verdict |
|---|---|---|---|
| payment `buddy-actions-core.ts` : `parseCompanionNames` (L203) | Multi-name intake (parse nhiều bạn từ 1 câu) | `packages/core` name-parse (thuần) | ♻️ **Lift pure** |
| payment `buddy-actions-core.ts` : `resolveBuddyCollision` (L392) | Phát hiện alias-norm đụng nhau | `packages/core` collision-detect (thuần) + normalize | ♻️ **Lift pure** |
| payment `buddy-actions-core.ts` : `resolveBuddyCollisionDeferred` (L493) | **Deferred = confirm-before-persist** (hỏi lại trước khi ghi) | Ánh xạ vào **explicit-confirmation invariant** của `feature_identity.md` | ⚠️ **Lift ý, rewrite persist** |
| payment `buddy-actions-core.ts` : `createManagedBuddy` (L119), `seatCompanions` (L331) | Managed-subject actions | Identity/Membership authz (đã có) — **không** tạo model "buddy" mới | 🔁 **Viết lại** qua Person/Membership |

**Cách port:** parse/normalize/collision là **pure → lift**; `resolveBuddyCollisionDeferred` chính là bằng chứng "không persist khi chưa confirm" → nối vào invariant identity + audit sẵn có. Bỏ store member phẳng single-club → Person/Membership; đụng **tiền** vẫn pay_code/manual (không settle bằng tên).

---

## 6. M1 — two-phase confirm money (human-initiated) → **DD-25**

| Nguồn (file:func) | Vai trò | Target Plexco | Verdict |
|---|---|---|---|
| payment `messenger/cmds/refund-capture-state.ts` : `arm/get/set/clearRefundCapture` | Slot 2-pha: arm → nhập STK → confirm → clear (fail-closed) | Money command handler **trên `pending_interaction` (DD-24)** | ⚠️ **Adapt onto DD-24** |
| payment `paid-leave-core.ts` : `parseRefundBankInfo`, `buildRefundTransferQr` | Compute refund + memo NAPAS-safe + VietQR | `packages/core` (thuần) — đã ghi ở scan 21/06 | ♻️ **Lift pure** |
| ledger persist | Ghi refund/credit | **Ledger service (writer duy nhất)**, immutable + reversal (BL-PAY-8) | 🔁 **Viết lại** |

**Cách port:** lift compute refund/QR (pure) + đặt **two-phase capture** lên `pending_interaction` (DD-24). Chỉ áp cho **human-initiated** mutation; **automated ingest/settlement KHÔNG confirm** (safe-plan, BL-PAY-1/3). Persist qua ledger service, không cho transport tự cấp tiền.

### 6b. M2 — allow-list lệnh forward (nếu có lớp trước money)
chatbot `payment/action-gate.js` : `evaluateProposal` (L21) / `evaluateAffirmation` (L171) → **allow-list tường minh** lệnh nào tới money-service. ⚠️ **Adapt** nếu Plexco có lớp trung gian; nguyên tắc: lớp AI **không** tự suy diễn lệnh tiền.

---

## 7. Tóm tắt verdict

| Pattern | Lift pure | Adapt | Rewrite/Không lift |
|---|---|---|---|
| O2 pending-slot | — | shape state-machine + dedup | ⛔ bridge cross-process |
| A1 grounding | `detectHallucination`, `detectAmbiguity` | prompt template | metrics stack |
| A2 intent router | `classifyActionIntent`, seed classify | — | — |
| A3 live-context | — | field whitelist idea | roster→prompt (viết lại DD-28) |
| I1/I2 identity | `parseCompanionNames`, `resolveBuddyCollision` | deferred→confirm invariant | persist qua Person/Membership |
| M1 money 2-phase | `parseRefundBankInfo`, `buildRefundTransferQr` | capture onto DD-24 | persist qua ledger |

**Nguyên tắc xuyên suốt:** lift phần **pure logic** (đã battle-tested) vào `packages/core`; mọi phần **I/O, persist, cross-process bridge, single-club store** đều **viết lại** trên canonical + RLS + ledger. Đúng lằn ranh HANDOFF §8 + 5 HARD RULES.

---

## Changelog

| Ngày | Version | Thay đổi |
|------|---------|----------|
| 05/07/2026 | v0.1 | Port-map cấp hàm 5 pattern P1, verify trên source thật HEAD chatbot `2ad0e7e` / payment `2c6d99b`. |
