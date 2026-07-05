/**
 * @plexco/core — pure, transport/DB-agnostic domain logic.
 *
 * This barrel is BROWSER-SAFE: everything here runs in any bundle. The i18n
 * module uses node:async_hooks (per-request AsyncLocalStorage), so it lives
 * behind the server-only subpath `@plexco/core/i18n` — never re-export it
 * here, or client imports of e.g. fmtMoney would drag a Node builtin into
 * the browser bundle.
 *
 * The transfer matcher / payment classifiers / date parsing lifted from the
 * production bot are review-parked on feat/core-lift-v3 (founder decision —
 * see .autopilot/state/core-lift-v3/HALT-ROUND_BUDGET.txt); they join this
 * barrel when that lands. Core PROPOSES; it never writes to a DB.
 */
export const CORE_PACKAGE = "@plexco/core";

export * from "./format.js";
export * from "./vietqr.js";
export * from "./sports.js";
