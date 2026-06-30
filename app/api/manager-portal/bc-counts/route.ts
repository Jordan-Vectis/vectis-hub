import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { getBCToken, bcCount } from "@/lib/bc"

export const maxDuration = 120

// GET /api/manager-portal/bc-counts
//
// For every Hub catalogue auction, return the number of lots Business Central
// holds for that sale — matched on EVA_SalesAllocation (the "F089" style sales
// allocation code) against the live Receipt_Lines_Excel endpoint. Same field +
// endpoint the warehouse unsold-items route uses, so the matching stays
// consistent across the app.
//
// Returns { connected: false } (HTTP 200) when no BC token is available so the
// Manager Portal can still render its Hub counts instead of erroring out.

const CONCURRENCY = 8

async function inBatches<T, R>(items: T[], size: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = []
  for (let i = 0; i < items.length; i += size) {
    out.push(...await Promise.all(items.slice(i, i + size).map(fn)))
  }
  return out
}

export async function GET() {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const token = await getBCToken()
    if (!token) return NextResponse.json({ connected: false, counts: {} })

    const auctions = await prisma.catalogueAuction.findMany({ select: { code: true } })
    const codes = [...new Set(auctions.map(a => a.code).filter(Boolean))]

    // counts[code] = number (BC count) or null (lookup failed for that sale)
    const counts: Record<string, number | null> = {}
    await inBatches(codes, CONCURRENCY, async code => {
      try {
        // Escape single quotes for the OData string literal.
        const safe = code.replace(/'/g, "''")
        counts[code] = await bcCount(token, "Receipt_Lines_Excel", `EVA_SalesAllocation eq '${safe}'`)
      } catch {
        counts[code] = null
      }
    })

    return NextResponse.json({ connected: true, counts })
  } catch (e: any) {
    console.error("manager-portal/bc-counts error:", e)
    return NextResponse.json({ error: e?.message ?? "BC query failed" }, { status: 500 })
  }
}
