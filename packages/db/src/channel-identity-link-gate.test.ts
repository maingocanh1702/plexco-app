import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { setupRlsTestContext, type RlsTestContext } from "./test-harness.js";

/**
 * channel-identity-link-gate — real-Postgres tests for the 0064 read gate
 * public.channel_identity_link_gate(uuid) (lane L13a, owner decision B-A1 R1). The function is
 * app-granted and only maps the 0034 core resolve_deferred_payment_account_core(uuid):
 * linked = qualified, account_ref = the core's account_ref when qualified, else NULL. Every call
 * here therefore runs through the real `app` pool as an autocommit statement (the caller
 * contract), one test per row of the lane decision table (readiness file section 7). Seeds reuse
 * the core suite's fixtures and are written via `ctx.owner` (app holds no privilege on the
 * identity tables). No *_definer role is named, so no definer reader lock is taken.
 */

let ctx: RlsTestContext;

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
 * Call the wrapper AS app in its own autocommit statement. Every call also asserts the result
 * shape (exactly one row of exactly the columns linked, account_ref, in that order) and LG-4
 * (account_ref is non-NULL exactly when linked is true).
 */
async function gate(channelIdentityId: string | null): Promise<Gate> {
  const res = await ctx.appPool.query(`SELECT * FROM channel_identity_link_gate($1::uuid)`, [
    channelIdentityId,
  ]);
  expect(res.fields.map((f) => f.name)).toEqual(["linked", "account_ref"]);
  expect(res.rows).toHaveLength(1);
  const row = res.rows[0] as Gate;
  expect(typeof row.linked).toBe("boolean");
  expect(row.account_ref === null).toBe(row.linked === false); // LG-4
  return row;
}

// --- PART A: the decision table -------------------------------------------------------------

describe("channel_identity_link_gate decision table, as app (LG-1..LG-3; LG-4 on every call)", () => {
  it("LG-1: the core qualifies the identity -> (true, its account id), never the person id", async () => {
    const { person, ci, account } = await seedQualified();
    const row = await gate(ci);
    expect(row).toEqual({ linked: true, account_ref: account });
    expect(row.account_ref).not.toBe(person);
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

  it("LG-2b: a legacy-shaped account (an account_identities row, no account_emails row) -> (false, NULL)", async () => {
    const person = await makePerson();
    const ci = await makeChannelIdentity(person);
    const account = await makeAccount(person);
    await addLegacyAccountIdentity(account); // the pre-0017 residual: verified identity, NO email
    expect(await gate(ci)).toEqual(DENY);
  });

  it("LG-3a: NULL argument -> (false, NULL)", async () => {
    expect(await gate(null)).toEqual(DENY);
  });

  it("LG-3b: unknown channel identity id -> (false, NULL)", async () => {
    expect(await gate(randomUUID())).toEqual(DENY);
  });

  it("LG-3c: inactive channel identity -> (false, NULL)", async () => {
    const person = await makePerson();
    const ci = await makeChannelIdentity(person, { status: "inactive" });
    await addVerifiedEmail(await makeAccount(person));
    expect(await gate(ci)).toEqual(DENY);
  });

  it("LG-3d: deleted person -> (false, NULL)", async () => {
    const person = await makePerson({ status: "deleted" });
    const ci = await makeChannelIdentity(person);
    await addVerifiedEmail(await makeAccount(person));
    expect(await gate(ci)).toEqual(DENY);
  });

  it("LG-3e: merged person with no canonical pointer (merge pending) -> (false, NULL)", async () => {
    const person = await makePerson({ status: "merged", mergedInto: null });
    const ci = await makeChannelIdentity(person);
    expect(await gate(ci)).toEqual(DENY);
  });

  it("LG-3f: no account -> (false, NULL)", async () => {
    const person = await makePerson();
    const ci = await makeChannelIdentity(person);
    expect(await gate(ci)).toEqual(DENY);
  });

  it("LG-3g: unverified account (pending email only) -> (false, NULL)", async () => {
    const person = await makePerson();
    const ci = await makeChannelIdentity(person);
    await addPendingEmail(await makeAccount(person));
    expect(await gate(ci)).toEqual(DENY);
  });

  it("LG-3h: several verified accounts across the merge chain -> (false, NULL)", async () => {
    const canonical = await makePerson();
    const old = await makePerson({ status: "merged", mergedInto: canonical });
    const ci = await makeChannelIdentity(old);
    await tombstone(old, canonical);
    await addVerifiedEmail(await makeAccount(canonical)); // one on the canonical
    await addVerifiedEmail(await makeAccount(old)); // one lingering on the merged source node
    expect(await gate(ci)).toEqual(DENY);
  });

  it("LG-3i: merged node without a tombstone -> (false, NULL)", async () => {
    const canonical = await makePerson();
    const old = await makePerson({ status: "merged", mergedInto: canonical });
    const ci = await makeChannelIdentity(old);
    await addVerifiedEmail(await makeAccount(canonical)); // would qualify if the merge were complete
    expect(await gate(ci)).toEqual(DENY);
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

// ============================================================================================
// PART B (lane L13a writer part 3): NOT YET WRITTEN. Add it below, in this file, per the
// acceptance matrix of docs/sessions/web-mvp-phase3-readiness-p3-m9-channel-identity-link-gate.md
// section 7:
//   LG-5a  the me-player-reads.test.ts A-13 pattern for public.channel_identity_link_gate(uuid):
//          grantees = sorted [owner, app]; app true, app_worker false, readonly false,
//          explicit ACL true, PUBLIC grant false.
//   LG-5b  workerPool and readonlyPool calls reject with 42501.
//   LG-5c  the core's ACL is unchanged: resolve_deferred_payment_account_core(uuid) grantees =
//          [owner] only; app, app_worker, readonly cannot EXECUTE; an appPool call to it -> 42501.
//   LG-6b  the A-12 pattern: prosecdef true, provolatile v, plpgsql, args
//          "p_channel_identity_id uuid", owner = the core's owner,
//          proconfig ["search_path=pg_catalog, public, pg_temp"].
//   LG-6c  every deny inside an app BEGIN resolves and pg_current_xact_id_if_assigned() IS NULL.
//   LG-C1  a call racing an open link_code_consume (accounts FOR UPDATE) waits, then returns
//          (true, account); no 40P01 and no error on either side.
//   LG-C2  a qualified call inside an app BEGIN holds relation locks only on the core's five
//          relations, AccessShareLock or RowShareLock only; owner FOR UPDATE NOWAIT on the
//          account -> 55P03 until COMMIT, then succeeds.
//   LG-6a is already covered here: gate() asserts the column list on every call and LG-7 asserts
//   pg_get_function_result.
// ============================================================================================
