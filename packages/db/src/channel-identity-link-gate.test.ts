import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";
import type pg from "pg";
import { setupRlsTestContext, type RlsTestContext } from "./test-harness.js";
import {
  deriveLinkCodeLookupHash,
  deriveLinkCodeVerifier,
  issueLinkCode,
  normalizeLinkCode,
} from "./identity.js";

/**
 * channel-identity-link-gate — real-Postgres tests for the 0064 read gate
 * public.channel_identity_link_gate(uuid) (lane L13a, owner decision B-A1 R1). The function is
 * app-granted and only maps the 0034 core resolve_deferred_payment_account_core(uuid):
 * linked = qualified, account_ref = the core's account_ref when qualified, else NULL. Calls run
 * through the real `app` pool as autocommit statements (the caller contract), one test per row of
 * the lane decision table (readiness file section 7); only LG-6c and LG-C2 call inside an open app
 * transaction, on purpose. Seeds reuse the core suite's fixtures and are written via `ctx.owner`
 * (app holds no privilege on the identity tables). No *_definer role is named and owners are
 * compared by OID, so no definer reader lock is taken (notes 33 and 34).
 */

let ctx: RlsTestContext;
const keys = { lookupHmacKey: randomBytes(32) };

beforeAll(async () => {
  ctx = await setupRlsTestContext("plexco_channel_identity_link_gate_check");
}, 180_000);

afterAll(async () => {
  await ctx?.teardown();
});

// --- seed helpers, copied from identity-account-link.test.ts (owner role) ---------------

async function makePerson(
  opts: { status?: "active" | "merged" | "deleted"; mergedInto?: string | null } = {},
): Promise<string> {
  const id = randomUUID();
  await ctx.owner.query(
    `INSERT INTO persons (id, display_name, status, merged_into_person_id)
       VALUES ($1, $2, $3, $4)`,
    [id, "Seed Person", opts.status ?? "active", opts.mergedInto ?? null],
  );
  return id;
}

async function makeChannelIdentity(
  personId: string,
  opts: {
    status?: "active" | "inactive";
    platform?: "zalo" | "messenger" | "telegram";
    hash?: string;
  } = {},
): Promise<string> {
  const id = randomUUID();
  await ctx.owner.query(
    `INSERT INTO channel_identities
       (id, person_id, platform, platform_user_id_enc, platform_user_lookup_hash, status)
       VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      id,
      personId,
      opts.platform ?? "zalo",
      Buffer.from(`enc-${id}`),
      opts.hash ?? `chan-hash-${id}`,
      opts.status ?? "active",
    ],
  );
  return id;
}

async function makeAccount(personId: string | null): Promise<string> {
  const id = randomUUID();
  await ctx.owner.query(`INSERT INTO accounts (id, person_id) VALUES ($1, $2)`, [id, personId]);
  return id;
}

/** One email per account (account_emails_account_uq). Verified = verified_at set, pending NULL. */
async function addVerifiedEmail(accountId: string): Promise<string> {
  const id = randomUUID();
  await ctx.owner.query(
    `INSERT INTO account_emails
       (id, account_id, email_lookup_hash, email_enc, kms_key_version, verified_at, pending_expires_at)
       VALUES ($1, $2, $3, $4, 'v1', now(), NULL)`,
    [id, accountId, `email-${id}`, Buffer.from(`enc-${id}`)],
  );
  return id;
}

/** Unverified/pending email (lifecycle CHECK: verified_at NULL XOR pending set). */
async function addPendingEmail(accountId: string): Promise<void> {
  const id = randomUUID();
  await ctx.owner.query(
    `INSERT INTO account_emails
       (id, account_id, email_lookup_hash, email_enc, kms_key_version, verified_at, pending_expires_at)
       VALUES ($1, $2, $3, $4, 'v1', NULL, now() + interval '1 day')`,
    [id, accountId, `email-${id}`, Buffer.from(`enc-${id}`)],
  );
}

/** Legacy Telegram-style verified account_identity (DD-37 removed provider). */
async function addLegacyAccountIdentity(accountId: string): Promise<void> {
  await ctx.owner.query(
    `INSERT INTO account_identities (id, account_id, platform, platform_user_hash, verified_at)
       VALUES ($1, $2, 'telegram', $3, now())`,
    [randomUUID(), accountId, `tg-hash-${randomUUID()}`],
  );
}

/** A fully-qualified binding: active person, active CI, one account with a verified email. */
async function seedQualified(): Promise<{
  person: string;
  ci: string;
  account: string;
  email: string;
}> {
  const person = await makePerson();
  const ci = await makeChannelIdentity(person);
  const account = await makeAccount(person);
  const email = await addVerifiedEmail(account);
  return { person, ci, account, email };
}

/** Tombstone `oldPersonId` in merge_tombstones (with the required merge_audit + canonical FKs). */
async function tombstone(oldPersonId: string, canonicalPersonId?: string): Promise<void> {
  const auditId = randomUUID();
  const canonical = canonicalPersonId ?? (await makePerson());
  await ctx.owner.query(
    `INSERT INTO merge_audit
       (id, source_person_id, target_person_id, canonical_person_id, method, actor_type,
        before_snapshot_enc, after_snapshot_enc)
       VALUES ($1, $2, $3, $3, 'test', 'system', $4, $4)`,
    [auditId, oldPersonId, canonical, Buffer.from([0])],
  );
  await ctx.owner.query(
    `INSERT INTO merge_tombstones (old_person_id, canonical_person_id, merge_audit_id)
       VALUES ($1, $2, $3)`,
    [oldPersonId, canonical, auditId],
  );
}

// --- the gate, called as app ---------------------------------------------------------------

type Gate = { linked: boolean; account_ref: string | null };

/** The one generic deny row: every deny cause returns exactly this, never an error. */
const DENY: Gate = { linked: false, account_ref: null };

/**
 * Call the wrapper AS app: by default on the pool, in its own autocommit statement (the caller
 * contract); LG-6c and LG-C2 pass an app client inside an open transaction. Every call also
 * asserts the result shape (exactly one row of exactly the columns linked, account_ref, in that
 * order) and LG-4 (account_ref is non-NULL exactly when linked is true).
 */
async function gate(
  channelIdentityId: string | null,
  db: pg.Pool | pg.PoolClient = ctx.appPool,
): Promise<Gate> {
  const res = await db.query(`SELECT * FROM channel_identity_link_gate($1::uuid)`, [
    channelIdentityId,
  ]);
  expect(res.fields.map((f) => f.name)).toEqual(["linked", "account_ref"]);
  expect(res.rows).toHaveLength(1);
  const row = res.rows[0] as Gate;
  expect(typeof row.linked).toBe("boolean");
  expect(row.account_ref === null).toBe(row.linked === false); // LG-4
  return row;
}

/**
 * Every deny cell of the decision table as [cell, seed]: the seed writes the fixture (owner role)
 * and returns the identity id to gate. LG-2b and LG-3 assert the generic deny row in autocommit;
 * LG-6c replays the same seeds inside an open app transaction.
 */
const DENY_CASES: [string, () => Promise<string | null>][] = [
  [
    "LG-2b: a legacy-shaped account (an account_identities row, no account_emails row)",
    async () => {
      const person = await makePerson();
      // the pre-0017 residual: a verified legacy identity, NO email
      await addLegacyAccountIdentity(await makeAccount(person));
      return makeChannelIdentity(person);
    },
  ],
  ["LG-3a: NULL argument", async () => null],
  ["LG-3b: unknown channel identity id", async () => randomUUID()],
  [
    "LG-3c: inactive channel identity",
    async () => {
      const person = await makePerson();
      await addVerifiedEmail(await makeAccount(person));
      return makeChannelIdentity(person, { status: "inactive" });
    },
  ],
  [
    "LG-3d: deleted person",
    async () => {
      const person = await makePerson({ status: "deleted" });
      await addVerifiedEmail(await makeAccount(person));
      return makeChannelIdentity(person);
    },
  ],
  [
    "LG-3e: merged person with no canonical pointer (merge pending)",
    async () => {
      const person = await makePerson({ status: "merged", mergedInto: null });
      await addVerifiedEmail(await makeAccount(person)); // only the merged-person branch can deny
      return makeChannelIdentity(person);
    },
  ],
  ["LG-3f: no account", async () => makeChannelIdentity(await makePerson())],
  [
    "LG-3g: unverified account (pending email only)",
    async () => {
      const person = await makePerson();
      await addPendingEmail(await makeAccount(person));
      return makeChannelIdentity(person);
    },
  ],
  [
    "LG-3h: several verified accounts across the merge chain",
    async () => {
      const canonical = await makePerson();
      const old = await makePerson({ status: "merged", mergedInto: canonical });
      await tombstone(old, canonical);
      await addVerifiedEmail(await makeAccount(canonical)); // one on the canonical
      await addVerifiedEmail(await makeAccount(old)); // one lingering on the merged source node
      return makeChannelIdentity(old);
    },
  ],
  [
    "LG-3i: merged node without a tombstone",
    async () => {
      const canonical = await makePerson();
      const old = await makePerson({ status: "merged", mergedInto: canonical });
      await addVerifiedEmail(await makeAccount(canonical)); // would qualify if the merge were complete
      return makeChannelIdentity(old);
    },
  ],
];

// --- PART A: the decision table -------------------------------------------------------------

describe("channel_identity_link_gate decision table, as app (LG-1..LG-3; LG-4 on every call)", () => {
  it("LG-1: the core qualifies the identity -> (true, its account id), never the person id", async () => {
    const { ci, account } = await seedQualified();
    const row = await gate(ci);
    expect(row).toEqual({ linked: true, account_ref: account });
  });

  it("LG-1b: merged chain with every merged node tombstoned -> (true, the account on the active canonical)", async () => {
    const canonical = await makePerson();
    const old = await makePerson({ status: "merged", mergedInto: canonical });
    const ci = await makeChannelIdentity(old);
    const account = await makeAccount(canonical);
    await addVerifiedEmail(account);
    await tombstone(old, canonical);
    expect(await gate(ci)).toEqual({ linked: true, account_ref: account });
  });

  it("LG-2a: a verified account -> (true, its id), also when it carries a legacy account_identities row", async () => {
    const person = await makePerson();
    const ci = await makeChannelIdentity(person);
    const account = await makeAccount(person);
    await addLegacyAccountIdentity(account); // a legacy row neither counts nor blocks
    await addVerifiedEmail(account); // >= 1 account_emails.verified_at IS NOT NULL: DD-50's predicate
    expect(await gate(ci)).toEqual({ linked: true, account_ref: account });
  });

  it.each(DENY_CASES)("%s -> (false, NULL)", async (_cell, seed) => {
    expect(await gate(await seed())).toEqual(DENY);
  });
});

describe("channel_identity_link_gate result shape and body (LG-7)", () => {
  it("LG-7: exactly (linked, account_ref) on both paths; the body has no RAISE, EXECUTE, person_ref or binding_version", async () => {
    const { ci, account } = await seedQualified();
    expect(await gate(ci)).toEqual({ linked: true, account_ref: account });
    expect(await gate(randomUUID())).toEqual(DENY);
    const { rows } = await ctx.owner.query(
      `SELECT pg_get_function_result(p.oid) AS result, p.prosrc
         FROM pg_proc p
        WHERE p.oid = 'public.channel_identity_link_gate(uuid)'::regprocedure`,
    );
    expect(rows[0].result).toBe("TABLE(linked boolean, account_ref uuid)");
    for (const banned of [/\braise\b/i, /\bexecute\b/i, /person_ref/i, /binding_version/i]) {
      expect(rows[0].prosrc).not.toMatch(banned);
    }
  });
});

// --- PART B: grants (LG-5), attributes (LG-6b), no write (LG-6c), locks (LG-C1, LG-C2) -------

/**
 * The EXECUTE ACL of one function, read from its own ACL entries (aclexplode(proacl)) and never
 * through has_function_privilege, which follows role inheritance (migrate.test.ts JCL-3b grants
 * identity_definer to app_worker for a moment, note 33). The owner is matched by OID, so a role
 * rename in migrate.test.ts cannot race the comparison.
 */
async function executeAcl(fn: string): Promise<unknown> {
  const { rows } = await ctx.owner.query(
    `SELECT ARRAY(SELECT CASE WHEN a.grantee = p.proowner THEN 'owner'
                              WHEN a.grantee = 0 THEN 'PUBLIC'
                              ELSE pg_get_userbyid(a.grantee)::text END
                    FROM aclexplode(p.proacl) a
                   WHERE a.privilege_type = 'EXECUTE') AS grantees,
            p.proacl IS NOT NULL AS explicit_acl,
            EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0) AS public_grant,
            EXISTS (SELECT 1 FROM aclexplode(p.proacl) a
                     WHERE a.grantee = 'app'::regrole AND a.privilege_type = 'EXECUTE') AS app,
            EXISTS (SELECT 1 FROM aclexplode(p.proacl) a
                     WHERE a.grantee = 'app_worker'::regrole) AS worker,
            EXISTS (SELECT 1 FROM aclexplode(p.proacl) a
                     WHERE a.grantee = 'readonly'::regrole) AS ro
       FROM pg_proc p
      WHERE p.oid = $1::text::regprocedure`,
    [fn],
  );
  const { grantees, ...flags } = rows[0] as { grantees: string[] };
  return { grantees: [...grantees].sort(), ...flags };
}

describe("channel_identity_link_gate grants and attributes (LG-5, LG-6b)", () => {
  it("LG-5a: the wrapper's EXECUTE entries are exactly the owner and app; none for PUBLIC, app_worker or readonly", async () => {
    expect(await executeAcl("public.channel_identity_link_gate(uuid)")).toEqual({
      grantees: ["app", "owner"],
      explicit_acl: true,
      public_grant: false,
      app: true,
      worker: false,
      ro: false,
    });
  });

  it("LG-5b: app_worker and readonly calling the wrapper -> 42501", async () => {
    for (const pool of [ctx.workerPool, ctx.readonlyPool]) {
      await expect(
        pool.query(`SELECT * FROM channel_identity_link_gate($1::uuid)`, [randomUUID()]),
      ).rejects.toMatchObject({ code: "42501" });
    }
  });

  it("LG-5c: the core's ACL is unchanged (owner only) and app still cannot EXECUTE the core -> 42501", async () => {
    expect(await executeAcl("public.resolve_deferred_payment_account_core(uuid)")).toEqual({
      grantees: ["owner"],
      explicit_acl: true,
      public_grant: false,
      app: false,
      worker: false,
      ro: false,
    });
    await expect(
      ctx.appPool.query(`SELECT * FROM resolve_deferred_payment_account_core($1::uuid)`, [
        randomUUID(),
      ]),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("LG-6b: SECURITY DEFINER plpgsql VOLATILE, one uuid argument, pinned search_path, same owner as the core", async () => {
    const { rows } = await ctx.owner.query(
      `SELECT p.prosecdef, p.provolatile, p.proconfig, l.lanname,
              pg_get_function_identity_arguments(p.oid) AS args,
              p.proowner = c.proowner AS core_owner
         FROM pg_proc p
         JOIN pg_language l ON l.oid = p.prolang
         JOIN pg_proc c ON c.oid = 'public.resolve_deferred_payment_account_core(uuid)'::regprocedure
        WHERE p.oid = 'public.channel_identity_link_gate(uuid)'::regprocedure`,
    );
    expect(rows[0]).toEqual({
      prosecdef: true,
      provolatile: "v",
      proconfig: ["search_path=pg_catalog, public, pg_temp"],
      lanname: "plpgsql",
      args: "p_channel_identity_id uuid",
      core_owner: true,
    });
  });
});

describe("channel_identity_link_gate never writes (LG-6c)", () => {
  it.each(DENY_CASES)(
    "LG-6c: %s, called inside an app BEGIN -> (false, NULL) and no xid assigned (no write, no row lock)",
    async (_cell, seed) => {
      const ci = await seed();
      const client = await ctx.appPool.connect();
      try {
        await client.query("BEGIN");
        expect(await gate(ci, client)).toEqual(DENY);
        const { rows } = await client.query(`SELECT pg_current_xact_id_if_assigned() AS x`);
        expect(rows[0].x).toBeNull();
      } finally {
        await client.query("ROLLBACK").catch(() => {});
        client.release();
      }
    },
  );
});

// --- lock helpers, copied from identity-link-code.test.ts ----------------------------------

async function backendPid(client: pg.ClientBase): Promise<number> {
  const { rows } = await client.query(`SELECT pg_backend_pid() AS pid`);
  return (rows[0] as { pid: number }).pid;
}

async function waitUntilBlockedByHolder(holderPid: number, waiterPid: number): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const { rows } = await ctx.owner.query(
      `SELECT 1 FROM pg_stat_activity
        WHERE pid = $2 AND wait_event_type = 'Lock' AND $1 = ANY(pg_blocking_pids($2))`,
      [holderPid, waiterPid],
    );
    if (rows.length > 0) return;
    await new Promise((r) => setTimeout(r, 15));
  }
  throw new Error(`waiter ${waiterPid} never blocked by holder ${holderPid} within 5s`);
}

describe("channel_identity_link_gate lock footprint (LG-C1, LG-C2)", () => {
  it("LG-C1: a call racing an open link_code_consume of the same account waits on it, then returns (true, account); no 40P01, no error on either side", async () => {
    const { ci: ciA, account: accA } = await seedQualified();
    const chB = await makeChannelIdentity(await makePerson());
    const issued = await issueLinkCode(ctx.appPool, { accountId: accA }, keys);
    const consumer = await ctx.appPool.connect();
    const caller = await ctx.appPool.connect();
    let pending: Promise<Gate> | undefined;
    try {
      const consumerPid = await backendPid(consumer);
      const callerPid = await backendPid(caller);
      await consumer.query("BEGIN");
      const lookup = deriveLinkCodeLookupHash(normalizeLinkCode(issued.code)!, keys);
      const { rows: saltRows } = await consumer.query(`SELECT link_code_salt($1) AS salt`, [
        lookup,
      ]);
      const verifier = await deriveLinkCodeVerifier(
        normalizeLinkCode(issued.code)!,
        (saltRows[0] as { salt: Buffer }).salt,
      );
      const consumed = await consumer.query(
        `SELECT outcome FROM link_code_consume($1, $2, $3, NULL)`,
        [lookup, verifier, chB],
      );
      // the consumer's open transaction now holds accounts accA FOR UPDATE (0043)
      expect(consumed.rows[0]).toEqual({ outcome: "consumed" });
      await caller.query(`SET statement_timeout = '10s'`);
      pending = gate(ciA, caller); // autocommit statement: the caller contract
      await waitUntilBlockedByHolder(consumerPid, callerPid);
      await consumer.query("COMMIT");
      expect(await pending).toEqual({ linked: true, account_ref: accA });
    } finally {
      await consumer.query("ROLLBACK").catch(() => {});
      consumer.release();
      if (pending) await pending.catch(() => {});
      await caller.query(`RESET statement_timeout`).catch(() => {});
      caller.release();
    }
  });

  it("LG-C2: a qualified call inside an app BEGIN holds only the core's locks (read or FOR SHARE on its five relations) until COMMIT", async () => {
    const { ci, account } = await seedQualified();
    const client = await ctx.appPool.connect();
    try {
      await client.query("BEGIN");
      expect(await gate(ci, client)).toEqual({ linked: true, account_ref: account });
      const { rows: xact } = await client.query(`SELECT pg_current_xact_id_if_assigned() AS x`);
      expect(xact[0].x).not.toBeNull(); // the FOR SHARE row locks assigned an xid: LG-6c's probe is live
      const pid = await backendPid(client);
      const { rows } = await ctx.owner.query<{ rel: string; mode: string }>(
        `SELECT DISTINCT COALESCE(t.relname, c.relname)::text AS rel, l.mode
           FROM pg_locks l
           JOIN pg_class c ON c.oid = l.relation
           JOIN pg_namespace n ON n.oid = c.relnamespace
           LEFT JOIN pg_index i ON i.indexrelid = c.oid
           LEFT JOIN pg_class t ON t.oid = i.indrelid
          WHERE l.pid = $1 AND l.locktype = 'relation' AND n.nspname = 'public'`,
        [pid],
      );
      // and no advisory lock at all: one added to the wrapper or the core turns this red
      const { rows: advisory } = await ctx.owner.query(
        `SELECT l.classid, l.objid, l.objsubid, l.mode
           FROM pg_locks l
          WHERE l.pid = $1 AND l.locktype = 'advisory'`,
        [pid],
      );
      expect(advisory).toEqual([]);
      const core = [
        "account_emails",
        "accounts",
        "channel_identities",
        "merge_tombstones",
        "persons",
      ];
      const modes = ["AccessShareLock", "RowShareLock"];
      expect(rows.filter((r) => !core.includes(r.rel) || !modes.includes(r.mode))).toEqual([]);
      // FOR SHARE on exactly the four phase-2 tables of the 0034 canonical order
      expect(
        rows
          .filter((r) => r.mode === "RowShareLock")
          .map((r) => r.rel)
          .sort(),
      ).toEqual(["account_emails", "accounts", "channel_identities", "persons"]);
      await expect(
        ctx.owner.query(`SELECT 1 FROM accounts WHERE id = $1 FOR UPDATE NOWAIT`, [account]),
      ).rejects.toMatchObject({ code: "55P03" });
      await client.query("COMMIT");
      const after = await ctx.owner.query(
        `SELECT 1 FROM accounts WHERE id = $1 FOR UPDATE NOWAIT`,
        [account],
      );
      expect(after.rowCount).toBe(1);
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
  });
});
