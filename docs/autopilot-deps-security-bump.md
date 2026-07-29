# Task contract — `deps-security-bump` (Level 3)

> **Đây là task contract theo `docs/autopilot-templates/level3-workflow.md` §3, KHÔNG phải readiness
> verdict.** File này cố ý không mang `REVIEW_VERDICT:` và không đặt tên khớp `review|readiness|plan`,
> nên `check-review-readiness.mjs` không coi nó là candidate — đúng ý: nó **không cấp phép** gì cả.
> Authority thi hành vẫn là `docs/autopilot-manifests/deps-security-bump.json`.
> Soạn 2026-07-29 tại `main@3d75c90`, cho slice có `not_before: 2026-07-30`.

```text
LEVEL3_WORKFLOW: required
TASK_START_STATE: new_after_template_effective
AUTONOMY_MODE: supervised
```

## Vì sao có file này

Task này là slice `ready`-được duy nhất trong hàng đợi sau ngày 30/07, và manifest của nó đã nêu sẵn ba
item design-probe. **Item (b) nay đã đo xong, và kết quả không phải cái manifest phỏng đoán** — nó lớn hơn
một major bump. Ghi ra đây thay vì để phiên chạy tự phát hiện lại, vì phép đo đã có và việc lặp lại nó tốn
một vòng probe; nhưng `_evidence_rules` của manifest vẫn có hiệu lực: **đo lại tại thời điểm chạy**, dưới
đây là bằng chứng thời điểm 29/07, không phải giấy phép bỏ qua phép đo.

---

## §3 Task contract

```text
TASK_ID: deps-security-bump
OUTCOME: `Security / OSV full dependency scan` xanh trở lại trên main cho next · postcss ·
  brace-expansion, mà KHÔNG hạ bất kỳ control supply-chain nào (minimumReleaseAge · trustPolicy ·
  blockExoticSubdeps giữ nguyên byte).
REPOSITORY_AND_BASE: Plexco app · base `main` · pin SHA tại thời điểm mở worktree (29/07 là
  `3d75c90d32bd52b8704794216fdcad63d54261e8`; RE-PIN nếu main đã tiến).
CONTEXT_SOURCES:
  - docs/autopilot-manifests/deps-security-bump.json  (authority — _scope_in/_scope_out/_acceptance/_evidence_rules)
  - package.json `pnpm.overrides`  ·  pnpm-workspace.yaml `overrides`  ·  pnpm-lock.yaml
  - .github/workflows/security.yml (osv-scanner-action v2.3.8, pinned SHA 9a49870)
  - GHSA-mh99-v99m-4gvg / CVE-2026-14257  (advisory gốc, KHÔNG đọc qua bên thứ ba)
  - file này §Bằng chứng
APPLICABLE_SKILLS: none — thuần dependency/lockfile, không có skill nào áp dụng.
SCOPE: package.json · pnpm-workspace.yaml · pnpm-lock.yaml · docs/autopilot-manifests/deps-security-bump.json
NEGATIVE_SCOPE: không sửa file nguồn nào; không đổi security.yml; không tạo/sửa osv-scanner.toml để
  ignore finding; không `--ignore-scripts` / `--no-frozen-lockfile`; không nâng dependency nào ngoài ba
  cái tên; không hạ `minimumReleaseAge` toàn cục.
RISK: P1
AUTONOMY_MODE: supervised  (P1 ⇒ isolated worktree, full verification, independent review, human merge)
MODEL_POLICY: primary planner/worker; code gate = `scripts/codex-review-pin.sh` 2× clean FULL-base.
  **Slice này chạm supply-chain ⇒ chạy thêm 1 vòng security-focused.** Reviewer không gọi được →
  `HALT TOOL_UNAVAILABLE`, cấm tự hạ gate.
SANDBOX_AND_PERMISSIONS: cần network cho `pnpm install` + `npm view` + osv-scanner. Không secret.
  Không side effect ngoài repo. Merge do owner.
HUMAN_DECISIONS_REQUIRED: **một, và nó chặn slice** — xem §Quyết định owner bên dưới.
SLICE_GRAPH: một slice, không fan-out. Ba package chia sẻ đúng một file (`pnpm-lock.yaml`) nên
  song song hoá là tự tạo va chạm.
WORKTREE_PLAN: `.autopilot/worktrees/deps-security-bump` · branch `feat/deps-security-bump` ·
  register `scripts/autopilot-scope-gate register --manifest docs/autopilot-manifests/deps-security-bump.json`
  trước khi ghi. Invariant `build-config` — kiểm không slice nào khác đang giữ.
VERIFICATION: DSB-1..DSB-9 trong manifest + full CI list (typecheck · format:check · review:check ·
  lint · build · db:bootstrap · test với `DATABASE_URL_TEST`). Baseline test count **561** — đổi số
  nghĩa là dependency đổi hành vi, phải điều tra chứ không nghiệm thu.
CODE_REVIEW: bắt buộc, 2× clean liên tiếp FULL-base, cùng HEAD.
SECURITY_REVIEW: bắt buộc (supply-chain).
BUDGETS: MAX_ROUNDS 5 · REGION_THRASH 3 cùng vùng ⇒ HALT.
STOP_CONDITIONS: STOP_AT_READY. HALT nếu (a) bất kỳ version đích còn trong cửa sổ 7 ngày ngày chạy,
  (b) bump nào đòi sửa code để build/pass, (c) quyết định owner dưới đây chưa có.
DELIVERABLES: diff 4 file · design-probe.md · bằng chứng OSV trước/sau · READY report.
```

---

## Bằng chứng đo 2026-07-29 — ba item probe của manifest

### Item (a) — override nằm ở hai chỗ: XÁC NHẬN, và nguy hiểm hơn mô tả

Live tại `3d75c90`:

| Nơi | Nội dung |
|---|---|
| `package.json` → `pnpm.overrides` | `"brace-expansion@1": "^1.1.16"` · `"sharp": "^0.35.0"` · `"postcss": "^8.5.10"` |
| `pnpm-workspace.yaml` → `overrides` | `"esbuild@<0.25.0": 0.25.12` · `"postcss@<8.5.10": 8.5.16` |

`postcss` có mặt ở **cả hai**, và hai bên **không cùng dạng**: `package.json` khai một floor
(`^8.5.10`), `pnpm-workspace.yaml` khai một **rewrite có điều kiện** (`postcss@<8.5.10` → `8.5.16`).
Lock hiện resolve `postcss@8.5.16`.

**Bẫy cụ thể, không phải cảnh báo chung chung:** nâng riêng `package.json` lên `^8.5.18` **không**
kéo `pnpm-workspace.yaml` theo. Rewrite `postcss@<8.5.10 → 8.5.16` vẫn đứng nguyên, nên mọi transitive
`postcss` dưới 8.5.10 tiếp tục hạ cánh xuống **8.5.16 — đúng phiên bản đang bị advisory**. Kết quả:
`package.json` trông đã vá, OSV vẫn đỏ, và người sửa tin là mình đã xong. Phải sửa **cả target
`8.5.16` → `8.5.18` lẫn ngưỡng `<8.5.10`** cho nhất quán. DSB-4 tồn tại đúng vì chuyện này.

### Item (b) — brace-expansion: bẫy đã kích hoạt, và nó KHÔNG dừng ở "major bump"

Advisory gốc **GHSA-mh99-v99m-4gvg / CVE-2026-14257** (High, CVSS 7.5, publish 2026-07-23):

- **Affected: `<= 5.0.7`** — một dải liên tục duy nhất. `1.1.16 <= 5.0.7` theo thứ tự semver, nên dải
  này **nuốt trọn nhánh v1 và v2**.
- **Patched: `5.0.8`** — chỉ một. **Không có `1.1.17`.** Nhánh v1 không có bản vá in-range.

⇒ Điều kiện mà manifest nêu (*"nếu nhánh v1 không có bản vá in-range thì ép transitive v1 lên v5 là
major bump = quyết định"*) **đã thoả**. Nhưng phép đo đi xa hơn một bước và đảo ngược kết luận:

**(b1) v1 thật sự dính, không phải false positive của dải semver.** Đọc thẳng
`node_modules/.pnpm/brace-expansion@1.1.16/.../index.js`: cùng một pattern — `expansions.length < max`
chặn **số lượng** kết quả, không chặn **độ dài**; cùng đệ quy `expand(m.post, max, false)`. Tệ hơn v5 ở
một điểm: `var max = options.max == null ? Infinity : options.max` — **mặc định `Infinity`**, trong khi
v5 mặc định `100_000`. Dải `<= 5.0.7` ở đây là đúng thực chất, không phải quét bừa.

**(b2) Nhưng ép v1 → v5 sẽ LÀM VỠ RUNTIME, không chỉ là "major bump".**

| | export shape |
|---|---|
| `brace-expansion@1.1.16` | `module.exports = expandTop` — export **một hàm** |
| `brace-expansion@5.0.7` CJS | `exports.expand = expand; exports.EXPANSION_MAX = ...` — export **một object** |

Consumer duy nhất của v1 là `minimatch@3.1.5`, và nó dùng đúng shape cũ:
`var expand = require('brace-expansion')` rồi gọi `expand(...)` như hàm. Với v5, `require()` trả về
object ⇒ **`expand is not a function`**. Override `"brace-expansion@1": "^5.0.8"` không phải một bump
rủi ro cao — nó là một bump **hỏng chắc chắn**, và `pnpm install` sẽ **không** phát hiện ra: lỗi chỉ nổ
lúc gọi.

**(b3) Exposure thật của nhánh v1 = 0, và không cùng loại với exposure-0 của cả repo.**
`minimatch@3.1.5` chỉ được kéo bởi `@eslint/config-array@0.21.2`, `@eslint/eslintrc@3.3.5`, `eslint@9.39.4`
— **toàn bộ là devDependency của lint**, không có đường vào runtime, và input là glob trong file config do
chính team viết, không phải input từ attacker. Khác với lập luận "chưa deploy nên exposure 0" (đúng
nhưng tạm thời), cái này **đúng cả sau khi deploy**.

⇒ Ba lối, xếp theo khuyến nghị:

1. **KHUYẾN NGHỊ — bỏ `brace-expansion@1` khỏi phạm vi bump, nâng eslint để nhánh v1 tự biến mất.**
   Truy nguyên `minimatch@3` là dependency của eslint toolchain; bản eslint mới hơn dùng
   `minimatch@10` → `brace-expansion@5`. Sửa được gốc, không phải ép override. Rủi ro: có thể kéo
   theo eslint major, vượt `_scope_out` ("không nâng dependency nào ngoài ba cái tên") ⇒ **cần owner
   nới scope một cách tường minh**, không tự nới.
2. **Chấp nhận rủi ro tồn dư có thời hạn** — giữ `brace-expansion@1.1.16`, thêm entry
   `osv-scanner.toml` ignore **có lý do và có hạn dùng** cho đúng advisory này trên đúng nhánh v1, nêu
   rõ dev-only + không có input untrusted. Đổi lại: `_scope_out` của manifest **cấm tuyệt đối** sửa
   `osv-scanner.toml` để ignore ⇒ đây là **ngoại lệ policy, chỉ owner cấp được**.
3. **KHÔNG LÀM — ép `"brace-expansion@1": "^5.0.8"`.** Đây là lối một agent làm theo OSV một cách
   máy móc sẽ chọn, lockfile sẽ resolve sạch, OSV sẽ xanh, và lint sẽ chết lúc chạy. Ghi ra đây để nó
   bị loại có chủ đích chứ không phải bị bỏ sót.

`next` và `postcss` **không** dính nút thắt này và bump được độc lập.

### Item (c) — next: chưa đo, để lại cho probe

Manifest phỏng đoán `apps/web` đã khai `^15.1.4` nên `15.5.21` nằm trong range và có thể chỉ cần refresh
lock, không cần override. **Chưa xác nhận trong phiên này** — chưa đọc `apps/web/package.json`. Giữ
nguyên là item probe, không đưa vào file này như đã biết.

---

## ✅ Quyết định owner — CHỐT 2026-07-29: TÁCH ĐÔI

> **Slice này nay chỉ còn `next` + `postcss`. `brace-expansion` ra khỏi scope**, đóng qua slice mới
> `eslint-10-migration`. Manifest đã cập nhật (`_owner_decision`, `_scope_in/_scope_out`, `DSB-2b`).
> Backlog block đã lên `status: ready`.
>
> **Phần dưới là chẩn đoán gốc — giữ nguyên, nhưng nó đề xuất một lối mà phép đo sau đó BÁC BỎ.**
> Lối 1 viết là *"nâng eslint toolchain để nhánh v1 tự biến mất"*. Đo ra: **`eslint@9.39.4` tự nó phụ
> thuộc `minimatch 3.1.5`** (cùng `@eslint/config-array@0.21.2` và `@eslint/eslintrc@3.3.5`), và
> `^9.18.0` đã resolve tới bản 9.x mới nhất — nên **không gì trong dải `^9` gỡ được nhánh v1**. Lối 1
> chỉ chạy ở **eslint v10**, vốn liệt kê `501abd0 feat!: update dependency minimatch to v10 (#20246)`
> trong Breaking Changes.
>
> Điều đó biến lối 1 từ "nới scope một dòng" thành **một major toolchain upgrade** — và đồng thời làm
> nó dễ chấp nhận hơn nhiều, vì **ESLint v9.x EOL 2026-08-06**: upgrade này phải làm trong tuần này bất
> kể advisory. Nhưng chính vì thế nó thuộc slice riêng, không phải slice dependency-floor.
>
> **Đã sai hai lần ở đây, cùng một cơ chế:** manifest gốc đoán "major bump" (thật ra là vỡ runtime);
> tôi đoán "nâng eslint là đủ" (thật ra cần v10). Cả hai đều là suy từ hình dạng vấn đề thay vì đọc
> cây phụ thuộc thật. Ghi lại vì slice tiếp theo sẽ bị cám dỗ đoán tiếp về `typescript-eslint`.

## Quyết định owner (chẩn đoán gốc, giữ để đối chiếu)

**Câu hỏi:** xử lý `brace-expansion@1.1.16` theo lối nào?

Lối 3 đã bị loại bằng đo. Lối 1 và lối 2 **đều đòi nới một ràng buộc của manifest**, nên không lối nào
chạy được dưới scope hiện hành:

- Lối 1 vi phạm `_scope_out` *"NO unrelated dependency upgrades riding along"* (phải nâng eslint).
- Lối 2 vi phạm `_scope_out` *"NO edit to osv-scanner.toml to ignore a finding"*.

**Đề xuất: lối 1**, và nới `_scope_out` đúng một dòng — cho phép nâng eslint toolchain **với mục đích
duy nhất là loại bỏ nhánh `minimatch@3`/`brace-expansion@1`. Lý do: nó sửa nguyên nhân thay vì che triệu
chứng, không để lại ignore-entry phải nhớ dọn, và eslint là dev-only nên bán kính vụ nổ nằm gọn trong CI
— hỏng thì lint đỏ ngay, không âm thầm.

Nếu owner chọn lối 2, ignore-entry **phải có ngày hết hạn**, cùng nguyên tắc mà owner đã áp cho
`minimumReleaseAge` ngày 26/07: ngoại lệ là per-package, có lý do, có hạn dùng — không phải hạ control.

## Việc phải làm trước khi mở worktree

1. Owner chốt lối 1 hay lối 2 (nếu lối 1: nới `_scope_out` trong manifest **trước**, không nới trong lúc chạy).
2. Đo lại publish date bằng `npm view <pkg> time --json`, đọc **đúng key version** — `time.created` là
   lần publish đầu tiên của package và là field sai (ngày 26/07 nó trả về 2011 cho `next`).
3. Re-pin `REPOSITORY_AND_BASE` theo tip `origin/main` thật lúc đó.
4. Ghi `.autopilot/state/deps-security-bump/design-probe.md` — chép §Bằng chứng ở trên vào và **đo lại**
   item (a)/(b), thêm item (c), rồi STOP chờ founder confirm. `.autopilot/*` gitignored nên probe chỉ
   sống trong worktree: mọi kết luận cần giữ lâu phải quay ngược về file này hoặc manifest.

## Changelog

| Ngày | Version | Thay đổi |
|---|---|---|
| 29/07/2026 | v0.2 | **Owner chốt TÁCH ĐÔI; lối 1 của v0.1 bị chính phép đo bác bỏ.** v0.1 đề xuất "nâng eslint toolchain" — nhưng `eslint@9.39.4` TỰ NÓ phụ thuộc `minimatch 3.1.5`, và `^9.18.0` đã resolve tới 9.x mới nhất, nên không gì trong dải `^9` gỡ được nhánh v1. Chỉ **eslint v10** làm được (`501abd0 feat!: update dependency minimatch to v10 (#20246)` trong Breaking Changes v10.0.0). Điều đó biến lối 1 thành major toolchain upgrade ⇒ tách thành slice `eslint-10-migration`, và nó vốn **bắt buộc phải làm trước EOL 2026-08-06** bất kể advisory. Slice này thu về `next` + `postcss`; thêm `DSB-2b` bắt hai dòng `brace-expansion` **byte-unchanged** (lệch = HALT, nghĩa là slice drift vào package đã loại). Chi phí chấp nhận: OSV còn đỏ ở `brace-expansion` vài ngày — đổi lấy việc không để lại ignore-entry phải nhớ dọn. Backlog block → `status: ready`. |
| 29/07/2026 | v0.1 | Soạn task contract Level 3 §3 tại `main@3d75c90`. Đo xong item (a) (xác nhận bẫy hai-chỗ, chỉ rõ cơ chế: rewrite `postcss@<8.5.10 → 8.5.16` không tự theo khi nâng floor ở `package.json`) và item (b) (GHSA-mh99-v99m-4gvg affected `<= 5.0.7` / patched `5.0.8` duy nhất ⇒ nhánh v1 không có bản vá in-range; v1.1.16 xác nhận dính thật với `max` mặc định `Infinity`; **ép v1→v5 làm vỡ `minimatch@3` vì đổi export shape hàm→object**; nhánh v1 chỉ do eslint kéo nên dev-only). Loại lối "ép override lên v5" bằng bằng chứng. Nêu quyết định owner chặn slice: cả hai lối còn lại đều đòi nới `_scope_out`. Item (c) để mở, chưa đo. |
