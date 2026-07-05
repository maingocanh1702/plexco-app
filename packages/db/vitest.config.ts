import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // one shared throwaway database — files/tests must not interleave
    fileParallelism: false,
    sequence: { concurrent: false },
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
