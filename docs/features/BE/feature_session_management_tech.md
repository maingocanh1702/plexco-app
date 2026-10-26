# Feature: Session Management — Backend Tech Spec

> **Canonical phase:** P2/P4  
> **Version:** 2.38 · 2026-10-26
> **Status:** Reviewed  
> **Implementation:** DB substrate (`0014` waitlist, `0019` same-tenant integrity, `0024` public-capacity CHECK) + **SessionService đủ 6 command** (`packages/db/src/session-service.ts`: create · publish · announce · update · close · cancel) + **5 route** (`POST /api/sessions` · `/[id]` · `/[id]/publish` · `/[id]/close` · `/[id]/cancel`; `announce` gate DD-56 clause 1) đã merge (đo 2026-09-06 tại `30a3e90`, re-verified 2026-09-11 tại `6bfa905`); guest-note commands (`CreateGuestNote`/`DeleteGuestNote`) + 2 route đã merge PR #13; roster/money writer (`roster-service.ts` `addMemberToSession`/`removePlayerFromSession` · `payment-manual.ts` `markPaid` · `payment-reversal.ts` `reversePaymentAllocation`) + 4 route (`POST /[id]/players` · `DELETE /[id]/players/[playerId]` · `POST /[id]/mark-paid` · `POST /[id]/payments/[allocationId]/reverse`) đã merge (đo 2026-10-15 tại `d962b0c`); route đọc `GET /api/sessions` + `GET /api/sessions/[id]` **đã có** (`apps/web/app/api/sessions/route.ts`, `[id]/route.ts`; đo 2026-10-15 tại `d962b0c`); **chưa có**: `GET /api/sessions/:id/guest-notes` (chờ Milestone 2, cùng body-less resolver), projector thật (stub `dlq`), auto-promote, auto-expiry. ⚠️ Hai route guest-note đi qua choke-point tạm `lib/session-command-route.ts` — **DD-56 amendment #2 chỉ pin NĂM route**, xem OPEN NOTE 15/09 dưới DD-56 · authority: `../../standards/BUILD-STATUS.md` (Doc status ≠ Implementation status)
> **Product spec:** `../FE/feature_session_management.md`  
> **References:** `../../product/TDD.md` §3.2/3.8 · `../../standards/business-rules.md` · `../../standards/decisions.md` DD-32/DD-39/DD-45/**DD-45a**/DD-49/**DD-52**/**DD-65..68**/**DD-121** · `../../decisions/analysis/dd-45-waitlist-analysis.md` · `feature_channel_booking_funnel_tech.md` · `feature_user_settings_tech.md` (`deriveChargeAmount`) · `docs/autopilot-invariant-catalog.md` (`session-lock-ordering`/`publish-suspend-gate`/`session-command`/`billing-authz`/`retry-liveness`/`member-safety`)

> **DD-32/DD-45/DD-49 future contract (chưa build):** waitlisted tự thân không chiếm capacity, không tạo charge/new-obligation (venue chỉ ẩn khi `sessions.hide_exact_address` ON, DD-139); live paid-unlinked booking intent có thể giữ đúng một slot trong 15 phút. Admission occupancy dùng một helper `getSessionOccupancy()` (DD-133 (a)). Promotion free/linked giữ DD-45/DD-49 timing; paid+unlinked candidate vẫn waitlisted (venue chỉ ẩn khi `sessions.hide_exact_address` ON, DD-139) tới verified settlement, expiry release + audited requeue-tail. Promotion/booking-intent runtime và intent schema chưa tồn tại.
>
> **Capacity runtime (2026-09-16, `abbdb8c`):** `UpdateSession` kiểm capacity hữu hạn đã đổi dưới session lock: dưới active roster → `CAPACITY_BELOW_ROSTER` trước; còn lại dưới `sessionOccupancy` → `CAPACITY_BELOW_OCCUPANCY`. Helper hiện tại đếm active players + guest notes; pending/payment holds chưa build. Các công thức occupancy tương lai trong session spec, TDD và booking/projector spec đang mâu thuẫn, chờ đối chiếu tại `../../autopilot-backlog.md` → `session-publish-public-projector`; phần sửa runtime này không chọn công thức tương lai. **Đã đối chiếu 2026-10-16:** DD-133 (owner ký) chọn công thức duy nhất `getSessionOccupancy()` = active players + guest notes + live holds (= 0 tới khi có bảng hold, DD-132/DD-135) (+ pending invites sau migration thêm chúng); public chỉ `slots_open`; các công thức khác trong spec này là con trỏ tới nó.
>
> **DD-45a owner-final (2026-07-28):** future promotion slice adds partial `UNIQUE (session_id, waitlist_position) WHERE status='waitlisted'` in a new monotonic migration. Duplicate preflight HALTs for manual repair; no auto-renumber. Gaps remain valid; the session-lock allocator plus the database unique constraint form the allocation/final-fence pair. No migration or runtime change has landed from this decision.

---

## 1. Tổng quan triển khai

```text
Surface (Zalo/Messenger/Web) → Command (CreateSession/Update/Publish/Close/Cancel)
    → SessionService → [State + Deduped Command + Outbox] COMMIT
                            ↓
                Projectors: Zalo/Messenger message, Web SSE, Public search
```

Commands: `CreateSession`, `UpdateSession`, `PublishSession`, `AnnounceSession`, `CloseSession`, `CancelSession`, `InviteFriend`, `CreateGuestNote`, `DeleteGuestNote`, `ApproveInvite`, `RejectInvite`, `GenerateOccurrences`. Mỗi command mang `commandId`, tenant/actor từ trusted context, `expected_version` cho conflicting edits. `PublishSession` là transition status-only `draft` → `open` (algorithm §4) — không đổi `visibility`. `CancelSession` nhận nguồn `draft` hoặc `open`, transition sang `cancelled` (algorithm §4, subsection "Draft discard + auto-expiry"); một scheduled job invoke cùng mutation cho draft quá giờ bị bỏ quên, không qua client `commandId`. *(Hard-delete session: rút khỏi spec 2026-08-13 — cơ chế chốt ở `decisions.md` DD-104 D0–D4, author lại trong slice DD-104.)* `InviteFriend` (player active invite friend đã follow) + `CreateGuestNote` / `DeleteGuestNote` (khách ngoài hệ thống) + `ApproveInvite` / `RejectInvite` (host duyệt pending) — §3 API Contract, §4 Algorithm.

**Design decisions:**
- Single domain service shared by chat + web — no duplicate logic (catalog invariant `session-command`, `docs/autopilot-invariant-catalog.md` — SessionService command family, `packages/db/src/session-service.ts`).
- Optimistic concurrency via `version` column — stale edits rejected.
- Outbox events carry identifiers + safe changed fields — projectors reload canonical data cho sensitive rendering.
- Messenger central/tenant adapters emit the same commands. A single pre-dispatch interaction interceptor owns create wizard state; final consume re-authorizes `session.manage` and target tenant before `SessionService`.

### Entry points

| Entry | Caller | Mô tả |
|-------|--------|-------|
| `POST /api/sessions` | Host (web/Messenger) | `CreateSession` command |
| `PATCH /api/sessions/:id` | Host | `UpdateSession` (optimistic `expected_version`) |
| `POST /api/sessions/:id/publish` | Host | `PublishSession` (draft → open, billing gate step 6) |
| `POST /api/sessions/:id/cancel` | Host / System (auto-expiry) | `CancelSession` (draft\|open → cancelled) |
| `POST /api/sessions/:id/close` | Host | `CloseSession` (open → closed) |
| `POST /api/sessions/:id/announce` | Host | `AnnounceSession` → outbox → channel projectors |
| `GenerateOccurrences` job (pg-boss) | System | Recurring session → generate future instances |
| Auto-expiry job (pg-boss) | System | Cancel forgotten drafts past deadline |
| `POST /api/sessions/:id/invite` | Player (active) | `InviteFriend` command (friend đã follow) |
| `POST /api/sessions/:id/guest-notes` | Player (active) | `CreateGuestNote` command |
| `DELETE /api/sessions/:id/guest-notes/:noteId` | Player (note creator) | `DeleteGuestNote` command |
| `GET /api/sessions/:id/guest-notes` | Player (active) / Host | List guest notes for session — **CHƯA BUILD**, chờ Milestone 2 (xem §3) |
| `POST /api/sessions/:id/players/:playerId/approve` | Host | `ApproveInvite` command |
| `POST /api/sessions/:id/players/:playerId/reject` | Host | `RejectInvite` command |
| Projectors (Zalo/Messenger/Web SSE/Public) | Outbox consumer | Render canonical session changes |

---

## 2. Database Schema + Edge Cases (BE)

### Schema

```sql
CREATE TABLE sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  sport_id uuid NOT NULL REFERENCES sports(id),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  timezone text NOT NULL,  -- IANA timezone
  venue_name text,
  venue_address text,
  area text,  -- public whitelist (quận/khu vực)
  skill_level text, -- current live field; DD-41 expand→contract retires only after ranked source/backfill lands
  price_amount integer NOT NULL DEFAULT 0 CHECK (price_amount >= 0),
  slots_max integer,  -- NULL = unlimited (chỉ non-public — xem note Capacity × visibility dưới DDL)
  visibility text NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'public')),
  join_policy text NOT NULL DEFAULT 'open' CHECK (join_policy IN ('open', 'approval')),
  allow_player_invite boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'open', 'closed', 'cancelled')),
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at),
  CHECK (slots_max IS NULL OR slots_max > 0),
  CONSTRAINT sessions_public_capacity_chk
    CHECK (NOT (visibility = 'public' AND slots_max IS NULL))  -- 0024, landed + validated
);
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions FORCE ROW LEVEL SECURITY;

CREATE TABLE session_recurrence_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  rrule text NOT NULL,
  timezone text NOT NULL,
  version integer NOT NULL DEFAULT 1,
  last_generated_at timestamptz
);

CREATE TABLE session_occurrences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recurrence_rule_id uuid NOT NULL REFERENCES session_recurrence_rules(id),
  session_id uuid NOT NULL REFERENCES sessions(id),
  local_occurrence_key text NOT NULL,
  UNIQUE (recurrence_rule_id, local_occurrence_key)
);

CREATE TABLE session_surface_refs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  session_id uuid NOT NULL REFERENCES sessions(id),
  platform text NOT NULL,
  target text NOT NULL,
  external_ref text,
  UNIQUE (session_id, platform, target)
);

CREATE TABLE players (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  session_id uuid NOT NULL REFERENCES sessions(id),
  membership_id uuid NOT NULL REFERENCES memberships(id),
  status text NOT NULL DEFAULT 'active'
    CONSTRAINT players_status_chk CHECK (status IN ('active', 'left', 'waitlisted')),  -- live `0014:79-80` không có 'pending' (audit 2026-09-06 #11); thêm giá trị = migration mới
  waitlist_position integer,            -- 0014 ALTER TABLE, merged on main (1a6ac38)
  invited_by_person_id uuid REFERENCES persons(id),  -- NULL = self-join; non-NULL = invited by another player
  joined_at timestamptz NOT NULL DEFAULT now(),
  last_reminded_at timestamptz,
  CONSTRAINT players_waitlist_shape_chk
    CHECK ((status = 'waitlisted') = (waitlist_position IS NOT NULL)),
  CONSTRAINT players_waitlist_position_positive_chk
    CHECK (waitlist_position IS NULL OR waitlist_position > 0),
  UNIQUE (tenant_id, session_id, membership_id)
);

-- CHECK constraints phải đặt tên TƯỜNG MINH. Bài học từ 0002: khai báo inline
-- unnamed khiến Postgres tự đặt `players_status_check`, lệch với tên
-- `players_status_chk` mà schema.ts khai báo — tên đó chưa từng được apply lên
-- database nào. 0014 drop cả hai spelling rồi add lại đúng tên; đừng lặp lại
-- kiểu inline unnamed cho bảng mới.
--
-- 0019_tenant_integrity_fks đã thêm same-tenant composite candidate keys/FKs cho:
-- (tenant_id, session_id) → sessions và (tenant_id, membership_id) → memberships,
-- đồng thời buộc session_surface_refs(tenant_id, session_id) cùng tenant.
-- Reuse các constraint đã land; không recreate hoặc liệt kê DD-68 như migration pending.

CREATE TABLE session_guest_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  session_id uuid NOT NULL REFERENCES sessions(id),
  created_by_person_id uuid NOT NULL REFERENCES persons(id),
  guest_name text NOT NULL
    CONSTRAINT guest_name_length CHECK (char_length(guest_name) BETWEEN 1 AND 100),
  note text
    CONSTRAINT note_length CHECK (note IS NULL OR char_length(note) <= 200),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Trigger: max 3 guest notes per player per session (defense-in-depth;
-- service also checks under session lock before INSERT)
CREATE OR REPLACE FUNCTION session_guest_note_limit_guard()
RETURNS TRIGGER AS $$
BEGIN
  IF (SELECT count(*) FROM session_guest_notes
      WHERE session_id = NEW.session_id
        AND created_by_person_id = NEW.created_by_person_id) >= 3
  THEN RAISE EXCEPTION 'GUEST_NOTE_LIMIT_REACHED'
    USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_session_guest_note_limit
  BEFORE INSERT ON session_guest_notes
  FOR EACH ROW EXECUTE FUNCTION session_guest_note_limit_guard();

-- 0044 (✅ landed 2026-09-11, PR #12 — codex review hardening beyond this
-- v2.21 draft):
-- (a) session_guest_notes carries an additional same-tenant composite FK
--     `(tenant_id, session_id) -> sessions(tenant_id, id)` (DD-68/0019
--     pattern) — RLS alone does not stop tenant A referencing tenant B's
--     session_id, since FK checks are not RLS-filtered; (b)
--     session_guest_note_limit_guard() locks the sessions row
--     (`PERFORM 1 FROM sessions WHERE id = NEW.session_id FOR UPDATE`)
--     BEFORE counting, so the trigger's own limit holds under real
--     concurrency instead of only sequential calls. See
--     packages/db/migrations/0044_session_guest_notes.sql for the exact,
--     authoritative DDL — this block stays as the v2.21 draft it always was.

-- v2.21 draft note — ĐÍNH CHÍNH 2026-09-12 (ap3-intake rescore, INTAKE.md mục A): dòng gốc claim
-- "pending đã thêm vào players_status_chk enum" là SAI. Constraint vẫn đúng nguyên
-- ('active','left','waitlisted') từ 0014_players_waitlist.sql — chưa migration nào khác từng
-- chạm nó, kể cả 0044 (chính migration đó tự flag đúng lỗi này trong SCOPE FENCE comment, 2026-09-11).
-- Thêm 'pending' là prerequisite slice của D1 (InviteFriend/ApproveInvite/RejectInvite,
-- ap3/features/session-management/PLAN.md D1 — vẫn open), không phải việc của migration guest-note.
-- waitlist_shape_chk vẫn đúng vì pending KHÔNG có waitlist_position (chỉ waitlisted mới có); câu
-- "pending chiếm slot, đếm vào occupancy" mô tả hành vi SẼ CÓ sau khi D1 thêm giá trị này, không
-- phải hành vi hôm nay (pending không tồn tại nên không tham gia occupancy hiện tại).
```

> **Capacity × visibility (PRD E#7 authority):** `visibility='public'` bắt buộc `slots_max IS NOT NULL` — public session không được unlimited; `NULL` = unlimited vẫn hợp lệ cho non-public. Validated DB constraint `sessions_public_capacity_chk` đã land trong `0024_public_visibility_capacity_check.sql`, nên direct INSERT/UPDATE vi phạm bị reject. SessionService validation trên create **và mọi update dẫn tới public** vẫn bắt buộc để trả domain error `MISSING_DISCOVERY_FIELDS` trước DB exception. Guard consume-time/projector vẫn giữ defense-in-depth cho pre-`0024` data, fixture hoặc constraint-bypass; không được dùng chúng để hạ claim DB invariant hoặc claim service/projector đã build.

### Indexes

```sql
CREATE INDEX idx_sessions_tenant_status ON sessions(tenant_id, status);
CREATE INDEX idx_sessions_starts_at ON sessions(starts_at) WHERE status = 'open';
CREATE INDEX idx_sessions_draft_starts_at ON sessions(starts_at) WHERE status = 'draft';  -- auto-expiry claim query, §4 Draft discard + auto-expiry — mirrors idx_sessions_starts_at pattern, not yet applied (Migration & Rollback)
CREATE INDEX idx_session_surface_refs_session ON session_surface_refs(session_id);
CREATE INDEX idx_players_waitlist_order
  ON players(session_id, status, waitlist_position, joined_at, id);
CREATE INDEX idx_players_invited_by ON players(invited_by_person_id) WHERE invited_by_person_id IS NOT NULL;
CREATE INDEX idx_session_guest_notes_session ON session_guest_notes(session_id, created_by_person_id);
```

### Migration & Rollback

> Grep live `packages/db/migrations/` ngày 2026-07-27: `0000`–`0024` đã merge (25 migrations; tail `0024_public_visibility_capacity_check.sql`). **Re-verified 2026-09-11 tại `6bfa905`:** tail hiện tại `0043_identity_link_code_issue_consume.sql` (44 migrations `0000`–`0043`) — 19 migration mới sau `0024`, không cái nào chạm `sessions`/`players`/`session_guest_notes` (grep xác nhận). Baseline `sessions` · recurrence · surface refs · `players` từ `0002`; waitlist objects từ `0014`; same-tenant candidate keys/FKs DD-68 từ `0019`; public-capacity CHECK từ `0024`. Tất cả **reuse, không recreate**.
>
> **Update 2026-09-11 (session-management-m03-guest-note-schema-migration):** tail nay là `0044_session_guest_notes.sql` (45 migrations `0000`–`0044`) — 0044 lands đúng 3 object pending nêu dưới đây.

- **Migration (genuinely new → migration mới monotonic sau tail hiện hành):** DD-45a hardening `UNIQUE (session_id, waitlist_position) WHERE status='waitlisted'`; retry objects (`waitlist_entry_version`, root `promotion_retry_jobs` + candidate events — §4, rollout §6 bước 4); `idx_sessions_draft_starts_at` partial index cho auto-expiry claim query (§4 Draft discard + auto-expiry, `docs-session-draft-lifecycle`) — chưa applied, cùng budget `≤1 monotonic migration`. DD-45a migration phải preflight duplicate trước DDL: có bất kỳ duplicate nào thì **HALT/manual**, không auto-renumber; gaps hợp lệ. **Không** đưa DD-68 hoặc public-capacity CHECK vào danh sách pending: chúng đã land ở `0019`/`0024`. Auto-expiry job cũng cần privileged cross-tenant execution (role, grants, migration wiring) + queue/cron registration — **build-slice detail, mirror `feature_billing_lifecycle_tech.md` §4 Daily Lifecycle Job**.
- **✅ Landed tại `0044_session_guest_notes.sql`** (PR #12, session-management-m03-guest-note-schema-migration, `ap3/features/session-management/PLAN.md` Milestone 3a; audit 2026-09-11, `ap3/features/session-management/INTAKE.md` R3.2/R6.1): ba object sau — đặc tả đủ trong §2 SQL từ v2.21 (2026-08-12) nhưng KHÔNG có trong `schema.ts` hay bất kỳ migration nào đã merge tới `0043` (danh sách pending phía trên, grep gốc dated 2026-07-27 trước v2.21, chưa từng track chúng) — nay đã có trong `schema.ts` và migration `0044`: (1) `sessions.allow_player_invite boolean NOT NULL DEFAULT true`; (2) `players.invited_by_person_id uuid REFERENCES persons(id)` + `idx_players_invited_by`; (3) bảng `session_guest_notes` đầy đủ (id/tenant_id/session_id/created_by_person_id/guest_name/note/created_at, 2 CHECK độ dài, trigger `trg_session_guest_note_limit`) + `idx_session_guest_notes_session`. **Hardening ngoài draft v2.21 gốc (codex review vòng 1):** `session_guest_notes` thêm same-tenant composite FK `(tenant_id, session_id) -> sessions(tenant_id, id)` (mẫu DD-68/0019 — RLS một mình không chặn tenant A trỏ session_id của tenant B, vì FK check không lọc qua RLS); `session_guest_note_limit_guard()` khoá row `sessions` (`FOR UPDATE`) TRƯỚC khi đếm để giới hạn 3-note giữ đúng dưới concurrency thật, không chỉ sequential call. **Vòng 2** bỏ `UPDATE` khỏi grant (xem changelog v2.28). Schema-only — mirror 0014's "EXPAND ONLY, code stays dark" precedent: không command/route/waitlist code. Milestone 3b (guest-note commands) chờ milestone này merge trước khi được `plan-emit`. Rollback: disable invite/guest-note routes trước, rồi revert 3 object trên bằng forward migration; KHÔNG ảnh hưởng `sessions`/`players` baseline (`0002`) hay waitlist (`0014`).
- **Rollback:**

| Bước | Hành động | An toàn? |
|------|-----------|----------|
| 1 | Disable session routes/commands + waitlist entry/promotion + retry worker + recurrence generation job | ✅ |
| 2 | Rollback = **forward migration mới** (KHÔNG rewrite/un-merge lịch sử). Chỉ revert objects genuinely-new của future slice. `0014`/`0019`/`0024` đã land: mọi thay đổi các waitlist/integrity/capacity constraints cần dependency/data proof riêng; không drop như rollback của service slice | ✅ Có điều kiện |
| 3 | Drop baseline `sessions`/`players`/recurrence/surface refs của `0002` | ❌ NEVER — migration đã apply trên main, có thể chứa session/roster thật |

### Edge Cases (Backend)

| # | Category | Case | Xử lý |
|---|----------|------|-------|
| 1 | Concurrency | Capacity check + player insert race | Single transaction + `SELECT ... FOR UPDATE` on session row |
| 2 | Concurrency | Web + chat edit same session | Optimistic locking via `version` — stale version → `STALE_VERSION` error |
| 3 | Concurrency | Duplicate command (same commandId) | Command dedup table — return previous result |
| 4a | Data Integrity | **Price** change with existing charges | Lock `session→root job→roster/finance`, then require explicit `impact_policy` (DD-49). Trích dẫn "edge #4" gắn với `impact_policy` (vd `session-command-update-v3.md`, `docs-impact-policy-contract.json` §A2) thuộc vế này — `impact_policy` luôn là chuyện giá. KHÔNG phải mọi trích dẫn cũ: `docs-impact-policy-contract.json` §A6 dùng "edge #4" cho Ý capacity của hàng gộp cũ ("capacity branch của edge #4") — trích dẫn đó CHƯA đồng bộ, nợ tài liệu để lại cho lần sửa file đó, ngoài phạm vi slice này |
| 4b | Data Integrity | **Capacity** (`slots_max`) change with existing charges, hoặc retry root | **KHÔNG phải nhánh tiền** — không yêu cầu `impact_policy` (DD-112 ✅ owner 27/08/2026; `impact_policy` do DD-49 chi phối, mà ma trận DD-49 là `{price}×{charge-state}×{lifecycle}`, không có trục capacity). Guard `UpdateSession` hiện tại đã pin ở edge #16: capacity hữu hạn đã đổi dưới active roster → `CAPACITY_BELOW_ROSTER` trước; còn lại dưới `sessionOccupancy` (active + guest notes) → `CAPACITY_BELOW_OCCUPANCY`; edge #15 giữ target promotion chưa build; hàng này KHÔNG dựng luật capacity thứ ba. Một capacity outcome đầy resolve roots trong cùng tx. ⚠️ Chốt DD-112 **có điều kiện và tự huỷ**: bảng đầu tiên gắn tiền vào chỗ ngồi (hold/reservation), hoặc writer production đầu tiên ghi `charges`/`payment_allocations`, **mở lại** DD-112 và hàng này |
| 5 | Data Integrity | Cancel/close with paid roster + retry root | Lock `session→root job→roster/finance`, require `review_policy` — no silent cancellation. Failed preview leaves root unchanged; successful close/cancel resolves all nonterminal roots before commit. **DD-117 ✅ (owner 25/08) chốt cách đọc:** khi cơ chế resolve-roots/`review_policy` chưa tồn tại, nhánh này = **fail-closed REFUSE** (mã lỗi lớp `CANCEL_REQUIRES_REVIEW`) — thay deferral 14/08; **D5:** cả họ session command dedup CHỈ trên `(tenant_id, command_id)`, content fingerprint bị bác. **DD-131 OD-1 (owner 14/10; DD-131 / DD-132 (pending in PR #51)) — đảo vế close của DD-117 D3:** close **không bao giờ** trả `CANCEL_REQUIRES_REVIEW` nữa — close được khi không còn charge nào có dư nợ, ngược lại `CLOSE_BLOCKED_OPEN_DEBT` kèm danh sách player còn nợ (edge #48); cancel giữ cổng #3 (active roster ≠ 0 → `CANCEL_REQUIRES_REVIEW`, host gỡ từng player trước) và thay "có bất kỳ charge" bằng "có charge mang tiền đã ghi nhận (net allocated > 0)" — charge `void` của player chưa trả đã bị gỡ **không** chặn cancel (edge #54). Nhánh anomaly nguồn `draft` (edge #28) không đổi. Bảng quyết định + abuse cases: §4 "Close / Cancel money policy" |
| 6 | Data Integrity | Occurrence duplicate generation | `UNIQUE(recurrence_rule_id, local_occurrence_key)` prevents duplicates |
| 7 | Data Integrity | DST ambiguity in recurrence | Tested timezone library + documented ambiguity policy (prefer earlier/later) |
| 8 | Security | Public endpoint exposes venue/roster | ❌ NEVER — separate public serializer with whitelist |
| 9 | Resilience | Projector (Zalo/Messenger/web) fails | Outbox retry — canonical state already committed |
| 10 | Security | Non-admin sends session command | AuthZ middleware rejects before service — 403 |
| 11 | Cross-Feature | Mutation on closed/cancelled/past session | Reject (DD-111 D3) — mirror FE edge #11 (Security): mọi **mutation** trên session `closed`/`cancelled`/`past` bị từ chối (trừ privileged correction + audit trail). `closed`/`cancelled` → `SESSION_NOT_OPEN` (status check); "past" (`open` đã qua thời điểm) được realize theo từng command mutate (cancel: edge #31; publish past-draft: edge #23/#34). `AnnounceSession` là **notification, KHÔNG mutate** → ngoài phạm vi edge này; announce có freshness guard riêng (edge #46) |
| 12 | Data Integrity | Visibility=public without required fields | SessionService target rejects `MISSING_DISCOVERY_FIELDS`; `0024` DB CHECK independently rejects public + `slots_max=NULL`. Required (PRD E#7): sport, area, starts_at, finite `slots_max`; private unlimited remains valid |
| 13 | Data Integrity | `waitlisted` thiếu/position ≤0 hoặc active/left còn position | DB state-shape/positive CHECK reject |
| 14 | Concurrency | Leave/capacity+/hold chạy đồng thời join | Lock session trước; `getSessionOccupancy()` re-count; không over-fill/double-charge/double-hold |
| 15 | Boundary | Capacity tăng hoặc finite→unlimited (finite→`NULL` chỉ cho non-public; public → edge #12 reject) | Re-count `getSessionOccupancy()`; fill available admission slots hoặc mọi candidate eligible trong cùng locked transition |
| 16 | Boundary | `UpdateSession` hiện tại: đổi capacity sang giá trị hữu hạn dưới active roster hoặc occupancy | Dưới session lock, kiểm active roster trước: `slots_max < active_count` → `CAPACITY_BELOW_ROSTER`; còn lại `slots_max < sessionOccupancy` → `CAPACITY_BELOW_OCCUPANCY`. Helper hiện tại đếm active + guest notes. Bằng occupancy được phép; không evict/xoá guest note hoặc ngầm mutation. Pending/hold/promotion chưa build; công thức tương lai = `getSessionOccupancy()` (DD-133, header) |
| 17 | Financial | Existing player `status='left'` join lại | Re-derive under lock. Active: carry-over hoặc append refunded lifecycle; full: waitlisted, refunded không new lifecycle tới activation. Không duplicate charge row; unknown→review/zero mutation |
| 18 | Financial | Waitlisted candidate có existing charge | Re-derive DD-49 live disposition; missing/malformed → không promote/mutate, audit `WAITLIST_CHARGE_CONFLICT`, owner-review, continue next |
| 19 | Financial/Resilience | `deriveChargeAmount` failure lúc first-activation promote | Candidate unchanged; opener audit + candidate event referencing lazy root and commits. Root worker runs max 3 claimed attempts; completed sweeps use current order, siblings share budget/root digest; expired final claim resolves-or-terminalizes without attempt 4; no fallback |
| 20 | Security/State | Messenger wizard wrong Page/actor/tenant, stale, expired or replayed | Single interceptor denies/clears; final command re-checks capability/snapshot; no partial/double create |
| 21 | State | Publish `draft` → `open` | Lock session row; `draft` → set `status='open'` + bump `version` + `session.published` outbox trong một tx. Status-only — `visibility` unchanged. Re-publish session đã `open` = no-op success (`commandId` dedup + state no-op như close/cancel) |
| 22 | Data Integrity | Publish session `visibility='public'` thiếu discovery fields | Re-validate E#7 (sport, area, starts_at, `slots_max IS NOT NULL`) tại publish — transition bật public projection → `MISSING_DISCOVERY_FIELDS`; zero mutation |
| 23 | State | Publish session non-draft closed/cancelled/past | Reject `SESSION_NOT_OPEN` — chỉ `draft` với `starts_at > now()` mới publish được; zero mutation. `session.manage` (Host) only, AuthZ trước service (edge #10) |
| 24 | Security/Billing | Publish khi tenant `suspended` (không phải billing: admin / abuse — DD-142) | **Fail-closed block `TENANT_SUSPENDED`** (403, canonical tenant-routing code) per billing Suspended Action Matrix (owned bởi `feature_billing_lifecycle`); zero mutation, không emit event. Status-authority **resolved** — `feature_billing_lifecycle_tech.md` §3 (fail-closed 2-step, `authorizeTenantAction`). **Concurrency:** check phải re-evaluate qua locking read (`FOR SHARE` trên `tenants`/`subscriptions`) trong cùng transaction với session lock, ngay trước mutation (§4 step 6) — upfront step 1 KHÔNG đủ, và plain re-select cũng KHÔNG đủ |
| 25 | State | Discard `draft` → `cancelled` (host) | `CancelSession` guard mở rộng: source status `IN ('draft','open')` (trước đây chỉ `open`). Lock session row `FOR UPDATE`; nguồn `draft` **verify** (không giả định) `players`/`charges` rỗng dưới lock — rỗng thì bỏ qua nhánh roster/root của edge #5, anomaly thì fail-closed vào đúng edge #5/#28. Rỗng: set `status='cancelled'` + bump `version` + `session.cancelled` outbox (`cancel_reason='manual'`) trong một tx. Không past-guard cho nguồn `draft` — hợp lệ bất kể `starts_at`; nguồn `open` giữ nguyên past-guard cũ (edge #11/#31, KHÔNG exempt) |
| 26 | Concurrency | Discard/cancel với `expectedVersion` thiếu hoặc mismatch (nguồn `draft` hoặc `open`) | `expectedVersion` **bắt buộc** trên nhánh mutate — cho MỌI nguồn, không riêng draft (không optional) — thiếu HOẶC mismatch đều → `STALE_VERSION` (409); zero mutation. Đóng race "click Huỷ nháp bỏ version → cancel nhầm session vừa published"; đồng thời pin lần đầu optimistic-concurrency behavior cho toàn bộ `CancelSession` (§1 nguyên tắc chung, chưa từng detail trước slice này) |
| 27 | State | Discard session `closed`, hoặc discard session đã `cancelled` | `closed` → reject `SESSION_NOT_OPEN` (edge #11, không đổi); đã `cancelled` (dù nguồn draft hay open) → no-op idempotent (`commandId` dedup + state no-op, cùng pattern close/publish edge #21) — nhánh no-op này KHÔNG cần `expectedVersion` khớp (mirror publish idempotent-thắng-version) |
| 28 | Financial/Data Integrity | Draft mang `players`/`charges` bất thường (data anomaly — vi phạm bất biến ứng dụng "draft không roster") | Fail-closed: KHÔNG tự động huỷ (host discard lẫn auto-expiry). Host-discard (request/response, có caller đang chờ): trả `CANCEL_REQUIRES_REVIEW` (§3 Error Codes — cùng code `review_policy` của edge #5 dùng cho nguồn `open` paid roster, không invent code riêng). Auto-expiry (background, không có caller): không có response để trả — chỉ skip + audit. Cả hai nhánh đều ghi `session.expiry_anomaly_detected` mỗi lần phát hiện (§4 Events table — cùng canonical outbox mechanism `session.cancelled` dùng, append-only, mirror `waitlist.charge_derivation_failed`'s per-occurrence shape). Owner-facing alert dedupe theo `session_id` là việc của consumer, storage chính xác là build-slice detail (cùng gap pre-existing với `review_policy` chính nó, edge #5). Row giữ `draft`, re-claim lượt job sau là công việc thừa rẻ, không phải bug, tới khi host tự resolve qua review UI |
| 29 | Concurrency | Auto-expiry job race với `PublishSession` concurrent trên cùng draft | Cả hai lock session row `FOR UPDATE` trước khi mutate (session-lock-ordering, cùng discipline Publish step 2/Waitlist promotion step 1). Job lock trước → publish concurrent chờ, thấy `status` đã `cancelled` → reject `SESSION_NOT_OPEN` (edge #23, không đổi). Publish lock trước → job's `FOR UPDATE SKIP LOCKED` skip row lượt chạy này, row giờ `open` → không mutate, không còn khớp filter lượt sau. Không thứ tự nào double-transition |
| 30 | Resilience/Concurrency | Hai lượt chạy auto-expiry job chồng lấn (scheduler tick trùng, hoặc nhiều instance) | Claim filter (`status='draft' AND starts_at<=now()`) tự nhiên idempotent — row `cancelled` không còn khớp, không re-select. `FOR UPDATE SKIP LOCKED` — lượt chạy thứ hai skip row lượt đầu đang giữ lock. Không double-transition/double-event |
| 31 | State/Security | Cancel session `open` với `starts_at<=now()` (past) | Reject `SESSION_NOT_OPEN` — no-past-guard (edge #25) CHỈ áp dụng cho nguồn `draft`; `open`→`cancelled` giữ past-guard. Đây là **cancel realize edge #11** (mutation trên past session → reject, cần privileged correction + audit) cho path cancel: một buổi `open` đã qua `starts_at` có thể mang game thật / roster đã thanh toán, nên cancel nó phải qua privileged correction + audit trail, không qua path cancel thường. Edge #31 = realization **cancel-scoped** của past-rule trong edge #11 (mang thêm roster/refund weight riêng của cancel); edge #11 là umbrella Security rule. Discard KHÔNG exempt `open` khỏi past-guard này. Paid roster trên session `open` (past hoặc không) vẫn đi qua `CANCEL_REQUIRES_REVIEW` (edge #5) như cũ, không phải path fail-closed mới của draft |
| 36 | Security | Player invite friend chưa follow mình | Reject: không có `person_follows` row với `follower_id=friend, followee_id=player, status='accepted'` → trả `FOLLOW_REQUIRED`; client redirect tới guest note form |
| 37 | Security | `allow_player_invite = false` trên session | Reject `INVITE_NOT_ALLOWED` (403) cho mọi invite/note endpoint; chỉ host add trực tiếp |
| 38 | Security | Player chưa active (`waitlisted`/`left`/`pending`) cố invite friend | Reject `PLAYER_NOT_ACTIVE` (403); query `players WHERE session_id AND membership_id AND status='active'` |
| 39 | Concurrency | Invite friend khi session đầy | Reject `SESSION_FULL`; occupancy = `getSessionOccupancy()` (DD-133 (a): active players + guest notes + live holds (= 0 tới khi có bảng hold, DD-132/DD-135), + pending invites sau migration thêm chúng); check dưới session lock `FOR UPDATE` |
| 40 | Data Integrity | Guest note thứ 4 (vượt max 3/player/session) | Reject `GUEST_NOTE_LIMIT_REACHED`; check COUNT dưới session lock TRƯỚC INSERT + DB trigger guard (defense-in-depth) |
| 41 | Security | Invite friend đã là player (active/waitlisted/pending) | Reject `ALREADY_JOINED`; query `players WHERE session_id AND membership_id AND status IN ('active','waitlisted','pending')` |
| 42 | Security | Invite friend bị block (DD-55) | Reject `MEMBER_BLOCKED`; check `person_blocks` trước follow check — block overrides follow |
| 43 | Concurrency | Delete guest note khi đang có waitlist | Release slot, re-count occupancy, publish event — **KHÔNG** promotion thật (sửa 2026-09-12: waitlist/promotion engine chưa build, xem §4 DeleteGuestNote step 4 + D2) |
| 44 | Security | Approve pending invite khi session đầy (capacity recheck) | Approve cần verify capacity dưới session lock; pending đã chiếm slot nên thường OK, nhưng concurrent note/join có thể làm đầy → reject `SESSION_FULL` |
| 45 | Data Integrity | Reject pending invite | Remove player row (không set `left` — pending chưa bao giờ active). Release slot → trigger waitlist auto-promote |
| 46 | State | Announce session `open`: `starts_at<=now()<ends_at` (đang diễn ra) = **ALLOWED**; `ends_at<=now()` (đã hết giờ) = **REJECT** | `AnnounceSession` (DD-111 D1–D3) gate trên `status='open'` **VÀ** ends_at freshness — HAI lý do TÁCH BIỆT, không gộp: **(a)** announce **exempt khỏi edge #11** vì **không mutate** session (emit `session.announcement_requested`, không đổi `sessions` row) — edge #11 chặn *mutation* trên closed/cancelled/past, không áp cho một notification; **VÀ (b)** announce vẫn **tự guard ends_at** — một buổi `open` đã qua `ends_at` (auto-expiry chưa build → row `open` tồn tại vô hạn) không được announce, vì thông báo "vào kèo đi" cho một buổi ĐÃ XONG là harm mà một mutation không có → `SESSION_ALREADY_ENDED` (409). (a) một mình sẽ khiến người đọc sau xoá guard (b). **KHÔNG có past-START cutoff:** một buổi đang diễn ra (`starts_at<=now()<ends_at`) vẫn announce mời join muộn hợp lệ ("kèo đang chạy, vào ngay"); publish's cutoff (edge #23) là publish-specific. Clock: đọc `ends_at <= clock_timestamp()` bằng query RIÊNG SAU row lock (mirror publish's post-lock pattern, KHÔNG `now()`/`Date.now()`). Chỉ `draft`/`closed`/`cancelled` → `SESSION_NOT_OPEN` |
| 47 | State | `CloseSession` trên session không ở `open` (draft/closed/cancelled) | Reject `SESSION_NOT_OPEN`; source `closed` = no-op idempotent (`commandId` dedup, KHÔNG check `expectedVersion` trên nhánh no-op — cùng pattern `PublishSession`/`CancelSession`). `packages/db/src/session-service.ts` `closeSession` |
| 48 | Financial | `CloseSession` với charge còn dư nợ (DD-131 OD-1) | Reject `CLOSE_BLOCKED_OPEN_DEBT` (409, §3) kèm `error.details.openBalancePlayers` = các player còn dư nợ — **chỉ** `playerId` + `displayName`, thứ tự roster (`joined_at`, `id`) — **thay** `CANCEL_REQUIRES_REVIEW` cũ (DD-117 D3 vế close bị đảo; DD-131 / DD-132 (pending in PR #51)). Dư nợ = `chargeRemaining(amount_due, net allocated, status)` > 0 (`payment-manual.ts` — **cùng một hàm** tính `remaining` của read model host `session-read.ts`, nên close không thể thành công khi roster còn hiện `remaining > 0`; ⇔ charge KHÔNG `void` mà `chargeStatusFor` ≠ `paid`); net allocated = `effectiveByCharge` (SUM ledger, reversal âm). Charge `void` (player chưa trả đã bị gỡ) hoặc giá 0 ("exempt" — `charges_status_chk` không có `exempt`, giá 0 ⇒ `paid` với 0 tiền) **không** chặn. **Bất đối xứng có chủ ý với cancel giữ nguyên:** close KHÔNG check active-roster (roster đã trả đủ vẫn close), cancel check cổng #3 + tiền đã ghi nhận (edge #5/#54) |
| 49 | Security/Concurrency | `CloseSession` với `expectedVersion` thiếu hoặc không khớp | Reject `STALE_VERSION` (409) — chỉ áp dụng trên nhánh mutate SAU no-op check, cùng rule int4-positive-and-must-match các command khác đã dùng |
| 50 | State | System auto-close job: session `open` đã qua `ends_at` + grace period → `closed` | **CHƯA BUILD — OWNER-CHECK.** Mirror `closeSession`'s core mutation (status/version/outbox `session.closed`) nhưng system-invoked KHÔNG qua client `commandId` (cùng pattern draft auto-expiry, §1 dòng 25); idempotent nếu đã đóng tay trước đó (cùng no-op branch); không nhận join mới sau transition; public projection gỡ (cùng DD-12 fence reason `'closed'`). **DD-45 (`../../standards/decisions.md:604`) đã yêu cầu close/cancel resolve mọi nonterminal promotion-retry root trong cùng tx — `closeSession`/`cancelSession` hiện KHÔNG implement điều này (gap pre-existing, không phải gap mới của auto-close)**; auto-close kế thừa gap tương tự, không phát sinh riêng. Thời lượng grace period sau `ends_at` **chưa chốt** |
| 51 | Resilience/Concurrency | Hai lượt auto-close job chạy chồng | **CHƯA BUILD — OWNER-CHECK.** Mirror edge #30 (auto-expiry): claim filter (`status='open' AND ends_at<=now()-grace`) tự nhiên idempotent + `FOR UPDATE SKIP LOCKED` — lượt chạy thứ hai skip row lượt đầu đang giữ lock |
| 52 | Concurrency | Auto-close job đua với `CloseSession`/`UpdateSession` thủ công đồng thời | **CHƯA BUILD — OWNER-CHECK.** Mirror edge #29 (session-lock-ordering): cả hai lock session row `FOR UPDATE` trước khi mutate; ai lock trước thắng, phía sau thấy state đã đổi → reject tương ứng, không double-transition |
| 53 | Concurrency | Close/cancel đua add-player · remove-player · mark-paid · reversal trên cùng session | Không có stale-read window, không cần lock mới (đo 15/10): mọi writer lock `sessions FOR UPDATE` TRƯỚC khi chạm charge/ledger và re-check status dưới lock (add/remove: chỉ `open`; mark-paid/reversal: `open`\|`closed`); close/cancel đọc charge + ledger SAU khi giữ cùng lock đó. ⇒ writer commit trước thì close/cancel đọc thấy (add → `CLOSE_BLOCKED_OPEN_DEBT` có player mới; pay → close được; remove → cancel được); close/cancel commit trước thì writer thấy `closed`/`cancelled` (add/remove → `SESSION_NOT_OPEN`). Thứ tự lock toàn cục: §4 "Close / Cancel money policy" |
| 54 | Financial | Cancel nguồn `open`, active roster = 0, còn charge `void` của player chưa trả đã bị gỡ (có thể kèm player `waitlisted`) | **Cho phép** (DD-131 OD-1) — `void` không mang tiền; `session.cancelled` `has_paid=false`, `roster_count=0`; charge giữ `void`. Charge `void` có net allocated > 0, hoặc charge KHÔNG `void` mà không có active player (không writer nào trên main tạo được: remove void charge, join waitlist không tạo charge) → `CANCEL_REQUIRES_REVIEW` fail-closed — không âm thầm bỏ một khoản nợ trên session đã huỷ |
| 55 | Security | Caller không có `session.manage` (player, non-member, admin tenant khác) gọi close lên session còn nợ | 403 `FORBIDDEN` ở route gate TRƯỚC command, cùng body cho mọi lý do — danh sách dư nợ không bao giờ được tính/trả; chỉ caller đã authorize (đã đọc được roster) mới thấy, và chỉ sau billing/status/version check của command. Danh sách nằm trong field `#private` của `SessionCloseError` ⇒ không lọt `util.inspect`/`JSON.stringify` (log); refuse = rollback, không event/audit nào |
| 56 | Idempotency | Retry close bị refuse (cùng `commandId`) sau khi đã thu tiền | Refusal KHÔNG ghi `processed_commands` (rollback) ⇒ retry cùng `commandId` được đánh giá lại: còn nợ → refuse lại; đã trả đủ → close; replay sau close thành công → stored envelope (`replayed=true`), zero write. mark-paid không bump `sessions.version` nên `expectedVersion` cũ vẫn khớp |
| 57 | Financial | Reversal trên session `closed` / `cancelled` | `closed`: **cho phép** (DD-131 OD-6 — không guard session-status): charge mở lại `open`/`partial`, session vẫn `closed`, host thu lại được (mark-paid nhận `open`\|`closed`). `cancelled`: `lockSession` (`open`\|`closed`) trả `SESSION_NOT_OPEN` — hành vi có sẵn, KHÔNG đổi; vì cancel đòi net allocated = 0 nên trên session `cancelled` không bao giờ còn khoản đảo được |

---

## 3. API Contract

### Endpoints

| Method | Path | Auth | Mô tả |
|--------|------|------|-------|
| POST | /api/sessions | TenantAdmin | Tạo session |
| PUT | /api/sessions/:id | TenantAdmin | Sửa session |
| POST | /api/sessions/:id/publish | TenantAdmin | Publish `draft` → `open` (status-only; `commandId` + `expectedVersion`) |
| POST | /api/sessions/:id/announce | TenantAdmin | Announce lên group |
| POST | /api/sessions/:id/close | TenantAdmin | Đóng session |
| POST | /api/sessions/:id/cancel | TenantAdmin | Huỷ session (`open` hoặc `draft`; nguồn `draft` = discard, zero roster/charge impact) |
| GET | /api/sessions | TenantAdmin | List sessions (tenant-scoped) |
| GET | /api/sessions/:id | TenantAdmin/Player | Detail (scoped by role) |
| POST | /api/sessions/:id/invite | Player (active) | `InviteFriend` — mời friend đã follow (DD-47) |
| POST | /api/sessions/:id/guest-notes | Player (active) | `CreateGuestNote` — thêm khách (max 3/player) |
| DELETE | /api/sessions/:id/guest-notes/:noteId | Player (note creator) | `DeleteGuestNote` |
| GET | /api/sessions/:id/guest-notes | Player (active) / Host | List guest notes for session — **CHƯA BUILD**, chờ Milestone 2 (route body-less auth-context resolver, `ap3/features/session-management/PLAN.md` Milestone 2, supervised, chưa chạy) |
| POST | /api/sessions/:id/players/:playerId/approve | Host | `ApproveInvite` — duyệt pending → `active` |
| POST | /api/sessions/:id/players/:playerId/reject | Host | `RejectInvite` — remove player row |

### Error Codes

| Code | Error Code | Message | Trigger |
|------|-----------|---------|---------|
| 400 | `INVALID_TIME_RANGE` | Giờ kết thúc phải sau giờ bắt đầu | `ends_at <= starts_at` |
| 400 | `SPORT_INACTIVE` | Môn thể thao không hoạt động | Sport not in active taxonomy |
| 409 | `CAPACITY_BELOW_ROSTER` | Sức chứa nhỏ hơn số người đã tham gia. | `UpdateSession` hiện tại: capacity hữu hạn đã đổi dưới `active_count`; kiểm trước occupancy |
| 409 | `CAPACITY_BELOW_OCCUPANCY` | Sức chứa nhỏ hơn số chỗ đang được sử dụng. | `UpdateSession` hiện tại: capacity hữu hạn đã đổi với `active_count <= slots_max < sessionOccupancy` (active + guest notes); dưới active roster trả `CAPACITY_BELOW_ROSTER` trước |
| 409 | `SESSION_NOT_OPEN` | Buổi chơi không ở trạng thái mở | Mutation on closed/cancelled; publish của session non-draft (closed/cancelled) hoặc draft đã past `starts_at <= now()` (§4 publish) |
| 409 | `SESSION_ALREADY_ENDED` | Buổi chơi đã kết thúc · Session has already ended | Announce một session VẪN `open` nhưng `ends_at <= now()` (đã qua giờ kết thúc; auto-expiry chưa build nên row vẫn `open`) — §4 Announce ends_at freshness guard (edge #46; DD-111 D1/D2). Phân biệt với `SESSION_NOT_OPEN` (draft/closed/cancelled): session còn `open`, chỉ đã hết giờ. KHÔNG tái dùng `SESSION_CLOSED` (code đó thuộc player-facing channel specs, nghĩa `status=closed` — khác điều kiện open-quá-`ends_at` này) |
| 403 | `TENANT_SUSPENDED` | Club đang tạm ngưng | Publish (hoặc mutation) khi tenant `suspended` (admin / abuse — DD-142: không suspended vì billing) — **canonical code owned by tenant-routing** (`feature_tenant_routing_authz_tech.md` / TDD); referenced, không định nghĩa lại ở đây |
| 409 | `STALE_VERSION` | Dữ liệu đã thay đổi — tải lại | Optimistic lock conflict |
| 400 | `PRICE_CHANGE_REQUIRES_POLICY` | Cần chọn chính sách cho charges hiện tại | Price change with existing charges |
| 400 | `CANCEL_REQUIRES_REVIEW` | Kèo này cần được xem xét trước khi huỷ. · This session needs review before it can be cancelled. (route `session-command-route.ts`; lời cancel-only, CỐ Ý không nói lý do — active roster, tiền đã ghi hay anomaly đều dùng một câu) | **Chỉ `CancelSession`** (DD-131 OD-1 — close không còn trả mã này): nguồn `open` với active roster ≠ 0 (cổng #3), charge mang tiền đã ghi nhận (net allocated > 0), hoặc charge không-`void` không có active player (anomaly); hoặc discard `draft` mang `players`/`charges` bất thường (data anomaly, edge #28/#30) — cùng error code, cùng review surface, KHÔNG invent code riêng cho draft |
| 409 | `CLOSE_BLOCKED_OPEN_DEBT` | Còn người chơi chưa trả đủ tiền — thu đủ trước khi đóng kèo. · Some players have not paid in full — collect their payments before closing the session. | `CloseSession` khi còn charge có dư nợ (edge #48; DD-131 OD-1 — DD-131 / DD-132 (pending in PR #51)). Payload: `error.details.openBalancePlayers: [{ playerId, displayName }]` — chỉ id + tên hiển thị (`memberships.display_name`, có thể `null`), KHÔNG số tiền / membership/person id / liên hệ; thứ tự roster (`joined_at`, `id`). **409** (không phải 400): caller tự giải quyết được (thu tiền rồi close lại) — cùng lớp `REMOVE_REQUIRES_REVIEW`. Mã DUY NHẤT mang `details` (`../../channels/web/README.md` §7) |
| 400 | `MISSING_DISCOVERY_FIELDS` | Thiếu thông tin bắt buộc cho buổi chơi public | Public visibility without required fields (incl. finite `slots_max` — E#7, note §2); re-validated at create/update **and publish** (§4 publish) |
| 409 | `REJOIN_REQUIRES_REVIEW` | Cần host kiểm tra trạng thái tiền trước | `left` nhưng correction core chưa có hoặc không chứng minh được carry-over/refunded disposition |
| 404 | `SESSION_NOT_FOUND` | Buổi chơi không tồn tại | Session không tồn tại trong tenant context |
| 403 | `INVITE_NOT_ALLOWED` | Buổi chơi không cho phép mời bạn | `allow_player_invite = false` trên session; mọi invite/note endpoint reject |
| 403 | `PLAYER_NOT_ACTIVE` | Bạn chưa tham gia buổi chơi này | Player cố invite nhưng `players.status != 'active'` (waitlisted/left/pending) |
| 400 | `FOLLOW_REQUIRED` | Người này chưa follow bạn | Invite friend chưa follow player (DD-47); client redirect tới guest note form |
| 409 | `ALREADY_JOINED` | Người này đã tham gia buổi chơi | Invite friend đã là player (active/waitlisted/pending) |
| 409 | `SESSION_FULL` | Buổi chơi đã đầy | Invite/note/approve khi occupancy ≥ slots_max |
| 403 | `MEMBER_BLOCKED` | Không thể mời người này | DD-55 block boundary — block overrides follow |
| 400 | `GUEST_NOTE_LIMIT_REACHED` | Đã hết lượt ghi chú (tối đa 3) | Player đã có 3 guest notes trong session |
| 403 | `NOT_NOTE_CREATOR` | Bạn không tạo ghi chú này | Delete guest note không phải của mình |
| 404 | `GUEST_NOTE_NOT_FOUND` | Ghi chú không tồn tại | Delete guest note không tìm thấy |
| 400 | `INVALID_INPUT` | Nội dung không hợp lệ | `guest_name`/`note` sai độ dài, hoặc chứa ký tự PostgreSQL text không lưu được (NUL hoặc lone surrogate) — `createGuestNote`, `packages/db/src/session-service.ts:2690,2694-2695,2704,2708-2709`, commit `c1e8bcf` |
| 404 | `PLAYER_NOT_FOUND` | Người chơi không tồn tại | Approve/reject player không tìm thấy |
| 400 | `INVALID_CHANNEL` | Kênh thông báo không hợp lệ | Announce với `channel` ngoài enum logical đóng (`zalo`/`messenger`, DD-37; MVP: mọi giá trị khác chuỗi `zalo` trả `INVALID_CHANNEL`, kể cả `messenger` — DD-138 L4b A-D4) — rỗng, raw destination id, platform lạ, sai case, hoặc non-string (§4 Announce step 2) |
| 409 | `COMMAND_ID_CONFLICT` | Yêu cầu trùng mã lệnh | `commandId` đã thuộc một command/kết quả khác (không phải replay đúng request) — canonical `processed_commands` dedup (edge #3), dùng chung mọi session command (create/publish/announce) |
| 400 | `PLAYER_NOT_PENDING` | Người chơi không ở trạng thái chờ duyệt | Approve/reject player không ở `pending` |

### Request/Response Examples

> DTO minh hoạ theo contract đã pin; field name cụ thể chốt ở build slice; envelope DD-60 (`../../standards/api-reference-convention.md`).

**POST `/api/sessions`** — command mang `commandId` (§1); field derive từ DDL §2 (status default `draft`, version 1):

- Request:

```json
{ "commandId": "cmd_…", "startsAt": "…", "endsAt": "…", "timezone": "Asia/Ho_Chi_Minh", "visibility": "private", "venueAddress": "12 Nguyễn Trãi, Quận 5" }
```

> **`venueAddress` (DD-128 OD-4a, v2.35):** tuỳ chọn, `string | null`, plain text tối đa **200 UTF-16 code unit** (`string.length` của JavaScript, cùng đơn vị với thuộc tính HTML `maxLength` của form web; không phải số grapheme hay số code point), cùng luật cho `POST` và `PUT`. Server **không normalize** chuỗi (không NFC/NFD): văn bản tiếng Việt đã tách dấu (NFD) tốn nhiều đơn vị hơn dạng dựng sẵn (NFC) — ví dụ `ế` là 1 đơn vị ở NFC nhưng 3 ở NFD (`e` + 2 dấu kết hợp) — và ký tự ngoài BMP (emoji) tốn 2 đơn vị; quá dài / không phải string / chứa NUL → `INVALID_TEXT_FIELD` (route map về `INVALID_BODY` 400). Địa chỉ là **private** (DD-06): không vào payload `session.created`/`session.updated`, không vào public projection, không vào log. Dedup `(tenant_id, command_id)` vẫn đứng TRƯỚC validate (DD-117 D5): replay với `venueAddress` khác/quá dài vẫn trả envelope đã lưu.

- Success (HTTP mapping minh hoạ):

```json
{ "data": { "session": { "id": "…", "status": "draft", "version": 1 } }, "error": null, "meta": { "requestId": "req_…" } }
```

**PUT `/api/sessions/:id`** — `409` optimistic lock conflict (Error Codes trên):

```json
{ "data": null, "error": { "code": "STALE_VERSION", "message": "Dữ liệu đã thay đổi — tải lại", "statusCode": 409 }, "meta": { "requestId": "req_…" } }
```

**PUT `/api/sessions/:id`** — `409` giảm capacity dưới active roster:

```json
{ "data": null, "error": { "code": "CAPACITY_BELOW_ROSTER", "message": "Sức chứa nhỏ hơn số người đã tham gia.", "statusCode": 409 }, "meta": { "requestId": "req_…" } }
```

**PUT `/api/sessions/:id`** — Success (HTTP 200 — mutation áp dụng, `version` bump):

```json
{ "data": { "session": { "id": "…", "status": "open", "version": 2 } }, "error": null, "meta": { "requestId": "req_…" } }
```

**POST `/api/sessions/:id/publish`** — command mang `commandId` + `expected_version` (§1); status-only `draft` → `open`:

- Request:

```json
{ "commandId": "cmd_…", "expectedVersion": 1 }
```

- Success — mutation `draft` → `open` (`version` bump, `visibility` unchanged):

```json
{ "data": { "session": { "id": "…", "status": "open", "version": 2 } }, "error": null, "meta": { "requestId": "req_…" } }
```

- Success — idempotent no-op khi session đã `open` (hoặc `commandId` replay): cùng envelope, `status: "open"`, `version` **không** đổi, không emit `session.published` trùng.
- Error — stale `expectedVersion` (`409`, optimistic lock):

```json
{ "data": null, "error": { "code": "STALE_VERSION", "message": "Dữ liệu đã thay đổi — tải lại", "statusCode": 409 }, "meta": { "requestId": "req_…" } }
```

- Error khác: non-draft/past → `SESSION_NOT_OPEN` (`409`); public thiếu discovery → `MISSING_DISCOVERY_FIELDS` (`400`); tenant billing-`suspended` → **`TENANT_SUSPENDED`** (`403`, canonical tenant-routing code; fail-closed per billing matrix — §4 publish billing note). `commandId` dedup theo canonical `processed_commands` (edge #3).

**POST `/api/sessions/:id/announce`** — command mang `commandId` (§1); **notification, KHÔNG mutate** `sessions` row (edge #11 exempt) nhưng tự guard `ends_at` freshness (edge #46):

- Request:

```json
{ "commandId": "cmd_…", "channel": "zalo" }
```

- Success (HTTP 200 — announcement queued qua outbox; session row không đổi):

```json
{ "data": { "announced": true, "channel": "zalo" }, "error": null, "meta": { "requestId": "req_…" } }
```

- Error — session `open` nhưng đã qua `ends_at` (đã hết giờ, auto-expiry chưa build nên row vẫn `open`):

```json
{ "data": null, "error": { "code": "SESSION_ALREADY_ENDED", "message": "Buổi chơi đã kết thúc · Session has already ended", "statusCode": 409 }, "meta": { "requestId": "req_…" } }
```

- Error khác: `draft`/`closed`/`cancelled` → `SESSION_NOT_OPEN` (`409`, edge #46); `channel` ngoài enum logical đóng (`zalo`/`messenger`) → `INVALID_CHANNEL` (`400`). `commandId` dedup theo canonical `processed_commands` (edge #3).

**POST `/api/sessions/:id/close`** — command mang `commandId` + `expectedVersion` (§1; **bắt buộc** trên nhánh mutate — edge #49); chỉ nhận nguồn `open`:

- Request:

```json
{ "commandId": "cmd_…", "expectedVersion": 2 }
```

- Success — mutation `open` → `closed` (`version` bump; `close_reason` nội bộ `manual` — không phải field response, chỉ trong outbox payload):

```json
{ "data": { "session": { "id": "…", "status": "closed", "version": 3 } }, "error": null, "meta": { "requestId": "req_…" } }
```

- Success — idempotent no-op khi session đã `closed` (hoặc `commandId` replay): cùng envelope, `status: "closed"`, `version` **không** đổi; nhánh no-op **không** cần `expectedVersion` khớp (edge #47, mirror publish/cancel idempotent-thắng-version).
- Error — non-`open` source (draft/cancelled) → `SESSION_NOT_OPEN` (`409`, edge #47):

```json
{ "data": null, "error": { "code": "SESSION_NOT_OPEN", "message": "Buổi chơi không ở trạng thái mở", "statusCode": 409 }, "meta": { "requestId": "req_…" } }
```

- Error — còn charge có dư nợ → `CLOSE_BLOCKED_OPEN_DEBT` (`409`, edge #48, DD-131 OD-1 — **không check active-roster**, khác cancel); danh sách chỉ id + tên hiển thị, thứ tự roster:

```json
{ "data": null, "error": { "code": "CLOSE_BLOCKED_OPEN_DEBT", "message": "Còn người chơi chưa trả đủ tiền — thu đủ trước khi đóng kèo.", "statusCode": 409, "details": { "openBalancePlayers": [ { "playerId": "…", "displayName": "Lan" }, { "playerId": "…", "displayName": null } ] } }, "meta": { "requestId": "req_…" } }
```

- Error khác: `expectedVersion` thiếu/mismatch → `STALE_VERSION` (`409`, edge #49 — kiểm TRƯỚC money guard, nên request stale không bao giờ nhận danh sách). Close **không bao giờ** trả `CANCEL_REQUIRES_REVIEW` (DD-131 OD-1). `commandId` dedup theo canonical `processed_commands` (edge #3); refusal không được ghi (edge #56).

**POST `/api/sessions/:id/cancel`** — command mang `commandId` + `expectedVersion` (§1; **bắt buộc** trên nhánh mutate, mọi nguồn — edge #26, không phải field tuỳ chọn như DTO minh hoạ chung ở đầu section); nhận nguồn `draft` (discard) hoặc `open` (cancel thường):

- Request:

```json
{ "commandId": "cmd_…", "expectedVersion": 1 }
```

- Success — mutation `draft`/`open` → `cancelled` (`version` bump, `cancel_reason` nội bộ `manual` — không phải field response, chỉ trong outbox payload):

```json
{ "data": { "session": { "id": "…", "status": "cancelled", "version": 2 } }, "error": null, "meta": { "requestId": "req_…" } }
```

- Success — idempotent no-op khi session đã `cancelled` (hoặc `commandId` replay): cùng envelope, `status: "cancelled"`, `version` **không** đổi, không emit `session.cancelled` trùng; nhánh no-op này **không** cần `expectedVersion` khớp (edge #27, mirror publish idempotent-thắng-version).
- Error — `expectedVersion` thiếu hoặc mismatch (`409`, optimistic lock — bắt buộc mọi nguồn, edge #26; đóng race "click Huỷ nháp cũ cancel nhầm session vừa published"):

```json
{ "data": null, "error": { "code": "STALE_VERSION", "message": "Dữ liệu đã thay đổi — tải lại", "statusCode": 409 }, "meta": { "requestId": "req_…" } }
```

- Error khác: session `closed` → `SESSION_NOT_OPEN` (`409`, edge #11/#27). **CancelSession** trên session `open` với `starts_at<=now()` (past) → `SESSION_NOT_OPEN` (`409`, edge #31 — cancel-scoped past-guard; no-past-guard exemption chỉ cho nguồn `draft`). **KHÔNG generalise sang command khác:** AnnounceSession trên `open` đang-diễn-ra (past-start, `ends_at` chưa qua) vẫn **ALLOWED** (edge #46) — announce là notification (exempt edge #11), không mutation; nhưng session đã hết giờ (`ends_at<=now()`) → `SESSION_ALREADY_ENDED` (freshness guard RIÊNG của announce, KHÔNG phải edge #31's cancel-weight). Nguồn `open` **tương lai** (nguồn `open` đã qua `starts_at` dừng ở `SESSION_NOT_OPEN` theo edge #31 ngay trên, trước version + money) → `CANCEL_REQUIRES_REVIEW` (`400`, edge #5/#54, DD-131 OD-1) khi: active roster ≠ 0 (cổng #3 — host gỡ từng player trước), một charge mang tiền đã ghi nhận (net allocated > 0, kể cả `void` — host hoàn tác payment trước), hoặc một charge không-`void` không có active player (anomaly, fail-closed); charge `void` của player chưa trả đã bị gỡ **không** chặn — bảng quyết định: §4 "Close / Cancel money policy". Nguồn `draft` với anomaly (`players`/`charges` bất thường) → **cùng** `CANCEL_REQUIRES_REVIEW` (`400`) + audit (edge #28) — không invent code riêng cho draft. `commandId` dedup theo canonical `processed_commands` (edge #3), cùng cơ chế mọi session command — không đổi cho nguồn `draft`.

- `commandId` dedup theo canonical `processed_commands` (edge #3).

**GET `/api/sessions`** — list, tenant-scoped:

- Success (HTTP 200):

```json
{ "data": { "sessions": [ { "id": "…", "status": "open", "startsAt": "…", "slotsMax": 8 } ], "pageInfo": { "hasMore": false } }, "error": null, "meta": { "requestId": "req_…" } }
```

**GET `/api/sessions/:id`** — detail, scoped by role (Host thấy full roster; Player thấy theo E#6 venue-visibility — venue public theo mặc định (DD-139); khi `sessions.hide_exact_address` ON thì chỉ `players.status='active'` mới thấy venue chi tiết):

- Success (HTTP 200 — Host view):

```json
{ "data": { "session": { "id": "…", "status": "open", "startsAt": "…", "venueName": "…", "players": [ { "id": "…", "status": "active" } ] } }, "error": null, "meta": { "requestId": "req_…" } }
```

- Error — session không tồn tại trong tenant context:

```json
{ "data": null, "error": { "code": "SESSION_NOT_FOUND", "message": "Buổi chơi không tồn tại", "statusCode": 404 }, "meta": { "requestId": "req_…" } }
```

### Idempotency

| Endpoint | Idempotent? | Key |
|----------|-------------|-----|
| POST /sessions | ✅ | `commandId` |
| PUT /sessions/:id | ✅ | `commandId` |
| POST /sessions/:id/announce | ✅ | `commandId` |
| POST /sessions/:id/publish | ✅ | canonical `processed_commands` command-dedup (edge #3, inherit — same as all session commands); publish already-open = no-op |
| POST /sessions/:id/close | ✅ | Close already-closed = no-op |
| POST /sessions/:id/cancel | ✅ | Cancel already-cancelled = no-op (áp dụng cả khi nguồn là `draft`); source `draft` hoặc `open` cùng dedup key |

### Messenger create-session command path

1. Endpoint/context layer resolves central/tenant Page, actor and eligible target tenant per DD-65/66.
2. One durable pre-dispatch interaction stores validated draft, step, expiry, version/snapshot and `commandId`; cancel/context-switch/expiry clears it.
3. Final preview does not mutate. Confirm re-checks actor+Page binding, `session.manage`, tenant status and snapshot under the command boundary.
4. Adapter emits the same `CreateSession` input as web/Zalo. `SessionService` owns validation/write/outbox; duplicate confirm returns the stored command result.


### Invite Friend & Guest Note endpoints — Request/Response Examples

**POST `/api/sessions/:id/invite`** — Player active invite friend đã follow:

- Request:

```json
{ "commandId": "cmd_…", "inviteePersonId": "person_…" }
```

- Success (HTTP 200 — `join_policy='open'`):

```json
{
  "data": {
    "player": { "id": "player_…", "status": "active", "invitedByPersonId": "person_inviter_…" }
  },
  "error": null
}
```

- Success (HTTP 200 — `join_policy='approval'`):

```json
{
  "data": {
    "player": { "id": "player_…", "status": "pending", "invitedByPersonId": "person_inviter_…" }
  },
  "error": null
}
```

- Error cases: `INVITE_NOT_ALLOWED` (403), `PLAYER_NOT_ACTIVE` (403), `FOLLOW_REQUIRED` (400), `ALREADY_JOINED` (409), `SESSION_FULL` (409), `MEMBER_BLOCKED` (403), `SESSION_NOT_OPEN` (409)

**POST `/api/sessions/:id/guest-notes`** — Player active tạo guest note:

- Request:

```json
{ "commandId": "cmd_…", "guestName": "Nguyễn Văn A", "note": "Bạn của Trần B" }
```

- Success (HTTP 201) — **✅ khớp DTO thật đã ship** (`apps/web/app/api/sessions/[id]/guest-notes/route.ts:81-87`, pinned bởi `route.test.ts:90-92`; sửa 2026-09-12, `ap3-intake` Q1a): DTO KHÔNG echo `guestName`/`note`/`createdAt` — replay không tái tạo được request content (DD-117 D5), một command chỉ có MỘT response shape:

```json
{
  "data": {
    "guestNote": { "id": "note_…", "sessionId": "…", "remainingNotes": 2 }
  },
  "error": null
}
```

- Error cases: `INVITE_NOT_ALLOWED` (403), `PLAYER_NOT_ACTIVE` (403), `GUEST_NOTE_LIMIT_REACHED` (400), `INVALID_INPUT` (400 — độ dài hoặc NUL/lone-surrogate, xem Error Codes), `SESSION_FULL` (409), `SESSION_NOT_OPEN` (409)

**DELETE `/api/sessions/:id/guest-notes/:noteId`** — Player xoá note mình tạo:

- Success (HTTP 200) — **✅ khớp DTO thật đã ship** (`apps/web/app/api/sessions/[id]/guest-notes/[noteId]/route.ts:81-83`, pinned bởi `route.test.ts:85`; sửa 2026-09-12, `ap3-intake` Q1b): `{ "data": { "guestNote": { "id": "note_…", "sessionId": "…", "deleted": true } }, "error": null }` — không có `slotsFreed` field (chưa từng tồn tại trong code)
- Error cases: `NOT_NOTE_CREATOR` (403), `GUEST_NOTE_NOT_FOUND` (404)

**GET `/api/sessions/:id/guest-notes`** — List guest notes for session:

> ⏸ **CHƯA BUILD — deferred, chờ Milestone 2** (sửa 2026-09-12, `ap3-intake` Q1c). `apps/web/app/api/sessions/[id]/guest-notes/route.ts` tự comment: "There is deliberately NO GET on this path in this slice" — một list endpoint không có body cần route qua một body-less auth-context resolver mà `resolveSessionCommandContext` chưa có. Đó là `session-management-m02-read-routes-admin-scoped` (Milestone 2, `ap3/features/session-management/PLAN.md`) — **supervised, chưa chạy** (sửa auth choke-point). Example dưới là contract DỰ KIẾN, không phải đã ship.

- Success (HTTP 200, dự kiến):

```json
{
  "data": {
    "guestNotes": [
      { "id": "note_…", "guestName": "…", "note": "…", "createdByPersonId": "…", "createdAt": "…" }
    ]
  },
  "error": null
}
```

**POST `/api/sessions/:id/players/:playerId/approve`** — Host approve pending invite:

- Request: `{ "commandId": "cmd_…" }`
- Success (HTTP 200): `{ "data": { "player": { "id": "…", "status": "active" } }, "error": null }`
- Error cases: `PLAYER_NOT_FOUND` (404), `PLAYER_NOT_PENDING` (400), `SESSION_FULL` (409)

**POST `/api/sessions/:id/players/:playerId/reject`** — Host reject pending invite:

- Request: `{ "commandId": "cmd_…" }`
- Success (HTTP 200): `{ "data": { "rejected": true }, "error": null }`
- Error cases: `PLAYER_NOT_FOUND` (404), `PLAYER_NOT_PENDING` (400)

### Rate Limits

| Endpoint | Limit | Scope |
|----------|-------|-------|
| `POST /api/sessions` | 10/min | per tenant |
| `PUT /api/sessions/:id` | 20/min | per tenant |
| `POST /api/sessions/:id/players` | 15/min | per tenant |
| `DELETE /api/sessions/:id/players/:pid` | 10/min | per tenant |
| `GET /api/sessions` | 60/min | per tenant |
| `GET /api/sessions/:id` | 60/min | per tenant |
| `POST /api/sessions/:id/invite` | 10/min | per user per session |
| `POST /api/sessions/:id/guest-notes` | 10/min | per user per session |
| `DELETE /api/sessions/:id/guest-notes/:noteId` | 10/min | per user |
| `GET /api/sessions/:id/guest-notes` | 30/min | per user |
| `POST /api/sessions/:id/players/:pid/approve` | 10/min | per tenant |
| `POST /api/sessions/:id/players/:pid/reject` | 10/min | per tenant |
---

## 4. Chi tiết triển khai

### Events

| Event | Trigger | Payload |
|-------|---------|---------|
| `session.created` | Create command | `session_id`, `tenant_id`, `visibility` |
| `session.published` | Publish command (`draft` → `open`) | `session_id`, `tenant_id`, `visibility` |
| `session.updated` | Update command | `session_id`, `changed_fields[]` |
| `session.visibility_changed` | Public ↔ private | `session_id`, `new_visibility` |
| `session.closed` | Close command / auto | `session_id`, `close_reason` |
| `session.cancelled` | Cancel command (draft discard hoặc open cancel), hoặc auto-expiry job | `session_id`, `roster_count`, `has_paid`, `cancel_reason` (manual/auto) |
| `session.expiry_anomaly_detected` | Draft discard (host hoặc auto-expiry) phát hiện `players`/`charges` bất thường trên một session `draft` (edge #28) | `session_id`, `tenant_id`, `source` (manual/auto), `anomaly_fields[]` (tên field vi phạm — vd. `['players']`, `['charges']` — KHÔNG log roster/số tiền thật). Cùng canonical outbox mechanism `session.cancelled` dùng — append-only, KHÔNG unique constraint ở layer này (mirror `waitlist.charge_derivation_failed`); owner-facing alert consumer dedup theo `session_id` là việc của consumer đó, không phải của việc ghi event |
| `session.announcement_requested` | Announce command | `session_id`, `channel` |
| `player.waitlisted` | Join khi full | `session_id`, `player_id`, `waitlist_position` |
| `player.promoted` | Leave/capacity+ mở slot | `session_id`, `player_id`, `charge_id` |
| `waitlist.charge_derivation_failed` | First-activation derivation fail trong capacity opener/retry sweep | `failure_event_id`, `promotion_retry_id`, `session_id`, `player_id`, `waitlist_entry_version`, root `origin_command_id`, `reason_code`; unique candidate key `(session_id,player_id,waitlist_entry_version,origin_command_id,reason_code)`. Sibling events reference one root job; retry command ID không thay origin |
| `player.invited` | Player active invite friend thành công | `session_id`, `inviter_person_id`, `invitee_person_id`, `invitee_player_id`, `join_outcome` (`active`/`pending`) |
| `player.invite_approved` | Host approve pending invite | `session_id`, `player_id`, `approved_by_person_id` |
| `player.invite_rejected` | Host reject pending invite | `session_id`, `player_id`, `rejected_by_person_id` |
| `guest_note.created` | Player tạo guest note | `session_id`, `note_id`, `created_by_person_id`, `note_count` |
| `guest_note.deleted` | Player xoá guest note | `session_id`, `note_id`, `deleted_by_person_id` |

### Publish transition (`draft` → `open`)

`PublishSession` (distinct command, `commandId`) là transition **status-only** `draft` → `open` để session bắt đầu nhận join. Cùng `SessionService` shared bởi chat + web — không duplicate logic. Publish **không** đổi `visibility` (visibility set ở create/edit, E#7-validated độc lập); nó chỉ mở trạng thái.

> **⛔ CODE-READINESS — publish contract AUTHORED, 3 gate đã đóng ở spec level (không còn spec gap known-open):** contract này được author ahead of ba gate. **(1)** `docs-billing-publish-suspension-authority` — **RESOLVED/merged**: billing status-authority (cột/giá trị nào block) pin tại `feature_billing_lifecycle_tech.md` §3 Status Authority (fail-closed 2-step, `authorizeTenantAction`, founder-ratified 2026-07-24). **(2)** `docs-prd-flow2-publish-projection-reconcile` — **RESOLVED/merged**: `PRD.md` v2.8g FLOW 2 (+FLOW 12/14, `business-rules.md` BL-DSC-2) nay khớp project-on-publish (step 7 dưới), hết conflict với project-on-create. **(3)** `docs-session-publish-concurrency-recheck` — **RESOLVED AT SPEC LEVEL bởi chính slice này**: billing status-authority check phải re-evaluate TRONG CÙNG transaction/row-lock với mutation `draft`→`open`, qua **locking read** (`SELECT ... FOR SHARE` trên `tenants` rồi `subscriptions`) — KHÔNG chỉ upfront step 1, và KHÔNG chỉ plain re-select cùng transaction (round-01 [P1]: không lock thì không serialize với writer trên bảng khác) — xem step 6 + blockquote "Billing suspension — concurrency" dưới; đóng đúng race mà `feature_billing_lifecycle_tech.md` §3 Concurrency clause + test #36 pin làm acceptance criterion. Đây **KHÔNG** phải certification `CODE_READY` đầy đủ theo `../../standards/review-code-readiness-gate.md` (chưa chạy closure matrix/acceptance-matrix/implementation-artifact pass) — build slice kế tiếp vẫn phải tự chứng minh implementation thoả cả 3 gate trên (đặc biệt billing test #36) trước khi enable. (Draft-cleanup `docs-session-draft-lifecycle` vẫn là follow-up mềm hơn, ngoài 3 gate trên.) Slice `docs-session-publish-contract` gốc chỉ AUTHOR docs contract; slice này đóng gate (3) — **không authorize code**.

1. Resolve trusted actor/tenant từ context (không từ payload). **AuthZ re-checked trên MỌI publish call (kể cả replay/no-op — authz đứng TRƯỚC dedup + state lookup):** (a) `session.manage` (Host) — actor thiếu quyền → 403 kể cả khi retry một session đã `open` (**authz thắng no-op**); non-admin 403 (edge #10). (b) **Billing suspension (fail-closed, dependency on `feature_billing_lifecycle`):** publish là action "publish new sessions" → block **`TENANT_SUSPENDED`** (403, canonical tenant-routing code) khi tenant billing-suspended per billing **Suspended Action Matrix** (catalog invariant `billing-authz`, `docs/autopilot-invariant-catalog.md` — ActionClass enum + Suspended Action Matrix; `suspended` ❌; `active`/`past_due` ✅). Status-authority **resolved** — `feature_billing_lifecycle_tech.md` §3 (fail-closed 2-step, `authorizeTenantAction`). **Đây là upfront/fail-fast check (cũng gate no-op/replay — authz thắng no-op, step 3) — KHÔNG phải gate authoritative cho mutation thật**, vì nó chạy TRƯỚC session lock; gate authoritative cho mutation nằm ở step 6 (re-check bắt buộc trong cùng transaction/lock). Sau khi authz+billing pass → command dedup theo **canonical `processed_commands` command-dedup** (edge #3) — publish dùng chung cơ chế dedup như MỌI session command, KHÔNG special-case. Collision-safety (cùng `commandId`, khác resource/payload) là property của canonical dedup contract đó (nó mạnh lên thành `IDEMPOTENCY_CONFLICT` khi `processed_commands.request_hash` additive migration land — owned by Session Organize plan); publish **inherit** whatever canonical dedup cung cấp, KHÔNG re-specify hay tự gate trên `request_hash`.
2. Lock session row `FOR UPDATE` trong tenant context (RLS choke-point). Đọc `status`, `visibility`, `starts_at`, `version` under lock — không quyết định từ cache.
3. **Idempotent no-op (thắng `expectedVersion`):** đã pass authz+billing (step 1); nếu `status='open'` sẵn → return success no-op, zero mutation, **không** emit `session.published` trùng (mirror close-already-closed / cancel-already-cancelled). `expectedVersion` **KHÔNG** kiểm ở nhánh này: publish không mutation ở đây nên không có lost-update để guard — một `commandId` mới với `expectedVersion` stale trên session đã `open` vẫn trả **no-op success** (idempotency thắng `STALE_VERSION`; goal state `open` đã đạt). *Ordering:* nếu actor đã mất `session.manage` hoặc tenant billing-suspended, **step 1 trả 403 TRƯỚC** khi tới no-op (authz/billing thắng no-op) — no-op chỉ dành cho actor còn quyền.
4. **Transition guard:** `status ∈ {closed, cancelled}`, hoặc `status='draft'` nhưng `starts_at <= now()` (past) → `SESSION_NOT_OPEN` (409), zero mutation. Chỉ `draft` với `starts_at > now()` mới publish được (past-guard cùng ngưỡng `starts_at <= now()` như promotion §4 và auto-close).
5. **Public precondition:** nếu `visibility='public'` → re-validate E#7 discovery completeness (sport, area, starts_at, `slots_max IS NOT NULL`) — đây là transition **bật public projection** nên discovery phải đủ. Thiếu → `MISSING_DISCOVERY_FIELDS` (400), zero mutation. Private → bỏ qua (visibility không đổi ở publish).
6. **Commit — CHỈ cho mutation `draft`→`open` (một transaction):** **Billing re-check bắt buộc — LOCKING read, KHÔNG phải plain re-select (concurrency — build-time correctness requirement, KHÔNG phải optional hardening):** ngay TRƯỚC khi mutate, re-evaluate `authorizeTenantAction(tx, tenantId, 'publish_new_sessions')` TRONG CÙNG transaction đang giữ session lock từ step 2, và ở nhánh mutating này `authorizeTenantAction` PHẢI đọc qua `SELECT ... FOR SHARE` trên đúng row `tenants` rồi `subscriptions` (thứ tự khoá = thứ tự step 1→step 2 của chính status-authority, `feature_billing_lifecycle_tech.md` §3 — tenant-root axis trước, billing axis sau) — **một plain re-SELECT trong cùng transaction KHÔNG đủ**: dưới READ COMMITTED, một read thường không tự serialize với writer concurrent trên bảng KHÁC (`subscriptions`/`tenants` ≠ `sessions` — giữ session lock không khoá được row billing); chỉ lock thật trên đúng row đó mới ép ordering với Daily Lifecycle Job's `FOR UPDATE SKIP LOCKED`. Với `FOR SHARE`: nếu job đã giữ lock trước → re-check BLOCK tới khi job's transaction resolve rồi đọc giá trị mới nhất (thấy `suspended` nếu job vừa commit); nếu re-check giữ `FOR SHARE` trước → job's `SKIP LOCKED` tự bỏ qua row lượt cron này (suspend dời sang lượt sau), publish tiếp tục an toàn vì trạng thái đã quan sát tại một điểm serialize hợp lệ. step 1's check chỉ fail-fast/gate no-op, KHÔNG authoritative cho mutation vì nó chạy TRƯỚC lock. **Failure mode:** nếu re-check (dưới lock) resolve tenant `suspended` (fail-closed union, billing §3) → `TENANT_SUSPENDED` phải THẮNG, abort mutation, zero mutation, không emit event — kể cả khi step 1 đã pass và suspend chỉ vừa land giữa chừng publish. Chỉ khi re-check vẫn pass mới tiếp tục mutation: `expectedVersion` (nếu client gửi) chỉ được kiểm ở nhánh này (status vẫn `draft`) — mismatch → `STALE_VERSION` (§1); rồi set `status='open'`, bump `version`, ghi đúng một `session.published` outbox event. `FOR UPDATE` (session) + draft-guard + billing re-check (`FOR SHARE`, locking) là an toàn concurrency chính; `expectedVersion` là guard phụ cho stale draft edit. Status-only — `visibility` giữ nguyên.
7. **Public marketplace projection (timing = project-on-publish, reconciled):** publish emit canonical outbox event + status change; **owner projector là `feature_marketplace_discovery`** — algorithm này KHÔNG author projector. Session-side intent: public projection bật TẠI publish (`draft`→`open`), khớp marketplace projector open-only. **Reconciled** — `docs-prd-flow2-publish-projection-reconcile` **RESOLVED/merged**: `PRD.md` v2.8g FLOW 2 (+FLOW 12/14, `business-rules.md` BL-DSC-2) nay khớp project-on-publish, hết conflict với project-on-create trước đây. (Announce lên group là command riêng `AnnounceSession`/SES-UC-3, **KHÔNG** coupled với publish.)

> Idempotency là hai lớp: (a) `commandId` dedup theo **canonical `processed_commands` command-dedup** (edge #3) — publish inherit như mọi command, không re-specify; collision-safety per canonical contract (mạnh lên khi `request_hash` migration land) và (b) state no-op (session đã `open`) — cả hai đều không double-emit `session.published` hay double-flip status. Cùng contract với close/cancel no-op (§3 Idempotency).

> **Billing suspension gate** (catalog invariant `publish-suspend-gate`, `docs/autopilot-invariant-catalog.md`) **(fail-closed — dependency on `feature_billing_lifecycle`, RESOLVED/merged):** publish là action **"publish new sessions"** trong billing **Suspended Action Matrix** (`active`/`past_due` ✅, **`suspended` ❌**). Publish **fail-closed block `TENANT_SUSPENDED`** (403, canonical tenant-routing code) khi tenant `suspended` (admin / abuse — DD-142: không suspended vì billing), zero mutation, không emit event. **Status-authority resolved:** billing (matrix owner) định nghĩa **authoritative status source** (`suspended` sống trong `tenants.status`/`subscriptions.status`, cả hai `CHECK 'suspended'` từ 0002/0007) tại `feature_billing_lifecycle_tech.md` §3 Status Authority — fail-closed 2-step (`tenants.status` trục tenant-root xét trước, thắng vô điều kiện; `subscriptions.status` trục billing chỉ xét khi trục tenant clear), founder-ratified 2026-07-24; session publish contract chỉ **cross-ref** matrix/authority qua `authorizeTenantAction('publish_new_sessions')`, không tự đọc `tenants.status`/`subscriptions.status`. **Không** thêm session error code (denial là billing-owned 403); matrix single source of truth — adapters không tự nới.
>
> **Billing suspension — concurrency (build-time correctness requirement, tách biệt với status-authority ở trên):** status-authority resolve **status nào authoritative**; nó KHÔNG tự resolve **khi nào** và **bằng cách nào** phải đọc status đó. `authorizeTenantAction` không phải advisory check-một-lần-sớm-rồi-quên (billing §3 Concurrency clause) — implementation PHẢI re-evaluate nó **trong cùng transaction với session lock, ngay trước commit** (step 6 trên) **VÀ đọc qua locking read (`SELECT ... FOR SHARE` trên `tenants` rồi `subscriptions`, cùng thứ tự step 1→step 2 của status-authority)** — **một plain re-SELECT trong cùng transaction KHÔNG đủ** (codex round-01 [P1]: dưới READ COMMITTED, một read thường không serialize với writer concurrent trên bảng khác chỉ vì "cùng transaction"; giữ session lock không khoá được row billing — chỉ lock thật trên đúng row `tenants`/`subscriptions` mới ép ordering với Daily Lifecycle Job's `FOR UPDATE SKIP LOCKED`). **Failure mode nếu implement sai (thiếu re-check, hoặc re-check không lock):** một suspend transition (Daily Lifecycle Job `past_due→suspended` — DD-142: billing không còn suspend (hạ xuống Free); hàng backlog `billing-late-host-pro-invoice-downgrade-to-free`) commit **giữa** lúc step 1 check và lúc mutation commit → publish vẫn thành công cho tenant vừa suspend; `TENANT_SUSPENDED` phải luôn thắng bất kể suspend đến giữa chừng publish. `docs-session-publish-concurrency-recheck` đóng gate này **AT SPEC LEVEL** (step 6 trên); build slice phải tự chứng minh implementation thoả bằng billing test #36 (competing-writer acceptance criterion, `feature_billing_lifecycle_tech.md` §5).

> **Dọn draft chưa publish (resolved — `docs-session-draft-lifecycle`):** publish reject past draft (`starts_at <= now()`) → `SESSION_NOT_OPEN` là **founder-ratified** (step 4) và giữ nguyên — publish KHÔNG tự invent draft-terminal transition. Việc **DỌN** một draft chưa bao giờ publish và đã quá giờ (gap có sẵn từ mô hình `create=draft`, v2.12c) nay author ở subsection **Draft discard + auto-expiry** ngay dưới đây: host-discard (`CancelSession` mở rộng nhận nguồn `draft`) và system auto-expiry job đều flip `draft`→`cancelled`. (Reconcile prose PRD FLOW 2 ("public → marketplace") cho khớp project-on-publish — `docs-prd-flow2-publish-projection-reconcile` — RESOLVED/merged, xem step 7.)

### Draft discard + auto-expiry (`draft` → `cancelled`)

`CancelSession` (existing command, không command mới/endpoint mới) mở rộng chấp nhận nguồn `draft` bên cạnh `open`. Theo **thiết kế**, một session `draft` không thể có `players` hay `charges` nào — join chỉ khả thi sau khi `PublishSession` flip status sang `open` (đầu subsection Publish transition ở trên; SES-UC-12 product spec). Nhưng "draft không roster" là bất biến **ứng dụng**, KHÔNG phải constraint DB (không FK/CHECK/trigger nào ràng `sessions.status` với sự tồn tại của `players`/`charges`) — import, bug trước đây, hoặc data repair trực tiếp về lý thuyết có thể để lại một `draft` mang roster/tiền thật. Nhánh discard vì vậy KHÔNG được giả định rỗng: nó **verify dưới lock rồi mới quyết định** fast-path hay fail-closed (chi tiết step 6 dưới; cùng nguyên tắc fail-closed edge #5 áp dụng cho nguồn `open`).

**Host-initiated discard:**

1. Resolve trusted actor/tenant từ context. AuthZ re-check mọi call: `session.manage` (Host) — thiếu quyền → 403 (edge #10). Past-guard áp dụng **có điều kiện theo nguồn** — chi tiết step 4 (KHÔNG mở rộng no-past-guard sang `open`, xem edge #31).
2. Lock session row `FOR UPDATE` (cùng choke-point discipline mọi session command khác, §1).
3. **Idempotent no-op:** nếu `status='cancelled'` sẵn → return success no-op, zero mutation, không duplicate `session.cancelled` (mirror publish/close no-op, edge #21/#27).
4. **Transition guard:** `status='closed'` → reject `SESSION_NOT_OPEN` (edge #11/#27, không đổi). `status='open'` VÀ `starts_at<=now()` (past) → **CŨNG** reject `SESSION_NOT_OPEN` (edge #11 hiện có, không đổi: mutation trên past session cần privileged correction + audit trail, KHÔNG qua path cancel thường; giữ ĐÚNG lời hứa "open→cancelled không đổi hành vi" ở step 6 — discard KHÔNG được mở rộng no-past-guard sang `open`, edge #31). `status='draft'` → không past-guard (draft chưa từng `open`, không có roster/refund/"buổi chơi đã diễn ra" để edge #11 bảo vệ) — hợp lệ bất kể `starts_at`. Chỉ hai nhánh còn lại (`draft` bất kỳ lúc nào, hoặc `open` với `starts_at>now()`) mới tiếp tục.
5. **`expectedVersion` là bắt buộc trên nhánh mutate này cho MỌI nguồn** (`draft` lẫn `open` — không riêng draft; khác nhánh no-op idempotent ở step 3, vốn thắng version — mirror publish) — kiểm với `version` live dưới lock trước khi mutate: **mismatch HOẶC thiếu** đều là `STALE_VERSION` (409, edge #26). Đây là lần đầu algorithm cancel được pin chi tiết (trước slice này chưa có subsection riêng) — chọn bắt buộc thống nhất, đúng nguyên tắc optimistic concurrency đã khai báo chung cho mọi command (§1 Design decisions "stale edits rejected"), thay vì để tuỳ chọn rồi phải phân biệt theo nguồn (không có tín hiệu server-side nào phân biệt được "click Huỷ nháp bỏ version" khỏi "Huỷ session bỏ version" một khi cả hai đều thấy `status='open'` dưới lock — chỉ version mới đóng được race category-jump `draft`→`open`). Không có code/behavior cũ nào bị phá vỡ (`Implementation: Not started`).
6. Nguồn `open`: cổng #3 (active roster ≠ 0 → `CANCEL_REQUIRES_REVIEW`) rồi money guard của DD-131 OD-1 (tiền đã ghi nhận hoặc charge không-`void` không có active player → `CANCEL_REQUIRES_REVIEW`; charge `void` không chặn) — chi tiết + bảng quyết định: subsection "Close / Cancel money policy" bên dưới (`expectedVersion` bắt buộc ở step 5 áp dụng thống nhất mọi nguồn).
   Nguồn `draft`: dưới cùng lock, kiểm `players`/`charges` của session. Rỗng (kỳ vọng theo thiết kế) → fast-path, đi thẳng tới commit, không cần gate `review_policy`. Phát hiện bất kỳ row nào (anomaly — vi phạm bất biến ứng dụng) → **fail-closed**: KHÔNG tự động huỷ; trả `CANCEL_REQUIRES_REVIEW` (§3 Error Codes — cùng code, cùng review surface `review_policy` của edge #5 dùng cho nguồn `open` paid roster, KHÔNG invent code riêng) + audit (edge #28) — coi đây là dữ liệu cần host xem xét, không phải draft rỗng thật.
7. Commit: set `status='cancelled'`, bump `version`, ghi đúng một `session.cancelled` outbox event (`cancel_reason='manual'`) trong cùng transaction.

**System auto-expiry job (mirror discipline của `feature_billing_lifecycle_tech.md` §4 Daily Lifecycle Job — file đó KHÔNG bị sửa, chỉ tham chiếu pattern; CÙNG mức trừu tượng: role thực thi/grants/migration wiring và queue/cron registration là **build-slice detail**, KHÔNG đặc tả ở đây — giống hệt Daily Lifecycle Job không tự đặc tả wiring của chính nó trong doc đó):**

```text
Scheduled run → Claim sessions WHERE status='draft' AND starts_at<=now() FOR UPDATE SKIP LOCKED (batched)
    → mỗi row đã claim: verify players/charges rỗng (cùng fail-closed check host-discard step 6)
        → rỗng: set status='cancelled', bump version, ghi session.cancelled (cancel_reason='auto')
        → anomaly: KHÔNG mutate, ghi session.expiry_anomaly_detected (§4 Events table), route qua
          review_policy (edge #5) như nguồn open — không tự động huỷ dữ liệu chưa chứng minh an toàn
    → COMMIT
```

- **Idempotent/no-double-cancel:** filter claim (`status='draft' AND starts_at<=now()`) tự nhiên idempotent — row đã `cancelled` không còn khớp filter, không bị re-select lượt sau. `FOR UPDATE SKIP LOCKED` chống hai lượt chạy chồng lấn (scheduler tick trùng, nhiều instance) cùng claim một row — lượt sau skip row lượt đầu đang giữ lock.
- **Race vs. `PublishSession` (edge #29):** cả hai path lock session row `FOR UPDATE` trước khi mutate (session-lock-ordering, cùng discipline Publish step 2 và Waitlist promotion step 1). Job lock trước → publish concurrent chờ, thấy `status='cancelled'` → reject `SESSION_NOT_OPEN` (edge #23, không đổi). Publish lock trước → job's `FOR UPDATE SKIP LOCKED` skip row lượt chạy này; row giờ `open`, không còn khớp filter lượt sau. Không thứ tự nào double-transition — mirror, ở mức row-lock `sessions`, cùng kiểu competing-writer resolution mà `feature_billing_lifecycle_tech.md` test #36/#36a chứng minh ở mức row-lock `subscriptions`.
- **Anomaly fail-closed (edge #28):** một draft anomaly bị skip vẫn còn `status='draft'`, vẫn khớp filter claim — job SẼ re-claim + re-check nó mỗi lượt chạy (rẻ, read-mostly, không mutation — KHÔNG phải bug). `session.expiry_anomaly_detected` ghi mỗi lần phát hiện — cùng canonical outbox mechanism `session.cancelled` dùng (`feature_sync_engine_tech.md` §2, không invent scheme mới, không sửa file đó), không phải cơ chế riêng. Owner-facing alert dedupe theo `session_id` là việc của consumer đọc event đó — mirror "Owner alert/digest dedupes per root" của Waitlist promotion §4 — nhưng consumer/storage chính xác, cùng với execution role/grants/batching/queue registration, là **build-slice detail** (cùng gap pre-existing với `review_policy` chính nó, edge #5, chưa từng detail trước slice này).
- **Tần suất/batch size** là operational config, không phải spec-level contract (cùng cách xử lý "bounded horizon (configurable)" của Recurrence Implementation, §4).
- Không cần `commandId`/`processed_commands` dedup cho job path — idempotency đến từ filter claim, cùng lý luận Daily Lifecycle Job tự thân dựa vào (job đó cũng không đi qua client-facing command envelope).

### Close / Cancel money policy (DD-131 OD-1)

> **Authority:** DD-131 OD-1 + DD-132 (OD-0) — **DD-131 / DD-132 (pending in PR #51)**; đảo vế close của DD-117 D3, giữ cổng #3 của
> owner cho cancel. Runtime: `packages/db/src/session-service.ts` (`closeSession`, `cancelSession`, helper `sessionChargeBalances`)
> + `packages/db/src/payment-manual.ts` `chargeRemaining` (công thức `remaining` duy nhất, dùng chung với read model host);
> test thật: `packages/db/src/session-close-cancel-money-policy.test.ts` (CM-*, CX-*, CC-*, AG-*) + `session-service.test.ts` (C-*, XC-*);
> route: `apps/web/app/api/sessions/[id]/close/route-db.test.ts`. Không migration, không bảng/cột mới.

**Luật (một read duy nhất cho cả hai guard — `sessionChargeBalances`, không công thức thứ hai):**

- *Net allocated* của một charge = `effectiveByCharge` (SUM `payment_allocations.amount`, reversal là dòng âm) — đúng giá trị
  `effectiveAllocated` mà read model host (`session-read.ts` `getSessionDetail`) hiển thị.
- *Dư nợ* = `chargeRemaining(amount_due, net, status)` > 0 — hàm `remaining` duy nhất, mà read model host (`remaining`), close guard
  và dòng mark-paid cùng gọi (⇔ charge **không** `void` mà `chargeStatusFor` (INV-7) ≠ `paid`). Charge `void` có `remaining = 0`;
  charge giá 0 là `paid` với 0 tiền ("exempt"). Test pin đúng phần sau: AG-1/AG-2 — close từ chối đúng các dòng roster có
  `remaining` > 0 trên state do writer tạo (ở đó `status`/`amount_allocated` lưu luôn khớp ledger); AG-4 — trên charge forged có
  `status`/`amount_allocated` lưu lệch ledger (`paid` trên ledger rỗng, `open`/`partial` trên ledger đã trả đủ), close và roster
  vẫn cùng theo ledger, nên guard hoặc roster suy ra từ cột lưu sẽ làm AG-4 fail; AG-3 — giá trị của `chargeRemaining`. Việc cả
  ba cùng gọi một hàm là thuộc tính của code, không test nào pin được.
- *Tiền đã ghi nhận* = net allocated > 0, trên **bất kỳ** charge, kể cả `void`.
- **Close** (nguồn `open`): còn ≥1 charge có dư nợ → `CLOSE_BLOCKED_OPEN_DEBT` (409) kèm `openBalancePlayers` (`playerId` +
  `displayName`, thứ tự `joined_at, id`); ngược lại → `closed`. Không có cổng roster.
- **Cancel** (nguồn `open`, sau past-guard + version): active roster ≠ 0 → `CANCEL_REQUIRES_REVIEW` (cổng #3); rồi có tiền đã ghi nhận
  HOẶC có charge không-`void` (khi roster = 0 thì charge đó không có active player — bất biến bị vi phạm, không writer nào tạo được)
  → `CANCEL_REQUIRES_REVIEW`; ngược lại → `cancelled`. Nguồn `draft`: nhánh anomaly cũ (any player / any charge, edge #28) không đổi.
- Thứ tự guard (cả hai): billing (`authorizeTenantAction`, câu lệnh đầu) → validate → advisory lock theo `commandId` + dedup →
  `sessions FOR UPDATE` → no-op idempotent → transition/past → `expectedVersion` → money. ⇒ danh sách dư nợ chỉ được tính cho caller đã
  qua route gate `session.manage` VÀ billing/status/version.

**Thứ tự lock toàn cục (đo 15/10 — không cần lock mới):** quyền tenant (`tenants`/`subscriptions` FOR SHARE; capability grants FOR SHARE
của writer) → advisory lock theo command → `sessions FOR UPDATE` (+ re-check status) → `players FOR UPDATE` → `charges FOR UPDATE`
(thứ tự UUID) → `payment_allocations FOR UPDATE`. Close/cancel dừng ở row session và chỉ ĐỌC charge + ledger; `addMemberToSession`,
`removePlayerFromSession`, `markPaid` (`lockSession`) và `reversePaymentAllocation` (`lockSession`) đều lock row session TRƯỚC khi chạm
charge/ledger và re-check status dưới lock (add/remove: `open`; mark-paid/reversal: `open`\|`closed`). READ COMMITTED: mỗi câu lệnh
sau khi lấy được lock đọc snapshot mới, nên money read luôn thấy writer đã commit trước nó (edge #53).

**Bảng quyết định — trạng thái × roster × charge × tiền** (role đã qua gate, tenant được phép; "Reach" = writer trên `main` có tạo
được không):

| # | Session | Active roster | Charge trên session | Net allocated | Reach | `CloseSession` | `CancelSession` |
|---|---|---|---|---|---|---|---|
| D1 | `draft` | 0 | không có | 0 | ✅ | `SESSION_NOT_OPEN` | `cancelled` (discard, edge #25) |
| D2 | `draft` | bất kỳ | player/charge bất kỳ (anomaly) | bất kỳ | fixture | `SESSION_NOT_OPEN` | audit `session.expiry_anomaly_detected` + `CANCEL_REQUIRES_REVIEW` (edge #28, không đổi) |
| O1 | `open` tương lai | 0 | không có | 0 | ✅ | `closed` | `cancelled` |
| O2 | `open` tương lai | 0 | chỉ `void` (player chưa trả đã bị gỡ; có thể còn `waitlisted`) | 0 | ✅ | `closed` | **`cancelled`** (ca chính của OD-1) |
| O3 | `open` tương lai | > 0 | chưa trả (`open`) | 0 | ✅ | `CLOSE_BLOCKED_OPEN_DEBT` [các player đó] | `CANCEL_REQUIRES_REVIEW` (cổng #3) |
| O4 | `open` tương lai | > 0 | trả một phần (`partial`) | > 0 | ✅ | `CLOSE_BLOCKED_OPEN_DEBT` [các player đó] | `CANCEL_REQUIRES_REVIEW` (cổng #3) |
| O5 | `open` tương lai | > 0 | trả đủ (`paid`) | > 0 | ✅ | `closed` | `CANCEL_REQUIRES_REVIEW` (cổng #3) |
| O6 | `open` tương lai | > 0 | giá 0 / "exempt" (`paid`) | 0 | ✅ | `closed` | `CANCEL_REQUIRES_REVIEW` (cổng #3) |
| O7 | `open` tương lai | > 0 | trộn: đủ + một phần/chưa trả + `void` | bất kỳ | ✅ | `CLOSE_BLOCKED_OPEN_DEBT` [chỉ một phần/chưa trả] | `CANCEL_REQUIRES_REVIEW` (cổng #3) |
| O8 | `open` tương lai | 0 | `void` mang tiền | > 0 | ❌ (remove đòi net 0; không writer nào thu tiền cho charge `void`) | `closed` (`void` = dư nợ 0) | `CANCEL_REQUIRES_REVIEW` (tiền đã ghi nhận) |
| O9 | `open` tương lai | 0 | không-`void` trên player không active | 0 hoặc > 0 | ❌ (remove void charge; join waitlist không tạo charge) | chưa trả/một phần → `CLOSE_BLOCKED_OPEN_DEBT`; đủ → `closed` | `CANCEL_REQUIRES_REVIEW` (fail-closed anomaly) |
| O10 | `open` đã qua `starts_at` | bất kỳ | bất kỳ | bất kỳ | ✅ | như O1–O9 (close không có past-guard) | `SESSION_NOT_OPEN` (edge #31, trước version + money) |
| C1 | `closed` | bất kỳ | bất kỳ | bất kỳ | ✅ | no-op idempotent | `SESSION_NOT_OPEN` |
| X1 | `cancelled` | 0 | không có / `void` | 0 | ✅ | `SESSION_NOT_OPEN` | no-op idempotent |

**Bảng quyết định — role / tenant** (trước mọi dòng trên):

| # | Caller / tenant | Kết quả |
|---|---|---|
| R1 | owner · admin (host) · co_admin — preset mặc định có `session.manage` (DD-56) | route gate qua → bảng trên |
| R2 | player (membership không có `tenant_admins`), non-member, admin của tenant khác, admin inactive | 403 `FORBIDDEN` trước command, cùng body mọi lý do — không danh sách, không ghi gì (edge #55) |
| R3 | tenant HOẶC subscription `suspended` | close/cancel vẫn được (DD-110 D2 obligation-termination) → bảng trên; mark-paid/remove bị chặn khi suspended (class `mark_paid`/`manage_roster`) nên session còn nợ đứng tới khi tenant hoạt động lại |
| R4 | tenant/subscription `cancelled`, thiếu subscription, status lạ | `TENANT_SUSPENDED` (403) — câu lệnh đầu, trước mọi status/money read |
| R5 | idempotency | refusal không ghi `processed_commands`; success replay = stored envelope (edge #56) |

**Abuse cases:**

| # | Case | Xử lý | Test |
|---|---|---|---|
| A1 | `expectedVersion` stale trên session còn nợ | `STALE_VERSION` — version check đứng trước money guard, không tính danh sách | CM-5, C-STALE-CHARGE |
| A2 | Lệnh trùng `commandId` | close/cancel thành công replay stored envelope (`replayed=true`, zero write); close bị refuse KHÔNG được ghi ⇒ retry cùng key đánh giá lại: còn nợ → refuse; đã thu → close | CM-8, C-DED, XC-DED |
| A3 | mark-paid đồng thời close | serialize trên `sessions FOR UPDATE`; pay trước → close đọc ledger mới → `closed`; close trước → chỉ commit khi không ai nợ, pay sau gặp charge đã `paid` | CC-3 |
| A4 | add-player đồng thời close | add trước → close refuse, liệt kê player mới; close trước → add thấy `closed` → `SESSION_NOT_OPEN`, zero row | CC-1, CC-2 |
| A5 | remove / add đồng thời cancel | remove trước → cancel thấy charge `void` → `cancelled`; cancel trước → add `SESSION_NOT_OPEN` | CC-4, CC-5 |
| A6 | Reversal rồi cancel | player đã trả: remove → `REMOVE_REQUIRES_REVIEW`, cancel → `CANCEL_REQUIRES_REVIEW`; owner reverse (`money.correct`) → remove (`void`) → cancel ✅ | CX-3 |
| A7 | Reversal / mark-paid trên session `cancelled` | `SESSION_NOT_OPEN` (`lockSession` có sẵn: `open`\|`closed`), zero write; cancel đòi net 0 nên không còn gì để đảo | CX-3 |
| A8 | Reversal trên session `closed` | cho phép (OD-6): charge mở lại, session vẫn `closed`, host thu lại được | CM-9 |
| A9 | Caller không phải host dò trạng thái tiền qua close | 403 trước command, danh sách không bao giờ được tính | route-db test, `close/route.test.ts` |
| A10 | Danh sách mang thêm field / lọt log | mapper allowlist chỉ `playerId`+`displayName`; field `#private` không vào `util.inspect`/JSON; refuse không ghi event/audit | `session-command-route.test.ts`, CM-2 |

### Announce transition (yêu cầu đăng thông báo lên kênh — `status` KHÔNG đổi)

`AnnounceSession` command, endpoint `POST /api/sessions/:id/announce` (Host/TenantAdmin). Emit đúng một canonical `session.announcement_requested` outbox event để channel projector đăng message join lên linked group của tenant và retry khi gửi fail (edge #10; FE SES-UC-3) — **KHÔNG** coupled với publish. Announce là **notification, KHÔNG phải state mutation**: KHÔNG đổi `sessions` row — không `status`, không bump `version`.

**Algorithm:**

1. Resolve trusted actor/tenant từ context. **Billing suspension (fail-fast, TRƯỚC dedup — authz thắng replay/no-op):** announce là action `announce_session` trong billing **Suspended Action Matrix** (`active`/`past_due` ✅, **`suspended` ❌**) — block `TENANT_SUSPENDED` (403) khi tenant billing-suspended, qua `authorizeTenantAction(tx, tenantId, 'announce_session')`. Vì announce KHÔNG mutate session, đây là check authoritative DUY NHẤT (upfront `FOR SHARE` persists tới commit, serialize với Daily Lifecycle Job's suspend); KHÔNG có bước re-check-under-session-lock riêng như publish §4 step 6.
2. Validate payload. `channel` phải là một **logical channel type đóng** — phase-1 = `zalo`/`messenger` (DD-37, bỏ Telegram; khớp `subscriptions.selected_extra_channel`), KHÔNG phải raw destination id → ngoài set → `INVALID_CHANNEL`. Enum đóng (không raw id) đảm bảo caller chỉ nêu được platform logic, projector downstream resolve về linked group của CHÍNH tenant (theo `tenant_id` trên outbox row) — không thể trỏ sang tenant khác. `commandId` dedup theo canonical `processed_commands` (edge #3), khớp cả `session` lẫn `channel`; một `commandId` dùng lại cho session/channel khác → `COMMAND_ID_CONFLICT`.
3. Lock session row `FOR UPDATE` trong tenant context (RLS choke-point). **Row không tồn tại** → `SESSION_NOT_FOUND`. Dùng `FOR UPDATE` (không `FOR SHARE`) vì outbox producer cấp sequence `COALESCE(MAX(sequence),0)+1` per aggregate; `FOR SHARE` cho phép hai announce đồng thời đọc cùng MAX rồi cùng insert seq N+1 → đụng `outbox_agg_seq_uq` (23505). `FOR UPDATE` serialize → sequence liên tiếp.
4. **Transition guard — `status='open'` VÀ ends_at freshness (HAI lý do tách biệt, edge #46; DD-111 D1).** `draft`/`closed`/`cancelled` → `SESSION_NOT_OPEN`. **KHÔNG có past-START cutoff:** một `open` session `starts_at<=now()<ends_at` (đang diễn ra) vẫn announce được — mời join muộn hợp lệ; publish's cutoff (edge #23) là publish-specific. **NHƯNG ends_at freshness guard:** `ends_at<=now()` (buổi đã kết thúc; auto-expiry chưa build nên row vẫn `open` vô hạn) → `SESSION_ALREADY_ENDED` (409). Hai lý do ĐỘC LẬP: **(a)** announce **exempt khỏi edge #11** vì **không mutate** session (edge #11 chặn *mutation* trên closed/cancelled/past — không áp cho một notification); VÀ **(b)** announce vẫn **tự guard `ends_at`** vì thông báo về một buổi ĐÃ XONG là harm mà một mutation không có — (a) một mình sẽ khiến người đọc sau xoá guard (b). **Clock:** đọc `ends_at <= clock_timestamp()` bằng query RIÊNG SAU khi đã giữ row lock (step 3) — mirror publish's post-lock clock pattern, KHÔNG `now()`/`Date.now()` (`now()` đông cứng ở đầu transaction, và clock đọc TRONG locked SELECT đang block sẽ đo thời điểm TRƯỚC khi chờ lock — publish round-05).
5. **Emit** đúng một `session.announcement_requested` outbox event (payload `session_id`, `channel`); **KHÔNG** đổi `sessions` row. Record `processed_commands`. **Commit.**

> **Không rollback theo channel-send (edge #10):** canonical write (outbox event) là nguồn sự thật; nếu projector gửi group fail → retry/reproject, KHÔNG rollback canonical write.

### Invite Friend transition (player active → friend join)

`InviteFriend` command, endpoint `POST /api/sessions/:id/invite`. Player đã `active` trong session invite friend (người đã follow player — DD-47). Kết quả phụ thuộc `join_policy`: `open` → friend vào `active`, `approval` → friend vào `pending` chờ host duyệt. Cả hai đều chiếm slot.

**Algorithm:**

1. Resolve trusted actor/tenant từ context. `commandId` dedup (edge #3).
2. Lookup session row `FOR UPDATE` trong tenant context. **Row không tồn tại** → 404. **`status != 'open'`** → reject `SESSION_NOT_OPEN`. **`allow_player_invite = false`** → reject `INVITE_NOT_ALLOWED` (edge #37).
3. **Inviter guard:** query `players WHERE session_id AND membership_id = inviter AND status = 'active'`. Không tìm thấy hoặc status khác → reject `PLAYER_NOT_ACTIVE` (edge #38).
4. **Block guard (DD-55):** query `person_blocks WHERE (blocker, blocked) IN ((inviter, invitee), (invitee, inviter))`. Có row → reject `MEMBER_BLOCKED` (edge #42). **Check trước follow** — block overrides follow.
5. **Follow guard (DD-47):** query `person_follows WHERE follower_id = invitee AND followee_id = inviter_person AND status = 'accepted'`. Không tìm thấy → reject `FOLLOW_REQUIRED` (edge #36). Client redirect tới guest note form.
6. **Duplicate guard:** query `players WHERE session_id AND membership_id = invitee_membership AND status IN ('active','waitlisted','pending')`. Có row → reject `ALREADY_JOINED` (edge #41).
7. **Capacity check:** compute occupancy = `getSessionOccupancy()` (DD-133 (a): active players + guest notes + live holds (= 0 tới khi có bảng hold, DD-132/DD-135), + pending invites sau migration thêm chúng). Occupancy ≥ `slots_max` (non-NULL) → reject `SESSION_FULL` (edge #39).
8. **Determine outcome:** `join_policy = 'open'` → `status = 'active'`; `join_policy = 'approval'` → `status = 'pending'`.
9. **Insert player row:** `INSERT INTO players (session_id, membership_id, status, invited_by_person_id, joined_at) VALUES (...)`. Emit `player.invited` outbox event.
10. **Commit.** Return player row with outcome status.

> **Pending occupancy:** `pending` players chiếm slot giống `active` — đếm trong occupancy helper. Khi host reject → slot được giải phóng → trigger promotion nếu có waitlist.

### Guest Note management

**`CreateGuestNote`** — endpoint `POST /api/sessions/:id/guest-notes`. Player active tạo ghi chú về khách ngoài hệ thống. Chiếm slot, không tạo charge.

**Algorithm:**

1. Resolve trusted actor/tenant. `commandId` dedup.
2. Lookup session `FOR UPDATE`. `status != 'open'` → `SESSION_NOT_OPEN`. `allow_player_invite = false` → `INVITE_NOT_ALLOWED`.
3. **Player guard:** inviter must be `active` → else `PLAYER_NOT_ACTIVE`.
4. **Note limit check:** `SELECT count(*) FROM session_guest_notes WHERE session_id AND created_by_person_id`. Count ≥ 3 → `GUEST_NOTE_LIMIT_REACHED`.
5. **Capacity check:** occupancy (`getSessionOccupancy()`, DD-133 (a)) ≥ `slots_max` → `SESSION_FULL`.
6. **Validate input:** `guest_name` 1–100 chars (required), `note` max 200 chars (optional, default "Bạn của [player display name]").
7. **Insert** `session_guest_notes` row. DB trigger `trg_session_guest_note_limit` is defense-in-depth.
8. Emit `guest_note.created` outbox event. **Commit.**

**`DeleteGuestNote`** — endpoint `DELETE /api/sessions/:id/guest-notes/:noteId`. Player xoá note mình tạo.

**Algorithm:**

1. Resolve actor. Lookup guest note row. **Not found** → 404 `GUEST_NOTE_NOT_FOUND`. **`created_by_person_id != actor`** → 403 `NOT_NOTE_CREATOR`.
2. Lock session `FOR UPDATE` (cùng ordering discipline).
3. `DELETE FROM session_guest_notes WHERE id = :noteId`. Emit `guest_note.deleted`.
4. **Slot release:** re-compute occupancy, publish trên `guest_note.deleted` event. **KHÔNG trigger promotion thật** (sửa 2026-09-12, `ap3-intake` Q2) — deliberately absent, xem `packages/db/src/session-service.ts:2818-2825`: chưa có join/leave/waitlist-entry code nào từng ghi `players.status='waitlisted'`, nên không có candidate để promote và không có promotion function để gọi. Promotion thật land cùng waitlist/promotion engine (D2, `ap3/features/session-management/PLAN.md`, vẫn fully blocked).
5. **Commit.**

### Approve/Reject pending invite

**`ApproveInvite`** — endpoint `POST /api/sessions/:id/players/:playerId/approve`. Host duyệt pending invite khi `join_policy='approval'`.

**Algorithm:**

1. Resolve trusted actor/tenant. AuthZ: `session.manage` (Host). `commandId` dedup.
2. Lookup session `FOR UPDATE`. `status != 'open'` → `SESSION_NOT_OPEN`.
3. Lookup player row `FOR UPDATE`. **Not found** → 404 `PLAYER_NOT_FOUND`. **`status != 'pending'`** → 400 `PLAYER_NOT_PENDING`.
4. **Capacity recheck:** pending đã chiếm slot, nhưng concurrent join/note có thể thay đổi occupancy → verify vẫn ≤ `slots_max`. Nếu không OK → `SESSION_FULL`.
5. **Update player:** `SET status = 'active'`. Emit `player.invite_approved` outbox event.
6. **Commit.**

**`RejectInvite`** — endpoint `POST /api/sessions/:id/players/:playerId/reject`. Host reject pending invite.

**Algorithm:**

1. Resolve trusted actor/tenant. AuthZ: `session.manage`. `commandId` dedup.
2. Lookup session `FOR UPDATE`. Lookup player `FOR UPDATE`. Guard: not found → 404, not pending → 400.
3. **Delete player row** (không set `left` — pending chưa bao giờ active, không có charge). Emit `player.invite_rejected`.
4. **Slot release:** re-compute occupancy → trigger waitlist auto-promote nếu có candidates.
5. **Commit.**

### Waitlist entry + rejoin disposition (DD-45/DD-49)

1. Lock session row `FOR UPDATE`; resolve trusted identity, then lookup existing membership/player read-only theo UNIQUE `(tenant_id,session_id,membership_id)` mà chưa create/lock player/finance.
2. Existing `active` hoặc `waitlisted`: return current outcome idempotently; không đổi position/charge và ban áp về sau không biến replay này thành join error.
3. Không có player hoặc existing `left`: re-check session joinability — gồm defense-in-depth §2 Capacity × visibility. Current DB `0024` đã reject `visibility='public'` + `slots_max IS NULL`; nếu pre-`0024`/fixture/constraint-bypass row vẫn tới service thì fail-closed reject, zero mutation, audit + owner-review. Đây là **một choke-point cho MỌI branch phía dưới** (first-entry step 5, left-rejoin step 6, approval path) — không branch nào treat NULL as unlimited khi state invalid — cùng DD-41, DD-42 và shared `evaluateJoinRestriction()` DD-52 (catalog invariant `member-safety`, `docs/autopilot-invariant-catalog.md`).
4. Lock every nonterminal DD-45 root immediately after session/current-state resolution and **before** membership/player/financial locks. Sau đó mới create/reuse membership. Existing `left` lock aggregate và re-derive DD-49 disposition; partial/ambiguous/core-missing → `REJOIN_REQUIRES_REVIEW`, zero mutation.
5. Không có player row: còn slot/unlimited (unlimited chỉ non-public — public+NULL đã fail-closed tại choke-point step 3) → derive amount trước mutation; success thì insert `active` + đúng một charge atomically; DD-39 derivation failure aborts join fail-closed (không membership/player/charge/venue, không fallback). Full → insert `waitlisted` + tail position + `waitlist_entry_version=1`, không charge/venue.
6. Existing `left`: còn slot → chưa-refund carry-over; refunded append lifecycle idempotent, atomic với `active`. Full → set `waitlisted`, increment durable `waitlist_entry_version`; chưa-refund giữ aggregate lịch sử, refunded **không append lifecycle/nợ mới**. Promotion re-derives later. Không INSERT duplicate `charges` row.
7. Nếu outcome observes/causes full capacity, resolve every nonterminal root in the same transaction; active outcome writes player/finance/outbox only after root lock.

### Waitlist promotion (DD-45)

> CAS-claim/lease/claimed-attempt-budget/DLQ discipline dưới đây khớp catalog invariant `retry-liveness` (`docs/autopilot-invariant-catalog.md` — worker ownership, claimed-attempt budget, DLQ/owner-review sink, DD-45).

1. Lock session row `FOR UPDATE`. If session is closed/cancelled/not joinable or `starts_at <= now()`, lock nonterminal roots next, resolve them as no longer applicable, and return without candidate/finance mutation. Capacity decrease below shared occupancy (`getSessionOccupancy()`, DD-133 (a)) rejects with zero mutation or implicit hold cancellation; retain `CAPACITY_BELOW_ROSTER` for an active-only breach and use `CAPACITY_BELOW_OCCUPANCY` when a live hold is the extra blocker.
2. Establish root epoch **before any candidate/player/finance lock**. A synchronous new capacity opener locks and resolves/supersedes older nonterminal roots (increment generation, clear token), but creates no new row yet. A retry worker instead locks the exact claimed root after session and validates state/token/generation/live lease. Both paths now hold the required root order.
3. Compute free slots through the shared occupancy helper `getSessionOccupancy()` (DD-133 (a); its live-holds component is the unexpired channel booking intents in `awaiting_payment` once a hold table exists). Waitlisted rows and account-link-only intents do not occupy. Exclude a candidate with a live promotion hold from the selector so one sweep cannot offer twice. `slots_max IS NULL` means unbounded fill for **non-public** sessions only. Current DB `0024` makes public+NULL unrepresentable; invalid compatibility rows fail closed with zero candidate/finance mutation.
4. Only now select candidates `status='waitlisted' ORDER BY waitlist_position, joined_at, id FOR UPDATE`.
5. Re-check `evaluateSessionEligibility()` DD-41, DD-42 reliability restriction và shared `evaluateJoinRestriction()` DD-52 rồi resolve financial disposition. First-activation phải không có charge và gọi `deriveChargeAmount`; DD-49 rejoin phải re-derive live aggregate. Missing/malformed disposition → stay waitlisted, audit+owner-review, continue next.
6. Retry-job history is UNIQUE `(tenant_id,session_id,origin_command_id)` and a partial UNIQUE `(tenant_id,session_id) WHERE state IN ('due','claimed')` permits one nonterminal root/session. The synchronous opener lazy-creates its stable root only on first DD-39 failure while session remains locked. Each failure writes one candidate event keyed `(session_id,player_id,waitlist_entry_version,origin_command_id,reason_code)` referencing that root; siblings/duplicates never create another job. At opener end, capacity full/no retryable failure→`resolved`; only open capacity+remaining failure→`due`. Any join/approve/promotion/capacity path filling capacity, plus close/start/cancel, resolves all nonterminal roots. Owner alerts remain durable.
7. Root job has `state=due|claimed|resolved|terminal`, `sweep_attempt_count`, monotonic `claim_generation`, opaque `claim_token`, `next_attempt_at`, `lease_owner`, `lease_expires_at`, `last_reason_code`. Worker CAS-claim is a **separate short job-only transaction** that atomically increments claimed-attempt count/generation (max 3), mints token, commits and releases the job lock before domain work. This counter bounds claims, not guaranteed completed sweeps.
8. Worker domain transaction follows universal lock order **session→root job→candidate/finance**. After locking session then job, require `state='claimed'`, exact token/generation and `lease_expires_at > now()` before selector/every domain mutation. Re-enter current queue head; one completed sweep visits each candidate at most once and re-checks session open/joinable, `starts_at > now()`, capacity, current entry version, DD-41, DD-42, shared DD-52 and live financial state. Deprioritize/manual ban cannot be bypassed. A different candidate failure only ensures sibling event on the same job. Closed/started/full/no-candidate resolves; remaining DD-39 failure after completed attempt 1–2→`due(backoff)`, completed attempt 3→`terminal`/DLQ.
9. Before any final root-job transition, re-check exact token/generation + live lease while job remains locked; stale claimant aborts zero domain/job mutation. Every promotion + job transition commits in one transaction. Crash before commit rolls back and lease expiry permits fenced reclaim while count `<3`; crash after commit observes `resolved|due|terminal`. For expired `claimed` with count `>=3`, maintenance finalizer locks `session→job`, rechecks exact expired claim + live applicability, clears token/lease, then resolves if retry no longer applies or marks terminal+owner-review/DLQ otherwise. It performs no candidate derivation/domain mutation and never opens attempt 4. First-activation success creates exactly one charge; DD-49 rejoin carries or appends refunded lifecycle, then activates; no duplicate charge row. Clear position + notify/outbox atomically.
10. For a paid+unlinked candidate, do not activate/create charge: create one 15-minute intent/hold under the same session lock, leave player waitlisted (venue hidden only when `sessions.hide_exact_address` is ON, DD-139), then continue only if more admission slots remain. Verified settlement re-enters the funnel finalizer; expiry releases the hold, assigns a new tail position once and opens/continues canonical promotion. Free or qualified Account-linked candidates follow the existing activation path.
11. Stop when full/no candidate. Retry is a bounded continuation, not a new capacity trigger; one root budget + current-order selection + stable entry/origin/event keys prevent N×N attempt multiplication, reorder bypass, stale-rejoin promotion, double-promote, double-hold and double-charge.

`promotion_retry_jobs` + candidate events are tenant-private with same-tenant refs, `ENABLE+FORCE RLS`, and no broad `app`/`readonly` scan. Cross-tenant scheduling uses only a narrow audited worker claim function/role, then re-enters exact tenant context before the `session→job→candidate/finance` domain transaction. Candidate audit events may be per entry/reason; user-facing owner alert/digest is unique per `promotion_retry_id` and aggregates server-side counts/reason classes without PII/amount/venue. Terminal review is a separate root-state alert.

Queue entry assigns `max(waitlist_position)+1` under the same session lock. DD-42 deprioritize moves a candidate to the tail with the same rule; positions need not be contiguous. The selector remains `ORDER BY waitlist_position, joined_at, id` as compatibility/defense for legacy/bypass data and stable ordering; it is not a promise that equal waitlisted positions remain representable after DD-45a. Because deprioritize does not change `waitlist_entry_version`, retry safety comes from re-entering this current-order selector, never from trusting event-bound rank.

> **DD-45a final (owner 2026-07-28; current runtime unchanged):** live `0014` still has no uniqueness constraint and the current permissive duplicate fixture remains until a future promotion slice lands. That slice must add partial `UNIQUE (session_id, waitlist_position) WHERE status='waitlisted'` in a new monotonic migration only after a duplicate preflight passes. Any duplicate means **HALT/manual remediation**; migration code must not auto-renumber. Gaps stay valid. Replace the permissive duplicate-position fixture with a duplicate-rejection test when the constraint lands; retain three-key selector coverage only as compatibility/defense, not as an equal-position tie test.

### Recurrence Implementation

- Store local wall-clock rule + IANA timezone.
- Calculate UTC occurrences with tested timezone library.
- DST ambiguity policy documented (prefer earlier).
- Generate within bounded horizon (configurable).
- Edit rule → create new version; past/generated occurrences NOT silently rewritten.

### Caching Strategy

| Data | Cache? | TTL | Invalidation |
|------|--------|-----|-------------|
| Capacity/roster/charge disposition trong join/promotion | ❌ | — | Đọc under session lock (edge #1/#14, §4) — fail-closed, không quyết định từ cache |
| Session detail/list (tenant-scoped) | ❌ | — | Optimistic `version` + projectors re-render theo outbox; mutation luôn đọc canonical |
| Public discovery projection | Thuộc `feature_marketplace_discovery_tech.md` | — | — |

### Security Checklist (template v2.33 — map về section đã pin)

| Mục | Trả lời trong spec |
|-----|---------------------|
| Authorization/ownership | §3: TenantAdmin per endpoint; AuthZ middleware reject trước service (edge #10); Messenger wizard final consume re-authorize `session.manage` + target tenant (§1, §3 create path, edge #20); RLS ENABLE+FORCE trên `sessions` (§2) + tenant isolation test #18 |
| Injection/validation | §2: CHECK constraints (time range, slots, status/visibility/join_policy enums); §3 validation errors (`INVALID_TIME_RANGE`, `MISSING_DISCOVERY_FIELDS`); tenant/actor từ trusted context, không từ payload (§1) |
| Secret & log redaction | N/A — feature không chạm secret; outbox chỉ mang identifiers + safe changed fields, projectors reload canonical cho sensitive rendering (§1) |
| Webhook signature + replay | N/A — không có webhook ingest trong doc này; Messenger wizard anti-replay/stale/expired denied ở interceptor + final re-check (§3 create path, edge #20, test #36/#37) |
| Idempotency | §3 bảng Idempotency (`commandId`, close/cancel no-op) + command dedup table (edge #3) |
| Data retention/xoá | Chưa pin trong doc này — theo `feature_security_operations_tech.md` |

---

## 5. Testing Plan

### Unit Tests

| # | Test | Input | Expected |
|---|------|-------|----------|
| 1 | Create session valid | All required fields | Session created, event emitted |
| 2 | Create session invalid time | `ends_at <= starts_at` | `INVALID_TIME_RANGE` error |
| 3 | Create session inactive sport | Non-existent sport_id | `SPORT_INACTIVE` error |
| 4 | Update with stale version | Wrong `version` | `STALE_VERSION` error |
| 5 | Reduce capacity below active roster | `slots_max < active_count` | `CAPACITY_BELOW_ROSTER` error |
| 6 | Price change no policy | Price change + existing charges | `PRICE_CHANGE_REQUIRES_POLICY` |
| 7 | Cancel with paid roster no review | Paid players exist (still ACTIVE) | `CANCEL_REQUIRES_REVIEW` — cổng #3 (active roster), giữ nguyên sau DD-131 OD-1 |
| 8 | Close already-closed | Status=closed | No-op, success |
| 9 | Public without discovery fields | Missing required fields | `MISSING_DISCOVERY_FIELDS` |
| 10 | Public → private removes projection | Visibility change | Event emitted correctly |
| 11 | Concurrent first-entry join last slot | 2 concurrent transactions | One active+exactly-one-charge; one `waitlisted` with positive position and no charge |
| 12 | Concurrent web/chat edit | Same session, different version | One success, one `STALE_VERSION` |
| 13 | Command dedup (same commandId) | Duplicate command | Return previous result |
| 14 | DST timezone boundary | Recurrence across DST | Correct UTC calculation |
| 15 | Recurrence idempotency | Generate twice | Same occurrences, no duplicates |
| 16 | Mutation on cancelled session | Any update | `SESSION_NOT_OPEN` |
| 17 | Non-admin create session | Player actor | 403 |
| 18 | Tenant isolation | Session from tenant A | Not visible to tenant B |
| 19 | Public serializer whitelist | Public endpoint | No venue/roster/financial data |
| 20 | Announcement retry | First attempt fails | Retry succeeds, no duplicate message |
| 21 | First-entry join full | Session full | `waitlisted`, position dương, no charge/capacity; venue hidden only when `sessions.hide_exact_address` is ON (DD-139) |
| 22 | Leave opens slot | One eligible first-activation candidate | Promote + clear position + one charge atomically |
| 23 | Capacity tăng lên 12, active=7, live holds=1 | Sáu eligible candidates | Fill exactly 4 admission slots in total order (`12-7-1`; the live-hold term is future-state, 0 until a hold table exists, DD-132/DD-135) |
| 24 | Capacity finite→NULL (non-public session) | Eligible + banned candidates | Promote all eligible; banned stay waitlisted |
| 24a | Public + unlimited rejected at both layers | API create, private-unlimited→public hoặc public finite→NULL; direct SQL control | SessionService returns `MISSING_DISCOVERY_FIELDS` with zero domain mutation; direct DB INSERT/UPDATE is rejected by `sessions_public_capacity_chk`. Private+NULL control succeeds |
| 24b | Public+NULL compatibility row (consume-time) | Pre-`0024`/fixture/constraint-bypass row enters every branch (first-entry, left-rejoin, approval, capacity opener/promotion sweep) | Không treat as unbounded: entry reject fail-closed; promotion resolves roots with zero candidate/finance mutation; audit + owner-review; test fixture must state CHECK bypass explicitly |
| 25 | `UpdateSession` hiện tại: capacity below active/occupancy | active=1, guest notes=2, new cap=1 hoặc 2. Active-first control: active=2, guest notes=2, new cap=1 | Fixture đầu → `CAPACITY_BELOW_OCCUPANCY`; control → `CAPACITY_BELOW_ROSTER`; zero mutation, không xoá note. New cap bằng active + guest notes được phép. Pending/hold cases chưa build, không được chứng minh bởi fixture hiện tại |
| 25a | Paid-unlinked promotion hold | Candidate reaches head with one available slot | One 15-minute hold, candidate remains waitlisted/no charge (venue hidden only when `sessions.hide_exact_address` is ON, DD-139); selector excludes live hold |
| 25b | Promotion hold expires | No verified payment/link before TTL | Release slot + requeue-tail exactly once + continue selector; duplicate expiry no-op |
| 26 | Candidate ineligible | First in queue fails DD-41 | Skip first, promote next, first keeps position |
| 27 | Promotion retry | Same commandId twice | Same result; no double charge/promotion |
| 28 | Rejoin after left, paid not refunded | Existing player `left` + paid obligation, no refund reversal | Re-activate/waitlist theo capacity; carry-over same obligation/allocation; no duplicate financial row |
| 29 | Rejoin after full refund | Existing player `left` + completed refund | Capacity available→append one lifecycle + active; full→waitlisted with no new lifecycle/venue; no duplicate charge row |
| 30 | Rejoin financial disposition unknown | Partial/ambiguous/unimplemented correction state | `REJOIN_REQUIRES_REVIEW`; player/charge/allocations byte-for-byte unchanged |
| 31 | Promotion rejoin disposition | Waitlisted DD-49 rejoin candidate | Re-derive; not-refunded carry-over or refunded append lifecycle; activate + clear position; no duplicate charge row |
| 31a | Promotion charge conflict | Missing/malformed live DD-49 disposition | Candidate not promoted; audit+owner-review; next may fill slot |
| 32 | Promotion amount derivation fails | First-activation candidate; KMS/decrypt throws | Candidate unchanged; one candidate audit event on lazy root; opener committed; next candidate may fill; no fallback |
| 33 | Derivation retry after slot filled | Same `promotion_retry_id`; capacity full | Resolve root job no-op; no promotion/charge; candidates keep rank |
| 33a | Persistent derivation failure | Same root job completes claimed attempts 1..3 | Backoff + durable claimed-attempt count; sibling events do not fork jobs/root digest; completed attempt 3 terminal owner-review/DLQ |
| 33b | Retry succeeds | Sweep ≤3, capacity remains | Canonical selector promotes in order; root job resolves when no failure remains/capacity fills; event redelivery no-op |
| 33c | Stale candidate event | Player leaves then re-enters waitlist with incremented `waitlist_entry_version`; old event redelivered | Event is alert-dedupe only and cannot drive promotion or resolve the root job. Current sweep reads the new row/version through selector; no mutation derives from stale event payload |
| 33d | Candidate no longer applicable | During root sweep, one candidate is left/active, DD-41 ineligible, DD-42 restricted or DD-52 manually banned | Skip that row with exact reason and continue current selector; no charge/venue. Root job transition derives from the whole sweep, not from one candidate event |
| 33e | Concurrent retry claim | Two workers claim one due/expired `promotion_retry_id` | Exactly one CAS winner and one sweep increment; loser does no domain work |
| 33f | Worker crash before domain commit | Claimed root-job lease expires before attempt 1 or 2 domain commit | Reclaim safely while count `<3`; claimed-attempt count never exceeds 3; no promotion/charge before successful commit |
| 33g | Worker crash after success | Promotion + root-job transition committed | Redelivery/reclaim observes persisted state; no second charge/promotion |
| 33h | Reorder after failure | Candidate A event, then DD-42 deprioritize moves A behind B before retry | Root sweep re-enters current selector; A cannot bypass B; no out-of-order charge/promotion |
| 33i | Manual ban after failure | DD-52 ban imposed after event, before retry | Shared `evaluateJoinRestriction()` skips candidate; no active/charge/venue |
| 33j | Two candidates fail in one opener | A and B each have a unique failure event referencing one `promotion_retry_id`; two workers/redeliveries | One CAS sweep job, one shared counter ≤3; each candidate derived at most once per sweep; events/commands cannot multiply attempts N×N |
| 33k | Failure then final slot fills | A derivation fails, later B succeeds and fills last capacity in same opener | A alert event stays durable, but root job commits `resolved` and no worker may claim it; next genuine opener uses a new root origin/job if A fails again |
| 33l | Stale claimant resumes | Worker A lease expires; B reclaims with next generation/token; A resumes | A fails token/lease fence and makes zero selector/domain/job changes; only B may sweep/transition; total sweep count ≤3 |
| 33m | Opener/worker lock order | Worker claimed job while a new capacity opener starts | CAS claim commits job-only; both domain paths lock session→job→candidate/finance; no deadlock, and superseded token cannot mutate |
| 33n | Old root across capacity epochs | J1 due; direct active join fills slot; later leave creates opener J2 | Fill resolves J1 under session lock; J2 supersedes any older nonterminal root before own job. J1 claimant/event cannot sweep new opening; partial unique holds |
| 33o | Three pre-domain crashes exhaust claims | Attempts 1..3 claim then expire before domain commit | Finalizer locks session→job and rechecks exact expired claim; no longer applicable→resolved, otherwise terminal+owner-review/DLQ. No stuck `claimed`, derivation, mutation or attempt 4 |
| 33p | Initial opener after start | Session already started/past; leave/capacity edit would expose slot | No candidate lock/promotion/charge. Under session→job, resolve every nonterminal root as no longer applicable |
| 33q | Cancel/price-capacity update vs claimed worker | Paid roster + claimed root; concurrent cancel or update | Both use session→root→roster/finance; no deadlock. Review-required abort leaves root unchanged; successful close/cancel/full-capacity outcome resolves it |
| 33r | DD-45a migration duplicate fence | Future migration preflight sees duplicate `(session_id, waitlist_position)` among `status='waitlisted'`; clean dataset then attempts duplicate insert | Dirty preflight HALTs for manual repair with zero auto-renumber; clean migration adds the partial unique constraint and duplicate insert rejects. Gaps remain valid; selector still uses `position,joined_at,id` only as compatibility/defense |
| 34 | Direct active join amount derivation fails | Capacity available; KMS/decrypt throws | Join aborts; no player/charge/venue; no fallback; retry safe |
| 35 | Messenger host create parity | Same validated input via central, tenant Page and web | Same command/service result and canonical session shape |
| 36 | Messenger wizard lifecycle | cancel/expire/context-switch/wrong actor/Page/stale snapshot | Deny/clear; zero sessions created |
| 37 | Messenger duplicate confirm | Same opaque action/webhook/commandId replay | Exactly one session/outbox sequence; previous result returned |
| 38 | Negative base price | Create/update `price_amount < 0` through API or direct migration fixture | DB CHECK rejects; no session/outbox mutation |
| 39 | Live skill-level upgrade | Upgrade fixture with non-null `sessions.skill_level` | Value preserved and public projection/filter remains valid until DD-41 ranked-field contract completes |
| 40 | Publish draft→open | `draft` session, `starts_at > now()`, Host | `status='open'`, `version` bumped, exactly one `session.published` outbox event; `visibility` unchanged (status-only) |
| 41 | Re-publish already-open (idempotent) | Session đã `open`; `commandId` replay hoặc new `commandId` | No-op success; no duplicate `session.published`; `status`/`version`/`visibility` unchanged |
| 42 | Publish public without discovery fields | `visibility='public'` `draft` thiếu area / `slots_max` NULL / sport / starts_at | `MISSING_DISCOVERY_FIELDS`; zero mutation; no event |
| 43 | Publish closed/cancelled/past | Session `closed`/`cancelled`, hoặc `draft` với `starts_at <= now()` | `SESSION_NOT_OPEN`; zero mutation; no event |
| 44 | Non-admin publish | Player actor calls publish | 403 — AuthZ rejects before service; zero mutation |
| 45 | Publish `draft` with stale expectedVersion | `draft` session; `expectedVersion` != live `version` (concurrent edit bumped it) | `STALE_VERSION` (409) on the mutation path; zero mutation; no event |
| 46 | Publish while tenant `suspended` (non-billing: admin / abuse — DD-142) | Host publish; billing resolves tenant `suspended` (per billing matrix) | Fail-closed `TENANT_SUSPENDED` (403); `status` stays `draft`; zero mutation; no `session.published`. Status-authority per `feature_billing_lifecycle_tech.md` §3 (resolved). Static case only — competing-writer race is billing test #36, the acceptance criterion for step 6's re-check-under-lock |
| 47 | Re-publish already-open with stale expectedVersion | Session `open`; new `commandId` + `expectedVersion` < live `version` | No-op success (idempotency precedence over `STALE_VERSION`); zero mutation; no event |
| 48 | Publish `commandId` collision | Same `commandId` reused for a different resource/payload | Handled by the canonical `processed_commands` command-dedup (edge #3) — publish inherits it, does not special-case; collision-safety strengthens to `IDEMPOTENCY_CONFLICT` when the canonical `request_hash` migration lands (Session Organize plan) |
| 49 | Discard draft happy path | Host cancels a `draft` session | `status='cancelled'`, `version` bumped, exactly one `session.cancelled` event (`cancel_reason='manual'`); roster/paid preview empty |
| 50 | Discard draft non-admin | Player actor calls cancel on a `draft` session | 403 — AuthZ rejects before service; zero mutation |
| 51 | Discard with mismatched expectedVersion after concurrent publish | Draft published concurrently (`status` now `open`, `version` bumped); discard client still holds the old `expectedVersion` | `STALE_VERSION` (409); zero mutation — session not silently cancelled |
| 52 | Discard closed session | Host attempts cancel on `status='closed'` | `SESSION_NOT_OPEN`; zero mutation |
| 53 | Discard already-cancelled (idempotent) | Session already `cancelled` (from either a `draft` or `open` origin) | No-op success; no duplicate `session.cancelled`; not required to match `expectedVersion` |
| 54 | Auto-expiry cancels past draft | `draft` session, `starts_at <= now()`, job runs | `status='cancelled'`, `cancel_reason='auto'`, exactly one outbox event |
| 55 | Auto-expiry leaves open/future-draft untouched | Mix: `open` session past `starts_at`, `draft` session with future `starts_at` | Neither transitions; only the past, unpublished draft is claimed |
| 56 | Auto-expiry concurrent runs | Two overlapping scheduled runs target the same due draft simultaneously | Exactly one run's `FOR UPDATE SKIP LOCKED` claims it; the other skips it (no wait, no error); exactly one `session.cancelled` event |
| 57 | Auto-expiry vs concurrent publish race | Job and `PublishSession` race the same draft under a deterministic lock-order harness (mirrors billing test #36/#36a's job-first / publish-first split) | Whichever acquires the row lock first wins deterministically: job-first → publish observes `cancelled` and rejects `SESSION_NOT_OPEN`; publish-first → job's `FOR UPDATE SKIP LOCKED` claim skips the already-locked row this run, no re-match next run (status is now `open`). Neither ordering double-transitions |
| 58 | Discard with omitted expectedVersion after concurrent publish | Draft published concurrently; discard request sends no `expectedVersion` at all | `STALE_VERSION` (409) — missing is treated the same as mismatched on the mutate branch; zero mutation, not a silent cancel of the now-open session |
| 59 | Discard draft with anomalous roster/charge (data anomaly) | `draft` session with a `players` or `charges` row present (fixture bypassing the normal join-requires-open path) | Fail-closed: `CANCEL_REQUIRES_REVIEW` (`400`) — same code and review surface edge #5 uses for `open` with a paid roster, not a bespoke draft code; does not silently cancel; `session.expiry_anomaly_detected` outbox event written (edge #28) |
| 60 | Auto-expiry skips anomalous draft, writes `session.expiry_anomaly_detected` every detection | Past `draft` session with a `players` or `charges` row present (fixture bypass); job runs twice across two scheduled ticks | Both runs leave the row `draft` (zero mutation, zero `session.cancelled` event) and re-claim it (cheap, expected — not a bug); each run writes its own `session.expiry_anomaly_detected` outbox event through the same canonical outbox mechanism `session.cancelled` uses (append-only, no dedupe at this layer, mirrors `waitlist.charge_derivation_failed`'s per-occurrence shape). No HTTP response to return here (background job, no caller) — the host-facing `CANCEL_REQUIRES_REVIEW` code only applies to the discard request path (test #59). Owner-facing alert de-duplication (at-most-one notification across the two runs) is a separate consumer whose storage is a build-slice detail — not asserted by this test, which only covers what this slice actually specifies |
| 61 | Cancel `open` session past `starts_at` still rejected | `open` session, `starts_at<=now()`, host calls cancel (no anomaly, no paid roster — simplest case) | `SESSION_NOT_OPEN` (`409`); zero mutation. Confirms discard's no-past-guard did NOT leak into the pre-existing `open`-source past-session-mutation restriction (edge #11/#31) — `open`→`cancelled` behavior is provably unchanged, not just claimed |
| 70 | Invite friend happy path (open join_policy) | Player active, friend follows player, session open + capacity | Friend joins as `active`; `player.invited` event; `invited_by_person_id` set |
| 71 | Invite friend with approval policy | `join_policy='approval'` session; friend follows player | Friend joins as `pending`; chiếm slot; host notification sent |
| 72 | Invite friend not following | Friend has no `person_follows` row with player | `FOLLOW_REQUIRED` (400); zero mutation |
| 73 | Invite friend blocked (DD-55) | `person_blocks` exists between inviter/invitee | `MEMBER_BLOCKED` (403); block checked before follow; zero mutation |
| 74 | Invite when `allow_player_invite=false` | Session has `allow_player_invite=false` | `INVITE_NOT_ALLOWED` (403); zero mutation |
| 75 | Invite by non-active player | Inviter is `waitlisted`/`left`/`pending` | `PLAYER_NOT_ACTIVE` (403); zero mutation |
| 76 | Invite already-joined player | Friend already `active`/`waitlisted`/`pending` in session | `ALREADY_JOINED` (409); zero mutation |
| 77 | Invite when session full | Occupancy = slots_max | `SESSION_FULL` (409); zero mutation |
| 78 | Create guest note happy path | Player active, < 3 notes, capacity available | Note created; slot occupied; `guest_note.created` event; `remainingNotes` returned |
| 79 | Guest note limit reached (4th note) | Player already has 3 notes in session | `GUEST_NOTE_LIMIT_REACHED` (400); zero mutation; DB trigger also rejects |
| 80 | Delete guest note releases slot (sửa 2026-09-12: promotion KHÔNG build, xem §4) | Note creator deletes | Note deleted; slot freed + occupancy recompute; `guest_note.deleted` event; **KHÔNG** candidate promotion (waitlist engine chưa tồn tại, D2) — test thật GN22 chỉ phủ nửa buildable (slot freed → session nhận note mới) |
| 81 | Delete guest note not creator | Different player tries to delete | `NOT_NOTE_CREATOR` (403); zero mutation |
| 82 | Approve pending invite happy path | Host approves `pending` player | Player `status='active'`; `player.invite_approved` event |
| 83 | Reject pending invite releases slot | Host rejects `pending` player | Player row removed; slot freed; waitlist auto-promote if applicable; `player.invite_rejected` event |
| 84 | Capacity DECREASE with existing charges + allocation, staying at/above current occupancy (edge #4b) | `slots_max: 10 → 6`, `active_count = 6`, guest notes=0 (`sessionOccupancy` hiện tại=6, exactly at the new floor), one active player has an existing `charges` row AND a linked `payment_allocations` row | Succeeds; no `impact_policy` required; no `PRICE_CHANGE_REQUIRES_POLICY`; snapshot `charges`/`payment_allocations` before and after — both byte-for-byte identical (write-set is `sessions`/`outbox_events`/`processed_commands` only). A capacity INCREASE with the same charge/allocation fixture is a separate, easier case already covered by passing both current capacity guards — this row exists specifically for the decrease-at-the-boundary branch DD-112 rules on |
| 85 | Close session happy path / already-closed idempotent (edge #47) | Host closes `open` session no charges; then replay on already-`closed` | First: `status='closed'`, `version` bumped, one `session.closed` event. Replay: no-op success, no duplicate event, `expectedVersion` not required to match |
| 86 | Close non-open source | Session `draft` hoặc `cancelled` | `SESSION_NOT_OPEN` (edge #47); zero mutation |
| 87 | Close with charges, no active-roster check (edge #48, DD-131 OD-1) | `open` session whose only charges are `void` (removed unpaid players), or a fully paid ACTIVE roster | `closed` — `void` = dư nợ 0 and close has no roster gate; an unpaid/partial charge → `CLOSE_BLOCKED_OPEN_DEBT` instead (#93) — contrast test #7 (cancel keeps gate #3) |
| 88 | Close with stale/missing expectedVersion | `open` session; `expectedVersion` != live `version`, or omitted | `STALE_VERSION` (409, edge #49); zero mutation |
| 89 | Auto-close closes past-`ends_at`+grace session (edge #50 — **OWNER-CHECK, chưa build**) | `open` session, `ends_at`+grace `<= now()`, job runs | `status='closed'`, `close_reason='auto'` (mirror `cancel_reason='auto'` pattern), exactly one `session.closed` event — mirror test #54 (auto-expiry). Grace duration TBD |
| 90 | Auto-close concurrent runs + race vs manual close (edges #51/#52 — **OWNER-CHECK, chưa build**) | Two overlapping scheduled runs target the same due session; separately, job races `CloseSession`/`UpdateSession` under deterministic lock-order harness | Exactly one run's `FOR UPDATE SKIP LOCKED` claims it (mirror test #56); whichever acquires row lock first wins deterministically, no double-transition (mirror test #57) |
| 91 | Recurrence edit this-and-future (DD-121, SES-OQ-2) | Host edits a recurrence rule from occurrence N onward | New rule version created applying từ occurrence N trở đi; occurrences trước N và đã-generate trước đó KHÔNG bị rewrite; no schema change |
| 92 | Timezone validation rejects unconstructible string (SES-OQ-10, sửa 2026-09-11) | Create/update session với `timezone` mà `Intl.DateTimeFormat('en-US', { timeZone })` KHÔNG dựng được (ném `RangeError`) — KHÔNG áp dụng cho IANA link/alias hợp lệ như `US/Eastern`/`Asia/Saigon`, các chuỗi này PASS (xem `decisions.md` changelog 2026-09-11, v2.50) | `INVALID_TIMEZONE` (400); zero mutation |
| 93 | Close with open balance (DD-131 OD-1, edge #48) | Unpaid + partly paid players beside a fully paid and a removed one | `CLOSE_BLOCKED_OPEN_DEBT` (409); `openBalancePlayers` = only the unpaid/partial players, roster order, keys exactly `playerId`+`displayName`; zero mutation, no `processed_commands` row; the name never appears in the error's message/`util.inspect`/JSON |
| 94 | Close when nothing is owed | Fully paid active roster + removed unpaid player (`void`); a free price-0 session; a `void`-only session | `closed`, one `session.closed`; no roster gate |
| 95 | Cancel over a removed unpaid player's `void` charge (edge #54) | Active roster 0, one `void` charge, one `waitlisted` player | `cancelled`; `has_paid=false`, `roster_count=0`; charge stays `void` |
| 96 | Cancel fail-closed on money / anomaly (fixture) | Net allocated > 0 on a `void` charge; an `open`/`paid` charge on a `left` player | `CANCEL_REQUIRES_REVIEW`; once fully reversed (net 0) the first case cancels |
| 97 | Reversal then cancel (A6/A7) | Paid active player | remove `REMOVE_REQUIRES_REVIEW` → cancel `CANCEL_REQUIRES_REVIEW` → reverse → remove → `cancelled`; reversal/mark-paid on the cancelled session → `SESSION_NOT_OPEN`, zero writes |
| 98 | Retry of a refused close after paying (edge #56) | Same `commandId` | refused (not recorded) → after payment `closed` → replay `replayed=true`, zero writes |
| 99 | Billing posture × money guard | Subscription `suspended`; tenant `cancelled` | suspended: guard still refuses open debt, a settled session closes; cancelled tenant → `TENANT_SUSPENDED`, no list |
| 100 | Route envelope for the new code | `mapSessionCommandError` + close/cancel routes | 409 + `details` ONLY for `CLOSE_BLOCKED_OPEN_DEBT`; every other error exactly `{code,message,statusCode}`; allowlist re-projection; missing/empty list → null (500, fail closed); vi/en message; 403 caller never reaches the command |

### Integration Tests

| # | Test | Setup | Expected |
|---|------|-------|----------|
| 1 | Full CRUD lifecycle | Create → update → close | State transitions correct |
| 2 | Chat + web same service | Zalo/Messenger create → web edit | Same session, consistent state |
| 3 | Recurrence generation | Create rule → generate | Occurrences match timezone |
| 4 | Outbox → projector delivery | Create session → check projector | Event delivered, projection updated |
| 5 | Concurrent leave + join last slot | Two transactions | Lock order preserves capacity; one canonical outcome, no double charge |
| 6 | Leave + first-activation candidate KMS failure | One leave, two candidates | Leave commits; first unchanged + one audit/origin event; second may promote; bounded retries happen separately |
| 7 | Hybrid Page host matrix | central + tenant Page; host/player/dual-role across two tenants | Authorized host creates correct tenant session; non-admin and wrong context denied |
| 8 | Auto-expiry job + host discard both present | Multiple past unpublished drafts across tenants; one also manually discarded by host just before the job runs | Job claim filter (`status='draft'`) no longer matches the manually-discarded one — no double event; remaining past drafts cancel with `cancel_reason='auto'`; tenant isolation holds (RLS) |
| 10 | Invite friend + approval flow | Player joins session → invites friend (approval policy) → friend becomes `pending` → host approves → friend becomes `active`; host rejects second invite → player row removed + slot freed | Full lifecycle: invite → pending → approve/reject with capacity accounting |
| 11 | Guest note occupancy + waitlist interaction (target, CHƯA BUILD) | Session 4/5 capacity → player creates 1 guest note (5/5) → new join waitlisted → player deletes note → waitlisted promoted to active | Target sau khi reconciliation occupancy và waitlist/promotion engine hoàn tất: guest notes participate in shared occupancy; deleting note then triggers promotion. Runtime hiện tại chỉ release slot + occupancy recompute/event (§4 DeleteGuestNote), không promote |
| 12 | Close/cancel vs roster & money writers (edge #53) | Two connections + barrier: a holder locks the session row; add-player / mark-paid / remove queued before or after close/cancel | Serialized on `sessions FOR UPDATE`; no closed/cancelled session gains a charge or money; outcomes per A3–A5 (`session-close-cancel-money-policy.test.ts` CC-1..CC-5) |
| 13 | Close route, real DB + real `authorize()` | owner/admin/co_admin vs player / other tenant's owner; `vi`/`en` tenant | 409 + list for `session.manage` holders; 403 with no list otherwise; after payment the same route answers 200 (`close/route-db.test.ts`) |

### Verify

| Layer | Command | Runs where |
|-------|---------|-----------|
| `@plexco/db` sandbox verify | `pnpm --filter @plexco/db run typecheck` | Writer sandbox |
| `@plexco/db` test (cần DB) | `pnpm --filter @plexco/db exec vitest run src/session-service.test.ts` (hoặc file test của slice) | `verify_host` — dispatcher chạy sau Codex CLEAN, cần `DATABASE_URL_TEST` |
| `@plexco/web` sandbox verify | `pnpm --filter @plexco/web run typecheck` | Writer sandbox |
| `@plexco/web` route test | `pnpm --filter @plexco/web exec vitest run app/api/sessions` | Writer sandbox — route test mock DB, KHÔNG cần `DATABASE_URL_TEST` |
| Full suite + build (gate cuối) | `pnpm -w typecheck` → `pnpm -w format:check` → `pnpm -w review:check` → `pnpm -w lint` → `pnpm -w build` → `pnpm -w test` (cần Postgres) | CI (`.github/workflows/ci.yml`) — cổng cuối trước merge |

Slice nào chạm `session-service.ts` hoặc route test thật (khác typecheck) thuộc class `needs_db` — phải khai `verify_host` trong manifest, không chỉ verify sandbox.

---

## 6. Rollout Plan + Changelog

### Rollout

1. Migrate session fields/backfill timezone
2. ✅ **Done 2026-07-19 trên nhánh `feat/session-waitlist-expand` (tính đến `origin/main`@`22c23aa` ngày đó, main còn dừng ở `0013`); đã merge vào `main` (`1a6ac38`; xem tail hiện hành tại `packages/db/migrations/`, không hard-pin số)** — `0014_players_waitlist`: status domain opened to `waitlisted`, `waitlist_position`, state-shape + positive CHECKs, `idx_players_waitlist_order`. Code stays dark. Covered by 21 DDL invariant tests in `packages/db/src/waitlist-invariants.test.ts`, including app-role grant/RLS on the new column. **Not** online-safe (validated CHECKs + non-concurrent index in one runner transaction) — fine on today's empty `players`, must be split per file if ever re-run against a populated table.
3. ✅ **Done in DB:** `0019_tenant_integrity_fks` lands DD-68 same-tenant composite keys/FKs; `0024_public_visibility_capacity_check` lands + validates `sessions_public_capacity_chk`. Schema/invariant tests only — service/routes/projectors remain dark.
4. Enable atomic waitlist entry/promotion + charge/notify path — **blocked**: first-activation promotion needs `deriveChargeAmount` (DD-39), `evaluateSessionEligibility` (DD-41), DD-42 restriction source and shared `evaluateJoinRestriction()` (DD-52); rejoin promotion needs DD-49 correction. DD-32 additionally requires `channel_booking_intents`, a reconciled booking/promotion occupancy contract (see `session-publish-public-projector` in `../../autopilot-backlog.md`), account predicate, verified-payment finalizer and expiry/requeue integration. Retry needs entry-version/root/CAS worker/DLQ. Current `sessionOccupancy` exists for SessionService and counts active + guest notes; that implementation does not clear the future occupancy conflict or the other unbuilt dependencies, nên không wire một nhánh partial.
5. Enable chat CRUD
6. Recurrence shadow generation
7. Web API parity
8. Projector parity (Zalo/Messenger/public/web): public carries `slots_open` only, from `getSessionOccupancy()` (DD-133 (a)); `confirmed_count` (active players) stays tenant-private and is never public; no public hold count/identity

### Metrics

- Command latency/conflict rate
- Occurrence generation lag
- Projection lag/failure rate
- Capacity conflicts per session; active/hold occupancy and hold expiry/requeue
- Waitlist depth / promotion latency / promotion skip reason
- Cancel-with-payment count

### Changelog

| Date | Version | Thay đổi |
|---|---|---|
| 2026-10-26 | v2.38 | **Sync DD-142, DD-139 (quyết định owner 2026-10-21) và DD-138 L4b A-D4 (owner ký 2026-10-21); docs-only.** DD-142 (:259, :323, :670, :672, :1005): tenant `suspended` chỉ còn cho admin / abuse, billing không suspend (hạ xuống Free). DD-139 (:10, :491, :893, :957, :964): venue public theo mặc định, chỉ ẩn khi `sessions.hide_exact_address` ON. A-D4 (:342): MVP chỉ nhận channel `zalo`, mọi giá trị khác trả `INVALID_CHANNEL`. |
| 2026-10-16 | v2.37 | **Sync DD-133 (D1, owner ký 2026-10-16); docs-only.** Mọi công thức occupancy (header, edge #14/#15/#16/#39, bước capacity ở join/invite, promotion bước 1/3, projector parity) → con trỏ tới `getSessionOccupancy()`; `confirmed_count` tenant-private, public chỉ `slots_open`. GIỮ nguyên: live-state facts ở header (helper hiện tại đếm active + guest notes; pending/hold chưa build) và luật pending-occupancy. Vòng review 1: live holds ghi rõ = 0 tới khi có bảng hold; ví dụ test #23 gắn nhãn future-state. Các dòng lịch sử giữ nguyên. |
| 2026-10-15 | v2.36 | **Làm rõ đơn vị của giới hạn `venueAddress` (fix PR #57 vòng 1; docs-only, không đổi code):** v2.35 ghi "200 ký tự" nhưng code (`packages/db/src/session-service.ts`, `VENUE_ADDRESS_MAX`) đếm **UTF-16 code unit** (`value.length`) — cùng đơn vị với HTML `maxLength` của form web. Doc nay nêu đúng đơn vị: không normalize nào được áp (không NFC/NFD), chuỗi NFD tốn nhiều đơn vị hơn NFC, ký tự ngoài BMP tốn 2 đơn vị. Code giữ nguyên; hành vi và lỗi `INVALID_TEXT_FIELD` không đổi. Dòng changelog v2.35 giữ nguyên verbatim. |
| 2026-10-15 | v2.35 | **DD-128 OD-4a — `venueAddress` nối end-to-end trên create:** `createSession` nhận `venueAddress` (optional, plain text ≤ 200 ký tự, `INVALID_TEXT_FIELD` cùng họ lỗi với `area`/`venueName`) và ghi vào `sessions.venue_address`; `updateSession` áp cùng luật 200 ký tự (trước đó chỉ kiểm string/NUL); route `shapeCreateFields` mang field; form tạo web hiện ô "Địa chỉ" (`maxLength` 200). Không đổi schema/migration (`venue_address` có từ `0002`). Outbox `session.created` giữ nguyên whitelist `session_id`/`tenant_id`/`visibility` (test pin không có venue). Đảo ngược quyết định "create bỏ qua venueAddress" của slice cũ (codex round-01/02) — replay-safety vẫn giữ vì dedup đứng trước validate. |
| 2026-10-15 | v2.34 | **PR #55 F3 — thu hẹp claim của test, không đổi behaviour/contract:** §4 "Luật", dòng *Dư nợ*: câu cũ "AG-1..AG-3 pin close ⇔ roster" nói quá — AG-1/AG-2 chỉ so giá trị trên state do writer tạo, nơi `status`/`amount_allocated` lưu luôn khớp ledger, nên một close guard suy ra từ `status` lưu hoặc một roster suy ra từ `amount_allocated` lưu vẫn xanh. Thêm AG-4 (`packages/db/src/session-close-cancel-money-policy.test.ts`): charge forged bằng owner connection có cột lưu lệch ledger (`paid` trên ledger rỗng; `open`/`partial` trên ledger đã trả đủ) — cả hai cách suy ra từ cột lưu đều làm AG-4 fail; câu ở §4 nay ghi đúng phần được pin. Row v2.32 giữ nguyên làm lịch sử; row này đính chính câu "AG-1..AG-3 pin close ⇔ roster" của nó. |
| 2026-10-15 | v2.33 | **PR #55 round-2 frontend review — doc text only, không đổi behaviour/contract:** (1) header: hai route đọc `GET /api/sessions` + `GET /api/sessions/[id]` đã có trên main (đo tại `d962b0c`), chỉ `GET /:id/guest-notes` còn "chưa có"; (2) §3 catalog `CANCEL_REQUIRES_REVIEW`: message căn theo cặp `t(vi, en)` thật của route ("Kèo này cần được xem xét trước khi huỷ." / "This session needs review before it can be cancelled.") thay cho câu cũ "Cần xác nhận huỷ — có người đã thanh toán". |
| 2026-10-15 | v2.32 | **PR #55 round-1 review — reconcile, không đổi behaviour/contract:** (1) §3 ví dụ cancel: thay câu cũ "nguồn `open` với paid roster (`starts_at` bất kỳ)" bằng luật DD-131 OD-1 — chỉ nguồn `open` tương lai (past → `SESSION_NOT_OPEN` theo edge #31 trước), refuse khi active roster ≠ 0 (cổng #3), tiền đã ghi nhận, hoặc charge sống không có active player. (2) Dư nợ nay là MỘT hàm `chargeRemaining` (`payment-manual.ts`) mà read model host (`remaining`), close guard và mark-paid cùng gọi — trước đó chỉ trùng giá trị (`chargeStatusFor` ≠ `paid` vs công thức inline); edge #48 + §4 "Luật" trỏ về hàm đó, test AG-1..AG-3 pin close ⇔ roster. (3) Header *Implementation*: roster/money writer + 4 route đã merge (đo tại `d962b0c`), bỏ khỏi danh sách "chưa có". |
| 2026-10-15 | v2.31 | **DD-131 OD-1 — close/cancel money policy (DD-131 / DD-132 (pending in PR #51)), runtime + contract:** close refuses an open balance with the NEW `CLOSE_BLOCKED_OPEN_DEBT` (409, `error.details.openBalancePlayers` = ids + display names) and never returns `CANCEL_REQUIRES_REVIEW` (reverses DD-117 D3's close half); cancel keeps owner gate #3 and replaces "any charge" with "recorded money (net allocated > 0)" — a removed unpaid player's `void` charge no longer blocks, a live charge with no active player stays fail-closed. Measured: every roster/money writer already locks the session row first, so no new lock. Edges #5/#47/#48 amended, #53–#57 added; §3 code row + close example; §4 "Close / Cancel money policy" (rule, lock order, decision tables, abuse cases); §5 #7/#87 amended, #93–#100 and integration #12–#13 added. No migration, no new table or column. |
| 2026-09-16 | v2.30 | Mirror the landed `UpdateSession` capacity guard (active roster first, then active + guest notes), its two route error messages and current regression fixtures. Distinguish current SessionService from unbuilt promotion; record the unresolved future occupancy conflict in the existing blocked projector backlog. No runtime or future booking/projector formula change. |
| 2026-09-12 | v2.29 | **ap3-intake rescore reconciliation (Q1/Q2, `ap3/features/session-management/INTAKE.md` 2026-09-12 round):** M3b (guest-note commands, PR #13) landed 2026-09-11 but §1/§3/§4/§5 were never reconciled to the merged code — only §2's schema bullet was, in v2.28. **(1)** §3 POST `/guest-notes` success example fixed to the actual shipped/tested DTO (`guestNote:{id,sessionId,remainingNotes}` — no `guestName`/`note`/`createdAt` echo, DD-117 D5); added missing `INVALID_INPUT` to its error-case list plus a proper Error Codes table row (NUL/lone-surrogate guard, commit `c1e8bcf`). **(2)** §3 DELETE `/guest-notes/:noteId` success example fixed (`{guestNote:{id,sessionId,deleted:true}}` — no `slotsFreed`, that field never existed in code). **(3)** `GET /api/sessions/:id/guest-notes` annotated **CHƯA BUILD** in header Implementation line, §1 entry points, §3 endpoint table and its own example block — deliberately dropped from M3b, blocked on Milestone 2's body-less auth-context resolver (still supervised, not run). **(4)** §2's `pending`-enum doc-comment corrected — `players_status_chk` was never updated to include `pending` (still exactly `active`/`left`/`waitlisted` since `0014`; migration `0044` itself already flagged this exact inaccuracy in a SCOPE FENCE comment, 2026-09-11 — nobody had gone back to fix the prose until now). **(5)** §2 edge #43, §4 DeleteGuestNote step 4, and §5 test row #80 reworded: `deleteGuestNote` deliberately does not promote a waitlist candidate on slot release (no waitlist/join/leave code exists yet — D2, fully blocked); occupancy is recomputed and published, but promotion itself is deferred to the waitlist/promotion engine. Docs-only — no code/schema change. |
| 2026-09-11 | v2.28 | **session-management-m03-guest-note-schema-migration ✅ landed trong `0044_session_guest_notes.sql` (PR #12, supervised slice, `ap3/features/session-management/PLAN.md` Milestone 3a):** migration `0044_session_guest_notes.sql` — 3 object pending từ v2.21 (2026-08-12) nay có trong `schema.ts` + migration: `sessions.allow_player_invite`, `players.invited_by_person_id` + `idx_players_invited_by`, bảng `session_guest_notes` đầy đủ (2 CHECK độ dài + trigger `trg_session_guest_note_limit`) + `idx_session_guest_notes_session`. RLS mirror `players`/`sessions` (ENABLE+FORCE+`tenant_isolation` policy), grant `app` theo 0009 rule (chỉ SELECT/INSERT/DELETE — không UPDATE, xem finding dưới). §2 Migration & Rollback pending-list bullet cập nhật thành landed. Schema-only — không command/route/waitlist code (mirror 0014 precedent); Milestone 3b (guest-note commands) chờ milestone này **merge** mới được `plan-emit`. **Codex review nhiều vòng (code + security), mỗi vòng tìm finding thật và fix ngay trong slice trước khi mở PR — không phải 1 vòng sạch:** vòng 1: thiếu same-tenant composite FK `(tenant_id, session_id) -> sessions(tenant_id, id)` (mẫu DD-68/0019, RLS không chặn tenant A trỏ session_id của tenant B vì FK check không lọc RLS) + trigger đếm không khoá row (race 2-insert-đồng-thời có thể cùng thấy count=2, cùng commit thành 4 note) — fix: thêm composite FK inline + `PERFORM ... FOR UPDATE` trên `sessions` trước khi đếm (session-lock-ordering invariant). Vòng 2 (sau fix vòng 1): GRANT còn UPDATE dù không command nào cần — cho phép caller reassign note sang (session,person) khác để né trigger (chỉ bắt BEFORE INSERT) — fix: bỏ UPDATE khỏi grant + test 42501; test race gốc dùng 2 promise autocommit không tự thân chứng minh lock hoạt động (có thể pass ngay cả khi trigger không khoá, do timing) — fix: viết lại bằng transaction tường minh + `pg_blocking_pids()` polling để chứng minh connection thứ hai THẬT SỰ bị khoá bởi connection thứ nhất trước khi commit; mutation-tested (tắt tạm dòng `FOR UPDATE`, xác nhận test fail, rồi khôi phục — xem log phiên). Tests: `packages/db/src/migrate.test.ts` (trigger 4th-note reject + RLS cross-tenant block + column/index shape + cross-tenant FK reject 23503 + race thật qua 2 connection với `pg_blocking_pids()` + UPDATE bị từ chối 42501, chạy thật với `DATABASE_URL_TEST`) + 4 assertion migration-count/tail hardcode trong `rls-invariants.test.ts` cập nhật 44→45 / `0043`→`0044`. |
| 2026-09-11 | v2.27 | **ap3-intake gap closure (9 owner answers, `ap3/features/session-management/INTAKE.md`):** (1) §2 Migration & Rollback: re-verified tail `0043` (từ `0024`); thêm migration slice RIÊNG cho `allow_player_invite`/`invited_by_person_id`+index/`session_guest_notes` (đặc tả từ v2.21 nhưng chưa từng track pending); (2) §2 Edge Cases thêm #47–52: close transition (#47–49, từ live code `closeSession`), auto-close OWNER-CHECK chưa build (#50–52, từ DD-45 + auto-expiry pattern); (3) §3 Endpoints table reconcile đủ 14 endpoint (thêm invite/guest-note/approve/reject family); thêm ví dụ request/response còn thiếu cho `PUT` success, `announce`, `close`, `GET` list, `GET` detail; (4) §4 thêm parenthetical cho 5 catalog invariant token còn thiếu (`publish-suspend-gate`/`session-command`/`billing-authz`/`retry-liveness`/`member-safety` — `session-lock-ordering` đã khớp sẵn); (5) §5 thêm unit test #85–92 (close/auto-close mirror edge #47–52; recurrence this-and-future DD-121; timezone validation) + subsection Verify (lệnh sandbox/verify_host/CI thật, đo từ `package.json` + `.github/workflows/ci.yml`). |
| 2026-09-06 | v2.26 | **Audit code ↔ docs 06/09 — hai đính chính header/DDL, không đổi contract.** (1) Header *Implementation* từng nói "SessionService/routes/projectors… vẫn chưa build" trong khi `main` có đủ 6 command + 5 route (`b48625c`…`8e668a1`, `770ff4b`, `6d62cf8`) — ghi đúng phần đã có và phần chưa có (route đọc, projector, auto-promote/expiry, roster writer). (2) DDL `players_status_chk` §2 liệt kê `'pending'` mà `0014:79-80` không có — bỏ khỏi spec; thêm giá trị là việc của một migration mới, không phải của prose. Nguồn: `../../sessions/2026-09-06-repo-audit.md` §3 #6/#11. |
| 2026-08-27 | v2.25 | **Tách edge #4 thành `4a` (price) / `4b` (capacity + retry root) theo DD-112 ✅ (owner 27/08, `decisions.md` "Chốt (owner 2026-08-27)").** Hàng #4 gộp hai luật khác nhau: vế `impact_policy` được viết cho **price** (nguyên bản trước 19/07/2026 chỉ có price), còn capacity bị commit `c18ac65` — một sweep "pointer refresh" 99 file — chèn vào sau mà **không decision nào đứng sau**; DD-49, decision duy nhất chi phối `impact_policy`, có ba mục (đổi giá · leave/cancel/refund · rejoin) và **không có capacity**. Hàng #4 vì thế mâu thuẫn với chính hai hàng capacity của bảng này (#15/#16) và với code trên `main` (`session-service.ts` guard bằng `CAPACITY_BELOW_ROSTER`, không đọc `charges` trừ nhánh `priceAmount`). Lane `docs-impact-policy-contract--narrowed` đã đốt 6 vòng codex tới HALT `MAX_ROUNDS` vì reviewer dao động trên đúng vùng này. **`4a`** giữ nguyên semantics giá (lock → `impact_policy`) nên trích dẫn "edge #4" gắn với `impact_policy` đang sống vẫn đúng; ÍT NHẤT hai chỗ vẫn dùng "edge #4"/"edge #4/#5" cho ý capacity của hàng gộp cũ, CHƯA đồng bộ sang `4b` — đo được: `docs-impact-policy-contract.json` §A6, và `docs/autopilot/contracts/autopilot-session-commands-update-close-cancel.md` (dòng gate `PRICE_CHANGE_REQUIRES_POLICY` / `CAPACITY_BELOW_ROSTER` ghi "edge #4/#5"). Danh sách này KHÔNG khai là đủ — chỉ hai chỗ đã đo, không phải toàn bộ repo; trích dẫn chưa đồng bộ là nợ tài liệu để lại cho lần sửa từng file đó (cả hai không thuộc scope của slice này), KHÔNG phải lời khai "mọi trích dẫn khác đều đúng". **`4b`** ghi capacity/retry-root **không phải nhánh tiền**, trỏ về guard sẵn có ở #15/#16 thay vì dựng luật thứ ba, và mang theo điều kiện tự huỷ của DD-112. **KHÔNG renumber** — ID 5..46 giữ nguyên (bảng vốn đã có khoảng trống 32–35 từ v2.22, tiền lệ "ID giữ trống, KHÔNG renumber"). Docs-only: không đổi code/migration/schema, không chạm edge #5, không đặt error code mới. **KHÔNG** gỡ chặn `docs-impact-policy-contract` — điều kiện của nó là hàng `4a` tồn tại trên `main`, nên đó là commit riêng sau khi hàng này land. *(Đính chính, cùng ngày: hàng `4b` ghi hành vi thành công nhưng Unit Tests §5 chưa có case dương cho nó — chỉ có case âm của `4a` (test #6, price+charges → `PRICE_CHANGE_REQUIRES_POLICY`); đã thêm test #84 phủ đúng case dương của `4b` (capacity+charges → success, `charges`/`payment_allocations` không đổi, không đòi `impact_policy`).)* |
| 2026-08-25 | v2.24 | **Mirror DD-117 ✅ (owner 25/08) vào edge #5 (docs-only, không đổi contract):** ghi cách đọc đã chốt — nhánh paid-roster/retry-root của Close/Cancel = **fail-closed refuse** (`CANCEL_REQUIRES_REVIEW` class) cho tới khi subsystem payments/`review_policy` tồn tại, thay deferral 14/08; kèm D5 (họ lệnh dedup `(tenant_id, command_id)` DUY NHẤT — content fingerprint bị bác). An toàn hôm nay vì paid roster/retry root chưa reachable trên `main`. Chi tiết + phạm vi authorize thuộc `../../standards/decisions.md` DD-117. |
| 2026-08-15 | v2.23 | **AnnounceSession author (`session-command-announce` slice; authority DD-111 D1–D5):** §4 thêm subsection "Announce transition" — announce là **notification, KHÔNG mutate** (`status`/`version` không đổi); gate `status='open'` **VÀ ends_at freshness guard** (`ends_at<=now()` → `SESSION_ALREADY_ENDED` 409; **KHÔNG** past-START cutoff — buổi đang diễn ra vẫn announce mời join muộn), clock đọc `clock_timestamp()` bằng query RIÊNG post-lock (mirror publish's round-05 pattern, KHÔNG `now()`/`Date.now()`); billing gate `announce_session` (deny-path fail-fast); `channel` là logical enum đóng `zalo`/`messenger` (không raw id → không cross-tenant); session `FOR UPDATE` serialize outbox sequence. §2 thêm edge #46 (in-progress ALLOWED / ended REJECT — HAI lý do tách biệt: exempt-edge#11-vì-non-mutating **và** freshness-guard-riêng). §3 thêm `SESSION_ALREADY_ENDED` (409, vi+en; không tái dùng `SESSION_CLOSED` của channel specs) + hoàn thiện announce error contract: `INVALID_CHANNEL` (400) và `COMMAND_ID_CONFLICT` (409, canonical dedup dùng chung create/publish/announce — trước đây thiếu khỏi §3). **Khôi phục edge #11 về đúng FE product authority:** BE edge #11 sửa về "mutation trên closed/cancelled/**past**" khớp FE edge #11 (line 94) — bản BE cũ ("chỉ sau `status=closed`") là restatement THIẾU của một Security rule; edge #31 (cancel-scoped) nay là *realization* của past-rule trong edge #11 (mang thêm roster/refund weight), KHÔNG tách rời khỏi nó. Không đổi schema/migration. Code: `packages/db/src/{authorization,session-service}.ts`. |
| 2026-08-13 | v2.22 | **Gỡ WIP DeleteSession (rút toàn bộ nội dung v2.20) theo DD-104:** `decisions.md` v2.27 chốt D0–D4 (D1a: mọi FK giữ `NO ACTION` và chặn delete — cơ chế "FK cascade" v2.20 khai không tồn tại, 9 FK trỏ `sessions` đều `NO ACTION`; D2a: action class `delete_draft_session` — thuộc billing contract, slice riêng; D3c: bắt `23503` rồi tra `pg_constraint` `confrelid='sessions'`; D4a: concurrency ordering chung delete+publish theo precedent publish step 6). Gỡ khỏi body: command trong §1, entry point + API row + endpoint examples §3, 2 error codes delete-specific (giữ `SESSION_NOT_FOUND` generic), idempotency row, rate-limit row, edges #32–#35, §4 "Delete transition", event `session.deleted`, unit tests #62–#69, integration test #9. ID giữ trống, KHÔNG renumber. Spec sẽ được author trong slice DD-104 sau khi `tenant-capability-authority-core` có packet. |
| 2026-08-12 | v2.21 | **Invite Friend + Guest Note + Approve/Reject feature:** thêm 5 commands mới (`InviteFriend`, `CreateGuestNote`, `DeleteGuestNote`, `ApproveInvite`, `RejectInvite`) + 7 entry points mới. §2: `sessions.allow_player_invite` column mới (boolean, default true); `players.status` enum mở rộng thêm `pending`; `players.invited_by_person_id` FK mới; bảng `session_guest_notes` mới + trigger `trg_session_guest_note_limit` (max 3/player/session); 2 indexes mới. 10 edge cases mới (#36–#45). §3: 12 error codes mới + 7 endpoint docs với request/response examples + idempotency + 6 rate limit rows mới. §4: 3 algorithm subsections mới ("Invite Friend transition", "Guest Note management", "Approve/Reject pending invite") + 5 events mới. §5: 14 unit tests mới (#70–#83) + 2 integration tests (#10–#11). Additive-only — không đổi existing cancel/publish/delete/waitlist contract. |
| 2026-08-11 | v2.20 | **(RÚT 2026-08-13 — nội dung đã gỡ khỏi body, xem v2.22 + DD-104; row giữ làm audit trail.)** **DeleteSession (hard delete) feature:** thêm `DeleteSession` command mới (parallel với `CancelSession`) + endpoint `DELETE /api/sessions/:id`, chỉ cho session `draft`. §1: thêm command + entry point. §2 Edge Cases: 4 edges mới (#32–#35) — status guard, paid player guard (excl. host), concurrent race, already-deleted 404. §3: endpoint + 3 error codes mới (`SESSION_MUST_BE_DRAFT`, `DELETE_REQUIRES_REFUND` với payload `players_requiring_refund[]`, `SESSION_NOT_FOUND`) + request/response examples + idempotency row + rate limit row (5/min). §4: algorithm subsection "Delete transition" (6-step: authz, lookup+lock, status guard, paid guard excl. host, outbox+delete cascade, projector cleanup) + event `session.deleted`. §5: 8 unit tests mới (#62–#69) + 1 integration test (#9). Additive-only — không đổi cancel/publish/discard contract. |
| 2026-08-10 | v2.19 | **A-grade upgrade:** thêm Entry points table (9 entries); bump version. Không đổi contract/session model. |
| 2026-08-03 | v2.18b | **Reconcile `authorizeTenantAction` call in §4 step 6 (`docs-billing-authz-signature-reconcile`):** step 6's mandatory billing re-check documented `authorizeTenantAction(tenantId, 'publish_new_sessions')` — merged code (`ddb69a9`, `packages/db/src/authorization.ts:91-95`) requires the caller's already-open transaction as its first parameter. This was a genuine contradiction, not a stylistic gap: the same sentence requires the call to run inside the transaction holding the session lock while printing a signature that structurally cannot receive that transaction — the same defect `feature_billing_lifecycle_tech.md`'s own reconcile (v2.10) exists to close (codex round-08 [P2] on that slice, verified against this file directly). Updated to `authorizeTenantAction(tx, tenantId, 'publish_new_sessions')`. Every other mention in this file (edge #24, step 1, the "Billing suspension gate" and "Billing suspension — concurrency" blockquotes) is bare-name prose or single-argument action-class shorthand naming which action is being cross-referenced, not a signature assertion, and stays unchanged. Docs-only; code/schema/tests already merged and unaffected by this reconcile. Pre-existing dated changelog giữ verbatim. |
| 2026-07-28 | v2.18a | Reconcile two DD-32 residual drifts found by acceptance retrace: capacity-decrease step now guards active+live-hold occupancy with exact error split; projector parity keeps `confirmed_count=active` while `slots_open` subtracts active+holds and exposes no hold count. No runtime/schema. |
| 2026-07-28 | v2.18 | Mirror DD-32 Option D: shared active+hold occupancy, capacity-reduction error, selector exclusion, paid-unlinked promotion hold and expiry requeue-tail; add tests/rollout blockers. No runtime/schema. |
| 2026-07-28 | v2.17 | Mirror DD-45a owner-final without claiming implementation: future promotion slice adds partial unique waitlist position via new monotonic migration; duplicate preflight HALT/manual, no auto-renumber, gaps allowed; session-lock allocator + DB final fence. Replace permissive fixture with duplicate rejection only when migration lands; keep three-key selector as compatibility/defense. Add test #33r. |
| 2026-07-27 | v2.16 | Reconcile live DB substrate through tail `0024` (25 migrations): DD-68 same-tenant composite integrity landed in `0019`; validated `sessions_public_capacity_chk` landed in `0024`. Promote public-capacity rule from migration candidate to implemented DB invariant while retaining SessionService/projector consume guards as defense-in-depth for pre-`0024`/fixture/bypass data. Service/routes/projectors/auto-promote remain unbuilt. |
| 2026-07-24 | v2.15 | **Draft-lifecycle cleanup (founder-ratified, `docs-session-draft-lifecycle`):** closes the gap the publish contract flagged (v2.14, codex round-03) — a `draft` past its `starts_at` with no host action was permanently stuck (no draft-terminal transition existed). Authors BOTH founder-decided cleanup paths, terminal status `cancelled` (reuses the existing enum, no schema change to existing objects): `CancelSession`'s command-list line (§1) and endpoint description (§3) now note it accepts source status `draft` in addition to `open` — no new command, no new endpoint, no new error codes. New §4 algorithm subsection **"Draft discard + auto-expiry (`draft` → `cancelled`)"**, inserted directly after Publish transition. **Host-initiated discard:** a 7-step algorithm (mirrors Publish's own step numbering/rigor) — `session.manage` authz, lock `FOR UPDATE`, idempotent no-op if already `cancelled`, reject `SESSION_NOT_OPEN` if `closed`, **mandatory `expectedVersion`** on the mutate branch for every source (not draft-only — the first time `CancelSession` has had a detailed algorithm at all, so nothing pre-existing regresses; closes the race where an omitted/stale version on a "discard draft" click could otherwise fall through and silently cancel a session concurrently published to `open`), then **verify** (never assume) `players`/`charges` are empty under lock before the fast-path commit — a data anomaly routes fail-closed into the same `review_policy` gate edge #5 already uses for `open`-source cancels with paid rosters, rather than silently discarding unproven-safe data. **System auto-expiry job:** described at the same level of abstraction as `feature_billing_lifecycle_tech.md` §4's Daily Lifecycle Job (file not modified, pattern reference only) — claims `sessions WHERE status='draft' AND starts_at<=now()` via `FOR UPDATE SKIP LOCKED`, applies the identical fail-closed verify, and transitions or routes to review exactly like the host path; the job's privileged execution identity, grants, migration wiring, and queue/cron registration are explicitly a **build-slice detail** (this repo's own precedent for privileged-execution wiring, the `chat_definer` protocol in `feature_inapp_chat_tech.md` §2, is noted as a reference for that slice — not reproduced here). New event `session.expiry_anomaly_detected` (§4 Events table) rides the same canonical outbox mechanism `session.cancelled` uses when an anomaly is found on either path; `session.cancelled` itself gains a `cancel_reason` (`manual`/`auto`) field, mirroring `session_closed`'s existing `close_reason` shape. **Critical correctness point:** the no-past-guard exception is scoped **strictly to source `draft`** — `open`→`cancelled` retains the pre-existing past-session-mutation restriction (edge #11: requires privileged correction + audit trail, not the ordinary cancel path) completely unchanged; a `draft` was never `open`, so past-ness carries no roster/refund weight for it, but an `open` session past its `starts_at` may have a real, possibly-settled game behind it. The anomaly path (either source) surfaces via the **existing** `CANCEL_REQUIRES_REVIEW` error code — the same one `open`-source paid-roster cancels already return — not a bespoke draft-specific code; the auto-expiry job (no HTTP caller) has no response to give here and simply skips + audits. New §2 BE edges #25–31 (discard transition, mandatory-version race closure, closed/already-cancelled handling, anomaly fail-closed via `CANCEL_REQUIRES_REVIEW`, auto-expiry vs. concurrent-publish race, concurrent-run idempotency, and `open`-past-guard preservation) and a full `POST /api/sessions/:id/cancel` Request/Response Examples block in §3 (request DTO, success, idempotent no-op, `STALE_VERSION`, `CANCEL_REQUIRES_REVIEW`, and the other error paths — mirroring publish's existing style; the endpoint existed before this slice but its contract was never illustrated). New partial index `idx_sessions_draft_starts_at` (§2 Indexes + Migration & Rollback — mirrors the existing `idx_sessions_starts_at` pattern, not yet applied, same `≤1 monotonic migration` budget as the other pending items already listed there) for the auto-expiry claim predicate. 13 new unit tests (#49–61) plus 1 new integration test (#8) covering the happy path, authz, the version race (mismatched and omitted), closed/already-cancelled rejection, the anomalous-draft fail-closed path via `CANCEL_REQUIRES_REVIEW` (both host and job), auto-expiry itself, auto-expiry leaving other sessions untouched, concurrent-run idempotency, the auto-expiry-vs-publish race, and — critically — that cancelling a past `open` session is still rejected exactly as before this slice (test #61, proving the "open unchanged" claim rather than just asserting it). Negative scope respected throughout: does not touch the publish (`draft`→`open`) path, the billing suspend-gate, or `feature_billing_lifecycle` — this is purely a new terminal transition INTO `cancelled` FROM `draft`. **Iteration note:** this contract converged across multiple codex review rounds (full history in `docs/autopilot-backlog.md`'s task block and the session's codex round artifacts) — early rounds explored a fully-specified Postgres privilege/role-bootstrap mechanism for the auto-expiry job before the founder redirected that whole class of detail to match the Daily Lifecycle Job precedent (business contract only, infra wiring deferred to the build slice); a later full-base confirmation round then caught that the "no past-guard" wording for draft-discard had accidentally widened to also exempt `open`-source cancel from its pre-existing past-session restriction — fixed as described above, along with wiring the anomaly path to the existing `CANCEL_REQUIRES_REVIEW` surface instead of leaving it unspecified. The version reflected here is the final, founder-confirmed scope. Dated changelog giữ verbatim; không resolve OQ nào khác ngoài draft-lifecycle. |
| 2026-07-24 | v2.14c | **Round-01 fix (`docs-session-publish-concurrency-recheck`, codex [P1]):** v2.14b's step-6 re-check held only the session row lock (from step 2) and re-evaluated `authorizeTenantAction` as a plain re-SELECT — codex correctly flagged that this does NOT serialize against the Daily Lifecycle Job, which locks `subscriptions`, not `sessions`: under READ COMMITTED, being "in the same transaction" does not force ordering against a concurrent writer on a *different* row; only an actual lock on the contended row does. Fixed step 6 + the "Billing suspension — concurrency" blockquote + edge #24 + the CODE-READINESS note to require the re-check to be a **locking read** — `SELECT ... FOR SHARE` on `tenants` then `subscriptions` (lock order matches status-authority's own step 1→step 2 evaluation order) — so the re-check either blocks until a concurrent lifecycle-job suspend transaction resolves (then observes the fresh `suspended` value) or the lifecycle job's `FOR UPDATE SKIP LOCKED` skips the row this cron run (suspend deferred to the next run, publish proceeds correctly on the state it validly observed). This is what actually closes billing test #36's competing-writer race; a bare same-transaction re-read did not. |
| 2026-07-24 | v2.14b | **Publish concurrency recheck-under-lock (`docs-session-publish-concurrency-recheck`):** round-07 review of the ratified billing status-authority contract surfaced a TOCTOU race — §4 publish algorithm checked billing authorization at step 1, BEFORE acquiring the session row lock (step 2), so a tenant suspended between check and mutation could still publish. **Step 6 (commit) now requires a mandatory billing re-check** (`authorizeTenantAction('publish_new_sessions')`) INSIDE the same transaction/row-lock, immediately before the `draft`→`open` mutation — step 1's check is fail-fast/no-op-gating only, not authoritative for the mutation; `TENANT_SUSPENDED` must win even if suspension lands mid-publish (failure mode pinned as a build-time correctness requirement, not optional hardening). New blockquote "Billing suspension — concurrency" elaborates the requirement + cites billing test #36 (competing-writer acceptance criterion) as the build-time proof obligation. **⛔ CODE-READINESS note rewritten:** both original hard dependencies — `docs-billing-publish-suspension-authority` (billing status-authority, `feature_billing_lifecycle_tech.md` §3) and `docs-prd-flow2-publish-projection-reconcile` (`PRD.md` v2.8g FLOW 2) — are now RESOLVED/merged; this slice closes the third and last known gate (concurrency) AT SPEC LEVEL, explicitly short of a full `CODE_READY` certification (no closure-matrix/acceptance-matrix/implementation-artifact pass run). Synced every mirror mention of the two now-merged dependencies within this file (edge #24, step 1, step 7, "Billing suspension gate" blockquote, "Ngoài scope" draft-lifecycle blockquote, test #46) so none contradict the rewritten note; dated `v2.14` changelog row preserved verbatim (accurate as of 2026-07-23 authoring). Docs-only — no schema/code change; `Implementation: Not started` unchanged. |
| 2026-07-24 | v2.14a | **De-pin migration-tail** (docs-migration-tail-0018-to-0020-sweep): header Implementation line + §Migration&Rollback grep-note + rollout step-2 hard-pinned `migrations 0000–0018` → non-pinned "verify tail hiện hành tại `packages/db/migrations/`, không hard-pin số" (live tail nay `0020`; `0019`/`0020` tenant-integrity FKs DD-68). Dated provenance giữ nguyên verbatim. Pre-existing dated changelog giữ verbatim. Không đổi contract. |
| 2026-07-23 | v2.14 | **PUBLISH transition contract (founder-ratified, `docs-session-publish-contract`; re-sliced after codex rounds 01–05):** distinct command `PublishSession` (§1 command list + flow), endpoint `POST /api/sessions/:id/publish` (§3, `commandId` + `expectedVersion`) → Endpoints + Idempotency (`publish already-open = no-op`) + Request/Response Examples (DTO/envelope DD-60, incl. stale-`expectedVersion` → `STALE_VERSION`), §4 algorithm **Publish transition (`draft`→`open`)** (AuthZ `session.manage` re-checked mọi call incl. replay — **authz thắng no-op**; lock row; **idempotent no-op thắng `expectedVersion`** trên session đã open; guard non-draft/past → `SESSION_NOT_OPEN`; public → E#7 → `MISSING_DISCOVERY_FIELDS`; mutation `draft`→`open` mới kiểm `expectedVersion` → `STALE_VERSION`, set `status='open'` + bump `version` + đúng một `session.published` outbox), event `session.published`, BE edge #21–#24, tests #40–#47. **Status-only** — publish KHÔNG đổi `visibility`. Reuse error codes `SESSION_NOT_OPEN` + `MISSING_DISCOVERY_FIELDS` (không invent code mới). **Billing suspension = fail-closed block 403** per billing Suspended Action Matrix — **named dependency on `feature_billing_lifecycle`** (matrix owner định nghĩa authoritative status source/mismatch/missing/other-status; session slice cross-ref only, KHÔNG resolve status-authority) → **HARD DEPENDENCY** `docs-billing-publish-suspension-authority`. **Projection-timing = OPEN cross-authority reconcile** (§4 step 7): session-side intent project-on-publish, nhưng PRD FLOW 2 + marketplace integration contract mô tả project-on-create — cross-ref only, KHÔNG claim PRD/marketplace resolved → **HARD DEPENDENCY** `docs-prd-flow2-publish-projection-reconcile`. **Publish contract AUTHORED nhưng NOT code-ready cho tới khi 2 hard deps merge** (§4 code-readiness note; codex round-06). Idempotency **inherit canonical `processed_commands` dedup** (Session Organize contract: `request_hash` JCS; collision → `IDEMPOTENCY_CONFLICT`; `request_hash` = pending additive migration — cross-ref, không re-specify; codex round-06/07). Reference canonical **`TENANT_SUSPENDED`** (403, tenant-routing) cho suspended-publish (§3 error codes; codex round-07). Checklist re-trace → follow-up `docs-session-acceptance-checklist-publish-retrace` (codex round-07). Negative-scope: dọn **draft chưa publish** (draft-terminal cleanup) là pre-existing gap từ `create=draft` → backlog `docs-session-draft-lifecycle`. No schema change (status enum `draft/open/closed/cancelled` đã tồn tại `0002`). Re-slice giảm scope về 2 session specs + README + backlog (billing/projection/draft-lifecycle deferred to owning specs; acceptance-checklist tách khỏi scope). Dated changelog giữ verbatim. |
| 2026-07-23 | v2.13b | **Reconcile 2 inconsistencies (AP-25 round-06, founder-ratified):** (1) public-capacity — pin PRD E#7 authority: `visibility='public'` requires `slots_max IS NOT NULL` (public không unlimited; `NULL` = unlimited chỉ non-public) — note Capacity × visibility §2 (validation choke-point; row public+NULL ngoài choke-point = invalid fail-closed, không được project — mechanism/test thuộc `feature_marketplace_discovery_tech.md`, follow-up ngoài scope), DDL comment, edge #12/#15 qualifier, `MISSING_DISCOVERY_FIELDS` trigger, §4 consume-time re-check tại MỘT choke-point entry step-3 (mọi branch first-entry/left-rejoin/approval) + promotion step-3 (KHÔNG treat public+NULL as unbounded — fail-closed theo not-joinable path), test #24 pin non-public + #24a public+unlimited reject + #24b bypass-row consume-time fail-closed mọi branch. Cột DB giữ nullable như live `0002`; DB CHECK = hardening candidate migration mới (chưa scope). (2) create-status — TDD vốn đã đúng (DDL default `draft`, POST example `draft`), không đổi; reword nằm ở PRD SES-UC-1. Prose only; dated changelog giữ verbatim; publish-transition mechanics là pre-existing gap, không resolve ở đây. |
| 2026-07-23 | v2.13a | **Reconcile 0014 merge-state + projection direction (TDD→PRD):** current-state 0014 mirrors → **merged on `main` (`1a6ac38`, migrations 0000–0018)** (header, §2 migration note + range 0000→0018, DDL `waitlist_position` comment, rollback row = forward-migration mới, §6 rollout step-2; provenance `origin/main`@`22c23aa` reframed thành historical marker). Edge test #10 → "Public → private removes projection" khớp feature spec edge 8 + SES-UC-5/SES-UC-10 (PRD FLOW 2/13). Pre-existing dated changelog giữ verbatim. Không đổi contract. |
| 2026-07-19 | v2.13 | **Template v2.30/v2.33 uplift:** thêm §2 Migration & Rollback (reuse baseline `0002`; `0014` branch-only; DD-68/DD-45a/retry objects = migration mới monotonic), §3 Request/Response Examples (DD-60 envelope), §4 Caching Strategy + Security Checklist. Idempotency đã có sẵn (§3) — giữ nguyên. Derivative/editorial — không đổi contract. |
| 2026-07-19 | v2.12a | Metadata sweep (index v2.35): thêm trường **Implementation** đồng bộ BUILD-STATUS (Not started). Không đổi contract. |
| 2026-07-19 | v2.12 | **DD-45 lock/liveness/RLS closure:** every domain path locks session→root before candidate/player/finance; root is lazy on first failure; max 3 claimed attempts with expired-final resolve-or-terminal finalizer; initial opener also requires future/joinable session; tenant-private RLS/narrow scheduler claim; owner digest dedupes per root. Behavior remains unbuilt. |
| 2026-07-19 | v2.11 | **DD-45 retry-owner/queue/restriction closure:** one root promotion job owns max-3 CAS/lease full sweeps; candidate failure events are sibling alert/audit dedupe refs, not independent budgets. Each sweep re-enters current order, tries each candidate once and re-checks DD-41/DD-42/DD-52. Add reorder/ban/N×N-budget regressions. Behavior remains unbuilt. |
| 2026-07-19 | v2.10 | **DD-45 retry-consumer closure:** event binds `waitlist_entry_version` + `origin_command_id`; pin one-owner CAS/lease state machine, max-3 atomic claims, full consume-time revalidation, crash recovery and stale-entry/concurrent-worker tests. Add missing migration/worker/consumer/DLQ blockers. Behavior remains unbuilt. |
| 2026-07-19 | v2.9 | **DD-45×DD-49 integrity:** waitlisted means no new obligation/venue; refunded rejoin appends lifecycle only at activation. Add canonical failure event registry + durable 3-attempt/backoff non-recursive retry and terminal review/DLQ tests. Behavior remains unbuilt. |
| 2026-07-19 | v2.8 | **DD-45 schema landed on branch (rollout step 2):** migration `0014_players_waitlist` đã commit trên nhánh `feat/session-waitlist-expand` (chưa merge vào `main` — `origin/main`@22c23aa vẫn dừng ở `0013`) — status domain opened, `waitlist_position`, state-shape + positive CHECKs, queue index; 21 DDL invariant tests incl. app-role grant/RLS. Records that the previously-inline `players` status CHECK was auto-named `players_status_check` (schema.ts's `players_status_chk` had never been applied) and 0014 reconciles the two. Flags the position-uniqueness question and the DD-68 composite-FK omission as explicitly out of scope. Step 3 marked blocked on DD-39/41/42. Contract body unchanged. |
| 2026-07-17 | v2.7 | **Live DDL closure:** restore current `sessions.skill_level` and `price_amount >= 0` CHECK in the documented schema; add upgrade/negative-price regressions while DD-41 future rank migration remains expand→contract. |
| 2026-07-17 | v2.6 | **DD-65..68:** central/tenant Messenger create parity, single durable wizard interceptor, final capability/context/snapshot re-check, shared idempotent command path, same-tenant FK prerequisite and hybrid integration gate. |
| 2026-07-16 | v2.5 | **DD-49 full propagation:** replace blanket left-rejoin reject with locked disposition table (carry-over/refunded/unknown); unknown stays fail-closed. Pin append-only obligation lifecycle + canonical balance helper and explicitly forbid assuming a second `charges` row under live uniqueness. |
| 2026-07-15 | v2.4 | **DD-39×DD-45 fail-closed propagation:** derive charge amount before promotion mutation; KMS/decrypt/price failure keeps candidate waitlisted/no-charge/no-venue, writes idempotent audit+retry/owner-alert, does not rollback leave/capacity opener, then continues the queue; add retry no-op tests. |
| 2026-07-15 | v2.3 | **DD-45 money closure:** add entry/rejoin decision table; full path creates waitlisted without charge; promotion assert-no-charge + exactly-one insert; `left` rejoin fails closed; conflict audit/test coverage. |
| 2026-07-15 | v2.2 | **DD-45 ✅:** pin schema state-shape/positive position + queue index; total order position/joined_at/id; locked fill-available/unlimited promotion; atomic status+charge+notify; capacity-below-active reject; add edge/test/rollout coverage. |
| 2026-06-18 | v1.0 | Initial BE tech spec (English format) |
| 2026-06-19 | v2.0 | Chuẩn hoá Vietnamese numbered (6 sections), thêm full DDL, 12 BE edge cases, error codes, idempotency table, 20 unit tests, 4 integration tests |
| 2026-07-13 | v2.1 | Reconcile với canonical schema: thêm `players`, `tenant_id` trên `session_surface_refs`; đổi TG projector/tests sang Zalo/Messenger/web. Waitlist chưa model cho tới khi DD-45 ✅. |
