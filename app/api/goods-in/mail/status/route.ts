import { NextResponse } from "next/server"
import { mailStatus } from "@/lib/goods-in/mail"
import { failure, gate } from "../../_lib/shared"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// GET /api/goods-in/mail/status → { configured, connected, mailbox, connectedBy, updatedAt, missing }
// Whether receipts can be emailed from the Hub right now. Anyone with Warehouse access (the receipt
// screen asks before offering the Email button). Reads the database only — no call to Microsoft.
export async function GET() {
  try {
    const g = await gate("warehouse")
    if (g.res) return g.res
    const s = await mailStatus()
    return NextResponse.json(
      { configured: s.configured, connected: s.connected, mailbox: s.mailbox, connectedBy: s.connectedBy, updatedAt: s.updatedAt?.toISOString() ?? null, missing: s.missing },
      { headers: { "Cache-Control": "no-store" } },
    )
  } catch (e) {
    return failure("mail status", e)
  }
}
