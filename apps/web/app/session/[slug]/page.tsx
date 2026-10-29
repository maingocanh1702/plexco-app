import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { readDiscoveryListingByShareSlug } from "@plexco/db";
import { t } from "@plexco/core/i18n";
import { ListingSummary } from "../../../components/discover/listing-summary";
import { str, type DiscoveryListing } from "../../../lib/discover-api";
import {
  discoveryPool,
  discoveryRateLimited,
  toDiscoveryListingDto,
} from "../../../lib/discovery-route-support";

// Never cached (a stale render would outlive a rotate or a private flip), not indexed, no Referer.
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

/**
 * /session/<slug>: the share API's order (limiter, shape, read, whitelist DTO). Every miss, over
 * budget too (a page cannot answer 429), is ONE notFound(): no oracle; no loading.tsx or Suspense
 * (a streamed 200). A DB or config failure reaches the error boundary; the slug is never logged.
 * Default language (bucket b, as that route): no DiscoverFrame, which would mix languages.
 */
export default async function PublicSessionSharePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const request = new Request("http://localhost/session", { headers: await headers() });
  // The DD-83 shape, a copy of route.ts:5; the lookup definer re-checks it (0061:447-461).
  const row =
    (await discoveryRateLimited(request)) || !/^[A-Za-z0-9_-]{22}$/.test(slug)
      ? null
      : await readDiscoveryListingByShareSlug(await discoveryPool(), slug);
  if (!row) notFound();
  // Client props land in the HTML: the DTO only, never the row; null for each key the DTO drops.
  const dto = {
    title: null,
    venueName: null,
    venueAddress: null,
    ...toDiscoveryListingDto(row),
  } as DiscoveryListing;
  // As parseListing (lib/discover-api.ts): an empty title is absent, so the sport label shows.
  const listing: DiscoveryListing = { ...dto, title: str(dto.title) };
  return (
    <main>
      <ListingSummary listing={listing} as="h1" />
      <a href={`/discover/${listing.publicListingId}`} rel="noreferrer">
        {t("Xem và tham gia", "View and join")}
      </a>
    </main>
  );
}
