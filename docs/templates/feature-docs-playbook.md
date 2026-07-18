# Feature Docs Playbook — cách tổ chức, viết, trình bày feature specs

> **Version:** 1.1 · 2026-07-19 · **Status:** Reviewed — thành Active khi Adoption B0+B1 (§8) hoàn tất
> **Canonical:** repo Sporta (`docs/workflow/feature-docs-playbook.md`). Project khác copy và ghi nguồn; sửa lớn sync ngược.
> **Nguồn chưng cất:** cấu trúc thực tế của 24 feature docs Sporta (Phase 1–2, FE + BE) — điểm mạnh giữ nguyên, điểm yếu đã biết (template chết, thiếu metadata, thiếu traceability, phase sau mỏng dần) được sửa thành rule trong playbook này.
> **Ngôn ngữ:** prose tiếng Việt; identifier/code/enum/error-code tiếng Anh; chuỗi user-facing tiếng Việt (hoặc `t(vi, en)` nếu project đa ngôn ngữ).

---

## 1. Tổ chức thư mục & đặt tên

```
docs/
  Phase {N}/
    FE/feature_{name}.md          # Product/FE spec — hành vi user-facing
    BE/feature_{name}_tech.md     # BE tech spec — contract server
```

- **1 feature = 1 cặp FE/BE cùng tên** — không mồ côi. Feature chưa cần BE → ghi rõ "BE: N/A vì …" trong FE doc.
- Feature nhỏ gộp cụm được (1 cặp cho nhiều DD/phase) nhưng không tách 1 feature thành nhiều cặp.
- README/index cấp `docs/features` giữ bảng: feature → file → version → doc status → implementation status (chống drift index vs disk).

## 2. Metadata bắt buộc (đầu mỗi doc)

```markdown
# Feature: {Tên} — {FE Spec | Technical Spec (Backend)}

> **Version:** x.y · YYYY-MM-DD
> **Doc status:** Draft | In Review | Approved | Superseded
> **Implementation status:** Not started | In progress | Implemented | Verified
> **Owner:** {người viết} · **Approver:** {người duyệt, khi Approved}
> **Code ref:** {commit/tag/branch của runtime tương ứng, khi Implemented+}
> **Test evidence:** {link/summary test run, khi Verified}
> **Tham chiếu:** BRD §x · PRD §y · {file FE/BE đối ứng} · {decision log DD-xx nếu có}
```

- **Chỉ `Approved` là contract.** `In Review`/`Reviewed` nghĩa là đã qua review nội dung — chưa phải contract.
- **Doc status ≠ Implementation status** — doc được duyệt không có nghĩa runtime tồn tại. Hai trường tách bạch, không suy diễn từ nhau.
- **Changelog table ngay sau metadata** (đầu file, không phải cuối): mỗi lần sửa = 1 dòng version/ngày/thay đổi.

## 3. Cấu trúc FE spec (10 sections — theo de-facto standard tốt nhất của Sporta)

| § | Section | Viết gì | Kỹ thuật trình bày |
|---|---------|---------|---------------------|
| 1 | Mô tả | 2–4 câu: feature là gì, cho ai, nguyên tắc thiết kế (vd "personal dashboard, no-scroll, glanceable") | Prose ngắn; in đậm nguyên tắc |
| 2 | Use Cases + Edge Cases | UC bảng Actor/Hành động/Kết quả; edge bảng #/Category/Case/Xử lý (gate: §6.6) | Edge phân loại: Data · Network · Security · Concurrency · Cross-Feature |
| 3 | Screens & States | Từng screen: purpose, **ASCII wireframe kèm số đo px**, coverage states theo matrix (§6.7), từng component con dạng bảng | **ASCII wireframe là vũ khí trình bày mạnh nhất** — layout, kích thước vùng, nội dung mẫu trong 1 khối text |
| 4 | Domain Model | Cấu trúc data FE nhìn thấy + logic chọn/hiển thị (pseudo-code ngắn) | Code block kiểu định nghĩa type + thuật toán vài dòng |
| 5 | API Endpoints | Danh sách endpoint + **JSON response example đầy đủ với sample data production-shaped** | Endpoint bỏ đi cũng ghi lại kèm lý do ("`/home/hero` bỏ — hero = item đầu") |
| 6 | Error Codes | Bảng Code / HTTP / Message (tiếng Việt) / Xử lý UI | **Một catalog duy nhất — BE dùng chung bảng này, không tự chế** (fix lỗi FE/BE lệch error codes) |
| 7 | Analytics Events | Danh sách event + params, naming `{feature}_{action}_{result}` | Ghi chú no-PII nếu applicable |
| 8 | State Machine | Vòng đời màn hình + logic chuyển state | Text diagram hoặc mermaid; kèm bảng selection logic (vd Smart Chips pick-top-2) |
| 9 | Caching Strategy | Bảng Data / Storage / TTL / Invalidation | Ghi cả trigger refresh (pull-to-refresh, app foreground) |
| 10 | Acceptance Criteria | Checkbox, chia 4 nhóm: **Functional / States / UI-UX / Testing** | Mỗi ý testable + đo được ("touch target ≥ 48dp", "fit 1 screen no-scroll") |

## 4. Cấu trúc BE tech spec

| § | Section | Viết gì |
|---|---------|---------|
| 1 | Tổng quan | Pipeline/flow text-diagram; design decisions chính |
| 2 | Database Schema | **DDL thật** (ENUM, index, FK cascade, partial index) + **Migration & Rollback** (lệnh forward + chiến lược revert + mất gì). **Đối chiếu live schema trước khi viết** — bảng có thể đã tồn tại từ migration cũ |
| 3 | API Contract | Từng endpoint: **JSON request/response đầy đủ theo từng status code** (200/4xx/5xx), error envelope thống nhất |
| 4 | Backend Implementation | Chi tiết transaction/locking/idempotency — pseudo-code có đánh số bước |
| 5 | Event Definitions | Domain events + payload |
| 6 | Security Considerations | Section riêng, **không được bỏ ở phase sau**. Checklist tối thiểu: authorization/ownership per-resource · injection · rate limit/brute-force · secret & log redaction · webhook signature + replay window · idempotency key · data retention/xoá |
| 7 | Edge Cases (Backend) | Bảng phân loại: **Concurrency / Security / Data Integrity / Cross-Feature / Infra** |
| 8 | Caching | Bảng như FE §9, thêm invalidation server-side |
| 9 | (Feature-specific) | Slot tự do: SMS provider, geo search, scoring rules… |
| 10 | Testing Plan | Unit (bảng Test/Input/Expected) + Integration (multi-step); coverage theo risk class (§6.6) |

**Số trong spec phải khớp cả spec lẫn code thật — gate 3 chiều.** Bài học Sporta (dynamic VietQR): bảng edge-case claim `crypto.randomBytes(10)` → 20 hex; snippet trong *cùng spec* lại dùng `crypto.randomInt(10, 99)` → 2 chữ số; còn runtime hiện tại (`dynamic-vietqr.service.ts`) dùng `crypto.randomBytes(2).toString('hex')` → 4 hex — **ba nguồn ba kiểu**, claim collision-probability theo đó cũng sai. Gate: trước khi Approved, đối chiếu **spec claim ↔ snippet trong spec ↔ live code/schema**; sửa 1 trong 3 → re-check 2 cái còn lại.

## 5. Kỹ thuật trình bày đáng học (điều làm docs Sporta dễ đọc)

1. **ASCII wireframe với số đo** — truyền tải layout + hierarchy + content mẫu nhanh hơn mọi đoạn văn; ai cũng diff được trong git.
2. **Bảng thay prose** cho mọi thứ liệt kê được: component breakdown, selection logic theo scenario, priority rules, payment dots, role badges. Prose chỉ dùng cho nguyên tắc và lý do.
3. **Pseudo-code ngắn cho logic quyết định** (streak, pick-top-2, auto-dismiss) — vài dòng, không lẫn code thật.
4. **Sample data synthetic nhưng production-shaped** — đúng cấu trúc/độ dài/locale production ("Cầu lông T3 & T5", "85,000đ") để reviewer bắt lỗi nghiệp vụ ngay trong spec; **tuyệt đối không dùng PII/số tài khoản/bank data thật**.
5. **Ghi lại cả quyết định phủ định** — "đã bỏ X vì Y" (bỏ Quick Actions, bỏ endpoint hero) ngay tại chỗ liên quan + changelog, để người sau không đề xuất lại.
6. **Mỗi số có đơn vị và nguồn** — "~556px content", "TTL 1 phút", "max 4 items".

## 6. Governance rules (fix các lỗi đã trả giá)

1. **Một template canonical duy nhất** — template không dùng nữa thì xoá hoặc đánh dấu DEPRECATED trỏ về bản mới. (Sporta từng có 2 template sống song song, cái "chính thức" không doc nào theo.)
2. **Doc lifecycle:** Draft → In Review → Approved → Superseded. **Chỉ Approved = contract.** Sửa doc Approved = bump version + changelog + re-approve phần đổi; đề xuất chưa chốt không viết thẳng vào doc Approved.
3. **Traceability:** metadata phải ref BRD/PRD/decision; index README cập nhật version cùng commit với doc (drift index = mất niềm tin vào cả bộ).
4. **FE/BE của cùng feature review cùng nhau** — đối chiếu: endpoint khớp, error catalog 1 nguồn, field name khớp, spec claim khớp snippet khớp live code (§4).
5. **Phase sau không được mỏng hơn phase trước** — đặc biệt Security và Caching. (Sporta Phase 2 bỏ 2 section này đúng ở các feature thanh toán.) Feature nhỏ thì section ngắn, không phải section biến mất.
6. **Review gate theo rủi ro, không theo số lượng.** Minimum số lượng (FE ≥8 UC + ≥10 edge ≥4 category; BE ≥12 edge + ≥20 unit test) chỉ là **floor chống lười — đạt floor không có nghĩa đủ**. Gate thật: (a) **decision table** cho mọi nhánh logic tiền/quyền; (b) **risk class** — feature money/auth/PII = high risk → bắt buộc decision table + abuse cases (theo checklist Security §4.6) + concurrency cases; feature hiển thị thuần = low risk → floor là đủ. Reviewer hỏi "đường nguy hiểm nào chưa có dòng nào?" thay vì đếm dòng.
7. **Coverage states theo matrix, không blanket.** Lập matrix `state × role × device × theme` cho các tổ hợp **hợp lệ**; ô không áp dụng ghi `N/A + lý do` (vd confirmation sheet không có Empty; permission gate không có Loading). Screen dữ liệu động mặc định vẫn đủ Loading/Ready/Error/Empty.

## 7. Definition of Done (per cặp doc)

- [ ] Metadata đủ trường §2 (doc status ≠ implementation status) + changelog đầu file, version khớp index README
- [ ] FE đủ 10 sections; mỗi screen có ASCII wireframe + coverage matrix điền đủ (build hoặc N/A+lý do)
- [ ] BE đủ DDL + Migration/Rollback (đã đối chiếu live schema) + JSON contract theo status code + Security checklist + Testing
- [ ] Error catalog 1 nguồn, FE/BE khớp
- [ ] AC checkbox 4 nhóm, tất cả đo được
- [ ] Đạt gate rủi ro §6.6 (decision table cho high-risk) — floor số lượng chỉ là điều kiện cần
- [ ] Gate 3 chiều: spec claim ↔ snippet ↔ live code/schema khớp

## 8. Adoption & Migration

**Nguyên tắc chung (mọi project):** playbook áp dụng cho (a) doc mới kể từ ngày adopt, (b) doc cũ khi được sửa lần kế. Docs cũ chưa sửa = **Legacy** — không retrofit hàng loạt, không coi là vi phạm.

**Hiện trạng Sporta (kiểm đếm 2026-07-19):** 24 docs / 12 cặp FE-BE đủ; **0/24** có Doc status; **5/24** có version đầu file; **2/24** có changelog đầu file; chưa có index `docs/features/README.md`; `docs/feature_booking-template.md` là template cũ chưa DEPRECATED.

| Batch | Việc | Điều kiện xong |
|-------|------|----------------|
| **B0 — hạ tầng** | Tạo index README (bảng feature/version/2 status) · đánh dấu DEPRECATED template cũ trỏ về playbook này | Index khớp 100% disk |
| **B1 — docs đang active** | Thêm metadata block §2 cho các cặp thuộc phase đang build (Phase 2 payment trước — high risk) + fix mâu thuẫn §4 đã biết (dynamic_vietqr transfer code) | Mỗi doc active có 2 status + owner |
| **B2 — phần còn lại** | Bổ sung khi doc được sửa lần kế (không sweep) | Theo dòng đời tự nhiên |

Playbook chuyển **Reviewed → Active** khi B0 + B1 xong. Ngày adopt của project khác: ghi tại header bản copy của project đó.

---

## Changelog

| Ngày | Version | Thay đổi |
|------|---------|----------|
| 2026-07-19 | 1.1 | **Review fixes (9 findings):** tách Doc status / Implementation status + owner/approver/code-ref/test-evidence, chỉ Approved = contract; sửa ví dụ §4 đúng cả 3 nguồn (spec table 20-hex vs snippet 2-digit vs runtime `randomBytes(2)`→4-hex) + gate 3 chiều; sample data → synthetic production-shaped, cấm PII/bank thật; gate theo risk class + decision table thay vì đếm số lượng; security checklist mở rộng (authz/ownership, injection, redaction, webhook replay, idempotency, retention); coverage states theo matrix với N/A+lý do; thêm §8 Adoption & Migration (Sporta: B0/B1/B2, hiện trạng 0/24 status); status playbook Active → Reviewed chờ B0+B1. |
| 2026-07-19 | 1.0 | Khởi tạo — chưng cất từ 24 feature docs Sporta + khắc phục 6 điểm yếu phát hiện khi so sánh với bộ docs Plexco. |
