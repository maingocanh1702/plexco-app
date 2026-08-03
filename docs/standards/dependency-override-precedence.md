# Dependency Override Precedence — `package.json` `pnpm.overrides` vs `pnpm-workspace.yaml` `overrides`

> **Version:** v1.2 · 2026-08-03
> **Status:** Measured
> **Scope:** Which override declaration governs **actual dependency resolution** (the version that ends
> up in `pnpm-lock.yaml` and gets installed) when `package.json`'s `pnpm.overrides` and
> `pnpm-workspace.yaml`'s `overrides` are both present, at the pnpm version this repo pins. This
> document is explicitly **not** a claim about what `pnpm config get` or other CLI introspection
> commands report — see "A critical distinction" below, where those commands disagree with the
> resolution outcome.
> **References:** `docs/autopilot-backlog.md` task `pnpm-override-precedence-two-locations` (opened
> from `deps-security-bump`'s AP-39 design probe) · `docs/autopilot-pnpm-override-precedence-two-locations.md`

---

## Measured result

- Winner: package.json (pnpm.overrides)
- pnpm version measured: 10.30.2
- Measured: 2026-08-03

**When `package.json` declares a NON-EMPTY `pnpm.overrides` field (or a non-empty Yarn-compatibility
`resolutions` field — both feed the same root-derived map), it entirely replaces
`pnpm-workspace.yaml`'s `overrides` map for actual dependency resolution — a whole-map replacement,
not a per-key merge.** An *empty* `pnpm.overrides: {}` does **not** trigger this: pnpm deletes an
empty override map before applying root settings (`pnpm.cjs:20826`, inside
`getOptionsFromPnpmSettings`), so `pnpm-workspace.yaml`'s map is left alone in that specific case. The
precise condition is "a non-empty root-derived override map is present," not merely "`package.json`
mentions `pnpm.overrides` at all." Whenever that condition holds, every key `pnpm-workspace.yaml`
declares is dropped, including keys `package.json` never mentions. This is a stronger and more
dangerous rule than "the two files merge and `package.json` wins ties" — earlier drafts of this
document described it that way, and two code-review rounds caught successive imprecisions before they
could ship as guidance. See "A live consequence" below for the real, present-day gap this creates in
this repo.

## Why this matters

pnpm has been migrating `pnpm.*` settings (`overrides`, `packageExtensions`, `patchedDependencies`, …)
from `package.json` to `pnpm-workspace.yaml` across releases, and this repo currently carries genuine
overrides in **both** locations: `package.json`'s `pnpm.overrides` has `brace-expansion@1`, `sharp`,
`postcss`; `pnpm-workspace.yaml`'s `overrides` has `esbuild@<0.25.0`, `postcss@<8.5.10`. Because
`package.json` declares a non-empty overrides map, its map is the only one actually applied — `postcss` is
covered only because `package.json`'s own `^8.5.10` entry happens to cover it, not because the two
rules "agree." `pnpm-workspace.yaml`'s `postcss@<8.5.10 → 8.5.16` rewrite is not contributing anything;
it is inert. `esbuild@<0.25.0 → 0.25.12` has no `package.json` counterpart at all, so it is inert with
nothing masking the gap — see "A live consequence" below.

**Provenance, verified via `git log -S`/`git show`, not assumed:** the `postcss` values in both files
today (`package.json`: `^8.5.10`; `pnpm-workspace.yaml`: `<8.5.10 → 8.5.16`) **predate**
`deps-security-bump` (AP-39) entirely — they are not that task's output. AP-39 did, mid-flight on
2026-07-30, unify both locations to a single matching pin, `postcss@<8.5.18: 8.5.18`, as its own
`DSB-4` resolution, reasoning that "whichever wins gives the same result." That specific change was
then **reverted** in the same task (commit `cf031f0`, *"split postcss out of this slice; ship next
alone"*) after AP-39's own security round independently found a real, unrelated issue in `8.5.18` still
inside the owner-ratified `minimumReleaseAge` window — the owner deferred the whole `postcss` bump to
a separate, still-`blocked` task (`deps-security-bump--postcss`) and restored both files
byte-identical to their pre-AP-39 state, which is the state measured here.

So today's safety is **not** "DSB-4's fix landed and covers it" — DSB-4's fix did not land. It is
coincidence: the pre-existing `package.json` entry happens to already satisfy `pnpm-workspace.yaml`'s
intended target. DSB-4's *reasoning* ("pin both, so whichever wins is fine") was sound given what it
assumed (a possible per-key conflict), and would still have been safe had it landed — but whole-map
replacement means the pin didn't need to be duplicated at all, only `package.json`'s copy was ever
going to matter. Whoever eventually resumes `deps-security-bump--postcss` should read this document
first: editing only `pnpm-workspace.yaml`'s copy of an already-live `postcss` bump would have zero
effect on resolution.

## A live consequence — this repo's `esbuild` override is currently inert

`pnpm-workspace.yaml`'s comment for its `overrides` block reads: *"Patched transitive floors...
drizzle-kit carries legacy esbuild-loader branches; both APIs are compatible with these maintained
releases and the full build/DB suite guards the override."* The intent is for
`"esbuild@<0.25.0": 0.25.12` to rewrite any esbuild request below `0.25.0` to the patched `0.25.12`.

At this document's base commit, `@esbuild-kit/core-utils@3.3.2` (a real, present transitive dependency,
flagged by pnpm itself as deprecated) declares `"esbuild": "~0.18.20"` on the npm registry — a range
entirely inside `<0.25.0`, exactly what the override is meant to catch. The resolved `pnpm-lock.yaml`
at base nonetheless records `esbuild@0.18.20`, unrewritten. **This is not a hypothetical — it is
measured against the live, unmodified base state.**

Confirmed directly and reversibly: with `package.json`'s `pnpm.overrides` field temporarily removed
(experiment reverted before commit, no override declaration in this repo changed), a fresh
`pnpm install --lockfile-only` resolves esbuild to `0.25.12`/`0.28.1` only — `esbuild@0.18.20`
disappears entirely, and the lockfile's own header gains an `overrides:` line reflecting
`pnpm-workspace.yaml`'s rule. Restoring `package.json`'s overrides field (unchanged content, esbuild
never mentioned) makes `esbuild@0.18.20` reappear. Toggling one file's presence — not its content, not
any key collision — flips whether a *different, unrelated* key's rule fires. That is the signature of
whole-map replacement, not per-key precedence.

**This document does not fix the live override.** Repairing it means adding an `esbuild` entry to
`package.json`'s own `pnpm.overrides` (or removing `package.json`'s override block entirely and moving
everything to `pnpm-workspace.yaml`) — a real change to `package.json`/`pnpm-workspace.yaml`/
`pnpm-lock.yaml`, explicitly out of this slice's negative scope. It is recorded as its own backlog
entry, `pnpm-workspace-esbuild-override-inert`, so it does not stay a transcript-only observation.

## A critical distinction: resolution outcome vs. `pnpm config get` / CLI introspection

**`pnpm config get overrides --json` does not report what this document measures, and disagrees with
it.** Run at this repo's base commit (`package.json` and `pnpm-workspace.yaml` unmodified):

```
$ pnpm config get overrides --json
{
  "esbuild@<0.25.0": "0.25.12",
  "postcss@<8.5.10": "8.5.16"
}
```

`package.json`'s own overrides (`brace-expansion@1`, `sharp`, `postcss`) are **entirely absent** from
this output. `pnpm config get overrides` only ever surfaces `pnpm-workspace.yaml`'s map in this repo,
regardless of what `package.json` declares — the opposite bias from the one that governs actual
resolution.

**Source-traced explanation (pnpm 10.30.2, `/opt/homebrew/lib/node_modules/pnpm/dist/pnpm.cjs`, this
machine's installed copy of the pinned version).** Two whole-map replacements happen in sequence, in
opposite directions, at two different stages:

1. **General CLI config build** (feeds `pnpm config get` and similar introspection):
   `Object.assign(pnpmConfig, getOptionsFromRootManifest(...))` runs first (root/`package.json`
   settings), then, if a workspace manifest exists, a loop —
   `for (const [key, value] of Object.entries(newSettings)) { pnpmConfig[key] = value }` — assigns
   every key `getOptionsFromPnpmSettings(workspaceDir, workspaceManifest, ...)` returns, including
   `overrides` = `pnpm-workspace.yaml`'s own block verbatim. This **replaces** `pnpmConfig.overrides`
   with the workspace's map. `pnpm config get` reads this object, which is why it only shows
   `pnpm-workspace.yaml`'s side.
2. **Workspace install orchestration** (feeds actual dependency resolution): the recursive-install
   entry point spreads `...opts` (the config object from step 1, workspace-shaped) and then
   `...getOptionsFromRootManifest(opts.rootProjectManifestDir, opts.rootProjectManifest ?? {})`
   **last**, into the options object passed to the real install engine
   (`pnpm.cjs:160900-160902`). Spreading an object with an `overrides` key last replaces it again —
   this time with `package.json`'s own map, wholesale. By the time the resolver runs, `overrides` is
   entirely `package.json`'s map, with no trace of `pnpm-workspace.yaml`'s.

So the two subsystems disagree because they are, quite literally, built by the same whole-map-replace
pattern applied in opposite order, one stage apart. **Do not use `pnpm config get overrides` to audit
which override this repo's dependency resolution is actually honoring — it shows the losing side.**

*(The v1.1 draft of this document additionally claimed `assertWantedLockfileUpToDate`'s
outdated-lockfile check also reads the workspace-replaced view. That claim was an unverified
extrapolation from step 1 above, not something independently confirmed — the destructured variable
name it actually reads, `rootManifestOptions`, suggests a root-only value from a separate call path.
Retracted here rather than left uncorrected; this document makes no claim about that function either
way.)*

## A reproduction trap: `pnpm why` can read stale installed state

The original reproduction recipe used `pnpm why <pkg> -r` after `pnpm install --lockfile-only` to read
the winner. **This is unreliable if `node_modules` already exists from an earlier, unrelated
`pnpm install` in the same worktree.** pnpm's `why` command reads the installed
`node_modules/.pnpm/lock.yaml` graph rather than the freshly written wanted `pnpm-lock.yaml` in that
case.

Confirmed directly: re-running the `picocolors` conflict (`package.json`: `1.0.0`,
`pnpm-workspace.yaml`: `1.0.1`) in a worktree that had previously run a full `pnpm install` (for
`typecheck`/`lint`/`build`, unrelated to the experiment):

| Source                                | Reports          |
| -------------------------------------- | ----------------- |
| `pnpm why picocolors -r` (plain)       | `picocolors@1.1.1` — the **original, pre-experiment, un-overridden** version |
| `grep 'picocolors@' pnpm-lock.yaml`    | `picocolors@1.0.0` — the correct, freshly-resolved winner |

The freshly-written `pnpm-lock.yaml` was correct the entire time; only the convenience command was
misleading. **Treat direct lockfile inspection as the primary and only trusted evidence.** Do not run
plain `pnpm why` as evidence of a fresh `--lockfile-only` result unless `node_modules` is confirmed
absent (or was itself refreshed by a non-lockfile-only install) immediately before — including in any
launcher, backlog recipe, or other instruction that reproduces this experiment; a recipe that still
leads with `pnpm why` reproduces this exact trap for its next reader regardless of what this document
says.

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

# Primary and only trusted evidence — read the wanted lockfile directly:
grep 'picocolors@' pnpm-lock.yaml

# Diagnostic only, NOT evidence of the resolution outcome (see "A critical distinction" above):
pnpm config get overrides --json

# Revert — never leave the experiment in the tree.
git checkout -- package.json pnpm-workspace.yaml pnpm-lock.yaml
```

To directly demonstrate whole-map replacement (not just same-key precedence), also try: remove
`package.json`'s entire `pnpm.overrides` field, re-run `pnpm install --lockfile-only`, and check
whether an existing `pnpm-workspace.yaml`-only override (one `package.json` never mentions) starts
taking effect. Revert afterward the same way.

## Evidence

| Trial | What changed | package.json value | pnpm-workspace.yaml value | Resolved (lockfile) | `pnpm config get` | Result |
| ----- | ------------- | -------------------- | --------------------------- | --------------------- | -------------------- | -------- |
| 1     | `picocolors` set in both | 1.0.0 (lower)  | 1.0.1 (higher)               | 1.0.0                  | not checked           | package.json's map applied |
| 2     | `ms` set in both, magnitude reversed | 2.1.2 (higher) | 2.1.1 (lower)   | 2.1.2                  | not checked           | package.json's map applied |
| 3     | repeat of Trial 1, `config get` also captured | 1.0.0 (lower) | 1.0.1 (higher) | 1.0.0                  | 1.0.1 (disagrees)     | package.json's map applied, `config get` shows the losing side |
| 4     | `package.json`'s entire `pnpm.overrides` removed (esbuild untouched in either file) | absent | `esbuild@<0.25.0 → 0.25.12` unchanged | `esbuild@0.18.20` → gone; only `0.25.12`/`0.28.1` remain | not checked | with `package.json`'s map absent, `pnpm-workspace.yaml`'s **previously-inert** rule starts firing |

Trials 1-3 use a same-key conflict and are consistent with either "package.json wins ties" or
"package.json's map wholesale-replaces the other" — they cannot distinguish the two on their own.
**Trial 4 is the one that distinguishes them**: it touches a key (`esbuild`) `package.json` never
declares, so there is no "tie" to win — yet toggling only whether `package.json` has *any* overrides
field flips whether `pnpm-workspace.yaml`'s unrelated `esbuild` rule is honored. That is only
explainable by whole-map replacement. All trials were fully reverted (`git diff` against this slice's
base commit confirmed `package.json`, `pnpm-workspace.yaml`, and `pnpm-lock.yaml` byte-identical to
base afterward) before this document was written — no override declaration in this repo changed as a
result of this measurement.

## Caveat — a measured fact at one pnpm version, not a permanent law

pnpm has changed where these settings live before and may change resolution order again in a future
release. **Re-measure with the reproduction steps above before relying on this conclusion if
`pnpm --version` no longer reads `10.30.2`.** Do not extrapolate this precedence rule to unrelated
settings (`packageExtensions`, `patchedDependencies`, `onlyBuiltDependencies`, etc.) without measuring
those independently — this document makes a claim about `overrides` specifically, nothing broader.

## Practical guidance until pnpm unifies the two locations

- **Do not split a repo's overrides across both files expecting each package to be governed by
  whichever file declares it.** That is unsafe: as long as `package.json` declares *any* `pnpm.overrides`
  entry, `pnpm-workspace.yaml`'s entire `overrides` block is inert, including keys `package.json` never
  mentions — exactly the live gap this repo has today (see "A live consequence"). There is no partial
  or per-key split that is safe under this mechanism.
- **Consolidate all overrides into exactly one file.** Prefer `package.json`'s `pnpm.overrides`, since
  that is the side this repo's resolution currently honors — moving an entry out of
  `pnpm-workspace.yaml` into `package.json` makes it live; leaving it in `pnpm-workspace.yaml` alongside
  any `package.json` override block leaves it decorative. The alternative — deleting `package.json`'s
  `pnpm.overrides` field entirely and moving everything to `pnpm-workspace.yaml` — is equally safe and
  matches pnpm's documented migration direction, but is a larger, separate change.
- Verify with a direct `grep '<pkg>@' pnpm-lock.yaml` after any override edit, never with
  `pnpm config get overrides` (it shows the losing side; see above) and never with plain `pnpm why`
  unless `node_modules` is known-fresh (see the reproduction-trap section above).
- If this repo's overrides are ever consolidated, `deps-security-bump`'s (`DSB-4`) mirrored `postcss`
  entries and `pnpm-workspace.yaml`'s `esbuild` entry are exactly the entries that need to move —
  tracked in the `pnpm-workspace-esbuild-override-inert` backlog entry, not resolved here.
