> **ĐÃ GỘP HẾT 2026-09-04.** Rows 3–7 → `docs/autopilot-backlog.md` của repo này (xem ghi chú
> giữa file). Rows 1, 2 và 8 → `Claude template/autopilot/autopilot-backlog.md` thành
> **E10-review-finding-at-cap-deadlock**, **E11-reviewer-isolation-cwd-scoped-only**,
> **E12-authority-not-where-the-checker-looks**. File này giữ lại làm nguồn văn xuôi — khuôn
> fenced của canonical không có trường `notes`.

---

# Backlog rows pending — Plexco, 2026-09-04

**Why this file exists instead of direct rows in `docs/autopilot-backlog.md`:** that file is inside
the REGISTERED SCOPE of the in-flight lane `zalo-credential-path-trace` (`.autopilot/INFLIGHT.md:207`).
Writing to it from another lane, or from the root working copy, is a scope collision. These rows merge
into `docs/autopilot-backlog.md` in one commit **after that lane lands**. Staging them here rather than
holding them in a session transcript is the point: ~25 review rounds of evidence have already been lost
once this week by not writing rows down.

Routing note for whoever merges: rows 1–3 are **canonical kit** concerns; 4–6 are Plexco-local.

---

## 1. A register/contract-time failure plants a terminal signal that survives its own fix

`scripts/autopilot-review-readiness.mjs:739-740` scans the state dir with `startsWith("HALT-")` /
`startsWith("AWAIT-FOUNDER-")` and halts `TERMINAL_CONFLICT`. A `register` that fails **contract
validation** writes `HALT-CONTRACT_INVALID.txt` into the lane's own namespace — before the branch is
bound to anything — and that file keeps blocking `ready` even after a **successful** re-register.

Worse, the signal's own `resolution:` line reads *"close this terminal lifecycle and create a fresh
successor task after fixing the cause"* — i.e. it prescribes a full re-registration for a defect the
lane has already fixed in place. That directly contradicts the standing ceiling of ONE registration
per slice.

**Three instances measured on 2026-09-04 alone:**
1. `session-routes-close-cancel` — `HALT BRANCH_MISMATCH` from a cwd mistake at register.
2. `session-routes-close-cancel` — `UNRESOLVED_REVIEW_FINDING`, whose only in-band exit is "a committed
   fix and fix-round increment", with no disposition for a finding resolved by a landed DECISION.
3. `dd118-runwithlang-coverage` — `HALT CONTRACT_INVALID` at 06:23:10Z from a `<` inside a PCRE
   lookbehind in `verification.focused[3]`; fixed and re-registered successfully at 06:24, hash-lock
   verified; the stale file still blocked `ready` at 06:34.

**The pattern worth naming:** the kit's cheapest *scripted* recovery from a stale signal is the most
expensive *real* action available, so every occurrence requires a human third party. Kit v16 already
fixed a structurally identical bug for the notify sentinel — the fix did not generalise.

**STRENGTHENED 2026-09-04 after a fifth instance — the defect is worse than first written.**
`zalo-credential-path-trace` reached the cap, had its pending file retired once, ran a full review
(attempt 7), and the review returned findings — so the gate wrote a NEW pending file and the trap
re-armed the same minute. At `fix_rounds_max`, the two clauses admit no valid counter value:

    :747  pending.head_sha === HEAD  -> false (fix committed, HEAD moved)
          fixRounds (5) <= pending.fix_round_count (5) -> TRUE  -> UNRESOLVED_REVIEW_FINDING
    :713  fixRounds (6) > max (5)                      -> TRUE  -> MAX_ROUNDS

So: **at the cap, ANY review round that returns findings permanently deadlocks the lane.**
Third-party retirement is a ONE-SHOT CLEAR, not a fix, and it costs one owner intervention per
round of findings, with no bound on how many. That is qualitatively worse than "the cheapest
scripted recovery is expensive" — here there is no recovery at all, scripted or otherwise, and
the lane cannot even self-diagnose its way out without editing gate-authored state, which it must
never do.

**Shape of a fix (not a mandate):** either do not plant a terminal signal for failures that occur before
anything is bound, or have a successful `register` supersede the lane's own prior register-time signals
automatically, the way a rename does by hand today. Kit-maintenance lane. Do NOT fix this from a feature
lane — `autopilot-review-readiness.mjs` is a pack file.

## 2. Reviewer isolation is cwd-scoped, not access-scoped

`gate-attempt-04` on `session-routes-close-cancel`: code round 01 ran **6** commands with cwd = the
FEATURE worktree; round 02 ran **0** there yet still enumerated `.autopilot/state/<feature>/` by
**absolute path** from the ephemeral cwd. The header of `autopilot-ephemeral-review-worktree.mjs`
guarantees `.autopilot/state` is "absent BY CONSTRUCTION" — true of the ephemeral tree, **not** true of
what the reviewer can reach. Round 01 additionally read prior-round evidence (`readiness.json`,
`gate-result.json`, `regions.log`, `fix-round-count.txt`) via `sed`.

Neither round read the CONTENT of `RETIREMENT-RECORD` or of prior findings — filenames only. So this did
not change that outcome, but "didn't matter here" is not "can't matter", and the 2026-08-13 ruling
(Arm C) exists precisely because a reviewer with access to prior artifacts re-emitted a plant-only
figure as fresh. **Retroactive impact on past lanes: unknown, not assessed.**

---

> **TRẠNG THÁI 2026-09-04, sau khi gộp.** Rows 3–7 **ĐÃ GỘP** vào `docs/autopilot-backlog.md`:
> row 3 → `## task: manifest-template-omits-format-check` (status `planned`)
> row 4 → `## task: authored-contracts-carry-no-immutable-base-sha` (status `idea`)
> row 5 → `## task: run-packet-l1-contradicts-dd56` (status `planned`)
> row 6 → `## task: gates-that-fire-correctly-split-remainder-unowned` (status `idea`)
> row 7 → khối **CẬP NHẬT 2026-09-04** trong `## task: db-zalo-bots-secret-hardening` đã có sẵn.
>
> **Rows 1, 2 và 8 KHÔNG thuộc repo này.** Cả ba là defect/bài học của **kit canonical**
> (`autopilot-review-readiness.mjs` và `autopilot-ephemeral-review-worktree.mjs` đều là pack file
> `overwrite_path: kit-sync`), và luật đứng cấm vá file kit từ trong repo consumer. Chúng đi vào
> `Claude template/autopilot/autopilot-backlog.md`, khuôn khác (`task_id`/`task_kind`/`layer`/
> `design_state`/probe/acceptance). Giữ nguyên văn dưới đây làm nguồn.

## 8. META-PATTERN, three instances in one day: an authority that exists but is not where the checker looks

This is the most consequential structural finding of 2026-09-04 and it is not any one lane's bug.

1. **DD-56 vs the reviewer's tree.** The amendment authorizing the close/cancel routes was on
   `origin/main`, but the pinned reviewer reads files from a detached worktree at the reviewed
   HEAD, where it did not exist. The authority was real and invisible. Fixed by merging
   `origin/main` into the branch so the authorization sat where the reviewer looks.
2. **KMS provider.** `decisions.md` plus fail-closed live code pinned AWS KMS on 2026-07-06, while
   a non-authority DRAFT said unpinned — and the DRAFT's claim, not the decision's, propagated
   into DD-117 D5. Two documents answering different questions were read as contradicting.
3. **Coordinator authorization vs the tracked packet.** `zalo-credential-path-trace` round-8 [P2]:
   the `_probe_note` edit was authorized by the coordinator in session, but no tracked packet or
   manifest amendment exists at HEAD, and — the reviewer's sharpest phrasing — *a document
   asserting its own expanded scope is not scope authority*. The reviewer is mechanically right,
   and the lane could not resolve it from inside.

**The common shape:** a decision is made, is real, and is binding — and the mechanism that
enforces it reads a different surface. Every instance cost review rounds, and instance 1 nearly
cost a wasted gate attempt.

**What follows, and it is a rule not a wish:** an authorization that changes what a lane may do
must land in the artifact the gate reads BEFORE the lane runs — the tracked packet, the manifest,
or `decisions.md` per DD-111 D4 — not only in a session transcript, a report, or a retirement
record. Session-only authorization is fine for third-party OPERATIONS (retiring a signal,
clearing a reservation), because no checker inspects those. It is NOT sufficient for anything a
reviewer will later be asked to verify. The coordinator owns getting it into the tracked artifact
first; a lane that discovers the gap mid-round has no way out and should AWAIT, as this one did.
