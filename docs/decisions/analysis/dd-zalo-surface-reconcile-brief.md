# Decision brief — Zalo phase-1 surface (resolves AP-24 evidence row U3)

> **Status:** owner decision requested. Small. Verify-on-disk basis pinned below.
> **Pin:** written 2026-07-22 against `main@a57b8ee`. Sources are internal docs on that commit.
> **Not authority yet** — this is a proposal; nothing here is written into a Reviewed spec until the owner picks.

## The row this closes

`provider-limits-evidence.md` row **U3** fails closed because two internal docs appear to name **different Zalo
products** with different limits, and no canonical authority reconciles which one phase-1 uses. Every Zalo quota in
that evidence doc (3 bots/account · 50 users/bot · 3,000 msgs/month, Bot Platform Basic tier) only *binds* phase-1
**if Bot Platform is the surface**. So U3 gates whether those numbers are real constraints.

## What the evidence actually shows (verify-on-disk)

The "contradiction" is narrower than U3's wording suggests — it is almost certainly a **stale header label, not a live
architectural fork**:

| Source | What it says about the Zalo surface |
|---|---|
| `channels/zalo/README.md` **header** | `Surface: Zalo Official Account (OA) — DM only` · `API: Zalo OA API v3` |
| `channels/zalo/README.md` **body** (same file) | Describes **Bot Platform** primitives: `X-Bot-Api-Secret-Token`, `getWebhookInfo`, token reset in **Zalo Bot Creator** — these are Bot Platform, not OA API v3 |
| `strategy/gtm-doi-soat-decision.md` | Unambiguous **Bot Platform**: "mỗi host tự tạo & own 1 bot qua **Zalo Bot Platform**", "3 bot free", "**50 user/bot**", "**3.000 tin/tháng/bot**" — **and already has an overflow decision** (below) |

So the README's own body and the GTM authority both describe **Bot Platform**. Only the README's one-line **header**
still says "OA API v3". The most likely reading: the header predates the Bot-Platform framing and was never updated.

## The substantive question is already decided

The GTM doc does not just name Bot Platform — it already resolves the cost/scaling consequence of the 50-users/bot cap:

> Overflow (host > 50 players/bot): (1) route players to **web/app + Messenger** (product direction, COGS ~0);
> (2) buy **Zalo OA/ZNS** (200–800đ/msg) only if forced. Default: do **not** buy ZNS; web/app is the primary surface,
> the Zalo bot is one reminder channel.

That is the real decision U3 seemed to open, and it is already made. What remains is not a fork to choose, but a
**consistency fix + a build obligation**.

## Recommendation (owner picks one)

**Option A — treat U3 as a documentation reconcile (recommended; matches all evidence).**
Confirm the canonical phase-1 surface is **Zalo Bot Platform**, and correct the `channels/zalo/README.md` header to
say Bot Platform (the body already does). Then U3 closes: the Bot Platform limits in the evidence doc stand, and the
GTM overflow strategy is the pinned answer to the 50-users/bot ceiling. This needs no new capability and no vendor
contact — it is a one-doc header fix plus confirming the evidence row.

**Option B — this was a genuine OA-API-v3 intent.**
Only if the owner actually intends the OA/ZNS product as the phase-1 surface (nothing on disk supports this — the
README body and GTM both say Bot Platform). If so, it IS a real DD: the OA/ZNS cost model (per-message ZNS fees) and
its own limits replace the Bot Platform quotas, and the GTM overflow economics change materially. Would need a full
DD + re-run of the Zalo cost rows.

## Carry-forward regardless of A or B

The **50 users / bot** Basic-tier cap is a hard ceiling for a multi-club platform and is NOT a documentation artifact —
it is a real constraint the GTM overflow routing (web/app + Messenger) exists to absorb. Whichever option is chosen,
that routing is a build obligation, not a paper note; it should be a named requirement when the Zalo channel and the
notification-routing feature are sliced.

## If Option A: exact next step

Owner confirms "surface = Bot Platform" → a small docs-reconcile slice (or a direct owner edit under the root-commit
lock) corrects the `channels/zalo/README.md` header and flips evidence-doc row U3 from `UNRESOLVED` to closed with the
Bot Platform reference. That is the only action needed to close U3.
