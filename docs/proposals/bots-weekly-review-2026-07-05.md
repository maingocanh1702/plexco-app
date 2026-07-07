# Đề xuất kế thừa từ 2 bot (chatbot + payment bot) — delta tuần 28/06–04/07

> **Trạng thái:** 🟡 Draft đề xuất — chờ review · 2026-07-05
> **Loại tài liệu:** Proposal (chưa Reviewed). KHÔNG sửa `schema.ts`/`migrations`/spec đã Reviewed cho tới khi các DD liên quan ✅.
> **Phạm vi:** Chỉ soi **update MỚI trong tuần** của 2 bot, tiếp nối `research/bestminton-latest-scan-2026-06-21.md` (đã cũ ~2 tuần) và `research/bestminton-to-plexco-analysis.md`. Cái gì bản quét cũ đã bắt (lift pure logic, refund/credit, buddy roster, bank health, memo/pay_code) thì **không nhắc lại** — file này chỉ ghi phần **net-new**.
> **Nguồn & độ tin cậy:** verify từ **git log + PR diffs merged** 28/06→04/07 (đọc qua Linear diffs). **GitNexus index của 2 repo đang stale** (chatbot **347**, payment **93** commits behind HEAD, tại thời điểm quét 05/07) → chỉ dùng để **navigation**, KHÔNG phải nguồn code hiện tại. Các PR/commit dưới đây đã spot-check là có thật và đã **merge vào `main`** của 2 repo reference; **không** có bằng chứng deploy nên tránh mọi khẳng định "đang chạy production".
> **Canonical đối chiếu:** `HANDOFF.md §3` (5 HARD RULES) · `standards/decisions.md` (**DD-19/20/21** đã làm rõ scope trợ lý 05/07) · `proposals/club-ai-bot-knowledge-base.md` · `feature_identity.md` (Bất biến + ID-UC-7/8) · `feature_payment_reconcile.md` + `business-rules.md` (BL-PAY-1..9) · `feature_tenant_routing_authz*`.

---

## 0. TL;DR

Hai project là **repo riêng** của cùng owner (`maingocanh1702`), không nằm trong repo Plexco:

| Tên gọi user | Repo | Vai trò |
|---|---|---|
| **payment bot** | `bestmintonclub-payment-check-bot` | Bot "đường tiền": join/leave, đối soát CK, refund/credit, buddy roster, pay_code — cái Plexco định lift thành tenant #1. |
| **chatbot** | `bestminton-club-chatbot` (nội bộ gọi *clawbot / advisor / concierge*) | Bot MỚI: trợ lý AI + KB + intent router đứng **trước**, và **bắc cầu** sang payment bot **trong group chat ngoài (TG/Zalo)**. |

**Chuyện lớn nhất tuần rồi:** 2 bot tách thành **concierge AI đứng trước payment bot ngay trong group ngoài**, chạy pipeline `admission → ai/kb → payment` + một lớp **bridge 2-process** chuyển trạng thái hội thoại nhiều bước.

> ⚠️ **Lưu ý scope ngay từ đầu:** đây là kiến trúc của *bot*, **không phải** đường Plexco đã chọn. Canonical vừa chốt ngược lại: **DD-19** — trợ lý Plexco **CHỈ trong app**, không trả lời TG/Zalo/Messenger; **DD-20/21** — trợ lý là config tenant, **không** chạm tiền/PII, chỉ ground KB. Vì vậy file này **KHÔNG** đề xuất bê nguyên mô hình "concierge front tiền trong group ngoài" — làm thế = mở lại scope DD-19 vừa đóng. Giá trị rút ra là: (a) vài **cơ chế đã hardened** có thể đặt đúng chỗ trong kiến trúc *tách rời* của Plexco, (b) vài **anti-pattern/tương phản** để tránh.

5 nhóm, xếp ưu tiên: (1) **primitive multi-step "pending-slot" cho lệnh tiền/host** (không phải assistant), (2) **guardrail chất lượng AI** bổ sung vào proposal Club Assistant, (3) **confirm-before-persist cho identity money-adjacent** (delta trên spec identity đã có), (4) **preview/confirm cho thao tác tiền do người khởi tạo**, (5) **channel-aware authz + DoD/parity-audit**.

---

## 1. Bối cảnh: cái gì đã đổi so với bản quét 21/06

Bản quét 21/06 mới thấy payment bot ở dạng **1 bot đơn**. Trong 2 tuần kế đó luồng phát triển rẽ sang mô hình **2 bot**:

- `bestminton-club-chatbot` dựng như **advisor/concierge**: nhận tin trong group, chạy **intent router (TF-IDF + seeds)** → hoặc trả lời từ **KB (RAG)**, hoặc **fetch live-context** (session/slot), hoặc **forward** lệnh người chơi (`/credit`, `/refundbank`, `PAYMENT:join`, buddy taps) sang payment bot.
- Hai bot **nói chuyện với nhau** qua bridge: chatbot **forward `expectNextText`** của payment bot cho flow nhiều bước; payment bot gửi lại **control signal** (silent pending-cancel, clear-pending on cap-fire); có **dedup in-flight** + **giới hạn re-arm** chống loop.

**Quan trọng khi map sang Plexco:** trong bot, concierge + money là **2 process rời trong group ngoài** nên phải bridge qua mạng. Plexco đã chọn khác (DD-19/20/21): trợ lý **in-app, KB-only, không chạm tiền**; module tiền là **canonical store riêng**. Nên phần lift được **không phải** cái funnel, mà là các cơ chế con — và mỗi cái phải về **đúng nhà** của nó trong kiến trúc tách rời.

---

## 2. Bảng đề xuất (xếp ưu tiên)

Ký hiệu: **P1** làm sớm/giá trị cao · **P2** nên có · **P3** nice-to-have. Cột "HR/DD" = hard-rule/decision liên quan.

### 2A. Multi-step interaction & orchestration (đặt đúng nhà, KHÔNG mở scope trợ lý)

| # | Pattern tuần rồi (evidence) | Đề xuất cho Plexco | Ưu tiên | HR/DD |
|---|---|---|---|---|
| O1 | Bot gộp `admission → ai/kb → payment` thành 1 funnel, concierge front tiền **trong group ngoài** (chatbot #59) | **Quan sát/tương phản — KHÔNG adopt funnel.** Plexco cố ý **tách**: trợ lý in-app KB-only (DD-19/20/21), module tiền riêng. Ghi nhận đây là **validation ngược** cho quyết định tách của Plexco. Nếu sau này muốn trợ lý ra kênh ngoài → phải **mở lại DD-19 tường minh**, không nhét lén vào proposal. | **P1 (ghi nhận)** | DD-19/20/21 · HR3 |
| O2 | **Multi-turn "pending slot"**: `expectNextText` chờ gõ (chatbot #60), **chip-tap fail-closed** (chatbot #47), **bound re-arm** chống loop (chatbot #62), **silent cancel signal** (payment #63), **clear-pending on cap-fire** (payment #64), **dedup in-flight** (payment #62) | Đây là primitive giá trị — nhưng đặt ở **module tiền/host command**, **không** phải trợ lý. Plexco hiện **chưa có** khái niệm "lệnh nhiều bước chờ input" trong docs. Đề xuất: **`pending_interaction` tenant-private** (hoặc mở rộng command bus): 1 slot chờ input, **idempotent theo `command_id`** (P8/INV-6), **có hạn re-arm + timeout sweep**, **cancelable**, **fail-closed** khi tap sai. Dùng cho các flow như two-phase confirm (M1), STK change. | **P1** | HR3 · INV-6/P8 |
| O3 | **Bridge 2-process** (forward pending state + control signal giữa 2 bot) | ⛔ **KHÔNG lift nguyên** — multi-master trá hình, phạm **HR3**. Ở Plexco: hand-off **in-process**, trạng thái ở **canonical**, fan-out surface qua **outbox → projector**. Bài học *ngược*: **nhu cầu** (hand-off/cancel/dedup) là thật, **cách làm** của bot không hợp Plexco. | **P1 (cảnh báo)** | **HR3** |
| O4 | **"no-eat" admission** — concierge không nuốt tin thuộc flow đang chạy (chatbot #30/#31/#33) | Ở Plexco phần lớn **đã moot**: trợ lý in-app + `answer_mode='mention_only'` (DD-19, proposal §4.1). Phần còn lại: trong native chat (pha B), assistant không được "nuốt" message đang thuộc một flow có cấu trúc → gộp vào invariant của O2. | **P3** | DD-19/20 |

### 2B. Guardrail chất lượng AI (đã implement & merge ở chatbot → bổ sung vào proposal Club Assistant)

Proposal `club-ai-bot-knowledge-base.md` viết từ *pipeline mẫu* (ảnh tham khảo), chưa có các cơ chế vận hành thực nghiệm dưới đây. Đề xuất **thêm vào §6 của proposal đó** (không tạo doc song song):

| # | Update tuần rồi (evidence) | Đề xuất cho Plexco | Ưu tiên | HR/DD |
|---|---|---|---|---|
| A1 | **Grounding-based hallucination trigger + ambiguity-soften** (chatbot #36) + **grounding/truthfulness counters** (chatbot #66) | Nâng §6.6 (observability): thêm **counter grounding/truthfulness** (bao nhiêu câu được ground đủ / bị chặn vì thiếu ground) + **trigger khi câu trả lời vượt khỏi KB**. Là bằng chứng đo được cho DD-21 (KB-only). | **P1** | DD-21 · HR2 |
| A2 | **Intent router / TF-IDF + topic seeds** (chatbot #55, #34, #32) | Thêm **tầng phân loại intent rẻ (pre-LLM)** trước hybrid-retrieve (§5.2): tiết kiệm token + tăng precision. Bổ sung answer path, không thay RRF. | **P2** | DD-23 |
| A3 | **Live-context fetch + "bias-to-fetch" gate** (chatbot #46, #38, #42) — bot đọc slot/capacity thật | **KHÔNG gộp vào DD-21.** DD-21 chốt trợ lý **chỉ** ground `kb_chunks`; đọc dữ liệu vận hành = **tool riêng, DD mới** (giống "hỏi nợ của tôi"). Xem **DD-28 đề xuất §4**: tool live-context có **field-whitelist matrix + authz**, **cấm** đưa ledger/PII vào prompt. | **P1 (tách DD)** | HR2 · DD-21 |
| A4 | **Cost guard**: model-by-context routing (chatbot #42, #39), **prompt-cache** system prompt tĩnh (chatbot #28), **token cap** per-user/channel (chatbot #43) | Bổ sung §6.4/DD-22: routing model theo độ khó, prompt-cache, cap token theo person+tenant (khớp `bot_configs.monthly_question_cap`). Biến cost LLM thành có trần, gate theo gói. | **P2** | DD-22 |
| A5 | **Over-deflection tuning** (chatbot #49) + **KB hot-reload mtime** (chatbot #41) | `bot_configs.min_similarity` phải **tunable per-tenant** (ngưỡng cao → "chưa có thông tin" quá nhiều). Hot-reload KB khi admin sửa (map vào ingest `content_hash`). | **P3** | DD-16 |
| A6 | **i18n mềm**: language soft-mirror thay hard-lock (chatbot #37), locale-aware fallback (chatbot #45), one-voice wrap (chatbot #40) | HR5 vẫn `t(vi,en)`, thêm nguyên tắc **soft-mirror ngôn ngữ người hỏi** thay vì khoá cứng; fallback theo locale; gộp 1 giọng. | **P3** | HR5 |

### 2C. Identity money-adjacent — confirm-before-persist (delta trên spec đã có)

> Spec identity Plexco **đã có** explicit confirmation, strong-key claim, owner review, immutable audit (`feature_identity.md` Bất biến + ID-UC-7/8). Phần dưới là **delta wording**, **không** giới thiệu "buddy" như model mới.

| # | Update tuần rồi (evidence) | Đề xuất cho Plexco | Ưu tiên | HR/DD |
|---|---|---|---|---|
| I1 | **Confirm gate trước khi persist tên buddy** (payment #54) + **parity audit TG/Zalo/Messenger** (payment #50 docs) | Delta cho BL-ID: **display_name/alias/claim-suggestion money-adjacent KHÔNG được persist hoặc ảnh hưởng matching nếu chưa có explicit confirmation + audit**; và **cross-channel parity** thành **test bắt buộc** (mọi surface cùng cư xử). Đây là bản mở rộng của bất biến "chỉ verified signal mới auto-merge; tên/STK chỉ tạo suggestion". | **P1** | HR4 · DD-01 · BL-ID |
| I2 | **Multi-name intake** (payment #57) + **collision interactive ask** (payment #58/#59) + **alias-norm collision guard** (payment #61) | Ăn khớp candidate backlog `player-managed-buddies` (managed-subjects). Delta: khi alias chuẩn-hoá đụng nhau → **hỏi lại tương tác**, không tự gán; và **không** để collision-ask thành đường settle bằng tên (đụng tiền vẫn pay_code/manual). | **P2** | HR4 · BL-ID |
| I3 | **`/add` `/unlink` bare → inline member picker** (payment #47) | Reference UX: thao tác định danh qua **picker có xác nhận**, không nhận free-text → giảm gán nhầm. | **P3** | BL-ID |

### 2D. Payment / refund — preview/confirm cho thao tác do người khởi tạo

> ⚠️ **Không** áp cho automated reconcile. Contract tiền đã có durable webhook, safe-plan auto-match, manual allocation, reversal, cash provenance, STK pending 24h (`feature_payment_reconcile.md` Bất biến + BL-PAY-1..9). Delta chỉ nhắm **thao tác do người khởi tạo làm đổi đích tiền / mutate ledger**.

| # | Update tuần rồi (evidence) | Đề xuất cho Plexco | Ưu tiên | HR/DD |
|---|---|---|---|---|
| M1 | **`/refundbank` two-phase confirm** (payment #52) + **single-slot refund-bank-capture + `/credit` leaf** (payment #55) + **refund STK seq global** (payment #53) | Delta BL-PAY/BL-NTF: **human-initiated money-destination change hoặc ledger mutation** (refund tới STK, credit cashout, đổi STK nhận) phải **preview + 2-pha confirm**, capture single-slot fail-closed. **Automated provider ingest/worker settlement KHÔNG đòi confirm** — vẫn safe-plan + fail-closed (BL-PAY-1/3). Gắn STK-change G1 (`single-club-bot-port-map §4`). | **P1** | HR4 · BL-PAY |
| M2 | **Allow-list lệnh người chơi được forward** (`/credit`, `/refundbank`) (chatbot #56, #52) | Nếu (tương lai) có lớp trước module tiền, phải có **allow-list tường minh** lệnh nào tới money-service; còn lại chặn. Nguyên tắc: lớp AI **không** tự suy diễn lệnh tiền. | **P2** | HR3/HR4 |
| M3 | Context chỉ emit `PAYMENT:join` cho session joinable (payment #51), lộ joinedCount/capacity (payment #48), cash-or-transfer line (payment #49) | Reference cho **live-context whitelist** (A3/DD-28): chỉ trường không-PII, chỉ khi hợp lệ. Khớp DD-06 (độ chi tiết public theo trạng thái). | **P2** | HR2 · DD-06 |

### 2E. Hạ tầng / quy trình (DoD)

| # | Update tuần rồi (evidence) | Đề xuất cho Plexco | Ưu tiên | HR/DD |
|---|---|---|---|---|
| P1 | **Channel-aware owner/admin gating** (chatbot #61) + **channel-appropriate `/help` `/status` `/start`** (chatbot #63) | Đưa vào `feature_tenant_routing_authz`: **authz + tập lệnh khả dụng tính theo capability từng kênh**. Surface-agnostic core, gating theo kênh. | **P2** | HR3 |
| P2 | **Design-probe → GREEN gate** (payment #56) + **parity audit doc** (payment #50) + **metric-per-feature** (grounding #66, action-tag #39) | Khớp autopilot workflow sẵn có: thêm vào **DoD feature**: (a) design-probe GREEN gate, (b) cross-channel parity audit, (c) metric counter kèm mỗi feature. | **P2** | — |
| P3 | **Carousel resilience per-card fallback** (chatbot #29) + **CTA dedup** (chatbot #35) | Nguyên tắc UX degradation cho player_view/discovery: render được cái nào render cái đó, **không all-or-nothing**; dedup CTA. | **P3** | — |

---

## 3. Cảnh báo — cái KHÔNG được bê nguyên

1. **Concierge front tiền trong kênh ngoài (O1).** Đối đầu **DD-19** (trợ lý chỉ in-app) + **DD-20/21** (không chạm tiền/PII). Muốn làm phải **mở lại DD-19 tường minh**, không nhét lén.
2. **Bridge 2-process (O3).** Multi-master trá hình, phạm **HR3**. Plexco làm bằng command in-process + canonical pending-state + outbox/projector.
3. **Live-context ≠ nới DD-21 (A3).** Đọc slot/capacity là **tool riêng (DD-28)** với whitelist + authz; **không** đưa `charges`/`memberships`/SĐT vào context LLM. Giữ đúng DD-21/HR2.
4. **Fuzzy multi-name cho tiền.** Multi-name intake (I2) tốt cho *roster*, nhưng đụng **tiền** vẫn pay_code deterministic / manual (HANDOFF §8, BL-PAY-3/5).
5. **Two-phase confirm ≠ áp cho automated reconcile (M1).** Chỉ áp thao tác **do người khởi tạo** đổi đích tiền/ledger; worker settlement vẫn safe-plan.
6. **Transport lớn** (`bot.ts`/`zbot.ts`) vẫn không lift (cảnh báo scan cũ). Chỉ lift core + pattern, viết lại tầng data/RLS.

---

## 4. Việc cụ thể đề xuất (nếu duyệt)

Không sửa spec Reviewed; chỉ đề xuất cập nhật **proposal/decision** + thêm DD mới:

1. **Mở rộng `proposals/club-ai-bot-knowledge-base.md`**: thêm **Intent router pre-LLM (A2)**; làm dày **§6.6** với **grounding/truthfulness counters + hallucination trigger (A1)** + **cost guard (A4)**. (Admission/no-eat **O4** phần lớn moot vì DD-19 in-app + mention-only.)
2. **DD mới đề xuất** trong `standards/decisions.md` (kế tiếp DD-23):
   - **DD-24** — Primitive `pending_interaction` (multi-step, idempotent, bounded re-arm, cancelable, fail-closed) cho **lệnh tiền/host**, canonical-store-based (không bridge). 🟡
   - **DD-25** — **Preview + two-phase confirm** cho **human-initiated money-destination/ledger mutation** (refund/credit/STK change); **KHÔNG** áp automated reconcile (safe-plan giữ nguyên). 🟡 → gắn BL-PAY.
   - **DD-26** — **Confirm-before-persist + cross-channel parity audit** cho **display_name/alias/claim-suggestion money-adjacent** (delta trên identity Bất biến, không thêm model "buddy"). 🟡 → gắn BL-ID/DD-01.
   - **DD-27** — **Channel-aware authz & command-surface** (P1). 🟡 → `feature_tenant_routing_authz`.
   - **DD-28** — **Tool live-context (đọc dữ liệu vận hành non-PII)** tách khỏi KB-RAG: **field-whitelist matrix + authz + cấm ledger/PII vào prompt** (A3). 🟡 → tách khỏi DD-21.
3. **Cập nhật DoD** ở autopilot templates: design-probe GREEN gate + parity audit + metric-per-feature (P2).
4. **(Tuỳ chọn) Port-map cấp file:** GitNexus index 2 repo **stale** (chatbot 347 / payment 93 commits behind) → chạy `gitnexus analyze` cập nhật trước khi map cấp hàm; `single-club-bot-port-map.md` hiện còn nhiều dòng *(giả định)*.

---

## 5. Bằng chứng (PR merged 28/06–04/07, verify từ PR diffs)

**chatbot (`bestminton-club-chatbot`):** #66 grounding counters · #65 zalo FAQ-escape · #64 clear-pending on cap-fire · #63 channel-appropriate help · #62 bound re-arm · #61 channel-aware admin gate · #60 forward expectNextText · #59 zalo-adapter shared pipeline · #58/#57 payment-bridge buddyadd · #56 whitelist /credit · #55 TF-IDF leave/refund seeds · #52 /refundbank whitelist · #51 strip joined chips · #50 leave-NL clarify · #49 KB coverage/over-deflection · #47 chip-tap fail-closed slot · #46 bias-to-fetch · #45 locale fallback · #43 token caps · #42 model-by-context · #41 KB hot-reload · #40 one-voice · #39 model-by-context+metrics · #37 language soft-mirror · #36 grounding hallucination trigger · #34 topic-wire · #33/#31/#30 admission no-eat · #28 prompt-cache.

**payment bot (`bestmintonclub-payment-check-bot`):** #64 warm copy · #63 silent pending-cancel · #62 dedup in-flight · #61 alias-norm collision guard · #60 TG+Zalo buddy parity · #59 arm expectNextText on collision-ask · #58 companion-collision ask · #57 multi-name intake · #56 design-probe GREEN gate · #55 refund-bank single-slot + /credit · #54 confirm-before-persist buddy · #53 refund STK seq global · #52 /refundbank two-phase confirm · #51 joinable-only PAYMENT:join · #50 confirm-before-persist parity audit · #48 expose joinedCount/capacity · #47 /add /unlink picker.

> Độ tin cậy: commit/PR verify từ **local git log + diffs**; GitNexus stale nên chỉ dùng navigation. Không có bằng chứng deploy → không khẳng định "production".

---

## Changelog

| Ngày | Version | Thay đổi |
|------|---------|----------|
| 05/07/2026 | v0.1 | Khởi tạo review delta tuần 28/06–04/07; đề xuất O1-O4, A1-A6, I1-I3, M1-M3, P1-P3 + DD-24..DD-27. |
| 05/07/2026 | v0.2 | Fix review: (1) O1/O4 không mở lại scope DD-19 (trợ lý in-app only), tái khung O2 primitive về module tiền/host; (2) A3 tách thành **DD-28** riêng (field matrix+authz), không gộp DD-21; (3) DD-25 thu hẹp về human-initiated mutation, chừa automated reconcile; (4) DD-26 đổi thành delta identity money-adjacent, bỏ "buddy" như model mới; (5) hạ giọng nguồn (git log/PR, GitNexus stale 347/93, bỏ "production"). |
