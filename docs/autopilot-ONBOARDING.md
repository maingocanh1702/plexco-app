# Autopilot — onboarding cho người mới join Plexco

Đọc file này 1 lần là đủ để chạy autopilot flow của repo đúng theo template mới nhất.
Pinned version: **`autopilot-prompt-GENERIC` v0.6.0** + **`autopilot-invariants`** (đã sync từ canonical 2026-07-19, FK-authority conditional rule).
> ✅ **Đã sync với canonical `Claude template` (2026-07-19):** GENERIC v0.6.0, invariants (162 dòng), scope-gate **KIT_VERSION 4**, backlog-reconcile **KIT_VERSION 2**. (Plexco-specific token vẫn ở `docs/autopilot-invariant-catalog.md`, không đụng.)
Nguồn canonical THẬT nằm ở Claude template repo, surface vào máy bạn qua symlink `~/.claude/shared/autopilot-invariants.md` (setup một lần/máy, ngoài phạm vi repo này). `docs/autopilot-templates/` trong repo Plexco chỉ là **bản fallback mirror** — dùng khi máy bạn chưa có shared canonical. `scripts/autopilot-onboard.sh` tự chọn đúng nguồn, ưu tiên canonical.

---

## 0. Mental model (đọc trước)

Autopilot = giao 1 feature-branch cho Claude Code chạy theo prompt tự-chứa, review chéo bằng
`$CODEX` (external CLI, KHÔNG phải sub-agent cùng model), rồi **dừng ở READY** cho người merge tay
(default `STOP_AT_READY`). Có 2 lớp luật:

- **Lớp global (cross-project)** — các *invariant* và *circuit breaker* bất biến, sống ở
  `~/.claude/CLAUDE.md` của MỖI máy dev (auto-load vào mọi session). Ưu tiên import shared canonical
  `~/.claude/shared/autopilot-invariants.md`; CHỈ khi máy chưa có/không đọc được, import fallback
  `docs/autopilot-templates/autopilot-invariants.md` trong repo này. Không bao giờ cả hai cùng active.
- **Lớp per-repo** — phần riêng của Plexco, đã commit sẵn trong repo (xem §2). Đây là cái bạn dùng
  hằng ngày: backlog, manifest, scope-gate script, invariant catalog, maturity ledger.

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
| `docs/autopilot-manifests/_TEMPLATE.json` | Mẫu manifest 1-file/feature: `scope`, `invariants`, `depends_on`, `dep_checks` (interface-drift), `base_ref`, risk, change_class. |
| `docs/autopilot-backlog.md` | Backlog machine-scannable: task nào chạy song song được (scope + invariants rời nhau, không phụ thuộc chưa-merge). |
| `.autopilot/maturity-ledger.md` | Sổ tín nhiệm per-repo (TRACKED). Class P2 đạt ≥3 clean-merge-unchanged → `mature` → mới được auto-merge. P0/P1 không bao giờ auto-merge. |
| `docs/autopilot-parallel-scope-gate.md` | Giải thích WHY của scope-gate (worktree không đủ, cần catalog + lock). |
| `docs/autopilot-templates/` | Bản canonical của 2 template gốc (invariants + GENERIC v0.6.0; synced từ `Claude template` 2026-07-15). |

Lưu ý: `progress.json` + `plexco-dashboard.html` = nguồn sự thật **tiến độ phase/module**; backlog ở
trên là **task autopilot song song**. Linear/GitHub Projects chỉ cân nhắc khi có người thứ 2 / sau P5
(xem `automation/playbook.md` §2) — hiện flow KHÔNG dùng Linear.

---

## 3. Vòng đời 1 task (làm theo thứ tự)

1. **Backlog → planned.** Mở `docs/autopilot-backlog.md`, chọn task, refine `scope` (grep code thật) +
   chọn `invariants` từ catalog. Hai task song song được ⟺ `scope` rời nhau + `invariants` rời nhau +
   không cái nào `depends_on` cái kia mà chưa merge.
2. **Tạo manifest.** Copy `_TEMPLATE.json` → `docs/autopilot-manifests/<slug>.json`, điền đủ. Nếu phụ
   thuộc symbol của upstream, khai `dep_checks:[{file,symbol}]` — gate sẽ grep symbol đó trên `base_ref`
   thật (chống upstream rebuild đổi tên interface → HALT `DEP_MISSING`).
3. **Pre-flight + register.** Ở `main` sạch, đúng single-writer:
   `scripts/autopilot-scope-gate register --manifest docs/autopilot-manifests/<slug>.json`
   (HALT nếu collision / dep chưa merge / token lạ).
4. **Worktree — PHẢI nêu base `main`:**
   `git worktree add .autopilot/worktrees/<slug> -b feat/<slug> main`
   (thiếu `main` → fork từ HEAD hiện tại, có thể là branch cũ — incident v0.4.8). Verify `git log -1`.
   Mỗi worktree một `DB_PATH` riêng.
5. **Codegen theo prompt GENERIC.** Step 1 BẮT BUỘC tạo `regions.log` + `fix-round-count.txt`. Choke-point
   (matcher/parser/router/auth) → decision-table + reuse-scan + Step 0 design-probe trước khi code.
6. **Review chéo bằng `$CODEX`** (round-NN.txt mỗi vòng). `fix-round-count > 5` → HALT `MAX_ROUNDS` (hard
   stop). Cùng file ≥3 round liên tiếp → HALT `REGION_THRASH`. P1 = 2 FULL clean liên tiếp.
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

Khi template global lên version mới hơn v0.6.0: cập nhật `docs/autopilot-templates/` rồi rà lại 3 mục trên
+ catalog tokens. Nếu GENERIC và bản rationale lệch nhau → **GENERIC thắng**.
