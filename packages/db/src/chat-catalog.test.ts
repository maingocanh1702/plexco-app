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
    const { rows } = await ctx.owner.query(
      `SELECT c.relname::text AS t, r.rname AS rname,
              has_table_privilege(r.rname::name, c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
              OR has_any_column_privilege(r.rname::name, c.oid, 'SELECT,INSERT,UPDATE,REFERENCES') AS held
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
