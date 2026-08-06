<!-- review-readiness: code-ready -->

# Autopilot task contract — `eslint-10-migration`

> **Đây là coding handoff.** Verdict canonical nằm ở cuối file. `AUTHORITY_SHA` dưới pin đúng base
> HEAD mà toàn bộ live-truth verification bên dưới được đo — commit ngay trước commit chứa slice
> này. `pnpm review:check:changed` xác minh `AUTHORITY_SHA` bằng `git merge-base --is-ancestor <sha>
> main`, không đòi nó phải LÀ chính commit chứa file này; base pin đứng vững cả trước lẫn sau khi
> commit này land, vì quan hệ ancestor-của-main không đổi khi `main` tiến thêm một commit ngay trên
> nó.

---

## Vì sao có file này

`eslint-10-migration` được tách khỏi `deps-security-bump` ngày 2026-07-29: `deps-security-bump`'s
`_scope_out` cấm rõ *"unrelated dependency upgrades riding along"*, và nhét một major toolchain
upgrade (eslint 9→10, kéo theo compat surface với `typescript-eslint`/`@next/eslint-plugin-next`/Node
floor) vào một slice dependency-floor gọn sẽ biến chính điều khoản đó thành vô nghĩa.

Động lực THẬT là **ESLint v9.x END-OF-LIFE ngày 2026-08-06** — một hạn bên ngoài, không di chuyển
được. Security chỉ là hệ quả đi kèm miễn phí: `eslint@9.39.4` tự nó phụ thuộc `minimatch@3.1.5` (qua
`@eslint/config-array` và `@eslint/eslintrc`), phụ thuộc `brace-expansion@1.1.16`
(GHSA-mh99-v99m-4gvg, CVSS 7.5, patch chỉ có ở `5.0.8` — nhánh v1 KHÔNG có bản vá trong dải). Không gì
trong dải `^9` gỡ được nhánh này; `deps-security-bump`'s own history đã đo và bác bỏ hướng "ép
`brace-expansion@1` lên `^5` bằng override" — v1 là `module.exports = expandTop` (hàm), v5 CJS là
`exports.expand` (object); `minimatch@3.1.5` gọi nó như hàm nên override sẽ vỡ RUNTIME chứ không chỉ
là major bump. ESLint v10.0.0 liệt `501abd0 feat!: update dependency minimatch to v10 (#20246)` là
breaking change — v10 gỡ hẳn nhánh đó.

**Phát hiện khi author hôm nay, 2026-07-31, sửa một sai sót thật của bản manifest gốc (2026-07-29):**
`osv-scanner --lockfile=pnpm-lock.yaml` hiện báo **HAI** finding brace-expansion, không phải một —
`1.1.16` (qua `minimatch@3.1.5` ← `eslint@9.39.4`, đúng nhánh slice này gỡ) VÀ `5.0.7` (qua
`minimatch@10.2.5` ← `typescript-eslint@8.62.1`'s own `typescript-estree`, đo bằng `pnpm why
brace-expansion`, **hoàn toàn không liên quan tới version eslint**). Acceptance gốc E10-4 nói slice
này khiến osv-scanner hết sạch finding brace-expansion — điều đó KHÔNG đúng và KHÔNG đạt được từ
scope của slice này. Đã sửa E10-4 trong manifest + acceptance matrix dưới, và route phần dư sang một
backlog entry mới (`eslint10-brace-expansion-5-0-7-typescript-estree`, `idea`, chưa scope) thay vì
lặng lẽ bỏ qua hay cố đóng nó ở đây.

---

## §3 Task contract

```text
TASK_ID: eslint-10-migration
OUTCOME: eslint upgraded from ^9.18.0 to ^10 across the whole pnpm workspace, `pnpm lint` green on
  the IDENTICAL linted-file set (not narrower, not wider), package.json `engines.node` tightened to
  a range ESLint 10 actually supports, and pnpm-lock.yaml no longer resolving the
  minimatch@3.x -> brace-expansion@1.x branch (GHSA-mh99-v99m-4gvg). Driven by ESLint v9
  END-OF-LIFE on 2026-08-06, an external and immovable date — not by the security advisory, which is
  a side effect.
REPOSITORY_AND_BASE: Plexco app · base `main` · PIN SHA lúc mở worktree (đo lại, đừng chép số ở đây)
CONTEXT_SOURCES:
  - package.json · pnpm-lock.yaml · eslint.config.mjs (AUTHORITATIVE for current state)
  - .github/workflows/security.yml (osv-scanner invocation this slice's fix must satisfy)
  - docs/autopilot-manifests/deps-security-bump.json (sibling slice this was split from; explains
    why brace-expansion could not be fixed there, and why next/postcss stay out of this slice too)
  - ESLint v10 release notes / breaking-changes list (external, read live at execution time — do not
    trust any summary of it, including this file's, written before today)
APPLICABLE_SKILLS: none — dependency/toolchain upgrade, no product skill applies.
SCOPE: package.json · pnpm-lock.yaml · eslint.config.mjs · docs/autopilot-manifests/eslint-10-migration.json ·
  docs/autopilot/contracts/autopilot-eslint-10-migration.md
NEGATIVE_SCOPE:
  - KHÔNG đổi bất kỳ rule config nào, kể cả rule mới mà `eslint:recommended` v10 tự thêm.
  - Nếu recommended set mới sinh lỗi mới ở bất kỳ file nào trong repo: REPORT và HALT, không tự sửa
    hay silence.
  - KHÔNG sửa source code ở bất kỳ đâu ngoài scope để thoả lint.
  - KHÔNG nâng `typescript-eslint` — 8.62.1 đã khai `peerDependencies.eslint: ^8.57.0 || ^9.0.0 ||
    ^10.0.0` (đo lại lúc chạy); nâng nó là nhét thêm một thay đổi chưa đo vào slice này.
  - KHÔNG đụng `next`/`postcss` — đó là `deps-security-bump`.
  - KHÔNG gỡ hay làm yếu block Node-globals `scripts/**/*.{mjs,js}` trong `eslint.config.mjs`.
  - KHÔNG hạ `minimumReleaseAge`/`trustPolicy`/`blockExoticSubdeps`, không `--no-verify`/
    `--ignore-scripts`/`--no-frozen-lockfile`.
  - KHÔNG cố đóng finding `brace-expansion@5.0.7` (qua `minimatch@10.2.5`, phụ thuộc riêng của
    `typescript-eslint`) — đo 2026-07-31, không liên quan tới bump eslint, để lại cho backlog entry
    mới `eslint10-brace-expansion-5-0-7-typescript-estree`.
RISK: P1 (blast radius toàn repo — một lint gate hẹp lại âm thầm mà vẫn xanh là một regression trông
  giống thành công; xem `_design_probe` item (4) trong manifest)
AUTONOMY_MODE: supervised
MODEL_POLICY: code gate = `scripts/codex-review-pin.sh`, 2 vòng clean liên tiếp (P1). KHÔNG bắt buộc
  security round — thay đổi chỉ ở devDependency toolchain, không chạm trust boundary/auth/secret/
  tiền/external input/deployment; xem `security_review.void_if` trong manifest cho điều kiện làm mất
  hiệu lực phán đoán này. Reviewer không gọi được → `HALT TOOL_UNAVAILABLE`, cấm tự hạ gate.
SANDBOX_AND_PERMISSIONS: cần network cho `pnpm install` + `npm view` + `osv-scanner`. Không secret,
  không external side effect nào khác.
HUMAN_DECISIONS_REQUIRED: none — hạn EOL và hướng kỹ thuật (v10, không override brace-expansion) đã
  bị khoá bởi phép đo trước đó (deps-security-bump lineage). Lựa chọn còn lại — đúng patch 10.x nào
  đủ tuổi `minimumReleaseAge`, đúng dạng chuỗi `engines.node` — suy ra được từ phép đo, không phải
  product choice.
SLICE_GRAPH: một slice, không fan-out. `depends_on` rỗng, nhưng CHIA SẺ token `build-config` với
  `deps-security-bump` và mọi slice khác đụng `package.json`/`pnpm-lock.yaml` ⇒ chạy TUẦN TỰ, không
  song song.
DEPENDENCIES: none
INVARIANTS: [build-config]
VERIFICATION: xem Acceptance matrix dưới + `verification` trong manifest (đã re-run thật, xem
  Live-truth verification). Viết bằng THUỘC TÍNH — không pin version/count nào; runtime manifest bị
  hash-lock sau `register`.
CODE_REVIEW: bắt buộc, 2 vòng clean liên tiếp cùng HEAD (P1).
SECURITY_REVIEW: không bắt buộc — xem lý do trên và `void_if` trong manifest.
BUDGETS: MAX_ROUNDS 5 · REGION_THRASH 3 cùng vùng ⇒ HALT. wall_time 180 phút.
STOP_CONDITIONS: STOP_AT_READY. HALT nếu (a) linted-file set đổi theo BẤT KỲ hướng nào, (b)
  `eslint:recommended` v10 sinh lỗi mới ở bất kỳ file nào, (c) `typescript-eslint` hoặc
  `@next/eslint-plugin-next` hoá ra cần nâng cấp khi đo lại lúc chạy, (d) không phiên bản 10.x nào đủ
  tuổi `minimumReleaseAge` lúc chạy.
DELIVERABLES: diff đúng scope · file-set baseline diff sạch (E10-2) · lockfile proof nhánh v1 đã mất
  (E10-3) · CI đầy đủ xanh · READY report nêu rõ finding `brace-expansion@5.0.7` còn lại và trỏ tới
  backlog follow-up.
```

---

## Live-truth verification — đo 2026-07-31

Không tin bất kỳ con số nào chép lại từ bản manifest 2026-07-29; đo lại trực tiếp trước khi author
verdict.

| Tiền đề | Bằng chứng | Kết quả |
|---|---|---|
| eslint hiện tại | `package.json`: `^9.18.0`; `node -e "require('./package.json').devDependencies.eslint"` → khớp; cây phụ thuộc thật resolve `eslint@9.39.4` (`pnpm why brace-expansion`) | ✅ khớp `_problem` |
| `engines.node` hiện tại | `package.json.engines.node` = `>=22` (đo qua `node -p`) | ✅ khớp — admits 22.0.0–22.12.x, đúng lỗ mà v10 từ chối |
| lint script | `package.json.scripts.lint` = `eslint .` | ✅ |
| `eslint.config.mjs` | flat config; block Node-globals `files: ["scripts/**/*.{mjs,js}"]` tồn tại đúng dòng 64 | ✅ |
| `brace-expansion@1.1.16` | `pnpm why brace-expansion` → `minimatch@3.1.5` ← (`@eslint/config-array@0.21.2`, `@eslint/eslintrc@3.3.5`) ← `eslint@9.39.4` | ✅ khớp `_problem`; nhánh này BIẾN MẤT khi lên v10 |
| `brace-expansion@5.0.7` (KHÔNG có trong bản đo 2026-07-29) | `pnpm why brace-expansion` → `minimatch@10.2.5` ← `@typescript-eslint/typescript-estree@8.62.1` ← `typescript-eslint@8.62.1` — hoàn toàn tách khỏi version eslint | ⚠️ E10-4 gốc SAI (khẳng định osv-scanner sẽ sạch brace-expansion); đã sửa, xem Acceptance matrix |
| Node local | `node --version` → `v22.22.1` (bản manifest 2026-07-29 ghi `v22.22.3` — lệch nhỏ, không đổi kết luận: cả hai đều thoả `^22.13.0`) | ✅ |
| Node CI | `.github/workflows/ci.yml:41` → `node-version: 22` | ✅ resolve 22.x mới nhất tại thời điểm chạy |
| eslint 10.x mới nhất + tuổi phát hành | `npm view eslint time --json`: `10.8.0` publish `2026-07-24T20:15:20.693Z`. `minimumReleaseAge` 10080 phút (7 ngày) ⇒ đủ tuổi từ `2026-07-31T20:15:20Z` UTC = **`2026-08-01 03:15` giờ Việt Nam**, KHÔNG PHẢI "cả ngày 31/07" như cách viết cũ dễ hiểu lầm. `10.7.0` (publish `2026-07-10`) đã chắc chắn đủ tuổi bất kể giờ nào trong ngày, dùng làm fallback an toàn nếu phiên chạy sớm hơn mốc giờ trên | ⚠️ tinh chỉnh so với bản trước — HALT nếu không phiên bản nào đủ tuổi tại giờ chạy thật, đừng giả định "hôm nay là được" |
| `osv-scanner` CLI | có sẵn local (`/opt/homebrew/bin/osv-scanner`, v2.4.0); `osv-scanner --lockfile=pnpm-lock.yaml` chạy được, invocation legacy vẫn hoạt động dù CLI mới dùng subcommand `scan source` | ✅ |
| `npx --yes semver` cho kiểm tra `engines.node` | THỬ và LOẠI BỎ 2026-07-31: bị chính policy thực thi của môi trường chặn (external package chưa khai báo) VÀ cho kết quả SAI khi test thật (báo `>=22` đã thoả điều kiện loại trừ 22.0–22.12, trong khi thực tế nó KHÔNG loại trừ) | ❌ không dùng; xem `verification.focused` trong manifest cho check đã thay bằng literal-diff không phụ thuộc package ngoài |

---

## Acceptance matrix

| # | Nhóm | Input / precondition | Expected | Layer |
|---|---|---|---|---|
| A1 | Happy | eslint 10.x eligible đã cài, `pnpm lint` chạy | exit 0 (E10-1) | canonical |
| B1 | Boundary | linted file set trước vs sau, so bằng sorted repo-relative path list | GIỐNG HỆT — hẹp hơn HOẶC rộng hơn đều là FAILURE (E10-2) | focused |
| B2 | Boundary | `package.json.engines.node` trước vs sau | không còn ĐÚNG BẰNG literal `>=22`; dải cuối cùng phải loại trừ 22.0.0–22.12.x, việc này do coding agent + code-review xác nhận bằng đọc trực tiếp giá trị (E10-5) | focused (literal-diff) + code-review |
| B3 | Boundary | thuật toán tìm config mới của v10 (từ thư mục file thay vì cwd) trên pnpm workspace này | không làm hẹp file set — chính là B1, cùng một phép đo | focused |
| C1 | AuthZ | — | KHÔNG áp dụng — slice này không có auth/tenant/identity surface | n/a |
| D1 | Failure | không phiên bản eslint 10.x nào đủ tuổi `minimumReleaseAge` tại giờ chạy thật | HALT, không cài phiên bản chưa đủ tuổi dù đã tới ngày 2026-07-31 theo lịch (xem live-truth: mốc giờ chính xác) | gate |
| D2 | Failure | `typescript-eslint` hoặc `@next/eslint-plugin-next` hoá ra cần nâng cấp khi đo lại lúc chạy | HALT, report — mở rộng scope cần owner authorize, không tự quyết | gate |
| E1 | Concurrency | — | KHÔNG áp dụng — thay đổi build-tooling đơn luồng, không có concurrent writer/lock semantics | n/a |
| F1 | Migration (dependency, không phải DB) | `pnpm-lock.yaml` resolved entries trước vs sau cho `brace-expansion`/`minimatch` | nhánh `minimatch@3.x → brace-expansion@1.x` biến mất hoàn toàn (E10-3) | focused |
| F2 | Migration | `git diff eslint.config.mjs` | chỉ chứa đúng phần v10 compat thật sự đòi hỏi; block Node-globals `scripts/**/*.{mjs,js}` giữ nguyên (E10-6, E10-7) | focused + code-review |
| G1 | Security/privacy | `osv-scanner --lockfile=pnpm-lock.yaml` trước vs sau | finding `brace-expansion@1.1.16` biến mất; finding `brace-expansion@5.0.7` (không liên quan, qua `typescript-eslint`'s own `minimatch@10.2.5`) ĐÚNG là vẫn còn và phải được BÁO CÁO chứ không bị coi là chưa xong hay bị silence (E10-4, đã sửa) | manual + code-review |
| H1 | Regression | full CI command list (typecheck/format:check/review:check/lint/build/test) + workspace test count | tất cả xanh; test count khớp baseline đo LÚC CHẠY, không tin số 561 chép trong doc này (E10-8, E10-9) | canonical |
| H2 | Regression | `eslint:recommended`'s rule set mới của v10, chạy trên toàn repo | bất kỳ lỗi MỚI nào cũng phải REPORT + HALT, không được tự sửa hay silence (E10-7) | gate |
| I1 | Observability | READY report | phải nêu tên chính xác finding `brace-expansion@5.0.7` còn lại và slug backlog follow-up, không được để nó biến mất khỏi báo cáo (E10-4) | manual |
| J1 | Scope | `git diff --stat main...HEAD` | chỉ chạm đúng 5 file trong `scope`; enforced CƠ HỌC bởi `SCOPE_DRIFT` của chính readiness gate (E10-10) | gate |

---

## Open questions trong scope

**0.** Không còn product choice nào mở. Hạn EOL và hướng kỹ thuật (v10, không override
`brace-expansion`) đã bị khoá bởi phép đo của `deps-security-bump` lineage; lựa chọn còn lại (patch
10.x chính xác, dạng chuỗi `engines.node` chính xác) là suy ra được từ đo lường, không phải quyết
định sản phẩm.

Một phát hiện MỚI khi author hôm nay — không phải open question chặn slice này, mà là một phạm vi
liền kề bị lộ ra:

| Phát hiện | Vì sao không chặn slice này |
|---|---|
| `brace-expansion@5.0.7` qua `minimatch@10.2.5` ← `typescript-eslint@8.62.1`'s own `typescript-estree` — đo bằng `pnpm why brace-expansion` 2026-07-31 | Hoàn toàn độc lập với version eslint; slice này không nâng `typescript-eslint` (negative scope cấm rõ). Đã routed sang backlog entry mới `eslint10-brace-expansion-5-0-7-typescript-estree` (`idea`, chưa scope) thay vì để mất trong transcript hoặc cố đóng lệch scope. |

---

## Verdict

```text
REVIEW_POLICY_VERSION: 1.3
REVIEW_VERDICT: CODE_READY
REVIEWED_AT: 2026-07-31
AUTHORITY_SHA: c759c63293a3555d957f58f4a82a06b1f35cfdda
BASE_BRANCH: main
TARGET_FILES:
  - docs/autopilot/contracts/autopilot-eslint-10-migration.md
  - docs/autopilot-manifests/eslint-10-migration.json
  - package.json
  - pnpm-lock.yaml
  - eslint.config.mjs
SLICE: eslint-10-migration
IN_SCOPE: eslint ^9.18.0 -> ^10 across the workspace, lockfile regenerated, engines.node tightened to exclude 22.0.0-22.12.x, eslint.config.mjs adjusted only for strictly-required v10 compatibility, proof the linted-file set is unchanged
OUT_OF_SCOPE: any rule configuration change · typescript-eslint upgrade · next/postcss bump (deps-security-bump) · source-code changes to satisfy lint · closing the separate brace-expansion@5.0.7 finding (typescript-eslint's own minimatch@10.2.5, unrelated to eslint's version)
G1_DECISION: PASS
G2_SPEC: PASS
G3_DEPENDENCY: PASS
G4_TEST: PASS
G5_SCOPE: PASS
G6_EXTERNAL: PASS
HARD_DEPENDENCIES: none — root, independent slice; shares build-config token with deps-security-bump (sequential, not blocking)
PRIOR_SLICES: none
OPEN_QUESTIONS_IN_SCOPE: 0
ENABLEMENT_ONLY_GATES: none
LIVE_REPO_VERIFICATION: PASS
CONTRACT_MATRIX: PASS
CLOSURE_MATRIX: PASS (12/12)
ACCEPTANCE_MATRIX: PASS
SECURITY_AND_MIGRATION_GATE: PASS
IMPLEMENTATION_ARTIFACTS: PASS
FIRST_IMPLEMENTATION_STEP: write .autopilot/state/eslint-10-migration/design-probe.md AND the companion .autopilot/state/eslint-10-migration/design-probe-file-list.txt (sorted repo-relative linted file paths from `npx eslint . -f json`) BEFORE any edit, re-measuring all four _design_probe items in the manifest, then STOP for founder confirmation
REMAINING_BLOCKERS: none
```

### Closure matrix

| # | Gate | Bằng chứng | |
|---|---|---|---|
| 1 | Authority pin theo SHA | `c759c63` (ancestor-of-main, đo `git merge-base --is-ancestor`) + `TARGET_FILES` liệt kê exact, không glob | PASS |
| 2 | Decision trong scope đã chốt | hạn EOL 2026-08-06 (external, immovable) + hướng kỹ thuật v10 đã bị khoá bởi phép đo `deps-security-bump` lineage (override brace-expansion vỡ runtime) | PASS |
| 3 | Scope IN/OUT và owner rõ | manifest `scope` 5 file exact + `negative_scope` 9 mục | PASS |
| 4 | Dependency phân loại đủ | none — root, `depends_on: []`; chia sẻ token `build-config` với `deps-security-bump` (tuần tự, không phải hard dependency) | PASS |
| 5 | Live schema/code khớp doc | package.json/pnpm-lock.yaml/eslint.config.mjs đo trực tiếp 2026-07-31, cả `pnpm why brace-expansion` lẫn `npm view eslint time` — xem Live-truth verification | PASS |
| 6 | Data/contract đủ | linted-file-set baseline mechanism pin đúng file `.autopilot/state/eslint-10-migration/design-probe-file-list.txt`; engines.node property pin đúng literal cần loại bỏ | PASS |
| 7 | Fail-closed/order đủ | mọi ambiguity (version chưa đủ tuổi, plugin cần nâng cấp, rule mới sinh lỗi) đều route tới HALT, không auto-fix | PASS |
| 8 | Open question trong scope | 0 — một phát hiện liền kề (brace-expansion@5.0.7) đã route sang backlog riêng, không chặn slice này | PASS |
| 9 | Acceptance matrix có expected | 14 hàng (kể cả 2 hàng N/A có lý do rõ), mỗi hàng có input · precondition · expected · layer | PASS |
| 10 | Migration/security/rollback pin | không DB migration; dependency-lockfile "migration" pin đúng property (F1); rollback = revert thuần, không route production nào phụ thuộc eslint tại buildtime runtime | PASS |
| 11 | First slice hard deps merged | root, không có gì phải chờ | PASS |
| 12 | Implementation handoff sẵn sàng | slice doc + manifest (Shape hiện hành, `verification.focused` đã re-test thật) + backlog entry + launcher `ap-42` | PASS |

**Điều verdict này KHÔNG chứng minh.** Nó không nói `brace-expansion@5.0.7` đã đóng — đó là một finding
độc lập, routed sang backlog riêng, chưa được scope. Nó không phải bằng chứng runtime: `CODE_READY`
nghĩa là mở worktree được, không phải `IMPLEMENTED`.

---

## Changelog

| Ngày | Version | Thay đổi |
|---|---|---|
| 31/07/2026 | v0.1 | Author slice doc + rewrite manifest sang shape hiện hành (`verification.focused/canonical/e2e` thật, `code_review.clean_rounds`, `scope` gồm cả slice doc + manifest), sau khi phát hiện bản 2026-07-29 thiếu cả bốn: `verification` (dùng `_acceptance` prose thay vì lệnh chạy được), `code_review.clean_rounds` (dùng `codex_review: "2x_clean"` string thay vì field validator thật đọc), `scope` (chưa có slice doc vì chưa tồn tại), và một sai sót thực chất — E10-4 khẳng định osv-scanner sẽ hết sạch finding brace-expansion, đo lại bằng `pnpm why brace-expansion` cho thấy có MỘT finding thứ hai (`5.0.7` qua `typescript-eslint`'s own `minimatch@10.2.5`) hoàn toàn độc lập với version eslint, đã sửa + routed sang backlog riêng. Thử `npx --yes semver` cho check `engines.node` rồi loại bỏ: vừa bị chặn bởi policy thực thi môi trường (external package chưa khai báo) vừa cho kết quả sai khi test thật; thay bằng literal-diff không phụ thuộc package ngoài, hẹp hơn về phạm vi chứng minh nhưng đúng và không phụ thuộc gì bên ngoài. Mọi lệnh `verification.focused` đã chạy thật (`spawnSync` y hệt gate) trước khi commit, không chỉ parse cú pháp. |

---

## Bản ghi ngoại lệ owner — tái dựng 2026-08-02 sau khi merge

> **Vì sao phần này ở đây, và vì sao nó là bản tái dựng.** Bốn ngoại lệ dưới đây sống trong
> `.autopilot/state/eslint-10-migration/OWNER-EXCEPTION-code-fix-in-doc-only-registration.txt`, một
> thư mục **gitignored nằm trong worktree**. `ap-finish` xoá worktree khi dọn, nên bản ghi thẩm quyền
> cho mọi thay đổi code ngoài hợp đồng đã biến mất cùng nó. Nội dung dưới đây tái dựng từ commit
> message của các archive branch và từ slice doc ở `archive/eslint-10-migration-sixth-registration`,
> **không** từ file gốc — file gốc không còn.
>
> Đây là lỗ hổng đã được nêu trong chính phiên làm việc này rồi mới xảy ra: *thẩm quyền chỉ tồn tại
> trong state gitignored là thẩm quyền tái dựng từ trí nhớ.* Bản sửa lẽ ra là chuyển bản ghi sang file
> tracked, nhưng registration 7 đưa slice doc ra khỏi scope nên không thể ghi trên branch. Ghi ở đây,
> sau merge, là chỗ đúng — một bản ghi thẩm quyền không nên nằm bên trong thứ mà nó cho phép.

Registration 4 khai `negative_scope: NO code changes`. Nó bị vi phạm bốn lần, mỗi lần có uỷ quyền
tường minh của owner. Ghi lại **cả căng thẳng**, không làm mượt: hợp đồng nói một đằng, owner cho
phép một nẻo, và cả hai đều đúng ở thời điểm của mình.

| # | Thay đổi | Vì sao được cho phép |
|---|---|---|
| 1 | `ensureRoleExists` — `safeLogSummary` tĩnh, không nhúng `role` | `throwMigrateError(message, message)` đẩy giá trị do caller cung cấp qua đúng kênh mà formatter tin tưởng vô điều kiện. Cùng lớp lỗi mà cả registration tồn tại để chặn, ở một throw site đã bị phân loại nhầm là an toàn. |
| 2 | Gỡ `constraint`/`table`/`column` khỏi `SAFE_STRUCTURED_LOG_FIELDS` | `RAISE ... USING TABLE = <bất kỳ>` đặt được các trường này thành dữ liệu tuỳ ý — đo trực tiếp với `TABLE = 'pii-diagnostic-field@example.com'`. Giả định "Postgres luôn điền định danh schema thật" sai. |
| 3 | Bọc `readdir`/`readFile` qua `throwMigrateError` | Sau khi gỡ `code`, một fs error không bọc in ra **đúng dòng chung chung, không chẩn đoán gì**. Quyết định bởi phép đo ở sink, không phải suy luận về error object: `formatMigrationFailureForLog` không đọc `.message` với bất kỳ đầu vào nào. |
| 4 | Bọc 6 trong 16 await site có thể reject ngoài vùng đã bọc | Ngoại lệ 3 đóng hai site; chỉ thị của owner khi đó nói "throw site", hẹp hơn thuộc tính thật. `client.connect()` và ba truy vấn setup lọt qua đúng khe đó. Mở rộng thành cả lớp thay vì vá từng chỗ. Hai site trong `finally` **cố ý loại trừ** — throw ở đó che mất error gốc. |

Ngoại lệ thứ năm không nằm trong bảng vì nó không phải ngoại lệ: registration 11 thay tag `Symbol`
bằng `WeakMap` module-private. `Object.getOwnPropertySymbols()` lấy lại được Symbol từ bất kỳ Error
đã tag nào, mà Error đã tag thì được ném ra ngoài module theo thiết kế — nên "Symbol không export"
chưa bao giờ là riêng tư. Đó là finding của **security review**, vòng đầu tiên nó chạy được sau mười
registration.
