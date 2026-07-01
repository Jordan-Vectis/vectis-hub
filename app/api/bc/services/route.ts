import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { getBCTokenAny, bcListServices } from "@/lib/bc"

export const maxDuration = 60

// GET /api/bc/services — lists every published BC OData web service so we can
// discover the exact endpoint names BC exposes (e.g. the auction-header /
// statistics table, EVA_AuctionHeader). Admin-only diagnostic.
// Optional ?q= filters service names (case-insensitive contains).
export async function GET(req: NextRequest) {
  try {
    const session = await auth()
    if (!session || session.user.role !== "ADMIN") {
      return NextResponse.json({ error: "Unauthorised" }, { status: 401 })
    }

    const token = await getBCTokenAny()
    if (!token) return NextResponse.json({ error: "BC_NOT_CONNECTED" }, { status: 503 })

    const services = await bcListServices(token)
    const q = req.nextUrl.searchParams.get("q")?.trim().toLowerCase() ?? ""
    const names = services
      .map(s => s.name)
      .filter(n => (q ? n.toLowerCase().includes(q) : true))
      .sort((a, b) => a.localeCompare(b))

    return NextResponse.json({ total: services.length, count: names.length, services: names })
  } catch (e: any) {
    console.error("bc/services error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
