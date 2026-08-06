<!-- workflow-authority: none -->
<!-- classification: discussion-draft. KHÔNG phải review/readiness artifact, KHÔNG authorize coding.
     Không mang canonical verdict block; không thay thế docs/standards/review-code-readiness-gate.md.
     Muốn thi hành bất kỳ mục nào bên dưới → mở slice riêng và đi qua gate đó. -->

# Level 3.1 — hợp nhất ưu điểm GENERIC v0.6.0 vào Level 3

> **Target:** canonical kit `$HOME/Projects/Claude template/autopilot/`. Plexco là consumer, sync sau.
> Bản draft này nằm trong Plexco chỉ vì đây là nơi phiên thảo luận diễn ra.
>
> **Trạng thái:** non-authorizing discussion snapshot. Mọi tên trường/con số là đề xuất; trước mỗi lần dùng phải đo lại canonical main bằng command ở §0.

## 0. Authority snapshot — bốn tầng, không trộn

Vòng 1 của doc này trộn ba trạng thái làm một và gọi chung là "hôm nay". Tách rõ:

| Tag | Tầng | Nội dung | Kiểm chứng tại snapshot |
|---|---|---|---|
| **[A]** | Historical comparison | `1747b8c` (Level 3 land) vs `1747b8c^` (GENERIC v0.6.0) | Historical input retained for discussion only |
| **[B]** | Committed canonical snapshot | `86fafd5d06aa3b162da09a74c676e50915b88e62`, KIT_VERSION 25 | Verified 2026-07-31: canonical `HEAD == origin/main`; not a promise of future current authority |
| **[C]** | Plexco consumer snapshot | `0c5808fc7cf50d139bdd9c4ee79917bf4059c4f4`, KIT_VERSION 25 | Verified 2026-07-31: Plexco `HEAD == origin/main` and scope-gate version 25 |
| **[D]** | Uncommitted evidence | Any working-tree-only canonical change | Excluded from authority and from proposal evidence |

**Quy tắc đọc doc này:** mọi claim bên dưới gắn tag. **[B] và [C] là immutable snapshot ngày
2026-07-31**, không phải alias cho "current". Trước khi dựa vào proposal, chạy:

```bash
CANONICAL_ROOT="$HOME/Projects/Claude template"
PLEXCO_ROOT="$HOME/Projects/Plexco app"

git -C "$CANONICAL_ROOT" fetch origin
git -C "$PLEXCO_ROOT" fetch origin

git -C "$CANONICAL_ROOT" rev-parse HEAD origin/main
git -C "$PLEXCO_ROOT" rev-parse HEAD origin/main

# Exclude WIP on the exact authority paths before reading evidence.
git -C "$CANONICAL_ROOT" diff --quiet HEAD -- autopilot
git -C "$CANONICAL_ROOT" diff --cached --quiet -- autopilot
test -z "$(git -C "$CANONICAL_ROOT" ls-files --others --exclude-standard -- autopilot)"

git -C "$PLEXCO_ROOT" diff --quiet HEAD -- \
  scripts/autopilot-scope-gate \
  scripts/autopilot-review-readiness.mjs \
  scripts/codex-review-pin.sh \
  docs/autopilot-templates/level3-workflow.md
git -C "$PLEXCO_ROOT" diff --cached --quiet -- \
  scripts/autopilot-scope-gate \
  scripts/autopilot-review-readiness.mjs \
  scripts/codex-review-pin.sh \
  docs/autopilot-templates/level3-workflow.md

# Read committed objects, never working-tree copies.
git -C "$CANONICAL_ROOT" show HEAD:autopilot/parallel/autopilot-scope-gate |
  awk '/^# KIT_VERSION:/{print $3; exit}'
git -C "$PLEXCO_ROOT" show HEAD:scripts/autopilot-scope-gate |
  awk '/^# KIT_VERSION:/{print $3; exit}'
```

Nếu một HEAD khác origin, authority-path check không sạch, KIT version khác, hoặc kết quả khác
**[B]/[C]**, re-audit blast radius liên quan và cập nhật snapshot; không carry verdict hay gap list
cũ theo quán tính. Doc này **không** đề xuất gì dựa trên **[D]**.

---

## 1. Luận điểm trung tâm

Hai workflow không thắng ở cùng một chỗ, nên **không loại trừ nhau**:

- **Level 3 thắng ở cổng RA.** `ready` là máy: validator tự chạy `verification.*`, tự gọi reviewer
  wrapper, tự sinh `gate-attempt-*`, bind HEAD/base/diff, 30 HALT code. **[C]**
- **GENERIC v0.6.0 thắng ở cổng VÀO.** Breaker 23–26 (`SECOND_SOURCE`, `TABLE_GAP`,
  `STATE_CONSERVATION`, `DESIGN_PROBE_REQUIRED`), `TDD_ORACLE_VIOLATED`, `DESIGN_UNFIT` bắn **trước
  Step 1** — chặn thiết kế sai *trước khi* nó thành 5 vòng codex. **[A]**

Ở snapshot **[C]**, cổng vào chỉ còn văn xuôi trong `autopilot-invariants.md`. Đó là bẫy **"khai báo
không phải phép đo"**: một bullet trong file @import không phải gate, nó là hy vọng agent còn nhớ.

**Nguyên tắc đề xuất cho 3.1:**

> Mọi quy tắc còn sống bằng văn xuôi hoặc chuyển thành **một trường kiểm được ở `register`-time**,
> hoặc bị xoá khỏi kit.

`register` là chỗ đúng cho lớp luật này, không phải `ready` — bắt `TABLE_GAP` ở `ready` là bắt sau
khi đã trả tiền cho toàn bộ vòng đời slice.

---

## 2. Evidence inventory tại immutable snapshots **[B]/[C]**

| Quy tắc | v0.6.0 **[A]** | Evidence tại Plexco snapshot **[C]** | Ghi chú thảo luận |
|---|---|---|---|
| Empty diff / base drift / manifest drift | prose + bash dán tay | HALT code trong validator | Mechanized at this snapshot |
| MAX_ROUNDS / REGION_THRASH | counter file + prose | validator đọc `regions.log` + counter | Mechanized at this snapshot |
| Dependency landing proof | không có | `dep_checks` bắt buộc 1-1 với `depends_on` | Stronger than historical input |
| Reviewer env drift | env tuỳ launcher | final gate scrub reviewer env overrides | Mechanized; see P5 |
| MCP connector noise (rmcp) | bash triage | `mcp_servers={}` trong wrapper | Connector layer only |
| Auth / quota / model entitlement | triage bằng bash | 400 entitlement classification gap recorded in canonical workflow | Proposed Phase 0 input |
| `DESIGN_PROBE_REQUIRED` | STOP gate trước Step 1 | prose, no register-time field found | Proposed measurement gap |
| `SECOND_SOURCE` / `TABLE_GAP` / `STATE_CONSERVATION` | breaker 23–25 | prose, no register-time field found | Proposed measurement gap |
| `TDD_ORACLE_VIOLATED` / `DESIGN_UNFIT` / `CONTEXT_BUDGET_70` | breaker | not uniformly enforced by register-time validator | Proposed measurement gap |
| Maturity ledger / change-class | file + ngưỡng ≥3 | template/reference exists; durable writer not demonstrated | P2 feasibility question |
| Lối nhẹ cho task nhỏ | `Codex review: not_applicable` | review remains required for registered writing slices | P3 trade-off question |
| Kit self-test | không cần | current kit includes operational tests; negative-branch coverage remains P4 audit subject | Do not infer PASS/FAIL from this row |

### Đính chính vòng 1 — auth **không** được "xoá tận gốc"

Vòng 1 nhầm **tắt MCP connector** với **auth / quota / model entitlement**. Hai chuyện khác nhau:
`mcp_servers={}` xoá lớp nhiễu `rmcp::transport::worker`, **không** đụng tới token, quota hay quyền
dùng model. Bằng chứng: AP39 vẫn gặp **400 model entitlement** **[B]**. Canonical workflow hiện ghi
ba gap đo được **[B]**:

1. **reviewer không nhận scope** — round chạy nhưng không bind đúng phạm vi cần review;
2. **auth-tier bị phân loại sai** — lỗi entitlement/tier bị xếp nhầm nhóm, dẫn tới xử lý sai;
3. **infra flake ăn `fix_rounds` budget** — lỗi hạ tầng tiêu round như thể là finding thật, đẩy slice
   tới `MAX_ROUNDS` oan.

Ba gap này thành **Phase 0**, đứng trước mọi đề xuất khác.

---

## 3. Phase 0 — đóng ba gap đo được trước khi thêm gate mới

**Lý do đi trước:** P1/P2/P3 đều thêm code vào gate. Thêm gate lên một reviewer path còn ba gap là
xây trên nền chưa phẳng, và gap 3 (infra flake ăn budget) làm hỏng chính tín hiệu `MAX_ROUNDS` mà
P1 dựa vào để biện minh.

| Gap | Yêu cầu tối thiểu | Regression fixture |
|---|---|---|
| Reviewer không nhận scope | wrapper/validator assert phạm vi đã truyền == diff đã bind | fixture: scope rỗng/sai → exit ≠ 0, HALT token cố định |
| Auth-tier phân loại sai | phân biệt **entitlement (400)** / **quota** / **auth-death** / **transient connector**, mỗi loại một HALT token riêng | fixture cho từng nhánh, assert **exact token** |
| Infra flake ăn budget | lỗi hạ tầng **không** increment `fix-round-count` | fixture: flake giả → counter không đổi + positive control (finding thật → counter +1) |

Không có Phase 0 thì P4 cũng chỉ khoá được một reviewer path đang sai.

---

## 4. Sáu đề xuất

Mỗi mục: **vấn đề → đề xuất → phép đo → phương án thay thế và cái giá**.

### P1 — Cổng vào: `design_contract`, đi bằng **schema mới**, forward-only

**Vấn đề.** Bốn breaker đắt nhất của bản cũ giờ là lời khuyên **[C]**.

**Sai của vòng 1.** Vòng 1 viết "mọi manifest hiện có phải bổ sung" — **vi phạm forward-only**.
Runtime manifest bị **hash-lock sau `register`** (`MANIFEST_DRIFT` **[C]**); AP39 đã phải **đóng
lifecycle và đăng ký successor** khi contract đổi **[B]**. Thêm trường vào một manifest v2 đang
active = ép HALT, không phải nâng cấp.

**Đề xuất đã sửa:**

- `design_contract` chỉ tồn tại trong **`manifest_schema_version: level3-operational-v3`**.
- Validator hiện pin cứng chuỗi `level3-operational-v2` **[C]** (`autopilot-review-readiness.mjs`
  ~L273, `autopilot-scope-gate` L262/L319/L348) → v3 phải là **thay đổi phối hợp cả hai file**, chấp
  nhận cả v2 lẫn v3 trong một cửa sổ chuyển tiếp, `design_contract` **chỉ bắt buộc khi v3**.
- **Không retrofit** bất kỳ manifest v2 nào đang active. Task đang chạy sống hết vòng đời ở v2.
- **Không** thêm schema field vào authored manifest dưới `docs/autopilot-manifests/` — `_role` trong
  `_TEMPLATE.json` đã cảnh báo chính xác ca này **[C]**: thêm `manifest_schema_version` vào authored
  contract làm `register` HALT `CONTRACT_INVALID`.

Khối đề xuất (chỉ v3, runtime manifest):

```json
"design_contract": {
  "change_class": "docs|prompt|infra|product_code|nl_or_fuzzy|money_state|identity_permission",
  "design_probe": { "path": ".autopilot/state/<FEATURE_ID>/design-probe.md", "confirmed_by": "founder" },
  "decision_table": ".autopilot/state/<FEATURE_ID>/decision-table.md",
  "single_source": { "helper": "<symbol>|none", "reason": "<vì sao none là đúng>" },
  "fail_closed": true
}
```

**Phép đo tại `register`, fail-closed:**

| Điều kiện | Máy kiểm | HALT |
|---|---|---|
| `change_class = nl_or_fuzzy` | `design_probe.path` tồn tại, non-empty, có `MECHANISM:` và `FINITE_SET:`; `FINITE_SET` không khớp `/blocklist\|stopword\|denylist/i` | `DESIGN_PROBE_REQUIRED` |
| `change_class ∈ {money_state, identity_permission}` | `decision_table` tồn tại + non-empty; ép `security_review.required = true` (khai `false` = contract invalid) | `TABLE_GAP` / `CONTRACT_INVALID` |
| `single_source.helper = "none"` | `reason` non-empty | `SECOND_SOURCE` |
| `change_class ∈ {money_state, identity_permission}` | `fail_closed = true` | `STATE_CONSERVATION` / `CONTRACT_INVALID` |

**Giới hạn phải nói thẳng.** Gate kiểm **sự tồn tại và thời điểm**, không kiểm bảng quyết định có
*đúng* không. Nhưng advisor-topic-tfidf thất bại không vì bảng sai — mà vì **không ai viết bảng
trước khi code** **[A]**. Thời điểm là phần lớn giá trị.

**Phương án thay thế.** Giữ prose. Giá: tiếp tục cược vào trí nhớ agent ở đúng phút nó nóng lòng
viết code.

---

### P2 — Maturity ledger: cần **durability contract**, không chỉ một path

**Vấn đề, cụ thể hơn vòng 1.** Ledger **đã tồn tại và đã chết**: `.autopilot/maturity-ledger.md`
tracked qua exception ở `.gitignore` L55–57 **[C]**, comment ghi rõ mục đích là *"auto-merge
graduation"* — tức mục đích của v0.6.0, thứ Level 3 đã bỏ. Nội dung: 5 dòng, **tất cả count = 0**,
dặn *"never edit by hand to inflate"* nhưng **không có writer nào increment**. Một sổ không ai ghi.

**Sai của vòng 1.** Đề xuất `.autopilot/maturity-ledger.json` — path này bị `.gitignore` L56 loại
(`*.json` không nằm trong exception) **[C]**. Và nếu track nó, `ap-finish.sh` phải **mutate default
worktree sau merge** — thêm một writer vào root, đúng thứ workflow cấm.

**Đề xuất đã sửa — ledger phải kèm hợp đồng bền vững, không chỉ một tên file:**

| Yêu cầu | Nội dung |
|---|---|
| `routine_id` | Đơn vị tính là **routine cụ thể**, không phải `change_class`. "3 run cùng `change_class`" quá rộng để chứng minh một routine hẹp — ba slice `web-feature` khác nhau không chứng minh gì cho slice thứ tư |
| Risk | **Chỉ `risk = P2`**. Vòng 1 viết `risk ≤ P2` — mơ hồ (P3 không register được, xem P3) |
| Origin proof | Mỗi bản ghi bind `landed_sha` **đã verify trên origin**, không phải local tip |
| Durable append owner | Chỉ **một** thành phần được ghi, và nó **không** mutate default worktree. Ứng viên: ghi vào chính commit đang land (writer đã sở hữu tree đó), hoặc một store ngoài `.autopilot/`. Nếu không giải được điều này thì **P2 không khả thi** — nói thẳng còn hơn đề xuất một sổ không ai ghi được |
| Anti-replay | Bản ghi khoá theo `gate_result_sha256` + `landed_sha`; trùng = không tính |
| Staleness | Bản ghi hết hiệu lực sau N ngày **hoặc** sau khi routine đó đổi định nghĩa |

**Giữ nguyên khác biệt cố ý với v0.6.0:** ledger mở **proactive trigger**, **không** mở auto-merge.
Auto-merge tắt cứng. Comment `.gitignore` hiện tại nói ngược lại → phải sửa cùng lúc, kẻo lại là một
doc trỏ vào khái niệm chết.

**Phương án thay thế (nghiêm túc).** Xoá hẳn `proactive_routine` khỏi workflow **và** xoá ledger fossil.
Nếu không giải được "durable append owner" thì đây là lựa chọn trung thực hơn: một chế độ không thể
đạt tới thì đừng ghi vào contract.

---

### P3 — `gate_profile: light` **chỉ cho P2 docs/prompt**

**Vấn đề.** 20 trường contract + manifest + register + readiness.json + full gate cho một sửa docs
5 dòng. Người sẽ né gate cho việc nhỏ — đó là cách gate chết.

**Sai của vòng 1.** Cho `light` áp dụng `risk = P3`. Validator chỉ cho **P1/P2** register
(`autopilot-review-readiness.mjs` L311: *"only P1/P2 writing slices may register"*) **[C]**; P3 là
read-only, không có tracked mutation, **không đi qua register**. Một profile cho P3 là vô nghĩa.

**Đề xuất đã sửa:**

- `light` chỉ khi: `risk = P2` ∧ `change_class ∈ {docs, prompt}` ∧ `scope ≤ N` file ∧ `git diff --stat`
  không chạm thư mục code.
- `light` = `clean_rounds = 1`, `e2e` rỗng hợp lệ, bỏ integration worktree. **Không profile nào cho
  phép 0 round.**
- Profile **do gate tính**, từ manifest cộng diff thật. Khai `docs` mà diff chạm `src/` →
  `GATE_INPUT_DRIFT`.
- `light` **không bao giờ** áp dụng nếu diff chạm canonical kit/consumer authority, manifest/schema,
  scope/readiness validator, reviewer wrapper, security/authz policy hoặc review-readiness gate —
  kể cả file đó có extension `.md`/`.json`/`.sh`. Các path/class này luôn full gate và kit-maintenance
  path riêng khi tự sửa cơ chế chứng nhận.

**Phương án thay thế.** Giữ nguyên. Giá: task nhỏ hoặc chịu thuế, hoặc chạy ngoài kit.

---

### P4 — Fixture theo **safety contract**, không phải theo script

**Vấn đề, có ca thật.** Header `scope-gate` v14 tự ghi: `autopilot-backlog-reconcile` hard-code
`DEFAULT_BRANCH="main"`, ở consumer default `master` thì `git grep … 2>/dev/null` fail im lặng,
`--check` trả *"No stale entries"* exit 0 **trong khi không kiểm gì**. Nguyên văn: *"A gate that
cannot fail is not a gate."* **[C]**

Đây là rủi ro Level 3 tạo ra: **prose hỏng thì lộ liễu, script hỏng thì xanh giả.**

**Sai của vòng 1.** "Một negative fixture cho mỗi script" — quá thô. Một script có nhiều nhánh
safety; một fixture chỉ chứng minh script **có thể** fail, không chứng minh **nhánh cần fail** đã fail.

**Đề xuất đã sửa:**

- Đơn vị fixture = **một safety contract / failure branch**, không phải một script.
- Mỗi fixture assert **exact exit code + exact HALT token**, không chỉ "non-zero".
- Mỗi fixture kèm **positive control**: cùng input hợp lệ phải PASS. Không có positive control thì
  một script hỏng-luôn-fail cũng "đạt".
- CI kit: fixture nào không fail đúng token → pack đỏ. Đề xuất thành điều kiện bắt buộc để bump
  `KIT_VERSION`.
- Ba gap Phase 0 mỗi cái để lại một regression fixture theo đúng chuẩn trên.

---

### P5 — Reviewer attestation, **không** thêm `reviewer_model` vào manifest

**Sai của vòng 1 — chẩn đoán ngược.** Vòng 1 nói env `AUTOPILOT_CODEX_REVIEW_MODEL` gây drift ở gate.
Thực tế final gate **xoá đúng biến đó** trước khi gọi reviewer
(`trustedReviewEnvironment()` scrub `AUTOPILOT_CODEX_REAL_BIN`, `..._REVIEW_MODEL`, `..._REVIEW_EFFORT`,
`..._REVIEW_TIER`, `BASH_ENV`, `ENV`, `NODE_OPTIONS`) **[C]**. Ở gate, **wrapper default luôn thắng** —
tức AP39 chạy bằng model mặc định trong wrapper **[B]**, không phải model trong template.

Nên `reviewer_model` trong manifest sẽ **tạo thêm một nguồn authority thứ hai** cho cùng một sự thật —
đúng lỗi `SECOND_SOURCE` mà P1 đang muốn chặn.

**Đề xuất đã sửa:**

- Wrapper là **nguồn duy nhất** của model/effort/tier.
- Wrapper **xuất attestation** vào artifact: model thực tế, đường dẫn binary, version.
- Validator **kiểm attestation tồn tại và well-formed**, ghi vào `gate-result.json`. Không so với
  một trường khai trong manifest.
- Chênh lệch `terra` / `sol` trong template và run-doc cũ = **legacy-doc cleanup riêng**, không phải
  bug của gate. Tách thành slice docs độc lập.

---

### P6 — Dọn tầng tài liệu: một khái niệm, một nơi định nghĩa

- `autopilot-ONBOARDING.md` còn nhắc `maturity-ledger` (3 chỗ) và `CHANGE_CLASS` (1 chỗ) **[C]**;
  `.gitignore` L55–57 còn mô tả ledger theo mục đích auto-merge của v0.6.0. Hoặc P2 làm chúng sống
  lại đúng nghĩa, hoặc xoá cả ba.
- Phân vai: `level3-workflow.md` = mô hình vận hành; `autopilot-prompt-GENERIC.md` = hợp đồng role;
  `_TEMPLATE.json` = **nơi duy nhất** liệt kê trường; `autopilot-invariants.md` = bài học **chưa
  hoặc không thể** cơ giới hoá.
- Mỗi bullet invariants đã cơ giới hoá gắn tag `(mech: <field|HALT_CODE>)`. Bullet không tag = còn là
  văn xuôi thuần = hàng đợi cho vòng cơ giới hoá sau.

---

## 5. Cái **không** nên mang về từ v0.6.0

- **Inline bash trong prompt** (`verdict_present()`, `model_auth_dead()`, strip rmcp). Lớp connector
  đã đóng bằng thiết kế; phần auth/entitlement còn lại thuộc Phase 0, giải bằng **HALT token phân
  loại** chứ không bằng bash dán tay.
- **26 breaker đánh số.** Số thứ tự vô nghĩa với máy và rot khi chèn/xoá. Dùng token có nghĩa.
- **`auto_merge_after_2x_codex_clean`.** Bỏ là đúng. P2 nhớ: ledger mở *trigger*, không mở *merge*.
- **Changelog HTML-comment chồng chất ở đầu prompt.** `KIT_VERSION` trong chính script tốt hơn —
  version nằm ở nơi thi hành.

---

## 6. Ranh giới mà 3.1 **không** giải quyết

- Gate kiểm sự tồn tại và thời điểm, **không** kiểm tính đúng của bảng quyết định hay probe. Bảng đủ
  hình thức nhưng sai ngữ nghĩa vẫn qua register và vẫn thrash ở round 3–5.
- Codex review DIFF, không review BASE — false positive "not wired" khi producer đã ở base vẫn còn.
- Không gì trong 3.1 phát hiện được một slice cắt sai **ranh giới**. Đó vẫn là việc của người đọc
  contract trước khi delegate.

---

## 7. Thứ tự land đề xuất (canonical-first)

```text
Phase 0 (ba gap AP39 + regression fixture)
  → P4 (fixture theo safety contract)
  → P5 (attestation)
  → P1 (schema v3, forward-only)
  → P3 (light profile)
  → P2 (ledger, nếu giải được durable append owner)
  → P6 (docs cleanup)
```

Lý do: **Phase 0 trước** vì gap 3 làm hỏng chính tín hiệu `MAX_ROUNDS`. **P4 kế** vì mọi thứ sau đều
là code mới trong gate = bề mặt xanh-giả mới. **P5** một thay đổi nhỏ và gỡ một nguồn authority thừa
trước khi P1 thêm trường. **P1** đắt nhất, cần v2/v3 chuyển tiếp phối hợp validator + scope-gate.
**P2 gần cuối** vì nó có thể bị bác bỏ hoàn toàn ở câu hỏi durability. **P6 cuối** vì phụ thuộc P1/P2.

Mỗi mục là một slice riêng chạm chính kit → **không được tự certify bằng gate mà nó đang sửa**; đi
đường kit-maintenance đã review riêng.

**Bước 0 bắt buộc trước khi mở slice đầu tiên:** chạy command re-pin ở §0, yêu cầu canonical
`HEAD == origin/main`, đọc KIT_VERSION và đối chiếu lại đúng blast radius trong bảng §2. Xoá hoặc
đánh dấu superseded mọi mục canonical đã giải quyết. Không dùng SHA/KIT_VERSION trong snapshot này
như dynamic authority, và không dùng discussion này để authorize slice.

---

## 8. Cần bạn quyết (nhị phân)

1. **Phase 0** — ba gap AP39 có phải điều kiện tiên quyết cho mọi thứ còn lại, hay chạy song song?
2. **P1** — nhận `level3-operational-v3` với `design_contract` bắt buộc? (nhận → cần cửa sổ chuyển
   tiếp v2/v3; không nhận → xoá 4 bullet tương ứng khỏi invariants, đừng giữ luật không đo được)
3. **P2** — có giải được **durable append owner** mà không mutate default worktree không? Nếu không:
   xoá hẳn `proactive_routine` + ledger fossil?
4. **P4** — fixture theo safety contract có thành điều kiện bắt buộc để bump `KIT_VERSION` không?
5. **P3** — `N` = bao nhiêu file, và `docs`/`prompt` có phải hai class duy nhất đủ điều kiện?

Trả lời 1, 2, 3 chỉ đủ để author candidate contract/fixture plan cho Phase 0. Nó không authorize
register/write/land; việc mở slice vẫn cần authority và independently reviewed kit-maintenance path
riêng. Câu 3 là câu duy nhất có thể **giết** một đề xuất.
