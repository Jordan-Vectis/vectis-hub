import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { getBCToken, bcFetchAll } from "@/lib/bc"
import { prisma } from "@/lib/prisma"
import { buildPackerMatcher } from "@/lib/packer-match"

export const maxDuration = 60

// GET /api/packers/suggestions[?days=90]
//
// Pulls distinct PTE_InternalReference values from BC shipments in the
// last N days, runs them through the same fuzzy matcher used by the
// packing report, and returns the ones that DON'T match any existing
// canonical Packer. Returned with shipment counts so admins can spot
// frequent typo'd names worth promoting to the table.

export async function GET(req: NextRequest) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const token = await getBCToken()
    if (!token) return NextResponse.json({ error: "BC_NOT_CONNECTED" }, { status: 503 })

    const days = Math.max(1, Math.min(parseInt(req.nextUrl.searchParams.get("days") ?? "90", 10) || 90, 365))

    // Date window
    const from = new Date()
    from.setUTCDate(from.getUTCDate() - days)
    const fromStr = from.toISOString().slice(0, 10)
    const toStr   = new Date().toISOString().slice(0, 10)

    // Fetch shipments in the window — just the fields we need
    const shipments = await bcFetchAll(
      token,
      "ShipmentRequestAPI",
      `EVA_ShipmentDate ge ${fromStr} and EVA_ShipmentDate le ${toStr}`,
      "EVA_ShipmentDate,EVA_Status,PTE_InternalReference",
    )
    const active = shipments.filter((s: any) => s.EVA_Status !== "Cancelled")

    // Tally raw staff strings
    const counts: Record<string, number> = {}
    for (const s of active) {
      const raw = (s.PTE_InternalReference ?? "").trim()
      if (!raw) continue
      counts[raw] = (counts[raw] ?? 0) + 1
    }

    // Match against the canonical Packer table — only return unmatched ones
    const packers = await prisma.packer.findMany({
      select: { id: true, name: true, staffGroup: true, aliases: true },  // include inactive too
    })
    const matcher = buildPackerMatcher(packers)

    const suggestions: { raw: string; count: number }[] = []
    for (const [raw, count] of Object.entries(counts)) {
      const m = matcher(raw)
      if (!m.canonical) suggestions.push({ raw, count })
    }
    suggestions.sort((a, b) => b.count - a.count)

    return NextResponse.json({
      window: { fromStr, toStr, days },
      totalShipments:    active.length,
      uniqueNames:       Object.keys(counts).length,
      suggestions,
    })
  } catch (e: any) {
    console.error("packers/suggestions error:", e)
    return NextResponse.json({ error: e?.message ?? "BC query failed" }, { status: 500 })
  }
}
