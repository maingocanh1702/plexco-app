# Next lanes — soạn 2026-08-14 · base `main` = `1fdba1d`

> Kế nhiệm `next-lanes-2026-08-13-RUN.md` (S1 đã xong → packet Session `CODE_READY` + DD-105;
> **S2 đang chạy**, chưa merge).
>
> ⚡ **Mới: `autonomy_mode: autonomous_to_ready` (DD-107).** Lane chạy thẳng tới READY, **không dừng hỏi
> owner giữa chừng**. Owner review **một lượt tại READY** qua Decision Ledger. Thang thẩm quyền A/B/C ở
> `level3-workflow.md` §6.1 — **Tier C vẫn AWAIT, đúng 8 mục, không rút gọn.**
>
> ⛔ **FE vẫn PENDING theo lệnh owner 13/08** — không track `.pen`, không mở page/component. Lane D dưới đây
> cố ý **không** chạm `docs/channels/web/FE/`.

---

## Trạng thái S2 — đang bay, và có một rủi ro cần biết

Branch `feat/session-service-create-command-core--v2`, 3 file / ~646 dòng thêm
(`packages/db/src/session-service.ts` + `.test.ts` + `index.ts`). Đang ở fix-round xử lý 2 finding P2:
date-representability guard (JS `Date` trước ~4713 BC vượt `timestamptz`) và deadlock-on-failure trong
concurrency test (`finally` await `pending` trước khi kết thúc tx giữ lock → rollback trước).

> ⚠️ **Session đó đang ở 98% context.** Nếu compact giữa fix-round, rủi ro thật là **mất `base_sha` và
> lịch sử vòng review** — không phải mất code (code đã commit). Trước khi làm gì khác, đọc
> `.autopilot/state/session-service-create-command-core--v2/manifest.json` để lấy lại `base_sha`, và
> `registered-manifest.sha256` phải tồn tại. Nếu session chết giữa chừng: **không** mở session mới trên
> cùng worktree cho tới khi xác nhận không còn writer nào sống.

**Next step của chính S2:** hai finding trên → commit → **hai vòng codex sạch liên tiếp** (`--base` là
`base_sha` trong manifest, **không phải `HEAD^`**) → `READY.txt` → owner merge bằng
`scripts/autopilot-root-lock` + `ap-merge.sh` trên máy owner.

**Sau khi S2 merge:** đây là **producer thật đầu tiên** cho outbox `0022`/`0023` — lần đầu thanh ~33% ở
`ROADMAP.md` có lý do để đổi. Nhớ chạy canonical runner rồi mới cập nhật trục Tests (813 hiện đo tại
`80a3464`).

---

## Chạy song song được với S2 — và vì sao

Scope S2 đã khai (authored manifest): `packages/db/src/session-service.ts` · `.test.ts` · `index.ts` ·
`docs/autopilot-manifests/session-service-create-command-core.json` ·
`docs/autopilot/contracts/autopilot-session-service-create-command-core.md` · **`docs/autopilot-backlog.md`**.
Invariant token: **`test-chain`**. Không có token `schema` (zero migration, zero `schema.ts` — chính là
ràng buộc M2 để nó không serialize với lane chat).

Suy ra ba ranh giới:

| Ranh giới | Hệ quả |
|---|---|
| `packages/db/src/index.ts` | Lane khác **không** được sửa barrel này khi S2 còn bay |
| `docs/autopilot-backlog.md` | **Shared hot file** — mọi lane đều ghi lúc finish ⇒ **serialize phần ghi backlog**, không song song |
| invariant `test-chain` | Lane khác **thêm test file vào canonical runner** sẽ đụng token này ⇒ docs-only lane an toàn, code lane thì không |

### ✅ Lane D — docs debt từ rà soát 13/08 (docs-only, **song song được ngay**)

Hoàn toàn rời khỏi S2: không chạm `packages/`, không thêm test, không chạm `index.ts`.

```text
Read docs/00-start-here/HANDOFF.md, docs/standards/review-code-readiness-gate.md and
docs/autopilot-templates/level3-workflow.md section 6.1 first.

AUTONOMY_MODE: autonomous_to_ready
DECISION_LEDGER: .autopilot/state/docs-debt-2026-08-13/DECISIONS.md
RISK: P2

OUTCOME: close the four documentation debts listed in docs/sessions/2026-08-13-docs-audit.md
section 8. Docs-only. No code, no migration, no worktree for packages/ or apps/.

1. Write docs/features/BE/feature_share_activities_tech.md — the BE companion is MISSING.
   The FE spec (docs/features/FE/feature_share_activities.md v1.0) defines two tables,
   player_activity_shares (tenant-scoped, RLS) and person_activity_cards (global-protected),
   with column and constraint detail that belongs in a BE spec and currently has no owner.
   This is the only unpaired spec in the 26 Product / 25 BE inventory. Read DD-73 through DD-78
   first: their sequencing is already decided — mirror it, do not re-derive it.
2. Add an Entry Points section to docs/templates/feature-spec-template.md and
   docs/templates/be-tech-spec-template.md, AND to the mandatory-section list at
   docs/features/README.md lines 12-16. Today 45 specs carry this table while no template
   supplies it and no check enforces it, so spec 52 will silently lack it.
3. Backfill the Entry Points table into the four specs that lack it: FE/feature_club.md,
   FE/feature_home.md, FE/feature_inapp_chat.md, BE/feature_club_tech.md. All four are listed as
   "upgraded" in docs/a-grade-doc-upgrade-2026-08-10.md; none has the table.
4. Port gate section 11.2 (docs/standards/review-code-readiness-gate.md lines 150-179) into
   docs/templates/review-doc-plan-session-template.md and bump its header from 1.2 to 1.3.
   That clause exists because its absence already produced a real HALT-AUTHORITY_AMBIGUOUS
   (AP-28). CLAUDE.md mandates the template for every review session, and the template does not
   currently carry the clause.

NEGATIVE SCOPE: do not touch docs/channels/web/** (FE is PENDING by owner order 2026-08-13).
  Do not touch packages/ or apps/. Do not change contract content of any Reviewed spec — that is
  Tier C. Do not write docs/autopilot-backlog.md until lane S2 has merged.

VERIFY: pnpm review:check:changed, prettier --check on every changed file, and confirm every
relative reference in the changed files resolves on disk.
```

### Lane E — kit friction B-rest · **đọc block xong thì chỉ 1/3 chạy được ngay**

Đọc cả ba block trong `docs/autopilot-backlog.md` (dòng 264 · 327 · 424) trước khi soạn prompt — và kết quả
đúng như cảnh báo "đừng tin title": **hai trong ba đang bị chính owner chặn lịch**, không phải chờ ai rảnh.

| Mục | Trạng thái thật | Kết luận |
|---|---|---|
| `classifier-blocks-kit-mandated-readiness-json` | Triage 12/08 đã **chỉ đúng fix**: validator không reject key thừa | ✅ **E1 — chạy ngay** |
| `codex-review-verdict-nondeterminism` | Owner **HOLD sequencing** 13/08; bước chạy được là **re-measurement**, precondition = *không lane nào đang cần review* | ⏸ **E2 — gated, S2 đang review** |
| `test-harness-acquire-...-leaks-client` | Owner ghi rõ **"intentionally UNSCHEDULED — stays `idea`"**, kèm lý do | ⛔ **E3 — KHÔNG tách lane riêng** |

---

#### E1 — Validator fail-closed trên key thừa của `readiness.json` ✅ chạy ngay

Đây là mục duy nhất trong ba mục có **fix đã được xác định**, không phải chờ đo. Triage 2026-08-12 đã đo:
`scripts/autopilot-review-readiness.mjs` chỉ presence/value-check 7 key và **không reject key ngoài
whitelist**, nên permission classifier là thứ *duy nhất* bắt được field tự-assert — tức một phán xử ad-hoc
đang gánh việc của một rule đáng lẽ phải deterministic.

Hai ca lịch sử **khác bản chất**, và fix phải giữ được sự khác nhau đó: ca 10/08 file đúng minimal ⇒ block
**SAI** (false positive); ca 11/08 file mang thêm field tự-assert ⇒ block **ĐÚNG** (true positive).
Discriminator là **nội dung**, không phải hành vi ghi file.

```text
Read docs/00-start-here/HANDOFF.md, docs/standards/review-code-readiness-gate.md and
docs/autopilot-templates/level3-workflow.md section 6.1 first.
Then read the backlog block `classifier-blocks-kit-mandated-readiness-json`
(docs/autopilot-backlog.md line 264) IN FULL, including the 2026-08-12 triage addendum. The
addendum, not the title, is the specification.

AUTONOMY_MODE: autonomous_to_ready
DECISION_LEDGER: .autopilot/state/readiness-evidence-strict-keys/DECISIONS.md
RISK: P2

OUTCOME: make scripts/autopilot-review-readiness.mjs fail closed on any key outside the
readiness-evidence whitelist, so that a writer self-asserting extra state is rejected by a
deterministic rule instead of by an ad-hoc permission-classifier judgement.

The measured defect: the validator presence/value-checks exactly seven fields
(evidence_schema_version, task_id, feature, base_sha, head_sha, acceptance.status,
breakers.status) and accepts unknown keys silently. Confirm this yourself in the source before
changing it; cite the exact lines in the ledger.

REQUIRED BEHAVIOUR
- Reject unknown keys at the top level AND inside `acceptance` and `breakers`. A nested
  self-assertion is the exact shape that caused the 2026-08-11 true positive.
- Fail with a distinct, greppable halt reason. Do not reuse EVIDENCE_STALE or
  ACCEPTANCE_NOT_SATISFIED — a reader must be able to tell "you added a field" apart from
  "your identity does not match".
- The error message must name the offending key(s). A writer hitting this at 2am should not
  have to diff against the template to find out what it means.
- Keep the whitelist and docs/autopilot-manifests/_READINESS_EVIDENCE_TEMPLATE.json in exact
  agreement. If they can drift, add the test that catches the drift.

TESTS (scripts/check-review-readiness.test.mjs or a sibling — match the existing style)
- minimal valid evidence still passes (guards the 2026-08-10 false positive: that file was
  CORRECT and must never be rejected again);
- evidence carrying an extra top-level key is rejected;
- evidence carrying an extra key inside acceptance or breakers is rejected;
- the whitelist matches the shipped template.

DO NOT, in this slice
- rename acceptance.status or breakers.status. The backlog floats that idea and it is a
  SEPARATE decision: renaming reduces false positives but can blind the true-positive case
  that line 254 of autopilot-prompt-GENERIC.md exists to catch. Record it in the ledger as
  deferred, with that reasoning; do not fold it in.
- change what the readiness gate itself verifies, or touch the review/verification flow.
- edit docs/autopilot-backlog.md until lanes S2 and D have both merged (shared hot file).

NOTE ON COUNTS: the validator layer is now 30 tests, not 17 (13 in
check-review-readiness.test.mjs + 17 in autopilot-ephemeral-review-worktree.test.mjs after the
readiness-evidence-strict-keys lane landed at a3c62ad). Historical note, superseded: 17 tests (13 + 4 from
scripts/autopilot-ephemeral-review-worktree.test.mjs, added by b53bc75 (+2) and 2d5834b (+2)).
If you add tests, state the new number explicitly in the READY report so the next full-suite
run is not misread as drift.

VERIFY: node --test on the changed test files; node scripts/check-review-readiness.mjs --all;
prettier --check on changed files; then prove the fix on a real artifact — construct both a
minimal and an extra-key readiness.json and show the validator's two different outcomes.
```

**Song song:** chạm `scripts/` — rời hẳn `packages/db` của S2 và `docs/` của Lane D. An toàn chạy ngay.

---

#### E1b — 🔴 Nợ P1 sinh ra từ E1: backport gate sang canonical kit

**Mở ngay khi E1 merge, đừng để nguội.** Vòng review 1 của E1 trả một **ADVISORY** quan trọng hơn cả
finding [P2] mà nó fix: *canonical mirror thiếu — một lần kit sync tương lai sẽ ghi đè gate của Plexco
bằng bản cũ **non-fail-closed***. Tức `autopilot-update.sh` sẽ **âm thầm revert** chính E1.

Đây là **lần thứ hai cùng footgun**, và repo đã có tiền lệ đóng nó:
`reviewer-isolation-backport-canonical-kit` — risk **P1**, invariant `review-integrity`, đóng bằng
backport **byte-identical** sang canonical `Claude template` (`f990469`) rồi push. E1b phải cùng hình
dạng, cùng risk class.

Vì sao P1 chứ không P2: mục đích tồn tại của E1 là biến một phán xử ad-hoc của permission classifier
thành **rule deterministic**. Nếu bản canonical còn mang phiên bản cũ, lần sync kế xoá đúng tính
deterministic đó — và **không test nào đỏ để báo**, vì test cũng bị ghi đè cùng lúc.

```text
Read the backlog block `reviewer-isolation-backport-canonical-kit` first — it is the merged
precedent for exactly this footgun and it records the shape of the fix.

OUTCOME: backport the hardened readiness validator from Plexco to the canonical kit so that
autopilot-update.sh cannot silently reinstate the pre-fix, non-fail-closed version.

The canonical source is autopilot/parallel/autopilot-review-readiness.mjs in the
`Claude template` repository; the Plexco copy is scripts/autopilot-review-readiness.mjs.
The backport must be byte-identical to the reviewed Plexco version, the same way the
reviewer-isolation backport was.

Also carry across the test that proves the enforcement WIRING, not only the helper. The E1
review found that unit tests can prove the helper works while nothing proves the gate calls it,
so a refactor could disable enforcement with every test green. A backport that copies the
helper and drops the wiring test reintroduces the same blind spot one level up.

Risk P1, invariant review-integrity. Verify by running the canonical kit's own tests, then
confirm a simulated autopilot-update.sh sync no longer regresses the Plexco gate.
```

#### E2 — Re-measure per-run detection ⏸ gated, **đừng chạy khi S2 còn review**

Owner đã ra hai phán quyết mà prompt phải tôn trọng, không được rút gọn:

1. **HOLD sequencing (13/08)** — chưa mở lane implement unanimity-of-M. Lý do từ chính data: miss-rate
   per-run ≈ **2/3**, wrong-pass của unanimity-M = `0.67^M` ⇒ M=3 mới ~0.30, mỗi +1 M chỉ mua ×0.67. Đó là
   **mitigation, không phải fix**; đòn bẩy thật là **tăng per-run detection**, không phải tăng M.
2. **Bước chạy được là (2) re-measurement**, sau khi (1) isolation fix đã land (đã xong, `f990469`).

**Precondition cứng: chỉ chạy khi KHÔNG lane nào đang cần review** — quota khan, đã có 2 lane từng park vì
cạn. **S2 đang ở vòng review ⇒ E2 phải đợi.**

```text
Read the backlog block `codex-review-verdict-nondeterminism` (docs/autopilot-backlog.md line 327)
IN FULL, then docs/decisions/analysis/codex-reviewer-determinism-2026-08-13/METHOD.md and
RESULTS.md. The owner ruling and the owner sequencing note at the end of that block are binding.

AUTONOMY_MODE: autonomous_to_ready
DECISION_LEDGER: .autopilot/state/reviewer-per-run-detection-remeasure/DECISIONS.md
RISK: P2

PRECONDITION — verify, do not assume: no other lane is mid-review anywhere in this repo. Check
.autopilot/worktrees/*/.autopilot/state/*/gate-attempt-*-code-review-round-*.txt and any
pending-review-finding.json. If any lane is mid-review, STOP and report; codex quota is scarce
and two lanes have already parked on exhaustion.

OUTCOME: measure PER-RUN DETECTION of the pinned reviewer, with the pointer-contamination
confound removed, on a frozen diff that is NOT the reviewer's own lane history. Report only.
This pass MUST NOT implement unanimity-of-M or change any gate logic — the owner placed that on
hold explicitly, and the reason is in the block: at miss-rate 0.67, sampling is a weak lever.

WHY THIS SPECIFIC DESIGN
- The 2026-08-13 Arm A measurement ran N=3 on byte-identical input and got CLEAN / CLEAN /
  FINDINGS. Its documented vehicle limitation: the diff under review was the reviewer's own
  lane history. This pass must remove that limitation.
- Confound (2), pointer contamination, is now closed (fresh detached worktree at HEAD). So the
  variance this pass measures is model variance plus whatever diff-size contributes.

METHOD
- Pick a frozen, already-merged diff that contains at least one KNOWN real defect, so misses
  are countable rather than inferred. State your choice and why in the ledger.
- Run the pinned reviewer N times (N in [3,5]) on identical input, each run asserting a clean
  state directory first, exactly as METHOD.md specifies.
- Pre-register the axes before running: verdict, actionable count, file:region set. Do not add
  axes after seeing results.
- Design the pass so it can also answer the carry-forward question recorded in the block: does
  diff size move per-run detection? That claim is testable and this is where to test it.

DELIVERABLE: an analysis doc under docs/decisions/analysis/ alongside the 2026-08-13 one, plus
a backlog update. Report per-run miss-rate with a confidence interval and state plainly whether
n is large enough to pin M. The previous pass could only establish direction; say so if that is
still true.
```

---

#### E3 — ⛔ Không tách lane riêng. Gắn vào lane nào chạm `test-harness.ts` kế tiếp

Owner ghi rõ trong block: *"intentionally UNSCHEDULED — stays `idea`. P2, test-harness only, blocks
nothing. Pick it up when a lane NEXT touches `packages/db/src/test-harness.ts`, so the fix and its
merged_probe land with work already reviewing that file; not worth a standalone lane."*

Hai lý do kỹ thuật củng cố quyết định đó: task khai `invariants: [test-chain]` — **cùng token với S2**, nên
lane riêng sẽ serialize chứ không song song; và `merged_probe` bắt buộc bind **symbol do chính fix tạo ra**,
không được bind `acquireChatDefinerLock`/`guardClientErrors`/`tearingDown` (cả ba đã có trên origin ⇒
false-flip "merged" ngay lúc author).

**Carrier tự nhiên: L2 (email/password order-4)** — lane đó sẽ thêm test real-PG nên chắc chắn đi qua
`test-harness.ts`. Dán đoạn này vào contract của L2 thay vì mở lane E3:

```text
RIDER (attach to whichever lane next touches packages/db/src/test-harness.ts)

Close the open defect at packages/db/src/test-harness.ts:293-313 while you are already in this
file. acquireChatDefinerLock creates a pg.Client, connects, then runs SELECT pg_advisory_lock.
Only the returned release() ever calls lockClient.end(). There is no try/catch spanning
connect -> return, so if connect() or the lock query rejects, the function throws, never returns
release, and leaks a connected client. guardClientErrors only attaches an 'error' event handler
for async idle errors; it does not cover this path.

Fix: wrap connect -> lock in try/catch; on failure best-effort await lockClient.end(), swallow
its own error, then rethrow. No path may return without either handing back a release() that
closes the client or closing it directly. Add a regression test that forces the lock query (or
connect) to reject and asserts no client is left open.

Do NOT close this by citing packages/db/src/migrate.test.ts:683 or the idempotency test at :689.
That comment documents a DIFFERENT defect (second-session deadlock) which is already closed by
the memoized bootstrap promise. This one is a single call leaking on an error path.

merged_probe MUST bind a symbol the FIX introduces (the error-path guard that closes the client,
or a named helper). It must NOT bind acquireChatDefinerLock, guardClientErrors or tearingDown —
all three already exist on origin and would false-flip "merged" at author time.

Provenance worth keeping in the commit message: this defect was found by run 3/3 of the
reviewer-determinism measurement on frozen diff d5b31f9. Runs 1 and 2 of the same pinned
reviewer on byte-identical input returned CLEAN and missed it. It is the concrete proof that
the reviewer's variance direction is false-CLEAN, so "2 clean rounds" can ship a real defect.
```

> Nếu anh muốn chạy E3 độc lập bất chấp, nó **chạy được** — fix mechanical, test rõ. Nhưng đó là **đảo một
> quyết định lịch trình owner đã ghi**, nên phải ghi lý do vào backlog, đừng làm im lặng.

### ⏸ C7 — chat slice 7 `chat-shared-message-command-core` (authoring, **đợi S2 merge**)

Packet + manifest **đã author** (còn untracked ở working tree). Không chặn bởi kỹ thuật — chặn bởi
`docs/autopilot-backlog.md`. Chạy ngay sau khi S2 merge xong.

Precondition tự verify, đừng kế thừa: DD-102 điều kiện cứng ĐÃ đóng (`0032` merged tại `80a3464`);
substrate là `0031` (channels/members/messages) + `0030`/`0032` (DM safety); **không chạm
`person_id`/`dm_key` semantics** — AP-54 (DD-103) chặn re-parent riêng.

### ⛔ Không chạy

- Mọi lane FE (DD-81 / M0.3 / M4) — lệnh owner 13/08.
- `chat-identity-merge-reparent-enablement` (AP-54) — blocked-by-design.
- Slice nào implement từ **DD-106 Q1/Q2/Q3** (Pay-for-Buddy · `chat_messages.embed_*` · `SessionCard`) —
  🟡 chưa chốt, đã gắn nhãn tại chỗ trong spec.

---

## Phiên tự chạy 5–6 giờ — thiết kế FAN-OUT, không phải pipeline

> Mục tiêu: **một** session chạy liên tục 5–6h, owner không ra quyết định nào giữa chừng.

**Ràng buộc quyết định hình dạng:** merge là việc của owner (AUTO_MERGE off, DD-107 giữ nguyên). Nên nếu
lane B cần lane A **merged** mới chạy được thì chuỗi **đứng ngay ở lần merge đầu** — và phiên 5h thành phiên
20 phút. Kết luận: **đừng xếp pipeline. Xếp fan-out.**

```
                 ┌── worktree A ── lane 1 ──▶ READY (branch A)
main@<base>  ────┼── worktree B ── lane 2 ──▶ READY (branch B)
   (đóng băng)   └── worktree C ── lane 3 ──▶ READY (branch C)
                                                  │
                              owner merge 1 lượt ─┘   ⇒ N interrupt → 1
```

Mọi lane branch từ **cùng một base đóng băng**, không lane nào đọc kết quả lane khác. Cuối phiên có N branch
cùng ở READY; owner merge một lượt.

### Bốn thứ phải đúng, nếu không phiên sẽ chết giữa chừng

**1. Context — đây là thứ giết phiên dài, không phải quota.** S2 dùng ~98% context cho **một** lane. Ba lane
trong một context là chắc chắn chết. Nên session cha phải là **conductor**: mỗi lane chạy trong **sub-agent
riêng**, cha chỉ giữ roster + đường dẫn ledger, **không bao giờ** kéo working context của lane vào mình.
Đây đúng là vai trò `level3-workflow.md` §4 mô tả (primary agent delegate cho child agent) và **chưa từng
dùng** ở repo này — mọi lane tới nay đều một-session-một-lane.

**2. Tier C = 0 xuyên suốt chuỗi.** Một mục Tier C ở lane thứ hai là AWAIT, và phiên dừng. Roster dưới đây
chọn theo tiêu chí đó, không theo kích thước.

**3. Codex quota — song song lúc build, TUẦN TỰ lúc review.** Mỗi lane cần ≥2 vòng CLEAN cộng fix round.
Ba lane review đồng thời đã từng làm park 2 lane vì cạn quota. Conductor phải giữ **một hàng đợi review
duy nhất**.

**4. `packages/db/src/index.ts` là barrel chung** — mọi lane chạm db đều append một khối export vào đó. Đây
là đụng **lúc merge**, không phải lúc build: mỗi worktree compile sạch. Chốt **thứ tự merge cố định** và
lường trước vài dòng resolve thủ công.

### Roster đề xuất cho 5–6h (sau khi S2 + E1 đã merge)

| # | Lane | Vùng file | Ước | Tier C |
|---|---|---|---|---|
| 1 | **L2 email/password order-4** | `apps/web/app/api/auth/**` · `apps/web/lib/**` · `packages/db/src/auth.ts` | ~2h | 0 |
| 2 | **L3 chat slice 7** | `packages/db/src/chat-*.ts` | ~1.5h | 0 (nếu khai đủ 2 negative scope) |
| 3 | **L1 publish + projector** | `packages/db/src/projector-*.ts` · `apps/bot/src/dispatcher.ts` | ~1.5h | 0 |

Ba vùng file **rời nhau hoàn toàn** trừ `index.ts`. Gộp **E3 rider** vào lane nào chạm `test-harness.ts`
trước (L2 nhiều khả năng nhất, vì nó thêm test real-PG).

### Prompt cho session conductor

```text
Read docs/00-start-here/HANDOFF.md, docs/standards/review-code-readiness-gate.md and
docs/autopilot-templates/level3-workflow.md sections 4, 6.1 and 7 first.

ROLE: you are a CONDUCTOR, not a writer. You will run for 5-6 hours without asking the owner
anything. You do not write product code yourself. You spawn one sub-agent per lane, each with
its own context, and you integrate their terminal states.

AUTONOMY_MODE: autonomous_to_ready
CONDUCTOR_LEDGER: .autopilot/state/conductor-<date>/DECISIONS.md

BASE: freeze one base SHA at the start (current origin/main). Every lane branches from THAT
base. No lane reads another lane's output. Record the SHA in the ledger and never move it.

LANES (build in parallel worktrees; see the roster in this RUN doc for scope and negative scope):
  1. L2 email/password bundle order-4 (DD-80), flag OFF   — include the E3 test-harness rider
  2. L3 chat slice 7 chat-shared-message-command-core
  3. L1 PublishSession + first real public_sessions projector

CONTEXT DISCIPLINE — the actual failure mode for a long session:
- Never load a lane's working context into your own. Read only the sub-agent's terminal report
  and its ledger path.
- If your own context passes ~60%, stop starting new lanes, finish integrating, and report.
  A conductor that compacts loses the base SHA and the lane roster; that is unrecoverable
  bookkeeping, not a retry.

REVIEW QUEUE — build in parallel, review SERIALLY:
- Only ONE lane may invoke scripts/codex-review-pin.sh at a time. Hold a simple queue.
- Account-wide codex saturation is a WAIT, not a downgrade. Two lanes have already parked on
  quota exhaustion in this repo.
- A round that fails for infrastructure reasons (DB role race, container flake, quota) is NOT a
  fix round. Do not let it consume a lane's fix-round budget. Record it as
  `round-NN infra:<reason>` in that lane's regions log, and only when the diff is unchanged
  from the previous round.

READINESS EVIDENCE — changed by lane E1, verify before the first gate call:
- Once `readiness-evidence-strict-keys` is merged, the gate FAILS CLOSED on any key outside the
  evidence whitelist, at the top level and inside `acceptance`/`breakers`.
- So every sub-agent must write the MINIMAL `readiness.json` resolved from
  `docs/autopilot-manifests/_READINESS_EVIDENCE_TEMPLATE.json` — identity, acceptance state,
  breaker state, nothing else. Adding a helpful-looking `notes` or `fix_round_count` field is now
  a halt, not a courtesy.
- This is the intended behaviour, not a regression: it converts an ad-hoc permission-classifier
  judgement into a deterministic rule. Do not work around it.

DECISION AUTHORITY: sections 6.1 tiers apply to you AND to every sub-agent.
- Tier A/B: decide, log, keep going.
- Tier C (the 8 items): do NOT stop the whole session. Park THAT lane with a written AWAIT note,
  move to the next lane, and report all parked items together at the end. A single Tier C item
  must cost one lane, not the session.

STOP CONDITIONS for the session (not for a single lane):
- your own context near exhaustion;
- codex unreachable for more than one backoff cycle;
- two lanes parked on Tier C (the roster was mis-chosen — say so).

DELIVERABLE at the end: N branches each at READY with its own gate-result.json and ledger, plus
one conductor summary: what landed at READY, what parked and why, the exact merge order for the
owner (fixed order matters — every db lane appends to packages/db/src/index.ts and those touch
at merge, not at build), and any Tier C items awaiting an owner decision.

Do NOT merge anything. AUTO_MERGE stays off.
```

---

## Task LỚN chạy được tới ready-to-merge

> **Tiêu chí chọn không phải kích thước, mà là MẬT ĐỘ TIER C.** Lane to mà mọi quyết định đã ghi trong
> `decisions.md` thì chạy thẳng tới READY; lane nhỏ mà còn 3 câu hỏi contract chưa chốt thì dừng 3 lần.
> Cột "Tier C" dưới đây là con số dự đoán lane có tới được READY không — không phải cột LOC.
>
> Nhắc luật demote (§6.1): **thay đổi mà một DD chỉ đích danh là Tier A, không phải Tier C** — thi hành một
> quyết định đã viết không phải là ra quyết định mới.

| Lane | Quy mô | Tier C dự kiến | Mở khoá cái gì |
|---|---|---|---|
| **L1 · PublishSession + projector `public_sessions` đầu tiên** | Lớn | **~0** | Projector THẬT đầu tiên ⇒ job infra hết code-dark; marketplace demo được; thanh ~33% lần đầu có lý do đổi |
| **L2 · Email/password bundle order-4 (DD-80)** | Lớn | ~0 (flag OFF ⇒ không enablement) | Đóng lane auth; mở đường gỡ 2 route Telegram-era |
| **L3 · Chat slice 7 + 8** | Lớn | 1–2 (biên embed/person_id) | Chat từ DB-root thành có service; mở đường API/UI |
| **L4 · Session commands còn lại + narrow action class** | Trung–lớn | ~0 (DD-104 D2a chỉ đích danh) | `authorizeTenantAction` có caller production đầu tiên sau 8 ngày code-dark |
| **L5 · Docs debt** (đã specc ở trên) | Trung | 0 | Chặn lỗi sinh sản ở template |

### L1 — `PublishSession` + real projector → `public_sessions` ⭐ giá trị cao nhất

**Vì sao Tier C ~0:** hợp đồng publish/draft-lifecycle **đã đóng** (Reviewed 23–24/07); whitelist
`public_sessions` **đã liệt kê tường minh** trong `0006` (15 cột) và **đã có invariant test canh**
(`rls-invariants.test.ts:171` — *"columns are EXACTLY the approved whitelist"*); action class
`publish_new_sessions` **đã tồn tại trong code** (`authorization.ts:25`), không cần sửa billing spec;
`0024` đã thêm CHECK capacity cho public session. Không cần migration mới.

**Vì sao đáng làm nhất:** đây là thứ duy nhất trong danh sách biến "infra merged nhưng code dark" thành
"sản phẩm chạy được". Job infra (`0022`/`0023` + dispatcher + queue + scheduler) đã merge từ 26–27/07 và
tới nay vẫn **0 real projector** — `productionStubDeliver` chỉ DLQ. L1 là consumer thật đầu tiên, ghép với
producer mà S2 vừa tạo.

**Ranh giới cứng:** projector **chỉ** ghi 15 cột whitelist; không tiền, không PII, không giới tính — HARD
RULE #2. Invariant test hiện có là forcing function, đừng nới nó. Không bật
`OUTBOX_DISPATCH_SCHEDULE_ENABLED` (đó là Tier C · enablement).

**Phụ thuộc:** S2 merged (lấy khuôn producer). Song song với L2/L3 được.

### L2 — Email/password bundle order-4 (DD-80), flag OFF

**Vì sao Tier C ~0:** schema **đã merge** ở `0016` và **100% code-dark** — `email_password_credentials`,
`auth_email_tokens`, `auth_pending_email_registrations` đều **0 production TS caller** (đo tại `1fdba1d`).
DD-80 đã chốt thứ tự slice và ràng buộc; đây là **đấu dây schema có sẵn vào route**, không phải thiết kế
contract mới. Flag OFF ⇒ không chạm enablement.

**Quy mô:** lớn — route đăng ký/verify/reset/login + rate-limit + audit + test real-PG. P1 ⇒ **bắt buộc
thêm một vòng security review** (`codex-review-pin.sh`), đúng theo §8.

**Song song:** chạm `apps/web` + `packages/db/src/auth.ts` — **không đụng** `session-service.ts` của S2.
Cẩn thận `packages/db/src/index.ts` nếu cần export mới ⇒ đợi S2 merge hoặc khai serialize.

### L3 — Chat slice 7 (shared message command) + slice 8 (DM lifecycle)

**Substrate đã đủ:** `0031` (channels/members/messages) + `0030`/`0032` (DM safety authority + single
read). DD-102 nghĩa vụ đã đóng. Packet slice 7 **đã author** (còn untracked).

**Hai ranh giới phải khai vào negative scope, nếu không sẽ chạm Tier C:**
- **Không** implement structured embed (`embed_type`/`embed_ref_id`/`embed_snapshot`) — **DD-106 Q2 🟡 chưa chốt**.
- **Không** chạm `person_id`/`dm_key` semantics — AP-54 / DD-103 chặn re-parent riêng.

Khai đủ hai câu đó thì Tier C về ~0 và lane chạy thẳng.

### L4 — Session commands còn lại + narrow per-op action class

`UpdateSession` · `CloseSession` · `CancelSession` (`AnnounceSession` nếu vừa budget). Mỗi op nhận **narrow
action class** trong `authorizeTenantAction` — hiện mới có 3 literal (`publish_new_sessions`,
`admin_mutation`, `integration_changes`).

**Vì sao Tier A dù sửa spec Reviewed:** `DD-104 D2a` chỉ đích danh *"action class hẹp trong
`authorizeTenantAction` (sửa contract billing, slice riêng)"*, và `DD-105` đã pin ranh giới nguyên tắc
(miễn theo **tính vô hình**, không phải "mutation nhỏ"). Owner đã quyết; lane chỉ thi hành.

**Phần thưởng phụ:** `authorizeTenantAction` merged `ddb69a9` (06/08) tới nay vẫn **0 production caller**.
L4 là caller đầu tiên — chấm dứt một trong bốn thứ code-dark.

**Phụ thuộc:** S2 merged (cùng file `session-service.ts`) ⇒ **KHÔNG song song với S2**.

---

## ⛔ Task lớn nhưng KHÔNG nên chạy autonomous lúc này

Ghi ra để khỏi ai chọn nhầm — cả hai đều to và hấp dẫn, và cả hai đều dày Tier C:

| Task | Vì sao dừng liên tục |
|---|---|
| **Waitlist promotion core (DD-45)** | Chạm **tiền** (derive charge lúc promotion, nhánh DD-49 rejoin), cần **migration mới** (`waitlist_entry_version` + promotion-retry job store), cộng CAS/lease sweep worker + state machine + DLQ. Ba mục Tier C ngay từ đầu (money · migration semantics · shared job tail). Chạy được, nhưng **supervised**, không autonomous. |
| **Mark-paid thủ công (DD-40, 4b.1)** | Đường tiền thuần. Và spec `feature_payment_reconcile` hiện đang mang mục **🟡 DD-106 Q1 chưa chốt** — implement từ spec đó rất dễ kéo nhầm phần chưa ratify vào. **Đợi owner chốt DD-106 Q1** rồi hẵng mở. |

---

## Thứ tự đề xuất

```
                      ┌──▶ L1 PublishSession + projector   ⭐ giá trị cao nhất
S2 (đang bay) ──merge─┼──▶ L4 Session commands + action class
                      └──▶ C7/L3 Chat slice 7 → 8

L2 Email/password order-4 ─────▶ chạy NGAY, song song, không đợi S2
L5 Docs debt (Lane D)     ─────▶ chạy NGAY, song song, không đợi S2
Lane E kit B-rest         ─────▶ chèn khi chờ review
```

**Ba lane khởi động được ngay hôm nay, không đợi S2:** L2 (`apps/web` + `auth.ts`) · L5 (docs) · Lane E
(`scripts/`). Cả ba rời hẳn `packages/db/src/session-service.ts`.

**Ba lane phải đợi S2 merge:** L1 và L4 (cùng vùng session/`index.ts`), C7/L3 (đụng
`docs/autopilot-backlog.md`).

**Vì sao Lane D nên chạy song song chứ không xếp hàng:** nó là docs-only, rời hoàn toàn khỏi
`packages/db`, và món #2 (Entry Points vào template) là **lỗi sinh sản** — mỗi ngày chưa sửa là thêm rủi ro
một spec mới sinh ra đã thiếu. Cùng loại với `fe-spec-template` v0.4 thiếu 4 section DD-99 và đã kịp sinh
ra 5 spec không promote được.

---

## Cách chạy một lane dưới `autonomous_to_ready`

Thêm vào task contract:

```text
AUTONOMY_MODE: autonomous_to_ready
DECISION_LEDGER: .autopilot/state/<feature>/DECISIONS.md
```

Rồi theo `level3-workflow.md` §6.1:

**Context — corpus thuộc phạm vi, nhưng không nạp được.** Đo tại `1fdba1d`: `docs/` là **303 file / 8,5 MB
/ ~2 triệu token**; riêng 6 doc lõi đã ~220k. Không cửa sổ context nào chứa nổi — bằng chứng sống là chính
session S2 đang ở 98%. Nên luật là **bảo đảm độ phủ, không phải đã nạp**:

1. **Luôn nạp (nhỏ):** khối live-truth `HANDOFF.md` · **bảng tổng hợp** `decisions.md` (dòng `| DD-nn |`,
   ~18k token, KHÔNG phải toàn thân 1.952 dòng) · `review-code-readiness-gate.md` · packet + manifest.
2. **Phần còn lại: search rồi GHI query vào ledger** — tên entity/cột/endpoint/danh từ feature, trên cả
   `docs/` lẫn `packages/`|`apps/`. Bản đồ: `docs-inventory.md` + `features/README.md`.
3. **Query rỗng cũng ghi.** *"Search `buddy` trong `decisions.md` → DD-26 cấm thêm model buddy"* là câu đáng
   lẽ ngăn được DD-106. Nhưng nhớ: **grep rỗng là bằng chứng về query, không phải về repo** — kiểm bằng một
   control case chắc chắn có trước khi tin null.

**Mâu thuẫn giữa docs thì tự giải theo thang authority 7 bậc** (§6.1): runtime truth > migrations +
`schema.ts` > `decisions.md` > spec Reviewed (mục gắn 🟡 bên trong **không** phải contract) > Draft/plan >
ROADMAP/BRD/PRD/TDD theo đúng câu hỏi mỗi cái sở hữu > index/summary. Packet trên branch thắng bản `main`.
Hai doc cùng khai canonical mà không cái nào dẫn được decision ID ⇒ Tier C, AWAIT.

- **Tier A** (derivable từ repo/spec/tiền lệ) → quyết, log 1 dòng, **không dừng**. Dừng ở đây là defect.
- **Tier B** (judgment, reversible, trong scope) → quyết, log đủ alternatives + lý do + bằng chứng đã đọc.
- **Tier C** (8 mục) → AWAIT thật.
- Budget overrun → re-slice hoặc log nguyên nhân **thiết kế**; **không** dừng hỏi một con số.
- Tiêu chí: **phép thử 10×** + tie-break `fail-closed > một nguồn sự thật > ít khái niệm > theo tiền lệ > reversible`.

Không đổi: worktree isolation · scope-gate register + verify `registered-manifest.sha256` · hai vòng codex
sạch · loop breaker · **human merge**.

---

_Soạn 2026-08-14 tại `main@1fdba1d`. Số/SHA trong file này là claim lúc soạn — verify lại trước khi dùng._
