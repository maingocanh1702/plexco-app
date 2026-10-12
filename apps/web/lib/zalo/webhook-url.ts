/** Public webhook URL registered with Zalo. The token is an opaque lookup, not a secret (onboarding section 3). */
export function zaloWebhookUrl(baseUrl: string, webhookToken: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/api/webhooks/zalo/${webhookToken}`;
}
