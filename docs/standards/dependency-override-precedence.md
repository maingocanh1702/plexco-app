# Dependency Override Precedence — `package.json` `pnpm.overrides` vs `pnpm-workspace.yaml` `overrides`

> **Version:** v1.1 · 2026-08-03
> **Status:** Measured
> **Scope:** Which override declaration wins **for actual dependency resolution** (the version that
> ends up in `pnpm-lock.yaml` and gets installed) when `package.json`'s `pnpm.overrides` and
> `pnpm-workspace.yaml`'s `overrides` both name the same package with different values, at the pnpm
> version this repo pins. This document is explicitly **not** a claim about what `pnpm config get`
> or other CLI introspection commands report — see "A critical distinction" below, which those
> commands disagree with the resolution outcome.
> **References:** `docs/autopilot-backlog.md` task `pnpm-override-precedence-two-locations` (opened
> from `deps-security-bump`'s AP-39 design probe) · `docs/autopilot-pnpm-override-precedence-two-locations.md`

---

## Measured result

- Winner: package.json (pnpm.overrides)
- pnpm version measured: 10.30.2
- Measured: 2026-08-03

**`package.json`'s `pnpm.overrides` takes precedence over `pnpm-workspace.yaml`'s `overrides` for
actual dependency resolution — the version written to `pnpm-lock.yaml` and installed — when both
declare the same package selector with conflicting values, at pnpm 10.30.2.** The
`pnpm-workspace.yaml` value is silently dropped for that key in the resolved lockfile — no warning,
no error, nothing in the install log names the shadowed file or value. `pnpm install` /
`pnpm install --lockfile-only` exits clean either way, regardless of which value is numerically
higher.

This is a narrower, more precisely-scoped claim than the v1.0 draft of this document made, after a
code-review round surfaced a real, separate phenomenon (below) that looks like a contradiction but
is not one once the two are told apart.

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

## A critical distinction: resolution outcome vs. `pnpm config get` / CLI introspection

**`pnpm config get overrides --json` does not report what this document measures, and disagrees with
it.** Run at this repo's base commit (`package.json` and `pnpm-workspace.yaml` unmodified, no live
conflict — `postcss` present in both with agreeing values):

```
$ pnpm config get overrides --json
{
  "esbuild@<0.25.0": "0.25.12",
  "postcss@<8.5.10": "8.5.16"
}
```

`package.json`'s own overrides (`brace-expansion@1`, `sharp`, `postcss`) are **entirely absent** from
this output — not merged, not shadowed-with-a-trace, just missing. This is not specific to a
conflict: `pnpm config get overrides` only ever surfaces `pnpm-workspace.yaml`'s map in this repo,
regardless of what `package.json` declares.

**Source-traced explanation (pnpm 10.30.2, `/opt/homebrew/lib/node_modules/pnpm/dist/pnpm.cjs`,
this machine's installed copy of the pinned version):** the general-purpose CLI config builder reads
root-manifest (`package.json`) settings first —
`Object.assign(pnpmConfig, getOptionsFromRootManifest(...))` — then, if a workspace manifest exists,
loops `for (const [key, value] of Object.entries(newSettings)) { pnpmConfig[key] = value }` where
`newSettings` comes from `getOptionsFromPnpmSettings(workspaceDir, workspaceManifest, ...)`. That
function's `overrides` field is `pnpm-workspace.yaml`'s own `overrides` block verbatim (with
version-reference values resolved against the root manifest, but no key-level merge with
`package.json`'s own overrides). Because `pnpm-workspace.yaml` in this repo declares `overrides` at
all, this is a **whole-field replacement**, not a merge: `pnpmConfig.overrides` ends up being
*exactly* `pnpm-workspace.yaml`'s map, and `package.json`'s entries are dropped from that
config object entirely. `pnpm config get` reads directly from this object, which is why it only ever
shows the workspace map.

**This was confirmed live, not just at the quiescent base state.** Setting `package.json`
`pnpm.overrides.picocolors = "1.0.0"` and `pnpm-workspace.yaml` `overrides.picocolors = 1.0.1`
simultaneously (Trial 1's exact setup) and running `pnpm config get overrides --json` *before any
install* reports:

```
{
  "esbuild@<0.25.0": "0.25.12",
  "postcss@<8.5.10": "8.5.16",
  "picocolors": "1.0.1"
}
```

— the **workspace** value, `1.0.1`. But the actual resolved lockfile for the same live conflict (see
Evidence below) records `picocolors@1.0.0` — the **package.json** value. `pnpm config get` and actual
resolution disagree, for the identical conflict, at the identical moment. **Do not use
`pnpm config get overrides` (or any command that reads the same config object, including
`assertWantedLockfileUpToDate`'s outdated-lockfile-setting check) to audit which override this repo's
dependency resolution is actually honoring — it will show you `pnpm-workspace.yaml`'s view only.**

**Honesty about what was and was not traced:** the above explains *why `pnpm config get` shows only
the workspace map*. It does not fully trace *why actual install-time resolution still honors
`package.json`'s value when the two conflict* — that would require following the install command's
own options-construction path (`extendOptions` in the install package) past the point this
investigation reached in a minified, bundled CLI without source maps or a debugger. The precedence
claim in this document rests on **direct, repeated, cross-verified measurement of the resolved
lockfile** (three independent trials, below), not on a complete source-level proof of the mechanism —
consistent with this document's own mandate to measure rather than infer.

## A reproduction trap: `pnpm why` can read stale installed state

The original reproduction recipe (v1.0 of this document) used `pnpm why <pkg> -r` after
`pnpm install --lockfile-only` to read the winner. **This is unreliable if `node_modules` already
exists from an earlier, unrelated `pnpm install` in the same worktree** — confirmed directly:

Re-running Trial 1's exact conflict (`picocolors`: `1.0.0` in `package.json`, `1.0.1` in
`pnpm-workspace.yaml`) in a worktree that had previously run a full `pnpm install` (for `typecheck`/
`lint`/`build`, unrelated to the experiment):

| Source                                | Reports          |
| -------------------------------------- | ----------------- |
| `pnpm why picocolors -r` (plain)       | `picocolors@1.1.1` — the **original, pre-experiment, un-overridden** version |
| `grep 'picocolors@' pnpm-lock.yaml`    | `picocolors@1.0.0` — the correct, freshly-resolved winner |

`pnpm why` read from the stale `node_modules/.pnpm` installed graph left over from the earlier full
install, not from the lockfile the experiment had just written. The freshly-written `pnpm-lock.yaml`
was correct the entire time; only the convenience command was misleading. **This did not affect
Trials 1 and 2 below** — both ran in a worktree that had never had `node_modules` installed, so there
was no stale graph for `why` to read, and both were independently cross-checked against the raw
lockfile at the time. It does mean: **treat direct lockfile inspection as the primary evidence, and
`pnpm why` as, at best, a secondary check that requires a `node_modules`-free (or freshly
`pnpm install`-ed, non-lockfile-only) state to trust.**

## Reproduction

Run from the repository root, on a clean tree, using a harmless package that is not on the money path
and is not already overridden anywhere in this repo. Prefer a worktree/checkout with no
`node_modules` yet — if one already exists, delete it first, or skip `pnpm why` and rely solely on
the lockfile grep:

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

# Primary evidence — read the wanted lockfile directly, immune to node_modules staleness:
grep 'picocolors@' pnpm-lock.yaml

# Secondary check — only trust this if node_modules did not already exist before this install:
pnpm why picocolors -r

# Diagnostic (optional) — shows pnpm-workspace.yaml's view, NOT the resolution outcome; see above:
pnpm config get overrides --json

# Revert — never leave the experiment in the tree.
git checkout -- package.json pnpm-workspace.yaml pnpm-lock.yaml
```

## Evidence — three trials

Trials 1 and 2 reverse which file holds the numerically larger value, to rule out a "lower/higher
value wins" confound rather than a location-based rule. Trial 3 repeats Trial 1's setup specifically
to capture `pnpm config get overrides --json` and the resolved lockfile for the identical live
conflict, at the identical moment, to prove the two disagree rather than merely suspect it.

| Trial | Package    | package.json value | pnpm-workspace.yaml value | Resolved (lockfile) | `pnpm config get` | Winner (resolution) |
| ----- | ---------- | -------------------- | --------------------------- | --------------------- | -------------------- | ---------------------- |
| 1     | picocolors | 1.0.0 (lower)         | 1.0.1 (higher)               | 1.0.0                  | not checked           | package.json            |
| 2     | ms         | 2.1.2 (higher)        | 2.1.1 (lower)                | 2.1.2                  | not checked           | package.json            |
| 3     | picocolors | 1.0.0 (lower)         | 1.0.1 (higher)               | 1.0.0                  | 1.0.1 (workspace's view — disagrees) | package.json            |

All three trials used a bare package-name selector — the same shape `postcss` already uses in both
locations today — on a harmless, non-money-path transitive dependency confirmed present in the
dependency graph before the trial (`picocolors` via `postcss`/`vite`; `ms` via `debug`/`eslint`).
Trial 2 deliberately reversed which file held the numerically larger value, and `package.json` won
again — ruling out "the lower value wins" or "the higher value wins" as the real rule for resolution
outcome; the winner is determined by **location**, not by value. Neither `pnpm install --lockfile-only`
run printed any warning, error, or precedence notice for the conflicting key. All trials were fully
reverted (`git diff` against this slice's base commit confirmed `package.json`, `pnpm-workspace.yaml`,
and `pnpm-lock.yaml` byte-identical to base afterward) before this document was written — no override
declaration in this repo changed as a result of this measurement.

## Caveat — a measured fact at one pnpm version, not a permanent law

pnpm has changed where these settings live before and may change resolution order again in a future
release. **Re-measure with the reproduction steps above before relying on this conclusion if
`pnpm --version` no longer reads `10.30.2`.** Do not extrapolate this precedence rule to unrelated
settings (`packageExtensions`, `patchedDependencies`, `onlyBuiltDependencies`, etc.) without measuring
those independently — this document makes a claim about `overrides` specifically, nothing broader. As
noted above, the mechanism behind `pnpm config get`'s divergence is source-cited; the mechanism behind
actual resolution honoring `package.json` was not fully source-traced and rests on direct measurement.

## Practical guidance until pnpm unifies the two locations

- Prefer declaring any given package's override in exactly **one** location. This repo's current
  convention is `package.json`'s `pnpm.overrides` for unconditional forces (`brace-expansion@1`,
  `sharp`, `postcss`) and `pnpm-workspace.yaml`'s `overrides` for conditional range-rewrites
  (`esbuild@<0.25.0`, `postcss@<8.5.10`) — `postcss` is the one exception, present in both today, and
  it is safe only because both entries currently agree.
- If a package must appear in both (an unconditional force plus a conditional rewrite for the same
  package, as `postcss` does today), keep the two values in agreement and verify with a direct
  `grep '<pkg>@' pnpm-lock.yaml` after editing **either** file, not just the one you touched — not
  with `pnpm config get overrides`, which will not show `package.json`'s side at all (see above).
- If the two locations are ever found to genuinely disagree for a live package, that is a live
  conflict, not a documentation question. `package.json` wins per this measurement for actual
  resolution, but deciding *which value should be authoritative going forward* is an owner decision,
  not something to resolve by simply trusting the precedence rule.
