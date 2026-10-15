import { defineConfig } from "vitest/config";

export default defineConfig({
  // Next compiles TSX with the automatic runtime; mirror it so component modules import cleanly.
  esbuild: { jsx: "automatic" },
  test: { exclude: ["e2e/**", "node_modules/**", ".next/**"] },
});
