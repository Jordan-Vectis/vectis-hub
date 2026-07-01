import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { getBCTokenAny, bcListServices, bcServiceDocRaw, bcPage } from "@/lib/bc"

export const maxDuration = 60

// GET /api/bc/services — BC discovery diagnostic. Reports which BC env/company
// we're hitting, the raw shape of the OData service document, the list of
// published web services, and a probe of a known endpoint to prove the token +
// environment actually reach real data. Admin-only.
// ?q= filters service names (case-insensitive contains); ?probe= overrides the
// probe endpoint (default Auction_Lines_Excel).
export async function GET(req: NextRequest) {
  try {
    const session = await auth()
    if (!session || session.user.role !== "ADMIN") {
      return NextResponse.json({ error: "Unauthorised" }, { status: 401 })
    }

    const token = await getBCTokenAny()
    if (!token) return NextResponse.json({ error: "BC_NOT_CONNECTED" }, { status: 503 })

    const env = {
      environment: process.env.BC_ENVIRONMENT ?? "production",
      company:     process.env.BC_COMPANY ?? "Vectis",
    }

    // Raw service document — reveals whether `value` is empty/missing and why.
    const serviceDoc = await bcServiceDocRaw(token)

    const services = await bcListServices(token)
    const q = req.nextUrl.searchParams.get("q")?.trim().toLowerCase() ?? ""
    const names = services
      .map(s => s.name)
      .filter(n => (q ? n.toLowerCase().includes(q) : true))
      .sort((a, b) => a.localeCompare(b))

    // Prove the token + environment reach real data via a known endpoint.
    const probeEndpoint = req.nextUrl.searchParams.get("probe")?.trim() || "Auction_Lines_Excel"
    let probe: { endpoint: string; ok: boolean; count?: number; error?: string }
    try {
      const rows = await bcPage(token, probeEndpoint, { $top: 1 })
      probe = { endpoint: probeEndpoint, ok: true, count: rows.length }
    } catch (e: any) {
      probe = { endpoint: probeEndpoint, ok: false, error: e?.message ?? "probe failed" }
    }

    return NextResponse.json({
      env,
      serviceDoc,
      total:    services.length,
      count:    names.length,
      services: names,
      probe,
    })
  } catch (e: any) {
    console.error("bc/services error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
