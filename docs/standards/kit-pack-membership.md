<!-- GENERATED FROM docs/standards/kit-pack-membership.json — DO NOT EDIT BY HAND. Run `pnpm kit:generate`. -->

# Kit pack membership — will the next kit sync overwrite my edit?

**Audience:** anyone, human or agent, about to edit a file under `scripts/`.

> **If I edit this file, will the next kit sync silently overwrite my edit?**

**kit-owned** = yes. Fix it in canonical, not here.  **repo-owned** = no; it is ours, edit freely.

This page is **generated** from `docs/standards/kit-pack-membership.json`, which is the only machine-read authority. Editing
this file by hand does nothing durable: `pnpm kit:check` regenerates it and byte-compares, so your
edit shows up as a failure rather than as a fact. Change the JSON.

---

## 0. Threat model — what this defends against, and what it does not

This defends against ONE thing: **editing a kit-owned file without knowing it is kit-owned**, where
the next sync would silently erase the work. That is a knowledge failure, closed by making the answer
available and keeping it correct.

It does NOT defend against anyone who already knows. Deliberate and not a gap to be closed later.
**Out of scope BY DESIGN — evasion by an informed actor:**

- `--no-verify` and equivalent escape hatches;
- editing the authority file itself, which is repo-owned like everything else here;
- a merge commit whose second parent carries an unclassified change.

**A finding that this can be circumvented by someone who knows about it is CONTESTED, not accepted:
Tier C item 8. Do not open a fix round for it.** Cite this section and say the boundary was declared,
not overlooked. Across two predecessor lanes this paragraph held for **eleven consecutive review
rounds** with zero re-derivations of that class; the lane that lacked it spent three of five rounds
there and died of it.

**Distinguish that from COVERAGE, which is in scope.** Someone who would have wanted to know, and was
not told, is a coverage gap — findings **accepted**. The test is intent, not mechanism: *would this
person have wanted to know?*

---

## 1. The trap: the `KIT_VERSION` header does NOT determine membership

The obvious rule — "files with a `# KIT_VERSION:` header are kit files" — is wrong in the direction
that loses work. `scripts/autopilot-review-readiness.mjs` carries **no** header and **is** a pack
member; it is also the most-patched kit file in this repo's history.

Mechanically, the updater reads a `KIT_VERSION` header from exactly one file,
`scripts/autopilot-scope-gate`, to version-gate the whole pack. Headers on the other files are never
read by it at all. A field consulted for one file cannot describe another file's membership.

This page therefore records header **presence**, never the number. To read a current value, measure
it — do not copy it from here:

```bash
awk '/^# KIT_VERSION:/{print $3; exit}' scripts/autopilot-scope-gate
```

---

## 2. Authority and provenance — re-verify, do not trust

| Field | Value |
|---|---|
| Canonical repository | ~/Projects/Claude template (origin/main) |
| **Canonical commit read at** | `9e1e79043804767097f859ca201d42245cd9c50c` |
| Also verified identical at | `782d714534d50f391850a02331c935a60d1e1cad` |
| Authority file | autopilot/parallel/autopilot-update.sh, function pack_pairs() |
| Measured on | 2026-09-27 |

Read from the merged immutable commit exported via git archive; its tree matches the independently reviewed HEAD recorded above. The dirty local feat/ap3 checkout was not a copy source. Source Git modes and destination pack modes are verified separately.

Re-verify with:

```bash
git -C "$HOME/Projects/Claude template" show 9e1e79043804767097f859ca201d42245cd9c50c:autopilot/parallel/autopilot-update.sh
```

### `pack_pairs()`, verbatim and unreordered

```text
autopilot-scope-gate:scripts/autopilot-scope-gate:100755
autopilot-review-readiness.mjs:scripts/autopilot-review-readiness.mjs:100755
autopilot-readiness-evidence-keys.mjs:scripts/autopilot-readiness-evidence-keys.mjs:100755
autopilot-ephemeral-review-worktree.mjs:scripts/autopilot-ephemeral-review-worktree.mjs:100755
autopilot-backlog-reconcile:scripts/autopilot-backlog-reconcile:100755
codex-review-pin.sh:scripts/codex-review-pin.sh:100755
parallel-scope-gate.md:docs/autopilot-parallel-scope-gate.md:100644
manifests/_TEMPLATE.json:docs/autopilot-manifests/_TEMPLATE.json:100644
readiness-evidence.TEMPLATE.json:docs/autopilot-manifests/_READINESS_EVIDENCE_TEMPLATE.json:100644
ap-finish.sh:scripts/ap-finish.sh:100755
ap-evidence.sh:scripts/ap-evidence.sh:100755
ap-housekeep.sh:scripts/ap-housekeep.sh:100755
templates/autopilot-backlog-audit.yml:.github/workflows/autopilot-backlog-audit.yml:100644
../autopilot-prompt-GENERIC.md:docs/autopilot-templates/autopilot-prompt-GENERIC.md:100644
../level3-workflow.md:docs/autopilot-templates/level3-workflow.md:100644
```

---

## 3. Overwrite mechanisms — and which are actually running

**A mechanism counts as ACTIVE only when its wiring point is measured**: who invokes it, where, and
an observed run or failure. Reading its code is not enough; a document describing it is not enough.

| Mechanism | Status | Invoked by | Latency | Measured |
|---|---|---|---|---|
| `kit-sync` | **active** | autopilot-update.sh in an isolated consumer worktree | next successful autopilot-update.sh run | 2026-09-27 |
| `session-hook` | **dormant** | NOTHING — the file exists but is registered nowhere | n/a while dormant | 2026-09-03 |

**`kit-sync`** — autopilot-update.sh copy_pack(): one cp loop over pack_pairs, after the canonical unit/e2e publish gate

**`session-hook`** — ~/.claude/hooks/autopilot-sync.cjs exists (mtime 2026-06-23) and its code would copy autopilot-scope-gate. But ~/.claude/settings.json registers exactly two hooks — Notification -> claude-notify-hook.sh and PostToolUse -> claude-heartbeat-hook.sh. There is NO SessionStart hook. `grep -rn autopilot-sync ~/.claude/settings*.json` returns nothing, and nothing in the canonical kit invokes it.

> ⚠️ **Stale by construction.** Measured outside this repository, under ~/.claude, which is personal configuration this repo cannot see or test. Re-measure the WIRING, never the code, before relying on this.
>
> *History:* Claimed three times before anyone measured the wiring: once as 'auto-overwrite with no human in the loop', once as 'auto-overwrite at every SessionStart'. Both were inferred from the hook's code or from a document describing its contents. ~/.claude/rules/autopilot-template.md:17 — a rules file loaded into every session — still asserts it runs.

---

## 4. Every file under `scripts/`

| File | Owner | Evidence | Overwritten by | Latency | `KIT_VERSION` header |
|---|---|---|---|---|---|
| `scripts/ap-finish.sh` | **kit-owned** | present in `pack_pairs` | kit-sync | next successful autopilot-update.sh run | none |
| `scripts/ap-housekeep.sh` | **kit-owned** | present in `pack_pairs` | kit-sync | next successful autopilot-update.sh run | none |
| `scripts/ap-merge.sh` | **repo-owned** | absent from `pack_pairs` | none | not overwritten | none |
| `scripts/autopilot-backlog-reconcile` | **kit-owned** | present in `pack_pairs` | kit-sync | next successful autopilot-update.sh run | present — read it, do not copy it |
| `scripts/autopilot-ephemeral-review-worktree.mjs` | **kit-owned** | present in `pack_pairs` | kit-sync | next successful autopilot-update.sh run | none |
| `scripts/autopilot-ephemeral-review-worktree.test.mjs` | **repo-owned** | absent from `pack_pairs` | none | not overwritten | none |
| `scripts/autopilot-onboard-fixtures.sh` | **repo-owned** | absent from `pack_pairs` | none | not overwritten | none |
| `scripts/autopilot-onboard.sh` | **repo-owned** | absent from `pack_pairs` | none | not overwritten | none |
| `scripts/autopilot-readiness-evidence-keys.mjs` | **kit-owned** | present in `pack_pairs` | kit-sync | next successful autopilot-update.sh run | none |
| `scripts/autopilot-review-readiness.mjs` | **kit-owned** | present in `pack_pairs` | kit-sync | next successful autopilot-update.sh run | none |
| `scripts/autopilot-root-lock` | **repo-owned** | absent from `pack_pairs` | none | not overwritten | none |
| `scripts/autopilot-scope-gate` | **kit-owned** | present in `pack_pairs` | kit-sync | next successful autopilot-update.sh run | present — read it, do not copy it |
| `scripts/check-kit-pack-membership.mjs` | **repo-owned** | absent from `pack_pairs` | none | not overwritten | none |
| `scripts/check-kit-pack-membership.test.mjs` | **repo-owned** | absent from `pack_pairs` | none | not overwritten | none |
| `scripts/check-review-readiness.mjs` | **repo-owned** | absent from `pack_pairs` | none | not overwritten | none |
| `scripts/check-review-readiness.test.mjs` | **repo-owned** | absent from `pack_pairs` | none | not overwritten | none |
| `scripts/codex-review-pin.sh` | **kit-owned** | present in `pack_pairs` | kit-sync | next successful autopilot-update.sh run | present — read it, do not copy it |
| `scripts/db-reset-test.mjs` | **repo-owned** | absent from `pack_pairs` | none | not overwritten | none |
| `scripts/db-reset-test.test.mjs` | **repo-owned** | absent from `pack_pairs` | none | not overwritten | none |
| `scripts/smoke-predeploy.mjs` | **repo-owned** | absent from `pack_pairs` | none | not overwritten | none |
| `scripts/generate-pwa-icons.mjs` | **repo-owned** | absent from `pack_pairs` | none | not overwritten | none |
| `scripts/stamp-sw.mjs` | **repo-owned** | absent from `pack_pairs` | none | not overwritten | none |
| `scripts/check-dev-login-exclusion.mjs` | **repo-owned** | absent from `pack_pairs` | none | not overwritten | none |
| `scripts/check-dev-login-exclusion.test.mjs` | **repo-owned** | absent from `pack_pairs` | none | not overwritten | none |
| `scripts/outbox-dlq-replay.mjs` | **repo-owned** | absent from `pack_pairs` | none | not overwritten | none |
| `scripts/public-alias-moderate.mjs` | **repo-owned** | absent from `pack_pairs` | none | not overwritten | none |
| `scripts/ap-evidence.sh` | **kit-owned** | present in `pack_pairs` | kit-sync | next successful autopilot-update.sh run | none |

- **`scripts/ap-merge.sh`** — Third state: safe to edit, but a sync prints an informational UNSYNCED_DRIFT line because our copy differs from canonical's. Plexco's grew a step 8b calling autopilot-backlog-reconcile that canonical never had. Never halts, never syncs, never repairs. Listed in unsynced_candidates() at autopilot-update.sh:69.
- **`scripts/autopilot-ephemeral-review-worktree.test.mjs`** — No canonical copy.
- **`scripts/autopilot-onboard-fixtures.sh`** — No canonical copy.
- **`scripts/autopilot-onboard.sh`** — No canonical copy.
- **`scripts/autopilot-review-readiness.mjs`** — THE HEADER COUNTER-EXAMPLE. No KIT_VERSION header, and it IS a pack member. Also the most-patched kit file in this repo's history. Trusting the header would mark it safe to edit and a sync would erase the edit.
- **`scripts/autopilot-root-lock`** — No canonical copy.
- **`scripts/autopilot-scope-gate`** — The dormant session-hook would copy only this file if wired. Historical equality at KIT_VERSION 33 followed manual sync 8e737fe (2026-08-27). It now matches the explicit KIT_VERSION 42 sync from canonical 9e1e79043804767097f859ca201d42245cd9c50c. Read equality as the result of those manual syncs, NOT as evidence that no drift pressure exists; session-hook wiring remains the separately dated external snapshot above.
- **`scripts/check-kit-pack-membership.mjs`** — No canonical copy (added by this lane).
- **`scripts/check-kit-pack-membership.test.mjs`** — No canonical copy (added by this lane).
- **`scripts/check-review-readiness.mjs`** — No canonical copy.
- **`scripts/check-review-readiness.test.mjs`** — No canonical copy.
- **`scripts/db-reset-test.mjs`** — No canonical copy. Repo-owned dev tooling: drops and recreates a LOCAL Compose test database, pinning all SIX call-path selectors itself -- docker endpoint, compose project, compose file, container, role and database name. DATABASE_URL_TEST is only a name cross-check, never the target. Edit it here.
- **`scripts/db-reset-test.test.mjs`** — No canonical copy. Guards the guard: the refusal is the tested behaviour, because a destructive check nobody has observed refusing is only a claim.
- **`scripts/smoke-predeploy.mjs`** — No canonical copy.
- **`scripts/generate-pwa-icons.mjs`** — No canonical copy (repo-local web build tooling, M1a).
- **`scripts/stamp-sw.mjs`** — No canonical copy (repo-local web build tooling, M1a).
- **`scripts/check-dev-login-exclusion.mjs`** — No canonical copy. Repo-owned CI guard (local-only dev-login, S5): fails `pnpm test` when the dev-login flag appears in deploy, container or CI config; the scanned globs are listed once, in the script header.
- **`scripts/check-dev-login-exclusion.test.mjs`** — No canonical copy. Tests the guard on planted occurrences, a clean tree, the git listing and this repository.
- **`scripts/outbox-dlq-replay.mjs`** — No canonical copy. Repo-owned owner CLI (L3): DLQ inspect and replay through job_definer definers.
- **`scripts/public-alias-moderate.mjs`** — No canonical copy. Repo-owned owner CLI (L10a): public alias moderation (list pending, approve, reject) through the 0060 owner-only definers.

---

## 5. Pack targets outside `scripts/`

Overwritten by a sync exactly like the ones above — the answer must not depend on which directory a
file happens to sit in.

| File | Owner | Evidence | Overwritten by | Latency | `KIT_VERSION` header |
|---|---|---|---|---|---|
| `docs/autopilot-parallel-scope-gate.md` | **kit-owned** | present in `pack_pairs` | kit-sync | next successful autopilot-update.sh run | none |
| `docs/autopilot-manifests/_TEMPLATE.json` | **kit-owned** | present in `pack_pairs` | kit-sync | next successful autopilot-update.sh run | none |
| `docs/autopilot-manifests/_READINESS_EVIDENCE_TEMPLATE.json` | **kit-owned** | present in `pack_pairs` | kit-sync | next successful autopilot-update.sh run | none |
| `docs/autopilot-templates/autopilot-prompt-GENERIC.md` | **kit-owned** | present in `pack_pairs` | kit-sync | next successful autopilot-update.sh run | none |
| `docs/autopilot-templates/level3-workflow.md` | **kit-owned** | present in `pack_pairs` | kit-sync | next successful autopilot-update.sh run | none |
| `.github/workflows/autopilot-backlog-audit.yml` | **kit-owned** | present in `pack_pairs` | kit-sync | next successful autopilot-update.sh run | none |

- **`docs/autopilot-templates/level3-workflow.md`** — Canonical mirror matches the pinned source. Plexco DD-107 policy is preserved in consumer-owned docs/standards/plexco-level3-autonomy.md; synchronization does not implement a new validator mode.

---

## 6. What is checked, and what is not

```bash
pnpm kit:check      # authority vs scripts/, and this page vs the authority
pnpm kit:generate   # rewrite this page from the authority
```

`kit:check` runs inside `pnpm -w test`, which is what CI executes, so both failures turn the build
red. It verifies two properties:

1. **Coverage** — every file under `scripts/` has exactly one record, and every `scripts/` record
   names a file that still exists. A new script nobody classified fails the build.
2. **Generation** — this page is byte-identical to what the authority generates. A hand-edit fails
   the build rather than becoming a silent fact.

**Not checked:** whether a kit-owned file was edited *without recording why*. There is no commit-time
guard; that is `kit-owned-commit-guard` in the backlog, held until its record format is specified up
front. Nor does anything re-read canonical automatically — §2 gives the command, and the rows above
are claims about the date they carry.
