# 🔗 DD-44 Analysis — Invite-link token cho kèo private

> **Mục đích:** chốt token + **redemption contract** (entropy, binding, revoke, used_count, race). Ground vào canonical.
> **Ngày:** 2026-07-13 · **Re-check:** 2026-07-19 · **Canonical:** `schema.ts` (sessions.visibility/join_policy · join_requests) · `feature_cross_club_join_tech` (active-vs-waitlisted outcome) · DD-05/45 (join/waitlist) · **DD-49 (rejoin/correction)** · DD-06 (venue) · DD-41 (gating) · DD-42 (reliability restriction) · DD-52 (manual join restriction). Ghi → `decisions.md` DD-44.

---

## 0. TL;DR — ✅ (duyệt)
- `session_invite_tokens` (tenant-scoped): **token random entropy ≥128-bit**, lưu **hash** (không raw); **bound `session_id`+`tenant_id`**; `expires_at`, `max_uses`, `used_count`, `revoked_at`.
- Mở link → trang join kèo **private** (không cần public marketplace), **vẫn qua `join_policy` + DD-41 + DD-42 + shared `evaluateJoinRestriction()` DD-52**. Token = **MỜI**, **không** hạ `visibility`.
- **`used_count` tăng cùng state transition REDEEM thành công** (open first-entry → active+charge **hoặc** waitlisted/no-charge; DD-49 rejoin → active carry-over/append lifecycle hoặc waitlisted không new lifecycle; approval first-entry/rejoin → pending sau mọi preflight). Current `active|waitlisted|pending`, processed-command replay, ban/restriction hoặc unknown/unimplemented rejoin → current/error outcome, **không request/player/charge/token mutation và không consume thêm use**. Không tăng lúc chỉ mở link và không giảm sau cancel/reject/expire/leave.
- **Lock + idempotency lượt cuối**: resolve keys trước, transaction lock `session→token`, rồi re-check token/identity/current state/restrictions/capacity. Hai request dùng lượt cuối → đúng một state transition thắng.

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
| Open-join/approve first-entry còn slot tạo active+charge; full tạo waitlisted/no-charge. DD-49 rejoin active→carry-over/append-refunded; full→waitlisted giữ history/defer-refunded | `feature_cross_club_join_tech` §4 · DD-45/49 |
| Venue ẩn tới active outcome (DD-06); approved-waitlisted vẫn ẩn | edge#6 |

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
1. Mở link (raw token) → verify `hash` + `tenant`/`session` bound + **not expired + not revoked + used_count<max_uses** → hiển thị trang join kèo private (**venue vẫn ẩn**). Đây chỉ là advisory read; redeem phải re-check toàn bộ.
2. Redeem (join): resolve trusted actor/token/session keys, rồi transaction **`FOR UPDATE` session → token**. Re-check raw-token hash, immutable tenant/session binding, expiry và revocation trước khi trả dữ liệu. Sau đó lookup exact actor+request-fingerprint-bound processed command + existing membership/player/request trước restriction preflight. Processed replay hoặc current `active|waitlisted|pending` → return current outcome, không consume thêm use; exhausted `max_uses` không phá idempotent current return. Chỉ một absent/`left` transition mới phải pass `used_count<max_uses`, session joinability, **DD-41, DD-42 và shared DD-52**. Current ban/restriction → fail-closed, không request/player/charge/token/host-alert mutation.
3. For an absent/`left` transition, lock every nonterminal DD-45 root after `session→token` and **before** membership/player/finance. Open path: first-entry active+charge nếu còn slot hoặc waitlisted/no-charge nếu full; existing `left` re-derive DD-49 disposition — active thì carry-over/append refunded lifecycle, full thì waitlisted và không new lifecycle. Approval path: first-entry tạo `join_requests(pending)`; existing `left` request-create chỉ preflight live disposition, **không bind proof vào command/request**. Approve sau đó phải re-check DD-41/DD-42/DD-52 + re-derive DD-49 dưới lock. Unknown/unimplemented → `REJOIN_REQUIRES_REVIEW`, không request/player/financial mutation và không consume token.
4. **`used_count += 1` atomic chỉ với absent/`left` redeem state transition thành công** → COMMIT; venue chỉ nếu player active. Nếu active outcome lấp capacity, cùng transaction resolve mọi nonterminal DD-45 promotion root.
5. Redemption đã commit không hoàn lượt dùng sau cancel/reject/expire/leave.

## 3. Invariants
- **Token = MỜI, không hạ `visibility`** — kèo vẫn `private`, chỉ ai có link mới vào trang join; **vẫn qua join_policy + DD-41/DD-42/DD-52**.
- **Entropy ≥128-bit** + hash-at-rest → không brute-force/không đoán.
- **Race lượt cuối:** lock order `session→token` → 2 redeem đồng thời tranh lượt token cuối chỉ một state transition tăng `used_count`; `max_uses` gates transition mới, còn exact bound replay/current-state return không ăn lượt mới. Capacity full tự nó không phải error: open path vào waitlist (DD-45).
- Venue/PII ẩn tới outcome `players.status='active'`; approved-but-waitlisted vẫn chỉ area/position. Nợ mới cũng không phát sinh cho refunded rejoin khi còn waitlisted (DD-06/45/49/HR2); rate-limit/anti-scrape endpoint.

## 4. Dependencies
- **DD-05/45/49** (open/approval + first-entry/rejoin active/waitlisted redeem outcome), **DD-41/42/52** (gating + reliability/manual restriction trên mọi absent/left redeem và approve), **DD-06** (venue active-only).
- Migration: bảng `session_invite_tokens` (tenant-scoped RLS).

## 5. Propagation (khi build)
`feature_session_management(.md/_tech)` (+ token issue/revoke + redeem), `feature_cross_club_join` (redeem = một entry join), `schema.ts`+migration, tests.

## 6. Test fixtures
issue token → redeem join private qua DD-41/DD-42/DD-52 · first-entry open còn slot→active+charge · first-entry open full→waitlisted/no-charge nhưng consume đúng một use · DD-49 rejoin active→carry-over/append lifecycle; full→waitlisted/no-new-lifecycle · first-entry approval→pending/no roster/charge + consume · rejoin approval preflight-pass→pending/no-proof-storage + consume · current active/waitlisted/pending + token đã max-use hoặc exact command replay→current outcome/no extra consume · expired/revoked/invalid binding vẫn deny trước data return · ban/restriction absent/left→no request/player/charge/token/host-alert mutation · ban imposed after active/waitlisted→repeat redeem returns current state, không `PLAYER_BANNED`/extra use · state drift trước approve→request pending/zero mutation · unknown disposition→review/no request/mutation/no consume · mở link không tăng used_count · cancel/reject/expire/leave không hoàn use · hết hạn/revoked/quá max_uses cho transition mới → reject · **race lượt cuối → 1 transition thắng** · invite active-fill vs claimed worker follows session→token→root→player/finance, resolves old root and stale worker mutates nothing · venue chỉ khi active · token entropy đủ · token không hạ visibility.

## 7. Quyết định (đã chốt)
`session_invite_tokens` entropy≥128-bit/hash/bound session+tenant/revoke; redeem qua join_policy+DD-41/DD-42/DD-52; existing current state/replay không consume thêm; used_count atomic với absent/left transition; lock `session→token` bảo vệ lượt cuối. Ghi `decisions.md` DD-44 ✅.

**Nguồn:** `schema.ts:214/611` · `feature_cross_club_join_tech` §4 · DD-05/06/41/42/45/49/52.
