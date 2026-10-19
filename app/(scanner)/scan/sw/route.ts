import { SCAN_SW_SOURCE } from "./source"

// GET /scan/sw — the handheld scanner's service worker script (./source.ts says what it does).
//
// ⚠ /scan/sw is PUBLIC on purpose — an EXACT path in auth.config.ts's publicExact (with /scan), so the
// scanner's sign-in screen works with nobody signed in. That is safe because the script holds no data
// and no secrets: it only caches what the browser already loaded. It stays a ROUTE, never a .js file
// in /public, so that this one exact path is all that is opened: proxy.ts lets EVERY *.js path
// through without a login, so a /public script would sit outside the gate with no list entry saying
// so. It needs `Service-Worker-Allowed: /scan` because a script at /scan/sw may otherwise only
// control /scan/…, not /scan itself.

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
