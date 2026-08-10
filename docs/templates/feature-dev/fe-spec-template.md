<!-- review-readiness: template -->
# Feature: {Name} — FE Design Spec

> **Route(s):** `/{route}`
> **Source authority:** `../../features/FE/feature_{name}.md` v{source-version} · baseline `{full 40-char source SHA}`
> **Source contract status:** {Draft | Reviewed | DECISION_FINAL — không suy ra runtime}
> **Projection/API contract:** {exact DTO/endpoint owner | `UNPINNED — omit active UI`}
> **Capability/availability:** {exact server-owned gate(s) | `none`}
> **Priority:** {1-13 — theo designer-kickoff.md §3B}
> **FE design status:** Draft
> **Runtime status:** {Not started | Partial — exact evidence | Implemented — exact code/test evidence}
> **Negative scope:** {behavior/surface chưa có Reviewed authority hoặc chưa thuộc lần handoff này}

---

## 1. Mô tả

{1-2 đoạn, viết cho designer hiểu. Không đưa chi tiết transaction/lock/migration vào body, nhưng phải giữ source provenance, contract status, runtime boundary và mọi safety-visible UX rule: fail-closed gates, privacy boundaries, data-contract limits.}

> **Contract/runtime boundary:** Chỉ behavior từ source contract đã Reviewed mới là design authority.
> Phần Draft/open/deferred phải ẩn khỏi active UI hoặc ghi rõ dependency placeholder. Design target
> không phải bằng chứng route/API/runtime đã tồn tại.

---

## 2. User Flows

### Flow 1: {Tên flow}

1. User vào `/{route}` → thấy {mô tả layout}
2. Click {CTA} → {kết quả}
3. ...

### Flow 2: {Tên flow}

...

---

## 3. Screens & States

### `/{route}` — {Screen Name}

#### Layout

```
┌─────────────────────────────────────────────┐
│  Header                                     │
├──────────┬──────────────────────────────────┤
│ Sidebar  │  Main Content                    │
│          │  ┌──────────────────────────────┐ │
│          │  │  Zone 1: ...                 │ │
│          │  ├──────────────────────────────┤ │
│          │  │  Zone 2: ...                 │ │
│          │  └──────────────────────────────┘ │
└──────────┴──────────────────────────────────┘
```

#### States

- **Loading:** {skeleton description — cụ thể elements nào skeleton}
- **Ready:** {layout chi tiết, zones, dữ liệu, CTA}
- **Empty:** {icon + text + CTA button}
- **Error:** {error message + retry CTA}

#### Error mapping

**Bảng này BẮT BUỘC cho mỗi screen** — prose "fail closed" không thay được. Mã lấy từ BE tech doc của
chính feature, không tự đặt:

| Status | Error code | Visible state | i18n `t(vi, en)` |
|---|---|---|---|
| {401/403/404/409/429/5xx} | `{CODE_FROM_BE_DOC}` | {state cụ thể: toast/inline/redirect/omit} | `t("{vi}", "{en}")` |
| — | *(unknown / missing / timeout)* | **Fail closed** — unavailable placeholder + retry | `t("…", "…")` |

> **Error mapping:** Pin server error/status → exact visible state. Unknown/missing response fail closed;
> không invent success, zero, empty hoặc disabled control. Nếu BE chưa pin catalog cho một endpoint,
> ghi `UNPINNED error catalog — omit active UI` thay vì bịa mã.

#### Responsive

| Breakpoint | Thay đổi |
|---|---|
| 1440px (Desktop) | Full layout |
| 768px (Tablet) | {collapse sidebar, stack zones} |
| 375px (Mobile) | {single column, bottom nav} |

---

## 4. Components Used

| Component | States | Mô tả |
|---|---|---|
| {ComponentName} | default, hover, active, disabled, loading, error | {mô tả ngắn} |

---

## 5. Edge Cases (UX)

| # | Case | Hiển thị |
|---|---|---|
| 1 | {case} | {designer nên vẽ gì} |

> **Strip engineering noise** (concurrency, transaction locks, DB constraints, DD references).
> **NHƯNG GIỮ safety-visible UX rules:**
> - **Fail-closed gates:** merge cần strong proof khi có nợ, readiness cần đủ steps
> - **Privacy boundaries:** peer sees zero (slash command), notification không lộ PII other-person
> - **Data contract limits:** chỉ hiện fields server trả, không tự build QR/secrets, không cache money offline
> - **Auth flow safety:** GET inert (verify/reset link), explicit POST confirm, no self-render tokens

---

## 6. Data hiển thị

| Field | Exact response path | Format | i18n `t(vi, en)` | Ghi chú |
|---|---|---|---|---|
| {field name} | `{dto.field}` | {VNĐ / date / text / badge} | `t("{chuỗi vi}", "{english string}")` | {notes} |

> **i18n rule (HARD RULE 5) — không có key-based i18n trong repo.** API duy nhất là
> `packages/core/src/i18n.ts` → `t(vi: string, en: string)`. Cột trên ghi **cặp chuỗi thật**, không ghi
> `t('some.key')`: key đó không resolve được và không có locale file nào trong cây. Mọi chuỗi
> user-facing — wireframe copy, state copy, edge-case copy, error copy, CTA, label, empty state —
> phải có **cả bản vi và bản en**; spec chỉ có tiếng Việt là spec chưa implement được.
> Chuỗi do server trả (message đã localize) thì ghi rõ `server-localized — FE không tự dịch`.

> **Contract rule:** Chỉ hiện data server trả trong response DTO. Mutation gửi opaque/exact IDs đã pin,
> không dùng display name làm identity. Không tự suy denominator, không tự build payment code, không
> cache person-self/money/PII offline. Nếu owner contract chưa pin exact response path, ghi
> `UNPINNED — omit active UI`; không dùng path minh hoạ hoặc wireframe fixture như implementation
> authority.

---

## 7. Responsive & Interaction Notes

- **Sidebar:** >1024px fixed 240px → ≤1024px collapse 64px icon-only → ≤768px ẩn + hamburger
- **Touch targets:** tối thiểu 44×44px
- **Hover effects:** {mô tả hover cho interactive elements}
- **Animations:** {micro-animations: transitions, loading, state changes}
- **Dark mode:** Dùng tokens `var(--bg-*)`, `var(--text-*)` — auto switch

---

_Template v0.4 · 2026-07-31 · Provenance + exact projection/gates + contract/runtime boundary_
