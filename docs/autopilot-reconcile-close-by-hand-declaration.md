# Slice contract — `reconcile-close-by-hand-declaration`

> **Đây là contract, KHÔNG phải verdict.** Theo `standards/review-code-readiness-gate.md` §11.2, verdict
> chỉ được mở sau khi slice đã author (có manifest + target thật, không phải placeholder). File này
> author trước; verdict được thêm vào cuối file trong một commit riêng, sau khi các artifact đã sửa
> (doc này, manifest) nằm trên `main` — `AUTHORITY_SHA` khi đó sẽ pin đúng commit chứa chúng, không
> phải một nhãn version di động.
>
> **v0.3 — bản revise sau feedback owner 30/07.** Hai điểm mở ở v0.2 nay đã đóng: glyph/message chính
> xác của `MALFORMED`, và cách chia slice qua ranh giới repo. Cả hai đổi shape thật (không chỉ đổi chữ)
> — xem "Chia slice theo ranh giới repo" và "Ranh giới: cách chia này KHÔNG được tái dùng cho gate file"
> dưới, và Changelog.

---

## Vì sao có file này

Backlog đã mở `## task: reconcile-close-by-hand-declaration` ngày 30/07 (xem
`docs/autopilot-backlog.md`), với `scope`, `merged_probe` và phần `notes` mô tả đầy đủ vấn đề. File
này KHÔNG lặp lại phần đó — nó biến mô tả thành contract có thể mở worktree.

**Vấn đề đo được, không phải giả định.** `scripts/autopilot-backlog-reconcile` (KIT_VERSION 4) coi
mọi `merged_probe` không phải identifier-shaped là lỗi tác giả: nó in

```
✗ WEAK-PROBE: <slug> (<status>) — probe '<regex>' matched but is NOT a slice-unique symbol
     (shared literal → collides with unrelated origin/<default> content). REFUSING to auto-flip;
     replace merged_probe with a code symbol this slice introduces.
```

Lời khuyên "thay bằng code symbol" đúng cho hầu hết slice — nhưng **bất khả thi** cho ba lớp mà chính
backlog đã tự đặt tên:

| Lớp | Vì sao không có probe identifier-shaped nào tồn tại |
|---|---|
| `dependency-security` | Bump lockfile không tạo symbol nào; `pnpm-lock.yaml` chỉ có version + path, và version là literal dùng chung (có thể trùng nội dung không liên quan đã có sẵn trên `origin/main` trước khi slice merge) |
| `owner-evidence-gate` | Đóng bằng bằng chứng (đo trên thiết bị thật, support ticket, due-diligence), không bằng commit — không có gì để probe |
| `docs-reconcile` | Token đều có gạch nối (`docs-session-...`) nên trượt thẳng `is_symbol_probe` (regex đòi `^[A-Za-z_][A-Za-z0-9_]*$`, không cho `-`) |

**Trigger cụ thể, đo 2026-07-30:** `deps-security-bump` merged tại `61a2575` (chỉ `next` land), đóng
TAY vì `autopilot-backlog-reconcile --fix` từ chối flip: `probe '15.5.21' matched but is NOT a
slice-unique symbol`. Backlog đã ghi `close_by: hand · <lý do>` trên block đó (dòng 485) làm khai báo
tường minh — nhưng **script không đọc trường này**, nó chỉ tồn tại như prose. `ap-merge.sh` bước 8b
(chạy `--fix` tự động sau mỗi push kể từ 2026-07-29) sẽ mãi mãi in `WEAK-PROBE` cho lớp task này,
đọc như lỗi tác giả cần sửa trong khi không có gì để sửa.

**Đề xuất, đã có trong backlog notes:** dạy script hiểu `close_by: hand · <reason>` là một khai báo
có chủ đích. Khi có nó, `--check`/`--fix` báo `⊘ manual-close: <slug>` thay vì `✗ WEAK-PROBE`, và
**không bao giờ tự flip** (con người vẫn phải xác nhận rồi đổi `status: merged` bằng tay — đó chính là
điểm của trường này). `--audit` vẫn phải kêu nếu một task khai `close_by: hand` mà `scope` của nó **có**
file mã nguồn thật — đó mới là lười thật, không phải một lớp không thể probe.

---

## Phát hiện thêm khi author (KHÔNG có trong backlog notes gốc)

**`scripts/autopilot-backlog-reconcile` là file KIT CANONICAL, không phải tooling riêng của Plexco.**
Đo 2026-07-30: `diff` với `$HOME/Projects/Claude template/autopilot/parallel/autopilot-backlog-reconcile`
→ exit 0 (byte-identical), cả hai cùng `# KIT_VERSION: 4`. Git log của chính file này trong repo Plexco
xác nhận nó luôn được **sync**, chưa từng hand-author độc lập: `1e503d1` "sync backlog-reconcile
KIT_VERSION 3 từ canonical", `54de276` "sync kit to canonical v0.6.0 / backlog-reconcile KIT_VERSION 2".

**Không có lưới an toàn tự động bắt lệch bản.** `~/.claude/hooks/autopilot-sync.cjs` (SessionStart
hook) chỉ quản lý `scripts/autopilot-scope-gate` (auto-overwrite version-aware) và cảnh báo drift cho
`docs/autopilot-parallel-scope-gate.md`/`_TEMPLATE.json`. Nó **không nhắc đến** `autopilot-backlog-reconcile`
ở bất kỳ dòng nào. Nếu một implementer tương lai sửa thẳng bản Plexco mà bỏ qua bước canonical-first,
không có cơ chế nào tự phát hiện — điều duy nhất giữ kỷ luật này là ghi rõ ở đây, ở NEGATIVE_SCOPE và
ở acceptance RCH-12/RCH-13. Cơ chế sync đúng — `autopilot-update.sh` — xem mục kế.

---

## Chia slice theo ranh giới repo (owner quyết định 30/07)

Bản v0.1/v0.2 của file này đặt sai câu hỏi: *"session coding sẽ lấy quyền ghi vào repo anh em bằng
cách nào?"*, rồi tự trả lời bằng một `HALT` nếu không có quyền ghi. Owner chỉnh: đừng trả lời câu đó —
**bỏ nó**, tách slice theo đúng ranh giới repo thay vì nhét cả hai nửa vào một worktree Plexco.

**Nửa template = kit maintenance ngoài luồng, KHÔNG phải slice, KHÔNG qua gate.** Đúng như cách chính
`scope-gate` đã lên `v14→v17` hôm nay (Plexco `48db365`, "chore(autopilot): sync kit v14 -> v17" —
**không có** manifest/verdict/launcher Plexco nào cho lượt bump đó, chỉ một commit `chore:` đơn giản):
sửa `autopilot/parallel/autopilot-backlog-reconcile` trong `$HOME/Projects/Claude template`, bump
`# KIT_VERSION:` 4→5, viết rationale vào chính comment header theo đúng mật độ đoạn đã có sẵn trong
file (`⚠️ DISCRIMINATOR RULE (KIT_VERSION 3 — added after the ap-93 false-flip, 2026-07-24): ...`) —
một đoạn mới, có ngày, nêu đích danh nỗi đau `deps-security-bump`/`WEAK-PROBE` mà `close_by: hand` sinh
ra để sửa — rồi commit và push template. Việc này **không thuộc phạm vi slice Plexco này**: không cần
worktree, không cần scope-gate, không cần `codex-review-pin.sh` của Plexco. Nó chạy theo quy trình
riêng của repo `Claude template`, và là một **precondition ngoài repo** của bước kế — không phải một
`depends_on` trong dependency graph của Plexco backlog (không có slug nào cho nó ở đó).

**Nửa Plexco = slice thật, và nó không bao giờ ghi ra ngoài repo Plexco:**

1. `bash "$HOME/Projects/Claude template/autopilot/parallel/autopilot-update.sh"` để kéo v5 xuống. Đã
   verify script này có sẵn trong pack sync — `pack_pairs()` liệt kê đúng dòng
   `autopilot-backlog-reconcile:scripts/autopilot-backlog-reconcile:100755` — và tự `HALT` nếu bản
   Plexco đang cài **mới hơn** canonical (không bao giờ downgrade một consumer đã tiến xa hơn).
2. Author test hồi quy ở **file MỚI** `scripts/autopilot-backlog-reconcile.test.sh` — KHÔNG sửa nội
   dung `scripts/autopilot-backlog-reconcile` vừa sync (làm vậy là hand-patch lại đúng thứ vừa tránh
   được). Test gọi script đã sync như một subprocess/black-box, không edit nó. Xem RCH-13.

**Logic đã sync vẫn xuất hiện nguyên trong diff của chính slice này** (file `scripts/autopilot-backlog-reconcile`
đổi nội dung trong worktree Plexco, dù nội dung đó được VIẾT ở nơi khác), nên `codex-review-pin.sh` của
Plexco **vẫn nhìn thấy và review toàn bộ nội dung mới** — chỉ là nhìn thấy ở hạ nguồn (consumer) thay vì
thượng nguồn (producer). Không có gì "trốn" review; nó chỉ đổi CHỖ review diễn ra, không đổi việc có
review hay không.

**Hệ quả trực tiếp cho §3 và manifest:** vì session Plexco không bao giờ ghi ra ngoài repo Plexco nữa,
`HALT` "thiếu quyền ghi sibling repo" ở bản v0.2 **không còn khả năng xảy ra** — đã bị xoá khỏi
`STOP_CONDITIONS` và `SANDBOX_AND_PERMISSIONS` dưới. Thay vào đó là một precondition ngoài repo: nếu
sau bước 1, `# KIT_VERSION:` của bản Plexco vẫn đọc `4` (chưa `5`), nghĩa là nửa template **chưa land**
— đây là `AWAIT`, không phải `HALT` (thiếu đúng một context/authority bên ngoài, có điều kiện resume
nhị phân rõ ràng: template đọc `5`; không phải một breaker cứng của chính slice).

---

## Ranh giới: cách chia này KHÔNG được tái dùng cho gate file

**Đặt tên thẳng sự khó chịu thật, không lấp liếm.** Logic sống trong template (không có test harness ở
đó — repo `Claude template` không có bats/shunit cho các script bash của nó), test sống trong Plexco
(sync xuống rồi mới viết test). Nghĩa là: **kit v5 tồn tại một khoảng thời gian ngắn KHÔNG có test nào
chạy qua nó** — từ lúc commit ở template tới lúc `autopilot-update.sh` + test hồi quy Plexco land và
chạy xanh. Đây là một khoảng hở thật, không phải lý thuyết.

**Chấp nhận được cho slice này** vì cả ba điều kiện sau đều đúng: script bookkeeping **P3**, không
chạm production code, không chạm schema/auth/tiền.

**KHÔNG chấp nhận được nếu ai đó sau này áp dụng đúng pattern này cho một gate file** —
`scripts/autopilot-scope-gate`, `scripts/autopilot-review-readiness.mjs` (review-readiness validator),
hay `scripts/codex-review-pin.sh`. Những file đó LÀ trust boundary: một thay đổi sai ở đó có thể khiến
gate fail-open (cho qua thứ lẽ ra phải chặn) đúng trong khoảng cửa sổ "logic đã land, test chưa đuổi
kịp". Với nhóm file đó, test phải **đi cùng implementation trong chính template**, trước khi bất kỳ
consumer nào sync xuống — không có ngoại lệ "sync trước, test sau" như slice này.

Ghi rule này thành **ranh giới, không phải chú thích cuối trang**:

> **P3, không trust-boundary, không production code → được phép split logic-in-template/test-in-consumer.
> Bất kỳ điều nào trong ba điều đó sai → KHÔNG được split; test phải có trong template trước khi sync.**

---

## §3 Task contract

```text
TASK_ID: reconcile-close-by-hand-declaration
OUTCOME: dạy scripts/autopilot-backlog-reconcile nhận diện khai báo `close_by: hand · <reason>` trên
  một task block là tuyên bố có chủ đích — "lớp task này không thể có merged_probe phân biệt được" —
  và báo cáo nó bằng nhãn riêng `⊘ manual-close` thay vì `✗ WEAK-PROBE`, đồng thời VẪN từ chối tự flip
  (con người luôn phải xác nhận), VẪN bắt được trường hợp lạm dụng (khai close_by:hand mà scope có file
  mã nguồn thật), và VẪN không cho một khai báo thiếu lý do (MALFORMED) miễn trừ khỏi luật cũ.
REPOSITORY_AND_BASE: Plexco app · base `main` · PIN SHA lúc mở worktree (đo lại, đừng chép số ở đây)
CONTEXT_SOURCES:
  - scripts/autopilot-backlog-reconcile (đọc toàn bộ 30/07, KIT_VERSION 4)
  - docs/autopilot-backlog.md — block `reconcile-close-by-hand-declaration` (nguồn yêu cầu) và block
    `deps-security-bump` (ví dụ sống đã merge, dòng 485, tiền lệ cú pháp `close_by: hand · <reason>`)
  - $HOME/Projects/Claude template/autopilot/parallel/autopilot-backlog-reconcile (nguồn canonical;
    verify byte-identical 30/07)
  - $HOME/Projects/Claude template/autopilot/parallel/autopilot-update.sh (cơ chế sync; đã verify
    pack_pairs() liệt kê file này và fail-closed khi downgrade)
  - Plexco commit `48db365` "chore(autopilot): sync kit v14 -> v17" — tiền lệ kit bump ngoài luồng,
    không có slice/manifest/verdict Plexco nào
  - docs/standards/review-code-readiness-gate.md (gate canonical)
APPLICABLE_SKILLS: none — bash text-processing thuần, không skill nào áp dụng.
SCOPE: scripts/autopilot-backlog-reconcile · scripts/autopilot-backlog-reconcile.test.sh ·
  docs/autopilot-manifests/reconcile-close-by-hand-declaration.json ·
  docs/autopilot-reconcile-close-by-hand-declaration.md
NEGATIVE_SCOPE:
  - KHÔNG sửa scripts/autopilot-scope-gate hay bất kỳ file kit nào khác — đúng một script + test file
    mới của chính nó.
  - KHÔNG nới DISCRIMINATOR RULE cho task KHÔNG khai `close_by: hand` — yêu cầu identifier-shaped
    symbol giữ nguyên; đây là escape hatch cộng thêm cho ba lớp đã đặt tên, không phải nới luật chung.
  - KHÔNG làm `close_by:` thành enum tổng quát — chỉ nhận literal `hand`; giá trị thứ hai (nếu cần) là
    quyết định riêng sau này.
  - KHÔNG bao giờ để `--fix` tự flip một task `close_by: hand`, bất kể probe của nó có match hay có
    identifier-shaped hay không — mục đích của trường này chính là bắt buộc con người xác nhận.
  - KHÔNG sửa logic `scripts/autopilot-backlog-reconcile` trực tiếp trong worktree Plexco — đường duy
    nhất được phép là `autopilot-update.sh` kéo xuống một file đã sửa sẵn ở
    `$HOME/Projects/Claude template`; xem "Chia slice theo ranh giới repo" ở trên.
  - KHÔNG backfill `close_by: hand` ngược vào block `deps-security-bump` đã `status: merged` — nó
    không còn được scan (awk chỉ emit `planned|ready|blocked`); có thể thêm cho rõ nhưng không bắt buộc.
  - KHÔNG chạm packages/db/src hay bất kỳ module nào ngoài bốn file trong SCOPE.
  - KHÔNG tái dùng cách chia logic-in-template/test-in-consumer cho bất kỳ gate file nào
    (`scripts/autopilot-scope-gate`, `scripts/autopilot-review-readiness.mjs`,
    `scripts/codex-review-pin.sh`) — xem "Ranh giới" ở trên. Ngoại lệ này chỉ cấp cho một script P3
    không trust-boundary/production-code.
RISK: P3 — tooling nội bộ cho chính quy trình autopilot, không chạm production code, schema, auth hay
  tiền; scope là một script bash cục bộ + test file của chính nó + doc/manifest của chính nó.
AUTONOMY_MODE: supervised
MODEL_POLICY: code gate = scripts/codex-review-pin.sh, 1 vòng sạch (tier tooling — không phải
  money/logic P1 nên không bắt buộc 2× liên tiếp). Reviewer không gọi được → HALT TOOL_UNAVAILABLE,
  cấm tự hạ gate.
SANDBOX_AND_PERMISSIONS: không network, không secret. Session KHÔNG BAO GIỜ ghi ra ngoài repo Plexco.
  Cần quyền ĐỌC (không cần quyền ghi) vào repo anh em `$HOME/Projects/Claude template`, chỉ để chạy
  `autopilot-update.sh` — script đó tự đọc từ đó và ghi vào repo hiện tại, không ghi ngược lại.
HUMAN_DECISIONS_REQUIRED: none. Cú pháp `close_by: hand · <reason>` đã có tiền lệ sống (block
  `deps-security-bump`, dòng 485). Glyph/message của `MALFORMED` và cách chia slice theo ranh giới repo
  — hai điểm còn mở ở v0.2 — đã được owner trả lời 30/07 và pin thẳng vào §3/Acceptance dưới, không còn
  gì bỏ ngỏ.
SLICE_GRAPH: một slice, không fan-out. Root trong dependency graph của Plexco backlog — không Plexco
  task nào khác chờ nó, nó không chờ Plexco task nào khác. CÓ một precondition ngoài repo (nửa
  template phải land trước) — không biểu diễn được bằng `depends_on` vì không có slug Plexco cho nó;
  xem STOP_CONDITIONS.
DEPENDENCIES: none trong Plexco backlog (root). Precondition ngoài repo: xem trên.
INVARIANTS: [] — không domain token nào trong docs/autopilot-invariant-catalog.md áp dụng: không
  schema, không tenant-isolation, không money, không auth. Khai một token sẽ khoá lane không cần thiết.
VERIFICATION: xem Acceptance matrix dưới + manifest `verification` (khai bằng THUỘC TÍNH, không phải
  literal — runtime manifest bị hash-lock sau `register`).
CODE_REVIEW: bắt buộc, 1 vòng sạch. Logic đã sync vẫn nằm trong diff của chính slice này nên vẫn được
  review đầy đủ — xem "Chia slice theo ranh giới repo".
SECURITY_REVIEW: KHÔNG bắt buộc. Lý do: không trust boundary — bash cục bộ đọc file markdown đã trust
  sẵn trong repo và git refs, không secret/network/auth/money/external input. **Vô hiệu nếu:**
  implementation hoá ra gọi ra ngoài git/awk/grep trên ref cục bộ, hoặc đọc/ghi ngoài
  docs/autopilot-backlog.md và các file script/test/manifest trong scope — khi đó phải thêm 1 vòng
  security và ghi rõ vì sao phán đoán này sai.
BUDGETS: MAX_ROUNDS 5 · REGION_THRASH 3 cùng vùng ⇒ HALT. Ước lượng ≤250 LOC, 2 file thay đổi/thêm
  (script sync + test file mới), 0 migration.
STOP_CONDITIONS: STOP_AT_READY. AWAIT nếu sau khi chạy `autopilot-update.sh`, bản Plexco vẫn đọc
  `# KIT_VERSION: 4` — nửa template chưa land, đây là precondition ngoài repo thiếu, không phải breaker
  của slice; đợi tới khi template đọc `5` rồi chạy lại, KHÔNG tự hand-author logic v5 để né chờ. HALT
  nếu phát hiện một lớp thứ tư cần `close_by: hand` nhưng không khớp hình dạng `close_by: hand · <reason>`
  đã pin — đó là câu hỏi owner về hình dạng escape hatch, không phải lựa chọn implementation.
DELIVERABLES: diff đúng scope (script đã sync + test file mới + doc/manifest) · bằng chứng
  `autopilot-update.sh` chạy sạch và `# KIT_VERSION: 5` khớp canonical · acceptance matrix chạy thật
  qua `scripts/autopilot-backlog-reconcile.test.sh` (re-runnable, không chỉ narrate) · bằng chứng review
  sạch · READY report.
```

---

## Live-truth verification — đo 2026-07-30

| Tiền đề | Bằng chứng | Kết quả |
|---|---|---|
| `scripts/autopilot-backlog-reconcile` là file kit canonical | `diff` với `$HOME/Projects/Claude template/autopilot/parallel/autopilot-backlog-reconcile` → exit 0; cả hai `# KIT_VERSION: 4` | ✅ |
| `autopilot-sync.cjs` KHÔNG quản lý file này | grep toàn bộ hook: chỉ thấy `autopilot-scope-gate` + `parallel-scope-gate.md`/`_TEMPLATE.json` | ✅ (⚠️ không có lưới an toàn tự động) |
| `autopilot-update.sh` CÓ sync file này | đọc `pack_pairs()`: dòng `autopilot-backlog-reconcile:scripts/autopilot-backlog-reconcile:100755` có mặt; script tự `HALT` khi `installed_version > canonical_version` (chống downgrade) | ✅ |
| Kit bump ngoài luồng không cần slice Plexco — tiền lệ sống | Plexco `48db365` "chore(autopilot): sync kit v14 -> v17" — chỉ 3 file (`_TEMPLATE.json`, `autopilot-scope-gate`, `codex-review-pin.sh`), không manifest/verdict/launcher | ✅ |
| Cú pháp `close_by: hand · <reason>` đã có tiền lệ sống | `docs/autopilot-backlog.md:485`, block `deps-security-bump`, tác giả 30/07 | ✅ |
| `--audit` hiện KHÔNG có nhánh code riêng biệt | đọc toàn bộ script: `MODE` chỉ rẽ nhánh tại `--check`/`--fix`; `--audit` rơi vào cùng đường với `report` mặc định (chỉ khác cách con người diễn giải output) | ✅ |
| Không có bash test harness nào trong repo Plexco hôm nay | `find . -iname "*.bats"` rỗng; `scripts/` không có `*.test.sh`; test harness JS duy nhất (`check-review-readiness.test.mjs`) thuộc một script Node khác | ✅ |
| Task tự nó có `merged_probe` hợp lệ | `scripts/autopilot-backlog-reconcile :: close_by` — `close_by` là bare identifier, qua được `is_symbol_probe`; không có nghịch lý con-gà-quả-trứng cho chính slice này | ✅ |

---

## Thiết kế đề xuất — hành vi chính xác

1. **Parse thêm một field mới per block:** `close_by:` — awk block hiện tại đã trích `slug`/`status`/
   `merged_probe` per `## task:`; thêm trích `close_by` theo cùng cơ chế. Cú pháp bắt buộc:
   `close_by: hand · <lý do một dòng>` (dấu phân cách là `·`, interpunct, đúng ký tự đã dùng sẵn ở
   dòng 485 và xuyên suốt style file backlog). Chỉ nhận literal `hand`.

2. **Phân loại lại, không phải thêm nhánh song song:** một task có `close_by: hand` hợp lệ (có lý do)
   sẽ **luôn** in `⊘ manual-close: <slug> (<status>) — <reason>`, bất kể trạng thái probe của nó là gì
   (pending / stale / weak / không có `merged_probe`). Khai báo thắng suy luận từ probe — không rẽ
   nhánh theo việc probe match hay không, vì rẽ nhánh theo state sẽ tự tạo lại đúng loại thrash mà
   trường này sinh ra để tránh.

3. **Không bao giờ vào `stale[]` hoặc `weak[]`.** Hệ quả: `--check` không bao giờ exit 1 chỉ vì một
   entry `close_by: hand` hợp lệ (đúng như `weak` hôm nay), và `--fix` không bao giờ đưa nó vào vòng lặp
   flip.

4. **Thiếu lý do = malformed, dùng đúng glyph mức độ nghiêm trọng của lỗi tác giả, KHÔNG lặng lẽ chấp
   nhận.** `close_by: hand` không có gì (hoặc rỗng) sau dấu `·` phải in **đúng ba dòng** sau, dùng
   `✗` — cùng glyph mức độ nghiêm trọng với `WEAK-PROBE` hôm nay, vì đây LÀ lỗi tác giả, không phải một
   trạng thái hợp lệ:

   ```
   ✗ MALFORMED close_by: <slug> — declared but reason is missing or empty.
       Treated as UNDECLARED; the strict probe rules still apply, nothing was exempted.
       Fix: `close_by: hand · <one-line reason>` — the reason is the whole point of the field.
   ```

   rồi **rơi về đúng logic phân loại cũ** (stale/weak/no-probe/pending) như thể trường này không tồn
   tại — kể cả việc vào `stale[]`/`weak[]` và ảnh hưởng exit code của `--check` nếu trạng thái nền của
   nó đúng là stale/weak thật. Đây là cách chặn cửa sau: viết `close_by: hand` trơn để né `WEAK-PROBE`
   mà không kèm lý do sẽ **không có tác dụng gì** — một field hỏng mà nới được luật chính là cửa sau.

   Vocabulary đầy đủ sau thay đổi này: `✓` genuinely pending · `?` no probe · `✗` lỗi tác giả (cả
   `WEAK-PROBE` lẫn `MALFORMED close_by` dùng chung glyph này, cùng lớp nghiêm trọng) · `⊘` manual-close
   cho một `close_by: hand` hợp lệ · `NOTE:` cho dòng tổng kết cuối (giữ nguyên cơ chế `NOTE:` hiện có
   cho `weak`; một entry malformed rơi về stale/weak thật sẽ tự kéo theo đúng `NOTE:` mà nhóm đó vốn có,
   không cần cơ chế tổng kết riêng cho malformed).

5. **Abuse guard (đề xuất gốc từ backlog notes, `--audit` vẫn phải kêu):** nếu một task khai
   `close_by: hand` mà `scope:` của nó chứa ít nhất một file **có khả năng mang probe identifier-shaped**
   — mã nguồn ứng dụng dưới `packages/*/src/`, `apps/*/src/`, `scripts/*`, hoặc một migration `.sql`
   mới — in một cảnh báo to, riêng biệt với `⊘ manual-close`, tối thiểu ở chế độ `--audit`. **Cố ý
   loại trừ** file manifest/lockfile/workspace-config/doc (`package.json`, `pnpm-lock.yaml`,
   `pnpm-workspace.yaml`, `docs/autopilot-manifests/*.json`, `*.md`) khỏi định nghĩa "file mã nguồn" —
   nếu không, chính ví dụ hợp lệ đang là lý do tồn tại của slice này (`deps-security-bump`, scope gồm
   `package.json`/`pnpm-lock.yaml`/`pnpm-workspace.yaml`) sẽ bị false-flag bởi guard được viết ra để
   bắt lạm dụng.

Không cần state machine phức tạp hơn: 6 đường phân loại thật (pending / stale / weak / no-probe /
manual-close hợp lệ / malformed-rơi-về-cũ) cộng một guard độc lập là đủ cho phạm vi backlog notes đã
mô tả — malformed không phải đường thứ 7 riêng biệt, nó luôn rơi về một trong 4 đường cũ, chỉ kèm thêm
một dòng cảnh báo `✗`.

---

## Acceptance matrix

| # | Nhóm | Input / precondition | Expected | Layer |
|---|---|---|---|---|
| RCH-1 | Happy | `close_by: hand · <lý do>`, probe hiện KHÔNG match trên `origin/<default>` | `⊘ manual-close: <slug>` (không phải dòng `✓ ... genuinely pending`); không vào `stale[]`/`weak[]` | script |
| RCH-2 | Happy | `close_by: hand · <lý do>`, probe MATCH nhưng KHÔNG identifier-shaped (hình dạng thật của `deps-security-bump` trước khi hand-flip) | `⊘ manual-close: <slug>`, KHÔNG `✗ WEAK-PROBE`; không vào `weak[]` | script |
| RCH-3 | Happy | `close_by: hand · <lý do>`, probe MATCH và tình cờ identifier-shaped | vẫn `⊘ manual-close: <slug>`; KHÔNG tự flip qua `--fix` (khai báo thắng suy luận) | script |
| RCH-4 | Boundary | `close_by: hand` với lý do thiếu hoặc rỗng sau `·` | in đúng 3 dòng `✗ MALFORMED close_by: ...` (xem "Thiết kế đề xuất" #4), cùng glyph `✗` với `WEAK-PROBE` | script |
| RCH-4b | Boundary (bảo đảm quan trọng nhất) | Như RCH-4, nhưng trạng thái nền của task **thật sự** là stale hoặc weak | vẫn vào đúng `stale[]`/`weak[]`, vẫn ảnh hưởng exit code của `--check` y hệt như khi không có `close_by` — MALFORMED không miễn trừ gì | script |
| RCH-5 | Boundary | `close_by: hand · <lý do>` trên task KHÔNG có `merged_probe` nào | `⊘ manual-close: <slug>`, KHÔNG rơi vào dòng `?  no merged_probe` | script |
| RCH-6 | Abuse guard | `close_by: hand · <lý do>` + `scope` chứa file dưới `packages/*/src`, `apps/*/src`, `scripts/*`, hoặc `.sql` mới | cảnh báo to, tách biệt khỏi `⊘ manual-close`, xuất hiện tối thiểu ở `--audit` | script |
| RCH-7 | Abuse guard (negative) | `close_by: hand · <lý do>` + `scope` chỉ gồm `package.json`/`pnpm-lock.yaml`/`pnpm-workspace.yaml`/`docs/autopilot-manifests/*.json`/`*.md` (hình dạng `deps-security-bump`) | KHÔNG cảnh báo abuse | script |
| RCH-8 | Failure/idempotency | `--fix` chạy trên mọi precondition RCH-1..RCH-3 | dòng `status:` của task giữ byte-unchanged sau `--fix` | script |
| RCH-9 | Exit code | Bất kỳ số lượng entry `close_by: hand` hợp lệ nào | không tự gây `--check` exit 1; chỉ một `stale` thật (không phải close_by hợp lệ — kể cả một malformed rơi về stale thật, xem RCH-4b) mới gây exit 1 | script |
| RCH-10 | Regression | Mọi task block KHÔNG có field `close_by` | output y hệt hành vi hiện tại cho cả 4 nhóm cũ (pending/stale/weak/no-probe) và cả hai đường HALT (`DEFAULT_BRANCH_UNRESOLVED`, `DEFAULT_BRANCH_MISSING`) | script |
| RCH-11 | Migration | — | diff không có file `.sql` nào dưới `packages/db/migrations/`, không sửa `packages/db/schema.ts` | gate |
| RCH-12 | Kit sync | Sau khi chạy `autopilot-update.sh` | `scripts/autopilot-backlog-reconcile` (Plexco) byte-identical với file canonical, cả hai đọc `# KIT_VERSION: 5`; nếu Plexco vẫn đọc `4`, đây là `AWAIT` (nửa template chưa land), không phải pass | gate |
| RCH-13 | Test isolation | `scripts/autopilot-backlog-reconcile.test.sh` | không chứa edit nào tới `scripts/autopilot-backlog-reconcile`; chỉ gọi script đã sync như subprocess và assert trên stdout/exit code | gate |

RCH-12/RCH-13 là hai hàng dễ bỏ sót nhất: một implementer chỉ nhìn `SCOPE` liệt kê file có thể quên rằng
file đầu tiên trong đó (`scripts/autopilot-backlog-reconcile`) không được sửa trực tiếp — nó chỉ được
SYNC — nếu không đọc "Chia slice theo ranh giới repo" ở trên.

---

## Open questions trong scope

**0 câu hỏi chặn.** Hai điểm còn mở ở bản v0.2 (glyph/wording của `MALFORMED`, và cách lấy quyền ghi
sibling repo) đã được owner trả lời 30/07 và pin thẳng vào §3/"Thiết kế đề xuất"/"Chia slice theo ranh
giới repo" ở trên — không còn gì bỏ ngỏ. Xem Changelog v0.3.

---

## Changelog

| Ngày | Version | Thay đổi |
|---|---|---|
| 30/07/2026 | v0.3 | **Revise theo owner feedback, đổi shape thật chứ không chỉ chữ.** (1) `MALFORMED close_by` dùng glyph `✗` (cùng mức nghiêm trọng với `WEAK-PROBE`) + message 3 dòng chính xác; thêm RCH-4b pin rõ "không miễn trừ" là bảo đảm phải test riêng. (2) Bỏ hẳn câu hỏi "quyền ghi sibling repo" thay vì trả lời nó: tách slice theo ranh giới repo — nửa template là kit maintenance ngoài luồng (đúng tiền lệ `48db365` v14→v17, không slice/gate Plexco), nửa Plexco chỉ chạy `autopilot-update.sh` rồi author test MỚI (`scripts/autopilot-backlog-reconcile.test.sh`, nay trong SCOPE) — không bao giờ ghi ngoài repo Plexco. Xoá HALT thiếu-quyền-ghi khỏi `STOP_CONDITIONS`/`SANDBOX_AND_PERMISSIONS`; thay bằng `AWAIT` nếu `KIT_VERSION` vẫn đọc `4` sau sync. Thêm section "Ranh giới" ghi rõ: split logic-in-template/test-in-consumer chỉ hợp lệ cho P3/non-trust-boundary/non-production, KHÔNG được tái dùng cho `scope-gate`/`review-readiness`/`codex-review-pin`. |
| 30/07/2026 | v0.2 | **Verdict CODE_READY**, `AUTHORITY_SHA 28e4e5a0845031d879ba5b4b6ee7093b804cc0ba`, closure 12/12. Thêm `<!-- review-readiness: code-ready -->` + đổi tiêu đề từ "Slice contract" sang "Autopilot task contract". Tracker entry mirror ở `docs/slice-readiness-verdicts.md`; backlog flip `status: ready` + `launcher: .claude/commands/ap-41-reconcile-close-by-hand-declaration.md`. (Verdict này bị thay bởi v0.3/re-verdict sau — xem trên.) |
| 30/07/2026 | v0.1 | Author slice contract từ backlog task đã mở cùng ngày. Phát hiện thêm ngoài backlog notes gốc: `scripts/autopilot-backlog-reconcile` là file kit canonical (verify byte-identical với `$HOME/Projects/Claude template/autopilot/parallel/autopilot-backlog-reconcile`, cả hai KIT_VERSION 4), không được `autopilot-sync.cjs` quản lý — bắt buộc bước canonical-first trước khi sync xuống Plexco, ghi thành NEGATIVE_SCOPE + RCH-12. Acceptance matrix RCH-1..RCH-12 pin đủ 6 đường phân loại + abuse guard + regression + kit-sync.
