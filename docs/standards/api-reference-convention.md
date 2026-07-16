# API Reference — Convention & Template

> **Status:** 🟡 Proposal · **Version:** 0.1 · 2026-07-16
> **Nguồn:** ported từ Sporta `docs/architecture/sporta-api-reference.md` — adapt envelope + auth model Plexco.
> **Decision:** `decisions.md` DD-60 (🟡).
> **Quan hệ:** convention thống nhất cho phần **"API Contract"** trong mọi `../features/BE/feature_*_tech.md` §3, và cho aggregate reference `apps/web` routes. Bổ sung `channels/web/README §7 (API DTO Baseline)`, không thay.

Mục tiêu: mọi endpoint mô tả **cùng một format** (auth level + request + response + error) để đọc/aggregate được thành 1 API reference.

---

## 1. Conventions

### 1.1 Response envelope (chuẩn Plexco)
Khớp `apps/web/lib/api-envelope.ts` + CLAUDE.md §4:

```jsonc
// ✅ Success
{ "data": { /* DTO whitelist */ }, "meta": { "page": 1, "limit": 20, "total": 0, "hasNext": false } }

// ❌ Error (LUÔN JSON)
{ "error": true, "message": "…", "code": "ERROR_CODE" }
```
- `message` = human text (map i18n `t(vi,en)` ở FE); `code` = hằng máy đọc (`SCREAMING_SNAKE`).
- Field bổ sung inline khi cần: `retryAfter`, `attemptsRemaining` …
- **DTO chỉ chứa field whitelist** — không tiền/PII ra public route (HARD RULE 2).

### 1.2 Auth levels (legend — gắn icon vào mỗi endpoint)
| Icon | Level | Mô tả |
|---|---|---|
| ⬜ | Public | Không auth — chỉ public read model (`public_sessions`) hoặc webhook-by-token. Không tiền/PII. |
| ✅ | User | Person đã đăng nhập (web session / account). Qua RLS theo membership. |
| 🔑 | Host/Admin | Thao tác host/tenant-admin (money-write, config). `tenantRepo` + role check. |
| 🔒 | HMAC/Token | Webhook (SePay/ApiPay) — verify chữ ký timing-safe / token, không phải user session. |

> Mọi endpoint tenant-scoped đi qua `tenantRepo(tenantId)` (HARD RULE 1). Public read model KHÔNG RLS nhưng chỉ field-whitelist.

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
{ "data": { /* … */ } }

// ❌ Response 4xx — CODE_A
{ "error": true, "message": "…", "code": "CODE_A" }
// ❌ Response 4xx — CODE_B
{ "error": true, "message": "…", "code": "CODE_B" }
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
{ "data": { "playerId": "uuid", "status": "active", "chargeId": "uuid|null" } }
// ✅ 200 — waitlisted (full)
{ "data": { "playerId": "uuid", "status": "waitlisted", "chargeId": null } }

// ❌ 403 — GATING_FAILED
{ "error": true, "message": "…", "code": "GATING_FAILED" }
// ❌ 409 — REJOIN_REQUIRES_REVIEW
{ "error": true, "message": "…", "code": "REJOIN_REQUIRES_REVIEW" }
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
| 16/07/2026 | 0.1 | 🟡 Proposal — convention API reference (envelope + auth legend + block format). DD-60. |
