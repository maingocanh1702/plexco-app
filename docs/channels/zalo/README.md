# 💬 Zalo Bot — Surface Docs

> **Surface:** Zalo Official Account (OA) — DM only
> **Deployable unit:** Zalo adapter under shared `apps/bot` runtime; exact module path is pinned by the implementation slice (not present yet)
> **API:** Zalo OA API v3 (HTTP REST, không SDK)
> **Phase:** **P4.7 — Phase-1 channel delivery** (DD-37 ✅; dependencies start earlier)
> **Version:** v0.7 · 2026-07-28
> **Refs:** `../../features/feature_zalo_channel.md` · `../../features/BE/feature_zalo_channel_tech.md` · `../../features/feature_channel_booking_funnel.md` · `../../research/player-side-saas-AUDIT.md` §B2

> **Cập nhật v3.4 (DD-37 ✅, thay DD-09):** Zalo là **kênh phase-1** cùng web + Facebook Messenger; **Telegram đã bị loại khỏi phạm vi**. Zalo DM là **kênh nhắc nợ chính** (cùng web push); Messenger chỉ best-effort trong cửa sổ 24h. Bảng "Khác biệt vs Telegram" bên dưới giữ làm **design rationale** — không hàm ý Telegram còn trong scope.
>
> **Cập nhật DD-15/DD-67 (decisions v1.45):** Zalo identity/reachability scoped theo exact bot/OA endpoint. Identity unique `(platform, provider_scope_lookup_hash, platform_user_lookup_hash)` bằng hai HMAC domain-separated; reachability gắn `channel_identity_id`. Bot/OA có thể pin ingress/default tenant, nhưng target-tenant eligibility vẫn authorize riêng.
>
> **DD-32 Option D:** player browse không cần Plexco Account. Chỉ ở final confirm của paid session mới chọn link Account để pay later hoặc verified pay-now hold 15 phút; free/full/approval không bị thu tiền sớm.

---

## 1. Vai trò

Zalo bot là **surface DM-only cho player** trong thị trường Việt Nam. Mỗi CLB **BYO bot-token** (tự tạo Zalo OA + dán token vào Plexco dashboard). **Không** có group chat — chỉ 1:1 DM.

```
CLB Bestminton → Zalo OA "Bestminton Club" → token_A → Plexco
CLB Pickle HCM → Zalo OA "Pickle Saigon"  → token_B → Plexco

Player Minh DM bot Bestminton → tenant route bằng bot webhook token
```

---

## 2. Khác biệt vs Telegram

| Aspect | Telegram | Zalo |
|--------|---------|------|
| Bot deployment | 1 shared bot | **BYO per-club** |
| Group support | ✅ Group + DM | ❌ **DM only** |
| Tenant routing | `chat_id` → tenant | `webhook_token` → tenant |
| Rich UI | InlineKeyboard, callback | **Text reply + number-based menu** |
| Player consent | Implicit (join group) | Player phải **nhắn trước** → consent implicit |
| canDm | Global (1 bot) | **Per exact bot/OA-scoped channel identity**; tenant eligibility riêng (AUDIT C1/DD-67) |
| Token scope | 1 token = mọi tenant | 1 token = 1 tenant |
| Token leak impact | 🔴 All tenants messaging | 🟡 1 tenant messaging |

---

## 3. Interaction Pattern

Zalo không có InlineKeyboard → dùng **number-reply menu**:

```
Bot: Chào Minh! Chọn:
  1. Xem kèo sắp tới
  2. Xem nợ
  3. Liên kết tài khoản

Player: 1

Bot: 📋 Kèo sắp tới:
  🏸 Thứ 5, 19:00 — CLB Bestminton
  Khu vực: Quận 3
  Giá: 80,000₫ · 12 người đã đăng ký · Còn 3 slot
  
  1. Xem chi tiết
  0. Quay lại

Player: 1

Bot: 🏸 Thứ 5, 19:00 · Quận 3 · 80,000₫
  12 người đã đăng ký · Còn 3 slot
  1. Đăng ký
  0. Quay lại

Player: 1

Bot: Chọn cách xác nhận:
  1. Liên kết Plexco — giữ chỗ, thanh toán sau
  2. Thanh toán & giữ chỗ trong 15 phút
  0. Quay lại
```

---

## 4. Reply-context

Zalo DM là stateless (không có callback data như TG). Plexco dùng **reply-context** server-side:

Reply context luôn keyed bằng exact `channel_identity_id` + bot/OA endpoint + target tenant; không dùng raw `zalo_user_id` làm global key. Context list và context final-confirm là hai single-use states riêng; context hết hạn thì quay lại `/join`.

### 4.1 Number Reply Contract

Number reply chỉ hợp lệ khi có context active:

```text
context_key = channel_identity_id + target_tenant_id + bot_or_oa_id + context_type
context_payload = {
  list_version,
  item_ids: [session_id...],
  expires_at,
  consumed_at
}
```

Rules:

- Một số tự do như `"1"` không bao giờ mutate nếu không có context active.
- Context hết hạn/đã consumed/list version lệch → yêu cầu player gõ lại `/join`.
- Final confirm gọi shared funnel để recheck `session.status`, canonical occupancy (active + live holds), quote, identity, membership và `join_policy`.
- Reply `"0"` chỉ quay lại menu, không mutate.
- Mọi mutation dùng command id deterministic từ provider event id + context id để chống replay.

---

## 5. ChannelReachability (AUDIT C1 · DD-67)

```
ChannelReachability:
  channelIdentityId  // exact identity already binds platform + bot/OA scope + from.id
  canDm: true/false
  lastInboundAt: timestamp

Zalo: canDm=true CHỈ KHI player đã DM exact bot/OA endpoint đó
  → Minh DM bot/OA A: canDm(channelIdentity(A, Minh)) = true
  → Minh CHƯA DM bot/OA B: không có reachable channelIdentity(B, Minh)
  → Không copy/OR reachability A sang B; target tenant được authorize riêng trước delivery
```

---

## 6. Webhook

```
POST /webhook/zalo/:token
  → token → exact bot/OA endpoint + ingress/default tenant
  → Verify X-Bot-Api-Secret-Token (timing-safe)
  → HMAC(scope domain, bot/OA id) + HMAC(user domain, from.id)
  → Resolve/create exact channel identity; authorize target tenant riêng
  → Handle event:
       user_send_text → parse reply-context / menu
       user_send_image → unsupported → fallback message
       follow / unfollow → update ChannelReachability
```

`zalo_bots` là source of truth duy nhất cho Zalo tenant routing. Không reuse `bank_accounts` token để tránh coupling giữa kênh chat và kênh tiền.

### 6.1 Event Contract

| Zalo event | Plexco action | Notes |
|------------|---------------|-------|
| `user_send_text` | Parse command hoặc reply-context | Unknown command → help menu |
| `user_send_image` | Safe fallback | Không xử lý ảnh trong MVP Zalo |
| `message.unsupported.received` | Owner digest + player fallback | Không expose lỗi kỹ thuật |
| `follow` / first inbound | Upsert exact endpoint identity reachability `canDm=true` | Key = `channel_identity_id`; không tenant/platform aggregate |
| `unfollow` / send failure | `canDm=false` | Không retry vô hạn |

Provider event id phải được dedupe trước khi gọi domain service.

---

## 7. Security (AUDIT §B2)

- Token **BYO per-club** → lộ = chỉ ảnh hưởng **1 CLB messaging**
- Token **không hết hạn** → rotation = owner reset trong Zalo Bot Creator + dán lại
- Bot token và `X-Bot-Api-Secret-Token` verification secret chỉ tồn tại at-rest dưới KMS/envelope ciphertext; `webhook_token` trong URL là opaque locator, không phải verification secret
- Live legacy `zalo_bots.secret text` phải được KMS-backfill hoặc connector chuyển `error`/reconnect, sau đó drop cột; runtime không được dual-read plaintext
- **Webhook drift detection**: cron gọi `getWebhookInfo` → so URL → lệch = alert + auto-reset
- **QR giả risk**: attacker có token → sendMessage giả STK → player CK nhầm.
- Mitigation: payment display được server dựng từ protected bank-account truth; bot copy chỉ chứa safe display/ref. Booking chỉ confirm từ canonical provider evidence, không từ ảnh/nội dung chat; token compromise triggers connector kill switch + owner alert.
- `message.unsupported.received` → fallback owner xử tay (AUDIT B6)

### 7.1 Token Rotation Runbook

1. Owner dán token mới trong web onboarding/settings.
2. Backend encrypt token/verification secret mới vào pending KMS credential version, set `zalo_bots.rotation_pending=true`, **giữ `zalo_bots.status='active'` và credential cũ vẫn phục vụ tenant**; không dùng DB plaintext staging field.
3. Verify token mới bằng test API call + set webhook URL.
4. Nếu verify OK → atomically promote **cả** pending bot token và pending webhook-verification secret thành current KMS credential version (`bot_token_enc` + `webhook_secret_enc` logical fields), set `rotation_pending=false`, status vẫn `active`; revoke/disable old provider credential nếu hỗ trợ.
5. Nếu fail → discard **cả hai** pending credential values, set `rotation_pending=false`, giữ current token+verification secret active, lưu redacted error code, không làm gián đoạn tenant.

## 8. Implementation Readiness

| Hạng mục | Status | Ghi chú |
|----------|--------|---------|
| Product/UX spec | ✅ Reviewed | `feature_zalo_channel.md` |
| BE tech spec | ✅ Reviewed | Có DDL `zalo_bots`, `zalo_reply_contexts` |
| Existing reference | ✅ Strong | Bestminton có Zalo transport production-ish cùng TG |
| Missing before coding | 🔴 Major | Shared Session/Join/Identity/Payment/funnel runtime, intent migration, exact event sandbox, rate limits and token verification |
| Delivery readiness | 🔴 Not code-ready | Product/BE contract exists, but P4.7 runtime and hard dependencies are not implemented |

**Go/no-go:** Zalo đủ khả thi cho MVP Việt Nam và là **kênh nhắc nợ chính** (cùng web push). Bắt buộc giữ DM-only, number-reply TTL, token drift và exact endpoint-scoped `ChannelReachability`; target-tenant eligibility không suy từ reachability.

---

## 9. Cross-references

| Topic | Doc |
|-------|-----|
| Zalo channel spec | [feature_zalo_channel.md](../../features/feature_zalo_channel.md) |
| Zalo BE tech | [feature_zalo_channel_tech.md](../../features/BE/feature_zalo_channel_tech.md) |
| Token leak threat | [AUDIT.md §B2](../../research/player-side-saas-AUDIT.md) |
| ChannelReachability | [feature_identity.md](../../features/feature_identity.md) |
| Link-or-pay booking funnel | [feature_channel_booking_funnel.md](../../features/feature_channel_booking_funnel.md) |

---

## 10. Changelog

| Date | Version | Thay đổi |
|------|---------|----------|
| 2026-07-28 | v0.7 | Sync phase to P4.7 and DD-32 list→detail→final gate; remove nonexistent deployable-path claim/raw Zalo ID context; add qualified link/pay-now hold, stronger QR proof boundary and honest not-code-ready status. |
| 2026-07-17 | v0.6 | BL-SEC-1/lifecycle closure: bot token + webhook secret KMS/write-only; legacy backfill-or-disable/drop/no-dual-read; atomically promote/discard both pending values and preserve `active` through registration races. |
| 2026-07-17 | v0.5 | DD-15/DD-67 closure: identity/reachability theo exact bot/OA endpoint, hai HMAC domain-separated, reachability gắn `channel_identity_id`; ingress/default tenant và target authorization tách riêng. Runtime/migration pending. |
| 2026-07-10 | v0.4 | **Phase-1 pivot (DD-37 ✅):** Zalo nay là kênh phase-1 (P2) + **kênh nhắc nợ chính** (cùng web push); Telegram loại khỏi phạm vi. Cập nhật phase/readiness/go-no-go; bảng "vs Telegram" giữ làm design rationale. |
| 2026-06-20 | v0.3 | Sửa token rotation: dùng `rotation_pending`/pending secret thay vì một lifecycle status ngoài enum |
| 2026-06-20 | v0.2 | Chốt `zalo_bots` làm routing source, thêm number-reply/event contract, token rotation, readiness |
| 2026-06-19 | v0.1 | Initial surface docs |

*Zalo bot surface docs v0.7. Kênh phase-1 (DD-32/DD-37/DD-67), delivery phase P4.7 — nhắc nợ chính cùng web push; runtime and prerequisite migrations pending.*
