<!-- review-readiness: code-ready -->

# Step-0 readiness: p3-osv-advisories (Phase 3 lane L1b)

> Agent-facing (English). Session P3-S1 step 0, written by the readiness reviewer (Opus 5.5 / max), not the writer.
> Authority: the owner's D5 addition of 2026-10-16 (verbatim in 3.1), lane block L1b of the P3-S1 brief (added by the
> conductor; it is not in `docs/autopilot-templates/web-mvp-phase3-2026-10-16-RUN.md` at c762c90), the DD-122 D4 review
> policy, `docs/standards/dependency-override-precedence.md` v1.2 (Measured) and this verdict.
> Base: `origin/main` `c762c900e4ca55bc8ed2a84c0a86f7d0d7d7cf0a` (re-fetched 2026-10-16T05:49:40Z: unchanged).
> Evidence outside the repo, in `Claude outputs/plexco-phase3/status/P3-S1-notes/`: `osv-before.json` (raw BEFORE scan),
> `p3-osv-advisories-dryrun.diff` and `p3-osv-advisories-dryrun-after.json` (section 2.5).
> Every D-n in 3.3 is "default applied, pending owner sign-off": the PR body repeats them and L17 consolidates them into
> one decisions entry. This file does not edit `docs/standards/decisions.md`.

## 1. Verdict

```text
REVIEW_POLICY_VERSION: 1.3
REVIEW_VERDICT: CODE_READY
REVIEWED_AT: 2026-10-16
AUTHORITY_SHA: c762c900e4ca55bc8ed2a84c0a86f7d0d7d7cf0a
BASE_BRANCH: main
TARGET_FILES:
  - package.json
  - pnpm-lock.yaml
  - docs/autopilot-backlog.md
SLICE: p3-osv-advisories
IN_SCOPE: root package.json only (devDependencies.sharp range; pnpm.overrides values brace-expansion@5 and sharp; two appended keys shell-quote@1 and source-map-js@1), the pnpm-lock.yaml that `pnpm install` regenerates from it (key set A5), and one new backlog row for braces GHSA-vfj7-8cjw-p6xm (no fixed version published)
OUT_OF_SCOPE: production and test code; pnpm-workspace.yaml (byte-unchanged, its inert postcss entry included); osv-scanner.toml (no ignore); .github/workflows/*; apps/*/package.json and packages/*/package.json; minimumReleaseAge, trustPolicy, blockExoticSubdeps and every other pnpm setting; `pnpm update` in any form; major bumps and new dependencies; next and its two Moderate advisories (OPEN); the brace-expansion@1, postcss, esbuild@<0.25.0 and nanoid override entries; every existing backlog row (osv-full-scan-red-on-main-2026-10 included); docs/standards/decisions.md; anything of PR #50
G1_DECISION: PASS # owner D5 addition 2026-10-16 (3.1); lane block: no owner decision needed
G2_SPEC: PASS # dependency slice: equivalent authority = lane block + DECISION TABLE + dependency-override-precedence.md v1.2 + section 3
G3_DEPENDENCY: PASS # root slice; every target version is on npm, past the 7-day window and resolvable under the repo policy (2.5)
G4_TEST: PASS # the lane adds no tests; acceptance properties A1-A15 pinned before code
G5_SCOPE: PASS # 3 exact files, 2 modules, 0 migrations; B3 counting rule and precautionary exception (section 4)
G6_EXTERNAL: PASS # no PII, money, provider or legal surface; supply-chain controls unchanged
HARD_DEPENDENCIES: none (root slice)
PRIOR_SLICES: none
OPEN_QUESTIONS_IN_SCOPE: 0 # D-1..D-9 pinned
ENABLEMENT_ONLY_GATES: none
LIVE_REPO_VERIFICATION: PASS # section 2, corrections C1-C6
CONTRACT_MATRIX: PASS # section 3
CLOSURE_MATRIX: PASS # 12/12, section 6
ACCEPTANCE_MATRIX: PASS # section 5
SECURITY_AND_MIGRATION_GATE: PASS # 0 migrations; no new lifecycle script, package name, trust downgrade or policy change (2.3, 2.5); the opus/max reviewer covers security
IMPLEMENTATION_ARTIFACTS: PASS # DD-122 D4: no scope-gate lifecycle; lane block + this file + the worktree at the exact base
FIRST_IMPLEMENTATION_STEP: in .autopilot/worktrees/p3-osv-advisories (base c762c90 plus this readiness commit), make the five root package.json edits of 3.2 and nothing else, run `pnpm install` (never `pnpm update`), then check A2, A5, A6 and A7 on the regenerated pnpm-lock.yaml and A8 with `pnpm install --frozen-lockfile` before any other step
REMAINING_BLOCKERS: none
```

## 2. Measured at base (c762c90)

### 2.1 Snapshot and policy

- Worktree HEAD = `origin/main` = c762c90 on `fix/p3-osv-advisories`, clean, no `index.lock`. pnpm 10.30.2 (`packageManager`),
  Node 25.6.0 locally, Node 22 in CI. CI installs with `pnpm install --frozen-lockfile` (`.github/workflows/ci.yml:66`, `:123`).
- Release policy `pnpm-workspace.yaml:7-9`: `minimumReleaseAge: 10080` (minutes = 7 days), `trustPolicy: no-downgrade`,
  `blockExoticSubdeps: true`. No `minimumReleaseAgeExclude`, no `.npmrc`, no other pnpm setting in root `package.json`.
- `osv-scanner.toml`: comments only, zero ignores; both scans below load it ("Loaded filter from .../osv-scanner.toml").

### 2.2 BEFORE scan

- Local: `docker run --rm -v "<worktree>":/src -w /src ghcr.io/google/osv-scanner:latest scan source -L pnpm-lock.yaml --format json`
  (osv-scanner 2.5.0) at 2026-10-16 05:22Z: 340 packages, exit 1, 9 advisories in 6 packages (`osv-before.json`).
- CI: Security run 38851467389 (push of c762c90, 2026-10-16 04:36Z), job "OSV full dependency scan / osv-scan" 116813381459
  = failure; image `osv-scanner-action:v2.3.8`, `scan-args: -r`, 340 packages from `pnpm-lock.yaml`: "Total 6 packages
  affected by 9 known vulnerabilities (1 Critical, 5 High, 3 Medium, 0 Low, 0 Unknown)". Same 9 ids and fixed versions as
  the local scan, and the same 9 as backlog row `osv-full-scan-red-on-main-2026-10` (run 38456110453, 2026-10-13).

### 2.3 Per-advisory facts and decision

Eligible = npm publish time + 10080 min, measured 2026-10-16 05:25Z (every fixed version below is eligible).

| # | Advisory (alias) | Sev | Package, installed | First fixed | Pulled by (`pnpm why -r`) | Fixed version published / eligible | Decision |
|---|---|---|---|---|---|---|---|
| 1 | GHSA-pqg4-j6r4-53mv (CVE-2026-102422) | Critical 9.2 | shell-quote 1.10.0 (affected >=1.8.4 <1.11.0) | 1.11.0 | transitive: `@plexco/db` dependency drizzle-orm@0.45.2 -> gel@2.2.0 (optional peer, `^1.8.1`) | 1.11.0 2026-09-29T02:34Z / 10-06; 1.12.0 2026-10-02T14:58Z / 10-09 | FIX: scoped override `"shell-quote@1": "^1.11.0"` (D-2) |
| 2 | GHSA-6j4f-fj2g-mc7p (CVE-2026-102276) | High 7.5 | brace-expansion 5.0.9 | 5.0.10 | transitive: root devDeps eslint@10.7.0 and typescript-eslint@8.62.1 -> minimatch@10.2.5 (`^5.0.5`); existing override `brace-expansion@5: ^5.0.9` | 5.0.10 2026-09-14T21:37Z / 09-21 | FIX: raise the existing override to `^5.0.12` (D-3) |
| 3 | GHSA-qhr7-859c-m2p7 (CVE-2026-102278) | High 7.5 | brace-expansion 5.0.9 | 5.0.11 | as #2 | 5.0.11 2026-09-14T21:49Z / 09-21 | FIX: same bump as #2 |
| 4 | GHSA-vfj7-8cjw-p6xm (CVE-2026-93687) | High 8.7 | braces 3.0.3 | none published (OSV: introduced 0, last_affected 3.0.3; npm latest 3.0.3) | transitive, lint only: root devDep @next/eslint-plugin-next@15.5.20 -> fast-glob@3.3.1 (exact pin) -> micromatch@4.0.8 (npm latest, `^3.0.3`) | none | BACKLOG ROW: no fixed version published (D-6, 3.4) |
| 5 | GHSA-wq5f-xc86-pv6w (librsvg CVE-2026-96889) | High 8.9 | sharp 0.35.4 + @img/sharp-libvips-* 1.3.3 | 0.35.5 | direct: root devDep `^0.35.4` (icon script); also next@15.5.25 optional dep `^0.34.3 \|\| ^0.35.4` (web runtime); bare override `sharp: ^0.35.4` | 0.35.5 2026-09-27T13:46Z / 10-04; all 26 @img packages by 2026-09-27T13:48Z / 10-04 | FIX: direct bump, devDependency and override together to `^0.35.5` (D-4) |
| 6 | GHSA-68fv-2mgg-jv7q (CVE-2026-93749) | High 8.7 | source-map-js 1.2.1 | 1.2.2 | transitive: postcss@8.5.25 (`^1.2.1`) under next@15.5.25 and vite@7.3.6 (vitest, all 4 packages) | 1.2.2 2026-09-30T14:08Z / 10-07 | FIX: scoped override `"source-map-js@1": "^1.2.2"` (D-2) |
| 7 | GHSA-q2hr-2g5m-vwhr (CVE-2026-102277) | Moderate 5.3 | brace-expansion 5.0.9 | 5.0.12 | as #2 | 5.0.12 2026-09-14T21:59Z / 09-21 | FIXED by the same bump as #2 (lane rule 4) |
| 8 | GHSA-4jqv-mc3x-m676 (CVE-2026-94543) | Moderate 6.3 | next 15.5.25 | 15.5.27 | direct: `@plexco/web` `next ^15.1.4` | 15.5.27 2026-09-30T16:19Z / 10-07 | OPEN, out of scope (D-8) |
| 9 | GHSA-mcj8-r9mp-w47p (CVE-2026-94484) | Moderate 6.3 | next 15.5.25 | 15.5.27 | as #8 | as #8 | OPEN, out of scope (D-8) |

- Lockfile: one version of each package; `packages:` keys `pnpm-lock.yaml:1173` (brace-expansion), `:1177` (braces), `:1724`
  (sharp), `:1741` (shell-quote), `:1748` (source-map-js); snapshots `:2779`, `:2783`, `:3284`, `:3323`, `:3328`.
- Majors: every fix stays on the installed line (shell-quote 1.x, source-map-js 1.x, brace-expansion 5.x, sharp 0.35.x, the
  0.x caret line). No fix needs a major bump or a code change, so no "breaking" backlog row exists.
- Trust (`no-downgrade`): sharp and all 26 @img packages carry npm provenance from a trusted publisher on both the old and
  the new version; shell-quote, brace-expansion and source-map-js have no attestation on any version (nothing to downgrade).
- Scripts and deps: every replacement version has `hasInstallScript: false` and no preinstall/install/postinstall; no bump
  adds or removes a dependency (only the exact @img and libvips pins move). brace-expansion's `prepare: tshy` is already on
  5.0.9 and never runs for a registry tarball. The youngest chosen version is shell-quote 1.12.0 (13 days at measurement).
- Reach: nothing in the repo imports `gel` or `drizzle-orm/gel` (0 files); sharp renders SVG in
  `scripts/generate-pwa-icons.mjs` (the librsvg path) and is next's image optimiser at web runtime; braces is lint-time only.

### 2.4 Override location (where pnpm overrides are in effect)

- Two declarations exist: root `package.json` `pnpm.overrides` (`:43-50`, 6 keys) and `pnpm-workspace.yaml` `overrides`
  (`:14-15`, one key, `"postcss@<8.5.10": 8.5.16`).
- Winner = root `package.json`. The lockfile header `overrides:` (`pnpm-lock.yaml:7-13`) lists exactly the 6 package.json keys
  and not the workspace key; `pnpm config get overrides --json` prints only the workspace key, the losing side, exactly as
  `docs/standards/dependency-override-precedence.md` v1.2 documents for pnpm 10.30.2 (a non-empty package.json map replaces
  the workspace map wholesale). History agrees: AP-45 `92c7832` measured it, AP-48 `62304b5` moved the esbuild floor into
  package.json to make it apply, AP-51 `0e8d252` raised its floors in package.json with the workspace file byte-unchanged; the
  inert workspace entry is tracked by backlog row `pnpm-workspace-postcss-override-inert`.
- So every override edit goes to root `package.json`; an edit to `pnpm-workspace.yaml` changes nothing.

### 2.5 Dry run (scratch copy of the 7 manifests and the lockfile, outside the repo; the worktree was not touched)

- R0 base: `pnpm install --lockfile-only` leaves the lockfile unchanged.
- R1 trap: moving only `devDependencies.sharp` to `^0.35.5` leaves sharp at 0.35.4 and the importer specifier at `^0.35.4`
  without any warning: the bare `sharp` override replaces the root's own specifier (also recorded in `15e5314`).
- R2 `pnpm update` route: `pnpm -r update source-map-js --lockfile-only`, `pnpm -r update shell-quote source-map-js
  --lockfile-only` and `pnpm update shell-quote` each rewrote about 540 lockfile lines and moved both packages: vite@7.3.6's
  subtree re-resolved (esbuild 0.28.1 -> 0.28.2, rollup 4.62.2 -> 4.64.3 with a new package `@napi-rs/lzma-linux-x64-gnu@1.5.1`,
  picomatch 4.0.5 -> 4.0.7, fdir, a second postcss 8.5.29, nanoid 3.3.20). The decision table's "lockfile update" branch is
  therefore not clean in this repo; its "else a scoped override" branch applies (D-2).
- R3 candidate (3.2 edits, then `pnpm install --lockfile-only`): package.json +6/-4, pnpm-lock.yaml +137/-135; the changed
  lockfile keys are exactly the A5 set; `pnpm install --frozen-lockfile` prints "Lockfile is up to date"; `pnpm ignored-builds`
  lists esbuild only (`esbuild@0.25.12`, `esbuild@0.28.1`), identical to base; `import('sharp')` reports sharp 0.35.5, vips
  8.18.7, rsvg 2.63.2 (base: 0.35.4, 8.18.6, 2.62.91). Resolved: shell-quote 1.12.0, source-map-js 1.2.2, brace-expansion
  5.0.12, sharp 0.35.5, @img 0.35.5, libvips 1.3.4.
- R3 AFTER prediction (same Docker scan on the candidate lockfile): 3 advisories left, braces GHSA-vfj7-8cjw-p6xm (High) and
  next GHSA-4jqv-mc3x-m676 and GHSA-mcj8-r9mp-w47p (Moderate); no id that BEFORE did not have.

### 2.6 Merge surface and tooling

- L0 (`docs/p3-docs-decisions-sync`, PR #59) edits `docs/autopilot-backlog.md` near base lines 3474, 5923-5940 and 6042-6055
  only; PR #50 (owner only) edits the package.json `scripts` block and appends backlog rows at its own older end of file;
  L1 and L2 are file-disjoint. Edits limited to `devDependencies` and `pnpm.overrides`, plus a row inserted between
  `osv-full-scan-red-on-main-2026-10` (`:6198-6215`) and `offline-page-csp-nonce-missing` (`:6217`), stay hunk-disjoint.
- No test or script reads `pnpm.overrides` or the lockfile; prettier checks `package.json` but ignores `pnpm-lock.yaml` and
  `docs/`; the backlog has no `REVIEW_VERDICT:` line, so `review:check` does not treat it as a verdict document.
- GitNexus: no code symbol changes in this lane, so impact analysis has no target; the PR body states that and the grep
  fallback (no importer of the bumped packages in repo code except `scripts/generate-pwa-icons.mjs` for sharp).

### 2.7 Corrections to the lane block and existing records

- C1 Backlog row `osv-full-scan-red-on-main-2026-10` (`:6198-6215`) says to raise the floors through an override in
  `pnpm-workspace.yaml` "following AP-51": wrong location (2.4); AP-51 edited package.json. That row is not edited here (new
  rows only); it goes under OPEN.
- C2 The lane's "or use the PR's 'OSV full dependency scan' check output" cannot work: `security.yml` runs `osv-full` only on
  push, schedule and workflow_dispatch, so it is skipping on the PR, which runs "OSV dependency diff" instead (D-7).
- C3 "5 High" are 5 advisories in 4 packages (brace-expansion carries two).
- C4 braces is the decision table's "no fixed version published" case, which the FILES IN SCOPE parenthetical ("breaking change
  or release-age") does not name; DONE WHEN still requires its row (D-6).
- C5 sharp is also next's optional dependency, i.e. on the web runtime path, not only the root icon script; the bare override
  governs both.
- C6 The "transitive: lockfile update" route is not reachable cleanly with `pnpm update` (R2).

## 3. Pinned contract

### 3.1 Authority

Owner, 2026-10-16, verbatim (`Claude outputs/plexco-phase3/status/CONDUCTOR-LOG.md`, entry 11:35): "fix the OSV advisories
on main (1 Critical shell-quote, 5 High) as a separate PR alongside L1, with full test runs; any bump that needs a breaking
change goes to the backlog instead." L0 records it in `docs/standards/decisions.md` (DD-137) on its own branch; L1b does not
depend on that merge.

### 3.2 Exact edits (root `package.json` only)

| Location | Base | Head |
|---|---|---|
| `devDependencies.sharp` (`:38`) | `"^0.35.4"` | `"^0.35.5"` |
| `pnpm.overrides["brace-expansion@5"]` (`:45`) | `"^5.0.9"` | `"^5.0.12"` |
| `pnpm.overrides.sharp` (`:46`) | `"^0.35.4"` | `"^0.35.5"` |
| `pnpm.overrides["shell-quote@1"]` (new, after `nanoid`) | absent | `"^1.11.0"` |
| `pnpm.overrides["source-map-js@1"]` (new, last key) | absent | `"^1.2.2"` |

Every other byte of `package.json` stays (2-space JSON; prettier checks it). Then, from the worktree root, `pnpm install`
regenerates `pnpm-lock.yaml` and `node_modules`; `pnpm install --frozen-lockfile` must then report the lockfile up to date.

### 3.3 Defaults (each: default applied, pending owner sign-off)

- D-1 Override location: root `package.json` `pnpm.overrides` (2.4). `pnpm-workspace.yaml` stays byte-unchanged, its inert
  postcss entry and stale comment included.
- D-2 shell-quote and source-map-js: scoped overrides on their own major line, `"shell-quote@1": "^1.11.0"` and
  `"source-map-js@1": "^1.2.2"`, in the selector style of the existing `brace-expansion@1` and `brace-expansion@5` keys (a
  0.x or 2.x request is never rewritten). Reason: the "lockfile update" branch is not clean (R2). Forbidden in this lane:
  `pnpm update`/`pnpm up` in any form, `pnpm dedupe`, a hand-edited lockfile, `--no-frozen-lockfile`.
- D-3 brace-expansion: raise the existing `brace-expansion@5` floor to `^5.0.12`, which closes #2, #3 and the Moderate #7 in
  one bump. `brace-expansion@1` stays as is: no 1.x in the graph (`grep -c 'brace-expansion@1\.' pnpm-lock.yaml` = 0) and the
  AP-51 v1/v5 API trap needs minimatch 3.x, which is absent (only minimatch@10.2.5).
- D-4 sharp: move the root devDependency range and the bare `sharp` override together to `^0.35.5` (R1).
- D-5 Versions are properties, not literals: pnpm picks the highest version that the range and the unchanged 7-day policy
  allow at install time. A later same-line version than the R3 values is correct while A2-A5 hold. If pnpm finds no mature
  version or reports a trust downgrade for one package, that package gets no bump and one backlog row (the exact pnpm error
  and, for an age refusal, the date it becomes eligible), and the other fixes proceed.
- D-6 braces GHSA-vfj7-8cjw-p6xm: no bump, no override, no `osv-scanner.toml` ignore; exactly one new backlog row (3.4),
  inserted right after the `osv-full-scan-red-on-main-2026-10` block and before `## task: offline-page-csp-nonce-missing`,
  not at the end of the file. The FILES IN SCOPE parenthetical is read to include the "no fixed version published" outcome
  (C4). No other row is added or edited.
- D-7 AFTER evidence: the BEFORE Docker command on the lane head, raw JSON saved as `P3-S1-notes/osv-after.json`. The PR body
  cites both lists, run 38851467389 and the PR's "OSV dependency diff" result; "OSV full dependency scan" stays outside CI
  GREEN and reruns on main after the merge.
- D-8 next (#8, #9; fixed 15.5.27, eligible since 2026-10-07T16:19Z) is not touched: OPEN.
- D-9 B3 as in section 4.

### 3.4 The new backlog row (fields fixed; prose language as in the neighbouring 2026-10 rows)

| Field | Value |
|---|---|
| heading | `## task: braces-ghsa-vfj7-no-fixed-version` |
| title | braces 3.0.3 (GHSA-vfj7-8cjw-p6xm, High) has no fixed version; reached only on the lint path through @next/eslint-plugin-next |
| status / risk / change_class | `idea` / `P2` / `dependency-security` |
| depends_on / invariants / scope | `[]` / `[build-config]` / `[package.json, pnpm-lock.yaml]` |
| manifest / merged_probe / _probe_note | `null` / `null` / the neighbouring rows' "probe do slice tác giả đưa vào; chưa có." |
| _readiness | NOT_CODE_READY: no upstream fix; reopen on the trigger below |
| notes (must contain) | advisory id and alias CVE-2026-93687; severity High, CVSS 8.7; package braces; current version 3.0.3; first fixed version: none published (OSV introduced 0, last_affected 3.0.3; npm latest 3.0.3, measured 2026-10-16); reason: L1b decision table row "no fixed version published"; path @next/eslint-plugin-next@15.5.20 (root devDependency, exact) -> fast-glob@3.3.1 (exact pin, also in plugin 15.5.27, 15.5.28, 16.0.0 and the latest 16.4.2) -> micromatch@4.0.8 (npm latest, `^3.0.3`) -> braces@3.0.3, lint-time only; trigger: OSV gains a `fixed` event, or a same-major micromatch, fast-glob or @next/eslint-plugin-next release drops braces, then rerun the L1b decision table including the 7-day age |
| source line | L1b p3-osv-advisories step 0 · Security run 38851467389 (main c762c90) |

## 4. B3 (about 300 LOC, 3 modules, 1 migration)

- Counting rule: B3 LOC = hand-authored lines, `git diff --numstat c762c90..HEAD` without `pnpm-lock.yaml` and this file.
  Expected about 35 (package.json +6/-4, the row about 20-25). `pnpm-lock.yaml` is generated from package.json by pnpm and is
  bounded by its key set (A5), not by LOC: R3 measured +137/-135.
- Modules: 2 (the root dependency manifest with its generated lockfile; the docs backlog). Migrations: 0.
- Precautionary exception, for a reading that counts the lockfile (total about 310): the two modules above; a split breaks
  coherence because every fix edits the same `pnpm.overrides` map and regenerates the same lockfile, so split PRs conflict on
  both files and each repeats the owner's full test runs behind L1's exclusive window; compatibility proof: no source change,
  frozen install up to date (A8), the full VERIFY set (A9), key set A5. Caps: 80 hand-authored changed lines, 400 changed
  lockfile lines; a lockfile key outside A5 stops the lane whatever the count.

## 5. Acceptance matrix

| ID | Group | Input / precondition | Expected | Layer |
|---|---|---|---|---|
| A1 | Happy | AFTER Docker scan on the lane head (D-7) | no finding for shell-quote, sharp, source-map-js or brace-expansion; the rest is a subset of {GHSA-vfj7-8cjw-p6xm, GHSA-4jqv-mc3x-m676, GHSA-mcj8-r9mp-w47p}; no id that BEFORE lacked | osv-scanner (Docker) |
| A2 | Boundary | the `packages:` keys of shell-quote, source-map-js, brace-expansion and sharp in `pnpm-lock.yaml` | one version each: shell-quote 1.x >= 1.11.0, source-map-js 1.x >= 1.2.2, brace-expansion 5.x >= 5.0.12, sharp 0.35.x >= 0.35.5 | static |
| A3 | Boundary | `npm view <pkg> time --json` for every version that changed | each published at least 10080 min before the install; `pnpm-workspace.yaml` byte-unchanged | registry + static |
| A4 | Security | `pnpm ignored-builds` at base and head; registry metadata of each new version | same list (esbuild only); no new package name; `hasInstallScript` false; provenance not weaker than the version it replaces | pnpm + registry |
| A5 | Scope | `git diff c762c90 -- pnpm-lock.yaml` | changed keys only: header `brace-expansion@5`, `sharp`, new `shell-quote@1`, `source-map-js@1`; importer `.` sharp; `sharp`; 16 `@img/sharp-<platform>` 0.35.x; 10 `@img/sharp-libvips-<platform>` 1.3.x; `brace-expansion`; `shell-quote`; `source-map-js`; and the lines naming them in the minimatch, gel, postcss, next and sharp snapshots | static |
| A6 | Failure | lockfile importer `.` | `sharp` specifier `^0.35.5` (R1 guard) | static |
| A7 | Failure | `git diff c762c90 -- pnpm-workspace.yaml osv-scanner.toml .github`; lockfile `overrides:` | empty diff; the header lists exactly the 8 package.json override keys | static |
| A8 | Regression | `pnpm install --frozen-lockfile` on the head | "Lockfile is up to date", exit 0 (what CI runs) | install |
| A9 | Regression | S1 VERIFY set; DB and e2e under the DB/e2e lock | typecheck, lint, format:check, review:check:changed, build, web unit, `NODE_ENV=test pnpm -w test`, Playwright e2e: pass (S1 known flakes: one rerun) | VERIFY |
| A10 | Regression | `node -e "import('sharp').then(s=>console.log(JSON.stringify(s.default.versions)))"` at the worktree root | sharp 0.35.x >= 0.35.5 loads; vips and rsvg differ from base (8.18.6, 2.62.91); `scripts/generate-pwa-icons.mjs` is never run (it rewrites committed icons) | runtime probe |
| A11 | Migration | `git diff --name-only c762c90..HEAD` | subset of TARGET_FILES plus this file; no migration, source or test file | static |
| A12 | Authorization | RLS, grant and auth suites inside A9 | green and unedited; the lane touches no auth or tenant code | A9 |
| A13 | Concurrency | merge surface (2.6) | package.json hunks only in `devDependencies` and `pnpm.overrides`; the row sits between the two named blocks | static |
| A14 | Observability | evidence | `osv-before.json` and `osv-after.json` in P3-S1-notes; PR body: the 2.3 table, D-1..D-9, both scan lists, the A5 key list, the A3 ages, run 38851467389, the OSV dependency diff result | PR body |
| A15 | Backlog | the new row | exactly one row with the fields of 3.4 | static |

## 6. Closure matrix (gate section 8)

| # | Gate | Evidence | Result |
|---|---|---|---|
| 1 | Authority snapshot pinned by SHA | `c762c900e4ca55bc8ed2a84c0a86f7d0d7d7cf0a`, 3 exact TARGET_FILES, worktree HEAD equal, origin/main unchanged | PASS |
| 2 | Decisions in scope closed | owner D5 addition (3.1); lane: no owner decision needed | PASS |
| 3 | Scope IN/OUT and owner clear | verdict IN_SCOPE / OUT_OF_SCOPE, 3.2, D-6 | PASS |
| 4 | Dependencies classified | root slice; registry versions measured (2.3) | PASS |
| 5 | Live code matches the doc | both scans, lockfile lines, override winner (2.2-2.4); C1-C6 | PASS |
| 6 | Data/API/state/auth contract | no runtime contract changes; 3.2 is the whole change | PASS |
| 7 | Fail-closed, idempotency, order | R1 and R2 traps pinned (D-2, D-4); D-5 fallback; frozen install (A8) | PASS |
| 8 | Open questions in scope = 0 | D-1..D-9 | PASS |
| 9 | Acceptance matrix has expected results | section 5, A1-A15 | PASS |
| 10 | Migration, security, rollback pinned | 0 migrations; supply-chain checks A3-A5; rollback = revert the PR | PASS |
| 11 | First slice hard dependencies merged | none (root) | PASS |
| 12 | Implementation handoff ready | worktree at the base, FIRST_IMPLEMENTATION_STEP, section 7, R3 rehearsal | PASS |

## 7. Handoff

1. 3.2 edits, `pnpm install`, then A2, A5, A6, A7, A8, A4, A3 and A10 (FIRST_IMPLEMENTATION_STEP).
2. AFTER scan (A1, D-7) and the backlog row (3.4, A15).
3. S1 VERIFY: the non-DB checks first; `pnpm -w test` and Playwright under the DB/e2e lock, after L1's exclusive window.
4. Conventional commits without AI references (one for package.json plus lockfile, one for the backlog row); independent
   opus/max review, at most 3 rounds, on the lane's review questions.

PR body: "Codex waived by owner 2026-10-12; reviewed by independent Claude subagent"; D-1..D-9 as defaults; A14 evidence.
OPEN (outside L1b's files): next #8 and #9 need their own lane (15.5.27 eligible; 15.5.28 not before 2026-10-21T17:36Z; the
root `@next/eslint-plugin-next` is pinned exactly at 15.5.20); backlog row `osv-full-scan-red-on-main-2026-10` is stale after
the merge and carries the wrong override location (C1); the inert workspace postcss entry (row
`pnpm-workspace-postcss-override-inert`); `brace-expansion@1: ^1.1.16` matches nothing today (if a 1.x consumer returns, its
fixed line is 1.1.21); "OSV full dependency scan" stays red on main after the merge (braces, next); the RUN doc has no L1b
lane and its S1 still says OSV is ignored.
