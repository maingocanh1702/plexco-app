# Web MVP Phase 5 (go-live): kế hoạch, chờ owner duyệt

<!-- review-readiness: enforce -->

> Tài liệu cho owner đọc để quyết, không phải prompt. Prompt lane cho agent (RUN doc) chỉ được viết SAU khi owner trả lời §5; PR này không có RUN doc.
> Docs-only: không code, không test, không migration, không workflow, không file infra hay env. Plan này **không authorize coding**, không tạo tài nguyên cloud, không deploy; mỗi lane vẫn cần verdict `CODE_READY` riêng ở step 0 của session chạy nó.
> Ngày 2026-10-28 · baseline `origin/main` `762045b3f5561ca0ed884095d5e334df0db90325` (= merge #133). Cùng khuôn `docs/sessions/web-mvp-phase4-plan.md` (PR #114). Số đo giá DigitalOcean, PR #50 và thời gian lane Phase 4: `docs/research/web-mvp-phase5-golive-measurements-2026-10-28.md` (cùng PR).

## 1. Tóm tắt

<!-- TODO W1: summary bullets -->

## 2. Phạm vi, baseline và luật go-live

<!-- TODO W1: scope, baseline, read-first summary -->

## 3. Bảng lane

<!-- TODO W1: lane table -->

## 4. Đồ thị phụ thuộc và song song

<!-- TODO W1: dependency graph and pairing -->

## 5. Checklist câu hỏi cho owner

<!-- TODO W2 -->

## 6. Sizing và ước lượng wall-clock

<!-- TODO W3 -->

## 7. Thiết kế thực thi

<!-- TODO W3 -->

## 8. Việc chỉ owner làm (checklist owner, không xếp lịch cho agent)

<!-- TODO W2 -->

## 9. Gate go-live theo thứ tự

<!-- TODO W2 -->

## 10. Rủi ro

<!-- TODO W3 -->

## 11. Readiness verdict (canonical)

Closure matrix (gate §8, 12 hàng; chưa đạt vì owner chưa duyệt plan và các câu ở §5 còn mở):

| # | Gate | Bằng chứng | Kết quả |
| --- | --- | --- | --- |
| 1 | Pin authority theo SHA | `762045b3f5561ca0ed884095d5e334df0db90325` + TARGET_FILES chính xác | PASS |
| 2 | Quyết định trong scope đã chốt | Q1-Q8 còn mở (§5); DD-132 vẫn để deploy DigitalOcean ngoài MVP | FAIL |
| 3 | Scope IN/OUT và owner rõ | §2, §3, §8 | PASS |
| 4 | Dependency phân loại đủ | §3, §4 | PASS |
| 5 | Live schema/code khớp doc | §2 đo tại baseline; mỗi lane đo lại ở step 0 | PASS |
| 6 | Contract data/API/state/auth đủ | §3 chỉ có phạm vi và nghiệm thu; contract chi tiết ở RUN doc và step 0 | PARTIAL |
| 7 | Fail-closed/idempotency/order | gate theo thứ tự ở §9; deploy chỉ bằng trigger tay của owner; decision table ở step 0 | PARTIAL |
| 8 | Open question trong scope = 0 | còn 8 (Q1-Q8) | FAIL |
| 9 | Acceptance matrix có expected result | cột nghiệm thu ở §3; lệnh nghiệm thu chỉ có ở RUN doc (viết sau B1) | FAIL |
| 10 | Migration/security/rollback pin | không lane nào dự kiến cần migration (tail 0074, số trống 0075); security round cho lane chạm config, workflow, auth hay secret theo tên (§7); runbook rollback là một lane | PARTIAL |
| 11 | First slice có hard dependency merged | các lane không phụ thuộc lane nào ở §4 chỉ chờ B1 | PASS |
| 12 | Implementation handoff sẵn sàng | không authorize worktree; RUN doc viết sau B1 | FAIL |

<!-- TODO W2: when section 5 is written, make OPEN_QUESTIONS_IN_SCOPE, row 8 and the Q range in rows 2 and 8 equal the real number of questions -->

```text
REVIEW_POLICY_VERSION: 1.3
REVIEW_VERDICT: NOT_PLAN_READY
REVIEWED_AT: 2026-10-28
AUTHORITY_SHA: 762045b3f5561ca0ed884095d5e334df0db90325
BASE_BRANCH: main
TARGET_FILES:
  - docs/sessions/web-mvp-phase5-golive-plan.md
  - docs/research/web-mvp-phase5-golive-measurements-2026-10-28.md
SLICE: web-mvp-phase5-golive-plan
IN_SCOPE: docs-only plan for the Web MVP Phase 5 go-live: the agent lanes that need no secret, cloud console or deploy (section 3), their dependency graph and pairing (section 4), the owner questions (section 5), the wall-clock estimate (section 6), the execution design (section 7), the owner checklist (section 8), the go-live gates in order (section 9), the risks (section 10)
OUT_OF_SCOPE: code, tests, migrations, workflows, infra and env files, the Phase 5 RUN doc and lane prompts, new DD entries, edits of decisions.md, Reviewed specs or docs/legal, PR #50, any cloud resource, console, account or deploy, any secret value, production data, every owner-only step
G1_DECISION: FAIL
G2_SPEC: PARTIAL
G3_DEPENDENCY: PASS
G4_TEST: PARTIAL
G5_SCOPE: PASS
G6_EXTERNAL: ENABLEMENT_ONLY:do_accounts_and_resources,secret_values,egress_7_1_verified,deploy_manual_trigger,outbox_projector_enable,legal_review,real_user_pilot
HARD_DEPENDENCIES: none for plan authorization; owner approval and the answers to the section 5 questions are the blockers below
PRIOR_SLICES: Web MVP Phase 4 (PRs #114 to #133) merged at AUTHORITY_SHA; the date-gated L54 not yet run; PR #50 frozen owner-only (OPEN, CONFLICTING)
OPEN_QUESTIONS_IN_SCOPE: 8
ENABLEMENT_ONLY_GATES: do_accounts_and_resources, secret_values, egress_7_1_verified, deploy_manual_trigger, outbox_projector_enable, legal_review, real_user_pilot
LIVE_REPO_VERIFICATION: PASS
CONTRACT_MATRIX: PARTIAL
CLOSURE_MATRIX: PARTIAL
ACCEPTANCE_MATRIX: FAIL
SECURITY_AND_MIGRATION_GATE: PARTIAL
IMPLEMENTATION_ARTIFACTS: NOT_REQUIRED_FOR_PLAN_READY
FIRST_IMPLEMENTATION_STEP: BLOCKED until B1 resolves; then P5-S1 step 0 (per-lane readiness for the lanes of section 4 that depend on no other lane)
REMAINING_BLOCKERS:
  - blocker: B1 owner approval of this plan
    owner: Ngoc-Anh
    resolution: the owner writes "Phase 5 plan approved" with an answer or an override for each question of section 5 (this message also allows the merge of this PR; a merge alone approves nothing)
    next_review_trigger: the owner's written message "Phase 5 plan approved" and a main that contains this PR
  - blocker: B2 DD-132 keeps the DigitalOcean deploy outside the MVP
    owner: Ngoc-Anh
    resolution: the B1 message with the answers that name what agents may now prepare (Q1) and the Day-1 tier (Q3); this plan does not lift DD-132 by itself
    next_review_trigger: decisions.md on origin/main carries the owner's DD entry that changes the DD-132 deploy scope
  - blocker: B3 the answers to the section 5 questions are not yet recorded as DD entries
    owner: Ngoc-Anh
    resolution: after B1, the first Phase 5 docs step records each answer as a DD entry in docs/standards/decisions.md on main
    next_review_trigger: decisions.md on origin/main carries a DD entry for each answer of section 5
NEXT_REVIEW_TRIGGER: the owner's written message "Phase 5 plan approved" with answers to the section 5 questions and a main that contains this PR; then P5-S1 step 0 writes the per-lane CODE_READY or NOT_CODE_READY verdicts
```

## Phụ lục A. Dòng backlog đã xét nhưng không đưa vào Phase 5

<!-- TODO W3 -->
