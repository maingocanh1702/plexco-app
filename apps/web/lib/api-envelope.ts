import { randomUUID } from "node:crypto";

import type { ApiEnvelope, ApiErrorCode } from "@plexco/core";

/** JSON envelope per docs/channels/web/README.md §7. Types from @plexco/core (shared FE/BE/bot). */
export function ok(data: unknown, init?: ResponseInit): Response {
  return Response.json(
    {
      data,
      error: null,
      meta: { requestId: `req_${randomUUID()}` },
    } satisfies ApiEnvelope<unknown>,
    init,
  );
}

export function err(code: ApiErrorCode, message: string, statusCode: number): Response {
  return Response.json(
    {
      data: null,
      error: { code, message, statusCode },
      meta: { requestId: `req_${randomUUID()}` },
    } satisfies ApiEnvelope<never>,
    { status: statusCode },
  );
}
