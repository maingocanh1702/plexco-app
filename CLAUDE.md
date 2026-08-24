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

## Template feature docs — hai TẦNG, không phải hai lựa chọn

`docs/templates/feature-spec-template.md` và `docs/templates/feature-dev/fe-spec-template.md`
**không trùng nhau** — chúng nối tiếp nhau. Chọn theo *đang viết cái gì*, không theo cái nào "đầy đủ hơn".

| Đang viết | Template | Đích | Điều kiện |
|---|---|---|---|
| Feature mới (hành vi + contract) | `docs/templates/feature-spec-template.md` (7 section) | `docs/features/FE/feature_{name}.md` | luôn đi kèm BE |
| BE của chính feature đó | `docs/templates/be-tech-spec-template.md` (6 section) | `docs/features/BE/feature_{name}_tech.md` | **1 feature = 1 cặp**, không mồ côi (inventory hiện tại 26 cặp) |
| Một màn web cụ thể | `docs/templates/feature-dev/fe-spec-template.md` (11 section) | `docs/channels/web/FE/feature_{name}_fe.md` | **chỉ sau khi** Product spec đã Reviewed |
| Tracking lúc build | `docs/templates/feature-dev/feature-checklist.md` | — | — |

**FE Design spec là downstream, không phải "bản FE song song".** Header bắt buộc pin
`Source authority: features/FE/feature_{name}.md v{version} · baseline {SHA 40 ký tự}` — chưa có Product
spec Reviewed thì không có gì để pin ⇒ chưa được viết. Product/UX spec phủ **mọi kênh** (web · Zalo ·
Messenger · notification); FE Design spec chỉ phủ `apps/web`. Vì vậy 26 Product spec ↦ 17 FE spec,
**không map 1:1** — đừng tạo thêm cho "đủ cặp".

**`docs/templates/feature-docs-playbook.md` KHÔNG phải template.** Nằm cùng thư mục nên rất dễ copy nhầm,
nhưng nó là bản port từ Sporta, status *"Reviewed — Active khi Adoption B0+B1 hoàn tất"* (**chưa Active**),
và mô tả cấu trúc khác repo này: FE 10 section (có API Endpoints · Error Codes · Caching — Plexco đặt ở
BE spec), enum `Draft|In Review|Approved|Superseded`, thư mục `docs/Phase {N}/`. Chỉ phần *governance*
của nó đã hấp thụ vào `docs/features/README.md` v2.33 (`Reviewed` ≡ `Approved`, gate 3 chiều). Đọc để
hiểu luật, **không copy làm khuôn**.

> ⚠️ **Đừng dùng `docs/research/template-comparison-2026-08-14.md` làm căn cứ hoãn tầng FE spec.** §2.1 và
> T6 của nó ghi FE Design template *"chưa instance nào được viết"* — sai ngay lúc viết: 17 file
> `docs/channels/web/FE/*_fe.md` đã commit **10–11/08**, trước doc đó 3–4 ngày. Phần còn lại của doc vẫn
> dùng được; riêng tiền đề đó đã mục.

### Thiếu là TRƯỢT GATE, không phải "thiếu chữ"

**Product/UX spec** — cả ba đều là subsection, count 7 section **không đổi**:

- `### Entry points` trong §1, đặt trước `### Bất biến`. Bảng `Entry | Route / Surface | Actor | Mô tả`,
  liệt kê đủ route · tab · deep link · bot command · notification.
- UC table **5 cột** `ID | Actor | Hành động | Để… (benefit) | Kết quả`. Benefit chỉ lặp lại Hành động
  = UC thiếu lý do, không phải thiếu chữ. Spec `Reviewed` cũ **không sửa hồi tố** — bổ sung khi sửa lần kế.
- `### NFR compliance` cuối §6, **trỏ ngược** `docs/product/BRD.md` §8 + bảng NFR của `docs/product/TDD.md`.
  Không định nghĩa NFR mới, không dựng catalog thứ ba. Không chạm NFR nào → ghi `none` + lý do; bảng rỗng
  không phân biệt "đã xét, không áp" với "chưa xét".

**FE Design spec:**

- **§8–§11 phải tồn tại** (gate `DD-99` P1) kể cả khi chỉ ghi `TBD`. Template v0.4 thiếu cả bốn và đã kịp
  sinh 5 spec ngày 11/08 — `booking_funnel` · `club` · `club_assistant` · `session_organize` · `tournament`
  — với 0/4, tới nay không promote được. **Đừng xoá heading rỗng.**
- Bảng `#### Error mapping` cho **từng screen**; mã lấy nguyên văn từ BE tech doc của chính feature đó, kết
  bằng hàng unknown/missing/timeout **fail closed**. Prose "fail closed" không thay được bảng. BE chưa pin
  catalog → ghi `UNPINNED error catalog — omit active UI`, **không bịa mã**.
- Cột i18n ghi **cặp chuỗi thật** `t("vi", "en")` (HARD RULE 5). Repo không có key-based i18n —
  `t('some.key')` không resolve được và không có locale file nào trong cây.
- Field chưa có owner DTO → `UNPINNED — omit active UI`. Không dùng wireframe fixture làm implementation authority.
- Chọn **đúng một** bảng Responsive (dashboard-shell có sidebar · player-facing 375 + desktop), **xoá bảng kia**.
  Breakpoint trung gian của surface player-facing là thẩm quyền F0 design — không tự đặt số.

### Floor số lượng — lấy con số CAO HƠN

> ⚠️ Hai nguồn đang lệch (đo 2026-08-24): `feature-spec-template.md` §2 ghi `Minimum 8 use cases`, còn
> review gate ở `docs/features/README.md` v2.33 ghi floor `≥10 UC`. Viết đúng theo template rồi vẫn trượt
> gate — lỗi nằm sẵn trong khuôn. **Lấy ≥10 UC** cho tới khi một trong hai bên được sửa.

Product/UX: **≥10 UC** · ≥10 edge case, 4+ category.
BE: ≥12 edge case, 6 category · ≥20 unit test · ≥4 integration test · ≥3 scenario/status.
Feature chạm money/auth/PII: bắt buộc **decision table** cho mọi nhánh tiền/quyền + abuse cases.
Floor là **điều kiện cần**, không phải target — đủ số không tự làm spec đạt review gate.

---

## Ngôn ngữ — ranh giới là NGƯỜI ĐỌC, không phải loại file

**Agent-facing ⇒ English.** Mọi thứ một agent đọc để thực thi: `.claude/commands/*.md`,
`docs/autopilot/contracts/*`, `docs/autopilot-templates/autopilot-prompt-*.md`,
`level3-workflow.md` + `level3-handoff.md`, và **mọi khối ` ```text ` được paste vào Claude Code**.

**Owner-facing ⇒ tiếng Việt.** `docs/standards/decisions.md`, `docs/product/*`,
`docs/00-start-here/HANDOFF.md`, `docs/slice-readiness-verdicts.md`,
`docs/standards/review-code-readiness-gate.md`, và các doc quyết định/plan `level3.1-*`
(`design-discussion`, `adoption-plan`) — chúng là artifact owner đọc để quyết, không phải prompt.

> ⚠️ Đừng khai lớp bằng glob `level3*.md`: đo 2026-08-09 cho thấy `level3-workflow.md`/`level3-handoff.md`
> = 0 dòng tiếng Việt, còn `level3.1-design-discussion.md` = 191 và `level3.1-adoption-plan.md` = 109.
> Cùng tiền tố, khác lớp người đọc.

Khuôn lai chuẩn cho RUN/prompt doc: **prose dẫn tiếng Việt, payload English** — xem
`docs/autopilot-templates/ap23-inbound-webhook-RUN.md` và `level3.1-slice-prompts.md`.

> ⚠️ **Luật này trước đây KHÔNG được viết ở đâu** (grep `english|language|ngôn ngữ` trả zero khắp
> `CLAUDE.md` · `AGENTS.md` · `docs/standards/` · `docs/autopilot-templates/`), nên nó chỉ sống trong
> convention của file đang có. 2026-08-09 một phiên đã viết 10 slice prompt bằng tiếng Việt vì suy từ
> các doc tiếng Việt xung quanh thay vì kiểm lớp người đọc. Ghi ra đây để "grep không thấy" thôi
> không còn là lý do.

Kiểm nhanh trước khi commit một file có khối prompt:

```bash
awk '/^```text$/{f=1;next} /^```$/{f=0} f' <file> \
  | grep -P '[àáảãạăâđèéẻêìíỉòóỏôơùúủưỳýỵ]'   # phải rỗng
```

---

<!-- level3-workflow:start -->
## Workflow mặc định — Level 3 supervised autonomy

```text
WORKFLOW_LEVEL: 3
WORKFLOW_MODE: supervised_autonomy
HUMAN_ROLE: manager_of_managers
DEFAULT_STOP_MODE: STOP_AT_READY
AUTO_MERGE: off
```

Mọi task/session/feature **mở mới** chạy theo `docs/autopilot-templates/level3-workflow.md`
(canonical contract, mirror từ `Claude template`). Session đang chạy giữ nguyên contract cũ —
forward-only, không migrate giữa chừng. Entry point vận hành: `docs/autopilot-ONBOARDING.md`.

1. Trước khi code, primary agent resolve **task contract** (`level3-workflow.md` §3): outcome, base,
   context sources, skills, scope/negative scope, risk P0–P3, autonomy mode, model policy, sandbox,
   human decisions, slice graph, worktree plan, verification, code/security review, budget, stop
   conditions, deliverables.
2. Primary agent tự kéo context (code + `docs/features/*` + `docs/standards/decisions.md`), tự chia
   slice, giao và giám sát child agent, tích hợp rồi verify cả outcome. Không hỏi owner từng bước.
3. **1 writing slice = 1 branch + 1 worktree + tối đa 1 writer.** Register trước khi ghi — truyền
   **runtime manifest**, KHÔNG phải authored contract:
   `scripts/autopilot-scope-gate register --manifest .autopilot/state/<feature>/manifest.json`
   (tự viết tay file này từ `docs/autopilot-manifests/_TEMPLATE.json` trước khi register; nó mang
   `manifest_schema_version: level3-operational-v2`, còn authored contract ở
   `docs/autopilot-manifests/<slug>.json` thì BỊ CẤM mang trường đó).

   > ⚠️ **Lịch sử của dòng này, đọc cả hai lớp.** *(a)* Bản đầu ghi authored path và mô tả gate là
   > "fail-closed" — cả hai đều sai, sửa 2026-08-01: khi đó `register` chỉ ghi
   > `registered-manifest.sha256` **nếu** manifest truyền vào có `manifest_schema_version`, nên đưa
   > authored path vào thì nó **bỏ qua hash-lock, không báo lỗi, vẫn in `registered`** — fail-OPEN
   > trên đúng cơ chế toàn vẹn mà cả gate dựa vào. Một slice đã mất một vòng đăng ký vì làm đúng theo
   > dòng cũ. *(b)* **Bản mô tả fail-OPEN đó nay cũng đã mục** (đo 2026-08-21, KIT_VERSION 31):
   > `register` kiểm `manifest_schema_version == level3-operational-v2` **ngay câu lệnh đầu tiên của
   > nhánh, trước khi chạm `INFLIGHT.md` hay tạo state dir**, và authored path nay `HALT
   > CONTRACT_INVALID` chứ không đi lọt. Tự đo, đừng tin số chép tay:
   > `grep -n 'CONTRACT_INVALID' scripts/autopilot-scope-gate`.
   > **Lời khuyên vẫn giữ nguyên vì nó rẻ và không phụ thuộc phiên bản: sau mỗi lần register, kiểm
   > `.autopilot/state/<feature>/registered-manifest.sha256` tồn tại trước khi làm bất cứ việc gì
   > khác.** Đừng tin chữ "registered".

   Kit version đọc từ `scripts/autopilot-scope-gate` header, KHÔNG hard-pin trong prose — số chép tay
   đã stale một lần ở `10` trong khi cài đặt là `11`. Root worktree luôn ở `main`.
   Slice dùng chung migration/state/
   generated artifact → chạy tuần tự, không song song.
4. Verify bằng lệnh thật của repo (`pnpm test` với `DATABASE_URL_TEST`, build, lint, typecheck, e2e
   khi vượt boundary thật), rồi review độc lập bắt buộc qua `scripts/codex-review-pin.sh`; slice chạm
   auth/secret/permission/tiền/external input/deployment chạy thêm 1 security round. Reviewer không
   gọi được → `HALT TOOL_UNAVAILABLE`, cấm tự hạ gate. Prose không thay được bằng chứng chạy thật.
5. Kết thúc ở **`READY | AWAIT | HALT`**. `READY` = diff chính xác + gate chạy trực tiếp + review sạch;
   `AWAIT` = thiếu đúng 1 quyết định/context/authority bên ngoài, kèm 1 đề xuất và điều kiện resume nhị
   phân; `HALT` = breaker cứng (`MAX_ROUNDS` >5 vòng, `REGION_THRASH` cùng vùng 3 vòng liên tiếp).
6. Owner giữ: outcome, priority, policy, budget, quyết định sản phẩm material, ngoại lệ, merge/deploy.

**Level 3 KHÔNG có nghĩa auto-merge.** P0 vẫn prepare-only tới khi owner cấp quyền thực thi; P1 luôn
supervised; `proactive_routine` chỉ mở cho class hẹp đã chạy sạch nhiều lần, không bật mặc định.
Số agent trong model gốc là minh hoạ scale, không phải acceptance criterion — task nhỏ không fan-out.

Gate review/readiness ở trên vẫn áp song song và **chặt hơn** thì thắng: docs/plan/spec vẫn phải qua
`docs/standards/review-code-readiness-gate.md` và `pnpm review:check:changed`.
<!-- level3-workflow:end -->

---

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **plexco-app** (7523 symbols, 9070 relationships, 96 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope.

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
