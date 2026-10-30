# Runbook: migration khi deploy và rollback (DigitalOcean App Platform)

## 0. Phạm vi, nguồn, trạng thái

- **Phạm vi:** migration khi deploy và rollback app trên DigitalOcean App Platform, cho staging và production. Runbook gồm job `migrate` (`PRE_DEPLOY`) chạy mỗi lần deploy (§1), chuẩn bị role một lần trước deploy đầu tiên (§2), migration lỗi (§3), promote production (§4), rollback app bằng job `rollback` của mỗi workflow (§5) và phần chưa kiểm chứng (§6). Các bước chạy deploy staging nằm ở `docs/runbooks/staging-deploy.md` §4; runbook này không chép lại.
- **Trạng thái:** E:436 ghi các file của lane L66 là "files prepared, not applied"; runbook này chưa chạy lần nào, trên staging hay production.
- **Thẩm quyền:** thứ tự CI bắt buộc của E (bước 3 provision bằng cùng credential của job, E:429); E:433-434: migration và provision queue không được làm thành runtime command của App Platform đưa credential DDL vào mọi component. Đường migration duy nhất là job `migrate` `PRE_DEPLOY` của App Spec, không phải bước trên CI runner; `DATABASE_URL_MIGRATION` là secret chỉ trên đúng job đó, không ở GitHub, không ở component runtime (WS:20-26, WP:14-17). M §E4 (M:69-75) và hàng provision M:24. Mặc định DD-129 (1) (PLAN:228: job `migrate` giữ riêng `DATABASE_URL_MIGRATION`); PLAN ghi DD-129 "đóng băng, chưa được owner duyệt", nên mục này là "default applied, pending owner sign-off". PLAN §10 mục 8 (PLAN:283) đưa DEPLOYMENT INPUTS của `docs/autopilot-backlog.md` (:897-921) và bước cấp `USAGE` một lần vào §2. Code: EP, `packages/db/src/migrate.ts`, `apps/bot/src/provision-queue.ts`, WS, WP.
- **Ai làm:** DigitalOcean chạy job `migrate` trong lúc deploy; mọi bước trên DigitalOcean, GitHub hay cụm PostgreSQL là của owner và mang nhãn [Owner]; agent chỉ chuẩn bị file, không có bước nào cho agent trên môi trường thật. Giá trị secret và mật khẩu chỉ owner nhập, không bao giờ vào repo, chat hay ghi chú; runbook chỉ nêu TÊN, giá trị chỉ ở dạng `<placeholder>`.
- **Nhãn:** UNPINNED = dạng chính thức của bước chưa được trích ở F1-F6, kèm phép kiểm của nó (tiền lệ O:196). Tên file này và việc đưa PLAN §10 mục 8 vào §2 là default của lane: "default applied, pending owner sign-off".
- **Viết tắt:** WS = `.github/workflows/deploy-staging.yml`, WP = `.github/workflows/deploy-production.yml`, EP = `infra/entrypoint.sh`, M = `docs/runbooks/env-manifest-staging-production.md`, E = `docs/standards/environments-setup.md`, PLAN = `docs/sessions/web-mvp-phase5-golive-plan.md`, O = `docs/runbooks/outbox-dispatch-enable-rollback.md`. Form go/no-go: docs/runbooks/go-no-go-template.md (cùng thư mục). F1-F6 = trang chính thức đọc ngày 2026-10-30, trích nguyên văn ở `docs/sessions/web-mvp-phase5-readiness-p5-runbook-deploy-migration-rollback.md` §2.

## 1. Job migrate (PRE_DEPLOY)

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

## 3. Migration lỗi, schema chỉ tiến
