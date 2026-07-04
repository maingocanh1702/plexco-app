import { defineConfig } from "drizzle-kit";

/**
 * drizzle-kit config. The hand-written SQL in ./migrations is authoritative
 * (it carries RLS, grants, functions and triggers that drizzle-kit cannot
 * generate). Use `drizzle-kit` for diffing/inspection against schema.ts, not as
 * the sole migration source.
 */
export default defineConfig({
  schema: "./schema.ts",
  out: "./migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
  // App connects as NOBYPASSRLS `app`; run migrations as the `migration`/owner role.
  verbose: true,
  strict: true,
});
