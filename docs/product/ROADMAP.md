# 🗺️ ROADMAP — Plexco

**Phiên bản:** v3.18
> ⚠️ *Đính chính version: header đứng ở v3.7 trong khi changelog đã tới v3.8 (mirror DD-116, 24/08) — dòng header không được bump lần đó. v3.9 gánh cả phần lệch này.*
**Ngày tạo:** 16/06/2026 · **Cập nhật:** 19/09/2026
**Căn cứ:** `BRD.md` v3.10 · `PRD.md` v2.9 · `TDD.md` v3.2 · `../standards/decisions.md` (current — đọc bảng tổng hợp + changelog của chính file đó; **không pin version decisions ở đây** vì số chép tay đã stale một lần: header này từng ghi v2.11 trong khi live là v2.19) · `../features/FE/feature_channel_booking_funnel.md` + BE companion · `../standards/BUILD-STATUS.md`

> ROADMAP là nguồn sự thật cho **delivery order + dev progress**. Product scope thuộc BRD; behavior thuộc PRD; implementation contract thuộc TDD.


## 📍 Tiến độ thực tế (đọc mục này TRƯỚC — và cập nhật mục này TRƯỚC mọi mục khác)

> **📌 Repo truth snapshot — MỘT pin cho tất cả: `main@12f5191` (19/09/2026).** Cả số **cấu trúc** (migration · test file · route · spec · static) lẫn **trục Tests** đều đo tại đây, **trong cùng một lần chạy**, nên pass này **không cần điều kiện carry giữa hai SHA**.
> **Mã nguồn tại pin này ≡ `origin/main@00cc510`.** Ba commit local trên đầu chỉ chạm `docs/`, `tools/`, `package.json` (`0601229` re-pin docs · `c2132b5` `tools/progress.mjs` · `12f5191` `DEV-ONBOARDING.md`), chứng minh bằng lệnh chứ không bằng lời:
> ```bash
> git diff --name-only 00cc510..12f5191 -- packages apps scripts   # → (rỗng, 0 file)
> ```
> **ĐIỀU KIỆN CARRY — viết bằng LỆNH, không bằng SHA. Mọi số dưới đây còn hiệu lực chừng nào lệnh này trả RỖNG:**
> ```bash
> git diff --name-only 12f5191..main -- packages apps scripts   # → (rỗng) ⇒ số dưới đây còn đúng
> ```
> **Cách đo (tái tạo được):** `git worktree` tách rời tại `12f5191` · `pnpm install --frozen-lockfile` (2,3 s) · `NODE_ENV=test` · Postgres `docker plexco-postgres-1` · `DATABASE_URL_TEST=postgres://plexco:plexco_dev@localhost:5432/plexco_test` · `pnpm test` **exit 0** (94 s) · `pnpm typecheck` **exit 0** · `pnpm lint` **exit 0** · `pnpm format:check` **exit 0** · `pnpm review:check` **exit 0** · `pnpm build` (`next build`) **exit 0**, route table sinh đủ **15 API route + `/healthz`** · `git status --porcelain --untracked-files=all` **rỗng** sau khi chạy trọn suite (bug 24 vẫn đóng).
> 🔴 **Bẫy môi trường lặp lại đúng lần thứ hai — và lần này nó cũng chỉ ra cách đóng hẳn:** 14 database `plexco_*` per-test lại sót trong cluster từ lần chạy 15/09. Pass này dọn **TRƯỚC** khi đo (`DROP DATABASE … WITH (FORCE)`, giữ `plexco` + `plexco_test`) ⇒ suite xanh ngay lần đầu, không mất một vòng như 15/09. Đo tiếp sau khi chạy: suite lại để lại **15** db per-test. ⇒ **dọn cả TRƯỚC lẫn SAU khi đo**; harness không tự thu dọn và đó là lý do cái bẫy này quay lại đúng một tuần sau.
> ⚠️ Đây là **ảnh chụp**, không phải số vĩnh viễn. Số không tái tạo được bằng §Cách đọc tiến độ → "Lệnh tái tạo số đếm" ⇒ coi như **stale**, không dùng để ra verdict.

**Một câu trạng thái:** 38 commit từ `e235ea4` là **hardening + kit, không phải feature** — 14 PR (#14–#27, đợt `codebase-fixes-2026-09-16`) cộng hai kit roll-in W5.2.6/W6 và hai migration `0045`/`0046`; **không một ô ma trận nào đổi**, **FE vẫn 0 màn**, nên theo **luật 5** sản phẩm vẫn **⬜ chưa host nào dùng được** và thanh tổng **~33% không đổi**.

```text
TỔNG (code, theo slice roadmap)  ██████░░░░░░░░░░░░░░  ~33%
   ├─ nền móng (core + db/RLS)   ███████████████████░  ~90%  ✅ có test, có invariant
   ├─ auth (lane Google)         ████████████████░░░░  ~80%  🟢 code+measurement xong · ⛔ chưa bật
   └─ feature nghiệp vụ          █░░░░░░░░░░░░░░░░░░░   ~5%  ⬜ chưa có surface nào dùng được
```

**LUẬT THANH (ghi ở đây, không đổi lặng lẽ):** thanh của mỗi delivery group tính **máy móc** từ ma trận §📊 — chỉ **trục code** Migration · BE · FE/UI · Tests · Invariant, **không tính Spec** (luật 1); `✅` = 1 · `🟢`/`🟡` = ½ · `⬜`/`⛔` = 0; ô `—` bỏ qua, không tính vào mẫu số. `%` = tổng ÷ số trục có tính. **Sửa một ô ma trận ⇒ phải tính lại thanh ở MỌI chỗ.** Thanh `~33%`/`90`/`80`/`5` ở khối trên là **thang khác** (slice roadmap), giữ riêng, không trộn.
> 🔧 **Từ 19/09 luật này chạy được bằng máy:** `pnpm progress` (`tools/progress.mjs`) đọc thẳng ma trận §📊 và in lại thanh của từng group theo đúng công thức trên, kèm số cấu trúc đo tại một ref có tên và điều kiện carry ở trên. Nó **không** sửa ô ma trận (đó vẫn là phán đoán của người) và **không** chạy suite (số test có authority riêng). Dùng nó để phát hiện pin đã mục trước khi trích số đi đâu khác.

| Delivery group | Thanh @ `12f5191` | Δ so `e235ea4` | Trục yếu nhất (= trạng thái thật) |
|---|---|---|---|
| P0–P1 Foundation | `██████████████░░░░░░` **70** | — | FE/UI ⬜ |
| P0–P1 · 3b Auth (Google) | `████████████████░░░░` **80** | — | ⛔ chưa bật (owner go-live) |
| Tenant-integrity FK (DD-68) | `████████████████████` **100** | — | đóng · 0 hành vi product |
| Naming-identity CHECK | `████████████████████` **100** | — | đóng · rename-only |
| Audit hardening `0037`–`0042` | `████████████████████` **100** | — | đóng · 0 hành vi product mới |
| Shared job runtime | `█████████████████░░░` **88** | — | BE 🟡 · schedule OFF, projector stub |
| Public read model fence | `█████████████████░░░` **88** | — | đóng structural |
| Session command family | `██████████████░░░░░░` **70** | — | FE/UI ⬜ |
| Session API surface | `████████████░░░░░░░░` **63** | — | FE/UI ⬜ · 0 route ĐỌC |
| DD-29 capability registry | `████████████░░░░░░░░` **63** | — | chưa nhánh tiền nào bị gate thật |
| Chat DB root | `████████████░░░░░░░░` **60** | — | BE ⬜ · 0 service |
| Identity link (`0034` + `0043`) | `████████████░░░░░░░░` **60** | — | code dark · 0 caller production |
| Tenant locale (DD-118) | `████████████░░░░░░░░` **60** | — | BE 🟡 |
| P2–P3 · P2.5 · P3.5 · P4–P4.3 · P4.5–P4.7 · P5 · P6 | `░░░░░░░░░░░░░░░░░░░░` **0** | — | ⬜ Not Started |

> **Vì sao không thanh nào nhúc nhích, nói thẳng thay vì để người đọc tự đoán:** `0045` là guarded tenant context cho guest note và `0046` là bound cho cleanup rate-limit — cả hai **siết chặt hành vi đã land**, không mở hành vi mới; 12 PR còn lại là hardening web/bot/db/core cùng loại; hai kit roll-in không chạm sản phẩm. Theo luật 5 trục yếu nhất của mọi group đang dở vẫn nguyên chỗ cũ. **Một tuần thứ tư liên tiếp migration tăng mà hành vi product không đổi.**
> 🟡 **Một lựa chọn để owner quyết, phiên này KHÔNG tự quyết:** đợt `codebase-fixes-2026-09-16` có đúng hình dạng của nhóm **Audit hardening `0037`–`0042`** đã được cấp một hàng riêng ở §📊 (bundle hardening đóng, 0 hành vi product mới). Cấp cho nó một hàng nữa hay gộp vào hàng cũ là **thay đổi ma trận**, tức phán đoán — không phải phép đo — nên để nguyên cho tới khi owner chọn.

**Số đo @ `12f5191` (rút gọn — bản đầy đủ ở §📊):**

| Hạng mục | `e235ea4` (15/09) | `12f5191` (19/09) | Ghi chú |
|---|---|---|---|
| Migration | 45 (tail `0044`) | **47** (tail `0046`) | +2: `0045` `guest_note_tenant_context` (guarded tenant context) · `0046` `rate_limit_bounded_cleanup` |
| Test file | 54 + 4 `scripts/*.test.mjs` | **59** + **4** | +5, đếm theo đuôi runner: core 11 · db 15 · web **26** · bot **7** |
| Test case — **runner workspace** | 1490 | **1823** | core **199** (11 file) · db **858** (15) · web **643** (26) · bot **123** (7) |
| Test case — **runner readiness/kit** | 128 | **172** | `# pass 172 · # fail 0`, 4 file `scripts/*.test.mjs` — **thang đo RIÊNG, cấm cộng vào 1823** |
| Test case — static cross-check | 1308 | **1376** | core 161 · db 780 · web 353 · bot 82 |
| API route | 15 (**7** nghiệp vụ) | **15** (**7** nghiệp vụ) | không đổi — 6 auth + 2 onboarding + 7 session; vẫn **0 route ĐỌC** |
| Session command | 8 | **8** | không đổi (`packages/db/src/session-service.ts`, **2910** dòng) |
| Invariant test | 5 file | **5 file** | không đổi |
| Feature spec | 27 Product + 27 BE | **27 + 27** | không đổi |
| FE spec (lớp riêng) | 17 | **17** | không đổi — luật 3 |
| Màn FE nối API thật | **0** | **0** | 🔴 FE PENDING (DD-116; carve-out DD-119 **chưa ratify**) |

**Luật 4 (đối chứng `static + Σ generated = runner`) — trạng thái tại `12f5191`: 🟡 CHƯA ĐÓNG Ở LỚP NÀO.**

- Pass này **không dựng bảng kiểm kê generator nào**, nên không lớp nào được khai là đóng — kể cả hai lớp từng đóng ở `e235ea4` (`core 157+6` và `bot 59+0`). Ở `12f5191` static core **161** vs runner **199**, static bot **82** vs runner **123**: cả hai lớp đã có thêm generator mà **chưa ai kiểm kê**, nên tuyên bố "vẫn đóng" sẽ là chép lại một kết luận đã hết hiệu lực.
- **Phần dư cần kiểm kê:** core **38** · db **78** · web **290** · bot **41** · readiness **62**. **Năm số đó KHÔNG được viết như hiệu** `199−161`, `858−780`, `643−353`, `123−82`, `172−110` — đúng kiểu đóng băng tiền đề mà luật 4 sinh ra để chặn (xem nợ `162` của khối 🟪 04/09 và `137` của khối 🟩 03/09). Bảng kiểm kê phải dựng **tay, từng site**, theo độ sâu ngoặc.
- ⚠️ **Nợ này KHÔNG làm trục Tests `STALE`:** runner là authority và chạy trực tiếp tại chính SHA đang pin. Cái còn nợ là **phần đối chứng**, không phải con số.
- 🔴 **Metric của lớp readiness/kit đã đổi thành phần — bắt được ở pass này, ghi để không ai đọc nhầm bước `128 → 172`:** output `node --test` nay có **plan `1..130` nhưng `# pass 172`**, trong khi ở `0aff7ad` hai số này khớp nhau (`1..124` · `# pass 124`). Chênh lệch là **subtest lồng** nay được đếm vào `# pass`. Số khai vẫn là `# pass` (cùng một metric qua mọi mốc) nhưng **`+44` KHÔNG phải là "44 test mới"** — phần nào là test mới, phần nào là subtest trước đây không được đếm, chỉ bảng kiểm kê tay mới trả lời được. Static của lớp này là **110** (4 file, đúng lệnh trong §Cách đọc tiến độ).

**Blocker / chờ owner (mỗi mục một dòng ✅ là xong):**

- 🔴 **FE PENDING (DD-116 Option B)** — gỡ chỉ khi đủ ba vế (canonical `.pen` · tracked trên `main` · owner ký gate DD-81). Owner **hoãn có chủ đích từ 03/09**; ghi ở đây một dòng, không hỏi lại.
- 🔴 **DD-56 — hai route guest-note chưa có chữ ký.** OPEN NOTE đã vào `../standards/decisions.md` v2.49 (15/09) nhưng **vẫn chưa ký**: choke-point tạm `apps/web/lib/session-command-route.ts` nay phủ **BẢY** route trong khi amendment #2 pin **NĂM** và điều khoản 1 của amendment #1 đòi decision riêng cho mỗi route. Không phải lỗi code — là **decision còn thiếu**.
- 🟡 **DD-119 chưa ratify** (carve-out designer dựng `plexco.pen` untracked).
- 🟡 **DD-120 chưa ratify** (làn ap3 proactive cho class `code-quality-p2`).
- ⬜ **DD-56 amendment #3** (route ĐỌC session) — draft, chưa ký ⇒ row `session-read-routes-list-detail` vẫn `blocked`, và Milestone 2 của `ap3/features/session-management/PLAN.md` (supervised) chưa chạy được.
- 🟡 **`main` đang trước `origin/main` 3 commit, chưa push** (`0601229` · `c2132b5` · `12f5191`) — push là việc tay owner.
- ⬜ **Tier C** (audit 06/09): C1 roster writer · C2 ngôn ngữ per-user · C3 launch self-serve hay provision tay (OPEN NOTE DD-114 D6) · C4 `GOOGLE_OAUTH_*` · C5 A3 luật sư · C6 outbox attempt bound · posture grant `0043` · `DB_EXPECTED_ROLE` bắt buộc hay không.

**Đang bay (không tính vào bất kỳ trục nào — luật 1):**

- 🔴 **Hàng đợi ap3 RỖNG — 0 task dispatchable** (`ap3/queue/` chỉ còn `EXAMPLE.md` + 4 file trong `done/`). Làn tự động đang không sản xuất gì; nó nghỉ vì hết việc, không phải vì hỏng.
- Class `code-quality-p2`: `enabled`, `clean_runs 4`, last exception `MISSING_CONTEXT`. Class `feature-session-p2`: `enabled`, **`clean_runs 0`**, last exception `MAX_ROUNDS` — M3b phải finish supervised nên class này **chưa từng có một run READY không người can thiệp**.
- 6 worktree còn mở trong repo (3 `.autopilot/worktrees/codebase-fixes-2026-09-16--*` của PR đã merge + 2 `ap3/state/worktrees/*` + root) — dọn lúc rảnh, 0 tác động.

**Kế tiếp (theo hàng đợi đã chốt, ưu tiên sản phẩm/infra):** nạp lại hàng đợi ap3 (rẻ nhất: 6 row `audit-2026-09-06-*`, P2/P3 phạm vi hẹp — nhưng `allowed_scope`/description của class hiện tại **không phủ** chúng, nên cần owner sửa `ap3/routines.json`) · route ĐỌC session (M2, supervised, chờ amendment #3) · projector thật thay `productionStubDeliver` (row `projector-real-replace-stub`) — mở schedule mới có nghĩa · `app-worker-password` (L8) · `migrate-gate` (L4a).

**Chuyển động gần nhất (`e235ea4` → `12f5191`, 38 commit, 14 PR):**

- **Đợt `codebase-fixes-2026-09-16` (PR #15–#27, 16–17/09):** bound OAuth + onboarding body read · bound cleanup rate-limit hết hạn (`0046`) · guarded tenant context cho guest note (`0045`) · authorize guest-note route context · bootstrap member kiểm theo **catalog OID** · reject payment integer không an toàn · chặn dispatcher completion dị dạng · bot test lifecycle join trước teardown · giữ pool checkout API + retry role check · capacity guard của `UpdateSession` **tính cả guest note** · eslint bỏ qua ap3 runtime state · readiness validator nhận literal route target.
- **PR #14 (12/09):** `ap3-intake` cho `session-management` ⇒ `READY_WITH_SUPERVISED_SLICES`, kèm đính chính `players_status_chk` chưa bao giờ có `pending`.
- **Kit ap3:** W5.2.6 (K22–K30) và W6 (self-resolving HALT + intake ask-back).
- **Docs/tools local, chưa push:** `0601229` re-pin authority chain (chính là pass 15/09, rebase lên `origin/main` ngày 19/09 — hai file spec session lấy bản upstream mới hơn) · `c2132b5` `tools/progress.mjs` + `pnpm progress` · `12f5191` `DEV-ONBOARDING.md` (đo 19/09: file này chưa bao giờ nằm trong một commit nào, chỉ sống ở working tree từ 15/09).

## Canonical Delivery Groups

> Cột **Duration** = ước lượng thời lượng thực thi. **Chưa owner điền** → `TBD` ở mọi dòng: file này **không** phát sinh cam kết ngày từ suy đoán.
> Cột **Traction signal** = bằng chứng *thực tế* để ưu tiên hoặc re-evaluate phase, tách khỏi dependency kỹ thuật. Dependency nói "làm được chưa"; signal nói "**nên** ưu tiên lúc nào". Signal không phải hard dependency hay `CODE_READY` gate; chỉ owner record trong `decisions.md` mới được defer/reorder một slice đã sẵn sàng kỹ thuật.

| Delivery group | Canonical | Nội dung | Duration | Traction signal (ưu tiên/re-evaluate khi…) |
|---|---|---|---|---|
| **Foundation** | **P0–P1** | Repo + core + Postgres/RLS + schema đa môn + 3 tầng hiển thị + test cô lập + **Google login / tài khoản web** | `TBD` | — (root, không gate) |
| **Tenant Engine** | **P2–P3** | Zalo tenant + **Messenger hybrid shared surface (P2.5)** + mark-paid + durable webhook/ledger + dogfood | `TBD` | Google login **ENABLED** thật (không chỉ merged) + 1 host đăng nhập được |
| **Identity** | **P3.5** | Person/ChannelIdentity/Reachability/Membership + **link Facebook/Zalo** + merge an toàn | `TBD` | Tenant #1 chạy ≥ **4 buổi thật** trên Zalo/Messenger, có ≥ 1 ca 1-người-2-kênh quan sát được |
| **Web + Sync + Marketplace** | **P4–P4.3** | Web surface + canonical backend + sync engine + onboarding + **chat in-app + cài đặt hồ sơ/giá theo giới tính** + discovery/join | `TBD` | ≥ **2 tenant** vận hành thật (1 có Page riêng, 1 dùng central) + ledger khớp sổ tay 2 kỳ liên tiếp |
| **Player-side channels** | **P4.5–P4.7** | Join Zalo/Messenger + nhắc/xác nhận + player view | `TBD` | ≥ **20 kèo public/tuần** trên marketplace (đủ cầu để player-side có việc để làm) |
| **Billing** | **P5** | Subscription host + vòng đời tenant | `TBD` | ≥ **3 host ngoài** dùng ≥ 4 tuần liên tục **và** ≥ 1 host hỏi/chấp nhận trả phí |
| **Harden & Scale** | **P6** | Pen-test, load test, observability, ToS/Privacy | `TBD` | Có doanh thu thật hoặc ≥ **10 tenant** — bất kỳ điều kiện nào đến trước |
| **Session Organize** *(accept-in-principle)* | **Post-P4 · TBD** | ✅ DD-61–64 (owner 18/07) — sân + trận 2 phía + assign 4-mode + live score; tenant-private, không public; build sau Session CRUD+Sync. DD-63 `balanced` degrade tới khi có level source | `TBD` | Ngoài committed timeline — không gate, không lên hàng đợi |
| **App Native** *(direction ✅ · build TBD)* | **Phase-2 · TBD** | ✅ DD-69 direction accepted (owner 18/07); RN+Expo recommendation sau spike; reuse chỉ client-safe TS contracts/format + canonical API, không import server i18n/money core. Native build chưa lên lịch/chưa chốt nền tảng. **DD-113 (22/08): native nằm NGOÀI launch** — launch là web app + Zalo bot song song | `TBD` | **DD-113 pin thành ngưỡng đo được:** ≥5 host vận hành ≥4 tuần trên web app · host weekly return ≥60%/4 tuần · PWA install rate ≥30% host **đo tách iOS/Android** · `/api/v1`+bearer/refresh+client-safe contracts đã land · nêu được ≥1 capability push/offline mà PWA **đo được là không làm nổi** |

> ⚙️ **DD-114 (22/08) — phase-1 cắt NGANG bảng này, không thay nó.** Bảy nhóm feature của phase-1 rơi vào **P0–P5 trừ discovery/chat**: nhóm 1 → P0–P1 · nhóm 3 → P2 · nhóm 6 vế tiền → P2/P3 **+ P5** (billing, vì `host_pro` gate) · nhóm 4 → P3.5 · nhóm 2/5/7 → P4–P4.3. Bảng này vẫn là **delivery order canonical**; DD-114 chỉ nói **nhóm nào thuộc phase-1** và **thứ tự ship ba làn** (A launch · B mở cửa host ngoài · C từng gate riêng). Khi hai bên có vẻ lệch: bảng này thắng về *dependency*, DD-114 thắng về *phạm vi phase-1*.
>
> **Traction signal không tự chặn code.** Nếu owner dùng signal để defer/reorder một slice đã sẵn sàng kỹ thuật, phải ghi quyết định đó vào `decisions.md`; không im lặng đổi dependency order.

---

## Positioning

> **Plexco — platform quản lý & khám phá hoạt động thể thao đa môn, cho cả host lẫn player. Phase-1 dùng Zalo/Facebook Messenger để acquisition/external touchpoint/fallback và đặt in-app Chat làm primary daily player surface mục tiêu.**

Ba giá trị cốt lõi: **Quản lý kèo & tiền (host)** + **Khám phá & join kèo (player, đa môn, cross-club)** + **Đồng bộ liền mạch đa kênh ⇄ Plexco**. Plexco không xoá nhóm chat sẵn có và vẫn giữ acquisition 0-install, nhưng DD-91 chủ đích chuyển hành vi hằng ngày của player về in-app Chat. Direction này chưa phải runtime.

> **DD-79/DD-81 ✅ direction (19/07; current mirror 28/07 — ⚠️ câu "FE HOLD … sau gate này" ở cuối đoạn đã HẾT HIỆU LỰC: FE nay là PENDING theo lệnh owner 13/08, gate không còn là thứ chặn):** S9 web app shell target gồm **Home hub landing** (composition-only trên player_view/marketplace/§A — spec Reviewed v0.7 + BE v0.3) + **bottom-nav registry** config-driven (5 slot; Feed gated DD-76; 💬 chat header) — không đổi thứ tự slice/dependency. Design tool là **Pencil**, canonical root path = `design.pen`, nhưng file chưa được persist/track + owner nghiệm thu làm authority. FE HOLD và theme exploration/handoff chỉ bắt đầu sau gate này.
>
> **Định hướng app-native (DD-69 ✅ accepted; ⚙️ re-sequenced bởi DD-113 owner 22/08):** Plexco là app-first — **phase-1 target = web app** (installable/offline là đích; S9/S20 planned, chưa live; chưa có manifest/SW nên chưa được gọi "PWA" — DD-113), **phase-2 = app native**. Zalo/Messenger vẫn là acquisition 0-install; in-app Chat là daily target; native cho retention. Owner đã accept **định hướng**; native **build** chưa vào timeline committed — chờ các gate client-contract, `/api/v1`, bearer/iOS login, dedicated device push, privacy-safe payload, offline read-only và store review.
>
> **DD-113 (owner 22/08) bổ sung hai điều, không đảo DD-69:** (1) **web hết vai "fallback"** — web app và Zalo bot ra mắt **song song**, phạm vi mỗi surface do thiết kế quyết định chứ không do giới hạn Zalo quyết định. Căn cứ là số đo: DD-69 đặt web app làm phase-1 target từ 18/07, nhưng tới `a151b15` vẫn **0 màn FE / 1 `page.tsx` / 0 route nghiệp vụ** — nhãn "fallback" là thứ khiến surface đó không được build. (2) **gate mở native được viết thành ngưỡng đo được** thay cho "TBD" (≥5 host ≥4 tuần trên web app · weekly return ≥60% · install rate ≥30% **tách iOS/Android** · `/api/v1`+bearer/refresh đã land · nêu được capability PWA đo được là không làm nổi). Launch scope web app v1 = 5 khối: signin/signup · link Zalo bot · session management · session detail · settings.
>
> **DD-91 (owner 27/07):** in-app Chat = primary daily player surface target; exact `/pay` là deterministic requester-only overlay trong club/private bot/human DM, không LLM và không persisted result. Payment lifecycle cần durable Inbox + generic push. DD đã `DECISION_FINAL`; readiness của root/downstream chỉ đọc từ primary plan §13 và slice packet tương ứng, không suy từ roadmap.

---

## Context & Chiến lược

### GTM: platform có sẵn user để acquire (0-install) → Plexco làm daily hub

| Nhóm chat (giữ nguyên) | Plexco (bổ sung) |
|---|---|
| Chat, hẹn giờ, bàn kèo; acquisition/fallback | Tạo/quản kèo (đa môn), roster, track ai trả/chưa; in-app Chat là daily target |
| Kênh thông báo tự nhiên | Đối soát CK tự động, nhắc/xác nhận tự động |
| Group Zalo / Facebook Messenger sẵn có | Bot DM (Zalo) / Page bot (Messenger) |
| (không có) | **Web app**: dashboard host, **marketplace tìm kèo**, player view, **in-app Chat primary target** — sync 2 chiều với mọi kênh |

→ Host không phải ép player cài app để acquire/join; player vào từ Zalo/Messenger, khám phá trên web, rồi Plexco hướng tương tác hằng ngày về in-app Chat khi DD-91 plan/runtime đủ gate.

### Vòng tăng trưởng 2 phía (network effect)

```text
Host publish kèo  ──▶  Marketplace nhiều kèo/đa môn  ──▶  Player tìm & join
      ▲                                                          │
      └──────── player mới kéo theo nhu cầu  ◀───────────────────┘
1 host mới = ~20–40 player tự vào hệ thống; player discovery = kênh acquisition phía cầu.
```

### Bootstrap (Day-1)

| Metric | Giá trị |
|---|---|
| Tenant #1 | CLB của founder (migrate data từ bot single-club đang chạy; go-forward vận hành trên Zalo/Messenger/web) |
| Môn khởi điểm | Cầu lông (beachhead) → mở pickleball/tennis khi có cầu |
| Buổi/tuần · Day-1 players | ~2 buổi · ~50 unique |

### Target Personas

| Persona | Mô tả | Pain point |
|---|---|---|
| **P1 Host** (Nam, 30t) | Tổ chức cầu lông hàng tuần, 15–30 người | Soi sao kê CK thủ công, đòi nợ lắt nhắt, dữ liệu phân mảnh |
| **P3 Player member** (Huy, 25t) | Chơi 2–3 buổi/tuần, nhiều CLB | Không rõ nợ buổi nào, CK rồi mà chưa được xác nhận |
| **P4 Player discovery** (Lan, 28t) | Muốn chơi thêm môn/CLB mới | Không biết quanh mình có kèo nào mở, môn mình thích, còn slot |

### Team

| Role | Focus |
|---|---|
| **Solo Dev** | Full-stack (TypeScript: Next.js + HTTP channel adapters + Drizzle/Postgres + SSE) |
| **AI Assistant** | Co-pilot: code, design docs, review |
| **Founder** | PM + QA + dogfood (tenant #1) + acquire host & seed marketplace |

### Khác biệt nền tảng (vs app-based)
Plexco xây **repo riêng**; lift logic thuần (matching, payments-logic, dates, format, sports) từ bot single-club sang `packages/core`; viết lại tầng data trên **Postgres + RLS**, thêm **public read model** + **sync engine**. Bot cũ (Telegram, lịch sử) **đóng băng, vẫn chạy** làm reference + migrate data thành tenant #1 khi cutover; go-forward CLB vận hành trên Zalo/Messenger/web.

---

## 7 Feature Tracks

| # | Track | Mô tả ngắn | Phase |
|---|---|---|---|
| 🏢 | **Multi-tenant Core + 3-tier** | repo choke-point + Postgres RLS + public read model + routing tenant theo kênh + **đa môn** + **Google login** | P0–P1 |
| 💰 | **Payment Reconciliation** | **mark-paid thủ công toàn cầu** + durable webhook → transaction → allocation → charge/debt → /unmatched; auto cần `payment_reconcile_auto` + market/provider/bank/currency/consent | P2/P3 |
| 🆔 | **Identity & Merge** | Person/ChannelIdentity/Membership, claim an toàn, **link Facebook/Zalo**, merge xuyên kênh | P3.5 |
| 🌐 | **Web app + Sync engine** | web surface + canonical backend + command/outbox/projection + realtime + **in-app Chat primary player target** (DD-38/DD-91) + cài đặt hồ sơ/giá theo giới tính | P4 |
| 🔎 | **Marketplace Discovery** | publish kèo → public projection → tìm kèo → join cross-club | P4.3 |
| 🎯 | **Player-side channels** | join Zalo/Messenger, nhắc, xác nhận | P4.5–P4.7 |
| 🔒 | **Security & Ops** | KMS, audit, token-drift, **bất biến public**, load/pen-test, sync-lag | xuyên suốt → P6 |

---

## Canonical Delivery Timeline

```text
 P0–P1          P2–P3                 P3.5        P4–P4.3                P4.5–P4.7       P5       P6
 ─────────      ───────────────        ─────       ─────────────          ──────────      ─────    ─────
 Foundation  →  Tenant Engine       →  Identity →  Web+Sync+Marketplace → Player channels → Billing → Harden
 RLS+sports     Zalo tenant + ledger   merge       canonical backend      Zalo/Messenger   sub      pen/load
 3-tier+Google  + Messenger(P2.5,AR)   + FB/Zalo   + chat + settings       + player view              +public
                + mark-paid thủ công   link        + discover/join

 Dogfood #1 ─────▶ seed marketplace ─────▶ external clubs ─────▶ thu phí ─────▶ scale
```

---

## 📐 Cách đọc tiến độ (measurement contract)

> Mục này tồn tại vì **một thanh % duy nhất luôn nói dối**. Nó gộp "đã spec" với "đã chạy được", và luôn lệch về phía lạc quan. Từ v3.4, mỗi delivery group được đo theo **6 trục độc lập** và trục yếu nhất là trục quyết định.

**Định nghĩa Done cho từng trục — không có nghĩa nào khác được dùng:**

| Trục | ✅ chỉ khi | Bằng chứng phải trỏ tới |
|---|---|---|
| **Spec** | Có cặp Product + BE, trạng thái Reviewed (không phải Draft) | file trong `docs/features/` + `docs/features/BE/` |
| **Migration** | File `.sql` đã merge lên `main` **và** áp được lên PG sạch | số hiệu migration trong `packages/db/migrations/` |
| **BE** | Có service/route/function thật, không phải chỉ bảng | đường dẫn file + tên route |
| **FE/UI** | Màn hình chạy trên app thật, nối API thật | route Next.js. **Màn hình trong `.pen` KHÔNG tính là FE** — chỉ tính vào trục Design |
| **Tests** | Test chạy xanh trong CI | tên file test + số case |
| **Invariant** | Test bất biến xanh — **tenant isolation/RLS · public field-whitelist · no-money-leak · concurrency/race-safety** | `packages/db/src/*-invariants.test.ts` **+ danh sách invariant-class đặt tên khác** (bảng ngay dưới). Không suy ra từ tên file: file chỉ tính khi có tên trong danh sách |

**Danh sách invariant-class (re-verify tại `1fdba1d` 13/08 — **3 → 5 file**, hai file chat đã merge)** — trục Invariant chỉ đếm các file dưới đây; thêm file mới phải thêm dòng ở đây, không dựa vào quy ước đặt tên:

| File | Invariant bảo vệ | Khớp pattern `*-invariants` |
|---|---|---|
| `packages/db/src/rls-invariants.test.ts` | Tenant isolation fail-closed · public field-whitelist | ✅ |
| `packages/db/src/waitlist-invariants.test.ts` | Waitlist ordering/capacity | ✅ |
| `packages/db/src/migrate.test.ts` | **Race-safety của role bootstrap `0000`** (concurrency) | ❌ tên không theo pattern — vẫn tính vì đúng invariant-class |
| `packages/db/src/chat-dm-safety-invariants.test.ts` | **Global-protected plane fail-closed** (`0030`): zero grant thuộc mọi loại cho `app`/`app_worker`/`readonly` trên 3 bảng + 3 function; DM deny theo capability flag | ✅ *(merged `d5b31f9` 10/08 — v3.4o ghi "chỉ tồn tại trên lane branch", nay đã sai)* |
| `packages/db/src/chat-schema-invariants.test.ts` | **Chat root schema** (`0031`): tenant isolation + membership boundary của `chat_channels`/`chat_members`/`chat_messages` | ✅ |

> Tồn đọng đã biết: `migrate.test.ts` đúng class nhưng lệch quy ước đặt tên. Có thể đóng bằng rename (`migrate-invariants.test.ts`) trong một code slice riêng; **chưa làm ở đây** vì ROADMAP là doc-only. Tới lúc đó danh sách trên là nguồn sự thật.
>
> ⚠️ **Invariant ✅ không kéo BE lên.** Cả hai file chat mới chỉ chứng minh **bảng và quyền đúng**, không chứng minh có ai gọi chúng — chúng chạy dưới `ctx.owner` và role pool, không qua service. Trục BE của Chat vẫn ⬜.

**5 luật chống lạm phát con số** — vi phạm bất kỳ luật nào ⇒ số liệu bị coi là vô hiệu:

1. **Docs ≠ runtime.** Spec Reviewed không cộng vào bất kỳ trục code nào. (Luật này đã có; nay áp cho cả bảng số.)
2. **Merged ≠ enabled.** Code merge nhưng feature flag/env còn tắt ⇒ trạng thái là `🟢 merged · ⛔ chưa bật`, **không** phải ✅. Ví dụ sống: lane Google.
3. **`.pen` screens ≠ FE.** Design xong không kéo FE lên %.
4. **Đếm được thì phải tái tạo được.** Mọi số trong file này đi kèm lệnh tái tạo bên dưới. Với test case: **canonical runner (`pnpm test`) là authority duy nhất**; *static grep* là cross-check chạy được không cần DB, dùng để **phát hiện drift**, không dùng để khai số.
   **Công thức đối chiếu:** `static + Σ(test sinh trong loop) = runner`. Test sinh trong loop = table-driven test viết bằng `for…of`/`forEach` bọc ngoài `it()` — grep chỉ đếm 1 lần dù runner sinh N.
   **Generator HIỆN HÀNH tại `18c75d8` (kiểm kê 03/09) — 9 loop-site + 17 `it.each`, tổng `+137`.** Kiểm kê bằng **độ sâu ngoặc**, đúng kết luận v3.5; cửa sổ `grep -A` không dùng để ra số.

   **Lớp 2 — `it.each` (static thấy `0`, runner sinh N):** 17 site, `+100`.

   | Vị trí | Bảng | Static | Runner | Δ |
   |---|---|---|---|---|
   | `packages/db/src/chat-dm-safety-invariants.test.ts:563` · `:808` | biến `flags`, 4 hàng ×2 site | 0 | 4 ×2 | `+8` |
   | `apps/web/app/api/sessions/route.test.ts:187` · `:243` | inline 6 · 4 | 0 | 10 | `+10` |
   | `apps/web/app/api/sessions/[id]/route.test.ts:173` · `:198` | inline 4 · 8 | 0 | 12 | `+12` |
   | `apps/web/app/api/sessions/[id]/publish/route.test.ts:160` | inline 5 | 0 | 5 | `+5` |
   | `apps/web/lib/session-command-route.test.ts` — 10 site (`:335` `:453` `:477` `:631` `:659` `:757` `:771` `:818` `:881` `:978`) | inline 4·5·3·11·7·5·9·9·3·9 | 0 | 65 | `+65` |
   | **Σ lớp 2** | **17 site** | **0** | **100** | **`+100`** |

   **Lớp 1 — loop bọc ngoài `it()` (static thấy `1`, runner sinh N):** 9 site, `+37`.

   | Vị trí | Hình dạng | Static | Runner | Δ |
   |---|---|---|---|---|
   | `packages/core/src/app-error.test.ts:23` | `cases` 7 hàng | 1 | 7 | `+6` |
   | `packages/db/src/chat-dm-safety-invariants.test.ts:478` · `:484` | lồng `ROLES(3) × TABLES(3)`, 2 `it()` **trong** vòng trong | 2 | 18 | `+16` |
   | `packages/db/src/chat-dm-safety-invariants.test.ts:491` | 1 `it()` trong `ROLES(3)` nhưng **ngoài** `TABLES` | 1 | 3 | `+2` |
   | `packages/db/src/authorization.test.ts:757` `:768` `:779` `:790` | `["close_session","cancel_session"]`, 4 `it()` × 2 | 4 | 8 | `+4` |
   | `apps/web/lib/google-oidc.test.ts:134` | `rows` 10 hàng | 1 | 10 | `+9` |
   | **Σ lớp 1** | **9 site** | **9** | **46** | **`+37`** |

   > **Năm loop cố ý đếm `0` — chúng nằm TRONG thân `it()`, không bọc ngoài nó:** trong `chat-dm-safety-invariants.test.ts`, `it()` catalog ở `:526` chứa **3** vòng lồng (`ROLES × TABLES × TABLE_PRIVILEGES`, dòng `:527`–`:529`) và `it()` ở `:544` chứa **2** (`ROLES × FUNCTIONS`, `:545`–`:546`). Đó là vòng lặp **assertion**: mỗi `it()` vẫn là **1 test** dù chạy 63 và 9 lần `expect`. Cùng tiền lệ với `oauth-transaction.test.ts:71,96` ghi ở khối lịch sử 22/07. **Đây là chỗ dễ đếm dôi nhất** — nếu đếm nhầm 5 loop này thành generator, `db` sẽ dôi và luật 4 vỡ ngay ở checksum per-package. Phân biệt được bằng độ sâu ngoặc, không bằng mắt.

   ✅ **`1097 + 137 = 1234` — và đóng ĐỘC LẬP trên từng package** (core `147+6=153` · db `680+30=710` · web `230+101=331` · bot `40+0=40`). Bốn checksum rời nhau, không phải một: một hàng sai trong bảng trên sẽ làm lệch tổng của package đó chứ không tự bù.

   ➕ **Lớp readiness/kit cũng đóng theo cùng công thức, trên thang riêng:** `65 + 20 = 85`. Hai generator, cả hai trong `scripts/autopilot-ephemeral-review-worktree.test.mjs`: `:490` (`for…of` bảng 10 scope-path ACCEPTS, `+9`) và `:524` (bảng 12 REJECTS, `+11`). Lệnh static ở dưới quét `packages apps` nên **không** chạm 3 file `scripts/*.test.mjs`; muốn tái tạo `65` phải grep riêng đúng 3 file đó.

   <details>
   <summary>Bảng generator historical tại <code>1fdba1d</code> (13/08) — <code>+41</code>, đã bị bảng 03/09 ở trên thay thế</summary>

   | Vị trí | Hình dạng | Static | Runner | Δ |
   |---|---|---|---|---|
   | `apps/web/lib/google-oidc.test.ts:133` | `for (const row of rows)`, `rows.length = 10` | 1 | 10 | `+9` |
   | `packages/core/src/app-error.test.ts:22` | `for (const [statusCode, kind] of cases)`, 7 case | 1 | 7 | `+6` |
   | `packages/db/src/chat-dm-safety-invariants.test.ts:476 × :477` | lồng `ROLES(3) × TABLES(3)`, 2 `it()` **trong** vòng trong (`:478`, `:484`) | 2 | 18 | `+16` |
   | `packages/db/src/chat-dm-safety-invariants.test.ts:476` | 1 `it()` (`:491`) trong `ROLES(3)` nhưng **ngoài** `TABLES` | 1 | 3 | `+2` |
   | `packages/db/src/chat-dm-safety-invariants.test.ts:563` | **`it.each(flags)`**, `flags.length = 4` | **0** | 4 | `+4` |
   | `packages/db/src/chat-dm-safety-invariants.test.ts:808` | **`it.each(flags)`**, `flags.length = 4` | **0** | 4 | `+4` |

   </details>

   ⚠️ **Hai lớp mù, cả hai đều mới, và cả hai đều do một file gây ra.** (a) **`it.each` vô hình:** pattern `^[[:space:]]*(it|test)\(` đòi `(` ngay sau `it`, nên `it.each(flags)(` cho **0 hit** — không phải đếm thiếu, là không thấy. v3.4b từng loại trừ `test.each` bằng "0 hit toàn repo"; đúng **lúc đó**, hết đúng từ `d5b31f9` (10/08). (b) **Loop lồng không đều:** hàng `:476` (một mình) là `it()` nằm ở thân vòng **ngoài**, sau khi vòng trong đã đóng — cửa sổ `grep -A3` của bản cũ không thấy, và ngay cả `-A12` cũng chỉ thấy do may. **Kết luận cho lần sau: grep theo cửa sổ dòng không đủ để kiểm kê generator; muốn chắc phải đếm theo độ sâu ngoặc.** Bảng này đã được dựng bằng cách đó.

   <details>
   <summary>✅ Đối chiếu historical tại <code>80a3464</code> — <code>772 + 41 = 813</code>, công thức từng đóng ở đó (tiền lệ, không phải số hiện hành)</summary>

   Static = **772** (đo bằng `git show`; bằng đúng static tại `1fdba1d` vì 24 commit ở giữa không chạm `packages/`|`apps/`). `772 + 41 = ` **813** ` = ` đúng số runner khai. Kiểm theo từng package:

   | Package | Static | Generated | = Runner |
   |---|---|---|---|
   | core | 146 | +6 | **152** |
   | db | 449 | +16 +2 +4 +4 = +26 | **475** |
   | web | 137 | +9 | **146** |
   | bot | 40 | +0 | **40** |
   | **Σ workspace** | **772** | **+41** | **813** |

   </details>

   > **Bẫy đã sập một lần trong chính bản v3.5 này, giữ lại làm tiền lệ:** bản nháp đầu trừ 13 validator khỏi 813 rồi khai "lệch 11", dựng nguyên một khối 🔴 drift + binary resolution + next-review-trigger cho một sai lệch **không tồn tại**. **`813` là số workspace (vitest), KHÔNG bao gồm lớp validator** — `pnpm test` chạy `test:review-readiness` (`node --test`, in `# pass` riêng) rồi mới tới `pnpm -r run test`; số lấy từ đuôi vitest là workspace-only theo cấu tạo. Chứng cứ độc lập: v3.4o đã ghi per-package runner **core 152 · web 146**, khớp đúng `static + generator` ở bảng trên. Hai sai số bù nhau lệch đi 11 (`13 − 2`), và nếu chỉ sửa một cái thì con số còn tệ hơn. **Luật rút ra: trước khi khai một mismatch, phải nói rõ số runner đang so là workspace hay full.**

   ➕ **Lớp validator: 13 → 17 sau phép đo, qua HAI commit chứ không một.** `b53bc75` tạo `scripts/autopilot-ephemeral-review-worktree.test.mjs` với **2** test và wire vào `test:review-readiness` (13→15); `2d5834b` thêm **2** test nữa vào chính file đó, **không chạm `package.json`** (15→17). Nói "`package.json` là thứ đổi lớp validator" chỉ đúng một nửa — nửa còn lại đến từ sửa file test. Full `pnpm test` tại `80a3464` = `813 + 13 = 826`; tại `1fdba1d` = `813 + 17 = **830**` — **dự đoán để đối chiếu, không phải số khai**.
   **Chuỗi lớp này (readiness/kit, thang riêng — KHÔNG cộng vào workspace):** 13 → 17 (`1fdba1d`) → 30 (`93f1e93`) → **85 (`18c75d8`, đo 03/09)**. Bước 30 → 85 là `+55`, phần lớn từ `check-kit-pack-membership.test.mjs` (28 test, file mới) và `autopilot-ephemeral-review-worktree.test.mjs` (20 static + 20 sinh trong 2 loop).
   **Lưu ý 06/08 (giữ làm tiền lệ):** phép đối chiếu chỉ hợp lệ khi static và runner cùng đo trên một commit; không được cộng chéo commit rồi khai thành số test.
   Nếu công thức không khớp ⇒ hoặc có generator mới chưa kiểm kê (thêm vào danh sách trên), hoặc doc đã drift. **Không được chọn số lớn hơn để cho khớp.**
5. **Trục yếu nhất là trạng thái thật.** Một group có Spec ✅ / BE ✅ / FE ⬜ thì là **⬜ chưa dùng được**, không phải "gần xong".

<details>
<summary><b>Lệnh tái tạo số đếm</b> (chạy ở repo root)</summary>

```bash
# migrations
ls packages/db/migrations/*.sql | wc -l
# test files (loại trừ dependency và worktree)
find packages apps -type f \( -name "*.test.ts" -o -name "*.test.tsx" \) \
  -not -path "*/node_modules/*" -not -path "*/.autopilot/worktrees/*" | wc -l
# test cases — canonical runner (AUTHORITY cho số test và trục Tests)
DATABASE_URL_TEST=postgres://plexco:plexco_dev@localhost:5432/plexco_test pnpm test
# static cross-check LỚP WORKSPACE (không cần DB) — phát hiện drift, KHÔNG dùng để khai số
#   phạm vi là `packages apps` ⇒ theo cấu tạo KHÔNG nhìn thấy lớp readiness/kit dưới scripts/
grep -rhoE "^[[:space:]]*(it|test)\(" packages apps \
  --include="*.test.ts" --include="*.test.tsx" | wc -l
# static cross-check LỚP READINESS/KIT — thang đo RIÊNG, không được cộng vào số trên.
#   ⚠️ SỬA 04/09: `test:review-readiness` nay chạy BỐN file, không phải ba — lane
#   `local-dev-sanctioned-paths` thêm `scripts/db-reset-test.test.mjs`. Lệnh ba-file cũ trả 65 và
#   ai chạy nó sẽ khai một drift KHÔNG tồn tại. Đối chiếu nguồn thật, đừng tin danh sách này:
#     node -e "console.log(require('./package.json').scripts['test:review-readiness'])"
grep -chE "^[[:space:]]*test\(" \
  scripts/check-review-readiness.test.mjs \
  scripts/autopilot-ephemeral-review-worktree.test.mjs \
  scripts/check-kit-pack-membership.test.mjs \
  scripts/db-reset-test.test.mjs | paste -sd+ - | bc
# kiểm kê generator, LỚP 1: loop bọc ngoài it()
#   -A12 (không phải -A3): loop lồng ROLES × TABLES của chat-dm-safety đặt it() cách 2 dòng,
#   cửa sổ -A3 của bản cũ nhìn không thấy nó.
grep -rnE "^[[:space:]]*(for[[:space:]]*\(|.*\.forEach\()" packages apps \
  --include="*.test.ts" --include="*.test.tsx" -A12 \
  | grep -E "^\S+[-:][0-9]+[-:][[:space:]]*(it|test)\("
# kiểm kê generator, LỚP 2: it.each/test.each — static grep KHÔNG đếm được lớp này (0 hit)
grep -rnE "(it|test|describe)\.(each|skip|todo|only)" packages apps \
  --include="*.test.ts" --include="*.test.tsx"
# API routes đang có
find apps/web/app/api -name "route.ts" | wc -l
# feature specs — đường dẫn ĐÃ ĐỔI ở `2e577c7` (reorg docs/features → FE|BE).
#   Lệnh cũ `find docs/features -maxdepth 1 -name "feature_*.md"` nay trả 0, không phải vì mất spec.
find docs/features/FE -maxdepth 1 -type f -name "feature_*.md" | wc -l
find docs/features/BE -maxdepth 1 -type f -name "feature_*_tech.md" | wc -l
# FE spec (lớp riêng, Draft — KHÔNG tính vào trục FE/UI theo luật 3)
find docs/channels/web/FE -maxdepth 1 -type f -name "feature_*_fe.md" | wc -l
```

</details>

## 📊 Dev Progress Overview

**Số đếm kiểm chứng được — `main@12f5191` (19/09/2026), MỘT mốc cho cả bảng** — cấu trúc VÀ runner đo trong **cùng một lần chạy tại chính SHA này**, nên bảng này không mang số từ commit khác sang. Mã nguồn tại pin ≡ `origin/main@00cc510` (`git diff --name-only 00cc510..12f5191 -- packages apps scripts` → rỗng).
> ✅ **Trục Tests không `STALE`** — authority nay là **1823 workspace + 172 readiness/kit @ `12f5191`** (khối 🟩 19/09 ở §📜), thay `1490 + 128 @ e235ea4`. Runner chạy **tại chính commit đang pin**, nên không cần lệnh carry giữa hai SHA.
> 🔵 **Có hạn dùng:** mốc này hết hạn ngay khi `git diff --name-only 12f5191..main -- packages apps scripts` **không còn rỗng** — khi đó phải **đo lại** static + runner cùng lúc, **không cộng tay**. `pnpm progress` chạy đúng lệnh này và nói thẳng pin đã mục hay chưa.

| Hạng mục | Số thực | Ghi chú |
|---|---|---|
| Migrations trên `main` | **47** (`0000`–`0046`) | ✅ đo tại `12f5191` (19/09). **Mới từ `e235ea4`:** `0045` guarded tenant context cho guest note · `0046` bound cleanup rate-limit hết hạn — cả hai **siết chặt hành vi đã land**, không mở hành vi mới. **Mới từ `0aff7ad` (bundle audit v6 + làn ap3):** `0037` `tenant_provision` tự scope RLS · `0038` subscriptions đọc qua definer · `0039` audit hardening (definer `search_path`/tenant assert · ledger aggregate FK · link_codes DD-50) · `0040` idle TTL web session (`last_seen_at`, áp ở CẢ resolve LẪN rotate) · `0041` `job_worker_heartbeats` (job_definer-owned, tự prune 30 ngày) · `0042` DROP `auth_login_telegram` + **trigger** chặn mọi row tạo-hoặc-trở-thành `telegram` · `0043` link_code issue/consume + `_link_code_retention` · `0044` `session_guest_notes` + `sessions.allow_player_invite` + `players.invited_by_person_id`. **Lịch sử:** `0033` fence DD-12 8a · `0034` identity-account-link · `0035` `tenant_locale_reader` (DD-118) · `0036` REVOKE nốt trên `public_sessions`; `0015`–`0018` auth · `0019`–`0021` tenant-integrity DD-68 · `0022`/`0023` job · `0024` capacity CHECK · `0025`/`0026` rename CHECK · `0027` `resolve_tenant_status_locked` · `0028`/`0029` DD-29 registry · `0030`–`0032` chat DB root |
| Test file | **59** `*.test.ts` + **4** `scripts/*.test.mjs` *(37 → 46 → 50 → 54 → 59)* | ✅ đo tại `12f5191` (19/09) — core 11 · db 15 · web **26** · bot **7**, đếm theo đuôi runner. Từ `0aff7ad`: **−4** (`telegram/callback`, `telegram/state`, `telegram-login`, `login-state` — A3 + `0042`) **+8** (`security-headers` · `request-policy` · `api-envelope` · `log` · 2 route guest-note · `identity-link-code` · `tx-alias`) |
| Test case — **canonical runner** | ✅ **1823 workspace** (core **199** · db **858** · web **643** · bot **123**) **+ 172 readiness/kit** — đo TRỰC TIẾP tại `12f5191`, không carry | **Provenance:** chạy trên Mac, `git worktree` tách rời tại `12f5191`, `pnpm install --frozen-lockfile`, `NODE_ENV=test`, Postgres `docker plexco-postgres-1`, `DATABASE_URL_TEST=postgres://plexco:plexco_dev@localhost:5432/plexco_test`; `pnpm test` **exit 0** (94 s) · `pnpm typecheck` · `pnpm lint` · `pnpm format:check` · `pnpm review:check` · `pnpm build` đều **exit 0** · `git status --porcelain --untracked-files=all` **rỗng** sau khi chạy. ⚠️ **1823 và 172 là HAI THANG ĐO**, cấm cộng im lặng. 🟡 **Luật 4 CHƯA ĐÓNG Ở LỚP NÀO** tại mốc này — kể cả core và bot từng đóng ở `e235ea4`; nợ ghi tên ở §📍, không ghi bằng một phép trừ. 🔴 Lớp readiness nay có plan `1..130` nhưng `# pass 172` (ở `0aff7ad` hai số khớp) ⇒ bước `128 → 172` **không đọc thành "44 test mới"**. **Chuỗi historical (workspace-only):** 460 → … → 813 → 854 → 1234 (`2648965`) → 1308 (`0aff7ad`) → 1490 (`e235ea4`) → **1823 (`12f5191`, authority hiện hành)**. Chuỗi readiness đi riêng: 13 → 17 → 30 → 85 → 124 → 128 → **172**. |
| Test case — **static cross-check** | **1376** *(1097 @`2648965` → 1146 @`0aff7ad` → 1308 @`e235ea4` → 1376 @`12f5191`)* | core **161** · db **780** · web **353** · bot **82** — đo cùng commit với runner (luật: static và runner phải cùng một commit mới đối chiếu được). 🟡 **Không lớp nào đóng ở pass này:** core 161 vs runner 199 · db 780 vs 858 · web 353 vs 643 · bot 82 vs 123 · readiness static 110 vs `# pass` 172. Phần dư **không được viết như hiệu**; bảng kiểm kê generator phải dựng **tay, từng site**, theo độ sâu ngoặc |
| Bằng chứng test per-slice (real-PG) | db **167** → **173** → **179** → **201** → **212** → **219** → **243** | `0019` → `0020` → `0021` → `0022` → `0023` → `0024` → `0025`. Là authority của **chính slice đó**, không phải aggregate toàn repo; per-slice của `0026`–`0032` nằm trong verdict/packet tương ứng (`0030`–`0032` ở `docs/autopilot/contracts/`, không ở `slice-readiness-verdicts.md`) |
| Invariant test | **5 file** *(3 → 5)* | `rls-invariants` · `waitlist-invariants` · `migrate` (race-safety `0000`) · **`chat-dm-safety-invariants`** · **`chat-schema-invariants`** — xem danh sách invariant-class ở §Cách đọc tiến độ. Invariant ✅ **không** kéo BE lên |
| API route đang có | **15** *(10 → 13 → 15 → **15**, đổi thành phần)* | ✅ đo tại `e235ea4` (15/09). Tổng không đổi nhưng **thành phần đổi hẳn**: **6 auth** (google `state`/`callback`/`complete` · `logout` · `logout-all` · `session` — 2 route Telegram đã gỡ ở A3, đồng bộ `0042`) + **2 onboarding** + **7 route nghiệp vụ**: `POST /api/sessions` · `PUT /api/sessions/[id]` · `/[id]/publish` · `/[id]/close` · `/[id]/cancel` · **`POST /[id]/guest-notes`** · **`DELETE /[id]/guest-notes/[noteId]`**. ⚠️ Cả **bảy** đi qua choke-point tạm `apps/web/lib/session-command-route.ts` trong khi **DD-56 amendment #2 chỉ pin NĂM route liệt kê tên** ⇒ **decision còn thiếu**, xem §📍. Còn thiếu route `announce` (gate DD-56 clause 1) và **chưa có route ĐỌC nào** (`GET /api/sessions`, `/[id]` — amendment #3 draft, row `session-read-routes-list-detail`) |
| Feature spec | **27 Product (`docs/features/FE/`) + 27 BE (`docs/features/BE/feature_*_tech.md`)** | ✅ re-verify committed `main@620b2bd` — inventory 27 cặp (`features/README` v2.66, +membership). *(Lịch sử 13/08: 26+25.)* Đường dẫn đổi ở `2e577c7`. Product 24→26: `feature_club.md` từ `8af9601` (11/08) + `feature_share_activities.md` từ `692f9f2` (12/08). BE 24→25: `feature_club_tech.md` (`8af9601`). `docs/features/BE/` còn `auth-security-invariant-table.md` — supporting table, **không** đếm là spec. Coverage cao — *không* phải readiness |
| FE spec (lớp riêng) | **17** `docs/channels/web/FE/feature_*_fe.md` | Draft, **không đổi** từ 11/08 (đo lại `620b2bd`). Theo **luật 3** không tính vào trục FE/UI |
| Màn FE nối API thật | **0** | 🔴 **Không đổi — đây là trục yếu nhất và là lý do thanh % đứng yên dù BE đã đi xa.** FE **PENDING** theo lệnh owner 13/08, nguồn bền **DD-116 Option B** (24/08) + named trigger 3 vế (chọn 1 `.pen` canonical · tracked trên `main` · owner ký nghiệm thu gate DD-81). **DD-119** (08/09) đề xuất carve-out cho designer dựng `plexco.pen` **untracked** và pin file mới làm canonical — **🟡 chưa ratify tại `e235ea4`**, nên PENDING vẫn nguyên hiệu lực. `git ls-files` không trả file `.pen` nào → **rỗng**; `design.pen` + `fe.pen` untracked **có chủ ý**. Đúng 1 `apps/web/app/page.tsx` |

> **Lịch sử (22/07) — static/canonical divergence, nguyên nhân đã xác định.** *(Giữ nguyên làm tiền lệ đối chiếu; con số dưới đây thuộc `f93873b`, không phải `2937ed9`.)* Static grep cho **410** (core 111 · db 159 · web 137 · bot 3); canonical runner PASS cho **419** (web 146). Chênh **9** đến từ **đúng một table-driven generator**: `apps/web/lib/google-oidc.test.ts:133` — `for (const row of rows) { it(…) }` với `rows.length = 10`, grep đếm 1 lần trong khi vitest sinh 10. Loop viết bằng `for…of` thuần nên **không** bị `it.each` bắt được (repo có 0 hit `.each`); hai loop còn lại ở `oauth-transaction.test.ts:71,96` nằm *trong* thân `it()` nên mỗi cái vẫn là 1 test.
> Đối chiếu khớp: `410 + 9 = 419`. **Authority duy nhất cho số test và trục Tests vẫn là output canonical runner**; static giữ vai trò phát hiện drift qua công thức ở luật 4.

**Ma trận theo delivery group** — ✅ done · 🟢 merged-chưa-bật · 🟡 một phần · ⬜ chưa bắt đầu · — không áp dụng:

| Delivery group | Spec | Migration | BE | FE/UI | Tests | Invariant | Trạng thái thật (trục yếu nhất) |
|---|---|---|---|---|---|---|---|
| **P0–P1 Foundation** | ✅ | ✅ `0000`–`0014` | ✅ core+db | ⬜ | 🟡 authority **1823 @`12f5191`** (15/09) · đo trực tiếp tại chính SHA pin, không carry · nợ mới: bảng kiểm kê generator db + web | ✅ RLS + waitlist + migrate-race | 🟡 **nền xong, surface API đã mở 7 route nghiệp vụ, vẫn 0 màn FE** |
| **P0–P1 · 3b Auth (Google lane)** | ✅ | ✅ `0015`–`0018` (+`0040` idle TTL · `0042` gỡ tail Telegram) | ✅ **6 route** *(8 → 6: A3 gỡ 2 route Telegram)* | 🟡 callback/landing | 🟡 trong runner (authority **1823**) | ✅ auth/RLS trong db suite | 🟢 **merged · measurement closed · ⛔ chưa bật** (owner go-live/env decision) |
| **Tenant-integrity FK (DD-68, ngoài P-number)** | ✅ (DD-68 chốt) | ✅ `0019`–`0021` | — *(code dark, không service/route)* | — | ✅ real-PG per-slice: db 167 → 173 → 179 | ✅ cross-tenant reject theo từng FK dưới app role | ✅ **merged** — integrity đóng, **không mở hành vi nào** |
| **Shared job runtime (cross-cutting)** | ✅ DD-89/DD-90 | ✅ `0022`–`0023` | 🟡 claim/ack + dispatcher + queue/preflight + scheduler | — | ✅ db 201→212 + bot 3→40 | ✅ narrow EXECUTE-only/audit/fan-out completeness | 🟡 **infra merged, schedule OFF · producer CÓ (`session-service.ts` emit 8 event), projector CHƯA** — schedule tắt vì `productionStubDeliver` trả `dlq` terminal (audit X-3/B-1; row `projector-real-replace-stub`) |
| **Naming-identity CHECK (ngoài P-number)** | — *(không phải feature)* | ✅ `0025`–`0026` | — | — | ✅ real-PG db 219→243 (`0025`) | — | ✅ **merged** — RENAME-only, zero predicate change, không mở hành vi nào |
| **Audit hardening 06–07/09 (`0037`–`0042`, ngoài P-number)** | — *(không phải feature)* | ✅ `0037`–`0042` | ✅ hardening thật đã land: cookie `__Host-` + xoá-bằng-SET · CSRF constant-time · RS256 pin · DB-role assert chặn `pool.query` tới khi verify xong · discovery route guard · `entrypoint.sh` đối chiếu `DB_EXPECTED_ROLE` · heartbeat overlap-guard + `statement_timeout` | — | ✅ trong suite **1490**; 12 finding qua 7 vòng codex, vòng 5 `REVIEW_VERDICT: CLEAN` | ✅ rls-invariants mở rộng + catalog RLS test + runner ordering guard | ✅ **merged** — đóng 6 P2 + 4 hardening của audit 06/09; **0 hành vi product mới** (luật 5 vẫn áp) |
| **Tenant authz + capability registry (DD-29, ngoài P-number)** | ✅ DD-29 · billing BE §2/§4b Reviewed | ✅ `0027` definer read · `0028`/`0029` expand→contract | 🟡 `authorizeTenantAction` **hết code-dark** (session command gọi thật từ `1ccbe5d`); `resolveCapability()` (`f2af39d`, `capability.ts`) là reader đầu tiên của registry nhưng **vẫn 0 caller production** | — | 🟡 per-slice trong Verdict 28/31 + DD-29 slice · aggregate đã re-pin (**1234 @`18c75d8`**) | 🟡 fail-closed 2-bước + refuse-to-proceed guard ở `0029` | 🟡 **merged · nửa dark** — registry đọc được, **chưa nhánh tiền nào bị gate thật**; wiring = slice auto-reconcile (DD-114 D2.3), chưa author ⇒ **hard-dep (a) của phase-1 vẫn mở** |
| **Chat DB root (DD-38/DD-55/DD-86, ngoài P-number)** | ✅ Reviewed pair + primary plan `PLAN_READY` | ✅ **`0030` DM-safety · `0031` chat schema · `0032` single-read** | ⬜ **0 service** — không TS production nào đọc `chat_*` | ⬜ | ✅ per-slice trong packet `docs/autopilot/contracts/` | ✅ 2 file mới: global-protected zero-grant (catalog-level) + chat tenant/membership boundary | 🟢 **merged · code dark** — schema thật, **0 API · 0 UI**; slice 7 mới authored, slice 8 chưa; nợ P1 `chat-identity-merge-reparent-enablement` (DD-103) `NOT_CODE_READY` |
| **Session command family (P4 substrate, ngoài P-number)** | ✅ Reviewed pair + DD-110/111/112/117 | ✅ **`0044`** `session_guest_notes` *(trước `0044` nhóm này dùng schema sẵn có ⇒ ô này từng là `—`)* | ✅ **đủ 8 command** `packages/db/src/session-service.ts` (2913 dòng): create · publish · announce · update · close · cancel · **createGuestNote · deleteGuestNote** | ⬜ | 🟡 per-slice trong packet từng lane · aggregate **1823 @`12f5191`** | ✅ dedup `(tenant_id, command_id)` (DD-117 D5) · optimistic version · fail-closed refuse nhánh paid · **`0044`**: trigger trần 3 note/session dưới concurrency thật + RLS chặn đọc chéo tenant + FK cross-tenant | 🟢 **merged · buildable** — **7/8 command có route** (`announce` bị gate DD-56 clause 1), và **0 màn FE** gọi |
| **Session API surface (route nghiệp vụ đầu tiên)** | ✅ | — | ✅ 3 route `770ff4b` + 2 route `6d62cf8` + **2 route guest-note** `9a1c422` + DD-56 lint guard | ⬜ | 🟡 **7** file route test + `session-command-route.test.ts` | ✅ DD-56 guard | 🟡 **merged · 7/8 command có route** — thiếu `announce` (**bị gate** DD-56 clause 1, không phải bỏ sót); **0 route đọc** (amendment #3 draft). ⚠️ Hai route guest-note nằm **ngoài** danh sách NĂM route mà amendment #2 liệt kê tường minh ⇒ cần decision riêng theo chính điều khoản 1 |
| **Public read model fence (DD-12 8a, ngoài P-number)** | ✅ DD-12 · DD-114 D3 (b) | ✅ `0033` + `0036` | ✅ `public-session-fence.ts`, caller đầu tiên là `updateSession` | — | 🟡 `public-session-fence.test.ts` | ✅ guarded view `security_barrier` + CAS-clear exact-token + zero grant cho `app`/`readonly` trên bảng gốc | ✅ **ĐÓNG** — immediate-deny structural, không phụ thuộc projector async. ⚠️ Projector tương lai phải đi qua definer fn / writer role riêng — **cấm re-grant `app` base SELECT** |
| **Identity link (DD-32 tiền đề #1 + link_code DD-50)** | ✅ DD-32/DD-50 | ✅ `0034` + **`0043`** (`link_code_issue`/`link_code_salt`/`link_code_consume` + `_link_code_retention` 30 ngày) | 🟡 `0034` **không có file TS** — chỉ SQL fn `resolve_deferred_payment_account_core` (SECURITY DEFINER, REVOKE khỏi app/app_worker/readonly); `0043` có wrapper `packages/db/src/identity.ts` (mã 18 ký tự Crockford **tách đôi** — 8 ký tự lookup HMAC, verifier scrypt **async** phủ toàn bộ) nhưng **0 caller production**, env `LINK_CODE_LOOKUP_HMAC_KEY` chưa đặt vì 0 reader | ⬜ | 🟡 `identity-account-link.test.ts` + `identity-link-code.test.ts` | ✅ SECURITY DEFINER function-only (amendment DD-50, 25/08) · attempt cap **có thật** nhờ tách mã (trước đó là code chết) | 🟢 **merged · code dark** — chưa port Messenger/Zalo nào gọi |
| **Tenant locale (DD-118)** | ✅ DD-118 | ✅ `0035` `tenant_locale_reader` | 🟡 `runWithLang` phủ đường session-command **+ `GET /api/onboarding/readiness`** (`dd118-runwithlang-coverage`, 04/09) | ⬜ | 🟡 trong aggregate **1234 @`18c75d8`** | ✅ SECURITY DEFINER, fail-closed `'vi'` | 🟡 **merged · phủ session-command + readiness; route authenticated mới phải tự mang `runWithLang`** — response phát trước khi tenant được xác thực giữ tiếng Việt là **hành vi đã phê chuẩn**, không phải lỗ hổng |
| **P2–P3 Tenant Engine** | ✅ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ Not Started |
| **P2.5 Messenger** | ✅ Reviewed contract | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ Not Started · 🔗 chặn App Review |
| **P3.5 Identity** | ✅ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ Not Started |
| **P4–P4.3 Web+Sync+Market** | 🟡 mixed: Reviewed + Draft — *publish/draft-lifecycle của Session nay là contract đóng (23–24/07)* | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ Not Started |
| **P4.5–P4.7 Player channels** | 🟡 | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ Not Started |
| **P5 Billing** | ✅ Reviewed | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ Not Started |
| **P6 Harden** | ✅ Reviewed | — | ⬜ | — | ⬜ | ⬜ | ⬜ Not Started |

```text
TỔNG (code, theo slice roadmap)  ██████░░░░░░░░░░░░░░  ~33%
   ├─ nền móng (core + db/RLS)   ███████████████████░  ~90%  ✅ có test, có invariant
   ├─ auth (lane Google)         ████████████████░░░░  ~80%  🟢 code+measurement xong · ⛔ chưa bật
   └─ feature nghiệp vụ          █░░░░░░░░░░░░░░░░░░░   ~5%  ⬜ session/reconcile/sync/marketplace chưa wiring
```

> **Đọc con số ~33% cho đúng:** nó đo *slice roadmap đã merge*, không đo "sản phẩm dùng được". Theo luật 5, sản phẩm hiện ở mức **⬜ chưa host nào dùng được** — vì FE/UI = 0 màn và route nghiệp vụ = 0. Đây là chỗ trước đây file khai 75% cho Foundation và gây hiểu nhầm.
>
> **Vì sao ~33% chưa tăng:** `0019`–`0021` và `0024` là integrity-only; core fix nằm trong module đã tính; docs không phải runtime. `0022`/`0023` + dispatcher/scheduler là shared job capability nhưng schedule OFF và chưa có product producer/projector/service/route/FE, nên không đóng một delivery group dùng được. Chỉ cập nhật % khi một slice roadmap có hành vi product thực sự land.
>
> **Tuần 30/07→06/08 cũng không tăng, và lý do đáng ghi vì nó dễ bị đọc nhầm:** `0025`/`0026` là rename thuần; `0027` là quyền đọc-khoá cho một hàm chưa ai gọi; `0028`/`0029` đổi hình dạng plan/entitlement và repoint `tenant_provision()` — **có chạm đường onboarding thật**, nhưng chưa TS nào đọc `capabilities` nên chưa entitlement nào được thực thi. `authorizeTenantAction` là **root dependency** đã merge chứ chưa phải feature: nó tồn tại để các slice sau gọi. Bốn migration trong một tuần vẫn ra **0 hành vi product mới**.
>
> **Tuần 07/08→13/08 vẫn không tăng — và đây là lần dễ đọc nhầm nhất từ trước tới nay.** `0031` tạo `chat_channels`/`chat_members`/`chat_messages`: nhìn tên bảng thì Chat "đã có", nhưng **0 dòng TS production nào đọc chúng**. Đây là migration đầu tiên tạo bảng cho một feature phase-1 chưa từng có bảng, nên rất dễ bị tính thành tiến độ — nó **không phải**. Theo luật 5, trục yếu nhất của Chat là BE/FE = ⬜. Tương tự `0030`/`0032` là authority + tối ưu đọc của chính authority đó. **Ba migration trong một tuần vẫn ra 0 hành vi product mới; đây là tuần thứ ba liên tiếp như vậy.**
>
> **Cái sẽ làm % tăng đang nằm trên branch, chưa trên `main`:** branch `feat/session-service-create-command-core--v2` — `packages/db/src/session-service.ts` + test + barrel (3 file), `CreateSession` command service với draft + outbox producer. Nếu merge, đây là **slice nghiệp vụ đầu tiên** và là lần đầu shared job infra có producer thật. Cho tới lúc đó, theo luật 1/luật 5, nó **không được tính vào bất kỳ trục nào**. *(Tip branch đổi liên tục — đọc `git log`, đừng tin SHA chép trong doc.)*

> 🔴 **FE boundary hiện hành — đổi bản chất từ 13/08:** trước đây FE là **HOLD chờ gate** (owner nghiệm thu canonical `.pen` theo DD-81); từ lệnh owner 13/08 nó là **PENDING theo lệnh** — DD-81/M0.3/M4 và mọi việc FE treo lại, **không** track `.pen`, **không** mở page/component. Khác biệt quan trọng: HOLD thì hoàn thành gate là đi tiếp được; PENDING thì gate không còn là thứ chặn, và ai đó "giúp" bằng cách `git add design.pen` là đang đi ngược lệnh owner. `design.pen` (22/07) + `fe.pen` (07/08) untracked **có chủ ý**. Cột FE/UI = **0 màn**, và không mở UI tạm trong chuỗi BE kế tiếp. **Nguồn bền nay là `../standards/decisions.md` DD-116 ✅ Option B (owner 24/08)** kèm named trigger 3 điều kiện (chọn canonical `.pen` · tracked trên `main` · owner ký nghiệm thu design authority, gate DD-81) — không sự kiện nào khác gỡ PENDING; RUN doc 13/08 là nguồn lịch sử.

### Module Progress

> Cột **Rev?** = module này có nằm trên đường tới đồng doanh thu đầu tiên không (xem §Critical Path to Revenue). 🔴 = chặn revenue · 🟡 = tăng giá trị gói trả phí · ⬜ = không chặn revenue.

| # | Module | Track | Phase | Spec | Migration | BE | FE | Tests | Rev? | Status |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Monorepo + lift `core` (+ `sports`) | 🏢 | P0 | ✅ | — | ✅ | — | ✅ runner 132 | 🔴 | ✅ (S1/S2 merged) · +fix DD-87 `splitNameAmount` |
| 2 | Postgres + Drizzle + RLS + **public read model skeleton** | 🏢 | P0 | ✅ | ✅ `0000`–`0013` *(+`0019`–`0032` integrity/job/registry/chat tail)* | ✅ | — | ✅ real-PG 219 tại `0024` | 🔴 | ✅ (S3 merged); `0024` invariant-only |
| 3 | Tenant schema (đa môn, session.visibility/slot/join_policy) + repo choke-point | 🏢 | P0–P1 | ✅ | ✅ | ✅ | — | ✅ | 🔴 | ✅ (S3 merged) |
| 3b | **Google login / tài khoản web (email)** (DD-13/DD-80) | 🏢 | P0–P1 | ✅ | ✅ `0015`–`0018` | ✅ **6 route** *(8 → 6, A3 gỡ 2 route Telegram)* | 🟡 | ✅ runner web **468** | 🔴 | 🟢 **merged · Safari measurement closed · ⛔ chưa bật** |
| 3c | Email/password bundle (order-4, flag OFF) + gỡ Telegram | 🏢 | P0–P1 | ✅ | 🟡 `0042` DROP `auth_login_telegram` + trigger — **nửa "gỡ Telegram" đã land** | 🟡 route + lib Telegram đã gỡ (A3); email/password chưa build | ⬜ | 🟡 | 🟡 | 🟡 **nửa gỡ-Telegram xong (`0042` + A3); order-4 email/password vẫn ⬜** |
| 4 | **Chat-channel tenant middleware** (Zalo P2 → Messenger P2.5) | 🏢 | P2/P2.5 | ✅ | ⬜ | ⬜ | ⬜ | ⬜ | 🔴 | ⬜ |
| 4b | **Mark-paid thủ công (tiền mặt/CK, tap/multi-select)** (DD-40) | 💰 | P2 | ✅ | ⬜ | ⬜ | ⬜ | ⬜ | 🔴 | ⬜ |
| 5 | Durable webhook + ledger/allocation + /unmatched (auto gated) | 💰 | P3 | ✅ + regional research | ⬜ | ⬜ | ⬜ | ⬜ | 🟡 | ⬜ manual global; auto cần entitlement + market/provider/bank/currency/consent |
| 17 | **Messenger central+optional Page; host/player shared core; 24h/App Review** | 🏢🎯 | **P2.5** | ✅ Reviewed contract | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ · 🔗 App Review |
| 6 | Migrate data bot cũ → tenant #1 | 🏢 | P3 | ✅ covered | ⬜ | ⬜ | — | ⬜ | ⬜ | ⬜ |
| 7 | Identity directory + merge (**link Facebook/Zalo**) | 🆔 | P3.5 | ✅ | 🟡 `0043` link_code issue/consume | 🟡 `identity.ts` wrapper — **0 caller production** | ⬜ | 🟡 `identity-link-code.test.ts` | ⬜ | 🟡 **primitive link_code merged · code dark**; merge service ⬜ |
| 8 | **Web app surface + canonical backend** | 🌐 | P4 | ✅ Reviewed | 🟢 `0044` guest note | 🟢 **8 command** merged (create `b48625c` · publish `1ccbe5d` · announce · update · close · cancel · createGuestNote · deleteGuestNote `9a1c422`) + **7 route** | ⬜ | ✅ per-slice real-PG | 🔴 | 🟢 **BE đủ họ lệnh · 7/8 có route · chưa runnable** — 0 màn FE gọi được |
| 9 | **Sync engine** (command/outbox/projection + realtime) | 🌐 | P4 | ✅ Reviewed | 🟡 shared `0022`/`0023` | 🟡 dispatcher/queue/scheduler | ⬜ | ✅ infra tests only | ⬜ | 🟡 **infra-only** — schedule OFF; producer đầu tiên đang ở lane module 8, **chưa merge** |
| 10 | Onboarding self-serve; Messenger central default + optional Page riêng | 🌐 | P4 | 🟡 Draft | ⬜ | 🟡 `POST /api/onboarding/start` → `provisionTenant` → `tenant_provision` (`0028`) + `GET /readiness` **đã có** (audit 06/09 #4 — DD-114 D6 nói launch provision *thủ công*; xem OPEN NOTE dưới D6); `PATCH /club` chưa | ⬜ | ⬜ | 🟡 | ⬜ |
| 10b | **In-app Chat primary player target** (DD-38/DD-86/DD-91–95) | 🌐 | P4 | Reviewed; primary plan v1.8 = `PLAN_READY` at `90d292d`; owns mechanism slices 1–47 + API A1–A21 + FE F0–F15; first handoff §9.2, each slice still strict `CODE_READY` | 🟢 **`0030`/`0031`/`0032` merged** | ⬜ **0 service** | ⬜ | ✅ 2 file invariant (`chat-dm-safety` · `chat-schema`) | ⬜ | 🟢 **DB root merged · code dark** — 0 API/UI; slice 7 authored (untracked packet), slice 8 chưa; DD-103 debt `NOT_CODE_READY` |
| 10c | **Cài đặt hồ sơ + giá theo giới tính** (DD-39 ✅) | 🌐 | P4 | 🟡 draft | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| 11 | **Publish kèo → public_sessions projection** | 🔎 | P4.3 | ✅ Reviewed — contract publish/draft lifecycle đóng | ✅ `0024` capacity invariant only | ⬜ producer/projector/service/route | ⬜ | ✅ PVC invariant only | ⬜ | ⬜ **chưa runnable** — shared job infra đã merge nhưng schedule OFF/placeholder |
| 12 | **Discovery / tìm kèo** | 🔎 | P4.3 | ✅ Reviewed | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| 13 | **Join cross-club** | 🔎 | P4.3 | ✅ Reviewed | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| 13a | **Channel booking decision → intent/hold → occupancy → verified-payment finalizer (DD-32)** | 🔎🎯 | P2.5/P4.3/P4.7 | ✅ Reviewed contract; readiness owned by its implementation plan | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ no runtime |
| 14 | Player join Messenger (quick-reply; base enablement P2.5) | 🎯 | P4.5 | 🟡 draft | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| 15 | Player join Zalo (number-reply) | 🎯 | P4.7 | ✅ Reviewed | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| 16 | Reminder + notifyPlayersPaid (+ sync) — web + Zalo chính, Messenger 24h | 🎯 | P4.5–P4.7 | 🟡 Draft | ⬜ | ⬜ | ⬜ | ⬜ | 🟡 | ⬜ |
| 18 | Billing + lifecycle | 💰 | P5 | ✅ Reviewed | 🟢 `0027`–`0029` (DD-29 registry + tenant status read) | 🟡 `authorizeTenantAction` merged, **6 call site** (`session-service.ts:438,621,814,1316,1720,2024` — publish ×2/announce/update/close/cancel); `resolveCapability()` vẫn 0 caller | ⬜ | ✅ per-slice | 🔴 | 🟢 **nền authz merged · entitlement nửa dark** — chưa TS đọc `capabilities`, chưa charge gì |
| 19 | Hardening (pen/load/obs + **public pen-test**) | 🔒 | P6 | ✅ Reviewed | — | ⬜ | — | ⬜ | ⬜ | ⬜ |

> Module 17 (Messenger) **phase-1** nhưng chặn bởi **App Review Meta** — nộp sớm; degrade sang web + Zalo nếu App Review chậm (BRD OD-9/DD-37 · `../channels/messenger/messenger-channel-design.md`).
>
> **Module 3b (auth) — reconcile 22/07:** toàn bộ lane Google **đã merge** trên `main@f93873b08d73f7a11c2576196b09633b9197ad60` (D0a `0015` → D0b → D1 email-token `0016` → D1 google-adapter `0017` → d1b session-rotation `0018`); canonical suite PASS (db 159 · web 146 — xem §Dev Progress). **Nhưng chưa bật:** completion-hop M3 cần bằng chứng đo trên **Safari macOS + iOS thật** (Playwright chỉ có WebKit đóng băng); `GOOGLE_OAUTH_CLIENT_ID/SECRET` giữ rỗng tới khi đo xong — thủ tục ở `../probes/probe-strict-cookie-completion-hop.md` §7. Đây là ví dụ chuẩn của luật **merged ≠ enabled**: trạng thái là 🟢, **không** phải ✅.
>
> **Cập nhật hiện hành 27/07:** Safari macOS + iOS Safari đã đo pass ngày 26/07; measurement obligation đã đóng. Google login vẫn **chưa enable** vì setting `GOOGLE_OAUTH_*`/CTA là owner go-live decision riêng và các gate production khác không tự được miễn. Ghi chú 22/07 phía trên chỉ còn là historical timeline.
>
> **Chat authoring ≠ enablement:** slice 19 `player-self-sessions-waitlist-read-core` có thể được author read-only trực tiếp trên baseline `players/memberships/sessions` đã merge, **không** phụ thuộc full SessionService. Nhưng bật `/sessions|/waitlist` beta vẫn cần các packet strict current-authority `svc-session-crud`, `svc-session-join-leave`, `svc-waitlist-promotion-core` và production-shaped data E2E. Tương tự, payment Inbox/push chỉ được enable sau slices 43–45, một real payment/reconciliation source producer, exactly-once/correction E2E và authenticated-detail parity.

---

## P0–P1: FOUNDATION — Repo, Core, RLS, đa môn, 3 tầng, Google login

> **Mục tiêu:** nền multi-tenant an toàn + chiều đa môn + khung 3 tầng hiển thị + **auth web (Google + email)**, trước khi có feature.
> **Duration:** `TBD` · **Traction signal:** — (root)
> **Status:** 🟡 Partially complete — nền + toàn bộ lane Google đã merge (`0000`–`0018`), Safari/iOS measurement đã đóng; **Google vẫn chưa bật** (owner go-live/env decision riêng) và email bundle order-4 chưa code. Tail toàn cục hiện là **`0032`**; `0019`–`0032` là integrity / shared-job / capability-registry / chat-root layers **ngoài** auth lane.

| ID | Item | Mô tả | Prio | Status |
|---|---|---|---|---|
| 1.1 | Monorepo pnpm | `packages/core` + `apps/bot` + `apps/web` | P0 | ✅ |
| 1.2 | Lift `core` | matching, payments-logic, dates, format, i18n, **sports** + test xanh | P0 | ✅ 132 case |
| 2.1 | Postgres + Drizzle | thay `node:sqlite` | P0 | ✅ |
| 3.1 | Schema tenant đa môn | mọi bảng `tenant_id`; `sports`; `sessions.{sport_id,visibility,slots_max,area,venue,skill_level,join_policy}` | P0 | ✅ |
| 2.2 | **RLS** | ENABLE+FORCE, role `app NOBYPASSRLS`, fail-closed | P0 | ✅ `0009` |
| 2.3 | **Public read model skeleton** | bảng `public_sessions` + field whitelist (chưa cần projector đầy đủ) | P0 | ✅ `0006` |
| 3.2 | Repo choke-point | `tenantRepo(tenantId)` + `withTenant` (`SET LOCAL`) | P0 | ✅ |
| 3b.1 | **Google OAuth adapter** | PKCE tx `0017` + `/api/auth/google/{state,callback,complete}` + finalizer per-lane | P1 | 🟢 merged |
| 3b.2 | **Session rotation completion hop (M3)** | `0018` handoff arm/consume; issuance fence reject-and-reauth | P1 | 🟢 merged |
| 3b.3 | **Bật Google login** | Safari measurement ✅; owner quyết định go-live rồi mới set `GOOGLE_OAUTH_*`/CTA và verify production gates | P1 | ⛔ **chưa enable** |
| 3c.1 | **Email/password bundle** | order-4, một release unit, flag OFF (gate C7) | P1 | ⬜ |
| 3c.2 | Gỡ provider Telegram-era | sau khi 3c.1 land | P1 | ⬜ |
| 2.4 | **Test bất biến** | cô lập tenant A/B + **public chỉ field whitelist** + migration race-safety | P0 | ✅ 3 file |

**DoD:** `drizzle push` lên Postgres sạch, RLS bật, **đăng nhập Google thật trên Safari/iOS tạo được tenant** (không chỉ merge code), test cô lập + test bất biến public xanh trong CI.

---

## P2–P3: TENANT ENGINE — Owner-side đa tenant + mark-paid + đối soát CK

> **Mục tiêu:** Zalo bot-per-club + Messenger hybrid phục vụ host/player; club không Page vẫn vận hành qua central; mark-paid/CK đúng tenant. Dogfood tenant #1.
> **Duration:** `TBD` · **Traction signal:** Google login **ENABLED** thật + 1 host đăng nhập được
> **Status:** ⬜ Not Started

### R1 — Zalo biết tenant

| ID | Item | Prio | Rev? | Status |
|---|---|---|---|---|
| 4.1 | Webhook `/webhook/zalo/:token` (bot-per-club) | P0 | 🔴 | ⬜ |
| 4.2 | Tenant middleware (`webhook_token→tenant`, `ctx.repo`) | P0 | 🔴 | ⬜ |
| 4.3 | Authz 2 lớp: resolve actor/context rồi `authorize(exact_action, actor, target)` qua DD-56 registry; role label không tự grant | P0 | 🔴 | ⬜ |
| 4.4 | Lệnh host đa-tenant (`/newsession` đa môn, `/announce`, `/config`, `/cash`) | P0 | 🔴 | ⬜ |
| 4b.1 | **Mark-paid thủ công** (tiền mặt/CK, tap/multi-select — DD-40) | P0 | 🔴 | ⬜ |
| 4.5 | Cron đa-tenant + throttler | P1 | ⬜ | ⬜ |

### R1.5 — Kênh Facebook Messenger (P2.5, App Review)

| ID | Item | Prio | Rev? | Status |
|---|---|---|---|---|
| 17.1 | Một Meta App + central Page + optional tenant Page | P0 | ⬜ | ⬜ · 🔗 App Review |
| 17.2 | Migration global-protected registry/Page identity/reachability/action state | P0 | ⬜ | ⬜ |
| 17.3 | Endpoint/default resolver | P0 | ⬜ | ⬜ |
| 17.4 | Role-aware host `/newsession` wizard + player discover/join qua shared Session/Join/AuthZ core | P0 | ⬜ | ⬜ |
| 17.5 | Opaque paginated actions · one-route delivery | P0 | ⬜ | ⬜ |
| 17.6 | App Review / 24h fail-closed | P0 | ⬜ | ⬜ · 🔗 ngoài tầm kiểm soát |

### R2 — Webhook CK biết tenant + payment ledger (`host_pro`)

| ID | Item | Prio | Rev? | Status |
|---|---|---|---|---|
| 5.1 | `/webhook/sepay/:token` (route token + verify TK + timing-safe) | P0 | 🟡 | ⬜ |
| 5.2 | Transaction lưu `bank_transactions` + enqueue trước ACK | P0 | 🟡 | ⬜ |
| 5.3 | Matching đa-tenant | P0 | 🟡 | ⬜ |
| 5.4 | `charges` + `payment_allocations` (partial/multi-person/overpay/reversal) · FIFO + BL-2 | P0 | 🟡 | ⬜ |
| 5.5 | `/unmatched` + retry cron | P1 | 🟡 | ⬜ |

**Auto-reconcile là tier `host_pro`; free dùng mark-paid thủ công (4b.1).** → 5.x là *giá trị gói trả phí* (🟡), không chặn đường tới revenue; 4b.1 mới chặn.

### R3 — Migrate tenant #1

| ID | Item | Prio | Rev? | Status |
|---|---|---|---|---|
| 6.1 | Script SQLite→Postgres (tenant "Bestminton" + BankAccount + copy data, `sport=cầu lông`) | P0 | ⬜ | ⬜ |
| 6.2 | Cutover: đối chiếu số dòng → link Zalo/Messenger → go-forward | P0 | ⬜ | ⬜ |

*(Bot Telegram cũ đóng băng làm reference lịch sử.)*

**🎯 Milestone:** 2 tenant (một có Page riêng, một không) dùng central; host tạo và player join đúng tenant trên central/tenant Page; no cross-tenant/double-send; Zalo/payment dogfood vẫn đúng.

### KPI P2–P3
% CK auto-match (name-based, `host_pro`) ≥ 70% · sự cố cross-tenant = 0.

---

## P3.5: IDENTITY — Gộp đúng 1 người xuyên kênh

> **Mục tiêu:** Person toàn cục + **link Facebook/Zalo vào Person đăng nhập Google** + merge an toàn (nền cho player-side & player view & discovery join).
> **Duration:** `TBD` · **Traction signal:** tenant #1 chạy ≥ 4 buổi thật trên Zalo/Messenger + có ≥ 1 ca 1-người-2-kênh quan sát được
> **Status:** ⬜ Not Started

Person/ChannelIdentity/Reachability (C1) · Membership (refactor members, UNIQUE per tenant) · **link Facebook + Zalo** vào cùng Person · claim-có-tiền cần verified account email hoặc transactional one-time `link_code` (**DD-50: không thu SĐT phase-1, phone dormant**) · conflict-safe merge plan, không rewrite ledger (DD-53).

**🎯 Milestone:** 1 người qua Facebook + Zalo cùng CLB = 1 nợ; merge có audit, không vỡ UNIQUE.

---

## P4–P4.3: WEB + SYNC + MARKETPLACE — Canonical backend & 2 phía

> **Mục tiêu:** PostgreSQL/domain model làm canonical store; web và chat là surfaces đồng bộ; host onboard self-serve; **chat in-app + cài đặt hồ sơ/giá theo giới tính**; player **khám phá & join kèo cross-club**.
> **Prerequisite:** P2–P3.5 stable.
> **Duration:** `TBD` · **Traction signal:** ≥ 2 tenant vận hành thật (1 có Page riêng, 1 dùng central) + ledger khớp sổ tay 2 kỳ liên tiếp
> **Status:** ⬜ Not Started

### R4 — Web app + Sync engine
| Feature | Mô tả | Prio |
|---|---|---|
| Web surface + canonical backend | host dashboard/player view; mọi ghi qua domain services vào PostgreSQL | P0 |
| Command bus + outbox | mọi action (mọi surface) → command → ghi + outbox event (cùng tx) | P0 |
| Projectors | Zalo · Messenger one-route tenant→central · realtime web · public_sessions | P0 |
| Idempotent + re-project | `commandId`/`event.id`; dựng lại surface khi lệch | P0 |
| **Chat in-app** (DD-38 ✅) | chat toàn CLB (RLS) + 1-1 (person-self); chỉ Plexco, **không bridge** kênh ngoài; SSE (schema `chat_*` chờ migration) | P1 |
| **Cài đặt hồ sơ + giá theo giới tính** (DD-39 ✅) | gender/dob/name/username/language; giá nam/nữ, suy charge theo `person.gender`; PII không lộ public (cột `person.gender` chờ migration) | P1 |

### R5 — Onboarding self-serve
Web signup → tenant/config/bank/Zalo. Messenger central sẵn; Page riêng optional FB Login/chọn Page, lỗi/revoke không block central fallback.

### R6 — Marketplace discovery (2 phía)
| Feature | Mô tả | Prio |
|---|---|---|
| Publish kèo | `visibility=public` → projector đẩy field-whitelist vào `public_sessions` | P0 |
| Discovery API/UI | lọc môn/khu vực/ngày/giờ/trình độ/giá/slot; cross-tenant, no-RLS, no tiền/PII/giới tính | P0 |
| Join cross-club | open → common join only after source authorization; approval → pending first; channel final confirm uses DD-32 link-or-pay gate + active/live-hold occupancy | P0 |
| Channel booking core | one decision core → tenant intent/15-minute hold → shared occupancy → verified-payment finalizer → thin Messenger/Zalo adapters | P0 |
| Bất biến public | test CI: field whitelist; private không lộ; join không trả tiền/PII/giới tính | P0 |

**🎯 Milestone (DoD):** host tạo kèo trên web → hiện ở Zalo/Messenger **và** marketplace ≤ vài giây; player lạ tìm kèo theo môn/khu vực và **join được**; chat in-app hoạt động; không lộ tiền/PII/giới tính ra public.

### KPI P4–P4.3
% player join qua discovery (CLB chưa từng tham gia) ≥ ngưỡng · số kèo publish/tuần tăng · sync-lag p95 ≤ 3 giây, p99 ≤ 10 giây · lộ tiền/PII/giới tính ra public = 0.

---

## P4.5–P4.7: PLAYER-SIDE CHANNELS — Join & nhắc/xác nhận đa kênh

> **Mục tiêu:** player join mượt từ chính kênh chat (Messenger → Zalo) + được nhắc/xác nhận tự động.
> **Duration:** `TBD` · **Traction signal:** ≥ 20 kèo public/tuần trên marketplace
> **Status:** ⬜ Not Started

Messenger base P2.5 + player action UX P4.5 · player view P4.6 · Zalo P4.7. Messenger reachability theo Page endpoint; reminder/notify one-route tenant Page→central, web+Zalo primary fallback.

**🎯 Milestone:** player join Zalo/Messenger, CK → tự xác nhận, chưa trả → tự nhắc; mọi thứ sync lên web.

### KPI P4.5–P4.7
% player tự join ≥ 60% · nhắc → thanh toán ≥ 40% · merge sai ~0.

---

## P5: BILLING

> **Mục tiêu:** thu phí thuê bao host bền vững.
> **Duration:** `TBD` · **Traction signal:** ≥ 3 host ngoài dùng ≥ 4 tuần liên tục **và** ≥ 1 host hỏi/chấp nhận trả phí
> **Status:** ⬜ Not Started

`subscription_invoices` (tách khỏi ledger player) · thu qua CK match `invoiceCode` → gia hạn · vòng đời **plan trả phí** trial→active→past_due→suspended · **`free` (0đ) vào thẳng `active` vô thời hạn — không trial/invoice, không past_due/suspended vì non-payment** (DD-29, BL-BIL-1) · suspended: chặn lệnh quản trị, **vẫn lưu CK player; kèo public hiện có chỉ sống tới khi đóng/hết giờ** · fair-use LLM/STT.

**🎯 Milestone:** (plan trả phí) hết trial bị chặn lệnh nhưng CK player vẫn lưu & kèo public vẫn hiện; CK đúng mã tự kích hoạt lại. `free` chạy bình thường không bị chặn vì non-payment.

### KPI P5
Trial → trả phí ≥ ngưỡng · MRR tăng, churn thấp.

---

## P6: HARDENING & SCALE

> **Duration:** `TBD` · **Traction signal:** có doanh thu thật **hoặc** ≥ 10 tenant — điều kiện nào đến trước
> **Status:** ⬜ Not Started

Pen-test cô lập **+ pen-test public layer** (thử rò tiền/PII/giới tính qua discovery) · load test >1k tenant + burst webhook + discovery + sync-lag (≤ vài giây p95) · observability (log `tenant_id`, metrics sync-lag, error tracking) · token-drift detection · secret KMS + scrub log · ToS/Privacy (tài chính + vị trí + hồ sơ cá nhân) · backup/restore drill.

### KPI P6
Đường rò rỉ cross-tenant = 0 · đường lộ tiền/PII/giới tính ra public = 0 · load p95 đạt mục tiêu.

---

## Ngoài lộ trình phase-1 — Membership (DD-115, P4+)

> **Không** nằm trong phase-1 (DD-114 D7) và **không** trong launch (DD-113 D3). Ghi ở đây để thứ tự delivery sau phase-1 có chỗ neo, không phải để kéo lên trước.

**Membership — gói hội viên chu kỳ 30 ngày** (`FE/feature_membership.md` v0.3 + `BE/feature_membership_tech.md` v0.3, Draft · DD-115 D1–D5 ✅ / D6–D8 ⬜).

| Hạng mục | Trạng thái |
|---|---|
| **Hard dependency** | Session core (recurrence + capacity) **và** Payment reconcile phải có runtime trước. Cả hai hiện chưa. Membership đọc `sessions` để đếm buổi và ghi `charges`/`payment_allocations` để thu tiền — không có hai thứ đó thì không có gì để dựng lên. |
| **Chi phí schema** | 3 bảng mới tenant-scoped/RLS. **0 thay đổi** trên `charges`/`payment_allocations`/`bank_transactions` và **0 cột mới** trên `memberships` — đây là lý do nó rẻ hơn vẻ ngoài. |
| ⬜ **Blocker cứng #1 (D6)** | Quyền vào kèo đã full là **ngoại lệ với BL-SES-2/BL-CBF-3** ⇒ Tier C, cần owner. Kèm gap hạ tầng: khái niệm **"sân" chưa tồn tại** (`grep -rin court packages/db` rỗng). |
| ⬜ **Blocker cứng #2 (D7)** | Bind CK vào chu kỳ là **ngoại lệ với BL-PAY-5 FIFO**. Chưa chốt ⇒ gói của người đang nợ cũ **không kích hoạt được** ⇒ không có slice nào chạy đầu-cuối. |
| ⛔ **Blocker ngoài (D8)** | Chiết khấu phí giải đấu chờ DD-82 — Tournament v1 không đụng tiền. |
| **Thứ tự đề xuất khi mở** | (1) đóng D6+D7 ở decision level → (2) migration 3 bảng + invariant test `Σ amount_due == total`, không-over-allocation, tenant isolation → (3) quote/purchase read-only trước, settlement sau → (4) chạy song song thu tiền lẻ **trọn một chu kỳ 30 ngày** rồi mới GA. |

---

## Dependency Map

```mermaid
graph TD
    A[P0 Foundation: Repo+Core+RLS+sports+3-tier+Google login] --> B[P2 Zalo tenant]
    A --> C[P3 Webhook CK reconcile]
    B --> B2[P2.5 Messenger + App Review]
    B --> C
    C --> D[Migrate tenant #1]
    B --> E[P3.5 Identity directory + link FB/Zalo + merge]
    E --> F[P4 Web surface + canonical backend + Sync engine + chat + settings]
    F --> G[P4 Onboarding self-serve]
    F --> H[P4.3 Publish + Discovery + Join cross-club]
    C --> Q[DD-32 Decision → Intent/Hold → Occupancy → Payment Finalizer]
    E --> Q
    H --> Q
    E --> I[P4.5-4.7 Player-side Zalo/Messenger + view]
    F --> I
    Q --> I
    H --> J[P5 Billing]
    I --> J
    J --> K[P6 Hardening + Scale]

    style A fill:#6366f1,color:#fff
    style C fill:#f59e0b,color:#fff
    style E fill:#10b981,color:#fff
    style F fill:#0ea5e9,color:#fff
    style H fill:#7c3aed,color:#fff
    style I fill:#10b981,color:#fff
    style J fill:#8b5cf6,color:#fff
    style K fill:#ef4444,color:#fff
```

**Legend:** 🟣 Foundation | 🟠 Tenant Engine | 🟢 Identity/Player | 🔵 Web+Sync | 🟪 Marketplace/Billing | 🔴 Harden

---

## Monetization Alignment

Host trả thuê bao theo **DD-29** (Phase-1 pivot, thay DD-03 4-tier): **`free` 0đ** (web + **kết nối Zalo + Messenger** + quản kèo/roster + **giá theo giới tính** + **mark-paid thủ công toàn cầu** + nhắc thủ công + in-app Chat target) và **`host_pro` 250k** (thêm entitlement `payment_reconcile_auto` + **nhắc nợ tự động** + **Trợ lý AI + KB** + CRM dashboard). Entitlement không tự mở auto-reconcile: exact market/provider/bank/currency/consent phải pass; nếu không, manual vẫn hoạt động. Tính năng free/pro theo **capability flags config-driven** (registry ở `../features/BE/feature_billing_lifecycle_tech.md §4b`).

| | Trial | Active | Suspended |
|---|---|---|---|
| Tạo/quản kèo, mark-paid thủ công, nhắc, xác nhận, player view, chat in-app | ✅ | ✅ | ❌ lệnh quản trị |
| Nhận & lưu CK player | ✅ | ✅ | ✅ (vẫn lưu) |
| **Kèo public trên marketplace** | ✅ | ✅ | 🟡 read-only: hiện có sống tới khi đóng/hết giờ; KHÔNG tạo mới/gia hạn |
| Nối APIpay/SePay · Zalo bot (BYO) · Messenger central + optional Page riêng (App Review) | ✅ | ✅ | ✅ / — |
| Đối soát CK tự động + nhắc tự động (`host_pro`) | ✅ | ✅ | ❌ |
| LLM/STT (platform trả, trần fair-use) | ✅ | ✅ | — |

> **`free` (0đ):** luôn ở cột **Active** vô thời hạn — không có cột Trial/Suspended-vì-non-payment (chỉ rơi vào Suspended nếu vi phạm ToS/abuse). Cột Trial/Suspended ở trên chỉ áp dụng cho plan trả phí.

> Dòng tương lai (ngoài MVP): player-side premium (lọc/nhắc kèo nâng cao), promote kèo trên marketplace, managed Zalo/Messenger bot, add-on ngoài tier host hiện tại.

---

## Risk Analysis

| # | Risk | Impact | Likelihood | Mitigation |
|---|---|---|---|---|
| 1 | **Rò rỉ cross-tenant** (tiền/chat) | 🔴 Critical | Thấp | Repo choke-point + RLS fail-closed + test bất biến CI |
| 2 | **Lộ tiền/PII/giới tính ra public marketplace** | 🔴 Critical | Medium | Public projection field-whitelist; tiền/PII không vào read model; test bất biến public; rate-limit |
| 3 | **Sync lệch trạng thái kênh ↔ web** | 🔴 Critical | Medium | Canonical store + event re-projection; idempotent command/event; metrics sync-lag |
| 4 | Gán nhầm nợ / chiếm định danh | 🔴 Critical | Medium | Claim-có-tiền cần khoá mạnh; merge chỉ verified (AUDIT C2/C5) |
| 5 | Webhook race / double-count | 🟠 High | Medium | Idempotent UNIQUE + lưu raw trước ack |
| 6 | **Marketplace cold-start** (ít kèo/player) | 🟠 High | Medium | Beachhead community host hiện có; seed tenant #1; khuyến khích publish; 1 môn trước |
| 7 | Lạm dụng marketplace/chat (spam join/scrape/spam chat) | 🟡 Medium | Medium | Rate-limit + approval mode + area-level geo + abuse controls |
| 8 | Token Zalo/Page lộ | 🟠 High | Thấp | KMS + scrub log + getWebhookInfo-drift + rotation (AUDIT §B2) |
| 9 | **Messenger App Review trượt/chậm → kẹt kênh phase-1** | 🟠 High | Medium | Nộp App Review sớm; degrade sang web + Zalo; Messenger không phải kênh nhắc-nợ chính |
| 10 | Zalo GROUP Beta / Messenger policy đổi (24h/outside-window eligibility) | 🟡 Medium | Medium | Bám DM Zalo + web; Messenger join+xác nhận trong 24h; hỏi cap/giá trước scale |
| 11 | Solo dev ship chậm | 🟡 Medium | Medium | 7 phase nhỏ, mỗi phase ship được; AI co-pilot |
| 12 | Host không trả phí | 🟡 Medium | Medium | Soft-launch free validate (sau P4.3); giá thấp; trích quỹ nhóm |

---

## Critical Path

```text
Foundation(RLS+sports+3-tier+Google) → Zalo-tenant → CK-reconcile → migrate #1 → Identity
   → Web+Sync(+chat+settings) → Onboarding+Marketplace(discover/join) → Player-side → Billing → Harden
   ⬜            ⬜             ⬜            ⬜           ⬜
   → ⬜          ⬜                          ⬜            ⬜         ⬜
```

**Bottleneck hiện tại (`main@1fdba1d`, 13/08):** DB plane đã dày thêm một lớp nữa — shared job claim/ack/dispatcher/queue/preflight/scheduler (`0022`/`0023`), capability registry (`0028`/`0029`) và giờ là chat root + DM-safety authority (`0030`–`0032`). Product vẫn có **0 business route, 0 connected FE screen, 0 domain producer, 0 real projector, 0 chat service**. Schedule mặc định OFF. Safari measurement không còn là blocker; Google vẫn OFF tới owner go-live/env decision. **FE PENDING theo lệnh owner 13/08.**

> **Chẩn đoán thẳng, vì nó đã lặp ba tuần:** bottleneck không còn là *thiếu nền*. Nền đã thừa so với thứ đang chạy trên nó — 33 migration, 813 test, 5 file invariant, và **0 người dùng làm được một việc gì**. Ba tuần gần nhất đều kết bằng "migration merged, code dark". Node thấp nhất chưa build là **Session BE vertical**, và nó vừa cho tín hiệu: lane v1 `HALT MAX_ROUNDS` sau 5 vòng fix vì validation input là một họ edge case không hội tụ bằng cách vá từng vòng. Successor `--v2` đổi hình dạng (một validator duy nhất, khoá advisory độc lập command type) — chẩn đoán đó đúng thì lane này là lần đầu vượt khỏi tầng DB.

Chuỗi kế tiếp (theo `../autopilot-templates/next-lanes-2026-08-13-RUN.md`):

1. **Đang chạy trên branch (ngoài mọi trục, luật 1) — `session-service-create-command-core--v2`:** `CreateSession` command service (draft + outbox producer). Packet `CODE_READY`, DD-105 đã đóng blocker B4 (create-draft ungated theo *tính vô hình*, không phải theo "mutation nhỏ"). Merge được thì đây là **producer thật đầu tiên** cho `0022`/`0023` — và là lần đầu % ở §Dev Progress có lý do để đổi.
2. ⬜ **C7 — chat slice 7 `chat-shared-message-command-core`:** hết precondition từ khi `0032` land; packet + manifest đã author (còn untracked). Xếp sau Session vì Session là node thấp nhất chưa build.
3. ⛔ **Enablement-only:** owner quyết định bật Google, set `GOOGLE_OAUTH_*`/CTA và verify production gates; measurement M3 đã đóng, không cần đo lại.
4. ⬜ Email/password bundle order-4 (flag OFF) → gỡ Telegram provider (2 route Telegram-era vẫn nằm trong 10 route hiện có).
5. ⬜ Mark-paid thủ công → auto-reconcile có regional capability gates → sync surfaces.
6. 🔴 **Không chạy:** mọi lane FE (DD-81/M0.3/M4) — treo theo lệnh owner 13/08.

> **Điều kiện bật scheduler không đổi:** không bật trước khi có real producer/projector + runbook. Đây là enablement lane riêng — **không chặn** việc author read-only Chat slice 19 trên baseline `players`/`memberships`/`sessions` đã merge. Nhưng bật `/sessions|/waitlist` beta vẫn phải đợi đủ `svc-session-crud` + `svc-session-join-leave` + `svc-waitlist-promotion-core` và production-shaped data E2E — `CreateSession` một mình **không** mở beta.
>
> ⚠️ **Thứ tự trên là near-term execution sequence, không phải canonical phase order.** So với v3.4o, Session BE lên #1 (trước là #3) và Google enablement xuống #3 (trước là #1) — vì lane Session đã có packet `CODE_READY` + code đang bay, còn Google là quyết định owner nằm ngoài lane. **Canonical P-number và Dependency Map không đổi.**

---

## 💰 Critical Path to Revenue

> Tách khỏi critical path kỹ thuật ở trên. Câu hỏi khác nhau: critical path hỏi *"thứ tự nào không vỡ dependency"*; mục này hỏi **"chuỗi ngắn nhất tới đồng đầu tiên"** — và cái gì đang nằm trên chuỗi đó mà không cần thiết.

```text
[✅] Foundation + RLS
        │
[🟢⛔] Google code + Safari measurement DONE ──▶ ⛔ owner enable/env decision ──▶ [⬜] login bật được
        │
[⬜] Session CRUD (host tạo kèo)   ──▶ CreateSession ở lane --v2, CHƯA merge ⇒ vẫn ⬜
        │
[⬜] 4b.1 Mark-paid thủ công  ◀── free tier đã đủ vận hành từ đây
        │
[⬜] Dogfood tenant #1 trên kênh thật ──▶ traction signal P5
        │
[⬜] 18 Billing + lifecycle (`subscription_invoices`, CK match `invoiceCode`)
        │
        ▼
    💰 ĐỒNG DOANH THU ĐẦU TIÊN
```

**Không nằm trên chuỗi (có thể trượt mà không mất doanh thu):**

| Hạng mục | Vì sao không chặn revenue |
|---|---|
| **17 Messenger / App Review** | Zalo + web đã đủ vận hành; Messenger là kênh mở rộng. Degrade path đã pin ở DD-37 |
| **11–13 Marketplace discovery** | Là động cơ tăng trưởng phía cầu, không phải điều kiện để host trả tiền |
| **10b In-app Chat primary target · 10c gender pricing** | Tăng độ dính; DD-91 chốt direction và `0030`–`0032` đã cho Chat DB root, nhưng **0 service/API/UI** ⇒ vẫn không phải lý do mua. Lưu ý ngược lại: ba migration chat đã tiêu tuần làm việc mà đường tới doanh thu không ngắn đi mét nào |
| **7 Identity merge** | Cần cho đúng-nợ-xuyên-kênh; 1 kênh thì chưa bức thiết |
| **DD-73..78 share/activity/feed** | Đã tự gate bằng evidence, đúng chỗ |

**Nằm trên chuỗi nhưng có thể làm mỏng hơn:**

- **5.x auto-reconcile** là *giá trị* của `host_pro`, nhưng host vẫn trả tiền được khi có mark-paid + nhắc thủ công. Ship 4b.1 trước; chỉ mở 5.x khi entitlement `payment_reconcile_auto` + exact market/provider/bank/currency/consent pass. SePay/ApiPay hiện là Vietnam launch path chưa enable.
- **9 Sync engine** cần cho đa-surface. Nếu phase-1 chấp nhận **web-first, kênh chat read-mostly**, sync có thể mỏng đi đáng kể ở vòng đầu.

> ⚠️ **Quan sát thẳng:** đường tới doanh thu hiện đi qua **P5**, tức gần cuối roadmap. Đây là rủi ro cấu trúc, không phải rủi ro thực thi — validate willingness-to-pay bị đẩy về sau cùng. Cân nhắc một **soft-launch thu phí sớm** (thủ công, không cần module 18: chuyển khoản + bật cờ tay) ngay khi có 3 host ngoài, để đo giá trước khi build lifecycle tự động.

---

## 📣 GTM theo phase

| Phase | Kênh acquisition | Đối tượng | Chỉ dấu thành công |
|---|---|---|---|
| **P0–P1** | Không acquire — dogfood nội bộ | CLB của founder | Host (founder) đăng nhập + tạo kèo được |
| **P2–P3** | Tenant #1 migrate; giới thiệu 1-1 trong nhóm Zalo sẵn có | 1–2 CLB cầu lông quen | 2 tenant vận hành thật, 0 sự cố cross-tenant |
| **P3.5–P4** | Word-of-mouth từ host #1 sang host cùng sân/cùng giờ | Host cầu lông cùng khu vực | ≥ 5 host onboard self-serve không cần hỗ trợ tay |
| **P4.3** | Seed marketplace bằng chính kèo của tenant hiện có; group Facebook/Zalo cầu lông theo khu vực | Player discovery (persona P4 "Lan") | ≥ 20 kèo public/tuần; player lạ join được |
| **P4.5–P4.7** | Player kéo player trong chính kèo (nhắc/xác nhận tạo thói quen) | Player member | ≥ 60% player tự join |
| **P5** | Chuyển host free đang active nhất sang `host_pro`; giá thấp, trích quỹ nhóm | Host đã dùng ≥ 4 tuần | ≥ 1 host trả phí thật |
| **P6** | Mở rộng môn (pickleball/tennis) khi cầu lông đã bão hoà 1 khu vực | Host đa môn | Không rò rỉ khi scale |

> ⚙️ **DD-114 (22/08) — bảng trên nói *acquisition theo phase*, không nói *feature scope*.** Phase-1 theo DD-114 gồm 7 nhóm; hàng **P5** của bảng ("chuyển host free active nhất sang `host_pro`") nay **không còn là bước cuối** mà là **điều kiện của chính nhóm 6**: không có `host_pro` thì không có gì để gate auto-reconcile + nhắc tự động.
>
> ⚙️ **DD-113 (22/08) — bảng trên là GTM theo *phase kỹ thuật*; nó KHÔNG khai thứ tự surface.** Thứ tự surface nay là: **web app + Zalo bot ra mắt song song, native sau**. Hai hệ quả cho bảng này: (a) mọi metric acquisition/activation từ nay phải khai **đo trên surface nào**, gộp lại là tự lừa; (b) hàng P0–P1 "không acquire — dogfood nội bộ" vẫn đúng, nhưng điều kiện vào beta thật nay là **pre-beta launch readiness gate** ở `../strategy/gtm-strategy.md` (FE PENDING đã gỡ · signin/signup chạy trên thiết bị thật · link Zalo ⇄ account end-to-end · session management/detail có thao tác thật qua route thật · bot tạo kèo + RSVP trong group thật).
>
> **Beachhead giữ nguyên:** cầu lông, 1 khu vực, host có sẵn cộng đồng. Mở môn/mở vùng chỉ sau khi vòng lặp host→player→host chạy được ở khu vực đầu tiên (risk #6 marketplace cold-start).

---

## Next Actions (Priority Order)

1. ✅ ~~BRD / PRD / TDD core review~~ — đã sync v3.4 channel pivot (bỏ Telegram; Zalo + Messenger + Google login); **DD-38/39 ✅ committed**
2. 🔴 Đóng các gate còn lại: ~~lifecycle grace/trial timing~~ ✅ **DD-51**; **DD-04 đã chốt**, còn egress-IP/provider verification + infra build/restore/failover/load drill; **legal A3** (PII retention — luật sư VN, chặn go-live); Zalo external spikes **DD-14/15**; **DD-33 đã chốt nhưng exact Meta evidence cho messaging và Facebook Login/account-link vẫn pending** (không coi một approval tự bao nhóm kia); Club Assistant go-live **DD-18** và chi tiết P7 **DD-34/35/36**. Schema/code/infra vẫn land theo build slice. Checklist: `../probes/pre-code-open-items-2026-07-16.md`.
3. 🟡 Review/sign-off feature specs của phase sắp build; chuyển acceptance criteria thành issue checklist — **Session Management đã xong** (`docs/issues/session-management-acceptance-checklist.md` COMPLETE, re-traced tới hợp đồng publish ngày 24/07). Các feature còn lại chưa có checklist.
4. ✅ ~~Setup monorepo (pnpm: core/bot/web) + Postgres docker~~ — đã merge (S1)
5. ✅ ~~Lift `core` + `sports` + test xanh~~ — đã merge (S2)
6. 🟡 Schema tenant đa môn + ledger + RLS/worker contract + public_sessions skeleton + repo choke-point + **test bất biến** — foundation đã merge; tail hiện là **`0036`** (re-pin 02/09).
   - **Audit 06/09 — hàng đợi sửa A1→A9 (`../autopilot-templates/audit-fix-lanes-2026-09-06-RUN.md`, thứ tự = bảng của doc đó; BE + infra trước FE):** **A1** CI so với `origin/main` (X-1, `fix/a1-ci-origin-main`) → **A2** `tenant_provision` chạy được dưới RLS, `0037` (D-2, `fix/a2-tenant-provision-rls`) → **A3** readiness đạt được `ready` + gỡ đường login Telegram (W-5/W-1, `fix/a3-readiness-telegram`) → **A4** `subscriptions` REVOKE DML + definer reader `0038` (D-1, sau A2) → **A5** dispatcher completion grammar (B-1) → **A6** security headers + rate-limit `google/complete` (W-2/W-3, sau A3) → **A7** compose loopback + role `app` ở dev (X-2/X-4, sau A2) → **A8** docs drift + backlog ownership (pass này) → **A9** authoring DD-56 amendment #3 cho `GET /api/sessions` (+`/:id`) (owner ký). A1–A7 đã author trên branch (06/09), **chưa merge**; A9 chưa bắt đầu. Tier C chờ owner: C1 roster writer · C2 ngôn ngữ per-user · C3 launch self-serve hay provision tay · C4 `GOOGLE_OAUTH_*` enable · C5 A3 luật sư · C6 outbox attempt bound. Auth Google `0015`–`0018` + Safari measurement đã xong nhưng chưa enable; email/password order-4 vẫn pending (`blocked`, phải re-slice thành DB/route/delivery prerequisite trước khi implement).
   - **Việc kỹ thuật hiện hành (02/09, đo tại `620b2bd`) — hàng đợi BE/infra còn lại, xếp theo dependency chứ không theo độ hấp dẫn:**
     **BE.** (1) **Wiring auto-reconcile DD-114 D2.3** — `resolveCapability()` vẫn 0 caller ⇒ hard-dep (a) của phase-1 chưa đóng; đây là root chưa xây thấp nhất, làm trước mọi thứ khác. (2) **Route cho `close`/`cancel`** — cùng khuôn `session-command-route.ts` đã có; route `announce` **không** đi cùng đợt này vì DD-56 clause 1 gate nó vào việc bật schedule. (3) `tenant-capability-authority-core` → tiền đề của `chat-shared-message-command-core`. (4) **DD-118 phủ nốt `runWithLang`** ngoài đường session-command. (5) Job runtime (`job-scheduler-cron-registration` · `job-consumers-per-feature` · `db-projector-dlq-no-replay-path` · `job-outbox-dispatch-sync-lag-slo`) — toàn `idea`, và scheduler **không được bật production cron trước khi downstream safety contract tồn tại**. (6) DD-65..68 endpoint slice chưa mở. (7) `capacity-floor-active-vs-paid-roster` — `blocked`, từ probe `c8c109e` #8. (8) Projector public read model = **epic bốn tiền đề**, AWAIT — không phải "một slice còn nợ".
     **Infra.** (a) **Canonical runner re-pin** (máy owner, cần Postgres) — bước 1 của P4, treo từ 24/08, và là thứ duy nhất gỡ được nhãn `STALE` ở trục Tests. (b) **BUILD-STATUS live-truth vẫn pin `25/08 @ 1215a6a`** — stale so với `0036`; refresh cùng lượt với (a). (c) **Push `620b2bd`** rồi đọc GitHub Actions runs (bước 5 của P4). (d) `db-zalo-bots-secret-hardening` — ⚠️ **scope row sai**: row nói `zalo_bots.secret` nhưng fixture tracked dùng `bot_token_enc`; phải trace reader/writer thật trước, và KMS/rotation là **owner-reserved**. (e) `infra-do-app-vpc-deployment` · `db-app-worker-least-privilege-attestation` · `dev-app-worker-password-not-restored` — `idea`. (f) `local-dev-sanctioned-paths-are-harder-than-the-forbidden-one` (`planned`) — thiếu `db:reset:test`. (g) `infra-egress-compatibility-evidence` — `blocked` owner-only, **đừng re-launch**.
   - **Việc kỹ thuật (13/08, lịch sử):** (a) evidence = 37 file / **813 workspace runner @`80a3464`**, static 772 — **đối chiếu đóng: `772 + 41 = 813`** (luật 4); (b) `0022`/`0023` + dispatcher/queue/preflight/scheduler merged nhưng schedule OFF, **producer đầu tiên đang ở lane `session-service-create-command-core--v2`, chưa merge**; (c) `0030`–`0032` cho Chat DB root nhưng **0 service** — đừng claim là Chat runtime, cùng bẫy với (b); (d) wire consumer ambiguity DD-87 vẫn separate; (e) **kiểm kê generator phải chạy cả 2 lớp** — `it.each` vô hình với grep cũ. 🔴 **FE: PENDING theo lệnh owner 13/08** — không track `.pen`, không mở page/component; đây không còn là gate DD-81 mà là quyết định owner.
7. 🔴 Zalo tenant middleware + mark-paid thủ công + lệnh host + Messenger (P2.5, App Review) + webhook reconcile + migrate tenant #1
8. 🟡 Identity → Web/Sync/Onboarding (+ chat + settings) → Marketplace/Join → Player channels → Billing → Harden
   - **DD-32 implementation order:** account-backed link resolver → shared decision core → intent/hold migration + occupancy helper → verified-payment finalizer/expiry/manual-review → thin Messenger/Zalo ports. Không bắt đầu từ adapter và không claim BE companion là code authorization.
   - **Mới (DD-73..78 ✅ chốt 19/07 tại decisions v1.60, sequencing corrected v1.64):** trong khối *Marketplace/Join* bổ sung **(8a) immediate-deny path cho public read model** — `public_projection_fences` + guarded view + narrow raise/CAS-clear + `public_projection_version` + grant migration đưa consumer khỏi base table. **Đây là nợ của DD-12, không phải chi phí của share**: hiện kèo chuyển private/cancel phải chờ projector async mới hết lộ. Sau (8a) mới tới **(8b) DD-73** = route `/s/<id>` + OG card + funnel telemetry; (8b) còn chặn thêm bởi **DD-41 projection migration** (whitelist BL-DSC-1 chưa có trong `public_sessions`). **✅ (8a) ĐÃ LAND 25/08/2026 — `9da3021`, migration `0033`** (guarded view `public_session_share_v` + raise/CAS-clear + REVOKE base SELECT khỏi `readonly` **và** `app`); (8b) vẫn chặn bởi DD-41 + OQ DD-114 D3.
   - **Sequencing không vòng lặp:** DD-74/75 chưa vào hàng đợi ngay; sau dependency kỹ thuật + reprioritization bằng telemetry DD-73, chúng tạo activity baseline. **Chỉ DD-76/77** (feed/kudos) bị hard-gate bởi baseline/liquidity + ngưỡng owner. DD-78 không có queue riêng: ảnh session đi cùng (8b), ảnh activity đi cùng DD-75.
   - **DD-86/DD-91–95 boundary:** N club channels + DM. DD-86 owns exact `chat.channel.manage` + `chat.channel.post_restricted`; DD-95 alone owns `chat.message.moderate` + `chat.member.mute`. Assistant defaults ON `all_members`/OFF `admins_only`, mutable cả hai dưới tenant config/`assistant_ai_kb`/provider/privacy; Announcements là `admins_only` default OFF, không permanently prohibited. DD-92 = reply/immutable structured mentions/reaction `👍|❤️|😂|😮|😢|🙏`, own edit `<15m` max 5, author soft-delete và pre-beta search. DD-93 registry ASCII case-insensitive: mọi club/Club Bot/human-DM overlay có `/help|/pay|/me|/myclubs|/discover|/name`, club + Club Bot thêm `/sessions|/waitlist`. DD-94 = unread-derived generic opaque offline signal/digest, không durable content snapshot/item; DM/mention/reply ON, club pref default `mentions`. DD-95 = club hide/restore + mute `1h|24h|7d`, exact reasons `spam|harassment|unsafe|off_topic|other`; không hard-delete/permanent ban/DM moderation-read. Assistant/Chat/Notifications pairs đã Reviewed; current readiness chỉ lấy từ primary plan §13. DD-88 là broader `DEFERRED_PROPOSAL`.

---

## North Star Metric

> **Số kèo "hoàn tất vòng" mỗi tuần** = kèo được tạo → có player join (gồm **join qua discovery**) → đối soát/xác nhận. Đo cả 2 phía: host vận hành thật + player (kể cả mới) join thật, đa môn, đa kênh (Zalo/Messenger/web).

**Metric hiện tại = 0** — chưa có surface nào chạy. Metric phụ để theo dõi tới khi North Star khởi động được:

| Giai đoạn | Metric tạm | Ngưỡng |
|---|---|---|
| P0–P1 | Đăng nhập Google thành công trên thiết bị thật | ≥ 1 (Safari + iOS) |
| P2–P3 | Kèo tạo trên Zalo đúng tenant / tuần | ≥ 2 |
| P4 | Kèo tạo trên web hiện đúng ở kênh ≤ vài giây | p95 ≤ 3s |

---

## Phụ lục A — Bảng tra DD (chỉ các DD được ROADMAP tham chiếu)

> Đây là **bản tra nhanh**, không phải authority. Nguồn sự thật hiện hành là `../standards/decisions.md` (**v2.28 lúc mirror 13/08** — đọc changelog của chính file đó, đừng tin số này quá một tuần); status đọc theo từng DD và decision không đồng nghĩa runtime. Khi hai bên lệch ⇒ decisions.md thắng, và bảng này phải được sửa.

| ID | Một dòng | Trạng thái |
|---|---|---|
| DD-03 | Pricing 4-tier theo kênh | 🔄 thay bằng DD-29 |
| DD-04 | Hosting PostgreSQL → DigitalOcean co-locate | ✅ (còn gate egress-IP) |
| DD-06 | Độ chi tiết vị trí public = area-only | ✅ |
| DD-10 | Web stack = Next.js | ✅ |
| DD-12 | Public read model `public_sessions` + projector | ✅ |
| DD-13 | Auth phase-1 = Google + email/password | ✅ |
| DD-14 | Zalo Login có bị chặn bởi cửa đăng ký OA? | ⬜ **mở — SPIKE** |
| DD-18 | Provider embedding/LLM + privacy/ToS | ⬜ mở — **chặn go-live Assistant** |
| DD-29 | Pricing pivot: `free` 0đ + `host_pro` 250k | ✅ |
| DD-30 | APIpay enterprise auto-provision per-host | ✅ |
| DD-32 | Browse freely; link-or-pay at final confirm (Option D) | ✅ decision/docs; no runtime |
| DD-33 | Facebook Login / Messenger account-link | ✅ (Meta evidence còn pending) |
| DD-34 | Plexco Global KB plane | 🟡 approve-in-principle P7 |
| DD-37 | Channel pivot: bỏ Telegram; Messenger + Zalo + web | ✅ |
| DD-38 | Chat in-app phase-1 (club-wide + 1-1, chỉ Plexco) | ✅ |
| DD-39 | Giá theo giới tính | ✅ |
| DD-40 | Mark-paid thủ công mặc định mọi tier | ✅ |
| DD-41 | Field mô tả + gating cho `sessions` | ✅ |
| DD-45 | Model hoá waitlist | ✅ |
| DD-47 | Social follow graph | ✅ framework, build P4+ |
| DD-49 | Money correction lifecycle | ✅ |
| DD-50 | Không thu SĐT phase-1; khoá mạnh = verified email + `link_code` | ✅ |
| DD-51 | Host Pro lifecycle trial/grace/refund | ✅ |
| DD-53 | Identity recovery + merge-split authority | ✅ |
| DD-57 | FE architecture principles (adopt từ Sporta) | 🟡 đề xuất |
| DD-60 | API reference convention | ✅ |
| DD-61..64 | Session Organize (court/match/assign/live score) | ✅ accept-in-principle · build post-P4 |
| DD-65..68 | Messenger hybrid: topology · shared surface · page-scoped identity · durable interaction | ✅ |
| DD-69 | App-native: phase-1 PWA → phase-2 native | ✅ định hướng · build TBD |
| DD-73 | Share link + preview card | ✅ · tách 2 slice |
| DD-74/75 | Activity read model + publish lifecycle | ✅ · tạo baseline |
| DD-76/77 | Feed + kudos | ✅ contract · **build gated bởi evidence** |
| DD-78 | Ảnh share do Plexco render (template-only) | ✅ |
| DD-79 | Home personal dashboard (S9, composition-only) | ✅ |
| DD-80 | Auth credential lifecycle (B0) + slice order D0a→D1→email→gỡ Telegram | ✅ · **D0a..d1b đã merge** |
| DD-81 | Pencil + target Energetic Orange/Sora/Inter; active tokens chưa đổi | ✅ direction · 🔴 **FE PENDING theo lệnh owner 13/08** (không còn là HOLD-chờ-gate) |
| DD-86 | In-app N club channels; exact lifecycle/post keys `chat.channel.manage` + `chat.channel.post_restricted`; Assistant default ON `all_members`/OFF `admins_only`, mutable both under gates; Announcements admins-only default OFF. DD-95 owns moderation/mute keys | ✅ `DECISION_FINAL`; no runtime |
| DD-88 | Broader notification grouping/message-request initiative | ⏸️ `DEFERRED_PROPOSAL`; does not own/block DD-94 exact Chat digest |
| DD-91 | In-app Chat primary surface + requester-only `/pay` | ✅ `DECISION_FINAL`; no runtime |
| DD-92 | Reply/immutable mentions; emoji reactions; own edit/soft-delete; pre-beta search | ✅ `DECISION_FINAL`; no runtime |
| DD-93 | ASCII case-insensitive, zero-arg, surface-aware slash registry | ✅ `DECISION_FINAL`; no runtime |
| DD-94 | Chat-unread-derived generic opaque offline signal/digest + preferences/live authz | ✅ `DECISION_FINAL`; timing/config enablement-only; no runtime |
| DD-95 | Club-only hide/restore + exact timed mute/reason/audit contract | ✅ `DECISION_FINAL`; no runtime |
| DD-96 | Home money chips: cross-club `SelfPaymentSummary` (Part A) + host receivable "Chưa thu" (Part B) | ✅ A contract-shape final · B direction ✅ / mechanism 🟡 (4 blocker B1–B4) |
| DD-97 | Collection statement + export sao kê — per-session view **free** · kỳ/tháng + export PDF/XLSX **`host_pro`** | ✅ direction + entitlement (owner-delegated 07/08) · mechanism chờ DTO owner Reviewed |
| DD-98 | Negative scope Sporta-port NP-1..5 (custom split · hold linked member · push kèm tiền · auto-archive nợ · geo/radius vs DD-06) | ✅ `DECISION_FINAL` (owner-delegated 07/08) |
| DD-99 | FE spec hardening: 4 section (Analytics/State Machine/AC/Testing) = điều kiện FE Draft→Reviewed · backlog P2→P4→P3 · breakpoint rule 2 lớp (OQ-1) | ✅ P1 + OQ-1 chốt · priorities pinned (owner-delegated 07/08); không authorize build |
| DD-55 | In-app DM policy: DM chỉ mở khi canonical safety core enforce tại request/create/send/read + block/report/rate-limit/audit; host/support KHÔNG đọc DM | ✅ policy + hard safety gate · **`0030` đã land authority; 0 service** |
| DD-102 | Waiver torn-read của `assert_dm_allowed` (4 statement → 1), **có điều kiện cứng** | ✅ · **nghĩa vụ ĐÃ ĐÓNG bằng `0032`** (`80a3464`, 12/08) — slice 7/8 không còn mang blocker này |
| DD-103 | Chấp nhận gap Person-merge re-parent của `0031`, có ràng buộc cứng (trigger immutable trên `person_id`/`dm_key` + composite FK non-`DEFERRABLE` ⇒ **cấu trúc chặn** re-parent) | ✅ · nợ P1 `chat-identity-merge-reparent-enablement` vẫn `NOT_CODE_READY`, đứng **trước** Person-merge |
| DD-104 | `DeleteSession` hard delete dựa trên cascade **không tồn tại** (9 FK trỏ `sessions`, zero `ON DELETE CASCADE`); D0–D4 chốt ở decision level | ✅ decision-level (13/08) · **slice DEFERRED** chờ packet `tenant-capability-authority-core`; spec-WIP DeleteSession đã gỡ lần hai |
| DD-105 | Suspension gate cho `CreateSession`: **miễn theo TÍNH VÔ HÌNH của draft** (invisible-until-publish **và** money-free), **không phải** miễn theo "mutation nhỏ" | ✅ Chốt (owner 13/08) · đóng blocker B4 ⇒ `session-service-create-command-core` `CODE_READY`. Ranh giới thật `publish_new_sessions` vẫn ❌ khi suspended |
| DD-100/101 | Level 3.1 adoption · ratify B3-budget amendment | ✅ · process/kit, không đổi product scope |
| DD-113 | GTM re-sequencing: launch = PWA + Zalo bot **song song**, native lùi phase sau; PWA v1 = 5 khối; gate native thành ngưỡng đo được | ✅ Chốt (owner 22/08) · **không** gỡ FE PENDING, **không** đổi P-number/dependency order |
| DD-114 | Phase-1 = 7 nhóm (signin · create club · link club⇄bot · link account⇄Zalo · sync + public/private · session + tiền · settings/privacy); launch DD-113 là **subset** | ✅ Chốt (owner 22/08) · **billing P5 vào phase-1** (vế tiền chỉ `host_pro`) · toggle public/private **sau fence 8a** · A3 legal thành blocker · ⬜ OQ public-khi-chưa-có-discovery |
| DD-116 | Lệnh FE PENDING (13/08) đưa vào decision log — **nguồn bền** thay RUN doc 13/08 | ✅ Chốt **Option B — KEEP** (owner 24/08) · gỡ chỉ khi named trigger đủ CẢ BA: chọn canonical `.pen` (đúng một) · tracked trên `main` · owner ký nghiệm thu design authority (gate DD-81); khi gỡ ⇒ FE bounded 5 khối launch, mỗi lane vẫn qua gate; không sự kiện khác gỡ |
| DD-117 | `Close`/`Cancel` nhánh paid/retry-root = **fail-closed refuse** (`CANCEL_REQUIRES_REVIEW` class) tới khi payments/review_policy tồn tại; thay deferral 14/08; **D5:** cả họ session command dedup CHỈ trên `(tenant_id, command_id)` — content fingerprint bị bác | ✅ Chốt (owner 25/08) · authorize build Update+Close+Cancel (S2, STOP_AT_READY) · **KHÔNG** authorize subsystem payments/review_policy · DD-112 vẫn ⬜ |

---

## 📜 Nhật ký cập nhật

> Khối mới nhất trước. Mỗi đợt một `<details>`; **nội dung các khối cũ giữ NGUYÊN VĂN** — mục này chỉ đổi chỗ đứng, không đổi chữ.

<details>
<summary><b>19/09/2026 — v3.18 · re-pin <code>e235ea4</code> → <code>12f5191</code>, gate chạy thật + <code>pnpm progress</code></b></summary>

> 🟩 **PASS 19/09/2026 tại `main@12f5191` — 38 commit sau `e235ea4`; mã nguồn tại pin ≡ `origin/main@00cc510` (`git diff --name-only 00cc510..12f5191 -- packages apps scripts` → rỗng).**
> **Gate đã chạy thật (Mac, worktree tách rời, `NODE_ENV=test`, Postgres docker, cluster dọn TRƯỚC khi đo):** `pnpm test` **exit 0** trong 94 s — **1823 workspace** (core 199 · db 858 · web 643 · bot 123, 59 file) **+ 172 readiness/kit**; `pnpm typecheck` · `pnpm lint` · `pnpm format:check` · `pnpm review:check` · `pnpm build` đều exit 0; `git status --porcelain --untracked-files=all` **rỗng** sau khi chạy trọn suite (bug 24 vẫn đóng).
> **Đã vào `main` từ `e235ea4`:** 14 PR (#14–#27). Đợt `codebase-fixes-2026-09-16`: bound OAuth/onboarding body read · bound cleanup rate-limit hết hạn (`0046`) · guarded tenant context cho guest note (`0045`) · authorize guest-note route context · bootstrap member kiểm theo catalog OID · reject payment integer không an toàn · chặn dispatcher completion dị dạng · bot test lifecycle join trước teardown · giữ pool checkout API + retry role check · capacity guard của `UpdateSession` tính cả guest note · eslint bỏ qua ap3 runtime state · readiness validator nhận literal route target. Cùng với PR #14 (`ap3-intake` session-management ⇒ `READY_WITH_SUPERVISED_SLICES`) và kit ap3 W5.2.6 + W6.
> **Ba commit docs/tools local, chưa push:** `0601229` (chính là pass 15/09, rebase lên `origin/main` ngày 19/09 — hai file spec session lấy bản upstream mới hơn vì chúng mô tả capacity guard 16/09) · `c2132b5` `tools/progress.mjs` + `pnpm progress` · `12f5191` `DEV-ONBOARDING.md` — đo 19/09: file này **chưa bao giờ nằm trong một commit nào**, chỉ sống ở working tree từ 15/09 vì khối lệnh hôm đó `git add` nhưng file không vào commit.
> **Phát hiện phải ghi:** (a) **luật 4 không còn đóng ở lớp nào**, kể cả core và bot từng đóng ở `e235ea4` — đã có generator mới mà chưa ai kiểm kê, nên chép lại chữ "vẫn đóng" sẽ là chép một kết luận đã hết hiệu lực; (b) **metric lớp readiness đổi thành phần**: plan `1..130` nhưng `# pass 172`, trong khi ở `0aff7ad` hai số khớp (`1..124`/`# pass 124`) ⇒ bước `128 → 172` **không đọc thành "44 test mới"**; (c) bẫy **14 database `plexco_*` per-test sót** lặp lại đúng lần thứ hai, và suite lại để lại **15** db sau khi chạy ⇒ luật mới: dọn cluster **TRƯỚC VÀ SAU** khi đo.
> **Công cụ mới:** `pnpm progress` (`tools/progress.mjs`) — đọc thẳng ma trận §📊 và in lại thanh từng group theo đúng LUẬT THANH, kèm số cấu trúc tại một ref có tên và điều kiện carry. Không sửa ô ma trận, không chạy suite, không in một con số "TỔNG" có thể bị nhầm với thanh `~33%` (headline được trích nguyên văn).
> **Không đổi:** phase · canonical P-number · dependency order · DD status · thanh **~33%** · **0 màn FE** · FE PENDING (DD-116) · **không một ô ma trận nào**.

</details>

<details>
<summary><b>15/09/2026 — v3.17 · re-pin <code>0aff7ad</code> → <code>e235ea4</code>, dựng lại §📍 và §📜</b></summary>

> 🟦 **PASS 15/09/2026 tại `main@e235ea4` — 87 commit sau `0aff7ad`. Số cấu trúc VÀ trục Tests đo trong CÙNG một lần chạy tại chính SHA này.**
> **Gate đã chạy thật (Mac, worktree tách rời, `NODE_ENV=test`, Postgres docker):** `pnpm -w test` **exit 0** — **1490 workspace** (core 163 · db 800 · web 468 · bot 59, 54 file) **+ 128 readiness/kit**; `pnpm typecheck` 4/4 Done; `git status --porcelain --untracked-files=all` **rỗng** sau khi chạy trọn suite.
> **Đã vào `main` từ `0aff7ad`:** toàn bộ bundle audit v6 (A1–A8 · B1–B5 · C1–C5) ⇒ migration `0037`–`0043` + hardening web/bot/db; `0044` `session_guest_notes` + `CreateGuestNote`/`DeleteGuestNote` (ap3 M3/M3b) ⇒ **8 command · 7 route nghiệp vụ**; ap3 kit wave 3 → W5.2.1; 3 slice code-quality; dep bump bảo mật (next 15.5.24 · sharp 0.35.4 · vitest 4.1.11).
> **Cấu trúc file đổi (không đổi chữ của nội dung cũ):** thêm **§📍 Tiến độ thực tế** ngay dưới header — bản 08/09 dựng mục này **chưa bao giờ được commit** (đo 15/09: `grep -c '📍' ROADMAP.md` = 0) nên pass này dựng lại; mọi khối 🟥/🟪/🟩/🟢/🔵/🟠 cũ **dời nguyên văn** xuống §📜 này.
> **Phát hiện phải ghi (decision còn thiếu, không phải lỗi code):** hai route guest-note đi qua đúng choke-point tạm `apps/web/lib/session-command-route.ts`, trong khi **DD-56 amendment #2 pin "cổng tạm phủ NĂM route"** và điều khoản 1 của amendment #1 đòi decision riêng cho mỗi route copy pattern ⇒ cần amendment ký tên hai route này.
> **Bẫy môi trường đã gặp, ghi làm tiền lệ:** lần chạy đầu ĐỎ ở `tenant.test.ts` (`role "plexco_migrate_cleanup_fail_scratch" does not exist`) vì **14 database `plexco_*` per-test sót trong cluster** từ lần chạy trước. `DROP DATABASE … WITH (FORCE)` rồi chạy lại ⇒ xanh. Dọn cluster trước khi đo, nếu không sẽ khai một drift không tồn tại.
> **Không đổi:** phase · canonical P-number · dependency order · DD status · thanh **~33%** · **0 màn FE** · FE PENDING (DD-116).

</details>

<details>
<summary><b>04/09/2026 → 22/07/2026 — các khối pin, audit và cập nhật trước đó (nguyên văn, mới nhất trước)</b></summary>


> **📌 Repo truth snapshot — MỘT pin cho tất cả: `main@0aff7ad979f1941d23afdb760a06fe0780cff700` (04/09/2026).** Cả số **cấu trúc** (migration · test file · route · spec · static) lẫn **trục Tests** đều đo tại đây. Runner đo tại `772681f` (gate của lane `dd118-runwithlang-coverage`), và `git diff --name-only 772681f..0aff7ad -- packages apps` cùng `… -- scripts` đều **rỗng**, nên runner và cấu trúc nằm cùng một mốc, không phải hai.
> Mọi số đo bằng đúng §Cách đọc tiến độ → "Lệnh tái tạo số đếm". **Trục Tests không `STALE`** — authority nay là **1308 workspace + 124 readiness/kit @ `0aff7ad`** (khối 🟪 04/09), thay `1234 + 85 @ 2648965`. Nếu số không tái tạo được ⇒ coi như **stale**, không dùng để ra verdict.
> ⚠️ **Đây là ảnh chụp, KHÔNG phải số vĩnh viễn** — có lane đang bay sẽ dời nó ngay khi merge; khối 🟪 04/09 ở ngay dưới là bản mới nhất, khối 🟩 03/09 giữ nguyên làm lịch sử.
>
> 🟥 **AUDIT 06/09/2026 tại `main@30a3e90` — đối chiếu code ↔ BRD/PRD/feature docs + rủi ro bảo mật. ĐÂY LÀ KHỐI MỚI NHẤT về *độ đúng của docs*; khối 🟪 04/09 dưới vẫn là authority về *số đo*.**
> Báo cáo: `../sessions/2026-09-06-repo-audit.md` (derived, non-authority) · lane sửa: `../autopilot-templates/audit-fix-lanes-2026-09-06-RUN.md` (A1–A9 + danh sách Tier C). Kết luận: **không P0/P1**; 6 P2 chặn go-live/vận hành (D-1 `app` UPDATE `subscriptions` · D-2 `tenant_provision` vỡ dưới RLS · W-1 Telegram còn nguyên · W-5 readiness không bao giờ `ready` · B-1 dispatcher · X-1 CI `origin/main`), W-2/W-3/X-2/X-4 hardening, 32 P3 (29 row backlog mới nhóm `audit-2026-09-06-*`; D-10 đã có `db-zalo-bots-secret-hardening`, X-4 gộp vào A7, X-6 vào A1), **16 điểm docs lệch code** (đóng trong pass này — xem changelog v3.16), **17 requirement không có code và không có row** (nay mỗi cái một row).
> ⚠️ **Code sửa A1–A7 được author trong phiên cloud 06/09 trên các branch `fix/a*` — CHƯA merge vào `main` tại thời điểm viết khối này.** Không đọc dòng nào dưới đây thành "đã land"; trạng thái thật = `git log origin/main`. Merge là việc của owner (codex round + `pnpm -w test` trên máy có Postgres).
> **Đính chính đếm (đo tại `30a3e90`):** API route **15** (6 Google/session/logout + **2 Telegram-era** + 2 onboarding + 5 session) — A3 gỡ 2 route Telegram ⇒ **13** sau merge; test file **50 `*.test.ts` + 4 `scripts/*.test.mjs`**. Chữ "PWA" trong BRD/PRD/ROADMAP đổi thành "web app" theo đúng lệnh DD-113 (chưa có manifest + service worker) — chỉ giữ ở tên metric gate native ("PWA install rate") và ở changelog/tiêu đề DD (lịch sử).
>
> 🟪 **PIN 04/09/2026 tại `main@0aff7ad` — hai slice SẢN PHẨM đầu tiên đã land. ĐÂY LÀ KHỐI MỚI NHẤT; đọc khối này TRƯỚC mọi khối khác.**
> Khối 🟩 03/09 dưới đây **bị khối này thay về authority**, giữ nguyên văn làm lịch sử. Số `db 716` mà khối đó ghi là **dự đoán để đối chiếu** nay đã **xác nhận đúng** — lane `test-harness-chat-definer-lock-client-leak--v2` đã land.
>
> **Nguồn của MỌI số runner dưới đây — một file, trích dẫn được:**
> `.autopilot/state-archive/dd118-runwithlang-coverage-20260904T103222Z/state/gate-attempt-03-verify-canonical-03.txt`
> — workspace ở dòng **794–795** (core) · **878–879** (db) · **912–913** (web) · **959–960** (bot); readiness ở dòng **765–773** (`1..124` · `# pass 124` · `# fail 0` · `# suites 0`). Đây là artifact của gate lane `dd118-runwithlang-coverage`, `head_sha` = `772681f`.
>
> **ĐIỀU KIỆN CARRY — viết bằng LỆNH, không bằng SHA. Cả hai trả RỖNG:**
> ```bash
> git diff --name-only 772681f..0aff7ad -- packages apps   # → (rỗng, 0 file) ⇒ workspace 1308 carry
> git diff --name-only 772681f..0aff7ad -- scripts         # → (rỗng, 0 file) ⇒ readiness  124 carry
> ```
> Runner đo tại `772681f`; ba commit sau đó (`<merge> dd118` · `b7f511d` · `0aff7ad`) chỉ chạm `docs/`. Đúng điều kiện code-identical mà mốc `813` đã **vỡ** hồi 02/09 — cùng một luật, hai kết cục.
>
> **Hai thang đo, CẤM cộng im lặng:**
>
> | Lớp | Runner | Tập file | Số | Dòng trong artifact |
> |---|---|---|---|---|
> | **Workspace** | `vitest`, 4 tiến trình | **50** file `*.test.ts(x)` dưới `packages/`+`apps/` | **1308** — core **153** (11 file) · db **716** (13) · web **399** (22) · bot **40** (4) | 794–795 · 878–879 · 912–913 · 959–960 |
> | **Readiness/kit** | `node --test` | **4** file `scripts/*.test.mjs` | **124** (`# pass 124` · `# fail 0`) | 765–773 |
>
> 🔴 **LỆNH TÁI TẠO LỚP READINESS ĐÃ STALE VÀ ĐÃ ĐƯỢC SỬA TRONG CHÍNH BẢN v3.15 NÀY.** `test:review-readiness` trong `package.json` nay chạy **BỐN** file, không phải ba: lane `local-dev-sanctioned-paths` thêm `scripts/db-reset-test.test.mjs`. Lệnh cũ (3 file) trả **65** và ai chạy nó sẽ khai một drift **không tồn tại**. Cùng lớp lỗi với lần lệnh spec stale sau reorg `2e577c7` — lệnh tái tạo cũng là một artifact có thể mục, và nó mục im lặng.
>
> ✅ **LUẬT 4 ĐÓNG cho lớp readiness/kit — trên tập file ĐÚNG:**
> `20 + 28 + 17 + 39 = 104` static (`autopilot-ephemeral-review-worktree` · `check-kit-pack-membership` · `check-review-readiness` · `db-reset-test`) `+ 20` generated `= 124` runner. Số `+20` **không đổi** so với khối 03/09; toàn bộ delta `85 → 124` là **39 test static của file thứ tư**. Đó là lý do phải sửa lệnh trước rồi mới đóng luật 4 — với tập file cũ, phép cộng không bao giờ đóng và người đọc sẽ đi tìm một generator không tồn tại.
>
> 🟡 **LUẬT 4 CHƯA ĐÓNG cho lớp workspace ở pass này — khai rõ, không suy số.**
> Static tại `0aff7ad`: **1146** (core **147** · db **686** · web **273** · bot **40**). Runner **1308**. Phần dư cần kiểm kê là **162**, và **`162` KHÔNG được viết như hiệu `1308 − 1146`** — đó đúng là kiểu đóng băng tiền đề mà luật 4 sinh ra để chặn, và khối 03/09 đã nói thẳng điều đó về `137`.
> **Đã thử tự động hoá kiểm kê, HAI lần, và ghi lại vì kết quả là bằng chứng chứ không phải thất bại:**
> - Heuristic cửa sổ dòng (loop chứa `it(` trong 12 dòng, theo đúng khuôn `-A12` của lệnh cũ) → **203**, **thừa 41**: nó đếm cả loop nằm *trong thân* `it()`.
> - Heuristic lồng nhau (loại loop nằm trong `it()` bằng cân bằng ngoặc) → **114**, **thiếu 48**: nó bỏ sót loop lặp trên mảng tính toán và `.each` dùng bảng template-literal.
> Hai phía kẹp lấy `162` nhưng không phía nào chạm. ⇒ **Bảng kiểm kê phải dựng TAY, từng site**, đúng như bảng `137` của khối 03/09 — bảng đó có phán đoán riêng cho từng site, gồm **3 loop cố ý đếm 0** vì nằm trong thân `it()`. Nợ này ghi có tên, không ghi bằng một con số trừ ra.
> ⚠️ **Điều này KHÔNG làm trục Tests `STALE`.** Runner là authority; static chỉ là cross-check và chính lệnh tái tạo ghi *"KHÔNG dùng để khai số"*. `1308` có provenance, có điều kiện carry đã chứng minh rỗng. Cái còn nợ là **phần đối chứng**, không phải con số.
>
> **Số cấu trúc tại `0aff7ad`:**
>
> | Hạng mục | `2648965` (03/09) | `0aff7ad` (04/09) | Ghi chú |
> |---|---|---|---|
> | Migration | 37 | **37** | không đổi — hai slice hôm nay **không** chạm schema |
> | Test file | 46 | **50** | +4: `tenant-lang.test.ts` · `[id]/close/route.test.ts` · `[id]/cancel/route.test.ts` · +1 của lane test-harness |
> | API route | 13 (**3 nghiệp vụ**) | **15** (**5 nghiệp vụ**) | +`POST /api/sessions/[id]/close` · +`/cancel` |
> | Static cross-check (workspace) | 1097 | **1146** | core 147 · db **686** · web **273** · bot 40 |
> | Static cross-check (readiness) | 65 *(3 file)* | **104** *(4 file)* | tập file đổi, xem khối 🔴 trên |
> | Product spec (`features/FE/`) | 27 | **27** | không đổi |
> | BE tech spec (`features/BE/`) | 27 | **27** | không đổi |
> | FE design spec (`channels/web/FE/`) | 17 | **17** | không đổi |
> | **Màn FE nối API thật** | **0** | **0** | **FE PENDING (DD-116)** — trục yếu nhất, không đổi |
>
> **Hai slice sản phẩm đã land — đây là thay đổi đáng kể nhất của pass này:**
> - **`session-routes-close-cancel`** (`<merge>` sau `65de988`) — `POST /api/sessions/:id/close` + `/cancel`. Route nghiệp vụ **3 → 5**. Cổng tạm actor của **DD-56 amendment #2** nay phủ đúng năm route, liệt kê tường minh; điều khoản 5 giữ nguyên hạn dùng: void khi `tenant-capability-authority-core` land.
> - **`dd118-runwithlang-coverage`** (`9116949`) — DD-118 phủ tới `GET /api/onboarding/readiness`. **Ranh giới lộ thông tin, không phải format:** locale phân giải **sau** authorization; phân giải trước sẽ trả lời cú dò của người lạ bằng ngôn ngữ của tenant bị dò, rò cả sự tồn tại tenant lẫn cấu hình. Vòng security xác nhận độc lập tính chất này ở cả hai call site. **Cùng bất biến với `apps/web/lib/session-command-route.ts:232`** (*"a distinct 404 would turn this into a tenant-existence oracle"*) — kênh thứ hai: trước là mã trạng thái, giờ là ngôn ngữ.
>
> ⚠️ **KHÔNG đổi ở pass này:** canonical P-number · dependency order · **thanh ~33%** · FE PENDING (DD-116) · **0 màn FE** · schedule OFF · không DD nào đổi trạng thái. Hai slice trên thêm **bề mặt API**, không thêm surface người dùng chạm được — đó là lý do thanh % không nhúc nhích, và đó là số đúng.
>
> 🟩 **PIN TRỤC TESTS 03/09/2026 — nửa lời hứa còn lại của khối 🔷 02/09 đã đóng. Với MỌI phát biểu về số test, đọc khối này TRƯỚC mọi khối khác.**
> Khối 🔷 02/09 pin được static + cấu trúc nhưng **không chạy được runner**, nên trục Tests mang nhãn `STALE` và authority kẹt ở `854 + 30 @ 93f1e93` (15/08). Pass này **không chạy lại suite** — phép đo đã tồn tại sẵn kèm provenance, sinh ra từ chính gate của lane `gates-that-fire--migrate-p17-cause`. Chạy lại sẽ tạo một phép đo *khác*, không phải xác nhận phép đo này.
>
> **Nguồn của MỌI số dưới đây — một file, trích dẫn được:**
> `.autopilot/state-archive/gates-that-fire-correctly-and-cannot-say-why--migrate-p17-cause-20260903T060118Z/state/gate-attempt-01-verify-canonical-04.txt`
> — `command:` (dòng 3) = `DATABASE_URL_TEST=postgres://plexco:plexco_dev@localhost:5432/plexco_test pnpm test` · `head_sha:` (dòng 5) = `18c75d82…` · `exit_status: 0` (dòng 6).
>
> **⚠️ HAI THANG ĐO. KHÔNG ĐƯỢC CỘNG IM LẶNG.** `pnpm test` chạy nối tiếp hai runner khác nhau trên hai tập file rời nhau:
>
> | Lớp | Runner | Phạm vi file | Số | Trong artifact |
> |---|---|---|---|---|
> | **Workspace** | `vitest`, 4 tiến trình độc lập | 46 file `*.test.ts(x)` dưới `packages/`+`apps/` | **1234** — core **153** (11 file) · db **710** (12) · web **331** (19) · bot **40** (4) | dòng 560–561 · 638–639 · 669–670 · 716–717 |
> | **Readiness/kit** | `node --test` (node:test TAP), 1 tiến trình | đúng 3 file `scripts/*.test.mjs` | **85** (`# pass 85` · `# fail 0` · `# suites 0`) | dòng 536–543 |
>
> Hai lớp **rời nhau về tập file**: static grep của luật 4 quét `packages apps` nên **theo cấu tạo** không nhìn thấy 3 file `scripts/`. Vì vậy chuỗi historical bên dưới là **workspace-only**, và `1234` không bao giờ được cộng với `85` để khai một số "tổng" — đây đúng là cái bẫy mà v3.5 đã sập một lần theo chiều ngược lại (trừ nhầm lớp validator khỏi một số vốn workspace-only).
>
> **Điều kiện mang sang (carry) — cùng một luật, hai kết cục trái ngược, đặt cạnh nhau để thấy luật đang chạy chứ không phải số được khai:**
>
> ```bash
> # ✅ 03/09 — mốc 1234 ĐƯỢC mang từ 18c75d8 sang main: cả hai lệnh trả RỖNG
> git diff --name-only 18c75d8..main -- packages apps   # → (rỗng, 0 file) ⇒ workspace 1234 carry
> git diff --name-only 18c75d8..main -- scripts         # → (rỗng, 0 file) ⇒ readiness  85 carry
> # toàn bộ diff 18c75d8..main chỉ là 1 file docs: docs/autopilot-templates/be-infra-lanes-2026-09-02-RUN.md
>
> # ❌ 02/09 — mốc 813 KHÔNG được mang từ 80a3464 sang 620b2bd: cùng lệnh, trả 34 file
> git diff --name-only 80a3464..620b2bd -- packages apps  # → 34 file ⇒ điều kiện vỡ ⇒ khai STALE
> ```
>
> Lệnh là thứ phải chạy lại, **không phải SHA chép tay** — `main` di chuyển (một commit docs đã land ngay trong pass này). Pin bất biến là `18c75d8`; quyền carry do output rỗng cấp, không do một SHA nào trong câu này.
>
> ✅ **LUẬT 4 ĐÓNG KHÍT, cả hai lớp** — `static + generated = runner`, kiểm kê theo **độ sâu ngoặc** (không phải cửa sổ dòng, theo đúng kết luận v3.5):
>
> | Lớp | Static | Generated | = Runner |
> |---|---|---|---|
> | core | 147 | +6 | **153** |
> | db | 680 | +30 | **710** |
> | web | 230 | +101 | **331** |
> | bot | 40 | +0 | **40** |
> | **Σ workspace** | **1097** | **+137** | **1234** |
> | *readiness/kit (thang riêng)* | *65* | *+20* | ***85*** |
>
> **`137` KHÔNG phải hiệu `1234 − 1097`** — đó là phần dư, và viết một phép trừ vào chỗ authority đúng là kiểu đóng băng tiền đề chưa đo mà luật 4 sinh ra để chặn. `137` là **tổng của bảng kiểm kê hai lớp** ở §Cách đọc tiến độ → luật 4, và nó đóng **độc lập trên từng package** (4 checksum rời nhau, không phải 1).
>
> **Số cấu trúc mang sang cùng mốc, đã kiểm chứ không giả định.** Toàn bộ delta `620b2bd..2648965` đúng **2 file**, cả hai của lane P17 (`packages/db/src/migrate.ts` + `migrate.test.ts`); không file nào dưới `docs/features`/`docs/channels`/`migrations`/`app/api`. Đo lại tại `2648965` cho **y hệt** khối 🔷 02/09: migration **37** · test file **46** · API route **13** · Product spec **27** · BE spec **27** · FE design spec **17** · `.each` **17 hit**. Chỉ **static đổi 1095 → 1097** (db 678 → 680) — đúng bằng 2 test mà lane P17 thêm. Vì vậy file này nay chỉ giữ **một mốc**, không bắt người đọc nhớ hai.
>
> 🔵 **LANE ĐANG BAY SẼ DỜI SỐ NÀY — đọc trước khi trích `1234` đi đâu khác.** `test-harness-chat-definer-lock-client-leak--v2` **chưa merge**, tự đo `db 716` (708 baseline + 2 sibling + 6 của chính nó) so với **710** đang pin ở đây. Theo **luật 1**, lane chưa trên `main` **không được cộng vào bất kỳ trục nào** — `1234` vẫn là số đúng *tại `2648965`*. Nhưng nó là **ảnh chụp có hạn dùng**: khi lane đó land, `db` và tổng workspace đều đổi, và mốc kế phải đo lại **cùng lúc** static + runner + kiểm kê generator (không được cộng tay `+6` vào `1234` — đó lại đúng là kiểu suy số mà luật 4 cấm). Con số `716` ghi ở đây là **dự đoán để đối chiếu, không phải số khai**.
>
> 🔷 **RE-PIN ĐO LƯỜNG 02/09/2026 tại `main@620b2bd` — pass đo mà khối 🟠 30/08 hẹn nợ.** *(⚠️ Đã bị khối 🟩 03/09 ở trên thay thế **toàn bộ**: trục Tests hết `STALE`, và số cấu trúc nay pin ở `2648965`. Giữ nguyên văn làm lịch sử; mục "Việc mở" và câu "mọi verdict phải đọc `854 + 30`" đã hết hiệu lực.)*
> Khối 🟠 30/08 ghi rõ "**bản cập nhật này KHÔNG re-pin số đếm** … để một pass đo riêng pin lại cùng lúc cả runner lẫn static". Pass đó là đây, và nó **chỉ đóng được một nửa lời hứa**: static + cấu trúc đã pin, **runner thì không** — xem ngoại lệ có tên ở dòng snapshot trên. Khai nửa vời một cách tường minh tốt hơn là để cả bảng đứng ở `1fdba1d` thêm một tuần.
>
> **Số đo được, tại `620b2bd`:**
>
> | Hạng mục | `1fdba1d` (13/08) | `620b2bd` (30/08) | Ghi chú |
> |---|---|---|---|
> | Migration | 33 (`0000`–`0032`) | **37** (`0000`–`0036`) | +`0033` fences · +`0034` identity-account-link · +`0035` `tenant_locale_reader` · +`0036` revoke `app` DML `public_sessions` |
> | Test file | 37 | **46** | +9 |
> | API route | 10 (**0 nghiệp vụ**) | **13** (**3 nghiệp vụ**) | `POST /api/sessions` · `/api/sessions/[id]` · `/api/sessions/[id]/publish` |
> | Static cross-check | 772 | **1095** | core 147 · db **678** · web **230** · bot 40 |
> | Product spec (`features/FE/`) | 26 | **27** | +membership |
> | BE tech spec (`features/BE/`) | 25 | **27** | +2 |
> | FE design spec (`channels/web/FE/`) | 17 | **17** | không đổi |
> | **Màn FE nối API thật** | **0** | **0** | FE PENDING (DD-116) — trục yếu nhất, không đổi |
>
> ⚠️ **Static 1095 là TÍN HIỆU DRIFT, không phải số test** — và ở snapshot này nó under-count **nặng hơn trước**: generator lớp 2 (`it.each`/`test.each`) đi từ **2 hit lên 17 hit** (`chat-dm-safety-invariants` ×2 · 4 file route/lib session ×15). Công thức đối chiếu `static + generated = runner` của luật 4 **không đóng được** ở đây vì vế phải chưa đo. Đừng suy runner từ 1095.
> ~~**Việc mở ra từ pass này (bước 1 của phiên P4, treo từ 24/08):** chạy `DATABASE_URL_TEST=… pnpm test` trên máy owner, rồi pin cùng lúc runner + validator + đối chiếu generator hai lớp. Cho tới lúc đó **mọi verdict dựa trên số test phải đọc `854 + 30 @ 93f1e93`**, không đọc bảng này.~~ ✅ **ĐÓNG 03/09** — runner + readiness + đối chiếu generator hai lớp đã pin cùng lúc; đọc khối 🟩 03/09. Chỉ thị "phải đọc `854 + 30`" **hết hiệu lực**, giữ lại nguyên văn để thấy nó được đóng bằng gì.
>
> **BE nghiệp vụ — trạng thái cấu trúc đã đổi hẳn, và đây là delta lớn nhất của tháng.** `packages/db/src/session-service.ts` (2232 dòng) nay export **đủ sáu command**: `createSession` · `publishSession` · `announceSession` · `updateSession` · `closeSession` · `cancelSession`. Ba trong sáu đã có mặt API (`770ff4b`). **Ba chưa có route: `close` · `cancel` · `announce`** — announce còn buộc thêm DD-56 clause 1 (bật schedule biến `{announced:true}` thành lời hứa với người dùng thật), nên **thiếu route announce không phải là bỏ sót, là gate**.
> **Code-dark còn lại, đo chứ không suy:** `resolveCapability()` (`packages/db/src/capability.ts`) vẫn **0 caller production** ⇒ hard-dep (a) của DD-114 (billing P5 vào phase-1) vẫn ở nửa đường — registry hết dark từ `f2af39d`, nhưng **chưa nhánh tiền nào bị gate thật**. Wiring thuộc slice auto-reconcile (DD-114 D2.3), chưa author. `chat_*` vẫn 0 service. DD-118 `runWithLang` mới phủ đường session-command.
> ⚠️ **KHÔNG ĐỔI:** canonical P-number · dependency order · **thanh ~33%** · FE PENDING (DD-116) · epic projector bốn tiền đề. Route nghiệp vụ đã có nhưng **0 màn FE gọi chúng**, schedule OFF, chưa projector ⇒ theo **luật 5** trục yếu nhất vẫn quyết. 🔶 Đề xuất 30/08 (xem lại thanh % tại thời điểm FE thoát PENDING) **vẫn đang chờ owner**; pass này không tự đổi con số.
>
> 🔵 **CẬP NHẬT 30/08 (muộn) — ĐÓNG HALF-REVOKE TRÊN `public_sessions`. Đọc khối này TRƯỚC khối 🟠 30/08.**
> **Migration `0036` (squash `f408693`, đóng backlog `4024127`) REVOKE nốt `INSERT/UPDATE/DELETE` trên `public_sessions` khỏi `app`** — phần còn sót từ `0009` ("cấp cho projector writes", projector đó chưa từng được xây); `0033` (25/08) mới REVOKE `SELECT`. Sau `0036`, `app` **không còn giữ quyền nào** trên bảng gốc `public_sessions`, giống hệt `readonly` (đã mất SELECT từ `0033`). Đây là đóng nợ kỹ thuật theo nguyên tắc surgical-grant của DD-12, **không mở/đổi gì về mặt product**: không tạo writer mới, không chạm epic "public read model" bốn tiền đề (DD-114 D3 vẫn nguyên vẹn) — REVOKE gỡ quyền ghi, không tạo, nên không cần authorization từ DD-114 D3. Ba lần đăng ký trước dưới tên `public-projection-writer-privilege` (tạo writer mới) đã bị rút đúng vì lý do ngược lại. Migration tail: `0035` → `0036`.
> ⚠️ **Không đổi:** canonical P-number, dependency order, thanh ~33%, FE PENDING (DD-116), phạm vi epic projector bốn tiền đề. Thuần security-hardening, đo **inert** tại thời điểm land — không có TypeScript nào từng ghi bảng này qua `app`.
>
> 🟠 **CẬP NHẬT 30/08 — BA QUYẾT ĐỊNH CHỐT + ROUTE NGHIỆP VỤ ĐẦU TIÊN. Đọc khối này TRƯỚC khối 🟢 25/08, vì nó bác bốn phát biểu ở đó và ở khối 🟢 14/08.**
> **Bản cập nhật này KHÔNG re-pin số đếm.** Repo truth snapshot vẫn là `main@1fdba1d` (13/08) và **các số trong file dưới đây đã stale theo đúng luật 4 của chính file** — delta đã đo được nhưng cố ý chưa khai ở đây, để một pass đo riêng pin lại cùng lúc cả runner lẫn static. Đừng dùng bảng số đếm hiện hành để ra verdict.
> **(1) DD-114 D3 ✅ CHỐT phương án (b) (owner 26/08, `3045c7f`) — thay dòng "OQ public (DD-114 D3, vẫn ⬜)" ở khối 🟢 25/08.** Phase-1 **CÓ** toggle public/private + fence immediate-deny; **KHÔNG** chiếu `public_sessions` — **bảng đó không có writer trong phase-1**; toggle + fence-raise **đã land** trong `UpdateSession`, không cần thêm code. Projector = **epic "public read model" phase sau với BỐN tiền đề có tên**: DD-73 share link · DD-41 projection migration · occupancy helper **DUY NHẤT** cho `slots_open` · alias moderated substrate cho `club_display_name`. **Slice chạm giá trị projection phải AWAIT.** Hệ quả delivery: nhánh (8b) và mọi hạng mục marketplace **không còn là "một slice còn nợ"** mà là epic bốn tiền đề — đọc lại §Next Actions với khung đó.
> **(2) DD-112 ✅ CHỐT (owner 27/08, `3fed215`) — thay dòng "DD-112 vẫn ⬜" ở khối 🟢 25/08.** Đổi `slots_max` khi kèo đã có charge **không phải nhánh tiền**, **không** đòi `impact_policy`; guard là ngưỡng roster sẵn có. Edge #4 của session spec đã tách **4a price / 4b capacity** (`b030ecd`). Chốt **có điều kiện tự huỷ**: bảng đầu tiên gắn tiền vào chỗ ngồi, hoặc writer production đầu tiên ghi `charges`/`payment_allocations`, **mở lại** DD-112.
> **(3) DD-118 ✅ (owner 26/08, `cec62c6`) — lần đầu xuất hiện trong file này.** Nguồn ngôn ngữ của mọi surface đã đăng nhập là `tenants.locale` và không nguồn nào khác, đọc qua `SECURITY DEFINER` `tenant_locale()`, fail-closed `'vi'`; response phát trước khi tenant được biết-và-xác-thực giữ tiếng Việt — **hành vi đã phê chuẩn, không phải lỗ hổng phủ**. Độ phủ **chưa đủ và không khai là xong**: `runWithLang` mới chỉ có ở đường session-command.
> **(4) "0 route nghiệp vụ" ở khối 🟢 14/08 HẾT ĐÚNG.** `770ff4b` (26/08) land bộ **API route nghiệp vụ đầu tiên** — session create/publish/update — cùng DD-56 lint guard; kèm `bbd9f1b` UpdateSession, `a3654fc` closeSession, `8e668a1` cancelSession. Bốn session command và một mặt API đã tồn tại.
> **(5) Migration tail `0033` → `0035`:** `0034` person-account convergence (DD-32 tiền đề #1, `9488a21`) · `0035` `tenant_locale_reader` (`6bae04e`).
> ⚠️ **KHÔNG ĐỔI, và lý do phải đọc theo luật 5 — trục yếu nhất là trạng thái thật:** canonical P-number · dependency order · **thanh ~33%** · **FE PENDING (DD-116)**. Route nghiệp vụ đã có nhưng **0 màn FE**, schedule vẫn OFF, chưa projector thật; cái đổi vẫn là *buildable*, chưa phải *runnable* — cùng lập luận đã dùng ở khối 14/08 và 25/08. 🔶 **Đề xuất chờ owner duyệt:** thanh ~33% đáng được xem lại **tại thời điểm FE thoát PENDING**, vì khi đó ba trục yếu nhất cùng nhúc nhích một lúc; bản cập nhật này **không** tự đổi con số.

> 🟢 **CẬP NHẬT 25/08 tại `main@1215a6a` — HAI hard dependency của DD-114 nhúc nhích: fence ĐÃ LAND, registry có reader đầu tiên. Đọc khối này TRƯỚC khối 🟣 22/08.**
> **(b) `public_projection_fences` (8a) ĐÃ LAND — `9da3021`, migration `0033` (tail mới, 34 file):** guarded view `public_session_share_v` (security_barrier) + raise fence (app) / CAS-clear exact-token (app_worker) + **REVOKE base SELECT `public_sessions` khỏi cả `readonly` lẫn `app`** ⇒ immediate-deny structural. Mục **(8a) trong §Next Actions coi như ✅**; **(8b) DD-73** vẫn chặn bởi DD-41 projection migration. Toggle public/private của nhóm 5 **hết blocker hạ tầng** — hai chặn còn lại đều ngoài DB: **FE PENDING (DD-116)** + **OQ public (DD-114 D3, vẫn ⬜)**.
> **(a) DD-29 capability resolver `f2af39d`:** `resolveCapability()` (`packages/db/src/capability.ts`) — reader production **đầu tiên** của entitlement registry; câu "0 TS đọc `entitlements`" trong khối 🟣 dưới đây **hết đúng**. ⚠️ Nhưng resolver **vẫn 0 caller** — wiring thuộc slice auto-reconcile (DD-114 D2.3), nên hard-dep (a) mới đi nửa đường: registry hết dark, vế tiền vẫn chưa gate được thật.
> **DD-117 ✅ (owner 25/08):** `Close`/`Cancel` nhánh paid/retry-root = **fail-closed refuse**, thay deferral 14/08; build Update+Close+Cancel được authorize theo pattern S2 (STOP_AT_READY) — **D5:** cả họ session command dedup CHỈ trên `(tenant_id, command_id)`, content fingerprint bị bác. DD-112 vẫn ⬜. **A3:** starter packet đã commit (`a49bf96`) — việc kế là owner gửi luật sư VN.
> **Số đo:** migration tail **`0033`** (34 file) · suite sau merge (informal): 30 validator + **919** workspace (core 152 · db 581 · web 146 · bot 40) · **authority trục Tests vẫn 854 + 30 @ `93f1e93` (15/08)** — runner chưa re-pin. In-flight: Slice A `session-command-update-v3` (caller đầu tiên của fence) + `identity-account-link-core` (`0034` trên lane).
> ⚠️ **Không đổi: canonical P-number, dependency order, thanh ~33%, FE PENDING (DD-116).** Hai merge là hạ tầng/thư viện — 0 route nghiệp vụ, 0 màn FE; luật 5 giữ nguyên thanh.
>
> 🟣 **CẬP NHẬT 22/08 — DD-113 GTM RE-SEQUENCING (owner-final). Đọc khối này trước các khối bên dưới.**
> **Launch = web app + Zalo bot ra mắt SONG SONG; app native lùi về phase sau.** Web hết vai
> "fallback": phạm vi mỗi surface do thiết kế quyết định, không do giới hạn Zalo quyết định.
> **Launch scope web app v1 = đúng 5 khối** *(DD-113: chữ "PWA" chỉ được dùng khi manifest + service worker land — row `web-pwa-manifest-and-service-worker`)*: signin/signup · link Zalo bot · session management ·
> session detail · settings. Negative scope launch: discovery public · in-app chat · feed/kudos ·
> auto-reconcile · rating công khai · tournament/club · **web push** · **fill-slot** · **native**.
> **DD-114 ✅ (cùng ngày) định nghĩa PHASE-1 = 7 nhóm; launch của DD-113 là SUBSET của nó:**
> 1 signup/signin Google · 2 **create club** (tenant provisioning self-serve) · 3 **link club ⇄ Zalo bot**
> (tenant routing) · 4 link Plexco account ⇄ Zalo account · 5 **sync data Plexco ⇄ bot + owner config
> public/private session** · 6 manage session + session detail + **nhắc nợ / confirm / gạch nợ** ·
> 7 settings + user/privacy.
> ⚠️ **Đọc phạm vi này cho đúng: nó ≈ P0→P5 trừ discovery/chat.** Hai hệ quả đắt, cả hai đã owner-final:
> **(a) billing P5 vào phase-1** vì vế tiền chỉ mở cho `host_pro` theo DD-40/DD-29 ⇒ DD-29 entitlement
> registry phải có **reader thật đầu tiên** (đo tại `a151b15`: vẫn 0 TS đọc `entitlements`, code dark từ
> 07/08); **(b) toggle public/private chỉ mở SAU khi land `public_projection_fences` (8a — nợ sẵn có của
> DD-12, xem §Next Actions)**, vì hiện kèo chuyển private/cancel còn lộ tới khi projector async chạy.
> Thêm: **gate A3 legal (PII) chuyển từ lead-time item thành blocker của phase-1**.
> ⬜ **OQ chưa chốt (DD-114 D3):** public để làm gì khi phase-1 không có discovery — share link `/s/<id>`
> (DD-73, còn bị DD-41 chặn) hay chỉ toggle+fence hay bỏ toggle. Slice chạm nhánh này **AWAIT**.
> ⚠️ **Không đổi canonical P-number, không đổi dependency order, không đổi thanh %.** DD-113/DD-114 là
> quyết định về **thứ tự surface + phạm vi + thứ tự ship**, không phải delivery re-plan; chúng **KHÔNG gỡ
> lệnh FE PENDING 13/08** (xem khối 🔴 FE bên dưới — vẫn còn hiệu lực nguyên vẹn) và **không** authorize
> slice nào. Doc quyết định: `../standards/decisions.md` DD-113 + DD-114 · chiến lược:
> `../strategy/gtm-strategy.md`.
>
> 🟢 **CẬP NHẬT 14/08 tại `main@93f1e93` — BE nghiệp vụ không còn bằng 0.** Hai command đã land:
> `createSession` (`b48625c`) và `publishSession` (`1ccbe5d`), cùng file `packages/db/src/session-service.ts`.
> Kèm theo là **cặp outbox producer có thứ tự đầu tiên** trên cùng aggregate — `session.created` seq 1 →
> `session.published` seq 2 — nên job substrate merge từ 26–27/07 lần đầu có thứ để chở.
> **`authorizeTenantAction` hết code-dark:** sau 8 ngày 0 caller, nay `session-service.ts` gọi thật
> (`publish_new_sessions`, có re-check dưới khoá).
>
> ⚠️ **Nhưng ~33% KHÔNG đổi, và lý do phải đọc kỹ vì đây đúng chỗ dễ tự huyễn hoặc.** Theo luật 5, trục yếu
> nhất là trạng thái thật: **0 route nghiệp vụ · 0 màn FE · schedule vẫn OFF · chưa projector thật**. Hai
> command tồn tại nhưng **chưa surface nào gọi được chúng từ ngoài** — chúng là thư viện, chưa phải tính
> năng. Cái đổi là *buildable*, không phải *runnable*.
>
> 📊 **Số đo lại tại `93f1e93`:** 33 migrations (không đổi) · **38 test file** · **static 813**
> (core 146 · db **490** · web 137 · bot 40) · 10 API route (không đổi).
> ✅ **Canonical runner ĐÃ chạy lại 15/08 (máy owner, `DATABASE_URL_TEST` thật): PASS `854` workspace test**
> (core **152** · db **516** · web **146** · bot **40**) + **30** validator, 38 file, 0 fail. Đây là số
> authority cho trục Tests. Đối chiếu luật 4 đóng khít **theo từng package**, không chỉ ở tổng:
> `146+6=152` · `490+26=516` · `137+9=146` · `40+0=40`, tổng `813 + 41 = 854`. Bảng 6 generator site
> không sót site nào và hai command mới **không đẻ generator mới**.
> ⚠️ **Bẫy số học đã gỡ, giữ lại làm tiền lệ:** static tại `93f1e93` = 813 **trùng số** với runner 813 đo
> tại `80a3464` — hai đại lượng khác nhau, sự trùng nhau là ngẫu nhiên. Runner thật hiện tại là **854**.
> Bài học: khi static bằng đúng một runner cũ, đó là lúc **dễ suy bậy nhất**, không phải lúc yên tâm.
>
> **Static/source inventory đo tại `1fdba1d` (13/08):** **33 migrations (`0000`–`0032`), 37 test files, 772 static test declarations** (core 146 · db **449** · web 137 · bot 40)**, 10 API routes** (8 auth + 2 onboarding, **không đổi từ 22/07**)**, 26 Product (`docs/features/FE/`) + 25 BE (`docs/features/BE/feature_*_tech.md`) feature spec**, cộng **17 FE spec** ở `docs/channels/web/FE/` (Draft). Trục **Tests hết `STALE`**: canonical runner PASS **813** đo 12/08 tại `80a3464` (máy owner) — xem cảnh báo đối chiếu ở luật 4.
>
> ⚠️ **`0031` đưa Chat từ "0 migration" sang có DB root thật — nhưng KHÔNG mở hành vi nào.** `chat_channels`/`chat_members`/`chat_messages` (`0031`) và `chat_dm_safety_config`/`chat_blocks`/`chat_reports` (`0030`) đã ở trên `main`, còn **0 câu truy vấn production nào chạm chúng**: `packages/db/schema.ts` có khai báo Drizzle cho cả 6 bảng (đó là **khai báo, không phải phép đo** — xem luật 1), và 4 file test tham chiếu (`chat-dm-safety-invariants` · `chat-schema-invariants` · `rls-invariants` · `migrate`). Đây là **code dark thứ tư**, cùng lớp với `authorizeTenantAction` · DD-29 entitlements · outbox schedule OFF. Chat vẫn **0 service · 0 API · 0 UI**.
>
> 🔴 **FE PENDING theo lệnh owner 13/08 — mạnh hơn HOLD.** DD-81 / M0.3 / M4 và **mọi việc FE** bị treo lại: không track `.pen`, không mở page/component, lane FE không chạy. Trước đây FE là **HOLD chờ gate** (owner nghiệm thu canonical `.pen`); nay là **PENDING theo lệnh** — gate không còn là thứ chặn, quyết định owner mới là. `design.pen` + `fe.pen` vẫn untracked **có chủ ý**. **Nguồn bền nay là `../standards/decisions.md` DD-116 ✅ Option B — KEEP (owner 24/08)**; RUN doc 13/08 hạ xuống nguồn lịch sử. PENDING gỡ **chỉ** khi named trigger đủ CẢ BA: (a) owner chọn canonical `.pen` (đúng một) · (b) tracked trên `main` · (c) owner ký nghiệm thu design authority (gate DD-81) — khi gỡ ⇒ FE bounded 5 khối launch, mỗi lane vẫn qua gate.
>
> **Working tree tại thời điểm đo (chưa commit, KHÔNG tính vào bất kỳ trục nào):** `design.pen` · `fe.pen` (untracked, chủ ý) · `docs/autopilot-backlog.md` (modified) · packet + manifest `chat-shared-message-command-core` (untracked). Theo luật 3, FE spec + `.pen` **không** kéo trục FE/UI lên; cột FE/UI vẫn **0 màn**.

> **v3.4 channel pivot (DD-37):** bỏ Telegram; kênh phase-1 = **web + Zalo + Facebook Messenger**. Messenger nâng từ post-MVP (P4.8) lên **phase-1 (P2.5, phụ thuộc App Review)**. Thêm **Google login** (P0–P1), **chat in-app** + **cài đặt hồ sơ/giá theo giới tính** (P4, DD-38/DD-39 ✅ scope-committed phase-1; schema chờ migration), **mark-paid thủ công tiền mặt/CK** (P2).

> **Decision reconcile 15/07/2026:** DD-32 và DD-45 đã chốt; DD-47/48 chốt framework. Đây là delivery contract cho các slice tương lai, **không phải bằng chứng code/migration đã land**.
>
> **Cập nhật 17/07/2026 (decisions v1.45):** DD-65..68 chốt Messenger hybrid; DD-67 generalized provider-endpoint identity/reachability cho Messenger + Zalo. Feature-doc closure đã pin SePay HMAC, DM safety/block source, Assistant DLP và Session Organize v0.4 correction/SSE; runtime/migration chưa build. DD-57..64 vẫn proposal ngoài timeline. B0/B1/B2/B3/external/legal gates không đổi.
>
> **Cập nhật 18/07/2026 (founder batch, decisions v1.47):** DD-69 **định hướng app-first accepted** — phase-1 target = web app installable (S9/S20 chưa live; chưa được gọi "PWA" theo DD-113); phase-2 native ngoài committed timeline (build TBD). RN+Expo chỉ là recommendation sau spike; trước khi schedule native phải qua client-contract, API/auth/push/offline/store gates (DD-69 analysis). **DD-61..64 Session Organize accept-in-principle** (build post-P4). DD-33 Facebook Login phase-1 ✅; DD-60 API-reference convention ✅.

> **Cập nhật 22/07/2026 (v3.4 — reconcile số liệu + khung đo lường):** file này trước đây khai `migrations 0000–0013` và "Google/email chưa code". **Sai so với repo.** Truth tại `main@142e9fa`: migrations **`0000–0018`**; toàn bộ lane Google (D0a · D0b · D1 email-token · D1 google-adapter · d1b) **đã merge**, đang **chặn ENABLE** (chờ đo Safari macOS/iOS cho completion-hop M3; `GOOGLE_OAUTH_*` giữ rỗng). Đây là **reconcile bằng chứng**, không phải quyết định mới: **không phase nào được thêm/bớt, không DD nào đổi trạng thái, delivery order không đổi.**
>
> **Cập nhật 22/07/2026 (v3.4a — runner evidence reconcile):** canonical `DATABASE_URL_TEST=postgres://plexco:plexco_dev@localhost:5432/plexco_test pnpm test` **PASS** tại snapshot này: **29 test files / 419 tests** (core 111 · db 159 · web 146 · bot 3). Static grep hiện cho **410** và chỉ là cross-check nguồn; không được dùng làm số test hay điều kiện `✅ Tests`.
> **Cập nhật 24/07/2026 (migration-tail reconcile):** migration tail bump `0018`→**`0020`** — `0019`/`0020` (`b0c29a6`/`f6ccd79`, 23/07/2026) thêm tenant-integrity composite FKs (DD-68), tầng riêng ngoài nền `0000–0014` và auth lane `0015`–`0018`. Chỉ reconcile migration tail; các số đếm khác ở §Dev Progress (test/route/spec) giữ nguyên snapshot 22/07 ở trên, CHƯA re-verify. Không đổi phase, DD, hay delivery order.
>
> **Cập nhật 25/07/2026 (v3.4d — current-state reconcile tại `2937ed9`):** (1) migration tail `0020`→**`0021`** — `0021` (`15e10b7`, 24/07) đóng nốt bộ ba tenant-integrity composite FK DD-68 ở nhánh **non-money**; (2) **core đã đổi**: `d2a27e1` (23/07) chốt `splitNameAmount` fail-closed ambiguity union (DD-87) — đây là **runtime change**, không phải doc; (3) **8 docs/spec slice** publish · billing · draft-lifecycle đã merge ⇒ hợp đồng S5 Session dày lên nhưng **0 dòng runtime**; (4) số đếm không cần DB đã re-verify; **canonical runner chưa chạy lại** nên trục `Tests` giữ số 22/07 kèm nhãn STALE; (5) 7 slice backlog stale status đã flip sang `merged` sau khi verify `merged_probe` trên `origin/main`. **Không phase nào thêm/bớt, không DD nào đổi trạng thái, delivery order không đổi, thanh ~33% không đổi.**
>
> **Cập nhật 25/07/2026 (v3.4e — evidence + authority reconcile):** canonical runner đã re-aggregate tại `2937ed9`: **460 workspace tests PASS** + 13 readiness-validator tests. DD-70/71/72 owner-final được propagate vào Notification pair/index/status; contract trở lại Reviewed nhưng runtime/migration vẫn zero. Next coding initiative là BE-only `db-job-claim-lease-core`; DD-81 canonical path = root `design.pen`, còn FE giữ HOLD tới khi file được persist/track + owner nghiệm thu làm authority. Không phase/delivery order/% runtime nào đổi.

> **Cập nhật 26/07/2026 (v3.4f — job-infra `0022` merged):** slice 1/4 `db-job-claim-lease-core` squash-merged tại **`34429fc`** (Verdict 19, authority `948636f`). Migration tail `0021`→**`0022`**; outbox/projector có lease 5 phút reclaim được + `job_audit_events` append-only + `job_definer` sở hữu đúng 5 function allowlist, `app_worker` chỉ EXECUTE. Canonical runner re-aggregate tại `34429fc`: **482 workspace tests** (db 179→**201**, +22 từ JCL-1..JCL-14) + 13 validator tests. **Code dark** — không queue/preflight/cron/producer/projector nào bật, nên **% runtime và delivery order không đổi**. Kế tiếp: slice 2 `job-runtime-dispatcher`, cần manifest + verdict riêng, không kế thừa authorization của slice 1.

> **Cập nhật 27/07/2026 (v3.4g — job-infra `0023` ack marker merged):** slice 2a `db-outbox-ack-marker` squash-merged
> tại **`76e1f7b`** (Verdict 23, authority `28d0c3a`). Migration tail `0022`→**`0023`** (24 file). Slice này đóng
> starvation loop mà `0022:166-181` **tự ghi chống lại chính nó** dưới nhãn `HARD BLOCKING REQUIREMENT`: lease 5 phút
> chỉ là crash-recovery, event xử lý xong không có đường ack nên vẫn hết lease, không phân biệt được với claim crash,
> bị reclaim mãi mãi — và vì reclaim chạy trước claim mới với `ORDER BY created_at`, tập event đã xong bỏ đói mọi event
> mới. Không sai kết quả (`prepare` idempotent), nhưng là bug throughput tăng dần. **Hai quyết định owner lấy tại design
> probe, trước khi có code:** (1) fan-out completeness là **cấu trúc chứ không phải comment** — `ack_outbox_event` nhận
> `p_required_projectors text[]` và raise nếu thiếu bất kỳ delivery row nào, vì chính hình dạng "ghi yêu cầu vào comment"
> đã hỏng một lần trong tuần này khi comment của `0022` bị bỏ sót lúc author manifest 2b; (2) chặn stale-ack bằng
> **danh tính** (`claim_token`) chứ không bằng thời gian, và đổi chữ ký `claim_outbox_batch` **ngay bây giờ** khi nó còn
> zero call site TypeScript. Canonical runner tại `76e1f7b`: **493 workspace tests** (db 201→**212**, +11 từ
> OAM-1..OAM-13) + 13 validator tests. **Vẫn code dark** — không producer/queue/cron/projector nào bật, nên **% runtime
> và delivery order không đổi**. Kế tiếp: slice 2b `job-runtime-dispatcher` (TypeScript-only, đã gỡ blocker; manifest
> amend + Verdict 22 re-pin cùng ngày).

> **Cập nhật 27/07/2026 (v3.4h — evidence snapshot, superseded về Chat bởi v3.4k):** `main@2dc9b8c` có đủ **25 migrations (`0000`–`0024`)**. Sau `0022`/`0023`, TypeScript dispatcher, queue registry/provision/preflight và worker lifecycle đã merge (`fca314e`); recovery scheduler 1 phút đã merge (`a03d2d6`) nhưng `OUTBOX_DISPATCH_SCHEDULE_ENABLED` mặc định **OFF** và chưa có domain producer/real projector, nên Sync/Session vẫn không runnable. `0024` chỉ cấm public session thiếu `slots_max`. Evidence hiện hành = **32 files / 537 workspace PASS + 13 validator**, static **528 + 9 generated**. Safari macOS/iOS M3 measurement đã đóng, nhưng Google login vẫn chưa enable. DD-91 chốt in-app Chat là **primary daily player surface mục tiêu** + requester-only `/pay`; migration/code/runtime Chat chưa tồn tại. Auto-reconcile giữ manual global và chỉ mở khi `payment_reconcile_auto` + exact market/provider/bank/currency/consent pass; SePay/ApiPay là Vietnam launch path chưa enable.
>
> **Cập nhật 28/07/2026 (v3.4l — Chat authority immutable/re-pin):** exact 27-file authority pack đã land tại `90d292d`; primary plan v1.8 và DD-86 analysis đã re-pin, closure 12/12, verdict `PLAN_READY`. Đây chỉ là quyền tách/author slice: B4 artifacts/worktree chưa có và mỗi mechanism/API/FE slice vẫn phải đạt strict `CODE_READY`. Owner-final DD-86/DD-91–95, DD-88 broader `DEFERRED_PROPOSAL`, mechanisms `1–47`, API `A1–A21`, FE `F0–F15`, G6 enablement gates và serialized DB lane `1→2→3→4` không đổi. Migration/code/runtime Chat vẫn chưa tồn tại; DD-32 Option D và delivery order không đổi.

> **Cập nhật 06/08/2026 (v3.4m — tuần 30/07→06/08, reconcile tại `2cd52ce`):** **88 commit** sau `3d75c90` (`git rev-list --count 3d75c90..2cd52ce` — `--first-parent` và `--no-merges` cũng đều 88; con số `58` ở bản nháp trước sai, không tái tạo được). **Migration tail `0025`→`0029`** (26→**30 file**), bốn file, ba lớp khác nhau và **không lớp nào mở hành vi nghiệp vụ**:
> `0026` (`89e074b`) đổi tên 6 CHECK sống-mà-không-khai sang tên `schema.ts` vừa khai — RENAME-only, zero predicate, đóng nốt phần `0025` cố ý loại ra;
> `0027` (`432ba11`) thêm `resolve_tenant_status_locked` SECURITY DEFINER read-only theo đúng khuôn `0012`, vì `FOR SHARE` đòi quyền UPDATE mà cấp UPDATE thẳng trên `tenants` sẽ mở lại đúng write-path mà AP-40 vừa đóng;
> `0028`/`0029` (`f901626`) là cặp **expand→contract DD-29 capability registry**: `plans.plan_key` 4-tier → **2-tier `free|host_pro`**, `plans.entitlements` sang shape lồng `{"capabilities": {...}}`, reseed, repoint write-path của `tenant_provision()` + mọi subscription `free_web`; row còn ở tier cũ ⇒ abort cả transaction thay vì repoint im lặng.
> **Đây là migration đầu tiên trong tháng chạm một hàm đang có caller runtime** (`tenant_provision()` gọi tại `packages/db/src/auth.ts:212`, đường onboarding) — nhưng **chưa TS nào đọc `entitlements`/`capabilities`**, nên vẫn chưa có behavior gating.
> **Code merge ngoài migration:** `authorizeTenantAction` — resolver trạng thái tenant fail-closed 2 bước (`ddb69a9`, `packages/db/src/authorization.ts`), **zero production caller**, mới chỉ re-export ở `packages/db/src/index.ts`; role `chat_definer` được provision bằng bootstrap script chứ không bằng migration (`286f48b`, `infra/postgres-init/02-chat-definer.sql`); bootstrap definer được serialize cluster-wide bằng khoá 2 tầng, **fail-open có chủ đích** dưới managed Postgres (`b55d628`). **Deps/security:** `next` 15.5.21 (`61a2575`), ESLint 9→**10.7.0** trước EOL (`a93a4f6`), và sàn `esbuild` khai-mà-không-áp-dụng nay áp thật, đóng GHSA-67mh-4wv8-2f99 (`62304b5`).
> **Chat lane:** `chat-definer-role-provisioning` đã merged; `chat-dm-safety-authority-core` **authored `CODE_READY` 05/08** (`521a904`, amend `ed54e31` đưa rate limit ra config) nhưng **chưa register/worktree/implement**; `dd38-dd86-chat-schema-core` authored `NOT_CODE_READY` (closure 10/12, chờ slice 1–2). Chat vẫn **0 migration · 0 API · 0 UI**.
> **Không đổi:** phase, DD status, delivery order, và thanh **~33%** — không slice nào mở producer/projector/service/route/FE nghiệp vụ. Trục Tests mang nhãn `STALE` cho tới lần chạy canonical runner kế tiếp. Autopilot kit v11→**v31**; verdict ledger tới **Verdict 31**.

> **Cập nhật 07/08/2026 (v3.4o — live-truth re-pin tại `64e9ccb`, trục Tests hết `STALE`):** `528540e`/`5b2b8f5` land FE-foundation core — `packages/core/src/api-contract.ts` (envelope + 11-code `API_ERROR_CODES`, `err()` narrowed) và `app-error.ts` (sealed `toAppError` fail-closed + 14 tests) + root scripts `test:core|db|web|bot`/`check:quick`/`smoke:predeploy`; `64e9ccb` chốt decision batch DD-96..99 (decisions **v2.19**). **Trục Tests:** canonical runner PASS **683** đo 2026-08-07 tại `528540e` trên máy owner (13 validator + core 138 · db 346 · web 146 · bot 40, 34 file); sau `5b2b8f5` per-package core **152** · web **146**, **full-suite chưa chạy lại** ⇒ số khai vẫn 683. **Đính chính dòng Chat lane của v3.4m ngay trên:** `chat-dm-safety-authority-core` **đã implement** — lane v2 `feat/chat-dm-safety-authority-core--v2` @ `31bd4d9` verification sạch, **đỗ chờ codex quota** cho final review round; không còn đúng là "chưa register/worktree/implement". ⛔ **CI infra-blocked từ 06/08** (nghi hết phút Actions; mitigation `4cc574c` chưa có run xanh xác nhận) — gate dựa CI đứng yên, CI đỏ ≠ lỗi code. `design.pen` + `fe.pen` cùng untracked: DD-81 canonical chưa chọn, FE giữ HOLD. Milestones hiện hành: `../sessions/2026-08-07-next-milestones.md`.

> **Cập nhật 13/08/2026 (v3.5 — live-truth re-pin `64e9ccb` → `1fdba1d`, +60 commit):** **Migration tail `0029`→`0032`** (30→**33 file**), ba file, và lần đầu sau một tháng có file **mở một khái niệm sản phẩm mới** thay vì chỉ integrity/rename:
> `0030` (`d5b31f9`, 10/08) DM-safety authority DD-55 — `chat_dm_safety_config`/`chat_blocks`/`chat_reports` + `assert_dm_allowed`, toàn bộ nằm ở **global-protected plane**: `app`/`app_worker`/`readonly` có **zero grant thuộc bất kỳ loại nào**, chứng minh bằng catalog chứ **không** chỉ bằng live-attempt (`has_table_privilege` × 3 role × 3 bảng × 7 privilege);
> `0031` (`3b3bb09`, 11/08) **chat schema core DD-38/DD-86** — `chat_channels`/`chat_members`/`chat_messages`, root thật của Chat epic;
> `0032` (`80a3464`, 12/08) DD-102 — gộp 4 lần đọc config của `assert_dm_allowed` thành 1 (`SELECT * INTO` + helper `dm_safety_flags_enabled`), đóng torn read; hành vi từng nhánh giữ nguyên, pin bằng acceptance row chứ không bằng so thân hàm.
> **Nhưng đọc cho đúng: `0031` KHÔNG làm Chat runnable.** 0 TS production nào đọc `chat_*`; slice 7 (`chat-shared-message-command-core`) mới authored, slice 8 chưa; nợ P1 `chat-identity-merge-reparent-enablement` (DD-103) vẫn `NOT_CODE_READY` và đứng trước Person-merge. Chat = **0 service · 0 API · 0 UI**.
> **Code merge ngoài migration:** không có trong `packages/`|`apps/`. 24 commit sau `80a3464` chỉ chạm docs, decisions, backlog, `.claude/commands/`, kit (`scripts/autopilot-*`) và **root `package.json`**. Đây là lý do trục Tests được phép giữ số đo tại `80a3464` — nhưng lưu ý đúng một hệ quả: chính `package.json` (`b53bc75`) là thứ đưa lớp validator từ **13 → 17**, nên "không chạm code" **không** có nghĩa "số full-run không đổi".
> **Việc đang bay (CHƯA trên `main`, không tính vào bất kỳ trục nào):** `session-service-create-command-core` — **slice nghiệp vụ đầu tiên của cả project**. Lane v1 `HALT MAX_ROUNDS` ở fix-round 5 (advisory lock khoá theo command type trong khi ledger unique theo `(tenant_id, command_id)` ⇒ raw `23505` thay vì `COMMAND_ID_CONFLICT`); owner chọn option A, successor `--v2` đăng ký lại từ `main` sạch và đã có code trên branch `feat/session-service-create-command-core--v2` (`packages/db/src/session-service.ts` + test + barrel, 3 file). **Chưa merge ⇒ BE nghiệp vụ vẫn 0.**
> ⚠️ **Không pin SHA/LOC của lane đang chạy ở đây — số sẽ sai trong vài giờ.** Trong lúc soạn chính bản v3.5 này, tip branch đã đổi hai lần (`ade0a79` → … → `648f74b`, 577 → 642 dòng) do agent amend từng vòng; hai lần đầu tôi chép SHA vào doc thì cả hai đều thành orphan ngay. **Đọc `git log --oneline feat/session-service-create-command-core--v2` mới là trạng thái thật.** Doc chỉ pin thứ không đổi: tên branch, phạm vi 3 file, và sự kiện "chưa merge".
> **CI: ⛔ infra-block 06/08 ĐÃ HẾT.** Security/OSV full-scan **GREEN trên `main`** (run tại `9a5c709`, 11/08 — lần xanh đầu sau đợt đỏ); ba merge `0030`–`0032` đi qua ap-finish gate sạch. Chưa re-verify từng workflow còn lại ⇒ **chưa được khai "full matrix xanh"**.
> **Docs:** reorg `docs/features/` → `docs/features/FE|BE` (`2e577c7`) + A-grade Entry Points 49 spec (`8af9601`) + spec pass 12/08 (9 spec, thêm `feature_share_activities.md`). **Lệnh tái tạo spec ở §Cách đọc tiến độ đã stale vì reorg này và đã được sửa trong cùng bản v3.5.**
> **Decisions v2.19→v2.28:** DD-100 Level 3.1 adoption · DD-101 budget amendment · DD-102 nghĩa vụ **đã đóng** (`0032`) · DD-103 chấp nhận gap merge-reparent có ràng buộc cứng · DD-104 D0–D4 DeleteSession decision-level (slice **deferred**) · **DD-105 suspension gate cho `CreateSession`** (miễn theo *tính vô hình của draft*, không phải "mutation nhỏ").
> **Không đổi:** phase, delivery order, **10 API route · 0 route nghiệp vụ · 0 màn FE**, và thanh **~33%**. Autopilot kit **v31**; `docs/slice-readiness-verdicts.md` vẫn dừng ở **Verdict 31** — slice từ AP-45 trở đi mang verdict block **trong packet của chính nó** ở `docs/autopilot/contracts/`, nên đừng đọc "Verdict 31" thành "không có slice nào review từ 06/08".

> **Đánh số phase:** toàn bộ tài liệu dùng duy nhất **canonical P-number**. Các tên Foundation/Tenant Engine/... chỉ là delivery-group label, không tạo một hệ số thứ hai.


</details>

---

## Changelog

| Date | Version | Thay đổi |
|---|---|---|
| 19/09/2026 | **v3.18** | **Re-pin `e235ea4` → `12f5191` (38 commit, 14 PR) — gate chạy thật, và lần đầu LUẬT THANH chạy được bằng máy.** (1) **§📍 re-pin toàn bộ:** runner **1823 workspace + 172 readiness/kit**, static **1376**, migration **47** (tail `0046`), test file **59+4**; mã nguồn tại pin ≡ `origin/main@00cc510`, chứng minh bằng `git diff` rỗng chứ không bằng lời. (2) **Luật 4 khai CHƯA ĐÓNG ở cả năm lớp** — kể cả core/bot từng đóng ở `e235ea4`; không lớp nào có bảng kiểm kê tại mốc này, và phần dư không được viết như hiệu. (3) 🔴 **Metric lớp readiness đổi thành phần**: plan `1..130` nhưng `# pass 172` (ở `0aff7ad` hai số khớp) ⇒ bước `128 → 172` không đọc thành "44 test mới". (4) **Không một ô ma trận nào đổi** — 38 commit đều là hardening/kit; ghi thẳng lý do thay vì để người đọc đoán, và để ngỏ cho owner quyết có cấp hàng riêng cho đợt `codebase-fixes-2026-09-16` như đã cấp cho `0037`–`0042` không. (5) **Thêm `pnpm progress`** (`tools/progress.mjs`): đọc ma trận §📊 và in lại thanh theo đúng luật, kèm điều kiện carry — không sửa ô, không chạy suite. (6) Bẫy **14 database `plexco_*` sót** lặp lại lần hai ⇒ luật mới: dọn cluster **trước VÀ sau** khi đo. |
| 15/09/2026 | **v3.17** | **Re-pin `0aff7ad` → `e235ea4` (87 commit) + dựng lại §📍 và §📜 — số đo TỪ MỘT LẦN CHẠY THẬT, không carry.** (1) **§📍 Tiến độ thực tế** dựng ngay dưới header (bản 08/09 dựng mục này **chưa bao giờ được commit** — đo 15/09 `grep -c '📍'` = 0): pin + điều kiện carry viết bằng lệnh + LUẬT THANH + bảng thanh theo delivery group + bảng số rút gọn + blocker/đang bay/kế tiếp. (2) **§📜 Nhật ký cập nhật** ở cuối file: mọi khối 🟥/🟪/🟩/🟢/🔵/🟠 cũ **dời nguyên văn**, gập `<details>`, mới nhất trước — không đổi một chữ nào của chúng. (3) **Số đo mới @ `e235ea4`:** migration **37 → 45** (tail `0036` → **`0044`**) · test file **50 → 54** · runner **1308 → 1490 workspace** (core 163 · db 800 · web 468 · bot 59) **+ 124 → 128 readiness/kit** · static **1146 → 1308** · API route **15 → 15 nhưng thành phần đổi** (−2 Telegram, +2 guest-note ⇒ **7 route nghiệp vụ**) · session command **6 → 8**. Gate chạy thật trên Mac: `pnpm -w test` exit 0 + `pnpm typecheck` 4/4 + tree sạch. (4) **Ma trận:** thêm nhóm **Audit hardening `0037`–`0042`** (✅, 0 hành vi product mới); Session command family **Migration `—` → ✅ `0044`** ⇒ thanh **63 → 70**; Session API surface 5 → **7 route**; 3b Auth **8 → 6 route**; Identity link gộp `0034` + `0043`. Module Progress: 3b · 3c · 7 · 8 · 18 cập nhật theo đo. (5) **Phát hiện ghi lại, không tự quyết:** hai route guest-note đi qua choke-point tạm trong khi **DD-56 amendment #2 pin NĂM route** ⇒ decision còn thiếu. (6) **Không đổi:** phase · canonical P-number · dependency order · DD status · thanh ~33% · 0 màn FE · FE PENDING. |
| 06/09/2026 | **v3.16** | **Audit code ↔ docs 06/09 (`../sessions/2026-09-06-repo-audit.md`) — đóng 16 điểm docs lệch code, KHÔNG re-pin trục Tests.** Khối 🟥 06/09 mới trên đầu file. (1) §Dev Progress: API route 13→**15** (`close`/`cancel` `6d62cf8`), test file 46→**50** `*.test.ts` + 4 `.mjs`, hàng Session API surface 3/6→**5/6** command có route, hàng Identity account link **bỏ cite file `identity-account-link.ts` không tồn tại** (chỉ có SQL fn `0034:83`), hàng Tenant locale ghi readiness đã `runWithLang`, hàng Shared job runtime "no producer"→**producer có, projector chưa**, Module 10 BE ⬜→🟡 (`onboarding/start` self-serve đã có), Module 18 "0 caller"→**5 caller**. (2) **Chữ "PWA"→"web app"** ở 12 dòng normative (§Positioning/§Context/§Delivery Groups/§GTM/footer) theo lệnh DD-113; giữ nguyên ở tên metric gate native, changelog và tiêu đề DD (Phụ lục A). (3) §Next Actions #6 thêm hàng đợi **A1→A9** của audit. (4) Đối chiếu: `eslint.config.mjs` **có trên main** (audit #13 đóng, không mở row). ⚠️ **KHÔNG đổi:** canonical P-number · dependency order · thanh ~33% · FE PENDING (DD-116) · trục Tests `1308 + 124 @ 0aff7ad` (code A1–A7 chưa merge nên số này vẫn đúng cho `main`). |
| 04/09/2026 | **v3.15** | **Re-pin tại `main@0aff7ad` — hai slice SẢN PHẨM đầu tiên đã land, và một lệnh tái tạo bị bắt là đã mục.** (1) **Snapshot chuyển `2648965` → `0aff7ad`**; khối 🟪 04/09 mới trên đầu file, khối 🟩 03/09 bị thay về authority nhưng **giữ nguyên văn** làm lịch sử. (2) **Trục Tests: `1234 + 85` → `1308 + 124`.** Provenance là artifact gate của lane `dd118-runwithlang-coverage` (`head_sha 772681f`), mỗi số kèm số dòng. **Điều kiện carry viết bằng LỆNH:** `git diff --name-only 772681f..0aff7ad -- packages apps` và `… -- scripts` đều **rỗng** — ba commit sau phép đo chỉ chạm `docs/`. (2b) ✅ **`db 716` mà v3.14 ghi là *dự đoán để đối chiếu* nay XÁC NHẬN ĐÚNG** — lane `test-harness-chat-definer-lock-client-leak--v2` đã land; đây là lần một số có hạn dùng được đóng đúng cách thay vì cộng tay. (3) 🔴 **LỆNH TÁI TẠO LỚP READINESS ĐÃ MỤC, phát hiện và sửa trong chính pass này.** `test:review-readiness` nay chạy **BỐN** file — `local-dev-sanctioned-paths` thêm `scripts/db-reset-test.test.mjs` — nên lệnh ba-file cũ trả **65** và ai chạy nó sẽ khai một drift **không tồn tại**. Cùng lớp lỗi với lệnh spec stale sau reorg `2e577c7`: **lệnh tái tạo cũng là artifact có thể mục, và nó mục im lặng.** Lệnh nay kèm một dòng đọc thẳng `package.json` để không phải tin danh sách chép tay. (4) ✅ **LUẬT 4 ĐÓNG cho lớp readiness trên tập file ĐÚNG:** `20+28+17+39 = 104` static `+ 20` generated `= 124`; `+20` **không đổi** so với 03/09, toàn bộ delta `85 → 124` là 39 test static của file thứ tư. (5) 🟡 **LUẬT 4 CHƯA ĐÓNG cho lớp workspace — khai rõ, không suy số.** Static `1146` (core 147 · db 686 · web 273 · bot 40), runner `1308`, phần dư cần kiểm kê `162`. **Không viết `162` như hiệu `1308−1146`** — đúng điều v3.14 đã nói về `137`. Đã thử tự động hoá **hai** lần và ghi lại vì kết quả là bằng chứng: heuristic cửa sổ dòng → **203** (thừa 41, đếm cả loop nằm trong thân `it()`); heuristic lồng nhau → **114** (thiếu 48, sót loop trên mảng tính toán và `.each` bảng template-literal). Hai phía kẹp `162` mà không phía nào chạm ⇒ **bảng phải dựng TAY từng site**, như bảng `137` vốn có 3 loop cố ý đếm 0. Nợ ghi có tên. ⚠️ Điều này **không** làm trục Tests `STALE`: runner là authority, static chỉ là cross-check và chính lệnh tái tạo ghi *"KHÔNG dùng để khai số"*. (6) **Cấu trúc:** migration **37** không đổi (hai slice hôm nay không chạm schema) · test file 46 → **50** · **API route 13 → 15, route nghiệp vụ 3 → 5** · static workspace 1097 → **1146** · static readiness 65 *(3 file)* → **104** *(4 file)* · spec 27/27/17 không đổi. (7) **Hai slice:** `session-routes-close-cancel` mở `POST /api/sessions/:id/close` + `/cancel` dưới **DD-56 amendment #2** (cổng tạm nay phủ đúng năm route liệt kê tường minh; điều khoản 5 giữ hạn dùng); `dd118-runwithlang-coverage` phủ DD-118 tới `GET /api/onboarding/readiness` với **ranh giới lộ thông tin** — locale phân giải *sau* authorization, vì phân giải trước sẽ trả lời cú dò của người lạ bằng ngôn ngữ tenant bị dò, rò cả sự tồn tại lẫn cấu hình; vòng security xác nhận độc lập ở cả hai call site. **Cùng bất biến với `session-command-route.ts:232`** (*"a distinct 404 would turn this into a tenant-existence oracle"*) — kênh thứ hai: trước là mã trạng thái, giờ là ngôn ngữ. ⚠️ **KHÔNG đổi:** canonical P-number · dependency order · **thanh ~33%** · FE PENDING (DD-116) · **0 màn FE** · schedule OFF · không DD nào đổi trạng thái. Hai slice thêm **bề mặt API**, không thêm surface người dùng chạm được — đó là lý do thanh % không nhúc nhích, và đó là số đúng. |
| 03/09/2026 | **v3.14** | **Trục Tests hết `STALE` — pin runner + readiness + đóng luật 4, KHÔNG chạy lại suite.** (1) **Nhãn `STALE` gỡ.** Authority trục Tests chuyển `854 workspace + 30 validator @ 93f1e93` (15/08) → **`1234 workspace + 85 readiness/kit @ 2648965`**. Khối 🟩 03/09 mới trên đầu file; khối 🔷 02/09 bị thay **toàn bộ**, giữ nguyên văn làm lịch sử. (1b) **Gộp về MỘT mốc.** Bản đầu của v3.14 pin hai chỗ (cấu trúc @`620b2bd`, Tests @`18c75d8`) — không cần: `18c75d8 ≡ 2648965` về mã (`git diff … -- packages apps scripts` rỗng), và đo lại tại `2648965` cho **y hệt** `620b2bd` ở mọi trục cấu trúc (migration 37 · test file 46 · route 13 · spec 27+27 · FE 17 · `.each` 17), chỉ static đổi **1095 → 1097** vì đúng 2 test của lane P17 — toàn bộ delta `620b2bd..2648965` là 2 file, cả hai của lane đó. Người đọc nay giữ **một** mốc trong đầu, không phải hai. (1c) 🔵 **Ghi rõ số có HẠN DÙNG:** lane `test-harness-chat-definer-lock-client-leak--v2` **chưa merge**, tự đo `db 716` (708 + 2 sibling + 6) vs **710** đang pin. Luật 1 ⇒ chưa cộng; khi land phải **đo lại** static + runner + generator cùng lúc, **cấm cộng tay `+6`** vào 1234 (đúng kiểu suy số luật 4 chặn). `716` ghi ở đây là **dự đoán để đối chiếu, không phải số khai**. (2) **Phép đo không phải mới sinh ra** — nó có sẵn từ gate của lane `gates-that-fire--migrate-p17-cause`, trích từ `.autopilot/state-archive/…-20260903T060118Z/state/gate-attempt-01-verify-canonical-04.txt` (`exit_status: 0`), mỗi số kèm số dòng trong artifact. Chạy lại sẽ tạo phép đo *khác*, không phải xác nhận phép đo này. (3) ⚠️ **HAI THANG ĐO, cấm cộng im lặng:** `1234` = vitest, 46 file dưới `packages`+`apps` (core **153**/11 file · db **710**/12 · web **331**/19 · bot **40**/4); `85` = `node --test`, đúng 3 file `scripts/*.test.mjs` (`# pass 85 · # fail 0 · # suites 0`). Hai tập file **rời nhau**, nên chuỗi historical giữ **workspace-only**: … → 670 → 813 → 854 → **1234**. Chuỗi lớp readiness đi riêng: 13 → 17 → 30 → **85**. (4) **Điều kiện carry ghi bằng LỆNH, không bằng SHA:** `git diff --name-only 18c75d8..main -- packages apps` và `… -- scripts` đều **rỗng** ⇒ mốc được mang sang; đặt cạnh ca **hỏng** hồi 02/09 (`80a3464..620b2bd` trả **34 file** ⇒ khai `STALE`) để thấy cùng một luật ra hai kết cục. (5) ✅ **LUẬT 4 ĐÓNG:** static đo lại tại `18c75d8` = **1097** (core 147 · db **680** · web 230 · bot 40; `+2` so với 1095 @`620b2bd` là test của chính lane P17) và `1097 + 137 = 1234`, **đóng độc lập trên từng package** — 4 checksum rời nhau. `137` **không phải** hiệu `1234−1097` mà là **tổng bảng kiểm kê hai lớp**: 17 site `it.each` (`+100`, static thấy 0) + 9 loop-site (`+37`), đếm theo **độ sâu ngoặc**. Bảng generator §luật 4 thay bằng bản 03/09; hai bảng cũ (`1fdba1d` `+41`, đối chiếu `80a3464`) hạ xuống `<details>` historical. Ghi rõ **3 loop cố ý đếm 0** vì nằm *trong* thân `it()` (`chat-dm-safety-invariants:527`/`:545`) — chỗ dễ đếm dôi nhất. Lớp readiness đóng cùng công thức trên thang riêng: `65 + 20 = 85`. (6) **Lệnh tái tạo** thêm dòng static cho lớp readiness/kit + ghi rõ lệnh workspace quét `packages apps` nên **theo cấu tạo** không thấy `scripts/`. ⚠️ **KHÔNG đổi:** canonical P-number · dependency order · **thanh ~33%** · FE PENDING (DD-116) · mọi giá trị cấu trúc (chỉ *mốc* của chúng dời `620b2bd` → `2648965`, số giữ nguyên trừ static) · không DD nào đổi trạng thái. Đây là pass **đo**, không phải pass quyết định. |
| 30/08/2026 | **v3.12** | **Đóng half-revoke `public_sessions` — migration `0036`.** Khối 🔵 30/08 (muộn) mới trên đầu file. `app` mất nốt `INSERT/UPDATE/DELETE` (sót từ `0009`, `0033` mới revoke `SELECT`); sau `0036` `app` không còn quyền gì trên bảng gốc, giống `readonly`. Squash `f408693`, đóng backlog `4024127` (`ap-finish --squash-verified`; đóng trigger đã khai xác nhận bằng `information_schema.role_table_grants` rỗng). Thuần security-hardening — không tạo writer mới, không chạm DD-114 D3 / epic projector bốn tiền đề, không authorize gì thêm. KHÔNG re-pin số đếm (vẫn snapshot `1fdba1d`). ⚠️ Không đổi: P-number, dependency order, thanh ~33%, FE PENDING. |
| 30/08/2026 | **v3.11** | **Mirror ba quyết định 26–27/08 + đính chính bốn phát biểu đã hết đúng. KHÔNG re-pin số đếm.** Khối 🟠 30/08 mới trên đầu file. (1) **DD-114 D3 ✅ phương án (b)** (owner 26/08, `3045c7f`) — phase-1 CÓ toggle + fence, **KHÔNG chiếu `public_sessions`** (bảng không có writer trong phase-1); projector = **epic bốn tiền đề** (DD-73 · DD-41 · occupancy helper duy nhất · alias moderated substrate), không phải một slice ⇒ thay dòng "OQ public (DD-114 D3, vẫn ⬜)" ở khối 🟢 25/08. (2) **DD-112 ✅** (owner 27/08, `3fed215`) — capacity **không phải nhánh tiền**, không đòi `impact_policy`; edge #4 tách 4a/4b (`b030ecd`); chốt có **điều kiện tự huỷ** ⇒ thay dòng "DD-112 vẫn ⬜". (3) **DD-118 ✅** (owner 26/08, `cec62c6`) — lần đầu vào file này: ngôn ngữ surface đã đăng nhập = `tenants.locale` qua `SECURITY DEFINER` `tenant_locale()`, fail-closed `'vi'`; response trước khi tenant known-and-authorized giữ tiếng Việt là **hành vi phê chuẩn**, không phải lỗ hổng phủ; độ phủ chưa đủ, không khai xong. (4) **"0 route nghiệp vụ" ở khối 🟢 14/08 hết đúng** — `770ff4b` land bộ API route nghiệp vụ đầu tiên (session create/publish/update), kèm `bbd9f1b`/`a3654fc`/`8e668a1` cho Update/Close/Cancel. (5) **Migration tail `0033`→`0035`** (`0034` person-account convergence · `0035` tenant_locale_reader). ⚠️ **Số đếm cố ý KHÔNG re-pin:** snapshot vẫn `1fdba1d` (13/08) và bảng số hiện hành **đã stale theo luật 4 của chính file** — delta đã đo nhưng để một pass đo riêng pin lại cùng lúc runner + static, vì lệch static-vs-runner cần kiểm kê generator trước khi khai (tiền lệ v3.5: khai mismatch trước khi kiểm kê là sai). ⚠️ **Không đổi:** canonical P-number, dependency order, thanh **~33%**, FE PENDING (DD-116) — theo luật 5, route nghiệp vụ đã có nhưng 0 màn FE, schedule OFF, chưa projector thật. 🔶 **Đề xuất chờ owner:** xem lại thanh ~33% **tại thời điểm FE thoát PENDING**; bản này không tự đổi số. |
| 02/09/2026 | **v3.13** | **Re-pin đo lường tại `main@620b2bd` (30/08, +93 commit từ `1fdba1d`) — pass mà v3.12 hẹn nợ, đóng được một nửa.** (1) **Repo truth snapshot chuyển `1fdba1d` → `620b2bd`**; khối 🔷 02/09 mới trên đầu file. (2) **Số cấu trúc đã pin:** migration 33→**37** (`0033` fences · `0034` identity-account-link · `0035` `tenant_locale_reader` · `0036` revoke `app` DML `public_sessions`) · test file 37→**46** · API route 10→**13** (**3 route nghiệp vụ đầu tiên**, `770ff4b`) · static 772→**1095** (core 147 · db 678 · web 230 · bot 40) · Product spec 26→**27**, BE 25→**27**, FE design **17** không đổi · **màn FE vẫn 0**. (3) 🔴 **Trục Tests khai `STALE` có tên, không khai số suy ra** — mốc `813 @ 80a3464` **không được mang sang** vì `git diff --name-only 80a3464..620b2bd -- packages apps` trả **34 file**, phá đúng điều kiện code-identical mà nó dựa vào; pass này không chạy được runner (môi trường đo không có `pnpm`/Postgres). Authority giữ **854 + 30 @ `93f1e93`**; phép đo informal 919 sau `9da3021` **không phải authority** và cũng đã stale thêm 4 merge. (4) **Static under-count nặng hơn trước:** generator lớp 2 `it.each`/`test.each` **2 → 17 hit** (15 hit mới ở `apps/web` route/lib session) ⇒ công thức `static + generated = runner` của luật 4 **không đóng được** ở snapshot này. (5) **Ma trận thêm 5 hàng landed:** Session command family (**đủ 6 command**, `session-service.ts` 2232 dòng) · Session API surface (3/6 có route; `close`/`cancel` thiếu, `announce` **bị gate** DD-56 clause 1) · Public read model fence (**đóng**, `0033`+`0036`) · Identity account link (`0034`, code dark) · Tenant locale (`0035`, phủ chưa đủ). Hàng DD-29 sửa từ "code dark" → **"nửa dark"**: `authorizeTenantAction` hết dark, `resolveCapability()` **vẫn 0 caller** ⇒ hard-dep (a) của DD-114 còn mở. (6) §Next Actions #6 thay khối "việc kỹ thuật 13/08" bằng **hàng đợi BE (8 mục) + infra (7 mục) xếp theo dependency**, khối cũ giữ làm lịch sử. ⚠️ **KHÔNG đổi:** canonical P-number · dependency order · **thanh ~33%** · FE PENDING (DD-116) · epic projector bốn tiền đề · không DD nào đổi trạng thái. Đề xuất xem lại thanh % (v3.12) **vẫn chờ owner** — pass này không tự đổi con số. |
| 25/08/2026 | **v3.10** | **Re-pin theo `main@1215a6a` — hai BE merge tuần 22–25/08 + mirror DD-117.** (1) Khối 🟢 25/08 mới trên đầu file: **(8a) `public_projection_fences` ĐÃ LAND** (`9da3021`, migration `0033`, 34 file — guarded view + CAS-clear + REVOKE base SELECT `readonly`+`app`) ⇒ hard-dep (b) của DD-114 đóng, toggle public/private hết blocker hạ tầng (còn FE PENDING DD-116 + OQ DD-114 D3); **DD-29 resolver `f2af39d`** — reader đầu tiên của registry, vẫn 0 caller (hard-dep (a) nửa đường). (2) §Next Actions mục (8a) đánh dấu ✅ landed; (8b) vẫn chặn bởi DD-41. (3) Phụ lục A thêm hàng **DD-117** (close/cancel fail-closed refuse + D5 dedup commandId-only). (4) Số đo: tail `0033` · suite informal 919 + 30 · authority Tests vẫn 854+30 @ `93f1e93`. ⚠️ Không đổi: P-number, dependency order, thanh ~33%, FE PENDING. |
| 25/08/2026 | **v3.9** | **Mirror DD-115 (owner 25/08) — Membership gói hội viên 30 ngày; D1–D5 ✅, D6–D8 ⬜.** Thêm section *Ngoài lộ trình phase-1* neo Membership vào **P4+**, ngoài phase-1 (DD-114 D7) và ngoài launch (DD-113 D3). Ghi hard dependency **Session core + Payment reconcile phải có runtime trước** (Membership đọc `sessions` để đếm buổi, ghi `charges`/`payment_allocations` để thu) và chi phí schema thật: 3 bảng mới, **0 thay đổi bảng tiền, 0 cột mới trên `memberships`**. Ghi **hai blocker cứng** — D6 ngoại lệ BL-SES-2/BL-CBF-3 (Tier C; khái niệm "sân" chưa tồn tại) và D7 ngoại lệ BL-PAY-5 FIFO (chưa chốt ⇒ gói không kích hoạt được ⇒ **không slice nào chạy đầu-cuối**) — cộng D8 chặn ngoài bởi DD-82. Kèm thứ tự mở 4 bước, GA chỉ sau khi chạy song song trọn một chu kỳ 30 ngày. ⚠️ Kèm **đính chính version**: header đứng ở v3.7 trong khi changelog đã tới v3.8 (mirror DD-116) — v3.9 gánh cả phần lệch. **Không authorize** code/migration/slice. |
| 24/08/2026 | **v3.8** | **Mirror DD-116 ✅ Option B — KEEP: FE PENDING vào decision log kèm named trigger (owner 24/08).** Hai khối FE boundary (dòng ~63 + ~407) nay trỏ **nguồn bền = `../standards/decisions.md` DD-116**, RUN doc 13/08 hạ xuống nguồn lịch sử; Phụ lục A thêm hàng DD-116. PENDING **giữ nguyên** (Option B) — gỡ chỉ khi named trigger đủ CẢ BA: (a) owner chọn canonical `.pen` (đúng một) · (b) tracked trên `main` · (c) owner ký nghiệm thu design authority (gate DD-81); khi gỡ ⇒ FE bounded đúng 5 khối launch, mỗi lane vẫn qua Level 3 + readiness gate; không sự kiện khác gỡ. ⚠️ **Không đổi:** canonical P-number, delivery order, thanh %, và **không re-pin/không đo lại** gì. |
| 22/08/2026 | **v3.7** | **Mirror DD-114 ✅ — phase-1 feature scope = 7 nhóm, launch (DD-113) là subset (owner 22/08).** Sửa 4 chỗ: (1) khối 🟣 đầu file thêm danh sách 7 nhóm + hai hệ quả đắt + OQ; (2) §Canonical Delivery Groups thêm ghi chú **phase-1 cắt ngang bảng** — 7 nhóm rơi vào **P0–P5 trừ discovery/chat**, bảng vẫn thắng về *dependency* còn DD-114 thắng về *phạm vi*; (3) §GTM theo phase — hàng **P5** không còn là bước cuối mà là **điều kiện của nhóm 6** (không có `host_pro` thì không có gì để gate auto-reconcile + nhắc tự động); (4) Phụ lục A thêm hàng DD-114. **Hai hard dependency owner-final:** billing P5 + **reader đầu tiên của DD-29 entitlement registry** (vẫn 0 TS đọc tại `a151b15`) vào phase-1; toggle public/private chỉ mở **sau khi land `public_projection_fences` (8a)** vì kèo private/cancel hiện còn lộ tới khi projector async chạy. **A3 legal (PII) từ lead-time item thành blocker phase-1.** ⬜ OQ chưa chốt: public để làm gì khi chưa có discovery. ⚠️ **Không đổi:** canonical P-number, Dependency Map, delivery order, thanh ~33%, FE PENDING; **v3.7 không phải re-pin**, không số đếm nào được đo lại. |
| 22/08/2026 | **v3.6** | **Mirror DD-113 ✅ — GTM re-sequencing (owner 22/08).** Launch = **webapp PWA + Zalo bot song song**; app native lùi về phase sau; web hết vai "fallback". Sửa 5 chỗ: (1) khối 🟣 mới trên đầu file; (2) §Positioning — thêm đoạn DD-113 dưới đoạn DD-69, **không** đảo DD-69; (3) hàng *App Native* trong §Canonical Delivery Groups — traction signal "PWA live + retention đo được" nay thành **ngưỡng cụ thể** (≥5 host ≥4 tuần · weekly return ≥60% · install ≥30% tách iOS/Android · `/api/v1`+bearer/refresh · capability PWA không làm nổi); (4) §GTM theo phase — ghi chú bảng đó là GTM theo *phase kỹ thuật*, không khai thứ tự surface, và mọi metric từ nay phải tách theo surface; (5) Phụ lục A thêm hàng DD-113. ⚠️ **Không đổi:** canonical P-number, Dependency Map, delivery order, thanh ~33%, và **lệnh FE PENDING 13/08 vẫn nguyên hiệu lực** — DD-113 cố ý không gỡ nó (đổi ưu tiên GTM ≠ cấp quyền thực thi FE). Live-truth snapshot vẫn pin ở `1fdba1d`/`a151b15` theo các khối cũ; **v3.6 không phải một lần re-pin**, không có số đếm nào được đo lại trong lần sửa này. |
| 13/08/2026 | **v3.5** | **Live-truth re-pin `64e9ccb` → `1fdba1d` (+60 commit).** (1) **Migration tail `0029`→`0032`** (30→**33**): `0030` DM-safety authority DD-55, `0031` **chat schema core DD-38/86** — root DB thật đầu tiên của Chat epic, `0032` DD-102 single-read (đóng nghĩa vụ waiver). **Cả ba code dark:** 0 TS production đọc `chat_*`; Chat vẫn 0 service/API/UI. (2) **Trục Tests:** runner **670 → 813 workspace** đo 12/08 tại `80a3464` (mốc trước là `683` **tổng** = 13 validator + 670 workspace; chuỗi historical nay chuẩn hoá về workspace-only để không trộn hai thang đo); test file 35→**37**; static 669→**772**. ✅ **Đối chiếu khớp chính xác: `772 + 41 = 813`**, kèm bảng per-package. **Bản nháp đầu của chính v3.5 đã khai sai một mismatch "lệch 11"** — do (a) bỏ sót generator ở `chat-dm-safety-invariants.test.ts:476` (`+2`) và (b) trừ nhầm 13 validator khỏi một con số vốn là workspace-only. Hai sai số bù nhau ra 11. Khối 🔴 + binary resolution + next-review-trigger dựng cho sai lệch đó đã bị **gỡ bỏ**, thay bằng ghi chú tiền lệ: *trước khi khai mismatch phải nói rõ số runner là workspace hay full*. (3) **Phát hiện 2 lớp mù của static, cả hai từ một file:** `it.each` cho **0 hit** (v3.4b từng loại trừ `test.each` bằng "0 hit toàn repo" — đúng lúc đó, hết đúng từ `d5b31f9`), và `it()` ở thân vòng **ngoài** của loop lồng lọt khỏi cửa sổ grep. Lệnh kiểm kê tách 2 lớp + cửa sổ `-A3`→`-A12`; ghi rõ **grep theo cửa sổ dòng không đủ, muốn chắc phải đếm theo độ sâu ngoặc**. (4) **Invariant 3→5 file** (`chat-dm-safety-invariants` merged — v3.4o ghi "chỉ trên lane branch", nay sai; + `chat-schema-invariants`); ghi rõ invariant ✅ **không** kéo BE lên. (5) **Lệnh tái tạo spec đã stale** vì reorg `2e577c7` (`docs/features` → `FE|BE`) — lệnh cũ trả 0 chứ không phải mất spec; đã sửa + thêm dòng đếm FE spec (12→**17**). Spec 24+24 → **26 Product + 25 BE**. (6) 🔴 **FE: HOLD → PENDING theo lệnh owner 13/08** — đổi bản chất, không phải đổi mức độ: gate DD-81 không còn là thứ chặn. (7) **Ghi việc đang bay, tách khỏi mọi trục:** `session-service-create-command-core` — slice nghiệp vụ đầu tiên; v1 `HALT MAX_ROUNDS`, v2 authorized, **chưa merge** — cố ý **không pin SHA/LOC** vì lane amend liên tục (hai SHA chép vào bản nháp đã thành orphan trong một buổi). Theo **luật 1** mọi cột trục của module 8 giữ ⬜; ghi chú in-flight nằm ở cột Status, không phải cột trục. (8) **CI infra-block 06/08 đã hết** (OSV GREEN tại `9a5c709`); chưa được khai full-matrix xanh. (9) Phụ lục A thêm DD-55/100–105; ghi chú `slice-readiness-verdicts.md` dừng ở Verdict 31 vì verdict mới sống trong packet `docs/autopilot/contracts/`. (10) **Sửa hai số historical:** chuỗi runner khôi phục mốc 519/526 (v3.4o có, bản nháp v3.5 làm rơi) và **loại `795 @ a8f120f`** — commit đó **không nằm trên `main`** (chỉ trên `feat/dd38-dd86-chat-schema-core--v2` + archive), không được xen vào chuỗi mốc main-line. **Không phase nào thêm/bớt, không DD nào đổi trạng thái, canonical P-number + Dependency Map + thanh ~33% không đổi.** ⚠️ **Có đổi:** *near-term execution sequence* ở §Bottleneck (Session BE #3→#1, Google enablement #1→#3, thêm chat slice 7) — đã ghi rõ tại chỗ rằng đây không phải canonical phase order. |
| 07/08/2026 | **v3.4o** | **Live-truth re-pin `2cd52ce` → `64e9ccb` + trục Tests hết `STALE`.** Canonical runner PASS **683** đo 07/08 tại `528540e` (máy owner; CI runner-blocked chưa xác nhận); test file 33→**35**; static @`64e9ccb` = 669, kiểm kê generator thứ 2 (`app-error.test.ts:22`, +6) — đối chiếu khớp `661+9=670` tại `528540e`. Đính chính v3.4m: `chat-dm-safety-authority-core` đã implement (lane v2 @`31bd4d9` đỗ chờ codex quota), không còn "chưa register/worktree". Ghi ⛔ CI infra-blocked 06/08 + mitigation `4cc574c` chưa verify; de-pin version decisions khỏi header Căn cứ (v2.11 stale vs live v2.19); FE row ghi 2 ứng viên `.pen` untracked chờ owner chọn canonical DD-81. Không đổi phase/DD/delivery order/~33%. |
| 07/08/2026 | **v3.4n** | **Mirror decision batch 07/08 (decisions v2.18):** Phụ lục A thêm DD-96..99. DD-97 statement/export: direction + entitlement chốt (per-session view free · kỳ/export `host_pro`), mechanism chờ DTO owner. DD-98 negative scope NP-1..5 final. DD-99: 4 section FE = điều kiện Draft→Reviewed; backlog FE prioritized P2 (player session-detail/join/waitlist — critical path S9–S12) → P4 (mark-paid `cash\|waiver`; refund-on-cancel tách chờ refund policy) → P3 (account-management); breakpoint rule 2 lớp. Delivery order/code readiness không đổi; không authorize build mới. |
| 28/07/2026 | **v3.4l** | **Chat readiness re-pin + current HEAD:** exact 27-file authority pack land tại `90d292d`; plan v1.8/analysis đạt `PLAN_READY` closure 12/12. Re-pin live summary tới `main@784bc8d`; code/test inventory không đổi vì hai commit mới chỉ docs. Giữ B4/per-slice `CODE_READY`, no runtime/migration/API/UI, DD-32 WIP overlay và ~33% delivery boundary. |
| 28/07/2026 | **v3.4k** | **Owner-final Chat authority + DD-32 reconcile:** mirror DD-86/DD-91–95 and demote DD-88 to broader `DEFERRED_PROPOSAL`; Assistant/Chat/Notifications pairs Reviewed. Current readiness remains owned only by primary plan §13. Preserve committed `main@2dc9b8c` 24/23 snapshot while recording uncommitted 24/24 docs overlay and DD-32 Option D target. Runtime/delivery percentage unchanged. |
| 28/07/2026 | **v3.4j** | **SUPERSEDED by v3.4k:** former Chat correction used universal default-OFF, three commands and no-digest floor; no longer current authority. |
| 28/07/2026 | **v3.4i** | **SUPERSEDED by v3.4k for Chat:** former v2.08 Chat propagation retained as history; unrelated FE sequencing notes remain historical. |
| 27/07/2026 | **v3.4h** | **Current-truth + DD-91/regional reconcile tại `main@2dc9b8c`.** Pin 25 migrations (`0024` public-capacity invariant), 32 test files / 537 workspace PASS +13 validator, static 528+9. Ghi nhận `0022`/`0023` + dispatcher/queue/preflight/scheduler đã merge nhưng default OFF/no producer/projector. Safari M3 measurement closed nhưng Google chưa enable. In-app Chat primary target + requester-only `/pay` là DD-91 decision final, plan vẫn `NOT_PLAN_READY`; manual mark-paid global, auto-reconcile có entitlement + regional capability gates. |
| 27/07/2026 | **v3.4g** | **Job runtime + schedule evidence:** dispatcher/queue provisioning/preflight/worker lifecycle merged; scheduler recovery 1 phút merged sau đó nhưng default OFF. Canonical product suite tiến tới 537 workspace; không producer/projector nghiệp vụ, không tăng product runtime. |
| 26/07/2026 | **v3.4f** | **Job DB core:** `0022` lease/reclaim/audit + narrow worker authority merged, tiếp theo `0023` claim-token/ack completion. Shared infrastructure only; no product runtime. |
| 25/07/2026 | **v3.4e** | **Canonical evidence + notification/status/design-authority reconcile.** Runner re-aggregate PASS **29 files / 460 workspace tests** (core 132 · DB 179 · web 146 · bot 3) + 13 validator tests; gỡ nhãn STALE khỏi current test rows. DD-70/71/72 owner-final được propagate, Notification pair Reviewed/no-runtime. DD-81 canonical path = root `design.pen`, vẫn HOLD trước persist/track + owner nghiệm thu. Pin next coding initiative BE-only `db-job-claim-lease-core`; không đổi phase/delivery order/% runtime. |
| 25/07/2026 | **v3.4d** | **Current-state reconcile tại `main@2937ed9` — không đổi scope/phase/DD/delivery order/%.** (1) Repo-truth snapshot re-pin `f93873b`→**`2937ed9`** (= `origin/main`). (2) **Migration tail `0020`→`0021`**, §Dev Progress migrations row re-verify **19→22** (`0000`–`0021`): `0021` (`15e10b7`, 24/07) đóng nốt bộ ba tenant-integrity composite FK DD-68 ở nhánh **non-money**; thêm hàng ma trận riêng **"Tenant-integrity FK (ngoài P-number)"** để không double-classify vào Foundation/Auth. (3) **Ghi nhận core đã đổi:** `d2a27e1` (23/07) — `splitNameAmount` exhaustive fail-closed ambiguity union (DD-87), runtime change chứ không phải doc; module 1 và bảng Payment Reconciliation cập nhật theo. (4) **Tách trục Tests thành hai dòng, đánh dấu STALE đúng chỗ:** canonical runner **419 vẫn là snapshot 22/07 và KHÔNG mô tả `2937ed9`** (core + db đều đã đổi); thêm dòng **static cross-check 451** (core 132 · db 179 · web 137 · bot 3) với phân tích drift +41 = core +21 + db +20 — khớp nguyên nhân đã biết; thêm dòng **bằng chứng per-slice real-PG db 167→173→179**. Theo luật 4, **không** suy runner = 451+9. (5) Ghi nhận **8 docs/spec slice** publish · billing · draft-lifecycle đã merge ⇒ contract S5/module 11 dày lên, nhưng cột code giữ ⬜ và thanh **~33% không đổi** (integrity expand-only + spec ≠ slice roadmap mới). (6) Next Actions #3 hạ 🔴→🟡 (checklist Session Management COMPLETE) và #6 thêm 4 việc kỹ thuật mới nổi: re-aggregate runner · verdict thiếu cho `0021` · author job-infra chung up front · wire consumer ambiguity DD-87. |
| 24/07/2026 | **v3.4c** | **Migration-tail reconcile (docs-migration-tail-0018-to-0020-sweep): `0018`→`0020`.** `0019`/`0020` (`b0c29a6`/`f6ccd79`, 23/07/2026) thêm tenant-integrity composite FKs (DD-68), tầng riêng ngoài nền `0000–0014` và auth lane `0015`–`0018` (anti-double-classify giữ nguyên). §Dev Progress migrations row giữ nguyên pin **19** (`0000`–`0018`, snapshot `main@f93873b` 22/07) + thêm ghi chú trỏ tail hiện hành `0020`; Status P0–P1 + Bottleneck note thêm tail delta. Các số đếm khác (test/route/spec) giữ nguyên snapshot 22/07, CHƯA re-verify. Không đổi scope, DD, hay delivery order. |
| 22/07/2026 | **v3.4b** | **Đóng nốt 3 tồn đọng đo lường — không đổi scope, không đổi số test.** (1) **Static grep phục hồi thành cross-check dùng được:** luật 4 pin công thức `static + Σ(test sinh trong loop) = runner`, kèm **kiểm kê generator** (đúng 1 chỗ tại `f93873b`: `apps/web/lib/google-oidc.test.ts:133`, `rows.length = 10` ⇒ `+9`; đối chiếu `410 + 9 = 419` ✅) và lệnh kiểm kê generator trong block tái tạo ⇒ phát hiện drift được **không cần Postgres**. Ghi chú divergence chuyển từ "không suy diễn nguyên nhân" sang **nguyên nhân đã xác định**; runner vẫn là authority duy nhất. (2) **Trục Invariant nới theo class, không theo tên file:** thêm concurrency/race-safety vào định nghĩa + **danh sách invariant-class tường minh** (3 file: `rls-invariants` · `waitlist-invariants` · `migrate` — race-safety role bootstrap `0000`); bảng số đếm `2 file` → **3 file**; ghi tồn đọng rename `migrate.test.ts` là **code slice riêng, chưa làm ở đây**. (3) Footer dùng **full 40-char SHA** cho khớp header. |
| 22/07/2026 | **v3.4a** | Re-pin repo truth tại `main@f93873b`; canonical `pnpm test` PASS: **29 files / 419 tests** (111 core · 159 db · 146 web · 3 bot). Static grep = 410 chỉ còn source cross-check; tất cả bảng Tests dùng canonical runner. Không đổi scope, DD, delivery order hay trạng thái enablement. |
| 22/07/2026 | **v3.4** | **Khung đo lường + reconcile bằng chứng — KHÔNG đổi scope.** (1) Thêm §**Cách đọc tiến độ**: 6 trục Spec/Migration/BE/FE/Tests/Invariant + định nghĩa Done từng trục + **5 luật chống lạm phát** (docs≠runtime · merged≠enabled · `.pen`≠FE · đếm phải tái tạo được · trục yếu nhất là trạng thái thật) + lệnh tái tạo số đếm. (2) Thay thanh % đơn bằng **ma trận theo delivery group** + bảng **số đếm kiểm chứng được** tại `main@142e9fa` (19 migration · 28 test file · **403 test case (static)** · 10 route · 24+23 feature spec · **0 màn FE**). (3) Thêm cột **Duration (`TBD`, owner điền)** + **Traction signal** cho mọi delivery group và phase header; signal không phải technical/code-readiness gate. (4) Thêm §**Critical Path to Revenue** + bảng "không chặn revenue" + cảnh báo revenue nằm ở P5. (5) Thêm §**GTM theo phase**. (6) Module Progress tách cột Spec/Migration/BE/FE/Tests + cột **Rev?**; các R-section P0–P3 chuyển sang **item có ID + Prio + Status**. (7) Thêm **Phụ lục A — bảng tra DD**. (8) Thêm **module 3c** = email/password bundle order-4 + gỡ Telegram — **decomposition của DD-80 §10 slice order đã chốt**, không phải scope mới. (9) **Reconcile số liệu sai:** migrations `0000–0013`→**`0000–0018`**; "Google/email chưa code"→**lane Google đã merge, ⛔ chưa bật** (chờ đo Safari/iOS); authority `decisions v1.74`→**v1.98**, BRD v3.9f→v3.9g, PRD v2.8e→v2.8f, TDD v3.1→v3.1a; `~20%`→`~33%`. **Không phase nào thêm/bớt; không DD nào đổi trạng thái; delivery order + dependency map giữ nguyên.** (10) **Test-count verify pass:** luật 4 tách **static cross-check** (không cần DB) vs **canonical runner** (authority), khôi phục lệnh grep bên cạnh `pnpm test`; số dùng trong file = static **403** (web **137**) vì đó là số duy nhất tái tạo được tại `142e9fa`. Ghi **OPEN drift** với `BUILD-STATUS.md` (khai web 146, chênh 9 = đúng số test của route `/complete` d1b) kèm binary resolution + owner + next-review-trigger; đã loại trừ giả thuyết `test.each` (0 hit toàn repo) và `it.skip/only/concurrent`. |
| 19/07/2026 | v3.3f | **Mirror DD-79 ✅ Home hub vào S9** (landing + nav registry, composition-only, spec Reviewed) + **DD-81 ✅ Pencil** (`plexco-app-design.pen`, theme exploration trên màn Home). Không đổi slice order/dependency/runtime. |
| 19/07/2026 | v3.3e | Authority pointer refresh v1.67→v1.74 (+BRD v3.9f/PRD v2.8e): v1.68–v1.74 BE-contract closure no-runtime; không đổi delivery order/canonical phase. Đồng bộ footer. |
| 19/07/2026 | v3.3d | **Correct DD-73..78 sequencing theo decisions v1.64; current authority v1.65:** DD-74/75 tạo baseline nên không thể nằm sau gate dùng chính baseline đó; chỉ DD-76/77 hard-gated. DD-78 đi cùng consumer. Đồng bộ authority/footer version; không đổi canonical phase hay runtime readiness. |
| 19/07/2026 | v3.3c | **DD-73..78 ✅ chốt (decisions v1.60):** Next Actions §8 thêm **(8a)** immediate-deny path cho public read model — `public_projection_fences` + guarded view + narrow functions + `public_projection_version` + grant migration, **thuộc DD-12** (nợ sẵn có của read model, không phải chi phí share) — rồi **(8b)** DD-73 route/OG/telemetry, còn chặn bởi DD-41 projection migration. Sequencing wording của entry này được corrected ở v3.3d. Không đổi canonical phase. |
| 18/07/2026 | v3.3b | **Founder batch (decisions v1.47):** DD-69 định hướng accepted (App Native delivery group "proposal"→"direction ✅ · build TBD"; positioning/note cập nhật); **thêm Session Organize delivery group (post-P4, DD-61..64 accept-in-principle)**; DD-33/60 ✅. Delivery order/code readiness không đổi; native + Session Organize build chưa committed. |
| 18/07/2026 | v3.3a | **DD-69 proposal + review closure:** Positioning + Delivery Groups thêm phase-2 native; phase-1 PWA là target chưa live; RN+Expo chỉ recommendation sau spike. Pin pre-schedule gates: client-safe contracts, `/api/v1`, bearer + iOS login compliance, dedicated device push + privacy-safe payload, offline read-only và store review. Delivery order/code readiness không đổi; native chưa committed. |
| 17/07/2026 | v3.3 | Authority → BRD v3.9b/PRD v2.8/TDD v3.1/decisions v1.45; mirror feature-doc closure nhưng không đổi delivery order, code readiness hoặc proposal status DD-61..64. |
| 17/07/2026 | v3.2 | **DD-65..68:** R1.5 hybrid central+optional tenant Page, host/player shared core, migration/actions/reachability, one-route delivery và milestone 2 tenant có/không Page; runtime pending. |
| 17/07/2026 | v3.1 | Authority → BRD v3.9 / PRD v2.7 / TDD v2.9 / decisions v1.44. Session Organize v0.3/DD-61..64 vẫn proposal, không chèn canonical timeline và không đổi implementation readiness. |
| 17/07/2026 | v3.0 | Authority → TDD v2.7 / decisions v1.42. Doc coverage → **22 Product/System + 21 BE = 21 cặp + 1 product-only**. Session Organize v0.2/DD-61..64 vẫn proposal: không chèn canonical timeline/module, delivery đề xuất sau Session CRUD + Sync, earliest after P4, phase TBD. |
| 15/07/2026 | v2.7 | **Decision reconcile + review fixes:** căn cứ trỏ decisions.md v1.32; thêm cụm session-model DD-06/08/41–46; sửa delivery phase Messenger base **M17/P2.5** + player P4.5, Zalo P4.7; M4 là shared chat-channel middleware Zalo→Messenger; Next Actions chỉ giữ DD thật sự open/gated. Schema/migration land cùng build slice. |
| 16/07/2026 | v2.8 | Đóng DD-04 ở roadmap: DO co-location đã chốt; Next Actions chỉ còn egress-IP verification, infra build và drill. Cập nhật authority lên decisions v1.34. |
| 16/07/2026 | v2.9 | **Founder batch DD-49..56 (decisions v1.36):** căn cứ → BRD v3.7 / PRD v2.5 / TDD v2.6; Next Actions gỡ "lifecycle grace/trial timing" (✅ DD-51), thêm legal A3 + note DD-33 hai nhóm permission; không còn founder decision chặn S4→S8. |
| 13/07/2026 | v2.5 | Reconcile live repo: DD-10 Next.js + DD-12 `public_sessions` projector đã chốt; P0–P1 = partially complete; feature coverage = 21 Product/20 BE (20 cặp + funnel product-only); auth provider swap chưa launcher-ready. |
| 10/07/2026 | v2.4 (review fixes) | **Build-status → reality:** Dev Progress + Module Progress + Next Actions + bottleneck — foundation (S1–S3, migrations `0000–0013`) + Auth v3 (Telegram-era) đã land trên `main@1eb6f60`; DD-37 supersede provider → Google/email chưa implement (bỏ "code chưa bắt đầu"/0%). **DD-38/39 ✅ scope-committed phase-1** (feature tracks/module/R4 — schema chờ migration). |
| 10/07/2026 | v2.4 | **v3.4 channel pivot: drop Telegram, Messenger + Zalo phase-1 + Google login/chat/gender-pricing/manual mark-paid — DD-37/13/33/38/39/40.** Delivery groups + timeline + module progress + phase sections + dependency map + critical path đổi Telegram→Zalo; Messenger nâng P4.8→**P2.5 (phase-1, App Review)**; thêm Google login (P0–P1), chat in-app + cài đặt hồ sơ/giá theo giới tính (P4, DD-38/DD-39 🟡), mark-paid thủ công (P2, DD-40); nhắc web+Zalo chính / Messenger best-effort 24h; Monetization Alignment + Risk cập nhật. |
| 20/06/2026 | v2.2 | P5 + Monetization Alignment: làm rõ `free_web` (0đ) vào thẳng active vô thời hạn, không trial/past_due/suspended vì non-payment (DD-03, BL-BIL-1). |
| 05/07/2026 | v2.3 | **DD-29 pricing pivot** (thay DD-03): `free` (web + 3 bot + đối soát thủ công) / `host_pro` 250k (auto reconcile/nhắc + AI + CRM), capability flags config-driven; **DD-30** APIpay enterprise auto-provision (money-custody không đổi). |
| 18/06/2026 | v2.1 | Dùng duy nhất canonical phase; thêm durable webhook + payment ledger/allocation; canonical store = PostgreSQL/domain model; Messenger tách post-MVP. |
| 18/06/2026 | v2.0 | **Reposition** → platform thể thao đa môn 2 phía. Re-sequence 7 phase (thêm **Phase 3 Web+Sync+Marketplace** = P4+P4.3, tách Identity thành Phase 2, Player-side thành Phase 4). Thêm track 🌐 Web+Sync & 🔎 Marketplace; module 8–13 mới; KPI/risk/North Star theo marketplace + sync + public layer. |
| 18/06/2026 | v1.1 | Đổi tên → **Plexco**; bảng Phase Mapping; link Messenger doc. |
| 16/06/2026 | v1.0 | Bản đầu — 6 phases, 6 feature tracks, dependency map, risk từ AUDIT. |

---

*ROADMAP v3.17 — canonical phase duy nhất. DD-113 (22/08) đổi **thứ tự surface** (web app + Zalo bot song song, native sau) và DD-114 (22/08) định nghĩa **phạm vi phase-1** (7 nhóm, launch là subset); **cả hai không** đổi canonical phase, dependency order hay bất kỳ số đếm nào. Live truth pinned at `main@e235ea4` (15/09/2026) — cấu trúc và trục Tests đo trong **cùng một lần chạy**: **1490 workspace + 128 readiness/kit**, **45 migration** (tail `0044`), **15 API route (7 nghiệp vụ)**, **0 màn FE**. Chat vẫn có DB root và **zero** service/API/UI — schema is not runtime. Shared job infra vẫn OFF, projector còn là `productionStubDeliver`. FE là **PENDING theo lệnh owner 13/08** (nguồn bền DD-116); carve-out **DD-119 chưa ratify**.*
