# Proposal: Plexco Global KB + Auto-sync KB (mở rộng Club Assistant)

> **Trạng thái:** 🟡 Draft đề xuất — chờ review · 2026-07-06
> **Loại:** Proposal (chưa Reviewed). **KHÔNG** sửa `schema.ts`/`migrations`/spec đã Reviewed cho tới khi DD-34/35/36 ✅.
> **Quan hệ:** mở rộng pair **Club Assistant** v0.17 (`../features/feature_club_assistant.md` + `../features/BE/feature_club_assistant_tech.md`). Pair nền đã là ✅ Reviewed contract; proposal DD-34/35/36 này vẫn là track Draft riêng và không hạ status, tự authorize runtime hoặc viết lại contract nền.
> **Quyết định mở:** `../standards/decisions.md` **DD-34** (Plexco global KB plane), **DD-35** (auto-derive KB-club từ canonical), **DD-36** (freshness / scheduled re-ingest).
> **Nguồn tham chiếu:** `../standards/core-db-architecture-principles.md` (INV-1..10, P1–P16) · `../00-start-here/HANDOFF.md §3` (5 HARD RULES) · Club Assistant pair v0.17 · DD-12 (public read-model + readonly grant) · DD-28 (live-context tool). Migration mới phải self-contained; không sửa `0009` đã apply.

---

## 0. TL;DR

Feature Club Assistant v0.17 hiện tại đã là **Reviewed contract** và mới bao **KB per-CLB, host nạp thủ công**. Yêu cầu owner (06/07) thêm **2 chiều mới**:

1. **Hỏi về chính Plexco** — trợ lý trả lời được câu hỏi về **nền tảng Plexco** (tính năng, cách dùng, chính sách chung), không chỉ về club. ⇒ thêm **tầng KB toàn nền tảng** (`platform_kb_*`) — **global, read-only cho mọi tenant, non-PII** — và **retrieval hợp nhất** KB-club (RLS) ∪ KB-Plexco (global). **DD-34.**
2. **Auto-update KB** theo update của **Plexco** và **từng club** — không bắt host nạp lại tay:
   - **(a) Auto-derive KB-club từ dữ liệu canonical của club** (đổi mô tả/luật/chính sách giá của club → projector tự sinh lại KB document). **DD-35.**
   - **(b) Scheduled re-ingest** nguồn ngoài (URL) + **re-ingest KB-Plexco** khi nội dung nền tảng đổi, change-detect bằng `content_hash`. **DD-36.**

**Bất biến giữ nguyên:** grounding **chỉ KB** — DD-34 là **extension của DD-21** (mở allowed sources sang `platform_kb`, vẫn KB-only; khi ✅ phải patch DD-21 + Club Assistant specs), tiền/PII **không** vào LLM/KB/public (HR2), tenant KB **cô lập RLS** (HR1), mọi ghi qua **command→outbox→projector** (HR3), realtime vận hành (slot/chỗ trống) vẫn đi **live-context tool** (DD-28) **KHÔNG** vào KB.

---

## 1. Vì sao là track mới (không chồng spec đã Reviewed)

Spec Club Assistant hiện tại giả định: **mọi** bảng `kb_*` là **tenant-private**; KB được host **nạp thủ công** (`kind ∈ faq/doc_upload/pasted/url`); trợ lý chỉ biết KB của đúng club đó. Hai chiều owner yêu cầu **không** biểu diễn được trong mô hình đó:

- "Hỏi về Plexco" cần tri thức **dùng chung, không thuộc tenant nào** — không có plane cho nó (mọi KB hiện tại buộc `tenant_id NOT NULL` + RLS).
- "Auto-update theo update của Plexco/club" cần **nguồn KB sinh ra từ hệ thống** (derived + scheduled), khác hẳn "host nạp tay".

⇒ Thêm **2 DD-track** trên nền hạ tầng đã có (ingest worker, hybrid retrieve, embedding_cache, pg-boss), **tái dùng** thay vì dựng song song. Có tiền lệ bảng global trong chính feature này: `embedding_cache` (hash→vec, không thuộc tenant) — nên plane global cho KB nền tảng nhất quán với thiết kế sẵn có.

---

## 2. Bám 5 HARD RULES

| HARD RULE / INV | Cách tuân thủ ở proposal này |
|---|---|
| **HR1 / INV-1 — RLS fail-closed** | KB-club vẫn `tenant_id NOT NULL` + RLS FORCE (không đổi). **KB-Plexco (`platform_kb_*`) là plane global RIÊNG** — bảng **không có** cột `tenant_id`. ⚠️ Lưu ý: thiếu `tenant_id` chỉ ngăn **routing/association**, **KHÔNG** tự ngăn nội dung tenant bị ingest **nhầm** vào `content` → chính sách là `platform_kb_*` **KHÔNG ĐƯỢC chứa** dữ liệu tenant (xem guard §3.1). Ghi chỉ bởi **process platform-admin**; role `app` chỉ `GRANT SELECT` (mô hình cô lập-bằng-grant như DD-12/`readonly`). Retrieve union **không** làm KB club A lộ sang B (đường global không mang dữ liệu tenant nếu guard giữ đúng; đường tenant vẫn dưới RLS). |
| **HR2 / INV-3 — tiền/PII không ra public** | `platform_kb_*` = **tài liệu sản phẩm Plexco** (non-PII, non-tenant) — không phải public projection của dữ liệu tenant, **tuyệt đối không** chứa roster/nợ/SĐT. **Auto-derive (DD-35)** chỉ lấy **field-whitelist mô tả** của club (tên, mô tả, luật, chính sách giá dạng text) — **CẤM** derive `charges`/`memberships`/`persons`/SĐT vào KB. Test bất biến bắt buộc. |
| **HR3 / INV-2 — không multi-master** | Auto-derive KB-club đi qua **command→outbox→projector**: canonical là nguồn sự thật, KB-derived là **read model dẫn xuất**. Không surface nào ghi KB thẳng. KB-Plexco cập nhật qua pipeline admin nền tảng (1 nguồn ghi). |
| **HR4 — claim-có-tiền cần khoá mạnh** | Không đổi. KB (global/derived) **không** thao tác tiền/merge. |
| **HR5 — i18n** | KB-Plexco lưu song ngữ (`lang`); trả lời bám ngôn ngữ câu hỏi + tone tenant (như DD-16). Fallback `t(vi,en)`. |
| **INV-6 / P8 — idempotency** | Derived + re-ingest dedupe theo `content_hash`; projector `(event_id, projector)`; derived source có **khoá xác định** theo aggregate canonical (1 aggregate → 1 derived source, upsert). |
| **P9 — provider ngoài txn** | Re-embed derived/re-crawl gọi provider **ngoài** txn (worker), như ingest hiện tại. |
| **P12 — reindex khi đổi model** | KB-Plexco + derived chunk cùng cơ chế `embed_model` + expand-backfill-contract khi đổi embedding model. |
| **P14 — bounded first** | Vẫn Postgres+pgvector; KB-Plexco nhỏ (1 tập tài liệu). Scheduled re-crawl bounded theo `sync_interval`. |

---

## 3. DD-34 — Plexco Global KB plane + union retrieval

### 3.1 Plane & bảng (SKETCH — chưa apply)

KB-Plexco là plane **GLOBAL read model** (giống nhóm `sports`/`persons` nằm ngoài RLS, nhưng đây là **nội dung** dùng chung, read-only cho tenant). Cấu trúc **mirror** `kb_*` nhưng **bỏ `tenant_id`**:

```sql
-- Nguồn tri thức nền tảng (do team Plexco quản). GLOBAL. KHÔNG có tenant_id.
CREATE TABLE platform_kb_sources (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind          text NOT NULL CHECK (kind IN ('faq','doc','pasted','url')),
  title         text NOT NULL,
  origin_ref    text,
  mime_type     text,
  storage_ref   text,
  content_hash  text NOT NULL,
  lang          text,
  status        text NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft','processing','active','error','archived')),
  -- freshness (DD-36):
  source_etag   text,
  last_synced_at timestamptz,
  next_sync_at   timestamptz,
  sync_interval  interval,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (content_hash)
);

CREATE TABLE platform_kb_documents ( -- mirror kb_documents, no tenant_id
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid NOT NULL REFERENCES platform_kb_sources(id),
  title text, lang text, content_text text NOT NULL,
  version integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE platform_kb_chunks (   -- mirror kb_chunks, no tenant_id
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES platform_kb_documents(id),
  chunk_index integer NOT NULL,
  content text NOT NULL, summary text, content_hash text NOT NULL,
  token_count integer, embed_model text NOT NULL,
  embedding vector(1536), summary_embedding vector(1536),
  fts_vector tsvector GENERATED ALWAYS AS (to_tsvector('simple', coalesce(content,''))) STORED,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_id, chunk_index)
);
CREATE INDEX idx_pkb_chunks_embedding ON platform_kb_chunks USING hnsw (embedding vector_cosine_ops);
CREATE INDEX idx_pkb_chunks_fts       ON platform_kb_chunks USING gin (fts_vector);
```

- **Grant/cô lập:** `platform_kb_*` **KHÔNG** vào list RLS `0009` (không có tenant). Thay vào đó: role `app` = **`GRANT SELECT` only**; ghi/ingest bởi **process/role platform-admin riêng** (tách như `readonly` ở DD-12). ⇒ không tenant nào sửa được KB nền tảng; đọc thì mọi tenant đọc chung.
- **Guard nội dung (vì SELECT dùng-chung mọi tenant):** thiếu `tenant_id` chỉ ngăn routing, **KHÔNG** ngăn nội dung tenant lọt vào `content`. Vì mọi tenant đọc chung, `platform_kb_*` **KHÔNG ĐƯỢC chứa** dữ liệu tenant/PII — cần **3 lớp**: (1) **source allowlist / platform-docs-only** — chỉ nhận tài liệu sản phẩm Plexco, từ chối nguồn của tenant; (2) **admin review** bắt buộc trước `status='active'`; (3) **scanner + test bất biến** quét `content`/`content_text` không chứa tenant identifier/PII (SĐT, email, `pay_code`, tên roster) — CI fail nếu dính. Ghi bởi role platform-admin, không phải host.
- Dùng lại `embedding_cache` (global sẵn có) cho cả platform + tenant chunk.

### 3.2 Union retrieval (mở rộng `searchKnowledgeBase`)

`searchKnowledgeBase(tenantCtx, query)` (hàm tổng quát đã chốt) mở rộng thành **2 nhánh hợp nhất**:

```
hybrid-retrieve trên kb_chunks WHERE tenant_id=$ctx    (RLS — KB-club)      → topN_tenant
hybrid-retrieve trên platform_kb_chunks                (global read — KB-Plexco) → topN_platform
MERGE (RRF) → gắn nhãn scope ∈ {club, platform} cho mỗi chunk
PRECEDENCE: khi trùng chủ đề, chunk 'club' **thắng** 'platform' (club override chính sách chung)  -- cấu hình bot_configs
→ top-k đưa vào prompt; citation ghi rõ nguồn (club vs Plexco)
```

- `min_similarity` áp cho **union** (gate no-answer chung).
- `bot_configs` thêm cờ (proposal): `include_platform_kb boolean DEFAULT true`, `platform_kb_weight real` (điều chỉnh nghiêng club/platform).
- **DD-34 = EXTENSION của DD-21 (không phải "nguyên vẹn"):** grounding vẫn **chỉ KB**, nhưng **allowed KB sources** mở từ `kb_chunks(tenant)` → `kb_chunks(tenant) ∪ platform_kb_chunks`. Không nối ledger/PII. Live-context (DD-28) vẫn tool riêng, không trộn. **Khi DD-34 ✅ phải patch DD-21** + bất biến "KB prompt = chỉ `kb_chunks`" ở `feature_club_assistant.md` (§Bất biến) + `BE/feature_club_assistant_tech.md` (§5) để phản ánh nguồn union — điều kiện promote, tránh mâu thuẫn spec.

### 3.3 Bất biến DD-34

1. Câu hỏi về Plexco → nhận được chunk `platform_kb` (không cần KB-club).
2. `platform_kb_*` **không** có cột `tenant_id` (test schema) **VÀ** scanner PII/tenant-id trên `content`/`content_text` = xanh (test bất biến) ⇒ `platform_kb_*` **không được chứa** dữ liệu tenant. (Thiếu `tenant_id` một mình chưa đủ — cần guard §3.1.)
3. Tenant A vẫn **không** nhận chunk KB-club của tenant B qua đường union (nhánh tenant dưới RLS; nhánh platform không mang dữ liệu tenant nếu guard §3.1 giữ đúng).
4. Role `app` không `INSERT/UPDATE/DELETE` được `platform_kb_*` (chỉ SELECT) — test grant.
5. Prompt KB (union) **không** chứa ledger/PII/secret (extension DD-21: nguồn = tenant ∪ platform, vẫn KB-only).

---

## 4. DD-35 — Auto-derive KB-club từ canonical

### 4.1 Ý tưởng

Khi **dữ liệu mô tả của club** trong canonical đổi (tên CLB, mô tả, luật/nội quy, chính sách giá dạng text, thông tin liên hệ/venue chung, chính sách hội viên), **projector tự sinh lại** một KB document dẫn xuất — host không phải nạp tay. Nguồn mới: `kb_sources.kind = 'derived'`.

```
Canonical đổi (vd tenant profile / pricing-policy text / club rules)
  → OUTBOX 'club.profile.changed' (aggregate_id, tenant_id — chỉ ID)
  → DERIVE PROJECTOR (tenant ctx, dưới RLS):
       build content_text từ FIELD-WHITELIST mô tả (KHÔNG PII/tiền)
       UPSERT kb_sources(kind='derived', derive_key=<aggregate>, content_hash)   -- 1 aggregate : 1 derived source
       nếu content_hash đổi → INSERT/refresh kb_documents(version+1) + enqueue re-embed
  → INGEST WORKER (ngoài txn, như hiện tại): chunk + embed → kb_chunks
```

### 4.2 Ranh giới (giữ HR2 / DD-21 / DD-28)

- **CHỈ derive field-whitelist mô tả tĩnh:** tên/mô tả CLB, nội quy, chính sách giá **dạng text mô tả** (vd "vé lẻ 50k, hội viên tháng 300k"), lịch sinh hoạt **khung chung** (vd "Tối T3–T5 19h–21h"), hướng dẫn tham gia. Danh sách whitelist chốt ở tech spec.
- **CẤM derive:** roster/thành viên, nợ/`charges`, SĐT/email/`persons`, `pay_code`, số dư — **không bao giờ** vào KB (HR2/DD-21). Test bất biến.
- **KHÔNG derive dữ liệu vận hành realtime** (slot buổi cụ thể còn mấy chỗ, ai đã join) — cái đó là **DD-28 live-context tool**, không phải KB. Derived KB = tri thức **ổn định/mô tả**; live-context = trạng thái **thời điểm**.
- **Precedence vs host-manual:** nếu host tự nạp nguồn đè cùng chủ đề, chốt quy tắc (đề xuất: host-manual > derived; derived đánh dấu `source_provenance='derived'` để host thấy và có thể tắt từng mảng).

### 4.3 Bất biến DD-35

1. Đổi field canonical whitelist → KB-derived tự cập nhật (không cần host thao tác).
2. Không đổi nội dung (content_hash trùng) → không re-embed (idempotent, tiết kiệm cost).
3. Derived KB doc **không** chứa ledger/PII/roster (assert content_text ⊆ whitelist).
4. Derive đi qua outbox→projector (không ghi KB thẳng từ handler canonical) — HR3.
5. Xoá/không-đủ-điều-kiện → derived source archived, chunk ngừng retrieve (không mồ côi).

---

## 5. DD-36 — Freshness / scheduled re-ingest

### 5.1 Hai đường "tự cập nhật theo update"

- **KB-Plexco (nền tảng):** khi team Plexco đổi tài liệu/FAQ sản phẩm → pipeline admin re-ingest; change-detect bằng `platform_kb_sources.content_hash`. (Có thể nguồn từ `docs/`/CMS — chốt nguồn ở tech spec.) Đây là "update theo update của **Plexco**".
- **Nguồn URL (`kind='url'`, cả tenant lẫn platform):** **scheduled re-crawl** bằng **pg-boss cron** — refetch → so `source_etag`/`content_hash` → chỉ re-ingest khi đổi. Trường: `last_synced_at`, `next_sync_at`, `sync_interval`, `source_etag`.

### 5.2 Nguyên tắc

- **Idempotent (INV-6):** re-ingest chỉ tạo chunk mới khi hash đổi; trùng → no-op.
- **P9:** fetch + embed ngoài txn; cập nhật canonical/read-model trong txn ngắn.
- **P12:** đổi embedding model → expand-backfill-contract cho cả `kb_chunks` + `platform_kb_chunks`.
- **Observability (P15):** metric staleness (nguồn quá hạn `next_sync_at`), tỉ lệ re-ingest fail, DLQ crawl. Nguồn URL lỗi lặp → cảnh báo admin/host, **không** phá KB đang active (giữ bản cũ).
- **Bounded (P14):** `sync_interval` mặc định theo `kind` (vd URL 24h); tránh crawl bão hoà.

### 5.3 Bất biến DD-36

1. Re-crawl nguồn không đổi → **không** tạo chunk lặp / không re-embed.
2. Nguồn URL fail khi re-crawl → giữ KB active cũ, đánh dấu `status='error'`, cảnh báo — không mất KB.
3. Nội dung Plexco đổi → KB-Plexco phản ánh sau re-ingest (content_hash mới).
4. Không giữ lock DB khi gọi provider fetch/embed (P9).

---

## 6. Entitlement / pricing

- Trợ lý (bao gồm union KB-Plexco + auto-derive) thuộc **Host Pro** (DD-29/DD-22) — không thêm bảng billing.
- **KB-Plexco (đọc)** rẻ và dùng chung → có thể cho **cả free-tier** đọc phần "hỏi về Plexco" nếu muốn giảm ma sát hỗ trợ (chốt ở DD-22/DD-29 khi promote billing). **Auto-derive + re-crawl** (tốn embed) giữ trong **Host Pro**.
- Cap câu hỏi/tháng vẫn theo `bot_configs.monthly_question_cap` (DD-22).

---

## 7. Test bất biến bắt buộc (bổ sung cho §10 proposal gốc)

Kế thừa 8 test proposal gốc, **thêm**:

9. Câu hỏi nền tảng → có chunk `platform_kb`; câu hỏi club-specific → ưu tiên chunk `club` (precedence).
10. `platform_kb_*` không có cột `tenant_id`; role `app` chỉ SELECT (không ghi được); **scanner PII/tenant-id trên `content`/`content_text` = xanh** (guard §3.1).
11. Union retrieve: tenant A **không** nhận KB-club của B; platform chunk giống nhau cho mọi tenant.
12. Derived KB doc **không** chứa ledger/PII/roster/pay_code (assert ⊆ whitelist).
13. Đổi field canonical whitelist → derived KB cập nhật; đổi field non-whitelist (tiền/PII) → KB **không** đổi.
14. Re-crawl/re-ingest nội dung trùng hash → 0 chunk mới (idempotent).
15. Prompt KB union vẫn **chỉ** chứa kb_chunks(tenant) ∪ platform_kb_chunks — không ledger/PII/live-context (giữ DD-21/DD-28).

---

## 8. Inventory bằng chứng và decision gap — không phải readiness verdict

Tài liệu Draft này chưa có implementation slice/manifest, nên phần dưới chỉ kiểm kê nội dung đã mô tả và khoảng trống cần owner/spec xử lý; không tổng hợp trạng thái, không quy đổi tỷ lệ và không authorize worktree.

**Bằng chứng thiết kế đã có trong proposal:**

- Plane + isolation KB-Plexco (§3.1): global, grant-isolated theo mô hình DD-12, với ba lớp content guard.
- Union retrieval, precedence và citation scope (§3.2).
- Field-whitelist derive và ranh giới DD-28/DD-21 (§4.2).
- Freshness fields + scheduled-job proposal (§5).
- Idempotency/P9/P12 (§4–§5), entitlement (§6) và invariant-test inventory (§7).

**Decision/spec gap phải đóng trước khi author slice:**

- Owner ratify DD-34/35/36.
- Sau DD-34 final, patch DD-21 + Club Assistant Product/BE để mở nguồn prompt từ tenant `kb_chunks` sang union được phép; không sửa trước decision.
- Chọn nguồn KB-Plexco canonical (`docs` hay CMS).
- Enumerate exact canonical field whitelist cho derived KB trong BE spec.
- Chốt precedence host-manual vs derived và UX bật/tắt từng mảng.
- Author exact slice/manifest rồi mới áp review-readiness gate trên immutable authority SHA.

⇒ Sau khi DD-34/35/36 ✅: patch rồi review/promote delta cho Club Assistant Product/BE pair (thêm plane platform + kind `derived` + freshness), sau đó mới tạo migration mới `00xx_platform_kb.sql` với explicit global grant/revoke + `schema.ts`. Extension phải tái dùng canonical generation/CAS index-activation và active-generation retrieval owners của base Assistant plan, không dựng ingest/index/provider pipeline song song. `platform_kb_*` không dùng tenant RLS vì global, nhưng migration mới vẫn phải tự chứa security grants; không sửa `0009` đã apply.

---

## 9. Câu hỏi mở → DD

| DD | Nội dung | Trạng thái |
|---|---|---|
| DD-34 | Plexco Global KB plane (global read-only, non-PII) + union retrieval club∪platform | 🟡 đề xuất |
| DD-35 | Auto-derive KB-club từ canonical (projector, field-whitelist, tách DD-28) | 🟡 đề xuất |
| DD-36 | Freshness: scheduled re-crawl URL + re-ingest KB-Plexco (content_hash change-detect) | 🟡 đề xuất |

Chi tiết ở `standards/decisions.md`.

---

## Changelog

| Ngày | Version | Thay đổi |
|------|---------|----------|
| 28/07/2026 | v0.4 | Reconcile dependency status: Club Assistant Product/BE pair v0.17 đã Reviewed; DD-34/35/36 vẫn là extension Draft riêng, không hạ base pair và không authorize runtime. Chuyển scored DoR cũ thành evidence/decision-gap inventory vì chưa có slice/manifest để chấm trạng thái tổng hợp. |
| 17/07/2026 | v0.3 | Reconcile dependency về Club Assistant v0.9 Draft; DD-34/35/36 không tự promote base pair; mọi global-KB grants nằm trong migration mới self-contained, không sửa `0009` lịch sử. |
| 06/07/2026 | v0.1 | Khởi tạo: mở rộng Club Assistant với KB-Plexco toàn nền tảng (DD-34), auto-derive KB-club từ canonical (DD-35), freshness/scheduled re-ingest (DD-36). Giữ nguyên DD-21/DD-28/HR2. |
| 06/07/2026 | v0.2 | Review fixes: **DD-34 = extension của DD-21** (không "nguyên vẹn") — mở allowed KB sources sang `platform_kb`, patch DD-21 + Club Assistant specs khi ✅ (§0/§3.2/§3.3); soften "không thể chứa" → "**không được chứa**" + thêm **guard 3 lớp** platform-KB (source allowlist/platform-docs-only, admin review, scanner+test PII) ở §2/§3.1/§3.3. |
