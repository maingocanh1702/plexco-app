import { ClubSettingsView } from "../../../../components/settings/club-settings-view";

/** The layout gates the signed-in session; authorization (content.manage) is the API's job. */
export default async function SettingsPage({ params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params;
  return <ClubSettingsView tenantId={tenantId} />;
}
