# Web MVP (PWA) — prompt theo mục tiêu · 2026-10-12

> **Cách dùng:** paste nguyên một khối `text` vào Claude Code mở tại root checkout. Thường chỉ cần
> **P — prompt điều phối**: nó tự đọc các mốc M0–M13 trong file này, tự chia slice, giao child agent và
> dừng ở cổng cuối mỗi đợt. Prompt từng mốc dùng khi muốn chạy lẻ hoặc dồn sức vào một mốc.
>
> **Prompt chỉ nêu mục tiêu + đầu ra.** Kiến trúc, thư viện, cách chia slice, thiết kế UI do model tự
> quyết. Thứ được ghim cứng chỉ gồm: 5 HARD RULES, workflow review/merge của repo, và bảng default cho
> các quyết định đang treo.
>
> Khối `text` là agent-facing ⇒ English; phần dẫn tiếng Việt là cho owner (khuôn
> `level3.1-slice-prompts.md`). **Đừng tin số trong file này** — đo tại `main@0db92b9` (28/09, không
> đổi tới 12/10): 49 migration · 15 API route (0 route đọc session) · 0 màn FE · BE readiness phase-1
> 39% · launch readiness 8%. Mỗi prompt tự đo lại.
>
> ✅ **File này được commit trong PR M0 (DD-122).** Các prompt vẫn trỏ đường dẫn tuyệt đối vào root checkout để
> chạy được từ worktree chưa rebase; sau khi M0 merge, đường dẫn tương đối trong repo là tương đương.

## Owner chốt 12/10 (phiên Cowork) — M0 ghi vào `decisions.md`

| # | Quyết định | Hệ quả |
|---|---|---|
| 1 | Gỡ FE PENDING (DD-116); model tự thiết kế UI, direction DD-81 làm input | DD-119 (`plexco.pen` do designer dựng) và gate `.pen` của DD-81/DD-58 không còn chặn FE |
| 2 | Scope = **full MVP** (BRD §5.1) | Ship 3 đợt lồng nhau: Launch (DD-113) ⊂ Phase-1 (DD-114) ⊂ MVP |
| 3 | Áp default khuyến nghị cho quyết định đang treo | Bảng `DEFAULTS` trong Shared contract; mỗi default thành một entry chờ ký, **owner merge PR = ký** |
| 4 | 1 prompt điều phối + prompt từng mốc | File này |
| 5 | **Review của chương trình = Claude subagent độc lập, không Codex, không scope-gate lifecycle** (prompt owner paste 12/10, mục REVIEW) | `decisions.md` **DD-122 D4** thắng đoạn WORKFLOW của Shared contract bên dưới và §2 mục 2 · §7.2 · §7.4 · §7.6 của `BACKEND-HANDOFF`, chỉ trong phạm vi chương trình |

> Cho tới khi PR của M0 merge, năm quyết định trên chỉ sống trong file này — đúng thứ DD-111 D4 cấm làm
> nguồn bền. Vì vậy prompt điều phối **chỉ chạy M0** khi M0 chưa có trên `origin/main`.
>
> **Một chỗ mình tự mở rộng, cần bạn xác nhận:** default của O4 trong inbox chỉ là *"trace read-only
> trước"*. Để M3 không đứng, bảng `DEFAULTS` thêm vế sau: *sau trace, chọn phương án chặt nhất (khoá
> riêng, chỉ process gọi Zalo được giải mã, audit mọi lần giải mã)*. Không đồng ý thì sửa dòng O4 trước
> khi chạy.

## Ba lớp scope

| Đợt | Gồm | Mốc | Cổng cuối đợt |
|---|---|---|---|
| **A — Launch** | DD-113: 5 khối (signin/signup · link Zalo · session management · session detail · settings) + tạo CLB self-serve (default DD-114-D6) + gạch nợ thủ công (baseline DD-40) | M0–M5 | E2E trên staging đủ 5 khối; **owner** quyết deploy production |
| **B — Phase-1** | Phần còn lại của DD-114: sync 2 chiều đạt SLO · toggle public/private · tiền `host_pro` (billing, đối soát CK, nhắc tự động) · privacy | M6–M8 | như trên |
| **C — MVP** | Phần còn lại của BRD §5.1: phía player (view, join web/Zalo, cross-club, discovery) · giá theo giới tính · in-app Chat · Messenger · email login · hardening | M9–M13 | như trên |

**Ngoài scope cả chương trình:** app native · membership (DD-115) · tournament/club tools · feed/kudos ·
rating công khai · fill-slot · web push · Telegram · thanh toán in-app/ví/thẻ.

> Scope này ≈ P0→P6 của ROADMAP. Cổng cuối mỗi đợt là chỗ bạn dừng được: Đợt A tự nó đã là một sản phẩm
> chạy được cho tenant #1.

## Mốc và thứ chặn

| Mốc | Nội dung | Cần trước | Chờ bên ngoài / owner |
|---|---|---|---|
| M0 | Ghi quyết định 12/10 · commit file này + `BACKEND-HANDOFF` · đo baseline | — | owner merge PR |
| M1 | Shell PWA + Google sign-in + tạo CLB | M0 | — |
| M2 | Không gian host: kèo, roster, gạch nợ thủ công | M0 | — |
| M3 | Zalo bot chạy song song · link CLB ⇄ bot · link account ⇄ Zalo | M1 | credentials Zalo OA (DD-14/15) · egress |
| M4 | Settings tối thiểu | M1, M3 | — |
| M5 | Sẵn sàng launch: staging, log, PITR, E2E, runbook tenant #1 | M1–M4 | owner deploy production (P0) · export data bot cũ |
| M6 | Sync 2 chiều live + public/private | M3 | owner bật `OUTBOX_DISPATCH_SCHEDULE_ENABLED` |
| M7 | Tiền `host_pro`: billing, đối soát CK, nhắc tự động | M2, M6 | ApiPay signed body · egress · tài khoản provider |
| M8 | Privacy + settings đầy đủ | M4 | trả lời luật sư A3 |
| M9 | Phía player · join · cross-club · discovery · giá theo giới tính | M6, M7 | quyết định Occupancy authority (chưa có default) |
| M10 | In-app Chat | M2 (`authorize()`), M9 | — |
| M11 | Messenger | M3, M9 | Meta App Review |
| M12 | Email/password | M1 | owner chọn email vendor (C7) |
| M13 | Hardening MVP | M9–M12 | owner thuê pen-test |

---

## 0. Shared contract — mọi prompt đọc trước

```text
PLEXCO WEB MVP PROGRAM - SHARED CONTRACT (read before running any milestone)

SOURCE OF AUTHORITY FOR THIS PROGRAM
- Owner decisions of 2026-10-12 (FE PENDING lifted, agent-owned UI design, scope = full MVP of
  docs/product/BRD.md section 5.1, recommended defaults applied). M0 records them in
  docs/standards/decisions.md. Until the M0 PR is merged on origin/main, M0 is the only milestone
  you may run.

READ FIRST
- docs/00-start-here/HANDOFF.md (newest LIVE TRUTH block only) and docs/00-start-here/DEV-ONBOARDING.md.
- docs/BACKEND-HANDOFF-2026-09-26.md: backend task map (tracks A-H) and the owner-decision table.
  Committed by the M0 PR (DD-122); a worktree based before that merge reads it from "$HOME/Projects/Plexco app".
- Behaviour authority: docs/features/FE/feature_<x>.md (Product/UX) + docs/features/BE/feature_<x>_tech.md,
  then docs/standards/decisions.md. Schema truth: packages/db/schema.ts + packages/db/migrations/*.sql.
  Identity: reuse persons / accounts / channel_identities / memberships; never add a parallel concept.
- docs/channels/web/FE/*_fe.md are reference input for screens, not a constraint.

MEASURE, DO NOT TRUST
- Every number, path and SHA in these prompts is a claim from 2026-10-12. Re-measure at your base
  (git rev-parse, pnpm progress, the code itself) before relying on any of it.

HOW TO BUILD IS YOUR CALL
- Architecture, libraries, routing, data fetching, offline strategy, component structure, slice graph,
  test design and visual design are yours to decide. Prefer what the repo already uses (Next.js App
  Router in apps/web, packages/core, packages/db, the bot worker) unless you can show it blocks the
  outcome. Record any new dependency or pattern as a proposal in decisions.md, in the same PR.
- docs/standards/frontend-architecture.md section 0 (FE-INV rules) holds. The rest of that document
  is a default you may deviate from with a recorded reason.

NON-NEGOTIABLE (repo HARD RULES - a violation is a real leak)
1. RLS fail-closed: every tenant-scoped query goes through tenantRepo / withTenant; never from a
   route handler or client code.
2. Money and PII never reach a public surface; public_sessions holds the whitelist only, and the
   invariant tests stay green.
3. No multi-master: Postgres + domain services are canonical; web and chat surfaces send commands
   and read projections.
4. A money-bearing claim or identity merge needs a strong factor: verified email on web, single-use
   link_code on the bot (DD-50). Name, alias or display name is never enough.
5. Every user-facing string is t(vi, en). No key-based i18n.
Also: GitNexus impact before editing a symbol and detect_changes before every commit; migrations are
append-only with the next free number (re-measure); agent-facing text in English.

DESIGN (DD-116 lifted by the owner on 2026-10-12)
- You own the UI design. Input: DD-81 direction (Energetic Orange primary, Sora headings, Inter body)
  and the token source of truth docs/standards/design-tokens.md. No .pen file is required; do not
  track design.pen or fe.pen.
- Acceptance bar for every screen: mobile-first at 375px and usable on desktop; light and dark;
  loading / ready / empty / error / offline states; WCAG 2.2 AA; tokens only, no hardcoded values.

DEFAULTS FOR OPEN OWNER DECISIONS - APPLY THEM, DO NOT STOP FOR THEM
| ID                    | Default to apply                                                          |
|-----------------------|---------------------------------------------------------------------------|
| Tier C #1             | First roster writer = host adds players on web. Bot self-join comes in M9.|
| DD-56-read-routes     | Session read routes ship behind authorize(), after the temporary gate is  |
|                       | replaced. No amendment #4 to the temporary gate.                          |
| O4 (Zalo secret)      | Read-only trace of the real secret readers/writers first, then the most   |
|                       | restrictive option: dedicated key, decrypt only in the process that calls |
|                       | Zalo, audit every decrypt.                                                |
| DD-114-D6             | Self-serve club provisioning, also for tenant #1.                         |
| DB_EXPECTED_ROLE      | Opt-in.                                                                   |
| C4 (Google OAuth)     | Enabled on staging for E2E. Production enable is owner-only.              |
| O2 (autonomy)         | autonomous_to_ready for P1/P2 slices. P0 stays prepare-only.              |
| Tier C #2 (language)  | Language per club via tenants.locale (DD-118). No member-level locale.    |
| DD-119                | Superseded by the M0 decision. plexco.pen is optional input if it exists. |
- For every default you rely on, the same PR adds or updates a decisions.md entry marked
  "default applied 2026-10-12, pending owner sign-off". The owner's merge is the sign-off.
- A decision with no default here (for example Tier C #6 outbox attempt bound, Occupancy authority,
  any open money rule): write a proposal with your recommendation, keep building everything that does
  not depend on it, and AWAIT only the dependent slice.

OWNER-ONLY (prepare, never execute)
- Merging any PR; production deploy; enabling a production flag or credential (GOOGLE_OAUTH_* in
  production, OUTBOX_DISPATCH_SCHEDULE_ENABLED, live payment-provider keys); messaging real users;
  external submissions (Meta App Review, lawyer packet, pen-test vendor); editing ap3/routines.json.
- Never fake an external provider or present a mock as done. Missing external input => AWAIT with
  one exact ask, and continue on unblocked work.

WORKFLOW
- PROGRAM OVERRIDE (owner 2026-10-12, recorded as decisions.md DD-122 D4): for every PR of this program
  the review gate is an independent Claude reviewer subagent (not the author; diff + specs + HARD RULES;
  findings blocking/should-fix/nit with file:line; at most 3 rounds; a second security-focused reviewer for
  auth, permissions, secrets, money, external input or deployment). Do NOT run scripts/codex-review-pin.sh,
  do NOT use scripts/autopilot-scope-gate register/ready or ap-finish, and do NOT HALT TOOL_UNAVAILABLE over
  a missing reviewer. Work on ordinary branches, one PR per coherent change. The quality gates and CI below
  are unchanged. The scope-gate / Codex sentences in the next bullet are kept for history and do not apply.
- Level 3 supervised autonomy per docs/autopilot-templates/level3-workflow.md: resolve the task
  contract (section 3); one writing slice = one branch + one worktree + at most one writer; register
  the runtime manifest and confirm .autopilot/state/<feature>/registered-manifest.sha256 exists before
  writing; verify with the repo's real commands (pnpm -w test with DATABASE_URL_TEST, typecheck,
  lint, format:check, review:check, build, and browser E2E when a slice crosses a real boundary);
  independent review through scripts/codex-review-pin.sh, plus a security round for anything touching
  auth, secrets, permissions, money, external input or deployment. Reviewer unavailable => HALT
  TOOL_UNAVAILABLE; never lower a gate yourself.
- Persisted plan/readiness documents follow docs/standards/review-code-readiness-gate.md and pass
  pnpm review:check:changed.
- This program does not run through ap3; do not queue its slices in ap3/queue.
- Clean the per-test plexco_* databases before and after a full test run (known trap, see HANDOFF).
- Every run ends in READY | AWAIT | HALT.

END-OF-RUN REPORT
- Terminal state and one line why.
- PRs and branches, each with its gate evidence (commands, exit codes, review verdicts).
- The milestone's DONE WHEN items, each PASS / FAIL / AWAIT with an evidence pointer.
- Defaults applied and proposals written in this run.
- The exact next action and who owns it.
```

---

## P — Prompt điều phối (paste cái này là chính)

```text
Read the SHARED CONTRACT in "$HOME/Projects/Plexco app/docs/autopilot-templates/web-mvp-2026-10-12-RUN.md"
first (or the same path in your checkout once M0 has landed), then docs/00-start-here/HANDOFF.md.

ROLE
You are the primary agent for the Plexco web MVP program. You own planning, slicing, delegating to
child agents, integration and verification. The owner reviews and merges; do not ask the owner
step-by-step questions.

OUTCOME
Plexco's full MVP (docs/product/BRD.md section 5.1) running on an installable web app (PWA) as the
primary surface, with the Zalo bot as the parallel channel and Messenger last. Ship it in three
waves; each wave must be usable on its own:
- Wave A - Launch (DD-113): a host signs up, creates a club, runs sessions end to end on the PWA
  (create, publish, announce, roster, manual mark-paid, close), links account and club to Zalo, and
  manages settings. Deployed to staging and proven end to end.
- Wave B - Phase-1 (DD-114): live two-way sync with the Zalo bot, public/private sessions with the
  fence, host_pro money (billing, transfer reconcile, automatic reminders, confirm-paid), privacy.
- Wave C - MVP (BRD section 5.1): player view and joins on web and Zalo, cross-club join,
  marketplace discovery, gender pricing, in-app chat, Messenger, email sign-in, production hardening.

The milestones M0-M13 in the RUN file define each outcome and its DONE WHEN. They are outcomes, not a
fixed plan: split, merge or reorder slices inside and across them as you see fit, as long as
dependency order, the shared contract and every DONE WHEN item hold.

EACH RUN
- If M0 is not merged on origin/main: run M0 only, stop at READY.
- Otherwise measure where the program stands (pnpm progress, merged PRs, each milestone's DONE WHEN
  against the code), choose the next unblocked work, and drive it to READY. Parallelism is your call;
  slices sharing migrations, shared state or generated artifacts run sequentially.

WAVE GATES - stop and report to the owner
- End of Wave A: M5 done (staging E2E for all five launch blocks plus manual mark-paid, tenant #1
  runbook, go/no-go note). The owner decides the production deploy.
- End of Wave B and end of Wave C: the same pattern with that wave's scope.

DELIVERABLES
- PRs, never merged by you, each READY with gate evidence.
- A program ledger at docs/sessions/web-mvp-program-status.md, written only by you as primary, in its
  own docs-only PR (never inside a slice PR): milestone table with state, PRs, blockers, defaults
  applied, open proposals, next action.
- At each wave gate: refreshed HANDOFF LIVE TRUTH block and ROADMAP progress pin, measured at HEAD.
- The end-of-run report from the shared contract.
```

---

## Prompt từng mốc

### M0 — Ghi quyết định 12/10 + đo baseline

Mốc duy nhất được chạy trước khi quyết định có mặt trong `decisions.md`. Bạn review và merge PR này là ký.

```text
Read the SHARED CONTRACT in "$HOME/Projects/Plexco app/docs/autopilot-templates/web-mvp-2026-10-12-RUN.md" first.

MILESTONE M0 - Record the 2026-10-12 owner decisions and measure the baseline
WAVE: A (prerequisite of every other milestone)

OUTCOME
The owner decisions of 2026-10-12 live in docs/standards/decisions.md, not only in this RUN file, so
every later slice can cite them. One docs-only PR, ready for the owner to merge; the merge is the
owner's signature.

DONE WHEN
- decisions.md has a new entry (next free DD number - re-measure) that: lifts the FE PENDING order of
  DD-116 for the full MVP scope; makes the implementing agent the owner of UI design, with DD-81
  direction as input and the acceptance bar of the shared contract; marks DD-119 superseded; states
  which .pen-based gates of DD-81 / DD-58 no longer apply; records scope = BRD section 5.1 shipped as
  Waves A/B/C; records every row of the shared-contract DEFAULTS table as "default applied, pending
  owner sign-off". Status: owner decision 2026-10-12, effective on merge.
- The DD index row, version bump and changelog follow decisions.md's own conventions.
- Statements that would now mislead a reader are annotated with a pointer to the new entry, at least:
  the FE PENDING lines in the HANDOFF LIVE TRUTH block and the ROADMAP FE block, the status boundary
  of docs/standards/frontend-architecture.md, the authority boundary of docs/standards/design-tokens.md,
  and the docs/project/decisions-inbox.json items that this decision closes. Annotate; do not rewrite
  Reviewed specs.
- This RUN file and docs/BACKEND-HANDOFF-2026-09-26.md are committed (both are untracked today).
- The PR body records the baseline: HEAD SHA, pnpm progress output, and a full gate run (pnpm -w test,
  typecheck, lint, format:check, review:check, build) with exit codes.
- pnpm review:check:changed passes.

OUT OF SCOPE: any code, migration or UI.
```

### M1 — Shell PWA + Google sign-in + tạo CLB

```text
Read the SHARED CONTRACT in "$HOME/Projects/Plexco app/docs/autopilot-templates/web-mvp-2026-10-12-RUN.md" first.

MILESTONE M1 - Installable web app, Google sign-in, create club
WAVE: A (launch block 1; DD-114 groups 1-2)

OUTCOME
A host opens Plexco on a phone, installs it to the home screen, signs in with Google, creates a club,
and lands in their club workspace in the club's language. A returning host stays signed in. Without
network the installed app shows a usable shell, never a browser error page.

DONE WHEN
- Installable on Android Chrome and iOS Safari: web manifest, service worker, offline fallback,
  icons. Record how each platform was verified.
- Google sign-in, sign-out and session rotation work end to end on staging and match
  feature_web_auth_onboarding.
- Self-serve club creation works through the onboarding routes, including the club configuration the
  spec requires; the new tenant is RLS-isolated and the isolation invariant tests stay green.
- UI language follows tenants.locale (DD-118); every new string is t(vi, en).
- Every screen meets the design acceptance bar of the shared contract; a11y verified by an automated
  check plus a manual keyboard and screen-reader pass noted in the PR.
- Backlog row web-pwa-manifest-and-service-worker is closed with its merged probe; from then on the
  docs may say "PWA" (DD-113).
- Repo gates green, plus browser E2E covering install -> sign in -> create club -> workspace.

AUTHORITY: feature_web_auth_onboarding, feature_multi_tenant, feature_connector_onboarding,
feature_club (Product + BE tech); DD-13, DD-80, DD-113, DD-118.
OUT OF SCOPE: email/password (M12), web push, Zalo linking (M3).
```

### M2 — Không gian host: kèo, roster, gạch nợ thủ công

```text
Read the SHARED CONTRACT in "$HOME/Projects/Plexco app/docs/autopilot-templates/web-mvp-2026-10-12-RUN.md" first.

MILESTONE M2 - Host session workspace with roster and manual mark-paid
WAVE: A (launch blocks 3-4; DD-40 baseline)

OUTCOME
A host runs a whole session from the web app: sees their session list; creates, edits, publishes,
announces, closes or cancels a session; opens one to see roster, free slots and status; adds players;
and marks who has paid (cash or bank transfer, single tap or multi-select). Money state stays correct
under concurrency and never leaks across tenants or to public surfaces.

DONE WHEN
- Session routes are authorized by the capability-based authorize() that replaces the temporary gate
  in apps/web/lib/session-command-route.ts (DD-56; BACKEND-HANDOFF A1-A2). The temporary gate and its
  role allowlist are gone. Session read routes exist behind authorize().
- The first roster writer exists (host-add). Manual mark-paid writes payment allocations per DD-40,
  with ledger constraints: allocation within [0, amount], a charge is paid only when fully covered,
  every reversal is audited.
- Session list and session detail cover every state and error of feature_session_management
  (including capacity errors), rendered from the BE error catalog and failing closed on unknown errors.
- Announce is wired as a command; its delivery to Zalo is proven in M3/M6.
- Decision table for every money and permission branch, abuse cases and concurrency tests; RLS and
  public-whitelist invariant tests green; security round on the authz and money slices.

AUTHORITY: feature_session_management, feature_session_organize, feature_tenant_routing_authz,
feature_payment_reconcile (manual part) - Product + BE tech; DD-40, DD-56, DD-117;
BACKEND-HANDOFF tracks A and C1-C3.
OUT OF SCOPE: automatic reconcile and reminders (M7), player self-join (M9), public listing (M9).
```

### M3 — Zalo bot chạy song song + link

Đây là mốc hay bị chặn bởi thứ bên ngoài nhất (credentials Zalo OA, egress). Agent sẽ land phần chứng minh được và AWAIT đúng một câu hỏi cho mỗi thứ thiếu.

```text
Read the SHARED CONTRACT in "$HOME/Projects/Plexco app/docs/autopilot-templates/web-mvp-2026-10-12-RUN.md" first.

MILESTONE M3 - Zalo bot as a working parallel surface
WAVE: A (launch block 2; DD-114 groups 3-4)

OUTCOME
A host connects their club's Zalo bot to Plexco from the web app; a user links their Plexco account to
their Zalo identity with a one-time code; bot commands act on the same canonical data the web app
shows. One human ends up as exactly one Person.

DONE WHEN
- The inbound Zalo webhook is durable (store before process), verified per tenant with a timing-safe
  check, and idempotent. The specs disagree on the webhook shape (PRD, feature_connector_onboarding
  tech, feature_zalo_channel tech): pick one, record it as a proposal, annotate the others.
- Club <-> bot linking (tenant routing) works from the web app. The bot secret is encrypted at rest
  per the O4 default, with rotation and an audited decrypt path.
- Account <-> Zalo linking uses the existing link_code functions (their first production caller),
  single use, through the existing identity tables only.
- A link that would merge or claim an existing Person with debt is refused with an explanation; the
  merge/claim path itself is P0 - prepared, not executed.
- Bot replies are t(vi, en) in the club's locale.
- A staging run against a real Zalo OA shows linking plus one command round trip. Without credentials:
  AWAIT with the exact ask and land everything provable without them.

AUTHORITY: feature_zalo_channel, feature_connector_onboarding, feature_identity,
feature_tenant_routing_authz (Product + BE tech); docs/00-start-here/identity-model.md (orientation);
DD-14, DD-15, DD-50, DD-67; docs/autopilot-templates/ap23-inbound-webhook-RUN.md.
OUT OF SCOPE: web-to-Zalo projections beyond what linking needs (M6), player join on Zalo (M9),
Messenger (M11).
```

### M4 — Settings tối thiểu

```text
Read the SHARED CONTRACT in "$HOME/Projects/Plexco app/docs/autopilot-templates/web-mvp-2026-10-12-RUN.md" first.

MILESTONE M4 - Settings, launch minimum
WAVE: A (launch block 5)

OUTCOME
A signed-in user manages a minimal profile, sees and unlinks their linked channels and sets reminder
preferences; a club owner sets the club's language.

DONE WHEN
- Profile, linked channels (unlink respects the identity rules of M3), reminder preferences, club
  language via tenants.locale. No member-level locale.
- Writes go through domain services under RLS; no PII field beyond what feature_user_settings defines.
- Screens meet the design acceptance bar; repo gates and browser E2E green.

AUTHORITY: feature_user_settings (Product + BE tech); DD-113 D2 block 5; DD-118.
OUT OF SCOPE: privacy controls, export, deletion (M8); gender pricing (M9).
```

### M5 — Sẵn sàng launch (cổng cuối Đợt A)

Kết thúc mốc này bạn nhận một go/no-go note. Deploy production là việc của bạn (P0).

```text
Read the SHARED CONTRACT in "$HOME/Projects/Plexco app/docs/autopilot-templates/web-mvp-2026-10-12-RUN.md" first.

MILESTONE M5 - Launch readiness on staging
WAVE: A (wave gate)

OUTCOME
Tenant #1 can be run for real. The Wave A build runs on staging exactly as production would, is
observable and recoverable, and is proven end to end. The owner can push production with one decision.

DONE WHEN
- Staging on DigitalOcean App Platform + Managed Postgres in a VPC (DD-04, DD-10) deploys from CI.
  Production config and workflow exist but are not run.
- Structured logs with level and tenant_id and no PII; error reporting wired.
- Backup + PITR restore drill on staging; measured RPO/RTO recorded in docs/standards/environments-setup.md.
- Browser E2E on staging for all five launch blocks plus manual mark-paid, phone profile at 375px and
  desktop, both languages.
- Tenant #1 runbook: provisioning, Zalo bot connect, importing the old single-club bot's data
  (ROADMAP module #6) if the owner provides an export, rollback.
- HANDOFF LIVE TRUTH and ROADMAP progress re-pinned to the measured HEAD.
- Go/no-go note for the owner: what is live, what is behind a flag, every default still pending sign-off.

AUTHORITY: docs/standards/deployment-infra.md, docs/standards/environments-setup.md; DD-04, DD-10;
BACKEND-HANDOFF track E.
OUT OF SCOPE: the production deploy itself; launch communication.
```

### M6 — Sync 2 chiều live + public/private

```text
Read the SHARED CONTRACT in "$HOME/Projects/Plexco app/docs/autopilot-templates/web-mvp-2026-10-12-RUN.md" first.

MILESTONE M6 - Live two-way sync and public/private sessions
WAVE: B (DD-114 group 5)

OUTCOME
Whatever a host or player does on web or Zalo shows up on the other surface quickly and exactly once,
failed deliveries are recoverable, and a club owner can mark a session public or private without a
private or cancelled session ever being exposed.

DONE WHEN
- A real projector replaces productionStubDeliver; delivery is idempotent; DLQ entries can be
  inspected and replayed; outbox attempts are bounded (Tier C #6 has no default: propose, AWAIT only
  that slice).
- Sync lag meets NFR-1c (p95 <= 3s) under a load you state, measured and recorded.
- The shared scheduler runs; stale drafts auto-expire as feature_session_management specifies.
- Public/private toggle with the immediate-deny fence per DD-114 D3 option (b); no public_sessions
  projection in this wave.
- Everything ships with OUTBOX_DISPATCH_SCHEDULE_ENABLED off; the PR gives the owner exact enable and
  rollback steps.

AUTHORITY: feature_sync_engine, feature_channel_booking_funnel (sync part),
feature_marketplace_discovery (fence part) - Product + BE tech; DD-12, DD-114 D3; BACKEND-HANDOFF track B.
OUT OF SCOPE: public listing and discovery (M9).
```

### M7 — Tiền `host_pro`

Vế tiền là Tier C (DD-107): agent làm tới READY cho phần đã chốt, mọi luật tiền chưa chốt thành proposal + AWAIT.

```text
Read the SHARED CONTRACT in "$HOME/Projects/Plexco app/docs/autopilot-templates/web-mvp-2026-10-12-RUN.md" first.

MILESTONE M7 - host_pro money: billing, transfer reconcile, automatic reminders
WAVE: B (DD-114 group 6, money side)

OUTCOME
A club can subscribe to host_pro. For those clubs, incoming bank transfers are matched to debts
automatically, unmatched transfers land in a queue the host resolves, and players get reminders and
paid confirmations. Free clubs keep manual mark-paid. Plexco never holds player money.

DONE WHEN
- Billing lifecycle with an entitlement reader: the first production caller of resolveCapability()
  gates automatic reconcile and automatic reminders; suspended/expired behaviour follows the
  Suspended Action Matrix.
- Provider webhook (current authority: SePay / ApiPay) is durable, verified and idempotent:
  transaction -> allocation -> charge/debt -> unmatched queue.
- Automatic reconcile shows as available only when the full gate chain passes (entitlement, market,
  provider, bank, currency, consent, runtime) and is never presented as a global capability.
- Scheduled reminders, manual remind and confirm-paid notifications on web and Zalo.
- Decision tables for every money branch, abuse cases, concurrency tests, security round on every
  slice. Money rules the specs leave open are Tier C (DD-107): propose and AWAIT that slice.
- No live provider keys. Missing external evidence (ApiPay signed body, egress) => AWAIT with the
  exact ask.

AUTHORITY: feature_billing_lifecycle, feature_payment_reconcile, feature_notifications_reminders
(Product + BE tech); DD-29, DD-30, DD-40, DD-110, DD-114 D2; BACKEND-HANDOFF C4-C7.
OUT OF SCOPE: in-app payment, cards, wallets, holding funds.
```

### M8 — Privacy + settings đầy đủ

```text
Read the SHARED CONTRACT in "$HOME/Projects/Plexco app/docs/autopilot-templates/web-mvp-2026-10-12-RUN.md" first.

MILESTONE M8 - Privacy and full settings
WAVE: B (DD-114 group 7)

OUTCOME
A user can see what Plexco holds about them, control who sees their profile and activity, export
their data and request deletion, within what the A3 PII data-class matrix allows.

DONE WHEN
- Privacy controls, data export and deletion request flows per feature_user_settings.
- Deletion and retention respect the ledger: money records kept on their legal basis, PII minimized.
- A3 legal is a hard gate: until the owner records the lawyer's answer, land only what the matrix
  already settles and AWAIT the rest.

AUTHORITY: feature_user_settings, feature_security_operations (Product + BE tech); DD-114 (A3 blocker).
OUT OF SCOPE: anything the A3 answer has not settled.
```

### M9 — Phía player + discovery

```text
Read the SHARED CONTRACT in "$HOME/Projects/Plexco app/docs/autopilot-templates/web-mvp-2026-10-12-RUN.md" first.

MILESTONE M9 - Player side: join, cross-club, discovery, gender pricing
WAVE: C

OUTCOME
A player finds sessions across clubs and sports, joins from the web app or by replying in Zalo, sees
their upcoming sessions and debts across clubs, and is charged the price that applies to them.

DONE WHEN
- Player view across clubs; a player's debts are visible only to that player and their hosts.
- Join via web and via Zalo number-reply through the channel booking flow (intent, hold, occupancy,
  verified-payment finalizer - DD-32); pay-later claims follow HARD RULE 4. Bot self-join now
  complements host-add.
- Cross-club join.
- Public read model: a public_sessions projector writing the whitelist only, respecting the fence,
  plus discovery/search UI. Occupancy authority has no default: propose and AWAIT that slice.
- Gender pricing (DD-39) for hosts, with its effect on charges covered by decision tables.

AUTHORITY: feature_player_view, feature_cross_club_join, feature_marketplace_discovery,
feature_channel_booking_funnel, feature_home (Product + BE tech); DD-12, DD-32, DD-39.
OUT OF SCOPE: skill matchmaking, fill-slot, ratings, feed.
```

### M10 — In-app Chat

```text
Read the SHARED CONTRACT in "$HOME/Projects/Plexco app/docs/autopilot-templates/web-mvp-2026-10-12-RUN.md" first.

MILESTONE M10 - In-app chat
WAVE: C

OUTCOME
Players and hosts talk inside Plexco - club and session conversations and direct messages - under the
safety and moderation rules already decided. Chat lives only in Plexco.

DONE WHEN
- Chat command core on the existing chat_* tables, authorized through authorize(); own edit and soft
  delete, search, offline signal/digest and moderation as decided in DD-92..DD-95.
- Open spec scope (group, pin, poll, embed): propose and AWAIT; ship the decided core.
- Realtime delivery in the web app; no chat content in public surfaces or logs.

AUTHORITY: feature_inapp_chat (Product + BE tech); DD-38, DD-55, DD-86, DD-91..DD-95;
docs/autopilot/contracts/autopilot-chat-shared-message-command-core.md; BACKEND-HANDOFF track F.
OUT OF SCOPE: bridging chat into Zalo or Messenger groups.
```

### M11 — Messenger

```text
Read the SHARED CONTRACT in "$HOME/Projects/Plexco app/docs/autopilot-templates/web-mvp-2026-10-12-RUN.md" first.

MILESTONE M11 - Facebook Messenger channel
WAVE: C

OUTCOME
Hosts and players use Plexco from Messenger through the central Plexco Page, with an optional
club-owned Page, inside Meta's messaging-window rules.

DONE WHEN
- Webhook, adapter, identity link and join/confirm flows reuse the M3 patterns; behaviour outside the
  24-hour window follows BRD CO-3 (best-effort reminders, fall back to web and Zalo).
- An App Review submission package is ready for the owner; until approval, Messenger ships behind a
  flag, off.

AUTHORITY: feature_player_messenger (Product + BE tech); BRD CO-3; DD-37.
```

### M12 — Email/password

```text
Read the SHARED CONTRACT in "$HOME/Projects/Plexco app/docs/autopilot-templates/web-mvp-2026-10-12-RUN.md" first.

MILESTONE M12 - Email and password sign-in
WAVE: C

OUTCOME
Users can sign up and sign in with email and password as an alternative to Google; a verified email
is a strong factor for money-bearing claims.

DONE WHEN
- ROADMAP module 3c finished: verification, reset, rate limits and epoch revoke per DD-80, behind a flag.
- Email delivery waits on the owner's vendor choice (C7): AWAIT that part, land the rest behind the
  flag, off.
- Any Telegram-era auth code still present is removed.

AUTHORITY: feature_web_auth_onboarding (Product + BE tech); DD-37, DD-50, DD-80; BACKEND-HANDOFF track G.
```

### M13 — Hardening MVP (cổng cuối Đợt C)

```text
Read the SHARED CONTRACT in "$HOME/Projects/Plexco app/docs/autopilot-templates/web-mvp-2026-10-12-RUN.md" first.

MILESTONE M13 - MVP hardening
WAVE: C (wave gate)

OUTCOME
The MVP is ready for public use: tested against abuse and load, observable, and every NFR either
evidenced or named as a gap.

DONE WHEN
- Load test at a target you choose and justify from the NFRs, with results.
- Security review of the full public attack surface; findings fixed or recorded with owner-facing risk.
- A pen-test scope package for the owner (the external pen-test is owner-run).
- Each NFR in docs/product/BRD.md section 8 and the docs/product/TDD.md NFR table has evidence or a
  named gap.
- Go/no-go note for public launch, same shape as M5.

AUTHORITY: feature_security_operations (Product + BE tech); BRD section 8; TDD NFR table; ROADMAP P6.
```

---

## Kiểm trước khi paste / commit

```bash
awk '/^```text$/{f=1;next} /^```$/{f=0} f' docs/autopilot-templates/web-mvp-2026-10-12-RUN.md \
  | grep -P '[àáảãạăâđèéẻêìíỉòóỏôơùúủưỳýỵ]'   # phải rỗng
```
