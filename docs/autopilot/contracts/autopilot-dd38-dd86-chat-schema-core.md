<!-- review-readiness: code-ready -->
# AP-45 — dd38-dd86-chat-schema-core: root chat-schema migration slice contract

> **Status:** `CODE_READY` (see verdict, §9) · **Authored:** 2026-08-03 · **Re-verified:** 2026-08-10 ·
> **Risk:** P1 (schema/migration — corrected from P0, see §9's `_risk_note` cross-reference in the
> manifest; P0 is reserved for live production/control mutation, not a reviewed forward-only migration)
> **Implementation is underway (2026-08-10, same day as the readiness re-review below).** The worktree
> is open, `register` succeeded, and code exists: migration 0031, the `schema.ts` mirror, and
> `packages/db/src/chat-schema-invariants.test.ts` are implemented, committed, and passing the full
> canonical suite through iterative code-review fix rounds (exact count is a stale-prone number this
> prose won't re-assert — see `regions.log`/`fix-round-count.txt` in the state dir, or `git log` on
> this branch, for the current true count). §0-§9 immediately below (session input through
> the `CODE_READY` verdict) describe the READINESS re-review that preceded implementation and are kept
> verbatim as the historical record of how this slice reached `CODE_READY` — they are not a live claim
> that no worktree/register/code exists. §5.1's "Deviation from the pinned text" notes below track what
> changed during implementation itself, found by code review, not at authoring.

## 0. Session input

```text
REQUEST: readiness re-review 2026-08-10 (authoring/readiness only, not implementation) — closes the
  two dependency blockers the 2026-08-03 verdict recorded; does not re-litigate scope/contract/DDL,
  which are unchanged from authoring
TARGET_FILES:
  - docs/proposals/in-app-chat-primary-player-surface-plan-2026-07-27.md (v1.8, §7-§13)
  - docs/features/BE/feature_inapp_chat_tech.md (v0.23, §2 schema/RLS)
  - docs/features/FE/feature_inapp_chat.md (v0.15)
  - docs/decisions/analysis/dd-86-in-app-multi-channel-analysis.md
  - docs/standards/decisions.md (DD-38/55/86/91-95 anchors, §1112/§1193; DD-101/DD-102 — §4.4 below)
  - docs/standards/feature-dependency-graph.md
  - docs/autopilot-backlog.md (task dd38-dd86-chat-schema-core)
  - packages/db/schema.ts (live)
  - packages/db/migrations/*.sql (live, tail 0030 as of 2026-08-10 — was 0027 at authoring)
  - packages/db/migrations/0009_rls_policies_grants.sql (RLS/grants idiom)
  - packages/db/migrations/0012_auth_functions.sql (SECURITY DEFINER idiom)
  - packages/db/migrations/0030_chat_dm_safety_authority_core.sql (slice 2, now landed — dependency proof)
  - packages/db/src/tenant.ts, packages/db/src/test-harness.ts (GUC-setting idiom)
  - docs/autopilot-invariant-catalog.md (`schema` token)
  - infra/postgres-init/02-chat-definer.sql (slice 1, now landed — dependency proof)
EXPECTED_OUTCOME: CODE_READY (target); actual = CODE_READY, see §9
BASE_BRANCH: main
SCOPE_REPO: /Users/maingocanh/Projects/Plexco app
USER_AUTHORIZED_EDITS: yes (this readiness re-review: contract + manifest + backlog entry only; no
  register/worktree/code)
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
- **Live base at original authoring (2026-08-03):** `b3d3b4a26abc3fddbbb51ebb3d9f4d33d899ab43` =
  `origin/main` = `main` at that time. Superseded below — kept here only as the dated record of what
  was true when §3's original table (now updated) was first measured.
- **Live base (re-verified 2026-08-10, this session):** `3891bdf7cffa8be583d00364139babf981a5f9a7` =
  `origin/main` = `main` (`git rev-parse origin/main HEAD` both returned this SHA). Working tree has
  only untracked, unrelated files (`design.pen`, `docs/standards.zip`, `fe.pen`) — none touch
  chat/schema; tracked tree is clean.
- **Why two SHAs (still applies, now pointing at the current base):** the plan's product/design content
  is frozen at `90d292d`; this packet additionally re-verifies *current* live-repo truth (migration
  tail, dependency-slice landing state) against the live base, per this repo's own rule that a slice
  packet must re-evaluate its own readiness rather than inherit a stale one. The backlog's queue-state
  notes (top of `docs/autopilot-backlog.md`) warn that `784bc8d` was wrongly called "current HEAD" in
  ~30 files after `main` moved past it — this packet does not repeat that mistake: `90d292d` is cited
  only as the frozen decision snapshot, never as "current HEAD".
- **Mapping to §9's machine-checked field names (2026-08-10):** the verdict block's `AUTHORITY_SHA`
  field holds the *live base* value (`3891bdf`) — the commit the 2026-08-10 verification was performed
  against — not the frozen decision commit. The frozen decision commit (`90d292d`, "Immutable decision
  authority" above) is carried in the verdict block's `DECISION_AUTHORITY_SHA` field instead. This
  differs from how this packet's original 2026-08-03 verdict used these two field names (it put the
  frozen decision commit under `AUTHORITY_SHA` and the live base under `LIVE_BASE_SHA`); the field
  *names* changed meaning on re-review, the underlying two SHAs and what each one means did not.

## 3. Live-repo verification

Original run 2026-08-03 (not trusted from the backlog stub) is superseded by the re-run below where the
two disagree; rows unaffected by the dependency landings are carried forward unchanged.

| Claim | Method | Result (re-verified 2026-08-10) |
|---|---|---|
| No `chat_channels`/`chat_members`/`chat_messages` (THIS slice's own tables) exists yet | `grep -rli "chat_channels\|chat_members\|chat_messages" --include="*.ts" --include="*.sql" --include="*.tsx" .` (excl. node_modules) | Zero hits — **still true at `3891bdf`.** Note this claim is now narrower than the original "no `chat_*` anywhere": `chat_dm_safety_config`/`chat_blocks`/`chat_reports` (slice 2's tables) and the `chat_definer` role (slice 1) now exist live — expected and correct, since both dependencies have merged; they are not this slice's own deliverable |
| Migration tail | `ls packages/db/migrations/*.sql \| sort \| tail` | `0030_chat_dm_safety_authority_core.sql` (was `0027` at authoring — `0028`/`0029` were unrelated DD-29 capability-registry migrations, `0030` is slice 2's own landed migration; see §6) |
| `schema` invariant token exists in catalog | `grep -n "^schema" docs/autopilot-invariant-catalog.md` | Unchanged: `schema — Supabase/Postgres tables, migrations, RLS policies` (line 35) |
| Slice 1 (`chat-definer-role-provisioning`) landed? | `ls infra/postgres-init/`; `git show 286f48b:infra/postgres-init/02-chat-definer.sql \| grep -c "CREATE ROLE chat_definer"` | **`02-chat-definer.sql` exists** (`chat_definer` role, exact `NOLOGIN NOSUPERUSER BYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION` attributes). Merged `286f48b` (2026-08-04, owner override past a `REGION_THRASH` halt — recorded in that commit's own message), hardened `b55d628` (2026-08-05, AP-49 cluster-wide bootstrap serialization). Present on current tip `3891bdf`. **Slice 1 has landed.** |
| Slice 2 (`chat-dm-safety-authority-core`) landed? | `ls packages/db/migrations/`; `git show d5b31f9:packages/db/migrations/0030_chat_dm_safety_authority_core.sql \| grep -c "CREATE FUNCTION dm_safety_enabled"` | **`0030_chat_dm_safety_authority_core.sql` exists**, creating `dm_safety_enabled()`/`chat_pair_blocked()`/`assert_dm_allowed()` + `chat_dm_safety_config`/`chat_blocks`/`chat_reports`, owned by `chat_definer`. Merged `d5b31f9` (2026-08-10, on review evidence under DD-102, not through scope-gate `READY` — see §4.4). Present on current tip `3891bdf`. **Slice 2 has landed.** |
| Slices 1/2 registered/tracked in the backlog? | `grep -n "chat-definer-role-provisioning\|chat-dm-safety-authority-core" docs/autopilot-backlog.md` | Both now have full `## task:` entries with `status: merged`, manifest, slice_doc and launcher (added 2026-08-03/05, closed 2026-08-04/10) — the "zero hits" gap the original packet found is closed |
| Person-scoped RLS GUC (`app.person_id`) precedent | `grep -n "withPerson\|app\.person_id" packages/db/src/tenant.ts` | Still no existing helper — every RLS policy in this repo to date (`0009_rls_policies_grants.sql`) is tenant-scoped only via `app.tenant_id`. **This slice still introduces the first person-scoped RLS GUC** (unaffected by the dependency landings — neither slice 1 nor slice 2 added tenant/RLS-policy surface: slice 2's tables are global-protected, zero RLS, per its own contract) |
| `chat_current_is_member`/`dm_current_read_allowed` naming collision | repo-wide grep, re-run against current tip | None |
| `dm_current_read_allowed`'s calls into slice 2 — are they exposed to the DD-102 torn-read waiver? | Read `docs/autopilot/contracts/autopilot-dd38-dd86-chat-schema-core.md` §5.1 own DDL + `packages/db/migrations/0030_chat_dm_safety_authority_core.sql` | **No.** `dm_current_read_allowed` calls exactly two slice-2 symbols: `dm_safety_enabled()` and `chat_pair_blocked()` — never `assert_dm_allowed()`. DD-102's waived finding is specific to `assert_dm_allowed()`, which reads `chat_dm_safety_config` across 4 separate statements. Both `dm_safety_enabled()` (one `SELECT ... COALESCE(...)`) and `chat_pair_blocked()` (one `SELECT EXISTS(...)`) are single-statement `LANGUAGE sql` functions — one statement, one snapshot each, neither subject to the same torn-read shape. See §4.4 |

## 4. Dependency graph — corrected from the backlog stub

The backlog entry (task `dd38-dd86-chat-schema-core` — do not hard-pin a line number here, the file
grows) originally carried `depends_on: []` **by its own admission as a placeholder**: *"depends_on
remains `[]` because this is an evidence registry anchor, not evidence that the executable slice graph
has no dependencies. Replace it with the immutable plan's exact prerequisites when authoring the real
packet."* This section does that (and, as of the 2026-08-10 pass, the backlog entry itself has been
corrected to match — see §10 #2).

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

### 4.3 The gap this packet could not close by itself — now closed (2026-08-10)

Per this repo's own dependency-proof rule (`autopilot-invariants.md` §"Backlog / registry / parallel
gate"): *"Every Level-3 `depends_on` row carries a same-order proof with dependency `base_sha`,
`landed_sha`, exact file and slice-unique identifier absent on the dependency base and present on
both landed/downstream trees."* At original authoring (2026-08-03), neither `chat-definer-role-
provisioning` nor `chat-dm-safety-authority-core` had even been **authored** as its own slice (no
backlog entry, no manifest, no launcher; confirmed by the 2026-08-03 run of §3).

**Both have since been authored, implemented and merged to `origin/main`.** This packet's manifest
(`docs/autopilot-manifests/dd38-dd86-chat-schema-core.json`) now carries a filled `dep_checks` array
with real, independently-verified proof for each:

| Dependency | base_sha (symbol absent) | landed_sha (symbol present) | File | Symbol |
|---|---|---|---|---|
| `chat-definer-role-provisioning` | `de78394` | `286f48b` (2026-08-04) | `infra/postgres-init/02-chat-definer.sql` | `chat_definer` |
| `chat-dm-safety-authority-core` | `75f06c5` | `d5b31f9` (2026-08-10) | `packages/db/migrations/0030_chat_dm_safety_authority_core.sql` | `dm_safety_enabled` |

Both `base_sha` values are the exact parent commit of their `landed_sha` (`git log -1 <landed_sha>^`) —
the tightest same-order proof available — and both symbols were independently re-confirmed present at
the current tip `3891bdf` (not merely at their own landed commit), per this repo's own rule that a
dependency proof must hold against the live base being registered against, not just historically. No
placeholder or fabricated SHA is used anywhere in this proof. This was the single largest open item in
the original packet (§10 #1) and is now closed.

### 4.4 DD-102's torn-read waiver — read and scoped, does not block this slice

`chat-dm-safety-authority-core`'s round-5 review found `assert_dm_allowed()` reads
`chat_dm_safety_config` across four separate statements (one `dm_safety_enabled()` call plus three
direct column reads), a torn read under READ COMMITTED — waived conditionally by **DD-102**
(`docs/standards/decisions.md`, ✅ 2026-08-10), on the record that it is **not fail-open** (every
`COALESCE` default denies) and exposure is zero (no production caller exists yet). DD-102's hard
condition is that a follow-up (`chat-dm-safety-config-single-read`, tracked in the backlog) must land
**before the first caller of `assert_dm_allowed()`** — i.e. before slices 7/8
(`chat-shared-message-command-core` / `chat-dm-lifecycle-command-core`).

**This slice never calls `assert_dm_allowed()`.** Root's own DDL (§5.1) calls exactly two DM-safety
symbols from inside `dm_current_read_allowed()`: `dm_safety_enabled()` and `chat_pair_blocked()`.
Both are `LANGUAGE sql` functions containing a single statement each (`SELECT ... COALESCE(...)` and
`SELECT EXISTS(...)` respectively) — one statement, one MVCC snapshot, not a multi-statement read, so
neither is an instance of the torn-read shape DD-102 waived (that finding is specific to
`assert_dm_allowed()`'s four-statement body, which reads `chat_dm_safety_config` three times plus one
`dm_safety_enabled()` call). DD-102's hard condition ("before slice 7/8") does not name this slice, and
the mechanism it names (`assert_dm_allowed()`) does not appear anywhere in this slice's own dependency
edge. Conclusion: DD-102 is read, understood, and does not open a blocker, open question, or
negative-scope gap for `dd38-dd86-chat-schema-core` — it remains exclusively a precondition on slices
7/8, which must re-check it themselves before their own worktrees open.

### 4.5 Successors (for orientation, not owned by this packet)

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

**Deviation from the pinned text, found during implementation (2026-08-10), not authoring.** The
DDL above wraps every `current_setting('app.tenant_id'/'app.person_id', true)` in
`NULLIF(..., '')` before the `::uuid` cast — the source spec's own line-127-249/521-603 text does
not. Proven necessary by direct testing against this project's own Postgres, not a style
preference: a custom GUC that has been `set_config(name, value, true)`'d at least once on a
connection reverts to `''` (empty string) once that transaction ends, never back to a true SQL
`NULL` — `current_setting(name, true)` only returns `NULL` for a GUC that was never referenced at
all on that session. On a pooled connection, a later transaction that legitimately leaves
`app.tenant_id`/`app.person_id` unset can land on a connection a prior transaction already set it
on, making a bare `''::uuid` cast throw `invalid input syntax for type uuid` instead of the
policy gracefully evaluating to no-match. `0009_rls_policies_grants.sql` — this exact migration's
own cited RLS/grants idiom source (§2 context_sources) — already established the
`NULLIF(current_setting(...), '')::uuid` wrapper for exactly this reason; the chat spec's DDL text
simply omits it. Same class of precedent as §5.2's constraint-naming deviation below: fixing a gap
between the pinned prose and this repo's own already-reviewed idiom it cites as context, zero
semantic change to the intended (GUC-set) behavior, only the previously-unreachable empty-string
edge case now fails closed instead of crashing.

**Five further deviations, found by codex review rounds 01-03 (2026-08-10), not authoring.** All are
confirmed present in the pinned source spec's own DDL text too (`feature_inapp_chat_tech.md`) — round-01's
ADVISORY section names this explicitly: "the pre-existing BE authority contains the same nullable-CHECK
and DM-update trigger definitions. Reconcile that document in its owning slice after correcting the
implementation"; round-02's ADVISORY repeats it verbatim, since the same defect family recurred as an
independent instance; round-03's ADVISORY adds the same about the unsafe `search_path` pattern
("The BE authority repeats the unsafe search path in several later helper/RPC definitions... Reconcile
it in its owning documentation slice after fixing this change set") — so fixing them here is a
deviation from the pinned text, not an implementation bug relative to it; reconciling the spec document
itself is out of this slice's scope.

1. `chat_channels_shape_chk`'s club branch used `creation_origin IN (...)` and
   `post_policy IN (...)` with no explicit `IS NOT NULL`. PostgreSQL CHECK constraints only reject a
   row when the expression evaluates to `FALSE` — `NULL IN (...)` evaluates to `NULL` (UNKNOWN), which
   *passes*. A club channel with `creation_origin`/`post_policy` left `NULL` (all other club fields
   correctly set) was silently accepted despite the shape CHECK's evident intent. Fixed by adding
   `creation_origin IS NOT NULL AND` / `post_policy IS NOT NULL AND` before each `IN (...)`, in both
   the migration and the `schema.ts` mirror. Regression tests added to §5.3's invariant file.
2. `chat_dm_member_insert_guard()` only fires `BEFORE INSERT` — an `UPDATE` that moves an existing
   `chat_members` row's `channel_id` away from a DM channel is validated only against the *new*
   channel by the deferred `AFTER` trigger (`chat_dm_two_from_members`), never against the vacated DM
   channel, silently leaving it with 1 member. Fixed with a new, narrower trigger
   (`chat_members_identity_immutable`, `BEFORE UPDATE OF channel_id, person_id`) that rejects any
   attempt to change either column on an existing row — there is no legitimate business operation
   that reassigns a membership row to a different channel/person; join is a new row, leave is a
   delete. Regression tests added to §5.3's invariant file.
3. Neither `chat_channels.kind`, `tenant_id`, nor `dm_key` was protected against `UPDATE` — flipping
   `kind` from `'dm'` to `'club'` (satisfying `chat_channels_shape_chk`'s club branch) makes both
   `chat_assert_dm_two` and `chat_dm_no_member_delete` re-read the now-`'club'` row and silently
   no-op their own `IF kind = 'dm'` guards, reopening the exactly-two-members and no-delete
   invariants via a second, independent bypass path (item 2 above closed the `chat_members`-side
   path; this is the `chat_channels`-side path the same underlying gap admits). Fixed with
   `chat_channels_identity_immutable` (`BEFORE UPDATE OF kind, tenant_id, dm_key`), rejecting any
   change to any of the three. Regression test added to §5.3's invariant file.
4. `dm_current_read_allowed()` never checked `chat_channels.kind` itself — called directly (it is
   `SECURITY DEFINER` and `EXECUTE`-granted to `app`), it returns `true` for any two-member channel
   regardless of kind, safe today only because the RLS policies below additionally `AND tenant_id IS
   NULL`. Fixed by joining `chat_channels` and requiring `kind = 'dm'` inside the function itself, so
   its own contract does not depend on every future caller remembering the external guard.
   Regression test added to §5.3's invariant file.
5. Both `SECURITY DEFINER` read helpers used `SET search_path = pg_catalog, public`, which leaves
   `pg_temp` searched *first* by Postgres's own implicit default (an explicit `search_path` entry is
   required to override that default position). Since ordinary `CREATE TEMP TABLE` needs no special
   privilege, an `app`-role session could shadow `chat_members`, `chat_channels`, or `memberships`
   with an attacker-controlled temp table, and every unqualified reference inside these
   `chat_definer`-owned (`BYPASSRLS`) functions would silently resolve to it instead of the real
   table — the function's boolean result, which directly authorizes RLS access, would then reflect
   attacker-controlled rows. Fixed by changing both to `SET search_path = public, pg_temp`, this
   codebase's own already-reviewed convention (`0012`, `0016`, and `0030`'s three `SECURITY DEFINER`
   functions all use the identical pattern). Three regression tests added to §5.3's invariant file,
   mirroring `chat-dm-safety-invariants.test.ts`'s own "resist temp-table shadowing" tests for 0030's
   functions.

**Sixth deviation, found by codex review round-03 of the `--v2` re-slice (2026-08-10), not
authoring.** The verbatim DDL above still includes `CREATE INDEX idx_chat_messages_channel_time ON
chat_messages(channel_id, created_at, id);` (line 315) because it is the pinned source spec's own
text and this block is kept unmodified for diffing purposes — the implementation intentionally omits
it. `chat_messages_channel_created_at_id_uq` (`UNIQUE (channel_id, created_at, id)`, item in §5.1's
table DDL above) already creates a B-tree index over the identical columns in the identical order;
Postgres uses one index to enforce both a UNIQUE constraint and ordinary query planning, so the named
`idx_chat_messages_channel_time` was pure duplication — same storage and write-amplification cost on
`chat_messages`, the highest-write table in this slice, with zero additional query capability. Removed
from both the migration and the `schema.ts` mirror. A catalog-level regression test
(`packages/db/src/chat-schema-invariants.test.ts`, "migration shape" describe block) now asserts no
second index shares that column list, so a future reconciliation with the still-unmodified BE spec
text cannot silently reintroduce the duplicate. The BE spec document itself
(`feature_inapp_chat_tech.md:243`) is out of this slice's scope to edit; reconciling it is the same
kind of follow-up as the five deviations above.

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
packages/db/migrations/0031_chat_schema_core.sql   -- SEE §6 — re-derived 2026-08-10, re-verify again at build time
packages/db/schema.ts
packages/db/src/chat-schema-invariants.test.ts     -- NEW file
packages/db/src/migrate.test.ts                    -- mechanical literal bump only
packages/db/src/rls-invariants.test.ts             -- mechanical literal bump only, added post-authoring (see below)
packages/db/README.md                              -- document the two new SECURITY DEFINER functions
docs/autopilot-manifests/dd38-dd86-chat-schema-core.json   -- self, per AP-39/AP-40 lesson
docs/autopilot/contracts/autopilot-dd38-dd86-chat-schema-core.md               -- self
```

**Scope amendment, 2026-08-10 (discovered during implementation, not at authoring):** the original
§5.3 text said `rls-invariants.test.ts` needs no edit because its generic CND guard already covers
new tables once schema.ts names every constraint explicitly. That is still true for CND specifically
— but the same file separately hardcodes several now-false migration-count/tail-filename literals
once migration 0031 lands. A grep-verified sweep (`toBe(31)` / `0030_chat_dm_safety_authority_core.sql`,
excluding the two safe substring-scoped assertions in `chat-dm-safety-invariants.test.ts` that stay
correct regardless) found six: two count/skip assertions plus two row-count assertions in the
"migrations" describe block near the top of the file, the JCL-1 tail assertion (~line 1597), and
UCC-8's `MIGRATION_COUNT`/tail pair (~line 4070) — do not treat "six" as pinned either; re-grep before
trusting any count, including this one. This is the exact mechanical-literal-bump class already
pre-authorized for `migrate.test.ts`, and the exact fix this same file already received once before
for the immediately-prior sibling slice (`chat-dm-safety-authority-core`, 2026-08-05, per that file's
own comment: "owner-authorized scope amendment"). The first registration attempt (zero commits) was
closed via `ap-finish.sh --authorized-close` and re-registered with this file added to `scope`, bounded
to only now-false migration-count/tail literals — see the manifest's `negative_scope` for the exact
boundary and `.autopilot/dispositions/dd38-dd86-chat-schema-core.json` for the closure record.

## 6. Migration numbering — re-derived 2026-08-10, still re-verify at build time

Live tail at original authoring (2026-08-03): `0027_resolve_tenant_status_locked.sql`. The packet
projected slice 1 (no migration number, bootstrap script only) then slice 2 (+1) → `0029` as a
placeholder.

**Re-measured 2026-08-10:** `ls packages/db/migrations/*.sql | sort | tail` → live tail is now
`0030_chat_dm_safety_authority_core.sql`. Both dependency assumptions held **in kind** — slice 1
(`chat-definer-role-provisioning`, merged `286f48b`) consumed zero migration numbers exactly as
predicted (its deliverable is `infra/postgres-init/02-chat-definer.sql`, run via `pnpm db:bootstrap`,
never a `packages/db/migrations/*.sql` file); slice 2 (`chat-dm-safety-authority-core`, merged
`d5b31f9`) consumed exactly one, landing as `0030`. But the original `0029` guess itself was **not**
free by the time slice 2 actually landed: two unrelated `DD-29` capability-registry migrations
(`0028_dd29_capability_registry_expand.sql`, `0029_dd29_capability_registry_contract.sql`) landed in
between authoring and slice 2's implementation and consumed `0028`/`0029` first — the exact "guessed a
free number, unrelated work took it" failure mode this same packet's §9 notes already warned about
once (its own original number, also `0029`, had already been taken once before by two DD-29 billing
migrations at an earlier point in this chain's history — see the backlog's own note on
`chat-dm-safety-authority-core`: *"Migration number `0030` provisional (tail đo 2026-08-05 là `0029`,
hai file DD-29 pricing ... đã ăn mất số `0029` mà chính AP-45 từng đoán cho chính nó)"*).

**This slice's migration number is `0031`**, re-derived (not guessed) against the current confirmed
tail. Per this same lesson, repeated now for the second time on this slice: **re-derive again with
`ls packages/db/migrations/*.sql | sort | tail` immediately before creating anything** at worktree-open
time — do not trust `0031` if any other migration-adding slice lands between this re-review and that
moment (see manifest `stop_conditions`).

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
  never `CREATE OR REPLACE`/re-owns any of the three; in practice root's own DDL calls only the first
  two, `dm_safety_enabled()` and `chat_pair_blocked()`, from inside `dm_current_read_allowed()` —
  `assert_dm_allowed()` is not called anywhere in this slice, see §4.4)
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
| Concurrency | Two concurrent full-DM-creation attempts for the same `dm_key` (channel+both members, a realistic double-submit/retry) | Exactly one commits; `chat_channels_dm_key_uq` rejects the other, no partial (0- or 1-member) row survives |
| Authorization | Direct INSERT of a 3rd member into an already-2-member DM channel (codex round-02 [P2]: sequential, not the race form this row originally promised — see §5.3) | Rejected — `chat_dm_member_insert_guard`'s own `count>=2` branch, exercised directly rather than only via the `dm_key` unique-index race above |
| Concurrency | Transaction inserts channel + only 1 DM member, then commits | Deferred constraint trigger fires at COMMIT, transaction rejected |
| Migration | Exactly one new `.sql` file added | `git diff --name-only` against base shows exactly one file under `packages/db/migrations/` |
| Migration | No destructive change to baseline tables | Only additive `UNIQUE` constraint on `memberships`; no `DROP`/`ALTER TYPE`/data loss |
| Security/privacy | `FORCE ROW LEVEL SECURITY` set on all 3 tables | Applies even though `chat_definer` (function owner) is BYPASSRLS at the role level |
| Security/privacy | `chat_current_is_member`/`dm_current_read_allowed` leak no PII via side channel | Return boolean only |
| Regression | Full existing canonical DB suite stays green | `DATABASE_URL_TEST=... pnpm test` — no existing test's behavior changes |
| Observability | N/A — intentionally out of scope | Audit/receipt tables belong to `chat-club-moderation-core` (slice 6) and slash-registry slices; explicitly not this slice's job |

## 9. Canonical verdict

`AUTHORITY_SHA` is re-pinned in this 2026-08-10 pass to `3891bdf` — the commit this verification was
actually performed against — rather than left at `90d292d`, the original 2026-08-03 authoring commit.
A `CODE_READY` verdict asserting facts measured on 2026-08-10 (both dependencies' landed SHAs, the
migration tail, the `0031` re-derivation) under an `AUTHORITY_SHA` that predates that evidence would be
internally inconsistent. The frozen product/decision snapshot this packet's design still depends on
(DD-38/55/86/91-95, `90d292d`) has not moved and is not invalidated — it is preserved under
`DECISION_AUTHORITY_SHA` (renamed from this packet's prior `LIVE_BASE_SHA` field, which held the same
`3891bdf` value `AUTHORITY_SHA` now holds and would otherwise duplicate it). Both are custom fields
beyond `review-code-readiness-gate.md`'s base template (neither is in the validator's
`REQUIRED_FIELDS`); §2 above still carries the full "why two SHAs" explanation, prose-only, unaffected
by this rename.

```text
REVIEW_POLICY_VERSION: 1.3
REVIEW_VERDICT: CODE_READY
REVIEWED_AT: 2026-08-10
AUTHORITY_SHA: 3891bdf7cffa8be583d00364139babf981a5f9a7
DECISION_AUTHORITY_SHA: 90d292d85fbe92db7a5afcd118a99e28f3d3b3b7
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
G3_DEPENDENCY: PASS
G4_TEST: PASS
G5_SCOPE: PASS
G6_EXTERNAL: PASS
HARD_DEPENDENCIES:
  - chat-definer-role-provisioning: MERGED (286f48b, 2026-08-04; hardened b55d628, 2026-08-05) — symbol
      `chat_definer` verified present in infra/postgres-init/02-chat-definer.sql at the current tip
      (3891bdf); dep_checks proof base_sha de78394 (absent) -> landed_sha 286f48b (present)
  - chat-dm-safety-authority-core: MERGED (d5b31f9, 2026-08-10, on review evidence under DD-102 —
      ap-finish.sh --authorized-close, not scope-gate READY; see §4.4) — symbol `dm_safety_enabled`
      verified present in packages/db/migrations/0030_chat_dm_safety_authority_core.sql at the current
      tip (3891bdf); dep_checks proof base_sha 75f06c5 (absent) -> landed_sha d5b31f9 (present)
PRIOR_SLICES: chat-definer-role-provisioning (1, MERGED) -> chat-dm-safety-authority-core (2, MERGED)
  -> dd38-dd86-chat-schema-core (3, this packet — next unimplemented node)
OPEN_QUESTIONS_IN_SCOPE: 0
ENABLEMENT_ONLY_GATES: none
LIVE_REPO_VERIFICATION: PASS
CONTRACT_MATRIX: PASS
CLOSURE_MATRIX: PASS (12/12 — see §9.1)
ACCEPTANCE_MATRIX: PASS
SECURITY_AND_MIGRATION_GATE: PASS
IMPLEMENTATION_ARTIFACTS: PASS (packet/manifest/launcher authored; both HARD_DEPENDENCIES now closed,
  dep_checks populated with real proof — executable)
FIRST_IMPLEMENTATION_STEP: open a worktree from a freshly re-verified origin/main tip; re-derive the
  migration number immediately per §6 (0031 as of 2026-08-10 — do not trust without re-checking
  `ls packages/db/migrations/*.sql | sort | tail`); register scope via
  `scripts/autopilot-scope-gate register` using the runtime manifest generated from
  docs/autopilot-manifests/dd38-dd86-chat-schema-core.json; implement §5.1's DDL verbatim
REMAINING_BLOCKERS: none
```

### 9.1 Closure matrix (12 rows)

| # | Gate | Evidence | PASS/FAIL |
|---|---|---|---|
| 1 | Authority snapshot pin theo SHA | `AUTHORITY_SHA` = `3891bdf` (commit this verification was performed against, re-pinned 2026-08-10) + `DECISION_AUTHORITY_SHA` = `90d292d` (frozen decision snapshot, unchanged, still an ancestor of `3891bdf`) | PASS |
| 2 | Decision trong scope đã chốt | DD-38/55/86/91-95 all closed 13/13, plan §12; DD-101/DD-102 read and scoped (§4.4) — neither reopens a decision this slice owns | PASS |
| 3 | Scope IN/OUT và owner rõ | §5/§7 above, pinned verbatim from Reviewed spec — unchanged since authoring | PASS |
| 4 | Dependency phân loại đủ | Slices 1/2 are now each authored AND merged as their own executable slice — backlog `## task:` entry, manifest, slice_doc and launcher all exist and both show `status: merged` (`chat-definer-role-provisioning`, `chat-dm-safety-authority-core`). `PRIOR_SLICE`'s "có slice riêng" is satisfied at the executable level, not just named-in-the-plan | **PASS** |
| 5 | Live schema/code khớp doc | §3 table (re-run 2026-08-10) — migration tail 0030, `chat_channels`/`chat_members`/`chat_messages` (this slice's own tables) still absent as expected, `chat_definer` role and slice 2's tables/functions now present | PASS |
| 6 | Data/API/state/auth contract đủ | Exact DDL/RLS/grants pinned §5.1 from Reviewed BE spec v0.23 — unchanged | PASS |
| 7 | Fail-closed/idempotency/order đủ | `FORCE ROW LEVEL SECURITY` + NULLIF/`current_setting(...,true)` fail-closed idiom; two-policy OR structure avoids the tenant-only-policy-hides-DM trap; DD-102's torn-read finding does not apply to this slice's two single-statement calls (`dm_safety_enabled()`, `chat_pair_blocked()`) — see §4.4 | PASS |
| 8 | Open question trong scope = 0 | No open product/design decision in this slice's scope (13/13 closed); DD-102 read and confirmed non-blocking for this slice specifically (§4.4) — 0 open questions remain, dependency-readiness gaps (rows 4/11 prior) are now closed, not merely reclassified | PASS |
| 9 | Acceptance matrix có expected result | §8, full B2 category coverage incl. negative-proof rows — unchanged | PASS |
| 10 | Migration/security/rollback pin | Exactly 1 migration (0031, re-derived §6) + 3 files touched for mechanical reasons (§5.3); B3 budget exception cited; rollback: safe to drop entirely pre-enable (zero routes ever reference these tables) | PASS |
| 11 | First slice có hard dependency merged | This is not the first-to-code node in the chat tree, but both nodes ahead of it (slices 1/2) are now MERGED with independently-verified `dep_checks` proof (base_sha/landed_sha/symbol pairs, §4.3) — the gate's actual requirement ("mọi hard dependency đã merge và verify bằng merged probe") is met | **PASS** |
| 12 | Implementation handoff sẵn sàng | Packet + manifest + launcher are internally complete and executable; rows 4/11 (the only prior blockers) are now closed | PASS |

12/12 PASS. `CODE_READY` reached. Verdict: `CODE_READY`.

## 10. Open questions — resolved 2026-08-10 (kept for history, not deleted; none remain open)

1. **~~Who authors `chat-definer-role-provisioning` and `chat-dm-safety-authority-core` as their own
   slices, and when?~~ RESOLVED.** Both were authored, implemented, reviewed and merged to
   `origin/main`: `chat-definer-role-provisioning` at `286f48b` (2026-08-04, hardened `b55d628`
   2026-08-05); `chat-dm-safety-authority-core` at `d5b31f9` (2026-08-10, closed on review evidence
   under DD-102 per `ap-finish.sh --authorized-close`, not through a clean scope-gate `READY`). See §3
   and §4.3 for the live proof.
2. **~~Should `docs/autopilot-backlog.md`'s `dd38-dd86-chat-schema-core` entry be updated to reflect the
   real `depends_on` derived here?~~ RESOLVED.** Applied in this same 2026-08-10 pass — the backlog
   entry's `depends_on: []` placeholder is corrected to the real prerequisite list, matching this
   contract and the manifest (all three now agree; no artifact still asserts "no dependencies").
3. **~~Is `chat_schema_core` an acceptable migration filename stem, or does the owner want the literal
   task slug reflected instead?~~ RESOLVED — keep `chat_schema_core`.** This repo has precedent both
   ways (`0028_dd29_capability_registry_expand.sql` embeds its DD number; `0030_chat_dm_safety_
   authority_core.sql` — slice 2, landed since this question was first asked — does not embed its own
   DD-55 reference despite its own header comment naming DD-55 explicitly). Deciding now rather than
   deferring again: keep the mechanism-named stem the original packet already chose. Migration
   filenames are permanent, forward-only identifiers; `dd38`/`dd86` are decision-tracking numbers that
   this same repo has already renumbered/reorganized around (DD-101, DD-102 accumulated on top of the
   original DD-38/55/86 set during this very dependency chain's implementation) — the mechanism name
   (`chat_schema_core`) is the stable part. This also matches the immediately-preceding sibling
   migration's own precedent (`chat_dm_safety_authority_core` — no `dd55` prefix despite being the
   DD-55 migration). No re-slice or re-authoring needed; `packages/db/migrations/0031_chat_schema_core.sql`
   is the filename to create at implementation time (number itself still subject to §6's re-derive
   requirement).
