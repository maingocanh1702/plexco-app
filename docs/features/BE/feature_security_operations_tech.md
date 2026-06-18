# Feature: Security, Reliability & Operations — Engineering/Ops Spec

> **Canonical phase:** Cross-cutting / P6  
> **Version:** 2.0 · 2026-06-19  
> **Status:** Reviewed  
> **Product spec:** `../feature_security_operations.md`  
> **References:** `../../core/TDD.md` §4/6/7/10 · `../../appendices/player-side-saas-AUDIT.md`

---

## 1. Tổng quan triển khai

```text
Environment: dev/staging/prod (separated)
    → IAM: migration / app / worker / read-only roles
    → Secrets: KMS envelope encryption → rotation → kill switch
    → Observability: structured logs → metrics → traces → SLO alerts
    → Backup: managed PITR → restore drills → reconciliation
    → CI gates: unit/integration + RLS invariants + scan + load test
```

Security built throughout all phases. P6 is the **release gate** — final verification, not first implementation.

---

## 2. Database Schema + Edge Cases (BE)

### Security Schema

No new business tables — cross-cutting controls applied to all existing tables.

### Control Areas

| Area | Required | Implementation |
|------|----------|---------------|
| Access | Least privilege DB/cloud roles, MFA, env separation | IAM policies per environment |
| Secrets | KMS envelope encryption, rotation, masking | Central secret service |
| Data | PII consent/encryption/retention/deletion | Redaction middleware |
| Isolation | Tenant/person-self/public invariants in CI | Automated invariant tests |
| Reliability | HA/PITR, queue retry/DLQ, provider degradation | Managed infra + runbooks |
| Observability | Structured redacted logs, metrics/traces, SLO alerts | Logging/monitoring stack |
| Incident | Severity, ownership, containment, postmortem | Runbook templates |
| Assurance | Threat model, scans, pen/load tests | CI/CD gates |

### Edge Cases (Backend)

| # | Category | Case | Xử lý |
|---|----------|------|-------|
| 1 | Security | Cross-tenant read (RLS bypass) | Zero tolerance — CI invariant test + pen-test |
| 2 | Security | Public PII leak | Whitelist enforced — output invariant test |
| 3 | Financial | Wrong payment allocation | Ledger audit trail — reversal path |
| 4 | Security | Identity takeover (merge abuse) | Merge policy constraints + audit |
| 5 | Security | Leaked channel token | Kill switch → rotation → audit |
| 6 | Resilience | Provider/webhook outage | Degrade — queue retry/DLQ |
| 7 | Resilience | Outbox backlog | Alert + DLQ → operator |
| 8 | Resilience | DB corruption/region outage | PITR restore — RPO/RTO |
| 9 | Resilience | Bot rate-limit storm | Backoff — no state corruption |
| 10 | Security | Compromised admin session | Session rotation, MFA, audit |
| 11 | Security | Migration credential in production | ❌ NEVER — separate roles |
| 12 | Security | Log contains PII | ❌ NEVER — structured redaction |

---

## 3. API Contract

### SLO Targets

| Metric | Target | Measurement |
|--------|--------|-------------|
| Sync lag p95 | ≤ 3s | Outbox → delivery |
| Sync lag p99 | ≤ 10s | Outbox → delivery |
| Payment reconcile p99 | ≤ 5s | Webhook → allocation |
| Availability | ≥ 99.5% | Monthly window |

### Operational Requirements

- Production runtime: NO superuser/BYPASSRLS/migration credentials.
- Logs: request/job/tenant opaque IDs only — no secret, OTP, bank, phone, email, message body.
- Alerts: actionable, deduplicated, linked to runbooks.

---

## 4. Chi tiết triển khai

### Secret Rotation

| Secret Type | Rotation | Kill Switch |
|-------------|----------|-------------|
| Telegram bot token | Manual + runbook | Yes — immediate revoke |
| Zalo bot token | Manual + runbook | Yes |
| Provider webhooks | Rotatable | Yes |
| Web session keys | Automatic (30d) | Yes — invalidate all sessions |
| KMS data keys | Automatic | Yes — re-encrypt |

### Backup & Recovery

- Managed HA + PITR with encrypted backups.
- Restore drill: isolated DB → apply roles/policies → schema checksums → reconcile counts (tenants, charges, transactions, allocations, outbox, audit).
- RPO/RTO defined after OD-4 provider choice.

### CI/Release Gates

1. Unit/integration/E2E + RLS/public/person/ledger invariants
2. Migration fresh/upgrade/rollback-forward tests
3. Dependency/license/secret/SAST/container scan
4. DAST against staging
5. Event/schema compatibility checks
6. Load/soak: webhooks, discovery, final-slot contention, queue recovery
7. Manual security approval for: auth, money, identity, public projection, privileged DB

### Incident Runbook Template

```text
1. Trigger/evidence
2. Severity/commander assignment
3. Contain: credentials/feature/provider
4. Preserve: logs/audit (never destroy)
5. Assess: tenants/persons/transactions affected
6. Recover: canonical/PITR/reproject
7. Communicate: policy-based notification
8. Postmortem: root cause + action items
```

Required runbooks: cross-tenant leak, public PII, wrong allocation, identity compromise, token leak, DB restore, provider outage, queue backlog, admin session compromise, marketplace abuse.

---

## 5. Testing Plan

### Security Tests

| # | Test | Input | Expected |
|---|------|-------|----------|
| 1 | RLS bypass attempt | Direct query without tenant context | Blocked |
| 2 | Search_path injection | Malicious search_path | Blocked |
| 3 | SQL injection | Parameterized vs raw | Safe |
| 4 | CSRF bypass | Missing token | Rejected |
| 5 | Session fixation | Pre-auth session | Rotated |
| 6 | Topic guessing | Unauthorized topic | Rejected |
| 7 | OTP enumeration | Brute force | Rate limited |
| 8 | OTP replay | Used OTP | Rejected |
| 9 | Webhook forgery | Fake webhook | Rejected |
| 10 | Webhook replay | Same event | Idempotent |
| 11 | Allocation concurrency | Concurrent allocations | Correct totals |
| 12 | Reversal abuse | Multiple reversals | Policy enforced |
| 13 | Cache privacy | Cached response | No private data |
| 14 | Cursor privacy | Cursor contains data | Opaque/signed |
| 15 | SSRF | Callback URL manipulation | Blocked |
| 16 | Dependency scan | Known CVEs | Flagged |
| 17 | Log PII audit | All log outputs | No PII found |
| 18 | Analytics PII audit | All events | Opaque IDs only |
| 19 | Least privilege grant | DB role permissions | Minimal grants |
| 20 | Container scan | Production image | No vulnerabilities |

### Load Tests

| # | Test | Setup | Expected |
|---|------|-------|----------|
| 1 | 1k tenants concurrent | Parallel sessions/webhooks | SLO met |
| 2 | Webhook burst | 100 webhooks/second | Processed, no corruption |
| 3 | Discovery load | 10k concurrent searches | Latency target met |
| 4 | Join contention | 100 players, 1 slot | Exactly 1 winner |

---

## 6. Rollout Plan + Changelog

### Deployment Strategy

- Immutable build artifact: staging → prod promotion.
- Migrations as controlled job — never rollback irreversible.
- Canary/feature flags for risky adapters.
- Health/readiness checks + automatic rollback criteria.
- Projector/worker deploys support mixed event versions during rollout.

### Pre-launch Checklist

- [ ] Zero critical/high unresolved findings
- [ ] Restore + rotation + incident tabletop completed
- [ ] On-call/owner + runbook links for every alert
- [ ] ToS/Privacy/retention + data-subject request process
- [ ] Production readiness signed by owner

### Changelog

| Date | Version | Thay đổi |
|---|---|---|
| 2026-06-18 | v1.0 | Initial BE tech spec (English format) |
| 2026-06-19 | v2.0 | Chuẩn hoá Vietnamese numbered (6 sections), control areas matrix, secret rotation table, CI gates, 20 tests |
