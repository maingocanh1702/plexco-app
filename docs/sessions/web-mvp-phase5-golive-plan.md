# Web MVP Phase 5 (go-live): kế hoạch, chờ owner duyệt

<!-- review-readiness: enforce -->

> Tài liệu cho owner đọc để quyết, không phải prompt. Prompt lane cho agent (RUN doc) chỉ được viết SAU khi owner trả lời §5; PR này không có RUN doc.
> Docs-only: không code, không test, không migration, không workflow, không file infra hay env. Plan này **không authorize coding**, không tạo tài nguyên cloud, không deploy; mỗi lane vẫn cần verdict `CODE_READY` riêng ở step 0 của session chạy nó.
> Ngày 2026-10-28 · baseline `origin/main` `762045b3f5561ca0ed884095d5e334df0db90325` (= merge #133). Cùng khuôn `docs/sessions/web-mvp-phase4-plan.md` (PR #114). Số đo giá DigitalOcean, PR #50 và thời gian lane Phase 4: `docs/research/web-mvp-phase5-golive-measurements-2026-10-28.md` (cùng PR).

## 1. Tóm tắt

- Phase 5 đưa Web MVP từ "chạy được ở local" tới pilot đầu tiên với 1-2 CLB thật, an toàn, ít bước owner nhất. Agent chỉ viết file (docs, config, workflow, code) và chạy test local; mọi tài khoản, secret, console cloud, deploy và dữ liệu production là bước của owner (§8).
- 17 lane ở §3: 15 lane chắc chắn (L62-L76) và 2 lane có điều kiện (L77 KMS, L78 TLS CA của DB). Không lane nào dự kiến cần migration (tail `0074`, số trống `0075`).
- PR #50 được thay bằng lane mới từ `main` (L65 tooling, L66 App Spec, L67 workflow deploy, L68 log correlation, L69 và L70 runbook); owner đóng #50 sau khi các lane đó merge (default của Q2). Không lane nào checkout, rebase hay push #50.
- **Xung đột phải nói rõ:** App Spec và workflow deploy (L66, L67) đụng hai luật đang hiệu lực: dòng backlog `infra-do-app-vpc-deployment` là P0, "ineligible for autopilot codegen" (`docs/autopilot-backlog.md:885`, `:895`), và `docs/standards/environments-setup.md:81` cấm tạo App Spec trước khi gate §7.1 đóng. Plan không vượt hai luật đó: L66, L67 chờ câu trả lời Q1, Q7 của owner và lane research L62. DD-132 (`docs/standards/decisions.md:3298`, `:3314-3315`) vẫn để deploy DigitalOcean ngoài MVP; chỉ tin nhắn duyệt plan của owner kèm các câu trả lời mới gỡ được (blocker B2, §11). Plan không tự gỡ.
- <!-- TODO W2: one bullet each for the owner checklist (section 8), the gates (section 9) and the questions (section 5), with the user-visible defaults -->
- <!-- TODO W3: one bullet for the estimate (section 6), agent time and owner-wait time apart -->
- **Điều kiện resume (nhị phân):** chỉ tin nhắn VIẾT "Phase 5 plan approved" của owner, kèm trả lời hoặc override từng câu ở §5, mới khởi động Phase 5. Merge PR này mà không có tin nhắn đó không duyệt gì, không khởi động gì.

## 2. Phạm vi, baseline và luật go-live

**Luật của owner (prompt Phase 5, nguyên văn):** "Agents never create cloud resources, never read, print or store a secret value, never trigger a deploy, and never touch production data." Áp vào plan:

- Mỗi lane chỉ viết file trong worktree của nó và chạy test local; secret chỉ được nêu bằng TÊN biến, không bao giờ bằng giá trị.
- Workflow deploy chỉ có trigger tay `workflow_dispatch`, không bao giờ chạy theo `push`; chỉ owner bấm chạy (§8).
- Bật projector, bật cờ ở môi trường thật, các drill §7.6, pháp lý, chọn và mời CLB: bước của owner (§8), không phải lane.
- Classifier từ chối một lệnh ⇒ AWAIT kèm lệnh chính xác, không đi đường vòng.

**Baseline (đo tại `762045b3f5561ca0ed884095d5e334df0db90325`):**

- Migration tail `packages/db/migrations/0074_projector_delivery_lease_clock.sql`; số trống kế tiếp 0075. Lane nào cần migration thì lấy số trống kế tiếp đo lại tại base của lane, chạy tuần tự.
- CI của `main` tại base: 4 run (CI, Security, linear-sync, Autopilot backlog audit) đều success.
- PR mở: #50 là PR mở duy nhất lúc lập plan: OPEN, `mergeable: CONFLICTING`, `mergeStateStatus: DIRTY`, 25 file, +1619 -25 (§3 của file research). PR này là PR mở thứ hai.
- `docs/autopilot-backlog.md`: 314 dòng `## task:`, trong đó 155 dòng còn mở (không merged, không superseded).
- `infra/` trên main chỉ có `Dockerfile`, `docker-compose.yml`, `entrypoint.sh`, `fly.toml`, `postgres-init/`; workflow chỉ có `autopilot-backlog-audit.yml`, `ci.yml`, `linear-sync.yml`, `security.yml`; runbook chỉ có `local-mvp-smoke.md`, `outbox-dispatch-enable-rollback.md`. Chưa có App Spec, workflow deploy, runbook PITR hay failover.
- Cờ giới tính: `GENDER_COLLECTION_ENABLED=true` ở `.env.example:167` (DD-141); code chỉ bật khi giá trị đúng bằng `"true"` (`apps/web/app/api/me/profile/route.ts:32`), nên vắng biến = tắt.
- Số dòng của `docs/standards/decisions.md` và `docs/autopilot-backlog.md` trong plan đo tại baseline; PR sau chèn dòng sẽ làm lệch.

### Đã đọc (mục "Read first" của prompt)

- **DD-04** (`docs/standards/decisions.md:213`; bản ghi `docs/decisions/analysis/dd-04-hosting-final-decision.md`, 362 dòng): App Platform + Managed PostgreSQL HA, cùng VPC private, Singapore (bản ghi :17-25); Day-1 `$120–135/month` (:26-27, :111); gate §7.1 IP outbound (:172-186); danh sách nghiệm thu production §7.6 có **14 mục** (:281-298), prompt nêu 6 mục bằng bản rút gọn của entry (`docs/standards/decisions.md:235`). Bản sao trong repo: `docs/standards/environments-setup.md` §1.1 (:51-81, trạng thái gate `HALT-EVIDENCE_INCOMPLETE` ở :66) và §10 (:462). Giá kiểm lại ngày 2026-10-28: §2 của file research.
- **PR #50** (đóng băng, OPEN, CONFLICTING): bảng 25 file ở §3 của file research: 10 file còn hiệu lực, 8 port có sửa, 6 stale rồi port có sửa, 1 bỏ (hàng backlog). Ba điểm đã mục: App Spec thiếu biến main nay đọc (`DISCOVERY_*`, `KMS_ENCRYPTED_CONNECTOR_PEPPER`), workflow chưa có bước rollback, runbook PITR cho agent cầm token DO (hàng 19).
- **`docs/standards/deployment-infra.md`** (311 dòng, v1.10 · 2026-10-27 ở :3): §7 CI/CD (:198), §8 backup/DR và observability (:221), §9 chi phí (:231). Đo 13 mục so với bản ghi DD-04: 11 mục lệch thật, mục 12 không mâu thuẫn, mục 13 là dòng lịch sử ⇒ lane L63.
- **Runbook outbox và CLI của owner** (`docs/runbooks/outbox-dispatch-enable-rollback.md`, 155 dòng; `scripts/outbox-projector-enable.mjs`): theo dáng local compose, không nêu thứ tự projector ⇒ lane docs L71; bật projector là bước của owner (§8).
- **`docs/runbooks/local-mvp-smoke.md`** (240 dòng; golden path ở §10 :161-173, dev-login chỉ local) và `scripts/smoke-predeploy.mjs` (61 dòng, một kiểm duy nhất `GET /healthz` ở :35, :40) ⇒ lane L74.
- **`.env.example`** (174 dòng): staging và production chờ `KMS_PROVIDER=aws-kms` (`packages/db/src/secret-key-root.ts:41-42`); 10 tên không có reader ở base; `DATABASE_URL_MIGRATION` cố ý vắng (`.env.example:78-82`) ⇒ lane L64, câu Q8.
- **DD-138..DD-153** (`docs/standards/decisions.md:1768` tới `:2377`): DD-153 (`:1768`) là luật song song của §7; DD-150 (`:1811`) là câu trả lời Q1-Q10 của Phase 4, trong đó Q7 giới tính; DD-141 (`:2309`) hai cờ mặc định true, thu giới tính phải kèm notice mục đích và đồng ý; DD-139 (`:2354`) địa chỉ venue public mặc định; DD-146 (`:2058`) DM `zalo_dm` quá 60 phút thì không giao; DD-149 (`:1841`) luật chữ "accepted under the owner's delegation of 2026-10-24 (assistant review)"; DD-138 (`:2377`) còn 6 hàng chưa được owner duyệt ⇒ bước sign-off trước pilot ở §8.
- **Báo cáo đóng Phase 4** (nằm ngoài repo): <!-- TODO W2: its open items that face real users, placed in section 8 -->
- **Q7 của plan Phase 4** (`docs/sessions/web-mvp-phase4-plan.md:114`, owner trả lời theo default ở DD-150): `GENDER_COLLECTION_ENABLED` giữ true ở local, đặt false ở môi trường người dùng thật đầu tiên ⇒ L66 ghi `"false"` vào file spec; bật ở môi trường thật là bước của owner.
- **Tám điểm pháp lý** (`docs/sessions/web-mvp-phase3-readiness-p3-flags-default-on.md:253`, các điểm ở :257-264): là câu trả lời của owner; lane L75 chỉ viết bản nháp và để trống tám điểm đó.
- **Dòng backlog gắn go-live:** `infra-do-app-vpc-deployment` (:885), `infra-egress-compatibility-evidence` (:926), `observability-sentry-loglevel-readers` (:5195), `backup-pitr-drill` (:5208), `request-id-log-context-auth-onboarding` (:5857), `db-tls-ca-verification-do-managed-pg` (:5875), `next-config-route-header-precedence-claim` (:6031), `offline-page-csp-nonce-missing` (:6284), `public-share-page-header-level-referrer-and-robots` (:7250), `web-public-share-page-404-production-measurement` (:7280), `golden-path-no-trigger-on-client-or-session-route-change` (:7659) ⇒ cột "Dòng backlog" ở §3; bảng phân loại đủ ở Phụ lục A.
- **Skip list của owner** (legal, meta review, vendor emails, DigitalOcean setup, secrets, Google OAuth): chỉ được nêu tên trong prompt và trong Phụ lục A của plan Phase 4 (`docs/sessions/web-mvp-phase4-plan.md:296`, `:297`) ⇒ câu Q1.

### Chỗ plan khác danh sách khởi điểm của prompt

Danh sách khởi điểm là mục 1 trong prompt Phase 5 của owner. Mỗi chỗ plan làm khác, kèm nguồn:

- **Health check đã có ở base, không thành lane:** liveness `apps/web/app/healthz/route.ts:2`, `HEALTHCHECK` của worker ở `infra/Dockerfile:81`. Phần còn thiếu là stanza `health_check` trong App Spec (L66) và smoke staging (L74).
- **Cấu hình tắt giới tính không thành lane riêng:** L66 ghi `GENDER_COLLECTION_ENABLED: "false"` vào file spec của môi trường người dùng thật đầu tiên (DD-150 Q7, DD-141).
- **Budget alert gộp vào L63:** `docs/standards/deployment-infra.md` §7-§9 chưa có yêu cầu budget alert (mục lệch 6), bản ghi DD-04 đòi alert hằng tháng cho compute, DB, transfer, log, backup, KMS (:298). Đặt alert trong console là bước của owner.
- **Error tracking:** DD-129 default (6) "không thêm vendor (Sentry giữ backlog)" và (7) owner chọn log forwarder (`docs/standards/decisions.md:144`, đóng băng, chưa được owner duyệt) lệch với Sentry Developer Day-1 của bản ghi DD-04 (:107). L68 không thêm vendor; lựa chọn là một bước sign-off của owner ở §8.
- **App Spec và workflow deploy:** prompt xếp cho agent, nhưng hai luật ở §1 (dòng :885 P0, `environments-setup.md:81`) chặn. L66, L67 chỉ viết FILE, chờ Q1, Q7 và L62; deploy chỉ khi owner bấm `workflow_dispatch`.
- **§7.1 cho lần ra mắt đầu chỉ còn Zalo** (và Meta nếu Messenger vào, Q6): DD-132 bỏ SePay, ApiPay khỏi MVP (`docs/standards/decisions.md:3310`). Xung đột mới cho L62 và Q7: trang App Platform ghi VPC và dedicated egress IP không bật cùng lúc được (§2 (b) của file research), trong khi DD-04 muốn DB private qua VPC và IP outbound cố định nếu Zalo cần.
- **Runbook PITR của #50** cho "owner or an agent with a DO token" chạy (hàng 19 ở §3 của file research): trái luật Phase 5; L70 đổi bước đó thành bước của owner.
- **KMS:** code đọc `aws-kms` hoặc key local; key và cấu hình là input của owner (Q8). Lane code P1 (L77) chỉ chạy nếu input đó cần đổi code.

## 3. Bảng lane

Mọi lane chờ B1 (§11). Cột "Chờ" chỉ nêu thêm câu hỏi (§5) hay bước owner (§8) mà lane cần.

| Lane | Dòng backlog / nguồn | Phạm vi | File / vùng | Nghiệm thu | Lớp · size (ước đoán) | Phụ thuộc | Chờ | Run cap |
|---|---|---|---|---|---|---|---|---|
| L62 p5-egress-research | `infra-egress-compatibility-evidence` (:926, blocked) | gate §7.1 cho lần ra mắt đầu, chỉ trang chính thức: Zalo Bot (`bot-api.zaloplatforms.com`, nguồn ở `environments-setup.md:63`); Meta chỉ khi Messenger vào (:64); kiểm lại trên trang DO rằng VPC và dedicated egress IP vẫn không bật cùng lúc; liệt kê mọi dịch vụ outbound khác của lần ra mắt đầu | `docs/standards/environments-setup.md` §1.1 | mỗi hàng có URL, anchor, ngày truy cập, câu trích nguyên văn (`docs/decisions/analysis/dd-04-egress-evidence-review-criteria.md:55-61`); tài liệu im lặng ⇒ giữ `UNRESOLVED` (:43-49); không tự đóng dòng :926 (chỉ câu trả lời support do owner gửi mới đóng) | research · ~40 dòng · 1 file | không | Q6 (hàng Meta) | 3 |
| L63 p5-deployment-infra-drift | không có dòng (đo ở §2) | sửa 11 mục lệch của `deployment-infra.md` §7-§9 so với bản ghi DD-04 và `environments-setup.md`; thêm mục budget alert (ngưỡng là tham số owner đặt) | `docs/standards/deployment-infra.md` | mỗi mục lệch có một sửa hoặc lý do bỏ (checklist trong PR); trigger deploy ghi theo Q1; `pnpm review:check` xanh | docs · ~80 dòng · 1 file | không | Q1 (mục 11: trigger deploy) | 3 |
| L64 p5-env-manifest | không có dòng | manifest biến môi trường staging và production, chỉ TÊN: secret, cờ, config, tên không có reader; tên code đọc mà `.env.example` không liệt kê; map theo component (`environments-setup.md:165-168`); tên secret và var GitHub (§3 của file research) | một file mới dưới `docs/runbooks/` (tên chốt ở step 0) | mỗi tên có lớp, component, dòng nguồn; 0 giá trị; không chép literal ở `.env.example:45-52`; giới tính false ở môi trường người dùng thật đầu tiên | docs · ~120 dòng · 1 file | không | không | 3 |
| L65 p5-staging-tooling-port | PR #50 hàng 5-9, 17, 25 | port từ `origin/feat/mvp-m5-staging` lên nhánh mới từ main: renderer App Spec và test, chờ deployment, smoke, role `migrate` của entrypoint, ignore `spec.local.json`, dây `test:infra` | `infra/render-app-spec.sh`, `infra/render-app-spec.test.mjs`, `infra/wait-for-deployment.sh`, `infra/smoke-check.sh`, `infra/entrypoint.sh`, `.gitignore`, `package.json` | 7 test của renderer xanh; renderer fail khi thiếu secret; `pnpm test` gồm `test:infra`; không lệnh doctl nào chạy trong lane; security round | code · ~270 dòng · 7 file | không | Q1, Q2 | 4 |
| L66 p5-app-specs | `infra-do-app-vpc-deployment` (:885, P0); PR #50 hàng 3, 4, 22 | App Spec staging và production, CHỈ file; thêm biến main nay đọc, `GENDER_COLLECTION_ENABLED: "false"`, `health_check`, số instance theo Q3, domain theo Q4, danh sách gate header theo L62 | `infra/app.staging.yaml`, `infra/app.prod.yaml`, `docs/standards/environments-setup.md` | renderer của L65 render được cả hai spec với secret giả; YAML parse; không giá trị secret; `doctl apps spec validate` cần auth DO ⇒ bước owner; security round | config P1 · ~320 dòng · 3 file | L62, L65 | Q1, Q3, Q4, Q7 | 6 |
| L67 p5-deploy-workflows | `infra-do-app-vpc-deployment` (:885); PR #50 hàng 1, 2, 10 | workflow staging và production chỉ `workflow_dispatch`; `ubuntu-24.04`; kiểm lại 3 action pin; thêm bước rollback (#50 không có) | `.github/workflows/deploy-staging.yml`, `.github/workflows/deploy-production.yml` | `actionlint` local; không có trigger `push`; chỉ tên secret và var; security round | config P1 · ~330 dòng · 2 file | L66 | Q1, Q4 | 6 |
| L68 p5-log-correlation | `request-id-log-context-auth-onboarding` (:5857), `observability-sentry-loglevel-readers` (:5195); PR #50 hàng 11-15 | tạo lại log context (request id, tenant id), bọc họ route lệnh session (`apps/web/lib/session-command-route.ts:848-866`), rồi route auth và onboarding; reader cho `LOG_LEVEL`; không thêm vendor | `apps/web/lib/log-context.ts` (mới) và test, `apps/web/lib/log.ts`, `apps/web/lib/session-command-route.ts`, `apps/web/lib/tenant-lang.test.ts` | log có `request_id` và `tenant_id`, không secret, không PII; header request id lạ bị thay; security round | code · ~250 dòng · 2 module | không | Q2 | 4 |
| L69 p5-runbook-deploy-migration-rollback | `infra-do-app-vpc-deployment` (:885, input DO ở :897-921); PR #50 hàng 18, 20 | runbook deploy staging (mọi bước doctl và console do owner chạy), migration-on-deploy (job `migrate` giữ `DATABASE_URL_MIGRATION`), rollback ứng dụng (`environments-setup.md:432-434`), khuôn go/no-go | `docs/runbooks/staging-deploy.md` (mới), `docs/runbooks/go-no-go-template.md` (mới), một runbook migration và rollback mới | mỗi bước ghi ai chạy và bằng chứng pass; credential chỉ bằng tên; khớp workflow của L67 | docs · ~300 dòng · 3 file | L67 | Q1, Q2 | 3 |
| L70 p5-runbook-backup-pitr-drills | `backup-pitr-drill` (:5208, planned); PR #50 hàng 19 | runbook backup và PITR restore drill (bước token DO thành bước owner), drill failover, drill SSE reconnect và pg-boss không trùng, kiểm 4 role DB và TLS, trusted sources, restore hằng quý ra ngoài DO, form RPO/RTO | `docs/runbooks/pitr-restore-drill.md` (mới), `docs/runbooks/failover-drill.md` (mới) | mỗi drill có bước, tiêu chí pass, form bằng chứng, người chứng kiến là owner; query đối soát chỉ đọc | docs · ~250 dòng · 2 file | không | Q2 | 3 |
| L71 p5-runbook-outbox-staging-prod | không có dòng | biến thể staging và production của runbook outbox: thứ tự bật projector đề xuất để owner duyệt, CLI của owner, credential bằng tên, hạn 60 phút của `zalo_dm` (DD-146) | `docs/runbooks/outbox-dispatch-enable-rollback.md` | lệnh trích khớp CLI tại base của lane; không lệnh nào cho agent chạy trên môi trường thật | docs · ~80 dòng · 1 file | không | không | 3 |
| L72 p5-hardening-headers-csp | :6031, :7250, :7280; có điều kiện :6284 | review hardening production (header, rate limit, cờ cookie, CSP) dưới `next build` và `next start` local; header `Referrer-Policy` và `X-Robots-Tag` cho `/session/:slug`; giữ `CSP_SCRIPT_NONCE_ENABLED` tắt ở lần ra mắt đầu | `apps/web/next.config.mjs`, `apps/web/lib/session-cookies.ts`, proof share page dưới `apps/web/e2e/` | test ghim hai header trên 200 và 404; báo cáo hardening (mỗi mục: đạt, sửa, hoặc dòng backlog); security round | code · ~200 dòng · 2 module | không | không | 6 |
| L73 p5-discovery-isolation-controls | không có dòng (§7.6 mục 6) | circuit breaker và giới hạn pool cho discovery để bảo vệ pool tiền (`circuit.?breaker` 0 hit ở base) | `apps/web/app/api/discover/` và lib discovery (step 0 định vị) | <!-- TODO W1b --> | code · chưa ước được | không | không | 6 |
| L74 p5-staging-smoke-golden-path | :7659 (gộp) | smoke staging qua `SMOKE_BASE_URL`; golden path staging thay dev-login bằng đăng nhập thật của tài khoản test và dữ liệu test tạo qua sản phẩm, không bao giờ dữ liệu production | `scripts/smoke-predeploy.mjs`, config và spec golden path staging mới dưới `apps/web/e2e/` | xanh trên base URL local; chạy trên staging là bước owner (§8); pacer và giới hạn 3 CLB mỗi giờ giữ nguyên | code · ~250 dòng · 2 module | L65 | Q1; cách đăng nhập tài khoản test <!-- TODO W1b: a section 5 question or a section 8 step --> | 4 |
| L75 p5-privacy-terms-draft | không có dòng | bản nháp tiếng Việt trang quyền riêng tư và điều khoản, ghi rõ "bản nháp chờ pháp lý duyệt": địa chỉ public mặc định (DD-139), notice giới tính (DD-141), tiền chỉ ghi tay (DD-132) | file mới (vị trí chốt ở step 0) | không câu nào trả lời thay tám điểm pháp lý; không publish trước câu trả lời của owner | docs · ~200 dòng · 2 file | không | không (publish chờ owner) | 3 |
| L76 p5-pilot-host-guide | PR #50 hàng 21 | hướng dẫn onboarding host cho pilot 1-2 CLB: tạo CLB, nối bot Zalo, tuỳ chọn ẩn địa chỉ (DD-139), số tiền trong /join (DD-140), tiền chỉ `cash` hoặc `attested_transfer` | một file mới dưới `docs/runbooks/` | mỗi bước khớp UI tại base của lane; không hứa tính năng chưa có | docs · ~150 dòng · 1 file | không | Q5 | 3 |
| L77 p5-kms-aws-provider (P1, CÓ ĐIỀU KIỆN) | không có dòng (§7.6 mục 10) | chỉ khi input KMS của owner cần đổi code (`packages/db/src/secret-key-root.ts:41-42`) | step 0 định vị | đường degraded và fail-closed có test; security round | code P1 · chưa ước được | không | Q8 | 6 |
| L78 p5-db-tls-ca-verification (P1, CÓ ĐIỀU KIỆN) | `db-tls-ca-verification-do-managed-pg` (:5875, idea, P1) | tuỳ chọn `ssl` và đường CA lấy từ env (hôm nay chỉ `sslmode=require`); nửa đo cần Managed PG thật của owner | step 0 scope (dòng chưa có scope) | CA và hostname được kiểm; CA sai ⇒ fail closed; security round | code P1 · chưa ước được | không | Q3; owner đã tạo Managed PG (§8) | 6 |

- **Số lane:** 15 lane chắc chắn (L62-L76) và 2 lane có điều kiện (L77, L78).
- **B3 mỗi lane:** khoảng 300 LOC, tối đa 3 module, tối đa 1 migration; size là ước đoán, step 0 đo lại; L66, L67 có thể vượt và phải ghi ngoại lệ B3 ở step 0.
- **Run cap:** cùng quy ước Phase 4 (`docs/sessions/web-mvp-phase4-plan.md:77`): 3 cho docs và research, 4 cho code P2, 6 cho P1, config deploy hay bề mặt public.
- **Migration:** không lane nào dự kiến cần; nếu step 0 thấy cần, lane lấy số trống kế tiếp (0075 tại baseline) và chạy tuần tự.
- **Không thành lane vì đã có ở base:** health check (§2); route webhook và connect của Zalo và projector thật đã có, nên `zalo-webhook-adapter-core` (:5112) và `projector-real-replace-stub` (:5182) là dòng stale cần reconcile, không phải lane.
- **Chưa xếp:** `staging-ttl-teardown-automation` (:5892) chờ staging chạy lần đầu; lý do ở Phụ lục A.

## 4. Đồ thị phụ thuộc và song song

```text
L62 <- (none)   L63 <- (none)   L64 <- (none)   L71 <- (none)
L72 <- (none)   L73 <- (none)   L75 <- (none)
L65 <- [Q1, Q2]   L68 <- [Q2]   L70 <- [Q2]   L76 <- [Q5]
L66 <- L62, L65, [Q1, Q3, Q4, Q7]
L67 <- L66, [Q1, Q4]
L69 <- L67, [Q1, Q2]
L74 <- L65, [Q1]
L77 <- [Q8 = a code change is needed]          (conditional, P1)
L78 <- [Q3, owner's Managed PG exists]          (conditional, P1)
```

- **Luật song song** (DD-153, `docs/standards/decisions.md:1768`): tối đa hai lane cùng lúc, chỉ ghép hai lane không chung file; migration chạy tuần tự; một khoá cho suite DB và e2e.
- **Vùng file:** research và docs chuẩn (L62, L63); runbook (L64, L69, L70, L71, L75, L76); infra và workflow (L65, L66, L67); web và script (L68, L72, L73, L74); `packages/db` (L77, L78). File chung phải chạy tuần tự: `docs/standards/environments-setup.md` (L62 rồi L66, đã là phụ thuộc), `scripts/smoke-predeploy.mjs` (L65 rồi L74, đã là phụ thuộc).
- **Cặp đề xuất:** L62 · L72; L63 · L68; L64 · L73; L65 · L70; L66 · L71; L67 · L75; L69 · L74; L76 một mình (L77, L78 sau đó, mỗi lúc một lane). Lane kế tiếp bắt đầu ngay khi phụ thuộc của nó merge. <!-- TODO W3: confirm the pairs in section 7 with the measured durations -->

## 5. Checklist câu hỏi cho owner

<!-- TODO W2 -->

## 6. Sizing và ước lượng wall-clock

<!-- TODO W3 -->

## 7. Thiết kế thực thi

<!-- TODO W3 -->

## 8. Việc chỉ owner làm (checklist owner, không xếp lịch cho agent)

<!-- TODO W2 -->

## 9. Gate go-live theo thứ tự

<!-- TODO W2 -->

## 10. Rủi ro

<!-- TODO W3 -->

## 11. Readiness verdict (canonical)

Closure matrix (gate §8, 12 hàng; chưa đạt vì owner chưa duyệt plan và các câu ở §5 còn mở):

| # | Gate | Bằng chứng | Kết quả |
| --- | --- | --- | --- |
| 1 | Pin authority theo SHA | `762045b3f5561ca0ed884095d5e334df0db90325` + TARGET_FILES chính xác | PASS |
| 2 | Quyết định trong scope đã chốt | Q1-Q8 còn mở (§5); DD-132 vẫn để deploy DigitalOcean ngoài MVP | FAIL |
| 3 | Scope IN/OUT và owner rõ | §2, §3, §8 | PASS |
| 4 | Dependency phân loại đủ | §3, §4 | PASS |
| 5 | Live schema/code khớp doc | §2 đo tại baseline; mỗi lane đo lại ở step 0 | PASS |
| 6 | Contract data/API/state/auth đủ | §3 chỉ có phạm vi và nghiệm thu; contract chi tiết ở RUN doc và step 0 | PARTIAL |
| 7 | Fail-closed/idempotency/order | gate theo thứ tự ở §9; deploy chỉ bằng trigger tay của owner; decision table ở step 0 | PARTIAL |
| 8 | Open question trong scope = 0 | còn 8 (Q1-Q8) | FAIL |
| 9 | Acceptance matrix có expected result | cột nghiệm thu ở §3; lệnh nghiệm thu chỉ có ở RUN doc (viết sau B1) | FAIL |
| 10 | Migration/security/rollback pin | không lane nào dự kiến cần migration (tail 0074, số trống 0075); security round cho lane chạm config, workflow, auth hay secret theo tên (§7); runbook rollback là một lane | PARTIAL |
| 11 | First slice có hard dependency merged | các lane không phụ thuộc lane nào ở §4 chỉ chờ B1 | PASS |
| 12 | Implementation handoff sẵn sàng | không authorize worktree; RUN doc viết sau B1 | FAIL |

<!-- TODO W2: when section 5 is written, make OPEN_QUESTIONS_IN_SCOPE, row 8 and the Q range in rows 2 and 8 equal the real number of questions -->

```text
REVIEW_POLICY_VERSION: 1.3
REVIEW_VERDICT: NOT_PLAN_READY
REVIEWED_AT: 2026-10-28
AUTHORITY_SHA: 762045b3f5561ca0ed884095d5e334df0db90325
BASE_BRANCH: main
TARGET_FILES:
  - docs/sessions/web-mvp-phase5-golive-plan.md
  - docs/research/web-mvp-phase5-golive-measurements-2026-10-28.md
SLICE: web-mvp-phase5-golive-plan
IN_SCOPE: docs-only plan for the Web MVP Phase 5 go-live: the agent lanes that need no secret, cloud console or deploy (section 3), their dependency graph and pairing (section 4), the owner questions (section 5), the wall-clock estimate (section 6), the execution design (section 7), the owner checklist (section 8), the go-live gates in order (section 9), the risks (section 10)
OUT_OF_SCOPE: code, tests, migrations, workflows, infra and env files, the Phase 5 RUN doc and lane prompts, new DD entries, edits of decisions.md, Reviewed specs or docs/legal, PR #50, any cloud resource, console, account or deploy, any secret value, production data, every owner-only step
G1_DECISION: FAIL
G2_SPEC: PARTIAL
G3_DEPENDENCY: PASS
G4_TEST: PARTIAL
G5_SCOPE: PASS
G6_EXTERNAL: ENABLEMENT_ONLY:do_accounts_and_resources,secret_values,egress_7_1_verified,deploy_manual_trigger,outbox_projector_enable,legal_review,real_user_pilot
HARD_DEPENDENCIES: none for plan authorization; owner approval and the answers to the section 5 questions are the blockers below
PRIOR_SLICES: Web MVP Phase 4 (PRs #114 to #133) merged at AUTHORITY_SHA; the date-gated L54 not yet run; PR #50 frozen owner-only (OPEN, CONFLICTING)
OPEN_QUESTIONS_IN_SCOPE: 8
ENABLEMENT_ONLY_GATES: do_accounts_and_resources, secret_values, egress_7_1_verified, deploy_manual_trigger, outbox_projector_enable, legal_review, real_user_pilot
LIVE_REPO_VERIFICATION: PASS
CONTRACT_MATRIX: PARTIAL
CLOSURE_MATRIX: PARTIAL
ACCEPTANCE_MATRIX: FAIL
SECURITY_AND_MIGRATION_GATE: PARTIAL
IMPLEMENTATION_ARTIFACTS: NOT_REQUIRED_FOR_PLAN_READY
FIRST_IMPLEMENTATION_STEP: BLOCKED until B1 resolves; then P5-S1 step 0 (per-lane readiness for the lanes of section 4 that depend on no other lane)
REMAINING_BLOCKERS:
  - blocker: B1 owner approval of this plan
    owner: Ngoc-Anh
    resolution: the owner writes "Phase 5 plan approved" with an answer or an override for each question of section 5 (this message also allows the merge of this PR; a merge alone approves nothing)
    next_review_trigger: the owner's written message "Phase 5 plan approved" and a main that contains this PR
  - blocker: B2 DD-132 keeps the DigitalOcean deploy outside the MVP
    owner: Ngoc-Anh
    resolution: the B1 message with the answers that name what agents may now prepare (Q1) and the Day-1 tier (Q3); this plan does not lift DD-132 by itself
    next_review_trigger: decisions.md on origin/main carries the owner's DD entry that changes the DD-132 deploy scope
  - blocker: B3 the answers to the section 5 questions are not yet recorded as DD entries
    owner: Ngoc-Anh
    resolution: after B1, the first Phase 5 docs step records each answer as a DD entry in docs/standards/decisions.md on main
    next_review_trigger: decisions.md on origin/main carries a DD entry for each answer of section 5
NEXT_REVIEW_TRIGGER: the owner's written message "Phase 5 plan approved" with answers to the section 5 questions and a main that contains this PR; then P5-S1 step 0 writes the per-lane CODE_READY or NOT_CODE_READY verdicts
```

## Phụ lục A. Dòng backlog đã xét nhưng không đưa vào Phase 5

<!-- TODO W3 -->
