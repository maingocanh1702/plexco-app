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

/** Seals raw text under the pinned 4.3 key label and person AAD, bypassing the typed encrypt. */
async function sealRaw(personId: string, text: string, info = "plexco:person-gender-enc:v1") {
  const key = deriveAesKey(await resolveAuthSecretKey(), info);
  const aad = Buffer.from(`plexco:person-gender-aad:v1:${personId}`, "utf8");
  return sealAesGcm(key, Buffer.from(text, "utf8"), aad);
}

describe("gender crypto envelope (T-16)", () => {
  it.each(VALUES)("round-trips %s under the auth key version", async (gender) => {
    const { enc, keyVersion } = await encryptPersonGender(A, gender);
    expect(keyVersion).toBe("local");
    expect(enc.length).toBe(12 + 16 + Buffer.byteLength(gender));
    await expect(openPersonGender(A, enc, keyVersion)).resolves.toStrictEqual({ ok: true, gender });
  });

  it("pins the HKDF label and the person-bound AAD", async () => {
    await expect(openPersonGender(A, await sealRaw(A, "female"), "local")).resolves.toStrictEqual({
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
      [enc.subarray(0, 28), "local"],
      [flipped, "local"],
      [await sealRaw(A, "MALE"), "local"],
      [await sealRaw(A, "unknown"), "local"],
      [await sealRaw(A, "female", CONNECTOR_ZALO_KEY_INFO), "local"],
    ];
    for (const [blob, version] of cases) {
      const result = await openPersonGender(A, blob, version);
      expect(result).toStrictEqual({ ok: false });
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
