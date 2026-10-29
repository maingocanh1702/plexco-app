# Runbook: diễn tập khôi phục PITR và restore ngoài DigitalOcean (owner, staging)

## 0. Thẩm quyền và quy tắc

> **Dành cho:** owner, người làm mọi bước và là người chứng kiến. Agent không chạy bước nào ở đây: không mở console, không chạy `doctl`, không cầm token DigitalOcean (DD-154, `docs/standards/decisions.md:1796`).
> **Nguồn:** bản ghi DD-04 §7.5 (`docs/decisions/analysis/dd-04-hosting-final-decision.md:267`), §7.6 mục 9 (`docs/decisions/analysis/dd-04-hosting-final-decision.md:292`) và phần restore của mục 13 (`docs/decisions/analysis/dd-04-hosting-final-decision.md:297`); bước 8.7 của PLAN (`docs/sessions/web-mvp-phase5-golive-plan.md:203`); DD-154 (`docs/standards/decisions.md:1785`); DD-129 (8) (`docs/standards/decisions.md:145`).
> **Trạng thái:** viết sẵn, **chưa chạy**; bảng §7 trống có chủ ý. PITR của nhà cung cấp **không** thay cho export mã hoá ngoài DigitalOcean (§2, §5): cần cả hai.

- Mọi bước DigitalOcean, console, nơi giữ backup hay cloud: **Người làm: OWNER**. Credential chỉ ghi bằng TÊN biến (`SRC_ADMIN_URL`, `FORK_ADMIN_URL`, `VANILLA_ADMIN_URL`, `BACKUP_AGE_RECIPIENT`, `BACKUP_AGE_IDENTITY`); owner tự đặt chúng trong shell của mình, không ghi giá trị vào file, chat hay runbook này.
- Chỉ drill trên **staging**: không bao giờ restore đè cluster đang phục vụ, luôn fork ra cluster mới; dữ liệu test tạo qua UI của sản phẩm, không bao giờ dữ liệu production.
- SQL ở đây chỉ là `SELECT`, chạy theo §6 (Q0 trước). Không có câu ghi nào: marker là CLB tạo trong UI staging, "sự cố" là việc chọn điểm restore (không phá gì).
- Production pilot là PostgreSQL một nút, **không có standby** (DD-154 (a), `docs/standards/decisions.md:1822`); runbook này không khẳng định failover nào. Drill failover chỉ chạy trên cửa sổ staging tạm HA: `docs/runbooks/failover-drill.md`.

## 1. Các dạng khôi phục

Bản ghi đòi ba dạng độc lập: dữ liệu HA sống, PITR của nhà cung cấp, export logic mã hoá ngoài tài khoản DigitalOcean (`docs/decisions/analysis/dd-04-hosting-final-decision.md:269-270`). Production pilot có **hai** dạng: PITR và export (§2); dạng HA chưa có cho tới khi production lên HA "before money flows or before adding more clubs" (`docs/standards/decisions.md:1824`).

**Pass:** hàng §7 ghi đúng các dạng có mặt vào ngày drill (PITR bật: có/không; export ngoài DigitalOcean gần nhất: ngày; HA: không).

## 2. Export logic mã hoá ra ngoài DigitalOcean (Người làm: OWNER)

Một bộ export = dump định dạng custom của database + dump chỉ role của cluster, nên mang đủ schema, các hàng `schema_migrations`, role và grant, policy RLS, extension, trạng thái sequence và dữ liệu; dump chỉ dữ liệu không phải bộ khôi phục (`docs/decisions/analysis/dd-04-hosting-final-decision.md:271-272`). Mã hoá bằng key công khai; key giải mã owner giữ **ngoài** DigitalOcean.

1. Giờ thấp điểm, một job (`pg_dump` không `-j`), `pg_dump` cùng hoặc mới hơn major version của cluster. Trong lúc chạy, theo dõi p95/p99 của web và độ trễ hàng đợi: xấu đi so với mức đo ngay trước export ⇒ dừng (Ctrl-C), ghi `ABORTED`, chạy lại giờ khác (`docs/decisions/analysis/dd-04-hosting-final-decision.md:273-275`).

```bash
set -o pipefail   # a failed dump fails the pipeline instead of leaving a short encrypted file
pg_dump -Fc "$SRC_ADMIN_URL" | age -r "$BACKUP_AGE_RECIPIENT" > plexco-<UTC-date>.dump.age
pg_dumpall --dbname="$SRC_ADMIN_URL" --roles-only --no-role-passwords | age -r "$BACKUP_AGE_RECIPIENT" > plexco-<UTC-date>-roles.sql.age
shasum -a 256 plexco-<UTC-date>*.age
```

`--no-role-passwords`: admin của DigitalOcean không phải superuser (`infra/postgres-init/01-job-definer.sql:97-100`) nên không đọc được mật khẩu role; bản restore nhận credential mới.

2. Ngay sau export, trên nguồn: C1-C6 (3.4, §5) và Q0, Q5 (§6); kết quả là mốc cho §5. Không thao tác gì trên staging trong cửa sổ export; có thao tác ⇒ mốc Q5 không dùng được, export lại.
3. Chép hai file `.age` ra nơi lưu ngoài tài khoản DigitalOcean (owner chọn) và kiểm lại sha256 ở nơi lưu; ghi SHA commit app đang chạy (từ deployment) vào hàng `export §2` ở §7.

**Pass:** pipeline exit 0, không `ABORTED`, hai file mã hoá có ở nơi lưu ngoài DigitalOcean với sha256 khớp.

## 3. Diễn tập PITR trên staging

`T_before`, `T_fault`, `T_after` lấy từ đồng hồ DB (marker SELECT, `SELECT now();`), ghi nguyên chuỗi psql in ra, kèm offset; `T_start`, `T_green` lấy từ đồng hồ máy owner, UTC.

### 3.1 Liệt kê backup (Người làm: OWNER)

```bash
doctl databases list                          # find <staging-cluster-id>; confirm it is the staging cluster
doctl databases backups <staging-cluster-id>  # record the oldest and the newest backup
```

`doctl` dùng tài khoản của chính owner; làm tương đương trong console cũng được. **Pass:** đúng cluster staging, PITR bật, cửa sổ backup phủ thời điểm drill.

### 3.2 Marker qua UI (Người làm: OWNER, tài khoản test trên app staging)

1. Tạo CLB `drill-before-<UTC time>`; trong CLB đó tạo dữ liệu tiền thử qua UI (một buổi, một người chơi, một khoản ghi nhận đã trả) để Q5 > 0 ở cả ba bảng. Một CLB là một hàng `tenants` có `name` và `created_at` (`packages/db/schema.ts:530-537`); mỗi tài khoản tạo tối đa 3 CLB mỗi giờ (`apps/web/app/api/onboarding/start/route.ts:38`), drill cần 2.
2. Marker SELECT trên nguồn thấy `drill-before-…`; `created_at` của nó là `T_before`.
3. Chờ ít nhất 2 phút cho WAL được archive: PITR không về được tới thời điểm chưa archive.
4. Trên nguồn chạy C1-C5 và Q0-Q5 (mốc), rồi ngay sau đó `SELECT now();`: kết quả là `T_fault`.
5. Tạo CLB `drill-after-<UTC time>`; marker SELECT thấy nó với `created_at` (`T_after`) sau `T_fault`.
6. Quyết định restore: ghi `T_start`, đồng hồ RTO bắt đầu.

```sql
-- marker: run on the source (3.2) and on the fork (3.4)
SELECT name, created_at FROM tenants WHERE name LIKE 'drill-%' ORDER BY created_at;
-- T_fault: source only
SELECT now();
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

### 3.4 Kiểm tra chỉ đọc trên fork (Người làm: OWNER, `FORK_ADMIN_URL`, phiên của §6, Q0 trước)

```sql
-- C1 migrations applied (table created by packages/db/src/migrate.ts:205)
SELECT count(*) FROM schema_migrations;
-- C2 roles
SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname IN ('app', 'app_worker', 'readonly', 'migration', 'job_definer') ORDER BY rolname;
-- C3 RLS policies
SELECT count(*) FROM pg_policies;
-- C4 extensions (psql \dx lists them by name)
SELECT count(*) FROM pg_extension;
-- C5 sequence state
SELECT * FROM pg_sequences;
SELECT max(seq) FROM onboarding_steps;
```

**Pass:** marker có `drill-before-…` và **không** có `drill-after-…`; C1, C3 (> 0), C4 bằng mốc; C2 cùng các hàng như nguồn: `app`, `app_worker`, `readonly` có `rolsuper` và `rolbypassrls` false (`packages/db/migrations/0000_roles_extensions.sql:23-29`), `job_definer` có `rolbypassrls` true (`infra/postgres-init/01-job-definer.sql:31-32`), role runtime nào có `rolbypassrls` true ⇒ `FAIL`; C5 cùng danh sách sequence như nguồn và `last_value` của sequence cột `onboarding_steps.seq` (`packages/db/migrations/0013_onboarding_steps_recency.sql:28`) ≥ `max(seq)`; Q1-Q4 trả 0 dòng; Q5 bằng mốc và > 0.

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
- **PASS** cần đủ bốn: (a) marker đúng như 3.4; (b) mọi kiểm của 3.4 xanh với Q0 true; (c) RPO ≤ mục tiêu và RTO ≤ mục tiêu; (d) §7 có hàng mới với ngày UTC, người chạy, người chứng kiến. Thiếu một ⇒ `FAIL`; Q0 false ⇒ `INVALID`, không bao giờ `PASS`.

## 5. Restore hằng quý ra PostgreSQL vanilla ngoài DigitalOcean (Người làm: OWNER)

Owner tạo một PostgreSQL vanilla tạm cùng major version với nguồn, ngoài DigitalOcean, và huỷ nó sau drill; chi phí khoảng `$10–30 per drill` cộng egress (`docs/decisions/analysis/dd-04-hosting-final-decision.md:278-279`). Đầu vào: bộ export mới nhất của §2 và các mốc của nó; nội dung kiểm theo `docs/decisions/analysis/dd-04-hosting-final-decision.md:276-277`.

```bash
set -o pipefail
age -d -i "$BACKUP_AGE_IDENTITY" plexco-<UTC-date>-roles.sql.age | psql "$VANILLA_ADMIN_URL"
age -d -i "$BACKUP_AGE_IDENTITY" plexco-<UTC-date>.dump.age | pg_restore --dbname="$VANILLA_ADMIN_URL"
```

1. Ghi giờ bắt đầu restore (đồng hồ RTO của dạng này). Roles trước, dump sau; lỗi được chấp nhận duy nhất là `role ... already exists`; lỗi khác, hoặc `pg_restore` báo `errors ignored on restore` ⇒ `FAIL`.
2. Theo §6 với `VANILLA_ADMIN_URL` (superuser vanilla, Q0 true): C1-C6 và Q5 bằng mốc của §2, Q1-Q4 trả 0 dòng.
3. Owner đặt credential tạm cho các role runtime trên bản restore, trỏ một app tạm cùng SHA đã ghi ở §2 vào đó và chạy `infra/smoke-check.sh https://<restore-app>`; xanh ⇒ ghi RTO đo. Smoke xanh là phép kiểm gián tiếp cho grant của role runtime.
4. RPO của dạng này = tuổi bộ export lúc restore (bằng khoảng cách giữa hai lần export): ghi số đo và so với §4; vượt 15 phút ghi ở cột Ghi chú cho bước 8.9, không tính là `PASS` ngầm.
5. Huỷ bản vanilla và credential tạm; ghi hàng `quarterly §5` ở §7.

```sql
-- C6 schema checksum: run on the source at export time (§2) and on the restore; must be equal
SELECT md5(string_agg(table_name || '.' || column_name || ':' || data_type, ',' ORDER BY table_name, column_name)) FROM information_schema.columns WHERE table_schema = 'public';
```

**Pass:** bước 1-3 xanh và RTO đo ≤ 60 phút. Hoãn: load test (§7.6 mục 12, `docs/sessions/web-mvp-phase5-golive-plan.md:269`) và nửa migration của mục 13 (`docs/sessions/web-mvp-phase5-golive-plan.md:270`).

## 6. Truy vấn chỉ đọc (Người làm: OWNER)

Mỗi kết nối: phiên chỉ đọc, URL qua TÊN biến, TLS kiểm CA và hostname (`docs/standards/environments-setup.md:201`). Kết nối từ chối `options` ⇒ dùng URL trực tiếp, không qua pool.

```bash
PGOPTIONS='-c default_transaction_read_only=on' psql "$SRC_ADMIN_URL"   # or FORK_ADMIN_URL, VANILLA_ADMIN_URL
```

Q0 trước, ở mỗi kết nối. Role runtime là `NOBYPASSRLS` (`packages/db/migrations/0000_roles_extensions.sql:23`), nên chạy bằng chúng thì RLS giấu hàng và 0 dòng là pass giả. Chỉ chạy tiếp khi `current_user` có `rolsuper` hoặc `rolbypassrls` true. Tài liệu DigitalOcean ghi admin có Bypass RLS, không có Superuser (`infra/postgres-init/01-job-definer.sql:97-100`), nhưng đó là điều Q0 đo, không phải giả định (DD-129 R1, `docs/standards/decisions.md:145`). Q0 false ⇒ dừng, kết quả `INVALID`; các so sánh chạy lại trên bản restore của §5 bằng superuser vanilla.

`<T_start>` = mốc bắt đầu của drill đang chạy (§3: `T_start`; `docs/runbooks/failover-drill.md`: thời điểm gây lỗi).

```sql
-- Q0 query role: one column true, else STOP (INVALID)
SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user;
-- Q1 duplicate charge per tenant, session and player: 0 rows
SELECT tenant_id, session_id, player_id, count(*) FROM charges GROUP BY 1, 2, 3 HAVING count(*) > 1;
-- Q2 allocation reversed twice: 0 rows
SELECT reverses_allocation_id, count(*) FROM payment_allocations WHERE reverses_allocation_id IS NOT NULL GROUP BY 1 HAVING count(*) > 1;
-- Q3 duplicate allocation in the drill window: 0 rows
SELECT tenant_id, charge_id, amount, source, created_by, count(*) FROM payment_allocations WHERE created_at >= '<T_start>' GROUP BY 1, 2, 3, 4, 5 HAVING count(*) > 1;
-- Q4 duplicate outbox sequence per aggregate: 0 rows
SELECT aggregate_id, sequence, count(*) FROM outbox_events GROUP BY 1, 2 HAVING count(*) > 1;
-- Q5 exact row counts: above 0, equal on the source and the restore
SELECT count(*) FROM charges;
SELECT count(*) FROM payment_allocations;
SELECT count(*) FROM outbox_events;
```

"Ledger và allocation" = `charges` + `payment_allocations`; không có bảng `ledger`. Ràng buộc mà Q1, Q4 dò: `charges_tenant_session_player_uq` (`packages/db/schema.ts:1236`), `outbox_agg_seq_uq` (`packages/db/schema.ts:1552`); cột của Q2, Q3: `packages/db/schema.ts:1313-1327` (`amount` có dấu, reversal âm nên không trùng với hàng gốc). Các truy vấn không định nghĩa tổng tiền mới.

## 7. Bảng kết quả (append-only: thêm hàng mới, KHÔNG sửa hàng cũ)

| Ngày (UTC) | Drill | Người chạy | Cluster / nơi restore, SHA | `T_before` · `T_fault` · điểm restore | RPO đo | `T_start` → `T_green` | RTO đo | Q0 | Kiểm 3.4 / §5 / §6 | Dạng có mặt (§1) | Kết quả | Chứng kiến | Ghi chú |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| _chưa chạy_ | | | | | | | | | | | | | |

`Drill` ∈ `export §2` · `PITR §3` · `quarterly §5`. `Kết quả` ∈ `PASS` · `FAIL` · `INVALID` (Q0 false) · `ABORTED` (§2). Chứng kiến = owner. Hàng này cùng kết quả VIẾT của owner (bước 8.7, `docs/sessions/web-mvp-phase5-golive-plan.md:203`) là bằng chứng G3 cho mục 9 và phần restore của mục 13 (`docs/sessions/web-mvp-phase5-golive-plan.md:253`).
