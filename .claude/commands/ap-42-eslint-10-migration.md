# AP-42 — eslint-10-migration: upgrade before the ESLint v9 EOL clock runs out

Upgrade eslint from `^9.18.0` to `^10` across the whole pnpm workspace, prove the linted-file set did
not move, close the `minimatch@3.x -> brace-expansion@1.x` branch, and tighten `engines.node`. Driven
by ESLint v9 END-OF-LIFE on 2026-08-06 — a hard external date, six days out as of this writing.

## Read before you write

1. `docs/autopilot-eslint-10-migration.md` — the task contract. Its first line must be
   `<!-- review-readiness: code-ready -->` and its verdict block must read `REVIEW_VERDICT: CODE_READY`
   with `CLOSURE_MATRIX: PASS (12/12)`. If either is missing, HALT — you have the wrong file or an
   unauthorized plan.
2. `docs/autopilot-manifests/eslint-10-migration.json` — read the WHOLE file, not just `_acceptance`.
   `verification.focused` are the four commands the readiness gate actually spawns via
   `/bin/bash -lc`; they were tested against this exact repo state on 2026-07-31 and pass/fail
   correctly in both directions. Do not rewrite them casually — if one needs to change, re-test it
   the same way (`node -e` spawning it with `child_process.spawnSync` exactly as
   `autopilot-review-readiness.mjs` does) before trusting it.
3. `package.json`, `pnpm-lock.yaml`, `eslint.config.mjs` — the live state you are changing.

## The one thing that will make this look done when it is not

ESLint 10 locates `eslint.config.*` starting from **each linted file's own directory**, not from
`cwd`. This repo is a pnpm workspace (`apps/*`, `packages/*`). A silently NARROWER linted-file set
would make `pnpm lint` pass while checking less — a green gate that stopped gating. This is why
acceptance E10-2 compares a **sorted file list**, not an exit code, and why it is a HALT condition,
not a report-and-continue.

## Registration mechanics — read once, apply for both slices this session might touch

- `register` requires `HEAD === base_sha` exactly. Register before your first commit.
- The runtime manifest is hash-locked at `register`. `docs/autopilot-manifests/eslint-10-migration.json`
  is the tracked authored contract and carries **no** `manifest_schema_version`; adding it there makes
  `register` HALT `CONTRACT_INVALID`. Generate the runtime manifest into
  `.autopilot/state/eslint-10-migration/manifest.json` from `docs/autopilot-manifests/_TEMPLATE.json`.
- `verification.focused[0]` diffs the post-upgrade linted-file list against
  `.autopilot/state/eslint-10-migration/design-probe-file-list.txt`. That file does not exist until
  YOU write it during the design probe (step 3 below) — running the gate before that step exists
  fails closed with a non-zero exit, which is correct, not a bug.
- This slice shares the `build-config` invariant with `deps-security-bump` and any other slice
  touching `package.json`/`pnpm-lock.yaml`. If either is active in `.autopilot/INFLIGHT.md`, `register`
  will `HALT SCOPE_COLLISION` — that is correct; run them sequentially.
- `ap-finish.sh` runs from the repository root, not from the worktree it removes.

## Steps

1. Verify repo identity, that `main == origin/main`, and pin `base_sha` from live HEAD. Do not use any
   SHA written in a document as your base.
2. Create the worktree and branch `feat/eslint-10-migration`, register the scope gate, then create
   `regions.log` and `fix-round-count.txt`.
3. **Before any edit**, write `.autopilot/state/eslint-10-migration/design-probe.md` covering the four
   items in the manifest's `_design_probe`, and its companion machine-readable file
   `.autopilot/state/eslint-10-migration/design-probe-file-list.txt`:
   ```
   npx eslint . -f json | node -e 'const fs=require("fs");const d=JSON.parse(fs.readFileSync(0,"utf8"));for(const f of d.map(x=>x.filePath.replace(process.cwd()+"/","")).sort())console.log(f)' > .autopilot/state/eslint-10-migration/design-probe-file-list.txt
   ```
   Then **STOP for founder confirmation** before touching `package.json`. This is a mandatory design
   probe (canonical GENERIC §0.1 trigger: major toolchain upgrade with real compatibility unknowns),
   not procedure for its own sake — re-measure all three compat questions, the exact eligible eslint
   10.x version against `minimumReleaseAge`, and confirm the config-lookup-algorithm risk above.
4. Pick the newest eslint 10.x version whose `npm view eslint time --json` publish timestamp is at
   least 10080 minutes (7 days) before the moment you run this — not before the calendar date. Verify
   the exact hour; a version can look "eligible today" by date and still be hours short. `10.7.0`
   (published 2026-07-10) is unconditionally eligible regardless of what time you run this and is the
   safe fallback if the newest 10.x is not yet old enough.
5. Bump `eslint` (and `@eslint/js` in lockstep) to the chosen version, regenerate the lockfile, adjust
   `engines.node` to a range that excludes 22.0.0-22.12.x, and touch `eslint.config.mjs` only for what
   v10 strictly requires.
6. Run the declared verification — all four `verification.focused` commands, then the full canonical
   list. If `pnpm lint` reports a NEW error that the pre-upgrade tree did not have, HALT and report it;
   do not fix or silence it.
7. Run the full gate: `scripts/autopilot-scope-gate ready --manifest .autopilot/state/eslint-10-migration/manifest.json`.
   2 consecutive clean code-review rounds; no security round required (see manifest `security_review`).
8. Stop at `READY | AWAIT | HALT`. Do not merge. In your READY report, name the residual
   `brace-expansion@5.0.7` finding (via `typescript-eslint`'s own `minimatch@10.2.5`) explicitly and
   point at backlog task `eslint10-brace-expansion-5-0-7-typescript-estree` — it is a known, correctly
   out-of-scope gap, not a regression, but it must not silently disappear from the report. Report the
   exact merge command inputs.

## Negative scope — do not cross these even if it looks trivial

No rule configuration change of any kind, including anything `eslint:recommended` v10 newly adds — a
new error there is a HALT, not a fix-it-while-you're-here. No `typescript-eslint` upgrade (8.62.1
already peer-supports `^10.0.0`). No `next`/`postcss` bump (that is `deps-security-bump`). No removal
or weakening of the `scripts/**/*.{mjs,js}` Node-globals block in `eslint.config.mjs`. No lowering
`minimumReleaseAge`/`trustPolicy`/`blockExoticSubdeps`, no `--no-verify`/`--ignore-scripts`/
`--no-frozen-lockfile`. No attempt to close `brace-expansion@5.0.7` — it is a separate, unrelated
dependency chain; touching it here smuggles an unmeasured change into a slice that does not need it.

If the linted-file set changes at all, or `typescript-eslint`/`@next/eslint-plugin-next` turn out to
need an upgrade after all when you re-measure, HALT and report — that would mean this slice's scope was
wrong, which is an owner question, not an implementation choice.
