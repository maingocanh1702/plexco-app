<!-- review-readiness: code-ready -->

# Step-0 readiness: p3-deps-osv-next-and-fixable (Phase 3 lane L25)

> Agent-facing (English). Session P3-S16f step 0, written by the readiness reviewers (Opus 5.5 / high: S0 measured Q1-Q3,
> S0b finished Q3-Q4 and wrote this file), not the writer.
> Authority: owner decision item 4 of `status/OWNER-DECISIONS-2026-10-22.md` and the owner's L25 prompt text (both verbatim
> in 3.1), lane block L25 of the P3-S16f brief with its rule RO-L25-1 (conductor-authored; not in the RUN doc), DD-138 row
> `p3-osv-advisories D-8`, the DD-122 D4 review policy and this verdict.
> Base: `origin/main` `fb8ee675b49f9460ae8332950c82b40ec30610de` (worktree HEAD equal, tree clean, no index.lock, checked
> 2026-10-22T12:37Z).
> Evidence outside the repo (untracked), in `Claude outputs/plexco-phase3/status/P3-S16f-notes/` (N): `s0-osv-base.json`,
> `s0-osv-base.stderr`, `s0-osv-base-summary.txt` (base scan), `s0-why-{next,vite,vitest-mocker,braces,braces-prod}.txt`,
> `s0-npm-facts.txt`, `s0-npm-facts-2.txt`, `s0-npm/time-*.json`, `l25-intended-set.txt`, `scripts/lockfile-diff.sh`. The PR
> body carries the outputs that matter.
> Every L25-D<n> in 3.4 is "default applied, pending owner sign-off": the PR body repeats them. This file does not edit
> `docs/standards/decisions.md` or `docs/autopilot-backlog.md`.

## 1. Verdict

```text
REVIEW_POLICY_VERSION: 1.3
REVIEW_VERDICT: CODE_READY
REVIEWED_AT: 2026-10-22
AUTHORITY_SHA: fb8ee675b49f9460ae8332950c82b40ec30610de
BASE_BRANCH: main
TARGET_FILES:
  - package.json
  - pnpm-lock.yaml
  - osv-scanner.toml
SLICE: p3-deps-osv-next-and-fixable
IN_SCOPE: pnpm-lock.yaml (next family 15.5.25 -> 15.5.28, vite 7.3.6 -> 7.3.7, vitest family 4.1.11 -> 4.1.12, nothing else: 3.2); root package.json pnpm.overrides (one appended key "vite@7": "^7.3.7"); osv-scanner.toml (one dated IgnoredVulns entry for GHSA-vfj7-8cjw-p6xm under RO-L25-1 (i): 3.3); this file
OUT_OF_SCOPE: production and test code; every package.json range (apps/*, packages/*, root dependencies); pnpm-workspace.yaml (byte-unchanged, its inert postcss entry included); .github/workflows/*; docs/autopilot-backlog.md and docs/standards/decisions.md (row texts go into the PR body); PR #50
G1_DECISION: PASS # owner item 4 of OWNER-DECISIONS-2026-10-22 (3.1); braces by conductor rule RO-L25-1 (delegated, 2.3); orchestrator decisions (a)-(c) derived from lane block L25 (3.4)
G2_SPEC: PASS # dependency slice: equivalent authority = lane block L25 + RO-L25-1 + the osv-scanner.toml rule header + DD-138 p3-osv-advisories D-1 + section 3
G3_DEPENDENCY: PASS # L28 #98, L18 #99, L26 #100, L24 #102, L27 #101 merged at the base (2.1); next 15.5.28 and vite 7.3.7 are past the 7-day window; vitest 4.1.12 resolves from 2026-10-22T14:51:25Z and unit U2 waits for it (3.5)
G4_TEST: PASS # no new tests: the next-internal coupling (2.4) is covered by the existing web vitest and golden path; acceptance A1-A15 pinned before code
G5_SCOPE: PASS # 3 exact files plus this file, 2 modules, 0 migrations; B3 estimate inside 60/8/0 (section 4)
G6_EXTERNAL: PASS # no PII, money, provider or legal surface; supply-chain policy unchanged; one ignore with reason, owner and expiry on a measured lint/build-only path (2.3)
HARD_DEPENDENCIES: L26, L28, L18, L24, L27 merged at the base (2.1)
PRIOR_SLICES: L1b p3-osv-advisories (#60, merged)
OPEN_QUESTIONS_IN_SCOPE: 0 # L25-D1..L25-D10 pinned (3.4)
ENABLEMENT_ONLY_GATES: none
LIVE_REPO_VERIFICATION: PASS # section 2, corrections C1-C5
CONTRACT_MATRIX: PASS # section 3
CLOSURE_MATRIX: PASS # 12/12, section 6
ACCEPTANCE_MATRIX: PASS # section 5
SECURITY_AND_MIGRATION_GATE: PASS # 0 migrations; no new package, no major bump, no lifecycle-script or trust change, policy unchanged (A3, A4); one reasoned, dated ignore (A13); the opus/max code reviewer covers security, no separate security round (void if a package is added or a major version changes)
IMPLEMENTATION_ARTIFACTS: PASS # DD-122 D4: no scope-gate lifecycle; lane block + this file + the worktree at the exact base
FIRST_IMPLEMENTATION_STEP: in .autopilot/worktrees/p3-deps-osv-next-and-fixable (base fb8ee67 plus this readiness commit), writer unit U1 of 3.5: next 15.5.28, the vite floor, pnpm install, the osv-scanner.toml entry of 3.3, then the frozen install and the lockfile check
REMAINING_BLOCKERS: none
```

## 2. Measured at base (fb8ee67)

### 2.1 Snapshot and policy

- The base is `origin/main` after the five other P3-S16 lanes: `git log --oneline --merges e049c92..HEAD` lists #98 (L28),
  #99 (L18), #100 (L26), #102 (L24) and #101 (L27, the base commit itself).
- Supply-chain policy `pnpm-workspace.yaml:7-9`: `minimumReleaseAge: 10080`, `trustPolicy: no-downgrade`,
  `blockExoticSubdeps: true`. The lane changes none of it.
- CI scan: `.github/workflows/security.yml:51-60` "OSV full dependency scan" (`if:` push, schedule or dispatch, :53) and
  :37-49 "OSV dependency diff" (`if:` pull_request or merge_group, :39) call the google/osv-scanner-action reusable
  workflows pinned to the v2.3.8 commit; image `ghcr.io/google/osv-scanner-action:v2.3.8` = osv-scanner 2.3.8; no config
  flag, so `osv-scanner.toml` at the repo root is auto-loaded.

### 2.2 Base scan and mechanism per advisory (Q1)

Local mirror of the CI full scan on a clean export (no node_modules): `git -C "$W" archive HEAD | tar -x -C <scratch>`,
then `docker run --rm -v <export>:/src -w /src ghcr.io/google/osv-scanner-action:v2.3.8 --format=json -r ./` (exit 1 =
findings; stderr "Loaded filter from: /src/osv-scanner.toml"; only `pnpm-lock.yaml` found, 340 packages; the entrypoint's
last JSON line "Exit code: 1" is not scan output). Result = the conductor measurement exactly: 4 packages, 10 advisories,
9 fixable (`s0-osv-base-summary.txt`).

| Package at base | Advisories | Fixed in | Declared | Mechanism |
|---|---|---|---|---|
| next 15.5.25 | GHSA-4jqv-mc3x-m676, GHSA-mcj8-r9mp-w47p (Moderate 6.3 each; the D-8 pair) | 15.5.27 | direct, `apps/web/package.json:18` `^15.1.4` (only importer) | `pnpm --filter @plexco/web update next@15.5.28 --no-save` (L25-D1, L25-D3) |
| vite 7.3.6 | GHSA-587h-7wmj-h5pm (High 7.5), GHSA-698v-4r3x-3vcv, GHSA-r825-w8mm-5pxw, GHSA-rq7h-c2jc-7f22 (6.3), GHSA-9jrq-w75r-8gcw (Low 2.1) | 7.3.7 | undeclared; transitive via vitest (range ^6 or ^7 or ^8; `s0-why-vite.txt`) | override floor `"vite@7": "^7.3.7"` in root `package.json` `pnpm.overrides` (L25-D2, 2.5) |
| @vitest/mocker 4.1.11 | GHSA-qxg6-89mg-rqv8 (4.7), GHSA-xp26-3454-mjgp (5.9) | 4.1.12 | undeclared; via vitest `^4.1.11` (devDependency of apps/bot:23, apps/web:29, packages/core:23, packages/db:35) | `pnpm -r update vitest@4.1.12 --no-save` (moves vitest and its 7 `@vitest/*`), unit U2 after the release-age gate |
| braces 3.0.3 | GHSA-vfj7-8cjw-p6xm (CVE-2026-93687, High 8.7) | none (last affected 3.0.3) | undeclared; lint chain (2.3) | RO-L25-1 (i): one dated ignore (3.3) |

No floor for next, vite or vitest exists at the base: root `package.json:43-52` holds only the eight AP-51 floors.

### 2.3 braces reachability and the RO-L25-1 branch (Q3)

- Chain (`pnpm why -r braces`, `s0-why-braces.txt`): braces 3.0.3 <- micromatch 4.0.8 <- fast-glob 3.3.1 <-
  @next/eslint-plugin-next 15.5.20 <- root devDependencies (lint only). `pnpm why -r --prod braces` is empty
  (`s0-why-braces-prod.txt`): no web or bot runtime chain.
- Advisory text: "braces vulnerable to stack-exhaustion denial of service through deeply nested patterns". In this repo the
  patterns come from the repo's own lint and build configuration, never from request or user input.
- Vendored copy: `next/dist/compiled` holds glob and picomatch but no micromatch or braces directory; braces' guard string
  "exceeds max characters" occurs in exactly one file of next 15.5.25's dist, `compiled/@vercel/nft/index.js` (Next's
  build-time file tracer, not a lockfile package). `grep -rl 'compiled/@vercel/nft' apps/web/node_modules/next/dist` lists
  only `build/collect-build-traces.js` and `build/webpack/plugins/next-trace-entrypoints-plugin.js` (cjs and esm copies,
  their maps and one `.d.ts`): nothing under `dist/server` or any request path. The nft check passes.
- Branch: **RO-L25-1 (i)** (build, test or dev-only reachability). Branch (ii) does not apply: no runtime chain and no
  runtime loader.
- Existing mechanism: at the base `osv-scanner.toml` is only its 7-line rule header (an entry is a reachability argument:
  who pulls the package, why the advisory cannot trigger here, an `ignoreUntil` that forces a re-review; runtime or
  money/auth paths get patched). Shape precedent: `git show 1dacd6e:osv-scanner.toml` (the former esbuild
  GHSA-67mh-4wv8-2f99 entry with a multi-line `reason`; no longer in the file at the base; history 1dacd6e, 0e8d252).
- Prior choice and provenance: L1b (#60) D-6 chose "no bump, no override, no ignore" plus the row
  `braces-ghsa-vfj7-no-fixed-version` (`docs/autopilot-backlog.md:6250`); D-6 sits in DD-138's L1b table
  (`docs/standards/decisions.md:2252`), signed with the per-lane tables on 2026-10-21. RO-L25-1 (i) is the later conductor
  decision for this lane under the owner's standing delegation of 2026-10-22 (quoted verbatim in lane block L25; D6 of
  `status/P3-S16-conductor-decisions.md`), not an owner signature. Reversal: delete the entry (the full scan turns red on
  braces again). The PR body states the decision, this provenance and the reversal.

### 2.4 Upgrade risk (Q2)

- next: 15.5.26, 15.5.27 and 15.5.28 are patch releases, security-only. 15.5.26 = next/og hardening; 15.5.27 = three
  Moderate fixes (GHSA-f87g-xv8r-7p7x and the D-8 pair); 15.5.28 fixes GHSA-2464-fhr4-w9xw (Critical, unauthenticated RCE
  through the Image Optimization API with SVG, vulnerable >=10.0.0 <=15.5.27) and GHSA-p3m5-59mp-jv5r (High, Server
  Actions DoS, <=15.5.27) (`gh api /repos/vercel/next.js/security-advisories/<id>`). Neither 15.5.28 advisory is in the
  global database yet (`gh api '/advisories?ecosystem=npm&affects=next@15.5.27'` is empty; the control query for
  next@15.5.25 returns the D-8 pair), so 15.5.27 would pass today's scan and stay exposed: L25-D1.
- vite 7.3.7: launch-editor 2.14.2, a transformIndexHtml filename fix, a safeModulePaths fix (patch). vitest 4.1.12: a
  mocker hardening backport only.
- Registry (`s0-npm-facts.txt`, `s0-npm-facts-2.txt`, `s0-npm/time-*.json`): published next 15.5.28 2026-10-14T17:36Z, vite
  7.3.7 2026-10-06T05:11Z, vitest 4.1.12 2026-10-15T14:51:25Z. Dependency sets equal from -> to except exact pins (next ->
  @next/env and 8 @next/swc-*; vitest -> 7 @vitest/*; vite 7.3.7 deps equal 7.3.6); peer ranges unchanged; trust evidence
  equal (SLSA provenance v1 on all; trustedPublisher on both vitest versions), so `trustPolicy: no-downgrade` passes. In
  range above the base: next 15.5.26-15.5.28; vite 7.3.7 only; vitest 4.1.12 only.
- Lockfile: all 8 `@next/swc-*` keys exist at the base, each once in `packages:` (`pnpm-lock.yaml:793-839`) and once in
  `snapshots:` (:2443-2464). The root devDependency `@next/eslint-plugin-next` is pinned exactly at 15.5.20 and stays.
- Repo coupling to next: `apps/web/next.config.mjs` (93 lines: reactStrictMode, outputFileTracingRoot, transpilePackages,
  custom webpack; no output/standalone, images or experimental keys); `apps/web/middleware.ts`;
  `apps/web/lib/request-policy.ts` and its test. The dev-login gate reads next internals:
  `apps/web/lib/dev-login/gate.ts:15,29,52` (base-server.js `??=`, start-server.js port), `env-policy.mjs:34`
  (config-shared.js), `boot-refusal.process.test.ts:18` (dist/bin/next). The web vitest and the golden path cover them; a
  failure there that needs an application-code edit is a STOP (ruling request), never a patch in this lane.

### 2.5 Override location (orchestrator decision (b))

- The lockfile `overrides:` header (`pnpm-lock.yaml:7-15`) lists exactly the eight entries of root `package.json`
  `pnpm.overrides` (:43-52) and lacks `pnpm-workspace.yaml:14-15` `"postcss@<8.5.10": 8.5.16`. Root `package.json` is the
  effective location and the workspace-yaml block is inert: the same finding as DD-138 `p3-osv-advisories D-1`
  (`docs/standards/decisions.md:2247`) and AP-48. The inert entry stays untouched (OPEN; existing row
  `pnpm-workspace-postcss-override-inert`, `docs/autopilot-backlog.md:1276`).
- Why a floor and not an update for vite: vite is undeclared and reached through vitest's range ^6 or ^7 or ^8, so an
  unpinned transitive update may select vite 8 (a major: HALT). The scoped key `"vite@7"` follows the `brace-expansion@1`
  and `shell-quote@1` precedent (#60 D-2: pnpm 10.30.2 matches such selectors by range intersection and replaces the
  matched range), keeps the 7 line and moves 7.3.6 -> 7.3.7, the only 7.x release above the base. A2, A5 and A7 verify it.

### 2.6 Verification set and its cost (Q4)

- Lock: `status/.db-e2e.lock` through `N/scripts/locked-run.sh` (usage `bash locked-run.sh <lane> <role> <worktree-slug>
  <logfile> <command> [args...]`: atomic mkdir lock, cluster probe before and after, `NODE_ENV=test`, `DATABASE_URL_TEST`
  built at run time and never printed, the runbook password step re-run on a fingerprint change, last 40 log lines).
- Golden path: `apps/web/e2e/golden-path.config.ts` (42 lines; testMatch `golden-path.spec.ts`; `GOLDEN_PATH_BASE_URL`
  required, the spec skips without it; a not-proven reporter). Runner `N/scripts/l20-golden-path.sh` (copied from
  P3-S15a; its `wt` and `notes` already point at this worktree and N; migrates plexco_smoke from the worktree, runs
  `next dev` with NODE_ENV unset, recreates only plexco_smoke when the key file is absent; its usage comment still names an
  older lane, so invoke it as in 3.6).
- Host: `ifconfig -l` at 2026-10-22T12:37Z = lo0 gif0 stf0 anpi2 anpi1 anpi0 en4 en5 en6 en1 en2 en3 bridge0 ap1 en0 awdl0
  llw0 utun0-utun5: no en8, no utun6. Re-check right before the golden path.
- CI on the PR: `ci.yml` (push :6, pull_request :8) jobs "verify" (:25) and "e2e-web" (:112); `security.yml`
  (pull_request :4, merge_group :6, push :8, schedule :10, workflow_dispatch :12) jobs "Semgrep CE" (:24-29) and "OSV
  dependency diff" (:37-39). "OSV full dependency scan" (:51-53) is skipped on the PR; the conductor reads it on the next
  main Security run. `autopilot-backlog-audit.yml` (:79-84 schedule, push, dispatch) and `linear-sync.yml` (:11-27 push,
  repository_dispatch, dispatch, schedule) do not run on pull_request.

### 2.7 Corrections to the lane block and records

- C1 (target): the conductor measurement lists next fixed at 15.5.27; the lane takes 15.5.28, the newest patched 15.5
  release (2.4), as the lane GOAL allows.
- C2 (override location): the lane block names the pnpm-workspace.yaml overrides as the AP-51 floors; measured, the
  effective AP-51 floors are root `package.json` `pnpm.overrides` and the workspace-yaml block is inert (2.5).
- C3 (absent list per unit): the task-line lockfile check names next@15.5.25, vite@7.3.6 and @vitest/mocker@4.1.11 as
  must-be-absent after each unit. After U1, @vitest/mocker@4.1.11 is still present by design (U2 moves it), so U1's check
  passes only next@15.5.25 vite@7.3.6 and U2's final check passes all three (L25-D9).
- C4 (braces): #60's D-6 "no ignore" is replaced for this lane by RO-L25-1 (i) (2.3). The row
  `braces-ghsa-vfj7-no-fixed-version` stays unedited; the follow-up row text goes into the PR body (3.3).
- C5 (backlog rows): `deps-next-advisories-before-staging-deploy` (`docs/autopilot-backlog.md:6602`, P0-gating) and
  `osv-full-scan-red-on-main-2026-10` (:6231, stale location note) close by hand after the merge; the lane does not own
  the backlog file (OPEN).

## 3. Pinned contract

### 3.1 Authority

- Owner item 4 (verbatim): "Item 4 (two `next` advisories, p3-osv-advisories D-8): owner says fix now. A lane upgrades
  `next` to a patched version, clears the red "OSV full dependency scan" on main, full verify (typecheck, lint, tests,
  build, e2e, golden path). PR #50 stays frozen and owner-only (OPEN, DIRTY): the lane must not touch it."
- Owner L25 prompt text (verbatim): "upgrade `next` to a patched version for the two advisories (p3-osv-advisories D-8),
  clear the red OSV full dependency scan on main, full verify including build, e2e and golden path. PR #50 is frozen and
  owner-only: do not touch it."
- DD-138 `p3-osv-advisories D-8` (`docs/standards/decisions.md:2101`), signed as TEMPORARY only, "fix before any staging
  deploy (#50)" (:2051, :2072). Lane block L25 with RO-L25-1 (braces). DD-122 D4 review policy.
- Orchestrator decisions, derived from lane block L25 and recorded with their evidence: (a) next target 15.5.28 (2.4);
  (b) the vite floor in root `package.json` `pnpm.overrides`, no range change (2.5); (c) two writer units (3.5).

### 3.2 Exact edits

- `pnpm-lock.yaml`: generated by pnpm only, never hand-edited. The `packages:` version changes are exactly the intended set
  below; the `overrides:` header gains `vite@7: ^7.3.7`; nothing is added or removed.
- Root `package.json`: one appended key in `pnpm.overrides` after `"source-map-js@1": "^1.2.2"`, namely
  `"vite@7": "^7.3.7"` (plus the comma on the line before). No other key and no range change in any package.json.
- `osv-scanner.toml`: the entry of 3.3 appended after the header; the header stays byte-unchanged.

Intended set (copy of `N/l25-intended-set.txt`; names allowed to change version):

```text
# next family 15.5.25 -> 15.5.28
next
@next/env
@next/swc-darwin-arm64
@next/swc-darwin-x64
@next/swc-linux-arm64-gnu
@next/swc-linux-arm64-musl
@next/swc-linux-x64-gnu
@next/swc-linux-x64-musl
@next/swc-win32-arm64-msvc
@next/swc-win32-x64-msvc
# vite 7.3.6 -> 7.3.7 (override floor "vite@7": "^7.3.7")
vite
# vitest family 4.1.11 -> 4.1.12 (unit U2, after the 7-day minimumReleaseAge of vitest 4.1.12)
vitest
@vitest/expect
@vitest/mocker
@vitest/pretty-format
@vitest/runner
@vitest/snapshot
@vitest/spy
@vitest/utils
```

Acceptance command (lists every package@version difference of the lockfile `packages:` section; fails on any package added
or removed, any change outside the intended set, or a present must-be-absent key; exit 0 = LOCKFILE_DIFF_OK):

```text
N="Claude outputs/plexco-phase3/status/P3-S16f-notes"   (under the repo root checkout)
after U1:  bash "$N/scripts/lockfile-diff.sh" fb8ee675b49f9460ae8332950c82b40ec30610de <rev|WT> "$N/l25-intended-set.txt" next@15.5.25 vite@7.3.6
final:     bash "$N/scripts/lockfile-diff.sh" fb8ee675b49f9460ae8332950c82b40ec30610de <rev|WT> "$N/l25-intended-set.txt" next@15.5.25 vite@7.3.6 @vitest/mocker@4.1.11
```

### 3.3 The osv-scanner.toml entry and the PR-body backlog row

Draft entry (the writer appends it as written; it follows the file's rule header and the 1dacd6e shape):

```toml
[[IgnoredVulns]]
id = "GHSA-vfj7-8cjw-p6xm"
ignoreUntil = 2026-12-21
reason = """
braces 3.0.3 (CVE-2026-93687, High 8.7; no fixed release, last affected
3.0.3), reached only via the root devDependency @next/eslint-plugin-next
15.5.20 -> fast-glob 3.3.1 -> micromatch 4.0.8 -> braces 3.0.3 (lint tooling,
never shipped). `pnpm why -r --prod braces` is empty: no web or bot runtime
chain.

The advisory is a stack-exhaustion denial of service through deeply nested
brace patterns. Here every pattern comes from the repo's own lint and build
configuration, never from request or user input. Next also vendors braces
code inside its build-time file tracer (next/dist/compiled/@vercel/nft, not a
lockfile package); only next/dist/build/collect-build-traces.js and
next/dist/build/webpack/plugins/next-trace-entrypoints-plugin.js load it
(`next build`), never next/dist/server or the request path.

Not patched because no fixed braces release exists. Decision: lane L25 rule
RO-L25-1 (i), a conductor decision under the owner's delegation of
2026-10-22, not an owner signature; review owner: the repository owner.
Reverse by deleting this entry. Re-review at ignoreUntil, or sooner if braces
publishes a fixed release, if @next/eslint-plugin-next drops micromatch, or if
braces gains a runtime path.
"""
```

Backlog-row text for the PR body (the lane does not edit `docs/autopilot-backlog.md`):

```text
## task: braces-ghsa-vfj7-ignore-expiry-2026-12-21
title: Deps: revisit at the expiry: look for a fixed release (braces GHSA-vfj7-8cjw-p6xm, osv-scanner.toml ignoreUntil 2026-12-21)
priority: P1
On or before 2026-12-21: look for a braces release that fixes GHSA-vfj7-8cjw-p6xm, and for an @next/eslint-plugin-next
release that drops micromatch/braces. If either exists, bump it and delete the osv-scanner.toml entry. If not, re-measure
the reachability (pnpm why -r --prod braces empty; the next/dist loaders of compiled/@vercel/nft under build/ only) and
renew ignoreUntil with a new reason, or escalate. Related: braces-ghsa-vfj7-no-fixed-version (#60).
source: lane L25 (P3-S16f), rule RO-L25-1 (i)
```

### 3.4 Defaults (each: default applied, pending owner sign-off)

- L25-D1: next target 15.5.28, not 15.5.27 (decision (a), 2.4).
- L25-D2: the vite floor `"vite@7": "^7.3.7"` in root `package.json` `pnpm.overrides`, the effective location (decision (b),
  2.5).
- L25-D3: no package.json range change anywhere: `^15.1.4` covers 15.5.28 and `^4.1.11` covers 4.1.12 (decision (b)).
- L25-D4: two writer units, both sonnet/high (opus/max for any change beyond a patch bump); U2 not before
  2026-10-22T14:52Z; `minimumReleaseAge` is never relaxed (decision (c)).
- L25-D5: review owner of the ignore = the repository owner.
- L25-D6: `ignoreUntil = 2026-12-21` = the lane date 2026-10-22 (step 0) plus 60 days (RO-L25-1 (i)), unchanged if the merge
  lands later.
- L25-D7: B3 counting: the 60-line cap counts the non-test code column of `N/scripts/b3-measure.sh` (package.json,
  osv-scanner.toml); `pnpm-lock.yaml` is reported separately; this file is in the docs column and counts toward the 8-file
  cap.
- L25-D8: the OSV proof uses the CI-pinned image `ghcr.io/google/osv-scanner-action:v2.3.8` on a `git archive` export of the
  head (the scanner version CI runs), not `osv-scanner:latest` as #60 did.
- L25-D9: the per-unit must-be-absent list of C3.
- L25-D10: the web vitest also runs under the DB/e2e lock (it starts `next` processes; serializing is harmless).

### 3.5 Writer units

U1 (now):

1. `pnpm --filter @plexco/web update next@15.5.28 --no-save`
2. root `package.json` `pnpm.overrides`: append `"vite@7": "^7.3.7"` (3.2)
3. `pnpm install`
4. append the 3.3 entry to `osv-scanner.toml`
5. `pnpm install --frozen-lockfile`; the after-U1 lockfile check (3.2); `git diff --stat fb8ee67 -- '*package.json'` shows
   root `package.json` only; `bash "$N/scripts/b3-measure.sh" p3-deps-osv-next-and-fixable`; commit.

U2 (not before 2026-10-22T14:52Z):

1. `pnpm -r update vitest@4.1.12 --no-save`
2. `pnpm install --frozen-lockfile`; the final lockfile check (3.2); `git diff --stat fb8ee67 -- '*package.json'` unchanged
   from U1; b3-measure; commit.

The commands are S0's drafts; the checks confirm them. If a command rewrites anything else (a package.json range, a key
outside the intended set, vite 8), revert that unit and STOP with a ruling request.

### 3.6 Verification at the final head (S1 VERIFY plus lane TESTS; cite measured output through tail -40)

- `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm review:check:changed`, `pnpm review:check`, `pnpm build`.
- Under the lock, one command at a time (`bash "$N/scripts/locked-run.sh" L25 writer p3-deps-osv-next-and-fixable <log>
  <command>`): `pnpm --filter @plexco/web test` (full web vitest); `pnpm -w test` (one rerun for a flake listed in
  `status/conductor-scripts/clerk-flake-list.txt`); `pnpm --filter @plexco/web exec playwright test` (full suite); the
  extended golden path `bash "$N/scripts/l20-golden-path.sh"`, or NOT RUN with the reason (en8 or utun6 present, or the
  server cannot start), never a pass; a skip without `GOLDEN_PATH_BASE_URL` is not a pass.
- `lib/dev-login/network-exposure.test.ts` "real probe": KNOWN_ENV only when en8 or utun6 is present (RO-L20-2a), with the
  PR's CI as the independent gate.
- The Docker scan of 2.2 on a `git archive HEAD` export of the final head (A1), and the final lockfile check (A5).

## 4. B3 (lane caps: 60 non-test lines outside pnpm-lock.yaml, 8 files outside the lockfile, 0 migrations)

- Estimate: root `package.json` +2/-1 (the key and the comma); `osv-scanner.toml` about +24 (3.3 plus one blank line):
  about 27 non-test lines. Files outside the lockfile: 3 (package.json, osv-scanner.toml, this file). Migrations: 0.
  Modules: 2 (the root dependency manifest with its generated lockfile; the OSV configuration) plus this docs file.
- `pnpm-lock.yaml` is reported separately (expected: the 20 intended `packages:` keys and their `snapshots:` keys, the lines
  naming them, and +1 header line), bounded by the key set (A5), not by LOC.
- `N/scripts/b3-measure.sh` after every writer unit; a crossing of a cap is a ruling request before the next unit.

## 5. Acceptance matrix

| ID | Group | Input / precondition | Expected | Layer |
|---|---|---|---|---|
| A1 | Happy | Docker scan of 2.2 on the final head (L25-D8) | no finding; stderr shows the filter loaded and GHSA-vfj7-8cjw-p6xm filtered; any id absent from the base scan is reported, never ignored | osv-scanner (Docker) |
| A2 | Boundary | `packages:` keys of the intended set | next, @next/env and the 8 @next/swc-* at 15.5.28; vite 7.3.7; vitest and the 7 @vitest/* at 4.1.12; one version each | static |
| A3 | Boundary | registry times; `pnpm-workspace.yaml` | every new version published at least 10080 min before its install; `pnpm-workspace.yaml` byte-unchanged | registry + static |
| A4 | Security | `pnpm ignored-builds` at base and head; registry metadata | same list; no new package name; no install script added; provenance not weaker than the version it replaces | pnpm + registry |
| A5 | Scope | the lockfile check of 3.2 | LOCKFILE_DIFF_OK (exit 0); the overrides header diff is exactly `+ vite@7: ^7.3.7` | script |
| A6 | Scope | `git diff --stat fb8ee67 -- '*package.json'` | root `package.json` only, `pnpm.overrides` +1 key; no range change | static |
| A7 | Failure | vite resolution | vite stays on 7.x (7.3.7); vite 8 anywhere is a HALT | static |
| A8 | Regression | `pnpm install --frozen-lockfile` on the head | "Lockfile is up to date", exit 0 (what CI runs) | install |
| A9 | Regression | S1 VERIFY set (3.6); DB and e2e under the lock | typecheck, lint, format:check, review:check:changed, review:check, build, web vitest, `pnpm -w test`, Playwright: pass (listed flakes: one rerun) | VERIFY |
| A10 | Regression | next-internal coupling (2.4) | dev-login gate tests and boot-refusal process test green unedited; golden path pass or NOT RUN with the reason | web vitest + golden path |
| A11 | Migration | `git diff --name-only fb8ee67..HEAD` | subset of TARGET_FILES plus this file; no migration, source or test file | static |
| A12 | Authorization | RLS, grant and auth suites inside A9 | green and unedited; the lane touches no auth or tenant code | A9 |
| A13 | Config | `git diff fb8ee67 -- osv-scanner.toml` | exactly the 3.3 entry appended; header unchanged; no other ignore anywhere | static |
| A14 | Observability | PR body | lockfile-check output, both Docker scan outputs (base summary and final), verification evidence with NOT RUN where true, braces facts (2.3), L25-D1..D10, RO-L25-1 provenance and reversal, the 3.3 row text, B3 counts, "Codex waived by owner 2026-10-12; reviewed by independent Claude subagent" | PR body |
| A15 | Security | `grep -rl 'compiled/@vercel/nft' apps/web/node_modules/next/dist` at next 15.5.28 | loaders under `build/` only, as at 15.5.25 (2.3); otherwise STOP (branch (ii) facts to the orchestrator) | static |

## 6. Closure matrix (gate section 8)

| # | Gate | Evidence | Result |
|---|---|---|---|
| 1 | Authority snapshot pinned by SHA | `fb8ee675b49f9460ae8332950c82b40ec30610de`, 3 exact TARGET_FILES, worktree HEAD equal | PASS |
| 2 | Decisions in scope closed | owner item 4 (3.1); braces by RO-L25-1 (i) (2.3); decisions (a)-(c) (3.4) | PASS |
| 3 | Scope IN/OUT and owner clear | verdict IN_SCOPE / OUT_OF_SCOPE, 3.2, FILE OWNERSHIP of lane block L25 | PASS |
| 4 | Dependencies classified | five lanes merged (2.1); registry versions and the release-age gate measured (2.4) | PASS |
| 5 | Live code matches the doc | base scan, lockfile lines, override location, nft loaders (2.2-2.5); C1-C5 | PASS |
| 6 | Data/API/state/auth contract | no runtime contract change; 3.2 is the whole change | PASS |
| 7 | Fail-closed, idempotency, order | vite major trap pinned (2.5, A7); per-unit absent list (C3); frozen install (A8) | PASS |
| 8 | Open questions in scope = 0 | L25-D1..L25-D10 | PASS |
| 9 | Acceptance matrix has expected results | section 5, A1-A15 | PASS |
| 10 | Migration, security, rollback pinned | 0 migrations; supply-chain checks A3-A5; the ignore with expiry (A13); rollback = revert the PR | PASS |
| 11 | First slice hard dependencies merged | L26, L28, L18, L24, L27 merged at the base (2.1) | PASS |
| 12 | Implementation handoff ready | worktree at the base, FIRST_IMPLEMENTATION_STEP, sections 3.5 and 7 | PASS |

## 7. Handoff

1. U1 (3.5) with A2 (next, vite), A5 (after-U1 check), A6, A7, A8, A13 and A15; b3-measure; commit.
2. U2 after 2026-10-22T14:52Z with the final check (A2, A5); b3-measure; commit.
3. Verification 3.6: the non-DB checks first, then the locked runs one at a time; the Docker scan (A1).
4. Conventional commits without AI references; independent opus/max code review, at most 3 rounds (pre-push rounds
   count): the script's list equals the intended set; no new package; no major bump; the evidence is complete and honest
   (NOT RUN stated where true); the braces question was raised, not silenced.
5. One push, PR body per A14, CI green, MERGE_READY.

STOP (lane block L25): HALT on a major version change, a new package, an ignore or override beyond RO-L25-1, a change to
PR #50, or an application-code edit beyond what a patch bump forces (ruling request); BLOCKED on 3 failed rounds.

OPEN (outside L25's files): the inert `pnpm-workspace.yaml:15` postcss entry (row `pnpm-workspace-postcss-override-inert`,
untouched); the rows `deps-next-advisories-before-staging-deploy` and `osv-full-scan-red-on-main-2026-10` close by hand
after the merge and `braces-ghsa-vfj7-no-fixed-version` needs the 3.3 row text (docs lane); next 15.5.28's two extra
advisories are not yet in the global database (the upgrade fixes them anyway); the "OSV full dependency scan" result is
confirmed by the conductor on the next main Security run.
