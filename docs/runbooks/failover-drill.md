# Runbook: diễn tập failover trên cửa sổ HA staging tạm (owner, staging)

## 0. Thẩm quyền và quy tắc

> **Dành cho:** owner, người làm mọi bước và là người chứng kiến. Agent không chạy bước nào ở đây: không mở console, không chạy `doctl`, không cầm token DigitalOcean (DD-154, `docs/standards/decisions.md:1796`).
> **Nguồn:** bản ghi DD-04 §7.6 mục 3 (`docs/decisions/analysis/dd-04-hosting-final-decision.md:285`), mục 4 (`docs/decisions/analysis/dd-04-hosting-final-decision.md:286-287`), mục 7 (`docs/decisions/analysis/dd-04-hosting-final-decision.md:290`), mục 8a và 8b (`docs/decisions/analysis/dd-04-hosting-final-decision.md:291`); bước 8.7 của PLAN (`docs/sessions/web-mvp-phase5-golive-plan.md:203`); DD-154 (`docs/standards/decisions.md:1785`) và hệ quả (b) của nó (`docs/standards/decisions.md:1823`).
> **Trạng thái:** viết sẵn, **chưa chạy**; bảng §8 trống có chủ ý.

- Chỉ chạy trên **cửa sổ staging tạm HA** (hình dạng 4, 48-96 giờ, `docs/sessions/web-mvp-phase5-golive-plan.md:141`), do owner tạo và xoá. Production pilot là PostgreSQL một nút, **không có standby** (DD-154 (a), `docs/standards/decisions.md:1822`): runbook này không khẳng định production có failover. Production lên HA "before money flows or before adding more clubs" (`docs/standards/decisions.md:1824`).
- Mọi bước DigitalOcean, console hay cloud: **Người làm: OWNER**. Credential chỉ ghi bằng TÊN biến (`HA_ADMIN_URL` và các biến ở §5); owner tự đặt chúng trong shell của mình, không ghi giá trị vào file, chat hay runbook này.
- SQL ở đây chỉ là `SELECT`, chạy trong phiên chỉ đọc như `docs/runbooks/pitr-restore-drill.md` §6. Không có câu ghi nào: dữ liệu test và mọi thay đổi đều đi qua UI của app staging.
- Thứ tự: §1 → §3, cùng lúc với §4.1 và hai lần đếm của §7 → §4.2 → §5 → §6 → đóng cửa sổ (§1 bước 5).

## 1. Điều kiện trước (Người làm: OWNER)

1. Mở cửa sổ: một cluster PostgreSQL có ít nhất một standby, cùng VPC với app staging; ghi `T_open` (UTC) và id của cluster.
2. Dựng bốn role và các URL theo `docs/standards/environments-setup.md:178` (biến ở §5); app staging chạy SHA đã deploy của `main` (ghi SHA) trên cluster này; `infra/smoke-check.sh https://<staging-app>` xanh.
3. Dữ liệu test chỉ qua UI của app staging, bằng tài khoản test: một CLB test và một buổi test. Không dùng dữ liệu production.
4. Host chạy `psql` của owner nằm trong VPC của cửa sổ (đường private, cho §5); trusted source tạm nào thêm cho host đó thì ghi tên mục để gỡ ở §6.
5. Đóng cửa sổ (sau §6): đưa app staging về cấu hình trước cửa sổ, xoá cluster HA tạm, thu hồi credential tạm; ghi `T_close`.

**Pass:** bước 1-3 xong trước §3; bước 5 xong, cluster không còn trong console và `T_close` − `T_open` ≤ 96 giờ.

## 2. Hàng evidence và người chứng kiến

- Mỗi mục §1, §3-§7 ghi **một hàng** ở §8 ngay khi xong: ngày (UTC), người chạy, cửa sổ và SHA, các mốc (UTC), điều quan sát được (giá trị, dòng log, điều thấy trên trình duyệt), kết quả, chứng kiến = owner. Không ghi giá trị secret, URL hay IP.
- `Kết quả` ∈ `PASS` · `FAIL` · `INVALID` (Q0 false, §4.2) · `OPEN` (không chứng minh được trong cửa sổ này: §3 không có cách kích hoạt được tài liệu hoá, hoặc §5 không chạy được từ đường private hay thiếu URL của một role) · `OBSERVED` (chỉ §7, không bao giờ là FAIL). Mục 3, 4, 7, 8a, 8b chỉ xong khi `PASS`.
- Append-only: chạy lại là thêm hàng mới, không sửa hàng cũ. Hàng §8 cùng kết quả VIẾT của owner (bước 8.7) là bằng chứng G3 cho mục 7 (`docs/sessions/web-mvp-phase5-golive-plan.md:252`), mục 4 (`docs/sessions/web-mvp-phase5-golive-plan.md:254`), 8a (`docs/sessions/web-mvp-phase5-golive-plan.md:255`), 8b (`docs/sessions/web-mvp-phase5-golive-plan.md:256`) và mục 3 (`docs/sessions/web-mvp-phase5-golive-plan.md:264`).

## 3. Diễn tập sự cố primary (mục 7; Người làm: OWNER)

### 3.1 Chuẩn bị

Ghi `T_begin` (UTC) trước mọi thao tác dưới đây. Trình duyệt A (tài khoản test sửa được buổi test) và trình duyệt B (tài khoản test thứ hai) cùng mở trang buổi test. Baseline: A sửa một trường của buổi (ví dụ ghi chú) qua UI, B thấy thay đổi không cần reload; baseline trượt ⇒ §4.1 `FAIL` ngay (xem lưu ý URL ở §4.1). Mở trang khám phá công khai của app staging vài lần, rồi làm lần đếm 1 của §7.

### 3.2 Cách kích hoạt

Mở trang tài liệu chính thức của DigitalOcean về cách gây hoặc kiểm thử failover của Managed PostgreSQL vào ngày drill; ghi URL, mục và ngày vào hàng evidence. Không có cách nào được tài liệu hoá ⇒ mục 7 ghi `OPEN`, không bao giờ `PASS`; khi đó §4.1, §4.2 và §7 cũng `OPEN` (chúng cần failover thật), §5 và §6 vẫn chạy.

### 3.3 Gây lỗi

Ghi `T_fault` (UTC), rồi kích hoạt đúng theo trang đã ghi. Không làm gì khác trên cluster.

### 3.4 Theo dõi và ghi mốc

| Điều kiện          | Cách thấy                                                                                         | Mốc          |
| ------------------ | ------------------------------------------------------------------------------------------------- | ------------ |
| standby lên làm primary | console của cluster: primary mới online; ngay sau đó làm lần đếm 2 của §7                          | `T_promoted` |
| web chạy lại       | `infra/smoke-check.sh https://<staging-app>` xanh (lặp tới khi xanh)                                | `T_health`   |
| ghi qua UI được    | lần sửa của §4.1 bước 3 lưu thành công                                                            | `T_write`    |
| worker chạy lại    | log của component `worker` trong console: có job chạy xong sau `T_promoted`, không lặp lỗi kết nối | `T_worker`   |

**Pass:** cả bốn điều kiện đúng; bốn mốc và `T_health` − `T_fault` ghi vào hàng evidence.

## 4. Phục hồi ứng dụng sau failover

### 4.1 SSE (mục 8a; Người làm: OWNER, hai trình duyệt của §3.1)

Hành vi của code: listener **không tự đăng ký lại**. Mất kết nối ⇒ log `realtime.listener.lost` (`apps/web/lib/realtime-listener.ts:143`), lùi, trả client và đóng mọi stream (`apps/web/lib/realtime-listener.ts:141-147`); nó chỉ `LISTEN` lại khi một stream mới gọi `ready()` sau backoff (`apps/web/lib/realtime-listener.ts:150-176`; full jitter, gốc 1 s, hệ số 2, trần 30 s: `apps/web/lib/realtime-listener.ts:25`). Phía trình duyệt, module client (không dùng retry sẵn của trình duyệt) nối lại với backoff full jitter riêng và phát resync ở mỗi lần mở, nên view tải lại dữ liệu (`apps/web/lib/use-realtime.ts:9-12`).

Lưu ý URL: listener đi qua `appDb().pool` (`apps/web/lib/realtime-listener.ts:212`), tức `DATABASE_URL` (`apps/web/lib/session-cookies.ts:57`), không qua `DATABASE_URL_LISTEN` (`docs/standards/environments-setup.md:194`), biến mà không code nào đọc (đã theo dõi: `docs/autopilot-backlog.md:5170-5171`). `DATABASE_URL` không giữ được `LISTEN` (ví dụ pool transaction) thì bước này FAIL: ghi vậy, không giấu.

1. Trước `T_fault`: B mở trang buổi test, baseline §3.1 xanh.
2. Sau `T_fault`: log của `web` trong console có `realtime.listener.lost`; ghi mốc (dòng mong đợi, không phải tiêu chí pass).
3. Chờ backoff qua (trần 30 s) và tới khi B có request EventSource mới, mở sau `T_fault` và đang mở (DevTools → Network); rồi A sửa buổi test qua UI.
4. B thấy thay đổi **không reload**, trong khi request của bước 3 vẫn đang mở (không có request mới): resync lúc mở luôn tải lại dữ liệu, nên chỉ thay đổi đến qua request đang mở mới chứng minh listener đã `LISTEN` lại. Rồi reload B: thay đổi vẫn còn.

**Pass:** bước 4 đúng cả ba điều, theo điều owner thấy trên trình duyệt; ghi mốc của bước 3 và 4.

### 4.2 pg-boss không nhân đôi thao tác tiền (mục 8b; Người làm: OWNER, `HA_ADMIN_URL`, phiên chỉ đọc)

Sau §3.4 (worker đã chạy lại), chạy Q0-Q5 của `docs/runbooks/pitr-restore-drill.md` §6 trên cluster của cửa sổ, với `<T_start>` = `T_begin` của §3.1. `T_begin` sớm hơn `T_fault` có chủ ý: một job đã ghi allocation trước lỗi rồi chạy lại sau lỗi vẫn bị Q3 đếm đủ hai hàng. "Ledger và allocation" = `charges` + `payment_allocations`; không có bảng `ledger`.

**Pass:** Q0 có một cột true và Q1-Q4 trả 0 dòng; số đếm của Q5 ghi vào hàng evidence. Q0 false ⇒ `INVALID`, dừng, không phải PASS; khi đó, trước khi xoá cửa sổ, export cluster của cửa sổ theo §2 của runbook đó và chạy lại các truy vấn trên bản restore theo §5 của nó, bằng superuser của PostgreSQL vanilla.

## 5. Bốn role DB và TLS (mục 4; Người làm: OWNER, host trên đường private)

Chạy từ host của §1 bước 4 (ghi host vào evidence); chạy từ ngoài đường private không chứng minh mục 4 ⇒ `OPEN`. Mỗi hàng: kết nối bằng đúng URL mà component dùng (`docs/standards/environments-setup.md:192-195`), chạy câu `SELECT` bên dưới; pass khi `current_user` đúng role.

| Role (`docs/standards/environments-setup.md:183-186`) | Component    | Biến                                                    |
| ----------------------------------------------------- | ------------ | ------------------------------------------------------- |
| `app`                                                 | `web`        | `DATABASE_URL` (pool) và `DATABASE_URL_LISTEN` (direct) |
| `readonly`                                            | `discovery`  | `DATABASE_URL` của `discovery` (pool)                   |
| `app_worker`                                          | `worker`     | `DATABASE_URL_DIRECT`                                   |
| `migration`                                           | job deploy   | `DATABASE_URL_MIGRATION`                                |

```bash
psql "$DATABASE_URL"         # one connection per row, with that row's variable; run the SELECT below, then quit
psql "$TLS_WRONG_HOST_URL"   # same URL, host replaced by a name or IP not on the certificate: must be refused
psql "$TLS_WRONG_CA_URL"     # same URL, sslrootcert pointing at another CA: must be refused
```

```sql
SELECT current_user;
```

Không dùng `PGOPTIONS` ở đây vì URL pool có thể từ chối `options`; câu này không đọc bảng nào.

TLS: mỗi URL mang `sslmode=verify-full` và `sslrootcert` trỏ tới CA của cluster (`docs/standards/environments-setup.md:201`). Không file non-test nào trong `packages/db/src`, `apps/web/lib` hay `apps/bot/src` đặt tuỳ chọn `ssl`, `sslmode` hay tên env của CA, nên việc kiểm chỉ dựa vào tham số owner đặt trong URL; tuỳ chọn CA tường minh là lane có điều kiện L78 (`docs/sessions/web-mvp-phase5-golive-plan.md:90`).

**Pass:** đủ năm kết nối với `current_user` đúng role, từ đường private, URL `verify-full`; và cả hai kết nối âm bị từ chối. Điều nào trượt ⇒ `FAIL`, ghi nguyên văn lỗi (không ghi URL), không giấu, chuyển sang L78.

## 6. Trusted sources (mục 3; Người làm: OWNER, console)

Làm sau cùng: gỡ mọi trusted source tạm đã thêm ở §1 bước 4, rồi đọc danh sách trusted sources của cluster trong console.

**Pass:** danh sách chỉ còn danh tính private của app (`docs/decisions/analysis/dd-04-hosting-final-decision.md:285`), không còn mục tạm nào của drill. Ghi tên và loại của từng mục, không ghi IP. Production kiểm lại mục 3 và mục 4 ở G4 (`docs/sessions/web-mvp-phase5-golive-plan.md:243`).

## 7. Quan sát limiter discovery (migration 0075; Người làm: OWNER, `DATABASE_URL_MIGRATION`, phiên chỉ đọc)

`discovery_rate_limit_counters` là bảng UNLOGGED (`packages/db/migrations/0075_discovery_rate_limit_definer.sql:42`; mô tả ở `packages/db/migrations/0075_discovery_rate_limit_definer.sql:8`): bảng UNLOGGED không được chép sang standby và bị làm rỗng sau crash, nên sau failover bộ đếm bắt đầu lại từ 0. Đó là **quan sát của drill, không bao giờ là FAIL**. Chỉ role sở hữu (`migration`) đọc được bảng: mọi quyền trên bảng đã thu hồi khỏi PUBLIC, `app`, `app_worker` và `readonly` (`packages/db/migrations/0075_discovery_rate_limit_definer.sql:34-37`).

Lần đếm 1 ở §3.1, lần đếm 2 ngay sau `T_promoted` (§3.4), trước khi mở lại trang khám phá.

```bash
PGOPTIONS='-c default_transaction_read_only=on' psql "$DATABASE_URL_MIGRATION"
```

```sql
-- the limiter table is unlogged: relpersistence = 'u'
SELECT relname, relpersistence FROM pg_class WHERE relname = 'discovery_rate_limit_counters';
-- counter rows: count 1 before T_fault, count 2 right after T_promoted
SELECT count(*) FROM discovery_rate_limit_counters;
```

**Pass của bước:** hàng evidence có `relpersistence` và hai số đếm; kết quả luôn `OBSERVED`.

## 8. Bảng kết quả (append-only: thêm hàng mới, KHÔNG sửa hàng cũ)

| Ngày (UTC)  | Mục | Người chạy | Cửa sổ, SHA | Mốc (UTC) | Trang kích hoạt (URL, mục, ngày) | Quan sát | Kết quả | Chứng kiến | Ghi chú |
| ----------- | --- | ---------- | ----------- | --------- | -------------------------------- | -------- | ------- | ---------- | ------- |
| _chưa chạy_ |     |            |             |           |                                  |          |         |            |         |

`Mục` ∈ `§1 cửa sổ` · `§3 mục 7` · `§4.1 mục 8a` · `§4.2 mục 8b` · `§5 mục 4` · `§6 mục 3` · `§7 limiter`. `Kết quả` theo §2. Chứng kiến = owner.
