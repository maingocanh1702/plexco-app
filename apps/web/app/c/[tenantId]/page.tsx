import { ClubHome } from "../../../components/shell/club-home";

export default async function ClubHomePage({ params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params;
  return <ClubHome tenantId={tenantId} />;
}
