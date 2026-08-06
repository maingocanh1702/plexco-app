<!-- review-readiness: criteria -->

# Level 3: workflow hiện tại vs đề xuất modernization — chấm theo trục tự động hoá

> **Status:** phân tích, chưa phải quyết định · **Soạn:** 2026-08-07
> **Đo trên:** repo `Plexco app`, `git rev-parse HEAD` lúc soạn = `2cd52ce` (`chore(autopilot): sync kit v30 -> v31`),
> kit version đọc bằng `awk '/^# KIT_VERSION:/{print $3; exit}' scripts/autopilot-scope-gate`.
> **Đầu vào so sánh:** `level3-modern-prompt-modernization-proposal-en.md` +
> `modern-prompt-and-task-delegation-workflow-en.md` (owner cung cấp; đo trên repo `Claude template`, **không phải** repo này).
>
> **File này không thay đổi gì.** `docs/autopilot-templates/level3-workflow.md` vẫn canonical.
> `docs/standards/review-code-readiness-gate.md` vẫn giữ nguyên hiệu lực. Đây là input cho một quyết định,
> không phải quyết định.
>
> **Mọi con số dưới đây là phép đo tại commit trên.** Đo lại trước khi trích — theo §12 anti-drift của canonical.

---

## 0. Chấm theo cái gì

Câu hỏi của owner là *tự động hoá tối đa cho task/session/feature, lợi ích lớn nhất cho project* — nên
không chấm "workflow nào hiện đại hơn". Chấm hai trục:

- **Trục A — tầm bay:** một task chạy được bao xa trước khi phải dừng vì người hoặc tool. Đo bằng
  nguyên nhân terminal thật, không bằng cảm giác.
- **Trục B — giá của sự chặt chẽ:** mỗi đơn vị nghi thức mua được bao nhiêu lỗi thật bị bắt.

Một thay đổi chỉ đáng làm khi nó **tăng A mà không giảm B**. Rút gọn context làm tăng A *gián tiếp*;
nó không chạm vào bất kỳ nguyên nhân dừng nào ở mục 2.

---

## 1. Proposal không phải một workflow — đây là lỗi đề bài dễ mắc

`§4.2 Non-Goals` của proposal khai báo rõ nó **giữ nguyên**: P0–P3, worktree isolation, one-writer,
scope/negative-scope, Codex review độc lập, security review, `MAX_ROUNDS`/`REGION_THRASH`,
`READY|AWAIT|HALT`, không auto-merge, không retrofit session đang chạy.

Nghĩa là **luật không đổi**. Cái đổi là ba thứ:

| Đổi cái gì | Từ | Sang |
|---|---|---|
| Đóng gói context | 1 pack always-loaded | core nhỏ + Skills nạp theo trigger |
| Task contract | 1 khối 20 field lẫn ý định và cơ chế | contract 12 field + runtime manifest v3 do generator sinh |
| Bằng chứng khi sửa rule | prose + phán đoán | rule ledger + eval hành vi (26 case, 6 holdout, 156 run) |

Nên so sánh đúng là: **"chương trình đóng gói lại context này có làm task chạy xa hơn không, với giá nào"** —
chứ không phải "workflow A hay B".

---

## 2. Cái đang thực sự chặn tự động hoá — đo, không đoán

Đếm chuỗi lý do terminal xuất hiện trong `docs/`, **loại trừ** `docs/autopilot-templates/`
(vì đó là văn bản hợp đồng, nó nhắc mọi lý do một cách đối xứng nên sẽ làm nhiễu):

```bash
grep -rhno "HALT[ -_][A-Z_]\{3,\}" docs/ --exclude-dir=autopilot-templates \
  | sed 's/.*HALT[ -_]//' | sort | uniq -c | sort -rn
```

| Lần xuất hiện | Lý do | Đây là lớp vấn đề gì |
|---:|---|---|
| 61 | `EVIDENCE_INCOMPLETE` | chất lượng bằng chứng / spec |
| 28 | `MAX_ROUNDS` | hội tụ vòng review |
| 22 | `TOOL_UNAVAILABLE` | reviewer/tool không gọi được |
| 16 | `AUTHORITY_AMBIGUOUS` | quyết định chưa chốt |
| 15 | `CONTRACT_INVALID` | manifest/hợp đồng sai |
| 10 | `DESIGN_UNFIT` | slice chia sai |

**Cảnh báo về chính phép đo này:** đây là đếm chuỗi ký tự trong prose, **không phải** census trạng thái
terminal. Census thật nằm ở `.autopilot/state/*/`, mà `.autopilot/*` bị gitignore — nên nó không tồn tại
sau khi worktree bị gỡ. Đọc bảng trên là **tín hiệu tần suất tương đối**, không phải tỉ lệ. Việc repo này
không có census terminal-state thật là một phát hiện riêng, xem H1 ở mục 7.

Đối chiếu với proposal:

| Nguyên nhân dừng | Proposal có chạm không | Cái thực sự chạm được nó |
|---|---|---|
| `EVIDENCE_INCOMPLETE` | gián tiếp (Skill `evidence-verification`) | spec đủ acceptance nhị phân trước khi mở slice |
| `MAX_ROUNDS` | **không** | phân loại `infra:` round; truyền scope cho reviewer (gap 1 + 3) |
| `TOOL_UNAVAILABLE` / `CODEX_UNAVAILABLE` | **không** — và proposal còn *tăng* nhu cầu reviewer | phân loại auth-tier thành AWAIT resumable (gap 2) |
| `AUTHORITY_AMBIGUOUS` | gián tiếp | decision log chốt trước, không phải context nhỏ hơn |
| `CONTRACT_INVALID` | **có** (S6b) — nhưng repo này đã sửa rồi, xem mục 5.1 | đã xong ở kit v28 |

> Kết luận trục A: **bốn nguyên nhân dừng lớn nhất không phải vấn đề đóng gói context.** Proposal
> chạm trực tiếp đúng một cái, và cái đó repo này đã đóng.

---

## 3. Bảng đối chiếu từng chiều

| Chiều | Hiện tại (kit v31) | Đề xuất (sau S9) | Ai thắng theo trục A/B |
|---|---|---|---|
| Context always-loaded | 4 file, đo được: `wc -lc CLAUDE.md docs/autopilot-templates/{level3-workflow,autopilot-invariants,autopilot-prompt-GENERIC}.md` → 1.350 dòng / 104.264 byte | core nhỏ + Skill theo trigger; đích ≤50% byte | Đề xuất, **nếu** routing không trượt |
| Bài học sự cố | luôn có mặt trong context | có mặt khi Skill được khai trong contract | Hiện tại an toàn hơn; đề xuất rẻ hơn |
| Task contract | 20 field, người viết tay toàn bộ | 12 field + generator sinh phần máy | Đề xuất — đây là điểm mạnh thật |
| Ràng buộc context ↔ slice | không có | `context_pack` lock hash trong manifest, fail-closed | Đề xuất |
| Fail-closed registration | **đã có** (kit v28+) | S6b làm lại | Hoà — đã xong ở repo này |
| Độ sâu review theo rủi ro | đồng loạt: P2 = 1 vòng, P1 = 2 vòng + security | **không đổi** (§2.5 từ chối kích hoạt tiering tới sau S9) | Hiện tại = đề xuất; cả hai đều chưa giải |
| Bằng chứng khi xoá rule | phán đoán | 156 run + holdout + grader hiệu chuẩn | Đề xuất về chất lượng, **thua nặng về khả thi** |
| Rollback context | không có khái niệm | S1b freeze byte-for-byte + restore probe | Đề xuất |
| Thời gian tới giá trị đầu tiên | — | S1 (sửa prose base/diff) ở phase 3; giá trị chính ở S9 | S1 sớm là điểm cộng; phần còn lại rất xa |
| Chi phí Codex | ~1–2 vòng/slice | + 156 run eval + 23 task canary × 2 chu kỳ + 2 vòng FULL-base cho hầu hết slice | Hiện tại, **áp đảo** |

---

## 4. Proposal đúng ở đâu — bốn điểm nên giữ bất kể quyết định cuối

**4.1. Chẩn đoán "prose trôi khỏi executable" là đúng, và repo này đang mắc.**
`docs/autopilot-templates/level3-workflow.md` §8 dạy rằng `--base` là `base_sha` pinned, *"cùng một giá trị
mọi vòng"*, và gate *"halts `BASE_STALE` khi base ref di chuyển"*. Kiểm bằng code:

```bash
grep -n "diffBase" scripts/autopilot-review-readiness.mjs   # reviewer nhận diffBase = live base ref sha
grep -n "is-ancestor" scripts/autopilot-review-readiness.mjs # BASE_STALE chỉ bắn khi mất ancestry hoặc scope bị đụng
```

Comment ngay trong `assertBaseUsable` nói thẳng vì sao exact-equality đã bị bỏ: *"Exact equality made every
concurrent registration terminal the instant anything landed"*. Prose đang dạy sai cách chẩn đoán thủ công —
đúng thứ S1 nhắm.

**4.2. Anti-metrics (§13.3) là phần thiết kế tốt nhất của proposal.** Cấm lấy `%` token giảm, số file xoá,
số dòng xoá, một task demo xanh làm bằng chứng thành công. Điều khoản này nên copy vào bất cứ lộ trình nào.

**4.3. `effective-context-manifest.json`.** Nếu candidate run vẫn nạp legacy pack thì run đó vô hiệu.
Đây là guard tinh tế và đúng: nó chặn việc "đo giảm context" trong khi cả hai pack cùng load — một lỗi
đo mà không ai tự phát hiện được.

**4.4. Gate sửa chính nó thì không tự cấp chứng chỉ (S6b path).** Nguyên tắc này đúng và rẻ; nên áp
ngay cho mọi slice chạm `scripts/autopilot-*`, không cần đợi chương trình nào.

---

## 5. Proposal sai cỡ hoặc không hợp Plexco ở đâu

### 5.1. S6b — repo này đã sửa rồi, ở kit v28

Đây là điểm bán hàng lớn nhất của proposal (Defect 7: `register` fail-open). Kiểm:

```bash
grep -n "defect 7" scripts/autopilot-scope-gate
```

`register` hiện HALT `CONTRACT_INVALID` **trước** `acquire()`/`append_block()` khi manifest thiếu
`manifest_schema_version` — nghĩa là không để lại reservation treo cho lần retry đúng va vào. Có test
RED/GREEN kèm theo (`test/e2e.sh`, mục `defect7`). Kit hiện tại là v31.

Phần S6b còn lại sau khi trừ cái này chỉ là **validate hash của context pack v3** — thứ chỉ có nghĩa nếu
đã nhận context pack. Không còn là một món độc lập đáng lấy.

### 5.2. Routing Skill quy về chất lượng authoring — đúng điểm yếu đã biết

`§6.5` nói v1 **không** có classifier: `APPLICABLE_SKILLS` do người liệt kê tay trong contract, catalog chỉ
fail-closed với ID **đã khai**. Skill quên khai thì không lỗi nào nổ — chỉ là một bài học không được áp dụng,
im lặng.

Hiện tại pack to nhưng bài học **luôn** có mặt. Sau migration nó có mặt khi ai đó nhớ ra. Đây là đánh đổi
"chi phí attention chắc chắn" lấy "rủi ro bỏ sót không có tín hiệu" — và bỏ sót là lớp lỗi khó bắt hơn nhiều.

### 5.3. Chi phí không khớp năng lực reviewer thật

S3 cần 78 trial hợp lệ. Một chu kỳ so sánh = 156 run. Canary = 23 task, phải sạch **hai** chu kỳ liên tiếp
trên cùng hash. Hầu hết writing slice cần 2 vòng FULL-base + 1 vòng security.

`§8.6` khai báo thẳng: chi phí **không được** giảm corpus; thiếu quota thì `AWAIT EXTERNAL_CAPACITY`.
Nghĩa là gặp trần quota, chương trình **đỗ**, không phải chạy chậm. Với `TOOL_UNAVAILABLE` + `CODEX_UNAVAILABLE`
đã là nhóm nguyên nhân dừng lớn thứ ba ở mục 2, đây không phải rủi ro lý thuyết.

### 5.4. Hoãn tiering = hoãn đúng đòn bẩy tự động hoá

`§2.5` quyết định giữ T0–T3 ở dạng reference-only, **không** kích hoạt trong S0–S10, và chỉ xét lại sau S9.

Nhưng repo này **đã có** `docs/standards/workflow-tiering-policy.md` (v0.2, 31/07, chờ owner chốt) — và đó
chính là văn bản bàn về "áp Level 3 sâu bao nhiêu cho slice nào", tức đòn bẩy trực tiếp nhất lên throughput.
File đó đã tự sửa bốn lỗi của v0.1 nhờ review độc lập, đã thu hẹp khoảng phân tầng còn P1/P2, và đã ghi rõ ba
việc còn phải làm trước khi thành Accepted.

Nói cách khác: **thứ có tác động lớn nhất lên trục A đang chờ một quyết định owner, không chờ một chương
trình 10 phase.** Nhận proposal nguyên khối là đẩy quyết định đó lùi sau S9.

### 5.5. Ba trong bốn gap đang đốt round thì không được sửa

`level3-workflow.md` §8 liệt kê bốn gap đo được. Kiểm hiện trạng bằng code:

| Gap | Còn không | Bằng chứng |
|---|---|---|
| 1. reviewer không nhận scope | **còn** | `codePrompt` trong `autopilot-review-readiness.mjs` chỉ mang `diffBase` + text cố định; `negative_scope` được validate nhưng không bao giờ truyền cho reviewer |
| 2. lỗi auth-tier bị HALT thay vì AWAIT resumable | **còn** | detector chỉ khớp `401\|token_invalidated\|invalid_grant\|log in again`; còn lại rơi xuống `REVIEW_UNAVAILABLE` (HALT bền) |
| 3. `fix-round-count` tăng vì lỗi hạ tầng | **còn** | không có phân loại `infra:` ở đâu trong gate; counter là số trần |
| 4. thay đổi được phép không có đường vào registration đã hash-lock | **còn** | proposal giữ nó ở `docs/kit-design-debt.md`, không sửa |

Gap 1 và 3 cộng lại chính là `MAX_ROUNDS` — nguyên nhân dừng lớn thứ hai. Gap 2 chính là `TOOL_UNAVAILABLE` —
lớn thứ ba. **Proposal không sửa cái nào trong ba.**

### 5.6. Grader stack thành trusted component mới

Nó quyết định promote/reject nhưng chỉ được owner duyệt gold set **một lần** ở S2. Blinded double-run +
deterministic hard-fail authority là thiết kế đúng, nhưng nó vẫn là một hệ thống tin cậy chưa từng chạy,
đứng ở đúng chỗ mà một false pass đi thẳng vào context production.

---

## 6. Bằng chứng sống: entry point của chính repo này đang stale

`CLAUDE.md` mục 3 hiện cảnh báo rằng `autopilot-scope-gate` **fail-OPEN**: rằng nó "bỏ qua hash-lock,
không báo lỗi, vẫn in `registered`", và yêu cầu người dùng tự kiểm `registered-manifest.sha256` sau mỗi lần
register.

Điều đó **đã không còn đúng từ kit v28** (xem 5.1). Ba hệ quả, cả ba đều là lớp lỗi mà chính canonical §12
cấm:

1. Nó mô tả hành vi pre-v28 ở thì hiện tại.
2. Nó chỉ định một **workaround thủ công** cho một defect mà tool đã tự bắt — đúng thứ §5.9 của tài liệu
   "modern prompt" gọi là *rule for limitations that no longer exist*.
3. Nó **hard-pin số dòng** (`dòng 488-491`) — thứ §12 anti-drift cấm thẳng. Guard hiện ở chỗ khác; số đó
   sai từ lúc v28 land.

**Đọc kết quả này hai chiều, cả hai đều đúng:**

- Chẩn đoán của proposal **đúng**: prose trôi khỏi executable, và workaround sống lâu hơn defect của nó.
- Liều thuốc của proposal **sai cỡ**: cái sửa được lớp này là một assertion grep trong CI
  (*"không file normative nào được chứa cụm X khi code không còn hành vi X"*), chạy mỗi commit — chứ không
  phải một chương trình 10 phase kết thúc sau S10.

Nói cách khác: repo này vừa chứng minh vấn đề proposal nêu là có thật, **và** chứng minh nó rẻ hơn nhiều
so với giá proposal đòi.

---

## 7. Lộ trình hybrid — thứ tự, giá, và điều kiện dừng

Nguyên tắc chọn: **mỗi bước phải gỡ được một nguyên nhân dừng ở bảng mục 2, và phải verify được mà không
cần eval harness.** Bước nào không thoả cả hai thì đẩy xuống cuối.

| # | Việc | Gỡ nguyên nhân nào | Risk | Giá | Điều kiện dừng |
|---|---|---|---|---|---|
| **H0** | Sửa `CLAUDE.md` mục 3 + prose base/diff trong `level3-workflow.md` §8; **kèm** một assertion trong CI cấm cụm stale tái xuất hiện | phòng ngừa cả lớp | P2 | 1 slice | assertion không encode được thành lệnh chạy được → dừng, hỏi owner |
| **H1** | Ghi census terminal-state ra chỗ **tracked** (append 1 dòng vào backlog khi task terminal: feature, lý do, số round) | biến bảng mục 2 từ tín hiệu thành số liệu | P2 | 1 slice nhỏ | — |
| **H2** | Owner chốt `workflow-tiering-policy.md`: Accepted hay Rejected | `MAX_ROUNDS`, throughput | quyết định, không phải slice | 1 quyết định | chốt "chờ thêm" cũng là chốt — ghi vào `decisions.md` |
| **H3** | Gap 2: mở rộng auth detector cho lỗi 400-class về entitlement/model-permission → `CODEX_AUTH_REQUIRED` (AWAIT resumable) | `TOOL_UNAVAILABLE` (22) | P1 (chạm gate) | 1 slice + test | không tách được lỗi entitlement khỏi 400 do request hỏng → dừng, giữ HALT |
| **H4** | Gap 3: cho phép nhãn `infra:<reason>` với điều kiện kiểm được (diff bằng 0 so với round trước **và** không giảm số assertion) | `MAX_ROUNDS` (28) | P1 | 1 slice + test | không encode được điều kiện kiểm → **không làm**; nới trần là fix sai |
| **H5** | Gap 1: truyền `negative_scope` vào review prompt, **kèm** khoá không cho writer sửa nó sau register | `MAX_ROUNDS` | P1 | 1 slice + test | không khoá được → không làm; writer nới scope để im finding là hố sâu hơn |
| **H6** | Chỉ khi H0–H5 xong và đã có ≥20 slice trong census H1: tách `autopilot-invariants.md` theo bài học **chưa bắn lần nào** trong census | context bloat | P2 | tăng dần | rule đã bắn → giữ nguyên trong core, không tách |

**H6 là phiên bản khả thi của toàn bộ proposal.** Nó dùng census thật (H1) thay cho 156 run eval, và chỉ
tách những rule mà dữ liệu nói là không bắn — đúng nguyên tắc §5.5 "evidence-based permanence" của proposal,
nhưng lấy bằng chứng từ vận hành thật thay vì từ corpus dựng riêng.

---

## 8. Cái lộ trình này cố ý KHÔNG làm

- **Không** dựng eval harness 26-case / 156-run. Bằng chứng lấy từ census vận hành (H1), rẻ hơn hai bậc.
- **Không** làm manifest v3 / context-pack lock. Nó chỉ có nghĩa khi đã có context pack; chưa đến lúc.
- **Không** đụng `$HOME/.claude/*` — giống proposal, đây là user-owned.
- **Không** nới bất kỳ điều kiện nào của `review-code-readiness-gate.md`. Năm HARD RULES giữ nguyên.
- **Không** đổi P0 prepare-only, không auto-merge, ở bất kỳ bước nào.

---

## 9. Cách biết lộ trình này sai

Viết trước, để sau không tự bào chữa:

- Sau H1 + 20 slice, nếu census cho thấy `MAX_ROUNDS` **không** phải do infra round và **không** do finding
  ngoài scope → H4/H5 đã nhắm sai, và giả thuyết ở mục 2 sai.
- Nếu sau H0 mà prose vẫn trôi lần nữa ở chỗ khác → assertion CI không đủ, và luận điểm "rẻ hơn proposal"
  ở mục 6 sai; lúc đó lớp đóng gói context mới đáng bàn lại.
- Nếu H6 chạy và ≥80% rule hoá ra **đều đã bắn** → context hiện tại không thừa, chỉ là to; cắt nó sẽ mất
  an toàn thật. Dừng H6.

---

## 10. Tóm tắt một câu

Kiến trúc proposal đúng và bốn điểm ở mục 4 nên giữ; nhưng với repo này nó nhắm vào lớp vấn đề (đóng gói
context) **không phải** lớp đang chặn tự động hoá (hội tụ review, bằng chứng, quota reviewer, quyết định
chưa chốt) — và món có giá trị nhất của nó, fail-closed registration, thì kit v31 đã đóng từ v28.
Lộ trình H0–H6 mua phần lớn lợi ích của proposal với chi phí thấp hơn khoảng hai bậc, và giữ nguyên
toàn bộ sàn an toàn.
