> **📌 Ported from Sporta** (2026-08-10) — Adapt placeholders cho Plexco context trước khi sử dụng.

# {PROJECT_NAME} — Quy Trình Phát Triển Sản Phẩm

> Template quy trình end-to-end từ Idea đến vận hành.
> Copy file này vào `docs/product-workflow.md` của project mới, thay `{placeholders}` bằng thông tin cụ thể.

**Phiên bản:** 1.0
**Cập nhật:** {DATE}
**Áp dụng cho:** {PROJECT_NAME} — {PLATFORM: web / mobile / desktop / cross-platform}

---

## Tổng quan 10 giai đoạn

```
 ① IDEA → ② RESEARCH → ③ DESIGN → ④ PROTOTYPE → ⑤ SPEC
    → ⑥ BACKEND → ⑦ FRONTEND → ⑧ QA → ⑨ RELEASE → ⑩ OPERATE
```

| # | Giai đoạn | Output chính | Ai làm | Thời gian ước tính |
|---|-----------|-------------|--------|---------------------|
| 1 | Ideation | Brainstorm doc | PM, Founder | 1–2 ngày |
| 2 | Research & Validate | BRD (Business Requirements) | PM | 3–5 ngày |
| 3 | UI/UX Design | Design files, Design Tokens | Designer | 5–10 ngày |
| 4 | Prototype | Interactive prototype | FE Dev | 3–5 ngày |
| 5 | Feature Spec | Product spec + Tech spec per feature | PM + Tech Lead | 2–3 ngày/feature |
| 6 | Backend Dev | API + Database + Services | BE Dev | Theo sprint |
| 7 | Frontend Dev | Client app code | FE Dev | Theo sprint |
| 8 | QA & Testing | Test reports | QA | Song song với 6–7 |
| 9 | Release | Production deployment | DevOps + PM | 3–7 ngày |
| 10 | Operate & Iterate | Monitoring + user feedback | Team | Liên tục |

---

## ① Ideation — Từ ý tưởng thô đến hướng đi rõ ràng

### Input

- Ý tưởng ban đầu (vấn đề cần giải quyết)
- Quan sát thị trường, pain points người dùng

### Quy trình

1. **Brainstorm** — viết ra mọi ý tưởng, không filter.
2. **Problem Statement** — giải quyết vấn đề gì? Cho ai? Tại sao họ quan tâm?
3. **Competitor Analysis** — phân tích 3–5 đối thủ trực tiếp.
4. **Unique Value Proposition** — sản phẩm khác gì so với đối thủ?
5. **Vision & Scope** — MVP gồm gì? v1.0 scope bao nhiêu?

### Output

- `brainstorm.md` — ý tưởng thô + đánh giá
- **Quyết định Go/No-Go** trước khi sang giai đoạn tiếp theo

---

## ② Research & Validate — BRD + Xác nhận khả thi

### Input

- Brainstorm doc đã chốt hướng

### Quy trình

1. **User Research** — phỏng vấn 5–10 target users, survey, observe hành vi.
2. **Market Sizing** — TAM/SAM/SOM.
3. **Technical Feasibility** — check APIs, services, infrastructure cần dùng.
4. **Business Model** — pricing, revenue streams, unit economics.
5. **Viết BRD** — tổng hợp tất cả thành Business Requirements Document.

### Output

- `brd-final.md` — BRD hoàn chỉnh:
  - Modules / feature groups
  - User personas & journeys
  - Revenue model
  - KPIs thành công
  - Roadmap pha theo quarters

### Checklist ✅

- [ ] Problem validated với real users
- [ ] Ít nhất 1 unique differentiator vs competitors
- [ ] Business model khả thi
- [ ] Technical blockers identified

---

## ③ UI/UX Design — Từ wireframe đến high-fidelity

### Input

- BRD đã approved
- Brand guidelines (nếu có)

### Quy trình

1. **Information Architecture** — sitemap, user flows cho từng module.
2. **Wireframes** — low-fi sketches cho mỗi screen.
3. **Design System Setup** — design tool ({DESIGN_TOOL: Figma / Pencil / Sketch}):
   - Colors (primary, accent, semantic)
   - Typography (headings, body, captions)
   - Spacing scale
   - Border radius, shadows, motion
   - Icon library
   - Core components (Button, Card, Input, Dialog, Toast...)
4. **High-Fidelity Screens** — cho từng feature:
   - {PLATFORM}-first ({VIEWPORT_WIDTH}px width)
   - Cover 4 states: loading, ready, empty, error
   - Dark mode variant (nếu support)
5. **Design Review** — team review, iterate.

### Output

- Design system file — reusable components
- Feature design files — high-fi screens
- `front-end/design-tokens.md` — tokens extracted (ref: `templates/design-tokens.md`)

### Checklist ✅

- [ ] Design tokens defined
- [ ] Mỗi screen có đủ 4 states
- [ ] Touch targets ≥ 48px (mobile) / clickable areas rõ ràng (web)
- [ ] Responsive tested trên target viewports
- [ ] Icon names documented (library + name)
- [ ] Dark mode variant (nếu support)

---

## ④ Prototype — Validate nhanh

### Input

- Design files finalized
- Design tokens

### Quy trình

1. **Setup prototype project** — {PROTO_TOOL: Vite / Next.js / Expo / Flutter prototype}.
2. **Extract tokens** — design file → CSS variables / theme constants.
3. **Code screens** — từng screen theo design specs.
4. **Deploy preview** — share link cho team + stakeholders test.
5. **Collect feedback** — ghi thay đổi → update design → update prototype.

### Output

- Working prototype
- Design handoff docs per screen (nếu cần)

### Khi nào skip prototype?

- Screen đơn giản (settings, about) → code thẳng production.
- Đã có feedback đủ từ design review → skip.

### Checklist ✅

- [ ] Prototype deploy được, team truy cập test
- [ ] Pixel-perfect vs design file
- [ ] Stakeholder feedback collected & incorporated
- [ ] Design changes synced lại design file

---

## ⑤ Feature Spec — Spec chi tiết trước khi code

### Input

- BRD (high-level requirements)
- Design files (đã finalize)

### Quy trình — Cho MỖI feature

1. **`feature_{name}.md`** — Product spec:
   - Mô tả feature
   - Use cases (happy path + edge cases)
   - Screens (tên, components, states)
   - Domain model (entities, relationships)
   - API endpoints (URL, method)
   - State machine (state transitions)
   - Caching strategy
   - Error cases (code, message, UX handling)
   - Analytics events (naming convention: `{feature}_{action}_{result}`)
   - Acceptance criteria (checklist)

2. **`feature_{name}_tech.md`** — Technical spec:
   - Database schema changes (tables, indexes, constraints)
   - API contract (request/response JSON examples)
   - Backend implementation (module structure, key logic)
   - Frontend implementation (feature folder structure)
   - Event definitions (event name, payload, listeners)
   - Security considerations
   - Caching strategy (key patterns, TTL, invalidation)
   - Testing plan (unit, integration, e2e)
   - Migration & rollback plan

3. **API Contract Review** — FE + BE cùng review format trước khi code.

### Output

- `docs/feature_{name}.md`
- `docs/feature_{name}_tech.md`
- API contract đã được FE + BE agree

### Thứ tự viết feature spec

> Lập dependency graph từ `templates/feature-dev/feature-dependency-graph.md`.
> Dev theo đúng thứ tự dependency — feature gốc trước, feature phụ thuộc sau.

### Checklist ✅

- [ ] Product spec cover đủ use cases + error cases
- [ ] Tech spec có DB schema + API contract
- [ ] FE + BE agree trên API format
- [ ] Migration có rollback strategy
- [ ] Acceptance criteria rõ ràng, testable

---

## ⑥ Backend Development

### Tech stack: {BE_STACK: e.g. NestJS + PostgreSQL / Django + MySQL / Go + MongoDB / ...}

### Setup ban đầu (1 lần)

> Ghi lại setup commands cụ thể cho project tại đây.

```bash
# Init project
# Install dependencies
# Setup database
# Setup Docker (nếu cần)
```

### Quy trình phát triển theo feature

```
1. Database schema → migration → seed data
2. Data access layer (repository / DAO / ORM)
3. Business logic layer (service / usecase)
4. API layer (controller / handler / route)
5. DTOs + input validation
6. Auth / authorization (guards / middleware)
7. Side-effects (events, queues, notifications)
8. API documentation (Swagger / OpenAPI)
9. Unit tests + Integration tests
10. PR → Code review → Merge
```

### API Development Flow

```
feature_*_tech.md (API contract)
    ↓
Database Schema → Migration
    ↓
Repository → Service → Controller
    ↓
API docs ({API_DOCS_URL})
    ↓
Unit test → Integration test
    ↓
PR → Code review → Merge
```

### Sprint Workflow

- **Sprint length:** {SPRINT_LENGTH: 1–2 tuần}
- **Mỗi sprint:** 2–3 features
- **Daily:** standup 15 phút
- **End of sprint:** demo + retrospective

### Checklist mỗi feature ✅

- [ ] Schema + migration created
- [ ] API endpoints match tech spec
- [ ] API docs complete
- [ ] Error responses luôn JSON: `{ error, message, code }`
- [ ] Side-effects qua events / message queue
- [ ] Idempotent cho critical operations (payment, etc.)
- [ ] Unit tests pass
- [ ] Integration tests pass
- [ ] PR checklist

---

## ⑦ Frontend Development

### Tech stack: {FE_STACK: e.g. Flutter / React Native / Next.js / Vue / SwiftUI / ...}

### Setup ban đầu (1 lần)

> Ghi lại setup commands cụ thể cho project tại đây.

```bash
# Init project
# Install dependencies
# Setup folder structure
# Run code generation (nếu cần)
```

### Quy trình phát triển theo feature

```
1. Design tokens / theme update (nếu có design mới)
2. Feature folder / module structure
3. Domain: Models / Entities
4. Data: API client, DTOs, mappers
5. Presentation: Screens, components, state management
6. Navigation / routing
7. Handle 4 states: loading / ready / empty / error
8. Tests (unit, component, e2e)
9. PR → Code review → Merge
```

### Screen Development Flow

```
Design file
    ↓
Extract specs (handoff doc nếu cần)
    ↓
Theme / token classes
    ↓
Core components → Feature screens
    ↓
Handle 4 states: loading / ready / empty / error
    ↓
Visual QA → fix → loop
```

### FE + BE Integration

```
1. BE deploy API lên staging
2. FE update API base URL
3. FE implement data pipeline (API → DTO → Model → UI)
4. FE test với real API (staging)
5. Fix mismatches → update API contract nếu cần
6. Repeat per feature
```

### Checklist mỗi feature ✅

- [ ] Feature folder đúng structure
- [ ] Không hardcode style — dùng tokens / theme
- [ ] Không gọi API trực tiếp trong UI — qua service / usecase layer
- [ ] Data pipeline hoạt động (API → DTO → Model → UI)
- [ ] 4 states: loading, ready, empty, error
- [ ] Skeleton loading match layout thật
- [ ] Error state có Retry button
- [ ] Touch targets ≥ 48px (mobile)
- [ ] Tests pass
- [ ] PR checklist

---

## ⑧ QA & Testing — Đảm bảo chất lượng

### Testing Pyramid

```
                    ┌─────────────┐
                    │   Manual    │ ← Ít nhất, đắt nhất
                    │     QA      │
                 ┌──┴─────────────┴──┐
                 │   Integration     │
                 │     Tests         │
              ┌──┴───────────────────┴──┐
              │      Unit Tests         │ ← Nhiều nhất, rẻ nhất
              └─────────────────────────┘
```

### Backend Tests

| Level | Tool | Focus |
|-------|------|-------|
| Unit | {UNIT_TEST_TOOL} | Service logic, business rules |
| Integration | {INTEGRATION_TEST_TOOL} | API endpoints, database |
| Load | {LOAD_TEST_TOOL: k6 / Artillery / JMeter} | Performance under load |

### Frontend Tests

| Level | Tool | Focus |
|-------|------|-------|
| Unit | {FE_UNIT_TOOL} | Logic, mappers, utils |
| Component | {FE_COMPONENT_TOOL} | UI rendering, states |
| Visual | {FE_VISUAL_TOOL: optional} | Pixel-perfect vs design |
| E2E | {FE_E2E_TOOL} | Full user flows |

### Manual QA Checklist

- [ ] Happy path flows (core features)
- [ ] Edge cases (input rỗng, tên dài, ký tự đặc biệt, Unicode)
- [ ] Offline behavior (mất mạng giữa chừng)
- [ ] Error states (server down, 500, timeout)
- [ ] Empty states (user mới, chưa có data)
- [ ] Loading states (skeleton hiển thị đúng)
- [ ] Responsive (target devices / breakpoints)
- [ ] Dark mode (nếu support)
- [ ] Accessibility cơ bản (screen reader, contrast)
- [ ] Performance (scroll mượt, launch time)
- [ ] Deep links (nếu có)
- [ ] Push notification (nếu có)
- [ ] Payment flow (nếu có)

### Regression Test

- Mỗi khi merge feature mới → chạy lại full test suite.
- CI tự động chạy unit + integration trên mỗi PR.

---

## ⑨ Release — Đưa sản phẩm lên production

### Pre-Release Checklist

#### Code

- [ ] Tất cả tests pass
- [ ] No critical/high bugs
- [ ] Performance benchmarks met
- [ ] Security audit pass

#### Assets & Listing (Mobile App)

> Bỏ section này nếu là web app.

- [ ] App icon (1024×1024, no alpha)
- [ ] Screenshots cho target devices
- [ ] App description (ngôn ngữ chính + phụ)
- [ ] Keywords / tags
- [ ] Privacy Policy URL
- [ ] Terms of Service URL
- [ ] Support URL / email

#### iOS (App Store Connect)

> Bỏ nếu không release iOS.

```bash
# Build release
{IOS_BUILD_COMMAND}

# Upload
{IOS_UPLOAD_COMMAND}
```

- [ ] Bundle ID configured
- [ ] Signing certificate + provisioning profile
- [ ] App Review Information (demo account)
- [ ] Submit for Review → chờ 1–3 ngày

#### Android (Google Play Console)

> Bỏ nếu không release Android.

```bash
# Build release
{ANDROID_BUILD_COMMAND}

# Upload
{ANDROID_UPLOAD_COMMAND}
```

- [ ] Package name configured
- [ ] Signing key setup
- [ ] Content Rating questionnaire
- [ ] Data Safety section
- [ ] Internal → Closed → Open → Production

#### Web Deployment

> Bỏ nếu không phải web app.

```bash
# Build
{WEB_BUILD_COMMAND}

# Deploy
{WEB_DEPLOY_COMMAND}
```

- [ ] Domain + SSL configured
- [ ] CDN configured
- [ ] SEO meta tags
- [ ] Analytics tracking code

### Release Strategy

```
v0.1.0 — Internal Testing (team only)
v0.5.0 — Closed Beta (50–100 real users)
v0.9.0 — Open Beta (public, ghi rõ "beta")
v1.0.0 — Production Release 🚀
```

### Versioning

```
vMAJOR.MINOR.PATCH

MAJOR: Breaking changes, redesign lớn
MINOR: Feature mới
PATCH: Bug fix, polish

Build number: auto-increment (CI)
```

---

## ⑩ Operate & Iterate — Vận hành + cải tiến liên tục

### Monitoring

| Tool | Mục đích |
|------|----------|
| {CRASH_TOOL: Sentry / Crashlytics / Bugsnag} | Crash reports, error tracking |
| {ANALYTICS_TOOL: Mixpanel / Amplitude / GA} | User behavior, funnel analysis |
| {INFRA_TOOL: Grafana / Datadog / CloudWatch} | Server metrics, API latency |
| {UPTIME_TOOL: UptimeRobot / Pingdom} | API uptime monitoring |

### Key Metrics (Điều chỉnh theo product)

| Metric | Target v1.0 | Đo bằng |
|--------|-------------|---------|
| **DAU** (Daily Active Users) | {TARGET} | Analytics |
| **D7 Retention** | ≥ {TARGET}% | Analytics |
| **Core Action / week** | {TARGET}+ | Database |
| **Conversion Rate** | ≥ {TARGET}% | Analytics |
| **App Crash Rate** | < 0.5% | Crash tool |
| **API P99 Latency** | < 500ms | Infra tool |
| **Store Rating** | ≥ 4.5 ⭐ | Store |

### Feedback Loop

```
User Feedback (reviews, support, in-app)
    ↓
Triage → Prioritize (impact × effort)
    ↓
Add to backlog → Spec → Sprint
    ↓
Build → Test → Release
    ↓
Measure impact → Next iteration
```

### Hotfix Process

```
1. Bug report / monitoring alert
2. Assess severity (P0 / P1 / P2)
3. P0 (critical): Fix within 4h → release immediately
4. P1 (high): Fix within 24h → release ASAP
5. P2 (medium): Add to next sprint
```

### Update Cadence

- **Hotfix:** bất kỳ lúc nào (P0/P1)
- **Minor release:** mỗi {SPRINT_LENGTH} (end of sprint)
- **Major release:** mỗi quarter (feature lớn, redesign)

---

## Phụ lục A — Cấu trúc Docs Repository

```
docs/
├── brainstorm.md                    # ① Ý tưởng ban đầu
├── brd-final.md                     # ② Business Requirements
├── product-workflow.md              # Tài liệu này
├── feature_{name}.md                # ⑤ Product spec per feature
├── feature_{name}_tech.md           # ⑤ Technical spec per feature
└── PR_TEMPLATE.md                   # PR checklist

templates/
├── design-tokens.md                 # Design tokens template
├── feature-dev/
│   ├── feature-checklist.md         # Checklist per feature
│   └── feature-dependency-graph.md  # Dependency graph template

front-end/
├── design-tokens.md                 # Tokens chung (filled from template)
└── {screen-name}/
    └── pixel-perfect-handoff.md     # Design specs per screen

tasks/
├── {feature-name}-checklist.md      # Active feature checklists
└── lessons.md                       # Lessons learned
```

---

## Phụ lục B — Checklist Tổng Hợp Trước Khi Launch v1.0

### Product

- [ ] Core features hoạt động end-to-end
- [ ] Onboarding flow smooth (< 2 phút)
- [ ] Error / empty / loading states trên mọi screen

### Technical

- [ ] Staging ổn định, seed data realistic
- [ ] Payment tested full flow (nếu có)
- [ ] Push notification works (nếu có)
- [ ] Deep links works (nếu có)
- [ ] Offline handling graceful
- [ ] Security audit pass

### Infra

- [ ] Production server / hosting provisioned
- [ ] Database backup automated (daily)
- [ ] SSL/TLS configured
- [ ] CDN for static assets (nếu cần)
- [ ] Logging + monitoring active

### Legal

- [ ] Privacy Policy published
- [ ] Terms of Service published
- [ ] Data deletion mechanism (GDPR / compliance)
- [ ] Platform review guidelines compliant

### Marketing

- [ ] Landing page / website
- [ ] Store listing optimized (ASO) — nếu mobile
- [ ] Social media presence
- [ ] Launch plan (beta → soft launch → hard launch)

---

*Template này là bắt buộc đọc cho mọi team member. Cập nhật khi quy trình thay đổi.*
