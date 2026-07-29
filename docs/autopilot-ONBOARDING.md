# Autopilot — onboarding cho người mới join Plexco

Đọc file này 1 lần là đủ để chạy autopilot flow của repo đúng theo template mới nhất.

```text
WORKFLOW_LEVEL: 3
WORKFLOW_MODE: supervised_autonomy
HUMAN_ROLE: manager_of_managers
DEFAULT_STOP_MODE: STOP_AT_READY
AUTO_MERGE: off
```

> ✅ **Đã sync với canonical `Claude template` (2026-07-28):** `level3-workflow.md` (contract vận hành),
> `autopilot-prompt-GENERIC` bản Level 3, `autopilot-invariants`, scope-gate **KIT_VERSION 10**
> (kèm `autopilot-review-readiness.mjs`, `ap-housekeep.sh`, `codex-review-pin.sh`).
> (Plexco-specific token vẫn ở `docs/autopilot-invariant-catalog.md`, không đụng.)

Nguồn canonical THẬT nằm ở Claude template repo, surface vào máy bạn qua symlink
`~/.claude/shared/autopilot-invariants.md` + `~/.claude/shared/level3-workflow.md` (setup một
lần/máy, ngoài phạm vi repo này — `autopilot/install-global.sh` bên template làm việc này).
`docs/autopilot-templates/` trong repo Plexco chỉ là **bản fallback mirror** — dùng khi máy bạn chưa
có shared canonical. `scripts/autopilot-onboard.sh` tự chọn đúng nguồn, ưu tiên canonical.

---

## 0. Mental model (đọc trước)

Autopilot chạy theo **Level 3 — supervised autonomy** (contract đầy đủ:
[`autopilot-templates/level3-workflow.md`](./autopilot-templates/level3-workflow.md)).

**Primary agent** nhận outcome, tự kéo context từ code/docs/decisions, tự chia thành slice bounded,
giao cho child agent, giám sát, tích hợp và verify cả outcome. **Mỗi writing slice = 1 branch +
1 worktree + tối đa 1 writer.** Agent tự verify bằng build/test/lint/typecheck/e2e thật, rồi
review chéo bắt buộc bằng `$CODEX` (external CLI, KHÔNG phải sub-agent cùng model) + security round
riêng cho thay đổi chạm trust boundary. Kết thúc ở **`READY | AWAIT | HALT`**, người merge tay.

Con người chỉ giữ: outcome, priority, policy, budget, quyết định sản phẩm material, ngoại lệ, và
merge/deploy. **Không** phải viết prompt cho từng child agent hay duyệt từng bước.

> ⚠️ Level 3 **KHÔNG** có nghĩa auto-merge. `STOP_AT_READY` + human merge vẫn là default; P0 vẫn
> prepare-only; `proactive_routine` chỉ mở cho một class hẹp sau khi đã chạy sạch nhiều lần.
> Số agent trong artifact gốc là minh hoạ scale, không phải acceptance criterion — task nhỏ không
> cần fan-out giả tạo.

Có 2 lớp luật:

- **Lớp global (cross-project)** — `level3-workflow.md` + các *invariant* / *circuit breaker* bất
  biến, sống ở `~/.claude/CLAUDE.md` của MỖI máy dev (auto-load vào mọi session). Ưu tiên import
  shared canonical `~/.claude/shared/`; CHỈ khi máy chưa có/không đọc được, import fallback
  `docs/autopilot-templates/` trong repo này. Không bao giờ cả hai cùng active.
- **Lớp per-repo** — phần riêng của Plexco, đã commit sẵn trong repo (xem §2). Đây là cái bạn dùng
  hằng ngày: backlog, manifest, scope-gate script, invariant catalog, maturity ledger, và
  review-readiness gate (`docs/standards/review-code-readiness-gate.md`).

Luật per-repo có thể **chặt hơn** global, không bao giờ lỏng hơn.

Quy ước thư mục: `docs/autopilot-*` = luật/kit; `.autopilot/` = runtime (gitignored, trừ ledger).

---

## 1. Setup một lần / mỗi máy (KHÔNG nằm trong repo)

> ⚡ **Cách nhanh nhất** — chạy 1 lệnh thay cho làm tay §1.1–1.2:
> ```bash
> scripts/autopilot-onboard.sh --codex /abs/path/to/codex   # bỏ --codex nếu chưa có, script sẽ chỉ chỗ điền
> source ~/.zshrc                                            # nạp biến vừa thêm
> ```
> Script idempotent: tự `@import` invariants vào `~/.claude/CLAUDE.md` (ưu tiên shared canonical, fallback
> repo copy — không bao giờ để cả hai cùng active), pin `AUTOPILOT_CODEX_BIN` vào `~/.zshrc`, và verify
> toàn bộ per-repo kit. Chạy `--check` để chỉ kiểm tra, không ghi gì; `--check` fail (non-zero) nếu thiếu
> import, có ĐỒNG THỜI hai import active, managed block bị sửa tay sai hình dạng, hoặc active import
> không khớp trạng thái shared-canonical hiện tại của máy — chạy lại KHÔNG kèm `--check` để tự sửa. Sau đó
> **restart Claude Code** để CLAUDE.md nạp lại. Phần dưới là bản làm tay / để hiểu script làm gì.
>
> Không quen terminal? Mở repo trong Claude Code và paste prompt này:
> ```
> Onboard tôi vào autopilot flow của repo này. Chạy `scripts/autopilot-onboard.sh` giúp tôi
> (hỏi tôi đường dẫn codex review-build để truyền vào --codex nếu cần), tóm tắt mọi dòng TODO
> nó in ra, rồi tóm tắt docs/autopilot-ONBOARDING.md §3 (vòng đời 1 task) thành checklist cho tôi.
> ```


1. **Import invariants vào CLAUDE.md global.** `scripts/autopilot-onboard.sh` làm việc này tự động (ưu
   tiên `@~/.claude/shared/autopilot-invariants.md`, fallback về bản repo nếu shared chưa có). Làm tay:
   chỉ `@import` MỘT trong hai nguồn — không bao giờ cả hai. Đây là các luật
   ALWAYS-APPLY (merge authority, loop control = file counter, design contract, scope, trust-nothing).
2. **Trỏ `$CODEX` tới binary review-capable.** Trong `~/.zshrc`:
   `export AUTOPILOT_CODEX_BIN=/đường/dẫn/tới/codex-review-build`. Mở lại Claude Code trong shell đã
   có biến này (nếu unset → flow phải HALT `CODEX_UNAVAILABLE`, đúng thiết kế — không được tự review thay).
3. **Khi soạn prompt cho 1 task**, dùng `docs/autopilot-templates/autopilot-prompt-GENERIC.md` làm
   send-file: copy block §C, thay placeholder, điền Toolchain map §B của Plexco, xoá phần `[OPTIONAL]`
   không dùng. Đọc §A một lần để hiểu cách phân risk tier.

> Vì sao global, không để trong repo: invariant là luật chung mọi project; ledger/credibility mới là
> riêng repo. Repo chỉ giữ BẢN SAO template (`docs/autopilot-templates/`) làm **fallback** khi máy bạn
> chưa có shared canonical — không phải nguồn import mặc định.

---

## 2. Per-repo kit (đã có sẵn trong repo)

| File | Vai trò |
|---|---|
| `scripts/autopilot-scope-gate` | Gate điều phối chạy song song. `register \| ready \| cleanup`. Atomic mkdir-lock, resolve registry qua git-common-dir, validate invariant theo catalog, check dependency + interface-drift (`dep_checks`), check scope collision. |
| `docs/autopilot-invariant-catalog.md` | Danh sách token domain chuẩn cho `invariants:` (chống synonym drift → HALT `INVARIANT_UNKNOWN`). Thêm domain mới = thêm 1 dòng trong block `catalog`. |
| `docs/autopilot-manifests/_TEMPLATE.json` | Mẫu manifest schema `level3-operational-v2`. Copy sang `.autopilot/state/<FEATURE_ID>/manifest.json` khi chạy (xem §3.3); thư mục này giữ template + manifest lịch sử. |
| `docs/autopilot-manifests/_READINESS_EVIDENCE_TEMPLATE.json` | Mẫu readiness evidence; `readiness_evidence_path` trong manifest trỏ tới `.autopilot/state/<FEATURE_ID>/readiness.json`. |
| `docs/autopilot-backlog.md` | Backlog machine-scannable: task nào chạy song song được (scope + invariants rời nhau, không phụ thuộc chưa-merge). |
| `.autopilot/maturity-ledger.md` | Sổ tín nhiệm per-repo (TRACKED). Class P2 đạt ≥3 clean-merge-unchanged → `mature` → mới được auto-merge. P0/P1 không bao giờ auto-merge. |
| `docs/autopilot-parallel-scope-gate.md` | Giải thích WHY của scope-gate (worktree không đủ, cần catalog + lock). |
| `scripts/autopilot-review-readiness.mjs` | Validator Level 3 của scope-gate: check manifest đã resolve, base/worktree/contract; manifest `level3-operational-v2` **fail-closed** khi validator không chạy được. |
| `scripts/codex-review-pin.sh` | Reviewer độc lập bắt buộc. Bind mỗi round vào HEAD/base/diff hiện tại; chỉ chấp nhận đúng verdict marker sạch. Reviewer không chạy được → `HALT TOOL_UNAVAILABLE`, KHÔNG được tự hạ gate. |
| `scripts/ap-finish.sh` / `scripts/ap-housekeep.sh` | Verified finish + housekeeping read-only sau terminal state. |
| `docs/autopilot-templates/` | Fallback mirror của canonical: `level3-workflow.md` (contract), `level3-handoff.md`, `orchestrator-usage.md`, `autopilot-invariants.md`, `autopilot-prompt-GENERIC.md`, `autopilot-prompt-template.md` (synced từ `Claude template` 2026-07-28). |

Lưu ý: `progress.json` + `plexco-dashboard.html` = nguồn sự thật **tiến độ phase/module**; backlog ở
trên là **task autopilot song song**. Linear/GitHub Projects chỉ cân nhắc khi có người thứ 2 / sau P5
(xem `automation/playbook.md` §2) — hiện flow KHÔNG dùng Linear.

---

## 3. Vòng đời 1 task (làm theo thứ tự)

> **Forward-only.** Level 3 chỉ áp cho task/session/feature **mở mới** sau khi kit này được cài/refresh.
> Session đang chạy giữ nguyên contract cũ tới khi đạt terminal state; không migrate giữa chừng.

0. **Task contract (primary agent làm trước khi code).** Đọc `docs/00-start-here/HANDOFF.md` + live
   repo, rồi resolve contract trong `autopilot-templates/level3-workflow.md` §3:
   `OUTCOME · REPOSITORY_AND_BASE · CONTEXT_SOURCES · APPLICABLE_SKILLS · SCOPE/NEGATIVE_SCOPE ·
   RISK(P0–P3) · AUTONOMY_MODE · MODEL_POLICY · SANDBOX_AND_PERMISSIONS · HUMAN_DECISIONS_REQUIRED ·
   SLICE_GRAPH · WORKTREE_PLAN · VERIFICATION · CODE_REVIEW/SECURITY_REVIEW · BUDGETS ·
   STOP_CONDITIONS · DELIVERABLES`.
   Thiếu context material → **`AWAIT_CONTEXT`**, không được tự bịa. Cần quyết định → đưa **1 đề xuất
   tốt nhất** kèm trade-off, không đẩy menu chưa xếp hạng cho owner.
   Đụng docs/specs/plans/readiness → thêm gate repo: `docs/standards/review-code-readiness-gate.md`.
1. **Backlog → planned.** Mở `docs/autopilot-backlog.md`, chọn task, refine `scope` (grep code thật) +
   chọn `invariants` từ catalog. Hai task song song được ⟺ `scope` rời nhau + `invariants` rời nhau +
   không cái nào `depends_on` cái kia mà chưa merge.
2. **Worktree TRƯỚC — PHẢI pin base SHA tường minh:**
   ```bash
   BASE_SHA=$(git rev-parse origin/main)
   git worktree add ".autopilot/worktrees/$FEATURE_ID" -b "feat/$FEATURE_ID" "$BASE_SHA"
   ```
   (thiếu base → fork từ HEAD hiện tại, có thể là branch cũ — incident v0.4.8). Verify
   `git rev-parse HEAD` trong worktree phải bằng `$BASE_SHA`. Mỗi worktree một DB/port/cache riêng.
3. **Tạo manifest TRONG worktree, tại state dir.** Copy `docs/autopilot-manifests/_TEMPLATE.json`
   → `.autopilot/state/$FEATURE_ID/manifest.json`, điền đủ (schema `level3-operational-v2`:
   `feature`, `branch`, `base_sha`, `risk`, `autonomy_mode`, `scope`/`negative_scope`, `invariants`,
   `context_sources`, `verification`, `code_review`/`security_review`, `stop_conditions`,
   `readiness_evidence_path`). Phụ thuộc symbol của upstream → khai `dep_checks:[{file,symbol}]`;
   gate grep symbol đó trên `base_ref` thật (chống upstream đổi tên interface → HALT `DEP_MISSING`).

   > **Vì sao state dir chứ không phải `docs/autopilot-manifests/`.** `halt_gate` chỉ ghi file
   > sentinel `HALT-<CODE>.txt` khi manifest nằm đúng `<worktree>/.autopilot/state/<feature>/`;
   > đường khác thì `TASK_STATE_CANDIDATE` rỗng và HALT **chỉ ra stderr** — watchdog quét sentinel
   > sẽ không thấy, và task fail im lặng. Đây cũng là quy ước canonical của kit v11.
   > `docs/autopilot-manifests/` giữ nguyên vai trò: 2 template + 47 manifest lịch sử của các slice
   > đã chạy. Muốn manifest được review trong PR thì commit thêm một bản copy vào đó — bản trong
   > state dir vẫn là bản gate đọc.
4. **Register — từ trong worktree, trước khi ghi dòng code nào:**
   ```bash
   export AUTOPILOT_CODEX_BIN="$PWD/scripts/codex-review-pin.sh"
   scripts/autopilot-scope-gate register --manifest ".autopilot/state/$FEATURE_ID/manifest.json"
   ```
   HALT nếu: `SCOPE_COLLISION` (đụng slice đang chạy) · `INVARIANT_UNKNOWN` (token ngoài catalog) ·
   `DEP_MISSING` (upstream chưa merge / đổi interface) · `CONTRACT_INVALID` · `MANIFEST_INVALID` ·
   `REVIEW_GATE_MISSING`.
5. **Codegen theo prompt GENERIC.** Step 1 BẮT BUỘC tạo `regions.log` + `fix-round-count.txt`. Choke-point
   (matcher/parser/router/auth) → decision-table + reuse-scan + Step 0 design-probe trước khi code.
6. **Review chéo bằng `$CODEX`** qua `scripts/codex-review-pin.sh` (round-NN.txt mỗi vòng).
   Slice chạm **trust boundary** (auth, secret, permission, external input, tiền, deployment) chạy
   thêm **1 round security riêng** qua đúng wrapper đó. Review còn finding actionable = chưa sạch;
   review sạch trên diff rỗng KHÔNG phải bằng chứng. Reviewer không gọi được → `HALT TOOL_UNAVAILABLE`.
   `fix-round-count > 5` → HALT `MAX_ROUNDS` (hard stop). Cùng file ≥3 round liên tiếp → HALT
   `REGION_THRASH`. Finding lan ra ngoài design → dừng và re-slice, đừng vá tiếp. P1 = 2 FULL clean liên tiếp.
7. **READY.** `scripts/autopilot-scope-gate ready --manifest <manifest>`. READY report EMBED artifact-verify
   (tên round cuối + dòng verdict + grep auth-fatal rỗng + base/HEAD SHA). Default DỪNG ở đây.
8. **Merge (người làm).** Squash-merge tay, hoặc batch nhiều branch READY bằng merge-train (GENERIC §C3).
   Sau merge: `scripts/autopilot-scope-gate cleanup --manifest <manifest>` (hoặc `cleanup --feature <slug>`)
   và +1 cho change_class trong `.autopilot/maturity-ledger.md` nếu merge mà không phải sửa gì.

---

## 4. Bản này khác bản template gốc ở đâu (local hardening đã apply)

3 chỉnh đã đồng bộ repo với bản mới nhất, người mới không phải làm lại:

- **Worktree base `main`** đã ghi rõ trong `docs/autopilot-parallel-scope-gate.md` (invariant 2026-06-20).
- **`dep_checks` (interface-drift, DEP_MISSING #21)** đã implement trong scope-gate + có trong `_TEMPLATE.json`.
- **Maturity-ledger** đã được track (`.gitignore` whitelist `.autopilot/maturity-ledger.md`), seed sẵn 5 class.

Khi template global lên KIT_VERSION mới hơn 10: chạy `autopilot/parallel/autopilot-init.sh` bên
`Claude template` (idempotent, không downgrade), cập nhật `docs/autopilot-templates/` rồi rà lại 3 mục
trên + catalog tokens. Thứ tự authority khi lệch nhau: **`level3-workflow.md` > `autopilot-invariants.md`
> `autopilot-prompt-GENERIC.md` > file rationale**. Luật per-repo của Plexco chặt hơn thì giữ luật Plexco.

Sau khi task đạt terminal state (§10 của `level3-workflow.md`): bug đã tìm ra → biến thành regression
test; quyết định business/security durable → ghi vào `docs/standards/decisions.md`; guidance lặp lại →
đẩy thành Skill hoặc reference lazy-load. Câu hỏi sau mỗi lần fail là **"thiếu context/guardrail/test/
routine nào?"**, không phải "ai đã không canh agent kỹ?".
