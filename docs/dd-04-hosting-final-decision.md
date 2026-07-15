# DD-04 Final Decision — Co-locate compute + PostgreSQL on DigitalOcean

> **Status:** ✅ Accepted<br>
> **Decision date:** 2026-07-16<br>
> **Owner:** Founder<br>
> **Scope:** production compute, PostgreSQL hosting, network posture, and planning cost<br>
> **Supersedes:** recommendation `(a) giữ Fly + public TLS` in
> [`dd-04-hosting-decision-brief.md`](dd-04-hosting-decision-brief.md). Provider facts and hard gates in
> that brief remain useful; this record is the final choice.

## 1. Decision

Choose **QĐ-1 (c): co-locate compute and database on DigitalOcean in Singapore**:

- **Compute:** DigitalOcean App Platform, one immutable image deployed as three component types:
  `web`, `discovery`, and `worker`.
- **Database:** DigitalOcean Managed PostgreSQL, **HA cluster with at least one standby node**.
- **Network:** App Platform and PostgreSQL connect through the same DigitalOcean VPC in `sgp`/`sgp1`;
  PostgreSQL is restricted to trusted sources on that private network.
- **Database security remains defence-in-depth:** TLS hostname/CA verification, four least-privilege DB
  roles, separate pooled and direct/session connection strings, and no migration credential in runtime
  components.
- **Region:** Singapore for both compute and database.

This is the highest-benefit option for Plexco because it combines private DB connectivity, managed
failover, predictable operations, and one provider boundary. It costs more than the cheapest Fly
topology, but cost is not the deciding criterion for a multi-tenant money system.

This decision changes the deployment target currently represented by [`infra/fly.toml`](../infra/fly.toml).
It does **not** reverse DD-10: DD-10 chooses Next.js App Router, standalone containers, and no Vercel; it
does not canonically require Fly.io.

## 2. Hard requirements preserved

1. Managed PostgreSQL with automatic failover, PITR, and contractual uptime SLA.
2. Singapore region.
3. Transaction-pooled URL for request traffic plus direct/session URLs for SSE `LISTEN/NOTIFY` and
   pg-boss workers.
4. Four connection-level roles with least privilege: runtime web, discovery/readonly, worker, and
   migration.
5. RLS and money paths remain fail-closed.
6. PostgreSQL portability: no provider-exclusive data model or business logic.
7. Restore drill, failover drill, and reconnect validation before production acceptance.

## 3. Cost-estimate assumptions

All figures are **USD/month, list price, planning estimates as of 2026-07-16**.

| Assumption | Value used |
|---|---|
| Billing month | 730 hours |
| Current process topology | `web` + `discovery` + `worker` |
| Minimum topology | One instance/container per process; useful for smoke/early staging, not HA compute |
| Production compute topology | Two `web`, two `discovery`, one or two `worker` instances |
| DO database | 2 GiB/1 vCPU primary `$30` + matching standby `$30` |
| Neon database | Scale plan, always on; average `0.25–0.5 CU`; 10 GB active storage + 10 GB history |
| AWS strict-private topology | Six Fargate tasks across two AZs, each `0.25 vCPU / 0.5 GB`; one ALB; PrivateLink in two AZs; one or two NAT gateways |
| Excluded | VAT/tax, paid support, third-party API fees, object storage, large log volume, migration labour, credits/discounts, and unusual data transfer |

These numbers are not a traffic forecast. Tenant count does not map directly to RAM/CU; production
sizing must come from staging load tests and observed connection counts.

## 4. Option comparison

| Option | Estimated monthly cost | Network posture | Operational shape | Decision |
|---|---:|---|---|---|
| **(a) Fly + DO Managed PostgreSQL** | **~`$76` minimum; `~$88` with two Fly machines per process** | Public internet, TLS verify-full, static-IP allowlist | Two providers; flat DB bill | Bounded fallback only |
| **(a) Fly + Neon Scale** | **~`$62–74` at 0.25 CU; `~$102–114` at 0.5 CU** | Public internet, TLS verify-full, static-IP allowlist | Two providers; variable DB bill; always-on tuning | Not chosen |
| **(b) AWS Fargate + Neon PrivateLink** | **~`$210–330` planning range** | Strict private DB path | Most moving parts: ECS, ALB, NAT, endpoints, CloudWatch, Neon | Not chosen |
| **(c) DO App Platform + DO Managed PostgreSQL** | **`~$75` minimum; `~$120–132` production baseline** | Private VPC | One provider; managed compute + managed DB | **Selected** |
| Supabase Enterprise | Quote required | PrivateLink requires AWS VPC | Enterprise contract and extra provider boundary | Not cost-comparable |

The minimum figures are not equivalent to production HA. For the selected option, budget against
**`$120–132/month`**, then add contingency for logs, support, outbound transfer, and later read replicas.

## 4.6 Scale-tier planning estimates (100 / 1000 / 2000 hosts)

> ⚠️ **These are planning estimates, not benchmarked.** Tenant count does **not** map linearly to
> RAM/CU (see §3). The database is a **step-function** (2→4→8→16 GiB doubles each step, then ×2 again for
> HA), so the higher tiers carry the most uncertainty. Final sizing must come from staging load tests.
> DO prices verified 2026-07-16 (Basic shared-CPU tier); Fly/Neon/AWS anchors from §5.

**Selected option (c) — DigitalOcean co-locate, USD/month (compute App Platform + DO Managed PG HA + misc/logs/offsite-backup):**

| Item | 100 hosts | 1000 hosts | 2000 hosts |
|---|---|---|---|
| Compute (App Platform) | 2 web + 2 disc + 1 worker ≈ **$60–72** | 3–4 each + 2 worker ≈ **$100–150** | more/larger (2 GiB) instances ≈ **$150–250** |
| Database (Managed PG HA) | 2–4 GiB ≈ **$61–122** | 8 GiB ≈ **$244** (+ read replica $61–122) | 16 GiB ≈ **$489** (+ replica $122–244) |
| Transfer + logs + **offsite backup** | ~**$10–25** | ~**$25–50** | ~**$40–80** |
| **Total ≈** | **$130–220** | **$370–570** | **$700–1,100** |

**Cross-topology comparison (same tiers, total ≈ USD/month incl. HA + misc):**

| Topology | Network posture | Ops (solo dev) | 100 | 1000 | 2000 |
|---|---|---|---:|---:|---:|
| (a) Fly + Neon Scale | Public TLS + IP-allow | 2 providers + CU tuning | ~$72–134 | ~$235–470 | ~$460–900 |
| (a) Fly + DO Managed PG | Public TLS + IP-allow | 2 providers, flat DB | ~$90–170 | ~$310–490 | ~$720–930 |
| **(c) DO co-locate [SELECTED]** | **Private VPC** | **1 provider (simplest)** | **~$130–220** | **~$370–570** | **~$700–1,100** |
| (b) AWS Fargate + Neon PrivateLink | Strict private | Most layers (ECS/ALB/NAT/endpoint) | ~$210–330 | ~$400–700+ | ~$700–1,300+ |
| Supabase Enterprise | PrivateLink (AWS VPC) | Enterprise contract | quote (~$600+ base) | quote | quote |

**Reading the comparison:**
- DB cost is identical for (a)-DO and (c); the (c) premium over (a) Fly+DO (~$40–130/mo) is **almost entirely
  App Platform compute** being pricier per GiB than a Fly machine. That premium buys private-DB-by-construction
  + one provider + `LISTEN/NOTIFY` session-pool fit. Cost is not the deciding criterion for a money system.
- Neon is cheapest at low load but **consumption-variable** ($0.222/CU-hr always-on: 0.25 CU $40 → 1 CU $162
  → 2–4 CU $324–648) with a public path and AWS-only PrivateLink.
- AWS (b) is expensive due to the base fabric (ALB + NAT + endpoints) before compute/DB, with no product
  benefit for single-region Plexco.

**Caveats (apply to all options):**
- DB figures use **Basic shared-CPU**. At 1000–2000 hosts a money system may need **General Purpose (dedicated
  CPU) → ~2× the DB price** — the single largest variable at the high tiers.
- HA = ×2. Read replicas for discovery/marketplace reads are extra at 1000+. Excludes VAT, paid support, object
  storage, unusual egress, migration labour.

**Compute-cost optimization (for the infra slice):** if App Platform compute becomes the cost driver at ~2000
hosts, move compute to **DO Droplets or DOKS in the same VPC** — cheaper per GiB than App Platform while keeping
the private-DB path and one-provider boundary. This preserves the (c) intent and only changes the compute layer.

**Sources:** [DO Managed Databases pricing](https://www.digitalocean.com/pricing/managed-databases) ·
[DO PostgreSQL HA pricing](https://docs.digitalocean.com/products/databases/postgresql/details/pricing/) ·
[Fly.io pricing](https://fly.io/docs/about/pricing/) · [Neon pricing](https://neon.com/pricing) · §5 below.

## 5. Estimate detail

### 5.1 Option (a) — Fly + DigitalOcean Managed PostgreSQL

Current Singapore Fly size in `infra/fly.toml` is `shared-cpu-1x / 512 MB`, listed at `$4.05/month` per
running machine.

| Item | Minimum | Two machines/process |
|---|---:|---:|
| Fly compute | `3 × $4.05 = $12.15` | `6 × $4.05 = $24.30` |
| Fly static egress IP | `$3.60` | `$3.60` |
| DO PostgreSQL primary + standby | `$60.00` | `$60.00` |
| **Estimated total** | **`$75.75`** | **`$87.90`** |

Not included: Fly Asia-Pacific public egress at `$0.04/GB` under granular bandwidth pricing, paid
support, logs, or larger machines. This is the cheapest predictable managed-HA fallback if App Platform
VPC proves incompatible with a hard outbound-network requirement.

### 5.2 Option (a) — Fly + Neon Scale

Neon Scale compute is `$0.222/CU-hour`. Always-on is required because pg-boss and SSE listeners cannot
depend on scale-to-zero behaviour.

| Item | 0.25 CU average | 0.5 CU average |
|---|---:|---:|
| Neon compute | `0.25 × 730 × $0.222 = $40.52` | `0.5 × 730 × $0.222 = $81.03` |
| 10 GB storage + 10 GB history | `$3.50 + $2.00 = $5.50` | `$5.50` |
| Fly compute + egress IP, minimum topology | `$15.75` | `$15.75` |
| **Total, minimum topology** | **`$61.77`** | **`$102.28`** |
| Fly compute + egress IP, two machines/process | `$27.90` | `$27.90` |
| **Total, two machines/process** | **`$73.92`** | **`$114.43`** |

At an average 1 CU, Neon compute alone is `$162.06/month`. Neon can be cheaper at its floor, but its
bill and capacity ceiling require benchmark-driven min/max-CU tuning. Its SLA applies to Compute
Endpoints, and its PrivateLink path is AWS-only, so Fly still uses public TLS + IP allowlisting.

### 5.3 Option (b) — AWS Fargate + Neon PrivateLink

Planning model for Singapore (`ap-southeast-1`):

| Item | Estimate |
|---|---:|
| Six Fargate tasks (`1.5 vCPU + 3 GB` total) | `$67.47` |
| Application Load Balancer + assumed 1 LCU | `$24.24` |
| Interface VPC endpoint in two AZs | `$18.98` |
| One or two NAT gateways, before data processing | `$43.07–86.14` |
| Neon Scale at 0.25–0.5 CU + 10 GB storage/history | `$46.02–86.53` |
| CloudWatch/ECR/public IPv4/data allowance | `$10–40` |
| **Planning total** | **`~$210–330`** |

Rate anchors used: Fargate `$0.05056/vCPU-hour` + `$0.00553/GB-hour`; ALB `$0.0252/hour` +
`$0.008/LCU-hour`; interface endpoint `$0.013/AZ-hour` + `$0.01/GB`; NAT gateway `$0.059/hour` +
`$0.059/GB`. A final AWS estimate must be regenerated in AWS Pricing Calculator with real traffic,
logging, public IPv4, and AZ choices.

This option buys strict-private DB connectivity but introduces the largest operational surface and the
highest cost variance. It has no compensating product benefit for the current single-region Plexco
architecture.

### 5.4 Option (c) — DigitalOcean App Platform + DO Managed PostgreSQL

| Topology | Compute | Database | Estimated total |
|---|---:|---:|---:|
| Minimum: one 512 MiB `$5` container per component | `3 × $5 = $15` | `$60` | **`$75`** |
| Production baseline: 2 web + 2 discovery + 1 worker on scalable 1 GiB `$12` plan | `5 × $12 = $60` | `$60` | **`$120`** |
| Production baseline with 2 workers | `6 × $12 = $72` | `$60` | **`$132`** |

The `$5` and fixed `$10` App Platform plans do not support manual horizontal scaling; the production
budget therefore uses the scalable 1 GiB `$12` plan. Additional App Platform outbound transfer is
`$0.02/GiB` after the pooled allowance. DigitalOcean states that traffic to/from Managed Databases does
not count against bandwidth billing transfer allowance.

Use two workers only after job idempotency and pg-boss concurrency have been verified. Otherwise keep
one worker and treat worker recovery time as an explicit operational SLO.

## 6. Why option (c) maximizes project benefit

1. **Security:** the DB path is private by construction; public exposure is not the steady-state design.
2. **Money correctness:** managed standby failover, 99.95% database SLA, PITR, and one-provider incident
   boundary reduce the number of failure modes around writes and reconnects.
3. **Maintainability:** one account, one region, one VPC, one billing surface, and no AWS NAT/endpoint/ECS
   layer for a small team.
4. **Architecture fit:** Plexco already needs long-lived worker and listener connections. DO Managed
   PostgreSQL supports session-mode pooling for `LISTEN/NOTIFY`, without a scale-to-zero lifecycle.
5. **Timing:** the checked-in Fly configuration is still a P0 template, so changing the deployment target
   before production and feature-layer rollout is materially cheaper than migrating later.
6. **Portability:** the application remains a standalone container using standard PostgreSQL contracts;
   leaving DigitalOcean later does not require rewriting business logic.

Accepted cost: the production baseline is approximately `$32–56/month` above Fly + DO at the small
sizes modelled here. That premium buys a private DB path and simpler operations; it is intentional.

## 7. Risks and acceptance gates

### 7.1 Hard gate: VPC versus dedicated egress IP

DigitalOcean App Platform currently cannot enable VPC network access and dedicated egress IPs at the
same time. Before implementation, verify whether Zalo, Messenger, SePay, ApiPay, or any other production
dependency requires a fixed outbound source IP.

- If none requires it, proceed with option (c).
- If one requires it, **do not silently disable the private DB path**. Use option `(a) Fly + DO` as the
  bounded fallback, or separately design a DO compute substrate with both private DB access and controlled
  egress.

**Verify checklist (clear before infra slice):**

| Dependency | Question to answer | Nguồn xác minh |
|---|---|---|
| **SePay** | Outbound API call Plexco→SePay có allowlist theo IP nguồn không? Webhook inbound có yêu cầu IP cố định để verify không? | SePay partner docs/support; connector spike CO-OQ-2/3/7 |
| **ApiPay** | Enterprise auto-provision (DD-30) có ràng buộc source-IP cho API call không? | ApiPay enterprise onboarding |
| **Zalo Bot** | Gọi Zalo send API có cần fixed egress IP không (thường token-based → không)? | Zalo Bot API docs; DD-14/15 spike |
| **Messenger (Meta)** | Graph API call có allowlist IP không (thường không)? | Meta docs |
| **Kết luận** | Bất kỳ "có" → outbound cần fixed IP → **(c) as-is gãy** → fallback (a) Fly+DO hoặc DO substrate riêng có cả private-DB + controlled egress | — |

### 7.2 Accepted risk: provider and region concentration

Co-locating compute and database reduces network and operating complexity, but a DigitalOcean regional
or control-plane incident can affect both layers. Day-1 accepts that concentration instead of buying the
AWS operating surface. Mitigation is mandatory: tested PITR, encrypted logical exports outside the
production account/provider, an immutable container image, and a documented restore-to-another-Postgres
runbook.

### 7.3 Production acceptance checklist

- App Platform is deployed in `sgp` and connected to the correct `sgp1` VPC.
- PostgreSQL trusted sources contain only the application VPC/private identity required by the design.
- All four DB roles and all pooled/direct connection strings are validated on the private route.
- TLS CA + hostname verification remains enabled on private connections.
- Primary-failure drill proves automatic DB failover and application reconnection.
- SSE listeners re-subscribe after connection loss; pg-boss resumes without duplicate money mutations.
- PITR restore drill proves the chosen RPO/RTO; a backup without a tested restore is not accepted.
- Edge caching is disabled for SSE routes.
- Two-instance `web` and `discovery` topology passes health-check and rolling-deploy tests.
- Worker horizontal scaling is enabled only after idempotency and duplicate-delivery tests are green.
- Staging load tests measure peak connections, latency, CPU/RAM, and DB saturation before final sizing.
- Monthly budget alerts cover compute, database, outbound transfer, and logs.

## 8. Consequences and required propagation

> **Status (2026-07-16):** record accepted as canonical. **DOCS propagation ✅ done; INFRA build ⬜ pending (gated on §7.1).**

1. ✅ **DONE** — DD-04 in [`standards/decisions.md`](standards/decisions.md) → **Accepted (v1.32)**, links this record.
2. ✅ **DONE (docs)** — Fly-specific production wording reframed in BRD OD-4 · TDD · [`standards/deployment-infra.md`](standards/deployment-infra.md) (§2 + TL;DR + cost) · security specs; [`standards/environments-setup.md`](standards/environments-setup.md) got a superseded banner. ⬜ **environments-setup full DO runbook rewrite = infra slice.**
3. ⬜ **PENDING (infra slice)** — Create the DigitalOcean App Spec; do not hand-convert `fly.toml` during a docs-only change. **Gate: §7.1 egress-IP verify must pass first.**
4. ⬜ **PENDING** — Mark `infra/fly.toml` as superseded or remove it only when the DO deployment path is verified.
5. ⬜ **PENDING** — Record measured staging costs and replace planning estimates before procurement/launch sign-off.

## 9. Sources

### DigitalOcean

- [App Platform pricing](https://docs.digitalocean.com/products/app-platform/details/pricing/)
- [App Platform VPC support and dedicated-egress incompatibility](https://docs.digitalocean.com/products/app-platform/how-to/enable-vpc/)
- [App Platform SLA — 99.95% per component instance](https://www.digitalocean.com/sla/app-platform)
- [Managed PostgreSQL pricing](https://docs.digitalocean.com/products/databases/postgresql/details/pricing/)
- [Managed Databases SLA — 99.95% with standby](https://www.digitalocean.com/sla/databases)
- [PostgreSQL PITR restore](https://docs.digitalocean.com/products/databases/postgresql/how-to/restore-from-backups/)
- [PostgreSQL connection pools; session mode supports LISTEN/NOTIFY](https://docs.digitalocean.com/products/databases/postgresql/how-to/manage-connection-pools/)

### Fly, Neon, Supabase

- [Fly.io compute, egress, and static-egress-IP pricing](https://fly.io/docs/about/pricing/)
- [Neon pricing](https://neon.com/pricing)
- [Neon SLA](https://neon.com/sla)
- [Neon network transfer](https://neon.com/docs/introduction/network-transfer)
- [Supabase pricing; uptime SLA is Enterprise](https://supabase.com/pricing)

### AWS Singapore price anchors

- [AWS Fargate pricing](https://aws.amazon.com/fargate/pricing/)
- [Elastic Load Balancing pricing](https://aws.amazon.com/elasticloadbalancing/pricing/)
- [AWS PrivateLink pricing](https://aws.amazon.com/privatelink/pricing/)
- [Amazon VPC/NAT Gateway pricing](https://aws.amazon.com/vpc/pricing/)
- Official `ap-southeast-1` public price lists:
  [ECS](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonECS/current/ap-southeast-1/index.json),
  [ELB](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSELB/current/ap-southeast-1/index.json),
  [VPC](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonVPC/current/ap-southeast-1/index.json),
  [EC2/NAT](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonEC2/current/ap-southeast-1/index.json)
