# Runbook: diễn tập khôi phục PITR và restore ngoài DigitalOcean (owner, staging)

## 0. Thẩm quyền và quy tắc

> **Dành cho:** owner, người làm mọi bước và là người chứng kiến. Agent không chạy bước nào ở đây: không mở console, không chạy `doctl`, không cầm token DigitalOcean (DD-154, `docs/standards/decisions.md:1796`).
> **Nguồn:** bản ghi DD-04 §7.5 (`docs/decisions/analysis/dd-04-hosting-final-decision.md:267`), §7.6 mục 9 (`docs/decisions/analysis/dd-04-hosting-final-decision.md:292`) và phần restore của mục 13 (`docs/decisions/analysis/dd-04-hosting-final-decision.md:297`); bước 8.7 của PLAN (`docs/sessions/web-mvp-phase5-golive-plan.md:203`); DD-154 (`docs/standards/decisions.md:1785`); DD-129 (8) (`docs/standards/decisions.md:145`).
> **Trạng thái:** viết sẵn, **chưa chạy**; bảng §7 trống có chủ ý. PITR của nhà cung cấp **không** thay cho export mã hoá ngoài DigitalOcean (§2, §5): cần cả hai.

- Mọi bước DigitalOcean, console, nơi giữ backup hay cloud: **Người làm: OWNER**. Credential chỉ ghi bằng TÊN biến (`SRC_ADMIN_URL`, `FORK_ADMIN_URL`, `VANILLA_ADMIN_URL`, `BACKUP_AGE_RECIPIENT`, `BACKUP_AGE_IDENTITY`: tên cục bộ của runbook này, không thuộc `docs/standards/environments-setup.md:192-195`; owner giữ); owner tự đặt chúng trong shell của mình, không ghi giá trị vào file, chat hay runbook này.
- Chỉ drill trên **staging**: không bao giờ restore đè cluster đang phục vụ, luôn fork ra cluster mới; dữ liệu test tạo qua UI của sản phẩm, không bao giờ dữ liệu production.
- SQL ở đây chỉ là `SELECT` bên trong vỏ `BEGIN TRANSACTION READ ONLY;` … `ROLLBACK;` của mỗi khối, chạy đúng cách ở §6 (khối Q0 trước). Không có câu ghi nào: marker là CLB tạo trong UI staging, "sự cố" là việc chọn điểm restore (không phá gì).
- Production pilot là PostgreSQL một nút, **không có standby** (DD-154 (a), `docs/standards/decisions.md:1822`); runbook này không khẳng định failover nào. Drill failover chỉ chạy trên cửa sổ staging tạm HA: `docs/runbooks/failover-drill.md`.

## 1. Các dạng khôi phục

Bản ghi đòi ba dạng độc lập: dữ liệu HA sống, PITR của nhà cung cấp, export logic mã hoá ngoài tài khoản DigitalOcean (`docs/decisions/analysis/dd-04-hosting-final-decision.md:269-270`). Production pilot được thiết kế có **hai** dạng: PITR và export; runbook này chỉ diễn tập trên staging, nên hàng §7 ghi dạng nào production thực có vào ngày drill (export production gần nhất: ngày, hoặc `không`). Dạng HA chưa có cho tới khi production lên HA "before money flows or before adding more clubs" (`docs/standards/decisions.md:1824`).

**Pass:** hàng §7 ghi đúng các dạng production có vào ngày drill (PITR bật: có/không; export production ngoài DigitalOcean gần nhất: ngày, hoặc `không`; HA: không).

## 2. Export logic mã hoá ra ngoài DigitalOcean (Người làm: OWNER)

Một bộ export = dump định dạng custom của database + dump chỉ role của cluster, nên mang đủ schema, các hàng `schema_migrations`, role và grant, policy RLS, extension, trạng thái sequence và dữ liệu; dump chỉ dữ liệu không phải bộ khôi phục (`docs/decisions/analysis/dd-04-hosting-final-decision.md:271-272`). Mã hoá bằng key công khai; key giải mã owner giữ **ngoài** DigitalOcean.

1. Trước export, khối Q0 (§6) trên `SRC_ADMIN_URL`: role dump cũng phải có Q0 một cột true và Q0b = 0; không đạt ⇒ `INVALID`, không export. Giờ thấp điểm, một job (`pg_dump` không `-j`), băng thông giới hạn bằng `pv -L <rate>` (owner chọn `<rate>`, byte/giây; owner cài `pv` trên máy export), `pg_dump` cùng hoặc mới hơn major version của cluster. Trong lúc chạy, theo dõi p95/p99 của web và độ trễ hàng đợi: xấu đi so với mức đo ngay trước export ⇒ dừng (Ctrl-C), ghi `ABORTED`, chạy lại giờ khác (`docs/decisions/analysis/dd-04-hosting-final-decision.md:273-275`).

```bash
set -o pipefail   # a failed dump fails the pipeline instead of leaving a short encrypted file
pg_dump -Fc "$SRC_ADMIN_URL" | pv -q -L <rate> | age -r "$BACKUP_AGE_RECIPIENT" > plexco-<UTC-date>.dump.age
pg_dumpall --dbname="$SRC_ADMIN_URL" --roles-only --no-role-passwords | age -r "$BACKUP_AGE_RECIPIENT" > plexco-<UTC-date>-roles.sql.age
pg_dump --version   # baseline string: section 5 must print the same one
pg_dump --schema-only --schema=public --schema=pgboss "$SRC_ADMIN_URL" > plexco-<UTC-date>-schema.sql   # definitions only, no rows: kept unencrypted
shasum -a 256 plexco-<UTC-date>*.age plexco-<UTC-date>-schema.sql
```

`--no-role-passwords`: admin của DigitalOcean không phải superuser (`infra/postgres-init/01-job-definer.sql:97-100`) nên không đọc được mật khẩu role; bản restore nhận credential mới.

2. Ngay sau export, trên nguồn: C1-C5 (3.4) và Q1-Q6 (§6); kết quả này cùng file `plexco-<UTC-date>-schema.sql` và chuỗi `pg_dump --version` là mốc cho §5. Không thao tác gì trên staging trong cửa sổ export; có thao tác ⇒ mốc không dùng được, export lại.
3. Chép hai file `.age` và file schema ra nơi lưu ngoài tài khoản DigitalOcean (owner chọn) và kiểm lại sha256 ở nơi lưu; ghi SHA commit app đang chạy (từ deployment) vào hàng `export §2` ở §7.

**Pass:** mọi lệnh của khối bash ở §2 exit 0 (hai pipeline và lệnh `pg_dump --schema-only`), không `ABORTED`, hai file mã hoá và file schema có ở nơi lưu ngoài DigitalOcean với sha256 khớp.

## 3. Diễn tập PITR trên staging

`T_begin`, `T_before`, `T_fault`, `T_after` lấy từ đồng hồ DB (marker SELECT, `SELECT clock_timestamp();`), ghi nguyên chuỗi psql in ra, kèm offset; `T_start`, `T_green` lấy từ đồng hồ máy owner, UTC.

### 3.1 Liệt kê backup (Người làm: OWNER)

```bash
doctl databases list                          # find <staging-cluster-id>; confirm it is the staging cluster
doctl databases backups <staging-cluster-id>  # record the oldest and the newest backup
```

`doctl` dùng tài khoản của chính owner; làm tương đương trong console cũng được. **Pass:** đúng cluster staging, PITR bật, cửa sổ backup phủ thời điểm drill.

### 3.2 Marker qua UI (Người làm: OWNER, tài khoản test trên app staging)

0. Trên nguồn: khối Q0 (§6), rồi khối thời điểm bên dưới; kết quả là `T_begin`, ghi trước mọi thao tác dữ liệu test của drill.
1. Tạo CLB `drill-before-<UTC time>`; trong CLB đó tạo dữ liệu tiền thử qua UI (một buổi, một người chơi, một khoản ghi nhận đã trả) để Q5 > 0 ở cả ba bảng. Một CLB là một hàng `tenants` có `name` và `created_at` (`packages/db/schema.ts:530-537`); mỗi tài khoản tạo tối đa 3 CLB mỗi giờ (`apps/web/app/api/onboarding/start/route.ts:38`), drill cần 2.
2. Marker SELECT trên nguồn thấy `drill-before-…`; `created_at` của nó là `T_before`.
3. Chờ ít nhất 2 phút cho WAL được archive: PITR không về được tới thời điểm chưa archive.
4. Trên nguồn chạy C1-C5 (3.4) và Q1-Q6 (§6) làm mốc, rồi ngay sau đó khối thời điểm: kết quả là `T_fault`.
5. Tạo CLB `drill-after-<UTC time>`; marker SELECT thấy nó với `created_at` (`T_after`) sau `T_fault`.
6. Quyết định restore: ghi `T_start`, đồng hồ RTO bắt đầu.

```sql
BEGIN TRANSACTION READ ONLY;
-- marker block: run on the source (3.2) and on the fork (3.4)
SELECT name, created_at FROM tenants WHERE name LIKE 'drill-%' ORDER BY created_at;
ROLLBACK;
```

```sql
BEGIN TRANSACTION READ ONLY;
-- timestamp block, source only: T_begin (step 0), T_fault (step 4)
SELECT clock_timestamp();
ROLLBACK;
```

### 3.3 Fork tới `T_fault` (Người làm: OWNER)

Fork ra cluster **mới** cùng major version, region và VPC với staging; không bao giờ restore đè cluster đang phục vụ. Định dạng `<T_fault>` theo `doctl databases create --help` vào ngày drill.

```bash
doctl databases create <fork-name> --engine pg --version <pg-major> --region <region> --size <size> \
  --num-nodes 1 --private-network-uuid <vpc-uuid> \
  --restore-from-cluster-name <staging-cluster-name> --restore-from-timestamp "<T_fault>"
doctl databases get <fork-id>          # repeat until Status = online
doctl databases user list <fork-id>
```

Khi `online`: fork không kế thừa mật khẩu role ứng dụng, nên owner đặt credential tạm cho các role mà app drill dùng và thêm trusted source chỉ cho app drill và máy của owner. Ghi điểm restore thực tế nếu console hoặc `doctl` báo.

### 3.4 Kiểm tra chỉ đọc trên fork (Người làm: OWNER, `FORK_ADMIN_URL`, cách chạy của §6, khối Q0 trước)

```sql
BEGIN TRANSACTION READ ONLY;
-- C1 migrations applied (table created by packages/db/src/migrate.ts:205)
SELECT count(*) FROM schema_migrations;
-- C2 roles
SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname IN ('app', 'app_worker', 'readonly', 'migration', 'job_definer', 'chat_definer', 'identity_definer') ORDER BY rolname;
-- C3 RLS policies
SELECT count(*) FROM pg_policies;
-- C4 extensions (psql \dx lists them by name)
SELECT count(*) FROM pg_extension;
-- C5 sequence state
SELECT * FROM pg_sequences;
SELECT max(seq) FROM onboarding_steps;
ROLLBACK;
```

**Pass:** marker có `drill-before-…` và **không** có `drill-after-…`; C1, C3 (> 0), C4 bằng mốc; C2 cùng các hàng như nguồn: `app`, `app_worker`, `readonly` có `rolsuper` và `rolbypassrls` false (`packages/db/migrations/0000_roles_extensions.sql:23-29`), mọi role definer có `rolbypassrls` true (`job_definer`: `infra/postgres-init/01-job-definer.sql:31-32`; `chat_definer`: `infra/postgres-init/02-chat-definer.sql:51-52`; `identity_definer`: `infra/postgres-init/03-identity-definer.sql:31-32`), role runtime nào có `rolbypassrls` true ⇒ `FAIL`; C5 cùng danh sách sequence như nguồn và `last_value` của sequence cột `onboarding_steps.seq` (`packages/db/migrations/0013_onboarding_steps_recency.sql:28`) ≥ `max(seq)`; Q1-Q4 trả 0 dòng; Q5 bằng mốc và > 0; Q6 bằng mốc.

### 3.5 App trên fork, dừng đồng hồ RTO (Người làm: OWNER)

Trên một app **drill** (không bao giờ app staging đang phục vụ), đặt secret `DATABASE_URL`, `DATABASE_URL_DIRECT`, `DATABASE_URL_LISTEN`, `DATABASE_URL_MIGRATION` trỏ vào fork theo vai trò ở `docs/standards/environments-setup.md:192-195`, deploy app drill, rồi:

```bash
infra/smoke-check.sh https://<drill-app>   # green: record T_green, the RTO clock stops
```

### 3.6 Dọn (Người làm: OWNER)

`doctl databases delete <fork-id>` không kèm `--force`: đọc tên trong lời hỏi xác nhận, phải là `<fork-name>`. Xoá app drill, thu hồi credential tạm và trusted source tạm, rồi ghi hàng `PITR §3` ở §7.

## 4. Form RPO/RTO

- **RPO đo** = `T_fault` − điểm restore thực tế (dữ liệu mất tối đa). Nhà cung cấp không báo điểm thực tế ⇒ ghi chặn trên `T_fault` − `T_before` (marker `drill-before-…` có trên fork).
- **RTO đo** = `T_start` (quyết định restore) → `T_green` (smoke xanh trên fork).
- **Mục tiêu:** RPO ≤ 15 phút, RTO ≤ 60 phút theo DD-129 (8) (`docs/standards/decisions.md:145`): "default applied, pending owner sign-off" (bước 8.9, `docs/sessions/web-mvp-phase5-golive-plan.md:228`).
- **PASS** cần đủ bốn: (a) marker đúng như 3.4; (b) mọi kiểm của 3.4 xanh với Q0 true và Q0b = 0; (c) RPO ≤ mục tiêu và RTO ≤ mục tiêu; (d) §7 có hàng mới với ngày UTC, người chạy, người chứng kiến. Thiếu một ⇒ `FAIL`; Q0 false hoặc Q0b > 0 ⇒ `INVALID`, không bao giờ `PASS`.

## 5. Restore hằng quý ra PostgreSQL vanilla ngoài DigitalOcean (Người làm: OWNER)

Owner tạo một PostgreSQL vanilla tạm cùng major version với nguồn, ngoài DigitalOcean, và huỷ nó sau drill; chi phí khoảng `$10–30 per drill` cộng egress (`docs/decisions/analysis/dd-04-hosting-final-decision.md:278-279`). Đầu vào: bộ export mới nhất của §2 và các mốc của nó; nội dung kiểm theo `docs/decisions/analysis/dd-04-hosting-final-decision.md:276-277`.

```bash
set -o pipefail
age -d -i "$BACKUP_AGE_IDENTITY" plexco-<UTC-date>-roles.sql.age | psql -X "$VANILLA_ADMIN_URL" 2> roles.err
grep ERROR roles.err | grep -v 'already exists'   # must print nothing
age -d -i "$BACKUP_AGE_IDENTITY" plexco-<UTC-date>.dump.age | pg_restore --dbname="$VANILLA_ADMIN_URL"
```

1. Ghi giờ bắt đầu restore (đồng hồ RTO của dạng này). Roles trước, dump sau; lỗi được chấp nhận duy nhất là `role ... already exists`, nên lệnh `grep` phải không in gì; lỗi khác, hoặc `pg_restore` báo `errors ignored on restore` ⇒ `FAIL`.
2. Theo §6 với `VANILLA_ADMIN_URL` (superuser vanilla, Q0 true, Q0b = 0): C1-C5, Q5, Q6 bằng mốc của §2; Q1, Q2, Q4 trả 0 dòng; Q3 trả đúng các dòng của mốc §2. Rồi khối S bên dưới, với cùng chuỗi `pg_dump --version` như mốc §2 (chuỗi khác ⇒ chưa chạy S: dùng đúng bản pg_dump của mốc §2 rồi chạy S): hai số `grep -c` > 0 và hai tổng sha256 bằng nhau ⇒ xanh; hai tổng khác ⇒ đính `schema.diff` vào hàng `quarterly §5` ở §7 và giải thích từng hunk ở cột `Ghi chú`; hunk nào owner không giải thích được ⇒ `FAIL`.
3. Owner đặt credential tạm cho các role runtime trên bản restore, trỏ một app tạm cùng SHA đã ghi ở §2 vào đó và chạy `infra/smoke-check.sh https://<restore-app>`; xanh ⇒ ghi RTO đo. Smoke xanh là phép kiểm gián tiếp cho grant của role runtime.
4. RPO của dạng này = tuổi bộ export lúc restore (bằng khoảng cách giữa hai lần export): ghi số đo và so với RPO của dạng export ở bước 8.9; vượt ⇒ `OPEN` (Pass bên dưới), ghi ở cột Ghi chú cho bước 8.9.
5. Huỷ bản vanilla và credential tạm; ghi hàng `quarterly §5` ở §7.

Khối S (Người làm: OWNER, ở bước 2): so dump chỉ-schema của nguồn ở mốc §2 với dump chỉ-schema của bản restore. `--schema` lấy đúng hai schema của app: `public` (migration tạo bảng ở đây và không tạo schema nào khác) và `pgboss` của pg-boss (`apps/bot/src/queue.ts:3`, bước provision dựng nó: `apps/bot/src/provision-queue.ts:29`); với `--schema`, pg_dump không dump các đối tượng khác mà các schema đã chọn phụ thuộc vào (mục `-n` của https://www.postgresql.org/docs/current/app-pgdump.html, bản 18, truy cập 2026-10-29), nên S không thay C2 (role) và C4 (extension). Chuẩn hoá bỏ mọi dòng chú thích `--` (phần đầu ghi version của server, có thể khác bản minor giữa nguồn và bản restore, và version của pg_dump; các dòng `-- Name: …; Owner: …` mà câu CREATE/ALTER/GRANT đã lặp lại) và các dòng `\restrict` / `\unrestrict`, vì key của chúng ngẫu nhiên mỗi lần chạy (cùng trang, mục `--restrict-key`: "If no restrict key is specified, pg_dump will generate a random one as needed"); bỏ dòng thay vì dùng `--restrict-key` để lệnh vẫn đúng với bản pg_dump chưa có option này.

```bash
pg_dump --version   # must print the section 2 baseline string; its major version >= the server's
pg_dump --schema-only --schema=public --schema=pgboss "$VANILLA_ADMIN_URL" > restore-schema.sql
grep -v -E '^--|^\\(un)?restrict ' plexco-<UTC-date>-schema.sql > src.norm.sql
grep -v -E '^--|^\\(un)?restrict ' restore-schema.sql > restore.norm.sql
grep -c '^CREATE TABLE ' src.norm.sql restore.norm.sql   # both > 0: two empty dumps would also compare equal
shasum -a 256 src.norm.sql restore.norm.sql   # the two sums must be equal
diff -u src.norm.sql restore.norm.sql > schema.diff   # empty when equal
```

**Pass:** bước 1-3 xanh, RTO đo ≤ 60 phút và RPO đo ≤ RPO của dạng export mà owner ghi ở bước 8.9; owner chưa ghi số đó, hoặc RPO đo vượt nó ⇒ `OPEN`, không bao giờ `PASS`. Hàng `quarterly §5` ghi hai tổng sha256 của S ở cột `Kiểm 3.4 / §5 / §6`: đó là "schema checksum" của bản ghi (`docs/decisions/analysis/dd-04-hosting-final-decision.md:276`). Hoãn: load test (§7.6 mục 12, `docs/sessions/web-mvp-phase5-golive-plan.md:269`) và nửa migration của mục 13 (`docs/sessions/web-mvp-phase5-golive-plan.md:270`).

## 6. Truy vấn chỉ đọc (Người làm: OWNER)

Mỗi kết nối: URL qua TÊN biến, TLS kiểm CA và hostname (`docs/standards/environments-setup.md:201`). Mỗi khối SQL là một đơn vị: mở psql như dưới đây, dán nguyên khối (từ `BEGIN TRANSACTION READ ONLY;` tới `ROLLBACK;`), rồi thoát psql (`\q`); khối sau mở psql mới. `PGOPTIONS` chỉ là lớp thứ hai, không bao giờ là lớp duy nhất: nó chỉ đặt mặc định của phiên, nên một `SET default_transaction_read_only = off` hay `BEGIN READ WRITE` về sau vượt qua nó, và pooler từ chối startup option. Kết nối từ chối `options` ⇒ dùng URL trực tiếp, không qua pool.

```bash
PGOPTIONS='-c default_transaction_read_only=on' psql -X -v ON_ERROR_STOP=1 "$SRC_ADMIN_URL"   # or "$FORK_ADMIN_URL", "$VANILLA_ADMIN_URL"
```

Khối Q0 là khối đầu tiên chạy trên mỗi URL trong một drill (cùng URL là cùng role). Role runtime là `NOBYPASSRLS` (`packages/db/migrations/0000_roles_extensions.sql:23`), nên chạy bằng chúng thì RLS giấu hàng và 0 dòng là pass giả. Chỉ chạy tiếp khi `current_user` có `rolsuper` hoặc `rolbypassrls` true và Q0b = 0 (BYPASSRLS không cấp quyền `SELECT`; Q0b đếm bảng và sequence `public` mà role không đọc được). Tài liệu DigitalOcean ghi admin có Bypass RLS, không có Superuser (`infra/postgres-init/01-job-definer.sql:97-100`), nhưng đó là điều Q0 đo, không phải giả định (DD-129 R1, `docs/standards/decisions.md:145`). Q0 false hoặc Q0b > 0 ⇒ dừng, kết quả `INVALID`; không có đường vòng qua §5, vì §2 bước 1 đòi cùng điều kiện; owner dùng một role admin đạt Q0 và Q0b (ghi tên role vào Ghi chú) rồi chạy lại từ khối Q0.

`<T_begin>` = mốc ghi ngay trước thao tác dữ liệu test đầu tiên của drill: §3.2 bước 0 (`SELECT clock_timestamp();` trước bước 1) cho PITR; `T_begin` ở §3.1 của `docs/runbooks/failover-drill.md` cho drill failover. §2/§5: Q3 bỏ điều kiện `created_at` (đặt `<T_begin>` = `-infinity`, khớp mọi hàng) và phải trả cùng các dòng trên nguồn và bản restore.

```sql
BEGIN TRANSACTION READ ONLY;
-- Q0 query role: one column true, else STOP (INVALID)
SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user;
-- Q0b public tables and sequences the query role cannot read: 0, else STOP (INVALID)
SELECT count(*) AS unreadable FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'S') AND NOT has_table_privilege(c.oid, 'SELECT');
ROLLBACK;
```

```sql
BEGIN TRANSACTION READ ONLY;
-- Q1 duplicate charge per tenant, session and player: 0 rows
SELECT tenant_id, session_id, player_id, count(*) FROM charges GROUP BY 1, 2, 3 HAVING count(*) > 1;
-- Q2 allocation reversed twice: 0 rows
SELECT reverses_allocation_id, count(*) FROM payment_allocations WHERE reverses_allocation_id IS NOT NULL GROUP BY 1 HAVING count(*) > 1;
-- Q3 duplicate allocation since <T_begin>: 0 rows (§2/§5: see <T_begin> above)
SELECT tenant_id, charge_id, amount, source, created_by, count(*) FROM payment_allocations WHERE created_at >= '<T_begin>' GROUP BY 1, 2, 3, 4, 5 HAVING count(*) > 1;
-- Q4 duplicate outbox sequence per aggregate: 0 rows
SELECT aggregate_id, sequence, count(*) FROM outbox_events GROUP BY 1, 2 HAVING count(*) > 1;
-- Q5 exact row counts: above 0, equal on the source and the restore
SELECT count(*) FROM charges;
SELECT count(*) FROM payment_allocations;
SELECT count(*) FROM outbox_events;
-- Q6 stored-value hash per table: equal on the source and the restore
SELECT md5(string_agg(concat_ws(':', id, amount_due, amount_allocated, status), ',' ORDER BY id)) FROM charges;
SELECT md5(string_agg(concat_ws(':', id, charge_id, amount, source), ',' ORDER BY id)) FROM payment_allocations;
SELECT md5(string_agg(concat_ws(':', id, sequence, acked_at IS NULL), ',' ORDER BY id)) FROM outbox_events;
ROLLBACK;
```

"Ledger và allocation" = `charges` + `payment_allocations`; không có bảng `ledger`. Ràng buộc mà Q1, Q4 dò: `charges_tenant_session_player_uq` (`packages/db/schema.ts:1236`), `outbox_agg_seq_uq` (`packages/db/schema.ts:1552`); cột của Q2, Q3: `packages/db/schema.ts:1313-1327` (`amount` có dấu, reversal âm nên không trùng với hàng gốc); cột của Q6: `packages/db/schema.ts:1226-1233`, `packages/db/schema.ts:1314-1319`, `packages/db/schema.ts:1532-1550`. Q6 chỉ băm giá trị đã lưu; các truy vấn không định nghĩa tổng tiền mới.

## 7. Bảng kết quả (append-only: thêm hàng mới, KHÔNG sửa hàng cũ)

| Ngày (UTC) | Drill | Người chạy | Cluster / nơi restore, SHA | `T_begin` · `T_before` · `T_fault` · điểm restore | RPO đo | `T_start` → `T_green` | RTO đo | Q0 · Q0b | Kiểm 3.4 / §5 / §6 | Dạng có mặt (§1) | Kết quả | Chứng kiến | Ghi chú |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| _chưa chạy_ | | | | | | | | | | | | | |

`Drill` ∈ `export §2` · `PITR §3` · `quarterly §5`. `Kết quả` ∈ `PASS` · `FAIL` · `INVALID` (Q0 false hoặc Q0b > 0) · `ABORTED` (§2) · `OPEN` (§5: owner chưa ghi RPO của dạng export ở bước 8.9, hoặc RPO đo vượt số đó). Chứng kiến = owner. Hàng này cùng kết quả VIẾT của owner (bước 8.7, `docs/sessions/web-mvp-phase5-golive-plan.md:203`) là bằng chứng G3 cho mục 9 và phần restore của mục 13 (`docs/sessions/web-mvp-phase5-golive-plan.md:253`); mục 9 chỉ xong khi hàng `PITR §3` gần nhất và hàng `quarterly §5` gần nhất đều `PASS`.
