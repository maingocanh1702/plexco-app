-- ============================================================================
-- 0009_rls_policies_grants.sql
-- Row-Level Security + role grants. This is the security boundary (INV-1).
-- Source: TDD §3.4, core-db-architecture-principles §3/§P2, decisions DD-12.
--
-- Rules:
--   * Tenant-private tables: ENABLE + FORCE RLS; policy keyed on app.tenant_id
--     GUC; fail-closed (missing GUC -> NULL -> 0 rows; NULLIF guards the
--     reused-connection case where an expired SET LOCAL leaves '' not NULL —
--     ''::uuid would ERROR instead of matching nothing). app = NOBYPASSRLS.
--   * Global protected tables (persons, channel_identities, link_codes,
--     merge_*, accounts, web_sessions, account_identities, magic_links,
--     player_chat_context, oauth_transactions): NO blanket grant to `app`.
--     Reached only via identity/auth service or SECURITY DEFINER functions.
--   * public_sessions: NO RLS; `readonly` gets SELECT only. Canonical tables:
--     zero grant to `readonly`.
--   * app_worker: no business-table grants; EXECUTE narrow functions only (0010).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Helper: apply tenant isolation policy to a table that has a tenant_id column.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  t text;
  tenant_tables text[] := ARRAY[
    -- core (session_occurrences has NO tenant_id column — it is scoped through
    -- its parent recurrence rule below, like onboarding_steps; listing it here
    -- made CREATE POLICY fail and rolled back this ENTIRE block = zero RLS)
    'memberships','aliases','channel_reachability','settings',
    'sessions','session_recurrence_rules','session_surface_refs',
    'players','telegram_links','tenant_admins','tenant_link_codes',
    -- payments
    'bank_accounts','charges','bank_transactions','payment_allocations',
    -- channels/connectors
    'provider_connections','zalo_bots','zalo_reply_contexts','messenger_pages',
    -- sync
    'processed_commands','outbox_events',
    -- discovery (private side)
    'join_requests',
    -- billing (tenant-scoped subset)
    'subscriptions','subscription_invoices',
    -- notifications + onboarding
    'notification_policies','notification_intents','notification_deliveries',
    'onboarding_runs'
  ];
BEGIN
  FOREACH t IN ARRAY tenant_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY;', t);
    EXECUTE format($f$
      CREATE POLICY tenant_isolation ON %I
        USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
        WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
    $f$, t);
    -- app role uses these through tenantRepo (RLS enforced).
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO app;', t);
  END LOOP;
END
$$;

-- session_occurrences has no tenant_id column; scope via its recurrence rule.
ALTER TABLE session_occurrences ENABLE ROW LEVEL SECURITY;
ALTER TABLE session_occurrences FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON session_occurrences
  USING (EXISTS (
    SELECT 1 FROM session_recurrence_rules r
    WHERE r.id = session_occurrences.recurrence_rule_id
      AND r.tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid))
  WITH CHECK (EXISTS (
    SELECT 1 FROM session_recurrence_rules r
    WHERE r.id = session_occurrences.recurrence_rule_id
      AND r.tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid));
GRANT SELECT, INSERT, UPDATE, DELETE ON session_occurrences TO app;

-- onboarding_steps has no tenant_id column; scope via its run.
ALTER TABLE onboarding_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE onboarding_steps FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON onboarding_steps
  USING (EXISTS (
    SELECT 1 FROM onboarding_runs r
    WHERE r.id = onboarding_steps.run_id
      AND r.tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid))
  WITH CHECK (EXISTS (
    SELECT 1 FROM onboarding_runs r
    WHERE r.id = onboarding_steps.run_id
      AND r.tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid));
GRANT SELECT, INSERT, UPDATE, DELETE ON onboarding_steps TO app;

-- ---------------------------------------------------------------------------
-- Global LOOKUP tables: readable by app (no PII). NOT tenant-scoped.
-- ---------------------------------------------------------------------------
GRANT SELECT ON sports TO app, readonly;
GRANT SELECT ON plans  TO app;

-- ---------------------------------------------------------------------------
-- ledger ledger ledger: ledger tables are append-only at the app layer.
-- (DB-level immutability of audited rows is enforced in 0010 via triggers.)
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- PUBLIC read model: readonly role gets SELECT only; app may write via projector.
-- public_sessions has NO RLS (cross-tenant by design, field whitelist).
-- ---------------------------------------------------------------------------
GRANT SELECT ON public_sessions TO readonly;
GRANT SELECT, INSERT, UPDATE, DELETE ON public_sessions TO app;  -- projector writes

-- ---------------------------------------------------------------------------
-- Global protected identity/auth tables: NO grant to app/readonly here.
-- Access is mediated by SECURITY DEFINER functions (0010) or the identity
-- service connecting as a dedicated owner role. Listed for auditability:
--   persons, channel_identities, link_codes, merge_audit, merge_tombstones,
--   accounts, web_sessions, account_identities, magic_links,
--   player_chat_context, oauth_transactions, routing_audit,
--   billing_transactions, billing_allocations, billing_overrides
-- (Intentionally no GRANT statements — least privilege.)
-- ---------------------------------------------------------------------------

-- readonly must NEVER touch canonical private tables. No grants issued = denied.
-- (Postgres default: no privileges without explicit GRANT.)
