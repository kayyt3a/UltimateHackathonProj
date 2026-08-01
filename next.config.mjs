/** @type {import('next').NextConfig} */
const nextConfig = {
  // The diagnose route reads and writes the on-disk cache, so it must never be
  // statically evaluated at build time.
  experimental: {},
};

export default nextConfig;
