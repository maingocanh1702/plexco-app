import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Test files must run strictly sequentially, never as concurrent workers:
    // (1) each DB test file's setupRlsTestContext() DROPs/CREATEs its OWN
    //     throwaway database (auth.test.ts / rls-invariants.test.ts /
    //     waitlist-invariants.test.ts each pass a distinct dbName — see
    //     test-harness.ts), and
    // (2) migration 0000's cluster-global role creation
    //     (`IF NOT EXISTS (SELECT ...) THEN CREATE ROLE ...`) is a
    //     check-then-act, non-atomic against a CONCURRENT migration run on a
    //     different database — two files' migrate() calls racing would let
    //     both see "role missing" and both attempt CREATE ROLE, one failing.
    // fileParallelism:false serializes file execution end-to-end (not just
    // per-test), which is what actually prevents (2) — do NOT flip this to
    // true without first making migration 0000's role creation atomic
    // (verified: 8 consecutive local runs of the full DB suite with this
    // setting, zero role-creation errors).
    fileParallelism: false,
    sequence: { concurrent: false },
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
