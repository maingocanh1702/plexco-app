# Bestminton Latest Scan -> Plexco Reuse Notes

> Ngay quet: 2026-06-21 (Asia/Ho_Chi_Minh)  
> Source: [bestmintonclub-payment-check-bot](https://github.com/maingocanh1702/bestmintonclub-payment-check-bot) (local checkout tại thời điểm quét)<br>
> Source branch/HEAD: `Payment-check` @ `e191ba7` (`2026-06-21 21:34:13 +0700`)  
> Target repo: Plexco app `main` @ `367b1b5`  
> Muc dich: cap nhat nhung feature/update moi nhat cua Bestminton va ghi lai phan co the tham khao/ke thua cho Plexco.

## 1. Ket luan nhanh

Ban phan tich cu `docs/research/bestminton-to-plexco-analysis.md` van dung o diem lon: Plexco nen lift pure logic vao `packages/core`, khong nen copy nguyen bot SQLite. Tuy nhien Bestminton da tien them mot lop quan trong sau ban do: player self-service, credit/refund, paid leave, buddy-managed roster, multi weekly templates, bank receive health va nhieu invariant tien.

Phan dang ke thua nhat cho Plexco khong phai `bot.ts`/`zbot.ts`, ma la:

- decision tables da duoc test quanh tien/refund/credit;
- shared core pattern giua Telegram va Zalo;
- memo/pay_code/VietQR rules de tranh match sai;
- bank/provider health UX;
- test fixtures cho Vietnamese name matching, partial payment, overpay, combo-pay, refund/credit va transport drift.

## 2. Tinh trang source Bestminton

| Hang muc | Ghi nhan |
|---|---|
| Branch | `Payment-check` |
| HEAD | `e191ba7` merge `origin/main` vao `Payment-check` |
| Latest code commit noi bat | `46faf22 fix(payments): pick manual transfer due sessions` |
| Recent merged PRs | Payment-check, Weekly-setup, paid-leave/refund/credit, Join-with-buddies, Telegram inline buttons |
| Test files | 37 `*.test.ts` trong `src/` |
| Working tree | Dang dirty o docs/.claude/scripts/AGENTS/HANDOFF; `git diff --stat` khong co source `src/*` thay doi |

Vi working tree Bestminton co nhieu docs/autopilot file chua commit, cac plan/backlog trong `docs/` nen xem la reference moi nhat nhung khong mac dinh la shipped. Phan source code shipping nen neo vao HEAD va git log.

## 3. Latest Feature Delta Tu Bestminton

| Feature/update moi | Evidence | Gia tri cho Plexco |
|---|---|---|
| Manual transfer due sessions va goi y past-session unmatched | `46faf22`, `c9ebf46`, `src/manual-transfer-core.ts`, `src/payments.ts`, `src/prompts.ts` | Nen dua vao P3 `/unmatched`: host can thay cac session da/den ngay ma con no, khong chi open/current session. |
| Multi weekly templates | `9bb8779`, `src/weekly-core.ts`, `src/weekly-core.test.ts` | Nen tham khao cho P2 recurring sessions: multi-template, dedupe, legacy migration, due generation. Plexco phai doi sang RRULE + timezone. |
| Paid leave -> refund/credit | `src/paid-leave-core.ts`, `src/refund-ledger.test.ts`, `src/player-credit-core.ts` | Rat huu ich cho policy khi player da tra tien nhung roi session. Plexco nen ke thua state table/test cases, nhung implement bang immutable charge/allocation/reversal ledger. |
| Batch remove paid players | `d8a2cd4`, `src/remove-paid-core.ts` | Nen co flow host batch remove co preview tong tien va disposition: refund, credit, unpay. Day la UX tot cho P2/P3 session cancellation/roster cleanup. |
| Buddy-managed roster actions | `38be16c`, `src/buddy-actions-core.ts`, `src/buddy-actions-core.test.ts` | Nen ke thua model "managed subjects": payer co the join/leave cho buddies duoc allow-list. Can gan voi Plexco Membership/Person authz. |
| Refund transfer QR | `e257aa1`, `src/paid-leave-core.ts` (`parseRefundBankInfo`, `buildRefundTransferQr`) | Nen dung lam reference cho host refund settlement: parse bank info, resolve VN bank alias, build memo <= 25 chars, VietQR amount-fixed. |
| Unified payment instruction/memo core | `src/payment-instructions.ts`, `src/pay-core.ts` | Day la asset lon: memo NAPAS-safe, `pay_code` deterministic, QR fallback, TG/Zalo thin adapters. Nen lift thang logic memo/test, tach DB dependency. |
| Bank receive health | `src/banks.ts`, `src/bank-receive-health.test.ts` | Nen dua vao onboarding bank account: tach provider liveness va per-account receive proof. Khong duoc noi "account OK" neu provider khong tra account number. |
| Owner-host link/identity unlink | `src/owner-host-link.ts`, `src/identity-unlink-core.ts` | Huu ich nhu decision-table reference cho identity. Plexco khong nen auto-merge bang fuzzy neu membership co tien; phai dung OTP/verified evidence theo BL-ID. |
| Club identity/contact | `src/club.ts`, `src/club.test.ts` | Nen lift concept tenant profile + host contact channels + QR fallback. Plexco can tenant-scoped encrypted contacts va public whitelist. |
| Cross-transport shared core | `src/pay-core.ts`, `src/leave-core.ts`, `src/buddy-actions-core.ts`, `src/payment-instructions.ts` | Day la pattern nen chuan hoa som: domain/core service dung chung, Telegram/Zalo chi render UI/callback/reply-context. |

## 4. Patterns Nen Ke Thua

### 4.1 Shared core, adapter mong

Bestminton da rut nhieu logic ra khoi transport:

- `/pay`: `pay-core.ts` + `payment-instructions.ts`;
- leave: `leave-core.ts`;
- buddy roster: `buddy-actions-core.ts`;
- weekly: `weekly-core.ts`;
- identity/unlink/contact: helper core rieng.

Plexco nen ap dung cung huong nhung dat dung lop:

```text
apps/bot adapters -> app/domain services -> packages/core pure helpers -> tenantRepo/ledger
```

Khong copy logic vao ca Telegram va Zalo. Neu cung mot quyet dinh xuat hien o >=2 surface, no phai nam trong service/helper chung.

### 4.2 Pay code la khoa tien, fuzzy chi la fallback

Bestminton lessons lap lai nhieu lan: multi-person/money path dung fuzzy se gay wrong-pay. Combo/multi-person nen dua vao `pay_code` deterministic hoac manual host allocation. Plexco P3 hien phase-gate pay-code den P4 rollout, nhung nen thiet ke schema/test tu dau de khong phai rewrite:

- `memberships.pay_code` deterministic, tenant-scoped;
- parser pay-code co feature flag;
- khong issue memo chi-co-code truoc rollout;
- matcher chi de xuat allocation plan, ledger service moi duoc write.

### 4.3 Money single source of truth

Bestminton da co invariant: dung `paid_amount`/effective amount lam source, khong tinh lai tien moi call site. Plexco nen chot tu dau:

- charge amount due;
- effective allocations/reversals;
- derived `amount_allocated` chi do ledger service recompute;
- refund/credit/cancellation khong duoc cap tien bang cong thuc rieng o transport.

### 4.4 Fail-closed voi tien

Nhung case Bestminton da xu ly tot nen dua vao P3/P3.5 tests:

- unknown fee -> khong auto settle;
- amount less than matched people -> manual review;
- overpay -> settle phan chac chan, remainder/unallocated review;
- paid player remove -> phai chon refund/credit/unpay;
- credit-only khac real-money; khong auto-refund tien that.

### 4.5 Bank/provider health phai tach 2 tang

Bestminton tach:

- provider da tung gui webhook hop le;
- account cu the da tung nhan giao dich.

Plexco onboarding bank account nen co cung UX. Neu ApiPay/OCB khong tra account number thi khong duoc coi per-account proof la OK; chi co provider liveness.

## 5. Mapping Sang Plexco Roadmap

| Plexco phase | Nen ke thua | Khong nen copy |
|---|---|---|
| P0-P1 Foundation | `matching.ts`, `dates.ts`, `vietqr.ts`, bank alias resolver, memo builders, amount classifiers, tests | SQLite `db.ts`, global settings, in-process singleton state |
| P2 Session Management | `weekly-core.ts` decision/tests, `leave-core.ts` leave blocks, batch-remove UX | Date-only session model; Plexco phai dung `starts_at/ends_at` + timezone/RRULE |
| P3 Payment Reconciliation | `payments-logic.ts`, `payment-instructions.ts`, bank health, manual transfer due-session UX, BL-2 test cases | Direct `markPaid`/`paid_method`; Plexco phai dung immutable `bank_transactions` + `payment_allocations` |
| P3.5 Identity | owner-host link decision table, unlink parser, buddy subject authorization | Auto-claim/merge bang ten/fuzzy tren membership co tien |
| P4/P4.3 Web + Sync + Marketplace | shared domain service/outbox mindset, public/private contact separation | Bot-local projection state |
| P4.5-P4.7 Player channels | TG inline callback validation, Zalo number-reply state, shared pay/leave/join core | Transport handlers lon (`bot.ts`, `zbot.ts`) vi tightly coupled SQLite |
| P5 Billing | invoice/payment memo discipline, separate platform payment flow principles | Tuyet doi khong tron player ledger voi billing ledger |

## 6. De Xuat Cap Nhat Cho Plexco Docs

1. Payment Reconciliation spec nen them explicit test fixtures tu Bestminton:
   - `classifyAmount`, `classifyIncoming`, `classifyCoverage`;
   - partial deposit;
   - overpay/remainder;
   - unknown fee fail-closed;
   - multi-person pay-code vs fuzzy/manual.

2. Session Management spec nen them recurrence detail tu `weekly-core.ts`:
   - multiple recurring templates;
   - duplicate detection;
   - legacy migration/backfill;
   - generate today/tomorrow idempotently, nhung doi sang RRULE + timezone cho Plexco.

3. Player channel specs nen them "managed buddies":
   - actor co danh sach subject duoc thao tac;
   - join/leave/status cho self + buddy;
   - audit/notification khi actor thao tac cho nguoi khac.

4. Payment/Bank onboarding nen them bank receive-health:
   - provider liveness status;
   - per-account received proof;
   - warning khi doi primary account chua co proof;
   - khong over-claim voi provider khong tra account number.

5. Identity spec nen them admin unlink/relink command:
   - parse target + platform;
   - clear reachability/channel identity an toan;
   - player reclaim bang join/link flow;
   - audit actor/reason.

6. Refund/credit policy can mot spec rieng hoac section trong Payment/Session:
   - paid leave;
   - batch remove paid players;
   - refund to payer vs leaving player;
   - cashout credit;
   - refund transfer QR;
   - reversal/correction notification.

## 7. Candidate Backlog Cho Plexco

| Task | Risk | Scope goi y | Ly do |
|---|---|---|---|
| `core-lift-bestminton-logic` | P1 | `packages/core/matching`, `dates`, `vietqr`, `bank-alias`, `payment-memo`, tests | Gia tri cao, it dependency, nen lam dau tien. |
| `payment-reconcile-fixtures-from-bestminton` | P1 | P3 test fixtures + matcher proposal tests | Giam risk wrong-pay truoc khi implement ledger. |
| `session-recurrence-weekly-reference` | P2 | recurrence service tests | Multi weekly templates la logic dep, co the ke thua decision table. |
| `player-managed-buddies` | P1 | player channel + membership authz spec/code | Co gia tri product lon, nhung dung identity/authorization nen tach rieng. |
| `refund-credit-policy-design` | P1 | docs/spec decision table truoc code | Duong tien phuc tap; can design table truoc khi implement. |
| `bank-receive-health-onboarding` | P1 | bank account onboarding + webhook monitor | Tranh loi host doi STK nhung webhook khong ghi nhan tien. |

## 8. Canh Bao Khi Ke Thua

- Khong copy `src/db.ts`, `src/bot.ts`, `src/zalo/zbot.ts` vao Plexco. Chung la implementation single-club, single-process, SQLite.
- Khong dung fuzzy name de settle multi-person. Neu khong co pay-code/strong identity, de manual allocation.
- Khong cap refund theo `fee` hay `amount` display. Phai dua tren ledger/effective paid amount va real-money provenance.
- Khong cho transport tu tinh tien. Telegram/Zalo/Web phai goi cung service.
- Khong de bank health noi qua su that: provider liveness khac per-account proof.
- Cac docs Bestminton ngay 2026-06-21 co nhieu task `in-flight/blocked`; chi lift shipped code/test hoac dung docs nhu decision reference.

## 9. Reference Files Da Doc

Bestminton:

- `README.md`
- `docs/HANDOFF.md`
- `docs/autopilot-backlog.md`
- `package.json`
- `src/payment-instructions.ts`
- `src/pay-core.ts`
- `src/payments-logic.ts`
- `src/weekly-core.ts`
- `src/manual-transfer-core.ts`
- `src/remove-paid-core.ts`
- `src/buddy-actions-core.ts`
- `src/paid-leave-core.ts`
- `src/player-credit-core.ts`
- `src/banks.ts`
- `src/leave-core.ts`
- `src/owner-host-link.ts`
- `src/identity-unlink-core.ts`
- `src/club.ts`

Plexco:

- `docs/research/bestminton-to-plexco-analysis.md`
- `docs/product/ROADMAP.md`
- `docs/features/README.md`
- `docs/standards/business-rules.md`
- `docs/features/feature_payment_reconcile.md`
- `docs/features/BE/feature_payment_reconcile_tech.md`
- `docs/features/feature_identity.md`
- `docs/features/BE/feature_identity_tech.md`
- `docs/features/feature_session_management.md`
- `docs/features/BE/feature_session_management_tech.md`
- `docs/features/feature_notifications_reminders.md`
- `docs/features/BE/feature_notifications_reminders_tech.md`
- `docs/features/feature_player_telegram.md`
- `docs/features/feature_zalo_channel.md`
- `docs/features/feature_billing_lifecycle.md`
- `docs/autopilot-backlog.md`
