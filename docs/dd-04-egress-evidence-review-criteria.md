<!-- review-readiness: criteria -->
# ✅ Review criteria — DD-04 §7.1 fixed outbound-IP gate

> **Mục đích:** tiêu chí để **chấp nhận hay bác** kết quả của slice `infra-egress-compatibility-evidence` khi nó dừng ở `STOP_AT_READY`.
> **Ngày:** 2026-07-18 · **Authority:** `dd-04-hosting-final-decision.md` §7.1 · `standards/environments-setup.md` §1.1 · manifest `autopilot-manifests/infra-egress-compatibility-evidence.json`
> **Vì sao file riêng:** slice đang giữ scope `docs/standards/environments-setup.md`; doc này cố ý nằm **ngoài** scope đó để không đụng scope-gate.

---

## 0. Vì sao gate này đắt nếu sai

DO App Platform **không** dùng đồng thời VPC networking và dedicated public egress IP. Kết luận sai `NO` ⇒ dựng App Spec + VPC ⇒ tới lúc tích hợp thật provider chặn vì IP không allowlist ⇒ phải đổi substrate (Droplet/DOKS) hoặc **âm thầm bỏ private DB path** — đúng thứ DD-04 cấm. Chi phí sửa ở giai đoạn đó lớn hơn nhiều so với việc để `UNRESOLVED` và đi hỏi provider.

---

## 1. Phân hạng nguồn bằng chứng

| Hạng | Nguồn | Dùng được để kết luận? |
|---|---|---|
| **A — chấp nhận** | Trang tài liệu chính thức của provider mô tả **đúng** chính sách IP cho API caller · API reference của **đúng endpoint** Plexco gọi · **trả lời bằng văn bản** từ support/AM (có ticket id + ngày + trích nguyên văn) · điều khoản hợp đồng/enterprise | ✅ Có |
| **B — hỗ trợ** | Changelog/blog chính thức của provider · ảnh chụp dashboard cho thấy **có/không có** mục "IP allowlist" | ⚠️ Chỉ bổ trợ, **không** tự kết luận |
| **C — bác** | **Bundle frontend đã minify** · blog bên thứ ba · StackOverflow · trí nhớ LLM · suy ra từ yêu cầu **webhook inbound** | ❌ Không |

> ⚠️ Việc grep `apipay-bundle.js` tìm `accessKey` / `Authorization` / `SERVER_IP` là **hạng C**. Bundle SPA chỉ nói về cách *dashboard* xác thực, **không** chứng minh chính sách IP của API **server-to-server**. Riêng chuỗi `SERVER_IP` xuất hiện trong JSX còn **gợi ý ngược** — có thể tồn tại ô đăng ký IP. Không được kết `NO` từ nguồn này.

---

## 2. Đúng bề mặt gọi (call surface)

Câu hỏi là **outbound Plexco → provider**, không phải inbound. Mỗi hàng phải ghi rõ endpoint thật Plexco gọi:

| Dependency | Bề mặt outbound phải nêu tên |
|---|---|
| **SePay** | Nếu Plexco **không** gọi outbound (tích hợp chỉ là webhook inbound) → phải **nói rõ điều đó** kèm inventory, rồi mới kết `NO`. Không được lấy "webhook inbound cần verify" làm bằng chứng cho outbound. |
| **ApiPay** | Enterprise provisioning + mọi API call server-side |
| **Zalo Bot** | Send message API |
| **Meta Messenger** | Graph API send |

---

## 3. Luật bằng chứng phủ định

**"Tài liệu không nhắc tới IP allowlist" ≠ "không yêu cầu IP cố định".**

Muốn kết **`NO`** phải có **một** trong hai:
1. Câu **nguyên văn** trong doc hạng A nói auth dựa trên key/token và **không** giới hạn source IP; hoặc
2. Xác nhận **bằng văn bản** từ provider.

Không có ⇒ bắt buộc **`UNRESOLVED`**.

---

## 4. Mỗi hàng phải attributable

Thiếu bất kỳ mục nào ⇒ hàng đó **không** được tính là hạng A:

- URL + anchor/section cụ thể (không phải trang chủ docs)
- **Ngày truy xuất**
- **Trích nguyên văn** câu quyết định (không diễn giải)
- Version/last-updated của doc nếu có
- Với trả lời support: ticket id + ngày + trích nguyên văn

---

## 5. ⛔ Gap cần đóng: `UNRESOLVED` phải fail-closed

`environments-setup.md` §1.1 hiện chỉ định nghĩa hai nhánh — *all `no` → tiếp tục*, *any `yes` → dừng* — nhưng manifest lại cho phép giá trị **`UNRESOLVED`**. **Chưa có luật cho `UNRESOLVED`.**

**Luật phải áp dụng khi review:**

> **Bất kỳ `YES` *hoặc* `UNRESOLVED` nào trên một production dependency ⇒ gate KHÔNG pass.**
> Xử lý y hệt `YES`: không tạo App Spec VPC-only, không âm thầm tắt private DB path; hoặc giải quyết (hỏi provider) hoặc kích hoạt fallback Fly+DO có giới hạn.

Đây là mặc định fail-closed đúng tinh thần HARD RULES — `UNRESOLVED` là *chưa biết*, không phải *an toàn*.

---

## 6. Checklist chấp nhận (tick từng ô trước khi merge)

- [ ] Đủ 4 dependency, mỗi hàng có kết quả `NO` / `YES` / `UNRESOLVED`
- [ ] Mỗi kết quả `NO` có nguồn **hạng A** + trích nguyên văn + ngày
- [ ] Không có hàng nào kết luận dựa trên bundle/blog/suy luận từ inbound webhook
- [ ] Bề mặt outbound được nêu **đích danh** cho từng provider (SePay có inventory nếu là `N/A`)
- [ ] Có **một kết quả tổng** (overall result) chứ không chỉ bảng
- [ ] `UNRESOLVED` được xử lý fail-closed như §5 (nếu slice không làm → yêu cầu sửa)
- [ ] Slice chỉ đụng `docs/standards/environments-setup.md`, không đụng code/schema/secret/deploy config
- [ ] Không có giá trị secret nào bị paste vào doc

---

## 7. Nếu ApiPay vẫn `UNRESOLVED` (khả năng cao)

Đường nhanh nhất là hỏi thẳng, không cố suy từ docs:

> "Khi server chúng tôi gọi API ApiPay (enterprise provisioning + [endpoint cụ thể]), ApiPay có yêu cầu đăng ký/allowlist địa chỉ IP nguồn cố định không? Nếu có, đăng ký ở đâu và giới hạn bao nhiêu IP?"

Trả lời bằng văn bản = hạng A, đóng được gate. Rẻ hơn nhiều so với đoán sai rồi phải đổi substrate.
