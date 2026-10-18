import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CONNECTOR_ZALO_KEY_INFO, sealAesGcm } from "./connector-crypto.js";
import { encryptPersonGender, openPersonGender, type Gender } from "./gender-crypto.js";
import {
  __resetAuthSecretCacheForTest,
  deriveAesKey,
  resolveAuthSecretKey,
} from "./secret-key-root.js";

// GC: readiness p3-m9-gender-pricing section 6 rows T-15 (person-bound blob) and T-16 (envelope).
const FIXTURE_KEY = Buffer.from("g".repeat(32)).toString("base64");
const A = "33333333-3333-4333-8333-333333333333";
const B = "44444444-4444-4444-8444-444444444444";
const VALUES: Gender[] = ["male", "female", "other", "undisclosed"];
const ENV_KEYS = ["ENCRYPTION_KEY", "KMS_PROVIDER", "KMS_KEY_ID"];
const saved = new Map(ENV_KEYS.map((k) => [k, process.env[k]]));

beforeEach(() => {
  process.env.ENCRYPTION_KEY = FIXTURE_KEY;
  for (const k of ENV_KEYS.slice(1)) delete process.env[k];
  __resetAuthSecretCacheForTest();
});
afterEach(() => {
  for (const [k, v] of saved) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  __resetAuthSecretCacheForTest();
});

/** Seals raw bytes under the pinned 4.3 key label and person AAD, bypassing the typed encrypt. */
async function sealRaw(personId: string, plain: Buffer, info = "plexco:person-gender-enc:v1") {
  const key = deriveAesKey(await resolveAuthSecretKey(), info);
  const aad = Buffer.from(`plexco:person-gender-aad:v1:${personId}`, "utf8");
  return sealAesGcm(key, plain, aad);
}
/** The pinned plaintext format (R-R5-b S-1): the UTF-8 value, then zero bytes up to 16 bytes. */
const padded = (text: string) =>
  Buffer.concat([Buffer.from(text, "utf8"), Buffer.alloc(16 - Buffer.byteLength(text))]);

describe("gender crypto envelope (T-16)", () => {
  it.each(VALUES)("round-trips %s at the one blob length every value seals to", async (gender) => {
    const { enc, keyVersion } = await encryptPersonGender(A, gender);
    expect(keyVersion).toBe("local");
    expect(enc.length).toBe(12 + 16 + 16); // iv + tag + the padded plaintext: the size gives nothing away
    await expect(openPersonGender(A, enc, keyVersion)).resolves.toStrictEqual({ ok: true, gender });
  });

  it("pins the HKDF label, the person-bound AAD and the zero pad", async () => {
    await expect(
      openPersonGender(A, await sealRaw(A, padded("female")), "local"),
    ).resolves.toStrictEqual({
      ok: true,
      gender: "female",
    });
  });

  it("refuses a wrong key version before open, although the same key still opens the blob", async () => {
    const { enc } = await encryptPersonGender(A, "male");
    process.env.KMS_KEY_ID = "kms-key-2"; // authKeyVersion() moves; the local key material does not
    await expect(openPersonGender(A, enc, "local")).resolves.toStrictEqual({ ok: false });
    await expect(openPersonGender(A, enc, "kms-key-2")).resolves.toStrictEqual({
      ok: true,
      gender: "male",
    });
  });

  it("fails closed on a NULL version, a short blob, a flipped tag, a value outside the four and another purpose's key", async () => {
    const { enc } = await encryptPersonGender(A, "female");
    const flipped = Buffer.from(enc);
    flipped.writeUInt8(flipped.readUInt8(12) ^ 0x01, 12); // first tag byte
    const cases: [Buffer, string | null][] = [
      [enc, null],
      [enc.subarray(0, 28), "local"], // < 29 bytes: refused inside openAesGcm, caught as { ok: false }
      [flipped, "local"],
      [await sealRaw(A, padded("MALE")), "local"],
      [await sealRaw(A, padded("unknown")), "local"],
      [await sealRaw(A, padded("female"), CONNECTOR_ZALO_KEY_INFO), "local"],
    ];
    for (const [blob, version] of cases) {
      const result = await openPersonGender(A, blob, version);
      expect(result).toStrictEqual({ ok: false });
      expect(JSON.stringify(result)).toBe('{"ok":false}');
    }
  });

  it("fails closed on a tampered pad: a non-zero pad byte, the unpadded value, a pad one byte too long", async () => {
    const cases = [
      Buffer.concat([Buffer.from("male"), Buffer.alloc(11), Buffer.from([1])]),
      Buffer.from("male"),
      Buffer.concat([padded("male"), Buffer.alloc(1)]),
    ];
    for (const plain of cases) {
      const result = await openPersonGender(A, await sealRaw(A, plain), "local");
      expect(JSON.stringify(result)).toBe('{"ok":false}');
    }
  });
});

describe("gender crypto person binding (T-15)", () => {
  it("a blob sealed for person A does not open as person B", async () => {
    const { enc, keyVersion } = await encryptPersonGender(A, "male");
    await expect(openPersonGender(B, enc, keyVersion)).resolves.toStrictEqual({ ok: false });
  });
});
