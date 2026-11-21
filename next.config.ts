import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR || '.next',
  experimental: {
    typedRoutes: true,
  },
  serverExternalPackages: ['pdfkit'],
};

export default nextConfig;
