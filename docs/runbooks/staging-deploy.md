# Runbook: deploy staging (DigitalOcean App Platform)

## 0. Phạm vi, nguồn, trạng thái

- **Trạng thái:** `PREPARED, NOT RUN` (WS:8-9): chưa app nào được tạo, chưa deploy gì, runbook này chưa chạy lần nào (§9).
- **Thẩm quyền:** E §6 (:401-434), §9 (:486-498), §10 (:502-516); PLAN bước 8.1, 8.2, 8.5, 8.6 (:197-202); DD-154 (`docs/standards/decisions.md:122`, entry ở :1846: owner duyệt plan Phase 5, Q1, Q2, Q4-Q10 theo default, Q3 override). Code: `infra/app.staging.yaml`, `infra/app.prod.yaml`, `infra/render-app-spec.sh`, WS, WP.
- **Ai làm:** mọi bước DigitalOcean hay GitHub là của owner và mang nhãn [Owner]; agent chỉ chuẩn bị file (PLAN:192), không có bước nào cho agent trên môi trường thật. Giá trị secret chỉ owner nhập, vào encrypted env của App Platform hoặc secret GitHub, không bao giờ vào repo, chat hay ghi chú (PLAN:192); runbook chỉ nêu TÊN.
- **Nhãn:** UNPINNED = dạng chính thức của bước chưa được trích, kèm phép kiểm của nó (tiền lệ O:196). Default của lane ghi "default applied, pending owner sign-off"; ruling RO-L69-2 ghi "decided by the conductor under the owner's delegation of 2026-10-22, not an owner signature".
- **Viết tắt:** WS = `.github/workflows/deploy-staging.yml`, WP = `.github/workflows/deploy-production.yml`, R = `infra/render-app-spec.sh`, M = `docs/runbooks/env-manifest-staging-production.md`, E = `docs/standards/environments-setup.md`, PLAN = `docs/sessions/web-mvp-phase5-golive-plan.md`, O = `docs/runbooks/outbox-dispatch-enable-rollback.md`. Runbook cùng thư mục: MR = migration-on-deploy-and-rollback.md (migration khi deploy, rollback), GNG = go-no-go-template.md (form go/no-go). F1-F6 = trang chính thức đọc ngày 2026-10-30, trích nguyên văn ở `docs/sessions/web-mvp-phase5-readiness-p5-runbook-deploy-migration-rollback.md` §2.

## 1. Mô hình

- Workflow `Deploy staging` chỉ chạy tay (`workflow_dispatch`, không trigger push hay tag): staging là môi trường tạm, TTL 48-96 h; deploy tự động sẽ giữ một môi trường dáng production và hoá đơn của nó sống ngoài ý muốn (WS:11-12).
- Cả hai input rỗng thì job `staging` chạy (WS:57-58): kiểm CI xanh trên đúng commit, build và push một image (tag = SHA, deploy theo digest), render spec (spec commit + secret live + digest), reconcile app, job `PRE_DEPLOY` `migrate` chạy trước (migration rồi provision queue, M:23-24), chờ deployment mang digest đó `ACTIVE`, smoke, upload artifact `deployment-evidence-staging`. Tên step nguyên văn và bằng chứng: §4. Có `rollback_deployment_id` thì job `rollback` chạy: MR.
- Một đường migration: job `PRE_DEPLOY` `migrate`; `DATABASE_URL_MIGRATION` chỉ nằm ở job đó, không ở GitHub, không ở component runtime (WS:20-26; M:71; E:433-434); chi tiết: MR §1.
- Topology: M E2 (M:14-24): staging `web` 2, `discovery` 2, `worker` 1; production `web` 1, `worker` 1, không `discovery` (DD-154, Q3). Không secret runtime nào vào GitHub; GitHub chỉ giữ secret `DIGITALOCEAN_ACCESS_TOKEN` (M:79, :83).

## 2. Owner setup một lần

Mỗi mục: ai làm, nguồn, bằng chứng. Thứ tự 2.1 tới 2.5; 2.6 và 2.7 nằm trong 2.5 (thời điểm ghi ở từng mục). Tên và id tài nguyên ghi ở GNG, không ghi trong runbook.

### 2.1 Tài khoản, VPC, registry, PostgreSQL

[Owner] Tài khoản, billing và project vùng Singapore; VPC `sgp1` (E:511); container registry (tên của nó là giá trị `DOCR_REGISTRY`, M:84); Managed PostgreSQL 16 trở lên ("never provision DO PG < 16", `docs/sessions/2026-10-14-web-mvp-program-handoff.md:92`), bật PITR, tầng theo Q3 (PLAN:197; DD-154: production hình dạng 3, drill failover trên cửa sổ staging hình dạng 4). UNPINNED: đường đi trong Control Panel cho từng tài nguyên; kiểm: GNG có tên và id từng tài nguyên, và `SHOW server_version` của lệnh kiểm role (O:181, :184) in ra 16 trở lên. Bằng chứng: các dòng đó ở GNG.

### 2.2 Domain và DNS

[Owner] Domain theo Q4, `plexco.app` (PLAN:198), chọn host trước 2.5 bước (3). Host staging là subdomain của `plexco.app` có label đầu bắt đầu bằng `staging`, sai thì step 2 dừng với `APP_DOMAIN is not a staging*.plexco.app host` (WS:131); host production đúng `plexco.app` (WP:123-125). Giá trị `APP_DOMAIN`, `STAGING_BASE_URL`, `PRODUCTION_BASE_URL`: M:87-89. UNPINNED: bản ghi DNS và nơi tạo; kiểm: HTTPS đã cấp, tức step `5. Smoke (/healthz, landing, manifest)` xanh trên `STAGING_BASE_URL` mà host là `APP_DOMAIN` (WS:154). Bằng chứng: run đó (§4).

### 2.3 User DB và setup role

[Owner] User DB cho bốn role `app`, `app_worker`, `readonly`, `migration` (M:16) và setup role theo MR §2, làm ở đây, trước lần deploy đầu (PLAN:201, bước 8.5). User trước, deploy sau là an toàn với migrator: role đã có thì giữ nguyên, không tạo lại (`packages/db/src/migrate.ts:258-281`). Bằng chứng: các phép kiểm của MR §2.

### 2.4 GitHub environment

[Owner] Hai environment `staging` và `production` (F5): `Settings`, `Environments`, `New environment`, đặt tên, `Configure environment`. Chọn `Required reviewers`, nhập owner; KHÔNG chọn `Prevent self-review`: owner là reviewer bắt buộc duy nhất và cũng bấm mọi run, mà theo F5 (6.3) tuỳ chọn này chặn người duyệt run do chính họ kích hoạt, nên sẽ chặn mọi run (default applied, pending owner sign-off); rồi `Save protection rules`. Dropdown `Deployment branches`: `Selected branches and tags`, `Add deployment branch or tag rule`, `Ref type` `Branch`, name pattern `main`, `Add rule`, cho cả hai environment (`docs/sessions/2026-10-14-web-mvp-program-handoff.md:92`; SR1-4 ở `docs/sessions/web-mvp-phase5-readiness-p5-deploy-workflows.md:152`). Rồi `Environment secrets` (`Add secret`) và `Environment variables` (`Add variable`), quy tắc giá trị theo M E5 (M:77-96):

- `staging`: secret `DIGITALOCEAN_ACCESS_TOKEN`; variable `DOCR_REGISTRY`, `DO_VPC_ID`, `APP_DOMAIN`, `STAGING_BASE_URL`, `KEY_ROOT`; `DO_APP_ID` chỉ đặt ở 2.5 bước (6) (WS:88, :106, :125-128, :152-153, :179, :185).
- `production`: như staging nhưng không có `DOCR_REGISTRY` (WP không đọc tên này) và có `PRODUCTION_BASE_URL` thay `STAGING_BASE_URL` (WP:108, :119-122, :146-147).
- `KEY_ROOT`: variable riêng của từng environment, đúng `aws-kms` hoặc `local`, không có default; owner đặt ở bước 8.5 theo luật K1 (2.5), DD-158. Từ khi thay đổi này được merge, MỌI run deploy cần nó: thiếu hoặc sai giá trị thì step render dừng ngay ở kiểm đầu vào (R:35, :40), trước mọi update.

Bằng chứng: thiết lập của hai environment ghi ở GNG §5.

### 2.5 Tạo app lần đầu

Workflow chỉ update một app đã có (WS:126, :133, :141). Spec commit mang placeholder `__VPC_ID__` (`infra/app.staging.yaml:30`; `infra/app.prod.yaml:31`), `__IMAGE_DIGEST__` (`infra/app.staging.yaml:75`, :92, :195, :250; `infra/app.prod.yaml:62`, :79, :183), `__APP_DOMAIN__` (header hai spec, :5-6) và `__KMS_PROVIDER__` (`infra/app.staging.yaml:143`, :278; `infra/app.prod.yaml:130`, :211), mà R, nơi duy nhất điền chúng, cần một app live (R:8, :32, :68). Vì vậy lần tạo đầu là chuỗi bước chỉ của owner dưới đây, không đổi code (RO-L69-2 ruling 1, decided by the conductor under the owner's delegation of 2026-10-22, not an owner signature; default applied, pending owner sign-off). Thứ tự: tạo app, nhập mọi giá trị SECRET, đặt `DO_APP_ID`, run bình thường đầu tiên.

**Luật K1, root key (DD-158).** Owner chọn root key MỘT lần cho mỗi environment ở bước 8.5, trước dữ liệu thật đầu tiên (lần đăng nhập Google đầu tiên, lần connect Zalo đầu tiên, giá trị gender đầu tiên): `aws-kms` (khuyến nghị) hoặc key local (lựa chọn production được phép, mức bảo vệ thấp hơn, cần sign-off của owner ở bước 8.9, GNG). `KEY_ROOT` (2.4) và `KMS_PROVIDER` của bản sao tạo app phải bằng nhau: R từ chối render khi khác (R:96-103). Sau đó không bao giờ đổi `KEY_ROOT`, `KMS_PROVIDER`, `KMS_KEY_ID`, giá trị `ENCRYPTION_KEY` hay một KMS pepper: ciphertext đã lưu không mở được nữa, auth hash không còn khớp, mọi CLB phải connect lại; đổi root còn xoá giá trị live của tập kia ở deploy kế tiếp (suy luận từ update = replace, chưa đo). Không bao giờ đổi root bằng cách sửa variable hay secret: đổi về sau cần lane riêng (đường mã hoá lại). Một cửa sổ staging tạm có thể chọn lại, với dữ liệu mới. Việc của owner ở bước 8.5, không bao giờ của agent: đặt `KEY_ROOT`; khi chọn local, sinh `ENCRYPTION_KEY` trên máy owner (`openssl rand -base64 32`), MỘT giá trị cho cả `web` và `worker`, và giữ một bản offline TRƯỚC khi nhập (DigitalOcean có cho đọc lại giá trị đã mã hoá hay không: not re-checked). Khuyến nghị cùng một root ở staging và production, không thì staging không chạy đường key của production. Khi chọn local, sign-off của owner ở bước 8.9 ghi: root nằm trong secret của app, MỘT root phủ auth, PII và secret connector (K2), §7.6 mục 10 hoãn, không có đường xoay key.

**Staging**

- (1) [Owner] Đặt variable và secret của environment `staging` theo 2.4, để trống `DO_APP_ID`.
- (2) [Owner] "Run workflow" `Deploy staging` một lần (§4 bước 1-2). Step `1. Build and push the image once (tag = git SHA; the DIGEST is what gets deployed)` push image (WS:95-106) và `Record deployment evidence` ghi `image_digest`, `git_sha` (WS:108-120); rồi run dừng ở step `2. Render the spec (committed spec + live secrets + this digest)` THEO THIẾT KẾ, vì chưa có app (`doctl apps spec get "$APP_ID"`, WS:132), và artifact `deployment-evidence-staging` vẫn upload (`if: always()`, WS:157-163). Đây là suy luận từ các dòng đó, chưa chạy lần nào (WS:8-9). Run đỏ này là điểm dừng tạo lần đầu, chỉ được có một lần; dừng ở step khác, hoặc ở kiểm `APP_DOMAIN is not a staging*.plexco.app host` (WS:131), là lỗi cần sửa, không phải điểm dừng này. Owner tải artifact, ghi `image_digest` và `git_sha` vào GNG.
- (3) [Owner] Trên máy owner, viết bản sao để tạo app: tầng đầu của header R, `yq -o=json infra/app.staging.yaml` (R:4), ghi vào `spec.local.json` (R:6; .gitignore dòng 86 bỏ qua tên này ở mọi độ sâu, kiểm: `git check-ignore spec.local.json` in ra tên file) hoặc vào một file ngoài repository. Thay mọi `__IMAGE_DIGEST__` bằng `image_digest` đó (dạng `sha256:<64 hex>`, R:38), `__VPC_ID__` bằng giá trị `DO_VPC_ID` (một UUID, R:39; M:85; WS:125), `__APP_DOMAIN__` bằng host `APP_DOMAIN` (một hostname, R:42, qua mẫu của WS:132), `__KMS_PROVIDER__` (ở `web` và `worker`) bằng `KEY_ROOT` của environment này (`aws-kms` hoặc `local`, R:40; luật K1); kiểm không còn token nào trong bốn token đó. Mọi `SECRET` giữ không có giá trị như bản commit (R:81 từ chối `SECRET` commit có giá trị), kể cả SECRET của cả hai tập root, nên bản sao không chứa giá trị secret nào; không bao giờ commit bản sao (RO-L69-2 ruling 1 (b)).
- (4) [Owner] Chạy `doctl apps create --spec <creation-copy> --format ID` (F1: `--spec`, `--format`, `ID`), với `<creation-copy>` là bản sao của bước (3); ghi id app mới vào GNG; xoá bản sao. Lệnh từ chối một entry `SECRET` không có giá trị (official reference đọc ngày 2026-10-30 không nói, F3) thì dừng: chưa có app nào, không đưa giá trị nào vào bản sao, và báo conductor để đưa quyết định lên owner. UNPINNED: cách `doctl` đăng nhập trên máy owner; kiểm: lệnh in ra một `ID`.
- (5) [Owner] Nhập giá trị SECRET (tên theo M E3 và E4; URL kết nối: 2.7) của các tên chung và CHỈ của tập root đã chọn (hậu tố (aws) hoặc (local) ở M E3); SECRET của tập kia để trống: run bình thường đầu tiên bỏ tập đó khỏi spec trước mọi kiểm secret (R:61-62, :83). Nhập chỉ trong Control Panel (F2): tab `Settings` của app, mục `Environment Variables` của từng component, `Edit`, `Value` của key, `Encrypt`, `Save`. Cách nhập giá trị cho một key app đã có nhưng chưa có giá trị thì official reference đọc ngày 2026-10-30 không nói (F2): owner điền `Value` của key đó với `Encrypt`, hoặc nếu Control Panel không hiện key đó thì thêm bằng `Add environment variable`, tên trong M làm `Key`. Render ở bước (7) là phép kiểm cho cả hai đường: nó dừng trước mọi update với mỗi SECRET mà app live thiếu hoặc giữ không mã hoá (R:108-110: `render: missing secret in live app:` ... `- set it in DO first`; `render: live secret is not an EV ciphertext:`).
- (6) [Owner] Đặt `DO_APP_ID` của environment `staging` bằng id app mới (WS:126).
- (7) [Owner] "Run workflow" `Deploy staging` cho một commit `main` MỚI HƠN `git_sha` của bước (2): đường bình thường, render (WS:132-133), update (WS:140), job `PRE_DEPLOY` `migrate` (WS:137), wait (WS:145), smoke (WS:155).

**Điểm fail closed**

- (i) Official reference đọc ngày 2026-10-30 không nói việc tạo app (bước (4); F1, F3) hay `Save` một biến (F2) có khởi động deployment không. Vì vậy mọi deployment giữa bước (4) và bước (7) chạy trước khi đủ giá trị SECRET và không bao giờ là pass, dù trạng thái của nó là gì; pass chỉ là run bình thường ở bước (7).
- (ii) Nếu bước (4) hoặc (5) deploy digest của bước (2), run bước (7) của cùng commit có thể gặp deployment trước đó cùng digest (wait chọn theo digest, WS:145; dòng backlog về cách chọn deployment của `infra/wait-for-deployment.sh`, `docs/sessions/web-mvp-phase5-readiness-p5-deploy-workflows.md:175`). Vì vậy bước (7) chạy cho một commit `main` mới hơn (digest mới, như §8), và owner so `image_digest` của bước (7) với của bước (2): bằng nhau thì bước (7) không phải pass, dù màu gì, và owner dispatch lại cho một commit `main` mới hơn nữa.
- (iii) Commit `main` mới hơn mà bước (7) và điểm (ii) cần là thay đổi kế tiếp được merge vào `main`; chưa có commit đó thì bước (7) chưa pass và hàng "Tạo app lần đầu" ở GNG §4 giữ No-Go.

**Production**

Cùng chuỗi bước với `infra/app.prod.yaml` và digest lấy từ bằng chứng staging (RO-L69-2 ruling 1), chỉ chạy sau khi điều kiện trước của MR §4 đúng (G3 PASS và "go" ở GNG), vì chính việc tạo app và nhập giá trị có thể deploy (official reference đọc ngày 2026-10-30 không nói, F1-F3), trên host `plexco.app` (WP:123-125).

- (1) [Owner] Variable và secret của environment `production` theo 2.4, để trống `DO_APP_ID`.
- (2) [Owner] Không chạy production trước khi tạo app: digest là `image_digest` của một run `Deploy staging` thành công, đúng bằng chứng WP đòi (WP:90-104); ghi id, `git_sha` và `image_digest` của run đó vào GNG.
- (3) [Owner] Bản sao từ `yq -o=json infra/app.prod.yaml` (WP:128): mọi `__IMAGE_DIGEST__` là digest đó, `__VPC_ID__` là `DO_VPC_ID` của production (WP:119), `__APP_DOMAIN__` là `plexco.app`, `__KMS_PROVIDER__` là `KEY_ROOT` của production (luật K1).
- (4)-(6) [Owner] Như staging, cho app và environment production.
- (7) [Owner] Run `Deploy production` theo MR §4 với `tag` và `digest` (WP:87, :118) của một run `Deploy staging` thành công cho commit `main` MỚI HƠN commit của bước (2); trước khi dispatch, owner kiểm digest đó khác digest lúc tạo (điểm (ii); WP không build gì, WP:110); pass chỉ là run đó (điểm (i)).

Bằng chứng: artifact của bước (2) và id của từng app ở GNG; step `2. Render the spec (committed spec + live secrets + this digest)` qua ở run bình thường đầu tiên.

### 2.6 Trusted sources

[Owner] Trusted sources của PostgreSQL chỉ có app (PLAN:264; E:512); nguồn tạm của owner (ví dụ cho 2.3) được ghi lại lúc thêm và gỡ khi xong (O:176). Nếu danh sách đã có mục nào trước khi app tồn tại, thêm app ngay sau 2.5 bước (4), trước bước (7): job `migrate` của bước (7) kết nối từ app (WS:20-22). UNPINNED: đường đi trong Control Panel; kiểm: danh sách đọc lại chỉ còn app. Bằng chứng: danh sách đó ở GNG.

### 2.7 URL kết nối

[Owner] URL kết nối từng component, nhập ở 2.5 bước (5): M hàng 4 (`DATABASE_URL`, role `app`), hàng 5 (`DATABASE_URL_DIRECT`, role `app_worker`), hàng 8 (`DISCOVERY_DATABASE_URL`, role `readonly`) và E4 (`DATABASE_URL_MIGRATION`, role `migration`, chỉ ở job `migrate`). Bằng chứng: §4 step `5. Smoke (/healthz, landing, manifest)` xanh.

## 3. Biến và secret theo TÊN

Nguồn duy nhất cho tên, component, môi trường và quy tắc giá trị là M: E3 biến runtime (M:26-67), E4 job `migrate` (M:69-75), E5 GitHub và tooling (M:77-95), E6 không bao giờ đặt (M:97-106), E7 không nhập (M:108-115). Runbook này không chép bảng nào; tên nào lệch giữa M và runbook thì theo M.

## 4. Chạy deploy staging (bước 8.6)

Điều kiện trước: điều kiện O-6 đã đóng theo Q10 TRƯỚC lần deploy staging đầu tiên (L73 đã merge nếu (i), luật ingress đã đặt nếu (ii), bề mặt discovery bị chặn nếu (iii); PLAN:202); các lane G2 đòi đã merge (PLAN:241); §2 xong.

1. [Owner] "Run workflow" `Deploy staging` trên `main`: chú thích WS:14-16 còn nhắc ô chọn branch, tag hay commit, nhưng rule `Deployment branches` của environment (2.4) chỉ nhận `main`. Để trống `rollback_deployment_id` và `confirm`, nên job `staging` chạy (WS:57-58).
2. [Owner] Duyệt environment `staging`: mỗi run cần một lần duyệt của owner (WS:13).
3. [Owner] Đọc log từng step (tên nguyên văn) và bằng chứng:
   - `Resolve commit` (WS:70): SHA của commit, in ra ở step sau.
   - `Require green CI on this exact commit` (WS:73): kết luận của `verify` và `e2e-web` trên SHA đó, mỗi cái `success` (WS:82-83).
   - `Log in to DOCR (short-lived)` (WS:90).
   - `1. Build and push the image once (tag = git SHA; the DIGEST is what gets deployed)` (WS:95).
   - `Record deployment evidence` (WS:108): JSON bằng chứng (WS:120) có `git_sha`, `image_digest`, `run_url` (WS:118).
   - `2. Render the spec (committed spec + live secrets + this digest)` (WS:122): in name, region và digest từng component, không bao giờ in spec (WS:134-135); mọi digest bằng `image_digest`.
   - `3. Reconcile the app (creates the deployment; the PRE_DEPLOY migrate job runs first)` (WS:137): log của job `migrate` kiểm theo MR §1.
   - `4. Wait for the deployment carrying this digest to be ACTIVE` (WS:142).
   - `5. Smoke (/healthz, landing, manifest)` (WS:147).
   - Artifact `deployment-evidence-staging` (WS:160; field ở WS:118; giữ 90 ngày, WS:163).
4. [Owner] Run đỏ: đọc step đỏ; job `migrate` lỗi: MR §3. Run xanh: smoke của owner (`scripts/smoke-predeploy.mjs` với `SMOKE_BASE_URL`) và golden path staging bằng tài khoản test đăng nhập thật, dữ liệu test tạo qua sản phẩm (PLAN:202, lane L74; tên ở M:87-93).

Bằng chứng vào GNG §4: run URL và artifact.

## 5. Log

- [Owner] Log của component (F6): `doctl apps logs <app id> web --type run`, với `<app id>` là giá trị `DO_APP_ID` và component là `web`, `discovery` hay `worker`; `--type` nhận `build`, `deploy`, `run`, `run_restarted`, `autoscale_event` (mặc định `run`), `--deployment` chọn deployment (mặc định deployment hiện tại).
- [Owner] Log của job `migrate`: UNPINNED. F6 không nói log của job `PRE_DEPLOY` đọc qua `--job-invocation` hay là log `deploy` của component, cũng không nói cách tìm id invocation hay đường đi trong Control Panel; kiểm: các dòng log của job theo MR §1.
- Field JSON (`apps/web/lib/log.ts:132-140`): mỗi dòng là một object JSON có `level`, `event`, `request_id`, `tenant_id` (`tenant_id` chỉ khi tenant đã được chứng minh, :10); giá trị bị redact theo tên key thành `[redacted]` (:91).
- [Owner] Forward log: Logtail hoặc Papertrail (DD-129 (7)); error reporting: không thêm vendor error tracking, Sentry ở backlog, `SENTRY_DSN` không nhập (DD-129 (6); M:110); cả hai: default applied, pending owner sign-off (PLAN:228). UNPINNED: cách nối forwarder vào app; kiểm: một dòng log có `event` của `web` hiện ở vendor đã chọn.
- Alert khai trong spec (chỉ trỏ): mức app `DEPLOYMENT_FAILED`, `DOMAIN_FAILED` (`infra/app.staging.yaml:62-64`; `infra/app.prod.yaml:49-51`); mức component `CPU_UTILIZATION`, `MEM_UTILIZATION`, `RESTART_COUNT` trên `web`, `discovery`, `worker` của staging (`infra/app.staging.yaml:102-111`, :205-214, :253-262) và trên `web`, `worker` của production (`infra/app.prod.yaml:89-100`, :186-197).

## 6. Production

[Owner] Promote không build, điều kiện trước (G3 PASS, "go" ở GNG) và rollback: MR §4 và §5. Tạo app production lần đầu: 2.5.

## 7. Teardown và TTL

- TTL 48-96 h (WS:11; E §9). Lúc tạo, ghi owner, mục đích, `expires_at` và trần chi phí vào GNG (E:488).
- Chưa có automation: mục 11 của §7.6 hoãn; owner tự xoá staging khi hết cửa sổ (PLAN:268; dòng backlog `staging-ttl-teardown-automation`, `infra/app.staging.yaml:25`).
- [Owner] Hết cửa sổ: xoá app, database và VPC, thu hồi credential tạm (E:494). UNPINNED: đường đi trong Control Panel và lệnh xoá; kiểm: project không còn app, database hay VPC của staging, và credential tạm không còn dùng được. E:495 đòi báo động và fail closed khi xoá không xong; chưa có automation đó, nên owner tự kiểm.

## 8. Kiểm deploy cuốn hai instance (§7.6 mục 5)

Bước kiểm của L69 (PLAN:265; E:514), default applied, pending owner sign-off. Staging chạy `web` 2 và `discovery` 2 (M:20-21; `infra/app.staging.yaml:94`, :197).

1. [Owner] Khi deployment trước đang `ACTIVE`, "Run workflow" `Deploy staging` cho một commit `main` MỚI HƠN: digest mới, nên bước wait (chọn theo digest, WS:145) không lẫn hai deployment.
2. [Owner] Từ máy owner, chạy lặp lại lệnh dưới (dạng của WS:155) từ lúc step `3. Reconcile the app (creates the deployment; the PRE_DEPLOY migrate job runs first)` bắt đầu tới khi step `5. Smoke (/healthz, landing, manifest)` xanh, giữ mọi output.

```bash
# [Owner] on the owner's machine; STAGING_BASE_URL holds the staging base URL (the GitHub variable's value)
infra/smoke-check.sh "$STAGING_BASE_URL"
```

PASS: mọi lần smoke xanh và run xanh. Bằng chứng: run URL và log smoke của owner, ghi ở GNG. Production chạy một `web` (M:20), nên kiểm này chỉ ở staging; mục 5 của production chờ cùng 8.9 (PLAN:265).

## 9. Chưa kiểm chứng

- `PREPARED, NOT RUN` (WS:8-9): chưa app nào được tạo, chưa deploy gì; `doctl apps spec validate` chưa chạy (việc của [Owner], cần đăng nhập DigitalOcean, E:440).
- R chỉ được test trong CI với tên key thật và giá trị giả (ciphertext, host, digest, VPC id giả), chưa chạy với app live (E:441).
- Runbook này chưa chạy: điểm dừng tạo lần đầu (2.5 bước (2)) là suy luận từ dòng của WS, và mọi bước UNPINNED (2.1, 2.2, 2.5 bước (4), 2.6, §5, §7) chưa đo.
- Tạo app hay `Save` một biến có khởi động deployment không: F1-F3 không nói (2.5, điểm (i)).
- Lỗi deploy chưa đo, ví dụ job `migrate` lỗi: runbook chỉ khẳng định "the new deployment does not become active", không hơn (MR §3).
