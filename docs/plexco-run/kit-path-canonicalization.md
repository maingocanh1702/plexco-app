# Slice record — `kit-path-canonicalization`

> **Ghi chép slice, không phải authority.** Tài liệu này **không authorize** thay đổi nào. Cả hai
> finding dưới đây **chưa có lane sửa**; mở lane thì lane đó tự mang bằng chứng của nó.
>
> Mọi trích dẫn là **số đo ngày 2026-08-27**, do lane `kit-path-canonicalization-record` đo, trên
> base `e3f8043` của repo này và trên nhánh canonical `kit-dd108-closure--v2` (**chưa merge**) của
> `~/Projects/Claude template`. Số lệch thì tin lệnh ở §6, không tin bảng — §5 có bằng chứng sống
> rằng chính briefing của slice này đã ghim nhầm số dòng.

---

## 1. Mệnh đề — một lớp, hai chỗ

**Mệnh đề đem đi kiểm:**

> Một check so sánh bằng một **proxy hẹp hơn** cái mà nó tuyên bố là giống nhau.

Hai trường hợp đã đo, cùng một lớp:

| Trường hợp | Proxy nó thật sự so | Cái nó tuyên bố là giống nhau |
|---|---|---|
| Path identity | **chuỗi** path — `a/./b` và `a/b` so ra khác nhau | **file** mà cả hai cùng trỏ tới |
| Artifact identity | **bytes** của source, chỉ vậy | **artifact đã cài**, thứ còn có cả một **mode** |

Đây là **một lớp lỗi**, không phải hai việc gộp cho tiện — nên **một slice sở hữu cả hai**. Ở cả hai
chỗ, check chạy xong và trả lời "khác nhau" / "giống nhau" một cách tự tin, trong khi câu hỏi thật
(cùng file không? cùng artifact không?) chưa hề được hỏi. Sửa một chỗ mà bỏ chỗ kia thì lớp lỗi vẫn
còn, chỉ là còn ở nơi không ai đang nhìn.

**Vì sao tên slice chỉ gọi tên trường hợp thứ nhất.** Slice này đã bị đổi tên **một lần** ba cycle
trước (`kit-scope-pathspec-safety`); tên đó nay thuộc về **slice khác** —
`kit-trust-gate-environment-isolation`. Đổi tên lần thứ hai trong ba cycle là tài liệu **chạy theo
finding** thay vì giữ chúng lại. Nên phần khái quát nằm ở **mệnh đề mở đầu**, không nằm ở tiêu đề.
Tiêu đề chỉ là nhãn; §1 mới là phạm vi.

---

## 2. Finding A — scope path trong manifest không được canonicalise (`SCOPE_COLLISION`)

### 2.1 Cơ chế

Có sẵn ở base, **không phải do lane nào gây ra**. `autopilot-scope-gate` so scope entry bằng
`comm -12` trên **chuỗi thô**, tại **hai** call site: một trong `register`, một trong `ready`. Cả hai
đọc cùng một nguồn dữ liệu là `active_others scope`.

Hệ quả: `a/b` và `a/./b` được coi là **hai file khác nhau**. Hai slice có thể cùng giữ reservation
trên **một** file, và cả hai đều register thành công — đúng thứ mà `SCOPE_COLLISION` sinh ra để chặn.

Trích theo **symbol**, đừng theo số dòng (xem §5): `comm -12` + `active_others`.

### 2.2 Helper đã có sẵn, đang chờ đúng consumer này

**Đừng viết lại nó.** Trên nhánh canonical `kit-dd108-closure--v2` đã có `canonical_relpath <path>`
trong chính `autopilot-scope-gate`, đặt **ngay trên `active_others()`** — tức ngay trên nguồn dữ liệu
của phép so ở §2.1. Contract, ghi đúng như source:

- **In ra dạng canonical và trả 0**, *hoặc* **không in gì và trả 1**;
- normalise **đúng ba** thứ: segment `.` (`a/./b`), separator lặp (`a//b`), slash cuối (`a/b/`);
- **từ chối**: path rỗng; path tuyệt đối; một **segment** `..`; và mọi input normalise xong còn rỗng
  (`.`, `./.`);
- `..` bị match **nguyên segment**, nên `a..b` và catch-all route segment `[...slug]` của Next.js
  **đi qua nguyên vẹn**. Điều này không phải chi tiết vụn: scope entry trong manifest hoàn toàn có
  quyền chứa `app/[...slug]/page.tsx`;
- **`..` bị từ chối chứ không bị fold**, vì fold `..` bằng chuỗi chỉ đúng khi không prefix nào là
  symlink — một chuỗi không biết được điều đó. Ở cả hai call site, path do **người gõ tay** vào
  manifest hoặc pack, nên `..` là **defect cần báo**, không phải dạng cần chấp nhận.

**Nửa "từ chối" mới là nửa chịu lực.** Caller cầm một chuỗi canonical thì được phép so bằng `=`.
Caller nhận một refusal thì đã được báo — theo cách duy nhất fail closed — rằng nó **không được**
kết luận *"chuỗi khác nhau, vậy là file khác nhau"*. Đó đúng là kết luận sai mà `SCOPE_COLLISION`
cần chặn, vì ở đó kết luận sai **cấp hai reservation cho một file**.

Dưới `set -e`, caller phải viết:

```bash
p="$(canonical_relpath "$x")" || <handle>     # KHÔNG dùng gán trần
```

### 2.3 Trạng thái của helper

**Đã viết, đã có test, và hiện **chưa được gọi** bên trong gate — cố ý.** Trên
`kit-dd108-closure--v2`, `canonical_relpath` xuất hiện 4 lần trong `autopilot-scope-gate`: một dòng
ở header note, hai trong comment contract, một ở định nghĩa. **Không có call site.** Caller duy nhất
hôm nay nằm ở `test/unit.sh`, chỗ đó `extract_function` nó ra rồi chạy, để chứng minh không pack
installer nào khai hai mapping cho một destination trust-gate.

Nghĩa là: **một helper, hai consumer, theo thứ tự đó.** Consumer thứ nhất (pack check) đã có.
Consumer thứ hai là phép so `SCOPE_COLLISION` ở §2.1 — và **việc của slice này là làm gate gọi nó**,
không phải viết nó.

---

## 3. Finding B — pack check của DD-108 kiểm bytes, chưa bao giờ kiểm mode

Được route sang lane này ngày 2026-08-27 từ lane successor, kèm reproduction. **Chính source đã tự
route**: comment trong `canonical_source_verdict` ghi rõ *"The missing mode capability is a real gap
with a reproduction, routed to kit-path-canonicalization rather than half-answered here."*

### 3.1 Bốn mảnh cơ chế

1. **`copy_pack`** (có trong **cả** `autopilot-update.sh` lẫn `autopilot-init.sh`) áp **mọi** entry
   của pack theo thứ tự, và `chmod` theo **mode được khai** — `100755` → 755, `100644` → 644, khác
   đi thì HALT. Mode đến từ **pack**, không từ file canonical.
2. **Nhánh same-version drift** của `autopilot-update.sh` **có** kiểm mode: nó duyệt pack và báo
   `MISSING` / `DRIFT` (bytes, qua `cmp -s`) / `MODE` (qua `local_mode_matches`).
3. **Nhánh upgrade** (`installed_version < canonical_version`) **không** làm phép so mode đó: nó gọi
   `assert_canonical_suite_green` rồi `copy_pack` thẳng. Nói "nhánh upgrade không kiểm gì" là sai —
   nó **có** một gate, chính là canonical suite. Nhưng suite đó kiểm **source bytes** (mảnh 4), nên
   nó **không** bắt được mode khai sai. Đây là bất đối xứng: cùng một file, cùng một installer, hai
   đường vào, chỉ đường same-version mới đối chiếu mode **của file đã cài**. Và đúng ở giao điểm này
   — đường duy nhất soi mode lại là đường **không** chạy khi nâng version — là chỗ gap sống được.
4. **Check trusted-source của DD-108** (`test/unit.sh`, hàm `canonical_source_verdict`) quyết định
   **source multiplicity** và so **source bytes**. Nó **không** validate mode được khai. Trường thứ
   ba của entry được đọc vào `_` rồi bỏ đi — cố ý, và source ghi rõ đừng "dọn" nó đi.

### 3.2 Reproduction — đã chạy, không phải suy luận

Lane này extract `canonical_relpath` + `canonical_source_verdict` từ chính source đã ship trên
`kit-dd108-closure--v2` rồi chạy trên hai pack khác nhau đúng **một** ký tự ở trường mode:

| Pack entry | Verdict đo được |
|---|---|
| `codex-review-pin.sh:scripts/codex-review-pin.sh:100755` | `match codex-review-pin.sh` |
| `codex-review-pin.sh:scripts/codex-review-pin.sh:100644` | `match codex-review-pin.sh` |

**Hai verdict giống hệt nhau.** Bytes canonical nên nó `match`; mode sai nhưng không ai hỏi tới.

Nối tiếp chuỗi: `copy_pack` thấy khai `100644` → `chmod 644` → readiness gate kiểm
`(st.mode & 0o111) === 0` trên `scripts/codex-review-pin.sh` → đo trực tiếp trên file đã cài
mode 644: **`HALT REQUIRED_TOOL_UNAVAILABLE`**. Mọi consumer lấy bản pack đó đều dừng ở đó.

Lệnh dựng lại đầy đủ ở §6.

### 3.3 Đây **không** phải lỗ hổng bảo mật — đừng định giá nhầm

Thất bại **fail closed và ồn ào tại consumer**: reviewer không chạy được thì readiness gate HALT
ngay, chứ không âm thầm bỏ qua vòng review. Không có trạng thái "review đã pass" giả nào được sinh
ra. Cái mất là **thời gian của mọi consumer** cho tới khi ai đó lần ra pack, chứ không phải một gate
bị vô hiệu hoá lặng lẽ.

Đó cũng chính là lý do nó là **capability gap** chứ không phải incident: check tự nhận đang bảo vệ
"trusted destination", nhưng thứ nó thật sự chứng minh chỉ là "source bytes đúng".

### 3.4 Lane successor đã làm gì — **đừng làm lại**

Lane successor **không** vá capability. Nó làm đúng hai việc, cả hai đều là *thu hẹp lời tuyên bố về
đúng thứ đang được đo*:

- Sửa wording của verdict thành đúng phạm vi thật — "declares one source … bytes only, mode not
  checked";
- Thôi bắt trường mode vào một biến có tên hàm ý rằng nó sẽ được kiểm.

**Bản thân capability gap còn nguyên, và nó thuộc slice này.**

---

## 4. Ranh giới scope

Slice này là phần **capability**: làm gate canonicalise **trước khi** so, và quyết định pack check
**nợ** gì về mode.

Nó **không phải** slice environment-isolation
(`docs/plexco-run/kit-trust-gate-environment-isolation.md`, cùng thư mục — cùng nằm trên một nhánh
chưa merge). Slice đó nói về một trust gate nhận **execution context** từ chính writer mà nó đang
gác. **Khác lớp, khác slice.** Trỏ một lần ở đây là đủ; đừng chép lại nội dung của nó sang đây, và
đừng suy rằng fix bên đó phủ luôn hai finding ở trên.

---

## 5. Đừng ghim số dòng — bằng chứng nằm ngay trong briefing của slice này

Briefing mở lane này ghim hai vị trí. Đo lại, **không vị trí nào khớp**:

| Trích dẫn trong briefing | Đo được | Ở đâu |
|---|---|---|
| `comm -12` ~`:628-632` (register), ~`:699-703` (ready) | `595`/`596` và `666`/`667` | bản đã cài trong repo này @ `e3f8043` (KIT_VERSION 31) |
| — | `595`/`596` và `666`/`667` | canonical `main` (KIT_VERSION 32) |
| — | `678`/`679` và `749`/`750` | `kit-dd108-closure--v2` (KIT_VERSION 33) |
| `autopilot-review-readiness.mjs:596` (kiểm executable) | `504` | bản đã cài trong repo này @ `e3f8043` |
| — | `486` | canonical `main` |
| — | `598` | `kit-dd108-closure--v2` |

Ba cây, ba con số, cho **cùng một** symbol. Con số `596` trong briefing lệch 2 dòng so với cây gần
nhất, và lệch gần trăm dòng so với hai cây còn lại — nó *đọc như một dữ kiện* nhưng chỉ đúng cho một
cây mà người đọc không biết là cây nào. Ở đây nó còn rơi trúng một block khác hẳn (`EVIDENCE_UNKNOWN_KEY`)
trên bản đã cài, tức là một người tin nó sẽ đọc nhầm hẳn cơ chế.

**Trích theo symbol** — `comm -12`, `active_others`, `canonical_relpath`, `canonical_source_verdict`,
`copy_pack`, `local_mode_matches`, `REQUIRED_TOOL_UNAVAILABLE` — và đo bằng grep.

**Một lệch nữa, cùng loại:** briefing ghi `docs/plexco-run/` "đã có trên base". Đo trên `e3f8043`:
thư mục **không tồn tại**. Hai file "đang có" của nó nằm trên các nhánh sibling **chưa merge**
(`feat/lessons-checks-that-cannot-fail`, `docs/probe-dd112-capacity-money`). Không chặn việc gì —
git không lưu thư mục rỗng, file này tự tạo ra thư mục — nhưng nếu bạn dựa vào "thư mục đã có" để
suy ra "hai file kia đã ở trên main" thì suy sai.

---

## 6. Lệnh đo lại

```bash
KIT=~/"Projects/Claude template"
B=kit-dd108-closure--v2

# Finding A: hai call site so chuỗi thô — đọc số dòng do lệnh in ra, đừng tin bảng
git -C "$KIT" grep -n 'comm -12' "$B" -- autopilot/parallel/autopilot-scope-gate
grep -n  'comm -12' scripts/autopilot-scope-gate          # bản đã cài trong repo này

# Finding A: helper đã có, và đang KHÔNG có call site trong gate
git -C "$KIT" grep -n 'canonical_relpath' "$B" -- autopilot/parallel/autopilot-scope-gate
git -C "$KIT" grep -n 'canonical_relpath' "$B" -- autopilot/parallel/test/unit.sh   # caller duy nhất

# Finding A: helper CHƯA có trên main lẫn trên nhánh dd108 đời trước
for r in main kit-dd108-closure "$B"; do
  printf '%-24s %s\n' "$r" \
    "$(git -C "$KIT" grep -c canonical_relpath "$r" -- autopilot/parallel/autopilot-scope-gate 2>/dev/null || echo 0)"
done

# Finding B: mode đến từ pack; nhánh upgrade không soi mode, nhánh same-version có
git -C "$KIT" grep -n 'copy_pack\|local_mode_matches' "$B" \
  -- autopilot/parallel/autopilot-update.sh autopilot/parallel/autopilot-init.sh

# Finding B: reproduction — cùng bytes, khác mode khai, cùng verdict
P=$(mktemp -d /tmp/mode-repro.XXXXXX)
git -C "$KIT" show "$B:autopilot/parallel/autopilot-scope-gate" > "$P/scope-gate"
git -C "$KIT" show "$B:autopilot/parallel/test/unit.sh"         > "$P/unit.sh"
sed -n '/^canonical_relpath() {/,/^}/p'        "$P/scope-gate" >  "$P/fns.sh"
sed -n '/^canonical_source_verdict() {/,/^}/p' "$P/unit.sh"    >> "$P/fns.sh"
. "$P/fns.sh"
DST=scripts/codex-review-pin.sh
canonical_source_verdict "codex-review-pin.sh:$DST:100755" "$DST" "$KIT/autopilot/parallel"
canonical_source_verdict "codex-review-pin.sh:$DST:100644" "$DST" "$KIT/autopilot/parallel"
rm -rf "$P"

# Finding B: consumer dừng ở đâu khi reviewer bị cài mode 644
grep -n 'REQUIRED_TOOL_UNAVAILABLE' scripts/autopilot-review-readiness.mjs

# KIT_VERSION: đọc từ header, không chép tay
awk '/^# KIT_VERSION:/{print $3; exit}' scripts/autopilot-scope-gate
```

---

## 7. Trạng thái

| Finding | Trạng thái (đo 2026-08-27) | Ai sở hữu |
|---|---|---|
| A · scope path so bằng chuỗi thô (`SCOPE_COLLISION`) | **MỞ** — có sẵn ở base, chưa lane nào sửa | Slice này |
| A · helper `canonical_relpath` | **Đã viết, đã test, chưa merge**, cố ý chưa gọi trong gate | `kit-dd108-closure--v2` |
| B · pack check không validate mode | **MỞ** — capability gap còn nguyên | Slice này |
| B · wording verdict thu hẹp đúng phạm vi đo | **Đã làm**, chưa merge | Lane successor |

Hai việc **đã xong, đừng làm lại**: viết `canonical_relpath` (Finding A) và sửa wording verdict
(Finding B). Hai việc **còn mở**: gọi helper tại hai call site `comm -12`, và quyết định pack check
nợ gì về mode.

Bối cảnh vì sao cả hai finding đều thuộc một hình dạng lỗi lặp lại trong kit:
`docs/plexco-run/checks-that-cannot-catch-what-they-are-pointed-at.md`.
