# AP-45 — pnpm-override-precedence-two-locations: measure which override location wins

`package.json`'s `pnpm.overrides` and `pnpm-workspace.yaml`'s `overrides` accept the same syntax and
this repo has genuine entries in both, with `postcss` present in both today. `deps-security-bump`
(AP-39) sidestepped the precedence question by pinning `postcss` to the same exact version in both
locations rather than measuring which wins — safe only while the two stay in agreement. This slice
measures the precedence directly and records it in `docs/standards/dependency-override-precedence.md`.

## Read before you write

1. `docs/autopilot-backlog.md` task block `pnpm-override-precedence-two-locations` — the measurement
   recipe and why the task exists (DSB-4).
2. `docs/autopilot-backlog.md` task block `deps-security-bump` — `owner_decision` and
   `design_probe_required` notes; also the source of the `depends_on: []` reasoning below.
3. `docs/autopilot-manifests/pnpm-override-precedence-two-locations.json` — scope, negative scope,
   verification. Read the whole file; it is short by design.
4. `docs/autopilot-pnpm-override-precedence-two-locations.md` — full task contract, measurement table,
   and the registration-mechanics note (two things went wrong live; both are recorded there so a future
   run of this pattern does not repeat them).
5. `package.json`, `pnpm-workspace.yaml` — confirm the current override entries in both files before
   picking an experiment package; do not reuse a package already overridden anywhere in this repo.

## Registration mechanics — read this before running anything

**Measure the live kit version from `scripts/autopilot-scope-gate`'s own `# KIT_VERSION:` header before
assuming any behavior.** At the version this launcher was authored against (KIT_VERSION 28), `register`
HALTs `CONTRACT_INVALID` unless `--manifest` points at the RUNTIME manifest
(`.autopilot/state/<feature>/manifest.json`, carrying `manifest_schema_version: level3-operational-v2`)
— the authored contract under `docs/autopilot-manifests/` must never carry that field.

**Two live defects hit this exact registration, both worth checking for on any future task, not just
this one:**

- `requireString()` in `autopilot-review-readiness.mjs` rejects any manifest string field containing a
  literal `<` or `>` as a placeholder — including an innocent `->` arrow used as shorthand for "to" in
  prose (`context_sources`, `_note`, etc.). Spell out "to"; do not use `->` or `<-` anywhere in a
  manifest string.
- Every `verification.focused` entry that uses `grep -qF`/`grep -qE` with a pattern that itself starts
  with a literal `-` (for example, matching a markdown bullet line like `- Measured: ...`) fails under
  this machine's `/usr/bin/grep`, which parses a leading `-` in the pattern argument as an option flag
  regardless of content. Add `-e` immediately before every grep pattern, unconditionally — it costs
  nothing when the pattern doesn't start with `-` and prevents this class of failure when it does.
  **Test every `verification.focused` command by hand against `/usr/bin/grep`/`/usr/bin/git` directly
  (not an interactive shell's `grep` wrapper, which may silently paper over this) before calling
  `register`** — the manifest is hash-locked immediately after, and `register` refuses a second
  registration for an already-active feature (`FEATURE_ALREADY_ACTIVE`), so a broken command discovered
  post-registration costs a full `ap-finish.sh --authorized-close` + re-register cycle, not an edit.

```
scripts/autopilot-scope-gate register --manifest .autopilot/state/pnpm-override-precedence-two-locations/manifest.json
```

After it returns `registered: ... (in-flight)`, CONFIRM the hash-lock actually landed before doing
anything else:

```
test -f .autopilot/state/pnpm-override-precedence-two-locations/registered-manifest.sha256 && echo LOCKED || echo NOT_LOCKED
```

## Steps

1. `git fetch origin main` and confirm `main == origin/main` before pinning `base_sha`.
2. Create worktree `.autopilot/worktrees/pnpm-override-precedence-two-locations` on branch
   `feat/pnpm-override-precedence-two-locations` from that exact `base_sha`. Do not add, merge or
   cherry-pick any commit on top yet.
3. Author ONLY the runtime manifest, test every `verification.focused` command by hand against the
   real system `grep`/`git` (see Registration mechanics above), then register while `HEAD` still equals
   `base_sha`. Confirm `registered-manifest.sha256` exists before proceeding.
4. Run the discriminating experiment inside the worktree: pick a harmless, non-money-path package
   already present in the dependency graph and not already overridden anywhere in this repo. Set a
   bare-name selector to one value in `package.json`'s `pnpm.overrides` and a *different* value for the
   same bare-name selector in `pnpm-workspace.yaml`'s `overrides`. Run `pnpm install --lockfile-only`,
   then `pnpm why <pkg> -r` to read the resolved version — that reveals the winner. Run a second trial
   with a different package and the value magnitudes swapped (lower value in whichever file won the
   first trial's higher value, and vice versa) to rule out "lower/higher value always wins" as a
   confound rather than file location. Revert both trials via
   `git checkout -- package.json pnpm-workspace.yaml pnpm-lock.yaml` before any commit; confirm
   `git diff --stat <base_sha> -- package.json pnpm-workspace.yaml pnpm-lock.yaml` is empty afterward.
5. Check `docs/standards/` for an existing home for the result before creating a new file — grep every
   candidate file for `pnpm`/`override` mentions rather than assuming from the filename alone.
6. Author `docs/standards/dependency-override-precedence.md` (or the existing file chosen in step 5)
   recording: the winning location, the pnpm version measured, the measurement date, both trials'
   evidence, copy-paste-runnable reproduction steps, and an explicit caveat that the result is scoped to
   the measured pnpm version, not a permanent law.
7. Author the tracked contract (`docs/autopilot-manifests/pnpm-override-precedence-two-locations.json`)
   and this launcher.
8. Update `docs/autopilot-backlog.md`'s task block: `status`, `risk`, `manifest`, `scope`,
   `depends_on` note — these describe live state, not a fixed precondition; check the backlog file
   directly rather than trusting a description of it written in an earlier run.
9. Self-verify: run every `verification.focused` and `verification.canonical` command from the runtime
   manifest by hand as a pre-check.
10. Commit the five scoped files in one commit. `HEAD` now legitimately moves ahead of `base_sha` — safe
    here because registration already happened in step 3, while `HEAD` still equaled `base_sha`.
11. Author `.autopilot/state/pnpm-override-precedence-two-locations/readiness.json` (see
    `docs/autopilot-manifests/_READINESS_EVIDENCE_TEMPLATE.json`) BEFORE calling `ready`.
12. `scripts/autopilot-scope-gate ready --manifest .autopilot/state/pnpm-override-precedence-two-locations/manifest.json`
    — runs the counted verification + review round(s) via `autopilot-review-readiness.mjs` and
    `scripts/codex-review-pin.sh`. `security_review.required` is `false` in this manifest (docs-only,
    no `packages/`/`apps/` surface) — do not hand-invoke `codex-review-pin.sh` as a separate step first
    and count it; a manual pre-gate round is diagnostic only.
13. Stop at `READY | AWAIT | HALT`. Do not merge.

## Negative scope

No change to any real override declaration's effective behavior. No resolving a live override conflict
(none exists today — `postcss` is the only key in both locations and both values currently agree). No
edit to `pnpm-lock.yaml`. No code change of any kind — this slice is docs-only.
