# Template — Review Docs / Plans → Readiness Verdict

> **Status:** ✅ Required · **Version:** 1.0 · 2026-07-19
> **Canonical policy:** `../standards/review-code-readiness-gate.md`
> **Dùng cho:** mọi session review, reconcile, fix, re-check hoặc final decisions, analysis, feature specs, technical plans, implementation plans và doc packs.
> **Kết quả bắt buộc:** một verdict nhị phân có bằng chứng; không kết thúc bằng “gần final”.

---

## 0. Session input

Điền trước khi review:

```text
REQUEST: <review | fix-and-recheck | final-readiness>
TARGET_FILES:
  - <exact path>
EXPECTED_OUTCOME: <decision final | plan ready | code ready | consistency only>
BASE_BRANCH: <actual default branch>
SCOPE_REPO: <absolute repo path>
USER_AUTHORIZED_EDITS: yes | no
```

Nếu user chỉ nói “review/check/updated/final”:

- `review/check`: read-only findings + verdict, không tự patch.
- `updated`: mở lại file mới nhất trên disk, re-run exact checks; không tin verdict cũ.
- `fix/fix luôn`: patch trong scope, re-check, sau đó verdict.
- `final`: chỉ tuyên bố trạng thái qua canonical gate; không hiểu là user tự động authorize code/commit/deploy.

---

## 1. Mandatory reads

Trước mọi verdict:

1. Root `AGENTS.md` và `CLAUDE.md` phù hợp agent.
2. `../standards/review-code-readiness-gate.md` — canonical policy.
3. Toàn bộ target files trong session input.
4. Authority và dependent specs mà target cite.
5. Live truth sources: schema, migrations, code/services/routes, auth/RLS/grants, tests và current default-branch state.

Docs là index. Khi docs và live repo mâu thuẫn, không được chấm PASS cho tới khi authority/contract được reconcile.

---

## 2. Non-negotiable status boundaries

Không trộn:

```text
DECISION_FINAL != PLAN_READY != CODE_READY != ENABLE_READY != IMPLEMENTED
```

- Decision owner đã chốt không chứng minh spec đủ.
- Spec/doc `Reviewed` không chứng minh dependency đã merge.
- `CODE_READY` không chứng minh code đã tồn tại.
- Migration/test xanh trên default branch chứng minh `IMPLEMENTED`, không phải precondition vòng lặp cho `CODE_READY`.
- Legal/provider/product-evidence có thể là `ENABLEMENT_ONLY` chỉ khi không làm thay đổi dark runtime/data contract.

---

## 3. Review workflow

### Phase 1 — Pin snapshot

- Resolve full `AUTHORITY_SHA` của default branch.
- Ghi current working branch riêng; không dùng feature branch làm authority nếu verdict target default branch.
- Pin exact target file paths và provenance decision/correction.
- Global version pointer thay đổi ngoài blast radius không invalidate snapshot.

### Phase 2 — Map G1–G6

| Gate | Review question |
|---|---|
| G1 Decision | Còn owner choice, DD/OQ/design-probe nào ảnh hưởng slice? |
| G2 Spec | Product + BE specs/equivalent authority đã Reviewed và đủ mandatory sections/AC chưa? |
| G3 Dependency | Mọi table/service/helper/API slice đọc/gọi đã tồn tại trên default branch chưa? |
| G4 Test | Exact invariant, input và expected assertion đã pin trước code chưa? |
| G5 Scope | Mechanism-named, negative scope, budget và manifest/worktree boundary đã đủ chưa? |
| G6 External | PII/money/provider/legal/evidence gate chặn code hay chỉ enablement? |

`Decision ✅` chỉ là G1/6.

### Phase 3 — Verify live truth

Tối thiểu phải kiểm tra những phần có liên quan:

- default branch SHA và merge state;
- schema + migration history, bao gồm migration chưa merge trên feature branch;
- actual writers/readers, service/router/helper ownership;
- tenant/person/global plane, RLS, grants và public whitelist;
- tests hiện có và canonical test invocation;
- cross-repo consumer/whitelist khi behavior đi qua companion repo;
- existing WIP/worktrees để không lấy branch state làm `main` truth.

Không dùng test count, accepted DD, feature-index count hoặc status prose làm runtime proof.

### Phase 4 — Review-first

Ghi finding chỉ khi có một trong các điểm:

- contract mâu thuẫn live truth;
- authority/provenance sai;
- open decision trong scope;
- dependency không tồn tại trên default branch;
- auth/security/fail-closed/order/migration behavior chưa pin;
- acceptance criterion thiếu expected result;
- scope/owner/ship order mơ hồ;
- doc claim `Implemented/Ready` vượt bằng chứng.

Mỗi finding phải có file/section, impact và exact resolution. Không polish wording không ảnh hưởng contract/readiness.

### Phase 5 — Fix, nếu được authorize

- Sửa canonical authority trước, mirror behavior-critical sau.
- Không ghi product choice mới thay owner.
- Không sửa code khi request chỉ là doc review.
- Không chạm WIP ngoài target set.
- Mở lại exact file sau patch và re-run source comparison.

### Phase 6 — Freeze pass

- Không thêm feature/decision mới.
- Re-check exact diff và cross-references.
- Chạy Markdown/structure/link checks phù hợp.
- Chạy closure matrix 12/12 trong canonical gate.
- Chọn node thấp nhất chưa build trong dependency graph là first implementation candidate; không mặc định feature vừa review được code trước.

---

## 4. Scope and test defaults

- Budget mặc định cho một slice: khoảng `≤300 LOC`, `≤3 modules`, `≤1 monotonic migration`.
- Expand→contract cần nhiều migration: tách slice hoặc ghi explicit exception + compatibility proof; cấm rewrite migration lịch sử.
- Product-facing slice: Product + BE spec `Reviewed` theo `../features/README.md`.
- BE spec có API/cache phải pin Migration & Rollback, request/response + errors, idempotency và caching.
- Acceptance matrix phải có happy path, boundary, auth, failure, concurrency, migration, security/privacy, regression và observability.
- Projector/money/RLS/grants/public-byte invariant tests phải được đặc tả trước code và land trước enablement.

---

## 5. Mandatory verdict block

Sao chép và điền đủ; không xoá field:

```text
REVIEW_VERDICT: PLAN_READY | CODE_READY | NOT_PLAN_READY | NOT_CODE_READY
REVIEWED_AT: YYYY-MM-DD
AUTHORITY_SHA: <full 40-char commit SHA>
BASE_BRANCH: <default branch>
TARGET_FILES:
  - <exact path>
SLICE: <mechanism-based slug>
IN_SCOPE: <bounded modules/behaviors>
OUT_OF_SCOPE: <explicit negative scope>
G1_DECISION: PASS | FAIL
G2_SPEC: PASS | PARTIAL | FAIL
G3_DEPENDENCY: PASS | FAIL
G4_TEST: PASS | PARTIAL | FAIL
G5_SCOPE: PASS | PARTIAL | FAIL
G6_EXTERNAL: PASS | FAIL | ENABLEMENT_ONLY:<named gates>
HARD_DEPENDENCIES: <all merged with probes | none>
PRIOR_SLICES: <ordered list | none>
OPEN_QUESTIONS_IN_SCOPE: <0 for ready verdict>
ENABLEMENT_ONLY_GATES: <named list | none>
LIVE_REPO_VERIFICATION: PASS | FAIL
CONTRACT_MATRIX: PASS | PARTIAL | FAIL
ACCEPTANCE_MATRIX: PASS | FAIL
SECURITY_AND_MIGRATION_GATE: PASS | PARTIAL | FAIL
IMPLEMENTATION_ARTIFACTS: PASS | FAIL | NOT_REQUIRED_FOR_PLAN_READY
FIRST_IMPLEMENTATION_STEP: <exact task/slice | blocked>
REMAINING_BLOCKERS: none | <structured blockers below>
```

Với verdict fail:

```text
REMAINING_BLOCKERS:
  - blocker: <exact missing decision/artifact/dependency>
    owner: <person/module/slice>
    resolution: <binary condition that closes it>
NEXT_REVIEW_TRIGGER: <commit/decision/merged probe; never "updated docs">
```

`CODE_READY` chỉ hợp lệ khi G1–G5 `PASS`, G6 `PASS` hoặc named `ENABLEMENT_ONLY`, closure 12/12 `PASS`, in-scope OQ = 0 và first implementation step có thể thực thi.

---

## 6. Handoff sau verdict

### Nếu `CODE_READY`

Pin first slice và author/verify:

1. `docs/autopilot-<slug>.md`.
2. `docs/autopilot-manifests/<slug>.json`.
3. `.claude/commands/ap-NN-<slug>.md`.
4. Backlog entry + dependency + merged probe.
5. Commit/push artifacts trên default branch trước khi tạo feature worktree.
6. Tạo worktree từ exact default-branch SHA và register scope gate.

Không code feature trong review session trừ khi user yêu cầu implementation riêng và coding gate đã pass.

### Nếu chưa ready

- Dừng tại blocker đầu tiên theo dependency order.
- Ghi owner, binary resolution và next trigger.
- Không tiếp tục update prose để che blocker.
- Lần re-review sau chỉ mở lại blast radius của trigger; không restart toàn cluster nếu authority ngoài scope thay đổi.

---

## 7. Final response contract

Final response phải tự đủ nghĩa và gồm:

1. Verdict + slice.
2. Evidence quan trọng nhất từ live repo.
3. Canonical verdict block.
4. File đã sửa và verification đã chạy, nếu có.
5. First implementation step nếu `CODE_READY`; exact blocker/next trigger nếu chưa ready.

Cấm:

- “Ổn/final” mà không có verdict block.
- Claim runtime/E2E từ docs, test count hoặc accepted decision.
- Dùng current global version pointer làm lý do re-open unrelated slice.
- Hứa code start khi hard dependency chỉ có trên feature branch/proposal.
- Để engineer/agent tự chọn product/security/data policy.

---

## Changelog

| Ngày | Version | Thay đổi |
|---|---|---|
| 19/07/2026 | 1.0 | Tạo reusable template bắt buộc cho review docs/plans: live-truth workflow, G1–G6, closure 12/12, canonical verdict và code-ready handoff. |
