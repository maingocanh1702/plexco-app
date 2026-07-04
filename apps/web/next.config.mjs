/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Workspace packages are consumed as TypeScript source (see their `exports`).
  transpilePackages: ["@plexco/core", "@plexco/db"],
};

export default nextConfig;
