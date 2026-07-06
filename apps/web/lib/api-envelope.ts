import { randomUUID } from "node:crypto";

/** JSON envelope per docs/web-app/README §7. */
export function ok(data: unknown, init?: ResponseInit): Response {
  return Response.json({ data, error: null, meta: { requestId: `req_${randomUUID()}` } }, init);
}

export function err(code: string, message: string, statusCode: number): Response {
  return Response.json(
    {
      data: null,
      error: { code, message, statusCode },
      meta: { requestId: `req_${randomUUID()}` },
    },
    { status: statusCode },
  );
}
