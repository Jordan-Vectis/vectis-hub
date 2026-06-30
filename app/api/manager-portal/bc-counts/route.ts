import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { getBCToken, bcFetchAll } from "@/lib/bc"

export const maxDuration = 120

// GET /api/manager-portal/bc-counts
//
// For every ACTIVE Hub sale, counts the lots Business Central holds for that
// sales allocation by UNIQUE BARCODE (PTE_InternalBarcode on Receipt_Lines_Excel,
// matched on EVA_SalesAllocation), and cross-references those barcodes against
// the sale's Hub lot barcodes. That gives, per sale:
//   bc       — unique barcodes in BC for the sale
//   overlap  — Hub lots whose barcode is already in BC (so they aren't counted twice)
//   combined — the deduped union (Hub ∪ BC), i.e. the true total with no double count
//
// Completed sales are skipped (the portal shows them as ticks, not counts).
// Returns { connected:false } (HTTP 200) when no BC token, so the page still
// renders its Hub-side stats. A per-sale failure yields null → shown as "—".

const CONCURRENCY = 4

const normBarcode = (b: unknown) => String(b ?? "").replace(/[^\x20-\x7E]/g, "").trim().toUpperCase()

// Mirrors parseBool in the warehouse receipt-lines sync.
const isCatalogued = (v: unknown) => v === true || v === 1 || v === "true" || v === "Yes"

async function inBatches<T>(items: T[], size: number, fn: (t: T) => Promise<void>): Promise<void> {
  for (let i = 0; i < items.length; i += size) {
    await Promise.all(items.slice(i, i + size).map(fn))
  }
}

export async function GET() {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const token = await getBCToken()
    if (!token) return NextResponse.json({ connected: false, sales: {} })

    const active = await prisma.catalogueAuction.findMany({
      where:  { complete: false },
      select: { code: true, lots: { select: { barcode: true } } },
    })

    const sales: Record<string, { bc: number; overlap: number; combined: number } | null> = {}

    // Wall-clock budget: once exceeded, remaining sales return null ("—") instead
    // of risking the whole route timing out and erroring every sale.
    const startedAt = Date.now()
    const BUDGET_MS = 100_000

    await inBatches(active, CONCURRENCY, async a => {
      const code = a.code
      if (Date.now() - startedAt > BUDGET_MS) { sales[code] = null; return }
      try {
        const safe = code.replace(/'/g, "''")
        const rows = await bcFetchAll(token, "Receipt_Lines_Excel", `EVA_SalesAllocation eq '${safe}'`, "PTE_InternalBarcode,EVA_Catalogued")

        // Only count lots actually CATALOGUED in BC (not everything received) —
        // otherwise every Hub lot, having been received into BC, matches and the
        // combined union collapses to the BC received total (Hub adds nothing).
        const bcSet = new Set<string>()
        for (const r of rows) {
          if (!isCatalogued((r as any).EVA_Catalogued)) continue
          const n = normBarcode((r as any).PTE_InternalBarcode)
          if (n) bcSet.add(n)
        }

        // overlap = Hub LOTS (not distinct barcodes) whose barcode is in BC, so
        // "X of N Hub lots already in BC" lines up with the lot count.
        let overlap = 0
        for (const l of a.lots) {
          const n = normBarcode(l.barcode)
          if (n && bcSet.has(n)) overlap++
        }

        const bc = bcSet.size
        const hubLots = a.lots.length
        // Deduped union: every BC barcode + every Hub lot not already in BC.
        sales[code] = { bc, overlap, combined: bc + (hubLots - overlap) }
      } catch {
        sales[code] = null
      }
    })

    return NextResponse.json({ connected: true, sales })
  } catch (e: any) {
    console.error("manager-portal/bc-counts error:", e)
    return NextResponse.json({ error: e?.message ?? "BC query failed" }, { status: 500 })
  }
}
