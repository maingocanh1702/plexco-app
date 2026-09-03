# Plexco — Setup dev · staging · production

> **Version:** v2.1 · 2026-07-16
> **Authority:** DD-04 = DigitalOcean co-location: App Platform + Managed PostgreSQL HA in Singapore,
> connected through the `sgp1` VPC. The accepted record is
> [`../decisions/analysis/dd-04-hosting-final-decision.md`](../decisions/analysis/dd-04-hosting-final-decision.md).
> **Current repository state:** the local Docker Compose definition exists and validates; Docker-daemon
> availability remains machine state and **must be checked before each run**. The daemon was started for the
> 2026-07-16 closure and the canonical PostgreSQL/RLS/auth suite passed; the test container was then stopped.
> The production DigitalOcean App Spec and deployment workflows are still an infra-slice deliverable.
> `infra/fly.toml` is a bounded fallback artifact, not the production runbook.

Plexco is a money-safe, multi-tenant system. Environment separation, DB-role separation, immutable promotion,
and restore/failover drills are release gates rather than optional hardening.

---

## 0. Target environment model

```text
local development
  docker compose + local PostgreSQL
            │
            │ build one immutable OCI image (release tag + verified digest)
            ▼
ephemeral staging on DigitalOcean
  production-shaped App Platform components + separate Managed PostgreSQL
  sgp App Platform ── private route ── sgp1 VPC
            │
            │ promote the exact tested image; do not rebuild
            ▼
production on DigitalOcean
  2 web + 2 discovery + 1 worker + Managed PostgreSQL primary/standby
```

| Environment | Purpose | Lifetime | Database | Public hostname |
|---|---|---|---|---|
| **local** | Fast development and focused tests | Persistent on developer machine | Local Docker PostgreSQL; disposable data | `localhost` / tunnel only when a webhook needs it |
| **integration smoke** | Optional shared callback target while a channel integration is active | Minimal and explicitly owned | Separate non-production DB; never production data | Stable non-production domain if required |
| **staging** | UAT, DAST, load/soak, failover, PITR and provider-exit rehearsal | Ephemeral 48–96h with TTL | Separate production-shaped DO Managed PG | Staging-only domain/callbacks |
| **production** | Live users and real money data | Persistent | DO Managed PG primary + standby, HA/PITR | Production domain |

Staging must exercise the same process groups, VPC path, DB roles, migration job, and reconnect behavior as
production. “Production-shaped” does not mean always-on: IaC creates it for a release/drill and destroys it
automatically after the TTL.

---

## 1. Hard gates before provisioning

### 1.1 Fixed outbound-IP gate — DD-04 §7.1

DigitalOcean App Platform cannot use VPC networking and dedicated public egress IPs at the same time. The
table below records the current attributable evidence state of this gate, one row per production dependency
and its exact Plexco outbound call surface. Evidence rule (DD-04 §7.1): official documentation silence is not
`NO`; a row that rests only on inference stays `UNRESOLVED` until an attributable provider support or
contractual response supplied by the owner closes it.

| Dependency — Plexco outbound call surface | Fixed source IP | Primary source | Checked | Why the source supports the conclusion |
|---|---|---|---|---|
| **SePay** — backend calls to `https://my.sepay.vn/api/v1` (OAuth2 or API token; transaction read, webhook and bank-account management) | **UNRESOLVED** | SePay Developer Docs: [Tạo API Token](https://developer.sepay.vn/vi/sepay-api/v2/tao-api-token) · [OAuth 2.0 tổng quan](https://developer.sepay.vn/vi/sepay-oauth2/tong-quan) · [Địa chỉ IP](https://developer.sepay.vn/vi/dia-chi-ip) | 2026-07-18 | Official docs specify token/OAuth2 issuance with no source-IP registration step, and the docs' only IP-allowlist page covers the reverse direction (merchants allowlist SePay's webhook egress IPs). No page affirmatively states the outbound-caller source-IP policy, so documentation silence cannot close this row as `NO`. Closes with an attributable SePay support/contract answer on source-IP policy for `my.sepay.vn` API callers. |
| **ApiPay** — primary: DD-30 enterprise auto-provisioning contract (per-host provisioning; contractual surface, not publicly documented) · fallback: BYO-key calls to `https://app.apipay.vn` (`/v2/client/banks`, `/v1/client/webhooks`) | **UNRESOLVED** | ApiPay Docs: [Authentication](https://docs.apipay.vn/vi/api/authentication) — the site is client-rendered, so the full published docs corpus was retrieved and searched | 2026-07-18 | Published docs fully specify BYO auth (`Authorization: Bearer base64(accessKey:secretKey)`) and contain no IP-allowlist or caller-IP-restriction concept (the only IP mentions are custom-domain DNS A records), but they are silent on caller source-IP policy — and the DD-30 primary enterprise provisioning surface is contractual, so public docs cannot answer it at all. Closes with the ApiPay enterprise onboarding/contract answer covering both surfaces. |
| **Zalo Bot** — backend calls to `https://bot-api.zaloplatforms.com/bot<token>/<method>` (`sendMessage`, `setWebhook`, …) with the per-tenant bot token | **UNRESOLVED** | Zalo Bot Docs: [Xác thực](https://bot.zapps.me/docs/authorize/) · [Sử dụng API](https://bot.zapps.me/docs/call-api/) · [Bảng mã lỗi](https://bot.zapps.me/docs/error-code/) | 2026-07-18 | The published calling contract is HTTPS plus the bot token as the sole credential (Telegram-style token-in-URL), with no IP-declaration step and no origin/IP error class — but no page affirmatively states the caller source-IP policy, so documentation silence cannot close this row as `NO`. Closes with an attributable Zalo Bot support answer on source-IP policy for `bot-api.zaloplatforms.com` callers. |
| **Meta Messenger** — backend `POST https://graph.facebook.com/v<ver>/<page_id>/messages` with `page_access_token` | **NO** | Meta: [Securing Graph API Requests](https://developers.facebook.com/docs/graph-api/securing-requests) | 2026-07-18 | Meta affirmatively documents server-IP allowlisting as an opt-in app security control the developer may enable, alongside the optional `appsecret_proof` / "Require App Secret" hardening. By default Graph API calls are token-authenticated from any IP, so no fixed egress IP is required. |

**Gate status: `HALT-EVIDENCE_INCOMPLETE`** — SePay, ApiPay and Zalo Bot are `UNRESOLVED` (2026-07-18). No
overall result is recorded and the closure marker is intentionally absent: their official documentation never
affirmatively addresses outbound caller source-IP policy, and inference from omitted registration steps does
not meet this gate's evidence bar. The owner must obtain an attributable support or contractual response from
each of the three providers (for ApiPay: the DD-30 enterprise onboarding contract explicitly, not only the
BYO API) before this gate can close.

- All four rows attributable and **NO** → record `Overall result: DO_VPC_COMPATIBLE` plus the closure marker.
  That permits the App Platform + VPC green path to proceed to later **manual design review only**; it does
  not by itself authorize the infra slice or any provisioning.
- All four rows attributable and one or more **YES** → record `Overall result: FIXED_EGRESS_REQUIRED`. That
  blocks the DO App Platform + VPC green path and requires a separate fallback design: the bounded Fly+DO
  fallback or a DO Droplet/DOKS substrate with private DB access and controlled egress.
- Any row still missing, ambiguous, stale, or only inferred → gate status stays `HALT-EVIDENCE_INCOMPLETE`;
  no overall result or closure marker may be recorded, even if another row is already an attributable `YES`.
- Until the gate closes, do not create the App Spec and do not disable the private DB path silently.

### 1.2 Repository preconditions

Before the infra slice runs:

```bash
test -f infra/Dockerfile
test -f infra/entrypoint.sh
test -f .github/workflows/ci.yml
test -f infra/app.prod.yaml       # created and reviewed by the infra slice
test -f infra/app.staging.yaml    # created and reviewed by the infra slice
```

If either App Spec is absent, this runbook is a deployment contract only: **do not improvise a console-only
production setup**. IaC must remain the reproducible source.

---

## 2. DigitalOcean resource layout

Use one DO team/account with separate staging and production resources, tags, secrets, domains, and budgets.
Co-location is a failure-domain trade: off-provider backup and restore rehearsal remain mandatory.

| Resource | Staging | Production |
|---|---|---|
| App Platform app | `plexco-staging` | `plexco-prod` |
| App region | `sgp` | `sgp` |
| VPC | dedicated staging VPC in `sgp1` | dedicated production VPC in `sgp1` |
| PostgreSQL | temporary production-shaped cluster | 2 GiB primary + 2 GiB standby at Day 1 |
| DB trusted sources | staging app private identity + controlled admin/drill path only | production app private identity only; temporary admin path time-boxed and audited |
| Domains/callbacks | staging-only Google/Meta/Zalo/SePay configuration | production configuration |
| Budget alerts | TTL + staging ceiling | compute, DB, transfer, logs, backup, KMS |

Do not share a database, VPC, OAuth client, Messenger app/page token, Zalo bot token, webhook secret, KMS
ciphertext, or session secret across staging and production.

---

## 3. One image, three App Platform components

The App Specs deploy the same immutable image as three components. Use a unique release tag such as the git SHA,
resolve and record its registry digest, and prohibit mutable `latest` promotion.

| Component | Day-1 production shape | Command | DB identity | Scaling contract |
|---|---:|---|---|---|
| `web` | `2 × apps-s-1vcpu-1gb` | `infra/entrypoint.sh web` | `app` pooled URL + `app` direct listener URL | Request-based RPS/p95 autoscaling is eligible on shared CPU; CPU autoscaling requires dedicated CPU |
| `discovery` | `2 × apps-s-1vcpu-1gb` | `infra/entrypoint.sh discovery` | `readonly` pooled URL on the primary at Day 1 | Bounded pool + timeout + CDN + circuit breaker; read-only node only after telemetry trigger |
| `worker` | `1 × apps-s-1vcpu-1gb-fixed` | `infra/entrypoint.sh worker` | `app_worker` direct/session URL | One durable consumer at Day 1; add a second scalable worker only after idempotency and queue-lag gates pass |

App Platform high availability for the HTTP paths requires at least two containers, hence `web=2` and
`discovery=2`. The worker starts single by design; pg-boss durability is in PostgreSQL, not local disk.

### Required App Spec controls

- VPC attachment to the environment's `sgp1` VPC; no dedicated egress-IP block on the VPC path.
- Set `TRUSTED_INGRESS_PROVIDER=digitalocean` on every public HTTP component. Application rate limits trust
  only DigitalOcean's overwritten `do-connecting-ip`; they never fall back to `X-Forwarded-For` or a header
  owned by another provider. The bounded Fly fallback must instead set `fly`; `direct` is local-only.
- Health checks on `/healthz` for both HTTP services.
- Separate component-level environment variables and secrets.
- Explicit instance size/count; no console-only drift.
- Image release tag/digest recorded in deployment evidence.
- Deployment-failure and domain-failure alerts.
- TTL metadata and destruction job for staging.

---

## 4. Database roles and connection variables

Create four roles per database. The migration/owner credential is never injected into an App Platform runtime
component.

| Role | Runtime surface | Permissions | Connection mode |
|---|---|---|---|
| `migration` | CI deployment job only | DDL, migrations, grants, controlled queue provisioning | Direct; job-scoped secret |
| `app` | `web` | Tenant RLS, application functions; `NOSUPERUSER NOBYPASSRLS` | Transaction pool for requests; separate direct connection for `LISTEN` |
| `readonly` | `discovery` | `SELECT` only on `public_sessions` and approved public views; zero grant on canonical money/PII tables | Bounded transaction pool |
| `app_worker` | `worker` | Narrow worker functions, pg-boss/outbox/projector operations | Direct/session connection |

The application contract intentionally stays provider-neutral:

| Variable | Component value |
|---|---|
| `DATABASE_URL` | `web`: pooled `app` URL; `discovery`: pooled `readonly` URL. Same key, different component-scoped secret. |
| `DATABASE_URL_DIRECT` | `worker`: direct/session `app_worker` URL. |
| `DATABASE_URL_LISTEN` | `web`: direct/session `app` URL used only by the SSE listener. |
| `DATABASE_URL_MIGRATION` | Deployment job only; absent from `web`, `discovery`, and `worker`. |

There is **no mandatory `DATABASE_URL_REPLICA`**. If the trigger-based DO read-only node is purchased, replace
only the `discovery` component's `DATABASE_URL` with that node's pooled `readonly` endpoint. Business code and
the other components do not change. Authenticated post-write reads remain on the primary.

Require TLS CA and hostname verification even on the private path. Trusted sources and least-privilege roles
remain active; VPC routing is not a substitute for database authorization.

### 4.1 Local development and test databases

`DATABASE_URL_TEST` is the connection variable that is local/CI-only. It is never injected into an App Platform
component, which is why it is absent from the table above. It names a **throwaway superuser database on a
throwaway cluster** (`packages/db/src/test-harness.ts`), and both pinned values already end in `_test`:

| Source | Value |
|---|---|
| `.env.example` | `postgres://plexco:plexco_dev@localhost:5432/plexco_test` |
| `.github/workflows/ci.yml` | `postgres://plexco:plexco_test@localhost:5432/plexco_test` |

#### `pnpm db:reset:test` — the sanctioned cure for a blocked migration

`packages/db/src/migrate.ts` refuses to run when a migration file's sha256 no longer matches the row recorded in
`schema_migrations` (P17, forward-only). Its message offers two cures, and they are opposite:

| Situation | Cure |
|---|---|
| the migration has already **shipped** | add a NEW forward migration |
| still **unshipped**, being iterated on locally | "**reset the test database**" — `pnpm db:reset:test` |

The second is the one that actually costs time, and until this script existed it named a path the repository had
never built. Meanwhile the forbidden shortcut — `DELETE FROM schema_migrations WHERE name = ...` — was always one
line and always worked. **The rule was not widened; the sanctioned path was made cheap.**

The script fails closed:

- it **names the database it is about to destroy**, before destroying it;
- it **refuses any name not ending in `_test`** — so a `DATABASE_URL_TEST` pointing at the development database
  `plexco` is refused, not dropped;
- it refuses any name that is not a plain identifier, so nothing unexpected reaches SQL;
- it runs `psql` **inside the compose `postgres` container**, so no host `psql` is needed.

> ⚠️ **Do not run it while a test suite is running.** It uses `DROP DATABASE ... WITH (FORCE)`, and
> `setupRlsTestContext` opens `DATABASE_URL_TEST` as its admin connection for every suite — forcing the drop
> terminates that connection mid-run.

It deliberately does **not** touch the per-suite `plexco_*` databases. The harness drops and recreates those on
every run, so they cannot accumulate a stale `schema_migrations` row, and their names do not end in `_test`.

#### `pnpm db:bootstrap` requires `psql` — declare it, or route around it

`db:bootstrap` shells out to `psql` twice. **`psql` is a real development dependency that this repository does not
declare**, and it is absent on a machine that only has Docker. `infra/docker-compose.yml` records that this script
"is the path every environment (CI, existing local, production) actually depends on", so its behaviour is not
changed here. On a host without `psql`, use the container's own copy and feed each file over stdin.

**Both invocations are required.** `db:bootstrap` applies `01-job-definer.sql` *and* `02-chat-definer.sql`, each
preceded by the GUC that file reads. Running only the first leaves `chat_definer` absent, and
`02-chat-definer.sql` records why that breaks later: a migration transfers ownership with
`ALTER FUNCTION ... OWNER TO chat_definer`, "which mechanically requires the role to EXIST". The compose init
mount does not cover you either — on a pre-existing `pgdata` volume the init directory never re-runs, so a
mount-only bootstrap "silently no-ops on every developer's already-started stack".

`MIGRATION_ROLE` is interpolated into a privileged `SET`, so it carries the **same identifier guard the
canonical `db:bootstrap` applies** — letters, digits and underscore only. Without it a stray quote runs
arbitrary SQL as the local superuser. The whole recipe runs in a subshell so the guard can `exit` without
closing your terminal:

```bash
(
  set -e
  mr="${MIGRATION_ROLE:-}"
  case "$mr" in
    "") ;;
    *[!a-zA-Z0-9_]*)
      echo "MIGRATION_ROLE must be a plain identifier: letters, digits, underscore only" >&2
      exit 1
      ;;
  esac

  docker compose -f infra/docker-compose.yml exec -T postgres \
    psql -U plexco -d plexco -v ON_ERROR_STOP=1 \
    -c "SET job_definer_bootstrap.migration_role = '$mr'" \
    -f - < infra/postgres-init/01-job-definer.sql

  docker compose -f infra/docker-compose.yml exec -T postgres \
    psql -U plexco -d plexco -v ON_ERROR_STOP=1 \
    -c "SET chat_definer_bootstrap.migration_role = '$mr'" \
    -f - < infra/postgres-init/02-chat-definer.sql
)
```

Both files are idempotent, so re-running them on an already-bootstrapped cluster is safe.

---

## 5. Secrets and KMS

- Store runtime secrets as App Platform encrypted environment values, scoped to the component that consumes
  each value. Never commit literal secrets or place them in an App Spec.
- Keep `DATABASE_URL_MIGRATION` in the protected CI environment/job only.
- Continue the accepted application encryption contract: AWS KMS envelope encryption for staging/production,
  local `ENCRYPTION_KEY` fallback only for local development. KMS is an application-level portability boundary,
  not permission to expose plaintext secrets in App Platform.
- Separate Google OAuth, Meta, Messenger, Zalo, SePay/ApiPay, session, KMS ciphertext, Sentry and webhook values
  per environment.
- Rotate session/auth/webhook secrets with an audited runbook; test fail-closed behavior when KMS decrypt fails.

The current code still contains Telegram-era auth and requires `TELEGRAM_BOT_TOKEN`. Keep that temporary secret
only until the DD-13/DD-37 Google/email replacement lands and the Telegram route/tests are removed.

---

## 6. Build, deploy and immutable promotion

Required flow:

```text
pull request
  → format + typecheck + lint + production build + full tests
  → Semgrep CE code scan + OSV dependency scan
  → build OCI image once
  → sign image; record release tag + digest
  → create/update ephemeral staging from IaC
  → migration + queue provisioning job with DATABASE_URL_MIGRATION
  → UAT/DAST/load/failover/PITR/provider-exit gates
  → update production App Spec with the exact tested release
  → verify running digest + health + money smoke
```

App creation/update is automated from reviewed specs:

```bash
# First create; use `doctl apps update` for later reconciliations.
doctl apps create --spec infra/app.staging.yaml
doctl apps create --spec infra/app.prod.yaml
```

The CI workflow supplies the immutable release value to both specs. Do not rebuild for production and do not
promote a mutable tag.

### Required CI order

1. Validate target PostgreSQL version/extensions and roles.
2. Run migrations with `DATABASE_URL_MIGRATION`.
3. Run `infra/entrypoint.sh provision` using the same job-scoped credential.
4. Deploy/reconcile components.
5. Wait for health/readiness; execute smoke and reconnect checks.

Migration and queue provisioning must not be implemented as an App Platform runtime command that injects the DDL
credential into all components.

---

## 7. URLs and channel configuration

Use distinct domains and provider registrations:

| Surface | Local/integration | Staging | Production |
|---|---|---|---|
| Google OAuth redirect | local/tunnel client | staging client + staging domain | production client + production domain |
| Meta Login/Messenger | developer/test app or test users | staging app/page | live reviewed app/page |
| Zalo | test club/bot | staging club/bot | per-club production tokens encrypted in DB |
| SePay/ApiPay | sandbox/test account | staging account | production accounts/webhooks |
| PWA/API base | localhost/tunnel | staging domain | production domain |

Webhook updates are idempotent deployment steps. Verify the registered callback after every domain/app change; do
not rely on a manual checklist entry without provider-side evidence.

---

## 8. Rollback and recovery

### Application rollback

- Select the previously verified immutable release in the App Spec and reconcile the app.
- Confirm `web`/`discovery` health, SSE re-subscription, worker queue lag and no duplicate money mutations.
- If a forward migration has run, do not execute destructive down-migrations. Use expand/contract and forward-fix.

### Database recovery

- Provider PITR and HA are not sufficient alone. Maintain encrypted logical exports outside the DO account.
- Quarterly, restore to vanilla PostgreSQL outside DigitalOcean and run schema/role/RLS/sequence checks plus
  ledger, allocation, outbox and row-count reconciliation.
- Rehearse the cross-provider flow and rollback semantics from DD-04 §7.4. Never dual-write money data during
  migration and never point back to a stale source after the target has accepted writes.

---

## 9. Ephemeral staging lifecycle

Every staging creation requires an owner, release/drill purpose, `expires_at`, and cost ceiling. The automation:

1. creates the VPC/app/database from IaC;
2. restores anonymized/representative data or seeds production-shaped fixtures;
3. runs the selected gates;
4. exports drill evidence;
5. destroys the app, DB, VPC and temporary credentials on TTL;
6. alerts and fails closed if deletion does not complete.

Persistent callback smoke infrastructure, when genuinely required, is a separate minimal resource and must not
silently become an always-on production mirror.

---

## 10. Production acceptance checklist

This list mirrors the accepted record §7.6 and must be represented as executable checks/evidence in the infra
slice:

- [ ] Fixed-egress-IP gate closed with written evidence — still open: §1.1 gate status
      `HALT-EVIDENCE_INCOMPLETE` (SePay/ApiPay/Zalo Bot unresolved, checked 2026-07-18).
- [ ] App Platform `sgp` is attached to the intended `sgp1` VPC.
- [ ] PostgreSQL trusted sources contain only required private identities.
- [ ] Four DB roles and pooled/direct/listener URLs work over the private route with TLS verification.
- [ ] Two-instance `web` and `discovery` pass rolling-deploy and health tests.
- [ ] Discovery pool cap, `statement_timeout`, reserved money connection budget, CDN/rate limits and circuit breaker pass load tests.
- [ ] Primary-failure drill proves DB failover and application reconnect.
- [ ] SSE re-subscribes and pg-boss resumes without duplicate money mutations.
- [ ] PITR and off-provider restores meet measured RPO/RTO and reconciliation gates.
- [ ] KMS rotation and decrypt-failure paths pass.
- [ ] Ephemeral staging reproduces from IaC and destroys itself on TTL.
- [ ] Load evidence captures RPS/concurrency, DB CPU/RAM/connections/query time, queue lag, p95/p99, error rate, egress and projected cost.
- [ ] Cross-provider rehearsal and asymmetric rollback pass DD-04 §7.4.
- [ ] Budget alerts cover compute, DB, transfer, logs, backup and KMS.

---

## 11. Cost planning

| Environment | Planning envelope |
|---|---:|
| Local/integration smoke | `$0–15/month`, depending on whether a shared public callback target is kept |
| Ephemeral staging | `$8–18/month` average at 48–96h per release/drill |
| Production Day 1 | **`$120–135/month`** |
| Production + expected staging | **`$128–153/month`** |

The production baseline includes two `web`, two `discovery`, one worker, DO PostgreSQL primary+standby,
Cloudflare Free, Sentry Developer, KMS, low-volume logs/offsite backup and egress allowances. Physical read-only
node, second worker, WAF Pro, Sentry Team and resizing are telemetry-triggered upgrades, not Day-1 requirements.

Host count does not select a resource tier. Scale purchases require staging/production measurements and the
triggers in DD-04 §5.2.

---

## 12. Bounded Fly fallback

`infra/fly.toml` is retained only because DD-04 pre-authorizes fallback `(a)` when a production dependency proves
that fixed outbound IP is mandatory and App Platform+VPC cannot satisfy it.

Activating fallback requires a recorded gate result and a separate reviewed App/DB network plan:

- compute on Fly with static egress;
- DO PostgreSQL reached over public TLS with `sslmode=verify-full` and IP allowlist;
- the same four DB roles, immutable image, migration-job boundary, backup/restore and acceptance gates;
- a new cost reconciliation before procurement.

Do not use the old “three Fly apps + Fly Postgres” topology. If fallback is not activated, no production Fly
resource is provisioned.

---

## 13. Anti-patterns

- One app/database or shared secrets across staging and production.
- Console-only production resources that IaC cannot reproduce.
- Migration/owner credential in any runtime component.
- Mutable image tags or rebuilding between staging and production.
- Treating the HA standby as the discovery replica.
- Buying a read-only node from host count rather than measured contention.
- Disabling VPC to obtain a fixed egress IP without activating the approved fallback/design branch.
- Treating provider PITR as the off-provider backup.
- Leaving ephemeral staging alive without an owner and TTL.
- Editing or deleting `schema_migrations` rows to get past the P17 immutability guard. Use `pnpm db:reset:test`
  (unshipped, local) or a new forward migration (shipped) — see §4.1.

---

## Changelog

| Date | Version | Change |
|---|---|---|
| 2026-09-03 | v2.2 | Added §4.1 local development and test databases: `DATABASE_URL_TEST` (the one local/CI-only connection variable, previously undocumented here), the new `pnpm db:reset:test` and its fail-closed `_test` suffix guard, and the fact that `pnpm db:bootstrap` depends on an undeclared host `psql` plus the container route around it. Added the `schema_migrations` hand-editing anti-pattern. No change to the §1.1 egress evidence table. |
| 2026-07-16 | v2.1 | Reality-check: Docker Compose definition valid but daemon availability is not guaranteed; current DB/full-suite gate remains open. Pin official non-provisioning App Spec validation/proposal commands in the infra slice. |
| 2026-07-16 | v2.0 | Replaced the superseded Fly production body with the accepted DigitalOcean App Platform + Managed PG VPC runbook; made replica trigger-based; added component-scoped DB URLs, immutable promotion, CI secret boundary, TTL staging, DD-04 §7.6 acceptance and isolated Fly fallback. |

*Sources: DD-04 final record §5/§7; `deployment-infra.md`; DigitalOcean App Spec, VPC, scaling, Managed PostgreSQL, pricing and SLA documentation linked from the final record.*
