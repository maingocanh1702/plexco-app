import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  deriveChargeAmount,
  type ChargePrices,
  type DerivationContext,
} from "./charge-derivation.js";
import { encryptPersonGender, openPersonGender, type Gender } from "./gender-crypto.js";
import { fixtures } from "./roster-money-fixtures.js";
import { RosterMoneyError } from "./roster-money-shared.js";
import { __resetAuthSecretCacheForTest } from "./secret-key-root.js";
import { withTenant } from "./tenant.js";
import { setupRlsTestContext, type RlsTestContext } from "./test-harness.js";

// A pass-through spy, so T-1 / T-2 / T-8 can prove the ciphertext is never opened.
vi.mock("./gender-crypto.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./gender-crypto.js")>();
  return { ...actual, openPersonGender: vi.fn(actual.openPersonGender) };
});

/**
 * CD: readiness p3-m9-gender-pricing section 6 rows T-1, T-2 (DB part), T-7, T-8, T-10 and T-14, one
 * case per 4.4 table row. Every derivation runs as role `app` through withTenant (the production way)
 * against the real charge_gender_for_derivation definer and the real gender crypto; the owner
 * connection only seeds rows.
 */
let ctx: RlsTestContext;
const fx = fixtures(() => ctx);
const FIXTURE_KEY = Buffer.from("c".repeat(32)).toString("base64");
const ENV_KEYS = ["ENCRYPTION_KEY", "KMS_PROVIDER", "KMS_KEY_ID"];
const saved = new Map(ENV_KEYS.map((k) => [k, process.env[k]]));
const UNAVAILABLE = { ok: false, code: "CHARGE_DERIVATION_UNAVAILABLE" };
const UNAVAILABLE_JSON = '{"ok":false,"code":"CHARGE_DERIVATION_UNAVAILABLE"}';
const PRICES: ChargePrices = { priceAmount: 100_000, priceMale: 120_000, priceFemale: 80_000 };
const SINGLE = (priceAmount: number): ChargePrices => ({
  priceAmount,
  priceMale: null,
  priceFemale: null,
});
let sessionId: string;

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = FIXTURE_KEY;
  for (const k of ENV_KEYS.slice(1)) delete process.env[k];
  __resetAuthSecretCacheForTest();
  ctx = await setupRlsTestContext("plexco_charge_derivation");
  sessionId = await fx.seedSession(ctx.tenantA);
}, 180_000);
afterAll(async () => {
  await ctx?.teardown();
  for (const [k, v] of saved) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  __resetAuthSecretCacheForTest();
});
beforeEach(() => vi.mocked(openPersonGender).mockClear());

type Subject = { membershipId: string; personId: string };

/** An active tenantA membership whose person has no gender stored. */
async function member(): Promise<Subject> {
  const membershipId = await fx.seedMembership(ctx.tenantA);
  const m = await fx.row(`SELECT person_id FROM memberships WHERE id = $1`, [membershipId]);
  return { membershipId, personId: m.person_id as string };
}

/** Owner seed of the three persons gender columns. */
async function store(personId: string, enc: Buffer, keyVersion: string, consent = true) {
  await ctx.owner.query(
    `UPDATE persons SET gender_enc = $2, gender_key_version = $3, gender_pricing_consent = $4
      WHERE id = $1`,
    [personId, enc, keyVersion, consent],
  );
}

/** A member whose person declared `gender` (sealed for that person) with `consent`. */
async function gendered(gender: Gender, consent = true): Promise<Subject> {
  const s = await member();
  const { enc, keyVersion } = await encryptPersonGender(s.personId, gender);
  await store(s.personId, enc, keyVersion, consent);
  return s;
}

// The three decrypt failures (section 6 shorthand), each on a person who declared "male".
async function corruptBlob(s: Subject) {
  const { enc, keyVersion } = await encryptPersonGender(s.personId, "male");
  enc.writeUInt8(enc.readUInt8(enc.length - 1) ^ 0xff, enc.length - 1);
  await store(s.personId, enc, keyVersion);
}
async function retiredKeyVersion(s: Subject) {
  await store(s.personId, (await encryptPersonGender(s.personId, "male")).enc, "retired-key");
}
async function blobOfAnotherPerson(s: Subject) {
  const other = await member();
  const { enc, keyVersion } = await encryptPersonGender(other.personId, "male");
  await store(s.personId, enc, keyVersion);
}

const derive = (
  s: Subject,
  prices: ChargePrices = PRICES,
  context: DerivationContext = "self_join",
  actorPersonId: string | null = s.personId,
) =>
  withTenant(ctx.appDb.db, ctx.tenantA, (tx) =>
    deriveChargeAmount(tx, {
      context,
      sessionId,
      membershipId: s.membershipId,
      actorPersonId,
      prices,
    }),
  );

describe("deriveChargeAmount: the 4.4 decision table as app (CD)", () => {
  it("T-1 single price: both per-gender prices NULL => price_amount, no definer call", async () => {
    const s = await gendered("male");
    const r = await withTenant(ctx.appDb.db, ctx.tenantA, async (tx) => {
      const execute = vi.spyOn(tx, "execute");
      const out = await deriveChargeAmount(tx, {
        context: "self_join",
        sessionId,
        membershipId: s.membershipId,
        actorPersonId: s.personId,
        prices: SINGLE(90_000),
      });
      expect(execute).not.toHaveBeenCalled();
      return out;
    });
    expect(r).toStrictEqual({ ok: true, amount: 90_000 });
    expect(openPersonGender).not.toHaveBeenCalled();
  });

  it("T-2 gender never set => price_amount, a valid state; nothing opened", async () => {
    expect(await derive(await member())).toStrictEqual({ ok: true, amount: 100_000 });
    expect(openPersonGender).not.toHaveBeenCalled();
  });

  it("T-8 consent OFF => price_amount while the ciphertext stays stored; nothing opened", async () => {
    const s = await gendered("male", false);
    expect(await derive(s)).toStrictEqual({ ok: true, amount: 100_000 });
    expect(openPersonGender).not.toHaveBeenCalled();
    const p = await fx.row(`SELECT gender_enc IS NOT NULL AS stored FROM persons WHERE id = $1`, [
      s.personId,
    ]);
    expect(p).toEqual({ stored: true });
  });

  it.each([
    ["male + price_male", "male", PRICES, 120_000],
    ["female + price_female", "female", PRICES, 80_000],
    ["male, price_male NULL", "male", { ...PRICES, priceMale: null }, 100_000],
    ["female, price_female NULL", "female", { ...PRICES, priceFemale: null }, 100_000],
    ["other", "other", PRICES, 100_000],
    ["undisclosed", "undisclosed", PRICES, 100_000],
    ["male + a free price_male (0, not NULL)", "male", { ...PRICES, priceMale: 0 }, 0],
  ] as [string, Gender, ChargePrices, number][])("T-7 %s", async (_l, gender, prices, amount) => {
    expect(await derive(await gendered(gender), prices)).toStrictEqual({ ok: true, amount });
  });

  it("T-7 promotion: a waitlisted male, actorPersonId null => price_male", async () => {
    const s = await gendered("male");
    await ctx.owner.query(
      `INSERT INTO players (tenant_id, session_id, membership_id, status, waitlist_position)
       VALUES ($1, $2, $3, 'waitlisted', 1)`,
      [ctx.tenantA, sessionId, s.membershipId],
    );
    expect(await derive(s, PRICES, "promotion", null)).toStrictEqual({ ok: true, amount: 120_000 });
  });

  it.each([
    ["corrupt ciphertext", corruptBlob],
    ["wrong key version", retiredKeyVersion],
    ["blob copied from another person", blobOfAnotherPerson],
  ])(
    "4.4 %s => CHARGE_DERIVATION_UNAVAILABLE, no fallback price, zero writes",
    async (_l, seed) => {
      const s = await member();
      await seed(s);
      const before = await fx.counts(ctx.tenantA);
      const r = await derive(s);
      expect(r).toStrictEqual(UNAVAILABLE);
      expect(JSON.stringify(r)).toBe(UNAVAILABLE_JSON);
      expect(await fx.counts(ctx.tenantA)).toEqual(before);
    },
  );

  it.each([
    ["single price -1", member, SINGLE(-1)],
    ["single price 1.5", member, SINGLE(1.5)],
    ["single price 2147483648", member, SINGLE(2_147_483_648)],
    [
      "male, price_male 2147483648",
      () => gendered("male"),
      { ...PRICES, priceMale: 2_147_483_648 },
    ],
    ["female, price_female -1", () => gendered("female"), { ...PRICES, priceFemale: -1 }],
    ["other, price_amount 1.5", () => gendered("other"), { ...PRICES, priceAmount: 1.5 }],
  ] as [string, () => Promise<Subject>, ChargePrices][])(
    "T-14 %s => CHARGE_DERIVATION_UNAVAILABLE, zero writes",
    async (_l, make, prices) => {
      const s = await make();
      const before = await fx.counts(ctx.tenantA);
      expect(await derive(s, prices)).toStrictEqual(UNAVAILABLE);
      expect(await fx.counts(ctx.tenantA)).toEqual(before);
    },
  );

  it("T-14 bounds: 0 and 2147483647 are charged as they are", async () => {
    const s = await member();
    for (const amount of [0, 2_147_483_647]) {
      expect(await derive(s, SINGLE(amount))).toStrictEqual({ ok: true, amount });
    }
  });

  it("4.4 a refused derivation throws RosterMoneyError GENDER_FORBIDDEN, fixed message", async () => {
    const s = await gendered("female");
    const other = await member();
    const err = await derive(s, PRICES, "self_join", other.personId).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RosterMoneyError);
    expect(err).toMatchObject({ code: "GENDER_FORBIDDEN", message: "not permitted" });
  });
});

describe("deriveChargeAmount never leaks the gender (T-10)", () => {
  it("male, female, corrupt blob, wrong version: no console output, no value or blob returned", async () => {
    const methods = ["error", "warn", "log", "info"] as const;
    const spies = methods.map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    try {
      const [corrupt, retired] = [await member(), await member()];
      await corruptBlob(corrupt);
      await retiredKeyVersion(retired);
      const subjects = [await gendered("male"), await gendered("female"), corrupt, retired];
      const out: string[] = [];
      for (const s of subjects) out.push(JSON.stringify(await derive(s)));
      expect(out).toEqual([
        '{"ok":true,"amount":120000}',
        '{"ok":true,"amount":80000}',
        UNAVAILABLE_JSON,
        UNAVAILABLE_JSON,
      ]);
      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });
});
