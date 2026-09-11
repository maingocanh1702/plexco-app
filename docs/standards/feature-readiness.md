# Feature readiness — rubric cho cổng intake của ap3

<!-- review-readiness: criteria -->

> **Version:** 0.1 · 2026-09-10 · 🟡 Draft (owner duyệt trước khi `ap3-intake` dùng làm cổng)
> **Mục đích:** một feature/task chỉ được đưa vào workflow tự trị (ap3, DESIGN v2 tầng 1) khi
> docs đủ để writer headless không phải *đoán*. Rubric này là danh sách kiểm tra máy đọc được;
> mỗi mục PASS/GAP kèm file:section quyết định. GAP → câu hỏi đánh số cho owner, trả lời được ghi
> ngược vào docs (không ở chat). Nguồn thẩm quyền: `docs/features/README.md` § Document Convention,
> `product/PRD.md`, `product/TDD.md`, `standards/decisions.md`.

## Cách chấm

- Đơn vị chấm là **một feature** (cặp `FE/feature_<x>.md` + `BE/feature_<x>_tech.md`) hoặc **một
  task** thuộc feature đó. Task kế thừa kết quả của feature; chỉ chấm thêm R6–R8 cho phần task chạm.
- Mỗi mục ghi `PASS` / `GAP` / `N/A` (N/A phải có lý do một dòng). Bất kỳ `GAP` nào ở R1–R5 ⇒
  `NOT_READY`. R6–R8 GAP ⇒ `READY_WITH_SUPERVISED_SLICES` (phần đó vẫn vào plan nhưng đánh dấu
  `supervised: true`).
- Không suy diễn: mục nào docs không nói thì là GAP, kể cả khi code "rõ ràng" ngụ ý câu trả lời.

## R1 — Phạm vi & ý định

- R1.1 Feature có mặt trong `product/ROADMAP.md` với phase, hoặc owner ghi rõ "ngoài roadmap, làm
  theo ý định X" trong INTAKE.
- R1.2 PRD có FLOW tương ứng (`product/PRD.md` § FLOW n) và FLOW đó không đánh dấu ngoài phạm vi.
- R1.3 `FE/feature_<x>.md` tồn tại, trạng thái **Reviewed** (không phải 🟡 Draft) — hoặc owner chấp
  nhận Draft bằng một dòng trong INTAKE.

## R2 — Acceptance đo được

- R2.1 `FE/feature_<x>.md` § Acceptance Criteria: mỗi tiêu chí là một câu có thể viết thành test
  (điều kiện → hành vi quan sát được), không có từ "hợp lý", "phù hợp", "tốt".
- R2.2 Với task: có ít nhất một tiêu chí mà **fail ở base hiện tại** (RED thật) — nêu tên tiêu chí.
- R2.3 § Use Cases + Edge Cases liệt kê edge case cho mọi transition mà task chạm.

## R3 — Thiết kế kỹ thuật

- R3.1 `BE/feature_<x>_tech.md` có đủ 6 section theo Document Convention và `### Entry points`.
- R3.2 § 2 Database Schema: mọi bảng/cột task chạm có trong schema hoặc có migration đã merge;
  task cần migration mới ⇒ GAP R6 (supervised).
- R3.3 § 3 API Contract: endpoint/command task chạm có request/response + error codes.
- R3.4 § 4 Chi tiết triển khai: transition/invariant liên quan được mô tả; tên invariant khớp
  `docs/autopilot-invariant-catalog.md` nếu có.

## R4 — Quyết định

- R4.1 Mọi `DD-xxx` mà FE/BE spec trích dẫn cho phần task chạm ở trạng thái `DECISION_FINAL`
  hoặc owner-final trong `standards/decisions.md`; `proposal`/`direction-only` ⇒ GAP.
- R4.2 § Open Questions của FE spec và § "Unresolved" của checklist liên quan (nếu có, ví dụ
  `docs/issues/session-management-acceptance-checklist.md` §9A) **không** chứa mục nào giao với
  scope của task.

## R5 — Kế hoạch test

- R5.1 `BE/feature_<x>_tech.md` § 5 Testing Plan có hàng cho hành vi task chạm (unit/integration),
  hoặc checklist acceptance có hàng tương ứng với nguồn truy vết.
- R5.2 Lệnh verify chạy được trong sandbox writer (typecheck + vitest của package) được nêu; phần
  cần DB/`next build` tách thành `verify_host` (dispatcher chạy sau Codex CLEAN) hoặc để CI.

## R6 — Migration (supervised nếu GAP)

- R6.1 Task không cần thay schema; nếu cần: migration là slice riêng `supervised: true`, merge
  trước các slice code.

## R7 — i18n & chuỗi người dùng (supervised nếu GAP)

- R7.1 Task không thêm/sửa chuỗi user-visible (HARD RULE 5); nếu có: slice riêng supervised.

## R8 — UI/UX (supervised nếu GAP)

- R8.1 Task không chạm `apps/web/app/**/page.tsx`, component hiển thị, hay design tokens; nếu có:
  FE spec § Screens & States phải có state tương ứng và slice là supervised.

## Đầu ra của intake

`ap3/features/<slug>/INTAKE.md` gồm: bảng R1–R8 (PASS/GAP/N/A + file:section), câu hỏi đánh số
kèm đề xuất trả lời, danh sách DD cần chốt, và `status: NOT_READY | READY_FOR_PLAN |
READY_WITH_SUPERVISED_SLICES`. Owner trả lời → skill ghi vào docs → chấm lại.

## Pilot dự kiến

Session management (`FE/feature_session_management.md` + `BE/feature_session_management_tech.md`
+ `docs/issues/session-management-acceptance-checklist.md`): lát đầu là **test-only** từ
checklist §7 (hàng chưa có test) — R2.2 RED rõ, không đổi hành vi, security round có ý nghĩa.

## Changelog

- 0.1 · 2026-09-10 — bản nháp đầu, viết sau khi lane `code-quality-p2` đạt 3 clean runs.
