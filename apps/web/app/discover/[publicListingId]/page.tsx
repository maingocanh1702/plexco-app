import { DiscoverDetail } from "../../../components/discover/discover-detail-view";

/** /discover/<publicListingId> (S-2): keyed by the public listing id, never by a session id (P-1). */
export default async function DiscoverDetailPage({
  params,
}: {
  params: Promise<{ publicListingId: string }>;
}) {
  const { publicListingId } = await params;
  return <DiscoverDetail key={publicListingId} publicListingId={publicListingId} />;
}
