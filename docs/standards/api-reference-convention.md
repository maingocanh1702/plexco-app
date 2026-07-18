# API Reference — Convention & Template

> **Status:** ✅ Accepted (owner 2026-07-18) · **Version:** 0.3 · 2026-07-18
> **Nguồn:** ported từ Sporta `docs/architecture/sporta-api-reference.md` — adapt envelope + auth model Plexco.
> **Decision:** `decisions.md` DD-60 (✅ owner 2026-07-18). Áp cho mọi `BE/feature_*_tech.md §API Contract` mới (forward-looking; không bắt retrofit gấp).
> **Quan hệ:** convention thống nhất cho phần **"API Contract"** trong mọi `../features/BE/feature_*_tech.md` §3, và cho aggregate reference `apps/web` routes. Bổ sung `channels/web/README §7 (API DTO Baseline)`, không thay.

Mục tiêu: mọi endpoint mô tả **cùng một format** (auth level + request + response + error) để đọc/aggregate được thành 1 API reference.

---

## 1. Conventions

### 1.1 Response envelope (chuẩn Plexco)
Khớp `apps/web/lib/api-envelope.ts` + CLAUDE.md §4:

```jsonc
// ✅ Success
{ "data": { /* DTO whitelist */ }, "error": null, "meta": { "requestId": "req_..." } }

// ❌ Error (LUÔN JSON)
{ "data": null, "error": { "code": "ERROR_CODE", "message": "…", "statusCode": 400 }, "meta": { "requestId": "req_..." } }
```
- `error.message` = human text (map i18n `t(vi,en)` ở FE); `error.code` = hằng máy đọc (`SCREAMING_SNAKE`); `error.statusCode` khớp HTTP status.
- `meta.requestId` luôn có. Domain metadata/advisory/pagination hiện nằm trong DTO `data` vì live `ok()` chỉ tạo `meta.requestId`; muốn mở rộng `meta` phải sửa helper + baseline + tests trước.
- **DTO chỉ chứa field whitelist** — không tiền/PII ra public route (HARD RULE 2).

### 1.2 Auth levels (legend — gắn icon vào mỗi endpoint)
| Icon | Level | Mô tả |
|---|---|---|
| ⬜ | Public | Không auth — chỉ public read model (`public_sessions`). Không webhook, tiền hoặc PII. |
| ✅ | Account/Person | Person đã đăng nhập. Route tenant-scoped cần membership + RLS; route person-self phải kiểm tra đúng subject, không giả định membership. |
| 🔑 | Exact capability | Host/admin/co-admin chỉ được action/resource cụ thể trong canonical registry; `tenantRepo` + exact capability check, không blanket role inheritance. |
| 🔒 | Provider-authenticated | Webhook/connector verify đúng contract provider (timing-safe HMAC hoặc token phù hợp), không phải public hay user session. |

> Mọi endpoint tenant-scoped đi qua `tenantRepo(tenantId)` (HARD RULE 1). Public read model KHÔNG RLS nhưng chỉ field-whitelist. Webhook luôn là 🔒 kể cả khi credential nằm trong URL/header.

## 2. Format 1 endpoint (lặp cố định)

```
### {N}. {METHOD} `/api/{path}` {icon}
{mô tả 1 dòng · rate-limit/concurrency note nếu có}
```
Kèm 1 fenced block `jsonc`:

```jsonc
// Query: ?a=..&b=..            (nếu có)
// Request
{ /* body */ }

// ✅ Response 2xx
{ "data": { /* … */ }, "error": null, "meta": { "requestId": "req_..." } }

// ❌ Response 4xx — CODE_A
{ "data": null, "error": { "code": "CODE_A", "message": "…", "statusCode": 400 }, "meta": { "requestId": "req_..." } }
// ❌ Response 4xx — CODE_B
{ "data": null, "error": { "code": "CODE_B", "message": "…", "statusCode": 409 }, "meta": { "requestId": "req_..." } }
```
- **Side effects (async)** ghi bullet dưới block (vd: outbox event, fan-out projector, notify).
- Endpoint cách nhau bằng `---`.

## 3. Ví dụ (khung — điền khi có endpoint thật)

```
### 1. POST `/api/sessions/:id/join` ✅
Player join 1 kèo. Rate-limit theo BL-SEC-5. Concurrency: waitlist promote atomic (DD-45).
```
```jsonc
// Request
{ "note": "string?" }

// ✅ 200 — active
{ "data": { "playerId": "uuid", "status": "active", "chargeId": "uuid|null" }, "error": null, "meta": { "requestId": "req_..." } }
// ✅ 200 — waitlisted (full)
{ "data": { "playerId": "uuid", "status": "waitlisted", "chargeId": null }, "error": null, "meta": { "requestId": "req_..." } }

// ❌ 403 — GATING_FAILED
{ "data": null, "error": { "code": "GATING_FAILED", "message": "…", "statusCode": 403 }, "meta": { "requestId": "req_..." } }
// ❌ 409 — REJOIN_REQUIRES_REVIEW
{ "data": null, "error": { "code": "REJOIN_REQUIRES_REVIEW", "message": "…", "statusCode": 409 }, "meta": { "requestId": "req_..." } }
```
- Side effects: outbox `session_updated` → fan-out SSE + upsert `public_sessions`.

## 4. WebSocket / SSE events (nếu có)
| Event | Direction | Payload | Trigger |
|---|---|---|---|
| {session_updated} | Server → Client | `{ sessionId, filledSlots, status }` | join/leave/promote |

## 5. Bảng tổng hợp endpoints (aggregate)
| Phase | Module | Endpoints | Auth |
|---|---|---|---|
| {P4.3} | {Session} | {#1–#8} | {⬜ + ✅ + 🔑} |

## Cross-references
- Per-feature contract: `../features/BE/feature_*_tech.md §3 API Contract`
- Envelope: `apps/web/lib/api-envelope.ts` · DTO baseline: `../channels/web/README §7`
- Error codes phải cite business rule liên quan (`business-rules.md`) khi là money/security.

## Changelog

| Ngày | Version | Thay đổi |
|------|---------|----------|
| 18/07/2026 | 0.3 | DD-60 ✅. Tách public khỏi provider webhook; sửa ✅ person-self vs tenant membership; 🔑 dùng exact capability/resource. Convention áp forward-looking và on-touch retrofit. |
| 17/07/2026 | 0.2 | Reconcile toàn bộ example với live `apps/web/lib/api-envelope.ts`: success/error đều có `data`, `error`, `meta.requestId`; error fields nằm dưới `error`. |
| 16/07/2026 | 0.1 | 🟡 Proposal — convention API reference (envelope + auth legend + block format). DD-60. |
