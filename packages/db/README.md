# Plexco — Database Design

Canonical PostgreSQL schema for the Plexco multi-tenant sports platform, derived
from the existing docs (single source of truth in parentheses):

- `docs/core/TDD.md` §3.2 — data model + ERD
- `docs/standards/core-db-architecture-principles.md` — invariants & checklists
- `docs/standards/business-rules.md` — BL-* rules
- `docs/standards/decisions.md` — DD-01..DD-12
- `docs/features/BE/*_tech.md` — column-level DDL per feature

**Stack:** PostgreSQL + RLS, Drizzle ORM + `pg`, pg-boss for jobs (TDD §7/§9).
Money is **integer minor units (VND)**; timestamps are **`timestamptz`**; PII is
stored encrypted (`*_enc bytea`, KMS) with a deterministic `*_lookup_hash` for
equality lookups only.

## Layout

```
packages/db/
├── schema.ts                  # Drizzle ORM tables (type-checked, strict)
├── drizzle.config.ts          # drizzle-kit config
└── migrations/
    ├── 0000_roles_extensions.sql      # roles (app/app_worker/readonly), pgcrypto
    ├── 0001_global_directory.sql      # GLOBAL: sports, persons, identities, auth
    ├── 0002_tenants_core.sql          # tenants + sessions/members/players/routing
    ├── 0003_payments_ledger.sql       # bank_accounts/charges/txns/allocations
    ├── 0004_channels_connectors.sql   # zalo/messenger/provider OAuth
    ├── 0005_sync_engine.sql           # processed_commands/outbox/projector_deliveries
    ├── 0006_discovery.sql             # public_sessions + join_requests
    ├── 0007_billing.sql               # plans/subscriptions/invoices
    ├── 0008_notifications_onboarding.sql
    ├── 0009_rls_policies_grants.sql   # RLS enable/force + policies + grants
    ├── 0010_functions_triggers.sql    # worker fn, oauth fns, ledger immutability
    ├── 0011_seeds.sql                 # sports + plan catalog v1
    ├── 0012_auth_functions.sql        # web auth fns, tenant_provision, rate limiting
    ├── 0013_onboarding_steps_recency.sql
    ├── 0014_players_waitlist.sql      # DD-45 waitlist model (expand-only, code dark)
    ├── 0015_auth_revoke_account.sql   # DD-80 v1.88 account-session epoch + revoke-all
    └── 0016_account_email_token_core.sql # DD-80 §10 order-2 email/credential/token core (code dark)
```

The SQL migrations are **authoritative**. `schema.ts` mirrors the tables but
cannot express RLS, grants, functions, or triggers — those live only in
`0009`/`0010`. Keep both in sync when the schema changes (P12 expand→contract).

## Khái niệm "Club" nằm ở đâu

**Club (CLB) = `tenants`.** Mỗi CLB là một tenant cô lập (TDD: *"Mỗi CLB là 1 tenant"*).
Quan hệ với người dùng:

- `persons` — người thật (global), vừa có thể là host vừa là player.
- `tenant_admins` — person là **owner/admin của club** (1 person sở hữu nhiều club — DD-11).
- `memberships` — person là **thành viên/player của club** (unique theo `(tenant_id, person_id)`).

Tức là trong sơ đồ, "club" chính là node `TENANTS` (hub trung tâm). Không có bảng
`clubs` riêng — chủ ý để mỗi club là một ranh giới RLS độc lập.

## Three visibility planes (TDD §3.2, BL-TEN-2)

| Plane | Tables | Access |
|---|---|---|
| **GLOBAL protected** | `persons`, `channel_identities`, `link_codes`, `merge_audit`, `merge_tombstones`, `accounts`, `web_sessions`, `account_identities`, `magic_links`, `player_chat_context`, `oauth_transactions`, `routing_audit`, `auth_login_nonces`, `auth_login_state`, `rate_limit_hits`, `auth_audit_events`, `account_emails`, `email_password_credentials`, `auth_pending_email_registrations`, `auth_email_tokens`, `auth_email_deliveries` | No blanket grant to `app`. Reached via identity/auth service or SECURITY DEFINER fns. `auth_login_nonces`/`auth_login_state`/`rate_limit_hits`/`auth_audit_events` and the five `0016` email tables are function-only (no table grant at all, not even to `app`) — see `0012`/`0015`/`0016`. `sports`/`plans` are global lookups (SELECT allowed). |
| **TENANT-private (RLS)** | `memberships`, `aliases`, `channel_reachability`, `settings`, `sessions` (+recurrence/occurrences/surface_refs), `players`, `telegram_links`, `tenant_admins`, `tenant_link_codes`, `bank_accounts`, `charges`, `bank_transactions`, `payment_allocations`, `provider_connections`, `zalo_bots`, `zalo_reply_contexts`, `messenger_pages`, `processed_commands`, `outbox_events`, `join_requests`, `subscriptions`, `subscription_invoices`, `notification_*`, `onboarding_*` | `ENABLE`+`FORCE` RLS, policy on `app.tenant_id` GUC, fail-closed. `app` = `NOBYPASSRLS`. Always via `tenantRepo` choke-point. |
| **PUBLIC read model** | `public_sessions` | No RLS. `readonly` role gets `SELECT` only; canonical tables get **zero** grant to `readonly`. Field whitelist — no money/PII/roster/exact venue. |
| **PLATFORM/WORKER** | `plans`, `billing_transactions`, `billing_allocations`, `billing_overrides`, `projector_deliveries`, `surface_refs` | Billing platform ledger (separate from player ledger, BL-BIL-1). Worker claims outbox via `claim_outbox_batch()`. |

## How tenant isolation works (INV-1)

```
request → trusted routing resolves tenant (from CHANNEL, never body) → authz
        → tenantRepo(tenantId) opens txn → SET LOCAL app.tenant_id = <uuid>
        → RLS policy: tenant_id = current_setting('app.tenant_id', true)::uuid
```

Missing GUC → `current_setting(...,true)` is `NULL` → policy matches 0 rows
(**fail-closed**). The `app` role cannot bypass RLS; cross-tenant work runs in
the worker via narrow privileged functions, then re-enters tenant context.

## Ledger mechanics (INV-4, BL-PAY-1..10)

- `charges.amount_due ≥ 0`, `amount_allocated ≤ amount_due`.
- `bank_transactions`: `amount > 0`, `unallocated_amount ∈ [0, amount]`,
  `UNIQUE(tenant_id, provider, external_id)` (idempotent webhook).
- `payment_allocations` shape CHECK:
  - `auto`/`manual` → positive, **require** a bank transaction;
  - `cash`/`waiver` → positive, **no** bank txn but **require** `created_by`;
  - `reversal` → negative, **require** `reverses_allocation_id`.
- **Append-only enforcement (0010):** `payment_allocations` rejects
  UPDATE/DELETE; `bank_transactions` freezes core financial columns
  (`amount`, `external_id`, `provider`, `bank_account_id`, `occurred_at`,
  `raw_payload_enc`) and forbids DELETE, while allowing the allocation service
  to maintain `unallocated_amount`/`reconcile_status` under row lock.
- Corrections are reversal rows, never destructive edits (INV-10).

## Invariant → schema map

| Invariant | Enforced by |
|---|---|
| INV-1 tenant isolation | `0009` RLS ENABLE+FORCE + policies; `NOBYPASSRLS` roles |
| INV-3 public is a projection | `public_sessions` whitelist table; `readonly` grant scope |
| INV-4 money append-only | ledger CHECKs (`0003`) + immutability triggers (`0010`) |
| INV-5 strong identity proof | `link_codes` (OTP), `persons_verified_phone_unique`, `merge_audit`/`merge_tombstones` |
| INV-6 idempotency | `processed_commands` UNIQUE, `outbox_events(aggregate_id,sequence)`, `projector_deliveries` PK, `bank_transactions` UNIQUE |
| INV-7 one owner for derived data | `charges.amount_allocated`, `public_sessions.slots_open` (projector) |
| INV-8 narrow worker privilege | `claim_outbox_batch()` SECURITY DEFINER + `app_worker` EXECUTE-only |
| INV-9 secrets/PII never leak | `*_enc bytea` + `*_lookup_hash`; no grants on protected tables |

## Auth session revocation (DD-80 v1.88)

`accounts.session_epoch` / `web_sessions.minted_epoch` (bigint, `0015`) are the
linearizable authority for "logout everywhere": a session resolves only when
`minted_epoch = session_epoch` (exact equality — never `>=`). `create`/`rotate`
lock the relevant `accounts` parent row(s) and stamp the session with the
locked epoch; `auth_revoke_all_web_sessions` (public, derives the account from
the current session — never accepts a caller-supplied account id) locks the
account parent, bumps its epoch, and materializes `revoked_at` on every
unrevoked row of that account plus one `auth_audit_events` row, all in one
transaction. The internal `auth_revoke_account_sessions` helper is never
granted to any runtime role. Full contract/proof:
`../../docs/g3-revoke-all-concurrency-probe-seed.md`.

## Auth email/credential/token core (DD-80 §10 order-2, `0016` — CODE DARK)

`0016` adds the storage + primitives for email register/verify/reset, with **no
routes, UI, provider send, or public functions** (those are order-3/4). Five
function-only tables — `account_emails` (provider-neutral verified contact),
`email_password_credentials`, `auth_pending_email_registrations` (independent
per-command attempts, no last-writer-wins), `auth_email_tokens` (one 256-bit
verifier, hash-at-rest; partial unique indexes give one active verify token per
attempt and one active reset token per email, and are `now()`-independent), and
`auth_email_deliveries` (enumeration-safe dark delivery ledger; the public
`command_id` receipt is structurally distinct from the persisted
`provider_idempotency_key`). Privileged behavior lives ONLY in the migration:
`_auth_assert_password_phc` (full Argon2id PHC parse + policy floor/ceiling) is
forced on BOTH write paths by constraint triggers; a verified-email gate blocks
credentials for a pending email; `_auth_consume_email_token` is the single
parent-first (`accounts`→`account_emails`→attempt→token) transactional consume
boundary; retention is five single-concern, deadlock-free functions
(`_auth_email_delivery_cleanup` for the ledger, then `_auth_email_attempt_terminalize`
→ `_auth_email_token_retention` → `_auth_email_attempt_retention` →
`_auth_email_orphan_cleanup`, each its own transaction, one ascending-account
pass, child-row-bounded). None of the internal helpers is granted to `app`. `auth_audit_events` is REUSED from `0015`, not
recreated. Contract: `../../docs/b0-auth-credential-lifecycle-design-probe.md`
§3/§5/§8.1; acceptance D1E-1..22 in
`../../docs/features/BE/feature_web_auth_onboarding_tech.md`.

## Runner-level role bootstrap (cluster-global race safety)

Roles are **cluster-global**; databases are not. `0000`'s check-then-act role
block (`IF NOT EXISTS (SELECT …) THEN CREATE ROLE …`) is therefore not safe when
two `migrate()` runs bootstrap **different** databases on the **same** cluster:
both can see "role missing" and both `CREATE ROLE`, and the loser aborts with
"role already exists". The runner's `pg_advisory_lock` does **not** help — advisory
locks are **DATABASE-scoped** (the lock tag includes the database), so two runs in
two databases take the same key without blocking, and it gives zero protection to
cluster-global objects.

`migrate()` closes this in `src/migrate.ts`: **before** `0000` is applied it
ensures `app`/`app_worker`/`readonly` with the race-safe idiom

```sql
DO $$ BEGIN CREATE ROLE <r> LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
EXCEPTION WHEN duplicate_object OR unique_violation THEN NULL; END $$;
```

swallowing **only** the two SQLSTATEs that both mean "role already exists"
(`duplicate_object` 42710 from the pre-check, `unique_violation` 23505 from
`pg_authid`'s unique index when two backends pass the pre-check at once — the
common one under real concurrency). Any other error (e.g. `insufficient_privilege`)
still propagates and aborts. The step is **gated on `0000` not yet being in
`schema_migrations`**, and within that gate a `pg_roles` check issues `CREATE
ROLE` **only for roles that are genuinely absent** — a cluster may have them
pre-provisioned while `DATABASE_URL_MIGRATION` is `NOCREATEROLE`, and Postgres
checks the `CREATEROLE` privilege before the duplicate, so creating an
already-present role would abort. So an already-migrated **or** a pre-provisioned
database never needs `CREATEROLE`. `0000` stays byte-identical (its own `IF NOT
EXISTS` block finds the roles and skips), so its `schema_migrations` sha256 is
unchanged. This is what lets the DB test suites run as parallel vitest workers
(`vitest.config.ts` `fileParallelism: true`).

## Migration order & deploy notes

Apply `0000`→`0016` in order (FK dependencies validated). For production changes
follow expand→backfill→validate→flip→contract (P12); avoid destructive
migrations in the same deploy as behavior changes. Legacy Bestminton import:
TDD §8.

## Open items inherited from docs (not blockers)

- `messenger_*` is post-MVP (P4.8, DD-09) — included for forward compatibility.
- `pay_code` stored bare, prefix is display-only (DD-02).
- Sport list and skill-level taxonomy still open (DD-08) — seed is a starter set.
- Hosting provider Neon vs Supabase (DD-04) — no schema impact.
