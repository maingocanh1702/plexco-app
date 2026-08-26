<!-- review-readiness: criteria -->

# Autopilot slice contract — `identity-account-link-core`

> **Classification: `criteria`.** This is the slice DESIGN CONTRACT + acceptance criteria. It is NOT a
> readiness verdict and asserts NOTHING about readiness. Pre-merge readiness is proven only by the
> scope-gate `ready` gate-result (2 clean code rounds + a mandatory security round) under
> `.autopilot/state/identity-account-link-core-v3/` — not by this file. There is deliberately no
> `code-ready` verdict block here: a valid one requires `AUTHORITY_SHA` to be an ancestor of `main`
> (an already-merged commit), which is impossible on an unmerged branch; a post-merge verdict, if the
> team keeps one, is a separate follow-up. Language: English (agent-facing `docs/autopilot/contracts/*`).

## 1. What this slice is — and what it deliberately is NOT

DD-32 Option D lets a channel user browse and register before linking; on the **paid + available**
branch a `linked` account may go active + one open charge (pay later). The safety question is HARD
RULE 4 (claim-with-money needs strong proof, AUDIT C2/C5): does this channel actor genuinely hold a
verified Plexco account?

This slice ships the **person-account convergence CORE** of that check — and, per the owner ruling of
2026-08-25 (codex round 2, option A), **only** the core, as an **internal, owner/definer-only** helper:

- It proves an exact active `ChannelIdentity` and a **verified** Plexco `Account` resolve to the **same
  current canonical Person** (following the merge chain), fail-closed on merged/deleted/tombstoned/
  ambiguous/divergent. The verified-account predicate is the owner DD-50 amendment: an active account on
  the canonical person with **≥1 `account_emails.verified_at IS NOT NULL`**; legacy Telegram
  `account_identities` do NOT count. The ONLY bridge is `person_id` convergence — never a raw
  PSID/`from.id`, provider name or display name.
- It is **NOT the full DD-32 resolver.** It does NOT perform the contract's `endpointContext` /
  Page-OA / authenticated-actor validation (`feature_identity_tech` §4), because live
  `channel_identities` lacks the DD-65..68 endpoint-scope columns to validate against. It is therefore
  **not granted to `app`** and has **no app-facing TS surface** — exposing an incomplete money/identity
  predicate to `app` is a P1 (codex round 2). It is **not finalizer-safe**: qualification is a snapshot
  at resolve time (see §5).

## 2. Task contract (Level 3) — option-A scope

```
TASK_ID: plexco:identity-account-link-core-v3
OUTCOME: the INTERNAL person-account convergence core for DD-32 Option D — SQL SECURITY DEFINER function
  resolve_deferred_payment_account_core, owner/definer-only, no app grant, no TS surface. Two ratified
  fail-closed disciplines: SEC-1 (per-node tombstone corroboration, DD-50 amendment 3) and F2 (verified-account
  count across the WHOLE resolved chain, DD-50 amendment 4). ACL = the 0027 posture under the ratified
  trusted-migration threat model (DD-50 amendment 4); NO dynamic-ACL/aclexplode/regprocedure hardening.
REPOSITORY_AND_BASE: plexco-app @ origin/main a8ae81d (after DD-50 amendment 4 — ACL trusted-migration model + account fail-closed across chain)
RISK: P1 (identity/claim money boundary, HARD RULE 4)
SCOPE (4 code + 2 docs):
  - packages/db/migrations/0034_identity_account_link_resolver.sql   (SECURITY DEFINER fn; REVOKE-only, NO app grant)
  - packages/db/src/identity-account-link.test.ts                    (owner-run matrix + EXECUTE-denied boundary)
  - packages/db/src/migrate.test.ts                                  (MIGRATION_COUNT 34→35 + tail 0034)
  - packages/db/src/rls-invariants.test.ts                           (the 2nd copy of the count/tail: UCC-8 + 3 siblings)
  - docs/autopilot/contracts/autopilot-identity-account-link-core.md (this criteria doc)
  - docs/autopilot-manifests/identity-account-link-core.json         (authored contract)
NEGATIVE_SCOPE:
  - NO GRANT EXECUTE to app / app_worker / readonly (0027 posture: REVOKE FROM PUBLIC + revoke runtime roles) — owner/definer-only
  - NO dynamic-ACL hardening (aclexplode/proacl/::regprocedure/schema-qualify) — out-of-contract per DD-50 amendment 4
  - NO app-facing TS wrapper or barrel export (identity-account-link.ts and the index.ts export were dropped)
  - NO endpointContext / Page-OA / provider_scope_lookup_hash / messenger_page_id / zalo_bot_id (DD-65..68 pending)
  - NO full concurrency serialization (snapshot semantics; the finalizer owns it — §5)
  - NO channel adapters/routes/UI, no intent/hold/finalizer, no phone fields, no link_code UX/merge, no schema.ts change
VERIFICATION: pnpm typecheck/lint/format:check/build + DATABASE_URL_TEST pnpm test (real Postgres, owner-run tests)
CODE_REVIEW: scripts/codex-review-pin.sh, 2 consecutive clean rounds.  SECURITY_REVIEW: MANDATORY.
STOP_CONDITIONS: MAX_ROUNDS(>5) · REGION_THRASH · SCOPE_OR_BASE_DRIFT.
```

> **v3 lineage.** v1 (`feat/identity-account-link-core`, `c78efcd`): 2 clean code rounds, then the first
> security round returned SEC-1 + SEC-2 → HALT MAX_ROUNDS at fix-round 5; owner ruling 1b ratified the
> path-compressed `merge_tombstones` invariant (`decisions.md` `f6f98ab`). v2 (`feat/identity-account-link-core-v2`,
> `5e6a7ef`) implemented both, but the owner-only ACL hardening thrashed 3 consecutive rounds
> (default-privileges → overload → search_path) → **HALT REGION_THRASH**: an unbounded migration-ENVIRONMENT
> edge-family exceeding repo convention (no migration incl. 0027 schema-qualifies `CREATE FUNCTION`). Owner
> ratified (`decisions.md` `a8ae81d`, amendment 4): (a) migrations are owner-authored + TRUSTED → the 0027 ACL
> posture, environment-hardening OUT of the phase-1 threat model, the F1 finding class retired by owner security
> sign-off (out-of-contract here); (b) qualified-link account predicate is fail-closed across the WHOLE chain.
> This **v3** successor is built from `a8ae81d`: ports the reviewer-accepted core (SEC-1, verified-email, lock
> order, revalidation), applies the 0027 ACL posture (drops the dynamic-ACL block for a smaller/cleaner diff),
> adds the chain-wide account fail-closed (F2) + regressions. Fresh fix-round budget = **sanctioned
> accepted-finding path** (level3-workflow §8 gap #4) — accepted, not contested.

## 3. Why a SECURITY DEFINER function, owner-only

Role `app` holds **zero grant** on the global-protected identity tables (`0009`: "Global protected
identity/auth tables: NO grant to app — least privilege"); per `feature_identity_tech` §2/§4 they are
reachable only through narrow SECURITY DEFINER functions. This function follows the
`resolve_tenant_status_locked` (0027) precedent — READ-ONLY definer, pinned `search_path`,
`REVOKE ALL FROM PUBLIC` — **but grants EXECUTE to NO runtime role** (option A). So on live schema no
runtime role can call it; it is owner/definer-callable only. The successor endpoint-complete resolver
(DD-65..68) will grant EXECUTE to `app` there, after it adds the endpoint validation.

**Owner-only DDL — the 0027 posture under the ratified trusted-migration threat model (DD-50 amendment 4,
`a8ae81d`).** The migration is owner-authored and TRUSTED: `CREATE FUNCTION` + `SET search_path =
public, pg_temp` + `REVOKE ALL FROM PUBLIC` + revoke `app`/`app_worker`/`readonly` (no grant), exactly as
`resolve_tenant_status_locked` (0027) writes it. `CREATE` grants EXECUTE to `PUBLIC` by default, so the
`REVOKE FROM PUBLIC` is what makes it owner-only. Hardening the migration-time DDL against a hostile
`search_path` / pre-set `ALTER DEFAULT PRIVILEGES` / injected overload is **OUT of the phase-1 threat model**
for migration-authored objects — the ratified amendment retires that finding class (no migration in this
repo schema-qualifies `CREATE FUNCTION`, incl. 0027). Owner-only is proven by the boundary tests
(app/app_worker/readonly permission-denied on EXECUTE + `has_function_privilege` false), not by a
dynamic-ACL enumeration.

**Naming (codex round 4).** This internal core is named `resolve_deferred_payment_account_core`. The
bare contract name `resolve_deferred_payment_account` — which `decisions.md` DD-50 (:683) and
`feature_identity_tech` §4 reserve for the APP-GRANTED resolver — is deliberately NOT defined by this
migration; it is reserved for the DD-65..68 successor that wraps this core. This keeps the committed
authority (which requires that name to grant EXECUTE to `app`) consistent with this owner-only core,
without a `decisions.md` change.

```
resolve_deferred_payment_account_core(p_channel_identity_id uuid)
  RETURNS TABLE (qualified boolean, account_ref uuid, person_ref uuid, binding_version text)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp   -- read-only; REVOKE-only, no app grant
```

Deny-vs-throw is not exposed via a TS wrapper in this slice (there is none); the SQL function itself
returns exactly one row and never mutates. `binding_version` = `encode(sha256(convert_to('plexco:
deferred-payment-binding:v1:' || channel_identity_id || ':' || ci.person_id || ':' || canonical || ':'
|| account, 'utf8')), 'hex')` — the deterministic snapshot token the future finalizer rechecks (§5).

## 4. Decision table (fail-closed; every deny is identical `{qualified:false}`, zero mutation)

The function resolves READ-ONLY, then acquires `FOR SHARE` locks in the canonical global order
(account → verified-email → chain-persons UUID-sorted → channel_identity), then **revalidates** under
lock (§4 consume pattern). Locking in that single total order makes a 40P01 deadlock against a
concurrent merge/consume impossible. Every MERGED chain node is additionally corroborated against
`merge_tombstones` (SEC-1) in BOTH phase-1 and the locked phase-3.

| # | Condition | Outcome |
|---|---|---|
| 1 | `p_channel_identity_id` NULL | `{qualified:false}` |
| 2 | ChannelIdentity absent | `{qualified:false}` |
| 3 | ChannelIdentity `status <> 'active'` | `{qualified:false}` (stale/inactive) |
| 4 | walk `merged_into_person_id` lands on an `active` person | continue with that canonical |
| 5 | walk hits `deleted` (or non-active/non-merged) | `{qualified:false}` (frozen) |
| 6 | `merged` with NULL pointer, cycle, or depth>16 | `{qualified:false}` (merge-pending/ambiguous) |
| 6b | a MERGED chain node missing its `merge_tombstones` row, or one whose `canonical_person_id` ≠ the final canonical | `{qualified:false}` (incomplete/divergent merge; SEC-1 per-node corroboration of the path-compressed invariant, phase-1 AND locked phase-3) |
| 7 | 0 verified accounts across the resolved chain (`ANY(v_chain)`) | `{qualified:false}` (unlinked/unverified) |
| 8 | >1 verified account across the chain (incl. one lingering on a merged source node) | `{qualified:false}` (ambiguous; F2 chain-wide, DD-50 amendment 4) |
| 8b | exactly one verified account across the chain BUT on a non-canonical (merged) node | `{qualified:false}` (must resolve to the final canonical; F2) |
| 9 | exactly one verified account, CI active, both converge on same active canonical, revalidation holds | `{qualified:true, account_ref, person_ref, binding_version}` |

## 5. Boundary fences (documented, NOT gaps — with named resume conditions)

- **No endpoint / Page-OA / actor validation** — live `channel_identities` has no
  `messenger_page_id`/`zalo_bot_id`/`provider_scope_lookup_hash`. RESUME: the **DD-65..68 endpoint-scope
  migration** lands those columns; then a **successor slice** adds the app-facing, endpoint-complete
  resolver that wraps this core, does the endpoint/actor validation, and grants EXECUTE to `app`, with
  its own security round. This slice does not expose the partial predicate to `app`.
- **Snapshot, NOT finalizer-safe (codex round 2 #1, owner ruling)** — "exactly one verified account" is
  true AT RESOLVE TIME. A concurrent flow can still promote a second account's pending email to verified
  after this returns, making the binding ambiguous. Full serialization across the auth email-verify /
  account-insert flows is **explicitly out of scope here and owned by the finalizer**, which MUST
  re-check `binding_version` under its own full lock set before any money-bearing action. This is a
  documented layering boundary, not a defect: `binding_version` is the deterministic recheck token.
- **Freeze flag (DD-53)** has no live column, so "frozen" is represented as person `status != active` /
  broken merge chain (fail-closed). RESUME: when a freeze flag/table lands, add the check.

## 6. Test plan (real Postgres; the function is called as owner/definer)

- **Boundary:** `app`, `app_worker`, `readonly` are ALL permission-denied on EXECUTE of the function
  (and `has_function_privilege` is false for each); `app` still cannot direct-SELECT
  `persons`/`accounts`/`account_emails`/`channel_identities`/`merge_tombstones`.
- **Definer discipline:** `pg_proc.prosecdef` true, `proconfig` pins `search_path=public, pg_temp`.
- **Fail-closed matrix (§4):** each row, seeded via `ctx.owner` and resolved via `ctx.owner`.
- **SEC-1 (per-node tombstone corroboration):** merge-chain qualify cases seed matching tombstones; missing / divergent / two-hop second-node negatives deny.
- **F2 (chain-wide account fail-closed):** a verified account on a merged source node — alone, or alongside the canonical's — denies, proving the count spans the whole chain, not only the canonical.
- **Merge-adjacent negatives:** a channel lookup-hash equal to an `account_identities.platform_user_hash`
  does NOT bridge without person convergence; a legacy Telegram-only account (no verified email) does
  not qualify.
- **Snapshot / current-state:** a 2nd verified account or a deleted verified email flips the next
  resolve — demonstrating the predicate reflects live membership (snapshot semantics per §5).
- **binding_version:** deterministic across calls; changes on re-parent; flips to not-qualified on a
  further merge.

migrate.test.ts + rls-invariants.test.ts: `MIGRATION_COUNT` 34→35 and tail `0034_identity_account_link_resolver.sql`.

## 7. Readiness

There is no verdict in this file (see the classification note above). The authoritative pre-merge
readiness evidence is the scope-gate `ready` gate-result + `READY.txt` under
`.autopilot/state/identity-account-link-core-v3/`. Merge authority is the owner (STOP_AT_READY).
