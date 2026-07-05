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
