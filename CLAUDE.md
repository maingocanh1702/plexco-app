# ⚡ START HERE (mọi session mới)

> **ĐỌC `docs/00-start-here/HANDOFF.md` TRƯỚC TIÊN** — self-contained: project là gì, kiến trúc,
> **5 HARD RULES** (RLS fail-closed · tiền/PII không ra public · không multi-master ·
> claim-có-tiền cần khoá mạnh · i18n), workflow, doc map, bẫy cần tránh.
>
> **TRƯỚC khi đề xuất/sửa bất kỳ schema · data model · kiến trúc:** đọc canonical trước rồi mới
> viết — `packages/db/schema.ts` + `packages/db/migrations/*.sql` (AUTHORITATIVE) →
> `docs/features/feature_<x>.md` + `BE/*_tech.md` → `docs/standards/decisions.md` (decision log).
> KHÔNG thiết kế từ nguyên tắc chung, KHÔNG tạo bảng song song với khái niệm đã có
> (`persons`/`accounts`/`channel_identities`/`memberships`). Identity: `docs/00-start-here/identity-model.md`
> là orientation, KHÔNG phải source of truth.
>
> Quyết định chưa chốt → ghi vào `decisions.md` dạng proposal (🟡/⬜), KHÔNG viết vào spec đã Reviewed.

---

## Review / Plan Readiness — bắt buộc cho mọi session

Mọi session review, reconcile, fix hoặc final docs/decisions/specs/plans/readiness phải:

1. **Đọc trước** `docs/standards/review-code-readiness-gate.md` trước khi sửa hoặc ra verdict.
2. **Dùng** `docs/templates/review-doc-plan-session-template.md` làm execution/output template; không tự rút gọn thành format review yếu hơn.
3. **Verify live repo truth**: current base/commit, schema, migrations, code, grants/RLS, tests và dependent specs; prose không đủ làm bằng chứng.
4. Tách rõ `DECISION_FINAL` ≠ `PLAN_READY` ≠ `CODE_READY` ≠ `ENABLE_READY` ≠ `IMPLEMENTED`.
5. Pin authority bằng **commit SHA + exact target files**. Global decision version tăng do thay đổi ngoài blast radius không tự invalidate slice đã review.
6. Kết thúc bằng **canonical verdict block** trong gate file. `CODE_READY` chỉ hợp lệ khi G1–G5 PASS, G6 PASS/named enablement-only, closure matrix 12/12 PASS, `OPEN_QUESTIONS_IN_SCOPE: 0`, hard dependencies đã merge (hoặc slice là root dependency), acceptance matrix đủ và first slice có thể thực thi.
7. Nếu chưa ready, ghi `NOT_PLAN_READY` hoặc `NOT_CODE_READY` kèm exact blocker, owner, binary resolution và `NEXT_REVIEW_TRIGGER`; cấm kết luận mơ hồ “gần final” hoặc tiếp tục polish vòng lặp không giới hạn.
8. Open question phase sau/enablement-only chỉ được giữ mở khi current behavior + negative scope đã pin và không ảnh hưởng slice đang authorize.
9. Docs/contract không phải runtime proof; code, migration, tests, deployment và production E2E cần bằng chứng riêng.
10. Mọi persisted review/readiness artifact phải khai báo machine classification, có `REVIEW_POLICY_VERSION` + `CLOSURE_MATRIX`, và pass `pnpm review:check:changed` trước verdict/commit. Final implementation plan/coding handoff BẮT BUỘC dùng `<!-- review-readiness: code-ready -->`; validator phải reject nếu bất kỳ active verdict nào chưa strict `CODE_READY`. `enforce` chỉ được lưu draft/blocker audit, không được authorize coding. Validator đỏ là hard stop; historical exemption không được authorize current work.

Policy này áp dụng kể cả khi user chỉ nói “review”, “check”, “updated”, “fix”, “final” hoặc hỏi plan đã bắt đầu code được chưa.

---

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **plexco-app** (2994 symbols, 3635 relationships, 40 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> Index stale? Run `node .gitnexus/run.cjs analyze` from the project root — it auto-selects an available runner. No `.gitnexus/run.cjs` yet? `npx gitnexus analyze` (npm 11 crash → `npm i -g gitnexus`; #1939).

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows. For regression review, compare against the default branch: `detect_changes({scope: "compare", base_ref: "main"})`.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `query({search_query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `context({name: "symbolName"})`.
- For security review, `explain({target: "fileOrSymbol"})` lists taint findings (source→sink flows; needs `analyze --pdg`).

## Never Do

- NEVER edit a function, class, or method without first running `impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `rename` which understands the call graph.
- NEVER commit changes without running `detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/plexco-app/context` | Codebase overview, check index freshness |
| `gitnexus://repo/plexco-app/clusters` | All functional areas |
| `gitnexus://repo/plexco-app/processes` | All execution flows |
| `gitnexus://repo/plexco-app/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->
