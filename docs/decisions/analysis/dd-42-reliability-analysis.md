# 🎽 DD-42 Analysis — No-show / attendance / reliability subsystem

> **Mục đích:** chốt subsystem điểm danh + độ tin cậy + policy, **per-tenant, không public**. Ground vào canonical.
> **Ngày:** 2026-07-13 · **Canonical:** `schema.ts` (players.status:288 · memberships) · `feature_session_management` · DD-45 (waitlist ordering) · DD-41 (join gating) · `0009` RLS · AUDIT (HR2). Ghi → `decisions.md` DD-42.

---

## 0. TL;DR — ✅ per-tenant (owner)
- Subsystem **RIÊNG** (không nhét vào session CRUD): **attendance** trên `players`, **reliability** aggregate trên `memberships`, **policy** per-tenant setting.
- **PER-TENANT (chốt owner):** reliability/no-show tính RIÊNG từng CLB — khớp RLS, **không lộ hành vi xuyên CLB** (HR2). **KHÔNG public.**
- Tương tác **DD-45** (deprioritize hạ waitlist position) + **DD-41** (ban chặn join).

---

## 1. Canonical hiện trạng
| Sự thật | Nguồn |
|---|---|
| `players.status` = active\|left — **không attendance** | `schema.ts:288` |
| `memberships` = status\|pay_code — **không reliability/score** | `schema.ts:165` |
| Bot cũ (Bestminton) có no-show/deprioritize/ban — chưa vào canonical | ảnh 1 · bot reference |
| Tenant tables RLS fail-closed; money/PII không ra public (HR2) | `0009` · AUDIT |

---

## 2. Contract (3 lớp)
1. **Attendance (trên `players`):** `attendance ∈ {present|no_show|excused|unknown}`, host mark **sau buổi**. Default `unknown`.
2. **Reliability (aggregate trên `memberships`, per-tenant):** đếm no-show gần đây / score — dẫn xuất từ attendance của **cùng tenant**. **KHÔNG** cross-tenant.
3. **Policy per-tenant (setting):** ví dụ deprioritize khi 1 no-show; ban N ngày khi 2 no-show liên tiếp. Host cấu hình.
   - **Deprioritize** = hạ ưu tiên join/waitlist (tăng `waitlist_position` DD-45).
   - **Ban** = chặn join tạm thời — **state có hạn trên membership**; đường join check ban (DD-41 pre-check).

## 3. Invariants (per-tenant, HR2)
- **Attendance + reliability = TENANT-scoped (RLS), KHÔNG ra public** (`public_sessions` không chứa; như nợ/PII).
- Reliability **per-tenant** — không suy hành vi player xuyên CLB (chốt owner). Một person "kém tin cậy" ở CLB A **không** tự động ảnh hưởng CLB B.
- Ban là state có hạn (expire), audit khi set/gỡ.

## 4. Dependencies
- **DD-45** waitlist ordering đọc reliability (deprioritize → position).
- **DD-41** join eligibility check ban (thêm error code, vd `MEMBER_BANNED` — hoặc dùng `*_NOT_ELIGIBLE` family? → dùng **`MEMBER_BANNED`** riêng để rõ).
- Migration: cột `attendance` trên `players`; reliability fields + policy setting per-tenant; ban state trên `memberships`.
- Command `markAttendance` (host, post-session).

## 5. Propagation (khi build)
`feature_session_management(.md/_tech)` (markAttendance + ban check), `feature_multi_tenant`/membership (reliability + policy), `feature_cross_club_join` (join check ban), DD-45 (ordering), `schema.ts`+migration, tests. **Không public projection.**

## 6. Test fixtures
mark no_show/excused/present · reliability đếm per-tenant (CLB A không ảnh hưởng B) · deprioritize → waitlist position tăng · ban N ngày → join bị chặn (`MEMBER_BANNED`) · ban expire → join lại được · attendance/reliability KHÔNG vào public_sessions · audit set/gỡ ban.

## 7. Quyết định (đã chốt)
subsystem riêng; attendance/players; reliability/memberships **per-tenant**; policy per-tenant deprioritize/ban; tenant-scoped không public. Ghi `decisions.md` DD-42 ✅.

**Nguồn:** `schema.ts:288/165` · `0009` RLS · AUDIT (HR2) · DD-45/41 · ảnh 1/bot Bestminton.
