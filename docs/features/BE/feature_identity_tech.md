# Feature: Identity Directory & Merge — Backend Tech Spec

> **Canonical phase:** P3.5
> **Version:** 1.7 · 2026-07-17
> **Status:** Implementation contract reconciled to TDD v3.1 / decisions v1.45; endpoint-scoped schema/code pending identity/channel build slices
> **Product spec:** `../feature_identity.md`
> **References:** `../../product/TDD.md` §3.2–3.4/§4 · `../../research/player-side-saas-AUDIT.md` · `../../standards/decisions.md` DD-13/DD-37/DD-50/DD-53/**DD-65..68** · `feature_player_messenger_tech.md`

> **Cập nhật v1.3 (DD-50/v1.37):** phase-1 không thu SĐT; phone columns remain dormant. Debt-bearing claim proof = server-verified account email or transactional one-time `link_code`; schema presence alone is not runtime implementation.
>
> **Cập nhật v1.5 (DD-15/DD-50/DD-67/v1.45):** mọi channel identity/reachability là provider-endpoint scoped. Messenger scope Page; Zalo scope bot/OA cho tới khi DD-15 chứng minh rộng hơn. `link_code` hỗ trợ issuer XOR channel/account. Live schema chưa có contract này; migration mới phải land trước runtime. Không sửa migration lịch sử.
>
> **Cập nhật v1.6:** endpoint binding không được dựa vào hash đơn độc: mỗi identity phải có đúng một FK tới Messenger Page hoặc Zalo bot/OA phù hợp với `platform`, và protected writer tự derive/re-check scope hash từ row registry đó. Consume `link_code` pin thứ tự terminal checks, XOR issuer revalidation và atomic attempt/consume.
>
> **Cập nhật v1.7:** sửa trust-boundary drift: `zalo_bots` vẫn là bảng tenant-private có ENABLE + FORCE RLS theo TDD/live migration; chỉ Messenger hybrid registry cùng global identity/reachability/link-code tables là global-protected. Narrow resolver phải validate Zalo endpoint dưới exact tenant context, không reclassify `zalo_bots` thành global/no-grant.

---

## 1. Components and trust boundary

```text
channel adapter → resolve stable platform identity
                → identity service (protected global directory)
                → tenantRepo membership (RLS)
                → endpoint reachability (protected channel-identity relation)

/link → link-code service → merge planner → merge transaction
admin suggestion → tenant authz → merge planner → merge transaction
```

Global does not mean public. Runtime API role receives no broad SELECT on persons/channel identities/link codes/audit. Access occurs through identity service functions with authenticated actor, purpose and audit.

Phase-1 target accepts **Zalo + Messenger** channel identities (DD-37, Messenger promoted to P2.5). `telegram` remains only as a legacy tenant-1 enum value in the canonical schema — no new Telegram identities are created. Messenger target is gated on DD-65..68 migration/runtime; live schema is not sufficient.

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
  platform text NOT NULL CHECK (platform IN ('zalo','messenger','telegram')), -- telegram is read-only legacy shape
  messenger_page_id uuid REFERENCES messenger_pages(id), -- required iff messenger; DD-65 registry
  zalo_bot_id uuid REFERENCES zalo_bots(id),              -- required iff zalo; bot/OA registry row
  platform_user_id_enc bytea NOT NULL,
  provider_scope_lookup_hash text NOT NULL, -- HMAC("channel-scope:"||platform||":"||Page/bot/OA id)
  platform_user_lookup_hash text NOT NULL, -- HMAC("channel-user:"||platform||":"||PSID/from.id)
  username_enc bytea,
  status text NOT NULL CHECK (status IN ('active','inactive')),
  CHECK (
    (platform = 'messenger' AND messenger_page_id IS NOT NULL AND zalo_bot_id IS NULL)
    OR
    (platform = 'zalo' AND zalo_bot_id IS NOT NULL AND messenger_page_id IS NULL)
    OR
    (platform = 'telegram' AND messenger_page_id IS NULL AND zalo_bot_id IS NULL)
  ),
  UNIQUE (platform, provider_scope_lookup_hash, platform_user_lookup_hash)
);

CREATE UNIQUE INDEX channel_identities_messenger_endpoint_user_unique
ON channel_identities(messenger_page_id, platform_user_lookup_hash)
WHERE platform = 'messenger';

CREATE UNIQUE INDEX channel_identities_zalo_endpoint_user_unique
ON channel_identities(zalo_bot_id, platform_user_lookup_hash)
WHERE platform = 'zalo';

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
  channel_identity_id uuid PRIMARY KEY REFERENCES channel_identities(id),
  can_dm boolean NOT NULL DEFAULT false,
  last_inbound_at timestamptz,
  window_expires_at timestamptz,
  outside_window_token_enc bytea,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE link_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_person_id uuid NOT NULL REFERENCES persons(id),
  source_channel_identity_id uuid REFERENCES channel_identities(id),
  source_account_id uuid REFERENCES accounts(id),
  code_lookup_hash text NOT NULL UNIQUE,
  code_hash bytea NOT NULL,
  salt bytea NOT NULL,
  action text NOT NULL DEFAULT 'merge_identity',
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  failed_attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 5 CHECK (max_attempts BETWEEN 1 AND 20),
  locked_until timestamptz,
  revoked_at timestamptz,
  CHECK (num_nonnulls(source_channel_identity_id, source_account_id) = 1),
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

`memberships` và `zalo_bots` là **tenant-private**: ENABLE + FORCE RLS với exact `app.tenant_id`; app chỉ được chạm row Zalo của tenant hiện hành dưới tenant context, và secret fields vẫn đi qua API/function hẹp có redact/audit. `channel_identities`, hybrid `messenger_pages`, `channel_reachability` và `link_codes` là **global-protected**: không blanket app table grant, chỉ narrow identity/delivery functions có exact endpoint relation, target-tenant eligibility check và purpose/audit. Mỗi protected create/resolve function nhận registry row id; với Messenger nó lock/read Page registry toàn cục, còn với Zalo nó thiết lập/kiểm tra exact tenant context rồi lock/read đúng `zalo_bots` row. Function derive `provider_scope_lookup_hash` server-side từ provider endpoint id trong registry và reject nếu caller-supplied platform/scope hoặc routed tenant không khớp. Không có write path nào nhận scope hash tự khai để thay thế FK; hai partial unique indexes giữ uniqueness theo relation thật bên cạnh canonical three-part lookup key. Runtime service rejects `platform='telegram'` on every create/update; the third CHECK arm only preserves existing legacy tenant-1 rows during upgrade until explicit archive, never reopens Telegram. Runtime role chỉ có `EXECUTE` trên narrow functions cho **global-protected tables**; issuer/source/action/hash/expiry fields immutable sau issue, còn consume chỉ được đổi lifecycle fields bằng conditional statements đã pin. Contract này không thu hồi tenant-scoped RLS access hợp lệ của `zalo_bots` và không biến bảng đó thành global registry.

Phone columns are dormant phase-1. Platform IDs and link-code lookups use keyed hashes; never store/log plaintext code, email or raw IDs.

---

## 3. Identity resolution

Input from trusted adapter: platform + stable provider endpoint id + provider user ID + routed tenant context.

1. Resolve and authorize the concrete `messenger_pages.id` or `zalo_bots.id` registry row. Protected service computes two domain-separated keyed lookup hashes: scope input is the provider Page/bot/OA id read from that row; user input is PSID or `from.id`. The stored FK, `platform` CHECK and derived scope hash must all agree; mismatch fails closed.
2. Resolve channel identity through protected service.
3. If absent, create Person + ChannelIdentity idempotently; handle unique race by reload.
4. Within tenant RLS context, resolve active/guest membership.
5. Create membership only for explicit join/approved action; first contact alone does not grant tenant membership.

Deep links/sticky context route interaction only; they never grant admin/player data permission.

---

## 4. Verified-proof + `link_code` service

- Generate cryptographically random code/deep link with ≥64 bits entropy; bind exactly one authenticated issuer (`source_channel_identity_id` XOR `source_account_id`) and derive/re-check `source_person_id` server-side.
- Store keyed lookup hash for indexed lookup plus salted slow hash for verification; return plaintext once.
- TTL default 10 minutes, single-use.
- Rate-limit issue/verify by source identity, target identity/IP and tenant context where present.
- Consume transaction follows the pinned fail-closed algorithm below; it never trusts a request `source_person_id` and never mutates attempts after the row is terminal.
- Code authorizes only merge proposal; explicit confirmation is required before merge commit.
- Verified account-email evidence comes only from the auth service: Google OIDC signature+issuer+audience+nonce+`exp/iat`+`email_verified=true`, or a consumed email verify token. Never accept a request-body boolean/email as proof.
- Notify both source and target channels after success.

Errors are generic: `LINK_CODE_INVALID`, `LINK_CODE_RATE_LIMITED`, `MERGE_REQUIRES_REVIEW`; do not reveal whether a person/email exists.

### Transactional consume algorithm

The consume service is the only runtime principal granted access to `link_codes`. In one transaction it:

1. Resolves the opaque lookup component, locks the matching `link_codes` row `FOR UPDATE`, and re-checks `num_nonnulls(source_channel_identity_id, source_account_id) = 1` even though the database CHECK also enforces it. A missing/corrupt row returns the same generic error.
2. **Before verifier accounting or merge-plan creation**, rejects when `consumed_at IS NOT NULL`, `revoked_at IS NOT NULL`, `expires_at <= transaction_timestamp()`, `failed_attempts >= max_attempts`, or `locked_until > transaction_timestamp()`. These terminal/locked paths do not increment attempts, unlock, consume or create a plan.
3. Locks exactly one issuer relation plus the stored source Person. For a channel issuer it loads the active `channel_identities` row and its current `person_id`; for an account issuer it loads the authenticated `accounts.person_id` relation. It derives that current Person server-side and requires exact equality with stored `source_person_id`; the stored Person must still be `active`, with no merge/tombstone redirect. A missing/inactive issuer, changed binding, XOR violation or stale/merged source fails closed; merge commit also revokes outstanding codes so this is defense in depth.
4. Re-checks `action = 'merge_identity'` and verifies the salted slow hash in constant time. A wrong verifier performs one conditional atomic update `failed_attempts = failed_attempts + 1` only while all step-2 predicates and issuer binding still hold; reaching the cap applies cooldown/lock policy. The service returns a result rather than throwing before that update commits.
5. For a valid verifier, atomically claims the code with a conditional `UPDATE ... SET consumed_at = transaction_timestamp() WHERE consumed_at IS NULL AND revoked_at IS NULL AND expires_at > transaction_timestamp() AND failed_attempts < max_attempts AND (locked_until IS NULL OR locked_until <= transaction_timestamp()) RETURNING ...`. Exactly one returned row is required. Using the re-derived source Person, it creates the merge plan in the same transaction; zero rows means generic invalid and no plan.

Rate-limit counters outside the row use the same transaction-safe service boundary. Concurrent consumes therefore cannot both pass; terminal rows remain immutable apart from separately audited support revocation policy.

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
   - giữ reachability theo exact `channel_identity_id`; chỉ dedupe khi cùng provider endpoint + user identity, không copy/OR window-token xuyên Page/bot/OA;
   - re-parent Messenger reachability only for the same Page endpoint; keep windows/tokens separate across Pages and fail closed on conflicting endpoint rows.
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
- Endpoint relation matrix: Messenger requires only a valid Page FK, Zalo requires only a valid bot/OA FK; platform/FK mismatch, both FKs, neither FK and caller-supplied scope-hash mismatch are rejected.
- Upgrade fixture with an existing Telegram identity keeps both endpoint FKs NULL and migrates successfully; protected runtime writer still rejects every new/updated Telegram row.
- Merge planner for no conflict, membership conflict and dormant-phone collision.
- Link-code issuer XOR, issuer/person mismatch, changed/merged issuer binding, revoked/locked/consumed/expired/max-attempt terminal states; terminal rejection does not increment attempts or create a plan.
- Survivor/reachability deterministic rules, including no cross-Page window/token collapse.
- Claim strong-key matrix.

### Integration

- Concurrent first contact creates one identity.
- Concurrent/opposite merges do not deadlock or duplicate.
- Link code race consumes once.
- Wrong verifier increments exactly once under concurrency; the attempt reaching `max_attempts` locks/fails closed, while every later terminal/locked request leaves the counter unchanged.
- Membership conflict preserves players/charges and ledger totals.
- Bank transactions/allocations remain byte-for-byte unchanged after merge.
- Zalo and Messenger reachability remain exact channel-endpoint scoped; target-tenant permission is checked separately.
- Protected identity writer derives scope hash from the bound Page/bot/OA registry row; a hash for endpoint A cannot be stored or resolved with endpoint-B FK.
- Same provider user id on two Pages/bots/OAs produces two valid identity bindings; merge links their Person without collapsing endpoint state.
- Both tenant and central Page reachable selects one route only; identity merge does not create duplicate sends.
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

1. Add protected DD-65 Page/Zalo endpoint registry and nullable endpoint-binding/scope columns in a new expand migration; migrate without editing applied migrations.
2. Backfill every current Messenger/Zalo identity to one provable Page/bot/OA registry row and derive its scope hash. Ambiguous/unmapped rows halt for manual mapping. Existing Telegram tenant-1 rows get the deterministic legacy scope hash and both endpoint FKs NULL. Only after validation set scope hash NOT NULL + platform/FK CHECK/unique indexes; runtime writer still forbids Telegram.
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
| 2026-07-17 | v1.7 | **Zalo trust-boundary correction:** keep `zalo_bots` tenant-private under ENABLE + FORCE RLS and exact tenant context; reserve global-protected/no-blanket-grant semantics for hybrid Messenger registry plus identity/reachability/link-code tables; require narrow endpoint resolver to validate Zalo row, tenant and secret access without reclassification. Runtime migration pending. |
| 2026-07-17 | v1.6 | **Enforceability closure:** add mutually-exclusive Messenger Page/Zalo bot-OA registry FKs plus relation-based unique indexes and protected hash derivation; pin `link_code` consume ordering, current issuer→Person revalidation and conditional atomic attempt/consume semantics. Runtime migration pending. |
| 2026-07-17 | v1.5 | **DD-15/DD-50/DD-67 v1.45:** 3-part endpoint-scoped identity key, unified protected reachability by `channel_identity_id`, target-tenant eligibility separated, and XOR channel/account link-code issuer with lock/revoke lifecycle. Runtime migration pending. |
| 2026-07-17 | v1.4 | **DD-65..68/DD-67 full propagation:** Page-bound Messenger identity, canonical HMAC `page_id+PSID`, endpoint-scoped reachability/window, merge-safe no-cross-Page token behavior and one-route integration tests. Live schema/runtime remain migration-pending. |
| 2026-07-16 | v1.3 | **DD-50 full propagation:** transactional one-time `link_code`, server-only verified-email evidence matrix, phone dormant, no CK/name/owner bypass, and new security/concurrency tests. |
| 2026-07-10 | v1.2 | **DD-37 ✅:** phase-1 channels = Zalo + Messenger; `channel_identities.platform` phase-1 ∈ {`zalo`,`messenger`}, `telegram` legacy tenant-1 only. Person links Google+Facebook+Zalo (web-auth DD-13/33/14). Merge signals: verified SĐT (DD-01) + verified email (DD-13). |
| 2026-06-18 | v1.1 | Protected identity, tenant reachability, secure OTP, ledger-safe merge and recovery contract |
| 2026-06-18 | v1.0 | Initial legacy backend spec |
