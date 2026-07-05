/**
 * @plexco/core — pure, transport/DB-agnostic domain logic.
 *
 * Lifted from the production single-club bot (battle-tested: ~85% auto-match,
 * 0 false positives). Core PROPOSES (candidates/plans/decisions); it never
 * writes to a DB or talks to a transport.
 */
export const CORE_PACKAGE = "@plexco/core";

export * from "./time.js";
export * from "./dates.js";
export * from "./i18n.js";
export * from "./format.js";
export * from "./vietqr.js";
export * from "./sports.js";
export * from "./matching.js";
export * from "./payments-logic.js";
