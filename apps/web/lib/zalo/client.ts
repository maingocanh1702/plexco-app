/**
 * Zalo Bot API client (bot-token platform, NOT the OA API). Runs only in the web process (DD-122 O4):
 * the decrypted bot token never leaves it. Endpoint shape `https://bot-api.zaloplatforms.com/bot<TOKEN>/<method>`
 * is taken from docs/research/player-side-saas-reconciliation.md section 4 (verified there against
 * bot.zapps.me/docs); override with env ZALO_BOT_API_BASE.
 *
 * Response envelope `{ ok, result, description, error_code }` (DD-126, read the way the payment bot's
 * src/zalo/zalo.ts callApi reads it): success only on `ok: true`; `ok: false` is `rejected`; a 2xx
 * body without a boolean `ok` has no readable verdict (`bad_response`, never success); any non-2xx is
 * `rejected`. AWAIT-verify: the bot token charset and the HTTP status Zalo returns for a bad token.
 *
 * The token is part of the URL, so errors NEVER carry the URL or the response body: callers only see a
 * stable `kind`. Every call has a 5 s timeout and a 64 KiB response cap.
 */
import { readBoundedBody } from "../read-bounded-body";

const DEFAULT_BASE = "https://bot-api.zaloplatforms.com";
const TIMEOUT_MS = 5_000;
const MAX_RESPONSE_BYTES = 64 * 1024;
const TOKEN_RE = /^[A-Za-z0-9:_-]{10,200}$/;

export type ZaloApiErrorKind =
  "invalid_token" | "timeout" | "network" | "rejected" | "bad_response";

export class ZaloApiError extends Error {
  constructor(readonly kind: ZaloApiErrorKind) {
    super(`zalo api: ${kind}`);
    this.name = "ZaloApiError";
  }
}

const baseUrl = () => (process.env.ZALO_BOT_API_BASE?.trim() || DEFAULT_BASE).replace(/\/+$/, "");

async function call(
  botToken: string,
  method: string,
  body: Record<string, unknown>,
): Promise<unknown> {
  if (!TOKEN_RE.test(botToken)) throw new ZaloApiError("invalid_token");
  let res: Response;
  try {
    res = await fetch(`${baseUrl()}/bot${botToken}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: "error",
    });
  } catch (e) {
    throw new ZaloApiError(
      (e as { name?: string }).name === "TimeoutError" ? "timeout" : "network",
    );
  }
  if (!res.ok) {
    await res.body?.cancel().catch(() => undefined);
    throw new ZaloApiError("rejected");
  }
  let read: Awaited<ReturnType<typeof readBoundedBody>>;
  try {
    read = await readBoundedBody(res, MAX_RESPONSE_BYTES);
  } catch {
    throw new ZaloApiError("timeout"); // abort mid-body (the request timeout signal covers the body)
  }
  if (!read.ok) throw new ZaloApiError("bad_response");
  let json: unknown;
  try {
    json = JSON.parse(read.text);
  } catch {
    throw new ZaloApiError("bad_response");
  }
  const verdict = json !== null && typeof json === "object" ? (json as { ok?: unknown }).ok : null;
  if (verdict === true) return json;
  throw new ZaloApiError(verdict === false ? "rejected" : "bad_response");
}

/** Validates the bot token. Resolves on success, throws ZaloApiError otherwise. */
export async function getMe(botToken: string): Promise<void> {
  await call(botToken, "getMe", {});
}

/** secret_token must be 8-256 chars (webhook-verification-matrix Zalo Bot row). */
export async function setWebhook(
  botToken: string,
  url: string,
  secretToken: string,
): Promise<void> {
  if (secretToken.length < 8 || secretToken.length > 256) throw new ZaloApiError("rejected");
  await call(botToken, "setWebhook", { url, secret_token: secretToken });
}

export async function sendMessage(botToken: string, chatId: string, text: string): Promise<void> {
  await call(botToken, "sendMessage", { chat_id: chatId, text });
}
