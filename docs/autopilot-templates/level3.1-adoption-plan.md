<!-- review-readiness: enforce -->
<!-- classification: blocker audit + slice plan. KHÔNG phải coding handoff.
     Verdict active là NOT_CODE_READY ⇒ file này KHÔNG authorize register/write/merge.
     Muốn code: đóng blocker ở §7, re-review, đổi sang <!-- review-readiness: code-ready --> khi đạt strict CODE_READY. -->

# Level 3.1 — adoption plan cho Plexco

> **Quan hệ với `level3.1-design-discussion.md`:** file kia là draft `workflow-authority: none` với 5 câu
> hỏi mở. File này ghi lại **4 quyết định owner ngày 2026-08-09**, kết quả **Bước 0 đo lại tại v31**, và
> land order đã sửa theo quyết định đó. File này vẫn **không** authorize coding.
>
> **Đây là consumer-local plan.** Owner chọn hướng Plexco-local trước, canonical sau — xem §3 để biết cái
> giá đã chấp nhận.

---

## 1. Bước 0 — re-pin authority (§0 của discussion doc)

Discussion doc pin snapshot `[B]`/`[C]` ở **KIT_VERSION 25, ngày 2026-07-31**, và tự cảnh báo đó là
immutable snapshot chứ không phải alias cho "current". Đo lại 2026-08-09:

| Tầng | Snapshot cũ (31/07) | Đo lại (09/08) | Kết luận |
|---|---|---|---|
| `[B]` canonical | `86fafd5d…`, KIT 25 | `ab49fdef6cec21cca2909cdfe832749c76319a61`, `HEAD == origin/main`, `autopilot/` clean (worktree + index + untracked) | ✅ đủ điều kiện đọc evidence |
| `[C]` Plexco | `0c5808fc…`, KIT 25 | `64e9ccb8ac1b1079f85c3b646d9db99a183632f0`, `HEAD == origin/main`, **KIT_VERSION 31** | ✅ authority path clean |
| `[D]` uncommitted | — | 3 authority path (`autopilot-scope-gate`, `autopilot-review-readiness.mjs`, `codex-review-pin.sh`) đều **CLEAN** | ✅ loại khỏi evidence đúng cách |

**Ba claim cốt lõi của discussion doc vẫn đúng ở v31** — snapshot mục ở số hiệu, không mục ở kết luận:

| Claim | Trạng thái 09/08 | Bằng chứng đo được |
|---|---|---|
| P1 — validator pin cứng `level3-operational-v2` | ✅ còn đúng | `autopilot-review-readiness.mjs:273-274` (`!== "level3-operational-v2"` → `halt("CONTRACT_INVALID")`); `autopilot-scope-gate:547,550,607,640` |
| P2 — ledger là hoá thạch | ✅ còn đúng | `.autopilot/maturity-ledger.md` 932 byte, **mọi `clean_ready_runs_merged_unchanged` = 0**; `.gitignore:57` giữ exception |
| Phase 0 — ba gap còn hở | ✅ cả ba còn hở | gap 1: `codex-review-pin.sh` không có assert scope-binding, chỉ prose ở L89 · gap 2: **zero** HALT token phân loại auth/quota/entitlement · gap 3: `fix-round-count` không có nhánh loại trừ infra-flake |

**Không mục nào của §2 được đánh dấu superseded** — canonical chưa giải quyết mục nào trong 6 đề xuất.

---

## 2. Bốn quyết định owner — 2026-08-09

| # | Câu hỏi §8 | Quyết định | Hệ quả bắt buộc |
|---|---|---|---|
| D1 | Hướng land | **Plexco-local trước, canonical sau** | Plexco fork khỏi kit v31 kể từ slice đầu tiên. Bắt buộc §3. |
| D2 | Phase 0 tiên quyết? | **Chạy song song với P4/P5** | Chỉ đúng một phần — xem §4, có va chạm file thật. |
| D3 | P1 schema v3 | **Nhận, có cửa sổ chuyển tiếp v2/v3** | `design_contract` chỉ bắt buộc khi v3. Không retrofit v2 active. |
| D4 | P2 ledger | **Giết hẳn** (owner giao quyết định theo lợi ích dài hạn) | Xem §2.1 — quyết định bằng bằng chứng, không bằng sở thích. |

### 2.1 D4 — vì sao chọn giết, không chọn cứu

Owner giao *"chọn option nào mang lại lợi ích tối đa và long term"*. Đo trước, chọn sau:

- **Zero consumer.** 16/16 manifest khai `"autonomy_mode": "supervised"`. Không manifest, contract, hay
  state file nào khai `proactive_routine`.
- **Zero writer.** Consumer duy nhất của ledger trong toàn repo là `autopilot-onboard.sh:236`, và nó chỉ
  kiểm **file có tồn tại không**. Không script nào increment. Sổ tự dặn *"never edit by hand to inflate"*
  nhưng không ai ghi bằng máy — nên nó không thể sai, cũng không thể đúng.
- **Mục đích gốc đã bị bác.** Ledger tồn tại để phục vụ `auto_merge_after_2x_codex_clean` của GENERIC
  v0.6.0. §5 của chính discussion doc kết luận *"Bỏ là đúng"*. Giữ sổ ghi công cho một cơ chế đã bỏ là
  giữ một cái bóng.
- **Cứu nó xung đột với ràng buộc git thật của Plexco.** §8 cảnh báo durable append buộc `ap-finish.sh`
  **mutate default worktree**. Plexco commit/merge chạy trên máy owner qua root-lock + `ap-merge.sh`;
  thêm một writer vào default worktree trong `ap-finish` là thêm đúng lớp tranh chấp mà root-lock sinh ra
  để dập.

Lợi ích dài hạn nằm ở phía **giảm bề mặt drift**: một luật không đo được là luật sẽ bị viện dẫn sai lúc
tranh cãi. Đó cũng chính là điều §5 phê phán khi nói về 26 breaker đánh số.

**Phạm vi xoá (D4):** `.autopilot/maturity-ledger.md` · `.gitignore:55-57` · `proactive_routine` ở
`autopilot-review-readiness.mjs:316` + `level3-workflow.md:47,72,172,385` · 3 chỗ nhắc `maturity-ledger`
trong `autopilot-ONBOARDING.md` · `autopilot-onboard.sh:236` · block `level3-workflow` trong `CLAUDE.md`.

---

## 3. Cái giá của D1 — ghi rõ, không giấu

Discussion doc khai target là canonical kit, *"Plexco là consumer, sync sau"*. D1 đảo hướng đó. Chấp nhận
được, nhưng ba hệ quả phải nằm trên giấy:

1. **Plexco fork khỏi kit v31.** Kể từ slice đầu tiên, `scripts/autopilot-*` của Plexco ≠ canonical. Mọi
   lần sync canonical sau này là **merge tay**, không phải copy đè.
2. **Nợ backport là nợ có chủ.** Mỗi slice land ở Plexco phải mở một backport item tương ứng; không có thì
   fork thành vĩnh viễn và các project khác (payment bot, Sporta) không hưởng.
3. **KIT_VERSION phải rẽ nhánh có kỷ luật.** Không được bump `KIT_VERSION` của Plexco lên số canonical
   chưa có. Dùng hậu tố consumer (vd `31+plexco.1`) để `autopilot-onboard.sh` và mọi so sánh version
   không đọc nhầm fork thành canonical.

---

## 4. Land order đã sửa theo D2 — và va chạm phải serialize

D2 chọn Phase 0 chạy song song P4/P5. **Đúng một phần.** Level 3 §7 quy định 1 writing slice = 1 branch =
1 worktree = tối đa 1 writer, và slice dùng chung file phải chạy tuần tự. Đo file thật:

| Slice | Target file chính | Va chạm |
|---|---|---|
| Phase 0 gap 1 (scope binding) | `scripts/codex-review-pin.sh` | ⛔ với gap 2, P5 |
| Phase 0 gap 2 (auth-tier token) | `scripts/codex-review-pin.sh` | ⛔ với gap 1, P5 |
| Phase 0 gap 3 (infra-flake ≠ budget) | `ap-watch.sh` / `autopilot-scope-gate` / readiness | ✅ độc lập |
| P4 (fixture harness + chuẩn fixture) | thư mục fixture mới + CI kit | ✅ độc lập |
| P5 (reviewer attestation) | `scripts/codex-review-pin.sh` + validator | ⛔ với gap 1, gap 2 |

**Ba slice cùng ghi `codex-review-pin.sh` ⇒ không thể song song.** Land order khả thi gần nhất với D2:

```text
Làn A (tuần tự, cùng ghi codex-review-pin.sh):
  P4-standard  →  Phase0-gap1  →  Phase0-gap2  →  P5
Làn B (song song với A, không đụng file của A):
  Phase0-gap3
Sau khi A và B đóng:
  P1 (schema v3)  →  P3 (light profile)  →  D4-kill  →  P6 (docs cleanup)
```

Hai ràng buộc thứ tự không được đảo:

- **P4-standard đi trước Phase 0**, dù §7 xếp ngược. Lý do: P4 quy định *"ba gap Phase 0 mỗi cái để lại
  một regression fixture theo đúng chuẩn trên"* — chuẩn phải tồn tại trước khi fixture viết theo nó, nếu
  không phải viết lại cả ba.
- **P1 sau Phase0-gap3.** §3 nói thẳng: gap 3 làm hỏng chính tín hiệu `MAX_ROUNDS` mà P1 dựa vào để biện
  minh. Nhận D3 không có nghĩa được bỏ qua ràng buộc này.

**Mọi slice ở đây đều là kit-maintenance.** Theo P3, `gate_profile: light` **không bao giờ** áp dụng cho
diff chạm reviewer wrapper, scope/readiness validator, manifest schema hay review-readiness gate — kể cả
file `.md`/`.sh`. Và §7: không slice nào được tự certify bằng gate mà chính nó đang sửa.

---

## 5. P1 — hình dạng cửa sổ chuyển tiếp v2/v3 (theo D3)

- `design_contract` chỉ tồn tại trong `manifest_schema_version: level3-operational-v3`.
- Validator + scope-gate sửa **phối hợp**, chấp nhận cả `v2` lẫn `v3` trong cửa sổ chuyển tiếp; điểm sửa
  đã đo: `autopilot-review-readiness.mjs:273-274` và `autopilot-scope-gate:547,550,607,640`.
- **Không retrofit manifest v2 nào đang active.** Runtime manifest bị hash-lock sau `register`; thêm
  trường = ép `MANIFEST_DRIFT`, không phải nâng cấp. Lane `chat-dm-safety-authority-core--v2` đang đỗ
  sống hết vòng đời ở v2.
- **Không** thêm `manifest_schema_version` vào authored contract dưới `docs/autopilot-manifests/` —
  `scope-gate:548` nói rõ authored contract mang trường này sẽ HALT `CONTRACT_INVALID`.
- Giới hạn phải nói thẳng: gate kiểm **sự tồn tại và thời điểm** của bảng quyết định, không kiểm bảng
  **đúng** không. Giá trị nằm ở chỗ ép viết trước khi code.

---

## 6. Phạm vi phủ định của chính plan này

Không sửa `scripts/` trong plan này · không register manifest · không mở worktree · không bump
`KIT_VERSION` · không chạm lane `chat-dm-safety-authority-core--v2` · không đụng migration/schema sản
phẩm · không backport lên canonical trong cùng slice với thay đổi Plexco.

---

## 7. Blocker — phải đóng trước khi slice đầu tiên được register

| # | Blocker | Owner | Điều kiện đóng (nhị phân) |
|---|---|---|---|
| B1 | **Lane `chat-dm-safety-authority-core--v2` HALT `BASE_STALE`, cần re-register chứ không resume được.** Đo 2026-08-09: quota reset, AWAIT đã clear, nhưng `ready` HALT vì `686f99f` (docs reorg) dời chính contract của lane sang `docs/autopilot/contracts/` và đụng `backlog` + `manifest` — cả ba đều nằm trong declared scope. Luật v21 so lịch sử `origin/main` từ `base_sha`, nên **rebase không gỡ được**; `base_sha` hash-locked (`MANIFEST_DRIFT`) và re-register khi in-flight bị chặn (`FEATURE_ALREADY_ACTIVE`). ⚠️ **Đính chính 2026-08-09:** một vòng đọc trước đó kết luận lane vi phạm negative_scope — **SAI**, vì đọc manifest trên `main` thay vì bản trong commit của lane. Bản có thẩm quyền (branch) khai 3 file đó là *"NARROWED, not blanket-excluded (owner-authorized 2026-08-05 scope amendment)"*, liệt kê từng touch, mở rộng ở codex round-05. Lane nhất quán và đã qua 5 vòng codex. | Owner | Đóng lifecycle `--v2` → rebase branch lên `origin/main` (đưa sửa đổi doc sang path mới, reconcile manifest/backlog) → register `--v3` với `base_sha` mới → `ready` (cần 2 vòng sạch liên tiếp) |
| B1b | **Câu hỏi ngân sách còn mở, owner đã trả lời một phần.** `_scope_note` của lane tự khai module count *"grew from 3 to 5 with the 2026-08-05 owner-authorized scope amendment"*; changed LOC của riêng 3 module cốt lõi ≈ **1.145 vs trần 750** và `_scope_note` không bàn tới con số LOC. Plan §9 dòng 416 quy định *"Vượt ceiling hoặc cần module thứ tư → `SCOPE_DESIGN` hard stop và re-slice"*. Owner đã chọn amend thay vì re-slice ngày 05/08; câu chưa đóng là liệu authorization cấp slice có override được hard stop cấp plan không. | Owner | Ghi vào `decisions.md` một trong hai: (a) amendment 05/08 override plan §9:416 cho slice này, kèm lý do; (b) re-slice theo plan. Không đóng thì `--v3` sẽ lặp lại đúng câu hỏi này lúc review |
| B2 | **CI infra-blocked từ 2026-08-06**, chưa run xanh nào xác nhận mitigation `4cc574c`. P4 đề xuất fixture là điều kiện bump `KIT_VERSION` — không có CI thì không thi hành được. | Owner | ≥1 CI run xanh trên `main` |
| B3 | **Working tree bẩn: 130 file chưa commit**, gồm một cuộc reorg `docs/features/` (12 `feature_*.md` bị xoá ở root, `docs/features/FE/` untracked). `register` sẽ bind một base không sạch. | Owner | `git status --porcelain` sạch trên các path liên quan, hoặc reorg được commit thành lô riêng |
| B4 | **Sandbox không git-write được trong repo mount.** Mọi commit/merge chạy trên máy owner qua root-lock + `ap-merge.sh`. | Owner | Không đóng được — là ràng buộc thường trực, phải phản ánh trong mọi slice plan |
| B5 | **Chưa có backport item nào cho canonical** (hệ quả D1 §3.2). | Owner | Mỗi slice có một backport entry mở trong `autopilot-backlog.md` |

---

## 8. Verdict

```text
REVIEW_POLICY_VERSION: 1.3
REVIEW_VERDICT: NOT_CODE_READY
REVIEWED_AT: 2026-08-09
AUTHORITY_SHA: 64e9ccb8ac1b1079f85c3b646d9db99a183632f0
BASE_BRANCH: main
TARGET_FILES:
  - docs/autopilot-templates/level3.1-adoption-plan.md
SLICE: kit-level31-adoption-audit
IN_SCOPE: ghi nhận 4 quyết định owner 2026-08-09; re-pin Bước 0 tại KIT_VERSION 31; land order đã sửa theo D2 kèm phân tích va chạm file; phạm vi xoá của D4; hình dạng cửa sổ chuyển tiếp v2/v3 của D3; danh sách blocker B1-B5
OUT_OF_SCOPE: sửa scripts/autopilot-*; register manifest; mở worktree; bump KIT_VERSION; chạm lane chat-dm-safety-authority-core--v2; backport canonical; mọi migration/schema sản phẩm
G1_DECISION: PASS
G2_SPEC: PARTIAL
G3_DEPENDENCY: FAIL
G4_TEST: FAIL
G5_SCOPE: PASS
G6_EXTERNAL: FAIL
HARD_DEPENDENCIES: lane chat-dm-safety-authority-core--v2 @ 31bd4d9 chưa merge (B1); CI xanh chưa có (B2)
PRIOR_SLICES: none
OPEN_QUESTIONS_IN_SCOPE: 0
ENABLEMENT_ONLY_GATES: none
LIVE_REPO_VERIFICATION: PASS
CONTRACT_MATRIX: PARTIAL
CLOSURE_MATRIX: PARTIAL
ACCEPTANCE_MATRIX: FAIL
SECURITY_AND_MIGRATION_GATE: PASS
IMPLEMENTATION_ARTIFACTS: NOT_REQUIRED_FOR_PLAN_READY
FIRST_IMPLEMENTATION_STEP: author slice packet cho P4-standard (chuẩn fixture: exact exit code + exact HALT token + positive control) — chỉ sau khi B1 và B3 đóng
REMAINING_BLOCKERS:
  - blocker: lane chat-dm-safety-authority-core--v2 @ 31bd4d9 chưa đóng; Phase0-gap1/gap2/P5 cùng ghi scripts/codex-review-pin.sh
    owner: Owner
    resolution: lane merge xong HOẶC owner ghi quyết định pin wrapper cho lane
  - blocker: CI infra-blocked từ 2026-08-06, chưa xác nhận mitigation 4cc574c
    owner: Owner
    resolution: >=1 CI run xanh trên main
  - blocker: working tree 130 file chưa commit, gồm reorg docs/features/
    owner: Owner
    resolution: git status --porcelain sạch trên path liên quan
  - blocker: chưa có backport item canonical cho hệ quả fork của D1
    owner: Owner
    resolution: mỗi slice có backport entry mở trong docs/autopilot-backlog.md
NEXT_REVIEW_TRIGGER: commit đóng B1 (lane merge) + commit đóng B3 (working tree sạch)
```

---

## 9. Changelog

| Ngày | Thay đổi |
|---|---|
| 2026-08-09 | Tạo file. Bước 0 đo lại tại `64e9ccb` / KIT 31. Ghi 4 quyết định owner D1-D4. Land order sửa theo D2 + phân tích va chạm `codex-review-pin.sh`. Verdict `NOT_CODE_READY`, blocker B1-B5. |
