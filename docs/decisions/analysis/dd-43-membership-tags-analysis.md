# 🏷️ DD-43 Analysis — Nhãn/hạng thành viên + audience targeting

> **Mục đích:** chốt nhãn thành viên + targeting, **tách audience vs join-eligibility**. Ground vào canonical.
> **Ngày:** 2026-07-13 · **Canonical:** `schema.ts` (memberships:165) · `feature_session_management` (announce) · `feature_marketplace_discovery` (public whitelist) · DD-08 (level rank) · DD-41 (join gating). Ghi → `decisions.md` DD-43.

---

## 0. TL;DR — ✅ (duyệt) — TAGS-only cho audience
- **HAI contract RIÊNG (không gộp):**
  1. **Nhãn = `membership_tags`** (many-to-many, per-tenant, host-defined) → **MVP chỉ dùng cho NOTIFICATION AUDIENCE** khi announce (ai được **mời/thấy** announcement).
  2. **Join eligibility = DD-41 gating (level/gender/age) + `join_policy` (DD-05)** — **KHÔNG** dùng tag để gate join ở MVP.
- **Bỏ `membership_tier` khỏi MVP** (chỉ thêm nếu có nhu cầu hạng thật). "Join sớm theo tag" (early access) = **slice sau**, không MVP.
- Là **targeting**, KHÔNG field của `sessions`. **Public KHÔNG lộ tag.**

---

## 0.1 Correction log
| Rev trước (chưa chọn) | Sự thật (chốt) |
|---|---|
| "`membership_tags` HOẶC `membership_tier`" + gộp "ai thấy/mời/join sớm" | **Chốt tags** (bỏ tier MVP). **Audience (notify) ≠ join-eligibility (DD-41)** — 2 contract riêng. "Join sớm" = slice sau. |

---

## 1. Canonical hiện trạng
| Sự thật | Nguồn |
|---|---|
| `memberships` = `status`+`pay_code` — **không tag/tier** | `schema.ts:165` |
| Ảnh 1: chip lọc Bronze/Champions/Supporter/level 1-8 (nhắm đối tượng announce) | ảnh 1 |
| `public_sessions` whitelist — không có membership tag | `feature_marketplace_discovery.md:82` |
| DD-08: level 5-bậc rank (nguồn chung) | DD-08 |

---

## 2. Contract
- **`membership_tags`** (per-tenant): `membership_id` ↔ `tag` (many-to-many hoặc `tags text[]`); host tự định nghĩa tập tag (VIP/supporter/…); tenant-scoped RLS.
- **Announce audience:** khi tạo/announce kèo → chọn **tag filter** → chỉ member khớp tag **được mời/thấy announcement** (`session_surface_refs`/notification intents theo audience). **Không** ảnh hưởng ai được **join** (join = DD-41+DD-05).
- **Level** không nhân đôi: dùng **DD-08 rank** (không tạo tag "level" song song).

## 3. Invariants
- **Public projection KHÔNG lộ tag nội bộ** (tag là điều hành nội bộ CLB, per-tenant).
- Audience-filter chỉ giới hạn **hiển thị/mời**, không phải **eligibility** (eligibility = DD-41). Một member ngoài tag **vẫn có thể join** nếu kèo public + eligible (trừ khi kèo private/approval).
- Tenant-scoped RLS.

## 4. Dependencies
- **DD-41/DD-05** join eligibility (tách khỏi tag).
- **DD-08** level rank (không nhân đôi qua tag).
- **`feature_notifications_reminders`/`session_surface_refs`** cho audience-targeted announce.
- Migration: `membership_tags` per-tenant.

## 5. Propagation (khi build)
`feature_multi_tenant`/membership (tags), `feature_session_management` (announce audience bước), `feature_notifications_reminders` (audience filter), `schema.ts`+migration, tests. Public serializer **không** emit tag.

## 6. Test fixtures
host tạo tag + gán member · announce theo tag → chỉ member khớp được mời · member ngoài tag vẫn join được kèo public eligible · tag KHÔNG vào public_sessions · tag tenant-scoped (CLB A không thấy tag CLB B) · level dùng DD-08 rank (không tag trùng).

## 7. Quyết định (đã chốt)
tags-only per-tenant cho notification audience; join-eligibility = DD-41+DD-05 (tách); bỏ tier MVP; public không lộ tag. Ghi `decisions.md` DD-43 ✅.

**Nguồn:** `schema.ts:165` · `feature_marketplace_discovery.md:82` · DD-08/41/05 · `feature_notifications_reminders` · ảnh 1.
