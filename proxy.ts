import NextAuth from "next-auth"
import { authConfig } from "@/auth.config"

const { auth } = NextAuth(authConfig)

export { auth as proxy }

export const config = {
  // Exclude static assets in /public so they're served without auth —
  // otherwise a logged-out user on a public page (e.g. /submit/[token]) gets
  // redirected to /login when the browser requests an image, breaking it.
  //
  // ⚠ `js` is in this list for a specific reason: Photo Prep loads
  // /photo-prep-worker.js with `new Worker(...)`. A worker script request that
  // receives a REDIRECT fails outright — the worker never starts, so every
  // photo errors and nothing is written, with no obvious cause. Any static
  // asset the browser fetches as a subresource belongs here.
  //
  // This does NOT weaken the login gate from RULES.md → "Public site is
  // login-gated": that gate covers PAGE routes (/, /auctions, /portal, …),
  // which have no file extension and are still matched. `.html` is
  // deliberately NOT excluded, so the gated pages in /public
  // (auto-clerk-*.html, saleroom-trainer.html) stay behind login.
  // `wasm` is here for the same reason as `js`: Photo Prep's barcode reader
  // fetches /zxing_reader.wasm at runtime, and a redirect to /login would make
  // it fail to instantiate — barcode photos would silently stop being detected.
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|js|mjs|css|txt|woff|woff2|wasm)$).*)",
  ],
}
