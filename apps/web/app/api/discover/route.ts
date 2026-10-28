import { listDiscoveryListings } from "@plexco/db";
import { ok } from "../../../lib/api-envelope";
import { assertDiscoveryCursorKey, encodeDiscoveryCursor } from "../../../lib/discovery-cursor";
import {
  discoveryInvalidFilter,
  discoveryQuery,
  discoveryRateLimited,
  discoveryServerError,
  parseDiscoveryListQuery,
  toDiscoveryListingDto,
} from "../../../lib/discovery-route-support";

/**
 * GET /api/discover -- the anonymous discovery list (readiness 4.4): the cursor key resolved at
 * entry (a missing or short production key is the 500 on every page, not only on one with a next
 * cursor), filters validated before any DB call (a bad filter costs none), then the per-IP DB
 * limiter and the read through the breaker, whitelist items, a signed keyset cursor. Any other
 * failure is the empty 500.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    assertDiscoveryCursorKey();
    const filter = parseDiscoveryListQuery(new URL(request.url).searchParams);
    if (!filter) return discoveryInvalidFilter();
    const limited = await discoveryRateLimited(request);
    if (limited) return limited;
    const page = await discoveryQuery((pool) => listDiscoveryListings(pool, filter));
    if (page instanceof Response) return page;
    return ok({
      items: page.rows.map((row) => toDiscoveryListingDto(row)),
      nextCursor: page.next ? encodeDiscoveryCursor(page.next) : null,
    });
  } catch {
    return discoveryServerError();
  }
}
