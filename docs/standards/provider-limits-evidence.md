# Provider messaging limits and tier evidence

> **Purpose.** Record current, attributable messaging limits and tier/App-Review gates that
> constrain Plexco phase-1 flows on **Zalo Bot**, **Meta Messenger**, **SePay** and **ApiPay**.
> **Evidence only** — this document does not set pricing, GTM, capacity or architecture decisions,
> and provisions nothing. It supersedes reseller/community figures previously carried in
> `../strategy/gtm-doi-soat-decision.md` with primary-source citations, or flags them `UNRESOLVED`.
>
> **Checked:** 2026-07-23 · **Method:** each provider verified independently against its current
> official/primary source (fetched live). Search snippets, resellers and community posts do not
> close a row; silence is not a value; ambiguity fails closed. A public **retail** figure does not
> close a limit that phase-1 reaches through a **contract** or a **different surface**, and an
> **omitted** limit is recorded as `UNRESOLVED`, never left silent.

## Result

**`HALT-EVIDENCE_INCOMPLETE`** — several rows that constrain phase-1 flows cannot be closed from a
current primary source: the phase-1 **Zalo surface is unreconciled** (OA API v3 vs Bot Platform,
different limits), the phase-1 **ApiPay enterprise auto-provision contract** terms are unverified
(DD-30), the **Messenger outside-24h proactive-reminder eligibility and Vietnam availability** are
unstated by Meta, and **per-provider Send-API/webhook rate limits** are not published in the sources
fetched. All rows that _are_ attributable to an official primary source are recorded below with
citations. No completion marker is emitted (see
[§ Unresolved](#unresolved-rows-reason-for-halt-evidence_incomplete)).

## How to read the tables

One row per limit that actually constrains a phase-1 flow, grouped by provider. `Value` is the
current constraint or `UNRESOLVED`; **beta/subject-to-change** figures are flagged as a risk.
`Source` is the primary title + URL actually fetched; `Paraphrase` is what that source states.

---

## 1. Zalo — phase-1 primary chat (per-host BYO bot)

> ⚠️ **Surface unreconciled (topology `UNRESOLVED`).** The canonical Zalo authority is internally
> inconsistent about _which_ Zalo product phase-1 uses, and the two products have **different**
> limits: `../channels/zalo/README.md` headers the surface **"Zalo Official Account (OA) — Zalo OA
> API v3"** (OA/ZNS product), while `../strategy/gtm-doi-soat-decision.md` §2 and that same README's
> mechanics (`X-Bot-Api-Secret-Token`, `getWebhookInfo`, Bot Creator) describe the **Zalo Bot
> Platform**. The quotas below are the official **Zalo Bot Platform** limits; they only bind phase-1
> **if** the Bot Platform is the selected surface (see [U3](#unresolved-rows-reason-for-halt-evidence_incomplete)).

| Limit / gate                   | Value (2026-07-23)                                       | Source                                       | Paraphrase                                                                                       |
| ------------------------------ | ------------------------------------------------------- | -------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Bots per personal Zalo account | **3** (Bot Platform, Basic tier)                        | Zalo Bot Platform — <https://bot.zapps.me/>  | "Tạo tối đa 3 Bot" (create up to 3 bots).                                                        |
| Users per bot                  | **50** (Bot Platform, Basic tier)                       | Zalo Bot Platform — <https://bot.zapps.me/>  | "Mỗi Bot tương tác với tối đa với 50 người dùng" (max 50 users per bot).                         |
| Messages per month per bot     | **3,000** (Bot Platform, Basic tier)                    | Zalo Bot Platform — <https://bot.zapps.me/>  | "Cho phép gửi tối đa 3.000 tin nhắn mỗi tháng" (max 3,000 messages/month).                       |
| Group-chat interaction         | **3 groups — Beta**                                     | Zalo Bot Platform — <https://bot.zapps.me/>  | "Tương tác với 3 nhóm Chat (Beta)"; group support is a Beta feature.                             |
| Pricing / tier — **beta risk** | Basic **free**; Pro **129,000đ/mo "coming soon"** ⚠️    | Zalo Bot Platform — <https://bot.zapps.me/>  | Basic is free; a paid "Pro" tier is "Sắp ra mắt" (coming soon) at 129,000đ/mo — the free tier is **not guaranteed permanent**. |
| Send-API rate limit / throughput | **`UNRESOLVED`**                                       | not stated on <https://bot.zapps.me/>; `../channels/zalo/README.md` line 179 | The Bot Platform page states no per-second/per-minute send rate; the channel authority lists "rate limits" as a to-confirm item before coding (see [U8](#unresolved-rows-reason-for-halt-evidence_incomplete)). |
| Applicable phase-1 surface     | **`UNRESOLVED`** (OA API v3 vs Bot Platform)            | conflict between `../channels/zalo/README.md` header and `../strategy/gtm-doi-soat-decision.md` §2 | The canonical channel authority does not settle which Zalo product phase-1 uses; the OA API v3 product has different, **unverified** limits (no OA/ZNS primary source is cited here) — if phase-1 selects OA, its limits stay `UNRESOLVED`, not the Bot Platform quotas. |

**Re-verification:** the GTM doc's "3 bots free / 50 users / 3,000 msgs/mo / beta" figures
(previously cited to `zbot.com.vn`, a third-party reseller) **match** the official Zalo **Bot
Platform** page — but the channel README labels the phase-1 surface **OA API v3**, a different
product; that conflict (not the quota values) is what is unresolved.

---

## 2. Meta Messenger — phase-1 chat (P2.5; central + optional per-club Page)

Phase-1 debt reminders (FLOW-7) rely on strategy **A** (stay in 24h) + **C** (HUMAN_AGENT), plus
**B** (OTN) if open in Vietnam, per `../channels/messenger/messenger-channel-design.md` §2.

| Limit / gate                                                   | Value (2026-07-23)                                                                        | Source                                                                                                                   | Paraphrase                                                                                                                                                              |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Standard messaging window                                     | **24 hours**                                                                              | Messenger Platform policy — <https://developers.facebook.com/documentation/business-messaging/messenger-platform/policy> | "Businesses have up to 24 hours to respond to a user. Messages sent within the 24-hour window may contain promotional content."                                         |
| Permission to send                                            | **`pages_messaging` required** (+ deps `pages_manage_metadata`, `pages_show_list`)        | Permissions reference — <https://developers.facebook.com/docs/permissions/reference/pages_messaging>                     | Grants user-initiated interactive experiences, order/booking confirmations and customer-support messages.                                                              |
| Access gate to message real users                             | **Advanced Access → App Review + Business Verification**                                   | Graph API access levels — <https://developers.facebook.com/docs/graph-api/overview/access-levels>                        | Standard Access is limited to app-role users; requesting a permission from any user needs Advanced Access, which requires Business Verification (mandatory since 2023-02-01) and per-permission App Review. |
| Outside-24h **HUMAN_AGENT** (strategy C) — duration           | **7-day window; human/manual response only** (attributed)                                 | Messenger Platform policy — <https://developers.facebook.com/documentation/business-messaging/messenger-platform/policy> | Human Agent tag permits manual (human) responses within a 7-day period.                                                                                                |
| Outside-24h **HUMAN_AGENT** — proactive-reminder eligibility  | **`UNRESOLVED`**                                                                          | — (not established by the fetched policy page; see [U5](#unresolved-rows-reason-for-halt-evidence_incomplete))           | Human Agent is a human reply to a user inquiry, not an automated/unsolicited proactive send, and needs a **separate feature access** not granted by `pages_messaging` Advanced Access; whether Plexco holds that access and whether an owner-triggered FLOW-7 reminder qualifies is not established. |
| Outside-24h **One-Time Notification** (strategy B)            | **Exists (Messenger only, one message after 24h); requires prior in-window opt-in token** | Messenger Platform policy — <https://developers.facebook.com/documentation/business-messaging/messenger-platform/policy> | OTN sends one time-sensitive notification after the 24h window; "not available for IG Messaging API". Opt-in must be captured in-window; VN availability not stated (design open item OD-A → [U5](#unresolved-rows-reason-for-halt-evidence_incomplete)). |
| Outside-24h **Message Tags** (event/update tags)              | **`UNRESOLVED`** (not first-party-fetched)                                                | Messenger Platform changelog — <https://developers.facebook.com/docs/messenger-platform/changelog/> (direct fetch HTTP 500 on 2026-07-23) | Internal doc + a Meta-domain search indicate `CONFIRMED_EVENT_UPDATE`/`ACCOUNT_UPDATE`/`POST_PURCHASE_UPDATE` return error 100 from 2026-04-27, but the changelog could not be fetched first-party, so the value is not closed (see [U2](#unresolved-rows-reason-for-halt-evidence_incomplete)). |
| Outside-24h **Marketing Messages in VN**                      | **`UNRESOLVED`**                                                                          | — (no current primary source; see [U1](#unresolved-rows-reason-for-halt-evidence_incomplete))                           | Meta recommends the Marketing Messages API as a post-tag path but states no Vietnam availability; the internal "off in VN from 2026-02-10" is third-party (Manychat) and conflicts with Meta's migration guidance. |
| Outside-24h **Utility Templates in VN**                       | **`UNRESOLVED`**                                                                          | — (no current primary source; see [U1b](#unresolved-rows-reason-for-halt-evidence_incomplete))                          | Meta names Utility Templates as the recommended tag-replacement, but their Vietnam availability and approval/eligibility contract are not stated in any fetched primary source. |
| Send-API rate limit / throughput                              | **`UNRESOLVED`**                                                                          | not fetched; `../channels/messenger/README.md` lines 30, 111                                                            | Meta's Send API rate limit depends on message type / Page / app tier and is not a fixed value; the channel authority says "do not assume 200 calls/hour/page" and lists the current rate limit as a to-quote item (see [U7](#unresolved-rows-reason-for-halt-evidence_incomplete)). |

---

## 3. SePay — phase-1 money rail (bank-transfer reconciliation; chat-money separated)

| Limit / gate                | Value (2026-07-23)                                            | Source                                                  | Paraphrase                                                                                     |
| --------------------------- | ------------------------------------------------------------ | ------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Free tier transaction quota | **50 transactions/month** at **0đ/mo**                       | SePay pricing — <https://sepay.vn/bang-gia.html>        | FREE plan: "0đ /tháng", "50 giao dịch/tháng".                                                  |
| Bank accounts per plan      | **Unlimited** (all plans)                                    | SePay pricing / FAQ — <https://sepay.vn/bang-gia.html>  | "SePay không giới hạn số lượng tài khoản ngân hàng"; plans differ only by transaction volume.  |
| Over-quota behaviour        | **Allowed, charged after overage** (not fail-closed)         | SePay pricing — <https://sepay.vn/bang-gia.html>        | "Cho phép vượt giao dịch và tính phí sau vượt" (overage permitted, billed post-usage).         |
| Paid transaction plan       | **STARTUP from 120,000đ/mo**; exact tx quota **`UNRESOLVED`** | SePay pricing — <https://sepay.vn/bang-gia.html>        | STARTUP starts at 120,000đ/mo; its transaction cap is chosen via an on-page slider and was **not** verifiably enumerable via fetch — no approximate value is recorded (see [U6](#unresolved-rows-reason-for-halt-evidence_incomplete)). |
| VPBank promotion (COGS-0) — conditional | **500 free transactions/month for 1 year** for a new VPBank account; exact eligibility **`UNRESOLVED`** | SePay pricing — <https://sepay.vn/bang-gia.html>; `../strategy/gtm-doi-soat-decision.md` line 82 | The fetched SePay page states "miễn phí 500 giao dịch mỗi tháng trong 1 năm" for new VPBank account holders; the internal GTM authority adds the condition "Mở VPBank qua mã giới thiệu" (open VPBank via SePay referral), which the fetched SePay page did **not** confirm — so whether the benefit is referral-gated is not closed (see [U6b](#unresolved-rows-reason-for-halt-evidence_incomplete)). |
| Webhook/API rate limit      | **`UNRESOLVED`**                                             | not stated on <https://sepay.vn/bang-gia.html>          | The pricing page states transaction quotas but no API/webhook request-rate limit (see [U9](#unresolved-rows-reason-for-halt-evidence_incomplete)). |

**Re-verification:** the VPBank "500 free tx" figure is **confirmed**. The GTM doc's "VPBank PRO
~640đ/tx / Casso comparison" framing is **superseded** — SePay's current public plan structure is
FREE / STARTUP / SHOP / eShop, not the earlier per-tx tiers.

---

## 4. ApiPay — money rail (retail tiers attributed; phase-1 enterprise contract unresolved)

Phase-1 ApiPay is **enterprise auto-provision (DD-30)**: the platform holds one enterprise
credential and provisions a per-host bank-account + webhook; retail self-serve is only a fallback.
The public **retail** tiers below are attributable, but they do **not** define the phase-1
**enterprise-contract** limits.

| Limit / gate                                     | Value (2026-07-23)                            | Source                                       | Paraphrase                                                                                       |
| ------------------------------------------------ | --------------------------------------------- | -------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Retail FREE                                      | 72-hour trial · **1 bank account**            | ApiPay pricing — <https://apipay.vn/pricing> | Free 72h trial, 1 account.                                                                       |
| Retail BASIC                                     | **100,000đ/mo** (list 150,000đ) · **1 acct**  | ApiPay pricing — <https://apipay.vn/pricing> | BASIC: 1 bank account.                                                                           |
| Retail STARTER                                   | **200,000đ/mo** (list 250,000đ) · **3 accts** | ApiPay pricing — <https://apipay.vn/pricing> | STARTER: 3 bank accounts.                                                                        |
| Retail PRO                                       | **400,000đ/mo · 5 accts**                     | ApiPay pricing — <https://apipay.vn/pricing> | PRO: 5 bank accounts.                                                                            |
| Retail TEAM                                      | **700,000đ/mo · 10 accts**                    | ApiPay pricing — <https://apipay.vn/pricing> | TEAM: 10 bank accounts.                                                                          |
| Retail BUSINESS                                  | **1,700,000đ/mo · 25 accts**                  | ApiPay pricing — <https://apipay.vn/pricing> | BUSINESS: 25 bank accounts.                                                                      |
| Retail ENTERPRISE                                | **3,200,000đ/mo · 50 accts**                  | ApiPay pricing — <https://apipay.vn/pricing> | ENTERPRISE: 50 bank accounts.                                                                    |
| Retail per-transaction fee                       | **None**                                      | ApiPay pricing — <https://apipay.vn/pricing> | "ApiPay không tính phí theo từng giao dịch thanh toán thành công."                               |
| API rate limit (retail/standard)                 | **`UNRESOLVED`**                              | not stated on <https://apipay.vn/pricing>    | The pricing page states account tiers but no API request-rate limit (see [U10](#unresolved-rows-reason-for-halt-evidence_incomplete)). |
| **Phase-1 enterprise auto-provision contract** (per-host account/webhook limits, fees, SLA, replay, rate) | **`UNRESOLVED`** | DD-30 + `../features/feature_connector_onboarding.md` §4.3 | Phase-1 uses a platform enterprise contract whose "request shape / terms / SLA / replay mechanism" are explicitly **unverified** and must **not** be inferred from the standard/retail API; the retail tiers above do not close this gate (see [U4](#unresolved-rows-reason-for-halt-evidence_incomplete)). |

**Re-verification:** the retail tiers **resolve** the GTM doc's flagged BUSINESS↔ENTERPRISE _retail
label_ question (BUSINESS = 1,700,000đ / 25 accounts; ENTERPRISE = 3,200,000đ / 50 accounts). They do
**not** attest the phase-1 enterprise-contract limits, which remain unverified per DD-30.

---

## Unresolved rows (reason for `HALT-EVIDENCE_INCOMPLETE`)

| #   | Provider / row | Why it is not closed | How to close |
| --- | -------------- | -------------------- | ------------ |
| U1  | **Messenger — Marketing Messages availability in Vietnam** (FLOW-7) | No current primary source states VN availability; a `developers.facebook.com`-restricted search returned no geographic-availability data. The internal "off in VN from 2026-02-10" is third-party (Manychat) and conflicts with Meta's own migration guidance. | Confirm Marketing Messages VN availability + eligibility with Meta directly (developer support / a Business Solutions Provider) or a first-party regional-availability doc; record value + source. |
| U1b | **Messenger — Utility Templates availability + eligibility in Vietnam** | Meta names Utility Templates as the recommended tag-replacement, but no fetched primary source states their Vietnam availability or approval/eligibility contract. Marketing Messages and Utility Templates are distinct mechanisms and must each be closed independently. | Confirm Utility Templates VN availability and the template approval/eligibility contract with Meta first-party; do not treat a single availability answer as closing both U1 and U1b. |
| U2  | **Messenger — Message Tags deprecation (2026-04-27, error 100)** | Corroborated by the internal doc + a `developers.facebook.com`-restricted search of the changelog, but the changelog returned **HTTP 500 on two direct fetches (2026-07-23)**; search corroboration does not close a row. | Re-fetch <https://developers.facebook.com/docs/messenger-platform/changelog/> directly once Meta's 500 clears and quote the dated entry first-party. |
| U3  | **Zalo — phase-1 surface / topology** (Zalo OA API v3 vs Zalo Bot Platform) | The channel README header and the GTM/mechanics description name **different Zalo products** with different limits; the canonical authority does not reconcile which one phase-1 uses. The Bot Platform quotas are attributable but only bind if that is the surface. | Owner/architecture reconciles the canonical Zalo surface in `../channels/zalo/README.md`; then confirm the applicable product's limits (Bot Platform vs OA/ZNS). |
| U4  | **ApiPay — phase-1 enterprise auto-provision contract** (per-host account/webhook limits, fees, SLA, replay, rate) | Phase-1 uses the DD-30 platform enterprise contract; `../features/feature_connector_onboarding.md` §4.3 leaves its terms unverified and forbids inferring them from the retail/standard API. Public retail tiers do not close it. | Obtain the ApiPay enterprise contract terms from ApiPay and record them with an attributable reference. |
| U5  | **Messenger — outside-24h proactive-reminder eligibility + HUMAN_AGENT feature access** (HUMAN_AGENT + OTN) | HUMAN_AGENT needs a **separate feature access** (not granted by `pages_messaging` Advanced Access) and permits only a human reply to a user inquiry — not an automated proactive send; OTN requires prior in-window opt-in and its VN availability is unstated (design open item OD-A). Neither the HUMAN_AGENT feature access nor proactive-reminder eligibility is proven for Plexco. | During the P2.5.0 policy spike, obtain attributable evidence that Plexco has HUMAN_AGENT feature access (App Review / feature approval), confirm with Meta whether an owner-triggered reminder qualifies under HUMAN_AGENT, and whether OTN opt-in is available/eligible in VN; record first-party. |
| U6  | **SePay — STARTUP exact transaction-tier mapping** | The 120,000đ STARTUP plan's transaction cap is slider-selected on the pricing page and was not verifiably enumerable via fetch; no approximate value is recorded. | Read the exact tier-to-price mapping from the SePay pricing selector (or SePay support) and record the verified cap. |
| U6b | **SePay — VPBank promotion exact eligibility** (referral-gated?) | The fetched SePay page states 500 free tx/mo for 1 year for new VPBank accounts but does not state the "open via SePay referral" condition that the internal GTM doc (line 82) records; the referral gating is not confirmed by a primary source. | Re-quote the VPBank promotion's eligibility (referral-gated or not) from SePay's own page/campaign terms before treating it as a phase-1 COGS constraint. |
| U7  | **Messenger — Send API rate limit / throughput** | Meta's Send API rate limit depends on message type / Page / app tier and was not fetched; the channel authority explicitly forbids assuming a fixed value ("not 200 calls/hour/page"). | Quote the current Send API rate limit from Meta's docs per message type / Page / app tier before build. |
| U8  | **Zalo — Bot Platform send rate limit / throughput** | No per-second/per-minute send rate is stated on `bot.zapps.me`; the channel authority (`../channels/zalo/README.md` line 179) lists rate limits as a to-confirm item. | Confirm the Bot Platform send rate in the Zalo sandbox / official Bot docs and record it. |
| U9  | **SePay — API/webhook rate limit** | The pricing page states transaction quotas but no API/webhook request-rate limit. | Read the SePay API docs (`docs.sepay.vn`) or ask SePay for the request-rate limit and record it. |
| U10 | **ApiPay — API rate limit (retail/standard)** | The pricing page states account tiers but no API request-rate limit. | Read the ApiPay API docs (`docs.apipay.vn`) or ask ApiPay for the request-rate limit and record it. |

> Note (does not add a gap): ApiPay retail BASIC/STARTER show a struck-through list price beside the
> current price; the account-count tiers are unambiguous. SePay's phase-1 binding constraints (FREE
> 50 tx/mo and the VPBank 500 tx/mo promotion) are attributed.

## Scope guard

Evidence only. This document records provider constraints as of the checked date; it does **not**
set or change any pricing, GTM, capacity or architecture decision, and does not select a channel or
rail. Beta/subject-to-change figures (Zalo Bot pricing) are flagged as risk, not treated as stable.
Re-verify all rows at build/GA — provider limits, especially beta and contract ones, change.

## Primary sources

- Zalo Bot Platform — <https://bot.zapps.me/>
- Messenger Platform policy — <https://developers.facebook.com/documentation/business-messaging/messenger-platform/policy>
- `pages_messaging` permission reference — <https://developers.facebook.com/docs/permissions/reference/pages_messaging>
- Graph API access levels (Advanced Access / App Review / Business Verification) — <https://developers.facebook.com/docs/graph-api/overview/access-levels>
- Messenger Platform changelog (Message Tags deprecation; direct fetch 500 on 2026-07-23) — <https://developers.facebook.com/docs/messenger-platform/changelog/>
- SePay pricing — <https://sepay.vn/bang-gia.html>
- ApiPay pricing — <https://apipay.vn/pricing>
