import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

import { setLogContextReader } from "./log";

/**
 * Per-request log correlation: every `log` line written inside `withRequestLogContext` carries
 * `request_id` and, once the route has authorised the caller for a tenant (`setLogTenant`),
 * `tenant_id`. Both are opaque identifiers; neither is PII, and neither is ever read from a body.
 *
 * Request id source: no edge in front of the app sets one today (adopting an edge header later is
 * a backlog item), so the id is the inbound `x-request-id` when it has an id-safe shape, otherwise
 * a fresh one. That header is client-controlled, so it is adopted only when short and made of
 * id-safe characters, never echoed raw.
 */
interface LogContext {
  requestId: string;
  tenantId?: string;
}

const store = new AsyncLocalStorage<LogContext>();
setLogContextReader(() => store.getStore());

/** Id-safe: 8-64 chars of [A-Za-z0-9._-]. Anything else is replaced, not sanitised. */
const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{8,64}$/;
const REQUEST_ID_HEADER = "x-request-id";

export function newRequestId(): string {
  return `req_${randomUUID()}`;
}

/** The current request's id; undefined outside `withRequestLogContext`. */
export function currentRequestId(): string | undefined {
  return store.getStore()?.requestId;
}

/** Call once the tenant is authorised for this request; a no-op outside a log context. */
export function setLogTenant(id: string): void {
  const ctx = store.getStore();
  if (ctx) ctx.tenantId = id;
}

/**
 * Runs one route handler in its own log context and echoes the id as `x-request-id` on whatever
 * Response it returns, any status, so a user report can be matched to a log line. A throw from
 * `run` propagates unchanged.
 */
export async function withRequestLogContext(
  request: Request,
  run: () => Promise<Response>,
): Promise<Response> {
  const inbound = request.headers.get(REQUEST_ID_HEADER)?.trim();
  const requestId = inbound && SAFE_REQUEST_ID.test(inbound) ? inbound : newRequestId();
  const response = await store.run({ requestId }, run);
  // ponytail: set in place; an immutable Response (Response.redirect, a fetch() result) would throw
  // here. None exists in the wrapped routes; clone on TypeError when one appears.
  response.headers.set(REQUEST_ID_HEADER, requestId);
  return response;
}
