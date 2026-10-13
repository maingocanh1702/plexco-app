import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";
import { issueLinkCode } from "./identity.js";
import {
  detachMyChannel,
  listMyChannels,
  readMyProfile,
  updateMyProfile,
  validateDisplayName,
} from "./me-settings.js";
import { setupRlsTestContext, type RlsTestContext } from "./test-harness.js";

/**
 * Real-Postgres tests for 0055 (lane M4): person_profile_read/update, account_linked_channels,
 * channel_identity_detach. Runtime calls go through ctx.appPool (role `app`); seeds/inspection
 * through ctx.owner. `app` has no privilege on persons/accounts/channel_identities, so these
 * functions are the only way in.
 */
let ctx: RlsTestContext;
const keys = { lookupHmacKey: randomBytes(32) };

beforeAll(async () => {
  ctx = await setupRlsTestContext("plexco_me_settings");
}, 180_000);
afterAll(async () => {
  await ctx?.teardown();
});

async function webUser(
  name: string | null = "Web",
): Promise<{ accountId: string; personId: string }> {
  const p = await ctx.owner.query<{ id: string }>(
    `INSERT INTO persons (display_name) VALUES ($1) RETURNING id`,
    [name],
  );
  const a = await ctx.owner.query<{ id: string }>(
    `INSERT INTO accounts (person_id) VALUES ($1) RETURNING id`,
    [p.rows[0]!.id],
  );
  return { accountId: a.rows[0]!.id, personId: p.rows[0]!.id };
}

async function identityFor(
  personId: string,
  platform = "zalo",
  status = "active",
): Promise<string> {
  const ciId = randomUUID();
  await ctx.owner.query(
    `INSERT INTO channel_identities
       (id, person_id, platform, platform_user_id_enc, platform_user_lookup_hash, status)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [ciId, personId, platform, Buffer.from("secret-platform-id"), `lh-${ciId}`, status],
  );
  return ciId;
}

const ciRow = async (id: string) =>
  (await ctx.owner.query(`SELECT person_id, status FROM channel_identities WHERE id = $1`, [id]))
    .rows[0] as { person_id: string; status: string };
const personRow = async (id: string) =>
  (
    await ctx.owner.query(
      `SELECT display_name, status, merged_into_person_id FROM persons WHERE id = $1`,
      [id],
    )
  ).rows[0] as {
    display_name: string | null;
    status: string;
    merged_into_person_id: string | null;
  };
const detachAudit = async (accountId: string) =>
  (
    await ctx.owner.query(
      `SELECT tenant_id, detail FROM routing_audit WHERE action = 'identity.channel_detached' AND actor_id = $1`,
      [accountId],
    )
  ).rows as { tenant_id: string | null; detail: Record<string, string> }[];

describe("person_profile_read / person_profile_update", () => {
  it("reads the account's own Person display name; unknown account -> null", async () => {
    const u = await webUser("Lan");
    expect(await readMyProfile(ctx.appPool, u.accountId)).toEqual({ displayName: "Lan" });
    expect(await readMyProfile(ctx.appPool, randomUUID())).toBeNull();
  });

  it("update trims, writes ONLY display_name and returns the new value", async () => {
    const u = await webUser("Old");
    await ctx.owner.query(`UPDATE persons SET phone_lookup_hash = 'ph-keep' WHERE id = $1`, [
      u.personId,
    ]);
    expect(await updateMyProfile(ctx.appPool, u.accountId, "  Lan Nguyen  ")).toEqual({
      displayName: "Lan Nguyen",
    });
    const row = await ctx.owner.query(
      `SELECT display_name, phone_lookup_hash, status, merged_into_person_id FROM persons WHERE id = $1`,
      [u.personId],
    );
    expect(row.rows[0]).toEqual({
      display_name: "Lan Nguyen",
      phone_lookup_hash: "ph-keep",
      status: "active",
      merged_into_person_id: null,
    });
  });

  it("a merged Person is unreadable and unwritable (zero rows)", async () => {
    const u = await webUser("Gone");
    await ctx.owner.query(`UPDATE persons SET status = 'deleted' WHERE id = $1`, [u.personId]);
    expect(await readMyProfile(ctx.appPool, u.accountId)).toBeNull();
    expect(await updateMyProfile(ctx.appPool, u.accountId, "X")).toBeNull();
    expect((await personRow(u.personId)).display_name).toBe("Gone");
  });

  it("one account cannot touch another account's Person", async () => {
    const a = await webUser("A");
    const b = await webUser("B");
    await updateMyProfile(ctx.appPool, a.accountId, "A2");
    expect((await personRow(b.personId)).display_name).toBe("B");
  });

  // TS and SQL must agree on every boundary: the TS validator runs first, the definer is the backstop.
  const CORPUS: [string, string, boolean][] = [
    ["plain", "Lan", true],
    ["vietnamese diacritics", "Nguyễn Thị Ánh", true],
    ["max length (120)", "x".repeat(120), true],
    ["over max (121)", "x".repeat(121), false],
    ["120 emoji = 120 code points", "\u{1F600}".repeat(120), true],
    ["121 emoji", "\u{1F600}".repeat(121), false],
    ["blank", "   ", false],
    ["empty", "", false],
    ["NEL control (U+0085)", "a\u0085b", false],
    ["tab control", "a\tb", false],
    ["newline control", "a\nb", false],
    ["DEL", "a\u007fb", false],
    ["zero-width space (Cf)", "a​b", false],
    ["bidi override (Cf)", "a‮b", false],
    ["BOM (Cf)", "a﻿b", false],
    ["soft hyphen (Cf)", "a­b", false],
    ["tag char (Cf, astral)", "a\u{e0041}b", false],
    ["ZWJ in emoji sequence is a format char", "\u{1F468}‍\u{1F469}", false],
  ];
  it.each(CORPUS)("validation parity TS/SQL: %s", async (_label, input, ok) => {
    let tsOk = true;
    try {
      validateDisplayName(input);
    } catch {
      tsOk = false;
    }
    expect(tsOk).toBe(ok);
    const u = await webUser("seed");
    let sqlOk = true;
    try {
      await ctx.appPool.query(`SELECT * FROM person_profile_update($1, $2)`, [u.accountId, input]);
    } catch (error) {
      sqlOk = false;
      expect((error as { code?: string }).code).toBe("22023"); // invalid_parameter_value
    }
    expect(sqlOk).toBe(ok);
  });

  it("NULL arguments are refused", async () => {
    await expect(
      ctx.appPool.query(`SELECT * FROM person_profile_update(NULL, 'x')`),
    ).rejects.toThrow(/required/);
    const u = await webUser();
    await expect(
      ctx.appPool.query(`SELECT * FROM person_profile_update($1, NULL)`, [u.accountId]),
    ).rejects.toThrow(/required/);
  });
});

describe("account_linked_channels", () => {
  it("lists active AND inactive identities newest first, with no platform id / username / hash", async () => {
    const u = await webUser();
    const older = await identityFor(u.personId, "zalo", "inactive");
    await ctx.owner.query(
      `UPDATE channel_identities SET created_at = now() - interval '1 day' WHERE id = $1`,
      [older],
    );
    const newer = await identityFor(u.personId, "messenger", "active");
    const list = await listMyChannels(ctx.appPool, u.accountId);
    expect(list.map((c) => [c.channelIdentityId, c.platform, c.status])).toEqual([
      [newer, "messenger", "active"],
      [older, "zalo", "inactive"],
    ]);
    const raw = await ctx.appPool.query(`SELECT * FROM account_linked_channels($1)`, [u.accountId]);
    expect(Object.keys(raw.rows[0] as object).sort()).toEqual(
      ["channel_identity_id", "created_at", "platform", "status", "zalo_bot_id"].sort(),
    );
    expect(JSON.stringify(raw.rows)).not.toContain("secret-platform-id");
  });

  it("another account sees none of my identities", async () => {
    const mine = await webUser();
    await identityFor(mine.personId);
    const other = await webUser();
    expect(await listMyChannels(ctx.appPool, other.accountId)).toEqual([]);
    expect(await listMyChannels(ctx.appPool, randomUUID())).toEqual([]);
  });
});

describe("channel_identity_detach (the UNLINK rule)", () => {
  it("detached: identity moves to a FRESH empty Person; the owning Person is untouched; audit has ids only", async () => {
    const u = await webUser("Owner of memberships");
    const ci = await identityFor(u.personId);
    expect(await detachMyChannel(ctx.appPool, u.accountId, ci)).toEqual({ outcome: "detached" });

    const moved = await ciRow(ci);
    expect(moved.person_id).not.toBe(u.personId);
    expect(moved.status).toBe("active"); // status unchanged: the Zalo user is a stranger again
    expect(await personRow(moved.person_id)).toEqual({
      display_name: null,
      status: "active",
      merged_into_person_id: null,
    });
    // The account's Person is NOT tombstoned, merged, deleted or renamed.
    expect(await personRow(u.personId)).toEqual({
      display_name: "Owner of memberships",
      status: "active",
      merged_into_person_id: null,
    });
    const audit = await detachAudit(u.accountId);
    expect(audit).toHaveLength(1);
    expect(audit[0]!.tenant_id).toBeNull();
    expect(audit[0]!.detail).toEqual({
      channel_identity_id: ci,
      from_person_id: u.personId,
      to_person_id: moved.person_id,
    });
    expect(await listMyChannels(ctx.appPool, u.accountId)).toEqual([]);
    const merges = await ctx.owner.query(
      `SELECT count(*)::int AS n FROM merge_audit WHERE source_person_id = $1 OR target_person_id = $1`,
      [u.personId],
    );
    expect(merges.rows[0].n).toBe(0);
  });

  it("revokes the identity's live link codes (they name the old Person as source)", async () => {
    const u = await webUser();
    const ci = await identityFor(u.personId);
    const issued = await issueLinkCode(ctx.appPool, { channelIdentityId: ci }, keys);
    expect(issued.code).toBeTruthy();
    await detachMyChannel(ctx.appPool, u.accountId, ci);
    const live = await ctx.owner.query(
      `SELECT count(*)::int AS n FROM link_codes WHERE source_channel_identity_id = $1 AND consumed_at IS NULL AND revoked_at IS NULL`,
      [ci],
    );
    expect(live.rows[0].n).toBe(0);
  });

  it("not mine -> invalid, nothing written", async () => {
    const mine = await webUser();
    const theirs = await webUser();
    const ci = await identityFor(theirs.personId);
    expect(await detachMyChannel(ctx.appPool, mine.accountId, ci)).toEqual({ outcome: "invalid" });
    expect((await ciRow(ci)).person_id).toBe(theirs.personId);
    expect(await detachAudit(mine.accountId)).toEqual([]);
  });

  it("unknown identity id and unknown account -> invalid", async () => {
    const u = await webUser();
    expect(await detachMyChannel(ctx.appPool, u.accountId, randomUUID())).toEqual({
      outcome: "invalid",
    });
    const ci = await identityFor(u.personId);
    expect(await detachMyChannel(ctx.appPool, randomUUID(), ci)).toEqual({ outcome: "invalid" });
    expect((await ciRow(ci)).person_id).toBe(u.personId);
  });

  it("already inactive -> invalid, nothing written", async () => {
    const u = await webUser();
    const ci = await identityFor(u.personId, "zalo", "inactive");
    expect(await detachMyChannel(ctx.appPool, u.accountId, ci)).toEqual({ outcome: "invalid" });
    expect((await ciRow(ci)).person_id).toBe(u.personId);
  });

  it("account whose Person is not active -> invalid", async () => {
    const u = await webUser();
    const ci = await identityFor(u.personId);
    await ctx.owner.query(`UPDATE persons SET status = 'deleted' WHERE id = $1`, [u.personId]);
    expect(await detachMyChannel(ctx.appPool, u.accountId, ci)).toEqual({ outcome: "invalid" });
  });

  it("concurrent double-detach: exactly one wins, the other is invalid, one audit row", async () => {
    const u = await webUser();
    const ci = await identityFor(u.personId);
    const results = await Promise.all([
      detachMyChannel(ctx.appPool, u.accountId, ci),
      detachMyChannel(ctx.appPool, u.accountId, ci),
    ]);
    expect(results.map((r) => r.outcome).sort()).toEqual(["detached", "invalid"]);
    expect(await detachAudit(u.accountId)).toHaveLength(1);
  });

  it("re-detach after a successful detach is invalid (the route maps it to 409)", async () => {
    const u = await webUser();
    const ci = await identityFor(u.personId);
    expect((await detachMyChannel(ctx.appPool, u.accountId, ci)).outcome).toBe("detached");
    expect((await detachMyChannel(ctx.appPool, u.accountId, ci)).outcome).toBe("invalid");
  });

  it("NULL arguments are refused", async () => {
    await expect(
      ctx.appPool.query(`SELECT * FROM channel_identity_detach(NULL, $1)`, [randomUUID()]),
    ).rejects.toThrow(/required/);
  });
});

describe("0055 definers ACL", () => {
  const FNS = [
    "public.person_profile_read(uuid)",
    "public.person_profile_update(uuid, text)",
    "public.account_linked_channels(uuid)",
    "public.channel_identity_detach(uuid, uuid)",
  ];

  it("EXECUTE: app only -- PUBLIC, app_worker and readonly are refused", async () => {
    for (const fn of FNS) {
      const can = async (role: string) =>
        (
          await ctx.owner.query(`SELECT has_function_privilege($1, $2, 'EXECUTE') AS ok`, [
            role,
            fn,
          ])
        ).rows[0].ok as boolean;
      expect(await can("app"), fn).toBe(true);
      expect(await can("app_worker"), fn).toBe(false);
      expect(await can("readonly"), fn).toBe(false);
      const { rows } = await ctx.owner.query(
        `SELECT p.proacl::text AS acl FROM pg_proc p WHERE p.oid = $1::regprocedure`,
        [fn],
      );
      expect(rows[0].acl, fn).not.toBeNull();
      expect(rows[0].acl, fn).not.toMatch(/(^|[{,])=X/);
    }
  });

  it("SECURITY DEFINER with search_path pinned (pg_temp last); app has no table privilege", async () => {
    for (const fn of FNS) {
      const { rows } = await ctx.owner.query(
        `SELECT p.prosecdef, p.proconfig FROM pg_proc p WHERE p.oid = $1::regprocedure`,
        [fn],
      );
      expect(rows[0].prosecdef, fn).toBe(true);
      expect(rows[0].proconfig, fn).toContain("search_path=pg_catalog, public, pg_temp");
    }
    for (const table of ["persons", "channel_identities", "accounts"]) {
      const priv = await ctx.owner.query(
        `SELECT has_table_privilege('app', $1, 'SELECT') s, has_table_privilege('app', $1, 'UPDATE') u`,
        [table],
      );
      expect(priv.rows[0], table).toEqual({ s: false, u: false });
    }
  });
});
