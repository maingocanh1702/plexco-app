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
  {
    // DD-56 clause 2 (owner amendment 2026-08-26): the CLOSED property behind the interim
    // actor gate for the session command routes. `tenantsForPerson` is the only source of a
    // membership role in apps/web, so a file that cannot import it cannot decide on one.
    //
    // This is a lint rule and not a test because three consecutive review rounds proved a
    // syntactic scanner cannot close the family: `includes`/`switch`/`Set.has`, then aliased
    // destructuring and `membership[key]`, then `.js` files (tsconfig sets allowJs), namespace
    // imports and dynamic `import()`. ESLint resolves modules for real, so those are its problem
    // rather than a regex's. The AST tests in session-command-route.test.ts are kept as
    // defense-in-depth for the named forms — they fail faster and more legibly — but this is the
    // guarantee.
    //
    // THREE files, not two, and the difference is deliberate: OBTAINING a role is not DECIDING on
    // one. auth/session/route.ts serialises the caller's OWN memberships straight back to them and
    // makes no authorization decision, so it needs the import while staying outside the
    // may-decide allowlist (which is session-command-route.ts + onboarding/readiness/route.ts,
    // clause 2 of the amendment). Do not "simplify" these into one list — collapsing them either
    // breaks /api/auth/session or silently widens who may gate on a role.
    //
    // Adding a fourth entry requires its own owner decision (clause 1). When
    // tenant-capability-authority-core lands, this whole restriction is replaced by
    // authorize(action, actor, target) and the amendment is deleted.
    files: ["apps/web/**/*.{ts,tsx,js,jsx,mjs,cjs}"],
    ignores: [
      "apps/web/lib/session-command-route.ts",
      "apps/web/app/api/onboarding/readiness/route.ts",
      "apps/web/app/api/auth/session/route.ts",
      // Tests mock the resolver; they ship nothing. The AST scan excludes them for the same reason.
      "apps/web/**/*.test.{ts,tsx}",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            // Repeated deliberately: flat config resolves rules last-wins per rule NAME, so
            // re-declaring no-restricted-imports here would drop the HR1 entry above for every
            // apps/web file if it were not restated.
            {
              name: "@plexco/db/schema",
              message:
                "Tenant tables are reached ONLY via tenantRepo/withTenant from @plexco/db (HR1 fail-closed RLS choke-point).",
            },
            {
              name: "@plexco/db",
              importNames: ["tenantsForPerson"],
              message:
                "DD-56 clause 2: membership roles are resolved ONLY in lib/session-command-route.ts (the choke-point), api/onboarding/readiness/route.ts and api/auth/session/route.ts. A new site needs its own owner decision.",
            },
          ],
        },
      ],
      // no-restricted-imports only inspects ImportDeclaration, so `await import("@plexco/db")`
      // slips past it — measured, not assumed. Rather than ban dynamic import of the whole module
      // (over-broad: lib/session-cookies.ts legitimately lazy-imports createWebSession /
      // rotateWebSession / rateLimitCheck, none of which is a role), this restricts the RESOLVER'S
      // NAME. Naming it is the one thing every reach has in common — static import, dynamic
      // destructure, member access off a namespace, or a computed string key.
      //
      // Residual, stated rather than hidden: a name assembled at runtime
      // (`db["tenants" + "ForPerson"]`) is beyond any static tool. It is confined to files that
      // can neither import nor name the resolver, which is what keeps the residual small rather
      // than an open door.
      "no-restricted-syntax": [
        "error",
        {
          selector: 'Identifier[name="tenantsForPerson"]',
          message:
            "DD-56 clause 2: tenantsForPerson is resolved ONLY in lib/session-command-route.ts (the choke-point), api/onboarding/readiness/route.ts and api/auth/session/route.ts. A new site needs its own owner decision.",
        },
        {
          selector: 'Literal[value="tenantsForPerson"]',
          message:
            "DD-56 clause 2: reaching tenantsForPerson by computed key is restricted here. Use the choke-point in lib/session-command-route.ts.",
        },
        {
          // Restricting the NAME alone left the MODULE open: `const db = await import("@plexco/db")`
          // followed by a runtime-assembled key reaches the resolver with zero diagnostics
          // (codex round-02 [P2], reproduced). Banning the dynamic import of the package closes
          // that form. The one file with legitimate lazy imports is exempted just below — not here
          // — so this stays a blanket ban everywhere else.
          selector: 'ImportExpression > Literal[value="@plexco/db"]',
          message:
            "DD-56 clause 2: dynamic import of @plexco/db is restricted here — a module object reaches tenantsForPerson by computed key. Use the choke-point in lib/session-command-route.ts.",
        },
      ],
    },
  },
  {
    // lib/session-cookies.ts legitimately lazy-imports createWebSession / rotateWebSession /
    // rateLimitCheck — none of them a role — so the dynamic-import ban above would red-line two
    // correct call sites. It keeps the NAME restrictions, so it still cannot import or spell
    // tenantsForPerson; only the module-level ban is lifted, for this one file.
    //
    // A separate config object rather than an `ignores` entry, deliberately: flat config resolves
    // rules last-wins per rule NAME, so listing this file in the block above would have dropped
    // the Identifier/Literal selectors for it too. This object re-states exactly the two that must
    // survive.
    files: ["apps/web/lib/session-cookies.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: 'Identifier[name="tenantsForPerson"]',
          message:
            "DD-56 clause 2: tenantsForPerson is resolved ONLY in lib/session-command-route.ts, api/onboarding/readiness/route.ts and api/auth/session/route.ts.",
        },
        {
          selector: 'Literal[value="tenantsForPerson"]',
          message: "DD-56 clause 2: reaching tenantsForPerson by computed key is restricted here.",
        },
      ],
    },
  },
);
