import { rootCertificates } from "node:tls";
import { PgSslConfigError, pgSslConnectionConfig } from "@plexco/db/pg-ssl-options";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createQueue, QUEUE_SCHEMA, queueOptions } from "./queue.js";

// A marker password; the assertions compare whole objects and never print the URL.
const DB_URL = "postgres://app_worker:queue-marker-6d1f@db.internal:25060/plexco";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("queueOptions: DATABASE_CA_CERT", () => {
  it("R1: unset keeps today's options, with no ssl key", () => {
    vi.stubEnv("DATABASE_CA_CERT", undefined);
    expect(queueOptions(DB_URL)).toStrictEqual({
      connectionString: DB_URL,
      schema: QUEUE_SCHEMA,
      migrate: false,
    });
  });

  it("R2: set hands pg-boss the helper's verifying ssl options", () => {
    // A bundled root certificate stands in for the cluster's CA: no openssl, no certificate text here.
    const ca = rootCertificates[0];
    vi.stubEnv("DATABASE_CA_CERT", ca);
    const options = queueOptions(DB_URL);
    // Checked first, so an empty root store cannot pass the equality below vacuously.
    expect(options).toMatchObject({ ssl: { rejectUnauthorized: true } });
    expect(options).toStrictEqual({
      ...pgSslConnectionConfig(DB_URL, { DATABASE_CA_CERT: ca }),
      schema: QUEUE_SCHEMA,
      migrate: false,
    });
  });

  it("R4: an invalid CA refuses before pg-boss is built", () => {
    vi.stubEnv("DATABASE_CA_CERT", "not a certificate");
    expect(() => createQueue(DB_URL)).toThrow(PgSslConfigError);
  });
});
