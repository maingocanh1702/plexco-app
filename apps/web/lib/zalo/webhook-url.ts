import type { ZaloOnboardingState } from "@plexco/db";

/** Public webhook URL registered with Zalo. The token is an opaque lookup, not a secret (onboarding section 3). */
export function zaloWebhookUrl(baseUrl: string, webhookToken: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/api/webhooks/zalo/${webhookToken}`;
}

/** The ONE response shape for POST connect and GET state. Carries `webhook_token` (a non-secret lookup by design), never the bot token or webhook secret. */
export function zaloStateView(baseUrl: string | undefined, s: ZaloOnboardingState) {
  return {
    status: s.status,
    verifiedAt: s.verifiedAt,
    lastSetwebhookAt: s.lastSetwebhookAt,
    webhookUrl: s.webhookToken && baseUrl ? zaloWebhookUrl(baseUrl, s.webhookToken) : null,
  };
}
