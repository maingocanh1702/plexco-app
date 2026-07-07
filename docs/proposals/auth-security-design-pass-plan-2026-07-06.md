# Plan — Security-design pass cho `auth-onboarding` (re-slice v3)

> **Trạng thái:** 🟡 Plan đề xuất — chờ founder duyệt · 2026-07-06
> **Loại:** Planning artifact (chưa phải spec Reviewed). KHÔNG sửa `schema.ts`/`migrations`/spec đã Reviewed cho tới khi bảng invariant được chốt + DD-31 ✅.
> **Bối cảnh:** Slice `auth-onboarding-v2` (autopilot Phase-1) parked @ `7407caa` sau **9 vòng codex review** — 4 vòng cuối (06→07→08→09) mỗi vòng lòi 1 finding MỚI ở FILE KHÁC → tín hiệu **non-convergence** (không phải thrash 1 vùng). Founder chọn dừng, làm security-design pass tổng thể thay vì vá lần 4.
> **Canonical đối chiếu:** `feature_web_auth_onboarding.md` (Reviewed v2.1, WAO-UC-1) · `BE/feature_web_auth_onboarding_tech.md` (Reviewed v2.0) · `feature_identity.md` (Reviewed v1.1, §2/§5 link_codes) · `BE/feature_identity_tech.md` (L118/L139 keyed-KMS lookup hash) · `00-start-here/identity-model.md §7` · `decisions.md` DD-13/14/15 · `HANDOFF.md §3` (5 HARD RULES).

---

## 0. TL;DR

9 vòng review lòi lỗi bảo mật lan nhiều file vì slice v2 **implement lệch khỏi spec bảo mật đã Reviewed**, không có bảng invariant/test để bám. Các Reviewed spec (`feature_web_auth_onboarding(_tech).md`, `feature_identity_tech.md`) **đã mandate** rotation, keyed-KMS lookup hash, TG HMAC verify, session-fixation defense — nhưng v2 **drift** khỏi các mandate đó — **cộng một gap web-auth chưa pin** (round-09: `account_identities.platform_user_hash` chưa có keyed hash). Thuốc: **rút bảng invariant + test EXECUTABLE TỪ các Reviewed spec đó + pin vài chỗ thật sự chưa đặc tả (pre-auth login-CSRF state, explicit tenant-filter) → re-slice `v3` conform + chứng minh bằng test**, gate **strict cho auth** (zero finding auth/security/PII, bất kể P-level). Đúng bài table-first đã diệt thrash của `core-lift`.

**Chốt scope quan trọng (grounded canonical):** TG *Login* (widget mint web session) **LÀ core auth Phase-1 → KHÔNG descope, harden ngay**. Chỉ có TG *bot* channel mới thuộc S17.

---

## 1. Bối cảnh: chuỗi non-convergence

Trail đầy đủ ở `.autopilot/worktrees/phase1-fable5/.autopilot/state/auth-onboarding-v2/`: state dir có `HALT-MAX_ROUNDS.txt`, `AWAIT-FOUNDER-round09-nonconvergence.txt`, `regions.log`, `prescan.md`, `fix-round-count.txt`; **codex verdicts ở `codex/round-01..09.txt`**. Người chạy v3 đọc evidence ở đây (KHÔNG phải `.autopilot/state/` ở repo root). Các finding, theo vòng:

| Vòng | Finding | File | Severity |
|---|---|---|---|
| v1/v2 (early) | creation-race family (tenant slug + login identity) TOCTOU; account-bind rotation; shared rate-limit store; canonical hash replay | auth core | P1 (đã fix) |
| 06 | logout xoá cookie khi thiếu session/CSRF (forced-logout); `rate_limit_hits` phình vô hạn | route / limiter | P2/P2 (fixed) |
| 07 | `onboardingSnapshot` không lọc `tenant_id` tường minh (chỉ dựa RLS) | auth.ts | P2 def-in-depth (fixed) |
| 08 | **TG login callback thiếu same-origin check** (login-CSRF: kẻ tấn công mint session của hắn vào cookie nạn nhân); `onboarding_steps` không dedupe theo recency (migration 0013); manifest lệch scope | callback | **P1** + 2×P2 (fixed) |
| 09 | `account_identities.platform_user_hash` (viết qua `telegramUserLookupHash`) dùng **SHA-256 trần** → brute-force nếu lộ DB/backup. Cột web-auth này chưa có mandate keyed (khác channel) → **gap DD-31**, xem SI-2 | telegram-login.ts | **P2 (codex label)** — auth/PII → **treat blocking** (open) |

**Đọc ra:** đây KHÔNG phải thrash 1 vùng (kiểu `matching.ts` của core-lift) — finding **lan** route→migration→auth.ts→callback→telegram-login.ts. Nghĩa là thiếu một **spec bảo mật thống nhất** để implement theo; review đang enumerate gap từng cái. Vá tiếp = whack-a-mole trên đúng bề mặt nguy hiểm nhất (auth/PII/tiền-adjacent).

---

## 2. Chốt TG-scope (grounded — có sửa nhận định trước)

> ⚠️ Nhận định sơ bộ trước đây ("descope TG login sang S17") **SAI theo canonical**. Ghi lại để không lặp.

- **TG Login (widget → web session) = CORE auth Phase-1.** `feature_web_auth_onboarding.md` WAO-UC-1: *"New Host — Authenticate (TG Login / web-account fallback) — Session created, CSRF token issued."* `_tech.md`: `POST /api/auth/telegram/callback` (Public) + bảng `account_identities(platform, platform_user_hash, verified_at)` → `web_sessions`. → round-08/09 nằm ĐÚNG path core này → **harden ngay, không descope, không stopgap-rồi-bỏ.**
- **TG *bot* channel = S17 (tách).** `00-start-here/identity-model.md §7`: "Telegram Login / web fallback → web auth (P4)" **khác** "Telegram bot → channel (P3.5/P4.5), routing qua `telegram_links`". Chỉ phần bot messaging mới ở S17.
- **Không phụ thuộc chặn:** TG Login **không** cần S8 identity-merge (merge là post-onboarding), và **không bắt buộc** cả S9 PWA shell — state-nonce chống login-CSRF làm được **server-side + trang login tối thiểu**. → Bảo mật được **bây giờ**.
- **Email/password/Google = DD-13 (🟡 chưa chốt)** → pass này **chỉ nhắm TG Login + web-account fallback**. Nếu cần login "bật ngay" cho go-to-market → là quyết định **DD-13 riêng**, không nhét vào pass này.

---

## 3. Chẩn đoán gốc (đã hiệu chỉnh)

> ⚠️ Bản nháp trước nói "canonical im lặng" — **quá tay**. Reviewed specs thực ra đã mandate phần lớn; bệnh là **v2 implement DRIFT khỏi spec**, cộng vài chỗ thật sự chưa pin executable.

**Đã CÓ trong Reviewed spec (v2 drift khỏi cái này):**
- **Session rotation** — `feature_web_auth_onboarding.md` L19/L69 ("rotation sau privilege change" · "Session rotation after each privilege-granting step"); `_tech.md` L21/L144 ("rotate on login, ownership assignment, tenant switch"), cột `web_sessions.rotated_from` (L46), session-fixation test (L167).
- **Keyed lookup hash từ KMS — CHỈ ở layer identity/channel** — `feature_identity_tech.md` L118/L139 mandate keyed-KMS cho `channel_identities.platform_user_lookup_hash` + `persons.phone_lookup_hash`. Đây là **tiền lệ/pattern**, KHÔNG tự động phủ cột web-auth `account_identities.platform_user_hash` (→ gap #4 dưới).
- **TG HMAC verify + fresh date** — `_tech.md` L83/L163 ("verify hash(data + bot_token)").

**Thật sự CHƯA pin executable (gap thật cần bổ sung):**
1. **Pre-auth login-CSRF browser-bound state** — v2 mới có `auth_login_nonces` (migration 0012) = **replay guard** (dedupe login đã thấy, TTL 10′), **chưa phải** state phát trước redirect + bind trình duyệt + same-origin check ở callback (đúng round-08 P1).
2. **Explicit tenant-filter policy** cho query onboarding/snapshot (defense-in-depth ngoài RLS) — chưa thành invariant (round-07).
3. **Nguồn secret/KMS** cho lookup hash — spec nói "from KMS" nhưng chưa pin wiring cụ thể (xem OQ-2).
4. **Keying cho web-auth `account_identities.platform_user_hash`** (round-09) — cột khai **plain `text`** (`schema.ts` L129 · migration `0001` L112), KHÔNG có mandate keyed (khác `channel_identities.platform_user_lookup_hash`). Áp keyed hash cho cột web-auth này (nhất quán pattern identity-layer) = **quyết định DD-31**, không phải drift. ⚠️ **v3 phải phân biệt 2 layer:** auth = `account_identities.platform_user_hash`, channel = `channel_identities.platform_user_lookup_hash`.

→ Việc cần làm: **rút invariant + test EXECUTABLE từ Reviewed spec** (biến requirement thành assertion có test), **pin 4 gap thật** ở trên, rồi implement v3 conform. **KHÔNG viết lại** spec đã Reviewed.

---

## 4. Bảng security-invariant — các domain phải cover

Mỗi dòng khi viết full sẽ có: **invariant** · **threat chặn được** · **test chứng minh** · **HR/canonical ref**. Danh sách domain (map tới round):

| # | Domain | Invariant (tóm tắt) | Nguồn |
|---|---|---|---|
| SI-1 | **Login-CSRF / session-fixation (TG callback)** | v3 THÊM `auth_login_state` (state token single-use + TTL, bind trình duyệt pre-auth qua httpOnly cookie) — **khác** `auth_login_nonces` (replay guard đã có ở 0012). Route login phát state → callback **verify TG HMAC + auth_date freshness + same-origin + match cookie-state** → **rotate session** (`rotated_from`, không mint vào cookie sẵn có). Ba artifact (migration mới · route phát · callback consume) **phải liệt kê trong manifest scope** của slice v3. | round-08 P1 · `_tech.md` L83/L144 · HR2 |
| SI-2 | **Web-auth identity hash keying** | Cột đúng = **`account_identities.platform_user_hash`** (web-auth; `schema.ts` L129 · `0001` L112) — **KHÔNG** phải `channel_identities.platform_user_lookup_hash` (channel). Cột web-auth hiện plain `text`; v3 chuyển sang **keyed hash (key từ KMS/secret store, ngoài DB/backup)**, dùng **y hệt** write + lookup — nhất quán pattern identity-layer (`feature_identity_tech.md` L118/L139). = **gap DD-31**, không phải drift. | round-09 · `schema.ts` L129 · HR2 |
| SI-3 | **Tenant-scoping defense-in-depth** | mọi query onboarding/snapshot lọc `tenant_id` tường minh **VÀ** dựa RLS; test bằng **superuser harness** để chứng minh không lệ thuộc RLS đơn độc | round-07 · HR1 |
| SI-4 | **Logout semantics** | xoá cookie phải kèm valid session / CSRF (chống forced-logout cross-site) | round-06 |
| SI-5 | **Rate-limit integrity** | `rate_limit_hits` bounded (không phình), shared store, admit đúng N dưới burst đồng thời | round-06 + early |
| SI-6 | **Creation-race / idempotency** | family tạo tài khoản (tenant slug + login identity) atomic, TOCTOU-safe — mã hoá thành invariant (đã fix ở v2, chống regression) | v1/v2 early |
| SI-7 | **Session lifecycle** | rotation sau provisioning / privilege-transition; TTL; nonce single-use | round-07 + DD |
| SI-8 | **onboarding_steps dedupe/recency** | dedupe theo recency (migration 0013), idempotent | round-08 |

Nguyên tắc kèm theo: **claim có tiền không bao giờ dựa tên đơn thuần — chỉ verified signal auto-merge** (`feature_identity §2`, HR4). Áp cho mọi chỗ bind identity ↔ session.

---

## 5. Plan thực thi (3 bước)

**Bước 1 — Draft bảng invariant.** Mình viết `docs/features/BE/auth-security-invariant-table.md` (first pass) với đủ 8 domain trên, mỗi dòng đầy đủ 4 cột (invariant/threat/test/ref). *(Artifact do assistant tạo, chờ founder review.)*

**Bước 2 — Chốt bảng + pin 4 gap thật.** Founder review/chốt bảng → (a) ghi **DD-31 "Auth security invariant + test matrix"** (executable, rút từ WAO/identity specs) vào `decisions.md`; (b) chỉ **bổ sung 4 gap thật** vào `BE/feature_web_auth_onboarding_tech.md` (pre-auth login-CSRF state · explicit tenant-filter · KMS secret source · keying cho `account_identities.platform_user_hash`) — **KHÔNG viết lại** phần spec đã mandate rotation/keyed-hash-channel/HMAC. Mục tiêu: codex có "authority" (spec Reviewed + test matrix) để đối chiếu ở re-slice.

**Bước 3 — Re-slice `feat/auth-onboarding-v3`.** Fresh từ integration tip `3717659`, implement **test-first theo bảng**. Gate **strict cho auth**: **zero finding trên bề mặt auth/security/PII/tiền — bất kể P-level** (carve-out backlog CHỈ dành cho non-security NL-parsing/format) + 2 vòng codex clean liên tiếp → merge vào `feat/phase1-fable5` → **mở khoá S5–S20**. Giữ branch `v2 @ 7407caa` làm tham chiếu (fixes round 06–08 carry over; v3 là re-implement mạch lạc, **không vứt việc**).

---

## 6. Definition of Done

- Bảng `auth-security-invariant-table.md` đủ 8 domain, chốt.
- DD-31 ✅ trong `decisions.md`; canonical gaps đã vá vào `_tech.md` (Reviewed).
- `feat/auth-onboarding-v3`: mọi invariant có test xanh (gồm superuser-harness cho SI-3) · **zero finding auth/security/PII còn mở (bất kể P-level)** · 2 vòng codex clean liên tiếp · VERIFY_CMD + next build xanh.
- Merge v3 → `feat/phase1-fable5` → S5 hết CASCADE-BLOCKED.

---

## 7. Housekeeping & tồn đọng (song song, không chặn plan)

1. **Merge `feat/phase1-fable5` → `main`** để chốt 4 slice đã INTEGRATED (S1, S2d, S3 keystone RLS, S2c core-lift-v3 @ `3717659`). Không cần chờ auth.
2. **Tắt scheduled `/loop wakeup`** — tàn dư setup chạy-dài, giờ flow interactive.
3. **Backlog `core-matcher-grouped-amount-parsing`** (P2, matching/dates/payments tail) — chờ lên lịch.

---

## 8. Câu hỏi mở cho founder (chốt trước/khi review bảng)

- **OQ-1:** DD-13 (thêm Google/email-password login) — chốt bây giờ hay để sau? Ảnh hưởng: nếu chốt, bảng invariant cần thêm domain "credential/password" (storage, reset, lockout). Mặc định plan: **để sau**, chỉ TG Login + web fallback.
- **OQ-2:** Pepper/secret cho SI-2 — dùng secret store nào (env/secret manager)? Cần biết để đặc tả nơi lấy pepper (không vào DB/backup).
- **OQ-3:** Có muốn ghi DD-31 luôn ở bước 2, hay giữ bảng ở dạng proposal cho tới khi v3 merge?
