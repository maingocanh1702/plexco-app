# BUILD-STATUS — Plexco (đã build vs. đã spec)

> **Mục đích:** ảnh chụp tiến độ *thực thi* so với khối tài liệu đã spec (Reviewed và Draft/proposal được ghi riêng). Trả lời gọn:
> "code đã có tới đâu, còn cách MVP bao xa". Đây là doc **living**, cập nhật mỗi khi một slice merge.
> **Cập nhật:** live-truth refresh **2026-09-19 tại `main@12f5191`** (gate chạy thật, ROADMAP v3.18) · trước đó **2026-09-15 tại `main@e235ea4`** — **một mốc** cho cả cấu trúc lẫn trục Tests, đo **trong cùng một lần chạy tại chính SHA đó**; xem block 🟦 15/09 ngay dưới. Mọi block cũ hơn (🟩 03/09 · 🔷 02/09 · …) là **lịch sử**, giữ nguyên văn.
> **Nguồn số liệu:** `git log`, cây `packages/`+`apps/`, `docs/features/*`, `docs/standards/decisions.md`,
> `docs/autopilot-backlog.md`. **Authority snapshot** = `784bc8dd297163a5ec5415f33beabbbf34bbc8d7` (= `origin/main` lúc verify 2026-07-28) — mọi con số trong header này đo **trên snapshot đó**, không phải trên HEAD hôm nay. Tại snapshot: migrations **`0000–0024`** (25 file): `0014` waitlist schema-only, auth `0015`–`0018`, tenant-integrity `0019`–`0021`, job lease/ack `0022`–`0023`, public-capacity CHECK `0024`. Hai commit sau `2dc9b8c` chỉ là Chat authority/readiness docs. Slice `db-migration-0000-idempotent-role-create` **không thêm migration nào** — nó sửa migration runner.
> **🟩 LIVE TRUTH 2026-09-19 tại `main` = `12f5191` (trước `origin/main` = `00cc510` 3 commit docs/tools; mã nguồn giống hệt) — ĐỌC BLOCK NÀY TRƯỚC MỌI BLOCK KHÁC. Mirror của `../product/ROADMAP.md` **v3.18** §📍 và `../00-start-here/HANDOFF.md` v1.43.**
> **+38 commit / 14 PR (#14–#27) từ `e235ea4` (15/09), TẤT CẢ là hardening + kit.** Đợt `codebase-fixes-2026-09-16` (12 PR) + `ap3-intake` session-management + kit ap3 W5.2.6/W6. **Không một ô ma trận nào đổi; 0 hành vi product mới.**
> **(1) Migration tail `0044` → `0046` (47 file):** `0045` `guest_note_tenant_context` (guarded tenant context) · `0046` `rate_limit_bounded_cleanup` (bound cho cleanup rate-limit hết hạn). Cả hai **siết chặt hành vi đã land**.
> **(2) Lớp feature nghiệp vụ: KHÔNG đổi.** Vẫn **8 command** (`packages/db/src/session-service.ts`, 2910 dòng) và **7 route nghiệp vụ**; vẫn **0 route ĐỌC**, vẫn **0 màn FE**.
> **(3) ⚠️ HAI THANG ĐO — cấm cộng im lặng.** **Workspace (vitest, 59 file): `1823`** — core **199** (11) · db **858** (15) · web **643** (26) · bot **123** (7). **Readiness/kit (`node --test`, 4 file): `# pass 172`.** 🔴 Metric lớp readiness đã đổi thành phần: plan `1..130` vs `# pass 172` (ở `0aff7ad` hai số khớp) ⇒ `128 → 172` không đọc thành "44 test mới".
> **(4) Provenance — CHẠY LẠI THẬT, không carry.** Mac, `git worktree` tách rời tại `12f5191`, `pnpm install --frozen-lockfile`, `NODE_ENV=test`, Postgres `docker plexco-postgres-1`, `DATABASE_URL_TEST=postgres://plexco:plexco_dev@localhost:5432/plexco_test`; `pnpm test` exit 0 (94 s) · typecheck · lint · format:check · review:check · build đều exit 0 · tree sạch sau suite. **Cluster phải dọn TRƯỚC VÀ SAU khi đo** — 14 db `plexco_*` sót đã làm hỏng lần đo 15/09 và suite vẫn để lại 15 db sau mỗi lần chạy.
> **(5) 🔴 Luật 4 KHÔNG còn đóng ở lớp nào.** Static tại `12f5191` = **1376** (core 161 · db 780 · web 353 · bot 82); readiness static **110**. Core và bot từng đóng ở `e235ea4` nay đã có generator mới chưa kiểm kê. Phần dư **không được viết như hiệu**.
> **(6) Code-dark còn lại, không đổi:** `resolveCapability()` 0 caller production ⇒ hard-dep (a) của DD-114 vẫn mở · `identity.ts` (`0043`) 0 caller production · `chat_*` 0 service · projector vẫn là `productionStubDeliver` ⇒ schedule OFF.
> **(7) ✅ Decision đã ký 19/09 — DD-56 amendment #3 (`decisions.md` v2.51):** cổng tạm phủ **BẢY** route, hai route guest-note được liệt kê tường minh; bề mặt cưỡng chế không rộng thêm (đo tại `4d275f7`). Void cùng amendment #1/#2 khi `tenant-capability-authority-core` land.
> **(8) 🔴 Hàng đợi ap3 rỗng — 0 task dispatchable.** `feature-session-p2` `clean_runs 0`. Nạp lại cần owner sửa `ap3/routines.json`.
> **(9) 🔧 `pnpm progress`** (`tools/progress.mjs`) đo lại mọi số cấu trúc ở block này tại một ref có tên và kiểm điều kiện carry của pin — dùng nó trước khi trích số đi đâu khác.
>
> **🟦 LIVE TRUTH 2026-09-15 tại `main` = `origin/main` = `e235ea4` — ĐỌC BLOCK NÀY TRƯỚC MỌI BLOCK KHÁC. Mirror của `../product/ROADMAP.md` **v3.17** §📍 và `../00-start-here/HANDOFF.md` **v1.42**; ba file phải đọc cùng số.**
> **+87 commit từ `0aff7ad` (04/09).** Việc lớn nhất: **bundle audit v6 đã merge** (A1–A8 · B1–B5 · C1–C5) ⇒ mọi câu "CHƯA merge" trong các block cũ và trong `docs/sessions/2026-09-06-repo-audit.md` **đã hết đúng**.
> **(1) Migration tail `0036` → `0044` (45 file):** `0037` `tenant_provision` tự scope RLS · `0038` subscriptions đọc qua definer · `0039` audit hardening (definer `search_path`/tenant assert · ledger aggregate FK · link_codes DD-50) · `0040` idle TTL web session (`last_seen_at`, áp ở **cả** resolve **lẫn** rotate) · `0041` `job_worker_heartbeats` · `0042` DROP `auth_login_telegram` + **trigger** chặn row telegram · `0043` link_code issue/consume · `0044` `session_guest_notes` (+ `sessions.allow_player_invite`, `players.invited_by_person_id`, trigger trần 3 note/session).
> **(2) Lớp feature nghiệp vụ: 6 → 8 command.** `packages/db/src/session-service.ts` (2913 dòng) export thêm `createGuestNote` · `deleteGuestNote`. **Route nghiệp vụ 5 → 7** (`POST /[id]/guest-notes`, `DELETE /[id]/guest-notes/[noteId]`). Tổng API route vẫn **15** vì A3 gỡ 2 route Telegram ⇒ **6 auth + 2 onboarding + 7 nghiệp vụ**.
> **(3) ⚠️ HAI THANG ĐO — cấm cộng im lặng.** **Workspace (vitest, 54 file): `1490`** — core **163** (11 file) · db **800** (15) · web **468** (24) · bot **59** (4). **Readiness/kit (`node --test`, 4 file `scripts/*.test.mjs`): `128`** (`# pass 128 · # fail 0`).
> **(4) Provenance — CHẠY LẠI THẬT, không carry.** Mac, `git worktree` tách rời tại `e235ea4`, `pnpm install --frozen-lockfile`, `NODE_ENV=test`, Postgres `docker plexco-postgres-1`, `DATABASE_URL_TEST=postgres://plexco:plexco_dev@localhost:5432/plexco_test`: `pnpm -w test` **exit 0** · `pnpm typecheck` **4/4 Done** · `eslint .` **sạch** · `next build` **OK** · `git status --porcelain --untracked-files=all` **rỗng** sau suite. Điều kiện hết hạn viết bằng lệnh: `git diff --name-only e235ea4..main -- packages apps scripts` **không còn rỗng** ⇒ đo lại, **không cộng tay**.
> **(5) 🟡 Luật 4 đóng MỘT PHẦN.** Static tại `e235ea4` = **1308** (core 157 · db 761 · web 331 · bot 59). Đóng độc lập ở **core** (`157 + 6 = 163`) · **bot** (`59 + 0 = 59`) · **readiness** (`108 + 20 = 128`). **db và web chưa đóng** — bảng kiểm kê generator phải dựng **tay**; phần dư **không được viết như hiệu**. Điều này **không** làm trục Tests `STALE`: runner là authority và chạy tại chính SHA đang pin.
> **(6) Code-dark còn lại, đo chứ không suy:** `resolveCapability()` **0 caller production** ⇒ hard-dep (a) của DD-114 vẫn mở · `identity.ts` (`0043`) **0 caller production**, `LINK_CODE_LOOKUP_HMAC_KEY` chưa đặt · Chat `chat_*` **0 service**.
> **(7) 🔴 Một decision còn thiếu (owner quyết):** cổng tạm DD-56 nay phủ **BẢY** route (2 route guest-note đi qua `lib/session-command-route.ts`) trong khi **amendment #2 pin NĂM** — OPEN NOTE 15/09 đã ghi dưới DD-56 trong `decisions.md` v2.49.
> **Không đổi:** **0 màn FE** (đúng 1 `apps/web/app/page.tsx`; FE PENDING theo DD-116, DD-119 vẫn 🟡 chưa ratify, `.pen` untracked có chủ ý) · ~~schedule **OFF** (`OUTBOX_DISPATCH_SCHEDULE_ENABLED=false`)~~ ⛔ **HẾT HIỆU LỰC 21/10 (DD-141)** — default commit nay `OUTBOX_DISPATCH_SCHEDULE_ENABLED=true` (`.env.example`); chỉ đúng chuỗi `"true"` mới bật; registry seed 0056 tắt mọi projector nên chu kỳ dispatch chạy mà không deliver gì · projector production vẫn `productionStubDeliver` · thanh **~33%** · không DD nào đổi trạng thái.
>
> **🟩 LIVE TRUTH 2026-09-03 — TRỤC TESTS HẾT `STALE`. Với mọi phát biểu về số test, đọc block này TRƯỚC block 🔷 02/09.** Mirror `../product/ROADMAP.md` **v3.14** (khối 🟩 03/09) — **hai file phải đọc cùng số**; nếu lệch, ROADMAP §Cách đọc tiến độ là nơi có bảng kiểm kê, file này chỉ mirror.
> **Không chạy lại suite.** Phép đo đã tồn tại kèm provenance, sinh từ gate của lane `gates-that-fire--migrate-p17-cause`:
> `.autopilot/state-archive/gates-that-fire-correctly-and-cannot-say-why--migrate-p17-cause-20260903T060118Z/state/gate-attempt-01-verify-canonical-04.txt` — `command:` dòng 3 (`DATABASE_URL_TEST=… pnpm test`) · `head_sha: 18c75d82…` dòng 5 · `exit_status: 0` dòng 6.
> **(1) ⚠️ HAI THANG ĐO — cấm cộng im lặng.** **Workspace (vitest, 46 file dưới `packages`+`apps`): `1234`** — core **153** (11 file) · db **710** (12) · web **331** (19) · bot **40** (4); artifact dòng 560–561 · 638–639 · 669–670 · 716–717. **Readiness/kit (`node --test`, đúng 3 file `scripts/*.test.mjs`): `85`** (`# pass 85` · `# fail 0` · `# suites 0`); artifact dòng 536–543. Hai tập file rời nhau ⇒ chuỗi historical giữ **workspace-only**.
> **(2) Điều kiện carry ghi bằng LỆNH, không bằng SHA** (`main` di chuyển): `git diff --name-only 18c75d8..main -- packages apps` → **rỗng** và `… -- scripts` → **rỗng** ⇒ cả hai mốc mang sang `main` hợp lệ. Đặt cạnh ca hỏng hồi 02/09: cùng lệnh, `80a3464..620b2bd -- packages apps` trả **34 file** ⇒ mốc `813` **không** được mang, phải khai `STALE`. Cùng một luật, hai kết cục — đó mới là thứ phải đọc.
> **(3) ✅ Luật 4 ĐÓNG:** static đo lại tại `18c75d8` = **1097** (core 147 · db **680** · web 230 · bot 40) — `+2` so với `1095 @620b2bd` là test của chính lane P17. `1097 + 137 = 1234`, **đóng độc lập từng package** (4 checksum rời nhau). `137` **không phải** hiệu `1234−1097` mà là tổng kiểm kê hai lớp: **17 site `it.each` (`+100`)** + **9 loop-site (`+37`)**, đếm theo độ sâu ngoặc. Lớp readiness đóng cùng công thức trên thang riêng: `65 + 20 = 85`.
> **(4) Authority trục Tests chuyển** `854 workspace + 30 validator @ 93f1e93` (15/08) → **`1234 workspace + 85 readiness/kit @ 2648965`**. Chuỗi workspace: … → 670 → 813 → 854 → **1234**. Chuỗi readiness: 13 → 17 → 30 → **85**.
> **(5) MỘT mốc cho cả file, không phải hai.** `18c75d8 ≡ 2648965` về mã, nên số cấu trúc pin cùng chỗ với Tests. Đo lại tại `2648965` cho **y hệt** block 🔷 02/09: migration **37** · test file **46** · route **13** · spec **27+27** · FE design **17** · `.each` **17 hit**; chỉ **static 1095 → 1097** (db 678 → 680) vì đúng 2 test của lane P17. Toàn bộ delta `620b2bd..2648965` là **2 file**, cả hai của lane đó.
> **(6) 🔵 Số này có HẠN DÙNG — đừng đọc như số vĩnh viễn.** Lane `test-harness-chat-definer-lock-client-leak--v2` **chưa merge**, tự đo `db 716` (708 baseline + 2 sibling + 6 của nó) so với **710** đang pin. Luật 1: chưa trên `main` thì **không cộng vào trục nào** — `1234` vẫn đúng *tại `2648965`*. Khi lane land, mốc hết hạn: phải **đo lại** static + runner + kiểm kê generator **cùng lúc**, **cấm cộng tay `+6`**. `716` là **dự đoán để đối chiếu, không phải số khai**.
> **Không đổi:** giá trị cấu trúc (chỉ *mốc* dời `620b2bd` → `2648965`) · 0 màn FE · schedule OFF · thanh **~33%** · không DD nào đổi trạng thái. Pass **đo**, không phải pass quyết định.
>
> **🔷 LIVE TRUTH 2026-09-02, `main` = `620b2bd`, **ahead 1** so với `origin/main` (`620b2bd` chưa push). Đọc block này TRƯỚC mọi block khác; mọi block dưới đây là lịch sử.** *(⚠️ Riêng trục Tests: block 🟩 03/09 ở trên thay thế — mục (5) và "Việc mở" của block này đã hết hiệu lực.)*
> **+48 commit từ `1215a6a` (25/08), commit cuối 30/08.** Mirror của `../product/ROADMAP.md` **v3.13** (khối 🔷 02/09) — hai file phải đọc cùng số.
> **(1) Migration tail `0033` → `0036` (37 file):** `0034` identity-account-link resolver (DD-32 tiền đề #1) · `0035` `tenant_locale_reader` (DD-118) · `0036` REVOKE nốt `app` INSERT/UPDATE/DELETE trên `public_sessions` (`f408693`) — phần sót từ `0009` mà `0033` mới đóng vế SELECT. Sau `0036`, `app` **không còn quyền nào** trên bảng gốc `public_sessions`. Thuần security-hardening, đo **inert** lúc land. ⚠️ Ràng buộc cũ giữ nguyên: **projector tương lai phải đi qua definer fn / writer role riêng — CẤM re-grant `app` base SELECT.**
> **(2) Hàng "Code — lớp feature nghiệp vụ" nay có đủ họ lệnh.** `packages/db/src/session-service.ts` (2232 dòng) export **sáu** command: `createSession` · `publishSession` · `announceSession` · `updateSession` · `closeSession` · `cancelSession`.
> **(3) ⚠️ "0 route nghiệp vụ" HẾT ĐÚNG — sửa phát biểu của block 25/08 và 14/08.** `770ff4b` (26/08) land 3 route: `POST /api/sessions` · `/api/sessions/[id]` · `/api/sessions/[id]/publish`, kèm DD-56 lint guard. Route tổng **13** (8 auth + 2 onboarding + 3 nghiệp vụ). **Thiếu route cho `close`/`cancel`/`announce`** — announce bị gate DD-56 clause 1 (bật schedule = biến `{announced:true}` thành lời hứa với người dùng thật), **không phải bỏ sót**.
> **(4) Decisions:** DD-114 D3 ✅ phương án (b) (`3045c7f`, 26/08) · DD-112 ✅ capacity không phải nhánh tiền (`3fed215`, 27/08) · DD-118 ✅ `tenants.locale` là nguồn ngôn ngữ duy nhất (`cec62c6`, 26/08).
> **(5) 🔴 Trục Tests = `STALE`** — ✅ **ĐÃ GỠ 03/09, đọc block 🟩 ở trên; đoạn dưới giữ nguyên văn làm lịch sử của việc nó được đóng bằng gì.** Runner **không chạy được** ở pass 02/09 (môi trường đo không có `pnpm`/Postgres). Mốc `813 @ 80a3464` **không được mang sang**: `git diff --name-only 80a3464..620b2bd -- packages apps` trả **34 file** ⇒ điều kiện code-identical vỡ. **Authority vẫn là 854 workspace + 30 validator @ `93f1e93` (15/08)** — chưa re-pin kể từ đó. Phép đo informal **919** sau `9da3021` không phải authority và cũng đã stale thêm 4 merge. Số đo được: test file **46** · static **1095** (core 147 · db 678 · web 230 · bot 40) — static là **tín hiệu drift**, và ở snapshot này nó under-count nặng hơn trước vì generator `it.each`/`test.each` đi từ **2 lên 17 hit**.
> **(6) Code-dark còn lại, đo chứ không suy:** `resolveCapability()` (`capability.ts`) **0 caller production** ⇒ hard-dep (a) của DD-114 (billing P5 vào phase-1) **vẫn nửa đường**; `chat_*` vẫn 0 service; `identity-account-link` internal-only chưa có port nào gọi; DD-118 `runWithLang` mới phủ đường session-command. `authorizeTenantAction` thì **hết dark** từ `1ccbe5d`.
> **Không đổi:** **0 màn FE** (đúng 1 `apps/web/app/page.tsx`; FE PENDING theo DD-116, `.pen` vẫn untracked có chủ ý) · ~~schedule OFF (`OUTBOX_DISPATCH_SCHEDULE_ENABLED=false`)~~ ⛔ **HẾT HIỆU LỰC 21/10 (DD-141)** — default commit nay `OUTBOX_DISPATCH_SCHEDULE_ENABLED=true` (`.env.example`); chỉ đúng chuỗi `"true"` mới bật; registry seed 0056 tắt mọi projector nên chu kỳ dispatch chạy mà không deliver gì · chưa projector thật · thanh **~33%** — luật 5, trục yếu nhất quyết. Cái đổi tháng này là *buildable*, chưa phải *runnable*.
> ~~**Việc mở:** runner re-pin (máy owner) là thứ duy nhất gỡ được nhãn `STALE`; push `620b2bd` rồi đọc GitHub Actions runs.~~ ✅ **ĐÓNG 03/09** — re-pin lấy từ gate artifact của lane P17 (`18c75d8`), không cần chạy lại suite; xem block 🟩 03/09.
>
> **🟢 LIVE TRUTH 2026-08-25, `main` = `origin/main` = `1215a6a` — historical, bị block 🔷 02/09 ở trên thay thế.**
> **+17 commit từ pin `a151b15` (21/08): 15 docs + 2 BE merge chạm `packages/db/`.** Hai merge đúng là hai hard dependency phase-1 mà DD-114 gọi tên:
> **(a) DD-29 capability resolver `f2af39d`** — `packages/db/src/capability.ts`, export `resolveCapability()`: **reader production ĐẦU TIÊN của capability registry** (câu "0 TS đọc `entitlements`" hết đúng sau 18 ngày code-dark), fail-closed, `FOR SHARE` trên `subscriptions` (pin cặp `plan_key, plan_version`; `plans` read-only theo `0009` nên KHÔNG lock được và không cần), prototype-safe. ⚠️ **Resolver tự nó vẫn code-dark: 0 caller** — wiring thuộc slice auto-reconcile (DD-114 D2.3), ghi trong commit body. Hard-dep (a) đi được **nửa đường**: registry hết dark, đường tiền vẫn chưa gate được thật.
> **(b) `public_projection_fences` `9da3021` (DD-12 8a)** — migration **`0033`** (tail mới, **34 file**): bảng fence GLOBAL PROTECTED denial-only (PK `surface,target_kind,target_id`) + guarded view **`public_session_share_v`** (`security_barrier`) + `raise_public_session_fence` (EXECUTE→`app`) + `current_public_session_fence_token`/`clear_public_session_fence` CAS-clear exact-token (EXECUTE→`app_worker`) + **REVOKE base SELECT `public_sessions` khỏi CẢ `readonly` LẪN `app`** ⇒ immediate-deny là **structural**, không phụ thuộc projector async. **Hard-dep (b) của DD-114 ĐÃ ĐÓNG** — toggle public/private hết blocker hạ tầng; hai chặn còn lại đều ngoài DB: FE PENDING (DD-116) + OQ "public để làm gì" (DD-114 D3). ⚠️ **Projector tương lai PHẢI đi qua definer fn / writer role riêng — CẤM re-grant `app` base SELECT** (làm thế là mở lại đúng lỗ `0033` vừa đóng).
> **Decisions 22–25/08: v2.37 → v2.42.** DD-115 ✅ D1–D5 (D6–D8 ⬜ — blocker cứng trước build) · DD-116 ✅ Option B — FE PENDING nay có **nguồn bền trong decision log** + named trigger 3 vế (chọn 1 `.pen` canonical · tracked trên `main` · owner ký gate DD-81) · DD-117 ✅ close/cancel nhánh paid/retry-root = **fail-closed refuse** (thay deferral 14/08) + **D5: cả họ session command dedup CHỈ trên `(tenant_id, command_id)` — content fingerprint BỊ BÁC** · 2 amendment DD-50 (25/08): pay-later predicate = verified email; identity resolver = SECURITY DEFINER function-only. Bảng tổng hợp đã backfill DD-110/111/112 (v2.42).
> **A3 legal khởi động:** starter packet `a49bf96` — `docs/legal/` 2 file DRAFT (PII data-class matrix + lawyer engagement brief). Bước kế là của **owner, ngoài repo**: gửi luật sư VN; lead-time A3 chỉ bắt đầu tính từ lúc gửi.
> **Trục Tests:** suite trên `main` sau merge `9da3021` (gate ap-merge, máy owner): validator **30** + workspace **919** (core 152 · db **581** · web 146 · bot 40) — **informal**, đúng luật hai thang đo. ⚠️ **Số authority VẪN là 854 workspace + 30 validator @ `93f1e93` (15/08)** — canonical runner chưa re-pin; việc đó là bước 1 của phiên P4 trong `next-lanes-2026-08-24-RUN.md`.
> **🔵 In-flight, CHƯA trên `main`:** successor **Slice A** `session-command-update-v3` (`2ac1f56`, round 3) — `UpdateSession` + **caller đầu tiên của fence functions** (`public-session-fence.ts`), đã bỏ content fingerprint theo DD-117 D5; lane cũ HALT MAX_ROUNDS round 6, đóng authorized-close, successor pre-authorized §6.1. Lane `identity-account-link-core` authored (`94861a0`) — mang migration **`0034` trên lane, KHÔNG phải tail của `main`**. Sau Slice A còn Slice B (Close+Cancel).
> **Không đổi:** **0 route nghiệp vụ · 0 màn FE** (FE PENDING theo DD-116) · schedule OFF · delivery stub fail-closed · thanh **~33%** — hai merge tuần này là hạ tầng/thư viện, chưa phải hành vi product; luật 5 (trục yếu nhất thắng) giữ nguyên thanh. Hàng đợi: **P6 → P5 → P4** theo `next-lanes-2026-08-24-RUN.md`. Mirror: `../product/ROADMAP.md` **v3.10** · `../00-start-here/HANDOFF.md` **v1.39**.
>
> **🟢 LIVE TRUTH 2026-08-14, `main` = `origin/main` = `93f1e93` — historical, bị block 25/08 ở trên thay thế.**
> **Hàng "Code — lớp feature nghiệp vụ" đổi từ ⬜ sang có nội dung lần đầu.** `packages/db/src/session-service.ts`
> nay có **hai command**: `createSession` (`b48625c`) và `publishSession` (`1ccbe5d`), cùng **cặp outbox
> producer có thứ tự đầu tiên** trên một aggregate (`session.created` seq 1 → `session.published` seq 2).
> **`authorizeTenantAction` hết code-dark** — `publishSession` là caller production đầu tiên sau 8 ngày.
> ⚠️ **Thanh ~33% KHÔNG đổi.** Trục yếu nhất vẫn quyết: **0 route nghiệp vụ · 0 màn FE · schedule OFF ·
> chưa projector thật**. Hai command chưa có surface nào gọi được từ ngoài — *buildable*, không *runnable*.
> **Số đo:** 33 migration · 38 test file · **static 813** (core 146 · db **490** · web 137 · bot 40) · 10 route.
> ✅ **Canonical runner 15/08: PASS `854` workspace** (core 152 · db 516 · web 146 · bot 40) **+ 30 validator**,
> 0 fail — số authority cho trục Tests. Luật 4 đóng khít từng package: `813 + 41 = 854`.
> ⚠️ Static 813 **trùng số** runner 813 đo tại `80a3464` là **ngẫu nhiên**, hai đại lượng khác nhau; runner
> thật nay là **854**. Tiền lệ: static bằng đúng một runner cũ = lúc dễ suy bậy nhất.
> **Code-dark còn lại: hai, không phải ba** — DD-29 entitlements (0 reader) và `chat_definer` bootstrap.
> Mirror: `../product/ROADMAP.md` · `../00-start-here/HANDOFF.md` v1.34.
>
> **🔴 LIVE TRUTH 2026-08-13, `main` = `1fdba1d` — historical, bị block 14/08 ở trên thay thế.** Delta so với block 07/08 (nay historical):
> **(a) Migration tail `0029` → `0032` (30 → 33 file), +60 commit từ `64e9ccb`.** `0030` (`d5b31f9`, 10/08) DM-safety authority DD-55 — `chat_dm_safety_config`/`chat_blocks`/`chat_reports` + `assert_dm_allowed`, **global-protected plane**: `app`/`app_worker`/`readonly` zero grant thuộc mọi loại, chứng minh bằng catalog (`has_table_privilege` × 3 role × 3 bảng × 7 privilege) chứ không chỉ bằng live-attempt. `0031` (`3b3bb09`, 11/08) **chat schema core DD-38/86** — `chat_channels`/`chat_members`/`chat_messages`. `0032` (`80a3464`, 12/08) DD-102 — gộp 4 lần đọc config của `assert_dm_allowed` thành 1, đóng torn read; hành vi từng nhánh giữ nguyên.
> **(b) ⚠️ `0031` KHÔNG làm Chat runnable — đây là chỗ dễ đọc nhầm nhất tháng này.** Tên bảng có rồi nhưng **0 câu truy vấn production nào chạm `chat_*`**: `packages/db/schema.ts` có khai báo Drizzle (khai báo ≠ phép đo) và 4 file test tham chiếu. Chat vẫn **0 service · 0 API · 0 UI**. Đây là **code dark thứ tư**, cùng lớp `authorizeTenantAction` · DD-29 entitlements · outbox schedule OFF.
> **(c) Trục Tests — workspace `670` → `813`, và phải đọc đúng phạm vi.** **813 là số WORKSPACE (vitest), KHÔNG gồm lớp validator**, đo tại `80a3464` (12/08, máy owner). ⚠️ Mốc trước ở block 07/08 ghi **683**, nhưng chính block đó định nghĩa 683 = `13 validator + core 138 · db 346 · web 146 · bot 40` = **13 + 670** ⇒ so workspace-với-workspace là **670 → 813**, so full-run là 683 → 830. Đừng trộn hai thang đo. Đối chiếu static đóng chính xác: `772 + 41 generated = 813` (core 152 · db 475 · web 146 · bot 40). **Validator 13 → 17 qua hai commit**: `b53bc75` (+2, kèm wire vào `test:review-readiness`) và `2d5834b` (+2, chỉ sửa file test) ⇒ full-run kế kỳ vọng **830** (dự đoán, không khai). Test files 35 → **37**; static @`1fdba1d` = **772** (core 146 · db 449 · web 137 · bot 40). Được mang 813 sang `1fdba1d` vì **24 commit sau `80a3464` không chạm `packages/`|`apps/`**. ⚠️ **Static có 2 điểm mù mới, cả hai từ `chat-dm-safety-invariants.test.ts`:** `it.each(...)` cho **0 hit** với grep hiện hành, và `it()` ở thân vòng **ngoài** của loop lồng lọt khỏi cửa sổ `grep -A`. Kiểm kê generator phải đếm theo **độ sâu ngoặc**, không theo cửa sổ dòng.
> **(d) Invariant 3 → 5 file:** thêm `chat-dm-safety-invariants.test.ts` (merged `d5b31f9`) + `chat-schema-invariants.test.ts`. *(`ROADMAP.md` v3.4o từng ghi file đầu "chỉ tồn tại trên lane branch chưa merge" — nay sai và đã sửa ở v3.5; block 07/08 của chính file này không khai điều đó.)* **Invariant ✅ không kéo BE lên** — chúng chứng minh bảng/quyền đúng, không chứng minh có ai gọi.
> **(e) 🔵 Việc đang bay, CHƯA trên `main`:** `session-service-create-command-core` — **slice nghiệp vụ đầu tiên của cả project**. Lane v1 `HALT MAX_ROUNDS` (advisory lock khoá theo command type vs ledger unique `(tenant_id, command_id)` ⇒ raw `23505` thay vì `COMMAND_ID_CONFLICT`); owner chọn option A, successor branch `feat/session-service-create-command-core--v2` có `packages/db/src/session-service.ts` + test + barrel (3 file). **Chưa merge ⇒ hàng "Code — lớp feature nghiệp vụ" và thanh ~33% không đổi.** ⛔ **Không pin SHA/LOC ở đây** — lane amend liên tục, hai SHA từng chép vào doc đã thành orphan trong một buổi; đọc `git log --oneline feat/session-service-create-command-core--v2`.
> **(f) CI infra-block 06/08 ĐÃ HẾT:** Security/OSV full-scan **GREEN trên main** (`9a5c709`, 11/08); merge `0030`–`0032` qua ap-finish gate sạch. Chưa re-verify từng workflow ⇒ **chưa khai được full-matrix xanh**.
> **(g) Decisions v2.19 → v2.28:** DD-100/101 process · DD-102 nghĩa vụ **đã đóng** bằng `0032` · DD-103 chấp nhận gap Person-merge re-parent có ràng buộc cứng · DD-104 D0–D4 DeleteSession decision-level (slice **DEFERRED**) · **DD-105 suspension gate `CreateSession` — miễn theo TÍNH VÔ HÌNH của draft, không phải "mutation nhỏ"**. Docs reorg `features/FE|BE` (`2e577c7`) + A-grade 49 spec (`8af9601`); spec **26 Product + 25 BE** + 17 FE spec `docs/channels/web/FE/` (Draft).
> **(h) 🔴 FE: HOLD → PENDING theo lệnh owner 13/08** — đổi bản chất chứ không phải mức độ. DD-81/M0.3/M4 và mọi việc FE treo lại; `design.pen`/`fe.pen` untracked **có chủ ý**; `git add` chúng là đi ngược lệnh owner.
> **Không đổi:** API route **10** (0 nghiệp vụ) · **0 màn FE** · thanh **~33%** · kit v31 · `slice-readiness-verdicts.md` dừng ở Verdict 31 (verdict mới sống trong packet `docs/autopilot/contracts/`). Mirror: `../product/ROADMAP.md` **v3.5** · `../00-start-here/HANDOFF.md` **v1.33**.
>
> **🔴 LIVE TRUTH 2026-08-07, `main` = `origin/main` = `64e9ccb` — historical, bị block 13/08 ở trên thay thế.** Delta so với block 06/08 (bên dưới, nay historical): **(a) Core code mới:** `528540e` land `packages/core/src/api-contract.ts` (envelope types + 11-code `API_ERROR_CODES`, `err()` narrow sang `ApiErrorCode`) + root scripts `test:core|db|web|bot`/`check:quick`/`smoke:predeploy`; `5b2b8f5` land `packages/core/src/app-error.ts` (sealed `toAppError` fail-closed + 14 tests) — cả hai là **FE-foundation code**, không mở route/màn nào. **(b) Trục Tests hết STALE:** canonical runner PASS **683** (13 validator + core 138 · db 346 · web 146 · bot 40, 34 file) đo 2026-08-07 tại `528540e` trên máy owner (điều kiện: dọn DB mồ côi `plexco_chat_dm_safety_check` + 3 function `dm_safety_*` khỏi cluster local trước). `5b2b8f5` sau đó thêm 14 core tests: per-package core **152/152** · web **146/146** (máy owner); **full-suite sau `528540e` chưa chạy lại** ⇒ số khai trục Tests = **683**; test files **35**; static cross-check @`64e9ccb` = **669** (core 146 · db 346 · web 137 · bot 40 — drift signal, không phải số test). **(c) Decisions v2.19:** `64e9ccb` chốt batch DD-96..99 (DD-96 Part A `SelfPaymentSummary` contract shape · DD-97 statement/export direction + entitlement free/`host_pro` · DD-98 negative scope NP-1..5 · DD-99 FE-spec hardening P1 + backlog P2→P4→P3) + 12 FE spec +4 section (vẫn Draft) + 5 research + 1 proposal. **(d) ⛔ CI infra-blocked từ 2026-08-06** ("job not acquired by hosted Runner", nghi hết phút Actions): mitigation `4cc574c` (linear-sync cron `*/10`→6h + timeout/concurrency) đã land nhưng **chưa có run xanh xác nhận** — mọi gate dựa CI đứng yên, CI đỏ giai đoạn này ≠ lỗi code. **(e) Lane đỗ chờ:** `feat/chat-dm-safety-authority-core--v2` @ `31bd4d9` implement xong + verification sạch, chờ codex quota final review (worktree `.autopilot/worktrees/chat-dm-safety-authority-core--v2` — **không** `git worktree prune`). **(f)** `design.pen` + `fe.pen` cùng untracked — DD-81 canonical chưa chọn ⇒ FE vẫn HOLD. **Không đổi:** migration tail `0029` (30 file) · API route 10 (0 nghiệp vụ) · 0 màn FE · ~33%.
>
> **🔴 LIVE TRUTH 2026-08-06, `main` = `origin/main` = `2cd52ce` — historical, bị block 07/08 ở trên thay thế.** Header bên trên pin ở `784bc8d` (28/07) — **đừng đọc nó như trạng thái hôm nay.** **88 commit** đã land từ `3d75c90` tới đây (`git rev-list --count 3d75c90..2cd52ce`; `--first-parent`/`--no-merges` cũng 88). Cái đổi:
> **(1) Migration tail `0025` → `0029`, 26 → 30 file.** `0026` (`89e074b`) rename 6 CHECK sống-mà-không-khai — RENAME-only, phần `0025` cố ý loại ra; `0027` (`432ba11`) `resolve_tenant_status_locked` SECURITY DEFINER **read-only vĩnh viễn** theo khuôn `0012`, tồn tại vì `SELECT … FOR SHARE` đòi quyền UPDATE mà cấp UPDATE thẳng trên `tenants` sẽ mở lại đúng write-path mà slice trước vừa đóng; `0028`/`0029` (`f901626`) là cặp **expand→contract DD-29**: `plans.plan_key` 4-tier → 2-tier `free|host_pro`, `entitlements` sang shape lồng `{"capabilities": {...}}`, reseed, repoint `tenant_provision()` và mọi subscription `free_web` — subscription còn ở tier cũ làm **abort cả transaction**, không repoint im lặng.
> **(2) Code merge ngoài migration:** `authorizeTenantAction` (`ddb69a9`, `packages/db/src/authorization.ts`) — resolver trạng thái tenant fail-closed 2 bước, **zero production caller**, mới chỉ re-export ở `index.ts`; role `chat_definer` provision bằng bootstrap script chứ không bằng migration (`286f48b`, `infra/postgres-init/02-chat-definer.sql`); definer bootstrap serialize cluster-wide bằng khoá 2 tầng, **fail-open có chủ đích** dưới managed Postgres (`b55d628`).
> **(3) Deps/security:** `next` 15.5.21 (`61a2575`) · ESLint 9→**10.7.0** trước EOL (`a93a4f6`) · sàn `esbuild` khai-mà-không-áp-dụng nay áp thật, đóng GHSA-67mh-4wv8-2f99 (`62304b5`).
> **(4) Trục Tests = `STALE`.** Canonical runner **chưa chạy lại** kể từ `3d75c90` (561 workspace + 13 validator). Static cross-check tại `2cd52ce` = **655** (core 132 · db **346** · web 137 · bot 40), 33 test file — tăng 528→655 toàn bộ ở `packages/db`. Static là tín hiệu drift, **không** phải số test.
> **Cái KHÔNG đổi:** API route vẫn **10** (8 auth + 2 onboarding), **0 route nghiệp vụ**; FE vẫn **0 màn**; Chat vẫn **0 migration/API/UI**; thanh **~33%** không đổi vì không slice nào mở producer/projector/service/route/FE. Đúng một sắc thái mới đáng ghi: `0028`/`0029` là **migration đầu tiên chạm một hàm đang có caller runtime** (`tenant_provision()` tại `packages/db/src/auth.ts:212`) — nhưng chưa TS nào đọc `entitlements`/`capabilities`, nên vẫn chưa entitlement nào được thực thi.
>
> **⚠️ Delta snapshot → live (2026-07-29, `main` = `origin/main` = `3d75c90`) — historical, đã bị mục (1) ở trên thay thế:** năm commit sau `784bc8d` (`49fd155`, `1747b8c`, `ed38106`, `ae9bc37`, `3d75c90`). Bốn commit đầu là autopilot kit v10→v11 + HANDOFF v1.28 nên **không đổi khẳng định nào ở trên**; `3d75c90` squash `db-check-constraint-naming-drift` và đổi đúng hai thứ: **tail `0024` → `0025`** (26 migrations; `0025_check_constraint_naming_drift.sql` đổi tên 40 CHECK tự-sinh, RENAME-only, zero predicate change) và **suite 537 → 561 workspace tests** (db 219 → 243). Verdict 27. Mọi khẳng định khác của snapshot vẫn đúng — nhưng **đừng đọc header này như trạng thái hôm nay**; `git log --oneline origin/main -1` mới là HEAD.
> **✅ `0021` merged (2026-07-24, `15e10b7`):** `db-non-money-tenant-integrity-fks` — sibling P1 (non-money) của `0019`/`0020`, expand-only, **code dark**. 2 candidate key (`zalo_bots`, `notification_intents`) + 3 composite FK bind FK single-column **đã có sẵn** theo tenant (`zalo_reply_contexts`→`zalo_bots`, `notification_deliveries`→`notification_intents`, `memberships`→`memberships` self-ref `merged_into` MATCH SIMPLE nullable — FK `0002` mà Drizzle mirror từng drop, codex round-02 P1). `NOT VALID`→`VALIDATE` named-halt; 2x codex clean; real-PG **179/179**; migrate count 21→22. ⚠️ Slice này **chưa có verdict entry** trong `../slice-readiness-verdicts.md` (mục cuối vẫn là Verdict 18/`0020`) — bằng chứng hiện chỉ nằm ở commit message + test; không suy ra trạng thái gate từ khoảng trống này.
> **✅ Core DD-87 merged (2026-07-23, `d2a27e1`):** `core-matcher-grouped-amount-parsing` — `splitNameAmount` trả **exhaustive fail-closed ambiguity union**, đóng lỗi mất tiền im lặng ("Wang 110 500" settle 500, rơi 110.000đ) mà suite vẫn xanh. Đây là **code merge**, không phải docs: `packages/core` static test count 111→**132**.
> **✅ Parallel DB suite đã mở khoá (2026-07-22, `8d8f3bc`):** `migrate.ts` nay ensure role bằng pre-check + exception handler (nuốt `42710` **hoặc** `23505`, gated trên "0000 chưa applied"), nên `vitest.config.ts` đã bật **`fileParallelism: true`**. Migration `0000` **không bị sửa** (applied + immutable, checksum nguyên vẹn). Điểm bẫy đã ghi vào code: `pg_advisory_lock` là **database-scoped**, không bảo vệ object cluster-global như role. DB suite **159 test**. Chi tiết: Verdict 14. **Nhiều autopilot worktree giờ chạy DB suite đồng thời được.**
> ⚠️ **Đính chính:** commit `eba1c27` mang subject `fix(db): make migration-runner role creation race-safe...` nhưng **chỉ chứa hai file docs** (`auth-s4-session-handoff.md`, `ROADMAP.md`) do một merge abort giữa chừng. Nội dung của nó hợp lệ và được giữ; commit **thật** của slice này là **`8d8f3bc`**.
> **Historical test snapshot (25/07, không phải current):** `DATABASE_URL_TEST=… pnpm test` PASS tại `main@2937ed9`: **29 files / 460 workspace tests** (core 132 · db 179 · web 146 · bot 3) + 13 readiness-validator. *(Câu gốc trỏ "current = 32/537+13" — nay cũng đã mục; current thật là **37 file / 813 workspace** @`80a3464`, validator **17**. Xem block 🔴 LIVE TRUTH 13/08 đầu file.)*
> - **Bằng chứng per-slice (real-PG, authority của chính slice đó):** db **167/167** (`0019`, Verdict 17, `b0c29a6`) → **173/173** (`0020`, Verdict 18, `f6ccd79`) → **179/179** (`0021`, `15e10b7`).
> - **Historical static cross-check tại `2937ed9` = 451** (core 132 · db 179 · web 137 · bot 3). ~~Current declarations = **528**~~ *(mục — static hiện hành là **772** @`1fdba1d`, core 146 · db 449 · web 137 · bot 40, và **9 generated web cases** nay là **41 generated** trên 6 site; xem `../product/ROADMAP.md` luật 4)*; cộng 9 generated web cases = runner 537. Static chỉ để phát hiện drift, không thay runner.
> **✅ D0a merged (2026-07-20, `8f493f7`):** `auth-s4-d0-revoke-core` (migration `0015_auth_revoke_account.sql` — **miếng code feature-layer đầu tiên**) squash-merge sau 12 vòng Codex (10 finding fix) + review tay + real-PG 97/97. Gate "2 clean liên tiếp" **không đạt** → **owner override có ghi chép** (commit message + `HALT-MAX_ROUNDS.txt`), không phải false CODE_READY.
> **✅ D0b merged (2026-07-22, `93c5404`):** `auth-s4-d0-session-web-boundary` — issuance fence `issueSession` (reject-and-reauth, không fallback-mint) + typed 401 `AUTH_INVALID` ở 2 caller + `POST /api/auth/logout-all` (CSRF trước mutation). **Zero DB change.** Gate P0 **ĐẠT** (2 clean round liên tiếp, 2 fix round) — **không override**. Web tests 65→78, real-PG green. Chi tiết: Verdict 6.
> **✅ D1 email-token-core merged (2026-07-22, `64fb4d3`):** `auth-s4-d1-email-token-core` — migration **`0016`** atomic: 5 bảng function-only (`account_emails`, `email_password_credentials`, `auth_pending_email_registrations`, `auth_email_tokens`, `auth_email_deliveries`) + partial unique index độc lập `now()` + `_auth_assert_password_phc` (parse full Argon2id, floor==ceiling, guard overflow) + trigger 2 write-path + `_auth_consume_email_token` parent-first + 5 hàm cleanup deadlock-free; `auth_audit_events` **reuse** từ `0015`; **zero app grant**. **CODE DARK** — không route/UI/provider send. DB tests 97→**128**. Gate đóng bằng **1 clean round + independent directed review** (Codex phi tất định sau 9 vòng), **override thứ 2/3 slice**. Chi tiết: Verdict 8.
> **✅ D1 google-adapter merged (2026-07-22, `c6edbfa`):** migration **`0017`** `auth_oauth_transactions` (PKCE ciphertext AES-256-GCM + key version riêng, single-use issue/claim) + `google-oidc` proof matrix + Lax path-scoped binding cookie (tách khỏi session Strict, **không** reuse `sameOriginRequest()`) + `/api/auth/google/{state,callback}` + `auth_login_google` per-lane finalizer với collision table §4. Suite: db **144** · web **131**. Codex hội tụ, phần rotation invented-scope đã revert. Chi tiết: Verdict 10.
> **✅ d1b session-rotation merged (2026-07-22, `ae8986e`):** migration **`0018`** expand-only (`resolved_account_id`/`handoff_hash`/`handoff_expires_at`/`handoff_consumed_at` + `auth_oauth_handoff_arm/_consume`) + **completion hop M3** — callback trả landing first-party auto-submit POST same-origin → `/complete` chạy `issueSession()` ở nơi cookie Strict CÓ mặt ⇒ đi đúng nhánh rotate. **Residual risk của D1 đã đóng trong code.** Handoff token đi trong body POST, chỉ lưu sha256, **không cookie**; single-use là fence server-side atomic. Suite db 144→**152** · web 131→**146**. **Gate ĐẠT ngay lần đầu: 2 vòng Codex sạch liên tiếp, 0 fix-round** — slice đầu tiên không thrash. Chi tiết: Verdict 13.
> **✅ Safari/iOS measurement gate đã đóng; Google chưa được chứng minh enabled.** Safari macOS và iOS Safari 18.3 đều đo M3 PASS ngày 26/07 (`../probes/probe-strict-cookie-completion-hop.md` §7–§8), nên không còn nghĩa vụ measurement. `GOOGLE_OAUTH_CLIENT_ID/SECRET` trong template vẫn rỗng; việc set credential là owner go-live decision và không tự đóng các gate độc lập khác (vd A3 legal/PII), deployment hay production E2E.
>
> **Historical reconcile 2026-07-22 (không phải current):** target channel identity theo DD-15/DD-65..68 vẫn là endpoint-scoped Messenger + Zalo; adapter/handler/shared Session/Join/AuthZ/projector/E2E chưa build. Auth lane tại snapshot là `0000`–`0018`; current tail và Safari closure xem header.
>
> **Historical reconcile 2026-07-25 — epoch tenant-integrity/publish đã đóng, không mở runtime mới.** Từ `f93873b` (22/07) tới `2937ed9` (24/07) `main` nhận: (a) **1 core fix** `d2a27e1` (DD-87); (b) **3 migration** `0019`/`0020`/`0021` (tenant-integrity composite FKs DD-68 — money-path, payment ledger, non-money; tất cả expand-only + code dark); (c) **8 docs/spec slice** — publish contract (`PublishSession`), billing status-authority + founder ratification (`9ce42c4`), PRD flow-2 publish projection (`6c15606`), publish billing-suspension TOCTOU spec-level (`58788e6`), acceptance-checklist publish retrace (`dfabe1a`), draft-lifecycle discard + auto-expiry (`2937ed9`), session-management spec reconcile, web-auth migration-section reconcile (`4433969`). **Không slice feature-runtime nào mở** ⇒ hàng "Code — lớp feature nghiệp vụ" và thanh ~33% **không đổi**. Tại snapshot này publish/draft-lifecycle là **hợp đồng spec đã đóng**, `NOT CODE_READY`, còn job-infra được defer; current job-infra truth nằm ở header/§2.3/§4.
> **Historical working tree snapshot 2026-07-25 (không tính vào current baseline):** `decisions.md` khi đó ở **v2.04** trong working tree — +DD-88 (🟡 proposal notification taxonomy, v1.99–v2.01), +DD-89 ✅ (worker access/pg-boss authority, v2.02) và **+DD-90 ✅** (per-event job audit, lane-specific pre-provisioned `job_definer BYPASSRLS`, preflight trước `boss.start()`, v2.04). Packet `db-job-claim-lease-core` khi đó còn WIP/chưa là bằng chứng implementation; current code truth là `0022`/`0023` + dispatcher/preflight/schedule đã land. `packages/db/README.md` cũng sửa `surface_refs`→`session_surface_refs` ở hàng tenant-private (hai bảng khác nhau, `0002:122` vs `0005:54`). `decisions` version committed vẫn là **v1.98**.

---

## 0. TL;DR

| Trục | Trạng thái | Ước lượng |
|---|---|---|
| **Tài liệu / thiết kế** | **Live 13/08 @`1fdba1d`: 26 Product (`docs/features/FE/`) + 25 BE (`docs/features/BE/feature_*_tech.md`)**, tất cả đã committed; đường dẫn đổi ở reorg `2e577c7`. Cộng **17 FE spec** `docs/channels/web/FE/` (Draft) — lớp riêng, không tính vào cặp. *(Số 24/24 và 24/23 dưới đây là snapshot 28/07, giữ làm lịch sử.)* Channel Booking Funnel, Notification v3.11/v3.11, Chat v0.15/v0.23 và Club Assistant v0.18/v0.18 có Reviewed target contract/no-runtime. DD-32/86/91–95 decision-final; DD-88 broader `DEFERRED_PROPOSAL`; Chat plan v1.8 `PLAN_READY` at `90d292d`; DD-73/74/75/78 dependency/consumer-sequenced, DD-76/77 evidence-gated; ~~decision mirror **v2.11**~~ → **v2.28** (13/08, +DD-96..105). | Contract coverage cao; không dùng count làm code-readiness |
| **Code — lớp nền (foundation)** | monorepo + core logic + DB/RLS + migrations nền **`0000–0014`** đã merge trên `main` (`0014` waitlist schema-only); tail toàn cục **`0032`** (33 file, live 13/08) — auth `0015`–`0018`, tenant-integrity `0019`–`0021`, job-infra `0022`–`0023`, capacity CHECK `0024`, naming-identity rename `0025`–`0026`, tenant-status definer read `0027`, DD-29 capability registry `0028`–`0029`, **chat DM-safety + schema root `0030`–`0032`** là các lớp riêng. Core nhận fix DD-87 (`d2a27e1`) nhưng chưa có production caller; `authorizeTenantAction` (`ddb69a9`) cũng vậy; **`chat_*` (`0030`/`0031`) cũng vậy — 0 production reader** | **✅ xong** |
| **Code — lớp auth** | Auth v3 (Telegram-era) merged; **DD-80 D0a (`0015`) + D0b + D1 email-token (`0016`) + D1 Google (`0017`) + d1b session-rotation (`0018`) đã merged**; Safari/iOS M3 measured PASS; còn owner go-live/other gates, order-4 email bundle (flag OFF, gate C7) → gỡ Telegram | 🟢 Google lane xong phần code · measurement gate đóng · chưa chứng minh enabled |
| **Code — lớp feature nghiệp vụ** | vẫn **0 trên `main`** (session/reconcile/sync/marketplace/billing/bot/chat…). Session publish + draft-lifecycle có **hợp đồng spec đóng** nhưng 0 dòng runtime. 🔵 *Ngoài trục:* branch `feat/session-service-create-command-core--v2` (`CreateSession` draft + outbox producer, 3 file) **chưa merge** — slice nghiệp vụ đầu tiên, v1 đã `HALT MAX_ROUNDS` | ⬜ chưa build |
| **Roadmap build** | **S1–S3 + S4 Auth v3** đã land + auth `0015`–`0018` + tenant-integrity `0019`–`0021` + job-infra DB `0022`–`0023` + dispatcher/preflight/schedule (`fca314e`/`a03d2d6`) + capacity CHECK `0024` + naming rename `0025`–`0026` + tenant-authz/DD-29 `0027`–`0029` + **chat DB root `0030`–`0032`**. Job schedule OFF; placeholder DLQ; không producer/real projector/replay; `authorizeTenantAction` chưa có caller; chưa TS nào đọc `capabilities`; chưa TS nào đọc `chat_*` | ~33% *(infra implemented nhưng chưa mở hành vi nghiệp vụ/product E2E — **ba tuần liên tiếp** kết bằng "migration merged, 0 hành vi product": 4 migration tuần 30/07→06/08, 3 migration tuần 07/08→13/08)* |

**Một câu:** foundation + Google auth lane đã merge, nhưng Google chưa được enable và email/password bundle vẫn chưa build; tầng feature nghiệp vụ (session/reconcile/sync/marketplace/billing/bot) vẫn nằm trên giấy. `IMPLEMENTED` cho các migration/auth slice không chứng minh product E2E hoặc enablement; **spec đóng cho publish/draft-lifecycle càng không** — nó chỉ nói hợp đồng hết mơ hồ.

---

## 1. Bức tranh tổng: docs đi trước code rất xa

> ⚠️ **Mục §1 dưới đây là snapshot 28/07.** Decision mirror hiện hành là **v2.28** (13/08, +DD-96..105), không phải v2.11; Chat nay đã có DB root `0030`–`0032` nhưng vẫn 0 service/API/UI. Đọc block 🔴 LIVE TRUTH 13/08 ở đầu file trước khi dùng bất kỳ số nào ở đây.

Repo docs-first: decision mirror tới **v2.11**; **DD-32/70/71/72/86/91–95 owner-final**, DD-88 là broader `DEFERRED_PROPOSAL`. DD-32 Option D đã có Product + BE companion nhưng chưa có qualified account-link completion, decision core, intent/hold store, shared occupancy helper, payment finalizer hay channel adapters. Chat có Assistant Product/BE v0.18, Chat Product/BE v0.15/v0.23 và Notifications Product/BE v3.11 Reviewed; plan v1.8 `PLAN_READY` tại `90d292d`, nhưng chưa có schema/service/route/UI runtime và chưa slice-local `CODE_READY`. **DD-73/74/75/78 dependency/consumer-sequenced, DD-76/77 evidence-gated**. Integrity/contract closure không tăng implementation coverage; vẫn cần services/adapters/projectors. B1/B2/B3, mutation-path, external/legal/store gates vẫn phải đóng; thực thi roadmap khoảng ~33% theo slice đã merge, không phải product readiness.

```
Contract ███████████████████░░  coverage cao (không phải readiness score; DD-70/71/72 final/no-runtime; DD-73/74/75/78 dependency/consumer-sequenced; DD-76/77 evidence-gated)
Nền móng  ████████████████████░  ~90%   (core + db-RLS + migrations nền 0000–0014; tail toàn cục 0032 — auth 0015–0018 + tenant-integrity 0019–0021 + job-infra 0022–0023 + capacity CHECK 0024 + rename 0025–0026 + tenant-authz/DD-29 0027–0029 + chat DB root 0030–0032)
Auth      ████████████████░░░░  ~80%   (Google lane merged; Safari/iOS measurement PASS; chưa chứng minh go-live; email bundle pending)
Feature   █░░░░░░░░░░░░░░░░░░░░░  ~5%    (mới có logic thuần trong core, chưa wiring)
```

---

## 2. Đã build gì — chi tiết theo package

### 2.1 `packages/core` — logic nghiệp vụ thuần ✅

Lift từ bot single-club (Bestminton) đã chạy production (~85% auto-match, 0 false-positive). Đa số là
logic thuần, không đụng DB/transport. Root barrel hiện **browser-safe về dependency** và cố ý không export
`i18n.ts` (`node:async_hooks`), nhưng chưa phải contract boundary cho native: nó vẫn export matching/payment
decision helpers mà client không được dùng làm authority. **~2.870 dòng, 9 file test.**

| Module | Vai trò | Test |
|---|---|---|
| `matching.ts` | Dò `pay_code` (tier) + matcher theo tên; **`splitNameAmount` = exhaustive fail-closed ambiguity union (DD-87, `d2a27e1` 23/07)** — ambiguity không còn được resolve im lặng thành số nhỏ nhất | `matching.test.ts` |
| `payments-logic.ts` | `classifyAmount`, FIFO settle (đề xuất, không ghi DB) | `payments-logic.test.ts` |
| `dates.ts` / `time.ts` | `inferYear` (cutoff theo calendar-date, không lệch theo giờ đồng hồ) | `dates.test.ts`, `time.test.ts` |
| `format.ts` | Format tiền/ngày vi/en | `format.test.ts` |
| `i18n.ts` | `t(vi,en)` qua subpath server-only (`node:async_hooks`) | `i18n.test.ts` |
| `vietqr.ts` | Sinh chuỗi VietQR | `vietqr.test.ts` |
| `sports.ts` | Từ vựng môn + taxonomy trình độ | `sports.test.ts` |

Điểm quan trọng: barrel `index.ts` cố ý **không** re-export `i18n` để tránh kéo Node builtin vào
bundle client. Core **PROPOSES** — mọi quyết định tiền do lớp trên áp dụng. Native/PWA nên dùng client-safe
DTO/error/validator/format boundary riêng, không import money engine chỉ vì barrel bundle được trên browser.

### 2.2 `packages/db` — data layer Postgres + RLS ✅ (keystone)

**Baseline `main` (2026-07-28, `784bc8d`): migrations `0000–0024` (25 file) đều trên `main`, có bộ RLS invariant test chạy trên role runtime thật. ~~Current~~ *(28/07)* canonical runner = **DB 219 / full workspace 537 PASS** + 13 validator — **mục; current thật = DB 475 / workspace 813 + validator 17, xem block 13/08 đầu file**; progression DB **167** (`0019`) → **173** (`0020`) → **179** (`0021`) → **201** (`0022`) → **212** (`0023`) → **219** (`0024`). Mốc 460/419 là historical evidence.**

> ✅ **Correction 2026-07-22:** các bản trước của doc này khẳng định `0014_players_waitlist` "chỉ trên nhánh `feat/session-waitlist-expand`, chưa vào `main`" ở bốn chỗ. **Sai** — verify on-disk: `git ls-tree main` có file, và `1a6ac38 feat(session): expand players for DD-45 waitlist` nằm trong lịch sử `main`; `waitlist-invariants.test.ts` (21 test) chạy trong mọi lần `pnpm test`. Claim cũ là prose stale được chép lại qua nhiều lần cập nhật mà không verify — đúng bẫy mà CLAUDE.md cảnh báo.

- **Migrations 0000→0013 (trên `main`):** roles/extensions → global directory → tenants → payments-ledger →
  channels/connectors → sync-engine → discovery → billing → notifications/onboarding → RLS
  policies/grants → functions/triggers → seeds → auth_functions → onboarding_steps recency.
- **`0014_players_waitlist` (2026-07-19, ✅ trên `main` tại `1a6ac38`)** — bảng đầu tiên được mở rộng cho feature layer:
  `players.status` thêm `waitlisted`, cột `waitlist_position`, hai CHECK state-shape/positive và
  `idx_players_waitlist_order`. **Chỉ schema** — auto-promote là money-write: first-activation chờ DD-39/41/42 + shared DD-52 restriction core; proven rejoin còn chờ DD-49 correction core. Retry còn thiếu `waitlist_entry_version`, candidate failure-event/owner-alert consumers, root promotion-retry store, CAS/lease sweep worker và domain DLQ/review sink. Không có behavior/runtime path nào được tính là đã build.
  21 DDL invariant test (`waitlist-invariants.test.ts`) gồm cả app-role grant/RLS trên cột mới.
- **`0019`/`0020`/`0021` tenant-integrity composite FKs (DD-68) — bộ ba đã đủ (23–24/07):** `0019` money-path/session domain (8 FK, `b0c29a6`, Verdict 17) → `0020` payment ledger (5 FK, `f6ccd79`, Verdict 18) → `0021` non-money (3 FK + 2 candidate key, `15e10b7`). Cả ba **expand-only, code dark**, không đổi role/grant/RLS, `NOT VALID`→`VALIDATE` named-halt, `0000`–tail trước byte-identical. Chúng đóng lớp *integrity* (không thể tạo hàng cross-tenant qua FK single-column), **không** mở hành vi nào — không service, không route, không projector.
- **Choke-point:** `tenant.ts` (`tenantRepo`/`withTenant`) — mọi query tenant-scoped bắt buộc qua đây,
  `SET LOCAL app.tenant_id`, client theo role. `migrate.ts` = runner transactional, immutability + RLS guard.
- **Bất biến đã test (`rls-invariants.test.ts`):** RLS fail-closed trên role thật; occurrence chứng minh
  **cả hai** parent thuộc đúng tenant; app **không** import `@plexco/db/schema` trực tiếp (HR1 lint guard).
- 61 khai báo `pgTable` đã dựng data model rộng cho hầu hết feature phía sau (persons/accounts/channel_identities/memberships,
  charges/payment_allocations/bank_transactions, public_sessions, outbox_events/projector_deliveries,
  subscriptions/billing_*, link_codes/merge_audit/merge_tombstones, magic_links/web_sessions/oauth_transactions…).
  → **Schema đi trước; code feature dùng chúng thì chưa có.**

### 2.3 `apps/web` + `apps/bot` — shell + Auth Onboarding v3 (Telegram-era) 🟡

- `apps/web`: khung Next.js (`layout.tsx`, `page.tsx`, `healthz/route.ts`, `next.config.mjs`) + Auth Onboarding v3 (Telegram-era) **và Google lane DD-80 đã merge**: D0b logout-all, Google OAuth state/callback/complete và M3 completion handoff. Safari/iOS measurement PASS; Google vẫn chưa được chứng minh enabled/go-live; email/password bundle chưa code.
- `apps/bot`: queue/provision + worker preflight + `runDispatchCycle` + schedule/consumer đã implemented và có 4 test file. Schedule fail-closed OFF mặc định; `productionStubDeliver` terminal-DLQ, không producer, real projector hay replay path, nên chưa có delivery runtime thật.

Chưa có: command handlers, services, projectors, API nghiệp vụ đầy đủ, UI thật, tích hợp Zalo/Messenger, webhook reconcile; **email/password bundle (DD-80 order-4) và Telegram removal** chưa implement.

---

## 3. Đối chiếu từng feature: **spec status** vs **code**

Working tree có **24 cặp**: 15 legacy (14 active Reviewed + 1 Telegram archived), Connector, Messenger/Chat/Settings, Home, Club Assistant, Session Organize, Tournament và Channel Booking Funnel. Có **19 cặp Reviewed**, 1 Session Organize accept-in-principle, 3 Draft và 1 Archived; cột "Code" mới cho biết thực thi tới đâu. Committed base vẫn 24 Product/23 BE vì Funnel BE chưa commit.

| Feature (Phase) | Spec | Code hiện tại |
|---|---|---|
| Multi-tenant Foundation (P0–P1) | ✅ Reviewed | **✅ Có** — RLS + tenantRepo + 61 `pgTable` declarations |
| Tenant Routing & Authz (P2) | ✅ Reviewed (DD-56 + DD-65..68 hybrid target) | ⬜ Chưa protected Messenger endpoint/action resolver; chưa canonical closed action registry, tenant-private expiring/revocable grants, append-only grant audit hoặc fail-closed `authorize` runtime |
| Session Management (P2/P4) | ✅ Reviewed — create=draft + public finite-capacity, `PublishSession`, locking billing re-check, draft discard/auto-expiry | 🟡 `0024` đã enforce public session phải có finite capacity; vẫn ⬜ SessionService/wizard/route. Job-infra machinery đã land nhưng schedule OFF và chưa có producer/real projector/replay |
| Session Organize (post-P4) | ✅ accept-in-principle DD-61..64 (owner 18/07) | ⬜ Chưa — không có organize tables/migration/service/assign/scoring/SSE; SessionService prerequisites cũng pending |
| Payment Reconciliation (P3) | ✅ Reviewed v1.10/v1.13 | 🟡 Một phần — **logic** đã có ở `core` (matching + payments-logic, gồm fix ambiguity DD-87 `d2a27e1`); **wiring** webhook→settle→notify chưa. Consumer của union ambiguity mới (`core-matcher-ambiguous-consumer-wiring`) vẫn là `idea` |
| Identity & Merge (P3.5) | ✅ Reviewed | ⬜ Chưa (bảng link_codes/merge_audit/tombstones có sẵn) |
| Notifications — Reminders · Inbox · Announcements · Web Push (P3/P4/P4.5) | ✅ Reviewed v3.11/v3.11 — §A giữ nguyên; §B/C/D theo **DD-70/71/72**; DD-94 Chat unread là source cho generic opaque offline signal/digest, không durable content snapshot/item. Delivery plan: DD-67 route integrity → subscription → provider attempts → PWA shell → registration → display/telemetry; payment intent → reminder + settled/correction producers → Inbox/detail → payment push. DD-88 broader `DEFERRED_PROPOSAL` | ⬜ Chưa (bảng notification_* tenant baseline có sẵn; `person_notifications`/`membership_tags`/`device_push_subscriptions` chưa có; không service/producer/inbox/push/PWA runtime) |
| Web Auth & Onboarding (P4) | ✅ Reviewed | 🟢 Telegram-era + Google lane DD-80 merged; Safari/iOS M3 PASS; Google chưa proven enabled, email/password bundle và Telegram removal pending |
| Sync Engine (P4) | ✅ Reviewed v2.5/v2.7 | ⬜ Chưa projectors; Messenger one-route delivery chưa viết |
| Marketplace Discovery (P4.3) | ✅ Reviewed | ⬜ Chưa (public_sessions có sẵn) |
| Cross-club Join (P4.3) | ✅ Reviewed | ⬜ Chưa (join_requests có sẵn) |
| Channel Booking Funnel (P2.5/P4.3/P4.7, DD-32 Option D) | ✅ Reviewed contract — browse tự do; free/full/approval không thu tiền sớm; paid linked pay-later; paid unlinked chỉ active sau verified pay-now trong hold 15 phút | ⬜ Chưa — 0 qualified account-link completion/decision core/intent-hold schema/occupancy helper/payment finalizer/Messenger-Zalo adapter; readiness owned by its plan |
| Shared Host/Player Messenger (P2.5, DD-65..68) | ✅ Reviewed contract | ⬜ Chưa hybrid migration/adapter/handlers/actions/reachability/E2E. Shared job substrate + dispatcher + gated scheduler đã có, nhưng schedule mặc định OFF và delivery vẫn là placeholder fail-closed |
| Player View (P4.6) | ✅ Reviewed v2.5/v2.8 | ⬜ Chưa |
| Home hub (S9, DD-79 ✅) | ✅ Reviewed contract (`feature_home.md` v0.7 + BE v0.3 — composition-only, không bảng mới; phase-1 nav 4 tab, Feed registry-OFF) | ⬜ Chưa — chờ S9 PWA shell; data từ player_view/marketplace/§A |
| In-app Chat (P4, DD-38/DD-86/DD-91–95) | ✅ Reviewed v0.15/v0.23 — N club channels + DM; exact DD-56/DD-95 capabilities; safe current-channel opaque target boundary; DD-92 interactions/search; DD-93 full surface matrix; DD-94 generic unread signal. Primary plan v1.8 = `PLAN_READY` at `90d292d`, owns serialized DB lane, mechanisms `1–47`, thin API `A1–A21`, tracked-design FE `F0–F15`; each slice still strict `CODE_READY` | ⬜ Chưa — 0 `chat_*`/capability/Assistant/push migration, service, producer, route or UI; no coding/worktree authorization |
| Zalo Channel (P4.7) | ✅ Reviewed | ⬜ Chưa (`zalo_bots`/reply-context base tables có sẵn; endpoint identity/reachability + legacy-secret KMS migration/runtime còn pending) |
| Billing Lifecycle (P5) | ✅ Reviewed | ⬜ Chưa (subscriptions/subscription_invoices/billing_* có sẵn) |
| Security & Operations (P6) | ✅ Reviewed | 🟡 Một phần — RLS/HR1 guard đã thực thi; phần còn lại chưa |
| Club Assistant (P7 post-MVP) | ✅ Product/BE v0.18 Reviewed; planned chain = KB storage/config → text/URL/file ingest → generation/CAS index activation → retrieval → `bot.ask` → mention/private thread; DD-18 provider/privacy/ToS là enablement-only | ⬜ Chưa (chỉ có `player_chat_context` baseline; không KB migration/index worker/Assistant route/service/LLM/host UI runtime) |
| Connector Onboarding | 🟡 Draft v1.0/v0.9 (provider-contract reviewed) | ⬜ Chưa (provider_connections/onboarding_* có sẵn) |
| Marketplace/Sync… | — | — |

**Đọc bảng này thế nào:** gần như mọi feature đã có (a) spec Reviewed và (b) *bảng DB tương ứng* dựng
sẵn ở S3 — nhưng (c) tầng command/service/projector/UI thì trắng. Docs-first + schema-first đã giảm
rủi ro khám phá, **không biến phần còn lại thành việc "điền code" cơ học**: B0–B3, DD-49 correction
probes và các negative scope S5/S7 vẫn là design gate bắt buộc trước khi chốt storage/API hoặc mutation path.

---

## 4. Roadmap build (orchestrator 20 slice)

Nguồn: `docs/autopilot-backlog.md` (Phase-1 full-launch, S1→S20; **DD-37: Messenger nay là phase-1 P2.5**, Telegram bỏ khỏi phạm vi).

| Slice | Nội dung | Trạng thái |
|---|---|---|
| **S1** monorepo-scaffold | pnpm workspace, toolchain, CI, runtime shells, infra | ✅ **merged** |
| **S2** core-lift (+S2d foundations) | matching/dates/payments-logic + i18n/format/vietqr/sports | ✅ **merged** |
| **S3** db-postgres-drizzle-rls | schema + 14 migration (`0000–0013`) + RLS choke-point + invariant suite | ✅ **merged** |
| **S4** auth | web-auth/onboarding | 🟢 Telegram-era + Google lane DD-80 merged (`0015`–`0018`); Safari/iOS M3 measured PASS; Google chưa proven enabled, email/password bundle pending |
| **Tầng integrity (ngoài đánh số S)** | `0019`/`0020`/`0021` tenant-integrity composite FKs (DD-68) | ✅ **merged** (23–24/07) — expand-only, code dark |
| **Tầng job-infra (ngoài đánh số S)** | DB lease/audit/ack `0022`–`0023`; queue provisioning + worker preflight; `runDispatchCycle`; fail-closed schedule/consumer | ✅ **IMPLEMENTED** (`34429fc`, `76e1f7b`, `fca314e`, `a03d2d6`) nhưng **code-dark delivery**: schedule mặc định OFF, placeholder projector + terminal DLQ, không producer/real projector/replay; chưa `ENABLE_READY` |
| S5 session · S6 sync-engine · S7 reconcile · S8 identity-merge | S5 đã có hợp đồng spec publish/draft-lifecycle đóng (23–24/07) | ⬜ chưa code |
| S9–S12 web PWA + marketplace · S13 cross-club · S14 billing | | ⬜ chưa |
| S15 host-pro-auto · S16 reminders-auto · S17 Zalo · S18 Messenger | | ⬜ chưa |
| S19 club-assistant (DD-gate ✅) · S20 polish | | ⬜ chưa |
| Telegram | bỏ khỏi phạm vi (DD-37 thay DD-09) | ✂️ out |
| App Native phase-2 (DD-69) | RN+Expo recommendation; client/API/auth/push/offline/store gates | ✅ direction accepted (18/07) · ⬜ build chưa schedule |
| Statement/export sao kê (DD-97) | Per-session collection view (free) · kỳ/tháng + export PDF/XLSX (`host_pro`); composition-only trên charges/allocations, export trên DD-89 foundation, HR2 authenticated download | ✅ direction + entitlement (07/08, owner-delegated) · ⬜ chờ DTO owner Reviewed + spec pair; build chưa schedule |

**Tiến độ: S1–S3 + Google lane DD-80 + tenant-integrity + job-infra machinery + `0024` đã land; current committed tree `main@784bc8d` vẫn ≈ 33% chặng đường code theo roadmap vì chưa có business vertical/E2E. Safari evidence đã đóng nhưng Google chưa proven enabled; email/password bundle order-4 và Telegram removal chưa code. Chat `PLAN_READY` không làm tăng phần trăm implementation.**

> **Trạng thái backlog đã reconcile 25/07:** 7 slice mang status stale (`ready`×6 + `in-flight`×1) trong khi `merged_probe` của chúng **đã hit trên `origin/main@2937ed9`** — nay flip sang `merged`: `docs-session-management-acceptance-checklist`, `docs-session-acceptance-checklist-publish-retrace`, `docs-session-publish-concurrency-recheck`, `docs-session-draft-lifecycle`, `docs-auth-d1-packet`, `docs-tail-0018-number-reconcile`, `docs-web-auth-migration-section-merge-state-reconcile`. Đây là sửa **book-keeping**, không phải slice mới merge; hệ quả thực tế: bot autopilot sẽ thôi quét lại 6 slice đã xong.

---

## 5. Session hôm nay đã đóng góp gì (2026-07-06)

6 commit ngày 06/07:
- **`d701210` merge phase-1** — gộp S1 + S2d + S3 + core-lift-v3 vào `main` (mốc kết thúc Phase 1).
- **`3717659` S2 core-lift-v3** — land matching/dates/payments-logic + i18n/format/sports lift.
- **auth-v3 design pass** (`a5ddfdb`, `6365667`) — artifacts security-design, chốt DD-31 (8 bất biến
  SI-1..SI-8 + 4 gap: login-state CSRF, tenant-filter policy, KMS/secret wiring, keyed web-auth hash);
  tách "decisions-resolved" (OQ-1/2/3 do founder chốt) vs "impl-open" (tới v3 merge).
- **`2ce2684`, `3f2172a`** — autopilot: class-aware review gate + fix portable read loop (macOS bash 3.2).

Nói cách khác: session này **khép lại Phase 1** (nền móng) và **mở màn thiết kế lớp Auth** (S4).

> **Historical update 2026-07-19:** đoạn này ghi trạng thái trước DD-80 slices; không dùng làm current baseline. Current baseline xem header (`main@784bc8d`, migrations `0000–0024`, Safari measurement PASS, Google chưa proven enabled).

---

## 6. Gap & bước tiếp theo hợp lý

**Còn thiếu để có MVP chạy được:** owner go-live Google sau các gate độc lập, email/password bundle + Telegram removal, real job delivery path và tầng feature S5→S19. Ưu tiên theo dependency:

1. **Google go-live (ENABLEMENT_ONLY):** Safari macOS+iOS M3 đã PASS; owner còn phải quyết định set `GOOGLE_OAUTH_*` và đóng các gate độc lập còn lại. Measurement không thay thế deploy/production E2E.
2. **S4 email/password bundle:** sau Google lane, build release unit order-4 flag OFF rồi mới gỡ provider Telegram-era, theo DD-80.
3. **Job delivery enablement:** giữ schedule OFF tới khi real projector thay stub, producer + replay/recovery contract tồn tại, và sub-minute wake-up/drain policy đáp ứng NFR; sau đó review enablement riêng.
4. **S5 Session** → **mark-paid thủ công** → **S7 Reconcile**: `0024` chỉ đóng DB invariant; mỗi mutation path vẫn cần service/contract/slice riêng.
5. **S6 Sync-engine** và **S8 Identity-merge:** author sau hard dependencies và gates tương ứng; Identity cần verified account email hoặc transactional one-time `link_code` (HR4/DD-50).
6. **Channel Booking Funnel:** không mở Messenger/Zalo adapter trước core. Khi các prerequisite tương ứng đã merge, first packet là `identity-account-link-core`, rồi decision core → intent/hold → occupancy → verified-payment finalizer → approval/waitlist integration → adapters; commit/re-pin docs authority trước readiness review.

**Execution boundary 28/07:** job root→ack→dispatcher→schedule đã implemented; schedule vẫn OFF và không được bật trước real delivery prerequisites ở trên. Vertical Session BE vẫn chưa có SessionService/route. DD-32 docs closure không cho phép bypass Session/Identity/Payment hard dependencies hoặc book bằng ảnh chuyển khoản/lời khai. DD-81 target theme đã final nhưng **FE HOLD** vẫn giữ tới khi `design.pen` tracked + owner-approved và visual/WCAG gate PASS. ⛔ **Câu này HẾT HIỆU LỰC từ 13/08:** FE nay là **PENDING theo lệnh owner** — không track `.pen`, gate DD-81 không còn là thứ chặn; xem block 🔴 LIVE TRUTH 13/08 (h) đầu file.

**Quyết định/gate còn treo có thể chặn hoặc định hình build:** **DD-04** provider ✅ **chốt (c) DO co-locate** (còn build-time gate: egress-IP verify + provision + restore/failover drill + RPO/RTO + KMS), **DD-14/15**
(Zalo external spikes), **DD-33 đã chốt nhưng Meta App Review/Business Verification/permission evidence vẫn là external enablement gate**, và **DD-34/35/36**
(Club Assistant P7 detail). **DD-18 chỉ chặn GO-LIVE Club Assistant và không phải build-time provider dependency; Product + BE v0.18 đã Reviewed nhưng chưa có runtime.**
**Decisions v2.11 mirror *(snapshot 28/07 — live hiện hành là v2.28; xem block 🔴 LIVE TRUTH 13/08 ở đầu file)*:** DD-70/71/72/86/91–95 owner-final; DD-88 broader `DEFERRED_PROPOSAL`. Chat primary plan v1.8 là `PLAN_READY` tại `90d292d`, nhưng từng slice vẫn strict `CODE_READY` và runtime vẫn chưa có. DD-73/74/75/78 dependency/consumer-sequenced, DD-76/77 evidence-gated. Notification runtime, share/activity và native runtime vẫn chưa có. Google lane + Safari evidence đã merge/đóng nhưng go-live chưa proven; B1/B2/B3 + correction/external/legal gates vẫn áp dụng.
**DD-02/05/06/08/10/12/41–46 đã ✅ chốt; DD-47/48 đã chốt framework** nhưng schema/code vẫn pending.
DD-13 (Google/email) ✅: Google lane đã merge, Safari evidence PASS, go-live chưa proven; email/password bundle còn pending. DD-37/38/39 ✅; chat/giá theo giới tính còn chờ migration.

---

## 7. Historical verification (2026-07-16–19)

Các kết quả dưới đây là historical evidence của checkout/CI nêu rõ từng dòng, không phải xác nhận current `main@784bc8d`:

| Gate | Kết quả |
|---|---|
| **Current feature checkout full suite (19/07)** | ✅ working tree on `feat/session-waitlist-expand@aa8afae` (waitlist executable-schema provenance `1a6ac38`; `aa8afae` comment/test-format-only): canonical PostgreSQL command pass **21 files / 244 tests** (core 111 · DB/RLS/auth/waitlist 65 · web 65 · bot 3), gồm `0014` |
| **Current feature checkout static gates (19/07)** | ✅ `pnpm format:check` · `pnpm lint` · `pnpm typecheck` · `git diff --check` pass; đây là local working-tree evidence, không thay remote CI/merge evidence |
| `pnpm lint` (16/07) | ✅ Pass |
| `pnpm build` (16/07) | ✅ Pass; typecheck + Next production build; live routes vẫn gồm Telegram-era auth callback/state như code snapshot đã nêu |
| `pnpm format:check` (17/07) | ✅ Pass full repo sau Messenger hybrid contract propagation |
| Non-DB tests (16/07) | ✅ Core **111** · web **65** · bot **3** pass; web có thêm provider-pinned client-IP regression matrix |
| Static infra/config (16/07) | ✅ Manifest JSON parse · `/bin/bash -n` · Compose config · `git diff --check` pass |
| Canonical DB/full test (17/07) | ✅ `DATABASE_URL_TEST=postgres://plexco:…@localhost:5432/plexco_test pnpm test`: **20 files / 223 tests pass** (core 111 · DB/RLS/auth 44 · web 65 · bot 3) |
| Messenger-doc delta QA (17/07) | ✅ **44 modified Markdown files** checked: 0 broken relative links, 0 unbalanced fences; `git diff --check` pass. Đây là contract QA, không phải Messenger runtime E2E |
| Previous canonical DB/full test (16/07) | ✅ Docker PostgreSQL `/plexco_test`: **20 files / 223 tests pass**; container được stop sau verify |
| Previous full-suite baseline (13/07, historical) | ✅ **20 files / 214 tests pass** trước trusted-ingress regression expansion |
| Local Markdown link + anchor scan (16/07) | ✅ **151 Markdown files** trong current working tree, 0 broken local links/anchors · 0 unbalanced fence |
| Remote CI (`main@299338d`, 17/07) | ✅ [Run 29518494545](https://github.com/maingocanh1702/plexco-app/actions/runs/29518494545): install/typecheck/format/lint/build/full PostgreSQL suite pass |
| Remote Security (`main@299338d`, 17/07) | ✅ [Run 29518495006](https://github.com/maingocanh1702/plexco-app/actions/runs/29518495006): Semgrep CE + OSV full dependency scan pass |

Phạm vi historical: working tree tại `feat/session-waitlist-expand@aa8afae` local green **21/244** ngày 19/07; runtime closure `299338d` giữ historical remote CI/Security **20/223**. Các con số này không thay staging/restore/provider evidence và không có nghĩa feature layer đã implement. `0014` hiện đã merge trên main; baseline hiện hành xem phần mở đầu.

---

## 8. Bảo trì doc này

Cập nhật khi: (a) một slice merge vào `main`, (b) một feature chuyển từ ⬜→🟡→✅, (c) một DD đổi trạng
thái ảnh hưởng build. Giữ đồng bộ với `docs/autopilot-backlog.md` và `decisions.md` (2 nguồn sự thật —
doc này chỉ *tổng hợp*, không thay thế).
