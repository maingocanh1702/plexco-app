## Mô tả

<!-- Mô tả tổng quan thay đổi + lý do. Link tới issue/ticket nếu có. -->

**Loại:** feat / fix / refactor / docs / chore / test
**Scope:** <!-- module/feature bị ảnh hưởng -->

## Thay đổi

<!-- Liệt kê files changed + tóm tắt từng file -->

| File | Thay đổi |
|------|----------|
| `path/to/file` | mô tả |

## Lý do

<!-- Tại sao cần thay đổi này? Bug gốc / business requirement / tech debt? -->

## Screenshots / Evidence

<!-- Chụp UI trước/sau, log output, test results — nếu applicable -->

## Testing

<!-- Mô tả test đã chạy, kèm lệnh -->

```bash
# Lệnh test (Postgres test DB)
pnpm test
```

## Checklist

- [ ] Code tuân thủ conventions (xem `docs/00-start-here/HANDOFF.md` §3)
- [ ] Tests pass (unit + integration)
- [ ] Build OK (`pnpm build`)
- [ ] TypeScript clean (`pnpm typecheck`)
- [ ] Docs updated (nếu đổi behavior/API)
- [ ] Review-readiness validator xanh (`pnpm review:check`) cho mọi review/docs/readiness artifact
- [ ] Final implementation plan/coding handoff dùng `review-readiness: code-ready` và đạt strict `CODE_READY`
- [ ] RLS/isolation test xanh (nếu đụng data layer)
- [ ] Public invariant test xanh (nếu đụng discovery/public)
- [ ] Không hardcode tiền/PII vào log/URL
- [ ] i18n: mọi chuỗi user-facing có cả vi + en
- [ ] Không circular imports
- [ ] Console clean (không warning/error mới)
- [ ] Responsive test (375px, 768px, 1440px) — nếu đụng web UI
- [ ] Regression OK — features cũ vẫn hoạt động

## Tracking

<!-- Ref: LINEAR-XXX hoặc Tracking: NO-LINEAR -->
Tracking: NO-LINEAR
