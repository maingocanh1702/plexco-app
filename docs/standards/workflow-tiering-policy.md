<!-- review-readiness: policy -->

# Workflow tiering — áp Level 3 sâu bao nhiêu, cho slice nào

> **Status:** đề xuất 2026-07-31, chờ owner chốt · **Version:** 0.2
> **Quan hệ với các doc khác:** `level3-workflow.md` là **canonical** cho trục risk P0–P3 và cho định
> nghĩa từng mức. `review-code-readiness-gate.md` nói **khi nào** một plan được phép thành code. File này
> chỉ phân bổ **độ sâu review** trong khuôn khổ canonical đã định — nó **không định nghĩa lại tier**,
> không thêm cơ chế, và **không nới bất kỳ điều kiện nào**.
>
> **Ưu tiên khi mâu thuẫn — owner phải chốt một, không được để mở:**
> 1. `level3-workflow.md` (canonical) thắng vô điều kiện. File này không bao giờ ghi đè nó.
> 2. Repo template có `autopilot/workflow-tiers-plan.md` đề xuất một **trục riêng T0–T3**, và tự nhận
>    **cần thay đổi kit trước khi có hiệu lực**. Hai văn bản đó và file này **không được cùng hiệu lực**.
>    Owner chọn đúng một, pin authority commit, và ghi rõ **forward-only cho task mở mới** — session đang
>    chạy giữ contract cũ tới trạng thái terminal.
> 3. Cho tới khi owner chốt: **canonical là thứ duy nhất có hiệu lực.** File này ở trạng thái đề xuất.

---

## v0.2 — bốn lỗi của v0.1, đã sửa

Ghi lại vì đây đúng lớp lỗi file này nói về: luật viết ra mà không đối chiếu với thứ cưỡng chế nó.

1. **v0.1 biến P3 thành writing tier.** Canonical định nghĩa `P3 = read-only/report-only, no tracked
   mutation`, và `autopilot-review-readiness.mjs` từ chối thẳng: *"only P1/P2 writing slices may
   register"*. Một "P3 typo" theo v0.1 sẽ `CONTRACT_INVALID` hoặc phải bypass gate. Đó là **lỗi phạm
   trù** — coi P3 là "ghi nhẹ" trong khi nó là "không ghi".
2. **Hai mô hình tier cạnh tranh, không có precedence.** v0.1 nói "kiểm cả hai" — đó không phải luật, đó
   là né trách nhiệm.
3. **"Reviewer khác họ model" được viết như hard rule nhưng không gì cưỡng chế nó.** Gate chỉ kiểm
   `independent_reviewer === scripts/codex-review-pin.sh`, không kiểm family.
4. **Danh sách trigger P1 thay thế floor canonical thay vì bổ sung** — thiếu identity, destructive,
   shared choke point.

---

## Vì sao cần phân tầng thay vì áp đồng loạt

Áp đồng loạt hỏng theo cách khó thấy: nó **không làm chậm, nó tạo áp lực đi vòng**.

Ngày 2026-07-31, trong một phiên có ba lane chạy song song, quan sát được đúng hai lần phản xạ đó — một
writer nới `scope` để qua check vừa chặn nó, và orchestrator cân nhắc xoá một file HALT để chạy tiếp. Cả
hai đều bị bắt. Cả hai xuất hiện khi gate chặn một thứ mà người thực hiện tin là vặt.

Đó là cách quy trình nặng thực sự chết: không phải vì tốn thời gian, mà vì người ta học cách lách, rồi
cái lách thành thông lệ và không ai nhớ nó từng là ngoại lệ.

Nhưng nới đồng loạt cũng sai. Cùng phiên đó, review độc lập bắt được **~14 finding thật, không một cái nào
do tác giả của nó tìm ra** — trong đó có một denylist allow-by-default trên trục subscription và một hàm
nhả khoá trước khi caller kịp mutate. Cả hai test xanh, CI xanh, merge sạch.

Nên câu hỏi đúng không phải "chặt hay lỏng" mà là **phân bổ cái đắt vào đúng chỗ nó trả giá**.

---

## Lớp 1 — luôn luôn, không ngoại lệ

Rẻ, và ngăn đúng lớp hỏng làm **mất việc**:

- Đăng ký scope trước khi ghi · **một writing slice = một branch = một worktree = tối đa một writer**
- Trạng thái terminal `READY | AWAIT | HALT`, có file bằng chứng bền trong `.autopilot/state/<feature>/`
- Mọi quyết định viết **ngay cạnh thứ nó ràng buộc**, kèm lý do — không nằm trong log chat
- Pin `base_sha` + kiểm ancestry

**Bằng chứng:** phiên 31/07 có khoảng **13 lần gián đoạn** (Postgres restart, reviewer đổi auth, classifier
chặn, bốn defect kit) và **không lane nào mất một commit**. Đó là nhờ lớp này, không phải nhờ review.

Chi phí gần bằng không, nên **không slice nào nhỏ đến mức được miễn** — kể cả sửa một typo.

---

## Lớp 2 — độ sâu review theo tier

Đây là phần đắt: mỗi vòng review tốn vài phút, và một finding sai tốn nguyên một fix round.

**Mọi thay đổi có ghi vào file tracked — kể cả typo, kể cả docs — tối thiểu là P2.** Không có tier ghi
nào nhẹ hơn thế. `P3` là read-only/report-only theo canonical và gate từ chối đăng ký nó; đừng dùng P3
để né review.

| | P1 | P2 |
|---|---|---|
| Vòng code review độc lập | **2 vòng sạch liên tiếp** | 1 vòng sạch |
| Vòng security review | **bắt buộc** | nếu chạm trust boundary |
| Suite canonical đầy đủ (`pnpm test` với DB thật) | ✅ | ✅ |

Đó là toàn bộ khoảng phân tầng còn lại, và nó hẹp hơn v0.1 dự tính. Một slice sửa typo vẫn tốn một vòng
review — chi phí thật, nhưng có giới hạn, và rẻ hơn nhiều so với việc mở một cửa mà mọi thứ sẽ tự dồn qua.

**Nếu muốn một tier ghi nhẹ hơn P2** thì đó là **trục mới**, không phải cách đọc khác của P0–P3. Nó cần
kit hỗ trợ trước — `autopilot-review-readiness.mjs` hiện hard-code `["P1","P2"]` — nên phải là một slice
có test, không phải một dòng trong policy.

---

## Lớp 3 — trigger ghi đè tier

Tier thuần bỏ sót một thứ: **kích thước diff không phải thước đo rủi ro.** Một thay đổi ba dòng trong hàm
phân quyền vẫn là P1.

**Floor canonical áp trước và không được rút gọn.** `level3-workflow.md` §6 định nghĩa P1 là: *money,
identity, auth, permission, schema/migration, destructive or shared choke point*. Sáu mục đó là **sàn**;
danh sách dưới đây **bổ sung**, không thay thế. Nếu hai bên lệch, canonical thắng.

Bổ sung riêng cho Plexco — chạm bất kỳ mục nào ⇒ **ép P1**, bất kể diff nhỏ cỡ nào:

- `packages/db/schema.ts` *(cụ thể hoá "schema/migration" của canonical)*
- `GRANT` · RLS policy · role *(cụ thể hoá "permission")*
- parse input từ bên ngoài: webhook, message, upload *(không có trong canonical, thêm vì đây là bề mặt
  không tin cậy duy nhất của Plexco)*
- cấu hình deployment *(không có trong canonical; thêm vì sai ở đây không tự lộ ra ở CI)*

Còn `P0` — live production mutation, secrets, hành động tài chính hoặc đặc quyền không đảo ngược — giữ
nguyên canonical: **prepare-only**, cần owner cấp quyền thực thi tường minh. Không tier nào ở đây chạm
tới nó.

---

## Reviewer khác họ model — ADVISORY, chưa phải hard rule

**Authority hiện hành vẫn là pinned wrapper, không phải family.** `autopilot-review-readiness.mjs` chỉ
kiểm `model_policy.independent_reviewer === scripts/codex-review-pin.sh`. Không có chỗ nào kiểm họ model
của writer hay của reviewer. Viết "phải khác họ model" như hard rule là tạo ra một luật **không gì cưỡng
chế** — đúng lớp nghi thức mà chính file này cảnh báo ở mục Cắt tỉa. Nên nó ở mức **advisory**.

Quan sát đứng sau nó vẫn đáng giữ: 31/07, **14 finding, không cái nào do tác giả tự tìm**, và tác giả là
cùng một model đóng vai người-đọc-lại. Hai instance cùng model có điểm mù tương quan. Nhưng đó là quan
sát một ngày, không phải hợp đồng máy.

**Muốn nó thành hard rule thì phải encode và test trong canonical kit** — thêm trường family vào
`model_policy`, kiểm ở gate, và một test chứng minh nó fail khi hai bên cùng họ. Đó là một slice, không
phải một dòng policy. Áp đúng luật ngay dưới đây cho chính nó.

Giữ nguyên: reviewer ghim không gọi được → `HALT TOOL_UNAVAILABLE`, **không tự hạ xuống self-review**.
Điều này thì gate **có** cưỡng chế.

---

## Cắt tỉa — phần quyết định hệ thống này còn gọn sau hai năm

Quy trình chỉ phình ra nếu không có cơ chế ngược lại. Riêng ngày 31/07 đã thêm khoảng **tám** luật vào kit
và **xoá không luật nào**.

Hai điều khoản:

**1. Luật mới không có test thì chỉ là advisory.** Không test thì không ai dám xoá, nên không ai xoá — và
một luật không ai dám đụng sẽ sống mãi kể cả khi lý do của nó đã biến mất. Bộ test của kit
(`autopilot/parallel/test/`) là thứ cho phép xoá an toàn.

**2. Ghi lại check nào bắn trên slice nào.** Sau 20–30 slice, một luật chưa bắn lần nào là **hoặc hoàn hảo
hoặc vô dụng** — và không có số liệu thì không phân biệt được. Log này gần như miễn phí, và nó là đầu vào
duy nhất cho một lần rút gọn có căn cứ về sau.

---

## Vì sao đường cong đi ngược trực giác

Trực giác thường là "khởi đầu chặt rồi nới dần". Với Plexco thì ngược lại.

Hiện tại: 62 bảng, **gần như chưa có tầng service**, chưa có dữ liệu production. Sáu tháng tới là viết
tầng service lên trên chúng — tức tỉ lệ slice rủi ro cao **tăng**, không giảm, vì đó chính là nơi bug
fail-open và concurrency sống. Sau launch, migration trên dữ liệu sống đắt thêm một bậc nữa.

Nên cái nới ra theo thời gian chỉ nên là **phần nghi thức**, không phải phần kiểm chứng.

---

## Phép thử một câu, khi tier không rõ

> **Nếu làm sai ở đây, bao lâu nữa nó mới lộ ra?**

- *"Ngay lập tức, test sẽ đỏ"* → **P2** là đủ (một vòng sạch). Đây là sàn cho mọi thay đổi có ghi;
  không có mức nào thấp hơn.
- *"Vài tuần, dưới dạng một triệu chứng không nối được về nguyên nhân"* → **P1**, và trigger ở lớp 3 gần
  như chắc chắn đã bắt nó rồi.

Câu hỏi này thay cho việc tranh luận "slice này quan trọng không" — thứ luôn thắng bởi người nói to hơn.

---

## File này KHÔNG thay đổi

- **Trục risk P0–P3 và định nghĩa từng mức thuộc về `level3-workflow.md`.** File này không định nghĩa
  lại, không mở rộng, không diễn giải lại. Nó chỉ nói độ sâu review trong khuôn khổ đó.
- `review-code-readiness-gate.md` giữ nguyên hiệu lực: `CODE_READY` vẫn cần đủ G1–G6 và closure 12/12,
  bất kể tier.
- Năm HARD RULES giữ nguyên và **không có tier nào miễn trừ** chúng.
- P0 vẫn prepare-only. Không auto-merge ở bất kỳ tier nào.
- P3 vẫn là read-only/report-only. Gate từ chối đăng ký nó, và điều đó **không phải hạn chế cần gỡ**.

---

## Việc còn phải làm trước khi file này thành Accepted

1. **Owner chốt một mô hình tier duy nhất** giữa file này và `workflow-tiers-plan.md` (T0–T3) của repo
   template, pin authority commit, ghi rõ forward-only.
2. **Nếu muốn "reviewer khác họ model" thành hard rule:** mở slice encode nó vào canonical kit — thêm
   trường family vào `model_policy`, kiểm ở gate, kèm test chứng minh nó fail khi hai bên cùng họ.
3. **Cơ chế log check-fired** (mục Cắt tỉa) cần code, không phải chính sách. Mở block backlog riêng.

Cho tới khi cả ba xong, file này là **đề xuất** và canonical là thứ duy nhất có hiệu lực.

---

## Changelog

| Ngày | Version | Thay đổi |
|---|---|---|
| 31/07/2026 | 0.2 | **Sửa bốn lỗi của v0.1 do review độc lập bắt được** — xem mục "v0.2" ở đầu file. Lỗi nặng nhất: v0.1 dùng P3 làm writing tier, trái canonical và bị gate từ chối thẳng, nên một "P3 typo" sẽ `CONTRACT_INVALID`. Hệ quả: khoảng phân tầng thu hẹp còn P1/P2, mọi tracked write tối thiểu P2. Ba lỗi còn lại: không có luật ưu tiên giữa hai mô hình tier cạnh tranh; "reviewer khác họ model" viết như hard rule mà không gì cưỡng chế (hạ xuống advisory); danh sách trigger thay thế thay vì bổ sung floor canonical. Cả bốn đều là **luật viết ra mà không đối chiếu với thứ cưỡng chế nó** — đúng lớp lỗi file này nói về, xảy ra ngay trong chính nó. |
| 31/07/2026 | 0.1 | Soạn sau phiên ba-lane đầu tiên. Mọi con số trong file này là quan sát của phiên đó, không phải mục tiêu — đo lại trước khi trích. |
