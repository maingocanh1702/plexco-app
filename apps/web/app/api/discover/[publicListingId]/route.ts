import { readDiscoveryListing } from "@plexco/db";
import { isPublicListingId } from "../../../../lib/discovery-cursor";
import { serveDiscoveryListing } from "../../../../lib/discovery-route-support";

/** GET /api/discover/<publicListingId> -- one public listing by its listing id (readiness 4.5). */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ publicListingId: string }> },
): Promise<Response> {
  const { publicListingId } = await params;
  return serveDiscoveryListing(request, publicListingId, isPublicListingId, readDiscoveryListing);
}
