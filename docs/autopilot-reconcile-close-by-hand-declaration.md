<!-- review-readiness: code-ready -->

# Autopilot task contract — `reconcile-close-by-hand-declaration`

> **Đây là coding handoff.** Verdict canonical nằm ở cuối file. Slice được author TRƯỚC verdict (gate
> §11.2 cấm verdict một slice chưa tồn tại), rồi verdict pin đúng commit chứa nó — `AUTHORITY_SHA` dưới
> là commit `28e4e5a` đã land ba artifact này (doc, manifest, backlog entry), không phải một nhãn
> version di động.

---

## Vì sao có file này

Backlog đã mở `## task: reconcile-close-by-hand-declaration` ngày 30/07 (xem
`docs/autopilot-backlog.md`), với `scope`, `merged_probe` và phần `notes` mô tả đầy đủ vấn đề. File
này KHÔNG lặp lại phần đó — nó biến mô tả thành contract có thể mở worktree.

**Vấn đề đo được, không phải giả định.** `scripts/autopilot-backlog-reconcile` (KIT_VERSION 4) coi
mọi `merged_probe` không phải identifier-shaped là lỗi tác giả: nó in

```
✗ WEAK-PROBE: <slug> (<status>) — probe '<regex>' matched but is NOT a slice-unique symbol
     (shared literal → collides with unrelated origin/<default> content). REFUSING to auto-flip;
     replace merged_probe with a code symbol this slice introduces.
```

Lời khuyên "thay bằng code symbol" đúng cho hầu hết slice — nhưng **bất khả thi** cho ba lớp mà chính
backlog đã tự đặt tên:

| Lớp | Vì sao không có probe identifier-shaped nào tồn tại |
|---|---|
| `dependency-security` | Bump lockfile không tạo symbol nào; `pnpm-lock.yaml` chỉ có version + path, và version là literal dùng chung (có thể trùng nội dung không liên quan đã có sẵn trên `origin/main` trước khi slice merge) |
| `owner-evidence-gate` | Đóng bằng bằng chứng (đo trên thiết bị thật, support ticket, due-diligence), không bằng commit — không có gì để probe |
| `docs-reconcile` | Token đều có gạch nối (`docs-session-...`) nên trượt thẳng `is_symbol_probe` (regex đòi `^[A-Za-z_][A-Za-z0-9_]*$`, không cho `-`) |

**Trigger cụ thể, đo 2026-07-30:** `deps-security-bump` merged tại `61a2575` (chỉ `next` land), đóng
TAY vì `autopilot-backlog-reconcile --fix` từ chối flip: `probe '15.5.21' matched but is NOT a
slice-unique symbol`. Backlog đã ghi `close_by: hand · <lý do>` trên block đó (dòng 485) làm khai báo
tường minh — nhưng **script không đọc trường này**, nó chỉ tồn tại như prose. `ap-merge.sh` bước 8b
(chạy `--fix` tự động sau mỗi push kể từ 2026-07-29) sẽ mãi mãi in `WEAK-PROBE` cho lớp task này,
đọc như lỗi tác giả cần sửa trong khi không có gì để sửa.

**Đề xuất, đã có trong backlog notes:** dạy script hiểu `close_by: hand · <reason>` là một khai báo
có chủ đích. Khi có nó, `--check`/`--fix` báo `⊘ manual-close: <slug>` thay vì `✗ WEAK-PROBE`, và
**không bao giờ tự flip** (con người vẫn phải xác nhận rồi đổi `status: merged` bằng tay — đó chính là
điểm của trường này). `--audit` vẫn phải kêu nếu một task khai `close_by: hand` mà `scope` của nó **có**
file mã nguồn thật — đó mới là lười thật, không phải một lớp không thể probe.

---

## Phát hiện thêm khi author (KHÔNG có trong backlog notes gốc)

**`scripts/autopilot-backlog-reconcile` là file KIT CANONICAL, không phải tooling riêng của Plexco.**
Đo 2026-07-30: `diff` với `$HOME/Projects/Claude template/autopilot/parallel/autopilot-backlog-reconcile`
→ exit 0 (byte-identical), cả hai cùng `# KIT_VERSION: 4`. Git log của chính file này trong repo Plexco
xác nhận nó luôn được **sync**, chưa từng hand-author độc lập: `1e503d1` "sync backlog-reconcile
KIT_VERSION 3 từ canonical", `54de276` "sync kit to canonical v0.6.0 / backlog-reconcile KIT_VERSION 2".

Hệ quả trực tiếp cho slice này: theo invariant chuẩn của founder — *"Shared KIT fixes land
canonical-first and sync consumers direction-aware. Never hand-fix only a copy or downgrade a newer
consumer"* — implementation THẬT của `close_by: hand` phải land ở **file canonical trước** (một repo
Git khác hẳn, `$HOME/Projects/Claude template`, nằm ngoài worktree/scope-gate/branch của slice này
hoàn toàn — repo đó có quy trình commit riêng, không phải Level 3 gate của Plexco), bump
`# KIT_VERSION:` của nó 4→5, RỒI mới sync xuống bản Plexco. Diff thật của worktree Plexco cho slice
này là bước sync-down đó — không phải một bản vá độc lập rời khỏi canonical.

**Không có lưới an toàn tự động bắt lệch bản.** `~/.claude/hooks/autopilot-sync.cjs` (SessionStart
hook) chỉ quản lý `scripts/autopilot-scope-gate` (auto-overwrite version-aware) và cảnh báo drift cho
`docs/autopilot-parallel-scope-gate.md`/`_TEMPLATE.json`. Nó **không nhắc đến** `autopilot-backlog-reconcile`
ở bất kỳ dòng nào. Nếu một implementer tương lai sửa thẳng bản Plexco mà bỏ qua bước canonical-first,
không có cơ chế nào tự phát hiện — điều duy nhất giữ kỷ luật này là ghi rõ ở đây và ở acceptance RCH-12.

---

## §3 Task contract

```text
TASK_ID: reconcile-close-by-hand-declaration
OUTCOME: dạy scripts/autopilot-backlog-reconcile nhận diện khai báo `close_by: hand · <reason>` trên
  một task block là tuyên bố có chủ đích — "lớp task này không thể có merged_probe phân biệt được" —
  và báo cáo nó bằng nhãn riêng `⊘ manual-close` thay vì `✗ WEAK-PROBE`, đồng thời VẪN từ chối tự flip
  (con người luôn phải xác nhận), và VẪN bắt được trường hợp lạm dụng (khai close_by:hand mà scope có
  file mã nguồn thật).
REPOSITORY_AND_BASE: Plexco app · base `main` · PIN SHA lúc mở worktree (đo lại, đừng chép số ở đây)
CONTEXT_SOURCES:
  - scripts/autopilot-backlog-reconcile (đọc toàn bộ 30/07, KIT_VERSION 4)
  - docs/autopilot-backlog.md — block `reconcile-close-by-hand-declaration` (nguồn yêu cầu) và block
    `deps-security-bump` (ví dụ sống đã merge, dòng 485, tiền lệ cú pháp `close_by: hand · <reason>`)
  - $HOME/Projects/Claude template/autopilot/parallel/autopilot-backlog-reconcile (nguồn canonical;
    verify byte-identical 30/07)
  - docs/standards/review-code-readiness-gate.md (gate canonical)
APPLICABLE_SKILLS: none — bash text-processing thuần, không skill nào áp dụng.
SCOPE: scripts/autopilot-backlog-reconcile · docs/autopilot-manifests/reconcile-close-by-hand-declaration.json
  · docs/autopilot-reconcile-close-by-hand-declaration.md
NEGATIVE_SCOPE:
  - KHÔNG sửa scripts/autopilot-scope-gate hay bất kỳ file kit nào khác — đúng một script.
  - KHÔNG nới DISCRIMINATOR RULE cho task KHÔNG khai `close_by: hand` — yêu cầu identifier-shaped
    symbol giữ nguyên; đây là escape hatch cộng thêm cho ba lớp đã đặt tên, không phải nới luật chung.
  - KHÔNG làm `close_by:` thành enum tổng quát — chỉ nhận literal `hand`; giá trị thứ hai (nếu cần) là
    quyết định riêng sau này.
  - KHÔNG bao giờ để `--fix` tự flip một task `close_by: hand`, bất kể probe của nó có match hay có
    identifier-shaped hay không — mục đích của trường này chính là bắt buộc con người xác nhận.
  - KHÔNG hand-patch bản Plexco độc lập với canonical — xem "Phát hiện thêm khi author" ở trên.
    Implementer không được coi `scripts/autopilot-backlog-reconcile` là file "của riêng" slice này.
  - KHÔNG backfill `close_by: hand` ngược vào block `deps-security-bump` đã `status: merged` — nó
    không còn được scan (awk chỉ emit `planned|ready|blocked`); có thể thêm cho rõ nhưng không bắt buộc.
  - KHÔNG chạm packages/db/src hay bất kỳ module nào ngoài ba file trong SCOPE.
RISK: P3 — tooling nội bộ cho chính quy trình autopilot, không chạm production code, schema, auth hay
  tiền; scope là một script bash cục bộ + doc/manifest của chính nó.
AUTONOMY_MODE: supervised
MODEL_POLICY: code gate = scripts/codex-review-pin.sh, 1 vòng sạch (tier tooling — không phải
  money/logic P1 nên không bắt buộc 2× liên tiếp). Reviewer không gọi được → HALT TOOL_UNAVAILABLE,
  cấm tự hạ gate.
SANDBOX_AND_PERMISSIONS: không network, không secret. CẦN quyền ghi vào repo anh em
  `$HOME/Projects/Claude template` (nằm NGOÀI worktree Plexco) — xem canonical-first ở trên. Một
  worktree sandbox chỉ mount repo Plexco sẽ không hoàn thành được bước canonical-first.
HUMAN_DECISIONS_REQUIRED: none — cú pháp `close_by: hand · <reason>` đã có tiền lệ sống (block
  `deps-security-bump`, dòng 485). Các lựa chọn còn lại (glyph nhãn, regex phân loại "file mã nguồn"
  cho abuse guard) là chi tiết implementation, đã pin sẵn trong Acceptance matrix dưới — không phải
  product/policy choice còn mở.
SLICE_GRAPH: một slice, không fan-out. Root dependency — không ai chờ nó, nó không chờ ai.
DEPENDENCIES: none (root)
INVARIANTS: [] — không domain token nào trong docs/autopilot-invariant-catalog.md áp dụng: không
  schema, không tenant-isolation, không money, không auth. Khai một token sẽ khoá lane không cần thiết.
VERIFICATION: xem Acceptance matrix dưới + manifest `verification` (khai bằng THUỘC TÍNH, không phải
  literal — runtime manifest bị hash-lock sau `register`).
CODE_REVIEW: bắt buộc, 1 vòng sạch.
SECURITY_REVIEW: KHÔNG bắt buộc. Lý do: không trust boundary — bash cục bộ đọc file markdown đã trust
  sẵn trong repo và git refs, không secret/network/auth/money/external input. **Vô hiệu nếu:**
  implementation hoá ra gọi ra ngoài git/awk/grep trên ref cục bộ, hoặc đọc/ghi ngoài
  docs/autopilot-backlog.md và hai file script/manifest trong scope — khi đó phải thêm 1 vòng security
  và ghi rõ vì sao phán đoán này sai.
BUDGETS: MAX_ROUNDS 5 · REGION_THRASH 3 cùng vùng ⇒ HALT. Ước lượng ≤250 LOC, 1–2 file thay đổi (script
  + có thể một fixture/self-test đi kèm), 0 migration.
STOP_CONDITIONS: STOP_AT_READY. HALT nếu (a) bản canonical và bản Plexco đã lệch nhau (`diff` khác
  rỗng) ngay tại thời điểm bắt đầu implement — verify lại trước khi sửa, đừng patch chồng lên một
  baseline đã lệch sẵn; (b) phát hiện một lớp thứ tư cần `close_by: hand` nhưng không khớp hình dạng
  `close_by: hand · <reason>` đã pin — đó là câu hỏi owner về hình dạng escape hatch, không phải lựa
  chọn implementation.
DELIVERABLES: diff đúng scope · file canonical sửa trước + bản Plexco sync sau (byte-identical, bằng
  chứng `diff`) · acceptance matrix chạy thật bằng fixture re-runnable (không chỉ narrate) · bằng
  chứng review sạch · READY report.
```

---

## Live-truth verification — đo 2026-07-30

| Tiền đề | Bằng chứng | Kết quả |
|---|---|---|
| `scripts/autopilot-backlog-reconcile` là file kit canonical | `diff` với `$HOME/Projects/Claude template/autopilot/parallel/autopilot-backlog-reconcile` → exit 0; cả hai `# KIT_VERSION: 4` | ✅ |
| `autopilot-sync.cjs` KHÔNG quản lý file này | grep toàn bộ hook: chỉ thấy `autopilot-scope-gate` + `parallel-scope-gate.md`/`_TEMPLATE.json` | ✅ (⚠️ không có lưới an toàn tự động) |
| Cú pháp `close_by: hand · <reason>` đã có tiền lệ sống | `docs/autopilot-backlog.md:485`, block `deps-security-bump`, tác giả 30/07 | ✅ |
| `--audit` hiện KHÔNG có nhánh code riêng biệt | đọc toàn bộ script: `MODE` chỉ rẽ nhánh tại `--check`/`--fix`; `--audit` rơi vào cùng đường với `report` mặc định (chỉ khác cách con người diễn giải output) | ✅ |
| Không có bash test harness nào trong repo hôm nay | `find . -iname "*.bats"` rỗng; `scripts/` không có `*.test.sh`; test harness JS duy nhất (`check-review-readiness.test.mjs`) thuộc một script Node khác | ✅ |
| Task tự nó có `merged_probe` hợp lệ | `scripts/autopilot-backlog-reconcile :: close_by` — `close_by` là bare identifier, qua được `is_symbol_probe`; không có nghịch lý con-gà-quả-trứng cho chính slice này | ✅ |

---

## Thiết kế đề xuất — hành vi chính xác

1. **Parse thêm một field mới per block:** `close_by:` — awk block hiện tại đã trích `slug`/`status`/
   `merged_probe` per `## task:`; thêm trích `close_by` theo cùng cơ chế. Cú pháp bắt buộc:
   `close_by: hand · <lý do một dòng>` (dấu phân cách là `·`, interpunct, đúng ký tự đã dùng sẵn ở
   dòng 485 và xuyên suốt style file backlog). Chỉ nhận literal `hand`.

2. **Phân loại lại, không phải thêm nhánh song song:** một task có `close_by: hand` hợp lệ (có lý do)
   sẽ **luôn** in `⊘ manual-close: <slug> (<status>) — <reason>`, bất kể trạng thái probe của nó là gì
   (pending / stale / weak / không có `merged_probe`). Khai báo thắng suy luận từ probe — không rẽ
   nhánh theo việc probe match hay không, vì rẽ nhánh theo state sẽ tự tạo lại đúng loại thrash mà
   trường này sinh ra để tránh.

3. **Không bao giờ vào `stale[]` hoặc `weak[]`.** Hệ quả: `--check` không bao giờ exit 1 chỉ vì một
   entry `close_by: hand` (đúng như `weak` hôm nay), và `--fix` không bao giờ đưa nó vào vòng lặp flip.

4. **Thiếu lý do = malformed, KHÔNG lặng lẽ chấp nhận.** `close_by: hand` không có gì sau dấu `·` (hoặc
   thiếu hẳn dấu phân cách) phải in một cảnh báo riêng, ví dụ `✗ MALFORMED close_by: <slug> —
   "close_by: hand" cần một lý do một dòng sau " · "`, rồi **rơi về đúng logic phân loại cũ**
   (stale/weak/no-probe/pending) như thể trường này không tồn tại. Đây là cách chặn cửa sau: viết
   `close_by: hand` trơn để né `WEAK-PROBE` mà không kèm lý do sẽ không có tác dụng gì.

5. **Abuse guard (đề xuất gốc từ backlog notes, `--audit` vẫn phải kêu):** nếu một task khai
   `close_by: hand` mà `scope:` của nó chứa ít nhất một file **có khả năng mang probe identifier-shaped**
   — mã nguồn ứng dụng dưới `packages/*/src/`, `apps/*/src/`, `scripts/*`, hoặc một migration `.sql`
   mới — in một cảnh báo to, riêng biệt với `⊘ manual-close`, tối thiểu ở chế độ `--audit`. **Cố ý
   loại trừ** file manifest/lockfile/workspace-config/doc (`package.json`, `pnpm-lock.yaml`,
   `pnpm-workspace.yaml`, `docs/autopilot-manifests/*.json`, `*.md`) khỏi định nghĩa "file mã nguồn" —
   nếu không, chính ví dụ hợp lệ đang là lý do tồn tại của slice này (`deps-security-bump`, scope gồm
   `package.json`/`pnpm-lock.yaml`/`pnpm-workspace.yaml`) sẽ bị false-flag bởi guard được viết ra để
   bắt lạm dụng.

Không cần state machine phức tạp hơn: 6 đường phân loại (pending / stale / weak / no-probe /
manual-close hợp lệ / malformed) cộng một guard độc lập là đủ cho phạm vi backlog notes đã mô tả.

---

## Acceptance matrix

| # | Nhóm | Input / precondition | Expected | Layer |
|---|---|---|---|---|
| RCH-1 | Happy | `close_by: hand · <lý do>`, probe hiện KHÔNG match trên `origin/<default>` | `⊘ manual-close: <slug>` (không phải dòng `✓ ... genuinely pending`); không vào `stale[]`/`weak[]` | script |
| RCH-2 | Happy | `close_by: hand · <lý do>`, probe MATCH nhưng KHÔNG identifier-shaped (hình dạng thật của `deps-security-bump` trước khi hand-flip) | `⊘ manual-close: <slug>`, KHÔNG `✗ WEAK-PROBE`; không vào `weak[]` | script |
| RCH-3 | Happy | `close_by: hand · <lý do>`, probe MATCH và tình cờ identifier-shaped | vẫn `⊘ manual-close: <slug>`; KHÔNG tự flip qua `--fix` (khai báo thắng suy luận) | script |
| RCH-4 | Boundary | `close_by: hand` không có lý do sau `·` (hoặc thiếu `·`) | `✗ MALFORMED close_by: <slug>` + rơi về đúng phân loại cũ (stale/weak/no-probe/pending) như không có field này | script |
| RCH-5 | Boundary | `close_by: hand · <lý do>` trên task KHÔNG có `merged_probe` nào | `⊘ manual-close: <slug>`, KHÔNG rơi vào dòng `?  no merged_probe` | script |
| RCH-6 | Abuse guard | `close_by: hand · <lý do>` + `scope` chứa file dưới `packages/*/src`, `apps/*/src`, `scripts/*`, hoặc `.sql` mới | cảnh báo to, tách biệt khỏi `⊘ manual-close`, xuất hiện tối thiểu ở `--audit` | script |
| RCH-7 | Abuse guard (negative) | `close_by: hand · <lý do>` + `scope` chỉ gồm `package.json`/`pnpm-lock.yaml`/`pnpm-workspace.yaml`/`docs/autopilot-manifests/*.json`/`*.md` (hình dạng `deps-security-bump`) | KHÔNG cảnh báo abuse | script |
| RCH-8 | Failure/idempotency | `--fix` chạy trên mọi precondition RCH-1..RCH-3 | dòng `status:` của task giữ byte-unchanged sau `--fix` | script |
| RCH-9 | Exit code | Bất kỳ số lượng entry `close_by: hand` hợp lệ nào | không tự gây `--check` exit 1; chỉ một `stale` thật (không phải close_by) mới gây exit 1 | script |
| RCH-10 | Regression | Mọi task block KHÔNG có field `close_by` | output y hệt hành vi hiện tại cho cả 4 nhóm cũ (pending/stale/weak/no-probe) và cả hai đường HALT (`DEFAULT_BRANCH_UNRESOLVED`, `DEFAULT_BRANCH_MISSING`) | script |
| RCH-11 | Migration | — | diff không có file `.sql` nào dưới `packages/db/migrations/`, không sửa `packages/db/schema.ts` | gate |
| RCH-12 | Kit sync | Sau implementation | `scripts/autopilot-backlog-reconcile` (Plexco) byte-identical với file canonical `$HOME/Projects/Claude template/autopilot/parallel/autopilot-backlog-reconcile`, cả hai cùng `# KIT_VERSION` đã bump | gate |

RCH-12 là hàng dễ bỏ sót nhất: một implementer chỉ nhìn `scope` trong manifest (chỉ liệt kê file
Plexco) có thể quên bước canonical-first hoàn toàn nếu không đọc phần "Phát hiện thêm khi author".

---

## Open questions trong scope

**0 câu hỏi chặn.** Cú pháp và ngữ nghĩa `close_by: hand` đã được backlog notes + tiền lệ sống
(`deps-security-bump` dòng 485) chốt đủ để implement. Hai điểm còn lại KHÔNG chặn vì đã pin bằng
acceptance row cụ thể, không phải product choice bỏ ngỏ:

| Điểm | Vì sao không chặn |
|---|---|
| Glyph/wording chính xác của cảnh báo `MALFORMED` (RCH-4) | Đã pin ví dụ text cụ thể ở "Thiết kế đề xuất" #4; implementer có thể diễn đạt lại miễn giữ đúng ngữ nghĩa (rơi về phân loại cũ, không lặng lẽ chấp nhận) |
| Vehicle cho regression coverage (script self-test riêng vs fixture inline) | Manifest `_verification_note` đã nói rõ: cả hai chấp nhận được, miễn mỗi acceptance row có một check chạy lại được thật, không chỉ narrate |

---

## Verdict

```text
REVIEW_POLICY_VERSION: 1.3
REVIEW_VERDICT: CODE_READY
REVIEWED_AT: 2026-07-30
AUTHORITY_SHA: 28e4e5a0845031d879ba5b4b6ee7093b804cc0ba
BASE_BRANCH: main
TARGET_FILES:
  - docs/autopilot-reconcile-close-by-hand-declaration.md
  - docs/autopilot-manifests/reconcile-close-by-hand-declaration.json
  - scripts/autopilot-backlog-reconcile
SLICE: reconcile-close-by-hand-declaration
IN_SCOPE: dạy scripts/autopilot-backlog-reconcile nhận diện close_by: hand · <reason> là khai báo có chủ đích; báo cáo ⊘ manual-close thay vì ✗ WEAK-PROBE; không bao giờ tự flip qua --fix; bắt lạm dụng khi scope có file mã nguồn thật
OUT_OF_SCOPE: scripts/autopilot-scope-gate · nới discriminator rule cho task không khai close_by · close_by: enum tổng quát · hand-patch bản Plexco độc lập với canonical · backfill deps-security-bump đã merged
G1_DECISION: PASS
G2_SPEC: PASS
G3_DEPENDENCY: PASS
G4_TEST: PASS
G5_SCOPE: PASS
G6_EXTERNAL: PASS
HARD_DEPENDENCIES: none — slice này là dependency gốc
PRIOR_SLICES: none
OPEN_QUESTIONS_IN_SCOPE: 0
ENABLEMENT_ONLY_GATES: none
LIVE_REPO_VERIFICATION: PASS
CONTRACT_MATRIX: PASS
CLOSURE_MATRIX: PASS (12/12)
ACCEPTANCE_MATRIX: PASS
SECURITY_AND_MIGRATION_GATE: PASS
IMPLEMENTATION_ARTIFACTS: PASS
FIRST_IMPLEMENTATION_STEP: land the close_by: hand parsing + ⊘ manual-close reporting change in the canonical template file first ($HOME/Projects/Claude template/autopilot/parallel/autopilot-backlog-reconcile), bump its `# KIT_VERSION:` header 4→5, verify against fixtures for RCH-1..RCH-5, then sync the byte-identical file into scripts/autopilot-backlog-reconcile before touching the abuse guard (RCH-6/RCH-7)
REMAINING_BLOCKERS: none
```

### Closure matrix

| # | Gate | Bằng chứng | |
|---|---|---|---|
| 1 | Authority pin theo SHA | `28e4e5a` + `TARGET_FILES` liệt kê exact, không glob | PASS |
| 2 | Decision trong scope đã chốt | cú pháp `close_by: hand · <reason>` đã có tiền lệ sống (`deps-security-bump` dòng 485, tác giả 30/07); không còn product choice mở | PASS |
| 3 | Scope IN/OUT và owner rõ | manifest `scope` 3 file exact + `negative_scope` 8 mục | PASS |
| 4 | Dependency phân loại đủ | none — root dependency, không đọc/gọi bảng, service hay API nào | PASS |
| 5 | Live schema khớp doc | script đọc trực tiếp 30/07 (KIT_VERSION 4); canonical-kit sync verify byte-identical bằng `diff` | PASS |
| 6 | Data/auth contract đủ | N/A cho auth/data — phần tương đương (field-syntax `close_by: hand · <reason>`, phân cách `·`, chỉ nhận literal `hand`) đã pin trong §3 và "Thiết kế đề xuất" | PASS |
| 7 | Fail-closed/order đủ | RCH-4: thiếu lý do → rơi về đúng discriminator rule cũ, không lặng lẽ chấp nhận; RCH-3: khai báo luôn thắng suy luận từ probe, không rẽ nhánh theo state | PASS |
| 8 | Open question trong scope | 0 — hai điểm còn lại (glyph, vehicle test) đã pin bằng acceptance row, không phải product choice | PASS |
| 9 | Acceptance matrix có expected | 12 hàng `RCH-1`..`RCH-12`, mỗi hàng có input · precondition · expected · layer | PASS |
| 10 | Migration/security/rollback pin | 0 migration (`RCH-11`) · security round không bắt buộc, có lý do + void condition · rollback = revert thuần, chưa có consumer nào phụ thuộc hành vi mới | PASS |
| 11 | First slice hard deps merged | root, không có gì phải chờ | PASS |
| 12 | Implementation handoff sẵn sàng | slice doc + manifest + backlog entry (`manifest:`/`slice_doc:` field, `28e4e5a`) + launcher `ap-41` | PASS |

**Verdict này KHÔNG chứng minh** implementation đã tồn tại — `CODE_READY` nghĩa là mở worktree được,
không phải `IMPLEMENTED`. Nó cũng không chứng minh canonical template đã được sửa; đó là bước đầu tiên
của coding session, ghi rõ ở `FIRST_IMPLEMENTATION_STEP`.

---

## Changelog

| Ngày | Version | Thay đổi |
|---|---|---|
| 30/07/2026 | v0.2 | **Verdict CODE_READY**, `AUTHORITY_SHA 28e4e5a0845031d879ba5b4b6ee7093b804cc0ba`, closure 12/12. Thêm `<!-- review-readiness: code-ready -->` + đổi tiêu đề từ "Slice contract" sang "Autopilot task contract". Tracker entry mirror ở `docs/slice-readiness-verdicts.md`; backlog flip `status: ready` + `launcher: .claude/commands/ap-41-reconcile-close-by-hand-declaration.md`. |
| 30/07/2026 | v0.1 | Author slice contract từ backlog task đã mở cùng ngày. Phát hiện thêm ngoài backlog notes gốc: `scripts/autopilot-backlog-reconcile` là file kit canonical (verify byte-identical với `$HOME/Projects/Claude template/autopilot/parallel/autopilot-backlog-reconcile`, cả hai KIT_VERSION 4), không được `autopilot-sync.cjs` quản lý — bắt buộc bước canonical-first trước khi sync xuống Plexco, ghi thành NEGATIVE_SCOPE + RCH-12. Acceptance matrix RCH-1..RCH-12 pin đủ 6 đường phân loại + abuse guard + regression + kit-sync.
