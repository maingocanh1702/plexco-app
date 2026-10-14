import { SectionPlaceholder } from "../../../../components/shell/section-placeholder";

export default async function SettingsPage({ params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params;
  return <SectionPlaceholder tenantId={tenantId} section="settings" />;
}
