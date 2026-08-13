# DD-104 `DeleteSession` — decision table trước khi viết algorithm

> **Soạn 2026-08-13, base `main@1303c31`.** Đây là bảng câu hỏi để owner quyết, **không phải quyết định**.
> Mỗi mục kèm phép đo; chỗ nào là phán đoán thì ghi rõ.
>
> ✅ **ĐÃ CHỐT 2026-08-13 (cùng ngày):** owner quyết D0 = không ưu tiên (bảng để dành), D1 = (a),
> D2 = (a), D3 = (c), D4 = (a) — đúng các khuyến nghị. Bản ghi quyết định chính thức:
> `../standards/decisions.md` DD-104 Amendment 2026-08-13 (decisions v2.27). File này giữ nguyên làm
> tài liệu đo lường; đừng re-ask các câu đã chốt.
>
> **Vì sao có file này.** DD-104 đã bốn lần vào lane và bốn lần lộ ra cạnh mới *trong lúc* viết algorithm:
> cascade không tồn tại, thiếu suspension gate, `23503` map mù, thứ tự concurrency chưa chốt. Mỗi lần đều
> tốn một registration. Điều kiện để lần thứ năm khác đi là **quyết các cạnh trước**, không phải cẩn thận hơn.

---

## D0 · Sequencing — DD-104 chưa chạy được, và lý do không nằm ở DD-104

| Đo được 2026-08-13 | |
| --- | --- |
| `tenant-capability-authority-core` | `status: idea`, P1 — **chưa scope** |
| DD-104 tự khai | *"hard dependencies trước code: `tenant-capability-authority-core` phải land"* |
| `request_hash` trong `processed_commands` | **không tồn tại** ở bất kỳ migration nào |

Nên dù bảng dưới được chốt hết hôm nay, slice DD-104 vẫn **không mở được** cho tới khi P1 kia có packet.
Câu hỏi thật của D0: **`tenant-capability-authority-core` có được ưu tiên lên trước không?** Nếu không,
DD-104 nằm chờ và bảng này là đầu tư cho sau. Cả hai lựa chọn đều hợp lệ; điều không hợp lệ là mở lane
DD-104 rồi phát hiện dependency ở giữa chừng — lần thứ năm.

---

## D1 · Ranh giới xoá — bảng nào chặn?

Hướng đã chốt: giữ toàn bộ FK `NO ACTION`, câu `DELETE` là *final fence*. Vậy **bất kỳ** row con nào cũng
chặn. Đo được: **5 bảng** giữ FK tới `sessions`, cộng 4 composite tenant-integrity ở `0019`.

| Bảng | Migration | Bản chất |
| --- | --- | --- |
| `session_occurrences` | `0002` | scaffolding do chính session sinh ra |
| `session_surface_refs` | `0002` | scaffolding — tham chiếu bề mặt kênh |
| `players` | `0002` | **dữ liệu của người khác** |
| `charges` | `0003` | **tiền** |
| `join_requests` | `0006` | **dữ liệu của người khác** |

Câu hỏi: hai bảng đầu là *giàn giáo của chính session* hay cũng là dữ liệu đáng chặn?

- **(a) Cả 5 đều chặn — "pristine draft" đúng nghĩa.** DB là hàng rào duy nhất, không có danh sách nào để
  quên cập nhật khi thêm bảng thứ 6. Host tạo nhầm rồi xoá vẫn chạy vì draft mới chưa sinh occurrence.
- **(b) Xoá `session_occurrences` + `session_surface_refs` trước, ba bảng còn lại chặn.** Xoá được nhiều
  trường hợp hơn, nhưng phải duy trì một danh sách "bảng được phép dọn" — và bảng thứ 6 thêm vào tương lai
  sẽ mặc định rơi vào nhóm nào?

**Khuyến nghị: (a).** Không phải vì an toàn hơn, mà vì (b) tạo ra một danh sách phái sinh phải đồng bộ tay
với schema — đúng loại nợ mà `pnpm-workspace.yaml` inert và `DD-79 vs DD-96` đã dạy. Nếu sau này (a) chật
quá, nới ra dễ; thu về khó.

---

## D2 · Authority — action class nào?

Đo được: `feature_billing_lifecycle_tech.md` chỉ định nghĩa **đúng một** action class literal —
`'publish_new_sessions'`. Dòng 329 có nhắc *"admin mutation"* nhưng **chỉ trong prose**, không có giá trị enum.

Nên DD-104 không thể "dùng lại" gì cả; nó buộc phải tạo mới.

- **(a) `delete_draft_session`** — hẹp, đúng một việc. Mỗi admin op sau lại thêm một class.
- **(b) `admin_mutation`** — rộng, phủ luôn các op quản trị sau. Nhưng gộp nhiều op vào một class nghĩa là
  ma trận suspension của chúng buộc phải giống nhau **mãi mãi**; tách ra sau là đổi contract.

**Khuyến nghị: (a).** Ma trận `authorizeTenantAction` là *"adapters không được implement luật suspension
khác nhau"* — giá trị đó đến từ việc mỗi class có một hàng rõ ràng. Một class rộng làm hàng đó thành trung
bình cộng của những op chưa tồn tại.

Dù chọn gì: đây là **sửa contract billing**, không phải sửa spec session. Nó thuộc slice khác.

---

## D3 · `23503` — nhận diện thế nào là "trusted"?

Map mù mọi `foreign_key_violation` thành `DELETE_REQUIRES_EMPTY_DRAFT` sẽ báo một vi phạm FK **không liên
quan** thành "draft chưa rỗng" — lời giải thích sai cho một lỗi thật.

Đo được, và nó loại bớt một phương án: **5 FK đơn là inline, không đặt tên** (`players`, `charges`,
`join_requests`, `session_occurrences`, `session_surface_refs` đều dùng `REFERENCES sessions(id)` trần).
Postgres tự sinh `<table>_<column>_fkey`. Chỉ 4 FK composite ở `0019` có tên tường minh.

- **(a) Allowlist tên constraint.** Phải hardcode 5 tên **tự sinh** — hoạt động hôm nay, nhưng chúng không
  được khai ở đâu, nên một `DROP/ADD CONSTRAINT` tương lai đổi tên là allowlist trượt **im lặng** về
  fail-open.
- **(b) Pre-check bằng `EXISTS` rồi mới `DELETE`.** Có khe TOCTOU: khoá `sessions` row không chặn được một
  `INSERT INTO players` đồng thời.
- **(c) Hỏi catalog.** Bắt `23503`, lấy `constraint_name` từ error, tra `pg_constraint` xem
  `confrelid = 'sessions'::regclass` hay không. Chỉ map khi đúng.

**Khuyến nghị: (c).** Nó không cần danh sách nào, nên không có gì để lệch khi thêm bảng thứ 6 hay khi ai đó
đổi tên constraint. Và nó là *phép đo* thay vì *khai báo* — hỏi catalog thứ đang thật sự đúng, không tra
một danh sách mô tả thứ từng đúng. `(b)` bị loại vì lý do kỹ thuật, không phải sở thích: DB là hàng rào
duy nhất không có TOCTOU.

---

## D4 · Concurrency — check nằm ở đâu trong transaction?

`feature_billing_lifecycle_tech.md:329` đã ra luật cho **mọi** mutating action class: check phải nằm
**trong cùng transaction** với mutation, đủ gần commit để một suspend đồng thời hoặc serialize trước nó
hoặc bị lock chặn. Và nó **tự pin một follow-up chưa giải quyết** — `docs-session-publish-concurrency-recheck`
— về đúng câu hỏi này cho `PublishSession` (check ở step 1, lock ở step 2, mutation ở step 6).

`DeleteSession` mang **y hệt hình dạng đó**.

- **(a) Giải quyết cho cả delete và publish trong một quyết định.** Một lần suy nghĩ, đóng luôn follow-up
  đang treo.
- **(b) Chỉ giải cho delete, để publish treo tiếp.**

**Khuyến nghị: (a).** Hai câu trả lời khác nhau cho cùng một câu hỏi, trên cùng một bảng, là chính xác cách
`DD-79` và `DD-96` mâu thuẫn nhau — và ta vừa tốn một reconcile để gỡ. Đừng tạo cái thứ hai trong lúc còn
nhớ cái thứ nhất đắt thế nào.

---

## Việc anh cần làm với file này

Năm quyết định, mỗi cái một dòng trả lời. **D0 quyết trước** — nó xác định bảng này dùng ngay hay để dành.

Chốt xong, chúng vào `decisions.md` như một DD amendment, **rồi** mới author packet. Packet đó sẽ chỉ còn
việc mô tả *cách làm*, không còn phải khám phá *làm gì* — đó là toàn bộ khác biệt so với bốn lần trước.
