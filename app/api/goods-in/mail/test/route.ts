import { NextRequest, NextResponse } from "next/server"
import { cleanEmail, mailStatus, sendTestEmail } from "@/lib/goods-in/mail"
import { errorJson, failure, gate } from "../../_lib/shared"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 30

// POST /api/goods-in/mail/test  { to }  → { ok: true, sentTo } | { ok: false, error }
// Warehouse admins only. Sends a short test email from the receipts mailbox, so an admin can prove
// the connected account really is allowed to send from it (Send As / Send on behalf can only be
// checked by sending) before a customer is waiting at the counter.
export async function POST(req: NextRequest) {
  try {
    const g = await gate("admin")
    if (g.res) return g.res
    const body = (await req.json().catch(() => null)) as { to?: unknown } | null
    const to = cleanEmail(body?.to)
    if (!to) return errorJson("That email address doesn't look right — check it and try again.", 400)
    const s = await mailStatus()
    if (!s.connected) return errorJson("The receipts mailbox isn't connected yet — press Connect first.", 409)
    await sendTestEmail(to, g.me.name)
    return NextResponse.json({ ok: true, sentTo: to })
  } catch (e) {
    return failure("mail test", e)
  }
}
