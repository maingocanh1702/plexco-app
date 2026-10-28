# Web MVP Phase 5 - quy tắc vận hành và chỉ mục lane (L62-L79) · 2026-10-28

> **Mục đích:** RUN doc của Phase 5 (go-live) của Web MVP: quy tắc vận hành agent-facing, chỉ mục lane và block session cho 17 lane của `docs/sessions/web-mvp-phase5-golive-plan.md` (15 lane chắc chắn L62-L76 và 2 lane có điều kiện L77, L78; PLAN:12, §3) và lane L79 của conductor (DD-154 + RUN doc này). Plan hoãn RUN doc tới khi owner trả lời §5 (PLAN:5); tin nhắn duyệt viết của owner ngày 2026-10-28 (DD-154) là câu trả lời đó.
> Phần dẫn tiếng Việt cho owner; mọi khối `text` là English (agent-facing), không có dấu tiếng Việt.
>
> **NOT an authorization to code.** Authority = `docs/sessions/web-mvp-phase5-golive-plan.md` (merged as PR #134, merge commit `dced86d4237416822d98795f8c2a3a970c41444c`, `gh` mergedAt 2026-10-28T10:19:19Z) + the owner's written approval of 2026-10-28 (DD-154) + the per-lane CODE_READY verdict written in each lane's step 0.
> Plan mang marker review-readiness `enforce` (PLAN:3), loại marker không bao giờ cho phép code (CLAUDE.md, mục Review / Plan Readiness, luật 10), và chính plan ghi "không authorize coding" (PLAN:6); chỉ file readiness step 0 `CODE_READY` của một lane cho phép lane đó code. Chưa có verdict hoặc lane bị `NOT_CODE_READY` thì lane đó chỉ được AWAIT, không được viết code.
>
> **Quyết định owner -> số DD:** tin nhắn VIẾT của owner ngày 2026-10-28 "Phase 5 plan approved" (nguyên văn và trọn vẹn ở dòng AUTHORITY của S1 và ở DD-154) -> DD-154. Đây là quyết định của chính owner, không phải nhãn uỷ quyền. Chỗ tin nhắn khác default của plan (Q3, run cap của L65, L68, L74) thì tin nhắn thắng; câu "G4 does not wait for L54." trùng text hiện tại của plan, là xác nhận, không phải override (DD-154).
> Quy tắc nền: DD-132 và DD-04, mỗi entry đọc cùng bổ sung có ngày 2026-10-28 (DD-154) dưới nó, và các quyết định owner ở dòng PROGRAM FACTS của S1 (trỏ theo DD id, không chép lại).
> **Lưu ý cite:** `PLAN` = `docs/sessions/web-mvp-phase5-golive-plan.md`, `P4RUN` = `docs/autopilot-templates/web-mvp-phase4-2026-10-26-RUN.md`; số dòng của hai file đó đo tại `dced86d4237416822d98795f8c2a3a970c41444c` (lane L79 không sửa chúng). `decisions.md` đổi trong lane L79 (DD-154 chèn trên DD-153, hai bổ sung dưới DD-132 và DD-04), nên cite `decisions.md` theo DD id.

## S0. Phase 5 chạy như thế nào

Phase 5 chạy từ bốn nguồn: plan đã duyệt (PLAN, merged as PR #134), DD-154 (tin nhắn duyệt của owner, nguyên văn), RUN doc này (S1 quy tắc, S2 chỉ mục lane, S3 block session, S4 ghi chú cho conductor) và các session P5-S1..P5-S9 mà plan đặt tên (block của từng session ở S3). Conductor (session local của owner) -> **một orchestrator mới (opus/max) cho mỗi lane** -> workers. Mỗi lane = một branch + một worktree + một writer = một PR.

**Luật go-live của owner** (prompt Phase 5 của owner, nguyên văn, cả hai câu; áp cho mọi agent, mọi lane và mọi session của Phase 5; dòng GO-LIVE của S1 ghi cách áp). PLAN:23 chỉ chép câu đầu. Đo lại tại `ad71c441da8c06fb11d4c2dc33e22f501d439a26` bằng `git grep -F`: câu hai chỉ có ở file readiness step 0 của lane L79 (`docs/sessions/web-mvp-phase5-readiness-p5-dd-and-run-doc.md`:6), không liền với câu đầu; vì vậy RUN doc này là bản ghi đầy đủ đầu tiên của luật trong repo.

```text
Agents never create cloud resources, never read, print or store a secret value, never trigger a deploy, and never touch production data. A classifier denial is AWAIT with exact commands, never a workaround.
```

- **Luật đồng thời:** luật hiện hành là luật của owner 2026-10-27 16:46 (DD-153; nguyên văn ở P4RUN:26), áp cho mọi lần khởi động agent mới từ lúc đó (P4RUN:25), nên áp cả trong Phase 5: tối đa hai lane song song, chỉ ghép khi file không chồng nhau, mỗi lane một lane orchestrator và tối đa một worker, reviewer hoặc verifier sống dưới nó, tức tối đa bốn lane agent cộng một merge clerk; migration tuần tự; khoá DB/e2e tuần tự hoá mọi lần chạy DB và e2e; merge từng PR một theo thứ tự plan (P4RUN:26); ở Phase 5 thứ tự merge theo dòng MERGE ORDER của S1 (thứ tự các lane thật sự bắt đầu, khác thứ tự plan ở phần tách P5-S1, xem S4; conductor reading, the owner may correct it).
- **Thứ tự và điều kiện bắt đầu:** thứ tự session ở S3; phụ thuộc và run cap của từng lane ở bảng PLAN §3 (header PLAN:72) và S2. Không lane nào bắt đầu trước khi mọi phụ thuộc của nó đã merge vào `main`, và mỗi lane cần verdict `CODE_READY` riêng ở step 0 (PLAN:6; như P4RUN:33).
- **Orchestrator và worker:** conductor khởi động mỗi lane bằng một orchestrator riêng, mới, model opus effort max (luật routing của owner 2026-10-21); orchestrator không tạo orchestrator khác; worker theo trường MODELS của lane block; không agent nào chạy model `fable`. Mỗi lượt orchestrator mới tính vào run cap của lane, như ở Phase 4 (P4RUN:28; dòng RUN CAP của S1).
- **Merge:** một merge clerk cho cả Phase 5, model sonnet/high như ở Phase 3 và Phase 4 (P4RUN:29), merge từng PR một có dòng `MERGE_READY` khi CI xanh, theo thứ tự các lane thật sự bắt đầu (dòng MERGE ORDER của S1; S3 là thứ tự bắt đầu dự kiến); conductor chạy cổng S4 trước và sau mỗi lần merge.
- **HEARTBEAT:** conductor tạo lại cron HEARTBEAT khi Phase 5 bắt đầu và xoá nó khi Phase 5 kết thúc: mọi lane đã merge, không agent nào chạy, không quyết định nào chờ owner (bước 5 của luật heartbeat, như P4RUN:30). Nguồn: chỉ dẫn của owner ngày 2026-10-25.
- **Việc chỉ owner làm:** checklist ở PLAN §8 (PLAN:190; 12 bước 8.0-8.11, PLAN:16) và các gate go-live G1-G7 ở PLAN §9 (PLAN:234; PLAN:17): trỏ tới, không chép lại. Bản duyệt 2026-10-28 không giao bước nào trong đó cho agent; tài khoản, secret, console cloud, deploy và dữ liệu production là bước của owner (PLAN:11).
- **PR 50:** chỉ owner được động tới. GitHub đã tự đóng nó ngày 2026-10-28; owner quyết nó giữ trạng thái đóng hay được mở lại (DD-154, Hệ quả (k)); không lane nào checkout, rebase hay push nhánh của nó (PLAN:13).
- **Notes và bản ghi:** ghi chú, script và báo cáo của mỗi session nằm trong thư mục của conductor, NGOÀI repo; file tracked không cite các đường dẫn đó. Bản ghi trong repo của một lane là file readiness step 0 (`docs/sessions/web-mvp-phase5-readiness-<slug>.md`, dòng STEP 0 của S1) và PR của lane.
- **Lane L79:** lane của conductor (session P5-S0b) ghi DD-154 và viết RUN doc này; bảng lane của PLAN §3 (PLAN:74-90) phủ L62-L78 và không có hàng L79.

## S1. Quy tắc vận hành Phase 5

S1 của Phase 4 (P4RUN:36-131, khối `text` P4RUN:41-131) áp nguyên, không đổi, cho mọi việc Phase 5, trừ các dòng mà khối PHASE 5 dưới đây thay hoặc bổ sung (ADAPT), cộng các delta P1-P10 của Phase 5 (NEW, hoặc gắn vào dòng ADAPT tương ứng). Brief của mỗi worker là một file khoảng 10 KB trở xuống (dòng AGENT TYPE): các dòng bắt buộc, luật chạy của owner (nguyên văn), đúng một block lane, một dòng task, file output và luật dừng; khối PHASE 5, khối S1 của Phase 4 bỏ dòng đầu P4RUN:42 và khối ENABLEMENT (lặp lại P4RUN:87) chỉ được trỏ bằng đường dẫn và số dòng, không chép vào brief.
Mỗi dòng của khối ghi nguồn trong repo (`path:line` đo tại `dced86d4237416822d98795f8c2a3a970c41444c`, `decisions.md` theo DD id); dòng không có nguồn trong repo mang nhãn "conductor rule for Phase 5, decided by the conductor under the owner's delegation of 2026-10-22, not an owner signature". Cách trình bày S1 (trỏ tới S1 Phase 4 thay vì chép lại, gom ADAPT và delta vào một khối) là "decided by the conductor under the owner's delegation of 2026-10-22, not an owner signature".

```text
PLEXCO WEB MVP PHASE 5 - OPERATING RULES (a worker brief is one file of about 10 KB or less, see AGENT TYPE: the mandatory lines, the owner run rules verbatim, one lane block, one task line, its output file and its stop rule; it names by path and line range, never pastes, this block, the Phase 4 S1 block P4RUN:41-131 without its first line P4RUN:42, and the ENABLEMENT block of this doc, which repeats P4RUN:87)
SOURCES: PLAN = docs/sessions/web-mvp-phase5-golive-plan.md and P4RUN = docs/autopilot-templates/web-mvp-phase4-2026-10-26-RUN.md, lines measured at dced86d4237416822d98795f8c2a3a970c41444c; docs/standards/decisions.md is cited by DD id. Every Phase 4 S1 line that this block does not replace holds unchanged; where they differ, this block wins.
AUTHORITY (ADAPT, replaces P4RUN:43; delta P2): the owner texts printed in your brief are the authority and go verbatim into writer and reviewer briefs (verbatim means never paraphrased: a short owner text, such as the 2026-10-28 approval (DD-154) or the go-live rule, is pasted whole; a long rule block, such as the Phase 4 S1 block or the ENABLEMENT block, is named by path and line range, never pasted, see AGENT TYPE): the owner decisions of 2026-10-16, 2026-10-21, 2026-10-22 and 2026-10-24, the written approvals of 2026-10-26 (DD-150) and 2026-10-28 (DD-154), the concurrency rule of 2026-10-27 16:46 (DD-153), the go-live rule of the owner's Phase 5 prompt (S0 of this RUN doc), the token, resume and tool-hygiene rules, and the orchestrator routing rule of 2026-10-21; the newest owner text wins. The Phase 5 plan is PLAN (merged as PR #134).
  The written approval of 2026-10-28, verbatim: "Phase 5 plan approved. Q1, Q2, Q4-Q10 default. Q3 override: production starts without HA (shape 3, about 52 USD/month); the §7.6 failover drill runs on a temporary HA staging window (shape 4); upgrade production to HA before money flows or before adding more clubs. Raise the run caps of L65, L68 and L74 to 6. G4 does not wait for L54."
  Precedence: the owner's message, then the plan on main; where the message differs from a plan default (Q3 and the run caps of L65, L68 and L74) the message wins; "G4 does not wait for L54." confirms the current plan text and overrides nothing (DD-154).
PROGRAM FACTS (ADAPT, replaces P4RUN:60-63; pointers only: read the entry in docs/standards/decisions.md before you touch its area): the Phase 4 list of P4RUN:60-63 stays; DD-132 is read together with its dated addendum of 2026-10-28 (DD-154: the owner-triggered DigitalOcean deploy enters the scope, agents write only its config and deploy-workflow files) and DD-04 together with its dated addendum of 2026-10-28 (the Day-1 HA baseline as changed for the pilot phase); added: DD-151, DD-152 and DD-153 (the owner's concurrency rules; DD-153 is current) and DD-154 (the Phase 5 approval and the answers Q1-Q10).
  Dropped: the Phase 4 sentence "Local-only work: plan sections 2 and 8." (P4RUN:63); GO-LIVE below takes its place.
LABELS (ADAPT, adds to P4RUN:64-65; delta P2): the owner's written approval of 2026-10-28 (DD-154) is the owner's own decision, never a delegation label, and the answers Q1, Q2 and Q4-Q10 that it adopts from the plan no longer carry "default applied, pending owner sign-off" (DD-154); a lane's reading of an owner phrase that the owner did not define is "conductor reading, the owner may correct it", and a reading that only the owner can settle is named beside it with "the owner decides" (DD-154, consequence (c)).
STEP 0 (ADAPT, replaces the file name on P4RUN:80): the readiness file is docs/sessions/web-mvp-phase5-readiness-<slug>.md (the P4RUN:80 name with phase5, as in the L79 readiness file docs/sessions/web-mvp-phase5-readiness-p5-dd-and-run-doc.md); the rest of P4RUN:78-82 holds.
RUN CAP (ADAPT, replaces the Run cap line P4RUN:86; delta P7): the lane's Run cap cell in the PLAN section 3 table (header PLAN:72; rule PLAN:94: 3 for docs and research, 4 for code P2, 6 for P1, deploy config or a public surface), except L65, L68 and L74, which the owner raised from 4 to 6 (DD-154; PLAN:282); a lane at its cap stops until the cap is raised, and only the owner raises a cap above 6 (PLAN:282, risk 7); the conductor may raise a cap up to 6 by a ruling (conductor rule for Phase 5, decided by the conductor under the owner's delegation of 2026-10-22, not an owner signature).
ENABLEMENT (ADAPT, note to P4RUN:87, which stays verbatim in its own block below): in a real environment, enabling a projector is the owner's step 8.8 (PLAN:204, :216) and enabling a flag is an owner step too (PLAN:27); the plan's real-environment value of GENDER_COLLECTION_ENABLED is "false" (the staging and production App Specs of L66, PLAN:78; the first real-user environment, PLAN:76; G4, PLAN:17), so true (DD-141) is the committed default only, never the production value.
MIGRATIONS (ADAPT, replaces the numbers on P4RUN:102; delta P3): the tail at the Phase 5 base is 0074_projector_delivery_lease_clock.sql (git ls-tree at dced86d4237416822d98795f8c2a3a970c41444c; DD-154, consequence (g)); the plan expects one migration, the DB limiter of L73 (Q10 (i), the default the owner approved), at the next free number measured at its start (0075 if no other migration lands first), serialized and merged before the first staging deploy (PLAN:12, :85, :95; DD-154, consequence (g)); a lane that finds at step 0 that it needs a migration also takes the next free number and runs serialized (PLAN:95) and needs the slot ruling of P4RUN:102; never two migration lanes at once (DD-153); the rest of P4RUN:102-103 holds.
CI GREEN (ADAPT, replaces the last sentence of P4RUN:112): on main the full OSV dependency scan runs and must be green at your lane base: measure the newest Security run on main with gh (this doc pins no run id; the run id on P4RUN:112 is a Phase 4 measurement); a red full scan is a real failure. The braces advisory stays ignored until 2026-12-21 and G4 may pass before L54 merges, so production can run while that ignore is active (DD-154, consequence (h)).
STOP NOTICE (ADAPT, adds to P4RUN:122; delta P5): send a stop notice or a hard stop only to a unit that is provably live (its hand-back count is 0, counted as the SubagentHandback tool uses in its transcript, and its transcript grew within the last 60 s; print the to id in the same step as that check; otherwise send nothing and let the brief's own stop rule work); a message to a unit that has handed back resumes it (conductor rule for Phase 5, decided by the conductor under the owner's delegation of 2026-10-22, not an owner signature).
GO-LIVE (NEW, delta P1): the owner's go-live rule (S0 of this RUN doc, verbatim) binds every agent. Agents only write files in their own worktree and run local tests (PLAN:11, :25); a secret is named only by its variable NAME, never by its value (PLAN:25); an environment file, committed or not (.env.example included, PLAN:76), is read for variable NAMES only (for example cut -d= -f1, or a grep that prints only the name before =), never a value; no agent logs in to a vendor or cloud site, creates an account or submits a form (conductor rule for Phase 5, decided by the conductor under the owner's delegation of 2026-10-22, not an owner signature); a deploy workflow has only the manual workflow_dispatch trigger, never push, and only the owner runs it (PLAN:26); no agent opens a cloud console, runs doctl, creates a cloud resource or deploys (DD-154, the Q1 answer), and no agent runs gh workflow run or any other command that starts a deploy (the go-live rule); enabling a projector or a flag in a real environment, the section 7.6 drills, the legal steps and choosing and inviting the clubs are the owner's steps (PLAN:27; PLAN section 8, PLAN:190). A permission-classifier denial is AWAIT with the exact commands the owner must run, never a workaround (PLAN:28; the form of that AWAIT is P4RUN:46).
AGENT TYPE (NEW, delta P4): every unit (reader, writer, reviewer, verifier) runs as the code-reviewer agent type with its model passed explicitly, unless it needs a tool that type lacks (then general-purpose); the agent that starts a unit records its first-poll context. Every unit brief is one file of about 10 KB or less: the mandatory lines, the unit's task, its inputs as paths plus section names (rule blocks are named, never pasted), its output file and its stop rule (conductor rule for Phase 5, decided by the conductor under the owner's delegation of 2026-10-22, not an owner signature).
WEB ACCESS (NEW, delta P6): an agent uses the web only when its lane block names web access, and then only official vendor pages; every web fact is recorded with its URL, anchor, access date and a verbatim quote, the evidence form of L62's acceptance cell (PLAN:74); a page that does not open is recorded as "not re-checked", never filled from memory; a search-result summary is never evidence (label it "search summary, not confirmed on an official page") (conductor rule for Phase 5, decided by the conductor under the owner's delegation of 2026-10-22, not an owner signature).
MERGE ORDER (NEW, delta P8): the merge clerk merges one PR at a time (DD-153) in the order the lanes actually start (a lane enters the merge order when its orchestrator starts; S3 gives the planned start order); a lane that waits for an owner step or a gate (for example L66 waiting for G1) holds up no other lane's merge (conductor rule for Phase 5, decided by the conductor under the owner's delegation of 2026-10-22, not an owner signature).
PR BODY (NEW, delta P9): every PR body names its lane (L62-L79; for L62-L78 its PLAN section 3 row) and carries the line "Phase 5 plan approved, 2026-10-28" (the approval: DD-154), the waiver line of REVIEW (P4RUN:72; DD-122 D4) and no AI line (P4RUN:101); the lane line and the form of the approval line are a conductor rule for Phase 5, decided by the conductor under the owner's delegation of 2026-10-22, not an owner signature.
CLOSING KEYWORDS (NEW, delta P10): no PR body and no commit message puts a GitHub closing keyword (close, closes, closed, fix, fixes, fixed, resolve, resolves, resolved, in any case) directly before an issue or pull request number written with a hash sign, or before a GitHub issue or pull URL: GitHub then closes that item when the PR merges. After such a word write PR 50, never the hash form; grep the body and every commit message for the pattern before the push. Source: on 2026-10-28 GitHub closed PR 50 one second after PR #134 merged, because the PR #134 body had a closing keyword before that pull request's number (DD-154, consequence (k)). The rule is a conductor rule for Phase 5, decided by the conductor under the owner's delegation of 2026-10-22, not an owner signature; DD-154 (k) is the source of the incident only.
```

Dòng ENABLEMENT của S1 Phase 4 (P4RUN:87), nguyên văn, trong khối riêng (dòng ENABLEMENT của khối PHASE 5 ở trên ghi phần Phase 5 cho agent):

```text
ENABLEMENT: the committed defaults of OUTBOX_DISPATCH_SCHEDULE_ENABLED and GENDER_COLLECTION_ENABLED are true (DD-141). The projectors web_realtime, zalo_dm and public_sessions are seeded disabled (migration 0056). Agents enable a projector only with scripts/outbox-projector-enable.mjs, and only inside a local test process or a local scratch database, for tests, measurements and the golden path. Enabling for real use (a real Zalo bot token, real users) is the owner's P0 step.
```

Ngoài khối, cho Phase 5: bật projector ở môi trường thật là bước 8.8 của owner (PLAN:204, chi tiết ở PLAN:216), bật cờ ở môi trường thật cũng là bước của owner (PLAN:27); giá trị PRODUCTION của cờ giới tính theo plan là `"false"` (App Spec staging và production của L66, PLAN:78; môi trường người dùng thật đầu tiên, PLAN:76; G4 "giới tính tắt", PLAN:17), nên "true (DD-141)" trong khối chỉ là default đã commit, không phải giá trị production.

## S2. Mục lục lane L62..L79 và khuôn lane block

Mục lục lane của Phase 5 lấy từ bảng lane PLAN §3 (header PLAN:72, hàng L62-L78 ở PLAN:74-90) và bảng session PLAN §7 (PLAN:176-186). PLAN §3 không có cột Session hay Migration (PLAN:72), nên cột Session lấy từ PLAN §7 và cột Migration từ PLAN:85 và PLAN:95. Ô Dòng backlog ghi slug của dòng mà PLAN §3 trỏ bằng số dòng (slug đọc tại `dced86d4237416822d98795f8c2a3a970c41444c`; số dòng của backlog đổi mỗi khi file đổi, slug thì không) và viết "PR 50" thay cho dạng có dấu thăng của plan (dòng CLOSING KEYWORDS của S1). Ô Run cap chép PLAN §3, trừ L65, L68 và L74: owner nâng từ 4 lên 6 (tin nhắn duyệt viết của owner ngày 2026-10-28, DD-154; đó là phương án nâng cap của rủi ro 7, PLAN:282). Cột Phụ thuộc là phụ thuộc cứng của PLAN §3; điều kiện chờ khác (gate, bước owner) ở ghi chú dưới bảng và ở S3.
Đây là mục lục, không phải lane block: lane block do conductor viết cho từng session theo khuôn ở khối cuối mục này.

| Lane | Slug | Dòng backlog (PLAN §3) | Session (PLAN §7) | Phụ thuộc (PLAN §3) | Migration (PLAN:85, :95) | Run cap |
|---|---|---|---|---|---|---|
| L62 | p5-egress-research | `infra-egress-compatibility-evidence` (blocked) | P5-S1, chạy là P5-S1a | không | không | 3 |
| L63 | p5-deployment-infra-drift | không có dòng (đo ở PLAN §2) | P5-S6 | không | không | 3 |
| L64 | p5-env-manifest | không có dòng | P5-S4 | không | không | 3 |
| L65 | p5-staging-tooling-port | PR 50 hàng 5-9, 17, 25 | P5-S1, chạy là P5-S1b | không | không | 6 (owner; PLAN §3: 4) |
| L66 | p5-app-specs | `infra-do-app-vpc-deployment` (P0); PR 50 hàng 3, 4, 22 | P5-S2 | L62, L65 | không | 6 |
| L67 | p5-deploy-workflows | `infra-do-app-vpc-deployment`; PR 50 hàng 1, 2 (hàng 10 sang L74) | P5-S3 | L66 | không | 6 |
| L68 | p5-log-correlation | `request-id-log-context-auth-onboarding`, `observability-sentry-loglevel-readers`; PR 50 hàng 11-15 | P5-S6 | không | không | 6 (owner; PLAN §3: 4) |
| L69 | p5-runbook-deploy-migration-rollback | `infra-do-app-vpc-deployment`; PR 50 hàng 18, 20 | P5-S4 | L67 | không | 3 |
| L70 | p5-runbook-backup-pitr-drills | `backup-pitr-drill` (planned); PR 50 hàng 19 | P5-S5 | không | không | 3 |
| L71 | p5-runbook-outbox-staging-prod | không có dòng | P5-S7 | không | không | 3 |
| L72 | p5-hardening-headers-csp | `next-config-route-header-precedence-claim`, `public-share-page-header-level-referrer-and-robots`, `web-public-share-page-404-production-measurement`; có điều kiện `offline-page-csp-nonce-missing` | P5-S5 | không | không | 6 |
| L73 | p5-discovery-isolation-controls | không có dòng (§7.6 mục 6); O-6 | P5-S2 | không | limiter DB (Q10 (i)): số trống kế tiếp đo lúc lane bắt đầu, 0075 nếu chưa có migration nào land trước | 6 |
| L74 | p5-staging-smoke-golden-path | `golden-path-no-trigger-on-client-or-session-route-change` (gộp); PR 50 hàng 10 (từ L67) | P5-S3 | L65 | không | 6 (owner; PLAN §3: 4) |
| L75 | p5-privacy-terms-draft | không có dòng | P5-S7 | không | không | 3 |
| L76 | p5-pilot-host-guide | PR 50 hàng 21 | P5-S8 | không | không | 3 |
| L77 | p5-kms-aws-provider (P1, CÓ ĐIỀU KIỆN) | không có dòng (§7.6 mục 10) | P5-S9 | không | không | 6 |
| L78 | p5-db-tls-ca-verification (P1, CÓ ĐIỀU KIỆN) | `db-tls-ca-verification-do-managed-pg` (idea, P1) | P5-S9 | không | không | 6 |
| L79 | p5-dd-and-run-doc (lane của conductor) | không phải hàng của PLAN §3 | P5-S0b | B1 (tin nhắn duyệt của owner, DD-154) và PR #134 đã merge | không | 4 (cap của conductor cho lane của chính nó, nâng từ 3 sau một lần dừng vì usage limit; không phải cap của PLAN §3; decided by the conductor under the owner's delegation of 2026-10-22, not an owner signature) |

- L66 còn chờ G1 PASS (PLAN:78, :179); tới lượt L66 mà G1 chưa PASS thì conductor chạy lane sẵn sàng kế tiếp, và L66, L67, L69 lùi theo G1 (PLAN:174).
- L74 bắt đầu khi L65 đã merge (PLAN:180); tài khoản Google test của owner (bước 8.3, PLAN:199) chỉ chặn lần chạy staging spec của L74 ở bước 8.6 (gate G2), không chặn lane, vì nghiệm thu của L74 là local (PLAN:86): "8.3 gates G2's staging run, not the start of L74" (decided by the conductor under the owner's delegation of 2026-10-22, not an owner signature).
- L77 và L78 có điều kiện (PLAN:89, :90, :186): L77 chỉ khi input KMS của owner (Q8) cần đổi code; L78 chỉ khi owner đã tạo Managed PostgreSQL (PLAN §8).
- Lane khác thấy cần migration ở step 0 thì lấy số trống kế tiếp và chạy tuần tự (PLAN:95; dòng MIGRATIONS của S1).
- L79 (DD-154 và RUN doc này) là lane của conductor, theo quyết định D46 của conductor (decided by the conductor under the owner's delegation of 2026-10-22, not an owner signature), không phải một hàng của PLAN §3 (PLAN:74-90), như L58 ở Phase 4 (P4RUN:158).

```text
LANE BLOCK FORMAT (Phase 5): the Phase 4 format P4RUN:160-182 holds unchanged, fields in this order: LANE, GOAL, MILESTONE / RISK / B3 (one line), BASE, WORKTREE / BRANCH (one line), DEPENDS ON, MIGRATION SLOT, OWNER DECISIONS NEEDED, MODELS, FILE OWNERSHIP, STEP-0 QUESTIONS, NEGATIVE SCOPE, THREAT MODEL, DEFAULTS (optional), TESTS, ACCEPTANCE COMMANDS, REVIEW PLAN, STOP, DONE WHEN.
In those lines PLAN is the Phase 5 plan: LANE = the id and slug of the S2 index; B3 = PLAN:93 (about 300 LOC, at most 3 modules, at most 1 migration); MIGRATION SLOT follows the MIGRATIONS line of S1.
Lane blocks are written by the conductor per session from fresh leads; each lane's step-0 readiness file is its repo record; this RUN doc holds no lane block.
```

## S3. Sessions P5-S0b..P5-S9

Thứ tự của plan: bảng session PLAN §7 (PLAN:176-186; nhóm session và model writer là "default applied, pending owner sign-off", PLAN:188): P5-S1 ghép L65 với L62 (PLAN:178), rồi P5-S2..P5-S8 theo bảng, P5-S9 (L77 rồi L78) có điều kiện (PLAN:186). Chuỗi G2 đi trước: L65 -> L66 -> L67 -> L69 (PLAN:174); tới lượt L66 mà G1 chưa PASS thì conductor chạy lane sẵn sàng kế tiếp, và L66, L67, L69 lùi theo G1.

Thứ tự bắt đầu của conductor (quyết định D46; decided by the conductor under the owner's delegation of 2026-10-22, not an owner signature), nguyên văn tới dấu chấm phẩy trước mệnh đề cuối; mệnh đề cuối trỏ tới file thứ tự merge của conductor, nằm ngoài repo, và luật của nó là dòng MERGE ORDER của S1:

```text
(3) start order under C22: L79 and L62 first (the egress research gates G1, and a YES or UNRESOLVED-with-fallback result would re-plan the DigitalOcean-specific part of L65 under Q7), L65 when the first of them merges, then the plan's session order, running ready lanes while L66 waits for G1;
```

Hai thứ tự chỉ khác nhau ở P5-S1: plan ghép L65 · L62 (PLAN:178); conductor chạy L79 (P5-S0b) và L62 (P5-S1a) trước, rồi L65 (P5-S1b) ở khe trống đầu tiên, tức khi lane đầu tiên trong hai lane đó merge. PLAN §7 giữ nguyên điều kiện bắt đầu của nó; RUN doc chỉ trỏ tới, không sửa plan. Thứ tự merge là thứ tự các lane thật sự bắt đầu (dòng MERGE ORDER của S1); thứ tự trên là thứ tự bắt đầu dự kiến.

**L74 và bước 8.3** (decided by the conductor under the owner's delegation of 2026-10-22, not an owner signature): L74 bắt đầu khi L65 đã merge (PLAN:180); tài khoản Google test của owner (bước 8.3, PLAN:199) chặn lần chạy staging spec của L74 ở bước 8.6 (PLAN:202, gate G2), không chặn lane; nghiệm thu của L74 là local (PLAN:86); ô Chờ của PLAN:86 ghi "tài khoản Google test (8.3)", tức thứ lane cần (PLAN:70), và ô chặn của 8.3 ghi gate G2 (đăng nhập thật thay dev-login của L74), không ghi lần bắt đầu của lane (PLAN:199). Câu cho agent, ở block P5-S3: "8.3 gates G2's staging run, not the start of L74".

**Hình dạng staging của G2** (default applied, pending owner sign-off): plan không nói staging của G2 dùng hình dạng nào, và override Q3 của owner chỉ đặt cửa sổ của drill failover §7.6 (lời owner nguyên văn ở DD-154). Default của conductor: MỘT staging tạm ở hình dạng HA (hình dạng 4), owner tạo ở G2, phủ G2 và G3 (smoke, golden path staging, các drill §7.6) trong cửa sổ 48-96 giờ của nó, rồi owner xoá; nếu G2 cần lâu hơn, owner có thể chạy G2 trên một staging không HA và chỉ tạo cửa sổ HA cho G3. Default này không quyết thêm gì khác.

```text
G2 STAGING SHAPE (default applied, pending owner sign-off): ONE temporary staging in the HA shape (shape 4), created by the owner at G2, covers G2 and G3 (smoke, staging golden path, the section 7.6 drills) within its 48-96 hour window, then the owner deletes it; if G2 needs longer, the owner may run G2 on a non-HA staging and create the HA window for G3 only. The owner's words are in DD-154 (the Q3 override); this line decides nothing else.
```

Mỗi block là khung của một session: conductor ghép nó với khối S1 và các lane block viết mới cho session đó (khuôn block của P4RUN:197-204).

```text
SESSION P5-S0b    ORCHESTRATOR: one fresh orchestrator per lane, opus at max effort; workers per the lane block MODELS; never pass model fable to any Agent call
LANES: L79 (the conductor's lane: DD-154 and this RUN doc; not a PLAN section 3 row)
REGIONS: docs only (the files of the lane block FILE OWNERSHIP)
STARTS WHEN: B1 met (the owner's written approval of 2026-10-28, DD-154) and PR #134 merged; beside P5-S1a (the conductor's start order above, D46)
RUN CAPS: 4 orchestrator runs (the conductor's cap for its own lane, raised from 3 after a usage-limit stop; not a PLAN section 3 cap; decided by the conductor under the owner's delegation of 2026-10-22, not an owner signature)
SECURITY ROUND: none (not in the PLAN:170 list)    MIGRATION: none    MERGE: the Phase 5 merge clerk, in the order of the S1 MERGE ORDER line (the order the lanes actually start), after CI green and the S4 gate; PR 50 untouched
```
```text
SESSION P5-S1a    ORCHESTRATOR: one fresh orchestrator per lane, opus at max effort; workers per the lane block MODELS; never pass model fable to any Agent call
LANES: L62 (opus)
REGIONS: research on official vendor pages (docs/standards/environments-setup.md section 1.1)
STARTS WHEN: PLAN:178 (P5-S1: B1 done and main contains the plan PR, PR #134); as run: beside P5-S0b (D46)
RUN CAPS: 3
SECURITY ROUND: none (PLAN:170)    MIGRATION: none    MERGE: the Phase 5 merge clerk, in the order of the S1 MERGE ORDER line (the order the lanes actually start), after CI green and the S4 gate; PR 50 untouched
```
```text
SESSION P5-S1b    ORCHESTRATOR: one fresh orchestrator per lane, opus at max effort; workers per the lane block MODELS; never pass model fable to any Agent call
LANES: L65 (opus)
REGIONS: infra tooling (PLAN:77)
STARTS WHEN: PLAN:178 pairs L65 with L62; as run: at the first free slot, when the first of L79 and L62 merges (D46); a YES or UNRESOLVED-with-fallback result of L62 would re-plan the DigitalOcean-specific part of L65 under Q7 (D46)
RUN CAPS: 6 (raised from 4 by the owner, DD-154)
SECURITY ROUND: L65 (opus/max; PLAN:170)    MIGRATION: none    MERGE: the Phase 5 merge clerk, in the order of the S1 MERGE ORDER line (the order the lanes actually start), after CI green and the S4 gate; PR 50 untouched
```
```text
SESSION P5-S2    ORCHESTRATOR: one fresh orchestrator per lane, opus at max effort; workers per the lane block MODELS; never pass model fable to any Agent call
LANES: L66 (opus) · L73 (opus)
REGIONS: App Specs · discovery isolation and the O-6 closure path
STARTS WHEN: L66: L62 and L65 merged and G1 PASS (PLAN:179, :78); while G1 has not passed, the conductor runs the next ready lane and L66, L67, L69 move back with G1 (PLAN:174); L73: a free slot (PLAN:179)
RUN CAPS: 6 · 6
SECURITY ROUND: L66 and L73 (opus/max; PLAN:170)    MIGRATION: L73 only, the DB limiter (Q10 (i)) at the next free number measured at its start, 0075 if none lands first (PLAN:85, :95); L73 merges before the first staging deploy (PLAN:85, :241)    MERGE: the Phase 5 merge clerk, in the order of the S1 MERGE ORDER line (the order the lanes actually start), after CI green and the S4 gate; PR 50 untouched
```
```text
SESSION P5-S3    ORCHESTRATOR: one fresh orchestrator per lane, opus at max effort; workers per the lane block MODELS; never pass model fable to any Agent call
LANES: L67 (opus) · L74 (opus)
REGIONS: deploy workflows · staging smoke and golden path
STARTS WHEN: L67: L66 merged; L74: L65 merged (PLAN:180). 8.3 gates G2's staging run, not the start of L74: the owner's Google test accounts (step 8.3, PLAN:199) are needed only when the owner runs L74's staging spec at step 8.6 (PLAN:202, gate G2); L74's acceptance is local (PLAN:86) (decided by the conductor under the owner's delegation of 2026-10-22, not an owner signature)
RUN CAPS: 6 · 6 (L74 raised from 4 by the owner, DD-154)
SECURITY ROUND: L67 (opus/max; PLAN:170)    MIGRATION: none    MERGE: the Phase 5 merge clerk, in the order of the S1 MERGE ORDER line (the order the lanes actually start), after CI green and the S4 gate; PR 50 untouched
```
```text
SESSION P5-S4    ORCHESTRATOR: one fresh orchestrator per lane, opus at max effort; workers per the lane block MODELS; never pass model fable to any Agent call
LANES: L69 (sonnet) · L64 (sonnet)
REGIONS: deploy runbook · environment manifest
STARTS WHEN: L69: L67 merged; L64: a free slot (PLAN:181)
RUN CAPS: 3 · 3
SECURITY ROUND: none (PLAN:170)    MIGRATION: none    MERGE: the Phase 5 merge clerk, in the order of the S1 MERGE ORDER line (the order the lanes actually start), after CI green and the S4 gate; PR 50 untouched
```
```text
SESSION P5-S5    ORCHESTRATOR: one fresh orchestrator per lane, opus at max effort; workers per the lane block MODELS; never pass model fable to any Agent call
LANES: L70 (sonnet) · L72 (opus)
REGIONS: drill runbooks · headers, cookie, CSP
STARTS WHEN: a free slot (PLAN:182)
RUN CAPS: 3 · 6
SECURITY ROUND: L72 (opus/max; PLAN:170)    MIGRATION: none    MERGE: the Phase 5 merge clerk, in the order of the S1 MERGE ORDER line (the order the lanes actually start), after CI green and the S4 gate; PR 50 untouched; an independent verifier runs the local golden path in L72 (PLAN:188)
```
```text
SESSION P5-S6    ORCHESTRATOR: one fresh orchestrator per lane, opus at max effort; workers per the lane block MODELS; never pass model fable to any Agent call
LANES: L63 (sonnet) · L68 (opus)
REGIONS: deploy standards doc · web logs
STARTS WHEN: a free slot (PLAN:183)
RUN CAPS: 3 · 6 (L68 raised from 4 by the owner, DD-154)
SECURITY ROUND: L68 (opus/max; PLAN:170)    MIGRATION: none    MERGE: the Phase 5 merge clerk, in the order of the S1 MERGE ORDER line (the order the lanes actually start), after CI green and the S4 gate; PR 50 untouched; an independent verifier runs the local golden path in L68 (PLAN:188)
```
```text
SESSION P5-S7    ORCHESTRATOR: one fresh orchestrator per lane, opus at max effort; workers per the lane block MODELS; never pass model fable to any Agent call
LANES: L71 (sonnet) · L75 (sonnet)
REGIONS: outbox runbook · legal draft
STARTS WHEN: a free slot (PLAN:184)
RUN CAPS: 3 · 3
SECURITY ROUND: none (PLAN:170)    MIGRATION: none    MERGE: the Phase 5 merge clerk, in the order of the S1 MERGE ORDER line (the order the lanes actually start), after CI green and the S4 gate; PR 50 untouched
```
```text
SESSION P5-S8    ORCHESTRATOR: one fresh orchestrator per lane, opus at max effort; workers per the lane block MODELS; never pass model fable to any Agent call
LANES: L76 (sonnet), alone
REGIONS: host guide
STARTS WHEN: a free slot (PLAN:185)
RUN CAPS: 3
SECURITY ROUND: none (PLAN:170)    MIGRATION: none    MERGE: the Phase 5 merge clerk, in the order of the S1 MERGE ORDER line (the order the lanes actually start), after CI green and the S4 gate; PR 50 untouched; after P5-S8 an independent verifier runs the local golden path on the final main (PLAN:188)
```
```text
SESSION P5-S9 (conditional)    ORCHESTRATOR: one fresh orchestrator per lane, opus at max effort; workers per the lane block MODELS; never pass model fable to any Agent call
LANES: L77 (opus), then L78 (opus), sequential
REGIONS: packages/db
STARTS WHEN: L77 only if the owner's KMS input (Q8) needs code; L78 only after the owner has created the Managed PostgreSQL (PLAN section 8) (PLAN:186, :89, :90)
RUN CAPS: 6 · 6
SECURITY ROUND: L77 and L78 (opus/max; PLAN:170)    MIGRATION: none planned    MERGE: the Phase 5 merge clerk, in the order of the S1 MERGE ORDER line (the order the lanes actually start), after CI green and the S4 gate; PR 50 untouched
```

## S4. Ghi chú cho conductor

Cổng S4, merge clerk, thứ tự merge, HEARTBEAT, phục hồi sau usage limit hoặc mất đăng nhập, và việc reconcile bốn dòng backlog stale. Dòng nào của S4 Phase 4 (P4RUN:260-270) không đổi thì chỉ trỏ tới; các luật vận hành còn lại ở S1.

```text
S4 GATE: P4RUN:261 holds for every Phase 5 hand-back; the gate also checks the PR BODY and CLOSING KEYWORDS lines of S1 in the body and in every commit message.
AFTER EACH MERGE: P4RUN:262 holds: main CI green on the merge before a lane that depends on the merged one starts.
MERGE CLERK: P4RUN:263 holds with Phase 5 values: one clerk for all of Phase 5 (PLAN:171), sonnet at high effort; it merges a lane PR (merge commit) one at a time in the order of the S1 MERGE ORDER line (the order the lanes actually start), only after CI green and the S4 gate; one rerun of the failed jobs per head for a flake on the single known-flake list the conductor keeps outside the repo (the list P4RUN:263 names), a second red is real; never PR 50 (owner-only); orchestrators never merge, close PRs or delete branches.
MERGE ORDER: the MERGE ORDER line of S1 (conductor rule for Phase 5, decided by the conductor under the owner's delegation of 2026-10-22, not an owner signature): merge in the order the lanes actually start (S3 gives the planned start order), one PR at a time (DD-153); the repo source for plan order is PLAN:171, and the planned start order differs from the plan order only by the P5-S1 split (S3); applying the owner's "in plan order" (P4RUN:26) as this start order is a conductor reading, the owner may correct it.
HEARTBEAT: rule and source in S0.
USAGE LIMIT: P4RUN:265-266 holds unchanged.
LOGIN LAPSE: P4RUN:267-268 holds unchanged (verify the disk before acting).
STALE BACKLOG ROWS (reconcile item): PLAN:96 names four stale backlog rows that are not lanes: zalo-webhook-adapter-core (status: planned), web-pwa-manifest-and-service-worker (status: in-flight; the owner's PWA install check at step 8.7 is still open), projector-real-replace-stub (status: planned) and audit-2026-09-06-b2-required-projectors-drift-across-replicas (status: planned). A later lane reconciles them; L79 changes none of them. Find each with grep -n '^## task: <slug>$' docs/autopilot-backlog.md (at 64452ea5dd2b62b1f31e582a62ab5642aadcf06f: lines 5113, 5141, 5183, 5583; PLAN:96 gives the base lines); the row backlog-projector-real-replace-stub-status-stale (line 7575 there, status: idea) already records the third.
```
