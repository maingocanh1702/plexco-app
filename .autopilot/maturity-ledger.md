# Autopilot maturity ledger · Plexco (TRACKED — per-repo credit ledger, GENERIC §A.6)

One line per `<change_class>`. Auto-merge graduates a class to `mature` only after **≥3** clean
READY runs merged UNCHANGED (no founder fix before merge); any founder fix → reset count to 0.
P0/P1 NEVER auto-merge regardless of count. Only P2 `mature` + explicit `Auto-merge requested: yes`
may auto-merge. Increment on a clean unchanged squash; never edit by hand to inflate.

```
change_class            | tier | clean_ready_runs_merged_unchanged | status
identity-feature        | P1   | 0                                 | pilot
billing-feature         | P1   | 0                                 | pilot
cross-club-feature      | P1   | 0                                 | pilot
marketplace-feature     | P2   | 0                                 | pilot
web-feature             | P2   | 0                                 | pilot
```

## Evidence notes (design lessons — NOT auto-merge counters)

- **2026-08-26 — split-early beats hardening a thrashing slice.** `session-commands-close-cancel` hit
  `MAX_ROUNDS` **twice** as one combined slice (two-command surface too wide; each later review round surfaced a
  new coverage corner while round 1 stayed clean = slice-too-big, not thrash). Split into B1 (`CloseSession`) +
  B2 (`CancelSession`) it went through cleanly: B1 gate-passed (2 code + 1 security; 4 doc-accuracy fix-rounds)
  merged `a3654fc`; B2 gate-passed (2 code + 1 security; 2 fix-rounds) landed `8e668a1`. **Second instance the
  same day:** the api-routes DD-56 guard went `REGION_THRASH` as an invented enforcement *subsystem* and
  converged only once reduced to an ESLint import restriction on the same logic. Rule reinforced: when a slice
  keeps thrashing, **split or reduce** it — do not keep hardening it.

- **2026-08-27 — `HALT_RESLICE` được disposition thành continue-from-HEAD: bốn phép đo, không phải tiền lệ.**
  **Re-slice từ `main` vẫn là mặc định.** Nó giả định công cũ là **nợ** — đúng mỗi khi lane thrash, khi
  findings lặp lại một vùng, khi fix chỉ vá rìa. `continue-from-HEAD` chỉ mở khi công cũ là **tài sản**, và
  **burden of proof thuộc về lane**, qua bốn phép đo: (1) suite xanh tại HEAD đã halt, **do conductor tự
  chạy, không phải lane tự khai**; (2) findings không lặp, hoặc lặp không liên tiếp (`REGION_THRASH` im
  lặng); (3) mỗi fix là một hội tụ — một resolver, một choke point, một data channel — không phải vá rìa;
  (4) HEAD đã halt mang thứ `main` không có và không tái tạo rẻ được.

  Ca đầu tiên đạt đủ bốn: `kit-dd108-closure` (canonical kit repo, 2026-08-27) HALT tại `4fa81f1`, 15 commit
  trên base `a4b47b4`, 4 file; conductor chạy lại tại chính HEAD đó được `LEVEL3_KIT_UNIT` 69 ok / 0 fail và
  `LEVEL3_KIT_E2E` 101 ok / 0 fail. `test/unit.sh` bị flag ở vòng 1, 2 và 8 — **không liên tiếp**, nên
  `REGION_THRASH` đúng khi không nổ. Thứ `main` không có: đó là cây **duy nhất** gỡ được `KIT_SUITE_RED` —
  `main` canonical vẫn đỏ `test/e2e.sh` nên `autopilot-update.sh` HALT trước `copy_pack`, và cả hai consumer
  đã 12 ngày không sync được kit fix nào (owner ghi 2026-08-27). Halt ở đây là **cạn budget trên công lành**,
  không phải thrash: vòng 8 nêu một [P1] do chính lane viết ra ở fix round 2 (`unit.sh:362` so đích pack bằng
  chuỗi chính xác → alias `./` nhân đôi đích trong khi check vẫn báo `match`), trong khi luật reserve của
  owner chỉ cho tiêu round 5 vào lỗi **do** fix round 4 gây ra — cái này thì không.

  Ba amendment mới là thứ giữ cho ngoại lệ khỏi thành giấy thông hành: (1) **scope chỉ gồm thứ lane tự
  viết ra** — ADVISORY vòng 8 đo được là pre-existing tại base nên tách slice riêng, theo nguyên tắc đối
  xứng: lane không được hoãn thứ nó viết, cũng không được tiêu budget cho thứ nó thừa hưởng; (2) **budget
  cắt còn 3 fix round, không phải 5 mới** — bình đầy tại một HEAD đã halt sẽ làm `MAX_ROUNDS` thành đồ trang
  trí, và 3 chính là một phép đo: hai việc bounded mà không hội tụ nổi trong ba vòng thì "công lành, cạn
  budget" đã là chẩn đoán sai; (3) **verdict không cộng dồn** — commit giữ lại, vòng sạch thì không; chúng
  là verdict về một cây không còn tồn tại, và **successor thừa hưởng verdict là một lane tự đổi tên**.

  **Số vòng sạch của AW-1, chép vào đây thay vì trỏ đi nơi khác** (đo 2026-08-27, dòng verdict CUỐI của
  từng transcript — không phải `grep -l`, vì prompt liệt kê cả hai token nên mọi transcript chứa cả hai):

  | code | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | | security | 1 | 2 |
  |---|---|---|---|---|---|---|---|---|---|---|---|---|
  | | F | F | **C** | **C** | **C** | **C** | **C** | F | | | F | F |

  ⇒ **5 vòng code CLEAN (3–7), 0 vòng security CLEAN.** Disposition cycle-18 ghi "six clean rounds" —
  lệch 1, và **đó là con số của owner**, mang sang từ một report chứ không tự đo. Ghi lại chứ không sửa
  lén: *một ledger chỉ ghi lỗi của lane là ledger không ai nên tin.*

  **Vì sao bảng nằm ngay đây thay vì một đường dẫn:** bản gốc trỏ
  `/tmp/aw1-code-review-round-*.txt`; transcript sau đó được copy sang
  `.autopilot/state/kit-dd108-closure/review-transcripts/` — nhưng `git ls-files .autopilot/` ở repo này
  trả **đúng một** file (chính ledger này, force-add qua negation `.gitignore:56-57`) và ở kit repo trả
  **không file nào**. Cả hai đường đều **ngoài git**. Luật rút ra: **bằng chứng của một bản ghi phải bền
  ít nhất bằng chính bản ghi đó** — một ledger được git track mà trích một đường không được track là một
  dangling reference ngay từ lúc viết, không phải một citation. Đường dẫn transcript giữ lại chỉ như
  *machine-local provenance*, không phải nguồn.

  AW-1 cung cấp đủ cả bốn phép đo, **và đó vừa là lý do nó được ngoại lệ, vừa là lý do ngoại lệ này không
  tổng quát.**
