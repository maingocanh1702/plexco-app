# Web MVP Phase 4 - quy tắc vận hành và chỉ mục lane (L39-L55) · 2026-10-26

> **Mục đích:** quy tắc vận hành agent-facing, chỉ mục lane và block session cho Phase 4 của Web MVP, chạy local-only: 17 lane chắc chắn L39-L55 của `docs/sessions/web-mvp-phase4-plan.md` (§1, §3) và lane L58 của conductor (DD-150 + RUN doc này).
> Phần dẫn tiếng Việt cho owner; mọi khối `text` là English (agent-facing), không có dấu tiếng Việt.
>
> **NOT an authorization to code.** Authority = `docs/sessions/web-mvp-phase4-plan.md` (merged as PR #114) + the owner's written approval of 2026-10-26 (DD-150) + the per-lane CODE_READY verdict written in each lane's step 0.
> Chưa có verdict hoặc lane bị `NOT_CODE_READY` thì lane đó chỉ được AWAIT, không được viết code.
>
> **Quyết định owner -> số DD** (số tiếp theo còn trống đo tại `2ff2fd736284d0004f23737967516049f8a9cc0a`: DD-149 là lớn nhất; nếu `decisions.md` đánh số khác thì `decisions.md` thắng):
> tin nhắn VIẾT của owner ngày 2026-10-26 "Phase 4 plan approved, Q1-Q10 default" (Q1-Q10 theo default của plan §5) -> DD-150. Đây là quyết định của chính owner, không phải nhãn uỷ quyền.
> tin nhắn VIẾT của owner ngày 2026-10-26 18:32, luật đồng thời (nguyên văn ở S0) -> DD-151. Đây là quyết định của chính owner, không phải nhãn uỷ quyền.
> Quy tắc nền: DD-132 và các quyết định owner ở dòng PROGRAM FACTS của S1 (trỏ theo DD id, không chép lại).
> **Lưu ý cite:** số dòng `path:line` đo tại `origin/main` `2ff2fd736284d0004f23737967516049f8a9cc0a` (merge commit của PR #114); `decisions.md` dịch dòng sau PR này (DD-150 chèn trên DD-149), nên cite theo DD id trước.

## S0. Phase 4 chạy như thế nào

Conductor (session local của owner) -> **một orchestrator mới (opus/max) cho mỗi lane** của P4-S1..P4-S7 -> workers. Mỗi lane = một branch + một worktree + một writer = một PR (plan §1).

- **Luật đồng thời** (quyết định của chính owner: tin nhắn viết của owner trong terminal của conductor, 2026-10-26 18:32 giờ Sài Gòn theo đồng hồ của conductor; DD-151): từ 18:32 mọi lần khởi động agent mới theo luật này, luật thay mọi luật sóng hay chạy song song của doc này và của PLAN §4 và §7 (PLAN:99, :100, :147; plan không sửa), và agent đang chạy làm xong unit hiện tại của nó.
  > Owner rule 2026-10-26 18:32 (concurrency, to avoid usage limits; replaces any wave rule that runs lanes in parallel): at most ONE lane orchestrator live at a time (run the Phase 4 waves lane by lane, sequentially), and under it at most ONE worker, reviewer or verifier live at a time (no parallel reviewers, split review units run one after another). The merge clerk runs only when no worker is live. Agents already running finish their current unit; apply this at every new spawn from now on. Model routing unchanged (orchestrators opus max). Log this rule in CONDUCTOR-LOG and update the Phase 4 RUN doc estimate.
- **Thứ tự chạy** (decided by the conductor under the owner's delegation of 2026-10-22, not an owner signature): tin nhắn VIẾT của owner ngày 2026-10-26 "Phase 4 plan approved, Q1-Q10 default" (DD-150) -> merge PR #114, plan Phase 4 (`2ff2fd736284d0004f23737967516049f8a9cc0a`) -> P4-S0b (lane L58: DD-150 + RUN doc này) đã chạy song song với hai lane code đầu tiên L55 (P4-S1a) và L39 (P4-S1b) -> L51 (P4-S1c) chỉ bắt đầu sau khi L58 merge (trước 18:32) -> từ 18:32, từng lane một theo thứ tự ở S3 (luật đồng thời ở trên). Điều kiện bắt đầu của chính plan ("B1 xong và `main` chứa PR này", plan §7) được trỏ tới, không sửa.
- **Orchestrator và worker:** conductor khởi động mỗi lane bằng một orchestrator riêng, mới, model opus effort max (luật routing của owner 2026-10-21; plan §7); orchestrator không tạo orchestrator khác; worker theo trường MODELS của lane block; không agent nào chạy model `fable`. Mỗi lượt orchestrator mới tính vào run cap của lane (plan §7).
- **Merge:** một merge clerk cho cả Phase 4 merge từng PR có dòng `MERGE_READY` khi CI xanh và chỉ khi không có worker nào đang chạy (luật đồng thời ở trên); conductor chạy cổng S4 trước và sau mỗi lần merge (plan §7 "Merge"; S4 của doc này). Plan §7 không ghi model của clerk: clerk chạy sonnet/high như ở Phase 3 (`docs/autopilot-templates/web-mvp-phase3-2026-10-16-RUN.md`:1262, S4 "Merge round"), giữ nguyên theo luật routing của owner 2026-10-21 ("Workers, merge clerk, verifier and summariser stay as they are.").
- **HEARTBEAT:** conductor tạo lại cron HEARTBEAT khi Phase 4 bắt đầu và xoá nó khi Phase 4 kết thúc: mọi lane đã merge, không agent nào chạy, không quyết định nào chờ owner (bước 5 của luật heartbeat). Nguồn: chỉ dẫn owner 2026-10-25 và cách đọc của conductor về bản duyệt 2026-10-26, ghi ở `status/CONDUCTOR-LOG.md` và `status/OWNER-DECISIONS-2026-10-26.md` của conductor, nằm ngoài repo.
- **Việc chỉ owner làm:** danh sách ở plan §8 (trỏ tới, không chép lại). Bản duyệt 2026-10-26 không cho phép việc nào trong danh sách đó; không lane nào làm hay phải chờ chúng (plan §1, §8); PR #50 vẫn chỉ owner được động tới.
- **Notes và bản ghi:** ghi chú và script của mỗi session nằm trong `status/<session>-notes`, báo cáo session ở `status/<session>-report.md`, cả hai trong thư mục của conductor, NGOÀI repo; file tracked không cite các đường dẫn đó làm bằng chứng. Bản ghi trong repo của một lane là file readiness step 0 (`docs/sessions/web-mvp-phase4-readiness-<slug>.md`, dòng STEP 0 của S1) và PR của lane.
- **Phụ thuộc và step 0:** không lane nào bắt đầu trước khi mọi phụ thuộc của nó đã merge vào `main`, và mỗi lane cần verdict `CODE_READY` riêng ở step 0: plan không tự cho phép code (plan §1, §7).
- **Lane L58:** lane của conductor cho blocker B2 (plan §11) và hàng "RUN doc Phase 4" của plan §9; bảng lane của plan phủ L39-L57 và không có hàng L58.

## S1. Quy tắc vận hành Phase 4

Khối dưới đây tự đủ và thay S1 của Phase 3 cho mọi việc Phase 4: dán nguyên văn vào brief của mọi worker, kèm luật chạy của owner (nguyên văn), đúng một block lane và một dòng task.
Nguồn của từng luật (luật owner, DD, sự cố) và KEEP/ADAPT/DROP của từng luật S1 Phase 3 nằm ở `docs/sessions/web-mvp-phase4-readiness-p4-dd-and-run-doc.md`.

```text
PLEXCO WEB MVP PHASE 4 - OPERATING RULES (worker brief = this block + the owner run rules verbatim + one lane block + one task line)
AUTHORITY: the owner texts printed in your brief are the authority and go verbatim into writer and reviewer briefs: the owner decisions of 2026-10-16, 2026-10-21, 2026-10-22 and 2026-10-24, the written approval of 2026-10-26 (DD-150), the token, resume and tool-hygiene rules, and the orchestrator routing rule of 2026-10-21; the newest owner text wins. The Phase 4 plan is docs/sessions/web-mvp-phase4-plan.md.
RUN: unattended; nobody answers questions. Never ask: do the brief, or stop and report why you could not. Workers never spawn subagents.
  A case that the owner texts, the lane block and these rules do not cover is a ruling request: BEFORE anything is written for it, the orchestrator writes a short file (options and a recommendation) in the session notes directory (the conductor's status/<session>-notes, outside the repo) and hands back RESULT: AWAIT naming it.
  A permission-classifier denial is the owner's permission layer: never retry the denied command or a variant, never reroute it, never ask another agent to run it; the orchestrator writes AWAIT-RQ<n>-<unit>.md in the session notes directory (outside the repo) with the exact commands the owner must run (absolute quoted paths, one command per line in run order, the commit message last) and hands back RESULT: AWAIT.
SCOPE: do exactly the brief; stay inside FILES IN SCOPE and the lane worktree; anything else you notice goes under OPEN as OUT_OF_SCOPE; when the lane owns docs/autopilot-backlog.md it may become a backlog row (at most 3, with file:line evidence and a source line); never a drive-by edit.
  The repo root checkout ("$HOME/Projects/Plexco app") is the owner's working copy and read-only for agents: never check out, pull, reset, stash, edit or commit there, and never run gitnexus analyze there. PR #50 (frozen, owner-only) and every PR that is not yours are never touched.
  Read current main with `git show origin/main:<path>`. In zsh write ${ref}:path.
  Before changing a schema, data model or architecture read packages/db/schema.ts, packages/db/migrations/*.sql, the feature spec
  (docs/features/FE/feature_<x>.md), its BE tech doc (docs/features/BE/feature_<x>_tech.md) and docs/standards/decisions.md.
  Never create tables parallel to persons / accounts / channel_identities / memberships.
HARD RULES (a violation is a real leak):
1. RLS fail-closed: every tenant-scoped query goes through tenantRepo / withTenant; never from a route handler or client code.
2. Money and PII never reach a public surface beyond what an owner decision names (DD-133, DD-139); public_sessions holds the whitelist only, and the invariant tests stay green.
3. No multi-master: Postgres + domain services are canonical; web and chat surfaces send commands and read projections.
4. A money-bearing claim or identity merge needs a strong factor: verified email on web, single-use link_code on the bot (DD-50).
   Name, alias or display name is never enough.
5. Every user-facing string is t(vi, en). No key-based i18n.
PROGRAM FACTS (owner rulings, do not re-decide; pointers only: read the entry in docs/standards/decisions.md before you touch its area): DD-132 (MVP scope and money: bank integration, billing and paywall,
  reminders, DigitalOcean, secret and OAuth provisioning, manual payments and their reversal); DD-131 OD-4 (b) (the one web VND formatter, apps/web/lib/money.ts, guarded by apps/web/lib/money-single-formatter-guard.test.ts);
  DD-139 (venue visibility); DD-140 (amounts in Zalo messages); DD-141 (flag defaults); DD-142 (late Host Pro invoice); DD-143 (Zalo /join with nothing owed); DD-144 (invisible-character strip);
  DD-146 (zalo_dm age limit); DD-147 (member-facing name writers); DD-149 (the owner decisions of 2026-10-24); DD-150 (the Phase 4 approval and the answers Q1-Q10). Local-only work: plan sections 2 and 8.
LABELS: a default you choose is "default applied, pending owner sign-off" (readiness file and PR body); a conductor ruling is "decided by the conductor under the owner's delegation of 2026-10-22, not an owner signature"; the owner's choices of 2026-10-24 keep "accepted under the owner's delegation of 2026-10-24 (assistant review)" (DD-149); the owner's written approval of 2026-10-26 ("Phase 4 plan approved, Q1-Q10 default") is the owner's own decision (DD-150), never a delegation label.
  Only DD-145's table, the owner-signed rows of DD-138 and the owner's own written decisions are owner signatures; never write "signed" for anything else.
LEADS: every file, line, DD number, row slug and SHA in a lane block or session note was read by the conductor at an earlier base and may be wrong or stale (such pointers were wrong four times in P3-S16 and L37): open the file and quote the line before you cite it; when a lead does not match the file, follow the file and say so under "Lead corrections" in the report and the PR body.
REVIEW (DD-122 D4, owner 2026-10-12; Codex waived): NO codex-review-pin.sh, NO scope-gate register/ready, NO ap-finish. Review =
  ONE independent Claude reviewer role that did not write the code (diff + specs + HARD RULES; findings BLOCKING / SHOULD_FIX / NIT with
  file:line, a one-line failure scenario and the source that contradicts it; trust code, not comments or PR text), at most 3 rounds, counting the rounds before the first push.
  A large review may be split into area units of the same role (a round = every unit of one pass); the area units of one review run one after another, never together (owner rule 2026-10-26 18:32). The reviewer reads COMMITTED content (git show <sha>:path), never a file a writer is editing.
  A finding you reject needs a written reason (Tier B) that the conductor reviews. A second opus/max security reviewer for auth, permission, secret, money, external input, public surface and SQL definers.
  Fixes after the final round are labelled "fix applied after the final round, not re-reviewed (3-round cap)". PR body carries: "Codex waived by owner 2026-10-12; reviewed by independent Claude subagent".
MODELS: writer opus/max for P1 and complex work (auth, identity, money, RLS, SECURITY DEFINER, migrations, webhooks, concurrency),
  sonnet/high for UI wiring, copy, e2e specs, docs, mechanical merges. Reviewer opus/max for money/auth/identity/security/SQL/
  concurrency and for any opus writer; opus/high for other code; sonnet/high for docs-only and mechanical merges. Readiness
  reviewer = the model and effort the lane block's MODELS assigns. Session orchestrators run opus/max (owner routing rule 2026-10-21, which replaced the 11:57 fable rule), one fresh orchestrator per lane (plan section 7); every worker follows this rule (sonnet/high writers where the lane says so); merge clerk, verifier and
    summariser sonnet/high; never pass model fable to any Agent call (owner routing rule 2026-10-21). Pass the model explicitly and state the effort inside every worker prompt; at most ONE live lane orchestrator and, under it, at most ONE live worker, reviewer or verifier at a time (owner rule 2026-10-26 18:32, RUN S0); never two writers in one worktree (Phase 4 common note C1, conductor brief, outside the repo).
STEP 0 (every lane, before any code): a readiness reviewer (the model and effort the lane block's MODELS assigns) re-verifies live truth at the lane base (commit, schema, migrations, grants and RLS, tests, dependent specs).
  "Step-0 readiness reviews answer only the lane's question list from the files the lane names: no repo-wide reading, at most 60 tool calls." (owner token rule 2026-10-16 19:41)
  CODE_READY => write docs/sessions/web-mvp-phase4-readiness-<slug>.md from docs/templates/review-doc-plan-session-template.md (code-ready marker, machine classification, REVIEW_POLICY_VERSION, CLOSURE_MATRIX, canonical verdict block of docs/standards/review-code-readiness-gate.md, TARGET_FILES only files that exist),
  run `pnpm review:check:changed` BEFORE committing (it diffs against HEAD, so after the commit it is vacuous), commit it as the lane branch's FIRST commit, then run `pnpm review:check`.
  NOT_CODE_READY => commit nothing; the verdict block goes into the session report as that lane's AWAIT item (exact blocker, owner, binary resolution); the lane does not start; other lanes continue.
UNPINNED: each lane pins its defaults in its readiness file and PR body as "default applied, pending owner sign-off" (value + label, so OPEN_QUESTIONS_IN_SCOPE is 0; see LABELS); the plan names no consolidation lane, so a default stays there until the owner or a lane the conductor names records it (the conductor may add a docs closeout lane under the owner's delegation: do not promise one); a lane edits docs/standards/decisions.md only where its lane block's FILE OWNERSHIP names the entry.
BUDGET (gate B3, about 300 LOC, 3 modules, 1 migration): at most ONE migration per lane. A lane over the default LOC or module budget needs an explicit B3 exception in step 0 (modules named, why a split breaks coherence, compatibility
  proof), else NOT_CODE_READY. Measure B3 after EVERY writer (git diff --numstat against the lane base: lines, files, migrations; the b3-measure.sh script of the session notes directory, outside the repo) and compare with the lane block's caps: a crossing is a ruling request BEFORE the next writer.
  Run cap: the lane's Run cap cell in the plan's section 3 table (3 docs, 4 code P2, 6 P1, migration, money or public); the conductor may raise it by a ruling, never above 6 (Phase 4 common note C1, conductor brief, outside the repo); only the owner raises a cap above 6 (the plan's section 3 Run cap note).
ENABLEMENT: the committed defaults of OUTBOX_DISPATCH_SCHEDULE_ENABLED and GENDER_COLLECTION_ENABLED are true (DD-141). The projectors web_realtime, zalo_dm and public_sessions are seeded disabled (migration 0056). Agents enable a projector only with scripts/outbox-projector-enable.mjs, and only inside a local test process or a local scratch database, for tests, measurements and the golden path. Enabling for real use (a real Zalo bot token, real users) is the owner's P0 step.
ENVIRONMENT: one shared local Postgres (compose) and one e2e port => one lock: never two DB suites, migrations or e2e runs at once; every DB suite, migration and e2e run goes through the conductor's lock file status/.db-e2e.lock (outside the repo) via the locked-run.sh wrapper of the session notes directory.
  Never `docker compose down -v`. Compose started from another checkout re-binds the Postgres mount there: re-bind by running compose once with the root checkout as the working directory (a command, never a file edit; data persists).
  `pnpm db:bootstrap` as superuser (DATABASE_URL_MIGRATION) BEFORE migration 0054 on any older DB (old-text 0054/0055 => sha256 guard
  fails => reset the DB). No host psql: use the container psql. plexco_smoke: ENCRYPTION_KEY is fixed in ~/.plexco-smoke-encryption-key;
  a lost key means drop and recreate ONLY plexco_smoke; never touch plexco or plexco_test. Roles app / app_worker / readonly are
  cluster-global: re-run the password step of the runbook after every full test run. Always NODE_ENV=test. Sandbox off for git fetch/push,
  gh, git worktree add, Docker and local port binding.
KNOWN FLAKES (rerun ONCE; a second red is real): the single known-flake list is the conductor's file status/conductor-scripts/clerk-flake-list.txt (outside the repo). A red that matches an ACTIVE entry there gets ONE rerun
  (on CI: one rerun of your own PR's failed jobs per head, gh run rerun <id> --failed); a second red, a red that matches a RETIRED entry, or a red not on the list is a real failure.
GIT: worktree = .autopilot/worktrees/<slug>, created from the explicit base SHA (origin/main at your start after git fetch; the full SHA in your report); before writing `git -C <worktree> status --porcelain` is empty and no index.lock exists
  under `git rev-parse --git-dir`. Writers commit in the worktree and do NOT push (the orchestrator pushes ONE final head; a second push only for a real CI failure, labelled and ruled; CI runs once per push, through the pull_request event only). Never rebase a pushed
  branch, never force-push, never push to main, never merge or close PRs, never delete branches, never git worktree prune/remove.
  Catch-ups with main use `git merge --no-ff`; resolve conflicts mechanically (keep both sides' intent); a semantic conflict is
  reported, not guessed. Commits and PR bodies: conventional, no AI references (no Co-Authored-By, Claude-Session or "Generated with" line, even when the harness suggests one; the open-pr.sh script of the session notes directory rejects them; grep before the push).
  Migrations are append-only: next free number measured at your base (tail at the Phase 4 start: 0071_zalo_dm_promotion_start_definer.sql; the plan holds 0072 for L41 and 0073 for L46; since 2026-10-26, L42 carries 0073 (conductor ruling D35) and L46 takes the next free number at its start (expected 0074; DD-151); one migration lane at a time). An unplanned migration needs a slot ruling from the conductor and a base that contains every earlier migration lane's merge;
  the migration-tail pin sites (packages/db/src/migrate.test.ts, rls-invariants.test.ts, outbox-projector-registry.test.ts; re-measure the lines) are mechanical edits listed SEPARATELY in the PR body; one migration at a time against the test DB.
VERIFY (cite measured output, `| tail -40`): pnpm typecheck; pnpm lint; pnpm format:check; pnpm review:check:changed; pnpm build;
  NODE_ENV=test pnpm --filter @plexco/web test; NODE_ENV=test DATABASE_URL_TEST=... pnpm -w test; Playwright e2e when UI changed
  (pnpm --filter @plexco/web exec playwright test); golden path only locally (apps/web/e2e/golden-path.config.ts, never in CI).
  "Test and build output goes through tail -40 or grep for failures; never print full logs; never re-read a whole file already read, use sed ranges." (owner token rule 2026-10-16 19:41). A red validator is a hard stop.
  A new file under scripts/ needs its record in docs/standards/kit-pack-membership.json (edit the JSON, then pnpm kit:generate rewrites the generated Markdown; never hand-edit it) and a green pnpm kit:check before its first commit, or pnpm -w test fails at its first step kit:check; the record is in scope for any lane that adds a script: list both files in FILES IN SCOPE.
  CI-only failures, checked before the first push: a test that loops over every Unicode scalar (or similar) stays at or below about 3 s locally, split per position and per mirror, each with an explicit 30_000 budget, never a raised budget (CI ran one 3.1x slower than locally;
  after the first CI run read those durations and keep a 2x margin); no RegExp built from data (new RegExp(variable)): Semgrep CE blocks it, so use string checks or toMatchObject, never a suppression comment. Semgrep CE runs in CI only.
  Golden path and the dev-login network-exposure probe: the probe re-measures every request, so record each run with the measured interface facts (ifconfig names, flags, addresses); a run that cannot start is written NOT RUN with the reason, never a pass; the probe is never weakened or bypassed.
CI GREEN: on the PR, verify, e2e-web, Semgrep CE and the OSV dependency diff pass, the OSV full dependency scan is skipped, and every other check is pass or skipping. On main the full scan runs and was green at the Phase 4 base (Security run 40226121651): a red full scan is a real failure.
IMPACT: GitNexus impact before editing a symbol and detect_changes before every commit; if GitNexus is unavailable or its index is stale, a grep of callers
  stated in the PR body is the fallback. Report blast radius; warn on HIGH or CRITICAL in your report and in the PR body.
LANGUAGE: code comments, commit messages, PR bodies, prompts and reports in English; user-facing copy as real t(vi, en) pairs; owner-facing docs (docs/standards/decisions.md, docs/sessions/*-plan.md and *-status.md, docs/product/*) keep Vietnamese prose with the owner's words quoted verbatim in the language the owner wrote them; agent-facing docs and every text block of a RUN or prompt doc are English.
  Check a file with text blocks by piping the awk of the CLAUDE.md language section into grep -E with the same letter class under a UTF-8 locale (LC_ALL=en_US.UTF-8), from a script file, after a control proves that this grep matches a letter of the class and rejects its unaccented base letter: the verbatim grep -P pipeline is a false pass on macOS (BSD grep rejects -P, exits 2 and prints nothing). The class misses uppercase letters, every letter with two marks and ten lowercase letters with one mark (the tilde and dot-below forms of e, i, o and u, and the hook and tilde forms of y), so a reviewer also reads the text blocks.
DOCS LANES: dated lines and dated rows are history and are never rewritten (fix current-state claims; add at most ONE new dated line to a status doc); a lane that flips its OWN backlog row writes no PR number or SHA (point at the measurement: gh pr list --state merged --head <branch>); every PR number, SHA, run id and time comes from gh or git, never from memory; an out-of-scope finding follows SCOPE.
CONTEXT (owner token rule 2026-10-16 19:41, verbatim): "A worker stops when its own context passes about 200k tokens or after about 80 tool calls: it commits what is done (or records the exact uncommitted state), writes a short handoff (next step, files, exact commands) in the session notes, and returns. The orchestrator then starts a FRESH worker with the same model and effort from that handoff. No worker runs past about 250k."
  The rule changes no model, effort or review rule. A fresh worker starts at about 106-205k plus its brief, so every unit gets a LEAN brief (the file path, line ranges, a numbered list of edits or claims, the commands; input under about 40k tokens; about 12 tool calls); one file or one section per writer.
  An agent that stops with a 429, a network error or "Not logged in" does nothing more; the conductor resumes it.
ORCHESTRATOR (context only for a worker): create the session notes directory (the conductor's status/<session>-notes, outside the repo), copy the scripts you need from the latest notes directory, adapt the session id, the brief path and the worktree slug, and read each script before you run it.
  Send a worker the stop notice at about 185k at its first tool round after its brief read and the hard stop by SendMessage before 240k (a message lands only at the worker's next tool round; TaskStop is refused to orchestrators); never message a worker that has handed back unless you mean to resume it.
  Measure your context with the conductor's corrected measure (status/conductor-scripts/agent-ctx-true.sh, outside the repo), never estimate it; your agent id is the newest row of bash status/conductor-scripts/agent-status.sh 30 | grep 'ORCHESTRATOR for session <session>' (outside the repo); never write an agent id into the report before its spawn result returned; hand back at about 340k corrected context or 20 worker results with CHECKPOINT + NEXT and RESULT: CONTINUE, with no worker running; start a later run lean (CHECKPOINT, NEXT and the conductor's handoff).
  After a usage-limit pause, an agent above about 250k context is replaced by a fresh agent with the same model and effort from its checkpoint or handoff, never resumed with SendMessage (owner resume rule 2026-10-16 20:40; S4 of this RUN doc).
TOOLS (owner tool-hygiene rule 2026-10-16 20:46, verbatim): "never wrap commands in bash -c or sh -c; run each command directly, as separate Bash calls if needed; put any awk or shell logic in a small script file under the session notes folder and run that file. Inline -c scripts trigger a manual safety prompt even in bypass mode."
  The same holds for zsh -c, python -c, python3 -c, node -e and perl -e, inline shell loops, awk programs and heredocs: run a script as bash <file> or awk -f <file> <input>, never with a secret in it. The Bash tool's shell is zsh, so a bash-only snippet typed inline misbehaves: use a script file.
REPORT: STATUS: done | partial | blocked / HEAD: <full sha> / CHANGED / CHECKS: <command> -> pass|fail / OPEN; a worker report is at most 8 lines. Orchestrator last line
  per PR: MERGE_READY #<n> head=<full 40-char sha> by=<S> (checked with git rev-parse and gh pr view). Last line of a session report: RESULT: DONE | CONTINUE | AWAIT | BLOCKED.
  The session report is the conductor's file status/<session>-report.md (outside the repo), with a CHECKPOINT and a NEXT section that a fresh orchestrator can follow, kept current after every worker result.
CONDUCTOR GATE (S4 of this RUN doc, after your hand-back): head = your MERGE_READY sha; the PR is MERGEABLE/CLEAN; its file list is exactly the lane's files; CI GREEN as above; 0 attribution markers in commits and body; the body (under 62,000 characters) carries the waiver line of REVIEW, the LABELS, every default, the B3 counts, every deviation, every labelled fix and the lead corrections; every claim of your report that can be re-measured is re-measured (the conductor reads the diff itself).
```

## S2. Mục lục lane L39..L55 và khuôn lane block

Mục lục lane của Phase 4 lấy từ bảng lane PLAN §3 và bảng session PLAN §7 (PLAN = `docs/sessions/web-mvp-phase4-plan.md`): các ô Slug (rủi ro), Dòng backlog, Phụ thuộc, Migration và Run cap chép nguyên văn từ PLAN §3; số migration là dự kiến, lane đo lại số kế tiếp còn trống tại base của mình (append-only, PLAN §3).
Đây là mục lục, không phải lane block: lane block do conductor viết cho từng session theo khuôn ở khối cuối mục này.

| Lane | Slug (rủi ro) | Dòng backlog (PLAN §3) | Session (PLAN §7) | Phụ thuộc (PLAN §3) | Migration (PLAN §3) | Run cap (PLAN §3) |
|---|---|---|---|---|---|---|
| L39 | p4-web-share-page (P2, public) | `web-public-session-share-page` (C1) | P4-S1 | không | không (cần SQL ⇒ ruling) | 6 |
| L40 | p4-web-player-leave (P2) | `web-player-leave-and-cancel` (C2) | P4-S2 | không | không | 4 |
| L41 | p4-name-definers-and-rule-tests (P1) | `member-name-definers-qualify-builtins`, `member-name-rule-residual-precision`, `ci-node-unicode-version-vs-name-rule-sets` (R1-5); comment `.github/workflows/ci.yml:130` của `docs-drift-sessions-fe-zalo-tech-readme-pins` (mục 5, chuyển từ L51) | P4-S2 | L55 | 0072 | 6 |
| L42 | p4-name-rules-db (P2; P1 nếu thêm CHECK) | `name-fields-one-visible-check-one-length-rule` (phần DB), `tenant-repo-sessions-create-area-venue-strip` | P4-S3 | L41 | không (Q4 c) | 4 |
| L43 | p4-name-rules-web (P2) | `name-fields-one-visible-check-one-length-rule` (phần web), `name-readers-null-name-one-fallback`, `club-create-sql-22023-maps-to-400` | P4-S6 | L42, L49 | không | 4 |
| L44 | p4-zalo-dm-deadline-and-clock (P2) | `zalo-dm-send-deadline-into-deliver`, `zalo-dm-attempt-budget-monotonic-clock` | P4-S3 | không | không | 4 |
| L45 | p4-zalo-dm-routable-list-and-cycle-tests (P2) | `zalo-dm-routable-event-types-one-list`, `bot-zalo-dm-cycle-tests-isolation-and-cells`, `owner-cli-pg-client-inside-try`, `bot-queues-outbox-schedule-default-comment` | P4-S4 | L44 | không | 4 |
| L46 | p4-outbox-lease-clock (P1) | `projector-delivery-batch-lease-clock-consistency` | P4-S5 | L45; L41 (thứ tự số) | 0073 | 6 |
| L47 | p4-zalo-error-mapping-fakes (P2) | `zalo-outbound-error-mapping-real-bot-verification` (chỉ nửa fake, C3), `zalo-connect-bot-revoked-error-mapping` | P4-S6 | L45 | không | 4 |
| L48 | p4-session-commands-authz-recheck (P1) | `session-commands-actor-recheck-under-lock` | P4-S4 | L42 (lane có thể sửa cùng file service: strip mà L42 phải dùng lại là `stripPublicNames`, không export, chỉ có trong `packages/db/src/session-service.ts:124`; dòng ghi "serialize against any other lane touching session-service.ts", `docs/autopilot-backlog.md:5756`) | không | 6 |
| L49 | p4-web-command-id-persistence (P2, tiền) | `web-command-id-persistence-and-conflict-copy`, `web-api-client-timeout-and-refresh-notice-focus` | P4-S5 | L40, L48 (cùng `apps/web/lib/session-command-route.ts`) | không | 6 |
| L50 | p4-public-proof-harness (P2) | `public-card-proof-port-preflight-any-owner`, `public-card-proof-no-drop-line-exception-complete`, `local-smoke-step11-latest-result-depin` | P4-S3 | không | không | 4 |
| L51 | p4-docs-spec-sync-be (P2, docs) | `docs-sync-phase3-owner-decision-spec-follow-ups` (phần BE, C4), `docs-drift-sessions-fe-zalo-tech-readme-pins` | P4-S1 | không | không | 3 |
| L52 | p4-docs-spec-sync-product-fe (P2, docs) | `docs-sync-phase3-owner-decision-spec-follow-ups` (phần product/FE, C4) | P4-S2 | không | không | 3 |
| L53 | p4-docs-runbooks-start-here (P2, docs) | `start-here-docs-outbox-flag-and-enable-path`, `outbox-runbook-zalo-dm-expiry-wording`, `name-strip-migrations-apply-with-writers-drained` | P4-S6 | L46 | không | 3 |
| L54 | p4-deps-advisory-watch (P1, deps) | `braces-ghsa-vfj7-ignore-expiry-2026-12-21`, `braces-ghsa-vfj7-no-fixed-version`, `pnpm-workspace-postcss-override-inert` | P4-S7 | cửa sổ 2026-12-01..2026-12-14, chạy một mình | không | 6 |
| L55 | p4-db-test-hygiene (P2, test) | `db-test-role-isolation-guard-residual-p3s`, `db-test-link-code-ttl-upper-bound-host-clock-flake`, `db-test-nonsuperuser-owner-bootstrap-jobd-before-chat-slot-hold-and-wait` | P4-S1 | không | không | 4 |

L56 và L57 không chạy (owner trả lời Q2 và Q3 theo default, DD-150) nên bảng không có hàng cho hai lane này; L58 (DD-150 và RUN doc này) là lane của conductor cho blocker B2 (PLAN §11) và hàng "RUN doc Phase 4" của PLAN §9, không phải một hàng của PLAN §3.

```text
LANE BLOCK FORMAT (conductor-authored per session; fields in this order)
LANE: <id> <slug>, as in the S2 index.
GOAL: the lane's numbered outcomes and nothing beyond them.
MILESTONE / RISK / B3 (one line): the milestone; the risk class (P1 or P2) with its reason; the B3 budget (PLAN section 3: about 300 LOC, 3 modules, 1 migration) or the exception the conductor pre-approves here; any other excess needs a B3 exception at step 0.
BASE: origin/main at the lane's start after git fetch, recorded as a full 40-character SHA.
WORKTREE / BRANCH (one line): .autopilot/worktrees/<slug> and the lane branch.
DEPENDS ON: the PRs or lanes that must be merged on main first (hard; checked with gh and git) and what may run beside the lane.
MIGRATION SLOT: the planned number (the real number is the next free one at the lane's base, append-only) or none.
OWNER DECISIONS NEEDED: the owner decisions the lane waits for, or none and the DD that settled them.
MODELS: model and effort per role (step-0 readiness reviewer, each writer, reviewer, security reviewer when required), passed explicitly on every Agent call; never fable.
FILE OWNERSHIP: the exact files, and the parts of shared files, the lane may change; nothing else.
STEP-0 QUESTIONS: the numbered questions the readiness reviewer answers from the named files and commands only, at most 60 tool calls per part.
NEGATIVE SCOPE: what the lane must not change, naming the tempting but forbidden items.
THREAT MODEL: required for P1 lanes; a P2 lane block may carry one too: the threats the lane's change must hold against.
DEFAULTS (optional): the values the lane applies where no source decides, each "default applied, pending owner sign-off".
TESTS: the tests the lane adds or changes and the suites and checks it runs.
ACCEPTANCE COMMANDS: the exact commands whose measured output proves DONE WHEN; per-lane commands live here, not in this RUN doc.
REVIEW PLAN: the reviewer role, model and effort, its area units, at most 3 rounds counting pre-push rounds, and the security round when required.
STOP: the HALT, ruling-request and BLOCKED conditions.
DONE WHEN: the binary end state, ending with MERGE_READY #<n> head=<full 40-char sha> by=<session>.
Lane blocks are written by the conductor per session from fresh leads; each lane's step-0 readiness file is its repo record; this RUN doc holds no lane block.
```

## S3. Sessions P4-S1..P4-S7

Thứ tự từ 18:32 (luật đồng thời ở S0, DD-151; decided by the conductor under the owner's delegation of 2026-10-22, not an owner signature): từng lane một, mỗi lane từ lúc khởi động tới lúc merge, theo một thứ tự topo của PLAN §4: L50 (PR #122, đã merge) -> L59 -> L42 -> L44 -> L48 -> L45 -> L46 -> L49 -> L47 -> L53 -> L43 -> golden path do một verifier độc lập chạy -> L54 trong cửa sổ 2026-12-01..2026-12-14; migration từng cái một: L42 = 0073, L46 = số trống tiếp theo lúc lane bắt đầu (dự kiến 0074). Các sóng và "tối đa 3 lane sống" của PLAN §4 (PLAN:99, :100) và §7 (PLAN:147) không còn áp cho lần khởi động nào sau 18:32 (plan giữ nguyên); các block session bên dưới vẫn là khung gom lane, chạy từng lane một theo thứ tự này.

**Ước lượng (tính lại 2026-10-26 theo luật đồng thời)**: số giờ của mỗi lớp lane lấy ở bảng PLAN §6 (số đo của Phase 3; trỏ tới, không chép lại). Sau khi PR #122 merge còn: lớp nặng (P1, migration) khoảng 7.7 h cho L42 (nay mang migration 0073 theo ruling D35), L46, L48, L49 = 30.8 h; lớp code P2 3-7 h cho L43, L44, L45, L47 = 12-28 h; lớp docs 0.7-7 h cho L53, L59 = 1.4-14 h.
Các lane nay chạy nối tiếp nên số giờ cộng dồn (không còn đường găng theo sóng): 44.2-72.8 h; chờ usage limit theo tỉ lệ của PLAN §6: 11.1-19.4 h, và vì luật này làm giảm tốc độ tiêu thụ nên đầu thấp có thể là 0; còn lại 44.2-92.2 h, tức 1.8-3.8 ngày chạy liên tục, cộng L54 3-7 h trong cửa sổ 2026-12-01..2026-12-14.
Đã qua 16 h 20 min từ 02:25 (bản duyệt, DD-150) tới lúc PR #122 merge (18:45:12), với 8 lane đã merge; cả Phase 4 không tính L54: 60.5-108.5 h, so với 46-57 h PLAN §6 ghi cho 16 lane trong sáu sóng. Không tính (như PLAN §6): login hết hạn, AWAIT chờ owner, mất mạng. Không hứa lịch. (giả định của L59: default applied, pending owner sign-off)

P4-S1 đã chạy (trước 18:32) theo thứ tự thực tế: P4-S1a = L55 và P4-S1b = L39 chạy song song với P4-S0b (DD-150 và RUN doc này), P4-S1c = L51 sau khi L58 merge (decided by the conductor under the owner's delegation of 2026-10-22, not an owner signature); PLAN §7 giữ nguyên điều kiện bắt đầu của nó, RUN doc chỉ trỏ tới, không sửa plan.
Mỗi block là khung của một session: conductor ghép nó với khối S1 và các lane block viết mới cho session đó (như S3 của RUN doc Phase 3).

```text
SESSION P4-S1    ORCHESTRATOR: one fresh orchestrator per lane, opus at max effort; workers per the lane block MODELS; never pass model fable to any Agent call
LANES: L55 (opus) · L39 (opus) · L51 (sonnet)
REGIONS: test DB · web public · docs BE
STARTS WHEN: B1 (PLAN section 11) done and `main` contains the plan PR (#114); as run: L55 (P4-S1a) and L39 (P4-S1b) beside P4-S0b, L51 (P4-S1c) after L58 merges (decided by the conductor under the owner's delegation of 2026-10-22, not an owner signature)
RUN CAPS: 4 · 6 · 3
SECURITY ROUND: L39 (opus/max)    MIGRATION: none    MERGE: the Phase 4 merge clerk after CI green and the conductor's S4 gate; PR #50 untouched
```
```text
SESSION P4-S2    ORCHESTRATOR: one fresh orchestrator per lane, opus at max effort; workers per the lane block MODELS; never pass model fable to any Agent call
LANES: L41 (opus) · L40 (sonnet) · L52 (sonnet)
REGIONS: DB + migration 0072 · web · docs product/FE
STARTS WHEN: L55 merged (for L41)
RUN CAPS: 6 · 4 · 3
SECURITY ROUND: L41 (opus/max)    MIGRATION: 0072 (L41; the real number is the next free one at the lane's base, append-only)    MERGE: the Phase 4 merge clerk after CI green and the conductor's S4 gate; PR #50 untouched
```
```text
SESSION P4-S3    ORCHESTRATOR: one fresh orchestrator per lane, opus at max effort; workers per the lane block MODELS; never pass model fable to any Agent call
LANES: L42 (opus) · L44 (opus) · L50 (sonnet)
REGIONS: DB name rules · bot · harness
STARTS WHEN: L41 merged (for L42)
RUN CAPS: 4 · 4 · 4
SECURITY ROUND: L42 (opus/max; conductor ruling D35)    MIGRATION: 0073 (L42; conductor ruling D35, DD-151)    MERGE: the Phase 4 merge clerk after CI green and the conductor's S4 gate; PR #50 untouched
```
```text
SESSION P4-S4    ORCHESTRATOR: one fresh orchestrator per lane, opus at max effort; workers per the lane block MODELS; never pass model fable to any Agent call
LANES: L48 (opus) · L45 (opus)
REGIONS: DB session-service + web route · bot + scripts
STARTS WHEN: L42 merged (L48); L44 merged (L45)
RUN CAPS: 6 · 4
SECURITY ROUND: L48 (opus/max)    MIGRATION: none    MERGE: the Phase 4 merge clerk after CI green and the conductor's S4 gate; PR #50 untouched
```
```text
SESSION P4-S5    ORCHESTRATOR: one fresh orchestrator per lane, opus at max effort; workers per the lane block MODELS; never pass model fable to any Agent call
LANES: L46 (opus) · L49 (opus)
REGIONS: outbox + migration 0073 · web money
STARTS WHEN: L45, L41 merged (L46); L40, L48 merged (L49)
RUN CAPS: 6 · 6
SECURITY ROUND: L46, L49 (opus/max)    MIGRATION: the next free number at L46's base, expected 0074 (L42 carries 0073, DD-151; append-only)    MERGE: the Phase 4 merge clerk after CI green and the conductor's S4 gate; PR #50 untouched
```
```text
SESSION P4-S6    ORCHESTRATOR: one fresh orchestrator per lane, opus at max effort; workers per the lane block MODELS; never pass model fable to any Agent call
LANES: L47 (opus) · L53 (sonnet) · L43 (opus)
REGIONS: bot + web connect route + `zalo-ingress` DB · ops docs · web
STARTS WHEN: L45 merged (L47); L46 merged (L53); L42, L49 merged (L43; plus L47 if step 0 finds that the files of L47 and L43 intersect, PLAN section 4)
RUN CAPS: 4 · 3 · 4
SECURITY ROUND: none    MIGRATION: none    MERGE: the Phase 4 merge clerk after CI green and the conductor's S4 gate; PR #50 untouched
```
```text
SESSION P4-S7    ORCHESTRATOR: one fresh orchestrator per lane, opus at max effort; workers per the lane block MODELS; never pass model fable to any Agent call
LANES: L54 (opus), alone
REGIONS: deps, lockfile
STARTS WHEN: 2026-12-01; done before 2026-12-14
RUN CAPS: 6
SECURITY ROUND: none    MIGRATION: none    MERGE: the Phase 4 merge clerk after CI green and the conductor's S4 gate; PR #50 untouched
```

P4-S8 (có điều kiện: L56 rồi L57) không chạy vì owner trả lời Q2 và Q3 theo default (DD-150); golden path local chạy bằng một verifier độc lập sau P4-S6, trên `main` cuối (PLAN §7).

## S4. Ghi chú cho conductor

Cổng S4 sau mỗi hand-back, merge clerk, HEARTBEAT và cách phục hồi sau usage limit hoặc mất đăng nhập; các luật vận hành còn lại ở S1.

```text
S4 GATE (the conductor, after each hand-back, before the merge clerk): head = the lane's MERGE_READY sha; PR MERGEABLE/CLEAN; the file list is exactly the lane's FILE OWNERSHIP; CI green (verify, e2e-web, Semgrep and the OSV diff pass, the OSV full scan skipping); 0 attribution markers in commits and body; the body carries "Codex waived by owner 2026-10-12; reviewed by independent Claude subagent", the provenance labels of S1, the B3 counts, the deviations and the lead corrections; every claim of the report that can be re-measured is re-measured (the conductor reads the diff itself).
AFTER EACH MERGE: the conductor confirms main CI green on the merge before it starts a lane that depends on the merged one (as P4-S0b started only after the plan PR merged with main CI green).
MERGE CLERK: one for all of Phase 4 (PLAN section 7), sonnet at high effort as in Phase 3 (docs/autopilot-templates/web-mvp-phase3-2026-10-16-RUN.md:1262, S4 "Merge round"; kept by the owner routing rule of 2026-10-21); merges a lane PR (merge commit, in dependency order) only after CI green and the S4 gate, and only when no worker is live (owner rule 2026-10-26 18:32, RUN S0); one rerun of the PR's failed jobs per head for a flake on the single known-flake list (status/conductor-scripts/clerk-flake-list.txt, conductor side, outside the repo), a second red is real; never PR #50 (owner-only); orchestrators never merge, close PRs or delete branches.
HEARTBEAT: the conductor recreates it when Phase 4 starts and deletes it when Phase 4 ends (every lane merged, no agent running, no decision waiting for the owner); rule and sources in S0.
USAGE LIMIT (a 429 or a limit message from any agent): the agent that stopped does nothing more and the conductor resumes it (S1 CONTEXT); the conductor starts no new agent until the limit has passed and never changes a model silently.
  After the limit: an agent above about 250k context is replaced by a FRESH agent with the same model and effort from its CHECKPOINT or handoff, never resumed with SendMessage; at or below about 250k it resumes with SendMessage (owner resume rule of 2026-10-16 20:40); first check the worktree's git status and HEAD, uncommitted files and the DB/e2e lock; a fresh orchestrator counts toward the lane's run cap (PLAN section 7). Phase 3's choice "wait, or run now on opus/max" is dropped: every orchestrator already runs on opus at max effort and nothing runs on fable (owner routing rule of 2026-10-21).
LOGIN LAPSE ("Not logged in") or any other pause that is not a usage limit: resume with SendMessage as before (the conductor's reading of the same owner rule); a worker stopped by the token rule's limit always gets a fresh worker.
  Verify the disk before acting: the commits and HEAD of each worktree, the handoff files in the session notes directory, the last report's CHECKPOINT.
P3-S16 LESSONS: the durable ones are folded into S1 with their sources; this section adds none.
```
