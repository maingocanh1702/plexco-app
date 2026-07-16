# Feature: Identity Directory & Merge — Backend Tech Spec

> **Canonical phase:** P3.5
> **Version:** 1.3 · 2026-07-16
> **Status:** Implementation contract reconciled to TDD v2.6 / decisions v1.39; schema/code pending B0 and identity build slices
> **Product spec:** `../feature_identity.md`
> **References:** `../../product/TDD.md` §3.2–3.4/§4 · `../../research/player-side-saas-AUDIT.md` · `../../standards/decisions.md` DD-13/DD-37/DD-50/DD-53

> **Cập nhật v1.3 (DD-50/v1.37):** phase-1 không thu SĐT; phone columns remain dormant. Debt-bearing claim proof = server-verified account email or transactional one-time `link_code`; schema presence alone is not runtime implementation.

---

## 1. Components and trust boundary

```text
channel adapter → resolve stable platform identity
                → identity service (protected global directory)
                → tenantRepo membership/reachability (RLS)

/link → link-code service → merge planner → merge transaction
admin suggestion → tenant authz → merge planner → merge transaction
```

Global does not mean public. Runtime API role receives no broad SELECT on persons/channel identities/link codes/audit. Access occurs through identity service functions with authenticated actor, purpose and audit.

Phase-1 runtime accepts **Zalo + Messenger** channel identities (DD-37, Messenger promoted to P2.5). `telegram` remains only as a legacy tenant-1 enum value in the canonical schema — no new Telegram identities are created.

---

## 2. Schema

```sql
CREATE TABLE persons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name text,
  phone_enc bytea,
  phone_lookup_hash text,
  phone_verified_at timestamptz,
  status text NOT NULL CHECK (status IN ('active','merged','deleted')),
  merged_into_person_id uuid REFERENCES persons(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX persons_verified_phone_unique
ON persons(phone_lookup_hash)
WHERE phone_verified_at IS NOT NULL AND status = 'active';

CREATE TABLE channel_identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id uuid NOT NULL REFERENCES persons(id),
  platform text NOT NULL CHECK (platform IN ('zalo','messenger')),  -- phase-1 (DD-37); canonical schema.ts keeps 'telegram' as legacy tenant-1 enum
  platform_user_id_enc bytea NOT NULL,
  platform_user_lookup_hash text NOT NULL,
  username_enc bytea,
  status text NOT NULL CHECK (status IN ('active','inactive')),
  UNIQUE (platform, platform_user_lookup_hash)
);

CREATE TABLE memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  person_id uuid NOT NULL REFERENCES persons(id),
  display_name text,
  pay_code text,
  status text NOT NULL CHECK (status IN ('active','guest','left','merged')),
  merged_into_membership_id uuid REFERENCES memberships(id)
);

CREATE UNIQUE INDEX memberships_active_person_unique
ON memberships(tenant_id, person_id)
WHERE status IN ('active','guest');

CREATE TABLE channel_reachability (
  person_id uuid NOT NULL REFERENCES persons(id),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  platform text NOT NULL,
  can_dm boolean NOT NULL DEFAULT false,
  last_inbound_at timestamptz,
  PRIMARY KEY (person_id, tenant_id, platform)
);

CREATE TABLE link_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_person_id uuid NOT NULL REFERENCES persons(id),
  source_channel_identity_id uuid NOT NULL REFERENCES channel_identities(id),
  code_lookup_hash text NOT NULL UNIQUE,
  code_hash bytea NOT NULL,
  salt bytea NOT NULL,
  action text NOT NULL DEFAULT 'merge_identity',
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  failed_attempts integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE merge_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_person_id uuid NOT NULL,
  target_person_id uuid NOT NULL,
  canonical_person_id uuid NOT NULL,
  method text NOT NULL,
  actor_type text NOT NULL,
  actor_id uuid,
  reason_code text,
  before_snapshot_enc bytea NOT NULL,
  after_snapshot_enc bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE merge_tombstones (
  old_person_id uuid PRIMARY KEY,
  canonical_person_id uuid NOT NULL REFERENCES persons(id),
  merge_audit_id uuid NOT NULL REFERENCES merge_audit(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
```

`memberships` and `channel_reachability` use ENABLE + FORCE RLS with `app.tenant_id`. Protected global tables use grants/narrow service functions rather than tenant RLS.

Phone columns are dormant phase-1. Platform IDs and link-code lookups use keyed hashes; never store/log plaintext code, email or raw IDs.

---

## 3. Identity resolution

Input from trusted adapter: platform + stable provider user ID + routed tenant.

1. Compute keyed lookup hash.
2. Resolve channel identity through protected service.
3. If absent, create Person + ChannelIdentity idempotently; handle unique race by reload.
4. Within tenant RLS context, resolve active/guest membership.
5. Create membership only for explicit join/approved action; first contact alone does not grant tenant membership.

Deep links/sticky context route interaction only; they never grant admin/player data permission.

---

## 4. Verified-proof + `link_code` service

- Generate cryptographically random code/deep link with ≥64 bits entropy.
- Store keyed lookup hash for indexed lookup plus salted slow hash for verification; return plaintext once.
- TTL default 10 minutes, single-use.
- Rate-limit issue/verify by source identity, target identity/IP and tenant context where present.
- Consume transaction locks the link-code row; verifies source channel/person, exact action and TTL; increments failures atomically; sets `consumed_at` exactly once; then creates a merge plan.
- Code authorizes only merge proposal; explicit confirmation is required before merge commit.
- Verified account-email evidence comes only from the auth service: Google OIDC signature+issuer+audience+nonce+`exp/iat`+`email_verified=true`, or a consumed email verify token. Never accept a request-body boolean/email as proof.
- Notify both source and target channels after success.

Errors are generic: `LINK_CODE_INVALID`, `LINK_CODE_RATE_LIMITED`, `MERGE_REQUIRES_REVIEW`; do not reveal whether a person/email exists.

---

## 5. Merge planner and transaction

### Planner

Loads protected identity metadata plus tenant-scoped membership impact. Produces a redacted plan:

- canonical Person choice;
- channels to move;
- membership conflicts and survivor proposal;
- charges/player rows affected;
- reachability conflicts;
- risk flags requiring admin/support review.

No data changes occur during planning.

### Commit algorithm

1. Validate idempotency key, actor authorization and verified method.
2. Sort source/target person IDs; lock in stable order.
3. Reload plan and reject if stale.
4. Move ChannelIdentity rows to canonical Person.
5. For each tenant, enter tenant RLS context or use audited narrow merge function:
   - no conflict: re-parent membership;
   - conflict: select survivor, re-parent players/charges, mark loser `merged`, set tombstone link;
     **pay_code (DD-02): KEEP on tombstone (do NOT re-parent); reconcile recognition follows
     `merged_into_membership_id` to survivor (tenant/status/cycle guards) so old QR/memo still resolve;**
   - merge reachability deterministically per tenant/platform.
6. Do **not** update/delete bank transactions or payment allocations. Allocations remain attached to charges; re-parented charges preserve ledger totals.
7. Mark old Person `merged`, create person tombstone.
8. Invalidate outstanding link codes and sensitive sessions.
9. Write encrypted before/after audit + outbox event atomically.

Cross-tenant merge capability is isolated from normal HTTP role and audited per affected tenant. If any tenant step fails, the whole merge rolls back.

---

## 6. Claim policy

`claimMembership(personId, membershipId, evidence)`:

- Load membership under tenant RLS and compute `hasFinancialHistory` from charges/allocations.
- If financial history exists, accept only server-verified account email or valid consumed `link_code`. A pre-issued recovery artifact restores account access under DD-53 but does not itself claim a debt-bearing membership.
- Name/fuzzy/bank/CK/owner assertion may create review evidence but cannot auto-claim debt-bearing membership or replace strong proof.
- Review records actor/evidence/reason but does not bypass proof.
- Claim race uses membership/person locks and active uniqueness constraint.

---

## 7. Commands and protected interfaces

| Interface | Authorization | Notes |
|---|---|---|
| `/link` | Current channel identity | Issue code for own Person |
| `/link <code>` | Current target channel + confirmation | Verify and create merge plan |
| `adminApproveClaim` | TenantAdmin in affected tenant | Strong warning + reason + audit |
| `suggestMerge` | System/tenant admin | Redacted tenant-local candidates only |
| `resolvePersonSelf` | Verified session/magic link | Returns authenticated person only |
| `supportRecoverMerge` | Restricted support role | Runbook + dual confirmation recommended |

P4.6 `/myclubs` consumes `resolvePersonSelf`; it is not part of P3.5 rollout.

---

## 8. Recovery and deletion

Automated destructive undo is not allowed. Recovery runbook:

1. Freeze affected identity operations.
2. Load merge audit/tombstones and ledger invariants.
3. Create a reviewed split plan mapping channels/memberships/charges.
4. Execute through restricted support command with idempotency and audit.
5. Re-run tenant/ledger invariants and issue correction notifications.

PII deletion uses anonymization/crypto-shredding subject to financial/legal retention; audit IDs and transaction integrity remain.

---

## 9. Testing

### Unit

- Stable lookup hashes, encryption boundaries and redaction.
- Link-code entropy/hash/source-action binding/TTL/single-use/atomic-attempt/rate-limit.
- Merge planner for no conflict, membership conflict and dormant-phone collision.
- Survivor/reachability deterministic rules.
- Claim strong-key matrix.

### Integration

- Concurrent first contact creates one identity.
- Concurrent/opposite merges do not deadlock or duplicate.
- Link code race consumes once.
- Membership conflict preserves players/charges and ledger totals.
- Bank transactions/allocations remain byte-for-byte unchanged after merge.
- Reachability remains tenant-scoped.
- API role cannot enumerate protected global directory.
- Person-self cannot request another person.
- Admin from tenant A cannot approve tenant B claim.
- Merge rollback leaves no partial tenant updates.
- Recovery staging exercise restores intended split and invariants.

### Security

- Link-code brute-force, wrong-action, expired, concurrent double-consume and enumeration tests.
- Google/email proof cannot be forged from client fields; invalid `iss/aud/nonce/time/email_verified` rejected.
- Logs/analytics contain no raw platform ID, phone/email, code or display name.
- Protected function grants/search path tests.
- KMS rotation/backward decryption test.

---

## 10. Rollout and monitoring

1. Add protected tables/grants and tenant RLS tables.
2. Backfill Person/ChannelIdentity from tenant #1 with provenance.
3. Shadow identity suggestions; no auto merge.
4. Enable `link_code` for internal dogfood after transactional consume tests pass.
5. Exercise conflict/recovery runbooks.
6. Enable debt-bearing claim only after verified account-email/link-code evidence matrix passes; phone remains dormant.

Metrics: person/channel creation, merge success/failure by method, claim rejection, conflicts, link-code failure/rate-limit, proof rejection reason, recovery count. Analytics uses opaque IDs only.

---

## 11. Definition of Done

- [ ] Protected grants and tenant RLS tests pass.
- [ ] Secure `link_code`, verified-email evidence and concurrency tests pass.
- [ ] Merge preserves membership/history/ledger invariants.
- [ ] Claim-with-financial-history gate passes attack tests.
- [ ] Audit/tombstones/recovery runbook verified.
- [ ] Product acceptance criteria in `../feature_identity.md` pass.

---

## Changelog

| Date | Version | Change |
|---|---|---|
| 2026-07-16 | v1.3 | **DD-50 full propagation:** transactional one-time `link_code`, server-only verified-email evidence matrix, phone dormant, no CK/name/owner bypass, and new security/concurrency tests. |
| 2026-07-10 | v1.2 | **DD-37 ✅:** phase-1 channels = Zalo + Messenger; `channel_identities.platform` phase-1 ∈ {`zalo`,`messenger`}, `telegram` legacy tenant-1 only. Person links Google+Facebook+Zalo (web-auth DD-13/33/14). Merge signals: verified SĐT (DD-01) + verified email (DD-13). |
| 2026-06-18 | v1.1 | Protected identity, tenant reachability, secure OTP, ledger-safe merge and recovery contract |
| 2026-06-18 | v1.0 | Initial legacy backend spec |
