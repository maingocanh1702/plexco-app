# Feature: Identity Directory & Merge — Product/UX Spec

> **Canonical phase:** P3.5
> **Track:** 🆔 Identity & Merge
> **Version:** 1.2 · 2026-07-10
> **Status:** Reviewed against BRD v3.4 / PRD v2.2 / TDD v2.2 — **full-review baseline cũ; light-propagated → current (BRD v3.5/PRD v2.4/TDD v2.4)**
> **Prerequisites:** P2 tenant routing + P3 ledger stable
> **Tài liệu liên quan:** `../product/BRD.md` FR-7 · `../product/PRD.md` FLOW 5 + §4.2 · `../product/TDD.md` §3.2–3.4/§4 · `../standards/decisions.md` DD-37/DD-13/DD-33/DD-01 · `../research/player-side-saas-reconciliation.md` · `../research/player-side-saas-AUDIT.md` C1–C5

> **Cập nhật v3.4 (DD-37 + DD-13, 2026-07-10):** một `Person` link **Google + Facebook + Zalo** (bỏ **Telegram** identity — loại khỏi phạm vi). Auth phase-1 = Google/email (DD-13); Facebook link = DD-33 (🟡 phase-1). Merge signal giữ **DD-01** (SĐT verified) + verified email.

---

## 1. Mục tiêu và nguyên tắc

Mỗi người thật có một `Person` toàn cục; tài khoản **Zalo / Facebook Messenger** được gắn bằng `ChannelIdentity`, **Google / email / Facebook** (web-auth) gắn qua `account_identities` (DD-13); quan hệ với CLB nằm ở `Membership`. **Telegram đã loại khỏi phạm vi (DD-37)** — không còn Telegram identity/adapter.

**Giá trị:** cùng một người hoạt động qua nhiều kênh vẫn có một lịch sử membership/charge, không tách đôi nợ và không nhận nhắc/xác nhận sai tenant.

### Bất biến

- Routing tenant và authorization người dùng là hai việc độc lập.
- Claim membership có tiền không bao giờ dựa vào tên đơn thuần.
- Chỉ verified signal mới auto-merge; tên/STK chỉ tạo suggestion.
- Merge không sửa/xóa bank transaction hoặc payment allocation đã audit.
- Global identity directory là protected, không phải public/no-auth data.
- Mọi merge/claim/admin override có actor, reason và immutable audit.

---

## 2. Use Cases

| ID | Actor | Hành động | Kết quả |
|---|---|---|---|
| ID-UC-1 | Player | Xuất hiện lần đầu trên Zalo/Messenger | Tạo ChannelIdentity + Person nếu chưa tồn tại |
| ID-UC-2 | Player | Join một tenant lần đầu | Tạo membership idempotently |
| ID-UC-3 | Player | `/link` ở kênh A | Sinh OTP entropy cao, TTL ngắn, single-use |
| ID-UC-4 | Player | Nhập OTP ở kênh B | Confirm rõ ràng rồi merge identities/persons |
| ID-UC-5 | Player | Share verified contact | Gắn phone verified; auto-merge nếu policy và conflict checks đạt |
| ID-UC-13 | Host/Player | Đăng nhập Google/email rồi **link Facebook + Zalo** vào cùng Person | account_identities/ChannelIdentity gắn về 1 Person; claim membership có tiền cần khoá mạnh (DD-13/DD-33) |
| ID-UC-6 | System | Tên khớp membership chưa có tài chính | Có thể claim theo policy low-risk |
| ID-UC-7 | System | Tên khớp membership có charge/allocation | Chặn; yêu cầu OTP/verified phone/CK match/owner confirmation |
| ID-UC-8 | Host | Duyệt claim/merge suggestion | Authz admin + confirm impact + audit |
| ID-UC-9 | System | Merge có hai membership cùng tenant | Reconcile về một survivor, giữ toàn bộ history |
| ID-UC-10 | System | Merge reachability trùng | Upsert theo `(person, tenant, platform)`, giữ trạng thái hợp lệ nhất |
| ID-UC-11 | Player | Rời CLB | Membership chuyển `left`; lịch sử giữ nguyên |
| ID-UC-12 | Support admin | Xử lý merge sai | Manual split/recovery procedure có audit; không tự động undo mù |

`/myclubs` và person-self web view sử dụng identity directory nhưng được deliver ở P4.6, không phải DoD của P3.5.

---

## 3. Claim và merge policy

### Trust order

| Signal | Hành vi |
|---|---|
| Cross-channel link OTP đã confirm | Auto-merge sau conflict checks |
| Verified phone/share-contact | Auto-merge theo BRD OD-1 / **DD-01** + conflict checks |
| Verified email (Google OAuth / email verified) | Auto-merge signal (DD-13) sau conflict checks |
| CK match có strong provenance | Có thể strong-claim membership liên quan; audit |
| Bank account/name | Suggestion, owner duyệt |
| Fuzzy display name | Suggestion hoặc low-risk claim khi membership chưa có tài chính; không auto với debt/history |

### OTP requirements

- Random cryptographic alphanumeric code; entropy mục tiêu ≥32 bits.
- Chỉ lưu hash + salt, không log plaintext.
- TTL mặc định 10 phút; single-use; `consumed_at` immutable.
- Bind source person/channel và intended action; không dùng như bearer permission cho tenant.
- Tối đa 5 attempts/10 phút theo source + IP/platform identity; exponential cooldown.
- Yêu cầu explicit confirmation trước khi merge; thông báo cả hai channel sau merge.

### Merge transaction

1. Authorize actor/signal; load source/target Person theo thứ tự ID ổn định để tránh deadlock.
2. Lock Person, memberships, charges và reachability liên quan.
3. Chọn canonical Person; chuyển ChannelIdentity.
4. Với tenant chỉ có một membership: re-parent membership sang canonical Person.
5. Với membership conflict: chọn survivor theo history/age; re-parent players/charges; giữ merged membership làm tombstone/audit mapping.
6. Không sửa bank transactions hoặc payment allocations; chúng tiếp tục trỏ charge lịch sử đã được re-parent hợp lệ.
7. Reconcile reachability; invalidate link codes/sessions nhạy cảm.
8. Ghi `merge_audit` + outbox event trong cùng transaction.

---

## 4. Edge Cases

| # | Case | Hành vi bắt buộc |
|---|---|---|
| 1 | Claim debt-bearing membership bằng tên | Chặn `CLAIM_REQUIRES_STRONG_KEY` |
| 2 | OTP brute-force | Rate-limit/cooldown; không tiết lộ code tồn tại |
| 3 | OTP reuse hoặc hết hạn | Reject; không thay đổi identity |
| 4 | OTP bị gửi sang người thứ ba | Explicit confirmation + thông báo source; recovery path |
| 5 | Hai merge ngược chiều đồng thời | Lock ordered IDs + idempotency key; một transaction thắng |
| 6 | Hai persons có membership cùng tenant | Survivor/tombstone strategy; không xoá history |
| 7 | Membership conflict có charge paid/partial | Re-parent charge; ledger immutable; tổng không đổi |
| 8 | Reachability trùng | Merge deterministic; không làm `can_dm` tenant A ảnh hưởng tenant B |
| 9 | Display name/username kênh (Zalo/Facebook) đổi | Dùng stable platform user ID (Zalo user id / Messenger PSID page-scoped) |
| 10 | Channel account bị xoá | Mark inactive; giữ audit/history |
| 11 | Admin override không đủ quyền | 403 + audit attempted action |
| 12 | Person-self đoán person ID | 403; identity service chỉ dùng authenticated person |
| 13 | Phone verified trùng nhưng merge conflict nguy hiểm | Pause auto-merge; yêu cầu review |
| 14 | Merge sai đã phát notification | Recovery/split runbook + correction event; không rewrite audit |
| 15 | Player yêu cầu xóa PII | Áp retention/anonymization; không phá financial audit obligations |
| 16 | Facebook Login link phụ thuộc App Review (DD-33) | Chưa duyệt → degrade sang OTP `/link` thủ công; không auto-link chéo PSID↔FB Login |

---

## 5. Domain và access control

| Entity | Zone | Quy tắc |
|---|---|---|
| `persons` | GLOBAL protected | API role không SELECT trực tiếp; PII encrypted/verified metadata; anchor (KHÔNG root table `users`) |
| `channel_identities` | GLOBAL protected | UNIQUE `(platform, platform_user_id)`; `platform ∈ {zalo, messenger}`; stable ID (Messenger PSID page-scoped) |
| `account_identities` | GLOBAL protected | Web-auth provider (DD-13): `platform ∈ {google, email, facebook, zalo}`; `platform_user_hash` keyed-HMAC (SI-2) |
| `memberships` | TENANT + RLS | UNIQUE `(tenant_id, person_id)` cho active/survivor policy |
| `channel_reachability` | TENANT + RLS | UNIQUE `(person_id, tenant_id, platform)` |
| `link_codes` | GLOBAL protected | Hash-only, TTL, attempts, single-use |
| `merge_audit` | GLOBAL protected | Immutable actor/signal/before-after/reason |
| `merge_tombstones` | GLOBAL protected | Old→canonical mapping cho replay/support |

### Authz

- Player chỉ thao tác identity của chính authenticated channel/person.
- Tenant admin chỉ claim/merge trong tenant họ quản lý; không được browse global directory.
- Cross-tenant merge service là privileged path hẹp, có audit.
- Person-self API không nhận arbitrary person ID từ client làm authority.

---

## 6. Screens và states

| Surface | Loading | Ready | Error | Empty |
|---|---|---|---|---|
| `/link` | Đang tạo mã | Code + expiry + cảnh báo không chia sẻ | Rate-limit/generic error | N/A |
| Verify link | Đang xác minh | Impact summary + confirm | Invalid/expired/consumed | N/A |
| Merge confirmation | Đang kiểm tra conflict | Accounts/CLBs bị ảnh hưởng + Confirm/Cancel | Requires admin review | N/A |
| Host claim review | Skeleton | Evidence + debt/history warning | Permission/conflict | Không có suggestion |
| Member detail P4 | Skeleton | Channels, memberships, audit summary | Redacted error | N/A |

Không hiển thị full phone, bank account hoặc raw platform IDs trong suggestion UI.

---

## 7. Analytics và audit

| Event | Trigger | Payload tối thiểu |
|---|---|---|
| `identity_person_created` | First verified contact | opaque person_id, platform, tenant_present |
| `identity_link_requested` | OTP issued | opaque person_id, platform, ttl |
| `identity_link_verified` | OTP accepted | opaque source/target, method |
| `identity_merge_completed` | Commit merge | merge_id, method, conflict_count, actor_type |
| `identity_claim_rejected` | Strong-key gate | reason_code, has_financial_history |
| `identity_merge_recovery_started` | Support recovery | merge_id, reason_code, actor_id |

Không gửi raw platform UID, phone, email, display name, bank account hoặc OTP vào analytics/log.

`merge_audit` lưu chi tiết nghiệp vụ cần thiết nhưng là protected data, có retention/access policy riêng.

---

## 8. Acceptance Criteria

- [ ] Zalo/Messenger first contact + Google/email login tạo identity/person idempotently (không Telegram — DD-37).
- [ ] Person link Google + Facebook + Zalo về 1 anchor; claim membership có tiền cần khoá mạnh (DD-13/DD-33).
- [ ] Global identity tables không query trực tiếp từ API role.
- [ ] Reachability tenant-scoped + RLS; tenant A không ảnh hưởng tenant B.
- [ ] Membership creation idempotent.
- [ ] Claim membership có tài chính bằng tên bị chặn.
- [ ] OTP cryptographic, hash-at-rest, TTL, rate-limit, single-use và explicit confirm.
- [ ] Merge concurrent/ngược chiều không deadlock hoặc tạo duplicate.
- [ ] Membership conflict tạo survivor + tombstone, giữ players/charges/history.
- [ ] Merge không sửa/xóa bank transaction/payment allocation và không đổi tổng ledger.
- [ ] Verified phone policy theo BRD OD-1 hoạt động với conflict review.
- [ ] Admin override có role check, actor, reason và audit.
- [ ] Merge event/audit ghi atomic với data changes.
- [ ] PII không xuất hiện trong analytics/log/UI suggestion.
- [ ] Recovery runbook cho merge sai được test trên staging.
- [ ] `/myclubs` được ghi là consumer P4.6, không block DoD P3.5.

---

## 9. Open Decisions và changelog

| ID | Quyết định | Trạng thái |
|---|---|---|
| BRD OD-1 | Verified phone là merge key chính | ✅ Chốt |
| ID-OQ-1 | Phone verification UX/provider cụ thể | ⬜ Product/security build-time; ưu tiên verified share-contact, SMS chỉ sau provider/DPA review — founder brief §Delegated |
| ID-OQ-2 | Recovery/split SLA và quyền support | 🔴 Founder + security phải chốt trước production merge — `../founder-decision-brief-2026-07-15.md` Item 9 |
| ID-OQ-3 | Guest vs full membership permissions | ⬜ Đã gom vào founder brief Item 4 (guest→full + ban policy) |

## Changelog

| Date | Version | Thay đổi |
|---|---|---|
| 2026-07-10 | v1.2 | **DD-37 + DD-13:** Person link **Google + Facebook + Zalo** (bỏ Telegram identity/adapter). `channel_identities.platform ∈ {zalo, messenger}`; thêm `account_identities` (google/email/facebook/zalo). Verified email = merge signal (giữ DD-01 phone). Facebook link phụ thuộc App Review (DD-33). Cập nhật §1, UC-1/13, trust order, domain, edge #9/16, acceptance. |
| 2026-06-19 | v1.1 | Thêm Changelog heading, verified format compliance |
| 2026-06-18 | v1.1 | Protected directory; tenant reachability; secure OTP; ledger-safe merge; recovery/audit; canonical phase |
| 2026-06-18 | v1.0 | Initial identity spec |
