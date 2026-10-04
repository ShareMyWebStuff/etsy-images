import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  experimental: {
    typedRoutes: true,
  },
  serverExternalPackages: ['pdfkit', 'playwright'],
};

export default nextConfig;
