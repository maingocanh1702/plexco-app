<!-- review-readiness: code-ready -->
# AP-49 — definer-bootstrap-cluster-wide-serialization: give both definer bootstraps a real cluster-wide lock

> **Status:** `CODE_READY` (see verdict, §9) · **Authored:** 2026-08-05, **revised same day** after owner
> review resolved the production-privilege question (§5.4.1) and surfaced a second-order finding (§5.4.2)
> · **Risk:** P1 (corrected from the task's proposed P2 — see §0.1) · **Authoring-only packet** (no
> worktree, no register, no code changed).
>
> **Revised again during implementation, 2026-08-05 (§9.3):** the §7.1/§7.2 SQL as originally authored did
> not parse (a dollar-quote tag collision) and `verification.focused` checks 7-8 conflicted with this
> document's own §7.1 text. Both found via required live-Postgres testing before any commit landed; both
> corrected here. No design or mechanism change.
>
> **⚠ CRITICAL FINDING, §10 item 7 — read before deploying to production:** the new "both files, degraded
> path" test case discovered that `chat_definer`'s bootstrap (unchanged by this slice, already merged as
> AP-47) cannot complete under ANY non-superuser CREATEROLE scenario — it cannot succeed on the real
> DigitalOcean production host at all. This slice's own mechanism (the LOCK TABLE fail-open design) is
> unaffected and works correctly; the blocker is a SEPARATE, pre-existing interaction between PG16's
> auto-membership side effect (§5.4.2) and chat_definer's own "unsafe options"/"re-pointing" checks. Not
> fixed here (out of this slice's negative scope) — needs its own urgent, dedicated follow-up slice.
>
> **Round 1 codex review, 2026-08-05 (§9.4):** found a REAL [P1] regression — the original LOCK-TABLE-only
> design left `chat_definer` with LESS protection than before on the degraded path (its prior
> `pg_advisory_xact_lock` needed no privilege and worked there; the replacement did not). Fixed: both
> files now take that same-database advisory lock unconditionally, before attempting the cluster-wide
> LOCK TABLE upgrade. Also fixed a [P2]: this document's own §9 verdict block and the launcher had not
> been synced past v1. Forced another close-and-re-register cycle (v2 → v3, same structural reason as
> §9.3's first one) since the fix flips `verification.focused` check 7's polarity against an
> already-hash-locked manifest.
>
> **Round 1 codex review on the v3 registration, 2026-08-05 (§9.5):** found two more [P1]s (both
> test-construction, not design: two concurrency tests could accidentally pass via a CREATE-ROLE race
> independent of the lock under test; chat_definer's own restored fallback had no dedicated behavioral
> test) and two [P2]s (non-failure-safe cleanup risking leaked cluster-global role state; §7.1/§7.2 and a
> test comment still describing the pre-round-1 design). All fixed as a plain follow-up commit — no
> verification.focused change, so no v3 → v4 this time.
>
> **Round 2 (gate attempt 2) codex review, 2026-08-05 (§9.6):** narrower still — one real [P1] (this
> document's own `stop_conditions`/`security_review.reason` blanket-claimed ALL concurrency tests must
> fail if `LOCK TABLE` is removed, which is false for the two same-database fallback cases §9.5 added)
> and a [P2] cluster of four stale references §9.4/§9.5's own edits missed, including a broken file-path
> typo in `02-chat-definer.sql` itself. All fixed; again no `verification.focused` change.
>
> **Round 3 (gate attempt 3) codex review, 2026-08-05 (§9.7):** one mirrored-comment sentence in
> `02-chat-definer.sql` that is true for `job_definer` but false for `chat_definer` (§10 item 7), and the
> active §9 verdict block / §9.1 closure matrix itself still carrying "three tests" and the retired base
> SHA in places §9.4/§9.5/§9.6 hadn't swept. Fixed exhaustively this time — grepped the whole document for
> both patterns rather than the two lines cited. Again no `verification.focused` change.
>
> **Round 4 (gate attempt 4) codex review, 2026-08-05 (§9.8):** the ROOT CAUSE of rounds 3-4 fixed
> structurally — §5.4.1 (and the §3 evidence-table row backing it) described a GENERIC probe's success in
> general terms, authored before implementation found chat_definer's separate blocker; both now carry an
> explicit correction at the SOURCE, not just downstream in the SQL comment round 3 already fixed. Also fixed a
> `G5_SCOPE` closure-matrix claim understating the actual (legitimate, review-driven) diff size, and marked
> the manifest's `context_sources` as as-of-authoring where stale. Again no `verification.focused` change.
>
> **Round 5 (gate attempt 5) codex review, 2026-08-05 (§9.9):** round 4's own `G5_SCOPE` fix used a
> non-canonical enum value (`docs/standards/review-code-readiness-gate.md` permits only `PASS | PARTIAL |
> FAIL`) plus a wrong figure and two bad citations (a nonexistent §28, a quote mis-attributed to
> `level3-workflow.md` §12 instead of `autopilot-invariants.md`) — replaced with the canonical `PASS` and
> an exact measured diff split. Also corrected §9.4's mutation-test claim, which described a mechanism
> §9.5 (written later in this same document) superseded. No P1s this round; no `verification.focused`
> change. fix-round-count reaches 5/5 (the ceiling) with this round's fix.

## 0. Session input

```text
REQUEST: final-readiness (authoring, not implementation)
TARGET_FILES:
  - infra/postgres-init/01-job-definer.sql (live, no cluster-wide lock of any kind today)
  - infra/postgres-init/02-chat-definer.sql (live, same-database-only pg_advisory_xact_lock today)
  - packages/db/src/migrate.test.ts (live, 1956 lines at base)
  - 286f48bbbd5b9f41c3e63e5f201ecfd276706bff (merge commit that recorded and deferred this finding)
  - docs/autopilot/contracts/autopilot-chat-definer-role-provisioning.md §5.4.2, §10 items 8-9 (the deferred boundary)
  - docs/standards/deployment-infra.md (production topology — single application database)
  - packages/db/README.md §"Runner-level role bootstrap" (the CREATE-race precedent, already cluster-safe)
EXPECTED_OUTCOME: CODE_READY (target); actual = CODE_READY, see §9
BASE_BRANCH: main
BASE_SHA: 18e88f28b268c48e21d11d7ef42ac96bbe5ca396 (= origin/main, re-verified at authoring time)
SCOPE_REPO: /Users/maingocanh/Projects/Plexco app
USER_AUTHORIZED_EDITS: yes (authoring this packet + manifest + launcher only; no register/worktree/code)
```

### 0.1 Risk correction: P1, not P2

The task framing proposed P2 ("touches two privilege-boundary scripts but adds no new privilege"). That
premise is true but the conclusion doesn't follow. `level3-workflow.md` §6's own risk table puts
"schema/migration, destructive or shared choke point" changes at P1, and the slice that first *wrote*
these two files (`chat-definer-role-provisioning`, AP-47) was classified P1 for touching the identical
files under the identical "privilege-boundary" reasoning — not for adding a grant. This slice edits the
same fail-closed mechanism those files exist to provide (§5 below shows §10 items 8-9's own "cluster-wide
fix exists in principle" claim is empirically false, which is a correction to already-merged, owner-
reviewed security reasoning, not a cosmetic change). Reclassified **P1**: supervised, full verification,
independent code review **and** security review, human merge. See manifest `risk`/`security_review`.

## 1. What this slice is

`infra/postgres-init/01-job-definer.sql` and `02-chat-definer.sql` each bootstrap a cluster-global,
`BYPASSRLS`-capable Postgres role. Roles live in a **shared, cluster-wide catalog** (`pg_authid`/
`pg_auth_members` — one copy per cluster, not per database); this application's Postgres cluster
routinely hosts more than one database (`plexco` + `plexco_test` in every local/CI environment today,
confirmed live in §3). `chat-definer-role-provisioning`'s own `pg_advisory_xact_lock` only serializes
callers connected to the **same** database (advisory locks are documented database-local); a bootstrap
against `plexco` and a concurrent bootstrap against `plexco_test` are not serialized by it at all.
`job_definer`'s script has no lock of any kind — not even that same-database protection.

This slice closes that gap in **both** files with one mechanism, measured against a live cluster rather
than assumed from documentation — and, after owner review, against the actual production privilege
ceiling (DigitalOcean Managed PostgreSQL) rather than left as an unverified assumption. It changes
**only** the serialization statement inside each script's existing membership-grant block; it adds no new
file, no migration, no new grant, and does not touch either script's attributes, fail-closed checks, or
(for `chat_definer`) its re-pointing guard.

## 2. Authority pins

- **Finding provenance:** `286f48bbbd5b9f41c3e63e5f201ecfd276706bff` — the `chat-definer-role-provisioning`
  merge commit. Its message records the finding as **ACCEPTED AS CORRECT** (raised three times by codex
  review, dismissed twice on grounds that didn't address the mechanism) and **DEFERRED** for exactly one
  reason: `01-job-definer.sql` has the identical hole and is already merged, so fixing only the newer
  script would leave an undocumented asymmetry. This slice is the "pattern-level slice covering BOTH
  bootstraps together" that commit message names as the closure condition. **That same commit message's
  candidate fix (`SERIALIZABLE isolation with caller-side retry`) is itself corrected by this slice** —
  see §5.2 and §10 item 5 for the explicit disproof and its provenance.
- **Deferral text:** `docs/autopilot/contracts/autopilot-chat-definer-role-provisioning.md` §5.4.2 (comment inside
  `02-chat-definer.sql` itself, lines 128-140) and §10 items 8-9.
- **Production privilege ceiling (owner-supplied, confirmed against DigitalOcean's own documentation,
  2026-08-05):** DigitalOcean Managed PostgreSQL never grants superuser — a product constraint, not a
  configuration gap. Fetched directly from `docs.digitalocean.com/products/databases/postgresql/how-to/
  modify-user-privileges/`: `doadmin`'s attributes are listed as exactly *"Create role, Create DB,
  Replication, Bypass RLS"* — `CREATEROLE`, `CREATEDB`, `REPLICATION`, `BYPASSRLS`, and explicitly **no**
  `SUPERUSER`. This resolves what the pre-revision version of this contract carried as an open, unverified
  stop condition (§10 item 1, revised) — see §5.4.1 for what it changes.
- **Live base (verified 2026-08-05, this session):** `git fetch origin main` + `git rev-parse origin/main
  HEAD` both return `18e88f28b268c48e21d11d7ef42ac96bbe5ca396` = `main` = `origin/main`. Working tree
  carries only pre-existing untracked WIP (`design.pen`, `docs/autopilot-templates/level3.1-design-
  discussion.md`, `docs/channels/web/FE/`, `docs/channels/web/docs_comparison.md`, `docs/sessions/`,
  `docs/templates/feature-dev/fe-spec-template.md`) — none touch this slice's files.
- **No competing in-flight work:** `.autopilot/INFLIGHT.md` has zero entries mentioning `definer` or
  `cluster-wide` (grepped this session). No other slice is registered against either target file.

## 3. Live-repo verification (this session, 2026-08-05)

| Claim | Method | Result |
|---|---|---|
| Both target files exist, current content | `Read` both files in full | `01-job-definer.sql` 123 lines, no lock statement in its membership block (block 3). `02-chat-definer.sql` 232 lines, `PERFORM pg_advisory_xact_lock(1667525739)` ("cdlk") is its only lock, scoped inside the membership block |
| Multiple databases already coexist in one cluster, today, not hypothetically | `docker exec plexco-postgres-1 psql -U plexco -d plexco -c "SELECT datname FROM pg_database"` | 16 databases: `plexco`, `plexco_test`, `postgres`, `template0/1`, plus 10 leftover test-scratch databases (`plexco_auth_check`, `plexco_jrd_dispatcher_stale_stops_cycle`, etc.) — corrects `docs/autopilot/contracts/autopilot-chat-definer-role-provisioning.md:866`'s claim of "no evidence anywhere in the codebase of a multi-database-per-cluster topology"; that evidence exists in this project's own dev/test setup today |
| Actual local/CI bootstrap credential's privilege level | `SELECT rolname, rolsuper FROM pg_roles WHERE rolname='plexco'` | `rolsuper = t`. `plexco` is the literal `DATABASE_URL_MIGRATION` identity in both `.github/workflows/ci.yml:76` and `infra/docker-compose.yml`'s own worker-prep comment — local dev and CI both bootstrap as a real Postgres superuser |
| Production bootstrap credential's privilege level | `docs.digitalocean.com/products/databases/postgresql/how-to/modify-user-privileges/` (fetched this session) | `doadmin`: `CREATEROLE, CREATEDB, REPLICATION, BYPASSRLS` — no `SUPERUSER`, confirmed by DO's own docs, not inferred |
| Production topology | `docs/standards/deployment-infra.md` §3-4 (topology diagram, process/role table) | Single application database (`Postgres PRIMARY + HA STANDBY`); no multi-database-per-cluster topology is planned |
| `LOCK TABLE` precedent in this codebase | `grep -rn "LOCK TABLE"` | Already used in `docs/features/BE/feature_payment_reconcile_tech.md:170` (application tables, reconciliation). Not a foreign idiom for this team — just never applied to a system catalog before |
| Existing advisory lock keys, for collision bookkeeping | `grep -rn "pg_advisory_lock\|_LOCK_KEY"` | `migrate.ts:31` → `0x706c7863` ("plxc"); `test-harness.ts:103` → `0x6a6f6264` ("jobd"); `migrate.test.ts` → `0x63686164` ("chad", `CHAT_DEFINER_LOCK_KEY`, a **different, unaffected** harness-level lock — see §8). `02-chat-definer.sql`'s own `0x63646c6b` ("cdlk") was AUTHORED here as retired-and-free — **corrected by round-01 codex review, SS9.4**: it is NOT retired, it is restored as an unconditional same-database fallback and remains live today, alongside job_definer's own new `0x6a646c6b` ("jdlk") key, §7.1 |
| A `doadmin`-shaped role (`CREATEROLE CREATEDB REPLICATION BYPASSRLS`, no superuser) can complete the full bootstrap sequence — GENERIC probe, not either literal file; see §5.4.1's own correction and §10 item 7: true for `job_definer`, NOT true for `chat_definer` (a separate, later-discovered bug) | Built a scratch role with exactly that attribute set on the live local cluster and ran `CREATE ROLE ... BYPASSRLS` → attempted `LOCK TABLE` → `GRANT` → `COMMIT` under it | `CREATE ROLE` succeeded (confirms `BYPASSRLS`-to-create-`BYPASSRLS` is satisfied); `LOCK TABLE` failed with `insufficient_privilege` as expected; `GRANT` succeeded; transaction committed cleanly — see §5.4.1 |
| A `CREATEROLE`-based (non-superuser) role creation has a side effect neither script accounts for | Same probe, inspected final `pg_auth_members` state | The creating role was **automatically** granted membership in the role it created, in addition to the explicitly-granted target — a PG16 behavior that never manifests today (`plexco` is superuser, which has no such side effect) — see §5.4.2 |

## 4. Dependency graph

**None executable.** Both target files are already merged on `main`. No `PRIOR_SLICE`, no `MERGED`
dependency to prove beyond "both files exist as of `BASE_SHA`" (§3, row 1).

## 5. The mechanism — measured, not assumed

Three candidates existed in the record (task notes; `docs/autopilot/contracts/autopilot-chat-definer-role-provisioning.md`
§5.1, §10 item 8). Rather than pick from documentation, each was run against the live local Postgres 16
cluster (`postgres:16-alpine`, matching `infra/docker-compose.yml` — the same major version this repo
runs everywhere) with genuinely concurrent sessions (two `psql` processes launched via shell `&`/`wait`
in one script, not sequential tool calls with an assumed timing gap — the first attempt at this exact
test used sequential tool calls and produced a false negative because session A finished before session B
even started; that trap is worth naming explicitly since it is easy to fall into when constructing the
regression test in §7.4).

### 5.1 Candidate A — `pg_advisory_xact_lock` (current `chat_definer` mechanism)

Documented database-local (`postgresql.org/docs/16/explicit-locking.html`); re-confirmed by the fact this
slice exists at all. Does not close the gap. Cost: none (already in place), benefit: none beyond
same-database, which the replacement mechanism subsumes.

### 5.2 Candidate B — `SERIALIZABLE` isolation with caller-side retry — **empirically disproven**

**Naming what was assumed and what was measured, per owner request (this claim's origin is the deferred
note this slice closes, authored in `286f48bbbd5b9f41c3e63e5f201ecfd276706bff` / carried into
`docs/autopilot/contracts/autopilot-chat-definer-role-provisioning.md` §10 item 8):** that text asserted *"a cluster-wide fix
exists in principle (SERIALIZABLE isolation with caller-side retry — the underlying `pg_auth_members` rows
ARE shared, so PostgreSQL's own conflict detection would correctly span databases)"*. This was plausible,
line-of-reasoning-only, and not tested against a live cluster at the time it was written. It was tested
here.

Two genuinely concurrent `SERIALIZABLE` transactions, one against `plexco`, one against `plexco_test`
(same cluster), each: read `count(*) FROM pg_auth_members ... WHERE g.rolname = '<scratch definer role>'`
(both observed `0`), slept 3s to force overlap, then `GRANT <scratch role> TO <distinct target>`,
`COMMIT`. **Both committed successfully.** Final state: both distinct targets became members — exactly
the accumulation bug the mechanism is supposed to prevent. No `40001 serialization_failure` on either
side. **The assumed mechanism does not provide the claimed guarantee, measured directly.**
(Plausible cause, not verified further since it doesn't change the conclusion: Postgres's predicate-lock
manager most likely exempts system catalogs from `SIREAD` bookkeeping, since ordinary query planning
reads catalogs constantly and tracking that for conflicts would produce false-positive serialization
failures across nearly all concurrent transactions — but the empirical fact stands regardless of the
internal reason.) **Do not build the caller-side retry infrastructure this candidate would have needed —
the primitive underneath it does not provide the guarantee.** This document is the only durable place
that corrects the claim: the merge commit message that made it is immutable git history (see §10 item 5).

### 5.3 Candidate C — row-level lock (`SELECT ... FOR UPDATE`) on a shared-catalog row — **empirically disproven**

Sanity-checked first against an ordinary table (confirms the test methodology: a second `FOR UPDATE` on
the same row blocked for the full hold duration, same database). Same statement, same database, against
`pg_database`'s `template1` row: **also blocked correctly** (2.5s wait, matching the hold time). Same
statement, **different databases** (`plexco` vs `plexco_test`), same row: **did not block at all** — both
sessions acquired the row lock within microseconds of each other, no waiting observed. Relation-level
locks on a shared catalog are cluster-wide (§5.4); tuple-level (row) locks on the same shared catalog are
not, empirically, in this Postgres 16 build — despite the underlying storage being physically shared.
This is a genuinely non-obvious distinction; do not assume `FOR UPDATE` on any shared-catalog row is
cluster-wide just because the catalog itself is shared.

### 5.4 Candidate D — relation-level lock (`LOCK TABLE ... IN SHARE UPDATE EXCLUSIVE MODE`) — **empirically confirmed, chosen mechanism**

Same cross-database setup as candidate C, but `LOCK TABLE pg_database IN SHARE UPDATE EXCLUSIVE MODE`
instead of a row-level `FOR UPDATE`: session B (different database) blocked for the full ~2.5s until
session A committed, then acquired immediately — genuine cluster-wide mutual exclusion. `SHARE UPDATE
EXCLUSIVE` was chosen because it **self-conflicts** (two holders can't coexist — required for mutual
exclusion) but does **not** conflict with `ROW EXCLUSIVE` (the mode an ordinary `GRANT`/`REVOKE` takes) —
confirmed directly: an unrelated `GRANT zz_unrelated_target TO plexco` from a third session, fired from a
different database while the lock was held, completed in under 1ms, unblocked. A stronger mode
(`EXCLUSIVE`/`ACCESS EXCLUSIVE`) would have blocked ordinary role-grant activity elsewhere in the cluster
for no benefit; `SHARE UPDATE EXCLUSIVE` is the minimum strength that provides the guarantee (the same
mode `VACUUM`/`CREATE INDEX CONCURRENTLY` use for exactly this "serialize maintenance against itself,
don't block ordinary traffic" shape).

**Lock target: `pg_auth_members`**, not `pg_database`. Semantically it is the table whose consistency
this mechanism protects (the check-then-grant sequence reads and writes it); locking the resource you are
about to mutate is the standard idiom (`feature_payment_reconcile_tech.md:170`'s own `LOCK TABLE` already
does this for application tables). Re-verified the cross-database blocking property specifically against
`pg_auth_members` (not just `pg_database`) before relying on it.

**Cost — confirmed superuser-only, no ACL grant substitutes.** `pg_auth_members` grants public `SELECT`
by default (`relacl` confirmed: `{plexco=arwdDxt/plexco,=r/plexco}`) but `LOCK TABLE ... SHARE UPDATE
EXCLUSIVE` still failed with `permission denied` for a non-superuser role — even after explicitly
granting that role `UPDATE` on the table directly, and even after granting it membership in Postgres's
own built-in `pg_write_all_data` predefined role (which is documented to cover ordinary tables broadly).
Same result for `pg_database`. This is consistent with Postgres treating write-class access to shared
system catalogs as superuser-only regardless of ACL, not a probe artifact — tested three ways (bare
non-superuser, `UPDATE` grant, `pg_write_all_data` membership), all three denied identically.

#### 5.4.1 The production privilege ceiling: confirmed, not assumed — and what the design does about it

The question the first version of this contract carried as an unresolved stop condition is now answered:
**DigitalOcean Managed PostgreSQL never grants superuser (§2, §3) — this mechanism cannot take its lock on
the production host `infra-do-app-vpc-deployment` targets. That is a known wall, not a gap to fill in
later.**

What is *not* blocked: `doadmin` has `BYPASSRLS` (§2, §3), and `CREATE ROLE ... BYPASSRLS` requires
exactly that attribute of its creator — nothing more. Verified directly, not just inferred from the
attribute list: built a scratch role with `doadmin`'s exact documented shape (`CREATEROLE CREATEDB
REPLICATION BYPASSRLS`, `NOSUPERUSER`) on the live local cluster and ran the real sequence under it —
`CREATE ROLE zz_test_definer ... BYPASSRLS` succeeded, the `LOCK TABLE` attempt failed with
`insufficient_privilege` as expected, a `GRANT` to a target role succeeded, and the transaction committed
cleanly end to end (§3, last-but-one row). **The bootstrap's actual work — creating the role, granting
membership — does run on the production host. Only the cross-database serialization guarantee does not.**

> ⚠ **This paragraph describes a GENERIC probe (a scratch role, a simplified create/lock/grant sequence),
> not either literal bootstrap file — and its conclusion turned out to be true for ONE of the two, not
> both.** Implementation (§9.4 onward) confirmed this holds for `01-job-definer.sql` exactly as described.
> It does **not** hold for `02-chat-definer.sql`: that file's own, separate, pre-existing
> unsafe-membership-options / re-pointing checks (unrelated to superuser privilege, unrelated to this
> slice's own serialization mechanism) refuse a fresh non-superuser-`CREATEROLE` bootstrap unconditionally
> — confirmed by the actual literal file, not a simplified probe. **§10 item 7 is the canonical, current
> statement of this; every other claim in this document about "the bootstrap" succeeding under a
> `doadmin`-shaped connection means `job_definer` only, unless chat_definer is named explicitly as also
> succeeding — which it does not, for this reason, found after this section was authored.**

The design response, per owner direction, is neither "hard-fail the whole bootstrap whenever the lock is
unavailable" (that would make the bootstrap **never** succeed in production, contradicting the paragraph
above) nor "silently skip the lock and proceed as if nothing changed" (*"a serialization mechanism that
quietly no-ops is worse than none, because the next reader sees `LOCK TABLE` in the file and assumes it
held"*). Instead: **catch `insufficient_privilege` specifically — no other exception class — around the
`LOCK TABLE` statement alone, `RAISE WARNING` naming the degradation explicitly, and let the rest of the
bootstrap proceed normally.** `RAISE WARNING` inside a caught exception does not abort the enclosing
transaction (standard PL/pgSQL behavior, re-confirmed empirically in the same probe: the transaction
committed after the warning fired) and is visible by default in `psql`'s output — meaning it surfaces in
whatever captures `pnpm db:bootstrap`'s output on that deployment (CI log, deploy log, terminal) without
requiring any new configuration. This satisfies both halves of the instruction: the degradation is
**announced**, and the bootstrap does not proceed **silently**. See §7.1/§7.2 for the exact SQL.

This is strictly better than today, where the guarantee exists nowhere. It gives the guarantee everywhere
it mechanically can (local, CI, docker-compose — all superuser today) and degrades, loudly, everywhere it
mechanically cannot (production). What makes production safe despite the degradation is not this SQL — it
is the operational rule in §5.5.

#### 5.4.2 A second-order finding: `CREATEROLE`-based role creation auto-grants the creator membership

Discovered while running the §5.4.1 probe, not something either script or this contract anticipated
before testing under a non-superuser creator: when a `CREATEROLE`-holding, non-superuser role creates a
new role (as `doadmin` would, in production), **PostgreSQL 16 automatically grants the creating role
membership (with `ADMIN OPTION`) in the role it just created** — confirmed by inspecting `pg_auth_members`
after the probe's `CREATE ROLE` step: the creating scratch role held membership alongside the explicitly
granted target, with no `GRANT` statement naming it. This side effect **never fires today** — `plexco` is
a true superuser everywhere this repo currently runs, and superuser role creation carries no such
automatic membership (superusers bypass these checks entirely rather than relying on the CREATEROLE-holder
convenience grant PG16 added). It becomes real the first time `job_definer`/`chat_definer` is actually
bootstrapped by a CREATEROLE-based, non-superuser identity — i.e., the first real production run.

**Impact, precisely scoped:** benign when `MIGRATION_ROLE` is unset — the common case, and the pattern
this repo's own CI already uses (`.github/workflows/ci.yml:76` sets no `MIGRATION_ROLE`) — because the GUC
then falls back to `CURRENT_USER`, which is the same identity that just got the automatic membership; the
explicit `GRANT` becomes an idempotent no-op against a membership that already exists. It stops being
benign the moment `MIGRATION_ROLE` is explicitly set to a role **other than** the bootstrapping connection
itself on a non-superuser deployment: `chat_definer`'s own re-pointing guard (already merged, unchanged by
this slice) would then find the auto-granted creator as an existing member different from the resolved
target and **refuse to proceed** — a real rejection, not a false one, but one that would read as mysterious
without this note.

**Deliberately not fixed here.** This is not a serialization concern — it is a grant-behavior question, and
the task's own negative scope forbids changing "attributes, grants, fail-closed checks and the
`chat_definer` membership denial" beyond the serialization mechanism (§8). Named precisely so it is not
discovered live during a first `MIGRATION_ROLE`-pinned production deploy — see §10 item 2.

## 5.5 The production-path answer: an operational rule, alongside the mechanical one

On the one host this mechanism cannot mechanically protect — DigitalOcean Managed PostgreSQL, confirmed
§5.4.1 — cluster-wide safety cannot come from this file's own SQL. Per owner ruling, this session: **on
that host, the bootstrap must run from exactly one place, never concurrently, against that cluster.**
Same shape as fail-closed-by-design-not-by-lock elsewhere in this project when a mechanical guarantee
cannot be obtained — the mechanism gives the guarantee where it can be taken (§5.4.1); where it cannot,
the guarantee is operational instead, and the WARNING (§5.4.1) is what proves, per run, that the mechanical
half did or didn't hold.

**The `tenant_provision session-cache race` precedent is a forward reference, not a missing one** —
confirmed by the owner after this session's multi-angle search (the exact phrase; "session-cache" alone;
singleton/never-concurrent/one-place language; `cache`+`tenant` combinations; `packages/db/src/auth.ts`;
`docs/decisions/analysis/dd-46-skip-club-analysis.md`) came up empty. It lives in DD-29's `0028`/`0029` migration headers,
authored as part of the `plans-dd29-capability-registry` slice (`docs/autopilot-plans-dd29-capability-
registry.md`) — whose own status is `ready` in its worktree but **unmerged**: neither migration is on
`main` as of this slice's `BASE_SHA` (§2). There was nothing on disk yet to find; flagging it instead of
citing it blind was the correct response to a real gap, not a search failure. The reference resolves once
`plans-dd29-capability-registry` lands. Until then, this section records the ruling's shape as given in
this conversation (owner authority, 2026-08-05), not as a citation of a document that exists yet.

**Not yet given a durable home.** This rule needs to live somewhere a deploy actually reads — a deployment
runbook, a CI/CD guard preventing concurrent bootstrap invocations against the production connection
string, or an equivalent operational control — not only as prose in this contract, which nothing enforces
and which an implementer of a *different* future slice has no reason to open. `docs/standards/deployment-
infra.md` is the natural home (it already owns topology/process/role documentation) but is outside this
slice's own file scope. Recorded as a named follow-up, §10 item 3 — not done here.

## 6. Migration numbering

**Not applicable.** No new file under `packages/db/migrations/`; `MIGRATION_COUNT` in `migrate.test.ts`
stays unchanged.

## 7. Scope — exact changes to 2 files + 1 test file

### 7.1 `infra/postgres-init/01-job-definer.sql`

> **Superseded by the round-01 codex review two-layer design (2026-08-05) — see §9.4.** The text below is
> the CURRENT, live SQL (verified against the file on disk at each revision of this document), not the
> original round-00 LOCK-TABLE-only design. §9.3/§9.4 record why it changed twice; this section exists to
> give an implementer the exact target text, and is kept in sync with the file rather than describing a
> point-in-time diff instruction.

Add the following as the **first statement inside** the existing membership `DO $$ ... BEGIN` block
(before the `IF v_grant_to IN ('app', 'app_worker', 'readonly')` check), so the lock attempts — successful
or degraded — precede the runtime-role-target check, the `GRANT`, and the post-grant transitive re-check.
Two layers, in this exact order: an unconditional, ordinary `pg_advisory_xact_lock` first (needs no
elevated privilege, guarantees same-database serialization on every host), then the cluster-wide `LOCK
TABLE` upgrade (needs superuser, fails open with a warning where it cannot be taken):

```sql
  -- Cluster-wide serialization (definer-bootstrap-cluster-wide-serialization, 2026-08-05): roles and
  -- pg_auth_members are CLUSTER-shared, not database-local, so a concurrent bootstrap of this same role
  -- from a DIFFERENT database in this cluster is a real, measured race this file had zero protection
  -- against (not even same-database -- that gap was chat_definer-only). Measured against a live cluster
  -- before choosing this mechanism: pg_advisory_xact_lock is documented+confirmed database-local;
  -- SERIALIZABLE isolation does NOT detect this specific conflict (verified empirically -- two concurrent
  -- SERIALIZABLE transactions from different databases both committed a GRANT to distinct targets with no
  -- serialization_failure -- this corrects the "SERIALIZABLE isolation with caller-side retry... exists in
  -- principle" claim the merge commit deferring this fix originally made; see docs/autopilot-definer-
  -- bootstrap-cluster-wide-serialization.md SS5.2); a row-level FOR UPDATE lock on a shared-catalog row
  -- does NOT block cross-database despite the catalog's storage being physically shared (verified
  -- empirically, SS5.3). A RELATION-level LOCK on a shared catalog DOES block cross-database (verified
  -- empirically, SS5.4) and, at SHARE UPDATE EXCLUSIVE, self-conflicts without blocking ordinary
  -- GRANT/REVOKE elsewhere (which take ROW EXCLUSIVE -- confirmed non-conflicting).
  --
  -- Requires a true superuser connection -- confirmed no ACL grant or pg_write_all_data membership
  -- substitutes (SS5.4). This application's actual production host, DigitalOcean Managed PostgreSQL, NEVER
  -- grants superuser -- a product constraint, not a config gap (docs.digitalocean.com/products/databases/
  -- postgresql/how-to/modify-user-privileges/: doadmin's attributes are exactly Create role, Create DB,
  -- Replication, Bypass RLS -- no Superuser, confirmed 2026-08-05). This statement WILL fail there. It
  -- fails OPEN, not silently and not fatally: catches insufficient_privilege specifically (SQLSTATE 42501,
  -- never any other error class) and announces the degraded run via RAISE WARNING, loud in every
  -- deployment/CI log capturing this script's output. The rest of this bootstrap does not need superuser
  -- -- doadmin's own Bypass RLS attribute is exactly what CREATE ROLE ... BYPASSRLS requires of its
  -- creator (verified empirically against a role shaped exactly like doadmin's documented attribute set,
  -- SS5.4.1).
  --
  -- TWO-LAYER design, added round-01 codex review (2026-08-05): this LOCK TABLE statement alone gives
  -- ZERO protection on the one host it cannot mechanically take its lock on -- the exact production host
  -- this bootstrap targets. An UNCONDITIONAL, ordinary pg_advisory_xact_lock (below, before this
  -- statement) needs no elevated privilege at all and always succeeds for any authenticated role, so it
  -- is taken FIRST and unconditionally to guarantee AT LEAST same-database serialization on every host,
  -- superuser or not. LOCK TABLE then attempts to UPGRADE that to cluster-wide serialization when the
  -- connection can take it (local/CI/docker-compose today; never on DigitalOcean). Layered, not
  -- either/or: on a superuser connection both locks are held (redundant, harmless); on a degraded
  -- connection only the advisory lock holds, which is still strictly better than the zero protection a
  -- LOCK-TABLE-only design would leave in place on the exact host that matters most. On a host where the
  -- cluster-wide upgrade cannot be taken, cluster-wide safety (beyond the same-database floor this
  -- advisory lock guarantees) depends on an OPERATIONAL rule: this bootstrap runs from exactly one place,
  -- never concurrently, against that cluster -- see docs/autopilot-definer-bootstrap-cluster-wide-
  -- serialization.md SS5.5. The WARNING appearing (or not) in a given run's log is the only evidence of
  -- whether the cluster-wide upgrade held for that run -- this statement's mere presence in the file is
  -- not proof.
  PERFORM pg_advisory_xact_lock(1784966251); -- 0x6a646c6b, "jdlk" -- distinct from "chad" (0x63686164),
  -- "jobd" (0x6a6f6264, a DIFFERENT test-only inter-file lock, migrate.test.ts), "plxc" (0x706c7863), and
  -- "cdlk" (0x63646c6b, chat_definer's own equivalent same-database fallback, 02-chat-definer.sql)
  DO $lock$
  BEGIN
    LOCK TABLE pg_auth_members IN SHARE UPDATE EXCLUSIVE MODE;
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE WARNING 'job_definer bootstrap: DEGRADED -- cannot acquire the cluster-wide serialization lock on pg_auth_members (insufficient privilege on this connection -- expected on a managed Postgres host with no true superuser). Proceeding WITHOUT the cross-database concurrency guarantee; this run depends on the operational single-bootstrap-point rule instead (docs/autopilot/contracts/autopilot-definer-bootstrap-cluster-wide-serialization.md SS5.5).';
  END
  $lock$;
```

The inner `LOCK TABLE` block's dollar-quote tag is `$lock$`, not the bare empty tag the outer block already
uses (see §9.3 — the bare-tag form does not parse: the two blocks' opening tags collide and the outer
string closes prematurely at the inner block's own opening). `GRANT USAGE ON SCHEMA public TO job_definer;`
at the end of the file is unchanged.

### 7.2 `infra/postgres-init/02-chat-definer.sql`

> **Superseded by the round-01 codex review two-layer design (2026-08-05) — see §9.4.** As authored, this
> section instructed *removing* `chat_definer`'s advisory lock entirely. round-01's review found that was
> a regression (the degraded/production path lost same-database protection it previously had) and the
> advisory lock was restored as an unconditional fallback — kept, not removed, and now positioned exactly
> where the same block sits in `01-job-definer.sql` §7.1.

The comment block that used to justify `chat_definer`'s advisory lock as database-local-only and
"deliberately deferred" a cluster-wide fix (the "Serialize the whole check-then-grant..." paragraph
through "...deliberately deferred rather than built here.") is **removed** — it documented the
now-disproven "SERIALIZABLE isolation" escape hatch (§5.2) and must not survive unedited. **Replace** with
the same two-layer block used in `01-job-definer.sql` §7.1 above, with `job_definer` renamed to
`chat_definer` in the file-identity comment and the `RAISE WARNING` message text (matching each file's own
existing self-naming convention) and the advisory-lock key changed to `chat_definer`'s own, ORIGINAL key —
`1667525739` (`"cdlk"`), restored rather than retired — otherwise identical (the two files already mirror
each other "almost line-for-line" — see §7.3 for why this is duplicated rather than shared). Position:
first statement inside the membership `DO $$ ... BEGIN` block, before `v_target`/`v_grant_to` resolution —
i.e., exactly where the file's original advisory lock already sat. Nothing else in the block (the
re-pointing guard, the unsafe-options check, the transitive re-check) changes.

`0x63646c6b` (`"cdlk"`) is **not retired** — it is the live key `chat_definer`'s own restored advisory
lock uses today; the collision-avoidance note against the `job_definer`/`plxc`/`chad` keys elsewhere in
this file's history still applies, now alongside job_definer's own new `"jdlk"` key (`0x6a646c6b`,
§7.1) — the two are deliberately distinct.

### 7.3 Why duplicated, not shared

The fix is one SQL block, identical in both files except the role name in two strings. `infra/postgres-
init/` has no existing `\i`-include or shared-snippet pattern, and `02-chat-definer.sql` already
duplicates far more than this from `01-job-definer.sql` by established precedent (its own header: "mirrors
`01-job-definer.sql` almost line-for-line"). Introducing a new sharing mechanism for one block is
disproportionate (YAGNI) and would be the first of its kind in this directory. Duplicate it.

### 7.4 `packages/db/src/migrate.test.ts` — FIVE new test cases (was three at authoring; grew across two review rounds)

> **Superseded by two rounds of codex review (2026-08-05) — see §9.4.** This section's original plan (three
> cases: two cluster-wide-concurrency, one degraded-privilege) is retained below UNEDITED as the
> as-authored historical record, since the actual test file is now the source of truth and this section's
> exact code samples are not kept in byte-for-byte sync with it (unlike §7.1/§7.2's SQL, which is short
> enough to keep synced). What actually shipped, across rounds 00-02: (1) job_definer cross-database
> concurrency, (2) chat_definer cross-database concurrency, (3) job_definer SAME-database degraded-fallback
> concurrency (round 01 — proves the regression fix), (4) chat_definer SAME-database degraded-fallback
> concurrency (round 02 — the sibling case round 01 itself was missing), (5) the "both files, degraded
> path" single-caller warning proof. `withSyntheticRaceWindow` below is also stale: round 02 removed its
> default marker (a mutation-testing defect — injecting the sleep inside the LOCK TABLE statement's own
> text meant removing that statement also destroyed the injection point) and it now takes an explicit,
> lock-independent anchor marker (`JOB_DEFINER_RACE_ANCHOR` / `CHAT_DEFINER_RACE_ANCHOR`) every time. Read
> the test file directly for the current, correct shape of all five cases and both shared helpers.

Three new cases, added as siblings to the existing `describe` blocks each file's tests already live in
(`"job_definer bootstrap script itself fails closed on runtime-role targets"` around line 1239, and the
`chat_definer` `describe` block housing cases 1-17).

**Shared test-only helper — widening the race window** (mirrors where the manual probe placed its own
`pg_sleep`, in-memory only, never written to disk):

```ts
async function withSyntheticRaceWindow(sql: string, seconds: number): Promise<string> {
  const marker = "LOCK TABLE pg_auth_members IN SHARE UPDATE EXCLUSIVE MODE;";
  if (!sql.includes(marker)) {
    throw new Error("withSyntheticRaceWindow: LOCK TABLE marker not found — has the file's mechanism changed?");
  }
  return sql.replace(marker, `${marker}\n  PERFORM pg_sleep(${seconds});`);
}
```

**Shared test-only helper — simulating the production privilege ceiling** (local to `migrate.test.ts`,
mirroring the existing local-not-exported convention for `bootstrapChatDefiner`/`hideRealJobDefiner`;
created via the superuser `admin` connection, which — being superuser — can freely grant any attribute
set to a scratch role regardless of what that role itself will later be able to do):

```ts
async function withManagedPostgresAdminRole<T>(fn: (roleName: string, password: string) => Promise<T>): Promise<T> {
  // Mirrors DigitalOcean's own documented doadmin attribute set exactly (docs.digitalocean.com/products/
  // databases/postgresql/how-to/modify-user-privileges/, confirmed 2026-08-05): CREATEROLE, CREATEDB,
  // REPLICATION, BYPASSRLS — deliberately NOT superuser. Used to prove the fail-open design (§5.4.1) and
  // the auto-membership side effect (§5.4.2) against a role shaped like the real production credential,
  // not an arbitrary non-superuser role.
  const roleName = "zz_managed_pg_admin_sim";
  const password = "probe";
  await admin.query(`DROP ROLE IF EXISTS ${roleName}`);
  await admin.query(
    `CREATE ROLE ${roleName} LOGIN NOSUPERUSER CREATEROLE CREATEDB REPLICATION BYPASSRLS PASSWORD '${password}'`,
  );
  try {
    return await fn(roleName, password);
  } finally {
    await admin.query(`DROP ROLE IF EXISTS ${roleName}`);
  }
}
```

**New case — `chat_definer`, concurrency:** `"N=2 concurrent bootstrap calls against DIFFERENT databases
in the same cluster serialize correctly; at most one non-runtime member ever exists"`. Setup:
`hideRealChatDefiner` (existing helper) to reset to absent; `CREATE DATABASE` one fresh scratch database
in the same cluster (mirrors `BR-1`'s existing `plexco_migrate_race`-style naming, e.g.
`plexco_migrate_clusterlock_chat_b`); two scratch non-runtime target roles. Read `02-chat-definer.sql` via
`readFile`, wrap with `withSyntheticRaceWindow(sql, 2)`. Fire both bootstrap calls via `Promise.all` — one
against `BASE` (`plexco_test`), one against the new scratch database — targeting the two distinct roles,
**both connected as the real superuser** `admin` identity (this case proves the mechanical lock itself;
the degraded path is a separate case below). Assert: (a) total elapsed time is close to the sum of both
calls' individual durations, not the max (proves the second call actually waited — timing-based, matching
how §5.4 itself was verified, not an assumption); (b) exactly one target ends up a member of
`chat_definer`; (c) the other call's error matches the **existing** re-pointing guard's message,
`/already granted to/i` (case 8's own regex) — this is the already-merged guard firing correctly now that
the second caller's check-then-grant sequence runs strictly after the first's commit, not a new check.
**This is the assertion that goes red if the `LOCK TABLE` line is removed** — without it, per §5.2/§5.3,
both calls can observe "no existing member" and both succeed, landing two members and never triggering
the re-pointing guard's rejection at all. Confirm this by removing the line once during implementation and
observing the case fail (mirrors the mutation-testing discipline `docs/autopilot-chat-definer-role-
provisioning.md` §11 already established and recorded for this exact file's other 17 cases) — record the
result in this slice's own implementation notes, not as a permanently-committed mutation.

**New case — `job_definer`, concurrency:** `"N=2 concurrent bootstrap calls against DIFFERENT databases in
the same cluster genuinely serialize (timing-verified)"`. Same construction (fresh scratch database,
`Promise.all`, `withSyntheticRaceWindow`, superuser connections). `job_definer`'s script has **no
re-pointing guard** (§5.4.2's own note; §8) — that is `docs/autopilot/contracts/autopilot-chat-definer-role-provisioning.md`
§10 item 4's already-recorded, separately-owned follow-up, not this slice's to add. So this case cannot
assert "the second call is refused"; it asserts only what this slice's mechanism actually guarantees:
timing (the second call's total duration includes the full wait for the first's lock release) and, since
both calls in this specific test target **the same** role (unlike the `chat_definer` case, where
targeting different roles exercises the existing re-pointing guard), that the role ends up granted to
exactly the role both calls agree on with **zero** duplicate-grant errors (the idempotent-replay path,
now provably serialized rather than racing).

**New case — both files, degraded path:** `"when the connecting role cannot acquire the cluster-wide
lock (mirroring DigitalOcean's doadmin), the bootstrap still completes and announces the degradation"`.
Setup: `withManagedPostgresAdminRole`. Connect a `pg.Client` to `BASE` **as the scratch role**, not
`admin`; attach a `'notice'` listener before issuing the query (the `pg` driver surfaces both `NOTICE`-
and `WARNING`-severity server messages via this event). Run the real, unmodified bootstrap SQL (no
`withSyntheticRaceWindow` — this case is not about timing) via that connection. Assert: (a) the call does
**not** throw; (b) the target role ends up correctly granted (proves the rest of the bootstrap completed —
the `BYPASSRLS`-to-create-`BYPASSRLS` precondition and the `GRANT` both succeeded under this role, matching
§5.4.1's manual probe); (c) exactly one captured notice has `severity === "WARNING"` and `.message` matches
`/DEGRADED.*cannot acquire.*lock|insufficient.privilege/i`; (d) **document, do not newly assert as a
pass/fail condition**, that the scratch admin role itself also ends up a member of the definer role — this
is §5.4.2's auto-membership finding, real and expected, not a defect this case exists to catch. A comment
at this assertion should point to §5.4.2 and note explicitly that testing the re-pointing-guard interaction
with an *explicit, different* `MIGRATION_ROLE` under this same non-superuser identity is out of this
slice's scope (§8) — do not silently expand this case to cover it.

`MIGRATION_COUNT` stays unchanged; no other existing case's assertions change. Case 14 (`chat_definer`,
"N concurrent bootstrap calls targeting DIFFERENT valid migration roles... added round-03 fix") keeps its
assertions unchanged (the outcome it tests — exactly one succeeds, no accumulation, same database — still
holds under the new mechanism, which strictly subsumes what the advisory lock provided) but its own
inline comments naming `pg_advisory_xact_lock`/`"cdlk"` become stale and must be updated to reference
`LOCK TABLE ... pg_auth_members` instead, or a reader following that comment into the source will look
for a statement that no longer exists.

## 8. Negative scope

- **NOT** any change to either script's role attributes (`NOLOGIN NOSUPERUSER BYPASSRLS ...`),
  fail-closed attribute-drift checks, runtime-role-target refusal, or (for `chat_definer`) its membership-
  denial / re-pointing / unsafe-options checks. Only the serialization statement changes.
- **NOT** adding a re-pointing guard to `job_definer` — that gap (`docs/autopilot-chat-definer-role-
  provisioning.md` §5.4.2, §10 item 4) is real, already recorded, and explicitly the owner's own follow-up
  to open, not this slice's. This slice's fix still closes the cluster-wide gap for every check `01-job-
  definer.sql` **does** have (runtime-role-target refusal, both transitive re-checks) — it does not, and
  is not trying to, make `job_definer` as strict as `chat_definer`.
- **NOT** fixing the `CREATEROLE`-based auto-membership side effect (§5.4.2) — not a serialization
  concern, and changing grant behavior beyond the serialization mechanism is explicitly out of this
  slice's negative scope per the task briefing itself.
- **NOT** giving the operational rule (§5.5) a durable, enforced home (runbook, CI/CD guard, or
  equivalent) — named as a follow-up, §10 item 3, because its natural home (`docs/standards/deployment-
  infra.md` or an ops/CI file) is outside this slice's own file scope.
- **NOT** `packages/db/src/test-harness.ts` — `bootstrapJobDefiner`/`bootstrapChatDefiner`/
  `withJobDefinerLock`/`withChatDefinerLock` are pass-through readers/executors of the SQL files; they
  need no change. `withChatDefinerLock`'s own key (`"chad"`, `CHAT_DEFINER_LOCK_KEY`) protects a
  **different** concern (one test file's deliberate role-breaking vs. another parallel Vitest worker's
  legitimate bootstrap of the same role) and is unaffected by what mechanism the SQL file uses
  internally — not touched, not retired.
- **NOT** `.github/workflows/ci.yml`, `infra/docker-compose.yml`, `package.json` — the bootstrap
  invocation shape (`pnpm db:bootstrap`, both `psql` calls) is unchanged; only the two `.sql` files'
  internal content changes.
- **NOT** `docs/autopilot-invariant-catalog.md` — see §10 item 4; a new `definer-bootstrap` token is
  recommended as a follow-up (owner agreed — a new shared token is its own change with its own review),
  not added here (outside this slice's own scope list).
- **NOT** `docs/autopilot-backlog.md` — no entry exists for this slice yet; adding one is a separate,
  out-of-band chore commit, consistent with how every recent sibling slice (AP-47, AP-48) has handled it.

## 9. Canonical verdict

```text
REVIEW_POLICY_VERSION: 1.3
REVIEW_VERDICT: CODE_READY
REVIEWED_AT: 2026-08-05
AUTHORITY_SHA: f9016260ce168247af6d42eab2ef66a730f1c746
BASE_BRANCH: main
BASE_REMOTE_RELATION: MAIN_EQUALS_ORIGIN_MAIN
TARGET_FILES:
  - infra/postgres-init/01-job-definer.sql
  - infra/postgres-init/02-chat-definer.sql
  - packages/db/src/migrate.test.ts
  - docs/autopilot/contracts/autopilot-definer-bootstrap-cluster-wide-serialization.md
  - docs/autopilot-manifests/definer-bootstrap-cluster-wide-serialization.json
  - .claude/commands/ap-49-definer-bootstrap-cluster-wide-serialization.md
SLICE: definer-bootstrap-cluster-wide-serialization-v3
IN_SCOPE: a TWO-LAYER serialization design per file (§9.4) — an unconditional, ordinary
  pg_advisory_xact_lock (same-database, needs no privilege) taken before a fail-open (catch-and-warn)
  cluster-wide LOCK TABLE upgrade attempt, degrading loudly rather than silently where the connecting
  role lacks the privilege for the upgrade specifically; FIVE new test cases proving it (two
  cross-database LOCK TABLE cases, two same-database advisory-lock degraded-fallback cases, one
  single-caller degraded-privilege warning proof — grew from three across two review rounds, §9.4/§9.5)
OUT_OF_SCOPE: role attributes; chat_definer's existing fail-closed checks (including its inability to
  complete AT ALL under a non-superuser CREATEROLE connection for reasons unrelated to this slice's own
  serialization mechanism — §10 item 7, confirmed empirically, not a claim this slice's own SQL comments
  make or need to make); job_definer's missing re-pointing guard; the CREATEROLE auto-membership side
  effect; the operational rule's durable home; test-harness.ts; CI/compose/package.json; invariant
  catalog; backlog entry (full list §8)
G1_DECISION: PASS — the mechanism (§5), the production-privilege ceiling (§5.4.1, sourced from DO's own
  docs), and the fail-open-with-warning design (§5.4.1, owner-directed and empirically verified) are all
  resolved by evidence or explicit owner ruling this session, not left as an implementer choice
G2_SPEC: PASS — infra/core slice; reviewed technical authority = 286f48b's merge commit message (owner-
  reviewed, ACCEPTED+DEFERRED) + docs/autopilot/contracts/autopilot-chat-definer-role-provisioning.md §5.4.2/§10 (already
  merged, already reviewed) + this session's owner ruling on the production-degradation design (§5.4.1,
  §5.5)
G3_DEPENDENCY: PASS — both target files already exist and are merged on origin/main (§3, §4)
G4_TEST: PASS — exact test construction, exact assertions, exact "what makes it fail" specified in §7.4,
  including the degraded-privilege path (new case, §7.4)
G5_SCOPE: PASS — mechanism-named, negative scope explicit (§8), file count fixed at exactly the 3
  originally-scoped CODE files (`01-job-definer.sql`, `02-chat-definer.sql`, `migrate.test.ts`) plus this
  slice's own 3 process/contract artifacts (this doc, the manifest, the launcher notice) — 6 total, no new
  file/module/mechanism added outside that set at any point across every round. Exact current line counts
  are intentionally NOT pinned here: this line is itself part of the diff it would be describing, so any
  number written here is stale the instant this sentence is saved (measured directly, gate-attempt-06:
  round-05's own `1078+/95-` figure was already off by round 6 because round 5's own commit added the
  text stating it). Reproduce the live split with `git diff --numstat f9016260ce168247af6d42eab2ef66a730f1c746...HEAD`
  (code files: the three above; everything else in the output is this slice's own process artifacts). The
  global autopilot invariants' "Scope & parallelism" guidance frames file/LOC ceilings as approximate and
  explicitly "a ceiling, not a target; don't over-split cohesive low-risk work" — the growth this ceiling
  exists to catch (drift into adjacent, unrelated subsystems) did not happen: every changed line is either
  (a) inside the 3 originally-scoped code files, in direct response to real review findings (§9.5's
  CREATE-ROLE-race confound, §9.6's missing chat_definer degraded case), or (b) this slice's own required
  review evidence recording those same findings (§9.3-§9.9), not product code.
G6_EXTERNAL: PASS — no PII/money/legal/provider gate; not user-facing
HARD_DEPENDENCIES: none — both files already merged (§4)
PRIOR_SLICES: chat-definer-role-provisioning (AP-47, merged) -> this slice (closes its own §10 items 8-9
  deferral) — job_definer's own bootstrap (pre-existing, no contract doc) is the other target
OPEN_QUESTIONS_IN_SCOPE: 0
ENABLEMENT_ONLY_GATES: none
LIVE_REPO_VERIFICATION: PASS
CONTRACT_MATRIX: PASS
CLOSURE_MATRIX: PASS — 12/12, see §9.1
ACCEPTANCE_MATRIX: PASS
SECURITY_AND_MIGRATION_GATE: PASS
IMPLEMENTATION_ARTIFACTS: PASS
FIRST_IMPLEMENTATION_STEP: implementation is COMPLETE on `feat/definer-bootstrap-cluster-wide-
  serialization-v3` (both SQL files, all five test cases, contract artifacts — see §9.4/§9.5 for the
  two prior review rounds' fixes). The remaining step is procedural, not implementation: achieve 2
  CONSECUTIVE clean `scripts/codex-review-pin.sh` rounds via `scripts/autopilot-scope-gate ready
  --manifest .autopilot/state/definer-bootstrap-cluster-wide-serialization-v3/manifest.json`, plus the
  required security round. (Historical record, superseded: the original pre-implementation plan opened
  a worktree from `18e88f28b268c48e21d11d7ef42ac96bbe5ca396` under the bare feature slug — see §9.3/§9.4
  for why that registration was closed and replaced, twice.)
REMAINING_BLOCKERS: none (all findings from both prior review rounds fixed; awaiting the next round's
  verdict)
```

### 9.1 Closure matrix (12/12)

| # | Gate | Evidence | PASS/FAIL |
|---|---|---|---|
| 1 | Authority snapshot pin theo SHA | `286f48b` (finding/deferral) + `f9016260` (live base for the CURRENT v3 registration — advanced from the originally-authored `18e88f28b` per §9.3/§9.4's base-sync invariant; both authoring-time and current SHAs verified 2026-08-05); production privilege ceiling sourced from DO's own docs the same session | PASS |
| 2 | Decision trong scope đã chốt | The mechanism, the production-degradation design, and the operational backstop are all resolved — by measurement (§5) or explicit owner ruling this session (§5.4.1, §5.5), not left open | PASS |
| 3 | Scope IN/OUT và owner rõ | §7 (exact diffs), §8 (negative scope, expanded to name the two new out-of-scope findings) | PASS |
| 4 | Dependency phân loại đủ | §4 — zero executable dependencies, both files already merged | PASS |
| 5 | Live schema/code khớp doc | §3 — every claim verified against the live cluster, live files, live docs, and DO's own external documentation | PASS |
| 6 | Data/API/state/auth contract đủ | §7.1-7.2 exact SQL including exception handling; no new API/schema surface | PASS |
| 7 | Fail-closed/idempotency/order đủ | §5.4.1 (fails OPEN with a loud, specific warning on the one privilege gap that exists in production, fails CLOSED — whole-transaction abort — on every other error class); §7.1-7.2 (idempotent replay unaffected) | PASS |
| 8 | Open question trong scope = 0 | The three original "what has to be settled" questions plus the two new ones this revision raised (production privilege ceiling; what to do when the lock can't be taken) are all answered with evidence or explicit ruling in §5, §7.4, §7.3 | PASS |
| 9 | Acceptance matrix có expected result | §7.4 (historical three-case plan) + §9.4/§9.5 (what actually shipped: all FIVE new cases, exact setup/assertion/mutation-test result for each); existing acceptance rows unaffected except case 14's stale comment (fixed, §9.5) | PASS |
| 10 | Migration/security/rollback pin | §6 (no migration); §5.4/§5.4.1 (security cost measured, degradation behavior specified and tested); rollback = revert the diff per file, trivial | PASS |
| 11 | First slice có hard dependency merged | §4 — no dependency to merge; this slice's own two target files are the lowest unbuilt node (the deferred fix itself) | PASS |
| 12 | Implementation handoff sẵn sàng | This doc + manifest + launcher; §7.1/§7.2 give exact, live-synced SQL; §7.4 is the historical plan, superseded by §9.4/§9.5/§9.6 for the actual five-case, two-layer implementation and its own three review rounds | PASS |

12/12 PASS. Verdict: **`CODE_READY`**.

### 9.2 A structural asymmetry this verdict corrects, worth carrying past this slice

`286f48bbbd5b9f41c3e63e5f201ecfd276706bff`'s merge commit message asserted the `SERIALIZABLE`-isolation
candidate (§5.2) from plausibility, not measurement — written in good faith, never tested against a live
cluster before being committed. A merge commit message is immutable and unreviewed after the fact: nothing
re-checks it once it lands, and nothing enforces that a mechanism it names was ever verified. A mistake
recorded there propagates indefinitely — this slice's own original task briefing cited it as the likely
fix before it was tested here (§10 item 5). A document like this one can still be wrong, but it can also
still be reopened, corrected, and re-verified; a commit message cannot. The lesson generalizes past this
one commit: **a technical claim about a mechanism's guarantee belongs in something that can be corrected
if it will ever be relied on again without being re-tested — not solely in a commit message.** Worth
remembering the next time a deferral names a candidate fix it has not measured.

### 9.3 Implementation-time correction: the §7.1 SQL as originally authored did not parse, and checks 7-8 conflicted with §7.1's own text

This document's own note in §0 ("**Authoring-only packet** ... no code changed") turned out to matter:
the exact SQL text this document specified in §7.1 was never executed before being marked `CODE_READY`.
Two defects surfaced the first time it was, both found empirically against a live Postgres 16 cluster
during implementation (2026-08-05), before any commit landed on the implementation branch, per this same
document's own standing rule to measure rather than assume.

**Defect 1 — dollar-quote tag collision (a real syntax error, not a style question).** §7.1 nested a
`DO $$ ... $$;` block inside the existing outer `DO $$ ... $$;` block, both using the bare empty
dollar-quote tag. PostgreSQL closes a dollar-quoted string at the FIRST subsequent occurrence of the same
tag, regardless of nesting intent — so the inner block's own opening tag closed the OUTER block's string
right there, and the rest of the outer block was left as unparsable top-level SQL. Confirmed directly:
running the literal §7.1 text against `postgres:16-alpine` (this project's own local cluster) failed with
`syntax error at or near "BEGIN"` at the inner block's own `BEGIN`. Confirmed the fix the same way: a
distinct inner tag (`$lock$`) parses and executes correctly, including the full degraded-path scenario
(a `doadmin`-attribute-shaped role: `LOCK TABLE` fails with `insufficient_privilege`, `RAISE WARNING`
fires, the outer block continues to completion, the transaction commits). §7.1 and §7.2 now show the
corrected text; the implementation matches it exactly.

**Defect 2 — `verification.focused` checks 7-8 forbade what §7.1 itself requires.** The registered
manifest's checks 7 (`! grep -q 'pg_advisory_xact_lock' ...`) and 8
(`! grep -qi 'SERIALIZABLE isolation with caller-side retry' ...`) assert those two strings are absent
from `02-chat-definer.sql` — but §7.1's own mandated rationale comment (reused verbatim in §7.2) names
`pg_advisory_xact_lock` explicitly (to explain it is documented database-local) and quotes the disproven
`"SERIALIZABLE isolation with caller-side retry... exists in principle"` claim explicitly (to correct
it) — exactly the durable-correction behavior §9.2 above argues for. A blanket substring check cannot
distinguish "the retired mechanism is still live" from "the retired mechanism is named and refuted in an
explanatory comment"; as written, checks 7-8 would fail against a correct implementation of this
document's own §7.1. Corrected: checks 7-8 now match the retired *statement forms*
(`PERFORM pg_advisory_xact_lock(` and the unqualified `A cluster-wide fix exists in principle
(SERIALIZABLE isolation` claim as it appeared standalone, not quoted-and-attributed) rather than the bare
substrings — see the runtime manifest and `docs/autopilot-manifests/definer-bootstrap-cluster-wide-
serialization.json`.

Neither defect changes the mechanism, the design, or any G1-G6/closure-matrix conclusion in §9 — both are
corrections to how the already-reviewed design was expressed (in SQL syntax and in a grep pattern), not
to the design itself. The registration this document's contract first shipped under was closed via
`ap-finish.sh --authorized-close` (disposition on file) rather than hand-edited, because the runtime
manifest was already hash-locked; the branch `feat/definer-bootstrap-cluster-wide-serialization` (single
commit `a54dce4`) is retained as forensic reference for the exact empirical findings above. Implementation
continued under `feat/definer-bootstrap-cluster-wide-serialization-v2` with a freshly registered manifest
carrying the corrected checks.

### 9.4 Round 1 codex review (2026-08-05): a real regression found and fixed, and current registration state

The v2 registration's first `scripts/codex-review-pin.sh` round (`gate-attempt-01-code-review-round-01.txt`)
returned two findings, both legitimate and both addressed in the same round rather than argued with —
consistent with this document's own §9.2 lesson about trusting measurement over an unmeasured claim.

**[P1] — a real regression, not a false positive.** The original LOCK-TABLE-only design (§7.1/§7.2)
gives the connecting role ZERO serialization on the one host it cannot mechanically take the lock on —
the actual DigitalOcean production host, confirmed §5.4.1. For `job_definer` that is a strict improvement
over its prior state (it had NOTHING before this slice). For `chat_definer` it is a REGRESSION: its prior
mechanism, `pg_advisory_xact_lock`, needs no elevated privilege at all and would have kept providing
same-database serialization on that exact degraded connection — removing it in favor of a mechanism that
provides nothing when degraded made the production path strictly WORSE, not better, on the file this
whole slice exists to harden. Neither the original contract's §5.1 candidate-elimination table nor the
owner ruling in §5.4.1/§5.5 considered a LAYERED design (this document's own oversight, not measured
incorrectly like §5.2's SERIALIZABLE claim — simply not considered).

**Fix, both files, §7.1/§7.2 updated in place:** an unconditional `pg_advisory_xact_lock` call is taken
FIRST, before the LOCK TABLE attempt — `chat_definer` restores its original key (`1667525739`, `"cdlk"`);
`job_definer` gains a new equivalent (`1784966251`, `"jdlk"`). On a superuser connection both locks are
held (redundant, harmless). On a degraded connection, only the advisory lock holds — same-database
serialization is now guaranteed on every host, superuser or not; the LOCK TABLE attempt remains the
cluster-wide UPGRADE when the connection can take it. A new regression test (`packages/db/src/
migrate.test.ts`, "N=2 concurrent DEGRADED (non-superuser) bootstrap calls against the SAME database
still serialize via the same-database advisory-lock fallback...") proves two genuinely concurrent
degraded callers targeting the same database now serialize correctly — mutation-tested the same way as
the other concurrency cases (the advisory-lock statement temporarily replaced with `NULL`, confirmed the
test goes red, restored, confirmed green again).

> ⚠ **Superseded by round-02 codex review (SS9.5) — corrected 2026-08-05, gate-attempt-05:** "confirmed the
> test goes red" above originally continued "via `withSyntheticRaceWindow`'s own marker guard," describing
> how this mutation test's red result was produced AT THE TIME this section was written. SS9.5 found that
> claim was never actually sound (the marker guard proves only that the guard itself fires, not that the
> TIMING assertion depends on the lock) and changed the helper's sleep-injection anchor as part of its fix
> — after which this exact test's mutation-test red result is produced by the ELAPSED-TIME assertion
> failing (observed ~2020ms against a >3000ms serialization threshold), not the marker guard. The evidence
> claim above is corrected to match; see SS9.5 for the full mechanism change and why the original method
> was insufficient.

**[P2] — contract artifacts not synchronized to the live registration.** This document's own §9 verdict
block and the launcher command file (`.claude/commands/ap-49-definer-bootstrap-cluster-wide-
serialization.md`) still referenced the retired v1 worktree, branch, and `base_sha`
(`18e88f28b268c48e21d11d7ef42ac96bbe5ca396`) after implementation had already moved to v2 — §9.3 recorded
*why* the move happened but never updated the machine-readable verdict block itself, and the launcher's
own registration-mechanics section still named the v1 feature slug. Fixed: §9's `AUTHORITY_SHA` and
`TARGET_FILES` now match the live registration; `FIRST_IMPLEMENTATION_STEP` is marked historical with a
pointer to this section; the launcher's registration mechanics now name the current feature slug.

**Why this forced ANOTHER close-and-re-register cycle (v2 → v3).** `verification.focused` check 7
originally asserted `pg_advisory_xact_lock` was ABSENT from `02-chat-definer.sql` (the correct assertion
for the design as it stood when v2 was registered); the fix above makes it PRESENT again by design, so
that check would now permanently fail against the corrected code. A new check 9 was also needed (asserting
`job_definer`'s new key is present). Both are `verification.focused` changes to an ALREADY hash-locked
runtime manifest — the same structural gap §9.3 hit the first time (level3-workflow.md §8, "no path into
a hash-locked registration"). Closed via `ap-finish.sh --authorized-close` again; branch
`feat/definer-bootstrap-cluster-wide-serialization-v2` (this round's commits) retained as forensic
reference. Implementation continued under `feat/definer-bootstrap-cluster-wide-serialization-v3`.

### 9.5 Round 1 codex review on the v3 registration (2026-08-05): test-construction rigor, not design

Unlike §9.3/§9.4, none of this round's findings needed a `verification.focused` change, so this round
landed as a plain follow-up commit on `feat/definer-bootstrap-cluster-wide-serialization-v3` — no v3 → v4.

**[P1] Two concurrency tests could pass green even if the lock under test did nothing.** The job_definer
degraded-fallback case and the chat_definer cross-database case both started from a HIDDEN (fully absent)
role — exactly the false-confidence shape case 14's own comment already documents for a different test:
both racing callers' first write is block 1's `CREATE ROLE`, and PostgreSQL's own unique-index insert
alone forces the loser to block until the winner's ENTIRE transaction (including its injected sleep)
commits, regardless of whether either lock statement does anything at all. The round-01 mutation-test
evidence for these two cases only proved `withSyntheticRaceWindow`'s own marker-guard fires when the lock
statement's text is removed — never that the TIMING assertion itself depends on a lock being held. Fixed
two ways together: (a) pre-create the role before the race window (bare/committed via `admin` for
chat_definer, mirroring case 14's own established fix for the identical confound; via the SAME degraded
role that races, for job_definer, so it retains the PG16 auto-granted ADMIN OPTION needed to grant to
itself, §5.4.2); (b) moved `withSyntheticRaceWindow`'s sleep injection off the lock statement's own text
entirely, onto `JOB_DEFINER_RACE_ANCHOR` / `CHAT_DEFINER_RACE_ANCHOR` — the first statement after BOTH
lock attempts, unrelated to either one's text — so removing/neutralizing either lock statement now leaves
the injection point intact and produces a genuine, meaningful red on the timing assertion.

**[P1] The round-1 regression fix had no dedicated behavioral test for chat_definer's own restored
advisory lock — only a grep check and job_definer's sibling case.** Added a new same-database
degraded-concurrency case for chat_definer. It pre-creates chat_definer via the SUPERUSER `admin`
connection specifically (not the degraded role that races) — this means neither racing caller has ADMIN
OPTION on chat_definer (only its actual creator would), so both are expected to fail at the final `GRANT`
step via ordinary PostgreSQL permission semantics, deliberately different from and avoiding §10 item 7's
separate, pre-existing bug (which only fires when the degraded caller is itself chat_definer's creator).
The TIMING proof is unaffected by which failure mode follows it — it depends only on the advisory lock.

**[P2] New tests' cleanup was not failure-safe.** `REVOKE`/`DROP ROLE` for job_definer sat after
assertions, not in their own `finally` — if an assertion threw, cleanup was skipped, `hideRealJobDefiner`'s
own rename-back then collided with the orphaned scratch role, masking the original failure and leaking
cluster-global role state to whichever test or test file ran next. Fixed at the source rather than
per-test: hardened `hideRealJobDefiner` itself to unconditionally revoke-and-drop in its own `finally`,
mirroring `hideRealChatDefiner`'s existing pattern (verified safe against `hideRealJobDefiner`'s other
four call sites — JCL-2a/2b/3-cause/JCL-3b — none of which rely on a scratch job_definer surviving past
it). All per-test explicit cleanup for job_definer was then removed as redundant.

**[P2] §7.1/§7.2, this document's own test-count claim, and one test comment all still described the
original (pre-round-1) design.** §7.2 told a reader to *remove* chat_definer's advisory lock and called
its key "retired," directly contradicting §9.4 and the restored code; §7.4 said "three new test cases"
against a diff that (by this round) has five; a case-14 comment still claimed `02-chat-definer.sql` "no
longer uses" `pg_advisory_xact_lock`, when it is the exact mechanism that test still exercises today. All
corrected — §7.1/§7.2 now carry a superseded notice plus the live SQL text (kept in sync, unlike §7.4's
longer test-construction spec, which is marked historical with a pointer to the actual test file).

### 9.6 Round 2 (gate attempt 2) codex review on the v3 registration (2026-08-05): surviving-imprecision cleanup

A much narrower round than §9.5 — one real bug and a handful of stale references §9.5's own edits missed,
none touching design, mechanism, or `verification.focused`.

**[P1] The authored contract's `stop_conditions` and `security_review.reason` still made a blanket claim
that no longer held.** Both said, in effect, "every new concurrency test must fail if `LOCK TABLE` is
removed" — true for the two CROSS-DATABASE cases, but false for the two SAME-DATABASE degraded-fallback
cases added in §9.4/§9.5, which are specifically designed to keep working via the advisory lock when
`LOCK TABLE` is already failing (the degraded scenario they exist to test). The runtime manifest already
carried more careful wording ("its own lock statement") from the v3 registration itself — it was simply
never copied back into the authored contract, which is what a reviewer actually reads. Fixed: both fields
now name which lock each test pair depends on, and a new explicit stop condition names the CREATE-ROLE-race
confound §9.5 fixed, so a future regression of that specific bug is called out by name rather than folded
into a generic "test proves nothing" line.

**[P2] Four smaller stale references survived §9.4/§9.5's own edits.** A hardcoded path typo in
`02-chat-definer.sql`'s own comment (`autopilot-definer-cluster-wide-serialization.md`, missing
`bootstrap-`) pointed at a file that has never existed. The authored manifest's `_scope_note` still said
"three new cases." §3's evidence table still asserted `chat_definer`'s advisory-lock key was "retired and
becomes free," which §9.4 already contradicted three sections later in the same document. §9's own
`FIRST_IMPLEMENTATION_STEP` — inside the ACTIVE verdict block, not a historical aside — still described
opening a worktree from the retired `18e88f28b` base, marked "historical" but left standing as the only
thing that field said, which does not read as an actionable next step. All four fixed at the source
(broken path corrected; count corrected; table row corrected with an explicit forward-pointer instead of
silently rewritten; `FIRST_IMPLEMENTATION_STEP` rewritten to describe the actual current state — 2
consecutive clean review rounds remaining, not a return to round zero).

**Why no v3 → v4 this time.** None of the above touches `verification.focused` or `verification.canonical`
in the RUNTIME manifest (`.autopilot/state/.../manifest.json`, hash-locked at registration) — only the
AUTHORED contract's prose fields (`stop_conditions`, `security_review.reason`, `_scope_note`), this
document, and one SQL comment's file path. The hash-lock has nothing to say about files it doesn't cover.

### 9.7 Round 3 (gate attempt 3) codex review on the v3 registration (2026-08-05): the active verdict block itself, exhaustively

Two [P1]s, both real, both narrow. **The `02-chat-definer.sql` TWO-LAYER comment, copied from
`01-job-definer.sql` almost line-for-line per §7.3's own established convention, carried one sentence
that does not transfer**: "the rest of this bootstrap does not need superuser" is TRUE for job_definer
(its overall bootstrap does complete under a doadmin-shaped connection) but FALSE for chat_definer (§10
item 7's own pre-existing, separate bug still refuses it unconditionally) — fixed by scoping the claim to
the LOCK statement specifically and naming the separate bug inline, rather than letting the mirrored
sentence imply an overall-success guarantee this slice never made and cannot make. **The active §9
verdict block and §9.1 closure matrix — the part of this document actually meant to be exhaustively
current — still carried "three tests" and the retired `18e88f28b` base in three more places each of
§9.4/§9.5/§9.6 individually fixed elsewhere but never swept for.** Rather than fix only the two cited
lines, this round grepped the whole document for both patterns and fixed every occurrence outside
deliberately-historical narrative (§0/§2's own time-stamped session record; §9.4/§9.5/§9.6's own "here is
what used to be wrong" quotes) — `SLICE`, `IN_SCOPE`, `OUT_OF_SCOPE`, and closure rows 1/9/12. Again no
`verification.focused` change.

### 9.8 Round 4 (gate attempt 4) codex review on the v3 registration (2026-08-05): the root cause of rounds 3-4, fixed structurally

The recurring shape across rounds 3 and 4 — a claim that "the bootstrap succeeds" reads as unqualified in
some paragraph written before §10 item 7's discovery — is one root cause, not three unrelated bugs: §5.4.1
(and §3's evidence-table row backing it) describe a GENERIC probe's result in general terms ("the
bootstrap's actual work... does run on the production host"), authored and TRUE at the time, before
implementation (with the literal files) found chat_definer's separate blocker. Round 3 fixed
`02-chat-definer.sql`'s own mirrored comment; this round fixes the SOURCE section the SQL comment was
itself derived from — §5.4.1 now carries an explicit, prominent correction paragraph naming exactly which
claims apply to which file, and §3's own evidence-table row underneath it points to the same correction,
rather than leaving readers to find the fix in a different section than the claim.

Also fixed [P2]: `G5_SCOPE`'s closure-matrix line still claimed "2 files + 1 test file, well under
budget" against a diff that has grown, across three real review rounds, to six files (exact figure
measured and corrected in SS9.9 below, after gate-attempt-05 found this round's own first attempt at a
number was itself imprecise and mis-cited its source — see SS9.9). Rather than treat the growth as scope
creep, the line was rewritten to state why it is legitimate (real fix rounds on one cohesive,
mechanism-named unit, not drift into adjacent subsystems). The manifest's `context_sources` array is now
explicitly marked AS-OF-AUTHORING where it described pre-diff file state. The launcher's own stale
mechanism-description paragraph is named explicitly in the status notice as NOT corrected, per the
standing owner bound on that file, with a pointer to where the current design actually lives.

### 9.9 Round 5 (gate attempt 5) codex review on the v3 registration (2026-08-05): G5's own enum, measurement, and citations were wrong; SS9.4's mutation-test claim was stale

No P1s this round — two [P2]s, both about this document's own accuracy rather than the mechanism:

**[P2] `G5_SCOPE` used a non-canonical value and unsupported numbers.** Round 4's fix invented
`PASS WITH DOCUMENTED EXCEPTION`, but `docs/standards/review-code-readiness-gate.md`'s own verdict
template permits only `PASS | PARTIAL | FAIL` for G5 (and `CODE_READY` requires it strictly `PASS`, not
`PARTIAL`) — an invented fourth value is not a valid verdict regardless of how well-argued. The "~608
lines" figure also silently meant only the 3 code files, not the full 6-file diff, and two citations were
wrong: "§28" does not exist in this document (it ends at §10), and the "ceiling, not a target" quote is
from the global `autopilot-invariants.md`'s "Scope & parallelism" section, not `level3-workflow.md` §12
(§12 there is "Anti-drift rules," an unrelated topic) — the "AP-39/AP-40 convention... §8/§28" clause
citing it was fabricated; §8 (Negative scope) says nothing of the kind. Fixed: `G5_SCOPE` now reads `PASS`
(the canonical enum), backed by the split measured AT THIS ROUND — `git diff --stat
f9016260ce168247af6d42eab2ef66a730f1c746...HEAD`: 6 files, 1078(+)/95(-); the 3 originally-scoped code
files alone at 639 lines (608+/31-), the slice's own 3 process artifacts at 534 lines (470+/64-) — with
the correct citation and the fabricated clause removed rather than re-sourced, since no such convention is
recorded anywhere in this document. (This exact split was itself stale one round later — gate-attempt-06
measured 1130(+)/95(-) once round 5's own commit landed, since that commit added the text stating the
prior number. §9's live `G5_SCOPE` line no longer pins a number for this reason; treat the figures in
this paragraph as a historical record of what round 5 measured, not a current claim.)

**[P2] SS9.4's mutation-test evidence described a mechanism SS9.5 later replaced.** SS9.4 said the
round-1 same-database degraded-fallback test was confirmed red via `withSyntheticRaceWindow`'s marker
guard. SS9.5 (this same document, written later) found that method unsound and changed the helper to
anchor its sleep injection after both lock attempts instead — so by the time SS9.4 was read in this
round, its own claim no longer matched what the current helper actually does for that test. Fixed at
SS9.4 directly with a dated correction notice (matching the pattern already used at SS7.2 and SS3) rather
than silently editing the original claim, so the document's own history of what was believed when stays
legible.

Both fixes are corrections to this document's self-description, not to the mechanism under review — the
two SQL files and five tests have been unchanged, and unflagged, since SS9.4's original fix landed.

## 10. Open items (non-blocking — do not read as `CODE_READY` blockers)

1. **RESOLVED this revision (was open item 1 in the prior version): production superuser availability.**
   DigitalOcean Managed PostgreSQL is confirmed, from DO's own documentation, to never grant superuser
   (§2, §3). This is no longer an unverified stop condition — it is a known constraint the design in
   §5.4.1 responds to directly (fail open, loud warning, operational backstop in §5.5).
2. **NEW this revision: the `CREATEROLE` auto-membership side effect (§5.4.2) needs a name in the
   implementer's own memory, not just this doc.** The first time this bootstrap runs on production with an
   explicit `MIGRATION_ROLE` different from the connecting identity, `chat_definer`'s re-pointing guard
   will reject it, correctly, for a reason that will look surprising without this section. Not fixed here
   (§8) — worth a one-line pointer to §5.4.2 wherever the production `MIGRATION_ROLE` decision actually
   gets made, so that decision is made with this fact in hand rather than discovered by the rejection.
3. **NEW this revision: the operational rule in §5.5 has no enforced home yet.** It is owner-directed and
   recorded here, but nothing currently prevents two people (or two deploy pipelines) from running this
   bootstrap concurrently against the production cluster. Recommend a follow-up that either adds this rule
   to `docs/standards/deployment-infra.md`'s existing process/role documentation or encodes it as an actual
   CI/CD guard (e.g., a deploy-pipeline concurrency lock on the bootstrap step specifically) — outside this
   slice's file scope, not done here.
4. **No `docs/autopilot-invariant-catalog.md` token precisely fits "privileged cluster-role bootstrap
   infra."** `schema` ("tables, migrations, RLS policies") does not fit — this slice touches none of the
   three. `auth` is a closer conceptual fit but would unnecessarily serialize this slice against the
   currently-active Auth S4 email-bundle work, which touches none of this slice's files. Owner agreed:
   leave `invariants: []` and propose a dedicated `definer-bootstrap` token as its own, separately-reviewed
   change — adding a token changes what every future slice can declare, which belongs in its own review,
   not folded into this one.
5. **The `SERIALIZABLE`-isolation claim's origin and correction, stated plainly per owner request.** The
   claim that a cluster-wide fix "exists in principle" via `SERIALIZABLE` isolation with caller-side retry
   originated in the merge commit that deferred this fix (`286f48bbbd5b9f41c3e63e5f201ecfd276706bff`) and
   was carried into `docs/autopilot/contracts/autopilot-chat-definer-role-provisioning.md` §10 item 8 — plausible, not tested
   at the time it was written. §5.2 of this document tested it directly against a live cluster and found
   it false: two concurrent `SERIALIZABLE` transactions from different databases both committed conflicting
   grants with no serialization failure. `02-chat-definer.sql`'s own copy of the claim is removed as part
   of this slice's diff (§7.2). The merge commit's message is immutable git history and cannot be
   corrected in place — this document is the only durable place that records the correction. See §9.2 for
   why this asymmetry (commit message vs. correctable document) generalizes past this one finding.
6. **This slice's own empirical measurements (mechanism selection, §5; fail-open design, §5.4.1;
   auto-membership finding, §5.4.2) are against `postgres:16-alpine` specifically** (the exact image
   `infra/docker-compose.yml` runs) and against a scratch role built to mirror `doadmin`'s documented
   attribute set, not against a live DigitalOcean Managed PostgreSQL instance. The lock-mode conflict
   semantics (`SHARE UPDATE EXCLUSIVE` vs `ROW EXCLUSIVE`, §5.4) and the `CREATEROLE`-auto-membership
   behavior (§5.4.2) are standard, documented PostgreSQL 16 behaviors and not expected to differ on a
   managed host running the same major version, but neither was cross-checked against DO's actual managed
   offering directly. Worth a one-time live confirmation the first time this mechanism is actually deployed
   there, not a blocker to authoring or implementing it.
7. **CRITICAL, discovered during implementation (2026-08-05): `chat_definer`'s bootstrap cannot complete
   under ANY non-superuser CREATEROLE scenario — meaning it cannot succeed on the real target production
   host (DigitalOcean Managed PostgreSQL, `doadmin`, no true superuser) at all, regardless of this slice.**
   This is a materially more severe correction to §5.4.2's own "benign when `MIGRATION_ROLE` is unset"
   conclusion, found by `packages/db/src/migrate.test.ts`'s new "both files, degraded path" test case (the
   one this slice's own manifest required) actually running the complete, unmodified `02-chat-definer.sql`
   end to end as a `doadmin`-shaped role — the original `SS5.4.1` probe used a simplified, generic
   create/lock/grant sequence, never the literal file, and so never exercised chat_definer's OWN
   `chat-definer-role-provisioning`/AP-47 fail-closed checks against the PG16 auto-membership side effect
   (§5.4.2) they predate. Three natural scenarios, all tested empirically this session, all blocked:
   - **Self-targeting fresh creation** (unset `MIGRATION_ROLE`, the common/documented default case):
     chat_definer's own "unsafe membership options" check (added by AP-47's codex round-04, unrelated to
     this slice) sees its OWN just-created PG16 auto-granted ADMIN-OPTION record on the connecting role
     and refuses with "existing membership for % has at least one unsafe grant record."
   - **Different-target fresh creation** (explicit `MIGRATION_ROLE` set to some other role): chat_definer's
     "re-pointing" guard refuses instead, reading that SAME auto-grant as "already granted to" a different
     role than the target.
   - **Re-run against an ALREADY-EXISTING chat_definer** created by a different, earlier (e.g. superuser)
     connection: ordinary PostgreSQL refuses the `GRANT chat_definer TO ...` statement itself —
     `permission denied to grant role "chat_definer" ... Only roles with the ADMIN option ... may grant
     this role` — since the non-superuser connecting role was never the creator and so never received
     ADMIN OPTION on chat_definer at all.
   **Not fixed here** — this slice's negative scope is the serialization mechanism only, not chat_definer's
   existing fail-closed checks (unsafe-options, re-pointing) or ordinary PostgreSQL GRANT/ADMIN-OPTION
   semantics, and a fix here would need to touch exactly the checks this slice is forbidden from touching.
   What this slice's own mechanism IS responsible for, and does correctly even in this scenario: the LOCK
   TABLE statement itself still degrades loudly (RAISE WARNING, no silent no-op, no abort AT THAT
   STATEMENT) before the separate, pre-existing check refuses the overall bootstrap — proven by the same
   test case, whose assertions pin this exact reality rather than an assumed success. **Recommended
   follow-up, not started**: chat_definer's bootstrap needs its own dedicated fix for the production
   (non-superuser CREATEROLE) path — most likely, revoking/normalizing the PG16 auto-granted membership
   immediately after `CREATE ROLE` (block 1) succeeds, before block 3's checks ever see it, so a fresh
   creation by a non-superuser CREATEROLE role converges to the same clean state a superuser's creation
   already produces. This is a genuinely new design question (not a small edit) and should be scoped and
   reviewed as its own slice, at higher urgency than typical backlog priority given it blocks the ENTIRE
   in-app-chat primary-player-surface plan's production path. `job_definer` is NOT affected (it has neither
   the "unsafe options" nor the "re-pointing" check, so its self-targeting fresh-creation path completes
   correctly even under this same auto-membership side effect — confirmed by the same test case).
8. **NEW this revision (codex round-06, gate-attempt-06): `job_definer`'s bootstrap issues a bare `GRANT
   USAGE ON SCHEMA public TO job_definer;` as its FINAL statement, outside any `DO` block — under a
   non-superuser `CREATEROLE` connection (the same `doadmin`-shaped scratch role used throughout §5.4.1
   and this section), that specific `GRANT` silently no-ops with PostgreSQL's own native WARNING ("no
   privileges were granted for \"public\""), rather than throwing.** Discovered by
   `packages/db/src/migrate.test.ts`'s "both files, degraded path" test actually running the complete,
   unmodified `01-job-definer.sql` end to end (the §5.4.1 manual probe used a simplified sequence, not this
   exact file, so never exercised this specific final statement). This means that on the real target
   production host (DigitalOcean Managed PostgreSQL, `doadmin`), `job_definer` ends this bootstrap WITHOUT
   `USAGE` on the `public` schema — silently, since the transaction still commits (the membership grant
   this slice's own mechanism cares about is unaffected and succeeds). **Not fixed here** — this slice's
   negative scope is the serialization mechanism only, and this statement predates it, unedited. What the
   test proves and is responsible for: the mechanism this slice added does not mask or interact with this
   pre-existing no-op; the DEGRADED warnings it asserts on are the lock-specific ones, not this schema-usage
   one. **Recommended follow-up, not started**: either grant schema usage as part of the eventual production
   `MIGRATION_ROLE` setup out-of-band (a one-time manual grant, since it doesn't need to be idempotent
   bootstrap logic), or move this `GRANT` inside a privilege-aware conditional the way block 3's membership
   grant already is. Lower urgency than item 7: schema `USAGE` absence would surface as a clear permission
   error the first time `job_definer` is actually used to run a migration, not as a silent data-integrity
   gap.
