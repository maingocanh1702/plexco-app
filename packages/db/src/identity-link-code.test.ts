import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";
import type pg from "pg";
import { setupRlsTestContext, type RlsTestContext } from "./test-harness.js";
import {
  consumeLinkCode,
  deriveLinkCodeLookupHash,
  deriveLinkCodeVerifier,
  formatLinkCode,
  generateLinkCode,
  issueLinkCode,
  linkCodeLookupComponent,
  normalizeLinkCode,
  LINK_CODE_MAX_ATTEMPTS,
  LINK_CODE_TTL_SECONDS,
} from "./identity.js";

/**
 * identity-link-code-issue-consume — real-Postgres tests for the 0043
 * link_code_issue / link_code_salt / link_code_consume definers and their
 * @plexco/db wrappers (feature_identity_tech.md §4, DD-50). Runtime calls go
 * through ctx.appPool (role `app`, the only grantee); seeds and inspections go
 * through ctx.owner (app holds zero privilege on the identity tables).
 */

let ctx: RlsTestContext;
const keys = { lookupHmacKey: randomBytes(32) };

beforeAll(async () => {
  ctx = await setupRlsTestContext("plexco_identity_link_code");
}, 180_000);

afterAll(async () => {
  await ctx?.teardown();
});

// --- seed helpers (owner) ------------------------------------------------------

async function makePerson(status: "active" | "merged" | "deleted" = "active"): Promise<string> {
  const id = randomUUID();
  await ctx.owner.query(`INSERT INTO persons (id, display_name, status) VALUES ($1, 'Seed', $2)`, [
    id,
    status,
  ]);
  return id;
}

async function makeAccount(personId: string): Promise<string> {
  const id = randomUUID();
  await ctx.owner.query(`INSERT INTO accounts (id, person_id) VALUES ($1, $2)`, [id, personId]);
  return id;
}

async function makeChannel(
  personId: string,
  opts: { status?: "active" | "inactive"; platform?: "zalo" | "messenger" } = {},
): Promise<string> {
  const id = randomUUID();
  await ctx.owner.query(
    `INSERT INTO channel_identities
       (id, person_id, platform, platform_user_id_enc, platform_user_lookup_hash, status)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [id, personId, opts.platform ?? "zalo", Buffer.from("x"), `lc-${id}`, opts.status ?? "active"],
  );
  return id;
}

/**
 * A legacy 'telegram' identity — the only way to get one now that 0042 refuses every path that
 * would create or become telegram. Disabling the triggers is the owner-only trick that stands in
 * for "this row predates the migration"; the rule is a TRIGGER, not a CHECK, precisely so such a
 * row stays updatable afterwards.
 */
async function makeLegacyTelegramChannel(personId: string): Promise<string> {
  const id = randomUUID();
  await ctx.owner.query(`ALTER TABLE channel_identities DISABLE TRIGGER USER`);
  try {
    await ctx.owner.query(
      `INSERT INTO channel_identities
         (id, person_id, platform, platform_user_id_enc, platform_user_lookup_hash)
       VALUES ($1, $2, 'telegram', $3, $4)`,
      [id, personId, Buffer.from("x"), `lc-tg-${id}`],
    );
  } finally {
    await ctx.owner.query(`ALTER TABLE channel_identities ENABLE TRIGGER USER`);
  }
  return id;
}

type Row = {
  failed_attempts: number;
  max_attempts: number;
  consumed_at: Date | null;
  revoked_at: Date | null;
  locked_until: Date | null;
  expires_at: Date;
  source_person_id: string;
};
async function row(linkCodeId: string): Promise<Row> {
  const { rows } = await ctx.owner.query(
    `SELECT failed_attempts, max_attempts, consumed_at, revoked_at, locked_until, expires_at, source_person_id
       FROM link_codes WHERE id = $1`,
    [linkCodeId],
  );
  return rows[0] as Row;
}

// Remaining TTL of an issued code in ONE database statement: expires_at and clock_timestamp()
// are both the server's clock, so the host clock never enters the comparison.
async function remainingTtlMs(linkCodeId: string): Promise<number> {
  const { rows } = await ctx.owner.query(
    `SELECT extract(epoch FROM expires_at - clock_timestamp())::float8 * 1000 AS ms
       FROM link_codes WHERE id = $1`,
    [linkCodeId],
  );
  // Fail closed: no row means a wrong code id, never "0 ms left".
  if (rows.length !== 1) throw new Error(`remainingTtlMs: no link_codes row for ${linkCodeId}`);
  return (rows[0] as { ms: number }).ms;
}

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/**
 * A code that finds the SAME row but fails verification — i.e. the user got the
 * lookup component right and mistyped the secret tail. This is the input the
 * whole attempt-cap machinery exists for, and it only exists because the code is
 * split: derive both hashes from the whole code and this input cannot be
 * constructed at all, which is what made failed_attempts dead code before.
 */
function sameLookupDifferentTail(code: string): string {
  const canonical = normalizeLinkCode(code)!;
  const lookup = linkCodeLookupComponent(canonical);
  let tail = "";
  for (const ch of canonical.slice(lookup.length)) {
    tail += CROCKFORD[(CROCKFORD.indexOf(ch) + 7) % 32];
  }
  return lookup + tail;
}

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

// ---------------------------------------------------------------------------

describe("pure helpers (no DB)", () => {
  it("generateLinkCode: 18 Crockford symbols (90 bits) grouped in fours, unique across 2000 draws", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i++) {
      const c = generateLinkCode();
      expect(c).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){3}-[0-9A-HJKMNP-TV-Z]{2}$/);
      seen.add(c);
    }
    expect(seen.size).toBe(2000);
  });

  it("the code is SPLIT: the lookup hash covers only the first 8 symbols, the verifier covers all 18", async () => {
    const canonical = normalizeLinkCode(generateLinkCode())!;
    const cousin = sameLookupDifferentTail(canonical);
    expect(linkCodeLookupComponent(canonical)).toBe(canonical.slice(0, 8));
    expect(cousin.slice(0, 8)).toBe(canonical.slice(0, 8));
    expect(cousin).not.toBe(canonical);
    // same row is found...
    expect(deriveLinkCodeLookupHash(cousin, keys)).toBe(deriveLinkCodeLookupHash(canonical, keys));
    // ...but the verifier separates them, which is what makes a wrong guess countable
    const salt = randomBytes(16);
    expect(
      (await deriveLinkCodeVerifier(cousin, salt)).equals(
        await deriveLinkCodeVerifier(canonical, salt),
      ),
    ).toBe(false);
  });

  it("normalizeLinkCode: case/spacing/dash tolerant, maps Crockford confusables, rejects wrong length or alphabet", () => {
    const c = generateLinkCode();
    const canon = normalizeLinkCode(c)!;
    expect(canon).toHaveLength(18);
    expect(normalizeLinkCode(c.toLowerCase())).toBe(canon);
    expect(normalizeLinkCode(`  ${c.replace(/-/g, " ")} `)).toBe(canon);
    expect(normalizeLinkCode(canon.replace(/0/g, "O").replace(/1/g, "I"))).toBe(canon);
    expect(formatLinkCode(canon)).toBe(c);
    expect(normalizeLinkCode("ABCD-EFGH")).toBeNull();
    expect(normalizeLinkCode("UUUU-UUUU-UUUU-UUUU-UU")).toBeNull();
    expect(normalizeLinkCode("")).toBeNull();
  });

  it("lookup hash is keyed + domain-separated; verifier is salted scrypt (32 bytes); both refuse short key material", async () => {
    const canon = normalizeLinkCode(generateLinkCode())!;
    expect(deriveLinkCodeLookupHash(canon, keys)).toMatch(/^[0-9a-f]{64}$/);
    expect(deriveLinkCodeLookupHash(canon, keys)).toBe(deriveLinkCodeLookupHash(canon, keys));
    expect(deriveLinkCodeLookupHash(canon, { lookupHmacKey: randomBytes(32) })).not.toBe(
      deriveLinkCodeLookupHash(canon, keys),
    );
    const salt = randomBytes(16);
    const v = await deriveLinkCodeVerifier(canon, salt);
    expect(v).toHaveLength(32);
    expect(v.equals(await deriveLinkCodeVerifier(canon, salt))).toBe(true);
    expect(v.equals(await deriveLinkCodeVerifier(canon, randomBytes(16)))).toBe(false);
    await expect(deriveLinkCodeVerifier(canon, Buffer.alloc(8))).rejects.toThrow(/at least 16/);
    expect(() => deriveLinkCodeLookupHash(canon, { lookupHmacKey: Buffer.alloc(4) })).toThrow(
      /at least 16/,
    );
  });
});

describe("0043 definer shape and grants", () => {
  it("all three are SECURITY DEFINER with search_path = public, pg_temp; EXECUTE to app only", async () => {
    const { rows } = await ctx.owner.query(
      `SELECT p.proname, p.prosecdef, p.proconfig,
              has_function_privilege('app', p.oid, 'EXECUTE')        AS app,
              has_function_privilege('app_worker', p.oid, 'EXECUTE') AS worker,
              has_function_privilege('readonly', p.oid, 'EXECUTE')   AS ro
         FROM pg_proc p
        WHERE p.proname IN ('link_code_issue', 'link_code_salt', 'link_code_consume')
        ORDER BY 1`,
    );
    expect(rows.map((r) => (r as { proname: string }).proname)).toEqual([
      "link_code_consume",
      "link_code_issue",
      "link_code_salt",
    ]);
    for (const r of rows as {
      prosecdef: boolean;
      proconfig: string[];
      app: boolean;
      worker: boolean;
      ro: boolean;
    }[]) {
      expect(r.prosecdef).toBe(true);
      expect(r.proconfig).toEqual(["search_path=public, pg_temp"]);
      expect(r.app).toBe(true);
      expect(r.worker).toBe(false);
      expect(r.ro).toBe(false);
    }
  });

  it("app_worker / readonly are permission-denied; app still has no table access on link_codes", async () => {
    for (const pool of [ctx.workerPool, ctx.readonlyPool]) {
      await expect(pool.query(`SELECT link_code_salt($1)`, ["x".repeat(64)])).rejects.toMatchObject(
        {
          code: "42501",
        },
      );
    }
    await expect(ctx.appPool.query(`SELECT count(*) FROM link_codes`)).rejects.toMatchObject({
      code: "42501",
    });
  });
});

describe("link_code_issue", () => {
  it("account-issued: derives the person server-side, 10-minute TTL, max_attempts 5, supersedes the person's earlier live code", async () => {
    const person = await makePerson();
    const account = await makeAccount(person);
    const first = await issueLinkCode(ctx.appPool, { accountId: account }, keys);
    expect(first.sourcePersonId).toBe(person);
    expect(first.superseded).toBe(0);
    expect(first.code).toMatch(/^[0-9A-Z]{4}(-[0-9A-Z]{4}){3}-[0-9A-Z]{2}$/);
    // Remaining TTL on the database clock (one statement): the host clock cannot skew it.
    const ttlMs = await remainingTtlMs(first.linkCodeId);
    expect(ttlMs).toBeGreaterThan((LINK_CODE_TTL_SECONDS - 30) * 1000);
    expect(ttlMs).toBeLessThanOrEqual(LINK_CODE_TTL_SECONDS * 1000);
    // Clock-free: the expiry the function returned is the expiry that was stored.
    expect(first.expiresAt).toEqual((await row(first.linkCodeId)).expires_at);
    expect((await row(first.linkCodeId)).max_attempts).toBe(LINK_CODE_MAX_ATTEMPTS);

    const second = await issueLinkCode(ctx.appPool, { accountId: account }, keys);
    expect(second.superseded).toBe(1);
    expect((await row(first.linkCodeId)).revoked_at).not.toBeNull();
    expect((await row(second.linkCodeId)).revoked_at).toBeNull();
  });

  it("channel-issued: derives the person from the channel identity; a code issued from the account of the SAME person supersedes it (one live code per person)", async () => {
    const person = await makePerson();
    const channel = await makeChannel(person);
    const account = await makeAccount(person);
    const viaChannel = await issueLinkCode(ctx.appPool, { channelIdentityId: channel }, keys);
    expect(viaChannel.sourcePersonId).toBe(person);
    const viaAccount = await issueLinkCode(ctx.appPool, { accountId: account }, keys);
    expect(viaAccount.superseded).toBe(1);
    expect((await row(viaChannel.linkCodeId)).revoked_at).not.toBeNull();
  });

  it("refuses an ineligible issuer with 42501: inactive channel, channel of a merged person, legacy telegram channel, unknown account", async () => {
    const active = await makePerson();
    const merged = await makePerson("merged");
    for (const issuer of [
      { channelIdentityId: await makeChannel(active, { status: "inactive" }) },
      { channelIdentityId: await makeChannel(merged) },
      { channelIdentityId: await makeLegacyTelegramChannel(active) },
      { accountId: randomUUID() },
    ]) {
      await expect(issueLinkCode(ctx.appPool, issuer, keys)).rejects.toMatchObject({
        code: "42501",
      });
    }
  });

  it("input contract is 22023: XOR issuer, TTL cap 1 hour, max_attempts 1..20, short hashes", async () => {
    const person = await makePerson();
    const account = await makeAccount(person);
    await expect(
      issueLinkCode(ctx.appPool, { accountId: account }, keys, { ttlSeconds: 3601 }),
    ).rejects.toMatchObject({
      code: "22023",
    });
    await expect(
      issueLinkCode(ctx.appPool, { accountId: account }, keys, { maxAttempts: 21 }),
    ).rejects.toMatchObject({
      code: "22023",
    });
    const h16 = Buffer.alloc(16, 1);
    await expect(
      ctx.appPool.query(`SELECT * FROM link_code_issue(NULL, NULL, $1, $2, $2)`, [
        "a".repeat(64),
        h16,
      ]),
    ).rejects.toMatchObject({ code: "22023" });
    await expect(
      ctx.appPool.query(`SELECT * FROM link_code_issue(NULL, $1, 'short', $2, $2)`, [account, h16]),
    ).rejects.toMatchObject({ code: "22023" });
    await expect(
      ctx.appPool.query(`SELECT * FROM link_code_issue(NULL, $1, $2, $3, $3)`, [
        account,
        "a".repeat(64),
        Buffer.alloc(8),
      ]),
    ).rejects.toMatchObject({ code: "22023" });
    // the wrapper refuses a malformed party before any SQL
    await expect(issueLinkCode(ctx.appPool, {} as never, keys)).rejects.toThrow(/exactly one/);
  });
});

describe("link_code_consume — happy paths", () => {
  it("account-issued code consumed by a channel target of ANOTHER person → consumed A→B, issuer 'account'; single-use", async () => {
    const a = await makePerson();
    const b = await makePerson();
    const accA = await makeAccount(a);
    const chB = await makeChannel(b);
    const issued = await issueLinkCode(ctx.appPool, { accountId: accA }, keys);
    // user typed it lowercase with spaces
    const r = await consumeLinkCode(
      ctx.appPool,
      ` ${issued.code.toLowerCase().replace(/-/g, " ")} `,
      { channelIdentityId: chB },
      keys,
    );
    expect(r).toMatchObject({
      outcome: "consumed",
      linkCodeId: issued.linkCodeId,
      sourcePersonId: a,
      targetPersonId: b,
      issuerKind: "account",
      failedAttempts: 0,
    });
    expect((await row(issued.linkCodeId)).consumed_at).not.toBeNull();
    const again = await consumeLinkCode(ctx.appPool, issued.code, { channelIdentityId: chB }, keys);
    expect(again.outcome).toBe("invalid");
    expect(again.linkCodeId).toBeNull();
  });

  it("channel-issued code consumed by an account target → consumed, issuer 'channel'", async () => {
    const a = await makePerson();
    const b = await makePerson();
    const chA = await makeChannel(a);
    const accB = await makeAccount(b);
    const issued = await issueLinkCode(ctx.appPool, { channelIdentityId: chA }, keys);
    const r = await consumeLinkCode(ctx.appPool, issued.code, { accountId: accB }, keys);
    expect(r).toMatchObject({
      outcome: "consumed",
      sourcePersonId: a,
      targetPersonId: b,
      issuerKind: "channel",
    });
  });

  it("target already IS the issuer's person → same_person, and the code is still spent", async () => {
    const a = await makePerson();
    const accA = await makeAccount(a);
    const chA = await makeChannel(a);
    const issued = await issueLinkCode(ctx.appPool, { accountId: accA }, keys);
    const r = await consumeLinkCode(ctx.appPool, issued.code, { channelIdentityId: chA }, keys);
    expect(r.outcome).toBe("same_person");
    expect(r.sourcePersonId).toBe(a);
    expect(r.targetPersonId).toBe(a);
    expect((await row(issued.linkCodeId)).consumed_at).not.toBeNull();
  });
});

describe("link_code_consume — verifier accounting (spec §4 step 4)", () => {
  it("a mistyped SECRET TAIL against a real row: failed_attempts+1 and a cooldown; the right code is refused DURING the cooldown without touching the row", async () => {
    const a = await makePerson();
    const b = await makePerson();
    const accA = await makeAccount(a);
    const chB = await makeChannel(b);
    const issued = await issueLinkCode(ctx.appPool, { accountId: accA }, keys);
    const mistyped = sameLookupDifferentTail(issued.code);

    const wrong = await consumeLinkCode(ctx.appPool, mistyped, { channelIdentityId: chB }, keys, {
      cooldownSeconds: 5,
    });
    expect(wrong).toMatchObject({ outcome: "wrong_code", failedAttempts: 1, maxAttempts: 5 });
    expect(wrong.lockedUntil!.getTime()).toBeGreaterThan(Date.now());
    expect(wrong.linkCodeId).toBeNull(); // an attempt result still leaks no refs

    const during = await consumeLinkCode(
      ctx.appPool,
      issued.code,
      { channelIdentityId: chB },
      keys,
    );
    expect(during.outcome).toBe("invalid");
    expect((await row(issued.linkCodeId)).failed_attempts).toBe(1); // no double accounting
    expect((await row(issued.linkCodeId)).consumed_at).toBeNull();

    await ctx.owner.query(`UPDATE link_codes SET locked_until = NULL WHERE id = $1`, [
      issued.linkCodeId,
    ]);
    const after = await consumeLinkCode(ctx.appPool, issued.code, { channelIdentityId: chB }, keys);
    expect(after.outcome).toBe("consumed");
    expect(after.failedAttempts).toBe(1);
  });

  it("attempts cap: at failed_attempts = max_attempts the row is terminal — further wrong OR right codes return invalid with zero mutation", async () => {
    const a = await makePerson();
    const b = await makePerson();
    const accA = await makeAccount(a);
    const chB = await makeChannel(b);
    const issued = await issueLinkCode(ctx.appPool, { accountId: accA }, keys, { maxAttempts: 2 });
    const mistyped = sameLookupDifferentTail(issued.code);
    const guess = () =>
      consumeLinkCode(ctx.appPool, mistyped, { channelIdentityId: chB }, keys, {
        cooldownSeconds: 0,
      });

    expect(await guess()).toMatchObject({ outcome: "wrong_code", failedAttempts: 1 });
    expect(await guess()).toMatchObject({ outcome: "wrong_code", failedAttempts: 2 });
    expect(await guess()).toMatchObject({ outcome: "invalid", failedAttempts: null });
    expect(
      (
        await consumeLinkCode(ctx.appPool, issued.code, { channelIdentityId: chB }, keys, {
          cooldownSeconds: 0,
        })
      ).outcome,
    ).toBe("invalid"); // a capped code is dead even for the person who owns it
    const r = await row(issued.linkCodeId);
    expect(r.failed_attempts).toBe(2);
    expect(r.consumed_at).toBeNull();
  });

  it("the verifier is compared under a fresh per-call nonce digest, not with a short-circuiting bytea memcmp (spec §4 constant time)", async () => {
    const { rows } = await ctx.owner.query<{ nonced: boolean }>(
      `SELECT prosrc LIKE '%gen_random_bytes%' AND prosrc LIKE '%digest(v_nonce%' AS nonced
         FROM pg_proc WHERE proname = 'link_code_consume'`,
    );
    expect(rows[0]!.nonced).toBe(true);
  });

  it("a code that does not exist, or is malformed, is invalid — no accounting anywhere, no throw", async () => {
    const a = await makePerson();
    const accA = await makeAccount(a);
    expect(
      (await consumeLinkCode(ctx.appPool, generateLinkCode(), { accountId: accA }, keys)).outcome,
    ).toBe("invalid");
    expect((await consumeLinkCode(ctx.appPool, "nope", { accountId: accA }, keys)).outcome).toBe(
      "invalid",
    );
    expect(
      (await consumeLinkCode(ctx.appPool, "UUUU-UUUU-UUUU-UUUU-UU", { accountId: accA }, keys))
        .outcome,
    ).toBe("invalid");
    // definer-level: unknown lookup → invalid row (not an error); short verifier → 22023
    const { rows } = await ctx.appPool.query(
      `SELECT outcome FROM link_code_consume($1, $2, NULL, $3)`,
      ["q".repeat(64), randomBytes(32), accA],
    );
    expect(rows[0]).toEqual({ outcome: "invalid" });
    await expect(
      ctx.appPool.query(`SELECT outcome FROM link_code_consume($1, $2, NULL, $3)`, [
        "q".repeat(64),
        Buffer.alloc(4),
        accA,
      ]),
    ).rejects.toMatchObject({ code: "22023" });
  });
});

describe("link_code_consume — terminal checks come BEFORE accounting (spec §4 step 3)", () => {
  it("expired: the right verifier after expiry is invalid; failed_attempts stays 0", async () => {
    const a = await makePerson();
    const b = await makePerson();
    const accA = await makeAccount(a);
    const chB = await makeChannel(b);
    const issued = await issueLinkCode(ctx.appPool, { accountId: accA }, keys, { ttlSeconds: 1 });
    await new Promise((r) => setTimeout(r, 1_200));
    expect(
      (await consumeLinkCode(ctx.appPool, issued.code, { channelIdentityId: chB }, keys)).outcome,
    ).toBe("invalid");
    expect((await row(issued.linkCodeId)).failed_attempts).toBe(0);
  });

  it("revoked (superseded by a later issue): the earlier code is invalid even with its right verifier", async () => {
    const a = await makePerson();
    const b = await makePerson();
    const accA = await makeAccount(a);
    const chB = await makeChannel(b);
    const first = await issueLinkCode(ctx.appPool, { accountId: accA }, keys);
    const second = await issueLinkCode(ctx.appPool, { accountId: accA }, keys);
    expect(
      (await consumeLinkCode(ctx.appPool, first.code, { channelIdentityId: chB }, keys)).outcome,
    ).toBe("invalid");
    expect(
      (await consumeLinkCode(ctx.appPool, second.code, { channelIdentityId: chB }, keys)).outcome,
    ).toBe("consumed");
  });

  it("issuer drift: the issuing channel deactivated, or the issuer's person merged, after issue → invalid; a wrong verifier then does NOT count either", async () => {
    const a = await makePerson();
    const b = await makePerson();
    const chA = await makeChannel(a);
    const accB = await makeAccount(b);
    const issued = await issueLinkCode(ctx.appPool, { channelIdentityId: chA }, keys);

    await ctx.owner.query(`UPDATE channel_identities SET status = 'inactive' WHERE id = $1`, [chA]);
    expect(
      (await consumeLinkCode(ctx.appPool, issued.code, { accountId: accB }, keys)).outcome,
    ).toBe("invalid");
    await ctx.owner.query(`UPDATE channel_identities SET status = 'active' WHERE id = $1`, [chA]);

    await ctx.owner.query(
      `UPDATE persons SET status = 'merged', merged_into_person_id = $2 WHERE id = $1`,
      [a, b],
    );
    expect(
      (await consumeLinkCode(ctx.appPool, issued.code, { accountId: accB }, keys)).outcome,
    ).toBe("invalid");
    // and a guess that WOULD be countable (right lookup, wrong tail) is not counted either,
    // because the issuer-drift check runs before any accounting
    expect(
      (
        await consumeLinkCode(
          ctx.appPool,
          sameLookupDifferentTail(issued.code),
          { accountId: accB },
          keys,
        )
      ).outcome,
    ).toBe("invalid");
    const r = await row(issued.linkCodeId);
    expect(r.failed_attempts).toBe(0);
    expect(r.consumed_at).toBeNull();
    await ctx.owner.query(
      `UPDATE persons SET status = 'active', merged_into_person_id = NULL WHERE id = $1`,
      [a],
    );
  });

  it("ineligible TARGET raises 42501 before the code is touched (merged person's channel, legacy telegram channel); XOR target is 22023", async () => {
    const a = await makePerson();
    const accA = await makeAccount(a);
    const merged = await makePerson("merged");
    const issued = await issueLinkCode(ctx.appPool, { accountId: accA }, keys);
    for (const target of [
      { channelIdentityId: await makeChannel(merged) },
      { channelIdentityId: await makeLegacyTelegramChannel(await makePerson()) },
    ]) {
      await expect(consumeLinkCode(ctx.appPool, issued.code, target, keys)).rejects.toMatchObject({
        code: "42501",
      });
    }
    await expect(
      ctx.appPool.query(`SELECT * FROM link_code_consume($1, $2, NULL, NULL)`, [
        "q".repeat(64),
        randomBytes(32),
      ]),
    ).rejects.toMatchObject({ code: "22023" });
    const r = await row(issued.linkCodeId);
    expect(r.failed_attempts).toBe(0);
    expect(r.consumed_at).toBeNull();
  });
});

describe("link_code_consume — concurrency (spec §4 step 2/5, 0034 lock order)", () => {
  it("takes the accounts parent FIRST: a consume blocks behind a held accounts lock and completes after release (no inversion, no 40P01)", async () => {
    const a = await makePerson();
    const b = await makePerson();
    const accA = await makeAccount(a);
    const chB = await makeChannel(b);
    const issued = await issueLinkCode(ctx.appPool, { accountId: accA }, keys);
    const holder = await ctx.superuserDb.pool.connect();
    const consumer = await ctx.appPool.connect();
    let pending: Promise<{ rows: unknown[] }> | undefined;
    try {
      await holder.query("BEGIN");
      await holder.query(`SELECT 1 FROM accounts WHERE id = $1 FOR UPDATE`, [accA]);
      const holderPid = await backendPid(holder);
      const consumerPid = await backendPid(consumer);
      const lookup = deriveLinkCodeLookupHash(normalizeLinkCode(issued.code)!, keys);
      const { rows: saltRows } = await consumer.query(`SELECT link_code_salt($1) AS salt`, [
        lookup,
      ]);
      const verifier = await deriveLinkCodeVerifier(
        normalizeLinkCode(issued.code)!,
        (saltRows[0] as { salt: Buffer }).salt,
      );
      pending = consumer.query(`SELECT outcome FROM link_code_consume($1, $2, $3, NULL)`, [
        lookup,
        verifier,
        chB,
      ]);
      await waitUntilBlockedByHolder(holderPid, consumerPid);
      expect((await row(issued.linkCodeId)).consumed_at).toBeNull(); // nothing claimed while blocked
      await holder.query("COMMIT");
      expect((await pending).rows[0]).toEqual({ outcome: "consumed" });
    } finally {
      await holder.query("ROLLBACK").catch(() => {});
      holder.release();
      if (pending) await pending.catch(() => {});
      consumer.release();
    }
  });

  it("two concurrent consumes of one code: exactly one 'consumed', the other 'invalid' (row lock + conditional claim)", async () => {
    const a = await makePerson();
    const b = await makePerson();
    const accA = await makeAccount(a);
    const chB = await makeChannel(b);
    const issued = await issueLinkCode(ctx.appPool, { accountId: accA }, keys);
    const [r1, r2] = await Promise.all([
      consumeLinkCode(ctx.appPool, issued.code, { channelIdentityId: chB }, keys),
      consumeLinkCode(ctx.appPool, issued.code, { channelIdentityId: chB }, keys),
    ]);
    expect([r1.outcome, r2.outcome].sort()).toEqual(["consumed", "invalid"]);
  });
});

describe("_link_code_retention (0016/DD-80 30-day precedent)", () => {
  it("sweeps terminal rows past the window, keeps live ones, is bounded, and is granted to nobody", async () => {
    const a = await makePerson();
    const b = await makePerson();
    const accA = await makeAccount(a);
    const chB = await makeChannel(b);

    const consumed = await issueLinkCode(ctx.appPool, { accountId: accA }, keys);
    expect(
      (await consumeLinkCode(ctx.appPool, consumed.code, { channelIdentityId: chB }, keys)).outcome,
    ).toBe("consumed");
    const live = await issueLinkCode(ctx.appPool, { accountId: accA }, keys);
    await ctx.owner.query(
      `UPDATE link_codes SET created_at = now() - interval '40 days' WHERE id IN ($1, $2)`,
      [consumed.linkCodeId, live.linkCodeId],
    );

    const swept = await ctx.owner.query<{ n: number }>(`SELECT _link_code_retention() AS n`);
    expect(swept.rows[0]!.n).toBe(1); // only the terminal one
    expect(await row(live.linkCodeId)).toBeDefined(); // an old but LIVE code survives
    await expect(
      ctx.owner.query(`SELECT 1 FROM link_codes WHERE id = $1`, [consumed.linkCodeId]),
    ).resolves.toMatchObject({ rows: [] });

    await expect(
      ctx.owner.query(`SELECT _link_code_retention(interval '0')`),
    ).rejects.toMatchObject({
      code: "22023",
    });
    await expect(
      ctx.owner.query(`SELECT _link_code_retention(interval '30 days', 0)`),
    ).rejects.toMatchObject({
      code: "22023",
    });
    for (const pool of [ctx.appPool, ctx.workerPool, ctx.readonlyPool]) {
      await expect(pool.query(`SELECT _link_code_retention()`)).rejects.toMatchObject({
        code: "42501",
      });
    }
  });
});
