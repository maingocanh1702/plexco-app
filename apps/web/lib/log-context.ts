import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

/**
 * Per-request log correlation (launch readiness M5): every line written by `log` inside a
 * `runWithLogContext` scope carries `request_id` and, once the caller has been authorised for a
 * tenant, `tenant_id`. Both are opaque identifiers; neither is PII, and neither is ever taken from
 * a request body.
 *
 * Request id source: the platform edge id (DigitalOcean's `do-request-id`, which the edge sets and a
 * client cannot spoof, preferred over the client-controllable `x-request-id`) when
 * it has a safe shape, otherwise a fresh UUID. A client-supplied header is attacker-controlled, so
 * it is only adopted when it is short and made of id-safe characters — never echoed raw.
 */
export interface LogContext {
  requestId: string;
  tenantId?: string;
}

const store = new AsyncLocalStorage<LogContext>();

/** Id-safe: 8-64 chars of [A-Za-z0-9._-]. Anything else is replaced, not sanitised. */
const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{8,64}$/;

export const REQUEST_ID_HEADER = "x-request-id";

export function requestIdFrom(headers: Headers): string {
  for (const name of ["do-request-id", REQUEST_ID_HEADER]) {
    const value = headers.get(name)?.trim();
    if (value && SAFE_REQUEST_ID.test(value)) return value;
  }
  return randomUUID();
}

export function runWithLogContext<T>(context: LogContext, fn: () => T): T {
  return store.run({ ...context }, fn);
}

export function currentLogContext(): LogContext | undefined {
  return store.getStore();
}

/** Call once the tenant is authorised for this request; no-op outside a log context. */
export function setLogTenant(tenantId: string): void {
  const ctx = store.getStore();
  if (ctx) ctx.tenantId = tenantId;
}

/** Echo the id so a user report can be matched to a log line. Tolerates an immutable Response. */
export function withRequestIdHeader(response: Response, requestId: string): Response {
  try {
    response.headers.set(REQUEST_ID_HEADER, requestId);
  } catch {
    // Immutable headers (a proxied fetch Response): the log line still carries the id.
  }
  return response;
}
