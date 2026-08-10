> **📌 Ported from Sporta** (2026-08-10) — Adapt placeholders cho Plexco context trước khi sử dụng.

# {PROJECT_NAME}

> Copy file này vào folder project và thay `{PROJECT_NAME}`, `{product-name}`, `{port}` bằng tên thực tế.

## Mô tả

{Mô tả ngắn gọn sản phẩm — 1-2 câu}

## Tech Stack

- **Frontend:** {framework}
- **Backend:** {framework}
- **Database:** {database}

## Yêu cầu

- Node.js >= 18
- npm >= 9

## Cài đặt & Chạy

```bash
# Install dependencies
cd {product-name}
npm install

# Start development server
npm run dev
```

App sẽ chạy tại: `http://localhost:{port}`

## Port Registry

| Service | Port |
|---------|------|
| Frontend | {port} |
| Backend API | {api-port} |

## Cấu trúc thư mục

```
{product-name}/
├── CHANGELOG.md
├── {product-name}-brd.md
├── {product-name}-tdd.md
├── {product-name}-UIUX.md
├── {product-name}-design-tokens.md
├── {product-name}-plan.md
├── {product-name}-QA.md
├── README.md
├── package.json
└── src/
```

## Tài liệu

| File | Mô tả |
|------|--------|
| `{product-name}-brd.md` | Business Requirements Document |
| `{product-name}-tdd.md` | Technical Design Document |
| `{product-name}-UIUX.md` | UI/UX Design Document |
| `{product-name}-design-tokens.md` | Design Tokens (Single Source of Truth) |
| `{product-name}-plan.md` | Implementation Plan |
| `{product-name}-QA.md` | QA Test Cases |
| `CHANGELOG.md` | Version history & implementation status |

---

## Template Change Log

| Date | Change | Lý do |
|------|--------|-------|
| 2026-02-22 10:47 | Tạo template readme.md | Chuẩn hóa README format cho mọi project — setup guide, port registry, file structure |
