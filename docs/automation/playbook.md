# 🛠️ EXECUTION PLAYBOOK — Plexco

**Cho:** Solo dev + AI co-pilot + Founder (PM/QA/dogfood)
**Căn cứ:** BRD v3.1 · PRD v2.1 · TDD v2.1 · ROADMAP v2.2

> ⚠️ **Version note (19/07/2026):** playbook body ở historical baseline **v3.1/v2.1/v2.2**. Nguồn hiện hành: **BRD v3.9d · PRD v2.8c · TDD v3.1 · ROADMAP v3.3c · `../standards/decisions.md` v1.67**. Khi lệch, ưu tiên authority hiện hành.
**Mục đích:** biến 8 phase / 19 module trên ROADMAP thành một guồng execute *dễ quản lý* và *khó sai* cho một người.

---

## TL;DR — phương pháp trong 1 đoạn

Làm việc **lùi từ North Star** ("số kèo hoàn tất vòng/tuần"), chia mỗi phase thành **vertical slice ship được**, và bảo vệ **4 bất biến lõi bằng test CI ngay từ commit đầu tiên** (invariant-first). Giữ **WIP = 1 module**, chạy theo **nhịp tuần**, và dùng **một file `progress.json` versioned chung với code** làm nguồn sự thật tiến độ (đúng tinh thần "canonical store" của chính dự án) — `plexco-dashboard.html` chỉ là một *projection* để nhìn. AI co-pilot lo phần cơ bắp (code/test/review); bạn lo phần xương sống (quyết định kiến trúc + DoD gate). Không qua gate thì không sang phase sau.

---

## 1. Nguyên tắc cốt lõi (5)

**1. Invariant-first, không phải feature-first.** TDD đã chốt 4 bất biến: (1) cô lập tenant, (2) không lộ tiền/PII ra public, (3) ledger không mất/đếm quá tiền, (4) Postgres = nguồn sự thật. Với một dự án tài chính đa-tenant, đây là chỗ một lỗi = mất niềm tin vĩnh viễn. Nên mỗi bất biến phải có **test CI bật trước khi viết feature chạm vào nó**. Ví dụ: viết test "repo B không thấy session A" *trước* khi viết bất kỳ query nào ở P0. Test bất biến là *bê tông móng*; feature là *tường*. Không ai đổ tường trước móng.

**2. Vertical slice sau khi có móng.** P0–P1 buộc phải làm ngang (schema + RLS + repo) — đó là móng, không demo được, chấp nhận. Nhưng từ P2 trở đi, mỗi phase phải kết thúc bằng **một thứ bấm-chạy-thấy được end-to-end**, không phải "xong tầng service nhưng chưa có UI". Mốc demo của mỗi phase chính là **🎯 Milestone trong ROADMAP** — coi nó là hợp đồng nghiệm thu, không phải khẩu hiệu.

**3. WIP = 1.** Một người chỉ nên có đúng **một module `in_progress`** tại một thời điểm. Nhiều module dở dang = nhiều ngữ cảnh trong đầu = nơi lỗi cô lập/ledger ẩn nấp. Module nào mở ra thì đóng cho xong (qua DoD) rồi mới mở module kế.

**4. Risk & learning lên đầu.** Trong mỗi phase, làm **thứ rủi ro/khó-rút-kinh-nghiệm-nhất trước**, không phải thứ dễ nhất. Cụ thể: RLS fail-closed (P0) và durable webhook reconcile (P3) là hai "killer flow" — đụng sớm để sai sớm, sửa rẻ. Onboarding wizard đẹp có thể đợi.

**5. Dogfood là gate, không phải nice-to-have.** Migrate bot cũ → tenant #1 (P3) là lần đầu hệ thống gặp dữ liệu thật. Đừng để nó trôi xuống cuối. Khi tenant #1 chạy thật trên Plexco mới = bạn có một vòng phản hồi thật mỗi tuần, dẫn dắt mọi quyết định sau đó.

---

## 2. Nguồn sự thật tiến độ (khuyến nghị)

Bạn chưa quyết → đây là đề xuất cho **solo dev + AI co-pilot**, theo thứ tự "đủ dùng, không thừa":

| Giai đoạn | Nguồn sự thật | Lý do |
|---|---|---|
| **Bây giờ → hết MVP (P0–P4.7)** | **`progress.json` trong repo** + `plexco-dashboard.html` | Versioned chung với code (mỗi PR cập nhật tiến độ → review thấy ngay). Không tốn phí connector, không context-switch sang tool ngoài. Đúng triết lý canonical store của chính bạn: 1 nguồn, các view là projection. |
| **GitHub Issues** | dùng cho **backlog chi tiết per-module** (mỗi DoD item = 1 checkbox) | Issue/PR là nơi tự nhiên để AI co-pilot và bạn trao đổi diff; link commit ↔ acceptance criteria. Xem `BACKLOG-P0-P3.md` — copy thẳng thành issue. |
| **Khi có người thứ 2 / sau P5** | nâng lên **Linear hoặc GitHub Projects** | Lúc cần assignment, cycle, velocity thật mới đáng chi phí một board ngoài. Trước đó là overkill. |

> **Quy tắc 1 dòng:** `progress.json` = *trạng thái phase/module* (coarse, để nhìn tổng). GitHub Issues = *checklist DoD* (fine, để làm). Đừng nhân đôi: phase/module sống ở JSON, task con sống ở Issues.

**Vòng cập nhật:** khi đóng một module → bật module đó thành `done` trong dashboard (click) → Export `progress.json` → commit cùng PR cuối của module. Dashboard luôn phản ánh `main`.

---

## 3. Cách chia: Phase → Epic → Issue (decomposition)

Map cứng để không phải nghĩ lại:

```
Phase (ROADMAP P-number)
  └─ Module (1 epic = 1 dòng trong Module Progress table)
       └─ Issue (1 dòng DoD/acceptance criteria → 1 checkbox)
            └─ Commit/PR (idempotent, có test kèm)
```

**Định nghĩa "Done" của một module (DoD gate) — phải đủ cả 5:**

1. ✅ Code chạy đúng acceptance criteria của FR tương ứng (BRD §7 / PRD flow).
2. ✅ Unit test cho logic thuần (core) xanh — *viết trong `packages/core`, không phụ thuộc DB*.
3. ✅ Integration test trên Postgres thật xanh — *gồm test bất biến liên quan*.
4. ✅ Không phá test bất biến của phase trước (CI chạy lại toàn bộ).
5. ✅ `progress.json` cập nhật + (nếu có) doc spec chuyển từ `drafted` → `reviewed`.

Thiếu 1 trong 5 → module vẫn `in_progress`, không được tính %.

---

## 4. Nhịp làm việc (cadence cho solo dev)

**Vòng tuần (đề xuất):**

- **Thứ 2 — Plan (30').** Mở dashboard → chọn **1 module** kế trên critical path → mở `BACKLOG` của nó → chốt 3–6 issue cho tuần. Viết trước **test bất biến/acceptance sẽ phải xanh** (định nghĩa "đích").
- **T3–T6 — Build.** Mỗi ngày 1–2 issue. Vòng nhỏ: *AI draft code → bạn review & chỉnh kiến trúc → test xanh → commit*. Giữ commit nhỏ, mỗi commit kèm test.
- **Thứ 7 — Gate & demo.** Chạy full CI. Nếu module đạt DoD → bật `done`, Export `progress.json`, ghi 3 dòng changelog. Nếu chưa → ghi blocker, để `blocked`/`in_progress`.
- **Founder loop:** mỗi cuối tuần dogfood tenant #1 (từ P3) báo 1 pain thật → vào đầu backlog tuần sau.

**Vì sao tuần, không phải sprint 2 tuần:** một người dễ lạc trong khối lớn. Nhịp tuần ép ra một điểm "đóng được" thường xuyên, giảm WIP tồn.

---

## 5. Thứ tự build (critical path — không thương lượng)

```
P0–P1 Foundation ─▶ P2 Zalo-tenant (Messenger P2.5) ─▶ P3 CK-reconcile ─▶ P3 Migrate #1
   ─▶ P3.5 Identity ─▶ P4 Web+Sync ─▶ P4.3 Marketplace ─▶ P4.5–4.7 Player
   ─▶ P5 Billing ─▶ P6 Harden
                         (Messenger P2.5: phase-1 nhưng phụ thuộc App Review, tách nhánh)
```

Lý do thứ tự này *đúng* và bạn nên bám: mỗi node là **prerequisite cứng** của node sau (xem Dependency Map TDD §3 / ROADMAP). Đừng nhảy cóc làm marketplace trước khi có sync engine, hay làm billing trước khi có tenant thật để thu. Cám dỗ lớn nhất là nhảy sang phần "vui" (web UI, discovery) — đừng; không có móng RLS + ledger thì phần vui là nợ kỹ thuật chờ nổ.

**Điểm soft-launch:** BRD §14 cho phép soft-launch **miễn phí sau P4.3** để validate marketplace trước khi bật billing. Tận dụng: P5 (Billing) có thể *manual-activate* trong khi bạn học xem player có thật sự join qua discovery không.

---

## 6. Năm "quality gate" gắn vào CI (chạy mọi PR)

Đây là cách bạn ngủ ngon dù làm một mình — máy giữ các ranh giới bất biến hộ bạn:

1. **Isolation gate** (từ P0): tenant A/B — repo B không thấy dữ liệu A; query quên `SET LOCAL` → 0 dòng (fail-closed).
2. **Public gate** — hai mức: **whitelist skeleton gate từ P0** (mọi cột `public_sessions` ∈ whitelist, không có cột tiền/PII/roster) → **full discovery-leak gate từ P4.3** (discovery/join không bao giờ trả tiền/PII/roster người khác; kèo private không lọt; chống scrape/enumeration). Skeleton bật ngay MS1 vì bảng đã tồn tại từ P0; phần leak-test đầy đủ chỉ có nghĩa khi discovery/join chạy ở P4.3.
3. **Ledger gate** (từ P3): 1 CK chia nhiều charge/người; partial không mark paid; over-allocation bị chặn; duplicate/retry/reversal giữ đúng tổng.
4. **Worker/RLS gate** (từ P3): job nhận `tenant_id` → `SET LOCAL` trước khi đọc/ghi; worker không được dùng quyền bypass RLS mặc định; privileged call phải có audit.
5. **Sync gate** (từ P4): áp lại cùng command/event → không double; re-project dựng đúng từ canonical.

Mỗi gate là một suite test. **Quy tắc vàng:** gate đỏ = không merge, không sang phase sau — kể cả khi "chỉ là phase trước".

---

## 7. Dùng AI co-pilot cho đúng việc

Phân vai để không giao nhầm:

- **Giao cho AI:** viết logic thuần trong `core` + test (matching, ledger allocation, dates, format); sinh boilerplate Drizzle schema/migration; viết integration test theo acceptance criteria bạn mô tả; review diff tìm chỗ quên scope tenant; soạn lại doc spec.
- **Bạn giữ:** quyết định kiến trúc (repo choke-point, outbox vs CDC, SSE topology); duyệt mọi thứ chạm **ranh giới bất biến** (RLS policy, field whitelist, allocation math); cutover migrate tenant #1; xử lý Open Decisions (OD-2/4/5/6/8/10).
- **Mẹo prompt:** đưa AI *acceptance criteria + invariant phải giữ* làm đầu bài, không đưa "viết hàm X". Ví dụ tốt: "Viết test chứng minh một CK 200k trả cho 2 charge 120k+80k cùng ngày được FIFO-allocate đúng, và một CK 150k cho charge 200k để charge ở trạng thái `partial` không phải `paid`." → để AI vừa viết test vừa viết code thoả.

---

## 8. Hai tuần đầu cụ thể (để bắt đầu ngay)

**Tuần 1 — Móng compile được + isolation gate đỏ→xanh:**
- Khởi tạo monorepo pnpm (`packages/core`, `apps/bot`, `apps/web`) + Postgres docker. *(M1)*
- Lift `core` (matching/payments-logic/dates/format/i18n/**sports**) từ bot cũ, **test cũ xanh lại** làm reference. *(M1)*
- Dựng Drizzle + 2–3 bảng đầu (`tenants`, `sessions`, `players`) với RLS ENABLE+FORCE, role `app NOBYPASSRLS`. *(M2)*
- **Viết Isolation gate test** → cho đỏ → implement `tenantRepo`+`withTenant` → cho xanh. *(M2/M3)*

**Tuần 2 — Schema đa môn + public skeleton + repo choke-point:**
- Đủ bảng tenant-scoped với `tenant_id` + `sports` + `sessions.{sport_id,visibility,slots_max,area,venue,skill_level,join_policy}`. *(M3)*
- `public_sessions` skeleton + **Public gate test** (field whitelist). *(M2)*
- Đóng **Milestone MS1**: `drizzle push` sạch, RLS bật, isolation + public test xanh trong CI → bật P0–P1 = `done` trên dashboard.

Sau đó theo critical path: M4 → M5 (killer) → M6 (dogfood) → …

---

## 9. Bẫy cần tránh (đặc thù dự án này)

- **Quên `SET LOCAL` ở đường worker.** Scheduler/dispatcher phải quay lại tenant context trước khi đọc/ghi; đừng cấp `BYPASSRLS` toàn cục cho process (TDD §3.4). Test Worker/RLS gate.
- **Cho `pay_code` vào memo quá sớm.** P3 phát hành memo **name-based**; `pay_code`/VietQR chỉ phát cho player từ P4 sau khi rollout+migration+test nhánh đó xong (TDD §10.5).
- **Project ra surface trước khi command/outbox idempotent.** Sai thứ tự này = roster "nhảy lùi" và double-notify. Outbox + `commandId`/`event.id` dedupe phải có *trước* khi bật projector thật.
- **Coi plan `free` như plan trả phí.** Authority = **DD-29** (logical plans `free`/`host_pro`, thay DD-03). Plan `free` (0đ) vào thẳng `active` vô thời hạn — không trial/past_due/suspended vì non-payment (BRD FR-9.1). Đừng để billing cron đụng nó. *(Live schema còn key legacy `free_web` cho tới khi migration DD-29 đổi CHECK → `('free','host_pro')`; đừng dùng `free_web` làm vocabulary.)*
- **Để Messenger (P2.5, App Review) khoá critical path.** Là phase-1 nhưng phụ thuộc App Review Meta; tách nhánh, không chặn phần MVP còn lại.

---

*Playbook này là "how"; ROADMAP là "what/when"; BRD/PRD/TDD là "scope/behavior/contract". Khi mâu thuẫn: BRD → PRD → TDD → ROADMAP; riêng security, quy tắc nghiêm hơn giữa BRD và AUDIT thắng.*
