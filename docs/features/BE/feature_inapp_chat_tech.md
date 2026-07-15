# Feature: In-app Chat (club-wide + 1-1) — Backend Tech Spec

> **Canonical phase:** P4
> **Version:** 0.10 · 2026-07-11
> **Status:** ✅ DD-38 chốt (2026-07-10) — Draft, pending migration (schema aligned với `packages/db/schema.ts`)
> **Product spec:** `../feature_inapp_chat.md` *(Draft)*
> **References:** `../../standards/decisions.md` DD-38 (chat cơ bản phase-1) · DD-19/DD-20 (trợ lý tái dùng hạ tầng chat) · DD-07 (SSE + LISTEN/NOTIFY) · `../BE/feature_multi_tenant_tech.md` (RLS template) · `../BE/feature_sync_engine_tech.md` (realtime authz)

> ✅ **DD-38 chốt (2026-07-10).** Schema dưới đây là **thiết kế đã pin** (ràng buộc trong DD-38: 2 loại channel, DM guard, dedupe theo `client_msg_id`); nguồn authoritative khi thực thi vẫn là `packages/db/schema.ts` + `packages/db/migrations/*.sql` (**thêm `chat_*` + RLS qua migration mới sau `0013`**) + `decisions.md` DD-38. **KHÔNG** tạo bảng song song với `persons/memberships/tenants`.

---

## 1. Tổng quan triển khai

```text
Surface (web/app Plexco) → SendMessageCommand(client_msg_id, channel, actor)
    → AuthZ (member of channel) → Insert chat_messages (idempotent) → NOTIFY topic
        → SSE fan-out (web_realtime) → subscribers of that channel
```

Chat **chỉ sống trong Plexco** (web + app surface). **KHÔNG bridge** ra group Zalo/Messenger ở phase-1 (CO-7 BRD / DD-38) — không có projector kênh ngoài cho chat. Canonical store là nguồn sự thật; SSE chỉ là surface realtime (reuse DD-07 `LISTEN/NOTIFY`, giống sync engine `web_realtime`).

**Design decisions:**
- Hai loại kênh: **`club`** (chat toàn CLB — member trong 1 tenant, RLS tenant-private) và **`dm`** (1-1 person ↔ person, person-self path).
- Trợ lý AI (DD-19 pha B, P7) **tái dùng** chính bộ bảng `chat_*` — phát ngôn với `author_type='assistant'` (DD-20), **không** tạo Person/ChannelIdentity mới. Chat cơ bản (DD-38) dựng hạ tầng sớm ở P4; trợ lý plug vào sau.
- Idempotent theo `client_msg_id` (chống double khi retry/mạng chờn).
- Anti-spam: rate-limit per (person, channel) + cap kích thước message.

---

## 2. Database Schema + Edge Cases (BE) — proposal

### Schema (đề xuất, trỏ schema.ts/migrations khi thực thi)

```sql
-- FK target phụ (để bind child ↔ tenant của đúng channel):
--   memberships cần UNIQUE(id, person_id, tenant_id) [id đã PK; thêm unique phụ làm FK target].
CREATE TABLE chat_channels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES tenants(id),           -- NOT NULL cho 'club'; NULL cho 'dm'
  kind text NOT NULL CHECK (kind IN ('club','dm')),
  dm_key text,                                     -- 'least(a,b):greatest(a,b)' của 2 person cho 'dm'
  archived_at timestamptz,                          -- soft-close DM (thay cho xoá member)
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((kind = 'club' AND tenant_id IS NOT NULL AND dm_key IS NULL)
      OR (kind = 'dm'   AND tenant_id IS NULL     AND dm_key IS NOT NULL)),
  UNIQUE (dm_key),                                 -- idempotent tạo DM (1 kênh/cặp)
  UNIQUE (id, tenant_id)                           -- FK target cho child (bind message/member ↔ tenant channel)
);
CREATE UNIQUE INDEX chat_channels_club_uq ON chat_channels(tenant_id) WHERE kind = 'club';

CREATE TABLE chat_members (
  channel_id uuid NOT NULL REFERENCES chat_channels(id),
  tenant_id  uuid,                                 -- = channel.tenant_id (NULL cho dm)
  person_id  uuid NOT NULL REFERENCES persons(id),
  membership_id uuid,                              -- club: NOT NULL; dm: NULL
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('member','admin')),
  last_read_at timestamptz,
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (channel_id, person_id),
  -- (a) bind member.tenant_id = channel.tenant_id (club enforce; dm tenant_id NULL → FK MATCH SIMPLE bỏ qua)
  FOREIGN KEY (channel_id, tenant_id) REFERENCES chat_channels(id, tenant_id),
  -- (b) club member phải là membership của ĐÚNG (person, tenant); dm (membership_id NULL) → không ràng
  FOREIGN KEY (membership_id, person_id, tenant_id) REFERENCES memberships(id, person_id, tenant_id),
  -- (c) shape: club ⇒ (tenant_id, membership_id) NOT NULL; dm ⇒ cả hai NULL
  CHECK ((tenant_id IS NOT NULL AND membership_id IS NOT NULL)
      OR (tenant_id IS NULL     AND membership_id IS NULL))
);

CREATE TABLE chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id uuid NOT NULL REFERENCES chat_channels(id),
  tenant_id  uuid,                                 -- = channel.tenant_id (NULL cho dm)
  author_type text NOT NULL DEFAULT 'person' CHECK (author_type IN ('person','assistant','system')),
  author_person_id uuid REFERENCES persons(id),
  membership_id uuid,                              -- club person: NOT NULL & khớp author; assistant/system: NULL
  body text NOT NULL,
  client_msg_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- Dedupe ĐỘC LẬP author (assistant/system author_person_id NULL vẫn dedupe):
  UNIQUE (channel_id, client_msg_id),
  -- (a) bind message.tenant_id = channel.tenant_id (club enforce; dm NULL → bỏ qua)
  FOREIGN KEY (channel_id, tenant_id) REFERENCES chat_channels(id, tenant_id),
  -- (b) author membership khớp ĐÚNG (author_person_id, tenant_id) khi là club person; assistant/system NULL → bỏ qua
  FOREIGN KEY (membership_id, author_person_id, tenant_id) REFERENCES memberships(id, person_id, tenant_id),
  CHECK (author_type <> 'person' OR author_person_id IS NOT NULL),  -- person ⇒ author_person_id NOT NULL
  CHECK (author_type =  'person' OR author_person_id IS NULL),      -- assistant/system ⇒ author_person_id NULL
  CHECK (author_type = 'person' OR membership_id IS NULL),          -- assistant/system: membership NULL (DD-20)
  CHECK (author_type <> 'person' OR tenant_id IS NULL OR membership_id IS NOT NULL) -- club person phải có membership
);
CREATE INDEX idx_chat_messages_channel_time ON chat_messages(channel_id, created_at);
```

> **Bind cứng:** composite FK ở trên là **defense-in-depth**, NHƯNG **không đủ một mình** — FK mặc định `MATCH SIMPLE` **bỏ qua** khi bất kỳ cột nào NULL, nên một club-child cố tình đặt `tenant_id=NULL` sẽ **lọt FK + rơi vào shape "DM"**. Vì vậy `tenant_id` của child được **bind cứng bằng trigger** (dưới): trigger **set** `NEW.tenant_id := channel.tenant_id` và assert `IS NOT DISTINCT FROM` → club-child KHÔNG thể NULL tenant, DM-child luôn NULL. FK memberships `(membership_id, person_id, tenant_id)` khoá author/member là membership của đúng person+tenant (club).

**DM "đúng 2 người" (hard guard — CHECK không đếm được row nên dùng trigger):**

```sql
-- (0) BIND tenant_id của child = channel.tenant_id (đóng lỗ FK MATCH-SIMPLE-NULL). Áp cho chat_members + chat_messages.
CREATE FUNCTION chat_bind_tenant() RETURNS trigger AS $$
DECLARE ct uuid; BEGIN
  SELECT tenant_id INTO ct FROM chat_channels WHERE id = NEW.channel_id;
  -- assert + set: club → ct NOT NULL; dm → ct NULL. IS NOT DISTINCT FROM để so cả NULL.
  IF NEW.tenant_id IS NOT NULL AND NEW.tenant_id IS DISTINCT FROM ct THEN
    RAISE EXCEPTION 'child tenant_id % != channel tenant %', NEW.tenant_id, ct;
  END IF;
  NEW.tenant_id := ct;                       -- authoritative: không cho NULL "giả DM" trên club channel
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_chat_members_bind  BEFORE INSERT OR UPDATE ON chat_members  FOR EACH ROW EXECUTE FUNCTION chat_bind_tenant();
CREATE TRIGGER trg_chat_messages_bind BEFORE INSERT OR UPDATE ON chat_messages FOR EACH ROW EXECUTE FUNCTION chat_bind_tenant();

-- (1) IMMEDIATE guard + ROW LOCK: chặn người lạ + chặn người thứ 3, serialize theo channel (chống race).
CREATE FUNCTION chat_dm_member_insert_guard() RETURNS trigger AS $$
DECLARE k text; c int; BEGIN
  -- LOCK channel row: hai txn cùng thêm member vào 1 DM sẽ tuần tự hoá (không cùng thấy count=1).
  SELECT dm_key INTO k FROM chat_channels WHERE id = NEW.channel_id AND kind = 'dm' FOR UPDATE;
  IF FOUND THEN
    IF NEW.person_id::text NOT IN (split_part(k,':',1), split_part(k,':',2)) THEN
      RAISE EXCEPTION 'DM member % not in dm_key %', NEW.person_id, k;            -- người lạ
    END IF;
    SELECT count(*) INTO c FROM chat_members WHERE channel_id = NEW.channel_id;
    IF c >= 2 THEN RAISE EXCEPTION 'DM channel already has 2 members'; END IF;      -- chặn người thứ 3
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_chat_dm_member_insert BEFORE INSERT ON chat_members
  FOR EACH ROW EXECUTE FUNCTION chat_dm_member_insert_guard();

-- (2) DEFERRABLE constraint trigger: trạng thái CUỐI TXN của DM = ĐÚNG 2 member khớp dm_key.
--     ⚠️ KHÔNG dùng 1 function chung tham chiếu cả NEW.channel_id LẪN NEW.id: mỗi trigger fire trên 1 bảng
--        và PL/pgSQL sẽ lỗi khi đọc cột không tồn tại trên row đó (chat_channels không có channel_id, và
--        chat_members không có id). Tách: 1 helper nhận channel id tường minh + 2 trigger-fn mỏng theo bảng.
CREATE FUNCTION chat_assert_dm_two(p_channel uuid) RETURNS void AS $$
DECLARE c int; k text; BEGIN
  IF (SELECT kind FROM chat_channels WHERE id = p_channel) = 'dm' THEN
    SELECT count(*) INTO c FROM chat_members WHERE channel_id = p_channel;
    IF c <> 2 THEN RAISE EXCEPTION 'DM channel % must have exactly 2 members (got %)', p_channel, c; END IF;
    SELECT string_agg(person_id::text, ':' ORDER BY person_id) INTO k
      FROM chat_members WHERE channel_id = p_channel;
    IF k <> (SELECT dm_key FROM chat_channels WHERE id = p_channel) THEN
      RAISE EXCEPTION 'DM member set % != dm_key', k; END IF;
  END IF;
END; $$ LANGUAGE plpgsql;
-- fire trên chat_members → chỉ đọc channel_id
CREATE FUNCTION chat_dm_two_from_members() RETURNS trigger AS $$
BEGIN PERFORM chat_assert_dm_two(COALESCE(NEW.channel_id, OLD.channel_id)); RETURN NULL; END; $$ LANGUAGE plpgsql;
-- fire trên chat_channels → chỉ đọc id
CREATE FUNCTION chat_dm_two_from_channel() RETURNS trigger AS $$
BEGIN PERFORM chat_assert_dm_two(COALESCE(NEW.id, OLD.id)); RETURN NULL; END; $$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER trg_chat_dm_two_members AFTER INSERT OR UPDATE OR DELETE ON chat_members
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION chat_dm_two_from_members();
CREATE CONSTRAINT TRIGGER trg_chat_dm_two_channel  AFTER INSERT OR UPDATE ON chat_channels
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION chat_dm_two_from_channel();

-- (3) DELETE guard: DM member bất biến — rời/ẩn = set chat_channels.archived_at (soft-close), KHÔNG xoá lẻ.
CREATE FUNCTION chat_dm_no_member_delete() RETURNS trigger AS $$
BEGIN
  IF (SELECT kind FROM chat_channels WHERE id = OLD.channel_id) = 'dm' THEN
    RAISE EXCEPTION 'DM members immutable; soft-close channel via archived_at';
  END IF;
  RETURN OLD;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_chat_dm_no_delete BEFORE DELETE ON chat_members
  FOR EACH ROW EXECUTE FUNCTION chat_dm_no_member_delete();
```

**Cô lập — RLS policy khả thi đã pin (thêm `chat_*` vào RLS list qua migration mới sau `0013`):**

Vì một bảng chứa **cả** club-row (`tenant_id NOT NULL`) lẫn dm-row (`tenant_id NULL`), một policy **tenant-only** sẽ **khoá mất** dm-row (fail-closed → không ai đọc được DM). Giải: **2 policy permissive** (Postgres OR chúng lại) trên mỗi bảng `chat_*`, dùng cả `app.tenant_id` lẫn `app.person_id` GUC:

```sql
-- ⚠️ DEFINER ROLE PHẢI CÓ BYPASSRLS. `SECURITY DEFINER` chỉ đổi role thực thi sang OWNER — KHÔNG tự bypass RLS.
--    Vì các bảng dùng FORCE ROW LEVEL SECURITY (RLS áp cho CẢ owner), nếu owner là NOBYPASSRLS thì:
--      · helper `chat_current_is_member` SELECT `chat_members` vẫn dưới RLS → policy DM gọi helper → ĐỆ QUY;
--      · `create_dm` INSERT vẫn bị policy chặn (chicken-and-egg không giải được).
--    Runtime `app`/`readonly` đều NOBYPASSRLS (0000_roles_extensions.sql).
--
-- ‼️ PROVISION (PRE-MIGRATION, tier SUPERUSER — KHÔNG phải migration DDL-owner). `DATABASE_URL_MIGRATION` chỉ cam
--    kết là DDL-owner (không superuser); test harness dùng superuser nên "che" lỗi này → phải test bằng migration role thật.
--    Chạy bởi superuser/admin (managed-PG console/bootstrap), production-equivalent, IDEMPOTENT + KIỂM ATTRIBUTE:
--       -- DO-block chỉ kiểm "role tồn tại" là CHƯA đủ: nếu chat_definer đã tồn tại nhưng LOGIN / NOBYPASSRLS /
--       -- SUPERUSER / CREATEROLE thì bootstrap vẫn cấp table grants cho một role sai attribute (LOGIN+BYPASSRLS
--       -- đặc biệt nguy hiểm). Phải chuẩn hoá về exact attributes HOẶC fail-closed sau khi đọc pg_roles.
--       DO $$
--       DECLARE r record;
--       BEGIN
--         SELECT rolcanlogin, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole, rolinherit, rolreplication
--           INTO r FROM pg_roles WHERE rolname = 'chat_definer';
--         IF NOT FOUND THEN
--           CREATE ROLE chat_definer NOLOGIN NOSUPERUSER BYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION;
--         ELSIF r.rolcanlogin OR r.rolsuper OR (NOT r.rolbypassrls) OR r.rolcreatedb OR r.rolcreaterole
--               OR r.rolinherit OR r.rolreplication THEN
--           -- FAIL-CLOSED (mặc định): role đã tồn tại với BẤT KỲ attribute thừa → dừng, điều tra (tránh cấp table cho role sai).
--           -- Kiểm ĐỦ bộ: login, super, bypassrls(phải TRUE), createdb, createrole, inherit(phải FALSE), replication(phải FALSE).
--           RAISE EXCEPTION 'chat_definer unexpected attrs (login=% super=% bypassrls=% createdb=% createrole=% inherit=% replication=%) — refuse bootstrap',
--             r.rolcanlogin, r.rolsuper, r.rolbypassrls, r.rolcreatedb, r.rolcreaterole, r.rolinherit, r.rolreplication;
--           -- Hoặc CHUẨN HOÁ (bootstrap có kiểm soát, cần superuser): ALTER ROLE chat_definer NOLOGIN NOSUPERUSER BYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION;
--         END IF;
--       END $$;
--       -- PG16: gán BYPASSRLS cần **superuser HOẶC role đã có BYPASSRLS** (+ CREATEROLE) — CREATEROLE thường KHÔNG đủ.
--       GRANT chat_definer TO <migration_owner_role>;   -- để migration được SET ROLE + ALTER … OWNER TO chat_definer
--       GRANT USAGE ON SCHEMA public TO chat_definer;    -- runtime: function chạy như chat_definer, truy cập bảng public
--    Migration DDL-owner sau đó: tạo function + ALTER OWNER + GRANT table privileges.
--    ⚠️ PG16 `ALTER FUNCTION … OWNER TO chat_definer`: owner mới phải có **CREATE trên schema** chứa function.
--       Fresh PG15+/PG16 KHÔNG cấp `CREATE ON SCHEMA public` mặc định → phải grant tạm rồi revoke (least-privilege):
--         GRANT CREATE ON SCHEMA public TO chat_definer;      -- chỉ để nhận ownership
--         ALTER FUNCTION chat_current_is_member(uuid) OWNER TO chat_definer;
--         ALTER FUNCTION create_dm(uuid) OWNER TO chat_definer;
--         ALTER FUNCTION mark_read(uuid) OWNER TO chat_definer;
--         REVOKE CREATE ON SCHEMA public FROM chat_definer;   -- runtime KHÔNG cần CREATE (giữ USAGE)
--    Nếu chat_definer chưa provision → migration FAIL sớm (fail-closed), không im lặng chạy dưới NOBYPASSRLS.

-- Helper: CHỈ dùng CURRENT person (không nhận person tùy ý → không membership oracle).
CREATE FUNCTION chat_current_is_member(p_channel uuid) RETURNS boolean
  LANGUAGE sql SECURITY DEFINER STABLE SET search_path = pg_catalog, public AS $$
  SELECT EXISTS (SELECT 1 FROM chat_members
                 WHERE channel_id = p_channel
                   AND person_id = current_setting('app.person_id', true)::uuid);
$$;
-- (OWNER TO chat_definer làm ở BLOCK CHUYỂN OWNER cuối — sau khi có GRANT CREATE ON SCHEMA, xem dưới)
REVOKE ALL ON FUNCTION chat_current_is_member(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION chat_current_is_member(uuid) TO app;   -- chỉ role runtime app

-- chat_channels
ALTER TABLE chat_channels ENABLE ROW LEVEL SECURITY;  ALTER TABLE chat_channels FORCE ROW LEVEL SECURITY;
CREATE POLICY chat_channels_club ON chat_channels USING (
  tenant_id IS NOT NULL AND tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY chat_channels_dm ON chat_channels USING (
  tenant_id IS NULL AND chat_current_is_member(id));

-- chat_members
ALTER TABLE chat_members ENABLE ROW LEVEL SECURITY;   ALTER TABLE chat_members FORCE ROW LEVEL SECURITY;
CREATE POLICY chat_members_club ON chat_members USING (
  tenant_id IS NOT NULL AND tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY chat_members_dm ON chat_members USING (
  tenant_id IS NULL AND chat_current_is_member(channel_id));

-- chat_messages: USING (đọc) + WITH CHECK (ghi) — author phải LÀ current person (chống mạo danh trong DM/club).
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;  ALTER TABLE chat_messages FORCE ROW LEVEL SECURITY;
-- ⚠️ WITH CHECK BẮT BUỘC author_type='person' + author = current person cho CẢ club LẪN dm:
--    nếu để "author_type <> 'person' OR ..." thì runtime user có thể ghi message author_type='assistant'/'system'
--    (mạo danh trợ lý). Message assistant/system CHỈ được ghi qua đường SECURITY DEFINER của bot (P7), KHÔNG qua
--    role app dưới RLS thường.
CREATE POLICY chat_messages_club ON chat_messages
  USING      (tenant_id IS NOT NULL AND tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id IS NOT NULL AND tenant_id = current_setting('app.tenant_id', true)::uuid
              AND author_type = 'person' AND author_person_id = current_setting('app.person_id', true)::uuid);
CREATE POLICY chat_messages_dm ON chat_messages
  USING      (tenant_id IS NULL AND chat_current_is_member(channel_id))
  WITH CHECK (tenant_id IS NULL AND chat_current_is_member(channel_id)
              AND author_type = 'person' AND author_person_id = current_setting('app.person_id', true)::uuid);
```

**Bootstrap mutations qua SECURITY DEFINER (RLS chicken-and-egg):** dưới FORCE RLS, member đầu tiên của một DM chưa tồn tại → policy `chat_members_dm`/`chat_channels_dm` (yêu cầu đã là member) sẽ **chặn chính bước tạo**. Nên **mọi mutation channel/member đi qua SECURITY DEFINER RPC**, **OWNER = `chat_definer` (BYPASSRLS)** — chỉ khi owner có BYPASSRLS thì SECURITY DEFINER mới thực sự thoát FORCE RLS (SECURITY DEFINER *một mình* không bypass). RPC tự enforce authz trong code; RLS `USING` chỉ lo **đọc**. Quyền bảng được pin (revoke DML thẳng khỏi `app`, chỉ RPC + SELECT) để contract "mutation qua RPC" là **enforce**, không phải prose. Tin nhắn (`chat_messages`) vẫn ghi trực tiếp dưới RLS `WITH CHECK` (member đã tồn tại lúc gửi).

```sql
-- Tạo DM nguyên tử: caller (current person) phải là 1 trong 2; tạo channel + ĐÚNG 2 member trong 1 txn.
CREATE FUNCTION create_dm(p_other uuid) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE me uuid := current_setting('app.person_id', true)::uuid; a uuid; b uuid; k text; ch uuid; BEGIN
  IF me IS NULL OR p_other IS NULL OR me = p_other THEN RAISE EXCEPTION 'invalid DM participants'; END IF;
  a := least(me, p_other); b := greatest(me, p_other); k := a || ':' || b;
  INSERT INTO chat_channels(kind, dm_key) VALUES ('dm', k)
    ON CONFLICT (dm_key) DO NOTHING RETURNING id INTO ch;              -- idempotent
  IF ch IS NULL THEN SELECT id INTO ch FROM chat_channels WHERE dm_key = k; RETURN ch; END IF;
  INSERT INTO chat_members(channel_id, person_id) VALUES (ch, a), (ch, b);  -- đúng 2, khớp dm_key
  RETURN ch;                                                          -- deferred exactly-2 verify ở COMMIT
END; $$;
-- (OWNER TO chat_definer làm ở BLOCK CHUYỂN OWNER cuối)
REVOKE ALL ON FUNCTION create_dm(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION create_dm(uuid) TO app;
-- Tương tự: create_club_channel(tenant) + add_club_member/remove_club_member là SECURITY DEFINER OWNER chat_definer
-- (authz owner/admin trong code).

-- ⚠️ chat_definer PHẢI được cấp TABLE PRIVILEGES: BYPASSRLS chỉ bỏ qua RLS policy, KHÔNG thay grant bảng.
--    Role tạo mới không có privilege mặc định (0000_roles_extensions.sql) → thiếu grant thì helper SELECT /
--    create_dm INSERT sẽ 'permission denied'. Owner bảng (migration role) cấp:
GRANT SELECT, INSERT, UPDATE, DELETE ON chat_channels, chat_members TO chat_definer;
GRANT SELECT                         ON chat_messages              TO chat_definer;  -- (bot P7 dùng INSERT riêng)

-- Cập nhật read-state: KHÔNG dùng GRANT UPDATE(last_read_at) trực tiếp — policy hiện tại cho member sửa
-- last_read_at của NGƯỜI KHÁC trong cùng DM/tenant. Dùng RPC khoá theo current person.
CREATE FUNCTION mark_read(p_channel uuid) RETURNS void
  LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  UPDATE chat_members SET last_read_at = now()
   WHERE channel_id = p_channel AND person_id = current_setting('app.person_id', true)::uuid;
$$;
REVOKE ALL ON FUNCTION mark_read(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION mark_read(uuid) TO app;

-- BLOCK CHUYỂN OWNER (câu lệnh THẬT, đúng thứ tự): GRANT CREATE TRƯỚC ALTER đầu → 3 ALTER → REVOKE CREATE SAU ALTER cuối.
-- (Chạy bởi migration owner; owner phải sở hữu schema public để GRANT/REVOKE trên nó — nếu không, làm ở pre-provision superuser.)
GRANT USAGE, CREATE ON SCHEMA public TO chat_definer;   -- PG16: owner mới cần CREATE trên schema mới nhận được ownership
ALTER FUNCTION chat_current_is_member(uuid) OWNER TO chat_definer;
ALTER FUNCTION create_dm(uuid)              OWNER TO chat_definer;
ALTER FUNCTION mark_read(uuid)              OWNER TO chat_definer;
REVOKE CREATE ON SCHEMA public FROM chat_definer;       -- giữ USAGE (runtime); bỏ CREATE (least-privilege)

-- PIN QUYỀN BẢNG cho `app` (nếu không revoke, "mọi mutation qua RPC" chỉ là prose — app vẫn DML thẳng được):
-- Cấu trúc channel/member + read-state CHỈ đổi qua RPC (definer). App KHÔNG có UPDATE/DELETE trên chat_members.
REVOKE INSERT, UPDATE, DELETE ON chat_channels, chat_members FROM app;
GRANT  SELECT ON chat_channels, chat_members TO app;                  -- đọc; ghi/last_read qua RPC
-- Tin nhắn: app được SELECT + INSERT (dưới RLS WITH CHECK author = current person); KHÔNG UPDATE/DELETE (immutable phase-1).
REVOKE UPDATE, DELETE ON chat_messages FROM app;
GRANT  SELECT, INSERT ON chat_messages TO app;
```

> **Đóng các đường fail-open (review):** (1) `chat_bind_tenant` set/assert `tenant_id` = channel → club-child không thể NULL "giả DM" (FK MATCH SIMPLE không đủ); (2) deferred check trên **cả** `chat_channels` → DM 0-member vẫn bị bắt ở COMMIT; (3) `FOR UPDATE` khoá channel row → hai insert đồng thời không cùng thấy count=1; (4) helper chỉ đọc **current person** + `REVOKE PUBLIC`/`GRANT app` → không phải membership oracle; (5) `WITH CHECK author_type='person' AND author_person_id = app.person_id` (**cả club lẫn dm**) → không ghi message mạo danh, không tự tạo assistant/system message; (6) DB CHECK `assistant/system ⇒ author_person_id IS NULL`; (7) constraint trigger tách 2 function theo bảng (không tham chiếu cột chéo → không lỗi runtime); (8) `create_dm()` SECURITY DEFINER bootstrap DM (RLS không tự chặn bước tạo); (9) **definer functions OWNER = `chat_definer` (BYPASSRLS)** — SECURITY DEFINER một mình KHÔNG thoát FORCE RLS; (10) **`chat_definer` được GRANT table privileges** (BYPASSRLS bỏ qua policy nhưng KHÔNG thay grant bảng — thiếu grant → permission denied); (11) **pin quyền `app`** (revoke DML thẳng, chỉ RPC + SELECT + INSERT message) và **read-state qua `mark_read()` RPC** khoá theo current person (bỏ `GRANT UPDATE(last_read_at)` vốn cho sửa read-state của member khác).

- `chat_channels(kind='club')`, club `chat_members`/`chat_messages(tenant_id NOT NULL)` = **tenant-private** (template `feature_multi_tenant_tech.md §3`), cô lập cross-tenant (NFR-S1).
- `chat_channels(kind='dm')` + DM rows = **person-self**: chỉ 2 person ∈ `chat_members` đọc/ghi (policy (b) + DM 2-member guard ở trên). App phải set `app.person_id` cho đường person-self (giống `resolvePersonSelf`, identity §7).
- **Public projection KHÔNG bao giờ chứa chat** (NFR-S2). Không có projector kênh ngoài (CO-7).

### Edge Cases (Backend)

| # | Category | Case | Xử lý |
|---|----------|------|-------|
| 1 | Security | Non-member gửi/đọc club channel | ❌ Reject — authz `chat_members` + RLS tenant |
| 2 | Security | DM: người thứ 3 đọc | ❌ NEVER — chỉ 2 person trong `chat_members` (person-self) |
| 3 | Security | Cross-tenant club chat leak | ❌ NEVER — RLS fail-closed; test bất biến cô lập |
| 4 | Concurrency | Double-send (retry cùng client_msg_id) | UNIQUE(channel_id, client_msg_id) → trả message cũ, no dup; **dedupe cả assistant/system** (author NULL) vì không phụ thuộc author |
| 4b | Data Integrity | DM thêm người thứ 3 (ghi) | ❌ Trigger `chat_dm_members_guard` chặn — DM đúng 2 member khớp `dm_key` |
| 5 | Anti-spam | Flood messages | Rate-limit per (person, channel) + max_count/window; 429 |
| 6 | Anti-spam | Message quá dài / media lớn | Cap size (text; media/emoji tối thiểu phase-1) — reject over cap |
| 7 | Security | Bridge ra Zalo/Messenger | ❌ NEVER phase-1 — không có projector kênh ngoài (CO-7) |
| 8 | Realtime | Topic guessing (SSE) | AuthZ per subscription — reject unauthorized (giống sync engine §3) |
| 9 | Data Integrity | Assistant/system message (DD-20) | `author_type≠'person'` → `membership_id` NULL (CHECK) |
| 10 | Cross-Feature | Account merge → chat authorship | Re-parent `author_person_id`/members về canonical person (identity merge) |
| 11 | Data Integrity | DM tạo trùng cho cùng cặp | `dm_key` normalized + UNIQUE — 1 kênh/cặp, idempotent |
| 12 | Security | Member rời CLB vẫn đọc club chat | Membership `left` → mất quyền club channel (authz theo membership active) |

---

## 3. API Contract — proposal

| Method | Path | Auth | Mô tả |
|--------|------|------|-------|
| GET | /api/chat/channels | Authenticated Person | Kênh của tôi (club của các tenant tôi là member + DM) |
| GET | /api/chat/channels/:id/messages | Member of channel | Lịch sử (phân trang, cursor) |
| POST | /api/chat/channels/:id/messages | Member of channel | Gửi message `{client_msg_id, body}` (idempotent) |
| POST | /api/chat/dm | Authenticated Person | Mở/lấy DM với `personId` (idempotent theo `dm_key`) |
| POST | /api/chat/channels/:id/read | Member of channel | Cập nhật `last_read_at` |
| GET | /api/chat/subscribe | Authenticated | SSE — topic `tenant:<id>:chat:<channel>` (club) / `person:<id>:chat` (dm) |

### Realtime Authorization (reuse DD-07 / sync engine §3)

```text
Topic tenant:<id>:chat:<channel> → requires club membership (RLS tenant) + chat_members
Topic person:<id>:chat          → requires authenticated person == <id> (person-self)
```

### Error Codes

| Code | Error Code | Message | Trigger |
|------|-----------|---------|---------|
| 403 | `CHAT_FORBIDDEN` | Không có quyền trong kênh này | Not a member / wrong tenant |
| 409 | `CHAT_DUP_MESSAGE` (200-safe) | — | Duplicate `client_msg_id` → trả message cũ |
| 413 | `CHAT_MESSAGE_TOO_LARGE` | Tin nhắn quá dài | Over size cap |
| 429 | `CHAT_RATE_LIMITED` | Gửi quá nhanh — thử lại | Anti-spam limit |

### Rate Limits

| Endpoint | Limit | Scope |
|----------|-------|-------|
| POST message | 20/10s (burst), 300/min | Per (person, channel) |
| POST /chat/dm | 30/min | Per person |

---

## 4. Chi tiết triển khai — proposal

### Send pipeline

```text
Validate member + rate-limit → INSERT chat_messages (ON CONFLICT client_msg_id → return existing)
    → pg NOTIFY 'chat_<channel>' (payload = message id, không PII)
    → SSE dispatcher đọc canonical message, đẩy tới subscribers authorized
```

Message body escape/sanitize; text phase-1 (media/emoji tối thiểu). NOTIFY payload **không** chứa body/PII — subscriber refetch canonical dưới authz.

### Trợ lý tái dùng (DD-19 pha B, DD-20 — P7, ngoài phase-1)

Khi trợ lý bật: bot-participant phát ngôn trong `chat_channels(kind='club')` với `author_type='assistant'`, `membership_id=NULL`, log ở `bot_queries` (Club Assistant). **Không** tạo model chat song song — cùng bộ bảng `chat_*`. Grounding trợ lý vẫn chỉ KB (DD-21). Đây là lý do dựng `chat_*` sớm ở P4 (DD-38) thay vì đợi P7.

---

## 5. Testing Plan — proposal

### Unit / Integration (test bất biến DD-38)

| # | Test | Expected |
|---|------|----------|
| 1 | Club chat cross-tenant | Tenant A message không hiện ở tenant B (RLS) |
| 2 | DM 2-person only | Person thứ 3 không đọc được |
| 3 | Non-member post | 403 `CHAT_FORBIDDEN` |
| 4 | Duplicate client_msg_id | 1 message, trả cũ (idempotent) |
| 5 | Rate-limit flood | 429 sau ngưỡng |
| 6 | Size cap | 413 khi vượt |
| 7 | No external bridge | Message không xuất hiện ở Zalo/Messenger (không projector kênh ngoài) |
| 8 | SSE topic authz | person:other / tenant khác → rejected |
| 9 | Assistant message shape | `author_type='assistant'` → `membership_id` NULL (CHECK) |
| 10 | DM idempotent | Mở DM 2 lần cùng cặp → 1 channel (`dm_key`) |
| 11 | Merge re-parent | Merge 2 person → authorship/members hội tụ canonical |
| 12 | Left member loses club chat | Membership `left` → 403 |
| 13 | **DM bootstrap** | `create_dm(other)` (RLS bật) → tạo channel + 2 member OK; gọi lại cùng cặp → cùng channel (idempotent). Input xấu `create_dm(self)`/`create_dm(NULL)` → reject (caller LUÔN là 1 trong 2 nên không test "ngoài cặp") |
| 14 | **Shared-trigger execution** | INSERT `chat_channels(kind='dm')` không kèm 2 member trong txn → **FAIL ở COMMIT** (trigger `chat_channels` chạy, KHÔNG lỗi "field channel_id not found"); club channel/message không bị trigger DM đụng |
| 15 | **Assistant/system spoof** | Role `app` (dưới RLS) INSERT message `author_type='assistant'`/`'system'` → **rejected** (WITH CHECK); chỉ đường SECURITY DEFINER của bot ghi được |
| 16 | **Author spoof** | Member DM/club ghi message với `author_person_id` = người khác → rejected (WITH CHECK) |
| 17 | **Nullable-tenant giả DM** | Club message/member cố đặt `tenant_id=NULL` → `chat_bind_tenant` set lại = tenant channel (không lọt shape DM) |
| 18 | **DM member immutable** | DELETE 1 member của DM → rejected; thêm người thứ 3 → rejected (insert guard + deferred) |
| 19 | **create_dm dưới FORCE RLS (role `app` THẬT)** | `SET ROLE app` + set `app.person_id` → `create_dm(other)` **chạy OK** (definer OWNER BYPASSRLS + có table grant); tạo channel + 2 member. Input xấu: `create_dm(self)` hoặc `create_dm(NULL)` → reject `invalid DM participants` (caller LUÔN là 1 trong 2 nên không test "ngoài cặp") |
| 20 | **Direct DML bị chặn (role `app`)** | `app` INSERT/UPDATE/DELETE **thẳng** `chat_channels`/`chat_members` → **permission denied** (đã revoke, gồm cả `UPDATE(last_read_at)`); chỉ `create_dm`/`mark_read`/RPC làm được. Read-state chỉ qua `mark_read(channel)` |
| 21 | **Helper không đệ quy (role `app`)** | SELECT DM dưới RLS (policy gọi `chat_current_is_member`) → trả kết quả, **không** stack-overflow/recursion (helper OWNER BYPASSRLS đọc `chat_members` ngoài RLS) |
| 22 | **Assistant/system direct insert (role `app`)** | `app` INSERT `chat_messages` `author_type='assistant'`/`'system'` → **rejected** (WITH CHECK); chỉ đường definer/bot ghi được |
| 23 | **chat_definer thiếu grant** | Nếu quên `GRANT … TO chat_definer` → `create_dm`/helper báo **permission denied** (regression: BYPASSRLS không thay table privilege) |
| 24 | **Read-state isolation** | `app` gọi `mark_read(channel)` → chỉ cập nhật `last_read_at` của **chính mình**; KHÔNG có đường sửa `last_read_at` của member khác (đã revoke `UPDATE ON chat_members` khỏi app) |
| 25 | **Provision bằng MIGRATION ROLE thật (không superuser)** | Chạy migration DDL dưới `DATABASE_URL_MIGRATION` (DDL-owner, NOSUPERUSER): (a) `CREATE ROLE … BYPASSRLS` do migration role → **FAIL** (PG16: cần superuser hoặc role có BYPASSRLS+CREATEROLE); (b) khi `chat_definer` đã pre-provision + `GRANT chat_definer TO migration_owner` → `CREATE FUNCTION` + `ALTER … OWNER TO chat_definer` + GRANT table **chạy OK**; (c) thiếu pre-provision → migration FAIL sớm. Test harness **không** được dùng superuser để "che" |
| 26 | **ALTER OWNER thiếu CREATE ON SCHEMA (PG16)** | Fresh PG16 (public không cấp CREATE mặc định): `ALTER FUNCTION … OWNER TO chat_definer` khi chat_definer **chưa** có `CREATE ON SCHEMA public` → **FAIL**; sau `GRANT CREATE … TO chat_definer` → OK; `REVOKE CREATE` sau đó không phá runtime (chỉ cần USAGE) |
| 27 | **Pre-provision idempotent + attribute check ĐỦ BỘ** | Re-run với chat_definer đúng exact attributes → **no-op**; `CREATE ROLE` thuần (không guard) → FAIL "already exists". **chat_definer tồn tại với BẤT KỲ attribute thừa** — `LOGIN`, `NOBYPASSRLS`, `SUPERUSER`, `CREATEDB`, `CREATEROLE`, **`INHERIT`**, hoặc **`REPLICATION`** → DO-block **RAISE fail-closed**, KHÔNG cấp table grants. Từng attribute phải có case riêng (regression: thiếu kiểm `rolinherit`/`rolreplication` → role privilege thừa vẫn lọt validation) |

---

## 6. Rollout Plan + Changelog

### Rollout (khi DD-38 ✅)

0. **PRE-PROVISION (tier superuser, production-equivalent, TRƯỚC migration):** idempotent DO-block `CREATE ROLE chat_definer NOLOGIN NOSUPERUSER BYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION` + **kiểm exact attributes** (login/super/bypassrls/createdb/createrole/inherit/replication) → fail-closed nếu role đã tồn tại sai (BYPASSRLS: **superuser** hoặc role đã có BYPASSRLS + CREATEROLE — PG16) + `GRANT chat_definer TO <migration_owner_role>` (SET ROLE) + `GRANT USAGE ON SCHEMA public TO chat_definer` (runtime). **KHÔNG** đặt trong migration DDL-owner.
1. **Migration mới sau `0013`** (`0014+`) tạo `chat_*` + functions (`chat_current_is_member`/`create_dm`/`mark_read`); **`GRANT CREATE ON SCHEMA public TO chat_definer`** (PG16: owner mới cần CREATE trên schema; fresh PG15+ không cấp mặc định) → `ALTER … OWNER TO chat_definer` (cả 3) → **`REVOKE CREATE ON SCHEMA public FROM chat_definer`** (giữ USAGE); + GRANT table (chat_definer + app) + thêm vào RLS list (KHÔNG sửa `0009`). **Chạy/kiểm bằng migration role thật (không superuser)** để bắt gap provision. Test bất biến cô lập xanh.
2. Club channel (1 kênh/tenant) — send/read + SSE.
3. DM 1-1 (person-self, bootstrap qua `create_dm`) + anti-spam.
4. (P7) Trợ lý bot-participant tái dùng `chat_*` (DD-19/20).

### Changelog

| Date | Version | Thay đổi |
|---|---|---|
| 2026-07-10 | v0.1 | Draft khởi tạo (DD-38 🟡): schema đề xuất `chat_channels/messages/members`, RLS tenant cho club + person-self cho DM, SSE reuse DD-07, idempotency `client_msg_id`, anti-spam; note trợ lý DD-19/20 tái dùng ở P7; không bridge kênh ngoài (CO-7). |
| 2026-07-10 | v0.2 | **DD-38 ✅ + hard-constraint (review fix):** DM guard nay là **DDL thật** — DEFERRABLE constraint trigger đảm bảo trạng thái cuối = ĐÚNG 2 member khớp `dm_key` (không chỉ chặn insert thứ 3), delete guard (member bất biến, soft-close qua `archived_at`). Bind cứng bằng composite FK: `message/member.tenant_id` = tenant channel `(channel_id,tenant_id)→chat_channels(id,tenant_id)`, và author/member membership khớp `(membership_id,person_id,tenant_id)→memberships`. RLS child (`chat_members`/`chat_messages`) policy TƯỜNG MINH + helper SECURITY DEFINER (chống đệ quy RLS). |
| 2026-07-10 | v0.3 | **Đóng 5 đường fail-open (review):** (1) trigger `chat_bind_tenant` set/assert `tenant_id := channel.tenant_id` (`IS NOT DISTINCT FROM`) — club-child không thể NULL "giả DM" (FK MATCH SIMPLE không đủ); (2) deferred exactly-2 gắn trên **cả `chat_channels`** — DM 0-member cũng bị bắt ở COMMIT; (3) `SELECT … FOR UPDATE` khoá channel row trong insert guard — chống race 2 txn cùng thấy count=1; (4) helper đổi thành `chat_current_is_member(channel)` chỉ dùng **current person** + `REVOKE PUBLIC` / `GRANT app` — không còn membership oracle; (5) policy `chat_messages` thêm `WITH CHECK author_person_id = app.person_id` — chống ghi message mạo danh. |
| 2026-07-11 | v0.4 | **Round-2 fix (review):** (a) constraint trigger tách 2 function theo bảng (`chat_dm_two_from_members`/`_from_channel` + helper `chat_assert_dm_two`) — bỏ `COALESCE(NEW.channel_id, NEW.id)` gây lỗi runtime khi trigger chạy trên `chat_channels`; (b) thêm `create_dm()` SECURITY DEFINER (bootstrap DM vì RLS chặn chính bước tạo member đầu) + note mutation channel/member qua SECURITY DEFINER RPC; (c) club `WITH CHECK` nay bắt buộc `author_type='person' AND author = app.person_id` (bỏ escape `author_type<>'person'`) — role app không tự tạo assistant/system message; (d) thêm DB CHECK `assistant/system ⇒ author_person_id IS NULL`; (e) test §5 thêm case 13–18 (DM bootstrap, shared-trigger execution, assistant/system spoof, author spoof, nullable-tenant, DM immutable). |
| 2026-07-11 | v0.5 | **Round-3 fix (review) — SECURITY DEFINER contract enforce được:** (a) tạo definer role **`chat_definer NOLOGIN BYPASSRLS`** + `ALTER FUNCTION chat_current_is_member / create_dm OWNER TO chat_definer` — vì bảng FORCE RLS áp cho cả owner, `SECURITY DEFINER` một mình KHÔNG bypass (runtime `app`/`readonly` = NOBYPASSRLS → helper đệ quy + `create_dm` vẫn bị chặn); (b) **pin quyền bảng**: `REVOKE INSERT/UPDATE/DELETE ON chat_channels, chat_members FROM app` + `GRANT SELECT` (+ `UPDATE(last_read_at)`); `chat_messages`: `GRANT SELECT, INSERT`, revoke UPDATE/DELETE → "mutation qua RPC" là enforce chứ không prose; (c) test §5 thêm case 19–22 (create_dm dưới FORCE RLS role app thật, direct DML bị chặn, helper không đệ quy, assistant/system direct insert bị chặn). |
| 2026-07-11 | v0.6 | **Round-4 fix (review):** (a) **`GRANT SELECT,INSERT,UPDATE,DELETE ON chat_channels,chat_members TO chat_definer`** (+ SELECT chat_messages) — BYPASSRLS KHÔNG thay table grant; role mới không có privilege mặc định → thiếu grant thì helper/`create_dm` `permission denied`; (b) bỏ `GRANT UPDATE(last_read_at) ON chat_members TO app` (cho member sửa read-state của người khác trong cùng DM/tenant) → thay bằng **`mark_read(channel)` SECURITY DEFINER** khoá theo `app.person_id`; `app` không còn UPDATE trên chat_members; (c) sửa test 19 (bỏ nhánh "caller ∉ cặp" bất khả — `create_dm` luôn dựng cặp từ current person; thay bằng `create_dm(self/NULL)` → reject) + thêm test 23 (thiếu grant chat_definer) & 24 (read-state isolation qua mark_read). |
| 2026-07-11 | v0.7 | **Round-5 fix (review):** (a) **`chat_definer BYPASSRLS` phải PRE-PROVISION ở tier SUPERUSER** (không phải `DATABASE_URL_MIGRATION` DDL-owner): `CREATE ROLE … BYPASSRLS` chỉ superuser đặt được + `GRANT chat_definer TO migration_owner` để migration `ALTER … OWNER TO` được; migration DDL-owner chỉ tạo function + ALTER OWNER + GRANT bảng; thiếu pre-provision → migration FAIL sớm (không im lặng chạy NOBYPASSRLS). (b) **Test 25: chạy provisioning bằng migration role THẬT** (không superuser) để bắt gap này (test harness đừng dùng superuser che). (c) Sửa test **13** (vẫn còn "caller không thuộc cặp" bất khả) và test **20** (`UPDATE(last_read_at) OK` → nay đã revoke, read-state chỉ qua `mark_read`). |
| 2026-07-11 | v0.8 | **Round-6 fix (review, PG16 chính xác):** (a) **`ALTER FUNCTION … OWNER TO chat_definer` cần owner mới có `CREATE ON SCHEMA public`** — PG15+/PG16 KHÔNG cấp `CREATE public` mặc định → `GRANT chat_definer TO migration_owner` (SET ROLE) là **chưa đủ**; thêm bracket `GRANT CREATE ON SCHEMA public TO chat_definer` → ALTER OWNER (cả 3) → `REVOKE CREATE` (giữ USAGE, least-privilege). (b) role-creation block nay **idempotent** (`DO … IF NOT EXISTS`, không `CREATE ROLE` thuần), + wording PG16 đúng: gán BYPASSRLS cần **superuser hoặc role đã có BYPASSRLS (+CREATEROLE)**. (c) test 26 (ALTER OWNER thiếu CREATE ON SCHEMA → FAIL) + test 27 (idempotent re-run). |
| 2026-07-11 | v0.9 | **Round-7 fix (review, SQL chạy được thật):** (a) **`GRANT/REVOKE CREATE ON SCHEMA public` nay là câu lệnh THẬT, đúng thứ tự** — gom 3 `ALTER FUNCTION … OWNER` vào **BLOCK CHUYỂN OWNER** cuối, bracket bởi GRANT CREATE (trước ALTER đầu) và REVOKE CREATE (sau ALTER cuối); bỏ ALTER OWNER rải rác inline (trước đây chạy TRƯỚC grant → copy/chạy dưới migration role sẽ fail). (b) **DO-block kiểm ATTRIBUTE, không chỉ existence**: nếu chat_definer tồn tại với LOGIN/NOBYPASSRLS/SUPERUSER/CREATEROLE → **RAISE fail-closed** (LOGIN+BYPASSRLS nguy hiểm khi nhận table grants); kèm option chuẩn hoá `ALTER ROLE`. (c) test 27 mở rộng: attribute sai → fail-closed. |
| 2026-07-11 | v0.10 | **Round-8 fix (review, attribute check ĐỦ BỘ):** DO-block trước chỉ kiểm login/super/bypassrls/createdb/createrole → role thừa **`INHERIT`** hoặc **`REPLICATION`** vẫn lọt. Thêm `rolinherit, rolreplication` vào `SELECT` + điều kiện `ELSIF` (inherit phải FALSE, replication phải FALSE); `CREATE ROLE`/normalize thêm **`NOINHERIT NOREPLICATION`**; RAISE log đủ 7 field. Test 27 mở rộng phủ INHERIT/REPLICATION. |
