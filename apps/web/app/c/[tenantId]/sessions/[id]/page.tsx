import { SessionDetailView } from "../../../../../components/sessions/session-detail-view";

export default async function SessionDetailPage({
  params,
}: {
  params: Promise<{ tenantId: string; id: string }>;
}) {
  const { tenantId, id } = await params;
  return <SessionDetailView tenantId={tenantId} sessionId={id} />;
}
