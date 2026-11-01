# Plexco — Setup dev · staging · production

> **Version:** v2.3 · 2026-10-30
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

Re-check, read 2026-10-28: the DigitalOcean page [How to Enable App Platform VPC](https://docs.digitalocean.com/products/app-platform/how-to/enable-vpc/),
section "Enable VPC Network Access" ("Last verified 3 Sep 2026"), still says "VPC network access and dedicated egress IPs cannot be enabled at the same time."

**First-launch rows (checked 2026-10-28)** — the server-side outbound calls of the web and worker processes at
the first launch. Criterion 1, criterion 2 and class A are those of the
[egress evidence review criteria](../decisions/analysis/dd-04-egress-evidence-review-criteria.md); step 8.4,
Q6 and Q7 are those of the [Phase 5 go-live plan](../sessions/web-mvp-phase5-golive-plan.md).

| Dependency — Plexco outbound call surface | Fixed source IP | Primary source | Checked | Why the source supports the conclusion |
|---|---|---|---|---|
| **Zalo Bot API** — backend calls to `https://bot-api.zaloplatforms.com/bot<token>/<method>` with the per-tenant bot token: `getMe` and `setWebhook` from web when a host connects a bot, `sendMessage` from the worker for Zalo DMs | **NO** — owner-signed 2026-10-30 11:10 (DD-156) | Zalo Bot Docs: [Xác thực](https://bot.zapps.me/docs/authorize/) ("Cập nhật lần cuối: 16/12/2025") · [Sử dụng API](https://bot.zapps.me/docs/call-api/), section "Định dạng URL" ("Cập nhật lần cuối: 16/12/2025") · [Bảng mã lỗi](https://bot.zapps.me/docs/error-code/) ("Cập nhật lần cuối: 6/8/2025") · API reference [getMe](https://bot.zapps.me/docs/apis/getMe/) ("Cập nhật lần cuối: 16/12/2025"), [setWebhook](https://bot.zapps.me/docs/apis/setWebhook/) ("Cập nhật lần cuối: 7/9/2026"), [sendMessage](https://bot.zapps.me/docs/apis/sendMessage/) ("Cập nhật lần cuối: 10/6/2026") · owner decision [DD-156](decisions.md) | 2026-10-28 | Auth is the Bot Token alone: "Zalo sử dụng mô hình `Bot Token` xác thực và cho phép bot sử dụng API." The token travels in the HTTPS path, the error table has no origin or IP error class, and the getMe, setWebhook and sendMessage references have no source-IP sentence, so no official sentence says the caller's source IP is not restricted. The only IP sentence, in the setWebhook "cảnh báo" callout, is a rule on the webhook `url` parameter (the inbound target), so it does not answer this question. Closed as `NO` by the owner's decision of 2026-10-30 11:10 (DD-156), on the owner's stated basis, quoted verbatim: "the official docs (bot.zapps.me Xac thuc and Su dung API, updated 16/12/2025; Bang ma loi; Dieu khoan su dung) authenticate only by Bot Token, document no IP allowlist or fixed-IP option and no IP-related error code; the only IP text is about the inbound webhook URL." This is an owner exception to this gate's evidence rule (the rule at the top of this section and the `NO` rule of section 3 of the egress evidence review criteria) for this row only, not criterion-1 or criterion-2 evidence: the basis is the owner's statement, and this row adds no new source for it. The owner still sends the step-8.4 question below; a written answer from Zalo Bot Platform that a fixed or registered source IP is required turns this row **YES** (plan Q7: the Fly + DO fallback before production). |
| **Google OAuth token exchange** — web backend `POST https://oauth2.googleapis.com/token` at Google sign-in (client ID, client secret and PKCE verifier in the request body) | **NO** — owner-signed 2026-10-29 21:40 (DD-155) | Google: [Step 5: Exchange authorization code for refresh and access tokens](https://developers.google.com/identity/protocols/oauth2/web-server) ("Last updated 2026-10-16 UTC") · owner decision [DD-155](decisions.md) | 2026-10-28 | Auth is the OAuth client credential in the request: `client_secret` is "The client secret obtained from the Cloud Console Clients page." No sentence on the whole page addresses the caller's source IP, so no official sentence says it is not restricted. Closed as `NO` by the owner's decision of 2026-10-29 21:40 (DD-155), on the owner's stated ground, quoted verbatim: "their documented IP conditions are customer-opt-in only and Plexco opts into none". This is an owner exception to this gate's evidence rule (the rule at the top of this section and the `NO` rule of section 3 of the egress evidence review criteria) for this row only, not criterion-1 or criterion-2 evidence: the ground is the owner's statement, and this row adds no new source for it. |
| **Google OIDC JWKS** — web backend `GET https://www.googleapis.com/oauth2/v3/certs` at Google sign-in (Google's ID-token signing keys, used to verify the ID token) | **NO** — owner-signed 2026-10-29 21:40 (DD-155) | Google: [Validating an ID token](https://developers.google.com/identity/openid-connect/openid-connect) ("Last updated 2026-06-15 UTC") · owner decision [DD-155](decisions.md) | 2026-10-28 | A public-key download, separate from the token exchange: "You should retrieve the keys URI from the Discovery document using the jwks_uri metadata value." No sentence on the page addresses the caller's source IP, so no official sentence says it is not restricted. Closed as `NO` by the owner's decision of 2026-10-29 21:40 (DD-155), on the owner's stated ground, quoted verbatim: "their documented IP conditions are customer-opt-in only and Plexco opts into none". This is an owner exception to this gate's evidence rule (the rule at the top of this section and the `NO` rule of section 3 of the egress evidence review criteria) for this row only, not criterion-1 or criterion-2 evidence: the ground is the owner's statement, and this row adds no new source for it. |
| **AWS KMS Decrypt** — web and worker backends, AWS SDK v3 `DecryptCommand` to the regional endpoint `kms.<region>.amazonaws.com` (HTTPS) for `AWS_REGION`, when `KMS_PROVIDER=aws-kms` | **NO** — owner-signed 2026-10-29 21:40 (DD-155) | AWS: [Welcome](https://docs.aws.amazon.com/kms/latest/APIReference/Welcome.html), section "Signing Requests" ("This document was last published on October 28, 2026.") · [AWS global condition keys](https://docs.aws.amazon.com/kms/latest/developerguide/conditions-aws.html) and its section "Using the IP address condition in policies with AWS KMS permissions" (no page date shown) · [AWS Key Management Service endpoints and quotas](https://docs.aws.amazon.com/general/latest/gr/kms.html), section "Service endpoints" (no page date shown) · owner decision [DD-155](decisions.md) | 2026-10-28 | Auth is request signing: "Requests must be signed using an access key ID and a secret access key." The only source-IP sentences describe a condition the customer writes into its own key or IAM policy ("But use caution when specifying the IP address condition operators or the `aws:SourceIp` condition key in the same policy statement that allows or denies access to AWS KMS."; "AWS KMS supports all global condition keys. You can use them in AWS KMS key policies and IAM policies."), so no official sentence says KMS does not restrict the caller's source IP. Closed as `NO` by the owner's decision of 2026-10-29 21:40 (DD-155), on the owner's stated ground, quoted verbatim: "their documented IP conditions are customer-opt-in only and Plexco opts into none". This is an owner exception to this gate's evidence rule (the rule at the top of this section and the `NO` rule of section 3 of the egress evidence review criteria) for this row only, not criterion-1 or criterion-2 evidence: the ground is the owner's statement, and this row adds no new source for it. |

<!-- DD04_EGRESS_EVIDENCE_CLOSED -->

**Rows checked 2026-07-18 (dated history; evidence unchanged).**

| Dependency — Plexco outbound call surface | Fixed source IP | Primary source | Checked | Why the source supports the conclusion |
|---|---|---|---|---|
| **SePay** — backend calls to `https://my.sepay.vn/api/v1` (OAuth2 or API token; transaction read, webhook and bank-account management). Not a first-launch dependency (DD-132; Q6). | **UNRESOLVED** | SePay Developer Docs: [Tạo API Token](https://developer.sepay.vn/vi/sepay-api/v2/tao-api-token) · [OAuth 2.0 tổng quan](https://developer.sepay.vn/vi/sepay-oauth2/tong-quan) · [Địa chỉ IP](https://developer.sepay.vn/vi/dia-chi-ip) | 2026-07-18 | Official docs specify token/OAuth2 issuance with no source-IP registration step, and the docs' only IP-allowlist page covers the reverse direction (merchants allowlist SePay's webhook egress IPs). No page affirmatively states the outbound-caller source-IP policy, so documentation silence cannot close this row as `NO`. Closes with an attributable SePay support/contract answer on source-IP policy for `my.sepay.vn` API callers. |
| **ApiPay** — primary: DD-30 enterprise auto-provisioning contract (per-host provisioning; contractual surface, not publicly documented) · fallback: BYO-key calls to `https://app.apipay.vn` (`/v2/client/banks`, `/v1/client/webhooks`). Not a first-launch dependency (DD-132; Q6). | **UNRESOLVED** | ApiPay Docs: [Authentication](https://docs.apipay.vn/vi/api/authentication) — the site is client-rendered, so the full published docs corpus was retrieved and searched | 2026-07-18 | Published docs fully specify BYO auth (`Authorization: Bearer base64(accessKey:secretKey)`) and contain no IP-allowlist or caller-IP-restriction concept (the only IP mentions are custom-domain DNS A records), but they are silent on caller source-IP policy — and the DD-30 primary enterprise provisioning surface is contractual, so public docs cannot answer it at all. Closes with the ApiPay enterprise onboarding/contract answer covering both surfaces. |
| **Zalo Bot** — backend calls to `https://bot-api.zaloplatforms.com/bot<token>/<method>` (`sendMessage`, `setWebhook`, …) with the per-tenant bot token | **UNRESOLVED** | Zalo Bot Docs: [Xác thực](https://bot.zapps.me/docs/authorize/) · [Sử dụng API](https://bot.zapps.me/docs/call-api/) · [Bảng mã lỗi](https://bot.zapps.me/docs/error-code/) | 2026-07-18 | The published calling contract is HTTPS plus the bot token as the sole credential (Telegram-style token-in-URL), with no IP-declaration step and no origin/IP error class — but no page affirmatively states the caller source-IP policy, so documentation silence cannot close this row as `NO`. Closes with an attributable Zalo Bot support answer on source-IP policy for `bot-api.zaloplatforms.com` callers. |
| **Meta Messenger** — backend `POST https://graph.facebook.com/v<ver>/<page_id>/messages` with `page_access_token`. Not a first-launch dependency (DD-132; Q6). Note 2026-10-28: this 2026-07-18 **NO** rests on an opt-in app security control, which a strict reading of criterion 1 does not accept; re-evaluate before Messenger enters (Q6). | **NO** | Meta: [Securing Graph API Requests](https://developers.facebook.com/docs/graph-api/securing-requests) | 2026-07-18 | Meta affirmatively documents server-IP allowlisting as an opt-in app security control the developer may enable, alongside the optional `appsecret_proof` / "Require App Secret" hardening. By default Graph API calls are token-authenticated from any IP, so no fixed egress IP is required. |

**Gate status (first launch, 2026-10-30): `Overall result: DO_VPC_COMPATIBLE`** — every first-launch row is `NO` by an
owner exception: Google OAuth token exchange, Google OIDC JWKS and AWS KMS Decrypt by DD-155 (owner-signed 2026-10-29
21:40), and Zalo Bot API by DD-156 (owner-signed 2026-10-30 11:10). Each is an owner exception to this gate's evidence
rule (the rule at the top of this section and the `NO` rule of section 3 of the egress evidence review criteria) for its
own row only; none rests on criterion-1 or criterion-2 evidence. By the first rule below, the result is recorded with
the closure marker below the first-launch table; it permits the App Platform + VPC green path to proceed to later manual
design review only and does not by itself authorize the infra slice or any provisioning. The owner still sends the
step-8.4 question below: a written answer from Zalo Bot Platform that a fixed or registered source IP is required turns
the Zalo Bot API row `YES` and the result `FIXED_EGRESS_REQUIRED` (the second rule below), and the Q7 fallback (Fly + DO)
then applies before production. On 2026-07-18, SePay, ApiPay and Zalo Bot were `UNRESOLVED` (dated rows above).

**Step-8.4 question to Zalo Bot Platform** (the owner sends it in writing; the reply is class-A evidence only
with its ticket id, date and verbatim text):

> Khi server của chúng tôi gọi Zalo Bot API tại `https://bot-api.zaloplatforms.com/bot<BOT_TOKEN>/<method>` (các method `getMe`, `setWebhook` và `sendMessage`) và chỉ xác thực bằng Bot Token, Zalo Bot Platform có BẮT BUỘC địa chỉ IP nguồn cố định, hoặc bắt buộc đăng ký/allowlist IP nguồn của bên gọi không? Nếu không, xin xác nhận bằng văn bản rằng các API này chấp nhận request từ bất kỳ IP nguồn nào khi Bot Token hợp lệ. Nếu có, xin cho biết nơi đăng ký, số IP tối đa và thời gian hiệu lực.

- Every first-launch row attributable and **NO** → record `Overall result: DO_VPC_COMPATIBLE` plus the closure marker.
  That permits the App Platform + VPC green path to proceed to later **manual design review only**; it does
  not by itself authorize the infra slice or any provisioning.
- Every first-launch row attributable and one or more **YES** → record `Overall result: FIXED_EGRESS_REQUIRED`. That
  blocks the DO App Platform + VPC green path and requires a separate fallback design: the bounded Fly+DO
  fallback or a DO Droplet/DOKS substrate with private DB access and controlled egress.
- Any first-launch row still missing, ambiguous, stale, or only inferred → gate status stays `HALT-EVIDENCE_INCOMPLETE`;
  no overall result or closure marker may be recorded, even if another first-launch row is already an attributable `YES`.
  The rows checked 2026-07-18 are dated history and do not count toward the first-launch result: SePay, ApiPay and
  Meta Messenger are not first-launch dependencies (DD-132; Q6), and each of their rows counts again when its
  dependency enters a launch; the Zalo Bot dependency counts through the first-launch Zalo Bot API row above.
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
component, which is why it is absent from the table above. It names a **disposable superuser database** —
disposable is a property of the *database*, not of the cluster holding it, and the difference matters locally:

| | cluster | consequence |
|---|---|---|
| CI | ephemeral service container, new each run | nothing survives, so nothing can be lost |
| local compose | **persistent** — `plexco` (dev) and `plexco_test` share one `pgdata` volume (`infra/docker-compose.yml`) | dropping the wrong database here destroys real development data |

`packages/db/src/test-harness.ts` calls this "a SUPERUSER url on a THROWAWAY cluster", which is true of CI and
**not** of a developer's machine. That mismatch is the reason `db:reset:test` refuses anything but a
`_test`-suffixed name on the local endpoint: the guard exists precisely because the cluster is not disposable.

Both pinned values already end in `_test`:

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

`pnpm db:reset:test [--db <name>_test]`

**The tool owns every input it acts on, and `DATABASE_URL_TEST` is not one of them.** That is a
deliberate reversal. An earlier design derived the target from the URL, and four review rounds each found
a different input that outranked it. **Six** things decide which database actually gets dropped — the docker
daemon, the compose project, the **compose file**, the container, the executing role, and the database name —
and a URL supplies exactly one. Hardening the URL could not converge, because the other five are not in the
URL at all. The compose file is named separately rather than folded into the project because it is separately
selectable: a relative path is resolved against the working directory, so cwd would otherwise choose it.

| input | how it is decided now |
|---|---|
| docker daemon | the resolved endpoint is read and **must be a local unix socket**, or the tool refuses |
| compose project | pinned with `-p plexco`; `COMPOSE_PROJECT_NAME` is stripped from the child environment |
| compose file | an absolute path resolved from the **main worktree** (`git rev-parse --path-format=absolute --git-common-dir`, run with `GIT_*` neutralised), carried in `-f`. Not the running checkout: every writing slice runs in a linked worktree, and the service hash includes the bind-mount source, so a worktree-local path rejects the shared container. Falls back to the script's own tree only if git cannot answer |
| container | the container **ID**, resolved from that project and file, then verified three ways before anything destructive: its `com.docker.compose.project.config_files` label is exactly this one file, its `com.docker.compose.config-hash` matches the current service definition, and it actually mounts the volume this configuration resolves to. The first three are descriptions of the container; the mount is the resource the drop would affect |
| executing role | the compose service's `POSTGRES_USER`, passed as `psql -U`; **not overridable**. A caller-supplied role could own the database (so `DROP` succeeds) without `CREATEDB` (so `CREATE` fails), destroying it with no way to restore |
| database | `--db`, defaulting to `plexco_test`; recreated with `TEMPLATE template0`, because a bare `CREATE DATABASE` clones `template1`, which on a long-lived local cluster may carry site-local objects including a stale `schema_migrations` |

Stripping the environment is **not** sufficient by itself and the tool does not rely on it: the active docker
context lives in `~/.docker/config.json`, not in a variable. Measured on a developer machine with both
`DOCKER_HOST` and `DOCKER_CONTEXT` unset, the effective context was still `desktop-linux`. Pinning
`--context default` would be equally wrong — on Docker Desktop `default` names `/var/run/docker.sock` while
the daemon listens elsewhere. So the endpoint is **verified, never forced**.

`DATABASE_URL_TEST`, if set, is a **cross-check on the database NAME only**: a different name refuses. A
matching name does *not* mean the URL was validated — its host, port, role and scheme are never inspected,
and the command acts on the local pinned project regardless of what the URL says.

The remaining name guards are unchanged and still apply to `--db`:

- it **names the database it is about to destroy**, before destroying it;
- it **refuses any name not ending in `_test`** — `plexco`, the development database, is refused;
- it refuses any name that is not a plain identifier, and any name longer than PostgreSQL's 63-byte
  identifier limit — beyond that the server truncates, and a truncated name may no longer end in `_test`;
- it **quotes** the identifier, so a mixed-case name cannot be folded into a different database than the one
  it validated and printed;
- it runs `psql` **inside the compose `postgres` container**, so no host `psql` is needed.

> ⚠ **Do not run it while a test suite is running.** It uses `DROP DATABASE ... WITH (FORCE)`, and
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
  # Resolve a canonical repo root -- NOT $PWD, which lets the wrong working directory select a
  # different compose file. Then apply the same protections the reset command applies to itself:
  # a local endpoint, captured and bound; the project pinned; and the container verified to have
  # been created from THIS compose file AND its current configuration, not merely to carry
  # matching labels.
  # Neutralise the same variables the implementation strips from its child environment. Without
  # this the endpoint below is resolved under whatever the shell carries: DOCKER_HOST=unix:///tmp/
  # unintended.sock is still a unix:// socket, so it passes the locality check and is then bound
  # with -H for a privileged bootstrap. Checking locality is not the same as choosing the daemon.
  unset DOCKER_HOST DOCKER_CONTEXT COMPOSE_PROJECT_NAME COMPOSE_FILE COMPOSE_PROFILES COMPOSE_PROJECT_DIRECTORY
  unset GIT_DIR GIT_WORK_TREE GIT_COMMON_DIR GIT_CEILING_DIRECTORIES  # git resolves the compose authority below

  # --git-common-dir, NOT --show-toplevel: in a linked worktree the latter returns THAT worktree,
  # whose compose file is byte-identical but produces a different service hash (the bind-mount
  # source carries the checkout path). The shared container would be rejected, and recreating it
  # from a temporary worktree would break the main checkout too.
  root="$(cd "$(dirname "$(git rev-parse --git-common-dir)")" && pwd -P)"
  compose="$root/infra/docker-compose.yml"

  endpoint="$(docker context inspect --format '{{.Endpoints.docker.Host}}')"
  case "$endpoint" in
    unix://*) ;;
    *) echo "docker endpoint is not a local unix socket; refusing" >&2; exit 1 ;;
  esac

  cid="$(docker -H "$endpoint" compose -p plexco -f "$compose" ps -q postgres)"
  [ -n "$cid" ] || { echo "no running postgres container in project plexco; refusing" >&2; exit 1; }

  # EXACT SET, not membership. A container started with an override (`-f canonical -f override`)
  # labels config_files with BOTH; an override can remap the pgdata volume while leaving the
  # service hash unchanged, so "contains the canonical file" is not enough.
  files="$(docker -H "$endpoint" inspect --format '{{index .Config.Labels "com.docker.compose.project.config_files"}}' "$cid")"
  [ "$files" = "$compose" ] || { echo "container was not built from exactly $compose; refusing" >&2; exit 1; }

  # Same path is not the same configuration: an older container from a previous version of this
  # file passes every check above. The config hash is what compose itself uses to detect staleness.
  want="$(docker -H "$endpoint" compose -p plexco -f "$compose" config --hash=postgres | awk '{print $NF}')"
  got="$(docker -H "$endpoint" inspect --format '{{index .Config.Labels "com.docker.compose.config-hash"}}' "$cid")"
  [ -n "$want" ] && [ "$want" = "$got" ] || { echo "container is from an older configuration; recreate it; refusing" >&2; exit 1; }

  # The hash does not bind the VOLUME: renaming volumes.pgdata.name changes the physical volume and
  # leaves the service hash identical. Compare the resolved volume with the container's real mount.
  wantvol="$(docker -H "$endpoint" compose -p plexco -f "$compose" config --format json \
    | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);const m=(j.services.postgres.volumes||[]).find(v=>v.target==="/var/lib/postgresql/data");process.stdout.write(String(j.volumes?.[m?.source]?.name??""))})')"
  gotvol="$(docker -H "$endpoint" inspect --format '{{range .Mounts}}{{if eq .Destination "/var/lib/postgresql/data"}}{{.Name}}{{end}}{{end}}' "$cid")"
  [ -n "$wantvol" ] && [ "$wantvol" = "$gotvol" ] || { echo "container stores data on volume '$gotvol', config resolves to '$wantvol'; refusing" >&2; exit 1; }

  mr="${MIGRATION_ROLE:-}"
  case "$mr" in
    "") ;;
    *[!a-zA-Z0-9_]*)
      echo "MIGRATION_ROLE must be a plain identifier: letters, digits, underscore only" >&2
      exit 1
      ;;
  esac

  docker -H "$endpoint" exec -i "$cid" \
    psql -X -h /var/run/postgresql -p 5432 -U plexco -d plexco -v ON_ERROR_STOP=1 \
    -c "SET job_definer_bootstrap.migration_role = '$mr'" \
    -f - < "$root/infra/postgres-init/01-job-definer.sql"

  docker -H "$endpoint" exec -i "$cid" \
    psql -X -h /var/run/postgresql -p 5432 -U plexco -d plexco -v ON_ERROR_STOP=1 \
    -c "SET chat_definer_bootstrap.migration_role = '$mr'" \
    -f - < "$root/infra/postgres-init/02-chat-definer.sql"
)
```

Both files are idempotent, so re-running them on an already-bootstrapped cluster is safe.

---

## 5. Secrets and KMS

- Store runtime secrets as App Platform encrypted environment values, scoped to the component that consumes
  each value. Never commit literal secrets or place them in an App Spec.
- Keep `DATABASE_URL_MIGRATION` in the protected CI environment/job only.
- Continue the accepted application encryption contract, with the root chosen per environment at step 8.5 (DD-158):
  AWS KMS envelope encryption (recommended), or the local `ENCRYPTION_KEY` root, a permitted production option of lower protection, subject to the owner's sign-off at 8.9 (local development uses the local root). KMS is an application-level portability boundary,
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

The committed specs carry placeholders (`__IMAGE_DIGEST__`, `__VPC_ID__`, `__APP_DOMAIN__`, and `__KMS_PROVIDER__` from `KEY_ROOT`) that
`infra/render-app-spec.sh` fills from a live app, so the first creation of each app is the owner-only sequence
of `docs/runbooks/staging-deploy.md` §2.5; later reconciliations are `doctl apps update` in the deploy workflows.

The CI workflow supplies the immutable release value to both specs. Do not rebuild for production and do not
promote a mutable tag.

### Required CI order

1. Validate target PostgreSQL version/extensions and roles.
2. Run migrations with `DATABASE_URL_MIGRATION` in the PRE_DEPLOY `migrate` job.
3. Then, in the same job and shell and with the same job-scoped credential, run `provision:queue` (`infra/entrypoint.sh`, `migrate` arm lines 78-85, `provision:queue` at line 84); since lane L82 (PR #151), queue provisioning is no longer a separate job or step.
4. Deploy/reconcile components.
5. Wait for health/readiness; execute smoke and reconnect checks.

Migration and queue provisioning must not be implemented as an App Platform runtime command that injects the DDL
credential into all components.

### Implemented by (lane L66, 2026-10-30): files prepared, not applied

| Contract above | File on main | State |
|---|---|---|
| Staging and production App Specs (§3), job-scoped DDL credential (§4, §6) | `infra/app.staging.yaml`, `infra/app.prod.yaml` (PRE_DEPLOY `migrate` job; role `migrate` in `infra/entrypoint.sh`) | PREPARED, NOT APPLIED: no app was created, nothing was deployed, and `doctl apps spec validate` was not run (it needs DigitalOcean auth; owner steps 8.1, 8.2 and 8.5 of the Phase 5 go-live plan) |
| Secret values never in git (§5, §6) | `infra/render-app-spec.sh` and `infra/render-app-spec.test.mjs`; env names per component in `docs/runbooks/env-manifest-staging-production.md` | tested in CI (`test:infra`) with the real key names and fake values only (fake ciphertext, hosts, image digest and VPC id); never run against a live app |

Deviation from this document (default pending owner ratification at step 8.9, DD-129 (1)):

- §5 keeps `DATABASE_URL_MIGRATION` in the protected CI environment or job only. The App Specs carry it as a secret on the PRE_DEPLOY `migrate` job only; it is absent from every runtime component, and the renderer refuses a spec that lists it elsewhere.

Not done and not proven: nothing ran against DigitalOcean. The §1.1 gate is closed as `DO_VPC_COMPATIBLE` by owner exceptions (DD-155, DD-156); a written Zalo Bot Platform answer that requires a fixed source IP reverses it (§1.1, the Q7 fallback). DB TLS CA verification (§4) is not implemented (backlog `db-tls-ca-verification-do-managed-pg`). The deploy workflows, the deploy runbooks, automatic TTL teardown (§9) and the measured RPO/RTO cells do not exist yet.

Update 2026-11-01: DB TLS CA verification (§4) is implemented (lane L78, PR #159, `@plexco/db/pg-ssl-options`), and it is required for a production build that reaches a non-loopback database (lane L89). Still pending: the owner's paste of the real CA and the staging proof (backlog `db-tls-ca-verification-do-managed-pg`).

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

- [x] Fixed-egress-IP gate closed with written evidence — closed 2026-10-30: §1.1 gate status
      `Overall result: DO_VPC_COMPATIBLE` by the owner exceptions DD-155 and DD-156, which stand in for the written
      evidence this item names (DD-155 (c), DD-156). Zalo Bot Platform's written answer to the step-8.4 question is
      still pending; a `YES` means `FIXED_EGRESS_REQUIRED` and the Q7 fallback (Fly + DO) before production.
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
| 2026-10-30 | v2.3 | Added "Implemented by" under §6 (lane L66): the staging and production App Specs exist as files, PREPARED, NOT APPLIED; no DigitalOcean app, deploy or spec validation ran. No change to §1.1. |
| 2026-09-03 | v2.2 | Added §4.1 local development and test databases: `DATABASE_URL_TEST` (the one local/CI-only connection variable, previously undocumented here), the new `pnpm db:reset:test` and its fail-closed `_test` suffix guard, and the fact that `pnpm db:bootstrap` depends on an undeclared host `psql` plus the container route around it. Added the `schema_migrations` hand-editing anti-pattern. No change to the §1.1 egress evidence table. |
| 2026-07-16 | v2.1 | Reality-check: Docker Compose definition valid but daemon availability is not guaranteed; current DB/full-suite gate remains open. Pin official non-provisioning App Spec validation/proposal commands in the infra slice. |
| 2026-07-16 | v2.0 | Replaced the superseded Fly production body with the accepted DigitalOcean App Platform + Managed PG VPC runbook; made replica trigger-based; added component-scoped DB URLs, immutable promotion, CI secret boundary, TTL staging, DD-04 §7.6 acceptance and isolated Fly fallback. |

*Sources: DD-04 final record §5/§7; `deployment-infra.md`; DigitalOcean App Spec, VPC, scaling, Managed PostgreSQL, pricing and SLA documentation linked from the final record.*
