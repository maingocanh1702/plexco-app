# Sporta BE docs → Plexco: gap analysis + design input

> **Loại:** research / comparative analysis + design input. **KHÔNG phải** review verdict, readiness
> gate hay build contract; không sửa BE spec Reviewed nào; không authorize code/runtime.
>
> **Ngày:** 2026-08-07 · **Baseline Plexco:** `main@7e21f65dc4eff0fb845448d8c9a974bcb64f7edb`
> **Input (external, non-authoritative):** 12 BE tech docs Sporta — Phase 1 (7): auth · explore ·
> home · payment · search · session · session_detail; Phase 2 (5): auto_reconcile · auto_remind ·
> dynamic_vietqr · invoice_export · timeout_partial. Stack Sporta: NestJS + Prisma + BullMQ + WS.
> **Hoàn tất bộ sweep 2026-08-07:** FE payment (`sporta-payment-fe-port-analysis`) · FE 12-file
> (`sporta-fe-docs-gap`) · session product (`sporta-session-docs-gap`) · **BE (file này)** — hết docs Sporta.
> **Nguyên tắc:** BE spec Plexco đa số Reviewed → mọi thứ port được ghi ở đây làm design input cho
> build slice/spec tương lai, KHÔNG edit trực tiếp spec Reviewed (khác batch FE — FE là Draft).
>
> **Cập nhật cùng ngày (decisions v2.18):** DD-97 đã ✅ direction + entitlement (owner-delegated) — §2.1 giờ là input cho spec pair được author theo gate khi tới lượt.

---

## 1. Verdict tổng — BE là chiều Plexco vượt gần như toàn diện

| Cụm Sporta BE | Plexco tương đương | Verdict |
|---|---|---|
| Auth OTP/phone, refresh rotation | DD-13/DD-50 (không phone P1); web_auth DD-80 đã land D0a/D0b/D1 | N/A + đã có mạnh hơn |
| Session lock/join/waitlist/promotion-TTL | DD-45/45a/49, DD-32 hold + requeue-tail, partial unique fence | ✅ Plexco chặt hơn |
| Payment status flags (`paid_amount` cộng dồn, UNPAID→CONFIRMED…) | `charges` + `payment_allocations` append-only + reversal + `pay_code` (DD-02) | ✅ Plexco vượt hẳn — ledger vs flags |
| Webhook idempotent (UNIQUE provider+tx, HMAC, raw payload JSONB) | `bank_transactions` + provider adapter contract payment_reconcile | ✅ đã có |
| Reminder scheduler (quiet hours, atomic count, auto-stop) | NTF v3.11 (tenant-tz quiet hours, cooldown, effective-state, planned/due lifecycle) | ✅ Plexco chặt hơn |
| In-process events (`@OnEvent`) decouple modules | Outbox + LISTEN/NOTIFY (durable, INV-2) | ❌ REJECT cho money-path — in-process mất event khi crash |
| Cron reconcile counter (`filledSlots`) thay invariant test | Invariant/DDL tests + projector | ❌ REJECT làm substitute; Plexco đã đúng hướng |
| Zero-values fallback khi user không tồn tại | Fail-closed `unknown` (không render 0) | ❌ REJECT — fail-open số tiền |
| Geo/Haversine/PostGIS | DD-98 NP-5 (mâu thuẫn DD-06) | ❌ đã negative-scope |
| Region/provider registry config | connector_onboarding + billing (sepay\|apipay rail) | ✅ đã có |

## 2. Cụm đáng giữ — design input cho spec/slice tương lai

### 2.1 → DD-97 (statement/export) — BE mechanics từ `invoice_export_tech`

Khi author spec pair cho DD-97 (nếu owner ✅), các cơ chế sau đáng đưa vào contract:

- **Dedupe pending job:** request export khi đã có job PENDING/PROCESSING cùng scope → trả job hiện có, không tạo mới.
- **`202 Accepted` + `estimatedSeconds`** cho request async; job row tự là state machine `PENDING→PROCESSING→COMPLETED|FAILED` kèm `error_message`, `file_size`, `expires_at`.
- **Cờ `preliminary`** khi export kỳ/session chưa chốt (Plexco: kỳ chưa qua period boundary theo tenant timezone).
- **Cap số record/export + streaming write** (Sporta: 5000) — số cụ thể chốt ở spec.
- **Fail path:** generate/upload fail → retry bounded → `FAILED` + notify, không treo PENDING vô hạn.
- ⚠️ Khác Sporta: KHÔNG S3 presigned URL public — HR2 đòi authenticated download (đã pin trong DD-97); expiry vẫn giữ.

### 2.2 → session_organize (DD-61..64, build post-P4) — từ `session_detail_tech`

Cơ chế cụ thể đáng tái dùng khi chi tiết hoá BE spec organize:

- **Score validator table-driven** (`SPORT_RULES`: maxPerSet/winScore/winMargin/maxSets per môn) — thêm môn = thêm row, không sửa logic; khớp mô hình bảng `sports` extensible (DD-08).
- **Preview ≠ commit:** endpoint generate-teams thuần tính toán không ghi DB, tách khỏi endpoint commit — host re-shuffle thoải mái trước khi chốt.
- **Degrade tường minh:** chia đội thiếu người → `skippedCourts` + reason; đội lẻ → `warning UNEVEN_TEAMS` (warning ≠ error).
- **Idempotent score submit:** upsert theo `(match_id, set_number)`; optimistic lock (version) cho edit đồng thời — Plexco đã có `sessions.version`, cùng pattern.
- **Grace period sửa điểm sau COMPLETED** (Sporta 24h) + recalculate aggregate — số giờ là product decision khi build.
- **Aggregate `player_histories`** (winRate/streak/recentForm) incremental — nếu làm, là projection riêng, không đụng money plane.

### 2.3 → marketplace discovery build slice — từ `search_tech`/`explore_tech`

- **Đường scale text search:** P1 ILIKE → P2 cột `tsvector` GENERATED ALWAYS AS STORED + GIN index → chỉ khi vượt ngưỡng đo được. ⚠️ **Sporta spec ghi config `'vietnamese'` — PostgreSQL KHÔNG có text search config này**; Plexco dùng `simple` (+unaccent nếu cần) như DD-92 đã pin cho chat FTS. Không port nguyên văn.
- **Relevance formula tường minh** (title*10 + desc*3 + popularity, exact > startsWith > contains) — viết sẵn trong spec trước khi build để không thành magic number trong code.
- **Threshold-driven optimization:** ghi ngưỡng định lượng ngay trong spec ("response >Xms → cache; >N rows → tsvector") thay vì quyết định cảm tính — discipline đáng nhân rộng (§3).
- Sort per-entity + count/list chạy `Promise.all` — ổn, nhưng count phải cùng filter với list (Sporta search có bug count lệch filter — không port nguyên văn).

### 2.4 → DD-89/90 worker lane — pattern check-item

- **Startup catch-up:** restart → query việc quá hạn xử lý ngay (Sporta dùng ở remind + timeout). NTF đã có planned/due lifecycle; khi build worker slice, xác nhận catch-up-on-boot nằm trong acceptance (nếu chưa, thêm ở slice đó — không sửa spec bây giờ).
- **Alert theo độ sâu queue** (Sporta: queue >100 → alert) — observability input cho enablement slice.

## 3. Template BE: không cần ratify gì thêm

Khác batch FE (Plexco FE thiếu 4 section → DD-99 P1), chiều BE **ngược lại**: template Plexco BE
(contract + invariant + error catalog theo BE tech + acceptance matrix + migration monotonic) mạnh hơn
template Sporta BE trên mọi trục Sporta yếu — Sporta không có state machine tường minh, không rollback
plan, không invariant test (bù bằng cron reconcile), error catalog phân tán. **Một discipline duy nhất
của Sporta đáng cân nhắc nhân rộng:** ghi *quantified optimization/upgrade triggers* trong spec
(pattern §2.3). Không đề xuất sửa gate/template — có thể áp tự nguyện khi author spec mới.

## 4. Không port (bổ sung lý do BE-specific, ngoài các NP của DD-98)

- In-process event bus cho money/side-effects (mất event khi crash — Plexco outbox là đúng).
- Lazy write-on-read state transition ("GET tự auto-transition làm backup cho cron") — read path ghi
  DB phá command/outbox model; Plexco derive effective status ở projection, không mutate khi đọc.
- Client-side build VietQR URL (`img.vietqr.io/...?STK=...`) — lộ STK trong URL + trái fence "FE không
  tự render QR/STK" của player_view.
- bcrypt-hash làm lookup key (mâu thuẫn nội tại trong Sporta auth spec — index trên bcrypt không lookup được).
- Cron reconcile thay invariant test.

## 5. Hành động session 2026-08-07 (vòng BE)

| # | Hành động | Trạng thái |
|---|---|---|
| 1 | Research doc này (12/12 BE docs — kết thúc toàn bộ sweep Sporta) | ✅ |
| 2 | DD-97 thêm pointer tới §2.1 (BE mechanics input) | ✅ session này |
| 3 | Không DD mới, không sửa BE spec Reviewed nào | ✅ đúng chủ đích |
