<!-- review-readiness: enforce -->
# AP-45 — dd38-dd86-chat-schema-core: root chat-schema migration slice contract

> **Status:** `NOT_CODE_READY` (see verdict, §9) · **Authored:** 2026-08-03 · **Risk:** P0 (preparation-only)
> **This is an AUTHORING artifact.** No worktree has been opened, no `register` has been attempted, no
> code exists. It re-evaluates its own readiness against the immutable authority it pins rather than
> inheriting the `docs/autopilot-backlog.md` entry's own disclaimer that that entry "does not issue a
> readiness verdict."

## 0. Session input

```text
REQUEST: final-readiness (authoring, not implementation)
TARGET_FILES:
  - docs/proposals/in-app-chat-primary-player-surface-plan-2026-07-27.md (v1.8, §7-§13)
  - docs/features/BE/feature_inapp_chat_tech.md (v0.23, §2 schema/RLS)
  - docs/features/FE/feature_inapp_chat.md (v0.15)
  - docs/decisions/analysis/dd-86-in-app-multi-channel-analysis.md
  - docs/standards/decisions.md (DD-38/55/86/91-95 anchors, §1112/§1193)
  - docs/standards/feature-dependency-graph.md
  - docs/autopilot-backlog.md (task dd38-dd86-chat-schema-core, line 725)
  - packages/db/schema.ts (live, 1409 lines at base)
  - packages/db/migrations/*.sql (live, tail 0027)
  - packages/db/migrations/0009_rls_policies_grants.sql (RLS/grants idiom)
  - packages/db/migrations/0012_auth_functions.sql (SECURITY DEFINER idiom)
  - packages/db/src/tenant.ts, packages/db/src/test-harness.ts (GUC-setting idiom)
  - docs/autopilot-invariant-catalog.md (`schema` token)
  - infra/postgres-init/ (live listing — confirms slice 1 unlanded)
EXPECTED_OUTCOME: CODE_READY (target); actual = NOT_CODE_READY, see §9
BASE_BRANCH: main
SCOPE_REPO: /Users/maingocanh/Projects/Plexco app
USER_AUTHORIZED_EDITS: yes (authoring this packet + manifest + launcher only; no register/worktree/code)
```

## 1. What this slice is

Root of the DD-38/DD-86 chat schema tree. Final `chat_channels` / `chat_members` / `chat_messages`
shape, revision/search-ready message columns, the pure DM read adapter (`dm_current_read_allowed`),
RLS policies on all three tables, read-helper ownership/grants, and invariant tests proving the
negative (cross-tenant and cross-person isolation). Exactly one new migration.

It does **not** own: `create_dm`, `send_chat_message`, `mark_read`, edit/delete/search/reaction/
moderation RPC, the DD-56 capability registry, media, Assistant, slash commands, or notification
delivery. See §5 for the full negative-scope list, pinned verbatim from the Reviewed BE spec.

## 2. Authority pins

- **Immutable decision authority:** `90d292d85fbe92db7a5afcd118a99e28f3d3b3b7` — commit
  `docs(chat): commit the in-app-chat primary-surface authority pack`, exactly 27 `TARGET_FILES`,
  reviewed at primary-surface plan v1.8 §13, `PLAN_READY`, closure 12/12.
- **Live base (verified 2026-08-03, this session):** `b3d3b4a26abc3fddbbb51ebb3d9f4d33d899ab43` =
  `origin/main` = `main` (`git rev-parse origin/main HEAD` both returned this SHA; working tree has
  only untracked, unrelated WIP: `.msg-a.txt`, `.msg-b.txt`, `design.pen`,
  `docs/autopilot-templates/level3.1-design-discussion.md`, `docs/channels/web/FE/`,
  `docs/channels/web/docs_comparison.md`, `docs/sessions/`,
  `docs/templates/feature-dev/fe-spec-template.md` — none touch chat/schema).
- **Why two SHAs:** the plan's product/design content is frozen at `90d292d`; this packet additionally
  re-verifies *current* live-repo truth (migration tail, absence of `chat_*`, dependency-slice
  landing state) against the live base, per this repo's own rule that a slice packet must
  re-evaluate its own readiness rather than inherit a stale one. The backlog's queue-state notes
  (top of `docs/autopilot-backlog.md`) warn that `784bc8d` was wrongly called "current HEAD" in ~30
  files after `main` moved past it — this packet does not repeat that mistake: `90d292d` is cited
  only as the frozen decision snapshot, never as "current HEAD".

## 3. Live-repo verification (re-run 2026-08-03, not trusted from the backlog stub)

| Claim | Method | Result |
|---|---|---|
| No `chat_*` schema/service/route/UI/migration exists | `grep -rli "chat_channels\|chat_members\|chat_messages" --include="*.ts" --include="*.sql" --include="*.tsx" .` (excl. node_modules) | Zero hits — **confirmed still true** at `b3d3b4a` |
| Migration tail | `ls packages/db/migrations/` | `0027_resolve_tenant_status_locked.sql` — no `chat_*` file |
| `schema` invariant token exists in catalog | `grep -n "^schema" docs/autopilot-invariant-catalog.md` | `schema — Supabase/Postgres tables, migrations, RLS policies` (line 35, em-dash format, no backticks) |
| Slice 1 (`chat-definer-role-provisioning`) landed? | `ls infra/postgres-init/` | Only `01-job-definer.sql` exists — **`02-chat-definer.sql` (the exact file §9.2 of the plan names) is absent. Slice 1 has NOT landed.** |
| Slices 1/2 registered anywhere? | `grep -n "chat-definer-role-provisioning\|chat-dm-safety-authority-core" docs/autopilot-backlog.md` | **Zero hits. Neither has a backlog `## task:` entry, manifest, or launcher**, despite being named, ordered and spec'd across 8+ docs (plan §9 row 1/2, §9.2 exact packet, `dd-86-in-app-multi-channel-analysis.md`, `feature_inapp_chat.md`, `feature_inapp_chat_tech.md`, `feature_tenant_routing_authz_tech.md`, `TDD.md`, `feature-dependency-graph.md`, `decisions.md` ×3) |
| Person-scoped RLS GUC (`app.person_id`) precedent | `grep -n "withPerson\|app\.person_id" packages/db/src/tenant.ts` | No existing helper — every RLS policy in this repo to date (`0009_rls_policies_grants.sql`) is tenant-scoped only via `app.tenant_id`. **This slice introduces the first person-scoped RLS GUC.** |
| `chat_current_is_member`/`dm_current_read_allowed` naming collision | repo-wide grep | None |

## 4. Dependency graph — corrected from the backlog stub

The backlog entry (`docs/autopilot-backlog.md:725`) carries `depends_on: []` **by its own admission
as a placeholder**: *"depends_on remains `[]` because this is an evidence registry anchor, not
evidence that the executable slice graph has no dependencies. Replace it with the immutable plan's
exact prerequisites when authoring the real packet."* This section does that.

### 4.1 The real chain

Every one of: the primary-surface plan (§8.3, §9, §13 `PRIOR_SLICES`), `dd-86-in-app-multi-channel-
analysis.md`, `feature_inapp_chat.md`, `feature_inapp_chat_tech.md` (§"DD-55 design-probe gates"),
`feature_tenant_routing_authz_tech.md`, `TDD.md`, `feature-dependency-graph.md`, and
`decisions.md` (§1112, §1193) states the same serialized DB lane, consistently:

```text
1 chat-definer-role-provisioning  →  2 chat-dm-safety-authority-core  →  3 dd38-dd86-chat-schema-core (THIS SLICE)  →  4 tenant-capability-authority-core
```

### 4.2 This is not just collision-avoidance — root's own DDL calls slice 1 and slice 2

Slice 4's dependency on slice 3 is explicitly named as *execution-only* (shared migration tail/
schema.ts/catalog tests; "capability semantics vẫn độc lập với Chat schema" — decisions.md §1193).

Root's dependency on slices 1 and 2 is different in kind — **root's own migration body directly
references symbols slices 1/2 create**:

- `dm_current_read_allowed(uuid)` (root-owned) calls `dm_safety_enabled()` — owned/created by
  `chat-dm-safety-authority-core` (slice 2). Root's own doc says so explicitly: *"Root migration
  creates only this chat-specific adapter after those dependencies exist; missing capability/error
  => FALSE"* (`feature_inapp_chat_tech.md:541-542`).
- Root's owner/grant block does `GRANT USAGE, CREATE ON SCHEMA public TO chat_definer;` and
  `ALTER FUNCTION chat_current_is_member(uuid) OWNER TO chat_definer;` /
  `ALTER FUNCTION dm_current_read_allowed(uuid) OWNER TO chat_definer;` — this **requires the
  `chat_definer` role to already exist with the exact `NOLOGIN NOSUPERUSER BYPASSRLS NOCREATEDB
  NOCREATEROLE NOINHERIT NOREPLICATION` attributes**, which is slice 1's entire deliverable. Without
  slice 1, root's own migration cannot even be applied (the `ALTER FUNCTION ... OWNER TO chat_definer`
  statement would fail — role does not exist).

This is a **hard functional dependency**, provable by reading root's own target DDL, not a narrative
claim.

### 4.3 The gap this packet cannot close by itself

Per this repo's own dependency-proof rule (`autopilot-invariants.md` §"Backlog / registry / parallel
gate"): *"Every Level-3 `depends_on` row carries a same-order proof with dependency `base_sha`,
`landed_sha`, exact file and slice-unique identifier absent on the dependency base and present on
both landed/downstream trees."* That proof requires the dependency to be **merged**. Neither
`chat-definer-role-provisioning` nor `chat-dm-safety-authority-core` has been merged — neither has
even been **authored** as its own slice (no backlog entry, no manifest, no launcher; confirmed §3).

So this packet's manifest (`docs/autopilot-manifests/dd38-dd86-chat-schema-core.json`) declares
`depends_on: ["chat-definer-role-provisioning", "chat-dm-safety-authority-core"]` (the true names,
correcting the backlog stub) but **`dep_checks: []`** — there is no `base_sha`/`landed_sha`/`symbol`
proof to cite yet. Fabricating placeholder SHAs here would be exactly the "evidence with a
machine-checked shell" failure mode `review-code-readiness-gate.md` §11.2 warns against. This is the
single largest open item in this packet — see §10.

### 4.4 Successors (for orientation, not owned by this packet)

`4 tenant-capability-authority-core` (collision-only dep on this slice) → `5 chat-club-channel-
lifecycle-core` → `9 chat-authorized-member-target-read-core` → `6 chat-club-moderation-core` → `7
chat-shared-message-command-core` → `8 chat-dm-lifecycle-command-core`. Catalog IDs are stable;
execution order is `5→9→6→7→8` (slice 9 must land before 6/7/8 consume its target resolver).

## 5. Scope

### 5.1 In scope — exact root-owned DDL (verbatim source, `feature_inapp_chat_tech.md` v0.23, lines
127-249 for tables/triggers and 521-603 for helpers/RLS/grants — Reviewed target contract, copy
verbatim into the migration, do not paraphrase)

```sql
-- Prerequisite FK target (composite FK needs more than PK(id)):
ALTER TABLE memberships
  ADD CONSTRAINT memberships_id_person_tenant_uq UNIQUE (id, person_id, tenant_id);

CREATE TABLE chat_channels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES tenants(id),
  kind text NOT NULL CHECK (kind IN ('club','dm')),
  dm_key text,
  title text,
  is_default boolean,
  sort_order integer,
  created_by_membership_id uuid,
  created_by_person_id uuid,
  creation_origin text,
  post_policy text,
  assistant_enabled boolean,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (kind = 'club'
      AND tenant_id IS NOT NULL AND dm_key IS NULL
      AND title IS NOT NULL AND is_default IS NOT NULL AND sort_order IS NOT NULL
      AND creation_origin IN ('actor','system_bootstrap')
      AND post_policy IN ('all_members','admins_only')
      AND assistant_enabled IS NOT NULL)
    OR
    (kind = 'dm'
      AND tenant_id IS NULL AND dm_key IS NOT NULL
      AND title IS NULL AND is_default IS NULL AND sort_order IS NULL
      AND created_by_membership_id IS NULL AND created_by_person_id IS NULL
      AND creation_origin IS NULL
      AND post_policy IS NULL AND assistant_enabled IS NULL)
  ),
  CHECK ((created_by_membership_id IS NULL) = (created_by_person_id IS NULL)),
  CHECK (
    kind <> 'club'
    OR (creation_origin='actor' AND created_by_membership_id IS NOT NULL)
    OR (creation_origin='system_bootstrap' AND created_by_membership_id IS NULL)
  ),
  FOREIGN KEY (created_by_membership_id, created_by_person_id, tenant_id)
    REFERENCES memberships(id, person_id, tenant_id),
  UNIQUE (dm_key),
  UNIQUE (id, tenant_id)
);
CREATE UNIQUE INDEX chat_channels_default_uq
  ON chat_channels(tenant_id)
  WHERE kind='club' AND is_default IS TRUE AND archived_at IS NULL;

CREATE TABLE chat_members (
  channel_id uuid NOT NULL REFERENCES chat_channels(id),
  tenant_id  uuid,
  person_id  uuid NOT NULL REFERENCES persons(id),
  membership_id uuid,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('member','admin')),
  last_read_created_at timestamptz,
  last_read_message_id uuid,
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (channel_id, person_id),
  FOREIGN KEY (channel_id, tenant_id) REFERENCES chat_channels(id, tenant_id),
  FOREIGN KEY (membership_id, person_id, tenant_id) REFERENCES memberships(id, person_id, tenant_id),
  CHECK ((tenant_id IS NOT NULL AND membership_id IS NOT NULL)
      OR (tenant_id IS NULL     AND membership_id IS NULL)),
  CHECK ((last_read_created_at IS NULL) = (last_read_message_id IS NULL))
);

CREATE TABLE chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id uuid NOT NULL REFERENCES chat_channels(id),
  tenant_id  uuid,
  author_type text NOT NULL DEFAULT 'person' CHECK (author_type IN ('person','assistant','system')),
  author_person_id uuid REFERENCES persons(id),
  membership_id uuid,
  body text NOT NULL,
  reply_to_message_id uuid,
  edited_at timestamptz,
  edit_count smallint NOT NULL DEFAULT 0 CHECK (edit_count BETWEEN 0 AND 5),
  author_deleted_at timestamptz,
  moderation_state text NOT NULL DEFAULT 'visible' CHECK (moderation_state IN ('visible','hidden')),
  moderation_updated_at timestamptz,
  moderation_actor_person_id uuid REFERENCES persons(id),
  moderation_reason_code text
    CHECK (moderation_reason_code IS NULL
      OR moderation_reason_code IN ('spam','harassment','unsafe','off_topic','other')),
  client_msg_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  search_document tsvector GENERATED ALWAYS AS (
    to_tsvector('simple'::regconfig, coalesce(body, ''))
  ) STORED,
  UNIQUE (channel_id, client_msg_id),
  UNIQUE (channel_id, id),
  UNIQUE (channel_id, created_at, id),
  FOREIGN KEY (channel_id, tenant_id) REFERENCES chat_channels(id, tenant_id),
  FOREIGN KEY (membership_id, author_person_id, tenant_id) REFERENCES memberships(id, person_id, tenant_id),
  FOREIGN KEY (channel_id, reply_to_message_id) REFERENCES chat_messages(channel_id, id),
  CHECK (reply_to_message_id IS NULL OR reply_to_message_id IS DISTINCT FROM id),
  CHECK (
    (moderation_state='visible' AND moderation_updated_at IS NULL
      AND moderation_actor_person_id IS NULL AND moderation_reason_code IS NULL)
    OR
    (moderation_state='hidden' AND moderation_updated_at IS NOT NULL
      AND moderation_actor_person_id IS NOT NULL AND moderation_reason_code IS NOT NULL)
  ),
  CHECK (author_type <> 'person' OR author_person_id IS NOT NULL),
  CHECK (author_type =  'person' OR author_person_id IS NULL),
  CHECK (author_type = 'person' OR membership_id IS NULL),
  CHECK (author_type <> 'person' OR tenant_id IS NULL OR membership_id IS NOT NULL)
);
CREATE INDEX idx_chat_messages_channel_time ON chat_messages(channel_id, created_at, id);
CREATE INDEX idx_chat_messages_search_simple
  ON chat_messages USING gin(search_document)
  WHERE moderation_state='visible' AND author_deleted_at IS NULL;
ALTER TABLE chat_members
  ADD FOREIGN KEY (channel_id, last_read_created_at, last_read_message_id)
  REFERENCES chat_messages(channel_id, created_at, id);

-- Tenant-bind trigger (closes the FK MATCH-SIMPLE-NULL loophole):
CREATE FUNCTION chat_bind_tenant() RETURNS trigger AS $$
DECLARE ct uuid; BEGIN
  SELECT tenant_id INTO ct FROM chat_channels WHERE id = NEW.channel_id;
  IF NEW.tenant_id IS NOT NULL AND NEW.tenant_id IS DISTINCT FROM ct THEN
    RAISE EXCEPTION 'child tenant_id % != channel tenant %', NEW.tenant_id, ct;
  END IF;
  NEW.tenant_id := ct;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_chat_members_bind  BEFORE INSERT OR UPDATE ON chat_members  FOR EACH ROW EXECUTE FUNCTION chat_bind_tenant();
CREATE TRIGGER trg_chat_messages_bind BEFORE INSERT OR UPDATE ON chat_messages FOR EACH ROW EXECUTE FUNCTION chat_bind_tenant();

-- DM exactly-2-members guards:
CREATE FUNCTION chat_dm_member_insert_guard() RETURNS trigger AS $$
DECLARE k text; c int; BEGIN
  SELECT dm_key INTO k FROM chat_channels WHERE id = NEW.channel_id AND kind = 'dm' FOR UPDATE;
  IF FOUND THEN
    IF NEW.person_id::text NOT IN (split_part(k,':',1), split_part(k,':',2)) THEN
      RAISE EXCEPTION 'DM member % not in dm_key %', NEW.person_id, k;
    END IF;
    SELECT count(*) INTO c FROM chat_members WHERE channel_id = NEW.channel_id;
    IF c >= 2 THEN RAISE EXCEPTION 'DM channel already has 2 members'; END IF;
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_chat_dm_member_insert BEFORE INSERT ON chat_members
  FOR EACH ROW EXECUTE FUNCTION chat_dm_member_insert_guard();

CREATE FUNCTION chat_assert_dm_two(p_channel uuid) RETURNS void AS $$
DECLARE c int; k text; BEGIN
  IF (SELECT kind FROM chat_channels WHERE id = p_channel) = 'dm' THEN
    SELECT count(*) INTO c FROM chat_members WHERE channel_id = p_channel;
    IF c <> 2 THEN RAISE EXCEPTION 'DM channel % must have exactly 2 members (got %)', p_channel, c; END IF;
    SELECT string_agg(person_id::text, ':' ORDER BY person_id) INTO k
      FROM chat_members WHERE channel_id = p_channel;
    IF k <> (SELECT dm_key FROM chat_channels WHERE id = p_channel) THEN
      RAISE EXCEPTION 'DM member set % != dm_key', k; END IF;
  END IF;
END; $$ LANGUAGE plpgsql;
CREATE FUNCTION chat_dm_two_from_members() RETURNS trigger AS $$
BEGIN PERFORM chat_assert_dm_two(COALESCE(NEW.channel_id, OLD.channel_id)); RETURN NULL; END; $$ LANGUAGE plpgsql;
CREATE FUNCTION chat_dm_two_from_channel() RETURNS trigger AS $$
BEGIN PERFORM chat_assert_dm_two(COALESCE(NEW.id, OLD.id)); RETURN NULL; END; $$ LANGUAGE plpgsql;
CREATE CONSTRAINT TRIGGER trg_chat_dm_two_members AFTER INSERT OR UPDATE OR DELETE ON chat_members
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION chat_dm_two_from_members();
CREATE CONSTRAINT TRIGGER trg_chat_dm_two_channel  AFTER INSERT OR UPDATE ON chat_channels
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION chat_dm_two_from_channel();

CREATE FUNCTION chat_dm_no_member_delete() RETURNS trigger AS $$
BEGIN
  IF (SELECT kind FROM chat_channels WHERE id = OLD.channel_id) = 'dm' THEN
    RAISE EXCEPTION 'DM members immutable; soft-close channel via archived_at';
  END IF;
  RETURN OLD;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_chat_dm_no_delete BEFORE DELETE ON chat_members
  FOR EACH ROW EXECUTE FUNCTION chat_dm_no_member_delete();

-- Read helpers (SECURITY DEFINER, owner = chat_definer — REQUIRES slice 1 landed):
CREATE FUNCTION chat_current_is_member(p_channel uuid) RETURNS boolean
  LANGUAGE sql SECURITY DEFINER STABLE SET search_path = pg_catalog, public AS $$
  SELECT EXISTS (
    SELECT 1
    FROM chat_members cm
    JOIN chat_channels c ON c.id = cm.channel_id
    LEFT JOIN memberships m
      ON (m.id, m.person_id, m.tenant_id) = (cm.membership_id, cm.person_id, cm.tenant_id)
    WHERE cm.channel_id = p_channel
      AND cm.person_id = current_setting('app.person_id', true)::uuid
      AND (c.kind = 'dm' OR (c.kind = 'club' AND m.status = 'active'))
  );
$$;
REVOKE ALL ON FUNCTION chat_current_is_member(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION chat_current_is_member(uuid) TO app;

-- REQUIRES slice 2 landed: calls dm_safety_enabled() owned by chat-dm-safety-authority-core.
CREATE FUNCTION dm_current_read_allowed(p_channel uuid) RETURNS boolean
  LANGUAGE sql SECURITY DEFINER STABLE SET search_path = pg_catalog, public AS $$
  SELECT dm_safety_enabled()
     AND EXISTS (
       SELECT 1
       FROM chat_members me
       JOIN chat_members peer ON peer.channel_id = me.channel_id AND peer.person_id <> me.person_id
       WHERE me.channel_id = p_channel
         AND me.person_id = current_setting('app.person_id', true)::uuid
         AND NOT chat_pair_blocked(me.person_id, peer.person_id));
$$;
REVOKE ALL ON FUNCTION dm_current_read_allowed(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION dm_current_read_allowed(uuid) TO app;

-- Owner/grant block — REQUIRES chat_definer role (slice 1) to exist first:
GRANT USAGE, CREATE ON SCHEMA public TO chat_definer;
ALTER FUNCTION chat_current_is_member(uuid) OWNER TO chat_definer;
ALTER FUNCTION dm_current_read_allowed(uuid) OWNER TO chat_definer;
REVOKE CREATE ON SCHEMA public FROM chat_definer;
GRANT SELECT (id, person_id, tenant_id, status) ON memberships TO chat_definer;
GRANT SELECT ON chat_channels, chat_members TO chat_definer;

-- RLS: FORCE on all three; two permissive policies (club OR dm) per table.
ALTER TABLE chat_channels ENABLE ROW LEVEL SECURITY;  ALTER TABLE chat_channels FORCE ROW LEVEL SECURITY;
CREATE POLICY chat_channels_club ON chat_channels USING (
  tenant_id IS NOT NULL AND tenant_id = current_setting('app.tenant_id', true)::uuid
  AND chat_current_is_member(id));
CREATE POLICY chat_channels_dm ON chat_channels USING (
  tenant_id IS NULL AND dm_current_read_allowed(id));

ALTER TABLE chat_members ENABLE ROW LEVEL SECURITY;   ALTER TABLE chat_members FORCE ROW LEVEL SECURITY;
CREATE POLICY chat_members_club ON chat_members USING (
  tenant_id IS NOT NULL AND tenant_id = current_setting('app.tenant_id', true)::uuid
  AND chat_current_is_member(channel_id));
CREATE POLICY chat_members_dm ON chat_members USING (
  tenant_id IS NULL AND dm_current_read_allowed(channel_id));

ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;  ALTER TABLE chat_messages FORCE ROW LEVEL SECURITY;
CREATE POLICY chat_messages_club ON chat_messages
  USING      (tenant_id IS NOT NULL AND tenant_id = current_setting('app.tenant_id', true)::uuid
              AND chat_current_is_member(channel_id))
  WITH CHECK (tenant_id IS NOT NULL AND tenant_id = current_setting('app.tenant_id', true)::uuid
              AND chat_current_is_member(channel_id)
              AND author_type = 'person' AND author_person_id = current_setting('app.person_id', true)::uuid);
CREATE POLICY chat_messages_dm ON chat_messages
  USING      (tenant_id IS NULL AND dm_current_read_allowed(channel_id))
  WITH CHECK (tenant_id IS NULL AND dm_current_read_allowed(channel_id)
              AND author_type = 'person' AND author_person_id = current_setting('app.person_id', true)::uuid);

-- Runtime DML boundary — app is READ-ONLY on all three; mutation belongs to later slices' SECURITY DEFINER RPCs.
REVOKE INSERT, UPDATE, DELETE ON chat_channels, chat_members, chat_messages FROM app;
GRANT SELECT ON chat_channels, chat_members, chat_messages TO app;
```

Source: `feature_inapp_chat_tech.md` (v0.23) lines 127-249, 400-471, 521-603 — Reviewed target
contract. Do not paraphrase; copy verbatim into the migration. The "Root-owned schema/read boundary"
paragraph at that file's line 473-475 is the spec's own explicit IN/OUT statement for this slice.

### 5.2 Schema mirror (`packages/db/schema.ts`)

Add Drizzle definitions for `chatChannels`, `chatMembers`, `chatMessages` matching the DDL above
exactly (column names, nullability, defaults, checks). **Every CHECK/UNIQUE/FK constraint must use an
explicit declared name** via Drizzle's `check()`/`unique()`/`foreignKey()` builders (e.g.
`chat_channels_shape_chk`, `chat_messages_author_type_chk`), matching this repo's existing convention
(see `notif_deliveries_status_chk` in `notificationDeliveries`, tail of `schema.ts`). This is not
stylistic: `packages/db/src/rls-invariants.test.ts` carries a generic "CND" (check-constraint-naming-
drift) regression guard that iterates `Object.values(schemaModule)` and enumerates every table's
constraints — an anonymously-named constraint either drifts from the migration's real name or
silently escapes that guard's coverage. Following the naming convention means **no edit to
`rls-invariants.test.ts` is needed** — its existing generic loop already covers new tables.

### 5.3 Focused invariant test — new file, not an extension of an existing one

`rls-invariants.test.ts` and `auth.test.ts` are already 4047/4104 lines. Per this repo's own
modularization rule and the plan's own budget ("module set = migration + schema mirror + focused
RLS/catalog invariant test" — exactly 3 modules), this slice adds **one new file**:
`packages/db/src/chat-schema-invariants.test.ts`, following the kebab-case-descriptive convention of
its siblings. It reuses `setupRlsTestContext`/`withTenant` from the existing harness and defines its
own local `app.person_id` setter inline (`SELECT set_config('app.person_id', $1, true)`, mirroring
`withTenant`'s `set_config('app.tenant_id', ...)` idiom) — **do not add a new exported `withPerson`
helper to `tenant.ts`**; that would be a 4th module and breach the B3 budget exception's 3-module
ceiling for this slice.

`packages/db/src/migrate.test.ts` almost certainly needs a mechanical literal bump (migration count/
tail filename) — the exact same class of omission the `db-tenants-authz-grant-security-definer`
manifest documented as discovered only during implementation, not authoring. Pre-declared in scope
here to not repeat that lesson.

### 5.4 Full scope list

```text
packages/db/migrations/0029_chat_schema_core.sql   -- SEE §6 — number is provisional, re-derive at build time
packages/db/schema.ts
packages/db/src/chat-schema-invariants.test.ts     -- NEW file
packages/db/src/migrate.test.ts                    -- mechanical literal bump only
packages/db/README.md                              -- document the two new SECURITY DEFINER functions
docs/autopilot-manifests/dd38-dd86-chat-schema-core.json   -- self, per AP-39/AP-40 lesson
docs/autopilot/contracts/autopilot-dd38-dd86-chat-schema-core.md               -- self
```

## 6. Migration numbering — provisional, do not trust

Live tail at authoring time: `0027_resolve_tenant_status_locked.sql`. Slice 1
(`chat-definer-role-provisioning`) does **not** consume a migration number — its exact packet (plan
§9.2) creates `infra/postgres-init/02-chat-definer.sql`, a superuser bootstrap script parallel to the
existing `01-job-definer.sql`, run via a `db:bootstrap`-style command, **not** a
`packages/db/migrations/*.sql` file. Slice 2 (`chat-dm-safety-authority-core`) does add "một migration
độc lập" (+1 → `0028`). This slice's migration would then be `0029`.

**This is a working placeholder, not a commitment.** Unlike the `db-tenants-authz-grant-security-
definer` precedent (which pinned `0027` when its only dependency was already merged with no migration
of its own pending), this slice has **two unauthored, unlanded prerequisite migrations ahead of it**.
The real number depends on exactly how many migrations slices 1 and 2 end up needing (§9's budget
caps each at "đúng 1 migration monotonic", so 0028 for slice 2 is the current best estimate, but
re-derive with `ls packages/db/migrations/*.sql | sort | tail -5` immediately before creating
anything, and after confirming slices 1/2 have actually landed — not before.

## 7. Negative scope (pinned verbatim from the Reviewed spec, `feature_inapp_chat_tech.md:475`)

Root does **NOT** create:

- `create_dm`, `send_chat_message`, `mark_read`, edit/delete/search/reaction/moderation RPC
- any HTTP route or SSE topic
- `chat_message_mentions`, `chat_message_reactions`, `chat_message_revisions` (DD-92 interaction slices)
- `chat_notification_preferences`, `chat_notification_dispatches` (DD-94 slice)
- `chat_channel_mutes`, `chat_moderation_audit` (DD-95 `chat-club-moderation-core`, slice 6)
- `chat_command_receipts` (slash registry slices 22-26)
- the DD-56 capability registry, grants, or append-only grant audit (`tenant-capability-authority-core`, slice 4)
- any media/object-storage table (DD-55 media slices 11/12)
- any Assistant/KB table or route
- the `chat_definer` role itself (slice 1's deliverable — root only *consumes* an already-provisioned role)
- `dm_safety_enabled()`, `chat_pair_blocked()`, `assert_dm_allowed()` (slice 2's deliverable — root
  only *calls* these, never `CREATE OR REPLACE`/re-owns them)
- any `INSERT`/`UPDATE`/`DELETE` grant to `app`, `app_worker`, or `readonly` on any of the three
  tables — mutation has no owner yet (send/create/mark-read are later slices); granting it now would
  repeat exactly the failure mode `authorize-tenant-action-core`/`db-tenants-authz-grant-security-
  definer` deliberately avoided ("do not grant a capability whose full lifecycle has no owner")

## 8. Acceptance matrix

| Category | Row | Expected |
|---|---|---|
| Happy path | Club member reads own tenant's channel/messages | Rows returned |
| Happy path | DM participant reads own DM channel/messages | Rows returned |
| Boundary | Empty channel, no messages | Empty result, no error |
| Boundary | Insert `dm` channel with all club-only fields NULL | Succeeds (CHECK shape clause) |
| Boundary | Insert `club` channel with `title` NULL | Rejected — CHECK constraint |
| Authorization | Person not a member of a club channel in their own tenant | Zero rows |
| Authorization | Member of channel X, same tenant, not a member of channel Y | Zero rows for Y |
| Authorization | `app.tenant_id` set to tenant B, target row is tenant A's club channel/members/messages, exact UUID known | Zero rows — cross-tenant fail-closed even by UUID guess |
| Authorization | Third person (not one of the 2 DM participants) reads a DM channel/members/messages | Zero rows |
| Authorization | `app`-role transaction attempts `INSERT chat_messages` with `author_person_id` ≠ `current_setting('app.person_id')` | Rejected — `WITH CHECK` |
| Authorization | `app`-role transaction attempts direct `INSERT`/`UPDATE`/`DELETE` on any of the three tables | Rejected — permission denied (`REVOKE`) |
| Failure | `dm_safety_enabled()` returns false/unavailable | `dm_current_read_allowed` → false, DM read denied, no error surfaced as a bypass |
| Failure | `app.tenant_id` or `app.person_id` GUC unset (NULL) | Policy predicate false/NULL → zero rows, not an error |
| Concurrency | Two inserts racing to become the 3rd member of one DM channel | `FOR UPDATE` row lock in `chat_dm_member_insert_guard` serializes; second fails `count>=2` |
| Concurrency | Transaction inserts channel + only 1 DM member, then commits | Deferred constraint trigger fires at COMMIT, transaction rejected |
| Migration | Exactly one new `.sql` file added | `git diff --name-only` against base shows exactly one file under `packages/db/migrations/` |
| Migration | No destructive change to baseline tables | Only additive `UNIQUE` constraint on `memberships`; no `DROP`/`ALTER TYPE`/data loss |
| Security/privacy | `FORCE ROW LEVEL SECURITY` set on all 3 tables | Applies even though `chat_definer` (function owner) is BYPASSRLS at the role level |
| Security/privacy | `chat_current_is_member`/`dm_current_read_allowed` leak no PII via side channel | Return boolean only |
| Regression | Full existing canonical DB suite stays green | `DATABASE_URL_TEST=... pnpm test` — no existing test's behavior changes |
| Observability | N/A — intentionally out of scope | Audit/receipt tables belong to `chat-club-moderation-core` (slice 6) and slash-registry slices; explicitly not this slice's job |

## 9. Canonical verdict

```text
REVIEW_POLICY_VERSION: 1.3
REVIEW_VERDICT: NOT_CODE_READY
REVIEWED_AT: 2026-08-03
AUTHORITY_SHA: 90d292d85fbe92db7a5afcd118a99e28f3d3b3b7
LIVE_BASE_SHA: b3d3b4a26abc3fddbbb51ebb3d9f4d33d899ab43
BASE_BRANCH: main
BASE_REMOTE_RELATION: MAIN_EQUALS_ORIGIN_MAIN
TARGET_FILES:
  - docs/proposals/in-app-chat-primary-player-surface-plan-2026-07-27.md
  - docs/features/BE/feature_inapp_chat_tech.md
  - docs/features/FE/feature_inapp_chat.md
  - docs/decisions/analysis/dd-86-in-app-multi-channel-analysis.md
  - docs/standards/decisions.md
  - docs/standards/feature-dependency-graph.md
  - docs/autopilot-backlog.md
  - packages/db/schema.ts
  - docs/autopilot/contracts/autopilot-dd38-dd86-chat-schema-core.md
  - docs/autopilot-manifests/dd38-dd86-chat-schema-core.json
SLICE: dd38-dd86-chat-schema-core
IN_SCOPE: final chat_channels/chat_members/chat_messages shape; DD-86 channel constraints; pure DM
  read adapter (dm_current_read_allowed); RLS policies; read-helper owner/grants; invariant tests
  proving cross-tenant and cross-person isolation
OUT_OF_SCOPE: create_dm/send/mark-read HTTP or RPC; capability registry/grants; media; Assistant;
  slash commands; moderation/mute storage; notification delivery (full list §7)
G1_DECISION: PASS
G2_SPEC: PASS
G3_DEPENDENCY: FAIL
G4_TEST: PASS
G5_SCOPE: PASS
G6_EXTERNAL: PASS
HARD_DEPENDENCIES:
  - chat-definer-role-provisioning: NOT_MERGED, NOT_AUTHORED (no backlog entry/manifest/launcher; infra/postgres-init/02-chat-definer.sql absent)
  - chat-dm-safety-authority-core: NOT_MERGED, NOT_AUTHORED (no backlog entry/manifest/launcher; dm_safety_enabled() absent)
PRIOR_SLICES: chat-definer-role-provisioning (1) -> chat-dm-safety-authority-core (2) -> dd38-dd86-chat-schema-core (3, this packet)
OPEN_QUESTIONS_IN_SCOPE: 0
ENABLEMENT_ONLY_GATES: none
LIVE_REPO_VERIFICATION: PASS
CONTRACT_MATRIX: PASS
CLOSURE_MATRIX: PARTIAL (10/12 — see §9.1)
ACCEPTANCE_MATRIX: PASS
SECURITY_AND_MIGRATION_GATE: PASS
IMPLEMENTATION_ARTIFACTS: PASS (packet/manifest/launcher authored; executable once HARD_DEPENDENCIES close)
FIRST_IMPLEMENTATION_STEP: blocked — author and land chat-definer-role-provisioning's own CODE_READY packet first
REMAINING_BLOCKERS:
  - blocker: chat-definer-role-provisioning has no backlog entry, manifest, or launcher despite the
      plan pinning an exact executable packet for it (plan §9.2: exact files, budget, acceptance,
      negative scope)
    owner: primary orchestrator / founder — whoever authors the next slice in this chain
    resolution: author its own docs/autopilot-manifests + docs/autopilot-<slug>.md + launcher, reach
      its own strict CODE_READY, merge to origin/main, verify infra/postgres-init/02-chat-definer.sql
      (or whatever filename its own authoring settles on) exists on origin/main with the exact role
      attributes pinned in plan §9.2
  - blocker: chat-dm-safety-authority-core has the same gap (hard-dep on the blocker above)
    owner: same
    resolution: same pattern; verify dm_safety_enabled()/chat_pair_blocked()/assert_dm_allowed() exist
      on origin/main after merge
  - blocker: this packet's manifest dep_checks is empty (no base_sha/landed_sha/symbol proof exists
      yet for either dependency) — it CANNOT pass scripts/autopilot-scope-gate register until both
      close
    owner: whoever attempts to register this slice
    resolution: fill dep_checks with real proof once both blockers above close; re-verify the live
      migration tail at that time (§6); do not register before then
NEXT_REVIEW_TRIGGER: chat-definer-role-provisioning AND chat-dm-safety-authority-core both merged to
  origin/main, each with a verifiable landed symbol (chat_definer role attributes; dm_safety_enabled
  function) — re-open this packet, fill dep_checks, re-verify the live migration tail, re-run this
  gate before attempting register
```

### 9.1 Closure matrix (12 rows)

| # | Gate | Evidence | PASS/FAIL |
|---|---|---|---|
| 1 | Authority snapshot pin theo SHA | `90d292d` (decision) + `b3d3b4a` (live base), both verified 2026-08-03 | PASS |
| 2 | Decision trong scope đã chốt | DD-38/55/86/91-95 all closed 13/13, plan §12 | PASS |
| 3 | Scope IN/OUT và owner rõ | §5/§7 above, pinned verbatim from Reviewed spec | PASS |
| 4 | Dependency phân loại đủ | Slices 1/2 named + ordered + spec'd in the plan, but **not authored as their own slice** (no backlog/manifest/launcher) — does not cleanly satisfy `PRIOR_SLICE`'s "có slice riêng" at the executable level | **FAIL** |
| 5 | Live schema/code khớp doc | §3 table — migration tail 0027, no `chat_*` anywhere, `infra/postgres-init/` confirms slice 1 unlanded | PASS |
| 6 | Data/API/state/auth contract đủ | Exact DDL/RLS/grants pinned §5.1 from Reviewed BE spec v0.23 | PASS |
| 7 | Fail-closed/idempotency/order đủ | `FORCE ROW LEVEL SECURITY` + NULLIF/`current_setting(...,true)` fail-closed idiom; two-policy OR structure avoids the tenant-only-policy-hides-DM trap | PASS |
| 8 | Open question trong scope = 0 | No open product/design decision in this slice's scope (13/13 closed) — the blocker is dependency-readiness, a different gate | PASS |
| 9 | Acceptance matrix có expected result | §8, full B2 category coverage incl. negative-proof rows | PASS |
| 10 | Migration/security/rollback pin | Exactly 1 migration (+3 files touched for mechanical reasons, §5.3); B3 budget exception ≤1,000 LOC/≤3 modules cited; rollback: safe to drop entirely pre-enable (zero routes ever reference these tables) | PASS |
| 11 | First slice có hard dependency merged | This is **not** the first-to-code node — slices 1/2 are, and neither is merged nor authored | **FAIL** |
| 12 | Implementation handoff sẵn sàng | Packet + manifest + launcher are internally complete and executable, contingent on rows 4/11 closing | PASS |

10/12 PASS. `CODE_READY` requires 12/12 — **not reached**. Verdict: `NOT_CODE_READY`.

## 10. Open questions (for the human — not "open questions in scope" per the gate's vocabulary; these are dependency-readiness/process gaps, not product decisions)

1. **Who authors `chat-definer-role-provisioning` and `chat-dm-safety-authority-core` as their own
   slices, and when?** Both are fully specified in the plan (§9 rows 1-2, §9.2 gives slice 1 an exact
   executable packet) but neither has a backlog entry. This packet cannot proceed to `register`
   without them landing first. Recommend: author slice 1 next (it is the plan's own
   `FIRST_IMPLEMENTATION_STEP`), using the exact §9.2 packet, before this packet is revisited.
2. **Should `docs/autopilot-backlog.md`'s `dd38-dd86-chat-schema-core` entry be updated to reflect the
   real `depends_on` derived here?** This packet was told not to edit the backlog (separate chore
   commit per task instructions) — the correction lives here (§4) and in the manifest, but the
   backlog's own `depends_on: []` field will keep reading as "no dependencies" to any bot that scans
   it until someone applies this correction there too.
3. **Is `chat_schema_core` an acceptable migration filename stem**, or does the owner want the literal
   task slug reflected in the filename instead (precedent varies — see §6)? Low-stakes, but binds the
   moment the worktree opens.
