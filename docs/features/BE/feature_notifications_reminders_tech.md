# Feature: Notifications — Reminders · Inbox · Announcements · Web Push — Backend Tech Spec

> **Canonical phase:** P3 / P4 (Inbox + Web Push mechanisms 36–47) / P4.5–P4.7 (channel delivery) / P4+ (global plane · announcements)
> **Version:** 3.11 · 2026-07-28
> **Status:** ✅ **Reviewed contract** — §A giữ nguyên; §B/C/D theo DD-70/71/72 owner-final; §E offline Chat digest theo DD-94 owner-final. DD-88 chỉ còn proposal cho grouping/`message_request`/scoped-bulk rộng hơn. DDL vẫn chưa có trong `packages/db/schema.ts`; từng implementation slice vẫn cần strict `CODE_READY`.
> **Implementation:** Not started · authority: `../../standards/BUILD-STATUS.md` (Doc status ≠ Implementation status)  
> ⚠️ Historical: hạ Reviewed → Draft ngày 2026-07-18 do **gộp tài liệu**, không phải mở lại luật tiền §A. DD-70/71/72 được owner chốt 2026-07-21 nên v3.5 promote lại Reviewed. Nhận định v3.8 rằng digest còn phải trì hoãn đã được DD-94 thay thế; session/activity, `message_request` và scoped/bulk vẫn thuộc proposal DD-88. 🟡 trong body nay chỉ target chưa implement/OQ hoặc physical contract theo slice, không phải các decision còn mở.
> **Product spec:** `../FE/feature_notifications_reminders.md`  
> **References:** `../../standards/business-rules.md` BL-MSG-3/5, **BL-NTF-1..6**, BL-SEC-5 · `../../standards/decisions.md` **DD-37/DD-40/DD-43/DD-45/DD-47/DD-48/DD-49/DD-50/DD-67/DD-69/DD-70..72/DD-91/DD-94 ✅ · DD-88 🟡 proposal** · `../../proposals/in-app-chat-primary-player-surface-plan-2026-07-27.md` §7.2 · `../../proposals/notification-grouping.md` (DD-88 chỉ còn session/activity/`message_request`/scoped-bulk rộng hơn) · `../../standards/core-db-architecture-principles.md` §P6 · `../../decisions/analysis/dd-43-membership-tags-analysis.md` · `../../decisions/analysis/dd-45-waitlist-analysis.md` · `../../decisions/analysis/dd-69-app-native-analysis.md` · `feature_identity_tech.md` · `feature_sync_engine_tech.md` · `feature_multi_tenant_tech.md` · `feature_inapp_chat_tech.md`

> **Cập nhật v2.1 (DD-40 ✅ + DD-37 ✅, 2026-07-10):** kênh nhắc chính = **web push + Zalo DM**; **Messenger best-effort trong cửa sổ standard 24h**, ngoài cửa sổ chỉ khi có cơ chế Meta đủ điều kiện/được phê duyệt; **bỏ group-mention Telegram**. Ngưỡng nhắc mặc định **2h → 24h → …** (DD-40). Sau **mọi** điểm markPaid (thủ công tiền mặt/CK **và** auto CK) → **xác nhận tự động tới player** (FR-6.2). Nhắc thủ công (`reminders_manual`) = mọi tier; **nhắc tự động (`reminders_auto`) = `host_pro`**.
>
> **Cập nhật v2.4 (DD-15/DD-67):** dispatcher không đọc tenant-level reachability. Nó resolve exact `channel_identity_id` endpoint cho Zalo/Messenger, re-authorize target tenant riêng, atomically claim một logical delivery key và fail closed khi provider outcome mơ hồ để tránh double-send.
>
> **Cập nhật v2.5 (tenant/endpoint integrity):** giữ `notification_deliveries.tenant_id` như live migration `0008`, bind delivery vào intent bằng composite FK `(intent_id, tenant_id)`, và bỏ `messenger_page_id` khỏi delivery row. Với Messenger/Zalo, exact Page/bot-OA luôn được derive từ immutable endpoint binding của `channel_identity_id`; không tồn tại hai cột độc lập có thể trỏ lệch endpoint.
>
> **Cập nhật v3.0 (2026-07-18) — gộp cụm 🔔.** Nhập `BE/feature_notification_center_tech.md` v1.0 vào đây; file đó đã xoá. §B/C/D **tái dùng** `notification_intents`/`notification_deliveries` của §A — không pipeline song song (HR3).
>
> **Current infrastructure boundary (2026-07-27):** shared job lease/ack, worker preflight,
> dispatcher và flagged scheduler đã merge qua `0022`/`0023`, nhưng schedule mặc định OFF và delivery
> vẫn placeholder fail-closed. Notification-specific schema delta, producer, real projector/adapter,
> Inbox API/UI, Web Push, payment lifecycle notifications và Chat digest source/consumer trong spec này **chưa implement**; job
> substrate không nâng feature thành `IMPLEMENTED` hay `ENABLE_READY`.
>
> **Execution ownership theo primary-surface plan v1.8:** mechanism chain 36 `notification-route-integrity-core` → 37 `notification-web-push-subscription-authority-core` → 38 `notification-web-push-provider-attempt-core` → 39 `pwa-installable-shell-core` → 40 `web-push-registration-client` → 41 `web-push-display-telemetry-client`; 42 `chat-unread-notification-core` consumes Chat read mechanism 10 plus that chain. Payment chain is 43 `notification-payment-lifecycle-intent-core` → 44 reminder producer + 45 settled/correction projector → 46 Inbox/authenticated detail → 47 generic payment-push adapter. A17–A19 own HTTP boundaries; F11/F14/F15 own product UI after F0. Mechanism slices do not implicitly own routes/UI, and adapters must not re-derive notification, unread or money state. Primary initiative `PLAN_READY` tại `90d292d`, runtime = 0 và từng slice vẫn strict `CODE_READY`.
>
> **Cập nhật v3.2 (reconcile decisions v1.49):** security alert chỉ dùng email `verified_at < event_at` hoặc device `trusted_at < event_at`; announcement preview là consume-once authorization proof với layered quota, canonical receipt và plain-text/body-size fence; DD-72 chỉ freeze Web Push phase-1/direct VAPID, không pre-design native. Secret resolver chuyển từ raw `person_id` sang dedicated-worker send-claim. `unknown` cấm alternate route; high-value class có tối đa 2 same-route retry theo topic/tag. DD-70/71/72 vẫn 🟡 proposal; runtime chưa có.
>
> **Cập nhật v3.3 (authority v1.51; reconciled v1.52):** exact security predicates là email `verified_at < event_at` hoặc device `trusted_at < event_at`; DD-72 surface server-owned `trusted_at/trust_source` + reset-on-rebind; proof bind fixed `count_by_channel + total_count`, chỉ cho component-wise decrease dưới cùng schema/policy nhưng roster resolve tại dispatch; provider wording phân biệt browser-selected push service với optional app-level vendor platform/SDK. DD-70/71/72 vẫn proposal; không runtime/migration mới.
>
> **Cập nhật v3.4b (notification closure v1.67; current authority v1.67):** recheck pin stable physical target + claim/start/finalize, visible-set finalizer/read-state, owner-derived global emit, durable quota/retry selections, actor+command/JTI registration receipt, trust epoch/proofs, serialized key rotation, attempt-ref telemetry và security-factor cutoff tại immutable context start. Tests là planned contract cases, không claim runtime.
>
> **Cập nhật v3.4c (authority/closure v1.67):** bỏ `follow_accepted` khỏi global notification plane; cấm tenant outbox làm fallback cho global event; global producer phải fence-first hoặc build halt. Cross-Person push rebind là proof-bound delete-old/insert-new UUID transfer; lifecycle clocks/prune và advisory-lock mapping được pin. Parent delivery không còn giữ retry/provider-result authority trùng physical attempts. Vẫn Draft/no runtime.
>
> **Cập nhật v3.4d (authority/closure v1.69):** route history/key bind closed `route_class`; physical attempts có due-planned lifecycle, explicit target-vs-intent-vs-defer table, possible-write precedence và sticky evidence-bound unknown. Broad core DML bị revoke; successful start mints exact-target authorization before secret resolution. Announcement exact preview/quota/retry bindings, bounded soft-retired tags, device cap/proof issuers/rebind transfer are pinned. Vẫn Draft/no runtime.
>
> **Cập nhật v3.4e (DD-45 mirror v1.68; current authority v1.69):** candidate events remain per-entry audit; deterministic owner intent moves to root `promotion_retry_id`. SessionService scheduler/worker independently claims the lazy max-3-claimed-attempt root; this projector never drives/settles retry. Vẫn Draft/no runtime.
> **Cập nhật v3.4f (DD-70/72 correction v1.70 — realign với FE):** global producer biết trước không được fallback tenant outbox; link-code consume emits nothing, merge commit append từ locked audit theo fence-first hierarchy, không theo được ⇒ build HALT (đã pin tại §Producer boundary + Cross-feature blocking order từ v3.4c/v3.4d). Cross-Person push rebind chỉ nhận verified prior-owner reauth/approval hoặc audited manual recovery; Person merge là re-parent/reset path riêng, invalidate pending rebind challenges. Vẫn Draft/no runtime.
> **Cập nhật v3.4g (post-fence snapshot v1.71; current authority v1.74):** mark-all/announcement fan-out dùng read-only discovery ngoài mutation transaction → bounded READ COMMITTED lock toàn bộ Person fences trước first authoritative snapshot/revalidation, giữ visibility/audience/tag/membership/preference/route owners tới commit (sửa isolation wording tại §Order/read boundary). v1.74 final implementability closure (exact planned-attempt receipt set · tag-retirement lock/recheck trước fan-out · push trust exactly-once guard · rebind prune chỉ NULL live pointers · delivered/opened latency DB-required/server-derived) recorded in decisions v1.74; §body absorption verify ở pass kế. Vẫn Draft/no runtime.
>
> **Cập nhật v3.5 (historical snapshot: decisions v1.90/v1.91; authority tại thời điểm đó v2.04; current authority v2.10):** DD-70 chọn global protected plane + service-layer merge/preferences; DD-71 chốt manual basic free + proof-bound confirm; DD-72 chốt web-only subscriptions + direct VAPID + generic OS payload. Contract Reviewed; không migration/service/worker/UI. NTF-OQ retention/evidence và DD-88 vẫn tách riêng.
>
> **Cập nhật v3.6 / DD-91 (2026-07-27):** payment reminder/settled/correction trên primary in-app surface reuse đúng durable tenant `notification_intents`, inbox và generic Web Push hiện tại; không tạo chat/Assistant projection hoặc pipeline mới. Authenticated detail delegates canonical person-self `SelfPaymentStatus` projection của Player View; notification/chat không có money formula/snapshot riêng. Core parity này không phụ thuộc DD-88.
>
> **Cập nhật v3.8 / DD-88 (2026-07-28, superseded một phần bởi DD-94):** group derive từ closed-set `type`/không cột `group`; một preference authority per-Person/per-type/channel cho hai plane Inbox; money/security schema-nonoptout; chat read tách notification read; không durable item mỗi chat message. Session/activity, `message_request` và scoped/bulk vẫn deferred. Nhận định offline digest còn mở đã được DD-94 thay thế.
>
> **Cập nhật v3.9 / DD-94 (2026-07-28):** Notification sở hữu generic coalesced delivery signal từ Chat unread, không Inbox item/message snapshot. DM/direct mention/reply default ON; club preference `all|mentions|off`, default `mentions`; key bind `(person,channel,highest_unread_cursor)`. Mark-read làm pending cũ obsolete. Ngay trước provider write re-check Chat unread/current membership hoặc DM block+safety/preference/device/trust epoch; false/unknown skip. Retry/unknown giữ logical key; missing/untested timing config giữ route OFF.
>
> **Review-fix v3.1:** security alert tách durable item khỏi trusted out-of-band route; announcement preview có opaque consume-once proof và layered actor/fan-out quota; DD-72 chỉ freeze direct Web Push/VAPID phase-1 (`kind='web'`), native shape chờ DD-69 spike. `unknown` luôn chặn alternate-route fallback nhưng same-route recovery được pin theo notification class.

> **Live schema baseline (đã verify trên `main`) — đọc trước khi thiết kế §B/C/D:**
> - `notification_intents`, `notification_deliveries` (`migrations/0008`), `outbox_events` (`0005`) đều **`tenant_id uuid NOT NULL REFERENCES tenants(id)`** → đây chính là gap DD-47 mô tả cho notify person-directed GLOBAL.
> - `notification_deliveries.platform` là **`text NOT NULL` KHÔNG có CHECK**; cột **`route_class` chưa tồn tại**; dedupe live chỉ có caller-computed `UNIQUE(delivery_key)`, chưa có history-safe `UNIQUE(intent_id,route_class)` + cross-route active partial fence. Các delta mới chỉ nằm trong §2 dưới đây với ghi chú "runtime migration pending" → **web push/one-route hardening phụ thuộc migration DD-67 đó land trước**.
> - Không có `membership_tags`, `announcements`, bảng inbox hay bảng push nào. `apps/web` chưa có `manifest.json`/service worker (chưa có cả thư mục `public/`).
> - **Committed `main` review snapshot** hiện tới `0024_public_visibility_capacity_check.sql`. Notification slice phải lấy **next available migration number tại build time** sau khi sync prerequisite branches; không hard-code số kế tiếp và không sửa/tái dùng migration lịch sử.

---

## 1. Tổng quan triển khai

```text
[A] REMINDER/CONFIRM (contract đã reviewed)
  Scheduler (narrow-claim due tenants) → Tenant TX (select eligible charges)
      → Create Intents → Dispatcher (channel selection) → Channel Adapter → Send
                                                              ↓ fail?
                                                Retry (backoff/jitter) → DLQ
  Ledger Outbox → settled/correction Intents (atomic/idempotent)
  Waitlist failure Outbox → owner-alert Intent (notification only; session worker owns retry)

[B] INBOX 🟡
  notification_intents ──→ Inbox read API (chính intent là durable tenant item)
          └───────────────→ InboxSignalProjector → SSE/cache invalidation/reconcile
  Follow/Link/Security service → person_notifications (GLOBAL PROTECTED)
  Security event → trusted-route dispatcher (factor established before trigger-context start)
  Inbox read API merge [A]+[global] ở SERVICE layer → SSE → Web inbox

[C] ANNOUNCEMENT 🟡
  Host compose → Preview (đếm audience + opaque proof, chưa tạo announcement)
       ↓ consume-once proof + re-authorize/revalidate
  announcements(row) + outbox → FanoutWorker
       ↓ resolve audience TẠI DISPATCH (không snapshot)
  notification_intents (type='announcement', 1 intent/recipient) → [A] dispatcher

[D] WEB PUSH 🟡
  Dispatcher route 'web' → dedicated worker consumes send-claim → WebPushAdapter
       ↓ payload = opaque ref + stable topic/tag (KHÔNG tiền/PII)
     browser push service (direct Web Push + VAPID) → ServiceWorker
       → push_delivery_telemetry → deep-link

[E] OFFLINE CHAT DIGEST 🟡
  Chat unread source adapter → (person, channel, opaque highest_unread_cursor; zero content)
       → Notification coalescing signal (one pending generation/person+channel)
       → fresh Chat unread/authz + preference + device/trust proof
       → [D] generic Web Push only; no Inbox item/chat message

```

**Design decisions:**

*§A — business invariants kế thừa từ v2.5:*
- Logical delivery dedupe dùng intent/delivery UNIQUE keys; **physical send không được giả định safe chỉ từ UNIQUE/provider idempotency**. Mỗi intent có tối đa một active route xuyên platform; mỗi exact target có tối đa một live attempt claim với sequence server-owned. Lease hết sau `send_started_at` ⇒ `unknown` trừ khi provider idempotency đã được chứng minh.
- Messenger one-route: mỗi **closed `route_class`** (`messenger_tenant_page` hoặc `messenger_central_page`) có tối đa một historical delivery; `delivery_key` derive từ intent+route class, không từ Page id. Partial `UNIQUE(intent_id) WHERE status IN ('pending','sent','unknown')` chặn hai route cùng live; fallback chỉ được tạo route class kế sau khi exact target/provider của route trước đã chứng minh no-send. Domain-invalid/expired intent không bao giờ fallback.
- Tenant + recipient boundary được giữ ở database, không chỉ RLS/service: delivery bind cùng `(intent_id,tenant_id,person_id)` và channel identity bind cùng `(id,platform,person_id)`.
- Endpoint là thuộc tính của `channel_identity_id`; delivery không nhận/lưu Page id hoặc bot/OA id từ caller. Endpoint binding trên identity là immutable; đổi endpoint phải tạo identity mới.
- Retry classes: transient (exponential backoff/jitter), rate-limit (honor retry-after), permanent (mark unreachable), expired (skip).
- Channel adapter sends **outside** DB transaction — record result after.

*§B/C/D/E (mới, 🟡):*
- **Tái dùng pipeline, không dựng cái thứ hai (HR3).** Announcement = một `type` của `notification_intents`; web push = một `platform` của `notification_deliveries`. Toàn bộ retry/one-route/dedupe/quiet-hours ở §A áp dụng nguyên vẹn, không viết lại.
- **Inbox là read model, không phải store thứ hai.** Chính row `notification_intents` là durable tenant item; chỉ `notification_reads` giữ `(source_kind='tenant', source_id=intent_id)`. Không có `tenant_inbox_items`/projector insert và không copy `amount`/`display_name`/`session title`; render qua `tenantRepo(tenantId)` dưới RLS ở request time. `InboxSignalProjector` chỉ đẩy SSE/invalidate cache/reconcile badge.
- **Merge hai plane ở SERVICE layer, không `UNION` SQL.** `UNION` cross-plane buộc phải nới grant hoặc bypass RLS — không connection nào được vừa thấy global vừa bypass tenant RLS.
- **Order/read boundary không dùng timestamp/watermark.** Tenant/global insert lấy một server `inbox_sequence` dưới cùng per-Person fence. Mark-all dùng read-only discovery ngoài mutation transaction rồi bounded `READ COMMITTED` acquire toàn bộ per-Person fence trước authoritative snapshot/revalidation đầu tiên (v1.71): giữ fence lock tới commit, lưu command receipt + boundary + exact read rows chỉ cho item đang visible; crash rollback toàn bộ, hidden/late item unread. Cursor signed bind actor+filter+`before_sequence`.
- **Payload push là con trỏ, không phải nội dung.** Push service là hạ tầng bên thứ ba; mọi byte trong payload coi như đã công khai.
- **Global-protected theo khuôn đã có:** `person_notifications` + `device_push_subscriptions` không `tenant_id`, **không blanket grant** cho `app`, chỉ narrow `SECURITY DEFINER` — giống `person_follows` (DD-47) và `channel_identities` (DD-67).
- **Security alert có hai lớp:** `person_notifications` là durable source; server/DB derive immutable `trigger_context_started_at <= event_at <= created_at` từ locked session/recovery context và append pre-mutation, không nhận các boundary này từ request/outbox. Dispatcher chỉ chọn email identity có `verified_at < trigger_context_started_at` hoặc device subscription có `trusted_at < trigger_context_started_at`; factor thiết lập trong chính triggering context bị loại, delivery fail không xoá item.
- **Lưu TIÊU CHÍ audience, không snapshot danh sách người.** Snapshot roster sẽ phình bảng, gửi cho người vừa rời CLB, và tạo bản sao roster ngoài `memberships`.
- **Preview là proof boundary, không phải UI ceremony.** Proof bind actor/tenant/content hash gồm body+session_ref+CTA/audience hash/fixed vector/route versions/expiry. Canonical content/proof/audience rows immutable. Trước mọi intent, một consistent-snapshot transaction re-authorize creator+tenant, re-hash content+criteria, resolve roster/routes và reject any increase/drift; pass thì atomically persist intents + pinned routes + actual vector. Không partial fan-out.
- **Announcement free có layered quota + exact idempotency:** `command_scope_key` bind tenant+actor+command và canonical request fingerprint; same request replay, different fingerprint → `IDEMPOTENCY_KEY_REUSED`. Durable reservation còn bind preview JTI + fixed tenant/actor/fan-out units; quota outage fail closed. Retry-failed là actor-scoped command, lock intent, deterministic policy-rank một terminal failed route + persist per-intent result, không charge lại và không chạy nếu còn `pending|sent|unknown`.
- **Authorization tại read/dispatch/send time, không snapshot.** Ngay trước provider write, type-specific predicate phải pass: reminder open/partial + current policy (kể cả explicit final notice); settled/correction exact unsuperseded event version + original bound Person; owner alert current admin; announcement active/allowed-guest + no opt-out + current capability. Fail → terminal pre-send skip, không HTTP.
- **Projector/adapter không nằm trên đường tiền.** Fail/DLQ theo `projector_deliveries`; không rollback ledger (**BL-NTF-2**).
- **Secret resolution là worker-only.** Generic web `app` role không được EXECUTE hàm giải mã endpoint/keys; dedicated worker consume send-claim TTL ngắn, derive person/subscriptions từ logical delivery và ghi audit per physical attempt.
- **Unknown recovery theo class.** Alternate-route fallback luôn cấm. Tenant path chỉ `settled|correction` được tối đa 2 same-Web-Push retry bằng cùng logical ref + stable Topic/client tag; `security_alert` thuộc global attempt ledger phải được auth-security slice pin trước enablement theo DD-70. `reminder|announcement` mặc định manual reconcile.
- **Direct Web Push + VAPID, không “tự host provider”.** VAPID xác thực application server; browser-selected push service vẫn ở data flow. Phase-1 không thêm app-level vendor notification platform/SDK. Native provider/schema không được suy từ Web-Push columns trước DD-69 phase-2 spike.
- **Host-authored body là untrusted plain text.** API/DB write luôn parameterized; canonicalize valid UTF-8/newlines, reject control characters và `octet_length(body)>16384`; preview check provider limit. Không đưa body vào global store/OS push/log/metric. DLP warn/block là NTF-OQ-11, không claim semantic scanner bắt hết PII.
- **Chat digest là delivery signal, không phải content projection.** Chat owns the canonical `(created_at,id)` history order and per-person/channel unread proof; Notification receives only an opaque comparable `highest_unread_cursor`, owns coalesce/provider delivery and never inserts `notification_intents`, `person_notifications` or a row per source message.
- **Preference + live proof are send gates.** DM/direct mention/reply default ON; club preference exact `all|mentions|off`, default `mentions`. Before provider write, re-check current club membership or DM read/block/safety, preference, active subscription/current trust epoch and cursor still unread; false/unknown skips. Timing/coalesce config absent or untested keeps only this route OFF.

### DD-91 primary-surface payment parity

```text
canonical payment event/version
  → notification_intents(type=reminder|settled|correction)  [durable tenant inbox item]
  → optional delivery route (generic Web Push / Zalo / eligible Messenger)
  → authenticated inbox/deep-link read
  → canonical Player View person-self SelfPaymentStatus projection
```

- `notification_intents` remains the sole durable tenant item. The chat surface may consume inbox count/list/deep-link, but must not insert a lifecycle `chat_message`, invoke the Assistant writer or create a second money-notification store.
- OS push keeps the existing opaque ref + fixed generic `i18n_key`; no amount, club name, QR or rendered payment copy leaves the trusted app boundary. Provider failure/`unknown` changes only delivery state: the intent stays queryable and ledger state is untouched.
- Payment item detail re-authorizes actor/source at read time, then calls the canonical Player View person-self projection. Notification code must not call `effectiveFee`, reproduce `due-paid` arithmetic, cache an amount snapshot or turn an unavailable/unknown projection into zero. Unknown/forbidden/deleted source renders generic unavailable.
- V1 intent/item persists only closed `type` + opaque canonical source/event refs; no title, amount or arbitrary render params snapshot. V1 has no mark-unread/archive/user-delete/hard-purge path. Correction/read audit stays durable; cleanup remains disabled until Legal/Security retention is approved.
- DD-88 broader grouping, `message_request` and scoped/bulk read remain deferred; DD-94 Chat digest is an independent delivery signal. Neither DD-88 nor DD-94 can block durable payment items, generic payment push, authenticated detail or the DD-91 primary-surface exit gate.

### DD-88 broader `DEFERRED_PROPOSAL` boundary

- If reopened, group must be a read-model mapping from closed-set `type`; no persisted free-form `group` column.
- The broader proposal suggests one per-Person, per-type/channel preference authority across tenant and global planes. This is not a final schema authorization. Money (`reminder|settled|correction`) and `security_alert` remain structurally non-opt-out under core authority; UI-only blocking is insufficient.
- Chat unread/read state stays separate from `notification_reads`. No durable notification item is created per chat message; DD-94 delivery state is not an Inbox/read-state plane.
- Session lifecycle/activity types reopen only after Session producers land. `message_request` reopens only after the DD-55 phase-2 request box lands. DD-94 already owns the exact Chat digest and does not authorize those broader types.
- Scoped mark-all/bulk read reopens only after the core Inbox/read model lands. Any future contract must persist a canonical request/filter fingerprint, use a server-owned boundary, re-authorize the complete set, commit all-or-nothing and enforce a hard cap of 100 refs.
- These are proposed constraints and current negative scope only. DD-88 is not `DECISION_FINAL`; this section adds no schema object, endpoint, worker, executed-test claim or runtime authorization.

### DD-94 offline Chat digest boundary

```text
Chat canonical unread cursor
  → chat-digest source adapter: person + channel + opaque highest cursor only
  → Notification-owned coalescing/delivery state
  → pre-provider Chat proof + preference + device/trust recheck
  → generic Web Push
```

- Chat owns canonical history/read state and exposes a fail-closed proof for “actor can still read this channel and `highest_unread_cursor` is still unread”. Notification cannot derive unread from cached message data or `notification_reads`.
- Source/job/persisted/provider payloads allow only opaque person/channel/cursor and delivery/idempotency metadata. They contain no body, title, amount, mention text, author, attachment, tenant/club name or per-message durable item.
- Preference authority is per Person: DM defaults ON. A club channel accepts only `all|mentions|off`, default `mentions`; this default enables direct mention/reply, `off` suppresses both and `all` broadens to eligible activity. An absent row resolves to the default; lookup unavailable/unknown skips rather than widening.
- Coalesce/dedupe binds `(person_id,channel_id,highest_unread_cursor)`. Same/lower cursor is no-op; a higher cursor atomically advances the pending generation. Once a provider attempt can have written, its logical key is immutable; retry/`unknown` never mint a duplicate. A later cursor may only become the single pending successor.
- Mark-read makes an old pending cursor obsolete. Immediately before provider write, worker re-checks Chat unread/current club membership or DM read+block+safety, preference, active device/current trust epoch and route permission. Any false/unknown result terminal-skips with a bounded reason and no HTTP.
- Offline delay/coalesce/cooldown are named enablement configuration, not product constants. Missing config or unpassed boundary matrix keeps Chat digest OFF without affecting realtime/history/reconnect/unread/badge or DD-91 payment notifications.
- DD-88 is not a dependency. It remains a proposal for broader grouping/taxonomy, `message_request`, session/activity and scoped/bulk Inbox behavior.

---

## 2. Database Schema + Edge Cases (BE)

### 2.1 Core (§A — business invariants đã reviewed; target DDL có delta cross-cutting được đánh dấu)

```sql
CREATE TABLE notification_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) UNIQUE,
  thresholds jsonb NOT NULL DEFAULT '{}',
  quiet_hours_start time,
  quiet_hours_end time,
  max_count integer NOT NULL DEFAULT 3,
  cooldown_minutes integer NOT NULL DEFAULT 1440,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE notification_intents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  type text NOT NULL
       CHECK (type IN ('reminder','settled','correction','owner_alert','announcement')),
       -- 'announcement' là target extension đã owner-final ở §C/DD-71, chưa có migration.
  aggregate_id uuid NOT NULL,
  state_version integer NOT NULL,
  source_event_id uuid NOT NULL, -- canonical event/command/send-slot; server-derived
  person_id uuid NOT NULL REFERENCES persons(id),
  inbox_sequence bigint NOT NULL, -- §B owner-final target, not implemented; server allocator/trigger only
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'dispatched', 'skipped', 'expired')),
  skip_reason text CHECK (skip_reason IN ('no_reachable_route','domain_state_changed',
                                          'recipient_ineligible','authorization_revoked',
                                          'preference_opted_out','tenant_inactive')),
  intent_key text NOT NULL UNIQUE,  -- versioned server HMAC; never caller authority
  intent_key_version smallint NOT NULL CHECK (intent_key_version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notification_intents_id_tenant_uq UNIQUE (id, tenant_id),
  CONSTRAINT notification_intents_id_tenant_person_uq UNIQUE (id, tenant_id, person_id),
  CONSTRAINT notification_intents_id_tenant_type_aggregate_uq
    UNIQUE (id, tenant_id, type, aggregate_id),
  CONSTRAINT notification_intents_source_person_uq
    UNIQUE (tenant_id, type, source_event_id, person_id),
  CONSTRAINT notification_intents_inbox_sequence_uq UNIQUE (inbox_sequence),
  CONSTRAINT notification_intents_skip_shape_chk CHECK (
    (status = 'skipped') = (skip_reason IS NOT NULL)
  )
);

-- DD-67 identity migration prerequisite. The platform participates in the FK so
-- a Messenger delivery cannot reference a Zalo identity, and person participates
-- so an intent for Person A cannot route through Person B's valid identity.
ALTER TABLE channel_identities
  ADD CONSTRAINT channel_identities_id_platform_person_uq UNIQUE (id, platform, person_id);

CREATE TABLE notification_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  intent_id uuid NOT NULL,
  person_id uuid NOT NULL REFERENCES persons(id),
  platform text NOT NULL CHECK (platform IN ('web','zalo','messenger')),
  channel_identity_id uuid,
  route_class text NOT NULL, -- web|zalo_bot|messenger_tenant_page|messenger_central_page
  target_ref text,  -- legacy/audit ciphertext only; adapter MUST NOT route from this field
  status text NOT NULL DEFAULT 'pending'
         CHECK (status IN ('pending', 'sent', 'failed', 'skipped', 'unknown')),
  unknown_since timestamptz,
  unknown_reconcile_after timestamptz,
  unknown_recovery_waves smallint NOT NULL DEFAULT 0
                         CHECK (unknown_recovery_waves BETWEEN 0 AND 2),
                         -- logical ambiguous-write recovery only; normal retry stays per attempt
  normal_attempt_limit smallint NOT NULL CHECK (normal_attempt_limit BETWEEN 1 AND 3),
                         -- total provider-call attempts/target/recovery_wave; server policy snapshot
  retry_policy_version smallint NOT NULL CHECK (retry_policy_version > 0),
  delivery_key text NOT NULL UNIQUE,  -- HMAC(logical intent + closed route_class); never Page id
  topic_token text,                   -- persisted stable Web Push Topic/client tag
  topic_key_version smallint CHECK (topic_key_version > 0),
  target_generation uuid,             -- server-generated once; closes physical target set
  target_count integer CHECK (target_count > 0),
  target_set_closed_at timestamptz,
  CONSTRAINT notification_deliveries_id_tenant_uq UNIQUE (id, tenant_id),
  CONSTRAINT notification_deliveries_id_tenant_intent_uq
    UNIQUE (id, tenant_id, intent_id),
  CONSTRAINT notification_deliveries_id_tenant_generation_uq
    UNIQUE (id, tenant_id, target_generation),
  CONSTRAINT notification_deliveries_intent_route_class_uq
    UNIQUE (intent_id, route_class),   -- history-safe; permits tenant-Page → central-Page fallback
  CONSTRAINT notification_deliveries_intent_tenant_person_fk
    FOREIGN KEY (intent_id, tenant_id, person_id)
    REFERENCES notification_intents(id, tenant_id, person_id)
    DEFERRABLE INITIALLY IMMEDIATE,
  CONSTRAINT notification_deliveries_identity_platform_person_fk
    FOREIGN KEY (channel_identity_id, platform, person_id)
    REFERENCES channel_identities(id, platform, person_id)
    DEFERRABLE INITIALLY IMMEDIATE,
  CHECK ((platform IN ('zalo','messenger')) = (channel_identity_id IS NOT NULL)),
  CHECK (
    (platform = 'web' AND route_class = 'web')
    OR (platform = 'zalo' AND route_class = 'zalo_bot')
    OR (platform = 'messenger' AND route_class IN ('messenger_tenant_page','messenger_central_page'))
  ),
  CHECK (
    (status = 'unknown' AND unknown_since IS NOT NULL AND unknown_reconcile_after IS NOT NULL)
    OR (status <> 'unknown' AND unknown_since IS NULL AND unknown_reconcile_after IS NULL)
  ),
  CHECK (
    (platform = 'web' AND topic_token IS NOT NULL
      AND topic_token ~ '^[A-Za-z0-9_-]{32}$' AND topic_key_version IS NOT NULL)
    OR (platform <> 'web' AND topic_token IS NULL AND topic_key_version IS NULL)
  ),
  CHECK (
    (target_generation IS NULL AND target_count IS NULL AND target_set_closed_at IS NULL)
    OR (target_generation IS NOT NULL AND target_count IS NOT NULL
      AND target_set_closed_at IS NOT NULL)
  ),
  created_at timestamptz NOT NULL DEFAULT now()
);
-- History-safe route-class uniqueness ở trên vẫn cần active fence xuyên mọi route:
-- Web pending + Zalo pending hoặc tenant-Page + central-Page cùng live đều bị chặn.
CREATE UNIQUE INDEX notification_deliveries_one_active_route_uq
  ON notification_deliveries(intent_id)
  WHERE status IN ('pending','sent','unknown');

-- Durable owner của từng provider HTTP call. physical_target_id là canonical,
-- rotation-stable identity/subscription UUID do resolver derive; HMAC ref/version
-- chỉ audit/lookup. Không trường nào là raw endpoint/PSID/from.id hay caller authority.
CREATE TABLE notification_delivery_attempts (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES tenants(id),
  delivery_id         uuid NOT NULL,
  target_generation   uuid NOT NULL,
  physical_target_id  uuid NOT NULL, -- server-derived identity/subscription UUID; no cross-plane FK
  physical_target_ref text NOT NULL,
  physical_target_key_version smallint NOT NULL CHECK (physical_target_key_version > 0),
  attempt_seq         integer NOT NULL CHECK (attempt_seq > 0),
  recovery_wave       smallint NOT NULL DEFAULT 0 CHECK (recovery_wave BETWEEN 0 AND 2),
  wave_attempt_ordinal smallint NOT NULL CHECK (wave_attempt_ordinal BETWEEN 1 AND 3),
  status              text NOT NULL CHECK (status IN
                        ('planned','claimed','sent','retriable_no_send',
                         'terminal_no_send','cancelled','unknown')),
  claim_token         uuid,
  lease_expires_at    timestamptz,
  send_started_at     timestamptz,
  available_at        timestamptz NOT NULL DEFAULT now(), -- claim/defer gate for planned row
  next_attempt_at     timestamptz,
  completed_at        timestamptz,
  result_code         text CHECK (result_code IS NULL OR result_code IN
                        ('ok','gone','not_found','endpoint_invalid_soft','rate_limited',
                         'transient_no_send','payload_rejected','target_revoked',
                         'identity_unreachable','window_closed',
                         'ambiguous_after_write','ttl_expired','pre_send_invalidated',
                         'logical_already_sent')),
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (delivery_id, target_generation, physical_target_id, attempt_seq),
  UNIQUE (delivery_id, target_generation, physical_target_id,
          recovery_wave, wave_attempt_ordinal),
  CONSTRAINT nda_id_tenant_uq UNIQUE (id, tenant_id),
  CONSTRAINT nda_delivery_tenant_generation_fk
    FOREIGN KEY (delivery_id, tenant_id, target_generation)
    REFERENCES notification_deliveries(id, tenant_id, target_generation),
  CONSTRAINT nda_claim_shape_chk CHECK (
    (status = 'planned' AND claim_token IS NULL AND lease_expires_at IS NULL
      AND send_started_at IS NULL AND completed_at IS NULL)
    OR (status = 'claimed' AND claim_token IS NOT NULL AND lease_expires_at IS NOT NULL
      AND completed_at IS NULL)
    OR (status IN ('sent','retriable_no_send','terminal_no_send','cancelled','unknown')
      AND claim_token IS NULL AND lease_expires_at IS NULL AND completed_at IS NOT NULL)
  ),
  CONSTRAINT nda_send_started_shape_chk CHECK (
    (status NOT IN ('sent','unknown') OR send_started_at IS NOT NULL)
    AND (status <> 'cancelled' OR send_started_at IS NULL)
  ),
  CONSTRAINT nda_retry_shape_chk CHECK (
    (status = 'retriable_no_send' AND next_attempt_at IS NOT NULL)
    OR (status <> 'retriable_no_send' AND next_attempt_at IS NULL)
  ),
  CONSTRAINT nda_result_shape_chk CHECK (
    (status IN ('planned','claimed') AND result_code IS NULL)
    OR (status = 'sent' AND result_code = 'ok')
    OR (status = 'retriable_no_send'
      AND result_code IN ('rate_limited','transient_no_send','endpoint_invalid_soft'))
    OR (status = 'terminal_no_send'
      AND result_code IN ('gone','not_found','endpoint_invalid_soft','payload_rejected',
                          'target_revoked','identity_unreachable','window_closed',
                          'rate_limited','transient_no_send'))
    OR (status = 'cancelled'
      AND result_code IN ('ttl_expired','pre_send_invalidated','logical_already_sent'))
    OR (status = 'unknown' AND result_code = 'ambiguous_after_write')
  ),
  CONSTRAINT nda_result_origin_chk CHECK (
    result_code IS NULL
    OR (result_code IN ('target_revoked','identity_unreachable','window_closed',
                        'ttl_expired','pre_send_invalidated','logical_already_sent')
      AND send_started_at IS NULL)
    OR (result_code IN ('ok','gone','not_found','endpoint_invalid_soft','rate_limited',
                        'transient_no_send','payload_rejected','ambiguous_after_write')
      AND send_started_at IS NOT NULL)
  ),
  CONSTRAINT nda_attempt_time_chk CHECK (
    (send_started_at IS NULL OR send_started_at >= created_at)
    AND available_at >= created_at
    AND (completed_at IS NULL OR completed_at >= created_at)
    AND (completed_at IS NULL OR send_started_at IS NULL OR completed_at >= send_started_at)
    AND (lease_expires_at IS NULL OR lease_expires_at > created_at)
  )
);
CREATE UNIQUE INDEX nda_one_live_attempt_uq
  ON notification_delivery_attempts(delivery_id, physical_target_id)
  WHERE status IN ('planned','claimed');
CREATE INDEX nda_planned_due_idx
  ON notification_delivery_attempts(available_at, delivery_id)
  WHERE status = 'planned';
CREATE INDEX nda_retriable_due_idx
  ON notification_delivery_attempts(next_attempt_at, delivery_id)
  WHERE status = 'retriable_no_send';
CREATE INDEX nda_claimed_lease_idx
  ON notification_delivery_attempts(lease_expires_at, delivery_id)
  WHERE status = 'claimed';
CREATE INDEX nd_unknown_due_idx
  ON notification_deliveries(unknown_reconcile_after, id)
  WHERE status = 'unknown';

-- Evidence-bound owner cho ambiguous outcome. Operator/API không được chọn outcome:
-- owner-only function locks attempt, verifies canonical evidence row then derives
-- sent vs terminal_no_send. Không có evidence hợp lệ => attempt remains unknown.
CREATE TABLE notification_unknown_reconciliations (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id),
  attempt_id        uuid NOT NULL,
  command_id        uuid NOT NULL,
  initiator_kind    text NOT NULL CHECK (initiator_kind IN ('person','system_evidence')),
  initiator_ref     uuid NOT NULL, -- Person UUID or canonical evidence-owner UUID; server-derived
  requested_by      uuid REFERENCES persons(id),
  evidence_kind     text NOT NULL CHECK (evidence_kind IN
                       ('provider_delivery_receipt','provider_nonacceptance_receipt',
                        'device_display_receipt')),
  evidence_ref      uuid NOT NULL,
  outcome           text NOT NULL CHECK (outcome IN ('sent','terminal_no_send')),
  reconciliation_key text NOT NULL UNIQUE,
  key_version       smallint NOT NULL CHECK (key_version > 0),
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (attempt_id),
  UNIQUE (initiator_kind, initiator_ref, command_id),
  UNIQUE (evidence_kind, evidence_ref),
  CONSTRAINT nur_initiator_shape_chk CHECK (
    (initiator_kind = 'person' AND requested_by IS NOT NULL
      AND initiator_ref = requested_by)
    OR (initiator_kind = 'system_evidence' AND requested_by IS NULL)
  ),
  CONSTRAINT nur_attempt_tenant_fk FOREIGN KEY (attempt_id, tenant_id)
    REFERENCES notification_delivery_attempts(id, tenant_id)
);
```

All notification tables, gồm `notification_delivery_attempts`: `ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY`. Provider registry/identity/reachability remain global-protected and are accessed only through narrow resolver/delivery functions. Composite FKs prove intent, tenant và Person agree before a Zalo/Messenger route exists; Web Push resolver independently requires subscription `person_id = delivery.person_id`. `channel_identity_id` is the only bot endpoint authority. `target_ref` remains legacy/audit ciphertext and is never an input to credential/recipient selection. Narrow resolver derives stable `physical_target_id` (identity/subscription UUID) server-side; heterogeneous/global target means no cross-plane FK, nhưng claim function re-verifies same-Person. HMAC `physical_target_ref + key_version` chỉ audit/lookup, không là uniqueness owner qua rotation.

**Route activation + closed physical target generation là một atomic narrow function.** `notification_route_activate_and_close` read-only derives intent Person, ordered route candidates and target owners, locks every affected Person inbox fence UUID-order, then locks intent and re-reads same-Person active reachability. For each candidate under the same transaction it enumerates the exact nonempty target set **before** inserting the delivery; only then it inserts one delivery with one-time `target_generation + target_count + target_set_closed_at`, a server-derived `normal_attempt_limit + retry_policy_version`, and exactly one initial `planned` row (`attempt_seq=1,recovery_wave=0,wave_attempt_ordinal=1`) per stable target UUID. If a candidate becomes zero-target, it creates **no live delivery/attempt**, evaluates the next route; if all are empty it marks intent `skipped/no_reachable_route`. Owner/target drift rolls back to discovery; no delivery/subscription lock precedes fences. DEFERRABLE guard re-counts the exact generation and rejects missing/extra/duplicate rows. Không worker nào claim/start trước closure; registration/reachability commit after snapshot applies only to future notification. This closes the last-target-revoked race without fabricating a target attempt.

**Normal provider retry policy v1 (server authority, total HTTP calls per target per recovery wave):**

| Closed `route_class` | `reminder\|announcement` | `settled\|correction\|owner_alert` | Backoff base / cap |
|---|---:|---:|---|
| `web` | 2 | 3 | 30s / 15m |
| `zalo_bot` | 2 | 3 | 30s / 10m |
| `messenger_tenant_page\|messenger_central_page` | 2 | 2 | 15s / 5m, additionally bounded by the current messaging window |

An unknown/future `(type,route_class)` defaults fail-closed to `normal_attempt_limit=1` (one provider call, no normal retry) until a new versioned row is explicitly reviewed. The persisted delivery limit/version, not mutable tenant input or `notification_policies.max_count`, owns the budget. Each new normal retry keeps the same `recovery_wave`, increments both global `attempt_seq` and `wave_attempt_ordinal`, and is forbidden once the ordinal reaches the persisted limit. A permitted unknown-recovery wave starts a new `recovery_wave` with ordinal 1; its at-most-two wave budget is separate and never increases the normal per-wave limit.

For a provider-proven no-send transient, server code computes and persists `next_attempt_at`; caller input cannot choose it. Retry ordinal 2 uses the route base, later ordinals double it, each with server equal-jitter in `[0.5,1.0]`, capped by the route cap. A syntactically valid provider `Retry-After` is honored as `max(parsed_retry_after, jittered_backoff)`; missing/invalid values use backoff alone. The result must be strictly before the canonical minimum of intent expiry, announcement TTL and route/window eligibility. If `Retry-After` or the computed instant reaches/passes that deadline, or the attempt budget is exhausted, terminalize with the same coarse result and do not retry. A rate-limit/transient response counts as no-send only when that adapter contract proves the provider did not accept the message; otherwise it is `unknown`.

`notification_attempt_claim` first read-only derives delivery Person/target owner, locks affected Person fences, then locks delivery+target and revalidates before choosing a server-side due `planned` row (`available_at <= transaction_timestamp()`); it CASes `planned→claimed` bằng token/lease, caller không truyền sequence/target. Initial `attempt_seq=1` rows may still be claimed after another initial target has made the logical delivery `sent`; every row with `attempt_seq>1` must reject claim when the delivery is sent. Normal retry is created only when the target's latest row is due `retriable_no_send`, the logical delivery is not sent, `wave_attempt_ordinal < normal_attempt_limit`, and no live row exists; the function inserts `attempt_seq=max+1,wave_attempt_ordinal=prior+1` in `planned` with the same `recovery_wave`, then claims through the same path. 404/410 after a started HTTP call produce `terminal_no_send/gone|not_found`; 429/explicit transient no-send produce `retriable_no_send` with server-owned per-target schedule. Exhausted/deadline-blocked retry terminalizes the same coarse code (`rate_limited|transient_no_send|endpoint_invalid_soft`) as `terminal_no_send`, so it cannot leave the delivery pending forever. Immediately before HTTP, worker atomically sets `send_started_at` **after** type-specific fresh validation. Lease expiry with `send_started_at IS NULL` reclaims the same claimed row; expiry after start finalizes `unknown`, never opens a blind claim/route.

`push_unknown_recovery_claim` là transaction riêng cho promise ≤2 same-route retries: read-only selects due logical `unknown` delivery, joins canonical intent type and permits only `settled|correction`, derives exact delivery Person + pinned unknown targets, locks all affected Person fences, then locks delivery and revalidates source/Topic/target freshness. It requires `unknown_recovery_waves < 2`, no live/retriable attempt and at least one exact-target historical `unknown` chưa reconcile; atomically increments the parent wave, advances DB-owned `unknown_reconcile_after`, and inserts one `planned` row with `attempt_seq=max+1,recovery_wave=new_count` **only** for each still-eligible exact unknown target. Delivery vẫn `unknown` trong recovery; stable Topic/logical ref is reused, no new target or alternate route joins. Drift/no eligible target leaves it `unknown` for manual review. Crash rolls back the whole wave. Later explicit no-send/exhaustion **không che** historical ambiguous write và không mở fallback; chỉ later sent hoặc canonical evidence reconciliation resolve được nó.

Fresh validation phải phân loại theo bảng sau; không collapse target invalid thành whole-intent skip:

| Fresh pre-send result | Attempt transition | Logical effect |
|---|---|---|
| Canonical intent/domain invalid: charge paid/void, source superseded, recipient ineligible, announcement auth/preference revoked | Nếu **không** attempt nào trong generation có `send_started_at`/`sent`/`unknown`: every unstarted `planned|claimed` row → `cancelled/pre_send_invalidated`, intent `skipped`, delivery `skipped`. TTL uses attempts `cancelled/ttl_expired`, intent `expired`, delivery `skipped`. Nếu đã có possible/actual write: chỉ cancel remaining unstarted work, append audit/correction need, không rewrite logical outcome | Never fallback; a later domain change cannot erase a real/possible external send. Delivery has no `expired` enum |
| Exact target/route invalid only before HTTP: subscription revoked/stale, identity unreachable, Messenger window closed | Unstarted `planned|claimed` row → exact target `terminal_no_send/target_revoked|identity_unreachable|window_closed`; clear claim/lease, DB completion time | Truthful local result; never fabricate provider `gone/not_found`. Other pinned targets continue; fallback only after every effective target is terminal no-send |
| Provider proves exact target no-send after HTTP | Started row → `terminal_no_send/gone|not_found|payload_rejected` (or exhausted transient coarse code) | Other pinned targets continue; same all-target/sticky-unknown finalizer |
| Quiet-hours/policy window active | `claimed→planned`, clear claim/lease, keep `send_started_at=NULL`, set DB-owned `available_at` to next eligible instant | Remain pending; emit `deferred`, never skipped/failed and fabricate no provider attempt |
| Predicate valid | CAS `send_started_at`, mint signed send authorization | Provider I/O may begin |

Logical finalizer read-only derives the delivery Person, locks that inbox fence, then locks delivery/attempt rows and revalidates owner. Nó đọc latest row per pinned target **và mọi historical `unknown`** của exact generation; historical unknown không có canonical reconciliation receipt là sticky, nên later `terminal_no_send` không được che nó. Precedence: (1) bất kỳ attempt/reconciliation `sent` ⇒ logical `sent`; (2) nếu có unreconciled historical unknown ⇒ logical `unknown`, kể cả same-route recovery đang live hoặc later no-send; (3) nếu còn claimed/retriable/planned eligible work ⇒ `pending`; (4) chỉ khi không possible/actual write, canonical intent `skipped|expired`/cancelled ⇒ logical delivery `skipped`, **không fallback**; (5) `failed`/fallback chỉ khi đủ `target_count`, không live/unreconciled unknown và mọi target effective outcome đều `terminal_no_send`. On the first transition to logical `sent`, under the same delivery lock it terminalizes every unstarted non-initial row (`attempt_seq>1`, `status IN ('planned','claimed')`, `send_started_at IS NULL`) as `cancelled/pre_send_invalidated`, clearing claim/lease. Initial `attempt_seq=1` rows of the closed generation may still be claimed/started/finalized after fresh checks; already-started retry/recovery rows only finalize/audit. Generic normal-retry and unknown-recovery claim paths both reject a sent delivery, and no new target generation is allowed. Report/count derive từ attempts; parent `unknown_recovery_waves/unknown_reconcile_after` chỉ là bounded ambiguous-write policy owner, không phải normal retry/result authority. Raw provider body/header/endpoint/error string không được persist hoặc log.

`notification_unknown_reconcile_with_evidence` is the only evidence-based unknown resolution writer. It follows the same read-only owner → inbox fence → attempt/delivery order, consumes an actor-scoped command, verifies one canonical provider delivery/nonacceptance receipt or device-display telemetry bound to the exact attempt, derives the outcome, inserts the reconciliation receipt and transitions the attempt in one transaction. Evidence for delivery/display ⇒ `sent`; provider nonacceptance ⇒ `terminal_no_send`. No evidence, conflicting evidence or caller-supplied outcome fails closed: attempt remains `unknown`, no alternate route. Automatic same-route waves remain limited to tenant `settled|correction`; reminder/announcement require this evidence-bound path, while global `security_alert` waits for its DD-70 attempt owner.

> ⚠️ `type` CHECK/`announcement`, `platform` CHECK, `route_class` và delivery status `unknown` ở trên là **target schema, chưa live** — xem Live baseline ở đầu doc. `platform='web'` chỉ trở thành route hợp lệ ở DB sau khi migration này land; §C/D phụ thuộc các delta tương ứng.

#### Migration / upgrade contract từ live `0008`

Do **not** edit historical migration `0008_notifications_onboarding.sql`. A new migration after the DD-65/DD-67 registry/identity migration must:

1. **Expand intent columns nullable first:** add `source_event_id`, `intent_key_version`, `inbox_sequence` and `skip_reason` without target NOT NULL/CHECK/UNIQUE. Audit every legacy intent. Backfill `source_event_id` only from durable canonical event/command/send-slot evidence; a scheduler run UUID is not a reminder slot. Existing `status='skipped'` gets a closed `skip_reason` only from durable evidence. Unprovable source/reason moves transactionally to a protected immutable non-sendable legacy archive; never invent a value merely to satisfy target constraints.
2. Under a notification-writer maintenance gate, create global sequence + per-Person fences + overwrite trigger, then backfill surviving intents deterministically by `(created_at,id)` while updating each Person fence. Enable new writers through the trigger, audit uniqueness/fence maxima and concurrent-write cutover, then set `source_event_id`, `intent_key_version`, `inbox_sequence` NOT NULL; add structural source-person UNIQUE, sequence UNIQUE and skip-shape CHECK. This expand/backfill/cutover lands before any inbox list or mark-all path.
3. Preserve live `notification_deliveries.tenant_id NOT NULL`; add/backfill delivery `person_id` from its canonical intent, add `notification_intents UNIQUE (id,tenant_id,person_id)` + `(id,tenant_id,type,aggregate_id)` and `channel_identities UNIQUE (id,platform,person_id)`, then add composite FKs `NOT VALID DEFERRABLE INITIALLY IMMEDIATE`. Scalar FKs drop only after validation. Person merge explicitly defers same-Person FKs and re-parents in one transaction.
4. Audit tenant mismatch **và** `delivery.person_id <> intent.person_id` / channel identity Person mismatch. Any row is fail-closed manual repair; never rewrite ownership from request data or guess identity. Validate constraints under owner/bypass-RLS fixture too.
5. Audit duplicate `(intent_id,route_class)` and mọi intent có hơn một row `status IN ('pending','sent','unknown')` xuyên route class/platform. Any duplicate/live overlap halts for provider-evidence reconciliation; never auto-delete/merge. Add history-safe `notification_deliveries_intent_route_class_uq` + cross-route partial active fence. This permits a terminal tenant-Page row followed by a central-Page row while still blocking duplicate same route class. `delivery_key` remains auxiliary idempotency only.
6. Inventory **all distinct live `platform/status/type/provider_code` values before CHECKs**. Supported rows backfill exact route evidence and coarse allowlisted result into the initial physical attempt; raw/unrecognized provider strings move to protected legacy audit storage or halt. Never copy raw provider body/header into target columns. Unsupported historical platform rows must already be terminal before archive; pending/ambiguous rows halt.
7. Add `channel_identity_id`, `route_class`, `unknown_since`, narrowly named `unknown_reconcile_after/unknown_recovery_waves`, persisted Web topic fields and same-Person FKs as `NOT VALID`. Backfill only exact endpoint evidence; unprovable route is quarantined/non-sendable. Add physical attempts with `planned→claimed→terminal` lifecycle, per-target normal retry due, sticky-unknown finalizer, exact target-generation deferred guard, one-live planned/claimed index and evidence-bound reconciliation receipts. Remove/deprecate aggregate `deliveries.attempts`, generic singular delivery retry schedule and parent `provider_code`; the two retained parent fields own only bounded ambiguous-write waves, while attempts remain the sole normal retry/result authority.
8. Validate all FKs/CHECKs; set `route_class NOT NULL`. `unknown` forbids alternate fallback. Only evidence-bound reconcile may move unknown; tenant automatic recovery joins intent type and only `settled|correction` may consume bounded same-route retries. `security_alert` remains in DD-70 global attempt owner. Remove any staged `messenger_page_id` only after exact evidence; mismatch halts.
9. Cut over dispatcher+adapter together. Immediately before conditional `send_started_at`, re-read type-specific predicate: reminder `open|partial` + current policy; settled/correction exact unsuperseded source; owner alert current admin; announcement current capability/membership/opt-out; every route active/reachable/same-Person. Failure atomically sets attempt `cancelled/pre_send_invalidated`, intent/delivery `skipped` (or `expired` for TTL), cancels remaining planned work, writes no HTTP and never falls back; it does not fabricate provider output. Add cutover, concurrent-writer, target-generation, Retry-After, mixed-target and kill-after-start regressions.

### 2.2 Inbox + global plane 🟡 (DD-70 owner-final; target chưa implement)

```sql
-- GLOBAL PROTECTED. Không tenant_id. Không RLS (giống persons/person_follows)
-- nhưng cũng KHÔNG grant cho role `app` — chỉ SECURITY DEFINER functions.
-- CẤM tuyệt đối cột tiền/PII: không amount, không phone, không email,
-- không display_name bên thứ ba, không tenant name. (HR2)
CREATE TABLE person_notifications (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id    uuid NOT NULL REFERENCES persons(id),
  type         text NOT NULL
               CHECK (type IN ('follow_request','identity_link',
                               'identity_merged','security_alert')),
  subject_ref  uuid,          -- opaque: person_follows.id | link_codes.id | web_sessions.id
  -- Không i18n_key/i18n_params caller-supplied: fixed type → fixed system key;
  -- subject detail resolve từ authorized source tại read time.
  inbox_sequence bigint NOT NULL,             -- server trigger dưới fence, không từ caller
  source_event_id uuid NOT NULL,               -- canonical immutable protected source/audit UUID
  event_key    text NOT NULL UNIQUE,          -- idempotency
  event_key_version smallint NOT NULL CHECK (event_key_version > 0),
  event_at     timestamptz NOT NULL,           -- server/DB capture trước triggering mutation
  trigger_context_ref uuid,                    -- opaque session/recovery context; security only
  trigger_context_started_at timestamptz,      -- server-derived factor cutoff
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (inbox_sequence),
  UNIQUE (type, source_event_id),              -- structural replay fence across HMAC rotation
  CONSTRAINT person_notifications_event_time_chk CHECK (event_at <= created_at),
  CONSTRAINT person_notifications_security_context_chk CHECK (
    ((type = 'security_alert'
      AND trigger_context_ref IS NOT NULL
      AND trigger_context_started_at IS NOT NULL)
    OR (type <> 'security_alert'
      AND trigger_context_ref IS NULL
      AND trigger_context_started_at IS NULL))
    AND (trigger_context_started_at IS NULL OR trigger_context_started_at <= event_at)
  )
);
CREATE INDEX idx_person_notif_person ON person_notifications(person_id, inbox_sequence DESC);
-- Lưu ý: KHÔNG có CHECK "no self". `subject_ref` trỏ tới edge/token, KHÔNG phải
-- person id, nên so sánh subject_ref <> person_id là vô nghĩa. Ràng buộc no-self
-- thuộc về `person_follows` (DD-47 đã pin), không phải bảng notification.
-- KHÔNG có generic app-callable INSERT. Canonical protected follow/link/merge/auth
-- mutator gọi owner-only notif_append_global_from_source(source_kind,source_event_id)
-- trong cùng outer transaction; helper derive mọi field từ source đã lock.

-- Một sequence toàn cục cho uniqueness; per-Person fence mới là serialization owner.
CREATE SEQUENCE notification_inbox_sequence_seq;
CREATE TABLE notification_inbox_fences (
  person_id     uuid PRIMARY KEY REFERENCES persons(id),
  last_sequence bigint NOT NULL DEFAULT 0 CHECK (last_sequence >= 0)
);
-- BEFORE INSERT trigger function `notif_assign_inbox_sequence()` trên
-- notification_intents + person_notifications MUST be SECURITY DEFINER,
-- SET search_path = pg_catalog,<pinned_app_schema>, owned by the migration owner.
-- Nó luôn overwrite NEW.inbox_sequence: upsert/lock fence(person_id), nextval,
-- set NEW.inbox_sequence rồi update last_sequence. Caller-supplied value bị bỏ.
-- REVOKE ALL ON FUNCTION notif_assign_inbox_sequence() FROM PUBLIC, app;
-- Trigger vẫn chạy bằng owner privilege sau khi app bị revoke table/sequence access.
-- Cross-feature lock order is mandatory: create+lock every affected inbox
-- fence in native Person-UUID order first, then lock Person/source rows in their
-- documented deterministic order, then touch item/FK children. Fan-out, mark-all,
-- follow/link/auth emit and Person merge all use this fence-first hierarchy.

-- Trạng thái đọc cho CẢ hai plane. GLOBAL PROTECTED (khoá theo person).
-- source_kind='tenant' → source_id = notification_intents.id
-- source_kind='global' → source_id = person_notifications.id
-- KHÔNG FK cross-plane: FK từ bảng global tới bảng tenant-scoped tạo existence
-- oracle và kẹt RLS. Toàn vẹn do service + cleanup job đảm bảo.
CREATE TABLE notification_reads (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id   uuid NOT NULL REFERENCES persons(id),
  source_kind text NOT NULL CHECK (source_kind IN ('tenant','global')),
  source_id   uuid NOT NULL,
  read_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (person_id, source_kind, source_id)
);

-- Synchronous receipt cho read-all; boundary chỉ là audit/idempotency metadata,
-- KHÔNG phải read authority. Absence của notification_reads luôn nghĩa là unread.
CREATE TABLE notification_read_all_commands (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id         uuid NOT NULL REFERENCES persons(id),
  command_id        uuid NOT NULL,
  boundary_sequence bigint NOT NULL CHECK (boundary_sequence >= 0),
  state             text NOT NULL DEFAULT 'processing'
                    CHECK (state IN ('processing','completed')),
  creating_txid     bigint NOT NULL,       -- server txid_current(); finish must match
  plan_nonce        uuid NOT NULL,         -- server-generated; binds complete plane manifest
  tenant_manifest_hash text,
  expected_tenant_steps integer CHECK (expected_tenant_steps >= 0),
  completed_at      timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (person_id, command_id),
  CONSTRAINT nrac_state_shape_chk CHECK (
    (state = 'processing' AND completed_at IS NULL)
    OR (state = 'completed' AND tenant_manifest_hash IS NOT NULL
      AND expected_tenant_steps IS NOT NULL AND completed_at IS NOT NULL)
  )
);

-- No raw tenant id: plane_key is server HMAC of the global marker or exact
-- tenant-visibility capability JTI. Zero-item planes still write one step.
CREATE TABLE notification_read_all_plane_steps (
  command_receipt_id uuid NOT NULL REFERENCES notification_read_all_commands(id) ON DELETE CASCADE,
  plane_kind         text NOT NULL CHECK (plane_kind IN ('global','tenant')),
  plane_key          text NOT NULL,
  visible_item_count integer NOT NULL CHECK (visible_item_count >= 0),
  created_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (command_receipt_id, plane_kind, plane_key)
);

-- DEFERRABLE INITIALLY DEFERRED constraint trigger calls owner-only
-- notif_read_all_completion_guard(). At deferred execution it MUST re-SELECT
-- the current row by id (not inspect stale trigger NEW), and reject missing,
-- deleted or state<>'completed'. 'processing' is transaction-local only.
-- Completed boundary/plan/state and plane steps are immutable to runtime roles;
-- only the dedicated Person-merge path may re-parent a completed receipt.
```

**Producer boundary của option (a):** `source_kind` là closed enum. Helper fixed-search-path re-read exact locked canonical source (`person_follows`, `identity_audit_events`/`merge_audit`, hoặc `auth_audit_events`), derive recipient/type/subject/event time và deterministic versioned `event_key`; nó không nhận `person_id`, `type`, `subject_ref`, `event_at` hay copy từ caller. Follow chỉ emits `follow_request`; `follow_accepted` là analytics-only và private→public bulk auto-accept không tạo item. `link_code` consume chỉ tạo merge plan, không emit; confirmed link/merge dùng canonical audit time. Alertable auth audit captures its immutable timestamp **before** triggering email/device-trust mutation. Missing, mismatched hoặc non-terminal source fails closed. Trước khi lock Person/source row hoặc append, canonical follow/auth/link mutator phải gọi `notif_lock_inbox_fences_ordered()` cho mọi bounded potential recipient theo UUID tăng dần; sau đó mới lock Person/source rows và ghi item. Cấm đường Person/source→fence. Helper is owned by migration owner and explicitly revoked from `PUBLIC`, `app` and `app_worker`; only canonical SECURITY DEFINER mutators invoke it, so source change + item either both commit or both roll back. Live tenant `outbox_events.tenant_id NOT NULL` không phải global source; nếu future path không thể reorder, build HALT tới khi có GLOBAL PROTECTED source-event owner/grants/replay/retention contract riêng.

`POST /inbox/read-all` nhận `command_id` UUID để idempotency, **không** nhận timestamp/cursor/boundary. Read-only discovery không giữ blocking lock chạy ngoài mutation transaction; sau đó một bounded `READ COMMITTED` transaction (v1.71 — fence trước, mọi statement sau fence thấy state committed mới nhất):

1. derive Person từ verified actor capability; `notif_mark_all_begin(actor_cap,command_id)` (fixed-search-path `SECURITY DEFINER`) upsert/lock đúng fence **trước mọi Person/source/child lock** và giữ tới outer transaction commit. Receipt đã commit thì trả exact result và dừng; command mới capture server boundary rồi insert uncommitted `state='processing'`, `creating_txid=txid_current()` + random `plan_nonce`;
2. dưới authoritative snapshot đầu tiên sau khi fence đã giữ, canonical authorization service enumerate **toàn bộ** tenant plane còn authorize và global plane. Nó mint signed complete-plane manifest bind actor+Person+command+boundary+plan nonce + ordered HMAC keys của mọi tenant-visibility capability; `notif_mark_all_set_plan(actor_cap,command_id,manifest_cap)` verify rồi persist expected count/hash. Caller không tự khai tenant count/set;
3. global writer re-derive global visible set; mỗi tenant writer consume đúng one-time capability bind manifest+actor+tenant+visible source set+boundary. Mỗi writer set-wise insert `notification_reads` chỉ cho item đang visible với `inbox_sequence <= boundary`, rồi insert đúng một plane-step row **kể cả count=0**;
4. sau mọi plane write, **luôn** gọi `notif_mark_all_finish(actor_cap,command_id)` — kể cả toàn bộ visible set rỗng. Finalizer require row `processing`, same `creating_txid`, fence/plan nonce/boundary match, exactly one global step, và tenant step count + ordered-key hash đúng manifest; thiếu/thừa/duplicate step fail closed. Nó update chính row sang `completed` + `completed_at`;
5. commit receipt + plane steps + toàn bộ exact reads cùng nhau. DEFERRABLE completion trigger reject mọi attempt commit row còn `processing`, nên finish-before-begin, finish sai transaction, bỏ plane writer hoặc return sớm sau begin đều không thể tạo receipt giả. Trần 10k visible items/request; vượt trần, invalid capability/manifest hoặc bất kỳ plane/finalizer lỗi thì rollback toàn bộ.

Không connection nào vừa nhận raw global access vừa bypass tenant RLS. `processing` chỉ tồn tại trong transaction và không phải async/pending lifecycle; crash/early return rollback receipt/steps/reads, retry có thể chụp boundary mới. Exact replay chỉ chấp nhận row `completed`. Insert bắt đầu trước nhưng commit sau phải đợi fence, nhận sequence mới và vẫn unread; item hidden lúc mark-all không có read row nên khi re-authorize vẫn unread. `created_at` chỉ để hiển thị/audit, không phải order/read authority.

**Phương án (b) đã bị DD-70 loại:** không lưu bền global plane sẽ làm follow request mất khi followee offline. Giữ đoạn này chỉ làm rationale; implementation phải theo phương án (a), không được re-open trong build slice.

**Security-alert route theo DD-70(a):** narrow server/DB function capture immutable `event_at` **trước** triggering mutation và derive opaque `trigger_context_ref + trigger_context_started_at` từ locked web-session/recovery context, tạo `person_notifications(type='security_alert')` + global alert command trong cùng protected workflow; request/outbox không được khai các boundary này. UPDATE provenance/person/event fields sau insert bị immutable trigger reject. Dispatcher chỉ resolve email identity có `verified_at < trigger_context_started_at` hoặc Web Push subscription có `trusted_at < trigger_context_started_at`, với `trigger_context_started_at <= event_at`; factor được verify/trust sau khi triggering session/context bắt đầu bị loại dù xảy ra trước event. Forged/future/post-mutation/same-session provenance fail closed. Không tái dùng tenant `notification_deliveries`. Không trusted route vẫn giữ item + audit; auth-security slice phải pin exact global attempt owner/table + pre-change email lifecycle **trước migration/runtime enablement**.

### 2.3 Announcements + membership tags 🟡 (DD-43/DD-71 owner-final; chưa migration)

```sql
CREATE TABLE membership_tags (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tenants(id),
  name       text NOT NULL,
  name_norm  text NOT NULL,           -- BEFORE trigger derive từ name; API không được tự khai
  created_by uuid NOT NULL REFERENCES persons(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  retired_at timestamptz,             -- DB-owned soft delete; history/FKs stay stable
  UNIQUE (tenant_id, name_norm),
  CONSTRAINT membership_tags_id_tenant_uq UNIQUE (id, tenant_id),
  CONSTRAINT membership_tags_name_chk CHECK (
    octet_length(name) BETWEEN 1 AND 256
    AND name ~ '[^[:space:]]'
    AND name !~ E'[\x01-\x1F\x7F]'
  ),
  CONSTRAINT membership_tags_norm_chk CHECK (
    octet_length(name_norm) BETWEEN 1 AND 256 AND name_norm ~ '[^[:space:]]'
  )
);
-- Versioned normalize_membership_tag_name(): Unicode NFC, trim/collapse space,
-- locale-independent case-fold + pinned diacritic rule. BEFORE INSERT/UPDATE
-- luôn overwrite name_norm; direct/bypass write không thể chọn norm khác. Trigger
-- còn reject >64 grapheme clusters, bidi override/isolate code points và invalid
-- canonical UTF-8; mọi UI/provider render tag dưới plain-text escaping. DELETE API
-- calls narrow retire function: set retired_at once, hide from new links/criteria;
-- runtime app cannot hard-delete or reactivate. Hard purge waits NTF-OQ-16 retention.

-- Prerequisite cho composite FK dưới đây (memberships hiện CHƯA có ràng buộc này).
ALTER TABLE memberships ADD CONSTRAINT memberships_id_tenant_uq UNIQUE (id, tenant_id);
-- Prerequisite để optional announcement deep-link không trỏ session tenant khác.
ALTER TABLE sessions ADD CONSTRAINT sessions_id_tenant_uq UNIQUE (id, tenant_id);

CREATE TABLE membership_tag_links (
  membership_id uuid NOT NULL,
  tag_id        uuid NOT NULL,
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (membership_id, tag_id),
  -- Composite FK: tag và membership PHẢI cùng tenant. Chặn cả owner/bypass-RLS,
  -- không chỉ dựa RLS (cùng khuôn notification_deliveries→intents §2.1).
  CONSTRAINT mtl_tag_tenant_fk FOREIGN KEY (tag_id, tenant_id)
    REFERENCES membership_tags(id, tenant_id),
  CONSTRAINT mtl_membership_tenant_fk FOREIGN KEY (membership_id, tenant_id)
    REFERENCES memberships(id, tenant_id)
);
CREATE INDEX idx_mtl_tenant_tag ON membership_tag_links(tenant_id, tag_id);

CREATE TABLE announcements (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  body            text NOT NULL,              -- untrusted plain text; provider limit có thể thấp hơn
  session_ref     uuid,                      -- deep-link tuỳ chọn
  cta_kind        text NOT NULL DEFAULT 'none'
                  CHECK (cta_kind IN ('none','view_session')),
  status          text NOT NULL DEFAULT 'queued'
                  CHECK (status IN ('queued','dispatched','cancelled')),
  terminal_reason text CHECK (terminal_reason IN
                  ('host_cancelled','audience_empty','audience_tag_missing','audience_tag_retired',
                   'ttl_expired','preview_stale',
                   'authorization_revoked','tenant_inactive')),
  created_by      uuid NOT NULL REFERENCES persons(id),
  command_id      uuid NOT NULL,             -- client idempotency UUID (double submit)
  command_scope_key text NOT NULL UNIQUE,     -- server HMAC(tenant,actor,command); never client-supplied
  command_key_version smallint NOT NULL CHECK (command_key_version > 0),
  request_fingerprint text NOT NULL,          -- HMAC canonical confirm request; compare on replay
  request_key_version smallint NOT NULL CHECK (request_key_version > 0),
  preview_jti     uuid NOT NULL UNIQUE,       -- server-generated consume-once proof id
  preview_content_hash text NOT NULL,
  preview_audience_hash text NOT NULL,
  preview_web_count integer NOT NULL CHECK (preview_web_count >= 0),
  preview_zalo_count integer NOT NULL CHECK (preview_zalo_count >= 0),
  preview_messenger_count integer NOT NULL CHECK (preview_messenger_count >= 0),
  preview_unreachable_count integer NOT NULL CHECK (preview_unreachable_count >= 0),
  preview_recipient_count integer NOT NULL CHECK (preview_recipient_count > 0),
  preview_contract_version integer NOT NULL CHECK (preview_contract_version > 0),
  preview_routing_policy_version text NOT NULL CHECK (preview_routing_policy_version <> ''),
  previewed_at    timestamptz NOT NULL,
  preview_expires_at timestamptz NOT NULL,
  dispatch_web_count integer CHECK (dispatch_web_count >= 0),
  dispatch_zalo_count integer CHECK (dispatch_zalo_count >= 0),
  dispatch_messenger_count integer CHECK (dispatch_messenger_count >= 0),
  dispatch_unreachable_count integer CHECK (dispatch_unreachable_count >= 0),
  recipient_count integer CHECK (recipient_count >= 0),
  created_at      timestamptz NOT NULL DEFAULT now(),
  fanout_completed_at timestamptz,
  UNIQUE (tenant_id, created_by, command_id),
  CONSTRAINT announcements_id_tenant_uq UNIQUE (id, tenant_id),
  CONSTRAINT announcements_body_size_chk CHECK (octet_length(body) BETWEEN 1 AND 16384),
  -- API canonicalize CRLF/CR→LF trước insert; DB vẫn fail closed nếu caller bypass API.
  -- Cho phép TAB/LF đã normalize; cấm blank-only và các C0/DEL control còn lại.
  CONSTRAINT announcements_body_content_chk CHECK (
    body ~ '[^[:space:]]'
    AND body !~ E'[\x01-\x08\x0B-\x1F\x7F]'
  ),
  CONSTRAINT announcements_session_tenant_fk FOREIGN KEY (session_ref, tenant_id)
    REFERENCES sessions(id, tenant_id),
  CONSTRAINT announcements_cta_shape_chk CHECK (
    cta_kind <> 'view_session' OR session_ref IS NOT NULL
  ),
  CONSTRAINT announcements_preview_time_chk CHECK (
    previewed_at <= created_at AND created_at < preview_expires_at
  ),
  CONSTRAINT announcements_preview_count_sum_chk CHECK (
    preview_web_count + preview_zalo_count + preview_messenger_count
      + preview_unreachable_count = preview_recipient_count
  ),
  CONSTRAINT announcements_dispatched_shape_chk CHECK (
    (status = 'dispatched' AND recipient_count IS NOT NULL
      AND recipient_count > 0 AND fanout_completed_at IS NOT NULL
      AND dispatch_web_count IS NOT NULL AND dispatch_zalo_count IS NOT NULL
      AND dispatch_messenger_count IS NOT NULL AND dispatch_unreachable_count IS NOT NULL)
    OR (status = 'queued' AND recipient_count IS NULL AND fanout_completed_at IS NULL
      AND dispatch_web_count IS NULL AND dispatch_zalo_count IS NULL
      AND dispatch_messenger_count IS NULL AND dispatch_unreachable_count IS NULL)
    OR (status = 'cancelled' AND recipient_count = 0 AND fanout_completed_at IS NULL
      AND dispatch_web_count IS NOT NULL AND dispatch_web_count = 0
      AND dispatch_zalo_count IS NOT NULL AND dispatch_zalo_count = 0
      AND dispatch_messenger_count IS NOT NULL AND dispatch_messenger_count = 0
      AND dispatch_unreachable_count IS NOT NULL AND dispatch_unreachable_count = 0)
  ),
  CONSTRAINT announcements_dispatch_count_sum_chk CHECK (
    status <> 'dispatched'
    OR dispatch_web_count + dispatch_zalo_count + dispatch_messenger_count
         + dispatch_unreachable_count = recipient_count
  ),
  CONSTRAINT announcements_dispatch_not_above_preview_chk CHECK (
    status <> 'dispatched'
    OR (dispatch_web_count <= preview_web_count
      AND dispatch_zalo_count <= preview_zalo_count
      AND dispatch_messenger_count <= preview_messenger_count
      AND dispatch_unreachable_count <= preview_unreachable_count
      AND recipient_count <= preview_recipient_count)
  ),
  CONSTRAINT announcements_terminal_shape_chk CHECK (
    (status = 'cancelled' AND terminal_reason IS NOT NULL)
    OR (status <> 'cancelled' AND terminal_reason IS NULL)
  )
);
-- draft/previewed KHÔNG có trong CHECK và chưa có announcement row, nhưng preview
-- phát signed opaque proof. Confirm verify signature/expiry/session actor/tenant,
-- recompute content(body+session_ref+CTA)+criteria hashes/vector/route versions,
-- rồi INSERT preview_jti
-- UNIQUE trong cùng tx.
-- Dispatch re-runs the SAME check over a consistent snapshot BEFORE any intent;
-- increase/drift => cancelled/preview_stale với mọi dispatch count = 0.
-- App không có direct INSERT/UPDATE/DELETE. Narrow confirm/cancel/retry/dispatch
-- functions là writers duy nhất. Immutable trigger cho announcements chỉ cho phép
-- state-machine fields {status,terminal_reason,dispatch_*_count,recipient_count,
-- fanout_completed_at} đổi qua narrow function; mọi content/proof/actor/command/
-- preview field UPDATE/DELETE bị reject. Audience + audience-tag criteria cũng
-- immutable sau confirm; dispatcher re-hash content + criteria trước mọi intent.

-- Durable owner cho atomic tenant+actor+fan-out quota reservation. Confirm
-- inserts reservation + announcement and commits both or neither. `reserved`
-- may exist only inside that transaction; deferred constraint trigger rejects a
-- committed transaction that leaves it without the matching announcement.
CREATE TABLE announcement_quota_reservations (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               uuid NOT NULL REFERENCES tenants(id),
  announcement_id         uuid,
  created_by              uuid NOT NULL REFERENCES persons(id),
  command_id              uuid NOT NULL,
  preview_jti             uuid NOT NULL,
  reservation_key         text NOT NULL UNIQUE,
  reservation_key_version smallint NOT NULL CHECK (reservation_key_version > 0),
  tenant_command_units    smallint NOT NULL CHECK (tenant_command_units = 1),
  actor_command_units     smallint NOT NULL CHECK (actor_command_units = 1),
  fanout_recipient_units  integer NOT NULL CHECK (fanout_recipient_units > 0),
  status                  text NOT NULL CHECK (status IN ('reserved','committed','released')),
  reserved_at             timestamptz NOT NULL DEFAULT now(),
  quota_window_expires_at timestamptz NOT NULL,
  released_at             timestamptz,
  release_reason          text CHECK (release_reason IN ('canonical_absent_after_grace','operator_repair')),
  UNIQUE (tenant_id, created_by, command_id),
  UNIQUE (tenant_id, preview_jti),
  UNIQUE (announcement_id),
  CONSTRAINT aqr_announcement_tenant_fk FOREIGN KEY (announcement_id, tenant_id)
    REFERENCES announcements(id, tenant_id) DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT aqr_time_chk CHECK (reserved_at < quota_window_expires_at),
  CONSTRAINT aqr_status_shape_chk CHECK (
    (status = 'committed' AND announcement_id IS NOT NULL
      AND released_at IS NULL AND release_reason IS NULL)
    OR (status = 'released' AND announcement_id IS NULL
      AND released_at IS NOT NULL AND release_reason IS NOT NULL)
    OR (status = 'reserved' AND announcement_id IS NULL
      AND released_at IS NULL AND release_reason IS NULL)
  )
);
CREATE INDEX aqr_committed_tenant_window_idx
  ON announcement_quota_reservations(tenant_id, quota_window_expires_at)
  WHERE status = 'committed';
CREATE INDEX aqr_committed_actor_window_idx
  ON announcement_quota_reservations(tenant_id, created_by, quota_window_expires_at)
  WHERE status = 'committed';

CREATE TABLE announcement_audiences (
  announcement_id uuid PRIMARY KEY,
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  mode            text NOT NULL CHECK (mode IN ('all','any_tag','all_tags')),
  include_guests  boolean NOT NULL DEFAULT false,   -- NTF-OQ-10
  CONSTRAINT announcement_audiences_id_tenant_uq UNIQUE (announcement_id, tenant_id),
  CONSTRAINT aa_announcement_tenant_fk FOREIGN KEY (announcement_id, tenant_id)
    REFERENCES announcements(id, tenant_id)
);

-- Normalize tag set: uuid[] không thể enforce FK/cùng tenant.
CREATE TABLE announcement_audience_tags (
  announcement_id uuid NOT NULL,
  tag_id           uuid NOT NULL,
  tenant_id        uuid NOT NULL REFERENCES tenants(id),
  PRIMARY KEY (announcement_id, tag_id),
  CONSTRAINT aat_audience_tenant_fk FOREIGN KEY (announcement_id, tenant_id)
    REFERENCES announcement_audiences(announcement_id, tenant_id),
  CONSTRAINT aat_tag_tenant_fk FOREIGN KEY (tag_id, tenant_id)
    REFERENCES membership_tags(id, tenant_id)
);
CREATE INDEX idx_aat_tenant_tag ON announcement_audience_tags(tenant_id, tag_id);

-- DEFERRABLE constraint trigger (chạy cuối transaction) bắt buộc:
--   mode='all'                  ⇔ 0 row announcement_audience_tags
--   mode IN ('any_tag','all_tags') ⇔ >=1 row
-- Vì invariant băng qua hai bảng nên CHECK đơn bảng không diễn tả được.

-- Preference chỉ cho broadcast announcement, per membership/tenant.
-- Không có row hợp lệ cho reminder/settled/correction nên user không thể opt-out tiền.
CREATE TABLE membership_notification_preferences (
  membership_id uuid NOT NULL,
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  type          text NOT NULL CHECK (type = 'announcement'),
  opted_out     boolean NOT NULL DEFAULT false,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (membership_id, type),
  CONSTRAINT mnp_membership_tenant_fk FOREIGN KEY (membership_id, tenant_id)
    REFERENCES memberships(id, tenant_id)
);

-- Synchronous receipt/structural owner cho retry-failed actor-scoped command.
-- Receipt và mọi route CAS commit cùng nhau; crash rollback toàn bộ.
CREATE TABLE announcement_retry_commands (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               uuid NOT NULL REFERENCES tenants(id),
  announcement_id         uuid NOT NULL,
  created_by              uuid NOT NULL REFERENCES persons(id),
  command_id              uuid NOT NULL,
  command_scope_key       text NOT NULL UNIQUE,
  command_key_version     smallint NOT NULL CHECK (command_key_version > 0),
  request_fingerprint     text NOT NULL,
  request_key_version     smallint NOT NULL CHECK (request_key_version > 0),
  retried_recipient_count integer NOT NULL CHECK (retried_recipient_count >= 0),
  skipped_recipient_count integer NOT NULL CHECK (skipped_recipient_count >= 0),
  created_at              timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, created_by, command_id),
  CONSTRAINT arc_id_tenant_uq UNIQUE (id, tenant_id),
  CONSTRAINT arc_id_tenant_announcement_uq UNIQUE (id, tenant_id, announcement_id),
  CONSTRAINT arc_announcement_tenant_fk FOREIGN KEY (announcement_id, tenant_id)
    REFERENCES announcements(id, tenant_id)
);

-- Exact per-intent selection/result receipt. Multiple historical failed routes
-- are ranked by current canonical route policy; delivery UUID is the final tie-break.
CREATE TABLE announcement_retry_command_items (
  retry_command_id    uuid NOT NULL,
  tenant_id           uuid NOT NULL REFERENCES tenants(id),
  announcement_id     uuid NOT NULL,
  intent_id           uuid NOT NULL,
  intent_type         text NOT NULL DEFAULT 'announcement' CHECK (intent_type = 'announcement'),
  selected_delivery_id uuid,
  result              text NOT NULL CHECK (result IN ('retried','skipped')),
  skip_reason         text CHECK (skip_reason IN ('active_outcome_exists','recipient_ineligible',
                                                   'authorization_revoked','preference_opted_out',
                                                   'no_reachable_failed_route','announcement_expired')),
  created_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (retry_command_id, intent_id),
  CONSTRAINT arci_command_announcement_fk
    FOREIGN KEY (retry_command_id, tenant_id, announcement_id)
    REFERENCES announcement_retry_commands(id, tenant_id, announcement_id),
  CONSTRAINT arci_intent_announcement_fk
    FOREIGN KEY (intent_id, tenant_id, intent_type, announcement_id)
    REFERENCES notification_intents(id, tenant_id, type, aggregate_id),
  CONSTRAINT arci_delivery_intent_fk
    FOREIGN KEY (selected_delivery_id, tenant_id, intent_id)
    REFERENCES notification_deliveries(id, tenant_id, intent_id),
  CONSTRAINT arci_result_shape_chk CHECK (
    (result = 'retried' AND selected_delivery_id IS NOT NULL AND skip_reason IS NULL)
    OR (result = 'skipped' AND selected_delivery_id IS NULL AND skip_reason IS NOT NULL)
  )
);
```

Tất cả bảng §2.3: `ENABLE` + `FORCE ROW LEVEL SECURITY`, policy theo `app.tenant_id`. `REVOKE INSERT, UPDATE, DELETE` trực tiếp trên `membership_tags`, `membership_tag_links`, `membership_notification_preferences`, `announcements`, `announcement_audiences`, `announcement_audience_tags`, `announcement_quota_reservations`, `announcement_retry_commands`, `announcement_retry_command_items` khỏi `PUBLIC, app`. Capability-bound tag writers, Person-self preference writer và narrow confirm/cancel/retry/dispatch functions là writers duy nhất; generic app DML không thể sửa tag hay opt-out của member khác. Mỗi exact function signature phải revoke PUBLIC/app rồi targeted grant; CI introspects `proacl`. Confirm locks collision-safe tenant/actor/fan-out bucket keys, counts unexpired committed reservations, then inserts reservation+announcement atomically. DEFERRABLE matching guard requires reservation `tenant_id/created_by/command_id/preview_jti` equal canonical announcement and `fanout_recipient_units = preview_recipient_count`; `UNIQUE(announcement_id)` blocks double attachment. Another deferred guard rejects persisted `reserved`; janitor releases only after proof expiry+grace and DB proof canonical announcement absent.

**Owner-final target extension của §C (chưa có migration/runtime):** `notification_intents` với `type='announcement'`, `aggregate_id = announcements.id`, structural source event = announcement id/person và versioned server intent key. Fan-out hoàn tất chỉ đổi announcement sang `dispatched`. Routed outcomes derive từ deliveries/latest attempts; no-route recipient has canonical skipped intent. `announcement_retry_commands` + items là synchronous receipt: composite FKs prove each item belongs to the command's exact announcement and selected delivery belongs to that same intent. DEFERRABLE completion guard requires parent retry/skipped counts equal exact item result counts. Exact replay returns stored results; mismatch rejects before mutation. Retry filters fresh-authorized terminal routes, ranks current policy+delivery UUID and persists selection before CAS. Retry window ends at canonical `announcements.created_at + 24h`; after boundary every item records `announcement_expired` and no send, so host must create a new preview/announcement. Không caller/worker tự chọn recipient/platform.

Retry request không nhận caller-selected recipient set. `request_fingerprint = HMAC(domain='announcement-retry-request', canonical_json([tenant_id,actor_id,announcement_id,'retry_failed',contract_version]))` + key version; `command_scope_key` domain-separate tenant+actor+client command UUID. Same command trên announcement/action/version khác trả `IDEMPOTENCY_KEY_REUSED`; rotation dual-read by stored version rồi backfill, không tạo receipt thứ hai.

### 2.4 Push subscriptions + telemetry 🟡 (DD-72 owner-final; target chưa implement)

```sql
-- Singleton serialization owner cho endpoint-HMAC cutover. Registration giữ
-- FOR SHARE từ lúc validate envelope tới commit; rotation giữ FOR UPDATE qua
-- active-version cutover. accepted_read_versions do owner-only rotation function
-- ghi sorted+unique; active_write_version phải nằm trong tập đó.
CREATE TABLE push_subscription_lookup_key_epoch (
  singleton              boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  epoch                  bigint NOT NULL CHECK (epoch > 0),
  active_write_version   smallint NOT NULL CHECK (active_write_version > 0),
  accepted_read_versions smallint[] NOT NULL,
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CHECK (cardinality(accepted_read_versions) > 0),
  CHECK (active_write_version = ANY(accepted_read_versions))
);

-- Owner-controlled abuse ceiling; registration locks actor advisory key then
-- counts active rows. Initial target 10 Web subscriptions/Person, configurable
-- downward/upward only through audited ops policy (hard ceiling 20).
CREATE TABLE push_subscription_limits (
  singleton                 boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  max_active_web_per_person smallint NOT NULL DEFAULT 10
                            CHECK (max_active_web_per_person BETWEEN 1 AND 20),
  updated_at                timestamptz NOT NULL DEFAULT now()
);

-- GLOBAL PROTECTED. Không tenant_id (subscription thuộc person/thiết bị).
-- DD-72 chỉ chốt Web Push phase-1. Native shape/provider chờ DD-69 spike và
-- chỉ được thêm bằng migration monotonic sau khi protocol/app/environment đã pin.
CREATE TABLE device_push_subscriptions (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id            uuid NOT NULL REFERENCES persons(id),
  kind                 text NOT NULL CHECK (kind = 'web'),
  platform             text NOT NULL CHECK (platform IN ('ios','android','desktop','unknown')),
  endpoint_enc         bytea NOT NULL,   -- KMS-encrypted push endpoint
  endpoint_lookup_hash text NOT NULL,    -- keyed HMAC, dedupe/lookup (khuôn DD-67)
  endpoint_lookup_key_version smallint NOT NULL CHECK (endpoint_lookup_key_version > 0),
  encryption_key_version smallint NOT NULL CHECK (encryption_key_version > 0),
  p256dh_enc           bytea NOT NULL,
  auth_enc             bytea NOT NULL,
  installed            boolean NOT NULL DEFAULT false,  -- PWA add-to-home-screen
  user_agent_class     text NOT NULL DEFAULT 'unknown'
                       CHECK (user_agent_class IN ('chromium','safari','firefox','other','unknown')),
                                         -- enum thô; KHÔNG raw UA (chống fingerprint)
  status               text NOT NULL DEFAULT 'active'
                       CHECK (status IN ('active','stale','revoked')),
  trusted_at           timestamptz,        -- NULL khi mới register; security route cần < trigger_context_started_at
  trust_source         text CHECK (trust_source IN ('preexisting_trusted_device_approval',
                                                     'verified_email_reauth','manual_recovery')),
  trust_epoch          bigint NOT NULL DEFAULT 0 CHECK (trust_epoch >= 0),
  stale_at             timestamptz,
  revoked_at           timestamptz,
  last_success_at      timestamptz,
  failure_count        integer NOT NULL DEFAULT 0 CHECK (failure_count >= 0),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (endpoint_lookup_hash),
  CONSTRAINT dps_id_person_uq UNIQUE (id, person_id),
  CONSTRAINT dps_trust_shape_chk CHECK ((trusted_at IS NULL) = (trust_source IS NULL)),
  CONSTRAINT dps_trusted_time_chk CHECK (trusted_at IS NULL OR trusted_at >= created_at),
  CONSTRAINT dps_lifecycle_time_chk CHECK (
    updated_at >= created_at
    AND (stale_at IS NULL OR stale_at >= created_at)
    AND (revoked_at IS NULL OR revoked_at >= created_at)
    AND (last_success_at IS NULL OR last_success_at >= created_at)
    AND (stale_at IS NULL OR revoked_at IS NULL OR revoked_at >= stale_at)
    AND (trusted_at IS NULL OR trusted_at <= updated_at)
    AND (stale_at IS NULL OR stale_at <= updated_at)
    AND (revoked_at IS NULL OR revoked_at <= updated_at)
    AND (last_success_at IS NULL OR last_success_at <= updated_at)
  ),
  CONSTRAINT dps_status_time_chk CHECK (
    (status = 'active' AND stale_at IS NULL AND revoked_at IS NULL)
    OR (status = 'stale' AND stale_at IS NOT NULL AND revoked_at IS NULL)
    OR (status = 'revoked' AND revoked_at IS NOT NULL)
  )
);
CREATE INDEX idx_dps_person_active ON device_push_subscriptions(person_id)
  WHERE status = 'active';

-- Runtime roles have no direct UPDATE. Owner-only transition functions capture
-- one transaction_timestamp() and ignore/reject caller clocks. Mark-stale/revoke/
-- success set their DB-owned timestamp monotonically. A newly accepted same-Person
-- registration may reactivate stale/revoked → active, clearing stale_at/revoked_at,
-- failure_count and trust while incrementing trust_epoch exactly once.

-- Durable issuer/evidence owner for cross-Person rebind proof. Knowing a leaked
-- endpoint is never proof. Phase-1 accepts only verified prior-owner reauth or
-- audited manual-recovery evidence. Prior-owner reauth is canonical one-time auth
-- evidence from the subscription's current owner and binds current owner, requester,
-- target, alias digest, epoch, command and expiry/JTI. Person/account merge is a
-- separate ownership-reparent lifecycle and cannot authorize rebind. Web Push
-- p256dh/auth are encryption material, not an SW signing key, so this contract never
-- invents a client-signature capability.
CREATE TABLE push_subscription_rebind_challenges (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge_jti           uuid NOT NULL UNIQUE,
  requester_person_id     uuid NOT NULL REFERENCES persons(id),
  requester_person_ref    uuid NOT NULL,       -- immutable historical requester; no FK
  current_owner_person_ref uuid NOT NULL,       -- immutable historical opaque ref; no FK
  target_subscription_ref uuid NOT NULL,        -- immutable historical opaque ref; no FK
  endpoint_alias_set_hash text NOT NULL,
  target_trust_epoch      bigint NOT NULL CHECK (target_trust_epoch >= 0),
  external_command_id     uuid NOT NULL,
  evidence_kind           text NOT NULL CHECK (evidence_kind IN
                            ('verified_prior_owner_reauth','manual_recovery')),
  evidence_ref            uuid UNIQUE,
  proof_jti               uuid UNIQUE,
  proof_fingerprint       text,
  proof_key_version       smallint CHECK (proof_key_version > 0),
  state                   text NOT NULL CHECK (state IN
                            ('pending','acknowledged','consumed','expired','invalidated')),
  requested_at            timestamptz NOT NULL DEFAULT now(),
  acknowledged_at         timestamptz,
  expires_at              timestamptz NOT NULL,
  consumed_at             timestamptz,
  expired_at              timestamptz,
  invalidated_at          timestamptz,
  invalidation_reason     text CHECK (invalidation_reason IN
                            ('person_merge','owner_or_epoch_changed','evidence_revoked')),
  CHECK (requester_person_ref <> current_owner_person_ref),
  CHECK (requested_at < expires_at),
  UNIQUE (requester_person_ref, external_command_id),
  CHECK (acknowledged_at IS NULL OR
    (acknowledged_at >= requested_at AND acknowledged_at < expires_at)),
  CHECK (consumed_at IS NULL OR
    (acknowledged_at IS NOT NULL AND consumed_at >= acknowledged_at AND consumed_at < expires_at)),
  CHECK (expired_at IS NULL OR expired_at >= expires_at),
  CHECK (invalidated_at IS NULL OR invalidated_at >= requested_at),
  CONSTRAINT psrc_proof_scope_uq UNIQUE
    (proof_jti, evidence_ref, proof_fingerprint, proof_key_version,
     requester_person_ref, current_owner_person_ref, target_subscription_ref,
     endpoint_alias_set_hash, target_trust_epoch, external_command_id, expires_at),
  CONSTRAINT psrc_state_shape_chk CHECK (
    (state = 'pending' AND proof_jti IS NULL AND evidence_ref IS NULL
      AND proof_fingerprint IS NULL AND proof_key_version IS NULL
      AND acknowledged_at IS NULL AND consumed_at IS NULL AND expired_at IS NULL
      AND invalidated_at IS NULL AND invalidation_reason IS NULL)
    OR (state = 'acknowledged' AND proof_jti IS NOT NULL AND evidence_ref IS NOT NULL
      AND proof_fingerprint IS NOT NULL AND proof_key_version IS NOT NULL
      AND acknowledged_at IS NOT NULL AND consumed_at IS NULL AND expired_at IS NULL
      AND invalidated_at IS NULL AND invalidation_reason IS NULL)
    OR (state = 'consumed' AND proof_jti IS NOT NULL AND evidence_ref IS NOT NULL
      AND proof_fingerprint IS NOT NULL AND proof_key_version IS NOT NULL
      AND acknowledged_at IS NOT NULL AND consumed_at IS NOT NULL AND expired_at IS NULL
      AND invalidated_at IS NULL AND invalidation_reason IS NULL)
    OR (state = 'expired' AND consumed_at IS NULL AND expired_at IS NOT NULL
      AND invalidated_at IS NULL AND invalidation_reason IS NULL
      AND ((proof_jti IS NULL AND evidence_ref IS NULL AND proof_fingerprint IS NULL
            AND proof_key_version IS NULL AND acknowledged_at IS NULL)
        OR (proof_jti IS NOT NULL AND evidence_ref IS NOT NULL
            AND proof_fingerprint IS NOT NULL AND proof_key_version IS NOT NULL
            AND acknowledged_at IS NOT NULL)))
    OR (state = 'invalidated' AND consumed_at IS NULL AND expired_at IS NULL
      AND invalidated_at IS NOT NULL AND invalidation_reason IS NOT NULL
      AND ((proof_jti IS NULL AND evidence_ref IS NULL AND proof_fingerprint IS NULL
            AND proof_key_version IS NULL AND acknowledged_at IS NULL)
        OR (proof_jti IS NOT NULL AND evidence_ref IS NOT NULL
            AND proof_fingerprint IS NOT NULL AND proof_key_version IS NOT NULL
            AND acknowledged_at IS NOT NULL)))
  )
);

-- Owner-only BEFORE INSERT guard requires requester_person_id=requester_person_ref
-- and current owner/target/alias/epoch/command to match the re-read subscription.
-- Immutable scope/proof/time fields cannot UPDATE. Narrow request/owner-evidence/
-- consume/expire
-- functions own the only legal state transitions; merge invalidates every unconsumed
-- challenge touching source/survivor, then may reparent only live requester_person_id
-- for consumed audit while immutable requester/current-owner/target refs stay fixed.

-- Durable owner cho consume/result của registration envelope. Không lưu endpoint,
-- key material, ciphertext, trust field hay arbitrary response JSON.
CREATE TABLE push_subscription_registration_receipts (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  envelope_jti            uuid NOT NULL UNIQUE,
  actor_person_id         uuid NOT NULL REFERENCES persons(id),
  actor_person_ref        uuid NOT NULL, -- immutable historical actor; no FK
  command_id              uuid NOT NULL, -- required external Idempotency-Key
  action                  text NOT NULL CHECK (action IN ('register','rebind')),
  ownership_proof_jti     uuid UNIQUE,   -- one-time cross-Person rebind proof
  ownership_proof_expires_at timestamptz,
  ownership_evidence_ref  uuid UNIQUE,
  ownership_proof_fingerprint text,
  ownership_proof_key_version smallint CHECK (ownership_proof_key_version > 0),
  prior_subscription_ref  uuid,
  prior_owner_person_ref  uuid,
  prior_trust_epoch       bigint CHECK (prior_trust_epoch >= 0),
  endpoint_alias_set_hash text,
  request_fingerprint     text NOT NULL,
  request_key_version     smallint NOT NULL CHECK (request_key_version > 0),
  result_code             text NOT NULL
                          CHECK (result_code IN ('registered','rebound','ownership_conflict')),
  subscription_id         uuid,
  response_subscription_ref uuid,        -- fixed opaque result; intentionally no FK for prune/rebind history
  response_platform       text CHECK (response_platform IN ('ios','android','desktop','unknown')),
  response_installed      boolean,
  response_status         text CHECK (response_status IN ('active','stale','revoked')),
  envelope_expires_at     timestamptz NOT NULL,
  created_at              timestamptz NOT NULL DEFAULT now(),
  UNIQUE (actor_person_id, command_id),
  CONSTRAINT psrr_rebind_proof_scope_fk FOREIGN KEY
    (ownership_proof_jti, ownership_evidence_ref, ownership_proof_fingerprint,
     ownership_proof_key_version, actor_person_ref, prior_owner_person_ref,
     prior_subscription_ref, endpoint_alias_set_hash, prior_trust_epoch,
     command_id, ownership_proof_expires_at)
    REFERENCES push_subscription_rebind_challenges
    (proof_jti, evidence_ref, proof_fingerprint, proof_key_version,
     requester_person_ref, current_owner_person_ref, target_subscription_ref,
     endpoint_alias_set_hash, target_trust_epoch, external_command_id, expires_at),
  CONSTRAINT psrr_subscription_person_fk
    FOREIGN KEY (subscription_id, actor_person_id)
    REFERENCES device_push_subscriptions(id, person_id)
    ON DELETE SET NULL (subscription_id)
    DEFERRABLE INITIALLY IMMEDIATE,
  CONSTRAINT psrr_live_ref_chk CHECK (
    subscription_id IS NULL OR subscription_id = response_subscription_ref
  ),
  CONSTRAINT psrr_action_result_shape_chk CHECK (
    (action = 'register'
      AND ownership_proof_jti IS NULL
      AND ownership_proof_expires_at IS NULL
      AND ownership_evidence_ref IS NULL
      AND ownership_proof_fingerprint IS NULL
      AND ownership_proof_key_version IS NULL
      AND prior_subscription_ref IS NULL
      AND prior_owner_person_ref IS NULL
      AND prior_trust_epoch IS NULL
      AND endpoint_alias_set_hash IS NULL
      AND result_code IN ('registered','ownership_conflict'))
    OR (action = 'rebind'
      AND ownership_proof_jti IS NOT NULL
      AND ownership_proof_expires_at IS NOT NULL
      AND ownership_evidence_ref IS NOT NULL
      AND ownership_proof_fingerprint IS NOT NULL
      AND ownership_proof_key_version IS NOT NULL
      AND prior_subscription_ref IS NOT NULL
      AND prior_owner_person_ref IS NOT NULL
      AND prior_trust_epoch IS NOT NULL
      AND endpoint_alias_set_hash IS NOT NULL
      AND result_code = 'rebound')
  ),
  CONSTRAINT psrr_result_shape_chk CHECK (
    (result_code IN ('registered','rebound')
      AND response_subscription_ref IS NOT NULL
      AND response_platform IS NOT NULL
      AND response_installed IS NOT NULL
      AND response_status IS NOT NULL)
    OR (result_code = 'ownership_conflict'
      AND subscription_id IS NULL
      AND response_subscription_ref IS NULL
      AND response_platform IS NULL
      AND response_installed IS NULL
      AND response_status IS NULL)
  ),
  CONSTRAINT psrr_rebind_result_chk CHECK (
    action <> 'rebind' OR
      (response_status = 'active'
       AND prior_subscription_ref <> response_subscription_ref)
  ),
  CONSTRAINT psrr_success_active_chk CHECK (
    result_code NOT IN ('registered','rebound') OR response_status = 'active'
  ),
  CONSTRAINT psrr_expiry_chk CHECK (
    created_at < envelope_expires_at
    AND (ownership_proof_expires_at IS NULL
      OR created_at < ownership_proof_expires_at)
  )
);

-- Owner-only function re-reads both tables at COMMIT. A consumed challenge must
-- have exactly one matching action='rebind'/result='rebound' receipt whose live
-- pointer is the newly inserted same-Person subscription; that receipt requires
-- the challenge to be consumed. pending/acknowledged/expired/invalidated require
-- zero receipts. This makes delete-old + insert-new + receipt + consume all-or-nothing.
CREATE CONSTRAINT TRIGGER psrr_rebind_completion_from_receipt
AFTER INSERT OR UPDATE OR DELETE ON push_subscription_registration_receipts
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
EXECUTE FUNCTION push_sub_rebind_completion_guard();
CREATE CONSTRAINT TRIGGER psrr_rebind_completion_from_challenge
AFTER INSERT OR UPDATE OR DELETE ON push_subscription_rebind_challenges
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
EXECUTE FUNCTION push_sub_rebind_completion_guard();

-- Durable issuance owner cho one-time trust proof. Generic app cannot mint rows.
-- verified-email/manual paths re-read canonical auth/recovery audit; device approval
-- is a distinct same-Person pre-trusted-device challenge/ack, never a rebind proof.
CREATE TABLE push_subscription_trust_proof_issuances (
  proof_jti               uuid PRIMARY KEY,
  person_id               uuid NOT NULL REFERENCES persons(id),
  target_subscription_ref uuid NOT NULL,
  target_trust_epoch      bigint NOT NULL CHECK (target_trust_epoch >= 0),
  trust_source            text NOT NULL CHECK (trust_source IN
                            ('preexisting_trusted_device_approval',
                             'verified_email_reauth','manual_recovery')),
  source_subscription_ref uuid,
  evidence_ref            uuid NOT NULL UNIQUE,
  proof_fingerprint       text NOT NULL,
  proof_key_version       smallint NOT NULL CHECK (proof_key_version > 0),
  state                   text NOT NULL CHECK (state IN ('issued','consumed','expired')),
  issued_at               timestamptz NOT NULL DEFAULT now(),
  expires_at              timestamptz NOT NULL,
  consumed_at             timestamptz,
  UNIQUE (person_id, evidence_ref),
  CHECK (issued_at < expires_at),
  CHECK (
    (trust_source = 'preexisting_trusted_device_approval'
      AND source_subscription_ref IS NOT NULL
      AND source_subscription_ref <> target_subscription_ref)
    OR (trust_source IN ('verified_email_reauth','manual_recovery')
      AND source_subscription_ref IS NULL)
  ),
  CHECK (
    (state = 'issued' AND consumed_at IS NULL)
    OR (state = 'consumed' AND consumed_at IS NOT NULL AND consumed_at < expires_at)
    OR (state = 'expired' AND consumed_at IS NULL)
  )
);

-- One-time proof receipt + audit cho trust elevation. evidence_ref là opaque id
-- của canonical auth/recovery audit; không chứa email/PII/proof bearer.
CREATE TABLE push_subscription_trust_events (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proof_jti              uuid NOT NULL UNIQUE,
  person_id              uuid NOT NULL REFERENCES persons(id),
  subscription_id        uuid,
  target_subscription_ref uuid NOT NULL, -- immutable historical target id; no FK
  trust_epoch            bigint NOT NULL CHECK (trust_epoch > 0),
  trust_source           text NOT NULL
                         CHECK (trust_source IN ('preexisting_trusted_device_approval',
                                                 'verified_email_reauth','manual_recovery')),
  source_subscription_id uuid,
  source_subscription_ref uuid,             -- immutable historical source id; no FK
  evidence_ref           uuid NOT NULL UNIQUE,
  proof_fingerprint      text NOT NULL,
  proof_key_version      smallint NOT NULL CHECK (proof_key_version > 0),
  proof_expires_at       timestamptz NOT NULL,
  trusted_at             timestamptz NOT NULL,
  created_at             timestamptz NOT NULL,
  UNIQUE (target_subscription_ref, trust_epoch),
  CONSTRAINT pste_issuance_fk FOREIGN KEY (proof_jti)
    REFERENCES push_subscription_trust_proof_issuances(proof_jti),
  CONSTRAINT pste_target_person_fk
    FOREIGN KEY (subscription_id, person_id)
    REFERENCES device_push_subscriptions(id, person_id)
    ON DELETE SET NULL (subscription_id)
    DEFERRABLE INITIALLY IMMEDIATE,
  CONSTRAINT pste_source_person_fk
    FOREIGN KEY (source_subscription_id, person_id)
    REFERENCES device_push_subscriptions(id, person_id)
    ON DELETE SET NULL (source_subscription_id)
    DEFERRABLE INITIALLY IMMEDIATE,
  CONSTRAINT pste_target_live_ref_chk CHECK (
    subscription_id IS NULL OR subscription_id = target_subscription_ref
  ),
  CONSTRAINT pste_source_live_ref_chk CHECK (
    source_subscription_id IS NULL OR source_subscription_id = source_subscription_ref
  ),
  CONSTRAINT pste_source_shape_chk CHECK (
    (trust_source = 'preexisting_trusted_device_approval'
      AND source_subscription_ref IS NOT NULL
      AND source_subscription_ref <> target_subscription_ref)
    OR (trust_source IN ('verified_email_reauth','manual_recovery')
      AND source_subscription_id IS NULL
      AND source_subscription_ref IS NULL)
  ),
  CONSTRAINT pste_time_chk CHECK (
    trusted_at = created_at AND created_at < proof_expires_at
  )
);

-- Owner-only fixed-search-path BEFORE INSERT guard (runtime roles have no DML):
-- requires actor_person_id=actor_person_ref at receipt creation and successful
-- registration/rebind receipt requires subscription_id non-null;
-- trust event requires subscription_id non-null and device-approval also requires
-- source_subscription_id non-null at creation. Later secret-row DELETE may set
-- those live pointers NULL; immutable historical refs remain unchanged.

-- CẤM tiền/PII/endpoint. Không FK tới notification_intents (tenant-scoped) —
-- dùng opaque ref, cùng lý do với notification_reads.
CREATE TABLE push_delivery_telemetry (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_ref     uuid NOT NULL,             -- opaque physical-attempt UUID; no cross-plane FK
  event_key       text NOT NULL UNIQUE, -- deterministic/replay-safe per physical attempt+event
  event_key_version smallint NOT NULL CHECK (event_key_version > 0),
  intent_ref      text NOT NULL,          -- opaque, không join ngược ra tiền/PII
  subscription_id uuid REFERENCES device_push_subscriptions(id) ON DELETE SET NULL,
  attempt_seq     integer NOT NULL CHECK (attempt_seq > 0),
  kind            text NOT NULL CHECK (kind = 'web'),
  platform        text NOT NULL CHECK (platform IN ('ios','android','desktop','unknown')),
  installed       boolean NOT NULL,
  event           text NOT NULL CHECK (event IN ('sent','delivered','opened','failed','unknown','expired')),
  error_class     text CHECK (error_class IN ('gone','rate_limited','transient','payload',
                                               'ambiguous_after_write','ttl_expired')),
  latency_ms      integer CHECK (latency_ms >= 0), -- sent → event
  occurred_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pdt_error_shape_chk CHECK (
    (event = 'failed' AND error_class IS NOT NULL
      AND error_class IN ('gone','rate_limited','transient','payload'))
    OR (event = 'unknown' AND error_class IS NOT NULL
      AND error_class = 'ambiguous_after_write')
    OR (event = 'expired' AND error_class IS NOT NULL
      AND error_class = 'ttl_expired')
    OR (event IN ('sent','delivered','opened') AND error_class IS NULL)
  ),
  CONSTRAINT pdt_attempt_event_uq UNIQUE (attempt_ref, event)
);
CREATE INDEX idx_pdt_platform_time ON push_delivery_telemetry(platform, event, occurred_at DESC);
CREATE INDEX idx_pdt_intent ON push_delivery_telemetry(intent_ref);
```

`event_key = HMAC(domain='push-telemetry', canonical_json([attempt_ref,event]))` + key version được server tạo bằng canonical, length-delimited encoding — không nối chuỗi mơ hồ và không nhận key từ client. Structural `UNIQUE(attempt_ref,event)` giữ replay safety qua HMAC rotation. Server tự ghi `sent|failed|unknown|expired`; event↔error matrix ở DB yêu cầu non-null error cho ba error events. SW/client chỉ ghi `delivered|opened` bằng **report capability write-only, hết hạn `send_started_at+24h`**. Signing/verifier key version nằm trong capability; old verifier keys giữ ít nhất 24h + clock skew. Event ngoài set/hết hạn reject, retry no-op; `delivered` chỉ POST sau `showNotification` success. Valid evidence reconcile cùng logical delivery, không mở alternate route. `latency_ms` do server tính từ `send_started_at`.

### 2.5 Grants cho global-protected plane 🟡 (bắt buộc, khuôn `0009` + DD-47)

```sql
-- Live 0009 grants broad DML on these tenant tables. Target cutover removes it
-- before server-owned source/sequence/route/attempt fields are enabled.
REVOKE INSERT, UPDATE, DELETE ON notification_intents, notification_deliveries
  FROM PUBLIC, app, app_worker;
REVOKE ALL ON notification_delivery_attempts,
              notification_unknown_reconciliations
  FROM PUBLIC, app, app_worker;

REVOKE ALL ON person_notifications, notification_reads,
             notification_read_all_commands, notification_read_all_plane_steps,
             notification_inbox_fences,
             push_subscription_lookup_key_epoch, push_subscription_limits,
             device_push_subscriptions, push_subscription_rebind_challenges,
             push_subscription_registration_receipts,
             push_subscription_trust_proof_issuances,
             push_subscription_trust_events, push_delivery_telemetry
  FROM PUBLIC, app, app_worker;
REVOKE ALL ON SEQUENCE notification_inbox_sequence_seq FROM PUBLIC, app, app_worker;

-- Mọi function dưới đây: fixed search_path; actor-bound signed context từ verified
-- session; không tin p_person/raw tenant/source/hash/ciphertext do caller khai.
--   notif_inbox_list_global(p_actor_cap, p_cursor, p_limit)
--   notif_read_state_for_visible(p_actor_cap, p_visibility_cap)
--     -- cap bind exact global+tenant refs đã authorize bởi list queries
--   notif_mark_read_global(p_actor_cap, p_source)
--   notif_mark_read_tenant(p_actor_cap, p_tenant_visibility_cap)
--   notif_mark_all_begin(p_actor_cap, p_command_id) -- lock fence tới outer-tx commit
--   notif_mark_all_set_plan(p_actor_cap, p_command_id, p_plane_manifest_cap)
--   notif_mark_all_write_global(p_actor_cap, p_command_id)
--   notif_mark_all_write_tenant(p_actor_cap, p_command_id, p_tenant_visibility_cap)
--   notif_mark_all_finish(p_actor_cap, p_command_id) -- persist server boundary + receipt;
--                                                     -- call even for empty visible set
--   notif_unread_count(p_actor_cap)
--   notification_manual_reminder_enqueue(p_actor_cap,p_command_cap)
--   push_sub_register_self(p_actor_cap, p_registration_envelope,
--                          p_endpoint_enc, p_p256dh_enc, p_auth_enc)
--   push_sub_rebind_challenge_request(p_actor_cap, p_registration_envelope)
--   push_sub_rebind_with_proof(p_actor_cap, p_registration_envelope, p_rebind_proof,
--                              p_endpoint_enc, p_p256dh_enc, p_auth_enc)
--   push_sub_trust_approval_request(p_actor_cap,p_target,p_source)
--   push_sub_trust_approval_ack(p_source_device_cap,p_challenge_ack)
--   push_sub_trust_with_proof(p_actor_cap, p_subscription, p_trust_proof)
--   push_sub_list_self(p_actor_cap)         -- KHÔNG trả endpoint giải mã
--   push_sub_revoke_self(p_actor_cap, p_subscription)
--   push_telemetry_report(p_capability, p_event) -- delivered|opened only; verify scope/TTL
-- Ops chỉ EXECUTE aggregate function/view đã suppress small cells; không SELECT raw telemetry.

-- Explicit function grants: PostgreSQL mặc định PUBLIC EXECUTE nên revoke exact
-- signatures trước; không dựa comment hay table revoke để bảo vệ functions.
REVOKE ALL ON FUNCTION notif_assign_inbox_sequence() FROM PUBLIC, app;
REVOKE ALL ON FUNCTION notif_read_all_completion_guard()
  FROM PUBLIC, app, app_worker; -- owner-only deferred constraint trigger
REVOKE ALL ON FUNCTION notif_lock_inbox_fences_ordered(uuid[])
  FROM PUBLIC, app, app_worker; -- owner-only fence-first ordered create+lock helper
REVOKE ALL ON FUNCTION push_sub_lock_keys(bigint[])
  FROM PUBLIC, app, app_worker; -- owner-only transaction-advisory lock helper
REVOKE ALL ON FUNCTION push_sub_rebind_challenge_authorize_from_evidence(uuid,uuid)
  FROM PUBLIC, app, app_worker; -- owner-only prior-owner-reauth/recovery mutator only
REVOKE ALL ON FUNCTION push_sub_rebind_completion_guard()
  FROM PUBLIC, app, app_worker; -- owner-only deferred constraint trigger
REVOKE ALL ON FUNCTION push_sub_trust_proof_issue_from_auth_audit(uuid,uuid)
  FROM PUBLIC, app, app_worker; -- owner-only verified-email/manual-recovery evidence
REVOKE ALL ON FUNCTION push_sub_trust_issuance_completion_guard()
  FROM PUBLIC, app, app_worker; -- owner-only issuance→event deferred guard
REVOKE ALL ON FUNCTION notif_append_global_from_source(text,uuid)
  FROM PUBLIC, app, app_worker; -- owner-only; canonical protected mutators call it
REVOKE ALL ON FUNCTION
  notif_inbox_list_global(text,text,integer),
  notif_read_state_for_visible(text,text),
  notif_mark_read_global(text,uuid),
  notif_mark_read_tenant(text,text),
  notif_mark_all_begin(text,uuid),
  notif_mark_all_set_plan(text,uuid,text),
  notif_mark_all_write_global(text,uuid),
  notif_mark_all_write_tenant(text,uuid,text),
  notif_mark_all_finish(text,uuid),
  notif_unread_count(text),
  notification_manual_reminder_enqueue(text,text),
  push_sub_register_self(text,text,bytea,bytea,bytea),
  push_sub_rebind_challenge_request(text,text),
  push_sub_rebind_with_proof(text,text,text,bytea,bytea,bytea),
  push_sub_trust_approval_request(text,uuid,uuid),
  push_sub_trust_approval_ack(text,text),
  push_sub_trust_with_proof(text,uuid,text),
  push_sub_list_self(text),
  push_sub_revoke_self(text,uuid),
  push_telemetry_report(text,text)
FROM PUBLIC, app;
GRANT EXECUTE ON FUNCTION
  notif_inbox_list_global(text,text,integer),
  notif_read_state_for_visible(text,text),
  notif_mark_read_global(text,uuid),
  notif_mark_read_tenant(text,text),
  notif_mark_all_begin(text,uuid),
  notif_mark_all_set_plan(text,uuid,text),
  notif_mark_all_write_global(text,uuid),
  notif_mark_all_write_tenant(text,uuid,text),
  notif_mark_all_finish(text,uuid),
  notif_unread_count(text),
  notification_manual_reminder_enqueue(text,text),
  push_sub_register_self(text,text,bytea,bytea,bytea),
  push_sub_rebind_challenge_request(text,text),
  push_sub_rebind_with_proof(text,text,text,bytea,bytea,bytea),
  push_sub_trust_approval_request(text,uuid,uuid),
  push_sub_trust_approval_ack(text,text),
  push_sub_trust_with_proof(text,uuid,text),
  push_sub_list_self(text),
  push_sub_revoke_self(text,uuid),
  push_telemetry_report(text,text)
TO app;

-- Attempt lifecycle + secret-bearing functions: chỉ existing role `app_worker`,
-- mọi call ghi audit; worker không có direct table DML.
--   notification_enqueue_from_canonical_source(p_source_cap)
--   notification_announcement_fanout(p_fanout_cap)
--   notification_route_activate_and_close(p_dispatch_cap)
--       -- insert delivery + close nonempty target generation atomically; zero-target
--       -- candidate creates no live delivery and tries next route / skips intent
--   notification_attempt_claim(p_dispatch_cap) -- derive delivery/person/target + server seq
--   notification_attempt_start(p_send_claim) -- CAS start, return signed send_authorization
--   notification_attempt_finalize(p_send_authorization,p_outcome,p_coarse_provider_code)
--   push_sub_resolve_for_started_attempt(p_send_authorization)
--       -- require committed start; return exactly one physical_target_id secret
--   push_unknown_recovery_claim(p_limit)     -- claim due unknown Web Push rows;
--                                            -- join intent type server-side, enforce
--                                            -- allowlist + max 2 unknown-recovery waves
--   notification_unknown_reconcile_with_evidence(p_evidence_cap,p_command_id)
--   push_sub_mark_stale_for_started_attempt(p_send_authorization,p_reason)
--       -- derive target; reason = gone|not_found|endpoint_invalid_soft
--   push_sub_rebind_challenge_expire(p_limit) -- DB clock; pending/acked only
REVOKE ALL ON FUNCTION
  notification_enqueue_from_canonical_source(text),
  notification_announcement_fanout(text),
  notification_route_activate_and_close(text),
  notification_attempt_claim(text),
  notification_attempt_start(text),
  notification_attempt_finalize(text,text,text),
  push_sub_resolve_for_started_attempt(text),
  push_unknown_recovery_claim(integer),
  notification_unknown_reconcile_with_evidence(text,uuid),
  push_sub_mark_stale_for_started_attempt(text,text),
  push_sub_rebind_challenge_expire(integer)
FROM PUBLIC, app, app_worker;
GRANT EXECUTE ON FUNCTION
  notification_enqueue_from_canonical_source(text),
  notification_announcement_fanout(text),
  notification_route_activate_and_close(text),
  notification_attempt_claim(text),
  notification_attempt_start(text),
  notification_attempt_finalize(text,text,text),
  push_sub_resolve_for_started_attempt(text),
  push_unknown_recovery_claim(integer),
  notification_unknown_reconcile_with_evidence(text,uuid),
  push_sub_mark_stale_for_started_attempt(text,text),
  push_sub_rebind_challenge_expire(integer)
TO app_worker;
```

> **Không có blanket `GRANT SELECT` nào cho `app`.** Yêu cầu cứng của DD-47 cho global plane ("không chỉ app choke-point"), và là lý do global plane không thể chỉ dựa RLS: nó **không có** `tenant_id` để RLS bám vào.
>
> **Global emit ownership:** `notif_append_global_from_source` is owner-only, not a generic emit API. Exact follow/identity/auth protected functions first enter the shared fence-first hierarchy, then derive actor, target Person, fixed type and canonical protected source/audit; no app-executable function accepts caller-chosen person/type/time. Security mutation derives immutable `trigger_context_started_at <= event_at` from the re-locked context, appends item/alert command before changing email/device trust, and commits/rolls back all together. Known phase-1 producers all have bounded Person sets and must be reordered; failure to acquire fences first is a design/build HALT, not permission to write the tenant-only outbox.
>
> **Read-state gate:** tenant/global list path mint short-lived `visibility_cap` bind actor, filter và exact returned source refs. `notif_read_state_for_visible` chỉ trả intersection read-state của chính actor cho tập đó; cap mismatch/expiry reject. Vì vậy UI render read dot mà `app` không cần SELECT `notification_reads` và không có source-UUID existence oracle.
>
> **Core immutability/lifecycle ownership:** owner-only fixed-search-path triggers reject UPDATE of intent `{tenant_id,type,aggregate_id,source_event_id,person_id,inbox_sequence,intent_key,intent_key_version,created_at}` and delivery `{tenant_id,intent_id,person_id,platform,route_class,channel_identity_id,delivery_key,topic_*,target_generation,target_count,target_set_closed_at,created_at}`. The dedicated Person-merge function may re-parent `person_id` only after ordered fences and collision audit; it never rewrites source/sequence/key/route history. `notification_manual_reminder_enqueue`, `notification_enqueue_from_canonical_source` and `notification_announcement_fanout` re-read exact actor/canonical source, derive tenant/type/Person/source/key/sequence server-side and own all intent inserts; no generic function accepts caller-chosen semantic fields. `notification_route_activate_and_close` owns delivery insert + nonempty target closure atomically; fallback inserts a new closed route class, never rewrites history. Narrow owner functions alone transition statuses and append/finalize attempts. Trigger functions/deferred guards are revoked from `PUBLIC,app,app_worker`; CI introspects `proacl` and tests direct app/bypass writes.
>
> **Attempt lifecycle:** claim/start/finalize first verifies the signed claim and read-only derives candidate tenant+Person+target, locks that Person's inbox fence, then locks delivery/attempt/canonical aggregate and re-derives the same set; drift rolls back. `notification_attempt_start` runs the type-specific freshness predicate, CASes `send_started_at`, then returns a short-lived signed `send_authorization` bound to attempt, claim token, exact `physical_target_id`, lease and committed start time. CAS success is send-authorization linearization; only that authorization may resolve one secret/call provider. Later mutation cannot retroactively cancel HTTP and must use correction/reconcile. Token/lease/transition checks remain mandatory; direct attempt DML is revoked.
>
> `push_sub_resolve_for_started_attempt` là hàm **duy nhất** trả secret đã giải mã. Nó reject claim chưa start/authorization hết hạn, rechecks exact committed `send_started_at` + token/lease + same-Person active binding, và trả đúng **một** `physical_target_id`; không trả danh sách để worker chọn. Generic web `app` role không được EXECUTE. `push_sub_mark_stale_for_started_attempt` dùng cùng authorization để derive target server-side; signature không nhận subscription UUID. `gone|not_found` stale ngay; chỉ `endpoint_invalid_soft` tăng failure count và stale ở threshold 3. `rate_limited|transient_no_send|payload_rejected|unknown` không tăng failure count; success reset về 0.
>
> **Cross-feature blocking order:** mọi notification-owned writer/merge tuân đúng một order. (0) Verify capability/proof và candidate-discovery read-only; không giữ blocking row/advisory lock. (1) Compute mọi affected Person UUID (actor, creator, recipients, merge source/survivor, current endpoint owner, target/source-device owner), rồi `notif_lock_inbox_fences_ordered(distinct ids)` tăng dần và giữ tới commit. (2) Registration/rebind/merge chạm endpoint giữ lookup-key epoch `FOR SHARE`; rotation alone dùng `FOR UPDATE`. (3) Acquire **một** sorted+deduped array mọi domain-separated advisory idempotency key. Mapping dùng fixed `push-sub-lock-v1` algorithm + deployment-wide permanent key id; cùng semantic key phải ra cùng bigint trên mọi worker/deploy. Rotation chỉ qua serialized migration dual-lock old+new tới khi old workers drain; collision chỉ over-serialize. (4) Lock Person rows UUID order, rồi canonical source/operation-owner rows; rederive authorization + affected set. Set mới khác candidate hoặc thêm Person chưa fence ⇒ rollback/retry từ step 0, không append lock muộn. (5) Lock receipts/subscriptions/intents/deliveries/children theo PK order, mutate, commit; provider I/O only after commit. Không source/announcement/subscription/receipt row lock nào được đi trước step 1. Known producer không theo được hierarchy ⇒ build HALT. Tenant `outbox_events` không bao giờ là fallback cho event global.
>
> **Registration crypto boundary:** client POST raw PushSubscription **chỉ** vào trusted application boundary và bắt buộc actor-scoped UUID `Idempotency-Key`/`command_id`; boundary validate enum/size/encoding, redact request khỏi log/error, derive current+supported-old endpoint aliases + KMS ciphertext rồi mint signed short-TTL envelope bind actor+command, canonical request fingerprint, aliases/key versions, ciphertext digests, platform/install/UA enums, expiry + UUID JTI. DB function verify actor cap + signature/digests; caller-supplied person/hash/ciphertext không bao giờ là authority. Read-only alias discovery computes actor + candidate current owner; after locking both inbox fences, function takes key epoch `FOR SHARE`, revalidates signed aliases, then domain-separates actor Person, `(actor,command)`, envelope JTI, rebind challenge/proof/evidence and **mọi signed endpoint alias** into the deployment-stable advisory mapping, sort+dedupe and calls owner-only `push_sub_lock_keys()`. Re-select reveals a different/unfenced owner ⇒ rollback/retry. Sau lock, lookup receipt/JTI: same command+fingerprint or exact consumed JTI returns fixed safe snapshot; reuse under another actor/fingerprint/action rejects with zero mutation. Chỉ **new accepted external command** proceeds and exactly once increments `trust_epoch` + clears `trusted_at/trust_source`; a fresh/replayed envelope JTI for an accepted command is not a reset trigger. Endpoint absent uses `INSERT ... ON CONFLICT DO NOTHING`, then always re-selects canonical row `FOR UPDATE`; UNIQUE is final fence, not exact-replay mechanism. Same-Person accepted registration/reactivation locks the permanent actor key, enforces `push_subscription_limits`, sets `active`, clears lifecycle/failure/trust fields and writes one DB timestamp/epoch transition. Over-limit rejects before mutation.
>
> **Cross-Person rebind transfer:** knowing endpoint bytes is not proof. Challenge request is actor+external-command idempotent and binds immutable requester/current-owner refs, exact old subscription, accepted alias-set digest and current trust epoch. Same command/same scope replays; any scope mismatch rejects before a second challenge. In phase-1, only `verified_prior_owner_reauth` or audited `manual_recovery` evidence may let its owner-only mutator authorize the challenge and mint one signed proof bound to `action='rebind'`, old/current owner, new actor, old target, aliases, epoch, external command, issuer/evidence, expiry and JTI. Prior-owner reauth must be canonical one-time evidence produced from the **current owner's** verified auth context under the auth-security contract; a requester session, endpoint knowledge or self-asserted account link is insufficient. Web Push encryption keys are not a signing key; no SW echo/signature can authorize ownership transfer. `push_sub_rebind_with_proof` rechecks every field after fences/epoch/advisory locks, requires challenge `acknowledged`, no live attempt/report capability for the old UUID and new-owner active count below the limit, then in **one transaction** CASes challenge toward consume, deletes the old secret row (special transfer path, not ordinary 180-day prune; ON DELETE clears old receipt/trust/telemetry live pointers), inserts a **new UUID** for the new Person with `trust_epoch=prior+1`, `status='active'`, trust/lifecycle/failure reset, inserts the `rebound` receipt with immutable old/new owner/subscription/evidence refs, and marks challenge `consumed`. A DEFERRABLE transfer-completion guard requires exactly one matching rebound receipt/new live pointer iff challenge state is `consumed`; every other state has zero receipts. Any failure rolls everything back. It never `UPDATE`s subscription `person_id` or re-points historical refs. Person/account merge is a distinct §4.4 ownership-reparent path: it never mints or consumes a rebind proof/receipt. Unconsumed challenges touching a Person merge become owner-only `invalidated/person_merge` immediately (not fake TTL expiry); consumed challenge/receipt audit reparent only live actor/requester FKs while immutable refs stay fixed. Merge over the active-device limit HALTs/manual; it never drops devices silently.
>
> **Trust elevation boundary:** `push_sub_trust_with_proof` first verifies signature + canonical bytes and discovers target/source owners read-only, locks all affected inbox fences, then domain-separates actor Person, proof JTI, `evidence_ref`, target UUID and optional source UUID into sorted advisory keys. After serialization, it looks up a consumed event **before current trust/epoch**: exact JTI + fingerprint + canonical actor returns the immutable historical applied event without reading/mutating current trust; same proof/evidence under another context/JTI rejects. A new proof then locks target/source rows, checks expiry + exact current `trust_epoch`, and rechecks owners/source/evidence; changed/unfenced owner causes rollback/retry. Preexisting-device approval requires distinct same-Person active/trusted source at consume; verified-email/manual recovery requires both source pointer/ref NULL and an exact one-time canonical audit. Initial event insert requires same-Person live target and, for device approval, live source; composite FKs bind both. One `v_now := transaction_timestamp()` is written to both `trusted_at` and `created_at`; direct DML/clock input is revoked. Historical refs stay immutable; ordinary secret prune may SET NULL live pointers only. Later registration/rebind reset does not alter the historical event, and replay never restores old trust; a new stale-epoch proof fails. Current subscription GET, not replay response, is current-trust authority.

> **Retention/prune:** ordinary device cleanup hard-deletes the encrypted `device_push_subscriptions` secret row **before** its longer-lived replay/audit ledgers and only when `status IN ('stale','revoked')`, no live attempt/report capability remains, and `GREATEST(created_at, COALESCE(stale_at,'-infinity'), COALESCE(revoked_at,'-infinity'), COALESCE(last_success_at,'-infinity')) <= transaction_timestamp() - interval '180 days'`. All clocks are owner-written DB times; forged-old caller timestamps reject. The proof-authorized cross-Person transfer is the only earlier delete exception and atomically creates its replacement UUID/audit. Composite FKs SET NULL only the live pointer; fixed response/target/source refs never change. Registration receipts remain through at least `max(envelope_expires_at + skew, ownership_proof_expires_at + skew, documented idempotency window)`. Consumed/expired/invalidated rebind challenges retain proof fingerprint/key version + immutable scope/evidence for at least the same rebind receipt/idempotency window; no cleanup removes them while a proof or receipt can replay. Trust events survive ordinary device prune and remain until `proof_expires_at + skew` and until the verifier/evidence can no longer be accepted. Exact retention beyond these minima is the NTF-OQ-15/legal gate; cleanup may not delete a replay fence merely to reclaim device secrets.
>
> **Rotation:** registration giữ `push_subscription_lookup_key_epoch` singleton `FOR SHARE` từ validation tới commit; rotation giữ cùng row `FOR UPDATE` qua cutover nên old/new write transactions không thể qua nhau. Envelope phải bind active write version **và aliases cho current + supported-old versions** vì DB không nhận raw endpoint. Under lock, new command verifies active version/epoch, lookup tất cả signed accepted aliases, locks/collapses matched row rồi stores **chỉ active hash/version**; old versions là verify/read-only. Exact committed command/JTI replay được trả từ receipt trước current-version check, nhưng chỉ sau actor+fingerprint match và không mutate. Encryption key version cho phép lazy re-encrypt. Topic token/version persist trên logical delivery; event/command/request keys persist version. Report capability mang `kid`; verifier keys giữ ≥24h + skew và event key derive bằng pinned version đó. Exact report/announcement/quota-command replay sau rotation lookup stored key version rồi resolve/no-op trên row cũ, không tạo duplicate/conflict.

### 2.6 Payload contract 🟡 (bất biến; test CI bắt buộc trước enablement, **chưa live**)

```jsonc
// ĐÚNG — report_cap là write-only, scoped, expires send_started_at+24h; không phải auth/tenant token
{ "v": 1, "ref": "ntf_9f3c…", "t": "k7Jf3QmN2pR8sT4uV6wX9yZaBcDeFgHi", "k": "notif.reminder.generic", "p": { "report_cap": "rpt_opaque_signed…" } }

// ❌ SAI — mọi trường sau phải bị planned CI invariant chặn trước enablement:
// "amount", "remaining", "player_name", "club_name", "phone", "email",
// "gender", "pay_code", "session_title", chuỗi tiếng Việt đã render
```

`buildPushPayload()` **sẽ là** choke-point duy nhất của mechanism 38 `notification-web-push-provider-attempt-core`; test invariant phải assert allowlist khoá (`v`,`ref`,`t`,`k`,`p`) và `p` chỉ có `report_cap` cho key được phép, cộng deny-list tên khoá/giá trị nhạy cảm. Không có `tenant_id`/`club_ref`: authenticated fetch derive context server-side từ opaque `ref`. Khi logical Web delivery được tạo, server tính `t = base64url(HMAC-SHA256(domain='web-push-topic', logical_ref)).withoutPadding().slice(0, 32)` rồi persist `topic_token + topic_key_version`; mọi retry đọc lại token đó, không recompute bằng current key. `report_cap` chỉ append tối đa một row/event đã scope tới `send_started_at+24h`; không fetch nội dung/authorize tenant/person.

### Indexes

- §A: `idx_notif_intents_tenant (tenant_id, status)` (đã có ở `0008`); `idx_notif_deliveries_pending`; attempt claim index `(status,lease_expires_at)`.
- §B: `idx_person_notif_person (person_id, inbox_sequence DESC)`; `notification_reads` UNIQUE. Inbox tenant thêm `(tenant_id, person_id, inbox_sequence DESC)`; cursor/order không dùng `created_at`.
- §C: `membership_tags (tenant_id, name_norm)` UNIQUE; tag/audience/preference indexes; `announcements (tenant_id,status)`; quota reservation UNIQUE tenant+actor+command và tenant+preview; retry command UNIQUE tenant+actor+command + item PK command+intent.
- §D: singleton key epoch; `device_push_subscriptions (endpoint_lookup_hash)` UNIQUE + partial active; registration receipt UNIQUE actor+command, envelope JTI, rebind-proof JTI; trust event UNIQUE proof/evidence và target+epoch; telemetry structural UNIQUE attempt+event + versioned event key; platform/time + intent indexes.
- §E: concrete `chat-unread-notification-core` slice must enforce one coalescible pending generation per `(person_id,channel_id)`, exact logical-key uniqueness including opaque highest cursor and one-live provider attempt. Physical table/job names remain slice-owned; no index/table may create one durable row per message.

### Migration & Rollback (template v2.30 — tổng hợp derivative)

> Tổng hợp/tham chiếu để đủ khuôn template — **canonical migration steps của §A là "Migration / upgrade contract từ live `0008`" (9 bước) ở §2.1**; section này không thêm bước mới, không đổi contract §A và không tự authorize physical migration cho §B/C/D/E.

**Live vs chưa live (verify trực tiếp `packages/db/migrations/` ngày 2026-07-28):**

| Nhóm object | Migration | Trạng thái | Quy tắc |
|---|---|---|---|
| `notification_policies` · `notification_intents` · `notification_deliveries` | `0008_notifications_onboarding.sql` | ✅ live — shape cũ: intents chưa có `source_event_id`/`intent_key_version`/`inbox_sequence`/`skip_reason`; deliveries `platform text` **không** CHECK, chưa có `route_class`/`person_id`, còn `attempts`/`provider_code` | **Reuse + expand additive theo §2.1, không recreate; DROP = ❌ NEVER.** Không sửa file `0008` lịch sử |
| `outbox_events` · `projector_deliveries` · `processed_commands` | `0005_sync_engine.sql` | ✅ live (`tenant_id NOT NULL`) | Reuse; tenant outbox **không bao giờ** là fallback/source cho global event (§2.2 Producer boundary — vi phạm = build HALT) |
| `channel_identities` + delta `UNIQUE (id,platform,person_id)` | bảng gốc `0001`; delta thuộc migration DD-65..68 **chưa land** | 🟡 prerequisite §A-target | `type`/`platform` CHECK, `route_class`, person-bound FKs và physical-attempt ledger chỉ land **sau** DD-67 identity/registry migration; web push/one-route hardening phụ thuộc delta này (đã pin ở Live baseline đầu doc) |
| `memberships`/`sessions` delta `UNIQUE (id, tenant_id)` | bảng gốc `0002`; delta chưa có | 🟡 prerequisite §C | Chỉ land cùng dedicated §C code-ready slice |
| §B: `person_notifications` · `notification_inbox_fences` + `notification_inbox_sequence_seq` · `notification_reads` · `notification_read_all_commands`/`_plane_steps` | **chưa có trong bất kỳ migration nào** | ✅ contract / ⬜ runtime | Migration mới monotonic; DD-70 đã chốt nhưng vẫn cần strict slice readiness, schema/grant/acceptance closure |
| §C: `membership_tags` · `membership_tag_links` · `announcements` · `announcement_audiences`/`_audience_tags` · `announcement_quota_reservations` · `announcement_retry_commands`/`_items` · `membership_notification_preferences` | **chưa có trong bất kỳ migration nào** | ✅ contract / ⬜ runtime | Migration mới monotonic; DD-43/DD-71 đã chốt nhưng OQ chi tiết theo slice phải đóng trước `CODE_READY` |
| §D: `push_subscription_lookup_key_epoch` · `push_subscription_limits` · `device_push_subscriptions` · `push_subscription_rebind_challenges` · `push_subscription_registration_receipts` · `push_subscription_trust_proof_issuances` · `push_subscription_trust_events` · `push_delivery_telemetry` | **chưa có trong bất kỳ migration nào** | ✅ contract / ⬜ runtime | Migration mới monotonic; DD-72 đã chốt nhưng telemetry/evidence/retention gates vẫn áp dụng |
| §E: Chat digest coalescing/preference/delivery state *(physical names slice-owned)* | **chưa có trong bất kỳ migration nào** | ✅ DD-94 contract / ⬜ runtime | Land only after canonical Chat read proof exists; schema stores zero content/per-message item and exact grants keep global delivery state protected |

**Numbering:** committed `main` tại snapshot này đã có tail `0024_public_visibility_capacity_check.sql` → lấy **next available monotonic number tại build time** sau khi sync prerequisite branches; không giả định số còn trống, không sửa/tái dùng migration lịch sử.

**Rollback:**

| Phạm vi | Cách rollback | An toàn? |
|---|---|---|
| §A delta (sau khi `0008`-upgrade/DD-67 migration land) | Disable scheduler/dispatcher/adapter workers + §A routes **trước**, rồi revert bằng migration mới additive-only: DROP các constraint/cột/bảng attempt mới thêm, restore shape `0008` | ✅ Constraint/column-only; dữ liệu backfill giữ nguyên; quarantine/legacy-archive rows giữ lại cho audit |
| Bảng live `0005`/`0008` | DROP | ❌ NEVER — chứa intent/delivery/outbox thật đã apply |
| §B/C/D/E objects | — | **Không có rollback path vì chưa tồn tại migration/runtime nào**; mỗi concrete slice phải author rollback trước strict `CODE_READY`. Hiện tại không land migration |

### Edge Cases (Backend)

| # | Area | Category | Case | Xử lý |
|---|---|----------|------|-------|
| 1 | Reminder | Data Integrity | Duplicate intent (same charge + version) | UNIQUE `intent_key` — insert conflict = no-op |
| 2 | Reminder | Data Integrity | Duplicate exact route class hoặc Web/Zalo/Messenger cùng live, kể cả caller đổi `delivery_key` | `UNIQUE(intent_id,route_class)` chặn duplicate history nhưng cho terminal tenant-Page → central-Page fallback; partial `UNIQUE(intent_id)` trên `pending\|sent\|unknown` chặn mọi cross-route overlap |
| 3 | Reminder | Concurrency | Scheduler concurrent tenant claims | Narrow-claim with `FOR UPDATE SKIP LOCKED` |
| 4 | Reminder | Concurrency | 1k tenant burst | Jitter + staggered scheduling |
| 5 | Reminder | Data Integrity | Remind paid/void charge sau khi queue nhưng trước send | Fresh pre-send predicate yêu cầu open/partial + current policy; fail → skipped/no HTTP |
| 6 | Reminder | Data Integrity | Reversal after settled confirmation | Create correction intent — different `intent_key` |
| 7 | Reminder | Security | PII/amount in reminder template | Không broadcast group. Zalo/Messenger DM chỉ render chi tiết sau identity/privacy check; OS Web Push chỉ generic + opaque ref. Group-mention Telegram đã bỏ (DD-37) |
| 8 | Reminder | Security | Manual override bypass cooldown | Owner role + reason + audit required |
| 9 | Reminder | Resilience | Provider rate-limit (429) | Honor `retry-after`, update next_attempt_at |
| 10 | Reminder | Resilience | Provider permanent failure | Mark exact endpoint unreachable; choose policy fallback only when provider outcome proves no send; unknown outcome stays fail-closed for review/retry |
| 11 | Reminder | Security | Cross-tenant/cross-endpoint reachability | ❌ NEVER — exact channel identity + Page/bot/OA binding/window; target tenant re-authorized separately |
| 12 | Reminder | Data Integrity | Left membership still eligible | Policy check: allow final notice or skip |
| 13 | Reminder | Financial/Resilience | Duplicate/sibling first-activation waitlist derivation-failure events | Candidate audit stays unique by `failure_event_id`/entry/reason. User-facing `intent_key=waitlist-charge-derivation-root:{promotion_retry_id}` yields at most one root digest; sibling/duplicate events and retry command IDs do not fork it. Aggregate count/reason classes only; no player promotion/PII/amount/venue notification |
| 14 | Reminder | Data Integrity | Tenant and central Page both reachable | Atomic route claim selects tenant Page; cross-platform active fence suppresses central/fallback/concurrent retry |
| 15 | Reminder | Data Integrity | Tenant Page closed, central Page reachable | Select central endpoint; do not copy tenant Page window/token |
| 16 | Reminder | Resilience | Hai worker claim cùng canonical target bằng old/new HMAC ref / chết sau provider request write | Partial one-live-claim trên stable `physical_target_id` + server attempt sequence; rotation không mở claim thứ hai. Timeout/started lease expiry → attempt + logical delivery `unknown`, không retry/fallback; kill-after-write regression |
| 17 | Reminder | Security | Delivery tenant/Person khác parent intent hoặc identity Person khác | Composite `(intent_id,tenant_id,person_id)` + `(channel_identity_id,platform,person_id)` FKs reject dưới owner/bypass-RLS |
| 18 | Reminder | Security | Caller pairs Messenger identity from Page A with Page B | Impossible by schema/API: delivery stores no Page id; narrow resolver derives Page A from exact identity or fails closed |
| 19 🟡 | Inbox | Security | `app` role SELECT thẳng `person_notifications`/`notification_reads` | Không grant → permission denied. Test bằng **role runtime thật** |
| 20 🟡 | Inbox | Security | Merge cross-plane bằng SQL `UNION` cần bypass RLS | ❌ Cấm — merge ở service sau khi authorize từng nguồn |
| 21 🟡 | Inbox | Security | FK từ `notification_reads` → `notification_intents` | ❌ Không tạo — FK cross-plane rò tồn tại row tenant và kẹt RLS |
| 22 🟡 | Inbox | Security | Caller cố nhét `{"note":"Tuấn nợ 150k"}` vào global item | Schema không có arbitrary params; fixed `type` derive copy, direct bypass insert không có cột nhận payload |
| 23 🟡 | Inbox | Security | Cursor bị chế/reuse dưới actor hoặc filter khác | Signed cursor bind actor+filter+`before_sequence`; mismatch/invalid signature → `INVALID_CURSOR` |
| 24 🟡 | Inbox | Data Integrity | Cùng tenant intent / global event / signal chạy lại | Tenant item chính là `notification_intents` (`intent_key` UNIQUE); global `event_key` UNIQUE; InboxSignalProjector retry chỉ emit/invalidate, không insert item |
| 25 🟡 | Inbox | Data Integrity | Mark-read source không tồn tại/không thuộc person | Byte-identical opaque 404; **không** tạo read row mồ côi/oracle |
| 26 🟡 | Inbox | Concurrency | 2 tab; late insert; hidden/empty set; commit after begin/one plane; missing/extra step | Signed manifest + zero-item steps; deferred guard re-reads current row and rejects incomplete commit with 0 durable receipt/step/read. Completed replay idempotent; hidden/late unread |
| 27 🟡 | Inbox | Cross-Feature | Merge Person (§P6/DD-01) | Lock source fences UUID order; dedupe exact reads; re-parent only non-colliding completed receipts. Any read-all command collision halts/manual; survivor `last_sequence=GREATEST(source)`; boundary không mark item |
| 28 🟡 | Inbox | Cross-Feature | Membership left rồi active lại / admin revoke rồi regrant | Visibility `hidden` derive tại read time; item có thể hiện lại với read state cũ, không có tombstone giả |
| 29 🟡 | Inbox | Resilience | InboxSignalProjector fail | Tenant item vẫn query trực tiếp từ `notification_intents`; SSE/badge cache có thể trễ và reconcile sửa lại. `projector_deliveries` retry/backoff → DLQ; **không** rollback ledger, không chặn `notification_deliveries` |
| 30 🟡 | Inbox | Resilience | Badge counter lệch sau incident | Reconcile job tính lại từ nguồn; counter là cache, không phải sự thật |
| 31 🟡 | Inbox | Security/Data Integrity | Person merge; forged/future boundaries; same-session factor tạo trước event | Function chỉ trả survivor; DB-owned immutable `context_start<=event_at<=created_at`; route factor timestamp phải trước context start |
| 32 🟡 | Inbox | UX/Perf | Inbox 10k item + N+1 render tenant | Batch theo tenant: gom `intent_id` per tenant → **một** `withTenant` mỗi tenant |
| 33 🟡 | Announce | Security | Tag/membership/audience/session deep-link cross-tenant hoặc caller giả `name_norm` | Composite FK reject refs; DB trigger overwrite `name_norm` bằng canonicalizer versioned — kể cả owner/bypass-RLS |
| 34 🟡 | Announce | Security | Tag rò ra projection public | CI invariant: projection public không chứa cột/nguồn tag (HR2, DD-43) |
| 35 🟡 | Announce | Security | Dùng tag trong query eligibility/join | Test kiến trúc: `join`/`eligibility` service **không** import tag repo (BL-NTF-4) |
| 36 🟡 | Announce | Security | Body chứa số tiền + tên | DLP-lite scan trước dispatch → `announcement_dlp_warned`; chặn/cảnh báo theo NTF-OQ-11 |
| 37 🟡 | Announce | Security/Data Integrity | Double submit/reused command; direct DML sửa body/session/CTA/audience/vector | Direct DML revoked + immutable trigger; exact replay same result; dispatch re-hash; mismatch/drift → reused-key hoặc `ANNOUNCEMENT_PREVIEW_STALE` |
| 38 🟡 | Announce | Data Integrity | Hai reversed fan-out với fence missing/mixed; fan-out cạnh Person merge; kill sau fence đầu | Shared per-UUID create+lock helper/hierarchy avoids unique-lock deadlock; crash rollback giữ `queued`, không intent/route partial |
| 39 🟡 | Announce | Data Integrity | Tag bị xoá giữa queued và dispatch | Composite FK mặc định chặn xoá tag còn được audience tham chiếu; nếu lifecycle chọn soft-delete/corrupt fixture thì dispatch ghi `cancelled/audience_tag_missing` + trả `AUDIENCE_TAG_MISSING`; **không** fallback gửi toàn CLB |
| 40 🟡 | Announce | Data Integrity | Audience rỗng khi dispatch | `status='cancelled'`, `terminal_reason='audience_empty'`, `recipient_count=0`; không tạo intent, không báo sent giả |
| 41 🟡 | Announce | Concurrency | Hai worker cùng claim một announcement | Cùng row lock; một atomic `queued→dispatched`, worker kia thấy terminal/no-op |
| 42 🟡 | Announce | Concurrency | Member/route/capability/content đổi sau confirm | Re-hash canonical content/criteria + full roster/route/auth check trên snapshot trước intent; reason precedence exact; increase/drift cancels 0-intent |
| 43 🟡 | Announce | Concurrency | Host cancel race fan-out | Row-lock winner: queued cancel → 0 intent; expansion winner → dispatched và cancel trả already-dispatched; không partial |
| 44 🟡 | Announce | Resilience | Recipient permanent fail / provider fail toàn bộ | Announcement giữ `dispatched`; report derive failed/unknown từ delivery rows và thay đổi theo retry, không persist aggregate stale; canonical row không rollback (HR3) |
| 45 🟡 | Announce | Resilience | Concurrent retry nhóm failed sau fallback, một intent có nhiều historical failed routes | Actor-scoped command + intent locks; current canonical policy rank rồi delivery UUID chọn đúng một eligible failed route, persist item receipt trước CAS; không có `pending\|sent\|unknown`; fresh auth/preference/reachability |
| 46 🟡 | Announce | UX/Perf | Đếm audience realtime khi host gõ | Count có LIMIT/estimate + debounce |
| 47 🟡 | Push | Security | Payload chứa tiền/PII | CI invariant trên `buildPushPayload()` — allowlist + deny-list |
| 48 🟡 | Push | Security | `app` SELECT subscription/raw telemetry hoặc INSERT telemetry trực tiếp | Không grant → denied (role runtime thật); client chỉ EXECUTE scoped report function, ops aggregate-only |
| 49 🟡 | Push | Security | Caller giả person/hash/ciphertext hoặc app role chọn endpoint để giải mã/gửi | Trusted crypto boundary derive+encrypt rồi ký envelope bind actor/digests/key versions; DB verifies. `app` không resolve secret; `app_worker` chỉ consume send-claim |
| 50 🟡 | Push | Security | Telemetry chứa endpoint/UA raw | Schema không có cột; `user_agent_class` là enum thô |
| 51 🟡 | Push | Security | `intent_ref` join ngược ra tiền | Opaque token, không phải `notification_intents.id`; không FK cross-plane |
| 52 🟡 | Push | Security/Data Integrity | New/replayed registration command/JTI; endpoint đổi chủ; forged endpoint/SW proof; prior-owner reauth/manual-recovery rebind; Person merge cạnh challenge | Required actor+command receipt makes response-loss retry receipt-only; only a newly accepted external command increments epoch + resets trust. Other-Person hash → stored 409/no mutation. Only canonical `verified_prior_owner_reauth` or audited `manual_recovery` can authorize transfer; endpoint/p256dh/auth/SW echo rejects. Exact proof replay is historical-only. Merge invalidates unconsumed challenge and follows re-parent/reset with zero new rebind receipt |
| 53 🟡 | Push | Data Integrity | Client gửi `kind='native'` trong phase-1 | Schema/API reject; native chưa có accepted provider/protocol/app/environment contract |
| 54 🟡 | Push | Data Integrity/Concurrency | Một intent → n thiết bị; register cạnh target planning; early success/fail | Một delivery lock closes stable target generation/count và materialize all initial attempts trước send. Later device future-only; logical finalizer waits exact generation; already-pinned claims survive first sent |
| 55 🟡 | Push | Resilience | `410 Gone`/`404` | `push_sub_mark_stale(reason='gone')`, ngừng gửi, **không** retry; fallback theo policy |
| 56 🟡 | Push | Resilience | Explicit no-send / timeout-after-write / rate-limit | Proven no-send → backoff/fallback; ambiguous → `unknown`. Tenant recovery claim chỉ `settled\|correction`; security alert chờ global attempt ledger; announcement/reminder manual reconcile |
| 57 🟡 | Push | Resilience | Tất cả thiết bị không thành công | Chỉ khi đủ `target_count` của closed generation đều proven no-send mới `failed`→fallback Zalo/Messenger/inbox. Có pinned nonterminal hoặc ambiguous mà không success thì chưa failed/`unknown`; recovery cùng route theo class ở #56, không alternate route và **không** rollback ledger (BL-NTF-2) |
| 58 🟡 | Push | Concurrency | Telemetry out-of-order/replay, cap quá 24h hoặc display fail | Valid in-window evidence reconcile; duplicate no-op; wrong event/expired reject; `showNotification` fail không ghi delivered |
| 59 🟡 | Push | Cross-Feature | Merge Person có duplicate + nonduplicate subscriptions, receipts/events/JTIs | Preflight all command collisions and halt even identical; defer composite FKs. Every re-parented row advances epoch/resets trust; duplicate survivor uses `GREATEST(group)+1`, loser live pointers NULL while historical refs/JTIs remain fixed |
| 60 🟡 | Push | Cross-Feature | Không được đụng `channel_reachability` | Test kiến trúc: module push không import channel-reachability repo (DD-69) |
| 61 🟡 | Push | Data Integrity | HMAC/encryption/signing/VAPID rotation | Versioned dual-read/re-encrypt giữ dedupe/topic/report; chỉ VAPID incompatibility thực mới controlled stale/re-subscribe, không silent loss |
| 62 🟡 | Push | UX/Perf | Person có 20 thiết bị cũ | Trần active/person; prune secret only when stale/revoked + latest lifecycle/success ≥180d + no live capability; replay/audit ledgers retained separately |
| 63 🟡 | Announce | Security/Input | Body có HTML/Markdown/control chars, invalid UTF-8 hoặc vượt 16 KiB/provider limit | Parameterized plain-text path; reject tại preview/API/DB; không parse/log/truncate; provider adapter escape nếu API bắt buộc rich mode |
| 64 🟡 | Announce | Concurrency/Abuse | Hai confirm/retry-failed/reused command chạm quota; quota timeout | Structural reservation + actor-scoped receipt commit atomically; exact replay once, mismatch reject; outage fail closed; retry persists deterministic route selection then CAS, no fan-out charge |
| 65 🟡 | Chat digest | Privacy | Source adapter/job/provider payload carries body/title/amount/mention text/author/attachment/club name | Allowlist rejects before persistence/send; no Inbox item, Chat/system message or per-source-message row |
| 66 🟡 | Chat digest | Concurrency | Same/lower/higher cursor races for one person+channel | Same/lower no-op; highest advances one pending generation atomically; no duplicate logical signal |
| 67 🟡 | Chat digest | Data Integrity | Mark-read overtakes pending digest | Pre-provider Chat proof returns read/obsolete; worker terminal-skips and performs no HTTP |
| 68 🟡 | Chat digest | Authorization | Club membership revoked or DM block/safety changes after enqueue | Fresh proof false/unknown skips with opaque reason; no channel/peer existence disclosure |
| 69 🟡 | Chat digest | Preference | Absent/invalid/off/all/mentions preference; preference store unavailable | Absent uses `mentions`; invalid rejects at write; `off` skips; unavailable/unknown skips rather than widening |
| 70 🟡 | Chat digest | Device security | Subscription revoked or `trust_epoch` changes after claim | Fresh device/trust recheck fails; no secret resolution/provider write |
| 71 🟡 | Chat digest | Resilience | Timeout-after-write/unknown followed by retry and higher cursor | Existing logical key stays sticky; no blind resend. Higher cursor enters at most one pending successor |
| 72 🟡 | Chat digest | Enablement | Delay/coalesce config absent or boundary matrix untested | Route remains OFF; Chat realtime/unread and payment Inbox/Web Push continue |

---

## 3. API Contract

> **DD-60 compatibility:** mọi JSON response dùng canonical `{data,error,meta.requestId}` envelope và auth legend `⬜ Public · ✅ Person-self · 🔑 exact tenant/ops capability · 🔒 signed provider/report capability`. Bảng dưới là target inventory, chưa phải runtime API. Trước strict `CODE_READY`, từng concrete endpoint phải được mở thành request/response/error block theo `../../standards/api-reference-convention.md`.

### Endpoints

| Method | Path | Auth | Mô tả |
|--------|------|------|-------|
| GET | /api/notifications/preview | 🔑 Exact capability | Preview eligible reminder recipients |
| POST | /api/notifications/send | 🔑 Exact capability | Manual reminder send |
| GET | /api/notifications/report | 🔑 Exact capability | Routed outcome từ deliveries/attempts; pre-send/no-route skipped từ canonical intent reason |
| PUT | /api/notifications/policy | 🔑 Exact capability | Update notification policy |
| GET 🟡 | /api/notifications/inbox | ✅ Person-self | List gộp 2 plane, cursor, filter `tenant_id`/`type`; payment item detail/deep-link delegates canonical person-self `SelfPaymentStatus`, không local formula/snapshot |
| GET 🟡 | /api/notifications/inbox/unread-count | ✅ Person-self | Badge |
| POST 🟡 | /api/notifications/inbox/:kind/:id/read | ✅ Person-self | Mark-read (idempotent) |
| POST 🟡 | /api/notifications/inbox/read-all | ✅ Person-self | Request chỉ có idempotency `command_id`; synchronous visible-set reads + receipt all-or-nothing, không nhận boundary |
| GET 🟡 | /api/notifications/inbox/stream | ✅ Person-self | SSE — tái dùng sync engine transport |
| POST 🟡 | /api/announcements/preview | 🔑 Exact capability | Đếm audience; trả proof bind actor/tenant/content/audience/per-channel count/version/expiry |
| POST 🟡 | /api/announcements | 🔑 Exact capability | Consume proof; recompute/re-authorize; queue idempotent theo client `command_id` UUID + server `preview_jti` UUID |
| POST 🟡 | /api/announcements/:id/cancel | 🔑 Exact capability | Huỷ khi còn `queued`; race sau atomic expansion trả already-dispatched |
| POST 🟡 | /api/announcements/:id/retry-failed | 🔑 Exact capability | Actor-scoped `command_id`; lock intents, policy-rank + persist đúng một failed delivery per intent rồi CAS, fresh revalidation; row vẫn `dispatched` |
| GET 🟡 | /api/announcements/:id/report | 🔑 Exact capability | Routed sent/failed/unknown từ deliveries/attempts; skipped/unreachable từ intent reason + actual vector |
| GET·POST·PATCH·DELETE 🟡 | /api/membership-tags[/:id] | 🔑 Exact capability | CRUD tag |
| POST 🟡 | /api/memberships/tags | 🔑 Exact capability | Gán/gỡ tag hàng loạt |
| GET·PUT 🟡 | /api/notifications/preferences/:tenantId | ✅ Person-self | Announcement opt-out cho membership active/guest của actor; không nhận person/membership id từ body |
| GET 🟡 | /api/push/vapid-public-key | ⬜ Public | VAPID public key |
| POST 🟡 | /api/push/subscriptions | ✅ Person-self | Required UUID `Idempotency-Key`; raw subscription vào trusted crypto boundary; envelope bind actor+command/digests/key aliases/JTI; exact command/JTI replay receipt-only, safe response whitelist |
| POST 🟡 | /api/push/subscriptions/rebind | ✅ Person-self + one-time proof | Same Idempotency-Key contract + globally consumed ownership-proof JTI issued only from `verified_prior_owner_reauth` or audited `manual_recovery`; conflict không silent reparent; Person merge không gọi path này; transfer audit + epoch increment/DB trust reset |
| POST 🟡 | /api/push/subscriptions/:id/trust | ✅ Person-self + one-time proof | Nâng trust qua verified-email reauth, distinct pre-trusted device approval hoặc audited manual recovery; proof consume/event/update atomic, không nhận trust fields |
| GET 🟡 | /api/push/subscriptions | ✅ Person-self | List thiết bị của mình (**không** trả endpoint) |
| DELETE 🟡 | /api/push/subscriptions/:id | ✅ Person-self | Thu hồi thiết bị |
| POST 🟡 | /api/push/telemetry | 🔒 Signed report capability | Client chỉ ghi delivered/opened; sent/failed/unknown/expired do server ghi |
| GET 🟡 | /api/admin/push/reliability | 🔑 Ops capability | Dashboard gate #4 (aggregate, không PII) |
| GET·PUT 🟡 | /api/notifications/chat-preferences/:channelId | ✅ Person-self | Club channel exact `all\|mentions\|off`; absent row reads `mentions` (mention/reply ON), `off` suppresses all. DM defaults ON; caller cannot supply another person |

> Endpoint person-self không nhận `person_id` từ query/body. Actor luôn từ session đã verify (DD-47).
>
> Inline approve/reject follow-request **route tới** canonical User Settings endpoints `/api/me/followers/:followerId/approve|reject`; inbox item không tự mutate `person_follows`, và action re-authorize actor=followee tại consume.

### Rate Limits

> Xem `../../standards/business-rules.md` BL-SEC-5 Rate Limit Registry — giá trị announcement chờ **NTF-OQ-9**. `10/ngày · 3/giờ` là initial shadow default, không phải founder constant; production flag giữ OFF tới khi tenant+actor buckets **và** fan-out recipient budget có giá trị cấu hình + atomic idempotent reservation implementation. Reservation outage fail closed.

| Endpoint | Limit |
|----------|-------|
| GET /inbox · /unread-count 🟡 | 60 · 120 / phút / person |
| POST /inbox/read · /read-all 🟡 | 120 / phút / person |
| GET /inbox/stream 🟡 | 5 concurrent / person |
| POST /announcements 🟡 | *(initial shadow)* 10 / ngày · 3 / giờ / **tenant + actor**; thêm configurable fan-out recipient budget |
| POST /announcements/preview 🟡 | 60 / phút / tenant + actor |
| POST /announcements/:id/retry-failed 🟡 | 5 / giờ / announcement + actor + tenant; actor-scoped command receipt |
| POST/PATCH/DELETE /membership-tags · POST /memberships/tags 🟡 | 60 / phút / actor + 120 / phút / tenant |
| GET·PUT /notifications/preferences/:tenantId 🟡 | 60 · 20 / phút / person+tenant |
| GET·PUT /notifications/chat-preferences/:channelId 🟡 | 60 · 20 / phút / person+channel |
| POST/DELETE /push/subscriptions 🟡 | 10 / giờ / person |
| POST /push/telemetry 🟡 | 300 / giờ / subscription + capability scope |

### Error Codes

| Code | Error Code | Message | Trigger |
|------|-----------|---------|---------|
| 400 | `NO_ELIGIBLE_RECIPIENTS` | Không có ai cần nhắc nợ | No eligible charges |
| 429 | `REMINDER_COOLDOWN` | Đã nhắc gần đây — thử lại sau | Cooldown active |
| 403 | `OVERRIDE_REQUIRES_OWNER` | Chỉ chủ club mới có thể ghi đè cooldown | Non-owner override attempt |
| 404 🟡 | `NOTIFICATION_NOT_FOUND` | Không tìm thấy thông báo | Không tồn tại **hoặc** không thuộc actor (không phân biệt — tránh oracle) |
| 400 🟡 | `INVALID_CURSOR` | Con trỏ không hợp lệ | Cursor sai/hết hạn |
| 400 🟡 | `EMPTY_AUDIENCE` | Không có ai trong nhóm này | Audience rỗng sau lọc |
| 400 🟡 | `AUDIENCE_TAG_MISSING` | Nhãn không còn tồn tại | Tag bị xoá giữa chừng |
| 400 🟡 | `ANNOUNCEMENT_BODY_REQUIRED` | Nội dung không được để trống | Body rỗng |
| 400 🟡 | `ANNOUNCEMENT_BODY_INVALID` | Nội dung chứa ký tự không hợp lệ | Invalid UTF-8/control characters sau canonical newline normalization |
| 413 🟡 | `ANNOUNCEMENT_BODY_TOO_LARGE` | Nội dung vượt giới hạn kênh gửi | Vượt 16 KiB hard ceiling hoặc provider-specific limit tại preview |
| 409 🟡 | `TAG_NAME_EXISTS` | Nhãn này đã tồn tại | Trùng `name_norm` |
| 409 🟡 | `TAG_IN_USE` | Nhãn đang được một announcement sử dụng | Composite FK chặn hard-delete tag còn trong audience criteria |
| 409 🟡 | `ANNOUNCEMENT_ALREADY_DISPATCHED` | Announcement đã fan-out xong | Cancel sau `dispatched` |
| 409 🟡 | `IDEMPOTENCY_KEY_REUSED` | Mã thao tác đã được dùng cho yêu cầu khác | Cùng tenant+actor+`command_id` nhưng canonical request fingerprint khác |
| 422 🟡 | `CONTENT_POLICY_BLOCKED` | Nội dung có dấu hiệu lộ thông tin cá nhân/số tiền | DLP chặn (nếu NTF-OQ-11 chọn chặn cứng) |
| 400 🟡 | `INVALID_SUBSCRIPTION` | Đăng ký thông báo không hợp lệ | Thiếu endpoint/keys hoặc sai shape |
| 400 🟡 | `INVALID_REGISTRATION_ENVELOPE` | Đăng ký thông báo không hợp lệ | Envelope sai actor/signature/expiry/key version hoặc ciphertext digest mismatch |
| 409 🟡 | `SUBSCRIPTION_OWNERSHIP_CONFLICT` | Thiết bị đã gắn với tài khoản khác | Existing endpoint hash thuộc Person khác; yêu cầu proof-bound rebind riêng |
| 400 🟡 | `UNSUPPORTED_PLATFORM` | Trình duyệt không hỗ trợ thông báo | Client báo không hỗ trợ |
| 409 🟡 | `SUBSCRIPTION_STALE` | Đăng ký đã hết hiệu lực — bật lại | Gửi tới subscription `stale` |
| 401 🟡 | `TELEMETRY_CAPABILITY_INVALID` | Báo cáo telemetry không hợp lệ | Sai signature/scope/event, hết hạn hoặc replay khác payload |
| 400 🟡 | `CHAT_DIGEST_PREFERENCE_INVALID` | Tuỳ chọn thông báo chat không hợp lệ | Club value ngoài `all\|mentions\|off`, hoặc caller cố sửa actor/DM-derived default |
| 429 🟡 | `RATE_LIMITED` / `ANNOUNCEMENT_RATE_LIMITED` | Thao tác quá nhanh — thử lại sau | Vượt BL-SEC-5 |
| 409 🟡 | `ANNOUNCEMENT_PREVIEW_STALE` | Nội dung/audience/version đổi hoặc số người nhận tăng — xem trước lại | Proof hết hạn/mismatch; consumed bởi command khác; confirm/dispatch recompute tăng count hoặc route contract drift. Exact same-command replay trả kết quả cũ |

### Request/Response Examples (template v2.30 — chỉ §A, derivative)

> Minh hoạ envelope chuẩn DD-60 (`../../standards/api-reference-convention.md`) cho surface §A đã pin. Field name DTO trong `data` chưa pin — chốt ở build slice; ví dụ **không** thêm field/contract mới. Error codes lấy nguyên từ bảng Error Codes ở trên.

**POST `/api/notifications/send`** (🔑 exact capability — manual reminder):

- `200` — queued (shape `data` minh hoạ, DTO chốt ở slice):

```json
{ "data": { "intentsCreated": 3, "skipped": 1 }, "error": null, "meta": { "requestId": "req_…" } }
```

- `429` — cooldown đang hiệu lực:

```json
{ "data": null, "error": { "code": "REMINDER_COOLDOWN", "message": "Đã nhắc gần đây — thử lại sau", "statusCode": 429 }, "meta": { "requestId": "req_…" } }
```

- `403` — override không phải owner: `error.code = "OVERRIDE_REQUIRES_OWNER"`, cùng envelope.

**GET `/api/notifications/preview`** — `400` khi không có ai đủ điều kiện: `error.code = "NO_ELIGIBLE_RECIPIENTS"`, cùng envelope. Phần còn lại của §A (settled/correction/owner-alert pipeline) là worker/outbox-driven, không có HTTP surface để minh hoạ.

§B/C/D API examples: chưa author ở mức concrete slice — phải bổ sung trước strict `CODE_READY`; không dùng inventory target này làm runtime/API proof.

### Idempotency

| Endpoint | Idempotent? | Key |
|----------|-------------|-----|
| POST /notifications/send | ✅ | `intent_key` per recipient |
| POST /inbox/read 🟡 | ✅ | `(person_id, source_kind, source_id)` UNIQUE |
| POST /inbox/read-all 🟡 | ✅ | `UNIQUE(person_id,command_id)` receipt; boundary + all exact visible reads cùng transaction |
| InboxSignalProjector emit/invalidate 🟡 | ✅ | Source `intent_id` + version/sequence; **không insert item** |
| POST /announcements 🟡 | ✅ exact replay only | server-derived `command_scope_key UNIQUE` + structural `UNIQUE(tenant_id,created_by,command_id)` + stored request fingerprint + `preview_jti UNIQUE`; reused command mismatch = 409 |
| POST /announcements/:id/retry-failed 🟡 | ✅ exact replay only | command UNIQUE + versioned fingerprint; item receipt stores deterministic selected delivery/skip per intent before CAS under active fence |
| Fan-out intent 🟡 | ✅ | `announcement:{id}:person:{person_id}` |
| POST /memberships/tags 🟡 | ✅ | PK `(membership_id, tag_id)` |
| PUT /notifications/preferences/:tenantId 🟡 | ✅ | PK `(membership_id, type='announcement')` upsert; actor membership server-derived |
| PUT /notifications/chat-preferences/:channelId 🟡 | ✅ | Person+channel canonical upsert; exact desired state, actor server-derived; same state no-op |
| POST /push/subscriptions 🟡 | ✅ | `UNIQUE(actor_person_id,command_id)` + JTI receipt; same fingerprint returns fixed result, mismatch rejects. Shared key-epoch lock dual-reads aliases/rehashes one row; other-Person conflict is not upsert |
| POST /push/telemetry 🟡 | ✅ | Server-generated `(event_key,event_key_version)` + structural `UNIQUE(attempt_ref,event)` |
| Chat digest source/claim/finalize 🟡 | ✅ | Coalesce key `(person,channel,highest_unread_cursor)` + one pending generation/person+channel + one-live provider attempt; possible-write/unknown keeps key sticky |
| Delivery (mọi kênh) | ✅ | deterministic `delivery_key` + history-safe route-class UNIQUE + one-active-route partial UNIQUE; attempt one-live-planned-or-claimed partial UNIQUE |

---

## 4. Chi tiết triển khai

### 4.1 Pipeline Detail (§A)

1. **Scheduler** narrow-claims due tenants (`FOR UPDATE SKIP LOCKED`) in a **separate short transaction** that commits a lease; it carries no tenant/source/Person row lock into recipient processing. Defaults remain **2h → 24h → …**; auto=`reminders_auto`/`host_pro`, manual=free.
2. Per leased tenant, read-only discover eligible charges and complete recipient Person set without blocking locks.
3. Lock all recipient inbox fences UUID order; then lock/re-read charges/outbox/source rows, revalidate open/partial/cooldown/quiet-hours and Person set. Drift/unfenced recipient rolls back. Insert deterministic `notification_intents`; source+intent commit atomically where required.
4. **Dispatcher** read-only derives intent Person, locks that fence, then locks/revalidates intent and atomically creates one person-bound logical route. Messenger priority remains tenant Page → central Page → fallback; fallback only after old route proven-no-send and terminalized under the same locks.
5. **Target-set close + attempt claim:** dưới delivery lock, enumerate exact active same-Person target snapshot theo stable UUID, atomically materialize initial `claimed` row cho **mọi** target rồi set `target_generation/count/closed_at`; only then workers may start. Later target không join delivery này. Retry allocate next `attempt_seq` only for a target already pinned in generation; caller không truyền sequence/target secret.
6. **Pre-send gate:** ngay trước conditional `send_started_at`, re-read canonical type predicate + same-Person active route/reachability. Reminder=open/partial+current policy (explicit final notice nếu có); settled/correction=exact unsuperseded version+original bound Person; owner alert=current admin; announcement=current tenant/capability+eligible membership+no opt-out. Fail → attempt `proven_no_send`, intent/delivery terminal skipped reason, **không HTTP**.
7. **Channel Adapter** sends outside TX only while token/lease valid, then conditional-finalizes `sent|proven_no_send|unknown`. Logical finalizer locks delivery and counts only its closed generation; failed requires every pinned target proven-no-send. First success sets logical sent but does not invalidate other already-pinned claims, which may start/finish after fresh checks; it only forbids new target claims. Expired unstarted claim reuses same row; expired started claim becomes `unknown`. Không provider idempotency contract ⇒ không tự resend. Retry/fallback chỉ từ proven no-send; unknown fail closed/no alternate Page.

### 4.2 Waitlist derivation failure alert (DD-45)

1. Claim a tenant candidate-audit event in a separate short lease transaction, then release all blocking locks. Payload is opaque `failure_event_id`, `promotion_retry_id`, `session_id`, `player_id`, `waitlist_entry_version`, root `origin_command_id`, `reason_code`. SessionService scheduler/worker independently owns and claims the lazy CAS/lease root job keyed by `(tenant,session,origin)` with max 3 claimed attempts; notification never schedules/claims/settles it or counts attempts.
2. Projector read-only resolves the current active owner/admin Person through the narrow identity service, locks that Person inbox fence, then locks/re-reads root + candidate audit rows and re-resolves. Drift/unfenced Person rolls back; unresolved recipient records `OWNER_RECIPIENT_UNRESOLVED`. Valid path inserts deterministic `owner_alert` intent key `waitlist-charge-derivation-root:{promotion_retry_id}`; sibling/duplicate event is a no-op for user-facing intent. Outbox/audit remains durable and independent of domain retry.
3. Digest aggregates server-side candidate count + closed reason classes for that root, with no player PII, amount, gender, venue or decrypted error detail. Candidate receives no promotion notification because state remains waitlisted. A root transition to terminal may create a separate deterministic `waitlist-charge-derivation-terminal:{promotion_retry_id}` owner-review intent.
4. This projector **does not run promotion retry and candidate event delivery does not drive job state**. SessionService scheduler claims the root job independently and re-enters exact tenant context before `session→job` domain work under DD-45.

### 4.3 Quiet Hours

- Use tenant timezone — not UTC.
- DST-aware: recalculate windows when timezone transitions.
- Scheduler jitter prevents provider bursts.

### 4.4 Đường đọc inbox 🟡 — thứ tự bắt buộc

1. Resolve `person_id` từ session đã verify.
2. Verify opaque cursor signature và exact `person_id + filter_hash`; cursor chỉ mang `before_sequence`, không nhận raw actor/source state.
3. **Tenant plane:** mỗi tenant còn authorize → `withTenant` → select `notification_intents` theo person/filter và `inbox_sequence < before_sequence`. Loại tenant trước query.
4. **Global plane:** narrow function query cùng person/filter/sequence; không nhận person tuỳ ý.
5. Merge theo `inbox_sequence DESC` ở service; sequence server-global tạo total order hai plane. Mint exact visible-ref capability rồi gọi `notif_read_state_for_visible`; apply only returned exact `notification_reads` rows, không SELECT raw global table.
6. System copy derive fixed key từ enum `type`; subject detail batch-resolve từ authorized source. Không đọc arbitrary template params.

Đã đọc **chỉ khi** có exact row `notification_reads(person_id,source_kind,source_id)`; receipt boundary không bao giờ là read authority.

**Merge Person:** transaction starts with read-only notification/push collision inventory, including rebind challenges and the post-dedupe active-device count, then locks source+survivor inbox fences UUID order; if push rows exist it holds lookup-key epoch `FOR SHARE`, acquires all sorted Person/command/challenge/proof/evidence/alias advisory keys, then locks Person/source rows and repeats inventory. Drift rolls back. This follows the common `candidate read → inbox fences → key epoch → advisory keys → Person/source → child` hierarchy. Before re-parent, execute `SET CONSTRAINTS notification_deliveries_intent_tenant_person_fk, notification_deliveries_identity_platform_person_fk, psrr_subscription_person_fk, pste_target_person_fk, pste_source_person_fk DEFERRED`. Atomically mark every pending/acknowledged rebind challenge touching source/survivor `invalidated/person_merge`; it cannot later mint/consume a proof. Person/account merge never calls the rebind evidence/consume path and creates **zero** rebind receipts; it is the separate ownership-reparent lifecycle. Then inventory/re-parent every live Person FK: intents, identities/deliveries, global items, explicit reads/non-colliding read-all receipts, tag/announcement/quota/retry actors, subscriptions, registration receipts/trust events, **consumed challenge requester FK**, and fence. Immutable challenge/receipt requester/current-owner/target/evidence refs never change. Dedupe explicit reads only by exact source key. If the two Persons share any read-all `command_id`, announcement quota/retry command key or push `(actor,command)`, merge halts/manual even if bytes match; without an alias ledger it never collapses/drops/rekeys a replay receipt. If unique active endpoints after deterministic duplicate grouping exceed `push_subscription_limits.max_active_web_per_person`, merge also HALTs/manual and never deletes arbitrary devices. Unconsumed loser envelope/proof fails through merge tombstone/session invalidation; exact consumed replay is allowed only after canonical-survivor mapping + original fingerprint/actor check.

Mọi subscription được re-parent — kể cả endpoint không duplicate — increments its own `trust_epoch` and clears `trusted_at/trust_source`; duplicate endpoint group keeps one row with epoch `GREATEST(group)+1` and deletes losers. Receipt/trust-event live pointer that referenced a deleted loser becomes NULL; it **never re-points to the survivor UUID**, while immutable response/target/source refs and JTI/evidence remain unchanged. Read-all boundary remains audit only; survivor fence keeps `GREATEST(last_sequence)` so sequence never moves backward. Commit only when same-Person delivery/receipt/event FKs, deferred rebind completion guards, challenge invalidation, active-limit check and collision inventory all pass.

### 4.5 Audience resolution 🟡 (tại dispatch, dưới `tenantRepo`)

```sql
-- mode='all'
SELECT m.person_id FROM memberships m
WHERE m.tenant_id = current_tenant()
  AND (m.status = 'active' OR ($include_guests AND m.status = 'guest'));

-- mode='any_tag' (OR); tag criteria lấy từ normalized audience rows,
-- không nhận uuid[] tuỳ ý từ worker.
SELECT DISTINCT m.person_id FROM memberships m
JOIN membership_tag_links l ON l.membership_id = m.id AND l.tenant_id = m.tenant_id
JOIN announcement_audience_tags aat
  ON aat.tag_id = l.tag_id AND aat.tenant_id = l.tenant_id
WHERE aat.announcement_id = $1
  AND m.tenant_id = current_tenant()
  AND (m.status = 'active' OR ($include_guests AND m.status = 'guest'));

-- mode='all_tags' (AND)
SELECT m.person_id FROM memberships m
JOIN membership_tag_links l ON l.membership_id = m.id AND l.tenant_id = m.tenant_id
JOIN announcement_audience_tags aat
  ON aat.tag_id = l.tag_id AND aat.tenant_id = l.tenant_id
WHERE aat.announcement_id = $1
  AND m.tenant_id = current_tenant()
  AND (m.status = 'active' OR ($include_guests AND m.status = 'guest'))
GROUP BY m.person_id
HAVING count(DISTINCT l.tag_id) = (
  SELECT count(*) FROM announcement_audience_tags WHERE announcement_id = $1
);
```

RLS đã fence `tenant_id`; điều kiện `tenant_id` tường minh trong join là **defense-in-depth**, không thay RLS. Sau khi resolve tag, query phải anti-join `membership_notification_preferences` với `type='announcement' AND opted_out=true`; re-check này chạy **tại dispatch**, không chỉ lúc preview. Preference lookup dùng `membership_id + tenant_id`, không dùng person-global mute để vô tình tắt reminder/settled.

**Preview/confirm proof:** `/api/announcements/preview` canonicalize `{body,session_ref,cta_kind}` + normalized audience criteria, resolve exact route vector, rồi ký opaque proof chứa `jti, tenant_id, actor_id, content_hash, audience_criteria_hash, count_by_channel, total_count, contract_version, routing_policy_version, expires_at`. Phase-1 `cta_kind` chỉ là `none|view_session`; `view_session` bắt buộc same-tenant `session_ref`. Vector chỉ có keys `web|zalo|messenger|unreachable`, integer không âm, sum đúng. Proof không chứa roster/tag name/body. Confirm verify signature/expiry, derive actor+tenant từ session, re-authorize, recompute hashes/vector và queue canonical row **gồm body+session_ref+cta_kind** + audience criteria. Dispatcher chỉ đọc canonical row, không nhận lại CTA từ client. `request_fingerprint = HMAC(domain='announcement-request', canonical_json([preview_jti,content_hash,audience_hash,vector,versions]))` được lưu để phân biệt exact replay. Proof consumed bởi cùng command+fingerprint trả existing result; proof/command reuse khác context reject. Không có đường queue không mang proof.

**Quota reservation tại confirm:** after read-only proof/candidate validation, lock actor inbox fence **before** structural `(tenant_id,created_by,command_id)`, quota bucket or announcement rows. Re-derive actor/tenant after fence; drift rolls back. Existing receipt compares stored key versions: same fingerprint returns same result; mismatch → `IDEMPOTENCY_KEY_REUSED` before reserve. New command derives versioned `command_scope_key` + reservation key; transaction locks canonical tenant/actor/fan-out bucket keys in order, counts unexpired committed reservations, then inserts reservation+announcement atomically. Outage/timeout/budget reject; deferred trigger forbids orphan `reserved`; janitor releases only after proof expiry+grace and canonical announcement absence. Audience decrease no refund; retry no second charge; rotation replay resolves stored version.

### 4.6 Fan-out worker 🟡 (announcement)

1. Mở bounded `REPEATABLE READ`; read-only select one candidate `queued` id **without** `FOR UPDATE/SKIP LOCKED` and hold no blocking lock. Read provisional immutable announcement/audience, creator and current recipient/route set.
2. Compute `candidate_person_ids = {created_by} ∪ recipients`; call owner-only `notif_lock_inbox_fences_ordered()` for distinct UUIDs ascending. Helper create+locks each fence sequentially; no set-wise pre-upsert.
3. Only after all fences, lock the exact announcement `FOR UPDATE`, re-authorize creator/tenant, re-hash content+criteria and re-resolve full audience/routes. Row no longer `queued`, serialization change, or affected Person set differs/adds an unfenced UUID ⇒ rollback and retry from read-only discovery; never append a late/lower fence.
4. Apply terminal reason under the locked revalidation in exact precedence: TTL → tenant inactive → creator authorization revoked → tag missing → schema/policy/vector drift → audience empty. `preview_expires_at` gates confirm/replay only. Any terminal result stores four zero counts + recipient_count=0 and no intent.
5. If valid, component/total increase or contract drift rejects `preview_stale`; only component-wise decrease under same schema/policy passes. Set-wise insert intents + pinned person-bound routes. Unreachable gets skipped intent/no fake delivery. Store actual vector, set `dispatched` + `fanout_completed_at`, commit.
6. Concurrent workers that discovered the same candidate serialize at fences/announcement; loser sees changed state and restarts. Provider dispatch is after commit. V1 threshold remains 500; larger future fan-out needs durable generation, not paged TOCTOU.

**Retry-failed:** request mang actor-scoped `command_id`. Read-only discover actor + affected intent Persons, lock all their fences first, then lock announcement/intents UUID order and rederive the same set; drift/new Person rolls back. Exact receipt replay returns stored item results. New command rejects any `pending|sent|unknown`; terminal failed set is fresh-filtered, canonical-policy ranked, persisted as selected delivery/fixed skip before one-route CAS. No caller-selected recipient/platform and no second fan-out quota.

### 4.7 Web push 🟡 — đăng ký và gửi

**Provider boundary:** phase-1 dùng direct standards-based Web Push + VAPID qua một `WebPushProvider` port. VAPID là application-server authentication; browser-selected push service vẫn ở data flow, nên A3 ghi nhận encrypted payload/traffic metadata. Không app-level vendor platform/SDK adapter (vd OneSignal hoặc Firebase Messaging integration) trong phase-1; native provider port chờ DD-69 spike.

**Đăng ký:** SW POST raw subscription + actor-scoped UUID `Idempotency-Key`, no `person_id`. Boundary validates/redacts, derives aliases/ciphertext and mints actor+command+fingerprint+JTI envelope. `push_sub_register_self` performs read-only owner discovery, locks actor+candidate-owner inbox fences, then key epoch `FOR SHARE`, then all sorted advisory command/JTI/proof/alias keys; it reselects owner and restarts on drift. Durable receipt replay precedes mutation. Only a new accepted external command mutates one row, increments epoch and resets trust once; fresh envelope/JTI for an accepted command is receipt-only. Other-Person conflict writes opaque receipt with zero subscription mutation; proof-bound rebind consumes unique JTI+expiry. Safe response never echoes secrets/trust fields.

**Nâng trust:** UI submits only signed one-time proof bound to current epoch. After signature/canonical verification and read-only owner discovery, DB locks all affected inbox fences, then sorted proof/evidence/target/source advisory keys. It checks exact consumed JTI **before** current epoch: replay returns historical event only. New proof re-locks/revalidates same-Person target/source, expiry, current epoch and evidence; owner-set drift restarts. Event + subscription update share one `transaction_timestamp()`. No direct trust-field endpoint.

**Gửi:** dispatcher chọn person-bound Web route → `app_worker` resolves same-Person active subscriptions. Mỗi target có one-live attempt; `notification_attempt_start` performs the type-specific gate + `send_started_at` CAS as the authorization point, then worker resolves secret and calls HTTP. Read persisted `topic_token/topic_key_version`, never recompute on retry; sign versioned `report_cap` expiring `send_started_at+24h`. Logical outcome: `sent` if ≥1 success; `failed` only all proven no-send; `unknown` if no success + ambiguous/started-lease-expired. Tenant automatic unknown recovery only `settled|correction` ≤2; global security alert awaits DD-70 owner; announcement/reminder have **no automatic unknown-recovery claim** and remain manual reconcile.

**Service worker (`apps/web` chưa có):** mechanism 39 thêm tracked `manifest.json` + installable shell/registration boundary; mechanism 41 sở hữu generic display, deep-link và scoped telemetry client sau registration client 40. Trong `event.waitUntil`, SW phải **await `showNotification({tag:t})` thành công trước**, rồi mới POST `delivered`; display reject không ghi delivered. `notificationclick` POST `opened` rồi deep-link. Capability allow đúng hai event tới `send_started_at+24h`; retry no-op, ngoài set/scope/hết hạn reject. **SW không cache response chứa tiền/PII**.

### 4.7a Offline Chat digest 🟡 — DD-94 source/coalesce/pre-provider boundary

1. **Source adapter (Chat-owned read proof):** after a canonical message makes a person/channel cursor unread, Chat emits only `{person_ref, channel_ref, highest_unread_cursor, trigger_kind}`. `trigger_kind` is closed to `dm|direct_mention|reply|club_activity`; no message/body/title/amount/mention text/author/attachment/club name enters the handoff. Slash/private overlays and Assistant query rows never emit.
2. **Preference decision:** DM defaults ON. Club activity reads one Person+channel desired state `all|mentions|off`; absent row resolves `mentions`, which enables direct mention/reply by default. `off` suppresses them and `all` broadens to eligible activity. Invalid values reject at write; unavailable/unknown preference authority yields no route.
3. **Coalesce:** under the person+channel owner lock, same/lower cursor is no-op and a higher cursor advances the one pending generation. Dedupe fingerprint binds `(person_id,channel_id,highest_unread_cursor,contract_version)`. It is delivery state only: never insert `notification_intents`, `person_notifications`, `notification_reads` or a row per source message.
4. **Claim/key stability:** once `send_started_at` can be set, the exact logical key/cursor is immutable. Retry, ambiguous provider result and `unknown` reuse that key/topic; no new route or blind resend. A later higher cursor can occupy only one successor pending generation.
5. **Immediate pre-provider proof:** re-read configured route state, then call Chat to prove current unread cursor + channel/DM read authority; re-check current club membership or DM pair block+safety, exact preference, active subscription/current `trust_epoch` and permission. Check runs immediately before secret resolution/provider HTTP. Any false/unknown condition terminal-skips with bounded reason `read|auth_revoked|blocked|preference_off|device_unavailable|trust_epoch_changed|config_off`.
6. **Mark-read cancellation:** Chat mark-read invalidates older pending cursors. Queue cancellation is an optimization only; the pre-provider proof is mandatory and authoritative, so a race cannot send a known-obsolete digest.
7. **Provider payload:** use the §2.6 generic Web Push allowlist with a Chat-specific fixed `i18n_key` and opaque deep-link ref. No content/actor/channel name is rendered at OS level; authenticated app open re-authorizes Chat and fetches current history.
8. **Enablement:** delay/coalesce/cooldown are named configuration. Missing config, disabled flag or unpassed privacy/concurrency matrix means no source route/claim. This does not disable Chat history/reconnect/unread/badge or DD-91 payment notification paths.

### 4.8 Timeout/Expiry Spec 🟡

| Variant | Giá trị | Lý do |
|---------|---------|-------|
| Atomic fan-out transaction timeout | 30s, cấu hình dưới DB statement timeout | Crash/timeout rollback về `queued`; không có `sending` lease/stale worker |
| Announcement TTL (queued → bỏ) | 24h | Nội dung CLB hết ngữ cảnh sau 1 ngày |
| Physical send-attempt lease | 60s, > provider timeout | Unstarted expiry reclaim được; expiry sau `send_started_at` ⇒ `unknown` |
| Push request timeout | 10s | Không giữ worker; nếu timeout xảy ra sau write thì outcome=`unknown`, không giả định no-send/fallback |
| Unknown reconciliation window | initial 5 phút, cấu hình | Chờ telemetry/receipt; hết cửa sổ mới áp class-aware same-route policy, alternate-route vẫn cấm |
| Tenant high-value same-route retries | tối đa 2 | `settled\|correction`; global `security_alert` chờ exact attempt owner/lifecycle ở auth-security enablement slice |
| Subscription stale sau | 3 fail liên tiếp **hoặc** 1 lần `410` | `410` là bằng chứng chắc; fail mềm cần lặp lại |
| Prune subscription secret row | Chỉ `stale\|revoked`; latest lifecycle transition/`last_success_at`/`created_at` ≥180 ngày; no live attempt/report cap | Xoá secret trước, SET NULL live audit pointers; receipts/trust events theo retention riêng NTF-OQ-15 |
| Telemetry latency window | 24h sau `send_started_at` | Có anchor kể cả ambiguous; sau đó expired, không tính latency |
| Report capability expiry | đúng `send_started_at + 24h` | Timestamp ký được trước HTTP; sau đó reject, không phải auth token |
| Chat digest delay/coalesce/cooldown | Named enablement config; không có built-in production default | Missing/disabled/untested ⇒ route OFF; core Chat unread và payment Notification vẫn chạy |

### 4.9 Caching Strategy

| Data | Cache? | TTL | Invalidation |
|------|--------|-----|-------------|
| Unread badge 🟡 | ✅ per person | 30s | Mark-read/mark-all/insert intent hoặc global event |
| Inbox page 1 🟡 | ❌ | — | Quyền đổi runtime → không cache nội dung |
| Tenant membership set 🟡 | ✅ UI/count only | 60s | Dispatch full-vector query **không dùng cache** |
| Tag list + count / tenant 🟡 | ✅ | 60s | Khi tag/link đổi |
| Announcement preference 🟡 | ❌ | — | Re-check fresh tại dispatch; không cache opt-out |
| Audience count preview 🟡 | ✅ theo hash tiêu chí | 10s | — |
| **Audience member list + exact routes** 🟡 | ❌ | — | Consistent snapshot trong atomic dispatch (edge #42) |
| Announcement report 🟡 | ✅ | 15s | Khi delivery đổi trạng thái |
| VAPID public key 🟡 | ✅ | 1h | Rotation |
| **Resolved endpoint+keys** 🟡 | ❌ | — | **Không cache secret ngoài request scope** |
| Reliability dashboard aggregate 🟡 | ✅ | 5m | Rolling window |
| Chat digest preference/unread proof 🟡 | ❌ | — | Re-read immediately before provider write; cache cannot authorize send |

### 4.10 Security Checklist (template v2.33 — map về section đã pin)

| Mục | Trả lời trong spec |
|-----|---------------------|
| Authorization/ownership | §A: person-bound composite FKs `(intent_id,tenant_id,person_id)` + `(channel_identity_id,platform,person_id)` (§2.1) và type-specific pre-send predicate ngay trước `send_started_at` (§2.1; §4.1 bước 6). API: auth legend DD-60/DD-47 (§3) — endpoint person-self không nhận `person_id` từ request. §B/C/D: DD-70/72 owner-final no-blanket-grant + narrow `SECURITY DEFINER`/capability functions (§2.5). §E: Chat unread/authz + membership/DM safety/preference/device/trust proof immediately before provider write (§4.7a); runtime pending |
| Injection/validation | §A: server-derived versioned `intent_key`/`delivery_key`, API/DB write luôn parameterized (§1, §2.1). §C: DD-71 owner-final target giữ host body untrusted plain text — canonicalize UTF-8/newline, reject control chars + `octet_length(body)>16384` ở cả API và DB CHECK; tag `name_norm` do versioned trigger derive, không nhận từ caller (§2.3; edge #63); runtime pending |
| Secret & log redaction | Raw provider body/header/endpoint/error string không được persist/log (§2.1 finalizer); `target_ref` chỉ là ciphertext audit, không phải routing authority (§2.1). §D: DD-72 owner-final endpoint/keys KMS-encrypted (`*_enc`), secret chỉ resolve qua worker-only `push_sub_resolve_for_started_attempt`; registration boundary redact raw subscription khỏi log/error (§2.4; §2.5 Registration crypto boundary). Push payload không tiền/PII — CI invariant trên `buildPushPayload()` (§2.6). §E additionally forbids message/body/title/amount/mention/author/attachment/club name in source/job/storage/provider payload (§4.7a); runtime pending |
| Webhook signature + replay | Doc này **không có inbound provider webhook** (provider outcome đọc từ synchronous HTTP response; bank webhook thuộc `feature_payment_reconcile_tech.md`). Tương đương chức năng theo DD-71/72 owner-final: signed proof/capability — preview proof + `preview_jti` consume-once (§2.3; §4.5), registration envelope + JTI (§2.4; §2.5), `report_cap` write-only hết hạn `send_started_at+24h` + structural `UNIQUE(attempt_ref,event)` replay fence (§2.4; §2.6); runtime pending |
| Idempotency | Bảng Idempotency ở §3 (tổng hợp canonical) + structural UNIQUEs §2.1: `intent_key`, `delivery_key`, history-safe `(intent_id,route_class)`, one-active-route partial, one-live-attempt partial |
| Data retention/xoá | §D: secret-row prune 180 ngày fail-closed; replay/audit ledgers giữ theo cửa sổ riêng, deletion OFF tới NTF-OQ-15/16 approval. Tenant Inbox v1: no mark-unread/archive/user-delete/hard purge; correction/read audit retained and cleanup OFF. §E stores only coalescing/delivery evidence, never message content or per-message item; Chat text retention remains Chat-owned |

---

## 5. Testing Plan

### Unit Tests

| # | Area | Test | Input | Expected |
|---|---|------|-------|----------|
| 1 | Reminder | Eligible: open charge | Charge status=open | Eligible |
| 2 | Reminder | Eligible: partial charge | Charge status=partial | Eligible (remaining amount) |
| 3 | Reminder | Not eligible: paid charge | Charge becomes paid after claim, before `send_started_at` | Pre-send skip, no HTTP |
| 4 | Reminder | Not eligible: void charge | Charge becomes void after queue | Pre-send skip, no HTTP |
| 5 | Reminder | Left membership eligible | Current policy explicitly allows final notice | Eligible at pre-send gate |
| 6 | Reminder | Left membership not eligible | Current policy disallows final notice | Pre-send skip, no HTTP |
| 7 | Reminder | Quiet hours active | Send time in quiet window | Defer |
| 8 | Reminder | Quiet hours DST boundary | Timezone transition | Correct window |
| 9 | Reminder | Cooldown active | Last remind < cooldown | Skip |
| 10 | Reminder | Max count reached | N reminders sent | Skip |
| 11 | Reminder | Manual override no reason | Owner override without reason | Reject |
| 12 | Reminder | Settled confirmation version/Person fence | Exact event vs superseded version hoặc wrong bound Person before HTTP | Exact emits once; stale/wrong skips with no HTTP |
| 13 | Reminder | Reversal after settled | Exact correction vs superseded reversal version | Exact correction send; superseded pre-send skip |
| 14 | Reminder | Duplicate intent | Same charge + version | No-op (UNIQUE conflict) |
| 15 | Reminder | Duplicate delivery | Same intent + platform | No-op |
| 16 | Reminder | Transient provider error | 500 error | Retry with backoff |
| 17 | Reminder | Rate-limit error | 429 + retry-after | Honor retry-after |
| 18 | Reminder | Permanent error | Blocked/invalid | Mark unreachable |
| 19 | Reminder | Group privacy check | Amount in group template | Blocked by policy |
| 20 | Reminder | Tenant+Person isolation | Tenant A/Person A intent + Tenant B or Person B identity delivery, owner/bypass-RLS fixture | Person-bound composite FKs reject before adapter; not merely hidden by RLS |
| 21 | Reminder | Waitlist derivation owner alert dedupe | Resolvable owner + same failure event twice | Exactly one `owner_alert` intent; no candidate delivery |
| 22 | Reminder | Failure alert privacy | Event includes opaque ids + reason | No amount/gender/venue/PII in intent/template/log |
| 23 | Reminder | Owner unresolved/revoked before send | Admin key has no identity match; hoặc recipient mất admin sau queue | Unresolved projector skipped/DLQ; revoked pre-send skip/no HTTP; domain retry unaffected |
| 24 | Reminder | Both Messenger endpoints reachable | tenant + central windows open | One tenant-Page delivery; central suppressed by same logical key |
| 25 | Reminder | Tenant endpoint closed | tenant closed, central open | One central-Page delivery; no tenant token reuse |
| 26 | Reminder | Cross-Page PSID collision | same PSID text on two Pages | Exact Page-bound identity selected; no collision/misroute |
| 27 | Reminder | Unknown provider/crash outcome | timeout hoặc kill worker sau `send_started_at`, lease expires | Durable attempt/logical delivery unknown; no resend/alternate Page |
| 28 | Reminder | Cross-bot Zalo id collision | same `from.id` text on two bot/OA scopes | Distinct endpoint-bound identities; no cross-bot route/token reuse |
| 29 | Reminder | Cross-platform identity FK | Messenger delivery references a Zalo identity | Composite `(channel_identity_id, platform)` FK rejects |
| 30 | Reminder | No independent Page authority | Identity belongs to Page A; request/body supplies Page B | Request is rejected at API boundary; resolver accepts only identity id and returns only Page A secret |
| 31 | Reminder | Live-schema upgrade | Apply new migration to fixture at `0008` shape | `tenant_id` retained; new writes fenced while constraints are `NOT VALID`; clean legacy data validates without loss |
| 32 | Reminder | Dirty legacy tenant link | Existing delivery tenant differs from its intent tenant | Migration audit halts before validation/cutover; no automatic tenant rewrite |
| 33 | Reminder | Unprovable legacy endpoint | Historical Messenger/Zalo row lacks exact endpoint evidence | Row remains quarantined/non-sendable; migration does not guess identity or Page/bot-OA |
| 34 | Reminder | Tampered legacy target snapshot | `target_ref` conflicts with exact identity recipient | Adapter ignores it for routing; resolver returns endpoint + recipient from identity or fails closed |
| 35 🟡 | Inbox | Grant fence global/reads/fence | `app` SELECT global tables hoặc nextval inbox sequence | Permission denied (role thật) |
| 36 🟡 | Inbox | Narrow list/read-state functions | List mints exact visible cap; app asks reads for returned refs + foreign ref; cap B under session A | Only actor-visible rows/read intersection; foreign ref absent, cap mismatch rejected; no raw SELECT/existence oracle |
| 37 🟡 | Inbox | Owner-derived source + security boundary | Duplicate `(type,source_event_id)` across key rotation; app generic emit; non-security row sets only one context field; forged/post-mutation context; long-lived session trusts X then triggers event | Structural one item; generic emit denied; partial/invalid provenance rejected; X excluded dù `factor_at < event_at`; only factor predating context start selected |
| 38 🟡 | Inbox | Mark-read idempotent / item lạ | Gọi 2 lần / missing / source người khác | 1 read row / missing và unauthorized cùng byte-identical 404, no orphan |
| 39 🟡 | Inbox | Visible-set completion/late commit | Begin→commit; one-plane→commit; empty global+0 tenants; missing/duplicate/extra step; 2 tab + hidden/late item; direct step DML | Incomplete commit rejected and leaves 0 rows; empty completes; manifest mismatch rejects; replay only completed receipt; DML denied; hidden/late unread |
| 40 🟡 | Inbox | Badge sau mark-all + item mới | mark-all rồi insert 1 | Badge 0 → 1 |
| 41 🟡 | Inbox | Tenant isolation | Person thuộc A, item của B | Không xuất hiện (test cô lập A/B) |
| 42 🟡 | Inbox | Left membership / admin revoke / void charge | Đổi trạng thái sau khi tạo item | Item biến mất/ẩn tại read time; không hiện số nợ cũ |
| 43 🟡 | Inbox | No-PII/no-arbitrary schema | Bypass insert `{"note":"Tuấn nợ 150k"}` | Không có params column; schema/sole builder reject, fixed type derives copy |
| 44 🟡 | Inbox | Global no tenant column | Introspect `person_notifications` | Không cột `tenant_id`/money |
| 45 🟡 | Inbox | Person deleted/merged | status deleted/merged | Không tạo/không trả; merged → chỉ survivor |
| 46 🟡 | Inbox | Merge explicit-read/receipt safety | A có receipt boundary cao, B có unread sequence thấp; duplicate explicit read; same read-all `command_id` | Dedupe only exact reads. Re-parent non-colliding completed receipts; any read-all command collision halts/manual (no alias ledger). Boundary A không mark item B; survivor fence không lùi |
| 47 🟡 | Inbox | Cursor tamper / total order | Same timestamp/id cross-plane; cursor actor/filter khác / hỏng | Sequence order không trùng; mismatch/hỏng → 400 `INVALID_CURSOR` |
| 48 🟡 | Inbox | N+1 guard | 50 item / 5 tenant | ≤ 5 lần `withTenant` |
| 49 🟡 | Inbox | Signal projector fail isolation | InboxSignalProjector throw | Tenant item vẫn query được; chỉ SSE/badge cache trễ; ledger/deliveries không đổi; DLQ ghi nhận |
| 50 🟡 | Inbox | Not-found opacity | Item của người khác | 404 **byte-identical** với không tồn tại |
| 51 🟡 | Inbox | Follow-request payload | Item follow_request | Chỉ DD-48 approved fields |
| 52 🟡 | Announce | Tag cross-tenant | Gán tag A cho membership **hoặc announcement audience** B | Cả hai composite FK reject (kể cả bypass-RLS fixture) |
| 53 🟡 | Announce | Tag canonical norm/tamper | " Nữ " vs "nữ"; bypass supplies fake `name_norm` | Trigger derives same norm, ignores supplied value; `TAG_NAME_EXISTS` |
| 54 🟡 | Announce | Tag không lộ public | Introspect projection public | Không cột/nguồn tag (HR2) |
| 55 🟡 | Announce | Tag không mở eligibility | Join service với tag | Không ảnh hưởng kết quả join (BL-NTF-4) |
| 56 🟡 | Announce | Audience `all` / `any_tag` / `all_tags` | 10 active+2 left; X∪Y; X∩Y | 10; 4 distinct; chỉ người đủ 2 tag |
| 57 🟡 | Announce | Guest excluded/included | `include_guests` false/true | Không nhận / nhận |
| 58 🟡 | Announce | Audience rỗng | Rỗng tại preview / bypass-service insert proof count 0 / trở thành rỗng tại dispatch | Preview trả `EMPTY_AUDIENCE`; DB reject `preview_recipient_count=0`; dispatch ghi `cancelled/audience_empty`, không tạo intent hay báo sent |
| 59 🟡 | Announce | Tag xoá trước dispatch | Hard-delete tag đang được queued audience tham chiếu | FK reject + `TAG_IN_USE`; nếu soft-delete/corrupt fixture làm tag missing thì `cancelled/audience_tag_missing` + `AUDIENCE_TAG_MISSING`, **không** gửi toàn CLB |
| 60 🟡 | Announce | Proof/immutability/reason precedence | Direct DML content/audience; same/different fingerprint; queued TTL+tenant/auth/tag/drift combinations; crash expansion | DML rejected; replay/mismatch exact; terminal reason precedence deterministic; crash rollback queued/0 intent |
| 61 🟡 | Announce | Dispatch + pre-send fresh auth | Member/guest/opt-out/route/host cap changes after queue and again after fan-out before HTTP | Dispatch increase/drift cancels before intent; post-fan-out invalid recipient/capability pre-send skips, no HTTP |
| 62 🟡 | Announce | Cancel race atomic fan-out | Cancel and expansion contend on same row | Exactly one terminal: cancelled+0 intents or dispatched; late cancel gets already-dispatched |
| 63 🟡 | Announce | Retry command/route fence | Concurrent commands; active outcome; two historical failed platforms with policy tie; route revoked | Replay stored items; active outcome no send; policy-rank+UUID stores/CAS one route; invalid stores skip/no HTTP |
| 64 🟡 | Announce | Quiet hours + DST | Dispatch trong quiet window; đổi timezone | Defer; cửa sổ đúng tenant timezone |
| 65 🟡 | Announce | Opt-out owner + boundary | Member-self upsert preference rồi dispatch; thử type=`reminder`/`settled` | Announcement skip `OPTED_OUT`; schema reject type khác; host/person khác không sửa được preference |
| 66 🟡 | Announce | DLP cảnh báo | Body "Tuấn nợ 150k" | `announcement_dlp_warned`; hành vi theo NTF-OQ-11 |
| 67 🟡 | Announce | Analytics/report no content | Mọi event; report Messenger | Không body/tên/tên tag; chỉ `route_class` |
| 68 🟡 | Announce | Provider fail không rollback | Toàn bộ delivery fail sau fan-out | `announcements.status='dispatched'`; report derive toàn bộ `failed`, canonical row không rollback |
| 69 🟡 | Announce | Durable layered quota / input shape | Concurrent tenant/actor/fan-out budget; crash reserve→announcement; body ""; `mode='all'`+tags | Ordered locks + structural reservation prevent overrun; crash leaves neither; exact validation errors |
| 70 🟡 | Announce | Tenant isolation report | Host B đọc report của A | Không thấy (RLS) |
| 71 🟡 | Push | Payload allowlist/deny-list/rendered string/topic token | Khoá ngoài `{v,ref,t,k,p}`; `amount`; chuỗi đã render; raw ref/HMAC hex hoặc `t` >32/ngoài base64url; `t` đổi giữa recovery | CI invariant fail; `t` đúng 32 ký tự base64url, opaque và stable được giữ |
| 72 🟡 | Push | Grant/attempt lifecycle fence | app/worker SELECT or DML; app calls owner global helper; worker invalid claim/start/finalize token | Direct access denied; exact funcs only. Start fresh-check+CAS once; stale predicate no HTTP; finalize token/lease guarded |
| 73 🟡 | Push | External command/JTI boundary | Two absent-row transactions share command/JTI/alias; response lost then retry same Idempotency-Key with fresh envelope; altered command/JTI; tampered/expired; inspect logs | Sorted advisory locks serialize absence; exactly one mutation/receipt. Same command fixed receipt/no second epoch reset; mismatch zero mutation; safe output/log only |
| 74 🟡 | Push | Person/crypto authority | Body khai person/hash/ciphertext/key version khác envelope | Actor + crypto fields derive/verify from trusted boundary; caller values ignored/rejected, never authority |
| 75 🟡 | Push | Endpoint mã hoá | Đọc row thô | `endpoint_enc` là bytea |
| 76 🟡 | Push | Ownership/trust epoch lifecycle | Same endpoint new command; rebind by verified prior-owner reauth/manual recovery; forged requester/SW evidence; reuse proof; merge with pending/ack challenge; consumed trust proof replay after epoch N+1 | New command resets once. Only the two closed rebind evidence kinds authorize; proof binds current owner/requester/target/alias/epoch/command/expiry and consumes once. Forgery rejects. Merge invalidates unconsumed challenges, re-parents/resets without a rebind receipt. Exact consumed replay returns history without current mutation; stale/duplicate evidence rejects |
| 77 🟡 | Push | Phase-1 shape | `web` thiếu p256dh/auth; client gửi `kind='native'` | CHECK/API reject cả hai; không tự tạo native contract |
| 78 🟡 | Push | Multi-device closed generation | 3 active; planner cạnh tranh registration target thứ 4; first target success khi hai claim chưa start | One snapshot pins count=3 hoặc 4 atomically; later registration excluded. First success→sent nhưng every already-pinned claim may finish; no new target claim after closure |
| 79 🟡 | Push | Một/tất cả thiết bị proven-fail | One target fails before another worker starts; 1 fail+2 success / all pinned proven no-send | Early failure cannot finalize while pinned rows nonterminal; `sent` on any success / `failed` only exact target_count proven-no-send → fallback only latter |
| 80 🟡 | Push | Outcome + same-target recovery race | 410/no-send/429/ambiguous; two workers same subscription | Stable target/live-claim fence leaves one claim; settled/correction only ≤2; global security TBD and announcement/reminder no automatic unknown-recovery claim |
| 81 🟡 | Push | Ledger untouched + inbox fallback | Toàn bộ proven-fail / có ambiguous | Ledger không đổi; item vẫn ở inbox; proven-fail fallback; ambiguous chỉ class-aware same-route recovery, không alternate route |
| 82 🟡 | Push | Telemetry privacy/cap/display/rotation | Duplicate delivered after unknown; rotate signing key; cap at 24h boundary; `showNotification` rejects | Cap `kid` resolves old verifier/event-key version and replay no-ops same row; exact boundary pass then expiry reject; display fail creates no delivered; raw table inaccessible |
| 83 🟡 | Push | Latency + out-of-order | sent→delivered 800ms; `opened` trước `delivered`; client khai latency giả | Server tính `latency_ms≈800`; cả hai event ghi nhận; bỏ giá trị client |
| 84 🟡 | Push | Platform + installed split | iOS/Android/desktop; PWA cài vs không | Dashboard tách được — **điều kiện cần gate #4** |
| 85 🟡 | Push | Merge Person full references/collision | Duplicate + nonduplicate endpoints; same actor-command/read-all receipts; trust refs/JTIs; tag/announcement actors | Full inventory; every command collision halts (no alias/drop/rekey); every re-parented subscription epoch advances/reset. Deleted-loser live pointers NULL, historical refs/JTIs fixed; no dangling Person FK |
| 86 🟡 | Push | Boundary DD-69 | Module push import channel-reachability | Test kiến trúc fail |
| 87 🟡 | Push | No tenant column | Introspect subscriptions | Không có `tenant_id` |
| 88 🟡 | Push | Revoke/stale/prune with audit | Active or recently stale row; 180-day stale/revoked row with live attempt/report cap; eligible old row with receipt/trust event; exact replay after prune | Only eligible old secret row prunes after latest lifecycle/success + no live capability. Live pointers clear; immutable receipt/event refs remain and exact replay is historical-only; active/recent/live-cap rows stay |
| 89 🟡 | Push | HMAC epoch/Topic/VAPID rotation | Old-key tx pauses across cutover; new-key tx; retry Topic; incompatibility | Shared/exclusive epoch lock yields one active-hash row; Topic stable; only proven incompatibility marks stale |
| 90 🟡 | All | i18n coverage | Mọi fixed notification `type` + push server key | Type→key mapping và key đều có vi+en; không caller-chosen global key |
| 91 🟡 | All | Body không dịch máy | Announcement tiếng Việt của host | Gửi nguyên văn |
| 92 🟡 | Announce | Plain-text/input fence | blank-only; HTML/Markdown/control/invalid UTF-8; CRLF canonicalization; 16 KiB và 16 KiB+1; provider limit thấp hơn; bypass API insert | Không execute/render markup; API + DB reject blank/forbidden control/oversize; LF/TAB hợp lệ; đúng boundary pass nếu provider cho phép; không log/truncate body |
| 93 🟡 | Announce | Atomic quota + command scope | Concurrent fingerprint variants; bucket collision; timeout/crash/janitor/retry | One committed reservation+announcement; mismatch before reserve; bucket safe; janitor cannot release canonical row; retry no second charge |
| 94 | Reminder | Structural route dedupe | Same route-class different key; terminal tenant-Page then central-Page; concurrent Web+Zalo or two Messenger route classes both `pending` | Route-class UNIQUE rejects duplicate history, terminal fallback class is allowed, one-active-route index rejects every live overlap; migration audit halts on dirty rows |
| 95 | Inbox/Reminder | DD-91 canonical payment detail | Reminder/settled/correction item; charge changes between list and detail; projection returns unknown/forbidden | Item remains durable; detail re-authorizes and reflects canonical `SelfPaymentStatus`. Unknown stays generic unavailable, never zero/stale amount; notification module has no money formula/cache |
| 96 | Inbox/Push | DD-91 parity without DD-88 extensions | Session/activity/`message_request`/scoped-bulk extensions absent; Web Push proven-fail and timeout-after-write cases | Payment intent remains listable with correct unread/deep-link; push payload generic; no chat/Assistant message. Proven-fail/unknown does not delete item or mutate ledger |
| 97 | Inbox/Retention | Inspect payment item storage; call guessed mark-unread/archive/delete/purge; advance retention clocks | Only fixed type + opaque source/event refs persist, no title/amount/arbitrary params. Unsupported mutations do not exist; item/read/correction audit remains until an approved cleanup slice |
| 98 | Inbox/Chat | Independent read models | Chat message arrives; mark Chat read; mark Notification item read; inspect both stores | Chat unread remains Chat-owned; Notification read remains Inbox-owned. DD-94 signal creates zero Inbox/per-message item and neither mutation changes the other plane |
| 99 | Chat digest | Source/persistence/payload minimization | Message contains body/title/amount/mention/author/attachment/club name; inspect source DTO, queued state, logs and push bytes | Only person/channel/opaque cursor + bounded trigger/delivery metadata survive; every content field is absent/rejected |
| 100 | Chat digest | Preference defaults/matrix | DM, direct mention, reply; club absent/`all`/`mentions`/`off`/invalid/unavailable | DM/mention/reply default ON; club absent→`mentions`; exact values enforce; invalid write rejects; unavailable lookup emits no route |
| 101 | Chat digest | Monotonic coalesce | Concurrent same/lower/higher cursors for one person+channel | One pending generation with lexicographic maximum opaque cursor; same/lower no-op; no per-message row |
| 102 | Chat digest | Mark-read obsolescence | Pending cursor then Chat mark-read before claim and just before provider write | Pending is canceled or pre-provider proof skips; no HTTP in both races |
| 103 | Chat digest | Club live authorization | Active member enqueues, then leaves/loses channel read before provider write; Chat proof unavailable | False/unknown membership/read proof skips without channel existence disclosure |
| 104 | Chat digest | DM block/safety live authorization | DM unread then either participant blocks or safety authority fails/unavailable | False/unknown pair gate skips; no provider write or shared Chat/system message |
| 105 | Chat digest | Device/trust/preference recheck | Claim then preference OFF, subscription revoke or trust epoch advance | Immediate recheck detects drift and skips before secret resolution/HTTP |
| 106 | Chat digest | Retry/unknown idempotency | Provider timeout-after-write; retry same signal; higher cursor arrives | Original key stays sticky/no blind resend; at most one successor pending; no duplicate logical/provider attempt |
| 107 | Chat digest | Enablement configuration | Missing/disabled delay or unpassed boundary-test flag | Route and claim stay OFF while Chat realtime/unread and DD-91 payment notification tests remain green |

### Integration Tests

| # | Test | Setup | Expected |
|---|------|-------|----------|
| 1 | Scheduler → send → delivery | Create charges → run scheduler | Intents created, delivery attempted |
| 2 | Settled event → confirmation | Payment matched → outbox | Confirmation sent once |
| 3 | Reversal → correction | Reversal after settled | Correction sent |
| 4 | 1k tenant burst | 1000 tenants with due charges | Jitter prevents burst, all processed |
| 5 | Waitlist failure outbox → owner digest | Resolvable owner + sibling/duplicate derivation-failure events on one root | One root-keyed owner alert/digest with aggregate count/reason classes; SessionService independently claims job, candidate receives nothing |
| 6 | Cross-platform/physical one-route race | Web + Zalo + tenant/central Messenger cùng eligible; concurrent route claims và two workers same target | Exactly one active logical route across platforms and one live physical claim; old route terminalizes only on proven no-send |
| 7 | Messenger fallback | tenant endpoint unavailable, central endpoint open | Central selected once; outside-window falls back per policy |
| 8 | Cross-tenant/person parent spoof | Tenant B or Person B identity inserted for Tenant A/Person A intent under owner role | Database rejects person-bound composite FK before provider adapter |
| 9 | Exact Page derivation | Identity bound to Page A plus forged Page B route input | No Page B credential lookup/send; route resolves Page A only or fails closed |
| 10 🟡 | Push fail → inbox phục hồi | Messenger ngoài 24h + web push blocked | Delivery failed nhưng item đọc được ở inbox |
| 11 🟡 | Follow request end-to-end | A follow B (B private, DD-47/48) | Item global cho B; approve inline → edge `accepted` |
| 12 🟡 | Merge vs every notification producer/push writer | Pause tenant-intent + follow/link/auth emit after candidate discovery and after fence; race merge/read-all. Race register/rebind/trust vs merge with duplicate+nonduplicate subscriptions, pending/ack rebind challenges and identical/different command collisions | No deadlock/post-inventory loser row; source+item atomic and ends on survivor; late insert unread. Every command collision aborts merge; all re-parented subscriptions advance/reset; deleted-loser live pointers NULL/history fixed. Pending/ack challenges invalidate as `person_merge`; merge never generates/consumes a rebind receipt. Consumed exact replay returns history; unconsumed loser envelope/proof rejects/no trust restore |
| 13 🟡 | SSE realtime | Inbox mở, tạo intent mới | Đẩy qua SSE; reconnect không nhân đôi |
| 14 🟡 | Mark-all/read-state/rollback + pagination | Paused insert; same-command tabs; incomplete/empty/cross-plane failure; hidden item; foreign ref in visibility cap; cursor reuse | Deferred guard blocks incomplete commit; empty completes; rollback all; visible reads only, no read-state oracle; hidden/late unread; order/cursor/badge stable |
| 15 🟡 | Announcement proof → dispatch → report | Preview 20; tamper; routed+unreachable; fresh revoke; replay | Exact terminal reason; valid decrease pins routes; skipped from intent/vector, routed outcomes from deliveries/attempts; invalid pre-send no HTTP |
| 16 🟡 | Atomic fan-out/fence contention 500 | Creator is also recipient; reversed overlapping missing/mixed fences; pause after read-only candidate and first fence; fan-out vs merge/cancel; then retry/provider limit | Creator+recipient fences acquired before announcement. No deadlock; changed set restarts; killed tx rolls back 0 intent/route; retry commits once; attempts only after commit |
| 17 🟡 | Announcement cancel race | Cancel and atomic expansion start together | Exactly cancelled+0 intents or dispatched; late cancel already-dispatched; no partial state |
| 18 🟡 | Announcement cross-tenant | Tenant A + B cùng tên tag | Audience A không chứa person chỉ thuộc B |
| 19 🟡 | Registration command → trust epoch → telemetry | Lost response retry same command/new envelope; new command same endpoint; reused rebind proof; stale-epoch trust proof | Retry receipt-only; new command increments/reset; proof reuses reject; fresh proof elevates; safe attempt-linked telemetry |
| 20 🟡 | Key cutover + attempt start/crash | Old registration pauses under shared epoch lock, rotation/new tx contend; two workers; kill after provider acceptance | Exclusive cutover serializes one row; start CAS once after fresh gate; one live claim; started expiry unknown; no alternate/resend |
| 21 🟡 | Multi-device closure + subscription race | 3 active; concurrent registration; one 410 completes before late pinned worker starts; first success while another claim pending | Closed generation/count stable; late registration future-only; no early failed/fallback; pinned claims may finish after sent; dead target stale, no double-send/new target claim |
| 22 🟡 | iOS chưa cài PWA | iOS browser không standalone | Không hứa push; telemetry `installed=false` |
| 23 🟡 | Gate #4 dashboard | Sinh telemetry nhiều platform | Tách iOS/Android/desktop + installed rate + latency p50/p95 |
| 24 🟡 | Migration lên live baseline | Fixture at committed migrations then notification target | Next number; quota/retry/key/receipt/trust tables, RLS/revokes/exact worker grants and deferred constraints pass; no WIP overwrite |
| 25 🟡 | Ambiguous push class-aware recovery | Device timeout-after-write, alternate reachable; settled/correction/reminder | No alternate; settled/correction ≤2 fenced same-route retries; reminder manual; inbox readable |
| 26 🟡 | Security alert trusted-route/global-owner gate | Forge/future/post-mutation boundary; same long-lived session trusts X before later event; Y established before context start; replay old proof after reset | Invalid provenance reject; X excluded despite pre-event time; Y eligible only when factor predates context start; old proof cannot restore reset trust; tenant recovery cannot select global alert; item/audit persists |
| 27 🟡 | Announcement quota/retry E2E | Concurrent confirm near budgets; intent has Web+Zalo failed; same/different retry; auth changes | One durable reservation; replay/mismatch exact; deterministic current-policy route item persisted/CAS once; no second fan-out charge |
| 28 | DD-91 payment lifecycle on primary app surface | Emit reminder, exact settled, then correction; disable DD-88; fail Web Push; open inbox/deep-link after each canonical state change | One versioned durable intent per lifecycle event, generic push only, item survives delivery failure, authenticated detail follows canonical Player View projection; zero chat/bot rows and zero copied money formula |
| 29 | DD-94 Chat digest coalesce → generic push | Enable tested timing config; emit DM/mention/reply and burst club messages under each preference; inspect all durable stores/provider bytes | Correct default/preference routing; one coalesced generic signal per person+channel generation; zero Inbox/per-message item/content snapshot; DD-88 absent |
| 30 | DD-94 pre-provider cancellation/unknown | Pause claimed signal; race mark-read, leave/block, preference/device/trust change and timeout-after-write; rerun with config absent | Every false/unknown gate skips before HTTP; possible-write remains sticky/no duplicate; absent config keeps only digest OFF while Chat unread and payment Inbox/Web Push continue |

---

## 6. Rollout Plan + Changelog

### Rollout

**§A (contract đã reviewed):**

1. Shadow eligibility (log only, no sends)
2. Owner preview only
3. Manual send — web push + Zalo DM (`reminders_manual`, mọi tier)
4. Automatic scheduled send — 2h→24h thresholds (`reminders_auto`, `host_pro`)
5. Run `0008` upgrade audit: inventory unsupported legacy platform rows; validate tenant+Person identity composites; land durable physical-attempt table/cutover. Any dirty tenant/Person link, pending unsupported platform hoặc unresolved endpoint blocks enablement
6. Messenger DM best-effort trong cửa sổ 24h (P2.5) only after DD-65..68 Page registry/identity/reachability migration; enable one-route shadow metrics before send
7. Enable waitlist failure owner-alert projector after DD-45 session retry worker is wired

**§B/C/D/E — quyết định owner đã đóng, nhưng migration vẫn gated:** DD-70/71/72/94 là `DECISION_FINAL`; mỗi phần phải có dedicated strict `CODE_READY` packet đóng physical contract/OQ/acceptance/rollback của chính slice. Không land theo broad feature doc này.

8. **DD-67/DD-72 Web Push mechanisms:** 36 route integrity (person-bound delivery/attempt + `platform`/`route_class`) → 37 protected subscription/trust/key-epoch authority → 38 direct VAPID provider/attempt/payload. F0 design authority mở 39 installable PWA shell; 37+39 mở 40 registration/device client; 38+39+40 mở 41 display/deep-link/scoped telemetry client. Lấy next monotonic migration number, không sửa history/native pre-design; shadow nội bộ trước khi bật class.
9. **DD-94 Chat digest:** mechanism 42 chỉ land sau canonical Chat unread proof (10) và 36/37/38/41. Run unit #98–107 + integration #29–30 với DD-88 absent; timing config thiếu/chưa test giữ route OFF; không Inbox/per-message item hoặc content snapshot.
10. **DD-91 payment lifecycle:** mechanism 43 pin durable `reminder|settled|correction` intent/read contract; 44 reminder scheduler producer và 45 settled/correction projector land độc lập sau real ledger/payment-reconciliation sources; 46 Inbox/authenticated detail dùng canonical `getSelfPaymentStatus`; 47 chỉ map intent sang generic push/deep-link. Enable đòi exactly-once/correction E2E + authenticated-detail parity; zero Chat/Assistant writer hoặc local money formula.
11. **HTTP A17–A19:** A17 Chat preferences; A18 payment Inbox/detail; A19 register/rebind/revoke/device + delivered/opened telemetry. Mỗi adapter chỉ sở hữu auth/session/action authz, validation, privacy/cache headers, DTO và route/security tests; không provider send/business re-derivation.
12. **FE F11/F14/F15 sau F0:** payment Inbox/detail, Chat preference và contextual install/permission/device UX dùng API thật, đủ bốn trạng thái. Permission không được forced; preference tách consent; không sensitive local cache, lock-screen amount hoặc client money formula.
13. **Broader Inbox/Announcements:** shadow tenant `notification_intents` read plane → InboxSignalProjector/SSE/badge → global plane sau DD-47/48; security alert vẫn chờ exact auth-security attempt owner/pre-context trusted route tests. Announcement tags/preferences → proof preview → atomic quota/fan-out → provider attempts/safe retry/DLP; giữ OFF tới bounded-fan-out + telemetry green. Các mechanism này cần strict packet riêng, không bị implicit authorize bởi primary-surface graph.
14. Land CI invariants **trước** enablement: no global money/PII/arbitrary params, no blanket telemetry grant, same-Person delivery FKs, physical kill-after-write, payload/topic/cap/display order, exact receipt replay, read-plane rollback, tag isolation/normalization và announcement idempotency. Bất kỳ missing/unknown object-storage/provider/VAPID/consent/timing config nào giữ route tương ứng OFF.
15. Bật `inbox_recovered_delivery` + chạy ≥1 chu kỳ đo đủ dài → nộp baseline cho **DD-69 gate #4**; ngưỡng chốt **sau** khi có số (NTF-OQ-14). Telemetry informs DD-94 enablement timing/rollout, nhưng không reopen product contract hoặc biến DD-88 thành dependency.

### Metrics

- **§A:** Eligible/sent/skipped/failed counts · Reminder-to-settlement conversion · Queue lag / retry age · Provider rate-limit frequency · Opt-out/complaint count · Waitlist derivation-failure alerts/dedupe conflicts/alert age · Messenger route class, both-endpoint suppression, fallback và unknown-outcome counts (opaque; no raw Page/PSID)
- **§B 🟡:** Intent commit → query-visible/SSE signal lag, global-event dedupe conflict, badge drift, **% item đọc được sau khi push fail**, security alert trusted-route/no-route counts, p95 list latency, số `withTenant`/request
- **§C 🟡:** announcement/tenant+actor/ngày, recipient fan-out budget usage, reservation conflict/timeout/orphan/release counts, audience size distribution, outcome theo `route_class`, skip theo `reason_code`, fan-out lag, preview-stale/replay reject, **opt-out rate** (tín hiệu spam), DLP warn/block
- **§D 🟡:** **client-reported delivered/opened rate theo platform × installed** (số đo chính gate #4), latency p50/p95, duplicate/rejected-capability rate, subscription active/stale/revoked + churn + `410` rate, permission granted/denied theo context, PWA install rate (đặc biệt iOS), proven-fail fallback rate, `unknown` class + reconciliation age + same-route retry outcome
- **§E 🟡:** Chat digest source→coalesce→claim lag, cursor advances/signal, skip count by bounded reason, generic push delivered/opened, possible-write `unknown`, duplicate logical/provider attempts (**target 0**) and route-off/config-missing count; no content dimensions
- **An toàn:** grant-fence violation attempts và payload invariant violations — cả hai phải = **0**

### Changelog

| Date | Version | Thay đổi |
|---|---|---|
| 2026-07-28 | v3.11 | Re-pin primary plan v1.8 `PLAN_READY` tại `90d292d`, closure 12/12. Giữ runtime/migration = 0, Web Push/payment/digest enablement gates và strict per-slice `CODE_READY`; không đổi contract. |
| 2026-07-28 | v3.10 | Replace stale S9/S20 rollout bằng exact mechanism owners 36→41, Chat unread 42 và payment 43→44/45→46→47; pin thin HTTP A17–A19 và FE F11/F14/F15 after F0. Payment enablement requires real producer + exactly-once/correction E2E + authenticated-detail parity; no runtime/migration authorization. |
| 2026-07-28 | v3.9 | Mirror DD-94 owner-final: Chat unread is sole source; generic signal only, no Inbox/per-message item/content snapshot; exact DM/mention/reply and club preference defaults; monotonic cursor coalescing; mark-read + membership/DM safety/preference/device/trust proof immediately before provider write; sticky retry/unknown idempotency; timing config fail-closed OFF. Add §4.7a, unit #98–107 and integration #29–30. DD-88 remains only broader proposal; no runtime/migration authorization. |
| 2026-07-28 | v3.8 | **Historical; offline-digest clause superseded by DD-94/v3.9.** Mirror DD-88 guardrails for derived grouping, single Inbox preference authority, schema-nonoptout money/security, independent read models and deferred scoped/bulk behavior. No DDL/API/runtime authorization. |
| 2026-07-27 | v3.7 | Pin v1 Inbox storage/retention negative scope: no title/amount/arbitrary snapshot, mark-unread/archive/user-delete/hard purge; cleanup and replay-ledger deletion OFF until Legal/Security approval. Auto-reminder thresholds remain enablement-only; external DM copy stays out of primary-surface scope. Add test #97; runtime remains absent. |
| 2026-07-27 | v3.6 | Mirror DD-91 primary-surface payment parity: reminder/settled/correction reuse durable tenant intent/inbox + generic Web Push; authenticated detail delegates canonical Player View `SelfPaymentStatus`, no local `effectiveFee`/money formula/snapshot. Delivery failure retains item, DD-88 is downstream/non-blocking, and chat/Assistant get zero lifecycle rows. Add tests #95–96 + integration #28; Reviewed/runtime-pending truth unchanged. |
| 2026-07-25 | v3.5 | **Owner-decision reconcile:** DD-70(a), DD-71 và DD-72 đã chốt từ 21/07; promote cặp về **Reviewed contract**. Chuyển §B/C/D từ “proposal/chờ DD” thành owner-final target, nhưng giữ DDL/API/service/worker/UI = chưa implement; API examples/rollback/OQ phải đóng trong từng strict code-ready slice. NTF-OQ-14..16, exact global security-attempt owner và DD-88 vẫn gate riêng. |
| 2026-07-19 | v3.4i | **Template v2.30/v2.33 uplift (đợt cuối của sweep):** thêm §2 `Migration & Rollback` (tổng hợp derivative: live `0005`/`0008` reuse-không-recreate vs §B/C/D chưa có migration + rollback matrix), §3 `Request/Response Examples` (chỉ §A theo envelope DD-60; §B/C/D không minh hoạ — chờ DD chốt), §4.10 `Security Checklist`. `Idempotency` (§3) và `Caching Strategy` (§4.9) đã có sẵn — không thêm trùng. Additive/derivative — không đổi contract §A, không chốt thêm gì cho §B/C/D (vẫn chờ DD-70/71/72). |
| 2026-07-19 | v3.4h | Metadata sweep (index v2.35): thêm trường **Implementation** đồng bộ BUILD-STATUS (Not started). Không đổi contract. |
| 2026-07-19 | v3.4g | **Post-fence snapshot closure v1.71 + authority pointer v1.74:** mark-all/announcement fan-out read-only pre-discovery rồi bounded READ COMMITTED fence-first trước snapshot (sửa wording REPEATABLE READ cũ tại §Order/read boundary). v1.74 closure items recorded in decisions, §body absorption verify ở pass kế. Version realign với FE v3.4g. No runtime/migration. |
| 2026-07-19 | v3.4f | **DD-70/72 authority correction v1.70 (realign):** không tenant-outbox global fallback; link-code consume emits nothing; merge commit từ locked audit — nội dung đã pin trong §Producer boundary/blocking order từ v3.4c/v3.4d, row này realign version với FE pair. Rebind = verified prior-owner reauth/manual recovery; merge invalidates pending challenges. No runtime/migration. |
| 2026-07-19 | v3.4e | **DD-45 root-alert/retry-liveness mirror:** candidate events are per-entry audit; deterministic owner intent keys by `promotion_retry_id`. SessionService independently claims lazy max-3-claimed-attempt root; projector never drives/settles retry. No runtime/migration. |
| 2026-07-19 | v3.4d | **Notification route/attempt/proof closure v1.69:** route-class history/key; due-planned physical lifecycle; target-vs-intent-vs-defer decision; sent/sticky-unknown precedence; exact-target start authorization; core DML cutover; exact announcement receipts/tag retirement; push device/proof/rebind boundaries. Cross-Person rebind accepts only `verified_prior_owner_reauth` or audited `manual_recovery`; Person/account merge remains a separate re-parent/reset path, invalidates unconsumed challenges and never mints/consumes a rebind receipt. DD-70..72 remain Draft; no runtime/migration. |
| 2026-07-19 | v3.4c | **DD-45 retry-owner mirror:** candidate failure alerts carry `promotion_retry_id`; deterministic alert remains per `failure_event_id`, while SessionService alone owns the one root max-3 sweep job/budget. No runtime/migration. |
| 2026-07-19 | v3.4b | **DD-45 event vocabulary + notification replay/lock closure:** deterministic failure-event alert ownership; global read-only-discovery→fences→epoch/advisory→Person/source→child hierarchy; fan-out/single-producer/push/merge races; read-all/push collision halt; external command vs JTI reset semantics; exact trust replay order; composite Person/history refs; every-reparent reset; secret-row prune retention. DD-70..72 remain Draft; notification baseline v1.67/current authority v1.67; no runtime/migration. |
| 2026-07-19 | v3.4a | **Notification implementation closure + DD-45 retry mirror:** executable grants/linearization, global read/write owners, durable quota/retry items, external push idempotency, trust epoch/proofs, key epoch, structural telemetry replay và context-start cutoff cho security factor. DD-70..72 remain Draft; authority/notification baseline v1.67; no runtime/migration. |
| 2026-07-19 | v3.4 | **Integrity closure theo decisions v1.54:** person-bound delivery + physical-attempt ledger; unsupported legacy-platform disposition; sequence/fence inbox ordering + signed cursor/no arbitrary params; command fingerprint + atomic full-vector fan-out/pinned routes/no partial cancel; safe retry-failed; tagged guest parity + canonical tag norm; tenant recovery excludes global security alert; raw telemetry grants/error matrix, 24h cap and display-before-delivered. 64 BE edges, **94 planned unit + 27 planned integration cases**; no runtime/migration. |
| 2026-07-18 | v3.3 | **Semantic drift closure (reconciled decisions v1.52):** exact pre-event email/device predicates; server-owned `trusted_at/trust_source` + reset-on-rebind; fixed per-channel+total proof permits only component-wise decrease under same schema/policy with dispatch-time roster; browser push service separated from optional app-level vendor platform/SDK; tighten regression vectors. DD-70/71/72 remain proposals; no runtime/migration. 64 BE edge cases, 94 unit + **27** integration tests. |
| 2026-07-18 | v3.2 | **Recheck decisions v1.49:** worker-only send-claim + actor-bound self APIs; server-owned read-all watermark; trusted-pre-event security route với global-attempt owner là build/enablement gate, không cản founder accept DD-70; proof receipt nằm trên `announcements.preview_*` thay vì store song song; atomic fail-closed tenant+actor+fan-out quota reservation; announcement state chỉ phản ánh fan-out, report derive từ deliveries; same-tenant session FK; fixed per-channel proof counts + untrusted plain-text/body-size fence; Topic/tag HMAC base64url đúng 32 ký tự; `unknown` telemetry/reconciliation và tối đa 2 same-route recovery khớp DD-72; structural `UNIQUE(intent_id,platform)` đóng đường caller đổi `delivery_key` để gửi trùng. DD-70/71/72 vẫn 🟡 đề xuất; không có migration/runtime mới. 64 BE edge cases, 94 unit + **27** integration tests. |
| 2026-07-18 | v3.1 | **Review-fix closure:** OS push generic; tenant inbox lấy `notification_intents` làm durable item; security alert thêm trusted pre-event out-of-band resolver. Announcement có consume-once preview proof, normalized audience FK, opt-out owner và layered actor/fan-out quota. DD-72 chỉ freeze direct Web Push/VAPID phase-1 (`kind='web'`), native chờ DD-69 spike; `unknown` cấm alternate-route fallback nhưng high-value class có bounded same-route recovery với stable topic/tag. Telemetry `event_key` + write-only scoped capability; tenant inbox cursor index bắt buộc; giữ Draft/runtime-pending truth. 62 BE edge cases, 91 unit + **25** integration tests. |
| 2026-07-18 | v3.0 | **Gộp cụm 🔔 về một cặp** (owner yêu cầu 1 feature = 1 cặp): nhập `BE/feature_notification_center_tech.md` v1.0 vào đây (inbox/global plane · announcements + `membership_tags` · push subscriptions + telemetry); file đó đã xoá. Phần mới đánh dấu 🟡 = **chưa phải contract**, chờ DD-70/71/72. Status hạ Reviewed → Draft do gộp tài liệu, không mở lại luật tiền. Claim ban đầu rằng toàn bộ §A giữ nguyên từng chữ được **v3.1 sửa lại** vì target DDL cross-cutting có delta Draft. v3.0 cũng sửa 2 lỗi từ bản Draft rời: (1) claim sai `notification_deliveries.platform` đã có CHECK gồm `'web'` + `route_class`; (2) CHECK `person_notifications_no_self` vô nghĩa. 62 BE edge cases, 91 unit + 24 integration tests. |
| 2026-07-17 | v2.5 | **Tenant/endpoint integrity closure:** restore live `notification_deliveries.tenant_id`, enforce same-tenant delivery→intent and identity→platform composite FKs, derive Messenger Page/Zalo bot-OA only from exact immutable identity, and add fail-closed `0008` upgrade/cross-tenant regression gates. Runtime migration pending. |
| 2026-07-17 | v2.4 | **DD-15/DD-67 v1.45:** protected endpoint reachability by `channel_identity_id` for Zalo+Messenger, 3-part identity lookup, separate target-tenant authorization and cross-endpoint tests. Runtime migration pending. |
| 2026-07-17 | v2.3 | **DD-67 full propagation:** Page-endpoint candidate resolver, logical delivery key without Page, tenant→central priority, exact endpo
