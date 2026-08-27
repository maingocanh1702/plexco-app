# Check không thể bắt được thứ nó đang chĩa vào

> **Register, không phải essay.** Mỗi hàng là một cơ chế thật, đã đo, kèm lệnh đo lại.
> Phiên 2026-08-27 gặp **tám** trường hợp riêng biệt của **cùng một hình dạng lỗi**, trên tám cơ chế
> khác nhau (bash counter, e2e fixture, git pathspec, grep, một runbook, một validator, một chỉ thị
> của owner). Ghi ở đây để phiên sau **nhận ra trường hợp thứ chín**, chứ không phải để nhớ lại tám
> cái này.
>
> Mọi số dòng dưới đây là **số đo ngày 2026-08-27**, không phải authority. Mỗi hàng kèm lệnh định vị
> lại; số lệch thì tin lệnh, không tin bảng.

---

## 1. Hình dạng

**Định nghĩa.** Một check *chạy*, *báo xanh*, và **không tồn tại trạng thái nào của thế giới** khiến
nó đỏ vì đúng cái nó được viết ra để bắt.

Phân biệt với hai lớp quen thuộc hơn:

| Lớp | Người ta biết phải sợ? | Vấn đề |
|---|---|---|
| Thiếu check | Có | Không ai tin là đã được bảo vệ |
| Check sai (false positive) | Có | Ồn ào, tự lộ |
| **Check không thể đỏ** | **Không** | Nó *tồn tại*, được đếm là bằng chứng, và im lặng |

Nguy hiểm nằm ở chỗ nó **tiêu thụ niềm tin**: bảng readiness, gate, review đều tính nó là một ô đã
phủ. Sự vắng mặt của cảnh báo bị đọc là sự vắng mặt của lỗi.

**Câu hỏi chẩn đoán duy nhất — hỏi trước khi tin bất kỳ check nào:**

> *Có tồn tại một trạng thái khiến check này ĐỎ vì đúng lý do nó được viết ra không?
> **Chứng minh bằng cách tạo ra trạng thái đó và nhìn nó đỏ.***

Nếu không trả lời được bằng một lần chạy thật, check đó chưa phải bằng chứng — nó mới là ý định.

**Năm cơ chế làm cho một check không thể đỏ** (tám instance dưới đây rơi vào các nhóm này):

| # | Cơ chế | Instance |
|---|---|---|
| A | Kết quả bị vứt bỏ trên đường về (counter trong subshell) | 1 |
| B | Nhánh chứa assertion không bao giờ được tới; số đếm bất đối xứng che mất | 2 |
| C | Assertion đúng **vì** dữ liệu vắng mặt (negative assertion trên chuỗi trống/thay thế) | 3 |
| D | Chuỗi đối chiếu **khác ngôn ngữ** với chuỗi bị đối chiếu (glob vs literal; regex literal vs identifier) | 5, 6 |
| E | Phạm vi check **không phủ** blast radius của chính hành động nó đang gác | 4, 7, 8 |

---

## 2. Register — tám instance

Mỗi hàng: **cơ chế** · **trích dẫn** · **vì sao vô hình** · **dấu hiệu lẽ ra đã lộ sớm** · **trạng thái**.

### #1 — Suite có thể in `FAIL:` rồi vẫn `exit 0`

- **Cơ chế (A).** `test/unit.sh` pipe vào `while IFS=: read`, nên thân vòng lặp chạy trong **subshell**;
  `bad()` tăng `FAILED` ở đó và biến mất khi subshell kết thúc. Suite kết luận bằng
  `if [ "$FAILED" -eq 0 ]` ở process cha → in `LEVEL3_KIT_UNIT: PASS`, `exit 0`.
- **Trích dẫn** (canonical kit `~/Projects/Claude template/autopilot/parallel/`, đo 2026-08-27):
  `test/unit.sh:285-291` (pipe + vòng lặp), `:17` (`bad()` tăng counter), `:304-310` (kết luận + exit).
  `set -uo pipefail` ở `:9` **không cứu**: cả `printf` lẫn `while` đều exit 0.
- **Đo trực tiếp** (bash 3.2 thật của macOS, chạy 2026-08-27):
  `printf "x\n" | while read -r l; do b; done` → `F=0`; cùng thân vòng lặp với `<<< "x"` → `F=1`.
- **Vì sao vô hình.** Assertion **có in** dòng `FAIL:` ra stderr. Người đọc thấy chữ FAIL và tưởng
  suite đã đỏ; exit code — thứ mà publish gate thực sự đọc — vẫn 0.
- **Dấu hiệu lẽ ra đã lộ sớm.** Bất kỳ vòng lặp assertion nào nằm sau dấu `|`. Luật rẻ hơn phát hiện:
  đọc dữ liệu bằng **redirect/here-string**, không bao giờ bằng pipe, khi thân vòng lặp ghi biến.
- **Trạng thái.** Chưa sửa. Có lane riêng đang **xếp hàng sau** `kit-dd108-closure`, vì
  `test/unit.sh` đang bị lane đó ghi (xem §4). *Không tự sửa file này.*

### #2 — Một assertion chưa từng chạy lần nào

- **Cơ chế (B).** `defect7b: hash-lock content matches sha256 of the registered manifest` nằm trong
  nhánh `if [ -f "$D7B_HASH" ]`. Fixture chết trước đó (`ERR_MODULE_NOT_FOUND` lúc load module) nên
  `register` không ghi hash-lock → luôn rơi vào `else`.
- **Bất đối xứng che nó.** Nhánh thành công phát **2** assertion (`hash-lock file was written` +
  `hash-lock content matches…`); nhánh thất bại phát **1**. Tổng số assertion vì thế **không** để lộ
  một assertion đã biến mất — chỉ trông như thêm một dòng đỏ.
- **Trích dẫn** (canonical `test/e2e.sh`, đo 2026-08-27): khối `:492-500`.
- **Tài sản bị bỏ trống.** Chính là `registered-manifest.sha256` — đúng cái toàn vẹn mà `CLAUDE.md`
  bắt mọi session kiểm tay sau `register`. Check duy nhất chứng minh nó đúng nội dung thì chưa chạy.
- **Dấu hiệu lẽ ra đã lộ sớm.** **Nhánh if/else phát ra số assertion khác nhau.** Cho mỗi nhánh phát
  đúng cùng một số assertion thì tổng số trở thành invariant, và một nhánh không được tới sẽ tự lộ.
- **Trạng thái.** ĐÃ SỬA trên nhánh lane `kit-dd108-closure` (commit `b861077`, 2026-08-27), **chưa
  merge** vào `main` của canonical kit. Commit message đo: *24 assertion đỏ trước, 0 sau, 73 xanh*.

### #3 — Negative assertion đúng vì file không tồn tại

- **Cơ chế (C).** `assert_not_contains "$X" "$sha"` với `X="MISSING"` (giá trị fallback khi
  `cat` file thất bại) → grep không thấy → **ok**. Assertion anh em `assert_contains` trên **cùng**
  biến vắng mặt đó thì **đỏ**.
- **Trích dẫn** (canonical `test/e2e.sh`, đo 2026-08-27):
  `:393` (`reviewer_args="$(cat … || echo "MISSING")"`), `:394-395` `assert_contains` (đỏ),
  `:396-397` `assert_not_contains` (xanh rỗng); định nghĩa helper ở `:30-32`.
- **Nguyên nhân gốc.** `f990469` chuyển cwd của reviewer sang ephemeral worktree, stub reviewer của
  fixture ghi file theo đường dẫn tương đối nên file bị huỷ cùng worktree đó.
- **Vì sao vô hình.** Một mệnh đề phủ định trên dữ liệu **vắng mặt** luôn đúng. Nó báo cáo **chính
  điểm mù của phép đo** là một thành công.
- **Dấu hiệu lẽ ra đã lộ sớm.** Một cặp assertion trên cùng nguồn dữ liệu mà **một đỏ một xanh**.
  Đỏ/xanh lệch nhau trên cùng input là dấu hiệu nguồn vắng mặt, không phải hai kết luận độc lập.
- **Trạng thái.** ĐÃ SỬA cùng `b861077` (lane `kit-dd108-closure`), chưa merge.

### #4 — Runbook tự kiểm bằng đúng suite mù với thứ nó phá

- **Cơ chế (E).** `RUN-commit-dd108.sh` (untracked, ở root canonical kit, mtime `Aug 15 02:25`):
  - `:17` — check tiền-commit **duy nhất**: `bash autopilot/parallel/test/unit.sh | tail -1`.
  - `:19-24` — `git add` sáu file, **có** `test/unit.sh`, **không có** `test/e2e.sh`.
  - `:80` — `git push` trần.
- **Hậu quả đo được.** Sinh commit `6cd4e66` (2026-08-15 02:26). `6cd4e66` thêm hai top-level ESM
  import vào `autopilot-review-readiness.mjs` và cập nhật `unit.sh`, nhưng không cập nhật fixture
  của `e2e.sh` → **e2e đỏ 12 ngày** (tới `b861077`, 2026-08-27). Vì `autopilot-update.sh` chạy cả hai
  suite làm publish gate, e2e đỏ = **đóng kênh phân phối**: không repo consumer nào nhận được bất kỳ
  fix nào của kit, kể cả fix không liên quan (`KIT_SUITE_RED`).
- **Vì sao vô hình.** Runbook **có** một check, chạy thật, xanh thật. Nó chỉ không phủ vùng nó vừa
  chạm. Bán kính của `git add` rộng hơn bán kính của `unit.sh`.
- **Dấu hiệu lẽ ra đã lộ sớm.** So **tập file được stage** với **tập file mà check đọc**. Không bằng
  nhau → runbook chưa tự kiểm. (Ở đây `test/e2e.sh` thậm chí không nằm trong `git add`, nhưng
  `autopilot-review-readiness.mjs` thì có — mà chỉ `e2e.sh` mới chạy được nó end-to-end.)
- **Trạng thái.** Hệ quả đã sửa (`b861077`). Bản thân runbook vẫn còn untracked ở canonical root,
  **chưa** có ai sửa mô hình tự-kiểm của nó. Ngoài phạm vi mọi lane hiện tại.

### #5 — Pathspec khai báo không khớp chính file nó khai báo

- **Cơ chế (D).** `assertBaseUsable()` truyền thẳng từng entry `scope` vào `git diff` làm **pathspec**.
  Trong pathspec, `[` `]` là **character class của glob**, không phải ký tự literal.
- **Trích dẫn** (repo Plexco, đo 2026-08-27): `scripts/autopilot-review-readiness.mjs:442-446`
  (`git diff --name-only ${baseSha}..${cur} -- ...scope`), `BASE_STALE` halt ở `:449`.
  Bản canonical cùng logic lệch **-18 dòng** (`:424-428`) — hai bản **không** byte-identical (đo:
  892 dòng canonical vs 910 dòng Plexco).
- **Đo trực tiếp** (canonical kit, 2026-08-27):
  `git ls-files -- "autopilot/parallel/test/[eu]nit.sh"` → **khớp `unit.sh`**;
  cùng lệnh với `:(literal)` → **rỗng**.
- **Hậu quả hai chiều.** Một scope entry `app/[id]/page.tsx`:
  - **không khớp chính file literal của nó** → thay đổi thật trên base tại đúng file đó **né** `BASE_STALE`;
  - **khớp** `app/i/page.tsx` → `BASE_STALE` giả.
- **Vì sao vô hình.** Gate vẫn chạy `git diff` thật, vẫn halt thật khi có gì đó khớp. Chỉ là "khớp"
  được định nghĩa bằng ngôn ngữ khác với thứ manifest tưởng mình đang khai.
- **Dấu hiệu lẽ ra đã lộ sớm.** Bất kỳ chuỗi do người khai nào đi vào một API có **cú pháp pattern**.
  Đường đi mặc định phải là literal (`:(literal)`, `grep -F`, `LIKE … ESCAPE`), pattern là ngoại lệ
  phải khai báo.
- **Ai tìm ra.** Codex review của chính thay đổi cho phép đăng ký loại path đó — tức là check bậc
  trên bắt được, còn check bậc dưới thì không.
- **Trạng thái.** ĐANG SỬA — `kit-dd108-closure` **fix round 1**, hiện là **working-tree chưa commit**
  (`SCOPE_PATHSPECS = scope.map(item => ':(literal)' + item)`). *Không đụng vào.*

### #6 — Test viết ra để đóng lớp "silent divergence" có một khoảng mù im lặng

- **Cơ chế (D).** Test byte-identity của DD-108 trích danh sách trusted file bằng
  `grep -oE '"scripts/[^"]+"'` trên khối `TRUSTED_GATE_FILES` — tức là **chỉ lấy các phần tử được
  viết dưới dạng string literal**.
- **Trích dẫn** (canonical `test/unit.sh:258-259`; tập hợp ở
  `autopilot-review-readiness.mjs:28-38`, đo 2026-08-27). Tập hợp có **5** phần tử; phần tử thứ năm
  là **identifier trần** `REVIEW_TOOL`, khai ở `:27` = `"scripts/codex-review-pin.sh"`.
- **Đo.** 4/5 file được phủ. File bị bỏ sót là **wrapper của chính reviewer** — công cụ thực hiện
  review, tức là file duy nhất mà không cuộc review nào có thể bắt được divergence của nó, **vì nó
  chính là cuộc review**.
- **Vì sao vô hình.** Test chạy, in một loạt `ok:` có thật, cho những file có thật. Không có gì báo
  "đã bỏ qua 1". Con số 4 không bao giờ được so với 5.
- **Dấu hiệu lẽ ra đã lộ sớm.** **Trích xuất bằng regex rồi không so số lượng.** Mọi phép parse một
  tập hợp phải khẳng định `số phần tử trích ra == số phần tử của tập hợp`; phần khái quát hoá được là
  chỗ đó, không phải việc thêm một pattern regex nữa.
- **Trạng thái.** ĐANG SỬA — cùng `kit-dd108-closure` fix round 1 (chưa commit): parse **phần tử**
  của Set rồi resolve từng cái, thay vì grep literal. Lưu ý: khối assertion mới thêm ở commit
  `4bc6bb7` **thừa hưởng cùng khoảng mù** vì dùng lại biến `$trusted_paths` đó.

### #7 — Validator xác thực định danh, không xác thực nội dung tại định danh

- **Cơ chế (E).** `scripts/check-review-readiness.mjs` (repo Plexco) kiểm `AUTHORITY_SHA` rất kỹ —
  **định dạng** (40 hex thường), **tồn tại** (`git cat-file -e <sha>^{commit}`), **ancestry**
  (`git merge-base --is-ancestor <sha> main`) — và kiểm `TARGET_FILES` là đường dẫn exact, không
  glob, tồn tại **trong working tree** (`fs.existsSync`). Không bao giờ kiểm target **tồn tại tại
  chính SHA đó**.
- **Trích dẫn** (đo 2026-08-27): `validateAuthority()` ở `:147-177`; `validateTargets()` ở
  `:180-224`, kiểm tồn tại ở `:222` (`fs.existsSync`) → mã lỗi `TARGET_FILES_MISSING`.
- **Bằng chứng lỗ hổng là thật.** `docs/sessions/2026-08-26-plexco-DIRECT-RUN.md` pin
  `AUTHORITY_SHA: da43f60bb8ab9ce19db043295b0081e0b2dc939a` và liệt **chính nó** làm `TARGET_FILES`.
  Đo: `git cat-file -e da43f60:docs/sessions/2026-08-26-plexco-DIRECT-RUN.md` → **ABSENT**
  (`exists on disk, but not in 'da43f60'`). File chỉ xuất hiện từ `5a7a082`. Cả ba check của
  validator đều xanh.
- **Vì sao vô hình.** Hai check đứng cạnh nhau và **trông như** một cặp đầy đủ: một cái xác thực SHA,
  một cái xác thực path. Không cái nào nối hai vế lại. Authority pin vào một điểm lịch sử mà tại đó
  đối tượng được authorize còn chưa tồn tại.
- **Dấu hiệu lẽ ra đã lộ sớm.** Hai trường **phụ thuộc nhau** được validate **độc lập**. Nếu A pin
  một revision và B pin một path, phải có đúng một check trên **cặp** (A, B).
- **Đóng lớp này bằng.** Thêm `git cat-file -e <AUTHORITY_SHA>:<target>` cho **mỗi** target.
- **Trạng thái.** MỞ, chưa có lane. (Lane `d2-doc-self-claims` đang xử lý *triệu chứng* trên tài liệu
  DIRECT-RUN, không phải *lỗ hổng validator* này.)

### #8 — Đọc một mệnh đề, bỏ mệnh đề liền trước nó

- **Cơ chế (E).** Một chỉ thị của owner (2026-08-27) đọc **một hàng tóm tắt** trong
  `docs/standards/decisions.md:121` (hàng bảng DD-117), lấy mệnh đề
  `không couple impact_policy/DD-49`, **bỏ mệnh đề đứng ngay trước** trong cùng ô:
  `DD-112 capacity giữ ⬜`, và **không grep** các ràng buộc trỏ ngược về chính DD đó.
- **Trích dẫn** (đo 2026-08-27):
  - `decisions.md:121` — hàng tóm tắt DD-117 chứa **cả hai** mệnh đề trong một ô.
  - `decisions.md:2187` — DD-112 (khối bắt đầu `:2154`), ràng buộc **(c)**: slice không được
    *"sửa edge #4 để tách capacity ra"*.
  - `decisions.md:1735` — DD-117 (khối bắt đầu `:1679`), mục **KHÔNG authorize**: *"**KHÔNG** couple
    capacity vào `impact_policy`/DD-49, **KHÔNG** sửa edge #4"* (mệnh đề trải `:1733-1735`).
- **Kết quả.** Hai dòng đã ratified cấm thẳng chỉ thị vừa phát ra. **Lane nhận lệnh đã từ chối và
  trích dẫn cả hai.** Owner tự ghi lại sự việc: *"một khẳng định trách người khác không verify, phát
  ra mà không verify"*.
- **Vì sao vô hình.** Hàng tóm tắt **đúng** — nó chứa đủ cả hai mệnh đề. Điểm hỏng nằm ở việc dừng
  đọc khi gặp mệnh đề khớp kỳ vọng. Đây là cùng hình dạng với #4/#7: phạm vi đọc hẹp hơn phạm vi tác
  động của điều sắp phát ra.
- **Dấu hiệu lẽ ra đã lộ sớm.** Trích một **mệnh đề** ra khỏi một ô bảng chứa nhiều mệnh đề. Hàng
  tóm tắt là **index**, không phải authority: đọc hết ô, rồi mở khối DD đầy đủ, rồi grep các DD được
  ô đó nhắc tên.
- **Trạng thái.** Đã đóng bằng việc lane từ chối; không có mã nào bị viết sai. Ghi ở đây vì cơ chế
  con người **giống hệt** cơ chế máy — và vì đây là instance duy nhất mà check-không-thể-đỏ chính là
  người phát chỉ thị.

---

## 3. Mẫu đi kèm — tài liệu tự khai compliance của chính mình

Cùng phiên, `docs/sessions/2026-08-26-plexco-DIRECT-RUN.md` đưa ra **ba** khẳng định sai **về chính
nó** (đo 2026-08-27):

1. **Khai đã xoá một plan bị thay thế, trong một commit không xoá nó.** `5a7a082` là `1 file changed,
   327 insertions(+)` — không có deletion nào. `docs/sessions/2026-08-26-next-steps-plan.md` sống
   song song trên `main` cho tới `ccf6890` (2026-08-27) mới thực sự xoá (157 deletions). Commit
   message của `ccf6890` tự ghi nguyên nhân: lệnh commit trước dùng `git commit -- <paths>` nên ghi
   đè phần gỡ khỏi index. *Đo bổ sung 2026-08-27: khẳng định supersede này nằm ở tầng
   commit/phiên, không tìm thấy dưới dạng câu chữ trong thân tài liệu ở `5a7a082` — grep
   `next-steps|supersede|thay thế` trong nội dung file tại SHA đó trả về rỗng.*
2. **Pin `AUTHORITY_SHA` tại một commit mà target của chính nó chưa tồn tại** — xem instance #7.
3. **Chưa từng pass validator của chính nó trên bất kỳ commit nào.** Tài liệu khai
   `<!-- review-readiness: enforce -->` (`:1`) và `SECURITY_AND_MIGRATION_GATE: NOT_APPLICABLE`
   (`:321`), trong khi enum của validator là `PASS | PARTIAL | FAIL`
   (`scripts/check-review-readiness.mjs:63`). Tài liệu tồn tại ở đúng hai commit (`5a7a082`,
   `e3f8043`); cả hai đều mang `NOT_APPLICABLE`. Chạy `node scripts/check-review-readiness.mjs
   <file>` → `FAIL (1 error)`.

**Luật rút ra.** *Một tài liệu tự khẳng định mình tuân thủ là một check chĩa vào chính nó.* Trạng thái
tuân thủ phải do một process **khác** tính ra và **ghi ra ngoài** tài liệu. Ba khẳng định ở đây đều là
thật với tác giả lúc viết; cái vắng mặt là bước chạy lại và nhìn.

---

## 4. Luật vận hành

Chỉ giữ những luật mà tám instance trên **thực sự** chống đỡ.

1. **Chứng minh một test mới có thể đỏ.** Mutate đúng thứ nó gác, chạy, nhìn nó đỏ, revert. Chưa thấy
   đỏ thì chưa phải bằng chứng. *(#1, #2)*
   Kèm theo: **commit fix trước khi mutation-test nó** — `git checkout --` quay về commit cuối, không
   phải "trước mutation".
2. **Mọi negative assertion phải có bạn đồng hành khẳng định.** `assert_not_contains` chỉ có nghĩa
   khi có một `assert_contains` **trên cùng nguồn** chứng minh nguồn đó *có dữ liệu*. *(#3)*
3. **Mỗi nhánh if/else của một test phát ra cùng số assertion.** Khi đó tổng số assertion trở thành
   invariant và một nhánh không-được-tới sẽ tự lộ. *(#2)*
4. **Đừng đọc dữ liệu bằng pipe khi thân vòng lặp ghi biến.** Dùng redirect/here-string. Kết luận của
   suite phải đọc counter ở process **cha**. *(#1)*
5. **Runbook: so tập file bị stage với tập file mà check đọc.** Không bằng nhau → runbook chưa tự
   kiểm; blast radius của hành động phải nằm trong blast radius của check. *(#4)*
6. **Chuỗi do người khai luôn đi đường literal.** `:(literal)` cho git pathspec, `grep -F`, escape
   cho SQL `LIKE`. Pattern là ngoại lệ phải khai báo, không phải mặc định. *(#5)*
7. **Parse một tập hợp thì phải khẳng định số lượng khớp.** Trích xuất bằng regex mà không so
   `count(extracted) == count(actual)` là chấp nhận một khoảng mù im lặng. *(#6)*
8. **Hai trường phụ thuộc nhau cần đúng một check trên cặp.** Validate riêng lẻ A và B không thay
   được check "B tồn tại tại A". *(#7)*
9. **Đọc hết câu của một authority, không chỉ mệnh đề khớp kỳ vọng.** Hàng tóm tắt là index; mở khối
   đầy đủ, rồi grep theo **khái niệm** (cơ chế/bảng/cột/danh từ miền), không chỉ theo tên. *(#8)*
10. **Trạng thái tuân thủ do process khác tính, ghi ngoài tài liệu.** *(§3)*

---

## 5. Sở hữu — đừng mở lại việc đã đóng

| # | Chủ đề | Trạng thái (đo 2026-08-27) | Ai sở hữu |
|---|---|---|---|
| 1 | `unit.sh` counter trong subshell | Chưa sửa | Lane riêng, **xếp hàng sau** `kit-dd108-closure` (file `test/unit.sh` đang bị lane đó ghi) |
| 2 | `defect7b` assertion chưa từng chạy | Đã sửa, **chưa merge** | `kit-dd108-closure`, commit `b861077` |
| 3 | `defect6` negative assertion rỗng | Đã sửa, **chưa merge** | `kit-dd108-closure`, commit `b861077` |
| 4 | `RUN-commit-dd108.sh` tự kiểm sai vùng | Hệ quả đã sửa; **mô hình runbook chưa** | Không lane nào |
| 5 | `BASE_STALE` pathspec glob | **Đang sửa**, working-tree chưa commit | `kit-dd108-closure` fix round 1 |
| 6 | DD-108 byte-identity bỏ `REVIEW_TOOL` | **Đang sửa**, working-tree chưa commit | `kit-dd108-closure` fix round 1 |
| 7 | Validator không kiểm target tại `AUTHORITY_SHA` | **MỞ** | Chưa có lane |
| 8 | Chỉ thị đọc thiếu mệnh đề | Đóng (lane từ chối, trích dẫn) | — |
| §3 | Tài liệu tự khai compliance | Triệu chứng đang được xử lý | Lane `d2-doc-self-claims` |

**Ranh giới repo.** Instance 1–6 và §4-#4 sống ở canonical kit
(`~/Projects/Claude template/autopilot/parallel/`), **không** ở repo này. Instance 5 có **hai bản**
`autopilot-review-readiness.mjs` không byte-identical; sửa phải theo hướng canonical-first, không vá
riêng một bản copy.

---

## 6. Lệnh đo lại

Số dòng ở trên là số đo, không phải authority. Định vị lại bằng lệnh:

```bash
KIT=~/"Projects/Claude template/autopilot/parallel"

# #1 counter trong subshell + điểm kết luận của suite
grep -n '| while' "$KIT/test/unit.sh"
grep -n 'FAILED' "$KIT/test/unit.sh"

# #2/#3 hai khối e2e
grep -n 'defect7b\|assert_not_contains "\$reviewer_args"' "$KIT/test/e2e.sh"

# #4 runbook (untracked ở root canonical)
grep -n 'test/unit.sh\|git add\|git push' ~/"Projects/Claude template/RUN-commit-dd108.sh"

# #5 pathspec: bracket là glob, không phải literal
git -C ~/"Projects/Claude template" ls-files -- "autopilot/parallel/test/[eu]nit.sh"          # khớp unit.sh
git -C ~/"Projects/Claude template" ls-files -- ":(literal)autopilot/parallel/test/[eu]nit.sh" # rỗng
grep -n 'BASE_STALE' scripts/autopilot-review-readiness.mjs

# #6 số phần tử thật của tập hợp vs số phần tử grep trích được
awk '/TRUSTED_GATE_FILES/{f=1} f{print NR": "$0} f&&/\]\)/{exit}' "$KIT/autopilot-review-readiness.mjs"
grep -n "grep -oE" "$KIT/test/unit.sh"

# #7 validator: có kiểm target tại AUTHORITY_SHA không
grep -n 'cat-file\|merge-base\|existsSync' scripts/check-review-readiness.mjs
git cat-file -e da43f60:docs/sessions/2026-08-26-plexco-DIRECT-RUN.md   # ABSENT

# #8 đọc cả ô, rồi mở khối DD đầy đủ
sed -n '121p' docs/standards/decisions.md
awk 'NR>=1679 && NR<=1740' docs/standards/decisions.md   # DD-117
awk 'NR>=2154 && NR<=2190' docs/standards/decisions.md   # DD-112

# §3 tài liệu vs validator của chính nó
node scripts/check-review-readiness.mjs docs/sessions/2026-08-26-plexco-DIRECT-RUN.md
```

---

## 7. Ghi chú nguồn

- Đo trên base `e3f8043e272ec74b1d3a9a735d99953ad41b6ae6` (repo này) và canonical kit tại `a4b47b4`
  cộng nhánh lane `kit-dd108-closure` (`3b40643` + working-tree chưa commit), ngày 2026-08-27.
- Instance 8 dựa trên chỉ thị và ghi chú của owner trong phiên 2026-08-27; hai trích dẫn
  `decisions.md` đi kèm thì đã verify trên đĩa.
- Tài liệu này là **register**, không authorize thay đổi nào. Mỗi mục ở §5 với trạng thái MỞ cần một
  lane riêng của nó.

---

## 8. Ống kính mà code review không có

Cùng phiên, trên lane canonical `kit-dd108-closure`: **security round 2/2 đều ra finding**, còn **sáu**
vòng code review cộng lại của cùng lane đó **không thấy cái nào**.

**Security round 1 → [P1]. Môi trường git do caller kiểm soát vô hiệu hoá `BASE_STALE`.**
`GIT_LITERAL_PATHSPECS=1` bắt git đọc **mọi** pathspec như văn bản literal — **kể cả chính tiền tố magic
`:(literal)`**. Gate vì thế đi tìm một file có tên đúng là `:(literal)<path>`, không thấy, `touched` về
rỗng, và **hoàn tất một lần đăng ký thành công trên một base đã thật sự dịch chuyển**: in
`LEVEL3_REGISTER_VALID`, `exit 0`. Không phải một halt bị thiếu — **một gate đã pass**. Một writer set
một biến, và nửa staleness của trust gate ngừng tồn tại.

**Security round 2 → [P2]. Reviewer stub do chính lane sinh ra nội suy đường dẫn dẫn xuất từ `TMPDIR`
thẳng vào mã shell thực thi được**, nên một đường dẫn chứa `$(...)`, backtick hoặc `"` sẽ **chạy**.
Harness đó nằm trong `assert_canonical_suite_green` — chạy **trước mỗi lần publish kit**.

**Vì sao cả hai vô hình với code review — cùng một lý do.** Trong môi trường lành, hành vi **đúng**.
Không có gì cho một reviewer đọc-diff nhìn thấy: glob-free case (mọi scope entry từng được khai cho tới
nay) chạy y hệt nhau ở cả hai bản. Hai lần liên tiếp thì không còn là may — đó là một **ống kính** mà
code gate không có.

**Đây là luận cứ để đổi standing gate**, và nó dừng ở đó. Đổi gate là một thay đổi kit: cần lane riêng,
scope riêng, bằng chứng riêng. **Không gate nào được đổi dựa trên ghi chép này.** Ghi ra để luận cứ đến
kèm bằng chứng, thay vì sau này đến dưới dạng một ý kiến.

**Một dòng nữa — cùng hình dạng, agent tìm thấy trên chính mình.** Ở fix round 3, bản nháp đầu của test
môi trường thù địch cho **cả bốn** case dùng chung **một route**. Case `a` để lại một registration
in-flight trên đúng path đó, nên lần chạy bị bypass rơi vào `SCOPE_COLLISION` và exit nonzero **vì một
lý do không liên quan tới defect** — `assert_exit_nonzero` **pass trên đúng cái gate đang thủng**. Cho
mỗi case một route không tranh chấp thì hành vi thật mới lộ ra: `register` **exit 0**, in
`LEVEL3_REGISTER_VALID`. Cơ chế **C** của §1 (assertion đúng vì một lý do khác), lần này đo trên một
test viết ra để bắt đúng lỗi bảo mật đó.

**Trích dẫn** (canonical kit, nhánh `kit-dd108-closure`, đo 2026-08-27):

- `autopilot/parallel/autopilot-review-readiness.mjs` — `GIT_PATHSPEC_ENVIRONMENT_KEYS`,
  `trustedGitEnvironment()`, `gitAwareArgs()`; bảng hành vi bypass nằm trong khối comment của
  `SCOPE_PATHSPECS`.
- `autopilot/parallel/test/e2e.sh` — case `scope-literal-c` chạy `register` dưới
  `GIT_LITERAL_PATHSPECS=1`; stub sinh ở khối `REVIEWER_ARGS_LOG` / `REVIEWER_MODE_FILE`.
- `autopilot/parallel/autopilot-update.sh` — `assert_canonical_suite_green`.
- commit `821f904` — message ghi nguyên văn chuyện case `a` / `SCOPE_COLLISION`.

**Nguồn của các con số.** `2/2` và `sáu` là **báo cáo của owner** về lane đó; artifact vòng review sống
ở canonical kit và **không truy được từ repo này**. Cơ chế của cả hai finding thì **đã verify trên đĩa**
— trích dẫn ngay trên, lệnh đo ngay dưới.

**Trạng thái.** Tầng pathspec (1) và tầng biến `GIT_*_PATHSPECS` (2) **đã sửa** trên nhánh chưa merge.
Tầng `PATH` (3) và tầng `GIT_DIR`/`GIT_WORK_TREE`/`GIT_INDEX_FILE` (4) **còn mở** — xem
`docs/plexco-run/kit-trust-gate-environment-isolation.md`.

```bash
KIT=~/"Projects/Claude template"

# hai belt của tầng 1+2 (nhánh lane, chưa merge)
git -C "$KIT" grep -n 'trustedGitEnvironment\|gitAwareArgs\|GIT_PATHSPEC_ENVIRONMENT_KEYS' \
  kit-dd108-closure -- autopilot/parallel/autopilot-review-readiness.mjs

# case test chạy gate dưới môi trường thù địch
git -C "$KIT" grep -n 'GIT_LITERAL_PATHSPECS' kit-dd108-closure -- autopilot/parallel/test/e2e.sh

# stub nội suy TMPDIR vào mã shell, và nơi harness chạy như publish gate
git -C "$KIT" grep -n 'REVIEWER_ARGS_LOG=' kit-dd108-closure -- autopilot/parallel/test/e2e.sh
git -C "$KIT" grep -n 'assert_canonical_suite_green' \
  kit-dd108-closure -- autopilot/parallel/autopilot-update.sh

# chuyện case a: assert_exit_nonzero pass trên gate thủng
git -C "$KIT" show 821f904 --stat
```

### Đếm verdict thì đọc dòng verdict CUỐI của mỗi file — đừng `grep -l`

`grep -l 'AUTOPILOT_CODE_VERDICT: CLEAN' *.txt` khớp **mọi** transcript, kể cả những transcript kết
luận FINDINGS. Lý do nằm ngay trong prompt: `scripts/autopilot-review-readiness.mjs` dựng `codePrompt`
liệt kê **cả hai** token hợp lệ thành hai dòng literal (*"The LAST non-empty line must be exactly one
of:"*), và session log của reviewer echo nguyên prompt vào phần `----- stderr -----` của file. Cả hai
chuỗi vì thế có mặt trong 100% file, độc lập với kết quả.

**Đo** (conductor phiên 2026-08-27, trên 6 transcript code-review của lane
`session-draft-lifecycle-commands--v2` — state dir nằm **trong worktree của chính lane đó**, không ở
root repo):

| Phép đếm | Kết quả |
|---|---|
| `grep -l '…: CLEAN'` | **6/6 file** |
| `grep -l '…: FINDINGS'` | **6/6 file** |
| verdict thật (occurrence cuối) | **0 CLEAN**, 6 FINDINGS |

Con số `6` trông y hệt một số đếm, và sai hoàn toàn.

**`tail -1` đúng hay sai TÙY hình dạng file — và đó là lý do đừng dùng nó.** Đo 2026-08-27 trên cả
hai loại transcript có thật trên đĩa:

| Loại | Sinh ra bởi | Dòng không rỗng cuối | `tail -1` |
|---|---|---|---|
| `gate-attempt-*-code-review-round-*.txt` | gate (`autopilot-review-readiness.mjs`) | số token codex, đo `291,196` | **SAI** |
| capture trực tiếp (`codex-review-pin.sh … > f 2>&1`) | conductor gọi tay | chính dòng verdict | đúng — **16/16 file** |

Gate ghép `stdout` rồi `stderr` nên phần đuôi không phải verdict; capture trực tiếp thì đuôi là verdict.
Loại nguy hiểm là loại **gate sinh ra**, vì đó mới là artifact người sau đi grep. Một phương pháp chỉ
đúng trên một trong hai hình dạng thì không phải phương pháp — dùng cách dưới, nó đúng cho cả hai:

```bash
for f in gate-attempt-*-code-review-round-*.txt; do
  printf '%s -> %s\n' "$(basename "$f")" "$(grep -o 'AUTOPILOT_CODE_VERDICT: [A-Z]*' "$f" | tail -1)"
done
```

**Ai mắc.** Chính conductor của phiên này, **trong lúc đang verify một đính chính về những check bị
mù**. Cùng hình dạng với chủ đề của register, cao hơn đúng một tầng: một phép đo *chạy thật*, trả về
*một con số thật*, và không tồn tại tập transcript nào khiến nó ra kết quả khác.

---

## 9. Instance #13 và #14

> **Về đánh số.** Hai instance dưới đây mang số **#13** và **#14** theo cách đếm ở tầng chương trình
> của owner, không theo số heading của §2 (dừng ở #8) — các instance của §8 và của slice record đi kèm
> không được đánh số trong file này. Đừng đọc khoảng trống #9–#12 là "thiếu mục"; đọc là "đánh số ở
> nơi khác".

### #13 — Đường sync lẽ ra đã âm thầm revert một fix vừa land

- **Cơ chế (E).** `copy_pack` trong `autopilot/parallel/autopilot-update.sh` là một
  `cp "$KIT/$src" "$dst"` trần trên **13 đích** — không diff, không backup, không hỏi. Suite của kit,
  thứ đóng vai publish gate, **theo thiết kế** chỉ chạy trên cây canonical: comment ngay trên
  `assert_canonical_suite_green()` ghi thẳng *"never against the consumer"*. Nên không có check nào ở
  bất kỳ repo nào so **file đã cài** với **thứ một lane vừa đặt vào đó**.
- **Cửa sổ revert im lặng nằm đúng ở nhánh nâng version.** Hai nhánh khác nhau về độ ồn:
  - `installed_version < canonical_version` → `copy_pack` chạy **vô điều kiện**, không drift report.
    Đây là nhánh chạy mỗi lần canonical bump — tức đúng lúc consumer sync.
  - cùng version → `cmp -s` từng đích, lệch byte thì **HALT `KIT_DRIFT_SAME_VERSION`** (ồn ào, đúng)
    — trừ khi có `--repair-current`, khi đó lại copy. Lưu ý check này hỏi *"có khác canonical không"*,
    **không** hỏi *"có lane nào đang sở hữu file này không"*. Hai câu hỏi khác nhau.
- **Trích dẫn** (canonical kit, đo 2026-08-27): `copy_pack()`, `pack_pairs()`, hai call site
  `copy_pack` ở hai nhánh version, và `assert_canonical_suite_green()` — tất cả trong
  `autopilot/parallel/autopilot-update.sh`.
- **Đo: 13 đích, 8 trong số đó ghi vào `scripts/` của working copy gốc bên consumer.** *(Brief của
  owner ghi "six"; đo lại 2026-08-27 ra **tám** — tin lệnh, không tin số chép tay.)*
- **Nhưng đây KHÔNG phải defect — đo ra vậy.** File lane vừa sửa là `scripts/check-review-readiness.mjs`
  (thêm `NOT_APPLICABLE` **có điều kiện** cho `SECURITY_AND_MIGRATION_GATE`; nhánh
  `feat/validator-security-gate-enum`, `fd7953c` + `3489e44`, chưa merge). **Zero** pack entry ghi vào
  file đó — nó là file riêng của repo này, **không tồn tại trong kit**. Cái pack có tên gần giống là
  `scripts/autopilot-review-readiness.mjs`, một file khác hẳn.
- **Vì sao vô hình — và đây mới là nội dung của mục.** Hai file cùng nằm trong `scripts/`, tên lệch
  **đúng một từ**, một cái trong pack một cái không; không phép đo nào trong repo phân biệt hộ. Nhưng
  điểm chính không phải kết cục may mắn: **thứ bắt được nó là một câu hỏi của owner** — *"đường sync có
  ghi vào đúng file mình vừa sửa không?"* — **không phải một check nào cả**. Hôm nay **không gate nào ở
  cả hai repo hỏi câu đó**. Một near-miss tìm ra bằng câu hỏi mang đúng lượng thông tin bằng một hit tìm
  ra bằng test; và trong mười bốn instance, đây là instance **duy nhất** không có cơ chế nào đứng sau
  việc phát hiện.
- **Dấu hiệu lẽ ra đã lộ sớm.** Hai file cùng thư mục, tên khác nhau một từ, **khác nhau về chủ sở
  hữu** — một cái do kit đồng bộ, một cái do repo tự giữ. Luật rẻ hơn phát hiện: mỗi lần sửa một file
  trong `scripts/`, hỏi *"file này có nằm trong `pack_pairs` không"*, trả lời bằng một lệnh grep.
- **Trạng thái.** Không phải defect ⇒ **không mở lane riêng**. Đưa vào lane `kit-init-pack-parity` như
  một finding ứng viên, cùng nhóm với các finding lệch-đường-dẫn khác. *(Đo 2026-08-27: tên lane này
  chưa có occurrence nào trên đĩa ở cả hai repo — nó là lane dự kiến, chưa tồn tại.)*

### #14 — Cross-check mù trong chính repo phát hành nó

- **Cơ chế (C).** `autopilot/ap-merge.sh`, tại gán `BL=` trong khối probe của bước 6 (đo 2026-08-27:
  dòng 126), đọc `"$REPO/docs/autopilot-backlog.md"` để cross-check Defect 8 — mâu thuẫn giữa một probe
  vừa PASS và `close_by: hand` của chính task đó. `$REPO` là `git rev-parse --show-toplevel`. Trong
  **repo kit**, đường dẫn đó **không tồn tại**: backlog của kit nằm ở `autopilot/autopilot-backlog.md`.
  `[ -f "$BL" ]` false ⇒ cross-check là **no-op im lặng, ngay trong repo phát hành nó**.
- **Trích dẫn** (canonical kit, đo 2026-08-27):
  - `autopilot/ap-merge.sh` — gán `BL=`, guard `[ -f "$BL" ]` và khối comment ngay trên đó.
  - `ls ~/"Projects/Claude template/docs/autopilot-backlog.md"` → **No such file**;
    `ls ~/"Projects/Claude template/autopilot/autopilot-backlog.md"` → tồn tại.
  - Đối chiếu consumer: repo này **có** `docs/autopilot-backlog.md` ⇒ ở đây cross-check chạy thật.
- **Cố ý cho consumer, mù ở nhà.** Comment tự khai *"a missing file or missing task block is a silent
  no-op (not every repo declares close_by)"* — một nhượng bộ **đúng và có chủ đích** cho consumer. Nó
  chỉ không lường tới chính repo canonical. Guard không thiếu; nó được viết đúng đắn dựa trên một giả
  định tình cờ sai ở nơi nó sống. Đó là toàn bộ nội dung của mục này.
- **Vì sao vô hình — test dựng lại đúng thế giới mà code giả định.** Defect 8 **có** e2e test
  (`autopilot/parallel/test/e2e.sh`, section `defect8`, đủ cả case dương lẫn case âm). Test dựng một
  `$REPO` scratch rồi **ghi backlog vào `$REPO/docs/autopilot-backlog.md`** — đúng đường dẫn code mong
  đợi. Một fixture xây theo giả định của code thì **không bao giờ có thể mâu thuẫn với giả định đó**.
  Test xanh thật, cross-check hoạt động thật — trong một thế giới do chính nó dựng.
  Chi tiết làm nặng thêm: comment ngay trên section `defect8` tự ghi rằng `ap-merge.sh` **không** nằm
  trong pack và *"runs from its template-repo path against whatever repo you're in"*. Repo mà nó chắc
  chắn chạy được nhất chính là repo nó mù.
- **Dấu hiệu lẽ ra đã lộ sớm.** Một đường dẫn hằng trong code, cộng một fixture **tự tạo ra** đường dẫn
  đó. Test khi ấy không chứng minh đường dẫn **đúng**, chỉ chứng minh code đọc được thứ chính test vừa
  đặt vào. Phép kiểm rẻ: chạy `[ -f <path> ]` trên các repo **thật** mà công cụ sẽ chạy, bắt đầu bằng
  repo chứa nó.
- **Trạng thái.** MỞ. Về lane `kit-init-pack-parity`, cùng nhóm với các finding lệch-đường-dẫn khác.
  Không sửa ở đây: file thuộc canonical kit, và repo đó **read-only** với lane này.

### Ghi chú — §1 thiếu một cơ chế

Bảng năm cơ chế ở §1 (A–E) không có ô cho hình dạng của #14: *check viết đúng, fixture dựng lại đúng
thế giới mà check giả định, nên fixture không bao giờ mâu thuẫn được với giả định*. Tạm gọi **F — giả
định được test bằng chính giả định đó**. Không sửa §1 trong lane này (append-only); lần sửa §1 kế tiếp
thì thêm hàng F và trỏ về #14.

### Lệnh đo lại — #13, #14 và cách đếm verdict

```bash
KIT=~/"Projects/Claude template"

# #13 — pack: 13 đích, 8 vào scripts/, 0 đích ghi check-review-readiness.mjs
sed -n '/^pack_pairs() {/,/^}/p' "$KIT/autopilot/parallel/autopilot-update.sh" | grep -c ':scripts/'
sed -n '/^pack_pairs() {/,/^}/p' "$KIT/autopilot/parallel/autopilot-update.sh" | grep -c check-review-readiness
grep -n 'copy_pack\|assert_canonical_suite_green' "$KIT/autopilot/parallel/autopilot-update.sh"

# #13 — hai file tên gần giống, khác chủ sở hữu
ls scripts/ | grep review-readiness
find "$KIT" -name 'check-review-readiness.mjs' -not -path '*/.autopilot/*'   # rỗng: kit không có file này

# #14 — guard đọc đường dẫn không tồn tại trong chính repo kit
grep -n 'BL=' "$KIT/autopilot/ap-merge.sh"
ls "$KIT/docs/autopilot-backlog.md"        # No such file
ls "$KIT/autopilot/autopilot-backlog.md"   # tồn tại
ls docs/autopilot-backlog.md               # consumer CÓ -> ở đây cross-check chạy thật

# #14 — fixture tự dựng đúng đường dẫn mà code giả định
grep -n 'docs/autopilot-backlog.md' "$KIT/autopilot/parallel/test/e2e.sh"

# §8 — đếm verdict: grep -l khớp mọi file; verdict thật là occurrence CUỐI.
# Transcript sống trong .autopilot/state/<lane>/ NẰM TRONG worktree của lane đó, không ở root repo —
# nên tự định vị, đừng ghim đường dẫn của một lane cụ thể (nó biến mất khi lane bị teardown).
# Khối này chạy từ ROOT repo (`.autopilot/worktrees` không tồn tại bên trong một worktree).
D="$(dirname "$(find .autopilot/worktrees -name 'gate-attempt-*-code-review-round-*.txt' \
      2>/dev/null | head -1)")"
[ -d "$D" ] || echo "không còn transcript nào trên đĩa — bỏ qua khối này"
grep -l 'AUTOPILOT_CODE_VERDICT: CLEAN'    "$D"/gate-attempt-*-code-review-round-*.txt | wc -l
grep -l 'AUTOPILOT_CODE_VERDICT: FINDINGS' "$D"/gate-attempt-*-code-review-round-*.txt | wc -l
for f in "$D"/gate-attempt-*-code-review-round-*.txt; do
  printf '%s -> %s\n' "$(basename "$f")" "$(grep -o 'AUTOPILOT_CODE_VERDICT: [A-Z]*' "$f" | tail -1)"
done
```
