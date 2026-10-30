# Runbook: migration khi deploy và rollback (DigitalOcean App Platform)

## 0. Phạm vi, nguồn, trạng thái

- **Phạm vi:** migration khi deploy và rollback app trên DigitalOcean App Platform, cho staging và production. Runbook gồm job `migrate` (`PRE_DEPLOY`) chạy mỗi lần deploy (§1), chuẩn bị role một lần trước deploy đầu tiên (§2), migration lỗi (§3), promote production (§4), rollback app bằng job `rollback` của mỗi workflow (§5) và phần chưa kiểm chứng (§6). Các bước chạy deploy staging nằm ở `docs/runbooks/staging-deploy.md` §4; runbook này không chép lại.
- **Trạng thái:** E:436 ghi các file của lane L66 là "files prepared, not applied"; runbook này chưa chạy lần nào, trên staging hay production.
- **Thẩm quyền:** thứ tự CI bắt buộc của E (bước 3 provision bằng cùng credential của job, E:429); E:433-434: migration và provision queue không được làm thành runtime command của App Platform đưa credential DDL vào mọi component. Đường migration duy nhất là job `migrate` `PRE_DEPLOY` của App Spec, không phải bước trên CI runner; `DATABASE_URL_MIGRATION` là secret chỉ trên đúng job đó, không ở GitHub, không ở component runtime (WS:20-26, WP:14-17). M §E4 (M:69-75) và hàng provision M:24. Mặc định DD-129 (1) (PLAN:228: job `migrate` giữ riêng `DATABASE_URL_MIGRATION`); PLAN ghi DD-129 "đóng băng, chưa được owner duyệt", nên mục này là "default applied, pending owner sign-off". PLAN §10 mục 8 (PLAN:283) đưa DEPLOYMENT INPUTS của `docs/autopilot-backlog.md` (:897-921) và bước cấp `USAGE` một lần vào §2. Code: EP, `packages/db/src/migrate.ts`, `apps/bot/src/provision-queue.ts`, WS, WP.
- **Ai làm:** DigitalOcean chạy job `migrate` trong lúc deploy; mọi bước trên DigitalOcean, GitHub hay cụm PostgreSQL là của owner và mang nhãn [Owner]; agent chỉ chuẩn bị file, không có bước nào cho agent trên môi trường thật. Giá trị secret và mật khẩu chỉ owner nhập, không bao giờ vào repo, chat hay ghi chú; runbook chỉ nêu TÊN, giá trị chỉ ở dạng `<placeholder>`.
- **Nhãn:** UNPINNED = dạng chính thức của bước chưa được trích ở F1-F6, kèm phép kiểm của nó (tiền lệ O:196). Tên file này và việc đưa PLAN §10 mục 8 vào §2 là default của lane: "default applied, pending owner sign-off".
- **Viết tắt:** WS = `.github/workflows/deploy-staging.yml`, WP = `.github/workflows/deploy-production.yml`, EP = `infra/entrypoint.sh`, M = `docs/runbooks/env-manifest-staging-production.md`, E = `docs/standards/environments-setup.md`, PLAN = `docs/sessions/web-mvp-phase5-golive-plan.md`, O = `docs/runbooks/outbox-dispatch-enable-rollback.md`. Form go/no-go: docs/runbooks/go-no-go-template.md (cùng thư mục). F1-F6 = trang chính thức đọc ngày 2026-10-30, trích nguyên văn ở `docs/sessions/web-mvp-phase5-readiness-p5-runbook-deploy-migration-rollback.md` §2.

## 1. Job migrate (`PRE_DEPLOY`)

- **Job làm gì:** nhánh `migrate` của EP (EP:78-85) chạy hai lệnh trong một shell: SQL migration (`packages/db/src/migrate.ts`), rồi `provision:queue` (`apps/bot/src/provision-queue.ts`). Lệnh đầu không có `exec`: dưới `set -eu`, nó lỗi thì job thoát ngay, trước provision (EP:80-81). Cả hai chỉ đọc `DATABASE_URL_MIGRATION` và từ chối giá trị rỗng (EP:80); migration lỗi thì provision không chạy, bước nào lỗi cũng làm job fail và chặn deploy (M:24).
- **Credential:** `DATABASE_URL_MIGRATION` chỉ nằm trên job `migrate`, không bao giờ trên component runtime (W, D, K của M; M:71, M:75, M:102); renderer từ chối render khi tên này nằm ngoài job `PRE_DEPLOY` (M:71). Giá trị do owner nhập, role `migration` (M:75); runbook không ghi giá trị.
- **Ai chạy:** DigitalOcean chạy job trong bước `3. Reconcile the app (creates the deployment; the PRE_DEPLOY migrate job runs first)` của WS (WS:137); WP dùng cùng job `migrate` (WP:14-17). [Owner] đọc log của job.
- **Bằng chứng pass:** log của job `migrate` trong lần chạy đó có CẢ HAI dòng, theo thứ tự: dòng bắt đầu bằng `[migrate] applied=` (`packages/db/src/migrate.ts:417`, theo sau là số migration applied và skipped), rồi `[provision-queue] pgboss schema + queues provisioned` (`apps/bot/src/provision-queue.ts:65`); sau đó bước `4. Wait for the deployment carrying this digest to be ACTIVE` (WS:142) xanh. Thiếu một trong hai dòng thì chưa pass: dừng, không promote.
- **Đọc log job, UNPINNED** [Owner]: F6 nêu log component qua `doctl apps logs` (tên component, `--type`, `--deployment`) và "job invocation logs" qua `--job-invocation`, nhưng không nêu log của job `PRE_DEPLOY` `migrate` đọc theo cách nào, cách tìm invocation ID, hay đường Control Panel. Hai dạng dưới đây chỉ là ứng viên. Phép kiểm: owner thấy cả hai dòng trên trong log của đúng deployment của lần chạy; không đọc được log job theo đường nào thì coi như chưa pass và ghi lại đường đã thử.

```bash
# [Owner] UNPINNED candidate 1 (F6 form): the migrate job read as a deploy log of the deployment
doctl apps logs <app id> migrate --type deploy --deployment <deployment id>
# [Owner] UNPINNED candidate 2 (F6 form): the job invocation log; how to find the invocation id is not stated
doctl apps logs <app id> migrate --job-invocation <job invocation id>
```

## 2. Chuẩn bị role một lần

Mỗi cluster làm một lần, trước deploy đầu tiên lên cluster đó; mọi bước là của owner (O:184 và O:186 chuyển owner về đây cho phần setup role). Kết nối theo dạng credential của O §6 (O:161-172): URL không mang password trong `DATABASE_URL_MIGRATION` (khối `read -rs`), password chỉ trong password file; không bao giờ dán URL có password vào dòng lệnh.

- **(1) [Owner] Bốn user DB** (bước 8.5, PLAN:201; M:16): `migration` trước, vì bootstrap ở (2) cấp `job_definer` cho role mang tên `MIGRATION_ROLE` (O:184); rồi `app`, `app_worker`, `readonly`; cả bốn trước lần chạy đầu của job `migrate`. Thứ tự này theo phép kiểm của `packages/db/src/migrate.ts:252-282`: trước khi 0000 chạy, nó đọc `pg_roles` và chỉ tạo runtime role nào còn thiếu (`RUNTIME_ROLES`), vì cluster có thể đã tạo sẵn chúng trong khi DDL owner (`DATABASE_URL_MIGRATION`) là `NOCREATEROLE`; khi đó role còn thiếu không tạo được, job fail và deploy bị chặn. UNPINNED: dạng chính thức để tạo user DB trên DigitalOcean chưa được trích ở F1-F6; kiểm: (4) thấy `migration`, và lần chạy đầu của job `migrate` pass theo §1.
- **(2) [Owner] Bootstrap** (O:186; `package.json:26`): qua kết nối admin theo dạng O §6: URL admin không mang password vào `DATABASE_URL_MIGRATION` bằng khối `read -rs`, password admin là một dòng riêng trong password file. Đặt `MIGRATION_ROLE` bằng tên role migration (`migration`, M:75); tên chỉ gồm chữ, số, gạch dưới, sai thì lệnh dừng (`package.json:26`). Lệnh chạy ba file `infra/postgres-init/01-job-definer.sql`, `infra/postgres-init/02-chat-definer.sql`, `infra/postgres-init/03-identity-definer.sql`. Kỳ vọng: lock toàn cluster báo cảnh báo, không phải lỗi (3a); không sửa bằng cách cấp thêm quyền (O:186). Xong: xoá dòng admin khỏi password file, nhập lại `DATABASE_URL_MIGRATION` bằng URL của `migration` (không mang password), rồi chạy (4) (O:186).

```bash
# [Owner] once per cluster; the admin URL without password is already read into DATABASE_URL_MIGRATION (O section 6 form)
MIGRATION_ROLE=<migration role name> pnpm db:bootstrap
```

- **(3) [Owner] DEPLOYMENT INPUTS** (PLAN §10 mục 8, PLAN:283; `docs/autopilot-backlog.md:897-921`): DO Managed PostgreSQL không cấp superuser, `doadmin` chỉ có `CREATEROLE` (:897). Owner kiểm từng mục:
  - **(3a)** `LOCK TABLE pg_auth_members` lỗi `insufficient_privilege` (:902), nên lock toàn cluster của bootstrap thành `RAISE WARNING` theo thiết kế (:904); kiểm: output của (2) có cảnh báo đó và không có lỗi; không "sửa" bằng cách cấp thêm quyền (:907).
  - **(3b)** `GRANT USAGE ON SCHEMA public TO job_definer` của bootstrap lặng lẽ không làm gì: in `WARNING: no privileges were granted for "public"` mà transaction vẫn commit (:908-910), nên `job_definer` thiếu `USAGE` trên `public` và chỉ lộ ra khi migration đầu tiên lỗi quyền (:913-914). Owner cấp MỘT lần, ngoài bootstrap (phương án 1, :915-916), bằng khối dưới. UNPINNED: role nào cấp được (dưới role của bootstrap thì no-op, :908) chưa được nêu ở các dòng backlog này; kiểm: lệnh không in cảnh báo trên, và giá trị thứ ba của (4) là `t`.
  - **(3c)** PostgreSQL 16 tự cấp cho người giữ `CREATEROLE` membership trong role nó tạo (:919-921): không giả định role provisioning không có membership trong role nó tạo.

```sql
-- [Owner] once per cluster, after (2); the connecting role is UNPINNED (see 3b)
GRANT USAGE ON SCHEMA public TO job_definer;
```

- **(4) [Owner] Kiểm role** (O:180-184, chỉ đọc), kết nối bằng URL của `migration`: chạy đúng lệnh kiểm role của O §6, khối O:180-182 trong `docs/runbooks/outbox-dispatch-enable-rollback.md`; runbook này không chép lại lệnh (một nguồn cho lệnh).

Ghi lại `server_version`; phải thấy `migration`, `t`, `t`, rồi `job_definer` sau `SET ROLE` (O:184); giá trị thứ ba (`has_schema_privilege`) là `t` chứng minh grant `USAGE` của (3b). Kết quả nào khác: dừng, không deploy. Bằng chứng: output này, ghi vào docs/runbooks/go-no-go-template.md §4.

## 3. Migration lỗi, schema chỉ tiến

- **Khi job `migrate` lỗi:** "the new deployment does not become active", nên lần chạy không qua bước `4. Wait for the deployment carrying this digest to be ACTIVE` (WS:142).
- **Schema chỉ tiến:** không có down-migration; schema giữ ở phiên bản mới hơn, nên rollback app chỉ an toàn qua migration expand-only (WS:166-167).
- **[Owner] Sửa:** bản sửa đi bằng một commit mới, deploy qua `docs/runbooks/staging-deploy.md` §4; không sửa schema bằng tay, không chạy migration ngoài job `migrate` (đường migration duy nhất, WS:20-26).
- **[Owner] Bằng chứng:** hai dòng của §1 trong log job `migrate` của lần chạy chứa bản sửa, rồi bước 4 xanh.

## 4. Promote production

- **Khi nào:** chỉ sau G3 (PLAN:202; G4 ở PLAN:243) và sau khi owner đã ghi "go" vào form go/no-go (docs/runbooks/go-no-go-template.md); WP:9-10 cấm chạy trước khi owner đóng các gate còn mở ở E §1.1 (bằng chứng IP outbound cố định) và §10. Production deploy là việc P0, chỉ owner (WP:11-12). Trước lần promote đầu tiên, §2 chạy trên cụm production (membership tính theo từng cluster, O:178).
- **(1) [Owner] Chạy:** "Run workflow" `Deploy production` trên `main` (`workflow_dispatch`, WP:19-20), với các input (WP:20-41):
  - `tag`: SHA git đầy đủ 40 ký tự mà run `deploy-staging.yml` đã build và test (cũng là image tag);
  - `digest`: `image_digest` trong `deployment-evidence.json` của chính run đó;
  - `staging_run_id`: run id của run `deploy-staging.yml` thành công của SHA đó;
  - `confirm`: `tag` gõ lại;
  - `rollback_deployment_id`: để trống; trống thì job `production` chạy (WP:60-61), có giá trị thì job `rollback` chạy thay (§5).
- **(2) Job `production` (WP:60-171), từng step kiểm gì:**
  - `Refuse unless the inputs are a full SHA, a digest and a run id, and confirm is the tag typed again` (WP:73-81): `tag` là 40 ký tự hex, `digest` có dạng `sha256:` cộng 64 ký tự hex, `staging_run_id` là số, `confirm` bằng đúng `tag` (sai thì `confirm must equal tag exactly`).
  - `Require the successful deploy-staging run of this tag and its evidence of this digest` (WP:90-104): run `staging_run_id` phải là run của `.github/workflows/deploy-staging.yml` với `conclusion` là `success` và `head_sha` bằng `tag`; artifact `deployment-evidence-staging` của run đó phải ghi `image_digest` bằng `digest` và `git_sha` bằng `tag`. Run rollback của staging chỉ upload `rollback-evidence-staging` nên không bao giờ qua step này (WP:91-92).
  - `1. Require the staged image in DOCR (this digest, tagged with this SHA; nothing is built)` (WP:110-114): DOCR phải có manifest `digest` mang tag `tag`; production không build image.
  - `2. Render the spec (committed spec + live secrets + this digest)` (WP:116-129): `APP_DOMAIN` phải đúng `plexco.app` (WP:123-125); domain khác, kể cả domain staging, dừng ở `APP_DOMAIN is not plexco.app`. Step chỉ in name, region và digest của từng component; spec đã render không bao giờ được in vì chứa giá trị secret đã mã hoá (WP:128-129).
  - `3. Reconcile the app (creates the deployment; the PRE_DEPLOY migrate job runs first)` (WP:131-134): tạo deployment; job `migrate` (`PRE_DEPLOY`) chạy trước, bằng chứng ở §1, lỗi thì §3.
  - `4. Wait for the deployment carrying this digest to be ACTIVE` (WP:136-139): chờ deployment mang đúng `digest` lên `ACTIVE` (`infra/wait-for-deployment.sh`).
  - `5. Smoke (/healthz, landing, manifest)` (WP:141-149): host của `PRODUCTION_BASE_URL` phải là `APP_DOMAIN` (không thì `the PRODUCTION_BASE_URL host is not APP_DOMAIN`), rồi `infra/smoke-check.sh` chạy trên URL đó.
  - `Record deployment evidence` (WP:151-164): ghi `deployment-evidence.json`; chạy cả khi promotion lỗi, miễn step đầu đã nhận input, vì step 3 đổi app trước khi step 4 và 5 có thể lỗi; input bị từ chối không bao giờ được in hay ghi (WP:152-155).
- **(3) [Owner] Bằng chứng:** tải artifact `deployment-evidence-production` của run (giữ 365 ngày, WP:166-171); phải thấy `outcome` là `success` (WP:154), `git_sha` bằng `tag`, `image_digest` bằng `digest`, `promoted_from_staging_run` bằng `staging_run_id` (WP:159-162); kèm hai dòng của §1 trong log job `migrate` của deployment này. Ghi vào form go/no-go (docs/runbooks/go-no-go-template.md).
- **(4) [Owner] Giới tính tắt:** trên app production đang chạy, `GENDER_COLLECTION_ENABLED` phải vắng hoặc "false"; chỉ đúng "true" mới bật (M:103; PLAN:243). UNPINNED: cách đọc giá trị một biến của app đang chạy chưa được trích ở F1-F6 (F2 chỉ trích đường vào tab `Settings` rồi mục `Environment Variables` của Control Panel để thêm biến); kiểm: giá trị đọc được là vắng hoặc "false"; không đọc được hoặc giá trị khác: G4 không đạt, ghi "no-go".
- **(5) [Owner] Phần còn lại của G4:** smoke production xanh (step `5. Smoke (/healthz, landing, manifest)`), domain và TLS theo Q4, PLAN §7.6 mục 2 kiểm trên production (PLAN:243); ghi kết quả vào form go/no-go.
- **Cửa sổ promote:** artifact `deployment-evidence-staging` chỉ giữ 90 ngày (WS:163). Quá hạn thì step `Require the successful deploy-staging run of this tag and its evidence of this digest` dừng ở `has no deployment-evidence-staging artifact` (WP:101-102): [Owner] chạy lại staging (`docs/runbooks/staging-deploy.md` §4), rồi promote với `tag`, `digest` và `staging_run_id` của run mới.
- **Run lỗi:** lỗi trước step `3. Reconcile the app (creates the deployment; the PRE_DEPLOY migrate job runs first)` thì app chưa đổi (step 3 là step đầu tiên đổi app, WP:152); job `migrate` lỗi: §3; step 4 hoặc 5 lỗi: [Owner] đọc log của run, rồi §3 nếu job `migrate` lỗi, §5 nếu bản phát hành hỏng.

## 5. Rollback app

## 6. Chưa kiểm chứng
