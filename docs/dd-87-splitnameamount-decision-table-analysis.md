<!-- review-readiness: enforce -->
# DD-87 — Fail-closed ambiguity contract cho `splitNameAmount`

> **Decision:** ✅ `DECISION_FINAL` — owner phê duyệt 2026-07-22 qua yêu cầu “update hết”.
> **Live base đã verify:** `main@6a28072c433d24aa489b3456b301b5a7e99a2716` = `origin/main`.
> **Runtime boundary:** quyết định này chưa phải implementation. `splitNameAmount` hiện chỉ được gọi bởi
> test; không có runtime execution flow/caller trong Plexco.
> **Current readiness:** `NOT_CODE_READY` cho tới khi packet authority + manifest + launcher + verdict
> được commit/push trên `main` rồi re-pin bằng full SHA mới.

---

## 1. Live truth và blocker đã đóng ở tầng thiết kế

Implementation hiện tại ở `packages/core/src/payments-logic.ts` quét từ phải sang trái và trả ngay
trailing run ngắn nhất mà `parseMoney` parse thành số dương. Cơ chế này giữ đúng numeric suffix của tên
trong `Player 2 110k`, nhưng chỉ vô tình parse đúng `Wang 110 000`: tail `000` bằng `0` nên bị loại; tail
`500` của `Wang 110 500` lại dương và thắng quá sớm.

Các bảng classifier cũ vẫn tồn tại dưới worktree registered
`.autopilot/worktrees/phase1-fable5/.autopilot/state/core-lift{,-v2,-v3}/decision-table.md` và bị
`.gitignore` chặn. Live `git worktree prune --dry-run --verbose` không báo worktree nào prunable. Các bảng
đó không có row `splitNameAmount`, không phải authority của DD-87 và **không** là hard dependency của slice
này. Việc lift chúng thành tài liệu bền là follow-up riêng trong backlog.

---

## 2. Vì sao input mơ hồ về bản chất

Một chuỗi có nhiều trailing run mà `parseMoney` chấp nhận có thể đại diện cho nhiều cặp
`(payer-name, amount)`:

| Input | Candidate ngắn | Candidate dài |
|---|---|---|
| `Wang 110 500` | `Wang 110` + `500` | `Wang` + `110500` |
| `Player 2 110k` | `Player 2` + `110000` | `Player` + `2110000` |
| `Player 0 110k` | `Player 0` + `110000` | `Player` + `110000` |

Row thứ ba chứng minh ambiguity không thể chỉ so amount: cùng 110.000 nhưng payer-name khác nhau vẫn có
thể settle nhầm người. Shortest/longest/grouped-number/magnitude threshold đều không thể giải an toàn cho
mọi row. Vì vậy core không được chọn hộ owner khi có từ hai interpretation khác nhau.

---

## 3. Quyết định đã chốt

### 3.1 Return type bắt buộc

```ts
export interface SplitNameAmountCandidate {
  name: string;
  amount: number;
  rawAmount: string;
}

export type SplitNameAmountResult =
  | { kind: "none"; name: string }
  | { kind: "resolved"; name: string; amount: number }
  | {
      kind: "ambiguous";
      candidates: readonly [
        SplitNameAmountCandidate,
        SplitNameAmountCandidate,
        ...SplitNameAmountCandidate[],
      ];
    };
```

Nhánh `ambiguous` **không có** top-level `name` hoặc `amount`. Đây là compile-time fail-closed fence:
caller không thể vô tình tiếp tục destructure amount cũ rồi settle. Candidate giữ `rawAmount` để surface
có thể hiển thị đúng interpretation mà không tự parse lại chuỗi tiền.

### 3.2 Candidate generation

1. Giữ `parseMoney` là money parser duy nhất.
2. Duyệt mọi digit-led trailing run trong vùng token hiện có; run hợp lệ khi
   `parseMoney(run) !== null && parseMoney(run) > 0`.
3. Mỗi run tạo candidate `{name: tokens trước run, amount, rawAmount: run}`.
4. Dedupe theo cặp `(name, amount)`; nếu trùng cặp thì giữ occurrence ngắn nhất đầu tiên.
5. Giữ order deterministic: shortest valid run → longest valid run.
6. `0` candidate → `kind:"none"`; `1` candidate → `kind:"resolved"`; `>=2` candidate →
   `kind:"ambiguous"`.

Không có biến thể grouped-number `(c′)`: thêm grammar thứ hai sẽ drift khỏi `parseMoney` và có thể bỏ lọt
ambiguity. Phương án longest-run bị loại vĩnh viễn vì có thể thổi tiền âm thầm.

---

## 4. Decision table và expected outputs

| # | Input | Expected |
|---:|---|---|
| 1 | `` (empty) | `{kind:"none", name:""}` |
| 2 | `Wang` | `{kind:"none", name:"Wang"}` |
| 3 | `Wang 0` | `{kind:"none", name:"Wang 0"}` |
| 4 | `Player 2` | `{kind:"resolved", name:"Player", amount:2}` — giữ behavior hiện tại; downstream underpayment vẫn fail-closed |
| 5 | `Wang 220k` | `{kind:"resolved", name:"Wang", amount:220000}` |
| 6 | `Wang 110 000` | `{kind:"resolved", name:"Wang", amount:110000}` |
| 7 | `Wang 110k vnd` | `{kind:"resolved", name:"Wang", amount:110000}` |
| 8 | `Wang 110 k` | `{kind:"resolved", name:"Wang", amount:110000}` |
| 9 | `Ngoc-Anh Mai 110 000 vnd` | `{kind:"resolved", name:"Ngoc-Anh Mai", amount:110000}` |
| 10 | `Wang 110 500` | `ambiguous: [Wang 110 + 500, Wang + 110500]` |
| 11 | `Wang 110 050` | `ambiguous: [Wang 110 + 50, Wang + 110050]` |
| 12 | `Wang 1 500 000` | `ambiguous: [Wang 1 + 500000, Wang + 1500000]` |
| 13 | `Wang 110 500k` | `ambiguous: [Wang 110 + 500000, Wang + 110500000]` |
| 14 | `Player 2 110k` | `ambiguous: [Player 2 + 110000, Player + 2110000]` |
| 15 | `Player 2 110 000` | `ambiguous: [Player 2 + 110000, Player + 2110000]` |
| 16 | `Court 7 110 000` | `ambiguous: [Court 7 + 110000, Court + 7110000]` |
| 17 | `San 2 220000` | `ambiguous: [San 2 + 220000, San + 2220000]` |
| 18 | `Player 0 110k` | `ambiguous: [Player 0 + 110000, Player + 110000]` — same amount, different payer-name |

Tổng: **18 input**, trong đó **9 ambiguous**. Mọi row phải thành exact unit assertion; không thay expected
bằng test chung kiểu “có cờ ambiguity”.

---

## 5. Invariants và consumer contract

1. `parseMoney` là nguồn duy nhất của money grammar; không thêm grouped-number regex, price threshold hoặc
   danh sách từ/shape ngoại lệ.
2. `AMOUNT_TOKEN_RE` chỉ giới hạn vùng trailing-token scan và phải tiếp tục lockstep với token shapes mà
   `parseMoney` chấp nhận; nó không được chọn winner.
3. Core chỉ phân loại/propose, không ghi DB, không settle, không log tên/candidate.
4. Mọi consumer tương lai phải xử lý exhaustive `kind`. `ambiguous` chỉ được render candidate picker; lựa
   chọn phải mang exact candidate/payload deterministic sang manual allocation. Không tự chọn candidate 0.
5. Multi-person auto-settle chỉ qua `pay_code` deterministic; name parsing vẫn manual-confirm theo BL-PAY-3.
6. Không đổi `classifyAmount`, FIFO, ledger, transport, DB, adapter hoặc i18n trong slice này.

---

## 6. Acceptance matrix cho slice code

| Nhóm | Input/precondition | Expected result | Test layer |
|---|---|---|---|
| Happy | một valid run (`Wang 220k`) | exact `resolved` | unit |
| Boundary | empty/name-only/zero/single digit | rows 1–4; zero không phải amount | unit |
| Grammar regression | spaced `k`, unit, grouped zero tail | rows 6–9 giữ parseMoney compatibility | unit |
| Ambiguous amount | `Wang 110 500` và `Wang 1 500 000` | ordered candidates; không top-level amount | unit + typecheck |
| Ambiguous identity | `Player 0 110k` | ambiguous dù candidate amounts bằng nhau | unit |
| Authorization | N/A: pure core function, không actor/tenant/IO | không mở auth surface | static scope check |
| Failure | mọi tail trả null/0 | `none`, không guess | unit |
| Retry/concurrency | gọi lặp cùng input | deep-equal deterministic output; không state | unit |
| Migration | không DB/schema/migration | diff không chứa `packages/db/**` | scope gate |
| Security/privacy | input chứa tên người dùng | không log/telemetry/IO trong core | source review |
| Regression | toàn bộ assertions `splitNameAmount` hiện có | chuyển sang tagged union, nghĩa resolved/none giữ nguyên | unit |
| Observability | pure function không sở hữu telemetry | không thêm logger/event; consumer telemetry out of scope | source review |

---

## 7. Bounded implementation handoff

- **Slice:** `core-matcher-grouped-amount-parsing`.
- **Code scope:** `packages/core/src/payments-logic.ts` + `packages/core/src/payments-logic.test.ts`.
- **Budget:** ≤2 code modules, khoảng ≤180 LOC net, zero migration.
- **Artifacts:** manifest hiện hữu, task contract `docs/autopilot-core-split-name-amount-ambiguity-contract.md`,
  launcher `.claude/commands/ap-29-core-split-name-amount-ambiguity-contract.md`, backlog entry và Verdict 15.
- **Verify:** core unit suite + core typecheck + full diff/scope check + 2 consecutive FULL-base Codex clean
  rounds; `manual_only`, STOP_AT_READY.
- **Design probe:** launcher phải record cơ chế DD-87 và chạy rows 10/14/18 trước edit. DD-87 là founder
  confirmation; bất kỳ deviation nào phải HALT `DESIGN_UNFIT`, không tự xin phép grammar khác.

---

## 8. Closure matrix hiện tại

| # | Gate | Evidence | Status |
|---:|---|---|---|
| 1 | Authority snapshot pin theo SHA | DD-87/decisions/artifacts đang là WIP ngoài `6a28072` | FAIL |
| 2 | Decision trong scope đã chốt | owner 2026-07-22; tagged union + pair ambiguity | PASS |
| 3 | Scope IN/OUT và owner rõ | §5/§7 + manifest | PASS |
| 4 | Dependency phân loại đủ | `parseMoney` + source/tests đã merge; ignored tables không là dep | PASS |
| 5 | Live schema/code khớp doc | GitNexus + source/test; không DB dependency | PASS |
| 6 | Data/API/state/auth contract đủ | §3 + exact type | PASS |
| 7 | Fail-closed/idempotency/order đủ | no top-level amount + deterministic ordering | PASS |
| 8 | Open question trong scope = 0 | không còn `(a)/(b)/(c′)` | PASS |
| 9 | Acceptance matrix có expected result | §4 + §6 | PASS |
| 10 | Migration/security/rollback pin | no migration; revert code commit | PASS |
| 11 | First slice có hard dependency merged | authority packet chưa commit/push | FAIL |
| 12 | Implementation handoff sẵn sàng | artifacts có trên disk nhưng chưa commit/push default branch | FAIL |

`CLOSURE_MATRIX: FAIL (9/12)` cho tới khi commit/push authority packet và re-pin snapshot.

---

## 9. Canonical verdict

```text
REVIEW_POLICY_VERSION: 1.3
REVIEW_VERDICT: NOT_CODE_READY
REVIEWED_AT: 2026-07-22
AUTHORITY_SHA: 6a28072c433d24aa489b3456b301b5a7e99a2716
BASE_BRANCH: main
TARGET_FILES:
  - docs/dd-87-splitnameamount-decision-table-analysis.md
  - docs/standards/decisions.md
  - docs/autopilot-manifests/core-matcher-grouped-amount-parsing.json
  - docs/autopilot-core-split-name-amount-ambiguity-contract.md
  - .claude/commands/ap-29-core-split-name-amount-ambiguity-contract.md
  - docs/autopilot-backlog.md
  - docs/slice-readiness-verdicts.md
  - docs/auth-s4-session-handoff.md
SLICE: core-matcher-grouped-amount-parsing
IN_SCOPE: splitNameAmount tagged-union contract, all valid trailing candidates, exact unit assertions
OUT_OF_SCOPE: transports, DB/schema/migrations, ledger mutation, classifyAmount/FIFO, consumer picker implementation
G1_DECISION: FAIL
G2_SPEC: PASS
G3_DEPENDENCY: FAIL
G4_TEST: PASS
G5_SCOPE: PASS
G6_EXTERNAL: PASS
HARD_DEPENDENCIES: corrected DD-87 authority packet must be committed/pushed on main
PRIOR_SLICES: none
OPEN_QUESTIONS_IN_SCOPE: 0
ENABLEMENT_ONLY_GATES: none
LIVE_REPO_VERIFICATION: PASS
CONTRACT_MATRIX: PASS
CLOSURE_MATRIX: FAIL (9/12 — authority and handoff artifacts are uncommitted WIP)
ACCEPTANCE_MATRIX: PASS
SECURITY_AND_MIGRATION_GATE: PASS
IMPLEMENTATION_ARTIFACTS: FAIL (present on disk, not committed/pushed default branch)
FIRST_IMPLEMENTATION_STEP: blocked until authority packet commit is re-pinned; then run AP-29 design probe and failing tests
REMAINING_BLOCKERS:
  - blocker: corrected decision and implementation artifacts are not contained in AUTHORITY_SHA/origin main
    owner: owner git workflow
    resolution: commit and push the exact TARGET_FILES to main, then re-pin full SHA and promote both enforce artifacts to strict code-ready
NEXT_REVIEW_TRIGGER: origin/main commit containing all TARGET_FILES above
```

---

## Changelog

| Ngày | Thay đổi |
|---|---|
| 22/07/2026 | Owner-ratified correction: replace boolean ambiguity with exhaustive tagged union; ambiguity is distinct `(name,amount)` interpretations, including equal-amount/different-name; ambiguous branch carries ordered candidates and no settleable top-level amount. Remove grouped-grammar variant and unsafe longest-run option. Reconcile live worktree state, exact 18-row matrix, acceptance, artifacts and readiness verdict. |
| 22/07/2026 | Initial proposal and live behavior measurement. Superseded by the owner-ratified contract above. |
