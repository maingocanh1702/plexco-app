# DD-04 Final Decision — Co-locate compute + PostgreSQL on DigitalOcean

> **Status:** ✅ Accepted<br>
> **Decision date:** 2026-07-16<br>
> **Revision:** 2 — cost-optimized, upgradeable, provider-portable baseline<br>
> **Owner:** Founder<br>
> **Scope:** production compute, PostgreSQL hosting, network posture, operating cost, scaling, backup,
> and provider-exit contract<br>
> **Supersedes:** recommendation `(a) giữ Fly + public TLS` in
> [`dd-04-hosting-decision-brief.md`](dd-04-hosting-decision-brief.md). Provider facts and hard gates in
> that brief remain useful; this record is the final choice.

## 1. Decision

Choose **QĐ-1 (c): co-locate compute and database on DigitalOcean in Singapore**:

- **Compute:** DigitalOcean App Platform, one immutable OCI image deployed as three component types:
  `web`, `discovery`, and `worker`.
- **Database:** DigitalOcean Managed PostgreSQL, **HA cluster with at least one standby node**.
- **Network:** App Platform and PostgreSQL connect through the same DigitalOcean VPC in `sgp`/`sgp1`;
  PostgreSQL is restricted to trusted sources on that private network.
- **Database security remains defence-in-depth:** TLS hostname/CA verification, four least-privilege DB
  roles, separate pooled and direct/session connection strings, and no migration credential in runtime
  components.
- **Region:** Singapore for both compute and database.
- **Day-1 planning budget:** **`$120–135/month`**, including HA/PITR, private DB connectivity, two
  `web`, two `discovery`, one durable worker, KMS, low-volume observability, and encrypted offsite backup.

This is the highest-benefit option for Plexco because it combines a private DB path, managed failover,
predictable operations, and one production-provider boundary without buying capacity before telemetry
requires it. The lower Day-1 cost comes from trigger-based upgrades, **not** from removing HA, PITR,
RLS, encryption, backup, or fail-closed money controls.

This decision changes the deployment target currently represented by [`infra/fly.toml`](../infra/fly.toml).
It does **not** reverse DD-10: DD-10 chooses Next.js App Router, standalone containers, and no Vercel; it
does not canonically require Fly.io.

## 2. Non-negotiable requirements

1. Managed PostgreSQL with automatic failover, PITR, and contractual uptime SLA.
2. Singapore region for the steady-state production topology.
3. Private VPC DB path; public TLS + static-IP allowlist is a fallback posture, not equivalent to private.
4. Transaction-pooled URL for request traffic plus direct/session URLs for SSE `LISTEN/NOTIFY` and
   pg-boss workers.
5. Four connection-level roles with least privilege: runtime web, discovery/readonly, worker, and
   migration.
6. RLS, allocation, idempotency, and money paths remain fail-closed.
7. KMS envelope encryption, encrypted offsite logical backup, and tested restore outside DigitalOcean.
8. PostgreSQL portability: no provider-exclusive data model, queue, or business logic.
9. Failover, reconnect, rolling-deploy, restore, and provider-exit drills must pass before production
   acceptance.

## 3. Cost model and assumptions

All figures are **USD/month, list-price planning estimates verified 2026-07-16**. They exclude VAT/tax,
paid support, third-party API fees, unusual egress, migration labour, and usage beyond the stated free or
low-volume allowances. Procurement must re-price before launch.

| Assumption | Value used |
|---|---|
| Billing month | 730 hours where hourly pricing applies |
| Production processes | `web` + `discovery` + `worker` from the same immutable image |
| Day-1 compute | Two 1 GiB scalable `web`, two 1 GiB scalable `discovery`, one fixed 1 GiB `worker` |
| DO database | 2 GiB/1 vCPU primary `$30.45` + matching standby `$30.45` = `$60.90` |
| Edge | Cloudflare Free at Day 1; Pro only on a capability/abuse trigger |
| Error monitoring | Sentry Developer at Day 1; Team only on a team/integration/quota trigger |
| Secrets | One AWS KMS key plus low request volume: `$1–3` planning allowance |
| Logs and offsite backup | Low-volume logs plus encrypted logical exports to R2: `$0–5` |
| Traffic/variance buffer | `$0–8`; raise only from measured egress or retained-log volume |
| Staging | Full production-shape environment created from IaC for 48–96 hours per release/drill, then destroyed |

Tenant/host count is **not** a capacity formula. The prior 100/1000/2000-host envelopes are superseded
because they multiplied unbenchmarked infrastructure assumptions. Size from active concurrency, webhook
RPS, query time, DB CPU/RAM/connections, queue lag, egress, and p95/p99 latency.

## 4. Option comparison after cost optimization

These ranges compare a small-production shape with HA where the option can meet that gate. Paid WAF,
paid Sentry, and a permanent read replica are excluded unless their trigger fires.

| Option | Estimated monthly cost | Security / operations | Decision |
|---|---:|---|---|
| **DO App Platform + DO Managed PG HA** | **`$120–135`** | Private VPC, one provider, managed compute + DB | **Selected** |
| DO Droplets + DO Managed PG HA | `~$100–115` | Private VPC, but OS, rollout, patching, capacity and LB ownership move to the team | Upgrade/fallback substrate, not Day-1 default |
| Fly + DO Managed PG HA | `~$105–120` | Public DB path with `verify-full` + static-IP allowlist; two providers | Bounded fallback if §7.1 fails |
| Fly + Neon Scale | `~$90–105` at 0.25 CU; `~$130–145` at 0.5 CU | Public DB path, two providers, variable CU bill, always-on tuning | Not chosen |
| AWS Fargate + Neon PrivateLink | `~$225–350` | Strict-private, but ECS/ALB/NAT/endpoints/CloudWatch add cost and operating surface | Not chosen |
| DO App Platform + single-node DO PG | `~$90–100` | Removes standby HA and the 99.95% DB SLA gate | Rejected |
| Supabase / Railway / self-hosted PG | Plan- or quote-dependent | Fails the combined Day-1 HA/SLA/private-path/low-ops gates, or costs more | Rejected for production baseline |

The selected option is not the absolute cheapest line item. It maximizes total project benefit: about
`$5–30/month` above the credible low-cost alternatives buys a private DB path, one incident boundary,
and lower solo-team operating load. The AWS/private topology buys more infrastructure than the current
single-region product needs.

## 5. Selected-option cost detail

### 5.1 Day-1 production baseline

| Item | Calculation | Monthly estimate |
|---|---:|---:|
| `web` | `2 × $12` scalable 1 GiB | `$24.00` |
| `discovery` | `2 × $12` scalable 1 GiB | `$24.00` |
| `worker` | `1 × $10` fixed 1 GiB | `$10.00` |
| DO Managed PostgreSQL HA | primary `$30.45` + standby `$30.45` | `$60.90` |
| Cloudflare | Free WAF subset, one rate-limit rule, unmetered DDoS protection | `$0` |
| Sentry | Developer: one user, error monitoring, tracing, email alerts | `$0` |
| AWS KMS | one key + low request volume; cache data keys for envelope encryption | `$1–3` |
| Logs + encrypted R2 offsite backup | low-volume allowance; money/identity audit remains DB-canonical | `$0–5` |
| Egress/variance buffer | measured, not pre-purchased | `$0–8` |
| **Planning total** | exact subtotal `$118.90` before variable allowances | **`$120–135`** |

The fixed `$10` worker is intentional at Day 1: there is one durable consumer until idempotency and
duplicate-delivery tests prove horizontal safety. When a second worker is justified, move to two scalable
1 GiB workers; the incremental planning cost is approximately `$14/month`.

### 5.2 Trigger-based upgrades

| Upgrade | Trigger — require telemetry or a failed gate | Approximate monthly delta |
|---|---|---:|
| Second scalable worker | Sustained queue lag breaches SLO after safe concurrency tuning; idempotency and duplicate-delivery tests green | `+$14` from the fixed-worker baseline |
| DO read-only node | Discovery load causes measured primary contention or money-path p95/p99 regression after pool/rate/cache controls | `+$30.45` minimum at the current 2 GiB primary size |
| Cloudflare Pro | Free managed rules + one rate-limit rule cannot express the required control, or observed abuse requires it | `+$20` annual equivalent / `+$25` month-to-month |
| Sentry Team | More than one operator, third-party integrations, or Developer quota/retention is insufficient | `+$26` annual equivalent |
| Paid log retention | Free/low-volume retention cannot meet incident, audit, or compliance needs | Usage/policy-based |
| App component 1→2 GiB | Component CPU/RAM or latency remains saturated after horizontal tuning | `+$13` per upgraded instance |
| PostgreSQL 2→4 GiB HA | DB CPU/RAM/connections/query latency breach the capacity gate under representative load | `+$60.90` for primary + standby together |

Do **not** use the HA standby as the default discovery replica. DigitalOcean allows reads from standby,
but warns that read load can overwhelm its ability to replace the primary. A DO read-only node is also
not a cheap same-VPC copy: it must be at least the primary size, is geographically separate, and primary
replication traffic is SSL-encrypted over the public network. Add it only when benchmark evidence pays for
that tradeoff.

### 5.3 Read isolation without a Day-1 replica

`discovery` remains isolated from money workloads through all of the following:

- a projection-only DB role with zero grants on canonical money/PII tables;
- a separate bounded pool with a hard connection cap and statement timeout;
- CDN caching for public projections, edge and application rate limits, and cache-safe invalidation;
- a circuit breaker that degrades discovery to stale data, `429`, or `503` before web/worker pools suffer;
- reserved connection budgets for `web`, `worker`, and session-mode listeners;
- a physical read-only node only after load tests show the controls above are insufficient.

### 5.4 Ephemeral staging instead of an always-on mirror

Provision a full production-shape staging environment from IaC for 48–96 hours around each release,
load/soak test, failover drill, restore drill, or provider-exit rehearsal, then destroy it automatically
with a TTL. At the Day-1 shape this averages approximately **`$8–18/month`**, making the expected
production-plus-staging envelope **`$128–153/month`**. Keep a minimal non-production smoke surface only
if a persistent integration callback requires it; it is not a second production stack.

## 6. Why option (c) maximizes project benefit

1. **Security:** the steady-state DB path is private; public exposure is not accepted silently to save cost.
2. **Money correctness:** managed standby failover, 99.95% DB SLA, PITR, isolated connection pools, and
   one-provider incident handling reduce failure modes around writes and reconnects.
3. **Maintainability:** one account, region, VPC, bill, and managed compute layer are a better solo-team
   trade than maintaining VMs or AWS network fabric for a small saving.
4. **Scalability:** App Platform can scale components horizontally, and DO Managed PostgreSQL can resize
   CPU/RAM/storage without downtime; expensive capacity is added from telemetry.
5. **Architecture fit:** Plexco needs durable pg-boss and `LISTEN/NOTIFY` session connections, so there is
   no dependency on a serverless DB scale-to-zero lifecycle.
6. **Portability:** immutable images, standard PostgreSQL, configuration-only connection endpoints, IaC,
   and an executable migration contract prevent provider choice from leaking into business logic.

## 7. Risks and acceptance gates

### 7.1 Hard gate: VPC versus dedicated egress IP

DigitalOcean App Platform cannot enable VPC network access and dedicated egress IPs at the same time.
Before implementation, verify whether Zalo, Messenger, SePay, ApiPay, or any other production dependency
requires a fixed outbound source IP.

- If none requires it, proceed with option (c).
- If one requires it, **do not silently disable the private DB path**. Use option `(a) Fly + DO` as the
  bounded fallback, or design a DO Droplet/DOKS substrate with both private DB access and controlled egress.

| Dependency | Question to answer | Verification source |
|---|---|---|
| **SePay** | Does Plexco→SePay require source-IP allowlisting? Does inbound webhook verification require a fixed Plexco IP? | SePay partner docs/support; connector spike CO-OQ-2/3/7 |
| **ApiPay** | Does enterprise auto-provisioning (DD-30) restrict API calls by source IP? | ApiPay enterprise onboarding |
| **Zalo Bot** | Does the send API require fixed egress IP? | Zalo Bot API docs; DD-14/15 spike |
| **Messenger (Meta)** | Does the Graph API require fixed egress IP? | Meta docs |
| **Conclusion** | Any confirmed “yes” breaks option (c) as-is and activates the bounded fallback/design branch | Recorded provider evidence |

### 7.2 Provider-neutral application contract

Co-location intentionally accepts DigitalOcean account/region concentration instead of buying an AWS
control plane on Day 1. That risk is acceptable only while the off-provider backup, restore rehearsal,
immutable image, and migration contract below remain green.

The application must satisfy all of these before production:

- build one immutable OCI image that runs on App Platform, Fly, Droplets, DOKS, ECS, or equivalent;
- read provider endpoints only from `DATABASE_URL`, `DATABASE_URL_DIRECT`, and
  `DATABASE_URL_LISTEN`; no provider hostname or SDK in domain/business code;
- use standard PostgreSQL plus an extension allowlist verified against at least two credible target
  providers; migrations own schema, roles, grants, RLS, extensions, and sequence setup;
- keep queue durability in PostgreSQL/pg-boss and realtime durability in canonical tables/outbox;
  `LISTEN/NOTIFY` is a wake-up hint, not the durable record;
- keep provider-specific deployment modules behind IaC/config boundaries;
- do not add a permanent cross-cloud DB proxy only for portability: it adds latency and a new single point
  of failure without removing migration work.

### 7.3 Upgrade paths that preserve application performance

- **App Platform:** scale `web` and `discovery` horizontally. Request-rate and p95-response-time
  autoscaling can run on shared or dedicated compute; CPU-utilization autoscaling requires dedicated CPU.
  Start shared/scalable and move to dedicated only when CPU isolation or CPU-based policy is justified.
- **PostgreSQL:** resize CPU/RAM/storage and enable storage autoscaling before introducing a new data layer.
  DO documents these resize operations as no-downtime, but Plexco still validates reconnects and p95/p99.
- **Compute substrate:** if App Platform cost or network features become limiting, blue-green the same OCI
  image to DO Droplets or DOKS in the same VPC, then drain old instances. The DB path and app contracts stay
  unchanged.
- **Database provider:** provision the target at equal-or-greater tested capacity and the same or newer
  PostgreSQL major version. Migrate with logical replication and a bounded write freeze; do not restore a
  stale dump over a live target.

### 7.4 Cross-provider migration and rollback contract

Required migration flow:

```text
source live
  → validate target versions/extensions/roles
  → initial copy
  → logical replication
  → shadow reads + checksums + ledger/outbox reconciliation
  → freeze writes
  → drain pg-boss worker and all mutation traffic
  → replication lag = 0
  → sync sequences
  → switch DATABASE_URL* atomically
  → restart/re-subscribe LISTEN/NOTIFY consumers
  → resume worker and writes
  → observe before decommissioning source
```

PostgreSQL logical replication does **not** replicate DDL/schema changes, sequence state, large objects,
views, or roles/grants. Apply and verify those separately. During shadow validation the target is read-only;
dual-writing money data is prohibited because it creates split-brain and makes rollback ambiguous.

Cutover acceptance gates under the same production-shaped load:

- zero lost or duplicated charge, transaction, allocation, outbox, or audit records;
- public reads remain available; mutation pause is **≤5 minutes** in the rehearsal at Day-1 data size;
- target error rate is no worse by more than `0.1` percentage point and p95/p99 latency is no worse by
  more than `10%` versus the source benchmark;
- target connection usage remains below `80%` of its safe connection budget and queue lag returns to SLO;
- SSE listeners re-subscribe and pg-boss resumes without duplicate money mutations;
- DNS/connection TTL, credential rotation, and old-source isolation are proven in the runbook.

Rollback is asymmetric:

- **Before** the target accepts writes: switch connections back to the still-current source.
- **After** the target accepts writes: never point back to a stale source. Use forward-fix, or prove reverse
  replication and sequence/ledger reconciliation before rollback.
- Keep the source read-only for at least **72 hours and one completed money-reconciliation cycle**, then
  destroy it only after the observation gate passes.

No provider migration can promise literally zero impact. The contract is bounded write interruption,
uninterrupted public reads where practical, no split-brain, and no statistically material performance
regression.

### 7.5 Backup and disaster-recovery contract

- Maintain three independent recovery forms: live HA data, provider PITR, and encrypted logical exports
  outside the DigitalOcean account/provider.
- Export schema, migrations, roles/grants, RLS, extensions, sequence state, and data; a data-only dump is
  not a portable recovery set.
- Run logical exports off-peak with bandwidth/concurrency caps and abort if production p95/p99 or queue
  SLO regresses. At larger data sizes, use a temporary replica/target for the initial copy instead of paying
  for a permanent monthly migration replica.
- Quarterly, restore to temporary vanilla PostgreSQL outside DigitalOcean and run schema checksum,
  row-count, ledger/allocation/outbox reconciliation, smoke tests, and representative load tests.
- Day-1 temporary portability/restore target allowance is approximately **`$10–30 per drill`** plus egress;
  this is a drill cost, not an always-on monthly standby.

### 7.6 Production acceptance checklist

- [ ] §7.1 fixed-egress-IP gate is closed with written provider evidence.
- [ ] App Platform is deployed in `sgp` and connected to the correct `sgp1` VPC.
- [ ] PostgreSQL trusted sources contain only the required application private identity.
- [ ] All four DB roles and pooled/direct/listener connection strings work on the private route with TLS
      CA + hostname verification enabled.
- [ ] Two-instance `web` and `discovery` topology passes health-check and rolling-deploy tests.
- [ ] Discovery pool caps, timeouts, rate limits, cache policy, and circuit breaker protect money pools.
- [ ] Primary-failure drill proves automatic DB failover and application reconnection.
- [ ] SSE listeners re-subscribe; pg-boss resumes without duplicate money mutations.
- [ ] PITR and off-provider restore drills prove the selected RPO/RTO and reconciliation checks.
- [ ] KMS envelope encryption, key rotation, and degraded/fail-closed paths are tested.
- [ ] Ephemeral staging is reproducible from IaC and destroys itself on TTL.
- [ ] Load tests record concurrency, RPS, DB CPU/RAM/connections/query time, queue lag, p95/p99, error rate,
      egress, and projected monthly cost before any scale purchase.
- [ ] Cross-provider rehearsal passes §7.4, including rollback semantics and performance gates.
- [ ] Monthly budget alerts cover compute, DB, transfer, logs, backups, and KMS.

## 8. Consequences and required propagation

> **Status (2026-07-16):** provider decision remains accepted and canonical. Revision 2 replaces the old
> `$202–254` mandatory Day-1 budget with a `$120–135` trigger-based baseline and adds executable upgrade,
> backup, and provider-exit gates.

1. ✅ **DONE** — provider/network decision is recorded in
   [`standards/decisions.md`](standards/decisions.md) and
   [`standards/deployment-infra.md`](standards/deployment-infra.md).
2. ✅ **DONE (2026-07-16)** — `$121–133 core / $202–254 money-safe` and Day-1 replica/Pro/Team wording
   replaced with this revision’s `$120–135` baseline + trigger table in `standards/decisions.md`
   (v1.34), `standards/deployment-infra.md` (v1.8, §5/§9), `standards/environments-setup.md` (v2.0),
   `strategy/base-chat-package-feasibility.md` (§3), and `dd-04-hosting-decision-brief.md`. Pointer version
   refs cascaded decisions.md v1.33→v1.34 across dependent docs.
3. ⬜ **PENDING (infra slice)** — close §7.1, create the DigitalOcean App Spec/IaC, implement ephemeral
   staging, and encode the acceptance/rollback gates; do not hand-convert `fly.toml` in a docs-only change.
4. ⬜ **PENDING** — mark `infra/fly.toml` superseded only after the DO deployment path is verified.
5. ⬜ **PENDING** — replace planning allowances with measured staging/production data before procurement
   and every material scale step.
6. ⬜ **PENDING** — execute the first off-provider restore and migration rehearsal before production launch.

## 9. Sources

### DigitalOcean

- [App Platform pricing and scaling eligibility](https://docs.digitalocean.com/products/app-platform/details/pricing/)
- [App Platform horizontal and request/CPU scaling](https://docs.digitalocean.com/products/app-platform/how-to/scale-app/)
- [App Platform VPC support and dedicated-egress incompatibility](https://docs.digitalocean.com/products/app-platform/how-to/enable-vpc/)
- [App Platform SLA — 99.95% per component instance](https://www.digitalocean.com/sla/app-platform)
- [Managed PostgreSQL pricing](https://www.digitalocean.com/pricing/managed-databases)
- [Managed Databases SLA — 99.95% with standby](https://www.digitalocean.com/sla/databases)
- [PostgreSQL standby nodes and read-load warning](https://docs.digitalocean.com/products/databases/postgresql/how-to/add-standby-nodes/)
- [PostgreSQL read-only nodes: same/larger sizing and public replication path](https://docs.digitalocean.com/products/databases/postgresql/how-to/add-read-only-nodes/)
- [PostgreSQL no-downtime resize and storage autoscaling](https://docs.digitalocean.com/products/databases/postgresql/how-to/resize/)
- [PostgreSQL PITR restore](https://docs.digitalocean.com/products/databases/postgresql/how-to/restore-from-backups/)
- [PostgreSQL connection pools; session mode supports LISTEN/NOTIFY](https://docs.digitalocean.com/products/databases/postgresql/how-to/manage-connection-pools/)
- [Outbound PostgreSQL migration with validation and logical replication](https://docs.digitalocean.com/products/databases/postgresql/how-to/migrate-to-self-managed/)
- [Droplet pricing](https://www.digitalocean.com/pricing/droplets) and
  [Regional Load Balancer pricing](https://docs.digitalocean.com/products/networking/load-balancers/details/pricing/)

### Portability and low-cost operations

- [PostgreSQL logical-replication restrictions](https://www.postgresql.org/docs/17/logical-replication-restrictions.html)
- [Cloudflare WAF plan capabilities](https://developers.cloudflare.com/waf/)
- [Cloudflare unmetered DDoS protection](https://developers.cloudflare.com/ddos-protection/frequently-asked-questions/)
- [Cloudflare Free/Pro pricing](https://www.cloudflare.com/plans/)
- [Cloudflare R2 pricing and free tier](https://developers.cloudflare.com/r2/pricing/)
- [Sentry Developer and Team pricing](https://sentry.io/pricing/)
- [AWS KMS key/request pricing](https://aws.amazon.com/kms/pricing/)
- [Better Stack low-volume logs/monitoring pricing](https://betterstack.com/pricing)

### Rejected/fallback providers

- [Fly.io compute, egress, and static-egress-IP pricing](https://fly.io/docs/about/pricing/)
- [Neon pricing](https://neon.com/pricing)
- [Neon SLA](https://neon.com/sla)
- [Neon network transfer](https://neon.com/docs/introduction/network-transfer)
- [Supabase pricing](https://supabase.com/pricing)
- [Supabase PrivateLink](https://supabase.com/docs/guides/platform/privatelink)
- [AWS Fargate pricing](https://aws.amazon.com/fargate/pricing/)
- [Elastic Load Balancing pricing](https://aws.amazon.com/elasticloadbalancing/pricing/)
- [AWS PrivateLink pricing](https://aws.amazon.com/privatelink/pricing/)
- [Amazon VPC/NAT Gateway pricing](https://aws.amazon.com/vpc/pricing/)
