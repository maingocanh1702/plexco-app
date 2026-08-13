# Next lanes — soạn 2026-08-11 · base `main` = `e0ba6b6`

> Bốn hướng owner đã chọn, xếp theo thứ tự chạy được. Ngôn ngữ: prose dẫn tiếng Việt, khối paste tiếng Anh.
>
> **Serialize:** cả A, B, C đều có `docs/autopilot-backlog.md` trong scope → `SCOPE_COLLISION` bắn khi
> hai lane active cùng lúc. Chạy lần lượt. D không cần agent nên chạy song song được.

---

## Thứ tự và vì sao

**A trước** vì rẻ nhất và bằng chứng đang nóng — ba mục backlog vừa bị AP-51 làm lỗi thời sáng nay, để
lâu thì phải đo lại từ đầu.

**C trước B** vì hai món nợ Chat là **P1 có deadline theo slice**, không theo ngày: chúng chặn slice 7/8
và Person-merge. Kit friction (B) là P2/P3 — khó chịu nhưng không chặn ai.

Đánh đổi cần nói thẳng: **B chạy trước thì mọi lane sau đều êm hơn** (hôm nay riêng nó ăn 3 vòng owner
can thiệp). Nhưng nó hoãn P1. Nếu tuần này còn định chạy ≥3 lane nữa thì đảo B lên trước là hợp lý.

---

## A — Reconcile ba mục AP-51 vừa làm lỗi thời

`0e8d252` nâng floor và xoá dead ignore. Ba mục backlog nói về đúng những thứ đó, không mục nào tự đóng
được vì cả ba thiếu `merged_probe` phân biệt — đúng lớp mà `autopilot-backlog-reconcile` từ chối
auto-flip.

```text
Read docs/00-start-here/HANDOFF.md first.

OUTCOME: reconcile three backlog tasks that commit 0e8d252 (AP-51, merged 2026-08-11) made stale. This
is a BACKLOG RECONCILE pass — no migration, no source edit, no worktree, no register.

Scope: docs/autopilot-backlog.md only. Nothing else.

What 0e8d252 actually did, verify each against the live tree rather than trusting this list:
  - package.json pnpm.overrides now carries nanoid ^3.3.17, brace-expansion@5 ^5.0.9, postcss ^8.5.23
  - pnpm-lock.yaml resolves nanoid 3.3.17, brace-expansion 5.0.9, postcss 8.5.25
  - osv-scanner.toml no longer contains any IgnoredVulns block
  - Security / OSV full dependency scan is GREEN on main (run on 9a5c709), first time since it went red

THE THREE TASKS:

1. deps-security-bump--postcss (status: blocked, P1). It was split out of deps-security-bump on
   2026-07-30 for exactly one reason: postcss's patch was still inside the 7-day minimumReleaseAge
   window. That condition is gone — postcss now resolves 8.5.25. Decide between merged and superseded and
   say which on the evidence: was this task's outcome ACHIEVED by 0e8d252, or was the task itself
   OVERTAKEN by a differently-scoped slice? They are not the same claim and the backlog distinguishes
   them. Write a real merged_probe (package.json :: postcss is a discriminating one; a prose note is not).

2. osv-scanner-stale-esbuild-ignore-reason (status: idea, P3). 0e8d252 deleted the
   GHSA-67mh-4wv8-2f99 IgnoredVulns block. Confirm nothing in the task remains undone — read the task
   body carefully, it may also ask for a POLICY change (a rule about when an ignore may exist at all),
   which deleting one entry does not deliver. Close only the part actually done; if a policy question
   survives, keep the task open and narrow its title to what is left.

3. eslint10-brace-expansion-5-0-7-typescript-estree (status: idea, P2). It is pinned to 5.0.7, which the
   tree no longer resolves. Re-read what the task was actually about — the version was probably the
   SYMPTOM and typescript-estree's dependency shape the SUBJECT. If the underlying concern survives the
   version bump, do NOT close it; re-pin it to 5.0.9 and say what still worries you. If the concern was
   only the vulnerable version, close it with a probe.

DO NOT close a task merely because a version number moved. For each of the three, state in one line what
the task was FOR, then whether that purpose is served. A task closed on a coincidence comes back.

Also run scripts/autopilot-backlog-reconcile (read-only, no --fix) and report anything it flags,
including weak-probe warnings on tasks outside these three. Do not act on those; just surface them.

Commits are the owner's — report the diff, do not commit.

Terminate at READY | AWAIT | HALT.
```

---

## C — Hai món nợ P1 của lane Chat

Cả hai đang `status: planned` với `scope: []` và `manifest: null` — tức chúng mới là **ghi chú**, chưa
phải packet. Việc ở đây là **author contract + manifest**, không phải thực thi.

Cả hai `change_class: schema`, nên mỗi cái là một migration mới. Tail hiện tại là `0031`. **Đừng đoán số
— derive.** Bẫy này đã nổ một lần trong chính cây Chat: AP-45 đoán `0029` cho mình rồi hai migration
DD-29 không liên quan tiêu mất số đó.

```text
Read docs/00-start-here/HANDOFF.md and docs/standards/review-code-readiness-gate.md first.

OUTCOME: author the packet (task contract + runtime-shaped authored manifest) for the two P1 chat debts
below, and bring each to strict CODE_READY or to an honest NOT_CODE_READY with exact blockers. This is an
AUTHORING pass — do NOT write the migrations, do NOT create a worktree, do NOT register.

Both dependencies have merged. Verify each yourself:
  - chat-dm-safety-authority-core -> packages/db/migrations/0030_chat_dm_safety_authority_core.sql
  - dd38-dd86-chat-schema-core    -> packages/db/migrations/0031_chat_schema_core.sql

TASK 1 — chat-dm-safety-config-single-read (P1, opened from DD-102).
assert_dm_allowed reads its configuration through FOUR separate statements: three
`SELECT ... FROM chat_dm_safety_config WHERE singleton` (dm_sender_limit_per_min, dm_target_limit_per_min,
audit_enabled) plus dm_safety_enabled(). Under READ COMMITTED each statement takes its own snapshot, so a
concurrent config tightening can apply PARTIALLY to an in-flight call.

Read DD-102 before designing anything — it is a CONDITIONAL waiver and it constrains what you may assume.
Two things the backlog already measured, re-verify both rather than inheriting them:
  - This is NOT fail-open. rate_limit_check(bucket, 0, ...) runs `IF v_count >= p_limit THEN RETURN false`
    and v_count >= 0 always holds, so a missing config denies. The defect is inconsistency, not bypass.
  - dm_current_read_allowed() calls only dm_safety_enabled() and chat_pair_blocked(), both single-
    statement. It does NOT have the four-statement shape and is not what this task fixes.
This task is a precondition for chat slices 7 and 8. Say so in the contract and name what breaks without it.

TASK 2 — chat-identity-merge-reparent-enablement (P1, opened from DD-103).
0031 declares chat_members_identity_immutable and chat_channels_identity_immutable, which block UPDATE on
person_id / dm_key UNCONDITIONALLY, plus a composite FK to memberships that is NOT DEFERRABLE. Re-parenting
chat rows inside a merge transaction is therefore STRUCTURALLY IMPOSSIBLE, not merely unimplemented.

Those triggers were added in rounds 1-2 to close a REAL security bypass. Do not propose removing them.
Design an escape hatch that keeps the bypass closed — the shape to argue for is a narrowly-scoped,
provably-authorized path plus DEFERRABLE on the FK, and you must state exactly who may take it and how
that authorization is proven at the database level, not at the application level.

INVARIANTS — read this before touching the manifest. Use [schema, identity]. Do NOT use `merge-authority`.
That token means "landing and optional separately-authorized automation" — the merge of an AUTOPILOT LANE
into main. It has nothing to do with merging a Person. Two different senses of "merge"; picking the wrong
one serializes this slice against the wrong lanes.

FOR BOTH:
  - Derive the migration number: `ls packages/db/migrations/*.sql | sort | tail -3`. The tail is 0031 as of
    2026-08-11, but derive it at authoring time. AP-45 guessed its own number and two unrelated DD-29
    migrations consumed it. Do not guess.
  - These are two separate slices with two separate migrations. They cannot run in parallel — both take a
    migration number and both list docs/autopilot-backlog.md in scope. Say which one goes first and why.
  - Write every verification check as a PROPERTY of the resulting schema, never as a literal version or
    count. The runtime manifest is hash-locked after register, so a literal that moves cannot be corrected
    in place — a registration was already disposed over exactly this.
  - Leave base_sha in the AUTHORED manifest as documentation and say so in a note. The operational value is
    derived at register time from the live origin/main tip. Do NOT carry manifest_schema_version in the
    authored manifest; that field belongs only to the runtime one.
  - Set security_review.required = true for both. Task 1 is a rate-limit authority path; task 2 deliberately
    opens a hole in a trigger that closed a real bypass.

Scope for this pass: docs/autopilot/contracts/*, docs/autopilot-manifests/*, docs/autopilot-backlog.md, and
the two .claude/commands/ launchers. Nothing else. `pnpm review:check:changed` must be green.

Commits are the owner's — report the diff, do not commit.

Terminate at READY | AWAIT | HALT.
```

---

## B — Cụm kit-friction

> ⚠️ **Cập nhật 2026-08-12 sau AP-53.** Bảng bằng chứng bên dưới đã đo lại: mục (b) lên **lần thứ tư**,
> và có thêm hai quan sát mới (f, g). Con số trong bản soạn 11/08 (*"lần thứ 3"*, *"bốn quan sát"*) là
> **stale** — dùng bảng này.

Chín task, và trong **hai ngày** 11–12/08 đã sinh bằng chứng mới cho phần lớn chúng. Đó là lý do làm
triage trước khi làm slice: chưa biết chín cái này là chín lỗi hay ba lỗi nhìn từ chín phía.

Bảy quan sát, dùng làm dữ liệu đầu vào:

| # | Hiện tượng | Task tương ứng |
| --- | --- | --- |
| a | classifier chặn ghi `readiness.json` — **2 lần**, nhưng lần thứ 2 file **thật sự sai dạng** (elaborated, không phải minimal) ⇒ discriminator là nội dung, không phải hành động | `classifier-blocks-kit-mandated-readiness-json` |
| b | HALT lúc setup chặn chính bản sửa của nó — **lần thứ 4**, hai lần trong ~14 giờ (`chat-dm-safety-authority-core--v3`, `dd38-dd86-chat-schema-core`, `deps-osv-transitive-floors`, `chat-dm-safety-config-single-read`) | chưa có task riêng |
| c | `AWAIT-FOUNDER-*` do agent viết **tự chặn resume của chính agent** (scan dòng 602 khớp cả hai prefix) | chưa có task riêng |
| d | `ap-finish` không chứng minh được vì closeout viết SAU gate — giờ có **đối chứng**: AP-52 sai thứ tự ⇒ `--authorized-close` (record máy-đọc ghi `origin_proof_sha: null` cho việc **đã** land); AP-51 và AP-53 đúng thứ tự ⇒ `--squash-verified` sạch cả hai | chưa có task riêng |
| e | `merged_probe` không phân biệt được ⇒ task báo pending vĩnh viễn (AP-51 round 1); và `close_by REFUSED` bắt đúng lớp đó ở task khác | `gates-that-fire-correctly-and-cannot-say-why` (một phần) |
| f | `ap-merge --test` chạy lại canonical suite mà gate **vừa** chạy bound vào `diff_sha256`; thiếu `DATABASE_URL_TEST` ⇒ đỏ vì môi trường, chặn một merge tốt sau khi commit đã tạo | chưa có task riêng |
| g | Gate tree-sạch của `ap-merge` chặn vì file docs WIP **không liên quan** của phiên khác — đã xảy ra 2 lần, phải `git stash` cả hai lần | chưa có task riêng |

```text
Read docs/00-start-here/HANDOFF.md first.

OUTCOME: triage the kit-friction cluster in docs/autopilot-backlog.md into a small number of ROOT CAUSES,
then say which are worth fixing and in what order. This is a TRIAGE pass — do not fix anything, do not
create a worktree, do not register.

The nine tasks: classifier-blocks-kit-mandated-readiness-json, codex-review-verdict-nondeterminism,
breaker-counts-infra-flakes-as-fix-rounds, gates-that-fire-correctly-and-cannot-say-why,
kit-dead-citation-prompt-generic-sections, launcher-register-path-authored-to-runtime,
root-lock-no-staleness-detection, reconcile-hand-closed-entries-never-age-out,
local-dev-sanctioned-paths-are-harder-than-the-forbidden-one.

SEVEN OBSERVATIONS from 2026-08-11 and 2026-08-12 — five of them are not yet tasks. Verify each against
the repo, then decide whether it is a new root cause or another face of a task already listed. Counts
below were re-measured on 2026-08-12; do not carry forward any number written earlier in this file.

  (a) The auto-mode classifier blocked writing readiness.json as a "fabricated attestation" twice. The kit
      MANDATES this write — docs/autopilot-templates/autopilot-prompt-GENERIC.md line ~289 — and the gate
      does not read the file as proof anyway; it re-runs every verification itself (~line 296).
      IMPORTANT NUANCE, and the reason this is not a simple false positive: on the first occurrence the
      file was the correct minimal form and the block was wrong; on the second the file DID carry extra
      self-asserted fields (acceptance.notes, breakers.fix_round_count, breakers.notes) and line 254 —
      "do not manufacture verification/review files or self-assert a clean status ... it records only
      identity, acceptance and breaker state" — makes that a genuine violation. The discriminator is
      CONTENT, not the act. The template has SEVEN top-level keys; count them, do not trust any prose
      that states a number, including mine.

  (b) Setup-time HALT files block their own corrected retry. FOUR lanes now, two of them within about
      fourteen hours: chat-dm-safety-authority-core--v3, dd38-dd86-chat-schema-core and
      deps-osv-transitive-floors in .autopilot/state-archive/, plus chat-dm-safety-config-single-read.
      Same two error codes throughout: CONTRACT_INVALID (a placeholder regex false-tripping on a `</>`
      string) and READINESS_JSON_INVALID (ready run issued before readiness.json existed). Neither judges
      the slice's work — both fire at static precondition checks before any verification or review runs.
      The script's own suggested resolution, "close this terminal lifecycle and create a fresh successor
      task", would discard a fully implemented, fully green slice over a setup mistake. The owner's
      established remedy is renaming to `attempt-NN-superseded-HALT-*.txt`, which works because the
      blocker scan at scripts/autopilot-review-readiness.mjs:602 uses name.startsWith(). Four occurrences
      with an identical shape and an identical manual remedy is no longer an incident rate; it is the
      kit's behaviour.

  (c) That same scan matches BOTH "HALT-" and "AWAIT-FOUNDER-". So the AWAIT-FOUNDER file an agent writes
      to ESCALATE also bars its own resume. The escalation channel and the blocking channel are the same
      directory. An agent that correctly refuses to clear its own blocker cannot even flag it without
      deepening it.

  (d) ap-finish.sh could not prove AP-52 landed, because gate-result.json freezes diff_files at gate time
      while the kit's own closeout instruction has the lane write its READY summary into docs AFTERWARDS.
      Following the instruction makes the lane unprovable. There is now a controlled comparison across
      three lanes: AP-52 gated first and closed via --authorized-close, whose JSON records status
      "authorized_close" and origin_proof_sha null — machine-readable fields asserting "never landed"
      about work that did land, with the truth only in a prose reason field. AP-51 and AP-53 both wrote
      the closeout before gating and both passed --squash-verified with "origin squash patch equals the
      READY feature diff". Two right, one wrong, and ordering is the entire difference.

  (e) An evidence mechanism that cannot discriminate. AP-51's authored merged_probe was `nanoid@<3.3.17`,
      a conditional-selector string, while the implementation used a bare `"nanoid": "^3.3.17"` override —
      the literal could never match post-merge and the task would have reported pending forever. Caught by
      codex in round 1, not by any gate. Separately, autopilot-backlog-reconcile REFUSED a close_by on
      gates-that-fire-correctly-and-cannot-say-why for the same class of reason. Contrast the outcome when
      the probe is real: chat-dm-safety-config-single-read auto-flipped to merged with the tool recording
      its own basis. Ask whether probe quality deserves a gate of its own rather than depending on a
      reviewer noticing.

  (f) ap-merge --test re-runs the canonical suite that the readiness gate has just run, bound to
      diff_sha256, on a tree that is identical when main equals the base. On 2026-08-12 it ran without
      DATABASE_URL_TEST exported, so packages/db failed on environment rather than on code — AFTER the
      squash commit had been created, leaving the merge half-done and the push unexecuted. Ask whether
      --test earns its place at all when the gate already ran the suite bound to the diff, and if it does,
      whether it should refuse to run rather than fail when DATABASE_URL_TEST is absent.

  (g) ap-merge's clean-tree gate blocks on modified TRACKED files that have nothing to do with the lane.
      Twice on 2026-08-11/12 it halted on in-progress spec edits belonging to a different session, and
      both times the remedy was git stash around the merge. The gate itself is correct and exists for a
      real 2026-07-22 incident. The question is whether "clean tree" is the right scope, or whether it
      should be "no uncommitted changes to files in this lane's declared scope".

DELIVERABLE — three things, in this order:
1. A root-cause grouping. Nine tasks plus seven observations do not imply sixteen defects. Name the
   smallest set of underlying causes that explains all of them, and map every task and observation onto
   one. Where a task turns out to be a symptom of another, say so and propose merging it.
2. For each root cause: is fixing it worth it? Cost of the fix against cost of living with it, measured in
   OWNER INTERVENTIONS ACTUALLY OBSERVED, not in how annoying it feels. Six owner interventions were spent
   on this cluster across 2026-08-11 and 2026-08-12 — count them yourself from the lane records rather
   than taking that number. Meanwhile some of the nine listed tasks may have never fired even once: check
   which, and say so plainly. Recommend CLOSING the ones not worth fixing. A task that has cost nothing in
   its lifetime and is kept "just in case" is not free — it is read, re-read and re-triaged by everyone
   who scans this file, and this cluster reaching nine entries is itself the evidence.
3. An ordering, with the ones that unblock others first. Note explicitly which fixes would have prevented
   an intervention that actually happened, and which only prevent hypothetical ones.

Open new backlog tasks for (b), (c), (d), (f) and (g) if the grouping says they are distinct causes; fold
them into existing tasks if not. Either way every lane cited must be named — chat-dm-safety-authority-core--v3,
dd38-dd86-chat-schema-core, deps-osv-transitive-floors, db-test-harness-teardown-57p01 and
chat-dm-safety-config-single-read — with its state-archive or disposition path, so the next reader can
re-derive rather than trust this list.

One caution about your own output. Several counts in the surrounding document were wrong when written and
had to be corrected against measurement: "third occurrence" was the fourth, "eight template keys" was
seven, and three separate hand-enumerations of the migration-count literals were each incomplete while a
derived grep found fourteen. Do not extend a list you were given; re-derive it. Where you state a count,
state the command that produced it.

Scope: docs/autopilot-backlog.md only. Commits are the owner's — report the diff, do not commit.

Terminate at READY | AWAIT | HALT.
```

---

## D — DD-81: quyết định của owner, không phải prompt

Đây không phải slice. Đo được lúc 2026-08-11:

```
design.pen   562 KB   sửa lần cuối 2026-07-22 18:25   ← DD-81 gọi là canonical
fe.pen       170 KB   sửa lần cuối 2026-08-07 00:58   ← DD-81 không nhắc tới
.gitignore   không có luật nào chặn *.pen
```

`design.pen` đứng im từ **đúng ngày FE vào HOLD**. Việc thiết kế thật gần đây nằm ở `fe.pen`, một file
DD-81 chưa từng công nhận và chỉ bằng 30% dung lượng. Nói cách khác **file canonical đã nguội, còn file
đang sống thì không có thẩm quyền.**

DD-81 đặt năm điều kiện để mở FE HOLD:

| # | Điều kiện | Trạng thái |
| --- | --- | --- |
| 1 | `design.pen` được git-track | ❌ untracked — mà `.gitignore` không chặn, nên chỉ là chưa `git add` |
| 2 | owner approve | ❌ |
| 3 | variables khớp `design-tokens.md` SoT | ❓ chưa đo |
| 4 | visual review PASS | ❌ |
| 5 | WCAG evidence PASS | ⚠️ một phần: `#FF5A1F` với white = `3.118:1` FAIL, với `#22100A` = `5.874:1` PASS |

Điều kiện 1 cách một lệnh. **Thứ giữ FE 20 ngày không phải kỹ thuật** — mà là chưa ai trả lời `fe.pen`
là cái gì. Ba khả năng, và chúng dẫn tới ba hành động khác hẳn nhau:

- **`fe.pen` là bản kế nhiệm** → cần **amend DD-81** đổi canonical path, rồi track `fe.pen`, bỏ
  `design.pen`.
- **`fe.pen` là file nháp/thử nghiệm** → track `design.pen` theo đúng DD-81, `fe.pen` vào `.gitignore`.
- **Hai file hai mục đích** (ví dụ design system vs màn hình FE) → DD-81 cần nói cả hai, và nói cái nào
  là authority cho token.

Sau khi anh chọn, phần còn lại giao được — prompt cho bước đó:

```text
OUTCOME: produce the evidence DD-81 requires to lift the FE HOLD, for the canonical .pen file the owner
has just designated. Do NOT change any active token value and do NOT lift the HOLD yourself — DD-81
reserves both for a new DD.

Read docs/standards/decisions.md DD-81 and docs/standards/design-tokens.md first. Note the authority
boundary written at the top of design-tokens.md: active values stay Indigo + Outfit/Inter until a new DD
flips them, and that flip needs an exporter plus drift proof.

Deliver three things:

1. DRIFT AUDIT. Read the canonical .pen file's variables via the pencil MCP tools — get_app_state with
   include_schema true, then the variable definitions. Never use Read or Grep on a .pen file; they are
   encrypted and the pencil tools are the only supported access. Produce a table of every variable in the
   file against its counterpart in design-tokens.md, and mark each MATCH / DRIFT / MISSING-IN-FILE /
   MISSING-IN-SOT. DD-81 requires the file's variables to match the SoT before the file can become
   authority, so any DRIFT row is a blocker and must be listed as one.

2. WCAG EVIDENCE for the target direction, computed not quoted. Candidate C is #FF5A1F with Sora headings
   and Inter body. DD-81 already records white-on-orange at 3.118:1 (fails AA for normal text) and
   #22100A at 5.874:1 (passes). Re-derive both and extend the check to every foreground/background pair
   the file actually uses, at the sizes it uses them — AA needs 4.5:1 for normal text but only 3:1 for
   large text and UI components, so a pair that fails one may legitimately pass another. State the rule
   applied for each row.

3. A TRACKING RECOMMENDATION. .gitignore has no rule for *.pen, so the file is untracked by neglect, not
   by policy. Report the file's size and whether git will store it sensibly, and recommend either plain
   tracking or Git LFS with the size that drove the call.

Do not edit design-tokens.md. Do not edit any FE source. Report findings; the DD amendment is the
owner's.

Terminate at READY | AWAIT | HALT.
```
