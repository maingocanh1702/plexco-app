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
- **Credential:** `DATABASE_URL_MIGRATION` chỉ nằm trên job `migrate`, không bao giờ trên component runtime (W, D, K của M; M:71, M:75, M:103); renderer từ chối render khi tên này nằm ngoài job `PRE_DEPLOY` (M:71). Giá trị do owner nhập, role `migration` (M:75); runbook không ghi giá trị.
- **Ai chạy:** DigitalOcean chạy job trong bước `3. Reconcile the app (creates the deployment; the PRE_DEPLOY migrate job runs first)` của WS (WS:138); WP dùng cùng job `migrate` (WP:14-17). [Owner] đọc log của job.
- **Bằng chứng pass:** log của job `migrate` trong lần chạy đó có CẢ HAI dòng, theo thứ tự: dòng bắt đầu bằng `[migrate] applied=` (`packages/db/src/migrate.ts:417`, theo sau là số migration applied và skipped), rồi `[provision-queue] pgboss schema + queues provisioned` (`apps/bot/src/provision-queue.ts:65`); sau đó bước `4. Wait for the deployment carrying this digest to be ACTIVE` (WS:143) xanh. Thiếu một trong hai dòng thì chưa pass: dừng, không promote.
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

- **Khi job `migrate` lỗi:** "the new deployment does not become active", nên lần chạy không qua bước `4. Wait for the deployment carrying this digest to be ACTIVE` (WS:143).
- **Schema chỉ tiến:** không có down-migration; schema giữ ở phiên bản mới hơn, nên rollback app chỉ an toàn qua migration expand-only (WS:167-168).
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
- **(2) Job `production` (WP:60-172), từng step kiểm gì:**
  - `Refuse unless the inputs are a full SHA, a digest and a run id, and confirm is the tag typed again` (WP:73-81): `tag` là 40 ký tự hex, `digest` có dạng `sha256:` cộng 64 ký tự hex, `staging_run_id` là số, `confirm` bằng đúng `tag` (sai thì `confirm must equal tag exactly`).
  - `Require the successful deploy-staging run of this tag and its evidence of this digest` (WP:90-104): run `staging_run_id` phải là run của `.github/workflows/deploy-staging.yml` với `conclusion` là `success` và `head_sha` bằng `tag`; artifact `deployment-evidence-staging` của run đó phải ghi `image_digest` bằng `digest` và `git_sha` bằng `tag`. Run rollback của staging chỉ upload `rollback-evidence-staging` nên không bao giờ qua step này (WP:91-92).
  - `1. Require the staged image in DOCR (this digest, tagged with this SHA; nothing is built)` (WP:110-114): DOCR phải có manifest `digest` mang tag `tag`; production không build image.
  - `2. Render the spec (committed spec + live secrets + this digest)` (WP:116-130): `APP_DOMAIN` phải đúng `plexco.app` (WP:124-126); domain khác, kể cả domain staging, dừng ở `APP_DOMAIN is not plexco.app`. Step chỉ in name, region và digest của từng component; spec đã render không bao giờ được in vì chứa giá trị secret đã mã hoá (WP:129-130).
  - `3. Reconcile the app (creates the deployment; the PRE_DEPLOY migrate job runs first)` (WP:132-135): tạo deployment; job `migrate` (`PRE_DEPLOY`) chạy trước, bằng chứng ở §1, lỗi thì §3.
  - `4. Wait for the deployment carrying this digest to be ACTIVE` (WP:137-140): chờ deployment mang đúng `digest` lên `ACTIVE` (`infra/wait-for-deployment.sh`).
  - `5. Smoke (/healthz, landing, manifest)` (WP:142-150): host của `PRODUCTION_BASE_URL` phải là `APP_DOMAIN` (không thì `the PRODUCTION_BASE_URL host is not APP_DOMAIN`), rồi `infra/smoke-check.sh` chạy trên URL đó.
  - `Record deployment evidence` (WP:152-165): ghi `deployment-evidence.json`; chạy cả khi promotion lỗi, miễn step đầu đã nhận input, vì step 3 đổi app trước khi step 4 và 5 có thể lỗi; input bị từ chối không bao giờ được in hay ghi (WP:153-156).
- **(3) [Owner] Bằng chứng:** tải artifact `deployment-evidence-production` của run (giữ 365 ngày, WP:167-172); phải thấy `outcome` là `success` (WP:155), `git_sha` bằng `tag`, `image_digest` bằng `digest`, `promoted_from_staging_run` bằng `staging_run_id` (WP:160-163); kèm hai dòng của §1 trong log job `migrate` của deployment này. Ghi vào form go/no-go (docs/runbooks/go-no-go-template.md).
- **(4) [Owner] Giới tính tắt:** trên app production đang chạy, `GENDER_COLLECTION_ENABLED` phải vắng hoặc "false"; chỉ đúng "true" mới bật (M:104; PLAN:243). UNPINNED: cách đọc giá trị một biến của app đang chạy chưa được trích ở F1-F6 (F2 chỉ trích đường vào tab `Settings` rồi mục `Environment Variables` của Control Panel để thêm biến); kiểm: giá trị đọc được là vắng hoặc "false"; không đọc được hoặc giá trị khác: G4 không đạt, ghi "no-go".
- **(5) [Owner] Phần còn lại của G4:** smoke production xanh (step `5. Smoke (/healthz, landing, manifest)`), domain và TLS theo Q4, PLAN §7.6 mục 2 kiểm trên production (PLAN:243); ghi kết quả vào form go/no-go.
- **Cửa sổ promote:** artifact `deployment-evidence-staging` chỉ giữ 90 ngày (WS:164). Quá hạn thì step `Require the successful deploy-staging run of this tag and its evidence of this digest` dừng ở `has no deployment-evidence-staging artifact` (WP:101-102): [Owner] chạy lại staging (`docs/runbooks/staging-deploy.md` §4), rồi promote với `tag`, `digest` và `staging_run_id` của run mới.
- **Run lỗi:** lỗi trước step `3. Reconcile the app (creates the deployment; the PRE_DEPLOY migrate job runs first)` thì app chưa đổi (step 3 là step đầu tiên đổi app, WP:153); job `migrate` lỗi: §3; step 4 hoặc 5 lỗi: [Owner] đọc log của run, rồi §3 nếu job `migrate` lỗi, §5 nếu bản phát hành hỏng.

## 5. Rollback app

- **Khi nào:** một bản phát hành chạy sai trên staging hoặc production, và mọi migration kể từ deployment đích đều expand-only: rollback chỉ đưa app về, schema giữ ở phiên bản mới hơn vì không có down-migration (WS:166-168; WP:174-176; §3). Dữ liệu chỉ lấy lại được từ backup của Managed Databases (WS:168-169), không bằng rollback.
- **(1) [Owner] Chọn đích:** id của một trong mười deployment thành công gần nhất của app (WS:166), dạng 8-4-4-4-12 ký tự hex (WS:187). UNPINNED: cách liệt kê deployment và lấy id chưa được trích ở F1-F6; kiểm: R1 và R4 ở dưới nhận đích, không thì run dừng trước khi đổi app.
- **(2) [Owner] Chạy:** "Run workflow" của workflow môi trường đó (`Deploy staging` hoặc `Deploy production`) trên `main`, với `rollback_deployment_id` là id đích và `confirm` là chính id đó gõ lại (WS:31-38; WP:34-41); job `rollback` chạy thay job deploy (WS:170-171; WP:178-179).
- **(3) Job `rollback`: sáu step có tên, không có R2 hay R3 (giữa R1 và R4 là hai step `uses:` không tên); từng step kiểm gì:**
  - `R1. Refuse unless the target is an explicit deployment id, typed twice, and APP_DOMAIN is this environment's host` (WS:181; WP:189): `rollback_deployment_id` có dạng deployment id, `confirm` bằng đúng nó (sai thì `confirm must equal rollback_deployment_id exactly`, WS:188), `APP_DOMAIN` là host của môi trường này (staging: `APP_DOMAIN is not a staging*.plexco.app host`, WS:190).
  - `R4. Check the target (this environment's app, exactly one deployment, not the active one, a web image digest other than the active one's)` (WS:200; WP:208): app mang đúng tên của spec đã commit, đích là đúng một deployment, không phải deployment đang active, có web image digest khác digest của deployment đang active; JSON của app và deployment không bao giờ được in (WS:201-202).
  - [Owner] Đích mang cùng web image digest với deployment đang active (sau một deployment chỉ đổi config) bị R4 từ chối với `use the Control Panel rollback` (WS:204-206, :219), vì R6 chờ theo digest nên không phân biệt được hai deployment đó: dùng (6).
  - `R5. Roll back through the documented API (skip_pin, so later deploys are not blocked)` (WS:222; WP:230): rollback qua API có tài liệu, vì CLI không có lệnh con rollback (WS:167).
  - `R6. Wait for the rollback deployment to be ACTIVE` (WS:230; WP:238): chờ deployment rollback lên `ACTIVE`, chọn theo digest đích (WS:204).
  - `R7. Smoke (/healthz, landing, manifest)` (WS:233; WP:241): smoke trên `APP_DOMAIN` (WS:189).
  - `R8. Record rollback evidence` (WS:241; WP:249): ghi `rollback-evidence.json` với `outcome`, `target_deployment_id`, `image_digest`, `run_url` (WS:251); artifact upload cả khi rollback lỗi, miễn R1 đã nhận input (WS:256; WP:264).
- **(4) [Owner] Bằng chứng:** artifact `rollback-evidence-staging` (giữ 90 ngày, WS:258-260) hoặc `rollback-evidence-production` (giữ 365 ngày, WP:266-268): `outcome` là `success`, `target_deployment_id` bằng id đích. Ghi vào form go/no-go (docs/runbooks/go-no-go-template.md).
- **(5) [Owner] Rollback run lỗi: kiểm deployment đang active trước mọi việc khác** (K-a, L67R:162; D4, "default applied, pending owner sign-off"). Hai chương trình jq là của chính R4 (WS:212, :217); JSON không bao giờ được in (WS:201-202):

```bash
# [Owner] K-a: the app's active deployment id, then its web image digest
doctl apps get <app-id> -o json | jq -r '.[0].active_deployment.id // empty'
doctl apps get <app-id> -o json | jq -r 'first(.[0].active_deployment.spec.services[]? | select(.name == "web") | .image.digest) // empty'
```

- **Bằng:** web image digest đang active bằng `image_digest` trong bằng chứng rollback của run đó: DigitalOcean đã áp rollback và lỗi là do wait chọn nhầm deployment (K-a: lỗi giả, không bao giờ là pass giả). [Owner] rồi chạy smoke trên base URL của môi trường (`STAGING_BASE_URL` hoặc `PRODUCTION_BASE_URL`):

```bash
# [Owner] smoke against the environment's base URL
infra/smoke-check.sh <base-url>
```

- **[Owner] Không bằng:** rollback chưa có hiệu lực; dừng, dùng rollback của Control Panel (6). Không bao giờ dispatch lại trước khi kiểm xong (5).
- **(6) [Owner] Rollback của Control Panel** (khi R4 từ chối hoặc K-a không bằng): tab `Activity` (WS:169, :219). UNPINNED: các bước rollback trên Control Panel chưa được trích ở F1-F6; kiểm: trước rollback ghi id deployment đang active (dòng đầu của khối K-a), sau rollback id đó phải khác và smoke ở (5) xanh; không thì dừng.
- **Wait chọn nhầm:** wait dùng chung chọn deployment đầu tiên theo thứ tự danh sách (L67R:162); cho nó chọn theo id hoặc `created_at` là một hàng ở cuối `docs/autopilot-backlog.md` (L67R:175), chưa làm.

## 6. Chưa kiểm chứng

- **Chưa chạy lần nào:** WS:8-9 ghi `PREPARED, NOT RUN`: owner dựng environment `staging` cùng protection của nó, nhập mọi giá trị secret và variable, rồi bấm `workflow_dispatch` (PLAN bước 8.5 và 8.6). WP:9-12 ghi `DO NOT RUN` cho tới khi owner đóng các gate còn mở ở E §1.1 (bằng chứng IP outbound cố định) và §10 và ghi "go" vào biên bản go/no-go; deploy production là việc P0, chỉ owner làm. Cho tới lần chạy đầu của owner, §1-§5 chỉ là văn bản, chưa có lần chạy thật nào làm bằng chứng.
- **App Spec và renderer** (E:440-441, bảng "files prepared, not applied" của E §6): App Spec staging và production cùng credential DDL theo job đang `PREPARED, NOT APPLIED`: chưa tạo app nào, chưa deploy gì, và [Owner] `doctl apps spec validate` chưa chạy (cần auth DigitalOcean; PLAN bước 8.1, 8.2 và 8.5). Renderer `infra/render-app-spec.sh` mới được test trong CI (`test:infra`) bằng tên key thật và giá trị giả, chưa chạy với app thật.
- **Bước UNPINNED** (nhãn ở §0), mỗi bước cùng phép kiểm của nó:
  - §1, đọc log job `migrate` (cả hai ứng viên): owner thấy cả hai dòng log của §1 trong log của đúng deployment; không đọc được theo đường nào thì coi như chưa pass và ghi lại đường đã thử.
  - §2 (1), tạo bốn user DB trên DigitalOcean: (4) thấy `migration`, và lần chạy đầu của job `migrate` pass theo §1.
  - §2 (3b), role nào cấp được `USAGE`: lệnh không in cảnh báo của (3b), và giá trị thứ ba của (4) là `t`.
  - §4 (4), đọc `GENDER_COLLECTION_ENABLED` trên app production đang chạy: giá trị đọc được là vắng hoặc "false"; không đọc được hoặc giá trị khác thì G4 không đạt, ghi "no-go".
  - §5 (1), liệt kê deployment để lấy id đích: R1 và R4 nhận đích, không thì run dừng trước khi đổi app.
  - §5 (6) [Owner], các bước rollback trên Control Panel: trước rollback ghi id deployment đang active (dòng đầu của khối K-a); sau rollback id đó phải khác và smoke ở (5) xanh; không thì dừng.
- **Default:** mặc định DD-129 (1) ở §0 (job `migrate` giữ riêng `DATABASE_URL_MIGRATION`; PLAN ghi DD-129 "đóng băng, chưa được owner duyệt"), phép kiểm K-a của §5 (5), tên file này và việc đưa PLAN §10 mục 8 vào §2 đều là "default applied, pending owner sign-off".
- **Mẫu go/no-go:** §2 trỏ tới docs/runbooks/go-no-go-template.md §4 (hàng output kiểm role của mục đó); §4 và §5 trỏ tới mẫu đó bằng chữ thường, không kèm số mục, và chưa được đối chiếu với mẫu; kiểm: mỗi chỗ trỏ tới của §4 và §5 khớp một mục của mẫu.
