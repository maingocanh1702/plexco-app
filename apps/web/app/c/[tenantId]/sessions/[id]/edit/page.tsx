import { EditSessionView } from "../../../../../../components/sessions/edit-session-view";

export default async function EditSessionPage({
  params,
}: {
  params: Promise<{ tenantId: string; id: string }>;
}) {
  const { tenantId, id } = await params;
  return <EditSessionView tenantId={tenantId} sessionId={id} />;
}
