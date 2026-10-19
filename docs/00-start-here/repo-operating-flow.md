# Repo Plexco vận hành thế nào — bản mô tả flow hiện tại

> **File này là gì:** bản mô tả *cách làm việc* của repo, dựng lại từ chính các file luật đang có
> trên `main`. Nó là **bản đồ**, không phải authority: mọi câu ở đây đều có thể kiểm bằng file gốc
> được trích dẫn ngay cạnh. Khi file này lệch file gốc, **file gốc thắng** và cái lệch cần được sửa ở
> đây.
>
> **File này KHÔNG phải:** không phải verdict, không khẳng định trạng thái readiness của bất kỳ slice
> nào, không thay `HANDOFF.md` (live truth), không thay `review-code-readiness-gate.md` (policy).
>
> **Đo tại:** `main` = `a151b15` · KIT_VERSION `31` · migration tail `0032` · 2026-08-21.
> Mọi số ở đây đều **de-pin được** — cách đo ghi kèm từng chỗ. Đừng chép số sang doc khác.

---

## 0. Bản đồ 30 giây

Repo có **hai đường ray chạy song song**, không phải một. Chọn nhầm ray là lỗi quy trình, không phải
lỗi phong cách.

```
                     ┌─────────────────────────────────────────────┐
   Việc chạm         │  RAY A — Docs / Decision / Spec / Plan      │
   docs, spec,  ────►│  Gate: review-code-readiness-gate.md         │
   decision, plan    │  Output: verdict block + directive           │
                     │  Máy kiểm: pnpm review:check:changed         │
                     └──────────────────┬──────────────────────────┘
                                        │  chỉ khi đạt strict CODE_READY
                                        ▼
                     ┌─────────────────────────────────────────────┐
   Việc chạm    ────►│  RAY B — Code / Migration / Test            │
   packages/, apps/  │  Gate: level3-workflow.md + scope-gate       │
                     │  Output: READY | AWAIT | HALT                │
                     │  Máy kiểm: autopilot-review-readiness.mjs    │
                     └──────────────────┬──────────────────────────┘
                                        │  owner merge tay
                                        ▼
                            ap-merge.sh → ap-finish.sh
```

Luật giao nhau, ghi ở `CLAUDE.md` và `AGENTS.md`: **hai gate áp song song, cái nào chặt hơn thì
thắng.** Ray B không miễn cho bạn khỏi Ray A khi slice có chạm doc.

---

## 1. Thứ tự đọc bắt buộc khi vào một session mới

| # | Đọc | Vì sao |
|---|---|---|
| 1 | `CLAUDE.md` / `AGENTS.md` | Auto-load. Chứa 10 điều review policy, luật ngôn ngữ, block Level 3, block GitNexus |
| 2 | `docs/00-start-here/HANDOFF.md` | Self-contained. **Đọc khối 🔴/🟢 LIVE TRUTH mới nhất TRƯỚC**; mọi đoạn phía dưới là lịch sử đã mục — kể cả *chỉ thị*, không riêng số |
| 3 | Canonical theo topic | Xem §2 |
| 4 | `docs/autopilot-ONBOARDING.md` | Chỉ khi sắp chạy một lane autopilot |

Với schema / data model / kiến trúc, `CLAUDE.md` bắt buộc thứ tự: `packages/db/schema.ts` +
`packages/db/migrations/*.sql` (**AUTHORITATIVE**) → `docs/features/FE|BE/feature_*.md` →
`docs/standards/decisions.md`. Cấm thiết kế từ nguyên tắc chung; cấm tạo bảng song song với khái
niệm đã có (`persons` / `accounts` / `channel_identities` / `memberships`).
`docs/00-start-here/identity-model.md` là **orientation, không phải source of truth**.

---

## 2. Thang authority — ai thắng ai khi hai doc mâu thuẫn

Docs trong repo này **có** mâu thuẫn nhau (audit 2026-08-13 tìm thấy xung đột đồng thời ở spec,
playbook, template và index). Nên có thang viết sẵn — `plexco-level3-autonomy.md` §6.1. Bậc trên thắng:

| # | Authority | Vì sao trên bậc dưới |
|---|---|---|
| 1 | **Runtime thật** — `pg_catalog`, migration đã apply, output của canonical runner, live code | Là phép đo, không phải ý định. `schema.ts` *khai báo*; `pg_constraint` *chứng minh* |
| 2 | `packages/db/migrations/*.sql` + `schema.ts` | `CLAUDE.md` đánh dấu AUTHORITATIVE cho schema/data-model/kiến trúc |
| 3 | `docs/standards/decisions.md` | Sổ quyết định. Spec cãi DD thì **DD thắng và spec phải sửa** |
| 4 | Spec `Reviewed` (cặp `features/FE` + `features/BE`) | Contract baseline — nhưng chỉ phần Reviewed. Một mục gắn 🟡 nằm trong spec Reviewed **không phải** contract |
| 5 | Spec Draft / plan / proposal | Định hướng, không phải contract. Không bao giờ là cơ sở để implement |
| 6 | `ROADMAP.md` (thứ tự giao) · BRD (scope) · PRD (behavior) · TDD (implementation contract) | Mỗi cái sở hữu đúng câu hỏi của nó, không hơn |
| 7 | Doc index/summary — `features/README.md`, `docs-inventory.md`, `BUILD-STATUS.md`, bảng quick-ref | Bản sao tiện tay. Mục nhanh nhất, audit từng thấy 46/51 ô version sai trong một index |

**Bốn tie-break, mỗi cái đã tốn một phiên:**

- **Packet của một lane trên branch của chính nó thắng bản copy trên `main`.** Slice được phép amend
  contract của chính nó trong commit của nó; đọc `main` rồi kêu "vi phạm scope" mới là lỗi.
- **Trong cùng một file, khối live-truth mới thắng khối cũ** — và *chỉ thị* của khối cũ cũng mục,
  không riêng số. Quét cả directive stale, đừng chỉ quét số stale.
- **Hai doc cùng tự nhận canonical → cái nào nêu decision ID thì thắng**; không cái nào nêu ⇒ coi là
  xung đột Tier C và AWAIT, không tự chọn.
- **`Doc status` ≠ `Implementation status`.** `Reviewed` không bao giờ hàm ý runtime.

Nguồn khi conflict theo topic (`HANDOFF.md` §7): live implementation → decisions đã chốt → BRD/PRD/TDD
→ security/money (áp **rule nghiêm ngặt hơn** giữa AUDIT / business-rules / spec; không nới fail-closed
chỉ vì doc thấp hơn chưa cập nhật). Research/strategy là input định hướng, **không** override live
schema hoặc DD đã chốt.

---

## 3. Ngôn ngữ — ranh giới là NGƯỜI ĐỌC, không phải loại file

`CLAUDE.md` §Ngôn ngữ:

- **Agent-facing ⇒ English.** `.claude/commands/*.md`, `docs/autopilot/contracts/*`,
  `docs/autopilot-templates/autopilot-prompt-*.md`, `level3-workflow.md`, `level3-handoff.md`, và
  **mọi khối ` ```text ` được paste vào Claude Code**.
- **Owner-facing ⇒ tiếng Việt.** `decisions.md`, `docs/product/*`, `HANDOFF.md`,
  `slice-readiness-verdicts.md`, `review-code-readiness-gate.md`, các doc `level3.1-*`
  (design-discussion, adoption-plan).
- **Khuôn lai** cho RUN/prompt doc: prose dẫn tiếng Việt, payload English.

⚠️ Đừng khai lớp bằng glob `level3*.md` — `level3-workflow.md` = 0 dòng tiếng Việt, còn
`level3.1-design-discussion.md` = 191 dòng. Cùng tiền tố, khác lớp người đọc.

Kiểm trước khi commit file có khối prompt:

```bash
awk '/^```text$/{f=1;next} /^```$/{f=0} f' <file> \
  | grep -P '[àáảãạăâđèéẻêìíỉòóỏôơùúủưỳýỵ]'   # phải rỗng
```

---

## 4. Nền tảng không được vi phạm

### 4.1 Ba vùng dữ liệu = ba tầng hiển thị

1. **GLOBAL identity** (ngoài RLS, **không chứa tiền**): `persons`, `channel_identities`,
   `channel_reachability`, `sports`.
2. **TENANT-scoped** (RLS fail-closed): `sessions`, `players`, `memberships`, `charges`,
   `bank_transactions`, `payment_allocations`, billing…
3. **PUBLIC read model** (cross-tenant, KHÔNG RLS, field whitelist): `public_sessions`. **Không**
   chứa tiền/PII.

### 4.2 5 HARD RULES — vi phạm = rò rỉ tiền/PII thật

1. **RLS FAIL-CLOSED.** Mọi query qua `tenantRepo(tenantId)` — choke-point bắt buộc.
   `SET LOCAL app.tenant_id`. Role `app` = `NOBYPASSRLS`. Không query thẳng bảng tenant-scoped từ
   controller.
2. **TIỀN/PII KHÔNG RA PUBLIC.** `public_sessions` chỉ field-whitelist. Test bất biến trong CI là bắt
   buộc.
3. **KHÔNG multi-master.** Postgres + domain model = canonical store. Surface (Zalo/Messenger/web)
   chỉ gửi command; đồng bộ qua outbox → projectors.
4. **CLAIM-CÓ-TIỀN CẦN KHOÁ MẠNH.** Merge/claim identity phải qua verified factor: email đã verify
   (web) hoặc `link_code` deterministic dùng-một-lần (bot) — DD-50. Tên/alias/owner assertion không
   thay proof.
5. **i18n BẮT BUỘC.** Mọi chuỗi user-facing qua `t(vi, en)`.

### 4.3 Canonical store pattern

```
Mọi surface (chat/web/webhook) → Command → Services → tenantRepo (choke-point, RLS)
  → ghi + Outbox event (cùng tx)
  → Projectors: Zalo · Messenger one-route (tenant Page→central) · SSE web · public_sessions
```

---

## 5. RAY A — flow cho docs / decision / spec / plan

Kích hoạt khi session **review, reconcile, fix, re-check hoặc final** bất kỳ decision, analysis,
feature spec, technical plan, implementation plan hay doc pack. Áp **kể cả** khi user chỉ nói
"review", "check", "updated", "fix", "final".

### 5.1 Năm trạng thái cấm trộn

```
DECISION_FINAL  ≠  PLAN_READY  ≠  CODE_READY  ≠  ENABLE_READY  ≠  IMPLEMENTED
```

| Trạng thái | Nghĩa | KHÔNG chứng minh |
|---|---|---|
| `DECISION_FINAL` | Owner đã chọn product/policy direction | Spec đủ để code |
| `PLAN_READY` | Đủ contract để tách slice + viết execution plan | Dependency đã merge |
| `CODE_READY` | **Một slice cụ thể** có thể mở worktree và code | Feature đã implemented |
| `ENABLE_READY` | Đủ legal/external/product-evidence/operational gate để bật cho user | Runtime đã deploy |
| `IMPLEMENTED` | Code + migration + tests đã tồn tại và verified | Production E2E |

### 5.2 Sáu gate G1–G6

`Decision ✅` chỉ là **G1/6**, không phải giấy phép code.

| Gate | PASS khi |
|---|---|
| **G1 Decision** | Mọi DD/OQ/design-probe trên đường đi của slice đã owner duyệt và ghi vào authority |
| **G2 Spec** | Cặp Product + BE spec đã `Reviewed`, đủ section bắt buộc + acceptance checklist; infra/core slice cần technical authority tương đương |
| **G3 Dependency** | Mọi bảng/service/helper/API slice **đọc hoặc gọi** đã tồn tại **trên default branch** (không phải feature branch, không phải proposal) |
| **G4 Test** | Exact invariant + expected assertion đã đặc tả **trước** code |
| **G5 Scope** | Mechanism-named, có negative scope, trong budget, manifest/scope-gate hợp lệ, không mega-slice |
| **G6 External** | Gate PII/money/provider/legal đã clear, hoặc phân loại `ENABLEMENT_ONLY` có bằng chứng |

### 5.3 Quy trình 9 bước (gate §6 + template §3)

1. **Pin snapshot** — full 40-ký-tự SHA của default branch, exact target file paths.
2. **Map authority** — decisions, business rules, dependent specs, open questions.
3. **Verify live truth** — schema, migrations, services/routes, auth/grants, tests, worktree đang có.
4. **Review-first** — liệt kê mismatch/blocker theo severity; **không vừa đọc vừa tuyên bố final**.
5. **Fix in scope** (chỉ khi được authorize) — sửa canonical authority trước, mirror sau.
6. **Freeze pass** — không thêm feature/decision mới; chạy closure matrix 12/12.
7. **Emit verdict** — dùng block canonical, không kết bằng prose tự do.
8. Nếu `CODE_READY` → author 6 artifact (§5.6) rồi mới mở worktree.
9. Nếu chưa ready → blocker + owner + binary resolution + `NEXT_REVIEW_TRIGGER`.

### 5.4 Verdict block — các trường bắt buộc

Block canonical nằm ở `docs/standards/review-code-readiness-gate.md` §7 (copy từ đó, **không** chép
từ file này — file này cố ý không dán nguyên block để không bị validator nhận nhầm là artifact
verdict). Các trường: `REVIEW_POLICY_VERSION` (1.3) · verdict · `REVIEWED_AT` · `AUTHORITY_SHA`
(full 40 ký tự) · `BASE_BRANCH` · `TARGET_FILES` (exact, **cấm glob**) · `SLICE` · `IN_SCOPE` /
`OUT_OF_SCOPE` · `G1_DECISION`…`G6_EXTERNAL` · `HARD_DEPENDENCIES` · `PRIOR_SLICES` ·
`OPEN_QUESTIONS_IN_SCOPE` · `ENABLEMENT_ONLY_GATES` · `LIVE_REPO_VERIFICATION` · `CONTRACT_MATRIX` ·
`CLOSURE_MATRIX` · `ACCEPTANCE_MATRIX` · `SECURITY_AND_MIGRATION_GATE` · `IMPLEMENTATION_ARTIFACTS` ·
`FIRST_IMPLEMENTATION_STEP` · `REMAINING_BLOCKERS`.

`CODE_READY` hợp lệ **chỉ khi**: G1–G5 PASS · G6 PASS hoặc named `ENABLEMENT_ONLY` · closure 12/12
PASS · open question in-scope = 0 · hard dependency đã merge (hoặc slice chính là root dependency) ·
acceptance matrix đủ · first step thực thi được.

### 5.5 Machine enforcement — 6 directive

Mọi artifact review/readiness persisted phải khai **một** directive trong 30 dòng đầu:

| Directive | Dùng cho | Có authorize code không |
|---|---|---|
| `code-ready` | Final implementation plan / coding handoff | ✅ — và mọi active verdict phải strict `CODE_READY` |
| `enforce` | Draft / read-only blocker audit / tracker chưa authorize | ❌ tuyệt đối |
| `historical` | Bằng chứng lịch sử đã superseded | ❌ |
| `criteria` | Tiêu chí đánh giá, không phải verdict | ❌ |
| `policy` / `template` | Source rule / placeholder | ❌ |

Cách máy nhìn thấy artifact (`scripts/check-review-readiness.mjs:509`):
`candidate = (tên file khớp /(^|[-_.])(review|readiness|plan)([-_.]|$)/i) OR (nội dung có dòng bắt đầu
bằng trường verdict)`. Đây là **heuristic phát hiện, không phải định nghĩa**.

**Phép thử thật (§11.2 của gate):** artifact kích hoạt enforcement khi nó **KHẲNG ĐỊNH MỘT TRẠNG THÁI
readiness** — `MET`/`PARTIAL`/`NOT-MET` per-gate, `READY`/`NOT_READY`, điểm số (`8/12`), tính từ hàm ý
khoảng cách ("gần đủ", "chỉ còn"). **Kiểm kê bằng chứng** (mỗi tiêu chí ghi `file:line` có gì / thiếu
gì, không quy ra trạng thái) thì **không** kích hoạt.

Hai hệ quả:

- Một khẳng định readiness nằm trong file đặt tên khác là **vi phạm dù validator xanh** — xanh ở đây
  nghĩa là "không nhìn thấy", không phải "đã duyệt".
- **Cấm ra verdict cho slice chưa được author.** Không manifest + không target code ⇒ `AUTHORITY_SHA`
  không pin cái gì thật, closure matrix đánh giá thứ chưa tồn tại. Điền cho hợp lệ = **bịa bằng chứng
  có vỏ machine-checked**, tệ hơn không verdict. Và **không mở slice placeholder chỉ để có chỗ đặt
  verdict** (tiền lệ: AP-28 `HALT-AUTHORITY_AMBIGUOUS`).

### 5.6 Handoff khi đạt `CODE_READY` — 6 artifact

1. Slice doc / packet: `docs/autopilot/contracts/autopilot-<slug>.md`
2. Authored contract: `docs/autopilot-manifests/<slug>.json`
3. Launcher: `.claude/commands/ap-NN-<slug>.md`
4. Backlog entry + dependency + merged probe trong `docs/autopilot-backlog.md`
5. Commit/push cả 4 lên default branch **trước** khi tạo worktree
6. Tạo worktree từ exact default-branch SHA, verify hai SHA khớp, rồi register scope gate

### 5.7 Lệnh và launcher

```bash
pnpm review:check:changed   # bắt buộc trước verdict/commit — đỏ = hard stop
pnpm review:check          # toàn repo; CI chạy cái này
```

Slash command: `/review-doc-plan <target>` → `.claude/commands/review-doc-plan.md`.
Template thực thi: `docs/templates/review-doc-plan-session-template.md` (v1.3).

---

## 6. RAY B — flow cho code: vòng đời một slice

Header vận hành, có mặt ở `CLAUDE.md`, `AGENTS.md`, `ONBOARDING`, `level3-workflow.md`:

```text
WORKFLOW_LEVEL: 3
WORKFLOW_MODE: supervised_autonomy
HUMAN_ROLE: manager_of_managers
DEFAULT_STOP_MODE: STOP_AT_READY
AUTO_MERGE: off
```

**Forward-only:** Level 3 chỉ áp cho task/session mở **mới**. Session đang chạy giữ contract cũ tới
terminal state, **không migrate giữa chừng**.

### Bước 0 — Task contract (trước khi code)

Primary agent resolve từ `level3-workflow.md` §3, 19 trường:

```text
TASK_ID · OUTCOME · REPOSITORY_AND_BASE · CONTEXT_SOURCES · APPLICABLE_SKILLS ·
SCOPE · NEGATIVE_SCOPE · RISK(P0–P3) · AUTONOMY_MODE · MODEL_POLICY ·
SANDBOX_AND_PERMISSIONS · HUMAN_DECISIONS_REQUIRED · SLICE_GRAPH · WORKTREE_PLAN ·
VERIFICATION · CODE_REVIEW · SECURITY_REVIEW · BUDGETS · STOP_CONDITIONS · DELIVERABLES
```

Thiếu context material ⇒ **`AWAIT_CONTEXT`**, không được tự bịa. Cần quyết định ⇒ đưa **một đề xuất
tốt nhất** kèm trade-off, không đẩy menu chưa xếp hạng cho owner.

### Bước 1 — Backlog: `idea` → `planned`

`docs/autopilot-backlog.md`. Lifecycle:

```
idea → planned (scope rõ + chọn invariants) → tạo manifest → ready → register
     → in-flight → merge → merged
```

Cộng hai trạng thái đóng đặc biệt:

- **`blocked`** — artifact đủ nhưng slice **không thể đạt READY bằng bất kỳ session nào** vì thiếu
  bằng chứng chỉ con người lấy được ngoài repo (trả lời của provider, phép đo trên thiết bị thật,
  due-diligence). Bot **không quét**. Chạy lại chỉ tái xác nhận cùng một HALT và đốt session. Phải
  ghi trong `notes`: **ai** đóng được, **bằng gì**, điều kiện chuyển lại `ready`.
- **`superseded`** — deliverable đã đi qua lane khác; chưa từng register/in-flight.

**Luật song song** (đúng luật `scripts/autopilot-scope-gate`): hai task chạy song song được ⟺ **cả
ba**: `scope` (file) rời nhau · `invariants` (token) rời nhau · không cái nào `depends_on` cái kia mà
cái kia chưa merge.

### Bước 2 — Worktree, PHẢI pin base SHA tường minh

```bash
BASE_SHA=$(git rev-parse origin/main)
git worktree add ".autopilot/worktrees/$FEATURE_ID" -b "feat/$FEATURE_ID" "$BASE_SHA"
git -C ".autopilot/worktrees/$FEATURE_ID" rev-parse HEAD   # phải == $BASE_SHA
```

Thiếu `$BASE_SHA` ⇒ fork từ HEAD hiện tại, có thể là branch cũ (incident v0.4.8). Mỗi worktree một
DB/port/cache riêng. **Root worktree luôn ở `main`; cấm sửa thẳng `main`.**

Tên feature: một slice ⇒ `<task-slug>`; nhiều slice ⇒ `<task-slug>--<slice-slug>`. Worktree tích hợp
tạm (gộp nhiều tip READY để chạy verification chung, không push, xoá sau) phải đặt tên
`_integ-<task-slug>` — đó là worktree duy nhất không có reservation, watchdog nhận ra nó bằng tên.

### Bước 3 — **Hai file manifest cùng tên: bẫy lớn nhất của repo**

| | Authored contract | Runtime manifest |
|---|---|---|
| Đường dẫn | `docs/autopilot-manifests/<slug>.json` | `.autopilot/state/<FEATURE_ID>/manifest.json` |
| Track trong git | ✅ có | ❌ không (`.autopilot/` gitignored) |
| Vòng đời | vĩnh viễn; được review, versioned, verdict trích dẫn | **một lần chạy** |
| `manifest_schema_version` | **CẤM có** | `level3-operational-v2` |
| Ai viết | người/phiên authoring, trước khi launch | copy/resolve lúc register |

`autopilot-review-readiness.mjs` **fail-close** trừ khi manifest được truyền nằm đúng
`.autopilot/state/<FEATURE_ID>/manifest.json`. Nên gắn `manifest_schema_version` vào file tracked
**không "nâng cấp" nó — nó làm `register` HALT.**

Hai hệ quả từng bị đoán sai:

- Repo mà manifest tracked không mang chuỗi đó **không** phải đang chạy workflow cũ. Đừng mở task
  "migrate manifests sang v2".
- Review gate **không** phụ thuộc chuỗi đó: `autopilot-scope-gate` bật `REVIEW_REQUIRED=1` nếu schema
  là v2 **hoặc** `review_gate_version` có giá trị **hoặc** `scripts/autopilot-review-readiness.mjs`
  chỉ cần tồn tại trên base ref.

Copy khuôn từ `docs/autopilot-manifests/_TEMPLATE.json`, cộng
`_READINESS_EVIDENCE_TEMPLATE.json` cho `readiness_evidence_path`.

**Ba luật viết field mà mỗi cái đã tốn một lần đăng ký lại:**

- **`verification.*` là lệnh shell được `spawn` thật**, không phải văn xuôi. Viết **assertion về một
  property**, không viết literal (`test count == 561` stale trong vài giờ; `postcss == 8.5.18` bắt
  phải register lần thứ ba). Ví dụ đúng:
  `osv-scanner --format json ... | jq -e '.results | length == 0'` ·
  `git diff --quiet <base> -- <file>` · `grep -qF 'case 2b' path/to/test.ts`.
  Property nào đã được cơ chế khác bảo đảm (vd "không có migration mới" đã do SCOPE_DRIFT chặn) thì
  khẳng định bằng cơ chế đó, đừng viết thêm lệnh.
- **`scope` là danh sách file worktree-relative chính xác** — gate **từ chối thư mục**, cấm trùng.
  Phải kể cả file authored contract của chính slice nếu slice amend contract của mình.
- **`invariants` phải lấy token từ `docs/autopilot-invariant-catalog.md`** (giữa
  `<!-- catalog:start -->` … `<!-- catalog:end -->`). Token lạ ⇒ `HALT INVARIANT_UNKNOWN`. Catalog có
  **8 token vận hành Level 3 global cấm xoá** (`workflow-authority`, `kit-integrity`, `risk-policy`,
  `terminal-lifecycle`, `review-integrity`, `delegation-safety`, `audit-integrity`,
  `merge-authority`) + token domain của Plexco (`schema`, `auth`, `money-model`, `identity`,
  `session-command`, `billing-authz`, `publish-suspend-gate`, `session-lock-ordering`, …). Thêm domain
  mới = thêm **một dòng** vào block catalog **trước**, rồi mới dùng.
- **`code_review.clean_rounds`**: `1` trên biên authorization hoặc money là *ngân sách review*, không
  phải *gate*. P1 = **2 vòng FULL clean liên tiếp**.

> Lỗi chung của cả bốn không phải cẩu thả với một field. Là **viết một khai báo mà không đọc thứ
> validate nó** — và mỗi thứ đó chỉ cách một lệnh `grep`. Hãy coi authoring là review một tài liệu
> bạn chưa viết.

### Bước 4 — `register`: gate kiểm gì

```bash
cd .autopilot/worktrees/$FEATURE_ID
export AUTOPILOT_CODEX_BIN="$PWD/scripts/codex-review-pin.sh"
scripts/autopilot-scope-gate register --manifest ".autopilot/state/$FEATURE_ID/manifest.json"
```

Trình tự kiểm trong `scripts/autopilot-scope-gate` (KIT_VERSION 31):

| # | Kiểm | HALT/REJECT |
|---|---|---|
| 0 | `manifest_schema_version == level3-operational-v2` (kiểm **đầu tiên**, trước khi chạm INFLIGHT) | `HALT CONTRACT_INVALID` |
| 1 | `scripts/autopilot-review-readiness.mjs` tồn tại → chạy `node … register` | `HALT REVIEW_GATE_MISSING` |
| 2 | Feature chưa có reservation `in-flight`/`ready` | `REJECT FEATURE_ALREADY_ACTIVE` |
| 3 | Mọi invariant có trong catalog | `HALT INVARIANT_UNKNOWN` |
| 4 | Không prerequisite nào còn active | `HALT DEP_MISSING` |
| 5 | `dep_checks[{file,symbol}]` — grep symbol trên `base_ref` thật (chống upstream đổi tên interface) | `HALT DEP_MISSING` |
| 6 | Scope file **và** invariant không giao với feature active khác | `HALT SCOPE_COLLISION` |

Register thành công thì gate tự tạo, **cơ học chứ không dựa vào kỷ luật prompt**:

```
.autopilot/state/$FEATURE_ID/fix-round-count.txt        # "0"
.autopilot/state/$FEATURE_ID/regions.log                # rỗng
.autopilot/state/$FEATURE_ID/registered-manifest.sha256 # hash-lock manifest
```

> ⚠️ **Một lệch đo được, cần biết:** `CLAUDE.md` cảnh báo rằng truyền authored path vào `register` sẽ
> **fail-OPEN** (bỏ qua hash-lock, vẫn in `registered`). Trên KIT_VERSION 31 điều đó **không còn
> đúng**: kiểm `manifest_schema_version` nay là câu lệnh đầu tiên của nhánh `register` và HALT
> `CONTRACT_INVALID`. Lời khuyên kèm theo — *kiểm `registered-manifest.sha256` tồn tại sau mỗi lần
> register, đừng tin chữ "registered"* — vẫn rẻ và vẫn nên làm.

### Bước 5 — Vòng implementation

1. Chỉ đọc bounded blast radius (dùng GitNexus `impact`/`context`/`query`, **không** đọc cả repo).
2. Viết decision table / test matrix **trước** logic stateful rủi ro.
3. Implement trong scope; giữ nguyên WIP không liên quan.
4. Thêm regression test dùng input production-shaped, tên case theo ca thật.
5. Chạy verification focused + canonical để có feedback nhanh.
6. Fetch base ref mà **không rebase** run đang chạy. Nếu nó khác `BASE_SHA` ⇒ HALT, mở successor.
7. Không tự chế file verification/review, không tự khai clean.
8. Chạy `scope-gate ready` (§bước 7).
9. Review có finding actionable = chưa sạch → fix, **tăng `fix-round-count.txt`**, append
   `round-NN file:region` vào `regions.log`, rồi chạy lại **toàn bộ** gate.

**Counter là FILE, không phải văn xuôi** (`autopilot-invariants.md`).

### Bước 6 — Review độc lập bắt buộc

Reviewer là **`scripts/codex-review-pin.sh`** — external CLI pin qua `AUTOPILOT_CODEX_BIN`. **Cấm
thay bằng sub-agent Claude/Task.** Slice chạm trust boundary (auth · secret · permission · external
input · **tiền** · deployment) chạy **thêm một round security riêng** qua đúng wrapper đó.

**Ba sự thật về cách gọi, mỗi cái đã đốt một vòng thật:**

- **`--base` là `base_sha` pin trong manifest, cùng một giá trị mọi vòng — KHÔNG BAO GIỜ `HEAD^`.**
  `HEAD^` chỉ trùng base khi có đúng một commit trên base; sau commit fix tiếp theo, vòng review chỉ
  đọc mỗi commit fix và **âm thầm bỏ phần còn lại của slice** ra khỏi change set. Lấy SHA từ manifest
  hoặc `git rev-parse` — **không** lấy từ `git log --oneline` (short SHA bị từ chối
  `CODEX_REVIEW_CONTRACT_INVALID`).
- **Biết cái nào enforce cái gì.** Wrapper mỏng: nó kiểm hình dạng SHA rồi bảo reviewer đọc đúng
  `git diff <base>...HEAD`. Wrapper **không** từ chối diff rỗng hay cây bẩn —
  `autopilot-review-readiness.mjs` mới làm, dưới tên `EMPTY_DIFF` và `WORKTREE_DIRTY`.
- **Change set là lịch sử đã commit ⇒ commit trước khi gọi.** Fix chưa commit nằm ngoài
  `<base>...HEAD` dù nó hiện rành rành trên đĩa; base bằng HEAD thì **không có vòng review nào cả**,
  không phải "vòng sạch".

**Review sạch trên diff rỗng KHÔNG phải bằng chứng.** Reviewer không gọi được ⇒ `HALT
TOOL_UNAVAILABLE`, **cấm tự hạ gate**.

**Bốn lỗ hổng đã đo được của gate này — ghi lại chứ chưa vá, đừng lách im lặng**
(`level3-workflow.md` §8):

1. **Reviewer không nhận scope** ⇒ một gợi ý ngoài scope halt y như một defect, và không có kênh
   waiver. Phản ứng đúng: **bỏ item đó ra khỏi diff** — không cãi reviewer, không chạy lại mong verdict
   khác.
2. **Lỗi auth-tier của reviewer bị phân loại `HALT` thay vì `AWAIT` resumable** (detector chỉ khớp
   401-shaped; một refusal 400-class về model/entitlement rơi xuống `REVIEW_UNAVAILABLE` durable).
   Operator nhận ra đúng ca này *có thể* xử như AWAIT nhưng **phải nói rõ và ghi lý do**; agent
   **không** được tự quyết.
3. **`fix-round-count` tăng cả khi lỗi hạ tầng**, không riêng defect (hai vòng mất vì Postgres
   `57P01 admin_shutdown` = 40% ngân sách). **Nâng trần là cách sửa sai** — breaker sinh ra để bắt
   *design thrash*.
4. **Thay đổi được authorize không có đường vào registration đã hash-lock** ⇒ mỗi lần phải
   close-and-rebuild. Lưu ý tương tác với (3): re-register **reset `fix-round-count` về 0**, nên
   `MAX_ROUNDS` là checkpoint chứ không phải ngân sách. Chính đáng khi slice **đã chấp nhận** finding
   và cần scope mới; là **rửa gate** khi slice định cãi lại cùng finding với ngân sách mới. **Phải
   khai bạn đang làm cái nào, trong close reason.**

### Bước 7 — `ready`

```bash
scripts/autopilot-scope-gate ready --manifest ".autopilot/state/$FEATURE_ID/manifest.json"
```

Gate `ready` (đọc từ scope-gate):

1. Lấy `READY-<feature>.lock` riêng ⇒ chặn hai transition đồng thời (`REJECT READY_TRANSITION_BUSY`).
2. Kiểm registry status phải `in-flight` (`REJECT READY_LIFECYCLE_INVALID` — *ready không bao giờ chạy
   lại trên lifecycle terminal*).
3. **Nhả registry lock**, chạy `autopilot-review-readiness.mjs ready` (verify + Codex round có thể rất
   lâu) — gate tự thực thi **mọi lệnh** trong `verification` của manifest **đã đăng ký, không đổi**,
   chạy các round Codex bắt buộc + security round, ghi bằng chứng.
4. Lấy lại lock, kiểm status **chưa đổi** (`HALT READY_LIFECYCLE_CHANGED`) và **re-check collision**
   (feature khác có thể đã register xen vào giữa).
5. Ghi `READY.txt` + chuyển registry sang `ready`.

Sản phẩm: `.autopilot/state/<feature>/gate-result.json` (`gate_schema_version:
level3-readiness-v2`) + `gate-attempt-count.txt` + các log round do gate sinh.
**Cấm sửa log do gate sinh hoặc `gate-result.json`.**

### Bước 8 — Merge (việc của owner) — `scripts/ap-merge.sh`

```bash
scripts/ap-merge.sh <slug> -F <msgfile> [--probe 'path::needle'] [--test] [--push] [--yes]
```

File này tồn tại vì sự cố 2026-07-22: một runbook merge nhiều bước dán vào terminal hỏng **hai lần
trong một buổi** — `git merge --squash` abort vì cây bẩn nhưng `git commit` ngay sau **vẫn chạy** và
commit thứ đang staged sẵn; và cổng chặn dùng `git status --porcelain` (tính cả untracked, mà repo
luôn có untracked) nên luôn báo bẩn ⇒ bỏ hẳn bước merge rồi vẫn push và xoá branch.

Bài học đóng vào script: **một chuỗi nhiều bước CÓ TÁC DỤNG PHỤ không nên tồn tại dưới dạng văn bản
để paste.** Trình tự trong script:

1. Phải đang ở `main`.
2. Cây sạch — gate bằng `git diff --quiet` (**chỉ tracked**), không dùng `status --porcelain`.
3. `main == origin/main` bằng **so sánh SHA**, không dùng `git pull --ff-only` (lệnh đó rộng hơn câu
   hỏi nên thừa hưởng failure mode rộng hơn — nó từng chết bằng `Cannot fast-forward to multiple
   branches` ngay khi hai bên bằng nhau).
4. `git merge --squash`; fail ⇒ `git reset --hard HEAD`, không commit gì.
5. In danh sách file staged + **bắt xác nhận tay** (trừ `--yes`).
6. `--probe 'path::needle'` verify **trên cây** — bắt đúng lớp lỗi "commit mang subject đúng nhưng nội
   dung sai".
7. `--test` (opt-in) chạy `pnpm test` trước push.
8. `--push` (opt-in) → rồi **8b** `autopilot-backlog-reconcile --fix` (**phải sau push**, vì probe
   giải bằng `git show origin/<default>`), commit riêng `chore(backlog): reconcile status after
   merging <slug>`.

**Script không bao giờ tự xoá branch** — đó là việc của `ap-finish.sh` sau khi origin đã xác nhận.

### Bước 9 — `scripts/ap-finish.sh` — dọn CHỈ khi đã có bằng chứng

```bash
scripts/ap-finish.sh <slug> [--squash-verified <origin-commit> | --authorized-close --reason <text>] [--no-archive]
```

Ba mode:

| Mode | Bằng chứng đòi hỏi |
|---|---|
| `ancestor` (mặc định) | `HEAD_SHA` là ancestor của `origin/<default>` |
| `--squash-verified <sha>` | Commit proof **một parent**, nằm trên origin, **file set bằng đúng** file set của READY, **binary diff hash bằng đúng** `diff_sha256` |
| `--authorized-close --reason <text>` | Không claim merge; giữ lịch sử branch; ghi disposition |

Trước khi dọn, mode không phải `close` phải qua hết:
cây worktree sạch · registry status `ready` · `READY.txt` non-empty · `gate-result.json` non-empty và
`result == pass`, schema `level3-readiness-v2`, các SHA thật · **không** còn `HALT-*` /
`AWAIT-FOUNDER-*` / `pending-review-finding.json` · `gate-attempt-count.txt` khớp `attempt` trong
gate result · tip branch **chưa nhích** sau READY · **live diff hash khớp** `diff_sha256`.

> Diff được đo từ **`diff_base_sha`** (tip base_ref mà gate thật sự dùng), **không** từ `base_sha`
> (base pin legitimacy). Không có fallback — *một fallback là một nguồn sự thật thứ hai, mà đó chính
> là defect*.

Rồi: **archive `$STATE` ra `\.autopilot/state-archive/<slug>-<timestamp>/state` trước khi
`git worktree remove`** (mặc định bật; `--no-archive` để tắt). Lý do — v31, 2026-08-06: `.autopilot/`
gitignored, nên `design-probe.md`, mọi `HALT-*.txt`, mọi artifact gate/codex chỉ tồn tại trong
filesystem của worktree; `git worktree remove` xoá sạch. Một HALT ở MAX_ROUNDS từng để 7739 byte chi
tiết fix đã chẩn đoán nhưng chưa áp dụng, cách chỗ biến mất không dấu vết đúng một lệnh
`--authorized-close`. Luật "không bao giờ xoá file HALT" **ràng buộc trên hành vi** nên không hề bắn —
đường dọn hợp lệ đạt tới cùng kết quả huỷ diệt mà không cần thực hiện hành vi đó.

Cuối cùng gọi `scope-gate cleanup --feature <slug>`. `cleanup` **từ chối** nếu không có bản ghi
`.autopilot/landings/<slug>.json` hoặc `.autopilot/dispositions/<slug>.json` hợp lệ
(`schema_version: level3-disposition-v1`, status `landed` | `authorized_close`) ⇒
`REJECT CLEANUP_PROOF_MISSING: use scripts/ap-finish.sh; raw reservation cleanup is forbidden.`

### Bước 10 — Sổ tín nhiệm

Merge mà **không phải sửa gì** ⇒ +1 cho change_class trong `.autopilot/maturity-ledger.md` (file này
được TRACK, whitelist trong `.gitignore`). Class P2 đạt **≥3 clean-merge-unchanged** → `mature` → mới
được xét auto-merge. **P0/P1 không bao giờ auto-merge.**

---

## 7. Quyền quyết định

### 7.1 Risk tier

| Risk | Việc điển hình | Hành vi Level 3 |
|---|---|---|
| `P0` | Mutation production/control thật, secret, hành động tài chính/đặc quyền không đảo được | **Analyse/prepare-only**; không mutation tracked/product/external; cần owner cấp quyền thực thi tường minh |
| `P1` | Tiền, identity, auth, permission, schema/migration, choke-point chia sẻ, thao tác destructive | Supervised, isolated, full verification, review độc lập, **human merge**; 2 vòng FULL clean |
| `P2` | Thay đổi product/code/tooling/docs có biên | Supervised mặc định; proactive chỉ sau khi routine đã tạo được tín nhiệm |
| `P3` | Read-only / report-only | Không mutation tracked/product; chỉ telemetry local bị ignore |

### 7.2 Autonomy mode

`supervised` (mặc định) · `proactive_routine` (class hẹp, lặp lại được, đã chạy sạch nhiều lần —
**không bật mặc định**) · `autonomous_to_ready`.

### 7.3 `autonomous_to_ready` — chạy tới READY không ngắt owner giữa chừng

> **2026-10-19:** phần trình bày lại §6.1 trong mục này là lịch sử; luật hiện hành là canonical `docs/autopilot-templates/level3-workflow.md` §6.1 (KIT 43) cùng local supplement `docs/standards/plexco-level3-autonomy.md`.

Bài toán nó giải, đo trên `session-service-create-command-core` v1 (2026-08-13): **bốn lần hỏi owner
chỉ vì budget** (300→360→440→470 compact), mà lane vẫn kết ở `HALT MAX_ROUNDS` — budget chưa bao giờ
là ràng buộc thật, thiết kế validation mới là. Ba trong bốn blocker authoring được giải bằng **đọc
repo**; chỉ một là quyết định owner thật.

Ý tưởng không phải "bỏ owner" mà **"gom owner lại"**: từ *interrupt* thành *một lần review tại READY*,
đọc một Decision Ledger.

**Nghĩa vụ context — bảo đảm bao phủ, không bảo đảm nạp.** (Cả `docs/` = 303 file · 8.5 MB · ~2M+
token — vượt xa mọi context window; riêng sáu doc authority lõi đã ~220k token.) Ba nghĩa vụ:

1. **Luôn nạp (nhỏ, không thương lượng):** khối live-truth của `HANDOFF.md` · **bảng tóm tắt** của
   `decisions.md` (các dòng `| DD-nn |`, không phải toàn thân) · `review-code-readiness-gate.md` ·
   packet + manifest của chính slice.
2. **Search phần còn lại, và log lại query.** Trước mọi quyết định Tier A/B, search cả `docs/` **và**
   `packages/`/`apps/` theo tên entity/cột/endpoint/danh từ feature. Bản đồ: `docs/docs-inventory.md`,
   `docs/features/README.md`.
3. **Bằng chứng phủ định cũng tính, và phải ghi là bằng chứng.** "Đã search `decisions.md` cho
   `buddy`, thấy `DD-26`: đừng thêm model buddy" là câu đã ngăn được `DD-106`. **Search không ghi lại
   là search chưa xảy ra.**

> **grep trả rỗng là bằng chứng về câu query, không phải chứng minh về repo.** Đã bắn sai hai lần ở
> đây: một `awk` viết cho backtick chạy trên catalog dùng em-dash trả rỗng hai lần và bị đọc thành
> "không có dữ liệu". Trước khi tin một null result, verify query bắt được một control case đã biết
> chắc là có.

**Thang quyền quyết định** — phân loại **trước khi** quyết; phân loại xuống thấp là vi phạm gate,
không phải lỗi phong cách:

| Tier | Định nghĩa | Hành vi |
|---|---|---|
| **A — derivable** | Repo/migration/spec/decision log/tiền lệ **đã có** câu trả lời (đặt tên, chỗ đặt module, hình dạng test, tái dùng error code, hàng acceptance truy từ spec) | **Quyết. Log một dòng.** Dừng ở Tier A **tự nó là defect** — ghi vào ledger như một defect |
| **B — judgment, đảo được, in-scope** | Chưa viết ở đâu, nhưng hệ quả nằm trong scope đã khai và sửa được sau bằng chính file của slice (tách helper, chọn lock key, chỗ đặt validator, thêm invariant token, re-slice sau overrun, mở successor sau HALT đã chấp nhận) | **Quyết. Log kèm alternatives, lý do, tính đảo được, bằng chứng đã đọc.** Nêu ở READY |
| **C — reserved** | Đúng 8 mục dưới | **AWAIT.** Một đề xuất, trade-off, điều kiện resume nhị phân |

**Tier C là ĐÚNG danh sách này — không thêm, không bớt:**

1. Bất kỳ **money contract** mới/đổi: bảng, cột, enum value, endpoint hay allocation rule trên đường
   tiền.
2. Bất kỳ thay đổi **PII/identity** contract, hoặc chạm **5 HARD RULES**.
3. **Sửa nội dung contract của spec đã `Reviewed`** (sửa link hỏng / số stale là Tier A; thêm
   entity/cột/endpoint là Tier C).
4. **Migration** đổi semantics schema, hoặc migration trên tail dùng chung với lane khác đang bay.
5. **Enablement**: lật feature flag / env bật behavior ở production, gồm
   `OUTBOX_DISPATCH_SCHEDULE_ENABLED` và `GOOGLE_OAUTH_*`.
6. **Merge, deploy**, hay bất kỳ side effect ngoài worktree.
7. Việc đòi **mở rộng ra ngoài negative scope** — re-slice hoặc AWAIT, không bao giờ nới im lặng.
8. Review finding **bị phản đối** (agent cho là reviewer sai). Finding đã chấp nhận là Tier B.

> Tier C không phải quan liêu sót lại. `DD-106` (2026-08-13) tồn tại vì một spec pass đã viết một
> money contract — `buddy_payment_requests`, `payment_allocations.source='buddy'` — vào **hai spec
> Reviewed** mà không có decision. Không ai liều lĩnh cả; contract chỉ đơn giản không có cách rẻ nào
> để nói "cái này cần owner". Mục 1–3 là bài học đó, đã định giá.

**Một luật hạ bậc, quan trọng khi chọn lane:** thay đổi được **một decision record authorize đích
danh** là **Tier A, không phải Tier C** — owner đã quyết rồi; thi hành một quyết định đã viết không
phải là ra quyết định mới. Phép thử hẹp: DD phải **nêu tên artifact và tên thay đổi**, không chỉ tán
thành hướng đi. "Ta nên cải thiện X" **không authorize gì cả**.

**Hệ quả khi chọn việc: xếp hạng lane theo MẬT ĐỘ TIER C, không theo kích thước.** Một lane lớn mà
mọi quyết định đã viết sẵn thì chạy thẳng tới READY; một lane nhỏ với ba câu hỏi contract chưa quyết
sẽ dừng ba lần.

**Tiêu chí quyết:** lợi ích dài hạn tối đa cho project, không phải cái đóng vòng hiện tại nhanh nhất.

*Phép thử:* **liệu lựa chọn này còn đúng nếu project có gấp 10 lần bề mặt trong sáu tháng nữa?** Nếu
câu trả lời trung thực là "sẽ phải làm lại", thì nó sai ngay cả khi hôm nay qua gate.

*Tie-break, theo thứ tự — trên thắng dưới:*

1. **Fail-closed hơn tiện tay.** Một lần deny sai còn cứu được; một lần allow sai trên đường tiền/tenant
   thì có thể không.
2. **Một nguồn sự thật hơn định nghĩa thứ hai.** Hai định nghĩa của cùng một predicate sẽ drift, và
   drift thì im lặng. (`0032` tồn tại vì `assert_dm_allowed` đã mọc ra cách đọc thứ hai của cùng bốn
   toggle.)
3. **Ít khái niệm hơn nhiều.** Bảng/role/abstraction mới phải tự chứng minh mình hơn việc tái dùng cái
   đã có.
4. **Nhất quán với tiền lệ hơn tối ưu cục bộ.** `auth.ts` và `authorization.ts` ở `packages/db/src` thì
   service mới cũng ở đó, kể cả khi chỗ khác đọc mượt hơn.
5. **Đảo được hơn khôn khéo.**

Hoà cả năm ⇒ chọn cái để lại **nhiều bằng chứng hơn cho người đọc sau** (một constraint có tên, một
test, một comment nói *vì sao*) — và nói ra điều đó trong ledger.

**Budget là tín hiệu, không phải gate.** Overrun **không bao giờ** dừng lane vì một con số. Agent
hoặc (a) re-slice trong scope đã khai, hoặc (b) tiếp tục và log entry overrun nêu **lý do thiết kế**.
Cả hai là Tier B. Overrun lần hai cùng nguyên nhân là **tín hiệu thiết kế** — dừng vá, re-slice.
Overrun chỉ giải được bằng cách chạm negative scope ⇒ Tier C.

**Sau `HALT MAX_ROUNDS` / `REGION_THRASH`:** mở successor được pre-authorize khi **cả hai**: finding đã
được chấp nhận (không bị phản đối) **và** agent gọi tên được một **nguyên nhân thiết kế**, không phải
một danh sách triệu chứng. Ngược lại ⇒ AWAIT. *"Thử lại chăm hơn" không phải nguyên nhân thiết kế.*

**Decision Ledger** — `.autopilot/state/<feature>/DECISIONS.md`, **append khi quyết**, không dựng lại
lúc cuối:

```text
## D<n> · <tier A|B> · <one-line decision>
Context:      <cái gì buộc phải chọn>
Searched:     <query chính xác đã chạy trên docs/ và packages/, và kết quả —
               kể cả những query trả về rỗng>
Alternatives: <đã cân nhắc gì khác, vì sao không>
Reasoning:    <tie-break nào áp dụng, và phép thử 10x>
Evidence:     <file/dòng/commit chính xác đã đọc; nêu bậc precedence đã dựa vào>
Reversible:   <yes/no — nếu no, biện minh vì sao đây không phải Tier C>
```

Ledger **rỗng** trên một lane không tầm thường là **red flag**, không phải "chạy sạch".

**Điều kiện vào mode:** risk `P1` hoặc `P2` · packet ở strict `CODE_READY` · scope và negative scope
liệt kê tới cấp file · verification chạy được bằng gate · reviewer pin gọi được · đã thật sự nạp phần
always-load. **`P0` không bao giờ đủ điều kiện.**

### 7.4 Precedence khi tự quyết (bản cho worker — `autopilot-prompt-GENERIC.md`)

Mặc định: **quyết, ghi lý do và phương án á quân, đi tiếp.** Thứ bảo vệ khỏi một quyết định sai không
phải là việc bạn đã hỏi; mà là quyết định đó **hiện rõ và đảo được** ở ranh giới merge — nơi owner vẫn
đang giữ.

1. Fail-closed & least-privilege — không bao giờ đổi lấy bất cứ thứ gì bên dưới.
2. Đúng dưới concurrency và partial failure — thiết kế chỉ đúng khi không có race thì không phải là
   đúng.
3. Đảo được.
4. Không tạo nợ phụ thuộc vào trí nhớ — một ngoại lệ mà ai đó phải nhớ dọn thì tệ hơn một fix hẹp
   không cần nhớ.
5. Deadline và buffer.
6. Scope minimalism — không nâng cấp/dọn dẹp/refactor ăn theo.
7. Mới và gọn — ưu tiên thấp nhất. "Latest" không phải lý do.

**Escalate lên owner chỉ khi:** hành động không đảo được ngoài worktree · nó đổi *sản phẩm là gì* ·
nó mâu thuẫn một quyết định đã ghi trong repo (được phép cãi, **không** được lặng lẽ lật) · project
thật sự chưa từng bày tỏ ưu tiên và bậc 1–4 không phân tách được — khi đó hỏi **một lần** và bắt câu
trả lời được ghi vào decision log.

> "Bảo mật ở đây thì thoải mái vì đang gấp" = bậc 5 đang cố lật bậc 1. Đó đúng là thứ thang này sinh
> ra để chặn.

---

## 8. Breaker, terminal state, và điều cấm

### 8.1 Loop breaker (cứng)

| Breaker | Điều kiện | Kết quả |
|---|---|---|
| `MAX_ROUNDS` | `fix-round-count > 5` | HALT — **hard stop**, không "thêm một vòng nữa" kể cả khi finding vẫn thật và vẫn khác nhau |
| `REGION_THRASH` | Cùng `file:region` bị nêu ≥3 vòng liên tiếp | HALT — thrash là **mùi thiết kế**, hội tụ về thiết kế sạch, đừng vá mép |
| `SLICE_TOO_LARGE` | Finding **lan ra** nhiều file/vùng khác nhau vòng này qua vòng khác | HALT + re-slice — slice quá to / thiếu đặc tả |
| `TOOL_UNAVAILABLE` | Reviewer/verifier không gọi được | HALT — cấm tự hạ gate |

### 8.2 Terminal state

| State | Nghĩa | File sentinel |
|---|---|---|
| `READY` | Scope + verification + review đủ; gate đã chạy trực tiếp; diff chính xác | `<STATE_DIR>/READY.txt` (chỉ do gate ghi sau khi `gate-result.json` pass) |
| `AWAIT` | Thiếu **đúng một** quyết định/context/authority bên ngoài, kèm một đề xuất + điều kiện resume nhị phân | `<STATE_DIR>/AWAIT-FOUNDER-<reason>.txt` |
| `HALT` | Breaker cứng về safety/scope/authority/tool/loop | `<STATE_DIR>/HALT-<REASON>.txt` |

`READY` báo cáo: outcome · file/slice đã đổi · bằng chứng test/build/review/security · rủi ro còn lại
· **hành động merge/deploy chính xác cần owner** · và (ở mode `autonomous_to_ready`) **Decision
Ledger** — READY không có ledger là **chưa hoàn tất** ở mode đó.

Ở `autonomous_to_ready`, **AWAIT bị giới hạn trong danh sách Tier C**. AWAIT cho một item Tier A/B là
**vi phạm contract**: giải nó và ghi lại việc phân loại sai vào ledger. **Con số budget không bao giờ
là lý do AWAIT hợp lệ ở mode này.**

### 8.3 Điều tuyệt đối cấm

- **Không bao giờ xoá/đổi tên/di chuyển file `HALT-*` hoặc `AWAIT-FOUNDER-*`.** Không để tự gỡ chặn
  mình, không kể cả khi halt rõ ràng là lỗ hổng setup chẳng phán xét gì, không kể cả khi việc dọn nó
  rõ ràng là đúng. Viết một AWAIT mô tả cái bạn thấy rồi dừng. *Hai lần trong hai ngày một session suy
  luận đúng rằng halt đó là pre-review — `fix-round-count` = 0, không có `gate-attempt-count.txt`,
  `regions.log` rỗng — và hành động theo suy luận đó, và cả hai lần registration phải đóng lại.* Chính
  việc phân loại đúng là thứ khiến xoá nó **cảm thấy** an toàn, nên luật này ràng buộc trên **HÀNH
  VI**, không trên lý lẽ. **Bên hưởng lợi từ việc gỡ một blocker không bao giờ là bên được gỡ nó.**
- **Khi một gate bắn đúng, không bao giờ sửa thứ mình đưa vào gate.** Nới `scope`, sửa `invariants`,
  xoá sentinel, đổi `verification` — cấm **kể cả với ý định chẩn đoán**: "tôi nới scope để xem cái gì
  bắn tiếp" và "tôi nới scope để đi qua" là **cùng một hành động** và sinh ra **cùng một artifact**;
  gate không phân biệt được, người đọc sau cũng không. **Dấu hiệu nhận biết: nếu edit tiếp theo của
  bạn làm check pass mà không đụng gì tới thứ check đang nói về, thì DỪNG.** Chẩn đoán vẫn được phép —
  nhưng **read-only**: đọc source của gate, chạy nó trên fixture nháp ngoài reservation, suy từ text
  lỗi.
- Không `git push --force`. Không `git add -A` (stage từng file). Không chạm file/module/branch ngoài
  scope. Không dọn destructive WIP không liên quan.
- Một worktree, một live writer cho mỗi writing slice. Writing agent **không bao giờ** mutate
  repo-root/default trực tiếp.
- P0 live action là prepare-only tới khi owner cấp quyền thực thi.
- **Level 3 không hàm ý auto-merge**, cũng không hàm ý quyền làm external action quan trọng.

### 8.4 Slice phát hiện thứ ngoài scope thì làm gì

Từ chối sửa file ngoài scope là **kỷ luật đúng** — nhưng khi đó finding chỉ sống trong transcript, mà
**transcript không phải hàng đợi: không có gì quét nó.** Trước khi tới terminal state, **ghi mọi
finding ngoài scope vào backlog/tracker** như một entry riêng, dù chỉ một dòng placeholder. Đây là
**ngoại lệ tường minh của negative scope**, giới hạn ở file backlog/tracker, và là **một phần của
deliverable**, không phải phép lịch sự.

---

## 9. Nhiều session, một `.git/index` — root-lock

`autopilot-scope-gate` serialize **worktree** theo file scope + invariant token. Nó **không** canh
root working copy. Nhiều session Cowork/Claude Code chạy chung một git identity và, khi cùng ngồi ở
repo root, chia nhau **một `.git/index`**. Sự cố 2026-07-22 (`eba1c27`): một session `git commit`
trong khi file của session khác đang staged; commit cuốn nội dung của session kia vào dưới message của
mình rồi push. Slice thật (`6f8f628`) không bao giờ tới `main` và branch của nó bị `ap-finish` xoá sau
đó.

Cơ chế đóng lại:

```bash
git config core.hooksPath .githooks        # bật một lần / mỗi clone

scripts/autopilot-root-lock acquire --owner '<who-you-are>'
export PLEXCO_COMMIT_OWNER='<who-you-are>'
git commit -- <explicit paths>             # không bao giờ `git commit -a`, không bao giờ bare commit
scripts/autopilot-root-lock release --owner '<who-you-are>'
```

`.githooks/pre-commit` chặn **đúng ca hẹp**: root working copy **AND** branch == `main` **AND** caller
không giữ lock. Commit trong linked worktree đi qua không bị đụng; commit trên feature branch ở root
copy cũng qua. Ba mã chặn: `ROOT_COMMIT_UNLOCKED` · `ROOT_COMMIT_NO_OWNER` · `ROOT_COMMIT_WRONG_OWNER`.

Lock **cố ý không tự cướp khi stale** — auto-steal chính là race check-then-act mà nó sinh ra để loại
bỏ. `status` in tuổi lock để người quyết; `release --force` làm quyết định đó tường minh và audit
được.

---

## 10. Verification & CI

### 10.1 Lệnh canonical

```bash
DATABASE_URL_TEST=postgres://plexco:plexco_dev@localhost:5432/plexco_test pnpm test
# harness BẮT BUỘC DATABASE_URL_TEST (packages/db/src/test-harness.ts). KHÔNG dùng DB_PATH/SQLite.
# local: docker compose -f infra/docker-compose.yml up -d postgres   (chạy trước)
```

`pnpm test` = `test:review-readiness` **rồi mới** `pnpm -r run test` — lớp validator luôn chạy trước
workspace tests. Các lệnh khác: `typecheck` · `lint` · `build` · `format:check` ·
`check:quick` (lint + test:core) · `smoke:predeploy` · `test:core|db|web|bot` · `db:bootstrap`.

> ⚠️ **Đọc đúng phạm vi con số test.** Số workspace (vitest) và số full-run (workspace + validator) là
> **hai thang đo khác nhau**; trộn chúng đã tạo ra một "mismatch" không tồn tại trong `HANDOFF` v1.32.
> Và **static count ≠ runner output**. Cách duy nhất đúng: chạy canonical runner rồi khai số đó, kèm
> SHA đo được.

### 10.2 CI

`.github/workflows/ci.yml` — trigger: push `main` + `feat/**`, và mọi PR. `concurrency` +
`cancel-in-progress` (run bị đẩy lùi bởi push mới trên cùng ref thì huỷ), `timeout-minutes: 20`.
Service container `postgres:16-alpine`. **`fetch-depth: 0` là bắt buộc** — bước review-readiness chạy
`git merge-base --is-ancestor <AUTHORITY_SHA> main` cho mọi verdict đã pin; shallow checkout làm mọi
pin fail `AUTHORITY_NOT_MAIN`.

Thứ tự bước: Install (`pnpm install --frozen-lockfile`, **không** `-w`) → Typecheck → **Format** →
**Review-readiness policy (`pnpm -w review:check`)** → Lint → Build → Ensure `psql` →
`pnpm db:bootstrap` (provision `job_definer`; service container khởi động **trước** checkout nên
`infra/postgres-init` không thể chạy qua docker-entrypoint ở đây) → Test.

`.github/workflows/security.yml` — Semgrep CE (`--config auto --error`, image pin theo digest) +
OSV diff trên PR/merge_group + OSV full scan trên push/schedule (`cron: 37 15 * * 3`) /
`workflow_dispatch`. Mọi action pin theo **full SHA**, SARIF upload tắt (repo private, không GHAS).

`.github/workflows/linear-sync.yml` — cron 6h (từng là `*/10` và làm cạn quota Actions).

### 10.3 Prettier / lint

`.prettierignore` loại toàn bộ `docs/`, `templates/`, `infra/`, `scripts/`, `*.md`, `*.html`, `*.csv`
và hầu hết `*.json`. Nên **doc markdown không bị `format:check` soi** — nhưng code trong
`packages/`/`apps/` thì có.

### 10.4 GitNexus — code intelligence

Repo được index là `plexco-app`. Luật trong `CLAUDE.md`/`AGENTS.md`:

- **BẮT BUỘC** chạy `gitnexus_impact({target, direction:"upstream"})` **trước khi** sửa bất kỳ
  function/class/method, và báo blast radius cho user.
- **BẮT BUỘC** `gitnexus_detect_changes()` **trước khi commit**.
- **BẮT BUỘC** cảnh báo user nếu impact trả HIGH/CRITICAL.
- Khám phá code lạ: `gitnexus_query({query})` thay vì grep. Context đầy đủ một symbol:
  `gitnexus_context({name})`. Đổi tên: `gitnexus_rename`, **không** find-and-replace.
- Tool báo index stale ⇒ chạy `npx gitnexus analyze` trước.

Cùng ý với luật `autopilot-invariants.md`: **đừng debug bằng cách đọc cả repo** — nạp handoff/README
trước, rồi dùng code intelligence xác định flow/symbol/caller/blast radius, rồi mới đọc file trong
bán kính đó.

---

## 11. Bản đồ file — cái gì ở đâu

### 11.1 Luật & template

| File | Vai trò |
|---|---|
| `CLAUDE.md` / `AGENTS.md` | Auto-load. 10 điều review policy · luật ngôn ngữ · block Level 3 · block GitNexus |
| `docs/00-start-here/HANDOFF.md` | **Đọc đầu tiên.** Live truth, kiến trúc, 5 HARD RULES, doc map, bẫy |
| `docs/00-start-here/identity-model.md` | Orientation identity — **không** phải source of truth |
| `docs/standards/review-code-readiness-gate.md` | **Policy canonical của Ray A** (v1.3) |
| `docs/templates/review-doc-plan-session-template.md` | Template thực thi bắt buộc của Ray A (v1.3) |
| `.claude/commands/review-doc-plan.md` | Launcher `/review-doc-plan` |
| `docs/autopilot-ONBOARDING.md` | **Entry point vận hành duy nhất** của Ray B |
| `docs/autopilot-templates/level3-workflow.md` | **Contract canonical của Ray B** |
| `docs/standards/plexco-level3-autonomy.md` | Local supplement của §6.1 `autonomous_to_ready` (DD-107): gắn luật generic của canonical vào file + bằng chứng của Plexco — consumer-owned, kit sync không ghi đè, `CLAUDE.md`/`AGENTS.md` trỏ tới |
| `docs/autopilot-templates/level3-handoff.md` | Thứ tự authority + checklist mở task mới |
| `docs/autopilot-templates/autopilot-invariants.md` | Invariant ALWAYS-APPLY (@import vào `~/.claude/CLAUDE.md`) |
| `docs/autopilot-templates/autopilot-prompt-GENERIC.md` | Worker contract — dùng làm send-file khi soạn prompt task |
| `docs/autopilot-invariant-catalog.md` | Token domain chuẩn cho `invariants:` |
| `docs/autopilot-parallel-scope-gate.md` | WHY của scope-gate (worktree không đủ) |
| `docs/autopilot-backlog.md` | Backlog machine-scannable |
| `docs/autopilot-manifests/_TEMPLATE.json` | Khuôn **runtime** manifest (+ `_READINESS_EVIDENCE_TEMPLATE.json`) |
| `docs/autopilot/contracts/autopilot-<slug>.md` | Packet/slice doc của từng slice |
| `.claude/commands/ap-NN-<slug>.md` | Launcher từng slice |
| `.autopilot/maturity-ledger.md` | Sổ tín nhiệm per-repo (TRACKED) |
| `docs/kit-design-debt.md` | Register câu hỏi thiết kế kit còn mở |
| `docs/templates/feature-spec-template.md` | Khuôn Product/UX spec (7 section) |
| `docs/templates/be-tech-spec-template.md` | Khuôn BE tech spec (6 section) |
| `docs/features/README.md` | Document Convention + coverage index |

### 11.2 Script

| Script | Làm gì |
|---|---|
| `scripts/autopilot-scope-gate` | `register \| ready \| cleanup`. Lock mkdir atomic, catalog, dep_checks, collision, hash-lock manifest |
| `scripts/autopilot-review-readiness.mjs` | Validator Level 3: resolve manifest, base/worktree/contract, chạy verification, chạy Codex round, ghi `gate-result.json` |
| `scripts/codex-review-pin.sh` | Reviewer độc lập pin. Bind mỗi round vào HEAD/base/diff hiện tại |
| `scripts/ap-merge.sh` | Squash-merge không thể chạy nửa vời |
| `scripts/ap-finish.sh` | Dọn worktree/reservation **chỉ sau** landing hoặc disposition tường minh; archive state dir |
| `scripts/ap-housekeep.sh` | Housekeeping read-only sau terminal state |
| `scripts/autopilot-root-lock` | Mutual exclusion cho commit ở root working copy |
| `scripts/autopilot-backlog-reconcile` | `--check` / `--fix` — chống backlog stale sau merge |
| `scripts/autopilot-onboard.sh` | Setup máy (idempotent; `--check` chỉ kiểm) |
| `scripts/check-review-readiness.mjs` | Validator Ray A (`pnpm review:check[:changed]`) |
| `scripts/smoke-predeploy.mjs` | Smoke trước deploy |
| `.githooks/pre-commit` | Chặn commit `main` từ root copy khi không giữ root-lock |

### 11.3 Quy ước thư mục

- `docs/autopilot-*` = **luật/kit** (tracked).
- `.autopilot/` = **runtime** (gitignored), trừ `.autopilot/maturity-ledger.md` được whitelist.
  Bên trong: `INFLIGHT.md` (registry), `state/<feature>/` (counters, sentinel, gate artifacts),
  `worktrees/<feature>/`, `landings/`, `dispositions/`, `state-archive/`, `ROOT-COMMIT.lock`.
- `docs/archive/` **không phải authority** — đọc `docs/archive/README.md` trước khi hồi sinh gì trong
  đó.
- `progress.json` + `plexco-dashboard.html` = tiến độ **phase/module**; `docs/autopilot-backlog.md` =
  task autopilot song song. Flow hiện **không** dùng Linear.

---

## 12. Sổ tay lệnh

```bash
# ── Setup một lần / mỗi máy ───────────────────────────────────────────────
scripts/autopilot-onboard.sh --codex /abs/path/to/codex
source ~/.zshrc
scripts/autopilot-onboard.sh --check         # chỉ kiểm, không ghi
git config core.hooksPath .githooks

# ── Mở một slice ──────────────────────────────────────────────────────────
BASE_SHA=$(git rev-parse origin/main)
git worktree add ".autopilot/worktrees/$FEATURE_ID" -b "feat/$FEATURE_ID" "$BASE_SHA"
cd ".autopilot/worktrees/$FEATURE_ID"
git rev-parse HEAD                            # phải == $BASE_SHA
mkdir -p ".autopilot/state/$FEATURE_ID"
cp ../../../docs/autopilot-manifests/_TEMPLATE.json ".autopilot/state/$FEATURE_ID/manifest.json"
# … điền manifest …
export AUTOPILOT_CODEX_BIN="$PWD/scripts/codex-review-pin.sh"
scripts/autopilot-scope-gate register --manifest ".autopilot/state/$FEATURE_ID/manifest.json"
ls ".autopilot/state/$FEATURE_ID/registered-manifest.sha256"   # PHẢI tồn tại

# ── Verify ────────────────────────────────────────────────────────────────
DATABASE_URL_TEST=postgres://plexco:plexco_dev@localhost:5432/plexco_test pnpm test
pnpm typecheck && pnpm lint && pnpm build
pnpm review:check:changed                    # nếu có chạm docs review/readiness

# ── READY → merge → dọn ───────────────────────────────────────────────────
scripts/autopilot-scope-gate ready --manifest ".autopilot/state/$FEATURE_ID/manifest.json"
cd "$(git rev-parse --git-common-dir)/.." && git checkout main
scripts/autopilot-root-lock acquire --owner '<label>'
export PLEXCO_COMMIT_OWNER='<label>'
scripts/ap-merge.sh "$FEATURE_ID" -F /tmp/msg.txt --probe 'path/file.ts::needle' --test --push
scripts/autopilot-root-lock release --owner '<label>'
scripts/ap-finish.sh "$FEATURE_ID"           # hoặc --squash-verified <sha> / --authorized-close --reason …

# ── Đo, đừng chép ─────────────────────────────────────────────────────────
awk '/^# KIT_VERSION:/{print $3; exit}' scripts/autopilot-scope-gate
ls packages/db/migrations/ | tail -1
grep -m1 '^> \*\*Version' docs/features/FE/*.md docs/features/BE/*.md
git worktree list
scripts/autopilot-backlog-reconcile --check
```

---

## 13. Anti-drift — luật giữ cho doc không mục

Từ `level3-workflow.md` §12. Mỗi luật tồn tại vì một repo đã trả giá cho sự vắng mặt của nó.

- **Đừng hard-pin một giá trị người đọc có thể tự đo.** SHA, số version, số file, số test, migration
  tail viết vào prose là stale ngay khi thứ nó mô tả nhúc nhích — và nó **đọc như sự thật đúng vì nó
  cụ thể**. Trỏ vào phép đo (`awk '/^# KIT_VERSION:/{print $3; exit}' scripts/autopilot-scope-gate`),
  hoặc phát biểu giá trị đó dưới dạng **điều kiện tự verify**.
- **Khi phép đo mâu thuẫn contract, phép đo thắng — và bất đồng đó được GHI LẠI, không sửa im lặng.**
  Một con số đo một lần rồi chép tới là một khẳng định về quá khứ. Nói rõ bạn đọc nguồn nào, khi nào,
  và cái gì đã đổi. Lặng lẽ cập nhật con số **huỷ mất bằng chứng rằng ước lượng đã sai**, mà đó thường
  mới là phát hiện hữu ích hơn.
- **Một phán quyết `not required` cần một điều kiện làm nó vô hiệu.** `SECURITY_REVIEW: not required`
  mà không có escape clause là một quyết định đóng băng trước những sự thật chưa biết. Viết cả **lý
  do** lẫn **trigger**.
- **Ưu tiên DE-PIN hơn RE-PIN.** Khi một con số pin bị mục, cách sửa rẻ là cập nhật số, cách sửa bền
  là **bỏ hẳn cái pin**. Cập nhật mua thêm thời gian tới lần đổi kế tiếp; de-pin **kết thúc cả lớp
  lỗi**. Một đợt sweep thay migration tail hard-pin bằng "verify tail hiện tại tại `<dir>`" sau đó đã
  cứu 17 file khỏi đợt sweep thứ hai.

---

## 14. Bẫy đã trả giá — danh sách rút gọn

| Bẫy | Hệ quả đã xảy ra |
|---|---|
| Truyền **authored** manifest vào `register` | Mất một vòng đăng ký (nay HALT `CONTRACT_INVALID` thay vì fail-open) |
| Bỏ bước tạo **runtime** manifest | `scope-gate ready` halt mọi slice trong repo tới 2026-07-30. Slice bỏ bước này **không được gate yếu hơn — nó không có gate nào cả** |
| `--base HEAD^` cho reviewer | Vòng review chỉ đọc commit fix, âm thầm bỏ phần còn lại của slice |
| Gọi reviewer khi fix **chưa commit** | Fix nằm ngoài `<base>...HEAD`; base == HEAD ⇒ **không có vòng nào** |
| Pin literal vào `verification` | Manifest hash-locked ⇒ literal stale bắt close-and-re-register cả lane |
| Viết văn xuôi vào `verification` | Bị `spawn` như lệnh shell ⇒ fail mọi lần thử |
| Đặt thư mục vào `scope` | Gate từ chối; hoặc path thiếu ⇒ `SCOPE_DRIFT` giữa run |
| Đặt tên slice theo **GOAL-word** thay vì **MECHANISM** | Model tự phát minh cả một subsystem enforcement mà slice không hề yêu cầu. Negative scope phải **gọi tên** subsystem hấp dẫn-nhưng-cấm |
| Merge bằng runbook nhiều bước dán vào terminal | 2026-07-22: commit mang subject của slice nhưng chứa hai file docs không liên quan; slice thật không bao giờ tới `main` |
| `git status --porcelain` làm cổng "cây sạch" | Tính cả untracked ⇒ luôn báo bẩn ⇒ bỏ hẳn bước merge, vẫn push và xoá branch |
| `git pull --ff-only` để hỏi "main có bằng origin không" | Mượn cả cỗ máy merge ⇒ thừa hưởng failure mode rộng hơn câu hỏi (`Cannot fast-forward to multiple branches` khi hai bên đang bằng nhau) |
| Không chạy `backlog-reconcile --fix` sau merge | Bot quét backlog rồi launch lại slice **đã xong** — đốt trọn một session (đã xảy ra 2026-07-25 với 7 slice, và 2026-07-29) |
| Xoá worktree trước khi archive state | 7739 byte chi tiết fix đã chẩn đoán biến mất không dấu vết (đã vá ở v31) |
| Copy một gate design-probe sang manifest khác **mà không copy lý do** | "Một gate thừa kế mà không có lý do của nó trở thành nghi thức" — một stop nghi thức không phân biệt được với một stop thật |
| Thiết kế schema từ nguyên tắc chung mà chưa đọc canonical | Đề xuất sai + tạo bảng song song (bài học identity 2026-07-02) |
| Viết contract vào spec **đã Reviewed** mà không có decision | `DD-106`: money contract `buddy_*` lọt vào hai spec Reviewed |
| Suy luận ngôn ngữ từ các doc xung quanh thay vì kiểm **lớp người đọc** | 2026-08-09: 10 slice prompt viết bằng tiếng Việt |
| Tin một `grep` trả rỗng | `awk` viết cho backtick chạy trên catalog dùng em-dash → rỗng hai lần → đọc thành "không có dữ liệu" |
| Tin `git worktree list` chạy từ phiên Cowork | Đường dẫn mount khác đường dẫn worktree đăng ký ⇒ mọi linked worktree bị báo `prunable` sai. Đo lại từ shell thật |
| Chạy lệnh git ghi từ phiên Cowork | Để lại `.git/index.lock` mà sandbox không unlink được ⇒ chặn `git commit` của owner |
| Trộn thang đo test (workspace vs full-run vs static) | Một phiên reconcile khai một mismatch "lệch 11" **không tồn tại** |

---

## 15. Ghi chú lệch đo được (2026-08-21) — và cái gì đã được đóng

Ghi ra theo đúng luật §13 — *khi phép đo mâu thuẫn contract, phép đo thắng và bất đồng được ghi lại*.

| # | Lệch | Trạng thái |
|---|---|---|
| 1 | `CLAUDE.md` §Workflow bước 3 mô tả `register` là fail-OPEN với authored path. KIT_VERSION 31 kiểm `manifest_schema_version` **ngay câu lệnh đầu nhánh `register`** và `HALT CONTRACT_INVALID` | ✅ **Đã sửa 21/08** — giữ cả hai lớp lịch sử, de-pin số dòng, giữ lời khuyên kiểm `registered-manifest.sha256` |
| 2 | Khối LIVE TRUTH mới nhất của `HANDOFF.md` (v1.34) pin `93f1e93`; `main` là `a151b15`, đi trước **11 commit**, có chạm `packages/db/` | ✅ **Đã re-pin 21/08** — khối **v1.35** ở đầu file |
| 3 | Khối v1.34 đã được viết vào `HANDOFF.md` (`2b07ef9`) nhưng **chưa từng có dòng changelog** | ✅ **Đã backfill 21/08**, đánh dấu rõ là backfill |
| 4 | Các khối LIVE TRUTH xếp thời gian **tăng dần** ⇒ đọc xuôi gặp khối **cũ nhất trước**, ngược ý định của chính chúng | ✅ **Đã đổi từ v1.35** — khối mới nhất nằm trên cùng |
| 5 | `decisions.md` tự khai `v2.34`, nhưng `a151b15` thêm **DD-112** mà không kèm dòng changelog ⇒ ô version under-report một DD | ⬜ **Còn mở** — đọc DD mới nhất bằng `grep -nE '^## DD-1[01][0-9]' docs/standards/decisions.md \| tail -5`, đừng tin ô version |
| 6 | Reservation mồ côi `docs-impact-policy-contract--price-only` giữ khoá 3 invariant + 7 file docs | ✅ **Đã đóng 21/08** — xem §15.1 |
| 7 | Bản nháp v1.35 khai worktree là `prunable` — **đo sai** qua mount Cowork | ✅ **Đã đính chính 21/08** — xem §15.2 |

### 15.1 ✅ Reservation mồ côi — đã đóng 21/08

`.autopilot/INFLIGHT.md` ghi `status: in-flight` cho `docs-impact-policy-contract--price-only`, nhưng
lane đã **`HALT MAX_ROUNDS` ngày 17/08**: `fix-round-count` = 5/5 · `gate-attempt-count` = 6 ·
`pending-review-finding.json` còn active · **không có** bản ghi nào trong `.autopilot/landings/` hay
`.autopilot/dispositions/`. Nó đang giữ khoá `session-lock-ordering` · `api-contract` ·
`i18n-surface` + 7 file docs ⇒ mọi slice chạm các thứ đó sẽ `HALT SCOPE_COLLISION`.

Đóng lúc **13:02Z 21/08** bằng đúng đường sanctioned:

```bash
scripts/ap-finish.sh docs-impact-policy-contract--price-only \
  --authorized-close --reason "HALT MAX_ROUNDS 17/08; design cause: ...; successor dang ky moi tu main"
```

Kết quả verify được trên đĩa:

| Bằng chứng | Trạng thái |
|---|---|
| `.autopilot/dispositions/docs-impact-policy-contract--price-only.json` | `schema_version: level3-disposition-v1` · `status: authorized_close` · `head_sha: 2d4861b` · `origin_proof_sha: null` (không claim merge) |
| `.autopilot/state-archive/docs-impact-policy-contract--price-only-20260821T130206Z/state/` | **40 file** — `HALT-MAX_ROUNDS.txt`, `DECISIONS.md`, `regions.log`, 6 gate-attempt |
| `.autopilot/INFLIGHT.md` | block đã bị `cleanup` gỡ |
| `feat/docs-impact-policy-contract--price-only` | **branch giữ lại** để tra cứu |
| `scripts/autopilot-backlog-reconcile --check` | `No stale entries` (exit 0) — không cần `--fix` |

Thứ tự trong `ap-finish.sh` đáng nhớ: **archive state dir → remove worktree → ghi disposition →
`cleanup`**. Archive đứng trước xoá là toàn bộ lý do v31 tồn tại (§6 bước 9).

Successor **được pre-authorize** theo `plexco-level3-autonomy.md` §6.1 — design cause gọi tên được (packet
reconcile manifest tích tụ 3 lớp thay vì author một manifest price-only sạch; reviewer attempt-01 đã
đề nghị đúng cách kia) và finding đã accept — nhưng phải **register mới từ `main` sạch**.

### 15.2 ⚠️ `git worktree list` qua mount Cowork báo `prunable` SAI

Bản nháp đầu của tài liệu này và của khối HANDOFF v1.35 đều khai ba worktree là `prunable`, và dùng
điều đó làm một phần lý do phải đóng gấp. **Đo lại sau khi đóng cho thấy đó là lỗi đo:**

| Đo từ đâu | `git worktree list` nói gì |
|---|---|
| Shell thật của owner (`/Users/maingocanh/Projects/Plexco app`) | hai worktree PublishSession **KHÔNG** `prunable` |
| Phiên Cowork (`/sessions/<id>/mnt/Plexco app`) | **CÓ** — cả hai bị flag `prunable` |

Nguyên nhân: worktree đăng ký đường dẫn `/Users/…` trong metadata, còn sandbox nhìn cùng repo ở
`/sessions/…/mnt/…`; git không khớp được gitdir nên xếp chúng vào `prunable`.

**Luật rút ra: mọi phán đoán về `prunable` đo từ một phiên Cowork là vô giá trị — phải đo lại từ shell
thật trước khi hành động.** Đây đúng là ca mà `autopilot-prompt-GENERIC.md` cảnh báo: *một phép đo trả
lời câu hỏi bên cạnh trông y hệt một phép đo đúng*.

Hệ quả phải đọc lại, chứ không xoá: câu *"cả hai forensics worktree bị flag `prunable`"* trong
`5186655` (15/08) có thể đến từ **cùng một artifact**. Bản archive mà commit đó tạo ra **vẫn primary
và vẫn có giá trị** — chỉ **lý do** cần đọc lại. Còn lý do đóng `--price-only` thì **không** phụ thuộc
vào `prunable`: registry `in-flight` + không disposition record + `pending-review-finding` còn active,
cả ba đều verify độc lập được.

### 15.3 Sổ tín nhiệm về chính file này

`docs/slice-readiness-verdicts.md` dừng ở **Verdict 31** — **không** phải "không slice nào được review
từ 06/08". Từ AP-45 trở đi, verdict block nằm trong packet của chính slice tại
`docs/autopilot/contracts/`.

Và về file bạn đang đọc: nó là **derived doc**, sẽ mục đúng như mọi doc khác. Khi nó lệch file gốc
được trích dẫn ngay cạnh mỗi mục, **file gốc thắng** — rồi sửa ở đây.
