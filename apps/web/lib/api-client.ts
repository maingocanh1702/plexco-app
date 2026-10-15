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
   * The envelope's optional structured payload (docs/channels/web/README.md §7), kept verbatim.
   * Typed as the contract says, but it crossed the network: a reader must still validate it
   * (see openBalancePlayersOf) and render the generic message when it is absent or malformed.
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

export interface ApiFetchInit extends Omit<RequestInit, "body" | "credentials" | "cache"> {
  /** Serialized as JSON. */
  json?: unknown;
  /** CSRF secret from GET /api/auth/session; attached as x-csrf-token on non-GET requests. */
  csrfToken?: string | null;
}

function isPlainObject(value: unknown): value is ApiErrorDetails {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function apiFetch<T>(path: string, init: ApiFetchInit = {}): Promise<T> {
  const { json, csrfToken, headers: extra, method = "GET", ...rest } = init;
  const headers = new Headers(extra);
  headers.set("accept", "application/json");
  if (json !== undefined) headers.set("content-type", "application/json");
  if (method.toUpperCase() !== "GET" && csrfToken) headers.set("x-csrf-token", csrfToken);

  let response: Response;
  try {
    response = await fetch(path, {
      ...rest,
      method,
      headers,
      body: json === undefined ? undefined : JSON.stringify(json),
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch {
    throw new ApiClientError(CLIENT_NETWORK_ERROR, "Network request failed", 0);
  }

  // A body that is not JSON (proxy error page, empty 502) is "no envelope", not a thrown parse error.
  const envelope = await response.json().then(
    (value: unknown) => value as ApiEnvelope<T>,
    () => null,
  );
  const requestId = envelope?.meta?.requestId ?? null;
  if (envelope?.error) {
    throw new ApiClientError(
      envelope.error.code,
      envelope.error.message,
      envelope.error.statusCode ?? response.status,
      requestId,
      // only a JSON object is kept; null / a string / an array never become `details`
      isPlainObject(envelope.error.details) ? envelope.error.details : undefined,
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
