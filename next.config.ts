import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR || '.next',
  // Enable gzip compression for all responses
  compress: true,
  images: {
    formats: ['image/avif', 'image/webp'],
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'lh3.googleusercontent.com', // Google profile pictures
      },
      {
        protocol: 'https',
        hostname: '*.googleusercontent.com',
      },
    ],
  },
  experimental: {
    serverActions: {
      bodySizeLimit: '50mb',
    },
    proxyClientMaxBodySize: 50 * 1024 * 1024, // 50MB
    // Optimize client-side navigation
    optimizePackageImports: [
      'lucide-react',
      '@radix-ui/react-dropdown-menu',
      '@radix-ui/react-select',
      '@radix-ui/react-tabs',
      '@radix-ui/react-avatar',
      '@radix-ui/react-progress',
      '@radix-ui/react-switch',
      'framer-motion',
      'recharts',
      'react-dropzone',
      '@dnd-kit/core',
      '@dnd-kit/sortable',
    ],
    // Client-side router cache: keep prefetched pages fresh longer
    staleTimes: {
      dynamic: 30,   // 30s for dynamic pages (default 0)
      static: 300,   // 5min for static pages (default 5min)
    },
  },
  serverExternalPackages: ['mammoth', 'sharp', 'exceljs', 'nodemailer', 'bcryptjs'],
  // Strip dev overlay from production client bundles (Next.js 16 bug: it's included unconditionally)
  webpack(config, { isServer, dev }) {
    if (!dev && !isServer) {
      config.resolve.alias['next/dist/compiled/next-devtools'] = path.resolve(
        __dirname,
        'node_modules/next/dist/next-devtools/dev-overlay.shim.js'
      );
    }
    return config;
  },
  // Production optimizations
  compiler: {
    removeConsole: process.env.NODE_ENV === 'production' ? {
      exclude: ['error', 'warn'],
    } : false,
  },
  // Headers for caching
  async headers() {
    return [
      {
        // Cache static assets aggressively (fonts, images, JS, CSS)
        source: '/:path*.(js|css|woff|woff2|ttf|ico|svg|png|jpg|jpeg|webp|gif)',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
        ],
      },
      {
        // Next.js static chunks (content-hashed filenames) — safe to cache forever
        source: '/_next/static/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
        ],
      },
      {
        // Uploaded files — cache for 1 day
        source: '/uploads/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=86400',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
