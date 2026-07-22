<!-- review-readiness: policy -->
# Review → Plan → Code Readiness Gate

> **Status:** ✅ Accepted (owner 2026-07-19) · **Version:** 1.3 · 2026-07-22
> **Phạm vi:** Mọi review decision, analysis, feature spec, technical plan và doc pack có mục tiêu dẫn tới implementation trong Plexco.
> **Authority pin:** verdict phải pin **commit SHA + exact file paths** đã review; không dùng một nhãn `current decisions vX` thay cho snapshot bất biến.
> **Nguyên tắc tối cao:** review chỉ được chốt `CODE_READY` khi người implement không cần tự phát minh thêm business rule, security rule, data contract, failure behavior hoặc dependency order.
> **Verdict tracking:** `../slice-readiness-verdicts.md` áp dụng policy này cho các candidate slice tại một snapshot đã pin; file tracking không tự tạo rule hoặc authority mới.
> **Session template:** `../templates/review-doc-plan-session-template.md` là template bắt buộc cho mọi review docs/plans; Claude launcher: `../../.claude/commands/review-doc-plan.md`.

---

## 1. Mục tiêu

Tài liệu này ngăn ba lỗi quy trình:

1. Gọi decision đã chốt là code-ready dù contract kỹ thuật còn thiếu.
2. Review lặp vòng vì authority toàn cục tiếp tục đổi version.
3. Để engineer/agent tự quyết định các rule quan trọng trong lúc code.

Review phải kết thúc bằng verdict nhị phân, có bằng chứng. Không dùng các kết luận mơ hồ như “gần ổn”, “có thể bắt đầu” hoặc “còn vài điểm nhỏ”.

---

## 2. Năm trạng thái không được trộn lẫn

| Trạng thái | Ý nghĩa | Không chứng minh |
|---|---|---|
| `DECISION_FINAL` | Owner đã chọn product/policy direction | Spec đủ để code |
| `PLAN_READY` | Đủ contract để tách slice và viết execution plan | Dependency đã merge |
| `CODE_READY` | Một slice cụ thể có thể mở worktree và code | Feature đã implemented |
| `ENABLE_READY` | Đủ legal, external, product-evidence và operational gate để bật cho user | Runtime đã deploy |
| `IMPLEMENTED` | Code, migration và tests đã tồn tại và được verify | Production E2E nếu chưa chạy |

Mỗi verdict phải ghi đúng một trạng thái. `DECISION_FINAL` không tự động nâng thành `PLAN_READY` hoặc `CODE_READY`.

### 2.1 Compact gate G1–G6

Mỗi slice sắp code phải qua đủ sáu gate. `Decision ✅` chỉ là **G1/6**, không phải giấy phép code.

| Gate | PASS khi |
|---|---|
| **G1 · Decision** | Mọi DD/OQ/design-probe trong đường đi của slice đã owner duyệt và ghi vào authority; không còn product choice trong scope |
| **G2 · Spec** | Product + BE spec phù hợp đã `Reviewed`, có acceptance checklist và các section bắt buộc hiện hành; infra/core slice có reviewed technical authority tương đương |
| **G3 · Dependency** | Mọi bảng/service/helper/API mà slice đọc hoặc gọi đã tồn tại trên default branch, hoặc được loại khỏi scope bằng negative contract |
| **G4 · Test** | Exact invariant + expected assertions đã được đặc tả trước code; test enablement bắt buộc được pin đúng thời điểm |
| **G5 · Scope** | Slice mechanism-named, có negative scope, trong budget, manifest/scope gate hợp lệ và không là mega-slice |
| **G6 · External** | Gate PII/money/provider/legal/evidence đã clear cho code, hoặc được phân loại `ENABLEMENT_ONLY`/negative scope có bằng chứng |

G1–G6 là giao diện tóm tắt; closure matrix 12/12 ở §8 là evidence chi tiết cho verdict `CODE_READY`.

---

## 3. Gate A — `PLAN_READY`

Tất cả điều kiện sau phải `PASS`.

### A1. Authority đã đóng băng

- Pin commit SHA, branch/base và exact file paths đã review.
- Ghi provenance bất biến của decision: version/ngày nào chốt direction, version/ngày nào correction.
- Không copy `current authority vX` vào feature doc nếu version đó có thể tăng do thay đổi không liên quan.
- Nếu authority thay đổi sau verdict, chỉ invalidate các slice trong blast radius; không mặc định mở lại toàn bộ cluster.

### A2. Scope có biên rõ ràng

- Slice đặt tên theo **mechanism/symbol/module**, không theo goal mơ hồ.
- Ghi rõ `IN SCOPE`, `OUT OF SCOPE` và tempting-but-forbidden subsystem.
- Xác định repo, module và owner của mỗi behavior.
- Mỗi state/aggregate chỉ có một canonical owner và một writer contract.
- Tách dependency slice, consumer slice và enablement gate; không gộp cả cluster thành một slice lớn.
- Đường tới code đi từ node thấp nhất chưa build trong dependency graph, không từ feature hấp dẫn nhất hoặc doc vừa được review.

### A3. Dependency graph đã pin

Mỗi dependency phải thuộc một trong bốn loại:

| Loại | Cách xử lý |
|---|---|
| `MERGED` | Ghi merge commit + merged probe |
| `PRIOR_SLICE` | Có slice riêng, owner, spec và thứ tự chạy trước |
| `ENABLEMENT_ONLY` | Không chặn code nếu behavior dark/disabled đã an toàn; chặn enablement |
| `DEFERRED_OUT_OF_SCOPE` | Contract hiện tại ghi rõ behavior không tồn tại |

Không chấp nhận dependency chỉ có tên mà không có owner, merged probe hoặc prior-slice plan.

Mọi bảng/service/helper/API mà slice **đọc hoặc gọi** phải tồn tại trên default branch. Code chỉ có trên feature branch, proposal hoặc “sẽ build” không qua G3.

### A4. Contract đủ để implement

Với feature-facing slice, phải có cặp spec `Reviewed`:

- Product/UX spec theo cấu trúc hiện hành trong `../features/README.md`;
- BE technical spec có **Migration & Rollback**, **Request/Response Examples + Idempotency**, **Caching Strategy** và error mapping khi có API/cache;
- acceptance criteria viết thành checklist có thể chuyển thẳng sang issue/test plan.

Infra/core slice không có user-facing Product spec phải có reviewed technical authority tương đương; không tạo Product spec giả chỉ để tick gate.

Tùy slice, phải pin những phần có liên quan:

- input, output, DTO whitelist và error codes;
- schema, enum, constraint, index, FK và migration direction;
- state machine/decision table và transition owner;
- authorization, tenant/person/global boundary và RLS/grants;
- idempotency key, retry ownership, ordering và stale-event behavior;
- fail-closed behavior cho unknown, partial state và dependency failure;
- audit/telemetry fields và data-minimization rule;
- rollout flag, disable/rollback path và compatibility window.

Không được để `TBD` trong phần ảnh hưởng behavior của slice đầu tiên.

### A5. Open questions đã phân loại

- Open question ảnh hưởng schema, auth, money, identity, privacy, mutation hoặc output của slice hiện tại: **phải đóng trước `PLAN_READY`**.
- Open question thuộc phase sau: có thể giữ mở khi negative scope và behavior hiện tại đã pin.
- Câu hỏi chỉ chặn enablement phải gắn nhãn `ENABLEMENT_ONLY`; không được âm thầm chặn mọi development.
- Engineer/agent không được tự chọn product policy để lấp open question.

### A6. Đã verify với live repo

- Đọc schema, migration, routes/services, auth/RLS/grants và tests hiện có.
- Kiểm tra default branch và dependency merge state, không dựa vào doc status.
- Xác nhận symbol/file owner và blast radius trước khi plan thay đổi choke point.
- Ghi rõ phần nào là live runtime, phần nào mới chỉ là contract.
- Không dùng test count, feature-index count hoặc accepted DD làm bằng chứng implementation.

---

## 4. Gate B — `CODE_READY`

`CODE_READY` áp dụng cho **một slice cụ thể**, không cho một cluster mơ hồ. Ngoài toàn bộ Gate A, slice phải qua các điều kiện sau.

### B1. Hard dependencies đã sẵn sàng

- Mọi hard dependency đã merge và verify bằng merged probe; **hoặc** slice hiện tại chính là dependency gốc và không còn dependency chưa sở hữu.
- Base branch đã sync; plan không tham chiếu file/symbol chỉ có trên stale branch.
- Cross-repo contract phải ghi owner, ship order và exact consumer compatibility.

### B2. Acceptance matrix hoàn chỉnh

Mỗi row phải có input, precondition, expected state/output và test layer.

| Nhóm | Tối thiểu phải có |
|---|---|
| Happy path | Production-shaped success case |
| Boundary | Empty/null/zero/expired/stale/duplicate |
| Authorization | Wrong tenant/person/role/capability và enumeration resistance |
| Failure | Dependency unavailable, unknown state và fail-closed result |
| Concurrency | Retry, duplicate, out-of-order, double-submit hoặc competing writer |
| Migration | Existing rows, expand/contract compatibility, grants/RLS/FK/index |
| Security/privacy | Injection, PII/secret leakage, cache/replay và audit redaction |
| Regression | Real-world case name + canonical existing behavior không bị đổi |
| Observability | Event/metric/audit cho success, deny và integrity fault |

Không chấp nhận acceptance criterion chỉ ghi “thêm test” mà không pin expected behavior.

CI invariant tests phải được **đặc tả trước khi code**. Với projector, money path, RLS/grants hoặc public-byte boundary, invariant test phải land trước enablement; không được đẩy thành cleanup sau rollout.

### B3. Implementation handoff có thể thực thi

- Task list theo dependency order, mỗi task có Definition of Done.
- Exact repo + bounded file/module/symbol scope; nếu exact file chưa thể pin, ghi discovery gate trước edit.
- Verify commands: targeted tests, typecheck/lint/build và full-suite gate phù hợp rủi ro.
- Migration/seed/test-data strategy per worktree khi cần.
- Rollout flag, rollback/disable owner và enablement conditions.
- Có negative scope đủ rõ để người code không mở rộng feature.
- Budget mặc định: khoảng `≤300 LOC`, `≤3 modules`, `≤1 monotonic migration` sau migration mới nhất trên default branch.
- Nếu expand→contract đúng đắn cần nhiều migration, tách slice hoặc ghi explicit exception + compatibility proof; không sửa migration lịch sử để ép về một file.
- Slice chạm PII, money hoặc external provider phải liệt kê named gate. Gate làm thay đổi schema/runtime behavior chặn code; gate thuần go-live có thể là `ENABLEMENT_ONLY` nếu dark behavior đã fail-closed.

### B4. Autopilot artifacts sẵn sàng

Trước khi mở coding session:

1. Slice doc: `docs/autopilot-<slug>.md`.
2. Scope manifest: `docs/autopilot-manifests/<slug>.json`.
3. Launcher: `.claude/commands/ap-NN-<slug>.md`.
4. Backlog entry có status, dependency và merged probe.
5. Các artifact đã commit/push default branch.
6. Tạo worktree từ exact default-branch SHA; verify hai SHA khớp nhau.
7. Register scope gate trước khi edit.

Không có artifact hoặc không chạy autopilot thì vẫn phải có một execution plan tương đương với B1–B3 và worktree riêng.

---

## 5. Quy tắc PASS/FAIL

### Bắt buộc `NOT_PLAN_READY`

- Authority/provenance mâu thuẫn hoặc chưa pin snapshot.
- Product decision trong scope còn mở.
- Chưa biết module/aggregate nào sở hữu behavior.
- Có dependency không owner/không prior-slice plan.
- Contract mâu thuẫn với live schema, grants, route hoặc test.
- Feature-facing slice thiếu một trong hai spec Product/BE `Reviewed`, hoặc spec thiếu section bắt buộc ảnh hưởng behavior.

### Bắt buộc `NOT_CODE_READY`

- Còn `TBD` ảnh hưởng runtime behavior của slice.
- Hard dependency chưa merge.
- Chưa pin fail-closed behavior, auth boundary hoặc migration behavior.
- Acceptance matrix thiếu expected result.
- Plan yêu cầu người implement tự chọn business policy.
- Scope quá lớn, cùng state bị mutate qua nhiều path nhưng chưa tách core/edge.
- Chưa có executable handoff/worktree boundary.
- Vượt budget scope mà không tách slice/không có explicit exception.
- Slice đọc/gọi dependency chỉ có trên feature branch hoặc proposal.

### Không được dùng là blocker

- Open question phase sau đã có negative scope rõ ràng.
- Feature tương lai chưa build nhưng slice hiện tại không phụ thuộc nó.
- Authority global tăng version do decision không nằm trong blast radius.
- Legal/external gate chỉ chặn enablement và không thay đổi data model/behavior dark.

---

## 6. Quy trình review bắt buộc

1. **Pin snapshot:** target files, base branch và commit SHA.
2. **Map authority:** decisions, business rules, dependent specs và open questions.
3. **Verify live truth:** schema, migrations, services/routes, auth/grants và tests.
4. **Review-first:** liệt kê mismatch/blocker theo severity; không vừa đọc vừa tuyên bố final.
5. **Fix in scope:** sửa authority/provenance/contract và tất cả mirror behavior-critical.
6. **Freeze pass:** không thêm feature/decision mới; chỉ chạy closure matrix.
7. **Emit verdict:** dùng template ở §7; không chốt bằng prose tự do.
8. **Nếu `CODE_READY`:** author/verify implementation artifacts, commit authority baseline, sau đó mới mở worktree.
9. **Nếu `NOT_*_READY`:** ghi đúng blocker, owner, expected artifact và next action; không lặp lại một review chung chung.

---

## 7. Verdict template bắt buộc

```text
REVIEW_POLICY_VERSION: 1.3
REVIEW_VERDICT: PLAN_READY | CODE_READY | NOT_PLAN_READY | NOT_CODE_READY
REVIEWED_AT: YYYY-MM-DD
AUTHORITY_SHA: <full commit SHA>
BASE_BRANCH: <branch>
TARGET_FILES:
  - <path>
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
OPEN_QUESTIONS_IN_SCOPE: 0
ENABLEMENT_ONLY_GATES: <list | none>
LIVE_REPO_VERIFICATION: PASS
CONTRACT_MATRIX: PASS
CLOSURE_MATRIX: PASS | PARTIAL | FAIL
ACCEPTANCE_MATRIX: PASS
SECURITY_AND_MIGRATION_GATE: PASS
IMPLEMENTATION_ARTIFACTS: PASS | NOT_REQUIRED_FOR_PLAN_READY
FIRST_IMPLEMENTATION_STEP: <exact task or slice>
REMAINING_BLOCKERS: none
```

`CODE_READY` yêu cầu G1–G5 đều `PASS`; G6 phải `PASS` hoặc chỉ có named `ENABLEMENT_ONLY` gate không thay đổi dark runtime/data contract. Nếu bất kỳ gate nào `FAIL/PARTIAL`, verdict phải là `NOT_PLAN_READY` hoặc `NOT_CODE_READY`.

Với verdict fail, thay hai dòng cuối bằng:

```text
REMAINING_BLOCKERS:
  - blocker: <exact missing decision/artifact/dependency>
    owner: <person/module/slice>
    resolution: <binary condition that closes it>
NEXT_REVIEW_TRIGGER: <commit/decision/merged probe, not "updated docs">
```

---

## 8. Closure matrix dùng khi re-review

| # | Gate | Evidence | PASS/FAIL |
|---|---|---|---|
| 1 | Authority snapshot pin theo SHA | `git rev-parse` + target paths | |
| 2 | Decision trong scope đã chốt | decision refs | |
| 3 | Scope IN/OUT và owner rõ | slice contract | |
| 4 | Dependency phân loại đủ | graph + merged probes | |
| 5 | Live schema/code khớp doc | exact files/symbols | |
| 6 | Data/API/state/auth contract đủ | contract sections | |
| 7 | Fail-closed/idempotency/order đủ | decision tables | |
| 8 | Open question trong scope = 0 | OQ register | |
| 9 | Acceptance matrix có expected result | test table | |
| 10 | Migration/security/rollback pin | technical plan | |
| 11 | First slice có hard dependency merged | merge probes | |
| 12 | Implementation handoff sẵn sàng | plan/artifacts | |

Chỉ khi 12/12 `PASS` mới được ghi `CODE_READY`.

---

## 9. Ví dụ áp dụng — DD-73..78

### Trạng thái không được gộp

| Phạm vi | Verdict |
|---|---|
| Sáu product decision DD-73..78 | `DECISION_FINAL` |
| Toàn cluster DD-73..78 như một coding slice | `NOT_CODE_READY` |
| Chuỗi dependency DD-41 → DD-12 → DD-73 | Có thể author thành các slice riêng |
| DD-74/75 | Tách activity intent/projector sau dependency + allocation pin |
| DD-76/77 | Chỉ `PLAN_READY/CODE_READY` sau product-evidence baseline và owner threshold |
| DD-78 | Không có slice riêng; ảnh session đi cùng DD-73, ảnh activity đi cùng DD-75 |

### Chuỗi dependency nội bộ cụm share

> Đây là thứ tự **bên trong cụm share**, không phải global next-to-code. Scheduler phải so G1–G6 với các node thấp hơn của roadmap; `../slice-readiness-verdicts.md` giữ snapshot candidate hiện hành và phải verify lại trên default branch trước mỗi verdict.

1. `dd41-public-session-projection-fields`: expand projection whitelist và invariant tests.
2. `dd12-guarded-public-read`: marketplace projector + denial fence + guarded view + grants + projection version.
3. `dd73-session-share-route`: `/s/<id>` + OG/image consumer + join revalidation + funnel telemetry.
4. `dd74-75-activity-intent-projector`: author sau khi chốt allocation owner và dependency.
5. `dd76-77-feed-kudos`: chỉ author/code khi baseline và owner threshold đã đạt.

### Phân loại open gate

- `USR-OQ-8`: không chặn phase 1 nếu negative scope pin **không co-participant name/avatar**.
- `USR-OQ-3`: chặn activity lifecycle/enablement nếu retention/erasure làm thay đổi schema hoặc deletion behavior.
- DD-70 notification: không chặn kudos core; notification phải absent cho tới khi person-global notification path tồn tại.
- Comment public: deferred out of scope; kudos core không được vô tình mở free-text surface.

---

## 10. Definition of Done cho chính review

Review chỉ hoàn tất khi:

- verdict template được điền đủ;
- không còn claim mâu thuẫn với live repo;
- blocker còn lại có owner + binary resolution + next review trigger;
- không gọi contract/doc coverage là runtime implementation;
- nếu `CODE_READY`, first implementation slice và exact first step đã pin;
- nếu không ready, review dừng tại blocker thay vì tiếp tục polish prose.

---

## 11. Machine enforcement

Mọi persisted review/readiness artifact phải khai báo một directive trong 30 dòng đầu:

```text
<!-- review-readiness: code-ready -->
<!-- review-readiness: enforce -->
<!-- review-readiness: historical -->
<!-- review-readiness: criteria -->
<!-- review-readiness: policy -->
<!-- review-readiness: template -->
```

- `code-ready`: final implementation plan/coding handoff. Mọi active verdict trong artifact bắt buộc là strict `CODE_READY`; validator/CI phải fail nếu còn `PLAN_READY`, `NOT_*_READY`, gate `PARTIAL/FAIL`, closure dưới 12/12 hoặc blocker.
- `enforce`: có ít nhất một fenced canonical verdict block đang active; dùng cho draft/read-only blocker audit hoặc readiness tracker chưa authorize code. Artifact này không được dùng để mở coding worktree. Block lịch sử nằm trong tracker hỗn hợp phải đặt `<!-- review-verdict: historical -->` ngay trước fence.
- `historical`: bằng chứng lịch sử, không được dùng làm current authority hoặc authorization.
- `criteria`: tiêu chí đánh giá, không phải verdict artifact.
- `policy` / `template`: source rule hoặc placeholder, không phải verdict thực.

Mỗi active verdict phải ghi `REVIEW_POLICY_VERSION: 1.3`, full 40-character `AUTHORITY_SHA`, exact `TARGET_FILES` không dùng glob, và `CLOSURE_MATRIX`. `CODE_READY` chỉ qua validator khi mọi strict gate cùng closure 12/12 đều `PASS`, open question trong scope bằng 0, không còn blocker và first step không bị chặn.

### 11.1 Outcome contract cho docs plan

- Review/finalize một implementation plan mặc định nhắm tới `CODE_READY`, không dừng ở việc format đúng hoặc chỉ liệt kê finding.
- Khi user chỉ authorize read-only review, session được trả `NOT_PLAN_READY`/`NOT_CODE_READY` với blocker chính xác, nhưng artifact phải ở mode `enforce` và **không được coi là review-complete coding handoff**.
- Khi user authorize fix/finalization, agent phải reconcile các mirror behavior-critical, chạy lại live-truth + 12/12 closure và chỉ đổi sang `code-ready` khi strict `CODE_READY` đã đạt.
- Nếu còn owner/external/hard-dependency blocker không thể tự đóng, dừng fail-closed với owner + binary resolution + `NEXT_REVIEW_TRIGGER`; không tự phát minh decision và không mở worktree.
- Launcher, scope-gate handoff hoặc người implement chỉ được nhận plan có directive `code-ready` và validator xanh.

Enforcement bắt buộc:

1. Agent chạy `pnpm review:check:changed` trước verdict/commit sau khi chạm docs review/readiness.
2. Claude project hook tự chạy check sau Edit/Write và chặn `Stop` khi check fail.
3. CI chạy `pnpm review:check` trên toàn repo; failure chặn merge khi CI là required check.
4. `pnpm test` luôn chạy regression suite của validator trước workspace tests.

Không dùng `historical` để né lỗi mới. Chỉ artifact thực sự superseded/pre-policy mới được exempt; mọi current tracker phải giữ ít nhất một active verdict hợp lệ.

### 11.2 Cái gì là "review/readiness artifact" — phép thử

§11 mở đầu bằng "mọi persisted review/readiness artifact" mà trước 2026-07-23 **không định nghĩa phép thử**.
Khoảng trống đó đã tạo ra một xung đột authority thật (AP-28, `HALT-AUTHORITY_AMBIGUOUS`). Chốt như sau.

**Phép thử: artifact kích hoạt §11 khi nó KHẲNG ĐỊNH MỘT TRẠNG THÁI readiness.** Liệt kê bằng chứng thì không.

- **Khẳng định trạng thái** = bất kỳ dạng nào của: `MET`/`PARTIAL`/`NOT-MET` per-gate · `READY`/`NOT_READY` ·
  điểm số hay tỷ lệ (`8/12`) · tính từ hàm ý khoảng cách tới ready ("gần đủ", "chỉ còn"). Một người đọc lướt
  rút ra được kết luận về mức sẵn sàng ⇒ đã là khẳng định trạng thái.
- **Kiểm kê bằng chứng** = mỗi tiêu chí ghi bằng chứng **có** gì (`file:line`) và **thiếu** gì, không quy ra
  trạng thái, không tổng hợp. Không kích hoạt §11.

Lý do §11 tồn tại là chặn đúng một kiểu hỏng: một doc **đọc như** đánh giá readiness bị hiểu thành
authorization, rồi code được viết dựa trên prose. Kiểm kê bằng chứng không tạo ra được hiểu lầm đó.

**Tên file là heuristic phát hiện, KHÔNG phải định nghĩa.** `CANDIDATE_NAME_RE` (`review|readiness|plan`) và
dòng `REVIEW_VERDICT:` chỉ là cách validator *nhìn thấy* artifact. Một khẳng định readiness nằm trong file đặt
tên khác là **vi phạm §11 dù validator xanh** — validator xanh ở đây nghĩa là "không nhìn thấy", không phải
"đã duyệt". Ngược lại, artifact non-candidate không tự động được miễn: cứ áp phép thử trên.

**Cấm verdict một slice chưa được author.** Nếu không có manifest và không có target code thì `TARGET_FILES`
phải trỏ vào spec, `AUTHORITY_SHA` không pin cái gì có thật, và `CLOSURE_MATRIX` đánh giá một thứ chưa tồn tại.
Điền các field đó cho hợp lệ với validator là **bịa bằng chứng có vỏ machine-checked** — tệ hơn không verdict,
vì validator sẽ báo xanh trên một khẳng định không ai đo. Trong tình huống này việc đúng là: giữ doc ở dạng
kiểm kê bằng chứng, và mở verdict khi slice đã được author. **Không mở slice placeholder chỉ để có chỗ verdict.**

Điều khoản này **không** thêm/bớt field nào validator kiểm, nên **không bump `REVIEW_POLICY_VERSION`** — nó
định nghĩa phạm vi áp dụng, không đổi hợp đồng máy. Tiền lệ: AP-28 §C3 (`docs/auth-d1-implementation-packet.md`)
chuyển từ ma trận per-gate sang kiểm kê tiêu chí→bằng chứng; DD-38/39 không nhận verdict vì chưa là slice.

---

## Changelog

| Ngày | Version | Thay đổi |
|---|---|---|
| 22/07/2026 | 1.3 | Thêm fail-closed `code-ready` mode: final implementation plan/coding handoff chỉ pass validator khi mọi active verdict strict `CODE_READY`; `enforce` chỉ lưu draft/blocker evidence và không authorize worktree. |
| 22/07/2026 | 1.2 | Thêm machine enforcement: classification directive, `REVIEW_POLICY_VERSION`, `CLOSURE_MATRIX`, full-SHA/exact-path validation, semantic `CODE_READY` checks, Claude Stop hook, CI/PR/package wiring và regression tests. |
| 19/07/2026 | 1.1 | Hợp nhất compact G1–G6 từ `slice-readiness-verdicts.md` (tên ban đầu `ready-to-code-gate.md`): bắt buộc spec pair/equivalent authority, dependency thật trên default branch, invariant tests pre-code, budget slice, external-gate classification và bottom-up scheduling. Thêm G1–G6 vào verdict; sửa typo/step lặp; làm rõ chuỗi DD-41→12→73 chỉ là nội bộ cụm share. |
| 19/07/2026 | 1.0 | Owner chốt gate Review → Plan → Code: tách 5 trạng thái, pin SHA thay global moving version, closure matrix 12/12, verdict nhị phân và DD-73..78 example. |
