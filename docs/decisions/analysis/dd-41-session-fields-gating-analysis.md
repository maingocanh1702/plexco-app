# 🎯 DD-41 Analysis — Field mô tả + gating cho `sessions`

> **Mục đích:** chốt bộ field **mô tả** + **gating (điều kiện JOIN)** cho `sessions`, mô hình enforce, public whitelist delta, và **dependency thuộc tính người chơi**. Mở đầu cụm session-model (sau DD-46).
> **Ngày:** 2026-07-13 · **Canonical:** `packages/db/schema.ts` (sessions:214) · `feature_session_management.md` (SES-UC, join) · `feature_marketplace_discovery.md` (whitelist §80) · DD-08 (level 5-bậc), DD-39 (gender pricing/`person.gender`), DD-46 (personal tenant). **✅ Đã chốt (owner 2026-07-13) → ghi `decisions.md` DD-41.**

---

## 0. TL;DR

- **Mô tả (thêm cột):** `title`, `notes`, `session_type` (1 field), `byoe`, `cost_shared` *(descriptive-only, KHÔNG đổi công thức charge — §2)*, `instructions`.
- **Gating = điều kiện JOIN (enforce ở shared `evaluateSessionEligibility`, KHÔNG chỉ hiển thị):** `level_min_rank`/`level_max_rank`/`level_strict`, `gender_restriction`, `age_min`/`age_max`. **Decision table đầy đủ §3** (missing/eligible/ineligible/consent-denied/decrypt-fail).
- **Error codes (CHỐT — 9 literal):** `LEVEL_NOT_ELIGIBLE` · `GENDER_RESTRICTED` · `AGE_RESTRICTED` · `LEVEL_ATTRIBUTE_REQUIRED` · `GENDER_ATTRIBUTE_REQUIRED` · `AGE_ATTRIBUTE_REQUIRED` · `GENDER_CONSENT_REQUIRED` · `AGE_CONSENT_REQUIRED` (level không có consent) · `ATTRIBUTE_UNAVAILABLE`.
- **⚠️ Điểm mấu chốt:** enforce cần **thuộc tính NGƯỜI CHƠI**: level-per-sport (**chưa có source**), `persons.gender_enc`/`dob_enc` (**BRD FR-11 — contract ĐÃ có trong MVP, migration chưa implement**, PII enc+consent). ⇒ thêm cột session dễ; **enforce = self-attested + decision table** (không verified). **CẤM publish strict-gate khi source thuộc tính chưa khả dụng.**
- **Public whitelist +:** `session_type`, level range + **`level_strict`**, `gender_restriction`, **`age_min/max`**, `title` (moderated). `notes`/`instructions` **nội bộ**.
- **Choke-point = shared core `evaluateSessionEligibility`**, gọi từ **canonical `addMemberToSession`** (TDD §join) **trước MỌI final roster mutation** — phủ **cross-club join, member nội bộ, host-add, invite-link** (không chỉ CCJ, vốn chỉ mô tả public/open/approval). Áp mọi surface + mọi tenant (club **và** personal DD-46).
- **Phân biệt DD-39:** gender ở đây = **điều kiện JOIN**; DD-39 = **PRICING theo giới tính**. Độc lập; một session có thể có cả hai.

---

## 1. Canonical hiện trạng

| Sự thật | Nguồn |
|---|---|
| `sessions` **thiếu** `title`/`notes`/`session_type`/gender/age/instructions; chỉ có `skill_level text` (tự do, **không enforce**) + `visibility`+`join_policy` | `schema.ts:214` |
| Session Management + Cross-club Join = **spec Reviewed, domain service CHƯA implement**. Live có **schema + minimal RLS repo** `tenantRepo.sessions.create/list/getById` (`tenant.ts:41`); **thiếu** `SessionService`/`addMemberToSession`/CCJ. `evaluateSessionEligibility` là contract sẽ build | `BUILD-STATUS.md:98` · `tenant.ts:41` |
| Public whitelist hiện: sport/time/area/skill_level/price/slots/club+host_display_name/join_policy | `feature_marketplace_discovery.md:82` |
| DD-08: level 5-bậc **ordered, rank 1..5** (beginner<…<professional) — nguồn chung level | DD-08 |
| DD-39: `person.gender` (schema chờ migration) — cho **pricing** | DD-39 |

---

## 2. Field MÔ TẢ (low-risk)

| Field | Kiểu | Ghi chú |
|---|---|---|
| `title` | text | tên kèo (≤100). **Public + moderated** (như display names). |
| `notes` | text | mô tả tự do. **Nội bộ** (không public). |
| `session_type` | text enum | `social \| class \| coaching \| tournament \| singles` (một field). ⚠️ **Trộn 2 trục** (`singles`=format; social/class/coaching/tournament=intent) → nếu sau này tách 2 trục sẽ **cần backfill + đổi contract**, KHÔNG "no breakage". |
| `byoe` | boolean | bring-your-own-equipment (metadata). |
| `cost_shared` | boolean | **DESCRIPTIVE-ONLY (PIN):** chỉ cờ mô tả "phí chia sẻ", **TUYỆT ĐỐI KHÔNG** đổi công thức `price_amount`/charge/ledger. Nếu tương lai muốn **phí biến động / chia sau buổi** → phải tách **money slice riêng** (đụng đường tiền, không nằm trong DD-41). |
| `instructions` | text | hướng dẫn free-text. **Nội bộ tới sau join**. |

---

## 3. Field GATING + mô hình ENFORCE

> Gating = **điều kiện JOIN của session (policy metadata)**, enforce ở **shared `evaluateSessionEligibility`** (gọi từ `addMemberToSession` trước mọi roster mutation), không chỉ filter hiển thị.

> 📌 **`gender_restriction`/`age_min-max` là POLICY của session, KHÔNG phải gender/DOB của player.** Player gender/DOB là PII enc, **không bao giờ ra public** (BRD NFR-S2, user_settings). Enforce = so **policy session** với **thuộc tính player** (đọc private, không lộ).

| Field (session policy) | Thuộc tính player để so | Nguồn player |
|---|---|---|
| `level_min_rank`/`level_max_rank` + `level_strict` | level của player cho môn | **CHƯA có** (self-report person×sport) |
| `gender_restriction` (`none\|male\|female`) | `persons.gender_enc` (male/female/other/undisclosed) | **BRD FR-11/DD-39**, migration chờ |
| `age_min`/`age_max` | tuổi từ `persons.dob_enc` | **BRD FR-11** (contract có, migration chờ) |

> **Age tính DETERMINISTIC:** tuổi = tại **`sessions.starts_at` theo `sessions.timezone`** (không phải lúc join); birthday boundary theo ngày bắt đầu.

**DECISION TABLE (self-attested, không verified):**

| Trạng thái thuộc tính player | Non-strict / non-restricted | **Strict / restricted** |
|---|---|---|
| **Eligible** | join | join |
| **Ineligible** (ngoài range/không khớp) | level non-strict → cảnh báo, cho join (advisory); gender/age → hard **block** | **block** `LEVEL_NOT_ELIGIBLE` / `GENDER_RESTRICTED` / `AGE_RESTRICTED` |
| **Missing** (chưa đặt) | join | **block** `LEVEL_/GENDER_/AGE_ATTRIBUTE_REQUIRED` + prompt "đặt {…}" |
| **Consent-denied** (privacy choice, ≠ missing; **chỉ gender/age** — level không có consent) | join | **block** `GENDER_CONSENT_REQUIRED`/`AGE_CONSENT_REQUIRED` — message tôn trọng privacy ("kèo này yêu cầu {tuổi/giới tính}; bạn đã chọn không chia sẻ"), **KHÔNG** ép "hãy đặt" |
| **`other`/`undisclosed` gender** vs male/female-restricted | — | **block** `GENDER_RESTRICTED` |
| **Decrypt/KMS fail** | — | **`ATTRIBUTE_UNAVAILABLE`** → infra retry, **KHÔNG prompt** (thuộc tính CÓ, chỉ đọc lỗi) |

> ⚠️ **Nguồn phân biệt `missing` vs `consent-denied` (PIN):** hiện chỉ có `gender_enc`/`dob_enc` — `NULL` **không** phân biệt được "chưa đặt" vs "từ chối chia sẻ". Cần **consent state per thuộc tính** (vd `persons.gender_consent`/`dob_consent` enum `not_set|granted|denied`; storage chi tiết → user_settings slice). Map: `granted`+enc có → eligible/ineligible · `not_set`/enc NULL → `*_ATTRIBUTE_REQUIRED` · `denied` → `*_CONSENT_REQUIRED`. *(`undisclosed` là GIÁ TRỊ gender "không tiết lộ" — đã disclose consent, khác consent-denied → so male/female-restricted = GENDER_RESTRICTED.)*

**Bất biến bổ sung:**
- **Chặn TRANSITION sang `open`/`public` (không cấm create draft) nếu source thuộc tính CHƯA khả dụng** (chưa có level-source → không publish `level_strict`; chưa có `dob` pipeline → không publish age-restricted). Host lưu draft được; không lên open/public tới khi enforce khả thi. *(Tránh session "không ai join được".)*
- **Approval:** pre-check lúc request + **re-check TRONG transaction lúc approve** (`feature_cross_club_join_tech` Approval Transaction) — thuộc tính đổi giữa request↔approve.
- Áp mọi tenant (club + personal DD-46) qua cùng `evaluateSessionEligibility`. Host gỡ thủ công người khai sai (DD-42 sau).

---

## 4. Public whitelist delta (marketplace)

**Thêm (an toàn — đều là SESSION POLICY, không phải player PII):** `session_type`, `level_min_rank`/`level_max_rank` + **`level_strict`** (player cần biết range là advisory hay hard → thêm vào projector/public DTO + exact-column test), `gender_restriction`, `age_min/max`, `title` (moderated). *(BRD NFR-S2 "không public giới tính" nói về **player gender** — `gender_restriction` là luật của kèo, không lộ ai; ghi rõ khi update BRD/whitelist.)*
**Giữ NỘI BỘ (chốt):** `notes`, `instructions`, `byoe`, `cost_shared`. Test bất biến: public serializer chỉ emit whitelist mở rộng; `notes`/`instructions`/`byoe`/`cost_shared` **không rò**; và **không** lộ player gender/DOB.

---

## 5. Dependencies + thứ tự

- **Player-attribute sources (chặn ENFORCE, không chặn thêm cột):**
  1. **Level per person×sport** — **CHƯA có source**. Cần self-report (profile/user_settings). Chưa có → **không cho publish `level_strict`**; level non-strict = advisory.
  2. **`persons.gender_enc`** (male/female/other/undisclosed) — **BRD FR-11 / DD-39, contract có, migration chưa**. `other/undisclosed` vs male/female-restricted → không khớp (§3).
  3. **`persons.dob_enc`** — **BRD FR-11 (ĐÃ trong MVP contract) — KHÔNG phải dependency mới từ DD-48**; trạng thái = contract có, **migration chưa implement**. PII enc+consent (`feature_user_settings_tech`).
- **Decrypt/KMS-fail** trên `*_enc` → `ATTRIBUTE_UNAVAILABLE` (infra, không prompt) — §3.
- **Migration ordering:** DD-41 cột session **sau** migration chat/gender (DD-38/39) đang chờ; level rank = DD-08 (rank 1..5).
- **`skill_level` CUTOVER (PIN — một nguồn duy nhất = rank):** expand→contract: (1) thêm `level_min_rank`/`level_max_rank`/`level_strict`; (2) **backfill** map `sessions.skill_level` text cũ → rank (bảng map best-effort; **giá trị không map được → NULL rank = không có level-gate**, không đoán bừa); (3) **ngừng write/read/project `skill_level`** (bỏ khỏi public projection + serializer); (4) **drop cột `skill_level`** khỏi `schema.ts`/migration + cập nhật **exact-column invariant test**. Sau cutover chỉ còn rank; `skill_level` không tồn tại song song.

---

## 6. Quyết định (đã chốt — owner 2026-07-13)

1. **Duyệt bộ field** mô tả + gating (§2/§3). ✅
2. **`session_type` = MỘT field (Option 1):** `social \| class \| coaching \| tournament \| singles`. *(Đa môn: team sports không có singles/doubles → một field đủ cho MVP. ⚠️ field này **trộn 2 trục** — nâng lên `format`+`type` sau **cần backfill + đổi contract**, không "no breakage".)*
3. **Scope gating MVP:** **level + gender + AGE — cả ba in-scope.**
   - Level: self-report; chưa có source → không publish `level_strict`; non-strict = advisory (§3/§5.1).
   - Gender/Age: `persons.gender_enc`/`dob_enc` (**BRD FR-11, migration chờ** — không phải dependency mới).
4. **Enforce model:** **self-attested + DECISION TABLE §3**; **error codes exact (9):** `LEVEL_NOT_ELIGIBLE` · `GENDER_RESTRICTED` · `AGE_RESTRICTED` · `LEVEL_ATTRIBUTE_REQUIRED` · `GENDER_ATTRIBUTE_REQUIRED` · `AGE_ATTRIBUTE_REQUIRED` · `GENDER_CONSENT_REQUIRED` · `AGE_CONSENT_REQUIRED` (level không có consent) · `ATTRIBUTE_UNAVAILABLE`. Chặn transition open/public khi source chưa khả dụng. Approval: pre-check + re-check trong tx.

> **Propagation (khi build — nhiều hơn session+marketplace):** `feature_session_management(.md/_tech)` (+ `evaluateSessionEligibility`/`addMemberToSession`) + **`feature_cross_club_join(.md/_tech)`** (enforce + approval re-check) + `feature_marketplace_discovery` (whitelist delta) + **`business-rules`** (gating invariants) + **TDD discovery/join** + **BRD (NFR-S2 clarify: gender_restriction=policy≠player PII)** + **`feature_user_settings(.md/_tech)`** (gender/dob consent + age-at-starts_at) + **`schema.ts`+migration+DBML** + **projector contract** + **exact-column invariant test** (`rls-invariants.test.ts:133`). Chi tiết SQL/enforce + player-attribute sources → **slice riêng** (DD-46 pattern).

**Nguồn:** `packages/db/schema.ts:214` (sessions) · `tenant.ts:41` (minimal repo) · `feature_session_management.md` (SES-UC-8 join, edge#6) · `feature_marketplace_discovery.md:80` (whitelist) · TDD §join (`addMemberToSession`) · DD-08 (level rank) · DD-39/BRD FR-11 (`gender_enc`/`dob_enc`) · DD-46 (personal tenant · cùng **shared eligibility core**).
