# AP-41 — teach autopilot-backlog-reconcile to recognize `close_by: hand` as an intentional declaration

Add a `close_by: hand · <reason>` classification path to `scripts/autopilot-backlog-reconcile` so the
three task classes that can never carry an identifier-shaped `merged_probe` (dependency-security,
owner-evidence-gate, docs-reconcile) stop being reported as `✗ WEAK-PROBE` — a message that reads as
"fix your probe" when no fix is possible. This is a root slice: nothing waits on it, nothing else in the
repo calls into it.

**This slice is split along a repo boundary.** The actual `close_by: hand` logic is implemented and
committed in the canonical template repo as out-of-band kit maintenance — not part of this Plexco slice
at all. This Plexco slice starts only after that has landed; it pulls the result down and writes tests.
Read the "Repo split" section below before step 1.

## Read before you write

1. `docs/autopilot-reconcile-close-by-hand-declaration.md` — the task contract. Its first line must be
   `<!-- review-readiness: code-ready -->` and its verdict block must read `REVIEW_VERDICT: CODE_READY`
   with `CLOSURE_MATRIX: PASS (12/12)`. If either is missing, HALT — you have the wrong file or an
   unauthorized plan.
2. `scripts/autopilot-backlog-reconcile` itself, in full — the DISCRIMINATOR RULE comment block (why a
   shared literal cannot be trusted as a merged probe) and the exact `is_symbol_probe`/parse/report/
   `--check`/`--fix` logic the canonical template will have extended. Re-verify its `# KIT_VERSION:`
   header rather than trusting any number written in a document.
3. `docs/autopilot-backlog.md` — the `deps-security-bump` task block (search for `close_by: hand`). This
   is the real, already-merged example that motivated this slice, and its exact scope shape
   (`docs/autopilot-manifests/*.json`, `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`) is the
   negative case your abuse guard tests must confirm is NOT flagged.

## Repo split — read this before step 1

**The template half is out-of-band kit maintenance. It is not this slice, has no manifest, no verdict,
no gate, and you do not do it from inside this worktree.** This mirrors how `scripts/autopilot-scope-gate`
itself went from kit v14 to v17 in this very repo (`48db365`, `chore(autopilot): sync kit v14 -> v17` —
a single `chore:` commit, zero Plexco manifest/verdict/launcher for that bump). Whoever owns the
template repo edits `autopilot/parallel/autopilot-backlog-reconcile` in `$HOME/Projects/Claude template`,
bumps its `# KIT_VERSION:` header `4` → `5`, writes the rationale into the header comment at the same
density as the file's existing `⚠️ DISCRIMINATOR RULE (KIT_VERSION 3 — added after the ap-93
false-flip, 2026-07-24): ...` paragraph (a new dated paragraph naming the `deps-security-bump` /
`WEAK-PROBE` pain point this fixes), and commits + pushes there under that repo's own process.

**Verify this has already happened before opening the Plexco worktree.** Check
`$HOME/Projects/Claude template/autopilot/parallel/autopilot-backlog-reconcile` for
`# KIT_VERSION: 5`. If it still reads `4`, the template half has not landed —
**`AWAIT`, do not proceed and do not hand-author the v5 logic yourself inside Plexco.** This is a
missing external prerequisite with a binary resume condition (template reads `5`), not a defect in this
slice, and not something this session can close on its own.

**The Plexco half is the real slice, and it never writes outside the Plexco repo:**
1. `bash "$HOME/Projects/Claude template/autopilot/parallel/autopilot-update.sh"` to pull v5 down. Its
   `pack_pairs()` already lists `autopilot-backlog-reconcile:scripts/autopilot-backlog-reconcile:100755`,
   and it fail-closes (refuses) if the installed copy is ever newer than canonical — it will not
   downgrade you.
2. Author `scripts/autopilot-backlog-reconcile.test.sh` — a **new, separate file**. Do not edit the
   just-synced script's own content; that would recreate the exact hand-patch problem this split avoids.
   The test invokes the synced script as a subprocess against fixture backlog files and asserts on
   stdout/exit code.

The synced logic still lands inside this slice's own diff (the file's bytes change in this worktree,
even though they were written elsewhere), so `scripts/codex-review-pin.sh` still reviews all of it —
just downstream instead of upstream. Nothing skips review; only where it happens changes.

## The four things that are easy to get subtly wrong

**Declaration beats inference — no state-dependent branching.** A `close_by: hand` task must report
`⊘ manual-close: <slug>` regardless of whether its probe currently matches `origin/<default>`, and
regardless of whether that probe happens to be identifier-shaped. Do not special-case "well its probe is
actually fine, so flip it anyway" — that reintroduces exactly the kind of state-dependent thrash this
field exists to remove. `--fix` must never flip a `close_by: hand` task's status, full stop.

**A missing reason must not silently work, and must use the WEAK-PROBE severity glyph.** `close_by: hand`
with nothing (or nothing meaningful) after the ` · ` separator prints exactly:

```
✗ MALFORMED close_by: <slug> — declared but reason is missing or empty.
    Treated as UNDECLARED; the strict probe rules still apply, nothing was exempted.
    Fix: `close_by: hand · <one-line reason>` — the reason is the whole point of the field.
```

using `✗` — the same glyph as `WEAK-PROBE`, because this genuinely is an authoring error, not a
legitimate state — then falls back to the *original* stale/weak/no-probe/pending classification, as if
the field were never written. The full vocabulary after this change: `✓` genuinely pending · `?` no
probe · `✗` authoring error (WEAK-PROBE and MALFORMED close_by share this glyph and severity) · `⊘`
manual-close for a valid `close_by: hand` · `NOTE:` for summary lines (unchanged mechanism). **Test the
no-exemption guarantee directly, not just the message text:** construct a fixture where the MALFORMED
task's underlying probe is genuinely stale, and assert it still lands in `stale[]` and still affects
`--check`'s exit code exactly as it would without the `close_by` line. A field that loosens the rules
when broken is itself a back door — this is `RCH-4b`, the acceptance row that matters most.

**The abuse guard's file-classification must not flag the slice's own motivating example.** "Contains a
file capable of carrying an identifier-shaped probe" means application source under `packages/*/src/`,
`apps/*/src/`, `scripts/*`, or a new `.sql` migration — it explicitly excludes `package.json`,
`pnpm-lock.yaml`, `pnpm-workspace.yaml`, `docs/autopilot-manifests/*.json`, and `*.md`. Test this against
the `deps-security-bump` fixture (scope = manifest + `package.json` + `pnpm-workspace.yaml` +
`pnpm-lock.yaml`) and confirm it does **not** fire — if it does, the guard is over-broad and defeats the
entire slice.

**Do not let this split's precedent spread past this one script.** Read the slice doc's "Ranh giới"
section and carry it into the PR description if anyone asks why the logic isn't tested where it was
written: this repo-split (implement untested in the template, test after syncing) is licensed *only*
because this is a P3 script with no trust-boundary, production-code, schema, auth or money surface. If
you are ever asked to apply the same pattern to `scripts/autopilot-scope-gate`,
`scripts/autopilot-review-readiness.mjs`, or `scripts/codex-review-pin.sh`, the answer is no — those are
trust-boundary gate files and need tests co-located with the implementation, in the template, before any
sync.

## Registration mechanics

- `register` requires `HEAD === base_sha` exactly. Register before your first commit.
- The runtime manifest is hash-locked at register. `docs/autopilot-manifests/reconcile-close-by-hand-declaration.json`
  is the tracked authored contract and carries **no** `manifest_schema_version`; adding it there makes
  register HALT `CONTRACT_INVALID`.
- `verification` in the authored manifest is written as PROPERTIES, not literals — do not pin a line
  count or a task count from the live backlog anywhere in code or comments.
- Both the slice doc and the authored manifest are IN scope on purpose, so contract amendments can land
  with the change they describe.
- `scripts/autopilot-backlog-reconcile.test.sh` is this repo's first bash test harness (no bats/shunit
  exists here today) — keep it minimal: build a temp backlog file per fixture, run the synced script,
  assert the exact marker line and exit code. Do not reach for a general-purpose framework for one script.
- `ap-finish.sh` runs from the repository root, not from the worktree it removes.

## Steps

1. Verify the template half has already landed: `$HOME/Projects/Claude template/autopilot/parallel/autopilot-backlog-reconcile`
   reads `# KIT_VERSION: 5`. If not, `AWAIT` — stop here.
2. Verify repo identity, that `main == origin/main`, and pin `base_sha` from live HEAD. Do not use any
   SHA written in a document as your base.
3. Create the worktree and branch `feat/reconcile-close-by-hand-declaration`, register the scope gate,
   then create `regions.log` and `fix-round-count.txt`.
4. Run `bash "$HOME/Projects/Claude template/autopilot/parallel/autopilot-update.sh"`. Confirm
   `scripts/autopilot-backlog-reconcile` now reads `# KIT_VERSION: 5` and is byte-identical to the
   canonical file (`RCH-12`).
5. Author `scripts/autopilot-backlog-reconcile.test.sh` covering every row in the slice doc's acceptance
   matrix (`RCH-1`..`RCH-13`) — start with the happy paths (`RCH-1`..`RCH-3`), then `RCH-4`/`RCH-4b`
   (malformed + the no-exemption guarantee), then the abuse guard (`RCH-6`/`RCH-7`), then regression
   (`RCH-10`) and test isolation (`RCH-13`: the test file must not itself edit
   `scripts/autopilot-backlog-reconcile`).
6. Run the declared verification (`RCH-11` migration-absence check, plus the full canonical suite from
   the manifest, plus `bash scripts/autopilot-backlog-reconcile.test.sh`).
7. Run the full gate: `scripts/autopilot-scope-gate ready --manifest .autopilot/state/<feature>/manifest.json`.
   One code-review round; no mandatory security round (see the manifest's `security_review.void_if` —
   re-check it still holds before skipping).
8. Stop at `READY | AWAIT | HALT`. Do not merge. Report the exact merge command inputs.

## Negative scope — do not cross these even if it looks trivial

No changes to `scripts/autopilot-scope-gate` or any other kit file. No loosening of the identifier-shaped
DISCRIMINATOR RULE for tasks that do **not** declare `close_by: hand`. No generic `close_by:` enum
beyond the literal value `hand`. No auto-flip of a `close_by: hand` task by `--fix`, ever. No editing
`scripts/autopilot-backlog-reconcile`'s logic directly in this worktree — the only sanctioned path is
`autopilot-update.sh` pulling down a file already changed in the template repo. No retroactive
`close_by: hand` backfill onto the already-merged `deps-security-bump` block (optional documentation
polish at most, not required). No touching `packages/db/src` or any module outside the four scoped
files. No reusing the logic-in-template/tests-in-consumer split for `scope-gate`,
`review-readiness`, or `codex-review-pin` — see above.

If you find a fourth close-by-hand-shaped task class that does not fit the `close_by: hand · <reason>`
shape, HALT and report — that is an owner question about the escape hatch's shape, not an implementation
choice.
