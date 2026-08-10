# Level 3.1 — prompts cho các task tiếp theo

> **Cách dùng:** copy nguyên một khối `text` vào Claude Code. Khối `text` là **agent-facing ⇒ English**,
> theo đúng khuôn `.claude/commands/*` và `autopilot-prompt-GENERIC.md`; phần dẫn tiếng Việt quanh nó là
> owner-facing, giống `ap23-inbound-webhook-RUN.md`.
>
> **Đừng tin SHA/trạng thái viết trong prompt** — chúng là claim lúc soạn (2026-08-09), không phải tiền
> đề lúc chạy. Mỗi prompt tự mở bằng bước đo lại.
>
> **Authority:** DD-100 (`../standards/decisions.md` v2.20) · plan + blocker:
> `level3.1-adoption-plan.md` (verdict `NOT_CODE_READY`, B1–B5).
>
> **Thứ tự bắt buộc.** Làn A tuần tự vì cùng ghi `scripts/codex-review-pin.sh`: `T1 → T2 → T3 → T4`.
> Làn B (`T5`) song song được. `T6` cần T5 đóng. `T0` chặn cả hai làn.

| # | Task | Làn | Chặn bởi |
|---|---|---|---|
| T0 | Đóng B1 — resume & merge lane Chat đang đỗ | — | codex quota (B2 nếu cần CI) |
| T1 | P4-standard — chuẩn fixture | A | T0, B3 |
| T2 | Phase0-gap1 — reviewer scope binding | A | T1 |
| T3 | Phase0-gap2 — phân loại auth-tier | A | T2 |
| T4 | P5 — reviewer attestation | A | T3 |
| T5 | Phase0-gap3 — infra-flake ≠ budget | B | T0, B3 |
| T6 | P1 — schema v3 + `design_contract` | — | T5 |
| T7 | P3 — `gate_profile: light` | — | T6 |
| T8 | D4 — xoá ledger + `proactive_routine` | — | T6 |
| T9 | P6 — dọn tầng tài liệu | — | T6, T8 |

---

## T0 — Đóng B1: resume và merge lane Chat đang đỗ

> **Vì sao đi trước mọi thứ 3.1:** lane này đang chờ đúng `scripts/codex-review-pin.sh` mà T2/T3/T4
> sẽ sửa. Sửa reviewer wrapper khi một lane đã verification sạch đang chờ nó = đổi luật giữa hiệp.

```text
Read docs/00-start-here/HANDOFF.md first.

OUTCOME: bring lane chat-dm-safety-authority-core--v2 to READY, then hand off to the owner for merge.

STEP 1 — measure; do not trust any SHA or status written in this prompt:
- git -C "$HOME/Projects/Plexco app" rev-parse HEAD origin/main
- git worktree list  → confirm the chat-dm-safety-authority-core--v2 worktree still exists
- the live state dir is the SUFFIXED one INSIDE the worktree:
  .autopilot/worktrees/chat-dm-safety-authority-core--v2/.autopilot/state/chat-dm-safety-authority-core--v2/
  The unsuffixed .autopilot/state/chat-dm-safety-authority-core/ in the root tree is a stale leftover
  from the original lane — do not read status from it.
- NEVER run `git worktree prune` — .autopilot/ state is unrecoverable once removed
- If an AWAIT-FOUNDER-* or HALT-* file exists: report AWAIT and STOP. You may never delete, rename or
  move it, not even when the resume condition is plainly satisfied
  (autopilot-prompt-GENERIC.md:483, non-negotiable boundaries). Clearing it is the founder's call.

STEP 2 — final review round:
- run scripts/codex-review-pin.sh against that worktree
- this is a P1 schema-migration slice ⇒ clean rounds are required per review-code-readiness-gate.md
- if the reviewer cannot be invoked (quota/auth): HALT TOOL_UNAVAILABLE.
  Do NOT lower the gate yourself. Do NOT declare the round clean on your own authority.

STEP 3 — if the review is clean:
- report READY with the exact diff and the directly-executed gate output
- the merge is run by the owner via scripts/ap-merge.sh on the owner machine
  (the sandbox cannot perform git writes in the repo mount)
- re-verify the migration tail at merge time; 0030 is provisional, not a fact
- after merge: dd38-dd86-chat-schema-core (AP-45) must RE-RUN its own gate

Terminate at READY | AWAIT | HALT. Do not merge.
```

---

## T0b — Re-register lane Chat thành `--v3` trên base mới

> **Trạng thái khi soạn (2026-08-09 16:22Z):** `--v2` đã `authorized_close`; worktree đã gỡ, registry đã
> sạch, **branch `feat/chat-dm-safety-authority-core--v2` @ `31bd4d9` còn nguyên**, state archive ở
> `.autopilot/state-archive/chat-dm-safety-authority-core--v2-20260809T162209Z/` (45 file, 37 artifact verify).
>
> **Chỗ dễ hỏng nhất của toàn bộ chuỗi nằm ở bước 3.** Manifest trên `main` có **path đúng** nhưng scope
> **trước amendment**; manifest trên branch có **scope sau amendment** nhưng **path cũ**. Kết quả phải là
> *scope sau amendment + path đúng*. Lấy nhầm một bên là mất amendment 05/08 — thứ duy nhất hợp thức hoá
> scope 5-module hiện tại — và reviewer sẽ bắt lỗi scope ở `--v3`.

```text
Read docs/00-start-here/HANDOFF.md and docs/autopilot-templates/level3.1-adoption-plan.md (B1, B1b) first.

OUTCOME: re-register the closed chat-dm-safety lane as chat-dm-safety-authority-core--v3 on a fresh base,
preserving every byte of its 2026-08-05 owner-authorized scope amendment, then reach READY.

PRECONDITION — verify, do not assume:
- `git status --porcelain` on the root tree. A dirty base must not be registered. If the working tree
  still carries the uncommitted docs reorg / docs/expert/ additions / the backlog reconcile ap-finish
  left behind, report AWAIT and stop. Closing that is the owner's call (blocker B3).
- Confirm feat/chat-dm-safety-authority-core--v2 still exists and points at the same head recorded in
  .autopilot/dispositions/chat-dm-safety-authority-core--v2.json.

ORDER IS LOAD-BEARING — register on a CLEAN base, THEN bring the work forward. `register` enforces
HEAD == base_sha (scope-gate v25 note, line 130). If you bring the 12 commits over first, HEAD is 12
ahead of base_sha at register time and the registration is invalid. The previous session on this exact
lane already paid for this once and had to remove and recreate the worktree; its own AWAIT report names
it "the registration-order mistake" and records the correct order as "registered while HEAD === base_sha,
verified registered-manifest.sha256, then merged the archived work forward". Do that.

STEP 1 — branch and worktree AT THE BASE, carrying no work yet:
  git branch feat/chat-dm-safety-authority-core--v3 origin/main
  (branch from origin/main, NOT from --v2)
  Create the worktree for chat-dm-safety-authority-core--v3 on that branch.
  Confirm the worktree HEAD equals the current origin/main tip before going further.
Do NOT delete or force-move the --v2 branch. It is the forensic record.

STEP 2 — runtime manifest, then register while HEAD is still clean:
- Hand-write .autopilot/state/chat-dm-safety-authority-core--v3/manifest.json INSIDE the worktree,
  derived from the authored manifest, with:
    feature: chat-dm-safety-authority-core--v3
    branch:  feat/chat-dm-safety-authority-core--v3
    base_sha: <current origin/main tip, measured now — NOT any SHA written in this prompt>
    manifest_schema_version: level3-operational-v2
  Keep v2. Do NOT introduce level3-operational-v3 / design_contract here — DD-100 D3 is forward-only and
  this lane lives out its lifecycle on v2.
- The authored contract under docs/autopilot-manifests/ must NEVER carry manifest_schema_version
  (scope-gate:548 HALTs CONTRACT_INVALID).
- Register:
    scripts/autopilot-scope-gate register \
      --manifest .autopilot/state/chat-dm-safety-authority-core--v3/manifest.json
- Immediately check that .autopilot/state/chat-dm-safety-authority-core--v3/registered-manifest.sha256
  EXISTS. The word "registered" alone is not proof — passing the authored path silently skips the
  hash-lock and still prints success. No file, no registration: stop and report.

STEP 3 — bring the work forward into the registered worktree:
- Merge feat/chat-dm-safety-authority-core--v2 forward (12 commits, 9415754..31bd4d9).
- After the merge, verify ALL 12 are present, including 688a622
  ("preserve HALT-MAX_ROUNDS.txt verbatim before close") — that commit is the byte-verified HALT record
  and losing it loses the only durable copy of the round-05 diagnosis.
- Expect conflicts in exactly three files:
    docs/autopilot-backlog.md
    docs/autopilot-manifests/chat-dm-safety-authority-core.json
    docs/autopilot-chat-dm-safety-authority-core.md   (deleted on main by 686f99f, now at
                                                       docs/autopilot/contracts/autopilot-chat-dm-safety-authority-core.md)

STEP 3b — THE CRITICAL RECONCILE. Three-way, per file:
- Contract doc: take the BRANCH content (it carries the 2026-08-05 amendment header, the amended
  decision rows 6/7/8, and the round-02/04/05 amendment sections) and place it at the NEW path
  docs/autopilot/contracts/autopilot-chat-dm-safety-authority-core.md. The old root path must not exist
  afterwards. Do not take main's copy — main's is the pre-amendment version.
- Manifest json: start from the BRANCH version (post-amendment scope: 10 entries, narrowed
  negative_scope, _scope_note recording "grew from 3 to 5"). Then apply ONLY main's path corrections:
    docs/autopilot-chat-dm-safety-authority-core.md
      -> docs/autopilot/contracts/autopilot-chat-dm-safety-authority-core.md   (in scope AND in context_sources)
    docs/autopilot-dd38-dd86-chat-schema-core.md
      -> docs/autopilot/contracts/autopilot-dd38-dd86-chat-schema-core.md      (in context_sources)
    and the same path inside _dependency_note's prose.
  Nothing else from main. Verify afterwards: the string "grew from 3 to 5" and the phrase
  "NARROWED, not blanket-excluded" are both still present. If either is missing you took the wrong side.
- Backlog: keep the branch's own entries (this slice's entry + the new
  chat-dm-safety-audit-queryable-path idea) and main's entries for every OTHER slice. Do not drop
  either side's rows.

STEP 4 — reproduce verification before invoking the gate. The --v2 head was clean at these exact
numbers; anything lower means the merge-forward lost something:
    DB suite      414/414   (run it 3 consecutive times — these are lock-timing fixes)
    full monorepo 732/732
    plus typecheck / lint / format / build, and `pnpm review:check:changed`
If a number is lower, STOP and report which artifact went missing. Do not proceed to the gate.

STEP 5 — ready:
  scripts/autopilot-scope-gate ready \
    --manifest .autopilot/state/chat-dm-safety-authority-core--v3/manifest.json
Manifest requires 2 consecutive clean code-review rounds. Handle real findings inside the declared
scope only. Reviewer unreachable → HALT TOOL_UNAVAILABLE; never lower the gate yourself.
If any AWAIT-FOUNDER-* or HALT-* file appears, report and STOP — you may never delete, rename or move
one (autopilot-prompt-GENERIC.md:483).

KNOWN OPEN QUESTION, do not decide it yourself: the reconciled manifest declares 5 modules against the
plan's §9 ceiling of 3, and the 3 core modules alone are ~1,145 changed LOC against a 750 ceiling. Plan
§9 line 416 prescribes SCOPE_DESIGN hard stop and re-slice for that condition; the owner instead
authorized an amendment on 2026-08-05. If a reviewer raises this, report AWAIT with both facts and let
the owner close it in decisions.md (blocker B1b). Do not re-slice on your own authority, and do not trim
tests to fit — §9 line 416 forbids that explicitly.

Terminate at READY | AWAIT | HALT. Do not merge.
```

---

## T1 — P4-standard: chuẩn fixture (slice 3.1 đầu tiên)

> Đi trước Phase 0 dù §7 xếp ngược: ba gap phải để lại fixture **theo chuẩn này**, nên chuẩn phải
> tồn tại trước, nếu không phải viết lại cả ba.

```text
Read docs/00-start-here/HANDOFF.md, docs/autopilot-templates/level3.1-adoption-plan.md and
docs/standards/review-code-readiness-gate.md first. Authority: DD-100.

OUTCOME: define and enforce the kit-wide fixture standard — "a gate that cannot fail is not a gate".

PRECONDITIONS you must verify yourself before doing anything:
- Is B1 closed (lane chat-dm-safety-authority-core--v2 merged)? If not → AWAIT.
- Is B3 closed (git status --porcelain clean)? If not → AWAIT. Never register on a dirty base.

SCOPE:
- A fixture unit is ONE safety contract / failure branch, NOT one script.
- Every fixture asserts an exact exit code AND an exact HALT token. "non-zero" is not acceptable.
- Every fixture ships a positive control: the same input, valid, must PASS.
  Without a positive control an always-failing script also "passes".
- Any fixture that does not fail with the expected token turns the pack red.

NEGATIVE SCOPE: do NOT touch codex-review-pin.sh in this slice (T2/T3/T4 own that file).
Do NOT bump KIT_VERSION. Do NOT touch the manifest schema.

First regression case to encode (the scope-gate v14 header documents it against itself):
autopilot-backlog-reconcile hard-codes DEFAULT_BRANCH="main"; on a consumer whose default is "master",
`git grep … 2>/dev/null` fails silently and --check returns "No stale entries" with exit 0 while
checking nothing at all.

CONSTRAINTS: this is kit-maintenance. gate_profile light does NOT apply. Do NOT self-certify using the
same gate this slice modifies — go through the separately reviewed kit-maintenance path.

Open a backport entry in docs/autopilot-backlog.md (consequence of the D1 fork).
Terminate at READY | AWAIT | HALT.
```

---

## T2 — Phase0-gap1: reviewer nhận đúng scope

```text
Authority: DD-100. PRECONDITION: T1 merged (the fixture standard exists). If not → AWAIT.

MEASURED PROBLEM (measured 2026-08-09 — re-measure, do not trust this line):
scripts/codex-review-pin.sh has NO assertion that the scope passed to the reviewer equals the bound
diff. There is only prose near L89.

REQUIREMENT: the wrapper/validator must assert that the passed scope == the bound diff.
Regression fixture per the T1 standard: empty or wrong scope → exit != 0 with a fixed HALT token,
plus a positive control.

NEGATIVE SCOPE: do NOT touch auth-tier classification (T3 owns it), attestation (T4 owns it), or
fix-round-count (T5 owns it). One writer, one file.

Kit-maintenance: full gate, no self-certification. Backport entry required.
Terminate at READY | AWAIT | HALT.
```

---

## T3 — Phase0-gap2: phân loại auth-tier bằng HALT token riêng

```text
Authority: DD-100. PRECONDITION: T2 merged. If not → AWAIT.

MEASURED PROBLEM: grepping codex-review-pin.sh for auth/quota/entitlement HALT tokens returns ZERO.
Every reviewer failure collapses into one bucket, so "out of quota" is indistinguishable from
"auth is dead".

REQUIREMENT: distinguish four classes, each with its OWN HALT token:
  entitlement (400) | quota | auth-death | transient connector
Ship a fixture for EACH branch asserting the EXACT token (not merely non-zero), plus a positive control.

DO NOT bring back from GENERIC v0.6.0: inline bash in the prompt (verdict_present(), model_auth_dead(),
rmcp stripping). Solve this with classified HALT tokens, not hand-pasted bash.

NEGATIVE SCOPE: same as T2. Kit-maintenance: full gate, no self-certification. Backport entry required.
Terminate at READY | AWAIT | HALT.
```

---

## T4 — P5: reviewer attestation (đóng làn A)

```text
Authority: DD-100. PRECONDITION: T3 merged. If not → AWAIT.

CORRECT DIAGNOSIS (round 1 of the discussion doc got this backwards — do not repeat it):
the final gate ALREADY scrubs AUTOPILOT_CODEX_REVIEW_MODEL/EFFORT/TIER, BASH_ENV, ENV and NODE_OPTIONS
via trustedReviewEnvironment(). At the gate the wrapper default ALWAYS wins. Therefore do NOT add
reviewer_model to the manifest — that would create a second authority source for the same fact, which
is exactly the SECOND_SOURCE defect.

REQUIREMENTS:
- The wrapper is the SINGLE source of model/effort/tier.
- The wrapper emits an attestation into the artifact: actual model, binary path, version.
- The validator checks that the attestation exists and is well-formed, and records it in
  gate-result.json. It must NOT compare against any manifest-declared field.
- Fixture per the T1 standard: missing or malformed attestation → exact HALT token; positive control.

NEGATIVE SCOPE: the terra/sol mismatch in the old template and run-docs is legacy-doc cleanup.
SPLIT it into its own docs slice; do not fold it in here.

Kit-maintenance: full gate, no self-certification. Backport entry required.
Terminate at READY | AWAIT | HALT.
```

---

## T5 — Phase0-gap3: infra-flake không ăn budget (làn B, song song làn A)

```text
Authority: DD-100. PRECONDITIONS: B1 and B3 closed. Independent of T1–T4 because this slice does NOT
write codex-review-pin.sh. Before writing, confirm your target files do not intersect lane A.
If they do → AWAIT; do not run in parallel.

PROBLEM: infrastructure failures still increment fix-round-count, so they consume budget and corrupt
the very MAX_ROUNDS signal that P1 (T6) relies on for its justification.

REQUIREMENT: infrastructure failures must NOT increment fix-round-count.
Fixture: simulated flake → counter unchanged.
Positive control is mandatory: a real finding → counter +1.
(Without the positive control, a dead counter also "passes".)

MEASURED CONTEXT — re-measure, do not trust these numbers:
budgets.fix_rounds_max = 5 (autopilot-review-readiness.mjs:377, manifests/_TEMPLATE.json:56);
the scope-gate v27 header records a MAXR_HALT that sat one round off. Read the scope-gate header
before changing anything.

Kit-maintenance: full gate, no self-certification. Backport entry required.
Terminate at READY | AWAIT | HALT.
```

---

## T6 — P1: schema v3 + `design_contract` (đắt nhất)

```text
Authority: DD-100 decision D3. PRECONDITION: T5 merged (gap3 closed). If not → AWAIT — P1 depends on
the MAX_ROUNDS signal that gap3 corrupts.

OWNER DECISION D3: ACCEPT level3-operational-v3 with a v2/v3 transition window.

REQUIREMENTS:
- design_contract exists ONLY under manifest_schema_version: level3-operational-v3.
- Change BOTH files in coordination, accepting v2 and v3 during the transition window.
  Pinned locations measured 2026-08-09 (re-measure): autopilot-review-readiness.mjs:273-274 and
  autopilot-scope-gate:547,550,607,640.
- Do NOT retrofit any active v2 manifest — the runtime manifest is hash-locked after register, so
  adding a field forces MANIFEST_DRIFT. In-flight tasks live out their lifecycle on v2.
- Do NOT add manifest_schema_version to authored contracts under docs/autopilot-manifests/
  (scope-gate:548 HALTs CONTRACT_INVALID).

design_contract block (v3 runtime manifest only) and its fail-closed checks at register:
  change_class = nl_or_fuzzy       → design_probe non-empty, contains MECHANISM: and FINITE_SET:;
                                     FINITE_SET must not match /blocklist|stopword|denylist/i
                                     → HALT DESIGN_PROBE_REQUIRED
  change_class in {money_state, identity_permission}
                                   → decision_table non-empty AND security_review.required forced true
                                     → HALT TABLE_GAP / CONTRACT_INVALID
                                   → fail_closed = true
                                     → HALT STATE_CONSERVATION / CONTRACT_INVALID
  single_source.helper = "none"    → reason non-empty → HALT SECOND_SOURCE

State the limit plainly in the doc: the gate checks EXISTENCE and TIMING, not whether the decision
table is CORRECT. The value is in forcing it to be written before the code.

Ship a fixture per the T1 standard for every HALT token above.
Kit-maintenance: full gate, no self-certification. Backport entry required.
Terminate at READY | AWAIT | HALT.
```

---

## T7 — P3: `gate_profile: light`

```text
Authority: DD-100. PRECONDITION: T6 merged.

RULE: light applies ONLY when risk = P2 AND change_class in {docs, prompt} AND scope <= N files
AND `git diff --stat` touches no code directory.

BLOCKING OPEN QUESTION: the owner has not answered discussion-doc §8.5 — what is N, and are docs/prompt
the only two eligible classes? Until answered → AWAIT. Do NOT pick N yourself.

- light = clean_rounds 1, empty e2e is valid, integration worktree skipped.
- NO profile may ever permit 0 rounds.
- The profile is COMPUTED BY THE GATE from the manifest plus the real diff.
  Declaring docs while the diff touches src/ → GATE_INPUT_DRIFT.
- light NEVER applies when the diff touches: canonical kit/consumer authority, manifest/schema,
  the scope or readiness validator, the reviewer wrapper, security/authz policy, or the
  review-readiness gate — even when the file extension is .md/.json/.sh.

NOTE: the validator only lets P1/P2 register (autopilot-review-readiness.mjs:311). P3 is read-only and
never passes through register, so a P3 profile is meaningless — do not build one.

Kit-maintenance: full gate, no self-certification. Backport entry required.
Terminate at READY | AWAIT | HALT.
```

---

## T8 — D4: xoá maturity-ledger + `proactive_routine`

```text
Authority: DD-100 decision D4 (owner-delegated, decided on measured evidence).
PRECONDITION: T6 merged.

RE-MEASURE BEFORE DELETING — do not trust this prompt:
- grep -rn "proactive_routine" docs/autopilot-manifests/ .autopilot/state/ docs/autopilot/contracts/
  → must be ZERO. Any hit → STOP and report AWAIT.
- grep autonomy_mode across every manifest → must be entirely "supervised".

DELETION SCOPE:
- .autopilot/maturity-ledger.md
- .gitignore:55-57 (the exception and its v0.6.0 auto-merge rationale)
- proactive_routine at autopilot-review-readiness.mjs:316
- proactive_routine at docs/autopilot-templates/level3-workflow.md:47,72,172,385
- maturity-ledger references in docs/autopilot-ONBOARDING.md (3 places)
- scripts/autopilot-onboard.sh:236 (drop it from the required-file check)
- the <!-- level3-workflow:start --> … :end block in CLAUDE.md (the proactive_routine line)

POST-CHECK: autopilot-onboard.sh still runs clean and reports no missing file.
Fixture: a manifest declaring proactive_routine → HALT (the enum no longer accepts it).

Kit-maintenance: full gate, no self-certification. Backport entry required.
Terminate at READY | AWAIT | HALT.
```

---

## T9 — P6: dọn tầng tài liệu (đóng vòng)

```text
Authority: DD-100. PRECONDITIONS: T6 and T8 merged.

ROLE SPLIT — one concept, one definition site:
- level3-workflow.md          = the operating model
- autopilot-prompt-GENERIC.md = the role contract
- _TEMPLATE.json              = the ONLY place that enumerates fields
- autopilot-invariants.md     = lessons NOT YET or NOT POSSIBLE to mechanize

WORK:
- Tag every mechanized invariants bullet with (mech: <field|HALT_CODE>).
  An untagged bullet is still pure prose and belongs in the queue for a later mechanization round.
- Clean up the remaining CHANGE_CLASS references in autopilot-ONBOARDING.md.
- Update level3.1-adoption-plan.md: move the verdict once blockers are closed, or mark it superseded.
- Update DD-100 in decisions.md if reality has refuted any part of D1–D4.

FINALLY — the D1 debt: open a backport slice that lifts T1–T8 into canonical
"$HOME/Projects/Claude template/autopilot/", bump the canonical KIT_VERSION, then sync Plexco back
to clear the fork. Skip this and the fork becomes permanent.

Terminate at READY | AWAIT | HALT.
```

---

## Hai việc của owner, không phải prompt

| Việc | Đóng blocker | Thao tác |
|---|---|---|
| CI billing | B2 | GitHub → Settings → Billing → Actions minutes/spending limit; rồi re-run CI trên `main`, cần **1 run xanh** xác nhận mitigation `4cc574c` |
| Working tree | B3 | 130 file chưa commit gồm reorg `docs/features/`. Commit thành lô riêng hoặc revert. `register` sẽ bind base bẩn nếu bỏ qua |
