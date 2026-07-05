/**
 * @plexco/core — pure, transport/DB-agnostic domain logic.
 *
 * Lifted from the production single-club bot (battle-tested: ~85% auto-match,
 * 0 false positives). Core PROPOSES (candidates/plans/decisions); it never
 * writes to a DB or talks to a transport.
 *
 * This barrel is BROWSER-SAFE: everything here runs in any bundle. The i18n
 * module uses node:async_hooks (per-request AsyncLocalStorage), so it lives
 * behind the server-only subpath `@plexco/core/i18n` — never re-export it
 * here, or client imports of e.g. fmtMoney would drag a Node builtin into
 * the browser bundle.
 */
export const CORE_PACKAGE = "@plexco/core";

export * from "./time.js";
export * from "./dates.js";
export * from "./format.js";
export * from "./vietqr.js";
export * from "./sports.js";
export * from "./matching.js";
export * from "./payments-logic.js";
