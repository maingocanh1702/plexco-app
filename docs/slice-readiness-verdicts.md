<!-- review-readiness: enforce -->
# Slice Readiness Verdicts — Plexco

> **Đây KHÔNG phải nguồn rule mới.** Rules ở `standards/review-code-readiness-gate.md` (owner-accepted 2026-07-19). File này chỉ **áp dụng** gate đó để ra verdict nhị phân cho các slice gần nhất, dùng đúng template §7 và closure matrix §8.
> **Current snapshot pin:** `AUTHORITY_SHA = 784bc8dd297163a5ec5415f33beabbbf34bbc8d7` (`main` = `origin/main`) · verify 2026-07-28. Mỗi historical verdict vẫn giữ SHA riêng trong block của nó; không dùng header hiện hành để re-interpret snapshot cũ.
> **Live truth đã verify (`main@784bc8d`):** 25 migrations `0000`–`0024`; suite 32 files / 537 workspace tests + 13 readiness-validator tests; Safari macOS+iOS M3 measured PASS nhưng Google login chưa có bằng chứng enabled/go-live. Job core/ack/dispatcher/preflight/schedule đã implemented, nhưng schedule exact-string mặc định OFF, delivery còn placeholder terminal-DLQ và chưa có producer/real projector/replay. `0014` đã có waitlist schema nhưng chưa SessionService/promotion behavior; DD-87 core đã merge nhưng chưa production caller. Exact Chat authority landed at `90d292d` and primary plan v1.8 is `PLAN_READY`; no Chat slice has inherited `CODE_READY`, and no Chat runtime exists. Docs/decision/code-dark không phải runtime proof.
> **Current auth refresh (2026-07-20):** `origin/main@033ccc8fd9c3f247abf8aa0cb5a0f48b96d006e2` — DD-80 v1.88 authority bundle immutable on main. **Verdict 5a (D0a) = CODE_READY** (re-pinned 033ccc8); Verdict 5b (D0b) `NOT_CODE_READY` pending D0a merge. Verdicts 1/3/4 remain historical snapshots only.
> **D0a IMPLEMENTED & MERGED (2026-07-20):** slice `auth-s4-d0-revoke-core` squash-merged to `main` (migration `0015` live). The P0 "2 consecutive FULL-base Codex clean" gate was **NOT reached** after 12 rounds (10 real findings fixed incl. round-06 epoch-vs-`revoked_at` P1; round-11 self-caught + `git revert`ed) → merge is a **documented owner override** resting on manual review + acceptance coverage 22/22 + real-Postgres 97/97, **not** an automated clean-round pass. See `.autopilot/state/auth-s4-d0-revoke-core/HALT-MAX_ROUNDS.txt` + the squash commit. **Verdict 5b (D0b) unblocks** once the D0a squash lands on origin/main.
> **D0b IMPLEMENTED & MERGED (2026-07-22):** slice `auth-s4-d0-session-web-boundary` squash-merged to `main@93c5404` (issuance fence + logout-all route; zero DB change). Unlike D0a, the P0 **"2 consecutive FULL-base Codex clean rounds" gate was MET** (round-03/04, only 2 fix rounds) — **no owner override**. Real-Postgres suite green (db 97/97 unchanged · core 111 · bot 3 · web 78). Recorded as **Verdict 6**. Next in chain: `auth-s4-d1-email-token-core`.
> **Machine classification (2026-07-22):** `<!-- review-verdict: historical -->` controls immutable blocks; unmarked blocks are current for their own pinned slice/snapshot. **Verdict 15** (historical) recorded DD-87 as owner-decided but `NOT_CODE_READY` solely because its authority packet was uncommitted WIP outside `main@6a28072`; that packet is now committed and pushed (`main@142e9fa`+), so **Verdict 16** re-pins it `CODE_READY` at `main@827d24d`. Neither supersedes unrelated active candidates.
> **Current candidate (2026-07-27):** Verdict 26 là active `CODE_READY` authority cho probe `db-check-constraint-naming-drift`; tuân theo gate riêng trong block. Verdict 19 và mọi verdict cũ giữ nguyên historical pin/status của thời điểm phát hành, không được dùng header này để hồi tố authorize.
> **Live-truth refresh (2026-07-29), đo tại `3d75c90d32bd52b8704794216fdcad63d54261e8`** (khi đó `main` = `origin/main`; sau đó 8 commit docs-only `66c8d02` … land trong cùng phiên để gỡ khối uncommitted — không migration, không code, không test, nên mọi con số dưới đây giữ nguyên). Header snapshot `784bc8d` ở trên là snapshot **của 2026-07-28** và giữ nguyên như bằng chứng thời điểm; nó **không còn là HEAD**. Năm commit xen giữa (`49fd155`, `1747b8c`, `ed38106`, `ae9bc37`, `3d75c90`) gồm autopilot kit v10→v11, HANDOFF v1.28 Level 3, và squash `0025`. Live truth đổi hai chỗ: **26 migrations `0000`–`0025`, tail nay là `0025`** (không còn `0024`), và **suite 561 workspace tests** (core 132 · db 243 · web 146 · bot 40; db 219→243) + 13 readiness-validator tests. Mọi khẳng định khác của snapshot `784bc8d` vẫn đúng. **Cảnh báo drift:** chuỗi `784bc8dd297163a5ec5415f33beabbbf34bbc8d7` được mô tả là "current HEAD" trong ~30 file docs khác của working tree hiện hành; câu đó nay sai ở mọi chỗ nó xuất hiện, và phải sửa hoặc đổi cách diễn đạt thành "authority snapshot" trước khi commit khối đó.
> **Current candidate (2026-07-29):** Verdict 27 ghi nhận `db-check-constraint-naming-drift` **IMPLEMENTED & MERGED** tại `main@3d75c90`. Verdict 26 chuyển thành authority lịch sử của chính slice đó (giữ nguyên nội dung, gồm cả con số 47/72 mà phép đo sau đó bác bỏ — xem Verdict 27). **Không còn active `CODE_READY` candidate nào**: hàng đợi backlog có 0 task `ready`, và slice runnable gần nhất là `deps-security-bump` với `not_before: 2026-07-30`.

---

## Verdict 29 — `reconcile-close-by-hand-declaration`: dạy autopilot-backlog-reconcile hiểu khai báo đóng-tay có chủ đích (2026-07-30)

> **Canonical block sống trong `docs/autopilot-reconcile-close-by-hand-declaration.md`** (mode
> `code-ready`, đó là coding handoff). Block dưới là **bản mirror trong tracker** — sửa một chỗ phải
> sửa cả hai; nếu hai bên lệch, bản trong slice doc thắng.
>
> **Vấn đề đo được:** `scripts/autopilot-backlog-reconcile` (KIT_VERSION 4) coi MỌI `merged_probe`
> không phải identifier-shaped là lỗi tác giả, in `✗ WEAK-PROBE … replace merged_probe with a code
> symbol`. Lời khuyên đó đúng cho hầu hết slice, **bất khả thi** cho ba lớp backlog đã tự đặt tên:
> `dependency-security` (bump lockfile không tạo symbol nào), `owner-evidence-gate` (đóng bằng bằng
> chứng, không bằng commit), `docs-reconcile` (token có gạch nối, trượt `is_symbol_probe`). Trigger đo
> 2026-07-30: `deps-security-bump` merged tại `61a2575` nhưng `--fix` từ chối flip vì
> `pnpm-lock.yaml :: 15.5.21` là literal dùng chung, không phải symbol slice-unique.
>
> **Phát hiện thêm khi author, không có trong backlog notes gốc:** `scripts/autopilot-backlog-reconcile`
> là file **kit canonical** — verify byte-identical với `$HOME/Projects/Claude template/autopilot/parallel/autopilot-backlog-reconcile`
> (cả hai `# KIT_VERSION: 4`, đo 2026-07-30), không phải tooling riêng của Plexco; git log của chính file
> này trong repo Plexco xác nhận luôn được **sync**, chưa từng hand-author độc lập (`1e503d1`, `54de276`).
> `autopilot-sync.cjs` (SessionStart hook) không quản lý file này — không có lưới an toàn tự động bắt
> lệch bản. Theo invariant chuẩn *"Shared KIT fixes land canonical-first … Never hand-fix only a copy"*,
> implementation thật phải land ở file canonical trước (một repo Git khác, ngoài worktree/scope-gate của
> slice này hoàn toàn), bump `KIT_VERSION` 4→5, rồi mới sync byte-identical xuống Plexco — pin thành
> `NEGATIVE_SCOPE` + acceptance `RCH-12` trong slice doc.
>
> **Thiết kế:** khai báo `close_by: hand · <reason>` (đã có tiền lệ sống ở block `deps-security-bump`,
> dòng 485) luôn thắng suy luận từ trạng thái probe — báo `⊘ manual-close: <slug>`, không bao giờ vào
> `stale[]`/`weak[]`, không bao giờ tự flip qua `--fix` dù probe có match hay identifier-shaped hay
> không. Thiếu lý do sau dấu `·` → cảnh báo `MALFORMED`, rơi về đúng discriminator rule cũ (chặn cửa sau
> né gate thay vì lặng lẽ chấp nhận). Abuse guard: `close_by: hand` + `scope` chứa file mã nguồn thật
> (không tính manifest/lockfile/workspace-config/docs) → cảnh báo to, tối thiểu ở `--audit`.
>
> **Điều verdict này KHÔNG chứng minh:** implementation chưa tồn tại — `CODE_READY` nghĩa là mở worktree
> được, không phải `IMPLEMENTED`. Nó cũng không chứng minh canonical template đã được sửa — đó là bước
> đầu tiên của coding session (`FIRST_IMPLEMENTATION_STEP` dưới).

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
FIRST_IMPLEMENTATION_STEP: land the close_by: hand parsing + ⊘ manual-close reporting change in the canonical template file first ($HOME/Projects/Claude template/autopilot/parallel/autopilot-backlog-reconcile), bump its # KIT_VERSION: header 4→5, verify against fixtures for RCH-1..RCH-5, then sync the byte-identical file into scripts/autopilot-backlog-reconcile before touching the abuse guard (RCH-6/RCH-7)
REMAINING_BLOCKERS: none
```

---

## Verdict 28 — `authorize-tenant-action-core`: ba phép đo lật cách đặt task gốc, và slice tách ra trở thành root dependency (2026-07-30)

> **Canonical block sống trong `docs/autopilot-authorize-tenant-action-core.md`** (mode `code-ready`,
> đó là coding handoff). Block dưới là **bản mirror trong tracker** — sửa một chỗ phải sửa cả hai;
> nếu hai bên lệch, bản trong slice doc thắng.
>
> **Verdict này cấp phép cho một slice KHÔNG tồn tại trước hôm nay.** Backlog có
> `tenant-capability-authority-core` (`change_class: schema-migration`, title nói closed registry +
> least-privilege preset + tenant-private grants + append-only audit). Ba phép đo cho thấy nó gộp hai
> thứ khác hẳn nhau, và cả ba đều lật một khẳng định của chính task gốc:
>
> **(1) `hasCapability` không cài được với dữ liệu sống.** Spec đọc `entitlements.capabilities.<key>`.
> Seed sống `0011:18-23` là **flat** — `'{"web_app": true, "telegram": false, "zalo": false}'` — không có
> lớp bọc `capabilities`, tên khoá khác (`zalo` vs `bot_zalo`), thiếu toàn bộ khoá nghiệp vụ. CHECK sống
> vẫn `plan_key IN ('free_web','telegram','plus_channel','all_channels')` (`0007:14`). Mọi lần gọi sẽ trả
> `undefined`. Chính spec tự cảnh báo điều này ở dòng 35 (`⚠️ PENDING MIGRATION`) — nhưng cảnh báo nằm
> trong comment SQL của một code block, chỗ dễ đọc lướt qua nhất.
>
> **(2) Task gốc khai một hard dependency chưa merged.** `depends_on: [dd38-dd86-chat-schema-core]`,
> status `idea` ⇒ `register` sẽ `HALT DEP_MISSING` ngay lệnh đầu. Nhưng `authorizeTenantAction` không đọc
> một bảng chat nào — phụ thuộc đó thuộc nửa capability. Tách xong, slice **tự gỡ blocker của chính nó**
> và thoả B1 qua mệnh đề *"hoặc slice hiện tại chính là dependency gốc"*, chứ không phải bằng cách chờ.
>
> **(3) Task gốc khai `invariants: [schema, ...]`** trong khi slice này không thêm migration và không sửa
> `schema.ts`. Khai thừa `schema` sẽ khoá lane của **mọi** slice migration khác — một chi phí song song
> hoá trả cho một ràng buộc không có thật.
>
> **Ba tiền đề của spec đã đo trực tiếp, không đọc prose:** `tenants.status` DEFAULT `'trialing'` + CHECK
> 5 giá trị (`0002:15-16`, constraint nay tên `tenants_status_chk` sau `0025`) · `subscriptions.status`
> cùng CHECK (`0007:34`) · `tenant_provision` set `'active'` tường minh, không rơi vào default (`0012`).
> Cả ba đúng. Hệ quả cho test: vì **có** CHECK, case 1b chỉ dựng được bằng giá trị hợp lệ trong enum.
>
> **Hai bài học của AP-39 đã áp thẳng vào manifest.** Slice doc và authored manifest nằm **trong** `scope`
> — AP-39 để contract doc ngoài scope, reviewer nêu đúng chỗ lệch đó ở round 2, 4, 6, và writer không có
> quyền đóng; ba vòng fix tiêu vào việc giải thích một khoảng cách không đóng được. Và `verification` viết
> bằng **thuộc tính**, kèm dòng cấm tin bất kỳ con số nào chép trong repo.
>
> **Điều verdict này KHÔNG chứng minh:** publish chưa sẵn sàng (slice này chưa wire caller nào) ·
> `hasCapability` chưa sẵn sàng (chờ DD-29) · `CODE_READY` ≠ `IMPLEMENTED`.

```text
REVIEW_POLICY_VERSION: 1.3
REVIEW_VERDICT: CODE_READY
REVIEWED_AT: 2026-07-30
AUTHORITY_SHA: b4d08c83767f0ff6693a05452e61248b58defc01
BASE_BRANCH: main
TARGET_FILES:
  - docs/autopilot-authorize-tenant-action-core.md
  - docs/autopilot-manifests/authorize-tenant-action-core.json
  - docs/features/BE/feature_billing_lifecycle_tech.md
  - docs/features/BE/feature_session_management_tech.md
  - packages/db/migrations/0002_tenants_core.sql
  - packages/db/migrations/0007_billing.sql
  - packages/db/migrations/0012_auth_functions.sql
SLICE: authorize-tenant-action-core
IN_SCOPE: authorizeTenantAction resolver — fail-closed 2-step effective-status resolution over tenants.status then subscriptions.status, với locking read cho nhánh mutating; unit + real-Postgres tests
OUT_OF_SCOPE: hasCapability · plans enum/seed/entitlements (DD-29) · migration nào · wiring vào publish/session/billing route · error code mới · write path cho tenants.status
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
FIRST_IMPLEMENTATION_STEP: tạo packages/db/src/authorization.ts với chữ ký nhận tenantId (KHÔNG nhận status đã resolve sẵn) và test case 3 (allow path) trước, để pin shape trước khi thêm nhánh deny
REMAINING_BLOCKERS: none
```

---

## Verdict 27 — `db-check-constraint-naming-drift`: 40 rename, đo lại bác bỏ con số của chính verdict cấp phép; IMPLEMENTED & MERGED `3d75c90` (2026-07-29)

> **Verdict này ghi nhận thực thi, không cấp phép mới.** Authority thiết kế vẫn là Verdict 26 tại `6ae2de6`.
>
> **Điều đáng ghi nhất không phải migration — mà là design probe đã bác bỏ con số của verdict cấp phép cho nó,
> lần thứ ba trong cùng một chuỗi.** Ba phép đếm nối nhau, mỗi cái sửa cái trước: manifest gốc **27 trên 23
> bảng** (đếm `awk` dòng `CHECK (` trong `0002`–`0008`); Verdict 26 sửa thành **47/72** (query `pg_constraint`
> tại `81b4fe8`) và tự ghi rằng bản trước *"sai 20"*; rồi design probe đo lại tại `2dc9b8c` bằng **hai đường độc
> lập** — regex quét `pgTable(`/`check(` và Drizzle `getTableConfig(table).checks` chạy thật qua `tsx` — và ra
> **67 khai · 73 sống · 27 đúng tên · 40 cần rename · 0 khai-mà-vắng · 6 sống-mà-không-khai**, khớp hai chiều
> (`27+40+0=67`, `27+40+6=73`).
>
> **47 sai không phải vì đếm nhầm, mà vì gộp hai thứ khác nhau vào một rổ**: "cần rename" và "sống nhưng chưa
> bao giờ được khai" có cách sửa khác hẳn — cái đầu là migration đổi tên, cái sau là sửa `schema.ts` và **không
> cần migration nào**. Một con số gộp sẽ dẫn tới một slice làm sai việc cho 7 constraint. Đây đúng là lớp lỗi
> slice này sinh ra để sửa, và nó tái diễn **bên trong chính verdict cấp phép** — đo `pg_constraint` đã đúng
> hơn đếm khai báo, nhưng vẫn chưa phân loại cái mình đo.
>
> **Phần bác bỏ đáng mừng: `0` guard vắng mặt.** Verdict 26 nêu khoảng cách 63-vs-72 và gọi thẳng vế nặng của
> nó — *"một guard mà người ta tin là đang enforce nhưng **không tồn tại**"*. Đo cho thấy vế đó bằng **0**: cả
> 67 khai báo đều có constraint sống cùng predicate. Toàn bộ khoảng cách nằm ở chiều ngược lại (6 constraint
> sống không được mô tả). Ghi rõ vì **sự vắng mặt của một finding cũng là finding** — và CND-11 yêu cầu nó được
> kiểm chứng chứ không được giả định.
>
> **Codex round-01 đổi cơ chế, và đó là finding P1 thật.** Bản đầu theo đúng idiom `0014`: `DROP CONSTRAINT` +
> `ADD CONSTRAINT` dưới tên khai. Trên bảng có dữ liệu, `ADD CONSTRAINT` **re-validate predicate trên mọi row**
> trong khi giữ `ACCESS EXCLUSIVE`, và vì cả 40 rename nằm trong một transaction, lock giữ tới commit cuối —
> rủi ro thật trên `charges` · `bank_transactions` · `payment_allocations` · `bank_accounts`. `RENAME CONSTRAINT`
> là cập nhật catalog thuần: không quét bảng, không re-validate, và **không có mệnh đề predicate nào phải chép
> tay** — xoá luôn một lớp rủi ro transcription mà CND-4 được dựng để bắt. Cơ chế tốt hơn cả cái mà verdict cấp
> phép hình dung.

```text
REVIEW_POLICY_VERSION: 1.3
REVIEW_VERDICT: CODE_READY
REVIEWED_AT: 2026-07-29
AUTHORITY_SHA: 6ae2de6470573eadc9ef151306002a7b869dcd8b
BASE_BRANCH: main
TARGET_FILES:
  - docs/autopilot-manifests/db-check-constraint-naming-drift.json
  - packages/db/migrations/0025_check_constraint_naming_drift.sql
  - packages/db/src/rls-invariants.test.ts
  - packages/db/src/migrate.test.ts
SLICE: db-check-constraint-naming-drift
IN_SCOPE: exactly ONE monotonic migration 0025 renaming 40 auto-generated CHECK constraint names across 23 tables to the names schema.ts already declares, via RENAME CONSTRAINT (catalog-only, zero predicate text restated); CND-1..CND-11 regression guards incl. the pre-0025 predicate-snapshot replay; the quantified declaration-gap report (67 declared / 73 live / 27 correct / 40 renamed / 0 declared-but-absent / 6 live-but-undeclared)
OUT_OF_SCOPE: any predicate change; creating the 6 live-but-undeclared constraints' schema.ts declarations (reported only -- split to db-undeclared-check-constraints-schema-mirror); column, nullability, default or type changes; RLS, role or grant changes; edits to applied migrations 0000-0024; sessions_public_capacity_chk from 0024, already correctly named; anything outside packages/db
G1_DECISION: PASS
G2_SPEC: PASS
G3_DEPENDENCY: PASS
G4_TEST: PASS
G5_SCOPE: PASS
G6_EXTERNAL: PASS
HARD_DEPENDENCIES: none
PRIOR_SLICES: db-public-visibility-capacity-check (0024, merged c100937) -- surfaced the defect; not a code dependency
OPEN_QUESTIONS_IN_SCOPE: 0
ENABLEMENT_ONLY_GATES: none
LIVE_REPO_VERIFICATION: PASS (design probe measured against a purpose-built database plexco_check_probe migrated to tail 0024, applied=25 skipped=0, queried through pg_constraint/pg_get_constraintdef -- never from schema.ts source text -- and cross-checked by two independent methods: a regex scan of pgTable(/check( sites and Drizzle getTableConfig(table).checks executed against the real schema.ts module via tsx. Both converge on 67 declared. Result: 67 declared, 73 live, 27 already correctly named, 40 needing rename across 23 tables, 0 declared-but-absent, 6 live-but-undeclared. Both identities balance: 27+40+0=67 and 27+40+6=73. This REFUTES Verdict 26's own 47/72 figure, which conflated "needs rename" with "live but never declared"; it also refutes the launcher's stale 27-across-23. Money-path subset re-confirmed by name: charges 4, bank_transactions 4, payment_allocations 3, bank_accounts 1 -- note bank_accounts is 1, not the 2 the rescoped backlog line claimed, because bank_accounts_webhook_status_check falls in the undeclared bucket. Merged state re-verified 2026-07-29 on main@3d75c90: 0025 present as live tail, 26 migrations 0000-0025)
CONTRACT_MATRIX: PASS (all 40 renames enumerated table-by-table in the design probe appendix with the live pg_get_constraintdef paired against the schema.ts check() declaration; RENAME CONSTRAINT cannot alter a predicate by construction, and CND-1/2/3 prove it empirically by capturing the pre-0025 definition from a throwaway database migrated only through 0024 and comparing byte-for-byte against the post-0025 definition under the declared name)
CLOSURE_MATRIX: PASS (12/12 -- authority pinned at 6ae2de6 with exact target files; the naming-identity fix is the settled 0014 decision applied where it was never applied; scope IN/OUT pinned with the 6 undeclared explicitly reported-not-fixed; no unmerged dependency; live catalog verified by two independent methods rather than assumed; rename inventory complete and balanced by two arithmetic identities; fail-closed via catalog-only RENAME inside migrate.ts's per-file transaction; zero open questions; CND-1..CND-11 have expected results; monotonic tail with 0000-0024 byte-identical; manifest handoff done and the item-(e) follow-up now recorded in the backlog rather than left in a transcript)
ACCEPTANCE_MATRIX: PASS (CND-1..CND-11; CND-1 asserts against pg_constraint and never against schema.ts because grepping the declaration is exactly what hid the defect; CND-3 compares pg_get_constraintdef before and after; CND-4 attempts each constraint's real violation so a mangled predicate cannot pass a catalog-only check; CND-7 required the guard to have been SEEN to fail; CND-11 forced the declared-but-absent set to be named individually, which is how the 0 was established rather than assumed)
SECURITY_AND_MIGRATION_GATE: PASS (RENAME CONSTRAINT only -- no table scan, no predicate re-validation, no DDL that rewrites rows; 0000-0024 byte-identical and the immutability guard intact; no role, grant, RLS, column, nullability, default or type change; rollback = a forward migration renaming back, no data migration; 0025 is the next monotonic tail. The switch away from DROP+ADD came from codex round-01 as a P1 on money-path tables and is the security-relevant substance of this verdict)
IMPLEMENTATION_ARTIFACTS: PASS (migration 0025 + CND tests merged at 3d75c90, squash of feat/db-check-constraint-naming-drift@59f5f19; 2x consecutive FULL-base codex clean rounds 03/04 on unmoved base 2dc9b8c with NO owner override; 2 fix rounds, 4 real findings, no region flagged 3x so no thrash; full CI list green on final HEAD -- typecheck, format:check, review:check, lint, build, db:bootstrap, test 561/561 with db 219->243; .autopilot/state/db-check-constraint-naming-drift/{design-probe.md,codex/round-0[1-4].txt,AWAIT-FOUNDER-ready-for-manual-merge.txt}; this verdict)
FIRST_IMPLEMENTATION_STEP: n/a -- IMPLEMENTED & MERGED at 3d75c90
REMAINING_BLOCKERS: none -- merged. schema.ts and pg_constraint now agree in the schema.ts->live direction for all 67 declared constraints; the live->schema.ts direction still has 6 gaps, tracked as db-undeclared-check-constraints-schema-mirror
NEXT_REVIEW_TRIGGER: n/a -- merged. Two process defects this slice exposed are NOT closed by it and need a mechanism, not a note: (1) the backlog block stayed `ready` after merge until autopilot-backlog-reconcile flagged it on 2026-07-29, repeating the 2026-07-25 stale-status incident -- the fix is running `--fix` as part of merge, not remembering to; (2) the item-(e) follow-up existed only in a session transcript for a day because autopilot-backlog.md was correctly outside the worktree's scope -- a slice needs a sanctioned way to emit a follow-up without widening its own scope
```

**Đọc verdict:** slice hoàn thành sạch — 2 vòng clean liên tiếp, không override, 24 test mới. Nhưng ba điều đáng giữ lại hơn bản thân migration. **Một:** chuỗi 27 → 47 → 40 cho thấy một con số cụ thể vẫn có thể sai theo cách mới ngay cả sau khi đã sửa phương pháp một lần; cái sửa được nó là bắt phép đo phải **phân loại**, không chỉ **đếm**. **Hai:** vế đáng sợ của khoảng cách khai-báo (guard vắng mặt) đo ra `0` — và điều đó chỉ biết được vì CND-11 bắt liệt kê từng cái thay vì hấp thụ vào một con số tổng. **Ba:** `RENAME CONSTRAINT` thay `DROP+ADD` là cải tiến do code-review gate tìm ra, không phải do design review — lần thứ hai (sau Verdict 17) gate codex bắt được thứ mà một verdict `CODE_READY` với `G5_SCOPE: PASS` đã bỏ qua trên money-path.

---

## Verdict 26 — `db-check-constraint-naming-drift`: 47/72 CHECK constraint không tồn tại dưới tên `schema.ts` khai; `CODE_READY` (2026-07-27)

> **Điều CODE_READY này cho phép:** mở worktree, register scope-gate, chạy design probe. Viết production code
> trước khi probe được owner confirm là vi phạm verdict này.
>
> **Phạm vi trong verdict này ĐO TỪ `pg_constraint`, và đó không phải hình thức — con số đầu tiên của reviewer
> sai 20.** Bản manifest đầu ghi *"27 CHECK trên 23 bảng, giới hạn ở tầng foundation"*, đếm bằng `awk` trên dòng
> `CHECK (` trong các `CREATE TABLE` của `0002`–`0008`. Catalog trên DB đã migrate tới `0024` nói: **47 tên
> tự-sinh trên 27 bảng, so với 25 đặt tên đúng — tức 47 trên tổng 72, khoảng hai phần ba mọi CHECK trong
> schema.** Và khẳng định *"auth lane `0015`–`0018` đặt tên đúng"* là **sai**:
> `auth_email_deliveries_kind_check`, `auth_email_tokens_purpose_check`,
> `auth_oauth_transactions_provider_check`, `channel_identities_platform_check`, `persons_status_check` đều
> tự-sinh. Drift là **toàn repo**, không giới hạn tầng nào.
>
> **Ghi lại thay vì lặng lẽ thay số, vì đó đúng là lỗi slice này sinh ra để sửa:** một con số đọc như dữ kiện
> vì nó cụ thể, tạo ra bằng cách đếm **khai báo** thay vì **trạng thái đã áp dụng**. Cùng cơ chế với lỗi
> `LIVE_REPO_VERIFICATION` của Verdict 25, lặp lại bởi cùng một người trong verdict cấp phép cho slice sửa nó.
> Validator chặn `CODE_READY` khi `LIVE_REPO_VERIFICATION` không `PASS` chính là thứ buộc phép đo phải xảy ra.
>
> **Phép đo còn lộ một chênh lệch chưa giải:** `schema.ts` khai **63** `check()`, catalog có **72**, và chỉ **25**
> tên khai báo tồn tại. Không phép đổi tên nào hoà giải được — 63 khai báo không phủ nổi 72 constraint. Nghĩa là
> có CHECK sống không có đối ứng trong `schema.ts`, **hoặc** có khai báo chưa từng được áp dụng, hoặc cả hai. Vế
> thứ hai nặng hơn drift tên: một guard mà người ta tin là đang enforce nhưng **không tồn tại**. Probe item (e)
> và CND-11 buộc liệt kê từng cái theo tên.
>
> **Hai bẫy còn lại.** Item (b): Postgres đặt `<table>_<column>_check` và `<table>_check`, **có hậu tố số khi
> trùng** — `sessions` có sáu tên tự-sinh gồm cả `sessions_check` trần, cái nào ứng với predicate nào phụ thuộc
> thứ tự khai báo gốc; phải khớp theo **predicate**, không viết tên theo pattern. Item (d): `0014` đã sửa đúng
> lớp lỗi này cho `players` rồi lớp lỗi quay lại — nên `CND-7` bắt chứng minh guard **đã từng fail**.

```text
REVIEW_POLICY_VERSION: 1.3
REVIEW_VERDICT: CODE_READY
REVIEWED_AT: 2026-07-27
AUTHORITY_SHA: 6ae2de6470573eadc9ef151306002a7b869dcd8b
BASE_BRANCH: main
TARGET_FILES:
  - docs/autopilot-manifests/db-check-constraint-naming-drift.json
  - .claude/commands/ap-37-db-check-constraint-naming-drift.md
SLICE: db-check-constraint-naming-drift
IN_SCOPE: one module (packages/db) — exactly ONE monotonic migration renaming auto-generated CHECK constraint names to the names schema.ts declares, for whatever set the design probe pins; plus a regression guard that makes this class of drift impossible to reintroduce silently; plus a quantified report of the 63-versus-72 declaration gap
OUT_OF_SCOPE: any predicate change — a rename that also alters what a constraint accepts is a different slice and a money-path risk; ADDING a missing constraint that schema.ts declares but the database lacks (report it, do not create it); column, nullability, default or type changes; RLS, role or grant changes; edits to applied migrations 0000-0024; sessions_public_capacity_chk from 0024, already correctly named; anything outside packages/db; regenerating schema.ts from the database — its declared names are the TARGET
G1_DECISION: PASS — no owner decision is made or re-opened. 0014 settled the shape (DROP IF EXISTS + ADD CONSTRAINT under the declared name) and documented the class; this applies that settled fix where it was never applied. The open question — how far the sweep goes, now that the extent is 47 rather than the 27 first claimed — is routed to the mandatory design-probe STOP gate
G2_SPEC: PASS — authority is merged code and the live catalog, not prose: 0014:44-50 and :78-80 for the precedent, schema.ts's check() declarations for target names, pg_constraint for ground truth
G3_DEPENDENCY: PASS — depends_on empty. dep_checks verified on disk at 6ae2de6: players_status_chk in 0014, sessions_public_capacity_chk in 0024. Both name things this slice actually consumes — the precedent it mirrors, and the constraint it must not touch
G4_TEST: PASS — CND-1..CND-11 authored before code. Four are anti-regression rather than coverage: CND-1 asserts against pg_constraint and never against schema.ts, because grepping the declaration is exactly what hid this; CND-4 attempts each constraint's real violation, so a predicate mangled in transcription cannot pass a catalog-only check; CND-7 requires the guard to have been SEEN to fail; CND-11 forces the declared-but-absent constraints to be named individually rather than absorbed into a rename count
G5_SCOPE: PASS — 4 files, one module, one monotonic migration. Wide in rows touched (up to 27 tables) but narrow in semantics (zero predicate change), and CND-3 pins that distinction by comparing pg_get_constraintdef before and after
G6_EXTERNAL: PASS with a named money-path note — 13 of the 47 sit on charges, bank_transactions, payment_allocations and bank_accounts. No predicate changes, and DROP+ADD is atomic inside migrate.ts's per-file transaction, which probe item (c) requires be VERIFIED rather than assumed. Any money-path predicate mismatch between live and schema.ts is a HALT
HARD_DEPENDENCIES: none
PRIOR_SLICES: db-public-visibility-capacity-check (0024) — surfaced the defect; not a code dependency
OPEN_QUESTIONS_IN_SCOPE: 0
ENABLEMENT_ONLY_GATES: none
LIVE_REPO_VERIFICATION: PASS (measured from pg_constraint at 81b4fe8 against a database migrated to 0024, not from source text: 47 auto-named CHECK constraints across 27 tables, 25 declared-style, 72 total in schema public. Money-path subset confirmed by name — bank_accounts 2, bank_transactions 4, charges 4, payment_allocations 3. sessions carries six auto-named including a bare sessions_check, while sessions_public_capacity_chk from 0024 is correctly named and appears in the declared 25. schema.ts declares 63 check() constraints against 72 live, a gap this verdict does NOT resolve and routes to probe item (e). An earlier revision of this verdict claimed 27-across-23 from static file analysis; that count was wrong by twenty and its 'confined to the foundation layer' framing was false — recorded here because the method, not just the number, is what this slice exists to correct)
CONTRACT_MATRIX: PASS
CLOSURE_MATRIX: PASS (12/12)
ACCEPTANCE_MATRIX: PASS (CND-1..CND-11)
SECURITY_AND_MIGRATION_GATE: PASS — expand-only in effect, one monotonic migration, 0000-0024 byte-identical, no role, grant, RLS, column or type change. Every rename is an identity change with the predicate preserved, verified in both directions by CND-3 (catalog) and CND-4 (behaviour). The declared-but-absent constraints found by CND-11 are REPORTED, never created here — adding a guard someone believed already existed is a behaviour change wearing a cleanup's clothes
IMPLEMENTATION_ARTIFACTS: PASS (manifest committed and pushed at 6ae2de6, amended with the catalog measurement in the commit carrying this verdict; the AP-37 launcher lands with this verdict as an execution aid derived from the manifest, not independent authority)
FIRST_IMPLEMENTATION_STEP: open a worktree at .autopilot/worktrees/db-check-constraint-naming-drift from the current origin/main tip, register via scope-gate, run the full CI list as the green baseline, re-verify the migration tail is 0024, then write design-probe.md — re-running the catalog query and reporting your own number before choosing a boundary — and STOP for founder confirmation
REMAINING_BLOCKERS: none
NEXT_REVIEW_TRIGGER: n/a — CODE_READY. Re-review required if another slice claims 0025 first, or if the probe's catalog query returns a materially different extent from the 47 measured here
```

---

## Verdict 25 — `db-public-visibility-capacity-check`: bỏ invalid state public+unlimited tại nguồn; `CODE_READY` (2026-07-27) → **IMPLEMENTED & MERGED `c100937`** (2026-07-27)

> **✅ IMPLEMENTED & MERGED 2026-07-27 — `main@c100937`** (squash của
> `feat/db-public-visibility-capacity-check@acc5094`, 4 file +359/−7). `0024` thêm
> `sessions_public_capacity_chk`. Tail `0023`→`0024` (25 file). db suite 212→219 (+7 PVC).
>
> **❌ ĐÍNH CHÍNH LỖI CỦA REVIEWER TRONG CHÍNH VERDICT NÀY — đọc trước khi tin bất kỳ dòng nào bên dưới.**
> `LIVE_REPO_VERIFICATION` khẳng định `sessions_slots_chk` và `sessions_vis_chk` là sự thật *"measured at
> 1ffb6a5"*. **Sai.** Thứ được đo là **văn bản nguồn `schema.ts`**, không phải `pg_constraint`. Hai tên đó
> **không tồn tại trong DB đã migrate**: `0002:87-99` khai CHECK **inline không tên**, nên Postgres tự đặt
> `sessions_visibility_check`, `sessions_slots_max_check`, `sessions_price_amount_check`,
> `sessions_join_policy_check`, `sessions_status_check`, `sessions_check`. Cùng lớp bug mà `0014:44,78-80` ghi
> là *đã tìm và đã sửa cho `players`* — chưa bao giờ sửa cho `sessions`. Phát hiện bởi PVC-3 khi slice viết test;
> test ship ra assert theo **tên thật**, không theo tên aspirational của `schema.ts`.
>
> **`dep_checks` không cứu được, và đây là giới hạn cấu trúc chứ không phải sơ suất:** `scope-gate` giải
> `dep_checks` bằng `git show main:<file>` + grep — tức đọc **khai báo**. Với một đối tượng DB, cơ chế đó
> **về nguyên tắc không phân biệt được ĐÃ KHAI BÁO với ĐÃ ÁP DỤNG**. Manifest `_decision_contract` vì thế cũng
> hứa "hai CHECK sẵn có không bị thay thế" về những đối tượng không tồn tại dưới tên ấy.
>
> **Vì sao đáng ghi thay vì chỉ sửa:** hai tin nhắn trước khi verdict này được viết, tôi dặn probe của chính
> slice này rằng *"nếu đếm bằng SELECT thì có thể là zero giả"* — rồi phạm đúng phiên bản tương đương trong
> verdict cấp phép cho probe đó. Đọc một khai báo rồi gọi đó là phép đo. Luật rút ra, đã ghi vào memory: với
> đối tượng DB, `schema.ts` là **khai báo**, chỉ `pg_constraint`/`pg_proc` mới là **bằng chứng**.
>
> **Probe trả lời item (a) bằng nguyên nhân, không bằng phép đếm** — và đó là lý do kết luận đứng vững. Nó không
> chỉ đếm 0 row vi phạm mà chứng minh **vì sao** phải là 0: `SessionService`, `evaluateJoinRestriction` và
> projector đều còn là stub, nên **chưa từng tồn tại write path** tạo được vi phạm. Quan trọng vì `0019:78-85`
> đã ghi sẵn (từ codex round-02 của chính nó) rằng một `SELECT` probe bị RLS lọc về 0 dưới migration role
> `NOBYPASSRLS` — tức phép đếm đơn thuần có thể là zero giả.
>
> **Hai P1 của codex là cùng một cái bẫy ở hai chỗ: khẳng định đúng-nhìn-từ-vị-trí-sai.** Vòng 1 — chính câu
> `SELECT` khắc phục *bên trong* halt cũng trả 0 row dưới role `NOBYPASSRLS` (`sessions` có FORCE RLS), tức
> thông điệp sửa lỗi tự nó gây hiểu nhầm; sửa thành yêu cầu requery bằng role bypass RLS. Vòng 2 — replay
> migration của PVC-6 chạm `0022`/`0023` (đụng `job_definer`) mà không giữ `withJobDefinerLock`, đua với
> `JCL-2`/`JCL-3` vốn **cố ý phá** role cluster-global đó dưới cùng cái khoá. Vòng 3 và 4 clean cùng HEAD.
>
> **Một khác biệt thực nghiệm so với `0019` đã được xử lý:** `VALIDATE` của một CHECK **không** cho row detail
> như FK violation, nên named halt trao cho owner một **câu truy vấn khắc phục** thay vì khoá vi phạm.
>
> **Bằng chứng:** 539/539 (validator 13 · core 132 · db 219 · web 146 · bot 29). Con số này cũng **chốt luôn
> tranh cãi 519 vs 623**: 519 là workspace đúng tại `fca314e`, 532 là 519 + validator, và "623" của report slice
> 2b đơn giản là sai.

> **Điều CODE_READY này cho phép:** mở worktree, register scope-gate, chạy design probe. `design_probe_required:
> true` và **item (a) là lý do slice tồn tại**, không phải thủ tục. Viết production code trước khi probe được
> owner confirm là vi phạm verdict này.
>
> **Bẫy của item (a), nói thẳng vì nó trông giống sự cẩn thận:** phản xạ là `ADD CONSTRAINT ... NOT VALID` rồi
> `VALIDATE CONSTRAINT` ngay sau, vì cặp đó đọc như idiom expand-only chuẩn. **Ở đây thì không.** `NOT VALID` bỏ
> qua row cũ; `VALIDATE` sau đó quét chúng và **FAIL** nếu có row vi phạm. Hai câu lệnh trong một migration vì
> vậy có **đúng cùng failure mode** với việc thêm thẳng constraint — mà lại *trông* cẩn thận hơn. Probe phải ĐO
> số row vi phạm trước, rồi chốt một hình dạng và **phát biểu được failure mode của nó bằng một câu**.
>
> **Vì sao slice này đáng P1 chứ không phải dọn dẹp:** invalid state `public` + `slots_max IS NULL` **vô hình
> với sửa chữa theo sự kiện**. Marketplace edge #15 bỏ qua row đó và xoá projection — nhưng chỉ khi projector
> **đánh giá** session. Một writer bypass lật session public đã-projected từ `slots_max` hữu hạn sang NULL
> **không phát event nào**, projector không bao giờ quay lại, và projection cũ-nhưng-nay-invalid **vẫn hiển thị
> công khai**. Unit test #26 đặt row vào batch bằng tay nên chỉ chứng minh hành-vi-khi-tới-được. Verdict 20 ghi
> đây là gate `ENABLEMENT_ONLY` chặn projector public.
>
> **Xuất xứ:** đây là fix-candidate (c) của `job-infra-public-projection-reconciliation`, mà chính task cha yêu
> cầu **đánh giá TRƯỚC** vì rẻ nhất và fail-closed nhất — nó bỏ invalid state tại nguồn, có thể khiến candidate
> (a) và (b) thành không cần thiết chứ không phải chỉ hoãn. Slice này KHÔNG được kết luận thay cho task cha;
> probe item (d) buộc nêu rõ cái gì SỐNG SÓT qua CHECK.

```text
REVIEW_POLICY_VERSION: 1.3
REVIEW_VERDICT: CODE_READY
REVIEWED_AT: 2026-07-27
AUTHORITY_SHA: 1ffb6a52760f2c8e75a1446468ad612ef0afd018
BASE_BRANCH: main
TARGET_FILES:
  - docs/autopilot-manifests/db-public-visibility-capacity-check.json
  - .claude/commands/ap-36-db-public-visibility-capacity-check.md
SLICE: db-public-visibility-capacity-check
IN_SCOPE: one module (packages/db) — exactly ONE monotonic migration after the live tail adding a CHECK forbidding visibility='public' with slots_max IS NULL, in whatever add-then-validate shape the design probe pins for existing data; the schema.ts mirror alongside the other sessions_*_chk constraints; real-role tests proving the constraint rejects the invalid state and accepts every valid combination
OUT_OF_SCOPE: any projector, TypeScript runtime or apps/bot file — this slice runs in PARALLEL with job-schedule-outbox-dispatch and any shared file collides; public_sessions shape changes, specifically the eight missing DD-41 discovery fields and the stale skillLevel column (real drift, separate slice); narrowing slots_max (stays nullable — unlimited remains valid for non-public); weakening or replacing sessions_vis_chk or sessions_slots_chk; edits to applied migrations 0000-0023; RLS, role or grant changes; deciding candidate (a) durable invalidation event or (b) periodic reconciliation
G1_DECISION: PASS — the predicate is not invented here. feature_session_management_tech.md:120 already names it verbatim and records its status as a hardening candidate awaiting a slice; PRD E#7 is the product authority behind it. The one genuinely open mechanism question (what to do about existing violating rows) is routed to the mandatory design-probe STOP gate, which v0.6.1 §0.1 establishes as the closure mechanism for this class
G2_SPEC: PASS — reviewed spec authority rather than a fabricated one: feature_session_management_tech.md §2 (the predicate + its candidate status) and :386 (the choke-point that fail-closes on the same state today), plus feature_marketplace_discovery_tech.md edge #15 for why event-driven repair does not reach it
G3_DEPENDENCY: PASS — no unmerged dependency; depends_on is empty. dep_checks verified on disk at 1ffb6a5: sessions_vis_chk and sessions_slots_chk both present in packages/db/schema.ts. An earlier draft also listed ack_outbox_event from 0023; that entry was REMOVED before authorization because this slice consumes nothing from 0023 — dep_checks exist to catch upstream interface drift, so an entry on an unused symbol fires on unrelated edits, and a check that cries wolf is ignored exactly when it is right
G4_TEST: PASS — PVC-1..PVC-8 authored before code with exact expected results. Two are anti-regression rather than coverage: PVC-2 requires private-with-NULL to still succeed, which is what a too-broad constraint breaks and what a careless predicate would silently forbid; PVC-6 requires the probe's chosen validation shape to be exercised with its stated failure mode, so a migration that would fail on real data cannot pass its own suite on an empty table
G5_SCOPE: PASS — 5 files, one module, exactly one monotonic migration; inside budget. Same shape as the 0019/0020/0021 integrity migrations this repo has run cleanly
G6_EXTERNAL: PASS — no PII, money, provider or legal gate. It TIGHTENS a public-exposure invariant rather than relaxing one, and adds no new surface
HARD_DEPENDENCIES: none
PRIOR_SLICES: none — depends_on is empty by design; the parent backlog item job-infra-public-projection-reconciliation is a tracking item, not a code dependency
OPEN_QUESTIONS_IN_SCOPE: 0
ENABLEMENT_ONLY_GATES: none for this slice. Note it is itself the evaluation of an ENABLEMENT_ONLY gate recorded on Verdict 20 against the future public projector; landing this CHECK does NOT by itself clear that gate, and probe item (d) exists to make the residue explicit
LIVE_REPO_VERIFICATION: PASS (measured at 1ffb6a5: migration tail is 0023 so 0024 is free; sessions.slots_max is nullable at schema.ts:589 and sessions.visibility is text NOT NULL DEFAULT 'private' at :590; sessions_slots_chk enforces slots_max IS NULL OR slots_max > 0 at :601 and sessions_vis_chk enforces visibility IN ('private','public') at :602, so the naming convention and the surrounding constraints are as this manifest states; feature_session_management_tech.md:120 still records the predicate as a hardening candidate belonging to no slice)
CONTRACT_MATRIX: PASS
CLOSURE_MATRIX: PASS (12/12)
ACCEPTANCE_MATRIX: PASS (PVC-1..PVC-8)
SECURITY_AND_MIGRATION_GATE: PASS — expand-only, one monotonic migration, 0000-0023 byte-identical, no role/attribute change, no RLS change, no column narrowed. The security-relevant property is strengthened: a state that can leak a stale public projection becomes unrepresentable rather than merely rejected by one service path. The one risk the gate does NOT wave through is operational, and it is why the probe is mandatory: an ADD+VALIDATE pair that fails on populated data is a failed migration, not a rejected write
IMPLEMENTATION_ARTIFACTS: PASS (manifest committed and pushed at 1ffb6a5; the AP-36 launcher lands with this verdict as an execution aid derived from the manifest, not independent authority). The manifest's _problem/_decision_contract/_scope_in/_scope_out/_design_probe/_acceptance/_scope_exception/_evidence_rules is the executable plan required by gate §B4
FIRST_IMPLEMENTATION_STEP: open a worktree at .autopilot/worktrees/db-public-visibility-capacity-check from the current origin/main tip, register the manifest via scope-gate, run the full CI list as the green baseline, re-verify the live migration tail, then write design-probe.md covering all four items — measuring violating rows BEFORE choosing a validation shape — and STOP for founder confirmation before any production edit
REMAINING_BLOCKERS: none
NEXT_REVIEW_TRIGGER: n/a — CODE_READY; next event is the design probe, then the coding slice. Re-review is required if another slice claims the 0024 number first, or if feature_session_management_tech.md:120 changes status
```

---

## Verdict 24 — `job-schedule-outbox-dispatch`, job-infra slice 3a; `CODE_READY` (2026-07-27) → **IMPLEMENTED & MERGED `a03d2d6`** (2026-07-27)

> **✅ IMPLEMENTED & MERGED 2026-07-27 — `main@a03d2d6`** (squash của `feat/job-schedule-outbox-dispatch@31bc8fa`).
> Cron `* * * * *` cho `OUTBOX_DISPATCH_QUEUE` sau cờ `OUTBOX_DISPATCH_SCHEDULE_ENABLED` mặc định OFF, cộng
> fence preflight cho `__pgboss__send-it`. Không migration; `dispatcher.ts` và `packages/db` zero diff.
>
> **⚠️ CỔNG `--test` ĐÃ BỊ VÔ HIỆU HOÁ BỞI KHỐI LỆNH CỦA REVIEWER — ghi lại vì đây là quy trình hỏng, không
> phải chi tiết vụn.** `ap-merge.sh --test` chạy suite sau commit và trước push, có `set -euo pipefail`, nên
> test đỏ phải chặn push. Nhưng reviewer đặt `git push origin main` trên **dòng riêng** sau lệnh script trong
> khối paste; script exit non-zero ở bước test, dòng kế tiếp vẫn chạy. Suite lúc đó **đỏ** (`apps/bot` không
> resolve được `@plexco/db`). Đây **đúng là sự cố `eba1c27`** mà `ap-merge.sh` được viết ra để chặn — header của
> script ghi nguyên văn *"Các bước để trên dòng RIÊNG → merge abort nhưng `git commit` ngay sau vẫn chạy"* — và
> reviewer tái tạo nó ngay trong lệnh gọi chính script đó.
>
> **Kết cục lành, nhưng lành do may.** Sau `pnpm install` suite xanh: `apps/bot` **40/40**, 4 test file. Nguyên
> nhân là `node_modules` chưa link lại workspace sau khi devDependency `@plexco/db` land ở `fca314e`, không phải
> lỗi code. **Nhưng xác nhận sau khi đã push không phải là gate.** Luật rút ra: mọi bước sau `ap-merge.sh` phải
> nối bằng `&&`, hoặc dùng `--push` để bước push nằm TRONG `set -e` của script.
>
> **Branch đi sau `main` 4 commit khi merge.** Con số `543` trong READY report đo trên base chưa có `0024` — vì
> thế db ghi 212 thay vì 219. Không xung đột file thật (`apps/bot/*` vs `packages/db/*`), và không test
> `apps/bot` nào chạm cột `visibility` nên CHECK mới không thể phá chúng — nhưng trạng thái hợp nhất chỉ được đo
> SAU khi push.
>
> **Hai P1 vòng 3 bị dismiss, và lý do là THỨ TỰ, không phải tiện.** Codex đúng: cron một phút không đạt NFR-1c
> (`TDD.md:82` — sync-lag p95 ≤ 3s), và 25 row/batch × 1 lần/phút để backlog tăng không giới hạn trên 25
> event/phút. Không cái nào sửa được ở đây: DD-07 đã chốt `LISTEN/NOTIFY`, nên trigger sub-minute phải là NOTIFY
> phát từ transaction của **producer** — mà producer là `DEFERRED_OUT_OF_SCOPE` theo quyết định owner 26/07, nên
> slice này **không có chỗ nào để gắn nó vào**. Batch size và drain policy thuộc consumer theo `§4.3`, cùng lý
> do đã giữ retry/backoff ra khỏi `dispatcher.ts`.
>
> **Hoãn được làm thành CẤU TRÚC, không phải tài liệu.** Cờ đã gate việc bật; điều kiện lật của nó nay nêu cả
> hai lý do — off cho tới khi có projector thật **VÀ** cho tới khi có sub-minute trigger + drain policy, vì
> NFR-1c không thể đạt nếu thiếu. Một slice ship đường dẫn không đạt nổi NFR đã tuyên bố thì phải nói điều đó
> trong **cổng bật nó**, không phải trong comment cạnh nó.
>
> **Reviewer phải sửa chính chỉ thị của mình giữa chừng.** Câu "đừng chạy round 4 chỉ để xác nhận lại việc
> dismiss" bị đọc thành cấm round 4 nói chung — nhưng HEAD đã đổi hai lần từ round 3 (fix P2, docs
> flip-condition), nên round 4 review **commit chưa ai xem**, không phải xử lại việc đã phân xử. Owner override
> bị từ chối: tiền lệ cho nó là sau **12 vòng** không hội tụ, dùng ở vòng 3 để bỏ qua việc thường sẽ làm hỏng
> chính cơ chế ngoại lệ đó.
>
> **JSO-1 và JSO-6 không pass rỗng** — điều kiện reviewer đặt khi duyệt cờ. JSO-1 gọi helper trực tiếp, độc lập
> `process.env`; JSO-6 enqueue qua đúng `__pgboss__send-it` mà `timekeeper.cron()` dùng, không phải lối tắt vào
> queue thật, và chạy trọn `claimed → prepared → acked`.

> **Điều CODE_READY này cho phép:** mở worktree, register scope-gate, chạy design probe. `design_probe_required:
> true`, năm item, và **item (b) là cái bản sao máy móc sẽ làm sai**. Viết production code trước khi probe được
> owner confirm là vi phạm verdict này.
>
> **Slice 2b để lại một handler đăng ký nhưng không bao giờ được gọi.** `boss.work(OUTBOX_DISPATCH_QUEUE)` có,
> mà zero `boss.schedule()`, zero `pg_cron` (`0000` chỉ cài `pgcrypto`), zero `setInterval` — đo tại `750ca0d`,
> chỉ còn hai comment ước vọng. Đó là phần dễ.
>
> **Phần khó, và lý do P1: đường cron của pg-boss CHẾT CÂM dưới seat `app_worker`.** Đọc source pg-boss 10.4.2
> chứ không đọc README: `timekeeper.js:44-69` — `start()` gọi `manager.createQueue('__pgboss__send-it')` bọc
> trong **try/catch RỖNG** ở `:54-56`; `app_worker` không có `CREATE` nên lỗi bị nuốt. Và `cron()` ở `:141-151`
> **không** insert vào queue đích mà insert vào `__pgboss__send-it`, worker của queue đó mới fan ra. Mà
> `queues.ts:18` không liệt kê tên đó, nên `preflight.ts:147-195` không assert partition của nó. Hôm nay nó tồn
> tại **do tình cờ**: `provision-queue.ts:24` gọi `boss.start()` dưới migration role với default `schedule:true`
> (`attorney.js:159`). Không gì pin chuỗi đó. Provisioning chạy với `schedule:false` một lần là cron chết mà
> không có lỗi ở đâu cả.
>
> **Bẫy item (b):** nước đi hiển nhiên là thêm `'__pgboss__send-it'` vào `QUEUES` để `assertQueuesProvisioned`
> sẵn có bọc nó. Nhưng `QUEUES` **cũng** điều khiển thứ provisioning **TẠO RA**, trong khi pg-boss tự tạo queue
> đó. Hai vai trò có thể xung đột. Probe phải đo, và nếu xung đột thì đề xuất tách danh sách chứ không nạp
> chồng vai trò cho một mảng vì đổi một dòng trông gọn hơn.

```text
REVIEW_POLICY_VERSION: 1.3
REVIEW_VERDICT: CODE_READY
REVIEWED_AT: 2026-07-27
AUTHORITY_SHA: 1ffb6a52760f2c8e75a1446468ad612ef0afd018
BASE_BRANCH: main
TARGET_FILES:
  - docs/autopilot-manifests/job-schedule-outbox-dispatch.json
  - .claude/commands/ap-35-job-schedule-outbox-dispatch.md
SLICE: job-schedule-outbox-dispatch
IN_SCOPE: one module (apps/bot), TypeScript only — register a schedule for OUTBOX_DISPATCH_QUEUE with a code-owned cadence pinned at the design probe; close the __pgboss__send-it fence hole so a broken cron path fails LOUDLY at preflight instead of silently at runtime; whatever preflight assertion the probe pins for the scheduler's own dependencies including the leader-election write on pgboss.version; tests for both against real PostgreSQL with a real app_worker seat
OUT_OF_SCOPE: ANY new migration — a hard boundary, not a preference, for two independent reasons: everything needed already exists in 0022/0023, and a migration pulls in the `schema` token and collides with the parallel db-public-visibility-capacity-check slice; list_due_tenant_jobs (named at TDD:494, absent from disk) deferred to its own slice; any real projector, and any edit to dispatcher.ts including REQUIRED_PROJECTORS and productionStubDeliver (slice 4); provision-queue.ts grant block; ANY least-privilege, excess-privilege, ownership or role-attribute assertion in preflight (cut by Verdict 22 — re-adding is an immediate HALT); enabling this schedule in an environment carrying real traffic before slice 4 lands
G1_DECISION: PASS — DD-90 Q6 (preflight fail-closed before boss.start(), asserting PRESENCE of required grants) and DD-89 Q2 (pg-boss DDL authority stays in provision-queue.ts under the migration role) are owner-final and bind unchanged. No DD covers cron registration itself, which is why the cadence, the fence mechanism and the enablement posture are all routed to the design-probe STOP gate rather than decided here
G2_SPEC: PASS — infra slice with equivalent reviewed technical authority rather than a fabricated Product spec: the DB contract is merged code (0022 + 0023), the runtime contract is slice 2b (fca314e) plus DD-90 Q6, and the pg-boss behaviour is READ FROM pg-boss's own source at a pinned version rather than from its documentation
G3_DEPENDENCY: PASS — job-runtime-dispatcher merged at fca314e; no unmerged dependency. dep_checks verified on disk at 1ffb6a5: runDispatchCycle in dispatcher.ts, OUTBOX_DISPATCH_QUEUE in queues.ts, assertQueuesProvisioned in preflight.ts, ack_outbox_event in 0023 — all four resolve on main
G4_TEST: PASS — JSO-1..JSO-9 authored before code with exact expected results. Three are anti-regression rather than coverage: JSO-2 requires preflight to FAIL and NAME the missing __pgboss__send-it partition, which is the entire point of the slice since pg-boss swallows its own error; JSO-4 greps the shipped preflight for the least-privilege class Verdict 22 cut, so six rounds of thrash cannot creep back; JSO-6 requires a scheduled send to drive runDispatchCycle end to end, so a test that only proves a schedule row exists does not satisfy it
G5_SCOPE: PASS — 6 files, one module, no migration; inside budget. Deliberately narrower than the parent backlog item job-scheduler-cron-registration, which bundled list_due_tenant_jobs and a cron audit envelope; that bundle would have pulled packages/db in and made parallel execution impossible
G6_EXTERNAL: PASS — no PII, money, provider, legal or evidence gate. It stays code-dark in effect: with no producer inserting outbox_events, a running schedule claims nothing
HARD_DEPENDENCIES: job-runtime-dispatcher = MERGED (main@fca314e; probe apps/bot/src/worker.ts::boss.work verified on origin/main)
PRIOR_SLICES: db-job-claim-lease-core (0022) · db-outbox-ack-marker (0023) · job-runtime-dispatcher (2b)
OPEN_QUESTIONS_IN_SCOPE: 0
ENABLEMENT_ONLY_GATES: enabling the schedule against real traffic is gated on slice 4's real projector — 2b's productionStubDeliver DLQs every delivery, so a producer plus this schedule without slice 4 means every event DLQs. Probe item (e) pins whether the schedule ships enabled or behind a flag defaulting off. This gate does NOT block coding or merging this slice
LIVE_REPO_VERIFICATION: PASS (measured at 1ffb6a5, and pg-boss facts read from node_modules source rather than documentation: worker.ts calls boss.work(OUTBOX_DISPATCH_QUEUE) with no boss.schedule() anywhere in the repo; QUEUES is [OUTBOX_DISPATCH_QUEUE]; preflight's assertQueuesProvisioned iterates only QUEUES so __pgboss__send-it has no partition assertion; dispatcher.ts REQUIRED_PROJECTORS has exactly one entry; pg-boss resolves to 10.4.2 where timekeeper.js:54-56 wraps createQueue in an empty try/catch, cron() at :141-151 routes through __pgboss__send-it, and attorney.js:159 defaults schedule to true)
CONTRACT_MATRIX: PASS
CLOSURE_MATRIX: PASS (12/12)
ACCEPTANCE_MATRIX: PASS (JSO-1..JSO-9)
SECURITY_AND_MIGRATION_GATE: PASS — no migration, no grant change, no RLS change, no new role. app_worker gains no privilege: the fence this slice adds asserts an object EXISTS, and if it does not the remedy is to provision it under the migration role per DD-89 Q2, never to grant CREATE. The DD-90 Q6 boundary is extended, not weakened, and JSO-4 pins that the least-privilege class stays out
IMPLEMENTATION_ARTIFACTS: PASS (manifest committed and pushed at 1ffb6a5; the AP-35 launcher lands with this verdict as an execution aid derived from the manifest, not independent authority). The manifest's _problem/_decision_contract/_scope_in/_scope_out/_design_probe/_acceptance/_scope_exception/_evidence_rules is the executable plan required by gate §B4
FIRST_IMPLEMENTATION_STEP: open a worktree at .autopilot/worktrees/job-schedule-outbox-dispatch from the current origin/main tip, register the manifest via scope-gate, run the full CI list as the green baseline, re-verify pg-boss's resolved version and the two source facts this slice turns on, then write design-probe.md covering all five items and STOP for founder confirmation before any production edit
REMAINING_BLOCKERS: none
NEXT_REVIEW_TRIGGER: n/a — CODE_READY; next event is the design probe, then the coding slice. Re-review is required if pg-boss's resolved version moves off 10.4.2, since both source facts in LIVE_REPO_VERIFICATION could change with it
```

---

## Verdict 23 — `db-outbox-ack-marker`, job-infra slice 2a: close the outbox starvation loop 0022 flagged against itself; `CODE_READY` (2026-07-26) → **IMPLEMENTED & MERGED `76e1f7b`** (2026-07-27)

> **✅ IMPLEMENTED & MERGED 2026-07-27 — `main@76e1f7b`** (squash của `feat/db-outbox-ack-marker@0aaf984`).
> Verdict `CODE_READY` bên dưới giữ nguyên làm bằng chứng lịch sử của lần authorize; nó **không** còn là
> authority cho công việc mới.
>
> **Hai quyết định owner lấy tại design probe, trước khi có dòng code nào — và cả hai đều lệch khỏi đáp án tiện:**
>
> 1. **Fan-out completeness là cấu trúc, không phải comment.** `ack_outbox_event` nhận
>    `p_required_projectors text[]` và kiểm tra tồn tại một hàng `projector_deliveries` cho **mọi** tên trước khi
>    chịu ack, raise nếu thiếu. Chọn cách này thay vì ghi yêu cầu vào comment chính vì hình dạng comment **đã hỏng
>    một lần trong tuần này**: comment của `0022` bị bỏ sót khi author manifest 2b. Caller quên fan-out giờ nhận
>    exception, không phải một ack sớm âm thầm. Mảng NULL raise chứ không coi là rỗng; tên trùng được xử lý.
> 2. **Chặn stale-ack bằng danh tính, không bằng thời gian.** `outbox_events` thêm `claim_token uuid`, và
>    `claim_outbox_batch` RETURNS TABLE mọc thêm cột đó để ack đòi khớp chính xác. So sánh lease-expiry sẽ để hở
>    cửa sổ một worker zombie ack đúng event mà claimant thứ hai đang xử lý dở — vô hại khi ack còn per-event và
>    idempotent, nhưng là mất đúng đắn thật sự khi ack bắt đầu khẳng định fan-out completeness. Đổi chữ ký lấy
>    **ngay bây giờ** là có chủ đích: `claim_outbox_batch` hiện có **zero call site TypeScript**, và caller tương
>    lai duy nhất — slice 2b — chưa tồn tại; đây là thời điểm rẻ nhất trong đời dự án để đổi.
>
> Hợp đồng shape hai trạng thái thành bộ ba: `claimed_at`, `lease_expires_at`, `claim_token` **cùng NULL**
> (available) hoặc **cùng NOT NULL** (leased), với `acked_at` là marker terminal. Cả hai CHECK cũ được **mở rộng
> chứ không thay thế**. Expand-only; `0000`–`0022` byte-identical.
>
> **Review:** 5 vòng codex; vòng 4 và 5 đều FULL-base clean trên cùng HEAD, thoả gate P1 `2x_clean`. Hai vòng fix
> đều là **cùng một lớp lỗi đã biết** chứ không phải defect mới: vòng 1 bắt `claim_outbox_batch` đóng dấu lease từ
> `now()` bị đóng băng theo transaction (bug có sẵn từ `0022`, chỉ lộ ra khi liveness check mới soi vào); vòng 2
> bắt bản fix bỏ sót `acked_at` và cả hai audit insert. Cùng pattern `clock_timestamp()`-vs-`now()` mà `0022`
> round-07 đã ghi lại — đủ hai lần để coi là **lớp lỗi lặp của module này**, không phải tai nạn.
>
> **Bằng chứng:** real-PostgreSQL 493/493 (db 201→212, +11 từ OAM-1..OAM-13); `typecheck`, `format:check`,
> `review:check`, `lint`, `build` xanh; migration-count assertion tăng ở **cả hai** chỗ.
>
> **Hệ quả downstream:** slice 2b `job-runtime-dispatcher` được gỡ blocker cùng ngày. Nhưng chữ ký
> `claim_outbox_batch` đã đổi (thêm cột `claim_token`), nên `LIVE_REPO_VERIFICATION` của Verdict 22 trở nên stale
> ngay khi `0023` merge — Verdict 22 phải re-pin, không được đọc nguyên trạng.

> **Điều CODE_READY này cho phép:** mở worktree, register scope-gate, chạy design probe. `design_probe_required:
> true`, và item (b) của probe là **lý do slice tồn tại**, không phải thủ tục: một outbox event fan-out được cho
> nhiều projector, `job_prepare_projector_delivery` là per-`(event, projector)` — vậy event acked khi projector
> **đầu tiên** prepare, hay khi **mọi** projector đã prepare? Ack ở lần đầu **đúng hôm nay** vì chỉ tồn tại một
> projector placeholder, và **sai âm thầm** ngay khi có projector thứ hai. Hình dạng hiện tại che mất khác biệt,
> nên đáp án tiện là bẫy. Viết production code trước khi probe được owner confirm là vi phạm verdict này.
>
> **Xuất xứ:** tách khỏi `job-runtime-dispatcher` sau design probe của AP-33 (2026-07-26). `0022:166-181` tự ghi
> `HARD BLOCKING REQUIREMENT FOR job-runtime-dispatcher (slice 2/4)` yêu cầu cơ chế ack, trong khi manifest 2b
> ghi `NO new migration` — mâu thuẫn do người author 2b đọc chữ ký hàm và dòng GRANT của `0022` mà không đọc
> comment. Verdict 22 đã hạ xuống `NOT_CODE_READY` và ghi lại đúng nguyên nhân đó.

```text
REVIEW_POLICY_VERSION: 1.3
REVIEW_VERDICT: CODE_READY
REVIEWED_AT: 2026-07-26
AUTHORITY_SHA: 28d0c3a8be7fe8e3a57558e02ef24a237a14e8e8
BASE_BRANCH: main
TARGET_FILES:
  - docs/autopilot-manifests/db-outbox-ack-marker.json
SLICE: db-outbox-ack-marker
IN_SCOPE: one module (packages/db) — exactly ONE monotonic migration after the live tail adding a completion/ack mechanism to outbox_events, updating claim_outbox_batch so BOTH its reclaim pass and its claim pass skip acked rows, keeping the partial indexes selective so acked rows stop accumulating in idx_outbox_expired_lease, and a narrow SECURITY DEFINER ack function owned by job_definer with EXECUTE granted to app_worker only; plus the schema.ts mirror, migration-count assertions and real-role tests
OUT_OF_SCOPE: worker, handler, queue, cron, producer or projector wiring (slice 2b); any change to claim ordering (ORDER BY created_at is the sync-engine contract, DD-89 Q3); weakening or removing outbox_events_lease_shape_chk or outbox_events_producer_lease_boundary_chk; edits to applied migrations 0000-0022; new roles or RUNTIME_ROLES changes; job_audit_events retention or cleanup; surface_refs; any direct DML grant on outbox_events to a runtime role
G1_DECISION: PASS — the requirement is merged reviewed code, not an opinion: 0022:166-181 states it by name, and DD-89/DD-90 bind the surrounding privilege and audit contract. The one genuinely open mechanism question (ack granularity) is routed to the mandatory design-probe STOP gate, which v0.6.1 §0.1 establishes as the closure mechanism for this class
G2_SPEC: PASS — infra slice with equivalent reviewed technical authority rather than a fabricated Product spec: 0022 itself plus docs/autopilot-db-job-claim-lease-core.md §4.2/§4.3
G3_DEPENDENCY: PASS — db-job-claim-lease-core merged at 34429fc; no unmerged dependency. dep_checks verified on disk at 28d0c3a: claim_outbox_batch, outbox_events_lease_shape_chk and idx_outbox_expired_lease all present in 0022
G4_TEST: PASS — OAM-1..OAM-10 authored before code with exact expected results. OAM-2 is the row this slice exists for and the one a passing-but-useless implementation would fail: older acked-and-expired events must not consume the batch ahead of a newer unacked event. OAM-4 pins that job_audit_events stops growing, OAM-6 requires proving both CHECKs still reject their original violations by attempting them rather than reading the catalog
G5_SCOPE: PASS — 6 files, one module, exactly one monotonic migration; inside budget. Same shape as the 0019/0020/0021 integrity migrations this repo has run cleanly
G6_EXTERNAL: PASS — no PII, money, provider, legal or evidence gate; expand-only schema change, code-dark because no producer or scheduler feeds the path
HARD_DEPENDENCIES: db-job-claim-lease-core = MERGED (main@34429fc; probe 0022_job_claim_lease_core.sql::job_audit_events verified on origin/main)
PRIOR_SLICES: db-job-claim-lease-core
OPEN_QUESTIONS_IN_SCOPE: 0
ENABLEMENT_ONLY_GATES: none
LIVE_REPO_VERIFICATION: PASS (measured at 28d0c3a: migration tail is 0022 so 0023 is free; outbox_events carries claimed_at from 0005 and lease_expires_at from 0022; outbox_events_lease_shape_chk enforces both-NULL-or-both-NOT-NULL; outbox_events_producer_lease_boundary_chk forbids role `app` from setting the lease fields; idx_outbox_unclaimed is ON (created_at) WHERE claimed_at IS NULL and idx_outbox_expired_lease is ON (lease_expires_at) WHERE claimed_at IS NOT NULL; claim_outbox_batch reclaims expired leases before claiming new rows)
CONTRACT_MATRIX: PASS
CLOSURE_MATRIX: PASS (12/12)
ACCEPTANCE_MATRIX: PASS (OAM-1..OAM-10)
SECURITY_AND_MIGRATION_GATE: PASS — expand-only, one monotonic migration, 0000-0022 byte-identical, no role/attribute change, no RLS change, named rollback. Both existing CHECKs are extended rather than replaced, and the ack function follows the 0022 privilege pattern exactly: job_definer owner, fixed search_path, REVOKE ALL FROM PUBLIC, EXECUTE to app_worker only. 0022's own trap is carried forward — CREATE OR REPLACE does not change a function's owner, so re-owning claim_outbox_batch must be explicit
IMPLEMENTATION_ARTIFACTS: PASS (manifest committed and pushed at 28d0c3a; AP-34 launcher lands with this verdict as an execution aid derived from the manifest, not independent authority). The manifest's _problem/_decision_contract/_scope_in/_scope_out/_design_probe/_acceptance/_evidence_rules is the executable plan required by gate §B4
FIRST_IMPLEMENTATION_STEP: open a worktree at .autopilot/worktrees/db-outbox-ack-marker from the current origin/main tip, register the manifest via scope-gate, run the full CI list as the green baseline, re-verify the live migration tail, then write design-probe.md and STOP for founder confirmation before any production edit
REMAINING_BLOCKERS: none
NEXT_REVIEW_TRIGGER: n/a — CODE_READY; next event is the design probe, then the coding slice. On merge this unblocks Verdict 22 / job-runtime-dispatcher, which must then have its _scope_out and JRD-5 amended and be re-pinned
```

---

## Verdict 22 — `job-runtime-dispatcher`, job-infra slice 2b/4; `CODE_READY` → `NOT_CODE_READY` (2026-07-26) → **RE-PINNED `CODE_READY`** tại `7ac0b20` → **IMPLEMENTED & MERGED `fca314e`** (2026-07-27)

> **✅ IMPLEMENTED & MERGED 2026-07-27 — `main@fca314e`** (squash của `feat/job-runtime-dispatcher@3186dbc`,
> 11 file, +1735/−8). Verdict `CODE_READY` bên dưới giữ nguyên làm bằng chứng lịch sử; không còn là authority.
>
> **⚠️ CỔNG `2x_clean` Ở SLICE NÀY LÀ CLEAN TĨNH — ghi rõ để không bị đọc nhầm sau này.** Round 10 và 11 đều
> kết bằng verdict model thật trên cùng HEAD `3186dbc` (không commit xen giữa — đã đối chiếu timestamp), nhưng
> **cả hai đều chạy không có `DATABASE_URL_TEST`** và tự khai *"DB-backed tests could not run"*. Nghĩa là
> reviewer **chưa từng thực thi** các đường concurrency của dispatch loop — đúng vùng đã sinh ba finding ở vòng
> 7–9, trong đó một cái là lỗi nằm trong chính bản fix của vòng trước. Văn bản gate không đòi codex chạy DB
> test nên gate **không bị vi phạm**; giảm nhẹ có thật là slice tự chạy lại suite `apps/bot` 6+ lần. Nhưng
> **KHÔNG được đọc "2x clean" ở slice này thành "concurrency đã kiểm độc lập"**.
>
> **11 vòng codex, và HALT mới là phần có giá trị.** Vòng 1–5 tìm năm defect thật. Vòng 6 chạm trần
> `MAX_ROUNDS` với ba finding nữa và slice **HALT thay vì sửa** — đúng, vì mọi finding từ vòng 1 đều rơi vào
> cùng hai hàm, mỗi vòng thêm một chiều của *"app_worker có đúng tập quyền dự định không"*. Một allowlist ACL
> mọc dần không có chứng minh vét cạn, nên reviewer đối kháng luôn tìm được cạnh mới.
>
> **Cách gỡ là CẮT, không phải liệt kê kỹ hơn.** DD-90 Q6 (`decisions.md:106`) đòi preflight kiểm grant cần
> thiết **CÓ MẶT**, không đòi chứng minh quyền thừa **VẮNG MẶT**. Least-privilege attestation là control khác,
> unbounded theo cấu trúc, và **ngồi sai chỗ**: một preflight chạy *với tư cách* `app_worker` không thể chứng
> thực đáng tin rằng `app_worker` không bị nâng quyền, còn fail-closed vì một quyền lạ sẽ để một thay đổi lành
> tính của nền tảng giết worker lúc boot. Control đó đã có nhà: catalog test của `packages/db` chạy ở migration
> authority. **Cả ba finding vòng 6 tự tan** dưới bản cắt — đó là bằng chứng cắt đúng, không phải cắt tiện.
>
> **Một lỗi của reviewer (tôi) đã góp phần gây ra vòng 6.** `_decision_contract` của manifest diễn giải DD-90
> Q6 thành *"the pgboss schema and **base objects**"*; canonical chỉ nói *"kiểm schema/queues/catalog grants"*.
> Cụm "base objects" là tôi tự thêm, và chính nó sinh ra finding P1 của vòng 6. Đã sửa trong manifest cùng lượt
> reconcile này. Preflight ship ra uỷ việc kiểm tồn tại/phiên bản schema cho `contractor.check()` của chính
> pg-boss — hợp lệ, và **JRD-18 pin việc uỷ đó** để một bản pg-boss tương lai làm hỏng test thay vì âm thầm mất
> coverage.
>
> **Quyết định 26/07 của tôi về retry policy cũng sai và đã bị đảo có ý thức.** Tôi duyệt một backoff cụ thể
> (30s ×2, cap 1h, DLQ lần 5) nằm trong slice này; probe đọc `§4.3:173-174` đúng nguyên văn — policy thuộc
> *first concrete projector slice* — nên `dispatcher.ts` tính **zero** backoff. Bản duyệt của tôi đặt
> choke-point sớm một slice: đúng cái bẫy mechanical-mirror mà breaker 26 sinh ra để bắt.
>
> **Hệ quả cho slice 3:** stub production trả `dlq` ngay với `no_projector_implemented`. Khi slice 3 đăng ký
> cron, **mọi event sẽ DLQ** cho tới khi slice 4 land. Đó là tín hiệu ồn có chủ đích, không phải defect.

> **Lịch sử ba trạng thái, giữ nguyên có chủ đích.** Verdict này `CODE_READY` ngày 26/07, bị hạ
> `NOT_CODE_READY` cùng ngày khi design probe của AP-33 phát hiện `0022:166-181` là
> `HARD BLOCKING REQUIREMENT` viết đích danh cho slice này — trong khi manifest ghi `NO new migration`. Nay
> re-pin `CODE_READY` sau khi slice 2a (`0023`, merged `76e1f7b`) gánh nửa schema và manifest được amend tại
> `7ac0b20`. **Không xoá lịch sử đó**: nó là bằng chứng gate hoạt động — mâu thuẫn bị bắt bởi probe **trước khi
> có dòng code nào**, không phải bởi review sau merge.
>
> **`NO new migration` giờ ĐÚNG, không phải bị gỡ.** Hôm 26/07 câu này mâu thuẫn vì phần ack chưa ai làm. Sau
> khi 2a ship, cùng một câu trở thành **ranh giới cứng**: migration xuất hiện trong 2b nghĩa là scope trôi
> ngược về đất của 2a và slice HALT. Đây là điểm dễ sửa nhầm — bản năng "gỡ câu đã gây mâu thuẫn" sẽ mở lại
> đúng cái cửa mà việc tách slice vừa đóng.
>
> **Ba thay đổi thực chất so với bản 26/07, không cái nào là cosmetic:**
>
> 1. **Chữ ký dependency đã đổi.** `claim_outbox_batch` mọc cột thứ sáu `claim_token`, nên
>    `LIVE_REPO_VERIFICATION` cũ (đo tại `eeb69ce`, ghi năm cột) **stale ngay khi `0023` merge**.
>    `_evidence_rules` của manifest nay bắt đếm sáu cột trên synced main: còn năm nghĩa là `0023` bị revert và
>    tiền đề biến mất.
> 2. **Ack là nghĩa vụ của slice này, không phải dọn dẹp.** Thiếu lời gọi `ack_outbox_event`, handler tái tạo
>    **đúng** starvation loop mà 2a sinh ra để đóng. Thêm JRD-15 (ack đóng vòng), JRD-16 (`false` = claimant
>    khác đang giữ, không được nuốt cũng không được retry) và JRD-17 (fan-out thiếu thì raise — và một lần chạy
>    xanh với **một** projector đăng ký **không** thoả hàng này).
> 3. **JRD-5 viết lại thành khẳng định phủ định.** Bản cũ — "mọi read tenant-scoped đi qua `withTenant`" —
>    **rỗng**: probe đã chứng minh handler không đọc dữ liệu tenant-scoped nào, vì
>    `job_prepare_projector_delivery` tự dẫn `tenant_id` tại `0022:298`. Nó pass bằng cách không có gì để kiểm.
>    Nay khẳng định cấu trúc: handler phát **zero** SQL ngoài các definer function được grant. TDD §3.4 chuyển
>    thành nghĩa vụ của **slice 4**, và ghi rõ slice 4 **không** được thừa kế khẳng định phủ định này như thể
>    câu hỏi đã xong.
>
> **Điều CODE_READY này cho phép, nói chính xác:** mở worktree, register scope-gate, và **chạy design probe**.
> `design_probe_required: true` — nay **năm** lựa chọn cơ chế phải pin vào `design-probe.md` và owner xác nhận
> TRƯỚC bất kỳ production edit nào. Item (e) là mới và là cái bẫy sâu nhất: `ack_outbox_event` nhận
> `p_required_projectors text[]`, nên truyền "đúng projector mà slice này tình cờ đăng ký" **không phân biệt
> được với đúng ở hôm nay** và tái tạo, cao hơn một tầng, chính thất bại mà tham số mảng sinh ra để chặn.
>
> **Hai quyết định owner đã đóng, không mở lại trong slice:** producer = `DEFERRED_OUT_OF_SCOPE` (26/07) — câu
> hỏi "sync-engine hay từng feature" KHÔNG trả lời ở đây; và độ sâu = **trọn vòng đời** `claim → prepare →
> claim delivery → complete → ack` với cả ba kết quả, thay vì dừng ở `prepare`.

```text
REVIEW_POLICY_VERSION: 1.3
REVIEW_VERDICT: CODE_READY
REVIEWED_AT: 2026-07-27
AUTHORITY_SHA: 7ac0b201f958fa557455177b65c7de685c96164d
BASE_BRANCH: main
TARGET_FILES:
  - docs/autopilot-manifests/job-runtime-dispatcher.json
  - .claude/commands/ap-33-job-runtime-dispatcher.md
SLICE: job-runtime-dispatcher
IN_SCOPE: one module (apps/bot) — DD-90 Q6 fail-closed preflight run before boss.start() from an app_worker connection; first real queue registration; one boss.work() handler driving the full lifecycle claim_outbox_batch -> job_prepare_projector_delivery -> claim_projector_delivery_batch -> complete_projector_delivery for delivered/retry/dlq -> ack_outbox_event once fan-out completes, with the real projection step behind an injected interface that ships no production implementation; the required-projector list as a code-owned constant; tests for both files against real PostgreSQL with a real app_worker seat
OUT_OF_SCOPE: any producer — zero INSERT into outbox_events in shipped code, owner-decided DEFERRED_OUT_OF_SCOPE; cron/schedule registration (slice 3); real projector or surface_refs access (slice 4); edits to provision-queue.ts, queue.ts options or migrations 0000-0023; ANY new migration — now a hard boundary rather than the 26/07 contradiction, since slice 2a shipped the schema half at 0023, so a migration here means scope drifted back into 2a and the slice HALTs; RLS or GRANT changes; claim ordering (ORDER BY created_at is the sync-engine contract, DD-89 Q3); direct DML on outbox_events, projector_deliveries or job_audit_events from app_worker
G1_DECISION: PASS — DD-89 (Q1 narrow definer functions, Q2 provisioning exception, Q3 ordering) and DD-90 Q6 (preflight before boss.start(), not boss.work()) are owner-final; the two product/scope choices were owner-decided 2026-07-26; the ack shape and the stale-token guard were owner-decided at the 2a design probe and are now merged code (0023) rather than an open question
G2_SPEC: PASS — infra slice with equivalent reviewed technical authority rather than a fabricated Product spec: the DB contract is merged code (0022 + 0023) plus docs/autopilot-db-job-claim-lease-core.md §4.2/§4.3, and the runtime contract is DD-90 Q6 + TDD §3.4. Deliberately NO separate task-contract doc — re-authoring the state machine would create a second authority free to drift
G3_DEPENDENCY: PASS — RESTORED 2026-07-27. Both hard dependencies are merged and probe-verified on origin/main, not read from the backlog: 0022 (34429fc) contains job_audit_events and grants the four functions to app_worker at 0022:527-530; 0023 (76e1f7b) contains ack_outbox_event(uuid, text[], uuid) with REVOKE ALL FROM PUBLIC and GRANT EXECUTE to app_worker at 0023:297-298. The 26/07 FAIL is preserved in the preamble as evidence the probe gate caught the contradiction before any code was written
G4_TEST: PASS — JRD-1..JRD-17 authored before code with exact expected results. Four are anti-regression rather than coverage: JRD-4 requires proving NO pg-boss startup or maintenance work occurred when preflight fails (the boss.start() vs boss.work() distinction DD-90 Q6 turns on); JRD-12 greps the shipped diff for INSERT into outbox_events so the producer deferral cannot silently become "already proven"; JRD-15 fails if the ack call is omitted, which is the only way to catch a handler that looks correct and starves the queue; JRD-17 is explicitly NOT satisfied by a green run with one projector registered. JRD-3, JRD-5, JRD-11 and JRD-15..17 are not satisfiable by a mocked pool
G5_SCOPE: PASS with a named budget exception — one module (apps/bot), 7 files including two new sources and two new test files, above the nominal comfort and UNCHANGED by this amendment: the ack call and the required-projector constant land in dispatcher.ts, adding no file. Splitting preflight from the handler was considered and rejected on DD-90 Q6's own logic: the preflight exists to fence the FIRST real queue registration, so a preflight slice with QUEUES still empty would assert nothing. No migration is added — the schema half is slice 2a. If implementation materially overruns ~300 LOC, that is a re-slice trigger to be raised at the design probe, not a silent overrun
G6_EXTERNAL: PASS — no PII, money, provider, legal or evidence gate; job infrastructure only, and it stays code-dark because no producer feeds it
HARD_DEPENDENCIES: db-job-claim-lease-core = MERGED (main@34429fc; probe 0022_job_claim_lease_core.sql::job_audit_events verified on origin/main) · db-outbox-ack-marker = MERGED (main@76e1f7b; probe 0023_outbox_ack_marker.sql::ack_outbox_event verified on origin/main)
PRIOR_SLICES: db-job-claim-lease-core (slice 1/4, merged 2026-07-26) · db-outbox-ack-marker (slice 2a, merged 2026-07-27)
OPEN_QUESTIONS_IN_SCOPE: 0
ENABLEMENT_ONLY_GATES: none
LIVE_REPO_VERIFICATION: PASS (re-measured at 7ac0b20, NOT carried forward from the 26/07 block at eeb69ce, which is now stale by exactly one column: claim_outbox_batch returns SIX columns (event_id, tenant_id, aggregate_id, sequence, type, claim_token) after 0023 replaced it — five columns on synced main means 0023 was reverted and the premise is gone; ack_outbox_event(p_event_id uuid, p_required_projectors text[], p_claim_token uuid) RETURNS boolean is declared at 0023:228-232, REVOKEd FROM PUBLIC and GRANTed EXECUTE to app_worker only at 0023:297-298; claim_projector_delivery_batch returns (event_id, tenant_id, projector, claim_token, attempts); complete_projector_delivery takes seven parameters and returns boolean; the four 0022 functions GRANT EXECUTE to app_worker at 0022:527-530; QUEUES is still `readonly string[] = []`; worker.ts still has zero boss.work() call sites; queue.ts pins migrate:false and requires a direct connection; provision-queue.ts holds the pg-boss DDL/grant authority per DD-89 Q2)
CONTRACT_MATRIX: PASS
CLOSURE_MATRIX: PASS (12/12)
ACCEPTANCE_MATRIX: PASS (JRD-1..JRD-17)
SECURITY_AND_MIGRATION_GATE: PASS — no migration, no grant change, no RLS change. The security-relevant properties are strengthened, not relaxed: DD-90 Q6's provision-ordering fence becomes a runtime check instead of a runbook convention; DD-89 Q1's zero-direct-DML boundary is pinned by JRD-11 and now covers FIVE granted functions rather than four; and 0023's stale-token guard is exercised from the runtime seat by JRD-16, so a zombie worker acking an event a live claimant is mid-flight on is a tested no-op rather than an argument. TDD §3.4 is deliberately NOT claimed as satisfied here — JRD-5 records that this handler reads no tenant-scoped data, and that the choke-point becomes binding for slice 4
IMPLEMENTATION_ARTIFACTS: PASS (amended manifest committed and pushed at 7ac0b20; the AP-33 launcher is re-amended alongside this verdict as an execution aid derived from the manifest, not independent authority — same pattern as Verdict 23 / 28d0c3a). The manifest's _problem/_decision_contract/_scope_in/_scope_out/_design_probe/_acceptance/_scope_exception/_evidence_rules is the executable plan required by gate §B4
FIRST_IMPLEMENTATION_STEP: open a worktree at .autopilot/worktrees/job-runtime-dispatcher from the current origin/main tip (7ac0b20 or later), register the manifest via scope-gate, run the full CI command list as the green baseline, re-verify that claim_outbox_batch still returns six columns, then write design-probe.md covering all FIVE items and STOP for founder confirmation before any production edit
REMAINING_BLOCKERS: none — both 26/07 blockers are closed. The dependency blocker closed by 2a merging at 76e1f7b; the vacuous-JRD-5 blocker closed by rewriting it as a negative assertion at 7ac0b20
NEXT_REVIEW_TRIGGER: n/a — CODE_READY; next event is the design probe (five items), then the coding slice. Re-review is required if claim_outbox_batch's signature moves again or if a producer decision is taken before this slice lands
```

---

## Verdict 21 — `docs-user-settings-0014-merge-state-reconcile`, correct stale 0000-0013/0014-branch-only claims to tail 0022; `CODE_READY` → IMPLEMENTED & MERGED `eba7ff4` (2026-07-26)

> **Bản chất:** reconcile current-state thuần. `0014_players_waitlist` đã merge tại `1a6ac38` và tail toàn cục nay là
> `0022`, nhưng `feature_user_settings_tech.md` vẫn khẳng định `0000–0013` là tập đã merge và `0014` còn branch-only.
> Slice chị em `docs-0014-merge-status-repo-wide-reconcile` đã sửa bảy BE spec khác và **cố ý defer** file này vì lúc đó
> nó đang dirty do một edit consent chưa commit. File nay đã sạch nên điều kiện defer hết hiệu lực.
>
> **Hai sai lệch trong backlog note đã được sửa khi author, không chép verbatim:** note ghi "tail 0018" — đúng lúc viết,
> nay stale, target thật là `0022`; và note kể ba dòng (61/65/67) trong khi grep ra **năm** — dòng 10 và 14 cũng khẳng
> định "Migration mới sau `0013`". Sửa đúng ba dòng là đóng thiếu.

```text
REVIEW_POLICY_VERSION: 1.3
REVIEW_VERDICT: CODE_READY
REVIEWED_AT: 2026-07-26
AUTHORITY_SHA: cc77610e9fe14b7590e0694ffa84684d249401c1
BASE_BRANCH: main
TARGET_FILES:
  - docs/autopilot-manifests/docs-user-settings-0014-merge-state-reconcile.json
  - docs/features/BE/feature_user_settings_tech.md
SLICE: docs-user-settings-0014-merge-state-reconcile
IN_SCOPE: five current-state corrections in feature_user_settings_tech.md (lines 10, 14, 61, 65, 67) re-anchoring "migration mới sau 0013" and "0014 branch-only" to the live merged tail 0022 with 0014 merged at 1a6ac38; header Version 0.14 -> 0.15; one new changelog row at the TOP of the descending table
OUT_OF_SCOPE: the numbering GUIDANCE itself ("next monotonic after the synced tail" is correct policy and stays, no hard-coded 0023); the genuinely-new object list, whose content was re-verified accurate at 0022 and only has its range anchor moved; schema, migration, code, tests; DD-39/DD-47/DD-48 or any open question — Status stays Draft and Implementation stays Not started; the seven sibling specs already corrected by docs-0014-merge-status-repo-wide-reconcile; README, BUILD-STATUS and ROADMAP, already reconciled to 0022 at 80bea53
G1_DECISION: PASS — no product decision involved; this corrects a factual merge-state claim against git history
G2_SPEC: PASS — target is a Reviewed-process BE tech spec; the corrective authority is git itself (0014 merged at 1a6ac38, tail 0022 on main), not another document's opinion
G3_DEPENDENCY: PASS — docs-0014-merge-status-repo-wide-reconcile is merged (probe matched on main at dc7a0cd) and its explicit defer condition, "file is dirty, serialize against whoever owns it", has lapsed: feature_user_settings_tech.md is clean in the working tree, verified at author time
G4_TEST: PASS — US14-1..US14-9 authored before execution; US14-4 exists specifically because the backlog note under-counted the stale lines, and US14-6 guards the still-accurate genuinely-new list from being "corrected" into wrongness
G5_SCOPE: PASS — exactly 2 files, invariants [], no collision: scope intersection with the concurrently in-flight docs-marketplace-public-capacity-guard is empty
G6_EXTERNAL: PASS — docs-only, no PII/money/provider/legal gate
HARD_DEPENDENCIES: none — its one prerequisite slice is merged
PRIOR_SLICES: docs-0014-merge-status-repo-wide-reconcile (merged) — this slice is the deliberately split-out remainder, not a duplicate
OPEN_QUESTIONS_IN_SCOPE: 0
ENABLEMENT_ONLY_GATES: none
LIVE_REPO_VERIFICATION: PASS (verified at cc77610: tail is 0022 with 23 migrations; grep found five stale lines not three; every object the doc calls genuinely-new — persons.{gender_enc,dob_enc,username,language,profile_visibility}, sessions.{price_male,price_female}, person_follows — is still absent from migrations and schema.ts, so that paragraph must survive; channel_identities.username_enc from 0001 is a DIFFERENT column and must not be conflated with the proposed persons.username; the changelog table is descending so the new row goes on top; merged probe token 0022 currently appears 0 times in the file)
CONTRACT_MATRIX: PASS
CLOSURE_MATRIX: PASS (12/12)
ACCEPTANCE_MATRIX: PASS (US14-1..US14-9)
SECURITY_AND_MIGRATION_GATE: PASS — no migration, no grant, no RLS; correcting a stale tail claim reduces the risk of a future slice reserving a taken migration number
IMPLEMENTATION_ARTIFACTS: PASS (manifest committed and pushed at cc77610). No separate task-contract doc or launcher: for a P2 single-target-file docs slice the manifest _problem/_live_verification/_scope_in/_scope_out/_acceptance IS the executable plan required by gate §B4, matching the docs-prd-flow2-publish-projection-reconcile precedent
CODEX_ROUNDS: 1, CLEAN for this slice's scope — the first slice this session to satisfy `1x_clean` with no residual and no deviation. The round's verdict opened "the migration-tail reconciliation is accurate"; its two findings ([P2] the marketplace projector enablement gate excluded its own DB-CHECK exit, [P3] a merge record cited README v2.3 when the live cell read v2.2) both pointed at artifacts owned by docs-marketplace-public-capacity-guard, outside this slice's declared scope. The slice logged them to regions.log as handed-to-main and refused to fold them in; both were fixed separately on main at 949f5c4
FIRST_IMPLEMENTATION_STEP: n/a — IMPLEMENTED & MERGED at origin/main@eba7ff4 (squash of feat/docs-user-settings-0014-merge-state-reconcile@5b9b8a3; 1 file, +7/-6; merged probe 0022 verified on main)
REMAINING_BLOCKERS: none — merged
NEXT_REVIEW_TRIGGER: n/a — merged. Unblocks docs-migration-range-0013-and-dd82-current-state-sweep, which was collision-blocked on this same file
```

---

## Verdict 20 — `docs-marketplace-public-capacity-guard`, execute the delegated public+NULL projection guard; `CODE_READY` → IMPLEMENTED & MERGED `5b1c221` (2026-07-26)

> **Bản chất slice:** thi hành một **uỷ quyền đã ghi sẵn**, không mở quyết định mới. `feature_session_management_tech.md`
> §2 (Capacity × visibility, authority PRD E#7) đã chốt `visibility='public'` ⇒ `slots_max IS NOT NULL`, đã chốt hàng
> public + NULL nằm ngoài choke-point là **invalid state không được xuất hiện trong public projection**, và **giao
> tường minh** phần "skip/reject + audit" cùng regression test cho `feature_marketplace_discovery_tech.md`. Uỷ quyền đó
> tới nay chưa ai thi hành: `slots_max` xuất hiện **0 lần** trong spec marketplace. Invariant đang được khẳng định ở một
> doc và thuộc sở hữu của một doc không hề nhắc tới nó.
>
> **Lựa chọn kỹ thuật được pin ở đây** (không phải product decision): projector **skip** hàng lỗi, xoá projection cũ nếu
> có, phát audit, **chạy tiếp batch**. Không halt. Fail-closed đúng ở phạm vi **hàng**; halt cả projector vì một hàng
> legacy sẽ biến lỗi dữ liệu một dòng thành sự cố ngừng discovery toàn sàn.

```text
REVIEW_POLICY_VERSION: 1.3
REVIEW_VERDICT: CODE_READY
REVIEWED_AT: 2026-07-26
AUTHORITY_SHA: 72cdd56da55683cd17f0dd4d6ed179a2919603e6
BASE_BRANCH: main
TARGET_FILES:
  - docs/autopilot-manifests/docs-marketplace-public-capacity-guard.json
  - docs/features/BE/feature_marketplace_discovery_tech.md
SLICE: docs-marketplace-public-capacity-guard
IN_SCOPE: four additive edits to the marketplace BE spec — edge case #15 (public + slots_max IS NULL is skipped, never upserted, pre-existing projection removed, audit emitted), §4 Projector Logic gate made explicit for the public capacity requirement plus skip-and-continue semantics, unit-test row #26 as the regression pin, §6 changelog v2.4 + header version bump
OUT_OF_SCOPE: schema, migration and the DB CHECK hardening candidate NOT(visibility='public' AND slots_max IS NULL) — still unscoped, must not be claimed as done; any .ts code (no projector exists yet, so the test row is a spec test-plan row and no test file is created); feature_session_management_tech.md (it already delegates correctly); Product spec, PRD, BRD, TDD, business-rules (no new rule is introduced); docs/features/README.md index cell (deferred by precedent); MKT-OQ-3 and every other open question
G1_DECISION: PASS — the product decision is already owner-pinned (PRD E#7 + feature_session_management_tech §2); this slice only executes the technical handling that §2 explicitly delegated to the discovery owner, and the manifest pins that handling rather than leaving it to the implementer
G2_SPEC: PASS — target spec is Reviewed v2.3; the delegating authority note is live at feature_session_management_tech.md:120. Infra/docs slice with equivalent reviewed technical authority, no fabricated Product spec
G3_DEPENDENCY: PASS — public_sessions exists on main since migration 0006; no unmerged dependency. There is deliberately NO code dependency: grep shows public_sessions appears only in schema.ts, migrate.ts comments and rls-invariants tests, i.e. no projector exists, and that absence is pinned as negative scope rather than assumed away
G4_TEST: PASS — MPC-1..MPC-9 authored before execution with exact expected results; MPC-5 (sibling valid rows in the same batch still project) is the row that would catch a halt-on-fault reading, and MPC-8 pins that existing rows stay byte-unchanged
G5_SCOPE: PASS — exactly 2 files, invariants [], far inside budget; scope-gate registry currently has 0 active features so no collision is possible
G6_EXTERNAL: PASS — no PII, money, provider, legal or evidence gate touched; docs-only, no runtime behaviour changes
HARD_DEPENDENCIES: none — root docs slice; its only authority prerequisite (the session_management capacity contract) is merged
PRIOR_SLICES: none — but note the lineage: docs-session-create-publicslots-reconcile authored the §2 note that created this delegation, and docs-prd-flow2-publish-projection-reconcile is the immediate precedent for editing this same target file
OPEN_QUESTIONS_IN_SCOPE: 0
ENABLEMENT_ONLY_GATES: job-infra-public-projection-reconciliation — AMENDED 2026-07-26 after codex round-02/03. The edge #15 handling only fires when the projector EVALUATES the session; a writer that bypasses the SessionService choke-point and flips an already-projected public session from finite slots_max to NULL emits no event, so the stale projection stays publicly visible and unit test #26 (which places the row into a batch by hand) cannot detect that path. Codex correctly refused prose-only deferral, so the residual is now a NAMED tracked backlog task. Classified ENABLEMENT_ONLY, not HARD_DEPENDENCY: this docs slice is strictly better than the status quo and must not be blocked on unbuilt runtime, but the future public-projection projector must not be ENABLED while the gap is open. Exposure today = 0 (no projector in TypeScript; Implementation: Not started). Cheapest candidate fix is the DB CHECK already recorded in feature_session_management_tech.md §2, which removes the invalid state at source
LIVE_REPO_VERIFICATION: PASS (IMPLEMENTED — squash-merged at origin/main@5b1c221 on 2026-07-26 from feat/docs-marketplace-public-capacity-guard@ff6024e; exactly the one target spec file, +8/-3; merged probe slots_max verified present on main; spec now Reviewed v2.4, Implementation still "Not started". Authored at 72cdd56 where slots_max appeared 0 times, so the probe was meaningful and not pre-satisfied)
CONTRACT_MATRIX: PASS
CLOSURE_MATRIX: PASS (12/12)
ACCEPTANCE_MATRIX: PASS (MPC-1..MPC-9)
SECURITY_AND_MIGRATION_GATE: PASS — no migration, no grant, no RLS change. The security-relevant property (an invalid row must never reach the cross-tenant no-RLS public_sessions surface) is strengthened, not relaxed
IMPLEMENTATION_ARTIFACTS: PASS (manifest at 72cdd56; implementation squash-merged at 5b1c221). Authored WITHOUT a launcher — a documented shortcut, not a precedent to copy: canonical autopilot-prompt-GENERIC v0.6.1 §0.1 classifies "new mechanism choice" as design_probe_required=true, and this slice DID make one (skip-and-continue vs halt-on-fault). The probe gate was omitted and the cost was measurable — 4 codex rounds on a 4-edit slice, where a single STOP-and-confirm would have surfaced the same questions up front. Later docs slices (AP-32) carry a launcher and an explicit design_probe_required declaration
CODEX_ROUNDS: 4, stopped at round-04 with a documented residual rather than a clean round — a deliberate deviation from the manifest's codex_review "1x_clean", owner-authorised, following the docs-prd-flow2-publish-projection-reconcile precedent. Round-01 found a real gap the authoring manifest had MISSED (cached public DTO/CDN entry must also be purged, otherwise an invalid row keeps being served until TTL — skipping the projection alone does not satisfy "must never appear"). Round-02 repeat and round-04 "the named backlog task does not exist" were both verified STALE against git: the latter because the branch had rebased before the task landed at 3b12e43; a post-rebase grep resolved it with no content change
FIRST_IMPLEMENTATION_STEP: n/a — IMPLEMENTED & MERGED at origin/main@5b1c221
REMAINING_BLOCKERS: none — merged. The eventless-invalidation residual is NOT a blocker of this slice; it is the named ENABLEMENT_ONLY gate above, tracked as backlog task job-infra-public-projection-reconciliation
NEXT_REVIEW_TRIGGER: n/a — merged. Deferred follow-up RESOLVED at main@f6e1c72: the docs/features/README.md coverage-index cell actually read **v2.2**, not v2.3 as first recorded here — the drift predated this slice (docs-prd-flow2 deferred the same cell when it shipped v2.3), so this record understated it. Synced v2.2 → v2.4; 19 of 20 BE index cells were verified in sync
```

---

## Verdict 19 — `db-job-claim-lease-core`, job lease/audit/definer root; `CODE_READY` (2026-07-25, re-pinned to `948636f`)

> **Tracker of record cho slice này.** Hai mirror phải giữ đồng nhất từng field với block dưới đây:
> `docs/autopilot-db-job-claim-lease-core.md` §Verdict và `docs/project-progress-review-2026-07-25.md` §7.
> Nếu lệch, block này thắng. Mọi lần re-pin `AUTHORITY_SHA` phải cập nhật cả ba.
>
> **Provenance của lần re-pin này.** Block được author tại `2937ed9` với verdict `NOT_CODE_READY`; blocker duy
> nhất là "chưa có immutable SHA chứa toàn packet". Commit A `42a1fb0` (docs current-state reconcile, 12 file)
> rồi commit B `948636f` (authority packet, đúng 11 `TARGET_FILES`) đã đóng blocker đó. **Contract không đổi
> một dòng nào** giữa hai lần pin — chỉ `AUTHORITY_SHA`, closure #1/#12, `IMPLEMENTATION_ARTIFACTS` và
> `FIRST_IMPLEMENTATION_STEP` đổi. Commit re-pin này là pin-only: nội dung đã review nằm bất biến tại `948636f`.

```text
REVIEW_POLICY_VERSION: 1.3
REVIEW_VERDICT: CODE_READY
REVIEWED_AT: 2026-07-25
AUTHORITY_SHA: 948636f4bd3c1bc0feaaf8b91b3ad2730b097e72
BASE_BRANCH: main
TARGET_FILES:
  - docs/standards/decisions.md
  - docs/autopilot-manifests/db-job-claim-lease-core.json
  - docs/autopilot-db-job-claim-lease-core.md
  - .claude/commands/ap-31-db-job-claim-lease-core.md
  - docs/autopilot-backlog.md
  - docs/slice-readiness-verdicts.md
  - docs/standards/BUILD-STATUS.md
  - docs/project-progress-review-2026-07-25.md
  - docs/standards/core-db-architecture-principles.md
  - docs/standards/deployment-infra.md
  - packages/db/README.md
SLICE: db-job-claim-lease-core
IN_SCOPE: outbox/projector lease primitives, per-event job audit, job_definer bootstrap/ownership, schema mirror, real-role tests and CI/local bootstrap
OUT_OF_SCOPE: worker preflight/startup, pg-boss queues, runtime handler/cron, producers/projectors, frontend/UI/design mapping, surface_refs and tenant-RLS policy changes
G1_DECISION: PASS
G2_SPEC: PASS
G3_DEPENDENCY: PASS
G4_TEST: PASS
G5_SCOPE: PASS — documented budget exception (P1 root migration spans DB code, real-role tests, CI and local bootstrap); at this SHA the live migration tail is 0021, so 0022_job_claim_lease_core.sql is the verified next monotonic path and package.json is reserved solely for db:bootstrap. A pre-register tail recheck stays mandatory; any drift requires updating manifest, backlog and all verdict mirrors, committing/pushing the correction, then re-pinning
G6_EXTERNAL: PASS
HARD_DEPENDENCIES: none — root slice; 0000 role model, 0005 worker tables and 0010 claim function are merged and re-verified at this SHA
PRIOR_SLICES: none
OPEN_QUESTIONS_IN_SCOPE: 0
ENABLEMENT_ONLY_GATES: none
LIVE_REPO_VERIFICATION: PASS (IMPLEMENTED — squash-merged at origin/main@34429fceac2349d3362bdd0be4aee60d9af71c5d on 2026-07-26; exactly the 10 manifest-scope files, +1930/-33; migration tail advanced 0021 -> 0022; merged probe 0022_job_claim_lease_core.sql::job_audit_events verified on main; db suite 201/201 on merged main)
CONTRACT_MATRIX: PASS
CLOSURE_MATRIX: PASS (12/12)
ACCEPTANCE_MATRIX: PASS (JCL-1..JCL-14; real-PostgreSQL db suite 179 -> 201 on merged main)
SECURITY_AND_MIGRATION_GATE: PASS (codex round-11 closed an indirect runtime-role -> group-role -> job_definer BYPASSRLS path by rechecking the denylist AFTER the grant in the same transaction with atomic rollback)
IMPLEMENTATION_ARTIFACTS: PASS (authority packet merged at 948636f; implementation squash-merged at 34429fc)
FIRST_IMPLEMENTATION_STEP: n/a — IMPLEMENTED & MERGED at origin/main@34429fc (13 codex rounds; rounds 12 and 13 clean on the same HEAD 19091dc). The five-round fix breaker fired at round 11 and was owner-authorised to continue — that round is what surfaced the BYPASSRLS escalation path above; the override is recorded here rather than left implicit
REMAINING_BLOCKERS: none — merged
NEXT_REVIEW_TRIGGER: n/a — merged. Next event is slice 2 `job-runtime-dispatcher` (worker preflight fail-closed before `boss.start()`), which is a new slice needing its own manifest and verdict; it does not inherit this authorization
```

**Đọc verdict:** DD-89/DD-90 đã đóng mọi owner choice. Handoff bây giờ pin lease, audit, role bootstrap,
function-owner allowlist và real-role acceptance; không có runtime proof hay quyền mở worktree cho tới khi
packet trở thành authority bất biến trên `main`.

---

## Verdict 1 — Auth provider swap, slice đầu (D0 revoke-core + Google adapter)

<!-- review-verdict: historical -->
```text
REVIEW_VERDICT: NOT_PLAN_READY
REVIEWED_AT: 2026-07-19
AUTHORITY_SHA: 22c23aab080183913d2852805a085bba1057a91a
BASE_BRANCH: main
TARGET_FILES:
  - docs/b0-auth-credential-lifecycle-design-probe.md
  - docs/features/feature_web_auth_onboarding.md
  - docs/features/BE/feature_web_auth_onboarding_tech.md
  - docs/features/BE/auth-security-invariant-table.md
SLICE: auth-s4-account-session-core (D0 revoke-core → D1 google-adapter)
IN_SCOPE: shared account/session core; revoke-core; Google OIDC adapter
OUT_OF_SCOPE: email credential bundle (chờ C7); gỡ Telegram-era routes (expand→contract sau)
G1_DECISION: FAIL
G2_SPEC: PARTIAL
G3_DEPENDENCY: PASS
G4_TEST: PARTIAL
G5_SCOPE: FAIL
G6_EXTERNAL: ENABLEMENT_ONLY:C7-email-provider,A3-legal-PII
HARD_DEPENDENCIES: foundation S1–S3 = MERGED (main@22c23aa)
PRIOR_SLICES: none (đây là dependency gốc của feature layer)
OPEN_QUESTIONS_IN_SCOPE: 1
ENABLEMENT_ONLY_GATES: C7 email-provider (chặn email bundle, không chặn Google/revoke); A3 legal-PII (go-live)
LIVE_REPO_VERIFICATION: PASS
CONTRACT_MATRIX: PARTIAL
ACCEPTANCE_MATRIX: FAIL
SECURITY_AND_MIGRATION_GATE: PARTIAL
IMPLEMENTATION_ARTIFACTS: FAIL
FIRST_IMPLEMENTATION_STEP: (blocked)
REMAINING_BLOCKERS:
  - blocker: B0 auth design-probe chưa owner-duyệt và chưa ghi thành DD → authority auth chưa đóng băng (§A1) + open decision ảnh hưởng schema/auth/identity còn mở (§A5)
    owner: owner (duyệt) → mình (ghi DD + author D1 manifests)
    resolution: owner tick "duyệt cả 6" (§3/§3.2/§4/§5/§8/§10) → ghi DD auth-credential-lifecycle vào decisions.md
NEXT_REVIEW_TRIGGER: DD auth-credential-lifecycle committed + D0/D1 autopilot artifacts pushed lên main
```

**Đọc verdict:** đây là candidate **gần code nhất**, nhưng vẫn `NOT_PLAN_READY`. B0 là authority blocker đầu tiên; sau khi owner duyệt vẫn phải author/review D0/D1 slice specs, acceptance matrix và artifacts rồi chạy lại closure 12/12. Chỉ slice pass mới `CODE_READY`; email bundle vẫn `ENABLEMENT_ONLY` chờ C7.

---

## Verdict 2 — `dd41-public-session-projection-fields` (slice #1 của chuỗi share, gate §9)

```text
REVIEW_POLICY_VERSION: 1.3
REVIEW_VERDICT: NOT_CODE_READY
REVIEWED_AT: 2026-07-19
AUTHORITY_SHA: 22c23aab080183913d2852805a085bba1057a91a
BASE_BRANCH: main
TARGET_FILES:
  - packages/db/migrations/0006_discovery.sql
  - packages/db/schema.ts
  - docs/standards/business-rules.md (BL-DSC-1)
  - docs/features/feature_marketplace_discovery.md
SLICE: dd41-public-session-projection-fields
IN_SCOPE: expand public_sessions whitelist theo BL-DSC-1 (retire skill_level; add session_type/level_*_rank/gender_restriction/age_*); invariant tests; code dark
OUT_OF_SCOPE: projector ghi (DD-12); fence/guarded-view (DD-12); share route (DD-73)
G1_DECISION: PASS
G2_SPEC: FAIL
G3_DEPENDENCY: FAIL
G4_TEST: FAIL
G5_SCOPE: FAIL
G6_EXTERNAL: PASS
HARD_DEPENDENCIES: DD-38/39 person.gender + chat migration = PRIOR_SLICE (chưa merge main)
PRIOR_SLICES: DD-38/39 migration slice (ordering: sau chat/gender, theo DD-41)
OPEN_QUESTIONS_IN_SCOPE: 0
ENABLEMENT_ONLY_GATES: none
LIVE_REPO_VERIFICATION: PASS
CONTRACT_MATRIX: PASS (behavior contract complete; repository closure currently 10/12)
CLOSURE_MATRIX: FAIL (10/12)
ACCEPTANCE_MATRIX: FAIL
SECURITY_AND_MIGRATION_GATE: PARTIAL
IMPLEMENTATION_ARTIFACTS: FAIL
FIRST_IMPLEMENTATION_STEP: (blocked)
REMAINING_BLOCKERS:
  - blocker: hard dependency DD-38/39 (person.gender + chat) migration chưa trên main → không thể pin expand/contract order + FK
    owner: DD-38/39 migration slice
    resolution: DD-38/39 migration merged vào main (merged probe)
  - blocker: acceptance matrix + autopilot artifacts chưa author (không có manifest/launcher/test table với expected result)
    owner: mình
    resolution: author dd41 slice spec (Product+BE section trong marketplace_discovery) + manifest + acceptance table
NEXT_REVIEW_TRIGGER: DD-38/39 migration merge probe + dd41 autopilot artifacts committed
```

**Đọc verdict:** DD-41 là `DECISION_FINAL` và contract đủ mạnh, nhưng slice `NOT_CODE_READY` vì hard dependency (gender/chat migration) chưa trên `main` và chưa có acceptance matrix/artifacts. Đây là điểm vào của **chuỗi share** — nhưng nằm sau auth trong delivery order.

---

## Trạng thái 5-state cho cụm (không được gộp — gate §2/§9)

| Phạm vi | Trạng thái đúng |
|---|---|
| 6 product decision DD-73..78 | `DECISION_FINAL` ✅ (đạt 2026-07-19) |
| Auth S4 slice đầu | DD-80 G3 decision closed; **D0a MERGED @ `main@8f493f7` (owner override) · D0b MERGED @ `main@93c5404` (gate ĐẠT)** — Verdict 5a/5b lịch sử, **Verdict 6** ghi kết quả D0b. Kế tiếp: `auth-s4-d1-email-token-core` |
| `dd41-public-session-projection-fields` | `NOT_CODE_READY` → chờ DD-38/39 merge + artifacts |
| Toàn cluster DD-73..78 như một slice | `NOT_CODE_READY` (gate §9) |
| DD-76/77 | chỉ xét PLAN/CODE sau product-evidence baseline + owner threshold |

## Chuỗi slice ưu tiên (đồng bộ gate §9 + reality auth-first)

1. ~~`auth-s4-d0-revoke-core` (D0a)~~ ✅ merged `8f493f7` · ~~`auth-s4-d0-session-web-boundary` (D0b)~~ ✅ merged `93c5404` (gate ĐẠT). **Kế tiếp: `auth-s4-d1-email-token-core`** (order-2, code dark) → `auth-s4-d1-google-adapter`.
2. `dd41-public-session-projection-fields` — điểm vào chuỗi share; chặn ở DD-38/39 merge.
3. `dd12-guarded-public-read` — projector + fence + guarded view + grants + projection version.
4. `dd73-session-share-route` — `/s/<id>` + OG/image + join revalidation + telemetry.
5. `dd74-75-activity-intent-projector` — sau allocation owner + dependency.
6. `dd76-77-feed-kudos` — chỉ sau product-evidence baseline + owner threshold.

---

---

## Verdict 3 — `auth-s4-d0-revoke-core` (re-review sau DD-80, 2026-07-19)

> **Superseded 2026-07-20 by Verdict 5a/5b below.** DD-80 v1.88 changes the concurrency contract and
> decomposes the slice; this historical CODE_READY block must not authorize a worktree.
>
> Authority mới: **DD-80 ✅ (decisions v1.77, commit `c1a3957`)** + slice artifacts (`352e6ec`) trên `feat/session-waitlist-expand`. Code-truth base vẫn `main@ca6c97e` (delta so với `22c23aa` là docs-only). Verdict 1/2 giữ nguyên làm lịch sử tại snapshot cũ.

<!-- review-verdict: historical -->
```text
REVIEW_VERDICT: CODE_READY
REVIEWED_AT: 2026-07-19
AUTHORITY_SHA: 352e6ec (feat/session-waitlist-expand; DD-80 tại c1a3957; code-truth main@ca6c97e)
BASE_BRANCH: main
TARGET_FILES:
  - docs/b0-auth-credential-lifecycle-design-probe.md (✅ owner-approved)
  - docs/standards/decisions.md (DD-80 · v1.77)
  - docs/features/BE/feature_web_auth_onboarding_tech.md (v2.8 §3 + acceptance D0)
  - docs/autopilot-manifests/auth-s4-d0-revoke-core.json
SLICE: auth-s4-d0-revoke-core
IN_SCOPE: internal revoke-by-account helper + public wrapper derive-from-current-session + POST /api/auth/logout-all + CSRF + tests + schema mirror B0 §9(a) + CREATE OR REPLACE rotate parent-first + auth_audit_events append-only + export root index.ts (v1.83) + issuance fence session-cookies.ts (reject-and-reauth, không fallback-mint khi rotate null) + partial index web_sessions(account_id) WHERE revoked_at IS NULL trong 0015 (v1.86)
OUT_OF_SCOPE: email lifecycle (D1 bundle, flag OFF); Google/Facebook adapter (D1); Telegram removal; mọi grant mới cho `app` ngoài exact wrapper
G1_DECISION: PASS
G2_SPEC: PASS
G3_DEPENDENCY: PASS
G4_TEST: PASS
G5_SCOPE: PASS
G6_EXTERNAL: PASS
HARD_DEPENDENCIES: db-postgres-drizzle-rls + auth-onboarding-v3 = MERGED (main@ca6c97e; dep_checks: auth_revoke_web_session/auth_resolve_web_session/rate_limit_check trong 0012 — verified)
PRIOR_SLICES: none (root của feature layer)
OPEN_QUESTIONS_IN_SCOPE: 0
ENABLEMENT_ONLY_GATES: none
LIVE_REPO_VERIFICATION: PASS (0012 chỉ có single-token revoke; schema.ts chưa mirror auth_login_nonces/auth_login_state/rate_limit_hits — đúng drift §9(a) mà slice này đóng)
CONTRACT_MATRIX: PASS (behavior contract complete; repository closure currently 9/12)
ACCEPTANCE_MATRIX: PASS (D0-1..D0-13 — D0-11 v1.83, D0-12/D0-13 v1.86 — expected result cụ thể, grant/RLS trên Postgres thật)
SECURITY_AND_MIGRATION_GATE: PASS (migration D0 expand-only + đúng MỘT CREATE OR REPLACE rotate lock-order-only v1.83: helper KHÔNG grant app/app_worker, wrapper không nhận account_id; rollback = DROP function/table/index mới + revoke grant + restore định nghĩa rotate 0012, không data migration; v1.86: partial index expand-only + issuance fence là app-layer change trong scope D0, zero grant mới)
IMPLEMENTATION_ARTIFACTS: PASS (manifest + acceptance matrix + first step)
FIRST_IMPLEMENTATION_STEP: mở worktree `feat/auth-s4-d0-revoke-core` từ main → viết `packages/db/migrations/0015_auth_revoke_account.sql` (internal `auth_revoke_account_sessions` + public wrapper theo B0 §6.1/§6.2 + partial index v1.86) + mirror schema §9(a) → route `/api/auth/logout-all` + issuance fence `session-cookies.ts` (v1.86) → chạy D0-1..D0-13
REMAINING_BLOCKERS: none
```

**RUN precondition (không phải review blocker):** trước khi mở worktree, merge docs authority (`c1a3957` + `352e6ec`, docs-only nội dung) lên `main` để worktree đọc đúng DD-80/manifest/acceptance từ base — theo flow docs-only của `phase1-fable5-7h-PR-RUN.md`.

## Verdict 4 — `auth-s4-d1-google-adapter` (2026-07-19)

> **Superseded for dependency order by DD-80 v1.88.** A fresh D1 verdict must require both D0a
> `auth-s4-d0-revoke-core` and D0b `auth-s4-d0-session-web-boundary` merged; the historical block below
> remains snapshot evidence only.

<!-- review-verdict: historical -->
```text
REVIEW_VERDICT: PLAN_READY
REVIEWED_AT: 2026-07-19
AUTHORITY_SHA: 352e6ec (feat/session-waitlist-expand)
BASE_BRANCH: main
TARGET_FILES:
  - docs/b0-auth-credential-lifecycle-design-probe.md §2/§4/§4.1/§8.2
  - docs/features/BE/feature_web_auth_onboarding_tech.md (v2.8 §3/§4 + acceptance D1)
  - docs/autopilot-manifests/auth-s4-d1-google-adapter.json
SLICE: auth-s4-d1-google-adapter
IN_SCOPE: auth_oauth_transactions + Lax binding cookie; state/nonce/PKCE + OIDC proof matrix; collision table §4 (8 cell); session issue; auth_login_google nhận preallocated account_emails.id cho cell-1 AAD (v1.86, B0 §3.3/§4)
OUT_OF_SCOPE: email bundle (flag OFF); Facebook (DD-33 external gate); email-change/rebind từ Google claim; auto-merge conflict (→DD-53); Telegram removal
G1_DECISION: PASS
G2_SPEC: PASS
G3_DEPENDENCY: FAIL (prior slice D0 chưa merge main — dep_check `auth_revoke_account_sessions` trong 0015 chưa tồn tại)
G4_TEST: PASS (acceptance D1-1..D1-15)
G5_SCOPE: PASS
G6_EXTERNAL: ENABLEMENT_ONLY:google-oauth-client-config,A3-legal-PII
HARD_DEPENDENCIES: auth-s4-d0-revoke-core + auth-s4-d1-email-token-core = NOT MERGED (order DD-80 §10; oauth migration = 0017)
PRIOR_SLICES: auth-s4-d0-revoke-core → auth-s4-d1-email-token-core
OPEN_QUESTIONS_IN_SCOPE: 0
ENABLEMENT_ONLY_GATES: google-oauth-client-config (config, không đổi dark contract); A3-legal-PII (go-live)
LIVE_REPO_VERIFICATION: PASS
CONTRACT_MATRIX: PASS
ACCEPTANCE_MATRIX: PASS
SECURITY_AND_MIGRATION_GATE: PASS (0016 expand-only; PKCE bytea + KMS key version; không reuse Strict/same-origin cho callback)
IMPLEMENTATION_ARTIFACTS: PASS
FIRST_IMPLEMENTATION_STEP: (blocked bởi G3)
REMAINING_BLOCKERS:
  - blocker: D0 chưa merge main
    owner: auth-s4-d0-revoke-core
    resolution: D0 merged (dep_check 0015::auth_revoke_account_sessions pass)
NEXT_REVIEW_TRIGGER: D0 merge probe pass → re-run closure D1 (kỳ vọng CODE_READY không cần review mới nếu contract không đổi)
```

## Verdict 5a — `auth-s4-d0-revoke-core` / D0a epoch DB core (2026-07-20)

<!-- review-verdict: historical -->
```text
REVIEW_VERDICT: CODE_READY
REVIEWED_AT: 2026-07-20 (re-pinned after authority push)
AUTHORITY_SHA: 033ccc8fd9c3f247abf8aa0cb5a0f48b96d006e2 (v1.88 authority bundle immutable on origin/main)
BASE_BRANCH: main
TARGET_FILES:
  - docs/standards/decisions.md (DD-80 v1.88, committed 033ccc8)
  - docs/g3-revoke-all-concurrency-probe-seed.md (v1.0 final contract)
  - docs/b0-auth-credential-lifecycle-design-probe.md (§6 v1.88)
  - docs/features/BE/feature_web_auth_onboarding_tech.md (v2.10 D0a)
  - docs/autopilot-manifests/auth-s4-d0-revoke-core.json
  - docs/autopilot-backlog.md
SLICE: auth-s4-d0-revoke-core
IN_SCOPE: one atomic 0015; account/session epochs; create/resolve/rotate parent locks and revalidation; revoke helper/wrapper; audit materialization; DB exports/docs/tests
OUT_OF_SCOPE: all apps/web changes; D0b cookie/routes; D1 provider/email; Telegram removal; cache; direct protected-table grants
G1_DECISION: PASS
G2_SPEC: PASS
G3_DEPENDENCY: PASS
G4_TEST: PASS
G5_SCOPE: PASS
G6_EXTERNAL: PASS
HARD_DEPENDENCIES: db-postgres-drizzle-rls + auth-onboarding-v3 merged on main; D0a is the root dependency
PRIOR_SLICES: none
OPEN_QUESTIONS_IN_SCOPE: 0
ENABLEMENT_ONLY_GATES: none
LIVE_REPO_VERIFICATION: PASS (0001/0012/0014 live; 0015/epoch/revoke-all absent as expected)
CONTRACT_MATRIX: PASS
ACCEPTANCE_MATRIX: PASS (D0-1/2/6-11/13 + D0-14..22; deterministic Postgres barriers and exact outcomes)
SECURITY_AND_MIGRATION_GATE: PASS (P0 manual-only; one transactional 0015; equality fail-closed; zero direct grants; forward rollback preserves audit and cannot resurrect materialized revokes)
IMPLEMENTATION_ARTIFACTS: PASS (v1.88 authority + D0a manifest/backlog committed & pushed at origin/main@033ccc8)
FIRST_IMPLEMENTATION_STEP: create a dedicated manual P0 worktree from origin/main@033ccc8, register the D0a manifest (scope-gate), then author one atomic 0015_auth_revoke_account.sql migration + Drizzle mirror + tests
REMAINING_BLOCKERS: none — sole blocker (authority immutability) resolved at origin/main@033ccc8; all G1–G6, closure/contract/acceptance/security gates already PASS
NEXT_REVIEW_TRIGGER: D0a implementation slice (0015 migration + tests) merged to main → re-run for build/test evidence; D0b (Verdict 5b) unblocks only after D0a merge
```

## Verdict 5b — `auth-s4-d0-session-web-boundary` / D0b (2026-07-20)

<!-- review-verdict: historical -->
```text
REVIEW_VERDICT: NOT_CODE_READY
REVIEWED_AT: 2026-07-20
AUTHORITY_SHA: 9c6e5875cf66b153a7ec58b57c424a23e495c999 (live base; v1.88 authority is an uncommitted working-copy delta)
BASE_BRANCH: main
TARGET_FILES:
  - docs/g3-revoke-all-concurrency-probe-seed.md (v1.0 §4.5-§4.6/§7-§8)
  - docs/features/BE/feature_web_auth_onboarding_tech.md (v2.10 D0b)
  - docs/autopilot-manifests/auth-s4-d0-session-web-boundary.json
  - docs/autopilot-backlog.md
SLICE: auth-s4-d0-session-web-boundary
IN_SCOPE: issueSession stale-cookie reject-and-reauth; two live caller mappings/tests; logout-all route/CSRF/cookie clear/tests
OUT_OF_SCOPE: DB schema/migrations/functions/grants; providers; general error framework; tenant APIs; UI
G1_DECISION: PASS
G2_SPEC: PASS
G3_DEPENDENCY: FAIL
G4_TEST: PASS
G5_SCOPE: PASS
G6_EXTERNAL: PASS
HARD_DEPENDENCIES: auth-s4-d0-revoke-core D0a NOT MERGED (dep probes 0015::auth_revoke_all_web_sessions and auth.ts::revokeAllWebSessions absent)
PRIOR_SLICES: auth-s4-d0-revoke-core
OPEN_QUESTIONS_IN_SCOPE: 0
ENABLEMENT_ONLY_GATES: none
LIVE_REPO_VERIFICATION: PASS (current issueSession still fallback-mints; two live callers identified; logout-all route absent)
CONTRACT_MATRIX: PASS
ACCEPTANCE_MATRIX: PASS (D0-3..5/12 + G3-B1..B5)
SECURITY_AND_MIGRATION_GATE: PASS (P0 manual-only; no migration in D0b; account derived server-side; generic errors and redaction pinned)
IMPLEMENTATION_ARTIFACTS: FAIL (manifest/backlog local-only; D0a dependency absent)
FIRST_IMPLEMENTATION_STEP: blocked
REMAINING_BLOCKERS:
  - blocker: D0a DB epoch core is not merged on origin/main.
    owner: auth-s4-d0-revoke-core
    resolution: D0a merged probes pass on origin/main and D0b authority artifacts are committed/pushed.
NEXT_REVIEW_TRIGGER: origin/main contains D0a merged probes; then re-run D0b closure against current callers
```

## Verdict 6 — `auth-s4-d0-session-web-boundary` / D0b implemented & merged (2026-07-22)

<!-- review-verdict: historical -->
```text
REVIEW_POLICY_VERSION: 1.3
REVIEW_VERDICT: CODE_READY
REVIEWED_AT: 2026-07-22
AUTHORITY_SHA: 93c5404c0f59db4ce744568b642b55f52bfa19cf
BASE_BRANCH: main
TARGET_FILES:
  - apps/web/lib/session-cookies.ts
  - apps/web/app/api/auth/logout-all/route.ts
  - apps/web/app/api/auth/telegram/callback/route.ts
  - apps/web/app/api/onboarding/start/route.ts
SLICE: auth-s4-d0-session-web-boundary
IN_SCOPE: issueSession stale-cookie reject-and-reauth fence (SessionReauthRequiredError); typed 401 AUTH_INVALID mapping at the two live callers; POST /api/auth/logout-all with CSRF-before-mutation, server-side account derivation and cookie clear; tests
OUT_OF_SCOPE: DB schema/migrations/functions/grants (D0a owns them); providers; general error framework; tenant APIs; UI; Telegram removal
G1_DECISION: PASS
G2_SPEC: PASS
G3_DEPENDENCY: PASS
G4_TEST: PASS
G5_SCOPE: PASS
G6_EXTERNAL: PASS
HARD_DEPENDENCIES: auth-s4-d0-revoke-core D0a MERGED (main@8f493f7c18627e6730ba9f1f4090ecfe4e389b0f; probes 0015::auth_revoke_all_web_sessions and auth.ts::revokeAllWebSessions present)
PRIOR_SLICES: auth-s4-d0-revoke-core
OPEN_QUESTIONS_IN_SCOPE: 0
ENABLEMENT_ONLY_GATES: none
LIVE_REPO_VERIFICATION: PASS (8 files changed, all apps/web; zero packages/db delta)
CONTRACT_MATRIX: PASS
CLOSURE_MATRIX: PASS (12/12)
ACCEPTANCE_MATRIX: PASS (D0-3/4/5/12 + G3-B1..B5; +13 web tests 65->78, each tagged 1:1; logout-all exercised against a real throwaway Postgres)
SECURITY_AND_MIGRATION_GATE: PASS (no migration; CSRF validated before any mutation; account derived server-side, never from body; no raw token/hash/CSRF/PII in logs or responses; revoked-null branch returns 401 without clearing a possibly freshly rotated cookie)
IMPLEMENTATION_ARTIFACTS: PASS (manifest + acceptance mapping + STOP_AT_READY sentinel)
FIRST_IMPLEMENTATION_STEP: n/a — implemented and squash-merged at main@93c5404
REMAINING_BLOCKERS: none
```

**Đọc verdict:** khác D0a, **gate P0 "2 FULL-base Codex clean rounds liên tiếp" ĐÃ ĐẠT** (round-03/04, chỉ 2 fix round) → merge **không phải owner override**. Hai finding đã fix đều là P2 thật: round-01 (clear cookie ở nhánh `revoked===null` có thể xoá cookie vừa rotate → spurious logout; sửa thành 401-không-clear) và round-02 (test env `??=` với `TELEGRAM_BOT_TOKEN` rỗng làm route trả 503 sớm). Residual đã chấp nhận: nhánh `revoked===null` là race thuần cần 2 connection — semantics đã được test deterministic ở **tầng DB trong D0a** (barrier D0-7/17/18 + regression round-06), web layer chỉ map kết quả.

---

## Verdict 7 — `auth-s4-d1-email-token-core` / D1 order-2 (2026-07-22)

> **Superseded by Verdict 8 (same day):** this block's authorization was consumed — the slice is
> implemented. Kept as the record of what authorized the worktree.

<!-- review-verdict: historical -->
```text
REVIEW_POLICY_VERSION: 1.3
REVIEW_VERDICT: CODE_READY
REVIEWED_AT: 2026-07-22
AUTHORITY_SHA: fc7d0a41b50269a734a9cd74626469e2e9be385b
BASE_BRANCH: main
TARGET_FILES:
  - docs/standards/decisions.md
  - docs/b0-auth-credential-lifecycle-design-probe.md
  - docs/features/BE/feature_web_auth_onboarding_tech.md
  - docs/autopilot-manifests/auth-s4-d1-email-token-core.json
  - packages/db/schema.ts
  - packages/db/src/auth.ts
SLICE: auth-s4-d1-email-token-core
IN_SCOPE: account_emails + email_password_credentials + auth_pending_email_registrations + auth_email_tokens + auth_email_deliveries storage with exact constraints/partial indexes; email normalization/artifact derivation; _auth_assert_password_phc validator + constraint trigger; internal parent-first helper _auth_consume_email_token with the §5.2 lock hierarchy; cleanup/retention; schema.ts mirror + catalog tests; reuse of auth_audit_events created at D0
OUT_OF_SCOPE: public auth_verify_email/auth_reset_password/auth_finalize_email_login (order-4); all email routes/UI; pg-boss enqueue wiring and provider send (order-4, C7 gated); auth_oauth_transactions and Google adapter (order-3); DD-70(a) inbox fence (no global-emitting path exists at order-2); Telegram removal
G1_DECISION: PASS
G2_SPEC: PASS
G3_DEPENDENCY: PASS
G4_TEST: PASS
G5_SCOPE: PASS
G6_EXTERNAL: ENABLEMENT_ONLY:C7-email-provider,A3-legal-PII
HARD_DEPENDENCIES: auth-s4-d0-revoke-core MERGED (main@8f493f7) + auth-s4-d0-session-web-boundary MERGED (main@93c5404); dep probes 0015::auth_revoke_account_sessions and logout-all/route.ts::revokeAllWebSessions present on origin/main
PRIOR_SLICES: auth-s4-d0-revoke-core -> auth-s4-d0-session-web-boundary
OPEN_QUESTIONS_IN_SCOPE: 0
ENABLEMENT_ONLY_GATES: C7 email-provider idempotency/DPA proof (blocks order-4 delivery + flag ON, not this dark core); A3 legal-PII (go-live)
LIVE_REPO_VERIFICATION: PASS (migration tail on main is 0015 so 0016 is monotonic; auth_audit_events exists from 0015 and is reused not recreated; link_codes/merge_audit exist from 0001 so the merge-barrier case is testable; none of the five email tables exist yet)
CONTRACT_MATRIX: PASS
CLOSURE_MATRIX: PASS (12/12)
ACCEPTANCE_MATRIX: PASS (D1E-1..D1E-22 authored 2026-07-22 in feature_web_auth_onboarding_tech.md §5, each with an exact expected result; includes the two cases the manifest names as READY preconditions — D1E-17 reset-vs-consume and D1E-18 merge barrier — both on real PostgreSQL with deterministic barriers)
SECURITY_AND_MIGRATION_GATE: PASS (single transactional expand-only 0016; zero direct app grant on PHC columns or internal helpers; PHC shape owned by one validator + constraint trigger on both write paths; parent-first lock hierarchy with no child-first path; fail-closed consume with no row-existence disclosure; no raw email/token/PHC/ciphertext in logs or returns; rollback = DROP the new tables/indexes/functions/trigger, auth_audit_events untouched because D0 owns it)
IMPLEMENTATION_ARTIFACTS: PASS (manifest with binding negative_scope + acceptance matrix D1E-1..D1E-22 + first implementation step)
FIRST_IMPLEMENTATION_STEP: open a manual P0 worktree from origin/main, register the D1 email-token manifest via scope-gate, then author one atomic 0016_account_email_token_core.sql (five tables + constraints + partial indexes + _auth_assert_password_phc + constraint trigger + _auth_consume_email_token + cleanup) with the matching schema.ts mirror, then run D1E-1..D1E-22
REMAINING_BLOCKERS: none
NEXT_REVIEW_TRIGGER: D1 email-token-core merged on origin/main -> re-run closure for auth-s4-d1-google-adapter (order-3), whose Verdict 4 currently fails G3 on this dependency
```

**Đọc verdict:** slice này trước đó **không có acceptance matrix và không có verdict** — đó là lý do nó bị chặn ở lượt review 2026-07-22. Cả hai artifact nay đã author từ authority owner-approved (DD-80 v1.88 + B0 §3/§5/§8.1/§9 + §10 order-2), nên G2/G4/IMPLEMENTATION_ARTIFACTS chuyển PASS. Hai ranh giới quan trọng được pin để tránh scope creep: (1) public verify/reset/login function và mọi route thuộc **order-4**, không phải slice này; (2) **DD-70(a) inbox fence không áp dụng** vì order-2 không có path phát global notification — fence chỉ xuất hiện ở producer `security_alert`/`identity_merged` của order-4.

---

## Verdict 8 — `auth-s4-d1-email-token-core` implemented, awaiting manual merge (2026-07-22)

<!-- review-verdict: historical -->
```text
REVIEW_POLICY_VERSION: 1.3
REVIEW_VERDICT: CODE_READY
REVIEWED_AT: 2026-07-22
AUTHORITY_SHA: 1dacd6e
BASE_BRANCH: main
TARGET_FILES:
  - docs/features/BE/feature_web_auth_onboarding_tech.md
  - docs/autopilot-manifests/auth-s4-d1-email-token-core.json
  - packages/db/schema.ts
  - packages/db/src/auth.ts
SLICE: auth-s4-d1-email-token-core
IN_SCOPE: one atomic 0016 with five function-only tables + constraints/partial indexes; _auth_assert_password_phc + trigger on both write paths; _auth_consume_email_token parent-first; five deadlock-free cleanup functions; schema.ts mirror; auth.ts helpers; index.ts export; README inventory
OUT_OF_SCOPE: public verify/reset/login functions, routes, provider send, pg-boss enqueue, oauth/Google, DD-70(a) fence, Telegram removal
G1_DECISION: PASS
G2_SPEC: PASS
G3_DEPENDENCY: PASS
G4_TEST: PASS
G5_SCOPE: PASS
G6_EXTERNAL: ENABLEMENT_ONLY:C7-email-provider,A3-legal-PII
HARD_DEPENDENCIES: D0a MERGED (main@8f493f7) + D0b MERGED (main@93c5404)
PRIOR_SLICES: auth-s4-d0-revoke-core -> auth-s4-d0-session-web-boundary
OPEN_QUESTIONS_IN_SCOPE: 0
ENABLEMENT_ONLY_GATES: C7 email-provider (blocks order-4 delivery, not this dark core); A3 legal-PII (go-live)
LIVE_REPO_VERIFICATION: PASS (7 files, +2555/-7; auth_audit_events reused from 0015 not recreated; zero app grant on the new tables/helpers)
CONTRACT_MATRIX: PASS
CLOSURE_MATRIX: PASS (12/12)
ACCEPTANCE_MATRIX: PASS (D1E-1..D1E-17 + D1E-18a + D1E-19..D1E-22 all covered by executable tests; 128 real-PostgreSQL tests green. D1E-18 was SPLIT during this review: the order-2 half D1E-18a is proven; D1E-18b is DEFERRED-BY-CONSTRUCTION, not a coverage gap, because live link_codes is person/channel-scoped and the account-issued link_code + merge-plan mutation is order-4)
SECURITY_AND_MIGRATION_GATE: PASS (single atomic expand-only 0016; PHC parsed in full with policy floor==ceiling and integer-overflow guard; no numeric or internal value leaked in error text per D1E-22; cleanup split into per-transaction bounded ascending passes to stay deadlock-free; zero app grant)
IMPLEMENTATION_ARTIFACTS: PASS (manifest amended for the two scope additions; acceptance matrix updated for the D1E-18 split)
FIRST_IMPLEMENTATION_STEP: n/a — implemented on feat/auth-s4-d1-email-token-core@9abecd9, STOP_AT_READY, awaiting owner squash-merge
REMAINING_BLOCKERS: none
NEXT_REVIEW_TRIGGER: order-4 identity companion landing account-issued link_code + merge plan MUST run the full both-sides D1E-18b barrier against _auth_consume_email_token before that slice can be CODE_READY
```

**Đọc verdict — cách gate được đóng, ghi minh bạch để không bị đọc nhầm là 2×clean:** Codex chạy **9 vòng** và hội tụ rõ (5→4→4→5→2→2→1→**sạch round-08**→1 ở round-09, đã fix). Core sạch liên tục từ round-06. Vì reviewer rơi vào chế độ **phi tất định** trên một migration lớn — mỗi vòng lòi đúng một P2 *khác nhau*, ngày càng hiếm — nên "2 vòng sạch liên tiếp" có thể không hội tụ **dù code đã đúng**. Owner chọn đóng bằng **1 vòng sạch + chứng thực độc lập có định hướng** (2nd-agent đối kháng trên toàn diff + grants, verdict CLEAN), cộng 128 test PostgreSQL thật, typecheck ×4 và toàn bộ finding 9 vòng đã fix kèm regression test. **Đây là override thứ hai trên ba slice** (D0a override, D0b đạt gate, D1 override) — tỷ lệ đó là bằng chứng luật 2×clean **miscalibrate với diff migration lớn**, không phải chất lượng kém; xem đề xuất hiệu chỉnh ở changelog.

**Hai scope-addition đã hợp thức hoá trong manifest** (không phải scope creep): `packages/db/src/index.ts` (export barrel, đúng precedent D0a v1.83) và `packages/db/README.md` (B0 §9 mục 4 bắt buộc cập nhật inventory nhưng manifest gốc bỏ sót).

---

## Verdict 9 — `auth-s4-d1-google-adapter` / D1 order-3 (2026-07-22)

```text
REVIEW_POLICY_VERSION: 1.3
REVIEW_VERDICT: CODE_READY
REVIEWED_AT: 2026-07-22
AUTHORITY_SHA: 8f6a0515e95e69ee4f911281d6c5e5d218eb4d9b
BASE_BRANCH: main
TARGET_FILES:
  - docs/standards/decisions.md
  - docs/b0-auth-credential-lifecycle-design-probe.md
  - docs/features/BE/feature_web_auth_onboarding_tech.md
  - docs/autopilot-manifests/auth-s4-d1-google-adapter.json
  - packages/db/src/auth.ts
  - apps/web/lib/session-cookies.ts
SLICE: auth-s4-d1-google-adapter
IN_SCOPE: auth_oauth_transactions (migration 0017) + path-scoped Lax binding cookie; state/nonce/PKCE issue and claim; OIDC proof matrix; the §4 identity/email collision table; session issue via the per-lane Google finalizer; auth_login_google taking the app-preallocated account_emails.id for the cell-1 AAD (v1.86)
OUT_OF_SCOPE: email register/verify/login/forgot/reset endpoints (order-4 bundle, flag OFF); Facebook adapter (DD-33 external gate; routes keep AUTH_PROVIDER_UNAVAILABLE); email-change/rebind from Google claims; auto-merge on identity conflict (-> DD-53); reuse of sameOriginRequest()/Strict callback cookie from the Telegram flow; Telegram route removal
G1_DECISION: PASS
G2_SPEC: PASS
G3_DEPENDENCY: PASS
G4_TEST: PASS
G5_SCOPE: PASS
G6_EXTERNAL: ENABLEMENT_ONLY:google-oauth-client-config,A3-legal-PII
HARD_DEPENDENCIES: all three merged on origin/main and probed live at 8f6a051 — auth-s4-d0-revoke-core (0015::auth_revoke_account_sessions), auth-s4-d0-session-web-boundary (logout-all/route.ts::revokeAllWebSessions), auth-s4-d1-email-token-core (0016::account_emails)
PRIOR_SLICES: auth-s4-d0-revoke-core -> auth-s4-d0-session-web-boundary -> auth-s4-d1-email-token-core
OPEN_QUESTIONS_IN_SCOPE: 0
ENABLEMENT_ONLY_GATES: google-oauth-client-config (client id/secret via KMS/env — config only, does not change the dark contract); A3-legal-PII (go-live)
LIVE_REPO_VERIFICATION: PASS (migration tail is 0016 so 0017 is monotonic; auth_oauth_transactions absent as expected — its only mention in 0016 is a negative-scope comment; account_emails / auth_pending_email_registrations / email_password_credentials all live from 0016, so every collision cell in D1-6..D1-10 is now constructible; deriveEmailArtifacts already takes the preallocated accountEmailId, so the v1.86 cell-1 AAD handoff needs no new contract)
CONTRACT_MATRIX: PASS
CLOSURE_MATRIX: PASS (12/12)
ACCEPTANCE_MATRIX: PASS (D1-1..D1-15, authored earlier and RE-VERIFIED at this SHA against the now-live schema rather than assumed — the D1E-18 miss on the previous slice came from trusting a matrix row whose precondition did not exist)
SECURITY_AND_MIGRATION_GATE: PASS (0017 expand-only; PKCE stored as bytea with a separate key-version column; Lax path-scoped binding cookie is distinct from the Strict session cookie and must not reuse sameOriginRequest(); independent oauth-state and oauth-callback rate buckets; identity conflict fails closed to AUTH_IDENTITY_CONFLICT with no session minted)
IMPLEMENTATION_ARTIFACTS: PASS (manifest + acceptance matrix + first step)
FIRST_IMPLEMENTATION_STEP: open a manual P0 worktree from origin/main@8f6a051, register the google-adapter manifest via scope-gate, then author 0017_oauth_transactions.sql + the Drizzle mirror, then the OIDC verify/state/callback layer, then run D1-1..D1-15
REMAINING_BLOCKERS: none
NEXT_REVIEW_TRIGGER: google-adapter merged -> order-4 email-credential-lifecycle bundle, which additionally inherits the D1E-18b both-sides merge-barrier obligation and the C7 provider gate
```

**Đọc verdict:** Verdict 4 (19/07) cho slice này là `PLAN_READY` và **fail G3** vì D0 chưa merge; nó cũng bị DD-80 v1.88 supersede về dependency order. Nay cả ba dependency đã merge và **probe live tại `8f6a051`**, nên G3 chuyển PASS. Khác với slice trước, acceptance matrix **không phải author mới** — D1-1..D1-15 đã có sẵn; công việc review ở đây là **kiểm lại từng precondition có tồn tại thật trên schema live hay không**, đúng bài học từ lỗi D1E-18 (một hàng matrix giả định `account-issued link_code` vốn chưa tồn tại). Kết quả: mọi cell collision D1-6..D1-10 nay dựng được, và AAD handoff v1.86 đã có sẵn API (`deriveEmailArtifacts(raw, accountEmailId, keys)`).

---

## Verdict 10 — `auth-s4-d1-google-adapter` implemented, awaiting manual merge (2026-07-22)

<!-- review-verdict: historical -->
```text
REVIEW_POLICY_VERSION: 1.3
REVIEW_VERDICT: CODE_READY
REVIEWED_AT: 2026-07-22
AUTHORITY_SHA: 23a37abc32c4277a0b2370db7f3ddf7d80f488bc
BASE_BRANCH: main
TARGET_FILES:
  - docs/features/BE/feature_web_auth_onboarding_tech.md
  - docs/autopilot-manifests/auth-s4-d1-google-adapter.json
  - packages/db/schema.ts
  - apps/web/lib/session-cookies.ts
SLICE: auth-s4-d1-google-adapter
IN_SCOPE: migration 0017 auth_oauth_transactions (PKCE ciphertext bytea + own key version, google lifecycle CHECK, issue/claim single-use); google-oidc proof matrix (sig/iss/aud/azp/exp/iat/nonce/email_verified + maxTokenAge + timeout); oauth-transaction lib (PKCE S256, AES-256-GCM verifier AEAD, HKDF key, Lax path-scoped cookie); /api/auth/google/{state,callback}; auth_login_google per-lane finalizer with the §4 collision table
OUT_OF_SCOPE: session rotation of a pre-existing Strict cookie (see accepted residual risk); email bundle order-4; Facebook; Telegram removal; email-change/rebind from Google claims; auto-merge on identity conflict
G1_DECISION: PASS
G2_SPEC: PASS
G3_DEPENDENCY: PASS
G4_TEST: PASS
G5_SCOPE: PASS
G6_EXTERNAL: ENABLEMENT_ONLY:google-oauth-client-config,A3-legal-PII,auth-s4-d1b-oauth-session-rotation
HARD_DEPENDENCIES: D0a 8f493f7 + D0b 93c5404 + D1 email-token-core 64fb4d3, all merged and probed live
PRIOR_SLICES: auth-s4-d0-revoke-core -> auth-s4-d0-session-web-boundary -> auth-s4-d1-email-token-core
OPEN_QUESTIONS_IN_SCOPE: 0
ENABLEMENT_ONLY_GATES: google-oauth-client-config (config only); A3-legal-PII (go-live); auth-s4-d1b-oauth-session-rotation (HARD blocker on setting GOOGLE_OAUTH_CLIENT_ID/SECRET in ANY environment)
LIVE_REPO_VERIFICATION: PASS (17 files, +2841/-9; migration tail was 0016 so 0017 is monotonic; /api/auth/google/state returns 503 with config absent and .env.example ships the keys EMPTY, so Google login is not enabled anywhere and the residual risk below is not live; manifest scope reconciled at READY with a _scope_note for rls-invariants.test.ts, coupled by the migration-count assertion)
CONTRACT_MATRIX: PASS
CLOSURE_MATRIX: PASS (12/12)
ACCEPTANCE_MATRIX: PASS (D1-1..D1-15; full real-PG suite db 144 · core 111 · bot 3 · web 131, 0 skipped; semgrep 0 findings; OSV clean after adding jose@5)
SECURITY_AND_MIGRATION_GATE: PASS (0017 expand-only; PKCE verifier held as AES-256-GCM ciphertext with a separate key version; Lax path-scoped binding cookie kept distinct from the Strict session cookie and sameOriginRequest() deliberately NOT reused; independent oauth-state / oauth-callback buckets, limiter fail-closed; identity conflict fails closed to AUTH_IDENTITY_CONFLICT with no session minted; cell-8 proof failure rejects before touching the DB and writes no audit row)
IMPLEMENTATION_ARTIFACTS: PASS (manifest reconciled + acceptance matrix + residual risk pinned in three durable places)
FIRST_IMPLEMENTATION_STEP: n/a — implemented on feat/auth-s4-d1-google-adapter@75bfa58, STOP_AT_READY, awaiting owner squash-merge
REMAINING_BLOCKERS: none for merge
NEXT_REVIEW_TRIGGER: auth-s4-d1b-oauth-session-rotation must be authored, verdicted and merged BEFORE Google login is enabled in any environment; separately, order-4 email bundle inherits the D1E-18b merge-barrier obligation and the C7 provider gate
```

**ACCEPTED RESIDUAL RISK — đọc kỹ, đây không phải "matrix xanh nên không còn gap":** cookie session `SameSite=Strict` **không được gửi** trên callback OAuth cross-site, nên callback không đọc/rotate/revoke được session cũ. D1 vì thế **mint-fresh** (đúng matrix D1-2 + D1-13), và hệ quả là **một session có trước khi login Google vẫn sống sót, không bị vô hiệu hoá** — kẻ tấn công nắm token cũ đó vẫn giữ được nó.

**Vì sao chấp nhận thay vì sửa trong slice này:** phần rotation từng được thử và là **invented scope** ngoài matrix; nó **non-atomic**, **đua với logout-all** (đẻ ra P1 mới ở round-06) và vẫn hụt khi `/state` bị vào cross-site. Findings nở 1→3→4 qua các vòng là tín hiệu **sai tầng**, không phải code ẩu: primitive rotate atomic nằm ở tầng D0/session, nên lời giải đúng là **same-site completion hop** ở đó — chống lại một bất biến của trình duyệt ngay trong OAuth adapter thì không thể atomic.

**Rủi ro này KHÔNG live** vì Google login fail-closed 503 khi thiếu config và `.env.example` để trống key. Điều kiện đóng được pin **cưỡng chế được, không phải "slice kế tiếp"**: `auth-s4-d1b-oauth-session-rotation` **phải land TRƯỚC khi set `GOOGLE_OAUTH_CLIENT_ID/SECRET` ở bất kỳ môi trường nào** — ghi bền ở ba nơi (manifest `enablement_gates`, `.env.example` ngay trên hai biến đó, tech doc §4 Session Security).

---

## Verdict 11 — `auth-s4-d1b-oauth-session-rotation` (2026-07-22)

> **Superseded by Verdict 12 (same day):** the sole blocker — an unpinned hop mechanism — was closed by
> measurement, not argument. Kept as the record of why the slice was held.

<!-- review-verdict: historical -->
```text
REVIEW_POLICY_VERSION: 1.3
REVIEW_VERDICT: NOT_CODE_READY
REVIEWED_AT: 2026-07-22
AUTHORITY_SHA: 79430d32751853923b02caddf44f5d4504e6b872
BASE_BRANCH: main
TARGET_FILES:
  - docs/features/BE/feature_web_auth_onboarding_tech.md
  - docs/autopilot-manifests/auth-s4-d1b-oauth-session-rotation.json
  - apps/web/lib/session-cookies.ts
  - apps/web/app/api/auth/google/callback/route.ts
SLICE: auth-s4-d1b-oauth-session-rotation
IN_SCOPE: same-site completion hop so issueSession() runs where the Strict cookie is present and takes its EXISTING rotate branch; single-use short-TTL handoff bound to the oauth transaction; callback stops minting directly
OUT_OF_SCOPE: any new rotate primitive (D0a's auth_rotate_web_session is reused as-is); re-litigating the D1 mint-fresh contract; the rejected capture-at-/state + revoke-at-callback workaround; weakening SameSite=Strict; email bundle order-4; Facebook; Telegram removal
G1_DECISION: PASS
G2_SPEC: PARTIAL
G3_DEPENDENCY: PASS
G4_TEST: PASS
G5_SCOPE: PASS
G6_EXTERNAL: PASS
HARD_DEPENDENCIES: auth-s4-d1-google-adapter MERGED (main@c6edbfa; 0017::auth_oauth_transactions and google/callback/route.ts::issueSession both live)
PRIOR_SLICES: auth-s4-d0-revoke-core -> auth-s4-d0-session-web-boundary -> auth-s4-d1-email-token-core -> auth-s4-d1-google-adapter
OPEN_QUESTIONS_IN_SCOPE: 1
ENABLEMENT_ONLY_GATES: none — this slice IS itself the blocker on enabling Google login
LIVE_REPO_VERIFICATION: PASS (issueSession already branches rotate-vs-create on cookie presence and already throws SessionReauthRequiredError when rotate returns null, so NO new primitive is needed; the cross-site callback simply never sees the cookie. auth_rotate_web_session in 0015 takes old/new token hash + csrf + ttl + account and does the parent-locked epoch-revalidated swap in one transaction)
CONTRACT_MATRIX: PARTIAL
CLOSURE_MATRIX: FAIL (11/12 — mechanism unpinned)
ACCEPTANCE_MATRIX: PASS (D1B-1..D1B-10 authored 2026-07-22, but D1B-2 cannot be satisfied until the blocker below is resolved)
SECURITY_AND_MIGRATION_GATE: PASS (no migration; no new grant; reuses the proven D0a primitive and the D0b reject-and-reauth fence)
IMPLEMENTATION_ARTIFACTS: PASS (manifest + acceptance matrix)
FIRST_IMPLEMENTATION_STEP: (blocked)
REMAINING_BLOCKERS:
  - blocker: the completion-hop MECHANISM is not pinned. A plain 302 from the cross-site callback to a same-origin route is NOT sufficient evidence — whether a SameSite=Strict cookie is sent on a redirect chain that STARTED cross-site is browser-divergent. Pick the wrong mechanism and the slice silently fixes nothing (cookie still absent, still mint-fresh) while every mocked unit test stays green.
    owner: owner (design decision) -> mình (write it up as a DD/probe note)
    resolution: a design probe that pins ONE mechanism and shows, on the target browser matrix, that plx_session is actually present at the completion endpoint after a real Google round-trip. Candidate to evaluate first: the callback returns a first-party document that performs a document-initiated same-site navigation, rather than relying on a server redirect chain.
NEXT_REVIEW_TRIGGER: hop mechanism pinned with real-browser evidence -> re-run closure; expected CODE_READY without further contract changes since D1B-1..D1B-10 already cover the behavior
```

**Đọc verdict — vì sao KHÔNG rubber-stamp CODE_READY:** slice này về mặt code là nhỏ và không cần primitive mới — `issueSession()` **đã** có nhánh rotate đúng, `auth_rotate_web_session` **đã** atomic và đã qua barrier test ở D0a. Nhưng toàn bộ giá trị của slice nằm ở **một giả định chưa ai chứng minh**: rằng cơ chế hop được chọn thực sự khiến trình duyệt gửi cookie `SameSite=Strict`. Đây là hành vi **phân kỳ giữa các trình duyệt** với chuỗi redirect khởi phát cross-site. Nếu sai, slice **âm thầm vô dụng** — vẫn không thấy cookie, vẫn mint-fresh, residual risk vẫn nguyên — mà **mọi unit test mock vẫn xanh** và ta sẽ tưởng đã đóng gate rồi bật Google login. Đó là kịch bản tệ nhất có thể, nên `OPEN_QUESTIONS_IN_SCOPE: 1` và verdict là `NOT_CODE_READY`. Blocker rẻ: một probe pin đúng một cơ chế + bằng chứng trên trình duyệt thật.

---

## Verdict 12 — `auth-s4-d1b-oauth-session-rotation`, hop mechanism pinned (2026-07-22)

```text
REVIEW_POLICY_VERSION: 1.3
REVIEW_VERDICT: CODE_READY
REVIEWED_AT: 2026-07-22
AUTHORITY_SHA: fa94e3b072afe123ab64a2377e6be353ba1a5d34
BASE_BRANCH: main
TARGET_FILES:
  - docs/probe-strict-cookie-completion-hop.md
  - docs/features/BE/feature_web_auth_onboarding_tech.md
  - docs/autopilot-manifests/auth-s4-d1b-oauth-session-rotation.json
  - apps/web/lib/session-cookies.ts
SLICE: auth-s4-d1b-oauth-session-rotation
IN_SCOPE: M3 completion hop — callback returns a first-party non-mutating landing that auto-submits a same-origin POST to a completion endpoint (noscript Continue fallback); single-use short-TTL handoff bound to the oauth transaction; completion endpoint runs the EXISTING issueSession() so it takes its existing rotate branch
OUT_OF_SCOPE: any new rotate primitive; re-litigating D1 mint-fresh; the rejected capture-at-/state workaround; weakening SameSite=Strict; harmonising this auto-submit with the §8.4 email two-hop, which deliberately requires a user gesture
G1_DECISION: PASS
G2_SPEC: PASS
G3_DEPENDENCY: PASS
G4_TEST: PASS
G5_SCOPE: PASS
G6_EXTERNAL: ENABLEMENT_ONLY:safari-macos-and-ios-strict-hop-evidence
HARD_DEPENDENCIES: auth-s4-d1-google-adapter MERGED (main@c6edbfa)
PRIOR_SLICES: auth-s4-d0-revoke-core -> auth-s4-d0-session-web-boundary -> auth-s4-d1-email-token-core -> auth-s4-d1-google-adapter
OPEN_QUESTIONS_IN_SCOPE: 0
ENABLEMENT_ONLY_GATES: safari-macos-and-ios-strict-hop-evidence — Safari and iOS Safari were NOT measured (Playwright ships a frozen WebKit build, not shipped Safari). This does not change what the code should be, so it does not block CODE_READY, but it DOES remain part of the gate on enabling Google login: if shipped Safari were to withhold the Strict cookie on M3, Safari users would silently keep the residual risk. Manual steps are in probe §7.
LIVE_REPO_VERIFICATION: PASS (issueSession already branches rotate-vs-create and already throws SessionReauthRequiredError on rotate-null; auth_rotate_web_session in 0015 is the atomic parent-locked epoch-revalidated swap; no new primitive required)
CONTRACT_MATRIX: PASS
CLOSURE_MATRIX: PASS (12/12)
ACCEPTANCE_MATRIX: PASS (D1B-1..D1B-11; D1B-2 satisfied by measured 3-engine evidence, D1B-11 added as the structural anti-regression net)
SECURITY_AND_MIGRATION_GATE: PASS (POST hop carries Origin so the existing sameOriginRequest() guards the mutating step independently of cookie semantics; reuses the D0b reject-and-reauth fence; no new grant. CORRECTED 2026-07-22 — an earlier revision of this block claimed "no migration", which was premature: with M3 the callback can no longer call issueSession(), so the account it resolved must reach the completion endpoint, and auth_oauth_transactions has no column for it. Either shape is acceptable and both are expand-only — see handoff_persistence in the manifest — but single-use MUST be enforced by a durable server-side fence, never by a cookie signature alone)
IMPLEMENTATION_ARTIFACTS: PASS (probe doc + manifest + acceptance matrix)
FIRST_IMPLEMENTATION_STEP: open a manual P0 worktree from origin/main, register the d1b manifest, then replace the callback's direct issueSession() call with handoff + first-party landing (M3), add the completion route running issueSession(), then run D1B-1..D1B-11
REMAINING_BLOCKERS: none
NEXT_REVIEW_TRIGGER: d1b merged AND Safari/iOS cells measured -> only then may GOOGLE_OAUTH_CLIENT_ID/SECRET be set in any environment
```

**Đọc verdict — blocker được đóng bằng ĐO, không bằng lập luận.** Verdict 11 giữ slice lại vì cơ chế hop chưa pin. Probe (`../probe-strict-cookie-completion-hop.md`) chạy harness hai site thật trên Chromium 149 · Firefox 151 · WebKit 26.5 và cho kết quả **quan trọng**: **M1 — 302 trần — KHÔNG mang cookie `Strict` trên cả ba engine.** Đó chính xác là cơ chế mà một implementer sẽ mặc định chọn; nếu không probe, d1b đã ship một fix **vô dụng thầm lặng** (vẫn mint-fresh, residual risk nguyên vẹn) trong khi mọi unit test mock cookie vẫn xanh. Control của probe (`None`/`Lax` tới được mọi hop, `Strict` vắng **đúng** tại callback cross-site) chứng minh harness trung thực chứ không phải artefact.

**Safari/iOS được phân loại là ENABLEMENT_ONLY, không phải open question.** Lý do: nó không đổi *code nên viết thế nào* — M3 là lựa chọn đúng bất kể Safari trả lời gì, vì 4/5 cơ chế thắng trên 3 engine và M1 thua ở mọi nơi. Nhưng nó **vẫn thuộc gate bật Google login**: nếu Safari bản ship giữ lại cookie ở M3 thì người dùng Safari âm thầm vẫn dính residual risk. Vì vậy điều kiện bật là **d1b merged VÀ Safari/iOS đã đo**, không phải chỉ merged.

---

## Verdict 13 — `auth-s4-d1b-oauth-session-rotation` implemented, awaiting manual merge (2026-07-22)

> **Enablement-gate closure (2026-07-26) — áp cho cả Verdict 12 và 13.** Hai block dưới đây ghi
> `ENABLEMENT_ONLY:safari-macos-and-ios-strict-hop-evidence` là **đúng tại ngày pin của chúng**; giữ nguyên,
> không sửa. Nghĩa vụ đo đó nay **đã hoàn thành**: Safari macOS (macOS 14.5, "Prevent cross-site tracking"
> mặc định ON) và iOS Safari **18.3 (22D8075)** đều đã đo tay ngày 2026-07-26 theo probe §7. Kết quả khớp
> hoàn toàn Chromium 149 / Firefox 151 / WebKit 26.5: `M1` giữ lại `Strict`, còn `M2`/`M3`/`M4`/`M5` đều
> mang được — **`M3`, cơ chế đã ship, PASS trên cả hai**. Control toàn vẹn ở cả hai nền: mọi dòng
> `stage=callback` của M1–M5 đều `strict=false`, chứng minh chặng quay về thật sự cross-site.
> Bằng chứng: `../probe-strict-cookie-completion-hop.md` §3.1 · §7 · §8.
>
> Hệ quả: gate này **không còn nghĩa vụ đo nào**. Việc set `GOOGLE_OAUTH_CLIENT_ID/SECRET` từ đây là một
> **quyết định go-live của owner**, không phải một blocker kỹ thuật. Các gate khác gắn vào go-live (vd A3
> legal/PII) đứng độc lập và **không** được coi là đã đóng theo mục này.

<!-- review-verdict: historical -->
```text
REVIEW_POLICY_VERSION: 1.3
REVIEW_VERDICT: CODE_READY
REVIEWED_AT: 2026-07-22
AUTHORITY_SHA: 7999357bb4c5564e1928b74f625e1fb9672ee379
BASE_BRANCH: main
TARGET_FILES:
  - docs/features/BE/feature_web_auth_onboarding_tech.md
  - docs/autopilot-manifests/auth-s4-d1b-oauth-session-rotation.json
  - docs/probe-strict-cookie-completion-hop.md
  - packages/db/schema.ts
SLICE: auth-s4-d1b-oauth-session-rotation
IN_SCOPE: M3 completion hop (callback returns a first-party non-mutating landing that auto-submits a same-origin POST; noscript Continue fallback); migration 0018 expand-only adding resolved_account_id + handoff_hash + handoff_expires_at + handoff_consumed_at to auth_oauth_transactions plus auth_oauth_handoff_arm/_consume; completion route running the EXISTING issueSession()
OUT_OF_SCOPE: new rotate primitive; re-litigating D1 mint-fresh; capture-at-/state; weakening SameSite=Strict; harmonising with the §8.4 gesture flow
G1_DECISION: PASS
G2_SPEC: PASS
G3_DEPENDENCY: PASS
G4_TEST: PASS
G5_SCOPE: PASS
G6_EXTERNAL: ENABLEMENT_ONLY:safari-macos-and-ios-strict-hop-evidence
HARD_DEPENDENCIES: auth-s4-d1-google-adapter MERGED (main@c6edbfa)
PRIOR_SLICES: auth-s4-d0-revoke-core -> auth-s4-d0-session-web-boundary -> auth-s4-d1-email-token-core -> auth-s4-d1-google-adapter
OPEN_QUESTIONS_IN_SCOPE: 0
ENABLEMENT_ONLY_GATES: safari-macos-and-ios-strict-hop-evidence — still unmeasured; enabling Google login requires this slice merged AND those cells measured (probe §7)
LIVE_REPO_VERIFICATION: PASS (14 files, +984/-68, all within the amended manifest scope plus the two reconciled additions index.ts and rls-invariants.test.ts, both with a _scope_note per the D0a/D1 precedent. Handoff shape (a) chosen: consume is a single atomic UPDATE ... WHERE handoff_consumed_at IS NULL AND handoff_expires_at > clock_timestamp() RETURNING resolved_account_id, so concurrent losers get NULL; the partial UNIQUE index keeps the hash after consume so it can never be reused; clock_timestamp() not frozen now(), carrying the D0a round-09 lesson forward. sameOriginRequest() is genuinely called before the mutating step, so the stated reason for choosing M3 over M2 is realised in code, not just in prose. consume commits before issueSession, so an interrupted hop fails toward "old session survives intact" — the safe direction for D1B-9)
CONTRACT_MATRIX: PASS
CLOSURE_MATRIX: PASS (12/12)
ACCEPTANCE_MATRIX: PASS (D1B-1..D1B-11; real-PG suite db 152 · core 111 · bot 3 · web 146, 0 skipped)
SECURITY_AND_MIGRATION_GATE: PASS (0018 expand-only; handoff token rides the POST body and only its sha256 is stored — no handoff cookie at all; single-use enforced by a durable server-side fence, not a signature; internal functions REVOKEd from PUBLIC with EXECUTE granted only to app; redirect leaks no referrer)
IMPLEMENTATION_ARTIFACTS: PASS
FIRST_IMPLEMENTATION_STEP: n/a — implemented on feat/auth-s4-d1b-oauth-session-rotation@04df464, STOP_AT_READY
REMAINING_BLOCKERS: none for merge
NEXT_REVIEW_TRIGGER: Safari/iOS cells measured -> only then may GOOGLE_OAUTH_CLIENT_ID/SECRET be set
```

**Đọc verdict — và một phát hiện về quy trình đáng ghi hơn cả slice này.** Đây là slice đầu tiên đạt **2 vòng Codex sạch liên tiếp ngay lần đầu, `fix-round-count = 0`, regions rỗng**. So sánh trực tiếp: D0a **12 vòng**, D1 email-token **9 vòng**, D1 google-adapter **6 vòng**. Mà d1b **không hề đơn giản hơn** — 14 file, một migration, hàm SECURITY DEFINER, barrier test hai connection với logout-all.

Điểm khác biệt không phải kích thước diff mà là **thiết kế đã đứng yên trước khi code**: cơ chế hop được **đo** chứ không giả định (probe bác bỏ M1 — chính là thứ implementer sẽ chọn theo bản năng), acceptance D1B-1..11 viết xong trước, và quyết định còn lại duy nhất (handoff persistence) được khoanh sẵn thành hai hình dạng chấp nhận được kèm ràng buộc bắt buộc.

**Điều này sửa lại khuyến nghị của chính mình ở changelog v1.2.** Lúc đó mình cho rằng luật "2 vòng sạch" bị miscalibrate với diff lớn và đề xuất nới. Bằng chứng d1b nói ngược lại: luật không sai — **thrash là triệu chứng của việc authorize code khi thiết kế còn đang chuyển động**. D0a thrash vì DD-80 tự sửa v1.83→v1.86→v1.88 **giữa lúc đang code**; D1 email-token vì một hàng acceptance mã hoá một tiền đề không tồn tại. Cách chữa không phải nới gate, mà chính là kỷ luật probe/verdict vừa dùng ở đây. **Đề xuất nới luật ở v1.2 nên rút lại.**

---

## Verdict 14 — `db-migration-0000-idempotent-role-create`, re-scoped (2026-07-22)

```text
REVIEW_POLICY_VERSION: 1.3
REVIEW_VERDICT: CODE_READY
REVIEWED_AT: 2026-07-22
AUTHORITY_SHA: e61d96c42a9ee5b0b12424bd052813b10712a7ee
BASE_BRANCH: main
TARGET_FILES:
  - docs/autopilot-manifests/db-migration-0000-idempotent-role-create.json
  - packages/db/src/migrate.ts
  - packages/db/src/test-harness.ts
  - packages/db/vitest.config.ts
  - packages/db/migrations/0000_roles_extensions.sql
SLICE: db-migration-0000-idempotent-role-create
IN_SCOPE: runner-level exception-handled role-ensure in migrate.ts gated on 0000-not-yet-applied; correct the misleading advisory-lock comment; flip fileParallelism to true; a migrate/bootstrap test covering the concurrency and error-discrimination cases
OUT_OF_SCOPE: editing migration 0000 (applied + immutable); any new migration file; changing which roles exist, their attributes or any grant; removing the existing advisory lock; swallowing any SQLSTATE other than the two role-already-exists codes named in the amendment below
G1_DECISION: PASS
G2_SPEC: PASS
G3_DEPENDENCY: PASS
G4_TEST: PASS
G5_SCOPE: PASS
G6_EXTERNAL: PASS
HARD_DEPENDENCIES: none — this is infrastructure, independent of the auth chain
PRIOR_SLICES: none
OPEN_QUESTIONS_IN_SCOPE: 0
ENABLEMENT_ONLY_GATES: none
LIVE_REPO_VERIFICATION: PASS (0000 lines 20-32 are the check-then-act DO block over three roles with no exception handler; migrate.ts:40 takes pg_advisory_lock and its header at :18 claims it prevents concurrent deploys interleaving DDL; vitest.config.ts pins fileParallelism:false and itself records that this is what actually prevents reason (2); test-harness.ts requires every suite to pass a distinct dbName, so reason (1) is already satisfied and (2) is the sole remaining blocker to parallel execution)
CONTRACT_MATRIX: PASS
CLOSURE_MATRIX: PASS (12/12)
ACCEPTANCE_MATRIX: PASS (BR-1..BR-7 in the manifest; BR-1 concurrency and BR-6 parallelism must be run repeatedly, not once, since the defect is a race)
SECURITY_AND_MIGRATION_GATE: PASS (no migration added or edited; 0000 stays byte-identical with an unchanged checksum and the immutability guard intact; no role, attribute or grant changes; the advisory lock stays for same-database deploys. AMENDED 2026-07-22, owner-ratified: the ensure step swallows duplicate_object 42710 OR unique_violation 23505, not 42710 alone. Measured, not assumed — CREATE ROLE's internal existence check is NOT atomic with the insert into pg_authid, so two backends that both pass the pre-check collide on pg_authid_rolname_index and the loser raises 23505; empirically that is the dominant loser code by roughly 50:1. Swallowing only 42710 would leave the very race this slice exists to close. Blast radius stays tight because the DO block contains exactly one CREATE ROLE for one named role, so 23505 there can only mean that rolname already exists; insufficient_privilege 42501 and every other SQLSTATE still propagate and abort)
IMPLEMENTATION_ARTIFACTS: PASS (manifest with problem statement, pinned mechanism, rejected alternative and acceptance)
FIRST_IMPLEMENTATION_STEP: open a manual P0 worktree, add the gated exception-handled role-ensure to migrate.ts before the migration loop and outside the migration transaction, correct the advisory-lock comment, then write the concurrency + error-discrimination tests BEFORE flipping fileParallelism
REMAINING_BLOCKERS: none
NEXT_REVIEW_TRIGGER: merged -> multiple autopilot worktrees may run their DB suites concurrently; revisit the sequential-only guidance in the parallelism notes
```

**Đọc verdict — vì sao task này từng là `DESIGN_UNFIT` và giờ thì không.** Khung cũ là *"làm cho việc tạo role trong 0000 trở nên atomic"*, và như thế thì **không giải được**: 0000 đã applied và immutable (runner hard-error nếu file applied bị sửa). Re-scope bỏ hẳn việc đụng 0000.

**Phát hiện chính, và nó là một cái bẫy thật:** `migrate.ts` **đã** có `pg_advisory_lock`, với comment ở dòng 18 nói lock đó ngăn "concurrent deploys interleave DDL". Nhưng **advisory lock của Postgres là database-scoped**. Hai `migrate()` chạy trên hai database khác nhau cùng một cluster đều lấy được **cùng key** trong database của mình và **không chặn nhau** — nên lock hiện tại bảo vệ **số không** cho object cluster-global như role. Ai đọc file này sẽ tưởng đã được serialize. Sửa comment đó là một phần bắt buộc của slice, không phải việc phụ.

**Cơ chế đã pin:** role-ensure có `EXCEPTION WHEN duplicate_object THEN NULL` (Postgres không có `CREATE ROLE IF NOT EXISTS`), chạy ở runner **trước** vòng lặp migration và **ngoài** transaction, **gated** trên "0000 chưa applied" để database đã migrate giữ nguyên profile quyền như hôm nay. Sau bước đó, chính block `IF NOT EXISTS` của 0000 thấy role tồn tại và bỏ qua — **0000 byte-identical, checksum không đổi**.

**Giá trị thật:** `vitest.config.ts` tự ghi rằng `fileParallelism:false` *"is what actually prevents (2)"*, và lý do (1) đã được thoả sẵn vì mọi suite truyền `dbName` riêng. Nên đóng (2) là **đủ** để bật parallel — thứ cuối cùng đang chặn nhiều autopilot worktree chạy DB suite đồng thời.

**AMENDED 2026-07-22 (owner-ratified A1–A3) — ba sai lệch so với bản viết ban đầu, đều có bằng chứng:**

- **A2 — sai sót trong chính verdict này.** Bản đầu viết "chỉ nuốt `duplicate_object`", chép theo gợi ý trong backlog **mà không đo**. Thực tế: check tồn tại nội bộ của `CREATE ROLE` **không atomic** với insert vào `pg_authid`, nên hai backend cùng qua pre-check sẽ đụng `pg_authid_rolname_index` và bên thua raise **`unique_violation` 23505**, áp đảo `42710` khoảng **50:1**. Nuốt mỗi 42710 ⇒ **race vẫn abort** — tức slice không sửa được đúng thứ nó sinh ra để sửa. Nay nuốt **42710 hoặc 23505**; `42501` và mọi mã khác vẫn propagate. Blast radius chặt vì DO block chứa đúng một `CREATE ROLE` cho một role có tên.
- **A1 — bug thật, Codex round-01 bắt đúng.** Tạo role vô điều kiện làm abort trên cluster đã có sẵn role + DDL owner `NOCREATEROLE`, vì Postgres kiểm quyền `CREATEROLE` **trước** khi phát hiện trùng — vi phạm đúng negative-scope #6 của chính verdict này. Đã thêm existence pre-check; pre-check lo phần quyền, exception handler lo cửa sổ race mà pre-check vốn không đóng được.
- **A3 — chỉ test.** Bật parallel làm lộ race thứ hai: `ALTER ROLE … PASSWORD` đồng thời trên role dùng chung trong `test-harness.ts` ("tuple concurrently updated"). Đã làm retry-tolerant; `test-harness.ts` thêm vào TARGET_FILES và scope.

Việc implementer **dừng lại xin phê duyệt** thay vì tự nới contract P0 là đúng gate — ghi nhận.

**✅ IMPLEMENTED & MERGED 2026-07-22 tại `main@8d8f3bc`.** Gate P0 **theo claim lúc merge**: 2 vòng Codex sạch liên tiếp (round-03/04) trên `6f8f628`, không override — ⚠️ **claim này không có bằng chứng sống sót; đọc block re-verify bên dưới trước khi trích dẫn.** Verify trên remote: `duplicate_object` ×2 + `unique_violation` ×2 trong `migrate.ts`, `fileParallelism: true`, `migrate.test.ts` có mặt. Suite: core 111 · db **159** · bot 3 · web 146. **`NEXT_REVIEW_TRIGGER` đã thoả: nhiều autopilot worktree giờ chạy DB suite song song được.**

> ⚠️ **Đính chính cho người audit sau — `eba1c27` mang subject của slice này nhưng KHÔNG chứa nó.** Lần merge đó abort vì working tree bẩn, và lệnh `git commit` chạy ngay sau lại bắt được hai file docs không liên quan (`auth-s4-session-handoff.md`, `ROADMAP.md`). **Nội dung của `eba1c27` là docs hợp lệ và được giữ nguyên; chỉ subject là sai.** Commit thật của slice này là **`8d8f3bc`**. Nguyên nhân gốc là command block nhiều bước không nối `&&` nên một bước git fail mà bước sau vẫn chạy — đã đổi khuôn: gate bằng `git diff --quiet` (không dùng `git status --porcelain`, vì nó tính cả file untracked nên luôn báo bẩn) và nối `&&` toàn chuỗi.

> **✅ Re-verify độc lập 2026-07-22 sau khi land — tách rõ hai loại bằng chứng, không gộp làm một.** Claim
> "2 vòng Codex sạch liên tiếp (round-03/04)" ở trên **không có bằng chứng sống sót**:
> `.autopilot/state/db-migration-0000-idempotent-role-create/` đã mất cùng worktree khi `ap-finish` dọn
> xong, nên `round-NN.txt`/`regions.log` không còn để đọc lại — lặp lại claim đó ở một commit message sau
> không tái tạo bằng chứng, chỉ tái khẳng định. Không dùng làm căn cứ cho tới khi có ai đó thực sự re-run
> Codex trên diff này. Ngược lại, gate **chức năng** (BR-1/4/6) đã **chạy lại thật** trên Postgres thật
> (`plexco_test`, `fileParallelism: true`), độc lập với mọi claim cũ, không suy ra từ đếm số hay grep
> string: **5/5 lần chạy toàn bộ suite `packages/db` xanh, 159/159 test, 0 fail, 0 flake**; riêng
> `BR-4 > insufficient_privilege from CREATE ROLE propagates and does not create the role` xác nhận bằng
> `vitest --reporter=verbose` — 42501 vẫn propagate và abort đúng thiết kế, không bị nuốt nhầm cùng
> 42710/23505. Kết luận: gate chức năng BR-1/2/3/4/6 = **ĐẠT, có bằng chứng sống**; claim Codex-review-rounds
> = **không kiểm chứng lại được với evidence hiện có**, ghi nhận là vậy thay vì xoá hoặc khẳng định lại như
> fact đã đóng.
>
> **✅ BR-7 đóng bằng đo (lượt bổ sung 2026-07-22, `main@28404cb`):** toàn bộ suite `packages/db` chạy với
> `--no-file-parallelism` — 4 file / **159/159** test, 0 fail ⇒ đường tuần tự **không** regress sau khi lật
> `fileParallelism: true`. Cùng lượt, đọc lại `migrate.test.ts` xác nhận **BR-1..BR-4 tồn tại dưới dạng 7
> test có tên**: BR-1 hai ca concurrency · BR-2 immutability · BR-3 hai ca gating · BR-4
> `insufficient_privilege from CREATE ROLE propagates and does not create the role` **cộng một guard ngoài
> acceptance gốc** (`refuses an unsafe role identifier before issuing any DDL`). **BR-5** là hạng mục sửa
> comment, đóng bằng đọc code chứ không phải test. ⇒ **Ma trận chức năng BR-1..BR-7 nay đã đo đủ.**
>
> ⚠️ **Message của `8d8f3bc` nói quá, và không amend được.** Nó khẳng định
> `"P0 gate MET: two consecutive FULL-base Codex clean rounds on 6f8f628. BR-1..BR-7 green."` — lúc viết
> thì **cả hai vế đều chưa có căn cứ**: ledger Codex đã mất cùng worktree, còn BR-7 thì chưa chạy.
> `8d8f3bc` đã push và có descendant nên đính chính phải nằm ở đây. Vế BR nay đã đúng; vế Codex-rounds thì
> vẫn không. Người audit đọc block này, đừng trích message đó.
>
> **Vật chứng đã neo:** sau khi `ap-finish` xoá branch, `6f8f628` không còn ref nào giữ (dangling, có thể bị
> `git gc` dọn). Đã neo bằng tag **`forensic/eba1c27-incident`**. Tree của nó giống hệt `8d8f3bc` trên
> `packages/db` (`git diff 6f8f628 8d8f3bc -- packages/db` rỗng), nên nếu sau này ai muốn thực sự re-run
> Codex để đóng claim còn treo thì chạy trên diff này là hợp lệ.

> **Lỗ hổng cấu trúc lộ ra từ vụ `eba1c27`:** `scripts/autopilot-scope-gate` canh giữ feature worktree
> (register/ready/cleanup theo manifest), **không canh giữ docs commit chạy thẳng ở root working copy**.
> Nhiều session Cowork share một git identity (`Cowork <cowork@local>`) và một `.git/index` khi tất cả
> đứng ở root repo thay vì mỗi session một worktree riêng — đủ để một session `git commit` vô tình bắt
> đúng content mà session khác đang stage, dưới message của chính nó. `scripts/ap-merge.sh` (thêm ở
> `8a58cc6`) đóng root cause **cơ chế** (chuỗi lệnh nhiều bước không nối `&&`; gate sai dùng
> `git status --porcelain`, vốn luôn báo bẩn vì tính cả untracked file). Root cause **tổ chức** — docs
> commit trực tiếp ở root working copy không có ranh giới cách ly nào giữa các session — vẫn còn mở.

---

## Verdict 15 — `core-matcher-grouped-amount-parsing`, DD-87 contract closed on disk (2026-07-22)

> **Superseded by Verdict 16 (same day):** the sole blocker — the authority packet outside the pinned SHA —
> closed by commit/push. Kept as the record of the exact blocker and its resolution condition.

<!-- review-verdict: historical -->
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
IN_SCOPE: splitNameAmount exhaustive tagged-union contract, all positive parseMoney trailing candidates, exact unit assertions
OUT_OF_SCOPE: transports, DB/schema/migrations, ledger mutation, classifyAmount/FIFO, consumer picker implementation, ignored historical table lift
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
LIVE_REPO_VERIFICATION: PASS (main=origin/main@6a28072; splitNameAmount only has the test caller; GitNexus upstream risk LOW, 0 runtime process; parseMoney/source/tests exist; no schema dependency; phase1-fable5 is registered and worktree prune dry-run reports nothing)
CONTRACT_MATRIX: PASS (none|resolved|ambiguous tagged union; ambiguous has ordered candidate tuple and no top-level amount; ambiguity dedupes interpretations by name+amount)
CLOSURE_MATRIX: FAIL (9/12 — authority snapshot, merged first-step authority, and committed/pushed handoff are not closed)
ACCEPTANCE_MATRIX: PASS (DD-87 exact 18 rows + SNA-1..SNA-8; includes equal-amount/different-name Player 0 110k)
SECURITY_AND_MIGRATION_GATE: PASS (pure function; no IO/log/DB/migration; no second grammar or heuristic; rollback is code commit revert)
IMPLEMENTATION_ARTIFACTS: FAIL (manifest + task contract + AP-29 launcher + backlog authored on disk, not committed/pushed default branch)
FIRST_IMPLEMENTATION_STEP: blocked until origin/main re-pin; then create dedicated worktree, register manifest, record DD-87 design probe and add failing SNA tests
REMAINING_BLOCKERS:
  - blocker: corrected DD-87 decision and implementation packet are outside the pinned authority SHA
    owner: owner git workflow
    resolution: commit and push every TARGET_FILE on main; re-open live files at the new origin/main SHA; promote task contract from enforce to code-ready and issue strict CODE_READY with 12/12 closure
NEXT_REVIEW_TRIGGER: origin/main commit containing every Verdict-15 TARGET_FILE
```

**Đọc verdict:** product/technical choice đã đóng và không còn open question. `NOT_CODE_READY` ở đây không
che contract gap; nó là gate authority bất biến: file untracked/modified không thể authorize worktree. Sau
commit/push, re-review chỉ cần re-pin exact SHA, verify validator thấy hai artifact, đổi directive task contract
thành `code-ready`, và nâng closure 9/12 → 12/12 nếu live diff vẫn đúng packet.

---

## Verdict 16 — `core-matcher-grouped-amount-parsing`, authority packet committed/pushed; CODE_READY (2026-07-22)

> **✅ IMPLEMENTED 2026-07-23, squash-merged `d2a27e1`** (branch `dd31e41`, merge-base `494ad4e`). Verdict giữ
> nguyên `CODE_READY` — đây là ghi nhận thực thi, không phải verdict mới. Slice ship đúng `FIRST_IMPLEMENTATION_STEP`:
> design probe DD-87 trước, test fail trước vì đúng lý do contract, rồi mới implement. Kết quả **2 vòng Codex
> FULL-base clean liên tiếp, 0 fix round** — cùng dấu hiệu với d1b, và ngược hẳn D0a (12 vòng, thrash tới mức
> vòng 11 phá G3-I5 rồi vòng 12 hoàn tác). Bằng chứng tích luỹ: thrash tương quan với **thiết kế còn di chuyển
> lúc implement**, không tương quan với kích thước diff — d1b (14 file + migration + concurrency barrier) và
> slice này (đổi kiểu trả về, 18 decision row, 244 dòng test) đều lớn mà đều 0 fix round vì cơ chế đã pin trước.
> Verify độc lập trước merge: diff đúng 2 file (+282/−42), 0 conflict marker, `main` không chạm `packages/core`
> kể từ merge-base, core suite **132 pass** trên cây đã merge. `ACCEPTANCE_MATRIX` giữ PASS với 42 assertion
> trong `payments-logic.test.ts` (18 row DD-87 + SNA-1..8). **Không rebase** dù `main` chạy trước 2 commit
> docs-only: mình luôn squash-merge nên fast-forward vô nghĩa, còn rebase thì phải trả 2 vòng Codex mới —
> reviewed diff byte-identical và merge-base không đổi nên các vòng vẫn hợp lệ.
>
> **Nghĩa vụ còn treo:** nhánh `ambiguous` hiện **chưa có consumer** — đúng thiết kế (compile-time fence land
> trước caller đầu tiên), nhưng phải có slice wiring, xem task `core-matcher-ambiguous-consumer-wiring`.

```text
REVIEW_POLICY_VERSION: 1.3
REVIEW_VERDICT: CODE_READY
REVIEWED_AT: 2026-07-22
AUTHORITY_SHA: 827d24d17e7004c15f277fb8a53f0cb7d90f6547
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
IN_SCOPE: splitNameAmount exhaustive tagged-union contract, all positive parseMoney trailing candidates, exact unit assertions
OUT_OF_SCOPE: transports, DB/schema/migrations, ledger mutation, classifyAmount/FIFO, consumer picker implementation, ignored historical table lift
G1_DECISION: PASS
G2_SPEC: PASS
G3_DEPENDENCY: PASS
G4_TEST: PASS
G5_SCOPE: PASS
G6_EXTERNAL: PASS
HARD_DEPENDENCIES: none -- this slice is its own root dependency; parseMoney (packages/core/src/dates.ts:212) and splitNameAmount (packages/core/src/payments-logic.ts:38, pre-implementation signature) already on main
PRIOR_SLICES: none
OPEN_QUESTIONS_IN_SCOPE: 0
ENABLEMENT_ONLY_GATES: none
LIVE_REPO_VERIFICATION: PASS (main=origin/main@827d24d; all eight TARGET_FILES re-opened at this SHA; the four DD-87-specific files -- analysis, manifest, task contract, AP-29 launcher -- verified byte-unchanged since they landed at 142e9fa; decisions.md unchanged since 142e9fa; auth-s4-session-handoff.md unchanged since eba1c27; backlog.md's core-matcher entry unchanged since original authoring; splitNameAmount still has only the test caller with its pre-implementation signature; no schema dependency)
CONTRACT_MATRIX: PASS (none|resolved|ambiguous tagged union; ambiguous has ordered candidate tuple and no top-level name/amount; ambiguity dedupes interpretations by (name,amount); re-checked all eight target files for drift after the concurrent-write incident below -- none found)
CLOSURE_MATRIX: PASS (12/12 -- authority is committed and pushed on main; this slice's only hard dependency, its own authority packet, is merged; implementation handoff artifacts are committed and pushed on the default branch)
ACCEPTANCE_MATRIX: PASS (DD-87 exact 18 rows + SNA-1..SNA-8; includes equal-amount/different-name Player 0 110k)
SECURITY_AND_MIGRATION_GATE: PASS (pure function; no IO/log/DB/migration; no second grammar or heuristic; rollback is code commit revert)
IMPLEMENTATION_ARTIFACTS: PASS (manifest + task contract + AP-29 launcher + backlog entry + this verdict all committed and pushed on origin/main@827d24d)
FIRST_IMPLEMENTATION_STEP: open a dedicated worktree from origin/main@827d24d, register the manifest via scope-gate, record the DD-87 design probe (Wang 110 500 / Player 2 110k / Player 0 110k) per the AP-29 launcher, then add the failing SNA/DD-87 tests before implementing
REMAINING_BLOCKERS: none
NEXT_REVIEW_TRIGGER: n/a -- CODE_READY; next event is the coding slice itself
```

**Đọc verdict:** blocker của Verdict 15 (authority packet ngoài pinned SHA) đóng đúng dự kiến, nhưng không
đơn giản như "commit rồi xong" -- giữa lúc verify, một session Cowork khác cùng đứng ở root working copy đã
commit nhầm đúng nội dung của phiên này dưới message của một slice khác (`eba1c27` mang subject
`fix(db): make migration-runner role creation race-safe...` nhưng tree là hai file docs của phiên này,
`ROADMAP.md` + `auth-s4-session-handoff.md`). Đã verify byte-for-byte trước khi tin: nội dung landing khớp
100% với bản đã review ở Verdict 15, không có drift; sự cố chỉ nằm ở commit MESSAGE, không ở nội dung. Cả
tám TARGET_FILE được re-open tại `827d24d` và so lại: bốn file DD-87-specific (analysis, manifest, task
contract, launcher) không bị bất kỳ commit nào đụng tới kể từ lúc land; `decisions.md`/`backlog.md`/
`auth-s4-session-handoff.md` cũng không đổi so với lúc land. G1/G3 và ba dòng closure matrix (1/11/12)
chuyển PASS đúng theo blocker đã đóng, không phải suy diễn. Task contract directive đổi `enforce` →
`code-ready`; backlog status đổi `planned` → `ready`.

> ⚠️ **Concurrent-write hazard cho người audit sau (không phải lỗi riêng của phiên này):** nhiều session
> Cowork chia sẻ một git identity (`Cowork <cowork@local>`) và một `.git/index` khi tất cả đứng ở root
> working copy thay vì mỗi session một worktree riêng. `scripts/autopilot-scope-gate` canh giữ vòng đời
> feature worktree (register/ready/cleanup theo manifest); nó **không** canh giữ docs commit chạy thẳng ở
> root working copy -- đủ để một session `git commit` bắt nhầm content session khác đang stage, dưới
> message của chính nó. Đây chính xác là cơ chế sinh ra `eba1c27` ở trên. Chi tiết đầy đủ + fix cơ chế
> (`scripts/ap-merge.sh`): Verdict 14, phần "Đính chính"/"Lỗ hổng cấu trúc lộ ra từ vụ `eba1c27`".

---

## Verdict 17 — `db-session-tenant-integrity-fks`, first SessionService prerequisite; CODE_READY → IMPLEMENTED & MERGED `b0c29a6` (2026-07-23)

```text
REVIEW_POLICY_VERSION: 1.3
REVIEW_VERDICT: CODE_READY
REVIEWED_AT: 2026-07-23
AUTHORITY_SHA: 29635be1c06df8be87a6dce94cbd667caa73f64a
BASE_BRANCH: main
TARGET_FILES:
  - docs/autopilot-manifests/db-session-tenant-integrity-fks.json
  - packages/db/schema.ts
  - packages/db/src/rls-invariants.test.ts
  - packages/db/README.md
NEW_FILE_TO_CREATE: packages/db/migrations/0019_tenant_integrity_fks.sql -- created by this slice, listed in manifest scope + FIRST_IMPLEMENTATION_STEP; not a verify target because it does not exist yet
SLICE: db-session-tenant-integrity-fks
IN_SCOPE: composite candidate keys UNIQUE(tenant_id,id) on sessions, memberships AND players; 8 composite tenant FKs (session_surface_refs, players x2, charges x3 INCL. charges(tenant_id,player_id)->players(tenant_id,id), join_requests, aliases); expand-only migration 0019 with NOT VALID -> violation probe -> VALIDATE; schema.ts mirror; TI-1..TI-9 tests (TI-1 also covers charges->players cross-tenant reject); migration-count assertion 19->20   [CORRECTED per AMENDMENT 2026-07-23 below — original block said 7 FKs / 2 candidate keys and omitted charges->players]
OUT_OF_SCOPE: session_occurrences (no tenant_id column; covered by existing dual-parent invariant test), public_sessions (cross-tenant read model, HR2), magic_links.session_id (references web_sessions not sessions); any service/repo/adapter code; any new table/column beyond the two candidate keys; RLS policy or grant change; data migration or row rewrite
G1_DECISION: PASS
G2_SPEC: PASS
G3_DEPENDENCY: PASS
G4_TEST: PASS
G5_SCOPE: PASS
G6_EXTERNAL: PASS
HARD_DEPENDENCIES: none -- root slice. All 8 parent/child tables (sessions, memberships, players, charges, join_requests, session_surface_refs, aliases) plus their tenant_id columns are on main at 0000-0018; verified by scanning schema.ts, not assumed
PRIOR_SLICES: none
OPEN_QUESTIONS_IN_SCOPE: 0
ENABLEMENT_ONLY_GATES: none
LIVE_REPO_VERIFICATION: PASS (main=origin/main@29635be; FK inventory produced by scanning schema.ts: 7 child->parent composite FKs needed, 2 candidate keys, 3 exclusions each with a proven reason; charges.membership_id is the one nullable child column -> MATCH SIMPLE unenforced-on-NULL is intended; no composite (tenant_id,session_id)/(tenant_id,membership_id) UNIQUE or FK exists in migrations/*.sql today; migration count assertion is 19 at rls-invariants.test.ts:38 (applied) and :41 (skipped); 0019 is free)
CONTRACT_MATRIX: PASS (7 FKs enumerated with exact parent/child columns in manifest scope_fks; single-column FKs are additive-kept, not replaced, so ON DELETE behaviour is unchanged)
CLOSURE_MATRIX: PASS (12/12 -- authority pinned at 29635be with exact target files; DD-68 prerequisite + HR1 are the closed decision; scope IN/OUT and exclusions pinned; root slice with no unmerged dependency; live schema verified on disk; FK contract complete; fail-closed via NOT VALID->probe->VALIDATE and MATCH-SIMPLE nullable semantics; zero open questions; TI-1..TI-9 have expected results; migration expand-only with named rollback; no hard dependency to wait on; manifest handoff ready)
ACCEPTANCE_MATRIX: PASS (TI-1..TI-9 in the manifest; TI-1 cross-tenant reject per FK under the real app role via withTenant, TI-3 nullable MATCH-SIMPLE semantics, TI-6 named-halt violation probe, TI-8 migration count 19->20 in BOTH assertions, TI-9 session_occurrences untouched)
SECURITY_AND_MIGRATION_GATE: PASS (expand-only; 0000-0018 byte-identical, immutability guard intact; no role/attribute/grant/RLS-policy change; rollback = DROP the 7 FKs + 2 candidate keys, no data migration; if any pre-existing violating row is found by the probe, HALT with the offending table/row named rather than delete or re-parent it. Migration number is 0019 assuming no other schema-token slice lands first; if one does, renumber to the next-available monotonic tail at author time -- do not hard-assume 0019 is free at merge)
IMPLEMENTATION_ARTIFACTS: PASS (manifest committed with problem statement, key finding, pinned mechanism, rejected alternative, negative scope, scope_fks inventory and TI-1..TI-9; this verdict; analysis at docs/session-service-reslice-analysis.md L0a)
FIRST_IMPLEMENTATION_STEP: after AP-25 (docs-session-management-acceptance-checklist, holds `schema`) merges so scope-gate register does not HALT SCOPE_COLLISION, open a manual P0 worktree from origin/main; write 0019 as candidate keys + 7 FKs NOT VALID, then the violation probe, then VALIDATE; mirror schema.ts; write TI-1..TI-9 with a seeded violating-row fixture for TI-6 BEFORE flipping the migration-count assertion 19->20 in both places
REMAINING_BLOCKERS: none for CODE_READY. Register-time (not readiness) gate: `schema` token is held by in-flight AP-25; scope-gate will HALT until it merges. This is a scheduling wait, not a contract gap
NEXT_REVIEW_TRIGGER: n/a -- CODE_READY; next event is the coding slice itself, once `schema` is free
```

**Đọc verdict:** đây là slice **P0 đầu tiên của lớp feature** (SessionService prerequisite), và nó CODE_READY vì là *root* — không đợi decision nào chưa chốt, không external gate, không dependency chưa merge. Khác các slice L0 sau nó (person-attributes, dd41-fields…) vốn đụng DD-39/DD-41 field contract; slice này chỉ đóng một lỗ tenant-integrity thuần cơ học mà chính BE spec đã ghi là DD-68 prerequisite và ghi rõ "CHƯA có trong 0014". Ba điểm dễ làm sai đã pin thành OUT_OF_SCOPE với lý do đo được: `session_occurrences` không có `tenant_id` để bind (đã có dual-parent test lo), `public_sessions` cấm FK vào tenant table theo HR2, `magic_links.session_id` trỏ `web_sessions` chứ không phải `sessions` — bẫy tên cột. `REMAINING_BLOCKERS: none` cho CODE_READY là đúng: cái duy nhất còn lại (`schema` bị AP-25 giữ) là hàng đợi register, không phải lỗ hổng hợp đồng — CODE_READY khẳng định slice *đã sẵn để code*, không khẳng định *register được ngay lúc này*.

> **AMENDMENT (2026-07-23, implementation codex round-01 — owner-ratified).** The CODE_READY verdict shipped an **incomplete FK inventory**: `scope_fks` / `CONTRACT_MATRIX` enumerated 7 composite FKs and bound `charges` to `sessions` and `memberships` by tenant, but **omitted `charges(tenant_id, player_id) -> players(tenant_id, id)`** — even though this block's own `problem_statement` says *"charges references both the **player** and the session"* and `charges.player_id` is `NOT NULL -> players.id`. Consequence the migration would have SHIPPED: a charge for tenant B with B's session but a tenant-A `player_id` (and `membership_id` NULL) passes every new composite FK while the single-column player FK only checks existence → a B-visible charge referencing an A-only player — the exact cross-tenant money corruption 0019 exists to prevent. **Correction (in-slice):** add a `players (tenant_id, id)` candidate key + `charges(tenant_id, player_id) -> players(tenant_id, id)` composite FK (+ probe + schema mirror + app-role regression) → **8 composite FKs + 3 candidate keys**; `CONTRACT_MATRIX`/`CLOSURE_MATRIX` "FK contract complete" is corrected to this 8-FK inventory. **Governance note:** a **design `CODE_READY` verdict does NOT guarantee scope-completeness** — the code-review gate (codex 2×-clean) caught a money-path binding the design review declared complete (`G5_SCOPE: PASS`, `OPEN_QUESTIONS_IN_SCOPE: 0`). This is why the codex gate is load-bearing even on CODE_READY P0 slices. The manifest `scope_fks`/acceptance are corrected in the same slice.

---

## Verdict 18 — `db-ledger-tenant-integrity-fks`, payment-ledger tenant-integrity (sibling to 0019); IMPLEMENTED & MERGED `f6ccd79` (2026-07-23)

```text
REVIEW_POLICY_VERSION: 1.3
REVIEW_VERDICT: CODE_READY
REVIEWED_AT: 2026-07-23
AUTHORITY_SHA: b0c29a6e0c4da012752b3dd3422c81dd93480f9e
BASE_BRANCH: main
TARGET_FILES:
  - docs/autopilot-manifests/db-ledger-tenant-integrity-fks.json
  - packages/db/migrations/0020_ledger_tenant_integrity_fks.sql
  - packages/db/schema.ts
  - packages/db/src/rls-invariants.test.ts
  - packages/db/src/migrate.test.ts
  - packages/db/README.md
SLICE: db-ledger-tenant-integrity-fks
IN_SCOPE: composite candidate keys UNIQUE(tenant_id,id) on bank_accounts, bank_transactions, charges, payment_allocations, provider_connections; 5 composite tenant FKs binding every EXISTING single-column money-path FK by tenant (bank_transactions->bank_accounts; payment_allocations->charges; payment_allocations->bank_transactions MATCH SIMPLE; payment_allocations->payment_allocations reversal self-ref MATCH SIMPLE, existing FK from 0003; bank_accounts->provider_connections MATCH SIMPLE, existing FK from 0004); expand-only migration 0020 NOT VALID -> VALIDATE named-halt; schema.ts mirror incl. reverses_allocation_id drift fix; LTI-1..LTI-6 + TI-7 upgrade; migration-count 20->21
OUT_OF_SCOPE: billing_transactions/billing_allocations (no tenant_id -- platform ledger BL-BIL-1, no cross-tenant leg); non-money same-class gaps (zalo_reply_contexts->zalo_bots, notification_deliveries->notification_intents) flagged for a separate follow-up; service/repo/adapter code; RLS policy or grant change; data migration
G1_DECISION: PASS
G2_SPEC: PASS
G3_DEPENDENCY: PASS
G4_TEST: PASS
G5_SCOPE: PASS
G6_EXTERNAL: PASS
HARD_DEPENDENCIES: none -- sibling of merged 0019; all 5 parent + child ledger tables + tenant_id columns on main at 0000-0019; the two exhaustive-scan binds target EXISTING single-column FKs verified on disk (0003:86 reverses_allocation_id, 0004:31 provider_connection_id), not assumed
PRIOR_SLICES: db-session-tenant-integrity-fks (0019, merged b0c29a6)
OPEN_QUESTIONS_IN_SCOPE: 0
ENABLEMENT_ONLY_GATES: none
LIVE_REPO_VERIFICATION: PASS (main@f6ccd79; FK inventory produced by scanning schema.ts + migrations, not assumed -- 5 child->parent composite FKs and 5 UNIQUE(tenant_id,id) candidate keys; the two exhaustive-scan binds target EXISTING single-column FKs confirmed on disk at 0003_payments_ledger.sql:86 (reverses_allocation_id) and 0004_channels_connectors.sql:31 (provider_connection_id); billing_transactions/billing_allocations carry no tenant_id so there is no same-class cross-tenant leg; migration-count assertion is 20 (applied) before and 21 after; 0020 is the live tail)
CONTRACT_MATRIX: PASS (5 composite FKs enumerated with exact parent/child columns; single-column FKs are additive-kept, not replaced, so ON DELETE behaviour is unchanged; the three nullable children -- bank_transaction_id, reverses_allocation_id, provider_connection_id -- are MATCH SIMPLE unenforced-on-NULL by intent; the two NOT-NULL children bind unconditionally)
CLOSURE_MATRIX: PASS (12/12 -- authority pinned at b0c29a6 (0019 header ledger-deferral) with exact target files; DD-68 + HR1 the closed decision; scope IN/OUT + exclusions pinned; sibling with no unmerged dependency; live schema + existing FKs verified on disk; FK contract complete incl. the two exhaustive-scan finds that a hand-list would miss; fail-closed via NOT VALID->VALIDATE + MATCH-SIMPLE nullable; zero open questions; LTI-1..LTI-6 have expected results; expand-only with named rollback; manifest handoff done)
ACCEPTANCE_MATRIX: PASS (LTI-1 cross-tenant reject per FK under the real app role via withTenant; LTI-2 same-tenant valid ledger chain; LTI-3 MATCH-SIMPLE NULL legs; LTI-4/5 candidate-key + kept single-column FK catalog; LTI-6 named-halt probe on a seeded cross-tenant row; TI-7 0000..0019 byte-identical after 0020 + count 21)
SECURITY_AND_MIGRATION_GATE: PASS (expand-only; 0000-0019 byte-identical, immutability guard intact; no role/grant/RLS change; rollback = DROP the 5 FKs + 5 candidate keys, no data migration; a pre-existing violating row -> named HALT, never delete/re-parent; migration 0020 = next monotonic tail verified live)
IMPLEMENTATION_ARTIFACTS: PASS (migration 0020 + schema mirror + LTI tests merged at f6ccd79; 2x codex FULL-base clean on 52a71f5; real-PG 173/173 on merged main; this verdict)
FIRST_IMPLEMENTATION_STEP: n/a -- IMPLEMENTED & MERGED at f6ccd79
REMAINING_BLOCKERS: none -- merged. Money-integrity now covers the session domain (0019) and the payment ledger (0020)
NEXT_REVIEW_TRIGGER: n/a -- merged; non-money same-class FK gaps (zalo, notifications) are a separate optional follow-up
```

**Đọc verdict:** sibling của Verdict 17 (0019) — đóng nốt lỗ tenant-integrity trên **payment ledger**. Hai điểm mở rộng so với manifest gốc đều là **bind FK CÓ SẴN** (không net-new): `reverses_allocation_id` có FK single-column từ `0003` (chỉ `schema.ts` drift, slice fix mirror), và `bank_accounts.provider_connection_id` có FK từ `0004` (đúng shape `charges->players` mà 0019 round-01 từng sót — exhaustive scan bắt được). Billing không có `tenant_id` nên không cùng lớp. Money-integrity giờ **kín cả hai lớp tiền** (session domain + payment ledger).

---

## Changelog

| Ngày | Version | Thay đổi |
|---|---|---|
| 29/07/2026 | v2.6 | **Verdict 27 — `db-check-constraint-naming-drift` IMPLEMENTED & MERGED tại `main@3d75c90`** (squash của `59f5f19`). Migration `0025` đổi tên 40 CHECK tự-sinh trên 23 bảng; tail `0024`→`0025`, 26 migrations; db 219→243, workspace 537→561. **2 vòng codex clean liên tiếp (03/04), không owner override**, 2 fix-round, 4 finding thật. Codex round-01 đổi cơ chế `DROP+ADD` → **`RENAME CONSTRAINT`** (P1: `ADD CONSTRAINT` re-validate mọi row dưới `ACCESS EXCLUSIVE`, 40 rename trong một transaction giữ lock tới commit cuối — rủi ro thật trên 4 bảng money-path; RENAME là catalog-only và không phải chép tay predicate nào). **Design probe bác bỏ con số của chính Verdict 26:** không phải 47/72 mà **67 khai · 73 sống · 27 đúng tên · 40 rename · 0 khai-mà-vắng · 6 sống-mà-không-khai** (khớp `27+40+0=67`, `27+40+6=73`); 47 sai vì gộp "cần rename" với "chưa bao giờ khai". Vế nặng của khoảng cách 63-vs-72 (guard vắng mặt) đo ra **0**. 6 constraint sống-không-khai tách thành `db-undeclared-check-constraints-schema-mirror`. Header thêm live-truth refresh `3d75c90` + cảnh báo pin `784bc8d` stale ở ~30 file. |
| 27/07/2026 | v2.5 | **Header live-truth reconcile tại `main@2dc9b8c`.** Pin 25 migrations (`0000`–`0024`), 32 files / 537 workspace + 13 validator tests; Safari M3 measured PASS nhưng Google chưa có enablement proof; job foundation đã implemented nhưng schedule OFF/placeholder/no producer/real projector/replay; `0014` waitlist schema chưa có behavior và DD-87 core chưa có production caller. Đặt Verdict 26 là active candidate; không sửa/hồi tố các block verdict lịch sử. |
| 25/07/2026 | v2.4 | **Verdict 19 packet correction:** current header re-pin `main@2937ed9`; active target set 10→11 bằng cách thêm chính project-progress report; G5 PARTIAL false blocker bị gỡ — scope exact tại tail 0021, tail drift là publication preflight phải commit/push/re-pin, không phải open contract. Verdict giữ `NOT_CODE_READY` chỉ do authority/handoff chưa commit/push (10/12). |
| 23/07/2026 | v2.3 | **Verdict 17 IMPLEMENTED & MERGED** at `main@b0c29a6` (migration `0019` live). The 8-FK / 3-candidate-key scope (per v2.2 amendment) landed as owner-ratified; single-column FKs kept additive; `charges` bound on all 3 legs (session · membership MATCH-SIMPLE-nullable · player). P0 gate **MET — 2 consecutive FULL-base codex clean rounds** (`ffcae28`, no owner override). **Triple-verified** real-Postgres **167/167**: session run (ffcae28) + independent run on merged `main`, incl. **TI-6** named-halt on a seeded cross-tenant `players` row + **TI-7** `0000–0018` byte-identical after 0019. Expand-only DDL on empty tables; diff = 6 files (added `migrate.test.ts` count 19→20). Deeper ledger FKs (`payment_allocations`, `bank_transactions`) deferred to sibling `db-ledger-tenant-integrity-fks`. Design `AUTHORITY_SHA` block below stays pinned at `29635be` (unchanged). |
| 23/07/2026 | v2.2 | **Verdict 17 AMENDED (implementation codex round-01, owner-ratified).** The CODE_READY FK inventory was **incomplete**: `scope_fks` omitted `charges(tenant_id,player_id)->players(tenant_id,id)` despite the block's own problem-statement naming the player and `charges.player_id` being `NOT NULL`. A tenant-B charge with a tenant-A `player_id` (membership NULL) would pass all 7 FKs → cross-tenant money corruption. Corrected in-slice → **8 composite FKs + 3 candidate keys** (players candidate key added). Meta: a design `CODE_READY` verdict ≠ scope-complete — the codex code-review gate caught what `G5_SCOPE: PASS`/`OPEN_QUESTIONS: 0` missed; the gate is load-bearing on CODE_READY P0 money-path slices. |
| 23/07/2026 | v2.1 | **Verdict 17 — `db-session-tenant-integrity-fks` = CODE_READY** tại `main@29635be`. Slice P0 đầu tiên của lớp feature (SessionService prerequisite). Root slice, không dependency chưa merge, không external gate. Đóng lỗ tenant-integrity: 7 composite FK `(tenant_id, session_id)`/`(tenant_id, membership_id)` + 2 candidate key `UNIQUE(tenant_id,id)`, migration `0019` expand-only NOT VALID→probe→VALIDATE. FK inventory quét từ `schema.ts` (không đoán); 3 exclusion có lý do đo được (`session_occurrences` không tenant_id, `public_sessions` HR2, `magic_links.session_id`→web_sessions). `charges.membership_id` nullable → MATCH SIMPLE unenforced-on-NULL là chủ ý. Acceptance TI-1..TI-9; migration count 19→20 ở cả 2 assertion. `REMAINING_BLOCKERS: none` — `schema` bị AP-25 giữ chỉ là hàng đợi register, không phải lỗ hợp đồng. |
| 22/07/2026 | v2.0 | **Verdict 14 AMENDED (owner-ratified A1–A3), patch tại chỗ — slice/authority không đổi, chỉ sửa một dòng gate sai sự thật.** **A2:** bản đầu viết "chỉ nuốt `duplicate_object`" — chép từ backlog **không đo**; thực tế check tồn tại của `CREATE ROLE` không atomic với insert `pg_authid`, bên thua race raise **23505** áp đảo 42710 ~50:1, nên nuốt mỗi 42710 sẽ để nguyên chính cái race cần đóng. Nay **42710 hoặc 23505**; 42501 và mọi mã khác vẫn abort. **A1:** tạo role vô điều kiện abort khi DDL owner `NOCREATEROLE` (Postgres kiểm quyền trước khi thấy trùng) — vi phạm negative-scope #6; thêm existence pre-check. **A3:** test-only, `ALTER ROLE … PASSWORD` đồng thời → retry-tolerant; `test-harness.ts` vào TARGET_FILES + scope. Implementer dừng xin phê duyệt thay vì tự nới contract P0 — đúng gate. |
| 22/07/2026 | v1.9 | **Verdict 15 — DD-87 contract closed on disk, `NOT_CODE_READY` pending immutable authority.** Owner chốt exhaustive tagged union: ambiguity theo `(name,amount)`, equal-amount/different-name vẫn ambiguous, no top-level amount, no second grammar. Exact 18-row + SNA-1..8, manifest/task/AP-29/backlog authored. Closure 9/12 vì packet chưa commit/push; next trigger là origin/main commit chứa toàn bộ target rồi strict re-pin. |
| 22/07/2026 | v1.8 | **Verdict 14 — `db-migration-0000-idempotent-role-create` re-scoped từ `DESIGN_UNFIT` → `CODE_READY`.** Khung cũ ("làm 0000 atomic") bất khả thi vì 0000 applied + immutable; khung mới không đụng 0000. Phát hiện: `pg_advisory_lock` trong `migrate.ts` là **database-scoped**, nên comment "ngăn concurrent deploys interleave DDL" **không đúng cho object cluster-global** — sửa comment nằm trong scope. Cơ chế pin: role-ensure exception-handled ở runner, gated trên "0000 chưa applied". Acceptance BR-1..BR-7. Mở khoá `fileParallelism:true` (lý do (1) đã thoả sẵn nhờ `dbName` riêng). |
| 22/07/2026 | v1.7 | **Verdict 13 — d1b implemented (`04df464`), chờ merge tay.** 14 file, +984/−68; suite db 152 · web 146. Chọn handoff shape (a): migration `0018` expand-only + `auth_oauth_handoff_arm/_consume`; single-use bằng atomic UPDATE + partial UNIQUE giữ hash sau consume; `clock_timestamp()` (mang bài học D0a round-09). **Gate ĐẠT với 0 fix-round — slice đầu tiên sạch ngay lần đầu.** Ghi phát hiện quy trình: thrash tương quan với **thiết kế còn chuyển động lúc code**, không phải kích thước diff ⇒ **rút lại đề xuất nới luật 2×clean ở v1.2**. Safari/iOS vẫn ENABLEMENT_ONLY. |
| 22/07/2026 | v1.6 | **Verdict 12 — d1b `CODE_READY`, blocker đóng bằng đo đạc.** Probe 3 engine: **M1 (302 trần) thất bại trên cả ba**; mọi cơ chế commit first-party document trước đều thắng. Chốt **M3** (landing → auto-POST same-origin, noscript fallback) vì tái dùng pattern hai-hop B0 §8 và POST mang `Origin` cho `sameOriginRequest()` guard bước mutating. Thêm **D1B-11** anti-regression (assert callback trả document, **không** 302) — lưới bắt đúng failure-mode đã đo. Safari/iOS chuyển thành **ENABLEMENT_ONLY**: không chặn CODE_READY nhưng **chặn bật Google login**. |
| 22/07/2026 | v1.5 | **Acceptance `D1B-1..D1B-10` + Verdict 11 cho `auth-s4-d1b-oauth-session-rotation` = `NOT_CODE_READY`.** Live-repo verify cho thấy slice **không cần primitive mới** (`issueSession` đã có nhánh rotate; `auth_rotate_web_session` đã atomic từ D0a) — chỉ cần chạy nó ở ngữ cảnh same-site. **Blocker duy nhất:** cơ chế hop chưa pin; cookie `SameSite=Strict` có được gửi trên chuỗi redirect khởi phát cross-site hay không là browser-divergent, và chọn sai thì slice âm thầm vô dụng trong khi test mock vẫn xanh. D1B-2 vì thế bắt buộc bằng chứng **trình duyệt thật**. |
| 22/07/2026 | v1.4 | **Verdict 10 — `auth-s4-d1-google-adapter` implemented (`75bfa58`), chờ merge tay.** 17 file, +2841/−9; suite real-PG db 144 · core 111 · bot 3 · web 131; semgrep 0; OSV sạch sau khi thêm `jose@5`. Codex 6 vòng: 1–3 hội tụ, 4–6 lộ một vấn đề **ngoài matrix** (rotate session Strict qua callback cross-site) → phần rotation invented-scope đã **revert** về mint-fresh đúng D1-2/D1-13. **Accepted residual risk** + **enablement blocker `auth-s4-d1b-oauth-session-rotation`** ghi vào verdict và pin bền 3 nơi. Tạo artifact d1b (manifest + backlog block, `NOT CODE_READY` — còn thiếu acceptance + verdict). |
| 22/07/2026 | v1.3 | **Verdict 9 — `auth-s4-d1-google-adapter` = CODE_READY** tại `main@8f6a051`. Ba dependency đã merge + probe live; acceptance D1-1..15 có sẵn nên đây là **verdict-only gap**, nhưng vẫn re-verify từng precondition trên schema live (bài học D1E-18) thay vì tin matrix cũ. Verdict 4 (PLAN_READY, G3 FAIL) chính thức bị thay thế. |
| 22/07/2026 | v1.2 | **D1 email-token-core implemented → Verdict 8.** 7 file, +2555/−7, 128 test real-PG xanh. Gate đóng bằng **1 vòng sạch + independent directed review** (Codex phi tất định sau 9 vòng), không phải 2×clean — override thứ 2/3 slice. **D1E-18 tách 18a/18b**: 18a proven, 18b deferred-by-construction vì `link_codes` live là person/channel-scoped, account-issued link_code + merge plan thuộc order-4 (đã pin NEXT_REVIEW_TRIGGER). Manifest hợp thức hoá 2 scope-addition (`index.ts`, `README.md`). **Đề xuất hiệu chỉnh gate:** `review-code-readiness-gate.md` nên cho phép *"2 vòng sạch liên tiếp HOẶC 1 vòng sạch + independent directed review"* khi diff vượt ngưỡng file/LOC, để không phải override từng ca. |
| 22/07/2026 | v1.1 | **D1 email-token-core: NOT_CODE_READY → CODE_READY.** Author acceptance matrix **D1E-1..D1E-22** (tech doc §5, gồm reset-vs-consume + merge barrier mà manifest nêu là điều kiện READY) và **Verdict 7** pin `main@fc7d0a4`. Pin hai ranh giới: public verify/reset/login = order-4; DD-70(a) fence ngoài scope order-2. Chưa có code/migration — đây là authorization để mở worktree. |
| 22/07/2026 | v1.0 | **D0b implemented & merged — gate ĐẠT, không override.** `auth-s4-d0-session-web-boundary` squash-merged tại `main@93c5404` (issuance fence + logout-all route, zero DB change); 2 clean round liên tiếp (round-03/04), 2 fix round; real-PG green (db 97/97 · web 78). Thêm **Verdict 6** (historical evidence). Chuỗi auth: D0a ✅ → D0b ✅ → kế tiếp `auth-s4-d1-email-token-core`. |
| 22/07/2026 | v0.9 | Thêm machine classification theo readiness gate v1.2: giữ nguyên nội dung verdict lịch sử nhưng exclude chúng khỏi current authorization; Verdict 2 là active block duy nhất, D0b phải re-review sau dependency-state change. |
| 20/07/2026 | v0.8 | **D0a implemented & merged via owner override.** `auth-s4-d0-revoke-core` squash-merged (migration `0015`); 2-clean P0 gate not reached after 12 Codex rounds → closed on manual review + acceptance 22/22 + real-PG 97/97. Verdict 5a stands as CODE_READY authority; this row records the merge + override rationale. D0b unblocks on origin/main. |
| 20/07/2026 | v0.7 | DD-80 v1.88 closes Gate 3 with exact epoch equality, cross-account parent ordering/revalidation and atomic row materialization/count/audit; historical Verdict 3 superseded. Added fail-closed Verdict 5a/5b for D0a DB core and D0b web boundary; both await immutable authority, and D0b also awaits D0a merge. |
| 19/07/2026 | v0.6 | **v1.86 (AP-26 HALT MAX_ROUNDS/Codex round-03):** Verdict 3 amend — D0 thêm issuance fence `session-cookies.ts` (reject-and-reauth, không fallback-mint khi rotate null) + partial index `web_sessions(account_id) WHERE revoked_at IS NULL` trong 0015 (case D0-12/D0-13, tech v2.9b); giữ CODE_READY. Verdict 4 note — `auth_login_google` nhận preallocated `account_emails.id` cho cell 1 (AAD §3.3 giữ nguyên); giữ PLAN_READY. |
| 19/07/2026 | v0.5 | **v1.83 (AP-26 HALT v2):** Verdict 3 amend — migration D0 thêm rotate parent-first replace (đóng deadlock), auth_audit_events tạo tại D0 (order-2 reuse), scope thêm packages/db/src/index.ts. Verdict giữ CODE_READY với wording rollback mới; số migration theo tail thực tế (tech v2.9). |
| 19/07/2026 | v0.4 | **v1.78 corrections:** Verdict 4 thêm hard dependency order-2 `auth-s4-d1-email-token-core` (manifest mới, dark) + oauth migration dời 0017; D1-15 absence-check; PKCE lifecycle CHECK theo v1.78. Verdict 3 (D0) không đổi. |
| 19/07/2026 | v0.3 | **B0 → DD-80 ✅ (v1.77):** thêm Verdict 3 (`auth-s4-d0-revoke-core` = **CODE_READY**, authority `352e6ec`) + Verdict 4 (`auth-s4-d1-google-adapter` = PLAN_READY chờ D0 merge). Artifacts: 2 manifest + acceptance D0×10/D1×15 trong web_auth tech v2.8. RUN precondition: merge docs authority lên main trước khi mở worktree. |
| 19/07/2026 | v0.2 | **Reframe theo canonical gate.** Bỏ framework G1–G6 tự chế (trùng `review-code-readiness-gate.md`); đổi tên `ready-to-code-gate.md` → `slice-readiness-verdicts.md`; thay bằng verdict §7 pinned SHA `main@22c23aa` cho auth-s4 (NOT_PLAN_READY, chờ B0) và dd41 (NOT_CODE_READY, chờ DD-38/39 merge). |
| 19/07/2026 | v0.1 | (retired) 6-condition gate tự chế — superseded bởi canonical gate. |
