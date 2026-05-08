import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdfkit ships its standard PostScript fonts as separate .afm files inside
  // node_modules/pdfkit/js/data. Next.js's file-trace doesn't pick these up
  // automatically because they're loaded at runtime via fs.readFileSync, so
  // serverless deploys end up missing Helvetica.afm and the route 500s.
  // This tells Next to include them.
  outputFileTracingIncludes: {
    "/api/warehouse/collections-due/pdf": [
      "./node_modules/pdfkit/js/data/**/*",
    ],
  },
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
