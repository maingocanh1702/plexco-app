import { randomUUID } from "node:crypto";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupRlsTestContext, type RlsTestContext } from "./test-harness.js";

/**
 * Migration 0063 section 1: the table/grant half of DT-27 and DT-31 of
 * docs/sessions/web-mvp-phase3-readiness-p3-m10-chat-core.md (4.3, 4.4, V-13, RO-S11-1).
 * Fixture bodies are one neutral character; no test prints row data.
 */
const TEST_DB_NAME = "plexco_chat_catalog_check";
const NEW_TABLES = ["chat_command_receipts", "chat_message_revisions", "chat_moderation_audit"];
const APP_COLUMNS = [
  "id",
  "channel_id",
  "tenant_id",
  "author_type",
  "author_person_id",
  "membership_id",
  "reply_to_message_id",
  "edited_at",
  "edit_count",
  "author_deleted_at",
  "moderation_state",
  "moderation_updated_at",
  "client_msg_id",
  "created_at",
];

let ctx: RlsTestContext;
let person: string;
let channel: string;
let message: string;

async function insertId(text: string, values: unknown[]): Promise<string> {
  return ((await ctx.owner.query(text, values)).rows[0] as { id: string }).id;
}

/** One app-role transaction with app.tenant_id and app.person_id set, always rolled back. */
async function asApp(text: string, values: unknown[] = []): Promise<pg.QueryResult> {
  const client = await ctx.appPool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "SELECT set_config('app.tenant_id', $1, true), set_config('app.person_id', $2, true)",
      [ctx.tenantA, person],
    );
    return await client.query(text, values);
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
}

/** Sorted in JS so the database collation never decides the order. */
const keys = (rows: unknown[]): string[] => (rows as { k: string }[]).map((r) => r.k).sort();
const cols = (who: string, table: string, priv: string, names: string[]): string[] =>
  names.map((c) => [who, table, priv, c].join(":"));

beforeAll(async () => {
  ctx = await setupRlsTestContext(TEST_DB_NAME);
  person = await insertId(`INSERT INTO persons (display_name) VALUES ('catalog') RETURNING id`, []);
  const membership = await insertId(
    `INSERT INTO memberships (tenant_id, person_id, status) VALUES ($1, $2, 'active') RETURNING id`,
    [ctx.tenantA, person],
  );
  // Non-default channel: a membership-provisioned default channel can never collide with it.
  channel = await insertId(
    `INSERT INTO chat_channels
       (tenant_id, kind, title, is_default, sort_order, creation_origin, post_policy, assistant_enabled)
     VALUES ($1, 'club', 'catalog', false, 1, 'system_bootstrap', 'all_members', false) RETURNING id`,
    [ctx.tenantA],
  );
  await ctx.owner.query(
    `INSERT INTO chat_members (channel_id, person_id, membership_id) VALUES ($1, $2, $3)`,
    [channel, person, membership],
  );
  message = await insertId(
    `INSERT INTO chat_messages (channel_id, author_person_id, membership_id, body, client_msg_id)
     VALUES ($1, $2, $3, 'x', $4) RETURNING id`,
    [channel, person, membership, randomUUID()],
  );
}, 120_000);

afterAll(async () => {
  await ctx?.teardown();
});

describe("0063 section 1: append-only tables and grants (DT-27)", () => {
  it("the three tables exist with ENABLE + FORCE RLS", async () => {
    const { rows } = await ctx.owner.query(
      `SELECT relname::text AS k FROM pg_class
       WHERE relnamespace = 'public'::regnamespace AND relname::text = ANY($1::text[])
         AND relrowsecurity AND relforcerowsecurity`,
      [NEW_TABLES],
    );
    expect(keys(rows)).toEqual(NEW_TABLES);
  });

  it("one tenant_isolation policy on each tenant_id table, none on chat_message_revisions (RO-S11-1)", async () => {
    const { rows } = await ctx.owner.query(
      `SELECT concat_ws(':', tablename, policyname) AS k FROM pg_policies
       WHERE schemaname = 'public' AND tablename::text = ANY($1::text[])`,
      [NEW_TABLES],
    );
    expect(keys(rows)).toEqual([
      "chat_command_receipts:tenant_isolation",
      "chat_moderation_audit:tenant_isolation",
    ]);
  });

  it("chat_definer holds exactly INSERT and SELECT on each new table; no other grantee", async () => {
    const { rows } = await ctx.owner.query(
      `SELECT concat_ws(':', tp.grantee, tp.table_name, tp.privilege_type) AS k
       FROM information_schema.table_privileges tp
       JOIN pg_tables pt ON pt.schemaname = 'public' AND pt.tablename = tp.table_name
       WHERE tp.table_name::text = ANY($1::text[]) AND tp.grantee <> pt.tableowner`,
      [NEW_TABLES],
    );
    expect(keys(rows)).toEqual(
      NEW_TABLES.flatMap((t) => [`chat_definer:${t}:INSERT`, `chat_definer:${t}:SELECT`]),
    );
  });

  it("app, app_worker and readonly hold nothing on the new tables; readonly nothing on any chat table (S-10)", async () => {
    // RO-L14-8: each role's OWN table and column ACL entries (or PUBLIC's), not has_*_privilege, which follows the
    // cluster-role memberships migrate.test.ts grants app_worker for the length of a check
    const { rows } = await ctx.owner.query(
      `SELECT c.relname::text AS t, r.rname AS rname,
              EXISTS (SELECT 1 FROM aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) x
                       WHERE x.grantee IN (r.rname::regrole::oid, 0::oid) AND x.privilege_type IN
                         ('SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'))
              OR EXISTS (SELECT 1 FROM pg_attribute a CROSS JOIN LATERAL aclexplode(a.attacl) x
                          WHERE a.attrelid = c.oid AND NOT a.attisdropped
                            AND x.grantee IN (r.rname::regrole::oid, 0::oid)
                            AND x.privilege_type IN ('SELECT', 'INSERT', 'UPDATE', 'REFERENCES')) AS held
       FROM pg_class c CROSS JOIN (VALUES ('app'), ('app_worker'), ('readonly')) AS r(rname)
       WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p', 'v', 'm')
         AND c.relname LIKE 'chat\\_%' AND (r.rname = 'readonly' OR c.relname::text = ANY($1::text[]))`,
      [NEW_TABLES],
    );
    const found = rows as { t: string; rname: string; held: boolean }[];
    expect(found.filter((r) => r.rname === "readonly").map((r) => r.t)).toEqual(
      expect.arrayContaining([...NEW_TABLES, "chat_channels", "chat_members", "chat_messages"]),
    );
    expect(found.filter((r) => r.held)).toEqual([]);
  });

  it("the audit reason-note CHECK and the receipts action CHECK exist; chat_message_revisions has none", async () => {
    const { rows } = await ctx.owner.query(
      `SELECT concat_ws(':', conrelid::regclass::text, conname) AS k, pg_get_constraintdef(oid) AS def
       FROM pg_constraint WHERE contype = 'c' AND conrelid::regclass::text = ANY($1::text[])`,
      [NEW_TABLES],
    );
    expect(keys(rows)).toEqual([
      "chat_command_receipts:chat_command_receipts_action_chk",
      "chat_moderation_audit:chat_moderation_audit_action_chk",
      "chat_moderation_audit:chat_moderation_audit_reason_code_chk",
      "chat_moderation_audit:chat_moderation_audit_reason_note_chk",
    ]);
    const defs = (rows as { def: string }[]).map((r) => r.def).join(" ");
    expect(defs).toContain("octet_length(reason_note)");
    expect(defs).toContain("message.restore");
  });

  it("the audit action and reason_code CHECKs reject a direct chat_definer INSERT outside the closed sets", async () => {
    const insert = (action: string, reason: string) =>
      ctx.owner.query(
        `INSERT INTO chat_moderation_audit (tenant_id, channel_id, message_id, actor_person_id, action, reason_code)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [ctx.tenantA, channel, message, person, action, reason],
      );
    await ctx.owner.query("SET ROLE chat_definer");
    try {
      await expect(insert("mute", "spam")).rejects.toMatchObject({
        code: "23514",
        constraint: "chat_moderation_audit_action_chk",
      });
      await expect(insert("hide", "rude")).rejects.toMatchObject({
        code: "23514",
        constraint: "chat_moderation_audit_reason_code_chk",
      });
    } finally {
      await ctx.owner.query("RESET ROLE");
    }
  });

  it("UPDATE and DELETE on each new table raise restrict_violation, even for the superuser", async () => {
    await ctx.owner.query(
      `INSERT INTO chat_message_revisions (message_id, revision_no, previous_body, edited_by_person_id)
       VALUES ($1, 1, 'x', $2)`,
      [message, person],
    );
    await ctx.owner.query(
      `INSERT INTO chat_moderation_audit (tenant_id, channel_id, message_id, actor_person_id, action, reason_code)
       VALUES ($1, $2, $3, $4, 'hide', 'spam')`,
      [ctx.tenantA, channel, message, person],
    );
    await ctx.owner.query(
      `INSERT INTO chat_command_receipts
         (tenant_id, actor_person_id, command_id, action, canonical_fingerprint, result_json)
       VALUES ($1, $2, $3, 'message.hide', 'f', '{}')`,
      [ctx.tenantA, person, randomUUID()],
    );
    const setColumn: Record<string, string> = {
      chat_command_receipts: "action",
      chat_message_revisions: "revision_no",
      chat_moderation_audit: "action",
    };
    for (const t of NEW_TABLES) {
      await expect(
        ctx.owner.query(`UPDATE ${t} SET ${setColumn[t]} = ${setColumn[t]}`),
      ).rejects.toMatchObject({ code: "23001" });
      await expect(ctx.owner.query(`DELETE FROM ${t}`)).rejects.toMatchObject({ code: "23001" });
    }
  });

  it("column grants are exactly 4.4: the chat_definer INSERT/UPDATE lists and the 14-column app read", async () => {
    const { rows } = await ctx.owner.query(
      `SELECT concat_ws(':', grantee, table_name, privilege_type, column_name) AS k
       FROM information_schema.column_privileges
       WHERE table_schema = 'public' AND table_name IN ('chat_channels', 'chat_members', 'chat_messages')
         AND ((grantee = 'chat_definer' AND privilege_type IN ('INSERT', 'UPDATE'))
              OR (grantee = 'app' AND table_name = 'chat_messages'))`,
    );
    const channelInsert = ["tenant_id", "kind", "title", "is_default", "sort_order"];
    const messageInsert = ["channel_id", "author_type", "author_person_id", "membership_id"];
    const messageUpdate = [
      "body",
      "edited_at",
      "edit_count",
      "author_deleted_at",
      "moderation_state",
    ];
    expect(keys(rows)).toEqual(
      [
        ...cols("chat_definer", "chat_channels", "INSERT", [
          ...channelInsert,
          "creation_origin",
          "post_policy",
          "assistant_enabled",
        ]),
        ...cols("chat_definer", "chat_channels", "UPDATE", ["archived_at"]),
        ...cols("chat_definer", "chat_members", "INSERT", [
          "channel_id",
          "person_id",
          "membership_id",
        ]),
        ...cols("chat_definer", "chat_members", "UPDATE", [
          "last_read_created_at",
          "last_read_message_id",
          "membership_id",
        ]),
        ...cols("chat_definer", "chat_messages", "INSERT", [
          ...messageInsert,
          "body",
          "reply_to_message_id",
          "client_msg_id",
          "created_at",
        ]),
        ...cols("chat_definer", "chat_messages", "UPDATE", [
          ...messageUpdate,
          "moderation_updated_at",
          "moderation_actor_person_id",
          "moderation_reason_code",
        ]),
        ...cols("app", "chat_messages", "SELECT", APP_COLUMNS),
      ].sort(),
    );
  });

  it("RO-L14-6 (DT-27): identity_definer may SELECT exactly the three person-FK columns, nothing else", async () => {
    const { rows } = await ctx.owner.query(
      `SELECT concat_ws(':', c.relname, a.attname, p.priv) AS k
       FROM pg_class c
       JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
       CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('REFERENCES')) AS p(priv)
       WHERE c.relnamespace = 'public'::regnamespace AND c.relname = ANY($1)
         AND has_column_privilege('identity_definer', c.oid, a.attnum, p.priv)`,
      [NEW_TABLES],
    );
    expect(keys(rows)).toEqual([
      "chat_command_receipts:actor_person_id:SELECT",
      "chat_message_revisions:edited_by_person_id:SELECT",
      "chat_moderation_audit:actor_person_id:SELECT",
    ]);
    const tableLevel = await ctx.owner.query(
      `SELECT c.relname FROM pg_class c
       WHERE c.relnamespace = 'public'::regnamespace AND c.relname = ANY($1)
         AND has_table_privilege('identity_definer', c.oid,
           'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')`,
      [NEW_TABLES],
    );
    expect(tableLevel.rows).toEqual([]);
  });

  it("chat_definer may EXECUTE tenant_capability_authorize(uuid, text, uuid)", async () => {
    const { rows } = await ctx.owner.query(
      `SELECT has_function_privilege('chat_definer',
         'public.tenant_capability_authorize(uuid, text, uuid)', 'EXECUTE') AS ok`,
    );
    expect(rows).toEqual([{ ok: true }]);
  });
});

describe("DT-31: app reads chat_messages through the 14-column allowlist only", () => {
  it.each(["body", "search_document", "moderation_actor_person_id", "moderation_reason_code", "*"])(
    "SELECT %s FROM chat_messages as app fails with insufficient_privilege",
    async (col) => {
      await expect(asApp(`SELECT ${col} FROM chat_messages`)).rejects.toMatchObject({
        code: "42501",
      });
    },
  );

  it.each(NEW_TABLES)("SELECT on %s as app fails with insufficient_privilege", async (t) => {
    await expect(asApp(`SELECT count(*) FROM ${t}`)).rejects.toMatchObject({ code: "42501" });
  });

  it("the 14 allowlisted columns are readable under RLS by the channel member", async () => {
    const { rows } = await asApp(
      `SELECT ${APP_COLUMNS.join(", ")} FROM chat_messages WHERE id = $1`,
      [message],
    );
    expect(rows).toHaveLength(1);
    expect(Object.keys(rows[0] as object).sort()).toEqual([...APP_COLUMNS].sort());
  });
});

// Migration 0063 sections 2-4: the function-catalog half of DT-27 (4.2, 4.4, V-16, V-22), after the A-12 / A-13
// attribute and grant tests of me-player-reads.test.ts.
const PUBLIC_FNS = [
  "chat_get_message",
  "chat_list_messages",
  "delete_chat_message",
  "edit_chat_message",
  "mark_read",
  "moderate_chat_message",
  "send_chat_message",
];
const INTERNAL_FNS = [
  "chat_backfill_default_channels",
  "chat_memberships_provision_trg",
  "chat_provision_member",
];
const READ_FNS = ["chat_get_message", "chat_list_messages"];
const READ_RESULT =
  "TABLE(id uuid, channel_id uuid, author_type text, author_person_id uuid, body text, reply_to_message_id uuid, " +
  "edited_at timestamp with time zone, edit_count smallint, tombstone text, created_at timestamp with time zone)";
const LIST_RESULT =
  "TABLE(id uuid, channel_id uuid, author_type text, author_person_id uuid, body text, reply_to_message_id uuid, " +
  "edited_at timestamp with time zone, edit_count smallint, tombstone text, created_at timestamp with time zone, " +
  "author_label text)";

describe("0063 function catalog (DT-27 function half)", () => {
  const catalog = async () =>
    (
      await ctx.owner.query(
        `SELECT p.proname, p.prosecdef, p.provolatile, p.proconfig, pg_get_userbyid(p.proowner) AS owner,
                pg_get_function_identity_arguments(p.oid) AS args, pg_get_function_result(p.oid) AS result,
                p.proacl IS NOT NULL AS explicit_acl,
                -- RO-L14-8: the role's OWN EXECUTE entry (or PUBLIC's), not has_function_privilege (follows membership)
                EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
                         WHERE x.privilege_type = 'EXECUTE' AND x.grantee IN ('app'::regrole::oid, 0::oid)) AS app,
                EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
                         WHERE x.privilege_type = 'EXECUTE' AND x.grantee IN ('app_worker'::regrole::oid, 0::oid)) AS worker,
                EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
                         WHERE x.privilege_type = 'EXECUTE' AND x.grantee IN ('readonly'::regrole::oid, 0::oid)) AS ro,
                ARRAY(SELECT (CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END)::text
                        FROM aclexplode(p.proacl) a WHERE a.privilege_type = 'EXECUTE') AS grantees
           FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'public' AND p.proname = ANY($1::text[])`,
        [[...PUBLIC_FNS, ...INTERNAL_FNS]],
      )
    ).rows;

  it("chat_definer owns the 10 functions, one each: SECURITY DEFINER, pinned search_path, the reads STABLE with the 4.2 signature; the memberships trigger fires AFTER INSERT OR UPDATE OF status WHEN active", async () => {
    const role = await ctx.owner.query(`SELECT 1 FROM pg_roles WHERE rolname = 'chat_definer'`);
    expect(role.rowCount).toBe(1);
    // trigger and per-row attributes first, so a red run (read functions absent) still checks the other 8
    const trg = await ctx.owner.query(
      `SELECT pg_get_triggerdef(oid) AS def, tgenabled FROM pg_trigger
        WHERE tgname = 'trg_memberships_chat_provision' AND tgrelid = 'public.memberships'::regclass`,
    );
    expect(trg.rows).toHaveLength(1);
    expect(trg.rows[0].tgenabled).toBe("O");
    expect(trg.rows[0].def).toMatch(
      / AFTER INSERT OR UPDATE OF status ON (public\.)?memberships FOR EACH ROW WHEN \(\(new\.status = 'active'::\w+\)\) EXECUTE FUNCTION (public\.)?chat_memberships_provision_trg\(\)$/,
    );
    const rows = await catalog();
    for (const r of rows) {
      expect(r, r.proname).toMatchObject({
        prosecdef: true,
        provolatile: READ_FNS.includes(r.proname) ? "s" : "v",
        owner: "chat_definer",
        proconfig: ["search_path=pg_catalog, public, pg_temp"],
      });
    }
    expect(rows.map((r) => r.proname).sort()).toEqual([...PUBLIC_FNS, ...INTERNAL_FNS].sort());
    const reads = rows.filter((r) => READ_FNS.includes(r.proname));
    expect(Object.fromEntries(reads.map((r) => [r.proname, [r.args, r.result]]))).toEqual({
      chat_get_message: ["p_message uuid", READ_RESULT],
      chat_list_messages: [
        "p_channel uuid, p_cursor_created_at timestamp with time zone, p_cursor_id uuid, p_direction text, p_limit integer",
        LIST_RESULT,
      ],
    });
  });

  it("EXECUTE is held by exactly chat_definer and app on the 7 public functions and by the owner alone on the 3 internal ones (PUBLIC revoked)", async () => {
    const got = Object.fromEntries(
      (await catalog()).map((r) => [
        r.proname,
        {
          grantees: [...r.grantees].sort(),
          explicit_acl: r.explicit_acl,
          app: r.app,
          worker: r.worker,
          ro: r.ro,
        },
      ]),
    );
    const acl = (app: boolean) => ({
      grantees: app ? ["app", "chat_definer"] : ["chat_definer"],
      explicit_acl: true,
      app,
      worker: false,
      ro: false,
    });
    expect(got).toEqual(
      Object.fromEntries([
        ...PUBLIC_FNS.map((fn) => [fn, acl(true)]),
        ...INTERNAL_FNS.map((fn) => [fn, acl(false)]),
      ]),
    );
  });
});
