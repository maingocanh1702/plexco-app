# Audit code ↔ requirements + rủi ro — Plexco `main@30a3e90` (06/09/2026)

> **Derived, non-authority.** Snapshot đọc-chỉ, không sửa gì. Mọi khẳng định kèm `file:line`; nhãn
> **CONFIRMED** = đã đọc đúng đoạn code; **PLAUSIBLE** = suy từ code nhưng còn một điều kiện môi trường
> chưa đo. Số dòng đo tại `30a3e90`; sửa file thì số dòng mục. Tiền lệ: `2026-08-24-repo-audit.md`.
>
> **Cách đo:** stage tarball `docs/ packages/ apps/ scripts/ infra/ .github/` (không `.git`, không
> `.autopilot/`) → 4 lượt đọc độc lập (web · db · bot/infra/CI/scripts/core · traceability) → tôi đọc lại
> trực tiếp mọi finding P2 trước khi ghi vào đây. Snapshot **không có** `pnpm-lock.yaml`, `eslint.config.*`,
> `.gitignore`, `.dockerignore` — hai finding phụ thuộc chúng được đánh PLAUSIBLE.

---

## 0. Verdict

**Code đang có thì đúng với docs ở phần lõi, và phần lõi đó chắc.** RLS fail-closed trên cả 33 bảng
tenant (`0009:49-55`, `missing_ok=true` ⇒ GUC rỗng ⇒ 0 row), `app` **zero** quyền trên `public_sessions`
(`0009:118` → `0033:238` → `0036:36`), mọi SECURITY DEFINER đều `REVOKE ALL FROM PUBLIC` + pin
`search_path` (trừ 2 hàm ở D-7), họ 6 session command dedup `(tenant_id, command_id)` dưới advisory lock
+ `FOR UPDATE` + đồng hồ DB sau khoá (DD-111), auth token chỉ lưu sha256, OAuth state/PKCE/handoff
single-use. **Không tìm thấy P1** (auth bypass / lộ tiền-PII / cross-tenant) trong code đang tồn tại.

**Nhưng "code đúng docs" không phải câu hỏi quan trọng nhất hôm nay.** Ba thứ lớn hơn:

1. **Launch DD-113 không ship được với code hiện có — không phải vì FE PENDING, mà vì BE chưa có đường đọc.**
   5 khối launch cần *xem* danh sách kèo + chi tiết kèo + roster. Repo có **0 route GET** dưới
   `/api/sessions` (đo: `find apps/web/app/api/sessions -name route.ts` → 5 file, không file nào export
   `GET`), **0 writer** của bảng `players` ngoài test ⇒ roster **không thể có dữ liệu** từ bất kỳ surface
   nào. Hai khối 3+4 của launch hiện là "write-only". Không có row backlog nào sở hữu việc này (§4).
2. **Bốn lỗ go-live thật, đều fail-closed nên chưa ai thấy** (§2, P2): `tenant_provision()` sẽ **vỡ dưới
   RLS** khi migration role production không có `BYPASSRLS` (D-2) · readiness không bao giờ `ready`
   vì đòi `tg_bind` mà Telegram đã bị loại (W-5) · dispatcher chết cả cycle khi projector thật trả
   outcome sai grammar (B-1) · `app` có full DML trên `subscriptions` — bảng là *nguồn sự thật* của cả
   entitlement lẫn suspension (D-1).
3. **CI structurally đỏ trên mọi PR và mọi push `feat/**`** (X-1): `review:check` gọi `git merge-base
   --is-ancestor <sha> main` với literal `main`; checkout của PR/feat không có local branch `main` ⇒ 50
   verdict block đều `AUTHORITY_NOT_MAIN`. Chưa ai thấy vì merge là human-local rồi push thẳng `main`.

Về **docs**: 16 điểm lệch docs-vs-code (§3), phần lớn là *docs chậm hơn code* (route close/cancel đã có
mà ROADMAP:562 + backlog còn ghi thiếu; "no outbox producer" sai ở 3 chỗ trong khi `session-service.ts`
đã emit 8 loại event) — nguy hiểm nhất là cái cuối: **bật `OUTBOX_DISPATCH_SCHEDULE_ENABLED` hôm nay sẽ
DLQ event thật của session**, và lý do "an toàn vì chưa có producer" trong `dispatcher.ts:60-64` đã mục.

---

## 1. Ma trận requirements → code (DD-114 · 7 nhóm · launch DD-113 là subset)

Ký hiệu: ✅ có code + route · 🟡 có service, chưa route/caller · 🟢 merged-code-dark (0 caller production) ·
⬜ không có gì · **L** = nằm trong 5 khối launch.

| # | Nhóm DD-114 | Sub-requirement | Migration | Service | Route | FE | Trạng thái đo | Ghi chú |
|---|---|---|---|---|---|---|---|---|
| 1 **L** | Signin/signup Google | OAuth state/callback/complete | `0015`–`0018` | `auth.ts:175,197` + `google-oidc.ts`, `oauth-transaction.ts` | 3 route | ⬜ | ✅ merged · **⛔ env OFF** (`google/state/route.ts:55-59`) | đúng docs |
| 1 | | Email/password (7 route order-4) | `0016` storage | helpers `auth.ts:336,484,511` | ⬜ | ⬜ | 🟡 | backlog `email-password-bundle-order-4` blocked |
| 1 | | logout / logout-all / session | `0015` | `auth.ts:96,147,158` | 3 route | ⬜ | ✅ | |
| 1 | | **Telegram login (DD-37 đã loại)** | `0012` | `auth.ts:46 loginTelegram` | `telegram/{state,callback}` | — | ✅ **ngoài scope mà vẫn sống** | W-1 |
| 2 | Create club self-serve | `tenant_provision()` | `0028:218-283` | `auth.ts:207` | `POST /api/onboarding/start` | ⬜ | ✅ **BE đã có** | docs nói ⬜/"thủ công" — drift #4; **D-2 vỡ dưới RLS prod** |
| 2 | | Readiness checklist | `0008`,`0013` | `auth.ts:237` | `GET /api/onboarding/readiness` | ⬜ | 🟡 **sai predicate** | W-5: đòi `tg_bind`, `first_session` optional |
| 2 | | Club config (sport/price/gender price/policy) | `settings` có bảng, không có cột | ⬜ | ⬜ | ⬜ | ⬜ | không backlog |
| 2 | | Bank / Zalo / Messenger connect | `0004` bảng | ⬜ | ⬜ | ⬜ | ⬜ | |
| 3 | Link club ⇄ Zalo bot | Webhook `/webhook/zalo`, adapter, parser | `zalo_bots`, `zalo_reply_contexts` | ⬜ | ⬜ | — | ⬜ | **0 file** chạm Zalo ngoài schema |
| 3 | | Identity key 3-part DD-67 | live key 2-part (`schema.ts:56-72`) | — | — | — | ⬜ | spec tự nhận |
| 4 **L** | Link account ⇄ Zalo | `link_code` issue/consume/merge | `0001`,`0002` | ⬜ | ⬜ | ⬜ | ⬜ | D-9: schema thiếu cột DD-50 |
| 4 | | Deferred-payment predicate DD-32 #1 | `0034` | SQL fn only, 0 grant runtime | ⬜ | ⬜ | 🟢 | ROADMAP:584 cite file **không tồn tại** — drift #3 |
| 5 | Sync + toggle public/private | Outbox producer | `0005`,`0022`,`0023` | `session-service.ts` emit 8 event (`:274,656,919,1510,1526,1814,2150,2189`) | qua 5 route | ⬜ | ✅ **producer đã có** | docs nói "no producer" ×3 — drift #5 |
| 5 | | Dispatcher / projector | `0022`,`0023` | `dispatcher.ts:165`, `worker.ts:61` | — | — | 🟡 stub DLQ-all, schedule OFF | B-1 |
| 5 | | Bot→Plexco join (DD-32 Option D) | `players`, `join_requests` | ⬜ (`addMemberToSession` 0 hit) | ⬜ | — | ⬜ | |
| 5 | | Toggle + fence immediate-deny | `0033`,`0036` | `updateSession:1547` raise | `PUT /api/sessions/[id]` | ⬜ | ✅ | đúng DD-114 D3 (b) |
| 5 | | Web realtime SSE | — | ⬜ | ⬜ | ⬜ | ⬜ | |
| 6 **L** | Session mgmt · detail | create · update · publish · close · cancel | `0002`,`0019`,`0024` | 6 command `session-service.ts` | 5 route (announce gated DD-56) | ⬜ | ✅ BE | ROADMAP:562/582 + backlog `session-commands-update-close-cancel` **stale** — drift #1/#2 |
| 6 **L** | | **`GET /api/sessions` list · `GET /api/sessions/:id` detail** | — | ⬜ | ⬜ | ⬜ | ⬜ | **khối 3+4 launch không có đường đọc** |
| 6 **L** | | **Roster (ai nhận slot)** | `players` | **0 writer** | ⬜ | ⬜ | ⬜ | roster vĩnh viễn rỗng |
| 6 | | Mark-paid thủ công (DD-40, mọi tier) | `0003`,`0020` ledger | ⬜ | ⬜ | ⬜ | ⬜ | không backlog |
| 6 | | Webhook SePay/ApiPay → `bank_transactions` → allocation → `/unmatched` | `0003`,`0020` | `core/matching.ts`, `payments-logic.ts` (pure) | ⬜ | ⬜ | ⬜ | |
| 6 | | `payment_reconcile_auto` entitlement | `0028`/`0029` | `resolveCapability:150` | 0 caller | — | 🟢 | đúng docs (hard-dep (a) DD-114 còn mở) |
| 6 | | Reminder cron / confirm-paid notify | `0008` bảng | ⬜ | ⬜ | ⬜ | ⬜ | không backlog |
| 6 | | Billing lifecycle (trial/past_due/suspended) | `0007`,`0027`–`0029` | `authorizeTenantAction:148` status-guard (5 caller) | ⬜ | ⬜ | 🟡 | ROADMAP:642 "0 caller" **sai** — drift #9 |
| 6 | | Close/cancel nhánh tiền fail-closed DD-117 | — | `:1794`, `:2127` | mapped | — | ✅ refuse-only | đúng |
| 7 **L** | Settings · privacy | Profile gender/dob/username | ⬜ (spec `:89` tự nhận) | ⬜ | ⬜ | ⬜ | ⬜ | |
| 7 **L** | | Ngôn ngữ per-user | ⬜ — `persons.language` **bị gỡ khỏi contract** (`user_settings_tech.md:449`) | `tenantLocale` (`0035`) | ⬜ | ⬜ | 🟡 tenant-level | **mâu thuẫn** DD-113 khối 5 — §5 #2 |
| 7 | | Reminder prefs · linked channels | `notification_policies` | ⬜ | ⬜ | ⬜ | ⬜ | |
| 7 | | Privacy (consent/retention/delete) · A3 legal | `*_enc` cột | `decryptEmailEnc` | ⬜ | ⬜ | ⬜ | A3 vẫn DRAFT — blocker phase-1 theo DD-114 D5 |

**Đọc ma trận cho đúng:** ~33% của ROADMAP là **đúng** — thậm chí hơi cao nếu tính theo *launch có thể
ship*: trong 5 khối launch, khối 1 có BE (OFF), khối 2/5 = 0, khối 3/4 có write không có read.

---

## 2. Findings theo severity

Không có P1. Xếp P2 theo *khoảng cách tới go-live*, không theo *độ nặng lý thuyết*.

### P2 — chặn go-live hoặc chặn vận hành

**X-1 · CI đỏ cấu trúc trên mọi PR / push `feat/**` · CONFIRMED (code) · PLAUSIBLE (chưa chạy trên GitHub)**
`scripts/check-review-readiness.mjs:189` — `git merge-base --is-ancestor <sha> main` với literal `main`;
`gitSucceeds` (`:154-162`) trả `false` với mọi exit ≠ 0 kể cả `fatal: Not a valid object name main`.
`actions/checkout` `fetch-depth: 0` (`ci.yml:36-42`) chỉ tạo `refs/remotes/origin/*`; git **không**
DWIM `main` → `origin/main`. `ci.yml:6` trigger `pull_request` + `push: feat/**` ⇒ 50 verdict block
(đếm offline với `gitCheck:false`) đều `AUTHORITY_NOT_MAIN` ⇒ step `pnpm -w review:check` (`:64`) đỏ.
Comment tại `ci.yml:38-41` tin rằng `fetch-depth: 0` là đủ — cần nhưng không đủ.
*Vì sao chưa ai thấy:* merge human-local rồi push thẳng `main` (`checkout` tạo local `main` khi ref là
`refs/heads/main`). *Hệ quả:* CI **không dùng được làm gate PR**; branch protection nếu có sẽ chặn mọi PR.
*Fix:* resolve `refs/remotes/origin/main` (fallback `main`), hoặc `git fetch origin main:main` trước step.

**D-2 · `tenant_provision()` vỡ dưới RLS khi owner không `BYPASSRLS` · CONFIRMED (code) · env-dependent**
`0028:218-283` là `SECURITY DEFINER` owned bởi migration role, `INSERT INTO memberships/tenant_admins/
subscriptions/onboarding_runs` (`:46-60` trong thân) — cả 4 bảng **FORCE RLS** với `WITH CHECK tenant_id =
GUC` (`0009:51-55`) — mà hàm **không** `set_config('app.tenant_id', …)` (grep thân hàm: 0 hit). FORCE áp
cả table owner. Chạy được hôm nay chỉ vì test/dev migrate bằng **superuser**; chính repo ghi nhận
hazard này tại `migrate.test.ts:1336-1341` ("tenant_provision()'s OWN inserts … hit FORCE RLS with no
app.tenant_id set"). `0022:28-50` pin attribute của `job_definer` làm precondition, nhưng **không có**
precondition tương tự cho owner của `tenant_provision`. `environments-setup.md:155` chỉ nói migration
role là "DDL, migrations, grants". Cùng hình: `tenant_ids_for_person` (`0012:305-318`) đọc `tenant_admins`
cross-tenant.
*Hệ quả:* production trên managed PG (owner `NOSUPERUSER NOBYPASSRLS`) ⇒ `POST /api/onboarding/start`
→ "new row violates row-level security policy for table memberships"; `tenantsForPerson` trả `[]` cho
mọi user ⇒ **không ai vào được tenant nào**. Fail-closed, không rò, nhưng là outage toàn bộ.
*Fix:* trong hàm `PERFORM set_config('app.tenant_id', v_tenant::text, true)` trước mỗi INSERT (+ test dưới
`setupNonSuperuserOwnerContext` gọi `tenant_provision` như `app`), **hoặc** pin owner `BYPASSRLS` làm
precondition kiểu `0022`. Chọn cái đầu — không mở rộng quyền.

**W-5 · Readiness không bao giờ `ready` · CONFIRMED**
`apps/web/app/api/onboarding/readiness/route.ts:19-20`: `REQUIRED_STEPS = ["club_config","bank_connect",
"tg_bind"]`, `OPTIONAL_STEPS = ["zalo_connect","first_session"]`. Không code nào ghi `tg_bind` (grep toàn
repo: chỉ 2 dòng này). Spec `feature_web_auth_onboarding_tech.md:120-129`: bắt buộc = club + bank +
**first session** verified; Zalo optional; không Telegram. FE spec đã ghi "Legacy runtime warning"
(`feature_onboarding_fe.md:12,417`) nhưng **không có row backlog**.
*Fix:* thay constant bằng predicate spec nêu; thêm test "`ready` có thể true".

**D-1 · `app` full DML trên `subscriptions` — nguồn sự thật của cả entitlement lẫn suspension · CONFIRMED**
`0009:42,57` cấp `SELECT, INSERT, UPDATE, DELETE` cho `app`; không migration nào REVOKE (grep). Hai gate
đọc bảng này làm sự thật: `authorization.ts:190-209` (`status`), `capability.ts:184-235` (`plan_key`,
`plan_version`). Không trigger bảo vệ. Chính repo đã đóng đúng lỗ này cho `tenants.status` ở `0027:6-10`
("would reopen exactly the write path AP-40's negative scope closed") nhưng để nguyên cho `subscriptions`.
*Kịch bản:* bất kỳ path role `app` trong `withTenant(T)` (bug, hoặc webhook handler tương lai — web chạy
webhook như `app`, `deployment-infra.md:127`) `UPDATE subscriptions SET plan_key='host_pro',
status='active'` ⇒ `resolveCapability` cấp `payment_reconcile_auto`, `authorizeTenantAction` gỡ suspend.
*Caveat:* `FOR SHARE` đòi UPDATE privilege (bài học 0027) ⇒ REVOKE trần sẽ vỡ gate.
*Fix:* dời hai lần đọc `FOR SHARE` vào một SECURITY DEFINER hẹp theo khuôn `0027`
(`resolve_subscription_locked`), rồi `REVOKE INSERT, UPDATE, DELETE ON subscriptions FROM app`
(provisioning đã ghi qua `tenant_provision`).

**B-1 · Dispatcher chết cả cycle khi projector thật trả outcome sai grammar · CONFIRMED (latent)**
`apps/bot/src/dispatcher.ts:233-247` `try/catch` chỉ bọc `deliver(job)`; `complete_projector_delivery`
gọi **ngoài** try (`:250-262`). `0022:424-437` RAISE `invalid_parameter_value` khi `retry` có
`next_attempt_at <= clock_timestamp()` hoặc `error_code !~ '^[a-z][a-z0-9_]{0,63}$'`.
*Kịch bản:* projector thật trả `{result:"dlq", errorCode:"ECONNRESET"}` (hoa) ⇒ SQL raise ⇒ thoát
`runDispatchCycle` ⇒ row còn `claimed` ⇒ sau 5 phút reclaim-expired-first + `ORDER BY event_id`
(`0022:343-349`) trả đúng row đó trước ⇒ lặp vô hạn, mọi projector sau nó trong `REQUIRED_PROJECTORS`
bị bỏ đói. Comment `:139-151` nói poison row "cannot head-of-line-block" — chỉ đúng với **throw**.
Latent vì stub trả code hợp lệ (`:70-73`).
*Fix:* chuẩn hoá outcome trong `completionArgs` (lower-snake `errorCode`, clamp `nextAttemptAt > now`)
**và** catch `invalid_parameter_value` từ `complete_projector_delivery` → fail-closed `dlq` với code canonical.

**W-1 · Telegram login vẫn là đường auth thứ hai sống · CONFIRMED**
`api/auth/telegram/state/route.ts:13-24` (GET không auth, ghi `auth_login_state`), `callback/route.ts:37-98`
(POST → `loginTelegram` → `issueSession`), chỉ gate bằng `TELEGRAM_BOT_TOKEN` (`:53-60`). `infra/fly.toml:6`
vẫn liệt kê secret đó. Test Google **pin** route Telegram còn tồn tại (`google/callback/route.test.ts:312`
"D1-14"). Schema vẫn cho `platform='telegram'` (`schema.ts:69-70`), bảng `telegram_links` còn (`:709`).
Hai posture identity khác nhau: Telegram lưu `first_name/last_name` (`telegram-login.ts:58-60`), Google
cố ý `displayName: null` (DD-26). Spec `feature_web_auth_onboarding_tech.md:14,686` nói đã bỏ.
Backlog `auth-provider-google-email-swap` (`:810-818`) status `idea`, điều kiện "sau khi Google land" —
**đã thoả từ 22/07** mà chưa làm.
*Fix:* xoá 2 route + `telegram-login.ts` + pin D1-14; gỡ `TELEGRAM_BOT_TOKEN` khỏi `fly.toml`/`.env.example`;
migration thu hẹp `channel_identities_platform_chk`; **kèm** sửa W-5 (cùng nguồn).

**W-2 · Không có security header toàn app · CONFIRMED**
`next.config.mjs:7-24` không `headers()`; không `middleware.ts`; `fly.toml:44-46` chỉ `force_https`
(redirect, không HSTS). CSP/XFO chỉ có ở landing OAuth (`session-cookies.ts:175-183`). Spec `:327` claim
"CSP, X-Frame-Options, clickjacking protections" — **drift**. Không backlog.
*Fix:* `headers()` block: HSTS `max-age=31536000; includeSubDomains`, `X-Frame-Options: DENY`,
`X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, CSP baseline; pin
bằng test.

**W-3 · `POST /api/auth/google/complete` không rate-limit, body không giới hạn, mỗi request một UPDATE · CONFIRMED**
`complete/route.ts:40-74`: config gate → `sameOriginRequest()` (`:60`, header `Origin` — client không
phải browser tự đặt được) → `request.formData()` (`:64`, không trần) → `consumeOauthCompletionHandoff`
UPDATE (`:73`). **Không** `rateLimited(...)`. Bảng rate-limit của spec (`:305-315`, `:554-566`) không gán
bucket cho hop này. Cùng họ, nhẹ hơn: `POST /api/auth/logout` (forged cookie → UPDATE mỗi call) và
`GET /api/auth/session` (2 read).
*Fix:* bucket trusted-IP 10/phút trước khi đọc body; chỉ nhận `application/x-www-form-urlencoded`;
`readBoundedBody` (handoff dài 43 ký tự).

**X-2 · Dev Postgres superuser + mật khẩu cố định publish trên mọi interface · CONFIRMED**
`infra/docker-compose.yml:13-17` `plexco/plexco_dev`, `ports: "5432:5432"` (không `127.0.0.1:`); web
`3000:3000` (`:48`), discovery `3001:3000` (`:118`). Cùng cluster có `plexco_test` + mật khẩu cluster-global
`app_worker`. Thêm: web/discovery dev kết nối bằng **superuser** (`:40-41,116`) ⇒ RLS **không bao giờ
được thực thi ở dev** — HARD RULE 1 vô hình lúc phát triển (`entrypoint.sh:3`, `.env.example:15` nói
web = role `app`).
*Fix:* `127.0.0.1:5432:5432` (và 2 port web); cấp password cho `app` ở dev như đã làm cho `app_worker`
(`:80-81`) và trỏ `DATABASE_URL` vào đó.

**X-3 · Bật `OUTBOX_DISPATCH_SCHEDULE_ENABLED` hôm nay sẽ DLQ event thật · CONFIRMED**
Không phải bug mới — là **tiền đề đã mục**. `dispatcher.ts:60-64` + `queues.ts:13` nói an toàn "vì no
producer inserts outbox_events"; thực tế `session-service.ts` insert 8 loại event (`:274,656,919,1510,
1526,1814,2150,2189`). `worker.ts:24-33` mô tả đúng hệ quả: ack trước deliver + `dlq` terminal ⇒ event
chết cả hai đầu. Flag hiện OFF, default-OFF đúng, disable có `unschedule()` (đo `schedule.test.ts:243-269`).
*Hệ quả:* điều kiện "được bật" trong backlog `db-projector-dlq-no-replay-path` vẫn đúng, nhưng **lý do
an toàn** ghi trong code sai ⇒ ai đọc code sẽ tưởng bật được. *Fix:* sửa comment; thêm guard startup:
nếu `count(*) FROM outbox_events WHERE acked_at IS NULL > 0` và `deliver === productionStubDeliver` thì
**refuse** bật schedule.

### P3 — hardening / hygiene (đã verify, không chặn)

| ID | Vùng | Nội dung (file:line) |
|---|---|---|
| D-3 | db | `charges.amount_allocated/status`, `bank_transactions.unallocated_amount/reconcile_status` là cột tự do cho `app` (`0009:57`; `0010:99-101,127-128` cố ý); `charges` DELETE-able; không ràng buộc với `SUM(payment_allocations)` — trái P5 `core-db-architecture-principles.md:197`, INV-7. Code-dark (chưa writer). |
| D-4 | db | `tenant_admins` full DML cho `app`, không audit (`0009:32,57`) — trái SI-7 `auth-security-invariant-table.md:35`. Owner tự nhiên: `tenant-capability-authority-core`. |
| D-5 | db | `cancelSession` nhánh draft-anomaly commit event nhưng **không** ghi `processed_commands` (`session-service.ts:2144-2164`, throw sau commit `:2225-2230`) ⇒ retry cùng `commandId` sinh event mới mỗi lần — vi phạm INV-6. |
| D-6 | db | Outbox không có attempt bound; reclaim mọi lease chưa ack mỗi 5 phút, oldest first, mãi mãi (`0023:152-208`); `outbox_events` không cột attempts. Nửa deliveries đã có `db-projector-dlq-no-replay-path`. |
| D-7 | db | `create_oauth_transaction`/`consume_oauth_transaction` (`0010:49,64`) `SET search_path = public` **thiếu `pg_temp`** — chính repo giải thích vì sao thiếu là không đủ ở `0022:12-19`. |
| D-8 | db | Definer `app` gọi được nhận identity đích không ràng buộc: `auth_create_web_session(p_account_id)` `0015:129-153`, `auth_oauth_handoff_arm(..., p_resolved_account_id)` `0018:87-109`, `create_oauth_transaction(p_tenant_id)` **không** kiểm `app.tenant_id` (khác `raise_public_session_fence` `0033:173-180`). Trusted-server design; ghi vì khuôn chặt hơn đã có sẵn. |
| D-9 | db | `link_codes` thiếu cột DD-50 (`XOR issuer`, `max_attempts`, `locked_until`, `revoked_at`) — `0001:54-66` vs `decisions.md:686`; `tenant_link_codes.code_hash` bare text. Dormant. |
| D-10 | db | `zalo_bots.secret` plaintext, `bot_token_enc` là `text` không `bytea` (`0004:51-53`); `webhook_token` plaintext ở `bank_accounts` (`0003:20`) + `zalo_bots`; `web_sessions.csrf_secret` plaintext (`0001:101`). **0 writer** của cột `*_enc` credential; helper envelope-encryption cho bot/page/bank **không tồn tại** — KMS thật chỉ có ở pepper (`auth-secrets.ts:65-91`) + `email_enc`. Backlog `db-zalo-bots-secret-hardening` chỉ phủ `zalo_bots`. |
| D-11 | db | Không có catalog test "mọi bảng có `tenant_id` (trừ allowlist) phải ENABLE+FORCE RLS" — test hiện là hand-list 13/33 (`rls-invariants.test.ts:83-96`); post-apply check chỉ `count(*) FROM pg_policies > 0` (`migrate.ts:313-326`); runner không từ chối file số thấp hơn file đã apply. |
| D-12 | db | Hai FK ledger ràng tenant nhưng không ràng aggregate: `charges(tenant_id, player_id)` không ràng `session_id` (`0019:23-25`, code tự nhận `session-service.ts:2139-2143`); `payment_allocations.reverses_allocation_id` không ràng cùng `charge_id` (`0020:21-24`). |
| D-13 | db/docs | `feature_sync_engine_tech.md:38,139,270` claim partition theo aggregate ordering key; runtime chỉ `ORDER BY created_at` trong CTE + `SKIP LOCKED`, không partition (`0023:176-208`). Xác nhận: **không** thứ tự per-aggregate. |
| D-14 | db | Lock-order publish (`tenants/subscriptions FOR SHARE :429` → `sessions FOR UPDATE :511`) ngược update (`sessions :1237` → `subscriptions :1297`) — thành deadlock 3 bên khi job suspend tương lai `FOR UPDATE subscriptions`. Retryable, không corrupt. |
| D-15 | db | `tenantRepo().sessions.create` nhận `status:'open'`, bỏ qua cả họ command (`tenant.ts:41-53,82-102`, export `index.ts:14`), 0 caller. `authorizeTenantAction`/`resolveCapability` **re-set** GUC theo tham số (`authorization.ts:189`, `capability.ts:183`) thay vì assert bằng — tenantId lệch sẽ re-scope transaction trong im lặng. |
| W-4 | web | HR5: landing OAuth `session-cookies.ts:166-171` `<html lang="en">`, title/button English-only ngoài `t()`; test phân loại DD-118 (`tenant-lang.test.ts:148-159`) suy "0 `t()` ⇒ 0 chuỗi user-facing" — đúng lớp sai HR5 nó phải bắt. |
| W-6 | web | Cookie không `__Host-` prefix; `Secure` chỉ theo `NODE_ENV` (`session-cookies.ts:13-14,36-44`); TTL 30 ngày tuyệt đối không idle (`0015:171`). Sibling-subdomain cookie-toss ⇒ login CSRF qua `plx_oauth_google`. |
| W-7 | web | CSRF secret so bằng `===` (`session-cookies.ts:188-191`); `POST /api/auth/logout` không `csrfOk`/`sameOriginRequest` (`logout/route.ts:19-24`). Spec `:326` vs SI-4 (`:91-99`) **tự mâu thuẫn**. |
| W-8 | web | `onboarding/start` `request.json()` không trần, `tenants.name` không max length (`start/route.ts:28-37,56`; `0002:13`). |
| W-9 | web | GET có side effect cross-site: `google/state` ghi transaction + đè cookie; `<img src>` ×10 đốt bucket IP nạn nhân. |
| W-10 | web | Không gì assert runtime DB role (`client.ts:24-31`); session-service predicate chỉ `eq(sessions.id)` (`:517,644,1252,1805,2041,2178`), tenant scope 100% dựa GUC; `start:discovery` = `next start` thường ⇒ ingress discovery phục vụ **toàn bộ** route (chỉ fail vì `readonly` thiếu EXECUTE). |
| W-11 | web | Callback/complete `catch {}` nuốt hết, **0 log** (`google/callback/route.ts:49-66`, `complete/route.ts:31-38`); cả app chỉ 1 `console.*` runtime. Outage KMS/JWKS không phân biệt với input sai. |
| W-13 | web | `jwtVerify` không pin `algorithms: ["RS256"]` (`google-oidc.ts:66-72`). |
| W-14 | web | `GET /api/auth/session` trả CSRF secret, không set `Cache-Control: no-store` tường minh (`api-envelope.ts:6-15`). PLAUSIBLE. |
| B-2 | bot | Drift `REQUIRED_PROJECTORS` xuyên replica được thừa nhận trong comment (`dispatcher.ts:14-30`) nhưng **không có row backlog** — old replica ack với set ngắn ⇒ projector mới không bao giờ thấy event. |
| B-3 | bot | Shutdown không graceful cho `deliver()` đang bay, không timeout (`worker.ts:122-129`). |
| B-4 | bot | Entrypoint guard `endsWith("worker.ts")` (`worker.ts:137`, `provision-queue.ts:51`) — compile sang JS ⇒ worker start rồi exit 0 im lặng. |
| X-4 | infra | Worker nhận toàn bộ `.env` (`compose.yml:99-101`) dù chỉ đọc 2 biến — `GOOGLE_OAUTH_CLIENT_SECRET`, `ENCRYPTION_KEY`… vào container không cần. |
| X-5 | infra | Comment mục: `entrypoint.sh:25-27` nhắc service `queue-provision` không tồn tại; `compose.yml:61` "0000→0033", `fly.toml:15` "0000→0013" (tail thật 0036); `Dockerfile:42` "healthcheck-ready" nhưng không `HEALTHCHECK`; worker không có liveness. |
| X-6 | ci | `ci.yml` không có `permissions:` block (security.yml/linear-sync có). `concurrency.cancel-in-progress` áp cả `main` (`:10-12`). |
| X-7 | scripts | `autopilot-backlog-reconcile:378` `git grep -qE "$pr"` — regex từ backlog làm positional arg (giá trị bắt đầu `-` thành option); `ap-finish.sh:44-45` nhận slug `.`/`..` (scope-gate `:483,521` thì không). |
| C-1 | core | `parseMoney` (`dates.ts:212-220`) không bound safe-integer, `"1.5k" → 15000` (×10), 400 chữ số → `Infinity`; `splitNameAmount` (`payments-logic.ts:88-89`) chỉ chặn `null`/`<=0` ⇒ `Infinity` thành candidate. 0 caller ngoài core. |
| C-2 | core | `buildVietQrUrl` (`vietqr.ts:16`) interpolate `bin`/`account` không encode, `amount` không validate. |
| C-3 | core | `parsePlusOneSuffix` regex (`matching.ts:96`) quadratic trên input crafted; chỉ OCR-label. |

**Đã có trong backlog, không báo lại:** `db-projector-dlq-no-replay-path` · `job-outbox-dispatch-sync-lag-slo` ·
`db-zalo-bots-secret-hardening` · `db-app-worker-least-privilege-attestation` · `dev-app-worker-password-not-restored` ·
`manifest-verification-smoke-run-before-lock` · `infra-do-app-vpc-deployment` · `no-preflight-authority-gate` ·
`tenant-capability-authority-core` · `chat-identity-merge-reparent-enablement` · `email-password-bundle-order-4`.

---

## 3. Docs lệch code (16 điểm — docs chậm hơn code là chính)

| # | Docs nói | Code | Hệ quả |
|---|---|---|---|
| 1 | `ROADMAP.md:562` "13 route … thiếu close · cancel · announce"; `:574` "5 route nghiệp vụ" | 15 route; `close/route.ts:24`, `cancel/route.ts:25` có | Cùng file tự mâu thuẫn; HANDOFF:6-8 đã đúng |
| 2 | Backlog `session-commands-update-close-cancel` `status: blocked`, `scope: []`, probe "all four ABSENT" (`:3472-3475`) | `updateSession:1117`, `closeSession:1689`, `cancelSession:1972`, `announceSession:791` | Row phải flip `merged` |
| 3 | `ROADMAP.md:584` "🟡 `identity-account-link.ts` internal-only" | **file không tồn tại**; chỉ SQL fn `0034:83` + test | Cite phantom file làm bằng chứng BE |
| 4 | `ROADMAP.md:632` Module 10 BE ⬜; `decisions.md:1937` "launch chạy trên tenant provision **thủ công**" | `onboarding/start/route.ts:18` → `auth.ts:207` → `0028:218` — self-serve **đã có** | DD-114 D6 ranh giới làn A/B mô tả một thứ code đã vượt qua; xem §5 #8 |
| 5 | `ROADMAP.md:577`, `PRD.md:280`, `dispatcher.ts:63`, `queues.ts:13`: "no producer" | `session-service.ts` emit 8 event | **X-3** — lý do an toàn để bật flag đã mục |
| 6 | `feature_session_management_tech.md:6` "SessionService/routes/projectors… vẫn chưa build" (v2.25, 27/08) | 6 command + 5 route | Header spec mục |
| 7 | Spec readiness `web_auth_tech.md:120-129` | `readiness/route.ts:19-20` đòi `tg_bind` | **W-5** |
| 8 | Mọi product doc: Telegram đã loại | route/service/schema/secret Telegram còn nguyên | **W-1** |
| 9 | `ROADMAP.md:642` Module 18 "`authorizeTenantAction` merged, **0 caller**" | 5 caller `session-service.ts:429,612,805,1297,1702,1991`; `:579` cùng file nói ngược | Row Module 18 stale |
| 10 | `ROADMAP.md:585`, `user_settings_tech.md:449` "readiness vẫn `t()` không language context" | `readiness/route.ts:45 runWithLang` | HANDOFF:9 đúng, hai chỗ kia chưa mirror |
| 11 | `session_mgmt_tech.md:121` `players_status_chk IN ('active','left','waitlisted','pending')` | `0014:79-80` không có `'pending'` | Spec DDL ≠ live |
| 12 | `notifications_tech.md:5` "DDL vẫn chưa có trong schema.ts" | `schema.ts:1589-1650`, `0008` có 3 bảng; thân `:52` tự nhận | Header sai |
| 13 | `ROADMAP.md:562,582` "DD-56 lint guard"; `decisions.md:751-755` ESLint `no-restricted-imports` | snapshot không có `eslint.config.*` (CI chạy `eslint .` nên chắc có trên main) | PLAUSIBLE — owner xác nhận bằng `ls eslint.config.*` |
| 14 | DD-113:2126-2128 **cấm** chữ "PWA" tới khi có manifest+SW | `BRD.md:135,380,386`, `PRD.md:207`, ROADMAP nhiều chỗ dùng "PWA"; `apps/web` không manifest, không SW | Vi phạm lệnh của chính DD |
| 15 | `ROADMAP.md:557` 46 test file | 50 (HANDOFF:10 đúng) | Nhỏ |
| 16 | `web_auth_tech.md:327` CSP/XFO; `:326` CSRF mọi mutation; `:214,585` redaction middleware; `:41` `GET /api/auth/google` | không header (W-2); logout không CSRF (W-7); không middleware; path thật `/google/state` | Spec claim thứ chưa có |

---

## 4. Requirement KHÔNG có code VÀ KHÔNG có row backlog

Grep 146 slug backlog: **0 row** cho `remind|notification`, `settings|privacy|profile|gender|username`,
`pwa|manifest|service worker`, `i18n`, `a11y`, `backup|PITR`, `telegram`-removal, session read API.

| Gap | Nguồn requirement | Backlog gần nhất |
|---|---|---|
| **`GET /api/sessions` + `GET /api/sessions/:id`** — khối 3/4 launch không có đường đọc | DD-113:2117-2118; `session_mgmt_tech.md:269-270` | không (`docs-session-management-acceptance-checklist` là docs) |
| **Writer nào cho `players`** (host add / bot join / web join) — roster vĩnh viễn rỗng | DD-113:2117-2118; DD-114 D4:2042; BRD FR-2.2:184 | không (`feature-cross-club-join` là P4.3 marketplace) |
| **Mark-paid thủ công** (DD-40, "killer feature", mọi tier) | BRD FR-5.1:201; PRD FLOW 6:165-166; AC-6:396 | không |
| Webhook SePay/ApiPay + `bank_transactions` ingest + `/unmatched` | FR-5.2–5.5:202-205 | `apipay-signed-body-reconciliation` blocked (evidence only) |
| Reminder cron / `/remind` / confirm-paid notify | BRD:154,214-215; PRD FLOW 7/8 | không |
| Zalo webhook/adapter/parser/bot-token connect | DD-114 nhóm 3; `zalo_channel_tech.md`; PRD FLOW 1 | chỉ `db-zalo-bots-secret-hardening` |
| Identity `link_code` issue/consume/merge (khối 2 launch) | DD-113:2116; `identity_tech.md` | `feature-identity` idea, `scope: []` |
| Club config `PATCH /api/onboarding/club` | BRD FR-1.4:180; PRD FLOW 1 step 5 | không |
| User settings route/schema (gender/dob/username/language/prefs/linked channels) | DD-113:2119; FR-11.1–11.3 | không (`docs-user-settings-0014-…` docs) |
| PWA manifest + SW + shell 375px | DD-113:2126-2128; DD-69 | `web-app-shell` idea (không nhắc PWA) |
| Web realtime SSE | FR-4.3:198 | không |
| Projector thật thay `productionStubDeliver` | FR-4.2:197 | `job-consumers-per-feature` idea |
| Gỡ Telegram (code + schema CHECK + `tg_bind`) | `web_auth_tech.md:14` | `auth-provider-google-email-swap` idea (chỉ phủ port Google) |
| Readiness predicate sửa theo spec (W-5) | `web_auth_tech.md:120-129` | không |
| Security headers (W-2) · rate-limit `google/complete` (W-3) · `subscriptions` REVOKE (D-1) · `tenant_provision` RLS (D-2) · dispatcher grammar (B-1) · CI `origin/main` (X-1) | audit này | **không** — 6 row mới đề xuất §7 |
| A3 PII data-class matrix → luật sư | DD-114 D5 | `docs/legal/*-DRAFT.md`; owner ngoài repo |
| Backup/PITR drill (NFR-R5), observability (NFR-O2: `SENTRY_DSN`/`LOG_LEVEL` có trong `.env.example`, **0 reader**), a11y | BRD:275,279 | không |

---

## 5. Docs mâu thuẫn nhau (hai kỹ sư sẽ build hai thứ khác nhau)

1. **Auto-reminder tier** — `BRD.md:154` BR-8, `:214` FR-6.1, `AC-6:396` không gate tier; `decisions.md:1941-1945`
   DD-114 D2 + `PRD.md:182-183`: auto = `host_pro`, free = `/remind` tay.
2. **Ngôn ngữ per-user** — DD-113:2119 khối 5 "ngôn ngữ", BRD FR-11.1:243, NFR-L1:282 "theo hồ sơ" vs
   `user_settings_tech.md:449` + DD-118: `persons.language` **bị gỡ**, "KHÔNG đề xuất cột locale cấp member";
   code chỉ `tenants.locale`. **Launch khối 5 đòi một setting mà authority từ chối schema.**
3. **Public/private OQ** — `BRD.md:132` (v3.9q) "⬜ chưa chốt … AWAIT" vs `decisions.md:1985-1988` "✅ CHỐT 26/08 (b)".
4. **Zalo webhook** — `PRD.md:98` `/webhook/zalo/<token>` bot-per-club; `connector_onboarding_tech.md` +
   `X-Bot-Api-Secret-Token`; `zalo_channel_tech.md:150` `POST /webhook/zalo` OA signature. Ba hình.
5. **SePay path** — `payment_reconcile_tech.md:434` `/webhook/sepay` vs `:413,705,736`, `PRD.md:170` `/webhook/sepay/:token`.
6. **Mark-paid endpoint** — cùng một spec: `:57` per-player `/api/sessions/:id/players/:id/mark-paid` vs
   `:667,685,739` multi-select `/sessions/:id/mark-paid`.
7. **Readiness step names** — spec ví dụ `:270` `club/bank/zalo` vs code `club_config/bank_connect/…`.
8. **Launch vs nhóm 2** — DD-114 D1 "nhóm 2 ❌ mới so với launch", D6 "tenant provision thủ công" vs
   `web_auth_tech.md:246` `POST /api/onboarding/start` Reviewed + **đã build**. Launch dùng self-serve
   (thì ranh giới làn A/B sai) hay tắt route lúc launch — không doc nào nói.
9. **`confirmed_count`** — `BRD.md:189,253` whitelist có "confirmed count" vs DD-114 D3 (d) `0033:69` cố ý
   defer vì làm hold count suy ra được (BL-DSC-1 cấm).
10. **Occupancy floor** — `session_mgmt_tech.md:277` `CAPACITY_BELOW_OCCUPANCY` (roster+hold) vs code chỉ
    `CAPACITY_BELOW_ROSTER` vs backlog `capacity-floor-active-vs-paid-roster` đề xuất *paid* roster. Ba floor.

---

## 6. NFR (BRD §8) — có bằng chứng code/test/config không

| NFR | Bằng chứng | Trạng thái |
|---|---|---|
| S1 tenant isolation | `0009`; `rls-invariants.test.ts` (113 test); `withTenant` `SET LOCAL`; composite FK `0019`–`0021` | **CONFIRMED mạnh** |
| S2 public whitelist / anti-enumeration | `0033` view + `0036` revoke; chưa reader/route ⇒ scraping chưa test được | PARTIAL (structural) |
| S3 tenant từ channel, không từ content | chưa có channel code | PARTIAL (web only) |
| S4 webhook per-tenant, timing-safe, store-before-process | không webhook route; chỉ `webhook-verification-matrix.md` | NONE trong code |
| S5 secret at rest KMS | pepper aws-kms fail-closed; `email_enc`; `zalo_bots.secret` plaintext | PARTIAL (D-10) |
| S6 audit money/identity | `processed_commands`, `merge_audit`, `job_audit_events`; chưa mutation tiền | PARTIAL |
| P1 PII consent/retention/delete | chỉ encrypt helper; không consent/retention/delete | NONE; A3 DRAFT |
| PF1/PF2/PF3 load / throttler / sync ≤ s | `rate_limit_hits`; `worker.ts:29-40` tự nhận cron 1 phút không đạt p95 ≤ 3s | NONE (known) |
| R2 idempotency | `processed_commands (tenant_id, command_id)` DD-117 D5; `outbox_agg_seq_uq` | **CONFIRMED** cho session command |
| R5 backup PITR + drill | `environments-setup.md:40-41` prose | NONE |
| O2 observability | `SENTRY_DSN`/`LOG_LEVEL` 0 reader; 18 `console.*`; 0 metric | NONE |
| L1 vi default + en | `i18n.ts:42,50`; `tenant_locale()` `0035`; per-user none | PARTIAL |

---

## 7. Đề xuất lane (BE + infra trước, theo ưu tiên owner 25/08 · 02/09)

Sắp theo *khoảng cách tới go-live*, không theo severity lý thuyết. Mỗi row = một lane Level 3, P2,
`supervised`, scope hẹp. **Không** lane nào ở đây cần quyết định Tier C của owner trừ #7.

| # | Lane | Scope (file) | Đóng finding |
|---|---|---|---|
| 1 | `ci-review-check-resolve-origin-main` | `scripts/check-review-readiness.mjs`, `.github/workflows/ci.yml` (+ `permissions: contents: read`) | X-1, X-6 |
| 2 | `db-tenant-provision-rls-self-scope` | migration mới: `CREATE OR REPLACE tenant_provision` + `tenant_ids_for_person` set GUC; test dưới `setupNonSuperuserOwnerContext` | D-2 |
| 3 | `web-onboarding-readiness-predicate` **gộp** `auth-telegram-removal` | `readiness/route.ts`, 2 route telegram, `telegram-login.ts`, `auth.ts:46`, `fly.toml`, `.env.example`, migration thu hẹp `platform_chk`, pin D1-14 | W-5, W-1 |
| 4 | `db-subscriptions-read-via-definer` | migration `resolve_subscription_locked` (khuôn 0027) + REVOKE DML `subscriptions` khỏi `app`; sửa `authorization.ts`, `capability.ts` | D-1 |
| 5 | `bot-dispatcher-outcome-grammar-fail-closed` | `dispatcher.ts` (`completionArgs` normalise + catch `invalid_parameter_value`), test | B-1; sửa comment mục (X-3) + guard "producer có event chưa ack + stub ⇒ refuse enable" |
| 6 | `web-security-headers-and-complete-ratelimit` | `next.config.mjs` `headers()`, `google/complete/route.ts` bucket + bounded body, test pin | W-2, W-3 |
| 7 | `session-read-routes-list-detail` — **cần owner chốt DTO** (HR2: field nào ra ngoài) | `GET /api/sessions`, `GET /api/sessions/:id`; DTO whitelist; test | Gap #1 §4 — **điều kiện cần của launch khối 3/4** |
| 8 | `infra-dev-compose-loopback-and-app-role` | `docker-compose.yml` bind `127.0.0.1`, password cho `app`, bỏ `env_file` khỏi worker | X-2, X-4 |
| 9 | Docs sweep một commit: ROADMAP:562/577/584/632/642, backlog row `session-commands-update-close-cancel` → merged, `session_mgmt_tech.md:6`, `notifications_tech.md:5`, BRD:132 mirror DD-114 D3, thay chữ "PWA" theo DD-113 | docs | §3 #1-6, #9-12, #14 |

**Việc chỉ owner quyết được (Tier C), phát hiện từ audit:** (a) roster writer nào là *đầu tiên* — host
add tay trên web hay bot join DD-32 Option D (quyết định này chọn thứ tự làn A/B của DD-114 D6);
(b) launch dùng self-serve `onboarding/start` hay tắt nó (§5 #8); (c) ngôn ngữ per-user ở khối 5:
giữ lời DD-113 hay giữ DD-118 (§5 #2); (d) A3 gửi luật sư.

---

## 8. Đã đo là ĐÚNG (không cần đo lại)

RLS fail-closed + FORCE 33 bảng · `app` zero quyền `public_sessions` · guarded view whitelist =
BL-DSC-1 · không `GRANT PUBLIC`/`GRANT ALL`/default privileges · mọi definer callable `REVOKE FROM
PUBLIC` · job fn owner `job_definer` (NOLOGIN BYPASSRLS), runtime role không member · ledger
append-only trigger · outbox producer boundary CHECK · session command: dedup + advisory lock + `FOR
UPDATE` + `clock_timestamp()` sau khoá + fail-closed refuse tiền/roster + fence raise in-tx ·
auth: sha256 token, rotation parent-first, epoch revoke-all, argon2id policy trigger, GCM tag pin,
OAuth state/PKCE/handoff single-use, `redirect_uri` chỉ từ `APP_BASE_URL`, không open-redirect ·
rate limiter một store + advisory lock, IP pin đúng một provider header, `direct` cấm ở prod ·
`auth-secrets.ts` fail-closed mọi biến, không default dev · P17 hash guard + AP-42 log allowlist ·
preflight hard-assert `app_worker` · `productionStubDeliver` chỉ DLQ · flag OFF exact-string + unschedule
· `db-reset-test.mjs` an toàn (allowlist identifier + `_test` suffix + argv array, không shell) · CI chạy
đúng `pnpm -w test` canonical, action pin SHA, Semgrep blocking · HR5: 47 `t()` site, 0 key-based ·
`schema.ts` khớp 69 bảng SQL.
