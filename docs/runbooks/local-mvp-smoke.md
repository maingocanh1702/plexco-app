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
**Không** tự sinh khoá mới bằng `openssl rand` cho DB đã seed: seed bị từ chối (`the slug "dev-club" belongs to a club the dev owner persona does not own`)
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
| 15 | Chạy hành trình người chơi tự động: lệnh ở §10 thêm `-g "player golden path"` | Test đăng một buổi mở ("Tự do tham gia") ở Dev Club, rồi cho người chơi seed vào buổi qua route tham gia của thành viên. Kết quả `1 passed`; nếu người chơi seed chưa là thành viên Dev Club, test tự bỏ qua (`1 skipped`) và in dòng "PLAYER GOLDEN PATH NOT RUN" |
| 16 | `/dev-login` → bấm nút **Người chơi** | Đăng nhập bằng persona người chơi. Persona này không quản trị CLB nào nên vào `/onboarding/new-club` |
| 17 | Mở `/me/sessions`, rồi `/me/charges` | `/me/sessions` có buổi vừa tạo, kèm tên sân và nhãn "Đã có chỗ". `/me/charges` có `100.000đ` ở "Dev Club" và không có nút trả tiền, mã QR hay thông tin ngân hàng |
| 18 | Mở `/discover` trong cửa sổ ẩn danh (không có phiên đăng nhập) | Trang hiển thị bình thường khi chưa đăng nhập. Chạy cục bộ thì danh sách trống, vì dòng projector công khai vẫn tắt (OPEN-B4) |
| 19 | Chat quản trị, cửa sổ 1: `/dev-login` → **Chủ CLB** → vào "Dev Club" → mở `/c/<tenantId>/chat` (thêm `/chat` sau `/c/<tenantId>` trên thanh địa chỉ) | Danh sách kênh có liên kết **Kênh chung**, trỏ tới `/c/<tenantId>/chat/<channelId>`. Chủ CLB và quản trị viên chat ở `/c/…` |
| 20 | Cửa sổ 2, một phiên trình duyệt riêng (Playwright dùng một browser context riêng cho vai này; làm tay thì dùng hồ sơ hoặc trình duyệt khác): `/dev-login` → **Đồng quản trị** → mở cùng `/c/<tenantId>/chat` | Cũng thấy **Kênh chung**. Ghi lại số trên huy hiệu "N tin chưa đọc" của kênh (không có huy hiệu = 0) |
| 21 | Cửa sổ 1: bấm **Kênh chung**, nhập một tin vào ô **Tin nhắn**, bấm **Gửi** | Cửa sổ 2, không tải lại trang: huy hiệu của **Kênh chung** tăng đúng 1 |
| 22 | Cửa sổ 2: bấm **Kênh chung** | Tin vừa gửi hiện trong khung tin nhắn; ở tab Network, `POST /api/chat/channels/<channelId>/read` trả `200` |
| 23 | Cửa sổ 1: gửi tin thứ hai | Cửa sổ 2 hiện tin thứ hai ngay, không tải lại; lời gọi `.../read` lại trả `200` |
| 24 | Cửa sổ 2: bấm **Quay lại** | Huy hiệu của **Kênh chung** biến mất (0 tin chưa đọc) |
| 25 | Kiểm duyệt bởi quản trị viên web, cửa sổ 2: bấm lại **Kênh chung**; ở tin thứ hai bấm **Ẩn tin** → chọn **Spam** → bấm **Ẩn tin** trong hộp thoại | Hàng đó thành dòng đã gỡ, có nút **Khôi phục**; cửa sổ 1, không tải lại, tin cuối hiện **"Tin nhắn đã bị gỡ."** |
| 26 | Cửa sổ 2: bấm **Khôi phục** → chọn **Lý do khác** → điền **Ghi chú (bắt buộc)** → bấm **Khôi phục** trong hộp thoại | Tin thứ hai hiện lại ở cả hai cửa sổ (cửa sổ 1 không tải lại) |
| 27 | Chat thành viên, cửa sổ 3 (phiên riêng như hàng 20): `/dev-login` → **Người chơi** → mở `/me/clubs` | Hàng "Dev Club" có nhãn "Thành viên" và liên kết **Trò chuyện**. Nếu người chơi seed chưa là thành viên "Dev Club": dừng ở đây; test tự bỏ qua (`skipped`) và in dòng "MEMBER CHAT GOLDEN PATH NOT RUN" |
| 28 | Cửa sổ 3: bấm **Trò chuyện** ở hàng "Dev Club", rồi bấm **Kênh chung** | Chuyển tới `/me/clubs/dev-club/chat`; **Kênh chung** trỏ tới `/me/clubs/dev-club/chat/<channelId>`. Thành viên không vào chat qua `/c/…` |
| 29 | Cửa sổ 1 (chủ CLB): mở `/c/<tenantId>/chat` → **Kênh chung**. Cửa sổ 3 gửi một tin, rồi cửa sổ 1 gửi một tin | Mỗi tin hiện ở cửa sổ bên kia, không tải lại |

Lệnh chạy tự động ở §10 chạy cả bốn test: hành trình host (hàng 1-14), hành trình người chơi (hàng 15-17), chat quản trị với kiểm duyệt (hàng 19-26) và chat thành viên (hàng 27-29); thêm `-g "player golden path"` để chỉ chạy hành trình người chơi.

## 10. Chạy tự động (Playwright, chỉ local)

Spec `apps/web/e2e/golden-path.spec.ts` chạy đúng click path ở trên trên server của bước 7, trong terminal khác:

```bash
GOLDEN_PATH_BASE_URL=http://localhost:3000 \
  pnpm --filter @plexco/web exec playwright test --config e2e/golden-path.config.ts
# tuỳ chọn: chụp màn hình từng bước vào một thư mục
GOLDEN_PATH_SCREENSHOT_DIR=/tmp/golden-path-shots GOLDEN_PATH_BASE_URL=http://localhost:3000 \
  pnpm --filter @plexco/web exec playwright test --config e2e/golden-path.config.ts
```

- Cùng một lệnh chạy cả bốn test, tuần tự (1 worker): `host golden path`, `player golden path`, `chat golden path` (chat quản trị và kiểm duyệt, hàng 19-26) và `member chat golden path` (hàng 27-29). Bốn test không cần biến nào ngoài ba biến `GOLDEN_PATH_*` bên dưới. `player` và `member chat` đi qua người chơi seed và cần người đó đã là thành viên "Dev Club"; nếu chưa, test tự bỏ qua (`skipped`) và in dòng "… NOT RUN: …". `/discover` không nằm trong test nào (chú thích đầu hành trình người chơi trong `apps/web/e2e/golden-path.spec.ts`), nên hàng 18 chỉ làm tay. Trang đó tải danh sách qua `/api/discover`, route này đọc DB bằng `DISCOVERY_DATABASE_URL`, DSN của role `readonly` (mẫu trong `.env.example`, trỏ DB `plexco`, không phải `plexco_smoke`; bước 5 đã đặt password cho role đó). Runbook này không có bước nào đặt biến đó (không sao chép `.env.example`, lệnh bước 7 cũng không truyền nó), và thiếu biến thì route từ chối phục vụ. **Hàng 18 chưa được chạy trong lần đóng Phase 3 này**, nên cách nối biến đó vào server chưa được thử.
- Một Postgres local và một cổng e2e dùng chung: mỗi lúc chỉ chạy **một** bộ test DB hoặc **một** lần e2e, không chạy song song. Không bao giờ `docker compose down -v`.
- Chạy lại được nhiều lần mà không cần dọn: tên CLB, slug và tên người chơi có hậu tố riêng mỗi lần chạy.
- Biến môi trường của spec: `GOLDEN_PATH_BASE_URL` (bắt buộc, gồm cả cổng, khớp `-p` ở bước 7; thiếu thì spec tự skip), `GOLDEN_PATH_SCREENSHOT_DIR` (tuỳ chọn),
  `GOLDEN_PATH_ALLOW_SEEDED_CLUB=1` (tuỳ chọn, xem dưới).
- **Một lần PASS nghĩa là cả đường đi đã được chứng minh, gồm cả tạo CLB.** Sản phẩm giới hạn **tạo CLB tối đa 3 lần/giờ/tài khoản** (`tenant-create`, trả
  `RATE_LIMITED` ở lần thứ 4). Từ lần thứ 4 trong cùng một giờ, spec mặc định **FAIL** với thông báo "Club creation was refused by the tenant-create limit ...":
  đợi hết giờ, hoặc dùng DB smoke mới (bộ đếm nằm trong DB; làm lại bước 2 → 6), hoặc chủ động chạy với `GOLDEN_PATH_ALLOW_SEEDED_CLUB=1`:
  khi đó spec đi tiếp trong "Dev Club" cho phần tiền và in ra dòng lớn `!!! GOLDEN PATH: club creation was NOT proven ... !!!` (cả lúc xảy ra lẫn ở cuối log;
  list reporter chỉ hiện stdout, không hiện annotation). Lần chạy kiểu này **không** được tính là đã kiểm tra tạo CLB.
- **Đọc kết quả (NOT_PROVEN): đọc cuối log, không chỉ dòng "N passed".**
  - `!!! GOLDEN PATH: club creation was NOT proven ... !!!`: chỉ có khi chạy với `GOLDEN_PATH_ALLOW_SEEDED_CLUB=1` mà giới hạn `tenant-create` đã từ chối tạo CLB; test host đi tiếp trong "Dev Club", **không** chứng minh tạo CLB. Reporter (`apps/web/e2e/support/golden-path-not-proven-reporter.ts`) chỉ in dòng này cho test mang annotation `club-create-throttled`: không có dòng thì không có annotation đó.
  - `PLAYER GOLDEN PATH NOT RUN: ...` hoặc `MEMBER CHAT GOLDEN PATH NOT RUN: ...` kèm `skipped`: chân đó **không chạy**; `skipped` không phải pass.
  - `4 passed`, không `skipped`, không dòng `!!! ... NOT proven ...`: cả bốn test đã chạy, gồm tạo CLB.
- Kết quả đo gần nhất: 2026-10-21, đo tại `0a4e1b8` (DB `plexco_smoke` migrate và seed, server `next dev -H 127.0.0.1 -p 3000` theo bước 4-7): `4 passed (2.1m)`: host 31.2s, player 54.9s, chat 25.2s, member chat 16.0s; không có `skipped`, reporter NOT_PROVEN không in dòng nào. Cờ registry `public_sessions`, `web_realtime`, `zalo_dm` đều `false` trước và sau lần chạy. Chỉ là một lần chạy local.
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
| Đăng nhập xong nhưng mất phiên giữa chừng; hoặc `dev:seed` báo `the slug "dev-club" belongs to a club the dev owner persona does not own` | `ENCRYPTION_KEY` của terminal này khác khoá đã dùng để seed (terminal mới, quên nạp) | **Không** sinh khoá mới và **không** seed lại. Chạy lại khối nạp khoá ở bước 6 (đọc `~/.plexco-smoke-encryption-key`) rồi khởi động lại server. Chỉ khi file khoá đã mất: xoá và tạo lại `plexco_smoke` (bước 6) |
| Log `[warm-up]` có dòng `POST ... -> 403` hoặc `GET ... -> 400` với id toàn số 0 (`00000000-0000-0000-0000-000000000000`) | Bước "warm up" gọi trước từng route bằng id giả chỉ để biên dịch route; helper chỉ ghi trạng thái, chỉ lỗi không trả lời mới làm fail | Bình thường: các dòng này xuất hiện trong chính lần chạy `4 passed` ở trên. Chỉ `warm-up: ... did not answer within ... s` là lỗi thật |

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
