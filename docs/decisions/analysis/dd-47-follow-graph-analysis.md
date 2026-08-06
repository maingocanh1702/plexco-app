# 👥 DD-47 Analysis — Social follow graph (person↔person)

> **Mục đích:** chốt framework follow graph + **security boundary = global protected**. Ground vào canonical. Build P4+.
> **Ngày:** 2026-07-13 · **Canonical:** `schema.ts` (persons global) · `0009_rls_policies_grants.sql:11` (global protected tables) · `0010` (SECURITY DEFINER fns) · `feature_identity` (merge DD-01) · DD-48 (visibility) · `feature_user_settings` §7 · HANDOFF §P6/§P7. Ghi → `decisions.md` DD-47.

---

## 0. TL;DR — ✅ framework (owner), build P4+
- Bảng **GLOBAL `person_follows`** (cạnh có hướng `follower→followee`, **KHÔNG `tenant_id`** — identity global plane §P6), `status ∈ {pending,accepted}`.
- **⚠️ Security boundary = GLOBAL PROTECTED** (như `persons`/`accounts`/`link_codes`): theo `0009:11` — **NO blanket grant cho role `app`**; truy cập **chỉ qua identity service / `SECURITY DEFINER` narrow functions**. Mỗi function fixed `search_path`, `REVOKE ... FROM PUBLIC`, chỉ `GRANT EXECUTE` cho `app`; actor lấy từ verified session, không từ URL/body.
- **Auto-accept theo DD-48:** followee public → `accepted` ngay; private → `pending` (approve/reject).
- **KHÔNG cấp quyền tiền/PII/roster** — follow chỉ mở approved public-profile fields (DD-48). Follow ≠ membership.

---

## 0.1 Correction log
| Rev trước (SAI) | Sự thật |
|---|---|
| "authz app choke-point" (đủ) | Global protected → **grants theo `0009` qua SECURITY DEFINER/identity service, no blanket grant**; app choke-point là lớp trên, không thay DB boundary. |

---

## 1. Canonical hiện trạng
| Sự thật | Nguồn |
|---|---|
| `persons` = anchor GLOBAL (no `tenant_id`); memberships/players = person↔tenant/session (không person↔person) | `schema.ts:39` |
| Global protected tables (persons/channel_identities/link_codes/merge_*/accounts/web_sessions/account_identities/magic_links/…): **NO blanket grant `app`**; reached only via identity/auth service or **SECURITY DEFINER** | `0009:11-14` |
| SECURITY DEFINER narrow fns pattern | `0010` |
| `feature_player_view` = person-self only (chưa cross-user) | `feature_player_view` |
| Merge (DD-01): re-parent players/charges + tombstone | `identity-model` §merge |

---

## 2. Schema + authz
```sql
person_follows (
  id uuid PK,
  follower_person_id uuid NOT NULL REFERENCES persons(id),
  followee_person_id uuid NOT NULL REFERENCES persons(id),
  status text NOT NULL CHECK (status IN ('pending','accepted')),
  requested_at timestamptz NOT NULL DEFAULT now(), decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(follower_person_id, followee_person_id),
  CHECK (follower_person_id <> followee_person_id),  -- cấm self-follow
  CHECK ((status='pending') = (decided_at IS NULL))
)
-- GLOBAL plane: NO tenant_id, NO blanket grant to `app`.
-- Table: no SELECT/INSERT/UPDATE/DELETE grant to app or PUBLIC.
-- Access via SECURITY DEFINER fns: follow/unfollow/approve/reject/removeFollower/list*.
-- Every fn: fixed search_path; REVOKE FROM PUBLIC; GRANT EXECUTE TO app.
```
- **Fail-closed status:** cột `status` **không có default**; narrow follow function phải set tường minh. `pending` có `decided_at=NULL`; `accepted` (auto hoặc approve) có `decided_at=now()`.
- **Actor binding:** identity service resolves `actor_person_id` from the verified web session/channel identity; request URL/body supplies only target/follower ids. Privileged function re-checks `actor=follower` for follow/unfollow and `actor=followee` for approve/reject/remove before mutation.
- **Auto-accept (DD-48):** follow function lock target `persons` row, đọc visibility trong cùng transaction: `public` → insert `accepted`; `private` → insert `pending` → followee approve→`accepted` / reject→xoá edge (mở `blocked` = open item DD-48). Visibility update dùng cùng target-row lock, nên follow đồng thời không quan sát trạng thái nửa chừng.
- **Đổi visibility (DD-48):** public→private: follower `accepted` cũ **grandfather**; mới → pending. private→public: `pending` auto-accept.

## 3. Invariants (security)
- **DB boundary:** `person_follows` no-blanket-grant; chỉ SECURITY DEFINER fns (như `accounts`/`web_sessions`). App authz = lớp bổ sung.
- **KHÔNG mở tiền/PII/roster:** follow chỉ mở approved public-profile fields (DD-48). **Tuyệt đối không** `charges`/nợ/roster/SĐT/email/gender/`pay_code`.
- **Idempotent theo canonical state, KHÔNG tái dùng `processed_commands` tenant-scoped:** follow lại → `UNIQUE` + return edge hiện tại; approve edge đã accepted → return accepted; unfollow/reject/remove khi edge đã absent → success/no-op. Approve edge chưa từng tồn tại → `FOLLOW_NOT_FOUND` (không bịa replay result).
- Cấm self-follow (CHECK).

## 4. Merge (DD-01) + notify
- **Merge:** lock toàn bộ incident edges của source/canonical; tính endpoint canonical; drop self-edge; collapse duplicate pair với precedence `accepted > pending`; rồi update/delete survivors trong cùng merge transaction. Không update mù trước dedupe vì có thể đụng `UNIQUE(follower,followee)` giữa chừng.
- **Notify follow-request (impl-gap):** person-directed GLOBAL; hạ tầng `notification_intents`/`outbox_events` hiện **tenant-scoped** (`tenant_id NOT NULL`) → không cover. Build chọn: (a) đường notify global mới, hoặc (b) SSE person-self / in-app inbox (DD-38). Ghi open item ở `_tech`.

## 5. Dependencies
- **DD-48** visibility (auto-accept/approval + profile fields).
- **DD-01** merge re-parent+dedupe.
- **DD-38** in-app inbox (notify option).
- `0009`/`0010` (global-protected grants + SECURITY DEFINER).
- Migration: bảng global + fns. Build **P4+** (khi user-settings social vào scope).

## 6. Propagation (khi build P4+)
`feature_user_settings(.md/_tech)` §7 (follow + functions), `feature_identity`/`_tech` (lock/dedupe merge), `feature_player_view` (pointer: cross-user social path tách khỏi `/me`), `schema.ts`+migration (`person_follows`, no table grant) + `0009` protected-table comment + narrow functions migration, tests. **Đã cập nhật:** user-settings product/BE status + security boundary → ✅ framework.

## 7. Test fixtures
cấm self-follow · status không default + decided-at shape · state-idempotent follow/approve/delete · auto-accept public · pending private + approve/reject · concurrent follow↔visibility dùng cùng target-row lock · actor từ verified session, không URL/body · đổi visibility (grandfather/auto-accept) · merge lock+dedupe trước update (accepted>pending, drop self) · **follow path KHÔNG rò tiền/PII/roster** · role `app`/PUBLIC không đọc-ghi trực tiếp bảng · PUBLIC không execute fn · `app` chỉ execute narrow fn.

## 8. Quyết định (đã chốt framework, build P4+)
`person_follows` global protected (grants `0009` SECURITY DEFINER); directed pending/accepted; auto-accept public/approve private (DD-48); no money/PII/roster; merge re-parent+dedupe. Ghi `decisions.md` DD-47 ✅ framework.

**Nguồn:** `schema.ts:39` · `0009:11-14` · `0010` · `identity-model` §merge · DD-48/01/38 · `feature_user_settings` §7 · HANDOFF §P6.
