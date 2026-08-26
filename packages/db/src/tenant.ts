import { and, asc, eq, sql } from "drizzle-orm";
import { sessions } from "../schema.js";
import type { Db } from "./client.js";

/**
 * Tenant choke-point (HR1 / INV-1 / BL-TEN-1).
 *
 * EVERY tenant-scoped read/write goes through withTenant/tenantRepo — never
 * query tenant tables directly from a controller (enforced by the eslint
 * no-restricted-imports guard on `@plexco/db/schema` outside this package).
 *
 * Mechanics: one transaction per unit of work; `SELECT set_config('app.tenant_id',
 * $1, true)` pins the RLS GUC for THAT transaction only (set_config is used
 * because SET LOCAL cannot take bind parameters). Missing GUC on any other
 * connection → current_setting(..., true) is NULL → policies match 0 rows —
 * fail-closed, including for reused pool connections.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function assertTenantId(tenantId: string): void {
  if (!UUID_RE.test(tenantId)) {
    throw new Error("withTenant: tenantId must be a UUID from trusted routing, never user input");
  }
}

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export async function withTenant<T>(
  db: Db,
  tenantId: string,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  assertTenantId(tenantId);
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.tenant_id', ${tenantId}, true)`);
    return fn(tx);
  });
}

export interface CreateSessionInput {
  sportId: string;
  startsAt: Date;
  endsAt: Date;
  timezone: string;
  priceAmount?: number;
  slotsMax?: number | null;
  area?: string | null;
  venueName?: string | null;
  visibility?: "private" | "public";
  joinPolicy?: "open" | "approval";
  status?: "draft" | "open";
}

/**
 * Repo bound to ONE trusted tenant id. The surface grows per feature slice
 * (session-management adds the full command set); the shape stays: every
 * method runs inside withTenant, and tenant_id is injected here — callers
 * can never pass their own.
 */
export function tenantRepo(db: Db, tenantId: string) {
  assertTenantId(tenantId);
  return {
    tenantId,
    sessions: {
      list: () =>
        withTenant(db, tenantId, (tx) =>
          tx
            .select()
            .from(sessions)
            .where(eq(sessions.tenantId, tenantId))
            .orderBy(asc(sessions.startsAt)),
        ),
      getById: (sessionId: string) =>
        withTenant(db, tenantId, async (tx) => {
          const rows = await tx
            .select()
            .from(sessions)
            .where(and(eq(sessions.id, sessionId), eq(sessions.tenantId, tenantId)));
          return rows[0] ?? null;
        }),
      create: (input: CreateSessionInput) =>
        withTenant(db, tenantId, async (tx) => {
          const rows = await tx
            .insert(sessions)
            .values({
              tenantId,
              sportId: input.sportId,
              startsAt: input.startsAt,
              endsAt: input.endsAt,
              timezone: input.timezone,
              priceAmount: input.priceAmount ?? 0,
              slotsMax: input.slotsMax ?? null,
              area: input.area ?? null,
              venueName: input.venueName ?? null,
              visibility: input.visibility ?? "private",
              joinPolicy: input.joinPolicy ?? "open",
              status: input.status ?? "draft",
            })
            .returning();
          return rows[0]!;
        }),
    },
  };
}

export type TenantRepo = ReturnType<typeof tenantRepo>;

/**
 * The tenant's configured locale as stored, or null when there is no such tenant.
 *
 * CONTRACT
 *   returns  the raw `tenants.locale` value, or null. NULL IS NOT AUTHORITATIVE ABSENCE: it means
 *            "undetermined". Three paths produce it — no matching tenant row, a non-UUID id, and
 *            any unexpected failure (logged, never silent). A caller MUST NOT read null as "this
 *            tenant does not exist"; DD-118 is what says undetermined resolves to vi
 *   throws   never at the request boundary (see NEVER-THROWS below)
 *   caller   MUST normalise via DD-118's seam: `resolveLang(null, parseLang(raw ?? "") ?? "vi")`
 *
 * READS THROUGH `tenant_locale()` (migration 0035), NOT through the table. The `app` role holds
 * zero privileges on `tenants`, so the obvious `withTenant` + select shape raises a permission
 * error for every caller. v1 of this lane did exactly that, swallowed the error, and shipped a
 * no-op that passed 1191 tests: null means "fall back to vi", so every tenant resolved to
 * Vietnamese. The privilege class is now gone BY CONSTRUCTION — EXECUTE is granted to `app` —
 * which is why the migration belongs to this feature rather than to a follow-up.
 *
 * NEVER-THROWS, AMENDED. A throw inside the actor-authorization choke-point is an outage, so the
 * request-time guarantee stands. But it must NOT mean "every failure becomes null", which is the
 * property that hid v1's defect by collapsing "you lack privilege" onto "no such tenant". So:
 *   - a non-UUID id returns null WITHOUT reaching the database (a caller bug, benign, tested);
 *   - a missing tenant returns null — the ordinary, expected path;
 *   - anything else is genuinely unexpected. It is still not re-thrown — but it is LOGGED with
 *     the underlying error before the fallback, so the class can never reach production
 *     unobserved. The app-role suite is what proves the privilege class is not in it.
 *
 * Returns a RAW string rather than a validated language on purpose: `packages/db` has no
 * dependency on `@plexco/core`, and the vocabulary has exactly one owner (`parseLang`).
 */
export async function tenantLocale(db: Db, tenantId: string): Promise<string | null> {
  if (!UUID_RE.test(tenantId)) return null;
  try {
    const result = await db.execute(sql`SELECT tenant_locale(${tenantId}::uuid) AS locale`);
    const rows = result.rows as { locale: string | null }[];
    return rows[0]?.locale ?? null;
  } catch (error) {
    // Deliberately loud. Reaching here means an error class the amendment says must not be
    // silent — after 0035 the permission failure is impossible, so this is a real anomaly.
    console.error(
      "[tenantLocale] unexpected failure; falling back to the default language:",
      error,
    );
    return null;
  }
}
