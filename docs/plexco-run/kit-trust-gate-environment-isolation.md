# Slice record — `kit-trust-gate-environment-isolation`

> **Ghi chép slice, không phải authority.** Tài liệu này **không authorize** thay đổi nào. Tầng 3 và
> tầng 4 dưới đây **chưa có lane**; mở lane thì lane đó tự mang bằng chứng của nó.
>
> Mọi trích dẫn là **số đo ngày 2026-08-27**, trên nhánh canonical `kit-dd108-closure` (**chưa merge**)
> và trên bản copy nằm trong repo này. Số lệch thì tin lệnh ở §7, không tin bảng.

---

## 1. Tên slice — và vì sao tên cũ sai

Slice này trước đây tên `kit-scope-pathspec-safety`. Owner đổi tên, và **chính việc đổi tên là nội
dung**: tên cũ mô tả **một bug** (pathspec bị đọc như glob), tên mới mô tả **một lớp** — một trust gate
nhận input môi trường từ đúng người mà nó đang gác.

**Mệnh đề đem đi kiểm:**

> Một trust gate **không được nhận bất kỳ phần nào trong execution context của nó từ writer mà nó đang
> gác**. Hôm nay nó nhận **bốn**.

Sửa xong tầng pathspec mà giữ tên cũ thì slice sẽ tự tuyên bố đã xong, trong khi hai tầng còn lại —
nghiêm trọng hơn — vẫn nguyên.

---

## 2. Bốn tầng đã đo

| Tầng | Caller điều khiển cái gì | Nó đổi cái gì trong phép đo của gate | Trạng thái |
|---|---|---|---|
| 1 | Tiền tố magic của pathspec (`[`, `]`, `:(literal)`) | **những file nào** bị so | ĐÃ SỬA — nhánh chưa merge |
| 2 | `GIT_LITERAL_PATHSPECS` · `GIT_GLOB_PATHSPECS` · `GIT_NOGLOB_PATHSPECS` · `GIT_ICASE_PATHSPECS` | **những file nào** bị so | ĐÃ SỬA — nhánh chưa merge |
| 3 | `PATH` → **binary `git` nào** được chạy | **chương trình nào** trả lời câu hỏi | **MỞ** |
| 4 | `GIT_DIR` · `GIT_WORK_TREE` · `GIT_INDEX_FILE` | **repository nào** bị đọc | **MỞ** |

---

## 3. Vì sao tầng 4 không phải "một vị nữa" của tầng 2

Phân biệt của owner, giữ nguyên nội dung:

> Biến pathspec đổi **những file nào** một gate đúng đắn đem ra soi. Biến repo-redirection đổi
> **repository nào** nó soi. Failure mode không phải "gate bỏ sót một file" — mà là **"gate trả về một
> verdict sạch về một repository khác với repository đang được merge"**, và **mọi check phía sau thừa
> kế verdict đó**.

Tầng 1 và 2 làm **hỏng một phép đo**; tầng 4 **thay luôn đối tượng của phép đo**. Kết quả vẫn là một
câu đúng — chỉ là đúng về repo khác. Không có check nào phía dưới phát hiện được, vì tất cả đều nhận
verdict như một dữ kiện đã kiểm.

**Đo trực tiếp** (git 2.46, hai repo trống trong `/tmp`, 2026-08-27): `GIT_DIR` **thắng `git -C`**.

```
git -C A ls-files                          -> only-in-A.txt
GIT_DIR=B/.git GIT_WORK_TREE=B git -C A ls-files -> only-in-B.txt
GIT_DIR=B/.git git -C A rev-parse --git-dir      -> …/B/.git
```

Tức là **`git -C <repo>` không phải hàng rào**. Mọi call site trong file gate đều dùng `-C`; không call
site nào chống được tầng 4. Lệnh dựng lại probe ở §7 — chạy trước khi thiết kế fix, đừng suy từ nguyên
tắc chung.

---

## 4. Tầng 1 + 2 — đã đóng, **đừng sửa lại**

Nằm trên nhánh canonical `kit-dd108-closure`, **chưa merge vào `main` của canonical kit**. Cơ chế:

- `SCOPE_PATHSPECS` nay là **raw path**; tiền tố `:(literal)` đã bị bỏ — chính nó là bề mặt tấn công của
  tầng 2 (`GIT_LITERAL_PATHSPECS=1` đọc luôn cả tiền tố như văn bản literal).
- Literalness áp bằng **command option** `--literal-pathspecs`, prepend vào **mọi argv của git** tại
  choke point mà cả ba helper `run` / `runRaw` / `tryRun` đều đi qua (`gitAwareArgs`). Command option
  outrank environment — đó là toàn bộ lý do chọn nó thay vì tiền tố.
- `trustedGitEnvironment()` copy `process.env` rồi **xoá bốn biến `GIT_*_PATHSPECS`**. Đây là belt thứ
  hai, **không** phải nơi mang literalness: khi environment mâu thuẫn với command option, git không âm
  thầm chọn bên thắng mà **chết** (`READINESS_COMMAND_FAILED`, một halt). Belt này để môi trường thù
  địch không biến thành một halt khó hiểu.

Cả hai đã có test: case `scope-literal-c` và `scope-literal-d` trong `test/e2e.sh` chạy `register` dưới
môi trường thù địch thật.

---

## 5. Tầng 3 + 4 — nội dung của slice này

### Tầng 3 — `git` phân giải qua `PATH` của caller

Các call site gọi `execFileSync("git", …)` bằng **tên command trần**, phân giải qua `PATH` thừa kế.
`trustedGitEnvironment()` copy `process.env` và chỉ xoá bốn key pathspec — **`PATH` sống sót**.

Điểm đáng chú ý: **khuôn sửa đã có sẵn trong chính file đó.** `trustedReviewEnvironment()` dựng lại
`PATH` từ một danh sách cố định và ghim `HOME` cho subprocess **reviewer**. Nghĩa là gate hiện tại
**không tin `PATH` với reviewer, nhưng tin `PATH` với git** — hai subprocess, một file, hai mức tin cậy
khác nhau, không có lý do nào được ghi ra. Fix tầng 3 vì thế là mở rộng một idiom đã tồn tại, không
phải phát minh cơ chế mới.

### Tầng 4 — `GIT_DIR` / `GIT_WORK_TREE` / `GIT_INDEX_FILE`

**Không có occurrence nào** của ba biến này trong toàn bộ `autopilot/parallel/` trên nhánh lane — không
strip, không kiểm, không ghi chú. Cộng với phép đo ở §3 (`GIT_DIR` thắng `git -C`), đây là tầng có
failure mode nặng nhất trong bốn tầng.

### `autopilot-ephemeral-review-worktree.mjs` — nằm ngoài lớp pathspec, nằm **trong** tầng 3 và 4

Đây cũng là một file trust-gate và có `execFileSync("git", …)` riêng. **Audit ở fix round 3**: **không**
thuộc lớp pathspec — nó chỉ chạy `worktree add --detach` và `worktree remove --force` theo **đường dẫn
chính xác**, không có operand pathspec nào.

Nhưng nó **thuộc phạm vi tầng 3 và 4**, vì hai tầng đó nói về **môi trường**, không phải operand. Đo
thêm: ba call site đó **không truyền `env` gì cả** → thừa kế nguyên `process.env`, gồm cả `PATH` lẫn
`GIT_DIR`.

---

## 6. Đừng ghim số dòng — có bằng chứng sống ngay trong slice này

Số `142` của `autopilot-review-readiness.mjs` **có hai nghĩa**, tuỳ cây đang mở:

- trên cây **pre-fix** (canonical `main` và bản copy `scripts/` của repo này) = thân `runRaw`, đúng chỗ
  `execFileSync` gọi `git` trần — đúng cho tầng 3;
- trên **nhánh lane** = `function trustedGitEnvironment()`.

Cùng một con số, hai thứ khác nhau. Trích theo **symbol**, đo bằng grep.

**Ranh giới repo.** Hai bản `autopilot-review-readiness.mjs` (canonical và `scripts/` của repo này)
**không byte-identical**. Sửa theo hướng **canonical-first rồi sync**, không vá riêng một bản copy.

---

## 7. Lệnh đo lại

```bash
KIT=~/"Projects/Claude template"

# tầng 1+2: hai belt, trên nhánh lane chưa merge
git -C "$KIT" grep -n 'gitAwareArgs\|trustedGitEnvironment\|GIT_PATHSPEC_ENVIRONMENT_KEYS' \
  kit-dd108-closure -- autopilot/parallel/autopilot-review-readiness.mjs

# tầng 3: git gọi bằng tên trần; và idiom đã có sẵn cho reviewer
git -C "$KIT" grep -n 'execFileSync("git"\|trustedReviewEnvironment' \
  kit-dd108-closure -- autopilot/parallel/

# tầng 4: rỗng == chưa có xử lý nào
git -C "$KIT" grep -n 'GIT_DIR\|GIT_WORK_TREE\|GIT_INDEX_FILE' kit-dd108-closure -- autopilot/parallel/

# tầng 4: GIT_DIR thắng `git -C` (probe dựng lại từ đầu, không đụng repo nào)
P=$(mktemp -d /tmp/gitdir-probe.XXXXXX)
for r in A B; do
  mkdir -p "$P/$r" && git -C "$P/$r" init -q
  git -C "$P/$r" config user.email p@x && git -C "$P/$r" config user.name p
  echo "$r" > "$P/$r/only-in-$r.txt"
  git -C "$P/$r" add "only-in-$r.txt" && git -C "$P/$r" commit -qm "$r"
done
git -C "$P/A" ls-files                                            # only-in-A.txt
GIT_DIR="$P/B/.git" GIT_WORK_TREE="$P/B" git -C "$P/A" ls-files   # only-in-B.txt
rm -rf "$P"

# ephemeral worktree helper: chỉ worktree add/remove theo path chính xác, và không truyền env
git -C "$KIT" grep -n 'execFileSync' \
  kit-dd108-closure -- autopilot/parallel/autopilot-ephemeral-review-worktree.mjs

# hai bản readiness có byte-identical không
diff "$KIT/autopilot/parallel/autopilot-review-readiness.mjs" scripts/autopilot-review-readiness.mjs
```

---

## 8. Trạng thái

| Tầng | Trạng thái (đo 2026-08-27) | Ai sở hữu |
|---|---|---|
| 1 · tiền tố magic của pathspec | Đã sửa, **chưa merge** | `kit-dd108-closure` |
| 2 · biến `GIT_*_PATHSPECS` | Đã sửa, **chưa merge** | `kit-dd108-closure` |
| 3 · `git` qua `PATH` của caller | **MỞ** | Chưa có lane — slice này |
| 4 · `GIT_DIR` / `GIT_WORK_TREE` / `GIT_INDEX_FILE` | **MỞ** | Chưa có lane — slice này |

Tầng 1 và 2 **đã đóng** — đừng sửa lại. Tầng 3 và 4 **mở** và **chưa được phủ bởi bất kỳ fix nào của
tầng 1/2** — đừng giả định chúng đã theo cùng.

Bối cảnh vì sao cả bốn tầng chỉ do security round nhìn ra, chứ không phải code round:
`docs/plexco-run/checks-that-cannot-catch-what-they-are-pointed-at.md` §8.
