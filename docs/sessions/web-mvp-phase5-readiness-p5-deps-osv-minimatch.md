<!-- review-readiness: code-ready -->

# Step-0 readiness: L85 p5-deps-osv-minimatch (session P5-S14a)

- **0 Status.** Agent-facing. This record is the branch's first commit, written before the owned edits, in the form of lane L83's record (`docs/sessions/web-mvp-phase5-readiness-p5-docs-reconcile.md`). Its facts are the conductor's measured step-0 answer (leads 1-5, as the lane block carries them: §2, §3, §6) and the lane's step-0 measurements in this worktree at B (§3-§5), each quoted with its command or source and its access time. The conductor's ruling RO-L85-2 amended the control test (item 1, §7) and added the braces fact (item 2, §5) and the known limit (item 4, §5). The lane's goal, in the lane block's words: "the OSV full scan on main reads clean again for GHSA-g3hv-75wg-m249, by D6 branch (a), because no fixed minimatch installs under the repo's unchanged supply-chain settings before 2026-11-03T22:26Z."
- **1 Authority.** B = `8f930c272c95fb5644a7ad1d12ceb04960a4405e`, origin/main at the lane start (PR 155's merge). Paths: T = `osv-scanner.toml` (33 lines at B: the header :1-7, the braces entry :9-33), BL = `docs/autopilot-backlog.md`, PW = `pnpm-workspace.yaml`, LK = `pnpm-lock.yaml`, PJ = `package.json`, D = `docs/standards/decisions.md`, AC = `docs/autopilot/contracts/autopilot-deps-osv-transitive-floors.md` (AP-51's contract). The authority is the owner's answer of 2026-10-31 to the Security AWAIT after PR 155, "Mở lane L85 (Recommended)", which opened this lane, and D6 (D:2106 at B; lane L25, the braces entry, the reach rule RO-L25-1), a conductor decision under the owner's delegation of 2026-10-22 and the decision-log rule for a time-boxed, reach-argued `IgnoredVulns` entry. Every other lane choice (the branch, the dates, the row form, the acceptance, this record) is "decided by the conductor under the owner's delegation of 2026-10-22, not an owner signature" (RO-L85-1, RO-L85-2); the §3 ruling carries its own label.

## §2 The red check and its reach by the lockfile (leads 1-2)

- **Lead 1, the red check.** Security run 41204153013 (push, 8f930c2), job "OSV full dependency scan / osv-scan". Its log: "Total 1 package affected by 1 known vulnerability (0 Critical, 0 High, 1 Medium, 0 Low, 0 Unknown)". The finding: https://osv.dev/GHSA-g3hv-75wg-m249, CVSS 6.9, npm minimatch 10.2.5, fixed in 11.0.1, source `pnpm-lock.yaml`. The earlier main runs (5c225d8, 7cae19a, 630da9f) were green with the same lockfile, so the advisory is newly published.
- **Lead 2, reach by LK at B.** minimatch has no importer entry (the importers are eslint and typescript-eslint only). LK holds only 10.2.5 (:1539, :3100) and three dependents: `@eslint/config-array@0.23.5` (:2290-2294), `@typescript-eslint/typescript-estree@8.62.1` (:2695-2702), and a third entry whose dependency list is eslint's (:2936-2948; its header was inferred, and §4's `pnpm why` names it `eslint@10.7.0`). So it is lint tooling only, by the lockfile; §4 measures the rest.

## §3 The release-age window (lead 3) and AP-51's clause

- **Lead 3, the settings.** PW at B: `minimumReleaseAge: 10080` (7 days) at :7, `trustPolicy: no-downgrade` at :8, `blockExoticSubdeps: true` at :9. So no 11.x release can install before 2026-11-03T22:26Z (11.0.1 plus 7 days). The settings are never lowered or bypassed (§6).
- **The release times, measured** at 2026-10-31T13:41:02Z (20:41 Saigon) with `npm view minimatch time --json` against registry.npmjs.org (rc 0, 149 versions). They match lead 3's times (the conductor's, measured 20:3x).

| version | publish time (UTC) | age at 13:41:02Z | vs minimumReleaseAge 10080 min |
| --- | --- | --- | --- |
| 10.2.5 | 2026-03-30T18:08:07.247Z | 309332 min | older: installable |
| 10.2.6 | 2026-07-27T19:00:09.469Z | 137920 min | older: installable |
| 11.0.0 | 2026-10-27T21:19:21.401Z | 5301 min | younger: blocked |
| 11.0.1 | 2026-10-27T22:26:03.755Z | 5234 min | younger: blocked (clears 2026-11-03T22:26:03Z) |
| 11.0.2 | 2026-10-28T01:08:11.021Z | 5072 min | younger: blocked |
| 11.0.3 | 2026-10-28T20:00:34.713Z | 3940 min | younger: blocked |

- No 10.x later than 10.2.6 exists, no 12.x, and no prerelease in range. 10.2.6 installs under the unchanged settings but is affected (§4), so no fixed release installs before 2026-11-03T22:26:03Z.
- **AP-51's clause.** AC is an authoring artifact of 2026-08-10/11 for AP-51's own targets (nanoid, brace-expansion, postcss). Its §3 (:83-89) prescribes AWAIT RELEASE_AGE_WINDOW for a target inside the release-age window, and :88-89 reads in full: "Never lower the setting, never pass a per-invoke flag to bypass it, never add an `IgnoredVulns` entry to paper over it."
- **The ruling on the clause.** L85 keeps the first two clauses (its negative scope, §6). The third clause does not bind L85, because:
  1. the owner's answer of 2026-10-31 to the Security AWAIT after PR 155, "Mở lane L85 (Recommended)", chose this lane, whose named content is this time-boxed `IgnoredVulns` entry, over waiting for the window (main red until 2026-11-03T22:26Z): a later, specific owner choice outranks an authored slice procedure;
  2. the owner decision AP-51 quotes (AC:75-78, 2026-07-26) governs exceptions to the release-age window ("Any future exception must be a per-package override with a stated reason and an expiry — never a global lowering of `minimumReleaseAge`"): L85 makes no exception to the window and lowers nothing, so that decision is not engaged; the entry is not such an exception, and it still carries a reason and `ignoreUntil` 2026-12-30;
  3. D6 (D:2106, a conductor decision under the owner's delegation of 2026-10-22) is the decision-log rule for a time-boxed, reach-argued `IgnoredVulns` entry; the braces entry T:9-33 is its precedent;
  4. the entry does not paper over a reachable advisory: both trigger legs are measured false (§4), it expires, and the revisit row falls due when the window clears.
- **The ruling's label.** "derived by the lane orchestrator of session P5-S14a from the authorities above; Tier B, reversible (delete the entry); not an owner signature; flagged for the conductor's S4 check". With this line the question is closed in scope (OPEN_QUESTIONS_IN_SCOPE: 0).

## §4 Reach, measured at B

- **`pnpm why` in this worktree** (rc 0 both). `pnpm why -r --prod minimatch`: empty (0 bytes). `pnpm why -r minimatch`: "Found 1 version of minimatch"; `minimatch@10.2.5` parents: `@eslint/config-array@0.23.5` (via `eslint@10.7.0`), `@typescript-eslint/typescript-estree@8.62.1`, `eslint@10.7.0 [deduped]`; every chain ends at `plexco (devDependencies)` (eslint, @eslint/js, typescript-eslint, eslint-config-prettier).
- **The advisory, both pages opened on 2026-10-31 (about 13:4x UTC).** GitHub, https://github.com/advisories/GHSA-g3hv-75wg-m249: title "minimatch has potential denial of service via globparts amplification"; affected versions (npm minimatch) "< 11.0.1", patched versions "11.0.1"; the description opens "minimatch 10.2.6 contains an attacker-controlled pattern amplification in firstPhasePreProcess()..." and continues "...when optimizationLevel >= 2."; the trigger: "an attacker who can supply a glob pattern can therefore cause additional pattern entries to be generated..." "...during preprocessing, followed by quadratic pairwise processing, resulting in excessive cpu and memory consumption."; "Published Oct 27, 2026" (NVD Oct 29, 2026; GitHub Advisory Database Oct 30, 2026); CVE-2026-118764. OSV, https://osv.dev/vulnerability/GHSA-g3hv-75wg-m249: range SEMVER introduced "0" ("All previous versions are affected"), fixed "11.0.1", no last_affected; severity "6.9 (Medium) CVSS_V4 - CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:N/VI:N/VA:L/SC:N/SI:N/SA:N"; alias CVE-2026-118764; published "2026-10-30T23:09:55Z", modified "2026-10-30T23:15:07Z"; CWE-405 (a paraphrase, not a quote: the fetch tool paraphrased the long details text).
- **What it means.** 10.2.6 is affected ("< 11.0.1", and the description names 10.2.6 itself); no 10.x is fixed; the only fix is 11.0.1. The trigger needs both legs: an attacker-supplied glob pattern AND optimizationLevel >= 2.
- **The option leg: false.** minimatch 10.2.5 `dist/commonjs/index.js` :341-353 (esm :332-338, the same): `const { optimizationLevel = 1 } = this.options;`, then `if (optimizationLevel >= 2) {` calls `this.firstPhasePreProcess(globParts)` (:344) and secondPhasePreProcess (:345), and `else if (optimizationLevel >= 1)` calls levelOneOptimize (:349). So the advisory's function runs only at level >= 2, and the default is 1 (:661-662 is a second `>= 2` gate, not inspected). `optimizationLevel` occurs nowhere in `@eslint/config-array` 0.23.5 dist, eslint 10.7.0 lib or typescript-estree 8.62.1 dist (grep rc 1). The options every caller passes: config-array cjs :412-430 `doMatch(filepath, pattern, options = {})` builds `new minimatch.Minimatch(pattern, Object.assign({}, MINIMATCH_OPTIONS, options))` with `MINIMATCH_OPTIONS = { dot: true }`, and its only callers (:719 `doMatch(relativeFilePathToCheck, matcher)`, :728-730 `!doMatch(relativeFilePathToCheck, matcher, { flipNegate: true })`, :756 `doMatch(relativeFilePath, pattern)`) merge to `{ dot: true }` or `{ dot: true, flipNegate: true }`; eslint 10.7.0 `lib/eslint/eslint-helpers.js` :33 `const MINIMATCH_OPTIONS = { dot: true };`, used at :210 (globMatch) and :290 (patterns.map) as `new Minimatch(patternToUse, MINIMATCH_OPTIONS)`; typescript-estree 8.62.1 `dist/useProgramFromProjectService.js` :203-204 `minimatch(filePath, pattern, { dot: true })` over `allowDefaultProject`, and `eslint.config.mjs` sets neither projectService nor allowDefaultProject (grep: no hit), so it is never called with a pattern here. No caller sets optimizationLevel, so firstPhasePreProcess is never reached.
- **The pattern leg: false.** The tracked eslint config is `eslint.config.mjs` only (152 lines). Its patterns are literal `files`/`ignores` arrays (:8, :65, :85, :100, :125-126), with no process.env, readFile, readdir, fetch(, import(, require( or includeIgnoreFile hit (the two "gitignore" hits, :20-21, are comments). The lint invocation is PJ:10 `"lint": "eslint ."`, and eslint walks the repo's own file tree.
- **The next build lint step.** next 15.5.28 `dist/build/index.js` :493 `const ignoreESLint = Boolean(config.eslint.ignoreDuringBuilds);`; `apps/web/next.config.mjs` has no eslint key; `apps/web/package.json` :7 `"build": "node ../../scripts/stamp-sw.mjs && next build"`; next's `runLintCheck.js` :232 `eslint.lintFiles(lintDirs)` over its constant ESLINT_DEFAULT_DIRS (`lib/constants.js` :291-297: app, pages, components, lib, src). So `next build` runs eslint over fixed literals naming the repo's own directories, through eslint's `{ dot: true }` call sites: not a STOP (no external input, and the option leg is false for every caller).
- **STOP assessment (measured).** A fixed release installable under the unchanged settings: NO (§3). `pnpm why -r --prod minimatch` not empty: NO (it is empty). The trigger reachable from untrusted input: NO (both legs false: no caller passes optimizationLevel; every pattern is a repo literal). No STOP test fires, so the lane takes D6 branch (a) (§6).

## §5 The control scan, the braces entry, the known limit

- **The control scan (an export of B, run before this record; not re-run).** `ghcr.io/google/osv-scanner-action:v2.3.8` over an export of B, finished by 2026-10-31T13:55:54Z: rc 1; found exactly `minimatch@10.2.5:GHSA-g3hv-75wg-m249` (aliases CVE-2026-118764, GHSA-g3hv-75wg-m249); stderr "Scanned /src/pnpm-lock.yaml file and found 340 packages", "Loaded filter from: /src/osv-scanner.toml", "/src/osv-scanner.toml has unused ignores:" and " - GHSA-vfj7-8cjw-p6xm". PASS as measured, against the control test as amended by RO-L85-2 item 1 (§7).
- **The braces entry, measured.** T:9-33 filters nothing at B because GHSA-vfj7-8cjw-p6xm was withdrawn on 2026-10-23 (https://osv.dev/vulnerability/GHSA-vfj7-8cjw-p6xm, fetched by the conductor on 2026-10-31: "This advisory has been withdrawn because it's not a practically exploitable vulnerability."; withdrawn "2026-10-23T12:53:02Z"); the lockfile did not change (braces@3.0.3 is still resolved at LK:1186 and :2792, via @next/eslint-plugin-next 15.5.20 (:794) -> fast-glob 3.3.1 (:1408) -> micromatch 4.0.8 (:1535)); the entry stays byte-unchanged in L85, governed by RO-L25-1 (i) and DD-149 item 5, and its rows and L54 own it.
- **The known limit: not assessed.** Copies of the vulnerable function (files defining firstPhasePreProcess) are bundled in prettier 3.9.4 (`index.mjs`), drizzle-kit 0.31.10 (`bin.cjs`, `api.mjs`, `api.js`) and playwright(-core) 1.63.0 (playwright-core `lib/utilsBundle.js`, playwright `lib/transform/esmLoader.js`); none is under next (`next/dist/compiled` has `glob` only). They are not lockfile packages, so OSV cannot see them, and the new entry does not change them. Their use (options, pattern sources, prod or not) is not assessed. The entry's reason claims only the lockfile package minimatch@10.2.5 and its three lockfile parents; the revisit row's notes carry "check them at the bump".

## §6 The branch choice, ownership, negative scope (leads 4-5)

- **Lead 4, D6 branch (a) now** (D6: a conductor decision under the owner's delegation of 2026-10-22). ONE dated ignore, with the (a)(b)(c) reason T's own rule demands (T:3-7), in the form of the braces entry (T:9-33); `ignoreUntil` = 2026-12-30, the lane date 2026-10-31 plus 60 days (the L25-D6 rule). Plus ONE revisit backlog row for the bump, in the form of `braces-ghsa-vfj7-ignore-expiry-2026-12-21` (BL:6765-6783 at B); its window opens at the earliest on 2026-11-04 Saigon, when 11.0.1 clears minimumReleaseAge, and falls at the latest in L54's window 2026-12-01..14, before the `ignoreUntil`.
- **Why not the bump now.** No fixed release installs under the unchanged settings before 2026-11-03T22:26Z (§3), and the lane never lowers or bypasses them. A fixed release that becomes installable during the lane does not switch the branch by itself: it is raised to the conductor, because the bump has a different file set (PJ, LK) and needs the eslint same-files proof.
- **Lead 5, an owed fact for the bump.** The effective override map is PJ `pnpm.overrides` (:44-56), which the lockfile's `overrides:` section (LK:7-16) mirrors; PW:14-15's `overrides` is absent from the lockfile, i.e. inert. Recorded for the revisit row; this lane edits neither file.
- **Ownership (the lane block).** T: the new entry only, appended after :33; the header :1-7 and the braces entry :9-33 stay byte-unchanged. BL: ONE new row at the END only. `docs/sessions/web-mvp-phase5-readiness-p5-deps-osv-minimatch.md` (this file, new). Nothing else.
- **Negative scope (the lane block).** PJ, LK and PW stay byte-unchanged: no bump on this branch. minimumReleaseAge, trustPolicy and blockExoticSubdeps are never lowered, and no per-invoke flag bypasses them. Not touched: `.github/workflows/**`, every app and package file, D, the plan, dated session docs and the deploy-guard files; no edit of an existing backlog row; no doctl, no `gh workflow run` (an agent cannot dispatch the full scan), no GitHub variable; no secret value is ever read or printed.

## §7 Acceptance (the lane TESTS, as amended by RO-L85-2 item 1)

- `pnpm why -r --prod minimatch` in the worktree is empty, and `pnpm why -r minimatch` shows the dev chains: measured, quoted in §4.
- Control (an export of B): PASS as measured (§5): rc 1; exactly `minimatch@10.2.5:GHSA-g3hv-75wg-m249`; GHSA-vfj7-8cjw-p6xm listed as an unused ignore. Not re-run.
- HEAD (a `git archive` export of the lane HEAD, after commit 2), expected: rc 0 and no finding; stderr has "Loaded filter from: /src/osv-scanner.toml"; GHSA-g3hv-75wg-m249 appears in neither the findings nor the unused-ignores list; GHSA-vfj7-8cjw-p6xm is listed as unused exactly as at B, and no other id is in that list.
- m1 (a copy of the HEAD export with the new id changed by one character; never in the worktree), expected: rc 1; GHSA-g3hv-75wg-m249 is found again; the mutated id is listed as unused.
- Every scan output is saved; the HEAD and m1 scans run after commit 2.
- `pnpm review:check:changed` before every commit, and the full `pnpm review:check` at the end; `pnpm format:check`.
- The backlog reconcile (`scripts/autopilot-backlog-reconcile --check`): no new refusal and no malformed row.
- The standing checks: no AI attribution, no closing keyword followed by a PR or issue reference, and `git diff --name-only` from B to HEAD lists exactly the three owned files.
- CI runs the full suite on the PR. The PR's OSV dependency diff sees no dependency change. The full scan runs only on main, where it is the gate of the conductor's S4 post-merge check.

## §8 Owed

- **Commit 2, the owned edits.** (1) T: one `IgnoredVulns` entry for GHSA-g3hv-75wg-m249 appended after :33, in the form of the braces entry (:9-33), with `ignoreUntil` 2026-12-30 and the (a)(b)(c) reason T:3-7 demands, claiming only the lockfile package minimatch@10.2.5 and its three lockfile parents (§2, §4); the header :1-7 and :9-33 stay byte-unchanged. (2) BL: one revisit row at the END, in the form of `braces-ghsa-vfj7-ignore-expiry-2026-12-21` (by that form, the id is `minimatch-ghsa-g3hv-ignore-expiry-2026-12-30`), due at the earliest on 2026-11-04 Saigon and at the latest in L54's window 2026-12-01..14; its notes carry lead 5 (§6), a "Related:" line on the withdrawn braces advisory (§5) and a line to check the bundled copies at the bump (§5).
- **Then.** The HEAD and m1 scans (§7), the full `pnpm review:check`, `pnpm format:check` and the PR; the conductor's S4 check of the §3 ruling.

## §9 Verdict

Closure matrix (12 rows): 1 authority pinned by SHA PASS (B; TARGET_FILES = the three owned files, each on disk at this commit); 2 decisions in scope final PASS (the owner's answer of 2026-10-31 chose the lane; D6, a conductor decision under the owner's delegation of 2026-10-22, is the decision-log rule; AP-51's third clause is closed by the §3 ruling, labelled and flagged for S4; every other choice labelled, §1); 3 scope and owner clear PASS (the lane block's ownership and negative scope, §6); 4 dependencies classified PASS (PR 155 is B; the braces entry and its rows stay with L54, read only); 5 live repo matches the claims PASS (the release times, `pnpm why`, the installed callers' options, the eslint config, the next build lint step and the control scan, all measured at B, §3-§5); 6 data, API, state and auth contract PASS (scanner config and docs only; no dependency, schema, API or status change); 7 fail-closed PASS (no supply-chain setting lowered or bypassed; the entry expires 2026-12-30 and has a revisit row; the bundled copies are recorded as not assessed, never claimed safe); 8 open questions in scope = 0 PASS (§3); 9 acceptance matrix PASS (§7: the control as measured, HEAD and m1 as expectations after commit 2); 10 migration, security, rollback PASS (no migration; the reach is §4; rollback = delete the entry); 11 hard dependency merged PASS (PR 155 is B); 12 handoff ready PASS (§8 gives commit 2's content and form).

```text
REVIEW_POLICY_VERSION: 1.3
REVIEW_VERDICT: CODE_READY
REVIEWED_AT: 2026-10-31
AUTHORITY_SHA: 8f930c272c95fb5644a7ad1d12ceb04960a4405e
BASE_BRANCH: main
TARGET_FILES:
  - osv-scanner.toml
  - docs/autopilot-backlog.md
  - docs/sessions/web-mvp-phase5-readiness-p5-deps-osv-minimatch.md
SLICE: p5-deps-osv-minimatch
IN_SCOPE: lane L85: one dated IgnoredVulns entry for GHSA-g3hv-75wg-m249 appended after line 33 of osv-scanner.toml (D6 branch (a), D6 being a conductor decision under the owner's delegation of 2026-10-22; ignoreUntil 2026-12-30; the reason claims only minimatch@10.2.5 and its three lockfile parents); one revisit row for the minimatch bump at the END of docs/autopilot-backlog.md; this readiness file
OUT_OF_SCOPE: package.json, pnpm-lock.yaml and pnpm-workspace.yaml (no bump on this branch); any lowering or per-invoke bypass of minimumReleaseAge, trustPolicy or blockExoticSubdeps; the osv-scanner.toml header (lines 1-7) and braces entry (lines 9-33); .github/workflows/**; every app and package file; docs/standards/decisions.md; the plan, dated session docs and the deploy-guard files; any existing backlog row; doctl, gh workflow run, any GitHub variable; any secret value
G1_DECISION: PASS
G2_SPEC: PASS
G3_DEPENDENCY: PASS
G4_TEST: PASS
G5_SCOPE: PASS
G6_EXTERNAL: PASS
HARD_DEPENDENCIES: PR 155 (the base where the red scan ran), merged at AUTHORITY_SHA
PRIOR_SLICES: L25 braces ignore (osv-scanner.toml lines 9-33 and backlog row braces-ghsa-vfj7-ignore-expiry-2026-12-21) on main (read only)
OPEN_QUESTIONS_IN_SCOPE: 0
ENABLEMENT_ONLY_GATES: none
LIVE_REPO_VERIFICATION: PASS
CONTRACT_MATRIX: PASS
CLOSURE_MATRIX: PASS
ACCEPTANCE_MATRIX: PASS
SECURITY_AND_MIGRATION_GATE: PASS # no migration, no secret, no dependency or runtime change; the ignore's reach is measured in section 4 and it expires 2026-12-30
IMPLEMENTATION_ARTIFACTS: PASS
FIRST_IMPLEMENTATION_STEP: commit 2 appends the minimatch IgnoredVulns entry after osv-scanner.toml line 33 and one revisit row at the END of docs/autopilot-backlog.md per section 8, then the HEAD and m1 scans per section 7
REMAINING_BLOCKERS: none
NEXT_REVIEW_TRIGGER: re-issue this verdict if the conductor's S4 check rejects the section 3 ruling, if the conductor changes RO-L85-1 or RO-L85-2, if a fixed minimatch release becomes installable under the unchanged settings before the L85 PR merges (11.0.1 at 2026-11-03T22:26:03Z; raised to the conductor, never a branch switch inside the lane), or if a target file changes on main before the L85 PR merges
```
