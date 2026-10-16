/**
 * Zalo Bot API client (bot-token platform, NOT the OA API), shared by the web and the worker's zalo_dm
 * projector as `@plexco/db/zalo-bot-api` (moved from apps/web/lib/zalo/client.ts, which re-exports it).
 * The decrypted bot token only exists in a process that calls Zalo (DD-122 O4). Endpoint shape
 * `https://bot-api.zaloplatforms.com/bot<TOKEN>/<method>` is taken from
 * docs/research/player-side-saas-reconciliation.md section 4 (verified there against bot.zapps.me/docs);
 * override with env ZALO_BOT_API_BASE, which must be an origin only: https, or http for a loopback host
 * (tests), never userinfo, a path, a query or a fragment (SSRF pin; `invalid_base` before any fetch).
 *
 * Response envelope `{ ok, result, description, error_code }` (DD-126, read the way the payment bot's
 * src/zalo/zalo.ts callApi reads it): success only on `ok: true`; `ok: false` is `rejected` (with the
 * numeric envelope error_code when present); a 2xx body without a boolean `ok` has no readable verdict
 * (`bad_response`, never success); any non-2xx is `rejected` with its HTTP status and the body unread.
 * AWAIT-verify: the bot token charset and the HTTP status / error_code values Zalo returns live.
 *
 * The token is part of the URL, so errors NEVER carry the URL, the description or the response body:
 * callers only see a stable `kind` plus two numbers. Every call has a timeout (5 s default, covering the
 * body) and a 64 KiB response cap.
 */
import { readBoundedBody } from "./read-bounded-body.js";

const DEFAULT_BASE = "https://bot-api.zaloplatforms.com";
const TIMEOUT_MS = 5_000;
const MAX_RESPONSE_BYTES = 64 * 1024;
const TOKEN_RE = /^[A-Za-z0-9:_-]{10,200}$/;
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export type ZaloApiErrorKind =
  "invalid_token" | "invalid_base" | "timeout" | "network" | "rejected" | "bad_response";

export class ZaloApiError extends Error {
  constructor(
    readonly kind: ZaloApiErrorKind,
    /** HTTP status of a non-2xx reply, else null. */
    readonly httpStatus: number | null = null,
    /** Numeric envelope error_code of a 2xx `ok: false`, else null. */
    readonly providerErrorCode: number | null = null,
  ) {
    super(`zalo api: ${kind}`);
    this.name = "ZaloApiError";
  }
}

/** The pinned API origin (Z-5): throws ZaloApiError("invalid_base") for anything but an origin-only URL. */
export function zaloBotApiBase(raw: string | undefined = process.env.ZALO_BOT_API_BASE): string {
  let url: URL;
  try {
    url = new URL(raw?.trim() || DEFAULT_BASE);
  } catch {
    throw new ZaloApiError("invalid_base");
  }
  const schemeOk =
    url.protocol === "https:" || (url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname));
  if (!schemeOk || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new ZaloApiError("invalid_base");
  }
  return url.origin;
}

async function call(
  botToken: string,
  method: string,
  body: Record<string, unknown>,
  timeoutMs = TIMEOUT_MS,
): Promise<unknown> {
  if (!TOKEN_RE.test(botToken)) throw new ZaloApiError("invalid_token");
  const base = zaloBotApiBase();
  let res: Response;
  try {
    res = await fetch(`${base}/bot${botToken}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "error",
    });
  } catch (e) {
    throw new ZaloApiError(
      (e as { name?: string }).name === "TimeoutError" ? "timeout" : "network",
    );
  }
  if (!res.ok) {
    await res.body?.cancel().catch(() => undefined);
    throw new ZaloApiError("rejected", res.status);
  }
  let read: Awaited<ReturnType<typeof readBoundedBody>>;
  try {
    read = await readBoundedBody(res, MAX_RESPONSE_BYTES);
  } catch {
    // Reset, stall or abort mid-body AFTER a 2xx (the timeout signal covers the body): Zalo may already
    // have accepted a send, so it is bad_response, never resent (Z-6); getMe/setWebhook stay retryable.
    throw new ZaloApiError(method === "sendMessage" ? "bad_response" : "timeout");
  }
  if (!read.ok) throw new ZaloApiError("bad_response");
  let json: unknown;
  try {
    json = JSON.parse(read.text);
  } catch {
    throw new ZaloApiError("bad_response");
  }
  const envelope =
    json !== null && typeof json === "object" ? (json as Record<string, unknown>) : null;
  const verdict = envelope?.ok;
  if (verdict === true) return json;
  if (verdict !== false) throw new ZaloApiError("bad_response");
  const code = envelope?.error_code;
  throw new ZaloApiError("rejected", null, Number.isInteger(code) ? (code as number) : null);
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

export async function sendMessage(
  botToken: string,
  chatId: string,
  text: string,
  opts: { timeoutMs?: number } = {},
): Promise<void> {
  await call(botToken, "sendMessage", { chat_id: chatId, text }, opts.timeoutMs);
}

/** What a failed send means for an outbox delivery (Z-6; the numbers are defaults pending live verification). */
export type ZaloSendVerdict =
  | {
      action: "retry";
      code: "zalo_timeout" | "zalo_network" | "zalo_server_error" | "zalo_rate_limited";
    }
  | { action: "dlq"; code: "zalo_unauthorized" | "bot_unavailable" | "config_missing" }
  | { action: "recipient_terminal"; code: "zalo_rejected" | "zalo_bad_response" };

function byStatus(status: number): ZaloSendVerdict {
  if (status === 401) return { action: "dlq", code: "zalo_unauthorized" };
  if (status === 429) return { action: "retry", code: "zalo_rate_limited" };
  if (status >= 500) return { action: "retry", code: "zalo_server_error" };
  return { action: "recipient_terminal", code: "zalo_rejected" };
}

export function classifyZaloError(error: unknown): ZaloSendVerdict {
  if (!(error instanceof ZaloApiError)) return { action: "retry", code: "zalo_network" };
  switch (error.kind) {
    case "timeout":
      return { action: "retry", code: "zalo_timeout" };
    case "network":
      return { action: "retry", code: "zalo_network" };
    case "invalid_token":
      return { action: "dlq", code: "bot_unavailable" };
    case "invalid_base":
      return { action: "dlq", code: "config_missing" };
    case "bad_response":
      return { action: "recipient_terminal", code: "zalo_bad_response" };
    case "rejected": {
      const status = error.httpStatus ?? error.providerErrorCode;
      return status === null
        ? { action: "recipient_terminal", code: "zalo_rejected" }
        : byStatus(status);
    }
  }
}
