# 🧭 Founder Decision Brief — Open items (2026-07-15, rev 5)

> ✅ **CLOSED (2026-07-16):** founder đã chốt toàn bộ Items 2–9; canonical hiện tại là `standards/decisions.md` **v1.39**. DD-49..56 được code-aware clarify/full-propagate ở v1.37 (append-only correction, OIDC/email lifecycle, open-DM hard safety gate, exact capability matrix); DD-57..60 là proposal mới, không đổi closure này. Item 7/8 giữ nguyên trạng thái (DD-18 ⬜ go-live gate; DD-34/35/36 approve-in-principle). Brief này giữ làm **lịch sử phân tích** — các table/CTA cũ bên dưới đã bị canonical decisions supersede; tracking hiện hành ở `pre-code-open-items-2026-07-16.md`.

> **Mục đích:** gom các item **còn cần founder quyết** thành một chỗ để duyệt một lượt. Mỗi item = **câu hỏi · options · đề xuất · tác động/độ gấp · pointer canonical**.
> **Authority hiện tại:** `standards/decisions.md` v1.39. Brief rev 5 này chỉ là historical input; nếu body mâu thuẫn DD-49..56 v1.37+ thì decisions + propagated feature specs thắng.
> **Phân loại nguồn:** 🔴 = cần founder (business/product/legal). Item spike (DD-14/15 Zalo, DD-33 Facebook App Review, connector CO-OQ) là **verify kỹ thuật/bên ngoài**, KHÔNG nằm trong brief này.
>
> ⚠️ **Không phải tư vấn tài chính/pháp lý.** Item 3 (tiền) và Item 6 (pháp lý) đưa thông tin để quyết. **Item 6 bắt buộc luật sư VN** rà theo **Luật 91/2025/QH15 + Nghị định 356/2025/NĐ-CP** (hiệu lực 01/01/2026) — **KHÔNG** dùng Nghị định 13/2023 (đã hết hiệu lực). Theo hiểu biết hiện tại (**cần luật sư VN xác nhận, chưa phải kết luận pháp lý**), NĐ 356 dường như xếp ngày sinh và giới tính vào **dữ liệu cá nhân cơ bản** chứ không phải nhóm nhạy cảm; Plexco vẫn mã hoá + xin consent theo product/security policy — không dựa vào phân loại này cho tới khi luật sư xác nhận.

> **Rev 3 — post-review closure (2026-07-15):** sửa theo review findings F-01…F-08 và re-check live schema/spec.
> - **F-01:** re-baseline pháp lý → Luật 91/2025 + NĐ 356/2025 (bỏ NĐ 13/2023 đã hết hiệu lực).
> - **F-02:** bỏ "hard-delete whole person" → **anonymize matrix per-data-class** giữ ledger/audit + opaque anchor.
> - **F-03:** override actor = **PlatformAdmin** (KHÔNG owner/admin) + auto-expire + max-duration/lý do/audit/escalation.
> - **F-04:** Item 3 tách thành **3 decision table** (đổi giá / leave-cancel / rejoin); Plexco **không giữ tiền** → refund do host thực hiện ngoài + log; reversal chỉ sửa ledger.
> - **F-05:** tách **pricing fallback** (thiếu/khác/không tiết lộ → giá base; chỉ KMS/decrypt-fail mới fail-closed) khỏi **eligibility gating** (DD-41 chỉ khi `gender_restriction != none`).
> - **F-06:** guest→full + ban ghi rõ actor/coexistence/hiệu lực trên active+waitlisted.
> - **F-07:** LLM interface = **spec/pinned, CHƯA implement**; chấm `ChatProvider`/`EmbeddingProvider` **độc lập** (cho mixed-vendor).
> - **F-08:** thêm Item 8 (DD-34/35/36) dạng deferred + promotion gate.
> - **Re-check money:** charge state chỉ `open|partial|paid|void`; `waiver|reversal` là allocation source. Table C chỉ mở **undo mistaken leave** có snapshot; genuine rejoin vẫn fail-closed.
> - **Re-check ban:** manual ban không tự evict roster/queue; waitlisted bị skip nhưng giữ queue đúng DD-45; removal là command riêng qua money policy.
> - **Re-check governance:** plan key logical = `free` (live legacy `free_web` chờ migration); tách “ready for founder review” khỏi “post-decision closure”.
>
> **Rev 5 — DD-04 chốt (2026-07-16):** Item 1 = ✅ **CHỐT (c) co-locate DigitalOcean**; options a/b/c → historical (bỏ CTA chọn (a)); sửa claim "(c) đổi DD-10" (thực tế KHÔNG đảo DD-10). Còn egress-IP gate + build-time gates.
> **Rev 4 — operational closure (2026-07-15):** DD-04 reopen/governance wording đóng nhất quán; thêm Item 9 cho identity/account recovery + merge-split authority; phân loại toàn bộ OQ còn mở thành founder, delegated build-time hoặc external verification với default fail-closed.

---

## Bảng tổng hợp

| # | Item | DD/OQ | Độ gấp | Ai quyết |
|---|---|---|---|---|
| 1 | Hosting provider + network posture | DD-04 | ✅ **CHỐT (c) DO co-locate** (2026-07-16); còn egress-IP gate | Founder |
| 2 | Billing lifecycle Host Pro (trial/grace/refund/override) | BIL-OQ-2 · DD-29 | 🟠 trước khi bật thu Host Pro (P5) | Founder |
| 3 | Money correction lifecycle (đổi giá / leave-cancel / rejoin) | SES-OQ-1 · PAY-OQ-3 | 🟠 P2/P3 — chặn correction flow DD-45 | Founder + product |
| 4 | Guest→full membership + club ban policy | CCJ-OQ-2 | 🟡 P4.3 | Founder + product |
| 5 | Gender pricing fallback (tách khỏi eligibility) | USR-OQ-1 · DD-39 | 🟡 P2/P4 | Founder + product |
| 6 | PII retention/erasure + nghĩa vụ pháp lý VN | USR-OQ-3 · SEC-OQ-2 | 🔴 trước go-live thu PII | Founder + **legal** |
| 7 | LLM provider trợ lý (chat + embedding tách) | DD-18 | 🟢 P7 (chặn go-live, không chặn build) | Founder + legal |
| 8 | Global KB plane (approve-in-principle) | DD-34/35/36 | 🟢 P7 — deferred | Founder (khi build P7) |
| 9 | Identity/account recovery + merge-split authority | ID-OQ-2 · ID-MERGE-1 · RTE-OQ-2 | 🔴 trước production identity merge/recovery | Founder + security |

---

## 1. ✅ Hosting provider + network posture — DD-04 (P0) — CHỐT (c) DO co-locate

> ✅ **ĐÃ CHỐT (2026-07-16):** QĐ-1 = **(c) co-locate DigitalOcean** (compute DO App Platform + DB DO Managed PG HA-standby, **VPC private**, Singapore). Supersede đề xuất (a) trong brief. **Pre-build gate:** verify SePay/ApiPay/Zalo/Messenger fixed-outbound-IP (DO App Platform không đồng thời VPC + dedicated egress) → fail thì fallback (a) Fly+DO. Cost planning (record Rev 2) = **Day-1 baseline money-safe `$120–135`** (non-negotiables + read-isolation controls; read replica/WAF Pro/Sentry Team = trigger-based, không mặc định Day-1); prod+ephemeral staging `$128–153`. Record: `dd-04-hosting-final-decision.md` · `decisions.md` DD-04 v1.34.

**Câu hỏi (đã trả lời):** (1) posture = **(c) private VPC (co-locate DO)**; (2) provider = **DigitalOcean**.

> *(§ dưới là **options đã xét** — lịch sử phân tích; kết quả đã chốt **(c)** ở box đầu Item. KHÔNG còn CTA chọn.)*

**QĐ-1 — Posture:**
- (a) public-TLS + `verify-full` + static-IP allowlist, giữ Fly.io — **fallback** nếu egress-IP gate fail.
- (b) strict-private qua PrivateLink (AWS + Neon) — đắt/phức tạp, rời Fly. *(loại)*
- **(c) co-locate compute DO + DO Managed PG cùng VPC — ✅ CHỌN.** Private thật; **đổi deployment target Fly→DO nhưng KHÔNG đảo DD-10** (App Platform chạy standalone container, khớp DD-10).

**QĐ-2 — Provider:**
- **DigitalOcean Managed với ≥1 standby node — ✅ CHỌN** — auto-failover + 99.95% SLA; cluster không standby chỉ 99.5% SLA. Bill phẳng/dự đoán được, vận hành đơn giản.
- Neon Scale — storage multi-AZ by default; **99.95% SLA chỉ áp dụng cho Compute Endpoints**; PrivateLink AWS-only → vô dụng với Fly. *(loại)*
- Supabase: Team từ `$599` có AWS PrivateLink nhưng **vẫn không có uptime SLA**; SLA chỉ ở Enterprise custom, còn auto-failover cần contract confirmation. Không cost-comparable. *(loại)*

**Kết quả (2026-07-16): chốt (c) co-locate DigitalOcean.** Đề xuất (a) ban đầu đã **superseded** (xem box ✅ đầu Item + `dd-04-hosting-final-decision.md`). Pre-build gate = **egress-IP verify**.
**Tác động/gấp:** P0 hạ tầng, cần trước production. ⚠️ Mọi con số phải **benchmark trước khi cam kết**.
**Kéo theo SEC-OQ-1** (`feature_security_operations`): **RPO/RTO cuối + KMS implementation** chốt theo provider đã chọn — deliverable **derived/build-time**, không phải quyết định founder độc lập.
**Pointer:** `dd-04-hosting-decision-brief.md` (rev 5) · `decisions.md` DD-04 · `deployment-infra.md §2/§6/§9` · [DigitalOcean Managed Databases SLA](https://www.digitalocean.com/sla/databases) · [Neon pricing/HA scope](https://neon.com/pricing) · [Neon Compute Endpoint SLA](https://neon.com/sla) · [Neon Private Networking scope](https://neon.com/docs/security/security-overview).

---

## 2. 🟠 Billing lifecycle Host Pro — BIL-OQ-2 (P5)

> Đã chốt: logical plan **`free`** (0đ) vào thẳng `active` **vô thời hạn**, không trial/invoice/past_due/suspended vì non-payment (BL-BIL-1). Live schema vẫn dùng legacy key `free_web` cho tới khi migration DD-29 đổi CHECK sang `('free','host_pro')`; **không** dùng `free_web` làm product/canonical vocabulary. Item này chỉ cho **Host Pro 250k**.

**Câu hỏi:** trial · grace · refund/cancel · **manual-override (actor + expiry)**.

| Trục | Options | Đề xuất |
|---|---|---|
| Trial | 0 / 7 / 14 / 30 ngày | **14 ngày** |
| Grace (past_due→suspended) | 3 / 7 / 14 ngày | **7 ngày** |
| Cancel giữa kỳ | giữ `active` tới hết kỳ (no cash refund) / prorated / credit kỳ sau | **giữ tới hết kỳ, no cash refund** |
| Overpay/partial | (đã chốt) billing review queue — KHÔNG `billing_credits` | giữ nguyên |

**Manual-override — đề xuất chốt (sửa F-03):**
- **Actor = `PlatformAdmin` bắt buộc** (endpoint `/internal/billing/override`; DB path platform-admin-only, migration `0007_billing.sql`). **KHÔNG** cấp cho tenant owner/admin.
- **Max-duration = 7 ngày lịch**; không gia hạn ngầm. Cần tiếp tục thì tạo override mới, reason/ticket mới và audit mới.
- **Mandatory:** reason + ticket/reference · `expires_at` · audit actor/time/before-after · auto-expire. Không đủ bất kỳ field nào → fail-closed, không activate override.
- **Escalation SLA đề xuất = 1 ngày làm việc**; emergency break-glass vẫn phải có ticket và expiry, không bỏ audit.
- **Schema consequence:** live `billing_overrides` mới có `actor_id`, `reason`, `expires_at`; nếu chốt ticket/reference là queryable audit field thì implementation migration phải thêm `ticket_ref` riêng, không giấu trong free-text `reason`.

**Tác động/gấp:** trước khi bật thu Host Pro.
**Pointer:** `feature_billing_lifecycle.md:71` · `BE/feature_billing_lifecycle_tech.md:138/158/248` · `migrations/0007_billing.sql` · DD-29.

---

## 3. 🟠 Money correction lifecycle — SES-OQ-1 + PAY-OQ-3 (P2/P3)

> **Nguyên tắc nền (PRD:262):** Plexco **KHÔNG giữ tiền** — hoàn tiền do **host thực hiện ngoài** rồi **log**. **Signed reversal chỉ sửa allocation trong immutable ledger** (BL-PAY-8), **không** tự chuyển cash và **không** tự quyết số phận player/charge.
>
> **Canonical vocabulary:** `charges.status ∈ {open, partial, paid, void}`. `waiver` và `reversal` là `payment_allocations.source`, **KHÔNG phải charge state**. Trạng thái tiền đọc từ charge + tổng allocation hiệu lực; không re-derive bằng nhãn tự đặt.

### Table A — Host đổi giá kèo (SES-OQ-1)

| Trạng thái hiện tại | Đề xuất phase-1 | Invariant |
|---|---|---|
| Player `waitlisted`, chưa có charge | Giá mới chỉ áp khi lần đầu promote→`active` và tạo charge | Waitlisted không có charge |
| Charge `open`, effective allocation = 0 | **Grandfather `amount_due` cũ** | Không mutate charge đã phát hành |
| Charge `partial` hoặc `paid` | **Grandfather**; không sửa `amount_due`, không tự tạo “adjustment” ngoài schema | Không rewrite ledger/amount quá khứ |
| Charge `void` | Terminal; không reopen/reprice | Muốn vòng đời mới cần model riêng |
| Có allocation `waiver`/`reversal` | Đọc effective allocations để suy `open`, `partial` hoặc `paid`; không coi allocation source là state | Một vocabulary canonical |

**Đề xuất chốt A:** giá mới chỉ áp cho charge tạo **sau** thời điểm đổi giá. Mọi charge đã tồn tại grandfather; phase-1 không thu/bù chênh lệch tự động.

### Table B — Player leave / host cancel (PAY-OQ-3)

**Đề xuất chốt B1:** session bị host cancel → hoàn toàn bộ khoản cash/bank đã thu. Player tự leave → phase-1 do host quyết `refund|no_refund` với reason; Plexco không auto-refund và không đoán policy.

| Charge/effective-ledger trước correction | Cash disposition | Ledger + charge disposition |
|---|---|---|
| Waitlisted, chưa có charge | Không | Player→`left`, clear position; không tạo/reverse charge |
| `open`, effective allocation = 0 | Không | Giữ row audit, set charge→`void` |
| `partial`/`paid`, quyết định `no_refund` | Không chuyển cash | Giữ allocation + charge hiện tại; player→`left`; audit reason |
| `partial`/`paid`, có allocation `auto`, `manual` hoặc `cash` và refund được duyệt | **Host hoàn ngoài trước**, ghi opaque refund reference; không chứng minh đã hoàn → fail-closed | Command idempotent + DD-25 preview/confirm; reverse đúng phần allocation hiệu lực rồi set charge→`void`; không over-reverse |
| `partial`/`paid`, chỉ có allocation `waiver` | Không có cash để hoàn | Giữ waiver làm lịch sử, set charge→`void`, audit |
| `void` | Không | Idempotent no-op; không tạo reversal mới |

**Atomicity/audit:** correction dùng `commandId`; reuse canonical ledger lock order (**bank transaction khi có → charge → allocations**) và không tự phát minh lock order song song; audit input player/session, before/after, cash disposition, refund reference, actor và reason. External refund thành công nhưng DB retry phải resume idempotently từ refund reference, không hoàn lần hai.

**Implementation gate:** live ledger chưa có dedicated external-refund proof/correction record. Build slice phải pin nơi lưu **opaque** `refund_reference`, command idempotency và before/after audit; không nhét proof vào `payment_allocations.source`, không coi `reason_code` tự do là bằng chứng hoàn tiền, và không log/store raw bank content hoặc receipt PII trong audit.

### Table C — `left` correction versus genuine rejoin

> **Không gọi mọi trường hợp `left→active|waitlisted` là “rejoin”.** Phase-1 chỉ cho phép **undo một mistaken leave** bằng command riêng; genuine rejoin vẫn fail-closed cho tới khi có model participation lifecycle giữ được nhiều lần tham gia mà không overwrite player/charge history.

| Case | Điều kiện bắt buộc | Outcome đề xuất |
|---|---|---|
| Undo mistaken leave từ `active` | Có `leave_event_id` + before-snapshot; không có money mutation sau leave; session chưa cancel; capacity còn; eligibility/ban re-check pass | DD-25 preview→host confirm; restore `active`; **không** sửa/reopen/duplicate charge; audit before/after |
| Undo mistaken leave từ `waitlisted` | Có snapshot vị trí; chưa có charge; không có queue/context mutation làm snapshot stale; eligibility/ban pass | Restore đúng snapshot; snapshot không chứng minh còn hợp lệ → fail-closed, không đoán vị trí |
| Charge đã `void`, có reversal/refund, hoặc có mutation sau leave | Không thể chứng minh snapshot nguyên vẹn | Giữ `REJOIN_REQUIRES_REVIEW`; không mutation |
| Genuine rejoin sau một lần tham gia/leave thật | Bất kỳ charge/allocation state | **Phase-1 reject `REJOIN_REQUIRES_REVIEW`**. Future slice phải model participation cycle mới; không reuse/overwrite ledger cũ |

**Đề xuất chốt C:** mở duy nhất `undoMistakenLeave` có snapshot + consume-once + revalidation; **không** mở automatic/genuine rejoin trong phase-1.

**Build gate:** canonical hiện chưa pin `leave_event_id` + before-snapshot đủ cho undo. Trước khi dedicated correction-core slice land contract/audit/test, mọi `left` vẫn trả `REJOIN_REQUIRES_REVIEW`; brief này **không** tự làm flow đó thành implemented.

**Pointer:** `feature_session_management` SES-OQ-1 · `feature_payment_reconcile` PAY-OQ-3 · `schema.ts:382-445` · `PRD.md:262` · `decisions.md:507` · DD-45/25/40.

---

## 4. 🟡 Guest→full membership + club ban — CCJ-OQ-2 (P4.3)

**Câu hỏi:** (a) guest→**full member** đường nào (và có cho player **tự request** song song host-invite không?); (b) **club ban** đầy đủ (không chỉ reliability-ban của DD-42).

**Guest→full (options không loại trừ nhau — F-06):** host invite/approve · player-request + host-approve · auto (join lần N / paid). → **quyết rõ có tồn tại player-initiated request không, và coexist thế nào.**
**Đề xuất:** host invite/approve là đường chính; **cho player gửi request, host duyệt** (coexist); auto-upgrade để slice sau.

**Tách 2 loại ban (không trộn semantics):**

| Loại | Actor/policy | Tác động |
|---|---|---|
| Reliability ban (DD-42) | Policy per-tenant từ attendance; **time-boxed** | Chặn join/promotion; waitlisted **giữ queue và bị skip** đến khi hết hạn |
| Manual safety/discipline ban | **`TenantOwner` only** phase-1; bắt buộc reason + evidence/reference; `expires_at` hoặc permanent; unban cũng `TenantOwner` | Chặn future join/promotion; **không tự evict** active/waitlisted |

**Đề xuất chốt (F-06):** host invite và player-request+host-approve coexist. Manual ban do `TenantOwner`; audit actor/time/reason/evidence/before-after bắt buộc. Player đang `waitlisted` **giữ queue + skip** đúng DD-45. Player đang `active` **không bị gỡ tự động**; nếu owner muốn remove thì chạy command remove/leave riêng qua Item 3, có preview money + confirm + notification. Cách này tránh ban tự kích hoạt mutation roster/ledger ngoài ý muốn.
**Schema consequence:** manual safety ban cần contract/storage riêng hoặc discriminator rõ; không overload DD-42 reliability-ban rồi để hai loại ban chia sẻ sai expiry/actor semantics.
**Pointer:** `feature_cross_club_join` CCJ-OQ-2 · `dd-42-reliability-analysis.md` (chỉ reliability-ban).

---

## 5. 🟡 Gender pricing fallback — USR-OQ-1 (P2/P4)

> **Sửa F-05 — hai contract RIÊNG, không trộn:**

**(a) Pricing (DD-39) — thiếu gender là trạng thái HỢP LỆ:**
- `gender` = `other` / `undisclosed` / **thật sự chưa set (NULL)** → **giá base/`price_amount` fallback theo cấu hình CLB**. KHÔNG block, KHÔNG đoán giới tính.
- **Chỉ fail-closed** khi **KMS/decrypt hoặc price-derivation lỗi** (có `gender_enc` nhưng giải mã fail) → không tạo charge sai, retry/queue.

**(b) Eligibility (DD-41) — độc lập với pricing:**
- Áp decision table DD-41 **chỉ khi `gender_restriction != none`**. Kèo **giá-theo-giới-tính** *bản thân nó* **KHÔNG** làm player ineligible.

**Câu hỏi còn cần founder:** tập giá trị gender công khai cho user chọn — đề xuất **nam / nữ / khác / không tiết lộ** (PII enc + consent, không lộ public).
**Pointer:** `decisions.md:440-445` (DD-39) · `BE/feature_user_settings_tech.md:31/67-81/141` · `dd-41-session-fields-gating-analysis.md` · `feature_user_settings.md` edge#5.

---

## 6. 🔴 PII retention/erasure + nghĩa vụ pháp lý VN — USR-OQ-3 + SEC-OQ-2

> **Sửa F-01 + F-02.**

**Legal baseline (F-01 — cập nhật):** khung hiện hành = **Luật Bảo vệ dữ liệu cá nhân 91/2025/QH15** (hiệu lực 01/01/2026) + **Nghị định 356/2025/NĐ-CP** (31/12/2025, hiệu lực 01/01/2026). **Nghị định 13/2023 đã HẾT hiệu lực.** Theo hiểu biết hiện tại (**chưa phải kết luận pháp lý — luật sư VN phải xác nhận**), NĐ 356 dường như xếp `gender`/`dob` vào **dữ liệu cá nhân cơ bản** chứ không phải nhóm nhạy cảm; cách xử lý/consent phụ thuộc phân loại này nên **không dựa vào** trước khi có xác nhận. Plexco vẫn mã hoá + consent theo policy DD-39/DD-41. ⚠️ **Bắt buộc luật sư VN** map article-level cho: retention/erasure matrix, legal basis/consent theo từng data class, dữ liệu nào thực sự nhạy cảm, **chuyển dữ liệu xuyên biên giới** (hồ sơ/đăng ký), và thời hạn **thông báo vi phạm** áp dụng. **KHÔNG** biến "deadline PDPD chung chung" thành yêu cầu engineering khi chưa có mapping điều luật.

**Erasure model (F-02 — thay hard-delete):** canonical = **anonymize giữ financial audit** (`feature_user_settings.md:70`) — persons.id được FK bởi nhiều bảng, **không hard-delete whole person**. Thay bằng **retention/erasure matrix per-data-class:**
- xoá/anonymize PII đủ điều kiện (gender/dob/phone/email/name) **nhưng giữ opaque person anchor + immutable ledger/audit** nơi luật yêu cầu.
- định nghĩa riêng: **grace period · legal hold · backups · derived data · deletion-verification**.

**Tác động/gấp:** 🔴 compliance **trước go-live thu PII** (gender pricing + hồ sơ). Legal có lead-time dài → khởi động sớm.
**Pointer:** `feature_user_settings.md:70/127` · `feature_security_operations` SEC-OQ-2 · Luật 91/2025 + NĐ 356/2025.

---

## 7. 🟢 LLM provider trợ lý — DD-18 (P7)

> **Sửa F-07.**

**Trạng thái đúng:** interface `EmbeddingProvider`/`ChatProvider` mới **được spec/pinned trong BE tech doc, CHƯA implement** trong `packages/`/`apps/`. Build interface + adapter **trước**, chốt provider **trước go-live** (chặn go-live, không chặn build).

**Câu hỏi:** chọn provider — **chấm `ChatProvider` và `EmbeddingProvider` ĐỘC LẬP** (cho phép **mixed-vendor**; region/retention/reindex khác nhau).
**Gate mỗi provider:** DPA · retention setting · subprocessors · data location (hợp Luật 91/2025) · cross-border assessment · model-change/reindex implication · exit strategy. Giữ **grounding KB-only** (DD-21 — không đẩy ledger/PII vào LLM).
**Đề xuất:** post-MVP (P7), quyết khi tới; ưu tiên provider có DPA + data-region phù hợp.
**Pointer:** `decisions.md` DD-18 (:235-239) · `BE/feature_club_assistant_tech.md:341-342` · `dd-18-llm-provider-analysis.md`.

---

## 8. 🟢 Global KB plane — DD-34/35/36 (P7, deferred)

> **Thêm theo F-08.** Ba DD này ở trạng thái **🟡 Approve-in-principle** (chưa chốt đầy đủ) — approve-in-principle **là đủ cho hiện tại**, không cần founder quyết ngay.
> **Promotion gate:** chi tiết + patch DD-21 (allowed KB sources) **khi mở build slice Global KB ở P7**; kèm guard platform-KB (allowlist + admin review + scanner PII).
> **Owner/trigger:** khi Club Assistant (P7) vào build → nâng DD-34/35/36 từ approve-in-principle → ✅ với contract đầy đủ.
> **Pointer:** `decisions.md:49-51` + `:378-397` · `proposals/plexco-global-kb-and-kb-autosync.md`.

---

## 9. 🔴 Identity/account recovery + merge-split authority — ID-OQ-2 / ID-MERGE-1 / RTE-OQ-2

> Identity recovery là đường **global-protected + money-adjacent**: một split/relink sai có thể gắn channel, membership, charge hoặc lịch sử thanh toán cho nhầm người. Không delegate policy này cho build slice và không mở recovery bằng tên/display ID/raw social ID.

**Câu hỏi founder cần chốt:**

1. Ai được **freeze** một identity nghi merge sai, ai được **approve/apply** split plan?
2. Có bắt buộc hai người duyệt không; solo-founder dùng break-glass thế nào?
3. SLA chuẩn/khẩn cấp và evidence tối thiểu cho account recovery khi mất Google/Facebook/Zalo là gì?

**Đề xuất fail-closed:**

- Một `PlatformAdmin` được **freeze ngay**; chỉ `PlatformAdmin` được tạo plan. Tenant owner/admin không có quyền global split/relink.
- Apply split cần **hai approval độc lập**. Khi chưa có người duyệt thứ hai, giữ frozen và phục vụ correction thủ công; break-glass một người chỉ cho tình huống khẩn cấp, bắt buộc ticket/reason, expiry, immutable before/after audit và review hậu kiểm.
- Recovery account cần strong proof từ verified account/email/phone hoặc recovery artifact đã cấp trước. Không đủ strong proof → không relink; chuyển manual review.
- Split plan phải map rõ channel identities, memberships, players và charges; **không rewrite bank transactions/payment allocations**. Apply idempotent, re-run tenant/ledger invariants rồi mới unfreeze.
- SLA đề xuất: freeze ≤4 giờ khi nghi sai tiền/identity; plan chuẩn ≤1 ngày làm việc. SLA không được biến thành quyền bypass evidence.

**Pointer:** `features/feature_identity.md` ID-OQ-2 · `00-start-here/identity-model.md` ID-MERGE-1 · `features/BE/feature_identity_tech.md §7–§8` · `features/feature_tenant_routing_authz.md` RTE-OQ-2.

---

## Delegated / build-time decisions (KHÔNG cần founder duyệt riêng)

> Brief này one-stop cho việc **phân loại** mọi OQ còn mở. Chỉ delegate khi founder-level policy và fail-closed invariant đã pin; build slice được chọn UX/schema/transport nhưng **không** được tự đổi money/identity/PII/legal policy. OQ nào còn thiếu policy nhạy cảm phải nâng thành founder item trước khi code.
> - **Đổi giá khi đã có charge** → **KHÔNG delegate**, đã nằm trong **Item 3** (money policy).
> - **Recurrence editing** (sửa 1 occurrence vs this-and-future) — `feature_session_management` SES-OQ-2.
> - **Reminder policy** (threshold/max/copy; DM có kèm số tiền không) — `feature_notifications_reminders` NTF-OQ-1/2.
> - **DM / moderation / media policy** in-app chat (ai được DM, quyền host xoá/ẩn/ban, media phase-1) — `feature_inapp_chat` CHT-OQ-1/2/3.
> - **Co-admin permission granularity** — `feature_tenant_routing_authz` RTE-OQ-1.
> - **Suspended tenant có tiếp tục auto-reconcile không (PAY-OQ-2)** — ingest **luôn bật** (an toàn); auto-settle/auto-notify cho tenant `suspended` **default fail-closed (OFF)** tới khi chốt lifecycle (gắn **Item 2** billing, trước P5). Bật lại = billing/founder policy, không phải mặc định build.
> - Marketplace ranking (MKT-OQ-3), min onboarding steps (WAO-OQ-2), persistent menu/quick replies (PMS-OQ-1) — product/eng default.
> - Event retention/replay + DLQ UX (SYN-OQ-2) — eng/SRE chốt trước sync-engine rollout; retention không được xoá undelivered money/identity events.
> - Phone verification UX/provider (ID-OQ-1) — ưu tiên provider-verified share-contact; SMS chỉ bật sau security/DPA review. Guest/full permission (ID-OQ-3) đã nằm trong Item 4.
> - **Gender price-storage schema (USR-OQ-2)** — eng được chọn cột hay bảng vì pricing policy đã pin ở Item 5, nhưng phải có **một canonical price lookup/helper**, migration + money-invariant tests; không được tạo công thức thứ hai ở consumer.
> - **DD-47/48 build-time OQ (USR-OQ-4…9)** — default fail-closed tới khi slice pin: không cross-tenant stats; private counts/lists hidden; không mở DM/profile visibility mới; không ship block/roster-name expansion; notify follow-request dùng một person-directed core, không clone tenant outbox semantics.
> - **External/technical gates, không phải founder policy:** DD-14/15 Zalo spike; DD-33/PMS-OQ-2 App Review + degrade verification; connector CO-OQ-1…7 sandbox/provider facts. Gate chưa verify → feature liên quan không GA.
>
> ⚠️ Nếu build khám phá policy mới chạm **tiền/identity/PII/legal** ngoài invariant đã pin → HALT và nâng thành founder item; không tự chọn default fail-open.

---

## Đề xuất thứ tự quyết

1. **DD-04 hosting** (P0) — sớm nhất, trước production.
2. **Item 6 PII/legal** — khởi động luật sư song song (lead-time dài; re-baseline Luật 91/2025 + NĐ 356/2025; chặn go-live thu PII).
3. **Item 3 money lifecycle** (P2/P3) — chốt 3 table → pin price-edit/refund + mở `undoMistakenLeave`; genuine rejoin vẫn deferred fail-closed.
4. **Item 5 gender pricing** (P2/P4) — tách pricing/eligibility → mở DD-39 build.
5. **Item 2 billing** (P5) — gồm override PlatformAdmin — trước khi thu Host Pro.
6. **Item 4 guest→full/ban** (P4.3).
7. **Item 9 identity/account recovery** — chốt trước production merge/recovery.
8. **Item 7 LLM** + **Item 8 Global KB** (P7) — post-MVP.

## Ready for founder/legal review

- Mỗi item có câu hỏi, options/decision table, đề xuất, actor, consequence và canonical pointer.
- Money correction dùng đúng charge/allocation vocabulary và giữ genuine rejoin fail-closed.
- Legal assertions chỉ pin những gì nguồn chính thức xác nhận; retention/deadline/transfer obligations còn lại ghi rõ cần luật sư map article-level.
- Deferred item có owner, trigger và promotion gate.
- Identity/account recovery giữ global split/relink fail-closed và không delegate authority policy cho build slice.

> **Trạng thái rev 4:** ready để founder + legal **ra quyết định**; chưa phải canonical decision và chưa authorise implementation.

## Post-decision closure checklist

1. Founder/legal chốt item và exact option/policy.
2. Ghi `docs/standards/decisions.md` hoặc OQ canonical **trước**.
3. Propagate cùng actor/state/fail-closed rule sang feature + BE tech specs, migrations/test plan liên quan.
4. Re-check target diff đúng docs-only scope; commit từ clean declared scope.

*Brief này chỉ là bàn quyết, không phải authority. Không propagate một đề xuất chưa được founder/legal chốt như thể đã thành canonical.*

**Nguồn pháp lý chính thức:** [Luật 91/2025/QH15 — CSDL quốc gia VBPL](https://vbpl.moj.gov.vn/bocongan/Pages/vbpq-thuoctinh.aspx?ItemID=179252&Keyword=) · [Nghị định 356/2025/NĐ-CP — CSDL quốc gia VBPL](https://vbpl.vn/TW/Pages/vbpq-toanvan.aspx?ItemID=187276)
