# Business Requirements Document (BRD) — Plexco CRM & Operations Dashboard
## Dashboard nội bộ quản lý tăng trưởng, vận hành, CRM và sức khoẻ hệ thống Plexco

---

## 0. Document Control

| | |
|---|---|
| **Sản phẩm** | **Plexco CRM & Operations Dashboard** — dashboard nội bộ cho Platform Owner/CS/Ops theo dõi user, host, player, session, marketplace, payment, billing, trust, security và vận hành hệ thống |
| **Phiên bản** | v1.2 — fix timezone/calendar rule, tách engaged vs participating player, đồng bộ metric dictionary |
| **Ngày** | 21/06/2026 |
| **Người soạn** | Codex |
| **Người duyệt** | Ngoc-Anh |
| **Trạng thái** | Draft để review |
| **Tài liệu liên quan** | `BRD.md` v3.1 · `PRD.md` v2.1 · `ROADMAP.md` v2.1 · `../features/README.md` v2.0 · `../../Plexco_GTM_Strategy.md` · `../standards/business-rules.md` |
| **Nguồn tham khảo bên ngoài** | Mixpanel — "25+ ecommerce product metrics to track today" (Jun 2, 2026): https://mixpanel.com/blog/ecommerce-product-metrics/ |

> Tài liệu này mô tả dashboard **nội bộ** để quản lý Plexco như một business/platform. Nó không thay thế host dashboard (`/dashboard`) của tenant, player view (`/me`) hoặc marketplace (`/discover`). Khi conflict: core BRD/PRD/business-rules thắng về scope, quyền dữ liệu và security.

---

## 1. Executive Summary

Plexco là platform hai phía: **host tạo/quản lý kèo** và **player khám phá/join kèo**, hoạt động qua web app + Telegram/Zalo, với canonical store là PostgreSQL/domain model. Vì vậy CRM dashboard không chỉ đo "total user" hay "sessions", mà phải trả lời 5 câu hỏi vận hành:

1. **Plexco có đang tăng trưởng thật không?** Total users, new signups, active users, active hosts, engaged/participating players, total sessions, completed sessions, sessions per host.
2. **Marketplace có thanh khoản không?** Số kèo publish, slots trống, fill success, external slots filled, discovery join rate, cross-host player rate.
3. **Host có nhận được giá trị đủ để trả tiền không?** Time to first session, second-session rate, host retention, payment auto-match rate, reminder effectiveness, MRR/churn.
4. **Player có quay lại và xây trust graph không?** RSVP-to-registration, first attendance, repeat attendance, engaged/participating player retention, reliability band, no-show/dispute rate.
5. **Hệ thống có an toàn và ổn định không?** Cross-tenant leakage = 0, public PII/payment leak = 0, sync-lag, webhook health, connector drift, incident/SLO status.

Dashboard cần kết hợp tư duy metric tree của ecommerce/product analytics (high-level KPI → acquisition → conversion → trend → retention) nhưng customize cho Plexco: "purchase" được thay bằng **join/attendance/payment-settled/completed-session**, "product/category" được thay bằng **sport/liquidity cell/plan/channel**, "refund/return" được thay bằng **payment reversal, dispute, late cancel/no-show**.

---

## 2. Business Context

### 2.1 Plexco operating model

Plexco có 4 lớp dữ liệu chính:

| Lớp | Ý nghĩa | Ví dụ dữ liệu |
|---|---|---|
| **Platform CRM** | Quản lý account/person/tenant và vòng đời khách hàng | host signup, tenant status, plan, owner, onboarding progress |
| **Marketplace liquidity** | Sức khoẻ supply-demand trong từng sport/area/time/skill cell | published sessions, open slots, join requests, external slots filled |
| **Operational ledger** | Kèo, roster, charge, bank transaction, allocation, reminder | sessions, charges, paid/unpaid, unmatched, reminder sent |
| **Trust & safety** | Identity, attendance, no-show, dispute, incident, public/privacy invariant | reliability band, merge risk, abuse signal, security alerts |

### 2.2 Why a CRM dashboard is needed

Giai đoạn beta của Plexco cần quản lý thủ công chặt:

- Onboard host theo từng liquidity cell, không launch rộng.
- Theo dõi host nào đã tạo kèo đầu, host nào có nguy cơ drop.
- Biết player đến từ kênh nào, join qua host/group hay discovery.
- Đo slot nào Plexco thật sự lấp được, không chỉ vanity traffic.
- Theo dõi tiền và đối soát để chứng minh giá trị host tool.
- Bắt sớm lỗi security/sync/connector trước khi ảnh hưởng trust.

### 2.3 External reference adaptation

Mixpanel gợi ý nhóm ecommerce metrics theo: high-level KPIs, acquisition, conversion, purchase trends, retention/loyalty. Plexco dùng cùng khung nhưng đổi đối tượng:

| Ecommerce metric | Plexco equivalent |
|---|---|
| Revenue over time | MRR, paid tenants, ARPA, billing collection |
| Revenue per product/brand | MRR/sessions/join theo sport, plan, liquidity cell, channel |
| Active/new purchasers | Active/new hosts, active/new players, active/new joiners |
| Average order value | Average revenue per active tenant, average session fee, GMV observed by tenant ledger (not platform revenue) |
| LTV/CAC/ROAS | Host LTV/CAC, payback period, channel ROI |
| Funnel conversion | Host onboarding funnel, player discovery-to-join funnel, payment settlement funnel |
| Purchases over time | Sessions created, joins, attendances, charges settled over time |
| Repeat customer rate/churn | Host retention/churn, player repeat attendance, cross-host player rate |
| Refund/return rate | Payment reversal rate, attendance dispute rate, no-show/late cancel rate |

---

## 3. Personas & Stakeholders

| Persona | Vai trò | Nhu cầu chính |
|---|---|---|
| **P5 Platform Owner / Founder** | Chủ vận hành Plexco | Nhìn toàn business, ưu tiên cell/host, phát hiện rủi ro, ra quyết định scale |
| **Growth / CS Operator** | Onboard host, chăm sóc beta | Biết host nào cần follow-up, funnel nào nghẽn, cell nào đủ density |
| **Operations / Support Admin** | Xử lý unmatched, merge, connector, incident | Tìm nhanh tenant/person/session/transaction, xử lý an toàn có audit |
| **Finance / Billing Operator** | Theo dõi subscription/MRR/invoice | Billing lifecycle, paid conversion, churn, overdue, plan entitlement |
| **Security / Reliability Owner** | Đảm bảo isolation, uptime, privacy | SLO, incident, invariant failures, leak alerts, connector drift |

> Dashboard này không dành cho host/player thông thường. Mọi dữ liệu tenant-private/person-self phải được hiển thị theo quyền admin nội bộ chặt, có audit và redaction.

---

## 4. Objectives & Success Metrics

### 4.1 Objectives

| ID | Objective |
|---|---|
| **OBJ-CRM-1** | Cung cấp một nơi duy nhất để theo dõi business health của Plexco theo ngày/tuần/tháng/cell. |
| **OBJ-CRM-2** | Quản lý lifecycle host từ signup → onboarding → first session → active → paid → retained/churned. |
| **OBJ-CRM-3** | Theo dõi player lifecycle từ first touch → signup/identity → RSVP/join → attendance → repeat/cross-host. |
| **OBJ-CRM-4** | Đo liquidity marketplace: sessions published, slots open, requests, acceptance, fill success, time-to-fill. |
| **OBJ-CRM-5** | Theo dõi tiền: tenant ledger health, payment auto-match, unmatched backlog, settlement, billing/MRR. |
| **OBJ-CRM-6** | Bắt rủi ro privacy/security/reliability: sync lag, webhook failure, connector drift, PII leak, incident. |
| **OBJ-CRM-7** | Hỗ trợ CRM actions: segment, filter, note, assign follow-up, export safe list, không cần query SQL thủ công. |

### 4.2 North-star and tiered KPIs

| Tầng | KPI | Định nghĩa |
|---|---|---|
| **North Star** | **Completed sessions/week** | Kèo được tạo → có player join → diễn ra/đóng → charge/payment/attendance được xử lý đủ theo phase |
| **Beta survival** | **External slots filled/week** | Số slot trống được Plexco Fill/discovery lấp thành công mỗi tuần |
| **Supply** | Weekly active hosts | Host/tenant có ít nhất 1 session created/announced/closed hoặc admin action có giá trị trong tuần |
| **Demand** | Weekly engaged players + weekly participating players | Engaged = player tự tương tác; participating = engaged hoặc có attendance/payment được ghi nhận |
| **Marketplace** | Discovery join rate | `join_succeeded_from_discovery / marketplace_join_cta_clicked` |
| **Trust network** | Cross-host player rate | `% participating players tham gia >=2 host trong cùng liquidity cell` |
| **Monetization** | MRR & paid tenant conversion | MRR active paid plans; trial/free → paid conversion |
| **Operations** | Payment auto-match rate | `auto matched bank transactions / total ingested bank transactions` |
| **Reliability** | Sync-lag p95/p99 | Time từ command commit đến projector success; target p95 <= 3s, p99 <= 10s |
| **Safety** | Privacy/security leak count | Cross-tenant leak hoặc public PII/payment leak; target = 0 |

### 4.3 Active user — định nghĩa chốt (qualifying events)

Để thoả BR-CRM-3 (mọi metric phải có định nghĩa chốt), "Active" được định nghĩa **theo role**. Một person tính là active trong window nếu phát sinh ≥1 event tương ứng. Đây là định nghĩa MVP đóng băng cho lần instrument đầu; thay đổi phải qua changelog metric (NFR-CRM-S3).

| Role | Active nếu có ≥1 event trong window | Loại trừ rõ ràng |
|---|---|---|
| **Active host** | `session_created`, `session_updated`, `session_announced`, `session_closed`, hoặc admin action có giá trị (roster edit, approve join, allocation, reminder gửi tay) | Login đơn thuần, mở dashboard mà không thao tác |
| **Engaged player** | Player tự phát sinh tương tác: `join_attempted/succeeded`, `join_leave`, `marketplace_searched/detail_opened/join_cta_clicked`, `player_view_opened`, `player_own_debt_viewed`, `reminder_response` | Chỉ nhận reminder mà không phản hồi; bot callback rỗng; attendance/payment do host/system ghi hộ |
| **Participating player** | Engaged player **hoặc** có participation/ledger event được ghi nhận: `attendance_marked`, `payment_charge_settled` | Health-check, system/test account, internal impersonation |
| **Active user (chung / product engagement)** | Union của host-active và **engaged player** ở trên | Pure system/host-side events của player như attendance/payment settled nếu player không tương tác |

Quy tắc bắt buộc đi kèm: (a) dedupe theo `person.id`; (b) loại test/internal account trừ khi filter bật; (c) window DAU=1d, WAU=7d, MAU=30d theo timezone/calendar rule ở §9.4; (d) một event chỉ tính cho đúng role phát sinh nó (một person vừa host vừa player có thể active ở cả hai chiều).

> Lý do tách 2 player metric: `Engaged player` đo mức người chơi tương tác với Plexco/app/bot; `Participating player` đo người chơi thật sự đang hoạt động trong kèo/ledger, kể cả khi host/system ghi nhận attendance hoặc payment hộ. Executive DAU/WAU/MAU mặc định dùng **engagement**; liquidity/trust/payment dashboard có thể dùng **participation**.

> CRM-OQ-1 được chốt tại mục này. Danh sách event có thể mở rộng khi instrument, nhưng không được thu hẹp mà không ghi changelog.

### 4.4 Project success metrics (đo dashboard, không phải đo sản phẩm)

§4.2 đo sức khoẻ Plexco. Bảng dưới đo **dashboard này có thành công không** — dùng để nghiệm thu và quyết định đầu tư tiếp. Baseline được chụp ở thời điểm launch nếu chưa có số.

| ID | Success metric | Baseline (hiện tại) | Target | Cách đo |
|---|---|---|---|---|
| **SM-1** | Thời gian tìm 1 unmatched payment cụ thể (tenant + giao dịch) | Thủ công qua SQL/DB, ~chưa đo | < 30s qua queue `/internal/payments` | Đo tay 5 case khi nghiệm thu Phase CRM-3 |
| **SM-2** | Số quyết định cell/host cần engineer chạy SQL tay | Hầu hết quyết định cần SQL | 0 query tay cho 9 câu hỏi vận hành ở §1 | Owner/Growth tự lấy số trên dashboard |
| **SM-3** | Độ trễ phát hiện sự cố security/sync (alert → người thấy) | Phụ thuộc log thủ công | ≤ 1 phút cho critical (khớp §9.3) | Drill alert; đo time-to-surface |
| **SM-4** | % founder weekly review dùng dashboard thay vì spreadsheet tay | 0% | ≥ 80% sau 4 tuần Phase CRM-1 | Tự khai báo + audit truy cập report |
| **SM-5** | Tỉ lệ metric có định nghĩa + tooltip dẫn tới metric dictionary | — | 100% metric hiển thị (khớp acceptance §16) | Kiểm tra UI khi nghiệm thu |
| **SM-6** | Executive overview load time (cached aggregate) | — | < 2s (khớp NFR-CRM-S4) | Đo p95 thực tế |

Mỗi phase ở §15 phải gắn ít nhất một SM ở trên làm điều kiện đóng phase.

---

## 5. Scope

### 5.1 In scope

- Internal CRM dashboard for Platform Owner/Ops.
- Company overview: total users, active users, signups, sessions, revenue, retention.
- Host/tenant CRM: lifecycle, plan, onboarding, activity, risk, follow-up.
- Player CRM: identity, channel reachability, lifecycle, activity, trust band, cross-host behavior.
- Session/marketplace analytics: total sessions, active sessions, completed sessions, public/private, join funnel, fill-slot.
- Payment ops: bank transactions, charge settlement, unmatched, auto-match, reminders, confirmations.
- Billing ops: subscription, invoices, MRR, churn, plan entitlement, overdue.
- Channel/connector ops: Telegram/Zalo/web, SePay/ApiPay, status/drift/error, delivery health.
- Trust & safety: attendance, no-show, dispute, merge risk, audit events, incidents.
- Cohort, segmentation, filters, CSV export with redaction.
- Alerts/thresholds for metrics and SLO breaches.

### 5.2 Out of scope

- Host-facing dashboard redesign.
- Player-facing marketplace/player view.
- Full BI warehouse or self-serve SQL exploration.
- Marketing automation send engine (email/SMS/push campaign execution). Dashboard can define segments/export, but does not send campaigns in MVP.
- Public leaderboards or public player ratings.
- Real-time fraud scoring beyond alerts and review queues.

---

## 6. Core Business Requirements

| ID | Requirement |
|---|---|
| **BR-CRM-1** | Dashboard MUST separate **platform-wide internal metrics** from tenant-private/person-self surfaces. |
| **BR-CRM-2** | Dashboard MUST show core counters: total users, total hosts, total players, total signups, total sessions, active sessions, completed sessions, active users, DAU/WAU/MAU. |
| **BR-CRM-3** | Every metric MUST have a documented definition, date window, timezone rule and dedupe key. |
| **BR-CRM-4** | Dashboard MUST support breakdown by sport, liquidity cell, area, channel, plan, tenant status, cohort and acquisition source. |
| **BR-CRM-5** | Dashboard MUST show host lifecycle funnel: signup → tenant created → connector verified → first session → second session → active host → paid host → retained. |
| **BR-CRM-6** | Dashboard MUST show player lifecycle funnel: first touch → identity/person created → first join/RSVP → first attendance → first payment settled → repeat attendance → cross-host. |
| **BR-CRM-7** | Marketplace analytics MUST distinguish normal member joins vs cross-club/discovery joins. |
| **BR-CRM-8** | Platform revenue MUST be separated from tenant/player payment flow because Plexco does not intermediate player money. |
| **BR-CRM-9** | Payment health MUST be fail-closed: unknown/unmatched/remainder are never treated as settled/zero risk. |
| **BR-CRM-10** | PII, bank content, raw platform IDs, venue details and secrets MUST NOT appear in analytics views unless explicitly opened in a privileged support detail view with audit. |
| **BR-CRM-11** | Dashboard MUST support actionable CRM queues: hosts to onboard, hosts at risk, unmatched payments, pending approvals, merge suggestions, connector errors, overdue invoices, incidents. |
| **BR-CRM-12** | Dashboard MUST expose SLO and invariant failures for sync, webhook ingest, public projection and tenant isolation. |
| **BR-CRM-13** | Dashboard exports MUST be redacted by default and scoped to the current role/filters. |
| **BR-CRM-14** | Every manual admin action from dashboard that touches money, identity, subscription, security or tenant status MUST write immutable audit. |

---

## 7. Functional Requirements

### MODULE 1 — Executive Overview

**Goal:** One screen for current health of Plexco.

Required widgets:

- Total users, total hosts, total players, total tenants.
- New signups today/7d/30d.
- DAU/WAU/MAU and stickiness (`DAU/MAU`, `WAU/MAU`).
- Total sessions, active/open sessions, completed/closed sessions, cancelled sessions.
- Sessions created per day/week and sessions per active host.
- Published sessions, open slots, external slots filled.
- MRR, paid tenants, trialing/past_due/suspended tenants, churn.
- Payment auto-match rate, unmatched backlog, reminder-to-payment conversion.
- Sync-lag p95/p99, webhook failure rate, connector drift count.
- Critical alerts: privacy leak, cross-tenant invariant fail, payment over-allocation, SLO breach.

### MODULE 2 — User & Signup Analytics

Required metrics:

| Metric | Definition |
|---|---|
| **Total users** | Count distinct global `persons` not deleted/anonymized. |
| **Total hosts** | Count persons with owner/admin role in at least one tenant. |
| **Total players** | Count persons with at least one player/guest membership or player-side event. |
| **Total signups** | Count `identity_person_created`, `tenant_created`, or verified account creation depending on selected user type. |
| **New users** | Persons created in selected period. |
| **Active users** | Distinct persons matching §4.3 role-aware engagement definition. Executive DAU/WAU/MAU uses `host-active ∪ engaged-player`; participation views may additionally show `participating players`. |
| **DAU/WAU/MAU** | Distinct active persons over 1/7/30-day windows. |
| **Activation rate** | `% new users who complete activation event within X days`; host = first session, player = first join/attendance. |
| **Signup source** | Web/TG/Zalo/discovery/manual import/referral/host invite. |

Required views:

- Signup trend by day/week.
- Active users by role: host, co-admin, engaged player, participating player, discovery-only.
- Channel mix: web, Telegram, Zalo, Messenger post-MVP.
- Cohort retention: D1/D7/D30 for players; W1/W4/W8 for hosts.
- User detail search with redacted profile, memberships, channel reachability, activity timeline.

### MODULE 3 — Host/Tenant CRM

Required tenant fields:

- Tenant ID, display name, sport default, area/cell, owner, status.
- Plan, subscription status, trial/period dates, billing health.
- Onboarding checklist: bank, Telegram, Zalo, first session, first public session.
- Connector status: SePay/ApiPay, Telegram link, Zalo bot, webhook status.
- Activity: sessions/week, last active, engaged players, participating players, roster size, payment health.
- Marketplace: sessions published, fill-only/public usage, external slots filled, join approval latency.
- Risk score: no session after signup, connector failed, no second session, payment backlog, churn risk.
- CRM notes, owner, next follow-up date, segment tags.

Required host metrics:

| Metric | Definition |
|---|---|
| **Active tenants** | Tenants with qualifying admin/session/payment activity in selected period. |
| **Weekly active hosts** | Distinct host persons active in a week. |
| **Time to first session** | Tenant created → first `session_created`. |
| **Second-session rate** | `% tenants with second session within 7 days of first session`. |
| **Sessions/host/week** | Sessions created or completed per active host per week. |
| **Host 4-week retention** | Host active in week 0 and week 4. |
| **Churned tenant** | Paid tenant cancelled or inactive beyond configured threshold; billing churn and product churn must be separated. |

Required queues:

- New hosts not onboarded.
- Hosts with connector failed/drift.
- Hosts with first session not created within 24h.
- Hosts with no second session within 7d.
- Hosts with high unmatched payment rate.
- Hosts with public/fill eligible sessions but never enable fill.
- Past_due/suspended paid tenants.

### MODULE 4 — Player CRM & Lifecycle

Required player fields:

- Opaque person ID, display-safe name, role(s), created date.
- Channel identities and reachability by tenant/platform, redacted.
- Memberships and clubs count.
- Activity timeline: search, join, attendance, payment, reminder, player view.
- Trust state: reliability band, attendance counts, late cancel/no-show/dispute counts.
- Cross-host indicators: hosts played with, sports, cells, repeat rate.
- Merge state: verified signals, merge suggestions, recovery flags.

Required player metrics:

| Metric | Definition |
|---|---|
| **Engaged players** | Players with player-initiated interaction in selected period, per §4.3. |
| **Participating players** | Engaged players plus players with attendance/payment participation recorded in selected period, per §4.3. |
| **Registered players** | Persons with player membership, verified channel identity or first successful RSVP/join. |
| **RSVP-to-registration conversion** | `registered players / RSVP or join attempts` where applicable. |
| **First attendance rate** | `% registered players with at least 1 attended session`. |
| **Repeat player rate** | `% players with >=2 attended sessions in selected period/cohort`. |
| **Cross-host player rate** | `% participating players with attendance/join across >=2 tenants in a cell`. |
| **Median hosts per participating player** | Median distinct tenants per participating player. |
| **Player churn risk** | No activity for configured period after prior repeat activity. |

Required queues:

- New players waiting for approval.
- Players with pending claim/merge suggestions.
- Players with failed magic link/auth.
- Players marked no-show/late cancel and eligible for dispute window.
- High-value reliable players in a cell who have not joined recently.

### MODULE 5 — Session & Kèo Analytics

Required metrics:

| Metric | Definition |
|---|---|
| **Total sessions** | Count sessions created all time, excluding test/internal unless filter includes them. |
| **Active/open sessions** | Sessions with status `open` and `starts_at` not expired. |
| **Completed sessions** | Sessions closed after scheduled time with roster/attendance/payment state processed according to phase. |
| **Cancelled sessions** | Sessions with status `cancelled`. |
| **Public sessions** | Sessions projected to `public_sessions`. |
| **Private sessions** | Sessions not public. |
| **Average roster fill** | `joined_count / slots_max` for sessions with capacity. |
| **Session completion rate** | `completed_sessions / sessions_created`. |
| **Revenue observed by tenant ledger** | Sum of charges settled/owed for tenant sessions; not Plexco platform revenue. |

Required breakdowns:

- Sport: badminton, pickleball, tennis, football, future taxonomy.
- Area/cell: sport + area + skill + time bucket.
- Source: web, Telegram, Zalo, recurring, manual import.
- Visibility: private, fill-only (if adopted), public.
- Join policy: open, approval.
- Status: draft, open, closed, cancelled.

Required views:

- Session calendar heatmap.
- Upcoming sessions needing fill.
- Sessions with over-capacity conflict attempts.
- Sessions cancelled after players paid.
- Sessions with projection failure/sync lag.

### MODULE 6 — Marketplace & Liquidity Dashboard

Required metrics:

| Metric | Definition |
|---|---|
| **Marketplace searches** | Count `marketplace_searched`, with filters bucketed. |
| **No-result search rate** | `marketplace_no_results / marketplace_searched`. |
| **Detail open rate** | `marketplace_detail_opened / marketplace search result impressions`. |
| **Join CTA rate** | `marketplace_join_cta_clicked / marketplace_detail_opened`. |
| **Discovery join rate** | `join_succeeded(source=discovery) / marketplace_join_cta_clicked`. |
| **External slots filled/week** | Slots filled by players not previously active in that tenant. |
| **Fill success rate** | `external slots filled / external slots opened`. |
| **Requests per open slot** | Join/fill requests divided by external slots available. |
| **Acceptance rate** | Approved/succeeded requests divided by total approval-mode requests. |
| **Approval latency** | Median/p95 time from request to host decision. |
| **Time to fill** | Session publish/fill-enabled → slot filled. |

Required liquidity cell view:

| Field | Description |
|---|---|
| Sport | Taxonomy key |
| Area | Coarse area only |
| Skill band | Beginner/intermediate/advanced/custom taxonomy |
| Time bucket | Weekday evening, weekend morning, etc. |
| Active hosts | Weekly active hosts in cell |
| Sessions/week | Total created/completed |
| Open slots/week | Supply needing fill |
| Registered players | Demand pool |
| External slots filled | Marketplace value |
| Cross-host rate | Network effect |
| Decision status | Not ready / fill-only beta / public discovery ready |

### MODULE 7 — Payment Operations

Required payment metrics:

| Metric | Definition |
|---|---|
| **Bank transactions ingested** | Count durable committed `bank_transactions`. |
| **Auto-match rate** | Auto allocated terminal matches / total ingested transactions. |
| **Manual allocation rate** | Manual allocations / total allocations. |
| **Unmatched backlog** | Transactions with unallocated amount or no safe match. |
| **Unmatched aging** | p50/p95 time since ingest for unresolved unmatched. |
| **Charge settlement rate** | Paid charges / total charges due. |
| **Partial/overpay count** | Charges/transactions with partial or unallocated remainder. |
| **Reversal rate** | Reversal allocations / total allocations. |
| **Payment confirmation delivery rate** | Successful confirmations / confirmations attempted. |
| **Reminder-to-payment conversion** | Charges paid within X hours after reminder / reminder recipients. |

Required operations queues:

- Unmatched transactions by tenant/age/amount bucket.
- Transactions with remainder.
- Charges overdue by session/date/tenant.
- Reversal/correction requiring review.
- Suspended tenant with incoming player CK (ingest must continue).

Data rules:

- Do not show raw bank content in overview.
- Amounts can be bucketed in aggregate analytics; exact amounts only in privileged detail view.
- Never classify unmatched as paid or safe.
- Payment and billing ledgers remain separate.

### MODULE 8 — Billing & Revenue Dashboard

Required metrics:

| Metric | Definition |
|---|---|
| **MRR** | Sum active paid subscription monthly amounts; excludes `free`. |
| **ARR** | `MRR * 12`. |
| **Paid tenants** | Tenants on paid active plans. |
| **Free tenants** | Tenants on `free` active. |
| **Trialing tenants** | Paid plan trials only. |
| **Past due / suspended** | Paid plan lifecycle states. |
| **Trial-to-paid conversion** | Paid activations / trials started. |
| **Logo churn** | Paid tenants cancelled/suspended beyond churn threshold / starting paid tenants. |
| **ARPA** | MRR / active paid tenants. |
| **Revenue by plan** | MRR grouped by paid plan (hiện chỉ `host_pro` 250k — DD-29). |
| **Revenue by cell/sport/channel** | MRR attributed by tenant primary cell, default sport, enabled channels. |

Required billing queues:

- Invoices issued/unpaid.
- Payment matched but entitlement not updated.
- Past_due tenants nearing suspension.
- Suspended tenants with recent activity (reactivation opportunity).
- Free tenants with high usage (upgrade opportunity).

### MODULE 9 — Channels, Connectors & Sync Health

Required metrics:

| Area | Metrics |
|---|---|
| **Telegram** | linked groups, callback success/failure, roster edit failures, DM reachability |
| **Zalo** | bot connected/active/drift/error, command volume, number reply success, provider failures |
| **Web** | active sessions, SSE reconnects, onboarding step drop-off |
| **SePay/ApiPay** | connection status, webhook active, ingest success/failure, token drift |
| **Sync engine** | command volume, projector success/failure, lag p50/p95/p99, DLQ count, reproject count |
| **Notification** | reminder sent/skipped/failed, quiet-hour skips, delivery failed by provider |

Required views:

- Connector status matrix by tenant.
- Projector delivery health by surface.
- Webhook ingest trend and error classes.
- SLO breach timeline.
- Reproject action panel for privileged operators.

### MODULE 10 — Trust, Reputation & Safety

Required metrics:

| Metric | Definition |
|---|---|
| **Attendance close rate** | Sessions with attendance finalized / sessions needing attendance. |
| **First attendance rate** | Players with attended event / registered players in cohort. |
| **No-show rate** | No-show events / RSVP or joined attendance-eligible events. |
| **Late cancel rate** | Late cancel events / joined attendance-eligible events. |
| **Dispute rate** | Attendance disputes / negative attendance events. |
| **Dispute overturn rate** | Overturned disputes / total disputes resolved. |
| **Reliable player share** | Players in reliable band / players with enough history. |
| **Accepted New with bridge** | Accepted New players with host-vouch/deposit/manual approval / accepted New players. |
| **Host abuse signal** | Hosts with unusual overturned dispute/no-show pattern. |

Required safety queues:

- Pending disputes.
- Hosts with high dispute overturn.
- Players in Watch/Restricted band requesting joins.
- New players without trust bridge.
- Suspicious repeated join/reject/no-show patterns.

UI rule:

- Internal dashboard may compute numeric score, but user-facing language should use bands: `New`, `Reliable`, `Watch`, `Restricted`.

### MODULE 11 — Security & Compliance Operations

Required security widgets:

- Cross-tenant invariant status.
- Public projection whitelist invariant status.
- PII/log redaction invariant status.
- Secret rotation status.
- RLS failures or suspicious denied access.
- Incident log by severity/status.
- Backup/PITR restore drill status.
- Pen-test/load-test results.
- Rate-limit abuse and scrape attempts.

Required hard targets:

- Cross-tenant money/roster leak = 0.
- Public PII/payment leak = 0.
- Over-allocation = 0.
- Runtime role with `BYPASSRLS` = 0.

### MODULE 12 — CRM Actions, Notes & Segments

Required actions:

- Add/edit internal note on tenant/person/session/incident.
- Assign owner and next follow-up date.
- Tag tenant/player segments.
- Mark outreach status: not contacted, contacted, onboarding scheduled, blocked, won, lost.
- Export segment safely with redaction.
- Open linked detail views: tenant, person, session, transaction, invoice, incident.

Recommended default segments:

- **Host activation:** signed up, no first session in 24h.
- **Host retention:** first session done, no second session in 7d.
- **High-potential host:** >=2 sessions/week and unpaid/free.
- **Upgrade candidate:** `free` with active usage needing auto-reconcile / auto-reminders / AI (host_pro features — DD-29).
- **At-risk host:** active before, no session in 14d or connector broken.
- **Liquidity champion:** host with repeated sessions and good attendance close rate.
- **Reliable player:** high attendance, no recent negative events.
- **Cross-host player:** active in >=2 tenants/cell.
- **Payment-risk tenant:** high unmatched/reversal rate.

---

## 8. Metric Dictionary (MVP)

### 8.1 Core counters

| Metric | Formula / Event basis | Primary filters |
|---|---|---|
| Total users | `count(distinct persons.id)` | role, source, created_at |
| Total signups | `count(identity_person_created)` or account creation by selected type | source, role, channel |
| Total hosts | `count(distinct memberships.person_id where role in owner/admin)` | tenant status, plan |
| Total players | `count(distinct memberships.person_id where role in player/guest/member)` | sport, cell |
| Active users | distinct persons matching §4.3 role-aware engagement definition | DAU/WAU/MAU, role |
| Total sessions | `count(sessions)` | sport, tenant, visibility |
| Active sessions | `sessions.status='open' and starts_at >= now()` | sport, area, join_policy |
| Completed sessions | `sessions.status='closed' and completion criteria met` | sport, cell |
| Total joins | `count(join_succeeded + direct roster join)` | source, channel |
| Total attendances | `count(attendance where status='attended')` | sport, host, cell |
| Total payments observed | sum settled charge/allocation amounts | tenant, sport, amount bucket |
| MRR | sum active paid subscription plan amount | plan, cohort |

### 8.2 Conversion funnels

| Funnel | Steps |
|---|---|
| Host onboarding | `onboarding_started → tenant_created → connector_verified(bank) → tenant_chat_linked → first_session_created → first_session_published → onboarding_completed` |
| Host activation | `tenant_created → first_session_created → second_session_created → weekly_active_host → paid_plan_active` |
| Player discovery | `marketplace_searched → marketplace_detail_opened → marketplace_join_cta_clicked → join_attempted → join_succeeded/approved → attendance_attended` |
| Player chat join | `bot command/callback → session list/callback result → join_succeeded → charge_created → payment_charge_settled` |
| Payment settlement | `payment_webhook_ingested → payment_reconcile_completed → payment_allocation_created → payment_charge_settled → payment_confirmation_sent` |
| Billing | `billing_invoice_issued → billing_invoice_paid → billing_lifecycle_transition(active) → renewal/churn` |

### 8.3 Retention/cohort metrics

| Metric | Cohort definition |
|---|---|
| Host W1/W4 retention | Tenants by first session week |
| Player D7/D30 retention | Persons by first join or first attendance date |
| Repeat through Plexco rate | Players/hosts repeating tracked actions through Plexco instead of disappearing after first contact |
| Cross-host adoption | Players by first host, then joined/attended second host within X days |
| Payment habit retention | Player paid settled without manual host intervention across repeated sessions |

---

## 9. Data Sources & Event Requirements

### 9.1 Existing feature event sources

Dashboard should consume the analytics events already specified in feature docs:

- Onboarding: `onboarding_started`, `tenant_created`, `integration_connected`, `first_session_created`, `first_session_published`, `onboarding_completed`.
- Session: `session_created`, `session_updated`, `session_announced`, `session_closed`, `session_cancelled`.
- Marketplace: `marketplace_searched`, `marketplace_detail_opened`, `marketplace_join_cta_clicked`, `marketplace_no_results`, `marketplace_projection_lag`.
- Join: `join_attempted`, `join_succeeded`, `join_rejected`, `join_full_conflict`, `approval_latency`, `join_leave`.
- Payment: `payment_webhook_ingested`, `payment_reconcile_completed`, `payment_allocation_created`, `payment_allocation_reversed`, `payment_charge_settled`.
- Notification: `reminder_sent`, `reminder_skipped`, `payment_confirmation_sent`, `delivery_failed`.
- Identity: `identity_person_created`, `identity_link_requested`, `identity_link_verified`, `identity_merge_completed`, `identity_claim_rejected`.
- Sync: `sync_command_received`, `sync_projected`, `sync_projection_failed`, `sync_slo_breach`.
- Billing: `billing_lifecycle_transition`, `billing_invoice_issued`, `billing_invoice_paid`, `billing_churn`.
- Security/Ops: `security_incident_opened`, `security_secret_rotated`, `security_restore_drill`, `security_pen_test_completed`.

### 9.2 Additional dashboard events / derived tables

| Need | Proposed event/table |
|---|---|
| Attendance/no-show dashboard | `attendance_marked`, `attendance_disputed`, `attendance_dispute_resolved` |
| Fill-slot beta | `fill_prompt_shown`, `fill_enabled`, `fill_request_received`, `fill_slot_filled`, `fill_expired` |
| Reminder engagement | `reminder_response` |
| CRM notes/follow-up | `crm_note_created`, `crm_followup_scheduled`, `crm_status_changed` |
| Cohort snapshots | Daily aggregate table `metric_daily_snapshots` |
| Liquidity cells | Materialized table `liquidity_cell_daily` |
| Host risk | Derived table `tenant_health_scores` |
| Player trust | Derived table `player_trust_snapshots` |

### 9.3 Data freshness

| Data type | Freshness target |
|---|---|
| Critical ops alerts | Near realtime, <= 1 minute |
| Sync/webhook/connector health | Near realtime, <= 1 minute |
| Session/join/payment operational counts | <= 5 minutes |
| Daily business KPIs | Hourly during day, final daily snapshot after local day close |
| Cohorts/LTV/CAC | Daily batch |

### 9.4 Timezone & calendar rules

| Scope | Rule |
|---|---|
| **Platform-wide executive metrics** | Default timezone: `Asia/Ho_Chi_Minh`. Daily windows close at local midnight in this timezone. |
| **Tenant detail metrics** | Default to tenant configured timezone; if missing, fallback `Asia/Ho_Chi_Minh`. |
| **Session facts** | Use canonical `starts_at`/`ends_at` as UTC timestamptz and session IANA timezone for display/grouping by local session day. |
| **Cross-tenant/cross-cell comparisons** | Use platform timezone unless user explicitly switches view mode; selected timezone must be shown in the UI/export. |
| **Week/month buckets** | Week starts Monday; month follows calendar month in the selected timezone. |
| **Exports/reports** | Include `timezone`, `window_start`, `window_end`, and bucket rule metadata. |

BR-CRM-3 requires every metric to show its date window and dedupe key; this section is the default calendar authority for dashboard metrics.

---

## 10. Screens & Information Architecture

| Route / View | Purpose |
|---|---|
| `/internal` | Executive overview |
| `/internal/growth` | Acquisition, signup, activation, active users, retention |
| `/internal/tenants` | Host/tenant CRM list + detail |
| `/internal/players` | Player CRM list + detail |
| `/internal/sessions` | Sessions, calendar, active/completed/cancelled, risky sessions |
| `/internal/marketplace` | Discovery, fill-slot, liquidity cells |
| `/internal/payments` | Payment ops, unmatched, settlement health |
| `/internal/billing` | Subscription/MRR/invoices/churn |
| `/internal/channels` | Telegram/Zalo/web/connectors health |
| `/internal/trust` | Attendance, no-show, disputes, reliability bands |
| `/internal/security` | Incidents, invariants, SLOs, secret/backup status |
| `/internal/alerts` | Unified alert queue |
| `/internal/reports` | Export and scheduled report definitions |

Detail pages:

- Tenant detail: overview, sessions, players, payment health, billing, connectors, CRM notes, audit.
- Person detail: identities, memberships, activity, trust, merge history, support notes.
- Session detail: roster summary, join source mix, payments, attendance, projection status.
- Transaction detail: redacted bank transaction, allocations, audit, correction/reversal.
- Incident detail: severity, owner, timeline, linked metrics.

---

## 11. Access Control, Privacy & Audit

### 11.1 Roles

| Role | Permissions |
|---|---|
| **Platform Owner** | Full internal read; privileged actions with audit |
| **Growth/CS** | Read CRM/business metrics; notes/follow-ups; no exact bank/secret/PII detail |
| **Ops Support** | Payment/identity support views; manual actions only with scoped permission and audit |
| **Finance** | Billing and aggregate tenant revenue; no player PII beyond needed tenant contact |
| **Security Admin** | Security/ops/invariant/incident views; secret metadata only, never secret values |
| **Read-only Analyst** | Aggregates and redacted exports only |

### 11.2 Redaction rules

Default hidden or redacted:

- Raw bank content, account numbers, provider payloads.
- Bot tokens, webhook secrets, OAuth tokens.
- Raw Telegram/Zalo IDs, chat IDs.
- Phone/email unless support role opens detail with reason.
- Full venue address for public sessions unless tenant-private support context requires it.
- Roster names in aggregate marketplace views.

### 11.3 Audit requirements

Audit is required for:

- Opening privileged PII/payment detail.
- Manual payment allocation/reversal/cash/waiver.
- Identity merge/claim/recovery.
- Subscription override/reactivation/suspension.
- Connector revoke/reset/re-register.
- Incident status changes.
- Export of non-aggregate data.

---

## 12. Alerts & Thresholds

| Alert | Default threshold | Severity |
|---|---:|---|
| Cross-tenant invariant failed | any | Critical |
| Public projection includes banned field | any | Critical |
| Payment over-allocation attempt | any | Critical |
| Sync-lag p95 > 3s for 15m | threshold breach | High |
| Sync-lag p99 > 10s for 15m | threshold breach | High |
| Webhook ingest failure spike | >5% in 15m | High |
| Connector drift | any active tenant | Medium/High by tenant size |
| Unmatched backlog aging | p95 > 48h | Medium |
| Payment auto-match drops | -20% vs 7d baseline | Medium |
| No-result marketplace searches | >50% in active cell | Medium |
| Host activation stalled | no first session in 24h | Medium |
| Approval latency high | p95 > 24h | Medium |
| Dispute rate high | >5% attendance events | Medium |
| Billing past_due approaching suspension | configurable | Medium |

---

## 13. Reporting Requirements

### 13.1 Default reports

| Report | Cadence | Recipients |
|---|---|---|
| Daily ops pulse | Daily | Founder/Ops |
| Weekly growth & liquidity | Weekly | Founder/Growth |
| Weekly payment health | Weekly | Founder/Ops/Finance |
| Weekly trust & safety | Weekly | Founder/Security |
| Monthly revenue & churn | Monthly | Founder/Finance |

### 13.2 Weekly growth report must include

- New signups: hosts, players.
- Active users: DAU/WAU/MAU and role split, plus participating-player trend.
- Total sessions created/completed/cancelled.
- Active hosts and sessions/host/week.
- Published sessions and external slots filled.
- Discovery funnel conversion.
- Cross-host player rate by cell.
- Host activation and retention.
- MRR, paid conversion, churn.
- Top 5 risks/blockers.

---

## 14. Non-Functional Requirements

| ID | Requirement |
|---|---|
| **NFR-CRM-S1** | Internal dashboard must respect strict role-based access and redaction. |
| **NFR-CRM-S2** | Aggregates must be reproducible from canonical events/tables; dashboard must not invent state. |
| **NFR-CRM-S3** | Metric definitions must be versioned; definition changes must be recorded in changelog. |
| **NFR-CRM-S4** | Dashboard must load executive overview under 2s for cached daily/hourly aggregates. |
| **NFR-CRM-S5** | Operational queues must support search/filter/sort and pagination for >1,000 tenants. |
| **NFR-CRM-S6** | Exports must be rate-limited, audited and redacted by default. |
| **NFR-CRM-S7** | No analytics event may contain secrets, raw PII, raw bank content or provider payload. |
| **NFR-CRM-S8** | Dashboard outages must not block core product flows, webhook ingest or sync dispatch. |
| **NFR-CRM-S9** | Alerts must be deduped, ownable and resolvable with status history. |

---

## 15. MVP Phasing

### Phase CRM-0 — Metric foundations

- Define metric dictionary and qualifying activity rules.
- Create daily/hourly aggregate snapshots.
- Instrument missing attendance/fill/CRM events.
- Build redaction/access policy.

### Phase CRM-1 — Founder overview + host CRM

- Executive overview.
- Tenant list/detail.
- Host onboarding and activation queues.
- Total users, active users, signups, total sessions, active sessions, completed sessions.

### Phase CRM-2 — Marketplace, player and liquidity

- Player lifecycle dashboard.
- Marketplace funnel.
- Liquidity cell view.
- Fill-slot metrics and cross-host player rate.

### Phase CRM-3 — Money, billing and ops health

- Payment ops dashboard.
- Billing/MRR dashboard.
- Connector/sync/webhook health.
- Alert center.

### Phase CRM-4 — Trust, safety and reporting

- Attendance/no-show/dispute dashboard.
- Security/invariant dashboard.
- Scheduled reports.
- Advanced segments and cohort retention.

---

## 16. Acceptance Criteria

- [ ] Dashboard shows total users, total hosts, total players, total signups, total sessions, active sessions and active users for selectable date windows.
- [ ] Active user definitions are role-aware and documented.
- [ ] Host onboarding funnel and player discovery funnel are visible with conversion rates.
- [ ] Marketplace metrics distinguish discovery/cross-club joins from normal member joins.
- [ ] Liquidity cell dashboard shows supply, demand, open slots, external slots filled and cross-host rate.
- [ ] Payment dashboard separates tenant player ledger from Plexco subscription revenue.
- [ ] Unmatched payments and unresolved payment remainders are visible as queues, not hidden inside aggregate success.
- [ ] Billing dashboard shows MRR, paid tenants, free tenants, trial/past_due/suspended, churn and plan mix.
- [ ] Sync/webhook/connector SLO breaches are visible and alertable.
- [ ] Trust dashboard shows attendance close rate, no-show, late cancel, dispute and reliability bands.
- [ ] Security dashboard shows invariant failures and critical leak targets with target = 0.
- [ ] Privileged detail views redact by default and audit access.
- [ ] CSV/export is redacted by default and role-scoped.
- [ ] Metric dictionary is linked from every metric tooltip/detail.

---

## 17. Assumptions, Dependencies & Risks

### 17.1 Assumptions

- Canonical store là PostgreSQL/domain model; mọi aggregate phải tái tạo được từ canonical events/tables (NFR-CRM-S2), dashboard không tự sinh state.
- Sync engine (command → projector) đã hoạt động và phát event lifecycle như §9.1 mô tả.
- Giai đoạn beta onboard thủ công từng cell; quy mô thực tế ≪ ngưỡng `>1,000 tenants` ở NFR-CRM-S5 (ngưỡng đó là target chịu tải tương lai, không phải quy mô hiện tại).
- Có sẵn nhân sự ops/founder tiêu thụ dashboard; dashboard không thay người ra quyết định.

### 17.2 Dependencies (chặn phase sau)

| Dependency | Trạng thái | Chặn |
|---|---|---|
| **Event instrumentation còn thiếu** — attendance, fill-slot, CRM notes (§9.2) chưa tồn tại | Chưa có | Module 4/6/10/12; là khối việc lớn của Phase CRM-0, **rủi ro chính của cả dự án** |
| Billing lifecycle events (`billing_*`) phát đầy đủ | Cần xác nhận | Module 8, MRR/churn |
| Sync SLO events (`sync_slo_breach`, lag) | Cần xác nhận | Module 9, alert §12 |
| Identity/merge events | Một phần | Module 4 trust/merge |
| Timezone/calendar rule cho "local day close" | Đã chốt ở §9.4 | Mọi daily KPI/cohort |

### 17.3 Risk register

| ID | Risk | Khả năng | Tác động | Mitigation |
|---|---|---|---|---|
| **RISK-1** | Instrumentation gap (§9.2) lớn hơn dự tính → Phase CRM-0 trượt kéo theo tất cả | Cao | Cao | Tách Phase CRM-0 thành deliverable riêng có owner; chốt event contract trước khi build UI; ưu tiên attendance/fill vì là trust moat |
| **RISK-2** | Định nghĩa metric trôi giữa các module (vd "active", "completed session", "churn billing vs product") | Trung bình | Cao | Metric dictionary §8 là nguồn duy nhất; versioned + changelog (NFR-CRM-S3); tooltip dẫn tới dictionary (SM-5) |
| **RISK-3** | Rò rỉ PII/payment qua analytics/export | Thấp | Rất cao | Redaction mặc định (BR-CRM-10/13), audit (BR-CRM-14), invariant target=0 (Module 11), NFR-CRM-S7 |
| **RISK-4** | Dashboard load/aggregate đè tải lên store sản phẩm | Trung bình | Cao | Snapshot/materialized tables (§9.2), freshness phân tầng (§9.3), NFR-CRM-S8 cách ly khỏi core flow |
| **RISK-5** | Scope creep sang BI/self-serve SQL | Trung bình | Trung bình | Out-of-scope §5.2 nêu rõ; export CSV redacted thay cho self-serve |
| **RISK-6** | Beta data quá thưa → metric/cohort nhiễu, quyết định sai | Cao | Trung bình | Hiển thị n nhỏ kèm cảnh báo "low sample"; ưu tiên queue hành động hơn tỉ lệ % khi n nhỏ |

---

## 18. Open Questions

| ID | Question | Proposed default |
|---|---|---|
| CRM-OQ-1 | ~~Active user qualifying event list cuối cùng gồm những event nào?~~ | **Resolved** — chốt theo role tại §4.3. Mở rộng được, thu hẹp phải qua changelog. |
| CRM-OQ-2 | Liquidity cell taxonomy khóa theo quận/phường hay custom area? | Bắt đầu bằng `sport + coarse area + skill + time bucket`. |
| CRM-OQ-3 | Fill-only visibility có trở thành trạng thái sản phẩm chính thức không? | Theo GTM, nên thêm `fill_only` trước khi public rộng. |
| CRM-OQ-4 | Host/player LTV/CAC cần nguồn marketing spend nào? | Pha đầu cho phép nhập tay spend theo channel/cell. |
| CRM-OQ-5 | Attendance/no-show đã nằm trong MVP core hay beta extension? | Nên instrument sớm vì là trust moat, có thể không chặn P0-P3. |
| CRM-OQ-6 | Export ra CSV hay tích hợp Linear/CRM ngoài? | CSV redacted trước; tool ngoài post-MVP. |

---

## 19. Changelog

| Date | Version | Change |
|---|---|---|
| 2026-06-21 | v1.0 | Initial CRM & Operations Dashboard BRD based on Plexco BRD/PRD/feature specs/GTM and Mixpanel ecommerce metric framework. |
| 2026-06-21 | v1.1 | Chốt định nghĩa Active user theo role (§4.3, resolve CRM-OQ-1); thêm project success metrics có target (§4.4); thêm section Assumptions/Dependencies/Risks (§17). |
| 2026-06-21 | v1.2 | Fix timezone/calendar reference bằng §9.4; tách `Engaged player` và `Participating player`; đồng bộ Active users ở Module 2/metric dictionary; thêm `reminder_response` event. |
