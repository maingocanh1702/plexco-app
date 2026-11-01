import { PgSslConfigError, pgSslConnectionConfig } from "./pg-ssl-options.js";

// The web and discovery boot check (docs/sessions/web-mvp-phase5-readiness-p5-db-tls-ca-required.md
// 2.4). The Next app reads its DB URLs lazily, on the first request, so infra/entrypoint.sh runs this
// before `exec`: a refusal then stops the role at start, as worker, provision and migrate already do.
// It applies the SAME helper to each DB URL name the app reads and holds no copy of the rule. It prints
// the refusal's own message (the variable and a reason) or a fixed text: never a URL, a host or the error.
const URL_NAMES = ["DATABASE_URL", "DISCOVERY_DATABASE_URL"];

function bootCheck(): number {
  try {
    for (const name of URL_NAMES) {
      const url = process.env[name];
      // Unset or empty: today's lazy "is not set" error at first use stays the answer.
      if (url) pgSslConnectionConfig(url);
    }
    return 0;
  } catch (error) {
    console.error(
      error instanceof PgSslConfigError
        ? `[pg-ssl-boot-check] ${error.message}`
        : "[pg-ssl-boot-check] the database TLS check failed",
    );
    return 1;
  }
}

// Nothing runs at import: the CLI guard of migrate.ts.
const invokedDirectly =
  process.argv[1]?.endsWith("pg-ssl-boot-check.ts") ||
  process.argv[1]?.endsWith("pg-ssl-boot-check.js");
if (invokedDirectly) process.exit(bootCheck());
