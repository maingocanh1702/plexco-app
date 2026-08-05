# AP-49 — definer-bootstrap-cluster-wide-serialization: give both definer bootstraps a real cluster-wide lock

`infra/postgres-init/01-job-definer.sql` and `02-chat-definer.sql` each bootstrap a cluster-global,
`BYPASSRLS`-capable role. Roles and `pg_auth_members` are shared across the whole Postgres cluster, not
per-database; neither script's current serialization actually covers that. `chat_definer`'s own
`pg_advisory_xact_lock` only serializes callers connected to the **same** database (advisory locks are
documented database-local — confirmed empirically this session too); `job_definer` has no lock of any
kind. This launcher replaces both with a single mechanism measured directly against a live cluster, not
assumed from documentation: `LOCK TABLE pg_auth_members IN SHARE UPDATE EXCLUSIVE MODE`, which was the
only one of four candidates tested that actually provides cross-database mutual exclusion — wrapped in
exception handling that **fails open with a loud warning**, not silently and not fatally, on the one
confirmed-real environment where the connecting role cannot take it (DigitalOcean Managed PostgreSQL).

## Read before you write

1. `docs/autopilot-definer-bootstrap-cluster-wide-serialization.md` — the full contract. Read §5 in full
   before touching either file: it records that two "obvious" candidates (`SERIALIZABLE` isolation with
   caller-side retry, and a row-level `FOR UPDATE` lock on a shared-catalog row) were tested against a live
   Postgres 16 cluster and **do not work**, contrary to what `docs/autopilot-chat-definer-role-
   provisioning.md`'s own deferred comment claimed. Then read §5.4.1, §5.4.2, and §5.5 — this contract was
   revised after its first authoring specifically because the chosen mechanism cannot be taken at all on
   the real production host, and the fix for that is part of the diff, not an afterthought. Do not
   re-litigate the mechanism choice or the degradation design without re-running an equivalent live test —
   citation-only review of these sections is not sufficient.
2. `docs/autopilot-manifests/definer-bootstrap-cluster-wide-serialization.json` — scope, negative scope,
   verification, stop conditions. Read the whole file.
3. `286f48bbbd5b9f41c3e63e5f201ecfd276706bff` — the merge commit that recorded this exact finding as
   ACCEPTED and DEFERRED (`git show 286f48b`). This slice is that deferral's own closure condition, and
   also corrects that same commit's `SERIALIZABLE`-isolation candidate, which it named as a plausible fix
   without testing it (slice doc §5.2, §10 item 5).
4. `infra/postgres-init/01-job-definer.sql`, `infra/postgres-init/02-chat-definer.sql`,
   `packages/db/src/migrate.test.ts` — confirm current state matches the slice doc §3 evidence table
   before editing; if it has drifted (another slice touched these files since 2026-08-05), stop and
   re-verify rather than trusting this doc's snapshot.

## Registration mechanics — read this before running anything

**Measure the live kit version from `scripts/autopilot-scope-gate`'s own `# KIT_VERSION:` header before
assuming any behavior.** `register` HALTs `CONTRACT_INVALID` unless `--manifest` points at the RUNTIME
manifest (`.autopilot/state/<feature>/manifest.json`, carrying `manifest_schema_version:
level3-operational-v2`) — the authored contract under `docs/autopilot-manifests/` must never carry that
field. After registering, **confirm the hash-lock actually landed** before doing anything else:

```
scripts/autopilot-scope-gate register --manifest .autopilot/state/definer-bootstrap-cluster-wide-serialization/manifest.json
test -f .autopilot/state/definer-bootstrap-cluster-wide-serialization/registered-manifest.sha256 && echo LOCKED || echo NOT_LOCKED
```

Don't trust the word "registered" printed to the terminal — verify the hash-lock file exists.

## Steps

1. `git fetch origin main` and confirm `main == origin/main` before pinning `base_sha`. If it has moved
   past `18e88f28b268c48e21d11d7ef42ac96bbe5ca396`, re-verify the slice doc's §3 evidence against the new
   tip before proceeding — do not assume it still holds, especially the claim that neither file has been
   touched by other in-flight work.
2. Create worktree `.autopilot/worktrees/definer-bootstrap-cluster-wide-serialization` on branch
   `feat/definer-bootstrap-cluster-wide-serialization` from that exact `base_sha`.
3. Author ONLY the runtime manifest from the authored contract + `_TEMPLATE.json`, hand-test every
   `verification.focused` command against the real repo tree (all should currently fail except the two
   standing regression guards — see the manifest's own `_verification_note`), then register while `HEAD`
   still equals `base_sha`. Confirm `registered-manifest.sha256` exists before proceeding.
4. Edit `infra/postgres-init/01-job-definer.sql`: add the fail-open `LOCK TABLE` block (the `DO $$ BEGIN
   LOCK TABLE ... EXCEPTION WHEN insufficient_privilege THEN RAISE WARNING ...; END $$;` block, with its
   full explanatory comment) exactly per slice doc §7.1, as the first statement inside the existing
   membership `DO $$ ... BEGIN` block. Do not simplify this to a bare `LOCK TABLE` statement without the
   exception handler — that would silently abort the entire bootstrap on the production host instead of
   degrading loudly, which is the opposite of the design.
5. Edit `infra/postgres-init/02-chat-definer.sql`: remove the existing `PERFORM
   pg_advisory_xact_lock(1667525739);` line and its entire preceding comment block (the "Serialize the
   whole check-then-grant..." paragraph through "...deliberately deferred rather than built here.") —
   verify you have the exact boundaries of that comment block before deleting, per slice doc §7.2 — and
   replace with the same block used in step 4, renaming `job_definer` to `chat_definer` in the comment and
   the `RAISE WARNING` message text only. Do not touch anything else in the file: the re-pointing guard,
   the unsafe-options check, and the transitive re-check all stay exactly as merged.
6. Edit `packages/db/src/migrate.test.ts`: add the `withSyntheticRaceWindow` and
   `withManagedPostgresAdminRole` helpers and the **three** new test cases (two concurrency cases, one
   degraded-privilege case) exactly per slice doc §7.4. Before finishing:
   - Mutation-test check (concurrency cases): comment out the `LOCK TABLE` line in a scratch copy (or
     temporarily in the worktree, reverted before commit) and confirm the new `chat_definer` concurrency
     case actually goes red. If it stays green with the lock removed, the test is not exercising what it
     claims to — redesign it, do not ship it.
   - Sanity check (degraded-privilege case): confirm the `withManagedPostgresAdminRole` scratch role
     genuinely lacks `LOCK TABLE` privilege on `pg_auth_members` before trusting a green result on this
     case — if it accidentally runs with superuser-equivalent access, the case proves nothing.
7. Update case 14's (existing `chat_definer` concurrency test) inline comments that name
   `pg_advisory_xact_lock` / `"cdlk"` — they now describe a mechanism that no longer exists in the file.
   Its assertions do not need to change.
8. Self-verify: run every `verification.focused` and `verification.canonical` command from the runtime
   manifest by hand, including the full canonical suite (`pnpm typecheck && pnpm lint && pnpm
   format:check && pnpm review:check:changed && pnpm build && DATABASE_URL_TEST=... pnpm test`).
9. Commit the two SQL files plus the test file plus this slice's own three contract files in one commit.
   Do NOT touch `docs/autopilot-backlog.md` in this commit — out of scope (slice doc §8); a backlog entry
   is a separate, out-of-band chore.
10. Author `.autopilot/state/definer-bootstrap-cluster-wide-serialization/readiness.json` (see
    `docs/autopilot-manifests/_READINESS_EVIDENCE_TEMPLATE.json`) BEFORE calling `ready`.
11. `scripts/autopilot-scope-gate ready --manifest .autopilot/state/definer-bootstrap-cluster-wide-serialization/manifest.json`
    — runs the counted verification + review round(s) via `autopilot-review-readiness.mjs` and
    `scripts/codex-review-pin.sh`. `security_review.required` is `true` — the gate must run it.
12. Stop at `READY | AWAIT | HALT`. Do not merge.

## If the LOCK TABLE statement raises `permission denied` during CI/deploy verification

This is the **modeled, intended** degradation case — not a bug to route around, and not a HALT condition
by itself. The exception handler should catch it, `RAISE WARNING`, and let the bootstrap complete. Confirm
in the actual logs that the warning text is present (that is the proof the degradation was announced, not
silent). If the bootstrap instead **aborts entirely** on a managed-Postgres-shaped credential, or
**silently proceeds with no warning at all**, both are defects in the implementation, not acceptable
outcomes — HALT and fix, per the manifest's own stop conditions on this exact failure mode. Do not widen
the exception handler to catch anything other than `insufficient_privilege`, and do not weaken `SHARE
UPDATE EXCLUSIVE` to a different mode to "make the error go away."

## Negative scope

No change to either script's role attributes or existing fail-closed checks. No re-pointing guard added to
`job_definer` (separately recorded, out of scope). No fix for the `CREATEROLE` auto-membership side effect
(slice doc §5.4.2) — named, not fixed, here. No durable enforced home for the operational
single-bootstrap-point rule (slice doc §5.5) — that belongs in a deployment runbook or CI/CD guard, not
this slice's file scope. No edit to `test-harness.ts`, `ci.yml`, `docker-compose.yml`, `package.json`,
`docs/autopilot-invariant-catalog.md`, or `docs/autopilot-backlog.md`. No new migration file.
