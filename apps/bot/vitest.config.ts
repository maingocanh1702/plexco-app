import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    fileParallelism: true,
    sequence: { concurrent: false },
    // Includes migration/provisioning and bounded worker/pg-boss shutdown.
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
