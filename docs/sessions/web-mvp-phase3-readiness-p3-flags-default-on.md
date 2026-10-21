<!-- review-readiness: code-ready -->

# Step-0 readiness: L22 p3-flags-default-on (session P3-S15c)

> Agent-facing. Readiness reviewer: sonnet/high (same model and effort as the lane's code reviewer). Writers: sonnet/high, one file or one section per writer. Security round: opus/max, REQUIRED (personal-data notice, consent, an enablement default); the judgement "no security round" never applies here.
> Lane block: L22 of the P3-S15c brief, conductor-authored under owner decision B3 of 2026-10-21 (recorded by L19 as DD-141). Owner decisions needed: none beyond B3; every other choice below is a Tier-B pin, each worded "default applied, pending owner sign-off".
> Evidence tags. [M] = re-read by this reviewer at the base in this pass. [A] = measured by the two step-0 readers (status/P3-S15c-notes/s0-answers-a.md and s0-answers-b.md, outside git) and not re-read here. Every [M] re-read matched its answer-file citation (0 discrepancies).
> Method limit: a stop notice arrived at about 200k context. Not re-read by this reviewer: the proof lines marked [A] in the copy table, the anchor texts in the runbook, DEV-ONBOARDING and HANDOFF, and the e2e spec locators (settings.spec.ts :264-324). Gate V1 therefore makes every writer re-read each [A] proof line and anchor with `sed -n` BEFORE using it; a mismatch stops that item (the sentence or edit is dropped and reported, never reworded) and the orchestrator rules.

## Authority and base

- Owner decision B3 (2026-10-21), confirmed by the owner in the conductor terminal, recorded in `docs/standards/decisions.md` as DD-141 by L19 (PR 93). The owner's words (verbatim, English as written): "B3. Turn the flags ON: `GENDER_COLLECTION_ENABLED` and `OUTBOX_DISPATCH_SCHEDULE_ENABLED` default true (.env.example and config docs). Outbox dispatch still needs the real Zalo deliverer and bot token (owner P0) and keeps its probe guard. Gender collection must ship with a short consent / purpose notice at the point of collection (t(vi, en)) and the privacy text updated; if that is missing, the lane adds it before flipping the default."
- Base: lane worktree `.autopilot/worktrees/p3-flags-default-on`, branch `feat/p3-flags-default-on`, `git rev-parse HEAD` = `6d7bfccac7401d0052be643d29e5bb0cbfbc0c0e` (merge of PR 93, the L19 decision entries). `git status --porcelain` empty at the start [M]; nothing is committed on the branch before this file. DD-141 on the base [A]: row decisions.md:121, body :1780-1799, B3 text :1788, supersede sentence :1795 (DD-134 (e) is replaced for the COMMITTED default only; the probe guard and the owner P0 step stay), spec follow-up list :1797.
- Migrations: none. No migration, no slot requested, no schema or data-model change; the schema was not touched, so schema.ts and the migrations needed no new reading beyond the cited gender (0062) and registry (0056) files.

## Live truth at the base: Q1-Q5

### Q1 every committed place that states a default

| Place | States | Disposition |
|---|---|---|
| `.env.example:83-98` (16 comment lines) and `:99` [M] | ENABLEMENT BLOCKER comment (never true in any environment; blockers a/b) and `OUTBOX_DISPATCH_SCHEDULE_ENABLED=false` | EDIT: comment rewritten to the pinned wording, flag `true`; keep the exact-"true" sentence |
| `.env.example:173` [M] | `GENDER_COLLECTION_ENABLED=false`, no comment of its own; `:169-171` and `:172 CSP_SCRIPT_NONCE_ENABLED=false` belong to the CSP flag and stay | EDIT: 2 comment lines plus `true` |
| `infra/docker-compose.yml:131-132` [M] | comment "Giu nguyen false - enablement blocker AP-35" and `OUTBOX_DISPATCH_SCHEDULE_ENABLED: "false"` in the `worker:` service (:113-135), which has no `env_file` (:129-130) | EDIT (follows `.env.example`, see Dispatch default) |
| runbook `docs/runbooks/outbox-dispatch-enable-rollback.md` :3, :10-11, :35 [A] | source line; "Khong bao gio commit ...=true. Mac dinh false o .env.example va compose"; enable step "Dat ...=true chi cho worker" | EDIT the three; :6 and :37 stay true, no edit |
| `docs/00-start-here/DEV-ONBOARDING.md:77` [A] | "Projector that - production van la productionStubDeliver ... OFF" (wrong on two counts at the base: the stub is unwired, and B3) | EDIT one line; :257 states an effective state, no edit |
| `docs/00-start-here/HANDOFF.md:304` [A], `:431` [A] | present-tense architecture clause "schedule mac dinh OFF"; imperative "(2) giu ...=false" inside a dated snapshot | EDIT the clause; strike-through plus pointer on :431; ONE new dated Changelog row |
| HANDOFF.md :31 :46 :61 :72 :166 :224 :244 :422 and Changelog rows :507-523 [A] | dated LIVE-TRUTH blocks and history (the file's own :12 calls every block below history) | no edit |
| `docs/00-start-here/repo-operating-flow.md:632`, `docs/runbooks/local-mvp-smoke.md` [A] | name the flag with no default; no default stated | no edit |
| BUILD-STATUS.md (13 lines), README.md :31 :176, BACKEND-HANDOFF-2026-09-26.md, 2026-10-21 handoff-3 (:25 :26 :98 :106) [A] | dated snapshots outside the ownership list | no edit; follow-up |
| TDD.md :49 :552 :667 (DD-141 lists them) and :893 :901, PRD.md:278, ROADMAP.md:1219, slice-readiness-verdicts.md:575 [A] | Reviewed spec, product doc, verdict doc | never edited; follow-up |
| decisions.md [A] | DD-134 (e) body at :2729 (DD-141 cites :2592, stale at this base); R-19 :2179 and P-5 :1954 keep the old default and are not marked superseded | never edited; L0/L17 consolidation |
| flag-reading code [A] | `worker.ts` :45 :51 :75 :107 :137 (+ comments :60 :82, log :142), `route.ts:32`, `queues.ts:12` comment | never edited |

`RO-L19-5` appears nowhere in git at the base (`git grep` empty [A]); by content the contradicting set is: `.env.example:83-99,173`, compose `:131-132`, runbook `:10-11,:35`, `HANDOFF.md:431`, `DEV-ONBOARDING.md:77`, `queues.ts:12`.

### Q2 the gender field

| Topic | Answer | Proof |
|---|---|---|
| Optional | OPTIONAL. Unset option `t("Chua dat", "Not set")`; Save sends no gender part when unchanged; the route accepts gender absent or null; consent is a separate box, default false, disabled while gender is unset | form :147, :156-170 [M]; form :46, :75-77, route.ts:67-74, 0062:31, schema.ts:53 [A] |
| Who reads the stored value | Exactly two application readers: the owner (self-read through `person_gender_read`, "ONLY plaintext exit") and the charge path (`charge_gender_for_derivation`, only the amount leaves); no runtime role holds a grant on the three columns; `persons` has no `tenant_id`; `apps/bot` has no gender reference | route.ts:11-13, me-settings.ts:99-118 :175-195, charge-derivation.ts:19 :27-28 :38-72, 0062:5-8 :106-139, gender-pricing-definers.test.ts:114-120 (GP-1), schema.ts:40-53 [A] |
| Remove | Not set -> `setGender("")` + `setConsent(false)` -> PATCH `{gender:null, genderConsent:false}` -> `person_gender_update(..., NULL, NULL, false)` erases; flag off with a stored value: button "Remove my saved gender" | form :150-153 [M]; me-settings-client.ts:67-71, me-settings.ts:185-186, 0062:56-88, form :187-191 [A] |
| RD-8 flag off | gender block not rendered; page prompt needs the flag; PATCH with a non-null gender or consent true gives 400 INVALID_BODY, erase and withdraw pass; GET returns the stored value so the button shows | form :141-175, view :61 [M]; route.ts:19-20 :27 :77-78, route.test.ts:98-109 [A] |
| Pricing | other / undisclosed / NULL / consent off -> the session `price_amount`; a set gender that cannot be opened -> CHARGE_DERIVATION_UNAVAILABLE, never a fallback price | charge-derivation.ts:50 :65-71, decisions.md:558 [A] |
| Caution | the club sees the resulting amount, so a price difference can hint at gender: no sentence may say nobody can tell | charge-derivation.ts:69-71 [A] |

### Q3 privacy text, placement, copy pattern, inventories

| Topic | Answer | Proof |
|---|---|---|
| Any user-facing privacy text | NONE in apps/web, apps/bot or packages/core: privacy, consent, terms and contact queries with known-present controls; no footer element, no privacy or terms route, no onboarding text, no contact address | S0b2 (a) A1-A8 [A] |
| `docs/legal` | exactly two DRAFT files, lawyer input, not user-facing, not authority: never edited, never cited as proof | S0b2 (b) [A] |
| Notice placement | ONE `<p id="me-gender-notice" className={styles.caption}>` directly after the `<Select>` (:143-155) and before the consent `<label>` (:156), inside the `initial.genderCollection` fragment (:141-175) | form [M] |
| Note placement | new read-only Card directly after the Profile card (:69-74), only while `profile.genderCollection` is true (precedent :61); same card pattern as language and reminders (:81-103) | view [M] |
| Copy pattern | client components `useT()` from `../../lib/i18n-client`; real `t(vi, en)` pairs; no key-based i18n | form :5 :39, view :3 :23 [A] |
| Inventories joined | DD-118 surface inventory (`tenant-lang.test.ts:323-345`) joins only new `route.ts` or `lib/*.ts`: this lane adds neither. `tokens-only.test.ts` joins the new `.tsx` (no colour literal; reuse `styles.caption`). No snapshot tests, no string-coverage sweep | S0b2 (c) [A] |
| Tests extended | `settings-forms.test.tsx` (static render, flag is the `genderCollection` prop) and `settings.spec.ts` (mocked API); no new test file | test :8-31 :99-147 [M]; S0b2 (c) [A] |

### Q4 how the tests set the flags (the PR changes no test outcome through the defaults)

| Source | Flag handling | Proof |
|---|---|---|
| vitest configs (web, bot, db) | set, stub or clear neither flag | S0a2 A.1 [A] |
| `route.test.ts` | `beforeEach` stubs GENDER "false" (:35), `ON()` "true" (:54), parametrised (:79 :243), `afterEach` unstubAllEnvs | [A] |
| `settings-forms.test.tsx` | the flag is a prop (`PROFILE.genderCollection` true) | :16-21 [M] |
| `schedule.test.ts` spawned worker | flag pinned in the child env: "" (:514-516), "true" (:549-551) | [A] |
| announce route and session-service tests | stub "true" and assert independence | [A] |
| Playwright | the settings spec mocks `/api/me/profile` (`World.genderCollection`, default false :77, true only in the gender test :268); web server env sets neither flag (`playwright.config.ts:46-49`) | [A] |
| CI | `ci.yml` sets neither flag; no `cp .env`, no `docker compose` step | [A] |
| Readers of `.env.example` and compose | none parses values; `scripts/db-reset-test.mjs` hashes only the `postgres` service and reads the MAIN checkout's compose file | S0a2 A.8-A.10 [A], hash independence reasoned [R] |

Conclusion: no test, script or CI step depends on either default; every flag-sensitive test stubs or mocks its own value.

### Q5 the worker guard (nothing in this lane touches it)

| Item | Fact | Proof |
|---|---|---|
| Condition 1 | exact string "true" or `{enabled:false, reason:'... is not "true"'}` | worker.ts:44-46 [M] |
| Condition 2 | map empty or holding `productionStubDeliver` -> OFF with the X-3 reason | worker.ts:47-53 [M] |
| Condition 3 | registry probe runs only after 1 and 2; a throw -> OFF with "is migration 0056 applied?" | worker.ts:63-79 [A] |
| Result | `main()` logs `outbox dispatch schedule OFF - <reason>` or registers the schedule | worker.ts:136-144, :100-113 [A] |
| Tests | exact-"true" (schedule.test.ts:200-216), spawned process OFF and ON (:500-563), pure-function guard tests (:566-615) | [A] |
| Stale comments | worker.ts:82 "Gated OFF by default ...", queues.ts:12 "(default false ...)": left byte-unchanged, listed as comment drift | worker.ts:81-85 [M] |
| `preflight.test.ts` :236-282 [M] | the :259-261 comment names ".env.example and the dev compose worker service" as pointing `DATABASE_URL_DIRECT` at the superuser credential. The test passes `ctx.migrationUrl` from `setupWorkerContext(...)` to `runPreflightChecks`; it reads neither file and no flag. The comment is stale against compose `:123` and `.env.example:63` (both `app_worker`) [M]. So the compose `:132` flip cannot change its outcome. Not edited (outside ownership); listed as comment drift | |

## Kit-owned files and negative scope

`docs/standards/kit-pack-membership.json` (checked by `pnpm kit:check`): this reviewer did not measure whether any target file is listed; gate V3 makes `pnpm kit:check` a pass criterion at the final head (the target files are project docs, config and web code, not autopilot kit files). Negative scope: no change to how the code reads either flag (only the exact string "true" enables; unset is off); no change to the worker guard, deliverer or probe; no real deliverer, bot token or production env; no claim that dispatch delivers or that any environment is enabled; no edit of a Reviewed spec, `docs/product/**`, `docs/legal/**` or `docs/standards/decisions.md`; no change to gender pricing logic; no migration.

## B3 budget and measurement

Caps pre-approved by the lane block: 350 non-test, 450 test, 800 total, 16 files, 0 migrations (default gate B3: about 300 LOC, 3 modules, 1 migration). Estimates from both answer files, re-derived with the pinned copy (10 t pairs at about 4 lines each).

| Kind | Estimate (added) | Cap | Basis |
|---|---|---|---|
| Non-test | about 85 (removed about 22) | 350 | new `settings-privacy-note.tsx` about 65, form +3, view +4/-1, `.env.example` about +9/-18, compose +2/-2 |
| Test | about 70 to 90 | 450 | `settings-forms.test.tsx` +35 to 45, `settings.spec.ts` +15 to 25 (notice in `expectUnset`, one flag-ON axe screen) |
| Docs (reported separately) | about 18 added / 8 removed config docs, plus this file about 300 | not counted against the non-test cap | runbook +12/-6, DEV-ONBOARDING +1/-1, HANDOFF +5/-1 |
| Total | about 485 even if this file counts | 800 | |
| Files | 11 (9 existing, 2 new: `settings-privacy-note.tsx` and this file) | 16 | |
| Migrations | 0 (no migration) | 0 | |
| Modules | 3: `apps/web` (components/me + e2e), config (`.env.example`, compose), docs | 3 | |

No B3 exception is needed: every figure is inside the pre-approved caps. Writers measure the real numbers with `b3-measure.sh`; an actual figure above any cap is a ruling request BEFORE the push.

## Threat model

Defends against:

1. Collecting personal data without notice. The purpose notice and the privacy note ship in the SAME PR and are committed BEFORE the commit that flips `GENDER_COLLECTION_ENABLED` (compose's `web` service reads an optional `../.env` copied from `.env.example`, so the flip reaches a developer's web container at once).
2. A fail-open enablement. The guard still needs the exact string "true", a map without the stub, and a passing registry probe; unset stays off; `worker.ts` and `route.ts:32` are byte-unchanged, and every committed default except the two named flags stays as it is (the CSP flag stays `false`).
3. An invented legal promise. Every sentence of the notice and the note carries a proof (Copy table) from code or a decision; no sentence states a legal basis, retention, third-party handling, a contact, a deletion SLA, a hosting location or a sensitivity class (Owner questions).

Not defended here (stated so nobody reads it as covered): that deliverers, projectors or tokens are ready for real use; legal review of PII collection (A3, DD-54: configuration does not replace it).

## Pinned defaults

Every row: default applied, pending owner sign-off (repeat the list in the PR body).

| # | Default | Pinned value |
|---|---|---|
| D1 | Notice copy | N1-N3 of Copy (pinned), ONE paragraph, three `t(vi, en)` calls separated by one space |
| D2 | Notice placement | `<p id="me-gender-notice" className={styles.caption}>` after the Select, before the consent label; `aria-describedby="me-gender-notice"` on the Select (the caller's spread wins over the computed value in `ui/select.tsx`, no edit there) |
| D3 | Privacy-note placement and file | new `apps/web/components/me/settings-privacy-note.tsx` exporting `GenderNotice` and `SettingsPrivacyNote`; the note is `<Card><section className={styles.section} aria-labelledby="me-privacy"><h2 id="me-privacy">` plus six `<p className={styles.caption}>`, rendered in `settings-view.tsx` directly after the Profile card, only while `profile.genderCollection`; header comment :15-21 updated ("two read-only sections" becomes three) |
| D4 | Tests | extend `settings-forms.test.tsx` (vi and en, ON and OFF, copy constraints) and `settings.spec.ts` (`expectUnset` asserts the notice and the note heading; one flag-ON axe screen); no new test file; the profile route tests already hold the true and false cases |
| D5 | Compose follows `.env.example` | `infra/docker-compose.yml:132` becomes `"true"` with the pinned honest comment (see Dispatch default) |
| D6 | Config docs edited | `.env.example` :83-99 and :173; compose :131-132; runbook :3 :10-11 :35; DEV-ONBOARDING :77; HANDOFF :304, :431 and one new dated Changelog row |
| D7 | Left unedited, listed as follow-ups | the two stale code comments (`worker.ts:82`, `queues.ts:12`), the stale `preflight.test.ts:259-261` comment, and every doc outside the ownership list or in a dated block (follow-ups list) |
| D8 | Commit order | C0 this file; C1 `settings-privacy-note.tsx` + form + view; C2 unit tests + e2e additions; C3 the flip: `.env.example` + `infra/docker-compose.yml` ONLY; C4 the three config docs. C1 and C2 precede C3; the PR body lists every SHA |
| D9 | Writer split | W1 C1; W2 C2 after W1; W3 C3 after C2; W4 C4; one file or one section per writer, at most 2 live workers |

## Copy (pinned)

Byte for byte, pasted as `t("vi", "en")`. No `"`, `'`, `&`, `<`, `>` or `|` inside any string (static markup escapes apostrophes). Proof tags: [M] re-read by this reviewer at the base, [A] answer files (V1 applies). Rendered only while the flag is on. If a pinned sentence collides with a locator or a sweep, STOP and report it: a reworded sentence needs a new proof.

| ID | vi (exact) | en (exact) | Proof |
|---|---|---|---|
| H | `Dữ liệu giới tính của bạn` | `Your gender data` | label of the card; names the data it explains (schema.ts:49-53 [A]) |
| N1 | `Giới tính của bạn được dùng để tính giá khi CLB đặt giá theo giới tính cho một kèo.` | `Your gender is used to work out the price when a club sets a price by gender for a session.` | view :62-66 [M]; charge-derivation.ts:8-12 :50 :69-71, session-form.tsx:223 :241-242, decisions.md:555-558 (DD-39) [A] |
| N2 | `Việc đặt giới tính là tuỳ chọn; nếu để chưa đặt, bạn trả giá mặc định của kèo.` | `Setting your gender is optional; if you leave it unset, you pay the default price of the session.` | form :147 [M]; route.ts:67-74, charge-derivation.ts:65, decisions.md:558 [A] |
| N3 | `CLB chỉ được dùng giới tính của bạn để tính giá nếu bạn đánh dấu ô bên dưới.` | `Clubs can use your gender for pricing only if you tick the box below.` | form :156-170 [M]; 0062:31 :134-139, charge-derivation.ts:65, me-settings.ts:188 [A] |
| P1 | `Giới tính của bạn được lưu ở dạng mã hoá trên hồ sơ Plexco của bạn.` | `Your gender is stored encrypted on your Plexco profile.` | 0062:2-5, schema.ts:40-53 (`persons`, no `tenant_id`), gender-crypto.ts:6 [A] |
| P2 | `Giới tính của bạn không được hiển thị cho CLB hay người chơi khác, và không xuất hiện trên bất kỳ trang công khai nào.` | `Your gender is not shown to clubs or other players, and it does not appear on any public page.` | route.ts:11-13, charge-derivation.ts:19 :27-28, session-read.ts:126-127, listing-summary.tsx:27, 0062:5-8, GP-1 gender-pricing-definers.test.ts:114-120 [A] |
| P3 | `CLB chỉ nhận mức giá được tính từ giới tính của bạn, không nhận chính giới tính đó.` | `Clubs receive only the price worked out from your gender, not your gender itself.` | charge-derivation.ts:19 :27-28 :69-71, 0062:106-139 [A] |
| P4 | `Bạn có thể đổi giới tính đã đặt bất cứ lúc nào bằng cách chọn lựa chọn khác rồi lưu.` | `You can change your gender at any time by choosing another option and saving.` | form :143-155 [M]; form :75-77, me-settings-client.ts:62-72, route.ts:67-74 [A] |
| P5 | `Để xoá giới tính khỏi hồ sơ, đặt lại thành Chưa đặt rồi lưu; quyền dùng giới tính để tính giá cũng bị tắt theo.` | `To remove your gender from your profile, set the field back to Not set and save; the pricing permission is switched off with it.` | form :150-153 [M]; me-settings-client.ts:67-71, route.ts:19-20 :77-78, me-settings.ts:185-186, 0062:56-88 [A] |
| P6 | `Để CLB ngừng dùng giới tính mà không xoá nó, bỏ đánh dấu ô cho phép rồi lưu.` | `To stop clubs using your gender without removing it, untick the box and save.` | form :156-170 [M]; me-settings-client.ts:69-70, me-settings.ts:188 [A] |

Counts: notice = N1-N3 (3 sentences, cap 3); note = P1-P6 (6 sentences, cap 6) plus the heading H. Constraints every pin was checked against: neither text holds "Gender not shared" or "Không chia sẻ giới tính" (settings-forms.test.tsx :112-113 still need that caption while consent is off, :124 forbids it with consent on [M]; e2e `getByText` :292 :303 [A]); neither repeats the full page-top prompt (unit `not.toContain(PROMPT)` :144-145 [M]); every Vietnamese string stays inside its pair so the English page holds no "giới tính" (e2e :323 [A]); the notice is a plain `<p>` with no input, select, checkbox, label or `role="status"`; no colour literal (tokens-only [A]); no string equals the consent label, the exact label "Giới tính" / "Gender", or an option label.

Not written, on purpose: legal basis, compliance claim, retention, deletion on account closure or from backups, third-party or vendor handling ("never shared with anyone"), any contact, hosting location, sensitivity class, "no one can infer your gender", any promise about future use, "held by the club", a revoke or view-consent CTA.

## Dispatch default: measured behaviour

Facts the lane records (nothing in this lane changes this code):

| # | Fact | Proof |
|---|---|---|
| F1 | The registry seed disables every projector: `INSERT INTO outbox_projectors (name) VALUES ('web_realtime'), ('zalo_dm'), ('public_sessions')` with `enabled boolean NOT NULL DEFAULT false`; the seed comment reads "Seeds: all DISABLED, so even with the schedule on every event acks with '{}'". A projector is enabled only by `outbox_projector_set_enabled` ("a runbook call, never a migration") | 0056:74, :105-108, :10-11, :157-181 [M] |
| F2 | `PROJECTORS` holds three real modules; `productionStubDeliver` "is no longer wired anywhere; it stays exported so that a projector map built from it can never be enabled by accident". So guard condition 2 cannot fire with the committed map | projectors/index.ts:21-25 [M], dispatcher.ts:51-55 [M], worker.ts:47 [M] |
| F3 | With the flag exactly "true": condition 1 passes, condition 2 passes, so the registry probe (migration 0056 applied) is the only refusal left. If it passes, the worker registers the schedule, the consumer and the wake LISTEN; while every projector is disabled (F1) events are acked with `{}` and NOTHING is delivered to Zalo, web or any public view. If it fails, the worker logs `outbox dispatch schedule OFF` plus the reason | worker.ts:63-79 :136-144 [A]; schedule.test.ts:542-563 [A]; worker.ts:84-86 [M]; runbook :44 :50 [A] |
| F4 | Therefore the lane-block sentence "the worker stays off until a real deliverer is configured" is NOT provable and is written nowhere; the provable rule is F3 | S0a2 O6 [A], F2 |
| F5 | The compose `worker` has no `env_file`; its `:132` literal is its only default and `.env.example` never reaches it; its `DATABASE_URL_DIRECT` is the `app_worker` role. Flipping `:132` is the only edit with a runtime effect: a stock local stack's worker on a migrated DB runs dispatch cycles that ack with `{}` | compose :123 :129-132 [M] |
| F6 | Decision (D5): compose follows `.env.example`. No test, script or CI step depends on `:132`; `scripts/db-reset-test.mjs` hashes the `postgres` service only (before/after hash equality is gate A11) | S0a2 O7 [A], Q4 |

Owner FYI for the PR body: after this PR, on any DB with migration 0056 a worker booted from the committed defaults schedules dispatch cycles that ack events with `{}`; nothing is delivered until the owner enables a projector and supplies the real Zalo bot token (owner P0, B3).

Pinned wording (each file keeps its own language; ASCII quotes only; no claim of delivery or enablement; the owner P0 steps named). Writers replace by anchor text, bottom-up, and keep every untouched line byte-identical.

`.env.example` :83-98 replaced and :99 flipped:

```md
# Cờ lịch outbox dispatch. Default commit = true (B3, DD-141; thay DD-134 (e) chỉ cho default commit này).
# Worker chỉ lên lịch khi cờ đúng chuỗi "true" (mọi giá trị khác, kể cả để trống, là tắt, fail-closed:
# xem isOutboxDispatchScheduleEnabled trong apps/bot/src/worker.ts), bản đồ projector không chứa
# productionStubDeliver, VÀ probe registry qua (migration 0056 đã áp dụng); không thì worker log
# "outbox dispatch schedule OFF" kèm lý do.
# "true" KHÔNG có nghĩa là đã gửi: projector seed tắt hết (migration 0056) nên event chỉ được ack với '{}'
# cho tới khi owner bật projector trong registry (docs/runbooks/outbox-dispatch-enable-rollback.md).
# Bật dùng thật là bước P0 của owner: deliverer Zalo thật, token bot Zalo thật, bật projector trong registry.
OUTBOX_DISPATCH_SCHEDULE_ENABLED=true
```

`.env.example` :173 (insert the two comment lines between :172 and :173; `CSP_SCRIPT_NONCE_ENABLED=false` stays):

```md
# Chỉ đúng chuỗi "true" bật thu thập giới tính (apps/web/app/api/me/profile/route.ts:32); default commit = true (B3, DD-141).
# Thông báo mục đích và ghi chú riêng tư hiển thị ở /me/settings khi cờ bật (components/me/settings-privacy-note.tsx).
GENDER_COLLECTION_ENABLED=true
```

`infra/docker-compose.yml` :131-132 (6-space indent kept):

```md
      # Default commit "true" (B3, DD-141): worker chỉ lên lịch khi cờ đúng "true", bản đồ projector không có stub
      # và probe registry qua (xem .env.example). Projector seed tắt hết nên event chỉ được ack, chưa gửi gì.
      OUTBOX_DISPATCH_SCHEDULE_ENABLED: "true"
```

Config docs (anchor text from the answer files, V1 applies):

```md
runbook :3  append: "; default commit của cờ lịch đổi thành `true` theo DD-141 (B3, 2026-10-21), thay DD-134 (e) chỉ cho default commit."
runbook :10-11  replace with: "- **Default commit của `OUTBOX_DISPATCH_SCHEDULE_ENABLED` là `true`** ở `.env.example` và `infra/docker-compose.yml` (B3, DD-141). Worker chỉ lên lịch khi cờ đúng chuỗi `"true"`, bản đồ projector không chứa stub **và** probe registry qua (migration `0056`); không thì log `outbox dispatch schedule OFF` kèm lý do. Cờ `true` không có nghĩa là đã gửi: projector seed tắt hết nên event chỉ được ack với `{}` cho tới khi owner bật projector; bật dùng thật là **bước P0 của owner** (deliverer Zalo thật, token bot Zalo thật, bật projector trong registry)."
runbook :35  replace with: "1. Projector vẫn tắt hết. Xác nhận worker chạy với `OUTBOX_DISPATCH_SCHEDULE_ENABLED=true` (default commit đã là `true`; đặt lại cho worker nếu môi trường đang ghi đè), restart worker"
DEV-ONBOARDING :77  replace with: "- **Gửi thật qua kênh** — cần owner bật projector trong registry (`outbox_projector_set_enabled`, runbook `outbox-dispatch-enable-rollback.md`); `zalo_dm` còn cần token Zalo thật (P0 của owner). `OUTBOX_DISPATCH_SCHEDULE_ENABLED` default commit `true` (B3, DD-141); worker chỉ lên lịch khi cờ đúng `"true"` và probe registry qua."
HANDOFF :304  replace only "nhưng schedule mặc định OFF," with: "; default commit của cờ lịch là `true` (B3, DD-141), worker chỉ lên lịch khi cờ đúng `"true"` và probe registry qua,"  (the rest of the sentence stays; follow-up)
HANDOFF :431  strike "giữ `OUTBOX_DISPATCH_SCHEDULE_ENABLED=false` tới khi có real projector + producer + replay/recovery" with ~~ ~~ and append: "⛔ **HẾT HIỆU LỰC 21/10 (DD-141)** — default commit nay là `true`; điều kiện bật dùng thật xem `docs/runbooks/outbox-dispatch-enable-rollback.md`;"
HANDOFF Changelog  ONE new dated row (read :502-523 first and copy the row shape; no PR number): "2026-10-21 — L22 p3-flags-default-on (B3, DD-141): default commit của `OUTBOX_DISPATCH_SCHEDULE_ENABLED` và `GENDER_COLLECTION_ENABLED` là `true` trong `.env.example` (và compose cho worker); thông báo mục đích và ghi chú riêng tư về giới tính ở /me/settings; chưa bật dùng thật, chưa gửi gì (bước P0 của owner)."
```

## Acceptance matrix and verification

| A | Case | Expected | Layer |
|---|---|---|---|
| A1 | flag ON, gender unset, vi and en | N1-N3 present once, after the Select and before the consent label; Select carries `aria-describedby="me-gender-notice"` | unit + e2e `expectUnset` |
| A2 | flag OFF | no notice, no note; every existing flag-OFF assertion stays byte-identical | unit |
| A3 | flag ON, SettingsView vi and en | note card directly after the Profile card: H plus P1-P6; the English page holds no "giới tính" | unit + e2e |
| A4 | copy constraints | none of the five constraints under the Copy table is broken | unit + tokens-only |
| A5 | consent on, or gender set | note still shown; consent-off caption behaviour unchanged (:112-113, :124) | unit |
| A6 | axe, flag ON screen, light and dark x 375 and 1280 | 0 serious or critical | e2e |
| A7 | profile route true and false | existing cases unchanged and green | unit |
| A8 | guard | worker tests green and unchanged; `git diff --name-only 6d7bfccac7401d0052be643d29e5bb0cbfbc0c0e..HEAD` holds no path under `apps/bot/`, no `route.ts`, no `queues.ts` | unit + diff |
| A9 | defaults | `OUTBOX_DISPATCH_SCHEDULE_ENABLED=true`, `GENDER_COLLECTION_ENABLED=true`, `CSP_SCRIPT_NONCE_ENABLED=false`, compose `:132` "true" | grep |
| A10 | commit order | C1 and C2 precede C3; C3 touches `.env.example` and compose only | `git log --name-only` |
| A11 | compose hash | `docker compose -f infra/docker-compose.yml config --hash=postgres` identical before and after the compose edit (sandbox off, read-only) | docker |
| A12 | no invented claim | the new copy holds none of: legal, retention, delete, backup, vendor, third-party, Singapore, contact | grep |

| V | Check | Expected |
|---|---|---|
| V1 | before using any [A] proof, anchor text or locator: `sed -n` the cited lines | the line says what this file says; else stop that item and report (never reword) |
| V2 | `git status --porcelain` empty and no `index.lock` before writing | clean |
| V3 | `pnpm typecheck`; `pnpm lint`; `pnpm format:check`; `pnpm kit:check` | pass |
| V4 | `pnpm review:check:changed` before each commit; `pnpm review:check` after | pass |
| V5 | `NODE_ENV=test pnpm --filter @plexco/web test` (FULL web vitest); `NODE_ENV=test pnpm --filter @plexco/bot test` (through the lock) | pass; one rerun for a known flake |
| V6 | Playwright settings spec through the lock (`pnpm --filter @plexco/web exec playwright test e2e/settings.spec.ts`) | pass |
| V7 | `pnpm build` once at the final head (sandbox off); `NODE_ENV=test DATABASE_URL_TEST=... pnpm -w test` through the lock | pass |
| V8 | language check of the repo CLAUDE.md on every text fence of changed docs | 0 diacritics |
| V9 | `b3-measure.sh` | every figure within the caps of B3 budget |
| V10 | `grep -c 'Co-Authored-By\|Generated with\|Claude-Session'` on commit messages and the PR body | 0 |

## Spec and docs follow-ups (not edited)

PR-body list; none is edited by this lane.

1. Reviewed spec, product or verdict docs: TDD.md :49 :552 :667 (DD-141's list) and :893 :901; PRD.md:278; ROADMAP.md:1219; slice-readiness-verdicts.md:575; `docs/features/FE/feature_user_settings.md:148-149` (consent string table: gains the notice and note strings); Draft `docs/channels/web/FE/feature_settings_fe.md` :61 and :227-246 (revoke-consent CTA, retention) [A].
2. Handoff and status docs outside the ownership list: BUILD-STATUS.md (:15 :29 :40 :50 :61 :68 :80 :128 :198 :212 :222 :251 :288), README.md :31 :176, BACKEND-HANDOFF-2026-09-26.md :33 :105 :203, `docs/sessions/2026-10-21-web-mvp-program-handoff-3.md` :25 :26 :98 :106 (the owner P0 list with the old default and old file:line pins), HANDOFF.md :304 remainder ("delivery la placeholder fail-closed; chua co ... real projector" is stale) [A].
3. `docs/standards/decisions.md` (L0/L17, never edited here): DD-141 cites DD-134 (e) at :2592 but it is :2729 at this base; R-19 :2179 and P-5 :1954 keep the old default and are not marked superseded [A].
4. Code comments left byte-unchanged: `worker.ts:82` ("Gated OFF by default"), `worker.ts:107` (generic log text printed for any OFF cause), `queues.ts:12` ("default false"), `preflight.test.ts:259-261` (stale `DATABASE_URL_DIRECT` claim) [M/A].
5. Test gap to hand to Phase 4: the settings e2e has no flag-OFF assertion (the default `World` is false, but no test asserts the gender field is absent) [A].

## Owner questions (not written)

For the PR body; no sentence in the product depends on any answer.

1. Legal basis or compliance wording for gender collection (A3 legal review; DD-54 says configuration does not replace it).
2. Retention period, and what happens to the stored gender on account closure (`persons.status` allows `deleted`; no erasure timing measured).
3. Third-party, vendor, backup and key-custody statements ("never shared with anyone", "also removed from backups").
4. A data-protection contact (none exists in apps/web or `docs/legal`; only the generic "contact the club host or Plexco support" copy).
5. A deletion SLA.
6. Hosting location (`docs/legal` DRAFT says Singapore; this program is local-only): not provable.
7. Whether gender is a sensitive class of personal data (an open counsel question in the DRAFTs).
8. Whether a public privacy page or a view-and-revoke consent flow should exist (no route exists today).

## Closure matrix (12 of 12)

| # | Gate | Evidence | Result |
|---|---|---|---|
| 1 | Authority snapshot pinned by SHA | `AUTHORITY_SHA` below = worktree HEAD at the step-0 start = PR 93 merge; every TARGET_FILES path exists | PASS |
| 2 | Decisions in scope are final | B3 confirmed by the owner, DD-141 on the base; copy and placement are Tier-B pins | PASS |
| 3 | Scope IN/OUT and owner clear | Negative scope, ownership, kit note above | PASS |
| 4 | Dependencies classified | L19 merged and is the base; L20 (P3-S15a) runs beside with disjoint files; PR 50 owner-only | PASS |
| 5 | Live schema and code match the claims | Q1-Q5, 0056 seed, projector map, guard, form and view anchors re-read at the base; [A] items gated by V1 | PASS |
| 6 | Data, API, state and auth contract complete | no route, schema or flag-reading change; copy table pins the only new behaviour | PASS |
| 7 | Fail-closed, idempotency, order | exact-"true" and the guard untouched; commit order D8 | PASS |
| 8 | Open questions in scope = 0 | D1-D9 pinned as defaults pending owner sign-off; unprovable statements are not written (Owner questions) | PASS |
| 9 | Acceptance matrix has expected results | A1-A12, V1-V10 | PASS |
| 10 | Migration, security and rollback pinned | no migration, no secret; security round opus/max; rollback = revert the single PR (flags back to false) | PASS |
| 11 | First slice has hard dependency merged | the base is the L19 merge | PASS |
| 12 | Implementation handoff ready | Pinned defaults, Copy, pinned wording, writer split, commit order, verification | PASS |

## Verdict

```text
REVIEW_POLICY_VERSION: 1.3
REVIEW_VERDICT: CODE_READY
REVIEWED_AT: 2026-10-21
AUTHORITY_SHA: 6d7bfccac7401d0052be643d29e5bb0cbfbc0c0e
BASE_BRANCH: main
TARGET_FILES:
  - .env.example
  - infra/docker-compose.yml
  - apps/web/components/me/settings-profile-form.tsx
  - apps/web/components/me/settings-view.tsx
  - apps/web/components/me/settings-forms.test.tsx
  - apps/web/e2e/settings.spec.ts
  - docs/runbooks/outbox-dispatch-enable-rollback.md
  - docs/00-start-here/DEV-ONBOARDING.md
  - docs/00-start-here/HANDOFF.md
SLICE: p3-flags-default-on
IN_SCOPE: a consent and purpose notice at the gender field and a flag-gated privacy note card at /me/settings (real t(vi, en) pairs, new file apps/web/components/me/settings-privacy-note.tsx) with unit and e2e tests; committed defaults of OUTBOX_DISPATCH_SCHEDULE_ENABLED and GENDER_COLLECTION_ENABLED set to true in .env.example and infra/docker-compose.yml (worker) with rewritten comments; the default-stating lines of the outbox runbook, DEV-ONBOARDING and HANDOFF
OUT_OF_SCOPE: any change to how the code reads either flag (exact string true only, unset is off), the worker guard, deliverer or probe (apps/bot, route.ts and queues.ts byte-unchanged), a migration, a real deliverer or bot token or production env, any claim that dispatch delivers or that an environment is enabled, a Reviewed spec, docs/product, docs/legal, decisions.md, gender pricing logic, docs outside the ownership list (listed as follow-ups), PR 50
G1_DECISION: PASS
G2_SPEC: PASS # config and UI slice: DD-141 (B3), DD-39 and its addendum, DD-138 L11 rows; Reviewed specs are not edited (follow-ups listed)
G3_DEPENDENCY: PASS
G4_TEST: PASS
G5_SCOPE: PASS # 11 files, 0 migrations, 3 modules, inside the pre-approved caps; guard and flag-reading code untouched
G6_EXTERNAL: ENABLEMENT_ONLY:A3-legal-review-DD-54,owner-P0-real-zalo-deliverer-bot-token-and-projector-enable # no provider call; the notice claims no legal sign-off and nothing here claims delivery
HARD_DEPENDENCIES: all merged with probes (L19 PR 93 merge 6d7bfccac7401d0052be643d29e5bb0cbfbc0c0e is the base and carries DD-141; probes: person_gender_update in 0062, outbox_projectors in 0056, the flag read in route.ts:32)
PRIOR_SLICES: L3 p3-m6-outbox-delivery-core (0056, worker guard); L11 p3-m9-gender-pricing (0062, profile route, form); L19 p3-owner-decisions-2026-10-21 (PR 93)
OPEN_QUESTIONS_IN_SCOPE: 0
ENABLEMENT_ONLY_GATES: A3 legal review of PII collection (DD-54: configuration does not replace it); owner P0 for real use: the real Zalo deliverer, the Zalo bot token and enabling projectors in the registry; none is claimed done or changed by this lane
LIVE_REPO_VERIFICATION: PASS # measured at base 6d7bfcc; [M] and [A] evidence split stated in the method note, [A] items gated by V1
CONTRACT_MATRIX: PASS
CLOSURE_MATRIX: PASS
ACCEPTANCE_MATRIX: PASS
SECURITY_AND_MIGRATION_GATE: PASS # no migration, no secret; the PII notice precedes the flip; the guard is untouched; an opus/max security round is required
IMPLEMENTATION_ARTIFACTS: PASS # DD-122 D4: RUN doc lane block, this file and the worktree at the exact base; no scope-gate lifecycle
FIRST_IMPLEMENTATION_STEP: W1 creates apps/web/components/me/settings-privacy-note.tsx (GenderNotice and SettingsPrivacyNote) with the Copy (pinned) strings byte for byte, wires the form (after the Select, with aria-describedby) and the view (after the Profile card, flag-gated), and commits C1 before any test or config change
REMAINING_BLOCKERS: none
```
