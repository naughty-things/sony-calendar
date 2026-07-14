/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The app uses static <img> assets only. Disabling the unused optimizer
  // removes its public cache surface in addition to the patched Next upgrade.
  images: { unoptimized: true },
  experimental: { serverActions: { bodySizeLimit: '2mb' } }
};
export default nextConfig;
