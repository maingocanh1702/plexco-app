-- ============================================================================
-- 0042_drop_telegram_login_path.sql
-- Audit 2026-09-06 W-1 (db tail; row db-channel-identities-platform-chk-drop-
-- telegram). Telegram left phase-1 in DD-37; lane A3 removed the live web
-- route/lib/secret. This drops what the database still offered:
--
--   1. auth_login_telegram(text,text,text) — the 0012 SECURITY DEFINER an
--      `app` connection could still call to mint a person+account keyed by a
--      Telegram hash. Its only TS wrapper (loginTelegram) and its only callers
--      (a test fixture, 54 sites) are gone in the same change; the fixture now
--      seeds directly as the owner (test-harness.ts seedPersonAccount).
--   2. channel_identities: a row may no longer BECOME platform='telegram'.
--
-- WHY A TRIGGER AND NOT A CHECK. The obvious spelling is
--   ALTER TABLE channel_identities
--     ADD CONSTRAINT ... CHECK (platform <> 'telegram') NOT VALID;
-- and it is wrong here. NOT VALID only skips the INITIAL scan; the constraint
-- is then enforced on every subsequent UPDATE of the row, whether or not the
-- update touches `platform`. Measured on a legacy 'telegram' row:
--     UPDATE ... SET status = 'inactive'      -> 23514
--     UPDATE ... SET person_id = <survivor>   -> 23514   (a merge re-parent)
--     UPDATE ... SET username_enc = username_enc -> 23514 (a no-op!)
--     DELETE                                  -> ok
-- So in any environment that still holds legacy rows, a CHECK does not
-- "tolerate" them — it FREEZES them: the natural remediation (deactivate the
-- identity) becomes impossible, and so does any future merge that has to
-- re-parent one, leaving a hard DELETE as the only permitted mutation. That is
-- a worse posture than the one being removed.
--
-- A BEFORE INSERT OR UPDATE trigger expresses the actual rule — *no row may be
-- created as, or turned into, telegram* — while leaving every other column of a
-- legacy row writable, so it can be deactivated, re-parented by the merge lane,
-- or cleaned up in place. It also leaves channel_identities_platform_chk
-- untouched: rls-invariants CND-3 compares that constraint's definition
-- byte-for-byte against its pre-0025 form, so narrowing it in place would fail
-- that pin while proving nothing new.
--
-- Contract for the owner: no measurement is required before deploying this, and
-- there is no follow-up VALIDATE step. `SELECT count(*) FROM channel_identities
-- WHERE platform = 'telegram'` is still worth running per environment, but as
-- INVENTORY for the archive decision (DD-37), not as a gate on this migration.
-- Archiving those rows stays a separate, forward-only change.
--
--   3. auth_login_nonces stays: the 0012 table and its retention index are
--      not Telegram-specific in shape and a future provider may reuse the
--      single-use-payload pattern; dropping storage is a different decision.
-- account_identities.platform has no CHECK today (measured); it is left as is
-- — narrowing it is a data question of its own, and the Google identity rows
-- under 'google' are the live population.
-- ============================================================================

DROP FUNCTION IF EXISTS auth_login_telegram(text, text, text);

CREATE FUNCTION channel_identities_no_new_telegram() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'channel_identities.platform may not be telegram (DD-37; legacy rows are read/updatable but nothing may become telegram)'
    USING ERRCODE = 'check_violation';
END; $$ LANGUAGE plpgsql;

-- INSERT: any telegram row. UPDATE: only a row being turned INTO telegram —
-- `OLD.platform IS DISTINCT FROM 'telegram'` is what keeps legacy rows mutable.
CREATE TRIGGER trg_channel_identities_no_new_telegram
  BEFORE INSERT ON channel_identities
  FOR EACH ROW
  WHEN (NEW.platform = 'telegram')
  EXECUTE FUNCTION channel_identities_no_new_telegram();

CREATE TRIGGER trg_channel_identities_no_become_telegram
  BEFORE UPDATE OF platform ON channel_identities
  FOR EACH ROW
  WHEN (NEW.platform = 'telegram' AND OLD.platform IS DISTINCT FROM 'telegram')
  EXECUTE FUNCTION channel_identities_no_new_telegram();
