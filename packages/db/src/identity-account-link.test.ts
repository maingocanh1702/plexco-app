import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { setupRlsTestContext, type RlsTestContext } from "./test-harness.js";

/**
 * identity-account-link-core — real-Postgres tests for the DD-32 person-account
 * convergence CORE (owner ruling 2026-08-25, option A: an INTERNAL partial helper,
 * NOT app-facing). The function is owner/definer-only — no runtime role is granted
 * EXECUTE — so these tests call it as `ctx.owner`. Two boundaries are still asserted
 * under the real runtime pools: (a) app/app_worker/readonly are permission-denied on
 * the function itself, and (b) app cannot direct-SELECT the protected identity
 * tables. Seeds are written via `ctx.owner` (app holds zero privilege on them).
 */

let ctx: RlsTestContext;

beforeAll(async () => {
  ctx = await setupRlsTestContext("plexco_identity_link_check");
}, 180_000);

afterAll(async () => {
  await ctx?.teardown();
});

// --- seed helpers (owner role — app cannot write these tables) ---------------

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

type Row = {
  qualified: boolean;
  account_ref: string | null;
  person_ref: string | null;
  binding_version: string | null;
};

/** Call the partial core AS OWNER/DEFINER — no runtime role is granted EXECUTE (option A). */
async function resolveAsOwner(channelIdentityId: string): Promise<Row> {
  const { rows } = await ctx.owner.query(
    `SELECT qualified, account_ref, person_ref, binding_version
       FROM resolve_deferred_payment_account_core($1::uuid)`,
    [channelIdentityId],
  );
  return rows[0] as Row;
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

/** Every deny returns the identical cause-agnostic row — qualified:false, ALL refs null. */
function expectDeny(row: Row): void {
  expect(row).toEqual({
    qualified: false,
    account_ref: null,
    person_ref: null,
    binding_version: null,
  });
}

const SHA256_HEX = /^[0-9a-f]{64}$/;

/**
 * The output invariant: qualified=true ALWAYS carries non-null account_ref, person_ref
 * and a sha256 binding_version (never a malformed half-row). The concurrent-account-
 * replacement race that could violate this is prevented by construction in the function
 * (FOUND guards + IS DISTINCT FROM, codex round 3) and is not deterministically
 * injectable from a test — the function is a single atomic call — so it is asserted here
 * on every qualified path instead.
 */
function expectQualified(row: Row): void {
  expect(row.qualified).toBe(true);
  expect(row.account_ref).not.toBeNull();
  expect(row.person_ref).not.toBeNull();
  expect(row.binding_version).toMatch(SHA256_HEX);
}

// --- boundary: no runtime role can call the function; app cannot read the tables --

describe("boundary — the partial core is owner/definer-only (option A)", () => {
  it("app, app_worker and readonly are ALL permission-denied on EXECUTE of the function", async () => {
    const id = randomUUID();
    for (const pool of [ctx.appPool, ctx.workerPool, ctx.readonlyPool]) {
      await expect(
        pool.query(`SELECT * FROM resolve_deferred_payment_account_core($1::uuid)`, [id]),
      ).rejects.toThrow(/permission denied/i);
    }
  });

  it("app still has NO direct grant on any protected identity table the function reads", async () => {
    for (const table of [
      "persons",
      "accounts",
      "account_emails",
      "channel_identities",
      "merge_tombstones",
    ]) {
      await expect(
        ctx.appPool.query(`SELECT * FROM ${table} LIMIT 1`),
        `app must be denied on ${table}`,
      ).rejects.toThrow(/permission denied/i);
    }
  });

  it("owner/definer CAN execute it (the successor endpoint-complete resolver, DD-65..68, will wrap it)", async () => {
    const { ci } = await seedQualified();
    expect((await resolveAsOwner(ci)).qualified).toBe(true);
  });
});

// --- definer discipline ------------------------------------------------------

describe("definer discipline", () => {
  it("is SECURITY DEFINER with a pinned search_path (read-only definer, resolve_tenant_status_locked precedent)", async () => {
    const { rows } = await ctx.owner.query(
      `SELECT p.prosecdef, p.proconfig
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE p.proname = 'resolve_deferred_payment_account_core' AND n.nspname = 'public'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].prosecdef).toBe(true);
    expect(rows[0].proconfig).toContain("search_path=public, pg_temp");
  });

  it("grants EXECUTE to NO role (REVOKE-only) — has_function_privilege is false for every runtime role", async () => {
    for (const role of ["app", "app_worker", "readonly"]) {
      const { rows } = await ctx.owner.query(
        `SELECT has_function_privilege($1, 'resolve_deferred_payment_account_core(uuid)', 'EXECUTE') AS ok`,
        [role],
      );
      expect(rows[0].ok, `${role} must NOT have EXECUTE`).toBe(false);
    }
  });

  it("the migration's explicit REVOKE strips an app grant if one ever existed (belt-and-suspenders for the 0027 trusted-migration posture)", async () => {
    // The migration is owner-authored + trusted (owner ratification 2026-08-26): CREATE FUNCTION +
    // REVOKE FROM PUBLIC + revoke the runtime roles, per the 0027 posture. This asserts the REVOKE
    // statement is effective — the has_function_privilege test above already proves the resulting state.
    await ctx.owner.query(
      `GRANT EXECUTE ON FUNCTION resolve_deferred_payment_account_core(uuid) TO app`,
    );
    const granted = await ctx.owner.query(
      `SELECT has_function_privilege('app', 'resolve_deferred_payment_account_core(uuid)', 'EXECUTE') AS ok`,
    );
    expect(granted.rows[0].ok).toBe(true);
    // The migration's owner-only normalization (REVOKE from PUBLIC + every runtime role) removes it.
    await ctx.owner.query(
      `REVOKE ALL ON FUNCTION resolve_deferred_payment_account_core(uuid) FROM PUBLIC, app, app_worker, readonly`,
    );
    const revoked = await ctx.owner.query(
      `SELECT has_function_privilege('app', 'resolve_deferred_payment_account_core(uuid)', 'EXECUTE') AS ok`,
    );
    expect(revoked.rows[0].ok).toBe(false);
  });
});

// --- fail-closed decision matrix (§4) ---------------------------------------

describe("fail-closed decision matrix — every deny is generic {qualified:false}, zero mutation", () => {
  it("absent ChannelIdentity → not qualified", async () => {
    expect(await resolveAsOwner(randomUUID())).toMatchObject({
      qualified: false,
      account_ref: null,
      person_ref: null,
      binding_version: null,
    });
  });

  it("inactive ChannelIdentity → not qualified", async () => {
    const person = await makePerson();
    const ci = await makeChannelIdentity(person, { status: "inactive" });
    const account = await makeAccount(person);
    await addVerifiedEmail(account);
    expectDeny(await resolveAsOwner(ci));
  });

  it("deleted person → not qualified (frozen)", async () => {
    const person = await makePerson({ status: "deleted" });
    const ci = await makeChannelIdentity(person);
    const account = await makeAccount(person);
    await addVerifiedEmail(account);
    expectDeny(await resolveAsOwner(ci));
  });

  it("merged person with a NULL merge pointer → not qualified (merge-pending)", async () => {
    const person = await makePerson({ status: "merged", mergedInto: null });
    const ci = await makeChannelIdentity(person);
    expectDeny(await resolveAsOwner(ci));
  });

  it("verified account on a DIFFERENT person → not qualified (no convergence)", async () => {
    const personA = await makePerson();
    const ci = await makeChannelIdentity(personA);
    const personB = await makePerson();
    const account = await makeAccount(personB);
    await addVerifiedEmail(account);
    expectDeny(await resolveAsOwner(ci));
  });

  it("account with only a PENDING (unverified) email → not qualified", async () => {
    const person = await makePerson();
    const ci = await makeChannelIdentity(person);
    const account = await makeAccount(person);
    await addPendingEmail(account);
    expectDeny(await resolveAsOwner(ci));
  });

  it("account with a verified email BUT no person link (person_id NULL) → not qualified", async () => {
    const person = await makePerson();
    const ci = await makeChannelIdentity(person);
    const orphan = await makeAccount(null);
    await addVerifiedEmail(orphan);
    expectDeny(await resolveAsOwner(ci));
  });

  it("legacy Telegram account_identities WITHOUT a verified email does NOT qualify (DD-37 excluded)", async () => {
    const person = await makePerson();
    const ci = await makeChannelIdentity(person);
    const account = await makeAccount(person);
    await addLegacyAccountIdentity(account); // telegram identity, but NO account_emails
    expectDeny(await resolveAsOwner(ci));
  });

  it(">1 verified account on the canonical person → ambiguous → not qualified", async () => {
    const person = await makePerson();
    const ci = await makeChannelIdentity(person);
    const a1 = await makeAccount(person);
    const a2 = await makeAccount(person);
    await addVerifiedEmail(a1);
    await addVerifiedEmail(a2);
    expectDeny(await resolveAsOwner(ci));
  });

  it("a merge CYCLE fails closed (does not loop forever)", async () => {
    const a = await makePerson({ status: "merged" });
    const b = await makePerson({ status: "merged", mergedInto: a });
    await ctx.owner.query(`UPDATE persons SET merged_into_person_id = $1 WHERE id = $2`, [b, a]);
    const ci = await makeChannelIdentity(a);
    expectDeny(await resolveAsOwner(ci));
  });

  it("happy path: active CI → active person ← single verified account → qualified", async () => {
    const { ci, account, person } = await seedQualified();
    const row = await resolveAsOwner(ci);
    expectQualified(row);
    expect(row.account_ref).toBe(account);
    expect(row.person_ref).toBe(person);
  });

  it("merge chain: CI → merged person → active canonical, single verified account on canonical → qualified with canonical person_ref", async () => {
    const canonical = await makePerson();
    const old = await makePerson({ status: "merged", mergedInto: canonical });
    const ci = await makeChannelIdentity(old);
    const account = await makeAccount(canonical);
    await addVerifiedEmail(account);
    await tombstone(old, canonical); // path-compressed invariant: merged node → final canonical
    const row = await resolveAsOwner(ci);
    expectQualified(row);
    expect(row.person_ref).toBe(canonical);
    expect(row.account_ref).toBe(account);
  });

  // Exercises the full-chain collection + comparison (PHASE 3 v_r_chain vs PHASE 1 v_chain).
  // The mid-call race the comparison guards against — the chain growing (A->C becoming
  // A->B->C) in the read->lock window so a new intermediate is never locked — is NOT
  // deterministically injectable from a test: the function is a single atomic call and does
  // not yield between phases. The guard is correct by construction (any chain difference fails
  // closed); this test proves the multi-hop chain path itself resolves.
  it("a two-hop merge chain (CI → A merged → B merged → C active) resolves to C, full chain revalidated", async () => {
    const c = await makePerson(); // active canonical
    const b = await makePerson({ status: "merged", mergedInto: c });
    const a = await makePerson({ status: "merged", mergedInto: b });
    const ci = await makeChannelIdentity(a);
    const account = await makeAccount(c);
    await addVerifiedEmail(account);
    await tombstone(a, c); // path-compressed: BOTH merged nodes point straight at final canonical c
    await tombstone(b, c);
    const row = await resolveAsOwner(ci);
    expectQualified(row);
    expect(row.person_ref).toBe(c);
    expect(row.account_ref).toBe(account);
  });

  it("NULL input → the cause-agnostic denied row (all refs null)", async () => {
    const { rows } = await ctx.owner.query(
      `SELECT qualified, account_ref, person_ref, binding_version
         FROM resolve_deferred_payment_account_core(NULL::uuid)`,
    );
    expectDeny(rows[0] as Row);
  });

  it("an ACTIVE person that still carries a merge pointer → not qualified (conflicted/inconsistent)", async () => {
    const target = await makePerson();
    const person = await makePerson(); // active
    const ci = await makeChannelIdentity(person);
    const account = await makeAccount(person);
    await addVerifiedEmail(account);
    // Force the inconsistent state: active status BUT with a merge pointer set.
    await ctx.owner.query(`UPDATE persons SET merged_into_person_id = $1 WHERE id = $2`, [
      target,
      person,
    ]);
    expectDeny(await resolveAsOwner(ci));
  });

  it("an ACTIVE canonical person that is tombstoned (merge_tombstones) → not qualified (divergent)", async () => {
    const person = await makePerson(); // active
    const ci = await makeChannelIdentity(person);
    const account = await makeAccount(person);
    await addVerifiedEmail(account);
    await tombstone(person); // active status, but a tombstone says it was merged away
    expectDeny(await resolveAsOwner(ci));
  });

  it("a merged chain node WITHOUT a merge_tombstones row → not qualified (incomplete merge; SEC-1 per-node corroboration)", async () => {
    const canonical = await makePerson();
    const old = await makePerson({ status: "merged", mergedInto: canonical });
    const ci = await makeChannelIdentity(old);
    const account = await makeAccount(canonical);
    await addVerifiedEmail(account);
    // merged_into says old→canonical, but the second authoritative source (merge_tombstones)
    // is silent → the walk is uncorroborated (possible incomplete merge) → fail closed.
    expectDeny(await resolveAsOwner(ci));
  });

  it("a merged chain node whose tombstone points to a DIFFERENT canonical → not qualified (divergent; SEC-1 per-node corroboration)", async () => {
    const canonical = await makePerson();
    const other = await makePerson(); // an unrelated person
    const old = await makePerson({ status: "merged", mergedInto: canonical });
    const ci = await makeChannelIdentity(old);
    const account = await makeAccount(canonical);
    await addVerifiedEmail(account);
    // merged_into says old→canonical, but the tombstone says old→other: the two authoritative
    // sources disagree → divergent merge state → fail closed.
    await tombstone(old, other);
    expectDeny(await resolveAsOwner(ci));
  });

  it("a TWO-HOP chain where the SECOND merged node's tombstone is MISSING → not qualified (per-node corroboration checks EVERY node, not just the first; SEC-1)", async () => {
    const c = await makePerson(); // active canonical
    const b = await makePerson({ status: "merged", mergedInto: c });
    const a = await makePerson({ status: "merged", mergedInto: b });
    const ci = await makeChannelIdentity(a);
    const account = await makeAccount(c);
    await addVerifiedEmail(account);
    await tombstone(a, c); // first merged node OK
    // b (SECOND merged node) has NO tombstone → an impl checking only the first node would wrongly
    // qualify; the per-node loop must deny.
    expectDeny(await resolveAsOwner(ci));
  });

  it("a TWO-HOP chain where the SECOND merged node's tombstone points to the WRONG canonical → not qualified (SEC-1)", async () => {
    const c = await makePerson();
    const other = await makePerson();
    const b = await makePerson({ status: "merged", mergedInto: c });
    const a = await makePerson({ status: "merged", mergedInto: b });
    const ci = await makeChannelIdentity(a);
    const account = await makeAccount(c);
    await addVerifiedEmail(account);
    await tombstone(a, c); // first merged node OK
    await tombstone(b, other); // second merged node divergent → deny
    expectDeny(await resolveAsOwner(ci));
  });

  it("a verified account on a MERGED source node, none on the canonical → not qualified (chain-wide fail-closed; owner ratification 2026-08-26)", async () => {
    const canonical = await makePerson();
    const old = await makePerson({ status: "merged", mergedInto: canonical });
    const ci = await makeChannelIdentity(old);
    await tombstone(old, canonical); // SEC-1 satisfied so the account check is reached
    const account = await makeAccount(old); // verified account lingers on the MERGED source node
    await addVerifiedEmail(account);
    // count across the chain = 1, but it does NOT resolve to the canonical → NOT FOUND → deny.
    expectDeny(await resolveAsOwner(ci));
  });

  it("a verified account on the canonical PLUS another on a MERGED source node → ambiguous → not qualified (chain-wide count)", async () => {
    const canonical = await makePerson();
    const old = await makePerson({ status: "merged", mergedInto: canonical });
    const ci = await makeChannelIdentity(old);
    await tombstone(old, canonical); // SEC-1 satisfied
    await addVerifiedEmail(await makeAccount(canonical)); // A2 on the canonical
    await addVerifiedEmail(await makeAccount(old)); // A1 lingering on the merged source node
    // count across the chain = 2 → ambiguous → deny (a canonical-only count would have qualified).
    expectDeny(await resolveAsOwner(ci));
  });
});

// --- merge-adjacent negatives: person_id convergence is the ONLY bridge ------

describe("merge-adjacent negatives — raw ids / provider equality are never a join key", () => {
  it("a channel lookup-hash equal to an account_identities.platform_user_hash does NOT bridge without person convergence", async () => {
    const shared = `collision-${randomUUID()}`;
    const personA = await makePerson();
    const ci = await makeChannelIdentity(personA, { platform: "messenger", hash: shared });
    const personB = await makePerson();
    const account = await makeAccount(personB);
    await addVerifiedEmail(account);
    await ctx.owner.query(
      `INSERT INTO account_identities (id, account_id, platform, platform_user_hash, verified_at)
         VALUES ($1, $2, 'messenger', $3, now())`,
      [randomUUID(), account, shared],
    );
    // personA has no account → not qualified. Raw-hash equality never crosses the person boundary.
    expectDeny(await resolveAsOwner(ci));
  });
});

// --- binding_version determinism & drift sensitivity -------------------------

describe("binding_version (deterministic snapshot recheck token for the future finalizer)", () => {
  it("is deterministic across two resolves of an unchanged binding", async () => {
    const { ci } = await seedQualified();
    const first = await resolveAsOwner(ci);
    const second = await resolveAsOwner(ci);
    expect(first.binding_version).toBe(second.binding_version);
    expect(first.binding_version).toMatch(SHA256_HEX);
  });

  it("changes when the ChannelIdentity is re-parented to a different qualified person", async () => {
    const { ci } = await seedQualified();
    const before = await resolveAsOwner(ci);

    const other = await makePerson();
    const otherAccount = await makeAccount(other);
    await addVerifiedEmail(otherAccount);
    await ctx.owner.query(`UPDATE channel_identities SET person_id = $1 WHERE id = $2`, [
      other,
      ci,
    ]);

    const after = await resolveAsOwner(ci);
    expect(after.qualified).toBe(true);
    expect(after.person_ref).toBe(other);
    expect(after.binding_version).not.toBe(before.binding_version);
  });

  it("flips to not-qualified when the canonical person is merged away (drift the finalizer detects)", async () => {
    const { ci, person } = await seedQualified();
    expect((await resolveAsOwner(ci)).qualified).toBe(true);
    const successor = await makePerson();
    await ctx.owner.query(
      `UPDATE persons SET status = 'merged', merged_into_person_id = $1 WHERE id = $2`,
      [successor, person],
    );
    expectDeny(await resolveAsOwner(ci));
  });
});

// --- current-state sensitivity: exactly-one reflects live membership ----------
// This is SNAPSHOT semantics by design (owner ruling): the resolution reflects the
// state AT RESOLVE TIME. Full serialization across concurrent email-verify /
// account-insert flows is out of scope here and owned by the finalizer's
// binding_version recheck under its own lock.

describe("current-state sensitivity — account-insert / email-delete flip the outcome", () => {
  it("a SECOND verified account added after a qualified state flips the resolve to not-qualified (ambiguous)", async () => {
    const { ci, person } = await seedQualified();
    expect((await resolveAsOwner(ci)).qualified).toBe(true);
    const second = await makeAccount(person);
    await addVerifiedEmail(second);
    expectDeny(await resolveAsOwner(ci));
  });

  it("deleting the verified email after a qualified state flips the resolve to not-qualified", async () => {
    const { ci, email } = await seedQualified();
    expect((await resolveAsOwner(ci)).qualified).toBe(true);
    await ctx.owner.query(`DELETE FROM account_emails WHERE id = $1`, [email]);
    expectDeny(await resolveAsOwner(ci));
  });
});

// --- two-connection barrier: the FOR SHARE locks + revalidation are load-bearing ---

describe("concurrency barrier — FOR SHARE locks + revalidation (two-connection)", () => {
  it("a binding change committed WHILE the resolver is blocked acquiring its person FOR SHARE lock → deny (not a stale qualify)", async () => {
    const { ci, person } = await seedQualified();
    const successor = await makePerson();

    // tx B holds the canonical person FOR UPDATE, so the resolver's phase-2 FOR SHARE on it must wait.
    // tx A runs the resolver (owner-only fn; superuser may EXECUTE). Both are superuser connections.
    const b = await ctx.superuserDb.pool.connect();
    const a = await ctx.superuserDb.pool.connect();
    let bCommitted = false;
    try {
      // A's backend PID, captured before A is busy running the resolver.
      const aPid = (await a.query(`SELECT pg_backend_pid() AS pid`)).rows[0].pid as number;

      await b.query("BEGIN");
      await b.query(`SELECT id FROM persons WHERE id = $1 FOR UPDATE`, [person]);

      // Fire the resolver; phase 1 qualifies, then it blocks acquiring FOR SHARE on `person`.
      const aResult = a.query(
        `SELECT qualified FROM resolve_deferred_payment_account_core($1::uuid)`,
        [ci],
      );

      // DETERMINISTIC sync (not an arbitrary sleep — codex round 5): wait until A's backend is actually
      // BLOCKED by another transaction (pg_blocking_pids is non-empty), which proves the resolver
      // reached its phase-2 FOR SHARE AFTER already qualifying in phase 1. So the eventual deny MUST
      // come from phase-3 revalidation, not from a phase-1 read of the post-merge state.
      let blocked = false;
      for (let i = 0; i < 400 && !blocked; i++) {
        const { rows } = await ctx.owner.query(`SELECT pg_blocking_pids($1) AS blockers`, [aPid]);
        blocked = (rows[0].blockers as number[]).length > 0;
        if (!blocked) await new Promise((r) => setTimeout(r, 20));
      }
      expect(blocked, "resolver backend must be blocked on its FOR SHARE before B mutates").toBe(
        true,
      );

      // MERGE the canonical person away under B and release the lock. B mutates `person` — which A is
      // WAITING for, not holding — so there is no deadlock (A holds FOR SHARE only on the account/email,
      // which B never touches).
      await b.query(
        `UPDATE persons SET status = 'merged', merged_into_person_id = $1 WHERE id = $2`,
        [successor, person],
      );
      await b.query("COMMIT");
      bCommitted = true;

      // A resumes, revalidates the full chain under lock, sees it changed → generic deny.
      const { rows } = await aResult;
      expect(rows[0].qualified).toBe(false);
    } finally {
      // Defensive isolation: if an assertion above threw before B committed, B still holds an open
      // transaction (BEGIN + FOR UPDATE). Roll it back so the open transaction is not returned to the
      // pool and inherited by a later test. On the happy path B already COMMITted, so this is skipped.
      if (!bCommitted) await b.query("ROLLBACK").catch(() => {});
      b.release();
      a.release();
    }
  });
});
