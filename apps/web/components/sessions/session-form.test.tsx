import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LangProvider } from "../../lib/i18n-client";
import { emptyFormValues, type SessionFormValues } from "../../lib/session-form-model";
import { SessionForm } from "./session-form";

const html = (mode: "create" | "edit", lang: "vi" | "en", over: Partial<SessionFormValues> = {}) =>
  renderToStaticMarkup(
    <LangProvider lang={lang}>
      <SessionForm
        mode={mode}
        initial={{ ...emptyFormValues(), sportId: "s1", venueAddress: "x".repeat(250), ...over }}
        timezone="Asia/Ho_Chi_Minh"
        sports={[{ id: "s1", name: "Cầu lông" }]}
        submitLabel="Save"
        cancelHref="/x"
        onSubmit={async () => {}}
      />
    </LangProvider>,
  );

/** The text of `markup` from `start` up to and including the first ">" after it ("" when absent). */
function openingTag(markup: string, start: number) {
  const end = markup.indexOf(">", start);
  return start < 0 || end < 0 ? "" : markup.slice(start, end + 1);
}

/**
 * The <input> that the "Địa chỉ" / "Address" label points at, plus its hint paragraph. Plain string
 * search on purpose (no RegExp built from the label/ids: Semgrep detect-non-literal-regexp).
 */
function addressField(markup: string, label: string) {
  const labelEnd = markup.indexOf(`>${label}</label>`);
  const labelStart = labelEnd < 0 ? -1 : markup.lastIndexOf('<label for="', labelEnd);
  const idStart = labelStart < 0 ? -1 : labelStart + '<label for="'.length;
  const forId = idStart < 0 ? undefined : markup.slice(idStart, markup.indexOf('"', idStart));
  expect(forId, "address label").toBeTruthy();
  const input = openingTag(markup, markup.indexOf(`<input id="${forId}"`));
  const hintStart = markup.indexOf(`<p id="${forId}-hint"`);
  const hintBodyStart = hintStart + openingTag(markup, hintStart).length;
  const hint =
    hintStart < 0 ? undefined : markup.slice(hintBodyStart, markup.indexOf("<", hintBodyStart));
  return { input, hint, forId: forId! };
}

describe("SessionForm address field (DD-128 OD-4a)", () => {
  it.each(["create", "edit"] as const)(
    "%s: maxLength 200 and a visible hint wired by aria-describedby",
    (mode) => {
      const vi = addressField(html(mode, "vi"), "Địa chỉ");
      expect(vi.input).toContain('maxLength="200"');
      expect(vi.input).toContain(`aria-describedby="${vi.forId}-hint"`);
      expect(vi.hint).toBe("Tối đa 200 ký tự");
      const en = addressField(html(mode, "en"), "Address");
      expect(en.input).toContain('maxLength="200"');
      expect(en.hint).toBe("Up to 200 characters");
    },
  );
});

describe("SessionForm price mode (DD-39, readiness 4.9)", () => {
  it.each([
    [
      "vi",
      ["Cách tính giá", "Một giá cho mọi người", "Giá theo giới tính", "Giá mỗi người (VND)"],
      ["Giá mặc định (VND)", "Giá nam (VND)", "Giá nữ (VND)"],
      "Áp dụng cho người chưa đặt giới tính, không cho phép dùng giới tính để tính giá, hoặc chọn Khác / Không tiết lộ.",
    ],
    [
      "en",
      ["Pricing", "One price for everyone", "Price by gender", "Price per player (VND)"],
      ["Default price (VND)", "Price for men (VND)", "Price for women (VND)"],
      "Applies to players with no gender set, who have not allowed gender pricing, or who chose Other / Prefer not to say.",
    ],
  ] as const)(
    "%s: one price shows one input; price by gender shows the default price and two inputs",
    (lang, [pricing, one, byGender, perPlayer], [defaultPrice, men, women], hint) => {
      const single = html("create", lang);
      expect(single).toContain(`>${pricing}</label>`);
      expect(single).toContain(`>${one}</option>`);
      expect(single).toContain(`>${byGender}</option>`);
      expect(single).toContain(`>${perPlayer}</label>`);
      for (const absent of [defaultPrice, men, women, hint]) expect(single).not.toContain(absent);

      const gender = html("edit", lang, { priceMode: "gender", priceMale: "60.000" });
      for (const label of [defaultPrice, men, women]) expect(gender).toContain(`>${label}</label>`);
      expect(gender).toContain(hint);
      expect(gender).toContain('value="60.000"');
      expect(gender).not.toContain(perPlayer);
    },
  );
});
