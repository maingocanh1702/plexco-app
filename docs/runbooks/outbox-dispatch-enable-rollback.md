# Runbook: bật / rollback outbox dispatch (registry, DLQ, NOTIFY wake)

> **Dành cho:** owner. **Nguồn:** lane L3 `p3-m6-outbox-delivery-core`, migration `0056`, DD-134 (a)(b)(e).
> Lệnh giữ nguyên tiếng Anh, copy-paste được; chạy từ thư mục gốc repo. Ví dụ dùng Postgres compose local
> (`plexco-postgres-1`, DB `plexco`); môi trường khác: thay bằng psql tới đúng DB với credential `DATABASE_URL_MIGRATION`.
> Bật dispatch cho dùng thật với token Zalo thật là **bước P0 của owner**, không phải việc của agent.

## Quy tắc an toàn

- **Không bao giờ commit `OUTBOX_DISPATCH_SCHEDULE_ENABLED=true`.** Mặc định `false` ở `.env.example` và
  `infra/docker-compose.yml`; chỉ đặt `true` trong env của **process worker** khi bật.
- Đồng hồ worker và DB phải đồng bộ NTP: lệch >= 15 s biến một lần retry sớm thành dlq `malformed_outcome` (replay được).
- Bật projector chỉ bằng `outbox_projector_set_enabled` (dưới đây), **không** bằng migration, **không** sửa tay bảng.
- Chỉ bật một projector khi module thật của nó đã merge **và đã deploy trên mọi worker đang chạy** (worker còn placeholder
  trả dlq `projector_not_implemented`): `web_realtime` sau L5; `zalo_dm` sau L4 + bot token thật (P0); `public_sessions` sau L10.

```bash
# Owner SQL shell (local compose). Mọi lệnh gọi function của job_definer chạy giữa SET ROLE job_definer ... RESET ROLE.
OWNER_SQL='docker exec -i plexco-postgres-1 psql -U plexco -d plexco -v ON_ERROR_STOP=1'
```

## 1. Điều kiện trước

1. DB đã migrate tới `0056` (`[migrate] applied=... skipped=...`, không lỗi); DB cũ: chạy `pnpm db:bootstrap` (superuser,
   `DATABASE_URL_MIGRATION`) **trước** `0054`, rồi `pnpm --filter @plexco/db migrate`.
2. `pnpm --filter @plexco/bot provision:queue` đã chạy; preflight của worker pass (worker log không có dòng `[preflight] FAILED`).
3. Tất cả projector đang tắt:

```bash
$OWNER_SQL -c "SET ROLE job_definer" -c "SELECT name, enabled FROM outbox_projectors ORDER BY name" -c "RESET ROLE"
```

## 2. Bật theo thứ tự an toàn

1. Projector vẫn tắt hết. Đặt `OUTBOX_DISPATCH_SCHEDULE_ENABLED=true` **chỉ cho worker**, restart worker
   (`pnpm --filter @plexco/bot start:worker`). Log phải có `outbox dispatch schedule registered: "* * * * *"` và
   `[worker] outbox wake listening`; dòng `outbox dispatch schedule OFF — <lý do>` nghĩa là chưa bật (đọc lý do).
2. Xác nhận heartbeat báo đúng cổng (trong 30 s):

```bash
$OWNER_SQL -c "SET ROLE job_definer" -c "SELECT outbox_dispatch_schedule_live()" -c "RESET ROLE"   # phải là t
```

3. Chờ backlog chưa ack về 0. Khi mọi projector tắt, event được ack với tập rỗng `'{}'`, nên không event cũ nào bị gửi:

```bash
$OWNER_SQL -c "SELECT count(*) FROM outbox_events WHERE acked_at IS NULL"   # chờ = 0
```

4. Rồi mới bật **từng** projector (chỉ event ack sau thời điểm bật mới cần projector đó; event đã ack không bao giờ được gán thêm):

```bash
$OWNER_SQL -c "SET ROLE job_definer" -c "SELECT outbox_projector_set_enabled('web_realtime', true)" -c "RESET ROLE"
```

`t` = đã đổi, `f` = vốn đã như vậy, lỗi `projector_not_found` = sai tên.

## 3. Rollback

- **Tắt một projector:** như bước 2.4 với `false`. Có hiệu lực ở lần đọc envelope kế tiếp: tối đa delivery đang gửi dở
  hoàn tất; dòng vừa claim nằm `claimed` tới khi lease 5 phút hết. Chỉ delivery đã prepare **trước** lúc tắt nằm chờ
  (`pending`/`failed`; khi bật lại có thể đã cũ). Event ack **trong lúc tắt** được ack không có projector này và **không bao
  giờ** tới nó, kể cả sau khi bật lại (không backfill; không có dòng dlq nên không replay được). Bật lại xong, owner phải cho
  projection đã lỡ khoảng đó dựng lại từ trạng thái canonical (đường rebuild/reconcile của chính module); `zalo_dm`: tin của khoảng đó không gửi.
- **Tắt hẳn dispatch:** đặt flag `false` (hoặc bỏ) + restart worker: unschedule, không consumer, không LISTEN, không
  draft expiry. Heartbeat báo `false` trong 30 s; `SELECT outbox_dispatch_schedule_live()` về `f` trong 90 s.
- **Gỡ code:** chỉ sau khi flag đã tắt; schema thì revert bằng một migration mới (không sửa `0056`).

## 4. DLQ: kiểm tra và replay (CLI owner, không HTTP, không UI)

Retry: lần thất bại thứ n < 8 chờ **ít nhất** 15 s x 2^(n-1) (tổng 1905 s, khoảng 32 phút); retry đến hạn chỉ chạy ở lần wake
kế tiếp (event mới bất kỳ) hoặc tick cron 1 phút, nên mỗi lần chờ có thể trễ tới khoảng 60 s (cả chuỗi tới khoảng 39 phút).
Lần thứ 8 vào dlq `attempts_exhausted`; lỗi projector báo terminal vào dlq ngay. Ngưỡng cảnh báo: **> 100** dòng dlq.

```bash
$OWNER_SQL -c "SET ROLE job_definer" -c "SELECT count(*) FROM outbox_dlq_list(NULL, 500)" -c "RESET ROLE"
read -rs PW && export DATABASE_URL_MIGRATION="postgres://plexco:${PW}@localhost:5432/plexco" && unset PW   # gõ password + Enter (không hiện, không vào history) hoặc nạp từ file env chmod 600; không bao giờ gõ thẳng trong lệnh
node scripts/outbox-dlq-replay.mjs list --projector web_realtime --limit 50
node scripts/outbox-dlq-replay.mjs replay --event <event-uuid> --projector web_realtime
```

- `list`: mỗi dòng dlq một JSON (không có payload), cuối cùng `dlq rows: <n>`.
- `replay`: đưa đúng một delivery dlq về `pending`, `attempts = 0`, ghi một dòng `job_audit_events`
  (`projector_delivery_replayed`); cycle kế tiếp gửi lại. Projector đang tắt thì CLI cảnh báo và dòng nằm chờ.
- Exit `0` xong; `2` từ chối (`invalid_argument`, `delivery_not_found`, `delivery_not_in_dlq`, không ghi gì); `1` lỗi khác.

## 5. Đo sync lag (chỉ local, trong test process; NFR-1c p95 <= 3 s, p99 <= 10 s)

Không bao giờ bật flag để đo. Test tự chạy wake loop + runner thật trên DB test riêng của nó, rồi ghi một dòng `SYNC_LAG {...}`
(N, p50, p95, p99, max, số cycle) vào file `OUTBOX_SYNC_LAG_OUT`, cho tải ổn định 10 event/s x 60 s và tải burst 50 event/transaction mỗi 5 s:

```bash
bash -c 'export NODE_ENV=test DATABASE_URL_TEST=postgres://plexco:plexco_dev@localhost:5432/plexco_test
OUTBOX_SYNC_LAG_MEASURE=1 OUTBOX_SYNC_LAG_OUT="$PWD/sync-lag.jsonl" pnpm --filter @plexco/bot exec vitest run src/outbox-wake.test.ts -t "sync lag"'
cat sync-lag.jsonl && rm sync-lag.jsonl
```

Sau mỗi lần chạy test: đặt lại password ba role runtime theo `docs/runbooks/local-mvp-smoke.md` mục 5.
