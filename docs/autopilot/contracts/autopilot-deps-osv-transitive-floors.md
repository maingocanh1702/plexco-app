<!-- review-readiness: code-ready -->

# AP-51 — deps-osv-transitive-floors: raise nanoid / brace-expansion / postcss past their OSV advisories

> **Status:** authored 2026-08-10 · readiness re-verified and carried to strict `CODE_READY` **2026-08-11** · **Risk:** P2 · **preparation-only — no worktree opened, no code written.**
> **Base:** `005a44e6275bfd4b2c29e63c9a351fb2a9a1ced2` (`main` = `origin/main`, re-pinned 2026-08-11; authoring base was `9d7d6ac0dbaf171758b8e427067e1074d20a8f29`). The six scope files are byte-identical between the two bases — verified `git diff --stat 9d7d6ac..005a44e -- package.json pnpm-workspace.yaml pnpm-lock.yaml osv-scanner.toml <manifest> <this doc>` is empty — so every factual claim below about the tree still holds verbatim; only the SHA pin moved.
> **Manifest:** `docs/autopilot-manifests/deps-osv-transitive-floors.json`
> This is an AUTHORING artifact carried to strict `CODE_READY`. No `register` has been attempted; `register` + worktree creation are the owner's next action.

---

## 1. What this closes

`Security / OSV full dependency scan` is red on `main`. Measured at run #219 on `9d7d6ac`, and **re-verified unchanged 2026-08-11 at the current OSV run on `005a44e` (run id 31460751255)** — identical six advisories, identical fixed-in versions, identical summary line:

```
Total 3 packages affected by 6 known vulnerabilities (0 Critical, 5 High, 1 Medium, 0 Low) from 1 ecosystem.
6 vulnerabilities can be fixed.
```

| Advisory | CVSS | Package | Resolved | Fixed in |
| --- | --- | --- | --- | --- |
| GHSA-28wg-ghj8-5hjv | 8.2 | nanoid | 3.3.15 | 3.3.16 |
| GHSA-2v37-7h3g-55p8 | 8.2 | nanoid | 3.3.15 | **3.3.17** |
| GHSA-mh99-v99m-4gvg | 7.5 | brace-expansion | 5.0.7 | 5.0.8 |
| GHSA-rgw5-rvv9-x895 | 7.5 | brace-expansion | 5.0.7 | **5.0.9** |
| GHSA-r28c-9q8g-f849 | 7.5 | postcss | 8.5.16 | 8.5.18 |
| GHSA-fxqj-rqcc-2cmp | 6.3 | postcss | 8.5.16 | **8.5.23** |

Two advisories per package with different fixed versions. The floor must clear **both**, so the target is
the higher one in each row pair. All six are transitive, all six reached via `pnpm-lock.yaml`.

**Production exposure is 0** — nothing is deployed, there are zero business routes (10 API routes, all
auth/onboarding), zero FE screens, and Google login is fail-closed with empty `GOOGLE_OAUTH_*`. This is a
floor raise, not an incident. That does not make it optional: the scan is a merge gate, and a permanently
red gate is a gate everyone stops reading.

---

## 2. The one thing most likely to go wrong

**Edit `package.json`. Do not edit `pnpm-workspace.yaml`.**

Measured 2026-08-03 on pnpm 10.30.2 and written up in `docs/standards/dependency-override-precedence.md`:

> When `package.json` declares a **non-empty** `pnpm.overrides` map, it **replaces**
> `pnpm-workspace.yaml`'s `overrides` map entirely for dependency resolution — a whole-map replacement,
> not a per-key merge. Every key the workspace file declares is dropped, including keys `package.json`
> never mentions.

This repo's `package.json` map is non-empty:

```json
"pnpm": { "overrides": {
  "brace-expansion@1": "^1.1.16",
  "sharp": "^0.35.0",
  "postcss": "^8.5.10",
  "esbuild@<0.25.0": "0.25.12"
} }
```

so `pnpm-workspace.yaml`'s `overrides: { "postcss@<8.5.10": 8.5.16 }` is **already inert today**. A floor
added there would resolve nothing while looking correct in the diff — the same defect this repo already
paid for once with esbuild, which is why `62304b5` had to exist.

The workspace file is in `negative_scope` for this reason, not for tidiness.

---

## 3. Release-age gate — a scope decision, never an override

`pnpm-workspace.yaml` sets `minimumReleaseAge: 10080` (7 days). Owner decision, 2026-07-26, recorded in
backlog task `deps-security-bump`:

> The 7-day window exists to block exactly the hijacked-publish vector for which a fake "security fix" is
> the classic carrier. Trading that defence for a few days of earlier patching on a zero-exposure surface
> is a bad trade. Any future exception must be a per-package override with a stated reason and an expiry —
> never a global lowering of `minimumReleaseAge`.

That decision has already been applied once in this exact situation: on 2026-07-30 `postcss` was **split
out** of `deps-security-bump` because its patch (8.5.23) was still inside the window.

**Required first action, before any edit:** measure the publish date of each target version.

- Target older than 7 days → include it.
- Target inside the window → **split that package out**, report `AWAIT RELEASE_AGE_WINDOW` with the
  measured dates, and proceed with the remainder.
- Never lower the setting, never pass a per-invoke flag to bypass it, never add an `IgnoredVulns` entry
  to paper over it.

**Measured 2026-08-11 (this readiness pass)** — `npm view <pkg> time --json`, against now = `2026-08-11T05:35Z`,
so the cutoff is "published before `2026-08-04T05:35Z`":

| Target | Published | Age at measurement | Result |
| --- | --- | --- | --- |
| `nanoid@3.3.17` | `2026-08-03T10:39:22Z` | 7d 18h | **PASSES** — no margin; crossed the 7-day line only on 2026-08-10T10:39Z |
| `brace-expansion@5.0.9` | `2026-07-30T10:00:32Z` | 11d 19h | **PASSES** |
| `postcss@8.5.23` | `2026-07-24T17:05:13Z` | 17d 12h | **PASSES** |

All three clear the floor, so **no package splits out** under this section; `nanoid` stays in scope and the
`package.json :: nanoid@<3\.3\.17` merged-probe key is unchanged (the conditional repoint in the backlog note does not fire).

Two consequences that make "upgrade to latest" the WRONG action here — each is a property this slice must preserve, never a literal:

- **The newer versions are below the floor and are not installable.** `nanoid@3.3.18` (2026-08-07, 3d 13h old) and
  `postcss@8.5.26` (2026-08-06, 4d 21h old) are younger than 7 days, so pnpm will not select them. A caret range
  resolves `^3.3.17` → 3.3.17 and `^8.5.23` → 8.5.25 (2026-07-29, eligible) today. Never run `pnpm update --latest`,
  and never read a refusal to install a brand-new version as a broken lockfile.
- **The window moves.** `nanoid@3.3.18` becomes eligible on 2026-08-14T16:41Z. If implementation runs after that,
  `^3.3.17` resolves to 3.3.18 — still above the advisory floor, still correct, but the lockfile delta will not
  match any literal written here. This is exactly why §6 requires every verification check to be a PROPERTY
  ("no `nanoid` entry resolves below 3.3.17"), never a version literal. Do not convert any property into a literal.

---

## 4. brace-expansion — a trap that has expired, verify before trusting that

On 2026-07-29 `brace-expansion` was split out of `deps-security-bump` because forcing the v1 line to v5
**breaks at runtime**, not just at the semver level: v1 is `module.exports = expandTop` (a function),
v5 is CJS `exports.expand` (an object), and its only consumer `minimatch@3.1.5` calls it as a function —
`pnpm install` resolves cleanly and lint dies at call time with `expand is not a function`.

Measured at `9d7d6ac` on 2026-08-10:

```bash
grep -c 'brace-expansion@1\.' pnpm-lock.yaml   # -> 0
```

The v1 branch is gone, removed by the eslint 9→10 migration (`a93a4f6`) exactly as the 2026-07-29
decision predicted it would be. Only `brace-expansion@5.0.7` remains, so a plain 5.x floor is safe now.

**Re-measure this before relying on it.** If any `brace-expansion@1.*` entry has returned, the trap is
live again and `brace-expansion` splits out.

Keep the existing `"brace-expansion@1": "^1.1.16"` entry regardless — it is the guard that pinned the v1
line, and removing it is out of scope.

---

## 5. Dead ignore to delete

The same OSV run reports:

```
/github/workspace/osv-scanner.toml has unused ignores:
- GHSA-67mh-4wv8-2f99
```

That entry was a reachability argument for esbuild 0.18.20 reached via `drizzle-kit → @esbuild-kit/*`.
`62304b5` made the declared floor actually apply; the tree now resolves `esbuild@0.25.12` and
`esbuild@0.28.1`, both above the advisory's range, so the ignore matches nothing.

Delete the whole `[[IgnoredVulns]]` block. `osv-scanner.toml`'s own policy — *"an entry here is a
REACHABILITY argument, never a convenience mute"* — makes a stale entry worse than no entry: it is a
standing claim about the tree that is no longer true, and the next reader has no way to tell that from a
live one without re-deriving it.

Deleting it also restores the failure signal: if esbuild ever regresses below 0.25 the scan will say so
instead of silently honouring a mute written for a different tree.

---

## 6. Verification must be written as properties, not literals

Registration #2 of `deps-security-bump` had to be **disposed** because its runtime manifest hard-coded
`postcss==8.5.18` as a literal check. The runtime manifest is hash-locked after `register`, so when the
real target moved to 8.5.23 the check could not be corrected in place — `MANIFEST_DRIFT` on one side,
a wrong assertion on the other, and no legal edit between them.

Write every check as a property of the resolved tree:

- *"no `nanoid` entry resolves below 3.3.17"* — not *"`nanoid` is 3.3.17"*
- *"no `brace-expansion` entry in the 5.x line resolves below 5.0.9"*
- *"no `postcss` entry resolves below 8.5.23"*
- *"`pnpm-workspace.yaml` is byte-unchanged"*
- *"`pnpm-lock.yaml` shows version deltas only for the target packages and their forced transitives"*

A property survives a moving target. A literal does not, and this slice's target has moved once already.

---

## 7. Execution order

1. Measure publish age of `nanoid@3.3.17`, `brace-expansion@5.0.9`, `postcss@8.5.23`. Apply §3.
2. Re-measure `grep -c 'brace-expansion@1\.' pnpm-lock.yaml`. Apply §4.
3. Edit **`package.json` `pnpm.overrides` only**. Raise the `postcss` entry; add entries for `nanoid` and
   the `brace-expansion` 5.x line. Leave `brace-expansion@1`, `sharp` and `esbuild@<0.25.0` untouched.
4. `pnpm install` — regenerate `pnpm-lock.yaml`. Never hand-edit it.
5. Delete the dead `[[IgnoredVulns]]` block from `osv-scanner.toml`.
6. Run the focused checks in §6, then the canonical suite.
7. Re-run `osv-scanner -r ./` — expect 0 findings for the three packages and no "unused ignores" warning.
8. Update the backlog entry for this task with the measured result.

---

## 8. Blockers closed since authoring (2026-08-11)

**BLOCKER 1 — release age of the three targets.** Closed. Measured in §3: `nanoid@3.3.17`, `brace-expansion@5.0.9`
and `postcss@8.5.23` all cleared the 7-day `minimumReleaseAge`. No package splits out; the slice ships all three.

**BLOCKER 2 — CI red on `main` at the Test step.** Closed. Root cause was a Postgres `57P01 admin_shutdown`
teardown race in `packages/db/src/test-harness.ts`, fixed by AP-52 and merged as `cb52bbe`. The `CI` workflow on
the current tip `005a44e` (run id 31460750915) concluded **success**, and its `verify` job's **Test** step passed.
`005a44e` is a descendant of `cb52bbe`, so the green run includes the root-cause fix — not a lucky pass of the old
harness.

**Evidence strength, stated honestly (not rounded up to "stable").** Consecutive green `CI` runs observed on `main`
= **1** — the current tip only. The two runs immediately before it (`cb52bbe`, `a36ae80`) were cancelled by the
concurrency group, not completed; the last completed runs before the fix (`200f11f`, `e8311a9`) both failed at Test.
One green run meets the blocker's literal resolution ("Test step green on `main`") and is backed by a causal fix, but
it is a single observation on a historically flaky harness. The merge decision remains the owner's.

## 9. Acceptance matrix — expected result by §B2 group

Each property is checked at implementation time. A deps-floor slice has no runtime state, so several groups are
justified `N/A` rather than padded with invented cases.

| Group | Case | Precondition | Expected result | Check layer |
| --- | --- | --- | --- | --- |
| Happy path | Floors raised, install clean | `package.json` `pnpm.overrides` raises postcss and adds nanoid / brace-expansion 5.x floors | `pnpm install --frozen-lockfile` succeeds; `osv-scanner -r ./` reports 0 findings for the three packages | pnpm install + osv-scanner |
| Boundary | Release-age edge | a target younger than the 7-day `minimumReleaseAge` | that package splits out; `AWAIT RELEASE_AGE_WINDOW` with measured dates; remainder proceeds | §3 measurement — 2026-08-11: none split |
| Boundary | Moving window / caret drift | `^3.3.17` may resolve to 3.3.18 after 2026-08-14 | property "no `nanoid` entry resolves below 3.3.17" still holds — a property, never a literal | grep `pnpm-lock.yaml` |
| Authorization | N/A | build-config only; no tenant / person / role / RLS surface | — | — |
| Failure | A floor cannot be forced without a runtime break | e.g. `brace-expansion@1` present (v1→v5 breaks at call time) | split that package out; keep the `brace-expansion@1` guard | `grep -c 'brace-expansion@1\.' pnpm-lock.yaml` = 0 at `005a44e` → not triggered |
| Concurrency | Single writer | `writer_processes_max: 1`; lockfile regenerated deterministically | no competing writer; lockfile is reviewed output, never hand-edited | manifest |
| Migration | N/A | no DB migration, no schema / grant / RLS change | — | — |
| Security / privacy | No supply-chain control weakened to pass the scan | override map + `pnpm-workspace.yaml` controls | `pnpm-workspace.yaml` byte-unchanged; `minimumReleaseAge` / `trustPolicy` / `blockExoticSubdeps` untouched; no new `IgnoredVulns`; only the dead ignore deleted | `git diff --quiet pnpm-workspace.yaml`; osv-scanner.toml diff = one deletion; codex security round |
| Regression | Existing suite + no unrelated dep drift | base test count at `005a44e` (CI Test green); lockfile deltas | `pnpm -w test` at the same count or higher; `pnpm-lock.yaml` version deltas only for the three packages + their forced transitives | pnpm test; lockfile diff review |
| Observability | The scan gate itself | `Security / OSV full dependency scan` is the merge gate | post-change: 0 findings for the three packages, no "unused ignores" warning; backlog entry updated with the measured result | osv-scanner re-run; backlog |

## 10. Verdict

```text
REVIEW_POLICY_VERSION: 1.3
REVIEW_VERDICT: CODE_READY
REVIEWED_AT: 2026-08-11
AUTHORITY_SHA: 005a44e6275bfd4b2c29e63c9a351fb2a9a1ced2
BASE_BRANCH: main
TARGET_FILES:
  - package.json
  - pnpm-lock.yaml
  - osv-scanner.toml
  - docs/autopilot-manifests/deps-osv-transitive-floors.json
  - docs/autopilot/contracts/autopilot-deps-osv-transitive-floors.md
  - docs/autopilot-backlog.md
SLICE: deps-osv-transitive-floors
IN_SCOPE: raise the effective pnpm override floors for nanoid, brace-expansion 5.x and postcss past the six OSV advisories measured at Security run 219 and re-verified unchanged at the current OSV run on 005a44e; delete the dead GHSA-67mh-4wv8-2f99 ignore from osv-scanner.toml; regenerate pnpm-lock.yaml
OUT_OF_SCOPE: any edit to pnpm-workspace.yaml; lowering or bypassing minimumReleaseAge, trustPolicy or blockExoticSubdeps; unrelated dependency upgrades; hand-editing pnpm-lock.yaml; adding any new IgnoredVulns entry; changes to security.yml or ci.yml
G1_DECISION: PASS
G2_SPEC: PASS
G3_DEPENDENCY: PASS
G4_TEST: PASS
G5_SCOPE: PASS
G6_EXTERNAL: PASS
HARD_DEPENDENCIES: none
PRIOR_SLICES: deps-security-bump (three registrations, 2026-07-26..30); pnpm-override-precedence-two-locations (merged 92c7832); pnpm-workspace-esbuild-override-inert
OPEN_QUESTIONS_IN_SCOPE: 0
ENABLEMENT_ONLY_GATES: none
LIVE_REPO_VERIFICATION: PASS
CONTRACT_MATRIX: PASS
CLOSURE_MATRIX: PASS
ACCEPTANCE_MATRIX: PASS
SECURITY_AND_MIGRATION_GATE: PASS
IMPLEMENTATION_ARTIFACTS: PASS
FIRST_IMPLEMENTATION_STEP: edit package.json pnpm.overrides only — raise the postcss floor to >=8.5.23 and add a nanoid >=3.3.17 entry and a brace-expansion 5.x >=5.0.9 entry, leaving brace-expansion@1, sharp and esbuild@<0.25.0 untouched; then run pnpm install to regenerate pnpm-lock.yaml (all three targets cleared the 7-day minimumReleaseAge as measured 2026-08-11, so none split out)
REMAINING_BLOCKERS: none
```

---

## 11. Changelog

| Date | Change |
| --- | --- |
| 2026-08-11 | **Readiness pass → strict `CODE_READY`.** Base re-pinned `9d7d6ac`→`005a44e` (the six scope files are byte-identical between the two bases). Measured the three publish dates — nanoid@3.3.17 (08-03, 7d 18h), brace-expansion@5.0.9 (07-30, 11d 19h), postcss@8.5.23 (07-24, 17d 12h): all clear the 7-day floor, none split out (closes authoring BLOCKER 1). Re-verified the OSV advisory table unchanged at the current run on `005a44e` (6 advisories, same fixed-in versions), and GHSA-67mh-4wv8-2f99 still reported as an unused ignore. Re-measured `grep -c 'brace-expansion@1\.' pnpm-lock.yaml` = 0 (v1 trap still expired). CI Test step green on `005a44e` after AP-52 (`cb52bbe`) fixed the 57P01 teardown race (closes BLOCKER 2 — 1 consecutive green run observed, backed by the causal fix; not rounded up to "stable"). Flipped G4_TEST, G6_EXTERNAL, CLOSURE_MATRIX, ACCEPTANCE_MATRIX and IMPLEMENTATION_ARTIFACTS to PASS; added the §9 acceptance matrix; verdict `NOT_CODE_READY`→`CODE_READY`; header `enforce`→`code-ready`. |
| 2026-08-10 | Authored from Security run #219 on `9d7d6ac`. Pinned the override-location rule, the release-age decision, the expired brace-expansion trap, the dead ignore, and the properties-not-literals lesson from `deps-security-bump` registration #2. Verdict `NOT_CODE_READY`. |
