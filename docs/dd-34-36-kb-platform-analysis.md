# 📚 DD-34/35/36 Analysis — KB platform + auto-sync (Club Assistant P7)

> **Mục đích:** chốt HƯỚNG (approve-in-principle) cho global KB plane + auto-derive + freshness. **P7 post-MVP**, chi tiết + patch DD-21 khi build.
> **Ngày:** 2026-07-13 · **Canonical:** `proposals/plexco-global-kb-and-kb-autosync.md` §3/§4/§5 · DD-16..28 (assistant ✅) · DD-21 (grounding KB-only) · DD-28 (live-context tách KB) · `0009` (grant-isolation như DD-12/`readonly`). Ghi → `decisions.md` DD-34/35/36.

---

## 0. TL;DR — 🟡 Approve-in-principle P7 (owner)
- **DD-34 — Global KB plane:** bảng **`platform_kb_*`** (sources/documents/chunks), **KHÔNG `tenant_id`**, do process **platform-admin** ghi, role `app` chỉ **`GRANT SELECT`** (cô lập-bằng-grant như DD-12/`readonly`, KHÔNG vào RLS list `0009`). Retrieval **union** `kb_chunks(tenant)` ∪ `platform_kb_chunks`, RRF, precedence **club > platform**.
- **DD-35 — Auto-derive KB-club:** `kb_sources.kind='derived'`; field mô tả canonical đổi → **command→outbox→projector** (HR3) dựng lại KB doc từ **field-whitelist**; idempotent `content_hash`; precedence host-manual > derived.
- **DD-36 — Freshness:** re-ingest KB-Plexco khi đổi tài liệu (change-detect `content_hash`); nguồn `kind='url'` **scheduled re-crawl** bằng pg-boss cron (so `source_etag`/`content_hash`, chỉ re-ingest khi đổi).
- **Điều kiện promote (khi ✅ P7):** **patch DD-21** + Club Assistant specs (nguồn grounding = union) — không để DD-21 mâu thuẫn.

---

## 1. Canonical hiện trạng
| Sự thật | Nguồn |
|---|---|
| DD-21: grounding **chỉ KB `kb_chunks(tenant)`**; không ledger/PII (HR2) | DD-21 |
| DD-28: live-context (vận hành non-PII) **tách khỏi** KB-RAG | DD-28 |
| Grant-isolation pattern (bảng non-tenant, role SELECT-only, không RLS) = DD-12/`readonly`/`public_sessions` | `0009` · DD-12 |
| `embedding_cache` = tiền lệ bảng global trong feature | proposal |
| Assistant = P7 post-MVP | DD-16 |

---

## 2. DD-34 — Global KB plane (contract + guards)
- **Schema:** `platform_kb_sources/documents/chunks` — **no `tenant_id`**; role `app` **SELECT only**; ghi bởi role **platform-admin**. **KHÔNG** vào RLS list `0009` (như `public_sessions`).
- **Union retrieval:** `searchKnowledgeBase(tenantCtx, query)` = `kb_chunks WHERE tenant (RLS)` ∪ `platform_kb_chunks (global)`, hợp nhất **RRF**, gắn nhãn scope; **precedence club > platform** (`bot_configs.include_platform_kb`/`platform_kb_weight`).
- **Guards (bảng SELECT-mọi-tenant → phải chặt):** thiếu `tenant_id` chỉ ngăn routing, **KHÔNG** tự ngăn ingest nhầm tenant-data. ⇒ (1) **source allowlist** — chỉ ingest platform-docs-only; (2) **admin review** trước `status='active'`; (3) **scanner + test bất biến** assert `content` không chứa tenant identifier/PII (SĐT/email/`pay_code`/tên roster).
- **Quan hệ DD-21 (extension):** mở **allowed KB sources** từ `kb_chunks(tenant)` → `∪ platform_kb_chunks`; grounding vẫn **chỉ KB**; live-context (DD-28) vẫn tách. Patch DD-21 khi ✅.

## 3. DD-35 — Auto-derive KB-club (contract + ranh giới)
- `kb_sources.kind='derived'`; 1 aggregate canonical : 1 derived source (upsert theo `derive_key`), idempotent `content_hash`.
- **Field-whitelist mô tả:** tên/mô tả CLB, nội quy, chính sách giá dạng text, khung lịch, hướng dẫn tham gia.
- **CẤM derive:** `charges`/`memberships`/`persons`/SĐT/`pay_code`/số dư (HR2). **KHÔNG** derive dữ liệu vận hành realtime (slot/ai-join = **DD-28 live-context**, không phải KB).
- Precedence **host-manual > derived** (host tắt được từng mảng derived). Qua **outbox** (không ghi KB thẳng — HR3).

## 4. DD-36 — Freshness (contract)
- **KB-Plexco** re-ingest khi team Plexco đổi tài liệu (change-detect `platform_kb_sources.content_hash`).
- **`kind='url'`** (tenant + platform): **scheduled re-crawl** pg-boss cron → refetch → so `source_etag`/`content_hash` → chỉ re-ingest khi đổi. Field freshness: `last_synced_at`/`next_sync_at`/`sync_interval`/`source_etag`.
- **Fail-closed:** URL fail khi re-crawl → giữ KB active cũ + `status='error'` + cảnh báo (không phá KB). Metric staleness/DLQ (P15). Provider ngoài txn (P9); đổi model → reindex P12.

## 5. Invariants (test bất biến khi build)
- `platform_kb_*` **không `tenant_id`**; role `app` **không ghi** được; **scanner PII/tenant-id trên `content` = xanh**; union **không rò** KB club A↔B; câu hỏi nền tảng nhận chunk platform.
- derived doc ⊆ whitelist (không ledger/PII); đổi field non-whitelist → KB không đổi; derive qua outbox.
- URL re-crawl idempotent (`content_hash`), fail-closed giữ KB cũ.

## 6. Dependencies + phase
- **DD-21** (patch khi ✅), **DD-28** (live-context tách), **DD-17** (pgvector), **DD-18** (provider — go-live gate), `0009` (grant-isolation).
- **P7 post-MVP** — approve-in-principle; SQL/tests + patch DD-21 khi build.

## 7. Propagation (khi build P7)
`proposals/plexco-global-kb-and-kb-autosync.md` → `feature_club_assistant(.md/_tech)` (union retrieval + derived + freshness) + **patch DD-21** + migration `platform_kb_*`/`kb_sources.kind` + `0009` grant (SELECT-only, không RLS list) + scanner/invariant tests.

## 8. Quyết định (approve-in-principle P7)
DD-34 global KB plane grant-isolated + union RRF + guards; DD-35 auto-derive whitelist qua outbox, cấm ledger/PII; DD-36 freshness cron change-detect fail-closed. **Chi tiết + patch DD-21 khi build P7.** Ghi `decisions.md` DD-34/35/36 🟡 approve-in-principle.

**Nguồn:** `proposals/plexco-global-kb-and-kb-autosync.md` §3/§4/§5 · DD-21/28/17/18 · `0009`/DD-12.
