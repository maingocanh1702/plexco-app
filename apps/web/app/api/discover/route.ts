import { listDiscoveryListings } from "@plexco/db";
import { ok } from "../../../lib/api-envelope";
import { encodeDiscoveryCursor } from "../../../lib/discovery-cursor";
import {
  discoveryInvalidFilter,
  discoveryPool,
  discoveryRateLimited,
  discoveryServerError,
  parseDiscoveryListQuery,
  toDiscoveryListingDto,
} from "../../../lib/discovery-route-support";

/**
 * GET /api/discover -- the anonymous discovery list (readiness 4.4): the per-IP limiter, filters
 * validated before any DB call, whitelist items, a signed keyset cursor. Any failure is the empty 500.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    const limited = discoveryRateLimited(request);
    if (limited) return limited;
    const filter = parseDiscoveryListQuery(new URL(request.url).searchParams);
    if (!filter) return discoveryInvalidFilter();
    const page = await listDiscoveryListings(await discoveryPool(), filter);
    return ok({
      items: page.rows.map((row) => toDiscoveryListingDto(row)),
      nextCursor: page.next ? encodeDiscoveryCursor(page.next) : null,
    });
  } catch {
    return discoveryServerError();
  }
}
