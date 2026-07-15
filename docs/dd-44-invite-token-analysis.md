# 🔗 DD-44 Analysis — Invite-link token cho kèo private

> **Mục đích:** chốt token + **redemption contract** (entropy, binding, revoke, used_count, race). Ground vào canonical.
> **Ngày:** 2026-07-13 · **Re-check:** 2026-07-15 · **Canonical:** `schema.ts` (sessions.visibility/join_policy · join_requests) · `feature_cross_club_join_tech` (active-vs-waitlisted outcome) · DD-05/45 (join/waitlist) · DD-06 (venue) · DD-41 (gating). Ghi → `decisions.md` DD-44.

---

## 0. TL;DR — ✅ (duyệt)
- `session_invite_tokens` (tenant-scoped): **token random entropy ≥128-bit**, lưu **hash** (không raw); **bound `session_id`+`tenant_id`**; `expires_at`, `max_uses`, `used_count`, `revoked_at`.
- Mở link → trang join kèo **private** (không cần public marketplace), **vẫn qua `join_policy`+gating (DD-41)**. Token = **MỜI**, **không** hạ `visibility`.
- **`used_count` tăng khi REDEEM thành công** (open → active+charge **hoặc** waitlisted/no-charge; approval → pending) — **KHÔNG** tăng lúc chỉ mở link và không giảm sau cancel/reject/expire/leave.
- **Lock + idempotency lượt cuối** (`FOR UPDATE` trên token + capacity) → 2 request dùng lượt cuối → đúng 1 thắng.

---

## 0.1 Correction log
| Rev trước (thiếu) | Sự thật (chốt) |
|---|---|
| "hash-only (không đoán)" | Hash **không** làm token khó đoán — cần **entropy cao (≥128-bit)** ở raw token. |
| Không có redemption contract | Pin: binding session/tenant, revoke/rotate, used_count-on-redeem, lock lượt cuối. |

---

## 1. Canonical hiện trạng
| Sự thật | Nguồn |
|---|---|
| `sessions.visibility` (private\|public) + `join_policy` (open\|approval) + `join_requests` | `schema.ts:214/611` |
| **Thiếu** token share cho kèo private (private = ẩn marketplace, chưa có đường mời) | gap |
| Open-join/approve còn slot tạo active+charge; full tạo waitlisted/no-charge | `feature_cross_club_join_tech` §4 · DD-45 |
| Venue ẩn tới join thành công (DD-06) | edge#6 |

---

## 2. Schema + redemption contract
```sql
session_invite_tokens (
  id uuid PK,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  session_id uuid NOT NULL REFERENCES sessions(id),   -- bound
  token_hash text NOT NULL,        -- hash(raw); raw = random ≥128-bit, KHÔNG lưu raw
  expires_at timestamptz,
  max_uses integer,                -- NULL = unlimited
  used_count integer NOT NULL DEFAULT 0,
  revoked_at timestamptz,          -- revoke/rotate
  created_by uuid NOT NULL
)
```
**Redemption flow:**
1. Mở link (raw token) → verify `hash` + `tenant`/`session` bound + **not expired + not revoked + used_count<max_uses** → hiển thị trang join kèo private (**venue vẫn ẩn**).
2. Redeem (join): **`FOR UPDATE` token + session** → re-check limits + **gating (DD-41)** → open path tạo active+charge nếu còn slot **hoặc waitlisted/no-charge nếu full**; approval path tạo `join_requests(pending)` → **`used_count += 1`** → COMMIT (venue reveal chỉ nếu active).
3. **`used_count` tăng lúc REDEEM thành công**, không lúc mở link; redemption đã commit không hoàn lượt dùng sau cancel/reject/expire/leave.

## 3. Invariants
- **Token = MỜI, không hạ `visibility`** — kèo vẫn `private`, chỉ ai có link mới vào trang join; **vẫn qua join_policy+gating**.
- **Entropy ≥128-bit** + hash-at-rest → không brute-force/không đoán.
- **Race lượt cuối:** `FOR UPDATE` token + session → 2 redeem đồng thời tranh lượt token cuối → 1 thắng, 1 nhận "hết lượt". Capacity full tự nó không phải error: open path vào waitlist (DD-45).
- Venue/PII/nợ ẩn tới join thành công (DD-06/HR2); rate-limit/anti-scrape endpoint.

## 4. Dependencies
- **DD-05/45** (open/approval + active/waitlisted redeem outcome), **DD-41** (gating khi redeem), **DD-06** (venue post-join).
- Migration: bảng `session_invite_tokens` (tenant-scoped RLS).

## 5. Propagation (khi build)
`feature_session_management(.md/_tech)` (+ token issue/revoke + redeem), `feature_cross_club_join` (redeem = một entry join), `schema.ts`+migration, tests.

## 6. Test fixtures
issue token → redeem join private (qua gating) · open còn slot→active+charge · open full→waitlisted/no-charge nhưng vẫn consume một use · approval→pending/no roster/charge · mở link không tăng used_count · redeem thành công tăng used_count và cancel/reject/expire/leave không hoàn use · hết hạn/revoked/quá max_uses → reject · **race lượt cuối → 1 thắng** · venue ẩn tới active · token entropy đủ · token không hạ visibility.

## 7. Quyết định (đã chốt)
`session_invite_tokens` entropy≥128-bit/hash/bound session+tenant/revoke; redeem qua join_policy+gating; used_count-on-redeem; lock lượt cuối. Ghi `decisions.md` DD-44 ✅.

**Nguồn:** `schema.ts:214/611` · `feature_cross_club_join_tech` §4 · DD-05/06/41/45.
