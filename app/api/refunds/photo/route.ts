import { NextRequest, NextResponse } from "next/server"
import { getAccountsAccess } from "@/lib/accounts-auth"
import { getSignedImageUrl } from "@/lib/r2"
import { REFUNDS_ADMINS_ONLY } from "@/lib/refunds"

// Accounts → Refunds: a request's photo, for the staff panel ONLY. Admins only (like the panel —
// getAccountsAccess, re-checked here on every request), and only an exact refund-photo key —
// refund-photos/<request id>/<n>.<jpg|png|webp>, the shape the public form saves — so it can never be
// used to open anything else in R2. Answers a redirect to a link signed for 15 minutes.
// ⚠ Never a public route: it isn't under /api/public, and customers' photos must never be
// world-readable (the public /api/public/photo prefix list must never gain refund-photos/).

const KEY_RE = /^refund-photos\/[a-z0-9]+\/\d{1,2}\.(jpg|png|webp)$/

export async function GET(req: NextRequest) {
  try {
    const { session, isAdmin } = await getAccountsAccess()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })
    if (!isAdmin) return NextResponse.json({ error: REFUNDS_ADMINS_ONLY }, { status: 403 })

    const key = req.nextUrl.searchParams.get("key") ?? ""
    if (!KEY_RE.test(key)) return NextResponse.json({ error: "That isn't a refund photo." }, { status: 400 })

    const url = await getSignedImageUrl(key, 900)
    const res = NextResponse.redirect(url, 302)
    // The signed link is personal to this moment — never cached or passed on.
    res.headers.set("Cache-Control", "private, no-store")
    res.headers.set("Referrer-Policy", "no-referrer")
    return res
  } catch (e) {
    console.error("refunds photo error:", e)
    return NextResponse.json({ error: "The photo couldn't be opened just now — please try again." }, { status: 500 })
  }
}
