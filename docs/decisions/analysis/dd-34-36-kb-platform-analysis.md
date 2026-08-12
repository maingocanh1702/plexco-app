# DD-34/35/36 — KB platform, derived content and freshness

> **Status:** approve-in-principle directions for P7; exact reopen evidence below is required before implementation authority. DD-21 remains canonical until the relevant decision is promoted.
> **Reconciled:** 2026-08-12.

## 1. DD-34 — global Plexco KB plane

Direction: a grant-isolated `platform_kb_*` plane, with no `tenant_id`, writable only by platform-admin. App runtime is SELECT-only through an exact active/reviewed read surface; it has no DML and no read path to draft/quarantine/unreviewed raw content. Tenant retrieval may later union tenant KB with reviewed platform KB, while preserving scope labels, tenant isolation and club-over-platform precedence.

Because every tenant can read this plane, absence of `tenant_id` is not an ingest guard. Activation needs a canonical platform-doc source owner, source allowlist, admin review and DLP/tenant-identifier scanner. Platform content must never contain tenant documents, roster, ledger, `pay_code`, phone/email or other tenant PII.

**Reopen trigger:** Assistant storage/profile/index/retrieval owners have merged probes on the default branch and the owner has selected the canonical platform-content source plus activation authority. Reopen immediately before the first `platform_kb_*` migration or before expanding `searchKnowledgeBase` to a union read.

## 2. DD-35 — derived club KB

Direction: `kind='derived'` is an idempotent read model built through canonical command/outbox/projector flow, keyed deterministically and content-hashed. Host-manual content has explicit precedence and can disable each derived area.

Do **not** author a whitelist from current UI labels or aspirational proposal nouns. A field becomes eligible only when it has a canonical schema, one mutation owner, a source event and an explicit non-PII review. Ledger, memberships, persons, roster, contact identifiers, `pay_code`, balances and live session state remain forbidden; live operational context belongs to DD-28 tools, not KB.

**Reopen trigger:** canonical club-profile fields, sole mutation owner and exact non-PII outbox events have merged, and Assistant text-ingest/profile activation has an owner. Reopen immediately before authoring the first derived projector and enumerate only then-verifiable fields.

## 3. DD-36 — freshness and recrawl

Direction: platform-doc changes and allowed URL sources can be refreshed with content-hash/ETag change detection and a bounded scheduler. Fetch/provider calls remain outside authoritative transactions; new revisions pass the same DLP/profile activation path as initial ingest.

Serving state and sync-attempt state are separate:

- a failed fetch **before a new revision exists** keeps the last serving generation `active` and records `last_sync_status='error'`, bounded error code, attempt time and retry metadata;
- once a changed revision is fetched and accepted into canonical ingest, the existing generation contract wins: prior document/chunks are atomically `superseded` before processing. DLP/index/activation failure leaves the new current generation blocked/error with zero retrieval and **never** falls back to the old generation;
- `source.status` is not overloaded for the pre-revision fetch attempt. Last-good preservation ends at the explicit boundary where a new content hash is accepted into `kb.ingest`; DD-36 does not create a staged serving pointer or second activation state machine.

**Reopen trigger:** URL-ingest adapter has merged SSRF/redirect/size/content-hash tests; generation/CAS, profile activation and scheduler substrate have merged. Reopen immediately before the scheduled recrawl producer. Platform-doc refresh also waits for DD-34 source ownership.

## 4. Cross-cutting acceptance

- Platform app role cannot write or read inactive/unreviewed content; global content scanner and tenant-isolation fixtures pass.
- Derived document fields are a closed, reviewed set tied to live canonical owners/events; non-whitelist changes emit no derived update.
- Refresh is idempotent; pre-revision fetch retries never deactivate the last good generation. After a changed revision is accepted, canonical fail-closed supersession applies; stale worker/CAS cannot activate an older revision/profile or restore it as fallback.
- DD-21 is amended in the same decision/slice that expands allowed grounding sources—never pre-emptively.

## 5. Status boundary

These directions reduce future redesign but confer no implementation authority; readiness stays owned by the review-readiness gate and the enforced primary plan. Exact schema, grants, workers and retrieval changes wait for the binary triggers above.
