import { NextRequest, NextResponse } from "next/server"
import { syncITMailbox } from "@/lib/it-mailbox"

export const maxDuration = 60

// POST /api/cron/it-mailbox
// Called by the server's setInterval scheduler to poll the IT mailbox and turn
// new emails into jobs. Protected by CRON_SECRET.
export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 })
  }

  try {
    const result = await syncITMailbox()
    return NextResponse.json(result)
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "Error" }, { status: 500 })
  }
}
