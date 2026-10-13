import { NewSessionView } from "../../../../../components/sessions/new-session-view";

export default async function NewSessionPage({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  const { tenantId } = await params;
  return <NewSessionView tenantId={tenantId} />;
}
