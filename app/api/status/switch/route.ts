import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { checkKeys, setServiceSwitch } from "@/lib/status/engine"

export const dynamic = "force-dynamic"

// POST /api/status/switch  { service: string, enabled: boolean }
//
// Switches one Status Centre check off or back on (Jordan, 2026-09-22: "I don't use the it emails
// thing anymore can I have options in the status centre to disable things"). Off = the engine never
// runs it, the banner and the bell leave it out, and its tile says who switched it off and when.
// Admin-only, like the page. The engine does the work; this only checks who is asking.
export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session || session.user.role !== "ADMIN") {
      return NextResponse.json({ error: "Unauthorised" }, { status: 401 })
    }
    const body = await req.json().catch(() => ({})) as { service?: unknown; enabled?: unknown }
    const service = typeof body.service === "string" ? body.service : ""
    if (!checkKeys().includes(service)) {
      return NextResponse.json({ error: `No such check: ${service || "(none given)"}` }, { status: 404 })
    }
    if (typeof body.enabled !== "boolean") {
      return NextResponse.json({ error: "Say whether the check should be on or off." }, { status: 400 })
    }
    const by = session.user.name || session.user.email || "an admin"
    await setServiceSwitch(service, body.enabled, by)
    return NextResponse.json({ ok: true, service, enabled: body.enabled })
  } catch (e: any) {
    console.error("status switch error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
