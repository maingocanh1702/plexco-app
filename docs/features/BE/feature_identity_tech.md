# Feature: Identity Directory & Merge — Backend Tech Spec

> **Canonical phase:** P3.5
> **Version:** 1.16 · 2026-10-14
> **Status:** Identity implementation contract; DD-32 Account-backed channel link predicate added. Endpoint-scoped schema/code pending identity/channel build slices
> **Implementation:** In progress (code dark) — bảng `link_codes`/`merge_*` có sẵn; **`0034`** person-account resolver (SECURITY DEFINER, REVOKE khỏi app/app_worker/readonly) và **`0043`** `link_code_issue`/`link_code_salt`/`link_code_consume` + `_link_code_retention` 30 ngày **đã merge**, kèm wrapper `packages/db/src/identity.ts` (mã 18 ký tự Crockford **tách đôi**: 8 ký tự lookup HMAC, verifier scrypt **async** phủ toàn bộ ⇒ attempt cap mới có hiệu lực thật). **0 caller production**, env `LINK_CODE_LOOKUP_HMAC_KEY` chưa đặt vì 0 reader; merge service/route `/link` chưa build (đo 2026-09-15 tại `e235ea4`) · authority: `../../standards/BUILD-STATUS.md` (Doc status ≠ Implementation status)  
> **Product spec:** `../FE/feature_identity.md`
> **References:** `../../product/TDD.md` §3.2–3.4/§4 · `../../research/player-side-saas-AUDIT.md` · `../../standards/decisions.md` DD-13/DD-37/DD-50/DD-53/**DD-65..68** · `feature_player_messenger_tech.md`

> **Cập nhật v1.3 (DD-50/v1.37):** phase-1 không thu SĐT; phone columns remain dormant. Debt-bearing claim proof = server-verified account email or transactional one-time `link_code`; schema presence alone is not runtime implementation.
>
> **Cập nhật v1.5 (DD-15/DD-50/DD-67/v1.45):** mọi channel identity/reachability là provider-endpoint scoped. Messenger scope Page; Zalo scope bot/OA cho tới khi DD-15 chứng minh rộng hơn. `link_code` hỗ trợ issuer XOR channel/account. Live schema chưa có contract này; migration mới phải land trước runtime. Không sửa migration lịch sử.
>
> **Cập nhật v1.6:** endpoint binding không được dựa vào hash đơn độc: mỗi identity phải có đúng một FK tới Messenger Page hoặc Zalo bot/OA phù hợp với `platform`, và protected writer tự derive/re-check scope hash từ row registry đó. Consume `link_code` pin thứ tự terminal checks, XOR issuer revalidation và atomic attempt/consume.
>
> **Cập nhật v1.7:** sửa trust-boundary drift: `zalo_bots` vẫn là bảng tenant-private có ENABLE + FORCE RLS theo TDD/live migration; chỉ Messenger hybrid registry cùng global identity/reachability/link-code tables là global-protected. Narrow resolver phải validate Zalo endpoint dưới exact tenant context, không reclassify `zalo_bots` thành global/no-grant.
>
> **Cập nhật DD-32/v1.13:** booking `pay later` không dùng một client boolean hay “linked-lite”. Identity service phải derive exact ChannelIdentity→current Person←verified Account predicate và phát một opaque server result cho funnel finalizer.

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

### Entry points

| Entry | Caller | Mô tả |
|-------|--------|-------|
| Channel adapter `resolveIdentity()` | Messenger/Zalo webhook | Resolve stable platform identity → Person |
| `POST /api/link/:code` | Player (web) | Consume one-time link code → merge planner |
| `isAccountLinked()` predicate | Channel booking funnel | ChannelIdentity→Person←Account verification |
| Merge planner + transaction | Identity service (internal) | Evaluate → plan → atomic merge |
| `POST /api/me/identities/claim` | Player (web) | Claim proof (email/link_code) for debt-bearing identity |
| Recovery runbook | PlatformAdmin | Owner account recovery (DD-53, strong proof) |
| Endpoint reachability writer | System | Update DM availability per bot/OA/Page endpoint |

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

### Migration & Rollback

**Live-schema truth (main; số migration verify live tại `packages/db/migrations/` — đừng hard-pin range):** mọi bảng trong DDL trên **đã tồn tại** — `persons`/`channel_identities`/`link_codes`/`merge_audit`/`merge_tombstones` trong `0001_global_directory.sql`; `memberships`/`channel_reachability` trong `0002_tenants_core.sql`; registry `messenger_pages`/`zalo_bots` trong `0004_channels_connectors.sql`. **Reuse baseline, không recreate; `DROP` bảng baseline = ❌ NEVER** (có thể chứa identity/tenant data thật và ledger đang trỏ vào).

**Delta còn thiếu so với live schema** (đúng như header v1.5–v1.7 ghi "runtime migration pending"):

- `channel_identities` (live `0001`): chưa có endpoint FKs `messenger_page_id`/`zalo_bot_id`, `provider_scope_lookup_hash`, platform/FK CHECK và 2 partial unique indexes theo endpoint.
- `link_codes` (live `0001`): `source_channel_identity_id` đang `NOT NULL`; chưa có `source_account_id`, `max_attempts`, `locked_until`, `revoked_at` và XOR CHECK.
- `channel_reachability` (live `0002`): đang tenant-scoped `PRIMARY KEY (person_id, tenant_id, platform)`; shape global-protected key theo `channel_identity_id` ở DDL trên là migration-pending.

**Migration mới:** một expand migration **monotonic theo next available number sau tail hiện tại của main** (verify tail hiện hành tại `packages/db/migrations/` tại thời điểm author, KHÔNG hard-pin số), theo đúng trình tự §10 bước 1–2 (add nullable columns/registry → backfill có kiểm chứng → mới siết NOT NULL/CHECK/unique). Không sửa migration lịch sử. Lưu ý: bản nháp `0014_identity_channel_security.sql` chỉ tồn tại trong worktree chưa merge và **đụng số** với `0014_players_waitlist.sql` trên main — khi land phải đánh số lại theo tail của main.

**Rollback:**

| Bước | Hành động | An toàn? |
|------|-----------|----------|
| 1 | Disable protected identity write paths (`/link` issue/consume, merge commit, claim) | ✅ |
| 2 | Migration revert mới: DROP các column/CHECK/index **additive** vừa thêm (endpoint FKs, scope hash, link-code lifecycle fields) | ✅ Constraint/column-only; data backfill giữ nguyên semantics cũ |
| 3 | DROP bảng baseline `0001`/`0002`/`0004` (`persons`…`zalo_bots`) | ❌ NEVER |

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

1. Resolves the opaque lookup component **read-only** to a candidate `{code_id, issuer kind/id, source_person_id}`. A missing/corrupt candidate returns the same generic error; discovery confers no authority and holds no blocking row.
2. Locks the candidate's canonical owner parents in the shared auth/identity order before the code row. Account-issued: lock canonical account/email parent then current Person; channel-issued: lock current Person then exact active `channel_identities` row. IDs within a tier are UUID-sorted. Re-read issuer binding and derive current Person server-side; missing/inactive issuer, owner drift, stale/merged Person or XOR violation rolls back/retries or returns generic invalid without touching the code.
3. Locks the exact `link_codes` row `FOR UPDATE`, re-checks lookup hash, issuer refs, `source_person_id`, `num_nonnulls(source_channel_identity_id, source_account_id)=1`, and the parent-derived current Person. Then, **before verifier accounting or merge-plan creation**, rejects `consumed/revoked/expired/locked/max-attempt`; these paths do not increment, unlock, consume or create a plan. This parent-first sequence supersedes code-row-first wording and matches password-reset revoke/cancel.
4. Re-checks `action = 'merge_identity'` and verifies the salted slow hash in constant time. A wrong verifier performs one conditional atomic update `failed_attempts = failed_attempts + 1` only while every step-3 predicate and issuer binding still holds; reaching the cap applies cooldown/lock policy. The service returns a result rather than throwing before that update commits.
5. For a valid verifier, atomically claims the already-locked code with a conditional `UPDATE ... SET consumed_at = transaction_timestamp() WHERE consumed_at IS NULL AND revoked_at IS NULL AND expires_at > transaction_timestamp() AND failed_attempts < max_attempts AND (locked_until IS NULL OR locked_until <= transaction_timestamp()) RETURNING ...`. Exactly one returned row is required. Using the re-derived source Person, it creates the merge plan in the same transaction; zero rows means generic invalid and no plan. Barrier tests cover account reset/revoke versus consume and merge commit versus consume; one side wins without deadlock, the loser revalidates fail-closed.

Rate-limit counters outside the row use the same transaction-safe service boundary. Concurrent consumes therefore cannot both pass; terminal rows remain immutable apart from separately audited support revocation policy.

### Account-backed link resolver for channel booking

`resolveDeferredPaymentAccount(channelIdentityId, endpointContext)` is a narrow protected read:

1. validates the exact Page/bot-OA relation and authenticated channel actor;
2. locks/re-resolves current ChannelIdentity→Person when called from a finalizer;
3. resolves an active Account on that Person that is **verified per DD-50** — phase-1 predicate (DD-50 amendment, owner 2026-08-25): **≥1 `account_emails` row with `verified_at IS NOT NULL`** (verified account email; covers Google OIDC `email_verified === true` and email/password post-verify-token). Legacy `account_identities` rows do **NOT** qualify — that table is only written by the Telegram-era flow, removed from scope by DD-37. *(The former literal "at least one verified account identity" was pre-DD-37 wording drift, ruled superseded by the amendment.)*;
4. rejects frozen, merge-pending, stale or ambiguous bindings;
5. returns only `{qualified, account_ref, person_ref, binding_version}` to the booking core.

No adapter receives Account/Person UUIDs. The booking core rechecks the returned binding version under its final lock order. Facebook Login subject↔PSID and Zalo Login subject↔`from.id` require explicit verified link; provider equality is not a join key. A booking resume token is actor+endpoint+session+action-bound and can request this resolver only after the web-auth/merge flow has consumed its own single-use proof.

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

0. If DD-70(a) is enabled, validate capability and inventory all affected Person IDs read-only; call owner-only ordered inbox-fence helper before any merge-plan/Person/source/child lock, then re-inventory after locks. Drift or a newly discovered Person rolls back/retries.
1. Validate idempotency key, actor authorization and verified method.
2. Sort source/target person IDs; lock in stable order after inbox fences.
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

`link_code` consume only verifies/consumes and creates the merge plan; it emits no global notification. The merge commit inventories the bounded source/survivor Person set read-only, acquires ordered inbox fences before blocking merge rows, revalidates, and appends `identity_merged` from the exact locked `merge_audit` in the same transaction. An implementation that cannot obey this order is a build halt; tenant outbox is not a global-notification fallback.
8. Invalidate outstanding link codes and sensitive sessions.
9. Write encrypted before/after `merge_audit`; when DD-70(a) is active, append the source-derived `identity_merged` item atomically. Any domain outbox is separate and cannot project this global item.

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

> **Quy tắc MVP — link web ⇄ Zalo khi Person rỗng (DD-127 / DD-131 OD-3 — `decisions.md`, đang chờ merge ở PR #51; chọn (a), ký 2026-10-14):** `POST /api/me/link` (account đã đăng nhập nhập mã do bot Zalo cấp) chỉ re-parent channel identity Zalo sang Person của account khi Person phía Zalo **rỗng**: đúng 1 channel identity đó, không dòng nào khác tham chiếu `persons` (quét động từ `pg_constraint`). Mọi trường hợp còn lại — kể cả FK composite, hay cột FK mà owner hàm không có quyền `SELECT` (bảng do migration sau thêm, tới khi migration đó `GRANT SELECT (<cột>) ON <bảng> TO identity_definer`) — trả `MERGE_REQUIRES_REVIEW` (409), ghi 1 dòng `routing_audit` cho support và không move gì; lỗi đọc mà dự đoán không bắt được (vd. bảng ở schema owner không có `USAGE`) làm cả lời gọi RAISE, không ghi gì (fail closed); merge thật (planner/commit §5) vẫn P0. Cửa sổ replay 10 phút sau consume.
>
> **Owner definer + bracket BYPASSRLS:** owner của `link_code_reparent_empty_person` (migration `0054`) là role riêng **`identity_definer`** (NOLOGIN NOSUPERUSER **BYPASSRLS** NOINHERIT, không là member của role nào). `0054` chỉ **assert** role này (tồn tại, đúng thuộc tính, migration role là member, `app`/`app_worker`/`readonly` không là member), rồi tạo hàm trong bracket `SET ROLE identity_definer … RESET ROLE` — cùng pattern `job_definer` (`0022`) / `chat_definer` (`0032`) — nên BYPASSRLS thuộc owner hàm, không phụ thuộc migration role. Hệ quả: bảng tenant FORCE RLS được **đếm thật** (không còn "unprovable"), nên dưới migration owner NOBYPASSRLS link hợp lệ không còn rơi về `requires_review`; nhánh "owner không đọc xuyên RLS được ⇒ blocking" chỉ còn là phòng thủ nếu role mất BYPASSRLS. `identity_definer` chỉ có quyền thân hàm cần (SELECT/UPDATE 4 bảng khoá, INSERT 3 bảng audit, SELECT cột FK của mọi FK một cột trỏ `persons`), chỉ sở hữu đúng hàm này; `app` chỉ có `EXECUTE`, không là member, không `SET ROLE identity_definer` được. R1 (DO Managed PG từ chối role BYPASSRLS) ngoài scope theo chính OD-3.
>
> **Bước bootstrap:** role là cluster-global, tạo **ngoài** migration runner bởi `infra/postgres-init/03-identity-definer.sql` (mirror từng câu của `02-chat-definer.sql`), chạy qua `pnpm db:bootstrap` (01 → 02 → 03, idempotent; CI chạy ở bước "Bootstrap definer roles" trước `pnpm -w test`; volume Docker mới tinh thì init mount tự chạy). Thiếu role ⇒ `0054` dừng ngay ở bước assert (`undefined_object`, thông báo nhắc chạy `pnpm db:bootstrap`), không ghi gì. **DB local đã apply bản `0054` cũ** (trước 2026-10-14) sẽ bị guard sha256 (P17) của `migrate.ts` từ chối: reset bằng `pnpm db:reset:test`, không sửa `schema_migrations`. `0054` được sửa tại chỗ (không thêm migration mới) vì bản cũ chưa từng apply ngoài local/CI (không có trên `main`, không có đường deploy chạy migration).
>
> Rate limit `me-link` 5/10 phút per account + `me-link-ip` 20/10 phút; copy UI ghi đúng **10 phút**. Cài đặt: `0054` + `infra/postgres-init/03-identity-definer.sql` + `packages/db/src/identity-link-web.ts` + `apps/web/app/api/me/link/route.ts`.

P4.6 `/myclubs` consumes `resolvePersonSelf`; it is not part of P3.5 rollout.

### Request/Response Examples

> Surface chat (`/link`) trả lời dạng text trong kênh; mọi HTTP surface của protected interface dùng envelope DD-60 (`../../standards/api-reference-convention.md`). DTO minh hoạ theo contract đã pin; field name chốt ở build slice; HTTP status mapping minh hoạ. Error luôn generic theo §4 — không tiết lộ person/email tồn tại hay không.

**Consume `/link <code>`** (transactional consume §4):

- Thành công — code hợp lệ, tạo merge plan (chưa commit; cần explicit confirmation riêng trước merge):

```json
{ "data": { "mergePlanId": "…", "requiresConfirmation": true }, "error": null, "meta": { "requestId": "req_…" } }
```

- Mọi nhánh fail (sai code / hết hạn / consumed / revoked / locked / issuer drift) — một error generic duy nhất:

```json
{ "data": null, "error": { "code": "LINK_CODE_INVALID", "message": "…", "statusCode": 400 }, "meta": { "requestId": "req_…" } }
```

- Vượt rate limit issue/verify (§4):

```json
{ "data": null, "error": { "code": "LINK_CODE_RATE_LIMITED", "message": "…", "statusCode": 429 }, "meta": { "requestId": "req_…" } }
```

### Idempotency

> Tổng hợp từ cơ chế đã pin ở §4/§5/§6/§8 (canonical — bảng này chỉ tham chiếu); hàng chưa pin ghi rõ.

| Interface | Idempotent? | Key |
|-----------|-------------|-----|
| `/link` (issue) | ⬜ chưa pin — chốt ở build slice (mỗi lần issue một code mới là hợp lệ; rate-limit theo §4) | — |
| `/link <code>` (consume) | ✅ single-use fail-closed | `code_lookup_hash` UNIQUE + conditional `consumed_at` UPDATE (§4 bước 5); consume thứ hai → generic invalid, không tạo plan thứ hai |
| Merge commit | ✅ | Idempotency key validate (§5 bước 1) + stale-plan reject (§5 bước 3) |
| `claimMembership` | ✅ chống double-claim | Membership/person locks + active uniqueness constraint (§6) |
| `supportRecoverMerge` | ✅ | Restricted support command với idempotency + audit (§8 bước 4) |

### Caching Strategy

| Data | Cache? | Lý do |
|------|--------|-------|
| Person/channel identity, membership resolve | ❌ | Fail-closed — resolve/claim luôn live qua protected function + RLS (§1–§3); cache có thể giữ binding stale sau merge |
| Link-code state | ❌ | Single-use + terminal states (§4); mọi check trong một transaction |
| Merge plan | ❌ | Plan reload + stale reject ngay trong commit (§5 bước 3) |
| Reachability window/token | ❌ | Endpoint-scoped, đọc live (§5); không copy/OR xuyên Page/bot/OA |
| Chưa liệt kê | ❌ fail-closed | Mặc định không cache trên surface identity |

### Security Checklist (template v2.33 — map về section đã pin)

| Mục | Trả lời trong spec |
|-----|---------------------|
| Authorization/ownership | §1–§2: global-protected, không blanket grant, chỉ narrow functions + purpose/audit; §7 bảng authorization per interface; §6 claim proof matrix (debt-bearing cần strong proof) |
| Injection/validation | §3: registry FK + server-derived scope hash, mismatch fail-closed; §4: không tin `source_person_id`/issuer từ request, server re-derive mọi binding |
| Secret & log redaction | §2: keyed hashes + `*_enc`, không store/log plaintext code/email/raw ID; §9 Security: logs/analytics không chứa raw platform ID/phone/email/code/display name |
| Webhook signature + replay | N/A trong doc này — identity nhận input từ trusted channel adapter (§3); webhook auth pin ở connector/channel specs + `feature_payment_reconcile_tech.md` §3 |
| Idempotency | §4 consume + §5 commit + bảng Idempotency ở trên |
| Data retention/xoá | §8: PII deletion = anonymization/crypto-shredding, tôn trọng financial/legal retention; audit IDs/tombstones giữ lại. Retention schedule per-table chưa pin — theo `feature_security_operations_tech.md` |


### Endpoints (HTTP)

| Method | Path | Auth | Mô tả |
|--------|------|------|-------|
| POST | `/api/identity/link` | Authenticated session | Issue link_code cho person hiện tại |
| POST | `/api/identity/link/consume` | Authenticated channel identity | Consume link_code, tạo merge plan |
| POST | `/api/identity/merge/confirm` | Authenticated session + merge_plan_id | Commit merge plan |
| POST | `/api/identity/claim` | TenantAdmin | Claim membership có tài chính (strong proof) |
| GET | `/api/identity/me` | Authenticated session | Resolve person-self (clubs, channels) |
| POST | `/api/identity/merge/recover` | Restricted support role | Recovery split command |

> Mọi response dùng envelope DD-60 (`{data, error, meta.requestId}`).

### Error Codes

| Code | Error Code | Message | Trigger |
|------|-----------|---------|---------|
| 400 | `LINK_CODE_INVALID` | Mã liên kết không hợp lệ | Sai code / hết hạn / đã sử dụng / bị khoá |
| 400 | `LINK_CODE_ISSUER_MISMATCH` | Không thể sử dụng mã này | Issuer person đã merge/thay đổi |
| 400 | `MERGE_PLAN_STALE` | Kế hoạch gộp đã thay đổi, vui lòng kiểm tra lại | Plan version stale |
| 400 | `MERGE_CONFLICT_REQUIRES_REVIEW` | Cần quản trị viên xem xét | Membership + financial conflict |
| 400 | `CLAIM_STRONG_PROOF_REQUIRED` | Cần xác minh danh tính bổ sung | Debt-bearing membership claim |
| 400 | `CLAIM_ALREADY_OWNED` | Thành viên này đã được liên kết | Duplicate claim |
| 400 | `IDENTITY_PLATFORM_MISMATCH` | Nền tảng không khớp | Channel platform ≠ endpoint FK |
| 400 | `IDENTITY_ENDPOINT_MISMATCH` | Thiết bị không khớp | Scope hash mismatch |
| 401 | `AUTH_REQUIRED` | Cần đăng nhập | No valid session |
| 403 | `PERSON_ACCESS_DENIED` | Không có quyền truy cập | Person-self mismatch |
| 403 | `CLAIM_TENANT_MISMATCH` | Không có quyền thao tác CLB này | Admin cross-tenant |
| 429 | `LINK_CODE_RATE_LIMITED` | Quá nhiều yêu cầu liên kết | Rate limit exceeded |
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

## 9. Testing Plan

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
- [ ] Deferred-payment resolver proves exact endpoint + current Person + verified Account; stale/merged/frozen/wrong-Page/OA and raw-ID attempts return generic false with zero mutation.
- [ ] Merge preserves membership/history/ledger invariants.
- [ ] Claim-with-financial-history gate passes attack tests.
- [ ] Audit/tombstones/recovery runbook verified.
- [ ] Product acceptance criteria in `../FE/feature_identity.md` pass.

---

## Changelog

| Date | Version | Change |
|---|---|---|
| 2026-10-14 | v1.16 | **DD-127 / DD-131 OD-3 (`decisions.md`, đang chờ merge ở PR #51), chọn (a):** §7 thêm quy tắc MVP link web ⇄ Zalo khi Person rỗng (bản đề xuất đã gỡ khỏi spec ở PR #49 round 1 vì chưa ký). Owner definer `0054` = role mới `identity_definer` (BYPASSRLS qua bracket `SET ROLE`, `infra/postgres-init/03-identity-definer.sql` qua `pnpm db:bootstrap`, cùng pattern `job_definer`/`chat_definer`); `0054` sửa tại chỗ, DB local đã apply bản cũ phải `pnpm db:reset:test`; R1 trên DO ngoài scope; copy UI rate-limit ghi 10 phút. Không thêm bảng/cột. |
| 2026-08-25 | v1.15 | **Vá wording theo DD-50 amendment (owner 2026-08-25; bản vá được amendment xếp hàng cho phiên docs — lane `identity-account-link-core` cố ý không tự sửa spec Reviewed):** §Account-backed link resolver bước 3 — predicate "verified Account" phase-1 = **≥1 `account_emails.verified_at IS NOT NULL`** (verified email theo DD-50), **KHÔNG** phải literal cũ "≥1 verified account identity" (wording drift từ trước DD-37/trước khi `account_emails` migration `0016` tồn tại; legacy `account_identities` chỉ do luồng Telegram cũ ghi, không tính). Correction của quyết định đã chốt, không phải quyết định mới — theo tiền lệ `docs-billing-authz-signature-reconcile`. Shape truy cập giữ nguyên §2/§4 (SECURITY DEFINER function-only). |
| 2026-08-10 | v1.14 | **A-grade upgrade:** thêm Entry points table (7 entries); bump version. Không đổi contract/identity model. |
| 2026-07-28 | v1.13 | Mirror DD-32 Option D: add narrow Account-backed channel-link resolver, binding-version recheck and explicit provider-subject separation for pay-later qualification. No runtime/migration. |
| 2026-07-24 | v1.12a | **De-pin migration-tail** (docs-migration-tail-0018-to-0020-sweep): Live-schema truth header + Migration mới numbering guidance hard-pinned `migrations 0000–0018` → non-pinned "verify tail hiện hành tại `packages/db/migrations/`, không hard-pin số" (live tail nay `0020`; `0019`/`0020` tenant-integrity FKs DD-68). Draft `0014_identity_channel_security.sql` numbering note giữ nguyên. Pre-existing dated changelog giữ verbatim. Không đổi contract. |
| 2026-07-23 | v1.12 | **Reconcile migration-tail 0018:** current-state §2 migration facts sửa: (a) `tail = 0014_players_waitlist` → **tail = 0018** (`0018_oauth_completion_handoff.sql`; migrations 0000–0018 đã merge trên `main` — 0014 waitlist schema-only, lane auth DD-80 0015–0018 ⛔ chưa enable); (b) "Live-schema truth (main, migrations `0000`–`0014`)" range → `0000`–`0018` (nhất quán, tránh mâu thuẫn với tail). Numbering guidance giữ nguyên (expand migration monotonic next-available sau synced tail, verify live `packages/db/migrations/` trước khi tạo, không hardcode/sửa lịch sử; draft `0014_identity_channel_security.sql` đụng số → renumber theo tail thực tế). Pre-existing dated changelog giữ verbatim. Không đổi contract. |
| 2026-07-19 | v1.11 | **Template v2.30/v2.33 uplift:** thêm §2 Migration & Rollback (live `0001`/`0002`/`0004` = reuse baseline, DROP ❌ NEVER; delta endpoint-binding/link-code lifecycle/reachability re-key → migration mới monotonic, cảnh báo đụng số worktree `0014`), §7 Request/Response Examples (DD-60) + Idempotency + Caching Strategy + Security Checklist. Derivative/editorial — không đổi contract. |
| 2026-07-19 | v1.10a | Metadata sweep (index v2.35): thêm trường **Implementation** đồng bộ BUILD-STATUS (Not started). Không đổi contract. |
| 2026-07-19 | v1.10 | **DD-50 v1.73 lock-order closure:** read-only link-code candidate resolve → issuer/account+Person parent locks → code-row lock/revalidation → conditional accounting/consume. Removes reset/revoke-vs-consume inversion; no runtime/migration. |
| 2026-07-19 | v1.9 | **DD-70(a) v1.70 propagation:** link-code consume emits nothing; merge commit inventories/fences/revalidates and appends `identity_merged` from locked audit in one transaction. Tenant outbox fallback is forbidden; unfit implementation halts. No runtime/migration. |
| 2026-07-19 | v1.8 | **Superseded by v1.9:** initial DD-70 lock-order propagation; no runtime/migration. |
| 2026-07-17 | v1.7 | **Zalo trust-boundary correction:** keep `zalo_bots` tenant-private under ENABLE + FORCE RLS and exact tenant context; reserve global-protected/no-blanket-grant semantics for hybrid Messenger registry plus identity/reachability/link-code tables; require narrow endpoint resolver to validate Zalo row, tenant and secret access without reclassification. Runtime migration pending. |
| 2026-07-17 | v1.6 | **Enforceability closure:** add mutually-exclusive Messenger Page/Zalo bot-OA registry FKs plus relation-based unique indexes and protected hash derivation; pin `link_code` consume ordering, current issuer→Person revalidation and conditional atomic attempt/consume semantics. Runtime migration pending. |
| 2026-07-17 | v1.5 | **DD-15/DD-50/DD-67 v1.45:** 3-part endpoint-scoped identity key, unified protected reachability by `channel_identity_id`, target-tenant eligibility separated, and XOR channel/account link-code issuer with lock/revoke lifecycle. Runtime migration pending. |
| 2026-07-17 | v1.4 | **DD-65..68/DD-67 full propagation:** Page-bound Messenger identity, canonical HMAC `page_id+PSID`, endpoint-scoped reachability/window, merge-safe no-cross-Page token behavior and one-route integration tests. Live schema/runtime remain migration-pending. |
| 2026-07-16 | v1.3 | **DD-50 full propagation:** transactional one-time `link_code`, server-only verified-email evidence matrix, phone dormant, no CK/name/owner bypass, and new security/concurrency tests. |
| 2026-07-10 | v1.2 | **DD-37 ✅:** phase-1 channels = Zalo + Messenger; `channel_identities.platform` phase-1 ∈ {`zalo`,`messenger`}, `telegram` legacy tenant-1 only. Person links Google+Facebook+Zalo (web-auth DD-13/33/14). Merge signals: verified SĐT (DD-01) + verified email (DD-13). |
| 2026-06-18 | v1.1 | Protected identity, tenant reachability, secure OTP, ledger-safe merge and recovery contract |
| 2026-06-18 | v1.0 | Initial legacy backend spec |
