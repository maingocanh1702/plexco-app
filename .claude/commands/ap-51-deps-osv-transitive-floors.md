# AP-51 — deps-osv-transitive-floors: raise nanoid / brace-expansion / postcss past their OSV advisories

Six OSV advisories (5 High up to CVSS 8.2, 1 Medium) across three transitive npm packages, all reached
via `pnpm-lock.yaml`. `Security / OSV full dependency scan` has been red on `main` since these advisories
published upstream. Nothing in this repo regressed — no dependency changed.

## Before you touch anything — two measurements decide the shape of this slice

**1. Release age.** `pnpm-workspace.yaml` sets `minimumReleaseAge: 10080` (7 days). Owner decision
2026-07-26: that control is NOT to be lowered, bypassed, or per-invoke overridden. Measure the publish
date of each target:

```
nanoid@3.3.17      brace-expansion@5.0.9      postcss@8.5.23
```

Any target younger than 7 days → **split that package out** of the slice, report
`AWAIT RELEASE_AGE_WINDOW` with the measured dates, and proceed with the remainder. This has already
happened once in this exact lineage: `postcss` was split out of `deps-security-bump` on 2026-07-30 for
precisely this reason. Splitting is the sanctioned outcome, not a failure.

**2. Is the brace-expansion v1 branch really gone?**

```bash
grep -c 'brace-expansion@1\.' pnpm-lock.yaml    # expect 0
```

Measured 0 at `9d7d6ac` on 2026-08-10 — the eslint 9→10 migration (`a93a4f6`) removed it. If it has
returned, the 2026-07-29 runtime-break trap is live again (v1 is `module.exports = expandTop`, a
function; v5 is `exports.expand`, an object; `minimatch@3.1.5` calls it as a function, so `pnpm install`
resolves cleanly and lint dies at call time) — split `brace-expansion` out.

## The mistake this slice exists to avoid

**Edit `package.json`. Do NOT edit `pnpm-workspace.yaml`.**

Measured 2026-08-03 on pnpm 10.30.2 (`docs/standards/dependency-override-precedence.md`): a non-empty
`pnpm.overrides` in `package.json` **replaces** `pnpm-workspace.yaml`'s `overrides` map entirely — whole
map, not a per-key merge. This repo's map is non-empty, so the workspace file's
`"postcss@<8.5.10": 8.5.16` is already inert. A floor added there resolves nothing while looking correct
in the diff. That is the exact defect `62304b5` had to fix for esbuild.

`pnpm-workspace.yaml` is in `negative_scope` and must come out byte-unchanged.

## Read before you write

1. `docs/autopilot/contracts/autopilot-deps-osv-transitive-floors.md` — the task contract. §2 (override
   location), §3 (release-age gate), §4 (brace-expansion trap), §5 (dead ignore), §6 (why verification is
   written as properties, not literals), §7 (execution order).
2. `docs/autopilot-manifests/deps-osv-transitive-floors.json` — read `negative_scope` in full and
   `_target_floors` for the exact advisory-to-version mapping.
3. `docs/standards/dependency-override-precedence.md` — the measured precedence rule.
4. `docs/autopilot-backlog.md` task `deps-security-bump` — the same class of slice, three registrations,
   and the owner decisions this contract inherits.

## Register and run

```
scripts/autopilot-scope-gate register \
  --manifest .autopilot/state/deps-osv-transitive-floors/manifest.json
```

Hand-write that runtime manifest from the authored contract first; it carries
`manifest_schema_version: level3-operational-v2`, which the authored contract must NEVER carry
(`scope-gate:548` HALTs `CONTRACT_INVALID`). After registering, confirm
`.autopilot/state/deps-osv-transitive-floors/registered-manifest.sha256` EXISTS before doing anything
else — the word "registered" alone is not proof.

Write every verification check as a PROPERTY of the resolved tree, never as a literal version.
Registration #2 of `deps-security-bump` had to be disposed because its runtime manifest hard-coded
`postcss==8.5.18`; the manifest is hash-locked after register, so when the target moved there was no
legal edit available.

## Known unrelated red

CI `verify` is failing on `main` at the **Test** step, traced to `286f48b` (2026-08-04), unrelated to
dependencies. Do not attempt to fix it inside this slice — it is out of scope. If the owner has not
recorded a decision permitting this slice to land against a known-red Test step, report `AWAIT`.

Terminate at READY | AWAIT | HALT. Do not merge.
