# Handoff backend — Plexco (không gồm FE/UI)

> **Dành cho:** senior dev nhận phần backend · DB · bot/worker · job · infra · security · tooling.
> **Đo tại:** `main@7f6d00e` (26/09/2026, ngay sau PR #37); **re-pin `main@dd5375f`** (sau PR #38 dọn backlog và PR #39 nạp queue ap3). Mọi số trong file này tái tạo được bằng lệnh ở §10.
> **Đọc kèm, không lặp lại ở đây:** `docs/00-start-here/DEV-ONBOARDING.md`. File đó hướng dẫn dựng máy, nêu 5 HARD RULES, commit root lock và các bẫy đã trả giá. File này trả lời bốn câu: **làm gì tiếp, input là gì, output nộp ra là gì, chạy bằng quy trình nào để agent làm được phần lớn.**
> **Hết hạn khi** `git diff --name-only dd5375f..origin/main -- packages apps scripts docs/autopilot-backlog.md` không còn rỗng. Khi đó, trước khi nhận một task, chạy lại lệnh kiểm của chính task đó.
> **Ngoài phạm vi:** mọi thứ trong `apps/web` là màn hình/UI, design, `.pen`, FE spec (`docs/channels/web/FE/*`). FE đang **PENDING theo lệnh owner** (DD-116), nên không mở lane FE.
> ⚠️ **12/10/2026 — DD-122 đã gỡ FE PENDING** cho full MVP; lane FE mở theo `autopilot-templates/web-mvp-2026-10-12-RUN.md` (M0–M13). Phần backend của file này vẫn là input cho M2 (track A, C1–C3) · M3 (track D) · M5 (track E) · M6 (track B) · M7 (C4–C7). Bảng §6 "Quyết định owner đang chặn": các dòng có default nay **áp theo DD-122 D3**. **§2 mục 2 ("Codex review sạch"), §7.2 (scope-gate lifecycle), §7.4 (Codex reviewer) và §7.6 (prompt mẫu) KHÔNG áp cho PR của chương trình Web MVP** — DD-122 D4 thay bằng Claude subagent review độc lập; mọi task ngoài chương trình giữ nguyên §7.

---

## 1. Context trong một màn hình

**Sản phẩm.** Plexco là platform hai phía cho thể thao phong trào đa môn. **Host** (chủ CLB) tạo kèo, quản roster, thu tiền chuyển khoản và đối soát. **Player** tìm kèo, join, theo dõi nợ. Surface ra mắt gồm web app và Zalo bot song song. Messenger vào phase-1 (chờ Meta App Review), native vào phase-2. **Plexco không cầm tiền player**, chỉ ghi nhận và đối soát.

**Trạng thái thật** (`pnpm progress` tại `7f6d00e`):

| Hạng mục | Số | Ghi chú |
|---|---|---|
| Migration | **49** (`0000`–`0048`) | Số kế tiếp là **`0049`** |
| API route | **15** = 6 auth + 2 onboarding + 7 session **ghi** | **0 route ĐỌC** session (`GET` chưa có) |
| Session command | 8 | `packages/db/src/session-service.ts` |
| Màn FE nối API | **0** | FE PENDING (owner) |
| BE readiness phase-1 | **39%** | Trung bình migration + BE + tests trên 20 module phase-1 |
| Launch readiness | **8%** | Trục yếu nhất của 6 module chặn launch |

**Thứ đã chạy thật:** multi-tenant với RLS fail-closed (`tenantRepo`, `withTenant`, `ensureTenantContext`); Google login (merged nhưng ⛔ **chưa bật**, `GOOGLE_OAUTH_*` rỗng); 8 session command và 7 route ghi; public read model có fence (`0033`/`0036`); hardening audit (`0037`–`0046`); storage của capability registry DD-56 (`0047` + bản vá `0048`).

**Thứ "code dark"** (đã build nhưng chưa ai gọi, đừng đọc thành feature):

| Thành phần | Bằng chứng |
|---|---|
| Sync engine / outbox | Producer có (session-service emit event). Consumer là `productionStubDeliver` (`apps/bot/src/dispatcher.ts:77`), đẩy **mọi** delivery vào DLQ. `OUTBOX_DISPATCH_SCHEDULE_ENABLED` OFF |
| Capability / billing | `resolveCapability()` (`packages/db/src/capability.ts:148`) có **0 caller production** |
| Identity link | `issueLinkCode` / `consumeLinkCode` (`packages/db/src/identity.ts`, `0043`) có 0 caller ngoài `packages/db` |
| Chat | Bảng `chat_*` (`0030`–`0032`) tồn tại, **0 dòng TS** đọc/ghi |
| Matching tiền | `packages/core/src/matching.ts`, `payments-logic.ts` chỉ là thư viện; chưa có đường webhook → settle → notify |
| Grants DD-56 | Bảng `tenant_capability_*` (`0047`) chưa có reader; route vẫn check `ALLOWED_ROLES` (`apps/web/lib/session-command-route.ts:82,181`) |

**Chưa có gì** (chỉ có bảng hoặc spec): Zalo adapter, Messenger adapter, SePay webhook + ledger allocation, notification/reminder, cross-club join, channel booking, billing lifecycle, deployment production.

**Trạng thái 27 BE spec so với code** (`docs/features/BE/*_tech.md`):

| Trạng thái | Feature |
|---|---|
| IMPLEMENTED | multi_tenant |
| PARTIAL | web_auth_onboarding (Google xong, email/password chưa) · session_management (thiếu GET, auto-expiry, auto-close, waitlist, recurrence) · tenant_routing_authz (mới M1) · marketplace_discovery (chỉ fence) · security_operations (thiếu pen-test, PITR, observability) |
| CODE DARK | sync_engine · identity · inapp_chat · payment_reconcile |
| NOT STARTED | billing_lifecycle · notifications_reminders · cross_club_join · channel_booking_funnel · player_messenger · zalo_channel · connector_onboarding · player_view/home · club_assistant · session_organize · share_activities · membership · tournament · user_settings · club |

> ⚠️ Nhiều header spec ghi sai trạng thái (vd. tenant_routing_authz ghi "Not started", inapp_chat ghi "schema chưa vào"). **Tin code, không tin header.**

**Thứ bậc tài liệu khi mâu thuẫn:** code + `packages/db/schema.ts` + `migrations/*.sql` > `docs/standards/decisions.md` (✅ chốt) > BRD/PRD/TDD > ROADMAP > research. Decision 🟡 là đề xuất, **commit ≠ ratify**.

---

## 2. Cách đọc một task trong file này

Mỗi task có:

- **ID handoff** (vd. `A1`) và **slug backlog** trong `docs/autopilot-backlog.md`. Tra row bằng `grep -n '^## task: <slug>' docs/autopilot-backlog.md`. File này cố ý không ghi số dòng: backlog đổi mỗi lần reconcile nên số dòng lệch ngay.
- **Risk / lane**. Risk P0–P3 quyết định quy trình (xem §7.1):
  - P0: chỉ làm tay.
  - P1: Level 3 supervised.
  - P2 thuộc class ap3 đã bật: đi làn tự động.
- **Chặn bởi**: task khác, hoặc **quyết định owner** (ghi rõ mã quyết định, tra ở §6).
- **Input**: file spec/contract/code phải đọc, có số dòng khi có.
- **Output**: artifact phải nộp (migration, module, route, test, doc, evidence).
- **Xong khi**: điều kiện nhị phân.

**Định nghĩa "xong" chung cho mọi task code:**

1. PR merged vào `main`, CI xanh (`ci.yml` và `security.yml`).
2. Codex review sạch: 2 vòng code, cộng 1 vòng security nếu chạm auth, secret, quyền, tiền, input ngoài hoặc deploy.
3. `merged_probe` của row có mặt trên `origin/main`.
4. Row backlog được flip sang `merged`.

**Việc owner giữ:** merge, deploy, bật flag production, và mọi quyết định sản phẩm.

---

## 3. Việc 0 — dọn sổ trước khi nhận task (nửa ngày)

Sổ sách đang lệch với code. Nếu không dọn, agent sẽ chọn nhầm việc đã xong.

| # | Việc | Cách làm | Output |
|---|---|---|---|
| 0.1 | ~~35 row `in-flight` từ audit 06/09 thực ra đã land~~ | **Xong ở PR #38** (`f8e741d`): 35 row flip sang `merged`, mỗi row có `note_merged` ghi commit land. `scripts/autopilot-backlog-reconcile` **không quét** row `in-flight` (chỉ `planned\|ready\|blocked`), nên lần sau vẫn phải kiểm tay | `grep -c '^status: in-flight' docs/autopilot-backlog.md` = 0 |
| 0.2 | Hai row đóng kèm ghi chú | `web-csp-script-src-nonce`: code đã land (`0f92f35`), row để `merged`; việc bật `CSP_SCRIPT_NONCE_ENABLED` sau test trình duyệt thật là việc của owner, theo dõi ở **E7**. `audit-2026-09-06-codex-review-rounds-closeout`: đã đóng tay trong #38 | — |
| 0.3 | `ap3/queue/bot-test-db-helpers-triplicated.md` vẫn nằm trong queue dù PR #33 đã merge | `git mv` sang `ap3/queue/done/`. Trên máy owner nó **không** chạy lại (`ap3/dispatch.sh:1481` bỏ qua slug đã có `ap3/state/runs/<slug>/record.json`), nhưng máy mới/state bị xoá thì sẽ chạy lại | Queue chỉ còn task chưa chạy |
| 0.4 | Row `tenant-capability-authority-core` vẫn ghi `planned` | Thêm ghi chú: M1 đã land (`0047` PR #34, `0048` PR #37); còn M2 và M3 | — |
| 0.5 | Các row/tài liệu khác đã mục | `auth-provider-google-email-swap` đã mục vì Google đã merge. `local-dev-sanctioned-paths-are-harder-than-the-forbidden-one` có `scripts/db-reset-test.mjs` rồi, cần kiểm và flip. ROADMAP và `modules.json` pin `12f5191`. `docs/slice-readiness-verdicts.md` dừng ở V31 (31/07) | Re-pin ROADMAP §📍 bằng `pnpm progress` |
| 0.6 | ~~Hàng đợi ap3 trống~~ | **Xong ở PR #39** (`dd5375f`): task `db-test-lock-barrier-helpers-duplicated` (class `code-quality-p2`). Dispatcher nhận lúc 2026-09-26 15:57Z, pre-flight `READY` ($0.78). **Đừng áp bất kỳ patch "0002 … lock-wait-helpers" nào khác**: đó là bản nháp trùng việc, sẽ chạy refactor lần hai | Theo dõi `ap3/state/runs/db-test-lock-barrier-helpers-duplicated/record.json` và PR ap3 |

---

## 4. Bản đồ phụ thuộc

```
A. AUTHZ (DD-56)     A1 authorize() ──▶ A2 đổi 7 route ──▶ A3 route ĐỌC session
                                                  ├──▶ A4 audit tenant_admins
                                                  └──▶ F1 chat command (xa)

B. JOB / PROJECTOR   B1 DLQ replay ──▶ B2 projector thật ─┐
                     B3 sync-lag NOTIFY ──────────────────┴▶ [owner bật OUTBOX_DISPATCH_SCHEDULE_ENABLED]
                     B4 scheduler cron ──▶ B5 draft auto-expiry        │
                                                                        ▼
C. SESSION / TIỀN    [owner C1] C1 roster writer ──▶ C2 mark-paid ──▶ C3 ràng buộc ledger
                                        └────────────────────────────▶ C5 reminder + confirm-paid
                     C4 capability wiring (caller đầu tiên của resolveCapability)
                     C6 SePay webhook + ledger ◀── [evidence ngoài: ApiPay, egress]

D. KÊNH / IDENTITY   [owner O4 + chốt hình webhook] D1 Zalo adapter ──▶ D3 caller link_code ──▶ merge/claim (P0)
                     D2 mã hoá secret Zalo (KMS) ◀── [owner O4]

E. INFRA             E1 deploy DO (P0, tay) ──▶ E2 PITR drill
                     E3 observability (độc lập)
```

**Đường tới doanh thu** (ROADMAP §💰): session CRUD → **C1 → C2** (free tier vận hành được từ đây) → dogfood tenant #1 trên kênh thật (cần **D1** + **E1**) → billing. Chat, marketplace và Messenger **không** nằm trên đường này.

---

## 5. Danh sách task

### Track A — Authorization DD-56 (bắt đầu được ngay, không chờ owner)

#### A1 · `authorize()` primitive (M2)
- **Backlog:** `tenant-capability-authority-core`, milestone M2 · **P1 · Level 3 supervised**.
- **Chặn bởi:** không (M1 đã merge).
- **Input:**
  - `ap3/features/tenant-routing-authz/PLAN.md` (mục M2)
  - `docs/features/BE/feature_tenant_routing_authz_tech.md` `:385-451` (action matrix, "actor-recheck-under-lock") và test rows #21–28, #32 (`:509-520`), chỉ phần core theo ghi chú `:525-530`
  - `docs/autopilot-invariant-catalog.md:60`
  - Khuôn: `packages/db/migrations/0038_subscriptions_read_via_definer.sql`
  - Nền: `0047_tenant_capability_authority_core.sql`, `0048_capability_grant_trigger_search_path.sql`
- **Output:**
  - Migration **`0049_*`**: hàm SECURITY DEFINER plpgsql với
    - `SET search_path = pg_catalog, public, pg_temp` (bài học `0048`) và qualify `public.`
    - `p_tenant_id` bị ràng với `current_setting('app.tenant_id')`
    - `FOR SHARE` trên row `tenant_admins` của actor, và trên row grant nếu action delegable
    - `clock_timestamp()` (không dùng `now()`) cho `expires_at` / `revoked_at`
    - `REVOKE ALL … FROM PUBLIC` rồi `GRANT EXECUTE … TO app`
  - `packages/db/src/tenant-capability-authority.ts` export `authorize(tx, action, actor, target)`: fail-closed, coi `admin` ≡ `co_admin`
  - Test mới, barrel export trong `packages/db/src/index.ts`
  - Bump `MIGRATION_COUNT` và mọi tail assert trong `migrate.test.ts` và `rls-invariants.test.ts`
  - Launcher `.claude/commands/ap-56-*.md` và manifest `docs/autopilot-manifests/tenant-capability-authority-core--m02-*.json` (**chưa ai viết**; chép khuôn AP-55)
- **Cấm trong slice này:** đụng route, test #33–35, integration #5/#7, command cấp grant.
- **Xong khi:** định nghĩa chung ở §2.

#### A2 · Đổi 7 route sang `authorize()` và gỡ guard tạm (M3)
- **Backlog:** như A1, milestone M3 · **P1 · supervised** · **chặn bởi A1**.
- **Input:**
  - `apps/web/lib/session-command-route.ts:82,181`
  - `eslint.config.mjs:121-186`
  - `apps/web/lib/session-command-route.test.ts:525-585`, `:1143-1329`
  - `docs/standards/decisions.md:739-817` (DD-56 amendments #1–#3)
  - BE spec `:356-377`
- **Output (một PR):**
  - Thay check `ALLOWED_ROLES` bằng `authorize("session.manage", actor, target)` **trong** transaction của command; khoá actor/grant **trước** khoá row session
  - Xoá block ESLint DD-56, viết lại hoặc bỏ các AST test
  - Void amendments #1–#3 trong `decisions.md`
  - Rà mock trong test của 7 route
- **Lưu ý:** A2 và A3 cùng sửa `session-command-route.ts`, nên **chạy tuần tự**.

#### A3 · Route ĐỌC session: `GET /api/sessions`, `GET /api/sessions/:id`
- **Backlog:** `session-read-routes-list-detail` (`blocked`); session-management PLAN M2 · P1/P2 · supervised.
- **Chặn bởi:** owner quyết **DD-56-read-routes** (§6). Default là "chờ capability core", nghĩa là làm sau A2.
- **Input:**
  - `docs/features/BE/feature_session_management_tech.md` `:299-304` (bảng endpoint), `:469-490`, rate limit `:607` (60/phút/tenant), `GET /guest-notes` `:570`
  - Manifest `docs/autopilot-manifests/session-read-routes-list-detail.json` **chưa tồn tại** (row backlog trỏ tới nhưng file chưa có). Nó là output của row `dd56-amendment-3-session-read-routes-authoring`, cùng lúc owner ký amendment #3
- **Output:**
  - Query module trong `packages/db/src/` (vd. `listSessions`, `getSession`) đi qua `withTenant`
  - 2 route GET dùng envelope DD-60, cursor ≤ 50, DTO least-disclosure (**không** `confirmed_count`, xem `0033:69`), 404 `SESSION_NOT_FOUND`
  - Test (RLS, cross-tenant, role)

#### A4 · `tenant_admins` bị `app` ghi full DML mà không audit
- **Backlog:** `audit-2026-09-06-d4-tenant-admins-full-dml-no-audit` · P3 · sau A1/A2.
- **Input:** `docs/sessions/2026-09-06-repo-audit.md`, `docs/features/BE/auth-security-invariant-table.md:35` (SI-7).
- **Output:** migration thu hẹp grant và thêm audit, kèm test.

#### A5 · Chuẩn hoá thứ tự khoá publish vs update
- **Backlog:** `audit-2026-09-06-d14-lock-order-publish-vs-update` · P3.
- **Output:** code trong `session-service.ts` / `authorization.ts` (khoá session trước, subscriptions sau) và một lock-order test. Nên làm cùng lane suspend-job.

---

### Track B — Job runtime, outbox, projector (mở nút "bot/web nhận được sự kiện")

#### B1 · Lối ra khỏi DLQ của projector
- **Backlog:** `db-projector-dlq-no-replay-path` · **P1 · supervised** · `idea`, chưa có manifest.
- **Cần chốt trong lane (ghi vào spec trước khi code):** replay qua hàm SECURITY DEFINER hay thao tác owner-only; có reset `attempts` không.
- **Input:** `0022` (`projector_deliveries`, dòng `:264` định nghĩa status), `0023`, `docs/features/BE/feature_sync_engine_tech.md`.
- **Output:** migration với hàm replay, test, runbook ngắn.

#### B2 · Projector thật thay `productionStubDeliver`
- **Backlog:** `projector-real-replace-stub` · P2 · `planned` · **chặn bởi B1**.
- **Input:**
  - `apps/bot/src/dispatcher.ts:77`, `worker.ts` (worker từ chối bật schedule khi deliver còn là stub), `queues.ts`
  - 8 event do `session-service.ts` phát
  - Backlog `job-consumers-per-feature`
- **Output:** consumer thật đầu tiên. Vì Zalo adapter chưa có, **đề xuất bắt đầu bằng writer notification intent** (bảng `notification_*` từ `0008`) thay vì Zalo announce. Kèm test và `merged_probe` là tên projector.
- **Xong khi:** thoả điều kiện (a) để bật `OUTBOX_DISPATCH_SCHEDULE_ENABLED`.

#### B3 · Sync-lag SLO (NFR-1c, p95 ≤ 3s)
- **Backlog:** `job-outbox-dispatch-sync-lag-slo` · P1 · `idea`.
- **Output:** `NOTIFY` từ producer và drain policy ở consumer, kèm phép đo p95. Thoả điều kiện (b) để bật schedule.

> **Bật schedule production** chỉ khi B2 + B3 đã land **và** có runbook. Người bật là **owner**.

#### B4 · Scheduler cron dùng chung
- **Backlog:** `job-scheduler-cron-registration` · P1 · `idea`.
- **Output:** đăng ký cron pg-boss trong `apps/bot` và một envelope cross-tenant có audit (`list_due_tenant_jobs`). Đây là khuôn cho mọi job định kỳ về sau.

#### B5 · Tự huỷ draft quá hạn (session-management M4)
- **Backlog:** `ap3/features/session-management/PLAN.md` M4 · P1 · supervised · sau B4.
- **Input:** `feature_session_management_tech.md` `:207`, `:221`, edge #28/#30; `feature_billing_lifecycle_tech.md` §4 làm khuôn.
- **Output:**
  - Migration `idx_sessions_draft_starts_at … WHERE status='draft'`
  - Role job cross-tenant có đặc quyền
  - Queue và cron pg-boss
  - Claim bằng `FOR UPDATE SKIP LOCKED`, tái dùng mutation `cancelSession`
  - Nếu gặp bất thường (draft có roster hoặc charge): bỏ qua và phát `session.expiry_anomaly_detected`

#### B6 · Giới hạn số lần thử của outbox
- **Backlog:** `audit-2026-09-06-d6-outbox-no-attempt-bound` · P3.
- **Chặn bởi:** owner **C6** (§6). Audit đề xuất giới hạn N lần rồi chuyển vào sink có tên.

#### B7 · Việc chạy sau B2
- `audit-2026-09-06-b2-required-projectors-drift-across-replicas` (P3)
- `web-realtime-sse` (P3, LISTEN/NOTIFY phía backend)
- `job-infra-public-projection-reconciliation` (P1)
- `session-publish-public-projector` (`blocked`, cần owner quyết occupancy authority). **Tuyệt đối không grant lại SELECT trên bảng gốc** (xem `0033`).

---

### Track C — Roster và tiền (đường tới doanh thu)

#### C1 · Writer đầu tiên cho `players`
- **Backlog:** `session-roster-first-writer` · P2 · `blocked`.
- **Chặn bởi:** owner **Tier C #1**: host-add (web) hay bot-join trước. Audit khuyến nghị **host-add**.
- **Input:** DD-113 (`decisions.md:2117-2118`), DD-114 D4 (`:2042`), BRD FR-2.2 (`docs/product/BRD.md:184`), `feature_session_management_tech.md`.
- **Output:** command mới trong `session-service.ts` (hoặc module roster riêng), route, test. Capacity guard phải tính cả guest note.
- **Mọi thứ downstream** (mark-paid, reminder, confirmed count) đứng trên task này.

#### C2 · Mark-paid thủ công (DD-40)
- **Backlog:** `session-mark-paid-manual` · P2 · `planned` · **chặn bởi C1**. Chạm tiền nên thực tế chạy **supervised** và có security round.
- **Input:** BRD FR-5.1 (`:201`), PRD FLOW 6 (`:165-166`), AC-6 (`:396`), DD-40, `feature_payment_reconcile_tech.md`.
- **Việc phải làm trước khi code:** spec tự mâu thuẫn, per-player (`:57`) vs multi-select (`:667,685,739`). Chọn một, ghi vào spec, rồi mới code.
- **Output:**
  - Writer `payment_allocations` với source `cash` / `manual` (**không** tạo bảng `payment`)
  - Route
  - **Decision table và abuse cases** (bắt buộc với feature chạm tiền)
  - Khoá mạnh (HARD RULE 4), dùng `clock_timestamp()` cho mọi predicate đánh giá sau `FOR UPDATE`

#### C3 · Ràng buộc ledger
- **Backlog:** `audit-2026-09-06-d3-ledger-free-columns-no-allocation-constraint` · P3 · sau C2.
- **Output:** constraint/trigger ràng `charges` và `bank_transactions` với `SUM(payment_allocations)` (INV-7, `core-db-architecture-principles.md:197`).

#### C4 · Caller production đầu tiên của `resolveCapability()`
- **Backlog:** chưa có row. Nguồn: `docs/autopilot-templates/completion-program-2026-09-02-RUN.md` §4 wave W1 (`capability-wiring-auto-reconcile`, DD-114 D2.3). P1.
- **Input:** `packages/db/src/capability.ts:148` (doc comment `:32-42` có ví dụ gọi), migration `0028`/`0029`, DD-29, DD-114 D2.
- **Output:** row backlog + manifest, rồi wiring gate entitlement `payment_reconcile_auto` (và nhắc tự động = `host_pro`) vào nhánh tiền đầu tiên. Đây là hard-dependency (a) của phase-1.

#### C5 · Reminder cron, `/remind` thủ công, notify confirm-paid
- **Backlog:** `reminder-cron-and-confirm-paid` · P2 · sau C1 + B2.
- **Việc trước:** sửa BRD cho khớp DD-114 D2 (auto = `host_pro`, free = `/remind` tay), vì decisions thắng BRD.
- **Output:** job trên runtime `0022`/`0023`, writer `notification_*`, test.

#### C6 · SePay webhook và ledger (epic M5, module #5)
- **Nguồn:** `docs/automation/product-backlog.md:71-83`, `docs/project/modules.json`, `feature_payment_reconcile_tech.md`, `docs/autopilot-templates/ap23-inbound-webhook-RUN.md`.
- **Chặn một phần bởi:**
  - `apipay-signed-body-reconciliation` (P0, cần evidence từ ApiPay)
  - `infra-egress-compatibility-evidence` (owner gửi email provider)
- **Hình đã chốt:** `/webhook/sepay/:token` → verify timestamp + HMAC raw-body (timing-safe, ±300s) → **lưu raw trước khi ack** → matching (pay_code → tên → `classifyAmount`) → settle FIFO → notify.
- **Output:** chưa slice. Bước đầu là chạy `/ap3-intake payment-reconcile` để ra INTAKE, rồi `/ap3-plan`.

#### C7 · Việc tiền còn treo (chỉ nhận khi điều kiện mở)
- `docs-impact-policy-contract` (`blocked`): DD-112 đã ✅ từ 27/08, cần kiểm lại xem đã mở được chưa.
- `capacity-floor-active-vs-paid-roster`: mở khi có bảng hold đầu tiên hoặc writer production đầu tiên vào charges/allocations.
- `core-matcher-ambiguous-consumer-wiring`: cần decision table trước.
- `dd104-delete-session-ratification`: owner quyết D1/D2 về FK tiền.

---

### Track D — Kênh chat và identity

#### D1 · Zalo webhook, adapter, parser, connect bot-token
- **Backlog:** `zalo-webhook-adapter-core` · P2 · `planned` · **0 dòng code**. Đây là khối 2 của launch và là khe hở BE lớn nhất.
- **Chặn bởi:**
  - owner **O4** (§6)
  - spike Zalo OA DD-14/15 (bên ngoài)
  - lane authoring phải **chốt một trong ba hình webhook mâu thuẫn**:
    - PRD `:98`: `/webhook/zalo/<token>`
    - `feature_connector_onboarding_tech.md`: header `X-Bot-Api-Secret-Token`
    - `feature_zalo_channel_tech.md:150`: chữ ký OA
- **Input:** `feature_zalo_channel_tech.md`, `feature_connector_onboarding_tech.md`, PRD FLOW 1, `ap23-inbound-webhook-RUN.md`, NFR-S4 (per-tenant, timing-safe, store-before-process).
- **Output:** route, adapter, parser, test. Đây cũng là nơi có caller đầu tiên cho `link_code` (lệnh `/link`, xem D3).

#### D2 · Mã hoá secret Zalo bot at rest
- **Backlog:** `db-zalo-bots-secret-hardening` · P1.
- **Chặn bởi:** owner **O4**: dùng chung key/instance KMS với auth pepper không, ai được giải mã, có audit mọi lần đọc không. Provider đã pin là AWS KMS.
- **Lưu ý:** row ghi `zalo_bots.secret` nhưng fixture dùng `bot_token_enc`, nên phải trace reader/writer thật trước. Theo row, evidence nằm ở branch `feat/zalo-credential-path-trace@e2897f7` (chưa kiểm branch còn trên remote).
- **Output:** migration cột `*_enc`, đường rotation, audit đọc.

#### D3 · Identity
- Caller production đầu tiên cho `issueLinkCode` / `consumeLinkCode` đi cùng D1.
- `feature-identity` là merge/claim, **P0, chỉ làm tay**, HARD RULE 4.
- `chat-identity-merge-reparent-enablement` (NOT_CODE_READY) phải ship **trong** slice merge đó; còn 4 câu hỏi mở.

#### D4 · `PATCH /api/onboarding/club`
- **Backlog:** `onboarding-club-config-route` · P2.
- **Chặn bởi:** owner **DD-114-D6** (self-serve hay provision tay; default self-serve) và một quyết định allowlist DD-56.
- **Input:** `feature_web_auth_onboarding_tech.md` §3, BRD FR-1.4 (`:180`).

#### D5 · Chờ, không mở
- Messenger (module 17, 14): chờ Meta App Review.
- `user-settings-route-and-schema`: owner Tier C #2.
- Phủ `runWithLang` DD-118 ngoài đường session-command: chưa có row.

---

### Track E — Infra, ops, security

| ID | Việc | Backlog | Risk / lane | Chặn bởi | Output |
|---|---|---|---|---|---|
| E1 | Deploy DigitalOcean App Platform + Managed PG VPC | `infra-do-app-vpc-deployment`, launcher AP-21 đang disabled | **P0, tay** | egress evidence (E6); owner | `.github/workflows/deploy.yml`, `infra/app.prod.yaml`, `infra/app.staging.yaml`, `docs/standards/environments-setup.md`. Bẫy DO (ghi trong `notes` của row): không có superuser; `GRANT USAGE … TO job_definer` âm thầm không làm gì; `LOCK pg_auth_members` fail-open. Contract: `docs/autopilot/contracts/autopilot-infra-do-app-vpc-deployment.md` |
| E2 | Backup + PITR + restore drill | `backup-pitr-drill` | P3, evidence gate | E1 | Transcript drill; RPO/RTO ghi vào `environments-setup.md` |
| E3 | Logger có level, gắn `tenant_id`, không PII; Sentry là bước 2 | `observability-sentry-loglevel-readers` | P3 | — | Module logger (vd. `createLogger`); `apps/web/lib/log.ts` đã có một phần |
| E4 | Password `app_worker` ở dev; attestation least-privilege | `dev-app-worker-password-not-restored`, `db-app-worker-least-privilege-attestation` | P2 | — | Script/test catalog |
| E5 | Xoá override `postcss` vô hiệu | `pnpm-workspace-postcss-override-inert` | P3 | — | Sửa `pnpm-workspace.yaml` |
| E6 | Evidence egress SePay/ApiPay/Zalo/Meta | `infra-egress-compatibility-evidence` | owner | owner gửi email (`docs/archive/email-hoi-provider-2026-07-23.md`) | **Đừng re-launch lane** |
| E7 | Bật CSP nonce | `web-csp-script-src-nonce` | owner | test trình duyệt thật | Bật flag `CSP_SCRIPT_NONCE_ENABLED` |

---

### Track F — Chat backend (sau A2, **không** nằm trên đường doanh thu)

- `chat-shared-message-command-core`: NOT_CODE_READY.
  - Cần A1/A2, và cần viết row cho các catalog slice **5, 6, 9** (hiện chưa có row nào).
  - Input: `docs/autopilot/contracts/autopilot-chat-shared-message-command-core.md` §7.
- `docs-chat-spec-embed-group-scope-reconcile`: owner ratify group/pin/poll/embed, hoặc bỏ chúng khỏi `feature_inapp_chat_tech.md`.
- `chat-dm-safety-audit-queryable-path`: phải đo xem DO Managed PG có `dblink` không.

### Track G — Email/password (đang khoá)

- `email-password-bundle-order-4`: owner O5 (phase-1 chỉ Google), cộng 3 phán quyết Tier C, phải re-slice.
- `email-provider-c7-evidence` (P0): chưa chọn vendor.

### Track H — Kit / tooling (chỉ làm khi A–E không có gì đang chờ)

- **`planned`:**
  - `hash-locked-registration-has-no-path-for-authorised-change` (P1)
  - `worktree-identity-symlink-defense` (P1, `scripts/ap-finish.sh`)
  - `reconcile-hand-closed-entries-never-age-out`
  - `gates-that-fire-correctly-and-cannot-say-why`
  - `breaker-counts-infra-flakes-as-fix-rounds`
  - `negative-scope-must-not-carry-decision-rules`
  - `security-review-reason-validated-but-never-transmitted`
  - `ap-finish-slug-divergence-after-worktree-move`
  - `manifest-template-omits-format-check`
  - `run-packet-l1-contradicts-dd56`
- `audit-2026-09-06-x7-*` là việc kit-sync, sửa ở repo gốc `Claude template` rồi mới backport.

---

## 6. Quyết định owner đang chặn backend

`docs/project/decisions-inbox.json` tự áp default sau **21 ngày** (tính từ `opened`, áp ở lần cập nhật tuần kế). Kiểm lại file này trước khi coi một task là còn bị chặn.

> ⚠️ **Tier C #1, Tier C #6 và Occupancy authority chưa có trong inbox**, nên sẽ không bao giờ tự áp default. Tier C #1 chặn cả đường tới doanh thu (C1 → C2): nên thêm nó vào inbox kèm default "host-add" theo khuyến nghị audit.

| Mã | Câu hỏi | Default | Mở khoá | Hạn auto-default |
|---|---|---|---|---|
| **Tier C #1** | Writer roster đầu tiên: host-add hay bot-join? | (audit khuyến nghị host-add) | C1 → C2 → C3, C5 | — |
| **DD-56-read-routes** | Cho route ĐỌC đi qua cổng tạm (amendment #4), hay chờ capability core? | chờ capability core | A3 | 27/09 |
| **O4** | KMS cho secret Zalo: chung hay riêng, ai giải mã, có audit mọi lần đọc? | cho phép trace read-only trước | D1, D2 | đã qua (23/09) |
| **Tier C #6** | Có giới hạn số lần thử outbox (N + sink có tên) không? | — | B6 | — |
| **DD-114-D6** | Launch self-serve hay provision tenant #1 bằng tay? | (a) self-serve | D4, module 10 | 27/09 |
| **DB_EXPECTED_ROLE** | Bắt buộc hay opt-in? | opt-in | `infra/entrypoint.sh` | 27/09 |
| **C4** | Bật Google OAuth production? | chưa, chờ E2E staging | module 3b go-live | đã qua |
| **O2** | Uỷ quyền thường trực `autonomous_to_ready` cho lane P1/P2? | uỷ quyền | giảm 3–5 lần owner phải can thiệp mỗi lane | đã qua |
| **DD-120** | Ratify làn ap3 cho `code-quality-p2` | đang chạy de facto | tính hợp lệ của làn ap3 | 30/09 |
| **ap3-routines** | Mở class ap3 cho các row audit | — | nạp queue ap3 | — |
| Occupancy authority | Nguồn sự thật cho occupancy / `confirmed_count` | — | B7 public projector | — |
| Tier C #2 | Ngôn ngữ per-user | — → ⚠️ 12/10: DD-122 D3 áp **per-club** qua `tenants.locale` (không locale cấp member trong MVP) | user settings | — |
| Bên ngoài | ApiPay signed body · egress DD-04 · vendor email C7 · Meta App Review · spike Zalo OA DD-14/15 · luật sư A3 | — | C6, E1, G, D5, D1, go-live | — |

**Đề xuất cho senior dev:** tuần đầu gom 5 dòng in đậm thành một lượt hỏi owner. Mỗi câu một dòng, kèm khuyến nghị (theo khuôn `docs/project/decisions-inbox.json`).

---

## 7. Quy trình để agent tự làm

### 7.1 Chọn làn theo risk

| Risk | Ví dụ | Làn | Ai merge |
|---|---|---|---|
| **P0** | deploy production, merge identity, vendor email | **Chỉ tay** (prepare-only) | owner |
| **P1** | migration/schema, auth, quyền, tiền, choke-point chung (A1, A2, B1, B3–B5, C2, C4, D2) | **Level 3 supervised** | owner |
| **P2 thuộc class ap3 đã bật** | refactor/code-quality trong `allowed_scope` | **ap3** (dispatcher tự chạy) | owner, sau khi CI xanh |
| P2/P3 còn lại | E3, A4, A5, C3 | Level 3 supervised | owner |

Class ap3 đang bật (`ap3/routines.json`):

- **`code-quality-p2`**, scope:
  - `packages/core/src/**`, `packages/db/src/**`
  - `apps/web/lib/**`, `apps/web/app/api/auth/google/**`
  - test và test-db của bot
- **`feature-session-p2`**, scope:
  - `apps/web/app/api/sessions/**`, `apps/web/lib/session-*`
  - `packages/db/src/session-service*`, `packages/db/src/public-session-fence*`
  - `packages/core/src/api-contract*`, `packages/db/src/index.ts`
  - `clean_runs 0`, security round luôn bật

Schema/migration, auth, tiền và i18n **không bao giờ** đi làn ap3.

### 7.2 Level 3 supervised

Nguồn: `docs/autopilot-templates/level3-workflow.md` · `docs/autopilot-ONBOARDING.md` §3 · `CLAUDE.md`.

```bash
# 1. Worktree pin base
BASE_SHA=$(git rev-parse origin/main)
git worktree add .autopilot/worktrees/<slug> -b <branch> "$BASE_SHA"

# 2. Runtime manifest viết tay từ template (KHÔNG truyền manifest authored)
#    docs/autopilot-manifests/_TEMPLATE.json -> .autopilot/state/<slug>/manifest.json
#    (mang manifest_schema_version: level3-operational-v2)
scripts/autopilot-scope-gate register --manifest .autopilot/state/<slug>/manifest.json
test -f .autopilot/state/<slug>/registered-manifest.sha256   # bắt buộc kiểm, đừng tin chữ "registered"

# 3. Code test-first, rồi gate thật của repo
NODE_ENV=test DATABASE_URL_TEST=... pnpm -w test
pnpm typecheck && pnpm lint && pnpm format:check && pnpm review:check:changed
pnpm --filter @plexco/web build

# 4. Review độc lập (2 vòng code sạch cho P1; thêm 1 vòng security nếu chạm auth/tiền/secret/input ngoài/deploy)
scripts/autopilot-scope-gate ready     # gọi scripts/codex-review-pin.sh

# 5. Owner merge, rồi dọn
scripts/ap-finish.sh <slug> --squash-verified <sha>
#    lifecycle pin base cũ không re-base được: --authorized-close --reason "..." rồi register lại
```

- **Trạng thái dừng:**
  - **READY**: diff đúng scope, gate xanh, review sạch.
  - **AWAIT**: thiếu đúng một quyết định, kèm một đề xuất và điều kiện resume nhị phân.
  - **HALT**: breaker cứng. `MAX_ROUNDS` là quá 5 vòng; `REGION_THRASH` là cùng vùng 3 vòng liên tiếp.
- **Launcher mẫu:** `.claude/commands/ap-55-tenant-capability-schema-migration.md` (M1 của A1). Viết `ap-56-*` cho A1 theo cùng khuôn: danh sách "đọc trước khi viết", phần bổ sung contract, trỏ tới manifest authored.

### 7.3 Làn ap3 (tự động hoàn toàn cho class hẹp)

- **Luồng feature:**
  - `/ap3-intake <slug>` (skill `ap3-intake`) → `INTAKE.md`, chấm điểm readiness và liệt kê gap owner phải trả lời.
  - `/ap3-plan <slug>` → `PLAN.md` và các file `ap3/queue/*.md` (slice supervised bị bỏ qua).
  - Merge PR plan thì task vào queue.
- **Task viết tay:**
  1. Chép `ap3/queue/EXAMPLE.md`. Frontmatter gồm `slug`, `class`, `risk`, `scope`, `verify`, `budget_usd`, `max_review_rounds`; thân gồm Problem / Acceptance / Context.
  2. Chạy `bash ap3/lint-task.sh <file>` tới khi in `OK`.
  3. Mở PR vào `main` (ruleset `main-ci-gate` đòi check `verify`), rồi sau khi merge chạy lại `bash ap3/lint-task.sh --at origin/main <file>`. Dispatcher chỉ đọc `origin/main`.
- **Dispatcher** (`ap3/dispatch.sh`, launchd 15 phút một lần, trên máy owner):
  1. Writer chạy sandbox, chỉ code, dừng ở `.ap3-run/READY-FOR-REVIEW`.
  2. Dispatcher chạy `scope-check.sh` rồi `review.sh` (Codex code + security).
  3. **Chỉ khi CLEAN** mới push và mở PR.
- **Kill switch:** `touch ap3/PAUSED`. Class bị `paused` sau mỗi HALT hoặc PR bị đóng; bật lại bằng `ap3/unpause.sh <class>`.
- **Vận hành:** `ap3/README-W2.md`. **Không merge PR ap3 khi CI chưa xanh.**

### 7.4 Codex reviewer

- Wrapper là `scripts/codex-review-pin.sh` (ap3 dùng `ap3/codex-review-pin.sh`). Mặc định chạy binary `$HOME/.npm-global/bin/codex`; override qua `AUTOPILOT_CODEX_REAL_BIN` và `AUTOPILOT_CODEX_REVIEW_*`.
- Xác thực bằng `codex login` trên máy chạy gate (API key đưa qua stdin, hoặc tài khoản ChatGPT).
- Phiên Claude Code trên cloud **không** chạy được gate cho tới khi môi trường có credential OpenAI. Hiện gate chạy trên máy Mac của owner.
- Reviewer không gọi được ⇒ `HALT TOOL_UNAVAILABLE`. **Cấm tự hạ gate.**

### 7.5 CI và commit

- **`ci.yml`:** typecheck → format → `review:check` → lint → build → `db:bootstrap` → `pnpm -w test` (Postgres 16).
- **`security.yml`:** Semgrep và OSV.
- **Commit ở root working copy phải qua root lock.** Trình tự ở DEV-ONBOARDING §7: `scripts/autopilot-root-lock acquire`, rồi `PLEXCO_COMMIT_OWNER`, rồi `git commit -m … -- <path>`.
- Convention: `type(scope): mô tả`, body bắt buộc với `feat`/`fix`, kèm `Tracking: NO-LINEAR`.
- **GitNexus:** chạy `gitnexus_impact` trước khi sửa symbol và `gitnexus_detect_changes()` trước khi commit (xem `CLAUDE.md`).

### 7.6 Prompt mẫu để giao một task Level 3 cho Claude Code

Thay `<…>` rồi paste nguyên khối (payload viết tiếng Anh theo luật ngôn ngữ của repo):

```text
You are the primary agent for ONE Level 3 supervised task in maingocanh1702/plexco-app.

TASK: <handoff id, e.g. A1> / backlog slug <slug> (docs/autopilot-backlog.md:<line>)
GOAL: <one sentence outcome from the handoff doc>
BASE: origin/main at start; record the SHA in the task contract.

Read before writing anything:
- CLAUDE.md, docs/00-start-here/DEV-ONBOARDING.md, docs/autopilot-templates/level3-workflow.md
- the backlog row above and every INPUT file listed for this task in BACKEND-HANDOFF-2026-09-26.md
- packages/db/schema.ts and packages/db/migrations/*.sql (authoritative over any prose)

Rules:
- Resolve the task contract (level3-workflow.md section 3) first: scope, negative scope, risk, verification, review.
- One slice = one branch + one worktree + one writer. Register with a RUNTIME manifest and confirm registered-manifest.sha256 exists.
- Test-first. Show the new test failing before the fix and passing after.
- New migration: next free number, SET search_path = pg_catalog, public, pg_temp on every function, bump MIGRATION_COUNT and every tail assert.
- Run the real gates: pnpm -w test (NODE_ENV=test, DATABASE_URL_TEST), typecheck, lint, format:check, review:check:changed, web build.
- Independent review via scripts/codex-review-pin.sh: 2 clean code rounds, plus 1 security round if the diff touches auth, secrets, permissions, money, external input or deployment. Reviewer unavailable means HALT TOOL_UNAVAILABLE.
- If a product decision is missing, stop at AWAIT with exactly one question, one recommendation and a binary resume condition. Do not guess product behavior.

Deliverable: stop at READY (PR open, CI green, review clean) | AWAIT | HALT. Never merge. AUTO_MERGE: off.
After READY: flip the backlog row via the reconcile flow and report what changed with file:line evidence.
```

---

## 8. Thứ tự đề xuất cho 4 tuần đầu

| Tuần | Việc chính | Chạy song song |
|---|---|---|
| 1 | Việc 0 (dọn sổ) · dựng máy và Codex · gửi owner 5 câu ở §6 · **A1** | Theo dõi run ap3 `db-test-lock-barrier-helpers-duplicated` (đã nạp ở #39) và merge PR của nó khi CI xanh |
| 2 | **A2** · **B1** · **C1** (nếu owner đã chọn) | E3 logger |
| 3 | **B2** (notification intent writer) · **A3** (sau khi quyết read routes) · **C2** | B4 scheduler |
| 4 | **D1** (nếu đã chốt O4 và hình webhook) · **B3** · chuẩn bị **E1** cùng owner | C4 capability wiring |

**Tín hiệu đi đúng hướng:** cuối tuần 4, một host tạo kèo, thêm người, gạch nợ tay qua route thật, và một event đi hết producer → projector thật mà không vào DLQ.

---

## 9. Bẫy mới, sau DEV-ONBOARDING 15/09

- **Hàm SECURITY DEFINER và trigger:** luôn `SET search_path = pg_catalog, public, pg_temp` **và** qualify `public.<bảng>`. Nếu `pg_temp` không có trong danh sách, Postgres tìm temp schema **trước**, nên một temp table trùng tên có thể vượt guard. Lỗi thật ở `0047`, vá bằng `0048` (PR #37).
- **Thêm migration là phải sửa nhiều chỗ:** `MIGRATION_COUNT` trong `migrate.test.ts` và mọi tail assert, kể cả assert `toBe(` nhiều dòng trong `rls-invariants.test.ts`. Grep tên migration cuối trước khi push.
- **Node `execFile` có `timeout`:** nếu child exit 0 khi nhận SIGTERM thì promise **resolve** chứ không reject. Phải kiểm `child.killed` (PR #36). Output in ra sau khi bị kill không bắt được vì pipe đã đóng.
- **Sổ sách mục nhanh hơn code:** ROADMAP pin `12f5191`, verdicts dừng ở V31, 35 row backlog lệch. Trước khi claim trạng thái, chạy `pnpm progress` và grep code.
- **Cluster test sót DB `plexco_*`:** dọn cả **trước và sau** khi đo (DEV-ONBOARDING §6, bẫy 2).

---

## 10. Lệnh tái kiểm các số trong file này

```bash
git rev-parse --short HEAD                                   # 7f6d00e lúc viết, re-pin dd5375f
ls packages/db/migrations/*.sql | wc -l                      # 49
find apps/web/app/api -name route.ts | sort                  # 15 route, 0 GET session
grep -n "productionStubDeliver" apps/bot/src/dispatcher.ts   # stub còn đó
grep -rn "resolveCapability(" packages apps --include=*.ts | grep -v '\.test\.ts'   # chỉ định nghĩa + doc comment
grep -n "ALLOWED_ROLES" apps/web/lib/session-command-route.ts
grep -c "^status: in-flight" docs/autopilot-backlog.md       # 0 sau PR #38 (35 trước đó)
ls ap3/queue                                                 # task nào còn dispatchable
pnpm progress                                                # thanh tiến độ + pin có mục không
```

_Viết 26/09/2026 tại `main@7f6d00e`, re-pin `dd5375f` cùng ngày (§3, A3, §6, §7.3, §8, §10 cập nhật; bỏ số dòng backlog), từ phép đo trực tiếp trên repo cộng ba lượt quét backlog, spec và decisions. Chưa chạy lại toàn bộ `pnpm -w test` ở HEAD này; lần chạy gần nhất là bộ `@plexco/db` 880/880 trong PR #37._
