import { redirect } from "next/navigation"
import { prisma } from "@/lib/prisma"
import { auth } from "@/auth"
import SavedFlagsClient, { type SavedBatch, type SavedFlagRow } from "./saved-flags-client"

export const dynamic = "force-dynamic"
export const metadata = { title: "Saved Flagged Lots" }

// Admin → Saved Flagged Lots.
//
// ⚠ WHY THIS EXISTS. Re-running the AI overwrites CatalogueLot.aiFlagNote with a bare update
// that does not go through the lot change log, so the previous run's flags vanish without trace.
// Jack, 2026-08-19: "we are about to overwrite them but we cant loose the data." A save here
// freezes them, and this page reads them back laid out the way the Review tab lays them out.
//
// Everything is try/caught: the table only exists after Run Migrations, and an admin page that
// 500s before the button is pressed is worse than one that says it is not set up yet.

async function loadBatches(): Promise<SavedBatch[]> {
  try {
    const rows = await prisma.savedAiFlag.findMany({
      orderBy: { savedAt: "desc" },
      take:    2000,
      select: {
        batchId: true, label: true, savedAt: true, savedByName: true,
        auctionCode: true, auctionName: true, aiFlagNote: true,
      },
    })
    const map = new Map<string, SavedBatch>()
    for (const r of rows) {
      const b = map.get(r.batchId) ?? {
        batchId: r.batchId, label: r.label, savedAt: r.savedAt.toISOString(),
        savedByName: r.savedByName, sales: [], lots: 0, aiFlags: 0,
      }
      b.lots += 1
      if (r.aiFlagNote) b.aiFlags += 1
      const sale = [r.auctionCode, r.auctionName].filter(Boolean).join(" — ")
      if (sale && !b.sales.includes(sale)) b.sales.push(sale)
      map.set(r.batchId, b)
    }
    return [...map.values()]
  } catch { return [] }
}

async function loadBatch(batchId: string): Promise<SavedFlagRow[]> {
  try {
    const rows = await prisma.savedAiFlag.findMany({
      where:   { batchId },
      orderBy: [{ auctionCode: "asc" }, { barcode: "asc" }],
      take:    5000,
    })
    return rows.map(r => ({
      id: r.id, lotId: r.lotId,
      auctionCode: r.auctionCode, auctionName: r.auctionName,
      barcode: r.barcode, receiptUniqueId: r.receiptUniqueId, title: r.title,
      keyPoints: r.keyPoints, description: r.description,
      condition: r.condition, category: r.category, subCategory: r.subCategory, brand: r.brand,
      estimateLow: r.estimateLow, estimateHigh: r.estimateHigh,
      aiEstimateLow: r.aiEstimateLow, aiEstimateHigh: r.aiEstimateHigh,
      imageUrls: r.imageUrls, cataloguedBy: r.cataloguedBy,
      aiFlagNote: r.aiFlagNote, reviewFlag: r.reviewFlag,
      reviewFlaggedBy: r.reviewFlaggedBy,
      reviewFlaggedAt: r.reviewFlaggedAt?.toISOString() ?? null,
      savedAt: r.savedAt.toISOString(), savedByName: r.savedByName,
    }))
  } catch { return [] }
}

/** The sales a save can be taken from, newest first. */
async function loadAuctions() {
  try {
    const rows = await prisma.catalogueAuction.findMany({
      orderBy: [{ auctionDate: "desc" }, { createdAt: "desc" }],
      take:    200,
      select:  { id: true, code: true, name: true },
    })
    return rows.map(a => ({ id: a.id, label: [a.code, a.name].filter(Boolean).join(" — ") }))
  } catch { return [] }
}

export default async function SavedFlaggedLotsPage({
  searchParams,
}: {
  searchParams: Promise<{ batch?: string }>
}) {
  const session = await auth()
  if (!session) redirect("/login")
  const dbUser = await prisma.user.findUnique({
    where: { id: session.user.id }, select: { role: true },
  })
  if (dbUser?.role !== "ADMIN") redirect("/hub")

  const { batch } = await searchParams
  const [batches, auctions, rows] = await Promise.all([
    loadBatches(),
    loadAuctions(),
    batch ? loadBatch(batch) : Promise.resolve([]),
  ])

  return (
    <SavedFlagsClient
      batches={batches}
      auctions={auctions}
      openBatch={batch ?? null}
      rows={rows}
    />
  )
}
