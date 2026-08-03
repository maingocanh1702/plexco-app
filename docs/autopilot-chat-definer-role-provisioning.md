<!-- review-readiness: code-ready -->
# AP-47 — chat-definer-role-provisioning: bootstrap the `chat_definer` cluster role

> **Status:** `CODE_READY` (see verdict, §9) · **Authored:** 2026-08-03 · **Risk:** P1
> **This is an AUTHORING artifact.** No worktree has been opened, no `register` has been attempted, no
> code exists. It is the packet a future coding session opens a worktree from.

## 0. Session input

```text
REQUEST: final-readiness (authoring, not implementation)
TARGET_FILES:
  - docs/proposals/in-app-chat-primary-player-surface-plan-2026-07-27.md (v1.8, §9.2, §13)
  - infra/postgres-init/01-job-definer.sql (live precedent)
  - packages/db/src/migrate.ts (live, RUNTIME_ROLES/ensureRoleExists)
  - packages/db/src/migrate.test.ts (live, 1301 lines at base)
  - packages/db/src/test-harness.ts (live, job_definer bootstrap/lock helpers)
  - package.json (live, db:bootstrap script)
  - .github/workflows/ci.yml (live, CI bootstrap step)
  - infra/docker-compose.yml (live, postgres-init mount)
  - docs/autopilot-invariant-catalog.md (`schema` token)
  - docs/autopilot-dd38-dd86-chat-schema-core.md (downstream consumer, blocked on this slice)
EXPECTED_OUTCOME: CODE_READY (target); actual = CODE_READY, see §9
BASE_BRANCH: main
SCOPE_REPO: /Users/maingocanh/Projects/Plexco app
USER_AUTHORIZED_EDITS: yes (authoring this packet + manifest + launcher only; no register/worktree/code)
```

## 1. What this slice is

The first runtime slice of the in-app-chat serialized DB lane (primary-surface plan §8.3, §9 row 1,
§9.2). It idempotently bootstraps a single cluster-global Postgres role, `chat_definer`, with exact
attributes `NOLOGIN NOSUPERUSER BYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION`, and grants
membership in it to exactly one validated, non-runtime role. It creates **zero** chat tables,
functions, migrations, or API routes. It is deliberately as small and mechanical as
`infra/postgres-init/01-job-definer.sql` — the direct precedent it mirrors almost line-for-line.

It exists because `dd38-dd86-chat-schema-core`'s own root migration (already authored,
`docs/autopilot-dd38-dd86-chat-schema-core.md`, currently `NOT_CODE_READY` pending this packet) does
`ALTER FUNCTION chat_current_is_member(uuid) OWNER TO chat_definer` and
`ALTER FUNCTION dm_current_read_allowed(uuid) OWNER TO chat_definer` — statements that fail outright
if the role does not already exist with the exact right attributes. This is a **mechanical** dependency
(the DDL literally cannot apply), not a scheduling preference.

## 2. Authority pins

- **Immutable decision authority:** `90d292d85fbe92db7a5afcd118a99e28f3d3b3b7` — the in-app-chat
  primary-surface authority pack, `PLAN_READY`, closure 12/12, §9.2 pins this slice's exact executable
  packet (files, budget, acceptance, negative scope).
- **Live base (verified 2026-08-03, this session):** `git fetch origin main` + `git rev-parse
  origin/main HEAD` both return `ace61a6b95161ccaffad34f30763847cb6a7143c` = `main` = `origin/main`.
  Working tree carries only pre-existing untracked WIP (`.msg-a.txt`, `.msg-b.txt`,
  `.msg-contracts.txt`, `design.pen`, `docs/autopilot-templates/level3.1-design-discussion.md`,
  `docs/channels/web/FE/`, `docs/channels/web/docs_comparison.md`, `docs/sessions/`,
  `docs/templates/feature-dev/fe-spec-template.md`) — none touch this slice's files.
- **Why this differs from the plan's own `90d292d` pin:** `90d292d` freezes the product/design
  decision content (unchanged, still authoritative for §9.2's acceptance text). `ace61a6b9` is two
  commits ahead — `docs(autopilot): land two authored contracts at different readiness states` (which
  landed `AP-45 dd38-dd86-chat-schema-core` and `AP-46 plans-dd29-capability-registry`, both docs-only)
  plus one billing/session docs reconcile before it. Neither touches chat, schema, migrations,
  `infra/postgres-init/`, or `packages/db/src/migrate.test.ts` — confirmed by `git log --oneline -3` and
  by this packet's own live-repo verification (§3) finding the exact same facts AP-45 recorded at its
  slightly older base. No blast-radius conflict.

## 3. Live-repo verification (this session, 2026-08-03)

| Claim | Method | Result |
|---|---|---|
| `infra/postgres-init/` already exists on default branch | `ls infra/postgres-init/` | Only `01-job-definer.sql` — confirms this slice's own hard-dependency precondition (plan §13.1 row 11) is already satisfied |
| `packages/db/src/migrate.test.ts` already exists on default branch | `ls packages/db/src/migrate.test.ts` | Present, 1301 lines |
| `02-chat-definer.sql` does not exist yet | `ls infra/postgres-init/` | Confirmed absent — nothing to collide with |
| Migration tail | `ls packages/db/migrations/*.sql \| sort \| tail` | `0027_resolve_tenant_status_locked.sql`; `MIGRATION_COUNT = 28` in `migrate.test.ts` — this slice adds no migration, so both stay unchanged |
| `chat_definer` referenced anywhere yet | `grep -rn "chat_definer" packages/ infra/ .github/` | Zero hits outside this packet and `docs/autopilot-dd38-dd86-chat-schema-core.md`/its manifest (which only *consume* the not-yet-existing role) |
| `RUNTIME_ROLES` definition | `packages/db/src/migrate.ts:48` | `const RUNTIME_ROLES = ["app", "app_worker", "readonly"] as const;` — `chat_definer` correctly absent; this slice must keep it that way |
| `job_definer` bootstrap mechanism | `infra/postgres-init/01-job-definer.sql` (123 lines) + `packages/db/src/test-harness.ts:60-115` | `bootstrapJobDefiner()` reads the file via `readFile` and executes it; `withJobDefinerLock()` wraps a fixed `pg_advisory_lock(0x6a6f6264)` ("jobd") around any test that deliberately breaks the shared role; `hideRealJobDefiner()` (migrate.test.ts:459, **local to the test file, not exported from test-harness.ts**) renames the role away/back for negative-path tests |
| Existing advisory lock keys, for collision-avoidance | `grep -rn "pg_advisory_lock\|_LOCK_KEY" packages/` | `packages/db/src/migrate.ts:31` → `0x706c7863` ("plxc", migration lock); `test-harness.ts:103` → `0x6a6f6264` ("jobd"). This packet's chosen key (§5.3) collides with neither |
| CI bootstrap wiring | `.github/workflows/ci.yml:70-77` | Single step `Bootstrap job_definer role`, env `DATABASE_URL_MIGRATION` only (**no `MIGRATION_ROLE`**), runs `pnpm db:bootstrap`, precedes the `Test` step. This step is **not modified** by this slice — see §5.4 for why that is safe |
| docker-compose init-mount | `infra/docker-compose.yml:24,55-61` | `./postgres-init:/docker-entrypoint-initdb.d:ro` — a genuinely-fresh-volume convenience path that executes every file in the directory in lexical order with **no custom GUC set beforehand**. Same "safe by construction" requirement applies to the new file — see §5.4 |
| Root README documents `MIGRATION_ROLE` as optional | `grep -rn "MIGRATION_ROLE" --include="*.md" --include="*.yml" --include="*.json" .` | Only hit is `package.json`'s own script text — no doc claims optionality that this slice would make stale |
| `docs/autopilot-backlog.md` has an entry for this slice | `grep -n "chat-definer-role-provisioning" docs/autopilot-backlog.md` | Zero hits — confirmed absent, matching AP-45's own finding. Not this slice's job to add one (§7, §10) |

## 4. Dependency graph

**None executable.** Slice 0 (`docs-chat-primary-surface-contract`) is docs-only and landed at
`90d292d`. This slice's only two preconditions — `infra/postgres-init/` existing as a directory, and
`packages/db/src/migrate.test.ts` existing as a file — are already true on `main` (§3), exactly as the
plan's own closure matrix already found (`docs/proposals/...plan...md:743`: *"Slice 1
chat-definer-role-provisioning chỉ dựa infra/postgres-init/ + packages/db/src/migrate.test.ts, cả hai
đã có trên default branch | PASS"*). No `PRIOR_SLICE`, no `MERGED` dependency to prove, no
`dep_checks` entries needed.

Two slices depend **on** this one (not the reverse): `chat-dm-safety-authority-core` (slice 2, not yet
authored) and `dd38-dd86-chat-schema-core` (slice 3, authored, `NOT_CODE_READY`, blocked on this
packet landing and then being *implemented and merged* — authoring alone does not unblock it; see §10).

## 5. Scope — exact 3 files (plan §9.2)

### 5.1 `infra/postgres-init/02-chat-definer.sql` (new)

Mirrors `01-job-definer.sql` almost line-for-line — same idempotent race-safe create, same
attribute-drift fail-closed check, same transitive-runtime-membership guard, same single
`BEGIN...COMMIT` transaction (so **any** failure anywhere rolls back the whole file atomically,
including a freshly-created role — the structural mechanism that makes "fails closed without partial
grants" true for every failure mode at once, rather than needing a bespoke no-partial-state proof per
check). One deliberate, documented divergence: see §5.4.

```sql
-- ============================================================================
-- 02-chat-definer.sql
-- Privileged, idempotent bootstrap of the chat_definer role (in-app-chat primary-
-- player-surface plan, slice `chat-definer-role-provisioning`, plan §9.2).
--
-- Applied to a RUNNING cluster via `pnpm db:bootstrap` (package.json), immediately
-- after 01-job-definer.sql, for the exact same two reasons that file documents:
--   - CI's postgres service container starts BEFORE actions/checkout, so the init
--     directory can never see this file there (.github/workflows/ci.yml);
--   - a pre-existing local `pgdata` volume never re-runs init scripts, so a
--     mount-only bootstrap silently no-ops on every developer's already-started stack.
-- The compose init mount (infra/docker-compose.yml) stays a convenience for genuinely
-- fresh volumes; this file's own idempotency is what makes both paths safe.
--
-- chat_definer is CLUSTER-global (like job_definer, app/app_worker/readonly) and is
-- pre-provisioned OUTSIDE the migration runner: the future dd38-dd86-chat-schema-core
-- migration only ASSERTS/consumes these exact attributes and membership via
-- `ALTER FUNCTION ... OWNER TO chat_definer`; it never creates or alters this role.
-- Must NOT be added to migrate.ts's RUNTIME_ROLES/ensureRoleExists — that idiom
-- hard-codes LOGIN NOBYPASSRLS, the opposite of what a definer role needs (mirrors
-- DD-89/DD-90 Q5's job_definer precedent exactly).
--
-- Grant-target resolution deliberately mirrors 01-job-definer.sql's own
-- COALESCE(GUC, CURRENT_USER) fallback rather than requiring the GUC unconditionally.
-- That file's own codex round-06 [P1] comment (lines 59-67) already settled this exact
-- question for job_definer: an explicit MIGRATION_ROLE grants to that role; unset (the
-- common case, true for both CI and local dev today) falls back to CURRENT_USER. This
-- slice inherits that ruling rather than re-deriving it — see contract doc §5.4.
-- What is new relative to job_definer: (a) an EXPLICIT pg_roles existence check on the
-- resolved target, giving a clear "migration role % does not exist" error instead of
-- relying on the native GRANT statement's generic Postgres error; (b) a guard against
-- re-pointing — job_definer's own script (see its codex round-08 [P1] comment, lines
-- 68-74) only refuses a RUNTIME-role re-target; it does not stop a re-run with a
-- DIFFERENT non-runtime role from silently ACCUMULATING a second member alongside the
-- first. chat_definer closes that gap: it fails closed if it is already granted to any
-- role other than the one being resolved right now (contract doc §5.4).
-- ============================================================================

BEGIN;

-- 1. Idempotent, race-safe create. Mirrors migrate.ts's ensureRoleExists / 01-job-
--    definer.sql: a bare CREATE + duplicate_object/unique_violation swallow, not an
--    IF NOT EXISTS pre-check (TOCTOU gap under real concurrent bootstrap calls).
DO $$
BEGIN
  CREATE ROLE chat_definer
    NOLOGIN NOSUPERUSER BYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION;
EXCEPTION
  WHEN duplicate_object OR unique_violation THEN NULL;
END
$$;

-- 2. Fail closed on attribute drift. Runs unconditionally (creator, every race-loser,
--    and every idempotent re-run alike) so a role that exists for some OTHER reason
--    with different attributes stops the bootstrap instead of silently granting
--    BYPASSRLS-equivalent trust to the wrong thing. Bootstrap never silently ALTERs
--    an existing role to "fix" it — that is an operator decision, not this script's.
DO $$
DECLARE r record;
BEGIN
  SELECT rolsuper, rolcanlogin, rolbypassrls, rolcreatedb, rolcreaterole, rolinherit, rolreplication
    INTO STRICT r
    FROM pg_roles WHERE rolname = 'chat_definer';
  IF r.rolsuper OR r.rolcanlogin OR NOT r.rolbypassrls OR r.rolcreatedb
     OR r.rolcreaterole OR r.rolinherit OR r.rolreplication THEN
    RAISE EXCEPTION
      'chat_definer bootstrap: existing role has unexpected attributes (need exactly NOLOGIN NOSUPERUSER BYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION)';
  END IF;
END
$$;

-- 3. Membership grant. GRANT is idempotent (re-granting an already-held privilege is
--    a silent no-op). Grant target resolves to the GUC if set, else CURRENT_USER —
--    see the header comment and contract §5.4 for why an unset GUC is safe here,
--    unlike a runtime-role or nonexistent-role target, which both fail closed below.
DO $$
DECLARE
  v_target text := COALESCE(NULLIF(current_setting('chat_definer_bootstrap.migration_role', true), ''), current_user);
  v_existing_runtime_member text;
  v_other_member text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_target) THEN
    RAISE EXCEPTION
      'chat_definer bootstrap: migration role % does not exist', v_target;
  END IF;
  IF v_target IN ('app', 'app_worker', 'readonly') THEN
    RAISE EXCEPTION
      'chat_definer bootstrap: refusing to grant chat_definer to runtime role % — this would let it bypass the narrow function/audit boundary',
      v_target;
  END IF;
  -- pg_has_role raises "role ... does not exist" for an absent role name rather than
  -- returning false (the exact hazard 01-job-definer.sql documents) — filter through
  -- pg_roles first so an absent runtime role is simply not a member yet.
  SELECT rolname INTO v_existing_runtime_member
    FROM pg_roles
   WHERE rolname IN ('app', 'app_worker', 'readonly')
     AND pg_has_role(rolname, 'chat_definer', 'MEMBER')
   LIMIT 1;
  IF v_existing_runtime_member IS NOT NULL THEN
    RAISE EXCEPTION
      'chat_definer bootstrap: chat_definer is already granted to a runtime role (app/app_worker/readonly) — revoke it before proceeding';
  END IF;
  -- Refuse to re-point: 01-job-definer.sql's own re-run guard (codex round-08 [P1])
  -- only refuses a RUNTIME-role re-target, so a re-run of that file with a DIFFERENT
  -- non-runtime role silently ACCUMULATES a second member there. chat_definer fails
  -- closed instead: it must already have no member, or only v_target itself (exact
  -- replay), before granting — a genuinely different target is an operator decision
  -- (revoke the old membership first), never a silent multi-member back door.
  SELECT r.rolname INTO v_other_member
    FROM pg_auth_members m
    JOIN pg_roles r ON r.oid = m.member
    JOIN pg_roles g ON g.oid = m.roleid
   WHERE g.rolname = 'chat_definer'
     AND r.rolname <> v_target
   LIMIT 1;
  IF v_other_member IS NOT NULL THEN
    RAISE EXCEPTION
      'chat_definer bootstrap: chat_definer is already granted to % — refusing to also grant it to % (revoke the existing membership first if this is an intentional re-point)',
      v_other_member, v_target;
  END IF;
  EXECUTE format('GRANT chat_definer TO %I', v_target);
  -- Re-run the identical transitive check AFTER the grant: if v_target is a
  -- non-runtime GROUP role a runtime role already belongs to, this GRANT itself
  -- creates a NEW indirect path (runtime role -> v_target -> chat_definer,
  -- BYPASSRLS). Raising here rolls back the GRANT (and this whole file) atomically,
  -- since the whole script is one explicit transaction (BEGIN at the top).
  SELECT rolname INTO v_existing_runtime_member
    FROM pg_roles
   WHERE rolname IN ('app', 'app_worker', 'readonly')
     AND pg_has_role(rolname, 'chat_definer', 'MEMBER')
   LIMIT 1;
  IF v_existing_runtime_member IS NOT NULL THEN
    RAISE EXCEPTION
      'chat_definer bootstrap: granting chat_definer to % would give runtime role % an indirect path to it — aborting',
      v_target, v_existing_runtime_member;
  END IF;
END
$$;

COMMIT;
```

Deliberately **absent** from this file: any `GRANT USAGE`/`GRANT CREATE ON SCHEMA public TO
chat_definer` line (unlike `01-job-definer.sql`'s closing `GRANT USAGE ON SCHEMA public TO
job_definer;`). `docs/autopilot-dd38-dd86-chat-schema-core.md` §5.1 already pins that grant as its OWN
root migration's job (`GRANT USAGE, CREATE ON SCHEMA public TO chat_definer;` immediately before it
creates and transfers ownership of `chat_current_is_member`/`dm_current_read_allowed`, then `REVOKE
CREATE` again). Adding it here would duplicate an already-owned line and drift the two documents apart.

### 5.2 Root `package.json` bootstrap command — exact diff

Append a second `psql` invocation to the existing `db:bootstrap` script, chained with `&&`, reusing
the *same* `$mr` (already format-validated by the existing `case` statement) and the *same*
`DATABASE_URL_MIGRATION`. The existing `job_definer` invocation is **byte-for-byte unchanged**.

```diff
     "db:bootstrap": "mr=\"${MIGRATION_ROLE:-}\"; case \"$mr\" in \"\") ;; *[!a-zA-Z0-9_]*) echo \"MIGRATION_ROLE must be a plain identifier: letters, digits, underscore only\" >&2; exit 1 ;; esac; psql \"${DATABASE_URL_MIGRATION:?DATABASE_URL_MIGRATION is required}\" -v ON_ERROR_STOP=1 -c \"SET job_definer_bootstrap.migration_role = '$mr'\" -f infra/postgres-init/01-job-definer.sql",
+    "db:bootstrap": "mr=\"${MIGRATION_ROLE:-}\"; case \"$mr\" in \"\") ;; *[!a-zA-Z0-9_]*) echo \"MIGRATION_ROLE must be a plain identifier: letters, digits, underscore only\" >&2; exit 1 ;; esac; psql \"${DATABASE_URL_MIGRATION:?DATABASE_URL_MIGRATION is required}\" -v ON_ERROR_STOP=1 -c \"SET job_definer_bootstrap.migration_role = '$mr'\" -f infra/postgres-init/01-job-definer.sql && psql \"${DATABASE_URL_MIGRATION:?DATABASE_URL_MIGRATION is required}\" -v ON_ERROR_STOP=1 -c \"SET chat_definer_bootstrap.migration_role = '$mr'\" -f infra/postgres-init/02-chat-definer.sql",
```

The `&&` means a failed `job_definer` bootstrap short-circuits before `chat_definer`'s ever runs — no
new failure mode for the existing path.

### 5.3 `packages/db/src/migrate.test.ts` additions

All additions are **local to this file** (not exported from `test-harness.ts` — see §5.4 for why).
They mirror the file's own existing `hideRealJobDefiner` precedent (already local, migrate.test.ts:459)
rather than the exported `bootstrapJobDefiner`/`withJobDefinerLock` (test-harness.ts:76,105).

```ts
const CHAT_DEFINER_BOOTSTRAP_SQL_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..", "..", "..",
  "infra", "postgres-init", "02-chat-definer.sql",
);

async function bootstrapChatDefiner(client: pg.Client): Promise<void> {
  const sql = await readFile(CHAT_DEFINER_BOOTSTRAP_SQL_PATH, "utf8");
  try {
    await client.query(sql);
  } catch (error) {
    await client.query("ROLLBACK"); // mirrors bootstrapJobDefiner's own catch-and-ROLLBACK idiom
    throw error;
  }
}

const CHAT_DEFINER_LOCK_KEY = 0x63686164; // "chad" — distinct from "jobd" (0x6a6f6264) and "plxc" (0x706c7863)

async function withChatDefinerLock<T>(base: string, fn: () => Promise<T>): Promise<T> {
  const lockClient = new pg.Client({ connectionString: base });
  await lockClient.connect();
  await lockClient.query("SELECT pg_advisory_lock($1)", [CHAT_DEFINER_LOCK_KEY]);
  try {
    return await fn();
  } finally {
    await lockClient.query("SELECT pg_advisory_unlock($1)", [CHAT_DEFINER_LOCK_KEY]).catch(() => {});
    await lockClient.end();
  }
}

async function hideRealChatDefiner(superuser: pg.Client, fn: () => Promise<void>): Promise<void> {
  const existing = await superuser.query(`SELECT 1 FROM pg_roles WHERE rolname = 'chat_definer'`);
  const hadRealRole = existing.rows.length > 0;
  if (hadRealRole) {
    await superuser.query(`ALTER ROLE chat_definer RENAME TO chat_definer_hidden_for_test`);
  }
  try {
    await fn();
  } finally {
    if (hadRealRole) {
      await superuser.query(`ALTER ROLE chat_definer_hidden_for_test RENAME TO chat_definer`);
    }
  }
}
```

New `describe` block (a sibling of the existing `describe("job_definer bootstrap script itself fails
closed on runtime-role targets", ...)` at line 1239), with these exact cases — each one maps to a row
in §8:

1. `"first bootstrap with no migration role set grants membership to CURRENT_USER"` — happy path,
   proves an unset GUC is *not* a failure.
2. `"first bootstrap with an explicit valid migration role grants membership to that role, not
   CURRENT_USER"`.
3. `"exact replay is a no-op"` — call `bootstrapChatDefiner` twice with identical inputs; second call
   does not throw; attributes and membership unchanged.
4. `"refuses to bootstrap when chat_definer already exists with a wrong attribute"` — via
   `hideRealChatDefiner`, pre-create `chat_definer LOGIN ...` (wrong attribute), expect rejection,
   assert zero membership rows in `pg_auth_members`, assert the wrong attribute is untouched.
5. `"refuses to grant chat_definer to a runtime role passed as the migration_role target"` — direct
   port of the existing job_definer test at migrate.test.ts:1240.
6. `"refuses to proceed at all when chat_definer is already granted to a runtime role beforehand"` —
   direct port of migrate.test.ts:1264.
7. `"refuses to bootstrap when the migration role does not exist"` — set
   `chat_definer_bootstrap.migration_role` to a name absent from `pg_roles`; expect rejection matching
   `/does not exist/i`; assert zero membership rows.
8. `"refuses to re-point when chat_definer is already granted to a different valid migration role"` —
   bootstrap once with `migration_role` set to role A (a second scratch non-runtime role created for
   this test), then re-run with `migration_role` set to a different role B; expect the second call to
   reject matching `/already granted to/i`; assert A is still the sole member and B was never granted
   — the case job_definer's own script does **not** guard (§5.4).
9. `"N concurrent bootstrap calls against a fresh cluster all succeed; role exists exactly once with
   exactly one membership grant"` — mirrors BR-1's shape (migrate.test.ts:80), applied to
   `bootstrapChatDefiner` directly instead of `ensureRoleExists`.

Every case that deliberately breaks the shared cluster-global role runs inside `withChatDefinerLock`,
exactly as the job_definer negative-path tests run inside `withJobDefinerLock` — same rationale
(migrate.test.ts:90-101): a broken window must never overlap another parallel test file's own
bootstrap of the same real role.

**`MIGRATION_COUNT = 28` (migrate.test.ts:32) does not change** — this slice adds no
`packages/db/migrations/*.sql` file.

## 5.4 Design decisions: grant-target fallback (inherited ruling) and the re-pointing guard (new)

### 5.4.1 The `CURRENT_USER` fallback is an inherited ruling, not a fresh trade-off

Plan §9.2's acceptance text lists "missing/invalid migration role" as one of four fail-closed
triggers, alongside wrong attribute, runtime-role target, and concurrent bootstrap. Read in isolation,
this could mean "an *unset* GUC itself must fail closed — no `CURRENT_USER` fallback at all." That
question is not new, and it was not left to this packet to decide: `01-job-definer.sql`'s own
**codex round-06 [P1]** comment (lines 59-67) already argued it to a conclusion for the identical
mechanism — "unset (the common case) falls back to `CURRENT_USER`" — after weighing the exact
alternative (requiring an explicit `MIGRATION_ROLE` unconditionally) and rejecting it. `chat_definer`
inherits that ruling rather than re-litigating it: "missing" in §9.2's text means the *resolved target
role* is missing/invalid (mirroring "runtime-role target" being about the target's category), not that
an unset GUC is itself a failure.

This packet also verified the ruling is load-bearing here, not just precedent: CI's existing
`Bootstrap job_definer role` step (§3 — `MIGRATION_ROLE` is not set there) and `docker-compose.yml`'s
fresh-volume `docker-entrypoint-initdb.d` mount (§3 — Postgres's own init mechanism runs each file via
`ON_ERROR_STOP=1`, and a raised exception there aborts the *entire* container initialization on a
brand-new volume) both invoke this file with **no GUC set at all**. Requiring the GUC unconditionally
would need a companion `.github/workflows/ci.yml` edit (outside §9.2's exact-3-files pin) and has **no
clean fix at all** for the docker-compose path — there is no hook to inject a GUC per init-mounted file
before Postgres executes it. Inheriting round-06's ruling produces identical, zero-touch-required
behavior on both paths (`CURRENT_USER` there is always the trusted bootstrapping superuser — `plexco`
— which trivially exists and is never a runtime role), confirmed by acceptance rows in §8 (Wiring
category) rather than assumed.

What is still genuinely new relative to `job_definer`, on top of the inherited fallback: an **explicit**
`pg_roles` existence pre-check with a clear, named error on whatever the fallback resolves to, where
`job_definer`'s script has none (it relies on the native `GRANT`'s generic Postgres error if the target
doesn't exist).

If a future reviewer determines the stricter reading was actually intended for `chat_definer`
specifically (diverging from the inherited `job_definer` ruling), the fix is bounded and known (add
`MIGRATION_ROLE: plexco` to the CI step's `env:` block, and accept that the docker-compose convenience
path becomes unsafe for fresh volumes unless it is also reworked) — see §10.

### 5.4.2 The re-pointing guard: a real gap in `job_definer` that `chat_definer` closes instead of inheriting

Distinct from the fallback question, this packet checked whether `01-job-definer.sql` guards a
**re-run under a different `MIGRATION_ROLE`** — i.e. bootstrap once granting to role A, then re-run
later with the GUC set to a different role B. Its **codex round-08 [P1]** comment (lines 68-74)
addresses exactly one shape of this: a re-run where the *new* target is a **runtime** role
(`app`/`app_worker`/`readonly`), which the script refuses unconditionally on every invocation (not just
"first" runs). Verified line-by-line against the live file: this is the *only* re-run guard it has.
Nothing in the file checks whether `job_definer` is already granted to some **other, non-runtime**
role before granting to a new one — a re-run with `MIGRATION_ROLE=bob` after an earlier run granted to
`alice` would silently `GRANT job_definer TO bob` too, with no rejection, no revocation, and no warning.
`job_definer` ends up with two members, indefinitely, and nothing in its own script or
`packages/db/src/migrate.test.ts`'s existing suite catches it. This is a genuine, already-shipped gap
— not touched here (`job_definer` is explicit negative scope, §7) but worth naming precisely rather
than either silently repeating or silently over-claiming it doesn't exist.

`chat_definer` does not inherit this gap. §5.1's design adds an explicit pre-grant check: fail closed
if `chat_definer` is already granted to any role **other than** the one currently being resolved
(exact replay against the *same* target still passes, since that check excludes `v_target` itself).
This is a natural, low-cost hardening for a fresh script — not a re-derivation of Postgres semantics,
just closing a re-pointing back door before it ships, directly serving §9.2's own "membership **only**
to validated migration role" language (singular, not accumulating). See §5.3 test 8 and §8's new
Authorization row.

### 5.4.3 Also deliberately not touched, and why:

- **`packages/db/src/test-harness.ts`** — adding `bootstrapChatDefiner`/`withChatDefinerLock` there
  would expand scope past §9.2's exact 3 files and increase blast radius on a file
  `rls-invariants.test.ts` also imports from. The existing codebase already has a precedent for
  slice-specific test helpers living locally in `migrate.test.ts` (`hideRealJobDefiner`, line 459, is
  local, not exported) — §5.3 follows that precedent, not the exported-helper one.
- **`packages/db/src/migrate.ts`** (`RUNTIME_ROLES`) — `chat_definer` must never be added to this
  array (§7); no edit needed to enforce that, only a verification command proving it stays absent
  (§9's `verification.focused`).
- **`.github/workflows/ci.yml`, `infra/docker-compose.yml`** — see above.
- **`packages/db/README.md`** — unlike `dd38-dd86-chat-schema-core` (which documents two new
  `SECURITY DEFINER` functions there), this slice creates no function, so there is nothing new to
  document in that file's per-migration convention.

## 6. Migration numbering

**Not applicable.** This slice adds zero files under `packages/db/migrations/`. `chat_definer` is
provisioned via `infra/postgres-init/`, exactly like `job_definer`, entirely outside the migration
runner (§9.2: "zero domain migration/table/API"). `MIGRATION_COUNT` in `migrate.test.ts` stays `28`.

## 7. Negative scope (plan §9.2, transcribed and expanded with mechanical detail)

- **NOT** `job_definer` — `infra/postgres-init/01-job-definer.sql` is not edited; its exact behavior,
  attributes, and grant target resolution are untouched.
- **NOT** `RUNTIME_ROLES`/`ensureRoleExists` in `packages/db/src/migrate.ts` — `chat_definer` must
  never be added to that array; that idiom hard-codes `LOGIN NOBYPASSRLS`, the opposite of what a
  definer role needs.
- **NOT** any `GRANT` of `chat_definer` (or membership in it) to `app`, `app_worker`, or `readonly` —
  enforced as a fail-closed runtime check inside `02-chat-definer.sql` itself (§5.1, §8).
- **NOT** any `chat_*` table, function, RLS policy, or schema object of any kind — that is
  `dd38-dd86-chat-schema-core`'s (slice 3) deliverable; this slice only provisions the role.
- **NOT** `dm_safety_enabled()`, `chat_pair_blocked()`, `assert_dm_allowed()`, or any other safety
  table/function — that is `chat-dm-safety-authority-core`'s (slice 2) deliverable.
- **NOT** any queue/`pg-boss` provisioning of any kind.
- **NOT** `GRANT USAGE`/`GRANT CREATE ON SCHEMA public TO chat_definer` — deliberately deferred to
  `dd38-dd86-chat-schema-core`'s own root migration (§5.1), which creates and owns the `SECURITY
  DEFINER` functions that actually need it.
- **NOT** any new file under `packages/db/migrations/` — see §6.
- **NOT** `packages/db/src/test-harness.ts` — see §5.4.
- **NOT** `.github/workflows/ci.yml` or `infra/docker-compose.yml` — see §5.4; if a future reviewer
  overturns the Reading-B decision, both become in-scope for a follow-up, not this packet.
- **NOT** `docs/autopilot-backlog.md` — separate chore commit, out of this slice's scope (§10).

## 8. Acceptance matrix

| Category | Row | Expected |
|---|---|---|
| Happy path | First bootstrap on a fresh cluster, no `migration_role` GUC set | Role created with exact 7 attributes; membership granted to `CURRENT_USER`; no error |
| Happy path | First bootstrap with `chat_definer_bootstrap.migration_role` set to a valid, existing, non-runtime role | Role created; membership granted to that exact role, not `CURRENT_USER` |
| Happy path | Exact replay (identical inputs, run again) | No error; attributes unchanged; membership unchanged — idempotent no-op |
| Boundary | Bootstrap runs a second time against a cluster where `chat_definer` already exists with correct attributes | Create step swallows `duplicate_object`/`unique_violation`; attribute check passes; grant proceeds/no-ops |
| Boundary | `chat_definer_bootstrap.migration_role` explicitly set to an empty string | `NULLIF('', '')` collapses to `NULL` — identical to unset; falls back to `CURRENT_USER`, no error |
| Authorization | Role pre-exists with a wrong attribute (e.g. `LOGIN` instead of `NOLOGIN`) | Fails closed; error names `chat_definer`; zero rows in `pg_auth_members`; the wrong attribute is left untouched (no silent `ALTER`) |
| Authorization | `migration_role` set to `app`, `app_worker`, or `readonly` | Fails closed before any `GRANT`; error names the runtime role; zero membership rows |
| Authorization | `chat_definer` already granted to a runtime role via some other path before bootstrap runs | Refuses to proceed at all; error states it is already granted to a runtime role |
| Authorization | `migration_role` set to a name absent from `pg_roles` | Fails closed with an explicit "migration role % does not exist" error; zero membership rows |
| Authorization | Bootstrap once with `migration_role` = A, then re-run with `migration_role` = a different valid role B | Second call fails closed ("already granted to A"); A remains the sole member; B is never granted — the gap `job_definer`'s own script does not guard (§5.4.2) |
| Authorization | Grant target is a non-runtime group role a runtime role already belongs to (indirect BYPASSRLS path) | Post-grant re-check detects the new transitive path and raises; the whole transaction — including the `GRANT` — rolls back atomically |
| Failure | Any fail-closed trigger above fires mid-script | The single `BEGIN...COMMIT` wrapping the file rolls back everything, including a freshly-created role — no partial state survives, not even an inert leftover role |
| Concurrency | N concurrent `bootstrapChatDefiner` calls against a fresh cluster, all with the same valid migration role | All calls succeed (or all-but-one hit the `duplicate_object` swallow); role exists exactly once with exactly one membership grant afterward |
| Concurrency | A deliberately-broken-attribute test runs concurrently with an unrelated valid bootstrap elsewhere in the suite | `withChatDefinerLock`'s advisory lock serializes the two; the valid path never observes the broken intermediate state |
| Migration | This slice adds zero `packages/db/migrations/*.sql` files | `git diff --name-only <base>...HEAD -- packages/db/migrations/` is empty; `MIGRATION_COUNT` in `migrate.test.ts` stays `28` |
| Security/privacy | `chat_definer` attributes after bootstrap | Exactly `NOLOGIN NOSUPERUSER BYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION`; no schema-level `USAGE`/`CREATE` grant (deferred to `dd38-dd86-chat-schema-core`) |
| Security/privacy | `RUNTIME_ROLES`/`ensureRoleExists` in `migrate.ts` | Unchanged; `chat_definer` does not appear there |
| Wiring | CI step order | `.github/workflows/ci.yml`'s existing `Bootstrap job_definer role` step (unmodified) still runs `pnpm db:bootstrap` before `Test`; `db:bootstrap` now bootstraps `chat_definer` too — no CI edit needed (§5.4) |
| Wiring | CI's existing bootstrap step still succeeds with no `MIGRATION_ROLE` set | `CURRENT_USER` fallback resolves to `plexco` — valid, non-runtime, existing — proving the new script requires no companion CI change |
| Regression | Full existing canonical DB suite | `DATABASE_URL_TEST=postgres://plexco:plexco_dev@localhost:5432/plexco_test pnpm test` — every existing `job_definer`/`RUNTIME_ROLES`/migrate test stays green; no existing test's behavior changes |
| Observability | N/A — intentionally out of scope | No audit/receipt table for role bootstrap; that pattern belongs to actual capability grants (e.g. `tenant-capability-authority-core`), not cluster-bootstrap infra |

## 9. Canonical verdict

```text
REVIEW_POLICY_VERSION: 1.3
REVIEW_VERDICT: CODE_READY
REVIEWED_AT: 2026-08-03
AUTHORITY_SHA: ace61a6b95161ccaffad34f30763847cb6a7143c
BASE_BRANCH: main
BASE_REMOTE_RELATION: MAIN_EQUALS_ORIGIN_MAIN
TARGET_FILES:
  - docs/proposals/in-app-chat-primary-player-surface-plan-2026-07-27.md
  - infra/postgres-init/01-job-definer.sql
  - package.json
  - packages/db/src/migrate.ts
  - packages/db/src/migrate.test.ts
  - packages/db/src/test-harness.ts
  - .github/workflows/ci.yml
  - infra/docker-compose.yml
  - docs/autopilot-chat-definer-role-provisioning.md
  - docs/autopilot-manifests/chat-definer-role-provisioning.json
SLICE: chat-definer-role-provisioning
IN_SCOPE: idempotent chat_definer role bootstrap (exact attributes), fail-closed validated-migration-
  role membership grant, focused tests in migrate.test.ts
OUT_OF_SCOPE: chat_* tables/functions/RLS; safety tables/functions; any migration; schema-level
  USAGE/CREATE grant to chat_definer; test-harness.ts/migrate.ts/CI/compose edits (full list §7)
G1_DECISION: PASS
G2_SPEC: PASS
G3_DEPENDENCY: PASS
G4_TEST: PASS
G5_SCOPE: PASS
G6_EXTERNAL: PASS
HARD_DEPENDENCIES: none — infra/postgres-init/ and packages/db/src/migrate.test.ts already exist on
  origin/main (§3, §4)
PRIOR_SLICES: docs-chat-primary-surface-contract (0, landed 90d292d) -> chat-definer-role-provisioning
  (this packet)
OPEN_QUESTIONS_IN_SCOPE: 0
ENABLEMENT_ONLY_GATES: none
LIVE_REPO_VERIFICATION: PASS
CONTRACT_MATRIX: PASS
CLOSURE_MATRIX: PASS — 12/12, see §9.1
ACCEPTANCE_MATRIX: PASS
SECURITY_AND_MIGRATION_GATE: PASS
IMPLEMENTATION_ARTIFACTS: PASS
FIRST_IMPLEMENTATION_STEP: open a worktree from `ace61a6b95161ccaffad34f30763847cb6a7143c` via
  `.claude/commands/ap-47-chat-definer-role-provisioning.md`; write infra/postgres-init/02-chat-
  definer.sql exactly per §5.1, then the package.json diff (§5.2), then the migrate.test.ts additions
  (§5.3), in that order, verifying each layer before the next
REMAINING_BLOCKERS: none
```

### 9.1 Closure matrix (12/12)

| # | Gate | Evidence | PASS/FAIL |
|---|---|---|---|
| 1 | Authority snapshot pin theo SHA | `90d292d` (decision) + `ace61a6b9` (live base), both verified 2026-08-03 via `git fetch` + `git rev-parse` | PASS |
| 2 | Decision trong scope đã chốt | Plan §9 row 1 pins exact role attributes; DD-89/90 Q5 (`job_definer`) is the ratified precedent this slice mirrors; the one open interpretive point (missing-vs-invalid migration role) is resolved with concrete, tested, documented reasoning (§5.4), not left as an unresolved product choice | PASS |
| 3 | Scope IN/OUT và owner rõ | §5 (exact 3 files + design), §7 (negative scope), §5.4 (why nothing else needs touching) | PASS |
| 4 | Dependency phân loại đủ | §4 — zero executable dependencies; both preconditions already true on `main` | PASS |
| 5 | Live schema/code khớp doc | §3 — every claim verified against live `migrate.ts`, `test-harness.ts`, `ci.yml`, `docker-compose.yml`, migration tail | PASS |
| 6 | Data/API/state/auth contract đủ | §5.1 full exact SQL; no API surface (zero domain migration/table/API per §9.2) | PASS |
| 7 | Fail-closed/idempotency/order đủ | §5.1 (single transaction = atomic no-partial-state), §5.4 (grant-target resolution reasoned through two real invocation paths) | PASS |
| 8 | Open question trong scope = 0 | Missing backlog entry (§10) and CI-step-name staleness are explicitly non-blocking observations, not TBDs affecting this slice's runtime behavior | PASS |
| 9 | Acceptance matrix có expected result | §8 — every row has input/precondition and expected result across all B2 categories | PASS |
| 10 | Migration/security/rollback pin | §6 (no migration), §5.1 (exact attributes/atomicity), rollback = trivial `DROP ROLE chat_definer` pre-root (nothing yet owns objects via this role) | PASS |
| 11 | First slice có hard dependency merged | §4 — this slice's own two preconditions are already on `main`; it is the lowest unbuilt node in the DAG | PASS |
| 12 | Implementation handoff sẵn sàng | Packet (this doc) + manifest + launcher all authored; §5 gives exact, non-paraphrased SQL/diff/test design | PASS |

12/12 PASS. Verdict: **`CODE_READY`**.

## 10. Open items (non-blocking — do not read as `CODE_READY` blockers)

1. **`docs/autopilot-backlog.md` has no entry for this slice.** Confirmed absent (§3), matching AP-45's
   own finding. Out of this packet's scope by explicit instruction (separate chore commit). A future
   session should add a `## task:` block once this packet lands, so the backlog's own scanner can see
   it — until then, `dd38-dd86-chat-schema-core`'s own backlog-derived `depends_on: []` will keep
   reading as "no dependency" to anything that scans the backlog file alone rather than this packet.
2. **CI's step display name will be mildly stale.** `.github/workflows/ci.yml:70`'s step is named
   `Bootstrap job_definer role`; after implementation it also bootstraps `chat_definer`. Purely
   cosmetic (the step's own comment already explains the mechanism in enough detail), and renaming it
   is outside §9.2's exact-3-files pin — worth a one-line touch-up whenever `ci.yml` is next edited for
   an unrelated reason, not worth its own slice.
3. **Grant-target fallback (§5.4.1) — confirmed, not a live question.** Owner confirmed 2026-08-03:
   the `CURRENT_USER` fallback is the right call, and it is an inherited ruling (`01-job-definer.sql`'s
   own codex round-06 [P1]) rather than a fresh trade-off this packet invented. The bounded reversal
   path (add `MIGRATION_ROLE: plexco` to CI's bootstrap step; separately decide whether the
   docker-compose fresh-volume convenience path may become unsafe or needs its own rework) stays
   documented in §5.4.1 in case a future slice deliberately diverges from this precedent — not because
   it is in question here.
4. **`01-job-definer.sql` itself has an unguarded re-pointing gap (§5.4.2).** Discovered while checking
   whether `chat_definer` should mirror a re-run guard: `job_definer`'s script refuses a re-run
   targeting a *runtime* role, but not a re-run targeting a *different non-runtime* role — that
   silently accumulates a second member. Explicit negative scope for this packet (`job_definer` is not
   touched), and per owner direction the backlog entry for that follow-up is the owner's own to open,
   not this packet's. Recorded here so it is not lost between sessions.
