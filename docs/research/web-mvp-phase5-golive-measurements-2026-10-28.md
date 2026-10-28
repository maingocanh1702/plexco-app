# Phase 5 (go-live): số đo giá DigitalOcean, PR #50 và thời gian lane Phase 4

Status: bản ghi số đo làm đầu vào cho kế hoạch Phase 5 (lane L61); không phải quyết định, không phải readiness verdict, không cho phép code. File này không chứa ước lượng Phase 5: người viết kế hoạch tự suy ra từ các số bên dưới.
Đo ngày 2026-10-28 tại `origin/main` `762045b3f5561ca0ed884095d5e334df0db90325`. Phạm vi: giá DigitalOcean (trang chính thức), PR #50, PR #114-#133 (Phase 4, 2026-10-26 đến 2026-10-28).

## 1. Phương pháp

- Giá: trang chính thức của DigitalOcean, truy cập 2026-10-28 bằng WebFetch (bản trích do model tạo; hàng bảng được trả nguyên văn) và WebSearch (kết quả là tóm tắt của công cụ tìm kiếm, ghi "search summary"). Ngày "Last verified" của từng trang ghi ở mục 2. Đơn vị USD mỗi tháng, giá list. `DD4` = `docs/decisions/analysis/dd-04-hosting-final-decision.md` tại `origin/main`; giá DD-04 "verified 2026-07-16" (`DD4:55`).
- PR #114-#133 và #50: `gh pr view <số> --repo maingocanh1702/plexco-app --json ...` (chỉ đọc), chạy 2026-10-28; giờ UTC (hậu tố Z) đổi sang Asia/Saigon (+07). #50: thêm `git fetch origin feat/mvp-m5-staging` rồi chỉ `git show`, `git diff --numstat`, `git rev-list`, `git merge-base`; không checkout, comment, push, rebase, đóng hay gắn nhãn.
- Loại PR do người đo xếp từ tiêu đề và đường dẫn file; `nondocs` = tổng additions + deletions của path không nằm dưới `docs/` (additions thô gồm cả verdict file và backlog row nên vượt phần code, ví dụ #132: 273 thô, 87 ngoài `docs/`).
- Thời gian lane và sự cố: hồ sơ chương trình local, ngoài repo (`status/CONDUCTOR-LOG.md`, 637 dòng lúc đo, ghi gọn `:N`; `status/P4-<ses>-report.md`, ghi `rpt:N`). Spawn = giờ entry đầu tiên thông báo run 1 (conductor ghi tay, trễ 0-8 phút nên mọi wall clock ±10 phút; wave 1 dùng giờ trong thân entry `:501`). Merge = `mergedAt` của gh. Wall = merge trừ spawn, không trừ khoảng nào (usage limit, park, chờ owner, CI nằm trong). Run = chỉ số run orchestrator cao nhất của lane (run thay thế sau usage limit có tính; clerk, worker, reviewer không tính).
- Nhãn: "tính ở đây" = người đo tự tính, kèm công thức; số không nhãn là nguyên văn nguồn; "≤" và "cận dưới" = nguồn chỉ cho giới hạn; "chưa kiểm lại" = không đo lại lần này và không vào tổng nào; "search summary" = tóm tắt tìm kiếm, không phải trang chính thức.
- Không chạy lệnh database, e2e, Playwright, docker hay doctl; không đọc giá trị secret (chỉ tên biến).

## 2. Giá DigitalOcean (trang chính thức, truy cập 2026-10-28)

Bảng thành phần, đối chiếu với cỡ DD-04 ghi:

| Thành phần | Cỡ DD-04 ghi | Giá đo 2026-10-28 | URL | Truy cập |
| --- | --- | --- | --- | --- |
| web x2 (scalable 1 GiB) | 2 x $12 = $24.00 (`DD4:102`) | `apps-s-1vcpu-1gb` $12.00/tháng mỗi cái (1 shared vCPU, 1 GiB, 150 GiB transfer); x2 = $24.00 (tính ở đây); khớp DD-04 | https://docs.digitalocean.com/products/app-platform/details/pricing/ | 2026-10-28 (trang: 26 Oct 2026) |
| discovery x2 | 2 x $12 = $24.00 (`DD4:103`) | cùng cỡ, $24.00 (tính ở đây); khớp | https://docs.digitalocean.com/products/app-platform/details/pricing/ | 2026-10-28 (trang: 26 Oct 2026) |
| worker x1 (fixed 1 GiB) | 1 x $10 = $10.00 (`DD4:104`) | `apps-s-1vcpu-1gb-fixed` $10.00/tháng (100 GiB transfer); trang không có giá worker riêng (cỡ x số lượng); khớp | https://docs.digitalocean.com/products/app-platform/details/pricing/ | 2026-10-28 (trang: 26 Oct 2026) |
| outbound transfer | buffer $0-8 (`DD4:110`) | gộp theo team, vượt mức $0.02/GiB, inbound miễn phí; mức cấp hình dạng Day-1 = 4 x 150 + 100 = 700 GiB/tháng (tính ở đây); khối lượng thật chưa đo; không vào tổng nào | https://docs.digitalocean.com/products/app-platform/details/pricing/ | 2026-10-28 (trang: 26 Oct 2026) |
| dedicated egress IP | gate DD-04 §7.1 (`DD4:170`), không có giá | "up to $25.00 per month", tính theo giây, tối thiểu 60 giây; search summary: $25 mỗi app, hai IP; không vào tổng nào | https://docs.digitalocean.com/products/app-platform/details/pricing/ | 2026-10-28 (trang: 26 Oct 2026) |
| PG primary 2 GiB / 1 vCPU | $30.45 (`DD4:64`) | Standard $30.45/tháng ($0.04531/giờ); 1 GiB $15.15, 2 GiB $30.45, 4 GiB $60.90, 8 GiB $122.10, 16 GiB $244.35; khớp (8 và 16 GiB: cluster Standard mới không dùng được sau mốc theo (a); trang giá không ghi ngày) | https://www.digitalocean.com/pricing/managed-databases | 2026-10-28 (trang không ghi ngày) |
| PG standby (Standard) | $30.45 (`DD4:64`, `DD4:105`) | trang giá PG không có giá standby; trang chi tiết: ví dụ "$30.00 ... matching standby node"; Advanced: "Standby nodes ... bill at the same rate as the primary node"; $30.45 chỉ theo quy tắc matching (tính ở đây); xem phát hiện (a) | https://docs.digitalocean.com/products/databases/postgresql/details/pricing/ | 2026-10-28 (trang: 30 Sep 2026) |
| PG Advanced (đường HA) | không có trong DD-04 | "Advanced Edition clusters begin at $130.00 per month for an 8 GiB RAM/2 vCPU primary node"; primary + 1 standby = 2 x $130.00 = $260.00 (tính ở đây, chưa tính storage; storage $0.115/GiB/tháng Advanced, $0.215 Standard) | https://docs.digitalocean.com/products/databases/postgresql/details/pricing/ | 2026-10-28 (trang: 30 Sep 2026) |
| PG region | sgp1 | PostgreSQL "SGP1: Available"; App Platform dynamic apps "SGP: Available"; app region `sgp` ứng với VPC `sgp1` | https://docs.digitalocean.com/platform/regional-availability/ và https://docs.digitalocean.com/products/app-platform/how-to/enable-vpc/ | 2026-10-28 (trang: 9 Oct 2026; 3 Sep 2026) |
| PG PITR, giới hạn | PITR | "Point-in-time-recovery (PITR) is limited to the last 7 days."; backend connections 1 GiB 22, 2 GiB 47, 4 GiB 97, 8 GiB 197; 21 PgBouncer pools | https://docs.digitalocean.com/products/databases/postgresql/details/limits/ | 2026-10-28 (trang: 8 Oct 2026) |
| Spaces | DD-04 dùng R2, không nêu Spaces | giá chưa kiểm lại; trang regional ghi SGP1 available | https://docs.digitalocean.com/platform/regional-availability/ | 2026-10-28 (trang: 9 Oct 2026) |
| Container Registry | DD-04 không nêu (grep "registry" = 0 hit trong DD-04 và `docs/standards/deployment-infra.md`) | giá chưa kiểm lại; trang regional ghi SGP1 available | https://docs.digitalocean.com/platform/regional-availability/ | 2026-10-28 (trang: 9 Oct 2026) |
| billing alerts | "monthly budget alerts" (DD-04 §7.6) | "Spend Alerts": email theo ngưỡng phần trăm của budget tự đặt; trang không nêu giá; trang spend-alerts chưa mở: chưa kiểm lại giá | https://docs.digitalocean.com/products/billing/ | 2026-10-28 (trang: 7 Oct 2026) |
| cảnh báo giám sát app và DB | DD-04 không định giá | chưa kiểm lại | - | - |
| Cloudflare, Sentry, AWS KMS, R2 và log | $0, $0, $1-3, $0-5 (`DD4:106-109`) | chưa kiểm lại: nhà cung cấp ngoài DO, ngoài danh sách domain được phép của phiên đo | - | - |

Tổng (chỉ giá list DO đã kiểm lại; dòng ngoài DO, buffer egress và storage không tính; mọi phép tính là "tính ở đây"):

| # | Hình dạng | Phép tính | Tổng |
| --- | --- | --- | --- |
| 1 | HA Day-1 như DD-04 ghi (Standard HA) | web 24.00 + discovery 24.00 + worker 10.00 + PG 30.45 + 30.45 | $118.90 = chính subtotal của DD-04 (`DD4:111`); với standby $30.00 theo ví dụ của trang chi tiết: $118.45; $120-135 của DD-04 còn cộng KMS $1-3, R2/log $0-5, egress $0-8 (chưa kiểm lại) |
| 2 | HA cho cluster MỚI sau thay đổi Standard (standby ở Advanced) | 58.00 + 2 x 130.00 | $318.00, chưa tính storage và dòng loại ra |
| 3 | Khởi đầu nhỏ nhất, không HA, không có discovery | web 1 x 12.00 + worker 1 x 10.00 + PG đơn nút 2 GiB 30.45 | $52.45 (PG 1 GiB $15.15 cho $37.15, nhưng chỉ 22 backend connection) |
| 4 | Staging tạm 48-96 giờ, một cửa sổ mỗi tháng | tổng #1 x giờ / 672 (cơ sở 730 giờ của DD-04, `DD4:61`: / 730) | trên #1: $8.49-16.99 (730 giờ: $7.82-15.64), cùng bậc với "$8-18/month" của `DD4:150`; trên #2: $22.71-45.43 (730 giờ: $20.91-41.82) |
| 5 | Staging tạm HA cho drill + production #3 (phương án thay của Q3) | #3 + #4 | trên #1: 52.45 + 8.49-16.99 = $60.94-69.44; trên #2: 52.45 + 22.71-45.43 = $75.16-97.88 (672 giờ) |

Cơ sở 672 giờ là giả định của người đo (từ chữ "first 28 days" của trang), trang App Platform ghi "billed for the first 28 days" và "prorated per second" nhưng không nêu mẫu số giờ; App Platform tính theo giây, database theo giờ. Hình dạng được chia là #1 và #2 (web x2, discovery x2), không phải spec staging của #50 (mỗi component x1, mục 3).

Hai phát hiện:

- (a) PostgreSQL Standard: "Beginning 15 October 2026 for new accounts and 30 November 2026 for all accounts, new Standard Edition clusters cannot use plans with more than 4 GiB of RAM or add standby or read-only nodes" (https://docs.digitalocean.com/products/databases/postgresql/details/pricing/ và https://docs.digitalocean.com/products/databases/postgresql/details/limits/, truy cập 2026-10-28). Tính từ ngày đo: mốc 15 Oct 2026 đã qua, mốc 30 Nov 2026 chưa tới. Tiền đề giá HA của DD-04 (2 x $30.45, `DD4:64`, verified 2026-07-16) không còn đúng cho cluster mới: đường HA là Advanced từ $130.00 mỗi nút, DB riêng $260.00 so với $60.90, tổng Day-1 $318.00 so với $118.90 (tính ở đây). Search summary, không phải trang chính thức: cluster đã tồn tại không bị ảnh hưởng; mốc 15 Oct dành cho tài khoản chưa từng tạo cluster PG hoặc MySQL. Tài khoản và cluster của owner thuộc trường hợp nào: chưa biết.
- (b) App Platform: "VPC network access and dedicated egress IPs cannot be enabled at the same time" (https://docs.digitalocean.com/products/app-platform/how-to/enable-vpc/, trang ghi "Last verified 3 Sep 2026", truy cập 2026-10-28). DD-04 đã ghi cùng ràng buộc làm hard gate (`DD4:172`); trang chính thức hiện vẫn ghi như vậy. Một app chọn egress IP cố định thì mất đường DB private; spec của #50 đi nhánh VPC private (không có block `databases:` hay egress, mục 3).

## 3. PR #50 (gh và git, đo 2026-10-28)

- `gh pr view 50 --repo maingocanh1702/plexco-app --json ...` (2026-10-28): OPEN, không phải draft; `mergeable: CONFLICTING`, `mergeStateStatus: DIRTY`; head `feat/mvp-m5-staging` @ `f3ceab77cf450c933bdb63b1ed940d604cdd7fb7` (= `git rev-parse origin/feat/mvp-m5-staging`); base `main`; tạo 2026-10-13T07:55:55Z, cập nhật 2026-10-14T03:53:15Z; 6 commit, 25 file, +1619 -25.
- Merge base `818edf4f17127614d34c33350f673199bbaa372b` (`git merge-base origin/main origin/feat/mvp-m5-staging`; commit 2026-10-13T09:46:54+07:00); `origin/main` đi trước merge base 1182 commit (`git rev-list --count 818edf4..origin/main`). 6 commit (`git log origin/main..origin/feat/mvp-m5-staging`): f3ceab7 review round 2, 59964db review round 1, 382ad8a runbooks, 75e7695 request id và tenant id trên mỗi log line, 25bb3f0 workflow staging deploy và production promotion, 8d857b0 App Platform specs.

Từng file (`git diff --numstat 818edf4 origin/feat/mvp-m5-staging`; đọc bằng `git show origin/feat/mvp-m5-staging:<path>`; `main:` = `origin/main` 762045b). Phân loại: "còn hiệu lực" = port nguyên; "port có sửa"; "stale" = đã mục như văn bản (ý còn đúng nếu ghi), vẫn port có sửa; "bỏ".

| # | Path | +/- | Phân loại | Nội dung và chỗ phải sửa khi port |
| --- | --- | --- | --- | --- |
| 1 | `.github/workflows/deploy-staging.yml` | +161 -0 | port có sửa | một job `staging`, chỉ `workflow_dispatch` (:23-24), gate check-run `verify` và `e2e-web` (:56-67), DOCR build một lần tag = SHA, `doctl apps update`, smoke; sửa `runs-on: ubuntu-latest` (:45) thành `ubuntu-24.04` như `main:.github/workflows/ci.yml:26-27`; chưa kiểm lại 3 action pin ngoài CI (doctl v2.5.2, buildx v4.4.1, build-push v7.4.0); bước 6 cần hàng 10; không có rollback step |
| 2 | `.github/workflows/deploy-production.yml` | +148 -0 | port có sửa | chỉ promotion, không build (:3); 4 input `tag`, `digest`, `staging_run_id`, `confirm` (:14-32); header: chưa chạy tới khi đóng `environments-setup.md` §1.1 và §10 và có "go" (:7-9); sửa `ubuntu-latest` (:51); không có rollback step |
| 3 | `infra/app.staging.yaml` | +153 -0 | stale (hình dạng còn đúng), port có sửa | không có block `databases:` hay egress (nhánh VPC private của DD-04 §7.1); thiếu `DISCOVERY_DATABASE_URL` và `DISCOVERY_CURSOR_KEY` (`main:apps/web/lib/discovery-route-support.ts:42-43`, `main:.env.example:68-69`), `KMS_ENCRYPTED_CONNECTOR_PEPPER` (`main:.env.example:145`), `ZALO_BOT_API_BASE` (`:147`), `GENDER_COLLECTION_ENABLED` (vắng = tắt, `main:apps/web/app/api/me/profile/route.ts:32`); lý do comment của worker `OUTBOX_DISPATCH_SCHEDULE_ENABLED "false"` cũ hơn DD-141 và migration 0056; SSE listener đã chạy trên app pool (`main:apps/web/lib/realtime-listener.ts:208`), tức pooler transaction-mode: câu hỏi mở §7.6 |
| 4 | `infra/app.prod.yaml` | +158 -0 | stale, port có sửa | như hàng 3, khác: `plexco-prod`, header "PREPARED, NOT APPLIED", web x2 và discovery x2, `__APP_DOMAIN__`; danh sách gate trong header nêu SePay/ApiPay, cần thu hẹp theo DD-04 §7.1 |
| 5 | `infra/render-app-spec.sh` | +66 -0 | còn hiệu lực | jq renderer, copy secret đã mã hóa từ spec sống, fail khi thiếu; `infra/` trên main chỉ có Dockerfile, docker-compose.yml, entrypoint.sh, fly.toml, postgres-init |
| 6 | `infra/render-app-spec.test.mjs` | +121 -0 | còn hiệu lực | `node:test`, 7 test; cần dây `test:infra` (hàng 25) |
| 7 | `infra/smoke-check.sh` | +19 -0 | còn hiệu lực | `/healthz` `.ok == true`, `/` là text/html, `/manifest.webmanifest` 2xx; trùng một phần `main:scripts/smoke-predeploy.mjs:7,31` (chỉ `/healthz`): một smoke hay hai do lane quyết |
| 8 | `infra/wait-for-deployment.sh` | +48 -0 | còn hiệu lực | poll `doctl apps list-deployments` mỗi 15 giây tới ACTIVE; hình dạng API doctl hiện tại chưa kiểm lại |
| 9 | `infra/entrypoint.sh` | +11 -1 | còn hiệu lực | thêm role `migrate` cho PRE_DEPLOY job; `git diff --stat 818edf4 origin/main -- infra/entrypoint.sh infra/Dockerfile` rỗng; lane kiểm lại `packages/db/src/migrate.ts` và tsx trong image |
| 10 | `apps/web/playwright.config.ts` | +19 -11 | stale, port có sửa | main nay có `webServer` là mảng 2 server với stub fake-postgres (`main:apps/web/playwright.config.ts:33-47`) nên hunk dạng object không áp; chạy suite stub trên origin thật chưa đo; main có `main:apps/web/e2e/golden-path.config.ts` |
| 11 | `apps/web/lib/log-context.ts` | +57 -0 | còn hiệu lực | AsyncLocalStorage, `requestIdFrom` nhận header khớp `/^[A-Za-z0-9._-]{8,64}$/`; main chưa có request-id correlation (`git grep` trên `origin/main`) |
| 12 | `apps/web/lib/log-context.test.ts` | +103 -0 | còn hiệu lực | test cho hàng 11 |
| 13 | `apps/web/lib/log.ts` | +7 -0 | còn hiệu lực | thêm `request_id` và `tenant_id` sau field đã làm sạch; main chỉ đổi danh sách redaction (`main:apps/web/lib/log.ts:20-22`) |
| 14 | `apps/web/lib/session-command-route.ts` | +24 -11 | stale (ý còn đúng), port có sửa | main viết lại file (+489 dòng, nay 866 dòng) nhưng 11 dòng #50 thay vẫn nguyên văn ở `main:apps/web/lib/session-command-route.ts:848-866`; chỉ một họ route được bọc; thêm header `x-request-id` trên response (hành vi nhìn thấy) |
| 15 | `apps/web/lib/tenant-lang.test.ts` | +2 -0 | port có sửa | thêm `"lib/log-context.ts": "c"` vào `SURFACE_BUCKETS` (`main:apps/web/lib/tenant-lang.test.ts:113`, cạnh `lib/log.ts` ở `:228`); bắt buộc khi hàng 11 port |
| 16 | `.env.example` | +11 -0 | port có sửa | chỉ 11 dòng comment; `LINK_CODE_LOOKUP_HMAC_KEY` và `APP_BASE_URL` đã là entry thật trên main (`main:.env.example:151`, `:111`); giữ ghi chú `AWS_ACCESS_KEY_ID` và `AWS_SECRET_ACCESS_KEY` "set trong DO" |
| 17 | `.gitignore` | +3 -0 | còn hiệu lực | ignore `spec.local.json` (chặn lộ secret); `.gitignore` của main không đổi từ merge base; đưa vào trước hoặc cùng runbook nhắc `spec.local.json` |
| 18 | `docs/runbooks/staging-deploy.md` | +178 -0 | stale, port có sửa | không có tương đương trên main; §3 gọi `KMS_ENCRYPTED_CONNECTOR_PEPPER` và `ZALO_BOT_API_BASE` là optional trong khi main đọc cả hai; thiếu `DISCOVERY_*` và bước bật projector (`main:docs/runbooks/outbox-dispatch-enable-rollback.md`); mọi bước doctl và console chỉ owner chạy |
| 19 | `docs/runbooks/pitr-restore-drill.md` | +94 -0 | port có sửa | §2 (`:19`) cho "owner or an agent with a DO token", trái quy tắc của chương trình (agent không giữ token DO, không chạm tài nguyên cloud); row `backup-pitr-drill` trên main `status: planned` (`main:docs/autopilot-backlog.md:5208-5210`) |
| 20 | `docs/runbooks/go-no-go-template.md` | +73 -0 | port có sửa | khuôn dùng được; §3 phải tạo lại từ báo cáo đóng Phase 4 (chưa so từng dòng) |
| 21 | `docs/runbooks/tenant-1-launch.md` | +67 -0 | port có sửa | khung "Tenant #1" lệch với pilot 1-2 club; §3 import từ bot cũ chưa đối chiếu DD-132 (chưa đo) |
| 22 | `docs/standards/environments-setup.md` | +23 -1 | port có sửa | hunk áp được (file không đổi trên main) nhưng khối "Implemented by" khẳng định một triển khai chưa từng merge; chỉ port cùng hàng 1-9; header status của file chưa đo |
| 23 | `docs/autopilot-backlog.md` | +70 -0 | bỏ | 5 row `## task:` không có slug nào trên main; hai row bị thay bởi `db-tls-ca-verification-do-managed-pg` (`main:docs/autopilot-backlog.md:5875`) và `staging-ttl-teardown-automation` (`:5892`); backlog main đã đổi 1992 dòng từ merge base |
| 24 | `docs/autopilot-invariant-catalog.md` | +1 -0 | còn hiệu lực (tùy chọn) | token invariant `infra`; chỉ có nghĩa với scope-gate lifecycle mà PR của chương trình Web MVP không chạy (CLAUDE.md, DD-122 D4) |
| 25 | `package.json` | +2 -1 | stale, port có sửa | thêm `test:infra` và nối vào `test`; `test` của main nay là `kit:check && guard:dev-login && test:review-readiness && pnpm -r run test` (`main:package.json:11`): chèn `pnpm run test:infra` vào dòng đó |

Đếm (tính ở đây): còn hiệu lực 10 (hàng 5-9, 11-13, 17, 24), port có sửa 8 (hàng 1, 2, 15, 16, 19-22), stale rồi port có sửa 6 (hàng 3, 4, 10, 14, 18, 25), bỏ 1 (hàng 23); tổng 25. Tên (không giá trị) mà hai workflow dùng: secret `DIGITALOCEAN_ACCESS_TOKEN`; var `DOCR_REGISTRY`, `DO_VPC_ID`, `DO_APP_ID`, `STAGING_BASE_URL`, `APP_DOMAIN`, `PRODUCTION_BASE_URL`; không có runtime secret nào trong GitHub (`DATABASE_URL_MIGRATION` chỉ ở job `migrate` trên DO).

Một lane mới từ main không cần gì từ #50: mọi phần còn hiệu lực đọc được bằng `git show origin/feat/mvp-m5-staging:<path>` và áp lại trên nhánh mới từ main, không checkout, rebase hay push #50, nên tránh được merge CONFLICTING/DIRTY. Phần port là code, infra, workflow và env, không phải docs-only. Phần chưa đọc kỹ hoặc chưa chạy: mục 5.

## 4. Số đo Phase 4 (PR #114-#133)

Kế hoạch #114 merge 2026-10-26 02:27 (+07) = 2026-10-25T19:27:28Z; #133 merge 2026-10-28 07:05 = 2026-10-28T00:05:05Z. Từ spawn lane đầu (10-26 02:45, `:501`) đến merge #133: 52 h 20 = 3140 phút (tính ở đây). Merge #115 (10-26 07:41) không phải lúc Phase 4 bắt đầu: wave 1 đã bị dừng một lần lúc 04:10 (`:504`); merge kế hoạch 02:27 là cận dưới an toàn. Merge theo ngày (+07, tính ở đây từ `mergedAt`): 10-26 11 PR, 10-27 5 PR, 10-28 4 PR = 20.

Theo class (lane L39-L60, L38 loại khỏi cột lane; class do người đo xếp, tiêu chí ngay dưới bảng; run = run orchestrator; mọi trung vị tính ở đây):

| Class | n | Lane | Wall lane: trung vị (khoảng) | Run: trung vị (khoảng) | Dòng ngoài `docs/` (khoảng) | PR mở→merge, phút: trung vị (khoảng) |
| --- | --- | --- | --- | --- | --- | --- |
| docs | 5 lane, 6 PR (thêm #114 của L38) | L51 L52 L53 L58 L59 | 4 h 40 (1 h 19 - 5 h 11) | 3 (1-4) | 0 | 27.5 (9-94) |
| small code (≤150 dòng) | 2 | L50 L60 (#122 #132) | 2 h 26.5 (2 h 01 - 2 h 52) | 2.5 (2-3) | 22-87 | 25 (13-37) |
| code | 7 | L39 L40 L43 L44 L45 L47 L49 | 6 h 50 (4 h 38 - 24 h 18) | 6 (4-8) | 214-1307 | 13 (11-30) |
| P1 code | 5 | L41 L42 L46 L48 L55 | 5 h 39 (2 h 13 - 8 h 11) | 4 (2-5) | 232-1444 | 12 (11-21) |
| cả hai | 19 lane, 20 PR | | 5 h 14 (1 h 19 - 24 h 18) | 4 (1-8); tổng 77 / 19 = 4.05 | | 13 (9-94) |

Class `config` và `research`: 0 (research nằm trong #114). P1 code = migration (#119 0072, #124 0073, #127 0074), RLS/role-isolation (#116), authz re-check dưới row lock (#126); #118 và #129 gần P1 nhưng không có migration, RLS hay authz nên xếp "code". Phút theo lane (từ bảng dưới): docs 79 228 280 296 311; small code 121 172; code 278 314 324 410 532 623 1458 (bỏ 14 h 20 chờ owner của L45: 598, trung vị vẫn 410); P1 133 314 339 344 491; cả 19: phần tử thứ 10 = 314. Gồm L38 như lane docs (288 phút, 3 run): n = 6, trung vị 4 h 44, run 3. PR mở→merge không phải thời lượng lane.

Theo lane (22 lane: 19 có PR; `rpt:N` = `status/P4-<ses>-report.md` dòng N; vòng review: s = số ghi trong dòng STATUS/RUN hoặc tiêu đề log, i = token "round N" cao nhất trong báo cáo, ±1; quy tắc spawn>merge xem bảng quy tắc):

| Lane (ses) | PR | Class | Spawn đầu (dòng log) | Merge | Wall | Run | Vòng review | Quy tắc |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| L39 (S1b) | #118 | code | 10-26 02:45 (`:501`) | 10-26 13:08 | 10 h 23 | 6 | 3 s (rpt:9) | a>a |
| L40 (S2b) | #121 | code | 10-26 13:01 (`:520`) | 10-26 18:15 | 5 h 14 | 5 | 3 i | a>a |
| L41 (S2a) | #119 | P1 code | 10-26 11:09 (`:515`) | 10-26 16:53 | 5 h 44 | 5 | 2 i | a>a |
| L42 (S3a) | #124 | P1 code | 10-26 17:06 (`:530`) | 10-26 22:20 | 5 h 14 | 4 | 1 i (≥1 ở `:544`) | a>b |
| L43 (S6c) | #131 | code | 10-27 20:25 (`:601`) | 10-28 01:49 | 5 h 24 | 6 | 3 i (≥2 ở `:616`) | d>d |
| L44 (S3b) | #125 | code | 10-26 18:17 (`:536`) | 10-27 01:07 | 6 h 50 (park 18:40-22:31) | 4 | 3 s (rpt:7) | a>b>c |
| L45 (S4b) | #133 | code | 10-27 06:47 (`:565`) | 10-28 07:05 | 24 h 18 (chờ owner 14 h 20; 9 h 58 nếu bỏ) | 6 | ≥1 (`:631`) | c>d |
| L46 (S5a) | #127 | P1 code | 10-27 09:16 (`:569`) | 10-27 11:29 | 2 h 13 | 2 | 2 i | c>c |
| L47 (S6a) | #130 | code | 10-27 20:50 (`:605`) | 10-28 01:28 | 4 h 38 | 4 | 3 i (≥1 ở `:614`) | d>d |
| L48 (S4a) | #126 | P1 code | 10-27 01:08 (`:554`) | 10-27 06:47 | 5 h 39 | 4 | 3 i (≥1 ở `:562`) | c>c |
| L49 (S5b) | #129 | code | 10-27 11:30 (`:572`) | 10-27 20:22 | 8 h 52 | 8 | 3 s (`:599`) | c>d |
| L50 (S3c) | #122 | small code | 10-26 16:44 (`:528`) | 10-26 18:45 | 2 h 01 | 2 | 1 s (rpt:7) | a>b |
| L51 (S1c) | #117 | docs | 10-26 07:50 (`:507`) | 10-26 13:01 | 5 h 11 | 4 | 3 i | a>a |
| L52 (S2c) | #120 | docs | 10-26 13:08 (`:521`) | 10-26 17:48 | 4 h 40 | 3 | 3 s (rpt:4) | a>a |
| L53 (S6b) | #128 | docs | 10-27 16:51 (`:587`) | 10-27 20:39 | 3 h 48 (merge giữ 19:16-20:22 chờ L49, `:597`) | 3 | 2 s (rpt:6) | d>d |
| L55 (S1a) | #116 | P1 code | 10-26 02:45 (`:501`) | 10-26 10:56 | 8 h 11 | 4 | 3 i | a>a |
| L58 (S0b) | #115 | docs | 10-26 02:45 (`:501`) | 10-26 07:41 | 4 h 56 | 3 | 3 i | a>a |
| L59 (S0c) | #123 | docs | 10-26 19:06 (`:539`) | 10-26 20:25 | 1 h 19 | 1 | 2 s (rpt:6) | b>b |
| L60 (S9) | #132 | small code | 10-28 02:14 (`:623`) | 10-28 05:06 | 2 h 52 | 3 | 3 s (`:628`) | d>d |

L54 chưa bắt đầu (date-gated, cửa sổ 2026-12-01 đến 2026-12-14, `:634`); L56 và L57 là lane có điều kiện, không chạy ở mặc định Q2/Q3 của owner (`:499`; kế hoạch "17 certain lanes plus 2 conditional", `:496`); L58, L59, L60 thêm sau kế hoạch (kế hoạch phủ L39-L57, `:503`). Đối chiếu phụ với `status/P4-ESTIMATE-INPUTS.md`: cùng số run cho 13 lane, wall clock lệch ≤ 1 phút. L45 là ngoại lệ chờ owner, không dùng làm mốc cho lane code.

Usage limit (429; mỗi lần giết toàn bộ agent đang chạy):

| # | Entry log (giờ entry) | Bắt đầu (khoảng) | Kết thúc | Phút |
| --- | --- | --- | --- | --- |
| 1 | `:504` (10-26 05:50) | 10-26 04:10 | reset 05:40 | 90 |
| 2 | `:509` (10-26 09:57) | 10-26 08:15 | owner gõ "continue" 09:53 (reset báo trước 10:40) | 98 |
| 3 | `:524` (10-26 15:13) | 10-26 13:38-13:41 | owner "continue" 15:09 (báo trước 16:30) | 89 |
| 4 | `:531` (10-26 17:30) | 10-26 17:10-17:14 | owner "continue" 17:25 (báo trước 17:40) | 13 |
| 5 | `:612` (10-27 23:28) | 10-27 khoảng 22:50 | reset 23:20 | 30 |
| 6 | `:626-627` (10-28 04:26, 04:29) | log không ghi; sau 03:25 (commit cuối thấy được) | reset 04:20, respawn 04:29 | ≤ 55 (cận); 30 là số chưa kiểm của conductor |

Tỷ lệ (tính ở đây): 5 stop đã kiểm = 320 phút, trung vị 89. Với stop 6 = 30: 350 phút, trung vị 59.5; với stop 6 = 55 (cận): 375 phút, trung vị 72. Trên span 3140 phút: 6 stop = 1 stop mỗi 8.7 h (52.33 / 6); thời gian chết 11.1% (350 / 3140) đến 11.9% (375 / 3140). 4 trong 6 stop rơi vào 10-26 (quy tắc a, 3 lane live), hai stop cuối dưới quy tắc d (tối đa 2 lane live; quy tắc b và c không có stop). Theo quy tắc (giờ hiệu lực ở bảng quy tắc dưới, span 3140 phút từ 10-26 02:45 ở trên; tính ở đây): (a) 4 stop trong 15 h 47 = 1 stop mỗi 3.9 h; (b) và (c) 0 stop trong 22 h 14; (d) 2 stop (5, 6) trong 14 h 19 (10-27 16:46 đến merge #133 lúc 07:05 10-28) = 1 stop mỗi 7.2 h, n = 2. Suy ra, log không nói: ít orchestrator song song thì ít lần chạm limit mỗi giờ. Stop 2-4 kết thúc khi owner gõ "continue" (sớm hơn reset báo trước); stop 6 kết thúc ở reset (không thấy "continue").

- Classifier từ chối: 2 lần (không phải 1). (1) L40 run 5, RQ3 (chạy lại e2e bị từ chối): `:533` (10-26 17:53), "answered B", orchestrator tiếp tục push và mở PR (#121 merge 18:15); giờ từ chối và ai trả lời: chưa đọc. (2) L45 run 2 (writer sub-agent chạy DB có khóa bị từ chối): AWAIT `:568` (10-27 09:15), owner trả lời phương án A `:613` (10-27 23:35): độ trễ owner khoảng 14 h 20 giữa hai giờ entry (tính ở đây; tin nhắn có thể sớm hơn chút). Chương trình không đứng yên: L46 spawn 09:16 (`:569`), L49 chạy một mình (`:573`); L45 chạy tiếp run 3-6 và merge #133 lúc 07:05 10-28 (7 h 30 sau câu trả lời).
- Mất đăng nhập ("Not logged in"): 1 lần trong Phase 4, `:516` (10-26 11:51): L39 run 5 chết lúc 11:35 (279k), run 6 (cuối của trần) spawn 11:51 = 16 phút; agent khác có chết cùng không: chưa đọc. `:496` cũng khớp grep nhưng chưa đọc. Lapse của Phase 3 nằm ngoài Phase 4 (`:412`, `:473-475`).

Quy tắc đồng thời (quy tắc owner trong log):

| Bản | Hiệu lực | Quy tắc | Dòng log |
| --- | --- | --- | --- |
| a | 10-26 02:45 đến 18:32 | tối đa 3 orchestrator lane cùng chạy, do kế hoạch đặt, không có entry quy tắc | `:501`, `:507`, `:515`, `:520-536` |
| b | 10-26 18:32 đến 22:45 | OWNER RULE 18:32: MỘT orchestrator lane + MỘT worker/reviewer/verifier, clerk chỉ khi không có worker; L42 và L44 bị park | `:537` (entry 18:36), `:538` |
| c | 10-26 22:45 đến 10-27 16:46 | OWNER RULE 22:45 (bản hai): tối đa 2 sub-agent cùng chạy tổng cộng; C20 thay C19 | `:549` (entry 22:49) |
| d | 10-27 16:46 trở đi | OWNER RULE 16:46: tối đa 2 lane song song (C22, D41); mỗi lane 1 orchestrator + tối đa 1 worker; tối đa 4 agent lane + 1 clerk; merge từng cái theo thứ tự kế hoạch | `:586` (entry 16:48) |

Tốc độ merge (tính ở đây, giờ merge ở bảng theo lane trên; điểm đầu khác nhau: (a) từ merge kế hoạch, (b)-(d) là khoảng giữa hai merge, (d) từ đầu quy tắc): dưới (a) 7 PR (#115-#121) trong 15.8 h từ merge kế hoạch (02:27) đến #121 (18:15) = 2.25 h mỗi PR; dưới (b)-(d) 12 PR (#122-#133), tức 11 khoảng từ merge #122 (18:45) đến merge #133 (07:05) trong 36.3 h = 3.3 h mỗi PR; riêng (d) 6 PR (#128-#133; #127 merge 11:29, trước 16:46) từ 10-27 16:46 đến merge #133 trong 14 h 19 = 2.4 h mỗi PR. Wall clock của một lane không ngắn đi dưới quy tắc chặt hơn; chỉ độ song song giảm.

Phiên lập kế hoạch P4-S0 (lane L38):

| Mục | Giá trị | Nguồn |
| --- | --- | --- |
| Bắt đầu | 10-25 21:39, run 1 (opus/max) | `:495` |
| Run 1 | đến 23:36, 112 tool call, 334,442 token, khoảng 116 phút | `:496` |
| Run 2 | 23:36 đến 01:02, 99 tool call, 314,793 token, khoảng 84 phút | `:497` |
| Run 3 | 01:02 đến 01:49 (STATUS của báo cáo) hoặc 01:53 (entry log), 109 tool call, 327,824 token, khoảng 47 phút | `:498`, `status/P4-S0-report.md:6,8` |
| Phiên | 4 h 14 từ bắt đầu đến entry log (4 h 10 đến 01:49 của báo cáo); 3 run | `:495-498` |
| Vòng review | 3 theo conductor (chưa đối chiếu báo cáo); `:498`: vòng 1 = 28 phát hiện (6 chặn), vòng 2 = 15 (2 chặn); nội dung vòng 3 chưa đọc | `:498` |
| Cổng owner | báo MERGE_READY #114 ở entry 01:53 (`:498`), duyệt gõ 02:25: khoảng 32 phút chờ owner (tính ở đây); PR #114 tạo 01:42, merge 02:27; bắt đầu đến merge 4 h 48 (tính ở đây) | `:498-499`, gh |

## 5. Chưa đo / chưa kiểm lại

Người đọc kế hoạch không nên coi các mục dưới đây là đã đo:

| Mục | Trạng thái |
| --- | --- |
| Giá: trang "PostgreSQL and MySQL plan changes" (link từ trang chi tiết giá PG, đường dẫn `/release-notes/upcoming/dbaas-plan-changes/`) | chưa mở; "cluster đã tồn tại không bị ảnh hưởng" chỉ có ở search summary; cỡ và giá Advanced chưa đối chiếu ở đó |
| Giá: Spend Alerts (https://docs.digitalocean.com/platform/billing/spend-alerts/), cảnh báo giám sát App Platform | trang đầu chưa mở, trang sau chưa tìm thấy; giá và giới hạn chưa kiểm lại |
| Giá: Spaces, Container Registry, Cloudflare, Sentry, AWS KMS, R2, Better Stack | chưa kiểm lại, không vào tổng nào; Container Registry: DD-04 không nêu nhưng workflow của #50 dùng DOCR (`DOCR_REGISTRY`) |
| Giá: gói Advanced shared-CPU | search summary nói "Basic Shared CPU plans arrive on Advanced on 15 Oct 2026"; trang how-to Advanced (verified 8 Oct 2026) nói "Basic - Shared CPU plans are not available for Advanced Edition"; chưa giải quyết, URL trang how-to không ghi trong hồ sơ đo; không định giá gói nào |
| Giá: cơ sở 672 giờ, khối lượng egress, tài khoản và cluster của owner có bị quy tắc Standard ảnh hưởng không | 672 giờ là giả định; egress thật chưa đo; trường hợp của owner chưa biết |
| Phase 4: giờ bắt đầu usage limit 6 | log không ghi (≤ 55 phút); chưa xem `status/P4-S4b-report.md`, `status/P4-S9-report.md` hay file heartbeat |
| Phase 4: giờ classifier từ chối của L40 và L45, ai trả lời "B", agent khác có chết lúc 11:35 10-26 không, `:496` | chưa đọc |
| Phase 4: số vòng review | "s" chỉ có cho L39 L44 L49 L50 L52 L53 L59 L60; còn lại là "i" (±1), L45 ≥ 1; báo cáo của L60 có token "round 4" mà log không giải thích (`:628` ghi vòng 3); vòng 3 của P4-S0 và đối chiếu với Run logs của `status/P4-S0-report.md` chưa làm |
| PR #50: phần chỉ đọc theo tiêu đề | `staging-deploy.md` §1, §2, §4, §5; thân `pitr-restore-drill.md`, `go-no-go-template.md`, `tenant-1-launch.md`; khối 21 dòng của `environments-setup.md`; `log-context.test.ts` ngoài số test |
| PR #50: chưa chạy hoặc chưa kiểm | `actionlint`, `doctl apps spec validate` (cần xác thực DO), build image (runbook #50 §8 ghi "unverified"); 3 action pin ngoài CI và hình dạng API doctl/App Platform hiện tại; scan credential chỉ phủ dạng `dop_v1_`, `AKIA`, `-----BEGIN ... PRIVATE KEY`, `postgres://user:pass@host` trên file đã liệt kê (0 file khớp, có control dương), không thay secret scan đầy đủ |
| PR #50: chưa giải quyết | worker của main có cần `LINK_CODE_LOOKUP_HMAC_KEY` không; import ở `tenant-1-launch.md` §3 có thuộc MVP scope không (DD-132); `observability-sentry-loglevel-readers` (`main:docs/autopilot-backlog.md:5195`, `status: planned`) có trùng log forwarding không |
