# AP-51 — owner runbook · `deps-osv-transitive-floors` · đóng blocker và tái thẩm định

> **Slice:** P2 · nâng sàn override cho `nanoid` / `brace-expansion` 5.x / `postcss`
> **Manifest:** `docs/autopilot-manifests/deps-osv-transitive-floors.json`
> **Contract:** `docs/autopilot/contracts/autopilot-deps-osv-transitive-floors.md`
> **Soạn:** 2026-08-11 · `main` = `origin/main` = `005a44e`
>
> Ngôn ngữ: prose dẫn tiếng Việt, khối paste tiếng Anh — theo `ap23-inbound-webhook-RUN.md`.

---

## Vì sao slice này vừa lên đầu hàng đợi

`Security` đỏ trên `main`, và `--log-failed` chỉ đúng một job: **`OSV full dependency scan / osv-scan`**.
Semgrep xanh. Nghĩa là 6 advisory này không phải việc dọn dẹp bên lề — chúng là thứ **duy nhất** đang giữ
Security đỏ. Một gate đỏ vĩnh viễn là một gate không ai còn đọc.

## Hai blocker của packet đều đã đóng — kèm bằng chứng

Verdict `NOT_CODE_READY` ngày 2026-08-10 treo trên đúng hai điều, `NEXT_REVIEW_TRIGGER` ghi rõ. Cả hai
giờ đã có câu trả lời đo được:

**Blocker 1 — tuổi phát hành.** `minimumReleaseAge: 10080` = 7 ngày. Đo lúc `2026-08-11T05:29Z`
(mốc chặn: publish trước `2026-08-04T05:29Z`):

| Package | Đích | Publish | Tuổi | Qua sàn? |
| --- | --- | --- | --- | --- |
| `nanoid` | 3.3.17 | `2026-08-03T10:39:22Z` | 7d 18h | ✓ (sát) |
| `brace-expansion` | 5.0.9 | `2026-07-30T10:00:32Z` | 11d 19h | ✓ |
| `postcss` | 8.5.23 | `2026-07-24T17:05:13Z` | 17d 12h | ✓ |

Cả ba qua. `nanoid@3.3.17` chỉ vượt mốc từ `2026-08-10T10:39Z` — tức khi packet được soạn ngày 10/08 nó
có thể **vẫn còn trong cửa sổ**. Không cần split package nào.

**Blocker 2 — CI đỏ ở step Test.** Đã xanh: run `CI` trên `005a44e`, 4m17s, `success`. Nguyên nhân là
`57P01` teardown race, đóng bởi AP-52 (`cb52bbe`, merged 2026-08-11).

## Chi tiết ngược đời phải giữ lại

**Version mới hơn lại không dùng được.** `nanoid@3.3.18` (publish 2026-08-07) mới 4 ngày, `postcss@8.5.26`
(2026-08-06) mới 5 ngày — cả hai **dưới sàn 7 ngày**. `minimumReleaseAge` biến "nâng lên bản mới nhất"
thành một hành động sai. Range `^8.5.23` sẽ rơi vào `8.5.25`, `^3.3.17` rơi đúng `3.3.17`.
Ai chạy `pnpm update --latest` sẽ đâm vào tường và tưởng lockfile hỏng.

**Và cửa sổ đó dịch.** `nanoid@3.3.18` đủ tuổi vào `2026-08-14`. Slice chạy sau ngày đó thì `^3.3.17`
resolve sang `3.3.18` — vẫn trên sàn advisory, hợp lệ, nhưng lockfile diff sẽ khác con số packet dự đoán.
Đây chính là lý do §6 của packet bắt viết check dưới dạng **thuộc tính**, không phải literal.

## Bước 1 — pass tái thẩm định (paste khối này)

```text
Read docs/00-start-here/HANDOFF.md and docs/standards/review-code-readiness-gate.md first.

OUTCOME: bring AP-51 deps-osv-transitive-floors from NOT_CODE_READY to strict CODE_READY. This is a
READINESS pass only — do NOT edit package.json, do NOT run pnpm install, do NOT create a branch or
worktree, do NOT register.

Both REMAINING_BLOCKERS in the verdict block have closed since the packet was authored on 2026-08-10.
Verify each yourself before using it; do not take these numbers on trust.

BLOCKER 1 — release age of the three targets. pnpm-workspace.yaml sets minimumReleaseAge: 10080 (7 days).
Measured at 2026-08-11T05:29Z, so the cutoff is "published before 2026-08-04T05:29Z":

  nanoid@3.3.17           published 2026-08-03T10:39:22Z   age  7d 18h   PASSES
  brace-expansion@5.0.9   published 2026-07-30T10:00:32Z   age 11d 19h   PASSES
  postcss@8.5.23          published 2026-07-24T17:05:13Z   age 17d 12h   PASSES

All three clear the floor, so no package splits out under section 3. Re-measure with
`npm view <pkg>@<version> time --json` and recompute against the moment you run, not against mine.
nanoid@3.3.17 only crossed the 7-day line on 2026-08-10T10:39Z — it is the one with no margin.

TWO CONSEQUENCES YOU MUST NOT MISS, both counterintuitive:

  (a) NEWER VERSIONS ARE NOT INSTALLABLE. nanoid@3.3.18 (2026-08-07) and postcss@8.5.26 (2026-08-06) are
      younger than 7 days and are therefore BELOW the floor pnpm will select from. "Upgrade to latest" is
      the wrong action here. A caret range resolves ^8.5.23 to 8.5.25 and ^3.3.17 to 3.3.17 today. Never
      run `pnpm update --latest`, and never read a refusal to install a brand-new version as a broken
      lockfile.
  (b) THE WINDOW MOVES. nanoid@3.3.18 becomes eligible on 2026-08-14. If implementation runs after that
      date, ^3.3.17 will resolve to 3.3.18 — still above the advisory floor, still correct, but the
      lockfile delta will not match the numbers written in the contract. This is exactly why section 6
      requires every verification check to be a PROPERTY ("no nanoid entry resolves below 3.3.17"), never
      a literal. Do not convert any property into a literal while editing.

BLOCKER 2 — CI red on main at the Test step, traced to 286f48b (2026-08-04). Now green: workflow CI on
005a44e concluded success in 4m17s. Root cause was a pg 57P01 teardown race in packages/db/src/test-harness.ts,
closed by AP-52 and merged as cb52bbe on 2026-08-11. Confirm with `gh run list --branch main --workflow CI`
and RECORD THE NUMBER OF CONSECUTIVE GREEN RUNS YOU OBSERVE. The historical failure rate was roughly 3 red
in 5, so one green run satisfies the blocker's literal wording but is weak evidence on its own. State the
count you actually saw; do not round it up to "stable".

DO NOT simply flip the verdict. Several live-truth claims in the packet have decayed since 2026-08-10:

1. base_sha in the manifest is 9d7d6ac0dbaf171758b8e427067e1074d20a8f29. main has moved to 005a44e and
   beyond. Re-pin base_sha to the current origin/main tip, measured now.
2. AUTHORITY_SHA in the verdict block is the same stale 9d7d6ac. Re-pin it.
3. The contract cites "Security run #219 on 9d7d6ac" for the advisory table. Confirm the six advisories
   and their fixed-in versions still match the CURRENT failing OSV run on main. If OSV now reports a
   different set — more, fewer, or different fixed-in versions — the target floors change and the whole
   section 1 table must be corrected. Get the current run with:
     gh run list --branch main --workflow Security --limit 1 --json databaseId -q '.[0].databaseId'
     gh run view <id> --log
4. Section 4 rests on `grep -c 'brace-expansion@1\.' pnpm-lock.yaml` returning 0, measured at 9d7d6ac.
   Re-measure on the current tree. If any v1 entry has returned, the runtime trap is live again
   (v1 is `module.exports = expandTop`, a function; v5 is CJS `exports.expand`, an object; minimatch@3.1.5
   calls it as a function, so pnpm install resolves cleanly and lint dies at call time) and brace-expansion
   splits out of this slice.
5. Section 5 claims the GHSA-67mh-4wv8-2f99 ignore in osv-scanner.toml is dead. Confirm the current OSV
   run still reports it as an unused ignore before keeping the deletion in scope.
6. dep_checks is [] and depends_on is []. That is CORRECT here — HARD_DEPENDENCIES is "none", so there is
   nothing to bind. Do NOT invent a dep_check entry to make the array non-empty.
7. G4_TEST: FAIL and G6_EXTERNAL: FAIL, CLOSURE_MATRIX: PARTIAL, ACCEPTANCE_MATRIX: FAIL. Re-derive each
   against the live repo and close them, or state precisely why one cannot close. Strict CODE_READY needs
   G1-G5 all PASS, CLOSURE_MATRIX 12/12, OPEN_QUESTIONS_IN_SCOPE 0, and no remaining blockers.
8. Flip the classification header from `<!-- review-readiness: enforce -->` to
   `<!-- review-readiness: code-ready -->` ONLY if strict CODE_READY is genuinely reached. If it is not,
   leave `enforce`, write NOT_CODE_READY with exact blockers, owners and binary resolutions, and stop.
   `pnpm review:check:changed` must be green before you finish either way — the validator rejects a
   code-ready document carrying a non-CODE_READY verdict.

Add a changelog row dated 2026-08-11 recording what you measured and what changed.

Scope for this pass: docs/autopilot/contracts/autopilot-deps-osv-transitive-floors.md,
docs/autopilot-manifests/deps-osv-transitive-floors.json, docs/autopilot-backlog.md. Nothing else.
Commits are the owner's — report the diff, do not commit.

Terminate at READY | AWAIT | HALT.
```

## Bước 2 — thực thi (chỉ sau khi bước 1 đạt strict `CODE_READY` và owner đã commit)

```
/ap-51-deps-osv-transitive-floors
```

## Ràng buộc còn hiệu lực khi bước 2 chạy

- **Sửa `package.json` `pnpm.overrides`, KHÔNG sửa `pnpm-workspace.yaml`.** Map trong `package.json`
  không rỗng nên nó **thay thế toàn bộ** map của workspace file — thêm floor bên đó sẽ vô hiệu mà nhìn
  vẫn như đã sửa. Repo đã trả giá một lần cho đúng lỗi này với `esbuild`.
- **Không bao giờ hạ `minimumReleaseAge` / `trustPolicy` / `blockExoticSubdeps`** (quyết định owner
  2026-07-26). Target còn trong cửa sổ thì **tách package đó ra**, báo `AWAIT RELEASE_AGE_WINDOW` kèm ngày
  đo — không chờ bên trong slice, không override.
- **Không thêm `IgnoredVulns` mới.** Slice này chỉ *xoá* một entry chết. Không nâng được sàn thì tách ra,
  không mute.
- **Serialize theo backlog.** `docs/autopilot-backlog.md` nằm trong scope của slice này và của các slice
  khác — `SCOPE_COLLISION` bắn khi scope **hoặc** invariants giao với một feature đang active.
- **Thứ tự register là load-bearing.** `register` ép `HEAD == base_sha`. Tạo worktree ở base sạch,
  register, chứng minh `.autopilot/state/<feature>/registered-manifest.sha256` tồn tại, *rồi* mới viết.
- **Viết closeout TRƯỚC khi chạy gate.** `gate-result.json` đóng băng `diff_files` tại thời điểm gate;
  mọi commit sau đó — kể cả commit closeout mà kit yêu cầu — làm `ap-finish.sh` không còn chứng minh được
  và lane phải đóng bằng `--authorized-close`. Đúng thứ vừa xảy ra với AP-52 ngày 2026-08-11.
