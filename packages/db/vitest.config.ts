import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Test FILES may run in parallel workers. The two hazards that once forced
    // serial execution are both closed:
    // (1) each DB test file's setupRlsTestContext() DROPs/CREATEs its OWN
    //     throwaway database (auth.test.ts / rls-invariants.test.ts /
    //     waitlist-invariants.test.ts / migrate.test.ts each pass a distinct
    //     dbName — see test-harness.ts), so no two files touch one database; and
    // (2) the cluster-global runtime roles are now created race-safely by the
    //     migration runner (packages/db/src/migrate.ts ensureRoleExists), which
    //     CREATE ROLEs and swallows the "already exists" collision — so two
    //     files' migrate() calls racing on one cluster no longer abort. (0000's
    //     own check-then-act role block, which caused the race, is skipped once
    //     the runner has ensured the roles.) Proven: migrate.test.ts BR-1 plus
    //     ≥5 consecutive green full-suite runs under fileParallelism:true.
    fileParallelism: true,
    // Tests WITHIN a file still run sequentially: the RLS suites share one ctx
    // and assert on ordered inserts, so intra-file concurrency stays off.
    sequence: { concurrent: false },
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
