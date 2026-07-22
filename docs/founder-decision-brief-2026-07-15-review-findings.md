<!-- review-readiness: historical -->
# Review findings — Founder decision brief 2026-07-15

> **Target:** `docs/founder-decision-brief-2026-07-15.md`
> **Review date:** 2026-07-15
> **Scope:** Review-only against the current working tree, canonical decisions, feature specs, schema/migrations, and current provider/legal sources.
> **Closure update:** 2026-07-15, target rev 4.
> **Verdict:** **REMEDIATED FOR FOUNDER/LEGAL REVIEW.** The findings below are retained as the historical review record; they no longer describe unresolved defects in rev 4. Founder/legal decisions and canonical propagation remain pending by design.
> **Supersession note (DD-49, 2026-07-16):** F-04's “genuine rejoin remains fail-closed” records the reviewed pre-decision brief, not the current contract. DD-49 now routes rejoin through common join + proven carry-over/refunded disposition; only unknown/unimplemented disposition fails closed with `REJOIN_REQUIRES_REVIEW`.

## Closure map — target rev 4

| Finding | Status | Rev 3/4 closure |
|---|---|---|
| F-01 | ✅ Addressed | Current Law 91/2025 + Decree 356/2025 baseline; gender/DOB provisionally mapped from Decree 356 Article 3 to basic personal data, without treating that mapping as legal advice; Vietnamese counsel confirmation and article-level review remain go-live gates |
| F-02 | ✅ Addressed | Per-data-class erasure/anonymization; retain opaque person anchor + immutable ledger/audit; no whole-Person hard-delete |
| F-03 | ✅ Addressed | `PlatformAdmin` only; seven-day maximum; mandatory reason/ticket/expiry/audit; auto-expire and escalation SLA |
| F-04 | ✅ Addressed | Three explicit tables; canonical charge/allocation vocabulary; external cash versus ledger split; genuine rejoin remains fail-closed |
| F-05 | ✅ Addressed | Pricing fallback separated from DD-41 eligibility gating |
| F-06 | ✅ Addressed | Player-request and host-invite coexist; reliability/manual bans separated; no automatic roster/queue eviction |
| F-07 | ✅ Addressed | Interfaces marked spec-only/not implemented; chat and embedding providers scored independently |
| F-08 | ✅ Addressed | DD-34/35/36 explicitly deferred with owner, trigger, and promotion gate |

> Rev 3 additionally corrected the logical billing plan key (`free`, with legacy `free_web` pending migration), conditioned DigitalOcean's 99.95% SLA on a standby node, scoped Neon's multi-AZ claim to storage and its 99.95% SLA to Compute Endpoints, and split founder-review readiness from post-decision propagation.
>
> Rev 4 closes operational follow-ups from the full-doc recheck: DD-04 governance wording no longer asks to reopen an already-reopened decision; identity/account recovery is a founder+security gate; remaining OQs are classified as founder, delegated build-time, or external verification.

## Findings

> Historical findings below document why rev 1/rev 2 were not ready. “Required closure” describes the work completed in rev 3; rev 4 adds the operational closure noted above.

### F-01 — [P0] Vietnam privacy-law baseline is outdated

**Problem**

The brief treats Decree 13/2023/NĐ-CP as the current legal baseline. As of 2026-01-01, Law 91/2025/QH15 and Decree 356/2025/NĐ-CP are effective; Decree 356 states that Decree 13/2023/NĐ-CP expired on that date.

The current recommendation therefore cannot safely pin retention, sensitive-data consent, cross-border processing, or incident-notification obligations.

**Evidence**

- Target: `docs/founder-decision-brief-2026-07-15.md:110-115`.
- Official Law 91/2025/QH15: <https://vbpl.moj.gov.vn/bocongan/Pages/vbpq-thuoctinh.aspx?ItemID=179252&Keyword=>
- Official Decree 356/2025/NĐ-CP: <https://vbpl.vn/TW/Pages/vbpq-toanvan.aspx?ItemID=187276>

**Required closure**

- Replace the legal baseline with Law 91/2025/QH15 and Decree 356/2025/NĐ-CP.
- Obtain Vietnamese legal review for the exact retention matrix, sensitive-data basis/consent, cross-border transfer filing, and applicable notification deadlines.
- Do not convert a generic “PDPD deadline” into an engineering requirement without an article-level legal mapping.

### F-02 — [P1] Thirty-day hard-delete conflicts with the data model and financial-audit contract

**Problem**

The proposed `hard-delete after 30 days` is not compatible with the live relational model. `persons.id` is referenced by many tables, without a cascade policy that would make whole-person deletion safe. Deleting the row would either fail or require destructive rewrites of identity, membership, payment, and audit history.

The canonical user-settings contract instead requires PII anonymization while preserving financial audit.

**Evidence**

- Target: `docs/founder-decision-brief-2026-07-15.md:112-115`.
- Live contract: `packages/db/schema.ts` — multiple foreign keys reference `persons.id`.
- Canonical product rule: `docs/features/feature_user_settings.md:70,127` — anonymize PII without breaking financial audit.

**Required closure**

- Replace whole-Person hard-delete with a per-data-class retention and erasure matrix.
- Erase/anonymize eligible PII while retaining an opaque person anchor and immutable ledger/audit records where legally required.
- Define grace period, legal hold, backups, derived data, and deletion-verification behavior separately.

### F-03 — [P1] Billing override grants the wrong actor and omits expiry semantics

**Problem**

The brief proposes manual override by `owner/admin`. The canonical security contract restricts billing override to `PlatformAdmin`, and requires it to be privileged, temporary, audited, and auto-expiring.

The brief asks for an override SLA but does not actually decide the maximum duration, expiry behavior, or escalation path.

**Evidence**

- Target: `docs/founder-decision-brief-2026-07-15.md:55-58`.
- Canonical security rule: `docs/features/feature_billing_lifecycle.md:71`.
- Technical endpoint contract: `docs/features/BE/feature_billing_lifecycle_tech.md:138,158,248` — `PlatformAdmin`, required expiry, auto-expire.
- Database policy: `packages/db/migrations/0007_billing.sql` — platform-admin-only override path.

**Required closure**

- Keep override restricted to `PlatformAdmin`; do not grant it to tenant owner/admin.
- Decide maximum override duration, mandatory reason/ticket reference, auto-expiry, audit fields, and escalation SLA.

### F-04 — [P1] Signed reversal alone does not define the money correction lifecycle

**Problem**

The brief combines price changes, refund/void, player leave, and `left` rejoin into one recommendation. A signed reversal corrects an allocation in the immutable ledger; it does not itself move cash externally or determine what happens to the existing player and charge records.

DD-45 currently keeps `left` rejoin fail-closed until there is an explicit correction flow and ledger disposition. Saying signed reversal “opens the correction flow” leaves the important state transitions undecided.

**Evidence**

- Target: `docs/founder-decision-brief-2026-07-15.md:66-73`.
- DD-45: `docs/dd-45-waitlist-analysis.md:13` — `left` rejoin remains `REJOIN_REQUIRES_REVIEW`.
- Canonical decision: `docs/standards/decisions.md:507` — do not reuse or overwrite the existing ledger.
- Product boundary: `docs/product/PRD.md:262` — Plexco does not custody money; the host performs an external refund and records it.

**Required closure**

Pin three separate decision tables before approving this item:

1. Price edit: no charge or canonical charge state `open|partial|paid|void`; treat `waiver|reversal` only as allocation history.
2. Leave/cancel: cash disposition versus ledger disposition for every payment state.
3. Rejoin: existing player state, charge state, allocation state, preview/confirm, actor, and audit outcome.

### F-05 — [P1] Gender pricing fallback is conflated with gender eligibility gating

**Problem**

The brief says `other/undisclosed` uses base price but then introduces a fail-closed rule and cites DD-41. This mixes two distinct contracts:

- DD-39 pricing: missing gender is a valid state and falls back to base/default price; only KMS/decrypt or price-derivation failure is fail-closed.
- DD-41 eligibility: missing/withheld/non-matching gender blocks only a session that has an explicit gender restriction. A gender-priced session alone does not make the player ineligible.

This ambiguity could incorrectly block a join or compute the wrong charge.

**Evidence**

- Target: `docs/founder-decision-brief-2026-07-15.md:96-101`.
- DD-39: `docs/standards/decisions.md:440-445`.
- Technical derivation: `docs/features/BE/feature_user_settings_tech.md:31,67-81,141`.
- DD-41: `docs/dd-41-session-fields-gating-analysis.md` — gender restriction and gender pricing are separate inputs.

**Required closure**

- State the pricing rule independently: `other`, `undisclosed`, or genuinely missing gender uses `price_amount`/configured fallback; infrastructure or decryption failure is fail-closed.
- State the eligibility rule independently: apply the DD-41 decision table only when `gender_restriction != none`.

### F-06 — [P2] Guest conversion and ban policy are not decision-complete

**Problem**

The guest-to-full options are not mutually exclusive: host invitation and player-request-with-host-approval can coexist. The recommendation `host explicit` does not decide whether a guest may initiate a request.

Reusing DD-42 also covers only reliability-driven, time-limited bans. It does not fully define a general manual club ban.

**Evidence**

- Target: `docs/founder-decision-brief-2026-07-15.md:80-87`.
- Reliability-ban scope: `docs/dd-42-reliability-analysis.md`.

**Required closure**

- Decide whether player-initiated conversion requests exist and whether they coexist with host invitations.
- For manual bans, decide actor, reason, evidence/provenance, expiry, unban/override, audit, and the effect on active/waitlisted players.

### F-07 — [P2] LLM interfaces are specified but not implemented, and provider choices should be separated

**Problem**

The brief says `EmbeddingProvider` and `ChatProvider` are already swappable. They are currently interface contracts in the technical specification, not implemented production interfaces in `packages/` or `apps/`. The brief later says to build the interface first, which contradicts the earlier wording.

The provider decision also treats chat and embeddings as one vendor choice even though they are separate interfaces and may require different vendors, regions, retention settings, and reindex implications.

**Evidence**

- Target: `docs/founder-decision-brief-2026-07-15.md:122-125`.
- Spec-only contracts: `docs/features/BE/feature_club_assistant_tech.md:341-342`.
- Canonical status: `docs/standards/decisions.md:235-239`.

**Required closure**

- Change the status to: “provider interfaces are specified/pinned, not yet implemented.”
- Score `ChatProvider` and `EmbeddingProvider` independently and allow a mixed-vendor result.
- Add DPA, retention, subprocessors, data location, cross-border assessment, model-change/reindex, and exit strategy to the gate.

### F-08 — [P2] The brief does not explain the remaining DD-34/35/36 status

**Problem**

The brief claims to collect all items that still require founder input, but DD-34/35/36 remain `Approve-in-principle` rather than fully closed and are neither included nor explicitly deferred.

**Evidence**

- Canonical status table: `docs/standards/decisions.md:49-51`.
- Detailed sections: `docs/standards/decisions.md:378-397`.

**Required closure**

Either:

- add DD-34/35/36 as low-urgency founder decisions; or
- explicitly state that approve-in-principle is sufficient for now, identify the build-time promotion gates, and explain why they are outside this brief.

## Items that are directionally sound

- **DD-04 hosting:** DigitalOcean Managed PostgreSQL is a defensible recommendation pending benchmark and final vendor/security verification. Relevant official sources: [DigitalOcean database SLA](https://www.digitalocean.com/sla/databases), [Neon pricing/HA scope](https://neon.com/pricing), [Neon Compute Endpoint SLA](https://neon.com/sla), [Neon Private Networking scope](https://neon.com/docs/security/security-overview), [Supabase pricing](https://supabase.com/pricing), and [Fly.io egress IP pricing](https://fly.io/docs/networking/egress-ips/).
- **Billing packaging:** canonical logical plans `free`/`host_pro`, a 14-day trial, and a 7-day grace period are directionally aligned with the current product contract. Live `free_web` remains only as a legacy key until the DD-29 migration lands.
- **Club Assistant:** KB-only grounding remains the correct boundary. Rev 3 closes the document defects in F-01/F-07; legal/provider review in Items 6/7 remains a separate go-live gate.

## Closure semantics

**Ready for founder/legal review** means the brief contains decision-complete options/recommendations, correct live contracts, explicit legal gates, and clear deferred triggers. Rev 3 satisfies this document-level gate.

**Post-decision closure** happens only after founder/legal selects the policy: update `docs/standards/decisions.md` or canonical OQ first, propagate the same actors/states/fail-closed rules to dependent specs, then verify and commit a clean docs-only scope. Propagation is not a prerequisite for presenting the brief; it is the consequence of the decision.

## Snapshot caveat

This review reflects the working tree on 2026-07-15. At review time, the target brief was untracked and several canonical/dependent documents were modified or untracked. These findings therefore describe the current on-disk snapshot, not a committed canonical baseline.
