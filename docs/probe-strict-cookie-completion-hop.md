# 🍪 Design-probe — which completion-hop carries a `SameSite=Strict` cookie after a cross-site start

> **Type:** DESIGN PROBE — measured evidence + one pinned decision. This is **not** a readiness
> verdict and does **not** authorize coding; the follow-up slice (`auth-s4-d1b-oauth-session-rotation`)
> and its enablement gate remain the owner's decision. Precedent: `b0-auth-credential-lifecycle-design-probe.md`,
> `g3-revoke-all-concurrency-probe-seed.md` (probe docs carry no `review-readiness` directive).
> **Date:** 2026-07-22
> **Authority read (live repo):** `apps/web/lib/session-cookies.ts` (`plx_session` = `SameSite=Strict`,
> `issueSession()` rotate-vs-create branch, lines 36–113) · `apps/web/app/api/auth/google/callback/route.ts`
> (the cross-site landing; `issueSession` at line 201) · `docs/autopilot-manifests/auth-s4-d1b-oauth-session-rotation.json`
> (`problem_statement` / `intended_shape` / `negative_scope`) · `b0-auth-credential-lifecycle-design-probe.md` §8.
> **Harness:** throwaway, lives in `.probe/` (git-ignored, NOT merged). Full source in Appendix B so this
> doc is reproducible even if `.probe/` is deleted.

---

## 0. TL;DR — the one pinned decision

**The completion hop MUST commit a first-party (same-origin) HTML document at the callback before it
navigates same-site to the completion endpoint. A bare server `302` (the naive assumption) does NOT
carry the `Strict` cookie and would leave the residual risk fully intact.**

- **MEASURED-BROKEN:** `M1` server `302` `/callback → /complete` → `Strict` **withheld** on Chromium 149,
  Firefox 151 and WebKit 26.5. If `auth-s4-d1b` shipped this, `issueSession()` would still see no
  `plx_session`, still mint-fresh, and the pre-login session would still survive Google login — while
  every mocked unit test stayed green. This is exactly the silent-failure mode the probe guards against.
- **MEASURED-WORKS (all three engines):** `M2` `location.replace`, `M3` auto-submitting same-origin POST
  form, `M4` `<meta http-equiv=refresh>`, and `M5` a manual no-JS `<a>` click. All commit a first-party
  document first; the subsequent same-site hop carries `Strict`.
- **Recommended shape:** **`M3` — a non-mutating first-party landing that auto-submits a same-origin POST
  to the completion endpoint, with a `<noscript>` manual submit button as the no-JS fallback.** Reason:
  measured-equivalent to M2/M4/M5 on the cookie question, **and** it reuses the transport pattern B0 §8
  already chose for email verify/reset (one landing pattern, not two), **and** the POST carries an `Origin`
  header so the existing `sameOriginRequest()` guard applies to the mutating session-rotation step.
  `M2` (`location.replace` GET) is the clean simpler alternative if a GET completion is preferred.
- **Cross-browser disagreement among measured engines:** **none.** All three agree on every cell.
- **NOT MEASURED — owner must confirm:** **Safari (macOS)** and **iOS Safari** on real shipping builds.
  The WebKit tested here is Playwright's engine build (v2251), which is a *frozen* macOS-14 build (see §2.4).
  It is Safari's engine and agrees with Chromium/Firefox, but it is not the shipping Safari/iOS browser,
  and iOS Safari historically applies the strictest cookie heuristics. Manual steps in §7.

**Blocker status:** the design premise in the d1b manifest — *"a same-site completion hop … a first-party
navigation, so the Strict cookie IS sent"* — is **confirmed by measurement, with the critical refinement
that "first-party navigation" must mean a committed first-party document, not a server redirect.** The
blocker is resolved *for the design question on Chromium/Firefox/WebKit-engine*. It is **not** declared
fully resolved: real Safari + iOS Safari remain to be measured by the owner (§7) before the enablement
gate is closed. See §8.

---

## 1. The question and why it matters

**Question.** After a top-level navigation that *started cross-site* (Google → our `redirect_uri`), which
completion-hop mechanism actually causes the browser to send our `SameSite=Strict` session cookie to a
*same-origin* endpoint on our own site?

**Why it matters (live code).**
- `apps/web/lib/session-cookies.ts:37–44` sets `plx_session` with `sameSite: "strict"`.
- `issueSession()` (`:85–113`) reads `plx_session` and **branches on its presence**: cookie present →
  `rotateWebSession(...)` (revoke old + mint new, atomic); cookie absent → `createWebSession(...)` (mint fresh).
- `apps/web/app/api/auth/google/callback/route.ts` — its own header comment (`:28`) calls it *"the top-level
  cross-site redirect back from"* Google; it calls `issueSession()` at `:201`.
- Because the callback is reached cross-site, the browser withholds the `Strict` `plx_session`. `issueSession`
  sees no cookie → takes the **create** branch → the pre-login session is never rotated/revoked. That is the
  d1b `problem_statement` verbatim: *"a pre-login session SURVIVES Google login without being invalidated."*

The d1b fix is a **same-site completion hop** so the `Strict` cookie is attached and the existing atomic
rotate primitive fires. **If the chosen hop also fails to carry `Strict`, the fix is silently useless** —
still mint-fresh, residual risk intact, unit tests (which mock cookies) still green. This probe measures,
per real browser engine, which hop mechanism actually carries the cookie.

---

## 2. Method

### 2.1 Two genuinely cross-site loopback origins
`SameSite` is *site*-scoped (scheme + registrable domain, port-independent). The harness serves two HTTPS
origins that are **different registrable domains**, hence cross-site to each other:

| Role | Origin | Registrable domain (site) |
|---|---|---|
| **A — "the app"** (holds the `Strict` cookie; has `/callback` and `/complete`) | `https://127.0.0.1:8443` | `127.0.0.1` |
| **B — stands in for Google/IdP** (redirects back to A) | `https://localhost:9443` | `localhost` |

No `/etc/hosts` or DNS edits (no sudo needed). `127.0.0.1` and `localhost` are distinct registrable
domains, so a navigation from B to A is cross-site. **This is validated empirically, not assumed** — see the
`/callback` baseline in §3.2: `Strict` is withheld at the cross-site arrival on all three engines, which can
only happen if the engine treats the pair as cross-site. Real TLS (self-signed) is used because `Secure`
cookies require an https origin; Playwright contexts set `ignoreHTTPSErrors: true`.

### 2.2 Faithful reproduction of the real OAuth return
Per run: (1) visit A `/set` via a same-site top-level GET → sets three cookies (see §2.3); (2) click a
same-site link to A `/begin` which `302`s to **B** `/authorize` (models "Sign in with Google" → accounts.google.com);
(3) **B commits a real HTML document** (like Google's consent page) and then `location.href`s back to A
`/callback` — so the arrival at `/callback` is genuinely **cross-site-initiated** (initiator = B's document),
exactly like the real `redirect_uri` return; (4) A `/callback` performs the mechanism under test to hop to A
`/complete`. The server logs, per hop, whether each cookie actually arrived (server always sees `Cookie:`
regardless of `HttpOnly`; `SameSite` governs *sending*).

### 2.3 Controls that prove the harness observes SameSite correctly (not a generic cookie bug)
Three cookies are set at `/set`, all `Secure; HttpOnly; Path=/`:
- `probe_strict` — `SameSite=Strict` (the one under test).
- `probe_lax` — `SameSite=Lax` — expected to arrive on top-level GET navigations even when cross-site-initiated.
- `probe_none` — `SameSite=None` — expected to arrive on every hop, cross-site included.
- **`BASE` control run** — a same-site click straight to `/complete` (no cross-site hop); `Strict` must be SENT.

If `probe_none`/`probe_lax` appear where `probe_strict` does not, the request genuinely arrived with cookies
attachable and the browser is enforcing the SameSite gradation — so a `probe_strict=NO` is a real
`SameSite=Strict` withholding, not a harness artifact. (Note: these are all top-level *navigations*, not
embedded subresources, so third-party-cookie blocking / ITP does not apply to `probe_none` here.)

### 2.4 Engines, versions, host — exactly what was measured
Driven by Playwright **1.61.1**, three real engine builds, headless, Apple Silicon:

| Engine | `browser.version()` | Playwright build | Note |
|---|---|---|---|
| Chromium | **149.0.7827.55** | chromium v1228 | new-headless (full build, not headless-shell) |
| Firefox | **151.0** | firefox v1532 | |
| WebKit | **26.5** | webkit v2251 | ⚠️ **frozen** `mac14-arm64` build — installer warns it no longer updates on macOS 14; it is Safari's engine but **not** the shipping Safari/iOS browser |
| **Safari (macOS)** | shipping build on macOS 14.5 | — (manual, §7.1) | ✅ measured 2026-07-26; "Prevent cross-site tracking" left at its **default ON** |
| **iOS Safari** | **iOS 18.3 (22D8075)** — iPhone 16 Pro Simulator | — (manual, §7.2) | ✅ measured 2026-07-26 |

Host: **macOS 14.5 (23F79)**, arm64. Each `(engine × mechanism)` runs in a fresh browser context.

### 2.5 Honest limitations
- **Safari (macOS) and iOS Safari are NOT covered** by Playwright's WebKit. Their cells are `NOT MEASURED`;
  §7 gives exact manual steps. Do not infer them from the WebKit engine result, however clean.
- WebKit here is a **frozen** build (§2.4); treat it as a strong proxy for Safari behavior, not as Safari itself.
- Loopback `127.0.0.1`/`localhost` is a valid cross-site pair (validated by the `/callback` baseline), but it
  is not two public-suffix domains; the manual Safari steps in §7 reuse the same pair and re-validate cross-site
  via that same baseline row before trusting any result.

---

## 3. Results (measured)

### 3.1 The deliverable — `Strict` cookie present at `/complete` after each completion hop

| Mechanism at `/callback` | Chromium 149.0.7827.55 | Firefox 151.0 | WebKit 26.5 (engine) | Safari macOS | iOS Safari |
|---|:--:|:--:|:--:|:--:|:--:|
| **`M1`** server `302` → `/complete` | ❌ **NO** | ❌ **NO** | ❌ **NO** | ❌ **NO** | ❌ **NO** |
| **`M2`** first-party HTML → `location.replace('/complete')` | ✅ YES | ✅ YES | ✅ YES | ✅ YES | ✅ YES |
| **`M3`** first-party HTML → auto-submit same-origin **POST** `/complete` | ✅ YES | ✅ YES | ✅ YES | ✅ **YES** | ✅ **YES** |
| **`M4`** first-party HTML → `<meta http-equiv=refresh>` `/complete` | ✅ YES | ✅ YES | ✅ YES | ✅ YES | ✅ YES |
| **`M5`** first-party HTML → manual `<a>` click (no JS) | ✅ YES | ✅ YES | ✅ YES | ✅ YES | ✅ YES |
| `BASE` control — same-site direct (no cross-site hop) | ✅ YES | ✅ YES | ✅ YES | n/a | n/a |

Every `YES`/`NO` above is an observed server-side request in this harness (raw JSON: Appendix A).

### 3.2 Integrity baseline — the cross-site `/callback` arrival (proves the setup)
At `/callback` (the cross-site-initiated arrival), for **every** mechanism and **every** engine:

| Cookie | at cross-site `/callback` | at `/complete` (M2/M3/M4/M5) |
|---|:--:|:--:|
| `probe_strict` (Strict) | ❌ NO (all engines) | ✅ YES (M2/M3/M4/M5) / ❌ NO (M1) |
| `probe_lax` (Lax) | ✅ YES (all engines) | ✅ YES (all) |
| `probe_none` (None) | ✅ YES (all engines) | ✅ YES (all) |

Reading: the request reached `/callback` with `Lax` and `None` attached but **not** `Strict` — textbook
`SameSite=Strict` withholding on a cross-site-initiated navigation, on all three engines. This both
reproduces the exact production bug and confirms `127.0.0.1`↔`localhost` behaved as cross-site. It also
mirrors the intended two-cookie design (B0 §8): a `SameSite=Lax` OAuth-binding cookie *does* reach the
callback for state validation, while the `Strict` session cookie does not — which is why a separate hop is needed.

---

## 4. Interpretation — why M1 fails and the others work

- A **top-level navigation inherits its "site for cookies" from what initiated it.** The whole redirect chain
  passed through B (cross-site), so at `/callback` the context is cross-site → `Strict` withheld.
- **`M1` (server `302`)** never commits a first-party document. The `302` is just another hop of the *same*
  cross-site-initiated top-level navigation, so `/complete` is still cross-site → `Strict` still withheld.
- **`M2`/`M3`/`M4`/`M5`** each **commit a first-party document on A at `/callback`**. Once an A-origin document
  is loaded, a *fresh* navigation initiated **by that document** to `/complete` is **same-site** → `Strict` is
  sent. The document commit is the reset point; the transport after it (JS replace, form POST, meta refresh,
  or a user click) is immaterial to the cookie — all four carry it identically.

The measured takeaway is mechanism-level and robust: **commit a first-party document, then navigate; never
rely on a server redirect to "become" same-site.**

---

## 5. Recommendation

**Pinned recommendation: `M3` — the callback returns a non-mutating first-party landing document that
auto-submits a same-origin POST to a dedicated completion endpoint; a `<noscript>` manual "Continue" submit
button is the no-JS fallback.**

Why M3 over the other working mechanisms:
1. **Measured-equivalent** to M2/M4/M5 on the cookie question (✅ on all three engines).
2. **Reuses an existing, reviewed pattern.** B0 §8 already chose "non-mutating landing → same-origin POST"
   for email verify/reset. Using the same shape for the OAuth completion hop means **one** landing pattern in
   the codebase, not two (DRY / no parallel transport).
3. **Security on the mutating step.** The completion request rotates the session (a mutation). A **POST**
   carries an `Origin` header, so the existing `sameOriginRequest()` guard (`session-cookies.ts:136`, written
   precisely "for endpoints that mint a session … e.g. the login callback") can assert same-origin on the exact
   request that mutates. A GET hop sends no `Origin` and would fall back to `Referer` (suppressible).

Concrete shape for the follow-up slice (design guidance, **not** a measured claim; stays inside the d1b
manifest scope — `session-cookies.ts`, `callback/route.ts`, `feature_web_auth_onboarding_tech.md`):
- `/api/auth/google/callback` (cross-site GET): validate state/code as today, **persist the verified login into
  the existing `auth_oauth_transactions` row** (migration `0017`, already a d1b `dep_check`) keyed by a one-time
  completion handle, then **return the M3 landing** instead of calling `issueSession` here.
- A new same-site completion route (POST, guarded by `sameOriginRequest()`): the `Strict` `plx_session` is now
  attached → call **`issueSession(accountId)` unchanged** → it takes the **rotate** branch → `rotateWebSession`
  (atomic, migration `0015`) revokes the pre-login session and mints the new one in one transaction.
- **No change to `issueSession`'s branch or to the `Strict` attribute** — consistent with the d1b `negative_scope`.

**Simpler alternative if a GET completion is preferred: `M2`** (`location.replace('/complete?ct=…')`, passing the
completion handle in the URL and re-loading the login from `auth_oauth_transactions`). It avoids POST/CSRF
plumbing but introduces a second landing pattern and a GET mutation (weaker same-origin assertion). Measured-equivalent.

**Disagreement among measured engines: none.**

---

## 6. Working mechanisms that carry the cookie but have a downside (item 3)

| Mechanism | Carries Strict? | Why not the primary pick |
|---|:--:|---|
| **`M2`** `location.replace` | ✅ (measured) | Requires JS. GET → no `Origin` header on the mutating step; weaker same-origin assertion than M3. Introduces a second landing pattern vs. B0 §8's POST landing. (Upside: `replace` keeps `/callback` out of history — no back-button bounce.) |
| **`M4`** `<meta http-equiv=refresh>` | ✅ (measured) | Works without JS, **but**: commonly flagged/stripped by strict **CSP** and security scanners; some browsers add a history entry so **Back** re-triggers the refresh; timed-refresh is an accessibility anti-pattern. Avoid. |
| **`M5`** manual `<a>` click | ✅ (measured) | Requires a **user click on every login completion** → real friction. Not acceptable as the primary path; **ideal as the `<noscript>` fallback** for M2/M3. |
| **`M1`** server `302` | ❌ (measured) | **Does not carry the cookie.** Must not be used — this is the trap the probe exists to flag. |

M3's own cost: auto-submit needs JS (covered by the `<noscript>` manual-submit fallback, which is M5 and is
measured to carry `Strict`), and it requires the completion endpoint to accept POST.

---

## 7. ✅ MEASURED (2026-07-26) — Safari (macOS) and iOS Safari (item 4)

> **Result: both cells filled, no disagreement with any engine.** Safari macOS and iOS Safari 18.3
> (22D8075, iPhone 16 Pro Simulator) both reproduce the exact pattern of Chromium/Firefox/WebKit-engine:
> `M1` withholds `Strict`, and `M2`/`M3`/`M4`/`M5` all carry it. Integrity control held on both: **every**
> `stage=callback` row for M1–M5 recorded `strict=false`, proving the return leg was genuinely cross-site
> in shipping Safari, so the `complete` values are real measurements and not a "cookie always sent" artefact.
>
> One log-reading note for future readers: the `PING` rows are **not** a measurement. `PING` is not a
> mechanism — it exists only to trigger the cert-trust prompt on host B, and A answers `unknown mechanism`.
> A second `PING` callback row can show `strict=true`; that is a same-site reload/history navigation of the
> already-loaded `A/callback/PING` page, not a cross-site arrival. It affects no measured cell.
>
> The steps below are kept verbatim as the reproduction procedure.


The automated run cannot cover shipping Safari or iOS Safari. Fill these cells manually. The harness server
needs **only Node** (no Playwright); if `.probe/` was cleaned, recreate it from Appendix B + Appendix C.

**Start the harness** (one terminal, leave running):
```
cd ".probe"          # recreate from Appendix B/C if missing; regenerate cert per Appendix C if expired
node server.mjs      # prints: A up https://127.0.0.1:8443  /  B up https://localhost:9443
```

### 7.1 Safari on macOS
1. In Safari, visit `https://127.0.0.1:8443/set/BASE/safari` and `https://localhost:9443/authorize/PING/safari`
   once each; for each cert warning click **Show Details → visit this website** (trust both hosts — same
   self-signed cert, but Safari trusts per host).
2. For **each** mechanism `M1, M2, M3, M4, M5` (leave "Prevent cross-site tracking" at its **default ON** —
   that is what we want to measure):
   a. Open a **new Private window** (⌘⇧N) — a clean cookie jar per mechanism.
   b. Go to `https://127.0.0.1:8443/set/<M>/safari` (e.g. `/set/M2/safari`).
   c. Click the **go** link. For `M5`, you then land on `/callback…`; click its **continue** link.
   d. You end on `/complete/<M>/safari`, which prints, e.g., `COMPLETE m=M2 b=safari method=GET strict=true …`.
   e. **Record the `strict=` value** for `<M>`.
3. Cross-check the authoritative server log: open `https://127.0.0.1:8443/results` and find the rows with
   `"b":"safari"`. **First confirm the `"stage":"callback"` rows show `"strict":false`** (proves cross-site
   reproduced in Safari); then read each `"stage":"complete"` row's `"strict"`.
4. Enter the five `strict` booleans in the **Safari macOS** column of §3.1.

### 7.2 iOS Safari
- **Practical path — iOS Simulator** (Xcode → *Open Developer Tool → Simulator*): the simulator's Safari can
  reach the host's `https://127.0.0.1:8443` and `https://localhost:9443`, so repeat §7.1 verbatim inside it,
  tagging the path segment `ios` instead of `safari` (e.g. `/set/M2/ios`); read the `"b":"ios"` rows at `/results`.
- **Physical iPhone caveat:** a device cannot reach the Mac's loopback, and it needs **two distinct hostnames**
  (site-scoping) that both resolve to the Mac — i.e. two real DNS names → the Mac's LAN IP with a matching cert,
  or the app deployed to two real cross-site domains. That is a larger setup than a quick check; prefer the
  simulator, or run the check against a real staging deployment of the actual app.

### 7.3 If Safari/iOS disagrees — did not occur
The contingency below was **not** triggered: no Safari or iOS cell showed `strict=false` for M2/M3/M4/M5.
Kept for the record, and because a future OS release could change the answer — re-run §7.1/§7.2 rather than
assuming this result carries forward to a new major Safari/iOS version.

> If any Safari/iOS cell shows `strict=false` for M2/M3/M4/M5 (i.e. even a first-party-document hop does not
> carry `Strict` there), **say so and stop** — that is a valid, important outcome (§8): d1b would then need a
> different design (e.g. an accepted bounded non-atomic revoke, or revisiting `Strict` for the session
> cookie), and the owner decides. Do not paper over it.

---

## 8. Impact on `auth-s4-d1b` / the enablement gate (item 5)

**What is proven.** A same-site completion hop **can** carry the `Strict` `plx_session` to a same-origin
endpoint, so `issueSession()`'s existing rotate branch and the atomic `rotateWebSession` primitive **can** fire
after a Google login — **provided the hop commits a first-party document** (M2/M3/M4/M5). This holds on
Chromium 149, Firefox 151 and WebKit 26.5-engine with no disagreement. The d1b `intended_shape` is therefore
**viable**, and the mechanism is pinned.

**What is refined (a new hard constraint for the slice).** "A first-party navigation" is **not** satisfied by a
server `302` (`M1` measured-broken). The slice spec/acceptance must require a committed first-party landing and
must include a test that would catch an accidental `302`-only implementation — a mocked-cookie unit test will not.

**What was the residual, and how it closed.** Shipping **Safari (macOS)** and **iOS Safari** were the last
unmeasured cells. Both were measured on **2026-07-26** (§7) — Safari on macOS 14.5 with "Prevent cross-site
tracking" at its default ON, and iOS Safari **18.3 (22D8075)** on an iPhone 16 Pro Simulator. Both agree with
all three engines on all five mechanisms, with the cross-site integrity control holding in each. The
"expected but not measured" caveat is **retired**: it is now measured. The only forward-looking caveat left is
version drift — a future major Safari/iOS release is not covered by this run.

**Status for the owner.** The *engineering blocker* on the hop mechanism is **answered** (committed
first-party landing; shipped M3; never a bare `302`), and the Safari/iOS cells that gated final closure are now
**filled with measured evidence**. d1b itself is merged (`0018`). On the evidence in this document the
`safari-macos-and-ios-strict-hop-evidence` enablement gate has **no remaining measurement obligation**.

Setting `GOOGLE_OAUTH_CLIENT_ID/SECRET` is now an **owner go-live decision**, not a blocked one — but it is a
separate decision from this measurement, and any other gate attached to it (e.g. A3 legal/PII for go-live)
stands on its own and is untouched by this probe.

---

## Appendix A — raw measured results (authoritative)

Two runs were executed; M1–M4 were identical across both. Final run (with M5) — server-logged, per request:

```json
{
  "versions": { "chromium": "149.0.7827.55", "firefox": "151.0", "webkit": "26.5" },
  "runErrors": [],
  "results": [
    { "b": "chromium", "m": "BASE", "stage": "complete", "method": "GET",  "strict": true,  "lax": true, "none": true },
    { "b": "chromium", "m": "M1", "stage": "callback", "method": "GET",  "strict": false, "lax": true, "none": true },
    { "b": "chromium", "m": "M1", "stage": "complete", "method": "GET",  "strict": false, "lax": true, "none": true },
    { "b": "chromium", "m": "M2", "stage": "callback", "method": "GET",  "strict": false, "lax": true, "none": true },
    { "b": "chromium", "m": "M2", "stage": "complete", "method": "GET",  "strict": true,  "lax": true, "none": true },
    { "b": "chromium", "m": "M3", "stage": "callback", "method": "GET",  "strict": false, "lax": true, "none": true },
    { "b": "chromium", "m": "M3", "stage": "complete", "method": "POST", "strict": true,  "lax": true, "none": true },
    { "b": "chromium", "m": "M4", "stage": "callback", "method": "GET",  "strict": false, "lax": true, "none": true },
    { "b": "chromium", "m": "M4", "stage": "complete", "method": "GET",  "strict": true,  "lax": true, "none": true },
    { "b": "chromium", "m": "M5", "stage": "callback", "method": "GET",  "strict": false, "lax": true, "none": true },
    { "b": "chromium", "m": "M5", "stage": "complete", "method": "GET",  "strict": true,  "lax": true, "none": true },
    { "b": "firefox",  "m": "BASE", "stage": "complete", "method": "GET",  "strict": true,  "lax": true, "none": true },
    { "b": "firefox",  "m": "M1", "stage": "callback", "method": "GET",  "strict": false, "lax": true, "none": true },
    { "b": "firefox",  "m": "M1", "stage": "complete", "method": "GET",  "strict": false, "lax": true, "none": true },
    { "b": "firefox",  "m": "M2", "stage": "callback", "method": "GET",  "strict": false, "lax": true, "none": true },
    { "b": "firefox",  "m": "M2", "stage": "complete", "method": "GET",  "strict": true,  "lax": true, "none": true },
    { "b": "firefox",  "m": "M3", "stage": "callback", "method": "GET",  "strict": false, "lax": true, "none": true },
    { "b": "firefox",  "m": "M3", "stage": "complete", "method": "POST", "strict": true,  "lax": true, "none": true },
    { "b": "firefox",  "m": "M4", "stage": "callback", "method": "GET",  "strict": false, "lax": true, "none": true },
    { "b": "firefox",  "m": "M4", "stage": "complete", "method": "GET",  "strict": true,  "lax": true, "none": true },
    { "b": "firefox",  "m": "M5", "stage": "callback", "method": "GET",  "strict": false, "lax": true, "none": true },
    { "b": "firefox",  "m": "M5", "stage": "complete", "method": "GET",  "strict": true,  "lax": true, "none": true },
    { "b": "webkit",   "m": "BASE", "stage": "complete", "method": "GET",  "strict": true,  "lax": true, "none": true },
    { "b": "webkit",   "m": "M1", "stage": "callback", "method": "GET",  "strict": false, "lax": true, "none": true },
    { "b": "webkit",   "m": "M1", "stage": "complete", "method": "GET",  "strict": false, "lax": true, "none": true },
    { "b": "webkit",   "m": "M2", "stage": "callback", "method": "GET",  "strict": false, "lax": true, "none": true },
    { "b": "webkit",   "m": "M2", "stage": "complete", "method": "GET",  "strict": true,  "lax": true, "none": true },
    { "b": "webkit",   "m": "M3", "stage": "callback", "method": "GET",  "strict": false, "lax": true, "none": true },
    { "b": "webkit",   "m": "M3", "stage": "complete", "method": "POST", "strict": true,  "lax": true, "none": true },
    { "b": "webkit",   "m": "M4", "stage": "callback", "method": "GET",  "strict": false, "lax": true, "none": true },
    { "b": "webkit",   "m": "M4", "stage": "complete", "method": "GET",  "strict": true,  "lax": true, "none": true },
    { "b": "webkit",   "m": "M5", "stage": "callback", "method": "GET",  "strict": false, "lax": true, "none": true },
    { "b": "webkit",   "m": "M5", "stage": "complete", "method": "GET",  "strict": true,  "lax": true, "none": true }
  ]
}
```

## Appendix B — harness source (`.probe/server.mjs`, throwaway, not merged)

```js
// Two HTTPS origins on loopback, treated as two DISTINCT SITES by the browser:
//   Site A ("the app")    = https://127.0.0.1:8443  (registrable domain: 127.0.0.1)
//   Site B ("Google/IdP") = https://localhost:9443  (registrable domain: localhost)
import { createServer } from "node:https";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const tls = { key: readFileSync(join(HERE, "certs", "key.pem")), cert: readFileSync(join(HERE, "certs", "cert.pem")) };
const A_PORT = 8443, B_PORT = 9443;
const A_ORIGIN = `https://127.0.0.1:${A_PORT}`, B_ORIGIN = `https://localhost:${B_PORT}`;
const observations = [];
const NO_STORE = { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0", Pragma: "no-cache" };

function cookiePresence(req) {
  const c = req.headers.cookie || "";
  return { strict: /(?:^|;\s*)probe_strict=/.test(c), lax: /(?:^|;\s*)probe_lax=/.test(c), none: /(?:^|;\s*)probe_none=/.test(c) };
}
function log(req, b, m, stage) {
  const p = cookiePresence(req);
  observations.push({ b, m, stage, method: req.method, strict: p.strict, lax: p.lax, none: p.none });
  return p;
}
function sendHtml(res, body) {
  res.writeHead(200, { ...NO_STORE, "Content-Type": "text/html; charset=utf-8" });
  res.end(`<!doctype html><meta charset=utf-8>${body}`);
}
const parts = (url) => new URL(url, "https://x").pathname.split("/").filter(Boolean);

const appServer = createServer(tls, (req, res) => {
  const seg = parts(req.url), route = seg[0] || "", m = seg[1] || "", b = seg[2] || "";
  if (route === "results") { res.writeHead(200, { ...NO_STORE, "Content-Type": "application/json" }); res.end(JSON.stringify(observations)); return; }
  if (route === "reset") { observations.length = 0; res.writeHead(200, NO_STORE); res.end("reset"); return; }
  if (route === "set") {
    res.writeHead(200, { ...NO_STORE, "Content-Type": "text/html; charset=utf-8", "Set-Cookie": [
      `probe_strict=S-${b}; Path=/; Secure; HttpOnly; SameSite=Strict`,
      `probe_lax=L-${b}; Path=/; Secure; HttpOnly; SameSite=Lax`,
      `probe_none=N-${b}; Path=/; Secure; HttpOnly; SameSite=None`,
    ] });
    const href = m === "BASE" ? `/complete/BASE/${b}` : `/begin/${m}/${b}`;
    res.end(`<!doctype html><meta charset=utf-8><body>cookies set for ${b}/${m}. <a id=go href="${href}">go</a></body>`);
    return;
  }
  if (route === "begin") { res.writeHead(302, { ...NO_STORE, Location: `${B_ORIGIN}/authorize/${m}/${b}` }); res.end(); return; }
  if (route === "callback") {
    log(req, b, m, "callback");
    if (m === "M1") { res.writeHead(302, { ...NO_STORE, Location: `/complete/${m}/${b}` }); res.end(); }
    else if (m === "M2") { sendHtml(res, `<body>cb<script>location.replace('/complete/${m}/${b}')</script></body>`); }
    else if (m === "M3") { sendHtml(res, `<body><form id=f method=POST action="/complete/${m}/${b}"></form><script>document.getElementById('f').submit()</script></body>`); }
    else if (m === "M4") { sendHtml(res, `<meta http-equiv="refresh" content="0; url=/complete/${m}/${b}"><body>cb</body>`); }
    else if (m === "M5") { sendHtml(res, `<body>cb<a id=hop href="/complete/${m}/${b}">continue</a></body>`); }
    else { res.writeHead(400, NO_STORE); res.end("unknown mechanism"); }
    return;
  }
  if (route === "complete") {
    const p = log(req, b, m, "complete");
    sendHtml(res, `<title>done</title><body>COMPLETE m=${m} b=${b} method=${req.method} strict=${p.strict} lax=${p.lax} none=${p.none}</body>`);
    return;
  }
  res.writeHead(404, NO_STORE); res.end("not found");
});

const idpServer = createServer(tls, (req, res) => {
  const seg = parts(req.url), m = seg[1] || "", b = seg[2] || "";
  if (seg[0] === "authorize") { sendHtml(res, `<title>idp</title><body>idp consent<script>location.href='${A_ORIGIN}/callback/${m}/${b}'</script></body>`); return; }
  res.writeHead(404, NO_STORE); res.end("idp not found");
});

appServer.listen(A_PORT, "127.0.0.1", () => console.error(`A up ${A_ORIGIN}`));
idpServer.listen(B_PORT, "127.0.0.1", () => console.error(`B up ${B_ORIGIN} (reach via localhost)`));
```

The Playwright driver (`.probe/run.mjs`) launches chromium/firefox/webkit with `{ ignoreHTTPSErrors: true }`,
and for each mechanism: `goto /set/<M>/<engine>` → click `#go` → wait for `/complete` (for `M5`, wait for
`/callback` then click `#hop`) → finally `fetch /results`. `MECHANISMS = ["BASE","M1","M2","M3","M4","M5"]`.

## Appendix C — reproduce from scratch
```
mkdir -p .probe/certs && cd .probe/certs
openssl req -x509 -newkey rsa:2048 -nodes -keyout key.pem -out cert.pem -days 5 \
  -subj "/CN=probe-local" -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"
cd .. # write server.mjs (Appendix B) and run.mjs; then:
npm init -y >/dev/null && npm i playwright@^1.56 && npx playwright install chromium firefox webkit
node server.mjs &            # terminal 1 (manual Safari testing needs only this + Node)
NODE_TLS_REJECT_UNAUTHORIZED=0 node run.mjs   # terminal 2 (automated 3-engine run)
```
`.probe/` is git-ignored (`.probe/.gitignore` = `*`) and must not be committed. Self-signed cert expires in 5 days.
