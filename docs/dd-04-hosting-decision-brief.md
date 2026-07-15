# 🗄️ DD-04 Decision Brief — Postgres Hosting (rev 3)

> **Mục đích:** đủ dữ kiện để founder **chốt provider** cho hệ tiền multi-tenant RLS.
> **Ngày:** 2026-07-15 (rev 3; rev 2 factual analysis giữ nguyên, rev 3 đóng governance drift) · **Nguồn nội bộ hiện hành:** `deployment-infra.md §2/§6` (DD-04) · `decisions.md` v1.32 (DD-04) · `feature_security_operations_tech.md`. **Số liệu provider:** web (07/2026), xem Sources.
> **Đã chốt (không bàn lại):** Managed Postgres **HA + PITR**, **region Singapore**. Railway PG chỉ dev/staging. Compute app hiện target **Fly.io** (DD-10).

> ⚠️ **REV 2 sửa lỗi factual của rev 1** (xem §0.1) và **thêm gate private-network** làm quyết định chốt-trước. Do rev 2 mở rộng phạm vi DD-04 (thêm DigitalOcean + gate network), tại thời điểm đó DD-04 cần được reopen/update trước khi founder phê duyệt; rev 3 ghi nhận gate này đã hoàn tất.
> ✅ **REV 3 governance closure:** DD-04 đã reopen và `deployment-infra.md §2` đã sync; phần còn lại chỉ là founder chọn posture/provider rồi propagate option đã chọn. Không đổi provider facts/recommendation của rev 2.

---

> ✅ **FINAL DECISION (2026-07-16): chọn (c) — co-locate DigitalOcean** (App Platform + Managed PG HA-standby, VPC private, Singapore). Brief này là **phân tích/nguồn**; đề xuất **(a)** ở TL;DR dưới đã **SUPERSEDED** bởi record chốt `dd-04-hosting-final-decision.md`. Provider facts + gate ở dưới vẫn dùng làm tham chiếu; **pre-build gate = egress-IP verify (§7.1 của record)**.

## 0. Khuyến nghị (TL;DR)

**Có HAI quyết định, phải chốt theo thứ tự:**

**QĐ-1 (gate, chốt trước): posture private-network** — vì compute ở **Fly.io** và mọi managed DB nằm ở cloud khác, **không có** private networking thật trừ khi PrivateLink (Supabase Team/Ent + AWS VPC) hoặc **co-locate compute vào cùng cloud DB**. Chọn 1:
- **(a) Public TLS + `sslmode=verify-full` + static-egress-IP allowlist** — giữ Fly, DB provider allowlist Fly egress IP. Đơn giản, giữ kiến trúc hiện tại. Câu chữ cũ ở `deployment-infra.md §6` ("Postgres KHÔNG bao giờ expose public") từng mâu thuẫn với posture này; rev 3 đã sync baseline thành "không public *unauthenticated*; truy cập qua TLS verify-full + IP allowlist".
- **(b) Strict private (PrivateLink/VPC)** — buộc **co-locate compute + DB cùng cloud** (vd chuyển compute sang DO, hoặc sang AWS + Neon PrivateLink). Đây là **thay đổi DD-10** (rời Fly) — hệ quả lớn.

**QĐ-2 (provider), phụ thuộc QĐ-1:**
- Nếu **(a) public-TLS**: gate HA/SLA thật sự loại **Supabase Pro** (**không uptime SLA**; auto-failover có thể còn Enterprise-only — cần xác nhận sales). Còn lại **DigitalOcean Managed** (auto-failover standby + 99.95% SLA, rẻ, đơn giản) vs **Neon Scale** (HA multi-AZ + 99.95% SLA; PrivateLink của Neon là AWS-only → *không dùng được từ Fly*, chỉ IP-allow + TLS). → **nghiêng DigitalOcean**.
- Nếu **(b) strict-private**: hợp lý nhất là **DO compute + DO Managed PG cùng VPC** (private thật, rẻ) — kéo theo rời Fly; hoặc AWS + Neon PrivateLink (đắt/phức tạp hơn).

**Self-host VPS DIY:** **KHÔNG Day-1** (hệ tiền + solo dev, §6-selfhost).

**Một dòng:** gate quyết định không phải "HA chung chung" mà là **auto-failover + SLA + posture network trên nền Fly**. Trên gate đó, **Supabase Pro rớt** (thiếu SLA), **DigitalOcean nghiêng-chọn nhờ bill phẳng + vận hành đơn giản** (KHÔNG phải vì rẻ nhất — Neon Scale ở floor 0.25 CU có thể rẻ hơn trước storage/history, §4.1), **Neon Scale đạt-gate nhưng PrivateLink vô dụng với Fly**.

---

## 0.1 ⚠️ Correction log (rev 1 → rev 2)

| Rev 1 nói (SAI) | Sự thật (rev 2, có nguồn) |
|---|---|
| "Neon Launch không HA; HA chỉ ở Scale" | **Neon HA multi-AZ có ở MỌI plan** (storage multi-AZ mặc định, compute auto-reschedule AZ). **Scale** thêm **PrivateLink + 99.95% SLA + IP-allow rules + SOC2/HIPAA** — đó mới là thứ Scale-gated, không phải HA. |
| "Neon always-on = ~1 CU ⇒ $120–160" | Tắt scale-to-zero **vẫn giữ autoscaling**, floor **0.25 CU**. Ước tính 1 CU thổi phồng chi phí Neon. |
| "Supabase Pro là finalist đạt HA nhờ Pro + replica" | **Supabase Pro KHÔNG đạt gate.** Read replica là **read-only, async, KHÔNG auto-promote** (warm standby). Auto-failover được nêu là Enterprise-only (blog 2023 — **xác nhận lại sales**). Gate chốt bởi **Pro không có uptime SLA**. |
| "Bảng scale cost theo tenant count" | Tenant count **không** map thẳng ra RAM/CU; Neon 1 CU chưa benchmark; Team $599 không bắt buộc chỉ vì DB lớn. Bảng cost hạ cấp thành **minh hoạ**, chỉ giữ anchor có nguồn (§5). |
| "IPv4 add-on Supabase mặc định cần" | Fly egress **IPv6** được; Supabase direct là IPv6 → **không mặc định cần IPv4 add-on** (chỉ cần khi allowlist bằng IPv4). |
| Private network coi như đã lo ("Fly private networking / Supabase network restrictions") | Fly private networking chỉ nội-bộ-Fly; **DB managed ở cloud khác ⇒ không private thật** trừ PrivateLink/co-locate. **Gate chưa giải quyết** → §2. |

---

## 1. Plexco đòi hỏi gì ở tầng DB

Rút từ `deployment-infra.md` (+ bổ sung rev 2):

1. **RLS fail-closed** (HR1) — RLS là tính năng Postgres core, chạy đầy đủ ở **mọi** provider Postgres thuần (không phụ thuộc "RLS-native platform").
2. **3 connection string:** pooled txn (request) · session/direct (SSE `LISTEN` ở web) · session/direct (worker pg-boss). Cần provider cho **direct/session connection** (không bị pooler chặn `LISTEN`).
3. **pg-boss + `LISTEN/NOTIFY`** cần connection session *luôn thức*.
4. **Read replica** cho discovery/public reads.
5. **HA = auto-failover** (không chỉ "warm standby") + **PITR** — vì hệ tiền. ⬅️ **gate cứng**.
6. **Uptime SLA** cam kết — hệ tiền cần cam kết hợp đồng, không chỉ best-effort. ⬅️ **gate cứng**.
7. **Posture network:** DB không nhận traffic public *unauthenticated*; phải TLS verify-full + IP allowlist **tối thiểu**, private networking nếu khả thi. ⬅️ **QĐ-1**.
8. **Region Singapore** (VN latency).
9. **4 DB role** tách connection-level (least-privilege).
10. **Chi phí nhạy** (DD-29: host 0đ/250k) + **team nhỏ** (ít moving parts).
11. **Portability:** chỉ dùng Postgres thuần (không tính năng platform độc quyền) → đổi provider = đổi connection string + migrate. Bảo hiểm cho mọi lựa chọn.

---

## 2. QĐ-1 — Posture private-network (CHỐT TRƯỚC)

**Vấn đề:** compute (Fly.io) và DB managed (Supabase/Neon/DO) ở **cloud khác nhau** → traffic DB **không thể** đi private networking nội cloud. Ba đường:

| Posture | Cách làm | Ưu | Nhược |
|---|---|---|---|
| **(a) Public TLS + verify-full + IP allowlist** | Cấp **Fly static egress IP** ($3.60/mo/region, IPv4); DB provider allowlist IP đó; ép `sslmode=verify-full` (**CA validation + hostname verification**) | Giữ Fly nguyên trạng; đơn giản; đủ mạnh cho phần lớn hệ tiền | Traffic qua public internet (đã mã hoá + IP-restricted); baseline `§6` đã sync, cần pin làm final nếu founder chọn (a) |
| **(b) PrivateLink (AWS)** | Compute phải ở **AWS VPC**; dùng Neon PrivateLink / RDS | Private thật, không qua public | **Rời Fly** (đổi DD-10); phức tạp/đắt; Supabase PrivateLink = Team/Ent |
| **(c) Co-locate cùng cloud** | Chuyển compute sang **DO** (Droplet/App Platform) + **DO Managed PG cùng VPC** | Private thật + rẻ + đơn giản trong một hệ | **Rời Fly** (đổi DD-10) |

**Khuyến nghị QĐ-1:** **(a) public-TLS + verify-full + static-IP allowlist** cho giai đoạn hiện tại — giữ Fly, đủ an toàn cho hệ tiền khi làm đúng (`sslmode=verify-full` = CA validation + hostname verification, + allowlist + role least-privilege). Coi (b)/(c) là lựa chọn *khi* muốn strict-private, và cả hai **đều kéo theo rời Fly** nên phải cân với DD-10.

> 📌 **Governance:** rev 3 đã sync `deployment-infra.md §6` về baseline trung lập: "không public *unauthenticated*; bắt buộc TLS verify-full + IP allowlist; private networking khi co-locate". Sau khi founder chọn (a/b/c), pin đúng posture được chọn làm final; không cần reopen DD-04 lần nữa.

---

## 3. Gate HA + SLA — ai ĐẠT (dữ kiện rev 2)

| Provider | Auto-failover HA | Uptime SLA | Private option (từ Fly) | Đạt gate? |
|---|---|---|---|---|
| **DigitalOcean Managed** | ✅ **standby node tự failover** ($30 primary + $30 standby, 2GB) | ✅ **99.95%** | Trusted-sources IP allowlist (public-TLS); VPC nếu co-locate DO | ✅ **ĐẠT** |
| **Neon Scale** | ✅ HA multi-AZ (storage multi-AZ, compute auto-reschedule) | ✅ **99.95%** (Scale) | PrivateLink **AWS-only → KHÔNG dùng được từ Fly**; còn IP-allow + TLS | ✅ **ĐẠT** (nhưng private=chỉ IP-allow trên Fly) |
| **Supabase Pro** | ⚠️ auto-failover được nêu là **Enterprise-only** (nguồn: blog 2023 — **cần xác nhận lại với sales**); Pro = warm standby (manual promote) | ❌ **không uptime SLA ở Pro** | ❌ PrivateLink = Team/Ent | ❌ **KHÔNG đạt ở Pro** (chốt bởi **thiếu SLA**, độc lập với tình trạng failover) |
| **Supabase Enterprise** | ✅ (auto-failover) | ✅ (Ent) | ✅ PrivateLink (AWS VPC) | ⚠️ đạt nhưng **giá Enterprise/opaque**, và PrivateLink vẫn cần AWS |
| **Self-host VPS** | ⚙️ tự dựng (Patroni/pg_auto_failover) | ❌ tự chịu | VPC nếu cùng cloud | ❌ rủi ro (§6) |

> ⚠️ **Về Supabase auto-failover:** khẳng định "Enterprise-only" đến từ [blog Read Replicas 2023](https://supabase.com/blog/introducing-read-replicas) — **thông tin plan có thể đã đổi, phải xác nhận lại với Supabase sales**. Tuy nhiên điều đó **không đổi kết luận gate**: Supabase Pro rớt **chủ yếu vì không có uptime SLA** (pricing page), là gate cứng của hệ tiền — độc lập với việc auto-failover nay thuộc tier nào.

**Kết luận gate:** với posture (a) trên Fly, **finalist đạt-gate = DigitalOcean Managed và Neon Scale**. **Supabase chỉ đạt-gate ở Enterprise** (do gate SLA) → loại khỏi finalist "giá hợp lý" trừ khi chấp nhận Enterprise.

---

## 4. So sánh 4 trục — giữa 2 finalist (DO Managed vs Neon Scale)

### 4.1 Hiệu quả / chi phí
- **DO:** giá **phẳng, dự đoán được**. HA cluster từ **$30+$30 (2GB)**, storage I/O **included**, **đồng giá Singapore**, PITR 7 ngày, SLA 99.95%. Scale lên = đổi plan (bậc thang rõ).
- **Neon Scale:** consumption **$0.222/CU-h**, autoscale trong khoảng **min/max CU đã cấu hình** (floor 0.25 CU; **max CU đặt trần cứng** → DB không vượt quá). Chi phí **biến động trong dải min/max**, không tăng vô hạn. Đánh đổi: đặt max thấp = **nghẽn hiệu năng** (không phải bill vọt); đặt max cao = trần chi phí cao hơn.
- **Nhận định:** DO **định phí phẳng, khỏi cấu hình cap**; Neon **rẻ hơn ở tải thấp**, chi phí nằm trong dải đã chọn nhưng cần **tự cân max-CU** giữa chi phí và hiệu năng + benchmark trước khi cam kết.

### 4.2 Scalability
- Cả hai: vertical + read replica + pooler. DO pooling (PgBouncer) built-in; Neon autoscale CU linh hoạt cho burst.
- **Nhận định:** hoà. Neon nhỉnh về co giãn tự động; DO nhỉnh về đơn giản/định phí.

### 4.3 Security
- **RLS đầy đủ ở cả hai** (Postgres core). DO trusted-sources/VPC firewall; Neon Scale IP-allow + (PrivateLink AWS-only).
- Từ **Fly**, private thật **không** khả dụng ở cả hai (Neon PrivateLink cần AWS; DO VPC cần compute-in-DO) → cả hai về **posture (a)** như nhau.
- **Nhận định:** hoà trên Fly. Nếu sau này co-locate DO → DO cho private thật rẻ nhất.

### 4.4 Maintainability
- **DO:** ít bẫy nhất — HA một nút, không scale-to-zero để lo, định phí. **Neon:** phải cấu hình tắt scale-to-zero cho listener/worker (sai → listener chết), billing biến động.
- **Neon branching** = điểm cộng CI (thay được bằng CI ephemeral).
- **Nhận định:** **DO nhỉnh** cho team nhỏ + always-on.

---

## 5. Chi phí — chỉ anchor có nguồn (bảng scale = MINH HOẠ)

**Anchor chắc chắn:**
- **DO:** HA 2GB = **$30 primary + $30 standby = $60/mo**, PITR 7 ngày, SLA 99.95%, storage I/O included, đồng giá Singapore. 4GB HA ≈ ~$120; 16GB HA ≈ ~$490 (bậc thang plan).
- **Neon Scale:** $0.222/CU-h. Chạy always-on ở **floor 0.25 CU ≈ $40.52/mo trước storage/history** ($0.222×730×0.25, khớp final record) — **thấp hơn DO HA $60/mo** ở tải thấp. Cộng thêm: storage $0.35/GB-mo; PITR history $0.20/GB-mo; SLA + **quyền dùng** PrivateLink included ở Scale (không phí license) — **nhưng private network transfer vẫn tính `$0.01/GB` cả hai chiều**. Chi phí tăng theo tải nhưng **có trần cứng = max-CU đã cấu hình**.
- **Fly egress IP:** $3.60/mo/region (IPv4) cho allowlist.

> ⚠️ **Không có "cost winner" trước benchmark.** Ở tải thấp Neon (0.25 CU) **có thể rẻ hơn** DO; khi tải tăng Neon leo tới max-CU đã đặt còn DO vẫn phẳng. Không quy đổi "tenant → CU/RAM" nếu chưa **đo trên staging**. Nguyên tắc: **DO = bill phẳng, dự đoán chắc, vận hành đơn giản; Neon = có thể rẻ hơn ở tải thấp nhưng phải cân max-CU (chi phí ↔ hiệu năng) + benchmark.**

**Đối chiếu margin DD-29:** ở HA nhỏ, cả hai đều ~$40–130/mo tuỳ cấu hình/tải → cần ~4–13 host trả phí (250k) hoà vốn tầng DB. **DO thắng về *tính dự đoán* của margin, không nhất thiết về con số tuyệt đối** — Neon ở tải thấp có thể rẻ hơn.

---

## 5b. Quy mô người dùng + chi phí theo cấu hình (KHÔNG suy từ host count)

**Quy mô user/data** (context, nguồn ROADMAP "1 host ≈ 20–40 player", Day-1 ~50 unique/club; ~30 player/host, trừ ~15% trùng cross-club):

| Mốc | Host | Player-memberships | Unique persons (users) | Data year-1 |
|---|---|---|---|---|
| **100 host** | 100 | ~3,000 | ~2,500 | ~2–8 GB |
| **1000 host** | 1,000 | ~30,000 | ~24,000 | ~15–40 GB |

> ⚠️ **Host count KHÔNG map thẳng ra RAM/CU** — dataset nhỏ, chi phí quyết bởi **peak concurrency** (webhook burst 100/s, 10k discovery), phải **benchmark trên staging**. Vì vậy bảng dưới cho **giá theo cấu hình tài nguyên**, KHÔNG gán "100 host = X GB". Chọn cấu hình nào cho 100/1000 host là **kết quả benchmark**, không phải phép chia.

**Chi phí/tháng theo cấu hình (đã gồm HA; Singapore):**

| Cấu hình primary | DO Managed (HA = ×2) | Neon Scale (always-on, floor→max) | Self-host VPS (HA, **+ lao động**) |
|---|---|---|---|
| 2GB / 1vCPU | ~$60 | 0.25–0.5 CU ≈ $41–81 | ~$55–70 |
| 4GB / 2vCPU | ~$120 | 0.5–1 CU ≈ $81–162 | ~$60–90 |
| 8GB | ~$240 | 1–2 CU ≈ $162–324 | ~$110–140 |
| 16GB | ~$490 | 2–4 CU ≈ $324–648 | ~$210–260 |
| **+ read replica** | + 1 node cùng tier | + 1 compute always-on (floor $41+) | + 1 VPS cùng tier |

**Công thức + phụ phí (cộng vào bảng trên):**
- **Neon compute** = $0.222 × 730h × CU → **$162.06/CU-mo**; floor 0.25 CU; trần = max-CU tự đặt. Cộng: storage $0.35/GB-mo · PITR history $0.20/GB-mo · **network transfer: posture (a) trên Fly = public egress (100GB included, sau đó $0.10/GB)**; con số $0.01/GB **chỉ áp cho PrivateLink** — mà PrivateLink **không dùng được từ Fly** (§3).
- **DO** = giá tier (flat) × 2 (standby HA) + read-replica tier; storage I/O included; đồng giá Singapore.
- **Self-host** = Σ node VPS (primary+standby+monitor) + object storage (~$5–20) **+ lao động ~$150–500/mo (§6)**.
- **Fly egress IP** $3.60/mo/region (mọi option managed, cho allowlist).

> **Benchmark hypotheses (CHƯA phải estimate — cần đo mới xác nhận):** giả thuyết *khởi điểm để đo*, KHÔNG dùng làm kết luận margin: 100 host *có thể* vừa 2–4GB primary (chưa cần replica); 1000 host *có thể* cần 8–16GB + 1 read replica. **Con số cứng chỉ có sau benchmark** (peak connections, CU-hours thực, replica size) — đừng dùng các dải này cho quyết định chi phí trước khi đo.

**Supabase:** Pro **rớt gate** (no uptime SLA) bất kể cấu hình; chỉ đạt gate ở **Enterprise = báo giá (quote required)** — không đặt range giả định.

### Độ nhạy doanh thu (không dùng 1 conversion rate làm forecast)

DD-29/canonical **không** định nghĩa tỷ lệ host trả phí → xét **độ nhạy**, không forecast điểm (host_pro 250k ≈ $10/host/mo):

| % host trả phí | Doanh thu @100 host | Doanh thu @1000 host |
|---|---|---|
| 10% | $100 | $1,000 |
| 30% | $300 | $3,000 |
| 50% | $500 | $5,000 |

**DB-cost / doanh thu — dải đầy đủ** (dùng dải cấu hình giả thuyết ở trên; **là hypotheses, không phải forecast**):

| % host trả phí | 100 host (DB ~$60–150) | 1000 host (DB ~$240–730) |
|---|---|---|
| 10% | ~60–150% | ~24–73% |
| 30% | ~20–50% | ~8–24% |
| 50% | ~12–30% | ~5–15% |

> **Dải đầy đủ ≈ 5–73%** tuỳ % trả phí + cấu hình. **Không** rút "≤10–25%" cho toàn bảng (đó chỉ đúng gần scenario 30% ở 1000 host). Hình dạng chung: **nặng margin ở seed** (100 host, tỷ lệ trả phí thấp có thể > doanh thu), **thoải dần khi scale**. Kết luận định tính không đổi: ưu tiên **giá dự đoán được** ở giai đoạn đầu — nhưng **mọi con số phải benchmark trước khi cam kết**.

---

## 6. Self-host VPS DIY (giữ nguyên verdict)

VPS Singapore rẻ (4GB ~$24–42, 8GB ~$48–63; 3 node ~$70–150/mo). **KHÔNG khuyến nghị Day-1:** HA production cần Patroni + etcd quorum (hoặc pg_auto_failover + monitor) + PgBouncer + WAL archiving (pgBackRest/WAL-G) + tuning + monitoring + OS patching + **runbook failover đã test**. Với **hệ tiền + solo dev không DBA**: *failover chưa test = mất tiền thật; backup chưa restore = không phải backup.* Tiết kiệm ~$50–150/mo **không đáng** so rủi ro + chi phí cơ hội (feature layer đang 0%). Để dành khi có SRE — portability (Postgres thuần) khiến chuyển sang self-host sau này là *đổi connection string + migrate*.

## 6b. Railway (2 hình thái — đừng gộp)

Repo trước ghi "Railway dev/staging only"; dữ kiện hiện tại cần cập nhật:

- **Railway single-node (unmanaged template):** Railway **tự gọi các DB template là *unmanaged*** — bạn sở hữu instance, KHÔNG phải managed-DB-as-a-service. Đã có **one-click PgBouncer** (connection pooling — không còn thiếu). **PITR** hỗ trợ **cả single-node lẫn HA qua pgBackRest** (docs không nêu cố định 7-ngày hay chỉ-Pro). **Vẫn thiếu:** single-node **không auto-failover HA** + không managed-failover → **không đạt gate hệ tiền như một managed HA service; hợp dev/staging** (hoặc dùng bản HA bên dưới nếu tự vận hành).
- **Railway HA (template Patroni cộng đồng):** cụm **nhiều service tự vận hành** (etcd + Postgres/Patroni + HAProxy). **Đây là self-host HA (Option D) chạy trên hạ tầng Railway — KHÔNG phải managed-failover-as-a-service.** Cùng gánh vận hành/rủi ro như §6, chỉ khác substrate. *(Chi tiết cluster/auto-failover: xác minh theo template cụ thể.)*
- **Ưu điểm riêng:** nếu **co-locate compute lên Railway** → private networking nội-project (DB không cần public ingress) = lời giải cho **QĐ-1 posture (c)**, nhưng **rời Fly** (đổi DD-10).
- **Chi phí (usage-based, xác minh unit rate):** single-node theo cấu hình (§5b, tier tương ứng); HA Patroni = Σ node theo bảng self-host §5b **+ bạn tự vận hành**.
- **Verdict:** không đổi lựa chọn. Railway single-node = dev/staging; Railway HA = biến thể self-host, không rẻ/nhẹ hơn DO. Chỉ cân khi muốn *một-platform + private networking* và chấp nhận rời Fly + tự nuôi Patroni. So (c) co-locate: **DO (compute+Managed PG+VPC, failover managed)** vẫn hơn **Railway (compute + Patroni tự vận hành)**.

---

## 7. Governance + checklist xác minh

**Governance (bắt buộc):**
1. ✅ **DD-04 reopen → Accepted:** reopen 2026-07-13 (thêm DigitalOcean + QĐ-1 posture + sửa dữ kiện HA Neon/Supabase), **founder chốt 2026-07-16 = (c) co-locate DO** (QĐ-1=c, QĐ-2=DigitalOcean). `decisions.md` DD-04 = ✅ Accepted (v1.32); record `dd-04-hosting-final-decision.md`. Pre-build gate = egress-IP verify.
2. ⏳ **Sau khi founder chốt QĐ-1**, cập nhật `deployment-infra.md §6` theo posture thực tế được chọn.
3. ✅ **`deployment-infra.md §2` đã sync** Railway row: template DB là *unmanaged*; có one-click PgBouncer; PITR single-node + HA qua pgBackRest. Verdict "chỉ dev/staging" giữ nguyên với lý do đã sửa đúng dữ kiện.

**Checklist xác minh trước khi ký (đo, đừng tin brochure):**
1. **QĐ-1 posture** đã chốt? (a/b/c) — kéo theo có rời Fly hay không.
2. **Auto-failover** thật sự (không chỉ warm standby) ở tier định mua — test kill primary trên staging.
3. **PITR** retention + giá; **restore drill** ngay sau provision (nghiệm thu RPO/RTO thật).
4. **Direct/session connection** cho pg-boss + `LISTEN` hoạt động (DO direct string; Neon tắt scale-to-zero).
5. **IP allowlist** nhận Fly **static egress IP**; ép `sslmode=verify-full` (CA validation + hostname verification).
6. **Region Singapore** ở tier + auto-failover cùng region.
7. **Benchmark tải** trên staging trước khi cam kết chi phí (đặc biệt Neon consumption): connection count = (web replica × 1 LISTEN) + (worker × pool).
8. **max_connections** ở compute size vs tổng session-mode conn.

---

## 8. Quyết định đề xuất — HISTORICAL (SUPERSEDED)

> ⚠️ **Section này là khuyến nghị BAN ĐẦU (đề xuất (a)) — đã bị THAY bởi quyết định cuối `(c) co-locate DigitalOcean` (2026-07-16, `dd-04-hosting-final-decision.md`).** Giữ làm lịch sử phân tích. **KHÔNG còn CTA "chọn (a)".**
>
> *(Lịch sử) Bước 1 từng đề xuất (a) giữ Fly + public-TLS; Bước 2 provider DO Managed. Kết quả cuối founder chọn **(c) co-locate DO** (private VPC) — **(a) = fallback** nếu egress-IP gate fail. **(c) đổi deployment target Fly→DO nhưng KHÔNG đảo DD-10** (App Platform chạy standalone container). Neon/Supabase loại như phân tích trên.*

**Trạng thái:** ✅ **DD-04 = Accepted (c)** — `decisions.md` v1.32 + `dd-04-hosting-final-decision.md`. Còn lại (build slice): **egress-IP gate** + provision + restore/failover drill + đo RPO/RTO + KMS wiring.

---

## Sources

- [Neon — High Availability (multi-AZ, all plans)](https://neon.com/docs/introduction/high-availability)
- [Neon Pricing — Scale adds PrivateLink + 99.95% SLA + IP-allow; 0.25 CU floor & max-CU cap (autoscaling)](https://neon.com/pricing)
- [Neon Scale to Zero — compute suspends on inactivity; paid plans can disable it](https://neon.com/docs/introduction/scale-to-zero)
- [Neon Postgres Compatibility — session-scoped LISTEN/NOTIFY is lost when the session ends; disable Scale to Zero for persistent listeners](https://neon.com/docs/reference/compatibility)
- [Neon Network Transfer — PrivateLink transfer $0.01/GB both directions](https://neon.com/docs/introduction/network-transfer)
- [Supabase Read Replicas — read-only, async, no auto-promote](https://supabase.com/docs/guides/platform/read-replicas)
- [Supabase blog: Introducing Read Replicas (2023) — auto-failover "Enterprise-only" (verify with sales)](https://supabase.com/blog/introducing-read-replicas)
- [Supabase Pricing — uptime SLA listed at Enterprise only](https://supabase.com/pricing)
- [Supabase PrivateLink (Team/Enterprise, AWS VPC)](https://supabase.com/docs/guides/platform/privatelink)
- [DigitalOcean Managed PostgreSQL pricing (HA standby, storage included)](https://docs.digitalocean.com/products/databases/postgresql/details/pricing/)
- [DigitalOcean DB security (trusted sources / VPC)](https://docs.digitalocean.com/products/databases/postgresql/how-to/secure/)
- [DigitalOcean Databases SLA (99.95%)](https://www.digitalocean.com/sla/databases)
- [DigitalOcean PITR restore](https://docs.digitalocean.com/products/databases/postgresql/how-to/restore-from-backups/)
- [Fly.io Egress IPs (static egress, $3.60/mo IPv4)](https://fly.io/docs/networking/egress-ips/)
- [Railway PostgreSQL docs — DB templates are *unmanaged*](https://docs.railway.com/databases/postgresql)
- [Railway changelog — one-click PgBouncer (connection pooling) shipped](https://railway.com/changelog/2026-06-19-railway-mobile-app-for-ios)
- [Railway PITR docs — single-node + HA via pgBackRest](https://docs.railway.com/volumes/point-in-time-recovery)
- [PostgreSQL HA with Patroni/pgBouncer/pgBackRest](https://instadevops.com/blog/postgresql-high-availability-patroni-pgbouncer-guide/)
