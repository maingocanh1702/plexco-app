# 📍 DD-06 Analysis — Độ chi tiết vị trí public (area vs venue)

> **Mục đích:** chốt mức lộ vị trí ở public marketplace vs sau join. Ground vào canonical whitelist.
> **Ngày:** 2026-07-13 · **Canonical:** `schema.ts` (sessions.area/venue_name/venue_address · public_sessions:597) · `feature_marketplace_discovery.md` (whitelist §80) · `feature_session_management.md` (edge#6) · DD-05 (join). Ghi → `decisions.md` DD-06.

---

## 0. TL;DR — ✅ Chốt
- **Public projector emit `area` (quận/khu vực) ONLY.** `venue_name`/`venue_address` (+ SĐT/bản đồ) **chỉ lộ sau khi join/được duyệt** (return trong joined-person DTO).
- **Bất biến (test CI):** `venue_name`/`venue_address` **KHÔNG BAO GIỜ** vào `public_sessions` / public serializer. Khớp BRD NFR-S2 (public không PII/venue chính xác).

---

## 1. Canonical hiện trạng
| Sự thật | Nguồn |
|---|---|
| `sessions`: `area text`, `venue_name text`, `venue_address text` | `schema.ts:214` |
| `public_sessions` whitelist có **`area`**, KHÔNG có `venue_*` | `schema.ts:597` · `feature_marketplace_discovery.md:87` |
| Open/approval join → **return venue** trong joined DTO (sau COMMIT) | `feature_cross_club_join_tech:108` |
| Edge#6: "Venue details leak trước join → chỉ hiện area; chi tiết sau join/approval" | `feature_session_management.md` edge#6 |
| NFR-S2: public whitelist "không bao giờ ... venue chính xác" | BRD §8.1 |

---

## 2. Contract
| Bề mặt | Vị trí hiển thị |
|---|---|
| **Public marketplace** (`public_sessions`, discovery) | **`area` only** (quận/khu vực) |
| **Sau join thành công / được approve** | `venue_name` + `venue_address` (+ map/SĐT nếu có) trong joined-person DTO |
| **Invite-link private** (DD-44) | venue vẫn ẩn tới khi **redeem/join** thành công |

- **area** = coarse (quận/khu vực), đủ để player quyết định đi hay không; không đủ để định vị chính xác venue.
- Projector (DD-12) chỉ map `area` sang `public_sessions`; venue giữ ở canonical `sessions` (tenant-private).

## 3. Invariants
- **Exact-column invariant test:** `public_sessions` không chứa cột `venue_*`; public serializer emit đúng whitelist (`feature_marketplace_discovery` penetration test).
- Venue reveal gắn với **trạng thái active/approved** (không lộ cho `pending`/`waitlisted`/chỉ-mở-invite-link).
- Đồng nhất mọi surface (web/Zalo/Messenger) + mọi tenant (club + personal DD-46).

## 4. Dependencies
- **DD-12** projector/`public_sessions` (emit area).
- **DD-05** venue reveal post-join; **DD-44** post-redeem; **DD-45** waitlisted không thấy venue.
- **DD-41** không liên quan trực tiếp (gating khác venue).

## 5. Propagation (khi build)
`feature_marketplace_discovery(.md/_tech)` (whitelist = area; venue never public) + `feature_session_management` (edge#6) + projector contract + exact-column invariant test. **Đã cập nhật:** `feature_marketplace_discovery.md` MKT-OQ-1 → ✅.

## 6. Test fixtures
public detail chỉ có area · venue_* không vào public_sessions (invariant) · join thành công → DTO có venue · pending/waitlisted/mở-link-chưa-join → không venue · probe unknown area filter → empty (không lộ taxonomy).

## 7. Quyết định (đã chốt)
area-only public; venue post-join/approval; invariant test venue-never-public. Ghi `decisions.md` DD-06 ✅.

**Nguồn:** `schema.ts:214/597` · `feature_marketplace_discovery.md:80-87` · `feature_session_management.md` edge#6 · BRD NFR-S2 · DD-05/12/44/45/46.
