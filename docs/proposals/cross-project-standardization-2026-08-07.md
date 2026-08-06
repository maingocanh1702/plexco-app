# Proposal: Chuẩn hóa cross-project — lấy ưu điểm BotShopez + Sporta apply cho Plexco

> **Trạng thái:** 🟡 **PROPOSAL** — chưa phải decision, chưa authorize coding. Mọi hạng mục chỉ
> được implement qua Level 3 slice (worktree + scope-gate + review) sau khi owner chốt §6.
> **Ngày:** 2026-08-07 · **Base khảo sát:** `main@7e21f65`
> **Phạm vi:** conventions + tooling + test infra. **KHÔNG đụng:** schema/migrations, authority
> specs đã Reviewed, autopilot-kit paths, root Linear cluster (đã chốt giữ — proposal 2026-07-06 §8 Q4/Q5).
> **FE HOLD tôn trọng nguyên vẹn:** không mở page/component/token mapping tới khi `design.pen`
> được persist/track + owner nghiệm thu (HANDOFF §6). Hạng mục A chỉ là convention doc.

---

## 1. Nguồn gốc — so sánh 3 project (khảo sát 2026-08-07)

| | Plexco | BotShopez (Saas Bot tele) | Sporta |
|---|---|---|---|
| Điểm mạnh | Migration-first + RLS, docs/decision governance, core thuần có test | Monorepo 3-app đầy đủ, `packages/shared` FE↔BE, 513 test file + e2e + smoke, script test granular | FE `screens/<feature>/` gọn, `apiClient` tập trung token/refresh |
| Điểm Plexco còn thiếu | — | Contract types dùng chung FE↔BE; test granular/smoke/e2e | Convention cấu trúc FE (FE hiện 0 màn) |

Kết luận so sánh: Plexco đã tốt nhất về BE/kỷ luật kiến trúc; phần đáng nhập là **(A)** FE
convention từ Sporta, **(B)** shared API contract từ BotShopez, **(C)** test infra từ BotShopez,
**(D)** Turborepo cache (đánh giá, không bắt buộc).

## 2. Hạng mục A — FE structure convention (từ Sporta)

**⚠️ Correction sau khi đọc canonical (2026-08-07):** `docs/standards/frontend-architecture.md`
(✅ DD-57, Reviewed) §3 **đã** định nghĩa `features/<name>/` (components/ + state/ + hooks/,
đánh dấu "đề xuất") — tương đương pattern `screens/<feature>/` của Sporta. Không tạo chuẩn
song song tên `screens/`; tên chuẩn Plexco = **`features/<name>/`**.

**Phần Sporta bổ sung được (đề xuất amendment vào DD-57 §3, chờ owner duyệt — file Reviewed,
không tự sửa):**

- Route (`app/`) MỎNG — chỉ compose từ `features/<name>/index.ts` (barrel per feature),
  không chứa logic.
- `lib/apiClient.ts` client-side tập trung: inject token, refresh rotation, parse envelope
  (§B) → `AppError` (khớp frontend-architecture §6) — pattern đã chạy ở Sporta
  (`sporta-app/src/shared/apiClient.ts`).
- Tương thích DD-69: feature-based tách khỏi router ⇒ port PWA → RN+Expo phase-2 rẻ hơn
  (features giữ nguyên, đổi router/shell).
- KHÔNG scaffold thư mục/file component nào trước khi FE hết HOLD (DD-81).

## 3. Hạng mục B — Shared API contract (từ BotShopez `packages/shared`)

**Hiện trạng canonical (đã đọc trước khi đề xuất):**
- Envelope đã có contract: `docs/channels/web/README.md` §7 + impl `apps/web/lib/api-envelope.ts`
  (`{ data, error: { code, message, statusCode }, meta.requestId }`).
- Error code hiện là string literal rời từng route — không có registry, FE/bot không thể
  narrow type.
- `packages/core` barrel là **browser-safe** (i18n cách ly sau `@plexco/core/i18n`).

**Đề xuất — KHÔNG tạo package mới** (tránh cấu trúc song song; `core` đã là shared package):
1. Thêm `packages/core/src/api-contract.ts` (browser-safe, type-only + const):
   - `ApiEnvelope<T>` / `ApiError` types khớp nguyên văn §7 — contract không đổi, chỉ được
     type hóa.
   - `ERROR_CODES` const registry (union type) — gom các code đang dùng ở 10 route hiện có,
     mở rộng dần theo feature.
2. `apps/web/lib/api-envelope.ts` refactor: giữ nguyên behavior/`requestId`, import types +
   codes từ core. `node:crypto` giữ ở lib server-side (core không đụng Node builtin — giữ
   browser-safe invariant của barrel).
3. FE (khi unlock) + `apps/bot` dùng chung types/codes khi đọc/trả envelope.

Lợi ích: FE-BE không drift error contract — đúng bài học BotShopez (`packages/shared/error-codes.ts`
là chỗ FE và API cùng import).

## 4. Hạng mục C — Test infra (từ BotShopez)

**Hiện trạng:** mỗi package có `test` (vitest); root chỉ có `pnpm -r test` all-or-nothing;
CI: typecheck → format → review:check → lint → build → db:bootstrap → test. Không smoke, không e2e.

**Đề xuất:**
1. **Root script aliases** (package.json, không đổi CI):
   `test:core|db|web|bot` = `pnpm --filter <pkg> test`; `check:quick` = `lint + test:core`.
   Giá trị: vòng lặp slice nhanh hơn — không bắt buộc chạy DB suite khi chỉ sửa core.
2. **Smoke predeploy** `scripts/smoke-predeploy.mjs` (pattern BotShopez `smoke-predeploy.cjs`):
   hit `/healthz` + verify DB connectivity qua `DATABASE_URL_TEST`; chạy trong CI sau `build`.
3. **E2E Playwright:** khung `apps/web/e2e/` — **chỉ mở khi FE có UI thật** (hiện 0 màn ⇒
   defer, ghi vào backlog). DD-68 đã yêu cầu E2E hai-tenant/hai-Page làm merge gate cho
   Messenger — khung này là chỗ chứa nó sau.

Canonical runner + `DATABASE_URL_TEST` harness giữ nguyên (HANDOFF §4 Test) — aliases chỉ là
filter, không thay đổi số test hay cách đếm baseline.

## 5. Hạng mục D — Turborepo cache (đánh giá)

BotShopez + Sporta backend đều dùng turbo. Plexco dùng `pnpm -r` tuần tự.

**Khuyến nghị: DEFER có điều kiện.** Repo hiện 159 file TS / 4 workspace — build+test còn
nhanh; turbo thêm 1 lớp config + cache-invalidation phải audit (test DB-backed không thuần
input-hash → risk cache sai trên suite RLS). Ngưỡng kích hoạt đề xuất: khi `pnpm -w build`
hoặc canonical test suite > 5 phút local, mở slice riêng đánh giá turbo (hoặc `pnpm -r --parallel`
trước — rẻ hơn). Không adopt mặc định đợt này.

## 6. Quyết định cần owner chốt

| ID | Câu hỏi | Khuyến nghị |
|---|---|---|
| Q1 | A: chốt convention `screens/` cho FE (docs-only bây giờ)? | ✅ Có — chuẩn bị sẵn, không vi phạm HOLD |
| Q2 | B: đặt contract trong `packages/core` (không tạo `packages/shared` mới)? | ✅ Core — tránh package song song |
| Q3 | C1+C2 (aliases + smoke) làm ngay; C3 e2e defer tới FE unlock? | ✅ Đúng thứ tự đó |
| Q4 | D: defer turbo theo ngưỡng >5 phút? | ✅ Defer |

## 7. Slice plan đề xuất (sau khi owner chốt — mỗi slice qua scope-gate)

| Slice | Nội dung | Ước lượng | Risk | Phụ thuộc |
|---|---|---|---|---|
| S1 `std-api-contract-core` | B: `api-contract.ts` + refactor `api-envelope.ts` + test | ~150 LOC / 2 module | P2 (không đụng auth logic, chỉ type hóa) | — |
| S2 `std-test-aliases-smoke` | C1+C2: root scripts + smoke script + CI step | ~120 LOC | P2 | — |
| S3 `std-fe-convention-doc` | A: section convention trong `docs/channels/web/README.md` | docs-only | P3 | — |
| S4 e2e khung / turbo | C3+D | — | — | FE unlock / ngưỡng D |

S1–S3 scope rời nhau ⇒ chạy song song được. Proposal này **không** phải `PLAN_READY`/`CODE_READY`;
từng slice tự đạt readiness theo `docs/standards/review-code-readiness-gate.md`.

## 8. Những gì KHÔNG đề xuất (đã có hoặc đã chốt)

- Docs reorg — đã làm 2026-07-06 (P1/P3a/P4/P5 ✅).
- Tách worker app — `apps/bot` đã đảm nhiệm (queue/dispatcher/schedule).
- Prisma (BotShopez/Sporta dùng) — Plexco giữ Drizzle + SQL migrations (AUTHORITATIVE, DD/RLS
  gắn chặt); không đổi ORM.
- Di chuyển root Linear cluster / autopilot-kit paths — đã chốt giữ nguyên.

---

> **✅ ĐÃ TRIỂN KHAI 2026-08-07 (một phần, apply trực tiếp qua Cowork theo chỉ đạo owner —
> owner waive slice-gate cho đợt này; commit + review vẫn trên máy owner):**
>
> - **S1 (B) DONE:** `packages/core/src/api-contract.ts` (11 codes từ grep toàn bộ route
>   hiện có) + test + export barrel; `apps/web/lib/api-envelope.ts` narrow `err(code:
>   ApiErrorCode)` + `satisfies ApiEnvelope` — behavior không đổi, impact `err` = CRITICAL
>   (5 route) được verify bằng typecheck + test suite.
> - **S2 (C1+C2) DONE:** root scripts `test:core|db|web|bot`, `check:quick`,
>   `smoke:predeploy` + `scripts/smoke-predeploy.mjs` (healthz-only, khớp Fly http_check).
>   CI giữ nguyên — smoke chạy thủ công/predeploy, không thêm step.
> - **S3 (A) DONE (owner duyệt 07/08, apply cùng ngày):** amendment §2 đã vào
>   `frontend-architecture.md` v0.7 — `features/<name>/` thành chuẩn (bỏ "đề xuất"),
>   route mỏng + barrel, apiClient ở `lib/`, mapper chuẩn `toAppError` @plexco/core
>   (code companion `packages/core/src/app-error.ts`).
> - **C3 e2e + D turbo:** giữ DEFER như §4/§5.
