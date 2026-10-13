import { SettingsView } from "../../../components/me/settings-view";

// Session-dependent: never prerender or cache.
export const dynamic = "force-dynamic";

/** /me/settings: the layout (MeFrame) proves the session; every datum arrives through /api/me/*. */
export default function MeSettingsPage() {
  return <SettingsView />;
}
