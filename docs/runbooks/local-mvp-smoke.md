# Runbook: smoke test Web MVP trên máy local (golden path)

> **Dành cho:** owner. Chạy thật trên Postgres local + `next dev`, đăng nhập bằng dev-login (không cần Google OAuth).
> **Phạm vi:** CHỈ máy local, database riêng `plexco_smoke`. Không dùng cho staging/production.
> **Cách chạy:** làm tuần tự các bước 1 → 8 (tay), rồi bước 9 (click path) hoặc bước 10 (tự động bằng Playwright).
> Lệnh và định danh trong code giữ nguyên, copy-paste được. Chạy mọi lệnh từ **thư mục gốc repo** (trừ khi có ghi chú khác).
> Cơ chế dev-login (điều kiện mở cổng, giới hạn đã biết): README, mục "Dev-login".

## Quy tắc an toàn (đọc trước)

- Chỉ làm việc trên database `plexco_smoke`. **Không** `DROP`/`ALTER` bất kỳ database nào khác (`plexco`, `plexco_test`, ...).
- **Không bao giờ** `docker compose down -v`: cờ `-v` xoá volume `plexco_pgdata`, mất toàn bộ database local.
- `ALTER DATABASE ... plexco.dev_login = 'on'` chỉ chạy trên DB local chuyên dụng này, không bao giờ trên DB dùng chung.
- Cổng 3000 phải trống (`lsof -iTCP:3000 -sTCP:LISTEN` không in gì). Nếu bận, đổi **cả hai** chỗ cho cùng một số cổng: `-p 3000` ở bước 7 và `GOLDEN_PATH_BASE_URL=http://localhost:3000` ở bước 10 (và địa chỉ ở bước 8). Bước 7 có `-p` tường minh nên Next báo lỗi `EADDRINUSE` thay vì tự chuyển sang 3001 trong khi trình duyệt và spec vẫn nhắm 3000.

## 1. Khởi động Postgres

```bash
docker compose -f infra/docker-compose.yml up -d postgres
docker compose -f infra/docker-compose.yml ps postgres   # chờ STATUS = healthy
```

Lưu ý: nếu container được tạo từ một thư mục repo khác, `up -d` tạo lại container (mount `postgres-init` đổi đường dẫn).
Dữ liệu nằm trong volume `plexco_pgdata` nên không mất; chờ lại `healthy` rồi làm tiếp.

Cảnh báo của compose `Found orphan containers ([plexco-queue-provision-1])` vô hại ở đây (container cũ không thuộc file compose này), cứ bỏ qua. Chạy compose từ một đường dẫn checkout khác sẽ tạo lại `plexco-postgres-1`; volume và dữ liệu vẫn còn.

## 2. Tạo database smoke riêng (bằng superuser `plexco`)

```bash
docker compose -f infra/docker-compose.yml exec -T postgres \
  psql -U plexco -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE plexco_smoke"
```

Chạy lại bước này khi đã có DB sẽ báo `already exists`: muốn làm lại từ đầu thì xoá DB smoke theo mục "Dọn dẹp" rồi tạo lại.

## 3. Bootstrap definer roles (bằng superuser, TRƯỚC khi migrate)

Migration `0054` đòi role `identity_definer`; role này do bước bootstrap tạo. Phải chạy **trước** bước 4.

```bash
DATABASE_URL_MIGRATION=postgres://plexco:plexco_dev@localhost:5432/plexco_smoke pnpm db:bootstrap
```

`pnpm db:bootstrap` cần `psql` trên máy host. Máy chỉ có Docker (không có `psql`): cài `brew install libpq` rồi
`export PATH="/opt/homebrew/opt/libpq/bin:$PATH"`, hoặc dùng `psql` của chính container, đủ cả 3 file theo đúng thứ tự:

```bash
for f in 01-job-definer 02-chat-definer 03-identity-definer; do
  docker compose -f infra/docker-compose.yml exec -T postgres \
    psql -U plexco -d plexco_smoke -v ON_ERROR_STOP=1 -f - < infra/postgres-init/$f.sql; done
```

Các thông báo `NOTICE: role "plexco" has already been granted membership ...` là bình thường (idempotent).

## 4. Migrate

```bash
DATABASE_URL_MIGRATION=postgres://plexco:plexco_dev@localhost:5432/plexco_smoke \
  pnpm --filter @plexco/db migrate
```

Kết quả mong đợi: `[migrate] applied=<N> skipped=0` trên DB mới (lần chạy sau: `applied=0 skipped=<N>`).

## 5. Đặt password cho 3 role runtime (AP-33)

```bash
docker compose -f infra/docker-compose.yml exec -T postgres \
  psql -U plexco -d plexco_smoke -v ON_ERROR_STOP=1 \
    -c "ALTER ROLE app        WITH PASSWORD 'plexco_dev_app'" \
    -c "ALTER ROLE app_worker WITH PASSWORD 'plexco_dev_worker'" \
    -c "ALTER ROLE readonly   WITH PASSWORD 'plexco_dev_readonly'"
```

**Chạy lại bước này SAU MỖI lần chạy test** (`pnpm -w test`, `pnpm --filter @plexco/db test`, `pnpm --filter @plexco/bot test`,
`pnpm --filter @plexco/web test`): ba role là **cluster-global** và các suite tự `ALTER ROLE` sang password riêng của chúng,
không suite nào khôi phục. Quên bước này, dev-login/seed báo lỗi đăng nhập DB (`password authentication failed for user "app"`).

## 6. Bật dev-login cho DB smoke và seed persona

```bash
docker compose -f infra/docker-compose.yml exec -T postgres \
  psql -U plexco -d plexco_smoke -v ON_ERROR_STOP=1 \
    -c "ALTER DATABASE plexco_smoke SET plexco.dev_login = 'on'"
```

Khoá `ENCRYPTION_KEY` quyết định danh tính persona (định danh persona băm theo khoá, `apps/web/lib/dev-login/persona-account.ts`), nên
phải là **một khoá cố định** cho cả đời DB `plexco_smoke`: seed và dev server phải dùng đúng cùng khoá, ở mọi terminal, mọi ngày.
Lưu khoá **một lần** vào file local **ngoài repo**, quyền 600, rồi nạp lại bằng đúng khối lệnh này ở **mỗi terminal mới**
(khối idempotent: lần đầu tạo file, các lần sau chỉ đọc):

```bash
KEY_FILE="$HOME/.plexco-smoke-encryption-key"
[ -s "$KEY_FILE" ] || (umask 077 && openssl rand -base64 32 > "$KEY_FILE")
chmod 600 "$KEY_FILE"
export ENCRYPTION_KEY="$(cat "$KEY_FILE")"
DATABASE_URL=postgres://app:plexco_dev_app@localhost:5432/plexco_smoke pnpm dev:seed
```

Seed tạo CLB "Dev Club" và 3 persona `@dev.invalid`: owner ("Chủ CLB"), co_admin, player. Idempotent **khi dùng đúng khoá cũ**: chạy lại không hại.
Ngày hôm sau / terminal mới: chạy lại khối trên (nó nạp đúng khoá đã lưu; `dev:seed` chạy lại thành công, không cần seed lại) rồi sang bước 7.
**Không** tự sinh khoá mới bằng `openssl rand` cho DB đã seed: seed bị từ chối (`slug dev-club belongs to a club the persona does not own`)
và **mỗi lần thử bị từ chối còn để lại thêm 3 tài khoản persona mồ côi**. Nếu file khoá đã **mất**, cách duy nhất là xoá và tạo lại **chỉ** `plexco_smoke`:
dừng server, làm mục "Dọn dẹp" (bước 2 `DROP DATABASE plexco_smoke`), rồi làm lại bước 2 → 6 (xoá file khoá cũ nếu còn, khối trên sẽ tạo khoá mới).

## 7. Chạy web app (terminal này giữ nguyên, để chạy nền)

```bash
PLEXCO_DEV_LOGIN=1 TRUSTED_INGRESS_PROVIDER=direct DB_EXPECTED_ROLE=app KMS_PROVIDER=local \
  DATABASE_URL=postgres://app:plexco_dev_app@localhost:5432/plexco_smoke \
  pnpm --filter @plexco/web dev -H 127.0.0.1 -p 3000
```

Terminal này phải đã chạy khối nạp `ENCRYPTION_KEY` ở bước 6. Bắt buộc `-H 127.0.0.1` (không `localhost`, không bỏ `-H`); `-p 3000` để tường minh cổng (đổi thì đổi cả bước 10). Chỉ truyền `PLEXCO_DEV_LOGIN` trên dòng lệnh, **không** đặt vào `.env*`.
Server sẵn sàng khi console in `Ready in ...`. Kiểm nhanh (terminal khác): `curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/dev-login`
phải ra `307` (404 = cổng đóng, xem mục "Xử lý sự cố").

## 8. Mở trình duyệt

Mở **`http://localhost:3000/dev-login`** (cổng = `-p` ở bước 7) (Next chuyển hướng về `localhost` dù server bind `127.0.0.1`; mở thẳng `127.0.0.1` cũng được).
Trang phải có ghi chú "CHỈ DÀNH CHO DEV" và 3 nút persona.

## 9. Click path golden path (làm tay)

Mỗi bước kèm điều phải thấy trên màn hình (giao diện mặc định tiếng Việt).

| # | Làm gì | Phải thấy |
|---|---|---|
| 1 | `/dev-login` → bấm nút **Chủ CLB** | Đăng nhập. Lần đầu vào thẳng "Dev Club"; các lần sau (owner có nhiều CLB) vào màn chọn CLB |
| 2 | Mở `/onboarding/new-club`, nhập **Tên câu lạc bộ** duy nhất (vd. `Smoke CLB 01`) | Ô "Đường dẫn câu lạc bộ" tự điền slug (`smoke-clb-01`) |
| 3 | Bấm **Tạo câu lạc bộ** | Chuyển tới trang CLB mới, tiêu đề "Chào mừng bạn!". Đã tạo 3 CLB trong giờ qua bằng persona này: bị từ chối "Bạn thử quá nhiều lần. ..." (giới hạn 3 CLB/giờ), vào "Dev Club" làm tiếp |
| 4 | Bấm **+ Tạo buổi mới** | Form "Tạo buổi chơi mới" |
| 5 | Chọn môn, đặt **Bắt đầu**/**Kết thúc** ở tương lai, **Tên sân / địa điểm**, **Địa chỉ**, **Giá mỗi người (VND)** = `100000`, bấm **Tạo bản nháp** | Ô giá tự thành `100.000`. Trang buổi hiện nhãn "Nháp"; tab "Chi tiết" có tên sân, địa chỉ và `100.000đ` |
| 6 | Bấm **Đăng kèo** → xác nhận **Đăng kèo** | Toast "Đã đăng kèo.", nhãn đổi sang "Đang mở" |
| 7 | Tab **Người chơi** → **Thêm người chơi**, thêm 2 người (tên bất kỳ, vd. "An", "Bình") | Toast "Đã thêm <tên>"; mỗi hàng: "Còn 100.000đ / 100.000đ" + "Chưa thanh toán" |
| 8 | Bấm **Đóng buổi** → xác nhận **Đóng buổi** | Bị từ chối (`CLOSE_BLOCKED_OPEN_DEBT`): "Còn người chơi chưa trả đủ tiền — thu đủ trước khi đóng kèo." và danh sách "Người chơi còn thiếu tiền:" có cả hai tên. Bấm **Mở danh sách người chơi** |
| 9 | Tick người chơi A → **Gạch nợ (1)** → "Tiền mặt" → **Xem trước** → sửa số tiền thành `40.000` → **Xác nhận** → **Xong** | Hàng của A: **"Còn 60.000đ / 100.000đ"** + "Trả một phần" |
| 10 | Bấm **Huỷ buổi** → xác nhận **Huỷ buổi** | Bị từ chối (`CANCEL_REQUIRES_REVIEW`): "Kèo này cần được xem xét trước khi huỷ." + gợi ý hoàn tác thanh toán trước. Bấm **Mở danh sách người chơi**; buổi vẫn "Đang mở" |
| 11 | Thu nốt A (mặc định `60.000`) và thu đủ B (mặc định `100.000`) bằng Tiền mặt | Cả hai hàng "Đã thanh toán" |
| 12 | Mở "Chi tiết thanh toán" của A → **Hoàn tác** khoản `60.000đ` → nhập lý do → **Hoàn tác** | Toast "Đã hoàn tác 60.000đ của <A>"; A lại "Còn 60.000đ / 100.000đ" (nợ mở lại) |
| 13 | Thu lại `60.000` cho A | A "Đã thanh toán" |
| 14 | Bấm **Đóng buổi** → xác nhận **Đóng buổi** | Toast "Đã đóng buổi."; nhãn "Đã đóng"; "Buổi này chỉ để xem."; tải lại trang vẫn "Đã đóng" |

## 10. Chạy tự động (Playwright, chỉ local)

Spec `apps/web/e2e/golden-path.spec.ts` chạy đúng click path ở trên trên server của bước 7, trong terminal khác:

```bash
GOLDEN_PATH_BASE_URL=http://localhost:3000 \
  pnpm --filter @plexco/web exec playwright test --config e2e/golden-path.config.ts
# tuỳ chọn: chụp màn hình từng bước vào một thư mục
GOLDEN_PATH_SCREENSHOT_DIR=/tmp/golden-path-shots GOLDEN_PATH_BASE_URL=http://localhost:3000 \
  pnpm --filter @plexco/web exec playwright test --config e2e/golden-path.config.ts
```

- Chạy lại được nhiều lần mà không cần dọn: tên CLB, slug và tên người chơi có hậu tố riêng mỗi lần chạy.
- Biến môi trường của spec: `GOLDEN_PATH_BASE_URL` (bắt buộc, gồm cả cổng, khớp `-p` ở bước 7; thiếu thì spec tự skip), `GOLDEN_PATH_SCREENSHOT_DIR` (tuỳ chọn),
  `GOLDEN_PATH_ALLOW_SEEDED_CLUB=1` (tuỳ chọn, xem dưới).
- **Một lần PASS nghĩa là cả đường đi đã được chứng minh, gồm cả tạo CLB.** Sản phẩm giới hạn **tạo CLB tối đa 3 lần/giờ/tài khoản** (`tenant-create`, trả
  `RATE_LIMITED` ở lần thứ 4). Từ lần thứ 4 trong cùng một giờ, spec mặc định **FAIL** với thông báo "Club creation was refused by the tenant-create limit ...":
  đợi hết giờ, hoặc dùng DB smoke mới (bộ đếm nằm trong DB; làm lại bước 2 → 6), hoặc chủ động chạy với `GOLDEN_PATH_ALLOW_SEEDED_CLUB=1`:
  khi đó spec đi tiếp trong "Dev Club" cho phần tiền và in ra dòng lớn `!!! GOLDEN PATH: club creation was NOT proven ... !!!` (cả lúc xảy ra lẫn ở cuối log;
  list reporter chỉ hiện stdout, không hiện annotation). Lần chạy kiểu này **không** được tính là đã kiểm tra tạo CLB.
- Mỗi tài khoản chỉ được ~60 lời gọi `/api/sessions...` mỗi 60 giây; spec tự giãn nhịp để chạy hai lần liên tiếp không bị `429` ("Bạn thao tác quá nhanh").
  Lần chạy thứ hai ngay sau lần đầu có thể chờ tới ~1 phút ở đầu: bình thường, không phải treo.
- Timeout rộng có chủ ý (`apps/web/e2e/support/golden-path-timeouts.ts`: cả bài 20 phút, mỗi assertion/điều hướng 4 phút, mỗi thao tác 2 phút). `next dev` biên dịch từng route ở lần gọi đầu và **bỏ trang rảnh sau ~60 giây**, nên **mọi lần chạy** đều biên dịch lại một phần, không chỉ lần đầu; máy đang tải nặng có route mất tới ~113 giây. Đầu mỗi lần chạy spec có bước "warm up the dev server" gọi trước mọi trang và API route của luồng (log `[warm-up] ... in N ms`); log đứng lâu ở bước đó là bình thường, không phải treo.
- Spec **không chạy trong CI**: `apps/web/playwright.config.ts` loại nó bằng `testIgnore`, không workflow nào nhắc tới nó. Thiếu `GOLDEN_PATH_BASE_URL` thì nó tự skip.
- Spec dùng config riêng và **không** tự bật web server (giống `dev-login-browser`): server bước 7 phải đang chạy.
- Lỗi sản phẩm ở một bước: spec dừng tại bước đó (xem `test.step` trong log) và giữ trace `apps/web/test-results/`; mở bằng `pnpm --filter @plexco/web exec playwright show-trace <trace.zip>`.

## Xử lý sự cố

| Triệu chứng | Nguyên nhân thường gặp | Cách xử lý |
|---|---|---|
| `/dev-login` trả **404** | Cổng dev-login đóng | Đọc console của dev server: dòng `auth.dev_login.gate_closed` ghi lý do (`bind` = thiếu `-H 127.0.0.1`; `database_not_opted_in` = quên `ALTER DATABASE ... plexco.dev_login`, bước 6; ...). Lý do chỉ có ở console, không bao giờ trong response |
| `migrate` từ chối `0054`/`0055` với **checksum mismatch** | DB local đó đã áp một bản cũ của migration | Dùng DB chuyên dụng **mới**: xoá `plexco_smoke` (mục "Dọn dẹp") rồi làm lại từ bước 2. Không sửa bảng lịch sử migration bằng tay |
| `migrate` lỗi thiếu role `identity_definer` | Bỏ qua/đảo thứ tự bước 3 | Chạy bước 3 rồi bước 4 lại |
| `password authentication failed for user "app"` | Một lần chạy test đã đổi password cluster-global | Chạy lại bước 5 |
| `pnpm db:bootstrap`: `psql: command not found` | Máy host không có `psql` | Dùng cách `psql` trong container ở bước 3 |
| Server báo `EADDRINUSE` (cổng bận) | Tiến trình khác đang giữ cổng | Dừng nó, hoặc đổi `-p` ở bước 7 **và** `GOLDEN_PATH_BASE_URL` ở bước 10 sang cùng cổng khác |
| Màn "Bạn thao tác quá nhanh. Đợi một lát rồi thử lại." | Quá ~60 lời gọi API buổi chơi/phút cho một tài khoản (bấm tay quá nhanh, hoặc chạy spec song song/ngoài spec) | Đợi 1 phút rồi bấm **Thử lại** |
| Spec đứng lâu (bất kỳ lần chạy nào) | `next dev` biên dịch route ở lần gọi đầu và bỏ trang rảnh sau ~60 giây | Bình thường, đặc biệt khi máy tải nặng; timeout rộng (bài 20 phút, assertion 4 phút). Xem log `[warm-up]` |
| Spec FAIL "Club creation was refused by the tenant-create limit" | Đã tạo 3 CLB trong giờ qua bằng persona này | Đợi hết giờ, hoặc DB smoke mới, hoặc `GOLDEN_PATH_ALLOW_SEEDED_CLUB=1` (không chứng minh tạo CLB) |
| Đăng nhập xong nhưng mất phiên giữa chừng; hoặc `dev:seed` báo `slug dev-club belongs to a club the persona does not own` | `ENCRYPTION_KEY` của terminal này khác khoá đã dùng để seed (terminal mới, quên nạp) | **Không** sinh khoá mới và **không** seed lại. Chạy lại khối nạp khoá ở bước 6 (đọc `~/.plexco-smoke-encryption-key`) rồi khởi động lại server. Chỉ khi file khoá đã mất: xoá và tạo lại `plexco_smoke` (bước 6) |

## Dọn dẹp

1. Dừng dev server: `Ctrl+C` ở terminal bước 7.
2. (Tuỳ chọn) xoá **chỉ** database smoke, đúng tên, khi không còn kết nối nào tới nó (đã dừng server):

```bash
docker compose -f infra/docker-compose.yml exec -T postgres \
  psql -U plexco -d postgres -v ON_ERROR_STOP=1 -c "DROP DATABASE plexco_smoke"
```

Cấm: `docker compose down -v`; `DROP`/`ALTER` bất kỳ database nào khác (`plexco`, `plexco_test`, ...). Có thể để Postgres chạy tiếp
(`docker compose -f infra/docker-compose.yml stop postgres` nếu muốn tắt, vẫn **không** kèm `-v`). Các role `app`, `app_worker`,
`readonly` và 3 definer là cluster-global, dùng chung với DB khác: không xoá.
