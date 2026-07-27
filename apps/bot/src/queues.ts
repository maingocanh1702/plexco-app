/**
 * Registry of pg-boss queue names. Queues are DDL in pg-boss v10 (partition
 * tables), so they are created at PROVISION time (provision-queue.ts, migration
 * role) — never by the runtime worker. Every slice that adds a queue appends
 * its name here.
 */

/**
 * PLACEHOLDER — not a real channel/projector name. The only queue this repo
 * has ever registered: a periodic trigger for the outbox dispatch cycle
 * (dispatcher.ts). No cron/schedule sends jobs to it yet (slice 3) and no
 * producer inserts outbox_events yet (deferred out of scope) — today this
 * queue exists so preflight/worker wiring has something real to assert
 * against, not because anything drives it in production.
 */
export const OUTBOX_DISPATCH_QUEUE = "outbox_dispatch";

export const QUEUES: readonly string[] = [OUTBOX_DISPATCH_QUEUE];
