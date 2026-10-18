import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";
import type pg from "pg";
import { GENDER_OPEN_FAILED, type Gender } from "./gender-crypto.js";
import { issueLinkCode } from "./identity.js";
import {
  detachMyChannel,
  GenderOpenError,
  InvalidGenderError,
  listMyChannels,
  readMyProfile,
  updateMyProfile,
  validateDisplayName,
} from "./me-settings.js";
import { __resetAuthSecretCacheForTest } from "./secret-key-root.js";
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
    expect(await readMyProfile(ctx.appPool, u.accountId)).toEqual({
      displayName: "Lan",
      gender: null,
      genderConsent: false,
    });
    expect(await readMyProfile(ctx.appPool, randomUUID())).toBeNull();
  });

  it("update trims, writes ONLY display_name and returns the new value", async () => {
    const u = await webUser("Old");
    await ctx.owner.query(`UPDATE persons SET phone_lookup_hash = 'ph-keep' WHERE id = $1`, [
      u.personId,
    ]);
    expect(await updateMyProfile(ctx.appPool, u.accountId, "  Lan Nguyen  ")).toEqual({
      displayName: "Lan Nguyen",
      gender: null,
      genderConsent: false,
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

  // TS and SQL must agree on every boundary: the TS validator runs first, the definer is the backstop
  // for any other app caller. Characters are built at runtime so this file holds no invisible bytes.
  const ch = (cp: number) => String.fromCodePoint(cp);
  const hex = (cp: number) => `U+${cp.toString(16).toUpperCase().padStart(4, "0")}`;
  const VI = "Nguyễn Thị Ánh";
  const E_CIRCUMFLEX_TILDE_NFD = ch(0x1ec5).normalize("NFD"); // e + U+0302 + U+0303: 3 code points

  /** TS verdict: the trimmed name, or null when validateDisplayName refuses it. */
  const tsVerdict = (input: string): string | null => {
    try {
      return validateDisplayName(input);
    } catch {
      return null;
    }
  };
  /** Definer verdict: the stored name, or the SQLSTATE it raised. */
  async function sqlVerdict(
    accountId: string,
    input: string,
  ): Promise<{ stored: string | null } | { code: string }> {
    try {
      const { rows } = await ctx.appPool.query<{ display_name: string | null }>(
        `SELECT display_name FROM person_profile_update($1, $2)`,
        [accountId, input],
      );
      return { stored: rows[0]?.display_name ?? null };
    } catch (error) {
      return { code: String((error as { code?: string }).code) };
    }
  }

  // Walked from the RUNTIME's Unicode tables, never a hand-kept copy: a Node whose Unicode grows the
  // refused set, the ECMAScript trim set or the blank set fails the sweeps below until BOTH
  // validators' lists grow (validateDisplayName's HIDDEN_CHAR / VISIBLE_CHAR and 0055's c_reject /
  // c_visible). Refused anywhere in a name: Cc, Cf, Zl, Zp, every assigned default-ignorable code
  // point that is not a variation selector (renders as nothing), and U+2800 BRAILLE PATTERN BLANK.
  const HIDDEN: number[] = [];
  const TRIMMED: number[] = [];
  // Whitespace or Default_Ignorable_Code_Point: renders as nothing, so a name needs one code point
  // outside this set (0055's c_visible is its complement).
  const INVISIBLE: number[] = [];
  for (let cp = 0; cp <= 0x10ffff; cp++) {
    if (cp >= 0xd800 && cp <= 0xdfff) continue; // surrogates are not scalar values
    const c = ch(cp);
    if (
      /^[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]$/u.test(c) ||
      /^(?![\p{VS}\p{Cn}])\p{DI}$/u.test(c) ||
      cp === 0x2800
    ) {
      HIDDEN.push(cp);
    }
    if (c.trim() === "") TRIMMED.push(cp);
    if (/^[\s\p{DI}]$/u.test(c)) INVISIBLE.push(cp);
  }
  const hiddenSet = new Set(HIDDEN);
  // Invisible yet not refused, so allowed after a visible character but never alone: inner
  // whitespace, every variation selector and every unassigned default-ignorable.
  const BLANK = INVISIBLE.filter((cp) => !hiddenSet.has(cp));

  const CORPUS: [string, string, boolean][] = [
    ["plain", "Lan", true],
    ["vietnamese diacritics, NFC", VI.normalize("NFC"), true],
    ["vietnamese diacritics, NFD (combining marks are Mn, not Cf)", VI.normalize("NFD"), true],
    ["max length (120)", "x".repeat(120), true],
    ["over max (121)", "x".repeat(121), false],
    ["120 emoji = 120 code points", ch(0x1f600).repeat(120), true],
    ["121 emoji", ch(0x1f600).repeat(121), false],
    ["NFD length is code points: 40 x 3 = 120", E_CIRCUMFLEX_TILDE_NFD.repeat(40), true],
    ["NFD length is code points: 41 x 3 = 123", E_CIRCUMFLEX_TILDE_NFD.repeat(41), false],
    ["blank", "   ", false],
    ["empty", "", false],
    ["NBSP only (blank once trimmed)", ch(0xa0).repeat(3), false],
    ["NBSP at both edges is trimmed", ch(0xa0) + "Lan" + ch(0xa0), true],
    ["NBSP inside is kept", "Lan" + ch(0xa0) + "Anh", true],
    ["ideographic space at the edges is trimmed", ch(0x3000) + "Lan" + ch(0x3000), true],
    ["tab + newline at the edges are trimmed", ch(0x09) + "Lan" + ch(0x0a), true],
    ["BOM at the edge is trimmed (JS trim removes U+FEFF)", ch(0xfeff) + "Lan", true],
    ["NEL at the edge: Cc, and JS trim keeps it", "Lan" + ch(0x85), false],
    ["Mongolian vowel separator at the edge: Cf, no longer a space", ch(0x180e) + "Lan", false],
    ["zero-width space at the edge: Cf, not trimmed", "Lan" + ch(0x200b), false],
    ["NEL control inside (U+0085)", "a" + ch(0x85) + "b", false],
    ["tab control inside", "a" + ch(0x09) + "b", false],
    ["newline control inside", "a" + ch(0x0a) + "b", false],
    ["DEL inside", "a" + ch(0x7f) + "b", false],
    ["zero-width space inside (Cf)", "a" + ch(0x200b) + "b", false],
    ["bidi override inside (Cf)", "a" + ch(0x202e) + "b", false],
    ["BOM inside (Cf)", "a" + ch(0xfeff) + "b", false],
    ["soft hyphen inside (Cf)", "a" + ch(0xad) + "b", false],
    ["Arabic pound mark above (Cf, U+0890)", "a" + ch(0x890) + "b", false],
    ["Arabic disputed end of ayah (Cf, U+08E2)", "a" + ch(0x8e2) + "b", false],
    ["tag char (Cf, astral)", "a" + ch(0xe0041) + "b", false],
    ["ZWJ in emoji sequence is a format char", ch(0x1f468) + ch(0x200d) + ch(0x1f469), false],
    ["line separator inside (Zl): a line break in the name", "Lan" + ch(0x2028) + "Anh", false],
    ["paragraph separator inside (Zp)", "Lan" + ch(0x2029) + "Anh", false],
    ["line / paragraph separators at the edges are trimmed", ch(0x2028) + "Lan" + ch(0x2029), true],
    ["Hangul filler alone: looks empty", ch(0x3164), false],
    ["Hangul fillers inside", "Lan" + ch(0x115f) + ch(0x1160) + ch(0xffa0) + "Anh", false],
    ["Braille pattern blank alone: looks empty", ch(0x2800).repeat(3), false],
    ["Braille pattern blank inside", "Lan" + ch(0x2800) + "Anh", false],
    ["combining grapheme joiner (default-ignorable mark)", "a" + ch(0x34f) + "b", false],
    ["Khmer inherent vowel (default-ignorable mark)", ch(0x17b4), false],
    ["emoji + variation selector-16 is kept", ch(0x2764) + ch(0xfe0f) + " Lan", true],
    ["Korean syllables are kept (only the fillers are refused)", "김민지", true],
    ["a non-blank Braille pattern is kept", "Lan " + ch(0x2801), true],
    // At least one visible code point: variation selectors, unassigned default-ignorables and
    // whitespace render as nothing, so a name of them alone would show blank.
    ["variation selector-16 alone", ch(0xfe0f), false],
    ["ideographic variation selector alone (astral)", ch(0xe0100), false],
    ["Mongolian free variation selector alone", ch(0x180b), false],
    ["unassigned default-ignorables alone", ch(0x2065) + ch(0xfff0) + ch(0xe0fff), false],
    ["variation selectors around an inner space", ch(0xfe0f) + " " + ch(0xfe0f), false],
    ["emoji + variation selector-16 alone is kept", ch(0x2764) + ch(0xfe0f), true],
    ["CJK ideograph + ideographic variation selector is kept", ch(0x845b) + ch(0xe0100), true],
    ["a variation selector before a visible character is kept", ch(0xfe0f) + "Lan", true],
    ["a lone combining mark draws a glyph, so it is visible", ch(0x301), true],
  ];
  it.each(CORPUS)("validation parity TS/SQL: %s", async (_label, input, ok) => {
    const ts = tsVerdict(input);
    expect(ts !== null).toBe(ok);
    const u = await webUser("seed");
    const sql = await sqlVerdict(u.accountId, input);
    if (ok) {
      expect(sql).toEqual({ stored: ts }); // same trim, and the stored bytes are TS's (no normalisation)
    } else {
      expect(sql).toEqual({ code: "22023" }); // invalid_parameter_value
    }
  });

  it("every hidden code point the runtime knows is refused by TS AND by the definer (mid-name)", async () => {
    // 65 Cc + 170 Cf (Unicode 17.0) + Zl + Zp + 7 default-ignorable non-selectors + U+2800
    expect(HIDDEN.length).toBeGreaterThanOrEqual(245);
    expect(HIDDEN).toEqual(
      expect.arrayContaining([
        0x0, 0x85, 0xad, 0x890, 0x891, 0x8e2, 0x180e, 0xfeff, 0xe007f, 0x2028, 0x2029, 0x34f,
        0x115f, 0x1160, 0x17b4, 0x17b5, 0x3164, 0xffa0, 0x2800,
      ]),
    );
    // Variation selectors are default-ignorable but stay allowed (emoji / ideographic variants).
    expect(HIDDEN).not.toContain(0xfe0f);
    expect(HIDDEN).not.toContain(0xe0100);
    const u = await webUser("seed");
    const wrong: string[] = [];
    for (const cp of HIDDEN) {
      const input = "a" + ch(cp) + "b";
      if (tsVerdict(input) !== null) wrong.push(`TS accepts ${hex(cp)}`);
      // U+0000 never reaches the definer: Postgres refuses a NUL byte in a text parameter (22021).
      const expected = cp === 0 ? "22021" : "22023";
      const sql = await sqlVerdict(u.accountId, input);
      if (!("code" in sql) || sql.code !== expected) {
        wrong.push(`SQL ${hex(cp)} -> ${JSON.stringify(sql)}`);
      }
    }
    expect(wrong).toEqual([]);
    expect((await personRow(u.personId)).display_name).toBe("seed");
  });

  it("the definer trims exactly what String.prototype.trim removes, and agrees with TS mid-name", async () => {
    expect(TRIMMED).toEqual(
      expect.arrayContaining([
        0x09, 0x0d, 0x20, 0xa0, 0x1680, 0x2000, 0x200a, 0x2028, 0x3000, 0xfeff,
      ]),
    );
    const u = await webUser("seed");
    const wrong: string[] = [];
    for (const cp of TRIMMED) {
      const edges = ch(cp) + ch(cp) + "Lan" + ch(cp);
      if (tsVerdict(edges) !== "Lan") wrong.push(`TS keeps ${hex(cp)}`);
      const atEdges = await sqlVerdict(u.accountId, edges);
      if (!("stored" in atEdges) || atEdges.stored !== "Lan") {
        wrong.push(`SQL edges ${hex(cp)} -> ${JSON.stringify(atEdges)}`);
      }
      const middle = "Lan" + ch(cp) + "Anh";
      const ts = tsVerdict(middle);
      const inside = await sqlVerdict(u.accountId, middle);
      const stored = "stored" in inside ? inside.stored : null;
      if (stored !== ts || ("code" in inside && inside.code !== "22023")) {
        wrong.push(`middle ${hex(cp)}: TS ${JSON.stringify(ts)}, SQL ${JSON.stringify(inside)}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it("a name needs one visible code point: blank ones alone are refused by TS AND the definer, kept after one", async () => {
    // 17 Zs + 260 variation selectors + 3,769 unassigned default-ignorables (Unicode 16 and 17)
    expect(BLANK.length).toBeGreaterThanOrEqual(4046);
    expect(BLANK).toEqual(
      expect.arrayContaining([
        0x20, 0xa0, 0x3000, 0x180b, 0x180f, 0xfe0f, 0xe0100, 0xe01ef, 0x2065, 0xfff0, 0xe0000,
        0xe0fff,
      ]),
    );
    expect(BLANK).not.toContain(0x301); // a combining mark draws a glyph
    const u = await webUser("seed");
    const wrong: string[] = [];
    const refused = async (label: string, input: string) => {
      if (tsVerdict(input) !== null) wrong.push(`TS accepts ${label}`);
      const sql = await sqlVerdict(u.accountId, input);
      if (!("code" in sql) || sql.code !== "22023") {
        wrong.push(`SQL ${label} -> ${JSON.stringify(sql)}`);
      }
    };
    const kept = async (label: string, input: string) => {
      if (tsVerdict(input) !== input) wrong.push(`TS refuses ${label}`);
      const sql = await sqlVerdict(u.accountId, input);
      if (!("stored" in sql) || sql.stored !== input) {
        wrong.push(`SQL ${label} -> ${JSON.stringify(sql)}`);
      }
    };
    // trim() removes whitespace at the edges, so each one sits between two variation selectors.
    for (const cp of BLANK.filter((c) => ch(c).trim() === "")) {
      await refused(`VS ${hex(cp)} VS`, ch(0xfe0f) + ch(cp) + ch(0xfe0f));
    }
    // The rest in names of 119 code points: refused alone, stored as typed behind "a" (120 in all).
    const rest = BLANK.filter((c) => ch(c).trim() !== "");
    for (let i = 0; i < rest.length; i += 119) {
      const batch = rest.slice(i, i + 119);
      const span = `${hex(batch[0]!)}..${hex(batch[batch.length - 1]!)}`;
      const blank = batch.map(ch).join("");
      await refused(span, blank);
      await kept(`a + ${span}`, "a" + blank);
    }
    // The code point next to each run of whitespace / default-ignorables is visible unless refused:
    // alone it is a name on both sides, so no hand-typed 0055 range reaches past its run.
    const invisible = new Set(INVISIBLE);
    for (const cp of new Set(INVISIBLE.flatMap((c) => [c - 1, c + 1]))) {
      if (cp < 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) continue;
      if (invisible.has(cp) || hiddenSet.has(cp)) continue;
      await kept(hex(cp), ch(cp));
    }
    expect(wrong).toEqual([]);
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

/**
 * DD-39 self-declared gender + pricing consent (readiness p3-m9-gender-pricing 4.7; the me-settings
 * parts of T-9, T-10 and T-18). Runtime calls run as `app` through the 0062 definers; the owner only
 * seeds and damages rows. The key is a fixed local ENCRYPTION_KEY (no KMS), restored afterwards.
 */
describe("person_gender_read / person_gender_update (DD-39 gender + pricing consent)", () => {
  const GENDER_ENV = ["ENCRYPTION_KEY", "KMS_PROVIDER", "KMS_KEY_ID"];
  const saved = new Map(GENDER_ENV.map((k) => [k, process.env[k]]));
  beforeAll(() => {
    process.env.ENCRYPTION_KEY = Buffer.from("c".repeat(32)).toString("base64");
    for (const k of GENDER_ENV.slice(1)) delete process.env[k];
    __resetAuthSecretCacheForTest();
  });
  afterAll(() => {
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    __resetAuthSecretCacheForTest();
  });

  const NO_GENDER = { gender_enc: null, gender_key_version: null, gender_pricing_consent: false };
  const genderRow = async (personId: string) =>
    (
      await ctx.owner.query(
        `SELECT gender_enc, gender_key_version, gender_pricing_consent FROM persons WHERE id = $1`,
        [personId],
      )
    ).rows[0] as {
      gender_enc: Buffer | null;
      gender_key_version: string | null;
      gender_pricing_consent: boolean;
    };
  /** Owner-side damage to a stored blob: the three decrypt failures of the self-read. */
  async function damage(how: "corrupt" | "retired" | "foreign", personId: string): Promise<void> {
    if (how === "corrupt") {
      await ctx.owner.query(
        `UPDATE persons SET gender_enc = set_byte(gender_enc, length(gender_enc) - 1,
                get_byte(gender_enc, length(gender_enc) - 1) # 255) WHERE id = $1`,
        [personId],
      );
    } else if (how === "retired") {
      await ctx.owner.query(`UPDATE persons SET gender_key_version = 'retired-key' WHERE id = $1`, [
        personId,
      ]);
    } else {
      const other = await webUser("Other");
      await updateMyProfile(ctx.appPool, other.accountId, undefined, { gender: "male" });
      await ctx.owner.query(
        `UPDATE persons t SET gender_enc = s.gender_enc, gender_key_version = s.gender_key_version
           FROM persons s WHERE t.id = $1 AND s.id = $2`,
        [personId, other.personId],
      );
    }
  }
  const failure = (p: Promise<unknown>) =>
    p.then(
      () => undefined,
      (e: unknown) => e as Error,
    );

  it("a first declaration is consent OFF, the self-read returns it, the row holds ciphertext only", async () => {
    const u = await webUser("Mai");
    for (const gender of ["male", "female", "other", "undisclosed"] as const) {
      const expected = { displayName: "Mai", gender, genderConsent: false };
      expect(await updateMyProfile(ctx.appPool, u.accountId, undefined, { gender })).toEqual(
        expected,
      );
      expect(await readMyProfile(ctx.appPool, u.accountId)).toEqual(expected);
      const row = await genderRow(u.personId);
      expect(row.gender_enc!.includes(Buffer.from(gender, "utf8"))).toBe(false);
      expect(row.gender_key_version).not.toBeNull();
      expect(row.gender_pricing_consent).toBe(false);
    }
    expect(
      await updateMyProfile(ctx.appPool, randomUUID(), undefined, { gender: "male" }),
    ).toBeNull();
  });

  it("consent is an explicit opt-in, withdrawing keeps the ciphertext, an absent field keeps its value", async () => {
    const u = await webUser("Hoa");
    await updateMyProfile(ctx.appPool, u.accountId, undefined, { gender: "male" });
    const sealed = (await genderRow(u.personId)).gender_enc;
    const as = (displayName: string, genderConsent: boolean) => ({
      displayName,
      gender: "male",
      genderConsent,
    });
    const patch = (name: unknown, fields?: { genderConsent: boolean }) =>
      updateMyProfile(ctx.appPool, u.accountId, name, fields);
    expect(await patch(undefined, { genderConsent: true })).toEqual(as("Hoa", true));
    expect(await patch("Hoa 2")).toEqual(as("Hoa 2", true));
    expect(await patch(undefined, { genderConsent: false })).toEqual(as("Hoa 2", false));
    expect(await patch(undefined)).toEqual(as("Hoa 2", false)); // empty patch: a no-op read
    expect((await genderRow(u.personId)).gender_enc).toEqual(sealed);
  });

  it("gender null erases the triple and consent cannot outlive the value", async () => {
    const u = await webUser("Lan");
    const fields = { gender: "female" as const, genderConsent: true };
    await updateMyProfile(ctx.appPool, u.accountId, undefined, fields);
    expect(
      await updateMyProfile(ctx.appPool, u.accountId, undefined, { ...fields, gender: null }),
    ).toEqual({ displayName: "Lan", gender: null, genderConsent: false });
    expect(await genderRow(u.personId)).toEqual(NO_GENDER);
  });

  it.each(["corrupt", "retired", "foreign"] as const)(
    "a %s blob fails the self-read closed: a fixed-message GenderOpenError, never gender null",
    async (how) => {
      const u = await webUser("Kim");
      await updateMyProfile(ctx.appPool, u.accountId, undefined, { gender: "female" });
      await damage(how, u.personId);
      const err = await failure(readMyProfile(ctx.appPool, u.accountId));
      expect(err).toBeInstanceOf(GenderOpenError);
      expect(err!.message).toBe(GENDER_OPEN_FAILED);
      expect(JSON.stringify(err)).toBe('{"name":"GenderOpenError"}');
      expect(err!.cause).toBeUndefined();
    },
  );

  it("a mixed body is atomic: an unreadable stored blob rolls the name back, re-declaring recovers", async () => {
    const u = await webUser("Kim");
    await updateMyProfile(ctx.appPool, u.accountId, undefined, { gender: "female" });
    await damage("corrupt", u.personId);
    const damaged = await genderRow(u.personId);
    const err = await failure(
      updateMyProfile(ctx.appPool, u.accountId, "New", { genderConsent: true }),
    );
    expect(err).toBeInstanceOf(GenderOpenError);
    expect((await personRow(u.personId)).display_name).toBe("Kim");
    expect(await genderRow(u.personId)).toEqual(damaged);
    expect(await updateMyProfile(ctx.appPool, u.accountId, undefined, { gender: "other" })).toEqual(
      { displayName: "Kim", gender: "other", genderConsent: false },
    );
  });

  it("a relink between the gender read and the write answers null and writes no person", async () => {
    const u = await webUser("Kim");
    const fresh = (
      await ctx.owner.query<{ id: string }>(
        `INSERT INTO persons (display_name) VALUES ('Fresh') RETURNING id`,
      )
    ).rows[0]!.id;
    // Gender-only body: person_profile_update would lock accounts and block this owner UPDATE.
    const racing = {
      connect: async () => {
        const client = await ctx.appPool.connect();
        return {
          query: async (text: string, values?: unknown[]) => {
            if (text.includes("person_gender_update(")) {
              await ctx.owner.query(`UPDATE accounts SET person_id = $2 WHERE id = $1`, [
                u.accountId,
                fresh,
              ]);
            }
            return client.query(text, values);
          },
          release: (err?: Error) => client.release(err),
        };
      },
    } as unknown as pg.Pool;
    expect(await updateMyProfile(racing, u.accountId, undefined, { gender: "male" })).toBeNull();
    expect(await genderRow(u.personId)).toEqual(NO_GENDER);
    expect(await genderRow(fresh)).toEqual(NO_GENDER);
  });

  it.each([[""], ["Nam"], ["MALE"], [1], [{}], ["constructor"], [["male"]]])(
    "refuses gender %j with a fixed-message InvalidGenderError and writes nothing",
    async (bad) => {
      const u = await webUser("Kim");
      const err = await failure(
        updateMyProfile(ctx.appPool, u.accountId, "Changed", { gender: bad as unknown as Gender }),
      );
      expect(err).toBeInstanceOf(InvalidGenderError);
      expect(err!.message).toBe("gender must be one of the declared values");
      expect(JSON.stringify(err)).toBe('{"name":"InvalidGenderError"}');
      expect((await personRow(u.personId)).display_name).toBe("Kim");
      expect(await genderRow(u.personId)).toEqual(NO_GENDER);
    },
  );

  it("never writes to the console on a set, a read, a failed open or an invalid value", async () => {
    const spies = (["error", "warn", "log", "info"] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => undefined),
    );
    try {
      const u = await webUser("Thu");
      const fields = { gender: "female" as const, genderConsent: true };
      await updateMyProfile(ctx.appPool, u.accountId, undefined, fields);
      await readMyProfile(ctx.appPool, u.accountId);
      await damage("corrupt", u.personId);
      await failure(readMyProfile(ctx.appPool, u.accountId));
      await failure(
        updateMyProfile(ctx.appPool, u.accountId, undefined, { gender: "Nam" as Gender }),
      );
      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });

  it("one account can neither read nor write another account's gender", async () => {
    const a = await webUser("A");
    const b = await webUser("B");
    await updateMyProfile(ctx.appPool, a.accountId, undefined, {
      gender: "male",
      genderConsent: true,
    });
    const sealedA = await genderRow(a.personId);
    const bFields = { gender: "female" as const, genderConsent: false };
    const bProfile = { displayName: "B", ...bFields };
    expect(await updateMyProfile(ctx.appPool, b.accountId, undefined, bFields)).toEqual(bProfile);
    expect(await readMyProfile(ctx.appPool, b.accountId)).toEqual(bProfile);
    expect(await genderRow(a.personId)).toEqual(sealedA);
    expect(await readMyProfile(ctx.appPool, a.accountId)).toEqual({
      displayName: "A",
      gender: "male",
      genderConsent: true,
    });
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
    // ...a NAMELESS one: nothing is copied from the account's Person (that would move its PII).
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

  it("inactive: listed, but not detachable (OD-6 moves active identities only) -> invalid, nothing written", async () => {
    const u = await webUser();
    const ci = await identityFor(u.personId, "zalo", "inactive");
    expect((await listMyChannels(ctx.appPool, u.accountId)).map((c) => c.status)).toEqual([
      "inactive",
    ]);
    expect(await detachMyChannel(ctx.appPool, u.accountId, ci)).toEqual({ outcome: "invalid" });
    expect(await ciRow(ci)).toEqual({ person_id: u.personId, status: "inactive" });
    expect(await detachAudit(u.accountId)).toEqual([]);
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
    // The repeat is refused because the identity now belongs to the fresh Person, NOT because it is
    // inactive: detach leaves the status as it was.
    const moved = await ciRow(ci);
    expect(moved.status).toBe("active");
    expect(moved.person_id).not.toBe(u.personId);
    expect((await detachMyChannel(ctx.appPool, u.accountId, ci)).outcome).toBe("invalid");
    expect(await ciRow(ci)).toEqual(moved);
    expect(await detachAudit(u.accountId)).toHaveLength(1);
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
