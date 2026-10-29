/**
 * Minimal structured logger for apps/web (audit 2026-09-06 W-11 / NFR-O2).
 *
 * Before this the whole app had ONE runtime console.* call and the OAuth callback/complete
 * routes swallowed every failure in `catch {}` — a KMS/JWKS outage was indistinguishable from a
 * bad request in production. This gives every catch site a way to say WHAT class of thing
 * failed without ever saying WHICH request: values are redacted by key name, errors are reduced
 * to name + message (stack only at debug), and nothing here accepts a Request object.
 *
 * LOG_LEVEL (.env.example): error | warn | info | debug. Unset → info. An unrecognised value is
 * treated as info, not as "log everything" — fail closed on verbosity.
 *
 * Deliberately NOT a Sentry/OpenTelemetry client: the registry is unreachable from the session
 * that wrote this and a transport belongs to `observability-sentry-loglevel-readers` (backlog).
 * One JSON object per line on stderr/stdout so any collector can ingest it as-is.
 */
const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 } as const;
export type LogLevel = keyof typeof LEVELS;

/** Keys whose VALUES are never written, whatever they contain (case-insensitive substring); gender = DD-39 PII. */
const REDACT_KEY =
  /token|secret|cookie|handoff|password|authorization|verifier|nonce|code|state|key|hash|gender/i;

export function parseLogLevel(raw: string | undefined): LogLevel {
  const v = raw?.trim().toLowerCase();
  return v && Object.hasOwn(LEVELS, v) ? (v as LogLevel) : "info";
}

function currentLevel(): LogLevel {
  return parseLogLevel(process.env.LOG_LEVEL);
}

/** Free-text bounds for anything an external error can put in a log line. */
export const ERROR_TEXT_MAX = 256;
export const STACK_MAX = 2048;

/**
 * Truncate to `max` characters, marking that it happened so nobody reads a cut string as whole.
 * Takes `unknown` on purpose: an Error's `name`/`message`/`stack` are typed as strings but are
 * plain writable properties, and a logger that throws while formatting a log line turns a handled
 * error into an unhandled one. Non-strings are described by type, never coerced (String(Symbol())
 * throws; an object may be huge or carry secrets).
 */
export function bound(text: unknown, max: number): string {
  let s: string;
  if (typeof text === "string") {
    s = text;
  } else if (typeof text === "number" || typeof text === "boolean" || typeof text === "bigint") {
    s = String(text);
  } else if (text === null || text === undefined) {
    s = `[${text === null ? "null" : "undefined"}]`;
  } else {
    s = `[${Array.isArray(text) ? "array" : typeof text}]`;
  }
  return s.length <= max ? s : `${s.slice(0, max)}…[+${s.length - max}]`;
}

/** Every errorClass() result: the one object sanitizeFields writes as-is. */
const errorClasses = new WeakSet<object>();

/**
 * An error by CLASS only (L68 D7): its name and one string `code`, never its message, stack or
 * cause, which can carry a token, a token-bearing URL or a query's params. A swallowed or unhandled
 * error logs `{ error: errorClass(error) }`. `name` is cut to 64 (`typeof` for a non-Error; a
 * non-string name is described, never thrown on); `code` is the first string `code` on the cause
 * chain shaped like a SQLSTATE or a provider constant, within 8 hops, omitted when there is none.
 */
export function errorClass(error: unknown): { readonly name: string; readonly code?: string } {
  let code = "";
  for (let c = error, i = 0; !code && c && typeof c === "object" && i < 8; i++) {
    const v = (c as { code?: unknown }).code;
    if (typeof v === "string" && /^[0-9A-Z_]{1,32}$/.test(v)) code = v;
    c = (c as { cause?: unknown }).cause;
  }
  const raw: unknown = error instanceof Error ? error.name : typeof error;
  const name = typeof raw === "string" ? raw.slice(0, 64) : bound(raw, 64);
  const cls = Object.freeze(code ? { name, code } : { name });
  errorClasses.add(cls);
  return cls;
}

export function sanitizeFields(
  fields: Record<string, unknown>,
  level: LogLevel,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (REDACT_KEY.test(key)) {
      out[key] = "[redacted]";
    } else if (value instanceof Error) {
      // An Error reaching this logger is often an EXTERNAL one — a provider SDK, a fetch, a driver
      // — whose message and `code` are attacker- or third-party-influenced and can carry an
      // authorization code, a token-bearing URL, a whole response body, or megabytes of padding.
      // Key-name redaction above cannot see any of that: the secret is in the VALUE. Bound every
      // free-text field so a log line stays a log line; whoever needs the untruncated text reads
      // it from the provider, not from our retained logs.
      out[key] = {
        name: bound(value.name, 64),
        message: bound(value.message, ERROR_TEXT_MAX),
        ...("code" in value && typeof (value as { code?: unknown }).code === "string"
          ? { code: bound((value as { code: string }).code, 64) }
          : {}),
        ...(level === "debug" && value.stack ? { stack: bound(value.stack, STACK_MAX) } : {}),
      };
    } else if (value !== null && typeof value === "object" && errorClasses.has(value)) {
      out[key] = value; // frozen { name, code? }, both strings already bounded by errorClass
    } else if (value !== null && typeof value === "object") {
      // Never serialise arbitrary objects (a Request, a DB row) — say their shape only.
      out[key] = Array.isArray(value) ? `[array:${value.length}]` : "[object]";
    } else {
      out[key] = value;
    }
  }
  return out;
}

/**
 * Request correlation, installed once by lib/log-context.ts. A setter rather than an import keeps
 * this file import-free: the dev Edge middleware bundles it through lib/dev-login/routing.ts.
 */
let readContext: (() => { requestId: string; tenantId?: string } | undefined) | undefined;

export function setLogContextReader(reader: typeof readContext): void {
  readContext = reader;
}

function emit(level: LogLevel, event: string, fields: Record<string, unknown> = {}): void {
  if (LEVELS[level] > LEVELS[currentLevel()]) return;
  const ctx = readContext?.();
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    event,
    ...sanitizeFields(fields, currentLevel()),
    // The context is these two keys' only source: written after the caller's fields, always, and
    // JSON.stringify drops an undefined value, so a caller field of either name never survives.
    request_id: ctx?.requestId,
    tenant_id: ctx?.tenantId,
  });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const log = {
  error: (event: string, fields?: Record<string, unknown>) => emit("error", event, fields),
  warn: (event: string, fields?: Record<string, unknown>) => emit("warn", event, fields),
  info: (event: string, fields?: Record<string, unknown>) => emit("info", event, fields),
  debug: (event: string, fields?: Record<string, unknown>) => emit("debug", event, fields),
};
