# Feature: Security, Reliability & Operations — Product/UX Spec

> **Canonical phase:** Cross-cutting · Completion gate P6  
> **Track:** 🛡️ Security & Ops  
> **Version:** 2.1 · 2026-07-15<br>
> **Status:** Reviewed  
> **Prerequisites:** All production features  
> **Tài liệu liên quan:** `../product/BRD.md` §8/§13 · `../product/TDD.md` §4/6/7/10 · `../research/player-side-saas-AUDIT.md` · `../standards/business-rules.md` · `BE/feature_security_operations_tech.md`

> **DD-37 reconcile:** secret inventory/kill-switch phase-1 bao gồm Zalo Bot Token, Messenger Page token + Facebook app secret, Google OAuth secret và provider/web/KMS secrets. Telegram token chỉ là legacy runtime tới khi provider swap hoàn tất, không phải target production surface.

---

## 1. Mô tả

Định nghĩa production controls + evidence cho: tenant/public/person isolation, secret/PII handling, audit, availability, backups, observability, load testing, incident response và provider degradation. Security build throughout — P6 là **release gate**, không phải first implementation point.

### Bất biến

- Production runtime **KHÔNG BAO GIỜ** dùng superuser/BYPASSRLS/migration credentials.
- Logs chứa opaque IDs — **KHÔNG** secret, OTP, raw bank content, phone/email, message body.
- Financial/merge audit records **immutable** — không xoá/sửa.

---

## 2. Use Cases + Edge Cases

### Use Cases

| ID | Actor | Hành động | Kết quả |
|---|---|---|---|
| SEC-UC-1 | System | Runtime DB connection | Least privilege role — no superuser/BYPASSRLS |
| SEC-UC-2 | System | Secret rotation (Zalo/Messenger/Google/provider/web/KMS) | Tested kill switch — no downtime |
| SEC-UC-3 | Ops | PITR restore drill | Restore to isolated env → reconcile ledger/audit counts |
| SEC-UC-4 | System | Structured logging | Redacted — opaque IDs, no PII |
| SEC-UC-5 | System | SLO monitoring | Sync p95≤3s, payment p99≤5s, availability ≥99.5% |
| SEC-UC-6 | Ops | Incident response | Severity → ownership → containment → notification → postmortem |
| SEC-UC-7 | System | CI/CD security gate | Dependency scan, SAST/DAST, container scanning |
| SEC-UC-8 | Ops | Pen-test: public marketplace | Enumeration, RLS bypass, auth/session abuse |
| SEC-UC-9 | Ops | Load test | 1k tenants, webhook bursts, discovery contention |
| SEC-UC-10 | System | Data subject request (GDPR-like) | PII consent/encryption/retention/deletion process |

### Edge Cases

| # | Category | Case | Hành vi bắt buộc |
|---|----------|------|-------------------|
| 1 | Security | Cross-tenant read (RLS bypass) | Zero tolerance — CI invariant test, pen-test |
| 2 | Security | Public PII leak (marketplace) | Whitelist enforced — pen-test |
| 3 | Financial | Wrong payment allocation | Ledger audit trail — reversal/correction path |
| 4 | Security | Identity takeover (merge abuse) | Merge policy constraints — audit trail |
| 5 | Security | Leaked channel token (Zalo/Messenger) | Kill switch → rotation → audit |
| 6 | Resilience | Provider/webhook outage | Degrade gracefully — queue retry/DLQ |
| 7 | Resilience | Outbox backlog | Alert + DLQ → operator intervention |
| 8 | Resilience | DB corruption/region outage | PITR restore — RPO/RTO defined |
| 9 | Resilience | Bot rate-limit storm | Backoff — no canonical state corruption |
| 10 | Security | Compromised admin session | Session rotation, MFA, audit trail |
| 11 | Security | Log contains PII | ❌ NEVER — structured redaction enforced |
| 12 | Security | Migration credential used in production | ❌ NEVER — separate roles enforced |

---

## 3. Screens & States

| Surface | Screen | Loading | Ready | Error | Empty |
|---------|--------|---------|-------|-------|-------|
| Web (Admin) | Security dashboard | Skeleton | SLO metrics, last backup, secret rotation status | Alert banner | N/A |
| Web (Admin) | Audit log viewer | Skeleton table | Filterable audit entries | Error banner | "Chưa có audit log" |
| Web (Admin) | Incident status page | — | Current incidents + status | — | "Không có sự cố" |

> Most security screens are internal/ops — not exposed to host/player.

---

## 4. Domain Model

| Entity | Vai trò | Key constraints |
|--------|---------|-----------------|
| `audit_log` | Immutable action trail | `APPEND ONLY`, `actor_id`, `action`, `aggregate`, `timestamp` |
| `secret_inventory` | Secret metadata (not values) | `type`, `last_rotated_at`, `expires_at` |
| `incident_log` | Incident records | `severity`, `status`, `owner`, `resolved_at` |

### Control Areas Matrix

| Area | Required outcome | Phase |
|------|-----------------|-------|
| Access | Least privilege DB/cloud/provider roles; MFA, env separation | P0+ |
| Secrets | KMS envelope encryption, rotation, masking, no logs | P0+ |
| Data | PII consent/encryption/retention/deletion; immutable financial/merge audit | P3+ |
| Isolation | Automated tenant, person-self, public invariants in CI | P0+ |
| Reliability | HA/PITR, restore drill, queue retry/DLQ, provider degradation | P4+ |
| Observability | Structured redacted logs, metrics/traces, SLO alerts | P2+ |
| Incident | Severity, ownership, containment, notification, postmortem runbooks | P6 |
| Assurance | Threat model, dependency scan, SAST/DAST, pen/load tests | P6 |

---

## 5. Analytics Events

| Event | Khi nào | Payload tối thiểu |
|-------|---------|-------------------|
| `security_secret_rotated` | Secret rotation completed | `secret_type`, `success` |
| `security_rls_invariant_failed` | CI invariant test fail | `test_name`, `failure_detail` |
| `security_incident_opened` | New incident created | `severity`, `category` |
| `security_restore_drill` | Backup restore test | `success`, `rpo_actual`, `rto_actual` |
| `security_pen_test_completed` | Pen-test round done | `scope`, `findings_count` |

---

## 6. Acceptance Criteria

- [ ] Zero known critical tenant/public/person isolation paths
- [ ] Secret inventory/rotation/kill-switch drills pass
- [ ] PITR restore drill meets defined RPO/RTO + ledger reconciliation
- [ ] SLO dashboards/alerts/runbooks cover API, webhook, queue, projector, provider
- [ ] Load tests: 1k tenants, webhook bursts, discovery + join contention
- [ ] Pen-tests: public enumeration, RLS bypass, auth/session, OTP/merge, ledger abuse
- [ ] Dependency/SAST/DAST/container scanning gates CI/release
- [ ] Incident + privacy request tabletop exercises complete
- [ ] Production readiness checklist signed by owner

---

## 7. Open Questions / Changelog

### Open Questions

| ID | Quyết định | Trạng thái |
|---|---|---|
| SEC-OQ-1 | Hosting/provider selection → final RPO/RTO + KMS implementation | ✅ Provider chốt **DD-04 (c) DO co-locate**; RPO/RTO + KMS wiring = **build-time gate** (đo sau provision + restore/failover drill) → `../dd-04-hosting-final-decision.md` |
| SEC-OQ-2 | VN legal retention periods + incident notification obligations | ⬜ Chưa chốt |

### Changelog

| Date | Version | Thay đổi |
|---|---|---|
| 2026-07-15 | v2.1 | **DD-37 closure:** target secret rotation/kill-switch = Zalo + Messenger + Google/provider/web/KMS; Telegram chỉ legacy runtime tới provider swap. |
| 2026-06-18 | v1.0 | Initial spec (English format) |
| 2026-06-19 | v2.0 | Chuẩn hoá Vietnamese numbered, thêm 10 use cases, 12 edge cases, control areas matrix |
