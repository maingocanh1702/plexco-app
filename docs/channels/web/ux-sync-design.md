# Web/App-first UX + Multi-surface Sync Design

> Version: v0.2 · 2026-07-10
> Scope: UX architecture cho web/app khi Plexco có các bot surfaces phase-1: **Zalo + Facebook Messenger** (Telegram đã loại — DD-37).
> Related docs: `README.md`, `design-brief.md`, `../../features/feature_sync_engine.md`, `../../features/feature_session_management.md`, `../../features/feature_payment_reconcile.md`, `../../features/feature_marketplace_discovery.md`, `../../features/feature_player_view.md`, `../../standards/business-rules.md`
>
> **Cập nhật v3.4 (DD-37 ✅):** kênh phase-1 = **web + Zalo + Facebook Messenger**; **Telegram loại khỏi phạm vi**. Nhắc nợ chính = **web + Zalo DM**, Messenger best-effort trong 24h. Auth phase-1 = Google + email (DD-13). Action-mapping cột Telegram thay bằng **Messenger** (player-only surface).

## 1. Tóm tắt

Web/app là main product của Plexco. Bot vẫn tồn tại vì người dùng đã ở trong Zalo/Facebook Messenger, nhưng vai trò dài hạn của bot là **kênh thông tin, thông báo, nhắc việc và deep-link router** về web/app. Các tương tác nghiệp vụ chính của user nên được điều hướng sang web/app để có UX đầy đủ, kiểm soát quyền tốt hơn, audit rõ hơn và tránh phân mảnh flow theo từng nền tảng chat.

Web/app không nên được thiết kế như "bot có giao diện". Web/app là workspace chính để host và player nhìn tổng thể, xử lý ngoại lệ, cấu hình, audit, khám phá kèo và thực hiện hành động. Bot chỉ nên giữ các action cực ngắn hoặc các fallback cần thiết trong chat.

Mọi surface đều phải ghi vào cùng canonical domain model:

```text
Web/App / Zalo / Messenger / Webhook
  → command API
  → domain service
  → PostgreSQL canonical store
  → outbox event
  → projectors cập nhật từng surface
```

Vì vậy, mục tiêu UX không phải là làm các platform giống nhau về giao diện. Mục tiêu là web/app sở hữu workflow chính, còn bot gửi thông tin đúng lúc và mở đúng object trên web/app: `Session`, `Roster`, `Charge`, `Payment`, `Member`, `Tenant`, `Person`.

## 2. Product mental model

### Bot surfaces

Bot phù hợp cho:

- Thông báo kèo mới, thay đổi lịch, roster update.
- Nhắc nợ, xác nhận đã trả, cảnh báo connector/sync.
- Gửi deep-link/magic-link mở web/app đúng context.
- Action cực ngắn trong giai đoạn chuyển tiếp, ví dụ tap join hoặc reply xác nhận, nếu UX web/app chưa đủ thuận tiện.

Bot không phù hợp cho:

- Là nơi mặc định để user thực hiện toàn bộ workflow.
- Xem ledger phức tạp.
- Xử lý unmatched payment nhiều dòng.
- Merge identity có audit.
- Cấu hình connector, bank, billing.
- So sánh nhiều session hoặc nhiều club.

Long-term rule: mỗi thông báo bot có liên quan tới một nghiệp vụ nên có CTA mở web/app. Ví dụ: "Xem kèo", "Thanh toán", "Duyệt người chơi", "Xử lý giao dịch chưa khớp", "Cập nhật cấu hình".

### Web/app surface

Web/app phù hợp cho:

- Main product experience cho host và player.
- Host dashboard và operations workspace.
- Session management có form, table, preview và confirmation.
- Payment ledger, unmatched transactions, manual allocation, reversal.
- Member directory, duplicate/merge review.
- Marketplace discovery.
- Player self-service view.
- Sync health và reproject tools.

## 3. Information architecture

### Host Workspace

```text
/dashboard
  → overview: upcoming sessions, debt, recent payments, sync warnings

/dashboard/sessions
  → list, filter, create, clone, edit, close, cancel

/dashboard/sessions/:id
  → session detail, roster, charges, QR, announcements, activity timeline

/dashboard/payments
  → ledger, unmatched, manual allocation, cash, reversal

/dashboard/members
  → member list, duplicate review, merge identity, role/status

/dashboard/settings
  → tenant config, bank account, Zalo token, Facebook Messenger Page, notification policy

/dashboard/billing
  → plan, subscription status, invoices, channel entitlements
```

Host workspace nên dùng layout operational: sidebar, dense tables, list-detail, drawers, confirmation modals, inline validation và audit timeline. Không dùng chat transcript làm pattern chính.

### Player App

```text
/discover
  → public marketplace, filters, search results

/discover/:id
  → public session preview, join CTA

/me
  → own clubs, upcoming sessions, debt summary

/me/clubs/:id
  → own sessions and charges in one club

/me/charges
  → own payment instructions and status

/magic/:hash
  → consume magic link from bot, then redirect to /me or relevant session
```

Player UX phải mobile-first. Các flow chính cần ít bước: tìm kèo, join, xem nợ, lấy thông tin chuyển khoản, kiểm tra trạng thái thanh toán.

### Onboarding / Integration

```text
/onboarding
  1. Club info
  2. Bank / SePay
  3. Zalo bot token
  4. Facebook Messenger (Page) optional
  5. Readiness checklist
```

Connector UI phải hiển thị rõ trạng thái:

- `not_connected`
- `pending_verification`
- `connected`
- `degraded`
- `failed`
- `needs_rotation`

## 4. Action mapping

Feature parity là domain parity, không phải UI parity. Web/app là primary interaction path. Bot có thể khởi tạo intent hoặc phục vụ transitional quick actions, nhưng default UX phải điều hướng user về web/app để hoàn tất hành động.

> Messenger = **player-only surface** (host commands ❌ — host thao tác ở web); nhắc/xác nhận Messenger phải tôn trọng cửa sổ 24h.

| Domain action | Messenger (player-only) | Zalo | Web/app | Canonical command |
|---|---|---|---|---|
| Tạo session | Notify/link tới web (không phải host surface) | Không ưu tiên | Create form | `CreateSession` |
| Sửa session | Notify/link tới session detail | Không ưu tiên | Edit form | `UpdateSession` |
| Publish session | Notify/link tới web | Không ưu tiên | Visibility toggle | `PublishSession` / `UpdateVisibility` |
| Join session | Quick-reply/postback (trong 24h); CTA mở web/app | CTA mở web/app; number reply transitional | Join CTA | `JoinSession` |
| Leave session | Quick-reply/postback; CTA mở web/app | CTA mở web/app | Leave button | `LeaveSession` |
| Close session | Notify/link tới web | Không ưu tiên | Close action | `CloseSession` |
| Mark-paid / cash (DD-40) | Xác nhận tới player (best-effort 24h) | Xác nhận tới player | Mark-paid tap/multi-select + cash form | `RecordCashPayment` |
| Unmatched allocation | Alert + link tới ledger | Alert + link tới ledger nếu có | Ledger allocation UI | `AllocatePayment` |
| Payment reversal | Alert/link only | Không ưu tiên | Reversal modal | `ReverseAllocation` |
| Identity link | Send OTP `/link` / magic-link | Send OTP/magic-link | Merge tool / magic link | `LinkChannelIdentity` |
| Host approval | Alert + approval link tới web | Alert + approval link | Approval queue | `ApproveJoinRequest` |

Adapter-specific details such as Messenger postback payloads and Zalo reply-context are hints only. Every mutation must reload canonical state and validate permissions before commit. For new features, prefer bot notification + web/app deep-link over adding another chat-native workflow.

## 5. Sync architecture

```text
Web/App action or bot intent
  → commandId + actor + source + payload
  → command bus
  → authz + tenant/person scope
  → domain service
  → canonical state + processed_commands + outbox_events commit
  → dispatcher
  → projector_deliveries
  → Web/App realtime / Zalo / Messenger / Public projection
```

Rules:

- Web/app, Zalo and Messenger must not maintain independent truth.
- Web/app is the primary UX for mutations; bot mutations are compatibility or convenience adapters.
- Duplicate `commandId` returns the previous semantic result.
- Outbox event and domain mutation commit atomically.
- Projector delivery is tracked per projector.
- One failed projector must not roll back canonical state.
- Reproject rebuilds derived surfaces from canonical state and events.

## 6. Web sync states

Web UI must separate canonical save status from projection delivery status.

| State | Meaning | UI behavior |
|---|---|---|
| `saving` | Command is being submitted | Disable duplicate submit for the same action, show "Đang lưu..." |
| `saved` | Canonical DB commit succeeded | Show "Đã lưu" and update local view from canonical response |
| `syncing` | Outbox/projectors are still delivering | Show subtle "Đang đồng bộ kênh..." |
| `synced` | Required projectors delivered | Clear sync indicator or show recent success in activity timeline |
| `partial_sync` | At least one projector failed or is retrying | Show warning: "Đã lưu, một kênh chưa cập nhật" |
| `sync_failed` | Projector reached DLQ | Show admin-visible action: retry/reproject/contact support |
| `stale` | Client lost realtime connection | Fall back to refetch/polling and show connection state |

Copy guidance:

- Canonical success: "Đã lưu".
- Projection lag: "Đã lưu, đang đồng bộ Zalo/Messenger".
- Delivery warning: "Dữ liệu đã an toàn. Zalo chưa cập nhật, hệ thống sẽ thử lại."
- Hard failure: "Cần kiểm tra đồng bộ. Dữ liệu gốc không bị mất."

## 7. Data scope and privacy

UX must follow three data scopes.

### Public

Used by marketplace discovery.

Allowed fields:

- Sport.
- Starts/ends time.
- Coarse area.
- Skill level.
- Price.
- Slots open.
- Club/host display name.
- Join policy.

Never expose:

- Tenant routing ID.
- Exact venue before join/approval.
- Roster.
- Payment/debt status.
- Bank account.
- Phone/email.
- Channel IDs.

### Tenant-private

Used by host dashboard.

Includes:

- Roster.
- Payment ledger.
- Charges and allocations.
- Member directory.
- Bank and bot connector settings.
- Sync health.

Requires TenantAdmin/TenantOwner authz and RLS.

### Person-self

Used by `/me`.

Includes only data owned by the authenticated person:

- Their clubs.
- Their sessions.
- Their charges/payment status.
- Their join requests.
- Their history after leaving a club.

Never expose other players' roster, debt, contact or admin data.

## 8. Core screen requirements

### Dashboard overview

Must answer:

- What sessions are coming up?
- How many players joined?
- How much is outstanding?
- What payments just arrived?
- Are any connectors or projectors failing?

Recommended modules:

- Upcoming sessions.
- Outstanding debt summary.
- Recent payment feed.
- Unmatched count.
- Connector status strip.
- Sync warning panel.

### Session detail

Must be the operational center for one session.

Sections:

- Header: sport, time, status, visibility, join policy.
- Roster: player, join source, join status, payment status.
- Payment: charge summary, paid/partial/unpaid, QR or payment instruction.
- Announcements: Zalo/Messenger message ref, public projection status.
- Actions: edit, close, cancel, announce, reproject.
- Activity timeline: joins, leaves, payments, edits, projector warnings.

### Payments / ledger

Must support exception handling.

Sections:

- Bank transactions.
- Allocations.
- Unmatched transactions.
- Candidate matching view.
- Manual allocation form.
- Reversal flow.
- Audit history.

Money UI must fail closed: if the system cannot prove an allocation is safe, show it as needing review rather than silently treating it as zero or paid.

### Members / identity

Must support cross-platform identity safely.

Sections:

- Members list.
- Channel identities per person.
- Duplicate candidates.
- Merge preview.
- Merge audit.
- Link-code status.

Membership with money history must not be auto-claimed by fuzzy name match alone.

### Discovery

Must be public, fast and privacy-safe.

Sections:

- Filters: sport, area, time, skill, price, slot availability.
- Result cards with public whitelist only.
- Detail preview with join CTA.
- Empty state and reset filters.
- Rate-limit friendly pagination.

`slots_open` is advisory. Join must recheck capacity transactionally.

### Player view

Must be self-service.

Sections:

- My clubs.
- Upcoming sessions across clubs.
- Charges and payment status.
- Payment instructions.
- Join requests.
- Magic-link/session status.

Player view should not route by URL-provided `person_id`; authority comes from verified session or magic link.

## 9. Cross-platform design contracts

1. A surface action is not trusted until canonical command validation passes.
2. UI retries must reuse the same `commandId` for the same user intent.
3. Surface-specific IDs must be opaque and revalidated server-side.
4. Web reads canonical APIs after SSE invalidation; SSE payloads should be minimal.
5. Bot message edits are projections, not source data.
6. Public projection is field-whitelisted and rebuildable.
7. Connector delivery failure is visible but does not mutate business state.
8. Admin correction actions on money or identity require audit.
9. Reproject must not blindly resend notifications with side effects.
10. Messenger is a **phase-1 channel** (DD-37) and delivery must respect the 24h policy window; nhắc chính vẫn qua web + Zalo.

## 10. Recommended implementation sequence

1. Build command/service/outbox foundation.
2. Scaffold web shell, layout, design tokens and route boundaries.
3. Implement Host Sessions workspace.
4. Implement Session Detail with roster and activity timeline.
5. Implement Player View `/me` baseline and magic-link entry.
6. Implement bot notification templates that deep-link to web/app screens.
7. Implement Payment ledger and unmatched allocation.
8. Implement connector onboarding/settings.
9. Implement Marketplace Discovery and Cross-club Join.
10. Implement sync health, retry and reproject admin UX.
11. Reduce bot-native action scope to quick actions and notification routing once web/app flows are stable.

Do not build deep payment UI before ledger invariants and allocation services are stable.

## 11. Open decisions

| ID | Decision | Notes |
|---|---|---|
| UX-OQ-1 | Exact desktop/mobile screen handoffs | Needed before production UI implementation |
| UX-OQ-2 | Public location granularity | District vs radius vs venue area |
| UX-OQ-3 | Discovery ranking | Upcoming/area first vs distance-aware ranking |
| UX-OQ-4 | Reproject admin UX | Which users can retry/reproject and at what scope |
| UX-OQ-5 | Sync health visibility | Always visible vs warnings only |
| UX-OQ-6 | Price-change UX | Keep existing charges vs adjustment entries |

## 12. Design principle

Web/app should be the main product, control plane and marketplace. Bots should be information, notification and routing channels that bring users back to the right web/app screen. Data consistency must come from canonical commands, outbox delivery and projector repair, not from making each surface store or reconcile its own state.
