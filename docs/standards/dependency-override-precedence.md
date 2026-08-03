# Dependency Override Precedence — `package.json` `pnpm.overrides` vs `pnpm-workspace.yaml` `overrides`

> **Version:** v1.0 · 2026-08-03
> **Status:** Measured
> **Scope:** Which override declaration wins when `package.json`'s `pnpm.overrides` and
> `pnpm-workspace.yaml`'s `overrides` both name the same package with different values, at the pnpm
> version this repo pins.
> **References:** `docs/autopilot-backlog.md` task `pnpm-override-precedence-two-locations` (opened
> from `deps-security-bump`'s AP-39 design probe) · `docs/autopilot-pnpm-override-precedence-two-locations.md`

---

## Measured result

- Winner: package.json (pnpm.overrides)
- pnpm version measured: 10.30.2
- Measured: 2026-08-03

**`package.json`'s `pnpm.overrides` takes precedence over `pnpm-workspace.yaml`'s `overrides` when both
declare the same package selector with conflicting values, at pnpm 10.30.2.** The
`pnpm-workspace.yaml` value is silently dropped for that key — no warning, no error, nothing in the
install log names the shadowed file or value. `pnpm install` / `pnpm install --lockfile-only` exits
clean either way, regardless of which value is numerically higher.

## Why this matters

pnpm has been migrating `pnpm.*` settings (`overrides`, `packageExtensions`, `patchedDependencies`, …)
from `package.json` to `pnpm-workspace.yaml` across releases, and this repo currently carries genuine
overrides in **both** locations: `package.json`'s `pnpm.overrides` has `brace-expansion@1`, `sharp`,
`postcss`; `pnpm-workspace.yaml`'s `overrides` has `esbuild@<0.25.0`, `postcss@<8.5.10`. `postcss` is
the one key present in both today, and the two values currently agree — `package.json`'s `^8.5.10`
accepts `pnpm-workspace.yaml`'s rewrite target `8.5.16`. So the repo is safe today by **agreement**,
not by a known rule.

`deps-security-bump` (AP-39, 2026-07-30) hit this directly as `DSB-4`: rather than guess which
location would win if a bump touched only one of them, it deliberately pinned the *same exact version*
in both locations for `postcss`, making the fix correct by construction instead of by an unverified
precedence assumption. That workaround is only safe while the two locations keep agreeing — the
moment someone edits one and forgets the other, precedence silently decides the real outcome, and
until this measurement nobody knew which one would win. This document closes that gap: the precedence
is now a recorded, reproducible fact instead of an avoided question.

## Reproduction

Run from the repository root, on a clean tree, using a harmless package that is not on the money path
and is not already overridden anywhere in this repo:

```bash
pnpm --version   # confirm you are measuring against the version this doc claims; re-measure if it differs

# Force two different values for the SAME bare-name selector in both locations.
node -e "
const fs = require('fs');
const p = JSON.parse(fs.readFileSync('package.json', 'utf8'));
p.pnpm.overrides.picocolors = '1.0.0';
fs.writeFileSync('package.json', JSON.stringify(p, null, 2) + '\n');
"
# Then hand-edit pnpm-workspace.yaml, adding under its existing `overrides:` key:
#   "picocolors": 1.0.1

pnpm install --lockfile-only
pnpm why picocolors -r        # the resolved version reveals the winner

# Revert — never leave the experiment in the tree.
git checkout -- package.json pnpm-workspace.yaml pnpm-lock.yaml
```

## Evidence — two trials, magnitude reversed to rule out a "lower/higher value wins" confound

| Trial | Package     | `package.json` value | `pnpm-workspace.yaml` value | Resolved | Winner         |
| ----- | ----------- | --------------------- | ---------------------------- | -------- | -------------- |
| 1     | `picocolors`| `1.0.0` (lower)        | `1.0.1` (higher)              | `1.0.0`  | `package.json` |
| 2     | `ms`        | `2.1.2` (higher)       | `2.1.1` (lower)               | `2.1.2`  | `package.json` |

Both trials used a bare package-name selector — the same shape `postcss` already uses in both
locations today — on a harmless, non-money-path transitive dependency confirmed present in the
dependency graph before the trial (`picocolors` via `postcss`/`vite`; `ms` via `debug`/`eslint`).
Trial 2 deliberately reversed which file held the numerically larger value, and `package.json` won
again — ruling out "the lower value wins" or "the higher value wins" as the real rule; the winner is
determined by **location**, not by value. Neither `pnpm install --lockfile-only` run printed any
warning, error, or precedence notice for the conflicting key. Both trials were fully reverted
(`git diff` against this slice's base commit confirmed `package.json`, `pnpm-workspace.yaml`, and
`pnpm-lock.yaml` byte-identical to base afterward) before this document was written — no override
declaration in this repo changed as a result of this measurement.

## Caveat — a measured fact at one pnpm version, not a permanent law

pnpm has changed where these settings live before and may change resolution order again in a future
release. **Re-measure with the reproduction steps above before relying on this conclusion if
`pnpm --version` no longer reads `10.30.2`.** Do not extrapolate this precedence rule to unrelated
settings (`packageExtensions`, `patchedDependencies`, `onlyBuiltDependencies`, etc.) without measuring
those independently — this document makes a claim about `overrides` specifically, nothing broader.

## Practical guidance until pnpm unifies the two locations

- Prefer declaring any given package's override in exactly **one** location. This repo's current
  convention is `package.json`'s `pnpm.overrides` for unconditional forces (`brace-expansion@1`,
  `sharp`, `postcss`) and `pnpm-workspace.yaml`'s `overrides` for conditional range-rewrites
  (`esbuild@<0.25.0`, `postcss@<8.5.10`) — `postcss` is the one exception, present in both today, and
  it is safe only because both entries currently agree.
- If a package must appear in both (an unconditional force plus a conditional rewrite for the same
  package, as `postcss` does today), keep the two values in agreement and verify with
  `pnpm why <pkg> -r` after editing **either** file, not just the one you touched.
- If the two locations are ever found to genuinely disagree for a live package, that is a live
  conflict, not a documentation question. `package.json` wins per this measurement, but deciding
  *which value should be authoritative going forward* is an owner decision, not something to resolve
  by simply trusting the precedence rule.
