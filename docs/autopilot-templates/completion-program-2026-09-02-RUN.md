# Completion program — chạy nốt Plexco tới launch với ít quyết định owner nhất

**Ngày:** 02/09/2026 · **Base đo:** `main@620b2bd` (ahead 1 vs `origin/main`) · **Mirror:** `../product/ROADMAP.md` v3.13 · `../standards/BUILD-STATUS.md` (khối 🔷 02/09)

> **Đọc trước khi dùng:** `plexco-level3-autonomy.md` §6.1 (`autonomous_to_ready`, thang Tier A/B/C, Decision Ledger) ·
> `../standards/review-code-readiness-gate.md` · `../sessions/2026-08-26-plexco-DIRECT-RUN.md` (conductor, vẫn hiệu lực).
> Doc này **không thay** ba doc trên. Nó làm đúng một việc chúng chưa làm: **gom mọi quyết định owner còn lại
> vào một lần ngồi**, rồi xếp phần còn lại theo thứ tự chạy được liên tục.

---

## 1. Vì sao doc này tồn tại — và cơ chế nó khai thác

`plexco-level3-autonomy.md` §6.1 đã có sẵn thứ ta cần, gồm cả **luật demotion** quyết định:

> *"Một thay đổi mà một decision record **explicitly authorizes by name** là **Tier A, không phải Tier C** — owner đã quyết rồi; thi hành một quyết định đã viết không phải là ra quyết định mới."*

và hệ quả của nó:

> *"Xếp hạng lane theo **mật độ Tier C**, không theo kích thước. Một lane lớn mà mọi quyết định đã được viết ra thì chạy tới READY không cần chạm; một lane nhỏ với ba câu hỏi contract chưa quyết thì dừng ba lần."*

**Toàn bộ chiến lược của doc này là một câu:** trả lời trước §2 để **hạ Tier C xuống Tier A hàng loạt**, rồi
để agent chạy. Mỗi câu trả lời ở §2 được mint thành DD có số trong `decisions.md`, và từ đó việc thi hành nó
là Tier A — agent không được phép dừng lại hỏi nữa.

**Ngân sách owner mà doc này nhắm tới:** một lần ngồi ~30–45 phút (§2) + 3 việc tay (§3) + review batch ở mỗi
lần lane báo READY. Không có interrupt giữa chừng.

---

## 2. Bảng quyết định — trả lời một lần, mở khoá phần còn lại

Mỗi hàng có **mặc định đề xuất**. Nếu đồng ý hết, trả lời đúng một câu: **"O1–O9: chốt theo mặc định."**
Chỉ cần ghi rõ hàng nào bạn muốn khác. Mọi hàng chốt xong sẽ được mint thành DD trước khi lane nào chạy.

| # | Quyết định | Mặc định đề xuất | Vì sao mặc định này | Nếu không chốt thì sao |
|---|---|---|---|---|
| **O1** | **Gỡ FE PENDING (kích trigger 3 vế của DD-116)**: chọn 1 `.pen` canonical · track nó trên `main` · ký nghiệm thu gate DD-81 | **Gỡ.** Chọn `design.pen` làm canonical, `fe.pen` archive | Đây là **quyết định đắt giá nhất trong bảng**. Launch DD-113 = 5 khối, **cả 5 đều là FE**. BE đã đi trước FE rất xa (6 command · 13 route · 37 migration · **0 màn**); mọi BE tiếp theo chỉ làm khoảng cách rộng ra. Không gỡ O1 thì project **không thể tới launch**, bất kể chạy bao nhiêu lane BE | Trần cứng: BE-only. Thanh % đứng yên vĩnh viễn theo luật 5 |
| **O2** | **Uỷ quyền thường trực:** `autonomous_to_ready` là mode mặc định cho mọi lane P1/P2 của chương trình này; owner review theo batch tại READY qua Decision Ledger | **Uỷ quyền.** P0 vẫn prepare-only | Tiền lệ đo được: lane `session-service-create-command-core` v1 tốn **4 vòng owner chỉ để duyệt budget**, rồi vẫn HALT — 4 lần dừng đó sinh ra con số, không sinh ra insight. 3/4 blocker authoring giải được bằng cách **đọc repo** | Mỗi lane dừng 3–5 lần. Ngân sách owner tăng ~10× mà chất lượng không tăng |
| **O3** | **Route `announce` + `OUTBOX_DISPATCH_SCHEDULE_ENABLED`** (DD-56 clause 1) | **Build dark, KHÔNG bật.** Viết route `announce` sau `close`/`cancel`, gate sau flag; schedule giữ `false` cho tới khi downstream safety contract tồn tại | Bật schedule biến `{announced:true}` thành **lời hứa với người dùng thật**. Tách "code tồn tại" khỏi "hành vi bật" giữ enablement là một quyết định riêng, đúng lúc, thay vì một tác dụng phụ | Agent AWAIT ở đúng lane announce, hoặc tệ hơn: bật nhầm |
| **O4** | **`db-zalo-bots-secret-hardening`** — cơ chế bảo vệ credential | **Chưa chọn cơ chế.** Chỉ authorize **task trace read-only** trước: field thật là `zalo_bots.secret` hay `bot_token_enc`, ai đọc/ghi, provider đòi gì | Backlog row đang **sai scope** (row nói `secret`, fixture tracked dùng `bot_token_enc`). Chọn KMS/hash/rotation trước khi biết field thật là quyết định trên dữ liệu sai | Lane này hoặc đứng, hoặc chạy vào cơ chế sai rồi phải bỏ |
| **O5** | **Email/password order-4 (P5)** | **Giữ `blocked`, không re-slice.** Phase-1 đăng nhập = **Google only** | DD-114 nhóm 1 ghi đúng chữ "signup/signin **bằng Google account**". Order-4 đang mang 3 Tier-C blocker + đòi re-slice thành DB/route/delivery. Cắt nó khỏi đường tới launch là **cắt đúng**, không phải cắt góc | Một khối lớn `blocked` cứ nằm trong mọi lần quét backlog và ăn attention |
| **O6** | **Bật Google OAuth production** (`GOOGLE_OAUTH_CLIENT_ID/SECRET`) | **Chưa bật.** Bật khi màn signin đầu tiên chạy được E2E trên staging | Enablement là Tier C và không nằm trên đường găng cho tới khi có màn thật gọi nó. Bật sớm chỉ tạo bề mặt sống mà không ai đi qua | Không sao trước mắt; nhưng phải chốt trước khi launch |
| **O7** | **A3 legal (PII data-class matrix)** — gửi luật sư VN | **Gửi tuần này**, độc lập với mọi lane | Đây là **blocker phase-1 có lead-time ngoài repo dài nhất**, và là thứ duy nhất trong bảng mà thời gian trôi không giúp gì. Packet `a49bf96` đã sẵn | Lane BE/FE về đích rồi vẫn không go-live được |
| **O8** | **Negative scope của chương trình này** | **Park hẳn tới sau launch:** in-app chat (`0030`–`0032` giữ nguyên, 0 service) · discovery public · projector public read model (epic 4 tiền đề) · feed/kudos · tournament/club · fill-slot · web push · native · rating công khai | Trùng đúng negative scope launch của DD-113 + epic 4 tiền đề của DD-114 D3. **Không phải bỏ việc — là từ chối mở mặt trận thứ hai.** Khoảng 20 trong 44 row `idea` rơi vào đây | Backlog kéo agent đi lang thang; mỗi row `idea` trông đều hợp lý khi đọc riêng |
| **O9** | **Thanh tiến độ ~33%** | **Giữ nguyên**, re-baseline một lần tại thời điểm FE thoát PENDING và có màn đầu gọi API thật | Đúng đề xuất đã ghi ở ROADMAP v3.12, chưa được duyệt. Đổi số lúc này chỉ là đổi số | Không ảnh hưởng lane nào; chỉ là nợ đọc hiểu |

**Ba hàng còn `blocked` vì bằng chứng bên ngoài — không cần bạn quyết gì hôm nay, chỉ cần biết chúng đang nằm đó:**
`infra-egress-compatibility-evidence` (cần trước deploy) · `apipay-signed-body-reconciliation` (cần trước vế tiền thật) ·
`email-provider-c7-evidence` (rơi ra khỏi đường găng nếu O5 giữ mặc định).

---

## 3. Ba việc tay của owner — làm cùng lần ngồi ở §2

1. **`git push origin main`** — `620b2bd` đang chưa push (VM Cowork proxy 403, không tự push được). Sau đó đọc GitHub Actions runs.
2. **Re-pin canonical runner** trên máy có Postgres: `DATABASE_URL_TEST=postgres://plexco:plexco_dev@localhost:5432/plexco_test pnpm test`, rồi dán output vào lane W0-2. Đây là **thứ duy nhất gỡ được nhãn `STALE`** ở trục Tests (authority vẫn kẹt ở `854 + 30 @ 93f1e93`, 15/08).
3. **Dọn `_to_delete/`** (~12 file lock + 2 lock dir từ các phiên VM trước) — VM không `rm` được.

---

## 4. Thứ tự chạy — xếp theo mật độ Tier C, không theo kích thước

> Sau khi §2 được chốt và mint thành DD, mật độ Tier C của các lane dưới đây **≈ 0**. Đó là lý do chúng chạy liên tục được.

| Wave | Lane | Tier C còn lại sau §2 | Mở khoá cái gì |
|---|---|---|---|
| **W0** | W0-1 mint DD từ §2 · W0-2 re-pin runner + refresh BUILD-STATUS/ROADMAP số · W0-3 kit sync `DYNAMIC_SEGMENT` + `e2e.sh` (land cùng nhau hoặc không land) | 0 | Mọi verdict dựa trên số test; gate validator ở consumer |
| **W1** | **`capability-wiring-auto-reconcile`** — caller production đầu tiên của `resolveCapability()` (DD-114 D2.3) | 0 *(DD-29 + DD-114 đã name)* | **Hard-dep (a) của phase-1.** Root chưa xây thấp nhất; vế tiền chưa gate được thật cho tới khi có nó |
| **W1** | **`session-routes-close-cancel`** — 2 route còn thiếu, cùng khuôn `session-command-route.ts` đã có | 0 | Mặt API đủ cho session management (khối 3 của launch) |
| **W2** | **`zalo-tenant-routing-core`** — link club ⇄ Zalo bot | 1 → 0 sau O4 | **Khối 2 của launch, và là khe hở BE lớn nhất còn lại.** Thiếu nó thì PWA và bot là hai sản phẩm rời |
| **W2** | `dd118-runwithlang-coverage` — phủ nốt ngoài đường session-command | 0 | Khối 5 (settings) |
| **W2** | `zalo-bots-secret-trace` (read-only, ra đề xuất cơ chế cho owner) | 0 | Chuẩn bị O4 vòng 2 |
| **W3** | **FE lane, chỉ mở sau O1** — app shell → signin → session list → session detail → settings | 0 sau O1 | **Cả 5 khối launch.** Đây là nơi thanh % thực sự nhúc nhích |
| **W4** | `session-routes-announce` (dark, sau flag) · job scheduler + consumer safety contract | 1 *(bật schedule = O3 vòng 2)* | Nhắc nợ / confirm / gạch nợ (khối 6 của phase-1) |
| **W5** | Dọn kit/process backlog (`gates-that-fire-correctly-and-cannot-say-why`, `breaker-counts-infra-flakes-as-fix-rounds`, `local-dev-sanctioned-paths…`, `reconcile-hand-closed-entries…`) | 0 | Không mở khoá launch — **chỉ chạy khi W1–W4 không có lane nào chờ** |

**Không nằm trong chương trình này** (theo O8): chat service · discovery · projector · feed/kudos · tournament/club · native · fill-slot · web push.

---

## 5. Payload — dán khối này vào Claude Code

> Prose ở trên là để bạn quyết. Khối dưới là để agent thực thi, và theo luật ngôn ngữ của repo nó là **English**.

```text
ROLE: primary agent, Plexco completion program
WORKFLOW_LEVEL: 3
WORKFLOW_MODE: supervised_autonomy
AUTONOMY_MODE: autonomous_to_ready
DEFAULT_STOP_MODE: STOP_AT_READY
AUTO_MERGE: off
BASE: main @ 620b2bd1bd13b6cf990cb3d839991ebd518fbf31 (re-pin to current origin/main before any lane)

OUTCOME
  Ship the DD-113 launch scope: signin/signup, link Zalo bot, session management,
  session detail, settings. Everything else is out of scope for this program.
  Draining the backlog is NOT the outcome. A backlog row that does not serve the
  launch scope is deferred by default, not worked.

ALWAYS LOAD BEFORE ANY DECISION (non-negotiable, small enough to fit)
  - docs/00-start-here/HANDOFF.md, live-truth block only
  - docs/standards/decisions.md, the "| DD-nn |" summary table only (not full bodies)
  - docs/standards/review-code-readiness-gate.md
  - docs/autopilot-templates/level3-workflow.md sections 7, 8, 9; docs/standards/plexco-level3-autonomy.md section 6.1
  - docs/product/ROADMAP.md block dated 2026-09-02, and this RUN document
  - the lane's own packet and manifest
  Do not attempt to load the whole docs/ corpus. It is ~2M tokens. Coverage is
  guaranteed by search-and-log, not by loading.

DECISION AUTHORITY
  Apply the Tier A/B/C ladder in plexco-level3-autonomy.md section 6.1 verbatim.
  Apply the demotion rule: a change that a decision record explicitly authorizes
  BY NAME is Tier A, not Tier C. The owner decision sheet in section 2 of this
  document is minted into decisions.md by lane W0-1. After W0-1 lands, executing
  any of O1..O9 is Tier A. Do not re-ask a question O1..O9 already answered.
  Stopping on a Tier A item is itself a defect: record it in the ledger as one.
  Tier C remains exactly the 8-item list in section 6.1. Nothing is removed from it.
  Every Tier A and Tier B decision gets a Decision Ledger entry at
  .autopilot/state/<feature>/DECISIONS.md, appended as decided, never reconstructed
  at the end. The "Searched:" field is mandatory, including queries that returned
  nothing. Before trusting a null grep result, verify the query finds a
  known-present control case.

LANE SELECTION
  Rank candidate lanes by Tier C density ascending, not by size. Follow the wave
  order in section 4 of this document. Within a wave, run only lanes whose scope
  paths and invariant domains are disjoint; serialize everything that shares a
  migration tail, generated artifact, or shared-core file.
  One writing slice = one branch + one worktree + at most one live writer.
  Register runtime scope before writing:
    scripts/autopilot-scope-gate register --manifest .autopilot/state/<feature>/manifest.json
  The manifest passed to register is the RUNTIME manifest carrying
  manifest_schema_version: level3-operational-v2, hand-written from
  docs/autopilot-manifests/_TEMPLATE.json. Never pass the authored contract path.
  After every register, verify .autopilot/state/<feature>/registered-manifest.sha256
  exists before doing anything else. Do not trust the word "registered".

VERIFICATION AND REVIEW
  Verify with the repository's real commands, not prose: pnpm test with
  DATABASE_URL_TEST, build, lint, typecheck, and e2e when a real boundary is
  crossed. Then run the mandatory independent review via
  scripts/codex-review-pin.sh. Any lane touching auth, secrets, permissions,
  money, external input, or deployment runs one additional security round.
  If the reviewer cannot be reached, wait and retry with backoff first; an
  account-wide saturation is a WAIT. If it is genuinely unavailable,
  HALT TOOL_UNAVAILABLE. Never self-certify and never lower the gate.
  Every persisted readiness artifact must carry REVIEW_POLICY_VERSION and
  CLOSURE_MATRIX and must pass: node scripts/check-review-readiness.mjs --changed
  A red validator is a hard stop.

HARD CONSTRAINTS THAT NO LANE MAY CROSS
  - The 5 HARD RULES in CLAUDE.md: RLS fail-closed, no money/PII in public read
    paths, no multi-master, money-bearing claims need a strong lock, i18n as
    literal t("vi", "en") string pairs (this repo has no key-based i18n).
  - Never re-grant role app base SELECT on public_sessions. Migrations 0033 and
    0036 closed that hole in two steps. A future projector goes through a definer
    function or its own writer role.
  - The outbox does NOT guarantee per-aggregate ordering (0023:176-208). Every
    consumer must be order-independent with a monotonic guard.
  - Do not enable OUTBOX_DISPATCH_SCHEDULE_ENABLED or GOOGLE_OAUTH_* . Both are
    Tier C enablement reserved to the owner (O3, O6).
  - Do not git add design.pen or fe.pen until lane W0-1 has landed the O1 decision
    naming which one is canonical.
  - Do not widen beyond declared negative scope. Re-slice or AWAIT instead.

TERMINAL STATES
  READY  = exact diff + gates run directly + clean independent review + the
           Decision Ledger. Report outcome, evidence and ledger together.
  AWAIT  = restricted to the Tier C list. Exactly one missing decision, with one
           recommended option and a binary resume condition. Park that lane and
           CONTINUE OTHER ROOTS; do not idle the program on one AWAIT.
  HALT   = hard breaker only: MAX_ROUNDS above 5, or REGION_THRASH on the same
           region 3 rounds running.

REPORTING CADENCE
  Report to the owner only at these moments: (a) each lane reaching READY,
  batched where several land close together; (b) an AWAIT, with the one question;
  (c) a HALT. Do not report progress between these points.

ENVIRONMENT NOTE
  If running through the Cowork device bridge: the VM cannot push (proxy 403) and
  cannot delete files. Commits to main need the root lock
  (bash scripts/autopilot-root-lock acquire --owner <name> plus
  PLEXCO_COMMIT_OWNER in the same shell) and explicit paths. Release the lock by
  moving it into _to_delete/, since unlink is denied. Move orphaned git lock files
  into _to_delete/ before the next git command. Push is the owner's action.
  pnpm is absent in that VM: run the validator as
  node scripts/check-review-readiness.mjs --changed
  and treat the canonical runner as unavailable there.

FIRST STEP
  Lane W0-1: mint decisions O1..O9 from section 2 of this document into
  docs/standards/decisions.md as numbered DDs (next free number after DD-118),
  each with its rationale and its self-invalidation trigger. Mirror the version
  bump into ROADMAP appendix A. This lane writes no code and unlocks every
  lane after it, because after it lands those decisions are Tier A.
```

---

## 6. Điều kiện dừng của cả chương trình

Chương trình này kết thúc khi **một trong hai** điều sau đúng:

1. **Đạt:** 5 khối launch của DD-113 đều có màn FE gọi API thật, chạy được E2E trên staging, và ba
   enablement còn lại (O3 schedule · O6 Google · A3 legal) là ba quyết định owner rời rạc đã nằm sẵn trên bàn.
2. **Không đạt được nữa:** O1 không được chốt. Khi đó nói thẳng ra rằng chương trình đã chạm trần BE-only,
   **đừng chạy tiếp lane BE để lấp chỗ** — làm thế chỉ nới rộng khoảng cách BE/FE mà thanh % đang đo.

> **Một điều đáng nói thẳng:** repo này có kỷ luật đo lường tốt hơn hầu hết codebase — luật "trục yếu nhất
> thắng" là thứ đã giữ thanh % ở ~33% suốt trong khi BE đi từ 0 lên 6 command và 13 route. Đó là điểm mạnh,
> không phải điểm yếu. Nhưng nó cũng nói đúng một điều: **thứ đang chặn không phải năng lực BE, và thêm BE
> không mua được gì.** O1 là bản lề.
