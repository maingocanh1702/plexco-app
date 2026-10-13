# Go / No-Go note — Public launch (copy file này, điền, không sửa template)

> Dùng cho milestone M5 và mọi lần promote production. Copy sang `docs/runbooks/go-no-go-<YYYY-MM-DD>.md`.
> Quy tắc: **chỉ ghi điều đã đo**; thiếu bằng chứng = ghi `KHÔNG CÓ` và tính là No-Go cho mục đó.
> "Docs ≠ runtime proof" (CLAUDE.md): link tới commit/run/artifact, không dán lời khẳng định.

- Ngày / người điền / base SHA (`git rev-parse HEAD` của `main` khi chốt): `<…>`
- Image: tag `<git sha>` · digest `sha256:<…>` · staging run `<URL>` · artifact `deployment-evidence-staging`
- Quyết định đề xuất: **GO / NO-GO / GO-có-điều-kiện** — lý do một câu: `<…>`

## 1. Đang live (có trên staging/production, đã đo)

| Khối | Môi trường | Bằng chứng (run / commit / ảnh) |
|---|---|---|
| Đăng nhập / đăng ký (Google) | `<staging|prod>` | `<…>` |
| Liên kết Zalo | | |
| Quản lý kèo (tạo/publish/đóng/huỷ) | | |
| Chi tiết kèo + danh sách người chơi | | |
| Cài đặt CLB | | |
| Gạch nợ thủ công (manual mark-paid) | | |
| Tạo CLB self-serve | | |

## 2. Có nhưng đang sau cờ (tắt mặc định)

| Cờ / khả năng | Giá trị hiện tại | Ai bật, điều kiện bật, bước rollback |
|---|---|---|
| `OUTBOX_DISPATCH_SCHEDULE_ENABLED` | `false` | owner · cần projector thật + wake-up < 1 phút · đặt lại `false` |
| Google login ở production | `<…>` | owner · OAuth client prod đã tạo |
| `<cờ khác>` | | |

## 3. Mọi default chương trình còn chờ owner sign-off

Mỗi dòng = một mục trong `decisions.md` đánh dấu "default applied … pending owner sign-off". Merge của owner là sign-off.

| ID | Default đã áp dụng | Quyết định của owner (OK / đổi thành…) |
|---|---|---|
| Tier C #1 | Host thêm người chơi trên web; bot self-join ở M9 | |
| DD-56-read-routes | Route đọc qua `authorize()` | |
| O4 (Zalo secret) | Key riêng, giải mã chỉ ở process gọi Zalo, audit mỗi lần | |
| DD-114-D6 | Self-serve tạo CLB, kể cả tenant #1 | |
| `DB_EXPECTED_ROLE` | Opt-in (đã bật ở spec staging/prod) | |
| C4 (Google OAuth) | Bật ở staging; production là quyết định owner | |
| O2 (autonomy) | `autonomous_to_ready` cho P1/P2; P0 prepare-only | |
| Tier C #2 | Ngôn ngữ theo CLB (`tenants.locale`) | |
| Staging sizing / error reporting / trigger deploy / log vendor | Đề xuất ở báo cáo M5 (chờ owner) | |

## 4. Bằng chứng đã đo

| Hạng mục | Mục tiêu | Đo được | Bằng chứng |
|---|---|---|---|
| CI `verify` + `e2e-web` trên SHA | xanh | `<…>` | `<run URL>` |
| `deploy-staging` (smoke + e2e 375px/desktop, vi/en) | xanh | `<…>` | `<run URL>` |
| PITR restore: RPO / RTO | owner chốt mục tiêu | `<…>` / `<…>` | `pitr-restore-drill.md` §6 hàng `<ngày>` |
| Backup off-provider restore + đối soát | PASS | `<…>` | hàng "off-provider" |
| Log: có `request_id`+`tenant_id`, không PII | mẫu 20 dòng, 0 PII | `<…>` | `<link/ảnh>` |
| Outbound-IP gate (SePay/ApiPay/Zalo) | `DO_VPC_COMPATIBLE` | `<…>` | environments-setup §1.1 |
| R1 `job_definer BYPASSRLS` trên DO PG | tạo được / có phương án | `<…>` | `staging-deploy.md` §8 |
| R2 TLS verify tới DB | verify CA + hostname | `<…>` | |
| Rolling deploy 2×web/2×discovery | pass | `<…>` | (staging chạy 1 instance — cần run riêng) |

## 5. Còn mở — owner ask

Mỗi dòng: việc · lệnh/màn hình chính xác · ai · hạn. Điền từ báo cáo M5 (danh sách tạo DO project/VPC/PG/DOCR,
GitHub environments + secret, secret inventory, quyết định outbound-IP, chọn log vendor, nhà cung cấp error reporting).

| # | Việc | Chủ | Hạn | Trạng thái |
|---|---|---|---|---|
| | | | | |

## 6. Ký

Owner: `<tên>` · Quyết định: GO / NO-GO · Ngày: `<…>`. Deploy production là hành động owner (P0): chạy
`deploy-production` với `tag`, `digest`, `staging_run_id`, `confirm` điền ở §đầu.
