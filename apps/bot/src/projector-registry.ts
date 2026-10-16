import type pg from "pg";

/**
 * The worker's only doors into the projector registry (0056). app_worker holds no privilege on
 * outbox_events, projector_deliveries or the registry tables; each call below is one EXECUTE of a
 * job_definer definer.
 */

/** A pool or a checked-out client. */
export type Queryable = Pick<pg.Pool, "query">;

/** The event a projector receives, read through its claim (0056 outbox_claimed_event). */
export interface ProjectorEvent {
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  sequence: number;
  tenantId: string;
  payload: unknown;
  createdAt: Date;
}

interface ClaimedEventRow {
  event_type: string;
  aggregate_type: string;
  aggregate_id: string;
  sequence: number;
  tenant_id: string;
  payload: unknown;
  created_at: Date;
}

/**
 * The enabled projectors routed for one event, sorted and duplicate-free; [] when none. Computed
 * once per event at ack time (D-5). Anything but an array fails closed: phase 1 then throws and the
 * event stays claimed until its lease expires, instead of being acked with a made-up set.
 */
export async function requiredProjectorsFor(db: Queryable, eventId: string): Promise<string[]> {
  const result = await db.query<{ projectors: unknown }>(
    "SELECT outbox_required_projectors($1) AS projectors",
    [eventId],
  );
  const projectors = result.rows[0]?.projectors;
  if (!Array.isArray(projectors) || !projectors.every((p) => typeof p === "string")) {
    throw new Error(`outbox_required_projectors returned no projector set for event ${eventId}`);
  }
  return projectors;
}

/** projector_is_enabled: false for an unknown name (0056). */
export async function projectorIsEnabled(db: Queryable, name: string): Promise<boolean> {
  const result = await db.query<{ enabled: boolean }>(
    "SELECT projector_is_enabled($1) AS enabled",
    [name],
  );
  return result.rows[0]?.enabled === true;
}

/** The claimed event, or null once the claim is gone (wrong token, expired lease, completed). */
export async function claimedEvent(
  db: Queryable,
  eventId: string,
  projector: string,
  claimToken: string,
): Promise<ProjectorEvent | null> {
  const result = await db.query<ClaimedEventRow>("SELECT * FROM outbox_claimed_event($1, $2, $3)", [
    eventId,
    projector,
    claimToken,
  ]);
  const row = result.rows[0];
  if (!row) return null;
  return {
    eventType: row.event_type,
    aggregateType: row.aggregate_type,
    aggregateId: row.aggregate_id,
    sequence: row.sequence,
    tenantId: row.tenant_id,
    payload: row.payload,
    createdAt: row.created_at,
  };
}

/**
 * The worker's registry probe (D-14): it rejects unless migration 0056 is applied and app_worker
 * can reach the registry. Run only when the schedule flag is "true"; a rejection keeps dispatch OFF.
 */
export async function probeOutboxRegistry(db: Queryable): Promise<void> {
  await projectorIsEnabled(db, "web_realtime");
}
