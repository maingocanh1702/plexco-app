/**
 * Registry of pg-boss queue names. Queues are DDL in pg-boss v10 (partition
 * tables), so they are created at PROVISION time (provision-queue.ts, migration
 * role) — never by the runtime worker. Every slice that adds a queue appends
 * its name here.
 */
export const QUEUES: readonly string[] = [];
