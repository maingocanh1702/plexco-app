# Deployment & Infrastructure — Plexco

> **Version:** v1.3 · 2026-06-20
> **Status:** Draft (chờ review)
> **Scope:** Cách deploy Plexco tối ưu/hiệu quả/dễ maintain, kèm scalability & security ở tầng hạ tầng.
> **References:** `../core/TDD.md` §3.4/§7/§8 · `../appendices/saas-implementation-plan.md` §4/§5/§7 · `../appendices/player-side-saas-AUDIT.md` (C1–C8b · B1–B6 · G1–G6) · `../features/BE/feature_security_operations_tech.md`
> **Đề xuất kỹ thuật cho:** DD-04 (Postgres host) · DD-07 (realtime) · DD-10 (web stack) — xem §2. **Trạng thái chốt là canonical tại `decisions.md`**, file này chỉ cung cấp phân tích/đề xuất; không tự "chốt" độc lập.

---

## 0. TL;DR

Deploy Plexco như **một modular monolith container-hoá**: **1 Docker image → 3 process group** (`web` · `discovery` · `worker`) cùng codebase, khác entrypoint/DB-role. Chạy trên **container PaaS** (Fly.io hoặc Railway) ở **region Singapore**, dùng **managed Postgres HA + PITR** (Neon hoặc Supabase). Queue/cron nằm trên Postgres qua **pg-boss** (không Redis/Kafka). Realtime = **SSE fan-out qua Postgres `LISTEN/NOTIFY`** (không cần message broker).

**KHÔNG:** Kubernetes · tách microservices · serverless function cho worker/webhook/SSE · Redis cho queue.

Triết lý xuyên suốt: *PostgreSQL + domain model là canonical store; mọi surface là projection*. Deployment chỉ được phép **bảo toàn** bất biến đó, không tạo nguồn sự thật thứ hai.

---

## 1. Mục tiêu & ràng buộc

| Nhóm | Ràng buộc | Nguồn |
|---|---|---|
| **SLO** | Availability ≥ 99.5%/tháng · reconcile p99 ≤ 5s · sync lag p95 ≤ 3s, p99 ≤ 10s | security-operations-tech §3 |
| **Tải mục tiêu** | ≥ 1k tenant đồng thời · webhook burst 100/s · 10k discovery search đồng thời · join contention 100 player/1 slot → đúng 1 winner | security-operations-tech §5 |
| **Region** | Người dùng + provider (SePay/Telegram/Zalo) ở **VN** → ưu tiên độ trễ thấp | BRD §Bên thứ ba |
| **Chi phí** | Thuê bao host **0đ (free) / 250k (host_pro) mỗi CLB/tháng** (DD-29 thay DD-03) → margin nhạy, infra phải rẻ ở giai đoạn đầu | BRD §9.1 · DD-29 |
| **Vận hành** | Team nhỏ → tối ưu **dễ maintain**, ít moving parts | mục tiêu user |
| **Bản chất hệ thống** | Hệ thống **tiền + multi-tenant RLS** → bắt buộc HA, PITR, least-privilege | TDD §10 · AUDIT |

**Nguyên tắc dẫn xuất:** vì là hệ tiền/đa-tenant nhưng team nhỏ và chi phí nhạy, ta chọn **kiến trúc đơn giản nhất *vẫn còn đúng*** — monolith container-hoá thay vì microservices/k8s — và đẩy phần "khó" (HA, PITR, pooling) sang **managed services**.

---

## 2. Quyết định kiến trúc (đề xuất → chốt tại `decisions.md`)

> Mục này là **phân tích/đề xuất**. Mỗi quyết định cuối cùng (chốt/đang mở) được ghi ở `decisions.md`; khi đọc, lấy trạng thái từ đó.

### DD-04 (OD-4) — Postgres hosting · 🟡 đã thu hẹp

**Đã chốt:** Managed Postgres có **HA + PITR**, **region Singapore (ap-southeast-1)**.
**Còn lại:** chọn provider giữa **Neon** vs **Supabase** (đề xuất bên dưới).

| Option | Ưu | Nhược | Ghi chú |
|---|---|---|---|
| **Supabase** (Pro) | "Sinh ra để dùng RLS", hợp triết lý fail-closed; PITR + connection pooler (Supavisor) sẵn; có region Singapore | Một số tính năng platform thừa (auth) — ta không dùng | Khuyến nghị nếu ưu tiên RLS-native + đơn giản |
| **Neon** | Branching DB rất hợp **CI migration gate** (fresh/upgrade/rollback); pooler sẵn; Singapore | Scale-to-zero **xung đột** với worker pg-boss (xem ⚠️) | Khuyến nghị nếu coi trọng CI branching |
| Railway PG | Cùng platform với app, DX đơn giản | PITR/HA yếu hơn cho hệ tiền | Chỉ dùng cho dev/staging |

> ⚠️ **pg-boss cần connection DIRECT (session-mode)** cho `LISTEN/NOTIFY` + advisory lock, và **poll liên tục**. Nếu dùng Neon: worker phải cắm **non-pooled connection string** và **tắt autosuspend** (worker giữ DB luôn thức → mất lợi ích serverless). Web/discovery request path dùng **pooled** (transaction-mode); riêng web SSE listener dùng `DATABASE_URL_LISTEN` session/direct như DD-07.

**Hệ quả:** RPO/RTO cụ thể chốt sau khi chọn provider; phải có **restore drill** định kỳ (security-operations-tech §4).

### DD-07 (OD-7) — Realtime web · ✅ chốt

**Quyết định:** **SSE** (Server-Sent Events) làm baseline, fan-out qua **Postgres `LISTEN/NOTIFY`**.

- Lý do: 1 chiều server→client là đủ cho dashboard/roster update; SSE nhẹ, qua HTTP thường, không cần nâng cấp WebSocket.
- Scale ngang: mỗi `web` replica `LISTEN` trên Postgres; `worker` `NOTIFY` sau khi projector chạy → mọi replica nhận và đẩy ra đúng client (`tenant:<id>` cho host, `person:<id>` cho player). **Không cần Redis/broker.**
- Hệ quả: cần size memory mỗi instance theo số SSE connection mở; tier thấp có thể fallback polling.

> ⚠️ **Connection cho `LISTEN`:** transaction-mode pooler (PgBouncer/Supavisor) **không** hỗ trợ `LISTEN/NOTIFY` (connection bị multiplex giữa các txn). Vì vậy listener SSE ở `web` phải dùng **một session/direct connection riêng** — biến `DATABASE_URL_LISTEN` — **một connection cố định mỗi `web` replica** chỉ để `LISTEN`, tách hoàn toàn khỏi pool phục vụ request (vẫn là `DATABASE_URL` pooled txn-mode). Đây là connection chỉ-LISTEN, không chạy query nghiệp vụ.

### DD-10 (OD-10) — Web stack · 🟡 đã thu hẹp

**Đã chốt:** web chạy **trong cùng container/monolith** (không tách lên Vercel).
**Còn lại:** **Express SSR** vs **Next.js standalone/custom-server** (đề xuất bên dưới).

- Lý do: giữ web + bot + worker trong **một image, một platform** → dễ maintain nhất cho monolith.
- **Tránh:** đẩy web lên Vercel rồi để bot/worker chỗ khác. Việc đó cắt đôi monolith, làm **SSE (long-lived), webhook durable-ingest, và pg-boss** khó sống trên serverless, đồng thời tăng đầu mối vận hành.
- Contract API/DTO không đổi dù chọn stack nào (web-app/README §1.1).

---

## 3. Topology

```
                       Internet (VN)
                            │
              ┌─────────────▼──────────────┐  Cloudflare (edge)
              │  WAF · CDN cache · TLS/HSTS │  rate-limit · DDoS shield
              │  → chắn G6 (Discovery DDoS) │  → chắn C8 (anti-scrape), G3 (admin)
              └─────────────┬──────────────┘
                            │  private network (DB KHÔNG expose public)
        ┌───────────────────┼─────────────────────────────────┐
        │                   │                                  │
 ┌──────▼────────┐   ┌──────▼─────────┐               ┌────────▼──────────┐
 │ PROCESS: web   │   │ PROCESS:        │               │ PROCESS: worker    │
 │ Express/Next   │   │ discovery (RO)  │               │ pg-boss scheduler  │
 │ dashboard+API  │   │ GET /discover   │               │ dispatcher         │
 │ +SSE +webhook  │   │ public view only│               │ projectors         │
 │ (TG/Zalo/SePay/│   │ +cache          │               │ cron (remind…)     │
 │ ApiPay)        │   │                 │               │ (no HTTP ingress)  │
 │ port 3000      │   │                 │               │                    │
 └──────┬─────────┘   └──────┬──────────┘               └────────┬───────────┘
        │ role=app           │ role=readonly                     │ role=app_worker
        │ pooled (txn)       │ pooled (txn, replica)             │ DIRECT (session)
        ▼                    ▼                                   ▼
 ┌────────────────────────────────────┐         ┌──────────────────────────────┐
 │  Postgres PRIMARY (HA + PITR)       │────────▶│  Read replica                 │
 │  RLS fail-closed · writes · money   │  stream │  discovery + player-view reads│
 │  pg-boss queue/cron · outbox        │         │  (offload hot public reads)   │
 └────────────────────────────────────┘         └──────────────────────────────┘
        │
        └── KMS / Secret manager (bot_token_enc, webhook_secret_enc, session keys)
```

**Nguyên tắc "1 image, nhiều process group":** cùng artifact build ra, khác `ENTRYPOINT` và **khác DB role**. Đây là cách tôn trọng yêu cầu tách `app` / `app_worker` của TDD §3.4 mà **không** đẻ ra microservices (tránh đồng bộ schema/event giữa nhiều repo — gánh nặng maintain lớn nhất ở giai đoạn này).

Ví von: **một căn bếp, nhiều ca làm** — cùng công thức (image), một ca tiếp khách (`web`), một ca phục vụ thực đơn công khai (`discovery`), một ca hậu cần (`worker`). Khác hẳn xây nhiều nhà hàng riêng (microservices).

---

## 4. Process model & DB role

| Process | Vai trò | DB role | Connection | Ingress | Scale |
|---|---|---|---|---|---|
| **web** | dashboard, API, SSE, **mọi webhook** (TG/Zalo/SePay/ApiPay) | `app` (NOSUPERUSER NOBYPASSRLS) | **pooled** (txn) cho request + **1 direct (session)** cho SSE `LISTEN` (`DATABASE_URL_LISTEN`) | HTTP :3000 | ngang, N replica, autoscale CPU/RPS |
| **discovery** | chỉ `GET /discover` (cross-tenant, đọc **projection công khai**) | `readonly` (**chỉ SELECT trên `public_sessions` + public view**) | **pooled** trên **read replica** | HTTP (route con) | ngang + CDN cache |
| **worker** | pg-boss scheduler/dispatcher, projectors, cron nhắc nợ | `app_worker` (chỉ narrow functions) | **DIRECT** (session-mode) | **không** ingress | 1 → vài replica (claim `SKIP LOCKED`) |

> **Vì sao tách `discovery` ra process riêng** (dù cùng image): đây là đường đọc *cố ý cross-tenant*, *không PII*, và *chịu DDoS cao nhất* (G6). Tách ra cho phép gắn **read replica + CDN cache + rate-limit policy riêng**, cô lập hoàn toàn khỏi đường tiền/ghi trên primary. Nếu sau này phải "tách 1 thứ" thành service thật, đây là ứng viên duy nhất hợp lý.

> 🔒 **"Cross-tenant không qua RLS" KHÔNG có nghĩa bypass cô lập.** Role `readonly` **chỉ được `GRANT SELECT` trên các object projection công khai** (`public_sessions` và public view do projector sinh — xem DD-12), và **zero grant** trên mọi bảng canonical chứa tiền/PII (`charges`, `bank_transactions`, `allocations`, `memberships`, `person`…). Bất biến cô lập tenant vẫn được giữ ở **tầng quyền** (least-privilege), không phải ở RLS — vì bảng `public_sessions` theo thiết kế **không chứa** dữ liệu tenant-private nên không cần RLS để bảo vệ. Phải có **test gate** khẳng định `readonly` không đọc được bảng canonical (CI §7 — "public-projection invariant").

**Webhook nằm ở `web` (không phải `worker`)** vì cần durable-ingest đồng bộ: verify timing-safe → lưu raw → enqueue pg-boss → **ACK 200 chỉ sau khi commit** (BL-PAY-1; AUDIT BL-1; TDD §3.6). Worker mới là nơi xử lý job sau đó.

---

## 5. Scalability

Thiết kế đã scale tốt (stateless API, single DB, no multi-master). Việc của deploy là **không phá** điều đó. Nút thắt thực sự **không** phải web tier (cứ thêm replica) mà là **Postgres đơn**. Bốn đòn bẩy theo thứ tự ưu tiên:

### 5.1 Connection pooling — chi tiết deploy quan trọng nhất
N web replica × pool → **bùng nổ connection**, giết Postgres trước cả khi CPU cao.
- `app` / `readonly` (request path) → **PgBouncer/Supavisor transaction-mode**.
- `app_worker` (pg-boss) → **DIRECT/session-mode** (cần `LISTEN/NOTIFY` + advisory lock).
- **SSE listener trong `web`** → **DIRECT/session-mode** riêng (txn-mode pooler không cho `LISTEN`). Một connection cố định/replica, chỉ `LISTEN`.
- ⇒ **ba connection string**: `DATABASE_URL` (pooled, request) · `DATABASE_URL_LISTEN` (session, SSE listener ở web) · `DATABASE_URL_DIRECT` (session, worker pg-boss).
- 💡 Tổng connection session-mode = (số web replica × 1) + (số worker replica × pool worker). Tính vào trần connection của Postgres khi sizing.

### 5.2 Read replica cho đường đọc public
Discovery (10k search đồng thời) + player-view reads → đẩy sang **replica + CDN cache** (response không PII nên cache được, TTL ngắn). Tách khỏi primary để đường tiền/ghi không bị đường đọc làm nghẽn.

> ⚠️ **Consistency replica ⇄ SSE (read-your-writes).** Replica trễ so với primary; `worker` có thể `NOTIFY` trước khi replica bắt kịp → client nhận event SSE rồi đọc lại **dữ liệu cũ** nếu đọc từ replica. Quy tắc bắt buộc:
> 1. **Authenticated post-write reads → đọc PRIMARY** (host dashboard/roster sau khi vừa mutate). Đây là đường nhạy nhất; read-your-writes phải đúng tuyệt đối.
> 2. **Public/discovery reads** chấp nhận replica lag (đã có CDN TTL ngắn) — không cần read-your-writes; chỉ cần eventual.
> 3. Nếu muốn vẫn dùng replica cho post-write read: dùng **LSN wait** (đọc với `wait_for_lsn` của commit vừa rồi) hoặc trả **staleness header** để client biết tự retry. Mặc định ưu tiên (1) cho đơn giản & đúng.
> 4. Payload `NOTIFY` nên mang **chỉ id + version/LSN** (không mang state), để client luôn fetch lại bản chuẩn — tránh đẩy state cũ qua chính event.

### 5.3 Worker scale an toàn nhờ `FOR UPDATE SKIP LOCKED`
pg-boss claim job atomic → chạy được **nhiều worker replica** không trùng. Bắt đầu 1, tăng dần.
- Cron nhắc nợ 1k club cùng giờ đụng trần **Telegram ~30 msg/s global, 1 msg/s mỗi chat** → giữ **throttler (`@grammyjs/transformer-throttler`) + jitter**, rải batch theo tenant (saas §5.3).
- Zalo BYO 1 bot/club ⇒ **phân tán tải gửi** (free-at-scale), không dồn vào 1 bot.

### 5.4 Vertical trước, shard sau (gần như không cần)
Ở ≥1k tenant: **scale primary lên + thêm replica** là đủ.
- Bảng churn cao (`outbox_events`, `bank_transactions`, audit): index theo `tenant_id`+time; **dọn `outbox` đã deliver**; partition theo thời gian khi lớn.
- Nếu *rất xa* sau này mới cần shard → mọi thứ đã key theo `tenant_id`, shard theo đó là tự nhiên. Coi là việc tương lai, không làm sớm.

### 5.5 Trần scale ngoài tầm kiểm soát
Telegram/Zalo rate-limit là **trần scale ngoại sinh** → giải quyết bằng throttler + queue + jitter, không phải bằng thêm máy.

---

## 6. Security — tầng hạ tầng cho code-level controls không bị bypass

RLS, repo choke-point, field-whitelist nằm ở **code**. Deploy phải thêm lớp **infra** để các control đó *không thể vòng qua*. Map thẳng vào threat model:

| Threat (doc) | Deploy control (hạ tầng) |
|---|---|
| **C7 / edge#11** blast-radius secret · migration cred lọt prod | **4 DB role tách ở connection level**: `migration` (chỉ CI job, *KHÔNG BAO GIỜ* trong runtime) · `app` (NOSUPERUSER NOBYPASSRLS) · `app_worker` (narrow functions) · `readonly`. Runtime prod **không mang** superuser/migration cred. |
| **C7 / B2** token lộ | Secret manager + **KMS envelope** (`bot_token_enc`/`webhook_secret_enc`); không bake vào image/log; **rotation + kill-switch runbook**; job `getWebhookInfo`-drift. Token Zalo lộ = 1 club messaging, không chạm tiền/DB. |
| **C8 / G6** rò public · scrape · DDoS discovery | Role `readonly` **chỉ SELECT trên `public_sessions`/public view, zero grant bảng canonical tiền/PII** (least-privilege, không phụ thuộc RLS); Discovery qua **replica + CDN cache + rate-limit + WAF**; per-IP/per-token throttle; phân trang; `venue` ẩn tới khi join; không lộ `tenant_id`. |
| **G3 / G1** admin mutation chưa rate-limit · đổi STK | WAF rule + rate-limit riêng cho mutation/auth; STK-change confirmation delay (service) + **audit** (infra). |
| **B3 / edge#1** webhook giả | timing-safe verify ×3 (code) + **body-size cap + per-token rate-limit** (edge); lưu raw trước ACK. |
| **B5** cron privileged cross-tenant | `app_worker` chỉ gọi narrow function (`claim_outbox_batch`, `list_due_tenant_jobs`); mọi privileged call **ghi audit** (`job_id`,`tenant_id`,actor=system). |
| **edge#12 / G4** log chứa PII · audit retention | Structured log **gắn `tenant_id`, KHÔNG secret/OTP/STK/SĐT/email/body**; audit append-only, retention định nghĩa; SLO alert → on-call + runbook. |
| **edge#8** mất DB/region | **Managed PITR + restore drill** định kỳ; backup mã hoá; RPO/RTO chốt sau OD-4. |
| **G5** PDPA/GDPR | Quy trình export/delete data-subject + ToS/Privacy/retention (P6; tooling là việc deploy). |
| **C6 / G2** player-view auth · session steal | session key auto-rotate (30d) + kill-switch invalidate-all (security-operations-tech §4); `person_id` suy từ phiên verify, không từ tham số. |

**Hai nguyên tắc mạng then chốt:**
1. **Postgres KHÔNG bao giờ expose public** — private networking/VPC giữa app PaaS và DB + IP allowlist (Fly private networking / Supabase network restrictions).
2. **CDN/WAF đứng trước mọi thứ** — vừa chắn DDoS (G6) vừa là chỗ đặt rate-limit tập trung.

---

## 7. CI/CD & release gate

CI/CD **chính là security gate** — nơi C1–C8 "must-fix before code" được thực thi liên tục, không chỉ review một lần.

```
push → build immutable image (signed) → CI gates → deploy staging → promote prod
```

**Gate bắt buộc xanh trước khi promote** (security-operations-tech §4):
1. Unit/integration/E2E + **RLS / public-projection / person-self / ledger invariants**
2. Migration fresh / upgrade / rollback-forward
3. Dependency / license / **secret scan** / SAST / container scan
4. **DAST** trên staging
5. Event/schema compatibility
6. Load/soak: webhook burst, discovery, final-slot contention, queue recovery
7. **Manual security approval** cho: auth · money · identity · public projection · privileged DB

**Deployment strategy:** immutable artifact staging→prod · migration là controlled job (không rollback irreversible) · canary/feature-flag cho adapter rủi ro · health/readiness check + tiêu chí auto-rollback · projector/worker hỗ trợ mixed event version trong lúc rollout.

---

## 8. Backup/DR & Observability

**Backup/DR:** Managed HA + PITR, backup mã hoá. **Restore drill:** DB cô lập → apply roles/policies → checksum schema → đối chiếu count (tenants, charges, transactions, allocations, outbox, audit). RPO/RTO chốt sau OD-4.

**Observability:** structured log gắn opaque `tenant_id`/`job_id` (không secret/PII) → metrics → traces → **SLO alert** (sync lag, reconcile p99, availability) → on-call + runbook link. Sentry cho error tracking (TDD §7).

**Runbook bắt buộc:** cross-tenant leak · public PII · wrong allocation · identity compromise · token leak · DB restore · provider outage · queue backlog · admin session compromise · marketplace abuse.

---

## 9. Cost estimate — theo 3 tier

> ⚠️ **Đọc kỹ ranh giới tier.** Con số "MVP" **không** bao gồm read replica, WAF Pro, hay tooling hardening (DAST/load/soak/pen-test/restore drill) mà chính doc này đặt làm baseline ở §5/§6/§7. Đừng dùng `~$30–95` để kết luận "đã đủ production money-safe".

### Tier A — MVP cheap (≤ vài trăm tenant, validate sản phẩm)

Single primary (PITR bật, **chưa** read replica), free tier WAF/Sentry. Chấp nhận discovery đọc trực tiếp primary + CDN cache (chưa offload replica).

| Hạng mục | Provider (ví dụ) | Chi phí/tháng |
|---|---|---|
| App hosting (web+discovery+worker) | Fly.io / Railway, vài instance nhỏ | ~$5–20 |
| Managed Postgres (HA + PITR, no replica) | Supabase Pro / Neon scale | ~$25–30 |
| CDN/WAF | Cloudflare free | $0 |
| Error tracking | Sentry free | $0 |
| **Tổng Tier A** | | **~$30–50** |

### Tier B — Production money-safe baseline (mặc định khi có tiền thật chạy qua)

Thêm những thứ §5/§6 yêu cầu để an toàn tiền/đa-tenant ở tải mục tiêu.

| Hạng mục bổ sung so với A | Ghi chú | Chi phí/tháng |
|---|---|---|
| **Read replica** (discovery + player-view) | §5.2 — offload hot public reads | ~$25–40 |
| **WAF/CDN Pro** | §6 — rate-limit tập trung, DDoS G6 | ~$20 |
| **Sentry Team** | alerting/retention | ~$26 |
| App scale (nhiều replica) | autoscale theo RPS | ~$20–50 |
| Secret/KMS managed | envelope encryption token | ~$0–10 |
| **Tổng Tier B (≈ A + bổ sung)** | | **~$120–200** |

### Tier C — P6 hardening (one-off + định kỳ, không phải hosting cố định)

Image signing (CI), **DAST** trên staging, **load/soak** infra, **restore drill** định kỳ, **pen-test** thuê ngoài, PDPA/GDPR + audit-retention tooling (§7, §8, §11). Phần lớn là **chi phí CI/người/định kỳ**, ước lượng riêng theo đợt — **không** gộp vào hosting hằng tháng ở A/B.

> Doanh thu phụ thuộc plan mix (0đ free / 250k host_pro mỗi CLB/tháng — DD-29). Tier B vẫn là baseline khi có tiền thật chạy qua; chi phí scale ~tuyến tính theo primary DB size + số replica. Điểm cần nhớ: **money-safe = Tier B**, không phải Tier A.

---

## 10. Anti-patterns (tránh)

- ❌ **Kubernetes** — quá nặng cho quy mô này, giết "dễ maintain".
- ❌ **Tách microservices** (bot/web/payment riêng) — chưa cần ở ≥1k tenant; tạo gánh nặng đồng bộ event/schema. (Ngoại lệ tương lai: chỉ `discovery` read service.)
- ❌ **Serverless function** (Lambda/Vercel functions) cho worker/webhook ingest/SSE — pg-boss & SSE cần process sống lâu; durable webhook cần ACK-sau-commit.
- ❌ **Redis** cho queue/pub-sub — pg-boss + `LISTEN/NOTIFY` đã đủ; thêm Redis là thêm thứ phải vận hành.
- ❌ **Đẩy web lên Vercel, tách rời bot/worker** — cắt đôi monolith, hại maintainability.
- ❌ **Dùng owner/superuser role cho app** — phá toàn bộ RLS (saas §4.2).

---

## 11. Mapping với ROADMAP

| Phase | Liên quan deploy |
|---|---|
| **P0** | Tạo `infra/Dockerfile`, `infra/docker-compose.yml`, `.env.example`; Postgres local docker + managed; RLS bật; CI migrate + test xanh. |
| **P0–P3** | CI gate dần đủ (RLS/public invariant, secret scan); staging với managed Postgres + Sentry. |
| **P6 — Hardening & scale** | Pen-test cô lập; load test >1k tenant + webhook burst; rate-limit webhook; observability đầy đủ; runbook backup/restore; PDPA/GDPR tooling (G5); audit retention (G4). |

---

## Changelog

| Date | Version | Thay đổi |
|---|---|---|
| 2026-06-20 | v1.0 | Bản đầu: topology 3 process group, scalability, security threat→control, ADR nhúng OD-4/7/10, CI gate, backup/DR, cost. |
| 2026-06-20 | v1.1 | Fix review: (1) SSE listener cần `DATABASE_URL_LISTEN` session-mode (txn pooler không `LISTEN`); (2) trạng thái ADR trỏ canonical về `decisions.md` (DD-04/10 đề xuất, DD-07 chốt); (3) role `readonly` chỉ SELECT projection, zero grant canonical; (4) cost tách 3 tier (MVP/baseline/hardening); (5) rule read-your-writes primary cho post-write reads. |
| 2026-06-20 | v1.2 | Sync connector review: thêm ApiPay vào webhook topology/process; đổi tham chiếu durable ACK sang BL-PAY-1/AUDIT BL-1. |
| 2026-06-20 | v1.3 | Sync DD-03 pricing tiers 0đ/79k/159k/199k vào cost assumptions. |
