import { SCAN_SW_SOURCE } from "./source"

// GET /scan/sw — the handheld scanner's service worker script (./source.ts says what it does).
//
// ⚠ Served from HERE, not from /public, on purpose: proxy.ts lets every *.js file through without a
// login, while /scan/sw has no file extension, so the login gate covers it like any page — the
// scanner screen registers it while someone is signed in. It needs `Service-Worker-Allowed: /scan`
// because a script at /scan/sw may otherwise only control /scan/…, not /scan itself.
// The script holds no data and no secrets; it only caches what the signed-in browser already loaded.

export const dynamic = "force-dynamic"

export function GET() {
  return new Response(SCAN_SW_SOURCE, {
    status: 200,
    headers: {
      "Content-Type": "text/javascript; charset=utf-8",
      "Service-Worker-Allowed": "/scan",
      "Cache-Control": "no-cache, no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
    },
  })
}
