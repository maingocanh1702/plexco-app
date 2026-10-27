# DEV ONBOARDING — nhận bàn giao repo Plexco

> **Dành cho:** senior dev nhận repo này và làm tiếp, không có ai ngồi cạnh giải thích.
> **Đo tại:** `main@e235ea4` (15/09/2026). Mọi con số trong file này đều tái tạo được bằng lệnh ghi kèm.
> **Quan hệ với `HANDOFF.md`:** file đó là **nhật ký LIVE TRUTH** (mới nhất trước, có lịch sử từng đợt) — dùng để tra "hôm đó đã đo được gì". File này là **đường vào**: đọc gì, dựng máy thế nào, luật nào không được phá, và việc kế tiếp là gì.

---

## 0. Ba câu phải nhớ trước khi gõ dòng code đầu tiên

1. **Nền móng đã xong, sản phẩm thì chưa.** 45 migration · 8 command session · 7 API route nghiệp vụ · **0 màn FE**. Theo luật 5 của ROADMAP, trục yếu nhất là trạng thái thật ⇒ sản phẩm đang ở **⬜ chưa host nào dùng được**.
2. **Repo này đo, không tin văn.** Mọi phát biểu về trạng thái phải kèm lệnh sinh ra nó. "Doc nói vậy" không phải bằng chứng; `git log`, migration, test chạy thật mới là.
3. **Tài liệu có thứ bậc.** Live code/schema > `decisions.md` (chốt) > BRD/PRD/TDD (scope/behavior/contract) > ROADMAP/BUILD-STATUS (thứ tự + tiến độ) > research/strategy. Conflict thì lấy tầng cao hơn, **không** nới fail-closed vì tầng thấp chưa cập nhật.

---

## 1. Đọc theo thứ tự này (khoảng 90 phút)

| # | File | Đọc để biết | Mất |
|---|---|---|---|
| 1 | `docs/product/ROADMAP.md` **§📍** | Trạng thái thật + số đo + blocker + việc kế tiếp. **Mục duy nhất phải đọc trước mọi mục khác.** | 10' |
| 2 | `docs/product/BRD.md` **§📍** | Sản phẩm là gì, phạm vi MVP vs phase-1 vs launch, 4 bất biến | 10' |
| 3 | `docs/product/TDD.md` **§📍** | Bảng **13 lớp thiết kế-vs-as-built** — lớp nào khớp, lớp nào còn lệch | 10' |
| 4 | `CLAUDE.md` (gốc repo) | Luật bắt buộc cho mọi session: review gate, template docs, ngôn ngữ, workflow | 15' |
| 5 | `docs/00-start-here/HANDOFF.md` khối 🟦 15/09 | Nhật ký đợt gần nhất + Tier C chờ owner | 10' |
| 6 | `docs/standards/decisions.md` — bảng tổng hợp đầu file | Quyết định nào đã chốt, cái nào còn 🟡 đề xuất | 20' |
| 7 | `docs/product/PRD.md` **§📍** (chỉ mục 16 FLOW) | Hành vi target theo flow — tra khi làm feature cụ thể | 15' |

Đọc xong 7 mục đó là đủ để nhận việc. **Không cần** đọc hết thân BRD/PRD/TDD ngay — chúng là tài liệu tra cứu, mỗi §📍 đã trả lời câu hỏi chính của file trong một màn hình.

---

## 2. Sản phẩm

**Plexco** — platform 2 phía cho thể thao phong trào đa môn (cầu lông, pickleball, tennis, bóng đá…):

- **Host (chủ CLB):** tạo & quản kèo, roster, **thu và đối soát chuyển khoản**.
- **Player:** tìm kèo đang mở (xuyên CLB), join, theo dõi kèo và nợ.

**Bất biến sản phẩm — không DD nào được phá:**

1. **Không cầm tiền player.** CLB thu tiền, Plexco ghi nhận + đối soát. (Áp cho cả Membership, DD-115.)
2. **Đa tenant cô lập fail-closed.** RLS là nền, không phải lớp phụ.
3. **Đa môn từ schema**, không hard-code cầu lông.
4. **Chat-first + web sync hai chiều.** Web không phải bản sao read-only của bot.

**Thứ tự surface đã chốt (DD-113/DD-114/DD-69) — không được sắp xếp lại:**
Launch = **web app (installable/offline) + Zalo bot ra mắt song song** → phase-1 thêm **Messenger** (chờ App Review Meta) → phase-2 mới **native iOS/Android**, mở bằng gate đo được ở `BRD.md` §14.

> ⚠️ Chữ **"PWA"** chỉ được dùng khi manifest + service worker đã land. Trước đó viết "web app installable/offline".

---

## 3. Trạng thái thật @ `main@e235ea4` (15/09/2026)

| Hạng mục | Số | Lệnh tái tạo |
|---|---|---|
| Migration | **45** (`0000`–`0044`) | `ls packages/db/migrations/*.sql \| wc -l` |
| Test file | **54** `*.test.ts` + 4 `scripts/*.test.mjs` | `find packages apps -name '*.test.ts' -not -path '*/node_modules/*' \| wc -l` |
| Test case (runner) | **1490 workspace** + **128 readiness/kit** | `pnpm -w test` |
| API route | **15** = 6 auth + 2 onboarding + **7 nghiệp vụ** | `find apps/web/app/api -name route.ts \| wc -l` |
| Session command | **8** | `grep -n '^export async function' packages/db/src/session-service.ts` |
| **Màn FE nối API** | **0** | chỉ có `apps/web/app/page.tsx` |

**Đã chạy được thật:**

- Multi-tenant + RLS fail-closed, `tenantRepo` choke-point, `ensureTenantContext` set-or-assert.
- Google login (6 route auth, cookie `__Host-`/`__Secure-`, idle TTL 14 ngày) — **merged nhưng ⛔ chưa bật** (`GOOGLE_OAUTH_*` còn rỗng, là quyết định go-live của owner).
- Họ lệnh session đủ 8: `create · publish · announce · update · close · cancel · createGuestNote · deleteGuestNote` (`packages/db/src/session-service.ts`).
- 7 route nghiệp vụ; `announce` **cố ý chưa có route** (gate DD-56 clause 1 — announce không giao được cho ai khi projector còn stub). ⚠️ **27/10/2026:** route `announce` đã có (`apps/web/app/api/sessions/[id]/announce/route.ts`) và projector không còn stub (`apps/bot/src/projectors/index.ts`).
- Public read model + fence (`0033`/`0036`): guarded view, `app`/`readonly` **0 quyền** trên bảng gốc.
- Bundle hardening audit 06–07/09 (`0037`–`0042`) và link_code identity (`0043`).

**Chưa có, đừng đọc nhầm:**

- **0 màn FE** — FE đang **PENDING theo lệnh owner** (DD-116 Option B), không phải "chưa kịp làm". Carve-out DD-119 vẫn **🟡 chưa ratify**. ⚠️ **12/10/2026: gỡ bởi DD-122** (full MVP; DD-119 superseded; chương trình `../autopilot-templates/web-mvp-2026-10-12-RUN.md`).
- **Gửi thật qua kênh** — cần owner bật projector trong registry (chỉ bằng CLI owner `node scripts/outbox-projector-enable.mjs enable --projector <tên>`, runbook `outbox-dispatch-enable-rollback.md` bước 2.4: CLI từ chối (`unacked_backlog`) khi còn event chưa ack cũ hơn ngưỡng, nếu không thì bật rồi backfill; gọi thẳng `outbox_projector_set_enabled(<tên>, true)` bị cấm vì bỏ qua backfill, hàm đó chỉ còn để tắt); `zalo_dm` còn cần token Zalo thật (P0 của owner). `OUTBOX_DISPATCH_SCHEDULE_ENABLED` default commit `true` (B3, DD-141); worker chỉ lên lịch khi cờ đúng `"true"`, bản đồ projector không chứa stub và probe registry qua.
- **Route ĐỌC session** (`GET /api/sessions`, `/[id]`) — chờ DD-56 amendment #3 ký.
- **In-app Chat** — có DB root `0030`–`0032` và **0 dòng TS production nào đọc `chat_*`**. Schema không phải runtime.
- **Zalo/Messenger adapter**, đối soát CK runtime, billing entitlement (`resolveCapability()` vẫn **0 caller production**).

---

## 4. Kiến trúc

**Ba vùng dữ liệu = ba tầng hiển thị:**

1. **GLOBAL identity** (ngoài RLS, **không chứa tiền**): `persons`, `channel_identities`, `channel_reachability`, `sports`.
2. **TENANT-scoped** (RLS fail-closed): `sessions`, `players`, `memberships`, `charges`, `bank_transactions`, `payment_allocations`, billing…
3. **PUBLIC read model** (cross-tenant, không RLS, **field whitelist**): `public_sessions` — marketplace. Không tiền, không PII.

**Canonical store pattern:**

```text
Mọi surface (chat/web/webhook) → Command → Services → tenantRepo (choke-point, RLS)
  → ghi + Outbox event (cùng transaction)
  → Projectors: Zalo · Messenger · SSE web · public_sessions
```

**Repo map:**

| Đường dẫn | Là gì |
|---|---|
| `packages/core` | Logic thuần: matching, payments-logic, dates, format, i18n, sports. Không I/O, test isolation. |
| `packages/db` | **Trái tim.** `schema.ts` + `migrations/*.sql` (AUTHORITATIVE) · `tenant.ts` (choke-point) · `session-service.ts` (8 command) · `authorization.ts` · `capability.ts` · `identity.ts` · `public-session-fence.ts` · `test-harness.ts` |
| `apps/web` | Next.js App Router. `app/api/**/route.ts` · `lib/session-command-route.ts` (choke-point actor tạm) · `middleware.ts` |
| `apps/bot` | pg-boss worker: `preflight.ts` (fail-closed) · `dispatcher.ts` · `heartbeat.ts` · `queues.ts`. Zalo/Messenger adapter **chưa có**. |
| `infra/` | `docker-compose.yml` (Postgres dev) · `Dockerfile` · `entrypoint.sh` (đối chiếu `DB_EXPECTED_ROLE`) · `fly.toml` · `postgres-init/` (bootstrap definer role) |
| `scripts/` | Gate + validator: `check-review-readiness.mjs` · `codex-review-pin.sh` · `autopilot-*` · `db-reset-test.mjs` |
| `ap3/` | Làn autonomous mới (xem §7) |

**Đường tiền — hiểu kỹ trước khi sửa:**

```text
SePay webhook → /webhook/sepay/:token → verify timestamp + raw-body HMAC (timing-safe, ±300s) → lưu raw TRƯỚC khi ack
  → matching: pay_code tier → name matcher → classifyAmount
  → FIFO settle → notifyPlayersPaid (fan-out mọi kênh + sync web)
```

---

## 5. ⛔ 5 HARD RULES — vi phạm là rò rỉ thật, không phải lỗi style

1. **RLS FAIL-CLOSED.** Mọi query đi qua `tenantRepo(tenantId)`. `SET LOCAL app.tenant_id`. Role `app` là `NOBYPASSRLS`. **Không** query thẳng bảng tenant-scoped từ controller.
2. **TIỀN/PII KHÔNG RA PUBLIC.** `public_sessions` chỉ chứa field whitelist (môn, giờ, khu vực, giá, slot, tên hiển thị). Tuyệt đối không roster/nợ/SĐT/email.
3. **KHÔNG multi-master.** Postgres + domain model là canonical store. Surface chỉ gửi command, không sở hữu bản ghi song song.
4. **CLAIM-CÓ-TIỀN CẦN KHOÁ MẠNH.** Merge/claim identity phải qua verified factor: email đã verify (web) hoặc `link_code` dùng-một-lần (bot) — DD-50. Tên/alias/owner assertion **không đủ**.
5. **i18n BẮT BUỘC.** Mọi chuỗi user-facing là `t(vi, en)`. Repo **không** có i18n key-based — `t('some.key')` không resolve được.

> Guard nào cũng phải **khai địch thủ** của nó. Guard không khai threat model sẽ bị review với địch thủ mạnh nhất và vòng review không có điểm dừng.

---

## 6. Dựng máy — 20 phút tới lần test xanh đầu tiên

**Yêu cầu:** Node ≥ 22.13 · pnpm 10.30.2 (`packageManager` trong `package.json`) · Docker.

```bash
# 1. Install
pnpm install

# 2. Postgres dev (loopback only — cố ý, audit 2026-09-06 X-2)
docker compose -f infra/docker-compose.yml up -d postgres

# 3. Env
cp .env.example .env
# KHÔNG lưu DATABASE_URL_MIGRATION trong .env — chỉ truyền ad-hoc cho lệnh DDL.

# 4. Definer role bootstrap (cluster đã có sẵn data thì phải chạy tay; volume mới thì init tự chạy)
DATABASE_URL_MIGRATION=postgres://plexco:plexco_dev@localhost:5432/plexco pnpm db:bootstrap

# 5. Migrate
DATABASE_URL_MIGRATION=postgres://plexco:plexco_dev@localhost:5432/plexco \
  pnpm --filter @plexco/db migrate

# 6. Set password cho 3 role runtime (MỘT LẦN cho mỗi cluster)
docker compose -f infra/docker-compose.yml exec -T postgres \
  psql -U plexco -d plexco -v ON_ERROR_STOP=1 \
    -c "ALTER ROLE app        WITH PASSWORD 'plexco_dev_app'" \
    -c "ALTER ROLE app_worker WITH PASSWORD 'plexco_dev_worker'" \
    -c "ALTER ROLE readonly   WITH PASSWORD 'plexco_dev_readonly'"

# 7. Chạy suite — ĐÂY là bước xác nhận máy đã dựng đúng
NODE_ENV=test DATABASE_URL_TEST=postgres://plexco:plexco_dev@localhost:5432/plexco_test pnpm -w test

# 8. Dev server (tuỳ chọn)
pnpm --filter @plexco/web dev
# Worker ở terminal khác, sau khi provision queue:
DATABASE_URL_MIGRATION=postgres://plexco:plexco_dev@localhost:5432/plexco \
  pnpm --filter @plexco/bot provision:queue
pnpm --filter @plexco/bot start:worker
```

**Kỳ vọng ở bước 7 (tại `e235ea4`):** `@plexco/core` 163 · `@plexco/db` 800 · `@plexco/web` 468 · `@plexco/bot` 59 = **1490**, cộng **128** ở lớp readiness/kit. Hai con số đó là **hai thang đo**, cấm cộng lại thành một.

> ℹ️ `README.md` §Setup vẫn pin mốc cũ (`1215a6a`, 34 migration). **Các lệnh vẫn đúng**, riêng con số thì đọc ở đây hoặc `ROADMAP.md` §📍.

### Bốn bẫy môi trường đã trả giá — đọc trước khi debug

1. **`NODE_ENV=production` trong shell.** Shell của owner từng export biến này; chạy test trong đó làm `apps/web` đỏ 4 test (cookie ra `__Secure-`, 1 test assert `NODE_ENV !== "production"`). **Không phải lỗi code.** Luôn `NODE_ENV=test`.
2. **Database `plexco_*` sót lại trong cluster.** Harness tạo database per-test; một lần chạy bị ngắt để lại 14 database rác, lần sau `tenant.test.ts` chết với `role "plexco_migrate_cleanup_fail_scratch" does not exist`. Dọn: `DROP DATABASE … WITH (FORCE)` cho tới khi chỉ còn `plexco` + `plexco_test`. **Dọn trước khi đo**, nếu không sẽ khai một drift không tồn tại.
3. **Test không được ghi file vào `process.cwd()`.** Một file rơi vãi untracked là đủ để validator `HALT WORKTREE_DIRTY` và chặn `ap-finish`. Dùng `mkdtemp(os.tmpdir())` + dọn ở `afterEach`.
4. **`next build` bắt lớp lỗi mà vitest và tsc không thấy.** App Router route chỉ được export HTTP verb + tập config cố định; helper phải nằm ở `lib/`. Một lần export helper từ route làm **fail toàn bộ build** trong khi test và typecheck xanh.

---

## 7. Cách làm việc trong repo này

**Mặc định là Level 3 supervised autonomy** (`docs/autopilot-templates/level3-workflow.md`): agent tự kéo context, tự chia slice, dừng ở `READY | AWAIT | HALT`; **`AUTO_MERGE: off`**, owner giữ quyền merge/deploy và mọi quyết định sản phẩm.

**Làn `ap3`** (DD-120, 🟡 chưa ratify) là ngoại lệ hẹp: dispatcher tự khởi động run cho class `code-quality-p2`. Nhận biết bằng env `AP3_SLUG`/`AP3_TASK`/`AP3_BASE_SHA`/`AP3_STATE`. Không có bốn biến đó thì luật Level 3 áp nguyên. P0/P1, schema/migration, auth, tiền, i18n **không** đi làn này.

**Gate bắt buộc trước khi ra verdict hoặc commit docs/plan/spec:**

```bash
pnpm review:check:changed     # validator readiness — đỏ là hard stop
pnpm typecheck                # 4/4 project
pnpm lint
pnpm --filter @plexco/web build              # bắt lớp lỗi riêng, xem bẫy #4
```

Slice chạm auth/secret/permission/tiền/external input/deployment còn phải qua **một vòng security review độc lập** (`scripts/codex-review-pin.sh`). Reviewer không gọi được ⇒ `HALT TOOL_UNAVAILABLE`, **cấm tự hạ gate**.

**CI là cổng cuối** (`.github/workflows/ci.yml`, chạy trên `pull_request`): typecheck · format · `review:check` · lint · build · `pnpm -w test` với Postgres service. **Không merge khi CI chưa xanh**, kể cả khi review đã CLEAN — CI là lần chạy test độc lập duy nhất không do writer tự khai.

### Commit — repo này có root lock, không commit trần được

`.githooks/pre-commit` kiểm ba thứ: root working copy · branch `main` · caller giữ root-commit lock **và** `PLEXCO_COMMIT_OWNER` khớp owner của lock. Trình tự bắt buộc, **cùng một shell**:

```bash
scripts/autopilot-root-lock acquire --owner '<tên bạn>'
export PLEXCO_COMMIT_OWNER='<tên bạn>'
git commit -m "type(scope): mô tả" -m "what + why" -- <đường dẫn tường minh>
scripts/autopilot-root-lock release --owner '<tên bạn>'
git --no-optional-locks log --oneline -1    # xác nhận HEAD đã nhúc nhích
```

- **Luôn có `-m`.** `git commit` trần mở `$EDITOR`, thoát không lưu ⇒ *"Aborting commit due to empty commit message"* — im lặng với người không đọc kỹ. Đã mất một lượt vì đúng chuyện này.
- **`git commit -- <path>` chỉ nhận file đã tracked**; file mới phải `git add <path tường minh>` trước. Cấm `-A` và `-a`.
- Lý do có root lock là sự cố thật 22/07: nhiều phiên cùng ngồi repo root ⇒ chung `.git/index`, commit của phiên B quét luôn file staged của phiên A.
- Commit convention: `type(scope): mô tả`, body bắt buộc cho `feat`/`fix`, kèm `Ref: LINEAR-XXX` hoặc `Tracking: NO-LINEAR`.

### Ngôn ngữ trong docs — ranh giới là NGƯỜI ĐỌC, không phải loại file

- **Agent-facing ⇒ English:** `.claude/commands/*`, `docs/autopilot/contracts/*`, `level3-workflow.md`, và **mọi khối ```text paste vào Claude Code**.
- **Owner-facing ⇒ tiếng Việt:** `decisions.md`, `docs/product/*`, `docs/00-start-here/*` (kể cả file này).

---

## 8. Quyết định sống ở đâu

`docs/standards/decisions.md` là decision log (DD-xx). Trạng thái phân biệt rõ:

- `✅ Chốt (owner <ngày>)` — là contract, đọc được như luật.
- `🟡 Đề xuất` — **chưa** là contract, dù đã commit lên `main`. **Commit ≠ ratify.**
- `⬜ OPEN NOTE` — một phép đo đặt câu hỏi cho owner, không phải amendment.

**Đang chờ owner tại `e235ea4`** (mỗi mục một dòng ✅ là xong):

| Mục | Chặn cái gì |
|---|---|
| **DD-116 FE PENDING** | 100% scope launch. Gỡ chỉ khi đủ ba vế: chọn 1 `.pen` canonical · tracked trên `main` · owner ký gate DD-81 → ⚠️ **12/10: GỠ bởi DD-122**, không qua trigger `.pen` |
| **DD-119** 🟡 | Carve-out cho designer dựng `plexco.pen` untracked — chưa ratify ⇒ designer vẫn chưa được vẽ → ⚠️ **12/10: superseded bởi DD-122** (không cần `.pen`) |
| **DD-120** 🟡 | Làn ap3 proactive |
| **DD-56 amendment #3** (draft) | Route ĐỌC session |
| **OPEN NOTE DD-56** (15/09) | Cổng tạm nay phủ **BẢY** route (2 route guest-note) trong khi amendment #2 pin **NĂM**. Cần chữ ký, không phải sửa code |
| **Tier C** C1–C6 | roster writer · ngôn ngữ per-user · launch self-serve hay provision tay · `GOOGLE_OAUTH_*` · A3 luật sư · outbox attempt bound |

**Luật viết docs của repo:** quyết định chưa chốt ghi dạng proposal (🟡/⬜), **không** viết vào spec đã Reviewed. Rule mới dạng văn xuôi thì **không** — chỉ ghi thứ đo được + một row backlog.

---

## 9. Việc kế tiếp nếu bạn nhận repo hôm nay

Ưu tiên đã chốt: **lane BE + infra trước, FE và legal xếp sau**.

1. ~~**Projector thật thay `productionStubDeliver`** (row `projector-real-replace-stub`). Đây là nút thắt: schedule OFF, `announce` không có route, sync engine "infra-only" đều quy về nó.~~ ⛔ **Đo 27/10/2026:** ba projector đã nối module thật (`apps/bot/src/projectors/index.ts`), default commit của cờ lịch là `true` (B3, DD-141); bật dùng thật là CLI owner `scripts/outbox-projector-enable.mjs` + token Zalo thật cho `zalo_dm` (P0 của owner).
2. **Route ĐỌC session** — chờ DD-56 amendment #3 ký, code thì đã có đủ tiền đề.
3. **DD-29 capability wiring** — `resolveCapability()` còn 0 caller ⇒ hard-dependency (a) của phase-1 vẫn mở, billing chưa gate được nhánh tiền nào.
4. **`app-worker-password` (L8)** và **`migrate-gate` (L4a)** trong hàng đợi infra.
5. ~~Đừng mở lane FE trước khi DD-116 được gỡ~~ ⚠️ **12/10/2026: DD-116 đã gỡ bởi DD-122** — lane FE mở theo RUN doc Web MVP; review của chương trình đó theo DD-122 D4 (không Codex), mọi task khác vẫn theo §7 ở trên. Gói tài liệu cho designer đã tồn tại từ 14/08 (`docs/channels/web/designer-docs-guide.md`).

---

## 10. Bẫy đã trả giá — đọc để khỏi trả lần hai

**Về code:**

- `now()` **đóng băng** ở đầu transaction và không nhích trong lúc chờ lock ⇒ mọi predicate hết hạn/khoá đánh giá **sau** `FOR UPDATE` phải dùng `clock_timestamp()`, và phải revalidate dưới khoá chứ không tin snapshot đọc trước.
- Cookie tiền tố `__Host-`/`__Secure-`: header xoá **không có `Secure`** bị trình duyệt bỏ qua ⇒ xoá bằng SET rỗng `maxAge: 0` giữ nguyên thuộc tính, **không** `cookies().delete()`. Bug này từng làm logout không xoá được cookie trên production.
- `NOT VALID` **không** khoan dung row cũ — nó vẫn enforce trên mọi UPDATE. Muốn "chặn giá trị mới, tha row cũ" thì dùng **TRIGGER**.
- Hash tra cứu và hash xác thực phải phủ **phần khác nhau** của bí mật; nếu không, nhánh "sai mã" không tồn tại và cột đếm attempt chỉ là trang trí.
- `scryptSync` chặn event loop 70–160 ms mỗi lần gọi — trong Next.js là chặn cả process.
- `setInterval` bắn theo đồng hồ tường ⇒ vòng lặp I/O phải có overlap guard + timeout, nhất là khi dùng chung pool với thứ nó quan sát.
- Hàm "làm sạch để log" phải nhận `unknown`, **không bao giờ ép kiểu** (`String(Symbol())` ném).
- Lane thêm migration phải sửa `MIGRATION_COUNT` **và mọi danh sách hard-code khác** (`rls-invariants` pin nguyên set hàm `job_definer`). Grep `toEqual([` trước khi thêm object mới.
- Test dùng harness nhiều database: `ctx.superuser` nối tới database **BASE**, không phải per-test db. Dữ liệu và catalog per-database đều phải qua connection tới `ctx.dbName`.
- **Sửa code là phải đi soát test đang assert hợp đồng CŨ.** Đỏ sau khi fix thường là dấu hiệu fix đúng — nhưng phải lật assertion trong **cùng** lane.

**Về cách làm việc:**

- **`grep` một file không chứng minh được gì về thứ file đó GỌI.** Một lần grep `git status` trong `autopilot-scope-gate` ra 0 dòng rồi kết luận sai; scope-gate không tự chạy `git status`, nó gọi validator, và validator mới là chỗ halt. Đo bằng cách lần theo lời gọi.
- **Sự tồn tại của một symbol không phải là khả năng tới được của nó.** `resolveCapability()` tồn tại nhưng 0 caller — đó là "code dark", không phải feature.
- **Vòng review độc lập chạy sau MỖI lần sửa, không chỉ lần cuối.** 3/10 finding của một đợt là bug production thật mà 1404 test xanh + typecheck + lint + build không thấy; 1 finding do chính bản vá vòng trước sinh ra.
- **Reviewer đọc giỏi nhưng không chạy được test.** Nó không thay thế việc tự chạy gate trên máy thật.
- **Thông báo "file was modified" của Claude Code trông giống prompt injection nhưng không phải.** Một lane từng phân loại nhầm thông báo chuẩn của harness thành injection và ghi cảnh báo vào memory riêng. Phép kiểm 30 giây trước khi báo động: `git diff` xem thay đổi có khớp việc mình vừa làm không, `git log --oneline -3` xem có process nào khác vừa ghi không — nội dung do harness sinh ra thì không nằm trong diff của ai cả.

---

## 11. Bảng tra nhanh

| Cần gì | Đi đâu |
|---|---|
| Trạng thái thật + số đo | `docs/product/ROADMAP.md` §📍 |
| Nhật ký từng đợt, ai đo gì khi nào | `docs/00-start-here/HANDOFF.md` (khối mới nhất ở đầu) |
| Schema/data model **authority** | `packages/db/schema.ts` + `packages/db/migrations/*.sql` |
| Quyết định đã chốt | `docs/standards/decisions.md` |
| Scope sản phẩm | `docs/product/BRD.md` §📍 |
| Hành vi/user flow | `docs/product/PRD.md` §📍 (chỉ mục 16 FLOW) |
| Contract kỹ thuật + khoảng cách as-built | `docs/product/TDD.md` §📍 (13 lớp) |
| Spec từng feature | `docs/features/FE/` (Product) + `docs/features/BE/` (Tech) — 27 cặp |
| Thiết kế màn web | `docs/channels/web/FE/` — 17 FE design spec |
| Luật session/agent | `CLAUDE.md` · `AGENTS.md` |
| Gate review/readiness | `docs/standards/review-code-readiness-gate.md` |
| Identity model (orientation, **không** phải authority) | `docs/00-start-here/identity-model.md` |

**Lệnh hay dùng:**

```bash
pnpm -w test                                   # toàn bộ suite (cần DATABASE_URL_TEST + NODE_ENV=test)
pnpm test:db                                   # chỉ packages/db
pnpm typecheck && pnpm lint
pnpm review:check:changed                      # validator readiness
pnpm db:reset:test                             # dựng lại database test
DATABASE_URL_MIGRATION=... pnpm --filter @plexco/db migrate
```

---

_DEV-ONBOARDING v1.0 — 15/09/2026, đo tại `main@e235ea4`. Số liệu trong file này hết hạn ngay khi `git diff --name-only e235ea4..main -- packages apps scripts` không còn rỗng; khi đó đọc `ROADMAP.md` §📍 thay vì file này._
