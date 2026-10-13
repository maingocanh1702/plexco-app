# Runbook — Staging deploy (DigitalOcean App Platform)

> Authority: `docs/standards/environments-setup.md` (§3 spec, §6 CI order, §9 TTL) · DD-04 · DD-10.
> Code: `infra/app.staging.yaml`, `infra/app.prod.yaml`, `infra/render-app-spec.sh`,
> `.github/workflows/deploy-staging.yml`, `.github/workflows/deploy-production.yml`.
> Trạng thái: **chuẩn bị xong, chưa chạy thật** — chưa có tài khoản DO nào được dùng để kiểm chứng.
> Mọi lệnh `doctl` dưới đây chưa được chạy trên DO thật (xem §8 "Chưa kiểm chứng").

Lệnh và tên biến giữ tiếng Anh. Mọi bước **tạo tài nguyên DO / đặt secret** là việc của owner.

## 1. Mô hình

```text
workflow_dispatch (owner approve, environment: staging)
  verify xanh trên đúng SHA → build 1 image → DOCR (tag = SHA, deploy theo DIGEST)
  → render spec (spec commit + secret lấy từ app đang chạy + digest)
  → doctl apps update → PRE_DEPLOY job `migrate` (migrations + queue provisioning, trong VPC)
  → web / discovery / worker lên → chờ ACTIVE đúng digest → smoke → Playwright e2e
```

- **Một** đường migrate: PRE_DEPLOY job trong spec. DB chỉ tin identity private của app (§2), runner GitHub
  không có IP ổn định nên không chạy migration từ runner. `DATABASE_URL_MIGRATION` chỉ tồn tại ở job `migrate`.
- Secret **không bao giờ** nằm trong repo hay GitHub (trừ token DO + base URL). `render-app-spec.sh` copy giá
  trị đã mã hoá `EV[...]` từ app live, và **fail** nếu thiếu secret nào (nêu tên).
- Staging 1×web + 1×discovery + 1×worker (production 2+2+1): đủ chứng minh role/VPC/migration; **không** chứng
  minh được rolling-deploy 2 instance — mục §10 của environments-setup giữ mở cho tới khi đo trên run 2 instance.

## 2. Owner setup một lần (staging)

Tên là gợi ý; thay `<...>`. Chạy bằng `doctl` đã `auth init` bằng token của owner.

```bash
# 2.1 VPC + registry + DB (sgp1). Ghi lại UUID.
doctl vpcs create --name plexco-staging --region sgp1 --ip-range 10.20.0.0/20
doctl registry create <registry-name> --subscription-tier basic --region sgp1   # 1 registry/account
doctl databases create plexco-staging-pg --engine pg --version 16 --region sgp1 \
  --size db-s-1vcpu-2gb --num-nodes 1 --private-network-uuid <vpc-uuid>
doctl databases db create <cluster-id> plexco
```

> Connection pool (transaction-mode) cho web/discovery được tạo **sau** lần `migrate` đầu tiên (§2.4b), vì
> `--user app/readonly` phải tồn tại trước.

**2.3 Bootstrap vai trò (một lần / cluster, bằng admin)** — chạy từ máy nằm trong trusted sources:

```bash
export DATABASE_URL_MIGRATION='<URL của user có quyền tạo role, sslmode=require>'
MIGRATION_ROLE=<tên user migration> pnpm db:bootstrap     # job_definer + chat_definer (cần psql)
```

> **CHƯA ĐO / rủi ro R1.** `01-job-definer.sql` tạo role `BYPASSRLS`; PostgreSQL thường chỉ cho superuser tạo.
> `doadmin` của DO Managed PG **không** phải superuser. Nếu bước này bị từ chối, đây là blocker kiến trúc
> cho cả staging lẫn production: ghi kết quả vào bảng đo của `pitr-restore-drill.md` và đưa owner quyết định
> (đổi cách tạo `job_definer`, hoặc DD-04 fallback). Tương tự cần đo: `migration` user có `CREATEROLE` để
> `ensureRoleExists` tạo `app/app_worker/readonly` không; nếu không, tạo trước bằng admin với đúng thuộc tính
> `LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE`.

**2.4 Chạy migration lần đầu + đặt password 3 role runtime** (sau khi deploy đầu tiên đã tạo role, hoặc chạy
`migrate` thủ công một lần), bằng admin:

```sql
ALTER ROLE app WITH PASSWORD '<gen>';  ALTER ROLE app_worker WITH PASSWORD '<gen>';
ALTER ROLE readonly WITH PASSWORD '<gen>';
```

Thứ tự tự nhiên: lần deploy đầu tiên chạy job `migrate` (tạo role) nhưng web/discovery/worker có thể không
healthy vì password role runtime chưa đặt → deployment ERROR là **bình thường ở lần đầu**; đặt password + điền
`DATABASE_URL*` ở DO rồi chạy lại workflow.

**2.4b Connection pool** (sau khi 3 role đã tồn tại):

```bash
doctl databases pool create <cluster-id> app-pool --db plexco --mode transaction --size 20 --user app
doctl databases pool create <cluster-id> readonly-pool --db plexco --mode transaction --size 10 --user readonly
```

> **CHƯA ĐO:** pool của DO có thể chỉ chấp nhận user do DO quản lý (`doctl databases user create`). Nếu vậy, tạo
> trước `app` / `app_worker` / `readonly` bằng `doctl databases user create <cluster-id> <name>` rồi mới migrate
> (`migrate.ts` bỏ qua CREATE ROLE cho role đã có; đặt lại thuộc tính `NOSUPERUSER NOBYPASSRLS` nếu DO cấp khác).

**2.5 Trusted sources** (chỉ app + máy admin của owner), sau khi app đã tạo (§2.7):
`doctl databases firewalls append <cluster-id> --rule app:<app-id> --rule ip_addr:<your-ip>`.

**2.6 GitHub** — Settings → Environments → tạo `staging` (Required reviewers = owner; Deployment branches
tuỳ chọn) rồi thêm:

| Loại | Tên | Giá trị |
|---|---|---|
| secret | `DIGITALOCEAN_ACCESS_TOKEN` | token DO (scope tối thiểu cho apps + registry) |
| variable | `DOCR_REGISTRY` | `<registry-name>` (không phải bí mật) |
| variable | `STAGING_BASE_URL` | `https://<app>.ondigitalocean.app` (không dấu `/` cuối) |
| variable | `DO_APP_ID` | id app staging (sau §2.7) |
| variable | `DO_VPC_ID` | UUID VPC staging |

**2.7 Tạo app lần đầu** (workflow chỉ *update*; lần đầu cần image đã build). Build + push thủ công **một lần**
hoặc chạy workflow tới bước build rồi huỷ; lấy digest. Sau đó (spec không có secret → thêm giá trị ở console
hoặc spec cục bộ **không commit**):

```bash
yq -o=json infra/app.staging.yaml | jq --arg d "sha256:<64hex>" --arg v "<vpc-uuid>" \
  'walk(if type=="string" then gsub("__IMAGE_DIGEST__";$d) | gsub("__VPC_ID__";$v) else . end)' > spec.local.json
# thêm "value" cho mọi env `type: SECRET` (xem §3) trong spec.local.json; file này KHÔNG được commit
doctl apps create --spec spec.local.json; rm -f spec.local.json   # file chứa secret: xoá ngay (macOS: `rm -P` ghi đè trước khi xoá; không có trên Linux)
```

## 3. Inventory secret theo component (đặt ở DO, không ở GitHub)

| Secret | web | discovery | worker | job `migrate` | Ghi chú |
|---|:-:|:-:|:-:|:-:|---|
| `DATABASE_URL` | pooled `app` | pooled `readonly` | — | — | cùng KEY, khác giá trị theo component |
| `DATABASE_URL_DIRECT` | — | — | direct `app_worker` | — | pg-boss cần session/direct |
| `DATABASE_URL_MIGRATION` | — | — | — | role migration | **chỉ job này** |
| `GOOGLE_OAUTH_CLIENT_ID` / `_SECRET` | x | — | — | — | client OAuth **staging**; redirect `${APP_URL}/api/auth/google/callback` |
| `KMS_KEY_ID`, `KMS_ENCRYPTED_AUTH_PEPPER` | x | — | — | — | `KMS_PROVIDER=aws-kms` và `AWS_REGION` (mặc định `ap-southeast-1`, đổi nếu key ở region khác) là giá trị thường trong spec |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | x | — | — | — | IAM user chỉ `kms:Decrypt` trên key staging |
| `LINK_CODE_LOOKUP_HMAC_KEY` | x | — | — | — | `openssl rand -base64 32`; M3a/M3b dùng chung |

Không có: `SESSION_SECRET`, Facebook/Messenger, SePay (không có code đọc ở base — thêm khi slice tương ứng land);
`DATABASE_URL_LISTEN` (chưa có reader); `KMS_ENCRYPTED_CONNECTOR_PEPPER`, `ZALO_BOT_API_BASE` (tuỳ chọn, đã có
default; thêm khi M3a lên staging nếu cần tách key). Giá trị khác nhau giữa staging và production.

## 4. Chạy deploy

GitHub → Actions → **Deploy staging** → Run workflow, **chọn đúng branch/tag/commit muốn deploy ở ô "Use workflow from"** (workflow build đúng `github.sha`, không có input `ref`; nhờ vậy production kiểm được "SHA này đã qua staging" từ run) → owner Approve. Bằng chứng:
artifact `deployment-evidence-staging` (`image_digest`, `git_sha`, run URL) — dán vào go/no-go note.

Nếu fail: log nói rõ bước. `missing secret in live app: services/web/KMS_KEY_ID` = chưa đặt secret đó ở DO.
Deployment ERROR sau job `migrate` = migration lỗi; app trước đó vẫn phục vụ, **không** chạy down-migration
(forward-fix, §8 environments-setup).

## 5. Log và theo dõi lỗi

- Log là JSON mỗi dòng trên stdout/stderr, có `level`, `event`, `request_id`, `tenant_id` (không PII; redact
  theo tên key, xem `apps/web/lib/log.ts`). `x-request-id` được trả về ở route lệnh session để đối chiếu.
  Xem nhanh: `doctl apps logs <app-id> web --type run --follow`.
- **Forward log** là việc owner: DO App Platform hỗ trợ `log_destinations` (Papertrail / Datadog / Logtail /
  OpenSearch). Chọn nhà cung cấp rồi thêm block `log_destinations` vào cả hai spec (token là SECRET). Đề xuất
  mặc định: Logtail (Better Stack) hoặc Papertrail — gói free đủ cho staging; chưa chọn = chưa có retention
  ngoài 7 ngày của DO.
- **Error reporting**: chưa có vendor/dependency mới. Hook Sentry là backlog
  `observability-sentry-loglevel-readers` (`SENTRY_DSN` hiện chưa có reader). Tạm thời lỗi 500 của route lệnh
  session ghi `session_command_unhandled` kèm `request_id`/`tenant_id`; đặt alert trên log forwarder cho event này.
- Alert DO đã khai trong spec: deployment/domain failed, CPU, memory, restart count, p95 của `web`.

## 6. Production (chuẩn bị, KHÔNG tự chạy)

`infra/app.prod.yaml` + `deploy-production.yml` (dispatch-only; nhập `tag`, `digest`, `staging_run_id`,
`confirm == tag`; digest phải có thật trong DOCR kèm tag đó và SHA phải có một run deploy-staging xanh). Chỉ
promote, không build. Điều kiện trước khi owner chạy: (a) §1.1 outbound-IP gate đóng, (b) DB TLS verify (R2),
(c) R1 đã đo, (d) go/no-go note ký "go", (e) `production` environment + secret + variable
(`DO_APP_ID`, `DO_VPC_ID`, `APP_DOMAIN`, variable `PRODUCTION_BASE_URL`, `DOCR_REGISTRY`, secret token DO riêng) đã tạo, (f) app prod
đã tạo lần đầu như §2.7 với `infra/app.prod.yaml`.

## 7. Teardown / TTL (§9)

Staging có TTL 48–96h. **Chưa có automation huỷ tự động** (mở). Thủ công:

```bash
doctl apps delete <app-id> --force && doctl databases delete <cluster-id> --force
doctl vpcs delete <vpc-uuid> --force   # sau khi app + DB đã xoá; thu hồi token/AWS key tạm
```

Ghi owner + `expires_at` + cost ceiling vào go/no-go note khi tạo; quên huỷ = chi phí chạy tiếp.

## 8. Chưa kiểm chứng (không có Docker daemon / tài khoản DO khi viết)

- Image chưa build; PRE_DEPLOY job chạy `entrypoint.sh migrate` (mới thêm) chưa chạy trong image đã prune —
  đã kiểm `tsx` resolve được `packages/db/src/migrate.ts` từ `apps/bot` ở checkout, chưa kiểm trong image.
- `doctl apps spec validate`, `actionlint` chưa chạy (không cài). Spec/workflow chỉ được parse YAML.
- Hành vi DO với `digest:` + `${APP_URL}` + secret `EV[...]` gửi lại khi update chưa kiểm chứng; `wait-for-deployment.sh`
  giả định `doctl apps list-deployments -o json` trả `phase` + `spec` — kiểm ở lần chạy đầu.
- **R2 — TLS DB**: environments-setup §4 đòi verify CA + hostname; code không set `ssl` và image không có CA
  bundle của DO. Staging tạm dùng `sslmode=require` (mã hoá, chưa verify). Production cần follow-up (CA qua
  `${db.CA_CERT}` hoặc bundle trong image) trước go-live.
- R3 — `entrypoint.sh` role `migrate` giả định `pnpm --filter @plexco/bot exec` có `tsx` trong image runtime
  (prod dep của `apps/bot`).
