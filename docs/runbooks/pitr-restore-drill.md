# Runbook — Backup + PITR restore drill (staging)

> Authority: `docs/standards/environments-setup.md` §8 (recovery) + §10 (acceptance) · DD-04 §7 ·
> `docs/standards/deployment-infra.md` §8. Mục tiêu: **đo** RPO/RTO thật, không ghi số ước lượng.
> Trạng thái: runbook viết sẵn, **chưa chạy** (chưa có cluster DO). Mọi hàng trong bảng §6 đang trống có chủ ý.

PITR của nhà cung cấp **không** thay cho backup ngoài DO (§8). Drill này đo PITR/fork; bước 7 là phần
off-provider (logical export) — vẫn bắt buộc trước production.

## 1. Định nghĩa

- **RPO đo được** = `T_fault − T_restore_point_thực_tế` (dữ liệu mất tối đa). Với PITR, mục tiêu cần ghi số
  giây/phút đo được, không phải "gần 0".
- **RTO đo được** = từ lúc quyết định restore đến khi app trỏ vào DB đã restore và smoke xanh.
- **PASS** = (a) bản restore có đủ marker trước `T_fault` và **không** có marker sau nó; (b) kiểm tra §4 xanh;
  (c) RPO ≤ mục tiêu và RTO ≤ mục tiêu (mục tiêu chưa được owner chốt — mặc định đề xuất RPO ≤ 15 phút,
  RTO ≤ 60 phút cho staging, ghi "đề xuất, chờ owner" ở go/no-go); (d) bảng §6 có hàng có ngày + người chạy.

## 2. Chuẩn bị (người chạy: owner hoặc agent có token DO — luôn do owner phê duyệt)

```bash
doctl databases list                                  # lấy <cluster-id> staging
doctl databases backups <cluster-id>                  # liệt kê backup tự động; ghi thời điểm cũ nhất/mới nhất
```

Chỉ drill trên cluster **staging**. Không bao giờ restore đè lên cluster đang phục vụ; luôn fork ra cluster mới.

## 3. Tạo dữ liệu mốc và gây sự cố có kiểm soát

Dùng connection admin từ máy nằm trong trusted sources (`<ADMIN_URL>`, `sslmode=require`):

```bash
psql "$ADMIN_URL" -v ON_ERROR_STOP=1 <<'SQL'
CREATE TABLE IF NOT EXISTS drill_marker (id serial PRIMARY KEY, label text NOT NULL, at timestamptz NOT NULL DEFAULT now());
INSERT INTO drill_marker(label) VALUES ('before-fault') RETURNING at;   -- ghi lại: T_before
SQL
sleep 120   # chờ WAL được archive; PITR không phục hồi tới một giây chưa được archive
psql "$ADMIN_URL" -c "INSERT INTO drill_marker(label) VALUES ('fault') RETURNING at;"   # T_fault (UTC) — ghi lại
psql "$ADMIN_URL" -c "INSERT INTO drill_marker(label) VALUES ('after-fault');"
```

`T_fault` là thời điểm muốn quay về. Đồng thời ghi: tổng số hàng các bảng chính trước drill (bước 4) và
timestamp bắt đầu đồng hồ RTO (`T_start`).

## 4. Restore bằng fork (point-in-time)

```bash
doctl databases create plexco-staging-drill-$(date +%Y%m%d) --engine pg --version 16 \
  --region sgp1 --size db-s-1vcpu-2gb --num-nodes 1 --private-network-uuid <vpc-uuid> \
  --restore-from-cluster-name plexco-staging-pg \
  --restore-from-timestamp "2026-10-14 03:00:00 +0000 UTC"      # = T_fault, định dạng "2006-01-02 15:04:05 +0000 UTC"
```

Theo dõi `doctl databases get <new-cluster-id>` tới khi Status = `online`. Khi `online`: tạo lại user + trusted source cho cluster mới (bản restore không kế thừa mật khẩu role ứng dụng — kiểm
`doctl databases user list <new-cluster-id>`), rồi chạy **kiểm tra toàn vẹn** với `<DRILL_URL>`:

```bash
psql "$DRILL_URL" -c "SELECT label FROM drill_marker ORDER BY id;"            # phải có before-fault, KHÔNG có after-fault
psql "$DRILL_URL" -c "SELECT count(*) FROM schema_migrations;"                 # bằng cluster gốc
psql "$DRILL_URL" -c "SELECT rolname, rolbypassrls, rolsuper FROM pg_roles WHERE rolname IN ('app','app_worker','readonly','job_definer');"
psql "$DRILL_URL" -c "SELECT count(*) FROM pg_policies;"                       # RLS còn nguyên (> 0, bằng gốc)
psql "$DRILL_URL" -c "SELECT n_live_tup, relname FROM pg_stat_user_tables ORDER BY relname;"  # so với số ghi ở §3
```

Với dữ liệu tiền (khi staging đã có): đối soát `ledger`/allocation/outbox bằng truy vấn tổng đã pin trong
spec của lane tương ứng; **không** tự chế công thức mới ở đây (một nguồn sự thật cho tổng, xem invariants).

## 5. Chứng minh app chạy được trên bản restore (RTO đầy đủ)

Chỉ trên staging: trỏ tạm secret `DATABASE_URL`/`DATABASE_URL_DIRECT`/`DATABASE_URL_MIGRATION` của app **drill**
(không phải app staging đang dùng) sang cluster fork, hoặc tạo app drill từ cùng spec. Chạy
`infra/smoke-check.sh https://<drill-app>` và e2e như workflow staging. Dừng đồng hồ RTO khi smoke xanh. Sau đó:

```bash
doctl databases delete <new-cluster-id> --force      # huỷ cluster drill + app drill; thu hồi credential tạm
```

## 6. Bảng kết quả (điền sau mỗi lần chạy — KHÔNG sửa hàng cũ)

| Ngày (UTC) | Người chạy | Cluster / size | `T_fault` | Thời điểm restore thực tế | RPO đo | `T_start` → smoke xanh | RTO đo | Marker đúng | RLS/roles/migrations khớp | Kết quả | Ghi chú / lỗi |
|---|---|---|---|---|---|---|---|---|---|---|---|
| _chưa chạy_ | | | | | | | | | | | |

Bảng tổng hợp (một hàng, cập nhật bằng dòng changelog mới ở `environments-setup.md` sau lần PASS đầu tiên —
DONE WHEN của M5: "measured RPO/RTO recorded"): **RPO đo: —  ·  RTO đo: —  ·  Ngày: —**.

## 7. Phần off-provider (bắt buộc trước production, tách khỏi PITR)

1. Logical export mã hoá ra ngoài tài khoản DO: `pg_dump -Fc "$ADMIN_URL" | age -r <pubkey> > plexco-$(date +%F).dump.age`
   (khoá giải mã do owner giữ, không nằm trong DO).
2. Restore vào PostgreSQL vanilla ngoài DO, chạy bộ kiểm tra ở §4 + đối soát tiền (DD-04 §7.4).
3. Ghi một hàng riêng vào bảng §6 với cột "Cluster" = "off-provider".

Hai thứ cần xác nhận đầu tiên vì chúng quyết định drill có khả thi: R1 (đã đo 2026-08-05 trong `01-job-definer.sql`; xác nhận lại ở lần bootstrap đầu — kỳ vọng MỘT warning từ `LOCK TABLE`, không phải lỗi) và việc bản restore có giữ role/extension đúng không — xem `staging-deploy.md` §2.3 và §8.
