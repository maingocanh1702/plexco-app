# FE screen inventory (from docs/channels/web/FE/*_fe.md — reference input, not constraints)

Compiled 2026-10-12 by an Explore subagent. Specs are Draft and were written under FE PENDING; DD-122
lifts that. Use this to pick routes/components; verify any DTO against code before relying on it.

## Host app shell (dashboard spec = source)
- Sidebar (desktop ≥1024: 240px; 768–1024: 64px icon-only; ≤768: hamburger overlay). IDs `#sidebar`,
  `#sidebar-backdrop`, `#menu-toggle`. Groups: Tổng quan [Dashboard] · Quản lý [Buổi chơi, Thanh toán,
  Thành viên] · Hệ thống [Cài đặt]. Club name on top; host name + Đăng xuất in footer.
- Mobile BottomNav 5 tabs: Dashboard · Buổi chơi · Thanh toán · Thành viên · Cài đặt.
- Header: title · 🔔 · [+ Tạo buổi mới]. StatusBadge: draft gray / open green / closed blue / cancelled red.

## Player shell (home spec)
- BottomNav 4 slots: Home `/` · Khám phá FAB `/discover` · Club `/me/clubs` · Setting `/me/settings`
  (Feed reserved, OFF). Desktop ≥1024: two columns, no bottom nav.

## Screens
| Spec | Route (spec) | Actor | Key components |
|---|---|---|---|
| auth | `/` landing+login; `/auth/email/verify`; `/auth/email/reset` | public | HeroSection, LoginCard, SocialButton(Google), InlineError, Toast |
| onboarding | `/onboarding` 4-step wizard (club · bank · zalo · messenger) + readiness | host | Stepper, ConnectorCard, StatusChip, ReadinessChecklist |
| dashboard | `/dashboard` | host | shell only authorized; StatCard/SessionCard zones UNPINNED |
| sessions | `/dashboard/sessions` list (tabs Tất cả/Sắp tới/Draft/Đã đóng, search); `/new` form groups Thời gian/Địa điểm/Giá & Chỗ/Cài đặt; `/:id` tabs Roster/Chi tiết | host | SessionListCard, FilterTabs, SessionForm, SportSelector, DateTimePicker, CapacityInput, VisibilityToggle, RosterTable, ActionBar, ConfirmDialog(bottom sheet) |
| members | `/dashboard/members` | host | MemberTable, DebtBadge, MarkPaidAction (membership_id + charge_id), MergeReview (hasFinancialHistory===false only) |
| payments | `/dashboard/payments` ledger (tabs Tất cả/Chưa khớp/Lịch sử) | host | SummaryCard, TransactionTable, AllocationPanel, SourceBadge(auto/manual/cash/waiver/reversal), ReversalDialog |
| settings | `/dashboard/settings` tabs CLB/Ngân hàng/Kênh; `/me/settings` tabs Hồ sơ/Bảo mật | host / self | SettingsForm (pristine/dirty/saving/saved), BankAccountCard, ConnectorCard, PII consent toggle |
| player_view | `/me`, `/me/clubs/:clubId`, `/me/charges` | player | PersonChips, ClubCard, UpcomingRow, OutstandingItemCard, ClubPayAction |
| home | `/` signed-in PWA home | player | HeroCard, FinanceChips, UpcomingList, OnboardingChecklist, OfflineBanner |

## Action buttons by session status
draft = Sửa + Đăng kèo + Huỷ nháp · open = Sửa + Đóng + Huỷ · closed/cancelled = view only.

## Pinned error codes seen in specs
sessions: INVALID_TIME_RANGE SPORT_INACTIVE MISSING_DISCOVERY_FIELDS STALE_VERSION SESSION_NOT_OPEN
CAPACITY_BELOW_ROSTER CAPACITY_BELOW_OCCUPANCY PRICE_CHANGE_REQUIRES_POLICY CANCEL_REQUIRES_REVIEW ·
auth: AUTH_INVALID AUTH_STALE CSRF_INVALID LOGIN_RATE_LIMITED AUTH_UNAVAILABLE (Google failure →
`/?auth_error=CODE`) · onboarding: SLUG_TAKEN INVALID_BODY RATE_LIMITED AUTH_REQUIRED ·
payments: ALLOCATION_EXCEEDS_FUNDS CHARGE_ALREADY_SETTLED REVERSAL_EXCEEDS_EFFECTIVE.

## Conflicts the program resolves (design.md)
1. `/` = public landing (auth) vs signed-in home (home) → `/` redirects signed-in users to their workspace.
2. Two shells (host sidebar+5 tabs vs player 4 tabs) → one shell component, role-driven tab set.
3. `/dashboard/*` has no tenant in the path → program uses `/c/[tenantId]/...` (API keys on `?tenant=`).
4. Post-login destination UNPINNED → `/` resolves: 0 clubs → `/onboarding/new-club`; 1 club → `/c/<id>`; N → chooser.
5. Design-system catalog lists MarkPaidPanel/PaymentSourceSelector but sessions spec omits payment UI → M2c adds mark-paid on the roster row (DD-40 tap/multi-select).
