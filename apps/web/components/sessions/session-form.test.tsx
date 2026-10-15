import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LangProvider } from "../../lib/i18n-client";
import { emptyFormValues } from "../../lib/session-form-model";
import { SessionForm } from "./session-form";

const html = (mode: "create" | "edit", lang: "vi" | "en") =>
  renderToStaticMarkup(
    <LangProvider lang={lang}>
      <SessionForm
        mode={mode}
        initial={{ ...emptyFormValues(), sportId: "s1", venueAddress: "x".repeat(250) }}
        timezone="Asia/Ho_Chi_Minh"
        sports={[{ id: "s1", name: "Cầu lông" }]}
        submitLabel="Save"
        cancelHref="/x"
        onSubmit={async () => {}}
      />
    </LangProvider>,
  );

/** The <input> that the "Địa chỉ" / "Address" label points at, plus its hint paragraph. */
function addressField(markup: string, label: string) {
  const forId = new RegExp(`<label for="([^"]+)"[^>]*>${label}</label>`).exec(markup)?.[1];
  expect(forId, "address label").toBeTruthy();
  const input = new RegExp(`<input id="${forId}"[^>]*>`).exec(markup)?.[0] ?? "";
  const hint = new RegExp(`<p id="${forId}-hint"[^>]*>([^<]*)</p>`).exec(markup)?.[1];
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
