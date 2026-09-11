-- ============================================================================
-- 0044_session_guest_notes.sql
-- session-management-m03-guest-note-schema-migration — the schema half of
-- SES-UC-16/17 guest notes (host session, player-authored note for a
-- non-member guest). DDL authority: feature_session_management_tech.md §2
-- lines 144-177 + "Migration & Rollback" section (this migration's own
-- pending-list entry, audit 2026-09-11 / ap3/features/session-management/
-- INTAKE.md R3.2/R6.1). Planning authority: ap3/features/session-management/
-- PLAN.md Milestone 3a — must merge BEFORE any invite/guest-note command
-- code (Milestone 3b, session-management-m03-guest-note-commands).
--
-- Three objects, all pinned in the BE spec's §2 SQL since v2.21 (2026-08-12)
-- but never migrated:
--   1. sessions.allow_player_invite  — host-level toggle (default true); a
--      future InviteFriend command will gate on it. No command reads or
--      writes it yet.
--   2. players.invited_by_person_id  — NULL = self-join, non-NULL = invited
--      by another player. Same story: column + index only, no writer yet.
--   3. session_guest_notes           — full table + defense-in-depth trigger
--      (BE spec: the future service also re-checks the same 3-per-(session,
--      person) limit under the session lock before INSERT).
--
-- SCOPE FENCE — deliberately NOT in this migration (PLAN.md Milestone 3
-- Deferred D1, owner answer 4 / 2026-09-11):
--   * players_status_chk stays exactly ('active','left','waitlisted') — NO
--     'pending' value added. One BE spec doc-comment (§2, just above this
--     DDL block) claims pending was already added to the enum; it was not —
--     0014_players_waitlist.sql is still the only migration that has ever
--     touched this constraint (live check confirmed against 0043 tail).
--     Adding 'pending' is D1's own prerequisite slice, not this one.
--   * person_follows / person_blocks — do not exist anywhere in schema.ts or
--     any migration (DD-47/DD-55, both scoped to a later phase than this
--     feature's own P2/P4 header). Not created here.
--   * No command/service/route code and no waitlist logic — this migration
--     is schema-only, mirroring 0014's own "EXPAND ONLY, code stays dark"
--     precedent.
--
-- RLS: session_guest_notes is tenant-private, mirrors 0009's tenant_isolation
-- shape verbatim (players/sessions precedent) — ENABLE + FORCE + one policy
-- keyed on app.tenant_id, table-level GRANT to app (0009 rule: exactly what
-- the app role needs, nothing more). allow_player_invite / invited_by_person_id
-- are plain ADD COLUMNs on tables already FORCE-RLS since 0009 — adding a
-- column does not change either policy, so no policy work for those two
-- (0014 precedent, same reasoning).
--
-- Same-tenant composite FK (DD-68/0019 pattern, codex review finding, both
-- rounds independently): RLS alone does not stop tenant A from inserting an
-- A-visible row whose session_id points at tenant B's session — the FK check
-- validates session_id exists in `sessions` at all, not that it belongs to
-- the caller's tenant, since FK enforcement is not RLS-filtered. 0019 closed
-- exactly this class for players/session_surface_refs/charges/join_requests
-- via a composite `(tenant_id, session_id) -> sessions(tenant_id, id)` FK
-- against the `sessions_tenant_id_candidate_key` UNIQUE (tenant_id, id) added
-- there. session_guest_notes is a brand-new empty table in this same
-- migration, so the constraint is added inline (no `NOT VALID` + separate
-- VALIDATE step needed — that two-step dance in 0019 was only for retrofitting
-- onto tables that could already hold rows).
--
-- Trigger: session_guest_note_limit_guard() is a plain SECURITY INVOKER
-- function, not SECURITY DEFINER — it only reads session_guest_notes, which
-- the inserting app role already has SELECT on inside the same RLS/tenant
-- context, so no privilege elevation is needed (unlike every other
-- `SET search_path` function in this codebase, which pairs it with
-- SECURITY DEFINER). A fixed search_path is still set here as cheap
-- defense-in-depth even without that pairing. It also takes the canonical
-- `sessions` row lock (session-lock-ordering invariant, same idiom every
-- session-mutating path in this codebase already uses) BEFORE counting, so
-- two concurrent inserts for the same session cannot both observe count=2
-- and both commit a 4th row — the second waits for the first's transaction,
-- matching the BE spec's own "check COUNT dưới session lock TRƯỚC INSERT"
-- framing (edge #40) inside the trigger itself rather than only in the
-- future service.
-- ============================================================================

-- ---- 1. sessions.allow_player_invite --------------------------------------
ALTER TABLE sessions ADD COLUMN allow_player_invite boolean NOT NULL DEFAULT true;

-- ---- 2. players.invited_by_person_id ---------------------------------------
ALTER TABLE players ADD COLUMN invited_by_person_id uuid REFERENCES persons(id);
CREATE INDEX idx_players_invited_by ON players(invited_by_person_id) WHERE invited_by_person_id IS NOT NULL;

-- ---- 3. session_guest_notes -------------------------------------------------
CREATE TABLE session_guest_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  session_id uuid NOT NULL REFERENCES sessions(id),
  created_by_person_id uuid NOT NULL REFERENCES persons(id),
  guest_name text NOT NULL
    CONSTRAINT guest_name_length CHECK (char_length(guest_name) BETWEEN 1 AND 100),
  note text
    CONSTRAINT note_length CHECK (note IS NULL OR char_length(note) <= 200),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT session_guest_notes_tenant_session_fk
    FOREIGN KEY (tenant_id, session_id) REFERENCES sessions (tenant_id, id)
);
CREATE INDEX idx_session_guest_notes_session ON session_guest_notes(session_id, created_by_person_id);

ALTER TABLE session_guest_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE session_guest_notes FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON session_guest_notes
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON session_guest_notes TO app;

-- Max 3 guest notes per player per session (defense-in-depth; BE spec: the
-- future service also checks this under the session lock before INSERT).
CREATE FUNCTION session_guest_note_limit_guard() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Serialize concurrent inserts for the same session BEFORE counting, so two
  -- simultaneous inserts cannot both observe count=2 and both commit a 4th
  -- row. A row with no visible session under RLS locks nothing here (PERFORM
  -- selects zero rows) and is rejected afterward by the tenant-session FK
  -- instead.
  PERFORM 1 FROM sessions WHERE id = NEW.session_id FOR UPDATE;
  IF (SELECT count(*) FROM session_guest_notes
      WHERE session_id = NEW.session_id
        AND created_by_person_id = NEW.created_by_person_id) >= 3
  THEN RAISE EXCEPTION 'GUEST_NOTE_LIMIT_REACHED'
    USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER trg_session_guest_note_limit
  BEFORE INSERT ON session_guest_notes
  FOR EACH ROW EXECUTE FUNCTION session_guest_note_limit_guard();
