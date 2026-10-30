# Template: go/no-go cho go-live production

> **Ai copy, khi nào.** Owner copy file này và điền bản copy trước gate G6 và trước mỗi lần promote production qua `.github/workflows/deploy-production.yml`; ở G6 form go/no-go là việc "owner điền và xác nhận" (`docs/sessions/web-mvp-phase5-golive-plan.md:245`). Không sửa template.
>
> **Tên bản copy:** docs/runbooks/go-no-go-`<YYYY-MM-DD>`.md (default applied, pending owner sign-off).
>
> **Quy tắc:** chỉ ghi điều đã đo; thiếu bằng chứng = No-Go cho mục đó.
>
> **Docs không phải runtime proof:** mỗi ô bằng chứng là link tới run, commit hoặc artifact, không dán lời khẳng định.

- Base SHA (`git rev-parse HEAD` của `main` khi chốt): `<commit SHA>`
- Image: tag `<tag>` · digest `<digest>` · staging run `<run URL>` (`staging_run_id`: `<run id>`)

## 1. Đang live

Khối đang chạy trên staging hoặc production, đã đo. Hai hàng đầu là điều kiện của G2 (`docs/sessions/web-mvp-phase5-golive-plan.md:241`). Ô bằng chứng trống = No-Go cho khối đó.

| Khối | Môi trường | Bằng chứng (run / commit / artifact) |
| --- | --- | --- |
| Smoke G2: `SMOKE_BASE_URL` (L74) xanh trên URL staging | staging | `<run URL>` |
| Golden path staging G2 (L74) PASS, bằng tài khoản test và dữ liệu test tạo qua sản phẩm, không bao giờ dữ liệu production; log run được lưu | staging | `<run URL>` · `<artifact name>` |
| `<khối>` | `<staging hoặc production>` | `<run URL>` |

## 2. Sau cờ

Khả năng có trong code nhưng nằm sau cờ hoặc cấu hình môi trường. Tên biến và số dòng (`:N`) theo `docs/runbooks/env-manifest-staging-production.md`; giá trị ghi đúng giá trị đo trên app đang chạy của từng môi trường.

| Cờ / khả năng | Giá trị đo được | Ai bật, điều kiện bật, bước rollback | Bằng chứng |
| --- | --- | --- | --- |
| `OUTBOX_DISPATCH_SCHEDULE_ENABLED` (:52) | staging `<giá trị>` · production `<giá trị>` | owner · bật và rollback theo `docs/runbooks/outbox-dispatch-enable-rollback.md` §2, §3 và §7 | `<run URL>` |
| `GENDER_COLLECTION_ENABLED` (:42, :103) | staging `<giá trị>` · production `<giá trị>` | owner · vắng = tắt; App Spec production ghi `GENDER_COLLECTION_ENABLED: "false"` và owner kiểm giá trị đó trên app đang chạy (G4, `docs/sessions/web-mvp-phase5-golive-plan.md:243`); bật ở môi trường thật chỉ sau câu trả lời pháp lý (bước 8.10) | `<commit SHA>` · `<run URL>` |
| `CSP_SCRIPT_NONCE_ENABLED` (:34) | staging `<giá trị>` · production `<giá trị>` | `<ai bật>` · `<điều kiện bật>` · `<bước rollback>` | `<commit SHA>` |
| Đăng nhập Google | staging `<giá trị>` · production `<giá trị>` | owner · Google là đường đăng nhập ở môi trường thật; owner tạo OAuth client Google cho từng môi trường (bước 8.3, `docs/sessions/web-mvp-phase5-golive-plan.md:199`) | `<run URL>` |
| `PLEXCO_DEV_LOGIN` (:101) | staging `<giá trị>` · production `<giá trị>` | không ai bật: không bao giờ đặt ngoài local (bước 8.3); có giá trị trên staging hoặc production = No-Go | `<commit SHA>` |
| `<cờ khác>` | `<giá trị>` | `<ai bật>` · `<điều kiện bật>` · `<bước rollback>` | `<run URL>` |

## 3. Gate và default chờ owner sign-off

PLAN = `docs/sessions/web-mvp-phase5-golive-plan.md`. Nguồn duy nhất của mục này: bảng gate G1-G7 của PLAN (:240-246), danh sách 8.9 của PLAN (:225-230), các dòng DD-154 của `docs/standards/decisions.md` ghi một mục còn chờ, và các default của lane L69 (`docs/sessions/web-mvp-phase5-readiness-p5-runbook-deploy-migration-rollback.md` §5). Không hàng §3 nào của bản go/no-go trong PR 50 được mang sang khi chưa kiểm. Hàng chưa có bằng chứng = No-Go.

### 3.1 Gate G1-G7

| Gate | Bằng chứng để PASS (theo PLAN) | Ai | Trạng thái | Bằng chứng |
| --- | --- | --- | --- | --- |
| G1 §7.1 egress verified (:240) | mỗi dịch vụ outbound của lần ra mắt đầu (Zalo; Meta chỉ khi Q6 = vào) có hàng bằng chứng theo `docs/decisions/analysis/dd-04-egress-evidence-review-criteria.md` (URL, ngày truy cập, câu trích nguyên văn; câu trả lời viết, quy được về người trả lời); trạng thái gate ở `docs/standards/environments-setup.md:66` rời `HALT-EVIDENCE_INCOMPLETE`; nếu Zalo cần IP outbound cố định thì Q7 đã chốt | L62 (trang chính thức); owner gửi email hoặc ticket cho vendor và chuyển câu trả lời viết (bước 8.4) | `<PASS hoặc chưa PASS>` | `<artifact name>` · `<commit SHA>` |
| G2 staging up và golden path staging PASS (:241) | L64, L65, L66, L67, L69, L73, L74 đã merge; điều kiện phơi bày O-6 đã đóng TRƯỚC lần deploy staging đầu tiên (8.6), theo Q10 (limiter DB của L73, hoặc luật ingress đếm mỗi IPv6 /48 là một client, hoặc bề mặt discovery không tới được ngoài local; rate limit theo IP ở edge không đóng được); owner đã nhập mọi secret staging theo tên (8.5) và bấm `workflow_dispatch` của workflow staging (8.6); run deploy xanh; smoke `SMOKE_BASE_URL` (L74) xanh trên URL staging; golden path staging (L74) PASS bằng tài khoản test và dữ liệu test tạo qua sản phẩm, không bao giờ dữ liệu production; log run được lưu | L64-L67, L69, L73, L74 (file); owner (secret, trigger, chạy smoke và golden path trên staging, 8.6; luật ingress nếu Q10 = (ii)) | `<PASS hoặc chưa PASS>` | `<run URL>` · `<artifact name>` |
| G3 nghiệm thu §7.6 trên staging (:242) | 6 mục prompt nêu (bảng dưới §9 của PLAN) PASS, rồi 7 mục còn lại đặt ở G3 PASS hoặc được hoãn kèm sign-off của owner (8.9); mục 2 kiểm ở G2 (staging) và G4 (production) | L63, L66, L69, L70, L72, L73 (runbook, file); owner chạy và chứng kiến mọi drill (8.7) | `<PASS hoặc chưa PASS>` | `<artifact name>` |
| G4 production up, giới tính tắt (:243) | G3 PASS; owner nhập secret production (8.5) và bấm `workflow_dispatch` của workflow production (8.6); App Spec production ghi `GENDER_COLLECTION_ENABLED: "false"` (L66; DD-150 Q7, DD-141) và owner kiểm giá trị đó trên app đang chạy; smoke production xanh; domain và TLS theo Q4 chạy; §7.6 mục 2 kiểm trên production | L66, L67 (file); owner (secret, trigger, kiểm) | `<PASS hoặc chưa PASS>` | `<run URL>` · `<commit SHA>` |
| G5 projector bật (:244) | owner chạy CLI `scripts/outbox-projector-enable.mjs` theo thứ tự của runbook staging/production (L71, thứ tự owner duyệt), mỗi bước kiểm của runbook PASS, đường rollback của runbook đã biết; hạn 60 phút của `zalo_dm` (DD-146) giữ nguyên | L71 (runbook); owner chạy (8.8) | `<PASS hoặc chưa PASS>` | `<artifact name>` |
| G6 pilot với 1-2 CLB (:245) | owner đã xác nhận bằng văn bản bước sign-off trước pilot (8.9); tám điểm pháp lý đã trả lời và trang quyền riêng tư, điều khoản (L75) chỉ publish sau đó (8.10); hướng dẫn host (L76) đã merge; CLB đã chọn và mời theo Q5 (8.11); form go/no-go (template này, L69) owner điền và xác nhận; kiểm cài đặt PWA ở 8.7 đã xong, hoặc hướng dẫn L76 không hứa "cài app" | L69, L75, L76 (file); owner (pháp lý, chọn CLB, go/no-go) | `<PASS hoặc chưa PASS>` | `<commit SHA>` |
| G7 review (:246) | hết cửa sổ pilot (Q5): ghi chú review có sự cố, lỗi và log, chi phí so với budget alert, kế hoạch cho các mục §7.6 đã hoãn, quyết định mở rộng, giữ hay rollback | owner quyết; bản nháp do một phiên docs sau pilot soạn (không phải lane của plan này) | `<PASS hoặc chưa PASS>` | `<commit SHA>` |

### 3.2 Danh sách 8.9 của PLAN (:225-230)

Mỗi mục đang áp default; owner giữ, đổi hoặc chặn (bước 8.9).

| Mục (nguồn) | Owner: giữ / đổi / chặn | Bằng chứng |
| --- | --- | --- |
| Báo cáo đóng Phase 4 §3, USER-VISIBLE (:227): chuỗi UI mới conflict, timeout, replayed của L49 (RO-L49-2 Q1-Q4) | `<giữ / đổi / chặn>` | `<commit SHA>` |
| Báo cáo đóng Phase 4 (:227): bot bị thu hồi dùng lại cặp 400 `ZALO_TOKEN_INVALID` (L47 Q5, host thấy) | `<giữ / đổi / chặn>` | `<commit SHA>` |
| Báo cáo đóng Phase 4 §5 (:227): copy xung đột ở `onboarding/club/route.ts` và `onboarding/zalo/connect/route.ts` (ngoài phạm vi L49, host thấy) | `<giữ / đổi / chặn>` | `<commit SHA>` |
| Báo cáo đóng Phase 4 (:227): khoảng trống guest của L40, R2a hay R2b (R2b được khuyên, cần thêm một migration; chỉ chặn nếu CLB pilot dùng guest) | `<giữ / đổi / chặn>` | `<commit SHA>` |
| DD-129 (1) (:228; `docs/standards/decisions.md:144`, đóng băng, chưa được owner duyệt): job `migrate` `PRE_DEPLOY` giữ riêng `DATABASE_URL_MIGRATION` (lệch với "protected CI job" ở `docs/standards/environments-setup.md:357`) | `<giữ / đổi / chặn>` | `<commit SHA>` |
| DD-129 (2): secret chỉ nằm trong DO | `<giữ / đổi / chặn>` | `<commit SHA>` |
| DD-129 (3): deploy theo digest, promote không build lại | `<giữ / đổi / chặn>` | `<commit SHA>` |
| DD-129 (4): staging `workflow_dispatch` với environment duyệt, production gõ xác nhận, không trigger `push` | `<giữ / đổi / chặn>` | `<commit SHA>` |
| DD-129 (5): staging 1/1/1 | `<giữ / đổi / chặn>` | `<commit SHA>` |
| DD-129 (6): không thêm vendor error tracking, Sentry giữ backlog (lệch Sentry Developer Day-1) | `<giữ / đổi / chặn>` | `<commit SHA>` |
| DD-129 (7): log forwarder Logtail hay Papertrail | `<giữ / đổi / chặn>` | `<commit SHA>` |
| DD-129 (8): RPO ≤ 15 phút, RTO ≤ 60 phút | `<giữ / đổi / chặn>` | `<commit SHA>` |
| §7.6 mục 5, hoãn ở G3 (:229; nội dung mục ở §7.6 của PLAN): nếu Q3 chọn một instance | `<giữ / đổi / chặn>` | `<commit SHA>` |
| §7.6 mục 6: nếu Q10 chọn (iii) | `<giữ / đổi / chặn>` | `<commit SHA>` |
| §7.6 mục 10: nếu Q8 chọn key local | `<giữ / đổi / chặn>` | `<commit SHA>` |
| §7.6 mục 11: staging tạm dựng từ IaC, tự huỷ | `<giữ / đổi / chặn>` | `<commit SHA>` |
| §7.6 mục 12: load test | `<giữ / đổi / chặn>` | `<commit SHA>` |
| §7.6 mục 13: nửa migration của rehearsal ở provider khác; phải xác nhận trước G4 | `<giữ / đổi / chặn>` | `<commit SHA>` |
| Ngoài danh sách (:230): 93 câu hỏi spec ở §5 của báo cáo đóng Phase 4 (dòng backlog `owner-questions-docs-spec-sync-dd138-dd142`) chưa phân loại; câu nào owner kéo vào đây thì câu đó chặn G6 | `<giữ / đổi / chặn>` | `<commit SHA>` |

### 3.3 Mục còn chờ trong DD-154

Mỗi hàng chép lời của chính dòng D. Q1, Q2, Q4-Q10 không thuộc mục này: D DD-154 (`docs/standards/decisions.md:1853`) ghi nhãn "default applied, pending owner sign-off" ở :119 của PLAN "không còn áp cho các default này, vì nay đó là câu trả lời của owner".

| Mục (nguồn) | Default đang áp, lời của dòng D | Owner: giữ / đổi / chặn | Bằng chứng |
| --- | --- | --- | --- |
| D DD-154 (c), điều kiện lên HA (`docs/standards/decisions.md:1885`) | lời owner nguyên văn "upgrade production to HA before money flows or before adding more clubs"; vế "before money flows", cách đọc 1, trước khi bất kỳ khoản thanh toán nào chạy qua Plexco: "default applied, pending owner sign-off"; cách đọc 2, pilot ghi tiền thật bằng `cash` và `attested_transfer` từ G6, nên việc lên HA phải xong trước G6: "the owner decides" | `<giữ / đổi / chặn>` | `<commit SHA>` |
| D DD-154 (j2), hình dạng staging của G2 (`docs/standards/decisions.md:1893`) | DD-154 không quyết điều này: default của conductor ghi ở `docs/autopilot-templates/web-mvp-phase5-2026-10-28-RUN.md` (S3), nhãn "default applied, pending owner sign-off" | `<giữ / đổi / chặn>` | `<commit SHA>` |

### 3.4 Default của lane L69

Mỗi hàng: "default applied, pending owner sign-off" (`docs/sessions/web-mvp-phase5-readiness-p5-runbook-deploy-migration-rollback.md` §5, D1-D9).

| Default (nguồn) | Owner: giữ / đổi / chặn | Bằng chứng |
| --- | --- | --- |
| D1: tên runbook `docs/runbooks/migration-on-deploy-and-rollback.md` | `<giữ / đổi / chặn>` | `<commit SHA>` |
| D2: thứ tự tạo app lần đầu ở `docs/runbooks/staging-deploy.md` §2.5 (tạo, nhập giá trị trong DigitalOcean, đặt `DO_APP_ID`, chạy lần đầu) và chuỗi tạo app điền tay chỉ owner làm; RO-L69-2 ruling 1, conductor quyết dưới uỷ quyền của owner, không phải chữ ký owner | `<giữ / đổi / chặn>` | `<commit SHA>` |
| D3: nguồn của §3 này chỉ là PLAN :240-246, PLAN :225-230 và `docs/standards/decisions.md`; không hàng §3 nào của PR 50 được mang sang khi chưa kiểm | `<giữ / đổi / chặn>` | `<commit SHA>` |
| D4: kiểm K-a (deployment đang active của app, rồi digest image web của nó) qua các trường jq của bước R4, `docs/runbooks/migration-on-deploy-and-rollback.md` §5; cột chính thức của `doctl apps get` là Q2(b) [Owner] | `<giữ / đổi / chặn>` | `<commit SHA>` |
| D5: đọc phạm vi (RO-L69-S4a-1, orchestrator, Tier B, reversible): nội dung §10 mục 8 của PLAN (grant USAGE một lần, các kiểm DEPLOYMENT INPUTS của backlog) nằm ở `docs/runbooks/migration-on-deploy-and-rollback.md` §2 thành bước [Owner]; bước kiểm của L69 ở §7.6 mục 5 (PLAN :265) là `docs/runbooks/staging-deploy.md` §8 | `<giữ / đổi / chặn>` | `<commit SHA>` |
| D6: tên bản copy docs/runbooks/go-no-go-`<YYYY-MM-DD>`.md | `<giữ / đổi / chặn>` | `<commit SHA>` |
| D7: bước nền tảng chưa trích được dạng chính thức thì ghi UNPINNED kèm bước kiểm | `<giữ / đổi / chặn>` | `<commit SHA>` |
| D8: một hàng backlog ở cuối `docs/autopilot-backlog.md` (RO-L69-2 ruling 3): đường tạo app lần đầu trong tooling, ví dụ mode tạo của renderer điền placeholder không cần app live, hoặc job tạo trong workflow; chưa build trong lane L69 | `<giữ / đổi / chặn>` | `<commit SHA>` |
| D9: đoạn tạo app tự động từ spec ở `docs/standards/environments-setup.md` (:418-424 ở base của lane) đổi thành con trỏ tới `docs/runbooks/staging-deploy.md` §2.5, ghi rằng spec đã commit mang placeholder do renderer điền từ app live; RO-L69-2 ruling 2, conductor quyết dưới uỷ quyền của owner, không phải chữ ký owner | `<giữ / đổi / chặn>` | `<commit SHA>` |

## 4. Bằng chứng đã đo

## 5. Owner ask còn mở

## 6. Ký (để trống)
