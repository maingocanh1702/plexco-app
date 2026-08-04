# AP-48 — pnpm-workspace-esbuild-override-inert: relocate the esbuild floor to where it applies

`pnpm-workspace.yaml` declares `"esbuild@<0.25.0": 0.25.12`, intended to patch a real, deprecated
transitive dependency (`@esbuild-kit/core-utils@3.3.2`, pulled in by `drizzle-kit`) up to a release that
closes `GHSA-67mh-4wv8-2f99`. Since commit `f1af6e3` (2026-07-22), `package.json`'s own non-empty
`pnpm.overrides` has silently replaced that entire rule for actual dependency resolution — see
`docs/standards/dependency-override-precedence.md` for the measured mechanism. This launcher adds the
same conditional selector to `package.json` (where it will actually apply) and deletes the now-dead
mirror from `pnpm-workspace.yaml`.

## Read before you write

1. `docs/autopilot-backlog.md` task block `pnpm-workspace-esbuild-override-inert` (line 1312) — why this
   task exists and the exact remediation it specifies.
2. `docs/standards/dependency-override-precedence.md` — the measured mechanism (whole-map replacement)
   and "A live consequence" section this slice closes.
3. `docs/autopilot-manifests/pnpm-workspace-esbuild-override-inert.json` — scope, negative scope,
   verification. Read the whole file; it is short by design.
4. `docs/autopilot-pnpm-workspace-esbuild-override-inert.md` — full task contract, live-repo verification
   evidence (§3), exact diff description (§5), and the canonical verdict (§9).
5. `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml` — confirm current state matches §3's evidence
   before editing; if it has drifted (another slice touched these files since 2026-08-04), stop and
   re-verify rather than trusting this doc's snapshot.

## Registration mechanics — read this before running anything

**Measure the live kit version from `scripts/autopilot-scope-gate`'s own `# KIT_VERSION:` header before
assuming any behavior.** `register` HALTs `CONTRACT_INVALID` unless `--manifest` points at the RUNTIME
manifest (`.autopilot/state/<feature>/manifest.json`, carrying `manifest_schema_version:
level3-operational-v2`) — the authored contract under `docs/autopilot-manifests/` must never carry that
field.

**Hand-execute every `verification.focused` command against the real system `awk`/`grep` before calling
`register`.** This exact lesson already cost `pnpm-override-precedence-two-locations` a full
close-and-re-register cycle: BSD `grep` rejects a pattern starting with a literal `-` unless `-e` is
added first, and the manifest is hash-locked immediately after `register` with no in-place fix. This
launcher's own manifest was authored without live shell execution of its `verification.focused` commands
— the authoring session's auto-mode classifier blocked both a reversible mutation experiment and a
subsequent read-only dry-run (see the slice doc §3 preamble and §7). Treat every command as unverified
until you have run it yourself against this machine's real `awk` and `grep`, not assumed correct because
it reads correctly.

```
scripts/autopilot-scope-gate register --manifest .autopilot/state/pnpm-workspace-esbuild-override-inert/manifest.json
```

After it returns `registered: ... (in-flight)`, CONFIRM the hash-lock actually landed before doing
anything else:

```
test -f .autopilot/state/pnpm-workspace-esbuild-override-inert/registered-manifest.sha256 && echo LOCKED || echo NOT_LOCKED
```

## Steps

1. `git fetch origin main` and confirm `main == origin/main` before pinning `base_sha`. If it has moved
   past `ddc1278790a9ef127668f18069a20ffa55ad1d25`, re-verify the slice doc's §3 evidence against the new
   tip before proceeding — do not assume it still holds.
2. Create worktree `.autopilot/worktrees/pnpm-workspace-esbuild-override-inert` on branch
   `feat/pnpm-workspace-esbuild-override-inert` from that exact `base_sha`.
3. Author ONLY the runtime manifest from the authored contract + `_TEMPLATE.json`, hand-test every
   `verification.focused` command against real `awk`/`grep` (see Registration mechanics above), then
   register while `HEAD` still equals `base_sha`. Confirm `registered-manifest.sha256` exists before
   proceeding.
4. Measure the exact replacement version inside the worktree, live, at this run's own time: confirm a
   version `>=0.25.0` exists whose registry publish date clears `minimumReleaseAge` (10080 minutes).
   `0.25.12` cleared this by a wide margin as of 2026-08-04 (slice doc §3 row 8) — re-check
   `npm view esbuild time` (or equivalent) rather than reusing that number unverified if meaningful time
   has passed. If the only qualifying version is younger than `minimumReleaseAge`, or lifting the floor
   forces an unrelated major bump elsewhere, STOP — that is a human decision, not a bump; report it
   rather than waiving policy or guessing.
5. Edit `package.json`: add `"esbuild@<0.25.0": "<measured value>"` to the existing `pnpm.overrides`
   object (slice doc §5.1). Do not touch `brace-expansion@1`, `sharp`, or `postcss`. Do not use a bare
   `"esbuild"` key — a real, legitimate consumer (`tsx@4.23.0`) resolves `esbuild@0.28.1` directly and a
   bare override would downgrade it.
6. Edit `pnpm-workspace.yaml`: delete the `"esbuild@<0.25.0": 0.25.12` line from the `overrides` block
   only (slice doc §5.2). Leave `postcss@<8.5.10`, `minimumReleaseAge`, `trustPolicy`, and
   `blockExoticSubdeps` byte-identical to base. Delete by key — do not use a line-range or block delete
   that could catch the policy lines a few lines above.
7. Run `pnpm install --lockfile-only` (or a full `pnpm install` if you also need a fresh `node_modules`
   for canonical verification) to regenerate `pnpm-lock.yaml`. Never hand-edit it.
8. Verify directly against the freshly-written lockfile — `grep 'esbuild@' pnpm-lock.yaml` — not via
   `pnpm config get overrides` (documented divergence, standards doc "A critical distinction") and not
   via plain `pnpm why esbuild -r` if `node_modules` predates this edit (documented staleness trap,
   standards doc "A reproduction trap"). Confirm no `esbuild@` version below `0.25.0` remains and
   `tsx@4.23.0`'s own `esbuild@0.28.1` resolution is unchanged.
9. Self-verify: run every `verification.focused` and `verification.canonical` command from the runtime
   manifest by hand, including the full canonical suite (`pnpm typecheck && pnpm lint && pnpm
   format:check && pnpm review:check:changed && pnpm build && DATABASE_URL_TEST=... pnpm test`).
10. Commit the three real files (`package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`) plus this
    slice's own three contract files in one commit. Do NOT touch `docs/autopilot-backlog.md` in this
    commit — out of scope (slice doc §10 item 2); update it separately, out of band, after this slice
    reaches a terminal state, to avoid the cross-lane collisions two parallel registrations already hit
    on that shared file this week.
11. Author `.autopilot/state/pnpm-workspace-esbuild-override-inert/readiness.json` (see
    `docs/autopilot-manifests/_READINESS_EVIDENCE_TEMPLATE.json`) BEFORE calling `ready`.
12. `scripts/autopilot-scope-gate ready --manifest .autopilot/state/pnpm-workspace-esbuild-override-inert/manifest.json`
    — runs the counted verification + review round(s) via `autopilot-review-readiness.mjs` and
    `scripts/codex-review-pin.sh`. `security_review.required` is `true` in this manifest — the gate must
    run it; do not hand-invoke `codex-review-pin.sh` separately first and count it as satisfying this.
13. Stop at `READY | AWAIT | HALT`. Do not merge.

## Negative scope

No change to `postcss`, `brace-expansion@1`, or `sharp` in either file. No re-measurement of override
precedence. No upgrade of `drizzle-kit` or `@esbuild-kit/*`. No bare/unconditional `esbuild` override key.
No hand-edited `pnpm-lock.yaml`. No edit to `docs/autopilot-backlog.md`. No waiving `minimumReleaseAge`,
`trustPolicy`, or `blockExoticSubdeps`.
