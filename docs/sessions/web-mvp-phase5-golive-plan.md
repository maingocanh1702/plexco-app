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
- **8 câu hỏi cho owner (§5)**, mỗi câu một default: Q1 skip list (agent viết FILE config DigitalOcean và workflow deploy; giá trị secret, console và deploy luôn là của owner), Q2 lane mới thay #50, Q3 HA từ Day-1 như DD-04 (giá đo 2026-10-28: $118.90 mỗi tháng nếu tài khoản còn tạo được Standard có standby, $318.00 nếu phải lên Advanced; owner kiểm lại vào ngày mua), Q4 domain `plexco.app`, Q5 pilot 2 CLB và ngày chốt sau G1, Q6 Messenger ngoài lần ra mắt đầu, Q7 fallback Fly + DO nếu Zalo cần IP cố định, Q8 `aws-kms`. Default USER-VISIBLE: Q4 (domain trong mọi link), Q6 (pilot không có kênh Messenger).
- **Checklist owner (§8):** 12 bước 8.0-8.11, mỗi bước ghi ai làm, làm gì, chặn lane hay gate nào, default, và thời gian chờ là tham số `T_owner_*` (không đoán số): duyệt plan, tài khoản và billing, domain, OAuth Google và bot Zalo, email nhà cung cấp cho §7.1, nhập secret theo TÊN, bấm deploy, chứng kiến drill, bật projector, MỘT lần xác nhận trước pilot, tám điểm pháp lý, chọn và mời CLB.
- **Gate go-live (§9):** G1 §7.1 egress verified → G2 staging up và golden path staging PASS → G3 nghiệm thu §7.6 → G4 production up, giới tính tắt → G5 projector bật → G6 pilot 1-2 CLB → G7 review; mỗi gate ghi bằng chứng, ai tạo bằng chứng và chặn gì.
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
- **Báo cáo đóng Phase 4** (nằm ngoài repo, `P4-FINAL-SUMMARY.md`, 66 dòng): mục hướng tới người dùng thật là các default USER-VISIBLE "default applied, pending owner sign-off" ở §3 (chuỗi UI mới của L49, cặp 400 `ZALO_TOKEN_INVALID` của L47, khoảng trống guest của L40) ⇒ 8.9; việc chỉ owner ở §4 (pháp lý, secret thật, token bot Zalo, Google OAuth, email nhà cung cấp, DigitalOcean, deploy, người dùng thật, bật projector) ⇒ 8.1-8.11; nửa bot thật của bằng chứng error-mapping Zalo chờ token của owner ⇒ 8.3; 93 câu hỏi spec ở §5 chưa phân loại ⇒ ghi chú ở 8.9.
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

Mọi câu được trả lời ở bước 8.0: tin nhắn VIẾT "Phase 5 plan approved" của owner kèm trả lời hoặc override từng câu (điều kiện resume ở §1); merge PR này một mình không trả lời câu nào. DD cho các câu trả lời được ghi SAU khi owner trả lời, không trong PR này (B3, §11). Mọi default dưới đây là "default applied, pending owner sign-off" cho tới khi owner xác nhận bằng văn bản. Cột "Chặn" nêu lane (§3), gate (§9) và bước owner (§8) cần câu trả lời. **USER-VISIBLE** = default đổi điều người dùng thật thấy. Chỉ có 8 câu: các default khác (báo cáo đóng Phase 4 §3; default (6), (7) của DD-129: không Sentry, log forwarder) không đổi việc agent xây, nên là bước sign-off 8.9, không phải câu hỏi.

| # | Câu hỏi | Default đề xuất | Trade-off | Chặn | USER-VISIBLE |
| --- | --- | --- | --- | --- | --- |
| Q1 | Skip list của owner (legal, meta review, vendor emails, DigitalOcean setup, secrets, Google OAuth; tên nguyên văn ở `docs/sessions/web-mvp-phase4-plan.md:23`, định nghĩa từng mục chưa tìm thấy): agent được chạm mục nào trong Phase 5? | DigitalOcean: agent viết FILE config và workflow deploy (L65, L66, L67, L69, L70), không bao giờ mở console, chạy `doctl`, tạo tài nguyên hay deploy. Secrets: chỉ TÊN (L64, L65, L67), không bao giờ giá trị. Legal: chỉ bản nháp (L75), không trả lời tám điểm pháp lý, không publish. Vendor emails: agent chỉ đọc trang chính thức (L62), owner gửi (8.4). Meta review: không lane nào (Q6). Google OAuth: chỉ tên biến trong manifest (L64), owner tạo client (8.3). "Có" chỉ mở việc viết FILE của dòng P0 `infra-do-app-vpc-deployment` (`docs/autopilot-backlog.md:885`, `:895`); không gỡ `environments-setup.md:81` (L66 vẫn chờ G1), không gỡ DD-132 (B2) | Có: owner chỉ review PR và bấm trigger. Không: L65-L67, L69 không có tác giả; owner tự viết config, hoặc G2 không có đường | L63 (mục 11), L65, L66, L67, L69, L74; G2 và mọi gate sau | không |
| Q2 | PR #50 (đóng băng, OPEN, conflict): mở lại #50, hay thay bằng lane mới từ `main`? | Lane mới: L65-L70 port phần còn dùng được từ `origin/feat/mvp-m5-staging` lên nhánh mới; owner đóng #50 sau khi các lane đó merge; không lane nào checkout, rebase hay push #50 | Lane mới: mỗi phần qua review riêng trên base hiện tại và sửa luôn phần stale (#50 không có rollback; runbook PITR của #50 cho agent có token DO chạy). Mở lại #50: một PR lớn đang conflict, phải rebase rồi review lại toàn bộ | L65, L68, L69, L70 (L66, L67 qua L65); G2, G3 | không |
| Q3 | Bậc chi phí Day-1: HA ngay hay khởi đầu nhỏ không HA; cửa sổ staging tạm dài bao nhiêu? | HA ở production từ Day-1 như DD-04, để drill failover của G3 chạy được và không phải chuyển cluster về sau. Edition theo trường hợp tài khoản của owner tại ngày tạo cluster: Standard có standby nếu DO còn cho tạo (hình dạng 1), không thì Advanced (hình dạng 2). Staging tạm cùng hình dạng, một cửa sổ 48-96 giờ, owner xoá khi hết cửa sổ (hình dạng 4; §7.6 mục 11 hoãn, 8.9). Giá ở bảng dưới, đo 2026-10-28: owner kiểm lại giá và luật edition trên trang chính thức vào ngày mua | Hình dạng 3 rẻ nhất nhưng không có standby: không có failover để drill (G3 mục 7, 8a), và cluster Standard mới không thêm được standby về sau, nên lên HA thành chuyển sang Advanced (cách chuyển chưa đo). Hình dạng 2 gần gấp ba hình dạng 1 | L66 (số instance), L78 (cần Managed PG thật); G2, G3 (mục 5, 7, 8a), G4; 8.1, 8.7, 8.9 | không theo default; hình dạng 3 không có component discovery, ảnh hưởng tới người dùng chưa đo |
| Q4 | Domain của lần ra mắt đầu? | `plexco.app`, tên DD-83 dùng trong URL scheme (`docs/standards/decisions.md:1206`: `plexco.app/user/<handle>`, `/club/<slug>`, `/session/<slug>`, `/tournament/<slug>`); staging một subdomain riêng; DNS và TLS do owner (8.2) | Giữ tên DD-83 thì không doc nào phải sửa; repo không ghi owner đã giữ tên này chưa, owner kiểm ở 8.2. Tên khác thì DD-83 cần một dòng sửa (ghi sau câu trả lời, B3) | L66, L67; G4 (domain và TLS); 8.2 | **USER-VISIBLE**: domain trong mọi link người dùng thấy và chia sẻ |
| Q5 | Pilot: bao nhiêu CLB, ngày mục tiêu? | 2 CLB (mức trên của prompt), chọn và mời cùng lúc khi G6 mở (8.11), để ranh giới giữa hai tenant thật được dùng ngay trong pilot. Ngày bắt đầu chỉ chốt sau G1 PASS, vì G1 chờ câu trả lời viết của vendor (tham số `T_vendor_answer`, không đoán). Cửa sổ pilot là tham số `T_pilot_window` owner đặt; G7 chạy khi hết cửa sổ | 1 CLB: ít việc hỗ trợ host hơn và vùng ảnh hưởng nhỏ hơn, nhưng ranh giới tenant không có dữ liệu thật thứ hai. Đặt ngày trước G1 là đoán | L76; G6, G7; 8.11 | không |
| Q6 | Messenger vào hay ngoài lần ra mắt đầu? | Ngoài: lần ra mắt đầu chỉ có web và Zalo. DD-132 đã gỡ M11 (Messenger) khỏi MVP (`docs/standards/decisions.md:3317`); meta review nằm trong skip list | Ngoài: G1 chỉ còn hàng Zalo, owner không phải làm meta review hay nhập secret Messenger. Vào: L62 kiểm lại hàng Meta, owner làm meta review và nhập secret Messenger theo tên, và M11 cần một DD đưa lại vào MVP | L62 (hàng Meta); G1; 8.4 | **USER-VISIBLE**: pilot không có kênh Messenger |
| Q7 | Nếu Zalo cần IP outbound cố định (L62 hoặc câu trả lời vendor ở 8.4 ra YES), trong khi App Platform không bật cùng lúc VPC và dedicated egress IP (§2 (b) của file research): đi đường nào? | Theo bản ghi DD-04 (:172-178): không tắt đường DB private; dùng phương án (a) Fly + DO, fallback có giới hạn mà bản ghi chỉ định; L66, L67, L69 được plan lại cho đích đó trước khi chạy. Zalo ra NO: Q7 không áp, plan giữ nguyên. Còn UNRESOLVED: G1 giữ HALT (`docs/decisions/analysis/dd-04-egress-evidence-review-criteria.md:71-72`), không phải việc của Q7 | (a) đã có trong bản ghi nhưng thêm một nhà cung cấp cho owner (tài khoản, billing, secret) và lane config phải viết cho đích mới. Droplet hoặc DOKS (cũng ở :172-178) giữ một nhà cung cấp nhưng cần thiết kế hạ tầng mới. Tắt VPC để lấy egress IP là trái bản ghi | L66, L67, L69; G1, mục 2 ở G2 và G4; 8.1 (tài khoản thêm nếu (a)) | không |
| Q8 | KMS cho staging và production: `aws-kms` hay key local? | `KMS_PROVIDER=aws-kms`, đúng chú thích của code ("aws-kms (staging/prod)", `packages/db/src/secret-key-root.ts:8`; key local `ENCRYPTION_KEY` là đường dev, :11). Owner tạo tài khoản AWS, key KMS và credential (8.1), nhập các tên KMS code đọc (ví dụ `KMS_PROVIDER`, `KMS_ENCRYPTED_AUTH_PEPPER`, `AWS_REGION`) theo manifest của L64 (8.5). L77 chỉ chạy nếu step 0 thấy input đó cần đổi code | aws-kms: thêm một tài khoản và bộ credential cho owner (DD-04 ước $1-3 mỗi tháng, chưa kiểm lại). Key local: không cần AWS, nhưng key gốc nằm thẳng trong secret của app và §7.6 mục 10 hoãn kèm sign-off 8.9 | L77 (có điều kiện); G2 (staging cần key gốc), G3 (mục 10); 8.1, 8.5, 8.9 | không |

**Giá cho Q3** (§2 của `docs/research/web-mvp-phase5-golive-measurements-2026-10-28.md`; giá list DigitalOcean đo 2026-10-28; dòng ngoài DO, buffer egress và storage không tính):

| Hình dạng | Phép tính | Tổng mỗi tháng |
| --- | --- | --- |
| 1. HA như DD-04 ghi (Standard có standby) | web 2 x $12.00 + discovery 2 x $12.00 + worker $10.00 + PG 2 GiB $30.45 + standby $30.45 | $118.90, đúng subtotal DD-04; khoảng $120-135 của DD-04 còn cộng KMS, R2 và log, egress (chưa kiểm lại) |
| 2. HA cho cluster MỚI sau luật Standard (Advanced) | web, discovery, worker $58.00 + 2 x $130.00 (nút Advanced nhỏ nhất, 8 GiB, 2 vCPU; standby cùng giá primary) | $318.00, chưa tính storage (Advanced $0.115/GiB/tháng) |
| 3. Nhỏ nhất, không HA, không discovery | web 1 x $12.00 + worker $10.00 + PG một nút 2 GiB $30.45 | $52.45 (PG 1 GiB cho $37.15 nhưng chỉ 22 backend connection) |
| 4. Staging tạm, 48-96 giờ, một cửa sổ mỗi tháng | tổng hình dạng 1 hoặc 2 x số giờ / 672 | trên hình dạng 1: $8.49-16.99; trên hình dạng 2: $22.71-45.43 |

Luật Standard (phát hiện (a) ở §2 của file research): từ 15/10/2026 với tài khoản mới và 30/11/2026 với mọi tài khoản, cluster Standard mới không có standby. Hình dạng 1 vì vậy chỉ còn khi tài khoản của owner không bị tính là mới và cluster được tạo trước 30/11/2026; mỗi cluster mới, kể cả staging tạm, theo luật tại ngày tạo. "Tài khoản mới = chưa từng tạo cluster PG hoặc MySQL" và "cluster đã có không bị ảnh hưởng" chỉ là search summary, chưa có trang chính thức; tài khoản của owner thuộc trường hợp nào: chưa biết.

## 6. Sizing và ước lượng wall-clock

<!-- TODO W3 -->

## 7. Thiết kế thực thi

<!-- TODO W3 -->

## 8. Việc chỉ owner làm (checklist owner, không xếp lịch cho agent)

Việc của owner (Ngoc-Anh), không giao agent, không nằm trong lịch agent ở §7; agent chỉ chuẩn bị FILE (lane ở §3) cho owner dùng. Thời gian chờ owner là tham số có tên `T_owner_*`, không đoán số; §6 cộng riêng với thời gian agent. Secret chỉ nêu bằng TÊN: giá trị chỉ owner nhập vào nơi lưu secret (encrypted env của App Platform, secret GitHub), không bao giờ vào repo, chat hay ghi chú. Số bước 8.0-8.11 là số §9 trích, không đánh lại.

| Bước | Ai | Làm gì | Chặn | Default | Chờ |
| --- | --- | --- | --- | --- | --- |
| 8.0 Duyệt plan | owner | đọc plan, trả lời hoặc override từng câu Q1-Q8 (§5), gửi tin nhắn viết "Phase 5 plan approved"; sau đó bước docs đầu tiên ghi mỗi câu trả lời thành một DD, kèm DD sửa phạm vi deploy của DD-132 | mọi lane L62-L78, mọi gate; B1, B2, B3 (§11) | không có: plan không tự gỡ DD-132 | `T_owner_approval` |
| 8.1 Tài khoản và billing | owner | mở tài khoản DigitalOcean (thanh toán, project vùng Singapore) và tạo tài nguyên theo tầng Q3 (cluster PostgreSQL, bật PITR); tài khoản backup ngoài DO và nơi giữ key backup (bản ghi §7.5 :269-277); AWS (KMS) chỉ khi Q8 = `aws-kms`; Cloudflare chỉ khi dùng | G2 trở đi; §7.6 mục 9; L77 chỉ khi Q8 cần | tầng Day-1 theo Q3; owner kiểm lại giá vào ngày mua | `T_owner_accounts` |
| 8.2 Domain và DNS | owner | mua hoặc xác nhận domain (Q4), trỏ DNS cho staging và production theo App Spec của L66, kiểm HTTPS đã cấp | G2, G4; giá trị `APP_BASE_URL`, `APP_DOMAIN`, `STAGING_BASE_URL`, `PRODUCTION_BASE_URL`; redirect URI ở 8.3 | Q4: `plexco.app` (USER-VISIBLE) | `T_owner_domain` |
| 8.3 OAuth Google và bot Zalo | owner | (a) tạo OAuth client Google cho từng môi trường, màn hình đồng ý, redirect URI `${APP_BASE_URL}/api/auth/google/callback` (`.env.example:108-110`); (b) tạo bot Zalo test, token chỉ owner giữ, dùng cho golden path staging, `zalo_dm` và nửa bot thật của bằng chứng error-mapping Zalo (L47 để lại template; báo cáo đóng Phase 4 §4); host CLB pilot tự nối bot của mình theo hướng dẫn L76 | G2 (đăng nhập thật thay dev-login, L74), G5 (`zalo_dm` cần token thật, runbook :15), G6 | Google là đường đăng nhập ở môi trường thật; `PLEXCO_DEV_LOGIN` không bao giờ đặt ngoài local | `T_owner_oauth_zalo` |
| 8.4 Email nhà cung cấp cho §7.1 | owner | gửi email đã soạn sẵn (`docs/archive/email-hoi-provider-2026-07-23.md`, bản #3 cho Zalo Bot; Meta chỉ khi Q6 đưa Messenger vào), lấy câu trả lời VIẾT có mã ticket, ngày, trích nguyên văn (bằng chứng lớp A theo tiêu chí §7.1), chuyển cho L62 | G1 và mọi gate sau; L66, L67 (`environments-setup.md:81`); Q7 nếu Zalo trả lời YES | tài liệu im lặng = `UNRESOLVED`, gate không qua (fail closed); SePay, ApiPay ngoài lần ra mắt đầu (DD-132) | `T_owner_vendor_reply` |
| 8.5 Nhập secret theo TÊN | owner | tạo user DB cho bốn role (§7.6 mục 4, bản ghi :286-287), đặt URL kết nối từng component, nhập secret và biến runtime, secret và biến GitHub (danh sách dưới bảng; manifest đủ là file của L64) | G2 (staging), G4 (production); §7.6 mục 4 | `KMS_PROVIDER` theo Q8; vắng `GENDER_COLLECTION_ENABLED` = tắt | `T_owner_secrets` (staging, production tính riêng) |
| 8.6 Duyệt và bấm deploy | owner | duyệt rồi bấm từng workflow deploy (chỉ `workflow_dispatch`, L67): staging trước, production chỉ sau G3; chạy smoke (`scripts/smoke-predeploy.mjs` với `SMOKE_BASE_URL`, L74) và golden path staging bằng tài khoản test đăng nhập thật, dữ liệu test tạo qua sản phẩm, không bao giờ dữ liệu production; production để `GENDER_COLLECTION_ENABLED` vắng hoặc `"false"` | G2, G4 | migration chạy bằng job một lần giữ riêng `DATABASE_URL_MIGRATION` (DD-129 default (1), xác nhận ở 8.9) | `T_owner_deploy` mỗi lần |
| 8.7 Drill §7.6 và budget alert | owner | chứng kiến trên staging các drill theo runbook L70: failover (mục 7), restore PITR (mục 9; $10-30 mỗi drill, bản ghi :278-279), bốn role DB (mục 4), SSE reconnect (8a), pg-boss không trùng (8b); đặt trong console budget alert hằng tháng cho compute, DB, transfer, log, backup, KMS (mục 14, bản ghi :298); gửi kết quả VIẾT để ghi bằng chứng G3 | G3, nên G4 trở đi | không có | `T_owner_drills` |
| 8.8 Bật projector | owner | bật từng projector bằng CLI của owner theo runbook (các dòng dưới bảng), staging trước, production sau G4 | G5, nên G6 | thứ tự giữa `web_realtime`, `public_sessions`, `zalo_dm`: runbook ở base không ghi; L71 đề xuất, owner duyệt khi merge L71 | `T_owner_projectors` |
| 8.9 MỘT lần xác nhận trước pilot | owner | xác nhận bằng văn bản một lần cho mọi default đang áp mà chưa được owner duyệt (danh sách dưới bảng): giữ, đổi, hoặc chặn | G6; các mục §7.6 hoãn ở G3 (mục 13 trước G4) | mỗi mục giữ default đang áp tới khi owner đổi | `T_owner_signoff` |
| 8.10 Pháp lý | owner (kèm luật sư nếu cần, A3) | trả lời tám điểm pháp lý (dưới bảng), rồi duyệt bản nháp trang quyền riêng tư và điều khoản của L75 trước khi publish | G6; publish L75; bật giới tính ở môi trường thật | giới tính tắt ở môi trường người dùng thật đầu tiên tới khi có câu trả lời (Q7 Phase 4, DD-141) | `T_owner_legal` |
| 8.11 Chọn và mời CLB pilot | owner | chọn CLB (Q5), mời host, gửi hướng dẫn L76, chốt ngày bắt đầu sau G1 PASS | G6, G7 | Q5: 2 CLB | `T_owner_pilot_invite` |

**8.5, tên cần nhập** (`.env.example` ở base, đối chiếu reader trong code; giá trị chỉ owner giữ):

- Runtime, trong encrypted env của App Platform (`.env.example:3`: production không dùng `.env`): `NODE_ENV`, `PORT`, `PROCESS_ROLE` (mỗi component một giá trị), `TRUSTED_INGRESS_PROVIDER` (`digitalocean`), `DATABASE_URL` (role app, pooled), `DATABASE_URL_DIRECT` (worker, role app_worker), `DISCOVERY_DATABASE_URL` (role readonly), `DISCOVERY_CURSOR_KEY`, `DB_EXPECTED_ROLE` (web `app`, discovery `readonly`, không đặt ở worker), `APP_BASE_URL`, `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `LINK_CODE_LOOKUP_HMAC_KEY` (web và worker cùng giá trị), `OUTBOX_DISPATCH_SCHEDULE_ENABLED` (worker), `CSP_SCRIPT_NONCE_ENABLED`, `GENDER_COLLECTION_ENABLED`, `LOG_LEVEL`; KMS theo Q8: `KMS_PROVIDER`, rồi `KMS_KEY_ID`, `KMS_ENCRYPTED_AUTH_PEPPER`, `AWS_REGION`, `KMS_ENCRYPTED_CONNECTOR_PEPPER` (tuỳ chọn) nếu `aws-kms`, hoặc `ENCRYPTION_KEY` nếu key local.
- Chỉ cho job `migrate` một lần, không bao giờ vào env runtime: `DATABASE_URL_MIGRATION` (`.env.example:78-82`).
- GitHub (hai workflow của #50; L67 đo lại): secret `DIGITALOCEAN_ACCESS_TOKEN`; biến `DOCR_REGISTRY`, `DO_VPC_ID`, `DO_APP_ID`, `STAGING_BASE_URL`, `APP_DOMAIN`, `PRODUCTION_BASE_URL`. Không secret runtime nào nằm ở GitHub (DD-129 default (2): secret chỉ nằm trong DO).
- Không nhập: `PLEXCO_DEV_LOGIN` (có mặt ngoài `NODE_ENV=development` thì app không boot); 10 tên chưa có reader ở base (`DATABASE_URL_LISTEN`, `FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET`, `MESSENGER_PAGE_ACCESS_TOKEN`, `MESSENGER_VERIFY_TOKEN`, `MESSENGER_APP_SECRET`, `SEPAY_WEBHOOK_SECRET`, `SESSION_SECRET`, `SENTRY_DSN`, `DRIZZLE_STUDIO_PORT`); `DATABASE_URL_TEST` và biến test.

**8.8, bật projector** (`docs/runbooks/outbox-dispatch-enable-rollback.md` ở base; `OWNER_SQL` ở :19 chỉ là dạng compose local, dạng staging và production do L71 viết):

1. Điều kiện (:22-31): DB đã migrate (:24-25); đã chạy `pnpm --filter @plexco/bot provision:queue`, preflight worker không có dòng `[preflight] FAILED` (:26); cả ba projector đang tắt (lệnh ở :27-30).
2. Worker chạy với `OUTBOX_DISPATCH_SCHEDULE_ENABLED=true`, khởi động lại bằng `pnpm --filter @plexco/bot start:worker`, log có `outbox dispatch schedule registered` và `[worker] outbox wake listening` (:35-36); `SELECT outbox_dispatch_schedule_live()` trả `t` trong 30 giây (:38-41).
3. Chờ backlog chưa ack về 0 (:44-47); nếu chưa, CLI tự từ chối bằng exit 2 `unacked_backlog`.
4. Mỗi projector: đặt `DATABASE_URL_MIGRATION` vào môi trường bằng `read -rs` như dòng :55 (credential không bao giờ nằm trên dòng lệnh), rồi `node scripts/outbox-projector-enable.mjs enable --projector <tên>` (:56). Không gọi thẳng `outbox_projector_set_enabled(<tên>, true)`, không migration, không sửa tay (:14); `zalo_dm` chỉ bật khi có token bot thật và module thật đã chạy trên mọi worker (:15).
5. Kiểm dòng JSON đầu ra (:65) và exit `0`, `2`, `1` (:66); số hết hạn theo lý do (:71); dòng `noop_expired` của `zalo_dm` (:80).
6. Rollback: tắt một projector bằng `outbox_projector_set_enabled('<tên>', false)` (:106-107); tắt hẳn dispatch: cờ `false` rồi khởi động lại worker (:114-115); DLQ bằng `scripts/outbox-dlq-replay.mjs` (:130-133).

**8.9, danh sách xác nhận trước pilot** (mỗi mục đang áp default; owner giữ, đổi hoặc chặn):

- Báo cáo đóng Phase 4 §3 (conductor quyết dưới uỷ quyền 2026-10-22), USER-VISIBLE: chuỗi UI mới conflict, timeout, replayed của L49 (RO-L49-2 Q1-Q4); bot bị thu hồi dùng lại cặp 400 `ZALO_TOKEN_INVALID` (L47 Q5, host thấy); copy xung đột ở `onboarding/club/route.ts` và `onboarding/zalo/connect/route.ts` (ngoài phạm vi L49, host thấy); khoảng trống guest của L40, R2a hay R2b (R2b được khuyên, cần thêm một migration; chỉ chặn nếu CLB pilot dùng guest).
- DD-129 (`docs/standards/decisions.md:144`, đóng băng, chưa được owner duyệt): (1) job `migrate` PRE_DEPLOY giữ riêng `DATABASE_URL_MIGRATION` (lệch với "protected CI job" ở `docs/standards/environments-setup.md:357`); (2) secret chỉ nằm trong DO; (3) deploy theo digest, promote không build lại; (4) staging `workflow_dispatch` với environment duyệt, production gõ xác nhận, không trigger `push`; (5) staging 1/1/1; (6) không thêm vendor error tracking, Sentry giữ backlog (lệch Sentry Developer Day-1 ở bản ghi :107); (7) log forwarder Logtail hay Papertrail; (8) RPO ≤ 15 phút, RTO ≤ 60 phút.
- Mục §7.6 hoãn (§9 G3): 5 nếu Q3 chọn một instance; 10 nếu Q8 chọn key local; 11 staging tạm dựng từ IaC, tự huỷ; 12 load test; 13 nửa migration của rehearsal ở provider khác (bản ghi :319 ghi "before production launch", nên phải xác nhận trước G4).
- Ngoài danh sách: 93 câu hỏi spec ở §5 của báo cáo đóng Phase 4 (dòng backlog `owner-questions-docs-spec-sync-dd138-dd142`) chưa phân loại; câu nào owner kéo vào đây thì câu đó chặn G6.

**8.10, tám điểm pháp lý** (`docs/sessions/web-mvp-phase3-readiness-p3-flags-default-on.md:253`, các điểm ở :257-264): (1) cơ sở pháp lý cho thu giới tính; (2) thời hạn lưu, và giới tính đã lưu khi đóng tài khoản; (3) tuyên bố về bên thứ ba, vendor, backup và giữ key; (4) đầu mối bảo vệ dữ liệu; (5) SLA xoá; (6) nơi đặt hosting; (7) giới tính có là dữ liệu nhạy cảm không; (8) có cần trang quyền riêng tư công khai hoặc luồng xem và thu hồi đồng ý không.

## 9. Gate go-live theo thứ tự

Thứ tự đúng như mục 3 của prompt Phase 5. Gate sau chỉ mở khi gate trước PASS; một lane merge không tự làm gate PASS, chỉ bằng chứng nêu dưới đây mới làm. "Bản ghi" = `docs/decisions/analysis/dd-04-hosting-final-decision.md`; danh sách nghiệm thu §7.6 có 14 mục (bản ghi :283-298, bản sao `docs/standards/environments-setup.md` §10 :462, các mục :467-481). Bước owner `8.x` là bước ở §8.

| Gate | Bằng chứng để PASS | Ai tạo bằng chứng | Chặn |
| --- | --- | --- | --- |
| G1 §7.1 egress verified (§7.6 mục 1, bản ghi :283) | mỗi dịch vụ outbound của lần ra mắt đầu (Zalo; Meta chỉ khi Q6 = vào) có hàng bằng chứng theo `docs/decisions/analysis/dd-04-egress-evidence-review-criteria.md` (URL, ngày truy cập, câu trích nguyên văn; câu trả lời viết, quy được về người trả lời, :46-47); trạng thái gate ở `environments-setup.md:66` rời `HALT-EVIDENCE_INCOMPLETE`; nếu Zalo cần IP outbound cố định thì Q7 đã chốt | L62 (trang chính thức); owner gửi email hoặc ticket cho vendor và chuyển câu trả lời viết (bước 8.4) | L66 (`environments-setup.md:81`: chưa đóng gate thì chưa tạo App Spec), G2 |
| G2 staging up và golden path staging PASS | L64, L65, L66, L67, L69, L74 đã merge; owner đã nhập mọi secret staging theo tên (8.5) và bấm `workflow_dispatch` của workflow staging (8.6); run deploy xanh; smoke `SMOKE_BASE_URL` (L74) xanh trên URL staging; golden path staging (L74) PASS bằng tài khoản test và dữ liệu test tạo qua sản phẩm, không bao giờ dữ liệu production; log run được lưu | L64-L67, L69, L74 (file); owner (secret, trigger, chạy smoke và golden path trên staging, 8.6) | G3; nửa đo của L78 (cần Managed PG thật) |
| G3 nghiệm thu §7.6 trên staging | 6 mục prompt nêu (bảng dưới) PASS, rồi 8 mục còn lại PASS hoặc được hoãn kèm sign-off của owner (8.9) | L63, L66, L69, L70, L72, L73 (runbook, file); owner chạy và chứng kiến mọi drill (8.7) | G4 |
| G4 production up, giới tính tắt | G3 PASS; owner nhập secret production (8.5) và bấm `workflow_dispatch` của workflow production (8.6); App Spec production ghi `GENDER_COLLECTION_ENABLED: "false"` (L66; DD-150 Q7, DD-141) và owner kiểm giá trị đó trên app đang chạy; smoke production xanh; domain và TLS theo Q4 chạy; §7.6 mục 2 kiểm trên production | L66, L67 (file); owner (secret, trigger, kiểm) | G5 |
| G5 projector bật | owner chạy CLI `scripts/outbox-projector-enable.mjs` theo thứ tự của runbook staging/production (L71, thứ tự owner duyệt), mỗi bước kiểm của runbook PASS, đường rollback của runbook đã biết; hạn 60 phút của `zalo_dm` (DD-146) giữ nguyên | L71 (runbook); owner chạy (8.8) | G6 |
| G6 pilot với 1-2 CLB | owner đã xác nhận bằng văn bản bước sign-off trước pilot (8.9); tám điểm pháp lý đã trả lời và trang quyền riêng tư, điều khoản (L75) chỉ publish sau đó (8.10); hướng dẫn host (L76) đã merge; CLB đã chọn và mời theo Q5 (8.11); form go/no-go (`docs/runbooks/go-no-go-template.md`, L69) owner điền và xác nhận | L69, L75, L76 (file); owner (pháp lý, chọn CLB, go/no-go) | G7 |
| G7 review | hết cửa sổ pilot (Q5): ghi chú review có sự cố, lỗi và log, chi phí so với budget alert, kế hoạch cho các mục §7.6 đã hoãn, quyết định mở rộng, giữ hay rollback | owner quyết; bản nháp do một phiên docs sau pilot soạn (không phải lane của plan này) | mở rộng quá pilot |

**G3, sáu mục prompt nêu** (khớp bản rút gọn của entry, `docs/standards/decisions.md:235`):

| Mục §7.6 (dòng bản ghi) | Bằng chứng để PASS | Ai |
| --- | --- | --- |
| 7 drill failover (:290) | DB failover tự động trên staging, app nối lại; form bằng chứng của runbook `failover-drill.md` (L70) | owner kích hoạt và chứng kiến; L70 viết runbook |
| 9 drill restore PITR (:292) | restore PITR và restore ra ngoài DO đo được RPO và RTO, đối soát xong (bản ghi :276-277); form của `pitr-restore-drill.md` (L70) | owner chạy trong DO, giữ tài khoản offsite và key backup (8.1); L70 |
| 4 bốn role DB (:286-287) | `app`, `app_worker`, `readonly` (`packages/db/migrations/0000_roles_extensions.sql:23`, `:26`, `:29`) và `migration` (`environments-setup.md:156`, chỉ job deploy); URL pooled, direct, listener đi đường private với TLS kiểm CA và hostname | owner tạo user DB và nhập URL làm secret theo component (8.5), chứng kiến bước kiểm của L70; L78 nếu kiểm CA cần đổi code |
| 8a SSE reconnect (:291) | listener SSE đăng ký lại sau drill failover | owner chứng kiến trong drill của L70 |
| 8b pg-boss không trùng (:291) | worker chạy lại không tạo mutation tiền trùng: query đối soát chỉ đọc của L70 trên ledger và allocation trả 0 dòng trùng | owner chạy query chỉ đọc; L70 |
| 14 budget alert (:298) | alert hằng tháng cho compute, DB, transfer, log, backup, KMS đã đặt; ngưỡng là tham số owner chọn | owner đặt trong console billing (8.7); L63 viết mục budget alert |

**G3, tám mục còn lại** (mục 1 là G1), mỗi mục một chỗ:

| Mục §7.6 (dòng bản ghi) | Đặt ở | Bằng chứng hoặc lý do hoãn |
| --- | --- | --- |
| 2 App Platform `sgp` trên VPC `sgp1` (:284) | G2 cho staging, G4 cho production | App Spec của L66; owner tạo app; nếu Zalo cần IP cố định thì cách giải xung đột VPC với dedicated egress IP theo Q7 |
| 3 trusted sources của PG chỉ có app (:285) | G3 | owner đặt trong DO, bước kiểm của L70 PASS |
| 5 `web` và `discovery` hai instance, health check, deploy cuốn (:288) | G3 | `health_check` và số instance trong App Spec (L66, theo Q3), bước kiểm của L69; owner kích hoạt và chứng kiến. Q3 chọn bậc một instance ⇒ hoãn, sign-off 8.9 |
| 6 cách ly discovery: pool cap, timeout, rate limit, cache, circuit breaker (:289) | G3 | L73 (circuit breaker, pool cap), L72 (rate limit, header); owner đặt luật rate limit Cloudflare (bản ghi :106) nếu dùng Cloudflare |
| 10 KMS envelope, xoay key, đường degraded và fail-closed (:293) | input ở G2, test ở G3 | staging cần key root (`packages/db/src/secret-key-root.ts:41-42`) nên input Q8 phải có trước G2; test của L77 nếu input cần đổi code; Q8 = key local ⇒ hoãn, sign-off 8.9 |
| 11 staging tạm dựng từ IaC, tự huỷ theo TTL (:294) | hoãn | dòng `staging-ttl-teardown-automation` (:5892) chờ staging chạy lần đầu; tới lúc đó owner tự xoá staging khi hết cửa sổ staging (Q3); sign-off 8.9 |
| 12 load test (:295-296) | hoãn tới trước khi mở rộng quá pilot (G7) | §3 không có lane load test; pilot 1-2 CLB; sign-off 8.9 |
| 13 rehearsal ở provider khác theo §7.4, có rollback (:297) | G3 cho phần restore, phần migration hoãn | L70 có restore ra ngoài DO; chưa lane nào viết runbook rehearsal §7.4 đủ (bản ghi :225-261); bản ghi :319 ghi "before production launch", nên hoãn phần migration là ngoại lệ owner phải xác nhận bằng văn bản (8.9) |

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
