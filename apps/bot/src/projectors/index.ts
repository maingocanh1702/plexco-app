import type { ProjectorMap } from "../dispatcher.js";
import { deliverPublicSessions } from "./public-sessions.js";
import { deliverWebRealtime } from "./web-realtime.js";
import { deliverZaloDm } from "./zalo-dm.js";

/**
 * Projector name -> deliver function: the code half of the registry (D-6, D-8). The registry
 * tables (0056) decide which projectors an event needs and whether each is enabled; this map only
 * says how to deliver. A name enabled in the registry with no entry here is never claimed: its
 * rows wait and the dispatcher warns once per cycle. L4, L5 and L10 replace only their own module
 * file and never edit this one.
 *
 * Contract of every deliver function (D-18):
 *   - idempotent per (aggregate_id, sequence): a re-claimed or replayed delivery repeats nothing;
 *   - tolerates out-of-order and replayed events (claims run in created_at order across
 *     aggregates, 0023) and reloads canonical state rather than trusting an old payload;
 *   - may see a stale backlog after a long disable, and must not act on stale facts;
 *   - returns delivered | retry (retryable) | dlq (terminal) with an error code matching
 *     ^[a-z][a-z0-9_]{0,63}$, and never schedules its own retry: the dispatcher does (D-7).
 */
export const PROJECTORS: ProjectorMap = new Map([
  ["public_sessions", deliverPublicSessions],
  ["web_realtime", deliverWebRealtime],
  ["zalo_dm", deliverZaloDm],
]);
