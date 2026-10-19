import { cache } from "react"
import { resolveScanUser } from "@/lib/goods-in/scanner-pass"

// Who is using the handheld scanner, worked out ONCE per request — the layout and the page both ask.
// The Hub login if there is one (with Goods In access), otherwise a scanner sign-in card's session
// (lib/goods-in/scanner-pass.ts). Throws on an unexpected database error, so the layout can say
// "couldn't check your access" (and the service worker can step in) instead of "signed out".
// SERVER ONLY. ⚠ The card session counts on /scan and /api/goods-in/scan/* only — nowhere else.

export const scanWho = cache(resolveScanUser)
