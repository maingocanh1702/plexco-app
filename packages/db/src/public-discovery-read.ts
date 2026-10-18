import type pg from "pg";

// Phase 3 L10b (M9): the anonymous discovery read over the replaced guarded view
// public_session_share_v (0061 2c), run AS the readonly role. Contract:
// docs/sessions/web-mvp-phase3-readiness-p3-m9-discovery-read.md sections 4.2, 4.4 and 4.5.
// The caller (the web discovery route support) owns the readonly pool and its role assert: this
// module opens no pool, reads no env and logs nothing. Every statement is a static string with
// bound parameters only. A public_listing_id or a share slug resolves to (tenant, session) inside
// the DB through the 0061 lookups; tenant_id and session_id leave it only through
// resolveDiscoveryListing, which the join route hands straight to joinSession.

/** One row of public_session_share_v: the structural whitelist (4.4), nothing else is selected. */
export interface DiscoveryListingRow {
  public_listing_id: string;
  sport_key: string;
  starts_at: Date;
  ends_at: Date;
  area: string;
  price_amount: number;
  slots_open: number;
  club_display_name: string;
  join_policy: string;
  title: string | null;
  session_type: string | null;
  level_min_rank: number | null;
  level_max_rank: number | null;
  level_strict: boolean | null;
  gender_restriction: string | null;
  age_min: number | null;
  age_max: number | null;
}

/** A keyset position: starts_at as UTC microsecond text (never a JS Date, which truncates). */
export interface DiscoveryKeyset {
  startsAt: string;
  publicListingId: string;
}

/** Values the route has already validated (4.4); an absent field applies no filter. */
export interface DiscoveryListFilter {
  sport?: string;
  area?: string;
  startAfter?: Date;
  startBefore?: Date;
  maxPrice?: number;
  availableOnly?: boolean;
  limit: number;
  after?: DiscoveryKeyset;
}

export interface DiscoveryListPage {
  rows: DiscoveryListingRow[];
  /** The last row's keyset when another page exists; null on the last page. */
  next: DiscoveryKeyset | null;
}

export interface DiscoveryListingTarget {
  tenantId: string;
  sessionId: string;
}

export const DISCOVERY_PAGE_LIMIT_MAX = 50;

// The 17 view columns, a constant: it is spliced only into the constant statements below.
const COLUMNS = `public_listing_id, sport_key, starts_at, ends_at, area, price_amount, slots_open,
  club_display_name, join_policy, title, session_type, level_min_rank, level_max_rank, level_strict,
  gender_restriction, age_min, age_max`;

const LIST_SQL = `SELECT ${COLUMNS},
       to_char(starts_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS keyset_starts_at
  FROM public_session_share_v
 WHERE ($1::text IS NULL OR sport_key = $1)
   AND ($2::text IS NULL OR area = $2)
   AND ($3::timestamptz IS NULL OR starts_at >= $3)
   AND ($4::timestamptz IS NULL OR starts_at < $4)
   AND ($5::integer IS NULL OR price_amount <= $5)
   AND (NOT $6::boolean OR slots_open > 0)
   AND ($7::timestamptz IS NULL OR (starts_at, public_listing_id) > ($7::timestamptz, $8::uuid))
 ORDER BY starts_at ASC, public_listing_id ASC
 LIMIT $9`;

/** One page in (starts_at, public_listing_id) order, fetched as LIMIT n+1 to detect a next page. */
export async function listDiscoveryListings(
  pool: pg.Pool,
  filter: DiscoveryListFilter,
): Promise<DiscoveryListPage> {
  const { limit } = filter;
  if (!Number.isInteger(limit) || limit < 1 || limit > DISCOVERY_PAGE_LIMIT_MAX) {
    throw new RangeError(`discovery page limit must be an integer 1-${DISCOVERY_PAGE_LIMIT_MAX}`);
  }
  const { rows } = await pool.query<DiscoveryListingRow & { keyset_starts_at?: string }>(LIST_SQL, [
    filter.sport ?? null,
    filter.area ?? null,
    filter.startAfter ?? null,
    filter.startBefore ?? null,
    filter.maxPrice ?? null,
    filter.availableOnly === true,
    filter.after?.startsAt ?? null,
    filter.after?.publicListingId ?? null,
    limit + 1,
  ]);
  const page = rows.slice(0, limit);
  const last = rows.length > limit ? page[limit - 1]! : null;
  const next = last && {
    startsAt: last.keyset_starts_at!,
    publicListingId: last.public_listing_id,
  };
  for (const row of page) delete row.keyset_starts_at; // rows carry the whitelist only
  return { rows: page, next };
}

/** The detail by public_listing_id (the route has checked the uuid shape). */
export async function readDiscoveryListing(
  pool: pg.Pool,
  publicListingId: string,
): Promise<DiscoveryListingRow | null> {
  const { rows } = await pool.query<DiscoveryListingRow>(
    `SELECT ${COLUMNS} FROM public_session_share_v WHERE public_listing_id = $1::uuid`,
    [publicListingId],
  );
  return rows[0] ?? null;
}

/** The host-shared link, ONE statement: the slug lookup joins the view inside the DB, so the
 *  lookup's tenant_id and session_id never leave it (USING keeps only public_listing_id). */
export async function readDiscoveryListingByShareSlug(
  pool: pg.Pool,
  slug: string,
): Promise<DiscoveryListingRow | null> {
  const { rows } = await pool.query<DiscoveryListingRow>(
    `SELECT ${COLUMNS}
       FROM public_share_slug_resolve($1) r
       JOIN public_session_share_v v USING (public_listing_id)`,
    [slug],
  );
  return rows[0] ?? null;
}

/** The join route's target: (tenant, session) of a listing visible right now, else null. */
export async function resolveDiscoveryListing(
  pool: pg.Pool,
  publicListingId: string,
): Promise<DiscoveryListingTarget | null> {
  const { rows } = await pool.query<{ tenant_id: string; session_id: string }>(
    "SELECT tenant_id, session_id FROM public_listing_resolve($1::uuid)",
    [publicListingId],
  );
  const row = rows[0];
  return row ? { tenantId: row.tenant_id, sessionId: row.session_id } : null;
}
