/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
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
