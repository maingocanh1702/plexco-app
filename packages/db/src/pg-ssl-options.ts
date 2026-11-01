import { X509Certificate } from "node:crypto";
import { isIPv4 } from "node:net";
import type { ConnectionConfig } from "pg";
// Extensionless: the "./lib/*" entry of both pg's and @types/pg's exports ("./lib/*.js" has no types).
import ConnectionParameters from "pg/lib/connection-parameters";
import { rootCertificates } from "node:tls";
/**
 * The ONE source of the pg TLS options: every Pool, Client and PgBoss config spreads this result
 * (docs/sessions/web-mvp-phase5-readiness-p5-db-tls-ca-options.md, decision table R1-R11).
 *
 * DATABASE_CA_CERT unset: the connection string unchanged and NO ssl key, so pg behaves as today.
 * Unset with NODE_ENV=production refuses unless the host pg will dial is loopback or a Unix socket
 * (docs/sessions/web-mvp-phase5-readiness-p5-db-tls-ca-required.md, rows A1-E4).
 * DATABASE_CA_CERT set: it must be PEM text of certificates only; the URL may not weaken TLS; every
 * ssl parameter is then removed from the URL (pg assigns the parsed URL over an explicit ssl object,
 * so a kept one would silently win); and ssl = { ca, rejectUnauthorized: true }. Node then verifies
 * the chain against these certificates only and the host name with its default check; the explicit
 * true also beats PGSSLMODE and NODE_TLS_REJECT_UNAUTHORIZED=0.
 * A refusal names the variable and a reason only: never the URL, a password, a host or the CA text.
 * One exception to PEM: DATABASE_CA_CERT exactly `system` (case-sensitive, untrimmed) gives ca =
 * Node's bundled root certificates (tls.rootCertificates), passed explicitly so NODE_EXTRA_CA_CERTS
 * and the OS store add nothing; the URL rules and rejectUnauthorized: true are the PEM path's.
 */

const VAR = "DATABASE_CA_CERT";
const REQUIRED =
  "is required when NODE_ENV is production and the database host is not loopback or a Unix socket";
const CERT_LABEL = "CERTIFICATE";
// Generic PEM armor: the label is captured and compared with CERT_LABEL, so no marker literal lives
// here. The body excludes "-", so one block can never swallow the next armor line.
const ARMOR = /-----BEGIN ([^\r\n-]*)-----([^-]*)-----END ([^\r\n-]*)-----/g;
// The values that keep TLS on with verification (R5, R6); any other value of these names refuses.
const ALLOWED = new Map<string, readonly string[]>([
  ["sslmode", ["require", "verify-ca", "verify-full"]],
  ["ssl", ["true", "1"]],
  ["uselibpqcompat", ["false"]],
]);

export class PgSslConfigError extends Error {
  constructor(reason: string) {
    super(`${VAR} ${reason}`);
    this.name = "PgSslConfigError";
  }
}

export function pgSslConnectionConfig(
  connectionString: string,
  env: NodeJS.ProcessEnv = process.env,
): { connectionString: string; ssl?: { ca: string[]; rejectUnauthorized: true } } {
  const value = env[VAR];
  if (value === undefined) {
    if (env.NODE_ENV === "production" && !loopbackOrSocket(connectionString)) {
      throw new PgSslConfigError(REQUIRED);
    }
    return { connectionString };
  }
  const ca = value === "system" ? [...rootCertificates] : certificateBlocks(value);
  return {
    connectionString: withoutSslParameters(connectionString),
    ssl: { ca, rejectUnauthorized: true },
  };
}

// The one host string pg dials, from pg's own ConnectionParameters as its Client builds it (the URL's
// host, a host= parameter winning, then PGHOST, then localhost), compared exactly: no lower-casing,
// no IPv4 shorthand. A string pg cannot parse, or any other throw, is remote (fail closed).
function loopbackOrSocket(connectionString: string): boolean {
  let host: unknown;
  try {
    // @types/pg leaves connectionString out of this constructor's type; pg reads it (as Client does).
    const config: ConnectionConfig = { connectionString };
    host = new ConnectionParameters(config).host;
  } catch {
    return false;
  }
  if (typeof host !== "string") return false;
  if (host.startsWith("/")) return true;
  return (
    host === "localhost" ||
    host === "::1" ||
    host === "[::1]" ||
    (isIPv4(host) && host.startsWith("127."))
  );
}

// Every block is parsed on its own: X509Certificate reads only the FIRST certificate of a bundle and
// ignores text after it, so one parse of the whole value would pass a bad second block.
function certificateBlocks(value: string): string[] {
  const blocks = [...value.matchAll(ARMOR)];
  if (blocks.length === 0 || value.replace(ARMOR, "").trim() !== "") {
    throw new PgSslConfigError("is set but is not PEM certificate text (certificate blocks only)");
  }
  return blocks.map(([block, label, , endLabel]) => {
    if (label !== CERT_LABEL || endLabel !== CERT_LABEL) {
      throw new PgSslConfigError("holds a PEM block that is not a certificate");
    }
    try {
      new X509Certificate(block);
    } catch {
      throw new PgSslConfigError("holds a certificate block that does not parse");
    }
    return block;
  });
}

// The query is the text after the first "?" before the first "#", as the WHATWG URL parser that pg
// uses reads it. That parser deletes every tab and line break first, so one could hide "sslmode"
// from a raw check: refused. Names match case-insensitively, values exactly (fail closed).
function withoutSslParameters(url: string): string {
  if (/[\t\n\r]/.test(url)) {
    throw new PgSslConfigError("is set, so the database URL may not contain a tab or a line break");
  }
  const hash = url.indexOf("#");
  const head = hash === -1 ? url : url.slice(0, hash);
  const q = head.indexOf("?");
  if (q === -1) return url;
  const segments = head.slice(q + 1).split("&");
  const kept = segments.filter((segment) => {
    // A segment holds no "&": at most one entry, decoded by the same form-urlencoded parser as pg's.
    const [[name, value] = ["", ""]] = new URLSearchParams(segment);
    const key = name.toLowerCase();
    const allowed = ALLOWED.get(key);
    if (allowed && !allowed.includes(value)) {
      throw new PgSslConfigError(
        `is set, so the database URL parameter ${key} must be ${allowed.join(" or ")}`,
      );
    }
    return !(key.startsWith("ssl") || key === "uselibpqcompat");
  });
  if (kept.length === segments.length) return url;
  return (
    head.slice(0, q) +
    (kept.length ? `?${kept.join("&")}` : "") +
    (hash === -1 ? "" : url.slice(hash))
  );
}
