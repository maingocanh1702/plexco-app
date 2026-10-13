import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { LangProvider } from "../../lib/i18n-client";
import type { LinkedChannelDto } from "../../lib/me-settings-client";
import { SettingsChannelsList } from "./settings-channels-list";
import { SettingsProfileForm } from "./settings-profile-form";

const wrap = (node: React.ReactNode, lang: "vi" | "en" = "en") =>
  renderToStaticMarkup(<LangProvider lang={lang}>{node}</LangProvider>);

const CHANNELS: LinkedChannelDto[] = [
  { id: "c1", platform: "zalo", status: "active", createdAt: "2026-10-01T00:00:00Z" },
  { id: "c2", platform: "messenger", status: "inactive", createdAt: "2026-09-01T00:00:00Z" },
];

describe("SettingsProfileForm", () => {
  it("renders a labelled, described display-name field and a submit button", () => {
    const html = wrap(
      <SettingsProfileForm initial={{ displayName: "Lan" }} csrfToken="x" onSaved={vi.fn()} />,
    );
    expect(html).toContain("Display name");
    expect(html).toContain('value="Lan"');
    expect(html).toContain("aria-describedby");
    expect(html).toContain('type="submit"');
  });

  it("renders in Vietnamese (HR5: t(vi,en))", () => {
    const html = wrap(
      <SettingsProfileForm initial={{ displayName: null }} csrfToken="x" onSaved={vi.fn()} />,
      "vi",
    );
    expect(html).toContain("Tên hiển thị");
    expect(html).toContain("Lưu");
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
    expect(html).toContain("Disconnected");
    expect(html.match(/Unlink/g)?.length).toBeGreaterThanOrEqual(1);
    // one Unlink trigger button (the active row) + the dialog's confirm label
    expect(html.match(/<button[^>]*>Unlink<span/g)?.length).toBe(1);
  });

  it("never renders an id, token or raw platform identifier", () => {
    const html = wrap(
      <SettingsChannelsList channels={CHANNELS} csrfToken="secret-csrf" onChanged={vi.fn()} />,
    );
    expect(html).not.toContain("secret-csrf");
    expect(html).not.toContain('"c1"');
  });
});
