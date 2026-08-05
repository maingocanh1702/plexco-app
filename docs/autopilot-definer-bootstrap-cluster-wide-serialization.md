<!-- review-readiness: code-ready -->
# AP-49 — definer-bootstrap-cluster-wide-serialization: give both definer bootstraps a real cluster-wide lock

> **Status:** `CODE_READY` (see verdict, §9) · **Authored:** 2026-08-05, **revised same day** after owner
> review resolved the production-privilege question (§5.4.1) and surfaced a second-order finding (§5.4.2)
> · **Risk:** P1 (corrected from the task's proposed P2 — see §0.1) · **Authoring-only packet** (no
> worktree, no register, no code changed).

## 0. Session input

```text
REQUEST: final-readiness (authoring, not implementation)
TARGET_FILES:
  - infra/postgres-init/01-job-definer.sql (live, no cluster-wide lock of any kind today)
  - infra/postgres-init/02-chat-definer.sql (live, same-database-only pg_advisory_xact_lock today)
  - packages/db/src/migrate.test.ts (live, 1956 lines at base)
  - 286f48bbbd5b9f41c3e63e5f201ecfd276706bff (merge commit that recorded and deferred this finding)
  - docs/autopilot-chat-definer-role-provisioning.md §5.4.2, §10 items 8-9 (the deferred boundary)
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
- **Deferral text:** `docs/autopilot-chat-definer-role-provisioning.md` §5.4.2 (comment inside
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
| Multiple databases already coexist in one cluster, today, not hypothetically | `docker exec plexco-postgres-1 psql -U plexco -d plexco -c "SELECT datname FROM pg_database"` | 16 databases: `plexco`, `plexco_test`, `postgres`, `template0/1`, plus 10 leftover test-scratch databases (`plexco_auth_check`, `plexco_jrd_dispatcher_stale_stops_cycle`, etc.) — corrects `docs/autopilot-chat-definer-role-provisioning.md:866`'s claim of "no evidence anywhere in the codebase of a multi-database-per-cluster topology"; that evidence exists in this project's own dev/test setup today |
| Actual local/CI bootstrap credential's privilege level | `SELECT rolname, rolsuper FROM pg_roles WHERE rolname='plexco'` | `rolsuper = t`. `plexco` is the literal `DATABASE_URL_MIGRATION` identity in both `.github/workflows/ci.yml:76` and `infra/docker-compose.yml`'s own worker-prep comment — local dev and CI both bootstrap as a real Postgres superuser |
| Production bootstrap credential's privilege level | `docs.digitalocean.com/products/databases/postgresql/how-to/modify-user-privileges/` (fetched this session) | `doadmin`: `CREATEROLE, CREATEDB, REPLICATION, BYPASSRLS` — no `SUPERUSER`, confirmed by DO's own docs, not inferred |
| Production topology | `docs/standards/deployment-infra.md` §3-4 (topology diagram, process/role table) | Single application database (`Postgres PRIMARY + HA STANDBY`); no multi-database-per-cluster topology is planned |
| `LOCK TABLE` precedent in this codebase | `grep -rn "LOCK TABLE"` | Already used in `docs/features/BE/feature_payment_reconcile_tech.md:170` (application tables, reconciliation). Not a foreign idiom for this team — just never applied to a system catalog before |
| Existing advisory lock keys, for post-removal bookkeeping | `grep -rn "pg_advisory_lock\|_LOCK_KEY"` | `migrate.ts:31` → `0x706c7863` ("plxc"); `test-harness.ts:103` → `0x6a6f6264` ("jobd"); `migrate.test.ts` → `0x63686164` ("chad", `CHAT_DEFINER_LOCK_KEY`, a **different, unaffected** harness-level lock — see §8). `02-chat-definer.sql`'s own `0x63646c6b` ("cdlk") is retired by this slice and becomes free |
| A `doadmin`-shaped role (`CREATEROLE CREATEDB REPLICATION BYPASSRLS`, no superuser) can complete the full bootstrap sequence | Built a scratch role with exactly that attribute set on the live local cluster and ran `CREATE ROLE ... BYPASSRLS` → attempted `LOCK TABLE` → `GRANT` → `COMMIT` under it | `CREATE ROLE` succeeded (confirms `BYPASSRLS`-to-create-`BYPASSRLS` is satisfied); `LOCK TABLE` failed with `insufficient_privilege` as expected; `GRANT` succeeded; transaction committed cleanly — see §5.4.1 |
| A `CREATEROLE`-based (non-superuser) role creation has a side effect neither script accounts for | Same probe, inspected final `pg_auth_members` state | The creating role was **automatically** granted membership in the role it created, in addition to the explicitly-granted target — a PG16 behavior that never manifests today (`plexco` is superuser, which has no such side effect) — see §5.4.2 |

## 4. Dependency graph

**None executable.** Both target files are already merged on `main`. No `PRIOR_SLICE`, no `MERGED`
dependency to prove beyond "both files exist as of `BASE_SHA`" (§3, row 1).

## 5. The mechanism — measured, not assumed

Three candidates existed in the record (task notes; `docs/autopilot-chat-definer-role-provisioning.md`
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
`docs/autopilot-chat-definer-role-provisioning.md` §10 item 8):** that text asserted *"a cluster-wide fix
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

**I could not locate a document in this repo matching "tenant_provision session-cache race"** despite a
multi-angle search this session (the exact phrase; "session-cache" alone; singleton/never-concurrent/
one-place language; `cache`+`tenant` combinations; `packages/db/src/auth.ts`; `docs/dd-46-skip-club-
analysis.md`) — flagging this rather than presenting a citation I have not actually read. This section
records the ruling's shape as given in this conversation (owner authority, 2026-08-05), not as a
citation of a prior written ruling. The closest **located** precedent for "serialize a hard-to-lock shared
resource by rule rather than by mechanism" is `tenant_get_or_create_personal`'s own `persons`-row `FOR
UPDATE` lock taken jointly with the merge path (`docs/dd-46-skip-club-analysis.md:75`, `docs/standards/
decisions.md:594`) — a mechanical lock, not an operational one, so it is not the same shape; noted only as
the nearest thing found, not as the referenced precedent itself.

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

Add the following as the **first statement inside** the existing membership `DO $$ ... BEGIN` block
(before the `IF v_grant_to IN ('app', 'app_worker', 'readonly')` check), so the lock attempt — successful
or degraded — precedes the runtime-role-target check, the `GRANT`, and the post-grant transitive
re-check:

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
  -- SS5.4.1). On a host where this lock cannot be taken, cluster-wide safety depends on an OPERATIONAL
  -- rule instead: this bootstrap runs from exactly one place, never concurrently, against that cluster --
  -- see docs/autopilot-definer-bootstrap-cluster-wide-serialization.md SS5.5. The WARNING appearing (or
  -- not) in a given run's log is the only evidence of whether the mechanical guarantee held for that run
  -- -- this statement's mere presence in the file is not proof.
  DO $$
  BEGIN
    LOCK TABLE pg_auth_members IN SHARE UPDATE EXCLUSIVE MODE;
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE WARNING 'job_definer bootstrap: DEGRADED -- cannot acquire the cluster-wide serialization lock on pg_auth_members (insufficient privilege on this connection -- expected on a managed Postgres host with no true superuser). Proceeding WITHOUT the cross-database concurrency guarantee; this run depends on the operational single-bootstrap-point rule instead (docs/autopilot-definer-bootstrap-cluster-wide-serialization.md SS5.5).';
  END
  $$;
```

Everything else in the file is byte-identical.

### 7.2 `infra/postgres-init/02-chat-definer.sql`

**Remove** the existing `PERFORM pg_advisory_xact_lock(1667525739); -- 0x63646c6b, "cdlk" ...` line and
its entire preceding comment block (the "Serialize the whole check-then-grant..." paragraph through the
"...deliberately deferred rather than built here." paragraph, lines ~112-140 of the current file — this
is the exact text that documents the now-disproven "SERIALIZABLE isolation" escape hatch and must not
survive unedited, since it states a claim §5.2 falsifies). **Replace** with the same block used in
`01-job-definer.sql` §7.1 above, with `job_definer` renamed to `chat_definer` in both the file-identity
comment and the `RAISE WARNING` message text (matching each file's own existing self-naming convention in
every other error message) — otherwise identical (the two files already mirror each other "almost
line-for-line" per `02-chat-definer.sql`'s own header — see §7.3 for why this is duplicated rather than
shared). Position: first statement inside the membership `DO $$ ... BEGIN` block, before `v_target`/
`v_grant_to` resolution — i.e., replacing the advisory lock at the exact point it currently sits. Nothing
else in the block (the re-pointing guard, the unsafe-options check, the transitive re-check) changes.

The advisory-lock key collision-avoidance comment on the `job_definer` and `plxc`/`chad` keys elsewhere in
this file's history becomes irrelevant to `0x63646c6b` ("cdlk") specifically — that key is retired and
free; it is not reused elsewhere in this codebase (confirmed, §3), so no renumbering is needed.

### 7.3 Why duplicated, not shared

The fix is one SQL block, identical in both files except the role name in two strings. `infra/postgres-
init/` has no existing `\i`-include or shared-snippet pattern, and `02-chat-definer.sql` already
duplicates far more than this from `01-job-definer.sql` by established precedent (its own header: "mirrors
`01-job-definer.sql` almost line-for-line"). Introducing a new sharing mechanism for one block is
disproportionate (YAGNI) and would be the first of its kind in this directory. Duplicate it.

### 7.4 `packages/db/src/migrate.test.ts` — three new test cases

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
re-pointing guard** (§5.4.2's own note; §8) — that is `docs/autopilot-chat-definer-role-provisioning.md`
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
AUTHORITY_SHA: 18e88f28b268c48e21d11d7ef42ac96bbe5ca396
BASE_BRANCH: main
BASE_REMOTE_RELATION: MAIN_EQUALS_ORIGIN_MAIN
TARGET_FILES:
  - infra/postgres-init/01-job-definer.sql
  - infra/postgres-init/02-chat-definer.sql
  - packages/db/src/migrate.test.ts
  - docs/autopilot-definer-bootstrap-cluster-wide-serialization.md
  - docs/autopilot-manifests/definer-bootstrap-cluster-wide-serialization.json
SLICE: definer-bootstrap-cluster-wide-serialization
IN_SCOPE: replace/add one fail-open (catch-and-warn) LOCK TABLE statement per file (cluster-wide
  serialization of the existing check-then-grant membership sequence, degrading loudly rather than
  silently where the connecting role lacks the privilege); three new test cases proving it
OUT_OF_SCOPE: role attributes; chat_definer's existing fail-closed checks; job_definer's missing
  re-pointing guard; the CREATEROLE auto-membership side effect; the operational rule's durable home;
  test-harness.ts; CI/compose/package.json; invariant catalog; backlog entry (full list §8)
G1_DECISION: PASS — the mechanism (§5), the production-privilege ceiling (§5.4.1, sourced from DO's own
  docs), and the fail-open-with-warning design (§5.4.1, owner-directed and empirically verified) are all
  resolved by evidence or explicit owner ruling this session, not left as an implementer choice
G2_SPEC: PASS — infra/core slice; reviewed technical authority = 286f48b's merge commit message (owner-
  reviewed, ACCEPTED+DEFERRED) + docs/autopilot-chat-definer-role-provisioning.md §5.4.2/§10 (already
  merged, already reviewed) + this session's owner ruling on the production-degradation design (§5.4.1,
  §5.5)
G3_DEPENDENCY: PASS — both target files already exist and are merged on origin/main (§3, §4)
G4_TEST: PASS — exact test construction, exact assertions, exact "what makes it fail" specified in §7.4,
  including the degraded-privilege path (new case, §7.4)
G5_SCOPE: PASS — mechanism-named, negative scope explicit (§8), 2 files + 1 test file, well under budget
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
FIRST_IMPLEMENTATION_STEP: open a worktree from `18e88f28b268c48e21d11d7ef42ac96bbe5ca396` via
  `.claude/commands/ap-49-definer-bootstrap-cluster-wide-serialization.md`; write the fail-open `LOCK
  TABLE` block into `01-job-definer.sql` exactly per §7.1, then `02-chat-definer.sql` per §7.2 (verify the
  full removed comment block matches before deleting it), then the three new test cases per §7.4, in that
  order, verifying each layer before the next
REMAINING_BLOCKERS: none
```

### 9.1 Closure matrix (12/12)

| # | Gate | Evidence | PASS/FAIL |
|---|---|---|---|
| 1 | Authority snapshot pin theo SHA | `286f48b` (finding/deferral) + `18e88f28b` (live base), both verified 2026-08-05; production privilege ceiling sourced from DO's own docs the same session | PASS |
| 2 | Decision trong scope đã chốt | The mechanism, the production-degradation design, and the operational backstop are all resolved — by measurement (§5) or explicit owner ruling this session (§5.4.1, §5.5), not left open | PASS |
| 3 | Scope IN/OUT và owner rõ | §7 (exact diffs), §8 (negative scope, expanded to name the two new out-of-scope findings) | PASS |
| 4 | Dependency phân loại đủ | §4 — zero executable dependencies, both files already merged | PASS |
| 5 | Live schema/code khớp doc | §3 — every claim verified against the live cluster, live files, live docs, and DO's own external documentation | PASS |
| 6 | Data/API/state/auth contract đủ | §7.1-7.2 exact SQL including exception handling; no new API/schema surface | PASS |
| 7 | Fail-closed/idempotency/order đủ | §5.4.1 (fails OPEN with a loud, specific warning on the one privilege gap that exists in production, fails CLOSED — whole-transaction abort — on every other error class); §7.1-7.2 (idempotent replay unaffected) | PASS |
| 8 | Open question trong scope = 0 | The three original "what has to be settled" questions plus the two new ones this revision raised (production privilege ceiling; what to do when the lock can't be taken) are all answered with evidence or explicit ruling in §5, §7.4, §7.3 | PASS |
| 9 | Acceptance matrix có expected result | §7.4 — exact input/setup/assertion for all three new cases, including the degraded-privilege path; existing acceptance rows unaffected except case 14's stale comment (noted) | PASS |
| 10 | Migration/security/rollback pin | §6 (no migration); §5.4/§5.4.1 (security cost measured, degradation behavior specified and tested); rollback = revert the diff per file, trivial | PASS |
| 11 | First slice có hard dependency merged | §4 — no dependency to merge; this slice's own two target files are the lowest unbuilt node (the deferred fix itself) | PASS |
| 12 | Implementation handoff sẵn sàng | This doc + manifest + launcher; §7 gives exact, non-paraphrased SQL and precise test construction for all three cases | PASS |

12/12 PASS. Verdict: **`CODE_READY`**.

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
   was carried into `docs/autopilot-chat-definer-role-provisioning.md` §10 item 8 — plausible, not tested
   at the time it was written. §5.2 of this document tested it directly against a live cluster and found
   it false: two concurrent `SERIALIZABLE` transactions from different databases both committed conflicting
   grants with no serialization failure. `02-chat-definer.sql`'s own copy of the claim is removed as part
   of this slice's diff (§7.2). The merge commit's message is immutable git history and cannot be
   corrected in place — this document is the only durable place that records the correction.
6. **This slice's own empirical measurements (mechanism selection, §5; fail-open design, §5.4.1;
   auto-membership finding, §5.4.2) are against `postgres:16-alpine` specifically** (the exact image
   `infra/docker-compose.yml` runs) and against a scratch role built to mirror `doadmin`'s documented
   attribute set, not against a live DigitalOcean Managed PostgreSQL instance. The lock-mode conflict
   semantics (`SHARE UPDATE EXCLUSIVE` vs `ROW EXCLUSIVE`, §5.4) and the `CREATEROLE`-auto-membership
   behavior (§5.4.2) are standard, documented PostgreSQL 16 behaviors and not expected to differ on a
   managed host running the same major version, but neither was cross-checked against DO's actual managed
   offering directly. Worth a one-time live confirmation the first time this mechanism is actually deployed
   there, not a blocker to authoring or implementing it.
