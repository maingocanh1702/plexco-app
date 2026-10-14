import { afterEach, describe, expect, it } from "vitest";
import { linkCodeKeys } from "./link-code-keys";

afterEach(() => {
  delete process.env.LINK_CODE_LOOKUP_HMAC_KEY;
});

describe("linkCodeKeys", () => {
  it("decodes a base64 key of >= 32 bytes", () => {
    process.env.LINK_CODE_LOOKUP_HMAC_KEY = Buffer.alloc(32, 7).toString("base64");
    expect(linkCodeKeys()?.lookupHmacKey.equals(Buffer.alloc(32, 7))).toBe(true);
  });

  it.each([undefined, "", "short", Buffer.alloc(16, 1).toString("base64"), "not base64!!!"])(
    "returns null for %j",
    (v) => {
      if (v === undefined) delete process.env.LINK_CODE_LOOKUP_HMAC_KEY;
      else process.env.LINK_CODE_LOOKUP_HMAC_KEY = v;
      expect(linkCodeKeys()).toBeNull();
    },
  );
});
