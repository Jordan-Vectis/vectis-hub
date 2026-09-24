import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { getSignedImageUrl } from "@/lib/r2"

// GET /api/website/picture?key=site-pages/…
// A picture in a test-website page (the page editor keeps storage KEYS, not addresses): signs a
// fresh address and redirects to it, so a saved page never holds an address that expires. Only the
// website's own folders — never the Hub's other storage (submissions, documents, recordings…).
const ALLOWED_PREFIXES = ["site-pages/", "hero-slides/", "news-photos/", "sale-photos/", "archive-photos/", "bc-photos/"]
const KEY = /^[a-z-]+\/[A-Za-z0-9._\/-]+\.(jpe?g|png|webp|gif)$/i

export async function GET(req: NextRequest) {
  try {
    // The test website is behind the Hub login (RULES.md) — so is this.
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const key = req.nextUrl.searchParams.get("key") ?? ""
    if (!KEY.test(key) || key.includes("..") || !ALLOWED_PREFIXES.some(p => key.startsWith(p))) {
      return NextResponse.json({ error: "Not a website picture" }, { status: 400 })
    }
    const url = await getSignedImageUrl(key, 3600)
    // The browser may keep the redirect for most of the signature's life, never past it.
    return NextResponse.redirect(url, { status: 302, headers: { "Cache-Control": "private, max-age=3000" } })
  } catch (e: any) {
    console.error("website/picture error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
