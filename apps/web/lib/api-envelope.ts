import { randomUUID } from "node:crypto";

import type { ApiEnvelope, ApiErrorCode } from "@plexco/core";

/**
 * Every API envelope is `Cache-Control: no-store` (audit 2026-09-06 W-14): no route returns
 * cacheable data today and at least one (GET /api/auth/session) returns the CSRF secret, which a
 * shared cache or a back-button cache must never keep. Set here, once, so a new route cannot
 * forget it; a caller's own Cache-Control in `init.headers` still wins (explicit beats default).
 */
export const NO_STORE = "no-store";

function withNoStore(init?: ResponseInit): ResponseInit {
  const headers = new Headers(init?.headers);
  if (!headers.has("cache-control")) headers.set("cache-control", NO_STORE);
  return { ...init, headers };
}

/** JSON envelope per docs/channels/web/README.md §7. Types from @plexco/core (shared FE/BE/bot). */
export function ok(data: unknown, init?: ResponseInit): Response {
  return Response.json(
    {
      data,
      error: null,
      meta: { requestId: `req_${randomUUID()}` },
    } satisfies ApiEnvelope<unknown>,
    withNoStore(init),
  );
}

export function err(code: ApiErrorCode, message: string, statusCode: number): Response {
  return Response.json(
    {
      data: null,
      error: { code, message, statusCode },
      meta: { requestId: `req_${randomUUID()}` },
    } satisfies ApiEnvelope<never>,
    withNoStore({ status: statusCode }),
  );
}
