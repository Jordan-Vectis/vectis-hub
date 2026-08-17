import { NextRequest, NextResponse } from "next/server"
import { isCronRequest } from "@/lib/cron-auth"
import { attachHeldPhotos } from "@/lib/held-photos"

export const dynamic = "force-dynamic"
export const maxDuration = 120

// POST /api/cron/held-photos — attach any photo whose lot has since appeared.
//
// Photos uploaded through Photography → Upload photos (any sale) whose code matched no lot
// are held (see lib/held-photos.ts). They are also re-checked when 🔗 BC Match writes unique
// IDs and whenever the waiting list is opened; this loop is the safety net that means nobody
// has to remember to look. It is a cheap no-op when nothing is waiting.
export async function POST(req: NextRequest) {
  try {
    if (!isCronRequest(req)) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })
    const res = await attachHeldPhotos()
    return NextResponse.json({ ok: true, ...res })
  } catch (e: any) {
    console.error("cron/held-photos error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
