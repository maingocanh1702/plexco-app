<!-- review-readiness: enforce -->

# AP-51 — deps-osv-transitive-floors: raise nanoid / brace-expansion / postcss past their OSV advisories

> **Status:** authored 2026-08-10 · **Risk:** P2 · **preparation-only — no worktree opened, no code written.**
> **Base:** `9d7d6ac0dbaf171758b8e427067e1074d20a8f29` (`main` = `origin/main`, measured 2026-08-10).
> **Manifest:** `docs/autopilot-manifests/deps-osv-transitive-floors.json`
> This is an AUTHORING artifact. No `register` has been attempted.

---

## 1. What this closes

`Security / OSV full dependency scan` is red on `main`. Measured at run #219 on `9d7d6ac`:

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

## 8. Verdict

```text
REVIEW_POLICY_VERSION: 1.3
REVIEW_VERDICT: NOT_CODE_READY
REVIEWED_AT: 2026-08-10
AUTHORITY_SHA: 9d7d6ac0dbaf171758b8e427067e1074d20a8f29
BASE_BRANCH: main
TARGET_FILES:
  - package.json
  - pnpm-lock.yaml
  - osv-scanner.toml
  - docs/autopilot-manifests/deps-osv-transitive-floors.json
  - docs/autopilot/contracts/autopilot-deps-osv-transitive-floors.md
  - docs/autopilot-backlog.md
SLICE: deps-osv-transitive-floors
IN_SCOPE: raise the effective pnpm override floors for nanoid, brace-expansion 5.x and postcss past the six OSV advisories measured at Security run 219; delete the dead GHSA-67mh-4wv8-2f99 ignore from osv-scanner.toml; regenerate pnpm-lock.yaml
OUT_OF_SCOPE: any edit to pnpm-workspace.yaml; lowering or bypassing minimumReleaseAge, trustPolicy or blockExoticSubdeps; unrelated dependency upgrades; hand-editing pnpm-lock.yaml; adding any new IgnoredVulns entry; changes to security.yml or ci.yml
G1_DECISION: PASS
G2_SPEC: PASS
G3_DEPENDENCY: PASS
G4_TEST: FAIL
G5_SCOPE: PASS
G6_EXTERNAL: FAIL
HARD_DEPENDENCIES: none
PRIOR_SLICES: deps-security-bump (three registrations, 2026-07-26..30); pnpm-override-precedence-two-locations (merged 92c7832); pnpm-workspace-esbuild-override-inert
OPEN_QUESTIONS_IN_SCOPE: 0
ENABLEMENT_ONLY_GATES: none
LIVE_REPO_VERIFICATION: PASS
CONTRACT_MATRIX: PASS
CLOSURE_MATRIX: PARTIAL
ACCEPTANCE_MATRIX: FAIL
SECURITY_AND_MIGRATION_GATE: PASS
IMPLEMENTATION_ARTIFACTS: NOT_REQUIRED_FOR_PLAN_READY
FIRST_IMPLEMENTATION_STEP: measure the publish date of nanoid@3.3.17, brace-expansion@5.0.9 and postcss@8.5.23 against minimumReleaseAge, and split out any target still inside the window
REMAINING_BLOCKERS:
  - blocker: release age of the three target versions is unmeasured; any target inside the 7-day window must be split out per the 2026-07-26 owner decision
    owner: assigned writer at implementation time
    resolution: publish dates measured and each package either included or split out
  - blocker: CI verify is red on main at the Test step, unrelated to this slice, traced to 286f48b (2026-08-04)
    owner: Owner
    resolution: Test step green on main, or an owner record that this slice may land against a known-red Test step
NEXT_REVIEW_TRIGGER: publish dates measured for all three targets, plus a decision on landing against the red Test step
```

---

## 9. Changelog

| Date | Change |
| --- | --- |
| 2026-08-10 | Authored from Security run #219 on `9d7d6ac`. Pinned the override-location rule, the release-age decision, the expired brace-expansion trap, the dead ignore, and the properties-not-literals lesson from `deps-security-bump` registration #2. Verdict `NOT_CODE_READY`. |
