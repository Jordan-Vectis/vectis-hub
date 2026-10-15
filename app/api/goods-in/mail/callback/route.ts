import { NextRequest, NextResponse } from "next/server"
import { timingSafeEqual } from "node:crypto"
import { getEffectiveSession } from "@/lib/impersonation"
import { GoodsInAccessError, requireGoodsIn, type GoodsInUser } from "@/lib/goods-in/access"
import { appOrigin, exchangeCode, MailNotReadyError } from "@/lib/goods-in/mail"
import { failure, MAIL_STATE_COOKIE, MAIL_STATE_PATH } from "../../_lib/shared"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// GET /api/goods-in/mail/callback — where Microsoft sends the admin back after signing in.
// Checks the `state` against the httpOnly cookie the connect route set, swaps the code for tokens,
// stores them, and returns to Goods In → Settings with ?mail=connected or ?mail=error&reason=….
// Every outcome is a redirect back to Settings (this is a page the browser lands on, so a JSON
// answer would strand the admin), except an unexpected failure, which answers { error } as usual.

const same = (a: string, b: string) => {
  const x = Buffer.from(a), y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

export async function GET(req: NextRequest) {
  try {
    const origin = appOrigin(req.headers)
    const done = (query: string) => {
      const res = NextResponse.redirect(new URL(`/tools/warehouse/settings?${query}#email`, origin))
      res.cookies.set(MAIL_STATE_COOKIE, "", { httpOnly: true, secure: origin.startsWith("https://"), sameSite: "lax", maxAge: 0, path: MAIL_STATE_PATH })
      return res
    }
    const back = (reason: string) => done(`mail=error&reason=${encodeURIComponent(reason.slice(0, 400))}`)

    if (!(await getEffectiveSession())) return NextResponse.redirect(new URL("/login", origin))
    let me: GoodsInUser
    try {
      me = await requireGoodsIn("admin")
    } catch (e) {
      if (e instanceof GoodsInAccessError) return back("Only a Warehouse admin can connect the receipts mailbox.")
      throw e
    }

    const sp = req.nextUrl.searchParams
    const msError = sp.get("error_description") || sp.get("error")
    if (msError) return back(`Microsoft said: ${msError.split(/\r?\n/)[0].replace(/\s*Trace ID:.*$/i, "").trim()}`)

    const state = sp.get("state") ?? ""
    const saved = req.cookies.get(MAIL_STATE_COOKIE)?.value ?? ""
    if (!state || !saved || !same(state, saved)) {
      return back("The sign-in took too long, or was started in another tab or browser. Press Connect again and finish the Microsoft sign-in in the same tab.")
    }
    const code = sp.get("code")
    if (!code) return back("Microsoft didn't send a sign-in code back. Press Connect again.")

    try {
      await exchangeCode(origin, code, me.name)
    } catch (e) {
      if (e instanceof MailNotReadyError) return back(e.message)
      throw e
    }
    return done("mail=connected")
  } catch (e) {
    return failure("mail callback", e)
  }
}
