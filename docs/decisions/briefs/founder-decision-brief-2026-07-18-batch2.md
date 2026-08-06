# 📋 Founder Decision Brief — Batch 2 (2026-07-18)

> **Mục đích:** 4 quyết định trong batch này đang chặn, đưa về trạng thái quyết-định-được trong một lượt.
> **Authority:** `standards/decisions.md` v1.73; notification contract closure v1.71; cặp Product/BE hiện v3.4g Draft. Brief này là decision form cho B0 + DD-70..72, không tự chốt hay chứng minh runtime.
> **Cách dùng:** mỗi mục tick một ô; `✏️ Sửa` thì ghi ở dòng "Ghi chú".

---

## ⏱️ Chạy song song ngay (không phải quyết định — chỉ cần kick off)

Ba lane đều có external lead-time; để muộn sẽ chặn go-live/feature flag dù không chặn mọi build nội bộ. **“Kick off” chỉ được tính là xong khi có owner + due date + evidence path** — không để ở trạng thái nhắc việc chung chung.

| Lane | Evidence tối thiểu | Owner | Due date |
|---|---|---|---|
| **A3 legal PII** | Counsel memo cho email/tên/bank memo theo **Luật 91/2025/QH15 + NĐ 356/2025/NĐ-CP** (đều hiệu lực 01-01-2026); data-class/retention/DPA actions | ☐ Gán: … | ☐ `YYYY-MM-DD` |
| **C4 Meta App Review** | Exact permissions/artifacts/submission status cho Messenger và Facebook Login, fallback `link_code` | ☐ Gán: … | ☐ `YYYY-MM-DD` |
| **C7 email provider** | Upstream idempotency proof + DPA/data-region/subprocessors + SPF/DKIM/DMARC/bounce/complaint evidence | ☐ Gán: … | ☐ `YYYY-MM-DD` |

**Evidence path:** A3 `docs/evidence/legal/…` · C4 `docs/evidence/meta/…` · C7 `docs/evidence/email-provider/…` (tạo khi kickoff; không ghi secret/raw PII).

**Nguồn pháp lý chính thức để counsel đối chiếu:** [Luật 91/2025/QH15](https://chinhphu.vn/?docid=214590&pageid=27160) · [Nghị định 356/2025/NĐ-CP](https://vanban.chinhphu.vn/default.aspx?docid=216387&pageid=27160). Link chỉ hỗ trợ kickoff; counsel memo vẫn là evidence đóng A3.

---

## B1 · Duyệt B0 auth design-probe — **ưu tiên cao nhất**

**Vì sao gấp:** B0 là design gate để author bộ slice thay provider auth S4; canonical delivery order đặt auth trước các feature layer phụ thuộc. Probe đã đóng các design hole đã biết — gồm cả callback/link đi qua cross-site browser — và còn chữ ký owner. **Duyệt B0 chỉ đóng design gate — không phải runtime/code-ready:** C7 vẫn chặn email feature flag; ingress drill vẫn phải pass; Google/email-specific tables, adapters, routes, delivery job và E2E tương ứng chưa tồn tại (repo chỉ có baseline Telegram-era).

**Đang chờ duyệt (6 mục, `b0-auth-credential-lifecycle-design-probe.md`):**

| Mục | Nội dung cần gật |
|---|---|
| §3 | Email là **contact provider-neutral** (`account_emails`), Google + email/password dùng chung; credential chỉ giữ password hash |
| §3.2 | **Multi-attempt verify-first**: mỗi lần đăng ký là một attempt độc lập; attempt có valid token gửi tới inbox + matching browser registration key thắng — cross-site GET chỉ landing, explicit same-origin POST mới consume; không last-writer-wins, không khoá đăng ký của chủ email thật |
| §4 | Bảng va chạm Google ↔ email (đặc biệt: Google subject đã thuộc A + email thuộc B ⇒ `AUTH_IDENTITY_CONFLICT`, **không auto-merge**) |
| §5 | TTL/retention + delivery: verify 30 phút · reset 15 phút · pending 24 giờ · payload `min(24h, token expiry)` · terminal metadata 30 ngày · audit 180 ngày; pg-boss retry/DLQ, C7 không chứng minh upstream idempotency ⇒ email flag OFF |
| §8 | Password: 15–128 code points, **Argon2id m=19456 KiB t=2 p=1**, không composition/rotation định kỳ. Initial rate-limit: OAuth state issue **10/min shared trusted-IP trước row/cookie** + callback bucket riêng 10/min; email login **10/min trusted-IP + 5/15min email-hash**; register/forgot **5/15min từng bucket trusted-IP + email-hash**; verify/reset **trusted-IP trước**, rồi active-token→target-email bucket hoặc invalid-artifact HMAC bucket, tất cả trước consume. Generic response; bất kỳ bucket/storage fail ⇒ fail closed |
| §10 | Thứ tự slice: **D0 revoke-core → D1 account-email-token-core → D1 Google adapter → D1 email bundle (một release unit) → gỡ Telegram** |

**Khuyến nghị:** ✅ duyệt cả 6. Đây là các contract/lựa chọn đã ground vào live schema. Boundary kỹ thuật đã pin sẵn, không cần founder chọn thêm: OAuth callback dùng one-time transaction + Lax browser-binding cookie riêng; state issue bị chặn trước khi tạo row/cookie; **Google** PKCE ciphertext theo canonical `bytea` (Facebook giữ state/binding + exact-App proof tới khi provider contract pin thêm); email verify/reset dùng non-mutating landing → same-origin POST và rate-limit trước consume; session cookie vẫn Strict. Argon2 setting là **initial floor** và rate-limit là **initial configurable security default**; cả hai phải được benchmark/đo trên production-class traffic, không coi con số founder tick là ceiling vĩnh viễn.

**Duyệt:** ☐ ✅ Duyệt cả 6 ☐ ✏️ Duyệt trừ một số mục (ghi rõ) ☐ ❌ Cần bàn thêm

**Ghi chú:** …

---

## B2 · DD-72 — `device_push_subscriptions` + push provider

**Vì sao gấp:** thuộc slice **S9/S20 (PWA)**. Chốt muộn ⇒ telemetry không cài từ đầu ⇒ **mất baseline cho DD-69 gate #4** (đo độ tin cậy push PWA/iOS) ⇒ quyết định lên native sau này quay về cảm tính.

**(a) Schema phase-1** — chỉ chốt **Web Push**, không pre-design native: GLOBAL PROTECTED theo `person_id` (không `tenant_id`); `kind='web'`; endpoint/keys mã hoá KMS + versioned HMAC lookup; coarse UA enum; `active|stale|revoked`; `trusted_at/trust_source/trust_epoch` server-owned. Client bắt buộc gửi actor-scoped UUID `Idempotency-Key`; trusted boundary mint signed short-lived envelope bind actor + external command + canonical fingerprint + aliases/digests/key versions + JTI. **Chỉ một external command mới được accept** mới increment epoch/reset trust đúng một lần; fresh/replayed envelope JTI của command đã accept chỉ trả durable historical receipt, không reset lại. Absent-row command/JTI/alias races phải serialize trước lookup; hash thuộc Person khác ghi opaque conflict receipt nhưng zero subscription/ownership/trust mutation. Cross-Person rebind là challenge/proof riêng: proof bind `action='rebind'`, current/prior owner, new actor, exact old subscription + alias digest, ownership/trust epoch, external command, expiry và one-time JTI; phase-1 chỉ nhận **`verified_prior_owner_reauth`** từ canonical auth hoặc **`manual_recovery`** đã audit theo DD-53. Không dùng `identity_merge` làm rebind proof: Person merge là lifecycle riêng, tự re-parent/reset subscription và invalidate challenge chưa consume. Rebind không `UPDATE person_id`; nó atomically delete old secret row + insert **new subscription UUID**, clear old live pointers nhưng giữ immutable historical refs, rồi ghi receipt/challenge consumed. Bất kỳ live attempt/report capability nào cũng block transfer; không có "giới hạn số lần rebind" tùy ý ngoài proof, rate-limit và audit.

Nâng trust chỉ qua verified-email re-auth, approval từ **thiết bị active đã trusted khác target**, hoặc audited manual recovery. Proof bind actor+target+source/evidence+expiry+exact current epoch. Exact consumed-proof replay trả historical event trước current-epoch check và **không restore trust**; proof mới stale epoch fail closed. Same-Person composite FKs bind live pointers; merge reset mọi subscription được re-parent, không re-point historical refs, và halt command-receipt collision. Mọi lifecycle timestamp do DB lấy từ cùng `transaction_timestamp()`; reactivation stale/revoked phải clear lifecycle/failure state và reset trust. Active Web device cap mặc định 10, hard max 20 dưới actor lock; register/rebind vượt cap reject trước consume, merge vượt cap HALT/manual — không auto-evict trusted device. Stale/revoked secret row chỉ prune khi `GREATEST(created_at, stale_at, revoked_at, last_success_at)` theo null-safe formula đã pin **ít nhất 180 ngày** và không còn live capability; receipts/events tồn tại lâu hơn để replay/audit. Advisory idempotency mapping dùng permanent/version-pinned key+algorithm; rotation dual-lock old+new tới khi old worker drain. Native provider/protocol/app identity/environment/row shape chỉ chốt sau DD-69 phase-2 spike.

**(b) Provider** — đây là chỗ cần bạn chọn:

| Phương án | Được | Mất |
|---|---|---|
| **Direct standards-based Web Push + VAPID** *(khuyến nghị phase-1)* | Không thêm app-level vendor platform/SDK; ít coupling/pháp lý hơn; payload end-to-end encrypted; chi phí dịch vụ thấp | Tự lo VAPID key rotation, retry/reconciliation, telemetry và endpoint chết. Browser-selected push service **vẫn** ở data flow |
| **App-level vendor notification platform/SDK** (vd OneSignal hoặc Firebase Messaging integration) | Vận hành nhẹ hơn, dashboard/SDK sẵn | Thêm vendor/subprocessor/coupling cần DPA/A3; giá trị chính thuyết phục hơn khi native provider đã chốt ở phase-2 |

> VAPID là cơ chế application-server authentication, không phải một “provider tự host”. Phase-1 đề xuất **direct Web Push dùng VAPID, không thêm app-level vendor platform/SDK**; browser vẫn chọn push service và A3 vẫn phải ghi service đó + encrypted payload/traffic metadata. Xét vendor integration/native provider lại sau DD-69 phase-2 spike.
>
> **Chuẩn kỹ thuật:** [RFC 8030 §5.4](https://www.rfc-editor.org/rfc/rfc8030.html#section-5.4) (Topic/replacement, giới hạn 32 ký tự base64url) · [RFC 8292](https://www.rfc-editor.org/rfc/rfc8292.html) (VAPID application-server identification/authentication).

**Bất biến đi kèm:** OS push copy **generic**, chỉ opaque ref + `i18n_key`, không tiền/PII/tên CLB; `buildPushPayload()` là choke-point duy nhất có CI invariant. Secret resolver chỉ cho dedicated worker consume send-claim TTL ngắn rồi derive person/subscription; generic web `app` không được EXECUTE và không có signature nhận raw `person_id`/endpoint. Topic/tag token = 32 ký tự đầu của base64url HMAC-SHA256 domain-separated trên logical ref (bỏ padding), không dùng raw ref/HMAC hex: RFC 8030 giới hạn Topic ≤32 ký tự base64url và header này không được mã hoá/xác thực. Topic token + key version persist trên logical delivery; mọi derived HMAC persist key version và rotate bằng dual-read/backfill, nên retry giữ stable Topic. Nhiều thiết bị = một logical delivery nhưng có durable physical attempt/telemetry per subscription; one-live-claim fence dùng rotation-stable canonical target binding do server derive, không dùng HMAC có thể đổi khi rotate. Ambiguous-after-write ⇒ `unknown` và **luôn cấm alternate-channel fallback**. Sau bounded reconciliation, tenant delivery `settled|correction` được tối đa 2 same-Web-Push retry với cùng logical ref + Topic/client tag; `security_alert` thuộc global attempt ledger của DD-70 và không được đi nhờ tenant recovery; `announcement|reminder` mặc định manual reconcile để tránh spam trùng. Proven no-send mới retry/fallback theo policy. Server ghi `sent|failed|unknown|expired`; client/SW chỉ append `delivered|opened` qua report-capability write-only hết hạn tại `send_started_at + 24h`; verifier giữ old signing keys ít nhất 24h + clock skew, và exact telemetry/command replay qua rotation phải resolve row/key version cũ thay vì tạo duplicate/conflict. `delivered` chỉ ghi sau khi OS display thành công. Raw-telemetry retention vẫn là enablement gate NTF-OQ-15, không bị con số 24 giờ này tự chốt.

**Duyệt:** ☐ ✅ Web-only schema + **direct Web Push/VAPID** ☐ ✅ Web-only schema + **vendor platform/SDK** (ghi tên) ☐ ✏️ Sửa

**Ghi chú:** …

---

## B3 · DD-70 — Notify person-directed GLOBAL: chọn (a) hay (b)

**Bối cảnh:** DD-47 (follow graph) đã tự ghi ra gap này: thông báo follow-request là **person-directed global**, nhưng `notification_intents`/`outbox_events` đều `tenant_id NOT NULL` (đã verify ở schema) ⇒ không cover được. Cùng gap áp cho **link/merge identity** (DD-50) và **security alert** (đăng nhập mới, đổi email) — đều thuộc `persons`, không thuộc CLB nào.

| | **(a) `person_notifications` global-protected** *(khuyến nghị)* | **(b) Chỉ SSE person-self, không lưu bền** |
|---|---|---|
| Hành vi | Thông báo bền, đọc lại được | **Follow request khi user offline sẽ mất** |
| Chi phí | Migration slice cho item + explicit read state + durable read-all command receipt, narrow SECURITY DEFINER; exact global delivery-attempt owner/lifecycle là build gate riêng | Không thêm durable global-notification table; vẫn cần tenant read state + settings/SSE fallback và chấp nhận mất event offline |
| Hệ quả | Có durable source cho security alert; dispatcher chỉ dùng email/device established trước immutable `trigger_context_started_at` (`factor_at < context_start <= event_at`) | Security alert không có durable source ⇒ gần như chắc chắn phải làm lại sau |

**Khuyến nghị: (a).** Lý do quyết định không phải follow request mà là **security alert**: một app xử lý danh tính cùng dữ liệu nghĩa vụ/đối soát thanh toán cần durable alert source, dù Plexco không custody tiền. Nhưng item bền không tự đủ để cảnh báo nạn nhân không mở app — dispatcher chỉ được chọn email/device đã verified/trusted **trước khi triggering session/recovery context bắt đầu**, không chỉ trước `event_at`; factor do chính compromised session thiết lập rồi mới trigger event luôn bị loại. Chọn (b) là gần như chắc chắn phải quay lại làm (a).

Tick (a) đủ để accept **hướng sản phẩm/authority** của DD-70. Exact owner/table cho global security-alert delivery attempts là engineering build gate phải pin trước migration/runtime enablement; chi tiết đó không bắt founder chọn và không được ép event global vào tenant `notification_deliveries`.

**Integrity floor của (a), không phải lựa chọn phụ:** item global không chứa tiền/PII hay JSON/template params tuỳ ý; phase-1 type chỉ `follow_request|identity_link|identity_merged|security_alert`. `follow_accepted` là **analytics-only**; private→public bulk auto-accept không tạo notification/fan-out và không lock unbounded follower fences. List/mark-all dùng server-owned per-Person sequence/fence và cursor bind actor. Mark-all chỉ discovery read-only ngoài mutation transaction; sau đó bounded `READ COMMITTED` lock Person fence **trước authoritative boundary/snapshot đầu tiên**, rồi lock/re-authorize visibility owners và enumerate từng plane tới commit. Signed complete-plane manifest + DB completion gate làm receipt/boundary/exact visible reads all-or-nothing; hidden/late unread, crash rollback, **không watermark/async pending**. Mọi known producer/fan-out/push/merge dùng bounded read-only inventory → fence-first lock hierarchy → canonical source/audit → same-transaction item; `link_code` consume chỉ tạo merge plan, merge commit mới append `identity_merged`. Tenant `outbox_events(tenant_id NOT NULL)` không phải global fallback; path không reorder được phải **build HALT** tới khi có GLOBAL PROTECTED source-event owner/grants/replay/retention riêng. Same read-all command collision halt thay vì collapse. Global attempt ledger có durable physical-attempt fence. DD-70 chỉ gate **durable activity/kudos notification**; DD-76 feed core và DD-77 kudos core có thể build theo dependency/evidence riêng mà không emit notification.

**Chung cho cả hai:** tenant inbox **không có item store thứ hai** — `notification_intents` là durable item; đọc render qua `tenantRepo` dưới RLS; merge hai plane ở **service layer**, không `UNION` SQL cross-plane.

> ℹ️ **DD-73..78 đã được accept ở authority hiện hành nhưng vẫn build-gated/chưa runtime.** DD-75/76/77 có thể reuse grant/security pattern của DD-70(a), làm giảm marginal cost; tuy nhiên DD-70 không được dùng để block feed/kudos core — chỉ optional durable notifications chờ global path. Chi phí riêng của DD-70 (`person_notifications`, reads/read-all receipt, global attempt lifecycle) vẫn phải tính đủ. Reuse củng cố (a), không giả vờ các slice social đã được schedule hay implemented.

**Duyệt:** ☐ ✅ (a) bảng global-protected ☐ ✅ (b) SSE-only ☐ ✏️ Sửa

**Ghi chú:** …

---

## B4 · DD-71 — Announcement: tier + cơ sở preview/confirm

**Bối cảnh:** DD-43 đã chốt `membership_tags` dùng để **thu hẹp audience** khi announce. Trước DD-71 chưa có owner cho luồng announce tới thành viên; hiện cặp Notification Product/BE v3.4g đã sở hữu contract ở trạng thái **Draft**, nhưng tier/approval vẫn chờ owner chốt DD-71.

**(a) Tier — quyết định monetization, chỉ bạn quyết được:**

| | **Manual cơ bản free + layered quota** *(khuyến nghị)* | **Khoá toàn bộ vào `host_pro`** |
|---|---|---|
| Lý lẽ | DD-40 đã chốt "thủ công = free, tự động = `host_pro`"; giữ kênh liên lạc cơ bản và delivery evidence. `host_pro` vẫn bán scheduling/recurring/template/analytics/quota cao hơn | Thêm một lý do nâng cấp ngắn hạn |
| Rủi ro | Phải enforce tenant + actor command bucket, fan-out recipient budget, quiet-hours và opt-out; confirm check+reserve mọi bucket atomically, idempotently, fail-closed. Cùng `command_id` + cùng canonical fingerprint replay đúng reservation/result; khác fingerprint phải fail `IDEMPOTENCY_KEY_REUSED` trước reservation mới. **10/ngày · 3/giờ/tenant** chỉ là configurable shadow default, không phải founder constant | Host free quay lại copy tay sang group ⇒ mất dấu, targeting, delivery data và lý do dùng Plexco |

**(b) Cơ sở bắt buộc preview + confirm:** ⚠️ **không dùng DD-25** — DD-25 chỉ phủ *money-destination change / ledger mutation*. Cơ sở đúng là **không thể thu hồi**. Preview phải trả opaque short-lived proof bind `tenant + actor + content_hash(body+session_ref+CTA) + audience_criteria_hash + count_by_channel + total_count + channel-schema/routing-policy version + expiry`. Confirm consume-once; canonical announcement/content/audience immutable sau insert, direct app `UPDATE/DELETE` bị revoke + trigger chặn. Fan-out chỉ discovery read-only ngoài mutation transaction; bounded `READ COMMITTED` phải lock đủ creator+recipient Person fences trước authoritative snapshot đầu tiên, rồi lock/re-authorize announcement/audience/tags/memberships/preferences/routes tới commit. Sau đó mới re-hash persisted content+criteria, recompute proof vector/version và atomically insert canonical intents + pinned routes + initial `planned` target attempts. Unfenced recipient, contract drift, total tăng hay bất kỳ channel count nào **tăng** ⇒ rollback/retry hoặc preview lại trước mọi intent. Chỉ vector cùng schema/policy giảm theo từng component — không component nào tăng — do member rời/opt-out mới được phép, và phải report final count. Không snapshot roster trong store trung gian; canonical intents là kết quả dispatch. Retry-failed dùng actor-scoped command key, lock intent, re-check membership/preference/capability và chỉ CAS đúng một terminal-no-send route; nếu còn `pending|sent|unknown` thì no-send.

**Duyệt:** ☐ ✅ Manual cơ bản free + layered configurable quota + proof-bound confirm ☐ ✅ Khoá toàn bộ `host_pro` + vẫn giữ proof-bound confirm ☐ ✏️ Sửa

**Ghi chú:** …

---

## Sau khi bạn tick

Mình sẽ: ghi từng quyết định vào `standards/decisions.md` (B0 thành một DD mới cho auth credential lifecycle; DD-70/71/72 chuyển 🟡→✅, với DD-70 ghi rõ attempt-ledger vẫn là build gate) + changelog, rồi propagate theo Hệ quả của từng DD — notification Product/BE v3.4g, migration ledger B4, và cập nhật B0/B9 ở `pre-code-open-items`. **Chưa author migration/DDL** cho tới khi đúng slice. Tick DD-71 không tự đóng NTF-OQ-10/11; tick DD-72 không tự đóng native provider/schema, operational VAPID lifecycle, raw-telemetry retention hay gate threshold NTF-OQ-14/15.

**Lưu ý gộp việc:** chốt **DD-70 đóng luôn B9** ở `pre-code-open-items` §B (B9 chính là gap mà DD-70 giải) — không cần xử lý hai lần.
