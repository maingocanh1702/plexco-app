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
    ├── 0016_account_email_token_core.sql # DD-80 §10 order-2 email/credential/token core (code dark)
    ├── 0017_oauth_transactions.sql    # DD-80 order-3 cross-site OAuth transaction store (code dark)
    ├── 0018_oauth_completion_handoff.sql # auth-s4-d1b OAuth completion-hop handoff (code dark)
    ├── 0019_tenant_integrity_fks.sql  # DD-68 same-tenant composite candidate keys + FKs (expand-only)
    ├── 0020_ledger_tenant_integrity_fks.sql # DD-68 ledger leg: bank/allocation same-tenant FKs (expand-only)
    ├── 0021_non_money_tenant_integrity_fks.sql # non-money leg: zalo/notification same-tenant FKs (expand-only)
    └── 0022_job_claim_lease_core.sql   # DD-89/DD-90 job-infra root: job_definer, outbox lease/reclaim, job_audit_events, projector-delivery state machine
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
| **TENANT-private (RLS)** | `memberships`, `aliases`, `channel_reachability`, `settings`, `sessions` (+recurrence/occurrences/`session_surface_refs`), `players`, `telegram_links`, `tenant_admins`, `tenant_link_codes`, `bank_accounts`, `charges`, `bank_transactions`, `payment_allocations`, `provider_connections`, `zalo_bots`, `zalo_reply_contexts`, `messenger_pages`, `processed_commands`, `outbox_events`, `join_requests`, `subscriptions`, `subscription_invoices`, `notification_*`, `onboarding_*` | `ENABLE`+`FORCE` RLS, policy on `app.tenant_id` GUC, fail-closed. `app` = `NOBYPASSRLS`. Always via `tenantRepo` choke-point. |
| **PUBLIC read model** | `public_sessions` | No RLS. `readonly` role gets `SELECT` only; canonical tables get **zero** grant to `readonly`. Field whitelist — no money/PII/roster/exact venue. |
| **PLATFORM/WORKER** | `plans`, `billing_transactions`, `billing_allocations`, `billing_overrides`, `projector_deliveries`, `surface_refs`, `job_audit_events` | Billing platform ledger (separate from player ledger, BL-BIL-1). Worker claims outbox via `claim_outbox_batch()`; `job_audit_events` is the append-only per-event audit sink for every job-infra function (`0022`) — no runtime role gets a table grant on it, `app`/`readonly` included. |

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
| INV-1 tenant isolation | `0009` RLS ENABLE+FORCE + policies; `NOBYPASSRLS` roles; `0019`+`0020` (DD-68) + `0021` same-tenant composite FKs |
| INV-3 public is a projection | `public_sessions` whitelist table; `readonly` grant scope |
| INV-4 money append-only | ledger CHECKs (`0003`) + immutability triggers (`0010`) |
| INV-5 strong identity proof | `link_codes` (OTP), `persons_verified_phone_unique`, `merge_audit`/`merge_tombstones` |
| INV-6 idempotency | `processed_commands` UNIQUE, `outbox_events(aggregate_id,sequence)`, `projector_deliveries` PK, `bank_transactions` UNIQUE |
| INV-7 one owner for derived data | `charges.amount_allocated`, `public_sessions.slots_open` (projector) |
| INV-8 narrow worker privilege | `0022` (DD-89/DD-90): `claim_outbox_batch`, `job_prepare_projector_delivery`, `claim_projector_delivery_batch`, `complete_projector_delivery` and the `job_audit_events` trigger are owned by pre-provisioned `job_definer NOLOGIN BYPASSRLS`; `app_worker` gets EXECUTE-only on the four worker-callable functions, never the trigger, never direct DML on `outbox_events`/`projector_deliveries`/`job_audit_events`. |
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

## Tenant-integrity composite FKs (DD-68, `0019` — EXPAND ONLY)

The money-path children reference their parents by **single-column** FK only —
`players.session_id → sessions.id`, `players.membership_id → memberships.id`,
`charges.session_id`, `charges.player_id`, `charges.membership_id`,
`join_requests.session_id`, `session_surface_refs.session_id`,
`aliases.membership_id`. A single-column FK proves the parent EXISTS but not that
it belongs to the SAME tenant as the child's own `tenant_id`. RLS filters reads,
so a service-layer bug writing `players(tenant_id = A, session_id = <B's session>)`
yields a row invisible to BOTH tenants while charges still references it — silent
cross-tenant corruption on the money path.

`0019` closes this at the DB (HR1: the DB is the fail-closed choke-point). It
adds UNIQUE `(tenant_id, id)` candidate keys on `sessions`, `memberships`, and
`players` (a composite FK must target a unique constraint on the referenced
columns; `id` is already the PK so this is additive), then eight composite FKs
`(tenant_id, fk_id) → parent(tenant_id, id)` — one per relationship above. Every
existing single-column FK is KEPT (additive; the `id` FK still governs
`ON DELETE`). PostgreSQL referential-integrity checks are **not** subject to RLS,
so the constraint rejects a cross-tenant write on the real `app`-role
(`NOBYPASSRLS`) runtime path, not only for a superuser. `charges.membership_id`
is nullable → `MATCH SIMPLE` leaves that composite unenforced when it is NULL
(preserving "charge without a membership"), enforced when it is set; the session
and player legs still bind the tenant. `charges` references THREE tenant-scoped
parents (session, player, membership), so all three are bound — binding only two
would let a B-tenant charge point at an A-tenant player.

The deeper ledger references of the same class were deferred from `0019` and
are closed by `0020` (next section).

The FKs are added `NOT VALID`, then each is `VALIDATE`d inside its own
subtransaction; a `foreign_key_violation` is re-raised as a **named halt**
(offending table + relationship + key) — a stray cross-tenant row surfaces as an
owner-actionable halt, never a bare constraint-scan abort, and is never
auto-deleted or re-parented. On clean data (the money-path feature layer is
unbuilt, so these tables are empty today) the VALIDATEs are instantaneous. Like
`0014`, this single-transaction `NOT VALID` + `VALIDATE` shape is
additive-and-reversible but NOT online-safe — acceptable ONLY because the tables
are empty; a future slice against populated tables must split `NOT VALID` and
`VALIDATE` across files. `session_occurrences` (no `tenant_id`),
`public_sessions` (public read model, HR2), and `magic_links.session_id`
(references `web_sessions`) are out of scope.

## Ledger tenant-integrity composite FKs (DD-68, `0020` — EXPAND ONLY)

`0020` closes the payment-ledger leg `0019` deferred, with the identical
mechanism. The FK inventory was derived by an exhaustive scan of `schema.ts`
plus migrations `0003`/`0004` (the `0019` round-01 lesson: hand-listed
inventories miss relationships):

- `bank_transactions (tenant_id, bank_account_id) → bank_accounts` — both
  columns NOT NULL, always enforced;
- `payment_allocations (tenant_id, charge_id) → charges` — NOT NULL;
- `payment_allocations (tenant_id, bank_transaction_id) → bank_transactions` —
  nullable (cash/waiver allocations carry no bank transaction) → `MATCH SIMPLE`;
- `payment_allocations (tenant_id, reverses_allocation_id) →
  payment_allocations` — nullable, self-referencing (a reversal must reverse a
  same-tenant allocation). Not net-new integrity: `0003` already carries the
  single-column self-FK; `schema.ts` had drifted (no `.references`) and the
  mirror is fixed in this slice;
- `bank_accounts (tenant_id, provider_connection_id) → provider_connections` —
  nullable (set during connector onboarding; single-column FK from `0004`).
  Surfaced by the exhaustive scan beyond the manifest's known clear set.

Five UNIQUE `(tenant_id, id)` candidate keys are added (`bank_accounts`,
`bank_transactions`, `charges`, `payment_allocations`, `provider_connections`) —
strict supersets of each PK, additive. Every single-column FK is KEPT and still
governs `ON DELETE`. Same `NOT VALID` → `VALIDATE`-in-subtransaction → named
halt (`tenant-integrity halt (0020)`) contract — never deletes or re-parents —
and the same locking caveat: the single-transaction shape is acceptable ONLY
because the ledger tables are empty (code dark); split `NOT VALID`/`VALIDATE`
across files for populated tables.

Scanned and excluded: `bank_accounts.pending_change_by` and
`payment_allocations.created_by` (actor uuids with no FK by design, like
`join_requests.decided_by`); the BILLING domain has no same-shape gap —
`billing_transactions` is platform-global (no `tenant_id`, BL-BIL-1) and
`billing_allocations` carries no `tenant_id` column to bind (allocating platform
revenue to a tenant's `subscription_invoices` row is cross-tenant by design).

## Non-money tenant-integrity composite FKs (`0021` — EXPAND ONLY)

`0021` closes the remaining non-money leg with the identical mechanism as
`0019`/`0020`. Unlike those two, it does not cite "DD-68" — the current
`decisions.md` DD-68 entry covers an unrelated Messenger interaction contract,
not tenant-integrity FKs; authority here is `0019`/`0020` themselves plus the
manifest and HANDOFF HR1. The FK inventory was derived by an exhaustive scan
of every `tenantId`/`.references(` pair in `schema.ts`, THEN cross-checked
against every literal `REFERENCES` clause in the live SQL across `0000`-`0020`
— the SQL-level pass matters: a schema.ts-only grep missed
`memberships.merged_into_membership_id` (SQL `0002` carries the FK; the
Drizzle mirror never had `.references()` on it, the same class of drift `0020`
fixed on `payment_allocations.reverses_allocation_id`). Codex round-02 caught
this gap; the mirror is fixed in this migration:

- `zalo_reply_contexts (tenant_id, bot_id) → zalo_bots` — both columns NOT
  NULL, always enforced. Surfaced by this slice's scan (no prior spec doc
  called this leg out explicitly);
- `notification_deliveries (tenant_id, intent_id) → notification_intents` —
  both columns NOT NULL, always enforced. Independently documented as a
  pending contract item in `feature_notifications_reminders_tech.md` v2.5
  ("Tenant/endpoint integrity closure... enforce same-tenant delivery→intent
  ... Runtime migration pending"); this migration implements only that
  tenant_id-scoped composite-FK layer, not the broader v2.5 contract
  (person-bound composite FKs, identity/platform binding, SECURITY DEFINER
  capability functions — a separate, larger notification-security slice);
- `memberships (tenant_id, merged_into_membership_id) → memberships` (self) —
  nullable (set only when `status='merged'`) → `MATCH SIMPLE` leaves the
  composite unenforced while NULL (every non-merged membership), enforced the
  moment a merge sets it, binding the merge target to the SAME tenant as the
  merged-away row.

Relationships 1-2 are always enforced (both legs NOT NULL); the membership
merge pointer is the one `MATCH SIMPLE` case in this migration.

Two UNIQUE `(tenant_id, id)` candidate keys are added (`zalo_bots`,
`notification_intents`) — strict supersets of each PK, additive
(`zalo_bots.tenant_id` already carries its own single-column UNIQUE from
`0004`, but a composite FK still requires a unique constraint matching its
exact column list). `memberships` needs no new candidate key — `0019` already
added `memberships_tenant_id_candidate_key`; the merge-self composite FK
targets that existing key. Every single-column FK is KEPT and still governs
`ON DELETE`. Same `NOT VALID` → `VALIDATE`-in-subtransaction → named halt
(`tenant-integrity halt (0021)`) contract — never deletes or re-parents — and
the same locking caveat: the single-transaction shape is acceptable ONLY
because the Zalo/notification tables are empty (or not yet driving traffic)
and membership merges are unbuilt (code dark); split `NOT VALID`/`VALIDATE`
across files for populated tables.

Scanned and excluded (every tenant-scoped table walked): `session_occurrences`,
`projector_deliveries`, `surface_refs`, `billing_allocations`,
`onboarding_steps` (each has a bindable-looking FK but the CHILD carries no
`tenant_id` column — same treatment `0019` gave `session_occurrences` and
`0020` gave `billing_allocations`); `routing_audit` (nullable `tenant_id`, no
FK to `tenants` at all — platform-level audit trail); `public_sessions`
(no FK by design, HR2); `messenger_pages` (shaped like `zalo_bots` but nothing
currently references it by FK, so there is no child-side gap to close).

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

Apply `0000`→`0022` in order (FK dependencies validated; `0022` also requires
`pnpm db:bootstrap` to have run first — see below). For production changes
follow expand→backfill→validate→flip→contract (P12); avoid destructive
migrations in the same deploy as behavior changes. Legacy Bestminton import:
TDD §8.

## Privileged job-definer bootstrap + job-infra lease/reclaim/audit (DD-89/DD-90, `0022`)

`job_definer` is deliberately **not** a `RUNTIME_ROLES` entry and is never created by `migrate()`:
that helper creates `LOGIN NOBYPASSRLS` runtime roles, which is unsafe for a definer that must
cross `FORCE RLS`. It is pre-provisioned by `infra/postgres-init/01-job-definer.sql` — an idempotent,
race-safe SQL file applied to a **running** cluster via `pnpm db:bootstrap` (requires
`DATABASE_URL_MIGRATION`), never relied upon as a docker-entrypoint-initdb.d mount on its own (CI's
postgres service container starts before checkout; an already-populated local `pgdata` volume skips
init scripts entirely — see the file's own header). The compose init mount
(`infra/docker-compose.yml`) is a convenience for genuinely fresh local volumes only. CI runs
`pnpm db:bootstrap` as a workflow step after checkout and before the test step. The bootstrap file
creates/verifies exactly:

```sql
CREATE ROLE job_definer NOLOGIN NOSUPERUSER BYPASSRLS
  NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION;
GRANT job_definer TO <migration_role>;   -- CURRENT_USER at bootstrap time, in every environment
GRANT USAGE ON SCHEMA public TO job_definer;
```

It fails closed if an existing role has any other attribute (never silently "fixes" drift) and is
safe to run repeatedly (fresh cluster, pre-existing cluster, or concurrently across parallel DB test
files — the DB suite's own `bootstrapJobDefiner`/`withJobDefinerLock` helpers, `src/test-harness.ts`,
reuse this exact file). The `0022` migration only **asserts** the role/attributes/membership before
any grant — it never creates or alters `job_definer` itself, and a missing/wrong/unmembered role
fails the whole migration before any partial change (JCL-2/JCL-3). It then temporarily brackets
`GRANT CREATE ON SCHEMA public` while transferring owner (PG16 requires the new owner to hold schema
CREATE for the transfer), then revokes it in the same transaction. Never falls back to the migration
role, `app_worker`, or superuser.

`0022` itself (root slice 1/4 of the shared job-infra layer — no queue, worker handler, cron or
outbox producer lands here) gives `job_definer` sole ownership of five named functions plus the new
`job_audit_events` table:

- **Outbox lease/reclaim**: `outbox_events` gains `lease_expires_at` (both-null/both-non-null shape
  CHECK with `claimed_at`); `claim_outbox_batch` keeps its exact `ORDER BY created_at` semantics but
  first reclaims expired (five-minute) leases under `SKIP LOCKED`, then claims available rows,
  auditing both steps;
- **Per-event job audit**: `job_audit_events` is append-only (`forbid_job_audit_mutation` trigger
  rejects UPDATE/DELETE), `job_id` is always the originating `outbox_events.id`, deliberately no
  `UNIQUE(job_id)` — a reclaimed event is legitimately audited more than once. No runtime role gets
  a table grant, `app`/`readonly` included;
- **Projector-delivery state machine**: `projector_deliveries` gains `claim_token` +
  `lease_expires_at`; `job_prepare_projector_delivery` (idempotent), `claim_projector_delivery_batch`
  (reclaim-then-claim, same pattern as outbox) and `complete_projector_delivery`
  (delivered/retry/dlq, exact-unexpired-token required, silent no-op otherwise — never a stale or
  duplicate completion) implement `pending → claimed → delivered/failed/dlq`, with `dlq` terminal.
  `app_worker` receives EXECUTE on all four worker-callable functions, never direct DML on any of
  the three tables, never EXECUTE on the audit trigger.

Full contract, exact function signatures, acceptance matrix (JCL-1..JCL-14) and the empirical
design-probe proof of the pre-fix defect: `../../docs/autopilot-db-job-claim-lease-core.md`.

## Open items inherited from docs (not blockers)

- `messenger_*` is post-MVP (P4.8, DD-09) — included for forward compatibility.
- `pay_code` stored bare, prefix is display-only (DD-02).
- Sport list and skill-level taxonomy still open (DD-08) — seed is a starter set.
- Hosting provider Neon vs Supabase (DD-04) — no schema impact.
