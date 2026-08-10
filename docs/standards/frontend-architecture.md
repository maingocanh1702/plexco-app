# Frontend Architecture Principles — Plexco Web

> **Status:** ✅ Active FE governance (owner 2026-07-28) · **Version:** 0.7 · 2026-08-07
> **Nguồn:** ported từ Sporta `architecture/frontend_architecture_flutter.md` — adapt sang stack Plexco (Next.js App Router + React, CSS-variable tokens, **không Tailwind**).
> **Decision:** `decisions.md` DD-57 (✅).
> **Áp dụng cho:** `apps/web` (Next.js 15 App Router · React 19 · SSE).
> **Đây là counterpart FE của** `core-db-architecture-principles.md` (BE). Không override HARD RULES ở `00-start-here/HANDOFF.md §3`.
>
> **Status boundary:** DD-57 là governance cho FE mới hoặc materially changed, không phải bằng chứng FE đã implement. FE vẫn HOLD tới khi canonical `design.pen` được track + owner duyệt và gate per-screen của DD-58 đóng.
>
> **Cập nhật 06/08:** 12 FE design spec đã commit tại `../channels/web/FE/`. Chúng **không** đổi status boundary trên: spec Draft ≠ FE implemented, trục FE/UI vẫn 0 màn, `design.pen` vẫn untracked. Checklist §DD-58 dưới đây vẫn còn ô "canonical `design.pen` đã được track + owner duyệt" chưa tick.

Tài liệu này định nghĩa **cách cấu trúc code FE** — không phải design tokens (xem `design-tokens.md`) và không phải screen spec (xem `../features/FE/feature_*.md` §Screens & States + `../channels/web/design-brief.md`).

---

## 0. Nguyên tắc bất biến (FE-INV)

| ID | Bất biến | Vì sao |
|---|---|---|
| **FE-INV-1** | **4-state rule** — mọi screen data-driven PHẢI xử lý đủ `loading / ready / empty / error`. Không có "happy-path only". | Tránh UI trắng/treo khi mạng lỗi hoặc list rỗng. |
| **FE-INV-2** | **Tokens-only** — không hardcode hex/rgba/px. Luôn `var(--token)` (xem `design-tokens.md`). | 1 nguồn design; đổi theme không sửa component. |
| **FE-INV-3** | **Client không chạm DB** — Client Component không import/gọi `@plexco/db`, `tenantRepo` hoặc DB; chỉ đi qua web boundary đã auth. Server Component/Route Handler được gọi canonical authenticated application service trực tiếp, không self-HTTP. Service sở hữu authz, DTO whitelist, tenant/RLS context và repository. | Không rò rỉ cross-tenant, không tạo hai đường nghiệp vụ. |
| **FE-INV-4** | **i18n bắt buộc** — mọi chuỗi user-facing = `t(vi, en)` (HARD RULE 5). Không hardcode 1 thứ tiếng trong JSX. | Song ngữ vi/en. |
| **FE-INV-5** | **Không tiền/PII vào client bundle hoặc public route** — discovery UI đọc `public_sessions` (field-whitelist, HARD RULE 2). Roster/nợ/SĐT/email chỉ trong route đã auth + RLS. | Bất biến rò rỉ. |
| **FE-INV-6** | **API envelope chuẩn** — client parse `{ data, error, meta.requestId }`; khi lỗi đọc `error.{code,message,statusCode}` (xem `apps/web/lib/api-envelope.ts`), không đọc raw exception. | Error model thống nhất FE↔BE. |

> Test/lint bắt buộc: không có hex/rgba literal trong `styles/components/*` (ngoài `:root`); mọi chuỗi hiển thị qua `t()`.

---

## 1. Mục tiêu kiến trúc

- **Server-first**: mặc định React **Server Component**; chỉ `"use client"` khi cần state/effect/handler.
- **Feature-first**, không layer-first: gom theo màn/feature, không gom theo "tất cả component / tất cả hook".
- **Data qua choke-point**: Client Component → web boundary → canonical application service; Server Component/Route Handler → cùng service trực tiếp, **không self-fetch HTTP**. Service → repository/`tenantRepo`. Client không bao giờ import `@plexco/db`.
- **Token-driven**: UI đọc CSS variables; đổi brand/dark-mode = đổi token.
- **Realtime qua SSE** (DD-07): subscribe 1 chiều server→client, không multi-master (HARD RULE 3).

## 2. Tech Stack

| Layer | Công nghệ | Ghi chú |
|---|---|---|
| Framework | Next.js 15 App Router | standalone/container, không Vercel (DD-10) |
| UI runtime | React 19 (Server + Client Components) | server-first |
| Styling | CSS variables + component CSS (`styles/index.css` + `styles/components/`) | **không Tailwind** — dùng `var(--token)` (FE-INV-2) |
| Realtime | SSE (`app/api/sse`) + `LISTEN/NOTIFY` | DD-07 |
| Data access | Client: fetch web boundary; Server Component/Route Handler: gọi canonical service trực tiếp; service → repository/`tenantRepo` | Không self-HTTP ở server; RLS choke-point thuộc service/repo |
| i18n | `t(vi, en)` từ `@plexco/core` | HARD RULE 5 |
| Test | Vitest | `apps/web` đã cấu hình |

## 3. Cấu trúc thư mục (khớp `apps/web` thực tế)

```
apps/web/
├── app/
│   ├── layout.tsx · page.tsx
│   ├── api/                 ← route handlers (auth, sessions, payments, members, discover, sse…)
│   ├── dashboard/           ← host UI (route group)
│   ├── discover/            ← marketplace UI (public read model)
│   ├── player/              ← player view
│   └── (shared route segments)
├── lib/                     ← api-envelope, session-cookies, auth-secrets, login-state…
│                              (+ apiClient client-side khi FE mở: token inject, refresh
│                               rotation, parse envelope → AppError qua `toAppError` @plexco/core)
├── components/              ← shared presentational components (đề xuất: tách shared vs feature)
├── features/<name>/         ← UI theo feature: components/ + state/ + hooks/ + index.ts (barrel)
└── styles/
    ├── index.css            ← :root tokens + reset
    └── components/          ← CSS theo component
```

> **Quy ước import:** Client Component **KHÔNG** import từ `@plexco/db` hoặc gọi `tenantRepo`; chỉ dùng web boundary đã auth. Server Component/Route Handler gọi canonical authenticated application service trực tiếp; chỉ service/repository owner mới chạm `tenantRepo`.
>
> **Quy ước route mỏng (0.7):** segment trong `app/` chỉ compose từ `features/<name>/index.ts` (barrel), không chứa business/UI logic. Feature tách khỏi router ⇒ port PWA → RN+Expo phase-2 (DD-69) chỉ đổi shell/router, giữ nguyên `features/`. Nguồn: pattern đã chạy production ở Sporta (`sporta-app/src`); bối cảnh so sánh ở `../proposals/cross-project-standardization-2026-08-07.md` §2.

## 4. Data flow (bắt buộc)

```text
Client Component
  → authenticated web boundary
    → Route Handler / Server Action
      ┐
Server Component / Route Handler
  → canonical authenticated application service directly  (no self-HTTP)
      ┘
        → authz + DTO whitelist + tenant/RLS context
          → repository / tenantRepo(tenantId)               (HARD RULE 1)
            → Postgres

Client response ← envelope { data,error,meta.requestId } ← whitelisted DTO
Server render   ← whitelisted DTO
```

Quy tắc: **UI chỉ nhận DTO đã whitelist**, không nhận nguyên row DB. Mapping DTO↔domain, authz và tenant/RLS context nằm ở canonical application service; transport chỉ validate/serialize.

## 5. State pattern (React)

- **Server state**: Server Component gọi canonical application service trực tiếp; client hook fetch authenticated web boundary với cache/invalidate rõ ràng. Mỗi màn khai báo state machine 4-nhánh:

```ts
type ScreenState<T> =
  | { kind: 'loading' }
  | { kind: 'ready'; data: T }
  | { kind: 'empty' }
  | { kind: 'error'; error: AppError };
```

- UI render bằng `switch (state.kind)` — **phải handle đủ 4 nhánh** (FE-INV-1). Empty state cần icon + message + CTA; error state cần retry.
- **Local UI state**: `useState`/`useReducer`. Không dùng global store cho thứ có thể là server state.

## 6. Error model

- Mọi lỗi API map về sealed `AppError`: `network | unauthorized | forbidden | notFound | validation | server | unknown`.
- Nguồn: parse canonical envelope `{ data:null, error:{code,message,statusCode}, meta:{requestId} }` (`lib/api-envelope.ts`) → `AppError`. **Không** ném raw `Error`/HTTP status lên UI.
- **Mapper chuẩn (0.7):** `toAppError` từ `@plexco/core` (browser-safe, cạnh `api-contract.ts`) — network failure và envelope error đều map qua một chỗ; UI không tự map status→kind rải rác từng màn.
- `code` map sang message i18n `t(vi,en)`; không hiển thị `code` thô cho user.

## 7. Realtime (SSE — DD-07)

- Subscribe `app/api/sse`; server đẩy event qua `LISTEN/NOTIFY` khi projector fan-out.
- FE chỉ **nhận** update (1 chiều), không ghi ngược qua SSE — mutation vẫn đi POST/PUT (HARD RULE 3 không multi-master).
- Trạng thái kết nối: `connecting / live / reconnecting / stale` (xem `channels/web/README §4`).

## 8. Docs-before-code gate (§FE)

Trước khi code 1 màn mới, phải có đủ:

- [ ] Product spec `../features/FE/feature_<name>.md` §Screens & States (Reviewed).
- [ ] **FE design spec `../channels/web/FE/feature_<name>_fe.md`** (template `../templates/feature-dev/fe-spec-template.md`) — có đủ: §6 `Data hiển thị` với exact response path hoặc `UNPINNED — omit active UI`, cột i18n `t(vi, en)` (FE-INV-4), và **bảng `#### Error mapping` cho từng screen** map status/error code → visible state, mã lấy nguyên văn từ BE tech doc, kết bằng hàng unknown/missing/timeout fail-closed (FE-INV-1/FE-INV-6). 12 spec đầu tiên đã có trên `main`.
- [ ] Canonical `design.pen` đã được track + owner duyệt; node/frame ID của màn tồn tại và được pin.
- [ ] Handoff `docs/channels/web/handoff/<screen>-handoff.md` (template `../templates/feature-dev/fe-handoff-template.md`).
- [ ] Token mapping `<screen>-token-mapping.md` (template `../templates/feature-dev/fe-token-mapping-template.md`).
- [ ] Pipeline: xem `../channels/web/frontend-pipeline.md`.

## 9. PR checklist (FE)

- [ ] Đúng cấu trúc thư mục (§3); client không import `@plexco/db`.
- [ ] Không hardcode màu/spacing/px — chỉ `var(--token)` (FE-INV-2).
- [ ] Đủ 4 state loading/ready/empty/error (FE-INV-1); empty có icon+message+CTA; error có retry.
- [ ] Mọi chuỗi qua `t(vi,en)` (FE-INV-4).
- [ ] Không tiền/PII trong discovery/public route (FE-INV-5).
- [ ] Parse envelope `{ data, error, meta.requestId }` và `error.{code,message,statusCode}` (FE-INV-6), không raw exception.
- [ ] Touch target ≥ 44px (xem `design-brief.md §8`).
- [ ] `pnpm --filter @plexco/web typecheck` + `test` xanh.
- [ ] Screen/feature visual owner hoặc shared primitive mang `// Source: <screen>-token-mapping.md §X`; presentational atom kế thừa không lặp comment.

## 10. Cross-references

- Tokens: `design-tokens.md` (value SoT) · design system: `design-system.md` (component catalog, usage tokens, layout, motion, a11y) · benchmark/method: `design-tokens-benchmark.md`
- FE design specs: `../channels/web/FE/feature_*_fe.md` · template: `../templates/feature-dev/fe-spec-template.md`
- Pipeline visual-source→code: `../channels/web/frontend-pipeline.md`
- API convention: `api-reference-convention.md`
- BE counterpart: `core-db-architecture-principles.md` · HARD RULES: `../00-start-here/HANDOFF.md §3`

## Changelog

| Ngày | Version | Thay đổi |
|------|---------|----------|
| 07/08/2026 | 0.7 | **Amendment cross-project standardization (owner duyệt 07/08 qua Cowork).** §3: `features/<name>/` bỏ nhãn "(đề xuất)" → chuẩn, thêm `index.ts` barrel + quy ước route mỏng (app/ chỉ compose, port-friendly DD-69) + apiClient client-side định vị ở `lib/`; §6 pin mapper chuẩn `toAppError` @plexco/core. Docs-only với FE runtime (vẫn 0 màn, FE HOLD + gate DD-58 không đổi); code companion là `packages/core/src/app-error.ts` cùng ngày. Nguồn so sánh: `../proposals/cross-project-standardization-2026-08-07.md`. |
| 07/08/2026 | 0.6 | **Ghi nhận 12 FE design spec + siết §8 gate (docs-only, không đổi FE-INV nào).** §8 docs-before-code thêm artifact bắt buộc **FE design spec** `../channels/web/FE/feature_<name>_fe.md`: trước đây gate chỉ đòi Product spec + `.pen` node + handoff + token mapping, nên không có chỗ nào bắt buộc pin i18n `t(vi, en)`, exact response path (hay `UNPINNED — omit`) và bảng error mapping status→state — đúng ba lỗ đã khiến 12 spec đầu tiên phải sửa lại toàn bộ sau khi viết. §10 cross-reference thêm `design-system.md` và thư mục FE spec. Status boundary không đổi: spec Draft ≠ FE implemented, trục FE/UI vẫn 0 màn, `design.pen` vẫn untracked, gate DD-58 vẫn đóng. *(Ghi chú 06/08 ở header được thêm ở commit trước mà quên bump version + changelog — dòng này đóng luôn khoảng trống đó.)* |
| 28/07/2026 | 0.5 | **DD-57 ✅:** activate server-first/feature-first/4-state governance; Client Component không chạm DB, Server Component/Route Handler gọi canonical application service trực tiếp; giữ FE HOLD và DD-58 per-screen gate. |
| 18/07/2026 | 0.4 | Owner defer DD-57; đánh dấu toàn bộ FE-INV/checklist là reference proposal, không active delivery gate. |
| 17/07/2026 | 0.3 | Reconcile FE-INV-6, data flow, error model và checklist với live canonical API envelope. |
| 17/07/2026 | 0.2 | Reconcile DD-58 v1.40: visual source có thể là `.pen` track hoặc Figma link; không claim asset cũ không tồn tại. |
| 16/07/2026 | 0.1 | 🟡 Proposal đầu tiên — ported từ Sporta FE architecture; adapt Next.js/React + CSS-var tokens. DD-57. |
