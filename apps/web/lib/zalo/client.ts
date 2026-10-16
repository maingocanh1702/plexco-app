/**
 * Zalo Bot API client: moved to `@plexco/db/zalo-bot-api` (packages/db/src/zalo-bot-api.ts) so the web and
 * the worker's zalo_dm projector share one client (bot-token URL, 5 s timeout, 64 KiB cap, redirect
 * refused, origin-only ZALO_BOT_API_BASE pin, envelope verdicts). Re-exported unchanged for web importers.
 */
export {
  getMe,
  sendMessage,
  setWebhook,
  ZaloApiError,
  type ZaloApiErrorKind,
} from "@plexco/db/zalo-bot-api";
