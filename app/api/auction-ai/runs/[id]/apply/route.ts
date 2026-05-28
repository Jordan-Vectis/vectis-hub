import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

function parseEstimate(est: string): { low: number | null; high: number | null } {
  const m = est.match(/£([\d,]+)\s*[–\-]\s*£?([\d,]+)/)
  if (!m) return { low: null, high: null }
  return {
    low:  parseInt(m[1].replace(/,/g, ""), 10),
    high: parseInt(m[2].replace(/,/g, ""), 10),
  }
}

const TITLE_LIMIT = 83
function titleFromDescription(desc: string): string {
  const first = desc.split(/[.\n]/)[0].trim()
  return first.length > TITLE_LIMIT ? first.slice(0, TITLE_LIMIT - 1) + "…" : first || "Untitled"
}

// POST /api/auction-ai/runs/[id]/apply
// Applies saved AI run results to the matching CatalogueAuction.
// Body: { lotIds?: string[] } — if provided, only apply those specific run lot IDs.
// - Existing lots (matched by barcode or receiptUniqueId): description + AI estimate updated
// - New lots: created with description, human estimate, and AI estimate both set
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

  const { id } = await params

  try {
    // Optional: restrict to specific run lot IDs (for per-lot apply)
    let body: { lotIds?: string[] } = {}
    try { body = await req.json() } catch { /* no body is fine */ }
    const filterIds = body.lotIds && body.lotIds.length > 0 ? new Set(body.lotIds) : null

    const run = await prisma.auctionRun.findUnique({
      where: { id },
      include: { lots: { orderBy: { createdAt: "asc" } } },
    })
    if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 })

    const auction = await prisma.catalogueAuction.findUnique({
      where: { code: run.code },
      select: { id: true, lots: { select: { id: true, barcode: true, receiptUniqueId: true } } },
    })
    if (!auction) {
      return NextResponse.json(
        { error: `No catalogue auction found with code "${run.code}". Has it been created in Cataloguing first?` },
        { status: 404 },
      )
    }

    // Build lookup maps: identifier → lot ID
    const barcodeToId  = new Map(auction.lots.filter(l => l.barcode).map(l => [l.barcode!, l.id]))
    const uniqueIdToId = new Map(auction.lots.filter(l => l.receiptUniqueId).map(l => [l.receiptUniqueId!, l.id]))

    // Deduplicate within the run — keep the most recently saved record per lot identifier
    const deduped = new Map<string, typeof run.lots[0]>()
    for (const l of run.lots) {
      deduped.set(l.lot.trim(), l)
    }
    let uniqueLots = Array.from(deduped.values())

    // Apply filter if specific lot IDs were requested
    if (filterIds) {
      uniqueLots = uniqueLots.filter(l => filterIds.has(l.id))
    }

    let created = 0
    let updated = 0

    await Promise.all(
      uniqueLots.map(async l => {
        const isUniqueId = /^[A-Za-z]\d{4,7}-\d{1,6}$/.test(l.lot.trim())
        const existingId = isUniqueId ? uniqueIdToId.get(l.lot) : barcodeToId.get(l.lot)
        const { low, high } = parseEstimate(l.estimate)

        if (existingId) {
          // Update existing lot — description + AI estimate only, never touch human estimate
          await prisma.catalogueLot.update({
            where: { id: existingId },
            data: {
              title:          titleFromDescription(l.description),
              description:    l.description,
              aiEstimateLow:  low,
              aiEstimateHigh: high,
              aiUpgraded:     true,
            },
          })
          updated++
        } else {
          // Create new lot — AI is the starting point so populate both estimate fields
          await prisma.catalogueLot.create({
            data: {
              auctionId:       auction.id,
              receiptUniqueId: isUniqueId ? l.lot : null,
              title:           titleFromDescription(l.description),
              description:     l.description,
              estimateLow:     low,
              estimateHigh:    high,
              aiEstimateLow:   low,
              aiEstimateHigh:  high,
              aiUpgraded:      true,
            },
          })
          created++
        }
      }),
    )

    return NextResponse.json({ ok: true, created, updated, auctionId: auction.id })
  } catch (e: any) {
    console.error("[auction-ai/runs/[id]/apply POST]", e)
    return NextResponse.json({ error: e.message ?? "Database error" }, { status: 500 })
  }
}
