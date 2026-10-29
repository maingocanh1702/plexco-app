import { configDefaults, defineConfig } from "vitest/config";

// The one list of the isolated test files, in run order (the projects below
// are built from it).
export const isolatedTestFiles = [
  "src/migrate.test.ts",
  "src/rls-invariants.test.ts",
  "src/tenant-capability-authority.test.ts",
  "src/identity-link-web.test.ts",
  "src/identity-link-web-nobypass.test.ts",
  "src/me-player-reads-nobypass.test.ts",
  "src/public-alias-nobypass.test.ts",
  "src/discovery-rate-limit-definer-nobypass.test.ts",
];

export default defineConfig({
  test: {
    // Test FILES run in parallel workers against ONE Postgres cluster. Data is
    // per file: each DB test file's setupRlsTestContext() creates its OWN
    // throwaway database, and the migration runner creates the runtime roles
    // race-safely (migrate.ts ensureRoleExists; BR-1 in migrate.test.ts). Roles
    // and role memberships are NOT per file: they are cluster-global.
    //
    // Each file in isolatedTestFiles changes a shared role or membership for a
    // while (a hide by RENAME, a temporary GRANT to app_worker, a membership
    // hand-off to a non-superuser owner), which any other file checking that
    // role by name or privilege would observe. So the "parallel" project
    // (groupOrder 0) runs every other file first, then each isolated file runs
    // alone as project "isolated-<k>" (groupOrder k). Inside one `vitest run`
    // the groups run strictly in order (group k+1 starts once every file of
    // group k has finished), and a red group never skips a later one: every
    // file runs and the exit code covers all of them.
    //
    // CLI caveat: any --sequence.* flag resets groupOrder (the groups would
    // then overlap), so the package test script passes none. With one group
    // per isolated file, a CLI --fileParallelism cannot overlap them either.
    //
    // ponytail: the isolated files run one at a time, +26 s wall measured
    // (migrate.test.ts alone about 45 s). Upgrade path: split migrate.test.ts's
    // role-mutating describes into their own file so the rest of it rejoins
    // the parallel phase.
    fileParallelism: true,
    // Tests WITHIN a file still run sequentially: the RLS suites share one ctx
    // and assert on ordered inserts, so intra-file concurrency stays off.
    sequence: { concurrent: false },
    testTimeout: 30_000,
    hookTimeout: 120_000,
    projects: [
      {
        extends: true,
        test: {
          name: "parallel",
          include: ["src/**/*.test.ts"],
          exclude: [...configDefaults.exclude, ...isolatedTestFiles],
          sequence: { groupOrder: 0 },
        },
      },
      ...isolatedTestFiles.map((file, i) => ({
        extends: true as const,
        test: {
          name: `isolated-${i + 1}`,
          include: [file],
          sequence: { groupOrder: i + 1 },
        },
      })),
    ],
  },
});
