import { defineConfig } from "vitest/config";

// tsconfig keeps `jsx: preserve` for Next/SWC; vitest's esbuild needs the automatic runtime to
// transform the .tsx component tests (renderToStaticMarkup) without importing React per file.
export default defineConfig({ esbuild: { jsx: "automatic" } });
