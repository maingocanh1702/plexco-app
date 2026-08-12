# DD-14 / DD-15 — Zalo external-evidence contract

> **Classification:** DD-14 = external enablement evidence; DD-15 = external optimization evidence. Neither is an internal product decision and neither authorizes identity merging.
> **Reconciled:** 2026-08-11 · **Canonical:** `00-start-here/identity-model.md` §3/§5/§7 · DD-01/32/50/67.

## 1. Durable defaults

- Zalo Login and bot/OA identities are separate subjects until an explicit, verified link binds them. Provider-name equality is never a join key.
- The verified one-time link-code path (DD-50 `/link`) is the decided safe account-linking path for every supported Zalo topology (link_codes storage exists; the `/link` command handler is a phase-1 contract, not yet built).
- Bot identity remains scoped to the exact bot/OA endpoint. No schema, uniqueness, merge or cross-bot dedupe rule may assume a global `from.id`.
- Missing, ambiguous or stale provider evidence keeps optional Login/CTA OFF; it never weakens an already-safe build.

## 2. DD-14 — Login enablement evidence

Question: can a Plexco Zalo Login app be enabled independently of an OA verification state?

The item closes only when the repository records one of:

1. attributable official documentation with URL, capture date, applicable product/API version and exact App/OA prerequisites; or
2. a reproducible sandbox run with exact configuration, expected result and observed result.

If independence is proven, that evidence may enable the Zalo Login surface after its normal security/release gates. It does **not** auto-link the Login subject to a bot/OA `from.id`. If independence is not proven, Login/CTA stays OFF; account-linking uses only the verified one-time link-code path (DD-50 `/link`, a phase-1 contract not yet implemented), never an auto-link.

## 3. DD-15 — cross-bot optimization evidence

Question: does the same Zalo account emit the same `from.id` across two distinct Plexco bot/OA endpoints?

Close evidence must be official and attributable or a two-endpoint reproducible probe that records endpoint/app identities, payload fields, dates and provider environment. Until then, storage and lookup stay endpoint-scoped.

Even if stability is proven, a separate reviewed proposal must define migration, collision handling, rollback and privacy consequences before uniqueness or merge scope changes. The spike result alone authorizes no data-model change.

## 4. Verification and propagation

- Negative tests: same-looking subjects on two endpoints never auto-merge; provider outage/unknown returns the `/link` path; a Login success without verified link cannot claim a bot identity.
- Reopen DD-14 immediately before enabling Zalo Login or its CTA.
- Reopen DD-15 immediately before proposing cross-bot dedupe, wider uniqueness or fewer explicit links.
- Propagate only the evidence outcome and its bounded consequence to `decisions.md` and `identity-model.md`; do not copy transient portal observations as timeless authority.

## 5. Status boundary

These evidence tasks do not block endpoint-scoped identity, `/link`, or the Google/email phase-1 contract. They do block the specific optional enablement/optimization named above. No runtime, migration or provider activation is authorized here.
