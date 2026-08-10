# Feature: Identity Directory & Merge — Product/UX Spec

> **Canonical phase:** P3.5
> **Track:** 🆔 Identity & Merge
> **Version:** 1.11 · 2026-07-28
> **Status:** Reviewed identity contract; DD-32 Account-backed channel link predicate added. Endpoint-scoped identity/reachability schema/runtime pending build slices
> **Implementation:** Not started — bảng `link_codes`/`merge_*` có sẵn · authority: `../standards/BUILD-STATUS.md` (Doc status ≠ Implementation status)  
> **Prerequisites:** P2 tenant routing + P3 ledger stable
> **Tài liệu liên quan:** `../product/BRD.md` FR-7 · `../product/PRD.md` FLOW 5 + §4.2 · `../product/TDD.md` §3.2–3.4/§4 · `../standards/decisions.md` DD-13/DD-33/DD-37/DD-50/DD-53/**DD-65..68** · `feature_player_messenger.md` · `../research/player-side-saas-AUDIT.md` C1–C5

> **Cập nhật DD-50/v1.37:** phase-1 không thu SĐT. Strong proof cho claim/merge có tiền = verified account email (Google OIDC đủ claim hoặc email-password đã verify) hoặc deterministic one-time `link_code`; phone fields dormant.
>
> **Cập nhật DD-15/DD-67/v1.45:** identity và reachability đều thuộc **đúng provider endpoint**. Uniqueness là `(platform, provider_scope_lookup_hash, platform_user_lookup_hash)`; Messenger scope Page, Zalo scope bot/OA cho tới khi DD-15 chứng minh có thể nới. Reachability gắn `channel_identity_id`, không thu gọn về `(person,tenant,platform)`.
>
> **Cập nhật v1.7:** exact endpoint binding phải được chứng minh bằng registry relation, không chỉ lookup hash: Messenger identity có Page FK, Zalo identity có bot/OA FK, và đúng một FK phải khớp `platform`. Consume `link_code` re-derive current source Person từ đúng một issuer trước mọi attempt/consume atomic.
>
> **Cập nhật DD-32/v1.11:** quyền paid booking `pay later` qua bot chỉ mở khi exact ChannelIdentity và một Plexco Account có verified account identity cùng resolve tới current Person. `link_code` là mechanism hoàn tất binding, không phải tier pay-later nếu chưa có Account thật.

---

## 1. Mục tiêu và nguyên tắc

Mỗi người thật có một `Person` toàn cục; tài khoản **Zalo / Facebook Messenger** được gắn bằng `ChannelIdentity`, **Google / email / Facebook** (web-auth) gắn qua `account_identities` (DD-13); quan hệ với CLB nằm ở `Membership`. **Telegram đã loại khỏi phạm vi (DD-37)** — không còn Telegram identity/adapter.

**Giá trị:** cùng một người hoạt động qua nhiều kênh vẫn có một lịch sử membership/charge, không tách đôi nợ và không nhận nhắc/xác nhận sai tenant.

### Bất biến

- Routing tenant và authorization người dùng là hai việc độc lập.
- Messenger `page_id` chỉ resolve endpoint/default context; PSID/window là Page-scoped và target tenant/resource được resolve riêng qua protected action/ref/picker.
- Claim membership có tiền không bao giờ dựa vào tên đơn thuần.
- Chỉ proof đã pin ở DD-50 mới mở claim/merge có tiền; tên/STK/owner assertion chỉ tạo suggestion/review, không thay strong proof.
- Merge không sửa/xóa bank transaction hoặc payment allocation đã audit.
- Global identity directory là protected, không phải public/no-auth data.
- Mọi merge/claim/admin override có actor, reason và immutable audit.

---

## 2. Use Cases

| ID | Actor | Hành động | Kết quả |
|---|---|---|---|
| ID-UC-1 | Player | Xuất hiện lần đầu trên Zalo/Messenger | Tạo ChannelIdentity + Person idempotently; bind bằng đúng một Page hoặc bot/OA registry relation khớp platform rồi server derive hai domain-separated lookup hashes |
| ID-UC-2 | Player | Join một tenant lần đầu | Tạo membership idempotently |
| ID-UC-3 | Player/account | `/link` ở channel hoặc authenticated web/app | Sinh deterministic one-time `link_code`, hash-at-rest, TTL ngắn, bound đúng một issuer channel/account + action |
| ID-UC-4 | Player | Consume `link_code` ở kênh B | Lock+verify+consume once, hiển thị impact rồi explicit confirm merge |
| ID-UC-5 | Player | Verify account email | Email-password verify token hoặc Google OIDC proof hợp lệ gắn evidence vào account; không trust client field |
| ID-UC-13 | Host/Player | Đăng nhập Google/email rồi **link Facebook + Zalo** vào cùng Person | account_identities/ChannelIdentity gắn về 1 Person; claim membership có tiền cần khoá mạnh (DD-13/DD-33) |
| ID-UC-6 | System | Tên khớp membership chưa có tài chính | Có thể claim theo policy low-risk |
| ID-UC-7 | System | Tên khớp membership có charge/allocation | Chặn; chỉ verified account email hoặc valid `link_code` mở claim. Recovery artifact chỉ phục hồi account theo DD-53, không tự cấp claim. CK/name/owner assertion chỉ tạo review evidence |
| ID-UC-8 | Host | Duyệt claim/merge suggestion | Authz admin + confirm impact + audit |
| ID-UC-9 | System | Merge có hai membership cùng tenant | Reconcile về một survivor, giữ toàn bộ history |
| ID-UC-10 | System | Merge reachability trùng | Re-parent theo exact `channel_identity_id`; giữ từng provider endpoint/window độc lập, không OR/copy token xuyên Page/bot/OA |
| ID-UC-11 | Player | Rời CLB | Membership chuyển `left`; lịch sử giữ nguyên |
| ID-UC-12 | Support admin | Xử lý merge sai | Manual split/recovery procedure có audit; không tự động undo mù |
| ID-UC-14 | Channel player | Link Plexco Account tại final booking gate | Opaque endpoint+actor+session-bound handoff → authenticated Account → explicit binding confirm; resume chỉ sau current Person/account predicate pass |

`/myclubs` và person-self web view sử dụng identity directory nhưng được deliver ở P4.6, không phải DoD của P3.5.

---

## 3. Claim và merge policy

### Trust order

| Signal | Hành vi |
|---|---|
| Valid one-time `link_code` + explicit confirm | Auto-merge sau conflict checks; transaction lock/consume once |
| Verified account email | Strong proof sau conflict checks. Google: signature+iss+aud+nonce+time claims+`email_verified=true`; email-password: verify token consumed |
| Recovery artifact đã cấp trước | Chỉ phục hồi account theo DD-53; không tự mở debt-bearing membership claim. Sau recovery vẫn cần verified account email hoặc `link_code` cho claim |
| CK match/owner assertion | Review evidence בלבד; không thay strong proof cho debt-bearing membership |
| Bank account/name | Suggestion, owner duyệt |
| Fuzzy display name | Suggestion hoặc low-risk claim khi membership chưa có tài chính; không auto với debt/history |

### `link_code` requirements

- Random cryptographic code/deep link; entropy mục tiêu ≥64 bits.
- Chỉ lưu hash + salt, không log plaintext.
- TTL mặc định 10 phút; single-use; `consumed_at` immutable; có `max_attempts`, `locked_until`, `revoked_at`.
- Bind `source_person_id` và **exactly one** issuer: `source_channel_identity_id` XOR `source_account_id`; issuer phải resolve về source Person hiện hành dưới lock. Không nhận source Person do client tự khai và không dùng code như bearer permission cho tenant.
- Consume first resolves the candidate code + stored issuer/source refs **read-only**. It locks the canonical issuer/account and current Person parent in the shared deterministic order, then locks/re-reads the exact code row and requires candidate hash/issuer/source still match. Only then does it reject `consumed/revoked/expired/locked/max-attempt`, re-derive current source Person and verify action/hash; terminal/drift paths create no attempt/plan. This parent-first order is shared with password-reset revoke/cancel and supersedes code-row-first wording.
- Wrong verifier increment đúng một lần bằng conditional atomic update; valid verifier conditional-set `consumed_at` đúng một lần và tạo merge plan từ re-derived Person trong cùng transaction. Concurrent/stale issuer hoặc zero-row update đều fail closed bằng lỗi generic.
- Tối đa 5 attempts/10 phút theo source + IP/platform identity; exponential cooldown.
- Yêu cầu explicit confirmation trước khi merge; thông báo cả hai channel sau merge.

### Account-backed channel link cho deferred payment

`linkedForDeferredPayment` là derived predicate, không phải cột boolean client có thể set:

1. exact active ChannelIdentity re-resolve current canonical Person;
2. một active Account resolve cùng Person;
3. Account có ít nhất một verified `account_identity`;
4. không freeze/merge conflict;
5. binding được tạo qua verified auth hoặc consumed link flow + explicit impact confirmation.

Facebook Login App-scoped subject không tự bằng Messenger Page-scoped PSID; Zalo Login subject không tự bằng bot/OA-scoped `from.id`. Same provider/display name/client-declared ID đều không đủ. Booking resume token chỉ route về Identity service; nó không tự merge, claim membership hay grant tenant permission.

### Merge transaction

0. If DD-70(a) is enabled, read-only inventory every affected Person, lock inbox fences UUID-ascending before any Person/source/child row, then re-inventory after locks; drift rolls back. This includes merge source/survivor and any notification-owned actor/reference.
1. Authorize actor/signal; load source/target Person theo thứ tự ID ổn định để tránh deadlock.
2. Lock Person, channel identities, memberships, charges và reachability liên quan after inbox fences.
3. Chọn canonical Person; chuyển ChannelIdentity.
4. Với tenant chỉ có một membership: re-parent membership sang canonical Person.
5. Với membership conflict: chọn survivor theo history/age; re-parent players/charges; giữ merged membership làm tombstone/audit mapping.
6. Không sửa bank transactions hoặc payment allocations; chúng tiếp tục trỏ charge lịch sử đã được re-parent hợp lệ.
7. Re-parent endpoint reachability theo exact channel identity; dedupe chỉ cùng endpoint identity và không copy/OR window-token xuyên Page/bot/OA; invalidate link codes/sessions nhạy cảm.
8. Ghi `merge_audit`; nếu DD-70(a) active, append `identity_merged` từ exact locked audit trong cùng transaction. Domain outbox khác (nếu có) không sở hữu global notification.

`link_code` consume chỉ verify/consume và tạo merge plan; nó **không emit global notification**. Merge commit luôn inventory bounded source/survivor read-only, lock inbox fences trước mọi blocking Person/source row, revalidate rồi append từ locked `merge_audit`. Nếu implementation không tuân được order này thì build HALT; tenant `outbox_events` không phải global fallback.

---

## 4. Edge Cases

| # | Case | Hành vi bắt buộc |
|---|---|---|
| 1 | Claim debt-bearing membership bằng tên | Chặn `CLAIM_REQUIRES_STRONG_KEY` |
| 2 | `link_code` brute-force | Rate-limit/cooldown; không tiết lộ code tồn tại |
| 3 | `link_code` reuse/hết hạn/wrong action | Reject; không thay đổi identity; failed attempts atomic |
| 4 | `link_code` bị gửi sang người thứ ba | Bound source identity/action + explicit impact confirm + thông báo source; recovery path |
| 5 | Hai merge ngược chiều đồng thời | Lock ordered IDs + idempotency key; một transaction thắng |
| 6 | Hai persons có membership cùng tenant | Survivor/tombstone strategy; không xoá history |
| 7 | Membership conflict có charge paid/partial | Re-parent charge; ledger immutable; tổng không đổi |
| 8 | Reachability trùng | Không dùng window/token của Page/bot/OA A cho endpoint B và không double-send sau merge |
| 9 | Display name/username kênh (Zalo/Facebook) đổi | Dùng endpoint-scoped hashes: Messenger Page+PSID; Zalo bot/OA+`from.id` |
| 10 | Channel account bị xoá | Mark inactive; giữ audit/history |
| 11 | Admin override không đủ quyền | 403 + audit attempted action |
| 12 | Person-self đoán person ID | 403; identity service chỉ dùng authenticated person |
| 13 | Phone field dormant/trùng | Không dùng làm phase-1 proof hoặc auto-merge; chỉ future suggestion sau decision mới |
| 14 | Merge sai đã phát notification | Recovery/split runbook + correction event; không rewrite audit |
| 15 | Player yêu cầu xóa PII | Áp retention/anonymization; không phá financial audit obligations |
| 16 | Facebook Login link phụ thuộc App Review (DD-33) | Chưa duyệt → dùng deterministic `link_code`; không auto-link chéo PSID↔FB Login |
| 17 | Endpoint hash đúng nhưng registry relation sai/thiếu | Reject create/resolve; Messenger cần duy nhất Page FK, Zalo cần duy nhất bot/OA FK và service tự derive scope hash từ registry row |
| 18 | Consume code terminal hoặc issuer đã đổi Person | Reject trước attempt/plan; không increment terminal counter, không trust `source_person_id` từ request |

---

## 5. Domain và access control

| Entity | Zone | Quy tắc |
|---|---|---|
| `persons` | GLOBAL protected | API role không SELECT trực tiếp; PII encrypted/verified metadata; anchor (KHÔNG root table `users`) |
| `channel_identities` | GLOBAL protected | UNIQUE `(platform, provider_scope_lookup_hash, platform_user_lookup_hash)` + relation uniques; đúng một `messenger_page_id`/`zalo_bot_id` FK phải khớp platform; protected writer derive scope hash từ registry row; không auto-merge xuyên endpoint |
| `account_identities` | GLOBAL protected | Web-auth provider (DD-13): `platform ∈ {google, email, facebook, zalo}`; `platform_user_hash` keyed-HMAC (SI-2) |
| `memberships` | TENANT + RLS | UNIQUE `(tenant_id, person_id)` cho active/survivor policy |
| `channel_reachability` | GLOBAL protected + narrow service | UNIQUE `channel_identity_id`; window/eligibility thuộc exact Page/bot/OA+provider user endpoint. Target-tenant eligibility được authorize riêng |
| `link_codes` | GLOBAL protected | Keyed lookup hash + salted slow verification hash; issuer XOR channel/account; TTL, max-attempt/lock/revoke, single-use |
| `merge_audit` | GLOBAL protected | Immutable actor/signal/before-after/reason |
| `merge_tombstones` | GLOBAL protected | Old→canonical mapping cho replay/support |

### Authz

- Player chỉ thao tác identity của chính authenticated channel/person.
- Tenant admin chỉ claim/merge trong tenant họ quản lý; không được browse global directory.
- Cross-tenant merge service là privileged path hẹp, có audit.
- Person-self API không nhận arbitrary person ID từ client làm authority.

---

## 6. Screens và states

> Web identity management. Minimal UI (identity ops mostly automated). Mobile-first 375px.

### /link — Tạo mã liên kết

**Layout:**

```
┌──────────────────────────────────────┐
│ ← Cài đặt        🔗 Liên kết TK    │
├──────────────────────────────────────┤
│                                      │
│ Để liên kết tài khoản Zalo/Messenger │
│ với Plexco, dùng mã bên dưới:       │
│                                      │
│     ┌──────────────────────┐        │
│     │   PLXC-A7B2-F9D1    │        │
│     └──────────────────────┘        │
│     Hết hạn sau 10:00               │
│                                      │
│ ⚠️ Không chia sẻ mã này cho         │
│    người khác                        │
│                                      │
│ [📋 Copy mã]                        │
│                                      │
└──────────────────────────────────────┘
```

### Verify link — Xác minh liên kết

**Layout:**

```
┌──────────────────────────────────────┐
│ ← Link           ✅ Xác minh        │
├──────────────────────────────────────┤
│                                      │
│ Liên kết tài khoản:                  │
│                                      │
│ 📱 Zalo: CLB Cầu lông BT           │
│    ↕                                │
│ 🌐 Plexco: nguyenvana@gmail.com    │
│                                      │
│ ─── Ảnh hưởng ───                   │
│ • 2 CLB sẽ được gộp                 │
│ • Lịch sử kèo được giữ nguyên      │
│                                      │
│ [═══ Xác nhận liên kết ═══]         │
│ [Hủy]                                │
│                                      │
└──────────────────────────────────────┘
```

### Merge confirmation — Xác nhận gộp

**Layout:**

```
┌──────────────────────────────────────┐
│ ⚠️ Xác nhận gộp tài khoản           │
├──────────────────────────────────────┤
│                                      │
│ Bạn đang gộp 2 tài khoản:           │
│                                      │
│ TK nguồn: Zalo (Minh Hoàng)         │
│ TK đích:  Plexco (nguyenvana@...)   │
│                                      │
│ ─── Ảnh hưởng ───                   │
│ CLBs: 3 CLB sẽ gộp vào 1 profile   │
│ Kèo: 12 kèo lịch sử được giữ       │
│ Nợ: ⚠️ 75,000₫ nợ từ TK nguồn      │
│                                      │
│ [═══ Xác nhận gộp ═══]              │
│ [Hủy — giữ tách biệt]              │
│                                      │
└──────────────────────────────────────┘
```

### Host claim review

**Layout:**

```
┌──────────────────────────────────────┐
│ 👥 Yêu cầu nhận quyền thành viên   │
├──────────────────────────────────────┤
│                                      │
│ Người yêu cầu: Minh Hoàng           │
│ Thành viên: "MinhH" (chưa liên kết) │
│                                      │
│ ─── Bằng chứng ───                  │
│ 📊 Lịch sử: 8 kèo, 2 tháng         │
│ 💰 Nợ: ⚠️ 150,000₫ chưa thanh toán │
│                                      │
│ ─── Khoá mạnh cần thiết (DD-13) ─── │
│ Thành viên có lịch sử tài chính     │
│ → Cần xác minh danh tính bổ sung    │
│                                      │
│ [Chấp nhận]      [Từ chối]          │
│                                      │
└──────────────────────────────────────┘
```

### Data source mapping

| Component | Data source | Ghi chú |
|-----------|-------------|---------|
| Link code | `link_codes` (single-use, TTL) | Opaque, no PII in code |
| Verify | `channel_identities` + `persons` | Endpoint-scoped |
| Merge | `merge_audit` (protected, retention) | Idempotent commit |
| Claim review | `memberships` + `charges` | Financial history = strong key |
| Member detail | `channel_identities` + `memberships` per person | P4 feature |

### State coverage matrix

| Screen | Loading | Ready | Error | Empty |
|--------|---------|-------|-------|-------|
| /link (create) | ✅ "Đang tạo mã" | ✅ Code + expiry + warning | ✅ Rate-limit / generic | ⚪ N/A |
| Verify link | ✅ "Đang xác minh" | ✅ Impact summary + confirm | ✅ Invalid/expired/consumed | ⚪ N/A |
| Merge confirmation | ✅ "Đang kiểm tra conflict" | ✅ Accounts + impact + confirm | ✅ "Cần admin review" | ⚪ N/A |
| Host claim review | ✅ Skeleton | ✅ Evidence + debt warning | ✅ Permission/conflict | ✅ "Không có suggestion" |
| Member detail (P4) | ✅ Skeleton | ✅ Channels + memberships | ✅ Redacted error | ⚪ N/A |

Không hiển thị email, phone dormant, bank account hoặc raw platform IDs trong suggestion UI.
---

## 7. Analytics và audit

| Event | Trigger | Payload tối thiểu |
|---|---|---|
| `identity_person_created` | First verified contact | opaque person_id, platform, tenant_present |
| `identity_link_requested` | `link_code` issued | opaque person_id, platform, ttl |
| `identity_link_verified` | `link_code` consumed + merge confirmed | opaque source/target, method |
| `identity_merge_completed` | Commit merge | merge_id, method, conflict_count, actor_type |
| `identity_claim_rejected` | Strong-key gate | reason_code, has_financial_history |
| `identity_merge_recovery_started` | Support recovery | merge_id, reason_code, actor_id |

Không gửi raw platform UID, phone/email, display name, bank account hoặc `link_code` vào analytics/log.

`merge_audit` lưu chi tiết nghiệp vụ cần thiết nhưng là protected data, có retention/access policy riêng.

---

## 8. Acceptance Criteria

- [ ] Zalo/Messenger first contact + Google/email login tạo identity/person idempotently; Messenger same PSID trên hai Page tạo hai Page-bound identities hợp lệ.
- [ ] Person link Google + Facebook + Zalo về 1 anchor; claim membership có tiền cần khoá mạnh (DD-13/DD-33).
- [ ] Channel paid pay-later chỉ khi exact ChannelIdentity↔current Person↔verified Account predicate pass; `link_code` chưa hoàn tất Account binding, raw provider ID/name và stale Person đều fail closed.
- [ ] Global identity tables không query trực tiếp từ API role.
- [ ] Zalo/Messenger identity và reachability exact endpoint-scoped bằng Page/bot-OA registry FK + platform CHECK + server-derived hashes; không reuse window/token xuyên endpoint hoặc gửi trùng central+tenant Page.
- [ ] Membership creation idempotent.
- [ ] Claim membership có tài chính bằng tên bị chặn.
- [ ] `link_code` cryptographic ≥64-bit, hash-at-rest, issuer XOR channel/account; read-only candidate resolve → canonical issuer/account+Person parent locks → code-row lock/revalidation; current source Person re-derived, terminal states rejected before counter mutation, atomic attempts, conditional single-use consume và explicit confirm. Reset/revoke-vs-consume barrier tests show no deadlock and one fail-closed loser.
- [ ] Merge concurrent/ngược chiều không deadlock hoặc tạo duplicate.
- [ ] Membership conflict tạo survivor + tombstone, giữ players/charges/history.
- [ ] Merge không sửa/xóa bank transaction/payment allocation và không đổi tổng ledger.
- [ ] Google OIDC evidence và email-password verification chỉ tạo strong proof sau server-side validation; phone không tham gia phase-1 proof.
- [ ] Admin override có role check, actor, reason và audit.
- [ ] Merge event/audit ghi atomic với data changes.
- [ ] PII không xuất hiện trong analytics/log/UI suggestion.
- [ ] Recovery runbook cho merge sai được test trên staging.
- [ ] `/myclubs` được ghi là consumer P4.6, không block DoD P3.5.

---

## 9. Open Decisions và changelog

| ID | Quyết định | Trạng thái |
|---|---|---|
| BRD OD-1 | Verified phone là merge key chính | 🔄 Điều chỉnh bởi DD-50: phone dormant phase-1; proof = verified account email hoặc `link_code` |
| ID-OQ-1 | Phone verification UX/provider cụ thể | ✅ **Resolve + full-propagate DD-50/v1.37:** không thu SĐT; pin Google/email proof matrix + transactional `link_code`; không claim bằng tên/alias; phone dormant |
| ID-OQ-2 | Recovery/split SLA và quyền support | ✅ **Chốt DD-53 (2026-07-16)** — PlatformAdmin freeze ngay (1 người); split apply = 2 approval độc lập; break-glass ticket+expiry+immutable audit; strong proof = verified email/recovery artifact; không rewrite `bank_transactions`/`payment_allocations`; SLA freeze ≤4h, plan ≤1 ngày. Production enablement cần runbook + drill evidence |
| ID-OQ-3 | Guest vs full membership permissions | ✅ **Chốt DD-52 (2026-07-16)** — invite + player-request coexist; xem `feature_cross_club_join` CCJ-OQ-2 |

## Changelog

| Date | Version | Thay đổi |
|---|---|---|
| 2026-07-28 | v1.11 | Mirror DD-32 Option D: pin Account-backed channel link predicate, endpoint/action-bound booking handoff và resume-after-revalidation; `link_code` là mechanism chứ không tự là pay-later tier. No runtime. |
| 2026-07-19 | v1.10a | Metadata sweep (index v2.35): thêm trường **Implementation** đồng bộ BUILD-STATUS (Not started). Không đổi contract. |
| 2026-07-19 | v1.10 | **DD-50 v1.73 lock-order closure:** link-code consume resolves read-only, locks issuer/account + Person parent before the code row, then revalidates and conditionally accounts/consumes. Removes reset/revoke-vs-consume inversion; no runtime/migration. |
| 2026-07-19 | v1.9 | **DD-70(a) v1.70 propagation:** link-code consume emits nothing; merge commit inventories/fences/revalidates then appends `identity_merged` from locked audit in the same transaction. Tenant outbox fallback is forbidden; unfit implementation halts. No runtime/migration. |
| 2026-07-19 | v1.8 | **Superseded by v1.9:** initial DD-70 lock-order propagation; no runtime/migration. |
| 2026-07-17 | v1.7 | **Enforceability closure:** exact Page/bot-OA registry relation/FK+CHECK beside server-derived HMAC; `link_code` terminal-first consume, XOR issuer/current-Person revalidation and conditional atomic attempt/consume. Runtime/migration vẫn pending. |
| 2026-07-17 | v1.6 | **DD-15/DD-50/DD-67 v1.45:** generalize endpoint-scoped identity/reachability cho Messenger+Zalo; uniqueness 3-part với domain-separated hashes; `link_code` issuer XOR channel/account + terminal lifecycle. Runtime/migration vẫn pending. |
| 2026-07-17 | v1.5 | **DD-65..68/DD-67 full propagation:** Messenger identity HMAC gồm `page_id+PSID`, explicit Page binding, endpoint-scoped reachability/window, merge không collapse token xuyên Page và one-route acceptance. Zalo vẫn tenant-scoped; live migration/runtime pending. |
| 2026-07-16 | v1.4 | **DD-50 full propagation:** replace OTP/phone-era use cases, trust order, edge cases, analytics and AC with verified account-email + transactional one-time `link_code`; CK/name/owner evidence cannot bypass strong proof. Authority: decisions v1.37. |
| 2026-07-10 | v1.2 | **DD-37 + DD-13:** Person link **Google + Facebook + Zalo** (bỏ Telegram identity/adapter). `channel_identities.platform ∈ {zalo, messenger}`; thêm `account_identities` (google/email/facebook/zalo). Verified email = merge signal (giữ DD-01 phone). Facebook link phụ thuộc App Review (DD-33). Cập nhật §1, UC-1/13, trust order, domain, edge #9/16, acceptance. |
| 2026-06-19 | v1.1 | Thêm Changelog heading, verified format compliance |
| 2026-06-18 | v1.1 | Protected directory; tenant reachability; secure OTP; ledger-safe merge; recovery/audit; canonical phase |
| 2026-06-18 | v1.0 | Initial identity spec |
| 2026-07-16 | v1.3 | **Propagation (light) DD-50/52/53:** OQ pointers added; body was full-propagated in v1.4. |
