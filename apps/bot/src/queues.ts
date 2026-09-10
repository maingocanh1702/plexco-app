/**
 * Registry of pg-boss queue names. Queues are DDL in pg-boss v10 (partition
 * tables), so they are created at PROVISION time (provision-queue.ts, migration
 * role) — never by the runtime worker. Every slice that adds a queue appends
 * its name here.
 */

/**
 * PLACEHOLDER — not a real channel/projector name. The only queue this repo
 * has ever registered: a periodic trigger for the outbox dispatch cycle
 * (dispatcher.ts). worker.ts registers a schedule against it (job-infra slice
 * 3a), gated behind OUTBOX_DISPATCH_SCHEDULE_ENABLED. Producers DO exist
 * (packages/db/src/session-service.ts inserts outbox_events for every session
 * command since 2026-08-14 — the old "no producer yet" text here was stale,
 * audit 2026-09-06 X-3): the flag stays off because the only deliverer is
 * productionStubDeliver, which DLQs every row terminally. worker.ts refuses
 * to schedule while that stub is configured — see its own doc comment.
 */
export const OUTBOX_DISPATCH_QUEUE = "outbox_dispatch";

/**
 * pg-boss's OWN internal maintenance queue (timekeeper.js), not one of ours —
 * every cron send is routed through it before fanning out to the real target
 * queue (see OUTBOX_DISPATCH_CRON's doc comment for why this repo must
 * assert its partition exists rather than trust pg-boss's own creation of
 * it). Listed here — not just in a comment — so assertQueuesProvisioned
 * (preflight.ts) covers it for free: that function iterates this array by
 * name, and its own row+partition check is the ONLY thing scoped to names in
 * this array (grants are already asserted schema-wide by assertTableGrants/
 * assertSequenceGrants, independent of this list).
 *
 * Appending it here is empirically safe even though provision-queue.ts's
 * loop also calls boss.createQueue() on it: pg-boss's create_queue SQL does
 * `INSERT ... ON CONFLICT DO NOTHING` and returns before any DDL when the
 * row already exists (verified live against a real database, twice, with no
 * error either time) — so this name does not need its own provisioning path
 * separate from QUEUES.
 */
export const PGBOSS_INTERNAL_SEND_IT_QUEUE = "__pgboss__send-it";

/**
 * pg-boss's own cron granularity floor is one minute, and timekeeper.js's
 * cron() hard-codes a 60-second singleton debounce on every send it enqueues
 * — so anything finer than "every minute" would be silently absorbed by that
 * existing mechanism rather than actually running more often.
 */
export const OUTBOX_DISPATCH_CRON = "* * * * *";

export const QUEUES: readonly string[] = [OUTBOX_DISPATCH_QUEUE, PGBOSS_INTERNAL_SEND_IT_QUEUE];
