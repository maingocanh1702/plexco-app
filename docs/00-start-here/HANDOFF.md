# HANDOFF — Plexco

> **Đọc file này ĐẦU TIÊN khi tiếp quản project.** Self-contained: không cần context phiên trước.
> Cập nhật: 2026-09-15 (**re-pin `main@e235ea4` + đợt cập nhật docs v3.17/v3.10/v2.9/v3.2** — khối 🟦 ngay dưới) · 2026-09-09 (**§5b làn ap3, DD-120 🟡** — xem §5b) · 2026-09-06 (**audit code ↔ docs** — khối 🟥 ngay dưới; ROADMAP **v3.16** · BRD v3.9r · PRD v2.8r · decisions v2.48 OPEN NOTE DD-114 D6) · đợt trước 2026-09-04: **ROADMAP v3.15** · decisions **DD-56 amendment #2** — xem khối 🟣 ngay dưới; dòng lịch sử bên dưới giữ nguyên) · *nguyên bản 2026-07-28: (BRD v3.9n · PRD v2.8m · TDD v3.1h · **ROADMAP v3.4l** · decisions v2.11 current mirror; HEAD `main@ed38106` = `origin/main` — authority snapshot vẫn pin ở `784bc8d`, hai commit sau chỉ là autopilot docs/kit v11, không đụng authority · migration · runtime). Migrations `0000`–**`0024`** (25 file): auth `0015`–`0018`, tenant-integrity DD-68 `0019`–`0021`, job-infra `0022`–`0023`, capacity-visibility CHECK `0024`. Google auth lane đã merge; Safari macOS+iOS M3 **đã đo PASS 26/07**, nhưng Google login **chưa được chứng minh đã enable/go-live** — set credential vẫn là owner go-live decision và các gate khác (vd A3 legal/PII) đứng độc lập. DD-87 `splitNameAmount` core đã merge (`d2a27e1`) nhưng vẫn **không có production caller**. Tầng feature nghiệp vụ vẫn **0 Chat/Assistant/notification route, 0 màn FE**. **DD-32 Option D, DD-70/71/72 và DD-86/DD-91–95 đã owner-final; DD-88 chỉ là broader `DEFERRED_PROPOSAL`.** Channel Booking, In-app Chat v0.15/v0.23, Notifications v3.11/v3.11 và Club Assistant v0.18/v0.18 có Reviewed target contract. Exact 27-file Chat authority pack đã land tại `90d292d`; primary plan v1.8 đạt `PLAN_READY` closure 12/12, nhưng B4/worktree chưa author và từng slice `1–47` / `A1–A21` / `F0–F15` vẫn phải đạt strict `CODE_READY`. `PLAN_READY` không chứng minh runtime.
>
> 🟦 **LIVE TRUTH 2026-09-15 (v1.42) — `main` = `origin/main` = `e235ea4`. ĐÂY LÀ KHỐI MỚI NHẤT về MỌI mặt (docs, số đo, runtime); mọi khối dưới là lịch sử.**
> **Việc lớn nhất: BUNDLE AUDIT ĐÃ MERGE.** Mọi câu "CHƯA merge" trong khối 🟥 06/09 dưới đây **đã hết đúng** — A1–A8 · B1–B5 · C1–C5 nay nằm trên `main`, kèm `0037`–`0043`. **Migration tail `0043` → `0044`**, tổng **45 file**, `MIGRATION_COUNT` **45**.
> **Slice sản phẩm mới (làn ap3, M3/M3b):** `0044` `session_guest_notes` (+ `sessions.allow_player_invite`, `players.invited_by_person_id`, trigger trần 3 note/session, RLS + FK cross-tenant) và hai lệnh `CreateGuestNote`/`DeleteGuestNote` ⇒ **8 command** trong `packages/db/src/session-service.ts` và **7 route nghiệp vụ** (`POST /[id]/guest-notes`, `DELETE /[id]/guest-notes/[noteId]`). Rate limit của guest-note là **per (actor, session)**, không per tenant — bucket dựng ở chính route, trước khi vào choke-point.
> **✅ GATE CHẠY LẠI TẠI `e235ea4` (15/09, Mac, `git worktree` tách rời, `NODE_ENV=test`, Postgres `docker plexco-postgres-1`): TẤT CẢ XANH.** `pnpm -w test` **exit 0** — **1490 workspace** (core **163**/11 file · db **800**/15 · web **468**/24 · bot **59**/4) **+ 128 readiness/kit** (`# pass 128 · # fail 0`); `pnpm typecheck` **4/4 Done**; `eslint .` **sạch**; `next build` **OK** (route table sinh đủ 15 API route + `/healthz`); `git status --porcelain --untracked-files=all` **rỗng** sau khi chạy trọn suite. ⚠️ **1490 và 128 là HAI THANG ĐO**, cấm cộng im lặng.
> **⚠️ BẪY MÔI TRƯỜNG MỚI, ghi làm tiền lệ:** lần chạy đầu ĐỎ ở `packages/db/src/tenant.test.ts` với `role "plexco_migrate_cleanup_fail_scratch" does not exist` — **không phải lỗi code**, mà là **14 database `plexco_*` per-test sót trong cluster** từ lần chạy trước. Dọn bằng `docker exec plexco-postgres-1 psql -U plexco -d postgres -c 'DROP DATABASE IF EXISTS <db> WITH (FORCE);'` cho tới khi chỉ còn `plexco` + `plexco_test`, rồi chạy lại ⇒ xanh. **Dọn cluster TRƯỚC khi đo, nếu không sẽ khai một drift không tồn tại.**
> **🔴 MỘT DECISION CÒN THIẾU — đo được, owner quyết, đừng tự vá:** hai route guest-note đi qua **đúng choke-point tạm** `apps/web/lib/session-command-route.ts` (`handleSessionCommand`), trong khi **DD-56 amendment #2 pin "cổng tạm phủ NĂM route"** và liệt kê đủ năm tên; điều khoản 1 của amendment #1 ghi *"KHÔNG route nào khác được copy pattern này mà không có decision riêng của chính nó"*. Cổng tạm nay phủ **BẢY**. Đã ghi OPEN NOTE dưới DD-56 trong `../standards/decisions.md`; cần một dòng ✅ của owner (hoặc amendment ký tên hai route đó).
> **Đợt cập nhật docs 15/09 (chính phiên này):** `../product/ROADMAP.md` **v3.16 → v3.17** (dựng **§📍 Tiến độ thực tế** + **§📜 Nhật ký cập nhật**, re-pin toàn bộ số) · `../product/BRD.md` **v3.9r → v3.10** · `../product/PRD.md` **v2.8r → v2.9** (Changelog dời xuống cuối) · `../product/TDD.md` **3.1l → 3.2** (bảng 13 lớp thiết kế-vs-as-built) · 17 FE spec + BE spec liên quan re-pin as-built. ⚠️ **Phát hiện khi làm:** khối §📍 mà phiên 08/09 dựng cho BRD/PRD/TDD/ROADMAP **chưa bao giờ được commit** (đo 15/09: `grep -c '📍'` = 0 ở cả bốn file) trong khi 17 FE spec **đã** trỏ tới `BRD v3.10 · PRD v2.9 · TDD v3.2 · ROADMAP v3.17` từ `b37e464` ⇒ pointer treo suốt một tuần. Pass này dựng lại đúng bốn version đó nên pointer khớp lại.
> **Làn ap3:** kit đã lên **W5.2.1**; feature `session-management` qua intake → plan → M3/M3b; 4 branch `ap3/*` còn mở trong repo. DD-120 vẫn **🟡 chưa ratify**.
> **KHÔNG ĐỔI:** **0 màn FE** · **FE PENDING (DD-116)**, carve-out **DD-119 vẫn 🟡 chưa ratify** · `OUTBOX_DISPATCH_SCHEDULE_ENABLED` **OFF** và projector vẫn `productionStubDeliver` · `resolveCapability()` **0 caller production** (hard-dep (a) của phase-1 còn mở) · Chat có DB root và **0 service** · thanh **~33%** · canonical P-number · dependency order.
> **Chờ owner (Tier C, mỗi mục một dòng ✅):** C1 roster writer · C2 ngôn ngữ per-user · C3 launch self-serve hay provision tay (OPEN NOTE DD-114 D6) · C4 `GOOGLE_OAUTH_*` · C5 A3 luật sư · C6 outbox attempt bound · posture grant `0043` · `DB_EXPECTED_ROLE` bắt buộc hay không · **DD-56 amendment #3** (route ĐỌC session, draft) · **OPEN NOTE DD-56 guest-note** ở trên.
>
> 🟥 **LIVE TRUTH 2026-09-06 (v1.41) — `main` = `origin/main` = `30a3e90` (hai commit docs sau `0aff7ad`; số đo khối 🟣 04/09 vẫn đúng cho `main`). ĐÂY LÀ KHỐI MỚI NHẤT về *độ đúng của docs và hàng đợi sửa*; khối 🟣 04/09 dưới vẫn là authority về *số đo runtime/test*.**
> **Audit code ↔ requirement (BRD/PRD/feature docs) + rủi ro bảo mật:** `../sessions/2026-09-06-repo-audit.md` (derived, non-authority) · **hàng đợi sửa A1→A9 + danh sách Tier C:** `../autopilot-templates/audit-fix-lanes-2026-09-06-RUN.md`. Kết luận: **0 P0/P1**; 6 P2 (D-1 `app` UPDATE `subscriptions` · D-2 `tenant_provision` vỡ dưới RLS · W-1 Telegram còn nguyên · W-5 readiness không bao giờ `ready` · B-1 dispatcher grammar · X-1 CI so `refs/heads/main`); 4 hardening (W-2/W-3/X-2/X-4); 32 P3; 16 docs lệch code; 17 requirement không code + không row.
> **Đã làm trong phiên cloud 06/09 (owner không vào được máy local):** A1–A7 **author trên 7 branch `fix/a*`, CHƯA merge** — verify bằng psql replay 37 migration (super + NOBYPASSRLS owner), tsx harness, `docker compose config`; **vitest/tsc/eslint/next build CHƯA chạy** (npm registry bị chặn egress trong container) ⇒ owner chạy `pnpm -w test` + codex round trên máy có Postgres trước khi merge. Thứ tự merge: A1 · A2 → A4 → A7 · A3 → A6 · A5 (A8 = commit docs này; A9 chưa bắt đầu). **A8 (docs, commit này):** 16 drift đóng (ROADMAP v3.16 · BRD v3.9r · PRD v2.8r · session_mgmt_tech v2.26 · notifications_tech v3.13 · web_auth_tech v2.16 · user_settings_tech v0.19 · OPEN NOTE DD-114 D6), chữ "PWA"→"web app" theo DD-113, row `session-commands-update-close-cancel` → `superseded`, **+53 row backlog** (7 `in-flight` A1–A7 có `merged_probe` thật · 1 authoring A9 · 14 gap §4 · 29 P3 `audit-2026-09-06-*` (D-10 đã có row, X-4 gộp A7, X-6 vào A1) · `web-csp-script-src-nonce` · `db-channel-identities-platform-chk-drop-telegram`), reconcile read-only: REFUSED 4→3 (row superseded rời tập quét), MALFORMED 0, WEAK 1 (cũ), `?` 17→62 (đúng: việc chưa build không có probe).
> **Đợt 2 cùng ngày (owner: "fix nốt hết") — 5 branch B1–B5 chồng lên integration, CHƯA merge:** **B1** `fix/b1-dd56-amendment-3` = A9 (draft amendment #3 + manifest, chờ ký) · **B2** `fix/b2-db-hardening` = `0039` (D-7/D-8/D-9/D-12/W-8-db) + catalog RLS test + runner ordering guard (D-11) + **sửa `MIGRATION_COUNT` 37→40 mà A2/A4 bỏ sót** · **B3** `fix/b3-web-hardening` = W-4/W-6/W-7/W-8/W-9/W-10/W-11/W-13/W-14 + CSP nonce sau flag `CSP_SCRIPT_NONCE_ENABLED` (OFF) + `lib/log.ts` + `middleware.ts` (discovery chỉ /healthz,/discover*) · **B4** `fix/b4-bot-core-service` = B-3/B-4/C-1/C-2/C-3/D-5/D-13(docs)/D-15 + harness leak + Dockerfile HEALTHCHECK; D-14 chỉ ghi chú; X-7 là kit-sync ⇒ canonical · **B5** = flip 24 row `in-flight` có probe thật. Integration `fix/audit-2026-09-06` = main + A1–A8 + B1–B5. Vẫn CHƯA chạy vitest/tsc/eslint/next build.
> **Đợt 3 (06–07/09, owner: "làm luôn hết" rồi "còn bug nào nữa không") — 5 branch C1–C5 chồng lên B, CHƯA merge:** **C1** `fix/c1-session-idle-ttl` = `0040` `web_sessions.last_seen_at` + idle window trong CẢ `auth_resolve_web_session` LẪN `auth_rotate_web_session` (cả hai overload cũ DROP), touch throttle 1 phút · **C2** `fix/c2-worker-heartbeat` = `0041` `job_worker_heartbeats` (job_definer-owned, 0 grant, tự prune 30 ngày) + 2 definer EXECUTE `app_worker` + `apps/bot/src/heartbeat.ts` (tick 30s, overlap guard, `SET LOCAL statement_timeout`) + HEALTHCHECK worker đo tuổi file ≤ 90s · **C3** `fix/c3-telegram-db-tail` = `0042` DROP `auth_login_telegram` + **trigger** chặn mọi row TẠO hoặc TRỞ THÀNH `telegram` + factory `seedPersonAccount` thay 54 call site · **C4** `fix/c4-identity-link-code` = `0043` `link_code_issue`/`link_code_salt`/`link_code_consume` + `_link_code_retention` (spec identity §4, EXECUTE `app` only; KHÔNG merge plan, KHÔNG endpoint-scope, KHÔNG route) + `packages/db/src/identity.ts` (code 18 ký tự Crockford **tách đôi**: 8 ký tự lookup, verifier scrypt phủ toàn bộ; scrypt async) + 20 vitest · **C5** = flip 4 row + HANDOFF này.
> **7 bug của chính đợt 3 đã tự soi ra và sửa (07/09, review đối kháng + đo bằng psql), tất cả nằm trong code CHƯA merge nên các nhánh được viết lại tại chỗ:** (1) `rls-invariants.test.ts` pin cứng 6 hàm `job_definer`, `0041` thêm 2 ⇒ `pnpm -w test` ĐỎ — đúng lỗi kiểu A2/A4 quên `MIGRATION_COUNT`, lần này ở danh sách hàm; (2) idle TTL chỉ vá `resolve`, `rotate` vẫn hồi sinh cookie im 20 ngày thành session 30 ngày mới (đo: resolve→0 row, rotate→mint, resolve token mới→1 row) — `issueSession` đưa cookie thô thẳng cho rotate; (3) `failed_attempts`/`locked_until`/`max_attempts` của link_code là **code chết** vì lookup hash và verifier cùng derive từ nguyên mã ⇒ trúng lookup là trúng verifier, `wrong_code` không bao giờ xảy ra và tầng DB không bound việc đoán mã — sửa bằng cách tách mã; (4) `scryptSync` chặn event loop 70–160 ms mỗi lần consume kể cả mã không tồn tại ⇒ đổi async; (5) `NOT VALID` KHÔNG khoan dung mà **đóng băng** row telegram cũ (mọi UPDATE 23514, kể cả no-op và re-parent khi merge; chỉ DELETE lọt) ⇒ đổi sang trigger; (6) heartbeat không overlap-guard và không timeout ⇒ DB treo query làm 12 tick chồng nhau ăn hết pool của chính dispatcher và làm shutdown exit 1; (7) `stop()` không chặn tick đang bay ghi file health. Kèm 2 việc nhỏ theo tiền lệ 0016/DD-80: `_link_code_retention` 30 ngày và tự prune `job_worker_heartbeats`. Migration tail **`0043`** (44 file), `MIGRATION_COUNT` 44. Verify cloud: psql replay super + NOBYPASSRLS cho từng migration, script hành vi theo role (super/nb ra output byte-identical), barrier lock (`pg_blocking_pids`, 3 consume đồng thời → đúng 1 `consumed`, 30 vòng consume chéo 0 deadlock), wrapper TS chạy end-to-end qua shim psql, esbuild syntax; **vitest/tsc/eslint/next build vẫn CHƯA** ⇒ owner `pnpm -w test` trước khi merge. Thứ tự merge sau B: C1 → C2 → C3 → C4 → C5. Bundle v5 tại `_to_delete/`.
> **✅ 07/09 — LẦN ĐẦU CHẠY THẬT `pnpm -w test` + typecheck + lint + `next build` (trên Mac, worktree riêng, `NODE_ENV=test`): TẤT CẢ XANH.** Lần chạy đầu: `@plexco/core` 162 · `@plexco/db` 762 · `apps/web` 423 · `apps/bot` 57 (**1404 test**). **Số chốt sau 5 vòng codex (bên dưới): `@plexco/core` 162/162 · `@plexco/db` 764/764 · `apps/web` 426/426 · `apps/bot` 59/59 = 1411 test, 51 file** · `pnpm typecheck` 4/4 project Done · `eslint .` sạch · `next build` compile + sinh route table thành công. Cloud không chạy được vì npm registry bị chặn egress (403, KHÔNG route around); Mac có `node_modules` nên chạy native ở đó.
> **Lần chạy thật đó phát hiện thêm 6 defect mà psql/esbuild/harness KHÔNG thể bắt — đã sửa trong đúng lane sinh ra (nhánh viết lại tại chỗ vì owner chưa fetch):** (a) **A2/B2** test `0037`/`0039` seed dữ liệu qua `ctx.superuser` — connection trỏ vào database BASE chứ không phải database per-test — nên `tenant_provision` chết ở `memberships_person_id_fkey`, và assertion `proconfig` của 0039 "pass" nhờ soi nhầm database; nay mở connection superuser tới `ctx.dbName`; (b) **B2** `0039` FK `charges_tenant_session_player_fk` (D-12) làm fixture của `XC-DRAFT-ANOMALY-CHARGE-ONLY` trở thành BẤT KHẢ BIỂU DIỄN — test nay assert đúng điều đó (thành regression guard cho D-12), nhánh `['charges']` trong `cancelSession` còn lại là defense-in-depth; (c) **B4** `ensureTenantContext` (D-15) ĐỌC trước khi SET nên tốn 2 câu lệnh thay vì 1 — mọi fake `tx` trong `capability.test.ts` lệch một nhịp và chết ở "malformed subscriptions row"; (d) **B4** test "resolver đọc tenant của chính nó dù GUC tenant khác đã set" là hợp đồng TRƯỚC D-15 — nay assert `TenantContextMismatchError` (fail closed, không im lặng re-scope); (e) **A5** test "DOES register khi bật flag" là hợp đồng TRƯỚC X-3 — nay assert worker TỪ CHỐI đăng ký khi deliverer vẫn là `productionStubDeliver`, và sẽ lật lại khi projector thật land; (f) **B3** route `app/api/auth/google/state/route.ts` export `isTopLevelNavigation` — App Router chỉ cho export HTTP verb + một tập config cố định, nên **`next build` fail toàn bộ build**; hàm chuyển sang `lib/request-policy.ts`. **Chỉ `next build` bắt được (f); vitest và tsc đều không.**
> **✅ 07/09 — REVIEW ĐỘC LẬP ĐÃ ĐÓNG: 5 vòng `scripts/codex-review-pin.sh` trên `--base 30a3e90`, vòng 5 `REVIEW_VERDICT: CLEAN`.** Bước 4 của Level 3 workflow (review độc lập bắt buộc; toàn bộ A+B+C chạm auth/secret/permission/tiền/external input/deployment) trước đây là món DUY NHẤT còn nợ trong gate — nay đã trả. **10 finding qua 4 vòng đầu, tất cả đã sửa và được vòng sau xác nhận, nhánh viết lại tại chỗ vì owner chưa fetch:** **R1** (4) — (1) **B3** `appDb()` gọi `void assertRuntimeDbRole(...)` là fire-and-forget: query đầu tiên có thể chạy TRƯỚC khi role được xác minh ⇒ thêm `gateHandleOnRoleAssert()` chặn `pool.query`/`pool.connect` tới khi assert xong, và từ chối truy cập pool kiểu callback khi cổng còn cài; (2) **A7** `entrypoint.sh` không đối chiếu `DB_EXPECTED_ROLE` với role mà process group thực sự cần ⇒ thêm bảng `web→app` / `discovery→readonly` + REFUSE khi lệch; (3) **C2** `heartbeatFresh` lệch với shell trong Dockerfile ở ca file tương lai ⇒ khớp lại đúng từng ký tự; (4) **C1** `auth_resolve_web_session` đọc-rồi-khoá nhưng KHÔNG kiểm lại dưới khoá ⇒ một `revoke` commit trong lúc chờ khoá vẫn trả session (đo: trước = 1 row; sau = chờ 1.65 s, 0 row) — nay revalidate mọi fact dưới khoá bằng `clock_timestamp()`. **R2** (3) — (1) **B3** `clearSessionCookie()` dùng `cookies().delete()` sinh header KHÔNG có `Secure`, mà cookie tiền tố `__Host-`/`__Secure-` thì trình duyệt bỏ qua header đó ⇒ **logout không xoá được cookie trên production** ⇒ đổi sang SET rỗng `maxAge: 0` giữ nguyên thuộc tính gốc (cùng lỗi ở `clearOauthBindingCookie`); (2) **B4** comment W-10 trong `fly.toml` khuyên đặt secret theo process group — Fly KHÔNG có cơ chế đó (`[env]` lẫn `fly secrets set` đều app-wide) ⇒ sửa comment, trỏ về cơ chế hậu tố role của entrypoint; (3) **A5/B3** `error_code` thô và `Error.name/message/stack` được log KHÔNG giới hạn độ dài ⇒ thêm `boundRawErrorCode` (64) + `bound()` với `ERROR_TEXT_MAX` 256 / `STACK_MAX` 2048. **R3** (2) — (1) **A5** chính bản vá R2 của tôi nhận `raw: string` nên một projector trả error code KHÔNG phải string sẽ ném `raw.slice is not a function` **giữa dòng log**, huỷ cả chu kỳ dispatch — đúng failure mode mà A5 sinh ra để diệt ⇒ nhận `unknown`, mô tả theo kiểu (`[null]`/`[object]`/`[array]`…), không bao giờ ép kiểu (`String(Symbol())` ném); (2) **B2** guard thứ tự migration dùng `<` nên một file ĐÚNG BẰNG ordinal cao nhất đã áp vẫn lọt ⇒ `<=`. **R4** (1) — test hồi quy của R2/R3 chỉ gọi thẳng helper, không đi qua `completionArgs`, bỏ sót function, và không hề chạy `runDispatchCycle` dù tự nhận "không được huỷ chu kỳ" ⇒ bảng 9 hình dạng (`42, true, 10n, null, undefined, {a:1}, [1], Symbol, ()=>`) nay chạy qua `completionArgs` cho cả `dlq` lẫn `retry`, thêm test cấp chu kỳ `JRD-BOUND` dùng `runDispatchCycle` thật, và `log.test.ts` thêm 2 test cho `name`/`message`/`stack` không phải string + biên cắt. **R5: CLEAN.** Ghi lại vì đây là bằng chứng, không phải luật mới: **3 trong 10 finding (R1-1, R2-1, R3-1) là bug production thật mà 1404 test xanh + typecheck + lint + build KHÔNG bắt được**, và 1 trong số đó do chính bản vá vòng trước sinh ra ⇒ vòng review sau mỗi lần sửa là bắt buộc, không phải nghi thức.
> **✅ 07/09 — defect thứ 11, tự soi ra khi chạy validator trên Mac, KHÔNG phải codex tìm (nó không chạy được vitest trong sandbox):** 5 test heartbeat của C2 mở file thăm dò tại `process.cwd()`, tức **`apps/bot/` trong repo**. Test happy-path không có lý do gì xoá file nó vừa assert, tên file lại mang pid của vitest nên **mỗi lần chạy suite lại rụng thêm một file mới** — đo trên worktree: 5 file `.heartbeat-test-*` untracked sau 5 lần chạy. Đây không phải bẩn thẩm mỹ: **`scripts/autopilot-review-readiness.mjs:658` chạy `git status --porcelain --untracked-files=all` rồi `HALT WORKTREE_DIRTY`** — untracked cũng tính — và **`autopilot-scope-gate ready` gọi đúng validator đó ở dòng 748**, nên một file thăm dò rơi vãi là đủ chặn chuyển trạng thái `ready`; `ap-finish.sh:83` tự đọc `status`. Reconcile thì KHÔNG ảnh hưởng (nó dùng `git blame`). **Ghi lại cả hai lần sai của chính dòng này vì bài học nằm ở đó:** bản nháp đầu khai bừa cả ba script; tôi sửa bằng cách `grep 'git status' scripts/autopilot-scope-gate` ra 0 dòng rồi kết luận scope-gate không soi working tree — **grep một file không chứng minh được điều gì về thứ file đó GỌI**; scope-gate không tự chạy `git status`, nó chạy validator, và validator mới là chỗ halt. Codex vòng 6 bắt lỗi khai quá tay, vòng 7 bắt tiếp lỗi sửa quá tay của tôi. Sửa bằng `mkdtemp` một thư mục riêng cho mỗi test, xoá trong `afterEach` bất kể assertion đi nhánh nào — sửa cả lớp, không vá từng test. Đo sau khi sửa: chạy trọn `pnpm -w test` xong `git status --porcelain` = 0 dòng.
> **⚠️ Môi trường:** shell của owner export `NODE_ENV=production`. Chạy test trong shell đó làm `apps/web` đỏ 4 test (cookie ra `__Secure-` prefix, và một test assert `NODE_ENV !== "production"`) — không phải lỗi code. Luôn chạy `NODE_ENV=test pnpm -w test`, hoặc bỏ export đó khỏi `~/.zshrc`.
> **Chờ owner (Tier C, mỗi mục một câu ✅):** C1 roster writer host-add vs bot-join · C2 ngôn ngữ per-user (DD-118 vs DD-113 khối 5) · C3 launch self-serve hay provision tay (OPEN NOTE DD-114 D6) · C4 `GOOGLE_OAUTH_*` enable · C5 gửi A3 luật sư · C6 outbox attempt bound. **DD-56 amendment #3** (route đọc session) là A9 — soạn xong mới ký.
> **KHÔNG đổi:** 0 màn FE · FE PENDING (DD-116) · schedule OFF · thanh ~33% · trục Tests `1308 + 124 @ 0aff7ad` · canonical P-number · dependency order.

> 🟣 **LIVE TRUTH 2026-09-04 (v1.40) — `main` = `origin/main` = `0aff7ad`. ĐÂY LÀ KHỐI MỚI NHẤT; mọi khối dưới, kể cả khối 🟢 tự xưng mới nhất, là lịch sử.**
> **HAI SLICE SẢN PHẨM ĐẦU TIÊN ĐÃ LAND** — trước hôm nay repo có **0 route nghiệp vụ đọc/ghi vòng đời session ngoài create/publish/update**; nay có **5**.
> **(a) `session-routes-close-cancel`** — `POST /api/sessions/:id/close` + `/cancel`. API route **13 → 15**, route nghiệp vụ **3 → 5**. Cả hai đi qua choke-point actor tạm `apps/web/lib/session-command-route.ts`, được **DD-56 amendment #2** (`decisions.md`, cùng ngày) cho phép **tường minh, đúng năm route liệt kê tên**. Điều khoản 5 giữ nguyên hạn dùng: amendment **void ngay khi `tenant-capability-authority-core` land**.
> **(b) `dd118-runwithlang-coverage`** — DD-118 phủ tới `GET /api/onboarding/readiness`. **Đây là ranh giới lộ thông tin, không phải chuyện format:** locale phân giải **SAU** authorization; phân giải trước sẽ trả lời cú dò của người lạ **bằng ngôn ngữ của tenant bị dò**, rò cả sự tồn tại tenant lẫn cấu hình của nó. Vòng security xác nhận độc lập ở **cả hai** call site. **Cùng bất biến với `session-command-route.ts:232`** — comment tại chỗ: *"a distinct 404 would turn this into a tenant-existence oracle"*. Kênh thứ hai: trước là mã trạng thái, giờ là ngôn ngữ.
>
> **Trục Tests — authority mới `1308 workspace + 124 readiness/kit @ 0aff7ad`** (cũ: `1234 + 85 @ 2648965`). core **153** · db **716** · web **399** · bot **40**, trên **50** test file. Provenance + điều kiện carry (hai lệnh `git diff --name-only` trả rỗng) ở khối 🟪 04/09 của `../product/ROADMAP.md` v3.15 — **đọc ở đó, đừng trích số từ đây đi nơi khác**.
> ⚠️ **Hai thang đo, CẤM cộng:** `1308` là vitest trên `packages`+`apps`; `124` là `node --test` trên `scripts/`.
> 🔴 **Một lệnh tái tạo đã bị bắt là MỤC:** `test:review-readiness` nay chạy **BỐN** file (lane `local-dev-sanctioned-paths` thêm `scripts/db-reset-test.test.mjs`), lệnh ba-file cũ trả **65** ⇒ ai chạy nó sẽ khai một drift **không tồn tại**. Đã sửa trong ROADMAP v3.15. Bài học mang đi: **lệnh tái tạo cũng là artifact có thể mục, và nó mục im lặng.**
>
> **Backlog đã gộp, hai repo:** Plexco **146 task** (thêm 4 row + kết quả O4 vào `db-zalo-bots-secret-hardening`); canonical `Claude template` **29 → 41 task** (E1–E12, khuôn fenced `task_id`). Ba row `worktree-*` từng bị gộp nhầm vào Plexco nay `superseded` trỏ sang E6/E7/E8 — `scope` của chúng là pack file `kit-sync`, mà luật cấm vá kit từ trong consumer.
> **O4 (credential Zalo) thu hẹp, KHÔNG cần lane nào land:** provider **đã pin** — AWS KMS, founder 2026-07-06, có code fail-closed `apps/web/lib/auth-secrets.ts:22,:31-33`; connector-is-KMS **đã pin trong spec Reviewed** `feature_zalo_channel_tech.md:46,:48`. Ba cột `zalo_bots`: `bot_token_enc` (outbound) · `webhook_token` (plaintext có chủ ý, **không phải** provider secret) · `secret` (trơ, 0 reader/writer, đã án DROP). **Còn HAI quyết định owner:** chung khoá KMS hay khoá riêng + ai được decrypt; và audit mỗi lần đọc credential. Khẳng định "KMS chưa pin" đến từ một **DRAFT không phải authority** và đã lan vào **DD-117 D5** — cần đính chính.
>
> **Trạng thái vận hành:** 0 lane in-flight ngoài `auth-s4-d0-revoke-core` (tồn từ trước) · 0 worktree · root lock FREE · 0 file tracked bẩn.
> **KHÔNG đổi:** **0 màn FE** · **FE PENDING (DD-116)** · schedule OFF · thanh **~33%** · canonical P-number · dependency order · không DD nào đổi trạng thái. Hai slice trên thêm **bề mặt API**, không thêm surface người dùng chạm được — thanh % không nhúc nhích là **số đúng**, không phải quên cập nhật.

> 🟢 **LIVE TRUTH 2026-08-25 (v1.39) — `main` = `origin/main` = `1215a6a`. ⚠️ *Đã bị khối 🟣 04/09 ở trên thay về authority; giữ nguyên văn làm lịch sử.* Mọi khối dưới (kể cả khối 🟠 tự xưng mới nhất) là lịch sử.**
> **+17 commit từ pin `a151b15` (21/08): 15 docs + 2 BE merge.** Khối docs 22–24/08 (697 dòng DD-113/114/115 + mirror) đã **commit + push** (`fee0a18`…`5a6d8dd`, đóng audit V1/V13); audit snapshot 24/08 tại `../sessions/2026-08-24-repo-audit.md` (derived, non-authority).
> **Hai BE merge là hai hard dependency phase-1 của DD-114:**
> **(a) DD-29 capability resolver `f2af39d`** — `packages/db/src/capability.ts` `resolveCapability()`: reader production **đầu tiên** của capability registry (hết cảnh "0 TS đọc `entitlements`" từ 07/08), fail-closed, `FOR SHARE` pin `(plan_key, plan_version)` trên `subscriptions`. ⚠️ Resolver **vẫn 0 caller** — wiring thuộc slice auto-reconcile (DD-114 D2.3); hard-dep (a) mới đi nửa đường.
> **(b) `public_projection_fences` `9da3021` — DD-12 (8a) ĐÃ LAND, migration `0033` (tail mới, 34 file).** Guarded view `public_session_share_v` (security_barrier) + raise (app) / CAS-clear exact-token (app_worker) + **REVOKE base SELECT `public_sessions` khỏi cả `readonly` lẫn `app`** ⇒ immediate-deny structural. **Hard-dep (b) ĐÓNG** — toggle public/private hết blocker hạ tầng; còn FE PENDING (DD-116) + OQ public (DD-114 D3). ⚠️ Projector tương lai PHẢI qua definer fn / writer role riêng; **CẤM re-grant `app` base SELECT**.
> **Decisions 24–25/08 (v2.38 → v2.42):** **DD-117 ✅** — `Close`/`Cancel` nhánh paid/retry-root = **fail-closed refuse** (`CANCEL_REQUIRES_REVIEW` class), thay deferral 14/08; authorize build Update+Close+Cancel theo DD-110 D3, KHÔNG authorize subsystem payments/review_policy. **DD-117 D5:** cả họ session command dedup **CHỈ** trên `(tenant_id, command_id)` — content fingerprint **BỊ BÁC** (không lưu verifier phái sinh PII, không kéo KMS chưa pin). **DD-115 ✅ D1–D5** (xem §7b; D6–D8 ⬜ là blocker cứng trước build). **2 amendment DD-50 (25/08, vào thân không kèm changelog row — v2.42 đã ghi nhận):** pay-later predicate = **verified email** (`account_emails.verified_at`; legacy `account_identities` KHÔNG tính) · identity resolver = **SECURITY DEFINER function-only** (khuôn `0027`).
> **A3 legal (blocker phase-1) đã khởi động trong repo:** starter packet `a49bf96` — `docs/legal/` matrix + engagement brief (đều DRAFT). Việc kế tiếp là của **OWNER, ngoài repo**: chọn + gửi luật sư VN; lead-time chỉ tính từ lúc gửi.
> **Trục Tests:** suite sau merge (informal, gate ap-merge): validator 30 + workspace **919** (core 152 · db 581 · web 146 · bot 40); **số authority vẫn 854 + 30 @ `93f1e93` (15/08)** — canonical runner chưa re-pin (bước 1 phiên P4).
> **🔵 In-flight:** successor **Slice A** `session-command-update-v3` (`2ac1f56`, round 3) — `UpdateSession` + caller đầu tiên của fence (`public-session-fence.ts`), bỏ fingerprint theo DD-117 D5; sau Slice A còn Slice B (Close+Cancel). Lane `identity-account-link-core` authored (`94861a0`, migration **`0034` trên lane** — chưa merge; chính lane này mang 2 amendment DD-50).
> **Không đổi:** 0 route nghiệp vụ · 0 màn FE · **FE PENDING** (DD-116, named trigger 3 vế) · schedule OFF · thanh ~33%. Hàng đợi: **P6 → P5 → P4** theo `../autopilot-templates/next-lanes-2026-08-24-RUN.md`; việc owner ngoài repo: gửi A3 · chốt DD-112 + OQ DD-114 · spike DD-14/15 Zalo OA.
>
> 🟠 **LIVE TRUTH 2026-08-22 (v1.37) — QUYẾT ĐỊNH, KHÔNG PHẢI RUNTIME. ĐÂY LÀ KHỐI MỚI NHẤT.**
> 🆕 **DD-116 ✅ Chốt Option B — KEEP (owner 24/08, cập nhật v1.38):** lệnh FE PENDING 13/08 nay có **nguồn bền** trong `../standards/decisions.md` DD-116 (thay `../autopilot-templates/next-lanes-2026-08-13-RUN.md`) — đóng lỗ governance DD-113 D5 đã flag, đúng luật DD-111 D4. PENDING **giữ nguyên hiệu lực**; gỡ **chỉ** khi named trigger đủ **CẢ BA**: (a) owner chọn canonical design file (`design.pen`/`fe.pen`, đúng một) · (b) file đó tracked trên `main` · (c) owner ký nghiệm thu design authority trong `decisions.md` (gate DD-81). Khi gỡ ⇒ authorize FE **bounded đúng 5 khối launch DD-113**, mỗi lane vẫn qua Level 3 + readiness gate; **không sự kiện nào khác** gỡ. `design.pen` + `fe.pen` vẫn untracked tới điều kiện (b). *(chỉ chạm docs, không đo lại gì.)*
> **`main` không đổi kể từ khối v1.35 (`a151b15`); phiên 22/08 chỉ chạm docs, KHÔNG chạm `packages/` hay
> `apps/`. Mọi số đếm của v1.35 giữ nguyên hiệu lực — v1.36 không đo lại gì.**
>
> **DD-113 ✅ (owner 22/08) — GTM re-sequencing: launch = webapp PWA + Zalo bot SONG SONG, app native
> lùi về phase sau.** Web hết vai "fallback"; phạm vi mỗi surface do **thiết kế** quyết định, không do
> giới hạn Zalo quyết định. **Launch scope PWA v1 = đúng 5 khối:** signin/signup · link Zalo bot ·
> session management · session detail · settings. Negative scope launch: discovery public · in-app chat ·
> feed/kudos · auto-reconcile · rating công khai · tournament/club · **web push** · **fill-slot** ·
> **native**. Gate mở native nay là ngưỡng đo được (≥5 host ≥4 tuần trên PWA · weekly return ≥60% ·
> install rate ≥30% **tách iOS/Android** · `/api/v1`+bearer/refresh đã land · nêu được capability PWA
> **đo được là không làm nổi**), thay cho "TBD". DD-113 **không** đảo DD-69 — chỉ đổi thứ tự và bỏ nhãn
> fallback.
> Đã mirror **đủ** trong cùng phiên (cả DD-113 lẫn DD-114): `../strategy/gtm-strategy.md` (rewrite) ·
> `../standards/decisions.md` **v2.36** · `../product/ROADMAP.md` **v3.7** ·
> `../strategy/native-app-strategy.md` **2.1** · `../product/BRD.md` **v3.9p** · `../product/PRD.md` **v2.8o**.
>
> ⚠️ **DD-113 KHÔNG gỡ lệnh FE PENDING 13/08 — lệnh đó còn nguyên hiệu lực.** Đổi ưu tiên GTM và cấp
> quyền thực thi FE là hai quyết định khác nhau; trộn chúng vào một DD là cách một DD trở thành authority
> cho việc nó chưa từng xét. **Hệ quả thực tế: launch scope 5 khối ở trên hiện KHÔNG khởi động được.**
> ⚠️ **Và đây là phát hiện đáng nhớ hơn cả nội dung DD:** **lệnh FE PENDING chưa từng vào `decisions.md`.**
> Nguồn duy nhất là `../autopilot-templates/next-lanes-2026-08-13-RUN.md`, rồi mirror sang ROADMAP
> (`:38`, `:337`, `:378`) và chính file này. Theo đúng luật DD-111 D4 — *quyết định owner phải vào
> `decisions.md` trước khi lane mang qua gate; bản ghi bền thắng lời khai hội thoại* — thì trạng thái
> chặn FE, thứ đang chặn toàn bộ launch scope, **đang sống ngoài decision log**. Kiểm lại bằng
> `grep -n 'PENDING' docs/standards/decisions.md` (22/08: không hit nào nói về FE).
>
> **DD-114 ✅ (cùng ngày) — phase-1 = 7 nhóm; launch của DD-113 là SUBSET.** 1 signup/signin Google ·
> 2 **create club** (tenant provisioning self-serve) · 3 **link club ⇄ Zalo bot** · 4 link account ⇄ Zalo ·
> 5 **sync data + owner config public/private session** · 6 session management/detail + **nhắc nợ /
> confirm / gạch nợ** · 7 settings + user/privacy. **Phạm vi này ≈ P0→P5 trừ discovery/chat** — lớn hơn
> nhiều so với launch, và launch subset chính là thứ giữ nó không trôi.
>
> ⚠️ **Hai hard dependency của DD-114, cả hai đắt và cả hai owner-final:**
> **(a) Billing P5 vào phase-1.** Vế tiền chỉ mở cho `host_pro` (đúng DD-40/DD-29) ⇒ phải có subscription
> để gate ⇒ **DD-29 entitlement registry phải có reader thật đầu tiên**. Đo tại `a151b15`: `entitlements`
> /`capabilities` vẫn **0 TS đọc**, code dark từ 07/08. Phase-1 là chỗ nó hết dark, `payment_reconcile_auto`
> là capability đầu tiên được enforce thật.
> **(b) Toggle public/private chỉ mở SAU khi land `public_projection_fences`** + guarded view +
> narrow raise/CAS-clear + `public_projection_version` + grant migration (**(8a)** trong ROADMAP
> §Next Actions — **nợ sẵn có của DD-12**, không phải chi phí của tính năng mới). Lý do là lỗ đang mở, không
> phải nguyên tắc: kèo chuyển **private** hoặc **cancel** hiện **vẫn lộ tới khi projector async chạy xong**.
>
> ⚠️ **Gate A3 legal (PII data-class matrix) chuyển từ "lead-time item" thành BLOCKER của phase-1** — vì
> phase-1 có settings/privacy và có bank memo trên đường tiền. Cần luật sư VN ⇒ lead-time dài, khởi động
> ngay là quyết định rẻ nhất còn lại.
> ⬜ **OQ chưa chốt (DD-114 D3): public để làm gì khi phase-1 không có discovery?** Kèo `public` chỉ tới
> người khác qua share link `/s/<id>` (DD-73) — mà DD-73 còn bị **DD-41 projection migration** chặn. Ba
> khả năng (kéo DD-73+DD-41 vào phase-1 / chỉ toggle+fence / bỏ toggle) chưa chọn ⇒ slice chạm nhánh này
> **AWAIT**.
> ⚠️ **"Đăng ký trên bot ⇒ auto signup vào session" KHÔNG phải luồng mới** — nó là **DD-32 Option D** +
> DD-05 + DD-41 + DD-45 + DD-52. Cấm dựng luồng join thứ hai song song `addMemberToSession`; paid+unlinked
> giữ chỗ **15 phút**, chỉ active sau verified full payment; provider outage **fail closed**.
> ⚠️ **BRD §5.1 và DD-114 dùng hai nghĩa khác nhau của "phase-1"** — §5.1 là *MVP scope* và có kể
> discovery + in-app Chat; DD-114 D7 đặt cả hai **ngoài** phase-1. Không phải mâu thuẫn nếu đọc đúng lớp:
> §5.1 nói *sản phẩm cuối cùng gồm gì*, DD-114 nói *đợt một gồm gì*. Đã ghi chú tại chỗ trong BRD.
>
> ⚠️ **Bảng tổng hợp của `decisions.md` không phải bản kiểm kê DD.** Đo 22/08: **DD-110, DD-111, DD-112
> không có hàng trong bảng đó** dù đều có mục thân bài. Caveat đã được viết vào chính file. Đọc DD mới
> nhất bằng `grep -nE '^## DD-1[0-9][0-9]' docs/standards/decisions.md`.
> **Version `decisions.md` nhảy v2.34 → v2.35 gánh HAI DD** (112 chưa từng có dòng changelog, 113 mới) —
> đừng đọc chuỗi version như một bậc một DD.
>
> 🟣 **LIVE TRUTH 2026-08-21 (v1.35) — `main` = `origin/main` = `a151b15`. ĐÂY LÀ KHỐI MỚI NHẤT.**
> ⚠️ **Cách đọc file này, sửa từ v1.35:** các khối LIVE TRUTH bên dưới xếp theo thời gian **tăng dần**
> (13/08 → 14/08), nên đọc xuôi từ trên xuống bạn gặp khối **cũ nhất trước** — đúng ngược với ý định
> của chúng. Từ nay khối mới nhất nằm **ngay đây, trên cùng**; mọi khối dưới là lịch sử, và **chỉ thị**
> của chúng cũng mục chứ không riêng con số.
> **+11 commit từ pin `93f1e93` (14/08): 9 docs + 2 chạm `packages/db/`.** Kiểm:
> `git diff --name-only 93f1e93..HEAD -- packages apps`.
> **`AnnounceSession` đã land (`d925c99`) — command thứ BA của `session-service.ts`, và là command
> money-free ĐẦU TIÊN.** Gate announce = `status='open'` **và** `ends_at > now()`, đánh giá **dưới row
> lock bằng đồng hồ DATABASE** (đúng lớp clock-skew P1 mà PublishSession từng dính), lỗi
> `SESSION_ALREADY_ENDED` — DD-111 (✅ owner 15/08) + amendment D1 (`51fe7e9`): **một time-guard sau khi
> đã khoá cần query riêng của nó, không chỉ cần gọi đúng hàm.** Lane land là
> `session-command-announce--v2` (`.autopilot/landings/`). Export hiện có:
> `grep -nE '^export (async )?function' packages/db/src/session-service.ts`.
> **DD-110 (✅ owner 15/08) mint bốn action-class literal hẹp cho session command family** + hàng ma
> trận Suspended Action Matrix tương ứng, đóng đúng blocker Tier C mà packet
> `session-commands-update-close-cancel` tự nêu; amendment D3 ghi nhận pre-registration chỉ-literal là
> **bất khả thi về cấu trúc**. Kèm token invariant mới **`billing-authz`** trong catalog.
> **Decisions: file tự khai `v2.34` (15/08) — nhưng `a151b15` thêm DD-112 mà KHÔNG thêm dòng changelog,
> nên version đó đang under-report một DD.** Đọc DD mới nhất bằng
> `grep -nE '^## DD-1[01][0-9]' docs/standards/decisions.md | tail -5`, đừng tin ô version.
> **DD-112 ⬜ CHƯA CHỐT (mở 17/08):** đổi **sức chứa** khi session đã có charges thì xử lý tiền thế nào —
> câu hỏi mở **không có owner đứng sau**. Đây là Tier C: slice nào chạm nhánh đó phải AWAIT.
> **Số đo tại `a151b15` — ĐỀU LÀ STATIC, KHÔNG PHẢI RUNNER:** 33 migration, tail `0032` **không đổi** ·
> **38 test file** · **static 835** (core 146 · db **512** · web 137 · bot 40) · validator 30 ·
> 10 API route + `healthz` · 1 `page.tsx`. ⚠️ **Canonical runner CHƯA chạy lại từ 15/08** — số authority
> cho trục Tests vẫn là **854 workspace + 30 validator @ `93f1e93`**. `835` là static và **cấm khai
> thành số runner**; db tăng 490→512 khớp với test đi kèm `AnnounceSession`, không phải một lần đo mới.
> **Không đổi:** 0 route nghiệp vụ · 0 màn FE · schedule OFF · chưa projector thật · FE **PENDING** theo
> lệnh owner 13/08 · code-dark còn **hai** (DD-29 entitlements · `chat_definer` bootstrap) · thanh ~33%.
> Ba command trong `session-service.ts` vẫn là **thư viện**: chưa surface nào gọi được từ ngoài.
>
> ✅ **ĐÃ ĐÓNG 21/08 — reservation mồ côi `docs-impact-policy-contract--price-only`.** Lane `HALT
> MAX_ROUNDS` ngày 17/08 (`fix-round-count` 5/5, `gate-attempt-count` 6, `pending-review-finding.json`
> còn active) nhưng registry vẫn ghi `in-flight` và **không có bản ghi landing/disposition nào** ⇒ nó
> giữ khoá `session-lock-ordering` · `api-contract` · `i18n-surface` + 7 file docs, chặn mọi slice
> chạm các thứ đó bằng `SCOPE_COLLISION`. Owner đã đóng bằng `ap-finish.sh --authorized-close`
> (13:02Z 21/08): disposition record `authorized_close` tại
> `.autopilot/dispositions/docs-impact-policy-contract--price-only.json` (`head_sha` `2d4861b`, không
> claim merge), **40 file forensics đã archive** tại
> `.autopilot/state-archive/docs-impact-policy-contract--price-only-20260821T130206Z/state/` (gồm
> `HALT-MAX_ROUNDS.txt`, `DECISIONS.md`, `regions.log`, 6 gate-attempt), worktree đã remove, registry
> đã `cleanup`, **branch `feat/…--price-only` giữ lại** để tra cứu.
> HALT này **có design cause gọi tên được** (packet reconcile manifest tích tụ 3 lớp thay vì author một
> manifest price-only sạch — 5/6 vòng là cái đuôi tự gây ra; reviewer attempt-01 đã đề nghị đúng cách
> kia) **và finding đã được accept** ⇒ successor **được pre-authorize** theo `level3-workflow.md` §6.1,
> **register mới từ `main` sạch**. Nợ còn lại: `ap-finish` cố ý **không** commit backlog — chạy
> `scripts/autopilot-backlog-reconcile --check` rồi `--fix` qua đường commit có root-lock.
>
> ⚠️ **ĐÍNH CHÍNH LỖI ĐO CỦA CHÍNH KHỐI NÀY — `git worktree list` qua mount của Cowork báo `prunable`
> SAI.** Bản nháp v1.35 khai ba worktree là `prunable` và dùng đó làm một phần lý do phải đóng gấp.
> Đo lại 21/08 sau khi đóng: **từ shell của owner, hai worktree PublishSession KHÔNG hề `prunable`**;
> **từ sandbox Cowork thì CÓ**. Nguyên nhân: worktree đăng ký đường dẫn `/Users/…` còn sandbox nhìn
> repo ở `/sessions/…/mnt/…`, nên git không khớp gitdir và xếp chúng vào `prunable`. Hệ quả cần nhớ:
> **mọi phán đoán về `prunable` đo từ một phiên Cowork là vô giá trị — phải đo lại từ shell thật.**
> Điều này cũng đặt dấu hỏi lên chính câu "cả hai forensics worktree bị flag `prunable`" trong
> `5186655` (15/08): nếu quan sát đó cũng đến từ một phiên Cowork thì tiền đề của nó cũng sai. Bản
> archive mà commit đó tạo ra vẫn có giá trị và vẫn là bản primary — chỉ **lý do** cần đọc lại. Lý do
> đóng `--price-only` thì **không** phụ thuộc vào `prunable`: registry `in-flight` + không disposition
> record + `pending-review-finding` còn active, cả ba đều verify độc lập được.
>
> **Cảnh báo "đừng prune" của v1.31/v1.34 nay có điều kiện mới:** forensics PublishSession v1/v2 đã được
> **sao ra prune-proof** tại `.autopilot/state-archive/` (`5186655`, 15/08) ⇒ **archive là bản primary,
> worktree là bản thứ cấp**. Nghĩa là hai worktree đó không còn là bản duy nhất — nhưng luật chung vẫn
> giữ: đừng prune worktree nào **chưa có** landing/disposition record.
> **Khối 🔵 "VIỆC ĐANG BAY — `session-service-create-command-core`" bên dưới ĐÃ MỤC:** lane đó đã merge
> (`.autopilot/landings/session-service-create-command-core--v2.json`). Câu "chưa merge ⇒ BE nghiệp vụ
> vẫn 0" trong khối đó **không còn đúng** — xem khối 🟢 14/08.
> **`CLAUDE.md` §Workflow bước 3 đã được sửa cùng phiên này:** cảnh báo `register` fail-OPEN với authored
> path mô tả một phiên bản kit cũ; KIT_VERSION 31 kiểm `manifest_schema_version` **ngay câu lệnh đầu
> nhánh `register`** và `HALT CONTRACT_INVALID`. Lời khuyên kiểm `registered-manifest.sha256` vẫn giữ.
> **Bản đồ quy trình đầy đủ** (hai ray, vòng đời slice, bẫy đã trả giá): `./repo-operating-flow.md` —
> derived doc, **không phải authority**; file gốc thắng khi lệch.
>
> 🔴 **LIVE TRUTH 2026-08-13 (re-pin cuối ngày, v1.33) — `main` = `origin/main` = `1fdba1d`. Đọc mục này TRƯỚC mọi đoạn phía trên/dưới; các con số cũ hơn là lịch sử.**
> **+60 commits từ pin `64e9ccb` (07/08). Migrations `0000`–`0032` (33 file), tail `0032`:** `0030` DM-safety authority DD-55 (`d5b31f9`, 10/08) · `0031` **chat schema core DD-38/86** (`3b3bb09`, 11/08) · `0032` DM-safety config single-read DD-102 (`80a3464`, 12/08). **Chat epic đã có DB root thật** — nhưng vẫn **0 service/API/UI chat**; slice 7 `chat-shared-message-command-core` **đã author** (packet + manifest còn untracked), slice 8 chưa; nợ P1 `chat-identity-merge-reparent-enablement` (planned, NOT_CODE_READY — DD-103) đứng trước Person-merge, còn `chat-dm-safety-config-single-read` đã merged (nghĩa vụ DD-102 đóng). Lane `chat-dm-safety-authority-core--v2` @`31bd4d9` **ĐÃ ĐÓNG** qua `--authorized-close` (DD-103), successor `--v3` merged — cảnh báo "đừng prune" của v1.31 hết hiệu lực.
> **Tests: 813 — và phải đọc đúng phạm vi.** **813 là số WORKSPACE (vitest), KHÔNG gồm lớp validator**, đo tại gate `0032` = `80a3464` (12/08, máy owner). Đối chiếu static đóng chính xác: `772 + 41 generated = 813` (core 152 · db 475 · web 146 · bot 40) — chi tiết generator ở `../product/ROADMAP.md` §Cách đọc tiến độ luật 4. Full `pnpm test` = 813 + validator; **lớp validator đã 13 → 17 qua HAI commit**: `b53bc75` tạo `autopilot-ephemeral-review-worktree.test.mjs` (2 test) + wire vào `test:review-readiness` (13→15), rồi `2d5834b` thêm 2 test nữa vào chính file đó **không chạm `package.json`** (15→17) ⇒ full-run kế tiếp kỳ vọng **830** (dự đoán, không khai). ⚠️ Con số `795 @ a8f120f` ở bản v1.32 **không thuộc `main`** (chỉ trên `feat/dd38-dd86-chat-schema-core--v2` + archive) — đừng xen vào chuỗi mốc main-line. Tương tự, mốc **`683` @`528540e` là TỔNG** (13 validator + 670 workspace): trong chuỗi workspace phải đọc là **670**, đừng trộn hai thang đo. Test files **37**. Được phép mang 813 sang `1fdba1d` vì **24 commit sau `80a3464` không chạm `packages/`|`apps/`** (`git diff --name-only 80a3464..HEAD -- packages apps` ⇒ rỗng); chúng chỉ chạm docs/backlog/`.claude/commands/`/kit/**root `package.json`** — nhưng "không chạm code" ≠ "số full-run không đổi", vì lớp validator đổi qua cả `package.json` lẫn file test. **CI infra-block (billing, 06/08) ĐÃ HẾT:** Security/OSV full-scan **GREEN trên main** (run trên `9a5c709`, 11/08 — lần đầu sau đợt đỏ); các merge 0030–0032 đi qua ap-finish gates sạch. Chưa re-verify từng workflow khác — đọc run mới nhất trước khi claim full-matrix xanh.
> **Decisions v2.28 (13/08):** DD-100 Level 3.1 adoption · DD-101 B3-budget amendment · DD-102 waiver + nghĩa vụ ĐÃ hoàn tất (`0032`) · DD-103 chấp nhận gap merge-reparent có ràng buộc cứng · DD-104 chốt D0–D4 decision-level (slice DEFERRED — chờ `tenant-capability-authority-core` packet; spec-WIP DeleteSession đã gỡ lần hai khỏi 2 spec Session, FE v2.25/BE v2.22) · **DD-105 ✅ suspension gate cho `CreateSession` — miễn theo TÍNH VÔ HÌNH của draft (invisible-until-publish + money-free), KHÔNG phải theo "mutation nhỏ"**; ranh giới thật `publish_new_sessions` vẫn ❌ khi suspended. *(v1.32 ghi v2.27 — stale, DD-105 land sau.)* Docs: reorg `features/FE|BE` (`2e577c7`) + A-grade Entry Points 49 specs (`8af9601`) + expert prompt library + docs-inventory; docs pass 12/08. Spec hiện hành: **26 Product (`docs/features/FE/`) + 25 BE** + 17 FE spec `docs/channels/web/FE/` (Draft). Kit: reviewer-isolation hardening (`b53bc75`/`2d5834b`); kit version đọc từ header `scripts/autopilot-scope-gate`.
> 🟢 **LIVE TRUTH 2026-08-14 (v1.34) — `main` = `origin/main` = `93f1e93`. Đọc khối này TRƯỚC mọi đoạn dưới.**
> **BE nghiệp vụ không còn bằng 0.** Hai command đã land trong `packages/db/src/session-service.ts`:
> `createSession` (`b48625c`) và `publishSession` (`1ccbe5d`) — cộng **cặp outbox producer có thứ tự đầu
> tiên** trên cùng aggregate (`session.created` seq 1 → `session.published` seq 2). Job substrate merge từ
> 26–27/07 lần đầu có thứ để chở.
> **`authorizeTenantAction` HẾT code-dark** sau 8 ngày 0 caller — `publishSession` gọi thật với
> `publish_new_sessions`, có re-check dưới khoá. Danh sách "ba thứ code dark" ở khối 07/08 bên dưới nay chỉ
> còn **hai** (DD-29 entitlements · `chat_definer` bootstrap).
> ⚠️ **KHÔNG runnable, và thanh ~33% không đổi:** 0 route nghiệp vụ · 0 màn FE · schedule OFF · chưa
> projector thật. Hai command là **thư viện**, chưa surface nào gọi được từ ngoài. Đổi là *buildable*,
> không phải *runnable*.
> **Số đo `93f1e93`:** 33 migration · **38 test file** · **static 813** (core 146 · db **490** · web 137 ·
> bot 40) · 10 route. ✅ **Canonical runner chạy 15/08: PASS `854` workspace** (core 152 · db 516 · web 146 ·
> bot 40) **+ 30 validator**, 0 fail — đây là số authority cho trục Tests. Luật 4 đóng khít từng package
> (`813 + 41 = 854`). ⚠️ Static 813 **trùng số** runner 813 đo tại `80a3464` chỉ là ngẫu nhiên; runner
> thật nay là **854**. Giữ làm tiền lệ: static bằng một runner cũ là lúc dễ suy bậy nhất.
> **Chuỗi PublishSession, đáng đọc:** ba lane, 15 vòng review, hai `HALT MAX_ROUNDS` (v1 `507f15a`,
> v2 `da8385c` — cả hai giữ read-only forensics). Thứ làm nó land không phải kiên trì mà là **chẩn đoán
> đúng**: reviewer đọc `git diff <base>...HEAD` = *toàn bộ* diff mỗi vòng, miss-rate đo được ~2/3, nên v1/v2
> cạn trần vì **lấy mẫu** chứ không phải thiết kế sai. v3 kế thừa 11 vòng đã dọn và land trong **4 vòng**,
> dưới cả trần cũ. DD-109 nâng trần lên 8 hoá ra **không cần và không chạy được** (validator hard-cap 5);
> phần có giá trị của nó là **điều kiện cứng bắt phải tới vòng security** — chạy lần đầu sau 15 vòng, CLEAN.
>
> *(Khối 13/08 bên dưới giữ làm lịch sử — phần "0 SessionService" và "authorizeTenantAction 0 caller" đã mục.)*
>
> 🔵 **VIỆC ĐANG BAY, CHƯA TRÊN `main` — `session-service-create-command-core`, slice nghiệp vụ ĐẦU TIÊN của cả project.** Lane v1 `HALT MAX_ROUNDS` ở fix-round 5: advisory lock khoá theo command type trong khi ledger unique theo `(tenant_id, command_id)` ⇒ raw `23505` thay vì `COMMAND_ID_CONFLICT`; chẩn đoán được chấp nhận là **validation input là họ edge case không hội tụ bằng vá từng vòng**. Owner chọn option A → successor `--v2` đăng ký lại từ `main` sạch, một validator duy nhất up-front, khoá độc lập command type; budget 600 compact, **zero amendment** (overflow ⇒ AWAIT). Branch `feat/session-service-create-command-core--v2` đã có `packages/db/src/session-service.ts` + test + barrel (3 file). **Chưa merge ⇒ BE nghiệp vụ vẫn 0 và không tính vào bất kỳ trục nào.** DD-105 đã đóng blocker B4 của packet.
> ⛔ **KHÔNG pin SHA/LOC của lane này vào doc — nó amend liên tục.** Trong lúc soạn v1.33, tip đã đổi hai lần (`ade0a79` → … → `648f74b`, 577 → 642 dòng) và hai SHA chép vào doc đều thành **orphan** trong vòng vài chục phút. Trạng thái thật: `git log --oneline feat/session-service-create-command-core--v2`. Doc chỉ pin thứ không đổi: tên branch, 3 file, "chưa merge".
> 🔴 **FE PENDING theo lệnh owner 13/08 — mạnh hơn HOLD.** DD-81 / M0.3 / M4 và **mọi việc FE** treo lại: không track `.pen`, không mở page/component, không chạy lane FE. Khác biệt cần nắm: HOLD thì hoàn thành gate là đi tiếp được; PENDING thì gate không còn là thứ chặn, và `git add design.pen` là đi ngược lệnh owner. `design.pen` + `fe.pen` untracked **có chủ ý**.
> **Không đổi (đo 13/08 tại `1fdba1d`):** 10 API route (8 auth kể cả 2 telegram-era + 2 onboarding) + healthz, **0 route nghiệp vụ, 0 màn FE** (1 `page.tsx`); `authorizeTenantAction` **0 production caller**; DD-29 entitlements **0 reader**; **`chat_*` 0 production reader** (chỉ khai báo Drizzle trong `schema.ts` + 4 file test); outbox schedule OFF/chưa producer/real projector; Google login chưa enablement proof; 0 SessionService trên `main`. Kit **v31**; `slice-readiness-verdicts.md` vẫn dừng ở **Verdict 31** vì slice từ AP-45 trở đi mang verdict block trong packet của chính nó ở `docs/autopilot/contracts/` — đừng đọc thành "không có slice nào được review từ 06/08". **Next lanes** theo `../autopilot-templates/next-lanes-2026-08-13-RUN.md`: **S1 đã xong** (packet Session → `CODE_READY`) → **`--v2` đang chạy** → C7 (chat slice 7) → S2 khi codex rảnh → B-rest (kit friction). Mirror: `../product/ROADMAP.md` **v3.5**.
>
> *(Khối 2026-08-07 bên dưới giữ làm lịch sử — phần migration/tests/lane-đỗ/CI của nó đã mục.)*
>
> 🔴 **LIVE TRUTH 2026-08-07 (re-pin cuối ngày) — `main` = `origin/main` = `64e9ccb`. Đọc mục này TRƯỚC đoạn "Cập nhật: 2026-07-28" ngay trên; đoạn đó đã mục ở phần migration/tests.**
> Sau `2cd52ce` có thêm loạt docs(design)/FE-spec commits, rồi `7e21f65` (design-brief pins + DD-96) và `528540e` (**cross-project standardization batch**: `packages/core/src/api-contract.ts` — envelope types + 11-code `API_ERROR_CODES` registry, `err()` narrow sang `ApiErrorCode`; root scripts `test:core|db|web|bot`/`check:quick`/`smoke:predeploy` + `scripts/smoke-predeploy.mjs`; proposal `docs/proposals/cross-project-standardization-2026-08-07.md`). Sau đó cùng ngày: `4cc574c` (fix(ci) Actions-minutes hygiene — linear-sync cron `*/10`→6h, timeout + concurrency cả 3 workflow), `5b2b8f5` (**`packages/core/src/app-error.ts`** — sealed `toAppError` mapper fail-closed + 14 tests; `frontend-architecture.md` v0.7 owner-duyệt; HANDOFF v1.30) và `64e9ccb` (**decision batch DD-96..99**, decisions **v2.12→v2.19** — Sporta FE/BE + BotShopez sweep: 12 FE spec +4 section Draft, +5 research, +1 proposal design-input; mirror ROADMAP v3.4n/BUILD-STATUS).
> ⛔ **CI ĐANG CHẾT Ở TẦNG INFRA từ 2026-08-06 ~18:37Z** — mọi run (CI/Security/linear-sync, kể cả docs-only) fail đồng loạt ~15m với annotation "The job was not acquired by Runner of type hosted"; repo private ⇒ khả năng cao hết phút GitHub Actions/spending limit. `528540e` đã push nhưng **chưa có CI xanh**; mọi merge-gate dựa CI đứng yên tới khi owner xử lý billing (GitHub → Settings → Billing). Đừng đọc CI đỏ giai đoạn này thành lỗi code. Mitigation `4cc574c` (cron/timeout/concurrency) đã land nhưng **chưa có run xanh nào xác nhận** — CI vẫn phải coi là blocked cho tới khi owner verify billing + 1 run xanh trên `main`.
> **Migrations `0000`–`0029` (30 file)**, không phải `0024`: thêm `0025`/`0026` (rename CHECK, RENAME-only, zero predicate change), `0027` (`resolve_tenant_status_locked` — SECURITY DEFINER **read-only vĩnh viễn**, tồn tại vì `FOR SHARE` đòi quyền UPDATE mà cấp UPDATE thẳng trên `tenants` sẽ mở lại write-path vừa đóng), `0028`/`0029` (**DD-29 capability registry**, cặp expand→contract: `plans.plan_key` → 2-tier `free|host_pro`, `entitlements` → `{"capabilities": {...}}`, repoint `tenant_provision()`).
> **Ba thứ đã merge nhưng CODE DARK, đừng đọc là feature:** `authorizeTenantAction` (`ddb69a9`) — **0 production caller**, mới re-export ở `packages/db/src/index.ts`, nó là root dependency cho các slice sau; DD-29 registry — **0 TS nào đọc `entitlements`/`capabilities`**, nên chưa entitlement nào được thực thi dù `tenant_provision()` (`packages/db/src/auth.ts:212`) đã repoint; role `chat_definer` — provision bằng **bootstrap script** `infra/postgres-init/02-chat-definer.sql` (`286f48b`), **không phải migration**, và bootstrap serialization (`b55d628`) cố ý **fail-open** dưới managed Postgres.
> **Trục Tests — ĐO THẬT 2026-08-07 tại `528540e` (máy owner, hết STALE):** canonical runner PASS **683** = 13 validator + 670 workspace (core **138** · db **346** · web **146** · bot **40**), 34 file. Điều kiện để xanh trên máy local: phải dọn rác probe trong cluster Postgres — DB mồ côi `plexco_chat_dm_safety_check` + 3 function `dm_safety_*` (owner `chat_definer`) nằm sẵn trong `plexco_test` làm cleanup `DROP ROLE` của `migrate.test.ts` (doadmin test) fail; đã drop DB mồ côi + recreate `plexco_test` (roles cluster-level giữ nguyên, harness tự migrate). CI chưa xác nhận được số này vì runner-blocked (xem ⛔ trên). `5b2b8f5` sau đó đã **commit** `app-error.ts` (+14 tests) — per-package trên máy owner: core **152/152**, web **146/146** (commit message); **full-suite sau `528540e` chưa chạy lại**, nên số khai cho trục Tests vẫn là **683 @ `528540e`** (kỳ vọng ~697 lần chạy kế). Test files hiện **35**; static cross-check tại `64e9ccb` = **669** (core 146 · db 346 · web 137 · bot 40) — drift signal, không phải số test.
> **Không đổi:** 10 API route (8 auth + 2 onboarding), 0 route nghiệp vụ, 0 màn FE, Chat 0 migration/API/UI, ~33%. 12 FE spec `docs/channels/web/FE/` **đã commit** (Draft — không đổi status boundary; bản sửa +4 section đã vào `64e9ccb`). Working tree hiện chỉ còn: gitnexus-block refresh (`AGENTS.md` · `CLAUDE.md` · 6 SKILL.md — prettier sạch, chờ commit chore) + **2 file untracked `design.pen` · `fe.pen`** — DD-81 canonical chưa chọn/track/nghiệm thu ⇒ FE vẫn HOLD. `frontend-architecture.md` **v0.7** (amendment route-mỏng/barrel/`toAppError`, owner duyệt 07/08). GitNexus index **hết stale**: reindex 2026-08-07 02:43 (7523 symbols, có `api-contract` + `app-error`; 2 commit sau reindex đều docs-only). **Lane đỗ chờ:** `feat/chat-dm-safety-authority-core--v2` @ `31bd4d9` (worktree `.autopilot/worktrees/chat-dm-safety-authority-core--v2`) — implement xong, verification sạch, chờ codex quota cho final review round; **KHÔNG chạy `git worktree prune`** trước khi lane đóng. Autopilot kit **v31**; verdict ledger tới **Verdict 31**. Milestones hiện hành: `../sessions/2026-08-07-next-milestones.md`.
>
> ⚠️ **Hai điều dễ hiểu nhầm khi tiếp quản:** (1) canonical runner PASS trên current HEAD (`3d75c90`, 2026-07-29): **32 files / 561 workspace tests** (core 132 · DB 243 · web 146 · bot 40) + 13 readiness-validator = **574 tổng**; `550`, `460` và `419` chỉ là snapshot lịch sử. DB 219→243 (+24) do `0025` CND tests; số **file** giữ 32 vì test mới vào hai file đã có (`rls-invariants.test.ts`, `migrate.test.ts`) — đó là scope manifest của slice, không phải suy đoán. (2) Job-infra root/ack/dispatcher/preflight/schedule đã **IMPLEMENTED** (`0022`, `0023`, `fca314e`, `a03d2d6`) nhưng delivery vẫn code-dark: schedule mặc định **OFF**, `productionStubDeliver` chỉ DLQ, chưa có producer, real projector hoặc replay path; do đó không được gọi là `ENABLE_READY` hay product runtime.
>
> **⚡ v3.4 Phase-1 pivot (DD-37 ✅, thay DD-09):** Kênh phase-1 = **web + Zalo + Facebook Messenger**;
> **Telegram đã bị loại khỏi phạm vi** (không còn adapter/bot Telegram trong MVP). Auth phase-1 =
> **Google OAuth + email/password** (DD-13 ✅, thay TG Login) + link **Facebook** (DD-33 ✅; external approval evidence là enablement gate, capability OFF + one-time `link_code` fallback tới khi pass)
> + **Zalo** (DD-14 ⬜). Feature phase-1 mới: **Google login**, **chat cơ bản trong app** (DD-38 ✅, scope-committed phase-1),
> **cài đặt hồ sơ + giá theo giới tính** (DD-39 ✅, scope-committed phase-1), **mark-paid thủ công tiền mặt/CK, tap/multi-select** (DD-40 ✅).
> *(DD-38/39 committed — schema `chat_*`/`person.gender` chưa vào canonical `schema.ts`, migration còn chờ.)*
>
> **⚡ Channel endpoint DD-15/DD-65..68:** một Meta App; central Plexco Page luôn có + optional Page per-club. Identity uniqueness = `(platform, provider_scope_lookup_hash, platform_user_lookup_hash)`; Messenger scope Page, Zalo scope bot/OA tới khi DD-15 chứng minh rộng hơn; reachability gắn `channel_identity_id`. Endpoint/default context không tự cấp target tenant; one-route delivery. Live schema/runtime chưa đáp ứng contract.
>
> **⚡ Channel booking DD-32 Option D:** user luôn browse được time/public area/fee/confirmed count/slots trước khi link. Free còn chỗ → active không link; full → waitlist; approval → pending trước. Paid còn chỗ: qualified Plexco Account link → active + charge/pay later; unlinked → durable hold 15 phút và chỉ active sau verified full settlement. Screenshot/nút “đã trả”/host mark-paid không phải proof cho nhánh pay-now. Product + BE companion đã Reviewed, nhưng intent/hold/occupancy/finalizer/adapters chưa tồn tại; readiness nằm ở implementation plan riêng.
>
> **📱 DD-69 app-native (✅ direction accepted, owner 18/07):** phase-1 target = PWA qua S9/S20 nhưng live `apps/web` chưa có manifest/service worker; phase-2 native build **chưa schedule** (technical gates mở). RN+Expo là recommendation sau spike. Native push dùng protected device subscription riêng, không phải ChannelIdentity; offline v1 read-only. Xem `../decisions/analysis/dd-69-app-native-analysis.md`.

---

## 0. TL;DR cho dev/AI mới (làm theo thứ tự)
1. Đọc hết file này.
2. `git log --oneline -15` + `git status` để biết hiện trạng.
3. Đọc `README.md` (tính năng + setup + doc map).
4. **TRƯỚC mọi việc đụng code/git: nắm 5 HARD RULES ở §3 — vi phạm = rò rỉ tiền/PII thật.**
5. Việc mới: theo workflow ở §5 (không tự ý sửa thẳng main).
6. **Autopilot — bắt đầu ở `docs/autopilot-ONBOARDING.md`** (entry point duy nhất; workflow **Level 3 supervised autonomy**, contract canonical `docs/autopilot-templates/level3-workflow.md`, scope-gate kit version **đọc từ header `scripts/autopilot-scope-gate`** — không hard-pin ở đây vì số chép tay đã stale một lần; sync từ `Claude template` bằng `bash "$HOME/Projects/Claude template/autopilot/parallel/autopilot-update.sh"`). Setup máy nhanh: chạy **`scripts/autopilot-onboard.sh --codex /abs/path/to/codex`** (idempotent: `@import` invariants vào `~/.claude/CLAUDE.md`, pin `AUTOPILOT_CODEX_BIN`, verify kit). Chạy nhiều session/feature song song qua **git worktree riêng (base `main`) + `scripts/autopilot-scope-gate register --manifest .autopilot/state/<feature>/manifest.json`** (runtime manifest, KHÔNG phải authored contract `docs/autopilot-manifests/<slug>.json` — truyền authored path là `HALT CONTRACT_INVALID`; HALT cả khi đụng `scope`/`invariants`/dep). Token domain chuẩn ở `docs/autopilot-invariant-catalog.md`; backlog ở `docs/autopilot-backlog.md`; bản canonical template ở `docs/autopilot-templates/`. Song song khi scope+invariant rời nhau, tuần tự khi đụng (vd cùng `schema`/`identity`/`money-model`).

---

## 1. Project là gì

**Plexco** là platform **2 phía, đa môn** cho thể thao phong trào:
- **Host**: tạo & quản kèo, **mark-paid thủ công (tiền mặt/CK)** + **đối soát CK tự động** (SePay/ApiPay, tier `host_pro`) — ngay trong Zalo/Messenger **và** web.
- **Player**: khám phá kèo cross-CLB/môn (**marketplace**), join, theo dõi nợ — xuyên CLB.
- **PostgreSQL + domain model = canonical store** — web và các kênh chat (Zalo/Messenger) đều là surface, sync 2 chiều.

**Stack:** TypeScript, Next.js App Router + SSE (web), HTTP adapter kênh (Zalo/Messenger), Drizzle ORM, PostgreSQL (RLS). Chạy modular monolith trong container, không Vercel (DD-10). *(Telegram/grammY đã loại khỏi target — DD-37; auth route Telegram-era vẫn còn trong code baseline tới khi email order-4 + Telegram-removal slice land.)*
**Monorepo:** pnpm workspaces — `packages/core` + `apps/bot` + `apps/web`.
**Bối cảnh:** lift logic thuần từ bot single-club (Bestminton) đã chạy production sang `packages/core`; viết lại data layer trên Postgres + RLS.
**Song ngữ vi/en:** mọi chuỗi user-facing qua `t(vi, en)`; user đổi bằng cấu hình ngôn ngữ.

## 2. Kiến trúc & repo map

**3 vùng dữ liệu (= 3 tầng hiển thị):**
1. **GLOBAL identity** (ngoài RLS, không chứa tiền): `persons`, `channel_identities`, `channel_reachability`, `sports`.
2. **TENANT-scoped** (RLS fail-closed): `sessions`, `players`, `memberships`, `charges`, `bank_transactions`, `payment_allocations`, billing… — tiền/roster/nội bộ.
3. **PUBLIC read model** (cross-tenant, KHÔNG RLS, field whitelist): `public_sessions` — marketplace. **Không** chứa tiền/PII.

**Packages:**
- `packages/core` — logic thuần (matching, payments-logic, dates, format, i18n, sports). Test trong isolation.
- `apps/bot` target — Zalo DM + Messenger hybrid central/tenant Page, role-aware host/player, 24h/App Review. **Reality hiện tại:** shared queue provisioning/preflight, outbox dispatcher và recovery schedule đã merge nhưng schedule mặc định OFF, delivery là placeholder fail-closed; chưa có channel adapter/handler, business producer hay real projector.
- `apps/web` — Next.js App Router/API routes + SSE realtime + web UI (dashboard host, player view, discovery).

**Flow đối soát CK (đường tiền — hiểu kỹ trước khi sửa):**
```
SePay webhook → /webhook/sepay/:token → verify timestamp/raw-body HMAC (timing-safe, ±300s) → lưu raw trước ack
  → matching: pay_code tier → name matcher → classifyAmount
  → FIFO settle → notifyPlayersPaid (fan-out mọi kênh + sync web)
```

**Canonical store pattern:**
```
Mọi surface (chat/web/webhook) → Command → Services → tenantRepo (choke-point, RLS)
  → ghi + Outbox event (cùng tx)
  → Projectors: Zalo · Messenger one-route (tenant Page→central) · SSE web · public_sessions
```

## 3. ⛔ 5 HARD RULES (vi phạm = rò rỉ thật)

1. **RLS FAIL-CLOSED.** Mọi query đi qua `tenantRepo(tenantId)` — choke-point bắt buộc. `SET LOCAL app.tenant_id`. Role `app` = `NOBYPASSRLS`. **Không** query trực tiếp bảng tenant-scoped từ controller.

2. **TIỀN/PII KHÔNG RA PUBLIC.** `public_sessions` chỉ chứa field-whitelist (môn, giờ, khu vực, giá, slot, host_display_name, club_display_name). **Tuyệt đối không** lưu roster, nợ, SĐT, email vào bảng public. Test bất biến CI bắt buộc.

3. **KHÔNG multi-master.** PostgreSQL + domain model = canonical store. Surfaces (Zalo/Messenger/web) chỉ gửi command, **không** tự sở hữu bản ghi song song. Mutation đi qua service/tenantRepo; đồng bộ qua outbox → projectors.

4. **CLAIM-CÓ-TIỀN CẦN KHOÁ MẠNH.** Merge/claim identity phải qua **verified factor: email đã verify (web) hoặc `link_code` deterministic dùng-một-lần (bot)** — DD-50, phase-1 không thu SĐT (phone fields dormant). Không cho người lạ claim membership đang có nợ bằng tên/alias. Với DD-32 pay-later, exact endpoint-scoped ChannelIdentity và verified Plexco Account còn phải cùng resolve tới current canonical Person; PSID/`from.id`, provider name hoặc display name riêng lẻ không đủ. (AUDIT C2/C5)

5. **i18n BẮT BUỘC:** mọi chuỗi user-facing = `t(vi, en)`. Không hardcode 1 thứ tiếng.

## 4. Conventions

### Commit
- Format: `type(scope): mô tả ngắn gọn`
- Types: `feat` | `fix` | `docs` | `style` | `refactor` | `test` | `chore`
- Scope: module/feature (vd: `tenant`, `payment`, `identity`, `discovery`, `web`)
- Body bắt buộc cho `feat`/`fix`: what changed + why
- Tracking: `Ref: LINEAR-XXX` hoặc `Tracking: NO-LINEAR`

### Code
- TypeScript strict, `tsc --noEmit` phải sạch
- API error luôn JSON: `{ error: true, message: "...", code: "ERROR_CODE" }`
- Validate input cả FE và BE; sanitize trước DB
- CORS: KHÔNG dùng `*` ngoài development
- Mọi constructor NestJS (nếu dùng tsx): phải có `@Inject()` decorator

### Test
- `DATABASE_URL_TEST=postgres://plexco:plexco_dev@localhost:5432/plexco_test pnpm test` (harness **bắt buộc `DATABASE_URL_TEST`**, `packages/db/src/test-harness.ts`; local chạy `docker compose -f infra/docker-compose.yml up -d postgres` trước. KHÔNG dùng `DB_PATH`/SQLite.)
- Test bất biến: cô lập tenant A/B + public chỉ field whitelist
- Seed data: tiếng Việt, mọi trạng thái, idempotent, 8-10 records/entity

### CSS & Design
- Mọi color/spacing/typography khai báo CSS variables trong `:root`
- KHÔNG hardcode hex/rgba — luôn dùng `var(--token)`
- Xem `docs/standards/design-tokens.md`

## 5. Workflow — Level 3 supervised autonomy

> Canonical contract: **`../autopilot-templates/level3-workflow.md`**. Entry point vận hành:
> **`../autopilot-ONBOARDING.md`**. Forward-only: chỉ áp cho task mở mới; session đang chạy giữ
> contract cũ tới terminal state.

```text
WORKFLOW_LEVEL: 3   HUMAN_ROLE: manager_of_managers
DEFAULT_STOP_MODE: STOP_AT_READY   AUTO_MERGE: off
```

1. **Task contract trước khi code.** Primary agent resolve outcome · base · context sources · scope/
   negative scope · risk P0–P3 · autonomy mode · slice graph · worktree plan · verification ·
   code/security review · stop conditions (`level3-workflow.md` §3). Thiếu context material →
   `AWAIT_CONTEXT`, không tự bịa.
2. **Slice + worktree:** 1 writing slice = 1 branch + 1 worktree + tối đa 1 writer, base pin từ
   `main` đã verify. Register scope trước khi ghi — truyền **runtime manifest**, KHÔNG phải authored
   contract: `scripts/autopilot-scope-gate register --manifest .autopilot/state/<feature>/manifest.json`
   (tự viết file này từ `docs/autopilot-manifests/_TEMPLATE.json` trước; nó mang
   `manifest_schema_version: level3-operational-v2`, còn `docs/autopilot-manifests/<slug>.json` thì BỊ
   CẤM mang trường đó). Truyền authored path là `HALT CONTRACT_INVALID` — kiểm ngay câu lệnh đầu tiên
   của nhánh, trước khi chạm `INFLIGHT.md`. Sau mỗi lần register, kiểm
   `.autopilot/state/<feature>/registered-manifest.sha256` tồn tại trước khi làm việc khác; đừng tin
   chữ `registered`. Root worktree luôn ở `main`, KHÔNG sửa thẳng main. Slice đụng cùng
   migration/state/generated artifact → tuần tự, không song song.
3. **Scope nhỏ:** ~300 LOC / ≤3 module per slice; mỗi slice nêu đúng 1 mechanism + negative scope.
4. **Self-verify:** `pnpm test` (bắt buộc `DATABASE_URL_TEST`) + build/lint/typecheck, e2e khi vượt
   boundary thật, và inspect exact diff so với base đã pin.
5. **Review độc lập bắt buộc:** `scripts/codex-review-pin.sh`; slice chạm auth/secret/permission/tiền/
   external input/deployment chạy thêm 1 security round. Reviewer không gọi được → `HALT
   TOOL_UNAVAILABLE`. PR theo `.github/PULL_REQUEST_TEMPLATE.md`, checklist pass.
6. **Terminal state `READY | AWAIT | HALT`** rồi **người merge tay**: squash 1 commit/feature vào
   `main`. Level 3 KHÔNG có auto-merge; P0 prepare-only; P1 luôn supervised.

Docs/plans/specs/readiness vẫn phải qua gate chặt hơn của repo:
`../standards/review-code-readiness-gate.md` + `pnpm review:check:changed`.

### 5b. Làn ap3 — run do dispatcher khởi động (DD-120 🟡, 2026-09-09)

Từ 09/09 repo có **hai làn**: làn supervised ở trên (mọi task người mở, không đổi) và làn **ap3** — kit
Level 3 mỏng dựng trên sandbox · `--permission-mode dontAsk` · hooks · budget native của Claude Code, chạy
từ launchd, **không cần người gõ lệnh**. Chỉ class `code-quality-p2` (P2, không đổi hành vi) đi làn này;
READY của nó là **một PR đang mở** (`verify` xanh · Codex `CLEAN` · dòng evidence), bạn merge tay sau khi
**CI xanh**, `AUTO_MERGE: off` giữ nguyên. Phân vai (sửa 09/09 theo phép đo — codex không chạy được trong
sandbox): **writer chỉ code** rồi dừng ở `.ap3-run/READY-FOR-REVIEW`; **dispatcher** review + push + mở PR,
và chỉ mở khi verdict CLEAN. Nhận diện làn = env `AP3_SLUG`/`AP3_TASK`/`AP3_BASE_SHA`/`AP3_STATE`
(luật ở `CLAUDE.md` mục "Làn ap3"). Contract: `../autopilot-templates/ap3-workflow.md` (mirror English
của `docs/level3-native/DESIGN.md` bên Claude template). Vận hành từng bước: `../../ap3/README-W2.md`.
Slice đầu đã xếp: `ap3/queue/core-package-const-has-no-consumer.md`. **Kit chưa cài** (chờ wave 1 bên
template) — cho tới lúc đó không có gì tự chạy, và §5 ở trên áp nguyên cho mọi session.

## 6. Trạng thái hiện tại (2026-07-28) — ⚠️ SNAPSHOT LỊCH SỬ

> ⛔ **Toàn bộ §6 là ảnh chụp 28/07, KHÔNG phải trạng thái hôm nay.** Trước đây chỉ các *con số* ở đây bị mục; nay có cả **một câu chỉ thị bị mục**, nên phải nói rõ:
> - **Câu "FE HOLD" ở cuối §6 đã HẾT HIỆU LỰC.** FE hiện là **PENDING theo lệnh owner 13/08** — không phải chờ gate. Ai làm đúng theo câu cũ (persist/track `design.pen` để "mở khoá" FE) là **đi ngược lệnh owner**. Đọc block 🔴 LIVE TRUTH ở đầu file.
> - Số đã mục: tail `0024` → **`0032`** (33 file) · decisions v2.11 → **v2.28** · ROADMAP v3.4l → **v3.5** · spec 24/24 → **26 Product + 25 BE** · "Chat 0 migration" → nay có `0030`–`0032` (vẫn 0 service/API/UI).

**Planning & Docs — decision coverage cao** (decisions v2.11 current mirror: DD-32 Option D; DD-80 auth; DD-87 `splitNameAmount`; DD-70/71/72/86/91–95 owner-final; DD-88 broader `DEFERRED_PROPOSAL`; DD-73/74/75/78 dependency/consumer-sequenced, DD-76/77 evidence-gated). Channel Booking, In-app Chat v0.15/v0.23, Notifications v3.11/v3.11 và Club Assistant v0.18/v0.18 có Reviewed target contract; runtime còn thiếu. Chat plan v1.8 = `PLAN_READY` tại `90d292d`; từng slice vẫn cần strict `CODE_READY`. Đây không phải coding authorization.

> **⚙️ Auth S4 — lane Google đã xong phần code:** **D0a (`0015`) · D0b · D1 email-token (`0016`) · D1 Google (`0017`) · d1b session-rotation (`0018`)** đều MERGE — tail toàn cục hiện `0024`. Safari macOS + iOS Safari 18.3 đã đo M3 **PASS** ngày 26/07 (`../probes/probe-strict-cookie-completion-hop.md` §7–§8), nên measurement gate đã đóng. Google login vẫn **chưa được chứng minh đã enable/go-live**: credentials trong template giữ rỗng; owner chỉ set sau quyết định go-live và các gate độc lập còn lại. Kế tiếp trong auth vẫn là **order-4 email bundle** (flag OFF, gate C7, kế thừa D1E-18b) → gỡ Telegram. Chi tiết: **`../auth/auth-s4-session-handoff.md`**.

- ✅ **Foundation merged:** monorepo (`packages/core` + `packages/db` + `apps/bot` + `apps/web`) + core logic thuần (test xanh) + Postgres/RLS choke-point (`tenantRepo`/`withTenant`) + **migrations `0000–0013`** committed (roles/RLS/grants/functions/seeds/auth_functions/onboarding_steps) + bộ RLS invariant test chạy trên role runtime thật.
- 🟡 **Auth Onboarding v3 (Telegram-era) merged** (`5b1193b`) + web tests. **DD-37 supersede provider** → Google/email; **B0 đã owner-duyệt → DD-80 v1.88** (G3 epoch revoke-all). Provider swap re-slice thành D0a/D0b/D1: **cả D0a · D0b · D1 · d1b nay ĐỀU ĐÃ MERGE** (bản trước ghi "D0a in-flight" — stale). Telegram-era routes vẫn còn tới khi order-4 email bundle land rồi mới gỡ provider.
- ⬜ **Feature layer chưa build:** session/reconcile/sync/marketplace/billing/bot handlers/UI (bảng DB đã dựng sẵn; tầng command/service/projector/UI còn trắng). Session Management có hợp đồng spec đóng và `0024` đã thêm đúng capacity-visibility CHECK, nhưng vẫn **0 SessionService, 0 route**. Job-infra chung đã land tới dispatcher/schedule, song schedule OFF và chưa có producer/real projector/replay; không được tính là Session/Sync/Notification runtime.

Tài liệu hoàn tất (bản mới nhất):
- ✅ BRD v3.9n · PRD v2.8m · TDD v3.1h · ROADMAP v3.4l · decisions v2.11 current mirror; exact authority pack đã land tại `90d292d`, primary plan `PLAN_READY`, runtime pending
- ✅ 4 phụ lục (saas-plan, reconciliation, AUDIT, messenger)
- Feature docs working tree: **24 Product/System / 24 BE = 24 cặp**; committed `main@784bc8d` vẫn 24/23 vì Funnel BE chưa commit. Channel Booking, In-app Chat v0.15/v0.23, Notifications v3.11/v3.11 và Club Assistant v0.18/v0.18 có Reviewed target contract; implementation chưa bắt đầu. Chat owner-final gồm DD-92 own edit/soft-delete + pre-beta search, DD-93 full registry, DD-94 generic opaque offline signal/digest và DD-95 exact moderation. Home hub v0.7/v0.3 (DD-79 ✅, S9) composition-only; Session Organize v0.5 (DD-61..64 ✅ accept-in-principle) build post-P4; coverage không có nghĩa runtime/build-ready — xem `features/README.md`.
- ✅ Business rules, design tokens, dependency graph
- ✅ README, CHANGELOG, PULL_REQUEST_TEMPLATE, HANDOFF, templates

**Việc tiếp theo:** (1) owner quyết định Google go-live sau các gate độc lập; (2) giữ `OUTBOX_DISPATCH_SCHEDULE_ENABLED=false` tới khi có real projector + producer + replay/recovery; (3) mở vertical Session BE theo dependency hiện hành — `0024` chỉ là DB invariant; (4) với Channel Booking, dùng canonical implementation plan và first prerequisite `identity-account-link-core`, không nhảy thẳng vào Messenger/Zalo adapter; (5) với Chat, làm theo current verdict/next trigger ở primary plan §13 rồi dùng slice-local packet cho bounded first slice. HANDOFF không tự authorize runtime worktree. ~~**FE HOLD:** không mở page/component hay map token cho tới khi canonical `design.pen` được persist/track + owner nghiệm thu làm authority.~~ ⛔ **HẾT HIỆU LỰC 13/08** — thay bằng **FE PENDING theo lệnh owner**: không mở page/component **và không track `.pen`**; gate DD-81 không còn là thứ chặn. Xem block 🔴 LIVE TRUTH đầu file.

**Reference:** Bot single-club (Bestminton) đang chạy production — logic tiền đã kiểm chứng, đã lift sang `packages/core`, migrate thành tenant #1.

## 7. Doc map & nơi tra cứu

| Folder | Nội dung |
|---|---|
| `docs/00-start-here/` | HANDOFF (file này), identity-model — đọc trước tiên |
| `docs/auth/auth-s4-session-handoff.md` | **Handoff chi tiết mảng Auth S4 (D0→D1)** — bản đang nóng, resume độc lập slice auth |
| `docs/product/` | BRD, PRD, TDD, ROADMAP, CRM_DASHBOARD_BRD — tài liệu cốt lõi |
| `docs/standards/` | decisions, business-rules, design-tokens, feature-dependency-graph, deployment-infra · **DD-57..59 deferred reference** · **DD-60 accepted** · **DD-61..64 accepted-in-principle/no-runtime** |
| `docs/features/` · `docs/features/BE/` | Feature specs FE (Product) · BE (Tech) |
| `docs/channels/` | telegram **(archived — DD-37)**, zalo, messenger (phase-1), web (+ messenger-channel-design; designer-kickoff/pipeline are DD-57..59 deferred references; API convention DD-60 accepted) |
| `docs/decisions/analysis/dd-73-78-share-activity-analysis.md` + `docs/decisions/briefs/founder-decision-brief-2026-07-19-share-activity.md` | Cụm **Share & Activity** (DD-73..78 ✅ 19/07): phân tích đầy đủ + bản ghi 6 quyết định |
| `docs/research/` | bestminton analysis/scan, player-side-saas AUDIT & reconciliation |
| `docs/strategy/` | gtm-strategy, gtm-doi-soat-decision, saas-implementation-plan, PnL model |
| `docs/automation/` | onboarding, playbook, automation-overview, product-backlog (autopilot-kit vẫn ở `docs/autopilot-*`) |
| `docs/templates/` | Templates tái sử dụng; FE handoff/token-mapping templates là **DD-58 deferred/optional reference**, không active gate |
| `docs/archive/` | **KHÔNG phải authority** — nội dung cứu khỏi `.autopilot/worktrees/` (không còn là git worktree + bị gitignore ⇒ chưa commit = chưa được bảo vệ). Gồm patch slice P0 identity/link/secret chưa từng commit, và ledger autopilot phase-1 (`DECISIONS.md`/`PROGRESS.md` — không có bản nào khác trong repo). Đọc `docs/archive/README.md` trước khi revive bất cứ thứ gì trong đó |

**Source of truth khi conflict (theo topic):**

1. **Live implementation/data model:** `packages/db/schema.ts` + migrations + code/tests trên `main`.
2. **Quyết định đã chốt:** `docs/standards/decisions.md` (proposal/open không tự thành contract).
3. **Scope/behavior/implementation target:** BRD → PRD → TDD; ROADMAP + BUILD-STATUS chỉ mô tả thứ tự/progress.
4. **Security/money:** áp dụng rule nghiêm ngặt hơn giữa AUDIT, business rules và specs; không nới fail-closed chỉ vì doc thấp hơn chưa cập nhật.

Research/reconciliation/strategy là input định hướng, không được override live schema hoặc DD đã chốt.

## 7b. Membership — đọc trước khi ai đó "thêm gói hội viên" (DD-115)

> Ba cái bẫy dưới đây đã được đo và đóng ở DD-115; chúng lặp lại rất dễ vì trực giác nào cũng dẫn sai đường.

1. **"Membership" trong repo này đã có nghĩa rồi.** `memberships` = quan hệ person↔tenant. Còn `subscriptions`/`plans` = billing SaaS của **host**. Còn `membership_tags` (DD-43) = nhãn audience, và BL-SES-7 cấm tag tạo giá/quyền. Gói trả phí của **player** là khái niệm **thứ tư** — đừng nhét vào ba cái kia, và **đừng thêm cột vào `memberships`**.
2. **Không có "một hoá đơn cho cả gói".** `charges.session_id`/`player_id` NOT NULL + `charges_tenant_session_player_uq` + composite FK `0019` ⇒ charge tổng buộc phải sửa bất biến đường tiền (HR2 cấm). Đúng cách: **N charge đã chiết khấu + một CK allocate sang N charge** — 0 thay đổi trên bảng tiền.
3. **Đừng nhân số tuần để ra số buổi.** Cửa sổ 30 ngày = 4 tuần + 2 ngày. Đo thật với start 23/08/2026 (CN): T3+T5 = 8 nhưng T7+CN = **9**, cả tháng = **17** — không phải 16. Hai gói "2 buổi/tuần" **không** cùng giá và gói cả tháng **không** bằng tổng hai gói kia. Luôn đếm từ `sessions` thật.

⬜ **Chưa chốt, chặn build:** quyền vào kèo đã full (ngoại lệ **BL-SES-2/BL-CBF-3**, Tier C — và khái niệm **"sân" chưa tồn tại** trong `packages/db`) · bind CK vào chu kỳ (ngoại lệ **BL-PAY-5** FIFO). ⛔ Chiết khấu phí giải đấu chờ **DD-82**.

Chi tiết: `../standards/decisions.md` DD-115 · `../standards/business-rules.md` BL-MBS-1..5 · `../features/FE/feature_membership.md`.

---

## 8. Bẫy cần tránh (từ kinh nghiệm bot cũ)

- **Đi fuzzy multi-name cho combo payment → sai tiền.** Dùng pay_code cho deterministic matching.
- **Query không qua `tenantRepo` → data rò rỉ cross-tenant.** Luôn dùng choke-point.
- **Copy logic qua 2 transport → DRIFT.** Rút logic ra core chung, transport = adapter mỏng.
- **Public projection không filter → lộ tiền/PII.** Field whitelist là bắt buộc.
- **Quên test bất biến → regression.** Test cô lập + public PHẢI xanh trong CI.
- **Merge identity thiếu strong proof → chiếm nợ người khác.** Claim-có-tiền cần verified account email hoặc transactional one-time `link_code`; tên/alias/owner assertion không thay proof DD-50.
- **Thiết kế schema/model từ nguyên tắc chung mà chưa đọc canonical → đề xuất sai + tạo bảng song song.** TRƯỚC khi đụng schema/data model/kiến trúc: đọc `packages/db/schema.ts` + `migrations/*.sql` (AUTHORITATIVE) → feature spec → `standards/decisions.md`. KHÔNG chế tên/bảng trùng khái niệm đã có (`persons`/`accounts`/`channel_identities`/`memberships`). Quyết định chưa chốt → proposal ở `decisions.md`, không viết vào spec đã Reviewed. (bài học session identity 2026-07-02)

---

## Identity — nơi tra cứu (tránh chế lại model)

- **Source of truth:** `packages/db/schema.ts` + `packages/db/migrations/0001_global_directory.sql`;
  contract ở `docs/features/FE/feature_identity.md` + `BE/feature_identity_tech.md`; nguyên tắc §P6
  ở `docs/standards/core-db-architecture-principles.md`.
- **Model:** `Person` (người thật global, anchor) · `Account`/`account_identities`/`web_sessions`
  (web-auth) · `channel_identities`/`channel_reachability` (bot) · `memberships` (person↔tenant).
  `link_codes` (hash-only) nối bot↔person, KHÔNG cần SĐT. **Phase-1 không thu SĐT (DD-50)** — khoá mạnh = verified email + link_code; phone = merge signal tương lai (DD-01, dormant).
- **Qualified Account link cho DD-32:** exact endpoint-scoped ChannelIdentity + verified Account identity phải cùng resolve tới current canonical Person và không frozen/conflicted. Messenger PSID khác Facebook Login subject; Zalo OA `from.id` khác Zalo Login subject tới khi provider evidence chứng minh mapping.
- **Orientation (KHÔNG phải chân lý):** `docs/00-start-here/identity-model.md`. Auth/link phase-1:
  `decisions.md` DD-13 (Google/email ✅), DD-33 (Facebook Login/Messenger link ✅; external enablement gate pending), DD-14/DD-15
  (Zalo Login/OA ⬜ & bot `from.id` cross-bot). Person link **Google + Facebook + Zalo** (không còn Telegram).

---

## Changelog

| Ngày | Version | Thay đổi |
|------|---------|----------|
| 15/09/2026 | v1.42 | **Re-pin `30a3e90` → `e235ea4` (87 commit) — bundle audit A/B/C ĐÃ MERGE, `0044` + guest-note ĐÃ LAND, gate chạy lại TẠI `e235ea4` và xanh toàn bộ.** Migration **37 → 45** (tail `0044`) · session command **6 → 8** · route nghiệp vụ **5 → 7** (route tổng vẫn 15 vì A3 gỡ 2 route Telegram) · runner **1308 → 1490 workspace**, readiness **124 → 128** · typecheck + eslint + `next build` xanh · tree sạch sau suite. Ghi thêm: bẫy 14 database `plexco_*` sót trong cluster làm lần chạy đầu đỏ; **một decision còn thiếu** — cổng tạm DD-56 nay phủ **BẢY** route trong khi amendment #2 pin **NĂM** (OPEN NOTE đã ghi trong `decisions.md`). Đợt docs cùng ngày: ROADMAP v3.17 · BRD v3.10 · PRD v2.9 · TDD v3.2 + 17 FE spec; phát hiện khối §📍 dựng 08/09 cho 4 core doc **chưa từng được commit** trong khi FE spec đã trỏ tới các version đó. Không đổi: 0 màn FE · FE PENDING · schedule OFF · ~33%. |
| 09/09/2026 | v1.41 | **Thêm §5b — làn ap3 (DD-120 🟡): run tự khởi động cho class `code-quality-p2`, READY = PR đang mở.** Không re-pin số đo (`main` local `b37e464` = `30a3e90` + 1 commit docs, chưa push). Mirror của DD-120; kit chưa cài, `.claude/settings.json` chưa đổi; `ap3/` trong repo mới có queue/registry/runbook. |
| 25/08/2026 | v1.39 | **Re-pin `a151b15` → `1215a6a` (+17 commit: 15 docs + 2 BE merge) — khối live-truth mới trên cùng.** Hai merge = hai hard-dep DD-114: **(a)** DD-29 capability resolver `f2af39d` (`resolveCapability()` — reader đầu tiên của registry, **vẫn 0 caller**, wiring AWAIT slice auto-reconcile D2.3); **(b)** `public_projection_fences` `9da3021` — migration `0033` (34 file), guarded view + CAS-clear + REVOKE base SELECT (`readonly` + `app`) ⇒ **hard-dep (b) ĐÓNG**, toggle public/private hết blocker hạ tầng (còn FE PENDING DD-116 + OQ DD-114 D3). Decisions v2.38→v2.42: DD-117 ✅ + D5 (dedup `(tenant_id, command_id)` DUY NHẤT, fingerprint bị bác) · DD-115 ✅ D1–D5 (§7b mới) · 2 amendment DD-50 25/08 · backfill bảng DD-110/111/112. A3 starter packet `a49bf96` commit — bước kế owner gửi luật sư VN. Suite informal sau merge 919 workspace + 30 validator; authority Tests vẫn 854+30 @ `93f1e93`. In-flight: Slice A `session-command-update-v3` (`2ac1f56`) + `identity-account-link-core` (`94861a0`, `0034` trên lane). ⚠️ **Đính chính ledger:** v1.38 (mirror DD-116, 24/08) và phần DD-115 §7b (25/08) đều vào file **không kèm hàng ledger** — hàng này gánh cả hai; đừng đọc chuỗi version như một bậc một thay đổi. Không đổi: 0 route nghiệp vụ · 0 màn FE · FE PENDING · schedule OFF · ~33%. |
| 22/08/2026 | v1.37 | **Thêm DD-114 ✅ — phase-1 = 7 nhóm, launch (DD-113) là subset (owner 22/08).** 1 signup/signin Google · 2 create club · 3 link club ⇄ Zalo bot · 4 link account ⇄ Zalo · 5 sync data + owner config public/private · 6 session management/detail + nhắc nợ/confirm/gạch nợ · 7 settings/privacy. **Phạm vi ≈ P0→P5 trừ discovery/chat.** Hai hard dependency owner-final: **(a) billing P5 vào phase-1** vì vế tiền chỉ mở cho `host_pro` (DD-40/DD-29) ⇒ **DD-29 entitlement registry phải có reader thật đầu tiên** (đo `a151b15`: vẫn 0 TS đọc, code dark từ 07/08); **(b) toggle public/private chỉ mở sau khi land `public_projection_fences` (8a — nợ sẵn có của DD-12)** vì kèo private/cancel hiện còn lộ tới khi projector async chạy. **A3 legal (PII) từ lead-time item thành blocker phase-1.** ⬜ OQ chưa chốt: public để làm gì khi chưa có discovery (share link DD-73 còn bị DD-41 chặn) ⇒ slice chạm nhánh này AWAIT. Nhắc lại ràng buộc DD-32 Option D cho "auto signup từ bot": cấm luồng join thứ hai, paid+unlinked giữ chỗ 15 phút, provider outage fail closed. Ghi chú thêm: **BRD §5.1 (MVP scope, có kể discovery+chat) và DD-114 D7 (phase-1, không có hai thứ đó) là hai lớp khác nhau**, đã chú tại chỗ. Mirror cùng phiên: decisions **v2.36** · ROADMAP **v3.7** · BRD **v3.9p** · PRD **v2.8o**. |
| 22/08/2026 | v1.36 | **Mirror DD-113 ✅ — GTM re-sequencing (owner 22/08). KHÔNG phải re-pin: `main` vẫn `a151b15`, phiên này chỉ chạm docs, không số đếm nào được đo lại.** Launch = **webapp PWA + Zalo bot song song**, app native lùi phase sau; web hết vai "fallback" (căn cứ đo được: DD-69 đặt PWA làm phase-1 target từ 18/07 mà tới `a151b15` vẫn 0 màn FE / 1 `page.tsx` / 0 route nghiệp vụ). Launch scope PWA v1 = 5 khối (signin/signup · link Zalo bot · session management · session detail · settings); gate mở native thành ngưỡng đo được thay cho "TBD". Mirror cùng phiên, đủ chuỗi: `../strategy/gtm-strategy.md` rewrite · `../standards/decisions.md` **v2.35** · `../product/ROADMAP.md` **v3.6** · `../strategy/native-app-strategy.md` **2.1** · `../product/BRD.md` **v3.9o** · `../product/PRD.md` **v2.8n**. ⚠️ **DD-113 KHÔNG gỡ FE PENDING 13/08** ⇒ launch scope hiện không khởi động được. ⚠️ **Phát hiện kèm theo, đáng nhớ hơn nội dung DD:** lệnh FE PENDING **chưa từng vào `decisions.md`** — chỉ sống ở `next-lanes-2026-08-13-RUN.md` rồi mirror ROADMAP/HANDOFF, tức thứ đang chặn toàn bộ launch scope nằm ngoài decision log, đúng lớp lỗi DD-111 D4 vừa cấm. ⚠️ Thêm: **bảng tổng hợp `decisions.md` thiếu hàng DD-110/111/112** (caveat đã viết vào chính file); version nhảy v2.34 → v2.35 **gánh hai DD** vì DD-112 chưa từng có dòng changelog. |
| 21/08/2026 | v1.35 | **Re-pin `93f1e93` → `a151b15` (+11 commits: 9 docs + 2 chạm `packages/db/`) và ĐỔI VỊ TRÍ khối live-truth.** Các khối cũ xếp thời gian tăng dần nên người đọc xuôi gặp khối **cũ nhất trước** — từ v1.35 khối mới nhất nằm trên cùng. **Mới:** `AnnounceSession` land (`d925c99`) — command thứ ba, **money-free đầu tiên**, guard `ends_at > now()` dưới row lock bằng đồng hồ DATABASE + `SESSION_ALREADY_ENDED` (DD-111 ✅ 15/08 + amendment D1 `51fe7e9`: time-guard sau khoá cần query RIÊNG, không chỉ cần đúng hàm); DD-110 ✅ mint 4 action-class literal + hàng Suspended Action Matrix (token invariant mới `billing-authz`), amendment D3 ghi pre-registration chỉ-literal là bất khả thi về cấu trúc; **DD-112 ⬜ CHƯA CHỐT** (17/08) — đổi sức chứa khi đã có charges thì xử lý tiền thế nào, **không có owner đứng sau** ⇒ Tier C. **Đính chính đo được:** (1) file `decisions.md` tự khai `v2.34` nhưng `a151b15` thêm DD-112 **không kèm dòng changelog** ⇒ ô version under-report một DD, đọc DD mới nhất bằng grep chứ đừng tin ô đó; (2) số `835` là **STATIC** (core 146 · db 512 · web 137 · bot 40, 38 test file) — **canonical runner CHƯA chạy lại từ 15/08**, số authority trục Tests vẫn là **854 workspace + 30 validator @ `93f1e93`**; (3) `CLAUDE.md` §Workflow bước 3 cảnh báo `register` fail-OPEN với authored path — mô tả kit cũ; KIT_VERSION 31 kiểm `manifest_schema_version` ngay câu lệnh đầu nhánh `register` và `HALT CONTRACT_INVALID` (đã sửa cùng phiên); (4) khối 🔵 `session-service-create-command-core` đã mục — lane đã merge. **✅ Đóng trong cùng phiên:** reservation `docs-impact-policy-contract--price-only` còn `in-flight` trong INFLIGHT nhưng lane đã `HALT MAX_ROUNDS` 17/08 (5/5 fix-round, 6 gate-attempt, `pending-review-finding.json` active) và **không có landing/disposition record** — nó đang khoá `session-lock-ordering`/`api-contract`/`i18n-surface` + 7 file docs. Owner đóng bằng `ap-finish.sh --authorized-close` lúc 13:02Z: disposition record `authorized_close`, **40 file forensics archive** tại `state-archive/…-20260821T130206Z/`, branch giữ lại; successor pre-authorized theo §6.1. Nợ: `ap-finish` không commit backlog ⇒ chạy `autopilot-backlog-reconcile` riêng. **⚠️ Đính chính lỗi đo của chính bản nháp v1.35:** nó khai ba worktree `prunable`; đo lại cho thấy `git worktree list` **qua mount Cowork báo `prunable` SAI** (worktree đăng ký `/Users/…`, sandbox thấy `/sessions/…/mnt/…` ⇒ không khớp gitdir), từ shell owner thì sạch. Mọi phán đoán `prunable` đo từ phiên Cowork là vô giá trị; điều này cũng đặt dấu hỏi lên tiền đề `prunable` của `5186655` — bản archive vẫn primary, chỉ **lý do** cần đọc lại. Lý do đóng `--price-only` không phụ thuộc `prunable`. Thêm doc dẫn quy trình `./repo-operating-flow.md` (derived, không phải authority). Không đổi: 33 migration tail `0032`, 10 route + healthz, 0 route nghiệp vụ, 0 màn FE, schedule OFF, FE PENDING, code-dark còn hai, ~33%. |
| 14/08/2026 | v1.34 | *(Dòng này được **backfill ngày 21/08** — khối 🟢 LIVE TRUTH 14/08 đã được viết vào file ở `2b07ef9` nhưng **chưa từng có dòng changelog**; ghi lại thay vì sửa im lặng.)* **Re-pin `1fdba1d` → `93f1e93`.** BE nghiệp vụ hết bằng 0: `createSession` (`b48625c`) + `publishSession` (`1ccbe5d`) land trong `packages/db/src/session-service.ts`, kèm **cặp outbox producer có thứ tự đầu tiên** trên cùng aggregate (`session.created` seq 1 → `session.published` seq 2). `authorizeTenantAction` **hết code-dark** sau 8 ngày 0 caller ⇒ trio code-dark còn **hai**. Canonical runner 15/08: **854 workspace + 30 validator**, 0 fail. Chuỗi PublishSession: 3 lane, 15 vòng, 2 `HALT MAX_ROUNDS`; thứ làm nó land là **chẩn đoán đúng** (reviewer đọc toàn bộ diff mỗi vòng, miss-rate ~2/3 ⇒ v1/v2 cạn trần vì **lấy mẫu**), v3 land trong 4 vòng. DD-109 nâng trần 5→8 hoá ra **không cần và không chạy được** (validator hard-cap 5). Vẫn KHÔNG runnable: 0 route nghiệp vụ, 0 màn FE, schedule OFF, chưa projector thật. |
| 13/08/2026 | v1.33 | **Re-pin cuối ngày `1303c31` → `1fdba1d` (+10 commits) + 5 đính chính của chính v1.32.** (1) **Phạm vi số test:** `813` là **workspace-only**, không gồm validator — v1.32 để mơ hồ và một phiên reconcile sau đó đã trừ nhầm 13 validator rồi khai một mismatch "lệch 11" **không tồn tại**. Đối chiếu thật đóng chính xác `772 + 41 = 813`. Lớp validator 13→**17** qua `b53bc75` (+2) **và** `2d5834b` (+2) ⇒ full-run kế kỳ vọng 830. (2) **`795 @ a8f120f`:** commit đó **không nằm trên `main`**, không được xen vào chuỗi mốc main-line. (3) **`683 @ 528540e` là TỔNG**, không phải workspace — trong chuỗi workspace phải đọc là 670. (4) **decisions v2.27 → v2.28:** DD-105 land sau khi v1.32 viết. (5) **"11 spec bump"** của v1.32 sai — `692f9f2` là **9 spec** + `feature_share_activities.md`, đúng như title commit. **Mới:** `session-service-create-command-core` — slice nghiệp vụ đầu tiên, v1 `HALT MAX_ROUNDS`, v2 authorized, **chưa merge** (⛔ không pin SHA: tip amend liên tục, hai SHA chép vào doc đã thành orphan trong một buổi); chat slice 7 đã author; **FE HOLD → PENDING theo lệnh owner** (đổi bản chất, không phải mức độ); next-lanes chuyển sang bản 13/08. Mirror `ROADMAP.md` v3.4o → **v3.5**, `BUILD-STATUS.md` +block 13/08. Không đổi: 33 migration, 10 route, 0 route nghiệp vụ, 0 màn FE, ~33%. |
| 13/08/2026 | v1.32 | **Live-truth re-pin `64e9ccb` → `1303c31` (+50 commits).** Migrations tail `0029`→`0032` (33 file): `0030` DM-safety DD-55, `0031` chat schema DD-38/86, `0032` DD-102. Chat lane `--v2` đóng `--authorized-close` (DD-103), `--v3` merged — gỡ cảnh báo prune v1.31. Tests 683→**813** (gate `0032`, 12/08), files 35→37. CI billing-block hết: OSV GREEN trên `9a5c709` (11/08). Decisions v2.19→**v2.27**: DD-100..104, trong đó DD-104 chốt D0–D4 decision-level 13/08 (slice deferred), spec-WIP DeleteSession gỡ lần hai (FE v2.25/BE v2.22). Docs reorg `features/FE\|BE` + A-grade 49 specs. Không đổi: 0 route nghiệp vụ/0 màn FE, FE HOLD DD-81, code-dark trio (`authorizeTenantAction`/DD-29/outbox OFF), Google chưa enablement proof. Next: C (2 nợ chat P1) → B theo next-lanes 2026-08-11. |
| 07/08/2026 | v1.31 | **Live-truth re-pin `528540e` → `64e9ccb` (review round toàn repo, cuối ngày).** Ghi 3 commit mới: `4cc574c` CI-mitigation (cron/timeout/concurrency — **chưa có run xanh xác nhận**, CI vẫn coi là blocked), `5b2b8f5` commit `app-error.ts` (+14 core tests; per-package core 152 · web 146 máy owner; trục Tests giữ **683 @`528540e`** tới full-run kế; test files 35; static @`64e9ccb` = 669), `64e9ccb` DD-96..99/decisions v2.19. GitNexus hết stale (reindex 02:43 có `api-contract`/`app-error`); còn nợ commit chore gitnexus-block refresh. Ghi lane `chat-dm-safety-authority-core--v2` @`31bd4d9` đỗ chờ codex quota + cấm `worktree prune`. FE HOLD không đổi: `design.pen` + `fe.pen` cùng untracked, DD-81 canonical chưa chọn. Milestones: `../sessions/2026-08-07-next-milestones.md`. |
| 07/08/2026 | v1.30 | **Live-truth reconcile tại `528540e` + CI infra-blocked.** HEAD → `528540e` (cross-project standardization: core `api-contract` 11-code registry + `err()` narrowed, root test aliases + smoke-predeploy, proposal doc). Trục Tests hết STALE: đo thật **683** (13 validator + core 138 · db 346 · web 146 · bot 40, 34 file) trên máy owner sau khi dọn rác probe cluster (`plexco_chat_dm_safety_check` + `dm_safety_*` trong `plexco_test`). Ghi ⛔ CI chết tầng infra từ 06/08 ("job not acquired by hosted runner", repo private ⇒ nghi hết phút Actions) — CI đỏ giai đoạn này KHÔNG phải lỗi code, mọi gate dựa CI chờ owner xử lý billing. `frontend-architecture.md` v0.7 amendment (owner duyệt qua Cowork); working tree thêm `app-error.ts` (+test) chưa commit, chưa vào số đo; GitNexus index stale — reindex trên máy owner. |
| 29/07/2026 | v1.29 | **De-pin kit version khỏi prose (4 chỗ) + live-truth sau khi gỡ khối uncommitted.** Cùng ngày phát hiện `KIT_VERSION 10` stale ở 4 file trong khi cài đặt là `11` — và chính changelog v1.28 bên dưới tự ghi là đã sửa lên `11` trong khi dòng nó nói là đã sửa vẫn đọc `10`. Sửa số chỉ mua được tới lần bump kế; nay bỏ hẳn hard-pin ở `HANDOFF.md`, `autopilot-ONBOARDING.md`, `autopilot-templates/level3-handoff.md`, `CLAUDE.md` → trỏ về `awk '/^# KIT_VERSION:/{print $3; exit}' scripts/autopilot-scope-gate`. Cùng cơ chế de-pin đã cứu 17 file khỏi sweep migration-tail hôm nay. Test baseline **561** (core 132 · db 243 · web 146 · bot 40) + 13 validator = **574**, đo thật tại `f88a2c8`, không phải chép. |
| 29/07/2026 | v1.28 | **§5 Workflow → Level 3 supervised autonomy.** Canonical contract `docs/autopilot-templates/level3-workflow.md`; task contract trước khi code, 1 writing slice = 1 branch/worktree/writer, self-verify bằng lệnh thật, review độc lập bắt buộc qua `scripts/codex-review-pin.sh` + security round cho trust boundary, kết ở `READY \| AWAIT \| HALT` rồi người merge. §Tiếp quản item 6 bỏ pin stale v0.6.0 → kit **KIT_VERSION 11** (`ed38106`, đã trên `origin/main`). Review-readiness gate của repo vẫn thắng ở chỗ nào chặt hơn. Không đổi authority · scope · DD · runtime. |
| 28/07/2026 | v1.27 | **Chat readiness re-pin + current live summary:** exact authority pack land `90d292d`, plan v1.8/analysis = `PLAN_READY` closure 12/12; HEAD `main@784bc8d`. B4/worktree và per-slice strict `CODE_READY` vẫn còn, runtime/migration/API/UI = 0. Sync BRD v3.9n/PRD v2.8m/TDD v3.1h/ROADMAP v3.4l; DD-32 contract giữ nguyên. |
| 28/07/2026 | v1.26 | **Owner-final Chat authority + DD-32:** mirror decisions v2.10 DD-86/DD-91–95, DD-88 broader `DEFERRED_PROPOSAL`, Assistant v0.17/v0.17, Chat v0.14/v0.22, Notifications v3.10/v3.10 và plan v1.7. Current readiness remains owned only by each canonical implementation plan; Chat points to primary plan §13. Keep DD-32 Option D and first prerequisite `identity-account-link-core`. No runtime/migration/API/UI. |
| 28/07/2026 | v1.25 | **SUPERSEDED by v1.26:** former Chat correction used Draft Assistant and the reduced no-edit/search/digest floor; no longer current authority. |
| 27/07/2026 | v1.24 | **Live-truth reconcile tại `main@2dc9b8c`:** tail `0024`/25 migration; canonical suite 32 file/537 workspace +13 validator; job-infra `0022`/`0023` + dispatcher/preflight/schedule implemented nhưng schedule OFF, stub DLQ, chưa producer/real projector/replay; Safari macOS+iOS M3 đã đo PASS nhưng Google chưa được chứng minh enabled/go-live; DD-87 core merged nhưng chưa production caller. Next-step bỏ chuỗi Safari→job-root→dispatcher→scheduler đã hoàn tất, giữ status boundary migration/runtime/enablement/E2E. |
| 25/07/2026 | v1.23 | **Full body reconcile sau review progress:** canonical suite hiện PASS 460 workspace + 13 validator tests; feature inventory 24/23; DD-70/71/72 owner-final và Notification pair Reviewed/no-runtime; stale D0a→D1 next-step bị thay bằng BE-only `db-job-claim-lease-core` packet → dispatcher/scheduler → Session vertical. DD-81 canonical path = root `design.pen`; FE giữ HOLD tới khi file được persist/track + owner nghiệm thu làm authority. |
| 25/07/2026 | v1.22 | **Current-state reconcile tại `main@2937ed9` (= `origin/main`).** Header refresh: authority → BRD v3.9g · PRD v2.8f · TDD v3.1a · ROADMAP **v3.4d** · decisions **v1.98** committed (DD-88 🟡 chưa commit); migrations `0000–0018`→**`0000–0021`** (22 file); ghi nhận **core đã có code DD-87** (`d2a27e1`) và bộ ba tenant-integrity FK `0019`–`0021` (expand-only, code dark). Sửa 2 claim stale: "D0a in-flight" → **cả lane D0a/D0b/D1/d1b đã merge**; decisions v1.88 → v1.98. Thêm 2 cảnh báo tiếp quản: **canonical runner chưa chạy lại từ `f93873b`** (số 419 là snapshot cũ) và **hàng đợi autopilot đang rỗng** (0 `ready`/`planned` sau khi flip 7 slice stale). Session Management: contract publish/draft-lifecycle đã đóng, code vẫn 0 — blocker kế tiếp là job-infra chung. Không đổi scope/DD/delivery order. |
| 24/07/2026 | v1.21 | **Migration-tail reconcile:** §6 auth-lane note `migrations 0000–0018` → **`0000–0020`** (`0019`/`0020` tenant-integrity composite FKs DD-68, 23/07/2026, ngoài auth lane `0015`–`0018`); Foundation `0000–0013` (§Identity/§6) giữ nguyên verbatim (anti-double-classify). Docs-only, không đổi contract. Chi tiết: `docs/autopilot-manifests/docs-migration-tail-0018-to-0020-sweep.json`. |
| 20/07/2026 | v1.20 | **Auth swap bước vào code + current refresh.** Authority → decisions v1.88 (DD-80 G3 revoke-all epoch contract + D0a/D0b decomposition); HEAD `main@172dfff`. B0 owner-duyệt→DD-80; provider swap re-slice D0a/D0b/D1, **D0a `auth-s4-d0-revoke-core` in-flight** (migration `0015`, code feature-layer đầu tiên, chưa merge). Thêm pointer `docs/auth/auth-s4-session-handoff.md`. Runtime baseline (migrations `0000–0013`) không đổi. |
| 19/07/2026 | v1.19 | **DD-79 ✅ Home hub (S9) + DD-81 ✅ Pencil:** cặp spec thứ 22 (Reviewed contract, composition-only trên player_view/marketplace/§A — không bảng mới); nav PWA 5 slot registry (Feed gated DD-76, 💬 chat header); design file mới `plexco-app-design.pen`. Mirror đã propagate BRD v3.9g/PRD v2.8f/TDD v3.1a/ROADMAP v3.3f/design-brief v1.9/BUILD-STATUS. Runtime không đổi. |
| 19/07/2026 | v1.19 | Current authority → decisions v1.65 / BRD v3.9e / PRD v2.8d / ROADMAP v3.3d; DD-73..78 sequencing correction ở v1.64. DD-74/75 tạo baseline; chỉ DD-76/77 evidence-gated; DD-78 đi cùng consumer. Không đổi runtime baseline. |
| 19/07/2026 | v1.18 | Authority → decisions **v1.60**. **DD-73..78 ✅ chốt (owner 19/07)**: 6 câu đều phương án (a); Q5 kèm re-scope đưa fence/guarded-view/grant migration về **DD-12**; **DD-64 amended** (self-aggregate). Sequencing wording của entry này được corrected ở v1.19; runtime baseline không đổi. |
| 19/07/2026 | v1.17 | Current authority → decisions v1.59/PRD v2.8c. DD-05/06/45/49 integrity closure pins approval re-derive, venue active-only, activation-time refunded lifecycle và bounded waitlist retry. Không migration/runtime mới. |
| 19/07/2026 | v1.16 | Authority → decisions v1.52. Consistency pass cụm DD-73..78: điều kiện render `/s/<id>` là **sự tồn tại row `public_sessions`** (không phải predicate `visibility`/`status` — check hai cột đó là buộc đọc `sessions`); tách `gender` người chơi khỏi `gender_restriction`; DD-73 phase **P4.3** theo DD-12; card ≠ profile field (không mở DD-48 item 1); revoke chốt 404. Founder-batch recheck còn surface DD-72 `trusted_at/trust_source` + reset-on-rebind, DD-71 component-wise vector rule và auth collision/rate-limit/KMS precision. Vẫn 🟡/design-gated ⇒ runtime baseline không đổi. |
| 18/07/2026 | v1.15 | Authority → decisions v1.51. Thêm pointer cụm **DD-73..78 🟡 đề xuất** + DD-78 default share image. Review correction cùng snapshot: Auth v2.10/v2.7 tách OAuth cross-site transaction/Lax binding khỏi Strict session/email flow; Notification v3.3 pin exact trusted route, dispatch-time roster và app-level vendor boundary. Chưa chốt/build ⇒ runtime baseline không đổi. |
| 18/07/2026 | v1.14 | Founder batch v1.47 propagation: DD-33 external gate/link-code fallback; DD-57..59 deferred references; DD-60 accepted; Session Organize v0.5 accepted-in-principle/no-runtime; DD-69 accepted direction. |
| 18/07/2026 | v1.13 | Authority → BRD v3.9c/PRD v2.8a/TDD v3.1/ROADMAP v3.3a/decisions v1.46; mirror DD-69 proposal boundaries: PWA planned-not-live, native phase-2 TBD, RN+Expo after spike, device push separate, offline read-only. Runtime baseline không đổi. |
| 17/07/2026 | v1.12 | Feature-doc closure → BRD v3.9b/PRD v2.8/TDD v3.1/ROADMAP v3.3; exact endpoint identity, SePay HMAC, DM safety/block source, Assistant DLP và Session Organize v0.4 được mirror; không claim code/migration. |
| 17/07/2026 | v1.11 | Authority → TDD v3.0/decisions v1.45. Generalize endpoint-scoped identity/reachability cho Messenger + Zalo; live schema/runtime gap và tenant-eligibility boundary được ghi rõ. |
| 17/07/2026 | v1.10 | Review-fix closure: authority → BRD v3.9a; DD-67 Page-scoped identity/reachability + one-route delivery đã propagate vào multi-tenant/identity/notification Product+BE contracts; runtime/migration vẫn pending. |
| 17/07/2026 | v1.9 | ROADMAP v3.2 propagation: hybrid Messenger milestone + delivery order; authority vẫn decisions v1.44. |
| 17/07/2026 | v1.8 | Authority → BRD 3.9/PRD 2.7/TDD 2.9/ROADMAP 3.2/decisions 1.44. Session Organize pair → v0.3 nhưng DD-61..64 vẫn proposal, phase TBD và chưa migration/service. |
| 17/07/2026 | v1.7 | Authority → BRD 3.8/PRD 2.6/TDD 2.8/ROADMAP 3.1/decisions 1.43. DD-65..68 Messenger hybrid contract + explicit live runtime/schema gap; host/player shared surface and one-route delivery. |
| 17/07/2026 | v1.6 | Authority → TDD v2.7 / ROADMAP v3.0 / decisions v1.42. Coverage → 22 Product/System + 21 BE; Session Organize v0.2 là cặp proposal, phase TBD/earliest after P4, chưa migration/service và không thay code readiness. |
| 16/07/2026 | v1.5 | Reconcile current authority decisions v1.39; DD-49..56 full contract propagation; DD-40 synthetic-transaction conflict removed; HR4/auth/chat/authz wording fail-closed; canonical local test DB = `plexco_test`; readiness names B0/B1/B2/B3 + correction/external/legal gates. |
| 13/07/2026 | v1.4 | Chốt source-of-truth theo topic; canonical store = PostgreSQL/domain model; web stack = Next.js App Router (DD-10); decisions v1.19; next auth step chưa launcher-ready. |
| 10/07/2026 | v1.3 | **Review fixes → build-status reality + canonical vocab.** §6 trạng thái: foundation + Auth v3 (Telegram-era) đã land trên `main@1eb6f60`, migrations `0000–0013` committed, web tests có; DD-37 supersede provider → Google/email spec'd nhưng chưa implement (bỏ "code chưa bắt đầu"). §2 vùng TENANT: `payments`/`webhook_transactions` → `charges`/`bank_transactions`/`payment_allocations` (canonical ledger). **DD-38/39 ✅ scope-committed phase-1** (top callout — schema chờ migration). decisions v1.16. |
| 10/07/2026 | v1.2 | **v3.4 Phase-1 pivot (DD-37 ✅):** bỏ Telegram; kênh phase-1 = web + Zalo + Facebook Messenger. Cập nhật §1/§2 (stack, apps/bot, projector fan-out), §3 HR3 (surface list), §7 doc map. Auth phase-1 = Google + email (DD-13 ✅) + link Facebook (DD-33 🟡) + Zalo (DD-14 ⬜). Thêm 4 feature phase-1: Google login · chat in-app (DD-38 🟡) · settings/giá theo giới tính (DD-39 🟡) · mark-paid thủ công (DD-40 ✅). |
| 02/07/2026 | v1.1 | Thêm bẫy "đọc canonical trước khi thiết kế schema" + mục Identity tra cứu (Person/Account/link_codes, DD-13/14/15); CLAUDE.md nay trỏ HANDOFF làm first-read |
| 19/06/2026 | — | Thêm Changelog table |
| 18/06/2026 | v1.0 | Handoff checklist per feature |
