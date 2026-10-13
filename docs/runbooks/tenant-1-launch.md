# Runbook — Tenant #1 launch

> Authority: DD-114 D6 (self-serve provisioning, kể cả tenant #1 — **program default pending owner sign-off**) ·
> `docs/standards/environments-setup.md` §7–§8 · ROADMAP module #6 (nhập dữ liệu bot cũ).
> Lệnh/tên màn hình giữ tiếng Anh. Runbook này mô tả **thứ tự và điều kiện**; tên màn hình cụ thể phải đối
> chiếu với UI đã merge ở thời điểm launch (các lane M1b/M3a/M3b nằm ở PR riêng — chưa có trong base của lane này).

## 0. Điều kiện vào (tất cả phải đúng, ghi bằng chứng vào go/no-go note)

- [ ] Staging xanh: `deploy-staging` run thành công cho đúng SHA sẽ promote (smoke + e2e), artifact `deployment-evidence-staging` lưu.
- [ ] PITR drill PASS ít nhất một lần (`pitr-restore-drill.md` §6) + backup off-provider đã thử (§7).
- [ ] Gate outbound-IP (§1.1 environments-setup) đóng; R1/R2 trong `staging-deploy.md` §8 đã đo/đóng.
- [ ] Production app + DB + secret đã tạo bởi owner (`staging-deploy.md` §6); **không** dùng lại credential staging.
- [ ] Owner xác nhận bằng văn bản các default đang chờ sign-off (danh sách trong go/no-go note).

## 1. Cấu hình provider cho production (owner, không agent)

| Provider | Việc | Bằng chứng cần ghi |
|---|---|---|
| Google OAuth | Client riêng cho production; redirect URI **chính xác** `https://<APP_DOMAIN>/api/auth/google/callback`; đặt `GOOGLE_OAUTH_CLIENT_ID/SECRET` ở DO. **Bật Google login ở production là quyết định owner.** | Ảnh màn hình Google console + 1 lần đăng nhập thử bằng tài khoản owner |
| Zalo bot | Mỗi CLB tự nhập token bot qua web flow (token mã hoá KMS trong DB, không nằm ở env). Webhook secret sinh tự động; kiểm callback đã đăng ký phía Zalo | Phản hồi setWebhook + 1 tin nhắn test tới bot |
| SePay/ApiPay | Chỉ khi slice thanh toán tương ứng đã land và cờ bật bởi owner | — |

Mọi cờ production (`OUTBOX_DISPATCH_SCHEDULE_ENABLED`, Google login, khoá thanh toán thật) mặc định **tắt**;
bật từng cái là một quyết định owner kèm bước rollback (đặt lại giá trị cũ trong DO + redeploy).

## 2. Tạo CLB đầu tiên (self-serve)

1. Owner đăng nhập production bằng Google (email đã xác minh — đây là factor mạnh, HARD RULE 4).
2. Chạy flow **tạo CLB** (onboarding). Kiểm: tenant được tạo, owner có membership `owner`, `tenants.locale` đúng
   ngôn ngữ CLB (DD-118).
3. Kiểm RLS/identity bằng đọc, không sửa tay DB: dùng màn hình/endpoint readiness của onboarding; không `UPDATE` trực tiếp.
4. Kết nối Zalo bot (bước web flow ở §1), sau đó tạo link-code một lần và dùng `/link` từ tài khoản Zalo thử để chứng minh
   liên kết người chơi (HARD RULE 4: link_code dùng-một-lần, không dùng tên/alias).
5. Smoke nghiệp vụ tối thiểu: tạo kèo nháp → publish → thêm người chơi → gạch nợ thủ công (manual mark-paid) →
   kiểm kèo hiển thị đúng ở web (375px và desktop, cả hai ngôn ngữ). Ghi `request_id` của vài lệnh để chứng minh log tương quan.

## 3. Nhập dữ liệu từ bot một-CLB cũ (ROADMAP module #6)

**Chỉ làm nếu owner cung cấp export. Hiện chưa có → các bước dưới là TBD, không tự suy ra.**

Đầu vào cần từ owner (trước khi viết bất kỳ importer nào):

1. File export của bot cũ (định dạng, phiên bản, ngày cắt) + mô tả từng trường.
2. Danh sách trường có tiền/PII và cách đối chiếu người chơi cũ ↔ `persons`/`channel_identities` (không merge theo tên —
   HARD RULE 4; cần link_code hoặc xác minh email).
3. Quy tắc cho lịch sử công nợ: nhập thành bút toán mở đầu (opening balance) hay chỉ lưu tham chiếu — **quyết định tiền, owner chốt**.
4. Cửa sổ cắt chuyển (cutover) và việc tắt bot cũ để không ghi hai nơi (không multi-master, HARD RULE 3).

Steps TBD: dry-run importer trên staging với bản export đã ẩn danh → đối soát tổng → owner duyệt → chạy production
một lần, có transaction + báo cáo số dòng. Không nhập lại sau khi hệ thống mới đã nhận ghi.

## 4. Rollback

| Tình huống | Hành động | Ghi chú |
|---|---|---|
| Bản deploy mới lỗi, DB chưa đổi hợp đồng | DO Console → App → Deployments → **Redeploy** bản ACTIVE trước đó (hoặc chạy `deploy-production` với `tag/digest` cũ đã kiểm chứng) | Không rebuild. Kiểm `/healthz`, SSE tái kết nối, queue lag, không có mutation tiền trùng |
| Migration đã chạy | **Không** down-migration. Forward-fix bằng migration mới (expand/contract) | §8 environments-setup |
| Dữ liệu hỏng / xoá nhầm | Fork PITR về trước sự cố (`pitr-restore-drill.md` §4), kiểm toàn vẹn, rồi trỏ app sang cluster mới **chỉ khi** owner duyệt | Không bao giờ trỏ lại DB cũ sau khi DB mới nhận ghi |
| Cờ vừa bật gây sự cố | Đặt lại giá trị cờ ở DO + redeploy | Cờ nằm ở spec/secret, không ở code |

Lệnh tham khảo: `doctl apps list-deployments <app-id>`, `doctl apps logs <app-id> web --type run`.

## 5. Sau launch (24–72h đầu)

- Theo dõi alert DO + log (`request_id`, `tenant_id`); đếm `session_command_unhandled`.
- Ghi lại mọi can thiệp thủ công vào go/no-go note (mục "measured evidence") — mỗi can thiệp là một lỗ hổng tự động hoá/test cần mở.
