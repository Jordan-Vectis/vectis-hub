import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Customers' odd file types (lib/media-convert.ts, lib/video-convert.ts): iPhone HEIC photos are
  // decoded with libheif compiled to WebAssembly, and videos browsers can't play are converted by the
  // ffmpeg binary ffmpeg-static downloads on install. Loaded from node_modules at run time rather than
  // bundled — one is a large Emscripten build with the WASM inlined, the other finds its binary by path.
  serverExternalPackages: ["heic-decode", "libheif-js", "ffmpeg-static"],
  experimental: {
    serverActions: {
      bodySizeLimit: "20mb",
    },
    // ⚠ THE SERVER ACTION LIMIT ABOVE IS NOT THE ONLY ONE. This app uses proxy.ts
    // (Next 16's renamed middleware), and when a proxy is present Next buffers the
    // request body so it can be read twice — capped at 10MB by DEFAULT. A photo
    // upload past that is silently TRUNCATED, the multipart parser then throws
    // "Unexpected end of form", and because server.js installs no uncaughtException
    // handler the whole process goes down with it — a burst of "could not start a
    // slice … (ECONNREFUSED)" lines from the pipeline tick around it is the overnight
    // runner failing to reach a server that is restarting.
    // ⚠ Not every "fetch failed" was that. Until 2026-09-18 the cron routes held their
    // request open for the whole job, and Node's 300 s fetch timeout printed one
    // "fetch failed" per ~9-minute pipeline slice with NO restart at all — look for a
    // "> Vectis Hub ready" line before blaming a crash. The cause code is logged now.
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
