import { GENDER_VALUES } from "@plexco/core";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { LangProvider } from "../../lib/i18n-client";
import type { LinkedChannelDto, ProfileView } from "../../lib/me-settings-client";
import { SessionProvider } from "../../lib/use-session";
import { SettingsChannelsList } from "./settings-channels-list";
import { SettingsProfileForm } from "./settings-profile-form";
import { SettingsView } from "./settings-view";

// SettingsView loads through useLoadable; a static render runs no effect, so it gets a ready state.
const loaded = vi.hoisted(() => ({ profile: null as unknown }));
vi.mock("../../lib/use-sessions-data", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useLoadable: () => ({
    state: { status: "ready", data: { profile: loaded.profile, channels: [] } },
    reload: () => undefined,
    refresh: () => undefined,
  }),
}));

const PROFILE: ProfileView = {
  displayName: "Lan",
  gender: null,
  genderConsent: false,
  genderCollection: true,
};

// The channel list reloads through the session context (a CSRF_INVALID needs its fresh csrfToken);
// a static render runs no effect, so the provider never fetches here.
const wrap = (node: React.ReactNode, lang: "vi" | "en" = "en") =>
  renderToStaticMarkup(
    <LangProvider lang={lang}>
      <SessionProvider>{node}</SessionProvider>
    </LangProvider>,
  );

const CHANNELS: LinkedChannelDto[] = [
  { id: "c1", platform: "zalo", status: "active", createdAt: "2026-10-01T00:00:00Z" },
  { id: "c2", platform: "messenger", status: "inactive", createdAt: "2026-09-01T00:00:00Z" },
];

describe("SettingsProfileForm", () => {
  const NO_GENDER = { gender: null, genderConsent: false, genderCollection: false } as const;
  it("renders a labelled, described display-name field and a submit button", () => {
    const html = wrap(
      <SettingsProfileForm
        initial={{ displayName: "Lan", ...NO_GENDER }}
        csrfToken="x"
        onSaved={vi.fn()}
      />,
    );
    expect(html).toContain("Display name");
    expect(html).toContain('value="Lan"');
    expect(html).toContain("aria-describedby");
    expect(html).toContain('type="submit"');
  });

  it("renders in Vietnamese (HR5: t(vi,en))", () => {
    const html = wrap(
      <SettingsProfileForm
        initial={{ displayName: null, ...NO_GENDER }}
        csrfToken="x"
        onSaved={vi.fn()}
      />,
      "vi",
    );
    expect(html).toContain("Tên hiển thị");
    expect(html).toContain("Lưu");
  });
});

describe("SettingsProfileForm gender and pricing consent (DD-39, T-24)", () => {
  const form = (initial: Partial<ProfileView>, lang: "vi" | "en" = "en") =>
    wrap(
      <SettingsProfileForm initial={{ ...PROFILE, ...initial }} csrfToken="x" onSaved={vi.fn()} />,
      lang,
    );

  it("flag OFF: no selector, consent box or remove button while nothing is stored", () => {
    const html = form({ genderCollection: false });
    expect(html).not.toContain("<select");
    expect(html).not.toContain('type="checkbox"');
    expect(html).not.toContain("Remove my saved gender");
  });

  it("flag OFF with stored data: only the remove button", () => {
    for (const stored of [{ gender: "female" }, { genderConsent: true }] as const) {
      const html = form({ genderCollection: false, ...stored });
      expect(html).toContain("Remove my saved gender");
      expect(html).not.toContain("<select");
      expect(html).not.toContain('type="checkbox"');
    }
    expect(form({ genderCollection: false, gender: "male" }, "vi")).toContain(
      "Xoá giới tính đã lưu",
    );
  });

  it("flag ON: GENDER_VALUES plus Not set with t(vi, en) labels, and the consent box", () => {
    const en = form({});
    const vi = form({}, "vi");
    for (const v of GENDER_VALUES) expect(en).toContain(`<option value="${v}"`);
    expect(en.match(/<option/g)).toHaveLength(GENDER_VALUES.length + 1);
    for (const o of ["Not set", "Male", "Female", "Other", "Prefer not to say"])
      expect(en).toContain(`>${o}</option>`);
    for (const o of ["Chưa đặt", "Nam", "Nữ", "Khác", "Không tiết lộ"])
      expect(vi).toContain(`>${o}</option>`);
    expect(en).toContain(">Gender</label>");
    expect(vi).toContain(">Giới tính</label>");
    expect(en).toContain("Allow clubs to use my gender for pricing");
    expect(vi).toContain("Cho phép CLB sử dụng giới tính để tính giá");
    expect(en).toContain("Gender not shared");
    expect(vi).toContain("Không chia sẻ giới tính");
    // No consent without a gender: the box is disabled while gender is Not set.
    expect(en).toMatch(/<input[^>]*type="checkbox"[^>]*disabled=""/);
    expect(en).not.toContain("Remove my saved gender");
  });

  it("flag ON: shows the stored choice and consent; the not-shared caption only while consent is off", () => {
    const html = form({ gender: "female", genderConsent: true });
    expect(html).toContain('<option value="female" selected="">');
    expect(html).toMatch(/<input[^>]*type="checkbox"[^>]*checked=""/);
    expect(html).not.toMatch(/<input[^>]*type="checkbox"[^>]*disabled/);
    expect(html).not.toContain("Gender not shared");
  });
});

describe("SettingsView gender prompt (T-2, U-20)", () => {
  const PROMPT =
    "You have not set your gender. In sessions priced by gender you pay the default price until you set it.";
  const page = (profile: Partial<ProfileView>, lang: "vi" | "en" = "en") => {
    loaded.profile = { ...PROFILE, ...profile };
    return wrap(<SettingsView />, lang);
  };

  it("a status paragraph above the Profile card, only with the flag ON and gender null", () => {
    const html = page({});
    expect(html).toMatch(/<p[^>]*role="status"[^>]*>You have not set your gender\./);
    expect(html).toContain(PROMPT);
    expect(html.indexOf(PROMPT)).toBeLessThan(html.indexOf('id="me-profile"'));
    expect(page({}, "vi")).toContain(
      "Bạn chưa đặt giới tính. Ở kèo có giá theo giới tính, bạn sẽ trả giá mặc định cho tới khi đặt.",
    );
    expect(page({ gender: "male" })).not.toContain(PROMPT);
    expect(page({ genderCollection: false })).not.toContain(PROMPT);
  });
});

describe("SettingsChannelsList", () => {
  it("empty state points at /me/link", () => {
    const html = wrap(<SettingsChannelsList channels={[]} csrfToken="x" onChanged={vi.fn()} />);
    expect(html).toContain("No linked channels");
    expect(html).toContain('href="/me/link"');
  });

  it("lists platform + status text (not colour only); only ACTIVE rows can be unlinked", () => {
    const html = wrap(
      <SettingsChannelsList channels={CHANNELS} csrfToken="x" onChanged={vi.fn()} />,
    );
    expect(html).toContain("Zalo");
    expect(html).toContain("Messenger");
    expect(html).toContain("Linked");
    expect(html).toContain("Inactive");
    // the inactive row says why it has no unlink action (detach moves active channels only)
    expect(html).toContain("cannot be unlinked for now");
    expect(html.match(/Unlink/g)?.length).toBeGreaterThanOrEqual(1);
    // one Unlink trigger button (the active row) + the dialog's confirm label
    expect(html.match(/<button[^>]*>Unlink<span/g)?.length).toBe(1);
  });

  it("the date is labelled as when the channel was first seen, not as a link time", () => {
    const html = wrap(
      <SettingsChannelsList channels={CHANNELS} csrfToken="x" onChanged={vi.fn()} />,
      "vi",
    );
    expect(html).toContain("Ghi nhận từ ngày");
    expect(html).not.toContain("Liên kết ngày");
  });

  it("the confirm copy says the bot will treat the channel account as a new stranger", () => {
    const viHtml = wrap(
      <SettingsChannelsList channels={CHANNELS} csrfToken="x" onChanged={vi.fn()} />,
      "vi",
    );
    expect(viHtml).toContain("bot sẽ coi tài khoản Zalo này là một người lạ mới");
    const enHtml = wrap(
      <SettingsChannelsList channels={CHANNELS} csrfToken="x" onChanged={vi.fn()} />,
    );
    expect(enHtml).toContain("the bot treats this Zalo account as a new stranger");
  });

  it("the outcome live region is mounted before any unlink (so the result is announced)", () => {
    const html = wrap(
      <SettingsChannelsList channels={CHANNELS} csrfToken="x" onChanged={vi.fn()} />,
    );
    expect(html).toContain('role="status"');
  });

  it("never renders an id, token or raw platform identifier", () => {
    const html = wrap(
      <SettingsChannelsList channels={CHANNELS} csrfToken="secret-csrf" onChanged={vi.fn()} />,
    );
    expect(html).not.toContain("secret-csrf");
    expect(html).not.toContain('"c1"');
  });
});
