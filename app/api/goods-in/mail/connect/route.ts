import { NextRequest, NextResponse } from "next/server"
import { randomBytes } from "node:crypto"
import { appOrigin, authorizeUrl, mailConfigured, missingMailSettings } from "@/lib/goods-in/mail"
import { failure, gate, MAIL_STATE_COOKIE, MAIL_STATE_PATH } from "../../_lib/shared"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// GET /api/goods-in/mail/connect — Warehouse admins only. Sends the admin to Microsoft to sign in
// as an account that may send from the receipts mailbox; Microsoft sends them back to
// /api/goods-in/mail/callback. The random `state` is kept in an httpOnly cookie and checked there,
// so a sign-in started anywhere else can't be slipped in.

export async function GET(req: NextRequest) {
  try {
    const g = await gate("admin")
    if (g.res) return g.res

    const origin = appOrigin(req.headers)
    const back = (reason: string) =>
      NextResponse.redirect(new URL(`/tools/warehouse/settings?mail=error&reason=${encodeURIComponent(reason)}#email`, origin))

    if (!mailConfigured()) return back(`The Hub's Microsoft settings aren't set on this environment (${missingMailSettings().join(", ")}).`)

    const state = randomBytes(24).toString("base64url")
    const res = NextResponse.redirect(authorizeUrl(origin, state))
    res.cookies.set(MAIL_STATE_COOKIE, state, {
      httpOnly: true,
      secure: origin.startsWith("https://"),
      sameSite: "lax", // sent on Microsoft's top-level redirect back to us, not on cross-site posts
      maxAge: 600,
      path: MAIL_STATE_PATH,
    })
    return res
  } catch (e) {
    return failure("mail connect", e)
  }
}
