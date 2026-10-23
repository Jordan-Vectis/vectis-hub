import { NextRequest, NextResponse } from "next/server"
import { isAuthedOrCron } from "@/lib/auth-or-cron"
import { mirrorBcPage } from "@/lib/goods-in/bc-mirror"

// One page of the BC → Goods In copy (lib/goods-in/bc-mirror.ts), for the nightly cron
// (/api/cron/bc-warehouse drives the loop with the CRON_SECRET). The Settings panel uses the
// server action in lib/actions/goods-in-mirror.ts instead. Reads the Hub's own BC copy tables only.

export const maxDuration = 120

export async function POST(req: NextRequest) {
  try {
    if (!await isAuthedOrCron(req)) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })
    const body = await req.json().catch(() => ({}))
    const res = await mirrorBcPage({ cursor: typeof body.cursor === "string" ? body.cursor : null, full: body.full === true, runId: typeof body.runId === "string" ? body.runId : null })
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.notReady ? 503 : 500 })
    return NextResponse.json(res)
  } catch (e: any) {
    console.error("goods-in bc-mirror route error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
