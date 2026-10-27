import type { ApiEnvelope, ApiErrorDetails } from "@plexco/core";

/**
 * Browser-side API client (FE-INV-6). Every route answers the envelope `{data, error, meta}`;
 * this parses it once so screens never read raw fetch errors. A non-envelope response (proxy
 * error page, offline, aborted) becomes an ApiClientError with a synthetic code so callers have
 * one error shape to map.
 */
export class ApiClientError extends Error {
  readonly code: string;
  readonly statusCode: number;
  readonly requestId: string | null;
  /**
   * The envelope's optional structured payload (docs/channels/web/README.md §7), kept verbatim but
   * ONLY for the one code that carries it today, CLOSE_BLOCKED_OPEN_DEBT (the BE emits `details`
   * nowhere else); on any other code it is dropped. Typed as the contract says, but it crossed the
   * network: a reader must still validate it (see openBalancePlayersOf) and render the generic
   * message when it is absent or malformed.
   */
  readonly details: ApiErrorDetails | undefined;
  constructor(
    code: string,
    message: string,
    statusCode: number,
    requestId: string | null = null,
    details?: ApiErrorDetails,
  ) {
    super(message);
    this.name = "ApiClientError";
    this.code = code;
    this.statusCode = statusCode;
    this.requestId = requestId;
    this.details = details;
  }
}

/** Synthetic codes the client itself raises (never sent by the server). */
export const CLIENT_NETWORK_ERROR = "CLIENT_NETWORK_ERROR";
export const CLIENT_BAD_RESPONSE = "CLIENT_BAD_RESPONSE";
// Not CLIENT_NETWORK_ERROR: that reads as offline, and a slow server may still apply the call.
export const CLIENT_TIMEOUT = "CLIENT_TIMEOUT";

/**
 * apiFetch's deadline, set only when the caller passes no `signal` (that caller owns its own) and
 * the request is a GET/HEAD read or sends a JSON body with a string `commandId`.
 */
export const API_TIMEOUT_MS = 15_000;

export interface ApiFetchInit extends Omit<RequestInit, "body" | "credentials" | "cache"> {
  /** Serialized as JSON. */
  json?: unknown;
  /** CSRF secret from GET /api/auth/session; attached as x-csrf-token on non-GET requests. */
  csrfToken?: string | null;
}

/** The only error code whose envelope `details` the client keeps (the BE emits it nowhere else). */
const DETAILS_CODE = "CLOSE_BLOCKED_OPEN_DEBT";

function isPlainObject(value: unknown): value is ApiErrorDetails {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function apiFetch<T>(path: string, init: ApiFetchInit = {}): Promise<T> {
  const { json, csrfToken, headers: extra, method = "GET", ...rest } = init;
  const verb = method.toUpperCase();
  const headers = new Headers(extra);
  headers.set("accept", "application/json");
  if (json !== undefined) headers.set("content-type", "application/json");
  if (verb !== "GET" && csrfToken) headers.set("x-csrf-token", csrfToken);

  // A read or a commandId command is safe to retry under the same id, so its timeout is uncertain.
  // A mutation without a commandId gets no client deadline: a timeout would read as a definite
  // failure while the server may still commit, and an edited retry would apply twice.
  const deadline =
    !rest.signal &&
    (verb === "GET" ||
      verb === "HEAD" ||
      (typeof json === "object" &&
        json !== null &&
        typeof (json as { commandId?: unknown }).commandId === "string"));
  const controller = deadline ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), API_TIMEOUT_MS) : undefined;
  let response: Response;
  let envelope: ApiEnvelope<T> | null;
  try {
    response = await fetch(path, {
      ...rest,
      signal: rest.signal ?? controller?.signal,
      method,
      headers,
      body: json === undefined ? undefined : JSON.stringify(json),
      credentials: "same-origin",
      cache: "no-store",
    });
    // A body that is not JSON (proxy error page, empty 502) is "no envelope", not a thrown parse error.
    envelope = await response.json().then(
      (value: unknown) => value as ApiEnvelope<T>,
      (error: unknown) => {
        if (controller?.signal.aborted) throw error;
        return null;
      },
    );
  } catch {
    // By our own controller, never the error name: a caller's abort stays CLIENT_NETWORK_ERROR.
    if (controller?.signal.aborted)
      throw new ApiClientError(CLIENT_TIMEOUT, "Request timed out", 0);
    throw new ApiClientError(CLIENT_NETWORK_ERROR, "Network request failed", 0);
  } finally {
    clearTimeout(timer);
  }
  const requestId = envelope?.meta?.requestId ?? null;
  if (envelope?.error) {
    throw new ApiClientError(
      envelope.error.code,
      envelope.error.message,
      envelope.error.statusCode ?? response.status,
      requestId,
      // kept only for the code that carries it, and only as a JSON object: null / a string / an
      // array, or an object on any other code, never become `details`
      envelope.error.code === DETAILS_CODE && isPlainObject(envelope.error.details)
        ? envelope.error.details
        : undefined,
    );
  }
  if (!response.ok || !envelope || envelope.data === undefined) {
    throw new ApiClientError(
      CLIENT_BAD_RESPONSE,
      "Unexpected response",
      response.status,
      requestId,
    );
  }
  return envelope.data as T;
}
