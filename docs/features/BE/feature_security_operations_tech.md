# Feature: Security, Reliability & Operations — Engineering/Ops Spec

> **Canonical phase:** Cross-cutting / P6
> **Version:** 2.3 · 2026-07-19
> **Status:** Reviewed
> **Implementation:** In progress — RLS/HR1 guard đã thực thi; phần còn lại chưa · authority: `../../standards/BUILD-STATUS.md` (Doc status ≠ Implementation status)  
> **Product spec:** `../feature_security_operations.md`
> **References:** `../../product/TDD.md` §4/6/7/10 · `../../research/player-side-saas-AUDIT.md` · `../../standards/decisions.md` DD-37/DD-65

> **Cập nhật v2.2 (DD-65 ✅, 2026-07-17):** kênh phase-1 = **Zalo + Facebook Messenger**. Messenger secret ownership tách bắt buộc: Page access token là secret **per Page endpoint** trong protected store; Meta App Secret là **một deployment/platform secret** dùng verify webhook cho toàn App. Hai loại có blast radius và runbook riêng.

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

### Migration & Rollback

- **Doc này không own business DDL** ("No new business tables"). Cross-cutting DB controls đã land trên main (migrations `0000`–`0014`): roles/extensions (`0000_roles_extensions.sql`), RLS policies + grants (`0009_rls_policies_grants.sql`), functions/triggers (`0010_functions_triggers.sql`) — **reuse baseline, không recreate; rewrite/`DROP` migration đã apply = ❌ NEVER**.
- Control object mới (role, policy, grant, guard function) → migration mới **monotonic theo next available number sau tail hiện tại của main** (tail hiện là `0014_players_waitlist.sql`), kèm fresh/upgrade/rollback-forward tests theo CI gate #2 (§4).
- **Rollback:** revert theo trình tự disable-trước — tắt release gate/feature flag/canary (§6) → revert migration additive-only (drop policy/grant/function mới). Nới lỏng một RLS policy/grant đã siết là **security regression**, phải qua manual security approval (CI gate #7), không được coi là rollback thường.

### Edge Cases (Backend)

| # | Category | Case | Xử lý |
|---|----------|------|-------|
| 1 | Security | Cross-tenant read (RLS bypass) | Zero tolerance — CI invariant test + pen-test |
| 2 | Security | Public PII leak | Whitelist enforced — output invariant test |
| 3 | Financial | Wrong payment allocation | Ledger audit trail — reversal path |
| 4 | Security | Identity takeover (merge abuse) | Merge policy constraints + audit |
| 5 | Security | Leaked channel/Page token | Revoke/rotate exact endpoint → audit; other endpoints remain valid |
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

### Request/Response Examples

N/A — doc này không own HTTP endpoint/error-code table nào (cross-cutting ops spec; §3 chỉ có SLO + operational requirements). Envelope DD-60 (`../../standards/api-reference-convention.md`) và request/response examples per-endpoint pin ở từng feature BE spec. Yêu cầu cross-cutting duy nhất ở đây: mọi error/log body không chứa secret/OTP/bank/phone/email/message body (§3 Operational Requirements).

### Idempotency

| Endpoint | Idempotent? | Key |
|----------|-------------|-----|
| — (doc không own endpoint) | — | Per-endpoint key pin ở từng feature spec |
| Webhook replay (cross-cutting requirement) | ✅ bắt buộc | Same event → idempotent (§5 Security test #10); key per-provider ở `feature_payment_reconcile_tech.md` §5 |
| Migration job | Forward-only, controlled job (§6) — never rollback irreversible | Per-migration; fresh/upgrade/rollback-forward test ở CI gate #2 (§4) |

---

## 4. Chi tiết triển khai

### Secret Rotation

| Secret Type | Rotation | Kill Switch |
|-------------|----------|-------------|
| Zalo bot token | Manual + runbook | Yes — immediate revoke |
| Messenger Page access token | Per Page endpoint; protected registry row, rotate/revoke exact Page | Disable that Page route only; preserve other Pages |
| Meta App Secret | One deployment/platform secret; coordinated dual-secret verification window then redeploy | Platform-wide webhook containment; never store/rotate per Page |
| Google OAuth client secret | Manual + runbook | Yes — revoke + re-issue |
| Provider webhooks (SePay/ApiPay) | Rotatable | Yes |
| Web session keys | Automatic (30d) | Yes — invalidate all sessions |
| KMS data keys | Automatic | Yes — re-encrypt |

### Backup & Recovery

- Managed HA + PITR with encrypted backups.
- Restore drill: isolated DB → apply roles/policies → schema checksums → reconcile counts (tenants, charges, transactions, allocations, outbox, audit).
- RPO/RTO measured after DO provision + restore/failover drill (DD-04 ✅ (c) — provider chốt; RPO/RTO = build-time gate, không còn blocked bởi provider choice).

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

### Caching Strategy

| Data | Cache? | Lý do |
|------|--------|-------|
| Auth/identity/session state | ❌ | Fail-closed cross-cutting — live checks; chi tiết per-surface ở từng feature spec |
| Cached/public response bất kỳ | Chỉ khi không chứa private data | §5 Security tests #13 (cache privacy) + #14 (cursor opaque/signed) là invariant release-gate |
| Mặc định khi chưa pin | ❌ fail-closed | — |

### Security Checklist (template v2.33 — doc này là authority cross-cutting, trả lời trực tiếp)

| Mục | Trả lời trong spec |
|-----|---------------------|
| Authorization/ownership | §2 Control Areas (Access: least privilege/MFA/env separation); §3 Operational Requirements (runtime không superuser/BYPASSRLS/migration credential); §5 test #19 (least-privilege grant) |
| Injection/validation | §5 tests #2 (search_path) / #3 (SQL injection) / #15 (SSRF); §4 CI gates #3–#4 (SAST/DAST) |
| Secret & log redaction | §2 Secrets area + §4 Secret Rotation (per-Page token vs một Meta App Secret platform); §3: logs = opaque IDs only; §5 tests #17–#18 (log/analytics PII audit) |
| Webhook signature + replay | §5 tests #9–#10 (forgery/replay) là release gate cross-cutting; per-provider contract pin ở feature specs (SePay/ApiPay: `feature_payment_reconcile_tech.md` §3) |
| Idempotency | Bảng Idempotency §3; §5 tests #10–#11 |
| Data retention/xoá | **Gap ghi nhận rõ:** doc này là retention authority mà các BE spec khác trỏ về, nhưng mới pin nguyên tắc (§2 Data area: PII consent/encryption/retention/deletion; §6 pre-launch: ToS/Privacy/retention + data-subject request process). Per-table retention/erasure matrix ⬜ chưa pin — chốt bằng decision/build slice riêng trước launch |

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
| 21 | Messenger Page-token isolation | Rotate/revoke Page A token with Page B active | A outbound fails/recovers after rotation; B remains unaffected; audit scope_ref=A |
| 22 | Meta App Secret rollover | New App Secret deployed with bounded dual-secret window | All Page webhooks verify during rollover; old secret rejected after cutoff; one deployment inventory record/evidence |
| 23 | Secret scope invariant | Attempt per-Page App Secret or deployment-wide Page token record | Validation rejects the wrong scope_kind; no ambiguous combined inventory row |

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
| 2026-07-19 | v2.3 | **Template v2.30/v2.33 uplift:** thêm §2 Migration & Rollback (không own DDL; controls baseline `0000`/`0009`/`0010` reuse, revert qua gate/flag + security approval), §3 Request/Response Examples (N/A có lý do) + Idempotency (cross-cutting), §4 Caching Strategy + Security Checklist (retention gap ghi rõ ⬜). Derivative/editorial — không đổi contract. |
| 2026-07-19 | v2.2a | Metadata sweep (index v2.35): thêm trường **Implementation** đồng bộ BUILD-STATUS (In progress). Không đổi contract. |
| 2026-07-17 | v2.2 | **DD-65 secret ownership:** separate Page-token endpoint rotation from single Meta App Secret platform rollover; add isolation/blast-radius tests and forbid combined inventory rows. |
| 2026-06-18 | v1.0 | Initial BE tech spec (English format) |
| 2026-06-19 | v2.0 | Chuẩn hoá Vietnamese numbered (6 sections), control areas matrix, secret rotation table, CI gates, 20 tests |
| 2026-07-10 | v2.1 | **DD-37 ✅:** secret rotation table — bỏ Telegram bot token; thêm Messenger Page token + FB app secret + Google OAuth client secret (kênh phase-1 Zalo/Messenger). |
