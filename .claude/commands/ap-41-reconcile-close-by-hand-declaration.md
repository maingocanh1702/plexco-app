# AP-41 — teach autopilot-backlog-reconcile to recognize `close_by: hand` as an intentional declaration

Add a `close_by: hand · <reason>` classification path to `scripts/autopilot-backlog-reconcile` so the
three task classes that can never carry an identifier-shaped `merged_probe` (dependency-security,
owner-evidence-gate, docs-reconcile) stop being reported as `✗ WEAK-PROBE` — a message that reads as
"fix your probe" when no fix is possible. This is a root slice: nothing waits on it, nothing else in the
repo calls into it.

## Read before you write

1. `docs/autopilot-reconcile-close-by-hand-declaration.md` — the task contract. Its first line must be
   `<!-- review-readiness: code-ready -->` and its verdict block must read `REVIEW_VERDICT: CODE_READY`
   with `CLOSURE_MATRIX: PASS (12/12)`. If either is missing, HALT — you have the wrong file or an
   unauthorized plan.
2. `scripts/autopilot-backlog-reconcile` itself, in full — the DISCRIMINATOR RULE comment block (why a
   shared literal cannot be trusted as a merged probe) and the exact `is_symbol_probe`/parse/report/
   `--check`/`--fix` logic you are extending. Re-verify its `# KIT_VERSION:` header rather than trusting
   any number written in a document.
3. `docs/autopilot-backlog.md` — the `deps-security-bump` task block (search for `close_by: hand`). This
   is the real, already-merged example that motivated this slice, and its exact scope shape
   (`docs/autopilot-manifests/*.json`, `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`) is the
   negative case your abuse guard must NOT flag.

## The step almost everyone will skip: canonical-first

**`scripts/autopilot-backlog-reconcile` is not this repo's file to unilaterally patch.** It is a
canonical-kit file, synced from `$HOME/Projects/Claude template/autopilot/parallel/autopilot-backlog-reconcile`
— verified byte-identical, both at `# KIT_VERSION: 4`, on 2026-07-30. Re-verify with `diff` before you
write a single line; if the two files have already diverged, STOP and report — do not layer a new change
on top of an already-diverged baseline (`STOP_CONDITIONS` in the manifest names this explicitly).

Per the founder's standing invariant — *"Shared KIT fixes land canonical-first and sync consumers
direction-aware. Never hand-fix only a copy or downgrade a newer consumer"* — implement and verify the
change in the **canonical file first**, in its own repository (`$HOME/Projects/Claude template`, a
completely separate git history from this Plexco worktree — it has its own commit process, not this
repo's Level 3 gate), bump its `# KIT_VERSION:` header `4` → `5`, and only then copy the byte-identical
result into `scripts/autopilot-backlog-reconcile` inside this slice's Plexco worktree. That copy is the
actual diff this slice's scope-gate will see. The `autopilot-sync.cjs` SessionStart hook does **not**
manage this file (it only auto-syncs `scripts/autopilot-scope-gate`), so nothing else will catch a
hand-patched, canonical-diverged copy — this paragraph is the only guardrail.

If you cannot get write access to `$HOME/Projects/Claude template` from your sandbox/worktree, HALT and
say so — do not silently fall back to patching only the Plexco copy.

## The three things that are easy to get subtly wrong

**Declaration beats inference — no state-dependent branching.** A `close_by: hand` task must report
`⊘ manual-close: <slug>` regardless of whether its probe currently matches `origin/<default>`, and
regardless of whether that probe happens to be identifier-shaped. Do not special-case "well its probe is
actually fine, so flip it anyway" — that reintroduces exactly the kind of state-dependent thrash this
field exists to remove. `--fix` must never flip a `close_by: hand` task's status, full stop.

**A missing reason must not silently work.** `close_by: hand` with nothing (or nothing meaningful) after
the ` · ` separator must print a distinct `MALFORMED` warning and fall back to the *original*
stale/weak/no-probe/pending classification — as if the field were never written. If you make the bare
field alone suppress `WEAK-PROBE`, you have built a two-character escape hatch around the discriminator
rule, which is precisely the abuse the backlog notes warned about.

**The abuse guard's file-classification must not flag the slice's own motivating example.** "Contains a
file capable of carrying an identifier-shaped probe" means application source under `packages/*/src/`,
`apps/*/src/`, `scripts/*`, or a new `.sql` migration — it explicitly excludes `package.json`,
`pnpm-lock.yaml`, `pnpm-workspace.yaml`, `docs/autopilot-manifests/*.json`, and `*.md`. Test this against
the `deps-security-bump` fixture (scope = manifest + `package.json` + `pnpm-workspace.yaml` +
`pnpm-lock.yaml`) and confirm it does **not** fire — if it does, the guard is over-broad and defeats the
entire slice.

## Registration mechanics

- `register` requires `HEAD === base_sha` exactly. Register before your first commit.
- The runtime manifest is hash-locked at register. `docs/autopilot-manifests/reconcile-close-by-hand-declaration.json`
  is the tracked authored contract and carries **no** `manifest_schema_version`; adding it there makes
  register HALT `CONTRACT_INVALID`.
- `verification` in the authored manifest is written as PROPERTIES, not literals — do not pin a line
  count or a task count from the live backlog anywhere in code or comments.
- Both the slice doc and the authored manifest are IN scope on purpose, so contract amendments can land
  with the change they describe.
- No bash test harness (bats/shunit) exists in this repo today. Add a minimal fixture-based self-check
  (e.g. a `--selftest` mode building a temp backlog file and asserting each marker line, or an adjacent
  script) so every acceptance row (`RCH-1`..`RCH-12` in the slice doc) is re-runnable, not just narrated
  in the PR description.
- `ap-finish.sh` runs from the repository root, not from the worktree it removes.

## Steps

1. Verify repo identity, that `main == origin/main`, and pin `base_sha` from live HEAD. Do not use any
   SHA written in a document as your base.
2. Diff the canonical template file against `scripts/autopilot-backlog-reconcile`. If non-empty, HALT
   and report the divergence instead of proceeding.
3. Create the worktree and branch `feat/reconcile-close-by-hand-declaration`, register the scope gate,
   then create `regions.log` and `fix-round-count.txt`.
4. Outside this worktree (in `$HOME/Projects/Claude template`), implement the `close_by: hand` parsing,
   the `⊘ manual-close` report path, the `MALFORMED` fallback, and the abuse guard. Verify against
   fixtures for every row in the slice doc's acceptance matrix (`RCH-1`..`RCH-10`). Bump that repo's
   `# KIT_VERSION:` header `4` → `5` and commit there per that repo's own process.
5. Back in the Plexco worktree, copy the updated canonical file byte-for-byte into
   `scripts/autopilot-backlog-reconcile`. Confirm `diff` is empty against the canonical source.
6. Update the script's own header usage-comment to document the new field, mirroring the density of the
   existing DISCRIMINATOR RULE / AUTHOR-TIME GUARD paragraphs.
7. Run the declared verification (`RCH-11` migration-absence check, `RCH-12` kit-sync check, plus the
   full canonical suite from the manifest).
8. Run the full gate: `scripts/autopilot-scope-gate ready --manifest .autopilot/state/<feature>/manifest.json`.
   One code-review round; no mandatory security round (see the manifest's `security_review.void_if` —
   re-check it still holds before skipping).
9. Stop at `READY | AWAIT | HALT`. Do not merge. Report the exact merge command inputs, and separately
   report whether the canonical template commit needs to be pushed/shared on its own.

## Negative scope — do not cross these even if it looks trivial

No changes to `scripts/autopilot-scope-gate` or any other kit file. No loosening of the identifier-shaped
DISCRIMINATOR RULE for tasks that do **not** declare `close_by: hand`. No generic `close_by:` enum
beyond the literal value `hand`. No auto-flip of a `close_by: hand` task by `--fix`, ever. No hand-patching
the Plexco copy independently of the canonical template. No retroactive `close_by: hand` backfill onto
the already-merged `deps-security-bump` block (optional documentation polish at most, not required). No
touching `packages/db/src` or any module outside the three scoped files.

If you find a fourth close-by-hand-shaped task class that does not fit the `close_by: hand · <reason>`
shape, HALT and report — that is an owner question about the escape hatch's shape, not an implementation
choice.
