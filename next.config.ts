import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: "20mb",
    },
  },
  images: {
    // Allow query-string local proxy routes (required by Next.js 16)
    localPatterns: [
      { pathname: "/api/public/photo/**" },
      { pathname: "/api/public/photo" },
      { pathname: "/api/catalogue/photo-proxy/**" },
      { pathname: "/api/catalogue/photo-proxy" },
    ],
    // Serve thumbnails at these widths — keeps the lot grid fast
    deviceSizes: [640, 1080, 1920],
    imageSizes: [64, 128, 256, 384],
  },
};

export default nextConfig;
