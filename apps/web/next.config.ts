import type { NextConfig } from 'next';

/** Pure client of the API (ADR-018/021): no server data access, no secrets here. */
const nextConfig: NextConfig = {
  transpilePackages: ['@kejasha/ui'],
  reactStrictMode: true,
  output: 'standalone',
};

export default nextConfig;
