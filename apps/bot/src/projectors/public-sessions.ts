import type { DeliverFn } from "../dispatcher.js";

/**
 * PLACEHOLDER for the public_sessions projector (readiness D-8); lane L10 (public read
 * model) replaces only this file. The registry seeds public_sessions DISABLED (0056), so this
 * is never called. If the row is enabled before the real module lands, every delivery
 * dead-letters as projector_not_implemented (replayable with scripts/outbox-dlq-replay.mjs).
 * No I/O.
 */
export const deliverPublicSessions: DeliverFn = async () => ({
  result: "dlq",
  errorCode: "projector_not_implemented",
});
