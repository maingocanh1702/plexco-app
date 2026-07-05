import js from "@eslint/js";
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
      ".autopilot/**",
      ".gitnexus/**",
      "*.mjs",
      "*.cjs",
      "plexco-dashboard.html",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
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
