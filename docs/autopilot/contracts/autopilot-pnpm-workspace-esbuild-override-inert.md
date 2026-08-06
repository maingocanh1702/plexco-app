<!-- review-readiness: code-ready -->
# AP-48 — pnpm-workspace-esbuild-override-inert: give the declared esbuild floor somewhere it applies

> **Status:** `CODE_READY` (see verdict, §9) · **Authored:** 2026-08-04 · **Risk:** P2
> **This is an AUTHORING artifact.** No worktree has been opened, no `register` has been attempted, no
> code exists. `pnpm-workspace.yaml`'s `esbuild@<0.25.0 → 0.25.12` override has been silently inert since
> commit `f1af6e3` (2026-07-22) — this packet exists to make it apply again.

## 0. Session input

```text
REQUEST: author-only slice contract (docs/autopilot-backlog.md task pnpm-workspace-esbuild-override-inert)
TARGET_FILES:
  - docs/standards/dependency-override-precedence.md
  - docs/autopilot-backlog.md
  - package.json
  - pnpm-workspace.yaml
  - pnpm-lock.yaml
  - docs/autopilot-invariant-catalog.md
  - docs/autopilot/contracts/autopilot-pnpm-workspace-esbuild-override-inert.md
  - docs/autopilot-manifests/pnpm-workspace-esbuild-override-inert.json
  - .claude/commands/ap-48-pnpm-workspace-esbuild-override-inert.md
EXPECTED_OUTCOME: CODE_READY (target); actual = CODE_READY, see §9
BASE_BRANCH: main
SCOPE_REPO: /Users/maingocanh/Projects/Plexco app
USER_AUTHORIZED_EDITS: yes (authoring this packet + manifest + launcher only; no register/worktree/code)
```

## 1. What this slice is (and isn't)

`package.json`'s `pnpm.overrides` is non-empty (`brace-expansion@1`, `sharp`, `postcss`). Per
`docs/standards/dependency-override-precedence.md` (measured, v1.2), a non-empty `pnpm.overrides` map
wholesale-replaces `pnpm-workspace.yaml`'s entire `overrides` map for actual dependency resolution — not
a per-key merge. `pnpm-workspace.yaml` declares `"esbuild@<0.25.0": 0.25.12`, intended to patch
`@esbuild-kit/core-utils@3.3.2`'s (a real, deprecated, transitively-pulled-in-by-`drizzle-kit`)
`esbuild: ~0.18.20` dependency up to a fixed release. Since `f1af6e3` (2026-07-22, the commit that gave
`package.json` its first `pnpm.overrides` entries), that rule has had zero effect: `pnpm-lock.yaml`
resolves `esbuild@0.18.20`, unrewritten, at this slice's base commit.

**The fix:** add the exact same conditional selector `pnpm-workspace.yaml` already uses —
`"esbuild@<0.25.0"` — to `package.json`'s `pnpm.overrides`, with a value that satisfies both the
`>=0.25.0` floor and this repo's `minimumReleaseAge` (10080 minutes) at implementation time. Then delete
the now-fully-redundant `esbuild` entry from `pnpm-workspace.yaml`'s `overrides` block — by key, not by
commenting it out or mirroring it.

**What this slice is not:**
- Not a `postcss` fix. `postcss` sits in both files today, already safe because `package.json`'s own
  `^8.5.10` happens to cover `pnpm-workspace.yaml`'s intended `<8.5.10 → 8.5.16` target — that is
  `deps-security-bump--postcss`'s scope (status: `blocked`), untouched here.
- Not a re-measurement of which override location wins. That is settled, cited, not re-litigated.
- Not an upgrade of `drizzle-kit` or `@esbuild-kit/*` themselves — those stay exactly as pinned; only the
  transitive `esbuild` version they resolve to changes, via the override mechanism they already declare
  themselves subject to (`esbuild: ~0.18.20`, a plain `dependencies` entry, not a peer range).

## 2. Authority pins

- **Decision authority:** `92c7832` — `docs(standards): measure pnpm override precedence between the two
  declaration sites`, the commit that landed `docs/standards/dependency-override-precedence.md` at its
  current (v1.2) content. Verified `git merge-base --is-ancestor 92c7832 <base_sha>` = true before
  authoring.
- **Backlog task authority:** `docs/autopilot-backlog.md:1312`, task block `pnpm-workspace-esbuild-
  override-inert` — states the exact remediation (conditional selector, delete-not-comment) and opens
  the risk-measurement this packet closes (§3below).
- **Live base:** `ddc1278790a9ef127668f18069a20ffa55ad1d25` (== `origin/main` tip, verified via
  `git rev-parse origin/main` and `git rev-parse HEAD` at authoring time; working tree clean on the three
  target files).

## 3. Live-repo verification (this session, 2026-08-04)

Every claim below was checked directly against the live repo or a primary external source at authoring
time — none is recalled from memory or copied from the backlog's own prose without re-checking. Two
direct-execution attempts (a reversible fix-and-revert experiment, and a read-only dry-run of the
verification commands) were both blocked by this session's auto-mode classifier — the first correctly
(it mutated `package.json`/`pnpm-workspace.yaml` outside a worktree), the second apparently over-broadly
(pure `grep`/`awk` reads, no mutation). Neither was retried. The rows below marked **[direct read]** were
captured via the `Read` tool or via `grep`/`git log` calls that executed successfully *before* the
classifier's block state began, earlier in this same session — cited by exact line number, not
re-verified live at write time.

| # | Claim | Evidence |
|---|---|---|
| 1 | `package.json`'s `pnpm.overrides` is non-empty and has no `esbuild` key | **[direct read]** `package.json` lines 29-35: `{"brace-expansion@1": "^1.1.16", "sharp": "^0.35.0", "postcss": "^8.5.10"}` |
| 2 | `pnpm-workspace.yaml`'s policy block sits directly above its `overrides` block | **[direct read]** lines 7-9 (`minimumReleaseAge: 10080`, `trustPolicy: no-downgrade`, `blockExoticSubdeps: true`), blank line, comment, then lines 14-16 (`overrides: {"esbuild@<0.25.0": 0.25.12, "postcss@<8.5.10": 8.5.16}`) |
| 3 | `pnpm-lock.yaml`'s applied `overrides:` header shows only `package.json`'s map | **[direct read, pre-block grep]** lines 7-10: `brace-expansion@1: ^1.1.16`, `sharp: ^0.35.0`, `postcss: ^8.5.10` — no `esbuild` |
| 4 | `esbuild@0.18.20` is resolved today, unrewritten | **[direct read, pre-block grep]** `pnpm-lock.yaml` lines 1439 and 3016, bare top-level `esbuild@0.18.20:` package blocks |
| 5 | The violating resolution's real consumer chain | **[direct read, pre-block grep]** `drizzle-kit@0.31.10` → `@esbuild-kit/esm-loader@2.6.5` → `@esbuild-kit/core-utils@3.3.2`, whose own resolved `dependencies` block (lockfile line 2218-2221) reads `esbuild: 0.18.20` — a plain dependency, not a peer range, confirming pnpm's override mechanism can rewrite it without `@esbuild-kit/core-utils` itself changing |
| 6 | A conditional (not bare) selector is required | **[direct read, pre-block grep]** `pnpm-lock.yaml` lines 3581-3585: `tsx@4.23.0`'s own resolved `dependencies` block reads `esbuild: 0.28.1` directly — a real, legitimate, unrelated consumer a bare override would downgrade |
| 7 | The remediation advisory is real, not fabricated | **[verified this session via OSV.dev]** `POST api.osv.dev/v1/query` for `{"package":{"name":"esbuild","ecosystem":"npm"},"version":"0.18.20"}` returns exactly one vulnerability: `GHSA-67mh-4wv8-2f99`, "esbuild enables any website to send any requests to the development server and read the response", severity `MODERATE`, `CVSS:3.1/AV:N/AC:H/PR:N/UI:R/S:U/C:H/I:N/A:N`, `CWE-346`, affected range `[0, 0.25.0)`, fixed `0.25.0`, GitHub-reviewed. This repo's own history already caught one *fabricated* GHSA claim about `postcss` in review (backlog notes on `deps-security-bump`) — this citation is deliberately sourced from a primary vulnerability database, not recalled |
| 8 | `minimumReleaseAge` (10080 min / 7 days) is not a blocker for the value `pnpm-workspace.yaml` already declared | **[verified this session via registry.npmjs.org]** `esbuild@0.25.12` published `2025-11-01` (~9 months before authoring); `esbuild@0.28.1` (current `dist-tags.latest`) published `2026-06-11` (~2 months before authoring). Both far past the 7-day floor |
| 9 | `build-config` is the correct invariant token | **[direct read]** `docs/autopilot-invariant-catalog.md:52` — `build-config — package manifest / lockfile / tsconfig / bundler` |
| 10 | The dependency (`pnpm-override-precedence-two-locations`) is merged | **[direct read]** `docs/standards/dependency-override-precedence.md` exists at base_sha with 9 commits in its history (`git log --oneline`), latest `92c7832`, confirmed ancestor of base_sha |

### 3.1 A nuance worth stating plainly, not burying

`GHSA-67mh-4wv8-2f99` is specifically about **esbuild's development server** (`serve`/watch mode CORS —
any website can `fetch()` the dev server's output because it sets `Access-Control-Allow-Origin: *`).
`drizzle-kit`'s actual use of `@esbuild-kit/core-utils` is to transpile `drizzle.config.ts` via esbuild's
`build()`/`transform()` API when running CLI commands (`generate`/`push`/etc.) — it does not start a
`serve()` dev server. Real-world exploitability through *this specific transitive path* is therefore
likely low. The fix is still correct: the advisory is real, the floor was already an intentional,
authored decision in this repo (the `pnpm-workspace.yaml` comment predates this slice), it is cheap, and
it removes latent risk if `drizzle-kit`'s own usage ever changes. This slice does not claim active
exploitation — it claims a declared control was silently not applying, which is the actual defect.

## 4. Dependency graph

```text
pnpm-override-precedence-two-locations (AP-45, merged, docs/standards/dependency-override-precedence.md)
  -> pnpm-workspace-esbuild-override-inert (this packet)
```

No hard dependency blocks code. `depends_on: []` in the manifest, with a note explaining why no
`dep_checks` entry is constructible (§ manifest `_dependency_note` — the dependency's own `merged_probe`
is a non-discriminating literal, same class as `authorize-tenant-action-core`'s precedent).

## 5. The fix — exact diff description

### 5.1 `package.json`

Add one key to the existing `pnpm.overrides` object (do not touch the other three keys):

```jsonc
"pnpm": {
  "overrides": {
    "brace-expansion@1": "^1.1.16",
    "sharp": "^0.35.0",
    "postcss": "^8.5.10",
    "esbuild@<0.25.0": "<VALUE>"   // <-- new key only
  }
}
```

`<VALUE>` is **not pinned by this contract**. At authoring time, `0.25.12` (the value
`pnpm-workspace.yaml` already declared) satisfies both the `>=0.25.0` floor and `minimumReleaseAge`
by a wide margin (§3 row 8) — but the implementer must re-measure at their own run time, not copy this
number blind, per the manifest's `_verification_rule` discipline. If a newer patched version exists and
also clears `minimumReleaseAge`, prefer it; if the only version clearing the floor is younger than
`minimumReleaseAge`, that is a human decision (§ task briefing `HUMAN_DECISIONS_REQUIRED`), not a bump —
stop and report rather than waiving the policy.

**Must be the conditional selector `"esbuild@<0.25.0"`, never a bare `"esbuild"` key** (§3 row 6 —
`tsx@4.23.0` has a real, legitimate direct dependency on `esbuild@0.28.1` that a bare override would
downgrade).

### 5.2 `pnpm-workspace.yaml`

Delete exactly one line from the `overrides` block — the `esbuild` entry — leaving `postcss` and the
three policy lines untouched:

```diff
 overrides:
-  "esbuild@<0.25.0": 0.25.12
   "postcss@<8.5.10": 8.5.16
```

Policy: **delete-not-comment**. No `# moved to package.json` comment, no mirrored duplicate. The
`minimumReleaseAge` / `trustPolicy` / `blockExoticSubdeps` lines (currently 3 lines above the `overrides:`
key, separated by a blank line and a comment) are not part of this edit at all — deleting the `esbuild`
override key must not touch them, and must not be done via a line-range or block delete that could catch
them incidentally.

### 5.3 `pnpm-lock.yaml`

Regenerate only, via `pnpm install --lockfile-only` (or a full `pnpm install` if `node_modules` refresh is
also needed for the canonical build/test verification). Never hand-edit. After regeneration:

- The header `overrides:` block (today: `brace-expansion@1`, `sharp`, `postcss`) gains the new
  `esbuild@<0.25.0` entry.
- The bare top-level `esbuild@0.18.20:` package block (today at lines 1439/3016) should no longer exist.
- `tsx@4.23.0`'s own `esbuild@0.28.1` resolution must be unchanged (§ acceptance matrix, §8).

**Verification trap, already documented and worth repeating here:** do not use `pnpm config get
overrides --json` as evidence of the resolution outcome — at this repo's pinned pnpm version it reads a
different, workspace-only view that disagrees with actual resolution by design (standards doc, "A
critical distinction"). Do not use plain `pnpm why esbuild -r` either, if `node_modules` already exists
from an earlier unrelated install in the same worktree — it can report stale, pre-edit state (standards
doc, "A reproduction trap"). The only trusted evidence is a direct `grep 'esbuild@' pnpm-lock.yaml`
against the freshly-written lockfile.

## 6. Negative scope

Verbatim from the manifest's `negative_scope` (§ manifest, this is the authoritative copy — read that
file, this is a convenience mirror):

1. Never touch `pnpm-workspace.yaml`'s `minimumReleaseAge` / `trustPolicy` / `blockExoticSubdeps` lines.
2. No lowering or waiving those three policy values.
3. No `--ignore-scripts`, `--no-frozen-lockfile`, or `--no-verify` on any `pnpm` invocation.
4. No hand-editing `pnpm-lock.yaml`.
5. No touching `postcss` / `brace-expansion@1` / `sharp` in either file.
6. No bare/unconditional `"esbuild"` key in `package.json`.
7. No editing `docs/autopilot-backlog.md` as part of this slice's own registered scope.
8. No re-opening or re-measuring `dependency-override-precedence.md`'s core finding.
9. No pinning a specific replacement version literal into the runtime manifest's verification.

## 7. Verification commands — what fails today, what's a standing guard

The task briefing instructed: *"the manifest's verification.focused must be real shell commands, and at
least one must FAIL against the current tree. At minimum: no esbuild below 0.25.0 in pnpm-lock.yaml, and
the three security settings still present in pnpm-workspace.yaml. Prove both fail today."*

Measured (via §3's direct-read evidence, not re-executed live — see §3's classifier-block note), this
holds only for the first half. Recorded here rather than silently smoothed over, per this repo's
anti-drift convention (a measurement that disagrees with an instruction is recorded, not quietly
corrected out of the paper trail):

| Check | Property | Today | After fix |
|---|---|---|---|
| 1 | No resolved `esbuild@` in `pnpm-lock.yaml` below `0.25.0` | **FAILS** (`0.18.20` present, §3 row 4) | PASS |
| 2 | `pnpm-workspace.yaml`'s `overrides` no longer has an `esbuild` key | **FAILS** (key present, §3 row 2) | PASS |
| 3 | `minimumReleaseAge`/`trustPolicy`/`blockExoticSubdeps` all present in `pnpm-workspace.yaml` | **PASSES already** (§3 row 2) | must still PASS (regression guard) |
| 4 | `package.json` carries the `"esbuild@<0.25.0"` selector | **FAILS** (absent, §3 row 1) | PASS |
| 5 | `package.json` has no bare `"esbuild"` key | PASSES already (absent today) | must still PASS (regression guard) |
| 6 | `package.json`'s `postcss`/`brace-expansion@1`/`sharp` values unchanged | PASSES already | must still PASS (regression guard) |
| 7 | `pnpm-workspace.yaml`'s `postcss@<8.5.10` entry unchanged | PASSES already | must still PASS (regression guard) |

Checks 1, 2 and 4 are the defect detectors — at least one failing today was the instruction's bar, and
three do. Check 3 (the literal "three security settings" check) is, by construction, a check that must
**always** be true — it is the guard that stops the `esbuild`-key deletion from spilling into the
adjacent policy lines, not a defect detector. It cannot simultaneously satisfy "prove it fails today" and
serve its actual purpose. Checks 5-7 are the same category: guards against collateral damage the negative
scope already prohibits, made machine-checkable rather than left as prose.

Exact commands: see the manifest's `verification.focused` array. **Hand-execute every one against the
real system `awk`/`grep` before calling `register`** — this repo's own registration-mechanics lesson
(`docs/autopilot/contracts/autopilot-pnpm-override-precedence-two-locations.md`, "Registration mechanics") found that BSD
`grep` rejects a pattern starting with a literal `-` unless `-e` is added first, and the manifest is
hash-locked immediately after `register` with no in-place fix available.

## 8. Acceptance matrix

| Category | Scenario | Expected result |
|---|---|---|
| Correctness | Any transitive consumer requesting `esbuild@<0.25.0` (today: `@esbuild-kit/core-utils@3.3.2` via `drizzle-kit`) | Resolves to the version written in `package.json`'s new conditional override (`>=0.25.0`, satisfying `minimumReleaseAge` at implementation time) |
| Correctness | `tsx@4.23.0`'s own direct `esbuild@0.28.1` dependency | Unaffected — the conditional selector `<0.25.0` does not match `0.28.1` |
| Regression | `postcss` / `brace-expansion@1` / `sharp` in `package.json`'s `pnpm.overrides` | Byte-identical to base |
| Regression | `postcss@<8.5.10` in `pnpm-workspace.yaml`'s `overrides` | Byte-identical to base — owned by `deps-security-bump--postcss`, untouched here |
| Regression | `minimumReleaseAge` / `trustPolicy` / `blockExoticSubdeps` | Byte-identical to base |
| Policy | `esbuild` entry in `pnpm-workspace.yaml`'s `overrides` | Deleted entirely — not commented, not mirrored |
| Security | `GHSA-67mh-4wv8-2f99` (fixed `0.25.0`) | No resolved `esbuild@<0.25.0` remains anywhere in `pnpm-lock.yaml` |
| Build | `pnpm typecheck` / `pnpm lint` / `pnpm build` / full `DATABASE_URL_TEST=... pnpm test` | Green — the pre-existing `pnpm-workspace.yaml` comment already asserts `drizzle-kit`/`esbuild-loader` API compatibility with `0.25.x`+; canonical verification is the empirical confirmation of an already-made call, not a fresh one |
| Process | `pnpm config get overrides --json` | Not evidence of the resolution outcome — documented divergence (§5.3); do not use it to verify this fix |
| Process | `pnpm why esbuild -r` with pre-existing `node_modules` | Not trusted if `node_modules` predates the edit (§5.3); use a fresh `--lockfile-only` install + direct lockfile `grep` |

## 9. Canonical verdict

```text
REVIEW_POLICY_VERSION: 1.3
REVIEW_VERDICT: CODE_READY
REVIEWED_AT: 2026-08-04
AUTHORITY_SHA: 92c7832f2ae5c95c671f3bbdd07676b6f70628ef
LIVE_BASE_SHA: ddc1278790a9ef127668f18069a20ffa55ad1d25
BASE_BRANCH: main
BASE_REMOTE_RELATION: MAIN_EQUALS_ORIGIN_MAIN
TARGET_FILES:
  - docs/standards/dependency-override-precedence.md
  - docs/autopilot-backlog.md
  - package.json
  - pnpm-workspace.yaml
  - pnpm-lock.yaml
  - docs/autopilot-invariant-catalog.md
  - docs/autopilot/contracts/autopilot-pnpm-workspace-esbuild-override-inert.md
  - docs/autopilot-manifests/pnpm-workspace-esbuild-override-inert.json
  - .claude/commands/ap-48-pnpm-workspace-esbuild-override-inert.md
SLICE: pnpm-workspace-esbuild-override-inert
IN_SCOPE: add esbuild@<0.25.0 conditional override to package.json's pnpm.overrides; delete the dead
  mirror from pnpm-workspace.yaml's overrides; regenerate pnpm-lock.yaml
OUT_OF_SCOPE: postcss (deps-security-bump--postcss); re-measuring override precedence; drizzle-kit /
  @esbuild-kit upgrades; docs/autopilot-backlog.md's own task-block update (full list §6)
G1_DECISION: PASS — remediation approach fully decided in the standards doc + backlog notes; only the
  exact patch-version literal is deliberately left as a run-time measurement, not a product/policy choice
G2_SPEC: PASS — docs/standards/dependency-override-precedence.md (Status: Measured, v1.2) is the reviewed
  technical authority for this infra/core slice; no product-facing spec applies
G3_DEPENDENCY: PASS — the one dependency (AP-45) is merged and on this slice's base; every file this
  slice reads exists at base_sha (§3)
G4_TEST: PASS — exact invariant + expected assertions specified before code (§7, §8); every command
  asserts a property, none a resolved-version literal
G5_SCOPE: PASS — mechanism-named (relocate one override key, delete its dead mirror), explicit negative
  scope, 6 files total, not a mega-slice
G6_EXTERNAL: PASS — no PII/money/provider/legal gate applies; the dependency-security concern is routed
  through security_review.required=true in the runtime manifest, not a G6 external-approval gate
HARD_DEPENDENCIES: none
PRIOR_SLICES: pnpm-override-precedence-two-locations (AP-45, merged) -> pnpm-workspace-esbuild-override-
  inert (this packet)
OPEN_QUESTIONS_IN_SCOPE: 0
ENABLEMENT_ONLY_GATES: none
LIVE_REPO_VERIFICATION: PASS — see §3; two direct-execution attempts were blocked by the session's
  auto-mode classifier (§3 preamble, §7), today-state confirmed via already-captured direct reads instead
CONTRACT_MATRIX: PASS
CLOSURE_MATRIX: PASS — 12/12, see §9.1
ACCEPTANCE_MATRIX: PASS — see §8
SECURITY_AND_MIGRATION_GATE: PASS — no migration; security_review.required=true declared with a specific
  reviewer brief (manifest security_review.reason)
IMPLEMENTATION_ARTIFACTS: PASS — packet + manifest + launcher all authored
FIRST_IMPLEMENTATION_STEP: open a worktree from ddc1278790a9ef127668f18069a20ffa55ad1d25 via
  .claude/commands/ap-48-pnpm-workspace-esbuild-override-inert.md; edit package.json (§5.1) then
  pnpm-workspace.yaml (§5.2) in that order, then regenerate pnpm-lock.yaml (§5.3)
REMAINING_BLOCKERS: none
NEXT_REVIEW_TRIGGER: none — this verdict stands until the implementer opens a worktree; re-open only if
  package.json / pnpm-workspace.yaml / the standards doc changes on main before then
```

### 9.1 Closure matrix (12/12)

| # | Gate | Evidence | PASS/FAIL |
|---|---|---|---|
| 1 | Authority snapshot pin theo SHA | `92c7832` (decision, verified ancestor) + `ddc1278` (live base, verified == origin/main, clean tree) | PASS |
| 2 | Decision trong scope đã chốt | Standards doc §"A live consequence" + backlog notes (line 1329-1337) fully specify the remediation; only the version literal is a deliberate run-time measurement, not an open decision | PASS |
| 3 | Scope IN/OUT và owner rõ | §5 (exact diff per file), §6 (negative scope) | PASS |
| 4 | Dependency phân loại đủ | §4 — one dependency, merged, non-constructible dep_checks documented and precedented (manifest `_dependency_note`) | PASS |
| 5 | Live schema/code khớp doc | §3 — 10 claims, each cited to an exact line number or a primary external source (OSV.dev, npm registry) | PASS |
| 6 | Data/API/state/auth contract đủ | §5.1/§5.2 — exact key to add, exact key to delete, exact selector string pinned; no schema/API surface | PASS |
| 7 | Fail-closed/idempotency/order đủ | §5.3 — verification order (edit package.json, then delete workspace key, then regenerate lockfile) and the two documented verification traps (`pnpm config get`, stale `pnpm why`) to avoid | PASS |
| 8 | Open question trong scope = 0 | The only deferred item (exact version literal) is a specified measurement procedure with a stated fallback (escalate if minimumReleaseAge blocks it), not an undecided product/policy question | PASS |
| 9 | Acceptance matrix có expected result | §8 — every row has a scenario and an expected result across correctness/regression/security/build/process categories | PASS |
| 10 | Migration/security/rollback pin | No migration; security reviewer brief pinned (manifest `security_review.reason`); rollback = revert 2 lines + regenerate lockfile, trivially safe (this only raises a floor, never removes a working resolution) | PASS |
| 11 | First slice có hard dependency merged | §4 — the one dependency is merged; this is the lowest unbuilt node | PASS |
| 12 | Implementation handoff sẵn sàng | Packet + manifest + launcher authored; §5 gives exact, non-paraphrased diffs | PASS |

12/12 PASS. Verdict: **`CODE_READY`**.

## 10. Open items (non-blocking — do not read as `CODE_READY` blockers)

1. **The exact patch-version literal is intentionally unresolved by this contract.** `0.25.12` (the
   value `pnpm-workspace.yaml` already declared) clears both the floor and `minimumReleaseAge` by a wide
   margin as measured today (§3 row 8), but the implementer must re-measure at their own run time — time
   will have passed, and this contract deliberately does not hardcode a version into the hash-locked
   runtime manifest (§5.1, § manifest `negative_scope` item 9).
2. **`docs/autopilot-backlog.md:1312`'s task block will read as stale** (`status: idea`, `manifest:
   null`) the moment this packet lands, and stays that way until updated out of band, deliberately —
   see § manifest `_scope_note`. Whoever picks this up next should update that block's `status`,
   `manifest`, `risk` (drop "tạm thời") and `scope` fields by hand, separately from this slice's own
   registered scope, to avoid the cross-lane collision two parallel registrations already hit this week.
3. **Two direct-execution verification attempts in this authoring session were blocked**, one correctly
   (a mutation attempt outside a worktree) and one apparently over-broadly (a pure read-only dry-run of
   the verification commands). See §3's preamble and §7. This does not weaken the verdict — CODE_READY
   is a statement about contract completeness, and the today-state of every check was independently
   confirmed via direct file reads captured earlier in this same session — but it does mean the exact
   `verification.focused` commands were reasoned through and cross-checked against captured file content
   rather than shell-executed live at authoring time. The launcher makes hand-verification before
   `register` an explicit, non-optional step for exactly this reason.
4. **Exploitability nuance (§3.1):** the advisory this fix closes is a dev-server CORS issue; this
   repo's actual reachable path (`drizzle-kit`'s config transpilation) does not start a dev server. The
   fix is correct regardless (§3.1), but a future reader should not infer active exploitation from this
   slice's own existence.
