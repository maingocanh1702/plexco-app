# Web MVP Phase 4: kế hoạch (local-only), chờ owner duyệt

<!-- review-readiness: enforce -->

> Tài liệu cho owner đọc để quyết, không phải prompt. Prompt lane cho agent (RUN doc) chỉ được viết SAU khi owner trả lời §5; PR này không có RUN doc.
> Docs-only: không code, không test, không migration. Plan này **không authorize coding**; mỗi lane vẫn cần verdict `CODE_READY` riêng ở step 0 của session chạy nó.
> Ngày 2026-10-25 · baseline `origin/main` `7b31d1fe0f5e25c08d554cb191032596204fe2ed` (= merge #113). Cùng khuôn `docs/sessions/web-mvp-phase3-plan.md` (PR #58). Số đo lịch sử Phase 3: `docs/research/web-mvp-phase3-lane-timing-measurements-2026-10-25.md` (cùng PR).

## 1. Tóm tắt

- Phase 4 làm phần owner đã gắn nhãn Phase 4, chỉ local: **C1** trang chia sẻ `/session/<slug>` (L39), **C2** player tự rời trên web (L40), **C3** phần chuẩn bị bảng mã lỗi Zalo với fake (L47; phần bot thật chờ token của owner), **C4** đồng bộ spec theo các dòng "Spec follow-up" của DD-138 và DD-139..DD-142 (L51, L52), các follow-up R1-5 của luật tên (L41-L43), và gia cố `zalo_dm`/outbox trước khi owner bật thật (L44-L46).
- Thêm: theo dõi advisory phụ thuộc có hạn (L54, trong cửa sổ 2026-12-01..2026-12-14, trước hạn xem lại `braces`), gia cố quyền và tiền (L48 kiểm lại quyền trong transaction, L49 giữ `commandId` qua reload), harness proof public (L50), dọn test DB (L55), docs vận hành (L53).
- 17 lane chắc chắn (L39-L55) = 16 lane chạy trong 6 sóng + L54 chạy một mình trong cửa sổ 2026-12-01..2026-12-14, ngoài 6 sóng (thêm 3-7 giờ, tính riêng); L56, L57 chỉ chạy nếu owner chọn khác default ở Q2, Q3 (mỗi lane thêm khoảng 7.7 giờ và một sóng). Migration chắc chắn: 0072 (L41) rồi 0073 (L46); 0074/0075 chỉ khi lane có điều kiện chạy. Mỗi lane = một branch + một worktree + một writer = một PR, tối đa một migration.
- Ước lượng: 46-57 giờ chạy cho 16 lane trong 6 sóng, đã gồm usage limit (1.9-2.4 ngày nếu chạy liên tục); kiểm chéo theo nhịp P3-S16: 55-75 giờ lịch. L54 thêm 3-7 giờ trong tháng 12; mỗi lane có điều kiện thêm khoảng 7.7 giờ. Cách tính và nguồn ở §6; không hứa lịch.
- **C5** và job Pro→Free: không thành lane; retention đã chốt 1 tháng, chỉnh được. Chỉ còn câu Q1. Mọi chỗ plan khác danh sách khởi điểm của prompt Phase 4, kèm nguồn: cuối §2.
- Việc chỉ owner làm (§8): token bot Zalo thật + bật projector, người dùng thật, các điểm pháp lý, PR #50/DigitalOcean. Không lane nào làm hay phải chờ các việc đó.
- 10 câu hỏi (§5); 4 default **USER-VISIBLE** (Q4, Q5, Q7, Q10).
- **Đề xuất: duyệt kế hoạch như đã viết và trả lời Q1-Q10 theo default.**
- **Điều kiện resume (nhị phân):** chỉ tin nhắn VIẾT "Phase 4 plan approved" của owner, kèm trả lời từng câu (ví dụ "Q1-Q10 default", hoặc override từng câu), mới khởi động Phase 4. Tin nhắn đó cho phép merge PR này nếu owner chưa merge; sau đó mới ghi DD cho các câu trả lời, viết RUN doc + lane prompt, và lane đầu tiên chỉ bắt đầu trên `main` đã chứa PR này. Merge PR này mà không có tin nhắn đó không ký gì, không khởi động gì.

## 2. Phạm vi, baseline và luật local-first

**Luật local-first (mục 3 trong prompt Phase 4 của owner), nguyên văn:** "keep the standing skip list (legal, meta review, vendor emails, DigitalOcean setup, secrets, Google OAuth); everything is built and tested locally; no bank/QR/payment in the MVP." Áp vào plan:

- Mọi lane build và test trên máy local (một Postgres compose dùng chung, một khoá cho suite DB và e2e). Agent chỉ bật dispatch hay projector trong test process hoặc scratch DB local (test, đo, golden path); bật cho dùng thật là bước P0 của owner.
- Skip list giữ nguyên: legal, meta review, email vendor, setup DigitalOcean, secret, Google OAuth. Không lane nào chạm PR #50.
- Không ngân hàng, QR hay thanh toán trong app; tiền chỉ ghi tay (cash | attested_transfer). Không billing hay paywall `host_pro`, không nhắc tự động (DD-132).

**Baseline (đo tại `7b31d1fe0f5e25c08d554cb191032596204fe2ed`):**

- Migration tail `packages/db/migrations/0071_zalo_dm_promotion_start_definer.sql`; số trống kế tiếp 0072.
- `docs/autopilot-backlog.md`: 281 heading `## task:`, 108 dòng `status: idea`; cả hai số tính luôn khối mẫu ở `docs/autopilot-backlog.md:138`, nên là 280 dòng thật, 107 idea thật. 6 dòng ghi "Phase 4".
- PR mở: #50 là PR mở duy nhất lúc lập plan (staging, DigitalOcean; đóng băng, chỉ owner); PR này là PR mở thứ hai.
- Cờ: `OUTBOX_DISPATCH_SCHEDULE_ENABLED=true` và `GENDER_COLLECTION_ENABLED=true` trong `.env.example` (DD-141, từ #94).
- Ba projector `web_realtime`, `zalo_dm`, `public_sessions` được seed ở trạng thái tắt: cột `enabled` mặc định false (`packages/db/migrations/0056_outbox_projector_registry_dlq_replay.sql:74`), câu INSERT ba tên (`packages/db/migrations/0056_outbox_projector_registry_dlq_replay.sql:106`). Chỉ bật qua CLI của owner `scripts/outbox-projector-enable.mjs:8`, theo `docs/runbooks/outbox-dispatch-enable-rollback.md`.
- Deliverer Zalo thật đã có: giải mã token bot của CLB (`apps/bot/src/projectors/zalo-dm.ts:155`) và chỉ gửi khi projector `zalo_dm` bật (`apps/bot/src/projectors/zalo-dm.ts:190`). Việc của owner là token bot thật + bật projector, không phải viết deliverer.
- Luật ENABLEMENT của RUN doc Phase 3 đã cũ: `docs/autopilot-templates/web-mvp-phase3-2026-10-16-RUN.md:73` ghi "Committed defaults and .env.example stay false"; DD-141 đã thay luật đó cho default commit. RUN doc Phase 4 phải mang luật đã sửa (Q8).
- Nhãn nguồn: default của plan = "default applied, pending owner sign-off"; lựa chọn của owner ngày 2026-10-24 giữ nhãn "accepted under the owner's delegation of 2026-10-24 (assistant review)" (DD-149); DD-145 là bảng duy nhất owner ký từng dòng.
- Số dòng `docs/standards/decisions.md` và `docs/autopilot-backlog.md` trong plan đo tại baseline; PR sau chèn dòng sẽ làm lệch.

### Chỗ plan khác danh sách khởi điểm của prompt

Danh sách khởi điểm là mục 1 và 2 trong prompt Phase 4 của owner. Mỗi chỗ plan làm khác, kèm nguồn:

- **Job Pro→Free theo DD-142 và C5 không thành lane.** DD-142 ghi "Không có lane: B4 là 'a decision-record change plus backlog rows'" (`docs/standards/decisions.md:2198`); mục 8 của owner ngày 2026-10-22 ghi "Billing is not in the MVP: this is the decision record plus the backlog row (C5) only" (`docs/standards/decisions.md:2210`). Bảng có nhưng không có writer: `packages/db/schema.ts:1835-1853` (`subscriptions` có past_due, `subscription_invoices` có overdue); câu INSERT duy nhất vào `subscription_invoices` ngoài migration là một test (`packages/db/src/rls-invariants.test.ts:4028`). C5 chỉ còn câu Q1, đóng dòng quyết định.
- **Retention là 1 tháng, chỉnh được bằng một giá trị config**, không phải "owner quyết 1-3 tháng sau" (mục 8 của owner ngày 2026-10-22, `docs/standards/decisions.md:2210`). Hook retention cũng không thành lane: chưa có giá trị config nào để gắn vào. Lệnh đo: `git grep -n -i -E 'downgrade|pro.to.free|late.invoice' -- apps packages .env.example ':!*.test.*' ':!packages/db/migrations/*'` ra 2 hit, cả hai là comment về race (`packages/db/src/capability.ts:173`, `packages/db/src/capability.ts:180`); `git grep -c -i retention -- .env.example` ra 0; các hit "retention" khác trong code là của bảng khác (ví dụ `packages/db/schema.ts:244`). Job sẽ chạy trên 0 hàng, còn một hằng config không ai gọi là dead code ⇒ thành Q1.
- **Zalo:** prompt xếp "real Zalo bot token and deliverer" cho owner; deliverer đã có (`apps/bot/src/projectors/zalo-dm.ts:155`, `apps/bot/src/projectors/zalo-dm.ts:190`), nên việc chỉ owner làm là token bot thật + bật projector (§8 bước 1, 2); agent chỉ chuẩn bị bảng mã lỗi với fake (L47).
- **Theo dõi advisory "định kỳ"** thành một lane có ngày, L54 (cửa sổ 2026-12-01..2026-12-14), cộng trigger `schedule:` hằng tuần của Q6 và luật mở lại lane (ghi chú L54 ở §3). DD-149 mục 5 yêu cầu xem lại `braces` trước 2026-12-14 (`docs/standards/decisions.md:1774`).
- **C4 thành hai lane (L51, L52)** dù mục C ngày 2026-10-21 của owner ghi "one docs lane to sync the DD-138 spec follow-ups" (`docs/autopilot-backlog.md:6593`). Lý do: scope của dòng là 19 file ở hai vùng spec, 9 file BE tech và 10 file product, FE, UX (`docs/autopilot-backlog.md:6587`); plan tách theo hai vùng đó, L51 lấy phần BE và L52 lấy phần product, FE, UX, để hai lane chạy ở hai sóng khác nhau (sóng 1, sóng 2), mỗi lane trong trần 3 run của lane docs. L51 còn mang dòng drift `docs-drift-sessions-fe-zalo-tech-readme-pins` (mục (1)-(5) của dòng, `docs/autopilot-backlog.md:6077-6083`, và 8 file của dòng ngoài tech Zalo và `ci.yml`, `docs/autopilot-backlog.md:6071`), nên L51 không chỉ đọc vùng BE. Nhãn: default applied, pending owner sign-off.

## 3. Bảng lane

| Lane | Dòng backlog | Phạm vi | File / vùng | Test nghiệm thu | Size (ước đoán) | Phụ thuộc | Migration | Run cap |
|---|---|---|---|---|---|---|---|---|
| L39 p4-web-share-page (P2, public) | `web-public-session-share-page` (C1) | trang `/session/<slug>` chỉ đọc whitelist public; nút sao chép link cho host nếu step 0 xác nhận base chưa có nơi tạo link (dòng backlog ghi vậy) | trang mới dưới apps/web/app/session/ (chưa có); view share public; trang session của host nếu cần nút | DTO chỉ có trường whitelist (không tiền, không PII); slug lạ, session private hoặc đã rời public ⇒ 404 fail closed; tuỳ chọn ẩn địa chỉ ON ⇒ chỉ khu vực, OFF ⇒ venue (DD-139); chuỗi t(vi, en); e2e trên scratch DB có `public_sessions` bật bằng CLI | ~250 LOC · 2-3 module | không | không (cần SQL ⇒ ruling) | 6 |
| L40 p4-web-player-leave (P2) | `web-player-leave-and-cancel` (C2) | chỉ UI + copy: API rời đã có | `apps/web/app/me/sessions/page.tsx`; route có sẵn `apps/web/app/api/sessions/[id]/leave/route.ts` (không sửa) | tiền ròng 0 ⇒ rời, người đầu waitlist được nâng; còn tiền ⇒ route trả 409 `LEAVE_REQUIRES_HOST`, UI báo t(vi, en) "liên hệ host", không ghi gì; người trong waitlist rời được; e2e | ~150 LOC · 2 module | không | không | 4 |
| L41 p4-name-definers-and-rule-tests (P1) | `member-name-definers-qualify-builtins`, `member-name-rule-residual-precision`, `ci-node-unicode-version-vs-name-rule-sets` (R1-5); comment `.github/workflows/ci.yml:130` của `docs-drift-sessions-fe-zalo-tech-readme-pins` (mục 5, chuyển từ L51) | qualify built-in trong thân definer mà 0070 tạo lại; test biên còn thiếu; đo phiên bản Unicode của Node trên CI; comment font ở `ci.yml:130` ghi đúng font mà web tải thật qua next/font | một migration mới; `packages/db/src/member-name-writer-guard.test.ts`, `packages/db/src/member-name-invisible-chars.test.ts`, `.github/workflows/ci.yml` | thân definer pin lại với built-in có schema; test biên; test khẳng định bộ ký tự khớp phiên bản Unicode của Node trên CI; full DB suite | ~260 LOC · 3 module | L55 | 0072 | 6 |
| L42 p4-name-rules-db (P2; P1 nếu thêm CHECK) | `name-fields-one-visible-check-one-length-rule` (phần DB), `tenant-repo-sessions-create-area-venue-strip` | một hằng độ dài + một hàm "có ký tự nhìn thấy" dùng chung; tạo session qua tenantRepo áp strip của L23 cho area/venue | `packages/db/src/me-settings.ts:20`, `packages/db/src/roster-money-shared.ts:58`, `packages/db/src/tenant.ts` (scope của dòng thứ hai, `docs/autopilot-backlog.md:6707`) | grep còn đúng một định nghĩa; tên toàn ký tự ẩn bị từ chối ở mọi writer; area/venue có ký tự ẩn bị strip như đường session-service | ~150 LOC · 1-2 module | L41 | không (Q4 c) | 4 |
| L43 p4-name-rules-web (P2) | `name-fields-one-visible-check-one-length-rule` (phần web), `name-readers-null-name-one-fallback`, `club-create-sql-22023-maps-to-400` | model web dùng luật của L42; một fallback cho tên NULL; SQL 22023 khi tạo CLB ⇒ 400 | `apps/web/lib/session-form-model.ts:162`, `apps/web/lib/club-settings-model.ts`, `apps/web/lib/me-settings-client.ts`, `apps/web/lib/roster-rules.ts`, `apps/web/components/sessions/request-inbox.tsx`, `apps/web/components/chat/message-list.tsx`, `apps/web/app/api/onboarding/start/route.ts` | form web từ chối đúng như server; ba màn đọc tên NULL hiện cùng một chuỗi; route start trả 400 + thông báo t(vi, en) khi DB raise 22023 | ~150 LOC · 3 module | L42, L49 | không | 4 |
| L44 p4-zalo-dm-deadline-and-clock (P2) | `zalo-dm-send-deadline-into-deliver`, `zalo-dm-attempt-budget-monotonic-clock` | đưa hạn gửi của DD-146 vào lệnh deliver; ngân sách lần thử theo đồng hồ đơn điệu | `apps/bot/src/projectors/zalo-dm.ts`, `apps/bot/src/dispatcher.ts` | lần gửi bắt đầu sát hạn DD-146 bị cắt ở hạn (timeout ≤ hạn − now, fake clock), lần thử lại sau hạn không gửi (`docs/autopilot-backlog.md:6969-6970`; kiểm trước lúc gửi đã có nên không đủ làm test); đồng hồ hệ thống nhảy không làm đổi ngân sách lần thử; test cycle bot xanh | ~80 LOC · 1 module | không | không | 4 |
| L45 p4-zalo-dm-routable-list-and-cycle-tests (P2) | `zalo-dm-routable-event-types-one-list`, `bot-zalo-dm-cycle-tests-isolation-and-cells`, `owner-cli-pg-client-inside-try`, `bot-queues-outbox-schedule-default-comment` | một danh sách event type route được, dùng chung cho dispatcher và CLI; cô lập cell test cycle và thêm ba cell còn thiếu; hai CLI owner mở client Postgres trong `try`, kèm ghi chú percent-encode mật khẩu trong runbook (`docs/autopilot-backlog.md:6715`); sửa comment default của lịch | `apps/bot/src/dispatcher.ts`, `scripts/outbox-projector-enable.mjs`, `scripts/outbox-dlq-replay.mjs`, `docs/runbooks/outbox-dispatch-enable-rollback.md` (scope của dòng, `docs/autopilot-backlog.md:6721`), `apps/bot/src/projector-registry.test.ts`, `packages/db/src/zalo-dm-delivery.test.ts`, `apps/bot/src/queues.ts:12` | test drift: danh sách khớp CHECK của 0056; mỗi cell chỉ đụng event id của nó (chạy hai lần liền xanh); có ba cell mà dòng nêu là còn thiếu (`docs/autopilot-backlog.md:7068`); lỗi kết nối ⇒ client đóng, exit khác 0; comment khớp default true | ~230 LOC · 3 module | L44 | không | 4 |
| L46 p4-outbox-lease-clock (P1) | `projector-delivery-batch-lease-clock-consistency` | lease của batch giao dùng một đồng hồ nhất quán (dư của review L24) | SQL definer của outbox (một migration); `apps/bot/src/dispatcher.ts` nếu step 0 thấy cần | lease không hết hạn sớm trong transaction dài; test migration; test dispatcher xanh | ~150 LOC · 2 module (step 0 đọc cả dòng) | L45; L41 (thứ tự số) | 0073 | 6 |
| L47 p4-zalo-error-mapping-fakes (P2) | `zalo-outbound-error-mapping-real-bot-verification` (chỉ nửa fake, C3), `zalo-connect-bot-revoked-error-mapping` | ma trận lỗi Zalo chạy với server fake; mẫu evidence cho lần chạy bot thật của owner; bot bị thu hồi lúc connect ⇒ mã của Q5 | test client gửi của `apps/bot` (step 0 định vị), `apps/web/app/api/onboarding/zalo/connect/route.ts`, `packages/db/src/zalo-ingress.ts`, file evidence mới dưới docs/sessions/ | mỗi lớp 401, 429, 5xx, 4xx khác, 2xx `ok:false`, payload sai hoặc quá cỡ, timeout, lỗi mạng ⇒ kết quả đã định (retry, DLQ hay noop) với fake; route connect trả mã của Q5; `finishZaloConnect` gặp 22023 (bot đã thu hồi) ⇒ mã của Q5, không còn 500 (`docs/autopilot-backlog.md:6175-6176`) | ~200 LOC · 3 module | L45 | không | 4 |
| L48 p4-session-commands-authz-recheck (P1) | `session-commands-actor-recheck-under-lock` | kiểm lại quyền của actor trong transaction của mỗi lệnh session | `packages/db/src/session-service.ts`, `apps/web/lib/session-command-route.ts` (scope của dòng, `docs/autopilot-backlog.md:5749`; ví dụ kiểm trong tx đã có: `authorizeTenantAction` ở `packages/db/src/session-service.ts:511`, là kiểm tenant, chưa phải kiểm actor) | actor mất quyền giữa lúc route kiểm và lúc lệnh khoá hàng ⇒ lệnh bị từ chối, không ghi gì; hoặc step 0 chứng minh mọi lệnh đã kiểm dưới khoá ⇒ đóng dòng bằng bằng chứng, không code | 0-200 LOC · 2 module | L42 (lane có thể sửa cùng file service: strip mà L42 phải dùng lại là `stripPublicNames`, không export, chỉ có trong `packages/db/src/session-service.ts:124`; dòng ghi "serialize against any other lane touching session-service.ts", `docs/autopilot-backlog.md:5756`) | không | 6 |
| L49 p4-web-command-id-persistence (P2, tiền) | `web-command-id-persistence-and-conflict-copy`, `web-api-client-timeout-and-refresh-notice-focus` | giữ `commandId` qua reload và Cancel cho lệnh tiền đang chờ (trả một phần, thêm theo tên); sửa copy t(vi, en) của `COMMAND_ID_CONFLICT`; timeout cho client API, focus cho thông báo | `apps/web/components/sessions/edit-session-view.tsx`, `apps/web/lib/session-command-route.ts`, `apps/web/lib/use-roster-command.ts` (scope của dòng, `docs/autopilot-backlog.md:6094`); `apps/web/lib/api-client.ts` (scope của dòng thứ hai, `docs/autopilot-backlog.md:6105-6114`) | reload hoặc Cancel rồi gửi lại ⇒ server dedupe, không ghi tiền hai lần (e2e); `COMMAND_ID_CONFLICT` hiện chuỗi t(vi, en) đã sửa; client API hết giờ ⇒ thông báo t(vi, en) nhận focus; security round | ~200 LOC · 2 module | L40, L48 (cùng `apps/web/lib/session-command-route.ts`) | không | 6 |
| L50 p4-public-proof-harness (P2) | `public-card-proof-port-preflight-any-owner`, `public-card-proof-no-drop-line-exception-complete`, `local-smoke-step11-latest-result-depin` | harness proof public mà L35 dựng | `apps/web/e2e/public-card-hide-address-proof.sh`, `docs/runbooks/local-mvp-smoke.md` | script từ chối khi cổng bị giữ bởi tiến trình của bất kỳ user nào; danh sách ngoại lệ đủ; bước 11 của runbook trỏ kết quả đo mới nhất, không ghim số | ~55 dòng · 2 file | không | không | 4 |
| L51 p4-docs-spec-sync-be (P2, docs) | `docs-sync-phase3-owner-decision-spec-follow-ups` (phần BE, C4), `docs-drift-sessions-fe-zalo-tech-readme-pins` | áp đúng các dòng "Spec follow-up" của DD-138 và DD-139..DD-142 vào spec BE (DD-143 không có, `docs/standards/decisions.md:2161`); sửa mục (1)-(5) của dòng drift (`docs/autopilot-backlog.md:6077-6083`: route `/dashboard/sessions`, shape webhook Zalo cũ, pin phiên bản identity ở `docs/features/README.md:77`, `BUILD-STATUS.md` từ M4, font Sora và U+20AB), trừ comment `.github/workflows/ci.yml:130` của mục (5): giao cho L41 vì L41 đã sửa file đó (không đổi sóng) | 9 file `docs/features/BE/feature_*_tech.md` mà dòng C4 liệt kê, ví dụ `docs/features/BE/feature_zalo_channel_tech.md:222`, `docs/features/BE/feature_user_settings_tech.md:153-156` (DD-138, `docs/standards/decisions.md:2442`); 8 file khác của dòng drift (`docs/autopilot-backlog.md:6071`, trừ `ci.yml` và tech Zalo đã đếm) | mỗi dòng follow-up có đúng một sửa tương ứng (checklist trong PR); mỗi mục (1)-(5) có sửa hoặc lý do bỏ (mục 4 bỏ nếu PR khác đã cập nhật, như dòng ghi); `pnpm review:check` xanh; prettier | ~200 dòng · 17 file | không | không | 3 |
| L52 p4-docs-spec-sync-product-fe (P2, docs) | `docs-sync-phase3-owner-decision-spec-follow-ups` (phần product/FE, C4) | như L51 cho product, FE và UX sync | `docs/product/TDD.md:49`, `docs/product/BRD.md`, `docs/product/PRD.md`, `docs/product/ROADMAP.md`, 5 file `docs/features/FE/feature_*.md`, `docs/channels/web/ux-sync-design.md` | như L51 | ~120 dòng · 10 file | không | không | 3 |
| L53 p4-docs-runbooks-start-here (P2, docs) | `start-here-docs-outbox-flag-and-enable-path`, `outbox-runbook-zalo-dm-expiry-wording`, `name-strip-migrations-apply-with-writers-drained` | docs vận hành: cờ outbox và đường bật, chữ về hạn của `zalo_dm`, áp migration strip khi writer đã dừng | `docs/00-start-here/DEV-ONBOARDING.md:77`, `docs/00-start-here/HANDOFF.md:31`, `docs/runbooks/outbox-dispatch-enable-rollback.md`, `docs/standards/deployment-infra.md` | câu chữ khớp code tại base của lane; `pnpm review:check` xanh | ~55 dòng · 4 file | L46 | không | 3 |
| L54 p4-deps-advisory-watch (P1, deps) | `braces-ghsa-vfj7-ignore-expiry-2026-12-21`, `braces-ghsa-vfj7-no-fixed-version`, `pnpm-workspace-postcss-override-inert` | xem lại `braces` trước 2026-12-14; bỏ override postcss vô tác dụng; theo dõi định kỳ (ghi chú dưới bảng) | `osv-scanner.toml:11`, `package.json` (`docs/autopilot-backlog.md:6261`), `apps/web/package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml:15`, workflow security nếu thêm trigger (Q6) | đo lại `pnpm why -r --prod braces`; OSV full scan xanh; ignore bị xoá (có bản vá) hoặc gia hạn với lý do đo lại (Q6); verify đủ (typecheck, lint, test, build, e2e) vì đụng lockfile | ~30 LOC · 5-6 file | cửa sổ 2026-12-01..2026-12-14, chạy một mình | không | 4 |
| L55 p4-db-test-hygiene (P2, test) | `db-test-role-isolation-guard-residual-p3s`, `db-test-link-code-ttl-upper-bound-host-clock-flake`, `db-test-nonsuperuser-owner-bootstrap-jobd-before-chat-slot-hold-and-wait` | dọn flake và harness của test DB dùng chung | `packages/db/src/role-hiding-isolation-guard.test.ts`, `packages/db/src/identity-link-code.test.ts` (TTL, `docs/autopilot-backlog.md:6499`), test bootstrap của `packages/db` (step 0 định vị) | 4 P3 còn lại của #105 đóng; TTL so bằng đồng hồ DB; hai suite khởi động liền nhau không giữ-và-chờ; full DB suite xanh hai lần liền | ~150 LOC · 1 module | không | không | 4 |
| L56 p4-zalo-dm-promotion-live-balance (P1, tiền, CÓ ĐIỀU KIỆN) | `zalo-dm-promotion-live-balance-at-delivery` | chỉ khi Q2 = đọc số dư sống: DM nâng waitlist đọc số dư lúc giao qua definer của 0057 (Tier C, hợp đồng tiền) | dòng chưa có scope, step 0 scope; `packages/db/migrations/0057_zalo_delivery_targets_definer.sql`, `apps/bot/src/projectors/zalo-dm.ts` | DM giao muộn nêu số dư hiện tại; khoản đã trả không bị đòi lại; security round | ~150 LOC · 2-3 module | Q2; L46 | số kế tiếp sau L46 (dự kiến 0074) | 6 |
| L57 p4-member-names-confusables (P1, CÓ ĐIỀU KIỆN) | `member-names-visible-confusables-homoglyphs` | chỉ khi Q3 chọn một luật: từ chối hoặc fold bộ ký tự dễ nhầm đã chọn, giữ nguyên dấu tiếng Việt | `packages/db/src/text-safety.ts`, `packages/db/src/member-name-invisible-chars.test.ts`, một migration luật SQL | test bộ ký tự đã chọn; tên tiếng Việt có dấu không đổi; security round | chưa ước được (tuỳ luật) | Q3; L42; L46, và L56 nếu L56 chạy (mỗi lúc một lane migration) | số kế tiếp (dự kiến 0075, hoặc 0074 nếu L56 không chạy) | 6 |

- **Số lane:** 17 lane chắc chắn (L39-L55) = 16 lane chạy trong 6 sóng + L54 chạy một mình trong cửa sổ 2026-12-01..2026-12-14, ngoài 6 sóng (thêm 3-7 giờ, tính riêng); L56, L57 chỉ chạy nếu owner chọn khác default ở Q2, Q3 (mỗi lane thêm khoảng 7.7 giờ và một sóng).
- **B3 mỗi lane:** khoảng 300 LOC, tối đa 3 module, tối đa 1 migration. Size là ước đoán: không dòng backlog nào có ước lượng; step 0 đo lại, lane vượt phải ghi ngoại lệ B3 ở step 0.
- **Run cap** = số lần orchestrator chạy tối đa cho một lane: 3 cho docs, 4 cho code P2, 6 cho P1, migration, tiền hoặc public. Nguồn: §3 của file research (trung bình 3.47 đến 3.8 run mỗi lane ở Phase 3; 6 là trần quy ước; vượt 6 chỉ khi owner nâng trần).
- **Thứ tự migration (giải xung đột hai nguồn):** ba dòng ghi chắc chắn cần migration: `docs/autopilot-backlog.md:6877` (L41 ⇒ 0072, "needs a migration at the next free number"), `docs/autopilot-backlog.md:6955` (L46 ⇒ 0073, "a migration at the next free number") và `docs/autopilot-backlog.md:6999` (Tier C ⇒ Q2, L56, "money contract, Tier C"). Hai dòng đầu không cần input của owner ⇒ L41 lấy 0072, L46 lấy 0073. Dòng thứ ba là Tier C ⇒ thành câu Q2, lane L56 chỉ chạy khi owner chọn. Hai dòng còn lại chỉ cần migration nếu thêm CHECK hoặc đổi luật (`docs/autopilot-backlog.md:6819`, `docs/autopilot-backlog.md:6848`): Q4 (c) không thêm CHECK; nếu step 0 của L41 thấy phải đổi luật SQL thì thay đổi đó nằm trong chính file 0072. Thứ tự: L41 0072 → L46 0073 → L56 → L57, giữ bằng phụ thuộc (L46 chờ L41, L56 chờ L46, L57 chờ L46 và L56 nếu L56 chạy; §4); số thật đo lại tại base của từng lane (append-only).
- **L39:** trang chỉ có dữ liệu thật khi owner đã bật projector `public_sessions` (§8); lane test bằng scratch DB, theo cách L35 đã chứng minh tuỳ chọn ẩn địa chỉ.
- **L40:** huỷ yêu cầu đang chờ duyệt: step 0 đo route rời có nhận trạng thái chờ duyệt không; nếu không, lane chỉ làm phần rời, phần huỷ thành dòng backlog mới, không viết API mới (default applied, pending owner sign-off; **USER-VISIBLE**, là câu Q10).
- **L47:** phần bot thật của C3 cần token thật của owner (§8, §9), không xếp cho agent.
- **L54, theo dõi định kỳ:** trigger `schedule:` hằng tuần cho OSV full scan nếu step 0 thấy workflow chưa có (Q6); một lane cùng khuôn L54 mở lại khi scan đỏ hoặc khi một ignore còn 14 ngày trở xuống.
- **Không thành lane (hai mục trong danh sách khởi điểm của prompt):** job Pro→Free theo DD-142 và hook retention (billing ngoài MVP, DD-132); lý do và nguồn ở mục "Chỗ plan khác danh sách khởi điểm của prompt" cuối §2.
- **D7 và `braces`:** `join-known-zero-person-equality-proof` chỉ xếp khi identity-merge writer tồn tại (DD-149); lần xem lại `braces` là L54 (hạn 2026-12-14; ignore hết hạn 2026-12-21 ở `osv-scanner.toml:11`). Cả hai là mốc ở §9.

## 4. Đồ thị phụ thuộc và song song

```text
L39 <- (none)       L40 <- (none)       L44 <- (none)       L50 <- (none)
L51 <- (none)       L52 <- (none)       L55 <- (none)
L41 <- L55 [0072]   L42 <- L41          L48 <- L42          L49 <- L40, L48
L43 <- L42, L49     L45 <- L44          L47 <- L45          L46 <- L45, L41 [0073, after 0072 merges]
L53 <- L46          L54 <- window 2026-12-01..2026-12-14, runs alone (lockfile)
L56 <- [Q2 = live balance], L46   (next free number, planned 0074)
L57 <- [Q3 = a rule], L42, L46, L56 if it runs   (next free number, planned 0075, or 0074 without L56)
```

- **Bốn vùng tách file:** web (`apps/web`: L39, L40, L49, L43); DB luật tên và test (`packages/db`: L55, L41, L42); L48 nối hai vùng (`packages/db/src/session-service.ts`, `apps/web/lib/session-command-route.ts`) nên chạy sau L42 và trước L49; L47 cũng nối vùng (`apps/web/app/api/onboarding/zalo/connect/route.ts`, `packages/db/src/zalo-ingress.ts`) nên step 0 của P4-S6 xác nhận file của L47 và L43 không giao nhau, nếu giao thì L43 chạy sau L47; bot và outbox (`apps/bot`, `scripts`: L44, L45, L46, L47); docs và harness (L50-L53).
- **Song song:** tối đa 3 lane sống cùng lúc, mỗi lane ở một vùng khác (như đợt A của P3-S16, §3 của file research) và tối đa một lane có migration tại một thời điểm. Suite DB và e2e của các lane vẫn xếp hàng qua một khoá (một Postgres local, một cổng e2e).
- **Sóng đề xuất:** sóng 1 L55 · L39 · L51; sóng 2 L41 · L40 · L52; sóng 3 L42 · L44 · L50; sóng 4 L48 · L45; sóng 5 L46 · L49; sóng 6 L47 · L53 · L43. Lane sóng sau bắt đầu ngay khi phụ thuộc của nó merge. L54 chạy trong cửa sổ của nó, một mình; L56, L57 chỉ sau câu trả lời Q2, Q3.

## 5. Checklist câu hỏi cho owner

"Ký" = owner VIẾT "Phase 4 plan approved" kèm trả lời từng câu hoặc override (merge PR này một mình không ký gì). DD cho các câu trả lời được ghi SAU khi owner trả lời, không trong PR này. Mọi default dưới đây là "default applied, pending owner sign-off" cho tới khi owner ký. **USER-VISIBLE** = default làm đổi điều người dùng thấy; Q2, Q3 giữ nguyên hành vi theo default, chỉ phương án khác mới đổi.

| # | Câu hỏi | Default đề xuất (default applied, pending owner sign-off) | Chặn gì | USER-VISIBLE | Nguồn |
|---|---|---|---|---|---|
| Q1 | C5 và Pro→Free: ký default "hidden from normal views, retained, restored on re-upgrade" cho dữ liệu chỉ-Pro trong 1 tháng retention, và xác nhận Phase 4 không xây job Pro→Free hay hook retention? | Ký "hidden…"; không xây gì cho billing trong Phase 4 | đóng `host-pro-late-invoice-retention-period-decision` bằng một DD sau câu trả lời; `billing-late-host-pro-invoice-downgrade-to-free` chờ epic billing; không lane nào bị chặn | không (không tenant nào là `host_pro`) | DD-51, DD-142 (`docs/standards/decisions.md:2210`), DD-132 |
| Q2 | DM nâng waitlist giao muộn: giữ `amount_due` lúc emit, hay đọc số dư sống lúc giao (Tier C hợp đồng tiền, cần migration)? | Giữ số lúc emit; L56 không chạy; rủi ro phí cũ đã ghi ở `docs/runbooks/outbox-dispatch-enable-rollback.md:96` | L56 và migration của nó | không (giữ nguyên); chọn "sống" thì số tiền trong DM đổi | DD-140, DD-146, DD-149, `zalo-dm-promotion-live-balance-at-delivery` |
| Q3 | Ký tự dễ nhầm nhìn thấy được (homoglyph) trong tên: có luật từ chối hay fold trong Phase 4 không? | Hoãn, không luật mới; D4 emoji của DD-147 giữ như đã viết ("accepted under the owner's delegation of 2026-10-24 (assistant review)") | L57 và migration của nó | không (giữ nguyên); chọn một luật thì có tên bị từ chối | DD-144, DD-147, `member-names-visible-confusables-homoglyphs` |
| Q4 | Default của lane luật tên L42, L43: (a) một chuỗi fallback cho tên NULL; (b) một độ dài tối đa cho tên hiển thị; (c) CHECK DB trên `persons.display_name`? | (a) chọn một chuỗi đã có trong code, không chuỗi mới; (b) 120, mức lớn nhất đang dùng (`packages/db/src/me-settings.ts:20`; roster đang 100 ở `packages/db/src/roster-money-shared.ts:58`), để không tên đã lưu nào thành sai; (c) không thêm trong Phase 4 (không migration) | L42, L43 | **USER-VISIBLE**: (a) vài màn đổi chữ fallback; (b) host nhập được tên 101-120 ký tự ở roster | `name-readers-null-name-one-fallback`, `name-fields-one-visible-check-one-length-rule` |
| Q5 | Bot Zalo bị thu hồi lúc connect: trả mã và thông báo nào? | Dùng lại mã và thông báo t(vi, en) mà route connect trả khi `getMe` từ chối token (`apps/web/app/api/onboarding/zalo/connect/route.ts:129`); không mã mới | phần bot thu hồi của L47 (phần fake vẫn chạy) | **USER-VISIBLE**: host thấy thông báo token không hợp lệ thay cho thông báo hiện nay (step 0 đo) | `zalo-connect-bot-revoked-error-mapping` |
| Q6 | Theo dõi advisory: làm gì nếu tới 2026-12-14 `braces` vẫn chưa có bản vá; có thêm trigger hằng tuần cho OSV full scan không? | Có bản vá ⇒ bump và xoá ignore; chưa có ⇒ gia hạn `ignoreUntil` tối đa 30 ngày với lý do đo lại, nhãn "default applied, pending owner sign-off"; thêm trigger `schedule:` hằng tuần nếu workflow chưa có | nội dung L54 (lane vẫn chạy) | không | DD-148 D6 (`docs/standards/decisions.md:1808`), DD-149 (`docs/standards/decisions.md:1774`), `braces-ghsa-vfj7-ignore-expiry-2026-12-21` |
| Q7 | `GENDER_COLLECTION_ENABLED` khi có người dùng thật: giữ true ở local và đặt false ở môi trường người dùng thật đầu tiên cho tới khi các điểm pháp lý có câu trả lời? | Có: local giữ true (DD-141); môi trường thật đầu tiên đặt false, thành một dòng trong checklist P0 của owner (§8) | không lane nào; chỉ go-live của owner | **USER-VISIBLE**: ở môi trường đó ô giới tính và notice không hiện | DD-141; 8 câu hỏi pháp lý ở `docs/sessions/web-mvp-phase3-readiness-p3-flags-default-on.md:253` (suy luận: đây là "tám điểm pháp lý"; không file nào gọi tên như vậy) |
| Q8 | Luật ENABLEMENT cho RUN doc Phase 4, thay câu cũ ở `docs/autopilot-templates/web-mvp-phase3-2026-10-16-RUN.md:73`? | Dùng nguyên văn khối dưới bảng | viết RUN doc Phase 4 | không | DD-141 |
| Q9 | Phạm vi: C3 trong Phase 4 chỉ gồm nửa fake (L47) + mẫu evidence, lần chạy bot thật chờ token của owner; PR #50 và deploy staging/prod nằm ngoài Phase 4? | Có, cả hai | phạm vi L47; không lane nào chạm #50 | không | DD-04, DD-132, `zalo-outbound-error-mapping-real-bot-verification` |
| Q10 | C2 (L40): nếu step 0 đo thấy route rời không nhận yêu cầu đang chờ duyệt, Phase 4 chỉ làm phần rời và để phần huỷ yêu cầu chờ duyệt thành một dòng backlog mới (không viết API mới)? | Có | phạm vi L40 (lane vẫn chạy) | **USER-VISIBLE**: trong trường hợp đó player chưa huỷ được yêu cầu đang chờ duyệt trên web | `web-player-leave-and-cancel` (C2), `apps/web/app/api/sessions/[id]/leave/route.ts` |

Khối đề xuất cho Q8:

```text
ENABLEMENT: the committed defaults of OUTBOX_DISPATCH_SCHEDULE_ENABLED and GENDER_COLLECTION_ENABLED are true (DD-141). The projectors web_realtime, zalo_dm and public_sessions are seeded disabled (migration 0056). Agents enable a projector only with scripts/outbox-projector-enable.mjs, and only inside a local test process or a local scratch database, for tests, measurements and the golden path. Enabling for real use (a real Zalo bot token, real users) is the owner's P0 step.
```

## 6. Sizing và ước lượng wall-clock

Nguồn: `docs/research/web-mvp-phase3-lane-timing-measurements-2026-10-25.md` (cùng PR; "§" dưới đây là mục của file đó). Thời lượng lane = từ lúc spawn orchestrator tới merge, đo được ở 6 lane Phase 3 (§4). Không có số đo giờ hoạt động hay tổng worker-round thật (§8), nên ước lượng là một khoảng với giả định ghi rõ. **Không hứa lịch.**

| Loại lane (số đo Phase 3, §4) | Lane Phase 4 | Giờ mỗi lane |
| --- | --- | --- |
| Docs hoặc nhỏ: L28 42 phút (code, 3 file, 1 run), L26 3 giờ 29 (docs, 3 run), L30 6 giờ 57 (docs closeout, 4 run) | L50, L51, L52, L53 | 0.7-7 |
| Code P2, test hoặc deps nhỏ (gồm L54: P1 vì lockfile, nhưng ước như deps nhỏ): L18 2 giờ 59 (test-only, 4 run); cận trên 7 giờ là giả định | L40, L42, L43, L44, L45, L47, L54, L55 | 3-7 |
| P1, migration, tiền hoặc public: L14 7 giờ 42 (5 run); ngoại lệ L13 29 giờ 14, gồm 322 phút usage limit | L39, L41, L46, L48, L49; L56, L57 nếu chạy | khoảng 7.7 |

- **Số lane:** 17 lane chắc chắn (L39-L55) = 16 lane chạy trong 6 sóng + L54 chạy một mình trong cửa sổ 2026-12-01..2026-12-14, ngoài 6 sóng (thêm 3-7 giờ, tính riêng); L56, L57 chỉ chạy nếu owner chọn khác default ở Q2, Q3 (mỗi lane thêm khoảng 7.7 giờ và một sóng).
- **Đường găng theo sóng (§4 của plan này):** mỗi sóng dài bằng lane dài nhất của nó. Sóng 1, 2, 4, 5 có lane loại nặng (7.7 giờ: L39; L41; L48; L46 và L49); sóng 3, 6 chỉ có lane P2 và docs (3-7 giờ). Cộng 4 × 7.7 + 2 × (3 đến 7) = **37-45 giờ chạy** cho 16 lane trong 6 sóng.
- **Usage limit (§5):** giả định của owner "khoảng một lần mỗi 5 giờ" ⇒ 7-9 lần. Mỗi lần trung vị 80 phút (ngắn nhất 11, dài nhất 210): 7-9 lần × 80 phút = 9.3-12 giờ. Tần suất đo được, một lần mỗi 7.3 giờ, là giờ lịch có cả đêm (§5) nên không dùng làm đầu thấp.
- **Sự cố khác (§6):** 2 lần mất đăng nhập, mỗi lần khôi phục 5-9 phút (không đáng kể); 4 classifier AWAIT, ba lần chờ owner (48 phút, 57 phút, 24 giờ 47) và một lần conductor tự trả lời (không ghi thời lượng), không đưa vào khoảng vì phụ thuộc owner; một lần mất mạng 10 giờ 54 (không dự báo được).
- **Tổng:** 37 + 9.3 ≈ **46 giờ** đến 45 + 12 = **57 giờ** (1.9-2.4 ngày nếu chạy liên tục). **Kiểm chéo:** P3-S16 merge 9 lane trong 31 giờ 6 phút (đã trừ lần mất mạng) đến 42 giờ (§4), tức 3.46-4.67 giờ lịch mỗi lane ⇒ 16 lane ≈ 55-75 giờ lịch; hai cách tính chồng nhau ở 55-57 giờ.
- **Orchestrator run:** Phase 3 trung bình 3.47-3.8 run mỗi lane (§3) ⇒ khoảng 59-65 run cho 17 lane chắc chắn; tổng run cap ở §3 của plan này là 75 (87 nếu L56, L57 chạy).

## 7. Thiết kế thực thi

- **Orchestrator:** conductor khởi động từng nhóm lane (một hàng của bảng dưới); mỗi lane trong nhóm có orchestrator riêng, mới, opus effort max (như P3-S16). Orchestrator trả CHECKPOINT khi tới khoảng 20 kết quả worker; lượt kế tiếp là orchestrator mới và tính vào run cap của lane.
- **Worker:** opus/max cho code phức tạp (P1, migration, tiền, quyền, public, concurrency); sonnet cho việc đơn giản (docs, copy, nối UI, harness). Worker dừng ở khoảng 200k context hoặc 80 tool call: commit, viết handoff, trả về; orchestrator mở worker MỚI cùng model và effort. Sau usage limit, agent trên khoảng 250k context không được resume mà thay bằng agent mới từ handoff.
- **Review:** một reviewer Claude độc lập, tối đa 3 vòng (DD-122 D4, không Codex); thêm security round opus/max cho lane tiền, quyền, public hoặc SQL definer (L39, L41, L46, L48, L49, L56, L57).
- **Song song:** tối đa 3 lane sống, mỗi lane một vùng (§4), tối đa một lane có migration tại một lúc; suite DB và e2e qua một khoá.
- **Merge:** một merge clerk cho cả Phase 4, merge từng PR lane khi CI xanh và cổng S4 đạt; lane chỉ bắt đầu trên `main` đã có phụ thuộc của nó. PR #50 chỉ owner.
- **Step 0 mỗi lane:** readiness reviewer đo lại live truth tại base; `CODE_READY` ⇒ file readiness là commit đầu của branch; `NOT_CODE_READY` ⇒ lane không bắt đầu, thành mục AWAIT.

| Session | Lane (model writer) | Vùng | Bắt đầu khi | Run cap |
| --- | --- | --- | --- | --- |
| P4-S1 | L55 (opus) · L39 (opus) · L51 (sonnet) | test DB · web public · docs BE | B1 xong và `main` chứa PR này | 4 · 6 · 3 |
| P4-S2 | L41 (opus) · L40 (sonnet) · L52 (sonnet) | DB + migration 0072 · web · docs product/FE | L55 merge (cho L41) | 6 · 4 · 3 |
| P4-S3 | L42 (opus) · L44 (opus) · L50 (sonnet) | DB luật tên · bot · harness | L41 merge (cho L42) | 4 · 4 · 4 |
| P4-S4 | L48 (opus) · L45 (opus) | DB session-service + route web · bot + scripts | L42 merge (L48); L44 merge (L45) | 6 · 4 |
| P4-S5 | L46 (opus) · L49 (opus) | outbox + migration 0073 · web tiền | L45, L41 merge (L46); L40, L48 merge (L49) | 6 · 6 |
| P4-S6 | L47 (opus) · L53 (sonnet) · L43 (opus) | bot + route connect web + `zalo-ingress` DB · docs vận hành · web | L45 merge (L47); L46 merge (L53); L42, L49 merge (L43; thêm L47 nếu step 0 thấy file của L47 và L43 giao nhau, §4) | 4 · 3 · 4 |
| P4-S7 | L54 (opus), một mình | deps, lockfile | 2026-12-01; xong trước 2026-12-14 | 4 |
| P4-S8 (có điều kiện) | L56 (opus) rồi L57 (opus), tuần tự | tiền + migration · luật tên + migration | Q2, Q3 khác default; L46 (L56); L42, L46, và L56 nếu chạy (L57) | 6 · 6 |

- Nhóm session, model writer và golden path: default applied, pending owner sign-off. Golden path local chạy bằng một verifier độc lập sau P4-S6, trên `main` cuối.

## 8. Việc chỉ owner làm (không xếp lịch cho agent)

Không lane nào làm hay phải chờ các bước dưới; agent chỉ bật projector trong test process hoặc scratch DB local (§2).

1. **Token bot Zalo thật.** Ai: owner CLB, hoặc admin có grant `connector.secret_manage` (`apps/web/app/api/onboarding/zalo/connect/route.ts:23`). Ở đâu: Settings của CLB, thẻ kết nối Zalo (`apps/web/components/settings/club-settings-view.tsx:115`). Bước: dán token bot (1-200 ký tự) rồi gửi; server kiểm token bằng `getMe` (`apps/web/app/api/onboarding/zalo/connect/route.ts:129`), mã hoá token, đăng ký webhook (`apps/web/app/api/onboarding/zalo/connect/route.ts:169`), trạng thái thành `registered` hoặc `error`; phản hồi không chứa token. Cần đặt `APP_BASE_URL` thành base URL mà Zalo gọi tới được: thiếu hoặc sai thì route trả 503 (`apps/web/app/api/onboarding/zalo/connect/route.ts:80`), production bắt buộc https (`apps/web/app/api/onboarding/zalo/connect/route.ts:35`); `.env.example:111` chỉ có giá trị local `http://localhost:3000`. Deliverer đã có (`apps/bot/src/projectors/zalo-dm.ts:155`, `apps/bot/src/projectors/zalo-dm.ts:190`): việc của owner là token thật + bật projector `zalo_dm` ở bước 2, không phải viết deliverer. Cách tạo bot phía Zalo: owner tự tạo bot trong Zalo Bot Manager dưới tài khoản Zalo của mình (free ≤3 bot), lấy Bot Token rồi dán vào thẻ (`docs/product/PRD.md:96`).
2. **Bật projector outbox và lịch**, đúng thứ tự `docs/runbooks/outbox-dispatch-enable-rollback.md`. Cờ lịch `OUTBOX_DISPATCH_SCHEDULE_ENABLED` đã true trong `.env.example` từ #94 (`.env.example:91`); ba projector được seed tắt (§2). Trước khi bật `public_sessions`: đóng dòng `job-infra-public-projection-reconciliation` bằng bằng chứng CHECK của 0024 (Phụ lục A), hoặc giữ `public_sessions` tắt. (a) Điều kiện (`docs/runbooks/outbox-dispatch-enable-rollback.md:22-31`): DB đã migrate (DB cũ: `pnpm db:bootstrap` bằng superuser trước 0054, rồi `pnpm --filter @plexco/db migrate`), `pnpm --filter @plexco/bot provision:queue` đã chạy, ba projector đều tắt. (b) Bật (`docs/runbooks/outbox-dispatch-enable-rollback.md:33-100`): chạy worker, đợi `SELECT outbox_dispatch_schedule_live()` trả t trong 30 giây, đợi số event `acked_at IS NULL` về 0, rồi bật TỪNG projector bằng CLI; không gọi thẳng `outbox_projector_set_enabled(<name>, true)`. (c) Rollback (`docs/runbooks/outbox-dispatch-enable-rollback.md:102-108`): tắt projector; delivery đang chờ được giữ, riêng `zalo_dm` dòng cũ hơn 60 phút lúc gửi thì không gửi.

```bash
OWNER_SQL='docker exec -i plexco-postgres-1 psql -U plexco -d plexco -v ON_ERROR_STOP=1'  # docs/runbooks/outbox-dispatch-enable-rollback.md:19
$OWNER_SQL -c "SET ROLE job_definer" -c "SELECT name, enabled FROM outbox_projectors ORDER BY name" -c "RESET ROLE"  # (a) all three off
pnpm --filter @plexco/bot start:worker  # (b) log shows the schedule registered and "outbox wake listening"
$OWNER_SQL -c "SET ROLE job_definer" -c "SELECT outbox_dispatch_schedule_live()" -c "RESET ROLE"  # (b) must be t within 30 s (runbook:41)
$OWNER_SQL -c "SELECT count(*) FROM outbox_events WHERE acked_at IS NULL"  # (b) wait until 0 (runbook:47)
read -rs PW && export DATABASE_URL_MIGRATION="postgres://plexco:${PW}@localhost:5432/plexco" && unset PW
node scripts/outbox-projector-enable.mjs enable --projector <web_realtime|zalo_dm|public_sessions>  # (b) one at a time
$OWNER_SQL -c "SET ROLE job_definer" -c "SELECT outbox_projector_set_enabled('web_realtime', false)" -c "RESET ROLE"  # (c) rollback
```

3. **Người dùng thật.** Repo không có quy trình (không tìm thấy). Điều kiện có trong file: bước 1, 2 và 4; theo default Q7, môi trường người dùng thật đầu tiên đặt `GENDER_COLLECTION_ENABLED=false` cho tới khi bước 4 có câu trả lời.
4. **Các điểm pháp lý** (skip list "legal"). Khớp nhất là 8 câu hỏi owner ở `docs/sessions/web-mvp-phase3-readiness-p3-flags-default-on.md:253`: cơ sở pháp lý để thu giới tính; retention và xoá khi đóng tài khoản; cam kết vendor, backup, giữ khoá; đầu mối bảo vệ dữ liệu; SLA xoá; nơi hosting; giới tính có là dữ liệu nhạy cảm không; trang privacy công khai hay luồng xem-và-thu-hồi đồng ý. Đây là suy luận: không file nào gọi danh sách đó là "tám điểm pháp lý". Không lane nào sửa docs/legal.
5. **PR #50 và deploy staging/prod** (DD-04): #50 mở, đóng băng, chỉ owner; owner tự quyết merge, đóng hay giữ. Runbook staging-deploy.md chưa có trên `main` (đi cùng #50).
6. **Skip list** (nguyên văn ở §2): legal, meta review, email vendor, setup DigitalOcean, secret, Google OAuth: chỉ owner, không lane nào.

## 9. Mốc có điều kiện

| Mốc | Trigger (nhị phân) | Việc | Nguồn |
| --- | --- | --- | --- |
| Xem lại `braces` | ngày 2026-12-01; hạn chót 2026-12-14 | L54 (P4-S7): có bản vá ⇒ bump, xoá ignore; chưa có ⇒ default Q6 | ignore hết hạn 2026-12-21 (`osv-scanner.toml:11`); `braces-ghsa-vfj7-ignore-expiry-2026-12-21` |
| D7 person equality | dòng backlog `chat-identity-merge-reparent-enablement` có `status: merged` trên `main` (hiện `planned`, `docs/autopilot-backlog.md:154`); dòng đó phải land cùng slice với writer merge Person, tức slice merge/claim của `feature-identity` (`docs/autopilot-backlog.md:836`, DD-103) | khi đó mới xếp `join-known-zero-person-equality-proof`; trước đó không xếp gì | DD-149 |
| Nửa bot thật của C3 | owner xong §8 bước 1 và 2 cho một CLB | owner chạy (hoặc giao chạy) ma trận lỗi với bot thật, dùng mẫu evidence của L47 | `zalo-outbound-error-mapping-real-bot-verification` |
| RUN doc Phase 4 | tin nhắn "Phase 4 plan approved" (B1) | ghi DD cho Q1-Q10, rồi viết RUN doc + lane prompt; đầu vào: luật ENABLEMENT đã sửa (Q8) thay câu cũ ở `docs/autopilot-templates/web-mvp-phase3-2026-10-16-RUN.md:73` (DD-141 đã thay), §3, §4, §7 của plan này, tail migration đo lại | DD-141 |

- Hai mốc đầu theo lựa chọn ngày 2026-10-24 (mục 5, 6), nhãn "accepted under the owner's delegation of 2026-10-24 (assistant review)" (DD-149).

## 10. Rủi ro

1. **Môi trường dùng chung:** một Postgres compose + một cổng e2e ⇒ một khoá; suite DB và e2e của 3 lane song song vẫn xếp hàng. Flake đã biết: rerun một lần, đỏ lần hai là thật.
2. **Dừng ngoài ý muốn** (file research §5, §6): ít nhất 16 lần usage limit, 2 lần mất đăng nhập, 1 lần mất mạng. Giảm: cron HEARTBEAT tự tiếp tục; khôi phục từ disk; agent quá khoảng 250k context thay bằng agent mới.
3. **Classifier AWAIT** (§6 của file research, lâu nhất 24 giờ 47): theo dòng "Rules" trong prompt Phase 4 của owner, classifier của owner chỉ cho phép sẵn các lần đảo test có chữ ký (signed test reversals); lệnh bị từ chối ⇒ file AWAIT với lệnh chính xác, không lách. Lane dọn test (L55) và lane luật tên (L41, L57) dễ chạm loại này. Giảm, không cần input của owner: prompt của mỗi lane liệt kê trước lệnh chính xác mà owner có thể phải chạy; lane tránh các loại lệnh đã bị từ chối ở Phase 3 (bốn sự kiện ở §6 của file research); một AWAIT chỉ dừng lane đó và lane phụ thuộc nó.
4. **Lỗi chỉ có trên CI** (ghi chú build C11, C12 của chương trình; dòng `p3-s16-lessons-c10-c12-tracked-home`): test CPU lặp mọi scalar Unicode chạy chậm hơn nhiều trên CI (dòng `ci-every-scalar-test-duration-watch`) ⇒ giữ mỗi test ngắn ở local, tách theo vị trí, budget 30_000 tường minh; Semgrep chặn `new RegExp(variable)`. Áp cho L41, L42, L57.
5. **Script mới dưới scripts/** (ghi chú C10) cần bản ghi trong `docs/standards/kit-pack-membership.json`, nếu không `pnpm -w test` đỏ ở `kit:check`; L45 chỉ sửa script có sẵn.
6. **Thứ tự migration:** 0072, 0073 chắc chắn + hai số có điều kiện; append-only, số đo lại tại base của từng lane; lane merge lệch thứ tự đổi số tại base của nó.
7. **Mặt public (L39) và tiền (L49, L56):** trang share chỉ có trường whitelist (HARD RULE 2), test DTO; lệnh tiền dedupe bằng `commandId`; security round.
8. **Size là ước đoán** (không dòng backlog nào có ước lượng): step 0 đo lại; vượt B3 ⇒ ghi ngoại lệ ở step 0 hoặc tách lane.
9. **Review không Codex** (DD-122 D4): reviewer Claude độc lập tối đa 3 vòng; fix sau vòng cuối ghi rõ là không review lại.

## 11. Readiness verdict (canonical)

Closure matrix (gate §8, 12 hàng; chưa đạt vì Q1-Q10 còn mở):

| # | Gate | Bằng chứng | Kết quả |
| --- | --- | --- | --- |
| 1 | Pin authority theo SHA | `7b31d1fe0f5e25c08d554cb191032596204fe2ed` + TARGET_FILES chính xác | PASS |
| 2 | Quyết định trong scope đã chốt | Q1-Q10 còn mở (§5) | FAIL |
| 3 | Scope IN/OUT và owner rõ | §2, §3, §8 | PASS |
| 4 | Dependency phân loại đủ | §3, §4 (19 lane, 6 sóng) | PASS |
| 5 | Live schema/code khớp doc | §2 đo tại baseline; mỗi lane đo lại ở step 0 | PASS |
| 6 | Contract data/API/state/auth đủ | §3 chỉ có phạm vi và test; contract chi tiết ở RUN doc và step 0 | PARTIAL |
| 7 | Fail-closed/idempotency/order | test fail-closed ở §3 (L39, L40, L48, L49); decision table ở step 0 | PARTIAL |
| 8 | Open question trong scope = 0 | còn 10 (Q1-Q10) | FAIL |
| 9 | Acceptance matrix có expected result | cột test nghiệm thu ở §3; lệnh nghiệm thu chỉ có ở RUN doc (viết sau B1) | FAIL |
| 10 | Migration/security/rollback pin | §3: 0072 → 0073 → 0074/0075, số đo lại tại base lane; security round ở §7 | PARTIAL |
| 11 | First slice có hard dependency merged | L55, L39, L51 không phụ thuộc lane nào; chỉ chờ B1 | PASS |
| 12 | Implementation handoff sẵn sàng | không authorize worktree; RUN doc viết sau B1 | FAIL |

```text
REVIEW_POLICY_VERSION: 1.3
REVIEW_VERDICT: NOT_PLAN_READY
REVIEWED_AT: 2026-10-25
AUTHORITY_SHA: 7b31d1fe0f5e25c08d554cb191032596204fe2ed
BASE_BRANCH: main
TARGET_FILES:
  - docs/sessions/web-mvp-phase4-plan.md
  - docs/research/web-mvp-phase3-lane-timing-measurements-2026-10-25.md
SLICE: web-mvp-phase4-plan
IN_SCOPE: docs-only plan for Web MVP Phase 4, local-only: 17 lanes (L39-L55) plus 2 conditional lanes (L56, L57), 8 session rows, 10 owner questions (Q1-Q10), the wall-clock estimate, owner-only steps, conditional milestones
OUT_OF_SCOPE: code, tests, migrations, the Phase 4 RUN doc and lane prompts, new DD entries, edits of decisions.md, Reviewed specs or docs/legal, PR #50, DigitalOcean, a real Zalo token, real users, bank/QR/payment, billing, every owner-only step
G1_DECISION: FAIL
G2_SPEC: PARTIAL
G3_DEPENDENCY: PASS
G4_TEST: PARTIAL
G5_SCOPE: PASS
G6_EXTERNAL: ENABLEMENT_ONLY:zalo_bot_token_real,outbox_projector_enable,real_user_messaging
HARD_DEPENDENCIES: none for plan authorization; owner approval and Q1-Q10 are the blockers below
PRIOR_SLICES: Web MVP Phase 3 (PRs #58 to #113) merged at AUTHORITY_SHA; PR #50 frozen owner-only
OPEN_QUESTIONS_IN_SCOPE: 10
ENABLEMENT_ONLY_GATES: zalo_bot_token_real, outbox_projector_enable, real_user_messaging
LIVE_REPO_VERIFICATION: PASS
CONTRACT_MATRIX: PARTIAL
CLOSURE_MATRIX: PARTIAL
ACCEPTANCE_MATRIX: FAIL
SECURITY_AND_MIGRATION_GATE: PARTIAL
IMPLEMENTATION_ARTIFACTS: NOT_REQUIRED_FOR_PLAN_READY
FIRST_IMPLEMENTATION_STEP: BLOCKED until B1 resolves; then P4-S1 step 0 (per-lane readiness for L55, L39, L51)
REMAINING_BLOCKERS:
  - blocker: B1 owner approval of this plan
    owner: Ngoc-Anh
    resolution: the owner writes "Phase 4 plan approved" with an answer or an override for each of Q1-Q10 (Q2 and Q3 also decide whether L56 and L57 run; this message also allows the merge of this PR; a merge alone signs nothing)
    next_review_trigger: the owner's written message "Phase 4 plan approved" and a main that contains this PR
  - blocker: B2 the answers to Q1-Q10 are not yet recorded as DD entries
    owner: Ngoc-Anh
    resolution: after B1, the first Phase 4 docs step records each answer as a DD entry in docs/standards/decisions.md on main
    next_review_trigger: decisions.md on origin/main carries a DD entry for each answer to Q1-Q10
NEXT_REVIEW_TRIGGER: the owner's written message "Phase 4 plan approved" with answers to Q1-Q10 and a main that contains this PR; then P4-S1 step 0 writes the per-lane CODE_READY or NOT_CODE_READY verdicts
```

## Phụ lục A. Dòng backlog đã xét nhưng không đưa vào Phase 4

Mỗi dòng: slug + lý do. Dòng đã có lane ở §3 (kể cả lane có điều kiện) không nằm ở đây. Tổng 114 dòng: 55 dòng riêng + 2 nhóm (43 + 16).

- `host-pro-late-invoice-retention-period-decision`: quyết định của owner, không code (Q1).
- `billing-late-host-pro-invoice-downgrade-to-free`: chờ epic billing; billing ngoài MVP (Q1, DD-132).
- `join-known-zero-person-equality-proof`: chờ identity-merge writer (DD-149); mốc ở §9.
- `membership-display-name-follows-person-rename`: dòng quyết định (tên trong CLB có đổi theo khi người đổi tên không), chưa có default; để owner quyết sau.
- `channel-inbound-events-retention-reclaimer`: owner chưa chọn mô hình reclaimer (dòng ghi NOT_CODE_READY).
- `routing-audit-retention`: owner đã quyết MVP không có job retention (DD-131).
- `core-matcher-ambiguous-consumer-wiring`: MVP không có luồng host bằng ngôn ngữ tự nhiên.
- `job-scheduler-cron-registration`: chỉ cần khi có job của DD-142; Phase 4 không có (Q1).
- `job-consumers-per-feature`: ô dù cho các job chưa scope (hết hạn, billing, nhắc).
- `dd18-embedding-candidate-active-multiprofile`: bot trợ lý không có trong MVP.
- `dd18-profile-activation-cas-boundary`: bot trợ lý không có trong MVP.
- `dd18-embedding-provider-profile-equality`: bot trợ lý không có trong MVP.
- `dd104-delete-session-ratification`: xoá cứng session vẫn là đề xuất; MVP huỷ thay vì xoá.
- `reminder-cron-and-confirm-paid`: owner đã quyết không nhắc tự động.
- `reminder-preferences-m7`: owner đã quyết không nhắc tự động; không có reader.
- `auth-provider-google-email-swap`: Google OAuth (skip list).
- `infra-do-app-vpc-deployment`: DigitalOcean (skip list).
- `backup-pitr-drill`: cần deploy DigitalOcean.
- `request-id-log-context-auth-onboarding`: cần file chỉ có trong PR #50 đóng băng.
- `db-tls-ca-verification-do-managed-pg`: Postgres managed của DigitalOcean (thuộc PR #50).
- `staging-ttl-teardown-automation`: staging (thuộc PR #50).
- `chat-identity-merge-reparent-enablement`: phải land cùng slice với writer merge Person của `feature-identity` (DD-103, `docs/autopilot-backlog.md:836`), writer đó chưa có; dòng này merged là trigger D7 ở §9.
- `feature-identity`: chính là tính năng identity (P0, làm tay).
- `feature-cross-club-join`: chạy sau `feature-identity`.
- `feature-billing-lifecycle`: billing ngoài MVP (DD-132).
- `apipay-signed-body-reconciliation`: không tích hợp ngân hàng; còn cần bằng chứng của owner.
- `infra-egress-compatibility-evidence`: bằng chứng egress chỉ owner có.
- `email-provider-c7-evidence`: thẩm định nhà cung cấp email (vendor).
- `email-password-bundle-order-4`: cần bằng chứng của dòng nhà cung cấp email ở trên.
- `docs-impact-policy-contract`: số phận tiền khi host đổi giá hay sức chứa là quyết định của owner.
- `capacity-floor-active-vs-paid-roster`: luật tiền còn mở, owner quyết.
- `audit-2026-09-06-d3-ledger-free-columns-no-allocation-constraint`: DDL của sổ tiền là Tier C.
- `audit-2026-09-06-d6-outbox-no-attempt-bound`: bound lần thử của outbox là Tier C của owner; phần DLQ đã merge.
- `identity-link-hardening-consumer-column`: cần quyết định schema của owner.
- `docs-core-classifier-decision-table-lift`: bảng lịch sử, đã deferred.
- `job-infra-public-projection-reconciliation`: khoảng hở của dòng (writer bypass đổi `slots_max` của session public đã chiếu sang NULL, `docs/autopilot-backlog.md:1584`) đã bị CHECK `sessions_public_capacity_chk` chặn tại nguồn (`packages/db/migrations/0024_public_visibility_capacity_check.sql:117`, VALIDATE ở `:123`; đúng ứng viên (c) của dòng). Dòng vẫn mở và ghi projector "must not be ENABLED while this gap is open" ⇒ đóng dòng bằng bằng chứng này trước bước bật `public_sessions` (§8 bước 2), hoặc giữ projector đó tắt.
- `docs-chat-spec-embed-group-scope-reconcile`: docs chat (embed, pin, poll) ngoài phần chat đã xây.
- `db-app-worker-least-privilege-attestation`: test catalog, giá trị thấp lúc này.
- `chat-dm-safety-audit-queryable-path`: kho forensics cho DM safety; hoãn.
- `run-packet-l1-contradicts-dd56`: RUN packet cũ, không còn dùng.
- `observability-sentry-loglevel-readers`: Sentry DSN là việc của vendor và owner.
- `audit-2026-09-06-d4-tenant-admins-full-dml-no-audit`: P3, cần migration; để sau.
- `audit-2026-09-06-d14-lock-order-publish-vs-update`: deadlock hiếm, P3.
- `audit-2026-09-06-b2-required-projectors-drift-across-replicas`: chỉ có nghĩa khi chạy nhiều replica.
- `zalo-connect-inflight-lease`: race hiếm; owner connect một lần.
- `m2c-round3-nits-follow-up`: nit của PR #46; dòng ghi không cần vòng sửa.
- `next-config-route-header-precedence-claim`: chỉ sai dưới next dev; cờ CSP nonce mặc định false.
- `dockerignore-env-nested-files`: sửa nhỏ, giá trị thấp lúc này.
- `dev-login-residuals-pr-56`: phần còn lại của PR #56, P3.
- `small-code-hygiene-reversal-zalo-roster-comment`: ba nit P3.
- `offline-page-csp-nonce-missing`: chỉ xảy ra khi bật cờ CSP nonce (mặc định false).
- `session-venue-address-error-field-contract`: nit UX, P3.
- `local-smoke-toast-overlap-and-blank-band-measure`: polish UI cần đo trước, P3.
- `api-contract-test-dto-key-pins-assert-fixtures-not-the-type`: vệ sinh test, giá trị thấp.
- `ci-every-scalar-test-duration-watch`: mục theo dõi CI; hướng dẫn đã có.
- 43 dòng kit và tooling Level 3 (Codex, scope-gate, ap-finish, manifest), ngoài chương trình Web MVP vì DD-122 D4 bỏ Codex và scope-gate cho chương trình này: `classifier-blocks-kit-mandated-readiness-json`, `codex-review-verdict-nondeterminism`, `reconcile-hand-closed-entries-never-age-out`, `local-dev-sanctioned-paths-are-harder-than-the-forbidden-one`, `gates-that-fire-correctly-and-cannot-say-why`, `docs-feature-index-version-freshness-check`, `infra-autopilot-templates-mirror-v061`, `breaker-counts-infra-flakes-as-fix-rounds`, `ap-merge-test-and-clean-tree-scope`, `ap-finish-squash-verify-defeated-by-closeout-order`, `precondition-halt-and-hashlock-force-full-rebuild`, `launcher-register-path-authored-to-runtime`, `codex-review-pin-worktree-isolation-defect`, `backlog-status-taxonomy-inflight-manual-close-gap`, `ap-finish-untracked-counts-as-dirty`, `scope-gate-plants-terminal-signals-on-retryable-register`, `kit-init-pack-parity`, `manifest-claims-never-rechecked`, `two-manifests-nothing-checks-they-agree`, `manifest-verification-smoke-run-before-lock`, `hash-lock-cost-evidence`, `no-preflight-authority-gate`, `no-registry-answers-is-this-landed`, `kit-owned-commit-guard`, `kit-pack-membership-ci-range-check`, `rules-file-claims-a-hook-that-never-runs`, `require-string-rejects-angle-brackets`, `kit-pack-membership-unsynced-candidates-third-state`, `reconcile-refusal-reason-does-not-match-row-data`, `hash-locked-registration-has-no-path-for-authorised-change`, `negative-scope-must-not-carry-decision-rules`, `security-review-reason-validated-but-never-transmitted`, `ap-finish-slug-divergence-after-worktree-move`, `worktree-identity-symlink-defense`, `manifest-template-omits-format-check`, `authored-contracts-carry-no-immutable-base-sha`, `gates-that-fire-correctly-split-remainder-unowned`, `audit-2026-09-06-x7-reconcile-regex-positional-and-ap-finish-dot-slug`, `canonical-scope-gate-pathname-decoding`, `canonical-generic-base-freshness-wording`, `canonical-terminal-signal-exclusive-create`, `canonical-live-scope-guidance-reconcile`, `p3-s16-lessons-c10-c12-tracked-home`.
- 16 dòng mà code đã có trên main nhưng status còn cũ (việc dọn backlog, không phải lane): `feature-marketplace-discovery`, `web-app-shell`, `tenant-capability-authority-core`, `chat-shared-message-command-core`, `job-outbox-dispatch-sync-lag-slo`, `db-zalo-bots-secret-hardening`, `dd56-amendment-3-session-read-routes-authoring`, `session-read-routes-list-detail`, `session-roster-first-writer`, `session-mark-paid-manual`, `onboarding-club-config-route`, `user-settings-route-and-schema`, `zalo-webhook-adapter-core`, `web-pwa-manifest-and-service-worker`, `web-realtime-sse`, `projector-real-replace-stub`.

Không phải dòng backlog: quan sát kết quả probe lộ mạng của dev-login theo từng địa chỉ (gợi ý của conductor) không có dòng nào trong backlog; plan không lập lane, owner muốn thì thêm một dòng idea.
