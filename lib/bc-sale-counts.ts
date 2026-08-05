// Per-sale lot counts from Business Central, cross-referenced against the Hub.
//
// Lifted out of /api/manager-portal/bc-counts unchanged when the Dashboard
// needed the same figures. ⚠ Both the route and the sale-progress widget import
// from here — do NOT copy this into a third place. Two copies would drift and
// the Dashboard would start disagreeing with the Sales tab about the same sale,
// which is the exact failure RULES.md calls out for the projection maths.

import { prisma } from "@/lib/prisma"
import { getBCToken, bcFetchAll } from "@/lib/bc"

export type BcSaleCount = { bc: number; overlap: number; combined: number }
export type BcSaleCounts = { connected: boolean; sales: Record<string, BcSaleCount | null> }

const CONCURRENCY = 4

const normBarcode = (b: unknown) => String(b ?? "").replace(/[^\x20-\x7E]/g, "").trim().toUpperCase()

// Mirrors parseBool in the warehouse receipt-lines sync.
const isCatalogued = (v: unknown) => v === true || v === 1 || v === "true" || v === "Yes"

async function inBatches<T>(items: T[], size: number, fn: (t: T) => Promise<void>): Promise<void> {
  for (let i = 0; i < items.length; i += size) {
    await Promise.all(items.slice(i, i + size).map(fn))
  }
}

/**
 * For every ACTIVE Hub sale, count the lots BC holds for that sales allocation
 * by unique barcode, and cross-reference against the sale's Hub lot barcodes:
 *   bc       — unique catalogued barcodes in BC for the sale
 *   overlap  — Hub lots whose barcode is already in BC (so they aren't double counted)
 *   combined — the deduped union (Hub ∪ BC)
 *
 * Returns connected:false when there is no BC token, so a caller can still show
 * its Hub-side figures. A per-sale failure or a blown time budget yields null.
 */
export async function getBcSaleCounts(budgetMs = 100_000): Promise<BcSaleCounts> {
  const token = await getBCToken()
  if (!token) return { connected: false, sales: {} }

  const active = await prisma.catalogueAuction.findMany({
    where:  { complete: false },
    select: { code: true, lots: { select: { barcode: true } } },
  })

  const sales: Record<string, BcSaleCount | null> = {}
  const startedAt = Date.now()

  await inBatches(active, CONCURRENCY, async a => {
    const code = a.code
    if (Date.now() - startedAt > budgetMs) { sales[code] = null; return }
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
      sales[code] = { bc, overlap, combined: bc + (hubLots - overlap) }
    } catch {
      sales[code] = null
    }
  })

  return { connected: true, sales }
}
