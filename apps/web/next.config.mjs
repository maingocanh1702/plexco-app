import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Pin tracing to this monorepo; do not let unrelated lockfiles above the
  // repository make Next.js infer /Users/maingocanh as the workspace root.
  outputFileTracingRoot: repoRoot,
  // Workspace packages are consumed as TypeScript source (see their `exports`).
  transpilePackages: ["@plexco/core", "@plexco/db"],
  webpack: (config) => {
    // The workspace packages are NodeNext ESM: relative imports use ".js"
    // specifiers that resolve to ".ts" sources (required by tsc/tsx/vitest).
    // Teach webpack the same extension aliasing so `next build` resolves them.
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      ".js": [".ts", ".tsx", ".js"],
    };
    return config;
  },
};

export default nextConfig;
