import js from "@eslint/js";
import nextPlugin from "@next/eslint-plugin-next";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/build/**",
      "**/.next/**",
      "**/coverage/**",
      "**/next-env.d.ts",
      "*.mjs",
      "!eslint.config.mjs",
      ".autopilot/**",
      "ap3/state/**",
      ".gitnexus/**",
      // Local throwaway probe harness: git-ignored via .probe/.gitignore, but ESLint does not read
      // nested .gitignore files, and the "*.mjs" entry above only matches the repo root. Without
      // this, `pnpm lint` fails on 7 no-undef in .probe/*.mjs and every autopilot preflight halts
      // with PREFLIGHT_REGRESSION on a file that is not tracked source.
      ".probe/**",
      "*.cjs",
      "plexco-dashboard.html",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: {
      "@next/next": nextPlugin,
    },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs["core-web-vitals"].rules,
      // App Router project: there is intentionally no pages/ directory.
      "@next/next/no-html-link-for-pages": "off",
    },
  },
  prettier,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    // Node CLI scripts under scripts/ are linted but were getting no Node globals.
    //
    // WHY THIS BLOCK EXISTS: the `ignores` entry `"*.mjs"` above matches ONLY the repo root — the
    // same gotcha already documented on the `.probe/**` entry. So `scripts/*.mjs` IS linted, and
    // `scripts/autopilot-review-readiness.mjs` failed with 11 `no-undef` on bare `process`, turning
    // `pnpm lint` (and CI job `lint`) red on main from the moment the Level 3 kit v11 landed
    // (`ed38106`). Its sibling `scripts/check-review-readiness.mjs` happened to pass only because it
    // imports `node:process` explicitly.
    //
    // WHY HERE AND NOT IN THE SCRIPT: `autopilot-review-readiness.mjs` is a kit pack file kept
    // byte-identical to `Claude template/autopilot/parallel/` and refreshed by `autopilot-update.sh`.
    // An import added there is silently reverted on the next kit sync. This file is repo-owned, so
    // the fix survives — and it fixes the whole class rather than one file.
    files: ["scripts/**/*.{mjs,js}"],
    languageOptions: {
      globals: {
        process: "readonly",
        console: "readonly",
        Buffer: "readonly",
        __dirname: "readonly",
        __filename: "readonly",
        URL: "readonly",
        TextEncoder: "readonly",
        TextDecoder: "readonly",
        // Node ≥18 global fetch API (used by scripts/smoke-predeploy.mjs)
        fetch: "readonly",
        AbortSignal: "readonly",
      },
    },
  },
  {
    // Hand-written service worker (apps/web/public/sw.js): it runs in ServiceWorkerGlobalScope,
    // not Node and not a window, so the browser worker globals are declared here by name.
    files: ["apps/web/public/sw.js"],
    languageOptions: {
      sourceType: "script",
      globals: {
        self: "readonly",
        caches: "readonly",
        fetch: "readonly",
        Response: "readonly",
        URL: "readonly",
      },
    },
  },
  {
    // HR1 choke-point: apps never touch tenant tables directly — every
    // tenant-scoped query goes through tenantRepo/withTenant (@plexco/db).
    files: ["apps/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@plexco/db/schema",
              message:
                "Tenant tables are reached ONLY via tenantRepo/withTenant from @plexco/db (HR1 fail-closed RLS choke-point).",
            },
          ],
        },
      ],
    },
  },
);
