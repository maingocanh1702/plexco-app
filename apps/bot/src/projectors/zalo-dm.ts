import type { DeliverFn } from "../dispatcher.js";

/**
 * PLACEHOLDER for the zalo_dm projector (readiness D-8); lane L4 (Zalo outbound DM) replaces
 * only this file. The registry seeds zalo_dm DISABLED (0056), so this is never called. If
 * the row is enabled before the real module lands, every delivery dead-letters as
 * projector_not_implemented (replayable with scripts/outbox-dlq-replay.mjs). No I/O.
 */
export const deliverZaloDm: DeliverFn = async () => ({
  result: "dlq",
  errorCode: "projector_not_implemented",
});
