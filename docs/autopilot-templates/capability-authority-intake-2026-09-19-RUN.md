# RUN — `tenant-capability-authority-core` vào DESIGN-v2 (intake → plan → supervised)

> **Soạn 2026-09-19 tại `main@03a83ce`.** Prose tiếng Việt để owner đọc và quyết; mọi khối
> **text block** là payload **English** dán thẳng vào Claude Code (luật ngôn ngữ của `CLAUDE.md`).

## Vì sao slice này, vì sao bây giờ

`tenant-capability-authority-core` là owner duy nhất của **DD-56 closed action registry** —
registry action→capability, least-privilege preset chung cho `admin|co_admin`, tenant/person
authority resolver, tenant-private grant có expiry/revoke, append-only grant audit, và
`authorize(action, actor, target)` fail-closed.

Ba lý do đo được, không phải cảm tính:

1. **Nó đã hết bị chặn mà không ai kiểm lại.** DD-56 pin chuỗi
   `chat-definer-role-provisioning → chat-dm-safety-authority-core → dd38-dd86-chat-schema-core →
   tenant-capability-authority-core`. Ba slice đầu đều `status: merged` trong
   `../autopilot-backlog.md`. Row của slice này vẫn `status: idea` với
   `depends_on: [dd38-dd86-chat-schema-core]` — **dependency đã thoả từ lâu**, row chỉ chưa được
   chấm lại. Dependency thứ hai (`plans-dd29-capability-registry`) đã `superseded` từ 25/08.
2. **Nó trừ nợ thay vì cộng.** Điều khoản 5 của DD-56 amendment #1: cổng tạm
   `apps/web/lib/session-command-route.ts` **void ngay khi slice này land**, và việc thay bằng
   `authorize(action, actor, target)` nằm trong scope slice core **theo cấu tạo**. Sau amendment
   #3 (19/09, `decisions.md` v2.51) cổng tạm phủ **BẢY** route — slice này thừa hưởng nghĩa vụ
   thay cho cả bảy, cộng ESLint `no-restricted-imports` và bộ AST test đi kèm.
3. **Nó tháo nhiều nút cùng lúc.** DD-56 viết thẳng *"mọi Chat capability consumer vẫn HOLD tới
   khi core này land"* — module 10b (In-app Chat) đang **0 service** với bốn key chat nằm trong
   preset của core. Điều khoản 4 của amendment #1 cũng giao cho slice core việc đóng
   consume-time gap (re-check actor **dưới lock**), *không* giao cho lane route nào.

**Cửa sổ rẻ nhất là bây giờ:** consumer duy nhất của route đọc session là FE, mà FE = 0 màn và
đang PENDING (DD-116). Làm việc cấu trúc lúc không có ai chờ là lúc nó không tốn gì quan sát được.

## Ba thứ cùng tên "capability" — đừng gộp

Đây là chỗ dễ sai nhất và đã được backlog cảnh báo một lần (`update_2026-08-25`):

| Thứ | Ở đâu | Là gì | Trạng thái |
|---|---|---|---|
| `authorizeTenantAction` | `packages/db/src/authorization.ts` | DD-110 **billing-authz** — gate suspension/entitlement của tenant trên money action | LIVE, 6 call site trong `session-service.ts` |
| `resolveCapability` | `packages/db/src/capability.ts` | DD-29 **plan-entitlement resolver** | Merged, **0 caller production** |
| `authorize(action, actor, target)` | *chưa tồn tại* | DD-56 **action registry** | **Slice này sở hữu** |

Đo tại `03a83ce`: `grep -rn 'ACTION_REGISTRY\|chat.channel.manage' packages apps` (trừ test) trả
**rỗng**, và `packages/db/schema.ts` **không có** bảng `grants`. Migration tail `0046` ⇒ số trống
kế tiếp là `0047`.

## Định tuyến intake: slug là `tenant-routing-authz`

`/ap3-intake` chấm một **feature** và resolve bằng cặp `FE/feature_<slug>.md` +
`BE/feature_<slug>_tech.md`. Slice này không có spec pair riêng — nó nằm trong
**`tenant_routing_authz`**, và đó là cặp đúng chứ không phải cặp gần đúng:

- `FE/feature_tenant_routing_authz.md` — **Status: Reviewed**, v2.8; §4 có **DD-56 capability
  matrix** đủ 11 hàng và khối **"Implementation ownership"** gọi đích danh
  `tenant-capability-authority-core` là owner duy nhất.
- `BE/feature_tenant_routing_authz_tech.md` — **Status: Reviewed**, v2.8; §2 có DDL
  `grants`/`routing_audit`, §3 có `GET`/`POST /api/tenants/:tid/grants`, §4 có **AuthZ Action
  Matrix**, §5 có Testing Plan. Nó cũng tự ghi rằng target delta của DD-56 đi bằng **migration
  mới số monotonic kế tiếp**, không sửa historical migration.

⚠️ Intake chấm cả feature, nhưng **task** cần chấm là `tenant-capability-authority-core`. Các item
task-scope của rubric (R2.2 RED thật · R3.2 schema · R6.1 migration) chỉ đúng khi session biết
task là cái nào — nên prompt bên dưới nói rõ scope ngay dòng đầu.

## Trình tự bốn bước (và chỗ owner phải ra tay)

1. **Score round** — prompt A. Ra `ap3/features/tenant-routing-authz/INTAKE.md` trên nhánh
   `docs/intake-tenant-routing-authz`, kèm danh sách câu hỏi đánh số. **Session dừng ở đây.**
2. **Owner trả lời** → **apply round** — prompt B. Mỗi doc edit là một unified diff chờ bạn duyệt.
   Ra **hai commit tách rời** (doc edit trước, `INTAKE.md` sau). **Session không push, không mở PR.**
3. **Owner merge PR intake vào `origin/main`.** `/ap3-plan` đọc **chỉ** `origin/main` và sẽ từ
   chối nếu answer mới chỉ nằm trên nhánh — đó là thiết kế, không phải lỗi.
4. **Plan round** — prompt C. Ra milestone + slice. Slice của task này là **P1 +
   schema-migration** ⇒ `plan-emit` phải đánh `supervised: true`, **không** vào `ap3/queue/`:
   `ap3/routines.json` chỉ có hai class `code-quality-p2` và `feature-session-p2`, và cả hai
   `risk: P2`. Thực thi đi đường **Level 3 supervised** (`level3-workflow.md`), không phải
   dispatcher.

Prompt cho bước thực thi **chưa soạn được ở đây** — scope của nó do `/ap3-plan` sinh ra. Soạn sau
khi có `plan.json`.

---

## Prompt A — score round

```text
/ap3-intake tenant-routing-authz

Scope this intake to ONE task inside that feature: `tenant-capability-authority-core` — the DD-56
closed action registry, the least-privilege preset shared by `admin|co_admin`, the tenant/person
authority resolver, tenant-private grants with expiry/revocation, the append-only grant audit, and
a fail-closed `authorize(action, actor, target)`.

CONTEXT measured on main@03a83ce, 2026-09-19. These are facts to verify, NOT verdicts. Score every
rubric item yourself from the docs; never infer a PASS from this block or from code.

- Spec pair: docs/features/FE/feature_tenant_routing_authz.md (Status: Reviewed, v2.8) and
  docs/features/BE/feature_tenant_routing_authz_tech.md (Status: Reviewed, v2.8). FE section 4
  carries the DD-56 capability matrix and an "Implementation ownership" block naming this task as
  sole owner. BE section 2 has grants/routing_audit DDL, section 3 has GET and POST
  /api/tenants/:tid/grants, section 4 has the AuthZ Action Matrix, section 5 has a Testing Plan.
- Three different things share the word "capability" in this repo. Do NOT merge them:
  1. `authorizeTenantAction` (packages/db/src/authorization.ts; 6 call sites in session-service.ts)
     is DD-110 billing-authz -- the tenant suspension/entitlement gate on money actions. Live.
  2. `resolveCapability` (packages/db/src/capability.ts) is the DD-29 plan-entitlement resolver.
     Merged, zero production callers.
  3. `authorize(action, actor, target)` is the DD-56 action registry. It does not exist: grepping
     ACTION_REGISTRY or chat.channel.manage across packages and apps (excluding tests) returns
     nothing, and packages/db/schema.ts has no grants table. This task owns it.
- Migration tail is 0046, so the next free number is 0047. The BE spec states the DD-56 delta goes
  in a new monotonic migration and never edits a historical one.
- Dependency state: DD-56 pins the chain chat-definer-role-provisioning ->
  chat-dm-safety-authority-core -> dd38-dd86-chat-schema-core -> tenant-capability-authority-core.
  All three predecessors are `status: merged` in docs/autopilot-backlog.md. The backlog row for
  this task still reads `status: idea` with `depends_on: [dd38-dd86-chat-schema-core]`; that
  dependency is satisfied and the row simply has not been re-scored.
- DD-56 now carries amendment #1 (3 routes), #2 (+close/cancel, five) and #3 (+2 guest-note,
  seven; ratified 2026-09-19, decisions.md v2.51). Clause 5 of amendment #1 makes THIS task the
  owner of replacing the interim choke-point apps/web/lib/session-command-route.ts for all seven
  routes, together with its ESLint no-restricted-imports rule and AST tests. Clause 4 assigns the
  consume-time re-check under lock to this task as well, not to any route lane. Keep both inside
  scope when scoring R2.3 and R3.3.

Follow .claude/skills/ap3-intake exactly: validate the slug, cut the isolated worktree BEFORE the
first write, gather evidence with parallel Explore sub-agents reporting `file:section -> fact`,
cite the exact file:section that decided each item, and compute `status` with
`python3 ap3/aplib.py intake-score docs/standards/feature-readiness.md <evidence.json>` rather than
deriving it yourself. List in `sources:` every doc path you actually read -- /ap3-plan diffs exactly
those paths for staleness, so a path you relied on but omitted is a path whose later changes are
never noticed. Stop at the numbered questions. Do not plan, do not write code, do not push.
```

## Prompt B — apply round (sau khi bạn trả lời)

```text
/ap3-intake tenant-routing-authz --apply

My answers are in ap3/features/tenant-routing-authz/INTAKE.md under "## Answers". If any answer is
missing there, ask me rather than inferring it.

Four things from the skill that are easy to skip, restated because each one has cost a round before:

- Propose every doc edit as a unified diff and wait for my explicit yes on that exact edit. Never
  set a decision's status to FINAL on the strength of "they answered, so they must mean yes."
- If an answer pins the behaviour of a library or platform API, probe it on THIS project's runtime
  and quote the real output inside the doc edit. Quote only the minimal fact -- a version string, a
  representative row shape -- never a raw dump. Do not probe any real database without asking me
  first; a disposable local fixture you provisioned yourself is the only exception.
- Two separate commits, in this order: the doc edits alone first, then record SHA_A =
  git rev-parse HEAD, then INTAKE.md alone in a second commit carrying `base_sha: SHA_A`.
- Do not push and do not open a PR. Print the branch, the worktree path and the changed files.
```

## Prompt C — plan round (sau khi bạn merge PR intake vào `origin/main`)

```text
/ap3-plan tenant-routing-authz

Before anything else: this only works once the docs/intake-tenant-routing-authz PR is merged into
origin/main. Read INTAKE.md from `git show origin/main:ap3/features/tenant-routing-authz/INTAKE.md`,
never from the working directory, and run the sources-scoped staleness diff. If it refuses, say why
and stop -- do not work around it.

Risk classification for this feature's slices, stated up front so it is not rediscovered:
`tenant-capability-authority-core` is P1 and change_class schema-migration. ap3/routines.json holds
exactly two enabled classes, code-quality-p2 and feature-session-p2, both risk P2 -- so no slice of
this task may be emitted as a dispatchable queue file. Mark them `supervised: true` in plan.json;
execution goes down the Level 3 supervised path in docs/autopilot-templates/level3-workflow.md, run
by a human-supervised session, not by the dispatcher.

Two obligations this task inherits from DD-56 and that the slice list must account for explicitly,
rather than leaving them to whoever executes:
- amendment #1 clause 5: replacing the interim choke-point apps/web/lib/session-command-route.ts
  for all seven routes now gated by it, plus retiring its ESLint no-restricted-imports rule and the
  AST tests that back it;
- amendment #1 clause 4: the consume-time re-check of the actor inside the command transaction,
  which the amendment assigns to this slice by name.

Do the impact, risk and test-mapping analysis yourself; emit the queue files with
`python3 ap3/aplib.py plan-emit <plan.json>` rather than hand-editing them. Do not push, do not
open a PR.
```

---

## Bẫy đã biết, ghi để không phải trả giá lại

- **Đừng chạy `/ap3-intake` hay `/ap3-plan` headless.** Cả hai skill tự khai `never runs headless`;
  dispatcher không bao giờ load chúng.
- **Đừng để session `git checkout -b` trong checkout của bạn.** Cả hai skill bắt cắt worktree riêng
  dưới `ap3/state/worktrees/` trước lần ghi đầu tiên — `ap3/state/` đã gitignored.
- **`/ap3-plan` từ chối khi intake chưa merge là ĐÚNG.** Staleness check diff theo `sources:` giữa
  `base_sha` và `origin/main`; trước khi merge thì diff khác rỗng nên nó chặn. Đừng vá quanh.
- **Hai commit ở apply round, không phải một.** `base_sha` phải trỏ tới một commit đã tồn tại khi
  `INTAKE.md` được viết — một commit không thể chứa sha của chính nó.
- **Một R1–R5 item GAP ⇒ `NOT_READY` toàn cục**, bất kể R6–R8. Và status phải do
  `aplib.py intake-score` tính, không phải tự suy.
