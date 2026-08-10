<!-- review-readiness: enforce -->
# Plexco — Project Progress Review & Next Step

> **Ngày review:** 2026-07-25  
> **Repo:** `/Users/maingocanh/Projects/Plexco app`  
> **Review baseline:** `main@2937ed9a0732bea27db75403682befcb348e315b` — snapshot mà §2/§3/§4 mô tả.  
> **Published at:** `main@948636f4bd3c1bc0feaaf8b91b3ad2730b097e72` — verdict §7 pin SHA này.  
> **Status boundary:** tài liệu/decision/spec không phải runtime; merged không đồng nghĩa enabled; `.pen` không phải FE.

> **Publication record.** Toàn bộ WIP mô tả ở §2.1 đã publish thành hai commit như §5.2 quy định:
> **A = `42a1fb0`** (docs current-state reconcile, 12 file) → **B = `948636f`** (authority packet, đúng 11
> `TARGET_FILES`). §2.1–§4.2 giữ nguyên là **snapshot tại `2937ed9`** — chúng mô tả tình trạng đã dẫn tới
> hai commit đó, không phải trạng thái hiện tại. Mọi câu "chưa commit / còn WIP" trong các mục đó đọc theo
> baseline review, không đọc như live truth. §5.2 trở đi, §6 và §7 đã cập nhật theo `948636f`.
>
> **Current supersession (2026-07-28):** live authority hiện là `main@784bc8d`, migration tail `0024`.
> Canonical suite hiện PASS 537 workspace tests + 13 readiness-validator tests (32 files; 528 static
> declarations + 9 generated cases). Safari macOS/iOS completion-hop measurement đã PASS nhưng Google
> login chưa được chứng minh enabled. Job lease/ack, fail-closed preflight, dispatcher và flagged
> scheduler đã merge; schedule mặc định OFF, delivery còn placeholder và chưa có producer, real
> projector, replay hay sub-minute drain. Exact Chat authority pack đã land tại `90d292d`; primary plan
> v1.8 đạt `PLAN_READY`, nhưng per-slice `CODE_READY` và runtime vẫn chưa có. Tài liệu này là progress
> report có niên đại; live status/next
> order thuộc `HANDOFF.md`, `BUILD-STATUS.md` và `ROADMAP.md`.

## 1. Kết luận ngắn

Plexco hiện ở trạng thái:

```text
FOUNDATION_IMPLEMENTED
AUTH_CORE_MERGED_BUT_NOT_ENABLED
BUSINESS_FEATURE_RUNTIME_NOT_STARTED
PRODUCT_E2E_NOT_AVAILABLE
```

- **Nền tảng kỹ thuật đã mạnh:** monorepo, core logic, PostgreSQL/Drizzle, RLS fail-closed, schema đa tenant,
  auth/session core, migration và invariant tests đã có thật.
- **Auth Google đã merge nhưng chưa được chứng minh đã bật/go-live:** completion-hop M3 trên Safari macOS
  và iOS đã đo **PASS 26/07**, nên measurement blocker đã đóng. Credentials vẫn rỗng trong template;
  owner go-live và các gate độc lập A3 legal/PII/config còn áp dụng. Email/password order-4, provider send,
  route/UI và bước gỡ Telegram-era vẫn chưa hoàn tất.
- **Tầng sản phẩm nghiệp vụ chưa thành runtime:** không có route nghiệp vụ session/payment/sync/marketplace,
  không có bot handler nghiệp vụ, không có projector đang chạy, không có màn FE nối API.
- **Docs đi trước code rất xa:** 24 Product/System spec + 23 BE spec, nhưng coverage không phải implementation.
- Roadmap tự ước lượng khoảng **33% theo số slice kỹ thuật đã merge**. Con số này không đại diện cho mức
  sản phẩm dùng được; hiện chưa có một host flow end-to-end để dogfood.

**Next enablement step:** owner review các gate A3 legal/PII/config và quyết định Google credentials/go-live;
không lặp lại phép đo Safari trừ khi browser/auth mechanism thay đổi.
**Next coding initiative:** job lease/ack + dispatcher/preflight + gated scheduler đã merge; author/review
vertical Session BE đầu tiên theo dependency hiện hành. Giữ schedule OFF tới khi có real producer/projector,
replay/recovery và sub-minute drain. FE đang **HOLD**; chỉ map screen/component/token sau khi canonical
`design.pen` được persist/track + owner nghiệm thu làm authority.

---

## 2. Snapshot và bằng chứng live

### 2.1 Git / authority

| Hạng mục | Live truth |
|---|---|
| Branch | `main` |
| HEAD | `2937ed9a0732bea27db75403682befcb348e315b` |
| So với `origin/main` | `0 ahead / 0 behind` tại thời điểm review |
| Tracked WIP | 18 file modified |
| Untracked | 7 artifact, gồm packet job-infra, report này, notification proposal, email evidence và `design.pen` |
| Worktree khác | 4 feature worktree còn tồn tại; không dùng trạng thái của chúng làm `main` truth |

Baseline đã merge là SHA ở trên. DD-89/DD-90, packet `db-job-claim-lease-core` và các mirror cập nhật ngày
25/07 hiện nằm trong working tree, nên **chưa phải authority bất biến**.

### 2.2 Inventory runtime hiện hành

| Trục | Live evidence | Đọc đúng trạng thái |
|---|---:|---|
| Migration | 22 file, `0000`–`0021` | Implemented; `0019`–`0021` là integrity expand-only, không mở feature |
| Drizzle tables | 61 khai báo `pgTable` trong `packages/db/schema.ts` | Data model rộng, không chứng minh service/UI |
| API nghiệp vụ | **0** | Session/payment/sync/marketplace chưa có route |
| API hiện có | 10 | 8 auth + 2 onboarding |
| FE page | 1 | `/` chỉ render chữ `Plexco`; chưa có màn nối API |
| Bot queue | 0 queue đăng ký | Worker/provision shell có, dispatcher/consumer chưa có |
| Product/System specs | 24 | Coverage cao |
| BE specs | 23 | 23 cặp + 1 product-only Draft |
| Test files | 29 | 9 core + 4 DB + 15 web + 1 bot |
| Workspace tests | **460 PASS** | core 132 + DB 179 + web 146 + bot 3 |
| Readiness-validator tests | **13 PASS** | chạy trước workspace suite |
| Typecheck | PASS | toàn bộ 4 workspace |
| Production build | PASS | Next build tạo 15 route/page artifacts |

Canonical runner hiện đã đóng gap của ROADMAP:

```text
core 132 + db 179 + web 146 + bot 3 = 460 workspace tests PASS
```

Số `419` trong các entry v3.4a/v3.4d là snapshot lịch sử tại `f93873b`; current ROADMAP v3.4e đã pin lại
460. Static declaration count hiện là 451; cộng 9 test sinh từ table-driven loop = 460, khớp runner.

### 2.3 Quality gates

| Check | Kết quả | Ghi chú |
|---|---|---|
| Canonical PostgreSQL suite | PASS | 460 workspace tests + 13 validator tests |
| `pnpm typecheck` | PASS | Core, DB, web, bot |
| `pnpm build` | PASS | Next production build thành công |
| Tracked-source lint | PASS | `packages`, `apps`, `scripts` |
| Root `pnpm lint` | FAIL | Chỉ do ignored local `.probe/run.mjs` và `.probe/server.mjs` vẫn bị ESLint quét, thiếu JS globals; không phải lỗi source đã track |

Root lint đang đỏ trong **checkout hiện tại** và nên được đóng bằng một tooling cleanup nhỏ (`.probe/**`
ignore hoặc đặt probe ngoài repo). Không nên trộn việc này vào job-infra/business slice.

---

## 3. Progress theo delivery layer

| Layer | Decision/spec | Runtime | Enablement | Kết luận |
|---|---|---|---|---|
| Foundation P0–P1 | Cao | Core + DB/RLS + migrations đã có | N/A | **IMPLEMENTED** ở tầng nền |
| Auth core | Reviewed/ratified | Google lane + session security đã merge | Historical snapshot: Safari M3 chưa đo; đã PASS 26/07. Email bundle vẫn chưa có | **MERGED, NOT_ENABLE_READY** |
| Tenant Engine P2–P3 | Spec cao | Không route/service/handler | Chưa dogfood | **NOT_STARTED** |
| Payment reconcile | Spec Reviewed | Matching/payment logic thuần có; không webhook→settle→notify | Provider evidence còn gate | **PARTIAL_CORE_ONLY** |
| Messenger/Zalo runtime | Contract có | Chưa adapter/handler/projector | App Review/Zalo evidence | **NOT_STARTED** |
| Session | Product + BE Reviewed; publish/draft lifecycle đã đóng contract | `tenantRepo.sessions` mới có list/get/create thấp tầng; chưa SessionService/API/projector/UI | Chưa | **NOT_STARTED_AS_PRODUCT** |
| Sync/Marketplace | Reviewed contract | Có table/outbox skeleton; chưa dispatcher/projector/API | Chưa | **NOT_STARTED** |
| Web/PWA | Home contract + design direction có | Landing placeholder; không manifest/SW/product screen | Chưa | **NOT_STARTED** |
| Billing | Reviewed contract + schema | Chưa lifecycle service/job/UI | Chưa | **NOT_STARTED** |
| Notifications | DD-70/71/72 owner-final; Product/BE/index/status đã reconcile trong WIP | Chưa target migration/service/inbox/push | Chưa | **REVIEWED_CONTRACT_WIP, NOT_IMPLEMENTED** |
| Tournament/Assistant/Native | Direction/proposal | Không runtime | Nhiều later-phase gate | **DEFER** |

### 3.1 Foundation đã thực sự có gì

- `packages/core`: matching, payment classification/FIFO planning, date/time, i18n, sports, VietQR và
  fail-closed `splitNameAmount`.
- `packages/db`: schema, migration runner, role/RLS/grants, auth/session functions, tenant choke-point,
  waitlist schema, public read-model skeleton và tenant-integrity composite FKs.
- Auth: Google state/callback/complete, logout/logout-all/session, Telegram-era compatibility,
  onboarding start/readiness.
- Invariant test: RLS/tenant isolation, public whitelist, waitlist ordering, migration race/immutability,
  auth concurrency và session-epoch fencing.

### 3.2 Chưa có gì ở product layer

- Không SessionService hoặc command layer đầy đủ.
- Không route create/publish/join/cancel session.
- Không SePay/ApiPay runtime webhook → allocation → notification.
- Không outbox dispatcher/projector consumer đang chạy.
- `apps/bot/src/queues.ts` vẫn là `[]`.
- Không Messenger/Zalo handler.
- Không dashboard, Home, session list/detail/create form hoặc marketplace screen.
- Không product E2E từ login → thao tác nghiệp vụ → projection/UI.

Đây là lý do không nên đọc “61 table”, “24/23 spec” hay “460 test” thành “MVP gần xong”.

---

## 4. Audit docs: điểm đúng và điểm drift

### 4.1 Những phần đáng tin

- Authority split rõ: BRD = scope, PRD = behavior, TDD = implementation contract, decisions = owner
  authority, ROADMAP/BUILD-STATUS = delivery/progress.
- ROADMAP WIP v3.4e đã pin đúng `main@2937ed9`, tách spec/runtime, merged/enabled, static/runner.
- BUILD-STATUS WIP đã nhận diện đúng: foundation/auth có code; business feature layer chưa build.
- Session Product + BE specs đã đóng các contract quan trọng: create=draft, explicit `PublishSession`,
  billing suspend locking read, public projection timing, draft discard/auto-expiry.

### 4.2 Drift cần sửa

#### P1 — Notification authority không đồng bộ — resolved trong working tree

`decisions.md` đã chốt:

- DD-70: inbox hợp nhất hai plane + `notification_preferences`;
- DD-71: announcement basic free + proof-bound confirm;
- DD-72: Web Push/VAPID phase-1.

Snapshot đầu lượt review cho thấy feature index, Product/BE notification docs, HANDOFF và BUILD-STATUS vẫn nói
DD-70/71/72 “đang chờ/chưa chốt”. Working tree hiện đã reconcile: cặp v3.5/v3.5 trở lại
`Reviewed contract`, index/status mirrors ghi 16 Reviewed contracts, còn runtime/migration/service/UI vẫn
`Not started`. DD-88 giữ proposal riêng; NTF-OQ retention/evidence và global security-attempt owner không bị
đóng suy diễn.

#### P1 — DD-81 path drift đã sửa trong WIP; design authority vẫn chưa được publish

Owner đã amend canonical path thành root `design.pen`; decisions + current design mirrors đã được reconcile
trong working tree. Live repo:

- không có file tracked `*.pen`;
- chỉ có untracked `design.pen`;
- file chưa được persist/track hoặc owner nghiệm thu nội dung.

**Resolution còn lại:** persist/track `design.pen`, owner nghiệm thu và chỉ sau đó coi file là design
authority. Cho tới gate này không được tính `.pen` là FE hoặc mở mapping.

#### P1 — Status docs committed đã stale; WIP body đã reconcile nhưng chưa phải authority

Committed HANDOFF vẫn pin `main@172dfff` và D0a in-flight; committed BUILD-STATUS pin `1e503d1`/tail `0020`.
Working tree hiện đã cập nhật đồng nhất về `2937ed9`/`0021`, ROADMAP v3.4e, 24/23 specs, canonical suite
460 và next path BE-only. Các đoạn D0a→D1 cũ đã bị thay; FE được pin HOLD chờ `design.pen` authority.
Blocker còn lại chỉ là publication: các sửa này chưa commit/push nên chưa thành immutable authority.

#### P2 — Core-doc version pointers đã reconcile trong WIP

BRD v3.9i, PRD v2.8h và TDD v3.1c hiện cùng trỏ current decision log v2.04 WIP, đồng thời pin ranh giới
“status đọc theo từng DD; `DECISION_FINAL` không phải runtime/readiness”. Đây là pointer-only reconcile;
publication vẫn chờ commit A.

#### P2 — Canonical lint command bị local artifact làm đỏ

Source đã track lint xanh; root command đỏ vì `.probe` ignored nhưng chưa nằm trong ESLint ignore. Đây là
checkout/tooling hygiene, không phải product regression, nhưng nếu bỏ qua sẽ làm gate khó đọc.

---

## 5. Next step — historical selection và current supersession

### 5.1 Enablement follow-up hiện tại

**Safari macOS + iOS completion-hop M3 đã đo PASS 26/07; không còn measurement obligation.**

Việc còn lại là owner review các gate độc lập A3 legal/PII/config rồi quyết định Google credentials/go-live.
Repo hiện vẫn để `GOOGLE_OAUTH_*` rỗng; measurement PASS không tự bật provider và không phải production E2E.

Song song, thu email-provider C7 evidence để chuẩn bị order-4 email/password bundle. Đây là lane riêng,
không phải điều kiện để công nhận measurement Safari đã đóng.

### 5.2 Historical initiative 25/07 — `db-job-claim-lease-core` (nay đã implemented)

Đây là lựa chọn có leverage cao nhất tại snapshot 25/07 vì:

1. `claim_outbox_batch` đã tồn tại nhưng worker cross-tenant chạy dưới FORCE RLS cần privilege boundary đúng.
2. Session publish/auto-expiry, sync, join retry, notifications và billing jobs đều đang defer cùng một lớp
   lease/audit/definer/queue infrastructure.
3. Làm một root slice chung tránh mỗi feature tự tạo grant/job semantics riêng và drift.
4. Session contract đã đủ dày; blocker thấp nhất không còn là product wording mà là shared job foundation.

**Packet hiện `CODE_READY`** tại `main@948636f` — closure 12/12, không còn blocker. Hai commit publication
dưới đây **đã thực hiện xong**; giữ lại làm bản ghi thứ tự đã dùng và làm khuôn cho các packet sau.

> **Supersession 27/07:** chuỗi job core → ack → dispatcher/preflight → exact-string scheduler đã merge.
> Không chạy lại runbook dưới đây. Scheduler vẫn mặc định OFF và delivery là placeholder fail-closed; current
> path là author/review vertical Session BE đầu tiên, đồng thời giữ enablement blocked tới khi có producer,
> real projector, replay/recovery và sub-minute drain.

#### Hai commit riêng biệt — bắt buộc serialize A → B

Working tree hiện chứa **hai** nhóm thay đổi khác blast radius. `TARGET_FILES` của verdict §7 chỉ phủ nhóm B,
nên câu "commit đúng toàn packet" **không** bao gồm nhóm A. Ghi rõ để người thi hành không bỏ sót:

| Commit | Nội dung | Quan hệ với verdict §7 |
|---|---|---|
| **A — docs current-state reconcile** | `docs/00-start-here/HANDOFF.md` · `docs/product/ROADMAP.md` · `docs/product/BRD.md` · `docs/product/PRD.md` · `docs/product/TDD.md` · `docs/features/README.md` · `docs/features/FE/feature_notifications_reminders.md` · `docs/features/BE/feature_notifications_reminders_tech.md` · `docs/channels/web/design-brief.md` · `docs/channels/web/designer-kickoff.md` · `docs/channels/web/theme-direction-2026-07.md` | **Ngoài** `TARGET_FILES`. Đóng source/index/HANDOFF/ROADMAP/core-pointer/DD-81 mirror drift; không đóng verdict |
| **B — authority packet** | Đúng 11 file trong `TARGET_FILES`, gồm BUILD-STATUS và report này | **Là** commit mà `NEXT_REVIEW_TRIGGER` chờ; hoàn tất status mirror và cho phép re-pin verdict |

A và B phải **serialize A → B** vì BUILD-STATUS/report trong B mirror trạng thái được A chốt. Giữ hai commit
riêng để packet B có đúng target authority; không đưa 11 file A vào B và không publish B trước A.

Thứ tự thi hành nhóm B:

1. Commit/push nhóm A trên `main`.
2. Commit/push **đúng 11 `TARGET_FILES`** của packet `db-job-claim-lease-core` trên `main`.
3. Trên `main` đã sync, **re-verify migration tail** trước khi register scope gate. Nếu tail ≠ `0021`, rename
   migration path và cập nhật manifest + backlog + cả ba verdict mirror, rồi **commit/push correction và
   re-pin** trước `scope-gate register`. G5 hiện PASS ở authoring baseline; preflight này chống drift sau publication.
4. Re-pin verdict trên SHA mới; chạy `pnpm review:check:changed`; chỉ promote khi strict `CODE_READY` 12/12.
5. Tạo worktree riêng từ exact `main` SHA; register scope gate.
6. Implement root slice P1 manual-only:
   - reclaimable outbox claim lease;
   - per-event `job_audit_events`;
   - lane-specific `job_definer` + exact grants/ownership;
   - bootstrap/real-role tests;
   - **không** queue/cron/handler/projector/feature consumer.
7. Slice 2: `job-runtime-dispatcher` với preflight fail-closed trước `boss.start()`.
8. Slice 3: scheduler/cron registration.
9. Slice 4: feature consumers.

**Hard boundary:** toàn bộ root slice, dispatcher, scheduler và feature consumer ở chuỗi trên là
**BE-only**. Không mở `apps/web` page/component, không dựng UI tạm và không map design token trong các
slice này.

### 5.3 Vertical BE slice ngay sau job foundation

Sau job core + dispatcher, ưu tiên một đường BE mỏng nhưng hoàn chỉnh:

```text
SessionService / CreateDraft
  → PublishSession
  → processed_commands / idempotency
  → outbox
  → dispatcher/projector
  → public_sessions
  → marketplace read API
```

Slice này phải đóng bằng integration/API contract tests, gồm success, fail-closed, idempotency và
projection-read cases; **không có FE trong scope**. BE cần xuất contract ổn định cho DTO, error code,
idempotency key và read-model để FE có thể map sau mà không buộc BE đổi theo từng screen.

#### FE hold / design gate

FE chỉ bắt đầu khi:

1. canonical path giữ đúng root `design.pen`;
2. file được persist/track và owner nghiệm thu làm design authority;
3. screen, component, token và state được map từ design authority sang BE contract đã ổn định.

Filename conflict đã được reconcile trong WIP, nhưng live tree vẫn chỉ có untracked `design.pen`. Cho tới
khi file được persist/track + owner nghiệm thu, FE giữ **HOLD**; không được dùng FE để block, mở rộng hoặc
kéo scope của các BE slice phía trên.

### 5.4 Không nên làm tiếp theo

- Không bắt đầu DD-88 notification grouping.
- Không bắt đầu Tournament, Club Assistant, Feed/Kudos hoặc native app.
- Không mở rộng job root slice sang worker/cron/consumer.
- Không bắt đầu Home/session UI, PWA product screen hoặc FE integration trước design gate.
- Không tính migration integrity hoặc docs merge là feature progress.
- Không tạo thêm schema/business table ngoài contract cần thiết cho vertical BE runtime owner.

---

## 6. Historical closure matrix cho job-core packet

| # | Gate | Kết quả | Evidence |
|---:|---|---|---|
| 1 | Authority snapshot pin theo SHA | **PASS** | Cả 11 `TARGET_FILES` tồn tại trong tree `948636f` |
| 2 | Decision trong scope đã chốt | PASS | DD-89/DD-90 owner-final, đã publish tại `948636f` |
| 3 | Scope IN/OUT và owner rõ | PASS | Manifest + negative scope đã có |
| 4 | Dependency phân loại đủ | PASS | Root slice; `0000`, `0005`, `0010` đã merge |
| 5 | Live schema/code khớp doc | PASS | `outbox_events`, `projector_deliveries`, worker shell đã verify |
| 6 | Data/API/state/auth contract đủ | PASS | Lease/audit/definer/bootstrap contract đã pin |
| 7 | Fail-closed/idempotency/order đủ | PASS | Decision/acceptance tables trong task contract |
| 8 | Open question trong scope = 0 | PASS | DD-89/DD-90 đóng Q1–Q6 đúng owner |
| 9 | Acceptance matrix có expected result | PASS | Real-role/privilege/concurrency/rollback cases đã pin |
| 10 | Migration/security/rollback pin | PASS | Một monotonic migration + bootstrap contract |
| 11 | First slice có hard dependency merged | PASS | Root dependency |
| 12 | Implementation handoff sẵn sàng | **PASS** | Manifest/task/launcher/backlog/mirrors đã push tại `948636f` |

**CLOSURE_MATRIX: PASS (12/12).**

`G5_SCOPE` PASS: scope exception có lý do đo được, và tại `948636f` migration tail vẫn là `0021` nên
`0022_job_claim_lease_core.sql` là next monotonic path **đã verify**, không còn là dự đoán; `package.json`
bị giới hạn đúng một script `db:bootstrap`. Closure #1/#12 đóng bằng commit A `42a1fb0` → B `948636f`.
Tail recheck trước `scope-gate register` vẫn bắt buộc — nó chống drift *sau* thời điểm pin này.

---

## 7. Canonical readiness verdict

Verdict này ghi lại **job-core slice đã được review rồi implement**, không phải authorization cho current next
slice và không gộp toàn project thành một mega-slice.

> **Tracker of record:** `docs/slice-readiness-verdicts.md` → **Verdict 19**. Block dưới đây là **mirror phải
> giữ đồng nhất từng field** với Verdict 19 và với verdict trong `docs/autopilot/contracts/autopilot-db-job-claim-lease-core.md`.
> Ba block cùng một slice tại cùng một SHA; nếu lệch, Verdict 19 thắng và hai block kia phải sync lại.
>
> **`AUTHORITY_SHA` đã re-pin sang `948636f`** — commit mang trọn packet. Block này được author tại `2937ed9`
> với verdict `NOT_CODE_READY`; blocker duy nhất là "chưa có immutable SHA chứa toàn packet", và commit A
> `42a1fb0` → B `948636f` đã đóng nó. **Contract không đổi một dòng** giữa hai lần pin: chỉ `AUTHORITY_SHA`,
> closure #1/#12, `IMPLEMENTATION_ARTIFACTS` và `FIRST_IMPLEMENTATION_STEP` thay đổi. Commit re-pin là
> pin-only — nội dung đã review nằm bất biến tại `948636f`.

```text
REVIEW_POLICY_VERSION: 1.3
REVIEW_VERDICT: CODE_READY
REVIEWED_AT: 2026-07-25
AUTHORITY_SHA: 948636f4bd3c1bc0feaaf8b91b3ad2730b097e72
BASE_BRANCH: main
TARGET_FILES:
  - docs/standards/decisions.md
  - docs/autopilot-manifests/db-job-claim-lease-core.json
  - docs/autopilot/contracts/autopilot-db-job-claim-lease-core.md
  - .claude/commands/ap-31-db-job-claim-lease-core.md
  - docs/autopilot-backlog.md
  - docs/slice-readiness-verdicts.md
  - docs/standards/BUILD-STATUS.md
  - docs/archive/project-progress-review-2026-07-25.md
  - docs/standards/core-db-architecture-principles.md
  - docs/standards/deployment-infra.md
  - packages/db/README.md
SLICE: db-job-claim-lease-core
IN_SCOPE: outbox/projector lease primitives, per-event job audit, job_definer bootstrap/ownership, schema mirror, real-role tests and CI/local bootstrap
OUT_OF_SCOPE: worker preflight/startup, pg-boss queues, runtime handler/cron, producers/projectors, frontend/UI/design mapping, surface_refs and tenant-RLS policy changes
G1_DECISION: PASS
G2_SPEC: PASS
G3_DEPENDENCY: PASS
G4_TEST: PASS
G5_SCOPE: PASS — documented budget exception (P1 root migration spans DB code, real-role tests, CI and local bootstrap); at this SHA the live migration tail is 0021, so 0022_job_claim_lease_core.sql is the verified next monotonic path and package.json is reserved solely for db:bootstrap. A pre-register tail recheck stays mandatory; any drift requires updating manifest, backlog and all verdict mirrors, committing/pushing the correction, then re-pinning
G6_EXTERNAL: PASS
HARD_DEPENDENCIES: none — root slice; 0000 role model, 0005 worker tables and 0010 claim function are merged and re-verified at this SHA
PRIOR_SLICES: none
OPEN_QUESTIONS_IN_SCOPE: 0
ENABLEMENT_ONLY_GATES: none
LIVE_REPO_VERIFICATION: PASS (IMPLEMENTED — squash-merged at origin/main@34429fceac2349d3362bdd0be4aee60d9af71c5d on 2026-07-26; exactly the 10 manifest-scope files, +1930/-33; migration tail advanced 0021 -> 0022; merged probe 0022_job_claim_lease_core.sql::job_audit_events verified on main; db suite 201/201 on merged main)
CONTRACT_MATRIX: PASS
CLOSURE_MATRIX: PASS (12/12)
ACCEPTANCE_MATRIX: PASS (JCL-1..JCL-14; real-PostgreSQL db suite 179 -> 201 on merged main)
SECURITY_AND_MIGRATION_GATE: PASS (codex round-11 closed an indirect runtime-role -> group-role -> job_definer BYPASSRLS path by rechecking the denylist AFTER the grant in the same transaction with atomic rollback)
IMPLEMENTATION_ARTIFACTS: PASS (authority packet merged at 948636f; implementation squash-merged at 34429fc)
FIRST_IMPLEMENTATION_STEP: n/a — IMPLEMENTED & MERGED at origin/main@34429fc (13 codex rounds; rounds 12 and 13 clean on the same HEAD 19091dc). The five-round fix breaker fired at round 11 and was owner-authorised to continue — that round is what surfaced the BYPASSRLS escalation path above; the override is recorded here rather than left implicit
REMAINING_BLOCKERS: none — merged
NEXT_REVIEW_TRIGGER: n/a — merged. Next event is slice 2 `job-runtime-dispatcher` (worker preflight fail-closed before `boss.start()`), which is a new slice needing its own manifest and verdict; it does not inherit this authorization
```

---

## 8. Verification record tại snapshot đã publish

Đã chạy trên checkout hiện hành:

```text
DATABASE_URL_TEST=postgres://plexco:plexco_dev@localhost:5432/plexco_test pnpm test
  PASS — 13 readiness-validator tests
  PASS — 29 workspace files / 460 tests

pnpm typecheck
  PASS

pnpm build
  PASS

pnpm exec eslint packages apps scripts
  PASS

pnpm review:check:changed
  PASS — 3 classified documents / 10 active verdict blocks in current changed set

pnpm review:check
  PASS — 16 classified documents / 15 active verdict blocks toàn repo

pnpm exec prettier --check <19 file đã reconcile>
  PASS

mirror hash (tracker + task contract + report)
  PASS — 22ac909a... trên cả ba canonical verdict blocks

pnpm lint
  FAIL — ignored local .probe/*.mjs bị root ESLint quét; 7 no-undef, tracked source vẫn xanh
```

## 9. Tóm tắt evidence toàn project — KHÔNG phải verdict

> Mục này là **tóm tắt của §2/§3**, không phải authority và không authorize gì. Verdict duy nhất có hiệu lực
> trong file này là fenced block ở §7, và nó chỉ áp cho slice `db-job-claim-lease-core`. Các nhãn dưới đây là
> mô tả trạng thái quan sát được, không phải readiness classification theo gate §2.

**PROJECT_PROGRESS (reconciled 27/07):** foundation + shared job mechanics + Session DB invariant đã merge; product business E2E chưa bắt đầu.
**PRODUCT_USABLE:** **NO** — chưa có business API + FE + projector path end-to-end.  
**NEXT_ENABLEMENT:** Google owner config/secrets/staging/product E2E; scheduler chỉ enable sau real projector + producer/sub-minute trigger + controlled replay/drain gates.
**NEXT_CODE:** `0022`/`0023`, dispatcher/preflight/scheduler và `0024` đã merge. Immediate maintenance
candidate là `db-check-constraint-naming-drift`; sau đó mới vertical Session BE. Mỗi slice vẫn cần
authority/readiness riêng; report này không authorize code.
**NEXT_FE:** **HOLD** — chờ canonical `design.pen` được persist/track + owner nghiệm thu làm authority;
sau đó mới map screen/component/token/state vào BE contract đã ổn định.
