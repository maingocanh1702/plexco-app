import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fixtures } from "./roster-money-fixtures.js";
import { setupRlsTestContext, type RlsTestContext } from "./test-harness.js";

/**
 * Real-Postgres tests for 0062 (lane L11, DD-39 gender pricing): the persons gender columns, the
 * per-gender session prices, person_gender_read / person_gender_update and
 * charge_gender_for_derivation. Runtime calls run as role `app` (ctx.appPool) with the tenant GUC
 * set inside the transaction, the production way; the owner connection only seeds rows and runs
 * catalog probes.
 */
let ctx: RlsTestContext;
const fx = fixtures(() => ctx);

beforeAll(async () => {
  ctx = await setupRlsTestContext("plexco_gender_pricing_definers");
}, 180_000);
afterAll(async () => {
  await ctx?.teardown();
});

type Q = (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
/** One app-role transaction (tenant GUC unset when null); rolled back unless `commit`. */
async function asApp<T>(tenantId: string | null, fn: (q: Q) => Promise<T>, commit = false) {
  const c = await ctx.appPool.connect();
  try {
    await c.query("BEGIN");
    if (tenantId) await c.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
    const out = await fn((text, params) => c.query(text, params));
    await c.query(commit ? "COMMIT" : "ROLLBACK");
    return out;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}

const ROLES = ["app", "app_worker", "readonly", "job_definer", "identity_definer", "chat_definer"];
const DEFINERS = [
  "public.person_gender_read(uuid)",
  "public.person_gender_update(uuid, uuid, bytea, text, boolean)",
  "public.charge_gender_for_derivation(text, uuid, uuid, uuid)",
];
/** Opaque test bytes: the definers never decrypt, so any blob + key version pair will do. */
const BLOB = Buffer.from("opaque-gender-ciphertext");
type Subject = { membershipId: string; personId: string };

/** A web person + account (me-settings.test.ts pattern). */
async function webUser(): Promise<{ accountId: string; personId: string }> {
  const personId = await fx.seedPerson();
  const a = await ctx.owner.query<{ id: string }>(
    `INSERT INTO accounts (person_id) VALUES ($1) RETURNING id`,
    [personId],
  );
  return { accountId: a.rows[0]!.id, personId };
}

/** An active membership; `gendered` stores BLOB on its person (owner seed) with `consent`. */
async function member(tenantId: string, gendered: boolean, consent = true): Promise<Subject> {
  const membershipId = await fx.seedMembership(tenantId);
  const m = await ctx.owner.query<{ person_id: string }>(
    `SELECT person_id FROM memberships WHERE id = $1`,
    [membershipId],
  );
  const personId = m.rows[0]!.person_id;
  if (gendered) {
    await ctx.owner.query(
      `UPDATE persons SET gender_enc = $2, gender_key_version = 'v1', gender_pricing_consent = $3
        WHERE id = $1`,
      [personId, BLOB, consent],
    );
  }
  return { membershipId, personId };
}

let waitlistPos = 0;
/** Owner-seeded players row of tenantA (waitlisted rows get a fresh position). */
async function player(sessionId: string, membershipId: string, status: "active" | "waitlisted") {
  await ctx.owner.query(
    `INSERT INTO players (tenant_id, session_id, membership_id, status, waitlist_position)
     VALUES ($1, $2, $3, $4, $5)`,
    [ctx.tenantA, sessionId, membershipId, status, status === "waitlisted" ? ++waitlistPos : null],
  );
}

type DeriveArgs = [string | null, string, string, string, string | null];
/** charge_gender_for_derivation as app, committed (the definer never writes). */
const derive = (...[tenantId, context, sessionId, membershipId, actor]: DeriveArgs) =>
  asApp(
    tenantId,
    async (q) =>
      (
        await q(`SELECT * FROM charge_gender_for_derivation($1, $2, $3, $4)`, [
          context,
          sessionId,
          membershipId,
          actor,
        ])
      ).rows,
    true,
  );

describe("0062 catalog fences and constraints (T-19, T-14)", () => {
  it("GP-1: no role holds a privilege on the persons gender columns or SELECT on per-gender prices", async () => {
    const { rows: persons } = await ctx.owner.query(
      `SELECT r || '.' || c AS k FROM unnest($1::text[]) r, unnest($2::text[]) c
        WHERE has_column_privilege(r::name, 'public.persons'::text, c, 'SELECT, INSERT, UPDATE, REFERENCES')`,
      [ROLES, ["gender_enc", "gender_key_version", "gender_pricing_consent"]],
    );
    expect(persons).toEqual([]);
    const { rows: prices } = await ctx.owner.query(
      `SELECT r || '.' || c AS k FROM unnest($1::text[]) r, unnest($2::text[]) c
        WHERE has_column_privilege(r::name, 'public.sessions'::text, c, 'SELECT')`,
      [
        ["readonly", "app_worker", "job_definer"],
        ["price_male", "price_female"],
      ],
    );
    expect(prices).toEqual([]);
  });

  it("GP-2: the three named CHECKs are live; a negative price fails its CHECK, int4 caps the top", async () => {
    const { rows } = await ctx.owner.query(
      `SELECT conrelid::regclass::text || '.' || conname AS k FROM pg_constraint
        WHERE contype = 'c' AND conname = ANY($1::text[]) ORDER BY 1`,
      [["persons_gender_enc_version_chk", "sessions_price_male_chk", "sessions_price_female_chk"]],
    );
    expect(rows.map((r) => r.k)).toEqual([
      "persons.persons_gender_enc_version_chk",
      "sessions.sessions_price_female_chk",
      "sessions.sessions_price_male_chk",
    ]);
    const sessionId = await fx.seedSession(ctx.tenantA);
    for (const col of ["price_male", "price_female"]) {
      const set = (v: number) =>
        asApp(ctx.tenantA, (q) =>
          q(`UPDATE sessions SET ${col} = $2 WHERE id = $1`, [sessionId, v]),
        );
      await expect(set(-1)).rejects.toMatchObject({
        code: "23514",
        constraint: `sessions_${col}_chk`,
      });
      await expect(set(2147483648)).rejects.toMatchObject({ code: "22003" });
      await expect(set(0)).resolves.toBeDefined();
    }
  });

  it("GP-3: each definer is SECURITY DEFINER, search_path pinned, owned like 0055, EXECUTE app only", async () => {
    for (const fn of DEFINERS) {
      const { rows } = await ctx.owner.query(
        `SELECT p.prosecdef, p.proconfig, p.proowner = q.proowner AS same_owner, p.proacl::text AS acl,
                ARRAY(SELECT r FROM unnest($2::text[]) r
                       WHERE has_function_privilege(r::name, p.oid, 'EXECUTE')) AS execs
           FROM pg_proc p, pg_proc q
          WHERE p.oid = $1::regprocedure AND q.oid = 'public.person_profile_read(uuid)'::regprocedure`,
        [fn, ROLES],
      );
      expect(rows[0], fn).toMatchObject({
        prosecdef: true,
        proconfig: ["search_path=pg_catalog, public, pg_temp"],
        same_owner: true,
        execs: ["app"],
      });
      expect(rows[0]!.acl, fn).not.toMatch(/(^|[{,])=X/);
    }
  });
});

describe("0062 self definers as app (RD-6)", () => {
  const read = (accountId: string) =>
    asApp(null, async (q) => (await q(`SELECT * FROM person_gender_read($1)`, [accountId])).rows);
  const update = (...args: [string, string, Buffer | null, string | null, boolean | null]) =>
    asApp(
      null,
      async (q) => (await q(`SELECT * FROM person_gender_update($1, $2, $3, $4, $5)`, args)).rows,
      true,
    );

  it("GP-4: round trip; a person mismatch writes nothing; NULL pair erases; a half pair fails", async () => {
    const me = await webUser();
    const other = await webUser();
    const stored = { person_id: me.personId, gender_enc: BLOB, gender_key_version: "v1" };
    expect(await update(me.accountId, me.personId, BLOB, "v1", true)).toEqual([
      { person_id: me.personId },
    ]);
    expect(await read(me.accountId)).toEqual([{ ...stored, gender_pricing_consent: true }]);
    // Relink race: the expected person is not the account's person => zero rows, nothing written.
    expect(await update(me.accountId, other.personId, null, null, false)).toEqual([]);
    expect(await update(other.accountId, me.personId, null, null, false)).toEqual([]);
    expect(await read(me.accountId)).toEqual([{ ...stored, gender_pricing_consent: true }]);
    expect(await read(other.accountId)).toEqual([
      {
        person_id: other.personId,
        gender_enc: null,
        gender_key_version: null,
        gender_pricing_consent: false,
      },
    ]);
    const pairChk = { code: "23514", constraint: "persons_gender_enc_version_chk" };
    await expect(update(me.accountId, me.personId, BLOB, null, true)).rejects.toMatchObject(
      pairChk,
    );
    await expect(update(me.accountId, me.personId, null, "v1", true)).rejects.toMatchObject(
      pairChk,
    );
    await expect(update(me.accountId, me.personId, null, null, null)).rejects.toMatchObject({
      code: "22023",
    });
    // Consent OFF keeps the ciphertext (RD-9); NULL + NULL erases.
    await update(me.accountId, me.personId, BLOB, "v1", false);
    expect(await read(me.accountId)).toEqual([{ ...stored, gender_pricing_consent: false }]);
    await update(me.accountId, me.personId, null, null, false);
    expect(await read(me.accountId)).toEqual([
      {
        person_id: me.personId,
        gender_enc: null,
        gender_key_version: null,
        gender_pricing_consent: false,
      },
    ]);
  });

  it("GP-4b: app reads no persons gender column directly (42501)", async () => {
    for (const col of ["gender_enc", "gender_key_version", "gender_pricing_consent"]) {
      await expect(
        asApp(null, (q) => q(`SELECT ${col} FROM persons LIMIT 1`)),
        col,
      ).rejects.toMatchObject({ code: "42501" });
    }
  });
});

describe("0062 charge_gender_for_derivation (RD-3; T-8, T-11, T-12)", () => {
  const none = (personId: string) => ({
    person_id: personId,
    gender_enc: null,
    gender_key_version: null,
  });
  const enc = (personId: string) => ({
    person_id: personId,
    gender_enc: BLOB,
    gender_key_version: "v1",
  });

  it("GP-5: each authorized context returns the ciphertext; consent OFF and never-set read NULL", async () => {
    const sessionId = await fx.seedSession(ctx.tenantA);
    const admin = await fx.seedAdmin(ctx.tenantA);
    const g = await member(ctx.tenantA, true);
    const A = ctx.tenantA;
    expect(await derive(A, "self_join", sessionId, g.membershipId, g.personId)).toEqual([
      enc(g.personId),
    ]);
    expect(await derive(A, "host_add", sessionId, g.membershipId, admin)).toEqual([
      enc(g.personId),
    ]);
    await player(sessionId, g.membershipId, "waitlisted");
    expect(await derive(A, "promotion", sessionId, g.membershipId, null)).toEqual([
      enc(g.personId),
    ]);
    // A guest membership (0058) is a live membership of the tenant.
    const guest = await member(A, true);
    await ctx.owner.query(`UPDATE memberships SET status = 'guest' WHERE id = $1`, [
      guest.membershipId,
    ]);
    expect(await derive(A, "self_join", sessionId, guest.membershipId, guest.personId)).toEqual([
      enc(guest.personId),
    ]);
    // T-8: consent OFF reads as never set while the ciphertext stays stored.
    const off = await member(A, true, false);
    expect(await derive(A, "self_join", sessionId, off.membershipId, off.personId)).toEqual([
      none(off.personId),
    ]);
    expect(
      await fx.row(`SELECT gender_enc, gender_key_version FROM persons WHERE id = $1`, [
        off.personId,
      ]),
    ).toEqual({ gender_enc: BLOB, gender_key_version: "v1" });
    const unset = await member(A, false);
    expect(await derive(A, "host_add", sessionId, unset.membershipId, admin)).toEqual([
      none(unset.personId),
    ]);
  });

  it("GP-6: every refusal is the identical GENDER_FORBIDDEN for set and NULL gender, zero writes", async () => {
    const A = ctx.tenantA;
    const sessionId = await fx.seedSession(A);
    const adminB = await fx.seedAdmin(ctx.tenantB);
    const stranger = await fx.seedPerson();
    const left = async (s: Subject) => {
      await ctx.owner.query(`UPDATE memberships SET status = 'left' WHERE id = $1`, [
        s.membershipId,
      ]);
    };
    const cases: [string, string, (s: Subject) => Promise<DeriveArgs>][] = [
      ["unknown context", A, async (s) => [A, "approve", sessionId, s.membershipId, s.personId]],
      [
        "tenant GUC unset",
        A,
        async (s) => [null, "self_join", sessionId, s.membershipId, s.personId],
      ],
      [
        "tenant GUC = B",
        A,
        async (s) => [ctx.tenantB, "self_join", sessionId, s.membershipId, s.personId],
      ],
      [
        "membership of B",
        ctx.tenantB,
        async (s) => [A, "self_join", sessionId, s.membershipId, s.personId],
      ],
      [
        "membership left",
        A,
        async (s) => {
          await left(s);
          return [A, "self_join", sessionId, s.membershipId, s.personId];
        },
      ],
      [
        "self_join by another",
        A,
        async (s) => [A, "self_join", sessionId, s.membershipId, stranger],
      ],
      [
        "host_add by non-admin",
        A,
        async (s) => [A, "host_add", sessionId, s.membershipId, s.personId],
      ],
      [
        "host_add by admin of B",
        A,
        async (s) => [A, "host_add", sessionId, s.membershipId, adminB],
      ],
      ["promotion, no player", A, async (s) => [A, "promotion", sessionId, s.membershipId, null]],
      [
        "promotion of an active player",
        A,
        async (s) => {
          await player(sessionId, s.membershipId, "active");
          return [A, "promotion", sessionId, s.membershipId, null];
        },
      ],
      [
        "unknown session",
        A,
        async (s) => [A, "self_join", randomUUID(), s.membershipId, s.personId],
      ],
    ];
    for (const [label, memberTenant, argsFor] of cases) {
      for (const gendered of [true, false]) {
        const args = await argsFor(await member(memberTenant, gendered));
        const before = [await fx.counts(A), await fx.counts(ctx.tenantB)];
        const err = await derive(...args).then(
          (rows) => ({ rows }),
          (e: { code?: string; message?: string }) => ({ code: e.code, message: e.message }),
        );
        expect(err, `${label}, gendered=${gendered}`).toEqual({
          code: "42501",
          message: "GENDER_FORBIDDEN",
        });
        expect([await fx.counts(A), await fx.counts(ctx.tenantB)], label).toEqual(before);
      }
    }
  });
});
