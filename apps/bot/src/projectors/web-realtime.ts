import type { DeliverFn } from "../dispatcher.js";

/**
 * PLACEHOLDER for the web_realtime projector (readiness D-8); lane L5 (web live sync) replaces
 * only this file. The registry seeds web_realtime DISABLED (0056), so this is never called. If
 * the row is enabled before the real module lands, every delivery dead-letters as
 * projector_not_implemented (replayable with scripts/outbox-dlq-replay.mjs). No I/O.
 */
export const deliverWebRealtime: DeliverFn = async () => ({
  result: "dlq",
  errorCode: "projector_not_implemented",
});
