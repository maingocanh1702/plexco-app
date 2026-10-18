import { readDiscoveryListingByShareSlug } from "@plexco/db";
import { serveDiscoveryListing } from "../../../../../lib/discovery-route-support";

// The DD-83 share slug shape; the lookup definer re-checks it (0061:447-461).
const SHARE_SLUG = /^[A-Za-z0-9_-]{22}$/;

/**
 * GET /api/discover/share/<slug> -- a host-shared listing (readiness 4.5); the slug resolves in the
 * DB only, so no tenant id or session uuid ever leaves it.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const { slug } = await params;
  return serveDiscoveryListing(
    request,
    slug,
    (key) => SHARE_SLUG.test(key),
    readDiscoveryListingByShareSlug,
  );
}
