import { SessionsListView } from "../../../../components/sessions/sessions-list-view";

/** The layout already gates the signed-in session; membership/authorization is the API's job. */
export default async function SessionsPage({ params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params;
  return <SessionsListView tenantId={tenantId} />;
}
