import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: "20mb",
    },
    // ⚠ THE SERVER ACTION LIMIT ABOVE IS NOT THE ONLY ONE. This app uses proxy.ts
    // (Next 16's renamed middleware), and when a proxy is present Next buffers the
    // request body so it can be read twice — capped at 10MB by DEFAULT. A photo
    // upload past that is silently TRUNCATED, the multipart parser then throws
    // "Unexpected end of form", and because server.js installs no uncaughtException
    // handler the whole process goes down with it — which is what the burst of
    // "[cron/pipeline-queue] error: fetch failed" lines around it actually is: the
    // overnight runner failing to reach a server that is restarting.
    // Matched to the server action limit so one number governs an upload.
    // ⚠ The runtime warning still names the OLD key (middlewareClientMaxBodySize).
    // It was renamed to this one — see node_modules/next/dist/docs/01-app/02-guides/
    // upgrading/codemods.md and the proxyClientMaxBodySize doc page.
    proxyClientMaxBodySize: "20mb",
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
