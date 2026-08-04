<!-- review-readiness: code-ready -->

# Autopilot task contract — `plans-dd29-capability-registry`

> **This is a coding handoff.** v1.0 (2026-08-03) shipped `NOT_PLAN_READY` with three open questions.
> All three are resolved as of v1.1 (same day, reconciliation round) — not by an owner picking an
> option, but by re-deriving that Q1 doesn't need an answer: the expand migration asserts its own
> precondition instead of assuming it, which converts "is there live data" from a blocking question
> into a property the migration itself proves at run time. Q2 and Q3 are genuine decisions, recorded
> below with reasoning. Verdict is now `CODE_READY` — see the verdict block at the end.

> **Implementation correction, v1.2 (2026-08-05) — read before trusting "The mapping" or A3/A5
> below.** This contract's `telegram`/`plus_channel`/`all_channels` → `host_pro` mapping (§"The
> mapping", the `CASE` block in §"Migration design", acceptance row A3) was **superseded during
> implementation review**: collapsing three distinctly-priced legacy tiers into one new price is a
> silent re-pricing of a paying tenant this contract itself flagged as a business-policy question it
> does not answer (§"The mapping"'s own closing paragraph) — codex review (gate-attempt-02/03 on the
> implementing slice) caught that guards 1/2 alone let that silent collapse through anyway. The
> implemented, tested, and merged-pending behavior instead **aborts the whole migration** if any
> subscription still references one of those three keys, regardless of status — this contract's own
> `manifest.stop_conditions` and "Negative scope" already required exactly this ("no grandfather or
> re-pricing policy invention... STOP and escalate"); guard 3 is what actually enforces it, where
> guards 1/2 could not. Full detail in the Changelog's v1.2 entry. Every other row of this contract
> (the CHECK target, capability keys, `free_web`→`free` mapping, expand→contract split, guards 1/2)
> still reflects the shipped implementation exactly as written below.

---

## Why this file exists

`docs/autopilot-backlog.md` task `plans-dd29-capability-registry` names three gaps between live
`packages/db/schema.ts`/`0007_billing.sql` and the already-**Reviewed**
`docs/features/BE/feature_billing_lifecycle_tech.md` (v2.10, 2026-08-03):

| # | Gap | Live (measured) | Target (spec, already Reviewed) |
|---|---|---|---|
| a | `plans.plan_key` CHECK | `('free_web','telegram','plus_channel','all_channels')` — `0007_billing.sql:14`, renamed `plans_key_chk` by `0025_check_constraint_naming_drift.sql:148`, mirrored `packages/db/schema.ts:1243-1244` | `('free','host_pro')` — `feature_billing_lifecycle_tech.md:34` |
| b | `plans.entitlements` shape | flat, e.g. `{"web_app": true, "telegram": false, "zalo": false, "messenger": false}` — `0011_seeds.sql:18-23` | nested `{"capabilities": {...11 keys...}}` — `feature_billing_lifecycle_tech.md:65-84` |
| c | Seed | 4 rows, prices 0/79000/159000/199000 | 2 rows, prices 0/250000 |

This is a **data migration**, not a logic change: live `subscriptions` rows carry `plan_key` values in
the OLD 4-value space via an FK to `plans(plan_key, version)`. The CHECK on `plans.plan_key` cannot
narrow until every referencing row has been repointed — hence expand → contract, not one migration
(backlog note, confirmed correct by the FK topology found below).

**Why it matters:** this is the hard prerequisite for `hasCapability(tenant, key)`. It was split out of
`tenant-capability-authority-core` on 2026-07-30 by `authorize-tenant-action-core` (AP-40,
`docs/autopilot-authorize-tenant-action-core.md`), which measured the live seed, found it flat with no
`capabilities` wrapper, and explicitly refused to implement `hasCapability` until this lands — see that
doc's "Live-truth verification" and its manifest's `negative_scope[0]`.

---

## §3 Task contract

```text
TASK_ID: plexco:plans-dd29-capability-registry
OUTCOME: two monotonic migrations (expand, contract) that move plans.plan_key from the live 4-tier CHECK
  to DD-29's 2-tier CHECK, reshape plans.entitlements to the nested capabilities shape, reseed, and
  repoint every live subscriptions row and the tenant_provision() write path — with the contract
  migration self-guarding so it is safe regardless of when it is actually deployed relative to expand.
REPOSITORY_AND_BASE: Plexco app · base `main` · measured `origin/main` = b3d3b4a26abc3fddbbb51ebb3d9f4d33d899ab43
  at authoring time (2026-08-03) — RE-MEASURE with `git rev-parse origin/main` before opening a worktree;
  other lanes are landing migrations this week (0026, 0027 both landed after this backlog entry was
  written on 2026-07-30), so the tail below is a property ("next two after tail"), not a fixed literal.
CONTEXT_SOURCES:
  - docs/autopilot-backlog.md task block `plans-dd29-capability-registry` (line 681)
  - docs/features/BE/feature_billing_lifecycle_tech.md §2 Schema + Migration & Rollback (v2.10) — TARGET
  - docs/standards/decisions.md DD-29 (line 376, ✅ Chốt), DD-51 (line 656, ✅ Chốt), DD-40 (line 55), DD-22 (line 37)
  - packages/db/schema.ts:1230-1245 (plans), :1247-1269 (subscriptions) — AUTHORITATIVE live shape
  - packages/db/migrations/0007_billing.sql (original DDL) · 0011_seeds.sql (original seed) ·
    0012_auth_functions.sql (tenant_provision — coupling found during authoring, see below) ·
    0025_check_constraint_naming_drift.sql (plans_key_chk naming precedent + money-table lock reasoning)
  - packages/db/src/migrate.ts:248-257 (per-file BEGIN/COMMIT/ROLLBACK — confirms a RAISE EXCEPTION
    inside a migration rolls back the whole file)
  - packages/db/src/migrate.test.ts (BR-5/BR-7/JCL-2 — existing precedent for "seed pre-existing row,
    apply migration, assert fail-closed or upgrade-preserved" testing pattern to reuse)
  - docs/autopilot-authorize-tenant-action-core.md + its manifest — sibling slice this one unblocks
APPLICABLE_SKILLS: none
SCOPE: see manifest `scope` — 2 new migrations, packages/db/schema.ts, 3 existing test files (coupling
  found during authoring, not in the original backlog estimate), 1 test-harness file, 2 doc files.
NEGATIVE_SCOPE: see manifest `negative_scope`.
RISK: P1 — confirmed, not just inherited. Money-adjacent (billing/subscriptions), touches a live
  SECURITY DEFINER function's write path (tenant_provision), and is a data migration on tenant rows.
AUTONOMY_MODE: supervised
MODEL_POLICY: independent review = scripts/codex-review-pin.sh (repo default pin). clean_rounds: 2
  (P1 minimum per autopilot-review-readiness.mjs, same rule authorize-tenant-action-core cites).
  Security round required (SECURITY DEFINER function write-path change + tenant capability defaults).
  Reviewer unavailable → HALT TOOL_UNAVAILABLE, never self-downgrade.
SANDBOX_AND_PERMISSIONS: network restricted; no secrets; no external side effects. Real Postgres needed
  for verification (DATABASE_URL_TEST), per README.
HUMAN_DECISIONS_REQUIRED: none remaining — Q1/Q2/Q3 resolved in reconciliation round v1.1, see
  "Human decisions — resolved" below.
SLICE_GRAPH: root of the hasCapability tree. Known successor: `tenant-capability-authority-core`
  (registry/grants/audit/hasCapability itself) already declares
  `depends_on: [plans-dd29-capability-registry]` in its backlog `split_note` (line 696).
DEPENDENCIES: none (root — nothing in `packages/db` blocks this)
INVARIANTS: [schema, billing] — refined from the backlog's estimate-only `[schema]`. Per the backlog's
  own rule ("scope/invariants của task idea là ước lượng — refine trước khi promote"), `billing` is
  added because this slice's blast radius sits squarely on the two tables the `billing` token already
  covers (`plans`, `subscriptions` — same two tables `authorize-tenant-action-core` tagged `billing` for).
  Verified against docs/autopilot-invariant-catalog.md's `<!-- catalog:start -->...<!-- catalog:end -->`
  block directly (em-dash format, no backticks — a backtick-shaped grep would have silently returned
  empty); both tokens exist verbatim at lines 35 and 37.
VERIFICATION: see manifest `verification`. Focused checks are real `bash -lc` commands; at least one
  fails today (grep for the narrowed CHECK string against the live schema.ts — see manifest).
CODE_REVIEW: required, 2 consecutive clean rounds (P1 floor).
SECURITY_REVIEW: required — SECURITY DEFINER function body change (tenant_provision) + capability
  defaults that gate money-adjacent automation (auto-reconcile, auto-reminders).
BUDGETS: fix_rounds_max 5 (per briefing). wall_time_minutes ~180 (2 migrations + 4 test files + 2 docs).
STOP_CONDITIONS: MAX_ROUNDS · REGION_THRASH · if migration `0028`'s guard 1 or guard 2 actually fires
  when run against a real target database (an unmapped `plan_key`, or an old key at `plan_version ≠ 1`),
  the migration aborts (transaction rollback) and the run STOPS for owner review — do not widen the map
  or retry blindly. A guard-1 hit on a row that is also `status IN ('active','past_due')` additionally
  raises a grandfather-vs-reprice policy question (see "Human decisions — resolved", Q1) that this
  contract does not answer in advance, because it does not need to.
DELIVERABLES (this session): docs/autopilot-plans-dd29-capability-registry.md (this file) ·
  docs/autopilot-manifests/plans-dd29-capability-registry.json · .claude/commands/ap-46-plans-dd29-capability-registry.md.
  docs/autopilot-backlog.md is explicitly OUT of scope for this session — its promotion to `planned` is
  a separate chore commit (briefing instruction; also avoids the exact collision class the backlog's own
  2026-07-30 reconcile note describes).
```

---

## Live-truth verification — measured 2026-08-03

| Premise | Evidence | Result |
|---|---|---|
| Live CHECK is still the 4-tier list | `packages/db/schema.ts:1243-1244`, `packages/db/migrations/0007_billing.sql:14` | ✅ confirmed |
| Constraint name is `plans_key_chk` (post-0025 rename) | `0025_check_constraint_naming_drift.sql:148` — pure rename, zero predicate change | ✅ confirmed |
| Target CHECK/seed/capability-key set is fully specified and Reviewed | `feature_billing_lifecycle_tech.md:32-84`, header `Status: Reviewed`, v2.10 | ✅ confirmed — not a fresh design, a **transcription** job |
| `plans` has no other inbound FK besides `subscriptions.plan_fk` | repo-wide grep for `REFERENCES plans` | ✅ confirmed — only `0007_billing.sql:43` |
| No application code reads `entitlements`/`capabilities` today | repo-wide grep across `apps/`, `packages/core`, `packages/db/src` (excluding built `.next` bundles, which only mirror `schema.ts`) | ✅ confirmed zero hits — read-side blast radius is currently zero |
| `tenant_provision()` hardcodes the OLD plan_key on every new tenant | `0012_auth_functions.sql:289-291` — `INSERT INTO subscriptions(...) VALUES (v_tenant, 'free_web', 1, ...)`. The function's own comment (line 231-232) already flags this: *"the DD-29 billing slice renames the catalog (free_web -> free) expand→contract"* | ⚠️ **not in the original backlog estimate — see "Coupled blast radius" below** |
| Only `plan_version = 1` was ever seeded for the old tiers | `0011_seeds.sql:18-23` is the only `INSERT INTO plans` for old keys found repo-wide | ✅ likely, but **not provable from static files alone** — the migration must assert this against the live target database, not assume it (see Migration design, guard 2) |
| Migration files run one-per-transaction (BEGIN…COMMIT, rollback on error) | `packages/db/src/migrate.ts:248-257` | ✅ confirmed — a `RAISE EXCEPTION` inside a migration rolls back that whole file |

---

## The mapping — derived from a ratified decision, not invented

> **[SUPERSEDED, v1.2 — see the notice at the top of this document]** The `telegram`/`plus_channel`/
> `all_channels` → `host_pro` rows below describe this contract's ORIGINAL plan, not the shipped
> behavior. The implementation aborts instead of executing this mapping, for exactly the "business
> policy question" reason this section's own closing paragraph already named. Kept verbatim below for
> historical record of what was originally proposed and why it needed a guard, not as a description of
> current behavior.

| Old `plan_key` | Old price | New `plan_key` | Basis |
|---|---|---|---|
| `free_web` | 0 | `free` | **Explicit**, verbatim in `decisions.md` DD-29 changelog (line 457, v2.3): *"Rename plan_key cũ `free_web`→`free`."* Independently confirmed by `0012_auth_functions.sql:231`'s code comment. |
| `telegram` | 79000 | `host_pro` [SUPERSEDED — aborts instead, see notice above] | **Derived**, not verbatim-tabulated anywhere as a literal 4→2 mapping. Grounded in DD-29's ratified text (line 382): *"Bỏ 3 tier theo kênh (`telegram`/`plus_channel`/`all_channels`)"* — replaced by **one** paid tier, `host_pro`. There is no third target value for these three old keys to map to. |
| `plus_channel` | 159000 | `host_pro` [SUPERSEDED — aborts instead] | same basis |
| `all_channels` | 199000 | `host_pro` [SUPERSEDED — aborts instead] | same basis |

The key-level mapping is unambiguous given DD-29 is `✅ Chốt` (4 old keys → 2 new keys, and only one of
the two is a paid tier). What is **not** settled by any doc is the **price transition** for a tenant
already paying 79k/159k/199k who gets repointed to `host_pro` at 250k — that is a business policy
question, not a schema question, and is listed under "Human decisions required" rather than assumed
here. **This is exactly the gap the implementation closed by aborting instead of guessing** (v1.2).

---

## Migration design — expand → contract

Two new monotonic migrations after the current tail (`0027_resolve_tenant_status_locked.sql` at
authoring time — **re-verify the tail with `ls packages/db/migrations/ | sort | tail -5` before
naming these**; working numbers below assume `0028`/`0029` and must shift together if another slice
claims one first):

### Migration N — `0028_dd29_capability_registry_expand.sql` (EXPAND + data migrate)

Runs as one transaction, in this order:

1. **Widen `plans_key_chk`** (DROP + ADD — Postgres has no in-place CHECK-predicate ALTER): union of old
   and new values, `plan_key IN ('free_web','telegram','plus_channel','all_channels','free','host_pro')`.
   Unlike `0025`'s 12 money-path renames, `plans` is a small shared **catalog** table (a handful of
   rows total, not one row per tenant), so the re-validation `ADD CONSTRAINT` performs is cheap — the
   long-held-exclusive-lock concern `0025` documented for `charges`/`bank_transactions` does not apply
   here at the same severity.
2. **Insert the two new catalog rows** (`free` v1 price 0, `host_pro` v1 price 250000) using the exact
   `limits`/`entitlements` literals already Reviewed at `feature_billing_lifecycle_tech.md:68-81` —
   transcribe verbatim, do not re-derive from memory. `ON CONFLICT (plan_key, version) DO NOTHING`,
   matching `0011`'s idempotent seeding pattern.
3. **Redefine `tenant_provision()`** via `CREATE OR REPLACE FUNCTION` (never edit `0012` itself — it is
   already applied) — identical body to the live version, changing only the literal on the
   `INSERT INTO subscriptions` line from `'free_web'` to `'free'`. This must land in the SAME
   transaction as step 2, so there is no window where a concurrent `tenant_provision()` call could
   insert a new row against a plan_key that doesn't exist yet.
4. **Fail-loud guard, then data-migrate, in this order — this is the mechanism that resolves whether
   any live paying tenant exists on an old tier, not a question this contract answers by belief.**
   Static evidence is strongly corroborating (`infra-do-app-vpc-deployment` is still `status: idea` —
   `docs/autopilot-backlog.md:162` — meaning no deployment contract is even authored yet; `BUILD-STATUS.md`
   line 5, 2026-07-28 snapshot, records Channel Booking and Chat at code/runtime = 0, D1 email-token as
   **CODE DARK** with no route/UI/provider send, and DD-87's core fix with no production caller; this
   session independently found zero application code anywhere reading `entitlements`/`capabilities`).
   But an assumption about live data that is true today is a silent hazard the moment it stops being
   true, and none of that evidence would announce the change. So the guard below is load-bearing, the
   citations above are context:
   ```sql
   -- guard 1: refuse to proceed if any row is outside the known old∪new set
   DO $$ DECLARE v_bad integer; BEGIN
     SELECT count(*) INTO v_bad FROM subscriptions
       WHERE plan_key NOT IN ('free_web','telegram','plus_channel','all_channels','free','host_pro');
     IF v_bad > 0 THEN
       RAISE EXCEPTION 'DD-29 expand: % subscriptions row(s) reference an unrecognized plan_key', v_bad
         USING ERRCODE = 'data_exception';
     END IF;
   END $$;
   -- guard 2: refuse the "only v1 ever existed" assumption unless it actually holds on THIS database
   DO $$ DECLARE v_bad_version integer; BEGIN
     SELECT count(*) INTO v_bad_version FROM subscriptions
       WHERE plan_key IN ('free_web','telegram','plus_channel','all_channels') AND plan_version <> 1;
     IF v_bad_version > 0 THEN
       RAISE EXCEPTION 'DD-29 expand: % subscriptions row(s) sit on an old plan_key at version <> 1 — the CASE mapping below only handles v1', v_bad_version
         USING ERRCODE = 'data_exception';
     END IF;
   END $$;
   -- data migrate — [SUPERSEDED, v1.2: this CASE mapping was never shipped. A third guard (guard 3)
   -- was added during review that ABORTS the whole migration if any subscription still references
   -- telegram/plus_channel/all_channels, regardless of status, instead of executing the mapping below —
   -- see the notice at the top of this document. The shipped UPDATE only ever repoints free_web->free.]
   UPDATE subscriptions SET
     plan_key = CASE plan_key
       WHEN 'free_web' THEN 'free'
       WHEN 'telegram' THEN 'host_pro'
       WHEN 'plus_channel' THEN 'host_pro'
       WHEN 'all_channels' THEN 'host_pro'
       ELSE plan_key END,
     plan_version = 1
   WHERE plan_key IN ('free_web','telegram','plus_channel','all_channels');
   ```
   Both guards make the two load-bearing assumptions ("no stray values", "only v1 ever seeded")
   **checked properties**, not silent hardcodes — directly satisfying the briefing's "fail loudly, never
   silently defaulted" requirement. **[v1.2]** They turned out to be necessary but not sufficient: guard
   3 (added during implementation review) is what actually enforces "no grandfather or re-pricing policy
   invention" for the three legacy paid tiers — see the top-of-document notice.

**Rollback (conditional, mirrors the tech spec's own rollback table style):** safe to revert ONLY if no
new-key row has been created downstream since — i.e., revert `tenant_provision()` to the old literal,
`UPDATE subscriptions` back to the old keys (inverse CASE, only for rows this same migration touched —
track via a `version` bump or a same-transaction audit if a revert path is required), delete the 2 new
`plans` rows, narrow `plans_key_chk` back to the 4 old values. Because everything is one transaction, a
mid-run failure already rolls back to nothing; the "conditional" rollback only matters for an
**already-committed** expand migration, and is genuinely conditional the same way the tech spec's own
migration-rollback table marks its step 2 "✅ Có điều kiện." **[SUPERSEDED, v1.2]** — "track via a
version bump or a same-transaction audit" was a placeholder, not a design; the shipped mechanism needs
neither: `tenants.created_at` vs. this migration's own `schema_migrations.applied_at` already provides
exact provenance (no subscription could be on `free` before this migration ran at all), and the shipped
sequence adds an explicit precondition (zero tenants provisioned since this migration committed) because
a full rollback and "preserve a genuinely-new post-deploy tenant" are fundamentally incompatible — see
`0028_dd29_capability_registry_expand.sql`'s own rollback note for the exact query and ordering.
**[SUPERSEDED AGAIN, v1.4 — codex round-14/gate-attempt-03 correctly flagged the v1.2 paragraph above
as itself now stale, actively misdirecting a reader to the discarded mechanism]:** the
`tenants.created_at`/`schema_migrations.applied_at` inference above was ALSO superseded — it could not
distinguish "never touched by this migration" from "migrated by this migration" whenever guard 4's own
tolerated pre-existing catalog row had a subscription already referencing it before this migration ran.
The shipped mechanism needs no inference at all: this migration's own data-migrate `UPDATE` records the
exact tenant_ids it touches, atomically via a writable CTE, into `dd29_migrated_tenants`; rollback reverts
only those tenants, and the plans-row `DELETE`'s own FK constraint — not a hand-written precondition
query — is what makes an untracked reference block a full rollback. The whole rollback sequence must run
inside one explicit transaction (a bare sequence of auto-committing statements does not actually revert
atomically), and must refuse to delete a `free`/`host_pro` catalog row at a version other than 1 (a
legitimate later price-change version this migration never created). See
`0028_dd29_capability_registry_expand.sql`'s own rollback note for the current, authoritative sequence —
this paragraph and the one above it are both historical record now, not instructions to follow.

### Migration N+1 — `0029_dd29_capability_registry_contract.sql` (CONTRACT)

Deploy after `0028` is confirmed applied. Self-guarding, so it is safe **regardless of the actual gap**
between the two deploys (see "deploy cadence" under Human decisions):

```sql
DO $$ DECLARE v_remaining integer; BEGIN
  SELECT count(*) INTO v_remaining FROM subscriptions
    WHERE plan_key IN ('free_web','telegram','plus_channel','all_channels');
  IF v_remaining > 0 THEN
    RAISE EXCEPTION 'DD-29 contract: % subscriptions row(s) still on an old plan_key — expand migration has not fully landed on this database', v_remaining
      USING ERRCODE = 'data_exception';
  END IF;
END $$;

DELETE FROM plans WHERE plan_key IN ('free_web','telegram','plus_channel','all_channels');
-- safe: the guard above proves no subscriptions FK still references these rows.

ALTER TABLE plans DROP CONSTRAINT plans_key_chk;
ALTER TABLE plans ADD CONSTRAINT plans_key_chk CHECK (plan_key IN ('free','host_pro'));
```

Keep the constraint **name** `plans_key_chk` (it was purpose-renamed for `schema.ts` alignment by
`0025`) — only the predicate narrows.

### Why two files, not one

The briefing and the backlog task both call this out explicitly. The mechanical reason, confirmed by
this session's own reading of the FK topology: narrowing `plans_key_chk` while old `plans` rows still
exist would immediately violate the new CHECK on those existing rows (a CHECK applies to **every** row,
not just new inserts) — so contract cannot run before every referencing `subscriptions` row (and the
`tenant_provision()` write path) has moved off the old keys. Splitting into two files preserves the
option to verify in between; migration N+1's own guard makes that verification-window optional rather
than load-bearing for correctness.

### `packages/db/schema.ts` change

Update `plans.keyChk`'s predicate (`packages/db/schema.ts:1243-1244`) to the CONTRACT-phase target,
`sql\`${t.planKey} IN ('free','host_pro')\``. `schema.ts` is the Drizzle mirror of the **end state** this
slice lands, not the transient expand-only state — the transient state exists only inside the (short,
same-deploy-candidate) window between the two migrations landing.

---

## Coupled blast radius found during authoring (not in the original backlog estimate)

The backlog task's `notes` describe the gap as three things (CHECK, entitlements reshape, reseed). This
session's live-truth read found real coupling the backlog didn't estimate:

1. **`tenant_provision()`** (`0012_auth_functions.sql:289-291`) hardcodes `'free_web'` on every new
   tenant. Already covered in migration design above (step 3).
2. **Five existing test call sites break under CONTRACT** (deleting the old `plans` rows / narrowing
   the CHECK). They break for two *different* reasons, and the fix is different for each — conflating
   them risks "fixing" a ballast fixture into a new assertion it was never meant to make:

   **Update these two — they assert something meaningful ABOUT the old value, so they must assert the
   new one instead:**
   - `packages/db/src/rls-invariants.test.ts:3300-3311` — directly tests `plans_key_chk` with
     `validValue: "telegram"`; the test's entire purpose is "this value is accepted by the CHECK." Must
     become `validValue: "host_pro"` (or `"free"`) or the "must succeed" half of the shared test loop
     (line 3404) breaks the moment `telegram` stops being valid — which is the test doing its job, not a
     regression.
   - `packages/db/src/auth.test.ts:369` — `expect(s.plan_key).toBe("free_web")` asserts
     `tenant_provision()`'s actual output for a new free tenant. Must become `.toBe("free")` — this is
     verifying real behavior, not incidental ballast.

   **Make these three indifferent — they use an old plan_key only as ballast to satisfy the
   `subscriptions_plan_fk` FK so an unrelated CHECK can be exercised; they assert nothing about
   `plan_key` itself, so the fix is "stop depending on a specific value," not "assert a new one":**
   - `packages/db/src/rls-invariants.test.ts:3313-3324` (`subscriptions_status_chk` test) — inserts a
     `subscriptions` row with `plan_key='telegram'` purely so the row can exist; the test is actually
     about `status`. Swap the literal for any valid post-migration key (`'free'` is simplest — no
     channel/pricing semantics to reason about) and it is done; do not turn this into a
     `plans_key_chk` regression test by accident.
   - `packages/db/src/rls-invariants.test.ts:3413-3424` (`subscriptions_extra_chk` test) — same
     situation, testing `selected_extra_channel`, not `plan_key`. Same fix.
   - `packages/db/src/authorization.test.ts:49` — `authorize-tenant-action-core`'s own fixture, testing
     tenant/subscription status resolution, not `plan_key`. Same fix.

   Three call sites, so no shared fixture constant is warranted (YAGNI) — just pick a valid post-migration
   literal at each site and move on.

   (Disambiguated from unrelated, harmless `'telegram'` hits in the same file: `account_identities.platform`
   and `notification_deliveries.platform` values are a different domain — the OAuth/channel platform
   literal, not `plans.plan_key` — and are correctly left untouched.)
3. **The capability key set is 11 keys, not 6.** The task briefing's example list (`bot_zalo`,
   `session_management`, `payment_reconcile_auto`, `reminders_auto`, `assistant_ai_kb`,
   `crm_dashboard`) is a **subset** — likely illustrative, not exhaustive. The live, Reviewed,
   already-dated-today (2026-08-03) tech spec at `feature_billing_lifecycle_tech.md:70-74` specifies
   **11**: `web_app`, `bot_zalo`, `bot_messenger`, `session_management`, `discovery_marketplace`,
   `payment_mark_manual`, `payment_reconcile_auto`, `reminders_manual`, `reminders_auto`,
   `assistant_ai_kb`, `crm_dashboard`. This contract uses the full 11-key spec as authoritative (it is
   the canonical, Reviewed source per `CLAUDE.md`'s own authority order: schema/migrations →
   feature/tech docs → decisions.md) and flags the briefing's shorter list as superseded-by-measurement,
   not as an error to silently correct without saying so.
4. **`packages/db/src/migrate.test.ts`** already has the right shape of test for this
   (`BR-5`/`BR-7`/`JCL-2` — "seed a pre-existing row, apply the migration, assert fail-closed or
   upgrade-preserved"). The fail-loud guards in migration N cannot be proven by the standard
   `pnpm test` flow alone, because that flow applies **all** pending migrations before any test body
   runs — a dedicated test must apply migrations only up to the current tail, seed a row that violates
   guard 1 or guard 2, then apply `0028` in isolation and assert it throws. Extend `migrate.test.ts`
   with this pattern rather than inventing a second harness.

None of this widens the *decision* surface — DD-29 already specifies the target shape completely — but
it does widen the *file* surface a downstream implementer must touch, which is why it is enumerated here
rather than left for that session to discover mid-round (exactly the class of thing codex would flag as
scope drift if found only at review time).

---

## Negative scope

- **NO `hasCapability` implementation** — that is `tenant-capability-authority-core`, downstream of this
  slice.
- **NO `subscriptions.selected_extra_channel` removal, `period_start`/`period_end` nullability,
  `subscription_invoices.paid_at`, or `billing_overrides.ticket_ref`** — these are DD-51 lifecycle
  deltas. The tech spec's own "Migration" section (`feature_billing_lifecycle_tech.md:131-135`) bundles
  them with the DD-29 delta under one prose heading, but the backlog explicitly scopes this task to
  "three things" (CHECK, entitlements, reseed) and DD-51's deltas belong to the separate, currently
  `idea`-status, P0 `feature-billing-lifecycle` backlog task. Bundling them here would silently expand a
  P1 slice into P0 territory.
- **NO edits to already-applied migrations** (`0007`, `0011`, `0012`, `0025`) — new behavior lands via
  new monotonic migrations plus `CREATE OR REPLACE FUNCTION`, never by editing history.
- **NO grandfather/re-pricing policy invention.** If the pre-flight check (see Human decisions, Q1)
  finds a live tenant on a paid old tier, STOP and escalate — do not invent proration, notification, or
  legacy-price-preservation logic.
- **NO wiring of `hasCapability` callers, routes, or UI.**
- **NO edits to `packages/db/src/authorization.ts`** — only its sibling test file's fixture literal.
- **NO renaming `plans_key_chk` again** — keep the name `0025` established; only its predicate changes.

---

## Human decisions — resolved (reconciliation round, 2026-08-03)

**Q1 — Live-tenant pre-flight. Resolved by NOT gating on the answer.** The original framing ("confirm
no live tenant exists before this can be PLAN_READY") was the wrong shape of question. Static evidence is
strong (see the guard-design paragraph above), but a document's belief about live data is exactly the
kind of thing that goes stale silently. The fix is structural, not epistemic: migration `0028`'s guard 1
already enumerates the full old∪new `plan_key` set explicitly and raises if any `subscriptions` row falls
outside it; guard 2 does the same for the "only version 1 ever seeded" assumption. Whether zero, one, or
many tenants exist on an old tier, the migration is correct — it either remaps them or it fails loudly
and stops, never silently. **This is why Q1 no longer appears in `HUMAN_DECISIONS_REQUIRED`: the
guard makes the question self-answering at run time, in production, against whatever is actually true
then — not something this document needs to know now.** The one sub-question that survives — grandfather
vs. re-price, IF guard 1 ever catches a row that is also `status IN ('active','past_due')` — is captured
as a `STOP_CONDITIONS` entry in §3, not as a pre-authoring blocker: it only becomes a real question if
and when the guard actually fires on a paying tenant, which is a materially different (and much cheaper
to wait for) trigger than "prove in advance that it never will."

**Q2 — Deploy cadence for N vs N+1. Decided: ship both in one release.** The self-guarding design makes
splitting *safe*, but with no live data to protect (Q1's static evidence), splitting buys nothing, and
bundling removes real operational surface: a two-release rollout would need `0029` re-authored as a
genuinely separate follow-up slice, in its own worktree, independently re-confirming Q1 before it can
start — apparatus that exists only to protect against a risk this design already handles at the
transaction level. There is a concrete correctness reason to prefer bundling too, not just simplicity:
`tenant_provision()` is redefined to write `'free'` in the SAME transaction as migration `0028` (step 3
above), so the "every tenant created between deploys still needs a later remap" risk is already zero
by construction *within* `0028` — bundling `0029` immediately after just means there is no separate
release-boundary process to get wrong in between. Shipping together is the simpler design with no
offsetting benefit to splitting.

**Q3 — Confirm the derived mapping. Recorded as a derivation, enforced by the same guard.** `free_web` →
`free` is explicit (decisions.md changelog + the `tenant_provision()` code comment). `telegram` /
`plus_channel` / `all_channels` → `host_pro` is a **derivation**: DD-29 collapses 4 tiers into exactly one
paid tier, so there is no third destination value any of the three could map to instead — a wrong
destination would require a *different* paid plan_key to exist, and none does, in the Reviewed target
schema or anywhere else. That reasoning is sound; it is still a derivation and not a verbatim-quoted
table, which is exactly the class of belief that should not be trusted blindly. It doesn't need to be:
the derivation is *encoded* in the migration's explicit `CASE` mapping and backstopped by guard 1 — if
this reasoning is ever wrong (a value existed that the derivation didn't anticipate), the migration fails
loudly rather than silently mis-mapping it. A derivation that fails closed carries a materially different
risk than a derivation someone merely remembers correctly.

None of the three block calling this `CODE_READY` — the live-data question is answered by design rather
than by knowledge, and the two genuine decisions (Q2, Q3) are now recorded above with reasoning rather
than left open.

---

## Acceptance matrix

| # | Group | Case | Expected |
|---|---|---|---|
| A1 | Expand | Apply `0028` against a DB at tail `0027` with the standard `0011` seed | New `free`/`host_pro` v1 rows exist; old 4 rows still exist; `plans_key_chk` accepts both sets |
| A2 | Expand | Call `tenant_provision()` after `0028` | New `subscriptions` row has `plan_key='free'`, not `'free_web'` |
| A3 | Expand | Pre-existing `subscriptions` row on `free_web` | Repointed to `free` v1 after `0028` — **[SUPERSEDED, v1.2]** original A3 also claimed `telegram`/`plus_channel`/`all_channels` repoint to `host_pro`; shipped behavior instead aborts the whole migration for any of those three (guard 3) — see the notice at the top of this document |
| A4 | Expand · fail-closed | Synthetic `subscriptions` row with `plan_key='bogus'` before applying `0028` | `0028` transaction raises and rolls back entirely (guard 1) — reuse `migrate.test.ts` BR-5/BR-7/JCL-2 pattern |
| A5 | Expand · fail-closed | Synthetic `subscriptions` row with `plan_key='telegram'`, `plan_version=2` before applying `0028` | `0028` raises and rolls back — shipped as guard 2 (version check); ALSO now caught independently by guard 3 (any legacy paid-tier row aborts regardless of version or status) |
| B1 | Contract | Apply `0029` immediately after a clean `0028` | Succeeds; old 4 `plans` rows gone; `plans_key_chk` now `('free','host_pro')` only |
| B2 | Contract · fail-closed | Apply `0029` against a DB where a synthetic row was forced back onto an old plan_key after `0028` | `0029`'s own guard raises — proves the self-guard is real, not just documentation |
| C1 | Regression (update) | `rls-invariants.test.ts:3300-3311` `plans_key_chk` case, `validValue` updated to `host_pro` | Passes against the new CHECK — the test's assertion is now about the new valid value |
| C2 | Regression (make indifferent) | `rls-invariants.test.ts` `subscriptions_status_chk`/`subscriptions_extra_chk` fixtures (:3313-3324, :3413-3424) swapped off `'telegram'` to any valid post-migration key | Both pass — the value no longer matters to either test |
| C3 | Regression (update) | `auth.test.ts:369` updated to `.toBe("free")` | Passes — asserting `tenant_provision()`'s real new output |
| C4 | Regression (make indifferent) | `authorization.test.ts:49` fixture updated off `'free_web'` | Passes — the value is ballast, not an assertion |
| D1 | Regression | Full existing suite outside the touched fixtures | Unchanged, green |
| E1 | Docs sync | `feature_billing_lifecycle_tech.md`'s `⚠️ PENDING MIGRATION` banner (lines 35-36) | Removed/updated with a dated note once `0028`+`0029` are verified applied — not before |

---

## Verdict

> **[v1.2, 2026-08-05] Historical planning snapshot — read before trusting anything below as
> current status.** This verdict block is unmodified since v1.1 (2026-08-03) by design — this
> project's convention is to correct a Reviewed document additively (changelog + markers), never
> to rewrite its verdict in place (codex round-11 flagged the same convention when this section
> was found stale). What changed since: implementation has LANDED in the implementing slice's own
> worktree (pending review/merge to `main`), through its own separate readiness gate — the
> `REVIEW_VERDICT: CODE_READY` below asserts "safe to start coding," which was and remains true; it
> does NOT assert "coding has not started yet," which is no longer true. Two lines below are
> factually stale as pending-work descriptions and are corrected inline: `TARGET_FILES` (the two
> migration files did not exist yet at authoring time) and `FIRST_IMPLEMENTATION_STEP` (already
> executed). Every `PASS`/`G*`/closure-matrix judgment reflects a real planning-time assessment
> that has not been invalidated — it is not being re-litigated here.

```text
REVIEW_POLICY_VERSION: 1.3
REVIEW_VERDICT: CODE_READY
REVIEWED_AT: 2026-08-03
AUTHORITY_SHA: b3d3b4a26abc3fddbbb51ebb3d9f4d33d899ab43
BASE_BRANCH: main
TARGET_FILES:
  - docs/autopilot-plans-dd29-capability-registry.md
  - docs/autopilot-manifests/plans-dd29-capability-registry.json
  - docs/features/BE/feature_billing_lifecycle_tech.md
  - docs/standards/decisions.md
  - packages/db/schema.ts
  - packages/db/migrations/0007_billing.sql
  - packages/db/migrations/0011_seeds.sql
  - packages/db/migrations/0012_auth_functions.sql
  - packages/db/migrations/0025_check_constraint_naming_drift.sql
  - packages/db/src/auth.test.ts
  - packages/db/src/authorization.test.ts
  - packages/db/src/rls-invariants.test.ts
  - packages/db/src/migrate.test.ts
  # [v1.2 addition — these two did not exist at REVIEWED_AT 2026-08-03; the implementing slice
  #  created them, they are not part of what THIS verdict originally reviewed]
  - packages/db/migrations/0028_dd29_capability_registry_expand.sql
  - packages/db/migrations/0029_dd29_capability_registry_contract.sql
SLICE: plans-dd29-capability-registry
IN_SCOPE: expand+contract migration pair for plans.plan_key/entitlements + reseed + tenant_provision()
  repoint + coupled test-fixture updates
OUT_OF_SCOPE: hasCapability · DD-51 lifecycle column deltas (selected_extra_channel, period nullability,
  paid_at, ticket_ref) · any grandfather/re-pricing logic · route/UI wiring
G1_DECISION: PASS — DD-29 pricing pivot itself is ✅ Chốt; the target CHECK/seed/capability-key set is
  spelled out verbatim in a Reviewed tech spec, not invented by this session; the one derived element
  (old→new mapping) is recorded as a derivation and enforced by a run-time guard, not asserted as fact
G2_SPEC: PASS — Product decision (decisions.md DD-29/DD-51) and BE tech spec are consistent with each
  other and with this contract
G3_DEPENDENCY: PASS — root, nothing unmet
G4_TEST: PASS — acceptance matrix has an expected result for every row, including the fail-closed
  guards (A4, A5, B2); proving them against real Postgres is the implementing slice's job, same as
  `authorize-tenant-action-core`'s CODE_READY verdict was issued before any test had run
G5_SCOPE: PASS — exact file list, explicit negative scope
G6_EXTERNAL: PASS — no external provider/legal gate
HARD_DEPENDENCIES: none — root
PRIOR_SLICES: none
OPEN_QUESTIONS_IN_SCOPE: 0 — Q1 resolved structurally (guard replaces belief), Q2/Q3 decided with
  reasoning recorded in "Human decisions — resolved"
ENABLEMENT_ONLY_GATES: none
LIVE_REPO_VERIFICATION: PASS — see "Live-truth verification" table
CONTRACT_MATRIX: PASS
CLOSURE_MATRIX: PASS (12/12)
ACCEPTANCE_MATRIX: PASS — every row has an expected result, including which of the five coupled test
  fixes are assertions-to-update versus ballast-to-make-indifferent
SECURITY_AND_MIGRATION_GATE: PASS — migration/rollback fully pinned; security review is declared
  required in the manifest and will run inside the implementing slice's own gate
IMPLEMENTATION_ARTIFACTS: PASS
FIRST_IMPLEMENTATION_STEP: [v1.2: COMPLETED — both files authored, guard 3 added, A1-A5 proven; see
  v1.2 changelog] author `0028_dd29_capability_registry_expand.sql` first (guard 1 + guard 2 +
  widen CHECK + insert new rows + redefine tenant_provision), prove A1-A5 against real Postgres before
  touching `0029`; ship both migrations in the same release per Q2
REMAINING_BLOCKERS: none
NEXT_REVIEW_TRIGGER: n/a — CODE_READY; next artifact is the implementing worktree's own readiness gate
```

### Closure matrix

| # | Gate | Evidence | |
|---|---|---|---|
| 1 | Authority snapshot pin by SHA | `b3d3b4a2` (origin/main at authoring time) + exact `TARGET_FILES`, no globs | PASS |
| 2 | Decision in scope settled | DD-29 ✅ Chốt (decisions.md:376-387); DD-51 ✅ Chốt (decisions.md:656) for the explicitly-excluded lifecycle deltas | PASS |
| 3 | Scope IN/OUT and owner clear | manifest `scope` 12 files exact + `negative_scope` 7 items | PASS |
| 4 | Dependency classified | none — root; confirmed no unmet `packages/db` dependency | PASS |
| 5 | Live schema/code matches doc | schema.ts:1230-1269, 0007/0011/0012/0025 all read directly 2026-08-03 | PASS |
| 6 | Data/API/state/auth contract sufficient | expand/contract SQL fully specified incl. `tenant_provision()` redefinition | PASS |
| 7 | Fail-closed/idempotency/order sufficient | guard 1 (unmapped value) + guard 2 (version≠1) + contract self-guard, all specified | PASS |
| 8 | Open questions in scope = 0 | Q1 resolved structurally (guard 1/2 replace the need to know); Q2 decided (ship together, reasoning recorded); Q3 recorded as a derivation enforced by guard 1 | PASS |
| 9 | Acceptance matrix has expected results | 12 rows, all with expected result, incl. update-vs-indifferent split for the 5 coupled test fixes | PASS |
| 10 | Migration/security/rollback pinned | expand+contract SQL, conditional rollback described, security round declared required | PASS |
| 11 | First-slice hard dependencies merged | none required — root | PASS |
| 12 | Implementation handoff ready | contract + manifest + launcher authored this session | PASS |

**12/12.** Row 8 was the only failing row in v1.0; it closes not because an owner picked an option for
Q1, but because Q1 was the wrong shape of question — re-derived into a run-time property instead.

---

## Changelog

| Date | Version | Change |
|---|---|---|
| 2026-08-05 | v1.5 | **Rollback atomicity + immutable-version guard; verdict-block consistency completed (same-day follow-up to v1.4).** Codex review (gate-attempt-03) found the v1.4 provenance redesign was sound but incompletely applied: (1) the rollback note described a multi-step sequence without ever stating it must run inside one explicit transaction — a bare sequence of auto-committing statements pasted into a default psql session would leave `subscriptions`/`tenant_provision()` already changed if a later step (e.g. the DELETE) failed, contradicting the note's own "aborts cleanly" claim; (2) the plans-row `DELETE FROM plans WHERE plan_key IN ('free','host_pro')` had no version filter, so an unreferenced, legitimate LATER price-change version (a `free@2`/`host_pro@2` created after this pair landed) would be silently destroyed by the same DELETE — the identical "plan version is immutable" hazard guard 2-catalog/`0029`'s guard 1b already prevent on the forward path, now needed on the rollback's own DELETE too; (3) this document's own v1.2 rollback paragraph (superseding v1.0/v1.1's original text) was itself left stale after v1.4's redesign, still directing a reader to the discarded `tenants.created_at`/`schema_migrations.applied_at` mechanism — added a second `[SUPERSEDED AGAIN, v1.4]` layer rather than deleting the v1.2 text, preserving the full historical chain. `0028`/`0029`'s own rollback notes now prescribe explicit `BEGIN`/`COMMIT` wrapping and the version guard; the test fixture's now-dead `schema_migrations` setup (needed only by the discarded age-based precondition) is removed. |
| 2026-08-05 | v1.4 | **Rollback redesign: explicit provenance instead of inference (same-day follow-up to v1.3).** Codex review (gate-attempt-02) found two more gaps in the age/unconditional-count precondition approach: (1) guard 4's own tolerance of a pre-existing, correctly-shaped `free`/`host_pro` catalog row means a subscription could already reference it before `0028` ever runs — no inference from tenant age or plan_key alone can then distinguish "never touched by this migration" from "migrated by this migration," so the precondition-based rollback could revert a subscription this migration never touched; (2) `0029`'s own guard only ever scanned `subscriptions`, so a historical catalog-only row (e.g. a `telegram@2` price snapshot) inserted in the gap between the two migrations would sail past it and be silently deleted. Converged on a design needing no inference: `0028`'s data-migrate `UPDATE` now records the exact tenant_ids it touches, atomically, in a new `dd29_migrated_tenants` table (via a writable CTE) — rollback becomes a plain lookup, not a derived property, and the plans-row `DELETE`'s own FK constraint is the actual safety net (Postgres refuses it if anything untracked still references either row, which is the correct outcome, not a bug). `0029` gained a mirrored catalog-version guard (guard 1b) closing the gap-window case. See `0028`'s and `0029`'s own rollback notes for the exact sequence. |
| 2026-08-05 | v1.3 | **Verdict-block internal consistency (docs-only, same-day follow-up to v1.2).** Codex review (gate-attempt-01 on the implementing slice's scope-expanded registration) correctly found that v1.2's markers, while not rewriting the verdict, left it internally self-contradictory as a "current" artifact: `TARGET_FILES` omitted the two migration files (they did not exist at `REVIEWED_AT`), and `FIRST_IMPLEMENTATION_STEP` still read as a pending instruction to author `0028` when it was already done. Added a historical-snapshot notice directly above the verdict block explaining what `CODE_READY` still asserts (safe to start coding — true) versus what it no longer implies (coding has not started — false), and corrected both stale lines inline with `[v1.2 addition]`/`[v1.2: COMPLETED]` markers rather than deleting the original text. The G1-G6/closure-matrix judgments and `REVIEW_VERDICT: CODE_READY` itself are unchanged — this entry does not re-assess them, only the two objectively-stale factual lines the reviewer named. Separately, the implementing slice's own rollback logic gained a second precondition this round: `host_pro` subscriptions must be checked unconditionally (not tenant-age-scoped like `free`), since an older, pre-`0028` tenant could still end up on `host_pro` via a manual/future write with no unambiguous inverse — see `0028_dd29_capability_registry_expand.sql`'s own rollback note. |
| 2026-08-05 | v1.2 | **Post-implementation reconciliation (docs-only — the code it describes already landed in the implementing slice's own worktree, pending review/merge; this entry does not re-open review of that code).** Codex review across the implementing slice's gate rounds found that guards 1/2 (designed in v1.0/v1.1) do not, by themselves, prevent the silent re-pricing this contract's own §"The mapping" flagged as an unanswered business-policy question: collapsing `telegram`/`plus_channel`/`all_channels` (79k/159k/199k) into `host_pro` (250k) via the `CASE` mapping below would upgrade a paying tenant's price without consent. A third guard (guard 3) was added that aborts the whole migration instead, for any subscription on one of those three keys regardless of status — directly enforcing this contract's own negative-scope line ("no grandfather or re-pricing policy invention... STOP and escalate") where guards 1/2 could not. Acceptance A3 narrowed to `free_web`→`free` only (the only mapping actually executed); A5 gained a second, independent guard. The rollback note's "track via a version bump or a same-transaction audit if a revert path is required" placeholder was replaced with a working mechanism: `tenants.created_at` vs. this migration's own `schema_migrations.applied_at` provides exact provenance for free (no schema change needed), plus an explicit precondition (zero tenants provisioned since this migration committed) — a full rollback and preserving a genuinely-new post-deploy tenant are fundamentally incompatible, so this is now a named STOP rather than a step that silently corrupts data or fails. Every other row of this contract (CHECK target, capability keys, `free_web`→`free`, expand→contract split, guards 1/2, deploy-together decision) is unchanged and reflects the shipped implementation. This entry does not flip the verdict block above — it remains the historical record of what v1.1 decided; this is a factual correction of what shipped, layered on top via markers at each affected section, per this project's convention of not rewriting a Reviewed document's original content in place. |
| 2026-08-03 | v1.1 | Reconciliation round. Q1 (live-tenant pre-flight) re-derived from "an owner decision this session cannot settle" into "a property the migration itself asserts" — guard 1/guard 2 were already designed in v1.0, this round changes only the framing and the verdict, not the SQL. Q2 decided: ship `0028`+`0029` in one release (self-guarding design makes splitting safe but buys nothing with no live data, and costs a real gap-window process; `tenant_provision()`'s fix already lands atomically inside `0028` regardless). Q3 recorded explicitly as a derivation (not a verbatim-quoted mapping) enforced by the same guard. Split the "coupled test fixes" list into update-vs-make-indifferent, since two of the five assert something real about the old value and three use it only as FK ballast — conflating them risks turning a ballast fixture into an accidental new assertion. Verdict flipped `NOT_PLAN_READY` → `CODE_READY`, closure matrix 11/12 → 12/12. |
| 2026-08-03 | v1.0 | Authored. Measured live schema/migrations/tests directly; found the target shape already fully specified in a Reviewed tech spec (not a fresh design); found three uncoupled test-fixture breaks and one live SECURITY DEFINER function coupling (`tenant_provision`) the original backlog estimate did not name; corrected the capability-key count from the briefing's 6-key example list to the spec's real 11. Verdict `NOT_PLAN_READY` — 3 open questions presented, not settled, per this session's own scope. |
